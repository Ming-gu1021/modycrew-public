"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  isFirebaseConfigured,
  formatFirebaseAuthError,
  onAuthSession,
  signInWithEmailPassword,
  signInWithGoogleIdToken,
  signOutCurrent,
  signUpWithEmailPassword,
  type ModyAuthSession,
} from "@/lib/firebase-client";
import { readAuthPreferences, saveAuthPreferences } from "@/lib/auth-preferences";
import { isSetupDone, markSignedIn } from "@/lib/onboarding";
import { navigateInternalPath } from "@/lib/safe-navigation";
import { changeAccountPassword, formatPasswordError, sendAccountPasswordReset } from "@/lib/account-password";
import styles from "./AccountCard.module.css";

type Mode = "signin" | "signup";

type AccountCardProps = {
  variant?: "default" | "login";
  showSignOut?: boolean;
};

export function AccountCard({ variant = "default", showSignOut = true }: AccountCardProps) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [rememberEmail, setRememberEmail] = useState(false);
  const [autoLogin, setAutoLogin] = useState(true);
  const [session, setSession] = useState<ModyAuthSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [configured, setConfigured] = useState(true);
  // 관리자가 만든 임시 비밀번호를 직원이 직접 바꾸는 칸(로그인한 뒤에만 보임)
  const [passwordChange, setPasswordChange] = useState({ current: "", next: "", again: "" });
  const [passwordMessage, setPasswordMessage] = useState("");

  useEffect(() => {
    const preferences = readAuthPreferences();
    setRememberEmail(preferences.rememberEmail);
    setAutoLogin(preferences.autoLogin);
    if (preferences.rememberedEmail) {
      setEmail(preferences.rememberedEmail);
      setMode("signin");
    }
    setConfigured(isFirebaseConfigured());
    let unsubscribe: (() => void) | undefined;
    void onAuthSession((s) => setSession(s)).then((u) => {
      unsubscribe = u;
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "signup") {
        if (password.length < 8) {
          setMessage("회원가입 비밀번호는 8자 이상으로 입력해 주세요.");
          return;
        }
        if (password !== confirmPassword) {
          setMessage("비밀번호 확인이 서로 다릅니다.");
          return;
        }
      }
      const s =
        mode === "signin"
          ? await signInWithEmailPassword(email, password, { autoLogin })
          : await signUpWithEmailPassword(email, password, displayName, { autoLogin });
      saveAuthPreferences({ email: s.email || email, rememberEmail, autoLogin });
      markSignedIn(true);
      setSession(s);
      setMessage(`${mode === "signin" ? "로그인" : "회원가입"} 성공 — ${s.email}`);
      setPassword("");
      setConfirmPassword("");
      navigateInternalPath(isSetupDone() ? "/" : "/setup");
    } catch (err) {
      setMessage(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  // 구글 로그인 — 데스크톱 앱에서만 가능(외부 브라우저 OAuth → ID 토큰 → Firebase).
  const googleSignInAvailable =
    typeof window !== "undefined" && typeof window.modyCrewAccount?.startGoogleSignIn === "function";
  const signupPasswordTooShort = mode === "signup" && password.length < 8;
  const signupPasswordMismatch = mode === "signup" && password !== confirmPassword;
  const canSubmit =
    !busy &&
    Boolean(email.trim()) &&
    Boolean(password) &&
    (mode === "signin" || (!signupPasswordTooShort && !signupPasswordMismatch));

  const handleGoogleSignIn = async () => {
    const startGoogleSignIn = window.modyCrewAccount?.startGoogleSignIn;
    if (!startGoogleSignIn) return;
    setBusy(true);
    setMessage("브라우저에서 구글 로그인을 진행해 주세요...");
    try {
      const result = await startGoogleSignIn();
      if (result?.status !== "google_signin_ready" || !result.idToken) {
        setMessage(result?.userMessage || "구글 로그인을 완료하지 못했습니다.");
        return;
      }
      const s = await signInWithGoogleIdToken(result.idToken);
      saveAuthPreferences({ email: s.email, rememberEmail, autoLogin: true });
      markSignedIn(true);
      setSession(s);
      setMessage(`구글 로그인 성공 — ${s.email}`);
      navigateInternalPath(isSetupDone() ? "/" : "/setup");
    } catch (err) {
      setMessage(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const passwordChangeMismatch = passwordChange.again.length > 0 && passwordChange.next !== passwordChange.again;
  const canChangePassword =
    !busy &&
    Boolean(passwordChange.current) &&
    passwordChange.next.length >= 8 &&
    passwordChange.next === passwordChange.again;

  const handlePasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canChangePassword) return;
    setBusy(true);
    setPasswordMessage("");
    try {
      await changeAccountPassword(passwordChange.current, passwordChange.next);
      setPasswordChange({ current: "", next: "", again: "" });
      setPasswordMessage("비밀번호를 바꿨어요. 다음 로그인부터 새 비밀번호를 쓰면 돼요.");
    } catch (err) {
      setPasswordMessage(formatPasswordError(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!email.trim()) {
      setMessage("이메일 칸에 가입한 이메일을 적은 뒤 다시 눌러 주세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await sendAccountPasswordReset(email);
      setMessage(`${email.trim()}로 비밀번호를 다시 정하는 메일을 보냈어요. 메일의 링크에서 새 비밀번호를 정해 주세요. 메일이 안 보이면 스팸함도 확인해 주세요.`);
    } catch (err) {
      setMessage(formatPasswordError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOutCurrent();
      markSignedIn(false);
      setSession(null);
      setMessage("로그아웃됨");
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <article className={styles.card} data-variant={variant}>
        <header className={styles.head}>
          <h2>로그인 준비가 필요합니다</h2>
        </header>
        <p className={styles.warning}>
          계정 로그인을 아직 시작할 수 없습니다. 설치/개발 설정에서 로그인 연결값을 먼저 확인해 주세요.
        </p>
      </article>
    );
  }

  if (session) {
    return (
      <article className={styles.card} data-variant={variant}>
        <header className={styles.head}>
          <h2>{session.displayName || session.email}</h2>
          <p className={styles.subtle}>{session.email}</p>
        </header>
        <section className={styles.sessionPanel} aria-label="내 프로필 로그인 상태">
          <div>
            <span>현재 로그인</span>
            <strong>{session.emailVerified ? "계정 확인됨" : "로그인 세션 활성"}</strong>
            <small>앱 설정과 업무실 동기화는 이 계정 기준으로 저장됩니다.</small>
          </div>
          {showSignOut ? (
            <button
              type="button"
              className={styles.signOutButton}
              onClick={handleSignOut}
              disabled={busy}
            >
              {busy ? "로그아웃 중..." : "로그아웃"}
            </button>
          ) : null}
        </section>
        <details className={styles.advancedBox}>
          <summary>로그인 정보 보기</summary>
          <dl className={styles.meta}>
            <div>
              <dt>로그인 방식</dt>
              <dd>{authProviderLabel(session.providerId)}</dd>
            </div>
            <div>
              <dt>로그인 확인</dt>
              <dd>{session.emailVerified ? "이메일 인증됨" : "세션 확인됨"}</dd>
            </div>
          </dl>
        </details>
        {session.providerId === "password" ? (
          <details className={styles.advancedBox} data-account-password-change="self_service_reauthenticate">
            <summary>비밀번호 바꾸기</summary>
            <form className={styles.form} onSubmit={handlePasswordChange}>
              <label className={styles.field}>
                <span>지금 쓰는 비밀번호</span>
                <input
                  type="password"
                  name="currentPassword"
                  autoComplete="current-password"
                  value={passwordChange.current}
                  onChange={(e) => setPasswordChange((value) => ({ ...value, current: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                <span>새 비밀번호 (8자 이상)</span>
                <input
                  type="password"
                  name="newPassword"
                  autoComplete="new-password"
                  value={passwordChange.next}
                  onChange={(e) => setPasswordChange((value) => ({ ...value, next: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                <span>새 비밀번호 한 번 더</span>
                <input
                  type="password"
                  name="newPasswordAgain"
                  autoComplete="new-password"
                  value={passwordChange.again}
                  onChange={(e) => setPasswordChange((value) => ({ ...value, again: e.target.value }))}
                  aria-invalid={passwordChangeMismatch}
                />
              </label>
              <button type="submit" className={styles.primary} disabled={!canChangePassword}>
                {busy ? "바꾸는 중..." : "새 비밀번호로 바꾸기"}
              </button>
              <small className={styles.subtle}>회사 관리자가 만들어 준 임시 비밀번호라면 처음 로그인한 뒤 꼭 바꿔 주세요.</small>
            </form>
            {passwordMessage ? <p className={styles.status} role="status">{passwordMessage}</p> : null}
          </details>
        ) : null}
        {message ? <p className={styles.status}>{message}</p> : null}
      </article>
    );
  }

  return (
    <article className={styles.card} data-variant={variant}>
      <header className={styles.head}>
        <h2>{mode === "signin" ? "로그인" : "회원가입"}</h2>
      </header>

      <form
        className={styles.form}
        data-modycrew-account-auth="firebase_email_password_account_identity"
        data-mail-connector-boundary="separate_after_signup_never_auto_linked"
        onSubmit={handleSubmit}
      >
        {mode === "signup" ? (
          <label className={styles.field}>
            <span>이름 (선택)</span>
            <input
              type="text"
              name="displayName"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
        ) : null}
        <label className={styles.field}>
          <span>이메일</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>{mode === "signin" ? "비밀번호" : "비밀번호 (8자 이상)"}</span>
          <input
            type="password"
            name="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {mode === "signup" ? (
          <label className={styles.field}>
            <span>비밀번호 확인</span>
            <input
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={confirmPassword.length > 0 && password !== confirmPassword}
            />
          </label>
        ) : null}

        <button
          type="submit"
          className={styles.primary}
          disabled={!canSubmit}
        >
          {busy ? "처리 중..." : mode === "signin" ? "로그인" : "회원가입"}
        </button>

        {mode === "signin" ? (
          <button type="button" className={styles.textButton} onClick={handlePasswordReset} disabled={busy}>
            비밀번호를 잊었어요
          </button>
        ) : null}
      </form>

      {message ? <p className={styles.status}>{message}</p> : null}

      <details className={styles.loginAlternatives} aria-label="다른 로그인 방법과 옵션">
        <summary>다른 방법</summary>
        <div className={styles.loginAlternativeBody}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setMessage("");
            }}
          >
            {mode === "signin" ? "회원가입" : "로그인으로 돌아가기"}
          </button>

          {mode === "signin" && googleSignInAvailable ? (
            <button
              type="button"
              className={styles.secondary}
              data-provider="google"
              onClick={handleGoogleSignIn}
              disabled={busy}
            >
              Google로 계속하기
            </button>
          ) : null}

          {mode === "signin" ? (
            <div className={styles.loginOptions} aria-label="로그인 유지 설정">
              <label className={styles.checkOption}>
                <input
                  type="checkbox"
                  checked={rememberEmail}
                  onChange={(e) => setRememberEmail(e.target.checked)}
                />
                <span>아이디 기억하기</span>
              </label>
              <label className={styles.checkOption}>
                <input
                  type="checkbox"
                  checked={autoLogin}
                  onChange={(e) => setAutoLogin(e.target.checked)}
                />
                <span>자동로그인</span>
              </label>
            </div>
          ) : null}
        </div>
      </details>
    </article>
  );
}

function authProviderLabel(providerId: string): string {
  if (providerId === "password") return "이메일 로그인";
  if (providerId === "google.com") return "Google 로그인";
  if (providerId === "github.com") return "GitHub 로그인";
  if (providerId === "microsoft.com") return "Microsoft 로그인";
  if (providerId === "apple.com") return "Apple 로그인";
  return "로그인 연결";
}
