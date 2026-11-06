"use client";

import { getFirebaseClientApp } from "./firebase-client";

/**
 * Password self-service for email accounts. An administrator who created an employee
 * account knows the temporary password, so the employee must be able to replace it.
 */
async function currentAuth() {
  const app = await getFirebaseClientApp();
  if (!app) throw new Error("로그인 설정을 확인하지 못했어요. 앱을 다시 열어 주세요.");
  const firebaseAuth = await import("firebase/auth");
  const auth = firebaseAuth.getAuth(app);
  await auth.authStateReady();
  return { auth, firebaseAuth };
}

export async function changeAccountPassword(currentPassword: string, nextPassword: string): Promise<void> {
  if (!currentPassword) throw new Error("지금 쓰는 비밀번호를 입력해 주세요.");
  if (nextPassword.length < 8 || nextPassword.length > 128) throw new Error("새 비밀번호는 8자 이상으로 정해 주세요.");
  if (nextPassword === currentPassword) throw new Error("지금과 다른 새 비밀번호를 정해 주세요.");
  const { auth, firebaseAuth } = await currentAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("로그인 상태를 확인하지 못했어요. 로그아웃한 뒤 다시 로그인하고 바꿔 주세요.");
  if (!user.email || !user.providerData.some((provider) => provider.providerId === "password")) {
    throw new Error("이메일로 가입한 계정에서만 비밀번호를 바꿀 수 있어요.");
  }
  // Firebase requires a fresh sign-in before a password change; confirming the old one also stops a borrowed session.
  await firebaseAuth.reauthenticateWithCredential(user, firebaseAuth.EmailAuthProvider.credential(user.email, currentPassword));
  await firebaseAuth.updatePassword(user, nextPassword);
}

export async function sendAccountPasswordReset(email: string): Promise<void> {
  const address = email.trim();
  if (!address) throw new Error("비밀번호를 다시 정할 이메일 주소를 먼저 입력해 주세요.");
  const { auth, firebaseAuth } = await currentAuth();
  await firebaseAuth.sendPasswordResetEmail(auth, address);
}

export function formatPasswordError(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password") return "지금 쓰는 비밀번호가 맞지 않아요.";
  if (code === "auth/too-many-requests") return "여러 번 시도해서 잠시 막혔어요. 몇 분 뒤 다시 해 주세요.";
  if (code === "auth/weak-password") return "새 비밀번호는 8자 이상으로 정해 주세요.";
  if (code === "auth/requires-recent-login") return "보안을 위해 로그아웃한 뒤 다시 로그인하고 바꿔 주세요.";
  if (code === "auth/invalid-email") return "이메일 형식을 확인해 주세요.";
  if (code === "auth/missing-email") return "비밀번호를 다시 정할 이메일 주소를 먼저 입력해 주세요.";
  if (code === "auth/network-request-failed") return "인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
  return error instanceof Error && error.message ? error.message : "비밀번호를 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
}
