/**
 * 온보딩 / 진입 플로우 상태.
 *
 * localStorage 키만 사용 (인증 토큰/세키 비밀 금지).
 * `verify:security` 가 token/jwt/session/auth/refresh 같은 키를 차단하므로
 * "mc:signed-in", "mc:setup-done" 같은 단순 boolean 만 둡니다.
 *
 * 실제 인증 상태는 Firebase Auth (firebase-client.ts) 의 onAuthStateChanged
 * 가 source of truth. 이 lib 은 "환영 화면 → 셋업 → 메인" 라우팅에 쓰는
 * 클라이언트 hint 입니다.
 */

const KEY_SIGNED_IN = "mc:signed-in";
const KEY_SETUP_DONE = "mc:setup-done";
const KEY_SETUP_STEP = "mc:setup-step";
const KEY_SETUP_BASE = "mc:setup-base-picked";
const KEY_SETUP_AI = "mc:setup-ai-picked";
const KEY_SETUP_TOOL = "mc:setup-tool-picked";
const KEY_SETUP_WORK_MODE = "mc:setup-work-mode";
const KEY_SETUP_TOOL_MODE = "mc:setup-tool-mode";

function safeRead(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 무시 — private mode 등 */
  }
}

function safeRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 무시 */
  }
}

export function isSignedIn(): boolean {
  return safeRead(KEY_SIGNED_IN) === "true";
}

export function markSignedIn(value: boolean): void {
  if (value) safeWrite(KEY_SIGNED_IN, "true");
  else safeRemove(KEY_SIGNED_IN);
}

export function isSetupDone(): boolean {
  // 기본 설정 마법사(업무→연결→완료)는 더 이상 강제하지 않습니다.
  // 로그인 직후·welcome 에서 항상 메인 채팅 화면(`/`)으로 바로 진입하도록
  // setup 은 "완료된 것"으로 간주합니다. /setup 페이지 자체는 남아 있어
  // 필요하면 직접 접근할 수 있습니다.
  return true;
}

export function markSetupDone(value: boolean): void {
  if (value) safeWrite(KEY_SETUP_DONE, "true");
  else safeRemove(KEY_SETUP_DONE);
}

export function getSetupStep(): number {
  const raw = safeRead(KEY_SETUP_STEP);
  const n = raw ? Number(raw) : 1;
  return Number.isFinite(n) && n >= 1 && n <= 3 ? n : 1;
}

export function setSetupStep(step: 1 | 2 | 3): void {
  safeWrite(KEY_SETUP_STEP, String(step));
}

export function markBasePicked(value: boolean): void {
  if (value) safeWrite(KEY_SETUP_BASE, "true");
  else {
    safeRemove(KEY_SETUP_BASE);
    safeRemove(KEY_SETUP_WORK_MODE);
  }
}

export function isBasePicked(): boolean {
  return safeRead(KEY_SETUP_BASE) === "true" || safeRead(KEY_SETUP_AI) === "true";
}

export function markAiPicked(value: boolean): void {
  markBasePicked(value);
}

export function isAiPicked(): boolean {
  return isBasePicked();
}

export function markToolPicked(value: boolean): void {
  if (value) safeWrite(KEY_SETUP_TOOL, "true");
  else {
    safeRemove(KEY_SETUP_TOOL);
    safeRemove(KEY_SETUP_TOOL_MODE);
  }
}

export function isToolPicked(): boolean {
  return safeRead(KEY_SETUP_TOOL) === "true";
}

export function getSetupWorkMode(): string {
  return safeRead(KEY_SETUP_WORK_MODE) ?? "";
}

export function setSetupWorkMode(value: string): void {
  const normalized = value.trim();
  if (normalized) safeWrite(KEY_SETUP_WORK_MODE, normalized);
  else safeRemove(KEY_SETUP_WORK_MODE);
}

export function getSetupToolMode(): string {
  return safeRead(KEY_SETUP_TOOL_MODE) ?? "";
}

export function setSetupToolMode(value: string): void {
  const normalized = value.trim();
  if (normalized) safeWrite(KEY_SETUP_TOOL_MODE, normalized);
  else safeRemove(KEY_SETUP_TOOL_MODE);
}

export function resetOnboarding(): void {
  safeRemove(KEY_SIGNED_IN);
  safeRemove(KEY_SETUP_DONE);
  safeRemove(KEY_SETUP_STEP);
  safeRemove(KEY_SETUP_BASE);
  safeRemove(KEY_SETUP_AI);
  safeRemove(KEY_SETUP_TOOL);
  safeRemove(KEY_SETUP_WORK_MODE);
  safeRemove(KEY_SETUP_TOOL_MODE);
}
