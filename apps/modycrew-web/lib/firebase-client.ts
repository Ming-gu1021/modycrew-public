/**
 * Firebase Auth lazy 초기화.
 *
 * 정적 import 대신 dynamic import 를 사용해 다음을 보장합니다.
 *  - First Load JS 에 firebase SDK (약 200KB) 가 포함되지 않음
 *  - 로그인/회원가입 UI 가 실제 클릭되거나 세션 복원 시점에만 SDK 로드
 *  - SSR/static export 단계에서 firebase 가 실행되지 않음
 *
 * 또한 Electron 환경에서는 main process 가 자체적으로 Firebase Auth 를 다루는
 * IPC 가 있을 수 있으므로 `window.modyCrewAccount` 가 있으면 그쪽을 우선합니다.
 */

import type { Auth, User, UserCredential } from "firebase/auth";
import { readFirebaseClientConfig, type ModyFirebaseClientConfig } from "./firebase-config";

declare global {
  interface Window {
    modyCrewAccount?: {
      status?: () => Promise<{
        status?: string;
        session?: ModyAuthSession | null;
        uid?: string;
        email?: string;
        displayName?: string;
        providerId?: string;
        emailVerified?: boolean;
      }>;
      googleSignInStatus?: () => Promise<{ status?: string; configured?: boolean }>;
      startGoogleSignIn?: () => Promise<{
        status?: string;
        idToken?: string;
        userMessage?: string;
      }>;
    };
  }
}

type FirebaseRuntime = {
  app: import("firebase/app").FirebaseApp;
  auth: Auth;
};

let runtimePromise: Promise<FirebaseRuntime | null> | null = null;

async function loadFirebaseRuntime(): Promise<FirebaseRuntime | null> {
  if (typeof window === "undefined") return null;

  const status = readFirebaseClientConfig();
  if (!status.ready) {
    console.warn(
      `[modycrew] Firebase 설정 누락: ${status.missing.join(", ")} — .env.local 확인`,
    );
    return null;
  }

  const [{ initializeApp, getApps, getApp }, { getAuth }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);

  const existing = getApps().find((item) => item.name === "modycrew-web");
  const app = existing ?? initializeApp(status.config as ModyFirebaseClientConfig, "modycrew-web");
  const auth = getAuth(app);

  return { app, auth };
}

function getRuntime(): Promise<FirebaseRuntime | null> {
  if (!runtimePromise) {
    runtimePromise = loadFirebaseRuntime();
  }
  return runtimePromise;
}

export type ModyAuthSession = {
  uid: string;
  email: string;
  displayName: string;
  providerId: string;
  emailVerified: boolean;
};

export type FirebaseAuthReadiness =
  | {
      status: "configured";
      projectId: string;
      authDomain: string;
      currentHost: string;
      provider: "email_password";
      userMessage: string;
    }
  | {
      status: "missing_config";
      missing: string[];
      provider: "email_password";
      userMessage: string;
    }
  | {
      status: "sdk_error";
      projectId?: string;
      authDomain?: string;
      currentHost: string;
      provider: "email_password";
      userMessage: string;
    };

function toSession(user: User | null): ModyAuthSession | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email ?? "",
    displayName: user.displayName ?? "",
    providerId: user.providerData[0]?.providerId ?? "password",
    emailVerified: user.emailVerified,
  };
}

function isDesktopAppRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.modyCrewAccount) || Boolean((window as { modyCrewDesktopBridge?: unknown }).modyCrewDesktopBridge);
}

async function readDesktopAccountSession(): Promise<ModyAuthSession | null> {
  if (typeof window === "undefined") return null;
  const accountBridge = window.modyCrewAccount;
  if (typeof accountBridge?.status !== "function") return null;
  try {
    const result = await accountBridge.status();
    const candidate = result.session ?? result;
    if (!candidate?.uid) return null;
    return {
      uid: String(candidate.uid),
      email: String(candidate.email ?? ""),
      displayName: String(candidate.displayName ?? ""),
      providerId: String(candidate.providerId ?? "desktop"),
      emailVerified: Boolean(candidate.emailVerified),
    };
  } catch {
    return null;
  }
}

export function formatFirebaseAuthError(error: unknown): string {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";

  if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
    return "이메일 또는 비밀번호가 맞지 않습니다.";
  }
  if (code === "auth/user-not-found") return "가입된 계정을 찾지 못했습니다.";
  if (code === "auth/email-already-in-use") return "이미 가입된 이메일입니다. 로그인으로 진행해 주세요.";
  if (code === "auth/weak-password") return "비밀번호는 8자 이상으로 입력해 주세요.";
  if (code === "auth/invalid-email") return "이메일 형식을 확인해 주세요.";
  if (code === "auth/network-request-failed") {
    return "계정 서버에 연결하지 못했습니다. 인터넷 연결 또는 방화벽을 확인해 주세요.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Email/Password 로그인이 Firebase Console에서 아직 켜져 있지 않습니다.";
  }

  return error instanceof Error ? error.message : "계정 처리에 실패했습니다.";
}

export async function getFirebaseAuthReadiness(): Promise<FirebaseAuthReadiness> {
  const status = readFirebaseClientConfig();
  const currentHost = typeof window === "undefined" ? "" : window.location.host;
  if (!status.ready) {
    return {
      status: "missing_config",
      missing: status.missing,
      provider: "email_password",
      userMessage: "Firebase 공개 설정값이 없어 로그인 API를 시작할 수 없습니다.",
    };
  }

  try {
    const runtime = await getRuntime();
    if (!runtime) {
      return {
        status: "sdk_error",
        projectId: status.config.projectId,
        authDomain: status.config.authDomain,
        currentHost,
        provider: "email_password",
        userMessage: "Firebase Auth SDK를 초기화하지 못했습니다.",
      };
    }
    return {
      status: "configured",
      projectId: status.config.projectId,
      authDomain: status.config.authDomain,
      currentHost,
      provider: "email_password",
      userMessage:
        "Email/Password 로그인 API를 호출할 준비가 됐습니다. 콘솔에서 provider가 꺼져 있으면 로그인 시 안내가 뜹니다.",
    };
  } catch (error) {
    return {
      status: "sdk_error",
      projectId: status.config.projectId,
      authDomain: status.config.authDomain,
      currentHost,
      provider: "email_password",
      userMessage: error instanceof Error ? error.message : "Firebase Auth SDK 확인에 실패했습니다.",
    };
  }
}

// 이 인증은 ModyCrew 계정 신원만 생성합니다. Gmail/회사/학교 메일함은 가입 후
// 별도 커넥터에서 사용자가 직접 연결하며, 여기서는 메일함을 생성하거나 자동 연결하지 않습니다.
export async function signUpWithEmailPassword(
  email: string,
  password: string,
  displayName?: string,
  options?: { autoLogin?: boolean },
): Promise<ModyAuthSession> {
  const runtime = await getRuntime();
  if (!runtime) throw new Error("Firebase 미설정 — 회원가입을 진행할 수 없습니다.");

  const {
    browserLocalPersistence,
    browserSessionPersistence,
    createUserWithEmailAndPassword,
    setPersistence,
    updateProfile,
  } = await import(
    "firebase/auth"
  );
  // 설치 앱에서는 항상 영구 저장을 사용합니다. 예전에는 "자동로그인" 체크를 끄면
  // 세션 전용 저장이 영구 기본값으로 굳어져, 이후 모든 로그인이 앱 재시작 시
  // 풀리는 문제("로그인 유지가 안 됨")가 있었습니다. 자동로그인 끔은 이제
  // 시작 시 자동 이동만 건너뛰고, 로그인 유지 자체는 유지합니다.
  await setPersistence(
    runtime.auth,
    !isDesktopAppRuntime() && options?.autoLogin === false
      ? browserSessionPersistence
      : browserLocalPersistence,
  );
  const credential: UserCredential = await createUserWithEmailAndPassword(
    runtime.auth,
    email,
    password,
  );
  if (displayName?.trim()) {
    await updateProfile(credential.user, { displayName: displayName.trim() });
  }
  const session = toSession(credential.user);
  if (!session) throw new Error("회원가입 결과를 읽을 수 없습니다.");
  return session;
}

export async function signInWithEmailPassword(
  email: string,
  password: string,
  options?: { autoLogin?: boolean },
): Promise<ModyAuthSession> {
  const runtime = await getRuntime();
  if (!runtime) throw new Error("Firebase 미설정 — 로그인을 진행할 수 없습니다.");

  const {
    browserLocalPersistence,
    browserSessionPersistence,
    setPersistence,
    signInWithEmailAndPassword,
  } = await import("firebase/auth");
  // 설치 앱에서는 항상 영구 저장을 사용합니다. 예전에는 "자동로그인" 체크를 끄면
  // 세션 전용 저장이 영구 기본값으로 굳어져, 이후 모든 로그인이 앱 재시작 시
  // 풀리는 문제("로그인 유지가 안 됨")가 있었습니다. 자동로그인 끔은 이제
  // 시작 시 자동 이동만 건너뛰고, 로그인 유지 자체는 유지합니다.
  await setPersistence(
    runtime.auth,
    !isDesktopAppRuntime() && options?.autoLogin === false
      ? browserSessionPersistence
      : browserLocalPersistence,
  );
  const credential = await signInWithEmailAndPassword(runtime.auth, email, password);
  const session = toSession(credential.user);
  if (!session) throw new Error("로그인 결과를 읽을 수 없습니다.");
  return session;
}

/**
 * 구글 로그인 마무리 — 데스크톱 메인 프로세스의 외부 브라우저 OAuth 가 받아온
 * Google ID 토큰으로 Firebase 에 로그인합니다. signInWithCredential 은 REST 호출이라
 * modycrew:// 커스텀 프로토콜에서도 동작하며, 이메일 로그인과 동일하게 세션이 유지됩니다.
 */
export async function signInWithGoogleIdToken(idToken: string): Promise<ModyAuthSession> {
  const runtime = await getRuntime();
  if (!runtime) throw new Error("Firebase 미설정 — 구글 로그인을 진행할 수 없습니다.");
  const token = String(idToken ?? "").trim();
  if (!token) throw new Error("구글 인증 토큰이 비어 있습니다.");

  const { GoogleAuthProvider, browserLocalPersistence, setPersistence, signInWithCredential } =
    await import("firebase/auth");
  await setPersistence(runtime.auth, browserLocalPersistence);
  const credential = await signInWithCredential(runtime.auth, GoogleAuthProvider.credential(token));
  const session = toSession(credential.user);
  if (!session) throw new Error("구글 로그인 결과를 읽을 수 없습니다.");
  return session;
}

export async function signOutCurrent(): Promise<void> {
  const runtime = await getRuntime();
  if (!runtime) return;
  const { signOut } = await import("firebase/auth");
  await signOut(runtime.auth);
}

export async function getCurrentSession(): Promise<ModyAuthSession | null> {
  const desktopSession = await readDesktopAccountSession();
  if (desktopSession) return desktopSession;
  const runtime = await getRuntime();
  if (!runtime) return null;
  return toSession(runtime.auth.currentUser);
}

export async function getFirebaseClientApp(): Promise<FirebaseRuntime["app"] | null> {
  const runtime = await getRuntime();
  return runtime?.app ?? null;
}

export async function onAuthSession(
  callback: (session: ModyAuthSession | null) => void,
): Promise<() => void> {
  const desktopSession = await readDesktopAccountSession();
  if (desktopSession) {
    callback(desktopSession);
    return () => undefined;
  }
  const runtime = await getRuntime();
  if (!runtime) {
    callback(null);
    return () => undefined;
  }
  const { onAuthStateChanged } = await import("firebase/auth");
  return onAuthStateChanged(runtime.auth, (user) => callback(toSession(user)));
}

export function isFirebaseConfigured(): boolean {
  return readFirebaseClientConfig().ready;
}
