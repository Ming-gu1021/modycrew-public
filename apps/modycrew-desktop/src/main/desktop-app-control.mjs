/**
 * PC 앱 조작 — vercel-labs/agent-desktop(Apache-2.0) 공식 CLI 를 모디크루의 기존 컴퓨터 조작 흐름
 * (IPC mody.desktop-control.v1 → desktop-control-handler)에 실행 도구로 붙인다.
 *
 * 원칙(프롬프트가 아니라 이 모듈이 강제한다)
 * - 코드를 내장·재배포하지 않는다. 사용자가 공식 경로(npm install -g agent-desktop)로 설치한 실행 파일만 부른다.
 * - 화면 이미지(스크린샷)는 만들지도, 저장하지도, AI에 보내지도 않는다. 사용자가 고른 앱 창 하나의 접근성 요소
 *   (역할·이름·값·상태)만 읽는다. 비밀번호 칸의 값과 비밀키처럼 보이는 문자열은 가린다.
 * - 화면 내용(창 제목·요소 이름·값)과 열린 앱 목록은 사용자가 '화면 읽기 확인' 창에서 허용해야 대화 모델로 돌려준다.
 *   허용은 이 저장 위치·이 대화·그 창 하나에만, '이번만' 또는 10분 동안 유효하고 앱을 다시 켜면 사라진다.
 *   허용 전에는 실행기가 내부 확인용으로 읽은 화면 내용(비슷한 요소 이름·창 제목)도 모델 쪽 결과에 넣지 않는다.
 * - 조작은 '승인 → 단계마다 같은 창·같은 요소인지 다시 확인 → 한 번 실행 → 화면을 다시 읽어 확인' 순서다.
 *   승인은 실행 확인 창(사용자 클릭) 또는 승인함 카드 승인으로만 생긴다. 모델 도구 호출만으로는 실행되지 않는다.
 * - agent-desktop 이 'not_delivered'(전달 안 됨, 다시 해도 안전)라고 답한 경우만 요소를 다시 찾아 한 번 더 시도한다.
 *   그 밖의 결과는 다시 시도하지 않는다(두 번 클릭·두 번 입력 방지). 결과가 불확실하면 '결과 확인 필요'로 멈춘다.
 * - 실행 기록은 저장 위치(회사)와 대화별로 나눠 보이고, 다른 저장 위치·다른 대화의 기록은 조회·실행하지 않는다.
 *   승인함 승인도 지금 앱의 저장 위치가 요청한 곳과 같을 때만 실행한다.
 * - 실행 중 앱이 꺼지면 다음 실행 때 그 기록을 '결과 확인 필요'로 바꾸고 자동으로 다시 실행하지 않는다.
 * - 상태가 바뀔 때마다 메인 업무 이벤트(사무실 화면이 읽는 기록)를 이 모듈이 직접 고친다. 승인함 승인처럼 대화가
 *   끝난 뒤 실행돼도 업무 상태가 남은 채로 멈추지 않는다.
 *
 * 지원 범위(agent-desktop 공식 Windows 안내 기준): Windows 10 1809+ 의 로그인한 사용자 세션.
 * 잠긴 PC·UAC/로그인 같은 보안 화면·다른 사용자 세션·최소화된 창·관리자 권한 앱(UIPI)은 조작하지 않고 이유를 알린다.
 * 키 입력(type)·단축키·마우스 좌표·창 앞으로 가져오기처럼 실제 입력이나 포커스가 필요한 조작은 쓰지 않는다
 * (agent-desktop 기본값인 headless 의미 조작만 사용). macOS·Linux 는 코드 경로만 있고 검증하지 않았다.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCrewSkillPackageStore, defaultBundledCatalogPath } from "./crew-skill-packages.mjs";

export const desktopAppActionSchema = "modycrew.desktop-app-action.v1";
export const pcControlSkillName = "mody-pc-control";
export const agentDesktopMinVersion = "1.0.0";
export const agentDesktopInstallGuide = "공식 설치: Node.js 18 이상에서 'npm install -g agent-desktop' (https://github.com/vercel-labs/agent-desktop). 모디크루는 대신 설치하지 않습니다.";

const maxSteps = 6;
const maxValueChars = 2_000;
const maxInspectElements = 120;
const approvalTtlMs = 2 * 60 * 60 * 1000;
                                                           
const readGrantTtlMs = 10 * 60 * 1000;
// 같은 앱 창이 이보다 많으면 확인 창에서 고르게 하지 않고 창 제목 일부로 좁혀 달라고 한다(제목은 모델에 보내지 않음).
const maxWindowChoices = 4;
const watcherIntervalMs = 2_000;
const listWindowsTimeoutMs = 20_000;
// 창이 많거나 Chromium·Electron 앱이면 접근성 트리 읽기가 10초를 넘기도 한다(이 PC 실측 9~10초, 가끔 15초 초과).
const snapshotTimeoutMs = 25_000;
const actionTimeoutMs = 15_000;
const probeCacheMs = 60_000;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const desktopAppActionKinds = Object.freeze(["click", "set_value", "clear", "check", "uncheck", "toggle", "select", "expand", "collapse", "scroll_to", "launch"]);
export const desktopAppActionLabels = Object.freeze({
  click: "누르기", set_value: "값 넣기", clear: "값 지우기", check: "체크", uncheck: "체크 해제", toggle: "켜기/끄기 전환",
  select: "목록에서 고르기", expand: "펼치기", collapse: "접기", scroll_to: "보이게 스크롤", launch: "앱 열기",
});
const cliVerbs = Object.freeze({ click: "click", set_value: "set-value", clear: "clear", check: "check", uncheck: "uncheck", toggle: "toggle", select: "select", expand: "expand", collapse: "collapse", scroll_to: "scroll-to" });
const valueActions = new Set(["set_value", "select"]);
const launchAllowlist = new Set(["notepad.exe", "calc.exe", "mspaint.exe", "charmap.exe"]);
const blockedApps = new Set(["modycrew.exe", "consent.exe", "logonui.exe", "lockapp.exe", "credentialuibroker.exe", "credentialenrollmentmanager.exe"]);
// 모디크루 자신은 실행 파일 이름이 무엇이든(설치본 ModyCrew.exe·개발 실행 electron.exe) 조작 대상이 될 수 없다.
const selfExeName = process.versions?.electron ? path.basename(String(process.execPath ?? "")).toLowerCase() : "";
export function isBlockedApp(name, { self = selfExeName } = {}) {
  const lower = String(name ?? "").trim().toLowerCase();
  return blockedApps.has(lower) || (Boolean(self) && lower === self);
}
const sensitiveFieldPattern = /비밀\s*번호|암호|패스워드|password|passcode|passphrase|\bpin\b|otp|인증\s*번호|보안\s*카드|카드\s*번호|cvc|cvv|계좌\s*비밀|주민\s*(등록)?\s*번호/iu;
const riskyClickPattern = /보내기|전송|발송|송금|이체|결제|구매|주문|삭제|지우기|탈퇴|제출|확정|게시|업로드|send|submit|delete|remove|pay|purchase|order|transfer|publish|upload/iu;
const secretPatterns = [
  /\b(?:sk|pk|rk)-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{12,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/u,
  /\b\d{6}-?[1-4]\d{6}\b/u,
];
const retryableCodes = new Set(["STALE_REF", "SNAPSHOT_NOT_FOUND", "TIMEOUT"]);
// 조작 전·후 '읽기'만 다시 해 보는 일시 오류(아무것도 바꾸지 않은 단계). 바쁠 때 창 ID 조회가 잠깐 실패하기도 한다.
const observeRetryableCodes = new Set(["STALE_REF", "SNAPSHOT_NOT_FOUND", "TIMEOUT", "WINDOW_NOT_FOUND", "APP_NOT_FOUND"]);

const errorMessages = Object.freeze({
  APP_NOT_FOUND: "대상 앱이나 창을 찾지 못했습니다. 앱이 열려 있는지 확인해 주세요.",
  WINDOW_NOT_FOUND: "대상 앱의 창을 찾지 못했습니다. 앱을 열어 둔 뒤 다시 요청해 주세요.",
  WINDOW_AMBIGUOUS: "같은 앱 창이 여러 개라 어느 창인지 정할 수 없습니다. 창 제목 일부(windowTitle)를 알려 주세요.",
  WINDOW_CHANGED: "승인할 때의 창이 닫혔거나 바뀌었습니다. 같은 창이 아니면 실행하지 않습니다. 다시 요청해 주세요.",
  WINDOW_MINIMIZED: "창이 최소화돼 있어 실행하지 않았습니다. 창을 화면에 띄워 둔 뒤 다시 승인해 주세요(모디크루는 창을 임의로 앞으로 가져오지 않습니다).",
  ELEMENT_NOT_FOUND: "화면에서 대상 요소를 찾지 못했습니다. 화면 요소를 다시 확인해 주세요.",
  AMBIGUOUS_TARGET: "같은 이름의 요소가 여러 개라 어느 것인지 정할 수 없습니다.",
  SENSITIVE_FIELD: "비밀번호·인증·결제 정보 칸으로 보여 실행하지 않았습니다. 이런 칸은 사용자가 직접 입력해 주세요.",
  TIMEOUT: "앱이 제때 응답하지 않았습니다(바쁘거나 응답 없음).",
  PERM_DENIED: "관리자 권한으로 실행된 앱은 조작할 수 없습니다(Windows 권한 경계). 모디크루는 권한을 올리지 않습니다.",
  POLICY_DENIED: "실제 키 입력이나 포커스가 필요한 조작이라 안전 모드에서 막았습니다.",
  ACTION_NOT_SUPPORTED: "이 요소는 해당 조작을 지원하지 않습니다(예: 일부 목록 상자의 선택).",
  STALE_REF: "화면이 바뀌어 요소를 다시 찾아야 합니다.",
  SNAPSHOT_NOT_FOUND: "화면 정보가 만료돼 다시 읽어야 합니다.",
  PLATFORM_NOT_SUPPORTED: "이 운영체제에서는 지원하지 않는 기능입니다.",
  INVALID_ARGS: "agent-desktop 이 요청 형식을 거절했습니다.",
  ACTION_FAILED: "조작은 전달됐지만 다시 읽은 상태가 요청과 다릅니다.",
  AGENT_DESKTOP_FAILED: "agent-desktop 실행에 실패했습니다.",
  AGENT_DESKTOP_MISSING: "agent-desktop 이 설치돼 있지 않습니다. " + agentDesktopInstallGuide,
  PRIVATE_STATE: "agent-desktop 이 상태 폴더 권한(다른 계정·샌드박스 그룹이 읽을 수 있음) 때문에 보안상 실행을 거부했습니다. 모디크루 전용 상태 폴더를 본인 계정만 쓰도록 다시 맞췄지만 해결되지 않았습니다.",
});

const clip = (value, max) => {
  const text = String(value ?? "").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
};
const digest = (value) => createHash("sha256").update(value).digest("hex").slice(0, 24);

/** agent-desktop 오류 → 사용자 문장. 상태 폴더 권한 거부(INTERNAL: private file DACL…)는 따로 알린다. */
function errorMessageFor(error) {
  const code = String(error?.code ?? "");
  if (isPrivateStateRefusal(error)) return errorMessages.PRIVATE_STATE;
  return errorMessages[code] ?? (clip(error?.message, 200) || errorMessages.AGENT_DESKTOP_FAILED);
}

function isPrivateStateRefusal(error) {
  return String(error?.code ?? "") === "INTERNAL" && /dacl|principal|private file/iu.test(String(error?.message ?? ""));
}

let cachedUserSid = null;
function currentUserSid(spawnSyncFn = spawnSync) {
  if (cachedUserSid !== null) return cachedUserSid;
  try {
    const out = spawnSyncFn(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "whoami.exe"), ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    const match = String(out?.stdout ?? "").match(/"(S-1-[0-9-]+)"/u);
    cachedUserSid = match ? match[1] : "";
  } catch {
    cachedUserSid = "";
  }
  return cachedUserSid;
}

   
                                                                       
                                                                      
                                                                    
                                                                           
                                                                            
                                                            
   
export function ensurePrivateDirectory(dir, { platform = process.platform, spawnSyncFn = spawnSync, listDir = readdirSync } = {}) {
  try {
    mkdirSync(dir, { recursive: true });
    if (platform !== "win32") { chmodSync(dir, 0o700); return true; }
    const sid = currentUserSid(spawnSyncFn);
    if (!sid) return false;
    const icacls = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "icacls.exe");
    const own = spawnSyncFn(icacls, [dir, "/inheritance:r", "/grant:r", "*" + sid + ":(OI)(CI)F", "*S-1-5-18:(OI)(CI)F", "/C", "/Q"], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
    if (own?.status !== 0) return false;
    let children = [];
    try { children = listDir(dir); } catch { children = []; }
    if (!children.length) return true;
    // 하위 항목은 폴더 권한을 상속받게 되돌린다(이미 텅 빈 권한도 소유자라 고칠 수 있다).
    const reset = spawnSyncFn(icacls, [path.join(dir, "*"), "/reset", "/T", "/C", "/Q"], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
    return reset?.status === 0;
  } catch {
    return false;
  }
}
/** 크루 스킬 실행기와 같은 저장 위치 구분 값(rootKeyOf). 같은 회사의 '내 확인 필요'에 함께 모인다. */
export const desktopAppRootKey = (workspaceRoot) => digest(JSON.stringify([String(workspaceRoot ?? "").trim().slice(0, 1000)]));

export function looksSecret(value) {
  const text = String(value ?? "");
  return secretPatterns.some((pattern) => pattern.test(text));
}

/** 화면 문자열 → 모델·카드·문서에 넣을 문자열. 제어문자 제거, 비밀값 가림, 길이 제한. */
export function redactUiText(value, max = 160) {
  let text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  for (const pattern of secretPatterns) text = text.replace(new RegExp(pattern.source, "gu"), "[가림]");
  return clip(text, max);
}

export function normalizeAppName(value, platform = process.platform) {
  const raw = String(value ?? "").trim().replace(/^"+|"+$/gu, "");
  if (!raw || raw.length > 80 || /[\\/:*?"<>|]/u.test(raw)) return "";
  if (platform === "win32" && !/\.exe$/iu.test(raw)) return raw + ".exe";
  return raw;
}

function isSensitiveElement(element) {
  const role = String(element?.role ?? "").toLowerCase();
  const states = (element?.states ?? []).map((state) => String(state).toLowerCase());
  return role.includes("password") || role.includes("secure") || states.includes("protected") || states.includes("password") || sensitiveFieldPattern.test(String(element?.name ?? ""));
}

function versionAtLeast(version, minimum) {
  const a = String(version ?? "").split(/[.+-]/u).map((part) => Number.parseInt(part, 10) || 0);
  const b = String(minimum).split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return true;
}

/**
 * 계획 검사. 지원 조작·단계 수·값 길이·비밀 칸·되돌리기 어려운 누르기를 앱이 판정한다.
 * 실행 뒤 다시 읽어 확인할 규칙(verify)도 여기서 만든다 — 값 넣기·체크·고르기는 자동으로 확인 규칙이 붙는다.
 */
export function validateDesktopAppPlan(input = {}, { platform = process.platform } = {}) {
  const errors = [];
  const warnings = [];
  const app = normalizeAppName(input.app, platform);
  const purpose = redactUiText(input.purpose ?? input.instruction ?? "", 200);
  const windowTitle = clip(input.windowTitle, 120);
  if (!app) errors.push("대상 앱 이름(app)이 필요합니다. 예: notepad.exe — pc.inspect 로 열린 앱 이름을 먼저 확인하세요.");
  else if (isBlockedApp(app)) errors.push(app + " 은(는) PC 조작 대상으로 쓸 수 없습니다(모디크루 자신·보안 화면).");
  if (!purpose) errors.push("무엇을 하려는지(purpose)를 한 줄로 적어 주세요. 승인 창에 그대로 보입니다.");
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  if (!rawSteps.length) errors.push("실행할 단계(steps)가 필요합니다.");
  if (rawSteps.length > maxSteps) errors.push("한 번에 " + maxSteps + "단계까지만 승인받을 수 있습니다. 나눠서 요청해 주세요.");
  const steps = [];
  rawSteps.slice(0, maxSteps).forEach((raw, index) => {
    const no = index + 1 + "단계";
    const action = String(raw?.action ?? "").trim().toLowerCase().replace(/-/gu, "_");
    if (!desktopAppActionKinds.includes(action)) {
      errors.push(no + ": 지원하지 않는 조작 '" + clip(raw?.action, 40) + "'. 가능한 조작: " + desktopAppActionKinds.join(", ") + " (키 입력·단축키·마우스 좌표는 지원하지 않음)");
      return;
    }
    if (action === "launch") {
      if (index !== 0) errors.push(no + ": 앱 열기(launch)는 첫 단계에서만 쓸 수 있습니다.");
      if (app && !launchAllowlist.has(app.toLowerCase())) errors.push("앱 열기는 " + [...launchAllowlist].join(", ") + " 만 허용합니다. 다른 앱은 사용자가 먼저 열어 두세요.");
      steps.push({ index, action, label: desktopAppActionLabels[action], risk: "medium" });
      return;
    }
    const role = String(raw?.role ?? "").trim().toLowerCase().slice(0, 40);
    const name = String(raw?.name ?? "").replace(/\s+/gu, " ").trim().slice(0, 160);
    if (!role || !name) {
      errors.push(no + ": 대상 요소의 역할(role)과 이름(name)이 필요합니다. pc.inspect 결과에 나온 값을 그대로 쓰세요.");
      return;
    }
    const nth = Number.isInteger(raw?.nth) && raw.nth >= 0 && raw.nth < 20 ? raw.nth : undefined;
    let value;
    if (valueActions.has(action)) {
      value = String(raw?.value ?? "");
      if (action === "select" && !value.trim()) errors.push(no + ": 고를 항목(value)이 필요합니다.");
      if (value.length > maxValueChars) errors.push(no + ": 넣을 값은 " + maxValueChars + "자까지입니다.");
      if (looksSecret(value)) errors.push(no + ": 비밀키·토큰·주민등록번호처럼 보이는 값은 AI가 입력하지 않습니다. 사용자가 직접 입력해 주세요.");
    }
    if (sensitiveFieldPattern.test(name)) errors.push(no + ": '" + name + "' 은(는) 비밀번호·인증·결제 정보 칸으로 보여 AI가 조작하지 않습니다.");
    const risky = action === "click" && riskyClickPattern.test(name);
    if (risky) warnings.push(no + " '" + name + "' 누르기는 보내기·삭제·결제처럼 되돌리기 어려운 동작일 수 있습니다.");
    steps.push({
      index, action, label: desktopAppActionLabels[action], role, name,
      ...(nth !== undefined ? { nth } : {}), ...(value !== undefined ? { value } : {}),
      risk: risky ? "high" : action === "click" || action === "clear" || valueActions.has(action) ? "medium" : "low",
    });
  });
  const verify = [];
  for (const step of steps) {
    const target = { role: step.role, name: step.name, ...(step.nth !== undefined ? { nth: step.nth } : {}), implicit: true, step: step.index };
    if (step.action === "set_value" || step.action === "select") verify.push({ ...target, expect: "value", equals: step.value });
    if (step.action === "clear") verify.push({ ...target, expect: "value", equals: "" });
    if (step.action === "check") verify.push({ ...target, expect: "checked" });
    if (step.action === "uncheck") verify.push({ ...target, expect: "unchecked" });
  }
  for (const raw of (Array.isArray(input.verify) ? input.verify : []).slice(0, 6)) {
    const contains = redactUiText(raw?.textContains ?? raw?.contains ?? "", 160);
    if (contains) verify.push({ expect: "text", contains });
  }
  const risk = steps.some((step) => step.risk === "high") ? "high" : "medium";
  return { ok: errors.length === 0, errors, warnings, plan: { app, windowTitle, purpose, steps, verify, risk, warnings } };
}

/** agent-desktop snapshot 트리 → 평평한 요소 목록. ref 는 실행기 안에서만 쓰고 모델에게는 보내지 않는다. */
export function flattenAccessibilityTree(tree, { includeStatic = false, limit = 400 } = {}) {
  const elements = [];
  let total = 0;
  const visit = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 40) return;
    const ref = typeof node.ref_id === "string" ? node.ref_id : typeof node.ref === "string" ? node.ref : null;
    if (ref || (includeStatic && (node.name || node.value))) {
      total += 1;
      if (elements.length < limit) {
        elements.push({
          ref, role: String(node.role ?? ""), name: String(node.name ?? ""),
          value: node.value === null || node.value === undefined ? null : String(node.value),
          states: Array.isArray(node.states) ? node.states.map(String) : [], depth,
        });
      }
    }
    for (const child of Array.isArray(node.children) ? node.children : []) visit(child, depth + 1);
  };
  visit(tree, 0);
  return { elements, total, truncated: total > elements.length };
}

const norm = (value) => String(value ?? "").replace(/\s+/gu, " ").trim().toLowerCase();

/** 역할+이름이 정확히 같은 요소 하나를 고른다. 여러 개면 nth 가 있어야 하고, 없으면 실행하지 않는다. */
export function matchElement(elements, { role, name, nth }, { requireRef = true } = {}) {
  const candidates = (elements ?? []).filter((element) => (!requireRef || element.ref) && norm(element.role) === norm(role) && norm(element.name) === norm(name));
  if (!candidates.length) return { status: "not_found", count: 0 };
  if (nth !== undefined) return candidates[nth] ? { status: "found", element: candidates[nth], count: candidates.length } : { status: "not_found", count: candidates.length };
  if (candidates.length > 1) return { status: "ambiguous", count: candidates.length };
  return { status: "found", element: candidates[0], count: 1 };
}

function similarElements(elements, role) {
  return (elements ?? []).filter((element) => element.ref && (!role || norm(element.role) === norm(role))).slice(0, 10).map((element) => ({ role: element.role, name: redactUiText(element.name, 80) }));
}

/**
 * 조작 결과 판정(agent-desktop 의 disposition 규칙 그대로).
 * verified = 다시 읽은 값이 일치 / delivered_unverified = 전달됐지만 앱이 확인 신호를 주지 않음(화면 재확인으로 판단)
 * not_delivered = 전달 안 됨, 다시 해도 안전 / uncertain = 전달됐을 수도 있음 → 다시 하지 않는다.
 */
export function classifyActionEnvelope(outcome) {
  const envelope = outcome?.envelope;
  if (!envelope) {
    // 프로세스가 끝까지 답하지 않음 — 조작이 들어갔는지 모른다.
    return { outcome: "uncertain", code: outcome?.timedOut ? "TIMEOUT" : "AGENT_DESKTOP_FAILED", message: outcome?.timedOut ? "응답을 받기 전에 시간이 지나 조작이 들어갔는지 확인하지 못했습니다." : errorMessages.AGENT_DESKTOP_FAILED };
  }
  if (envelope.ok) {
    const delivery = envelope.data?.disposition?.delivery;
    return delivery === "delivered_verified"
      ? { outcome: "verified", delivery }
      : { outcome: "delivered_unverified", delivery: delivery || "delivered_unverified" };
  }
  const error = envelope.error ?? {};
  const code = String(error.code ?? "AGENT_DESKTOP_FAILED");
  const message = errorMessageFor(error);
  if (error.disposition?.delivery === "not_delivered" && error.disposition?.retry === "safe") return { outcome: "not_delivered", code, message };
  if (code === "ACTION_FAILED" && error.details?.kind === "post_action_verification") {
    return { outcome: "uncertain", code, message, postState: redactUiText(JSON.stringify(error.details.post_state ?? {}), 200) };
  }
  return { outcome: "uncertain", code, message };
}

export function evaluateVerifications(rules, elements) {
  return (rules ?? []).map((rule) => {
    if (rule.expect === "text") {
      const needle = norm(rule.contains);
      const hit = (elements ?? []).find((element) => norm(element.name).includes(needle) || norm(element.value).includes(needle));
      return { rule, status: hit ? "pass" : "fail", observed: hit ? redactUiText(hit.name || hit.value, 120) : "" };
    }
    const match = matchElement(elements, rule, { requireRef: false });
    if (match.status !== "found") return { rule, status: "not_found", observed: "" };
    const element = match.element;
    if (rule.expect === "checked" || rule.expect === "unchecked") {
      const checked = element.states.map((state) => state.toLowerCase()).includes("checked");
      return { rule, status: (rule.expect === "checked") === checked ? "pass" : "fail", observed: checked ? "checked" : "unchecked" };
    }
    const observed = String(element.value ?? "");
    return { rule, status: norm(observed) === norm(rule.equals) ? "pass" : "fail", observed: isSensitiveElement(element) ? "[숨김]" : redactUiText(observed, 120) };
  });
}

/** 공식 실행 파일 찾기. Windows 는 npm 셸 스크립트를 거치지 않고 패키지 안의 네이티브 exe 를 직접 부른다(따옴표·@ref 문제 방지). */
export function resolveAgentDesktopBinary({ env = process.env, platform = process.platform, arch = process.arch, exists = existsSync } = {}) {
  const override = String(env.MODYCREW_AGENT_DESKTOP_BIN ?? "").trim();
  if (override && path.isAbsolute(override) && exists(override)) return { path: override, source: "env" };
  const pathDirs = String(env.PATH ?? env.Path ?? "").split(path.delimiter).map((dir) => dir.trim()).filter(Boolean);
  if (platform === "win32") {
    const exe = "agent-desktop-win32-" + (arch === "arm64" ? "arm64" : "x64") + ".exe";
    const prefixes = [env.APPDATA ? path.join(env.APPDATA, "npm") : "", env.npm_config_prefix ?? ""].filter(Boolean);
    for (const dir of pathDirs) if (exists(path.join(dir, "agent-desktop.cmd"))) prefixes.push(dir);
    for (const prefix of prefixes) {
      const candidate = path.join(prefix, "node_modules", "agent-desktop", "bin", exe);
      if (exists(candidate)) return { path: candidate, source: "npm-global" };
    }
    return null;
  }
  for (const dir of pathDirs) {
    const candidate = path.join(dir, "agent-desktop");
    if (exists(candidate)) return { path: candidate, source: "path" };
  }
  return null;
}

/** agent-desktop 한 번 실행 → JSON 봉투. 셸을 거치지 않고 인자 배열로 넘긴다. 상태 폴더는 처음 쓸 때 비공개로 맞춘다. */
export function createAgentDesktopRunner({ binary, home, spawnFn = spawn, env = process.env, privatize = ensurePrivateDirectory } = {}) {
  let homeReady = false;
  const runner = (args, { timeoutMs = 20_000 } = {}) => new Promise((resolve) => {
    let child;
    try {
      if (home && !homeReady) {
        homeReady = privatize(home);
        if (!homeReady) mkdirSync(home, { recursive: true });
      }
      child = spawnFn(binary, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...env, ...(home ? { AGENT_DESKTOP_HOME: home } : {}) } });
    } catch (error) {
      resolve({ envelope: null, spawnError: String(error?.message ?? error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let done = false;
    let timer = null;
    const finish = (value) => { if (done) return; done = true; if (timer) clearTimeout(timer); resolve(value); };
    timer = setTimeout(() => { try { child.kill(); } catch { /* 이미 끝남 */ } finish({ envelope: null, timedOut: true, stderr: clip(stderr, 400) }); }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 4_000_000) { try { child.kill(); } catch { /* 무시 */ } finish({ envelope: null, tooLarge: true }); }
    });
    child.stderr?.on("data", (chunk) => { if (stderr.length < 4_000) stderr += chunk; });
    child.on("error", (error) => finish({ envelope: null, spawnError: String(error?.message ?? error) }));
    child.on("close", (exitCode) => {
      let envelope = null;
      try { envelope = JSON.parse(stdout); } catch { /* JSON 아님 */ }
      finish({ envelope, exitCode, stderr: clip(stderr, 400) });
    });
  });
  /** 상태 폴더 권한을 다시 좁힌다(agent-desktop 이 권한 문제로 거부했을 때 한 번). */
  runner.repairHome = () => { homeReady = home ? privatize(home) : true; return homeReady; };
  runner.homeReady = () => homeReady;
  return runner;
}

function defaultRoot(env = process.env) {
  const base = env.MODYCREW_OUTPUT_DIR || env.APPDATA || env.LOCALAPPDATA || os.tmpdir();
  return path.join(base, "ModyCrew");
}

async function electronModule() {
  if (!process.versions?.electron) return null;
  try { return await import("electron"); } catch { return null; }
}

export function workStateOfDesktopAppAction(record) {
  switch (record?.status) {
    case "awaiting_approval": return { status: "needs_approval", reason: "approval" };
    case "executing": return { status: "running" };
    case "completed": return { status: "completed" };
    case "failed": return { status: "failed", reason: "failure" };
    case "uncertain": return { status: "needs_input", reason: "unknown_outcome" };
    default: return { status: "cancelled" };
  }
}

const statusLabels = Object.freeze({ awaiting_approval: "승인 대기", executing: "실행 중", completed: "완료", failed: "실패", uncertain: "결과 확인 필요", expired: "승인 기한 지남", cancelled: "취소" });

/**
 * 실행 기록 → 사무실 업무 이벤트 신호(도메인 officeSignalForWorkState 와 같은 규칙).
 * 사무실 화면은 'running' 이벤트를 2분 뒤 '확인 불가'로 본다. 승인 대기·결과 확인 필요처럼 사람을 기다리는 상태는
 * '끝난 준비 단계(done) + approval_pending' 으로 남겨, 오래 기다려도 승인 대기로 보이게 한다.
 */
export function desktopAppWorkEventSignal(record) {
  const state = workStateOfDesktopAppAction(record);
  if (state.status === "running") return { state, eventStatus: "running", officeStatus: "problem_solving" };
  if (state.status === "needs_approval" || state.status === "needs_input") return { state, eventStatus: "done", officeStatus: "approval_pending" };
  if (state.status === "completed") return { state, eventStatus: "done", officeStatus: "completed" };
  if (state.status === "failed") return { state, eventStatus: "error", officeStatus: "failed" };
  return { state, eventStatus: "done", officeStatus: "idle" };
}

/** 이벤트 id 는 웹이 만든 값이라 형식만 남긴다(경로·명령으로 쓰지 않음). */
const sanitizeEventId = (value) => String(value ?? "").replace(/[^A-Za-z0-9:_-]/gu, "").slice(0, 120);

/** 메인 업무 이벤트 저장소(사무실 화면이 읽는 기록)에 PC 작업 상태를 남긴다. 설치 앱 밖(시험)에서는 아무것도 안 한다. */
async function defaultWorkEventWriter(event) {
  const electron = await electronModule();
  if (!electron?.app?.getPath) return;
  const { handleSelectedWorkActionEventsMessage } = await import("./selected-work-action-events-handler.mjs");
  await handleSelectedWorkActionEventsMessage(null, { kind: "record", event }, { app: electron.app });
}

/** 지금 앱의 저장 위치(기억 폴더). 메인이 가진 설정에서 읽는다 — 화면이 보낸 값을 믿지 않기 위해서다. */
export async function defaultCurrentWorkspaceRoot() {
  const electron = await electronModule();
  if (!electron?.app?.getPath) return "";
  try {
    const { handleLocalMemoryMessage } = await import("./local-memory-handler.mjs");
    const status = await handleLocalMemoryMessage(null, { kind: "status" }, { app: electron.app });
    return String(status?.root || status?.defaultRoot || "");
  } catch {
    return "";
  }
}

/** 같은 저장 위치인지(Windows 는 대소문자·구분자 차이를 무시). */
export function sameWorkspaceRoot(a, b, platform = process.platform) {
  const normalize = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const resolved = path.resolve(raw).replace(/[\\/]+$/u, "");
    return platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const left = normalize(a);
  return Boolean(left) && left === normalize(b);
}

/**
 * 실행기 만들기. root(앱 사용자 데이터 폴더) 아래 desktop-app-control/ 에 actions/<id>.json(기록 · 정본),
 * results/<id>.md(결과 문서), agent-desktop-home(agent-desktop 상태 폴더 — 사용자의 다른 세션과 분리)을 둔다.
 */
export function createDesktopAppControl(options = {}) {
  const platform = options.platform ?? process.platform;
  const now = options.now ?? (() => new Date());
  const newId = options.randomId ?? randomUUID;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let root = options.root ?? "";
  let runner = options.runner ?? null;
  let resolvedBinary = options.binary ? { path: options.binary, source: "option" } : null;
  let dialog = options.dialog ?? null;
  let inbox = options.inbox ?? null;
  let currentWorkspaceRoot = options.currentWorkspaceRoot ?? null;
  let writeWorkEvent = options.workEvents ?? null;
  let probeCache = null;
  let loaded = false;
  let busy = false;
  let watcher = null;
  const records = new Map();
  // 화면 읽기 허용: 키 = 저장 위치|대화|창id:pid → { expiresAt }. 메모리에만 두므로 앱을 다시 켜면 모두 사라진다.
  const readGrants = new Map();

  async function ensureRoot() {
    if (root) return root;
    const electron = await electronModule();
    root = electron?.app?.getPath ? electron.app.getPath("userData") : defaultRoot();
    return root;
  }
  const actionsDir = () => path.join(root, "desktop-app-control", "actions");
  const resultsDir = () => path.join(root, "desktop-app-control", "results");

  async function ensureRunner() {
    if (runner) return runner;
    await ensureRoot();
    resolvedBinary ??= (options.resolveBinary ?? resolveAgentDesktopBinary)({ platform });
    if (!resolvedBinary) return null;
    runner = createAgentDesktopRunner({ binary: resolvedBinary.path, home: path.join(root, "desktop-app-control", "agent-desktop-home") });
    return runner;
  }

  async function run(args, timeoutMs) {
    const exec = await ensureRunner();
    if (!exec) return { envelope: null, missing: true };
    const first = await exec(args, { timeoutMs });
    // 상태 폴더 권한 거부는 '전달 안 됨'(다시 해도 안전)이다. 폴더 권한을 다시 좁히고 한 번만 다시 시도한다.
    if (first.envelope?.ok === false && isPrivateStateRefusal(first.envelope.error) && first.envelope.error?.disposition?.delivery === "not_delivered" && typeof exec.repairHome === "function") {
      exec.repairHome();
      return exec(args, { timeoutMs });
    }
    return first;
  }

  function saveRecord(record) {
    mkdirSync(actionsDir(), { recursive: true });
    const file = path.join(actionsDir(), record.id + ".json");
    const pending = file + "." + process.pid + "." + Date.now() + ".pending";
    writeFileSync(pending, JSON.stringify(record, null, 2), "utf8");
    renameSync(pending, file);
    records.set(record.id, record);
    return record;
  }

  function update(record, patch, note) {
    const at = now().toISOString();
    const next = { ...record, ...patch, updatedAt: at, events: [...(record.events ?? []), { at, status: patch.status ?? record.status, ...(note ? { note: clip(note, 200) } : {}) }].slice(-30) };
    saveRecord(next);
    if (next.status !== record.status || patch.result) pushWorkEvent(next);
    return next;
  }

  /**
   * 상태가 바뀔 때마다 메인 업무 이벤트를 새로 쓴다(사무실 화면·하루 보고가 읽는 기록). 대화가 끝난 뒤 승인함에서
   * 승인돼 실행돼도 여기서 갱신된다. 'record' 로 다시 쓰는 이유: 오래 기다린 승인 뒤 실행 중 상태가 만든 지
   * 2분 넘은 'running' 으로 읽혀 실패로 보이지 않게 하려고 만든 시각을 지금으로 맞춘다. 실패해도 실행에는 영향 없음.
   */
  function pushWorkEvent(record) {
    const eventId = sanitizeEventId(record.eventId);
    if (!eventId) return;
    const writer = typeof writeWorkEvent === "function" ? writeWorkEvent : defaultWorkEventWriter;
    const signal = desktopAppWorkEventSignal(record);
    const teammateId = record.teammateId || "teammate-personal-operator";
    const event = {
      id: eventId, workItemId: "ai-teammate:" + teammateId, label: "PC 작업 · " + clip(record.plan?.purpose || record.plan?.app, 60),
      detail: clip(statusLabels[record.status] + " · " + summaryOf(record), 230), status: signal.eventStatus, createdAt: now().toISOString(),
      kind: "selected_action", sourceLabel: "PC 조작",
      metrics: { teammateId, pcAction: record.id, virtualOfficeStatus: signal.officeStatus, workStatus: signal.state.status, ...(signal.state.reason ? { workReason: signal.state.reason } : {}) },
    };
    try { void Promise.resolve(writer(event)).catch(() => undefined); } catch { /* 기록 실패는 무시 */ }
  }

  async function ensureLoaded() {
    await ensureRoot();
    if (loaded) return;
    loaded = true;
    let files = [];
    try { files = readdirSync(actionsDir()).filter((file) => /^[0-9a-f-]{36}\.json$/iu.test(file)); } catch { files = []; }
    for (const file of files) {
      try {
        const record = JSON.parse(readFileSync(path.join(actionsDir(), file), "utf8"));
        if (record?.schema === desktopAppActionSchema && idPattern.test(record.id)) records.set(record.id, record);
      } catch { /* 깨진 기록은 건너뛰고 원본 파일은 그대로 둔다 */ }
    }
    if (options.watch === false) return;
    for (const record of [...records.values()]) {
      if (record.status === "executing") {
        // 실행 중에 앱이 꺼졌다. 조작이 들어갔는지 모르므로 다시 실행하지 않고 사용자 확인으로 돌린다.
        const next = update(record, { status: "uncertain", result: { summary: "실행 중에 앱이 꺼져 결과를 확인하지 못했습니다. 화면을 직접 확인해 주세요(자동으로 다시 실행하지 않음)." } }, "앱 재시작 뒤 결과 확인 필요로 전환");
        syncCard(next);
      }
    }
    if ([...records.values()].some((record) => record.status === "awaiting_approval")) startWatcher();
  }

  async function packageInstalled() {
    if (options.packageInstalled) return options.packageInstalled();
    try {
      const store = createCrewSkillPackageStore({ stateRoot: path.join(await ensureRoot(), "crew-skill-packages"), libraryRoot: path.join(path.dirname(defaultBundledCatalogPath), "library") });
      return (await store.status(pcControlSkillName)).installed === true;
    } catch {
      return false;
    }
  }

  /** 연결 점검: 설치 여부·버전·접근성 권한. 모델을 부르지 않고 이 PC에서만 확인한다. */
  async function probe(force = false) {
    if (!force && probeCache && Date.now() - probeCache.at < probeCacheMs) return probeCache.value;
    await ensureRoot();
    const exec = await ensureRunner();
    let value;
    if (!exec) {
      value = { installed: false, ready: false, code: "AGENT_DESKTOP_MISSING", userMessage: errorMessages.AGENT_DESKTOP_MISSING };
    } else {
      const version = await exec(["version"], { timeoutMs: 15_000 });
      const status = await exec(["status"], { timeoutMs: 15_000 });
      const toolVersion = String(version.envelope?.data?.version ?? "");
      const accessibility = String(status.envelope?.data?.permissions?.accessibility?.state ?? "");
      const supported = Boolean(toolVersion) && versionAtLeast(toolVersion, agentDesktopMinVersion);
      const ready = Boolean(supported && status.envelope?.ok && (accessibility === "granted" || accessibility === "not_required"));
      value = {
        installed: true, ready, version: toolVersion, platform: String(status.envelope?.data?.platform ?? platform), accessibility,
        binarySource: resolvedBinary?.source ?? "runner",
        code: ready ? "" : !toolVersion ? "AGENT_DESKTOP_FAILED" : !supported ? "AGENT_DESKTOP_OUTDATED" : "PERM_DENIED",
        userMessage: ready
          ? "agent-desktop " + toolVersion + " 연결됨(접근성 권한 " + (accessibility || "확인") + ")."
          : !toolVersion ? "agent-desktop 을 실행하지 못했습니다. 백신·Smart App Control 차단 여부를 확인해 주세요(모디크루는 차단을 우회하지 않습니다)."
            : !supported ? "agent-desktop " + toolVersion + " 은(는) 너무 오래됐습니다. " + agentDesktopMinVersion + " 이상으로 공식 경로에서 업데이트해 주세요."
              : "접근성 권한이 없어 화면 요소를 읽을 수 없습니다. 운영체제 설정에서 권한을 확인해 주세요.",
      };
    }
    probeCache = { at: Date.now(), value };
    return value;
  }

  const windowView = (win) => ({ id: String(win.id), pid: Number(win.pid) || 0, title: redactUiText(win.title, 120), minimized: win.minimized === true, focused: win.is_focused === true });

  async function listAppWindows(app) {
    const out = await run(["list-windows", "--app", app, "--timeout-ms", String(listWindowsTimeoutMs)], listWindowsTimeoutMs + 10_000);
    if (out.missing) return { ok: false, code: "AGENT_DESKTOP_MISSING", message: errorMessages.AGENT_DESKTOP_MISSING };
    if (!out.envelope?.ok) {
      const code = String(out.envelope?.error?.code ?? (out.timedOut ? "TIMEOUT" : "AGENT_DESKTOP_FAILED"));
      return { ok: false, code, message: out.envelope?.error ? errorMessageFor(out.envelope.error) : errorMessages[code] ?? errorMessages.AGENT_DESKTOP_FAILED };
    }
    return { ok: true, windows: (Array.isArray(out.envelope.data) ? out.envelope.data : []).filter((win) => win && win.visible !== false && win.accessible !== false) };
  }

  async function resolveWindow(app, windowTitle, previous) {
    const listed = await listAppWindows(app);
    if (!listed.ok) return { status: listed.code === "APP_NOT_FOUND" ? "not_found" : "error", code: listed.code, message: listed.message };
    let windows = listed.windows;
    if (previous?.id) {
      const same = windows.find((win) => String(win.id) === previous.id && (Number(win.pid) || 0) === previous.pid);
      return same ? { status: "found", window: windowView(same) } : { status: "changed", code: "WINDOW_CHANGED", message: errorMessages.WINDOW_CHANGED };
    }
    if (windowTitle) windows = windows.filter((win) => norm(win.title).includes(norm(windowTitle)));
    if (!windows.length) return { status: "not_found", code: "WINDOW_NOT_FOUND", message: errorMessages.WINDOW_NOT_FOUND };
    if (windows.length > 1) {
      const focused = windows.filter((win) => win.is_focused === true);
      if (focused.length === 1) return { status: "found", window: windowView(focused[0]) };
      return { status: "ambiguous", code: "WINDOW_AMBIGUOUS", message: errorMessages.WINDOW_AMBIGUOUS, windows: windows.slice(0, 8).map((win) => redactUiText(win.title, 80)) };
    }
    return { status: "found", window: windowView(windows[0]) };
  }

  async function snapshotWindow(windowId, { interactiveOnly = true } = {}) {
    const args = ["snapshot", "--window-id", windowId, "--compact", "--timeout-ms", String(snapshotTimeoutMs), ...(interactiveOnly ? ["-i"] : [])];
    const out = await run(args, snapshotTimeoutMs + 15_000);
    if (!out.envelope?.ok) {
      const code = String(out.envelope?.error?.code ?? (out.timedOut ? "TIMEOUT" : out.missing ? "AGENT_DESKTOP_MISSING" : "AGENT_DESKTOP_FAILED"));
      return { ok: false, code, message: out.envelope?.error ? errorMessageFor(out.envelope.error) : errorMessages[code] ?? errorMessages.AGENT_DESKTOP_FAILED, raw: clip(out.envelope?.error?.message, 160) };
    }
    return { ok: true, ...flattenAccessibilityTree(out.envelope.data?.tree, { includeStatic: !interactiveOnly }) };
  }

  /** 화면 읽기(조작 없음). 일시 오류면 잠깐 기다렸다 한 번 더 읽는다. */
  async function observeWindow(windowId, opts = {}) {
    const first = await snapshotWindow(windowId, opts);
    if (first.ok || !observeRetryableCodes.has(first.code)) return first;
    await sleep(1_500);
    const second = await snapshotWindow(windowId, opts);
    return second.ok ? { ...second, retried: true } : { ...second, retried: true, firstRaw: first.raw };
  }

  const presentElement = (element) => ({
    role: element.role, name: redactUiText(element.name, 120),
    ...(element.value !== null ? { value: isSensitiveElement(element) ? "[숨김]" : redactUiText(element.value, 160) } : {}),
    ...(element.states.length ? { states: element.states.slice(0, 6) } : {}),
  });

  async function gate() {
    const tool = await probe();
    if (!tool.installed || !tool.ready) return { status: "needs_connection", code: tool.code, userMessage: tool.userMessage, tool };
    if (!(await packageInstalled())) {
      return { status: "not_installed", userMessage: "'PC 앱 조작' 확장이 아직 추가되지 않았습니다. 앱의 플러그인 > 크루 스킬 확장에서 추가한 뒤 사용할 수 있습니다.", tool };
    }
    return null;
  }

  /** 대화 범위: 대화 id 가 있으면 그 대화, 없으면 그 직원(위임 실행기). 허용·기록 조회를 이 범위로 나눈다. */
  function threadKeyOf(ctx = {}) {
    const thread = clip(ctx.threadId, 240);
    if (thread) return "thread:" + thread;
    const teammate = clip(ctx.teammateId, 120);
    return teammate ? "crew:" + teammate : "none";
  }
  const grantKey = (rootKey, threadKey, win) => rootKey + "|" + threadKey + "|" + String(win.id) + ":" + (Number(win.pid) || 0);
  function activeGrant(rootKey, threadKey, win) {
    const key = grantKey(rootKey, threadKey, win);
    const grant = readGrants.get(key);
    if (!grant) return null;
    if (grant.expiresAt <= now().getTime()) { readGrants.delete(key); return null; }
    return grant;
  }

  async function ownerWindow(ctx = {}) {
    const electron = await electronModule();
    try { return ctx.event?.sender && electron?.BrowserWindow?.fromWebContents ? electron.BrowserWindow.fromWebContents(ctx.event.sender) : null; } catch { return null; }
  }

  /** 네이티브 확인 창. 창을 띄울 수 없으면 'unavailable' — 화면 읽기는 허용 없이 진행하지 않는다. */
  async function showBox(box, ctx) {
    if (typeof dialog?.showMessageBox !== "function") return null;
    const owner = await ownerWindow(ctx);
    try {
      const response = owner ? await dialog.showMessageBox(owner, box) : await dialog.showMessageBox(box);
      return Number.isInteger(response?.response) ? response.response : null;
    } catch {
      return null;
    }
  }

  const modelNotice = "읽은 내용은 이 대화의 AI 모델에 전달됩니다. 연결된 모델이 외부 서비스(예: OpenAI·Anthropic·Google)라면 그 서비스로 전송됩니다.";

  /** 열린 앱 이름 목록을 모델에 보내도 되는지 묻는다(창 제목·화면 내용은 포함하지 않음). 한 번만 유효. */
  async function askAppListConsent(ctx) {
    const index = await showBox({
      type: "question", title: "모디크루 화면 읽기 확인", message: "AI 직원이 지금 열려 있는 앱 이름 목록을 확인하려고 합니다.",
      detail: ["보내는 것: 실행 파일 이름 목록(예: notepad.exe, EXCEL.EXE)만 보냅니다. 창 제목과 화면 내용은 보내지 않습니다.", modelNotice, "이번 한 번만 적용됩니다."].join("\n"),
      buttons: ["보여 주기", "거절"], defaultId: 1, cancelId: 1, noLink: true,
    }, ctx);
    return index === null ? "unavailable" : index === 0 ? "allow" : "deny";
  }

  /** 이 창의 화면 요소를 읽어 모델에 보내도 되는지 묻는다. 창이 여러 개면 사용자가 창을 고른다. */
  async function askWindowReadConsent(app, windows, ctx) {
    const multiple = windows.length > 1;
    const detail = [
      "앱: " + app,
      ...(multiple ? windows.map((win, index) => index + 1 + "번 창: '" + win.title + "'") : ["창: '" + windows[0].title + "'"]),
      "",
      "읽는 것: 이 창의 버튼·입력칸·목록 같은 화면 요소의 이름과 값(최대 " + maxInspectElements + "개). 비밀번호 칸 값과 비밀키처럼 보이는 문자열은 가립니다.",
      modelNotice,
      "화면 이미지(스크린샷)는 찍거나 보내지 않습니다. 아무것도 누르거나 바꾸지 않습니다.",
      multiple
        ? "고른 창 하나만 읽고, 이 대화에서 10분 동안 그 창을 다시 읽을 때는 묻지 않습니다."
        : "'10분 동안 허용'은 이 대화·이 창에만 적용됩니다. 창이 바뀌거나 다른 대화·다른 저장 위치에서는 다시 묻습니다.",
    ].join("\n");
    const buttons = multiple ? [...windows.map((_, index) => index + 1 + "번 창 허용"), "거절"] : ["10분 동안 허용", "이번만 허용", "거절"];
    const cancelId = buttons.length - 1;
    const index = await showBox({ type: "question", title: "모디크루 화면 읽기 확인", message: "AI 직원이 이 PC에 열린 앱 창의 내용을 읽으려고 합니다.", detail, buttons, defaultId: cancelId, cancelId, noLink: true }, ctx);
    if (index === null) return { choice: "unavailable" };
    if (index < 0 || index >= cancelId) return { choice: "deny" };
    if (multiple) return { choice: "grant", window: windows[index] };
    return { choice: index === 0 ? "grant" : "once", window: windows[0] };
  }

  const declined = (what) => ({ status: "read_declined", userMessage: "사용자가 " + what + " 읽기를 거절했습니다. 화면 내용은 AI 모델에 보내지 않았습니다." });
  const consentUnavailable = { status: "read_consent_unavailable", userMessage: "화면 읽기 확인 창을 띄울 수 없어 읽지 않았습니다. 모디크루 설치 앱의 대화 화면에서 다시 요청해 주세요." };

  /**
   * 화면 요소 확인(읽기 전용). 사용자가 '화면 읽기 확인' 창에서 허용해야 읽은 내용을 돌려준다.
   * 앱 이름이 없으면 열린 앱 이름 목록만(허용 뒤) 돌려준다. 같은 대화·같은 창을 10분 안에 다시 읽을 때는 묻지 않는다.
   */
  async function inspect(input = {}, ctx = {}) {
    await ensureLoaded();
    const blocked = await gate();
    if (blocked) return blocked;
    const rootKey = desktopAppRootKey(ctx.workspaceRoot);
    const threadKey = threadKeyOf(ctx);
    const app = normalizeAppName(input.app, platform);
    if (!app) {
      const consent = await askAppListConsent(ctx);
      if (consent === "unavailable") return consentUnavailable;
      if (consent !== "allow") return declined("열린 앱 이름 목록");
      const out = await run(["list-apps"], 20_000);
      if (!out.envelope?.ok) return { status: "failed", userMessage: out.envelope?.error ? errorMessageFor(out.envelope.error) : errorMessages.AGENT_DESKTOP_FAILED };
      const names = [...new Set((out.envelope.data?.apps ?? []).map((item) => String(item.name ?? "")).filter((name) => name && !isBlockedApp(name)))].sort();
      return { status: "apps_listed", apps: names.slice(0, 60), consent: { scope: "once" }, userMessage: "사용자가 허용해 열린 앱 " + names.length + "개를 확인했습니다(앱 이름만 · 창 제목과 화면 내용은 읽지 않음). 조작할 앱을 정해 app 으로 다시 확인하세요." };
    }
    if (isBlockedApp(app)) return { status: "blocked", userMessage: app + " 은(는) PC 조작 대상으로 쓸 수 없습니다." };
    const listed = await listAppWindows(app);
    if (!listed.ok) return { status: listed.code === "APP_NOT_FOUND" ? "app_not_found" : "failed", code: listed.code, userMessage: listed.message };
    const titleFilter = norm(clip(input.windowTitle, 120));
    const windows = listed.windows.filter((win) => !titleFilter || norm(win.title).includes(titleFilter)).map(windowView);
    if (!windows.length) return { status: "app_not_found", code: "WINDOW_NOT_FOUND", userMessage: errorMessages.WINDOW_NOT_FOUND };
                                                           
    const granted = windows.filter((win) => activeGrant(rootKey, threadKey, win));
    let target = windows.length === 1 && granted.length === 1 ? windows[0] : !titleFilter && granted.length === 1 ? granted[0] : null;
    let scope = target ? "granted" : "";
    if (!target) {
      if (windows.length > maxWindowChoices) {
        return { status: "needs_window_choice", windowCount: windows.length, userMessage: "같은 앱 창이 " + windows.length + "개 열려 있습니다. 어떤 창인지 사용자에게 물어 창 제목 일부(windowTitle)로 좁혀 주세요(창 제목은 사용자 허용 전이라 보내지 않았습니다)." };
      }
      // 최소화된 창 하나뿐이면 읽을 수 없으니 묻지 않는다(agent-desktop 은 최소화된 창을 읽지 못함).
      if (windows.length === 1 && windows[0].minimized) return { status: "window_minimized", userMessage: errorMessages.WINDOW_MINIMIZED };
      const consent = await askWindowReadConsent(app, windows, ctx);
      if (consent.choice === "unavailable") return consentUnavailable;
      if (consent.choice === "deny") return declined(app + " 창 화면");
      target = consent.window;
      scope = consent.choice;
      if (consent.choice === "grant") readGrants.set(grantKey(rootKey, threadKey, target), { expiresAt: now().getTime() + readGrantTtlMs });
    }
    if (target.minimized) return { status: "window_minimized", userMessage: errorMessages.WINDOW_MINIMIZED };
    const snapshot = await observeWindow(target.id, { interactiveOnly: input.includeText !== true });
    if (!snapshot.ok) return { status: "failed", code: snapshot.code, userMessage: snapshot.message };
    const query = norm(input.query);
    const elements = snapshot.elements.filter((element) => !query || norm(element.name).includes(query) || norm(element.value).includes(query)).slice(0, maxInspectElements).map(presentElement);
    const grant = scope === "once" ? null : activeGrant(rootKey, threadKey, target);
    return {
      status: "read_completed", app, window: { title: target.title, focused: target.focused },
      elements, elementCount: snapshot.total, truncated: snapshot.total > elements.length, observedAt: now().toISOString(),
      consent: { scope: grant ? "window_10min" : "once", ...(grant ? { expiresAt: new Date(grant.expiresAt).toISOString() } : {}) },
      userMessage: "사용자가 허용해 " + app + " 창의 화면 요소 " + elements.length + "개를 읽었습니다(읽기 전용 · 화면 이미지 없음 · 비밀번호 칸 값은 숨김)" + (grant ? " · 이 대화에서 이 창은 " + timeLabel(new Date(grant.expiresAt).toISOString()) + "까지 다시 묻지 않음." : " · 이번 한 번만 허용됨."),
    };
  }

  const cardId = (id) => "pc-action:" + id;
  const preview = (value) => clip(String(value ?? "").replace(/\s+/gu, " "), 60);
  const stepLine = (step) => step.label + (step.name ? " · " + step.role + " '" + step.name + "'" : "") + (step.value !== undefined ? " ← \"" + preview(step.value) + "\"" : "");
  const timeLabel = (iso) => { const date = new Date(iso); return Number.isFinite(date.getTime()) ? date.getMonth() + 1 + "/" + date.getDate() + " " + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0") : "-"; };

  function summaryOf(record) {
    if (record.status === "awaiting_approval") return "승인하면 바로 실행합니다(승인 기한 " + timeLabel(record.expiresAt) + ").";
    if (record.status === "executing") return "승인됨 · 실행 중입니다.";
    return statusLabels[record.status] + (record.result?.summary ? " · " + record.result.summary : "");
  }

  function syncCard(record) {
    if (typeof inbox?.upsert !== "function") return;
    const statusMap = { awaiting_approval: "approval_pending", executing: "pending", completed: "completed", failed: "needs_review", uncertain: "needs_review", expired: "needs_review", cancelled: "rejected" };
    try {
      inbox.upsert({
        id: cardId(record.id),
        title: "PC 작업 · " + record.plan.app + " · " + clip(record.plan.purpose, 60),
        summary: summaryOf(record),
        body: [
          "대상: " + record.plan.app + (record.window?.title ? " 창 '" + record.window.title + "'" : ""),
          "단계: " + record.plan.steps.map((step, index) => index + 1 + ") " + stepLine(step)).join(" / "),
          "승인하면 각 단계를 한 번만 실행하고, 실행 뒤 화면을 다시 읽어 확인합니다. 실패해도 자동으로 다시 시도하지 않습니다. 화면 이미지는 저장·전송하지 않습니다. 실행 결과(단계별 결과와 다시 읽은 대상 요소 값)는 요청한 대화의 AI 모델에 전달됩니다. 지금 앱의 저장 위치가 요청한 곳과 다르면 실행하지 않습니다.",
          record.resultPath ? "결과 문서: " + record.resultPath : "",
        ].filter(Boolean).join(" · "),
        status: statusMap[record.status] ?? "needs_review",
        riskLabel: record.plan.risk === "high" ? "high" : "medium",
        riskSignals: (record.plan.warnings ?? []).map((reason, index) => ({ id: "pc-action-risk-" + index, label: "되돌리기 어려운 동작", riskLabel: "high", reason })),
        source: "messaging_command",
        sourceLabel: "PC 조작",
        senderLabel: "agent-desktop " + (record.toolVersion || ""),
        ...(record.teammateId ? { teammateId: record.teammateId, teammateName: record.teammateName || "AI 직원" } : {}),
        receivedAt: record.createdAt,
      }, { createdAt: record.updatedAt });
    } catch { /* 승인함 저장 실패는 기록·실행 판단에 영향 없음(기록 파일이 정본) */ }
  }

  function viewOf(record) {
    const state = workStateOfDesktopAppAction(record);
                                                                                     
    const disclosed = record.disclosed === true || Boolean(record.approvedVia);
    return {
      id: record.id, status: record.status, statusLabel: statusLabels[record.status] ?? record.status, workStatus: state.status, ...(state.reason ? { workReason: state.reason } : {}),
      app: record.plan.app, windowTitle: disclosed ? record.window?.title ?? "" : "", purpose: record.plan.purpose, steps: record.plan.steps.map(stepLine), risk: record.plan.risk, warnings: record.plan.warnings ?? [],
      createdAt: record.createdAt, updatedAt: record.updatedAt, expiresAt: record.expiresAt, approvedVia: record.approvedVia ?? "", approvalCardId: cardId(record.id),
      stepResults: (record.stepResults ?? []).map((step) => ({ step: step.index + 1, outcome: step.outcome, ...(step.code ? { code: step.code } : {}), ...(step.message ? { message: step.message } : {}) })),
      checks: (record.checks ?? []).map((check) => ({ expect: check.rule.expect, target: check.rule.name ? check.rule.role + " '" + check.rule.name + "'" : check.rule.contains, status: check.status, observed: check.observed })),
      summary: record.result?.summary ?? "", resultPath: record.resultPath ?? "",
    };
  }

  function startWatcher() {
    if (watcher || options.watch === false) return;
    watcher = setInterval(() => { void watchInbox(); }, options.watcherIntervalMs ?? watcherIntervalMs);
    watcher.unref?.();
  }

  function stopWatcher() {
    if (watcher) clearInterval(watcher);
    watcher = null;
  }

  /** 승인함 카드 결정 읽기: 승인 → 실행, 거절·수정 요청 → 취소, 기한 지남 → 만료. */
  async function watchInbox() {
    const pending = [...records.values()].filter((record) => record.status === "awaiting_approval");
    if (!pending.length) { stopWatcher(); return; }
    let cards = [];
    try { cards = typeof inbox?.snapshot === "function" ? inbox.snapshot() : []; } catch { cards = []; }
    for (const record of pending) {
      if (Date.parse(record.expiresAt) < now().getTime()) {
        syncCard(update(record, { status: "expired", result: { summary: "승인 기한이 지나 실행하지 않았습니다. 필요하면 다시 요청해 주세요." } }, "승인 기한 지남"));
        continue;
      }
      const card = cards.find((item) => item.id === cardId(record.id));
      if (!card) continue;
      if (card.status === "completed") {
        // 승인함은 회사(저장 위치)를 가리지 않고 한곳에 모인다. 지금 앱의 저장 위치가 요청한 곳과 같을 때만 실행한다.
        if (!(await rootMatchesNow(record))) {
          syncCard(update(record, { status: "failed", result: { summary: "지금 앱의 저장 위치(회사)가 요청한 곳과 달라 실행하지 않았습니다. 아무것도 바꾸지 않았습니다. 그 저장 위치로 돌아가 다시 요청해 주세요." } }, "승인함 승인 · 저장 위치 다름"));
          continue;
        }
        await execute(record.id, "inbox");
      } else if (card.status === "rejected" || card.status === "change_requested") {
        syncCard(update(record, { status: "cancelled", result: { summary: card.status === "rejected" ? "승인함에서 거절했습니다. 아무것도 바꾸지 않았습니다." : "승인함에서 수정 요청했습니다. 실행하지 않았습니다." } }, "승인함 결정: " + card.status));
      }
    }
  }

  /** 지금 앱의 저장 위치가 기록을 만든 곳과 같은지. 설치 앱에서 저장 위치를 알 수 없으면 실행하지 않는다. */
  async function rootMatchesNow(record) {
    const resolver = typeof currentWorkspaceRoot === "function" ? currentWorkspaceRoot : defaultCurrentWorkspaceRoot;
    let root = "";
    try { root = String((await resolver()) ?? ""); } catch { root = ""; }
    if (!root) return !process.versions?.electron;
    return desktopAppRootKey(root) === record.rootKey;
  }

  async function askApproval(record, ctx = {}) {
    if (typeof dialog?.showMessageBox !== "function") return "later";
    const detail = [
      "대상: " + record.plan.app + (record.window?.title ? " · 창 '" + record.window.title + "'" : " · 앱을 연 뒤 새 창"),
      ...record.plan.steps.map((step, index) => index + 1 + ") " + stepLine(step)),
      ...(record.plan.warnings ?? []).map((warning) => "주의: " + warning),
      "",
      "승인하면 단계마다 같은 창·같은 요소인지 다시 확인하고 한 번만 실행합니다. 실행 뒤 화면을 다시 읽어 결과를 확인합니다.",
      "실패하거나 결과가 불확실하면 자동으로 다시 시도하지 않습니다. 화면 이미지는 저장하거나 보내지 않습니다.",
      "실행 결과(단계별 결과와 다시 읽은 대상 요소 값)는 이 대화의 AI 모델에 전달됩니다.",
      "'승인함에 두기'를 고르면 승인함 카드에서 나중에 승인할 수 있습니다(" + timeLabel(record.expiresAt) + "까지).",
    ].join("\n");
    const box = { type: "question", title: "모디크루 PC 작업 확인", message: "AI 직원이 이 PC에서 아래 작업을 하려고 합니다.\n" + record.plan.purpose, detail, buttons: ["실행", "승인함에 두기", "취소"], defaultId: 2, cancelId: 2, noLink: true };
    const index = await showBox(box, ctx);
    if (index === null) return "later";
    return ["run", "later", "cancel"][index] ?? "cancel";
  }

  /** 승인 요청: 계획 검사 → 대상 창·첫 요소 사전 확인 → 기록·승인함 카드 → 실행 확인 창. */
  async function request(input = {}, ctx = {}) {
    await ensureLoaded();
    const blocked = await gate();
    if (blocked) return blocked;
    const checked = validateDesktopAppPlan(input, { platform });
    if (!checked.ok) return { status: "invalid_plan", errors: checked.errors, userMessage: checked.errors.join(" ") };
    const plan = checked.plan;
    const rootKey = desktopAppRootKey(ctx.workspaceRoot);
    const threadKey = threadKeyOf(ctx);
    let window = null;
    let disclosed = false;
    if (plan.steps[0].action !== "launch") {
      const resolved = await resolveWindow(plan.app, plan.windowTitle);
      // 창 제목은 화면 내용이다. 사용자가 허용하기 전에는 개수만 알리고 pc.inspect(확인 창에서 창 고르기)로 넘긴다.
      if (resolved.status === "ambiguous") return { status: "needs_window_choice", windowCount: resolved.windows?.length ?? 0, userMessage: resolved.message + " pc.inspect 로 확인하면 사용자가 확인 창에서 창을 고를 수 있습니다." };
      if (resolved.status !== "found") return { status: resolved.status === "not_found" ? "app_not_found" : "failed", code: resolved.code, userMessage: resolved.message };
      if (resolved.window.minimized) return { status: "window_minimized", userMessage: errorMessages.WINDOW_MINIMIZED };
      window = { id: resolved.window.id, pid: resolved.window.pid, title: resolved.window.title };
      disclosed = Boolean(activeGrant(rootKey, threadKey, window));
      const snapshot = await observeWindow(window.id, { interactiveOnly: true });
      if (!snapshot.ok) return { status: "failed", code: snapshot.code, userMessage: snapshot.message };
      const first = plan.steps[0];
      const match = matchElement(snapshot.elements, first);
      if (match.status !== "found") {
        return {
          status: match.status === "ambiguous" ? "ambiguous_target" : "element_not_found",
                                                              
          ...(disclosed ? { candidates: similarElements(snapshot.elements, first.role) } : {}),
          userMessage: "1단계 대상 " + first.role + " '" + first.name + "' " + (match.status === "ambiguous" ? "이(가) " + match.count + "개라 nth 로 몇 번째인지 정해 주세요." : "을(를) 지금 화면에서 찾지 못했습니다. " + (disclosed ? "pc.inspect 결과의 이름을 그대로 쓰세요." : "pc.inspect 로 화면 요소를 먼저 확인하세요(사용자가 화면 읽기를 허용해야 합니다).")),
        };
      }
      if (isSensitiveElement(match.element)) return { status: "blocked", userMessage: errorMessages.SENSITIVE_FIELD };
    }
    const planHash = digest(JSON.stringify(plan));
    const duplicate = [...records.values()].find((record) => record.rootKey === rootKey && recordThreadKey(record) === threadKey && record.planHash === planHash && (record.status === "awaiting_approval" || record.status === "executing"));
    if (duplicate) {
      return { status: duplicate.status === "executing" ? "running" : "needs_approval", action: viewOf(duplicate), userMessage: "같은 PC 작업이 이미 " + statusLabels[duplicate.status] + " 상태입니다. 중복으로 만들지 않았습니다." };
    }
    const createdAt = now().toISOString();
    const tool = await probe();
    const id = newId();
    let record = saveRecord({
      schema: desktopAppActionSchema, id, createdAt, updatedAt: createdAt, expiresAt: new Date(now().getTime() + approvalTtlMs).toISOString(),
      rootKey, threadKey, teammateId: clip(ctx.teammateId, 120), teammateName: clip(ctx.teammateName, 60), threadId: clip(ctx.threadId, 240),
      // 업무 이벤트는 PC 작업 하나에 하나. 승인함에서 나중에 승인돼도 같은 이벤트가 실행·완료로 바뀐다.
      eventId: "pc-action-" + id, disclosed,
      toolVersion: tool.version ?? "", plan, planHash, window, status: "awaiting_approval", events: [{ at: createdAt, status: "awaiting_approval" }],
    });
    syncCard(record);
    pushWorkEvent(record);
    startWatcher();
    const choice = await askApproval(record, ctx);
    record = records.get(record.id) ?? record;
    if (record.status !== "awaiting_approval") return { status: record.status, action: viewOf(record), userMessage: "승인함에서 이미 처리된 작업입니다: " + statusLabels[record.status] };
    if (choice === "run") return execute(record.id, "dialog");
    if (choice === "cancel") {
      record = update(record, { status: "cancelled", result: { summary: "실행 확인 창에서 취소했습니다. 아무것도 바꾸지 않았습니다." } }, "확인 창 취소");
      syncCard(record);
      return { status: "cancelled", action: viewOf(record), userMessage: "사용자가 실행을 취소했습니다. 아무것도 바꾸지 않았습니다." };
    }
    return { status: "needs_approval", action: viewOf(record), userMessage: "승인함에 'PC 작업' 카드를 올렸습니다. 사용자가 승인하면 바로 실행하고 결과를 기록합니다." };
  }

  async function launchApp(app) {
    const before = await listAppWindows(app);
    const known = new Set((before.ok ? before.windows : []).map((win) => String(win.id)));
    const out = await run(["launch", app, "--timeout", "30000"], 45_000);
    const launched = classifyActionEnvelope(out);
    if (launched.outcome === "not_delivered" || launched.outcome === "uncertain") return launched;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(750);
      const after = await listAppWindows(app);
      const windows = after.ok ? after.windows : [];
      const fresh = windows.find((win) => !known.has(String(win.id))) ?? (windows.length === 1 ? windows[0] : null);
      if (fresh) return { outcome: "verified", delivery: "window_found", window: windowView(fresh) };
    }
    return { outcome: "uncertain", code: "WINDOW_NOT_FOUND", message: "앱은 열었지만 새 창을 확인하지 못했습니다." };
  }

  async function runStep(step, window) {
    let last = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // 조작 전 화면 읽기(아무것도 바꾸지 않음). 일시 오류는 observeWindow 가 한 번 더 읽는다.
      const snapshot = await observeWindow(window.id, { interactiveOnly: true });
      if (!snapshot.ok) return { index: step.index, outcome: "not_delivered", code: snapshot.code, message: snapshot.message, ...(snapshot.raw ? { raw: snapshot.raw } : {}) };
      const match = matchElement(snapshot.elements, step);
      if (match.status !== "found") {
        return { index: step.index, outcome: "not_delivered", code: match.status === "ambiguous" ? "AMBIGUOUS_TARGET" : "ELEMENT_NOT_FOUND", message: match.status === "ambiguous" ? errorMessages.AMBIGUOUS_TARGET : errorMessages.ELEMENT_NOT_FOUND, candidates: similarElements(snapshot.elements, step.role) };
      }
      if (isSensitiveElement(match.element)) return { index: step.index, outcome: "not_delivered", code: "SENSITIVE_FIELD", message: errorMessages.SENSITIVE_FIELD };
      const args = [cliVerbs[step.action], match.element.ref, ...(valueActions.has(step.action) ? [step.value] : []), "--timeout-ms", String(actionTimeoutMs)];
      const started = Date.now();
      const out = await run(args, actionTimeoutMs + 15_000);
      last = { index: step.index, ...classifyActionEnvelope(out), ms: Date.now() - started };
      // 전달 안 됨(다시 해도 안전)이고 화면이 바뀌었을 수 있는 경우에만 한 번 더 찾는다.
      if (last.outcome === "not_delivered" && retryableCodes.has(last.code) && attempt === 0) continue;
      return last;
    }
    return last;
  }

  /** 승인된 작업 실행. 한 번에 하나만, 단계마다 다시 확인, 전달 안 됨 외에는 다시 시도하지 않는다. */
  async function execute(id, via) {
    const first = records.get(id);
    if (!first) return { status: "not_found", userMessage: "PC 작업 기록을 찾지 못했습니다." };
    if (first.status !== "awaiting_approval") return { status: first.status, action: viewOf(first), userMessage: "이미 " + statusLabels[first.status] + " 상태인 작업입니다. 다시 실행하지 않았습니다." };
    if (busy) return { status: "busy", action: viewOf(first), userMessage: "다른 PC 작업을 실행하고 있습니다. 끝난 뒤 승인함에서 다시 승인해 주세요." };
    busy = true;
    try {
      const tool = await probe(true);
      if (!tool.ready) {
        const failed = update(first, { status: "failed", result: { summary: tool.userMessage + " 아무것도 실행하지 않았습니다." } }, "도구 연결 문제");
        syncCard(failed);
        return { status: "failed", action: viewOf(failed), userMessage: failed.result.summary };
      }
      // 실행 시작을 먼저 저장한다 — 실행 중 앱이 꺼져도 '결과 확인 필요'로 남아 다시 실행되지 않는다.
      let record = update(first, { status: "executing", approvedVia: via, approvedAt: now().toISOString(), toolVersion: tool.version }, via === "inbox" ? "승인함에서 승인" : "실행 확인 창에서 승인");
      syncCard(record);
      const stepResults = [];
      let window = record.window;
      let stop = null;
      for (const step of record.plan.steps) {
        if (step.action === "launch") {
          const launched = await launchApp(record.plan.app);
          stepResults.push({ index: step.index, outcome: launched.outcome, ...(launched.code ? { code: launched.code } : {}), ...(launched.message ? { message: launched.message } : {}), ...(launched.delivery ? { delivery: launched.delivery } : {}) });
          if (launched.outcome !== "verified") { stop = { index: step.index, ...launched }; break; }
          window = { id: launched.window.id, pid: launched.window.pid, title: launched.window.title };
          record = update(record, { window }, "앱을 열고 새 창을 확인");
          continue;
        }
        let resolved = window ? await resolveWindow(record.plan.app, "", window) : await resolveWindow(record.plan.app, record.plan.windowTitle);
        if (resolved.status === "error" && retryableCodes.has(resolved.code)) {
          resolved = window ? await resolveWindow(record.plan.app, "", window) : await resolveWindow(record.plan.app, record.plan.windowTitle);
        }
        if (resolved.status !== "found") { stop = { index: step.index, outcome: "not_delivered", code: resolved.code, message: resolved.message }; stepResults.push(stop); break; }
        if (resolved.window.minimized) { stop = { index: step.index, outcome: "not_delivered", code: "WINDOW_MINIMIZED", message: errorMessages.WINDOW_MINIMIZED }; stepResults.push(stop); break; }
        window = window ?? { id: resolved.window.id, pid: resolved.window.pid, title: resolved.window.title };
        const result = await runStep(step, window);
        stepResults.push(result);
        if (result.outcome !== "verified" && result.outcome !== "delivered_unverified") { stop = result; break; }
      }
      const deliveredSteps = new Set(stepResults.filter((step) => step.outcome === "verified" || step.outcome === "delivered_unverified").map((step) => step.index));
      let checks = [];
      if (window && deliveredSteps.size) {
        const post = await observeWindow(window.id, { interactiveOnly: false });
        const rules = record.plan.verify.filter((rule) => rule.step === undefined ? !stop : deliveredSteps.has(rule.step));
        checks = post.ok ? evaluateVerifications(rules, post.elements) : rules.map((rule) => ({ rule, status: "not_found", observed: "다시 읽기 실패: " + post.message }));
      }
      const failedCheck = checks.find((check) => check.status !== "pass");
      let status;
      let summary;
      if (stop?.outcome === "uncertain") {
        status = "uncertain";
        summary = stop.index + 1 + "단계 결과를 확인하지 못했습니다(" + (stop.message || stop.code) + "). 다시 시도하지 않았습니다. 화면을 직접 확인해 주세요.";
      } else if (stop) {
        status = "failed";
        summary = (stop.index ?? 0) + 1 + "단계에서 멈췄습니다: " + (stop.message || stop.code) + (deliveredSteps.size ? " 앞의 " + deliveredSteps.size + "단계는 실행됐습니다." : " 아무것도 바꾸지 않았습니다.");
      } else if (failedCheck) {
        status = "uncertain";
        summary = "단계는 모두 전달됐지만 화면 재확인이 기대와 다릅니다(" + (failedCheck.rule.name ? failedCheck.rule.role + " '" + failedCheck.rule.name + "'" : "'" + failedCheck.rule.contains + "'") + " → " + (failedCheck.observed || "찾지 못함") + "). 다시 시도하지 않았습니다.";
      } else {
        status = "completed";
        const unverified = stepResults.filter((step) => step.outcome === "delivered_unverified").length;
        summary = deliveredSteps.size + "단계 실행" + (checks.length ? " · 화면 재확인 " + checks.length + "건 일치" : "") + (unverified ? " · 앱이 확인 신호를 주지 않은 " + unverified + "단계는 화면 재확인으로만 판단" : "");
      }
      const keep = (step) => ({ index: step.index, outcome: step.outcome, ...(step.code ? { code: step.code } : {}), ...(step.message ? { message: step.message } : {}), ...(step.raw ? { raw: step.raw } : {}), ...(step.delivery ? { delivery: step.delivery } : {}), ...(step.ms ? { ms: step.ms } : {}), ...(step.candidates ? { candidates: step.candidates } : {}) });
      record = update(record, { status, finishedAt: now().toISOString(), stepResults: stepResults.map(keep), checks, result: { summary } }, statusLabels[status]);
      record = writeResultDocument(record);
      syncCard(record);
      return { status, action: viewOf(record), userMessage: summary };
    } finally {
      busy = false;
    }
  }

  function writeResultDocument(record) {
    try {
      mkdirSync(resultsDir(), { recursive: true });
      const file = path.join(resultsDir(), record.id + ".md");
      const cell = (value) => String(value ?? "").replace(/\|/gu, "/").replace(/\s+/gu, " ").trim() || "-";
      const lines = [
        "# PC 작업 결과 — " + cell(record.plan.purpose), "",
        "- 상태: " + statusLabels[record.status] + " — " + cell(record.result?.summary),
        "- 대상: " + record.plan.app + (record.window?.title ? " · 창 '" + cell(record.window.title) + "'" : ""),
        "- 요청: " + record.createdAt + (record.teammateName ? " · " + cell(record.teammateName) : ""),
        "- 승인: " + (record.approvedAt ?? "-") + " · " + (record.approvedVia === "inbox" ? "승인함" : record.approvedVia === "dialog" ? "실행 확인 창" : "-"),
        "- 도구: agent-desktop " + (record.toolVersion || "?") + " (공식 CLI · headless 의미 조작 · 화면 이미지 없음)", "",
        "## 단계", "", "| # | 조작 | 대상 | 값 | 결과 | 비고 |", "|---|---|---|---|---|---|",
        ...record.plan.steps.map((step) => {
          const result = (record.stepResults ?? []).find((item) => item.index === step.index);
          return "| " + (step.index + 1) + " | " + step.label + " | " + cell(step.name ? step.role + " '" + step.name + "'" : record.plan.app) + " | " + cell(step.value !== undefined ? preview(step.value) : "") + " | " + cell(result?.outcome ?? "실행 안 함") + " | " + cell(result?.message ?? result?.delivery ?? "") + " |";
        }),
        "", "## 화면 재확인", "", "| 확인 | 대상 | 결과 | 관찰값 |", "|---|---|---|---|",
        ...((record.checks ?? []).length ? record.checks.map((check) => "| " + check.rule.expect + " | " + cell(check.rule.name ? check.rule.role + " '" + check.rule.name + "'" : check.rule.contains) + " | " + check.status + " | " + cell(check.observed) + " |") : ["| - | - | 확인 규칙 없음 | - |"]),
        "", "## 확인하지 못한 것·제한", "",
        "- delivered_unverified 단계는 앱이 확인 신호를 주지 않은 조작입니다. 위 화면 재확인 결과로만 판단했습니다.",
        "- 화면 이미지는 만들거나 저장하지 않았습니다. 접근성 요소(역할·이름·값·상태)만 읽었습니다.",
        "- 실패·불확실한 단계는 자동으로 다시 시도하지 않았습니다.", "",
      ];
      writeFileSync(file, lines.join("\n"), "utf8");
      return update(record, { resultPath: file }, "결과 문서 저장");
    } catch (error) {
      return update(record, { resultSaveError: clip(error?.message ?? error, 200) }, "결과 문서 저장 실패");
    }
  }

  /** 기록의 대화 범위(이번 변경 전 기록은 남아 있는 대화 id·직원으로 계산). */
  const recordThreadKey = (record) => record.threadKey ?? threadKeyOf({ threadId: record.threadId, teammateId: record.teammateId });

  /** 같은 저장 위치·같은 대화의 기록만 꺼낸다. 다른 대화의 PC 작업은 상태·결과·취소 모두 보이지 않는다. */
  function scoped(id, ctx = {}) {
    const record = idPattern.test(String(id ?? "")) ? records.get(String(id)) : null;
    if (!record || record.rootKey !== desktopAppRootKey(ctx.workspaceRoot) || recordThreadKey(record) !== threadKeyOf(ctx)) return null;
    return record;
  }

  /** 승인함에 두었던 작업을 대화에서 다시 실행하려 해도 실행 확인 창을 다시 거친다. */
  async function runAgain(id, ctx = {}) {
    await ensureLoaded();
    const blocked = await gate();
    if (blocked) return blocked;
    const record = scoped(id, ctx);
    if (!record) return { status: "not_found", userMessage: "이 대화·저장 위치에서 그 PC 작업 기록을 찾지 못했습니다." };
    if (record.status !== "awaiting_approval") return { status: record.status, action: viewOf(record), userMessage: "이미 " + statusLabels[record.status] + " 상태라 다시 실행하지 않습니다. 필요하면 새로 요청해 주세요." };
    const choice = await askApproval(record, ctx);
    const current = records.get(record.id) ?? record;
    if (current.status !== "awaiting_approval") return { status: current.status, action: viewOf(current), userMessage: "승인함에서 이미 처리된 작업입니다: " + statusLabels[current.status] };
    if (choice === "run") return execute(record.id, "dialog");
    if (choice === "cancel") {
      const cancelled = update(current, { status: "cancelled", result: { summary: "실행 확인 창에서 취소했습니다." } }, "확인 창 취소");
      syncCard(cancelled);
      return { status: "cancelled", action: viewOf(cancelled), userMessage: "사용자가 실행을 취소했습니다." };
    }
    return { status: "needs_approval", action: viewOf(current), userMessage: "아직 승인 대기입니다. 승인함 카드에서도 승인할 수 있습니다." };
  }

  async function cancel(id, ctx = {}) {
    await ensureLoaded();
    const record = scoped(id, ctx);
    if (!record) return { status: "not_found", userMessage: "이 대화·저장 위치에서 그 PC 작업 기록을 찾지 못했습니다." };
    if (record.status !== "awaiting_approval") return { status: record.status, action: viewOf(record), userMessage: statusLabels[record.status] + " 상태라 취소할 수 없습니다." };
    const cancelled = update(record, { status: "cancelled", result: { summary: "대화에서 취소했습니다. 아무것도 바꾸지 않았습니다." } }, "대화에서 취소");
    syncCard(cancelled);
    return { status: "cancelled", action: viewOf(cancelled), userMessage: "PC 작업을 취소했습니다." };
  }

  async function status(id, ctx = {}) {
    await ensureLoaded();
    if (id) {
      const record = scoped(id, ctx);
      return record
        ? { status: "found", action: viewOf(record), userMessage: statusLabels[record.status] + (record.result?.summary ? " · " + record.result.summary : "") }
        : { status: "not_found", userMessage: "이 대화·저장 위치에서 그 PC 작업 기록을 찾지 못했습니다." };
    }
    const rootKey = desktopAppRootKey(ctx.workspaceRoot);
    const threadKey = threadKeyOf(ctx);
    const list = [...records.values()].filter((record) => record.rootKey === rootKey && recordThreadKey(record) === threadKey).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 20).map(viewOf);
    return { status: "list", actions: list, userMessage: list.length ? "이 대화의 최근 PC 작업 " + list.length + "건입니다." : "이 대화의 PC 작업 기록이 없습니다." };
  }

  async function openResult(id, ctx = {}) {
    await ensureLoaded();
    const record = scoped(id, ctx);
    if (!record?.resultPath || !existsSync(record.resultPath)) return { status: "not_found", userMessage: "열 수 있는 결과 문서가 없습니다." };
    const opener = options.openPath ?? (async (file) => { const electron = await electronModule(); return electron?.shell?.openPath ? electron.shell.openPath(file) : "열기 기능을 찾지 못했습니다."; });
    const error = await opener(record.resultPath);
    return error ? { status: "failed", userMessage: "결과 문서를 열지 못했습니다: " + clip(error, 120) } : { status: "opened", userMessage: "결과 문서를 열었습니다." };
  }

  /** 내 확인 필요(크루 스킬 실행기의 attention 이 함께 모은다). 같은 저장 위치 것만. */
  async function attention(workspaceRoot) {
    await ensureLoaded();
    const rootKey = desktopAppRootKey(workspaceRoot);
    return [...records.values()].filter((record) => record.rootKey === rootKey).map((record) => ({
      id: cardId(record.id), source: "approval", title: "PC 작업 · " + record.plan.app + " · " + clip(record.plan.purpose, 60),
      detail: summaryOf(record), ...workStateOfDesktopAppAction(record), approvalId: cardId(record.id), runId: record.id,
      ...(record.teammateId ? { teammateId: record.teammateId } : {}), ...(record.threadId ? { threadId: record.threadId } : {}),
      scopeKey: rootKey, updatedAt: record.updatedAt,
    }));
  }

  return {
    attach(next = {}) {
      if (next.dialog) dialog = next.dialog;
      if (typeof next.inbox?.upsert === "function" || typeof next.inbox?.snapshot === "function") inbox = next.inbox;
      if (typeof next.currentWorkspaceRoot === "function") currentWorkspaceRoot = next.currentWorkspaceRoot;
      if (typeof next.workEvents === "function") writeWorkEvent = next.workEvents;
    },
    probe, inspect, request, runAgain, cancel, status, openResult, attention, ensureLoaded,
    /** 시험용: 승인함 감시를 한 번 돌린다. */
    tick: watchInbox,
    stop: stopWatcher,
  };
}

let sharedControl = null;
/** 메인 프로세스에서 하나만 쓴다(실행 잠금·승인함 감시를 공유). */
export function getDesktopAppControl(deps = {}) {
  sharedControl ??= createDesktopAppControl({});
  sharedControl.attach({ dialog: deps.dialog, inbox: { upsert: deps.upsertInboxItem, snapshot: deps.getInboxSnapshot }, currentWorkspaceRoot: deps.currentWorkspaceRoot, workEvents: deps.writeWorkEvent });
  return sharedControl;
}

/** 크루 스킬 실행기의 '내 확인 필요'가 같은 저장 위치의 PC 작업을 함께 보여 주도록 기록 파일만 읽는다(기록을 바꾸지 않음). */
export async function listDesktopAppActionAttention(userDataRoot, workspaceRoot) {
  const control = createDesktopAppControl({ root: userDataRoot, watch: false, runner: async () => ({ envelope: null }) });
  return control.attention(workspaceRoot);
}

/** 확장 추가 전 점검·확장 센터 상태용: 실행 파일·버전·접근성 권한만 확인한다(기록을 만들지 않음). */
export async function probeAgentDesktop(userDataRoot, options = {}) {
  const control = createDesktopAppControl({ root: userDataRoot, watch: false, ...options });
  return control.probe(true);
}
