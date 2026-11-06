   
                                   
  
                                                                                         
                                                                
                                                                      
                                                                      
  
                                              
                                                                           
                                                      
                                                                
                                                                              
   
import { promises as fs } from "node:fs";
import path from "node:path";
import { folderStamp, sanitizeTitle, uniquePath } from "./creative-studio.mjs";

const categoryFolders = Object.freeze({
  design: "디자인", development: "개발", content: "콘텐츠", documents: "문서",
  security: "보안 점검", reverse_engineering: "기능 분석",
});
// 실행 기록에는 분야가 없어 이름으로 찾는다. 새 크루 스킬은 category 를 넘기거나 여기에 더한다.
const skillCategories = Object.freeze({
  "mody-design-crew": "design", "mody-dev-crew": "development", "mody-deep-review": "development",
  "mody-insta-content": "content", "mody-motion-video": "content", "mody-doc-to-skill": "documents",
  "mody-security-audit": "security", "mody-reverse-engineering": "reverse_engineering",
});
const skippedDirectories = new Set(["node_modules", ".git", ".venv", "venv", "__pycache__", ".next", ".cache", ".turbo"]);
export const crewResultLimits = Object.freeze({ maxFiles: 400, maxTotalBytes: 512 * 1024 * 1024 });
export const crewReportFileName = "실행 보고서.md";

/** 결과를 둘 분야 폴더 이름(디자인·개발·문서…). 모르면 '크루 작업'. */
export function crewResultCategoryFolder(run, category = "") {
  const key = String(category || run?.category || skillCategories[String(run?.name ?? "")] || "");
  return categoryFolders[key] || "크루 작업";
}

                                                                     
export function crewResultTitle(run) {
  const firstLine = String(run?.request ?? "").split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? "";
  const trimmed = firstLine
    .replace(/^[^:：]{0,16}요청\s*[:：]\s*/u, "")
    .replace(/(?:을|를)?\s*(?:만들어|그려|제작해|작성해|생성해|개발해)\s*(?:줘|주세요|줄래)?[.!?\s]*$/u, "")
    .slice(0, 28);
  return sanitizeTitle(trimmed, sanitizeTitle(run?.label, "크루 작업"));
}

function toPosix(value) {
  return String(value ?? "").replace(/\\/gu, "/").replace(/^\.\/+/u, "");
}

async function collectFiles(io, outputDir, { skip, limits }) {
  const files = [];
  let totalBytes = 0;
  let truncated = false;
  async function walk(dir) {
    let entries = [];
    try { entries = await io.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    for (const entry of entries) {
      if (truncated) return;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink?.()) continue;
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = toPosix(path.relative(outputDir, full));
      if (skip.has(relative)) continue;
      let size = 0;
      try { size = (await io.stat(full)).size; } catch { continue; }
      if (files.length >= limits.maxFiles || totalBytes + size > limits.maxTotalBytes) { truncated = true; return; }
      totalBytes += size;
      files.push({ source: full, relative, bytes: size });
    }
  }
  await walk(outputDir);
  return { files, totalBytes, truncated };
}

/**
 * 완료된 크루 스킬 실행 결과를 결과 폴더로 복사한다. 복사할 것이 없거나 완료가 아니면 null.
 * resultsRoot 를 모르면 getResultsRoot() 로 고른다(이미지 스튜디오와 같은 위치).
 */
export async function mirrorCrewRunResults({ run, category = "", resultsRoot = "", getResultsRoot, io = fs, now = () => new Date(), limits = crewResultLimits } = {}) {
  if (!run || run.status !== "completed") return null;
  const outputDir = String(run.outputDir ?? "");
  const report = String(run.resultPath ?? "");
  const skip = new Set((run.secretHits ?? []).map((hit) => toPosix(hit?.path)));
  const copyOutputs = Boolean(outputDir) && run.target?.access !== "write";
  const collected = copyOutputs ? await collectFiles(io, outputDir, { skip, limits }) : { files: [], totalBytes: 0, truncated: false };
  let reportExists = false;
  if (report) { try { reportExists = (await io.stat(report)).isFile(); } catch { reportExists = false; } }
  if (!collected.files.length && !reportExists) return null;
  const root = String(resultsRoot || (typeof getResultsRoot === "function" ? await getResultsRoot() : "")).trim();
  if (!root) throw new Error("결과를 저장할 폴더를 정하지 못했습니다.");
  const parent = path.join(root, crewResultCategoryFolder(run, category));
  await io.mkdir(parent, { recursive: true });
  const folder = await uniquePath(path.join(parent, folderStamp(now()) + " " + crewResultTitle(run)), { io });
  await io.mkdir(folder, { recursive: true });
  const copied = [];
  for (const file of collected.files) {
    const target = path.join(folder, ...file.relative.split("/"));
    if (!target.startsWith(folder + path.sep)) continue;
    await io.mkdir(path.dirname(target), { recursive: true });
    await io.copyFile(file.source, target);
    copied.push({ name: file.relative, path: target, bytes: file.bytes });
  }
  let reportPath = "";
  if (reportExists) {
    reportPath = await uniquePath(path.join(folder, crewReportFileName), { io });
    await io.copyFile(report, reportPath);
  }
  return {
    folder,
    files: copied,
    reportPath,
    skippedSecretFiles: copyOutputs ? [...skip].filter(Boolean).length : 0,
    truncated: collected.truncated,
  };
}

/** 실행 응답에 결과 폴더를 붙인다. 대화 관찰 문장 첫 줄 아래에 '결과 폴더: ...'가 보이도록 userMessage 에 더한다. */
export function attachMirroredResults(response, mirrored) {
  if (!response || !mirrored?.folder) return response;
  const lines = ["결과 폴더: " + mirrored.folder];
  if (mirrored.files.length) lines.push("결과 폴더의 파일: " + mirrored.files.slice(0, 20).map((file) => file.name).join(", ") + (mirrored.files.length > 20 ? " 외 " + (mirrored.files.length - 20) + "개" : ""));
  if (mirrored.previews?.length) lines.push("화면 미리보기 이미지: " + mirrored.previews.map((file) => path.basename(file)).join(", ") + " (대화 화면 결과 카드에 바로 보입니다)");
  if (mirrored.reportPath) lines.push("실행 보고서: " + mirrored.reportPath);
  if (mirrored.skippedSecretFiles) lines.push("비밀값처럼 보이는 문자열이 있는 파일 " + mirrored.skippedSecretFiles + "개는 결과 폴더로 옮기지 않았습니다.");
  if (mirrored.truncated) lines.push("파일이 많아 일부만 결과 폴더로 옮겼습니다. 전체는 실행 기록 폴더에 있습니다.");
  lines.push("답변 규칙: 위 결과 폴더 위치를 그대로 적으세요. 대화 화면이 이 폴더의 결과를 바로 보여 줍니다. AppData 경로는 적지 마세요.");
  return {
    ...response,
    userMessage: [String(response.userMessage ?? "").trim(), ...lines].filter(Boolean).join("\n"),
    resultsFolder: mirrored.folder,
    ...(response.run ? { run: { ...response.run, resultsFolder: mirrored.folder } } : {}),
  };
}

/**
 * 앱이 만든 결과 파일 하나(예: 대화에서 만든 워드 문서)를 결과 폴더 '<분야>\<날짜 시각> <주제>\' 로 복사한다.
 * 원본은 그대로 둔다. 같은 이름 폴더가 있으면 번호를 붙여 덮어쓰지 않는다.
 */
export async function copyFileToResults({ file, title = "", category = "documents", resultsRoot = "", getResultsRoot, io = fs, now = () => new Date() } = {}) {
  const source = String(file ?? "");
  if (!source || !(await io.stat(source)).isFile()) throw new Error("복사할 결과 파일을 찾지 못했습니다.");
  const root = String(resultsRoot || (typeof getResultsRoot === "function" ? await getResultsRoot() : "")).trim();
  if (!root) throw new Error("결과를 저장할 폴더를 정하지 못했습니다.");
  const parent = path.join(root, crewResultCategoryFolder({}, category));
  await io.mkdir(parent, { recursive: true });
  const folder = await uniquePath(path.join(parent, folderStamp(now()) + " " + sanitizeTitle(title, path.parse(source).name || "결과")), { io });
  await io.mkdir(folder, { recursive: true });
  const target = path.join(folder, path.basename(source));
  await io.copyFile(source, target);
  return { folder, file: target };
}

   
                                                          
                                                                       
                                                     
   
export async function addHtmlPreviews({ mirrored, render, io = fs, limit = 2 } = {}) {
  if (!mirrored?.folder || typeof render !== "function") return mirrored;
  const pages = mirrored.files.filter((file) => /\.html?$/iu.test(file.name));
  const topLevel = pages.filter((file) => !file.name.includes("/"));
  const targets = (topLevel.length ? topLevel : pages).slice(0, limit);
  for (const page of targets) {
    try {
      const png = await render(page.path);
      if (!png?.length) continue;
      const parsed = path.parse(page.name.split("/").pop() ?? page.name);
      const outFile = await uniquePath(path.join(mirrored.folder, parsed.name + " 미리보기.png"), { io });
      await io.writeFile(outFile, png);
      mirrored.files.push({ name: path.basename(outFile), path: outFile, bytes: png.length });
      mirrored.previews = [...(mirrored.previews ?? []), outFile];
    } catch { /* 미리보기만 건너뛴다 */ }
  }
  return mirrored;
}

   
                                                       
                                                                              
                                                                          
                                                      
   
export function createHtmlPreviewRenderer({ BrowserWindow, session, timeoutMs = 15_000, settleMs = 800, maxWidth = 2400, maxHeight = 4000, log = () => {} } = {}) {
  const partition = "modycrew-result-preview";
  let guarded = false;
  function guard() {
    if (guarded) return;
    const previewSession = session.fromPartition(partition, { cache: false });
    previewSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !/^(?:file|data|blob):/iu.test(String(details?.url ?? "")) });
    });
    previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    guarded = true;
  }
  const within = (promise, ms, label) => {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + " 시간이 초과됐습니다.")), ms); }),
    ]).finally(() => clearTimeout(timer));
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  return async function render(file) {
    guard();
    const win = new BrowserWindow({
      show: false, width: 1080, height: 1350, useContentSize: true,
      webPreferences: { offscreen: true, partition, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
    });
    try {
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.webContents.setFrameRate?.(10);
      await within(win.loadFile(file), timeoutMs, "미리보기 불러오기");
      log("loaded");
      await wait(settleMs);
      let width = 1080;
      let height = 1350;
      const debug = win.webContents.debugger;
      try {
        debug.attach("1.3");
        const metrics = await within(debug.sendCommand("Page.getLayoutMetrics"), 5_000, "미리보기 크기 재기");
        const size = metrics?.cssContentSize ?? metrics?.contentSize;
        if (size?.width && size?.height) {
          width = Math.min(Math.max(Math.ceil(size.width), 320), maxWidth);
          height = Math.min(Math.max(Math.ceil(size.height), 320), maxHeight);
        }
      } catch (error) {
        log("measure failed: " + (error?.message ?? error));
      } finally {
        try { debug.detach(); } catch { /* 붙지 않았거나 이미 닫힘 */ }
      }
      log("size " + width + "x" + height);
      win.setContentSize(width, height);
      await wait(settleMs);
      win.webContents.invalidate?.();
      const image = await within(win.webContents.capturePage({ x: 0, y: 0, width, height }), 10_000, "미리보기 찍기");
      log("captured " + JSON.stringify(image.getSize()));
      return image.toPNG();
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  };
}

