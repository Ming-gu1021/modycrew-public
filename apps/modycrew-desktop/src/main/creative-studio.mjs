   
                                                    
  
                      
                                                               
                                                            
  
        
                                                                        
                                                 
                                                               
                                           
                                                                 
                                                                            
                                                                 
                                                                   
                                                      
                                                                     
   
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  buildCodexArgs, crewSkillChildEnv, readCodexWindowsSandbox, redactSecrets, resolveCodexExecutable, runCliProcess, wrapCommandForPlatform,
} from "./crew-skill-runtime.mjs";

export const creativeStudioCrewLabel = "모디크루 디자인 크루";
export const creativeStudioEngineLabel = "GPT 이미지 생성 · 이 PC ChatGPT 연결";
export const geminiImageEngineLabel = "Gemini 이미지 생성 · 모디크루 Gemini 연결";
export const openaiImageEngineLabel = "OpenAI 이미지 생성 · 모디크루 OpenAI 연결";
   
                                                                                         
                                                                                         
   
export const defaultGeminiImageModels = ["gemini-3.1-flash-image", "gemini-2.5-flash-image"];
   
                                                                                    
                                                                       
   
export const defaultOpenAIImageModels = ["gpt-image-2.5-flare", "gpt-image-2", "gpt-image-2.5-sunburst", "gpt-image-1.5"];

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
// 결과 폴더(D:\ModyCrew 결과) 아래 분야 폴더. 이미지 스튜디오는 '이미지', 크루 스킬 결과는 crew-results-mirror.mjs 가 나머지에 둔다.
export const resultCategoryFolders = Object.freeze(["이미지", "디자인", "개발", "콘텐츠", "문서", "보안 점검", "기능 분석", "크루 작업"]);
const skippedResultDirectories = new Set(["node_modules", ".git", ".venv", "venv", "__pycache__", ".next", ".cache", ".turbo"]);

/** 결과 카드에 보여 줄 파일 종류. 이미지는 미리 보기, 나머지는 '열기'로 연다. */
export function resultFileKind(name) {
  const ext = path.extname(String(name ?? "")).toLowerCase();
  if (imageExtensions.has(ext) || ext === ".svg" || ext === ".gif") return "image";
  if (ext === ".html" || ext === ".htm") return "web";
  if ([".md", ".txt", ".pdf", ".docx", ".doc", ".hwp", ".hwpx", ".pptx", ".xlsx", ".csv", ".rtf"].includes(ext)) return "document";
  if ([".mp4", ".mov", ".webm", ".mp3", ".wav", ".m4a"].includes(ext)) return "media";
  if ([".zip", ".7z"].includes(ext)) return "archive";
  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".json", ".css", ".java", ".kt", ".swift", ".go", ".rs", ".cs", ".sh", ".ps1", ".sql", ".yml", ".yaml"].includes(ext)) return "code";
  return "file";
}
const maxRequestChars = 4_000;
const maxPreviewBytes = 20 * 1024 * 1024;
const maxConcurrentJobs = 2;
const maxKeptJobs = 40;
const defaultJobTimeoutMs = 10 * 60_000;
const defaultLoginWaitMs = 5 * 60_000;
const statusTimeoutMs = 15_000;
const activeStatuses = new Set(["queued", "connecting", "generating", "saving"]);

const clip = (value, max) => String(value ?? "").trim().slice(0, max);
const result = (status, userMessage, extra = {}) => ({ status, userMessage, ...extra });

/** 폴더·파일 이름으로 쓸 수 있게 다듬는다. Windows 금지 문자·끝 마침표·예약 이름을 피한다. */
export function sanitizeTitle(value, fallback = "이미지") {
  let text = String(value ?? "")
    .replace(/[\u0000-\u001f<>:"/\\|?*]/gu, " ")
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 40)
    .replace(/[.\s]+$/u, "")
    .trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/iu.test(text)) text = text + " 이미지";
  return text || fallback;
}

/** 요청에서 결과 폴더 이름으로 쓸 짧은 주제를 뽑는다(모델이 title 을 주면 그것을 우선). */
export function titleFromRequest(request, title = "") {
  if (String(title ?? "").trim()) return sanitizeTitle(title);
  const firstLine = String(request ?? "").split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? "";
  const trimmed = firstLine.replace(/^(?:다음|아래)\s*(?:내용|요청)?으로\s*/u, "").replace(/(?:을|를)?\s*(?:만들어|그려|제작해|생성해)\s*(?:줘|주세요|줄래)?[.!?\s]*$/u, "");
  return sanitizeTitle(trimmed.slice(0, 28));
}

function pad(value) { return String(value).padStart(2, "0"); }

                                                     
export function folderStamp(date = new Date()) {
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + pad(date.getMinutes());
}

/**
 * 결과를 둘 최상위 폴더를 고른다. 사용자가 정한 곳 → D:\ModyCrew 결과 → 사용자 폴더\ModyCrew 결과.
 * 실제로 만들고 써 볼 수 있는 첫 위치를 쓴다(읽기 전용 드라이브·CD 드라이브는 건너뛴다).
 */
export async function chooseResultsRoot({ preferred = "", io = fs, platform = process.platform, home = os.homedir(), driveExists = existsSync } = {}) {
  const candidates = [];
  if (String(preferred ?? "").trim()) candidates.push({ dir: path.resolve(String(preferred).trim()), checkDrive: false });
  // D 드라이브는 있는 PC에서만 쓴다(없는 드라이브에 만들려다 시간을 쓰지 않게 먼저 확인).
  if (platform === "win32") candidates.push({ dir: path.win32.join("D:\\", "ModyCrew 결과"), checkDrive: true });
  candidates.push({ dir: path.join(home, "ModyCrew 결과"), checkDrive: false });
  for (const { dir: candidate, checkDrive } of candidates) {
    try {
      if (checkDrive) {
        const drive = path.win32.parse(candidate).root;
        if (drive && !driveExists(drive)) continue;
      }
      await io.mkdir(candidate, { recursive: true });
      const probe = path.join(candidate, ".modycrew-write-check-" + process.pid + "-" + Date.now());
      await io.writeFile(probe, "");
      await io.rm(probe, { force: true });
      return candidate;
    } catch { /* 다음 후보 */ }
  }
  throw new Error("결과를 저장할 폴더를 만들지 못했습니다.");
}

/**
 * 답변 문장에서 뽑은 경로 후보 → 실제로 있는 결과 폴더. 문장이 경로 뒤에 바로 붙는 경우
 * ("…포스터에 저장했습니다")를 위해 끝의 조사·낱말을 하나씩 떼어 보며 찾는다.
 */
export async function resolveExistingFolder(candidate, { io = fs, maxTries = 8 } = {}) {
  let current = String(candidate ?? "").split(/[\r\n]/u)[0].trim().replace(/[\s.,;:!?)\]'"\u0060\u2019\u201d]+$/u, "");
  const isDir = async (target) => { try { return (await io.stat(target)).isDirectory(); } catch { return false; } };
  for (let index = 0; index < maxTries && current; index += 1) {
    if (await isDir(current)) return current;
    const withoutParticle = current.replace(/(?:에서|으로|에|을|를|로|이|가|은|는|의)$/u, "");
    if (withoutParticle !== current && await isDir(withoutParticle)) return withoutParticle;
    const cut = current.lastIndexOf(" ");
    if (cut <= 0) break;
    current = current.slice(0, cut).trim();
  }
  return "";
}

/** 같은 이름의 폴더·파일이 있으면 ' (2)'처럼 번호를 붙여 덮어쓰지 않는다. */
export async function uniquePath(target, { io = fs } = {}) {
  const parsed = path.parse(target);
  for (let index = 1; index < 200; index += 1) {
    const candidate = index === 1 ? target : path.join(parsed.dir, parsed.name + " (" + index + ")" + parsed.ext);
    try { await io.access(candidate); } catch { return candidate; }
  }
  return path.join(parsed.dir, parsed.name + " " + randomUUID().slice(0, 8) + parsed.ext);
}

export function aspectLabel(aspect) {
  if (aspect === "portrait") return "세로형(예: 1024×1536, 포스터·전단)";
  if (aspect === "landscape") return "가로형(예: 1536×1024, 배너·썸네일)";
  return "정사각형(1024×1024, SNS 카드)";
}

export function normalizeAspect(value, request = "") {
  const text = String(value ?? "").toLowerCase();
  if (["portrait", "세로", "vertical", "tall"].some((key) => text.includes(key))) return "portrait";
  if (["landscape", "가로", "wide", "horizontal", "banner"].some((key) => text.includes(key))) return "landscape";
  if (["square", "정사각"].some((key) => text.includes(key))) return "square";
  if (/포스터|전단|세로|스토리|릴스\s*표지|a4|a3/iu.test(request)) return "portrait";
  if (/배너|썸네일|가로|유튜브|헤더|커버\s*이미지|웹\s*배너/iu.test(request)) return "landscape";
  return "square";
}

/** Codex 에 보낼 지시문. 이미지 도구만 쓰게 하고, 지어낸 사실·명령 실행을 막는다. */
export function buildImagePrompt({ request, count = 1, aspect = "square" }) {
  return [
    "너는 모디크루(ModyCrew) 디자인 크루의 이미지 제작 엔진이다.",
    "내장 image_gen 도구만 사용해서 아래 요청에 맞는 이미지를 정확히 " + count + "장 만든다. 장마다 image_gen 을 한 번씩 부른다.",
    "- 화면 비율: " + aspectLabel(aspect),
    "- 이미지 안의 한국어·영어 문구는 요청에 있는 문구를 철자 그대로 쓴다. 요청에 없는 회사명·연락처·가격·수치·인증 마크·실존 인물 얼굴은 넣지 않는다.",
    "- 여러 장이면 같은 브랜드 톤을 유지하되 구도나 강조점을 다르게 한다.",
    "- 셸 명령·파일 복사·웹 검색은 하지 않는다. 만든 이미지는 모디크루 앱이 가져간다.",
    "- 모두 만든 뒤 각 이미지를 한 줄씩 '1. …' 형식으로 짧게 설명한다. 만들지 못했다면 이유를 한 줄로 적는다.",
    "",
    "[요청]",
    request,
  ].join("\n");
}

/** API 엔진(Gemini·OpenAI)에 바로 보내는 그림 설명. 도구 이야기 없이 그림 조건만 담는다. */
export function buildDirectImagePrompt({ request, aspect = "square" }) {
  return [
    request,
    "",
    "조건: " + aspectLabel(aspect) + ". 이미지 안의 한국어·영어 문구는 위에 적힌 문구를 철자 그대로 쓴다. 적히지 않은 회사명·연락처·가격·수치·인증 마크·실존 인물 얼굴은 넣지 않는다.",
  ].join("\n");
}

class ImageApiError extends Error {
  constructor(message, status, code = "") { super(message); this.httpStatus = status; this.code = code; }
}

function apiFailure(status, body) {
  const message = String(body?.error?.message ?? body?.message ?? "").slice(0, 300);
  const code = String(body?.error?.code ?? body?.error?.status ?? "");
  return new ImageApiError(message || "HTTP " + status, status, code);
}

function ratioFor(aspect) { return aspect === "portrait" ? "2:3" : aspect === "landscape" ? "3:2" : "1:1"; }
function sizeFor(aspect) { return aspect === "portrait" ? "1024x1536" : aspect === "landscape" ? "1536x1024" : "1024x1024"; }

/** Gemini generateContent 로 그린다. 장마다 한 번 부르고, 응답의 inlineData(base64)를 그대로 돌려준다. */
export async function generateWithGeminiApi({ apiKey, prompt, aspect = "square", count = 1, models = defaultGeminiImageModels, fetchFn = globalThis.fetch, signal, onImage }) {
  const images = [];
  let lastError = null;
  for (const model of models) {
    try {
      for (let index = images.length; index < count; index += 1) {
        const response = await fetchFn("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
          method: "POST", signal,
          headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: ratioFor(aspect) } } }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw apiFailure(response.status, body);
        const part = (body?.candidates?.[0]?.content?.parts ?? []).find((item) => item?.inlineData?.data || item?.inline_data?.data);
        const data = part?.inlineData ?? part?.inline_data;
        if (!data?.data) throw new ImageApiError("이미지 없이 응답했습니다", 200, String(body?.candidates?.[0]?.finishReason ?? ""));
        const image = { bytes: Buffer.from(String(data.data), "base64"), mimeType: String(data.mimeType ?? data.mime_type ?? "image/png"), model };
        images.push(image);
        await onImage?.(image);
      }
      return images;
    } catch (error) {
      lastError = error;
      if (!(error?.httpStatus === 404) || images.length) throw error;
    }
  }
  throw lastError ?? new ImageApiError("사용할 수 있는 Gemini 이미지 모델이 없습니다", 404);
}

/** OpenAI Images API 로 그린다. 계정에 없는 모델은 건너뛰고 다음 후보를 쓴다. */
export async function generateWithOpenAIApi({ apiKey, prompt, aspect = "square", count = 1, models = defaultOpenAIImageModels, fetchFn = globalThis.fetch, signal, onImage }) {
  let lastError = null;
  for (const model of models) {
    const response = await fetchFn("https://api.openai.com/v1/images/generations", {
      method: "POST", signal,
      headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, size: sizeFor(aspect), n: count }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      lastError = apiFailure(response.status, body);
      if (response.status === 404 || /model_not_found|does not exist|unknown model/iu.test(lastError.code + " " + lastError.message)) continue;
      throw lastError;
    }
    const images = [];
    for (const item of body?.data ?? []) {
      if (!item?.b64_json) continue;
      const image = { bytes: Buffer.from(String(item.b64_json), "base64"), mimeType: "image/png", model };
      images.push(image);
      await onImage?.(image);
    }
    if (!images.length) throw new ImageApiError("이미지 없이 응답했습니다", 200);
    return images;
  }
  throw lastError ?? new ImageApiError("사용할 수 있는 OpenAI 이미지 모델이 없습니다", 404);
}

/** codex exec --json 출력 한 줄에서 실행 ID(thread_id)를 읽는다. */
export function readCodexThreadId(line) {
  const text = String(line ?? "").trim();
  if (!text.startsWith("{")) return "";
  try {
    const event = JSON.parse(text);
    return event?.type === "thread.started" && typeof event.thread_id === "string" && /^[0-9a-z-]{8,80}$/iu.test(event.thread_id) ? event.thread_id : "";
  } catch { return ""; }
}

/** 실패 출력 → 사용자에게 보일 이유와 다음 행동. 출력 원문은 보여 주지 않는다. */
export function explainFailure({ stderr = "", stdout = "", timedOut = false, cancelled = false } = {}) {
  const text = (String(stderr) + "\n" + String(stdout)).toLowerCase();
  if (cancelled) return { status: "cancelled", message: "이미지 만들기를 멈췄습니다." };
  if (timedOut) return { status: "failed", message: "이미지를 그리는 데 시간이 너무 오래 걸려 멈췄습니다. 잠시 뒤 '다시 만들기'를 눌러 주세요." };
  if (/usage limit|rate limit|quota|429|too many requests|limit reached/u.test(text)) return { status: "failed", message: "연결된 GPT 계정의 사용 한도에 걸려 이미지를 만들지 못했습니다. 한도가 풀린 뒤 '다시 만들기'를 눌러 주세요." };
  if (/not logged in|unauthorized|401|login required|authentication/u.test(text)) return { status: "needs_connection", message: "GPT 연결이 끊겨 이미지를 만들지 못했습니다. 모디크루가 다시 연결을 시작할 수 있게 '다시 만들기'를 눌러 주세요." };
  if (/content policy|safety|moderation|disallowed/u.test(text)) return { status: "failed", message: "요청 내용이 이미지 생성 정책에 걸렸습니다. 표현을 바꿔 다시 요청해 주세요." };
  if (/network|enotfound|econnreset|getaddrinfo|timed out/u.test(text)) return { status: "failed", message: "인터넷 연결 문제로 이미지를 만들지 못했습니다. 연결을 확인한 뒤 '다시 만들기'를 눌러 주세요." };
  return { status: "failed", message: "이미지를 만들지 못했습니다. '다시 만들기'를 누르면 한 번 더 시도합니다." };
}

/** API 엔진 실패 → 사용자 문구. 키 값이나 응답 원문은 보여 주지 않는다. */
export function explainApiFailure(error, engineName) {
  const status = Number(error?.httpStatus ?? 0);
  const text = (String(error?.code ?? "") + " " + String(error?.message ?? "")).toLowerCase();
  if (error?.name === "AbortError") return { status: "cancelled", message: "이미지 만들기를 멈췄습니다." };
  if (status === 401 || status === 403 || /api key|permission|unauth/u.test(text)) return { status: "needs_connection", message: engineName + " 연결 키가 거절됐습니다. 모디크루 'AI 연결'에서 키를 다시 연결하면 바로 만들 수 있습니다." };
  if (status === 429 || /quota|rate|exhausted/u.test(text)) return { status: "failed", message: engineName + " 사용 한도에 걸려 이미지를 만들지 못했습니다. 한도가 풀린 뒤 '다시 만들기'를 눌러 주세요." };
  if (/safety|policy|blocked|prohibited/u.test(text)) return { status: "failed", message: "요청 내용이 " + engineName + " 이미지 정책에 걸렸습니다. 표현을 바꿔 다시 요청해 주세요." };
  return { status: "failed", message: engineName + "로 이미지를 만들지 못했습니다. '다시 만들기'를 누르면 한 번 더 시도합니다." };
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function sha256File(file, io = fs) {
  return createHash("sha256").update(await io.readFile(file)).digest("hex");
}

/**
 * Codex 의 generated_images\<실행 ID> 폴더를 지켜보다가, 크기가 두 번 연속 같은(=다 쓴) 이미지를 한 번씩 넘긴다.
 * 실행 ID 를 모르면 아무것도 넘기지 않는다 — 다른 Codex 창에서 만든 이미지가 섞이지 않게.
 */
export function createGeneratedImageWatcher({ codexHome, getThreadId, onImage, io = fs, pollMs = 1_200, since = Date.now() - 2_000 }) {
  const seen = new Set();
  const sizes = new Map();
  let timer = null;
  let scanning = null;
  let stopped = false;
  async function scan({ final = false } = {}) {
    const threadId = getThreadId();
    if (!threadId) return;
    const dir = path.join(codexHome, "generated_images", threadId);
    let entries = [];
    try { entries = await io.readdir(dir, { withFileTypes: true }); } catch { return; }
    const files = entries.filter((entry) => entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase())).map((entry) => entry.name).sort();
    for (const name of files) {
      const file = path.join(dir, name);
      if (seen.has(file)) continue;
      let stat;
      try { stat = await io.stat(file); } catch { continue; }
      if (stat.mtimeMs < since - 60_000 || !stat.size) continue;
      const previous = sizes.get(file);
      sizes.set(file, stat.size);
      if (!final && previous !== stat.size) continue;
      seen.add(file);
      await onImage(file);
    }
  }
  function run(options) {
    scanning = (scanning ?? Promise.resolve()).then(() => scan(options)).catch(() => undefined);
    return scanning;
  }
  return {
    start() {
      if (timer || stopped) return;
      timer = setInterval(() => { void run(); }, pollMs);
      timer.unref?.();
    },
    async flush() { await run(); await run({ final: true }); },
    stop() { stopped = true; if (timer) clearInterval(timer); timer = null; },
  };
}

function projectJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    detail: job.detail,
    crewLabel: creativeStudioCrewLabel,
    engineLabel: job.engineLabel || "",
    title: job.title,
    request: clip(job.request, 400),
    count: job.count,
    aspect: job.aspect,
    folder: job.folder || "",
    files: job.files.map((file) => ({ ...file })),
    description: job.description || "",
    action: job.action || "",
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || "",
    elapsedMs: (job.finishedAtMs || Date.now()) - job.startedAtMs,
    conversationThreadId: job.conversationThreadId || "",
    teammateId: job.teammateId || "",
  };
}

/**
 * 이미지 스튜디오. handle(payload) 하나로 화면과 주고받는다.
 *   status   — 엔진 연결 상태와 결과 폴더
 *   generate — 작업 시작(바로 돌아옴). 같은 clientRequestId 는 같은 작업을 돌려준다.
 *   job      — 작업 상태·완성된 파일
 *   jobs     — 최근 작업 목록
 *   preview  — 모디크루가 만든 이미지 파일을 data URL 로(결과 폴더 안만)
 *   folder   — 결과 폴더 안 이미지 목록(앱을 다시 열어도 대화의 결과를 보여 주기 위해)
 *   open     — 결과 폴더·파일 열기(결과 폴더 안만)
 *   connect  — GPT 연결(Codex 로그인 창) 시작
 *   cancel   — 작업 멈추기
 */
export function createCreativeStudio(options = {}) {
  const io = options.io ?? fs;
  const runProcess = options.runProcess ?? runCliProcess;
  const spawnFn = options.spawnFn ?? spawn;
  const resolveExecutable = options.resolveExecutable ?? (() => resolveCodexExecutable(options));
  const childEnv = options.childEnv ?? (() => crewSkillChildEnv());
  const codexHome = options.codexHome ?? (process.env.CODEX_HOME || path.join(options.home ?? os.homedir(), ".codex"));
  const stateRoot = options.stateRoot ?? path.join(os.tmpdir(), "modycrew-creative-studio");
  const jobTimeoutMs = options.jobTimeoutMs ?? defaultJobTimeoutMs;
  const loginWaitMs = options.loginWaitMs ?? defaultLoginWaitMs;
  const loginPollMs = options.loginPollMs ?? 3_000;
  const pollMs = options.pollMs ?? 1_200;
  const reasoningEffort = options.reasoningEffort ?? "low";
  const now = options.now ?? (() => new Date());
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const getProviderCredential = typeof options.getProviderCredential === "function" ? options.getProviderCredential : null;
  const jobs = new Map();
  let resultsRoot = "";
  let loginChild = null;

  async function getResultsRoot() {
    if (resultsRoot) return resultsRoot;
    const preferred = typeof options.getPreferredResultsRoot === "function" ? await options.getPreferredResultsRoot().catch(() => "") : options.resultsRoot ?? "";
    resultsRoot = await chooseResultsRoot({ preferred, io, platform: options.platform ?? process.platform, home: options.home ?? os.homedir(), driveExists: options.driveExists ?? existsSync });
    return resultsRoot;
  }

  function update(job, status, detail, extra = {}) {
    job.status = status;
    if (detail) job.detail = detail;
    Object.assign(job, extra);
    if (!activeStatuses.has(status) && !job.finishedAt) {
      job.finishedAtMs = Date.now();
      job.finishedAt = now().toISOString();
    }
    try { options.onJobUpdate?.(projectJob(job)); } catch { /* 화면 알림 실패는 작업에 영향 없음 */ }
  }

  async function codexStatus() {
    const executable = resolveExecutable();
    if (!executable) return { installed: false, loggedIn: false, account: "" };
    const run = await runProcess({ executable, args: ["login", "status"], env: childEnv(), timeoutMs: statusTimeoutMs });
    const output = String(run.stdout ?? "") + "\n" + String(run.stderr ?? "");
    const loggedIn = run.code === 0 && /logged in/iu.test(output) && !/not logged in/iu.test(output);
    return { installed: true, loggedIn, account: loggedIn ? (/chatgpt/iu.test(output) ? "chatgpt" : "api_key") : "" };
  }

  /** 모디크루 금고에 저장된 API 키(Gemini·OpenAI). 값은 이 함수 밖으로 나가지 않는다. */
  async function providerKey(provider) {
    if (!getProviderCredential) return "";
    try {
      const credential = await getProviderCredential(provider);
      return credential?.status === "credential_ready" && typeof credential.value === "string" ? credential.value : "";
    } catch { return ""; }
  }

  /** 연결 창을 연다(이미 열려 있으면 다시 열지 않는다). 브라우저에서 ChatGPT 로그인을 마치면 Codex 가 스스로 닫힌다. */
  function startLogin() {
    if (loginChild && loginChild.exitCode === null && !loginChild.killed) return true;
    const executable = resolveExecutable();
    if (!executable) return false;
    const target = wrapCommandForPlatform(executable, ["login"]);
    try {
      loginChild = spawnFn(target.command, target.args, { env: childEnv(), windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
      loginChild.on?.("error", () => { loginChild = null; });
      loginChild.on?.("exit", () => { loginChild = null; });
      return true;
    } catch {
      loginChild = null;
      return false;
    }
  }

  async function waitForLogin(job) {
    const deadline = Date.now() + loginWaitMs;
    while (Date.now() < deadline) {
      if (job.controller.signal.aborted) return false;
      await new Promise((resolve) => setTimeout(resolve, loginPollMs));
      const status = await codexStatus().catch(() => ({ loggedIn: false }));
      if (status.loggedIn) return true;
    }
    return false;
  }

  /** 쓸 수 있는 엔진을 고른다: PC Codex(ChatGPT) → 모디크루 Gemini 키 → 모디크루 OpenAI 키 → 연결 시작. 끝내 없으면 null. */
  async function ensureEngine(job) {
    let status = await codexStatus().catch(() => ({ installed: false, loggedIn: false }));
    if (status.loggedIn) return { id: "codex-image", label: creativeStudioEngineLabel };
    const geminiKey = await providerKey("gemini");
    if (geminiKey) return { id: "gemini-image", label: geminiImageEngineLabel, apiKey: geminiKey };
    const openaiKey = await providerKey("openai");
    if (openaiKey) return { id: "openai-image", label: openaiImageEngineLabel, apiKey: openaiKey };
    if (!status.installed) {
      update(job, "needs_connection", "이미지를 그릴 AI 연결이 아직 없습니다. 모디크루 'AI 연결'에서 GPT(ChatGPT 계정)나 Gemini를 연결하면 바로 만들 수 있습니다.", { action: "open_ai_settings" });
      return null;
    }
    if (!startLogin()) {
      update(job, "needs_connection", "GPT 연결 창을 열지 못했습니다. 모디크루 'AI 연결'에서 GPT(ChatGPT 계정)를 연결해 주세요.", { action: "open_ai_settings" });
      return null;
    }
    update(job, "connecting", "모디크루가 GPT 연결을 시작했습니다. 열린 브라우저 창에서 ChatGPT로 로그인하면 바로 이어서 만듭니다.", { action: "login_browser" });
    const ok = await waitForLogin(job);
    if (!ok) {
      if (job.controller.signal.aborted) { update(job, "cancelled", "이미지 만들기를 멈췄습니다."); return null; }
      update(job, "needs_connection", "GPT 로그인이 끝나지 않아 아직 만들지 않았습니다. 로그인을 마친 뒤 '다시 만들기'를 누르면 이어서 만듭니다.", { action: "retry" });
      return null;
    }
    status = await codexStatus().catch(() => ({ loggedIn: false }));
    return status.loggedIn ? { id: "codex-image", label: creativeStudioEngineLabel } : null;
  }

  async function createResultFolder(job) {
    const root = await getResultsRoot();
    const base = path.join(root, "이미지", folderStamp(new Date(job.startedAtMs)) + " " + job.title);
    const folder = await uniquePath(base, { io });
    await io.mkdir(folder, { recursive: true });
    return folder;
  }

  async function saveImage(job, source) {
    const ext = path.extname(source).toLowerCase() || ".png";
    const target = await uniquePath(path.join(job.folder, job.title + "-" + (job.files.length + 1) + ext), { io });
    await io.copyFile(source, target);
    const stat = await io.stat(target);
    const file = { name: path.basename(target), path: target, bytes: stat.size, sha256: await sha256File(target, io), createdAt: now().toISOString() };
    job.files.push(file);
    const remaining = job.count - job.files.length;
    update(job, "generating", remaining > 0 ? "이미지 " + job.files.length + "장 완성 · 나머지 " + remaining + "장을 그리는 중" : "이미지 " + job.files.length + "장 완성 · 마무리하는 중");
  }

  async function writeSummary(job) {
    const lines = [
      "# " + job.title,
      "",
      "- 만든 곳: " + creativeStudioCrewLabel,
      "- 만든 시각: " + (job.finishedAt || now().toISOString()),
      "- 처리 엔진: " + (job.engineLabel || "-"),
      "",
      "## 요청",
      "",
      job.request,
      "",
      "## 결과",
      "",
      ...job.files.map((file) => "- " + file.name + " (" + file.bytes.toLocaleString("ko-KR") + " B)"),
      ...(job.description ? ["", "## 설명", "", job.description] : []),
    ];
    try { await io.writeFile(path.join(job.folder, "설명.md"), lines.join("\n") + "\n", "utf8"); } catch { /* 설명 파일은 없어도 결과는 유효 */ }
  }

  /** API 엔진이 돌려준 이미지를 결과 폴더에 저장한다(완성될 때마다 바로). */
  async function saveBytes(job, image) {
    const ext = /jpe?g/iu.test(image.mimeType) ? ".jpg" : /webp/iu.test(image.mimeType) ? ".webp" : ".png";
    const target = await uniquePath(path.join(job.folder, job.title + "-" + (job.files.length + 1) + ext), { io });
    await io.writeFile(target, image.bytes);
    const file = { name: path.basename(target), path: target, bytes: image.bytes.length, sha256: createHash("sha256").update(image.bytes).digest("hex"), createdAt: now().toISOString() };
    job.files.push(file);
    const remaining = job.count - job.files.length;
    update(job, "generating", remaining > 0 ? "이미지 " + job.files.length + "장 완성 · 나머지 " + remaining + "장을 그리는 중" : "이미지 " + job.files.length + "장 완성 · 마무리하는 중");
  }

  async function generateWithApi(job, engine) {
    update(job, "generating", creativeStudioCrewLabel + "가 이미지를 그리고 있습니다.", { engineLabel: engine.label });
    const input = { apiKey: engine.apiKey, prompt: buildDirectImagePrompt(job), aspect: job.aspect, count: job.count, fetchFn, signal: job.controller.signal, onImage: (image) => saveBytes(job, image) };
    try {
      if (engine.id === "gemini-image") await generateWithGeminiApi({ ...input, models: options.geminiImageModels ?? defaultGeminiImageModels });
      else await generateWithOpenAIApi({ ...input, models: options.openaiImageModels ?? defaultOpenAIImageModels });
      return { run: { code: 0 }, description: "" };
    } catch (error) {
      if (job.files.length) return { run: { code: 0 }, description: "" };
      const failure = explainApiFailure(error, engine.id === "gemini-image" ? "Gemini" : "OpenAI");
      return { run: { code: 1, apiFailure: failure, cancelled: failure.status === "cancelled" }, description: "" };
    }
  }

  async function generate(job, engine) {
    const executable = resolveExecutable();
    const workDir = path.join(stateRoot, job.id);
    await io.mkdir(workDir, { recursive: true });
    const lastMessageFile = path.join(workDir, "last-message.md");
    const args = buildCodexArgs({ mode: "text", cwd: workDir, lastMessageFile, windowsSandbox: options.windowsSandbox ?? readCodexWindowsSandbox() });
    if (reasoningEffort) args.splice(args.length - 1, 0, "-c", "model_reasoning_effort=\"" + reasoningEffort + "\"");
    let threadId = "";
    let buffer = "";
    const watcher = createGeneratedImageWatcher({
      codexHome, io, pollMs, since: job.startedAtMs,
      getThreadId: () => threadId,
      onImage: (file) => saveImage(job, file).catch(() => undefined),
    });
    watcher.start();
    update(job, "generating", creativeStudioCrewLabel + "가 이미지를 그리고 있습니다.", { engineLabel: engine.label });
    let run;
    try {
      run = await runProcess({
        executable, args, input: buildImagePrompt(job), env: childEnv(), timeoutMs: jobTimeoutMs, abortSignal: job.controller.signal,
        onSpawn: (child) => {
          child?.stdout?.on?.("data", (chunk) => {
            if (threadId) return;
            buffer += String(chunk);
            const lines = buffer.split(/\r?\n/u);
            buffer = lines.pop() ?? "";
            for (const line of lines) { const id = readCodexThreadId(line); if (id) { threadId = id; break; } }
          });
        },
      });
      if (!threadId) for (const line of String(run.stdout ?? "").split(/\r?\n/u)) { const id = readCodexThreadId(line); if (id) { threadId = id; break; } }
      await watcher.flush();
    } finally {
      watcher.stop();
    }
    let description = "";
    try { description = (await io.readFile(lastMessageFile, "utf8")).trim(); } catch { /* 없으면 비워 둔다 */ }
    return { run, description: redactSecrets(clip(description, 2_000)) };
  }

  async function runJob(job) {
    try {
      const engine = await ensureEngine(job);
      if (!engine) return;
      job.folder = await createResultFolder(job);
      const { run, description } = engine.id === "codex-image" ? await generate(job, engine) : await generateWithApi(job, engine);
      job.description = description;
      if (job.controller.signal.aborted || run.cancelled) {
        update(job, "cancelled", job.files.length ? "멈췄습니다. 그때까지 만든 " + job.files.length + "장은 결과 폴더에 있습니다." : "이미지 만들기를 멈췄습니다.");
        return;
      }
      if (!job.files.length) {
        const failure = run.apiFailure ?? explainFailure(run);
        update(job, failure.status, failure.message, { action: failure.status === "needs_connection" ? "open_ai_settings" : "retry" });
        return;
      }
      update(job, "saving", "결과 폴더에 정리하는 중");
      job.finishedAtMs = Date.now();
      job.finishedAt = now().toISOString();
      await writeSummary(job);
      const shortfall = job.count - job.files.length;
      update(job, "completed", "이미지 " + job.files.length + "장을 만들어 " + job.folder + " 폴더에 저장했습니다." + (shortfall > 0 ? " (요청한 " + job.count + "장 중 " + shortfall + "장은 만들지 못했습니다.)" : ""), { action: "" });
      try { await options.notify?.({ title: "이미지를 만들었어요", body: job.title + " · " + job.files.length + "장" }); } catch { /* 알림 실패 무시 */ }
    } catch (error) {
      update(job, "failed", "이미지를 만들지 못했습니다: " + clip(redactSecrets(error?.message ?? error), 200), { action: "retry" });
    } finally {
      prune();
    }
  }

  function prune() {
    const finished = [...jobs.values()].filter((job) => !activeStatuses.has(job.status)).sort((a, b) => a.startedAtMs - b.startedAtMs);
    while (jobs.size > maxKeptJobs && finished.length) jobs.delete(finished.shift().id);
  }

  function start(payload) {
    const request = redactSecrets(clip(payload.request, maxRequestChars));
    if (!request) return result("failed", "무엇을 만들지 알려 주세요.");
    const clientRequestId = clip(payload.clientRequestId, 120);
    if (clientRequestId) {
      const existing = [...jobs.values()].find((job) => job.clientRequestId === clientRequestId);
      if (existing) return result(existing.status, existing.detail, { job: projectJob(existing) });
    }
    if ([...jobs.values()].filter((job) => activeStatuses.has(job.status)).length >= maxConcurrentJobs) {
      return result("busy", "이미지 작업이 이미 " + maxConcurrentJobs + "개 진행 중입니다. 끝나면 이어서 요청해 주세요.");
    }
    const count = Math.min(4, Math.max(1, Math.round(Number(payload.count) || 1)));
    const aspect = normalizeAspect(payload.aspect, request);
    const startedAt = now();
    const job = {
      id: randomUUID(), clientRequestId, status: "queued", detail: creativeStudioCrewLabel + "가 작업을 준비하고 있습니다.",
      request, title: titleFromRequest(request, payload.title), count, aspect, files: [], folder: "", description: "", action: "",
      engineLabel: "", startedAt: startedAt.toISOString(), startedAtMs: startedAt.getTime(), finishedAt: "", finishedAtMs: 0,
      conversationThreadId: clip(payload.conversationThreadId, 240), teammateId: clip(payload.teammateId, 120),
      controller: new AbortController(),
    };
    jobs.set(job.id, job);
    job.done = runJob(job);
    return result(job.status, job.detail, { job: projectJob(job) });
  }

  async function allowedRoots() {
    const roots = [];
    try { roots.push(await getResultsRoot()); } catch { /* 폴더가 없으면 작업 폴더만 */ }
    for (const job of jobs.values()) if (job.folder) roots.push(job.folder);
    return roots;
  }

  async function isAllowed(target) {
    if (!target || !path.isAbsolute(target)) return false;
    return (await allowedRoots()).some((root) => isInside(root, target));
  }

  async function preview(payload) {
    const file = path.resolve(String(payload.path ?? ""));
    if (!imageExtensions.has(path.extname(file).toLowerCase()) || !(await isAllowed(file))) return result("failed", "모디크루가 만든 이미지만 미리 볼 수 있습니다.");
    let stat;
    try { stat = await io.stat(file); } catch { return result("failed", "이미지 파일을 찾지 못했습니다. 옮겨졌거나 지워졌을 수 있습니다."); }
    if (!stat.isFile() || stat.size > maxPreviewBytes) return result("failed", "미리 보기에는 너무 큰 파일입니다. 결과 폴더에서 열어 주세요.");
    const ext = path.extname(file).toLowerCase();
    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
    const bytes = await io.readFile(file);
    return result("ok", "", { dataUrl: "data:" + mime + ";base64," + Buffer.from(bytes).toString("base64"), bytes: stat.size });
  }

  async function folder(payload) {
    const raw = String(payload.path ?? "");
    const known = [...jobs.values()].find((job) => job.folder && path.resolve(job.folder) === path.resolve(raw || "."));
    const dir = known ? known.folder : await resolveExistingFolder(raw, { io });
    // 결과 폴더 안의 '<분야>\<작업>' 폴더만 연다(최상위 결과 폴더나 다른 곳을 훑지 않는다).
    const isJobFolder = Boolean(dir) && (Boolean(known) || resultCategoryFolders.includes(path.basename(path.dirname(dir))));
    if (!isJobFolder || !(await isAllowed(path.resolve(dir)))) return result("failed", "모디크루 결과 폴더만 볼 수 있습니다.");
    try { await io.readdir(dir); } catch { return result("failed", "결과 폴더를 찾지 못했습니다. 옮겨졌거나 지워졌을 수 있습니다."); }
    // 이미지(미리 보기)와 그 밖의 결과 파일(열기)을 나눠 돌려준다. 하위 폴더는 두 단계까지만 본다.
    const files = [];
    const otherFiles = [];
    async function walk(current, depth) {
      let entries = [];
      try { entries = await io.readdir(current, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => a.name.localeCompare(b.name, "ko"));
      for (const entry of entries) {
        const file = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (depth < 2 && !skippedResultDirectories.has(entry.name)) await walk(file, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        let stat;
        try { stat = await io.stat(file); } catch { continue; }
        const name = path.relative(dir, file).split(path.sep).join("/");
        if (imageExtensions.has(path.extname(entry.name).toLowerCase())) { if (files.length < 12) files.push({ name, path: file, bytes: stat.size }); }
        else if (otherFiles.length < 30) otherFiles.push({ name, path: file, bytes: stat.size, kind: resultFileKind(entry.name) });
      }
    }
    await walk(dir, 0);
    files.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    // 결과물(웹·문서·영상)을 먼저, 코드·기타를 다음에, 실행 보고서는 맨 뒤에 둔다.
    const kindOrder = { web: 0, document: 1, media: 2, image: 3, code: 4, archive: 5, file: 6 };
    const rank = (file) => (/^실행 보고서/u.test(path.basename(file.name)) ? 99 : kindOrder[file.kind] ?? 9);
    otherFiles.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ko"));
    return result("ok", "", { folder: dir, files, otherFiles });
  }

  async function open(payload) {
    const job = payload.jobId ? jobs.get(String(payload.jobId)) : null;
    const target = path.resolve(String(payload.path || job?.folder || ""));
    if (!(await isAllowed(target))) return result("failed", "모디크루 결과 폴더만 열 수 있습니다.");
    if (typeof options.openPath !== "function") return result("failed", "이 환경에서는 폴더를 열 수 없습니다.");
    const error = await options.openPath(target);
    return error ? result("failed", "폴더를 열지 못했습니다: " + clip(error, 160)) : result("opened", "결과를 열었습니다.");
  }

  async function handle(payload = {}) {
    const kind = String(payload.kind ?? "");
    try {
      if (kind === "status") {
        const codex = await codexStatus().catch(() => ({ installed: false, loggedIn: false, account: "" }));
        const gemini = Boolean(await providerKey("gemini"));
        const openai = Boolean(await providerKey("openai"));
        const ready = codex.loggedIn || gemini || openai;
        let root = "";
        try { root = await getResultsRoot(); } catch { /* 표시만 비움 */ }
        return result(ready ? "ready" : codex.installed ? "needs_login" : "needs_setup", ready ? "이미지를 바로 만들 수 있습니다." : "AI 연결이 필요합니다. 요청하면 모디크루가 GPT 연결을 시작합니다.", {
          crewLabel: creativeStudioCrewLabel, resultsRoot: root,
          engines: [
            { id: "codex-image", label: creativeStudioEngineLabel, installed: codex.installed, ready: codex.loggedIn, account: codex.account },
            { id: "gemini-image", label: geminiImageEngineLabel, installed: gemini, ready: gemini },
            { id: "openai-image", label: openaiImageEngineLabel, installed: openai, ready: openai },
          ],
        });
      }
      if (kind === "generate") return start(payload);
      if (kind === "job") {
        const job = jobs.get(String(payload.jobId ?? ""));
        return job ? result(job.status, job.detail, { job: projectJob(job) }) : result("not_found", "이 작업 기록이 없습니다. 앱을 다시 열었다면 결과 폴더에서 확인해 주세요.");
      }
      if (kind === "jobs") return result("ok", "", { jobs: [...jobs.values()].sort((a, b) => b.startedAtMs - a.startedAtMs).slice(0, 20).map(projectJob) });
      if (kind === "preview") return await preview(payload);
      if (kind === "folder") return await folder(payload);
      if (kind === "open") return await open(payload);
      if (kind === "connect") {
        const status = await codexStatus().catch(() => ({ installed: false, loggedIn: false }));
        if (status.loggedIn) return result("ready", "GPT가 이미 연결돼 있습니다.");
        if (!status.installed) return result("needs_setup", "이 PC에 GPT 연결 도구가 없습니다. 'AI 연결'에서 준비해 주세요.", { action: "open_ai_settings" });
        return startLogin() ? result("connecting", "GPT 연결 창을 열었습니다. 브라우저에서 ChatGPT로 로그인해 주세요.", { action: "login_browser" }) : result("failed", "GPT 연결 창을 열지 못했습니다.");
      }
      if (kind === "cancel") {
        const job = jobs.get(String(payload.jobId ?? ""));
        if (!job) return result("not_found", "이 작업 기록이 없습니다.");
        if (activeStatuses.has(job.status)) job.controller.abort();
        return result("cancelling", "멈추는 중입니다.", { job: projectJob(job) });
      }
      return result("failed", "알 수 없는 요청입니다.");
    } catch (error) {
      return result("failed", "이미지 스튜디오 처리 중 문제가 생겼습니다: " + clip(redactSecrets(error?.message ?? error), 200));
    }
  }

  return {
    handle,
    /** 테스트·종료 처리용: 작업이 끝날 때까지 기다린다. */
    async settle(jobId) { await jobs.get(jobId)?.done; },
    stopAll() { for (const job of jobs.values()) if (activeStatuses.has(job.status)) job.controller.abort(); try { loginChild?.kill?.(); } catch { /* 무시 */ } },
  };
}
