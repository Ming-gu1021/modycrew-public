   
                       
  
                                                              
                                                            
                                                         
  
                                                                           
                                                                         
                      
                                                          
                                                          
   
import type { AgentToolBridge, AgentToolContext, AgentToolEntry } from "./agent-tools";

/** kind: image | web | document | media | archive | code | file — 결과 카드가 이미지 외 파일을 '열기'로 보여 줄 때 쓴다. */
export type CreativeStudioFile = { name: string; path: string; bytes: number; sha256?: string; createdAt?: string; kind?: string };
export type CreativeStudioStatus = "queued" | "connecting" | "generating" | "saving" | "completed" | "failed" | "cancelled" | "needs_connection";
export type CreativeStudioJob = {
  id: string;
  status: CreativeStudioStatus | string;
  detail: string;
  crewLabel: string;
  engineLabel?: string;
  title: string;
  request: string;
  count: number;
  aspect: "portrait" | "square" | "landscape" | string;
  folder: string;
  files: CreativeStudioFile[];
  description?: string;
  action?: string;
  startedAt: string;
  finishedAt?: string;
  elapsedMs?: number;
  conversationThreadId?: string;
  teammateId?: string;
};
export type CreativeStudioResult = {
  status: string;
  userMessage: string;
  job?: CreativeStudioJob;
  jobs?: CreativeStudioJob[];
  dataUrl?: string;
  files?: CreativeStudioFile[];
  otherFiles?: CreativeStudioFile[];
  folder?: string;
  resultsRoot?: string;
  action?: string;
  crewLabel?: string;
  engines?: Array<{ id: string; label: string; installed: boolean; ready: boolean; account?: string }>;
};
type CreativeStudioCall = (payload: Record<string, unknown>) => Promise<CreativeStudioResult>;

/** 실행이 오래 걸리는 도구. 대화 화면이 이 값을 읽으면 기본 도구 제한 시간 대신 이 시간까지 기다린다. */
export type LongRunningAgentToolEntry = AgentToolEntry & { timeoutMs?: number };
/** 대화 화면이 넘겨줄 수 있는 추가 문맥. 없으면 기본값으로 동작한다. */
type CreativeStudioToolContext = AgentToolContext & { threadId?: string; toolTimeoutMs?: number };

export const CREATIVE_STUDIO_EVENT = "modycrew:creative-studio";
export const creativeStudioCrewLabel = "모디크루 디자인 크루";
export const creativeStudioActiveStatuses: ReadonlySet<string> = new Set(["queued", "connecting", "generating", "saving"]);
/** 지금 대화 화면은 도구를 20초에서 끊는다. 그 안에서 돌려주고, 나머지는 진행 카드가 이어 보여 준다. */
export const defaultCreativeToolWaitMs = 17_000;
export const creativeStudioToolTimeoutMs = 8 * 60_000;

/** 데스크톱 브리지의 이미지 스튜디오 연결. 없으면 undefined(구버전 설치본·웹 미리보기). */
export function creativeStudioBridge(bridge?: unknown): CreativeStudioCall | undefined {
  const fromBridge = (bridge as { creativeStudio?: unknown } | undefined)?.creativeStudio;
  const fromWindow = typeof window === "undefined" ? undefined : (window as unknown as { modyCrewDesktopBridge?: { creativeStudio?: unknown } }).modyCrewDesktopBridge?.creativeStudio;
  const call = typeof fromBridge === "function" ? fromBridge : fromWindow;
  return typeof call === "function" ? (call as CreativeStudioCall) : undefined;
}

export async function creativeStudio(payload: Record<string, unknown>, bridge?: unknown): Promise<CreativeStudioResult> {
  const call = creativeStudioBridge(bridge);
  if (!call) return { status: "unavailable", userMessage: "이미지 만들기는 최신 모디크루 설치 앱에서 사용할 수 있습니다." };
  try {
    return await call(payload);
  } catch (error) {
    return { status: "failed", userMessage: "이미지 스튜디오와 연결하지 못했습니다: " + clip(error instanceof Error ? error.message : String(error), 160) };
  }
}

/** 진행 카드에 작업 상태를 알린다. 화면이 없거나 실패해도 작업에는 영향이 없다. */
export function emitCreativeStudioJob(job: CreativeStudioJob, context: { threadId?: string } = {}): void {
  if (typeof window === "undefined" || !job?.id) return;
  const detail = { job: { ...job, conversationThreadId: job.conversationThreadId || context.threadId || "" } };
  try { window.dispatchEvent(new CustomEvent(CREATIVE_STUDIO_EVENT, { detail })); } catch { /* 화면 알림 실패 무시 */ }
}

export function isCreativeStudioActive(job: Pick<CreativeStudioJob, "status"> | null | undefined): boolean {
  return Boolean(job && creativeStudioActiveStatuses.has(String(job.status)));
}

/** 작업이 끝나거나 기다릴 시간이 다할 때까지 상태를 읽는다. 바뀔 때마다 onUpdate 로 알린다. */
export async function followCreativeStudioJob(
  first: CreativeStudioJob,
  { bridge, waitMs = defaultCreativeToolWaitMs, pollMs = 1_500, onUpdate, sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now() }:
  { bridge?: unknown; waitMs?: number; pollMs?: number; onUpdate?: (job: CreativeStudioJob) => void; sleep?: (ms: number) => Promise<unknown>; now?: () => number } = {},
): Promise<CreativeStudioJob> {
  let job = first;
  const deadline = now() + Math.max(0, waitMs);
  let lastKey = job.status + "|" + job.files.length + "|" + job.detail;
  while (isCreativeStudioActive(job) && now() < deadline) {
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
    const next = await creativeStudio({ kind: "job", jobId: job.id }, bridge);
    if (!next.job) break;
    job = next.job;
    const key = job.status + "|" + job.files.length + "|" + job.detail;
    if (key !== lastKey) { lastKey = key; onUpdate?.(job); }
  }
  return job;
}

/** 실행 결과 → 모델 관찰 문장. 실제 상태·파일·폴더만 알리고, 답변에 무엇을 써야 하는지 정한다. */
export function formatCreativeStudioObservation(result: CreativeStudioResult): string {
  const job = result.job;
  const status = String(job?.status ?? result.status);
  const detail = job?.detail || result.userMessage || "";
  const lines = [status + " · " + detail];
  if (job) lines.push("작업 ID: " + job.id, "담당: " + (job.crewLabel || creativeStudioCrewLabel));
  if (status === "completed" && job) {
    lines.push(
      "결과 폴더: " + job.folder,
      "만든 파일: " + job.files.map((file) => file.name).join(", "),
      "대화 화면의 이미지 카드에 완성된 이미지가 바로 보입니다.",
      "답변 규칙: 모디크루 디자인 크루가 만들었다고 쓰고, 결과 폴더 위치와 파일 이름을 그대로 적으세요. 처리 엔진(Codex·GPT 등) 이름은 사용자가 물을 때만 말하세요. 이미지를 직접 봤다고 쓰지 말고, 내용 설명은 아래 엔진 설명만 근거로 짧게 하세요.",
    );
    if (job.description) lines.push("엔진 설명:\n" + clip(job.description, 1_200));
    return lines.join("\n");
  }
  if (creativeStudioActiveStatuses.has(status) && status !== "connecting") {
    lines.push(
      "아직 그리는 중입니다." + (job?.files.length ? " 지금까지 " + job.files.length + "장 완성." : ""),
      "대화 화면에 진행 카드가 떠 있고, 완성되는 장부터 그 카드에 나타납니다(결과 폴더는 앱이 자동으로 만듭니다).",
      "답변 규칙: '모디크루 디자인 크루가 지금 이미지를 만들고 있다'고만 쓰세요. 완성됐다고 쓰지 마세요. 사용자에게 실행기·폴더를 묻지 마세요. 사용자가 다시 물으면 studio.image.status 로 확인하세요.",
    );
    return lines.join("\n");
  }
  if (status === "connecting") {
    lines.push("답변 규칙: 모디크루가 GPT 연결 창(브라우저)을 열었고, 로그인하면 자동으로 이어서 만든다고 알려 주세요. 아직 만들지 않았습니다.");
    return lines.join("\n");
  }
  if (status === "needs_connection") {
    lines.push("답변 규칙: 아직 만들지 않았습니다. 이유와, 연결되면 모디크루가 바로 이어서 만든다는 점을 짧게 알려 주세요. 만들었다고 쓰지 마세요.");
    return lines.join("\n");
  }
  lines.push("답변 규칙: 만들지 못했습니다. 만들었다고 쓰지 말고 이유와 다음 행동(다시 만들기 등)을 알려 주세요.");
  return lines.join("\n");
}

function clip(value: unknown, max: number): string {
  const text = String(value ?? "").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function newRequestId(): string {
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoLike?.randomUUID === "function") return cryptoLike.randomUUID();
  return "studio-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function waitBudget(ctx: CreativeStudioToolContext): number {
  const timeout = Number(ctx.toolTimeoutMs);
  return Number.isFinite(timeout) && timeout > 5_000 ? timeout - 3_000 : defaultCreativeToolWaitMs;
}

export const creativeStudioAgentTools: LongRunningAgentToolEntry[] = [
  {
    id: "studio.image.generate",
    korLabel: "이미지·홍보물 만들기",
    korDescription: "포스터·전단·SNS 카드·카드뉴스 표지·배너·썸네일·로고 시안·일러스트·제품 이미지 같은 그림을 실제 이미지 파일(PNG)로 만듭니다. 모디크루 디자인 크루가 연결된 GPT로 직접 그리고, 결과 폴더(예: D:\\ModyCrew 결과\\이미지)를 앱이 만들어 저장합니다. 그림·홍보물·디자인 결과물을 원하면 글로 된 시안 설명 대신 이 도구를 먼저 부르세요. 실행기나 폴더를 사용자에게 묻지 마세요. GPT 연결이 없으면 이 도구가 연결을 시작합니다.",
    argsHint: '{"request":"그릴 내용(대상·분위기·꼭 넣을 문구는 그대로)","title":"결과 폴더 이름으로 쓸 짧은 주제","count":1,"aspect":"portrait|square|landscape"}',
    permission: "auto",
    timeoutMs: creativeStudioToolTimeoutMs,
    execute: async (bridge: AgentToolBridge, args: Record<string, unknown>, rawCtx: AgentToolContext) => {
      const ctx = rawCtx as CreativeStudioToolContext;
      const request = String(args.request ?? args.prompt ?? args.요청 ?? "").trim();
      if (!request) return "그릴 내용(request)이 필요합니다. 무엇을 어떤 문구로 만들지 request 에 넣어 다시 부르세요.";
      const started = await creativeStudio({
        kind: "generate", request, title: args.title ?? "", count: args.count ?? 1, aspect: args.aspect ?? "",
        clientRequestId: newRequestId(), conversationThreadId: ctx.threadId ?? "", teammateId: ctx.teammateId ?? "",
      }, bridge);
      if (!started.job) return formatCreativeStudioObservation(started);
      emitCreativeStudioJob(started.job, ctx);
      const job = await followCreativeStudioJob(started.job, { bridge, waitMs: waitBudget(ctx), onUpdate: (next) => emitCreativeStudioJob(next, ctx) });
      emitCreativeStudioJob(job, ctx);
      return formatCreativeStudioObservation({ status: String(job.status), userMessage: job.detail, job });
    },
  },
  {
    id: "studio.image.status",
    korLabel: "이미지 작업 확인",
    korDescription: "만들고 있는 이미지 작업의 진행 상태와 완성된 파일·결과 폴더를 확인합니다. 사용자가 '다 됐어?', '이미지 어떻게 됐어?'라고 물을 때 씁니다. 작업 ID가 없으면 가장 최근 작업을 봅니다.",
    argsHint: '{"jobId":"작업 ID(없으면 최근 작업)"}',
    permission: "auto",
    execute: async (bridge: AgentToolBridge, args: Record<string, unknown>, rawCtx: AgentToolContext) => {
      const ctx = rawCtx as CreativeStudioToolContext;
      const jobId = String(args.jobId ?? args.id ?? "").trim();
      let job: CreativeStudioJob | undefined;
      if (jobId) job = (await creativeStudio({ kind: "job", jobId }, bridge)).job;
      if (!job) {
        const recent = await creativeStudio({ kind: "jobs" }, bridge);
        job = (recent.jobs ?? []).find((item) => !ctx.threadId || !item.conversationThreadId || item.conversationThreadId === ctx.threadId);
      }
      if (!job) return "확인할 이미지 작업이 없습니다. 앱을 다시 열었다면 이전 결과는 결과 폴더(D:\\ModyCrew 결과\\이미지 등)에 있습니다.";
      emitCreativeStudioJob(job, ctx);
      return formatCreativeStudioObservation({ status: String(job.status), userMessage: job.detail, job });
    },
  },
];

/** 데스크톱 연결이 있을 때만 이미지 스튜디오 도구를 더한다(구버전 설치본에 없는 기능을 부르게 하지 않는다). */
export function withCreativeStudioTools<T extends AgentToolEntry>(entries: T[], bridge?: unknown): Array<T | LongRunningAgentToolEntry> {
  if (!creativeStudioBridge(bridge)) return entries;
  const ids = new Set(entries.map((entry) => entry.id));
  return [...entries, ...creativeStudioAgentTools.filter((entry) => !ids.has(entry.id))];
}

/** 결과 폴더(D:\ModyCrew 결과) 아래 분야 폴더. 이미지 스튜디오는 '이미지', 크루 스킬 결과는 나머지(데스크톱 crew-results-mirror). */
export const creativeResultCategoryFolders = ["이미지", "디자인", "개발", "콘텐츠", "문서", "보안 점검", "기능 분석", "크루 작업"] as const;
const resultFolderPattern = new RegExp(
  "[A-Za-z]:\\\\[^\\r\\n<>\"|?*]*?ModyCrew 결과\\\\(?:" + creativeResultCategoryFolders.join("|") + ")\\\\[^\\r\\n<>\"|?*\\\\]+",
  "gu",
);

/**
 * 지난 답변에 적힌 모디크루 결과 폴더 경로를 찾는다(앱을 다시 열어도 대화에서 결과를 다시 보여 주기 위해).
 * 이미지뿐 아니라 크루 스킬 결과(디자인·개발·문서 등)도 같은 결과 카드로 보여 준다.
 */
export function findCreativeStudioFolders(text: string): string[] {
  const found = new Set<string>();
  for (const match of String(text ?? "").matchAll(resultFolderPattern)) {
    // 문장부호 뒤에 공백이 오면 거기서 경로가 끝난 것으로 본다. 경로 뒤에 바로 붙은 조사는 데스크톱이 실제 폴더를 찾으며 뗀다.
    const folder = match[0].split(/[.,;!?)\]'\u0060\u2019\u201d](?=\s|$)/u)[0].replace(/[\s.,)'"\u0060\u2019\u201d]+$/u, "").trim();
    if (folder) found.add(folder);
  }
  return [...found].slice(0, 4);
}

const creativeNoun = /(홍보물|홍보\s*이미지|포스터|전단지?|리플렛|브로슈어|배너|썸네일|로고|아이콘|일러스트|그림|이미지|사진|카드\s*뉴스|sns\s*카드|인스타\s*(?:피드|게시물|카드)|표지|커버|목업|시안|디자인|캐릭터)/iu;
const creativeVerb = /(만들|그려|그리|제작|생성|뽑아|디자인\s*해|꾸며|보여\s*줘)/u;
const textOnlyRequest = /(?:문구|카피|글|텍스트|캡션|해시태그|대본|설명)\s*(?:만|로만)|글로만|말로만|(?:문구|카피|캡션)\s*(?:써|작성|정리)/u;
const textualDrawing = /(?:표|도표|목록|리스트|목차|개요|순서도)[^.!?]{0,14}?(?:그려|그리|만들)/u;

   
                                        
                                                          
                                                                        
   
export function isCreativeProductionRequest(text: string): boolean {
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!normalized || textOnlyRequest.test(normalized) || textualDrawing.test(normalized)) return false;
  if (/그려\s*(?:줘|주세요|봐|줄래)/u.test(normalized)) return true;
  return creativeNoun.test(normalized) && creativeVerb.test(normalized);
}

export type HireableCrewJob = { id: string; name: string; roleTitle: string };
export type CrewHireSuggestion = { jobId: string; reason: string; label: string; href: string; line: string };

const makesSomething = /(만들|작성|써\s*줘|써줘|쓰기|정리|고쳐|수정|채워|기획|제작|개발|구현|짜\s*줘|짜줘)/u;
const crewHireRules: ReadonlyArray<{ jobId: string; reason: string; test: (text: string) => boolean }> = [
  { jobId: "product-designer", reason: "디자인·이미지·홍보물", test: (text) => isCreativeProductionRequest(text) },
  { jobId: "software-engineer", reason: "앱·웹사이트·프로그램 개발", test: (text) => /(앱|어플|웹\s*사이트|홈페이지|프로그램|게임|코드|코딩|스크립트|버그|자동화\s*프로그램)/u.test(text) && makesSomething.test(text) },
  { jobId: "document-writer", reason: "보고서·문서 작성", test: (text) => /(보고서|회의록|기획서|제안서|계획서|신청서|공문|문서|ppt|피피티|발표\s*자료|한글\s*파일|hwp|워드)/iu.test(text) && makesSomething.test(text) },
  { jobId: "content-editor", reason: "SNS·콘텐츠 제작", test: (text) => /(인스타|릴스|블로그|유튜브|쇼츠|sns|카드\s*뉴스|콘텐츠|게시물)/iu.test(text) && makesSomething.test(text) },
];

   
                                                  
                                                                       
                                                         
                                                               
   
export function suggestCrewHireForRequest(text: string, jobs: readonly HireableCrewJob[], isHired: (job: HireableCrewJob) => boolean): CrewHireSuggestion | null {
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!normalized) return null;
  for (const rule of crewHireRules) {
    if (!rule.test(normalized)) continue;
    const job = jobs.find((item) => item.id === rule.jobId);
    if (!job || isHired(job)) return null;
    const who = job.name + "(" + job.roleTitle + ")";
    return {
      jobId: job.id,
      reason: rule.reason,
      label: who + " 고용하러 가기",
      href: "/crew/",
      line: rule.reason + " 일을 전담할 AI 직원이 아직 사무실에 없어요. 'AI 직원 고용'에서 " + who + "을 데려오면 다음부터는 이런 일을 그 직원이 맡습니다.",
    };
  }
  return null;
}

