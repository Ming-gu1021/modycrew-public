// Portions derived from Agentic Inbox (https://github.com/cloudflare/agentic-inbox)
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0)
// See THIRD_PARTY_NOTICES.md ("Agentic Inbox") for the full attribution record.
// Modifications: 플랫폼 중립 포팅(DO SQLite 의존 제거), 한국어 제목 접두어 지원,
// 제목 폴백의 참여자 매칭을 부분 문자열 검사에서 정확 일치로 재작성.

/**
 * RFC 5322 기반 메일 스레딩 유틸.
 *
 * 수신: References/In-Reply-To 헤더로 thread id를 결정하고, 헤더가 없을 때만
 * 제목+참여자 폴백을 쓴다.
 * 발신: 답장에 In-Reply-To/References 헤더를 붙여 상대 메일함에서도
 * 스레드가 유지되게 한다.
 *
 * 사용 계약: 답장 초안에는 References 체인을 박제하지 말 것. 체인은 발송
 * 시점에 원본 메일로부터 `buildMailReferencesChain`으로 재계산한다(원본이
 * 그 사이 변해도 어긋나지 않도록).
 */

/**
 * `<abc@example.com>` 형태의 헤더 값에서 RFC message-id 본문만 추출한다.
 * 깨진 클라이언트가 보내는 `<>` 같은 빈 값은 빈 문자열로 반환한다
 * (그대로 반환하면 무관한 메일들이 `"<>"` 스레드로 병합된다).
 */
export function extractRfcMessageId(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  if (match?.[1]) return match[1];
  const token = raw.trim().split(/\s+/)[0] ?? "";
  return token.replace(/[<>]/g, "");
}

/** References 헤더(공백 구분 다중 id)를 message-id 배열로 파싱한다. */
export function parseReferencesHeader(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map(extractRfcMessageId)
    .filter(Boolean);
}

export interface MailInboundThreadingInput {
  /** 우리 저장소가 부여한 내부 id(uuid 등). 헤더가 전무하면 이 값이 thread id가 된다. */
  internalId: string;
  /** 수신 메일의 Message-ID 헤더 원문(있으면). */
  messageIdHeader?: string | null;
  /** In-Reply-To 헤더 원문. */
  inReplyToHeader?: string | null;
  /** References 헤더 원문. */
  referencesHeader?: string | null;
}

export interface MailInboundThreadingResolution {
  /** 헤더 기반으로 결정된 thread id. */
  threadId: string;
  inReplyTo: string | null;
  references: string[];
  /** 수신 메일 자체의 RFC message-id(추출 후). */
  rfcMessageId: string | null;
  /**
   * 헤더가 전혀 없어 제목 폴백(`findThreadIdBySubjectFallback`)을 시도해야
   * 하는지 여부. true면 threadId는 잠정값(internalId)이다.
   */
  needsSubjectFallback: boolean;
}

/**
 * 수신 메일의 thread id를 결정한다.
 * 우선순위: References의 첫 id(스레드 루트) → In-Reply-To → 내부 id(새 스레드).
 */
export function resolveInboundMailThreading(
  input: MailInboundThreadingInput,
): MailInboundThreadingResolution {
  const inReplyTo = input.inReplyToHeader
    ? extractRfcMessageId(input.inReplyToHeader) || null
    : null;
  const references = parseReferencesHeader(input.referencesHeader);
  const rfcMessageId = input.messageIdHeader
    ? extractRfcMessageId(input.messageIdHeader) || null
    : null;

  const threadId = references[0] ?? inReplyTo ?? input.internalId;
  const needsSubjectFallback = !inReplyTo && references.length === 0;

  return { threadId, inReplyTo, references, rfcMessageId, needsSubjectFallback };
}

/**
 * 답장/전달 제목 접두어(다국어) 정규화 패턴.
 * 원본(Re/Fwd/Fw/AW/WG/Réf/SV)에 한국어 클라이언트 접두어(회신/답장/전달)를 추가.
 */
export const mailSubjectReplyPrefixPattern =
  /^(?:(?:re|fwd?|fw|aw|wg|r[eé]f|sv|회신|답장|전달)\s*:\s*)+/i;

/** 제목에서 답장/전달 접두어를 제거하고 소문자·trim 정규화한다. */
export function normalizeMailSubjectForThreading(
  subject: string | null | undefined,
): string {
  if (!subject) return "";
  return subject.replace(mailSubjectReplyPrefixPattern, "").trim().toLowerCase();
}

export interface MailThreadCandidate {
  threadId: string;
  subject: string;
  /** 스레드에 등장한 발신/수신 주소 목록(정규화 여부 무관, 내부에서 정규화). */
  participantAddresses: string[];
  /** 스레드의 가장 최근 메시지 시각(ISO). */
  lastMessageDateIso: string;
}

export interface MailSubjectFallbackOptions {
  subject: string;
  /** 지정 시 이 주소가 스레드 참여자에 '정확히' 포함된 스레드만 매칭한다. */
  senderAddress?: string;
  /** 기준 시각(ISO). 결정적 테스트를 위해 호출자가 명시한다. */
  nowIso: string;
  /** 최근 며칠 안의 스레드만 대상으로 할지. 기본 7일. */
  windowDays?: number;
  /** 최신순으로 몇 개의 스레드까지 검사할지. 기본 50. */
  maxCandidates?: number;
}

/**
 * 헤더가 없는 수신 메일을 위한 제목 기반 스레드 폴백.
 *
 * 원본(agentic-inbox `findThreadBySubject`)과의 의도적 차이:
 * - 참여자 매칭을 GROUP_CONCAT 문자열 `includes` 검사 대신 주소 단위 정확
 *   일치로 수행한다(`a@x.com`이 `aa@x.com`에 오탐 매칭되던 문제 제거).
 * - 원본은 최신 50개 스레드를 자른 뒤 제목을 비교해 활동 많은 메일함에서
 *   폴백이 항상 실패했다 — 여기서는 제목 일치 후보에만 상한을 적용한다.
 * - 원본의 시간 상한 없음 유지: 발신자 시계가 앞서는 메일(흔함)도 매칭한다.
 * - 원본의 `thread_id != id`(답장 없는 단일 메시지 스레드 제외) 제약은
 *   이식하지 않았다 — 참여자 정확 일치가 전제라면 단일 메일 스레드에
 *   합치는 쪽이 우리 제품(문의 답장 흐름)에 맞다.
 *
 * 저장소 쿼리 대신 호출자가 후보 스레드 요약을 넘기는 순수 함수라
 * IMAP/Gmail/로컬 저장소 어디에서든 재사용할 수 있다.
 */
export function findThreadIdBySubjectFallback(
  candidates: MailThreadCandidate[],
  options: MailSubjectFallbackOptions,
): string | null {
  const normalizedSubject = normalizeMailSubjectForThreading(options.subject);
  if (!normalizedSubject) return null;

  const nowMs = new Date(options.nowIso).getTime();
  if (Number.isNaN(nowMs)) return null;
  const windowDays = options.windowDays ?? 7;
  const windowStartMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
  const maxCandidates = options.maxCandidates ?? 50;

  const normalizedSender = options.senderAddress?.trim().toLowerCase() || null;

  const subjectMatchedRecentFirst = [...candidates]
    .filter((candidate) => {
      const lastMs = new Date(candidate.lastMessageDateIso).getTime();
      if (Number.isNaN(lastMs) || lastMs < windowStartMs) return false;
      return (
        normalizeMailSubjectForThreading(candidate.subject) === normalizedSubject
      );
    })
    .sort(
      (a, b) =>
        new Date(b.lastMessageDateIso).getTime() -
        new Date(a.lastMessageDateIso).getTime(),
    )
    .slice(0, maxCandidates);

  for (const candidate of subjectMatchedRecentFirst) {
    if (normalizedSender) {
      const participants = candidate.participantAddresses.map((address) =>
        address.trim().toLowerCase(),
      );
      if (!participants.includes(normalizedSender)) continue;
    }
    return candidate.threadId;
  }
  return null;
}

export interface MailReferencesChainSource {
  /** 원본 메일의 RFC message-id(없으면 내부 id로 폴백). */
  rfcMessageId?: string | null;
  /** 원본 메일의 내부 저장 id. */
  internalId: string;
  /** 원본 메일에 저장된 References(JSON 문자열 또는 배열). */
  referencesJson?: string | null;
  references?: string[] | null;
  /** 원본 메일의 thread id(없으면 내부 id로 폴백). */
  threadId?: string | null;
}

export interface MailReferencesChain {
  /** In-Reply-To에 들어갈 원본 message-id. */
  originalMessageId: string;
  /** References 헤더에 들어갈 체인(원본 체인 + 원본 id). */
  references: string[];
  /** 답장이 속할 thread id. */
  threadId: string;
}

/**
 * 답장 발송 직전에 원본 메일로부터 References 체인을 재계산한다.
 * 저장된 References JSON이 깨져 있으면 빈 체인으로 취급한다(발송 차단 금지).
 */
export function buildMailReferencesChain(
  original: MailReferencesChainSource,
): MailReferencesChain {
  const originalMessageId = original.rfcMessageId || original.internalId;

  let existingReferences: string[] = [];
  if (Array.isArray(original.references)) {
    existingReferences = original.references.filter(Boolean);
  } else if (original.referencesJson) {
    try {
      const parsed: unknown = JSON.parse(original.referencesJson);
      if (Array.isArray(parsed)) {
        existingReferences = parsed.filter(
          (item): item is string => typeof item === "string" && item.length > 0,
        );
      }
    } catch {
      // References JSON이 깨진 원본 — 빈 체인으로 폴백
    }
  }

  const references = [...existingReferences, originalMessageId].filter(Boolean);
  const threadId = original.threadId || original.internalId;
  return { originalMessageId, references, threadId };
}

/** 답장 발송용 In-Reply-To / References 헤더를 만든다. */
export function buildMailThreadingHeaders(
  originalMessageId: string,
  references: string[],
): Record<string, string> {
  return {
    "In-Reply-To": `<${originalMessageId}>`,
    ...(references.length > 0
      ? { References: references.map((reference) => `<${reference}>`).join(" ") }
      : {}),
  };
}

export interface OutgoingRfcMessageId {
  /** 내부 저장용 id. */
  internalId: string;
  /** Message-ID 헤더에 들어갈 RFC 2822 형식 id(꺾쇠 미포함). */
  rfcMessageId: string;
}

/**
 * 발신 메일의 내부 id와 RFC Message-ID를 생성한다.
 * `uniqueId`를 주입하면 결정적 테스트가 가능하다(기본은 crypto.randomUUID).
 */
export function generateOutgoingRfcMessageId(
  fromDomain: string,
  uniqueId?: string,
): OutgoingRfcMessageId {
  const internalId = uniqueId ?? crypto.randomUUID();
  return { internalId, rfcMessageId: `${internalId}@${fromDomain}` };
}
