// 창을 닫아 둔 동안에도 사용자가 알아야 할 일을 트레이·OS 알림으로 알려 주는 순수 도우미.
//
// Electron 을 import 하지 않는다. main.mjs 가 BrowserWindow·Tray·Notification 을 쥐고,
// "무엇을 언제 알릴지"와 "알림을 누르면 어디로 갈지"는 여기서 정한다.
// 그래서 node --test 로 바로 검증할 수 있다(tests/desktop/background-presence.test.mjs).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** main → renderer: 알림을 눌렀을 때 이미 열려 있는 창 안에서 그 카드로 이동하라는 신호. */
export const workItemFocusChannel = "mody.focus-work-item.v1";
/** main → renderer: 승인함(인박스)이 바뀌었다는 신호. 개수와 판번호를 함께 싣는다. */
export const inboxChangedChannel = "mody.inbox.changed";
/** PC 켤 때 자동 실행하면 창 없이 트레이로만 시작한다. */
export const hiddenLaunchFlag = "--hidden";
export const backgroundPresencePreferencesFileName = "background-presence.json";

const pendingApprovalStatuses = new Set(["approval_pending", "draft_ready", "needs_review"]);
const focusQueues = new Set(["approval", "deadline", "meeting", "today"]);
/** 승인함 카드가 아닌 이동 대상. "task" = 업무판(TaskBoard)의 맡긴 업무. */
const focusKinds = new Set(["task"]);

/**
 * 결정할 것이 없는 "안내용" 카드. 메일 자동 점검 결과 알림과 일정 브리핑은 읽기만 하는
 * 카드라 승인 대기 개수에 넣으면 진짜 답장 카드가 묻힌다.
 */
export function isNoticeOnlyInboxItem(item) {
  if (!item || typeof item !== "object") return true;
  const id = String(item.id ?? "");
  if (id.startsWith("mail-automation-notification:")) return true;
  if (id.startsWith("schedule-briefing:")) return true;
  if (item.sourceEvidence?.providerId === "mail_automation_runner") return true;
  if (item.scheduleBriefing) return true;
  return false;
}

export function countPendingApprovalInboxItems(items) {
  if (!Array.isArray(items)) return 0;
  let count = 0;
  for (const item of items) {
    if (!item || !pendingApprovalStatuses.has(item.status)) continue;
    if (isNoticeOnlyInboxItem(item)) continue;
    count += 1;
  }
  return count;
}

function inboxAttentionSignature(items) {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => `${String(item?.id ?? "")}:${String(item?.status ?? "")}:${String(item?.finalAction?.readiness ?? "")}:${String(item?.draft?.body ?? "").length}`)
    .join("|");
}

/**
 * 인박스가 실제로 바뀌었을 때만 판번호를 올린다. 같은 목록을 여러 번 봐도 신호를 다시
 * 보내지 않으므로, 호출하는 쪽은 아무 때나 불러도 된다.
 */
export function createInboxAttentionTracker() {
  let signature = null;
  let revision = 0;
  let pendingApprovalCount = 0;
  return {
    observe(items) {
      const nextSignature = inboxAttentionSignature(items);
      if (nextSignature === signature) {
        return { changed: false, revision, pendingApprovalCount };
      }
      signature = nextSignature;
      revision += 1;
      pendingApprovalCount = countPendingApprovalInboxItems(items);
      return { changed: true, revision, pendingApprovalCount };
    },
    current() {
      return { revision, pendingApprovalCount };
    },
  };
}

const taskAttentionStates = new Set(["waiting_input", "waiting_approval", "failed"]);

/** 사람의 답·확인·재시도를 기다리며 멈춰 있는 맡긴 업무 수. */
export function countTaskAttention(tasks) {
  if (!Array.isArray(tasks)) return 0;
  let count = 0;
  for (const task of tasks) {
    if (task?.status === "done") continue;
    if (taskAttentionStates.has(String(task?.execution?.state ?? ""))) count += 1;
  }
  return count;
}

/**
 * 트레이 툴팁·메뉴 문구. 승인함 카드와 맡긴 업무는 사는 곳이 다르다(승인함 보기 / 업무판).
 * 그래서 메뉴 줄을 나눠, 누르면 각자 제자리로 가게 한다. 툴팁은 합계만 보여 준다.
 */
export function buildTrayPresence(input = {}) {
  const approvals = Math.max(0, Math.floor(Number(input.pendingApprovalCount) || 0));
  const tasks = Math.max(0, Math.floor(Number(input.taskAttentionCount) || 0));
  const count = approvals + tasks;
  const menuLines = [];
  if (approvals > 0) menuLines.push({ target: "approval", label: `승인을 기다리는 일 ${approvals}건 보기` });
  if (tasks > 0) menuLines.push({ target: "task", label: `봐 주실 맡긴 일 ${tasks}건 보기` });
  return {
    count,
    approvalCount: approvals,
    taskCount: tasks,
    tooltip: count > 0
      ? `ModyCrew · 확인을 기다리는 일 ${count}건`
      : "ModyCrew · 켜 둔 자동화와 예약 업무를 기다립니다",
    menuLines,
    idleLabel: "확인을 기다리는 일 없음",
    overlayDescription: count > 0 ? `확인을 기다리는 일 ${count}건` : "",
  };
}

/**
 * 작업 표시줄 아이콘 위에 얹는 작은 점(주의 표시). nativeImage.createFromBitmap 에 바로
 * 넣을 수 있는 BGRA 버퍼를 만든다. 숫자는 설명 문구(overlayDescription)로 읽힌다.
 */
export function createAttentionDotBitmap(size = 16) {
  const side = Math.max(8, Math.min(64, Math.floor(Number(size) || 16)));
  const buffer = Buffer.alloc(side * side * 4);
  const center = (side - 1) / 2;
  const radius = side / 2 - 0.5;
  // #D93D3D — 빨간 주의 점. 테두리는 흰색 1px 로 어두운 작업 표시줄에서도 보이게 한다.
  const fill = { b: 0x3d, g: 0x3d, r: 0xd9 };
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - distance));
      if (coverage <= 0) continue;
      const offset = (y * side + x) * 4;
      const isRim = distance > radius - 1.2;
      const color = isRim ? { b: 0xff, g: 0xff, r: 0xff } : fill;
      const alpha = Math.round(coverage * 255);
      // 미리 곱한(premultiplied) 알파로 저장한다.
      buffer[offset] = Math.round((color.b * alpha) / 255);
      buffer[offset + 1] = Math.round((color.g * alpha) / 255);
      buffer[offset + 2] = Math.round((color.r * alpha) / 255);
      buffer[offset + 3] = alpha;
    }
  }
  return { buffer, width: side, height: side };
}

function cleanLine(value, max) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);
}

function taskStateOf(result) {
  return String(result?.status ?? "").replace(/^task_execution_/u, "");
}

function isScheduledTask(task) {
  const due = Date.parse(task?.execution?.dueAt ?? "");
  const created = Date.parse(task?.createdAt ?? "");
  return Number.isFinite(due) && Number.isFinite(created) && due - created > 60_000;
}

function isRepeatTask(task) {
  const repeat = String(task?.execution?.repeat ?? "none");
  return repeat !== "" && repeat !== "none";
}

// 대소문자를 가리는 모양(오류 코드·식별자)과 가리지 않는 영어 오류 낱말을 따로 본다.
const developerErrorShapePattern = new RegExp(
  [
    String.raw`\d+\.\d+\.\d+`, // IP 주소·버전 번호
    String.raw`:\d{2,5}\b`, // 포트
    String.raw`\b[A-Z][A-Z0-9_]{4,}\b`, // ECONNREFUSED·ENOENT 같은 오류 코드
    String.raw`[a-z][A-Z]|[A-Za-z]_[A-Za-z]`, // camelCase·snake_case 식별자
    String.raw`[\\{}<>=\x60]|https?:|\/\w+\/`, // 경로·코드·주소("메일/일정" 같은 빗금은 괜찮다)
    String.raw`\bat\s+\S+\s*\(`, // 스택 줄
  ].join("|"),
  "u",
);
const developerErrorWordPattern =
  /\b(?:error|exception|undefined|null|nan|json|stack|fetch|failed|cannot|unexpected|timeout|denied|refused)\b/iu;

/**
 * OS 알림에 실어도 되는 쉬운 한국어 이유인지. 영어 오류 원문이나 한글이 조금 섞인
 * 개발자 문구("실행 실패: ECONNREFUSED 127.0.0.1:5173")는 싣지 않는다.
 */
export function isPlainKoreanReason(text) {
  const value = String(text ?? "");
  const hangul = (value.match(/[가-힣]/gu) ?? []).length;
  if (hangul === 0) return false;
  const latin = (value.match(/[A-Za-z]/gu) ?? []).length;
  if (latin > hangul) return false;
  return !developerErrorShapePattern.test(value) && !developerErrorWordPattern.test(value);
}

/**
 * 업무 실행기의 상태 변화 한 건을 보고, 사용자에게 알릴 일인지 판단한다.
 * - 답이 필요할 때(waiting_input), 결과 확인이 필요할 때(waiting_approval), 멈췄을 때(failed)
 * - 예약·반복 업무가 끝났을 때(completed, 또는 반복 업무가 한 번 돌고 다시 대기로 돌아왔을 때)
 * 같은 상태를 두 번 알리지 않도록 "무엇 때문에" 알렸는지까지 열쇠로 남긴다.
 */
export function describeTaskAttention(result, nowMs = Date.now()) {
  const taskId = cleanLine(result?.taskId, 160);
  if (!taskId) return null;
  const task = Array.isArray(result?.tasks) ? result.tasks.find((row) => row?.id === taskId) : null;
  const state = taskStateOf(result);
  const title = cleanLine(result?.title || task?.title || "맡긴 업무", 60) || "맡긴 업무";
  const lastQuestion = Array.isArray(task?.humanQA) ? task.humanQA.at(-1) : null;
  const lastCompletedAt = String(task?.execution?.lastCompletedAt ?? "");
  if (state === "waiting_input") {
    const question = cleanLine(result?.question || lastQuestion?.question, 120);
    return {
      taskId,
      key: `waiting_input:${lastQuestion?.askedAt || question}`,
      title: "AI 직원이 여쭤볼 게 있어요",
      body: question ? `${title} — ${question}` : `${title} — 답을 주시면 이어서 할게요.`,
    };
  }
  if (state === "waiting_approval") {
    return {
      taskId,
      key: `waiting_approval:${lastCompletedAt || task?.updatedAt || ""}`,
      title: "확인해 주실 결과가 준비됐어요",
      body: `${title} — 보내거나 등록하기 전에 한 번 봐 주세요.`,
    };
  }
  if (state === "failed") {
    const rawReason = cleanLine(result?.errorMessage || task?.execution?.error, 100);
    // 영어 오류 원문·개발자용 문구는 알림에 싣지 않는다.
    const reason = isPlainKoreanReason(rawReason) ? rawReason : "";
    return {
      taskId,
      key: `failed:${task?.updatedAt || rawReason}`,
      title: "맡긴 일이 멈췄어요",
      body: `${title} — ${reason || "업무판에서 이유를 확인하고 다시 시도해 주세요."}`,
    };
  }
  const justCompleted = lastCompletedAt && nowMs - Date.parse(lastCompletedAt) <= 5 * 60_000;
  if (state === "completed" && (isRepeatTask(task) || isScheduledTask(task))) {
    return {
      taskId,
      key: `completed:${lastCompletedAt || task?.updatedAt || ""}`,
      title: "맡긴 일을 끝냈어요",
      body: `${title} — 결과를 업무판에 저장했어요.`,
    };
  }
  if (state === "queued" && isRepeatTask(task) && justCompleted) {
    return {
      taskId,
      key: `completed:${lastCompletedAt}`,
      title: "반복 업무를 한 번 마쳤어요",
      body: `${title} — 결과를 업무판에 저장했어요. 다음 차례에 또 할게요.`,
    };
  }
  return null;
}

/**
 * 업무별로 이미 알린 열쇠를 기억해 같은 알림을 되풀이하지 않는다.
 * 실행기는 체크포인트·재시도·일시정지마다 상태를 알리므로, 상태만으로 거르면 같은 질문이
 * 두 번 뜨거나(재시도 뒤) 새 질문을 놓친다(같은 waiting_input). 그래서 질문 시각·완료 시각까지 본다.
 */
export function createTaskAttentionNotifier(options = {}) {
  const maxTasks = Math.max(10, Number(options.maxTasks ?? 300) || 300);
  const now = typeof options.now === "function" ? options.now : Date.now;
  const seenByTask = new Map();
  return {
    consider(result) {
      const attention = describeTaskAttention(result, now());
      if (!attention) return null;
      const seen = seenByTask.get(attention.taskId) ?? [];
      if (seen.includes(attention.key)) return null;
      seenByTask.delete(attention.taskId);
      seenByTask.set(attention.taskId, [...seen, attention.key].slice(-6));
      while (seenByTask.size > maxTasks) {
        const oldest = seenByTask.keys().next().value;
        seenByTask.delete(oldest);
      }
      return attention;
    },
  };
}

export function sanitizeFocusWorkItemId(value) {
  return String(value ?? "")
    .replace(/[^A-Za-z0-9:_./-]/g, "")
    .slice(0, 180);
}

export function sanitizeFocusQueue(value) {
  const text = String(value ?? "").trim();
  return focusQueues.has(text) ? text : "";
}

export function sanitizeFocusKind(value) {
  const text = String(value ?? "").trim();
  return focusKinds.has(text) ? text : "";
}

/**
 * 알림을 누르면 어느 창으로 갈지.
 * - 맡긴 업무(질문·확인 대기·중단·예약 완료)는 업무 오피스 창의 업무판(office_task).
 *   답하기·다시 시도·끝냈어요가 모두 업무판에 있다. 승인함 보기에는 그 카드가 없다.
 * - 일정 브리핑·메일→일정 카드는 본창(대화 화면)의 업무 패널에서 보여 준다.
 * - 그 밖의 승인함 카드는 업무 오피스 창의 승인함 보기(office).
 */
export function classifyNotificationFocusTarget(input = {}) {
  if (sanitizeFocusKind(input.focusKind ?? input.kind) === "task") return "office_task";
  const workItemId = sanitizeFocusWorkItemId(input.workItemId);
  const queue = sanitizeFocusQueue(input.queueFilter ?? input.queue);
  if (!workItemId) return "main";
  if (workItemId.includes("schedule-briefing") || workItemId.includes("mail-calendar")) return "main";
  if (queue === "approval") return "office";
  return "main";
}

/**
 * 이미 떠 있는 창이면 다시 불러오지 않는다(작성 중인 글·진행 중인 답변이 사라지므로).
 * - send: 화면이 신호를 받을 준비가 됐다 → 신호만 보낸다.
 * - pending: 앱 화면을 불러오는 중이다 → 맡겨 두면 화면이 뜨자마자 가져간다.
 * - load_url: 앱 화면이 아닌 것이 떠 있다(빌드 안내 등) → 주소로 연다.
 */
export function planWorkItemFocusDelivery(input = {}) {
  // 방금 만든 창은 아직 화면이 없다. 맡겨 두면 화면이 뜨자마자 가져간다.
  if (input.windowJustCreated === true) return "pending";
  // 화면 프로세스가 죽은 창은 주소가 앱 화면이어도 아무것도 받지 못한다. 다시 불러와 살린다.
  if (input.rendererGone === true) return "load_url";
  if (input.rendererReady === true) return "send";
  if (isAppContentUrl(input.windowUrl, input.appBaseUrls)) return "pending";
  if (input.windowUrl === "" && input.isLoading === true) return "pending";
  return "load_url";
}

export function isAppContentUrl(url, appBaseUrls = []) {
  const text = String(url ?? "");
  if (!text) return false;
  return (Array.isArray(appBaseUrls) ? appBaseUrls : [])
    .filter(Boolean)
    .some((base) => text.startsWith(String(base)));
}

/**
 * 창(webContents)마다 아직 전달하지 못한 이동 요청을 하나씩 맡아 둔다.
 * 화면이 뜨면 스스로 가져간다. 오래된 요청은 버린다(2분).
 */
export function createPendingFocusStore(options = {}) {
  const ttlMs = Math.max(1_000, Number(options.ttlMs ?? 120_000) || 120_000);
  const now = typeof options.now === "function" ? options.now : Date.now;
  const pending = new Map();
  return {
    set(ownerId, request) {
      pending.set(ownerId, { ...request, storedAt: now() });
    },
    take(ownerId) {
      const entry = pending.get(ownerId);
      pending.delete(ownerId);
      if (!entry || now() - entry.storedAt > ttlMs) return null;
      const { storedAt: _storedAt, ...request } = entry;
      return request;
    },
    clear(ownerId) {
      pending.delete(ownerId);
    },
    has(ownerId) {
      return pending.has(ownerId);
    },
  };
}

export function isHiddenLaunch(argv = [], loginItemSettings = null) {
  if (Array.isArray(argv) && argv.includes(hiddenLaunchFlag)) return true;
  return loginItemSettings?.wasOpenedAsHidden === true;
}

/**
 * setLoginItemSettings / getLoginItemSettings 에 똑같이 넘길 값.
 * 무설치(portable) 실행 파일은 임시 폴더로 풀려 실행되므로 원래 exe 경로를 등록한다.
 */
export function buildLoginItemSettings(input = {}) {
  const executablePath = String(input.portableExecutableFile || input.execPath || "");
  return {
    openAtLogin: input.openAtLogin === true,
    path: executablePath,
    args: [hiddenLaunchFlag],
  };
}

function optionalBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

/**
 * taskNotifications: 맡긴 업무 OS 알림을 받을지. true/false 는 사용자가 트레이에서 고른 값,
 * null 은 아직 고르지 않음(→ resolveTaskNotificationConsent 가 기존 알림 동의를 따른다).
 */
export function readBackgroundPresencePreferences(userDataDir) {
  const defaults = { openAtLogin: false, taskNotifications: null, keepAwake: false, updatedAt: "" };
  if (!userDataDir) return defaults;
  try {
    const parsed = JSON.parse(readFileSync(path.join(userDataDir, backgroundPresencePreferencesFileName), "utf8"));
    return {
      openAtLogin: parsed?.openAtLogin === true,
      keepAwake: parsed?.keepAwake === true,
      taskNotifications: optionalBoolean(parsed?.taskNotifications),
      updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return defaults;
  }
}

/**
 * 맡긴 업무 알림은 업무 제목과 AI 의 질문을 싣고 잠금 화면에도 보일 수 있다. 그래서 묻지 않고
 * 켜지 않는다. 사용자가 트레이에서 고른 값이 먼저이고, 아직 고르지 않았으면 이미 자동 점검
 * 규칙에서 PC 알림(os)을 켠 사람(기존 OS 알림 동의)에게만 보낸다. 기본값은 꺼짐.
 */
export function resolveTaskNotificationConsent(preferences = {}, triggerRules = []) {
  if (typeof preferences?.taskNotifications === "boolean") return preferences.taskNotifications;
  if (!Array.isArray(triggerRules)) return false;
  return triggerRules.some((rule) => rule?.enabled === true && rule?.notificationChannels?.os === true);
}

export function writeBackgroundPresencePreferences(userDataDir, preferences = {}, nowIso = new Date().toISOString()) {
  // 바꾸지 않은 값은 그대로 둔다(자동 시작만 바꿔도 알림 선택이 지워지지 않게).
  const current = readBackgroundPresencePreferences(userDataDir);
  const next = {
    version: 1,
    openAtLogin: "openAtLogin" in preferences ? preferences.openAtLogin === true : current.openAtLogin,
    keepAwake: "keepAwake" in preferences ? preferences.keepAwake === true : current.keepAwake,
    taskNotifications: "taskNotifications" in preferences
      ? optionalBoolean(preferences.taskNotifications)
      : current.taskNotifications,
    updatedAt: nowIso,
  };
  if (!userDataDir) return next;
  mkdirSync(userDataDir, { recursive: true });
  const target = path.join(userDataDir, backgroundPresencePreferencesFileName);
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(next, null, 2), "utf8");
  renameSync(temp, target);
  return next;
}

/**
 * 짧은 시간에 몰린 요청을 한 번으로 묶는다(마지막 요청 뒤 waitMs 에 한 번 실행).
 */
export function createCoalescedRunner(fn, waitMs = 400, timers = {}) {
  const schedule = timers.setTimeout ?? setTimeout;
  const cancel = timers.clearTimeout ?? clearTimeout;
  let timer = null;
  return {
    request() {
      if (timer) return;
      timer = schedule(() => {
        timer = null;
        fn();
      }, waitMs);
      timer?.unref?.();
    },
    flush() {
      if (timer) cancel(timer);
      timer = null;
      fn();
    },
    cancel() {
      if (timer) cancel(timer);
      timer = null;
    },
  };
}
