import { openTaskLedgerExecutionStore } from "./local-memory-handler.mjs";

/**
 * 업무판(업무 원장)과 승인함('보낼까요?' 카드)을 잇는 얇은 배선.
 *
 * - AI 직원 업무가 메일 초안이나 발송 요청으로 끝나면 → 승인함 카드로 올린다(stageApproval).
 * - 승인함에서 카드를 보냈거나·보내지 않기로 했거나·보류하면 → 업무판의 같은 일을 닫는다(settle).
 *
 * 밖으로 나가는 일은 여기서 하지 않는다. 카드는 승인함의 마지막 확인을 지나야만 나간다.
 */

const repeatMs = { daily: 86_400_000, weekly: 604_800_000 };
const mailSendLikeToolPattern = /(mail|email|메일)/iu;
const mailSendLikeActionPattern = /(send|reply|발송|답장|보내)/iu;

function textOf(value, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseObservationJson(summary) {
  const raw = textOf(summary, 40_000);
  if (!raw.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const emailAddressPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;

/** 글 속의 메일 주소를 통째로만 뽑는다(소문자). 'kim@company.co' 가 'kim@company.co.kr' 의 일부로 맞지 않게. */
export function extractTypedEmailAddresses(text) {
  return new Set((String(text ?? "").match(emailAddressPattern) ?? []).map((address) => address.toLowerCase()));
}

/**
 * 받는 사람 주소는 사용자가 업무를 맡길 때 직접 적은 주소만 쓴다. AI 가 지어낸 주소는 버리고,
 * 비워 두면 승인함의 마지막 확인에서 사람이 적는다. 주소는 글자 일부가 아니라 주소 전체가 같아야 한다.
 */
function userTypedRecipient(task, value) {
  const [address = ""] = String(textOf(value, 320)).match(emailAddressPattern) ?? [];
  if (!address) return "";
  const requestText = [task?.execution?.requestText, task?.description, task?.title].map((item) => textOf(item, 12_000)).join("\n");
  return extractTypedEmailAddresses(requestText).has(address.toLowerCase()) ? address : "";
}

/**
 * 업무 실행 결과에서 승인함 카드로 올릴 메일 초안을 찾는다.
 * 1) 마지막 mail.draft 관찰(초안 준비 완료) — 답장할 메일 id 는 그 도구 호출 인자에서 가져온다.
 * 2) 없으면 자동 실행 범위 밖이라 멈춘 '메일 발송' 요청의 인자(본문이 있어야 함).
 */
export function extractMailDraftForApproval(task, request, observations = []) {
  const list = Array.isArray(observations) ? observations : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const observation = list[index];
    if (observation?.toolId !== "mail.draft") continue;
    const parsed = parseObservationJson(observation.summary);
    const draft = parsed?.draft && typeof parsed.draft === "object" ? parsed.draft : null;
    const body = textOf(draft?.body, 20_000);
    if (parsed?.status !== "mail_draft_ready" || !body) continue;
    const args = observation.args && typeof observation.args === "object" ? observation.args : {};
    const replyToMessageId = textOf(args.replyToMessageId, 300);
    const to = userTypedRecipient(task, draft?.to ?? args.to);
    return {
      body,
      ...(textOf(draft?.subject ?? args.subject, 300) ? { subject: textOf(draft?.subject ?? args.subject, 300) } : {}),
      ...(to ? { to } : {}),
      ...(replyToMessageId ? { replyToMessageId } : {}),
    };
  }
  const toolId = textOf(request?.toolId, 120);
  const args = request?.args && typeof request.args === "object" ? request.args : {};
  const body = textOf(args.body ?? args.text ?? args.content, 20_000);
  if (!toolId || !body || !mailSendLikeToolPattern.test(toolId) || !mailSendLikeActionPattern.test(toolId)) return null;
  const replyToMessageId = textOf(args.replyToMessageId ?? args.messageId, 300);
  const to = userTypedRecipient(task, args.to);
  return {
    body,
    ...(textOf(args.subject, 300) ? { subject: textOf(args.subject, 300) } : {}),
    ...(to ? { to } : {}),
    ...(replyToMessageId ? { replyToMessageId } : {}),
  };
}

/**
 * 업무 실행기의 stageApproval 구현. 메일 초안이 있으면 승인함 카드로 올리고 카드 id 를 돌려준다.
 * 메일과 무관한 승인 요청이면 null(기존처럼 업무판에서 '승인 필요'로만 남는다).
 */
export function createTaskApprovalStager({ stageMailDraftCard, readMailReplySource } = {}) {
  return async (task, request, observations) => {
    if (typeof stageMailDraftCard !== "function") return null;
    const draft = extractMailDraftForApproval(task, request, observations);
    if (!draft) return null;
    const staged = await stageMailDraftCard(
      {
        ...draft,
        taskId: textOf(task?.id, 120),
        ...(textOf(task?.assigneeId, 120) ? { teammateId: textOf(task.assigneeId, 120) } : {}),
        ...(textOf(task?.assigneeName, 60) ? { teammateName: textOf(task.assigneeName, 60) } : {}),
        // 매일·매주 반복되는 일은 사용자가 이미 정한 메일(보냄·보내지 않음·보류·직접 고침)에 다시 답장 카드를 올리지 않는다.
        ...(repeatMs[task?.execution?.repeat] ? { keepUserDecisions: true } : {}),
      },
      typeof readMailReplySource === "function" ? { readMailReplySource } : {},
    );
    const stagedCard = ["mail_draft_card_staged", "mail_draft_card_updated"].includes(staged?.status);
    if (stagedCard && staged.workItemId) return { cardId: staged.workItemId, status: staged.status };
    // 카드를 올리지 않은 이유를 업무 결과에 한 줄 남긴다('승인함에서 확인해 주세요'만 남아 헛걸음하지 않게).
    if (staged?.status === "mail_draft_card_user_decided") return { cardId: "", status: staged.status, note: textOf(staged.userMessage, 300) };
    return null;
  };
}

function isMailSendKind(kind) {
  return !kind || /^send_.*email$/u.test(String(kind));
}

function settlementLine(settlement = {}) {
  const mail = isMailSendKind(settlement.finalActionKind);
  if (settlement.status === "completed") {
    if (!mail) return "승인함에서 확인하고 실행했어요.";
    return settlement.sentStatus === "partial"
      ? "승인함에서 보냈는데 일부만 나갔어요. 보낸 편지함에서 확인해 주세요."
      : "승인함에서 확인하고 보냈어요.";
  }
  if (settlement.status === "rejected") return mail ? "승인함에서 보내지 않기로 했어요." : "승인함에서 실행하지 않기로 했어요.";
  return "승인함에서 보류했어요.";
}

function nextRepeatDue(execution, nowIso) {
  const interval = repeatMs[execution?.repeat];
  const due = Date.parse(execution?.dueAt);
  const now = Date.parse(nowIso);
  if (!interval || !Number.isFinite(due) || !Number.isFinite(now)) return nowIso;
  return new Date(due + Math.max(1, Math.floor((now - due) / interval) + 1) * interval).toISOString();
}

/**
 * 카드 결정 하나를 업무 원장의 일 하나에 반영한다(순수 함수 — 바꿀 게 없으면 null).
 * - 끝난 일(done)은 절대 되돌리지 않는다.
 * - 보냄·보내지 않음 → 끝남(done). 보류 → 답이 필요해요(blocked).
 * - 매일·매주 반복 업무가 이 카드 때문에 멈춰 있었으면 다음 차례로 다시 예약한다(반복이 죽지 않게).
 * - 지금 실행 중인 일은 건드리지 않는다(실행기의 저장을 덮지 않도록).
 */
export function applyInboxSettlementToTask(task, settlement = {}, nowIso = new Date().toISOString()) {
  if (!task || typeof task !== "object" || task.status === "done") return null;
  if (!["completed", "rejected", "held"].includes(settlement.status)) return null;
  const execution = task.execution && typeof task.execution === "object" ? task.execution : null;
  if (execution?.state === "running") return null;
  const line = settlementLine(settlement);
  const outcome = { status: settlement.status, label: line, at: nowIso, ...(settlement.workItemId ? { workItemId: String(settlement.workItemId).slice(0, 160) } : {}) };
  const withLine = task.result ? (String(task.result).startsWith(line) ? String(task.result) : `${line}\n${task.result}`) : line;

  if (execution && repeatMs[execution.repeat] && execution.state === "waiting_approval") {
    return {
      ...task,
      status: "todo",
      updatedAt: nowIso,
      result: withLine,
      approvalOutcome: outcome,
      execution: {
        ...execution,
        state: "queued",
        owner: null,
        token: null,
        error: "",
        approvalRequests: [],
        approvalCardId: "",
        dueAt: nextRepeatDue(execution, nowIso),
      },
    };
  }
  if (settlement.status === "held") {
    if (task.status === "blocked" && task.approvalOutcome?.status === "held") return null;
    return { ...task, status: "blocked", updatedAt: nowIso, approvalOutcome: outcome };
  }
  return {
    ...task,
    status: "done",
    updatedAt: nowIso,
    result: withLine,
    approvalOutcome: outcome,
    ...(execution
      ? { execution: { ...execution, state: "completed", owner: null, token: null, error: "", lastCompletedAt: nowIso } }
      : {}),
  };
}

/**
 * 승인함 카드가 끝났을 때 업무판의 같은 일을 닫는다: 자동 점검이 올린 `inbox:<카드 id>`와,
 * 카드를 만든 AI 직원 업무(sourceEvidence.taskId).
 */
export async function settleTasksForInboxWorkItem(settlement = {}, options = {}) {
  const workItemId = textOf(settlement.workItemId, 160);
  if (!workItemId) return { status: "task_settlement_skipped", changedCount: 0 };
  const ids = [...new Set([`inbox:${workItemId}`.slice(0, 120), textOf(settlement.taskId, 120)].filter(Boolean))];
  const store = await openTaskLedgerExecutionStore(options);
  const nowIso = typeof options.now === "function" ? new Date(options.now()).toISOString() : new Date().toISOString();
  let changedCount = 0;
  for (const id of ids) {
    if (store.change(id, (task) => applyInboxSettlementToTask(task, settlement, nowIso))) changedCount += 1;
  }
  return { status: changedCount ? "task_settlement_applied" : "task_settlement_unchanged", changedCount };
}
