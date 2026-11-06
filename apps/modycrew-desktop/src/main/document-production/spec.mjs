import { readFileSync } from "node:fs";
export const catalog = JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url), "utf8"));
export const formats = ["docx", "pptx", "xlsx", "pdf", "hwpx", "hwp"];
export function cleanText(value, max = 20000) {
  const result = String(value ?? "").normalize("NFC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "").trim();
  if (result.length > max) throw new Error(`문서 내용이 너무 깁니다. 한 항목은 ${max}자 이하로 나눠 주세요.`);
  return result;
}

// AI 답변을 그대로 문서로 옮기면 마크다운 표가 "| 항목 | 내용 |", "|---|---|" 같은 기호로 남는다.
// 저장 전에 표는 실제 표로, 제목 기호(#)와 강조 기호(**)는 문서 서식으로 바꿔 읽는 사람이 기호를 보지 않게 한다.
const MARKDOWN_TABLE_ROW = /^\s*\|.*\|\s*$/u;
const MARKDOWN_TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/u;
const MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u;
const MARKDOWN_RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u;
const MARKDOWN_SIGNAL = /(?:^|\n)\s*(?:\|.*\||#{1,6}\s|(?:-{3,}|\*{3,}|_{3,})\s*(?:\n|$)|\*[^*\n]+\*\s*(?:\n|$))|\*\*|__/u;

export function stripMarkdownInline(text) {
  return String(text ?? "")
    .replace(/\*\*\*([^*\n]+)\*\*\*/gu, "$1")
    .replace(/\*\*([^*\n]+)\*\*/gu, "$1")
    .replace(/__([^_\n]+)__/gu, "$1")
    .replace(/`([^`\n]+)`/gu, "$1")
    .replace(/^(\s*)\*([^*\n]+)\*\s*$/gmu, "$1$2");
}

function markdownCells(line) {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  return text.split("|").map((cell) => stripMarkdownInline(cell.trim()));
}

export function expandMarkdownSections(sections) {
  const hasMarkdown = (section) => !section?.table && Array.isArray(section?.paragraphs) && section.paragraphs.some((p) => MARKDOWN_SIGNAL.test(String(p ?? "")));
  if (!sections.some(hasMarkdown)) return sections;
  const expanded = [];
  for (const section of sections) {
    if (!hasMarkdown(section)) { expanded.push(section); continue; }
    let current = { heading: String(section.heading ?? ""), paragraphs: [] };
    const flush = (nextHeading = "") => {
      if (current.heading.trim() || current.paragraphs.length || current.table) expanded.push(current);
      current = { heading: nextHeading, paragraphs: [] };
    };
    for (const paragraph of section.paragraphs) {
      const lines = String(paragraph ?? "").split(/\r?\n/u);
      let buffer = [];
      const pushText = () => {
        const text = stripMarkdownInline(buffer.join("\n")).trim();
        if (text) current.paragraphs.push(text);
        buffer = [];
      };
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const heading = line.match(MARKDOWN_HEADING);
        if (heading) {
          pushText();
          flush(stripMarkdownInline(heading[1]).trim());
          continue;
        }
        if (MARKDOWN_TABLE_ROW.test(line) && MARKDOWN_TABLE_SEPARATOR.test(lines[i + 1] ?? "")) {
          const columns = markdownCells(line);
          let end = i + 2;
          const rows = [];
          while (end < lines.length && MARKDOWN_TABLE_ROW.test(lines[end])) {
            const cells = markdownCells(lines[end]);
            rows.push(columns.map((_, index) => (index === columns.length - 1 ? cells.slice(index).join(" | ") : cells[index] ?? "")));
            end += 1;
          }
          if (columns.length >= 1 && columns.length <= 12 && rows.length) {
            pushText();
            if (current.table) flush("");
            current.table = { columns, rows };
            // 표 뒤에 이어지는 글은 새 항목으로 넘겨 원래 읽는 순서(글 → 표 → 글)를 지킨다.
            flush("");
            i = end - 1;
            continue;
          }
        }
        if (MARKDOWN_RULE.test(line)) { pushText(); continue; }
        buffer.push(line);
      }
      pushText();
    }
    flush("");
  }
  return expanded.length && expanded.length <= 60 ? expanded : sections;
}

export function normalizeSpec(input = {}) {
  const title = cleanText(input.title, 180);
  if (!title) throw new Error("문서 제목을 입력해 주세요.");
  const template = catalog.entries.find((item) => item.id === input.templateId) ?? catalog.entries.at(-1);
  const sections = expandMarkdownSections(Array.isArray(input.sections) ? input.sections : []);
  if (!sections.length || sections.length > 60) throw new Error("본문은 1~60개 항목으로 구성해 주세요.");
  let total = title.length;
  const normalized = sections.map((section) => {
    const heading = cleanText(section.heading, 180);
    const paragraphs = (Array.isArray(section.paragraphs) ? section.paragraphs : []).map((p) => cleanText(p)).filter(Boolean);
    if (paragraphs.length > 400) throw new Error("문단이 너무 많습니다. 문서를 나눠 주세요.");
    let table;
    if (section.table) {
      const columns = section.table.columns?.map((item) => cleanText(item, 120));
      if (!columns?.length || columns.length > 12) throw new Error("표는 1~12개 열을 사용할 수 있습니다.");
      const rows = section.table.rows;
      if (!Array.isArray(rows) || rows.length > 2000 || rows.some((row) => !Array.isArray(row) || row.length !== columns.length)) throw new Error("표의 행과 열 개수를 확인해 주세요.");
      table = { columns, rows: rows.map((row) => row.map((cell) => cleanText(cell, 4000))) };
    }
    total += heading.length + paragraphs.join("").length + (table ? JSON.stringify(table).length : 0);
    return { heading, paragraphs, ...(table ? { table } : {}) };
  });
  if (total > 160000) throw new Error("한 문서의 내용이 너무 많습니다. 기간이나 항목을 나눠 주세요.");
  if (!normalized.some((s) => s.paragraphs.length || s.table?.rows.length)) throw new Error("문서에 넣을 실제 내용을 입력해 주세요.");
  if ((input.sources?.length || 0) > 100 || (input.notes?.length || 0) > 40) throw new Error("작성 근거나 검토 메모가 너무 많습니다. 문서를 나눠 주세요.");
  return { version: 1, title, templateId: template.id, templateVersion: template.version,
    company: cleanText(input.company, 140), author: cleanText(input.author, 80), period: cleanText(input.period, 140),
    sections: normalized, sources: (Array.isArray(input.sources) ? input.sources : []).slice(0, 100).map((s) => cleanText(s, 500)),
    notes: (Array.isArray(input.notes) ? input.notes : []).slice(0, 40).map((s) => cleanText(s, 1000)),
  };
}
export function recommendTemplate(request = "") {
  const candidates = [["presentation", /ppt|발표|프레젠테이션/iu], ["minutes", /회의록/u], ["monthly", /월간|이번\s*달/u], ["weekly", /주간|이번\s*주/u], ["quotation", /견적/u], ["trip", /출장/u], ["approval", /품의/u], ["payment", /지출결의/u], ["business_plan", /사업계획/u], ["handoff", /인수인계/u], ["schedule", /일정/u], ["daily", /일일|오늘/u]];
  return candidates.find(([, re]) => re.test(request))?.[0] ?? "general";
}
export function specFields(spec) {
  return { title: spec.title, 제목: spec.title, company: spec.company, 회사: spec.company, author: spec.author, 작성자: spec.author, period: spec.period, 기간: spec.period,
    body: spec.sections.map((s) => [s.heading, ...s.paragraphs, ...(s.table ? [s.table.columns.join(" | "), ...s.table.rows.map((r) => r.join(" | "))] : [])].join("\n")).join("\n\n"),
    ...Object.fromEntries(spec.sections.map((s) => [s.heading, [...s.paragraphs, ...(s.table ? [s.table.columns.join(" | "), ...s.table.rows.map((r) => r.join(" | "))] : [])].join("\n")])),
  };
}
export function qualityNotes(spec) {
  const body = JSON.stringify(spec);
  return [...spec.notes, ...(/확인 필요|미확인|미정|\{\{[^}]+\}\}/u.test(body) ? ["확인이 필요한 항목이 남아 있습니다. 외부 제출 전에 검토해 주세요."] : []),
    ...(/\b\d{6}[- ]?[1-4]\d{6}\b/u.test(body) ? ["주민등록번호로 보이는 내용이 있습니다. 필요한 범위만 남기거나 가려 주세요."] : [])];
}
