// Portions derived from Agentic Inbox (https://github.com/cloudflare/agentic-inbox)
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0)
// See THIRD_PARTY_NOTICES.md ("Agentic Inbox") for the full attribution record.
// Modifications: 플랫폼 중립 포팅(Workers/DO 의존 제거), 한국어 인용 라벨,
// HTML→텍스트 변환 시 줄바꿈 보존.

/**
 * 메일 인용/새니타이즈 유틸.
 *
 * 답장 초안에 원문을 인용 블록으로 붙일 때 사용하는 순수 함수 모음.
 * 핵심 안전 경계: 원문 HTML은 반드시 평문화 후 escape 해서 인용한다.
 * (수신 메일의 HTML을 그대로 인용하면 발신 메일/작성기에 stored XSS가 실린다.)
 */

/** OWASP 권장 5개 HTML 특수문자를 모두 escape 한다. 속성 컨텍스트에서도 안전. */
export function escapeMailHtml(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 평문을 공백 보존 HTML 블록으로 변환한다.
 * `white-space:pre-wrap`(모던 클라이언트)과 `<br>`(인라인 스타일을 제거하는
 * Outlook 계열)을 함께 사용한다.
 */
export function mailTextToHtml(text: string): string {
  if (!text) return "";
  const escaped = escapeMailHtml(text).replace(/\n/g, "<br>");
  return `<div style="white-space:pre-wrap">${escaped}</div>`;
}

/**
 * HTML에서 태그를 제거해 평문을 만든다.
 * `<style>`/`<script>` 블록(닫힘 태그가 없어도), HTML 주석(Outlook 조건부
 * 주석 포함), CDATA는 내용까지 제거하고, `<br>`(속성 유무 무관)·블록 요소
 * 닫힘은 줄바꿈으로 보존한다(원본 구현은 모든 공백을 한 줄로 접었음).
 */
export function stripMailHtmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/gi, "")
    .replace(/<style[^>]*>[\s\S]*?(?:<\/style>|$)/gi, "")
    .replace(/<script[^>]*>[\s\S]*?(?:<\/script>|$)/gi, "")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type MailQuoteLocale = "ko" | "en";

const koreanWeekdayLabels = ["일", "월", "화", "수", "목", "금", "토"] as const;
const englishWeekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const englishMonthLabels = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function safeParseDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * 인용 블록 헤더용 날짜 포맷.
 * ICU/locale 환경 차이를 피하려고 수동 포맷한다(원본은 toLocaleString "en-US").
 * - ko: "2026년 7월 20일 (월) 오후 3:42"
 * - en: "Mon, Jul 20, 2026, 3:42 PM"
 * 파싱 불가 문자열은 그대로 반환한다(정보 손실 방지).
 */
export function formatMailQuoteDate(
  dateStr: string | undefined,
  locale: MailQuoteLocale = "ko",
): string {
  if (!dateStr) return "";
  const date = safeParseDate(dateStr);
  if (!date) return dateStr;

  const hours24 = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

  if (locale === "en") {
    const weekday = englishWeekdayLabels[date.getDay()] ?? "";
    const month = englishMonthLabels[date.getMonth()] ?? "";
    const meridiem = hours24 < 12 ? "AM" : "PM";
    return `${weekday}, ${month} ${date.getDate()}, ${date.getFullYear()}, ${hours12}:${minutes} ${meridiem}`;
  }

  const weekday = koreanWeekdayLabels[date.getDay()] ?? "";
  const meridiem = hours24 < 12 ? "오전" : "오후";
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${weekday}) ${meridiem} ${hours12}:${minutes}`;
}

export interface MailQuotedReplySource {
  date?: string;
  sender?: string;
  body?: string;
}

export interface MailQuotedReplyOptions {
  locale?: MailQuoteLocale;
}

/**
 * 원문 메일 데이터로 인용 블록 HTML을 만든다.
 *
 * 안전 경계: 원문 body는 sandboxed 뷰어에서는 HTML로 안전하게 렌더되지만,
 * 인용 블록은 작성기와 발신 메일 본문에 그대로 들어가므로 반드시
 * 평문화(stripMailHtmlToText) 후 escape 한다. sender/date도 escape 한다.
 */
export function buildQuotedMailReplyBlock(
  original: MailQuotedReplySource,
  options: MailQuotedReplyOptions = {},
): string {
  if (!original.body) return "";

  const locale = options.locale ?? "ko";
  const quotedSender = escapeMailHtml(original.sender || (locale === "ko" ? "알 수 없음" : "unknown"));
  const quotedDate = escapeMailHtml(formatMailQuoteDate(original.date || "", locale));

  const plainBody = stripMailHtmlToText(original.body);
  const bodyToQuote = escapeMailHtml(plainBody).replace(/\n/g, "<br>");

  const attribution =
    locale === "ko"
      ? `${quotedDate}, ${quotedSender} 님이 작성:`
      : `On ${quotedDate}, ${quotedSender} wrote:`;

  return `<br><blockquote style="border-left: 2px solid #ccc; margin: 0; padding-left: 1em; color: #666;">${attribution}<br><br>${bodyToQuote}</blockquote>`;
}
