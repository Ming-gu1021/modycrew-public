/**
 * 팀 공유(우리 회사 · 공유 자료)로 올리기 전의 순수 함수들.
 *
 * 올라가는 것은 여기서 만든 제목·본문 그대로다. 화면은 이 결과를 "이 내용이 팀 공유
 * 자료로 올라갑니다" 아래에 한 글자도 바꾸지 않고 보여 주고, 확인을 받은 뒤 같은 값을
 * saveCompanyResource 에 넘긴다(그쪽 clean() 이 더 바꿀 것이 없도록 여기서 먼저 다듬는다).
 *
 * 인증값·이메일·전화번호·주민등록번호는 회사 운영이 AI 에 넘길 때 쓰는 가림 규칙
 * (company-automation/privacy.mjs)으로 똑같이 가린다. 메일은 남이 보낸 글이라 기본은
 * 제목과 앞부분 몇 줄만 담고, 더 넣는 것은 미리보기를 본 사람이 고른다.
 */

import { redactCompanyText } from "../../modycrew-desktop/src/main/company-automation/privacy.mjs";

export const TEAM_SHARE_HEADING = "이 내용이 팀 공유 자료로 올라갑니다";
export const TEAM_SHARE_TITLE_MAX = 160;
export const TEAM_SHARE_TEXT_MAX = 20000;
export const MAIL_SHARE_EXCERPT_CHARS = 280;
export const RECORD_SHARE_EXCERPT_CHARS = 1500;
export const TEAM_SHARE_CUT_NOTE = "\n…(길어서 여기까지만 올려요)";

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;

/** 줄바꿈을 맞추고, 보이지 않는 제어 문자를 빼고, 빈 줄은 두 줄까지만 남긴다. */
export function tidyShareText(value) {
  return String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(CONTROL_CHARACTERS, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function tidyLine(value) {
  return String(value ?? "").replace(CONTROL_CHARACTERS, " ").replace(/\s+/gu, " ").trim();
}

/** 이모지 같은 두 칸짜리 글자를 반으로 자르지 않는 자리. */
function safeEnd(text, end) {
  const code = text.charCodeAt(end - 1);
  return code >= 0xd800 && code <= 0xdbff ? end - 1 : end;
}

function cutAt(text, max, suffix) {
  if (text.length <= max) return { text, cut: false };
  const room = Math.max(1, max - suffix.length);
  let end = text.lastIndexOf("\n", room);
  if (end < room * 0.8) end = text.lastIndexOf(" ", room);
  if (end < room * 0.8) end = room;
  return { text: `${text.slice(0, safeEnd(text, end)).trimEnd()}${suffix}`, cut: true };
}

/** 팀 대화에 함께 남기는 한 줄 알림. */
export function teamShareAnnouncement(title) {
  return `📎 ${tidyLine(title)} 공유`;
}

const redactionLabels = {
  credential: "비밀번호·인증값",
  email: "이메일 주소",
  phone: "전화번호",
  resident_id: "주민등록번호",
};

/** "이메일 주소·전화번호" 처럼 가린 종류를 사람 말로. */
export function describeShareRedactions(categories = []) {
  return [...new Set(categories)].map((category) => redactionLabels[category] || "민감한 값").join("·");
}

/**
 * 올릴 제목·본문을 확정한다. 화면은 이 값을 그대로 보여 주고, 확인 뒤 그대로 올린다.
 * @param {{ title?: string; text?: string }} input
 */
export function buildTeamSharePreview(input = {}) {
  const titleRedaction = redactCompanyText(tidyLine(input.title));
  const title = cutAt(titleRedaction.text, TEAM_SHARE_TITLE_MAX, "…").text;
  const bodyRedaction = redactCompanyText(tidyShareText(input.text));
  const body = cutAt(bodyRedaction.text, TEAM_SHARE_TEXT_MAX, TEAM_SHARE_CUT_NOTE);
  const categories = [...new Set([...titleRedaction.categories, ...bodyRedaction.categories])].sort();
  return {
    title,
    text: body.text,
    truncated: body.cut,
    characters: body.text.length,
    redactionCount: titleRedaction.redactionCount + bodyRedaction.redactionCount,
    redactionCategories: categories,
    announcement: title ? teamShareAnnouncement(title) : "",
    ready: Boolean(title && body.text),
  };
}

function excerpt(text, max) {
  return cutAt(text, max, "…");
}

function localDateTimeLabel(value) {
  const date = new Date(String(value ?? ""));
  if (!value || Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 받은 메일 한 통을 팀에 알릴 내용. 기본(text)은 제목과 앞부분 몇 줄,
 * 더 담을 것이 있으면 fullText 에 저장된 미리보기 전체를 둔다(원문·첨부는 어느 쪽도 아니다).
 * @param {{ subject?: string; from?: string; receivedAt?: string; preview?: string }} row
 */
export function buildMailShareContent(row = {}, options = {}) {
  const limit = Number.isFinite(options.excerptChars) ? options.excerptChars : MAIL_SHARE_EXCERPT_CHARS;
  const subject = tidyLine(row.subject) || "제목 없음";
  const from = tidyLine(row.from) || "보낸 사람 없음";
  const received = localDateTimeLabel(row.receivedAt);
  const body = tidyShareText(row.preview);
  const short = excerpt(body, limit);
  const head = [`메일 제목: ${subject}`, `보낸 사람: ${from}`, ...(received ? [`받은 시각: ${received}`] : [])];
  const text = [...head, "", short.text || "(미리보기 없음)", "", short.cut ? "메일 앞부분만 옮겼어요. 원문과 첨부파일은 올리지 않았어요." : "원문과 첨부파일은 올리지 않았어요."].join("\n");
  const fullText = short.cut ? [...head, "", body, "", "앱에 저장된 메일 미리보기 전체예요. 원문과 첨부파일은 올리지 않았어요."].join("\n") : undefined;
  return { title: `메일: ${subject}`, text, ...(fullText ? { fullText } : {}) };
}

/**
 * 문서 작업실의 문서 내용(spec)을 읽을 수 있는 글로.
 * @param {{ title?: string; company?: string; author?: string; period?: string; sections?: Array<{ heading?: string; paragraphs?: string[]; table?: { columns?: string[]; rows?: string[][] } }> }} spec
 */
export function documentSpecShareText(spec = {}) {
  const lines = [];
  const meta = [spec.company, spec.author, spec.period].map(tidyLine).filter(Boolean);
  if (meta.length) lines.push(meta.join(" · "), "");
  for (const section of Array.isArray(spec.sections) ? spec.sections : []) {
    const heading = tidyLine(section?.heading);
    if (heading) lines.push(`■ ${heading}`);
    for (const paragraph of Array.isArray(section?.paragraphs) ? section.paragraphs : []) {
      const value = tidyShareText(paragraph);
      if (value) lines.push(value);
    }
    const table = section?.table;
    if (table && Array.isArray(table.columns) && table.columns.length) {
      lines.push(table.columns.map(tidyLine).join(" | "));
      for (const row of Array.isArray(table.rows) ? table.rows : []) lines.push((Array.isArray(row) ? row : []).map(tidyLine).join(" | "));
    }
    lines.push("");
  }
  return tidyShareText(lines.join("\n"));
}

/**
 * 회사 운영에서 마스터가 취합한 결과.
 * @param {{ request?: string; result?: string; status?: string }} work
 */
export function companyWorkShareContent(work = {}, options = {}) {
  const request = tidyLine(String(work.request ?? "").split("\n")[0]) || "회사 업무";
  const master = tidyLine(options.masterName) || "마스터";
  const text = [`맡긴 일: ${request}`, `${master}가 정리한 결과:`, "", tidyShareText(work.result) || "(결과 없음)", "", "부서별 자세한 결과와 근거 자료는 회사 운영 화면에 있어요."].join("\n");
  return { title: `회사 운영 결과: ${request}`, text };
}

/**
 * 회사 운영에 보관한 자료 한 건. 기본은 앞부분, fullText 는 읽은 본문 전체.
 * @param {{ name?: string; version?: number; format?: string; text?: string }} record
 */
export function companyRecordShareContent(record = {}, options = {}) {
  const limit = Number.isFinite(options.excerptChars) ? options.excerptChars : RECORD_SHARE_EXCERPT_CHARS;
  const name = tidyLine(record.name) || "회사 자료";
  const label = [name, record.version ? `v${record.version}` : "", tidyLine(record.format).toUpperCase()].filter(Boolean).join(" · ");
  const body = tidyShareText(record.text);
  const short = excerpt(body, limit);
  const head = [`자료: ${label}`, ""];
  const text = [...head, short.text || "(읽은 본문 없음)", "", short.cut ? "자료 앞부분만 옮겼어요. 원본 파일은 올리지 않았어요." : "원본 파일은 올리지 않았어요."].join("\n");
  const fullText = short.cut ? [...head, body, "", "읽은 본문 전체예요. 원본 파일은 올리지 않았어요."].join("\n") : undefined;
  return { title: `회사 자료: ${name}`, text, ...(fullText ? { fullText } : {}) };
}

/** 드라이브 파일 연결을 공유 자료로 남길 때의 본문(링크 + 한 줄 설명). */
export function driveLinkShareText(file = {}, note = "") {
  const link = String(file.webViewLink ?? "").trim();
  return [link, tidyShareText(note)].filter(Boolean).join("\n");
}

const LINK_PATTERN = /https?:\/\/[^\s<>"'`　ㄱ-ㆎ가-힣]+/giu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}」』>]+$/u;
const LINK_MAX = 500;

function safeLink(candidate) {
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password || !url.hostname || url.href.length > LINK_MAX) return "";
    return url.href;
  } catch {
    return "";
  }
}

/**
 * 공유 자료 본문을 글과 링크 조각으로 나눈다. 링크는 http(s) 만, 계정 정보가 붙은 주소는
 * 글로 남긴다(열 때는 앱의 안전한 열기 확인을 거친다).
 * @returns {Array<{ kind: "text"; value: string } | { kind: "link"; value: string; href: string }>}
 */
export function splitShareLinks(text) {
  const source = String(text ?? "");
  const parts = [];
  let last = 0;
  for (const match of source.matchAll(LINK_PATTERN)) {
    const raw = match[0].replace(TRAILING_PUNCTUATION, "");
    const href = safeLink(raw);
    if (!href) continue;
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: "text", value: source.slice(last, start) });
    parts.push({ kind: "link", value: raw, href });
    last = start + raw.length;
  }
  if (last < source.length) parts.push({ kind: "text", value: source.slice(last) });
  return parts;
}

const LAST_TARGET_KEY = "modycrew.teamShare.lastTarget.v1";

/** 지난번에 고른 회사·팀(이 PC, 이 계정의 편의 기억일 뿐 권한 판단에 쓰지 않는다). */
export function readLastShareTarget(storage, uid) {
  try {
    const all = JSON.parse(storage?.getItem(LAST_TARGET_KEY) || "{}");
    const value = all && typeof all === "object" ? all[uid] : null;
    return value && typeof value.companyId === "string" ? { companyId: value.companyId, teamId: typeof value.teamId === "string" ? value.teamId : "" } : null;
  } catch {
    return null;
  }
}

export function rememberShareTarget(storage, uid, target) {
  try {
    const all = JSON.parse(storage?.getItem(LAST_TARGET_KEY) || "{}");
    const next = all && typeof all === "object" && !Array.isArray(all) ? all : {};
    next[uid] = { companyId: String(target.companyId || ""), teamId: String(target.teamId || "") };
    storage?.setItem(LAST_TARGET_KEY, JSON.stringify(next));
  } catch {
    /* 기억 못 해도 다음에 다시 고르면 된다. */
  }
}

/** 고를 회사: 지난번 회사가 아직 소속이면 그 회사, 아니면 첫 회사. */
export function chooseShareCompany(memberships = [], last = null) {
  const active = memberships.filter((item) => item && item.status === "active");
  if (last && active.some((item) => item.companyId === last.companyId)) return last.companyId;
  return active[0]?.companyId || "";
}

/** 이 사람이 글을 올릴 수 있는 팀(전체 공개 팀 + 멤버로 지정된 팀), 전체 팀이 맨 앞. */
export function shareableTeams(teams = [], uid = "") {
  return teams
    .filter((team) => team && (team.visibility === "company" || (Array.isArray(team.memberIds) && team.memberIds.includes(uid))))
    .sort((a, b) => (a.id === "general" ? -1 : b.id === "general" ? 1 : String(a.name).localeCompare(String(b.name), "ko")));
}
