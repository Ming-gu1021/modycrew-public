/**
 * 업무 원장 — 누가 어떤 일을 어디까지 했는지 담는 단 하나의 자료구조.
 *
 * 왜 필요한가: 기존 `AgentWorkRequest`(types.ts) 에는 제목과 본문만 있어서
 * **담당자를 적을 칸이 없었다.** 그래서 `assistant-agent-core.ts` 는 담당자를
 * 본문 문자열 안에 "담당 비서: 홍길동" 이라고 글로 적어 넘겼고,
 * `agent-runtime.ts` 는 그 본문을 요약만 하고 버렸다. 대표가 직원에게 일을
 * 시킬 수 없었던 이유가 이것이다. 이 파일이 그 칸을 만든다.
 *
 * 병합 규칙(`mergeTaskLedger`/`patchTaskInLedger`)은 오픈소스 Munder Difflin
 * (MIT, Copyright (c) 2026 Chaitanya Giri, src/shared/taskLedger.ts) 에서
 * 가져와 우리 타입에 맞춰 옮긴 것이다. 그쪽이 실제 사고로 배운 규칙이라
 * 다시 발명하지 않았다. 고지는 THIRD_PARTY_NOTICES.md 참조.
 *
 * 규칙이 존재하는 이유: 카드를 쓰는 곳이 여럿이고(승인함, 채팅, 메일 인테이크,
 * 화면 편집) 저마다 카드의 일부만 안다. 부분만 아는 쪽이 카드를 통째로 다시
 * 쓰면 자기가 모르는 필드를 전부 지워버린다. 병합은 필드를 지키고,
 * 목록에서 빠진 카드는 그대로 삭제한다(삭제는 의도된 동작).
 */

import type { ISODateTimeString } from "../types.js";

/** 업무 카드의 진행 상태. */
export type ModyTaskStatus = "todo" | "doing" | "blocked" | "done";

/**
 * 사람에게 물어본 것과 그 답. 직원이 스스로 판단할 수 없을 때 카드를
 * `blocked` 로 내리고 질문을 붙인다. 승인/거부 두 갈래만 있던 승인함으로는
 * "이건 어떻게 할까요?" 를 물을 수 없었는데, 그 자리를 이 필드가 맡는다.
 * 이력은 카드에 계속 남는다 — 지우지 않는다.
 */
export type ModyTaskHumanQuestion = {
  question: string;
  answer?: string;
  askedAt: ISODateTimeString;
  answeredAt?: ISODateTimeString;
  dismissedAt?: ISODateTimeString;
};

/**
 * 이 업무가 어디서 왔는지. 끝났을 때 **어디로 답을 돌려보낼지**를 결정한다.
 * 메일에서 온 업무가 그 메일 스레드로 답장되게 하는 것이 `mail` 항목의 목적이며,
 * 이것이 없어서 메일 파이프라인이 읽기까지만 하고 끊겨 있었다.
 */
export type ModyTaskOrigin =
  | { kind: "manual" }
  | { kind: "chat"; threadId?: string }
  | { kind: "mail"; messageId: string; threadId?: string; from?: string }
  | { kind: "calendar"; eventId: string }
  | { kind: "trigger"; triggerId: string };

/** 업무 카드 한 장. */
export type ModyTask = {
  id: string;
  title: string;
  description?: string;
  /** 담당 직원 식별자. 비어 있으면 아직 배정되지 않은 카드다. */
  assigneeId?: string;
  /** 화면에 보여줄 담당자 이름. 식별자만으로는 사람이 못 읽는다. */
  assigneeName?: string;
  status: ModyTaskStatus;
  /** 선행 업무 id 목록. 비어 있으면 바로 시작할 수 있다. */
  dependsOn: string[];
  /** 낮을수록 먼저. 기본 3. */
  priority: number;
  createdAt: ISODateTimeString;
  updatedAt?: ISODateTimeString;
  completedAt?: ISODateTimeString;
  humanQA?: ModyTaskHumanQuestion[];
  /** 끝나고 무엇을 했는지. 출처로 돌려보내는 답의 원문. */
  result?: string;
  origin?: ModyTaskOrigin;
  execution?: {
    state: string;
    dueAt: string;
    repeat: string;
    error?: string;
    lastCompletedAt?: string;
  };
};

/** 디스크에 있는 그대로의 카드 한 장 — 우리가 모르는 필드가 섞여 있을 수 있다. */
type RawTask = Record<string, unknown>;

function isRawTask(value: unknown): value is RawTask {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function idOf(value: unknown): string | null {
  if (!isRawTask(value)) return null;
  return typeof value.id === "string" && value.id ? value.id : null;
}

/**
 * `incoming` 을 `existing` 위에 접는다. 카드는 `id` 로 짝짓는다.
 *
 * 결과는 `incoming` 이다 — 순서도, 구성원도. 그래서 목록에서 뺀 카드는 삭제된다.
 * 접힘에서 살아남는 것은 `incoming` 이 **언급하지 않은** 필드뿐이다.
 * 보낸 쪽이 명시한 값은 `null` 이라도 이긴다(그게 비우는 방법이다).
 * 얕은 병합으로는 "이 키를 지워라" 를 표현할 수 없고, 표현해서도 안 된다 —
 * 쓰는 쪽은 부분 모델이라 키가 없다는 건 "모른다"이지 "지워라"가 아니다.
 *
 * `id` 가 없는 항목(손으로 쓴 잘못된 카드)은 짝지을 열쇠가 없으므로 그대로 통과시킨다.
 * 버리면 이 함수가 막으려는 바로 그 데이터 손실이 일어난다.
 */
export function mergeTaskLedger(existing: unknown, incoming: unknown): unknown[] {
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const existingList = Array.isArray(existing) ? existing : [];
  const byId = new Map<string, RawTask>();
  for (const entry of existingList) {
    const id = idOf(entry);
    if (id && !byId.has(id)) byId.set(id, entry as RawTask);
  }
  return incomingList.map((entry) => {
    const id = idOf(entry);
    if (!id) return entry;
    const prior = byId.get(id);
    return prior ? { ...prior, ...(entry as RawTask) } : entry;
  });
}

/**
 * 원장 배열에서 카드 하나에만 `patch` 를 적용한다. 나머지 카드와, 그 카드의
 * 나머지 필드는 바이트 단위로 그대로 남는다.
 *
 * 화면에서 카드 하나를 고칠 때는 이걸 써야 한다. 표시용 모델을 다시 직렬화해
 * 쓰면 정규화된 카드가 원장에 들어간다 — 손으로 쓴 `priority: "높음"` 이 숫자로
 * 바뀌는 식이다. 그 값들은 진짜 값이라 `mergeTaskLedger` 를 이기고 디스크에 남는다.
 * 원본 항목을 패치하면 애초에 그런 값이 생기지 않는다.
 */
export function patchTaskInLedger(
  rawTasks: unknown,
  id: string,
  patch: Record<string, unknown>,
): unknown[] {
  const list = Array.isArray(rawTasks) ? rawTasks : [];
  return list.map((entry) => (idOf(entry) === id ? { ...(entry as RawTask), ...patch } : entry));
}

const validStatuses = new Set<ModyTaskStatus>(["todo", "doing", "blocked", "done"]);

function normalizeStatus(value: unknown): ModyTaskStatus {
  return typeof value === "string" && validStatuses.has(value as ModyTaskStatus)
    ? (value as ModyTaskStatus)
    : "todo";
}

function normalizePriority(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // 손으로 쓴 한국어 우선순위도 읽어준다. 원장은 사람이 여는 파일이다.
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "높음" || text === "high") return 1;
    if (text === "보통" || text === "normal") return 3;
    if (text === "낮음" || text === "low") return 5;
    const parsed = Number(text);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 3;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function normalizeHumanQA(value: unknown): ModyTaskHumanQuestion[] {
  if (!Array.isArray(value)) return [];
  const entries: ModyTaskHumanQuestion[] = [];
  for (const raw of value) {
    if (!isRawTask(raw)) continue;
    const question = typeof raw.question === "string" ? raw.question : "";
    if (!question) continue;
    const askedAt = typeof raw.askedAt === "string" ? raw.askedAt : "";
    const entry: ModyTaskHumanQuestion = { question, askedAt };
    if (typeof raw.answer === "string") entry.answer = raw.answer;
    if (typeof raw.answeredAt === "string") entry.answeredAt = raw.answeredAt;
    if (typeof raw.dismissedAt === "string") entry.dismissedAt = raw.dismissedAt;
    entries.push(entry);
  }
  return entries;
}

function normalizeOrigin(value: unknown): ModyTaskOrigin | null {
  if (!isRawTask(value)) return null;
  const kind = typeof value.kind === "string" ? value.kind : "";
  if (kind === "manual") return { kind: "manual" };
  if (kind === "chat") {
    return typeof value.threadId === "string"
      ? { kind: "chat", threadId: value.threadId }
      : { kind: "chat" };
  }
  if (kind === "mail") {
    const messageId = typeof value.messageId === "string" ? value.messageId : "";
    if (!messageId) return null;
    const origin: ModyTaskOrigin = { kind: "mail", messageId };
    if (typeof value.threadId === "string") origin.threadId = value.threadId;
    if (typeof value.from === "string") origin.from = value.from;
    return origin;
  }
  if (kind === "calendar" && typeof value.eventId === "string") {
    return { kind: "calendar", eventId: value.eventId };
  }
  if (kind === "trigger" && typeof value.triggerId === "string") {
    return { kind: "trigger", triggerId: value.triggerId };
  }
  return null;
}

/**
 * 원장 파일에서 읽은 값을 화면이 쓸 수 있는 카드 목록으로 정규화한다.
 *
 * 주의: 이 함수의 결과를 **다시 원장에 쓰면 안 된다.** 정규화가 손으로 쓴 값을
 * 바꿔놓기 때문이다. 쓸 때는 `patchTaskInLedger` 로 원본을 고쳐라.
 */
export function parseTaskLedger(raw: unknown): ModyTask[] {
  const list = Array.isArray(raw) ? raw : [];
  const tasks: ModyTask[] = [];
  for (const entry of list) {
    const id = idOf(entry);
    if (!id || !isRawTask(entry)) continue;
    const task: ModyTask = {
      id,
      title: typeof entry.title === "string" ? entry.title : id,
      status: normalizeStatus(entry.status),
      dependsOn: normalizeStringArray(entry.dependsOn),
      priority: normalizePriority(entry.priority),
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
    };
    if (typeof entry.description === "string") task.description = entry.description;
    if (typeof entry.assigneeId === "string") task.assigneeId = entry.assigneeId;
    if (typeof entry.assigneeName === "string") task.assigneeName = entry.assigneeName;
    if (typeof entry.updatedAt === "string") task.updatedAt = entry.updatedAt;
    if (task.status === 'done' && typeof entry.completedAt === 'string' && Number.isFinite(Date.parse(entry.completedAt))) task.completedAt = entry.completedAt;
    if (typeof entry.result === "string") task.result = entry.result;
    const humanQA = normalizeHumanQA(entry.humanQA);
    if (humanQA.length > 0) task.humanQA = humanQA;
    const origin = normalizeOrigin(entry.origin);
    if (origin) task.origin = origin;
    if (isRawTask(entry.execution) && typeof entry.execution.state === "string") {
      task.execution = {
        state: entry.execution.state,
        dueAt: typeof entry.execution.dueAt === "string" ? entry.execution.dueAt : "",
        repeat: typeof entry.execution.repeat === "string" ? entry.execution.repeat : "none",
      };
      if (typeof entry.execution.error === "string") task.execution.error = entry.execution.error;
      if (typeof entry.execution.lastCompletedAt === "string") task.execution.lastCompletedAt = entry.execution.lastCompletedAt;
    }
    tasks.push(task);
  }
  return tasks;
}

export type ModyTaskDraft = {
  id: string;
  title: string;
  createdAt: ISODateTimeString;
  description?: string;
  assigneeId?: string;
  assigneeName?: string;
  status?: ModyTaskStatus;
  dependsOn?: string[];
  priority?: number;
  origin?: ModyTaskOrigin;
};

/** 새 업무 카드를 만든다. 담당자는 이 시점에 비어 있어도 된다. */
export function createModyTask(draft: ModyTaskDraft): ModyTask {
  const task: ModyTask = {
    id: draft.id,
    title: draft.title,
    status: draft.status ?? "todo",
    dependsOn: draft.dependsOn ? [...draft.dependsOn] : [],
    priority: draft.priority ?? 3,
    createdAt: draft.createdAt,
  };
  if (draft.description !== undefined) task.description = draft.description;
  if (draft.assigneeId !== undefined) task.assigneeId = draft.assigneeId;
  if (draft.assigneeName !== undefined) task.assigneeName = draft.assigneeName;
  if (draft.origin !== undefined) task.origin = draft.origin;
  return task;
}

/**
 * 담당자를 지정한다 — 대표가 직원에게 일을 시키는 그 동작.
 * 카드를 새로 만들어 돌려주고 원본은 건드리지 않는다.
 */
export function assignModyTask(
  task: ModyTask,
  assignee: { id: string; name?: string },
  updatedAt: ISODateTimeString,
): ModyTask {
  const next: ModyTask = { ...task, assigneeId: assignee.id, updatedAt };
  if (assignee.name !== undefined) next.assigneeName = assignee.name;
  return next;
}

/** 사람에게 질문을 붙이고 카드를 멈춘다. */
export function askHumanOnModyTask(
  task: ModyTask,
  question: string,
  askedAt: ISODateTimeString,
): ModyTask {
  const history = task.humanQA ? [...task.humanQA] : [];
  history.push({ question, askedAt });
  const next: ModyTask = { ...task, status: "blocked", humanQA: history, updatedAt: askedAt };
  delete next.completedAt;
  return next;
}

/**
 * 가장 최근의 답 없는 질문에 답을 채우고 카드를 다시 굴린다.
 * 답할 질문이 없으면 카드를 그대로 돌려준다 — 조용히 상태만 바꾸지 않는다.
 */
export function answerHumanOnModyTask(
  task: ModyTask,
  answer: string,
  answeredAt: ISODateTimeString,
): ModyTask {
  const history = task.humanQA ? [...task.humanQA] : [];
  let index = -1;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry && entry.answer === undefined && entry.dismissedAt === undefined) {
      index = i;
      break;
    }
  }
  const pending = index >= 0 ? history[index] : undefined;
  if (!pending) return task;
  history[index] = { ...pending, answer, answeredAt };
  const next: ModyTask = { ...task, status: "doing", humanQA: history, updatedAt: answeredAt };
  delete next.completedAt;
  return next;
}

/** 업무를 끝내고 결과를 남긴다. 이 `result` 가 출처로 돌려보낼 답이 된다. */
export function completeModyTask(
  task: ModyTask,
  result: string,
  completedAt: ISODateTimeString,
): ModyTask {
  return { ...task, status: "done", result, updatedAt: completedAt, ...(task.status === 'done' ? {} : { completedAt }) };
}
