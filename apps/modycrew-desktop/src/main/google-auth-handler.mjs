/**
 * 구글 로그인 (Firebase 계정용) — 데스크톱 전용 OAuth 핸들러.
 *
 * Electron 렌더러에서는 Firebase 의 signInWithPopup/Redirect 가 동작하지 않으므로
 * (팝업 차단 + modycrew:// 커스텀 프로토콜), 데스크톱 표준 방식인
 *   외부 브라우저 + 루프백(127.0.0.1) PKCE OAuth → Google ID 토큰
 * 으로 토큰만 받아 렌더러의 signInWithCredential 에 전달합니다.
 * (기존 Codex OAuth 루프백 구현과 동일한 패턴)
 *
 * 준비물: GCP 콘솔의 "데스크톱 앱" OAuth 클라이언트.
 *  - MODYCREW_GOOGLE_SIGNIN_CLIENT_ID (필수)
 *  - MODYCREW_GOOGLE_SIGNIN_CLIENT_SECRET (데스크톱 앱 유형은 비밀로 취급되지 않지만
 *    Google 토큰 교환이 요구하므로 함께 설정)
 *
 * 보안 원칙: refresh token 은 요청하지 않고(online), access/id 토큰은 저장하지 않으며
 * 로그인 1회 용도로만 렌더러에 전달합니다.
 */

import crypto from "node:crypto";
import { createServer } from "node:http";

const googleAuthUrl = "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenUrl = "https://oauth2.googleapis.com/token";
const googleScope = "openid email profile";
const callbackPath = "/oauth/google";
const signInTimeoutMs = 180_000;
const signInExternalLaunchCooldownMs = 90_000;

let activeSession = null;

export async function handleGoogleAuthMessage(_event, payload = {}, options = {}) {
  const kind = String(payload.kind ?? "");

  if (kind === "status") {
    return {
      status: "google_signin_status",
      configured: Boolean(resolveClientId(options)),
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (kind === "start_google_sign_in") {
    return startGoogleSignIn(options);
  }

  throw new Error(`unsupported google-auth kind: ${kind}`);
}

function resolveClientId(options = {}) {
  return String(options.googleSignInClientId ?? process.env.MODYCREW_GOOGLE_SIGNIN_CLIENT_ID ?? "").trim();
}

function resolveClientSecret(options = {}) {
  return String(
    options.googleSignInClientSecret ?? process.env.MODYCREW_GOOGLE_SIGNIN_CLIENT_SECRET ?? "",
  ).trim();
}

async function startGoogleSignIn(options) {
  const clientId = resolveClientId(options);
  if (!clientId) {
    return {
      status: "google_signin_client_required",
      userMessage:
        "구글 로그인 설정이 아직 없습니다. GCP 콘솔에서 데스크톱 앱 OAuth 클라이언트를 만들어 MODYCREW_GOOGLE_SIGNIN_CLIENT_ID 로 넣으면 바로 켜집니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (activeSession && Date.now() - activeSession.startedAt < signInExternalLaunchCooldownMs) {
    return {
      status: "google_signin_in_progress",
      userMessage:
        "구글 로그인 창은 이미 한 번 열었습니다. 새 창을 또 만들지 않고, 열린 브라우저에서 인증을 마친 뒤 앱으로 돌아와 주세요.",
      authorizationUrl: activeSession.authorizationUrl,
      externalUrlOpened: false,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (activeSession) {
    activeSession.cancel("이전 구글 로그인 세션이 만료되어 새로 시작합니다.");
    activeSession = null;
  }

  const state = base64Url(crypto.randomBytes(24));
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        server.close();
      } catch {
        // already closed
      }
      if (activeSession?.token === sessionToken) activeSession = null;
      resolve({
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: result.status === "google_signin_ready",
        ...result,
      });
    };

    const sessionToken = crypto.randomUUID();
    const timeout = setTimeout(() => {
      finish({
        status: "google_signin_timeout",
        userMessage: "구글 로그인 응답이 시간 안에 오지 않았습니다. 다시 시도해 주세요.",
      });
    }, signInTimeoutMs);

    const server = createServer(async (req, res) => {
      try {
        const port = server.address()?.port;
        const requestUrl = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        if (requestUrl.pathname !== callbackPath) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(renderResultPage("오류", "구글 로그인 callback 경로가 아닙니다.", false));
          return;
        }
        const receivedState = requestUrl.searchParams.get("state") ?? "";
        const code = requestUrl.searchParams.get("code") ?? "";
        const oauthError = requestUrl.searchParams.get("error") ?? "";
        if (oauthError) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(renderResultPage("로그인 취소", "구글 로그인이 취소되었거나 거부되었습니다.", false));
          finish({
            status: "google_signin_denied",
            userMessage: "구글 로그인이 취소되었습니다. 앱에서 다시 시도할 수 있습니다.",
          });
          return;
        }
        if (!receivedState || receivedState !== state || !code) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(renderResultPage("오류", "인증 상태값이 맞지 않습니다. 앱에서 다시 시도해 주세요.", false));
          finish({
            status: "google_signin_state_mismatch",
            userMessage: "구글 로그인 검증값이 맞지 않아 중단했습니다. 다시 시도해 주세요.",
          });
          return;
        }

        const redirectUri = `http://127.0.0.1:${port}${callbackPath}`;
        const tokenBody = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        });
        const clientSecret = resolveClientSecret(options);
        if (clientSecret) tokenBody.set("client_secret", clientSecret);

        const fetchFn = options.fetch ?? globalThis.fetch;
        const response = await fetchFn(googleTokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: tokenBody.toString(),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.id_token) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(renderResultPage("연결 실패", "구글 토큰 교환에 실패했습니다. 앱에서 다시 시도해 주세요.", false));
          finish({
            status: "google_signin_token_failed",
            userMessage: `구글 토큰 교환에 실패했습니다. (${json?.error ?? response.status})`,
          });
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderResultPage("로그인 완료", "ModyCrew 앱으로 돌아가면 로그인됩니다.", true));
        finish({
          status: "google_signin_ready",
          idToken: String(json.id_token),
          userMessage: "구글 인증이 끝났습니다. 앱에서 로그인 마무리 중입니다.",
        });
      } catch (error) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderResultPage("연결 실패", "구글 로그인 처리 중 오류가 발생했습니다.", false));
        finish({
          status: "google_signin_failed",
          userMessage: error instanceof Error ? error.message : "구글 로그인 처리 중 오류가 발생했습니다.",
        });
      }
    });

    server.once("error", (error) => {
      finish({
        status: "google_signin_server_failed",
        userMessage: `로컬 로그인 수신 서버를 열지 못했습니다: ${error?.message ?? error}`,
      });
    });

    // 포트 0 = OS 가 빈 포트 배정. 데스크톱 앱 클라이언트는 임의 루프백 포트를 허용합니다.
    server.listen(0, "127.0.0.1", async () => {
      const port = server.address()?.port;
      const redirectUri = `http://127.0.0.1:${port}${callbackPath}`;
      const url = new URL(googleAuthUrl);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", googleScope);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", state);
      url.searchParams.set("access_type", "online");
      url.searchParams.set("prompt", "select_account");

      activeSession = {
        token: sessionToken,
        startedAt: Date.now(),
        authorizationUrl: url.toString(),
        cancel: (message) =>
          finish({ status: "google_signin_cancelled", userMessage: message }),
      };

      const opened = await options.shell?.openExternal?.(url.toString());
      if (!opened) {
        finish({
          status: "google_signin_browser_failed",
          userMessage: "기본 브라우저를 열지 못했습니다.",
        });
      }
    });
  });
}

function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function renderResultPage(title, message, success) {
  const accent = success ? "#16a34a" : "#dc2626";
  return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ModyCrew Google Login</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#f5f5f5;font-family:ui-sans-serif,system-ui,"Segoe UI",sans-serif}
main{width:min(420px,calc(100vw - 40px));padding:28px;border:1px solid #2f2f2f;border-radius:14px;background:#1b1b1b}
i{width:12px;height:12px;display:inline-block;border-radius:999px;background:${accent};margin-right:8px}
h1{font-size:18px;margin:0 0 8px}p{margin:0;color:#c9c9c9;line-height:1.5}
</style></head>
<body><main><h1><i></i>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
