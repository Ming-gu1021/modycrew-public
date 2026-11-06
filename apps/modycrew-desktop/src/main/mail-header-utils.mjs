import { createHash } from "node:crypto";
import { createMailSignatureResolver } from "./mail-writing-profile.mjs";

/**
 * 메일 수집(읽기 → 분류 → 승인 카드) 쪽이 발송 쪽과 함께 쓰는 필드 계약.
 *
 * - rfcMessageId / inReplyTo: 진짜 RFC Message-ID(`CAF123@mail.example.com`)를 그대로 지킨다.
 *   이메일 가림 정규식을 통과시키면 `[redacted-email]`이 되어 답장이 원래 대화에 붙지 않는다.
 * - replyToAddress: 답장 받을 주소 원문. AI 프롬프트·알림·요약·로그에는 절대 싣지 않고
 *   승인 카드의 sourceEvidence 에만 담는다(발송 쪽이 수신자 기본값으로 쓴다).
 * - originalSubject: 받은 메일의 실제 제목(`Re: 원제목`의 재료). 카드 제목(`업무 메일 처리: …`)과 다르다.
 *   배경 점검이 읽는 보이는 `subject`는 메일 주소·전화번호를 가린 사본이라, 원문은 답장 주소처럼
 *   열거되지 않는 속성으로 숨겨 나른다(`attachHiddenOriginalSubject` / `resolveOriginalMailSubject`).
 * - sendBody: 실제로 나갈 본문. 제어문자·키/토큰만 지우고 메일 주소·전화번호는 그대로 둔다.
 */

const replyAddressPattern = /^[A-Z0-9._%+'-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}$/i;

/** `<CAF123@mail.example.com>` → `CAF123@mail.example.com`. 형식이 틀리면 빈 문자열. */
export function sanitizeRfcMessageIdField(value) {
  const text = String(value ?? "").replace(/[<>\s]/g, "");
  if (!text || !text.includes("@")) return "";
  if (!/^[\x21-\x7e]+$/.test(text)) return "";
  if (text.length > 200) return "";
  return text;
}

/** `"이름" <addr@example.com>` 같은 값에서 주소만 꺼내 검증한다(최대 254자). */
export function sanitizeMailReplyAddress(value) {
  const text = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (!text) return "";
  const angle = text.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/);
  const candidate = (angle?.[1] ?? text.split(/[\s,;]+/).find((part) => part.includes("@")) ?? "")
    .replace(/^mailto:/i, "")
    .replace(/^["'(<]+|["')>.,;:]+$/g, "");
  if (!candidate || candidate.length > 254) return "";
  return replyAddressPattern.test(candidate) ? candidate : "";
}

/** 메일 미리보기에 숨겨 붙은(열거되지 않는) 답장 주소를 읽는다. */
export function readHiddenReplyToAddress(message) {
  if (!message || typeof message !== "object") return "";
  return sanitizeMailReplyAddress(message.replyToAddress);
}

/**
 * 답장 주소를 열거되지 않는 속성으로 붙인다 — JSON·IPC 복제·`{...obj}` 펼치기 어디에도 따라가지 않는다.
 * 후보를 순서대로 보고 형식이 맞는 첫 주소만 쓴다.
 */
export function attachHiddenReplyToAddress(target, ...candidates) {
  if (!target || typeof target !== "object") return target;
  for (const candidate of candidates) {
    const address = sanitizeMailReplyAddress(candidate);
    if (!address) continue;
    Object.defineProperty(target, "replyToAddress", {
      value: address,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    break;
  }
  return target;
}

/** 받은 메일의 실제 제목. 제어문자만 지우고 가리지 않는다(최대 300자). */
export function sanitizeOriginalMailSubject(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * 실제 제목 원문을 열거되지 않는 `originalSubject` 속성으로 붙인다(도메인 `attachHiddenOriginalSubject`와 같은 규칙).
 * 보이는 `subject`는 화면·AI 프롬프트·로그용으로 메일 주소·전화번호를 가린 사본일 수 있다.
 * 원제목은 JSON·IPC 복제·`{...obj}` 펼치기 어디에도 따라가지 않고, 승인 카드에만 실린다.
 */
export function attachHiddenOriginalSubject(target, ...candidates) {
  if (!target || typeof target !== "object") return target;
  for (const candidate of candidates) {
    const subject = sanitizeOriginalMailSubject(candidate);
    if (!subject) continue;
    Object.defineProperty(target, "originalSubject", {
      value: subject,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    break;
  }
  return target;
}

/** 메일 미리보기에 숨겨 붙은(열거되지 않는) 실제 제목을 읽는다. */
export function readHiddenOriginalSubject(message) {
  if (!message || typeof message !== "object") return "";
  return sanitizeOriginalMailSubject(message.originalSubject);
}

const redactedMarkerPattern = /\[(?:redacted-[a-z-]+|[a-z-]*-redacted)\]/iu;

/**
 * 카드 sourceEvidence.originalSubject 로 쓸 제목. 숨겨 나른 원문을 먼저 쓰고, 없으면 보이는 제목을 쓰되
 * 가린 흔적(`[redacted-phone]` 등)이 있으면 원제목이 아니므로 비워 둔다 — 발송 쪽이 다른 제목으로 물러난다.
 */
export function resolveOriginalMailSubject(message) {
  if (!message || typeof message !== "object") return "";
  const hidden = readHiddenOriginalSubject(message);
  if (hidden) return hidden;
  const visible = sanitizeOriginalMailSubject(message.subject);
  return redactedMarkerPattern.test(visible) ? "" : visible;
}

/**
 * `{...message}` 펼치기로 메일을 새로 만들 때 숨겨 나르던 값(답장 주소·실제 제목)을 원래 메일에서 다시 붙인다.
 */
export function carryHiddenMailFields(target, source) {
  if (!target || typeof target !== "object" || !source || typeof source !== "object") return target;
  attachHiddenReplyToAddress(target, source.replyToAddress);
  attachHiddenOriginalSubject(target, source.originalSubject);
  return target;
}

/**
 * 실제로 나갈 답장 본문. 제어문자와 키/토큰 같은 비밀값만 지운다.
 * 메일 주소·전화번호·주소는 받는 분에게 필요한 내용이라 그대로 둔다(최대 20000자).
 */
export function cleanOutgoingMailBody(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\bya29\.[A-Za-z0-9._-]{12,}\b/g, "[redacted-token]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted-token]")
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, "[redacted-token]")
    .replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, "[redacted-key]")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, 20000);
}

/**
 * 답장 서명. 메일 화면의 '서명·말투'에서 정한 값을 계정(연결 id)별로 고른다 — 이 계정 전용 명함, 서명 없음,
 * 기본 명함, 앱 프로필 이름 순서. 계정을 모르면 기본값을 쓴다. 제품 이름("ModyCrew")을 거래처 메일에 붙이지 않는다.
 */
export async function resolveMailReplySignature(options = {}, { connectorId = "" } = {}) {
  const signatureFor = await createMailSignatureResolver(options);
  return signatureFor(connectorId);
}

/** 규칙 초안의 첫 줄이 `[형식 · 말투]` 같은 내부 표기면 지운다(예전 초안 호환). */
export function stripInternalDraftLabelLine(value) {
  const text = String(value ?? "");
  const [first, ...rest] = text.split("\n");
  return /^\[[^\]]*·[^\]]*\]\s*$/u.test(first ?? "") ? rest.join("\n").replace(/^\n+/, "") : text;
}

/**
 * 메일 한 통에 승인 카드 하나 — 배경 점검과 수동 점검이 같은 id 를 만들도록
 * `mail:<connectorId>:<메일 지문>`을 쓴다. 지문은 RFC Message-ID(없으면 제공사 id)의 해시라
 * 인박스 id 정리(이메일·전화번호 가림)에 걸리지 않는다.
 */
export function createMailWorkCardId(connectorId, message = {}) {
  const connector = String(connectorId ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "mail";
  const key = mailIdentityKey(message);
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 24);
  return `mail:${connector}:m${digest}`;
}

function mailIdentityKey(message = {}) {
  const rfcMessageId = sanitizeRfcMessageIdField(message.rfcMessageId);
  if (rfcMessageId) return `rfc:${rfcMessageId.toLowerCase()}`;
  const providerMessageId = String(message.messageId ?? message.sourceId ?? "")
    .replace(/^.*::/u, "")
    .trim();
  // Message-ID 가 없는 IMAP 메일: 배경 점검은 `imap-<UID>`, 수동 점검은 `imap_<서버>_<UID>`로
  // 이름이 달라 같은 메일에 카드가 두 장 생겼다. 연결(connectorId)이 id 앞에 붙으므로 UID 로 맞춘다.
  const imapUid = /^imap(?:_.*)?[-_](\d+)$/u.exec(providerMessageId);
  if (imapUid) return `imap-uid:${imapUid[1]}`;
  return `id:${providerMessageId || "unknown"}`;
}
