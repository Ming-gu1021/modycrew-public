   
                                                           
  
                                                             
                                                                       
                                                       
                                                       
  
                                                                 
                                                          
                                                           
   
import type { AgentToolBridge, AgentToolContext, AgentToolEntry } from "./agent-tools";

export type DocumentFormat = "docx" | "hwpx" | "pdf" | "pptx" | "xlsx";
export type SavedDocument = { id: string; title: string; name: string; format: string; path: string; bytes: number; notes?: string[] };
export type DocumentProductionResult = {
  status: string;
  userMessage?: string;
  document?: SavedDocument;
  resultsFolder?: string;
  resultFile?: string;
  resultsCopyError?: string;
};
type DocumentProductionCall = (payload: Record<string, unknown>) => Promise<DocumentProductionResult>;
type DocumentToolEntry = AgentToolEntry & { timeoutMs?: number };

export const documentCrewLabel = "모디크루 문서 크루";
export const documentChatToolTimeoutMs = 3 * 60_000;
const formatLabels: Record<DocumentFormat, string> = { docx: "워드(DOCX)", hwpx: "한글(HWPX)", pdf: "PDF", pptx: "파워포인트(PPTX)", xlsx: "엑셀(XLSX)" };

/** 데스크톱 브리지의 문서 제작 연결. 없으면 undefined(웹 미리보기·구버전 설치본). */
export function documentProductionBridge(bridge?: unknown): DocumentProductionCall | undefined {
  const fromBridge = (bridge as { documentProduction?: unknown } | undefined)?.documentProduction;
  const fromWindow = typeof window === "undefined" ? undefined : (window as unknown as { modyCrewDesktopBridge?: { documentProduction?: unknown } }).modyCrewDesktopBridge?.documentProduction;
  const call = typeof fromBridge === "function" ? fromBridge : fromWindow;
  return typeof call === "function" ? (call as DocumentProductionCall) : undefined;
}

/** 형식 인자(또는 제목·요청의 낱말)로 저장 형식을 고른다. 말이 없으면 워드(docx). */
export function normalizeDocumentFormat(value: unknown, hint = ""): DocumentFormat {
  const direct = String(value ?? "").trim().toLowerCase().replace(/^\./u, "");
  if (direct === "docx" || direct === "hwpx" || direct === "pdf" || direct === "pptx" || direct === "xlsx") return direct;
  const text = (direct + " " + String(hint ?? "")).toLowerCase();
  if (/hwpx|\bhwp\b|한글\s*(?:파일|문서)|한컴/u.test(text)) return "hwpx";
  if (/pptx|\bppt\b|파워\s*포인트|피피티|슬라이드|발표\s*자료/u.test(text)) return "pptx";
  if (/xlsx|엑셀|excel|스프레드\s*시트/u.test(text)) return "xlsx";
  if (/\bpdf\b/u.test(text)) return "pdf";
  return "docx";
}

const templateRules: ReadonlyArray<readonly [RegExp, string]> = [
  [/주간\s*(?:업무)?\s*보고/u, "weekly"], [/월간\s*(?:업무)?\s*보고/u, "monthly"], [/일일\s*업무|업무\s*일지/u, "daily"],
  [/회의록/u, "minutes"], [/사업\s*계획/u, "business_plan"], [/발표/u, "presentation"], [/공문/u, "official"],
  [/견적/u, "quotation"], [/인수\s*인계/u, "handoff"], [/출장/u, "trip"], [/품의/u, "approval"], [/지출\s*결의/u, "payment"],
  [/영업\s*활동|영업\s*보고/u, "sales"], [/임원/u, "executive"],
];

/** 제목·요청에 맞는 기본 양식 id(데스크톱 카탈로그). 맞는 것이 없으면 일반 문서. */
export function guessDocumentTemplate(text: string): string {
  const normalized = String(text ?? "");
  for (const [pattern, id] of templateRules) if (pattern.test(normalized)) return id;
  return "general";
}

/** 마크다운 내용 → 문서 엔진 명세. 맨 앞 '# 제목'이 문서 제목과 같으면 빼서 제목이 두 번 나오지 않게 한다. */
export function buildDocumentSpec({ title, content, templateId }: { title: string; content: string; templateId: string }) {
  let body = String(content ?? "").replace(/\r\n?/gu, "\n").trim();
  const firstLine = body.split("\n", 1)[0] ?? "";
  const heading = firstLine.match(/^#\s+(.+?)\s*#*\s*$/u)?.[1]?.trim();
  if (heading && (heading === title || title.includes(heading) || heading.includes(title))) body = body.slice(firstLine.length).trim();
  const hasHeadings = /^\s{0,3}#{1,6}\s+\S/mu.test(body);
  return {
    title,
    templateId,
    sections: [{ heading: hasHeadings ? "" : "주요 내용", paragraphs: body.split(/\n\s*\n/u).map((part) => part.trim()).filter(Boolean) }],
  };
}

/** 실행 결과 → 모델 관찰 문장. 실제로 저장된 파일·폴더만 알리고, 답변에 무엇을 써야 하는지 정한다. */
export function formatDocumentObservation(result: DocumentProductionResult, format: DocumentFormat): string {
  const saved = result.document;
  if (result.status !== "saved" || !saved) {
    return [
      "failed · " + (clip(result.userMessage, 200) || "문서 파일을 저장하지 못했습니다."),
      "답변 규칙: 문서 파일을 만들지 못했습니다. 만들었다고 쓰지 말고 이유와 다음 행동(내용을 고쳐 다시 만들기 등)을 알려 주세요.",
    ].join("\n");
  }
  const lines = ["completed · " + formatLabels[format] + " 문서를 저장했습니다", "담당: " + documentCrewLabel];
  if (result.resultsFolder) lines.push("결과 폴더: " + result.resultsFolder);
  lines.push("만든 파일: " + saved.name);
  if (result.resultsCopyError || !result.resultsFolder) lines.push("파일 위치: " + saved.path + (result.resultsCopyError ? " (결과 폴더 복사 실패: " + clip(result.resultsCopyError, 120) + ")" : ""));
  if (saved.notes?.length) lines.push("검토 메모: " + saved.notes.slice(0, 3).map((note) => clip(note, 120)).join(" / "));
  lines.push("답변 규칙: 모디크루 문서 크루가 만들었다고 쓰고, 결과 폴더 위치와 파일 이름을 그대로 적으세요. 대화 화면 결과 카드에서 바로 열 수 있습니다. 내용에 '[확인 필요]'가 있으면 무엇을 확인해야 하는지 짧게 알려 주세요.");
  return lines.join("\n");
}

export const documentChatAgentTools: DocumentToolEntry[] = [
  {
    id: "document.create",
    korLabel: "문서 파일 만들기",
    korDescription: "보고서·기획서·회의록·제안서·공문·계획서·발표자료 같은 업무 문서를 실제 파일(워드 docx·한글 hwpx·PDF·파워포인트 pptx·엑셀 xlsx)로 만듭니다. 모디크루 문서 크루가 content(마크다운: ## 소제목, 문단, | 표 |)를 서식 있는 문서로 저장하고, 결과 폴더(예: D:\\ModyCrew 결과\\문서)를 앱이 만들어 알려 줍니다. 사용자가 문서·보고서·워드·한글·PDF 파일을 원하면 글로만 답하지 말고 이 도구로 파일을 만드세요. 자료가 부족해도 확인된 내용으로 초안을 만들고, 모르는 숫자·날짜·실적은 지어내지 말고 '[확인 필요]'로 표시하세요. 형식을 말하지 않았으면 docx 로 만드세요. 폴더나 실행기를 사용자에게 묻지 마세요.",
    argsHint: '{"title":"문서 제목","format":"docx|hwpx|pdf|pptx|xlsx","content":"## 1. 개요\\n본문 문단\\n\\n## 2. 진행 현황\\n| 항목 | 상태 |\\n|---|---|\\n| 예시 | [확인 필요] |"}',
    permission: "auto",
    timeoutMs: documentChatToolTimeoutMs,
    execute: async (bridge: AgentToolBridge, args: Record<string, unknown>, _ctx: AgentToolContext) => {
      const call = documentProductionBridge(bridge);
      if (!call) return "unavailable · 문서 파일 만들기는 최신 모디크루 설치 앱에서 사용할 수 있습니다.";
      const title = clip(args.title ?? args.제목, 120) || "업무 문서";
      const content = String(args.content ?? args.내용 ?? args.body ?? "").trim();
      if (!content) return "failed · 문서에 넣을 내용(content)이 비어 있습니다. 제목·소제목·문단·표를 마크다운으로 content 에 넣어 다시 부르세요. 인자는 한 줄 JSON 이어야 하고 줄바꿈은 \\n 으로 씁니다.";
      const format = normalizeDocumentFormat(args.format, title);
      const templateId = clip(args.templateId, 40) || guessDocumentTemplate(title + " " + content.slice(0, 300));
      try {
        const saved = await call({ kind: "export", spec: buildDocumentSpec({ title, content, templateId }), format, copyToResults: true });
        return formatDocumentObservation(saved, format);
      } catch (error) {
        return formatDocumentObservation({ status: "failed", userMessage: "문서 파일을 만들지 못했습니다: " + clip(error instanceof Error ? error.message : String(error), 160) }, format);
      }
    },
  },
];

function clip(value: unknown, max: number): string {
  const text = String(value ?? "").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

