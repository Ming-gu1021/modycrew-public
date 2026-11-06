"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatFirebaseAuthError,
  getFirebaseAuthReadiness,
  isFirebaseConfigured,
  onAuthSession,
  signInWithEmailPassword,
  signInWithGoogleIdToken,
  signOutCurrent,
  signUpWithEmailPassword,
  type ModyAuthSession,
  type FirebaseAuthReadiness,
} from "@/lib/firebase-client";
import { readAuthPreferences, saveAuthPreferences } from "@/lib/auth-preferences";
import { isSetupDone, markSignedIn, resetOnboarding } from "@/lib/onboarding";
import styles from "./page.module.css";

type Mode = "signin" | "signup";

export default function WelcomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [rememberEmail, setRememberEmail] = useState(false);
  const [autoLogin, setAutoLogin] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<ModyAuthSession | null>(null);
  const [configured, setConfigured] = useState(true);
  const [authReadiness, setAuthReadiness] = useState<FirebaseAuthReadiness | null>(null);

  const nextHref = useMemo(() => (isSetupDone() ? "/" : "/setup"), []);

  useEffect(() => {
    const preferences = readAuthPreferences();
    setRememberEmail(preferences.rememberEmail);
    setAutoLogin(preferences.autoLogin);
    if (preferences.rememberedEmail) setEmail(preferences.rememberedEmail);
    setConfigured(isFirebaseConfigured());
    void getFirebaseAuthReadiness().then(setAuthReadiness);

    let unsub: (() => void) | undefined;
    void onAuthSession((currentSession) => setSession(currentSession)).then((nextUnsub) => {
      unsub = nextUnsub;
    });
    return () => unsub?.();
  }, []);

  const continueAfterAuth = () => {
    markSignedIn(true);
    router.replace(isSetupDone() ? "/" : "/setup");
  };

  const googleSignInAvailable =
    typeof window !== "undefined" && typeof window.modyCrewAccount?.startGoogleSignIn === "function";
  const signupPasswordTooShort = mode === "signup" && password.length < 8;
  const signupPasswordMismatch = mode === "signup" && password !== confirmPassword;
  const canSubmit =
    !busy &&
    configured &&
    Boolean(email.trim()) &&
    Boolean(password) &&
    (mode === "signin" || (!signupPasswordTooShort && !signupPasswordMismatch));

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      if (mode === "signin") {
        await signInWithEmailPassword(email, password, { autoLogin });
      } else {
        if (password.length < 8) {
          setError("회원가입 비밀번호는 8자 이상으로 입력해 주세요.");
          return;
        }
        if (password !== confirmPassword) {
          setError("비밀번호 확인이 서로 다릅니다.");
          return;
        }
        await signUpWithEmailPassword(email, password, displayName, { autoLogin });
      }
      saveAuthPreferences({ email, rememberEmail, autoLogin });
      continueAfterAuth();
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    const startGoogleSignIn = window.modyCrewAccount?.startGoogleSignIn;
    if (!startGoogleSignIn) return;
    setError("");
    setBusy(true);
    try {
      const result = await startGoogleSignIn();
      if (result?.status !== "google_signin_ready" || !result.idToken) {
        setError(result?.userMessage || "구글 로그인을 완료하지 못했습니다.");
        return;
      }
      const session = await signInWithGoogleIdToken(result.idToken);
      saveAuthPreferences({ email: session.email, rememberEmail, autoLogin: true });
      continueAfterAuth();
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.brandPane} aria-label="ModyCrew 시작">
        <div className={styles.brandLockup}>
          <span aria-hidden="true">MC</span>
          <strong>ModyCrew</strong>
        </div>
        <div className={styles.brandCopy}>
          <p className={styles.kicker}>한국형 AI 업무 오피스</p>
          <h1>로그인하면 바로 채팅으로 시작합니다.</h1>
          <p>
            첫 화면에서는 설정을 요구하지 않습니다. 대화 중 실제 연결이 필요할 때만
            필요한 연결은 앱 안에서 단계별로 켭니다.
          </p>
        </div>
        <ol className={styles.promiseList} aria-label="첫 시작 순서">
          <li>
            <span>1</span>
            <strong>로그인</strong>
            <small>계정만 확인합니다.</small>
          </li>
          <li>
            <span>2</span>
            <strong>채팅 시작</strong>
            <small>하고 싶은 일을 한 문장으로 적습니다.</small>
          </li>
          <li>
            <span>3</span>
            <strong>필요할 때만 연결</strong>
            <small>메일, 파일, 일정은 요청이 있을 때 엽니다.</small>
          </li>
        </ol>
      </section>

      <section className={styles.panel} aria-label="로그인">
        <header className={styles.panelHead}>
          <p>ModyCrew 계정</p>
          <h2>{mode === "signin" ? "로그인" : "새 계정 만들기"}</h2>
        </header>

        {session ? (
          <div className={styles.sessionNotice}>
            <strong>이미 로그인되어 있습니다</strong>
            <span>{session.email || session.displayName || "현재 계정"}</span>
            <button type="button" onClick={continueAfterAuth}>
              계속하기
            </button>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                void signOutCurrent();
                resetOnboarding();
                setSession(null);
              }}
            >
              로그아웃하고 다시 시작
            </button>
          </div>
        ) : null}

        {!configured ? (
          <div className={styles.warn}>
            <strong>로그인 설정 확인 필요</strong>
            <p>
              Firebase Email/Password 설정값이 없습니다. <code>.env.local</code>의 공개
              Firebase 값을 채운 뒤 로그인할 수 있습니다.
            </p>
          </div>
        ) : null}

        <details
          className={styles.authReadiness}
          data-state={authReadiness?.status ?? "checking"}
          aria-label="로그인 기능 상태"
        >
          <summary>
            <span>
              {authReadiness?.status === "configured"
                ? "업무실을 열 준비가 됐어요"
                : authReadiness?.status === "missing_config"
                  ? "로그인 설정 확인 필요"
                  : authReadiness?.status === "sdk_error"
                    ? "로그인 연결 확인 필요"
                    : "로그인 준비 확인 중"}
            </span>
            <small>상세 보기</small>
          </summary>
          <div>
            <strong>
              {authReadiness?.status === "configured"
                ? "로그인 엔진 준비됨"
                : authReadiness?.status === "missing_config"
                  ? "로그인 설정 필요"
                  : authReadiness?.status === "sdk_error"
                    ? "로그인 SDK 확인 필요"
                    : "로그인 상태 확인 중"}
            </strong>
            <span>Email/Password Firebase Auth</span>
          </div>
          <p>
            {authReadiness?.userMessage ??
              "Firebase 공개 설정과 브라우저 도메인을 확인하고 있습니다."}
          </p>
          {authReadiness?.status === "configured" || authReadiness?.status === "sdk_error" ? (
            <dl>
              <div>
                <dt>Project</dt>
                <dd>{authReadiness.projectId || "확인 필요"}</dd>
              </div>
              <div>
                <dt>Domain</dt>
                <dd>{authReadiness.currentHost || "local"}</dd>
              </div>
            </dl>
          ) : null}
          {authReadiness?.status === "missing_config" ? (
            <small>{authReadiness.missing.length}개 공개 설정값 누락</small>
          ) : null}
        </details>

        <div className={styles.segmented} role="tablist" aria-label="계정 모드">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signin"}
            className={mode === "signin" ? styles.activeSeg : undefined}
            onClick={() => setMode("signin")}
          >
            로그인
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            className={mode === "signup" ? styles.activeSeg : undefined}
            onClick={() => setMode("signup")}
          >
            가입
          </button>
        </div>

        <form
          data-modycrew-account-auth="firebase_email_password_account_identity"
          data-mail-connector-boundary="separate_after_signup_never_auto_linked"
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {mode === "signup" ? (
            <label className={styles.field}>
              <span>이름</span>
              <input
                name="displayName"
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="홍길동"
              />
            </label>
          ) : null}

          <label className={styles.field}>
            <span>이메일</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>

          <label className={styles.field}>
            <span>{mode === "signin" ? "비밀번호" : "비밀번호 (8자 이상)"}</span>
            <input
              name="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === "signin" ? "비밀번호" : "8자 이상"}
              minLength={mode === "signup" ? 8 : undefined}
              required
            />
          </label>

          {mode === "signup" ? (
            <label className={styles.field}>
              <span>비밀번호 확인</span>
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="한 번 더 입력"
                minLength={8}
                required
                aria-invalid={confirmPassword.length > 0 && password !== confirmPassword}
              />
            </label>
          ) : null}

          <div className={styles.options}>
            <label>
              <input
                type="checkbox"
                checked={rememberEmail}
                onChange={(event) => setRememberEmail(event.target.checked)}
              />
              <span>아이디 기억</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={autoLogin}
                onChange={(event) => setAutoLogin(event.target.checked)}
              />
              <span>자동 로그인</span>
            </label>
          </div>

          {error ? <p className={styles.error}>{error}</p> : null}

          <button
            type="submit"
            className={styles.primary}
            disabled={!canSubmit}
          >
            {busy ? "확인 중..." : mode === "signin" ? "로그인하고 업무실 열기" : "가입하고 기본 설정"}
          </button>

          {googleSignInAvailable ? (
            <button
              type="button"
              className={styles.primary}
              data-provider="google"
              onClick={handleGoogleSignIn}
              disabled={busy || !configured}
            >
              Google로 계속하기
            </button>
          ) : null}
        </form>

        <a className={styles.previewLink} href={nextHref}>
          이미 설정을 마쳤다면 업무실로 이동
        </a>
      </section>
    </div>
  );
}
