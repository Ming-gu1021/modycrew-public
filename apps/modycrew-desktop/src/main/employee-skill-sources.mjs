import {createReviewedTradingAnalysis} from "./reviewed-trading-analysis.mjs";
import {createReviewedQmdSource} from "./reviewed-qmd-source.mjs";
import {createReviewedTradingRating} from "./reviewed-trading-rating.mjs";
import { createReviewedScraplingSource } from "./reviewed-scrapling-source.mjs";
import { createReviewedBeadsSource } from "./reviewed-beads-source.mjs";
import { createStandaloneToolReadiness } from "./standalone-tool-readiness.mjs";
/**
 * 필요한 스킬을 구해 새 직원을 만드는 기능의 데스크톱 쪽(IPC mody.employee-skills.v1).
 *
 * 하는 일
 *   - 우리 웹사이트 크루 스킬 카탈로그 조회(고정 주소 mody.ai.kr, 다른 주소로 넘어가면 받지 않음)와 앱 동봉 카탈로그 대조
 *   - 이 PC 스킬 폴더(Codex·공용·Claude) 목록
 *   - 앱 템플릿(목소리·받아쓰기) 읽기 → 사용자 확인 → 내 스킬 보관함 저장 + 공용 스킬 폴더(~/.agents/skills) 배포
 *   - 기본 지침 초안·AI 초안·깃허브·내 폴더 스킬 미리보기 → 사용자 확인 → 보관(자동 설치 없음)
 *   - 내 스킬 보관함(버전·이력·최신 확인·비교·적용·되돌리기·쓰는 직원·게시 후보)
 *   - 목소리·받아쓰기 스크립트 직접 실행: 앱이 스크립트를 실행하고 AI는 인자만 정하므로 Claude·GPT·Gemini 어느 쪽이 연결돼 있어도 결과가 같다.
 * 지키는 것
 *   - 저장·가져오기·갱신·되돌리기와 AI가 시작한 음성 만들기는 데스크톱 확인 창에서 사람이 고른 뒤에만 한다.
 *   - 화면은 다운로드 주소·파일 경로를 넘기지 못한다. 미리보기 때 받은 토큰과 사용자가 본 해시가 같을 때만 저장한다.
 *   - 직접 실행은 앱 템플릿 출신 스킬의 보관함 활성 버전(해시 확인)만 한다. 받아쓸 파일은 사용자가 파일 선택 창에서 고른다.
 *   - 프로그램·모델 설치, 다운로드, 녹음·대본 외부 전송을 하지 않는다.
 */
import { createReviewedSourceBundles } from "./reviewed-source-bundles.mjs";
import { createReviewedVideoSource } from "./reviewed-video-source.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  createSkillLibrary, checkSkillUpdates, validateSkillFiles, readSkillFolder, folderTreeHash, parseSkillMeta,
  parseGitHubSkillUrl, fetchGitHubSkill, readLimitedText, skillNamePattern, defaultSkillDeployRoot,
} from "./skill-library.mjs";
import { readBundledCatalog, defaultBundledCatalogPath } from "./crew-skill-packages.mjs";

export const employeeSkillsChannel = "mody.employee-skills.v1";
export const websiteCatalogUrl = "https://mody.ai.kr/resources/modycrew/extensions/catalog.json";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const defaultTemplatesRoot = path.join(moduleDir, "skill-templates");

/** 앱이 만들어 줄 수 있는 스킬 템플릿. 직접 실행(run_action)은 여기 적힌 동작만 한다. */
export const employeeSkillTemplates = Object.freeze([
  Object.freeze({ id: "voice-tts", skillName: "mody-voice-tts", label: "목소리 만들기(TTS)", capabilityId: "voice_tts", platforms: Object.freeze(["win32"]), script: "scripts/speak.ps1" }),
  Object.freeze({ id: "voice-stt", skillName: "mody-voice-stt", label: "받아쓰기(STT)", capabilityId: "voice_stt", platforms: Object.freeze(["win32"]), script: "scripts/transcribe.ps1" }),
]);

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const audioExtensions = ["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "wma", "webm", "mp4", "mov", "mkv", "avi", "amr", "3gp"];
const commandWords = /\b(?:Bash|powershell|pwsh|cmd\.exe|npm|npx|pip|pip3|curl|wget|Invoke-WebRequest|Start-Process|rm\s+-rf|del\s+\/)\b|(?:^|\s)scripts\//iu;
const clip = (value, max) => String(value ?? "").trim().slice(0, max);
const result = (status, userMessage, extra = {}) => ({ status, userMessage, ...extra });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function defaultEmployeeSkillRoots(home = os.homedir()) {
  return [["Codex", ".codex/skills"], ["공용", ".agents/skills"], ["Claude", ".claude/skills"]].map(([label, relative]) => ({ label, directory: path.join(home, relative) }));
}

/** 웹사이트 카탈로그 항목을 화면에 넘길 필드만 남긴다. app: 이 앱 동봉 카탈로그와의 대조 결과. */
export function sanitizeWebsiteSkill(entry, bundled) {
  const name = clip(entry?.name, 64);
  if (!skillNamePattern.test(name)) return null;
  const list = (value, count, max) => (Array.isArray(value) ? value : []).slice(0, count).map((item) => clip(item, max)).filter(Boolean);
  const hash = /^[0-9a-f]{64}$/u.test(String(entry?.integrity?.sha256 ?? "")) ? entry.integrity.sha256 : "";
  const bundledHash = String(bundled?.integrity?.sha256 ?? "");
  return {
    name, label: clip(entry.label, 80) || name, description: clip(entry.description, 1024), version: clip(entry.version, 20),
    category: clip(entry.category, 40), categoryLabel: clip(entry.categoryLabel, 40), availability: entry.availability === "optional" ? "optional" : "core",
    execution: clip(entry.execution, 20), executionLabel: clip(entry.executionLabel, 60), profile: clip(entry.profile, 20), ownerLabels: clip(entry.ownerLabels, 200),
    permissionLabels: list(entry.permissionLabels, 8, 80), inputs: list(entry.io?.inputs, 6, 120), outputs: list(entry.io?.outputs, 6, 160),
    verification: { level: clip(entry.verification?.level, 30), checkedAt: clip(entry.verification?.checkedAt, 20), note: clip(entry.verification?.note, 300) },
    sources: (Array.isArray(entry.sources) ? entry.sources : []).slice(0, 6).map((source) => ({ label: clip(source?.label, 120), url: /^https:\/\//u.test(String(source?.url ?? "")) ? clip(source.url, 300) : "", license: clip(source?.license, 160), status: clip(source?.status, 240) })),
    sha256: hash,
    app: { present: Boolean(bundled), version: clip(bundled?.version, 20), availability: bundled?.availability === "optional" ? "optional" : bundled ? "core" : "", sameVersion: Boolean(bundled) && bundled.version === entry.version, sameHash: Boolean(hash) && bundledHash === hash },
  };
}

/** 앱 동봉 카탈로그에만 있는 우리 스킬(웹사이트 게시 전, 또는 웹사이트에 연결하지 못했을 때). 앱이 SHA-256 확인 뒤 쓰는 기존 경로 그대로다. */
export function sanitizeAppBundledSkill(entry) {
  const skill = sanitizeWebsiteSkill(entry, entry);
  return skill ? { ...skill, appOnly: true } : null;
}

function sanitizeReference(entry) {
  const id = clip(entry?.id, 64);
  if (!id) return null;
  return { shared: true, ownerRoleIds: (Array.isArray(entry.ownerRoleIds) ? entry.ownerRoleIds : []).filter((id) => typeof id === "string").slice(0, 10), kind: clip(entry.kind, 30), preparation: entry.id === "yt-dlp" ? "reviewed_existing_tool" : entry.installation ? "reviewed_bundle" : "needs_adapter", reviewedVersion: clip(entry.reviewedVersion, 80), id, label: clip(entry.label, 120), category: clip(entry.category, 40), url: /^https:\/\//u.test(String(entry.url ?? "")) ? clip(entry.url, 300) : "", license: clip(entry.license, 160), state: clip(entry.state, 20), note: clip(entry.note, 400), reflectedIn: (Array.isArray(entry.reflectedIn) ? entry.reflectedIn : []).slice(0, 6).map((item) => clip(item, 60)) };
}

function defaultPowerShellPath() {
  if (process.env.MODYCREW_POWERSHELL_PATH) return process.env.MODYCREW_POWERSHELL_PATH;
  const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** 스크립트에 넘기는 환경변수: 경로·임시 폴더·엔진 위치만(키·토큰 없음). */
export function voiceScriptEnv(source = process.env) {
  const allowed = /^(?:SystemRoot|windir|SystemDrive|TEMP|TMP|USERPROFILE|HOMEDRIVE|HOMEPATH|LOCALAPPDATA|APPDATA|ProgramFiles|ProgramFiles\(x86\)|ProgramW6432|ProgramData|CommonProgramFiles|PATH|Path|PATHEXT|COMPUTERNAME|USERNAME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|PSModulePath|MODY_WHISPER_CLI|MODY_WHISPER_MODEL|MODY_WHISPER_MODEL_DIR|CUDA_VISIBLE_DEVICES)$/u;
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.test(key) && typeof value === "string"));
}

/** PowerShell 파일 실행(셸 없이 인자 배열로). 마지막 JSON 줄을 결과로 읽는다. */
export function runPowerShellScript({ file, args = [], cwd, timeoutMs = 120_000, powershellPath, spawnFn = spawn, env = voiceScriptEnv() }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(powershellPath ?? defaultPowerShellPath(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file, ...args], { cwd, windowsHide: true, env });
    } catch (error) {
      resolve({ code: -1, stdout: "", stderr: String(error?.message ?? error), json: null });
      return;
    }
    const out = []; const err = []; let outBytes = 0; let errBytes = 0; let timedOut = false;
    child.stdout?.on("data", (chunk) => { outBytes += chunk.length; if (outBytes <= 4 * 1024 * 1024) out.push(chunk); });
    child.stderr?.on("data", (chunk) => { errBytes += chunk.length; if (errBytes <= 256 * 1024) err.push(chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && child.pid) {
        try { spawnFn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }); } catch { child.kill(); }
      } else child.kill();
    }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: -1, stdout: "", stderr: String(error?.message ?? error), json: null, timedOut }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString("utf8");
      const line = stdout.split(/\r?\n/u).map((item) => item.trim()).filter((item) => item.startsWith("{")).pop();
      let json = null;
      try { json = line ? JSON.parse(line) : null; } catch { json = null; }
      resolve({ code, stdout, stderr: Buffer.concat(err).toString("utf8"), json, timedOut });
    });
  });
}

function sanitizeFileStem(value, fallback) {
  const clean = String(value ?? "").normalize("NFC").replace(/[<>:"/\\|?*\x00-\x1f]/gu, "_").replace(/\s+/gu, "-").replace(/^[.-]+|[.\s]+$/gu, "").slice(0, 60);
  return clean || fallback;
}

// ── 기본 확인 창·선택 창(Electron) ─────────────────────────────────────────────
async function electronConfirm(info) {
  const { dialog, BrowserWindow } = await import("electron");
  const parent = BrowserWindow.getFocusedWindow() ?? undefined;
  const show = (opts) => (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts));
  const texts = {
    run_tool_check: { title: "원본 도구 진단", message: "표시된 범위로 원본 프로그램을 실행해 버전을 확인할까요?", ok: "버전 확인" },
    run_trading_analysis: { title: "외부 금융 리서치 분석", message: "표시한 공급자·전송 자료·비용 조건으로 분석할까요?", ok: "외부 요청 승인" },
    run_qmd_snapshot: { title: "임시 문서 키워드 검색", message: "표시된 문서 문자열을 임시로 색인하고 검색한 뒤 제거할까요?", ok: "문서 검색" },
    run_beads_snapshot: { title: "임시 업무 목록 분석", message: "표시한 업무를 임시 DB에서 분석한 뒤 제거할까요?", ok: "임시 분석" },
    run_report_rating: { title: "보고서 판정 문구 확인", message: "표시된 보고서의 판정 문구를 읽을까요?", ok: "문구 읽기" },
    run_static_html: { title: "로컬 HTML 분석", message: "표시된 HTML과 CSS 선택자로 이 PC에서 분석할까요?", ok: "로컬 분석" },
    install_tool: { title: "원본 도구 설치", message: "승인한 원본 도구를 앱 전용 폴더에 설치할까요?", ok: "다운로드·설치" },
    run: { title: "원본 도구 실행", message: "표시된 주소로 정보를 요청할까요?", ok: "정보 조회" },
    save: { title: "스킬 저장", message: "'" + info.name + "' 스킬을 내 스킬 보관함에 저장하고 공용 스킬 폴더에 둘까요?", ok: "저장" },
    import: { title: "스킬 가져오기", message: "'" + info.name + "' 스킬을 가져와 내 스킬 보관함에 저장할까요?", ok: "가져오기" },
    apply: { title: "스킬 새 버전 적용", message: "'" + info.name + "' 스킬을 " + (info.toVersion || "새 버전") + "(으)로 바꿀까요?", ok: "적용" },
    rollback: { title: "스킬 되돌리기", message: "'" + info.name + "' 스킬을 이전 버전으로 되돌릴까요?", ok: "되돌리기" },
    run_tts: { title: "목소리 만들기", message: "이 문장을 음성 파일(WAV)로 만들까요?", ok: "만들기" },
  }[info.kind] ?? { title: "확인", message: "계속할까요?", ok: "계속" };
  const res = await show({ type: "question", title: texts.title, message: texts.message, detail: String(info.detail ?? "").slice(0, 3000), buttons: ["취소", texts.ok], defaultId: 0, cancelId: 0, noLink: true });
  return res.response === 1;
}

async function electronPickFile({ title, extensions }) {
  const { dialog, BrowserWindow } = await import("electron");
  const parent = BrowserWindow.getFocusedWindow() ?? undefined;
  const opts = { title, properties: ["openFile"], filters: [{ name: "선택할 파일", extensions }, { name: "모든 파일", extensions: ["*"] }] };
  const picked = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  return picked.canceled ? "" : picked.filePaths?.[0] ?? "";
}

async function electronPickFolder({ title }) {
  const { dialog, BrowserWindow } = await import("electron");
  const parent = BrowserWindow.getFocusedWindow() ?? undefined;
  const opts = { title, properties: ["openDirectory"] };
  const picked = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  return picked.canceled ? "" : picked.filePaths?.[0] ?? "";
}

/**
 * 서비스. main.mjs 가 libraryRoot·runsRoot(앱 데이터 아래)를 넘긴다. 테스트는 fetch·확인 창·선택 창·PowerShell 실행을 바꿔 끼운다.
 */
export function createEmployeeSkillSources(options = {}) {
  const io = options.io ?? fs;
  const libraryRoot = options.libraryRoot;
  const runsRoot = options.runsRoot;
  if (!libraryRoot || !runsRoot) throw new Error("직원 스킬 저장 위치(libraryRoot·runsRoot)가 필요합니다.");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const platform = options.platform ?? process.platform;
  const templatesRoot = options.templatesRoot ?? defaultTemplatesRoot;
  const bundledCatalogPath = options.bundledCatalogPath ?? defaultBundledCatalogPath;
  const deployRoot = path.resolve(options.deployRoot ?? defaultSkillDeployRoot(options.home));
  const skillRoots = options.skillRoots ?? defaultEmployeeSkillRoots(options.home);
  const confirm = options.confirm ?? electronConfirm;
  const standaloneReadiness = createStandaloneToolReadiness({ io, platform, environment: options.environment });
  const qmdSource = createReviewedQmdSource({root: path.join(libraryRoot, "tools", "qmd-keyword"), io, platform, fetch: fetchImpl, confirm});
  const tradingAnalysis = createReviewedTradingAnalysis({root:path.join(libraryRoot,"tools","trading-analysis"),io,fetch:fetchImpl,confirm,runtimeOptions:{platform},pickConfiguration:()=>pickFile({title:"사용자가 준비한 분석 공급자 설정 JSON 선택 (키는 대화에 입력하지 마세요)",extensions:["json"]})});
  const tradingRating = createReviewedTradingRating({root: path.join(libraryRoot, "tools", "trading-rating"), io, fetch: fetchImpl, confirm, runtimeOptions: {platform}});
  const scraplingSource = createReviewedScraplingSource({ root: path.join(libraryRoot, "tools", "scrapling-static"), io, platform, fetch: fetchImpl, confirm });
  const beadsSource = createReviewedBeadsSource({ root: path.join(libraryRoot, "tools", "beads"), io, platform, fetch: fetchImpl, confirm });
  const videoSource = createReviewedVideoSource({ home: options.home, platform, confirm, managedRoot: path.join(libraryRoot, "tools", "yt-dlp"), fetch: fetchImpl });
  const sourceBundles = createReviewedSourceBundles({ manifestsRoot: options.sourceManifestsRoot ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "reviewed-source-manifests"), stateRoot: path.join(libraryRoot, "reviewed-source-locks"), deployRoot, skillRoots, io, fetch: fetchImpl, confirm });
  const pickFile = options.pickFile ?? electronPickFile;
  const pickFolder = options.pickFolder ?? electronPickFolder;
  const openPath = options.openPath ?? (async (target) => (await import("electron")).shell.openPath(target));
  const runScript = options.runScript ?? ((input) => runPowerShellScript({ ...input, powershellPath: options.powershellPath }));
  const now = options.now ?? (() => new Date());
  const previews = new Map();
  let websiteCache = null;
  let localCache = null;
  let bundledCache = null;

  const readBundled = async () => {
    if (!bundledCache) bundledCache = readBundledCatalog(bundledCatalogPath, { io }).catch((error) => { bundledCache = null; throw error; });
    return bundledCache;
  };

  async function readWebsiteCatalog({ force = false } = {}) {
    if (!force && websiteCache && Date.now() - websiteCache.at < 10 * 60_000) return websiteCache.value;
    let response;
    try { response = await fetchImpl(websiteCatalogUrl, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } }); }
    catch { throw Object.assign(new Error("우리 웹사이트(mody.ai.kr)에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요."), { code: "OFFLINE" }); }
    if (!response.ok) throw Object.assign(new Error("웹사이트 스킬 목록을 받지 못했습니다(" + response.status + ")."), { code: "HTTP" });
    if (response.url && response.url !== websiteCatalogUrl) throw Object.assign(new Error("웹사이트 스킬 목록 주소를 확인하지 못했습니다."), { code: "MOVED" });
    const text = await readLimitedText(response, 1024 * 1024);
    let raw;
    try { raw = JSON.parse(text); } catch { throw Object.assign(new Error("웹사이트 스킬 목록 형식을 읽지 못했습니다."), { code: "FORMAT" }); }
    if (raw?.schema !== "modycrew.crew-skill-catalog.v1" || !Array.isArray(raw.skills)) throw Object.assign(new Error("웹사이트 스킬 목록 형식이 이 앱과 다릅니다."), { code: "FORMAT" });
    const bundled = await readBundled().catch(() => null);
    const bundledMap = new Map((bundled?.skills ?? []).map((skill) => [skill.name, skill]));
    const skills = raw.skills.slice(0, 200).map((entry) => sanitizeWebsiteSkill(entry, bundledMap.get(entry?.name))).filter(Boolean);
    const websiteNames = new Set(skills.map((skill) => skill.name));
    const value = {
      url: websiteCatalogUrl, fetchedAt: now().toISOString(), catalogSha256: sha256(text),
      skills,
      appOnly: (bundled?.skills ?? []).filter((entry) => !websiteNames.has(entry?.name)).slice(0, 200).map(sanitizeAppBundledSkill).filter(Boolean),
      references: (Array.isArray(raw.references) ? raw.references : []).slice(0, 200).map(sanitizeReference).filter(Boolean),
    };
    websiteCache = { at: Date.now(), value };
    return value;
  }

  async function readTemplate(id) {
    const template = employeeSkillTemplates.find((item) => item.id === id);
    if (!template) throw Object.assign(new Error("앱에 없는 템플릿입니다."), { code: "NO_TEMPLATE" });
    const { files } = await readSkillFolder(path.join(templatesRoot, template.id), { io });
    const checked = validateSkillFiles(files, { expectedName: template.skillName });
    if (!checked.ok) throw new Error("앱 템플릿 파일을 확인하지 못했습니다: " + checked.problems.join(" "));
    return { ...template, version: checked.meta.version || "1.0.0", sha256: checked.sha256, files: checked.files, description: checked.meta.description, compatibility: checked.meta.compatibility };
  }

  async function allTemplates() {
    const list = [];
    for (const template of employeeSkillTemplates) { try { list.push(await readTemplate(template.id)); } catch { /* 빠진 템플릿은 건너뜀 */ } }
    return list;
  }

  const library = options.library ?? createSkillLibrary({
    root: libraryRoot, deployRoot, io, fetch: fetchImpl, now,
    templates: async () => (await allTemplates()).map((template) => ({ id: template.id, name: template.skillName, version: template.version, sha256: template.sha256, files: template.files })),
    websiteCatalog: (input) => readWebsiteCatalog(input),
    bundledCatalog: () => readBundled(),
  });

  async function listLocalSkills({ force = false } = {}) {
    if (!force && localCache && Date.now() - localCache.at < 60_000) return localCache.value;
    const seen = new Map();
    const warnings = [];
    for (const root of skillRoots) {
      let entries;
      try { entries = await io.readdir(root.directory, { withFileTypes: true }); }
      catch (error) { if (error.code !== "ENOENT") warnings.push(root.label + " 스킬 폴더를 읽지 못했습니다."); continue; }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || entry.isSymbolicLink?.()) continue;
        const dir = path.join(root.directory, entry.name);
        const file = path.join(dir, "SKILL.md");
        let meta = null;
        try {
          const info = await io.stat(file);
          if (info.size > 128 * 1024) { warnings.push(root.label + "/" + entry.name + ": 스킬 지침이 너무 큽니다."); continue; }
          meta = parseSkillMeta(await io.readFile(file, "utf8"));
        } catch { continue; }
        if (!meta?.description) continue;
        const key = entry.name.toLowerCase();
        if (seen.has(key)) { seen.get(key).alsoIn.push(root.label); continue; }
        let hasScripts = false;
        try { hasScripts = (await io.stat(path.join(dir, "scripts"))).isDirectory(); } catch { hasScripts = false; }
        const name = meta.name || entry.name;
        seen.set(key, { name, folder: entry.name, root: root.label, alsoIn: [], description: clip(meta.description, 400), version: meta.version, hasScripts, runnableByName: entry.name === name && skillNamePattern.test(name), dir });
      }
    }
    const value = { skills: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)), warnings, roots: skillRoots.map((root) => ({ label: root.label, directory: root.directory })) };
    localCache = { at: Date.now(), value };
    return value;
  }

  function rememberPreview(data) {
    for (const [token, item] of previews) if (Date.now() - item.at > 30 * 60_000) previews.delete(token);
    const token = randomUUID();
    previews.set(token, { ...data, at: Date.now() });
    return token;
  }

  const filesForReview = (files) => files.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content ?? ""), content: String(file.content ?? "").slice(0, 40_000) }));
  const describeFiles = (files) => files.map((file) => "· " + file.path).slice(0, 20).join("\n");
  const scriptFiles = (files) => files.filter((file) => !/\.(md|txt|json)$/iu.test(file.path)).map((file) => file.path);

  async function previewChecked(checked, extra) {
    const reserved = new Set([...employeeSkillTemplates.map((item) => item.skillName), ...((await readBundled().catch(() => null))?.skills ?? []).map((skill) => skill.name)]);
    const warnings = [];
    if (checked.meta && reserved.has(checked.meta.name) && extra.origin !== "app_template") warnings.push("앱 스킬과 같은 이름입니다. 앱 스킬이 먼저 쓰일 수 있습니다.");
    if (scriptFiles(checked.files).length) warnings.push("스크립트 파일이 있습니다(" + scriptFiles(checked.files).join(", ") + "). 보관만 하고 실행하지 않습니다. 실행할 때마다 확인 창이 다시 뜹니다.");
    if (checked.files.some((file) => commandWords.test(file.content))) warnings.push("지침에 명령 실행·설치 문구가 있습니다. 실행 전에 내용을 확인해 주세요.");
    return { name: checked.meta?.name ?? "", description: checked.meta?.description ?? "", version: checked.meta?.version ?? "", license: checked.meta?.license ?? "", sha256: checked.sha256, problems: checked.problems, warnings, files: filesForReview(checked.files) };
  }

  async function runVoiceTemplate({ templateId, files, sha, args, cwd, timeoutMs }) {
    const template = employeeSkillTemplates.find((item) => item.id === templateId);
    const dir = path.join(runsRoot, ".runner", templateId + "-" + sha.slice(0, 12));
    const marker = path.join(dir, ".mody-runner.json");
    let ready = false;
    try {
      const info = JSON.parse(await io.readFile(marker, "utf8"));
      ready = info.sha256 === sha && (await folderTreeHash(dir, { io }))?.sha256 === sha;
    } catch { ready = false; }
    if (!ready) {
      await io.rm(dir, { recursive: true, force: true });
      await io.mkdir(dir, { recursive: true });
      for (const file of files) {
        const target = path.join(dir, ...file.path.split("/"));
        await io.mkdir(path.dirname(target), { recursive: true });
        await io.writeFile(target, file.content, "utf8");
      }
      if ((await folderTreeHash(dir, { io }))?.sha256 !== sha) throw new Error("실행용 스크립트 확인에 실패했습니다.");
      await io.writeFile(marker, JSON.stringify({ templateId, sha256: sha, at: now().toISOString() }), "utf8");
    }
    await io.mkdir(cwd, { recursive: true });
    return runScript({ file: path.join(dir, ...template.script.split("/")), args, cwd, timeoutMs });
  }

  async function voiceEngines() {
    if (platform !== "win32") return result("unsupported_platform", "목소리·받아쓰기 엔진 확인은 Windows 에서만 됩니다.");
    const checkDir = path.join(runsRoot, "checks");
    const out = {};
    for (const id of ["voice-tts", "voice-stt"]) {
      try {
        const template = await readTemplate(id);
        const run = await runVoiceTemplate({ templateId: id, files: template.files, sha: template.sha256, args: [id === "voice-tts" ? "-ListVoices" : "-ListEngines"], cwd: checkDir, timeoutMs: 60_000 });
        out[id] = run.json ?? { ok: false, error: run.timedOut ? "timeout" : "no_result", detail: clip(run.stderr || run.stdout, 300) };
      } catch (error) { out[id] = { ok: false, error: "failed", detail: String(error?.message ?? error) }; }
    }
    const voices = out["voice-tts"]?.voices ?? [];
    const korean = voices.filter((voice) => voice.culture === "ko-KR" && voice.enabled);
    const stt = out["voice-stt"] ?? {};
    return result("voice_engines", (korean.length ? "한국어 음성 " + korean.length + "개" : "한국어 음성 없음") + " · " + (stt.ready ? "받아쓰기 엔진 준비됨" : "받아쓰기 엔진 준비 필요"), {
      tts: { ok: Boolean(out["voice-tts"]?.ok), voices, koreanVoices: korean.map((voice) => voice.name), error: out["voice-tts"]?.error ?? "" },
      stt: { ok: Boolean(stt.ok), ready: Boolean(stt.ready), missing: stt.missing ?? [], engines: stt.engines ?? [], error: stt.error ?? "" },
    });
  }

  async function voiceSample({ text = "", voice = "" } = {}) {
    if (platform !== "win32") return result("unsupported_platform", "Windows 기본 음성은 Windows 에서만 쓸 수 있습니다.");
    const template = await readTemplate("voice-tts");
    const samplesDir = path.join(runsRoot, "samples");
    await io.mkdir(samplesDir, { recursive: true });
    const stamp = now().toISOString().replace(/[-:]/gu, "").replace(/\..*$/u, "").replace("T", "-");
    const textFile = path.join(samplesDir, ".sample-" + randomUUID() + ".txt");
    await io.writeFile(textFile, clip(text, 200) || "안녕하세요. 모디크루 목소리 담당입니다. 이 음성은 이 PC 안에서 만들었습니다.", "utf8");
    try {
      const args = ["-TextFile", textFile, "-OutFile", path.join(samplesDir, "voice-sample-" + stamp + ".wav"), "-OutputRoot", samplesDir, "-Force"];
      if (clip(voice, 80)) args.push("-Voice", clip(voice, 80));
      const run = await runVoiceTemplate({ templateId: "voice-tts", files: template.files, sha: template.sha256, args, cwd: samplesDir, timeoutMs: 120_000 });
      if (!run.json?.ok) return result("failed", "시험 음성을 만들지 못했습니다: " + (run.json?.error ?? (run.timedOut ? "시간 초과" : "결과 없음")) + (run.json?.detail ? " · " + run.json.detail : ""), { error: run.json?.error ?? "" });
      const samples = (await io.readdir(samplesDir)).filter((name) => /^voice-sample-.*\.wav$/u.test(name)).sort();
      for (const old of samples.slice(0, Math.max(0, samples.length - 10))) await io.rm(path.join(samplesDir, old), { force: true }).catch(() => undefined);
      return result("sample_ready", "시험 음성을 만들었습니다: " + run.json.durationSeconds + "초 · " + Math.round(run.json.bytes / 1024) + "KB · " + run.json.voice, { sample: run.json, folder: samplesDir });
    } finally {
      await io.rm(textFile, { force: true }).catch(() => undefined);
    }
  }

  /** 앱이 직접 실행하는 목소리·받아쓰기. 보관함에 앱 템플릿 출신으로 저장된 스킬의 활성 버전만 쓴다. */
  async function runAction(payload) {
    if (platform !== "win32") return result("unsupported_platform", "목소리·받아쓰기 실행은 Windows 에서만 됩니다.");
    const template = employeeSkillTemplates.find((item) => item.skillName === clip(payload.skill, 64));
    if (!template) return result("unsupported", "앱이 직접 실행하는 스킬이 아닙니다. 크루 스킬 실행(crew.skill.run)을 써 주세요.");
    const active = await library.readActiveFiles(template.skillName);
    if (!active || active.record.origin?.kind !== "app_template" || active.record.origin?.templateId !== template.id) {
      return result("not_saved", "'" + template.label + "' 스킬이 아직 내 스킬 보관함에 없습니다. AI 직원 화면의 '필요한 스킬로 새 직원 만들기'에서 먼저 저장해 주세요.");
    }
    const args = payload.args && typeof payload.args === "object" ? payload.args : {};
    const runId = randomUUID();
    const day = now().toISOString().slice(0, 10);
    const runDir = path.join(runsRoot, day, runId);
    const outputDir = path.join(runDir, "output");
    const scriptArgs = [];
    let detail = "";
    if (template.id === "voice-tts") {
      const text = String(args.text ?? "").replace(/\u0000/gu, "").trim();
      if (!text) return result("invalid", "음성으로 만들 문장(text)이 필요합니다.");
      if (text.length > 5000) return result("invalid", "문장이 5,000자를 넘습니다. 나눠서 요청해 주세요.");
      const voice = clip(args.voice, 80);
      const rate = Math.max(-10, Math.min(10, Math.round(Number(args.rate) || 0)));
      const volume = Math.max(0, Math.min(100, Math.round(Number.isFinite(Number(args.volume)) ? Number(args.volume) : 100)));
      const stem = sanitizeFileStem(args.fileName, "voice");
      detail = ["문장(앞부분): " + text.slice(0, 300) + (text.length > 300 ? "…" : ""), "음성: " + (voice || "한국어 기본 음성") + " · 빠르기 " + rate + " · 크기 " + volume, "저장: " + path.join(outputDir, stem + ".wav"), "이 PC 안에서만 만들고 외부로 보내지 않습니다."].join("\n");
      // initiatedBy 는 화면이 보내는 값이라 믿지 않는다. 누가 시작했든 음성 파일을 만들기 전에는 메인 프로세스 확인 창을 거친다.
      if (!(await confirm({ kind: "run_tts", name: template.skillName, detail }))) return result("declined", "음성 만들기를 취소했습니다.");
      await io.mkdir(outputDir, { recursive: true });
      await io.writeFile(path.join(runDir, "input.txt"), text, "utf8");
      scriptArgs.push("-TextFile", path.join(runDir, "input.txt"), "-OutFile", path.join(outputDir, stem + ".wav"), "-OutputRoot", outputDir, "-Rate", String(rate), "-Volume", String(volume));
      if (voice) scriptArgs.push("-Voice", voice);
    } else {
      const language = String(args.language ?? "ko").trim().toLowerCase();
      if (!/^(auto|[a-z]{2,3})$/u.test(language)) return result("invalid", "언어 코드는 ko·en·ja·auto 처럼 주세요.");
      const input = await pickFile({ title: "받아쓸 음성·영상 파일 고르기", extensions: audioExtensions });
      if (!input) return result("declined", "받아쓸 파일을 고르지 않아 멈췄습니다.");
      const prompt = clip(String(args.prompt ?? "").replace(/[\r\n\t]+/gu, " "), 400);
      detail = "파일: " + input + "\n언어: " + language + (prompt ? "\n힌트: " + prompt : "");
      await io.mkdir(outputDir, { recursive: true });
      scriptArgs.push("-InputFile", input, "-OutputRoot", outputDir, "-Language", language, "-OutName", sanitizeFileStem(path.parse(input).name, "transcript"));
      if (prompt) scriptArgs.push("-Prompt", prompt);
    }
    const record = { id: runId, skill: template.skillName, version: active.version, sha256: active.sha256, initiatedBy: payload.initiatedBy === "user" ? "user" : "agent", teammateId: clip(payload.teammateId, 120) || undefined, threadId: clip(payload.threadId, 240) || undefined, startedAt: now().toISOString(), status: "running", detail };
    await io.writeFile(path.join(runDir, "run.json"), JSON.stringify(record, null, 2), "utf8");
    const run = await runVoiceTemplate({ templateId: template.id, files: active.files, sha: active.sha256, args: scriptArgs, cwd: runDir, timeoutMs: template.id === "voice-tts" ? 180_000 : 60 * 60_000 });
    const ok = Boolean(run.json?.ok);
    const finished = { ...record, status: ok ? "completed" : "failed", finishedAt: now().toISOString(), result: run.json ?? { ok: false, error: run.timedOut ? "timeout" : "no_result", detail: clip(run.stderr || run.stdout, 500) } };
    await io.writeFile(path.join(runDir, "run.json"), JSON.stringify(finished, null, 2), "utf8");
    const files = (await io.readdir(outputDir).catch(() => [])).map((name) => path.join(outputDir, name));
    if (!ok) return result("failed", (template.id === "voice-tts" ? "음성을 만들지 못했습니다: " : "받아쓰지 못했습니다: ") + (finished.result.error ?? "") + (finished.result.detail ? " · " + clip(finished.result.detail, 300) : ""), { runId, outputDir, files, result: finished.result });
    const message = template.id === "voice-tts"
      ? "음성 파일을 만들었습니다: " + path.basename(run.json.file) + " (" + run.json.durationSeconds + "초, " + Math.round(run.json.bytes / 1024) + "KB, " + run.json.voice + ")"
      : "받아쓰기를 마쳤습니다: 구간 " + run.json.segments + "개 · " + run.json.chars + "자 · " + run.json.elapsedSeconds + "초 걸림(" + run.json.engine + " " + run.json.model + ")";
    return result("completed", message, { runId, outputDir, files, result: run.json });
  }


  // 원본 참조는 앱 정본에서만 설치 정보를 읽는다. 웹·모델 입력의 URL/명령/해시는 실행하지 않는다.
  async function prepareReference(payload) {
    const bundled = await readBundled();
    const reference = bundled.references?.find((item) => item.id === clip(payload.id, 64));
    if (!reference) return result("not_found", "앱에서 검토한 원본 참조가 아닙니다.");
    if (reference.id === "qmd") return await qmdSource.prepare();
    if (reference.id === "tradingagents") return await tradingAnalysis.prepare();
    if (reference.id === "scrapling") return await scraplingSource.prepare();
    if (reference.id === "beads") return await beadsSource.prepare();
    if (reference.id === "yt-dlp") return await videoSource.prepare();
    const standalone = await standaloneReadiness(reference, bundled);
    if (standalone) return standalone;
    const spec = reference.installation;
    if (spec?.type === "reviewed_source_bundle") { const prepared = await sourceBundles.prepare(reference); localCache = null; return prepared; }
    if (!spec) {
      const existing = (reference.reflectedIn ?? []).filter((name) => bundled.skills?.some((skill) => skill.name === name));
      return result(existing.length ? "use_existing" : "needs_adapter", reference.note + (existing.length ? " 기존 크루 스킬: " + existing.join(", ") + ". crew.skill.read로 상태와 지침을 확인하세요. 원본 도구가 설치·실행됐다는 의미는 아닙니다." : ""), { reference: sanitizeReference(reference), existingSkills: existing });
    }
    if (spec.type !== "github_skill_bundle" || !/^[a-f0-9]{40}$/u.test(spec.commit) || !/^[a-f0-9]{64}$/u.test(spec.licenseSha256) || !Array.isArray(spec.packages) || !spec.packages.length || spec.packages.length > 8) return result("invalid", "원본 설치 규격을 확인하지 못했습니다.");
    const local = await listLocalSkills({ force: true });
    const packages = [];
    let licenseText;
    for (const entry of spec.packages) {
      if (!skillNamePattern.test(entry.name) || !/^[a-f0-9]{64}$/u.test(entry.sha256)) return result("invalid", "패키지 식별자·해시가 잘못됐습니다.");
      const installed = local.skills.find((item) => item.folder === entry.name);
      if (installed) {
        const checked = validateSkillFiles((await readSkillFolder(installed.dir, { io })).files, { expectedName: entry.name });
        if (!checked.ok || checked.sha256 !== entry.sha256) return result("review_required", entry.name + "의 기존 설치본이 검토한 원본과 다릅니다. 덮어쓰지 않았습니다. 보관함에서 변경을 비교해 주세요.");
        packages.push({ ...entry, files: checked.files, reused: true });
        continue;
      }
      for (const root of skillRoots) {
        try {
          await io.lstat(path.join(root.directory, entry.name));
          return result("review_required", entry.name + " 폴더가 있지만 유효한 원본 설치본으로 확인되지 않습니다. 덮어쓰지 않았습니다.");
        } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      if (licenseText === undefined) {
        if (!/^[A-Za-z0-9._-]+$/u.test(spec.owner) || !/^[A-Za-z0-9._-]+$/u.test(spec.repo) || !/^[A-Za-z0-9._-]+$/u.test(spec.licensePath)) return result("invalid", "원본 저장소·라이선스 경로가 잘못됐습니다.");
        const url = "https://raw.githubusercontent.com/" + spec.owner + "/" + spec.repo + "/" + spec.commit + "/" + spec.licensePath;
        const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
        if (!response.ok || (response.url && response.url !== url)) return result("failed", "원본 저작권 고지를 받지 못했습니다. 설치하지 않았습니다.");
        licenseText = (await readLimitedText(response, 64 * 1024)).replace(/\r\n/gu, "\n");
        if (sha256(licenseText) !== spec.licenseSha256) return result("integrity_error", "원본 라이선스 해시가 다릅니다. 설치하지 않았습니다.");
      }
      const fetched = await fetchGitHubSkill({ owner: spec.owner, repo: spec.repo, path: entry.path, ref: spec.commit }, { fetch: fetchImpl });
      if (fetched.commit !== spec.commit || fetched.skipped.length) return result("integrity_error", "고정 버전이나 전체 파일을 확인하지 못했습니다. 설치하지 않았습니다.");
      const checked = validateSkillFiles([...fetched.files, { path: "LICENSE.txt", content: licenseText }], { expectedName: entry.name });
      if (!checked.ok || checked.sha256 !== entry.sha256) return result("integrity_error", entry.name + " 원본 무결성 확인에 실패했습니다. 설치하지 않았습니다.");
      packages.push({ ...entry, files: checked.files, reused: false });
    }
    const missing = packages.filter((item) => !item.reused);
    if (missing.length && !(await confirm({ kind: "import", name: reference.label, detail: ["원본: " + reference.url, "고정 커밋: " + spec.commit, "라이선스: " + reference.license, "필수 의존 스킬 포함: " + missing.map((item) => item.name).join(", "), "저장 위치: " + deployRoot, "원문과 저작권 고지를 보존합니다. 설치 스크립트·명령을 실행하지 않습니다. 지침 안의 도구 사용은 별도 실행 권한을 따릅니다."].join("\n") }))) return result("declined", "원본 스킬 준비를 취소했습니다. 설치하지 않았습니다.");
    const installedNow = [];
    for (const item of missing) {
      const saved = await library.add({ files: item.files, origin: { kind: "github", owner: spec.owner, repo: spec.repo, path: item.path, ref: spec.commit, track: "reviewed-reference:" + reference.id, url: reference.url, license: reference.license }, license: reference.license, versionHint: spec.commit.slice(0, 12), usedBy: payload.teammateId ? { teammateId: clip(payload.teammateId, 120) } : null, note: "원본 참조 " + reference.id + " · 고정 버전·LICENSE.txt 포함" });
      if (!saved.deployed) return result("install_incomplete", saved.userMessage, { installedNow, nextAction: "기존 설치본을 보존했습니다. 보관함에서 상태를 확인하고 재배포 또는 복구해 주세요. 실행하지 않았습니다." });
      installedNow.push(item.name);
    }
    localCache = null;
    // 설치 이후에도 실행 경로의 실제 사본을 다시 검증한다. 승인 중 바뀐 로컬 파일도 차단한다.
    const ready = await listLocalSkills({ force: true });
    const instructions = [];
    for (const item of packages) {
      const found = ready.skills.find((entry) => entry.folder === item.name);
      if (!found) return result("install_incomplete", item.name + " 설치 경로를 확인하지 못했습니다.", { installedNow });
      const checked = validateSkillFiles((await readSkillFolder(found.dir, { io })).files, { expectedName: item.name });
      if (!checked.ok || checked.sha256 !== item.sha256) return result("integrity_error", item.name + " 설치 후 무결성 확인에 실패했습니다.", { installedNow });
      instructions.push({ name: item.name, file: path.join(found.dir, "SKILL.md"), sha256: checked.sha256, body: checked.meta.body });
    }
    return result("reference_ready", "필수 원본 스킬을 준비했습니다. 작업·외부 명령을 실행한 것은 아닙니다.", { referenceId: reference.id, commit: spec.commit, entrypoint: spec.entrypoint, installedNow, reused: packages.filter((item) => item.reused).map((item) => item.name), instructions });
  }

  async function handle(payload = {}) {
    try {
      const kind = String(payload.kind ?? "");
      if (kind === "trading_analysis") return await tradingAnalysis.analyze({ticker:payload.ticker,date:payload.date});
      if (kind === "trading_rating_read") return await tradingRating.read(payload.text);
      if (kind === "scrapling_extract") return await scraplingSource.extract({ html: payload.html, selector: payload.selector });
      if (kind === "qmd_documents_search") return await qmdSource.search({query:payload.query,documents:payload.documents});
      if (kind === "beads_tasks_analyze") return await beadsSource.analyzeTasks(payload.tasks);
      if (kind === "beads_check") return await beadsSource.check();
      if (kind === "video_inspect") return await videoSource.inspect(payload.url);
      if (kind === "reference_prepare") return await prepareReference(payload);
      if (kind === "reference_search") {
        const bundled = await readBundled();
        const query = clip(payload.query, 120).toLowerCase();
        let site = null;
        try { site = await readWebsiteCatalog({}); } catch { /* 검토된 앱 참조로 대체 */ }
        const byId = new Map((site?.references ?? []).map((entry) => [entry.id, entry]));
        for (const entry of bundled.references ?? []) byId.set(entry.id, sanitizeReference(entry));
        const references = [...byId.values()].filter((entry) => !query || JSON.stringify(entry).toLowerCase().includes(query));
        return result("references", "원본 참조 목록입니다. 연결·설치·실행 상태를 구분해 주세요.", { websiteAvailable: Boolean(site), references });
      }
      if (kind === "status") {
        return result("status", "직원 스킬 기능 상태입니다.", { platform, deployRoot, libraryRoot, runsRoot, website: websiteCatalogUrl, templates: (await allTemplates()).map(({ id, skillName, label, version, sha256: hash, capabilityId, platforms }) => ({ id, skillName, label, version, sha256: hash, capabilityId, platforms })) });
      }
      if (kind === "website_catalog") {
        try { return result("website_catalog", "우리 웹사이트 스킬 목록입니다.", await readWebsiteCatalog({ force: payload.force === true })); }
        catch (error) {
          // 웹사이트에 연결하지 못해도 앱에 들어 있는 우리 스킬은 쓸 수 있게 함께 돌려준다.
          const bundled = await readBundled().catch(() => null);
          return result("website_unavailable", String(error?.message ?? error), { url: websiteCatalogUrl, appOnly: (bundled?.skills ?? []).slice(0, 200).map(sanitizeAppBundledSkill).filter(Boolean) });
        }
      }
      if (kind === "local_skills") return result("local_skills", "이 PC 스킬 목록입니다.", await listLocalSkills({ force: payload.force === true }));
      if (kind === "templates") return result("templates", "앱 템플릿 목록입니다.", { templates: (await allTemplates()).map(({ files, ...rest }) => ({ ...rest, files: files.map((file) => file.path) })) });
      if (kind === "template") {
        const template = await readTemplate(clip(payload.id, 40));
        const preview = await previewChecked(validateSkillFiles(template.files, { expectedName: template.skillName }), { origin: "app_template" });
        const saved = await library.get(template.skillName);
        return result("template", template.label + " 템플릿입니다.", { template: { id: template.id, skillName: template.skillName, label: template.label, version: template.version, capabilityId: template.capabilityId, platforms: template.platforms, ...preview }, saved: saved.status === "skill" ? saved.skill : null, deployRoot });
      }
      if (kind === "save_template") {
        const template = await readTemplate(clip(payload.templateId, 40));
        if (!payload.reviewedSha256 || payload.reviewedSha256 !== template.sha256) return result("review_required", "화면에서 확인한 내용과 앱 템플릿이 다릅니다. 내용을 다시 확인해 주세요.");
        const approved = await confirm({ kind: "save", name: template.skillName, detail: ["출처: 모디크루 앱 템플릿 " + template.version, "저장 위치: " + path.join(deployRoot, template.skillName) + " (Codex·Claude·Gemini CLI 공용 스킬 폴더)", "파일:", describeFiles(template.files), scriptFiles(template.files).length ? "스크립트가 들어 있습니다. 저장만 하고 실행하지 않습니다. 실행할 때마다 확인합니다." : ""].filter(Boolean).join("\n") });
        if (!approved) return result("declined", "저장을 취소했습니다. 아무것도 바꾸지 않았습니다.");
        return library.add({ files: template.files, origin: { kind: "app_template", templateId: template.id, version: template.version }, label: template.label, note: "앱 템플릿 " + template.version });
      }
      if (kind === "validate_draft") {
        const name = clip(payload.name, 64);
        const content = String(payload.content ?? "");
        if (Buffer.byteLength(content) > 64 * 1024) return result("draft_invalid", "초안이 너무 깁니다(64KB 초과).", { problems: ["초안이 너무 깁니다."] });
        const checked = validateSkillFiles([{ path: "SKILL.md", content: content.replace(/\r\n/gu, "\n") }], { expectedName: name });
        const preview = await previewChecked(checked, { origin: "draft" });
        if (employeeSkillTemplates.some((item) => item.skillName === name) || ((await readBundled().catch(() => null))?.skills ?? []).some((skill) => skill.name === name)) preview.problems = [...preview.problems, "앱 스킬과 같은 이름은 쓸 수 없습니다."];
        return result(preview.problems.length ? "draft_invalid" : "draft_ok", preview.problems.length ? "초안을 고쳐 주세요: " + preview.problems.join(" ") : "저장할 수 있는 초안입니다.", { draft: preview });
      }
      if (kind === "save_draft") {
        const name = clip(payload.name, 64);
        const content = String(payload.content ?? "").replace(/\r\n/gu, "\n");
        const checked = validateSkillFiles([{ path: "SKILL.md", content }], { expectedName: name });
        if (!checked.ok) return result("invalid", "초안을 저장하지 못했습니다: " + checked.problems.join(" "), { problems: checked.problems });
        if (employeeSkillTemplates.some((item) => item.skillName === name) || ((await readBundled().catch(() => null))?.skills ?? []).some((skill) => skill.name === name)) return result("invalid", "앱 스킬과 같은 이름은 쓸 수 없습니다.");
        if (!payload.reviewedSha256 || payload.reviewedSha256 !== checked.sha256) return result("review_required", "화면에서 확인한 초안과 내용이 다릅니다. 다시 확인해 주세요.");
        const originKind = payload.origin === "ai_draft" ? "ai_draft" : "app_draft";
        const approved = await confirm({ kind: "save", name, detail: ["출처: " + (originKind === "ai_draft" ? "AI 초안(사용자 확인)" : "모디크루 기본 지침 초안(사용자 확인)"), "저장 위치: " + path.join(deployRoot, name), "파일: SKILL.md (지침만, 스크립트 없음)"].join("\n") });
        if (!approved) return result("declined", "저장을 취소했습니다. 아무것도 바꾸지 않았습니다.");
        return library.add({ files: checked.files, origin: { kind: originKind, capabilityId: clip(payload.capabilityId, 40) }, label: clip(payload.label, 80) || name, note: originKind === "ai_draft" ? "AI 초안" : "기본 지침 초안" });
      }
      if (kind === "preview_github") {
        const parsed = parseGitHubSkillUrl(payload.url);
        if (!parsed) return result("invalid", "깃허브 스킬 폴더 주소를 확인해 주세요(예: https://github.com/소유자/저장소/tree/main/skills/이름).");
        const fetched = await fetchGitHubSkill(parsed, { fetch: fetchImpl });
        const checked = validateSkillFiles(fetched.files);
        const preview = await previewChecked(checked, { origin: "github" });
        if (!fetched.repoLicense && !checked.meta?.license) preview.warnings.push("라이선스를 확인하지 못했습니다. 쓰기 전에 저장소의 라이선스를 직접 확인해 주세요.");
        const token = checked.ok ? rememberPreview({ kind: "github", owner: fetched.owner, repo: fetched.repo, path: fetched.path, commit: fetched.commit, commitDate: fetched.commitDate, url: fetched.url, license: fetched.repoLicense || checked.meta?.license || "", sha256: checked.sha256 }) : "";
        return result(checked.ok ? "preview" : "invalid", checked.ok ? "가져오기 전 미리보기입니다. 설치하거나 실행하지 않았습니다." : "이 폴더는 스킬로 보관할 수 없습니다: " + checked.problems.join(" "), { token, source: { kind: "github", url: fetched.url, commit: fetched.commit, commitDate: fetched.commitDate, license: fetched.repoLicense || checked.meta?.license || "", skipped: fetched.skipped }, preview });
      }
      if (kind === "import_github" || kind === "import_folder") {
        const item = previews.get(clip(payload.token, 64));
        if (!item || item.kind !== (kind === "import_github" ? "github" : "user_folder")) return result("review_required", "미리보기가 만료됐습니다. 다시 미리보기를 열어 주세요.");
        let files; let origin;
        if (item.kind === "github") {
          const fetched = await fetchGitHubSkill({ owner: item.owner, repo: item.repo, path: item.path, ref: item.commit }, { fetch: fetchImpl });
          files = fetched.files;
          origin = { kind: "github", owner: item.owner, repo: item.repo, path: item.path, ref: item.commit, refDate: item.commitDate, url: item.url, license: item.license };
        } else {
          files = (await readSkillFolder(item.folder, { io })).files;
          origin = { kind: "user_folder", folder: item.folder };
        }
        const checked = validateSkillFiles(files);
        if (!checked.ok) return result("invalid", "가져오지 못했습니다: " + checked.problems.join(" "), { problems: checked.problems });
        if (checked.sha256 !== item.sha256 || payload.reviewedSha256 !== item.sha256) return result("review_required", "미리보기 뒤 내용이 바뀌었습니다. 다시 확인해 주세요.");
        if (origin.kind === "user_folder") origin.sourceSha256 = checked.sha256;
        const approved = await confirm({ kind: "import", name: checked.meta.name, detail: [item.kind === "github" ? "출처: " + item.url + "\n커밋: " + item.commit + (item.license ? "\n라이선스: " + item.license : "\n라이선스: 확인 못 함") : "출처: " + item.folder, "저장 위치: " + path.join(deployRoot, checked.meta.name), "파일:", describeFiles(checked.files), "설치·실행하지 않고 파일만 보관합니다."].join("\n") });
        if (!approved) return result("declined", "가져오기를 취소했습니다. 아무것도 바꾸지 않았습니다.");
        previews.delete(clip(payload.token, 64));
        return library.add({ files: checked.files, origin, label: clip(payload.label, 80) || checked.meta.name, license: origin.license ?? "", note: item.kind === "github" ? "깃허브 " + item.commit.slice(0, 7) : "내 폴더" });
      }
      if (kind === "preview_folder") {
        const folder = await pickFolder({ title: "가져올 스킬 폴더(SKILL.md 가 있는 폴더) 고르기" });
        if (!folder) return result("declined", "폴더를 고르지 않았습니다.");
        const { files, skipped } = await readSkillFolder(folder, { io });
        const checked = validateSkillFiles(files);
        const preview = await previewChecked(checked, { origin: "user_folder" });
        const token = checked.ok ? rememberPreview({ kind: "user_folder", folder, sha256: checked.sha256 }) : "";
        return result(checked.ok ? "preview" : "invalid", checked.ok ? "가져오기 전 미리보기입니다." : "이 폴더는 스킬로 보관할 수 없습니다: " + checked.problems.join(" "), { token, source: { kind: "user_folder", folder, skipped }, preview });
      }
      if (kind === "library_list") return library.list();
      if (kind === "library_get") return library.get(payload.name);
      if (kind === "library_check") return result("checked", "스킬 최신 확인을 마쳤습니다.", await checkSkillUpdates(library, { force: payload.force === true, names: Array.isArray(payload.names) ? payload.names : null }));
      if (kind === "library_compare") return library.compare(payload.name);
      if (kind === "library_apply") {
        const info = await library.get(payload.name);
        if (info.status !== "skill") return info;
        const approved = await confirm({ kind: "apply", name: info.skill.name, toVersion: clip(payload.toVersion, 40), detail: ["지금 버전: " + (info.skill.active?.version ?? ""), "새 버전: " + (clip(payload.toVersion, 40) || "최신 원본"), payload.overwriteLocal === true ? "직접 고친 내용을 먼저 새 버전으로 보관한 뒤 바꿉니다." : "", "이전 버전은 보관함에 남겨 언제든 되돌릴 수 있습니다."].filter(Boolean).join("\n") });
        if (!approved) return result("declined", "적용을 취소했습니다.");
        return library.applyUpdate(payload.name, { expectedSha256: clip(payload.expectedSha256, 64), overwriteLocal: payload.overwriteLocal === true });
      }
      if (kind === "library_rollback") {
        const info = await library.get(payload.name);
        if (info.status !== "skill") return info;
        const approved = await confirm({ kind: "rollback", name: info.skill.name, detail: "지금 버전: " + (info.skill.active?.version ?? "") + "\n바로 앞 버전으로 되돌립니다. 지금 버전도 보관함에 남습니다." });
        if (!approved) return result("declined", "되돌리기를 취소했습니다.");
        return library.rollback(payload.name, { overwriteLocal: payload.overwriteLocal === true });
      }
      if (kind === "library_adopt_local") return library.adoptLocal(payload.name);
      if (kind === "library_redeploy") return library.redeploy(payload.name);
      if (kind === "library_use") return library.setUsedBy(payload.name, { teammateId: payload.teammateId, teammateName: payload.teammateName, add: payload.add !== false });
      if (kind === "library_track_website") {
        const catalog = await readWebsiteCatalog({});
        const entry = catalog.skills.find((skill) => skill.name === clip(payload.name, 64));
        if (!entry) return result("not_found", "웹사이트 카탈로그에 없는 스킬입니다.");
        return library.track({ name: entry.name, label: entry.label, description: entry.description, origin: { kind: "website", version: entry.version, sha256: entry.sha256, catalogUrl: websiteCatalogUrl }, usedBy: payload.teammateId ? { teammateId: payload.teammateId, teammateName: payload.teammateName } : null });
      }
      if (kind === "library_track_app") {
        const bundled = await readBundled();
        const entry = (bundled?.skills ?? []).find((skill) => skill.name === clip(payload.name, 64));
        if (!entry) return result("not_found", "이 앱에 들어 있는 스킬이 아닙니다.");
        return library.track({ name: entry.name, label: entry.label, description: entry.description, origin: { kind: "app_bundled", version: entry.version, sha256: entry.integrity?.sha256 ?? "" }, usedBy: payload.teammateId ? { teammateId: payload.teammateId, teammateName: payload.teammateName } : null });
      }
      if (kind === "library_track_local") {
        const local = await listLocalSkills({});
        const entry = local.skills.find((skill) => skill.folder === clip(payload.name, 64) || skill.name === clip(payload.name, 64));
        if (!entry) return result("not_found", "이 PC 스킬 폴더에서 찾지 못했습니다.");
        const tree = await folderTreeHash(entry.dir, { io });
        return library.track({ name: entry.folder, label: entry.name, description: entry.description, origin: { kind: "this_pc", folder: entry.dir, root: entry.root, sha256: tree?.sha256 ?? "", version: entry.version }, usedBy: payload.teammateId ? { teammateId: payload.teammateId, teammateName: payload.teammateName } : null });
      }
      if (kind === "library_publish_candidate") return library.setPublishCandidate(payload.name, payload.flag !== false);
      if (kind === "library_publish_candidates") return library.listPublishCandidates();
      if (kind === "voice_engines") return voiceEngines();
      if (kind === "voice_sample") return voiceSample({ text: payload.text, voice: payload.voice });
      if (kind === "run_action") return runAction(payload);
      if (kind === "open_run") {
        const target = payload.target === "samples" ? path.join(runsRoot, "samples") : uuidPattern.test(String(payload.runId ?? "")) && /^\d{4}-\d{2}-\d{2}$/u.test(String(payload.day ?? "")) ? path.join(runsRoot, payload.day, payload.runId, "output") : "";
        if (!target) return result("invalid", "열 결과 폴더를 다시 선택해 주세요.");
        const error = await openPath(target);
        if (error) return result("failed", String(error));
        return result("opened", "결과 폴더를 열었습니다.");
      }
      if (kind === "supertonic_check") {
        const folder = await pickFolder({ title: "Supertonic 저장소 폴더 고르기(확인만 하고 설치하지 않습니다)" });
        if (!folder) return result("declined", "폴더를 고르지 않았습니다.");
        const has = async (relative, pattern) => { try { const names = await io.readdir(path.join(folder, relative)); return names.some((name) => pattern.test(name)); } catch { return false; } };
        const checks = [
          { item: "ONNX 모델(assets/onnx)", ok: await has(path.join("assets", "onnx"), /\.onnx$/iu) },
          { item: "목소리 스타일(assets/voice_styles)", ok: await has(path.join("assets", "voice_styles"), /\.json$/iu) },
          { item: "Python 예제(py/example_onnx.py)", ok: await has("py", /^example_onnx\.py$/u) },
        ];
        const missing = checks.filter((check) => !check.ok).map((check) => check.item);
        return result(missing.length ? "supertonic_incomplete" : "supertonic_ready", missing.length ? "Supertonic 준비가 덜 됐습니다: " + missing.join(", ") + ". 모델 내려받기는 README 의 Quick Start 를 보고 직접 승인해 주세요(앱이 내려받지 않음). 목소리 담당 스킬 1.0.0 은 Supertonic 을 아직 실행하지 않습니다." : "Supertonic 파일이 갖춰져 있습니다. 목소리 담당 스킬 1.0.0 은 Windows 기본 음성만 실행합니다(Supertonic 연결은 다음 버전).", { folder, checks });
      }
      return result("unsupported", "지원하지 않는 요청입니다.");
    } catch (error) {
      return result(error?.code === "INDEX_UNREADABLE" ? "library_unreadable" : "failed", String(error?.message ?? error));
    }
  }

  return { handle, library, readWebsiteCatalog, listLocalSkills, readTemplate };
}

