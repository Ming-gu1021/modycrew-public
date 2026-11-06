import {
  readHiddenReplyToAddress,
  resolveOriginalMailSubject,
  sanitizeRfcMessageIdField,
} from "./mail-header-utils.mjs";

/**
 * 답장할 원래 메일 찾기 — AI 가 쓴 답장 초안을 승인 카드로 올릴 때(main 안에서만) 쓴다.
 *
 * AI 는 메시지 id(`imap-501`, 계정이 여럿이면 `계정::imap-501`)만 안다. 답장 받을 주소·실제 제목·
 * 스레딩 값(Message-ID)은 여기서 찾아 승인 카드의 sourceEvidence 에만 싣는다. 이 함수의 결과는
 * AI 프롬프트·알림·로그·화면 응답으로 보내지 않는다(화면에는 inbox-handler 가 가린 주소만 준다).
 *
 * 1) 메일 원장(통합 메일함 목록): 받은 계정·RFC Message-ID·받은 시각. 주소 원문은 원장에 없다.
 * 2) 연결된 메일함을 읽기 전용으로 한 번 더 읽기: 답장 주소와 실제 제목은 메일 미리보기에
 *    열거되지 않는 속성으로만 실려 오므로 여기서만 꺼낼 수 있다. 못 읽어도 1)만으로 카드를 만든다
 *    (받는 사람은 마지막 확인에서 사람이 적는다).
 */
const defaultLedgerTimeoutMs = 5_000;
const defaultMailboxTimeoutMs = 12_000;

/** 느린 읽기가 채팅 답변·업무 실행을 붙잡지 않게 한다. 시간이 지나면 없던 것으로 친다(카드는 그래도 만든다). */
function withTimeout(promiseFactory, timeoutMs) {
  let timer = null;
  return Promise.race([
    Promise.resolve().then(promiseFactory),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("mail_reply_source_timeout")), Math.max(1, timeoutMs));
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function resolveMailReplySource(input = {}, options = {}) {
  const messageId = String(input.messageId ?? "").trim().slice(0, 300);
  if (!messageId) return null;
  const connectorId = String(input.connectorId ?? "").trim().slice(0, 160);
  const ledgerTimeoutMs = Number(options.ledgerTimeoutMs) > 0 ? Number(options.ledgerTimeoutMs) : defaultLedgerTimeoutMs;
  const mailboxTimeoutMs = Number(options.mailboxTimeoutMs) > 0 ? Number(options.mailboxTimeoutMs) : defaultMailboxTimeoutMs;

  const listLedger =
    typeof options.listMailMessages === "function"
      ? options.listMailMessages
      : async (query) => (await import("./mail-ledger-handler.mjs")).listMailMessages(options, query);
  const readMailbox =
    typeof options.readMailbox === "function"
      ? options.readMailbox
      : async (query) => (await import("./connector-handler.mjs")).runConnectedMailWorkIntake(options, query);

  let ledgerRow = null;
  try {
    const listed = await withTimeout(() => listLedger({ limit: 200, ...(connectorId ? { accountId: connectorId } : {}) }), ledgerTimeoutMs);
    ledgerRow = (listed?.messages ?? []).find((row) => row?.messageId === messageId) ?? null;
    if (!ledgerRow && connectorId) {
      const all = await withTimeout(() => listLedger({ limit: 200 }), ledgerTimeoutMs);
      ledgerRow = (all?.messages ?? []).find((row) => row?.messageId === messageId) ?? null;
    }
  } catch {
    ledgerRow = null;
  }

  let message = null;
  let readConnectorId = "";
  try {
    // 계정이 여럿이면 메시지 id 가 `계정::id`로 이름 붙어 있으므로 계정을 좁히지 않고 읽는다.
    // 메일함 읽기가 늦으면(여러 계정·느린 서버) 기다리지 않는다 — 받는 사람은 마지막 확인에서 적는다.
    const read = await withTimeout(() => readMailbox({ limit: 50 }), mailboxTimeoutMs);
    const messages = read?.providerRead?.messages ?? [];
    message = messages.find((entry) => entry?.messageId === messageId) ?? null;
    readConnectorId = String(message?.sourceAccountId ?? read?.connectorId ?? "");
  } catch {
    message = null;
  }
  if (!ledgerRow && !message) return null;

  return {
    connectorId: readConnectorId || String(ledgerRow?.accountId ?? "") || connectorId,
    providerId: String(message?.providerId ?? ""),
    rfcMessageId: sanitizeRfcMessageIdField(message?.rfcMessageId ?? ledgerRow?.rfcMessageId),
    inReplyTo: sanitizeRfcMessageIdField(message?.inReplyTo),
    originalSubject: message ? resolveOriginalMailSubject(message) : resolveOriginalMailSubject(ledgerRow),
    replyToAddress: readHiddenReplyToAddress(message),
    providerThreadId: String(message?.threadId ?? ledgerRow?.threadId ?? ""),
    messageSubject: String(message?.subject ?? ledgerRow?.subject ?? ""),
    senderPreview: String(message?.from ?? ledgerRow?.from ?? ""),
    receivedAt: String(message?.receivedAt ?? ledgerRow?.receivedAt ?? ""),
  };
}
