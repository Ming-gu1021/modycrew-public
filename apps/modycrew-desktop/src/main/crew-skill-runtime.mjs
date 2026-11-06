/**
 * 크루 스킬 실행기 — 크루 스킬을 이 PC에 로그인된 실제 Codex CLI·Claude Code로 실행한다.
 *
 * Claude·Codex 안에서 스킬이 하는 일을 모디크루에서도 그대로 하게 하는 것이 목적이다.
 *   - 지침형(instructions): 스킬 지침과 요청을 도구 없이 보내 텍스트 결과를 받는다.
 *   - 실제 실행형(agent): 격리 작업 폴더에 스킬 파일을 놓고 CLI 에이전트가 파일 도구로 스킬을 수행한다.
 *     사용자가 고른 폴더는 읽기 전용 또는 수정 허용 중 하나로만 연다(확인 창에서 고름).
 *   - 교차 검토형(council): 로그인된 실행기들이 독립 답변 → 익명 교차 검토 → 의장 종합 3단계를 돈다.
 *
 * 지키는 것
 *   - 실행 전 사용자 확인: 결과 파일만 만드는 실행은 앱의 자동 판단(options.autoApprove)으로 시작하고, 사용자 폴더를 다루는
 *     실행은 데스크톱 확인 창을 띄운다. 모델이 혼자 실행 조건을 넓히지 못한다.
 *   - 로그인 확인은 모델을 부르지 않는 상태 명령만 쓴다(구독 사용량을 쓰지 않는다).
 *   - 결과는 먼저 실행 기록에 남기고 파일로 저장한다. 앱이 꺼진 실행은 '확인 필요'로 남기고 자동 재실행하지 않는다.
 *   - 배포·발송·게시·결제·삭제·패키지 설치는 프롬프트에서 금지하고, 수정 허용 폴더의 바뀐 파일은 모두 보고한다.
 *   - 실행 프로세스에는 허용 목록 환경변수만 넘긴다(API 키·토큰 제외). Codex 는 사용자 config(다른 MCP·플러그인)를 읽지 않는다.
 *   - 실행 상태는 업무 상태 정본(work-status)의 8개 값으로 기록한다. 사무실·알림·내 확인 필요가 같은 값을 읽는다.
 *   - 큰 개발 변경은 계획 단계에서 멈추고 사용자 설계 확인 뒤에만 대상 폴더를 고친다(planGate, 앱이 강제).
 *   - 보안 점검은 읽기 전용(Codex 샌드박스·Claude 제한 모드)·대상 코드 실행 없음·시간/메모리 한도로 돌고, 앱이 근거 위치를 검사한다.
 *   - 선택형 확장 스킬은 무결성을 확인해 추가한 사본으로만 실행하고, 동봉 스킬도 실행 전에 카탈로그 해시와 비교한다.
 *   - 앱을 완전히 끄면 진행 중인 실행 프로세스를 끝내고 '연결 끊김'으로 남긴다. 다시 열어도 자동으로 다시 실행하지 않는다.
 *   - 승인함 카드는 실행 기록(정본)에서만 다시 계산하고, 같은 실행의 기록 쓰기·카드 갱신·승인함 결정 확인은 한 줄로 세운다.
 *   - 중지·시간 초과·오류로 멈췄어도 대상 폴더 변경이 남으면 깨끗한 취소로 두지 않고 '결과 확인 필요'로 남긴다.
 *   - Windows 에서는 Claude 의 명령 실행이 OS 샌드박스로 묶이지 않아 Claude 에 명령 도구를 주지 않는다(명령이 필요하면 Codex 를 먼저 고른다).
 */
import { createReviewedSourceBundles } from "./reviewed-source-bundles.mjs";
import fs from "node:fs/promises";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { killProcessTree, readSubscriptionRuntimeStatus, resolveSubscriptionCliExecutable } from "./subscription-cli-runtime.mjs";
import { managedToolEnv } from "./managed-tool-env.mjs";
import { buildChildEnv, killAllLiveChildrenSync, redactSecretsWithCount, registerLiveChild, scanTextFilesForSecrets, startResourceWatch } from "./crew-skill-sandbox.mjs";
import { createCrewSkillPackageStore, readBundledCatalog, verifyBundledSkill } from "./crew-skill-packages.mjs";
import { listDesktopAppActionAttention, probeAgentDesktop } from "./desktop-app-control.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const defaultCrewSkillLibraryRoot = path.join(moduleDir, "crew-skills", "library");

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const agentTimeoutMs = 15 * 60_000;
const textTimeoutMs = 4 * 60_000;
const statusTimeoutMs = 15_000;
const maxRequestChars = 20_000;
const maxSkillBytes = 128 * 1024;
const maxCopyBytes = 4 * 1024 * 1024;
const maxCopyFiles = 300;
const maxSnapshotFiles = 5_000;
const maxListedFiles = 200;
const skipDirs = new Set(["node_modules", ".git", ".next", "dist", "out", ".venv", "__pycache__", ".turbo"]);

const digest = (value) => createHash("sha256").update(value).digest("hex").slice(0, 24);
const clip = (value, max) => String(value ?? "").trim().slice(0, max);
const result = (status, userMessage, extra = {}) => ({ status, userMessage, ...extra });
/** 바뀐 파일 목록을 한 줄로(앞의 몇 개만). */
const listChanges = (files = [], max = 6) => files.slice(0, max).map((file) => file.change + " " + file.path).join(", ") + (files.length > max ? " 외 " + (files.length - max) + "개" : "");
const windowsShellNotice = "Windows 에서는 명령 실행을 허용해도 Claude 에는 명령 도구를 주지 않습니다(OS 샌드박스로 묶이지 않음). Codex 로그인이 있으면 Codex 로 바꿔 실행합니다.";

/** 다른 실행기로 보내기 전에 접속 키·토큰처럼 보이는 문자열을 가린다(SKILL.md 의 '먼저 확인할 것' 기준). */
export function redactSecrets(value) {
  return redactSecretsWithCount(value).text;
}

// ── 스킬 문서 ──────────────────────────────────────────────────────────────────
/** SKILL.md 를 데이터로만 읽는다. 머리말의 명령·후크를 실행하지 않는다. */
export function parseSkillDocument(source, fallbackName = "skill") {
  const match = String(source ?? "").replace(/^\uFEFF/u, "").match(/^---\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/u);
  if (!match) throw new Error("SKILL.md의 머리말(name·description) 형식을 확인해 주세요.");
  const metadata = match[1];
  const field = (key) => {
    const found = metadata.match(new RegExp("^" + key + ":[ \\t]*(.*)$", "mu"));
    if (!found) return "";
    const raw = found[1].trim();
    if (/^[>|][+-]?$/u.test(raw)) {
      const start = metadata.indexOf(found[0]) + found[0].length;
      const rest = metadata.slice(start).split(/\r?\n/u).slice(1);
      const block = [];
      for (const line of rest) { if (!/^[ \t]+/u.test(line)) break; block.push(line.trim()); }
      return block.join(" ").trim();
    }
    return raw.replace(/^['"]|['"]$/gu, "");
  };
  const allowedTools = field("allowed-tools").split(/[,\s]+/u).map((item) => item.trim()).filter(Boolean);
  return {
    name: clip(field("name") || fallbackName, 64),
    description: clip(field("description"), 1024),
    compatibility: clip(field("compatibility"), 500),
    allowedTools,
    body: match[2].trim(),
  };
}

export function defaultInstalledSkillRoots(home = os.homedir()) {
  return [["Codex", ".codex/skills"], ["공용", ".agents/skills"], ["Claude", ".claude/skills"]]
    .map(([label, relative]) => ({ label, directory: path.join(home, relative) }));
}

// ── 경로 안전 ──────────────────────────────────────────────────────────────────
/** 드라이브 루트·홈 폴더 자체·시스템 폴더는 작업 대상으로 열지 않는다. */
export function isUnsafeTargetFolder(folder, { home = os.homedir(), env = process.env } = {}) {
  const resolved = path.resolve(String(folder ?? ""));
  if (!folder || resolved === path.parse(resolved).root) return true;
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const inside = (child, parent) => {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };
  if (same(resolved, home)) return true;
  for (const key of ["WINDIR", "SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"]) {
    if (env[key] && inside(resolved, env[key])) return true;
  }
  if (inside(resolved, path.join(home, ".codex")) || inside(resolved, path.join(home, ".claude")) || inside(resolved, path.join(home, ".ssh"))) return true;
  return false;
}

// ── 프로세스 ──────────────────────────────────────────────────────────────────
function quotePowerShell(value) {
  return "'" + String(value ?? "").replace(/['\u2018\u2019\u201a\u201b]/gu, "$&$&") + "'";
}

/** npm 으로 설치한 codex.cmd·codex.ps1 은 바로 spawn 할 수 없어 PowerShell 로 감싼다(인자는 우리 것뿐, 요청은 stdin). */
export function wrapCommandForPlatform(executable, args, platform = process.platform) {
  if (platform !== "win32" || !/\.(cmd|bat|ps1)$/iu.test(executable)) return { command: executable, args };
  const script = [
    "$ErrorActionPreference = 'Continue'",
    "$exe = " + quotePowerShell(executable),
    "$argv = @(" + args.map(quotePowerShell).join(", ") + ")",
    "& $exe @argv",
    "exit $LASTEXITCODE",
  ].join("\n");
  return {
    command: process.env.MODYCREW_POWERSHELL_PATH || "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
  };
}

export function runCliProcess({ executable, args, cwd, input = "", env, timeoutMs, abortSignal, spawnFn = spawn, onSpawn, stopWaitMs = 10_000 }) {
  return new Promise((resolve) => {
    if (abortSignal?.aborted) { resolve({ code: -1, stdout: "", stderr: "", cancelled: true }); return; }
    const target = wrapCommandForPlatform(executable, args);
    let child;
    try {
      child = spawnFn(target.command, target.args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: -1, stdout: "", stderr: String(error?.message ?? error) });
      return;
    }
    const unregister = registerLiveChild(child);
    try { onSpawn?.(child); } catch { /* 감시 시작 실패는 실행을 막지 않는다 */ }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let stopped = "";
    let stopTimer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      unregister();
      clearTimeout(timer);
      clearTimeout(stopTimer);
      abortSignal?.removeEventListener?.("abort", onAbort);
      resolve({ stdout, stderr, ...value });
    };
    // 중지·시간 초과: 프로세스 묶음을 끝내고 실제로 닫힐 때까지(최대 stopWaitMs) 기다린 뒤 끝났다고 알린다.
                                                                                           
    const stop = (reason) => {
      if (settled || stopped) return;
      stopped = reason;
      clearTimeout(timer);
      void killProcessTree(child);
      stopTimer = setTimeout(() => finish({ code: -1, [reason]: true, stopUnconfirmed: true }), stopWaitMs);
    };
    const timer = setTimeout(() => stop("timedOut"), timeoutMs);
    const onAbort = () => stop("cancelled");
    abortSignal?.addEventListener?.("abort", onAbort, { once: true });
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on("data", (chunk) => { if (stdout.length < 8 * 1024 * 1024) stdout += chunk; });
    child.stderr?.on("data", (chunk) => { if (stderr.length < 512 * 1024) stderr += chunk; });
    child.on("error", (error) => finish({ code: -1, error: String(error?.message ?? error), ...(stopped ? { [stopped]: true } : {}) }));
    child.on("close", (code) => finish(stopped ? { code: -1, [stopped]: true } : { code: Number(code ?? -1) }));
    child.stdin?.on?.("error", () => undefined);
    if (input) child.stdin?.write(input);
    child.stdin?.end();
  });
}

function findOnSystemPath(fileName) {
  for (const rawDir of String(process.env.PATH ?? process.env.Path ?? "").split(path.delimiter)) {
    const dir = rawDir.trim().replace(/^"|"$/gu, "");
    if (!dir) continue;
    try { const candidate = path.join(dir, fileName); if (existsSync(candidate)) return candidate; } catch { /* 잘못된 PATH 항목은 건너뜀 */ }
  }
  return "";
}

/** ai-provider-handler 의 Codex 실행 파일 탐색과 같은 순서: 지정 경로 → 동봉본 → Codex 앱 → PATH. */
export function resolveCodexExecutable(options = {}) {
  const explicit = String(options.codexCliPath ?? process.env.MODYCREW_CODEX_CLI_PATH ?? "").trim();
  if (explicit && existsSync(explicit)) return explicit;
  const candidates = [];
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  if (resourcesPath) candidates.push(path.join(resourcesPath, "toolchain", "codex", "bin", "codex.exe"), path.join(resourcesPath, "toolchain", "codex", "codex.exe"));
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
    try {
      const dirs = readdirSync(binRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
        .map((entry) => ({ dir: path.join(binRoot, entry.name), mtime: statSync(path.join(binRoot, entry.name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const { dir } of dirs) candidates.push(path.join(dir, "codex.exe"));
    } catch { /* Codex 앱이 없으면 넘어감 */ }
    candidates.push(path.join(binRoot, "codex.exe"));
  }
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  for (const name of process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex.ps1"] : ["codex"]) {
    const found = findOnSystemPath(name);
    if (found) return found;
  }
  return "";
}

// ── 실행기 어댑터 ─────────────────────────────────────────────────────────────
const mcpIdPattern = /^[a-z0-9_-]{1,40}$/u;
const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]{0,80}$/u;

/** 실행에 필요한 MCP 서버만 Codex 에 다시 연다(-c mcp_servers.<id>.*). 값은 TOML 기본 문자열로 넘긴다. */
export function codexMcpOverrides(servers = {}) {
  const args = [];
  for (const [id, server] of Object.entries(servers ?? {})) {
    if (!mcpIdPattern.test(id) || !server?.command) continue;
    args.push("-c", "mcp_servers." + id + ".command=" + JSON.stringify(String(server.command)));
    args.push("-c", "mcp_servers." + id + ".args=[" + (server.args ?? []).map((value) => JSON.stringify(String(value))).join(", ") + "]");
    for (const [name, value] of Object.entries(server.env ?? {})) {
      if (envNamePattern.test(name)) args.push("-c", "mcp_servers." + id + ".env." + name + "=" + JSON.stringify(String(value)));
    }
  }
  return args;
}

   
                                                                           
                                                                                     
   
export function readCodexWindowsSandbox({ home = os.homedir(), codexHome = process.env.CODEX_HOME, platform = process.platform, readText } = {}) {
  if (platform !== "win32") return "";
  let text = "";
  try { text = (readText ?? ((file) => readFileSync(file, "utf8")))(path.join(codexHome || path.join(home, ".codex"), "config.toml")); } catch { return ""; }
  let section = "";
  for (const line of String(text).split(/\r?\n/u)) {
    const trimmed = line.trim();
    const header = trimmed.match(/^\[([^\]]+)\]$/u);
    if (header) { section = header[1].trim(); continue; }
    const value = section === "windows" ? trimmed.match(/^sandbox\s*=\s*["']([a-z_-]+)["']\s*$/u)?.[1] : undefined;
    if (value && ["elevated", "unelevated"].includes(value)) return value;
  }
  return "";
}

   
                                                                               
                                                                       
                                                                                                               
                                                                              
   
export function codexWindowsSandboxFor(executable, configured, { platform = process.platform, resourcesPath = process.resourcesPath } = {}) {
  if (platform !== "win32") return configured;
  if (!configured) return "unelevated";
  const bundledRoot = resourcesPath ? path.resolve(resourcesPath, "toolchain", "codex").toLowerCase() + path.sep : "";
  const bundled = Boolean(bundledRoot) && path.resolve(String(executable ?? "")).toLowerCase().startsWith(bundledRoot);
  return configured === "elevated" && bundled ? "unelevated" : configured;
}

/** elevated 샌드박스 준비 실패(명령이 하나도 실행되지 않음)인지. 이때는 같은 요청을 unelevated 로 한 번 더 한다. */
export function windowsSandboxSetupFailed(run) {
  return /setup refresh had errors|helper_unknown_error/u.test(String(run?.stdout ?? "") + "\n" + String(run?.stderr ?? ""));
}

   
                                                                                                        
                                                                           
                                                                                 
                                                             
   
export function findElevatedReadyCodex({ localAppData = process.env.LOCALAPPDATA, platform = process.platform } = {}) {
  if (platform !== "win32" || !localAppData) return "";
  const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
  const ready = (dir) => ["codex.exe", "codex-windows-sandbox-setup.exe", "codex-command-runner.exe"].every((name) => existsSync(path.join(dir, name)));
  try {
    const dirs = readdirSync(binRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
      .map((entry) => ({ dir: path.join(binRoot, entry.name), mtime: statSync(path.join(binRoot, entry.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const { dir } of dirs) if (ready(dir)) return path.join(dir, "codex.exe");
  } catch { /* Codex 앱이 없으면 넘어감 */ }
  return ready(binRoot) ? path.join(binRoot, "codex.exe") : "";
}

export function buildCodexArgs({ mode, cwd, lastMessageFile, addDirs = [], model = "", profile = "standard", mcpServers = {}, windowsSandbox = "" }) {
  const readOnly = mode === "text" || profile === "audit";
  return [
    "exec", "--json", "--ephemeral", "--skip-git-repo-check",
    "--sandbox", readOnly ? "read-only" : "workspace-write",
    "--disable", "plugins", "--disable", "memories",
    // 사용자 config 의 MCP 서버·플러그인·후크·프록시·모델을 읽지 않는다(로그인은 CODEX_HOME 그대로). 필요한 MCP 만 다시 연다.
    "--ignore-user-config",
    ...(["elevated", "unelevated"].includes(windowsSandbox) ? ["-c", "windows.sandbox=" + JSON.stringify(windowsSandbox)] : []),
    ...codexMcpOverrides(mcpServers),
    ...(model ? ["-m", model] : []),
    "-C", cwd,
    "-o", lastMessageFile,
    ...(readOnly ? [] : addDirs.flatMap((dir) => ["--add-dir", dir])),
    "-",
  ];
}

/**
 * Claude 에 명령 실행 도구(Bash)를 줄 수 있는 OS 인지. Windows 에서는 Claude 의 명령 실행이 OS 샌드박스로 묶이지 않아
 * 대상 폴더 밖 쓰기를 막지도 찾지도 못한다(실행기는 대상 폴더만 비교한다). 그래서 Windows 에서는 프롬프트가 아니라 인자로 뺀다.
 */
export function claudeShellAllowed(platform = process.platform) {
  return platform !== "win32";
}

export function buildClaudeArgs({ mode, addDirs = [], allowWrite = true, writeScope = "", allowScripts = false, model = "", profile = "standard", mcpConfigFile = "", mcpServerIds = [], platform = process.platform }) {
  const args = ["-p", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config", ...(model ? ["--model", model] : [])];
  if (mode === "text") return [...args, "--tools", "", "--disable-slash-commands"];
  if (profile === "audit") {
    // 제한 모드: 명령·코드 실행 도구와 웹 조회가 없고 사용자 설정을 읽지 않으며, 파일 도구는 작업 폴더(--add-dir 포함) 안으로 묶인다.
    const readTools = ["Read", "Glob", "Grep"].join(",");
    return [...args, "--restricted", "--permission-mode", "dontAsk", "--tools", readTools, "--allowedTools", readTools, ...addDirs.flatMap((dir) => ["--add-dir", dir])];
  }
  if (profile === "reverse") {
    const allowed = ["Read", "Glob", "Grep", "Write(./output/**)", "Edit(./output/**)", ...mcpServerIds.filter((id) => mcpIdPattern.test(id)).map((id) => "mcp__" + id)];
    return [...args, "--restricted", ...(mcpConfigFile ? ["--mcp-config", mcpConfigFile] : []), "--permission-mode", "dontAsk", "--tools", "Read,Glob,Grep,Write,Edit", "--allowedTools", allowed.join(",")];
  }
  // 스크립트 실행을 허용했어도 Windows 에서는 명령 도구를 열지 않는다(--tools 에 없는 도구는 쓸 수 없다). 다른 OS 는 기존대로 Bash 를 연다.
  const shell = allowScripts && claudeShellAllowed(platform);
  const tools = ["Read", "Glob", "Grep", "Skill", ...(allowWrite ? ["Write", "Edit"] : []), ...(shell ? ["Bash"] : [])];
  // 읽기 전용 대상 폴더를 함께 열 때는 쓰기를 작업 폴더 아래 output 으로만 허락한다.
  const allowed = writeScope
    ? ["Read", "Glob", "Grep", "Skill", "Write(" + writeScope + ")", "Edit(" + writeScope + ")", ...(shell ? ["Bash"] : [])]
    : tools;
  return [...args, "--permission-mode", "dontAsk", "--tools", tools.join(","), "--allowedTools", allowed.join(","), ...addDirs.flatMap((dir) => ["--add-dir", dir])];
}

export function parseClaudeJsonResult(stdout) {
  const raw = String(stdout ?? "").trim();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {
    const lastLine = raw.split(/\r?\n/u).reverse().find((line) => line.trim().startsWith("{"));
    try { parsed = lastLine ? JSON.parse(lastLine) : null; } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== "object") return { text: raw, isError: !raw };
  return {
    text: typeof parsed.result === "string" ? parsed.result.trim() : "",
    isError: parsed.is_error === true || (parsed.subtype && parsed.subtype !== "success"),
    turns: Number(parsed.num_turns) || 0,
    permissionDenials: Array.isArray(parsed.permission_denials) ? parsed.permission_denials.length : 0,
    usage: parsed.usage && typeof parsed.usage === "object" ? { inputTokens: Number(parsed.usage.input_tokens) || 0, outputTokens: Number(parsed.usage.output_tokens) || 0 } : undefined,
    model: typeof parsed.model === "string" ? parsed.model : Object.keys(parsed.modelUsage ?? {})[0] ?? "",
  };
}

export function parseCodexEvents(stdout) {
  const messages = [];
  let usage;
  for (const line of String(stdout ?? "").split(/\r?\n/u)) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    let event;
    try { event = JSON.parse(text); } catch { continue; }
    if (event?.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") messages.push(event.item.text.trim());
    if (event?.type === "turn.completed" && event.usage) usage = { inputTokens: Number(event.usage.input_tokens) || 0, outputTokens: Number(event.usage.output_tokens) || 0 };
  }
  return { text: messages.filter(Boolean).join("\n").trim(), usage };
}

function diagnostic(value) {
  return String(value ?? "").replace(/\bsk-[A-Za-z0-9_-]{20,}\b/gu, "[키 가림]").replace(/\s+/gu, " ").trim().slice(0, 300);
}

/** 실행 프로세스 환경: 앱 Python 경로를 더한 뒤 허용 목록만 남긴다(API 키·토큰 제외). */
export function crewSkillChildEnv(source = process.env) {
  return buildChildEnv(managedToolEnv(source));
}

export function createCodexAdapter(options = {}) {
  const env = () => crewSkillChildEnv();
  return {
    id: "codex",
    label: "Codex",
    async status() {
      const executable = resolveCodexExecutable(options);
      if (!executable) return { installed: false, loggedIn: false, userMessage: "이 PC에서 Codex CLI를 찾지 못했습니다." };
      const run = await (options.runProcess ?? runCliProcess)({ executable, args: ["login", "status"], env: env(), timeoutMs: statusTimeoutMs });
      const output = run.stdout + "\n" + run.stderr;
      const loggedIn = run.code === 0 && /logged in/iu.test(output) && !/not logged in/iu.test(output);
      return { installed: true, loggedIn, userMessage: loggedIn ? "Codex 로그인 확인됨" : "Codex 로그인이 필요합니다." };
    },
    async run({ mode, cwd, prompt, addDirs = [], lastMessageFile, timeoutMs, abortSignal, profile = "standard", mcpServers = {}, onSpawn }) {
      const configured = options.codexWindowsSandbox ?? readCodexWindowsSandbox();
      const explicitCli = Boolean(options.codexCliPath || process.env.MODYCREW_CODEX_CLI_PATH);
      const elevatedReady = configured === "elevated" && !explicitCli ? (options.findElevatedReadyCodex ?? findElevatedReadyCodex)() : "";
      const executable = elevatedReady || resolveCodexExecutable(options);
      if (!executable) return { ok: false, text: "", error: "Codex CLI를 찾지 못했습니다." };
      const sandbox = codexWindowsSandboxFor(executable, configured, { resourcesPath: options.resourcesPath ?? process.resourcesPath });
      const runOnce = async (windowsSandbox) => {
        const args = buildCodexArgs({ mode, cwd, lastMessageFile, addDirs, model: options.codexModel ?? "", profile, mcpServers, windowsSandbox });
        await fs.rm(lastMessageFile, { force: true }).catch(() => undefined);
        return (options.runProcess ?? runCliProcess)({ executable, args, input: prompt, env: env(), timeoutMs, abortSignal, onSpawn });
      };
      let run = await runOnce(sandbox);
      if (sandbox === "elevated" && !run.cancelled && !run.timedOut && windowsSandboxSetupFailed(run)) run = await runOnce("unelevated");
      let text = "";
      try { text = (await fs.readFile(lastMessageFile, "utf8")).trim(); } catch { /* 마지막 메시지 파일이 없으면 이벤트에서 찾는다 */ }
      const events = parseCodexEvents(run.stdout);
      if (!text) text = events.text;
      return {
        ok: run.code === 0 && Boolean(text), text, cancelled: run.cancelled, timedOut: run.timedOut, usage: events.usage,
        stopUnconfirmed: run.stopUnconfirmed,
        error: run.code === 0 ? "" : diagnostic(run.stderr || run.error || run.stdout),
      };
    },
  };
}

export function createClaudeAdapter(options = {}) {
  return {
    id: "claude",
    label: "Claude",
    async status() {
      const status = await (options.readClaudeStatus ?? readSubscriptionRuntimeStatus)("claude_subscription", options);
      return { installed: Boolean(status.installed), loggedIn: Boolean(status.loggedIn), userMessage: status.userMessage };
    },
    async run({ mode, cwd, prompt, addDirs = [], allowWrite = true, writeScope = "", allowScripts = false, timeoutMs, abortSignal, profile = "standard", mcpConfigFile = "", mcpServerIds = [], onSpawn }) {
      const executable = resolveSubscriptionCliExecutable("claude_subscription", options);
      if (!executable) return { ok: false, text: "", error: "이 PC에서 Claude Code를 찾지 못했습니다." };
      const args = buildClaudeArgs({ mode, addDirs, allowWrite, writeScope, allowScripts, model: options.claudeModel ?? "", profile, mcpConfigFile, mcpServerIds, platform: options.platform ?? process.platform });
      const run = await (options.runProcess ?? runCliProcess)({ executable, args, cwd, input: prompt, env: crewSkillChildEnv(), timeoutMs, abortSignal, onSpawn });
      const parsed = parseClaudeJsonResult(run.stdout);
      return {
        ok: run.code === 0 && !parsed.isError && Boolean(parsed.text), text: parsed.text, cancelled: run.cancelled, timedOut: run.timedOut,
        usage: parsed.usage, turns: parsed.turns, permissionDenials: parsed.permissionDenials, model: parsed.model, stopUnconfirmed: run.stopUnconfirmed,
        error: run.code === 0 && !parsed.isError ? "" : diagnostic(run.stderr || run.error || parsed.text || run.stdout),
      };
    },
  };
}

// ── 확인 창(기본: Electron) ───────────────────────────────────────────────────
async function electronConfirm(info) {
  const { dialog, BrowserWindow } = await import("electron");
  const parent = BrowserWindow.getFocusedWindow() ?? undefined;
  const show = (opts) => (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts));
  const ready = info.runtimes.filter((runtime) => runtime.loggedIn);
  if (!ready.length) {
    await show({ type: "warning", title: "크루 스킬 실행", message: "실행할 수 있는 Codex·Claude 로그인이 없습니다.", detail: "AI 연결 화면에서 Codex 또는 Claude 로그인을 마친 뒤 다시 실행해 주세요. AI에는 아무것도 보내지 않았습니다.", buttons: ["확인"], noLink: true });
    return { approved: false };
  }
  const openDialog = (opts) => (parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts));
  if (info.approvedPlan) {
    const plan = info.approvedPlan;
    const res = await show({
      type: "question", title: "설계 확인 후 구현", noLink: true, defaultId: 0, cancelId: 0, buttons: ["취소", ...ready.map((runtime) => runtime.label + "로 구현")],
      message: "확인한 설계대로 " + plan.folder + " 폴더를 수정할까요?",
      detail: ["설계 요약: " + (plan.summary || "plan.md 참고"), "계획한 파일: " + (plan.files.length ? plan.files.slice(0, 12).join(", ") : "계획에 없음"), "계획 밖 파일이 바뀌면 결과에 따로 표시합니다. 구독 계정의 사용량이 쓰입니다.", ...(info.scriptsNotice ? [info.scriptsNotice] : []), "", "요청: " + info.request.slice(0, 400)].join("\n"),
      checkboxLabel: "테스트·스크립트 명령 실행 허용", checkboxChecked: false,
    });
    if (res.response === 0) return { approved: false };
    return { approved: true, runtimeId: ready[res.response - 1]?.id, allowScripts: Boolean(res.checkboxChecked) };
  }
  if (info.profile === "audit" || info.profile === "reverse") {
    const audit = info.profile === "audit";
    const limits = info.limits ?? {};
    const first = await show({
      type: "question", title: audit ? "보안 점검(읽기 전용)" : "기능 분석(리버스 엔지니어링)", noLink: true, defaultId: 0, cancelId: 0,
      buttons: ["취소", ...ready.map((runtime) => runtime.label + (audit ? "로 점검할 폴더 고르기" : "로 분석할 파일 고르기"))],
      message: info.label + "을 실행할까요?",
      detail: [
        ...(audit
          ? ["점검할 폴더를 읽기 전용으로 엽니다. 파일을 고치지 않고 대상 코드를 실행하지 않습니다.", "Codex: 읽기 전용 샌드박스(네트워크 차단) · Claude: 제한 모드(읽기·검색 도구만)."]
          : ["고른 파일을 실행 폴더로 복사한 사본만 REA 분석 도구로 정적 분석합니다. 원본은 바꾸지 않습니다.", "분석 권한이 있는 대상만 고르세요. 보호 장치·인증 우회는 하지 않습니다."]),
        "시간 " + Math.round((limits.timeoutMs ?? 0) / 60000) + "분 · 메모리 " + Math.round((limits.maxBytes ?? 0) / 1024 ** 3) + "GB를 넘으면 실행을 끝냅니다.",
        "운영 서비스 공격·외부 업로드·유료 호출을 하지 않습니다. 구독 계정의 사용량이 쓰입니다.",
        "", "요청: " + info.request.slice(0, 500),
      ].join("\n"),
    });
    if (first.response === 0) return { approved: false };
    const runtimeId = ready[first.response - 1]?.id;
    const picked = await openDialog({ title: audit ? "점검할 폴더 선택" : "분석할 파일 선택", properties: [audit ? "openDirectory" : "openFile"] });
    const target = picked.canceled ? "" : picked.filePaths?.[0] ?? "";
    if (!target) return { approved: false };
    return { approved: true, runtimeId, folder: target, access: "read" };
  }
  const council = info.execution === "council";
  const scope = info.execution === "agent"
    ? "실제 실행기가 모디크루 작업 폴더에서 파일 읽기·쓰기 도구로 스킬을 수행합니다. 결과 파일은 output 폴더에 남습니다." + (info.planGate ? " 폴더 수정을 허용하면 먼저 작업 크기를 판정하고, 큰 변경이면 설계 확인을 요청한 뒤 멈춥니다." : "")
    : council
      ? (ready.length > 1 ? ready.map((runtime) => runtime.label).join("·") + "가 각자 답한 뒤 익명으로 서로 검토하고, 첫 실행기가 종합합니다(실행기마다 2~3회 호출)." : ready[0].label + " 하나만 로그인돼 있어 관점 분리 검토로 진행합니다(교차 검증 아님).")
      : "스킬 지침과 요청을 도구 없이 보내 텍스트 결과를 받습니다.";
  const buttons = ["취소", ...(council ? [ready.length > 1 ? "교차 검토 시작" : "관점 분리 검토 실행"] : ready.map((runtime) => runtime.label + "로 실행"))];
  const first = await show({
    type: "question", title: "크루 스킬 실제 실행", noLink: true, defaultId: 0, cancelId: 0, buttons,
    message: info.label + " 스킬을 이 PC의 실제 실행기로 실행할까요?",
    detail: [scope, "구독 계정의 사용량이 쓰입니다. Codex에서 한도 뒤 크레딧 사용을 켜 두었다면 크레딧이 차감될 수 있습니다.", "배포·발송·게시·결제·삭제·패키지 설치는 하지 않도록 지시합니다.", "", "요청: " + info.request.slice(0, 600)].join("\n"),
    ...(info.execution === "agent" ? { checkboxLabel: "작업할 내 폴더를 직접 지정", checkboxChecked: false } : {}),
  });
  if (first.response === 0) return { approved: false };
  const runtimeId = council ? ready[0].id : ready[first.response - 1]?.id;
  if (info.execution !== "agent" || !first.checkboxChecked) return { approved: true, runtimeId };
  const picked = await openDialog({ title: "작업할 폴더 선택", properties: ["openDirectory"] });
  const folder = picked.canceled ? "" : picked.filePaths?.[0] ?? "";
  if (!folder) return { approved: false };
  const second = await show({
    type: "warning", title: "폴더 권한 선택", noLink: true, defaultId: 1, cancelId: 0, buttons: ["취소", "읽기만 허용", "수정까지 허용"],
    message: folder + " 폴더를 어떻게 다룰까요?",
    detail: "읽기만 허용: 파일을 읽기만 하고 결과는 모디크루 작업 폴더에 저장합니다.\n수정까지 허용: 요청 범위 안에서 이 폴더의 파일을 실제로 바꿀 수 있습니다. 바뀐 파일 목록을 결과에 모두 남깁니다." + (info.needsScripts && info.scriptsNotice ? "\n" + info.scriptsNotice : ""),
    ...(info.needsScripts ? { checkboxLabel: "테스트·스크립트 명령 실행 허용", checkboxChecked: false } : {}),
  });
  if (second.response === 0) return { approved: false };
  return { approved: true, runtimeId, folder, access: second.response === 2 ? "write" : "read", allowScripts: Boolean(info.needsScripts && second.checkboxChecked) };
}

/** 확장 추가·업데이트 확인 창. 권한 목록과 늘어난 권한을 보여 주고 사용자가 고른다. */
async function electronConfirmInstall(info) {
  const { dialog, BrowserWindow } = await import("electron");
  const parent = BrowserWindow.getFocusedWindow() ?? undefined;
  const opts = {
    type: "question", title: "크루 스킬 확장 " + (info.update ? "업데이트" : "추가"), noLink: true, defaultId: 0, cancelId: 0, buttons: ["취소", info.update ? "업데이트" : "추가"],
    message: info.label + " " + info.version + (info.update ? "으로 업데이트할까요?" : "을 추가할까요?"),
    detail: [
      "필요한 권한:", ...(info.permissionLabels.length ? info.permissionLabels.map((label) => "· " + label) : ["· 없음"]),
      ...(info.update && info.expandedLabels.length ? ["", "새로 늘어나는 권한: " + info.expandedLabels.join(", ")] : []),
      "", "출처·라이선스: " + info.license, "검증 상태: " + info.verification,
      "", "앱에 동봉된 패키지를 무결성 확인 뒤 설치합니다(네트워크 사용 없음). 실행할 때마다 확인 창이 다시 뜹니다.",
    ].join("\n"),
  };
  const res = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
  return { approved: res.response === 1 };
}

/** 앱 창을 보고 있지 않을 때만 데스크톱 알림을 띄운다. 알림을 못 띄워도 실행 결과에는 영향이 없다. */
async function electronNotify({ title, body }) {
  try {
    const { Notification, BrowserWindow } = await import("electron");
    if (BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return false;
    new Notification({ title, body }).show();
    return true;
  } catch { return false; }
}

// ── 파일 도우미 ───────────────────────────────────────────────────────────────
let pendingSerial = 0;
async function atomicWriteJson(io, file, data) {
  await io.mkdir(path.dirname(file), { recursive: true });
  // 같은 밀리초에 같은 파일을 두 번 써도 임시 파일 이름이 겹치지 않게 순번을 붙인다.
  const pending = file + "." + process.pid + "." + Date.now() + "." + (pendingSerial += 1) + ".pending";
  await io.writeFile(pending, JSON.stringify(data, null, 2), "utf8");
  // Windows 에서는 다른 쪽이 같은 파일을 읽는 동안(목록 조회·계획 카드가 이어 간 구현 기록을 읽을 때) 덮어쓰는 이름 바꾸기가
                                                                                          
  for (let attempt = 1; ; attempt += 1) {
    try { await io.rename(pending, file); return; } catch (error) {
      if (attempt >= 10 || !["EPERM", "EACCES", "EBUSY"].includes(error?.code)) {
        await io.unlink?.(pending)?.catch?.(() => undefined);
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
}

async function walkFiles(io, root, { limit, skip = skipDirs } = {}) {
  const files = [];
  const visit = async (dir) => {
    if (files.length >= limit) return;
    let entries;
    try { entries = await io.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= limit) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!skip.has(entry.name) && !entry.isSymbolicLink?.()) await visit(full); continue; }
      if (!entry.isFile()) continue;
      try { const info = await io.stat(full); files.push({ path: path.relative(root, full).replaceAll("\\", "/"), size: info.size, mtimeMs: Math.round(info.mtimeMs) }); } catch { /* 사라진 파일 */ }
    }
  };
  await visit(root);
  return files;
}

/** 스킬 폴더를 작업 폴더로 복사한다(asar 안에서도 읽히도록 readFile/writeFile 만 쓴다). */
async function copySkillFolder(io, from, to, reviewedFiles = null) {
  if (reviewedFiles) {
    // 검토된 원본은 명세에 있는 이미지·TSX까지 전부 복사한다. 일반 스킬 한도는 유지한다.
    for (const file of reviewedFiles) {
      const data = await io.readFile(path.join(from, ...file.path.split("/")));
      if (data.length !== file.bytes || createHash("sha256").update(data).digest("hex") !== file.sha256) throw new Error("실행 준비 중 원본 파일이 바뀌었습니다.");
      const target = path.join(to, ...file.path.split("/"));
      await io.mkdir(path.dirname(target), { recursive: true });
      await io.writeFile(target, data);
    }
    return reviewedFiles.length;
  }
  const files = await walkFiles(io, from, { limit: maxCopyFiles });
  let bytes = 0;
  for (const file of files) {
    bytes += file.size;
    if (bytes > maxCopyBytes) throw new Error("스킬 폴더가 너무 큽니다(4MB 초과).");
    const target = path.join(to, ...file.path.split("/"));
    await io.mkdir(path.dirname(target), { recursive: true });
    await io.writeFile(target, await io.readFile(path.join(from, ...file.path.split("/"))));
  }
  return files.length;
}

function diffSnapshots(before, after) {
  const prior = new Map(before.map((file) => [file.path, file]));
  const changed = [];
  for (const file of after) {
    const old = prior.get(file.path);
    if (!old) changed.push({ path: file.path, change: "생성" });
    else if (old.size !== file.size || old.mtimeMs !== file.mtimeMs) changed.push({ path: file.path, change: "수정" });
    prior.delete(file.path);
  }
  for (const file of prior.values()) changed.push({ path: file.path, change: "삭제" });
  return changed.slice(0, maxListedFiles);
}

const maxManifestFiles = 500;
const maxManifestFileBytes = 25 * 1024 * 1024;
const maxTargetCopyBytes = 1024 * 1024 * 1024;

async function sha256File(io, file) {
  return createHash("sha256").update(await io.readFile(file)).digest("hex");
}

/** 대상 폴더 파일 목록과 SHA-256(25MB 이하). 원문 버전 기록과 실행 전후 비교에 쓴다. */
export async function buildSourceManifest(io, root) {
  const files = await walkFiles(io, root, { limit: maxManifestFiles });
  const entries = [];
  for (const file of files) {
    let sha256 = "";
    if (file.size <= maxManifestFileBytes) { try { sha256 = await sha256File(io, path.join(root, ...file.path.split("/"))); } catch { sha256 = ""; } }
    entries.push({ ...file, sha256 });
  }
  return { root, entries, truncated: files.length >= maxManifestFiles };
}

function manifestMarkdown(manifest) {
  return [
    "# 대상 폴더 파일 목록(실행 전, 모디크루 실행기가 만듦)", "",
    "- 폴더: " + manifest.root,
    "- 파일 수: " + manifest.entries.length + (manifest.truncated ? " (" + maxManifestFiles + "개에서 멈춤)" : ""),
    "", "| 파일 | 크기 | 수정 시각 | SHA-256 앞 12자리 |", "|---|---|---|---|",
    ...manifest.entries.map((entry) => "| " + entry.path + " | " + entry.size + " | " + new Date(entry.mtimeMs).toISOString() + " | " + (entry.sha256 ? entry.sha256.slice(0, 12) : "미측정(25MB 초과)") + " |"),
  ].join("\n") + "\n";
}

/** 실행 전후 비교. 내용 해시가 있으면 해시로, 없으면 크기·수정 시각으로 본다. */
export function diffManifests(before, after) {
  const prior = new Map((before?.entries ?? []).map((entry) => [entry.path, entry]));
  const changed = [];
  for (const entry of after?.entries ?? []) {
    const old = prior.get(entry.path);
    if (!old) changed.push({ path: entry.path, change: "생성" });
    else if (old.sha256 && entry.sha256 ? old.sha256 !== entry.sha256 : (old.size !== entry.size || old.mtimeMs !== entry.mtimeMs)) changed.push({ path: entry.path, change: "수정" });
    prior.delete(entry.path);
  }
  for (const entry of prior.values()) changed.push({ path: entry.path, change: "삭제" });
  return changed.slice(0, maxListedFiles);
}

/** output/plan.json 판정. 형식이 틀리거나 없으면 큰 변경으로 보고 설계 확인을 받는다(안전한 쪽). */
export async function readDevPlan(io, outputDir) {
  let raw;
  try { raw = await io.readFile(path.join(outputDir, "plan.json"), "utf8"); } catch { return { ok: false, large: true, reasons: ["plan.json 을 만들지 않았습니다"], plan: { size: "large", files: [], summary: "" } }; }
  let data;
  try { data = JSON.parse(String(raw).replace(/^\uFEFF/u, "")); } catch { return { ok: false, large: true, reasons: ["plan.json 형식을 읽지 못했습니다"], plan: { size: "large", files: [], summary: "" } }; }
  const files = (Array.isArray(data?.files) ? data.files : []).filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim().replaceAll("\\", "/").replace(/^\.\//u, "")).slice(0, 200);
  const flags = [["publicApiChange", "공개 API 변경"], ["dataModelChange", "데이터 구조 변경"], ["authOrPaymentChange", "인증·결제 변경"]].filter(([key]) => data?.[key] === true).map(([, label]) => label);
  const reasons = [...(data?.size !== "small" ? ["실행기 판정: " + (data?.size === "large" ? "큰 변경" : "판정 없음")] : []), ...(files.length > 3 ? ["바꿀 파일 " + files.length + "개"] : []), ...flags];
  return { ok: true, large: reasons.length > 0, reasons, plan: { size: reasons.length ? "large" : "small", files, summary: clip(data?.summary, 400), recommendation: clip(data?.recommendation, 200), checks: (Array.isArray(data?.checks) ? data.checks : []).map((item) => clip(item, 200)).slice(0, 10) } };
}

/**
 * 계획 파일 목록이 바뀐 파일을 덮는지. 실행기가 쓴 경로 표기가 달라도 같은 파일로 본다:
 * 대상 폴더 안의 절대 경로는 상대 경로로, 역슬래시·'./' 는 정리하고, Windows 에서는 대소문자를 가리지 않으며, '/'·'/**' 로 끝나면 폴더로 본다.
 */
export function planCovers(planFiles, filePath, root = "", platform = process.platform) {
  const fold = (value) => (platform === "win32" ? value.toLowerCase() : value);
  const normalize = (value) => {
    let text = String(value ?? "").trim().replaceAll("\\", "/");
    if (root && path.isAbsolute(text)) {
      const relative = path.relative(root, text).replaceAll("\\", "/");
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) text = relative;
    }
    return fold(text.replace(/^\.\//u, "").replace(/\*\*$/u, ""));
  };
  const wanted = normalize(filePath);
  return (planFiles ?? []).some((entry) => { const item = normalize(entry); return Boolean(item) && (item === wanted || (item.endsWith("/") && wanted.startsWith(item))); });
}

/** 분석 대상 파일을 실행 폴더로 복사한다(원본은 열기만 한다). */
async function copyTargetFile(io, source, destDir) {
  const info = await io.stat(source);
  if (!info.isFile()) throw new Error("분석할 파일을 골라 주세요.");
  if (info.size > maxTargetCopyBytes) throw new Error("분석 대상이 너무 큽니다(1GB 초과).");
  await io.mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(source));
  await io.copyFile(source, dest);
  return { path: dest, size: info.size, sha256: await sha256File(io, dest) };
}

/** ~/.codex/config.toml 의 [mcp_servers.<id>] 와 [mcp_servers.<id>.env] 만 읽는다(문자열·문자열 배열만). */
export function parseCodexMcpServer(configText, id) {
  if (!mcpIdPattern.test(id)) return null;
  const unquote = (raw) => {
    const value = raw.trim();
    if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
    if (value.startsWith('"') && value.endsWith('"')) { try { return JSON.parse(value); } catch { return null; } }
    return null;
  };
  const server = { command: "", args: [], env: {} };
  let section = "";
  for (const line of String(configText ?? "").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const header = trimmed.match(/^\[([^\]]+)\]$/u);
    if (header) { section = header[1].trim(); continue; }
    const pair = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/u);
    if (!pair) continue;
    if (section === "mcp_servers." + id) {
      if (pair[1] === "command") server.command = unquote(pair[2]) ?? "";
      if (pair[1] === "args") {
        const inner = pair[2].trim().match(/^\[(.*)\]$/u)?.[1] ?? "";
        server.args = (inner.match(/'[^']*'|"(?:[^"\\]|\\.)*"/gu) ?? []).map(unquote).filter((value) => typeof value === "string");
      }
    } else if (section === "mcp_servers." + id + ".env" && envNamePattern.test(pair[1])) {
      const value = unquote(pair[2]);
      if (typeof value === "string") server.env[pair[1]] = value;
    }
  }
  return server.command ? server : null;
}

/** 이 PC에 등록된 MCP 서버(예: REA)를 찾는다. 실행 파일이 없으면 연결 없음으로 본다. */
export async function resolveMcpServer(id, { io = fs, home = os.homedir(), codexHome = process.env.CODEX_HOME } = {}) {
  let text;
  try { text = await io.readFile(path.join(codexHome || path.join(home, ".codex"), "config.toml"), "utf8"); } catch { return null; }
  const server = parseCodexMcpServer(text, id);
  return server && existsSync(server.command) ? server : null;
}

// ── 보안 점검 보고 ────────────────────────────────────────────────────────────
const auditStatuses = new Set(["confirmed", "needs_validation", "rejected"]);
const auditSeverities = new Set(["critical", "high", "medium", "low", "informational"]);
const auditFence = "\u0060\u0060\u0060";

/** 마지막 응답에서 json 코드 블록(마지막 것)을 꺼낸다. */
export function extractJsonBlock(text) {
  const source = String(text ?? "");
  const blocks = [...source.matchAll(new RegExp(auditFence + "json\\s*([\\s\\S]*?)" + auditFence, "gu"))];
  for (const block of blocks.reverse()) {
    try { return JSON.parse(block[1]); } catch { /* 다음 후보 */ }
  }
  const start = source.lastIndexOf("\n{");
  if (start >= 0) { try { return JSON.parse(source.slice(start + 1)); } catch { /* 형식 없음 */ } }
  return null;
}

async function checkEvidence(io, root, item) {
  const rel = String(item?.file ?? "").trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  const line = Number(item?.line);
  const base = { file: rel, ...(Number.isInteger(line) && line > 0 ? { line } : {}) };
  if (!rel || path.isAbsolute(rel) || /^[A-Za-z]:/u.test(rel) || rel.split("/").includes("..")) return { ...base, exists: false, reason: "대상 폴더 밖이거나 잘못된 경로" };
  const full = path.join(root, ...rel.split("/"));
  let info;
  try { info = await io.stat(full); } catch { return { ...base, exists: false, reason: "파일 없음" }; }
  if (!info.isFile()) return { ...base, exists: false, reason: "파일이 아님" };
  if (base.line && info.size <= 5 * 1024 * 1024) {
    const lines = String(await io.readFile(full, "utf8")).split(/\r?\n/u).length;
    if (base.line > lines) return { ...base, exists: false, reason: "줄 번호가 파일 길이(" + lines + "줄)를 넘음" };
  }
  return { ...base, exists: true };
}

/**
 * 점검 보고 검사(앱 로직). 판정·필수 항목을 확인하고, 근거 파일·줄이 대상 폴더에 실제로 있는지 본다.
 * 근거가 없거나 필수 항목이 빠진 confirmed 는 needs_validation 으로 낮추고 이유를 남긴다.
 */
export async function validateAuditReport(raw, { io = fs, root }) {
  const text = (value, max = 2000) => clip(value, max);
  const notes = [];
  const findings = [];
  const list = Array.isArray(raw?.findings) ? raw.findings.slice(0, 200) : [];
  if (!Array.isArray(raw?.findings)) notes.push("findings 목록이 없어 판정 0건으로 기록했습니다.");
  for (const [index, item] of list.entries()) {
    const id = text(item?.id, 40) || "F" + (index + 1);
    const evidence = [];
    for (const entry of (Array.isArray(item?.evidence) ? item.evidence : []).slice(0, 20)) evidence.push(await checkEvidence(io, root, entry));
    const valid = evidence.filter((entry) => entry.exists);
    let status = auditStatuses.has(item?.status) ? item.status : "needs_validation";
    const findingNotes = [];
    if (!auditStatuses.has(item?.status)) findingNotes.push("판정 값이 없거나 잘못돼 needs_validation 으로 두었습니다.");
    for (const entry of evidence) if (!entry.exists) findingNotes.push("근거 확인 실패: " + (entry.file || "(경로 없음)") + " — " + entry.reason);
    if (status === "confirmed") {
      const missing = ["reproduction", "impact", "verification", "recommendation"].filter((key) => !text(item?.[key]));
      if (!auditSeverities.has(item?.severity)) missing.push("severity");
      if (!valid.length) missing.push("확인된 근거 위치");
      if (missing.length) { status = "needs_validation"; findingNotes.push("confirmed 필수 항목 부족(" + missing.join(", ") + ")으로 needs_validation 으로 낮췄습니다."); }
    }
    if (status === "rejected" && !text(item?.rejectionReason)) { status = "needs_validation"; findingNotes.push("반박 근거가 없어 needs_validation 으로 두었습니다."); }
    const finding = {
      id, title: text(item?.title, 200) || "(제목 없음)", status, declaredStatus: auditStatuses.has(item?.status) ? item.status : "",
      ...(status === "confirmed" ? { severity: item.severity, confidence: text(item?.confidence, 20) } : {}),
      evidence, trace: text(item?.trace), reproduction: text(item?.reproduction), impact: text(item?.impact),
      verification: text(item?.verification), recommendation: text(item?.recommendation), limits: text(item?.limits),
      blockers: text(item?.blockers), rejectionReason: text(item?.rejectionReason), appNotes: findingNotes,
    };
    findings.push(finding);
  }
  const counts = { confirmed: 0, needs_validation: 0, rejected: 0, downgraded: findings.filter((item) => item.declaredStatus && item.declaredStatus !== item.status).length };
  for (const item of findings) counts[item.status] += 1;
  const strings = (value) => (Array.isArray(value) ? value : []).map((item) => text(item, 400)).filter(Boolean).slice(0, 60);
  return {
    report: {
      scope: { target: text(raw?.scope?.target, 200), checked: strings(raw?.scope?.checked), notChecked: strings(raw?.scope?.notChecked) },
      architecture: text(raw?.architecture, 4000), findings, hardening: strings(raw?.hardening),
    },
    counts, notes,
  };
}

/** 앱이 쓰는 보고서. 판정별 표·검사하지 못한 범위·실행 조건·한계를 고정 순서로 둔다. */
export function renderAuditReport(validated, meta) {
  const { report, counts, notes } = validated;
  const cell = (value) => String(value ?? "").replace(/\|/gu, "/").replace(/\s+/gu, " ").trim() || "—";
  const where = (item) => item.evidence.filter((entry) => entry.exists).map((entry) => entry.file + (entry.line ? ":" + entry.line : "")).join(", ") || "근거 확인 안 됨";
  const byStatus = (status) => report.findings.filter((item) => item.status === status);
  const lines = [
    "# 보안 점검 결과", "",
    "- 대상: " + meta.target,
    "- 실행기: " + meta.runtimeLabel + " · 실행 조건: " + meta.conditions,
    "- 판정: confirmed " + counts.confirmed + " · needs_validation " + counts.needs_validation + " · rejected " + counts.rejected + (counts.downgraded ? " (앱 근거 검사로 낮춘 항목 " + counts.downgraded + ")" : ""),
    "- 시작: " + meta.startedAt + " · 종료: " + meta.finishedAt,
    "", "> 한 번의 읽기 전용 점검 결과입니다. 앱 전체가 안전하다는 뜻이 아니며, 실행해야 확인되는 항목은 needs_validation 으로 남겼습니다.",
    "", "## 구조·신뢰 경계", "", report.architecture || "실행기가 요약을 남기지 않았습니다.",
    "", "## confirmed", "",
    ...(byStatus("confirmed").length ? ["| ID | 제목 | 심각도 | 근거 | 영향 | 권장 수정 |", "|---|---|---|---|---|---|", ...byStatus("confirmed").map((item) => "| " + [item.id, item.title, item.severity, where(item), item.impact, item.recommendation].map(cell).join(" | ") + " |")] : ["없음"]),
    ...byStatus("confirmed").flatMap((item) => ["", "### " + item.id + " " + item.title, "", "- 진입점→위험 지점: " + (item.trace || "—"), "- 재현 조건: " + item.reproduction, "- 검증 방법: " + item.verification, "- 검증 한계: " + (item.limits || "—")]),
    "", "## needs_validation", "",
    ...(byStatus("needs_validation").length ? ["| ID | 제목 | 근거 | 막는 요인 | 검증 계획 | 앱 검사 메모 |", "|---|---|---|---|---|---|", ...byStatus("needs_validation").map((item) => "| " + [item.id, item.title, where(item), item.blockers || item.limits, item.verification, item.appNotes.join(" ")].map(cell).join(" | ") + " |")] : ["없음"]),
    "", "## rejected", "",
    ...(byStatus("rejected").length ? ["| ID | 제목 | 반박 근거 |", "|---|---|---|", ...byStatus("rejected").map((item) => "| " + [item.id, item.title, item.rejectionReason].map(cell).join(" | ") + " |")] : ["없음"]),
    "", "## 검사한 범위", "", ...(report.scope.checked.length ? report.scope.checked.map((item) => "- " + item) : ["- 실행기가 범위를 남기지 않았습니다."]),
    "", "## 검사하지 못한 범위", "", ...(report.scope.notChecked.length ? report.scope.notChecked.map((item) => "- " + item) : ["- 실행기가 남기지 않았습니다(검사하지 못한 범위가 없다는 뜻은 아닙니다)."]),
    "", "## 강화 메모", "", ...(report.hardening.length ? report.hardening.map((item) => "- " + item) : ["없음"]),
    ...(notes.length ? ["", "## 앱 검사 기록", "", ...notes.map((item) => "- " + item)] : []),
  ];
  return lines.join("\n") + "\n";
}

function shuffledLabels(count, seed) {
  const order = Array.from({ length: count }, (_, index) => index);
  let state = parseInt(digest(seed).slice(0, 8), 16) || 1;
  for (let i = order.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// ── 프롬프트 ──────────────────────────────────────────────────────────────────
export function buildAgentPrompt({ skillLabel, skillFile, companions = [], missingCompanions = [], requestFile, request, workDir, outputDir, target, runtimeLabel, phase = "", manifestFile = "", extra = [] }) {
  return [
    "[모디크루 크루 스킬 실행]",
    "모디크루 앱 사용자가 요청하고 앱이 실행을 허락한 작업입니다. 실행기: " + runtimeLabel + ". 스킬: " + skillLabel + ".",
    "1. 먼저 스킬 지침 파일을 끝까지 읽고 그 절차와 결과물 형식을 따르세요: " + skillFile,
    companions.length ? "2. 함께 쓰는 설치 스킬(해당 단계 전에 먼저 읽기): " + companions.map((item) => item.name + " → " + item.file).join(" / ") : "2. 함께 쓰는 설치 스킬: 없음",
    missingCompanions.length ? "   이 PC에 없는 스킬: " + missingCompanions.join(", ") + " — 결과에 없다고 적고 스킬 지침만으로 진행하세요." : "",
    "3. 요청 원문 파일: " + requestFile + " (아래에도 그대로 붙였습니다)",
    "4. 작업 폴더: " + workDir + ". 결과 파일은 " + outputDir + " 아래에만 만드세요.",
    target
      ? "5. 대상 폴더: " + target.folder + " · 권한: " + (target.access === "write" ? "수정 허용 — 요청 범위 안에서만 수정하고, 바꾼 파일을 모두 보고하세요." : "읽기 전용 — 이 폴더의 파일을 만들거나 바꾸거나 지우지 마세요.")
      : "5. 대상 폴더: 지정 없음(작업 폴더 안에서만 작업)",
    manifestFile ? "   대상 폴더 파일 목록·SHA-256(실행 전): " + manifestFile : "",
    phase === "plan" ? "   이번 실행은 계획 단계입니다(PHASE.md). 대상 폴더를 고치지 말고 output/plan.json 과 output/plan.md 만 만든 뒤 멈추세요." : "",
    phase === "implement" ? "   이번 실행은 구현 단계입니다(PHASE.md). APPROVED-PLAN.md 의 계획대로 구현하고, 계획 밖 파일을 바꿔야 하면 바꾸지 말고 보고하세요." : "",
    ...extra,
    "6. 패키지 설치·네트워크 다운로드·배포·푸시·발송·게시·결제·삭제는 실행하지 말고 결과에 '승인 필요'로 남기세요. 비밀값을 파일이나 응답에 쓰지 마세요.",
    "   이 PC의 다른 프로그램·실행 중인 앱·브라우저 디버깅 포트·localhost 서비스에 연결하거나 조작하지 마세요. 화면 확인이 필요하면 작업 폴더의 파일만 쓰고, 확인하지 못한 것은 결과에 적으세요.",
    "7. 마지막 응답은 한국어로: 한 줄 결론 / 만든·바꾼 파일 목록 / 실제로 확인한 것과 확인하지 못한 것 / 사용자 승인 필요 항목.",
    "<user_request>",
    request,
    "</user_request>",
  ].filter(Boolean).join("\n");
}

function buildInstructionPrompt({ skillLabel, body, request }) {
  return [
    "[모디크루 크루 스킬 · 지침형]",
    "사용자가 승인한 크루 스킬 지침을 다음 요청에 적용해 한국어 결과를 작성하세요. 외부 조회·파일 수정·발송을 실행했다고 주장하지 마세요. 필요한 자료가 없으면 '확인 필요'로 표시하세요.",
    "스킬: " + skillLabel,
    "<skill_instructions>", body.slice(0, 24_000), "</skill_instructions>",
    "<user_request>", request, "</user_request>",
  ].join("\n");
}

function councilStagePrompt(stage, { body, request, answers = [], reviews = [], participants = "" }) {
  const guide = String(body ?? "").slice(0, 6_000);
  if (stage === 1) {
    return ["[모디크루 심층 검토 · 1단계 독립 답변]", "심층 검토에 참여한 AI 가운데 하나입니다. 다른 AI의 답은 보지 않은 상태로 독립적으로 답하세요.", "<review_guide>", guide, "</review_guide>", "<question>", request, "</question>", "답변 형식: 1) 결론 2) 근거(확인 사실·추정 구분) 3) 위험과 반례 4) 확인 방법·필요한 증거. 한국어로 쓰고 외부 실행을 했다고 주장하지 마세요."].join("\n");
  }
  if (stage === 2) {
    return ["[모디크루 심층 검토 · 2단계 익명 교차 검토]", "같은 질문에 대한 답변들입니다. 작성자를 가렸습니다. 자신의 답이 섞여 있을 수 있지만 같은 기준으로 평가하세요.", "<question>", request, "</question>", ...answers.map((item) => "<answer label=\"" + item.label + "\">\n" + item.text + "\n</answer>"), "답변마다 사실 오류, 빠진 위험, 근거 강도, 실행 가능성을 평가하고, 마지막에 믿을 만한 순서와 이유를 쓰세요. 한국어로 씁니다."].join("\n");
  }
  return [
    "[모디크루 심층 검토 · 3단계 의장 종합]",
    "아래 독립 답변과 익명 교차 검토를 근거로 최종안을 쓰세요. 다수결로 정하지 말고 근거와 증거로 판단하세요. 의견 차이는 지우지 말고 '남은 이견'에 어느 답변이 무엇을 왜 주장했는지 남기세요.",
    "참여: " + participants,
    "<question>", request, "</question>",
    ...answers.map((item) => "<answer label=\"" + item.label + "\">\n" + item.text + "\n</answer>"),
    ...reviews.map((item) => "<review by=\"검토자 " + item.label + "\">\n" + item.text + "\n</review>"),
    "결과 형식(제목 그대로): ## 질문 요약 / ## 답변 요지 비교표 / ## 익명 교차 검토 요지 / ## 합의된 점 / ## 남은 이견 / ## 최종안 / ## 확인 필요·다음 검증. 한국어로 씁니다.",
  ].join("\n");
}

// ── 실행기 ────────────────────────────────────────────────────────────────────
const officeActivityByCategory = Object.freeze({ development: "problem_solving", design: "drafting", security: "analyzing", documents: "reading", content: "drafting", reverse_engineering: "analyzing", research: "analyzing" });

/** 앱 종료 때 남은 기록을 바로 남긴다(비동기 작업이 돌 시간이 없을 수 있어 동기 저장). */
function writeJsonSync(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  const pending = file + "." + process.pid + "." + Date.now() + ".pending";
  writeFileSync(pending, JSON.stringify(data, null, 2), "utf8");
  renameSync(pending, file);
}

export function createCrewSkillRuntime(options = {}) {
  const io = options.io ?? fs;
  const stateRoot = options.stateRoot;
  // 앱 사용자 데이터 폴더(crew-skill-runs 의 부모). PC 작업 기록(desktop-app-control)도 같은 폴더에 있다.
  const userDataRoot = options.userDataRoot ?? (stateRoot ? path.dirname(stateRoot) : "");
  if (!stateRoot) throw new Error("크루 스킬 실행 기록 위치가 필요합니다.");
  const libraryRoot = options.libraryRoot ?? defaultCrewSkillLibraryRoot;
  const catalogPath = options.catalogPath ?? path.join(path.dirname(libraryRoot), "catalog.json");
  const installedRoots = options.installedRoots ?? defaultInstalledSkillRoots();
  const adapters = options.adapters ?? [createCodexAdapter(options), createClaudeAdapter(options)];
  const confirm = options.confirm ?? electronConfirm;
  // 결과 파일만 만드는 실행은 앱이 실행기를 골라 확인 창 없이 시작한다(main.mjs 가 decideCrewSkillAutoApproval 을 넘긴다).
  // null 을 돌려주거나 판단 중 오류가 나면 지금처럼 확인 창을 띄운다.
  const autoApprove = typeof options.autoApprove === "function" ? options.autoApprove : null;
  const confirmInstall = options.confirmInstall ?? electronConfirmInstall;
  const notify = options.notify ?? electronNotify;

  // ── 승인함 연결 ─────────────────────────────────────────────────────────────
  // 사용자가 정해야 하는 크루 작업(설계 확인·결과 확인·실패)을 승인함 카드로도 올린다. 카드 id 는 '내 확인 필요'와 같은
  // crew-skill:<실행 id> 라서 채팅·내 확인 필요·승인함이 같은 기록을 본다. 설계 확인 카드를 승인함에서 승인하면 같은 계획으로
  // 구현을 이어 간다(쓰기 권한 확인 창은 그대로 뜨고, 계획은 한 번만 쓴다). 거절하면 계획을 취소한다.
  // 카드는 실행 기록(정본)에서만 다시 계산한다. 같은 실행의 기록 쓰기·카드 갱신·승인함 결정 확인은 한 줄로 세워(inRunQueue)
  // 늦게 끝난 옛 상태가 새 상태를 덮어쓰지 못하게 하고, 사용자가 승인함에서 고른 결정은 감시가 처리할 때까지 덮어쓰지 않는다.
  let inboxPromise;
  // 승인함 모듈을 처음 불러오는 동안 들어온 갱신도 같은 연결을 기다린다(그사이 온 갱신을 건너뛰어 옛 상태만 늦게 쓰이던 문제).
  const inboxApi = () => (inboxPromise ??= (async () => {
    if (options.inbox !== undefined) return options.inbox;
    if (options.loadInbox) { try { return (await options.loadInbox()) ?? null; } catch { return null; } }
    if (!process.versions?.electron) return null;
    try {
      const mod = await import("./inbox-handler.mjs");
      return { upsert: mod.upsertAutomationInboxItem, snapshot: mod.getAutomationInboxSnapshot };
    } catch { return null; }
  })());
  const planWatch = new Map();
  const planInFlight = new Set();
  let planTimer = null;
  const crewCardId = (runId) => "crew-skill:" + runId;
  const cardWorthy = (record) => ["needs_input", "failed", "disconnected"].includes(record?.workStatus);
  const waitingForDesign = (record) => Boolean(record) && !record.consumedBy && record.workStatus === "needs_input" && record.workReason === "design_review";
  // 사용자가 승인함에서 고른 결정. 설계 확인을 기다리는 카드에 이 값이 있으면 감시가 처리할 때까지 그대로 둔다.
  const cardDecisions = new Set(["completed", "rejected", "held", "change_requested"]);
  const cardIn = (inbox, id) => { try { return (inbox.snapshot?.() ?? []).find((card) => card.id === id) ?? null; } catch { return null; } };

  const runQueues = new Map();
  /** 같은 실행의 기록 쓰기·카드 갱신·결정 확인을 들어온 순서대로 하나씩 한다. 앞 작업이 실패해도 다음 작업은 돈다. */
  function inRunQueue(scope, runId, task) {
    const key = scope + ":" + runId;
    const current = (runQueues.get(key) ?? Promise.resolve()).then(task);
    const settled = current.then(() => undefined, () => undefined);
    runQueues.set(key, settled);
    void settled.then(() => { if (runQueues.get(key) === settled) runQueues.delete(key); });
    return current;
  }
  // 카드 갱신은 승인함 연결이 준비된 뒤에 줄을 선다. 줄 안에서 연결을 기다리면 같은 실행의 기록 쓰기까지 묶이기 때문이다.
  // 늦게 줄을 서도 카드는 그때의 최신 기록으로 다시 계산하므로 결과는 같다.
  const cardSchedules = new Set();
  function scheduleCard(scope, runId) {
    const scheduled = inboxApi()
      .then((inbox) => (typeof inbox?.upsert === "function" ? inRunQueue(scope, runId, () => syncCardNow(scope, runId)) : undefined))
      .catch(() => undefined);
    cardSchedules.add(scheduled);
    void scheduled.finally(() => cardSchedules.delete(scheduled));
  }
  async function settleRunQueues() {
    for (let round = 0; round < 50 && (runQueues.size || cardSchedules.size); round += 1) await Promise.all([...runQueues.values(), ...cardSchedules]);
  }

  /** 실행 기록(정본) → 승인함 카드. 같은 기록이면 언제 다시 계산해도 같은 카드가 나온다. */
  function cardFromRecord(record, { consumer = null, keepStatus = "" } = {}) {
    const design = waitingForDesign(record);
    const statusMap = { needs_input: design ? "approval_pending" : "needs_review", failed: "needs_review", disconnected: "needs_review", completed: "completed", cancelled: "rejected", running: "pending", needs_approval: "pending", queued: "pending" };
    const plan = record.plan ?? null;
    const changed = Array.isArray(record.changedFiles) ? record.changedFiles : [];
    const label = (record.label || record.name) + (record.runtimeLabel ? " · " + record.runtimeLabel : "");
    // 설계를 넘긴 계획 카드는 이어 간 구현 실행 기록의 지금 상태를 함께 보여 준다.
    const handoff = consumer
      ? [(record.consumedVia === "inbox" ? "승인함 승인으로 구현 실행: " : "대화에서 확인해 구현 실행: ") + consumer.status, clip(consumer.userMessage, 200), consumer.resultPath ? "결과 문서: " + consumer.resultPath : ""].filter(Boolean).join(" · ")
      : "";
    const note = (design && record.inboxNote) || handoff;
    const body = [
      design ? "설계 확인: " + clip(plan?.summary || record.userMessage, 300) : clip(record.userMessage, 300),
      plan?.files?.length ? "바꿀 파일 " + plan.files.length + "개: " + plan.files.slice(0, 12).join(", ") : "",
      plan?.reasons?.length ? "큰 변경으로 본 이유: " + plan.reasons.slice(0, 4).join(", ") : "",
      record.target?.folder ? "대상 폴더: " + record.target.folder : "",
      !design && changed.length ? "대상 폴더에서 바뀐 파일 " + changed.length + "개(되돌리지 않음): " + listChanges(changed, 12) : "",
      design ? "승인하면 같은 계획으로 구현을 시작합니다. 쓰기 권한 확인 창이 한 번 더 뜨고, 계획 밖에서 바뀐 파일은 따로 표시합니다. 거절하면 구현하지 않습니다." : "",
      record.resultPath ? "결과 문서: " + record.resultPath : "",
      note,
    ].filter(Boolean).join(" · ");
    return {
      id: crewCardId(record.id), title: (design ? "설계 확인 · " : record.workReason === "unknown_outcome" ? "결과 확인 · " : "크루 작업 · ") + clip(label, 80),
      summary: clip([record.workStatusLabel, note || record.userMessage].filter(Boolean).join(" · "), 400),
      body, status: keepStatus || (statusMap[record.workStatus] ?? "needs_review"), riskLabel: design ? "high" : "medium",
      source: "messaging_command", sourceLabel: "크루 스킬", senderLabel: record.runtimeLabel || "크루 스킬 실행기",
      ...(record.teammateId ? { teammateId: record.teammateId } : {}),
      receivedAt: record.startedAt || record.updatedAt,
    };
  }

  /** 카드 한 장을 최신 실행 기록에서 다시 계산해 올린다. 같은 실행의 줄(inRunQueue) 안에서만 부른다. */
  async function syncCardNow(scope, runId, { reopen = false } = {}) {
    const inbox = await inboxApi();
    if (typeof inbox?.upsert !== "function") return;
    const raw = await readRecord(runFile(scope, runId)).catch(() => null);
    if (!raw?.inboxCard) return;
    const record = projectRecord(scope, raw);
    const design = waitingForDesign(record);
    // 설계 확인 카드에 사용자가 고른 결정(승인·거절·보류·수정 요청)은 감시가 처리할 때까지 그대로 둔다. 다시 묻기(reopen)만 되돌린다.
    const current = design && !reopen ? cardIn(inbox, crewCardId(runId)) : null;
    const keepStatus = current && cardDecisions.has(current.status) ? current.status : "";
    const consumer = uuidPattern.test(record.consumedBy || "") ? await readRecord(runFile(scope, record.consumedBy)).catch(() => null) : null;
    try {
      inbox.upsert(cardFromRecord(record, { consumer: consumer ? projectRecord(scope, consumer) : null, keepStatus }), { createdAt: record.updatedAt });
    } catch { /* 카드 저장 실패는 실행 기록·판단에 영향 없음(기록 파일이 정본) */ }
    if (design && options.watchInbox !== false) { planWatch.set(runId, { scope }); startPlanWatch(); }
  }

  /**
   * 앱을 다시 켠 뒤(또는 맞추기를 부를 때) 정본과 카드를 맞춘다. 사용자가 카드에 고른 결정은 덮어쓰지 않는다.
   *   - 앱 종료·비정상 종료로 카드를 만들지 못한 '연결 끊김' 실행은 카드를 한 번 만들고 기록에 표시한다.
   *   - 설계 확인을 기다리는 계획은 승인함 감시를 다시 건다(앱이 꺼진 사이 승인한 카드도 이어받는다).
   *   - 계획을 넘기거나 거절했는데 카드가 아직 승인 대기면(카드 갱신 전에 앱이 꺼짐) 정본대로 고친다.
   */
  async function reconcileCardNow(scope, runId, card) {
    const inbox = await inboxApi();
    if (typeof inbox?.upsert !== "function") return;
    const raw = await readRecord(runFile(scope, runId)).catch(() => null);
    if (!raw) return;
    const record = projectRecord(scope, raw);
    if (!raw.inboxCard) {
      if (!cardWorthy(record) || !(record.status === "interrupted" || raw.interruptedBy === "app_quit")) return;
      if (!card) { try { inbox.upsert(cardFromRecord(record), { createdAt: record.updatedAt || now().toISOString() }); } catch { return; } }
      await atomicWriteJson(io, runFile(scope, runId), { ...raw, inboxCard: true });
      return;
    }
    if (waitingForDesign(record)) { if (options.watchInbox !== false) planWatch.set(runId, { scope }); return; }
    if (card?.status === "approval_pending") await syncCardNow(scope, runId);
  }

  async function reconcileInbox() {
    const inbox = await inboxApi();
    if (typeof inbox?.upsert !== "function") return;
    let cards = [];
    try { cards = inbox.snapshot?.() ?? []; } catch { cards = []; }
    const byId = new Map(cards.map((card) => [card.id, card]));
    const { records } = await listRunRecords({ limit: 600 });
    const targets = records.filter(({ record }) => record.inboxCard || ((record.status === "interrupted" || record.interruptedBy === "app_quit") && cardWorthy(record)));
    await Promise.all(targets.map(({ scope, record }) => inRunQueue(scope, record.id, () => reconcileCardNow(scope, record.id, byId.get(crewCardId(record.id)) ?? null)).catch(() => undefined)));
    if (planWatch.size) startPlanWatch();
  }

  function startPlanWatch() {
    if (planTimer || options.watchInbox === false) return;
    planTimer = setInterval(() => { void watchPlanCards(); }, options.inboxWatchMs ?? 3_000);
    planTimer.unref?.();
  }

  /** 승인함에서 설계 확인 카드를 승인(completed)·거절(rejected)했는지 읽는다. 보류·수정 요청은 그대로 기다린다. */
  async function watchPlanCards() {
    if (!planWatch.size) { if (planTimer) clearInterval(planTimer); planTimer = null; return; }
    const inbox = await inboxApi();
    if (typeof inbox?.snapshot !== "function") return;
    let cards = [];
    try { cards = inbox.snapshot(); } catch { return; }
    const byId = new Map(cards.map((card) => [card.id, card]));
    const started = [];
    for (const [runId, info] of [...planWatch]) {
      // 이미 처리 중인 승인은 건너뛴다(감시 주기가 겹치거나 다시 맞추기가 같은 계획을 감시 목록에 다시 넣어도 한 번만 처리).
      if (planInFlight.has(runId)) continue;
      const card = byId.get(crewCardId(runId));
      if (!card || card.status === "approval_pending" || card.status === "held" || card.status === "change_requested") continue;
      planWatch.delete(runId);
      if (card.status !== "completed" && card.status !== "rejected") continue;
      planInFlight.add(runId);
      started.push(decidePlan(info.scope, runId, card.status).catch(() => undefined).finally(() => planInFlight.delete(runId)));
    }
    await Promise.all(started);
  }

  /**
   * 승인함 결정 처리. 결정은 그 계획 기록의 줄 안에서 최신 기록으로 다시 확인한다 — 대화에서 먼저 구현으로 넘겼거나
   * 이미 취소된 계획이면 결정을 쓰지 않고 카드를 정본대로 고친다. 구현(쓰기 확인 창·실행)은 오래 걸리므로 줄 밖에서 한다.
   */
  async function decidePlan(scope, runId, decision) {
    const domain = await loadDomain();
    const plan = await inRunQueue(scope, runId, async () => {
      const record = await readRecord(runFile(scope, runId)).catch(() => null);
      if (!waitingForDesign(record)) { await syncCardNow(scope, runId); return null; }
      // 감시가 승인함을 읽은 뒤 사용자가 결정을 바꿨을 수 있어 카드의 지금 결정을 다시 본다. 보류·수정 요청·승인 대기면 계속 기다린다.
      const latestDecision = cardIn(await inboxApi(), crewCardId(runId))?.status ?? decision;
      if (latestDecision !== "completed" && latestDecision !== "rejected") { if (options.watchInbox !== false) planWatch.set(runId, { scope }); return null; }
      if (latestDecision === "rejected") {
        await atomicWriteJson(io, runFile(scope, runId), stampRecord(domain, { ...record, status: "cancelled", inboxNote: undefined, userMessage: "승인함에서 설계를 거절했습니다. 구현하지 않았습니다." }, { status: "cancelled" }));
        await syncCardNow(scope, runId);
        return null;
      }
      return record;
    });
    if (!plan) return;
    const note = await continueApprovedPlan(plan);
    await inRunQueue(scope, runId, async () => {
      const latest = await readRecord(runFile(scope, runId)).catch(() => null);
      if (waitingForDesign(latest)) {
        // 구현을 시작하지 못했다(저장 위치가 다름·확인 창 취소·같은 대화의 다른 실행). 계획은 그대로 두고 다시 승인할 수 있게 카드를 되돌린다.
        await atomicWriteJson(io, runFile(scope, runId), { ...latest, inboxNote: note, updatedAt: now().toISOString() });
        await syncCardNow(scope, runId, { reopen: true });
      } else await syncCardNow(scope, runId);
    });
  }

  /** 승인함에서 승인한 설계로 구현을 시작한다. 시작했는지는 계획 기록을 넘겼는지(정본)로 판단하고, 여기서는 못 했을 때 남길 이유를 돌려준다. */
  async function continueApprovedPlan(record) {
    let root = "";
    try { root = options.getWorkspaceRoot ? await options.getWorkspaceRoot() : ""; } catch { root = ""; }
    if (!root || rootKeyOf(root) !== record.rootKey) {
      return "지금 앱의 저장 위치(회사)가 계획을 만든 곳과 달라 구현을 시작하지 않았습니다. 그 저장 위치로 돌아가 다시 승인하거나 대화에서 '이대로 구현'이라고 답해 주세요.";
    }
    const response = await handle({
      kind: "run", runId: randomUUID(), name: record.name, request: record.request || "승인함에서 승인한 설계대로 구현해 주세요.",
      workspaceRoot: root, teammateId: record.teammateId ?? "", ...(record.threadId ? { threadId: record.threadId } : {}), approvedPlanRunId: record.id, via: "inbox",
    });
    return "승인함에서 승인했지만 구현을 시작하지 않았습니다(" + clip(response?.userMessage, 160) + "). 다시 승인하면 확인 창이 다시 뜹니다.";
  }

  const now = options.now ?? (() => new Date());
  // 실행기 선택·Claude 명령 도구 판단에 쓰는 OS(시험에서 바꿀 수 있다).
  const platform = options.platform ?? process.platform;
  const resolveMcp = options.resolveMcpServer ?? ((id) => resolveMcpServer(id));
  const auditLimits = { timeoutMs: options.auditTimeoutMs ?? 20 * 60_000, maxBytes: options.auditMaxBytes ?? 4 * 1024 ** 3 };
  const reverseLimits = { timeoutMs: options.reverseTimeoutMs ?? 30 * 60_000, maxBytes: options.reverseMaxBytes ?? 8 * 1024 ** 3 };
  const packageStore = options.packageStore ?? createCrewSkillPackageStore({ stateRoot: options.packagesRoot ?? path.join(path.dirname(stateRoot), "crew-skill-packages"), libraryRoot, catalogPath, io, now });
  const active = new Map();
  const scopeLocks = new Map();
  let domainPromise;
  let catalogPromise;

  // 정본은 두 파일(crew-skills.js·work-status.js)이다. 같은 위치에서 함께 읽어 화면과 같은 판정을 쓴다.
  const loadDomain = () => (domainPromise ??= (async () => {
    const dirs = [];
    if (options.domainEntryPath) dirs.push(path.dirname(options.domainEntryPath));
    if (process.resourcesPath) dirs.push(path.join(process.resourcesPath, "domain"));
    dirs.push(path.resolve(moduleDir, "..", "..", "..", "..", "packages", "domain", "dist"));
    const load = async (file) => { for (const dir of dirs) { const full = path.join(dir, file); if (existsSync(full)) return import(pathToFileURL(full).href); } return null; };
    const skills = options.domain ?? await load("crew-skills.js");
    if (!skills) throw new Error("크루 스킬 정본을 찾지 못했습니다. 앱을 다시 설치해 주세요.");
    const status = typeof skills.workStateFromCrewSkillRun === "function" ? skills : (options.workStatusDomain ?? await load("work-status.js"));
    if (!status) throw new Error("업무 상태 정본을 찾지 못했습니다. 앱을 다시 설치해 주세요.");
    return { ...status, ...skills };
  })());
  const loadCatalog = () => (catalogPromise ??= readBundledCatalog(catalogPath, { io }).catch((error) => { catalogPromise = undefined; throw error; }));
  const reviewedSourceVerifier = createReviewedSourceBundles({ manifestsRoot: options.sourceManifestsRoot ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "reviewed-source-manifests"), io });

  async function readSkillFile(file, fallbackName) {
    const info = await io.stat(file);
    if (info.size > maxSkillBytes) throw new Error("스킬 지침이 너무 큽니다.");
    return parseSkillDocument(await io.readFile(file, "utf8"), fallbackName);
  }

  async function findInstalled(name) {
    if (!skillNamePattern.test(name)) return null;
    for (const root of installedRoots) {
      const file = path.join(root.directory, name, "SKILL.md");
      if (existsSync(file)) return { name, file, dir: path.dirname(file), source: root.label };
    }
    return null;
  }

  /**
   * 이름 → 스킬. 기본 탑재는 동봉 폴더(카탈로그 해시 확인 뒤), 선택형은 확장으로 추가한 사본, 그 밖은 이 PC 설치 스킬.
   * 실행 방식·실행 조건(profile)은 정본 기준이고, 이 PC 설치 스킬은 일반 실제 실행형이다.
   */
  async function resolveSkill(name) {
    const clean = String(name ?? "").trim();
    if (!skillNamePattern.test(clean)) throw new Error("스킬 이름을 다시 선택해 주세요.");
    const domain = await loadDomain();
    const definition = domain.getCrewSkill(clean);
    if (definition?.availability === "optional") {
      const installed = await packageStore.resolveInstalled(clean);
      if (!installed.ok) throw Object.assign(new Error(installed.userMessage), { code: "NOT_INSTALLED", packageStatus: installed.status });
      const file = path.join(installed.dir, "SKILL.md");
      const doc = await readSkillFile(file, clean);
      return { origin: "extension", name: clean, label: definition.label, execution: definition.execution, profile: definition.profile, definition, doc, file, dir: installed.dir, source: "모디크루 확장 " + installed.version, version: installed.version, sha256: installed.sha256 };
    }
    const bundledFile = path.join(libraryRoot, clean, "SKILL.md");
    if (definition && existsSync(bundledFile)) {
      const integrity = await verifyBundledSkill(clean, { catalog: await loadCatalog(), libraryRoot, io });
      if (!integrity.ok) throw Object.assign(new Error(integrity.reason), { code: "INTEGRITY" });
      const doc = await readSkillFile(bundledFile, clean);
      return { origin: "bundled", name: clean, label: definition.label, execution: definition.execution, profile: definition.profile, definition, doc, file: bundledFile, dir: path.dirname(bundledFile), source: "모디크루 크루 스킬", version: definition.version, sha256: integrity.sha256 };
    }
    const installed = await findInstalled(clean);
    if (!installed) throw new Error("'" + clean + "' 스킬을 찾지 못했습니다. 스킬 목록을 새로고침해 주세요.");
    const reviewedReference = (await loadCatalog()).references?.find(reference => reference.installation?.type === "reviewed_source_bundle" && reference.installation.name === clean);
    const reviewed = reviewedReference ? await reviewedSourceVerifier.verify(reviewedReference, installed.dir) : null;
    const doc = await readSkillFile(installed.file, clean);
    return { reviewedReference, reviewedManifest: reviewed?.manifest, origin: "installed", name: clean, label: doc.name || clean, execution: "agent", profile: "standard", definition: null, doc, file: installed.file, dir: installed.dir, source: installed.source };
  }

  async function runtimeStatuses() {
    return Promise.all(adapters.map(async (adapter) => {
      try { return { id: adapter.id, label: adapter.label, ...(await adapter.status()) }; }
      catch (error) { return { id: adapter.id, label: adapter.label, installed: false, loggedIn: false, userMessage: String(error?.message ?? error) }; }
    }));
  }

  /** 저장 위치 확인. 화면이 보낸 위치가 지금 앱의 저장 위치와 다르면 거절한다(회사·저장소 혼입 방지). */
  async function rootFor(payload) {
    const root = clip(payload.workspaceRoot, 1000);
    if (options.getWorkspaceRoot) {
      const expected = await options.getWorkspaceRoot();
      if (!root || root !== expected) throw new Error("저장 위치가 바뀌었습니다. 현재 대화에서 다시 시도해 주세요.");
    }
    return root;
  }

  async function scopeFor(payload) {
    const root = await rootFor(payload);
    const owner = clip(payload.threadId, 240) || (clip(payload.teammateId, 120) ? "crew:" + clip(payload.teammateId, 120) : "");
    if (!owner) throw new Error("업무 대화나 직원을 먼저 선택해 주세요.");
    return digest(JSON.stringify([root, owner]));
  }
  const rootKeyOf = (root) => digest(JSON.stringify([root]));

  const runDir = (scope, runId) => path.join(stateRoot, scope, runId);
  const runFile = (scope, runId) => path.join(runDir(scope, runId), "run.json");
  const readRecord = async (file) => { try { return JSON.parse(await io.readFile(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };

  async function prepareSkillFiles({ skill, adapter, workDir }) {
    // 동봉 스킬은 두 실행기가 모두 찾는 프로젝트 위치(.agents/skills·.claude/skills)에 같은 파일로 둔다.
    const skillHome = adapter.id === "claude" ? path.join(workDir, ".claude", "skills") : path.join(workDir, ".agents", "skills");
    await copySkillFolder(io, skill.dir, path.join(skillHome, skill.name), skill.reviewedManifest?.files);
    if (skill.reviewedReference) await reviewedSourceVerifier.verify(skill.reviewedReference, path.join(skillHome, skill.name));
    const skillFile = path.join(skillHome, skill.name, "SKILL.md");
    const companions = [];
    const missingCompanions = [];
    for (const name of skill.definition?.companionSkills ?? []) {
      const found = await findInstalled(name);
      if (!found) { missingCompanions.push(name); continue; }
      if (adapter.id === "claude") {
        // Claude 는 Codex 쪽에만 설치된 스킬을 모르므로 작업 폴더의 프로젝트 스킬로 복사한다.
        try { await copySkillFolder(io, found.dir, path.join(skillHome, name)); companions.push({ name, file: path.join(skillHome, name, "SKILL.md") }); }
        catch { missingCompanions.push(name); }
      } else companions.push({ name, file: found.file });
    }
    return { skillFile, companions, missingCompanions };
  }

  // 변경이 남은 채 멈춘 실행: 정본의 '결과 확인 필요'(사람 확인 대기 · 결과 미확인)로 남겨 내 확인 필요·승인함에 올린다.
  // PC 작업의 '결과 확인 필요'와 같은 상태라 사무실 화면도 '확인 불가'가 아니라 사람 확인 대기로 보인다.
  const resultCheckState = Object.freeze({ status: "needs_input", reason: "unknown_outcome" });
  const resultCheckLabel = "결과 확인 필요";

  /** 기록에 업무 상태 정본(work-status) 값을 붙인다. 사무실·알림·확인 필요가 이 값을 읽는다. */
  function stampRecord(domain, record, state) {
    const work = state ?? domain.workStateFromCrewSkillRun({ status: record.status, userMessage: record.userMessage });
    const label = domain.workStatusLabel(work);
    const next = { ...record, workStatus: work.status, workStatusLabel: label, updatedAt: now().toISOString() };
    if (work.reason) next.workReason = work.reason; else delete next.workReason;
    return next;
  }

  /** 기록 저장. 상태 정본(work-status)으로 workStatus 를 함께 남긴다 — 사무실·알림·확인 필요가 이 값을 읽는다. */
  async function journal(scope, record, state) {
    const domain = await loadDomain();
    const next = stampRecord(domain, record, state);
    const context = active.get(scope + ":" + record.id);
    // 앱을 끄는 중이면 카드는 다음에 켤 때 만든다(꺼지기 전에 카드 갱신이 끝난다는 보장이 없다).
    if (record.inboxCard || (cardWorthy(next) && !context?.quitting)) next.inboxCard = true;
    if (context) { context.record = next; context.scope = scope; }
    const written = inRunQueue(scope, record.id, () => atomicWriteJson(io, runFile(scope, record.id), next));
    // 카드는 같은 줄에서 이 쓰기 바로 뒤에 최신 기록으로 다시 계산한다. 이어 간 구현이면 계획 카드도 함께 고친다.
    if (next.inboxCard) scheduleCard(scope, record.id);
    if (uuidPattern.test(next.approvedPlanRunId || "")) scheduleCard(scope, next.approvedPlanRunId);
    await written;
    return next;
  }

  /** 다른 실행·승인함이 기록을 고칠 때: 같은 줄에서 최신 기록을 다시 읽고 바꿀 수 있을 때만 바꾼다(change 가 null 을 돌려주면 그대로 둔다). */
  async function updateRecord(scope, runId, change) {
    const domain = await loadDomain();
    return inRunQueue(scope, runId, async () => {
      const latest = await readRecord(runFile(scope, runId));
      const decided = latest ? change(latest) : null;
      if (!decided) return null;
      const next = stampRecord(domain, decided.record, decided.state);
      if (latest.inboxCard || cardWorthy(next)) next.inboxCard = true;
      await atomicWriteJson(io, runFile(scope, runId), next);
      if (next.inboxCard) scheduleCard(scope, runId);
      return next;
    });
  }

  /**
   * 앱이 꺼지거나 연결이 끊긴 실행은 '연결 끊김'으로 보여 준다(저장된 원본은 그대로).
   * 이 기록을 실제로 쓰고 있는 실행(기록을 한 번 이상 남긴 context)이 있을 때만 '실행 중'으로 둔다 —
   * 재시작 뒤 같은 runId 를 다시 보내면 막 만든 context 는 있지만 이 기록을 쓰지 않았으므로 '실행 중'이 아니다.
   */
  function projectRecord(scope, record) {
    if (["running", "result_ready"].includes(record.status) && !active.get(scope + ":" + record.id)?.record) {
      return { ...record, status: "interrupted", workStatus: "disconnected", workReason: "unknown_outcome", workStatusLabel: "연결 끊김", userMessage: "앱이 종료되어 결과 확인이 필요합니다. 자동으로 다시 실행하지 않았습니다." };
    }
    return record;
  }

  async function workSignal(record, skillLike) {
    const domain = await loadDomain();
    const state = domain.workStateFromCrewSkillRun(record);
    const category = skillLike?.category ?? domain.getCrewSkill(record?.name)?.category;
    const label = domain.workStatusLabel(state);
    return { workStatus: state.status, ...(state.reason ? { workReason: state.reason } : {}), workStatusLabel: label, officeSignal: domain.officeSignalForWorkState(state, officeActivityByCategory[category] ?? "drafting") };
  }

  function composeReport({ skill, record, finalText, outputFiles = [], changedFiles = [], stages = [], outsidePlan = [], secretHits = [], memory = null }) {
    const lines = ["# " + skill.label + " 실행 결과", "",
      "- 스킬: " + skill.name + " (" + skill.source + (skill.version ? " · " + skill.version : "") + ")",
      "- 실행 방식: " + record.executionLabel,
      "- 실행기: " + record.runtimeLabel,
      record.scripts?.note ? "- 명령 실행: " + record.scripts.note : "",
      record.participants ? "- 참여: " + record.participants : "",
      "- 시작: " + record.startedAt + " · 종료: " + (record.finishedAt ?? ""),
      record.workDir ? "- 작업 폴더: " + record.workDir : "",
      record.target ? "- 대상 폴더: " + record.target.folder + " (" + (record.target.access === "write" ? "수정 허용" : "읽기 전용") + ")" : "",
      memory?.peakBytes ? "- 최대 메모리(측정): " + Math.round(memory.peakBytes / 1024 / 1024) + "MB" : "",
      "", "## 결과", "", finalText.trim()];
    if (stages.length) lines.push("", "## 단계별 상태", "", ...stages.map((stage) => "- " + stage));
    if (outputFiles.length) lines.push("", "## 만든 파일 (output)", "", ...outputFiles.map((file) => "- " + file.path + " (" + file.size + " bytes)"));
    if (changedFiles.length) lines.push("", "## 대상 폴더에서 바뀐 파일", "", ...changedFiles.map((file) => "- " + file.change + ": " + file.path));
    if (outsidePlan.length) lines.push("", "## 계획 밖에서 바뀐 파일(확인 필요)", "", ...outsidePlan.map((file) => "- " + file.change + ": " + file.path));
    if (secretHits.length) lines.push("", "## 비밀값처럼 보이는 문자열(파일은 고치지 않음)", "", ...secretHits.map((hit) => "- output/" + hit.path + " · " + hit.count + "곳"));
    return lines.filter((line) => line !== "").join("\n").replace(/\n(#+ )/gu, "\n\n$1") + "\n";
  }

  /** 결과 저장. 저장이 실패하면 받은 결과를 기록에 남기고 '저장 다시 시도'로 둔다(AI를 다시 부르지 않음). */
  async function finish(scope, record, report) {
    const resultFile = path.join(runDir(scope, record.id), "result.md");
    try {
      await io.writeFile(resultFile, report, "utf8");
    } catch (error) {
      return journal(scope, { ...record, status: "save_failed", pendingReport: report.slice(0, 200_000), userMessage: "결과는 받았지만 저장하지 못했습니다(" + String(error?.code ?? error?.message ?? error) + "). 저장만 다시 시도할 수 있습니다." });
    }
    return journal(scope, { ...record, status: "completed", resultPath: resultFile, pendingReport: undefined });
  }

  const spawnWatcher = (context, limits) => (child) => {
    if (!Number.isInteger(child?.pid) || !limits?.maxBytes) return;
    const watch = startResourceWatch({
      pid: child.pid, maxBytes: limits.maxBytes, intervalMs: options.memoryIntervalMs ?? 10_000, ...(options.probeMemory ? { probe: options.probeMemory } : {}),
      onExceeded: (bytes) => { context.memoryExceeded = bytes; context.controller.abort(); },
    });
    context.watchers.push(watch);
  };
  const stopWatchers = (context) => {
    for (const watch of context.watchers.splice(0)) { watch.stop(); context.peakBytes = Math.max(context.peakBytes ?? 0, watch.peakBytes); }
    return { peakBytes: context.peakBytes ?? 0, exceeded: Boolean(context.memoryExceeded) };
  };

  /** 오류로 멈춘 실행의 대상 폴더 변경. 수정 허용 폴더에서 실행기를 부른 뒤에만 실행 전 목록과 비교한다. */
  async function changesAfterError(context) {
    const watch = context.targetWatch;
    if (!watch?.before) return [];
    try { return diffManifests(watch.before, await buildSourceManifest(io, watch.folder)); } catch { return []; }
  }

  /**
   * 대상 폴더 변경이 남은 채 멈춘 실행의 '내 확인 필요' 안내. 정본의 결과 확인 문장은 앱 종료·연결 끊김 기준이라
   * 중지·시간 초과·오류로 멈춘 실행은 바뀐 파일과 다음 행동을 직접 쓴다. 남은 변경도 결과 확인 표시도 없으면 null.
   */
  function resultCheckGuide(record, state) {
    if (!record.resultCheck && state.status !== "disconnected" && state.status !== "failed") return null;
    const changed = Array.isArray(record.changedFiles) ? record.changedFiles : [];
    if (!changed.length && !record.resultCheck) return null;
    const files = changed.length
      ? "대상 폴더에서 바뀐 파일 " + changed.length + "개가 되돌리지 않은 채 남아 있습니다: " + listChanges(changed, 8) + "."
      : "실행기 종료를 확인하지 못해 수정 허용 폴더에 늦게 바뀐 파일이 있을 수 있습니다.";
    return {
      changedFiles: changed.slice(0, maxListedFiles),
      statusLabel: record.resultCheck ? resultCheckLabel : "",
      nextAction: (base) => (record.resultCheck ? files + " 대상 폴더를 확인한 뒤 되돌릴지·다시 실행할지 정해 주세요. 자동으로 다시 실행하지 않았습니다." : base + " " + files),
    };
  }

  /**
   * 실제 실행형. planGate 스킬(개발팀)에 수정 권한을 주면 먼저 계획 단계(대상 폴더 읽기만)를 돌려 작업 크기를 판정한다.
   * 작은 수정이면 같은 실행에서 구현으로 넘어가고, 큰 변경이면 설계 확인 대기(needs_input)로 멈춘다.
   */
  async function executeAgent({ scope, record, skill, adapter, approval, context, approvedPlan, scriptsBlocked = false }) {
    const base = runDir(scope, record.id);
    const workDir = path.join(base, "work");
    const outputDir = path.join(workDir, "output");
    await io.mkdir(outputDir, { recursive: true });
    const requestFile = path.join(workDir, "REQUEST.md");
    await io.writeFile(requestFile, "# 요청\n\n" + record.request + "\n", "utf8");
    const target = approval.folder ? { folder: path.resolve(approval.folder), access: approval.access === "write" ? "write" : "read" } : null;
    if (target) await io.writeFile(path.join(workDir, "TARGET.md"), "# 대상 폴더\n\n- 경로: " + target.folder + "\n- 권한: " + (target.access === "write" ? "수정 허용" : "읽기 전용") + "\n", "utf8");
    const { skillFile, companions, missingCompanions } = await prepareSkillFiles({ skill, adapter, workDir });
    const manifest = target ? await buildSourceManifest(io, target.folder) : null;
    const manifestFile = manifest ? path.join(workDir, "SOURCE-MANIFEST.md") : "";
    if (manifest) await io.writeFile(manifestFile, manifestMarkdown(manifest), "utf8");
    const stages = [];
    // 명령 실행을 요청했지만 앱이 막은 실행(Windows 의 Claude)은 실행기에도 알린다. 막는 것은 인자이고, 이 문장은 결과를 바르게 쓰게 하려는 것이다.
    const noShell = ["   이번 실행에는 명령 실행 도구가 없습니다(Windows 에서 Claude 의 명령 실행은 OS 샌드박스로 묶이지 않아 앱이 열지 않음). 테스트·빌드·스크립트를 실행했다고 쓰지 말고, 필요한 명령은 결과에 '실행하지 못함'으로 남기세요."];
    const call = async ({ access, phase }) => {
      const writeTarget = access === "write";
      const effective = target ? { ...target, access: writeTarget ? "write" : "read" } : null;
      const prompt = buildAgentPrompt({ skillLabel: skill.label, skillFile, companions, missingCompanions, requestFile, request: record.request, workDir, outputDir, target: effective, runtimeLabel: adapter.label, phase, manifestFile, extra: scriptsBlocked && phase !== "plan" ? noShell : [] });
      const cwd = adapter.id === "codex" && writeTarget ? target.folder : workDir;
      const addDirs = adapter.id === "codex" ? (writeTarget ? [workDir] : []) : (target ? [target.folder] : []);
      return adapter.run({
        mode: "agent", cwd, prompt, addDirs, timeoutMs: options.agentTimeoutMs ?? agentTimeoutMs, abortSignal: context.controller.signal,
        lastMessageFile: path.join(base, phase === "plan" ? "plan-message.md" : "last-message.md"),
        allowWrite: true, writeScope: effective && !writeTarget ? "./output/**" : "", allowScripts: Boolean(approval.allowScripts) && phase !== "plan", profile: "standard",
      });
    };
    const gate = Boolean(skill.definition?.planGate && target?.access === "write");
    let plan = approvedPlan ?? null;
    if (gate && !plan) {
      await io.writeFile(path.join(workDir, "PHASE.md"), "# 단계\n\n계획 단계: 대상 폴더를 고치지 말고 output/plan.json 과 output/plan.md 만 만든 뒤 멈추세요.\n", "utf8");
      record = await journal(scope, { ...record, workDir, outputDir, target, status: "running", phase: "plan" });
      context.detail = adapter.label + "가 작업 크기를 판정하고 계획을 세우고 있습니다.";
      // 오류로 멈춰도 실행 전 목록과 다시 비교할 수 있게 남겨 둔다(계획 단계도 대상 폴더를 바꾸면 결과 확인 대상).
      context.targetWatch = { folder: target.folder, before: manifest };
      const planRun = await call({ access: "read", phase: "plan" });
      stages.push("계획 단계 · " + adapter.label + " · " + (planRun.ok ? "완료" : planRun.cancelled ? "중지" : "실패"));
      const planChanges = diffManifests(manifest, await buildSourceManifest(io, target.folder));
      if (planChanges.length) {
        return { run: { ok: false, text: planRun.text, error: "계획 단계에서 대상 폴더가 바뀌어 멈췄습니다. 바뀐 파일을 확인해 주세요." }, outputFiles: await walkFiles(io, outputDir, { limit: maxListedFiles }), changedFiles: planChanges, record, stages };
      }
      if (!planRun.ok) return { run: planRun, outputFiles: await walkFiles(io, outputDir, { limit: maxListedFiles }), changedFiles: [], record, stages };
      const planOutputs = (await walkFiles(io, outputDir, { limit: maxListedFiles })).map((file) => file.path);
      if (!planOutputs.includes("plan.json") && !planOutputs.includes("plan.md")) {
        // 계획 파일이 하나도 없으면 실행기가 일을 못 한 것이다. '설계 확인 필요'로 오해하게 두지 않는다.
        return { run: { ok: false, text: planRun.text, error: "계획 단계에서 계획 파일(plan.json·plan.md)을 만들지 못했습니다. 실행기 메시지: " + clip(redactSecrets(planRun.text), 300) }, outputFiles: [], changedFiles: [], record, stages };
      }
      const decision = await readDevPlan(io, outputDir);
      if (decision.large) {
        stages.push("큰 변경으로 판정: " + decision.reasons.join(", ") + " → 설계 확인 대기");
        return { run: planRun, needsDesign: true, plan: { ...decision.plan, reasons: decision.reasons, target }, outputFiles: await walkFiles(io, outputDir, { limit: maxListedFiles }), changedFiles: [], record, stages };
      }
      stages.push("작은 수정으로 판정(파일 " + decision.plan.files.length + "개) → 바로 구현");
      let planText = "";
      try { planText = await io.readFile(path.join(outputDir, "plan.md"), "utf8"); } catch { planText = decision.plan.summary; }
      await io.writeFile(path.join(workDir, "APPROVED-PLAN.md"), "# 진행할 계획(작은 수정 — 확인 창 승인으로 진행)\n\n" + planText + "\n", "utf8");
      plan = { ...decision.plan, auto: true };
    } else if (gate && plan) {
      await io.writeFile(path.join(workDir, "APPROVED-PLAN.md"), "# 사용자가 확인한 설계\n\n" + (plan.planText || plan.summary || "") + "\n", "utf8");
      stages.push("사용자가 확인한 설계로 구현(계획 기록 " + plan.fromRunId + ")");
    }
    if (gate) await io.writeFile(path.join(workDir, "PHASE.md"), "# 단계\n\n구현 단계: APPROVED-PLAN.md 의 계획대로 구현하세요. 계획 밖 파일을 바꿔야 하면 바꾸지 말고 보고하세요.\n", "utf8");
    const before = target?.access === "write" ? (gate ? await buildSourceManifest(io, target.folder) : manifest) : null;
    record = await journal(scope, { ...record, workDir, outputDir, target, status: "running", phase: gate ? "implement" : "agent", ...(plan ? { plan: { size: plan.size, files: plan.files, summary: plan.summary, auto: Boolean(plan.auto) } } : {}) });
    context.detail = adapter.label + "가 작업 폴더에서 스킬을 수행하고 있습니다.";
    context.targetWatch = before ? { folder: target.folder, before } : null;
    const run = await call({ access: target?.access, phase: gate ? "implement" : "" });
    if (gate) stages.push("구현 단계 · " + adapter.label + " · " + (run.ok ? "완료" : run.cancelled ? "중지" : "실패"));
    const outputFiles = await walkFiles(io, outputDir, { limit: maxListedFiles });
    const changedFiles = before ? diffManifests(before, await buildSourceManifest(io, target.folder)) : [];
    // 계획이 있는 구현은 계획 파일 목록 밖의 변경을 모두 따로 보여 준다. 목록이 비어 있으면(plan.json·files 없음) 모든 변경이 계획 밖이다.
    const outsidePlan = plan ? changedFiles.filter((file) => !planCovers(plan.files, file.path, target?.folder)) : [];
    return { run, outputFiles, changedFiles, outsidePlan, record, stages };
  }

  /** 설계 확인을 받은 계획 기록을 불러온다. 같은 범위·같은 스킬·설계 확인 대기 상태만 쓴다. */
  async function loadApprovedPlan(scope, planRunId, skill) {
    if (!uuidPattern.test(planRunId || "")) throw new Error("확인한 설계 기록을 다시 선택해 주세요.");
    const record = await readRecord(runFile(scope, planRunId));
    if (record?.consumedBy) throw new Error("이 설계는 이미 구현 실행(" + String(record.consumedBy).slice(0, 8) + ")에 썼습니다. 그 결과를 확인하고, 다시 하려면 계획 단계부터 새로 실행해 주세요.");
    if (!record || record.name !== skill.name || record.workStatus !== "needs_input" || record.workReason !== "design_review" || !record.plan || !record.target) {
      throw new Error("설계 확인을 기다리는 같은 대화의 계획이 아닙니다. 계획 단계부터 다시 실행해 주세요.");
    }
    let planText = "";
    try { planText = await io.readFile(path.join(runDir(scope, planRunId), "work", "output", "plan.md"), "utf8"); } catch { planText = record.plan.summary; }
    return { ...record.plan, target: record.target, planText, fromRunId: planRunId };
  }

  /** 보안 점검: 대상 폴더 읽기 전용, 대상 코드 실행 없음, 시간·메모리 한도. 보고서는 앱이 검사해서 쓴다. */
  async function executeAudit({ scope, record, skill, adapter, approval, context }) {
    const base = runDir(scope, record.id);
    const target = { folder: path.resolve(approval.folder), access: "read" };
    const info = await io.stat(target.folder).catch(() => null);
    if (!info?.isDirectory()) throw new Error("점검할 폴더를 찾지 못했습니다.");
    const dir = path.join(base, "audit");
    await io.mkdir(dir, { recursive: true });
    record = await journal(scope, { ...record, target, outputDir: dir, status: "running", phase: "audit", limits: { timeoutMinutes: Math.round(auditLimits.timeoutMs / 60000), maxMemoryGb: Math.round(auditLimits.maxBytes / 1024 ** 3) } });
    context.detail = adapter.label + "가 " + path.basename(target.folder) + " 폴더를 읽기 전용으로 점검하고 있습니다.";
    const prompt = [
      "[모디크루 보안 점검 · 읽기 전용]",
      "사용자가 확인 창에서 이 폴더의 읽기 전용 보안 점검을 승인했습니다. 실행기: " + adapter.label + ".",
      "점검 대상 폴더(현재 폴더): " + target.folder,
      "규칙: 파일을 만들거나 고치지 마세요. 대상 코드·테스트·빌드·설치 명령을 실행하지 마세요. 네트워크를 쓰지 마세요. 읽기와 검색만 하세요.",
      "한도: 시간 " + Math.round(auditLimits.timeoutMs / 60000) + "분, 메모리 " + Math.round(auditLimits.maxBytes / 1024 ** 3) + "GB.",
      "마지막 응답 끝에 지침의 형식 그대로 " + auditFence + "json 블록 하나를 넣으세요. 근거 경로는 대상 폴더 기준 상대 경로입니다.",
      "<skill_instructions>", skill.doc.body.slice(0, 20_000), "</skill_instructions>",
      "<user_request>", record.request, "</user_request>",
    ].join("\n");
    const run = await adapter.run({
      mode: "agent", profile: "audit", cwd: target.folder, prompt, addDirs: [target.folder], allowWrite: false,
      lastMessageFile: path.join(dir, "last-message.md"), timeoutMs: auditLimits.timeoutMs, abortSignal: context.controller.signal, onSpawn: spawnWatcher(context, auditLimits),
    });
    const memory = stopWatchers(context);
    if (memory.exceeded) return { run: { ok: false, text: run.text, error: "메모리 한도(" + Math.round(auditLimits.maxBytes / 1024 ** 3) + "GB)를 넘어 실행을 끝냈습니다." }, record, memory };
    if (!run.ok) return { run, record, memory };
    const parsed = extractJsonBlock(run.text);
    if (!parsed) return { run: { ok: false, text: run.text, error: "점검 결과 형식(JSON)을 확인하지 못했습니다. 실행기 원문은 기록에 남겼습니다." }, record, memory };
    const validated = await validateAuditReport(parsed, { io, root: target.folder });
    const conditions = adapter.id === "codex"
      ? "Codex 읽기 전용 샌드박스(네트워크 차단)·사용자 config 미사용"
      : "Claude 제한 모드(Read·Glob·Grep만, 명령 실행·웹 조회 없음, 사용자 설정 미사용)";
    const meta = { target: target.folder, runtimeLabel: adapter.label, conditions: conditions + " · 허용 목록 환경변수 · 시간 " + Math.round(auditLimits.timeoutMs / 60000) + "분·메모리 " + Math.round(auditLimits.maxBytes / 1024 ** 3) + "GB 한도" + (memory.peakBytes ? " (최대 측정 " + Math.round(memory.peakBytes / 1024 / 1024) + "MB)" : ""), startedAt: record.startedAt, finishedAt: now().toISOString() };
    const markdown = redactSecretsWithCount(renderAuditReport(validated, meta));
    const json = redactSecretsWithCount(JSON.stringify({ ...validated.report, counts: validated.counts, appNotes: validated.notes, meta }, null, 2));
    await io.writeFile(path.join(dir, "security-report.md"), markdown.text, "utf8");
    await io.writeFile(path.join(dir, "findings.json"), json.text, "utf8");
    const summary = "보안 점검 판정: confirmed " + validated.counts.confirmed + " · needs_validation " + validated.counts.needs_validation + " · rejected " + validated.counts.rejected + (validated.counts.downgraded ? " (앱 근거 검사로 낮춘 항목 " + validated.counts.downgraded + ")" : "") + ". 보고서: security-report.md";
    return {
      run: { ...run, text: summary + "\n\n" + redactSecrets(run.text.replace(new RegExp(auditFence + "json[\\s\\S]*?" + auditFence, "gu"), "").trim()) },
      record, memory, audit: { counts: validated.counts, redactions: markdown.count + json.count },
      outputFiles: (await walkFiles(io, dir, { limit: 10 })).filter((file) => file.path !== "last-message.md"),
    };
  }

  /** 기능 분석(REA): 고른 파일을 실행 폴더로 복사해 사본만 정적 분석한다. 실행 뒤 원본 해시가 그대로인지 확인한다. */
  async function executeReverse({ scope, record, skill, adapter, approval, context }) {
    const server = await resolveMcp("rea");
    if (!server) throw new Error("이 PC에서 REA 분석 도구 연결(Codex MCP 'rea')을 찾지 못했습니다. REA 설치와 등록을 먼저 확인해 주세요.");
    const base = runDir(scope, record.id);
    const workDir = path.join(base, "work");
    const outputDir = path.join(workDir, "output");
    await io.mkdir(outputDir, { recursive: true });
    const requestFile = path.join(workDir, "REQUEST.md");
    await io.writeFile(requestFile, "# 요청\n\n" + record.request + "\n", "utf8");
    const source = path.resolve(approval.folder);
    const copy = await copyTargetFile(io, source, path.join(workDir, "target-copy"));
    await io.writeFile(path.join(workDir, "TARGET.md"), "# 분석 대상\n\n- 원본(열지 않음): " + source + "\n- 사본: " + copy.path + "\n- 크기: " + copy.size + " bytes\n- SHA-256: " + copy.sha256 + "\n- 권한: 읽기 전용(사본 정적 분석)\n", "utf8");
    const { skillFile, companions, missingCompanions } = await prepareSkillFiles({ skill, adapter, workDir });
    const target = { folder: source, access: "read", kind: "file", copy: copy.path, sha256: copy.sha256 };
    record = await journal(scope, { ...record, workDir, outputDir, target, status: "running", phase: "reverse", limits: { timeoutMinutes: Math.round(reverseLimits.timeoutMs / 60000), maxMemoryGb: Math.round(reverseLimits.maxBytes / 1024 ** 3) } });
    context.detail = adapter.label + "가 REA 분석 도구로 " + path.basename(source) + " 사본을 분석하고 있습니다.";
    let mcpConfigFile = "";
    if (adapter.id === "claude") {
      mcpConfigFile = path.join(base, "mcp-config.json");
      await io.writeFile(mcpConfigFile, JSON.stringify({ mcpServers: { rea: { command: server.command, args: server.args, env: server.env } } }, null, 2), "utf8");
    }
    const prompt = buildAgentPrompt({
      skillLabel: skill.label, skillFile, companions, missingCompanions, requestFile, request: record.request, workDir, outputDir, runtimeLabel: adapter.label,
      target: { folder: path.join(workDir, "target-copy"), access: "read" },
      extra: ["   분석 도구: MCP 서버 rea 만 쓸 수 있습니다. 도구에는 target-copy 안의 사본 경로(" + copy.path + ")만 넘기고, 원본 경로는 넘기지 마세요. 대상 프로그램을 실행하지 마세요."],
    });
    const run = await adapter.run({
      mode: "agent", profile: "reverse", cwd: workDir, prompt, addDirs: [], allowWrite: true, writeScope: "./output/**",
      lastMessageFile: path.join(base, "last-message.md"), timeoutMs: reverseLimits.timeoutMs, abortSignal: context.controller.signal,
      mcpServers: { rea: server }, mcpConfigFile, mcpServerIds: ["rea"], onSpawn: spawnWatcher(context, reverseLimits),
    });
    const memory = stopWatchers(context);
    let originalUnchanged = false;
    try { originalUnchanged = (await sha256File(io, source)) === copy.sha256; } catch { originalUnchanged = false; }
    const outputFiles = await walkFiles(io, outputDir, { limit: maxListedFiles });
    const stages = ["원본 " + (originalUnchanged ? "변경 없음(SHA-256 같음)" : "확인 필요(해시가 다르거나 읽지 못함)"), "사본 SHA-256 " + copy.sha256.slice(0, 12)];
    if (memory.exceeded) return { run: { ok: false, text: run.text, error: "메모리 한도(" + Math.round(reverseLimits.maxBytes / 1024 ** 3) + "GB)를 넘어 실행을 끝냈습니다." }, outputFiles, changedFiles: [], record, stages, memory };
    return { run, outputFiles, changedFiles: [], record, stages, memory };
  }

  async function executeCouncil({ scope, record, skill, approval, context, statuses }) {
    const ready = adapters.filter((adapter) => statuses.find((status) => status.id === adapter.id)?.loggedIn);
    const chair = ready.find((adapter) => adapter.id === approval.runtimeId) ?? ready[0];
    if (!chair) throw new Error("실행할 수 있는 Codex·Claude 로그인이 없습니다.");
    const members = [chair, ...ready.filter((adapter) => adapter !== chair)];
    const base = runDir(scope, record.id);
    const signal = context.controller.signal;
    const stages = [];
    const call = async (adapter, stage, prompt, index) => {
      const dir = path.join(base, "stage-" + stage + "-" + adapter.id + "-" + index);
      await io.mkdir(dir, { recursive: true });
      const started = Date.now();
      const run = await adapter.run({ mode: "text", cwd: dir, prompt, lastMessageFile: path.join(dir, "last-message.md"), timeoutMs: options.textTimeoutMs ?? textTimeoutMs, abortSignal: signal });
      stages.push(stage + "단계 · " + adapter.label + " · " + (run.ok ? "완료" : run.cancelled ? "중지" : "실패") + " · " + Math.round((Date.now() - started) / 1000) + "초");
      return run;
    };
    if (members.length < 2) {
      context.detail = chair.label + " 하나로 관점 분리 검토를 하고 있습니다(교차 검증 아님).";
      const run = await call(chair, 1, [
        "[모디크루 심층 검토 · 관점 분리]", "로그인된 실행기가 하나뿐이라 여러 AI 교차 검토가 아닙니다. 결과 첫 줄에 '단일 AI 관점 분리 검토(교차 검증 아님)'라고 쓰세요.",
        "기획·개발·검증 세 관점의 답을 따로 쓴 뒤 서로 반박하고, 합의된 점·남은 이견·최종안을 정리하세요.",
        "<review_guide>", skill.doc.body.slice(0, 6_000), "</review_guide>", "<question>", record.request, "</question>",
      ].join("\n"), 0);
      return { run, stages, participants: chair.label + " 1개(관점 분리)", names: chair.label + "(관점 분리)" };
    }
    context.detail = "1단계 독립 답변: " + members.map((adapter) => adapter.label).join("·") + "가 각자 답하고 있습니다.";
    const first = await Promise.all(members.map((adapter, index) => call(adapter, 1, councilStagePrompt(1, { body: skill.doc.body, request: record.request }), index)));
    if (signal.aborted) return { run: { ok: false, cancelled: true, text: "" }, stages, participants: "" };
    const answered = members.map((adapter, index) => ({ adapter, text: first[index].ok ? first[index].text : "" })).filter((item) => item.text);
    if (answered.length < 2) {
      const only = answered[0];
      return { run: only ? { ok: true, text: "단일 AI 관점 검토(교차 검증 아님) — 다른 실행기가 답하지 못했습니다.\n\n" + only.text } : { ok: false, text: "", error: first.map((item) => item.error).filter(Boolean).join(" / ") }, stages, participants: answered.map((item) => item.adapter.label).join("·") };
    }
    const order = shuffledLabels(answered.length, record.id);
    const labels = "ABCDEFG";
    const anonymous = order.map((memberIndex, position) => ({ label: labels[position], text: answered[memberIndex].text, adapter: answered[memberIndex].adapter }));
    context.detail = "2단계 익명 교차 검토: 답변 " + anonymous.length + "개를 작성자를 가린 채 서로 평가하고 있습니다.";
    // 참여자가 3명 이상이면 자기 답을 빼고 평가한다. 2명이면 하나만 남아 비교가 안 되므로 두 답을 모두(익명) 비교한다.
    // 글자(A·B…)와 실행기의 대응은 3단계가 끝난 뒤에만 공개한다.
    const reviewSet = (item) => (anonymous.length >= 3 ? anonymous.filter((answer) => answer.adapter !== item.adapter) : anonymous);
    const second = await Promise.all(answered.map((item, index) => call(item.adapter, 2, councilStagePrompt(2, { request: record.request, answers: reviewSet(item) }), index)));
    if (signal.aborted) return { run: { ok: false, cancelled: true, text: "" }, stages, participants: "" };
    const reviews = second.map((run, index) => ({ label: String(index + 1), text: run.ok ? run.text : "" })).filter((item) => item.text);
    const participants = anonymous.map((item) => "답변 " + item.label + " = " + item.adapter.label).join(", ");
    context.detail = "3단계 의장 종합: " + chair.label + "가 합의·이견·최종안을 정리하고 있습니다.";
    const third = await call(chair, 3, councilStagePrompt(3, { request: record.request, answers: anonymous, reviews, participants: anonymous.length + "개 답변, 검토 " + reviews.length + "건" }), 0);
    const names = anonymous.map((item) => item.adapter.label).join("·");
    if (!third.ok) return { run: third, stages, participants, names };
    const header = ["## 참여 AI와 단계별 상태", "", "- " + participants + " (교차 검토가 끝난 뒤 공개)", "- 의장: " + chair.label, ...stages.map((stage) => "- " + stage)].join("\n");
    return { run: { ...third, text: header + "\n\n" + third.text }, stages: [], participants, names };
  }


  async function execute(payload, context, scope, rootKey) {
    let record;
    let scripts = null;
    try {
      const old = await readRecord(runFile(scope, payload.runId));
      if (old) { const view = projectRecord(scope, old); return result(view.status, "기존 실행 기록을 불러왔습니다. 다시 실행하지 않았습니다.", { run: view }); }
      const skill = await resolveSkill(payload.name);
      if (skill.definition?.execution === "app_tool") {
        return result("use_tools", skill.label + " 스킬은 크루 실행기로 돌리지 않고 대화의 PC 조작 도구(pc.inspect → pc.request)로 진행합니다. 사용자 승인 전에는 아무것도 바꾸지 않습니다.");
      }
      const request = redactSecrets(clip(payload.request, maxRequestChars));
      if (!request) throw new Error("스킬에 맡길 내용을 입력해 주세요.");
      const domain = await loadDomain();
      const statuses = await runtimeStatuses();
      const approvedPlan = payload.approvedPlanRunId ? await loadApprovedPlan(scope, payload.approvedPlanRunId, skill) : null;
      const limits = skill.profile === "audit" ? auditLimits : skill.profile === "reverse" ? reverseLimits : null;
      const confirmInfo = {
        name: skill.name, label: skill.label, description: skill.doc.description, execution: skill.execution, request,
        runtimes: statuses, needsScripts: skill.doc.allowedTools.includes("Bash"), source: skill.source, profile: skill.profile,
        planGate: Boolean(skill.definition?.planGate), limits,
        approvedPlan: approvedPlan ? { folder: approvedPlan.target.folder, summary: approvedPlan.summary, files: approvedPlan.files ?? [] } : null,
        // Windows 에서 명령 실행을 허용하면 어떤 실행기로 도는지 확인 창에서 미리 알린다.
        scriptsNotice: !claudeShellAllowed(platform) && statuses.some((status) => status.id === "claude" && status.loggedIn) ? windowsShellNotice : "",
      };
      let automatic = null;
      try { automatic = autoApprove ? autoApprove(confirmInfo) : null; } catch { automatic = null; }
      const approval = automatic?.approved ? automatic : await confirm(confirmInfo);
      if (!approval?.approved) return result("declined", "실행을 취소했습니다. AI에 보내지 않았습니다.");
      // 실행 조건은 확인 창의 답보다 스킬 정본이 우선한다: 점검·분석은 읽기만, 설계 확인 구현은 계획의 폴더만 고친다.
      let granted = { ...approval };
      if (approvedPlan) granted = { ...approval, folder: approvedPlan.target.folder, access: "write" };
      if (skill.profile === "audit" || skill.profile === "reverse") {
        if (!approval.folder) return result("declined", skill.profile === "audit" ? "점검할 폴더를 골라 주세요. AI에 보내지 않았습니다." : "분석할 파일을 골라 주세요. AI에 보내지 않았습니다.");
        granted = { ...approval, access: "read", allowScripts: false };
      }
      // 분석은 사본만 읽으므로 설치 폴더의 파일도 고를 수 있다. 인증 정보 폴더 안의 파일만 거절한다.
      const unsafe = skill.profile === "reverse"
        ? /[\\/]\.(?:ssh|codex|claude|aws|gnupg)(?:[\\/]|$)/iu.test(path.resolve(granted.folder))
        : Boolean(granted.folder) && isUnsafeTargetFolder(granted.folder);
      if (unsafe) return result("declined", "드라이브 루트·홈 폴더·시스템 폴더·인증 폴더는 작업 대상으로 열 수 없습니다. 하위 프로젝트 폴더를 골라 주세요.");
      if (context.controller.signal.aborted) return result("cancelled", "실행 전에 취소했습니다.");
      if (await scopeFor(payload) !== scope) throw new Error("저장 위치가 바뀌어 실행을 중단했습니다.");
      const loggedIn = (item) => Boolean(statuses.find((status) => status.id === item.id)?.loggedIn);
      let adapter = adapters.find((item) => item.id === granted.runtimeId && loggedIn(item)) ?? adapters.find(loggedIn);
      if (!adapter) throw new Error("실행할 수 있는 Codex·Claude 로그인이 없습니다.");
      // Windows 에서 Claude 의 명령 실행은 OS 샌드박스로 묶이지 않아 대상 폴더 밖 쓰기를 막지도 찾지도 못한다. 명령 실행을 허용한
      // 실행은 OS 샌드박스(workspace-write)가 있는 Codex 로 돌리고, Codex 가 없으면 Claude 를 명령 도구 없이 돌린 뒤 그 제한을 남긴다.
      if (granted.allowScripts && adapter.id === "claude" && !claudeShellAllowed(platform)) {
        const codex = adapters.find((item) => item.id === "codex" && loggedIn(item));
        scripts = codex
          ? { requested: true, allowed: true, requestedRuntimeId: "claude", runtimeId: "codex", note: "Windows 에서는 Claude 의 명령 실행이 OS 샌드박스로 묶이지 않아, 명령 실행을 허용한 이 실행은 OS 샌드박스(workspace-write)가 있는 Codex 로 바꿔 실행했습니다(고른 실행기: Claude)." }
          : { requested: true, allowed: false, requestedRuntimeId: "claude", runtimeId: "claude", note: "Windows 에서는 Claude 의 명령 실행이 OS 샌드박스로 묶이지 않아 명령 실행 도구 없이 Claude 로 실행했습니다(Codex 로그인 없음). 테스트·스크립트 명령은 실행하지 않았습니다." };
        if (codex) adapter = codex; else granted = { ...granted, allowScripts: false };
      }
      const scriptsTail = scripts ? " " + scripts.note : "";
      if (approvedPlan) {
        // 확인한 설계는 한 번만 구현에 쓴다. 구현을 시작하기 전에 계획 기록을 '구현으로 넘김(완료)'으로 바꿔 둔다 —
        // 다시 쓰기·앱이 꺼진 뒤 같은 계획으로 다시 구현하기를 막고, '내 확인 필요'에서 끝난 설계 확인을 뺀다.
        // 승인함 거절·다른 넘김과 겹칠 수 있어 계획 기록의 줄 안에서 최신 기록으로 다시 확인한 뒤에만 넘긴다.
        const handed = await updateRecord(scope, approvedPlan.fromRunId, (latest) => (waitingForDesign(latest)
          ? { record: { ...latest, status: "completed", consumedBy: payload.runId, consumedAt: now().toISOString(), consumedVia: payload.via === "inbox" ? "inbox" : "chat", inboxNote: undefined, userMessage: "설계 확인을 받아 구현 실행(" + payload.runId.slice(0, 8) + ")으로 넘겼습니다. 같은 계획으로 다시 구현하지 않습니다." }, state: { status: "completed" } }
          : null));
        if (!handed) throw new Error("이 설계는 이미 구현에 썼거나 확인 대기 상태가 아닙니다. 계획 단계부터 다시 실행해 주세요.");
      }
      record = await journal(scope, {
        id: payload.runId, name: skill.name, label: skill.label, origin: skill.origin, execution: skill.execution, profile: skill.profile,
        skillVersion: skill.version || undefined, skillSha256: skill.sha256 || undefined,
        executionLabel: domain.describeCrewSkillExecution(skill.execution), runtimeId: adapter.id, runtimeLabel: adapter.label,
        request, teammateId: clip(payload.teammateId, 120) || undefined, threadId: clip(payload.threadId, 240) || undefined, rootKey,
        effect: granted.access === "write" ? "external_effect" : "local_output", approvedPlanRunId: approvedPlan?.fromRunId,
        ...(scripts ? { scripts } : {}),
        status: "running", phase: "preparing", startedAt: now().toISOString(),
      });
      context.phase = "running";
      context.startedAt = Date.now();
      let run; let outputFiles = []; let changedFiles = []; let stages = []; let outsidePlan = []; let memory = null; let outputDir = "";
      if (skill.execution === "council") {
        const council = await executeCouncil({ scope, record, skill, approval: granted, context, statuses });
        run = council.run; stages = council.stages;
        record = { ...record, runtimeLabel: council.names || record.runtimeLabel, participants: council.participants || undefined };
      } else if (skill.profile === "audit") {
        const audit = await executeAudit({ scope, record, skill, adapter, approval: granted, context });
        run = audit.run; record = audit.record; memory = audit.memory; outputFiles = audit.outputFiles ?? [];
        if (audit.audit) record = { ...record, audit: audit.audit };
      } else if (skill.profile === "reverse") {
        const reverse = await executeReverse({ scope, record, skill, adapter, approval: granted, context });
        run = reverse.run; record = reverse.record; outputFiles = reverse.outputFiles; stages = reverse.stages; memory = reverse.memory;
      } else if (skill.execution === "agent") {
        const agent = await executeAgent({ scope, record, skill, adapter, approval: granted, context, approvedPlan, scriptsBlocked: scripts?.allowed === false });
        run = agent.run; outputFiles = agent.outputFiles; changedFiles = agent.changedFiles; record = agent.record; stages = agent.stages; outsidePlan = agent.outsidePlan ?? [];
        if (agent.needsDesign && !context.quitting && !context.controller.signal.aborted) {
          const finishedAt = now().toISOString();
          const planReport = composeReport({ skill, record: { ...record, finishedAt }, finalText: "큰 변경으로 판정해 구현하지 않고 멈췄습니다. 설계안을 확인한 뒤 대화에서 '이대로 구현'이라고 답하면 이 계획으로 구현을 이어 갑니다.\n\n판정 이유: " + agent.plan.reasons.join(", ") + "\n\n" + clip(run.text, 20_000), outputFiles, stages });
          const planFile = path.join(runDir(scope, record.id), "plan-review.md");
          await io.writeFile(planFile, planReport, "utf8");
          record = await journal(scope, { ...record, status: "needs_input", finishedAt, outputFiles, resultPath: planFile, plan: { size: "large", files: agent.plan.files, summary: agent.plan.summary, reasons: agent.plan.reasons }, outputText: clip(run.text, 60_000), userMessage: "큰 변경이라 설계 확인이 필요합니다. 계획: " + (agent.plan.summary || "plan.md 참고") + scriptsTail }, { status: "needs_input", reason: "design_review" });
          void notify({ title: "설계 확인이 필요해요", body: skill.label + " · " + clip(agent.plan.summary || "계획을 확인해 주세요.", 120) });
          return result("needs_input", record.userMessage + " (확인 뒤 같은 대화에서 '이대로 구현'이라고 답하면 approvedPlanRunId=" + record.id + " 로 이어서 구현합니다.)", { run: record, outputText: record.outputText });
        }
      } else {
        context.detail = adapter.label + "가 스킬 지침으로 결과를 쓰고 있습니다.";
        const dir = path.join(runDir(scope, record.id), "text");
        await io.mkdir(dir, { recursive: true });
        run = await adapter.run({ mode: "text", cwd: dir, prompt: buildInstructionPrompt({ skillLabel: skill.label, body: skill.doc.body, request }), lastMessageFile: path.join(dir, "last-message.md"), timeoutMs: options.textTimeoutMs ?? textTimeoutMs, abortSignal: context.controller.signal });
      }
      // 모디크루 실제 실행형 스킬은 결과 파일을 남기는 절차다. 결과 파일도 대상 폴더 변경도 없으면 완료로 보지 않는다.
      if (run.ok && skill.execution === "agent" && skill.origin !== "installed" && skill.profile !== "audit" && !outputFiles.length && !changedFiles.length) {
        run = { ...run, ok: false, error: "실행기는 끝났지만 결과 파일을 만들지 않았습니다. 실행기 메시지: " + clip(redactSecrets(run.text), 300) };
      }
      const finishedAt = now().toISOString();
      outputDir = record.outputDir || "";
      if (context.quitting) {
        record = await journal(scope, { ...record, status: "disconnected", interruptedBy: "app_quit", finishedAt, outputFiles, changedFiles, userMessage: "앱을 종료해 실행을 멈췄습니다. 결과 폴더를 확인한 뒤 다시 실행할지 정해 주세요." });
        return result("disconnected", record.userMessage, { run: record });
      }
      // 중지·시간 초과·실패로 멈췄어도 대상 폴더 변경은 되돌리지 않는다. 변경이 남았거나 수정 허용 폴더에서 실행기 종료를 끝까지
      // 확인하지 못했으면 깨끗한 취소·실패로 두지 않고 '결과 확인 필요'(정본의 결과 미확인 상태)로 남겨 내 확인 필요·승인함에 올린다.
      const writable = record.target?.access === "write";
      const needsCheck = changedFiles.length > 0 || Boolean(run.stopUnconfirmed && writable);
      const stopNote = (when) => (changedFiles.length ? " " + when + " 대상 폴더에서 바뀐 파일 " + changedFiles.length + "개(" + listChanges(changedFiles) + ")가 되돌리지 않은 채 남아 있어 결과 확인이 필요합니다." : "");
      const lateNote = !changedFiles.length && needsCheck ? " 수정 허용 폴더라 늦게 바뀐 파일이 있을 수 있어 결과 확인이 필요합니다." : "";
      if ((context.controller.signal.aborted || run.cancelled) && !context.memoryExceeded) {
        const unconfirmed = run.stopUnconfirmed ? " 실행기 종료를 끝까지 확인하지 못했습니다. 잠시 뒤 대상 폴더를 다시 확인해 주세요." : "";
        record = await journal(scope, { ...record, status: "cancelled", finishedAt, outputFiles, changedFiles, ...(run.stopUnconfirmed ? { stopUnconfirmed: true } : {}), ...(needsCheck ? { resultCheck: "stopped" } : {}), userMessage: "중지했습니다." + stopNote("중지 전에") + unconfirmed + lateNote + " 이미 실행기에 전달된 요청은 사용량이 생겼을 수 있습니다." + scriptsTail }, needsCheck ? resultCheckState : undefined);
        return result("cancelled", record.userMessage, { run: record });
      }
      if (!run.ok) {
        const reason = run.timedOut ? "시간 안에 끝나지 않았습니다. 요청을 나눠 다시 시도해 주세요." : (run.error || "실행 결과를 받지 못했습니다. 로그인 상태를 확인해 주세요.");
        const unconfirmed = lateNote ? " 실행기 종료를 끝까지 확인하지 못했습니다." + lateNote : "";
        record = await journal(scope, { ...record, status: "failed", finishedAt, outputFiles, changedFiles, ...(memory ? { memory } : {}), ...(needsCheck ? { resultCheck: run.timedOut ? "timed_out" : "failed" } : {}), userMessage: reason + stopNote("멈추기 전에") + unconfirmed + scriptsTail, partialText: clip(redactSecrets(run.text), 20_000) || undefined }, needsCheck ? resultCheckState : undefined);
        void notify({ title: needsCheck ? "크루 작업 결과를 확인해 주세요" : "크루 작업이 실패했어요", body: skill.label + " · " + clip(reason, 120) });
        return result("failed", record.userMessage, { run: record });
      }
      const secretScan = outputDir && skill.profile !== "audit" ? await scanTextFilesForSecrets(io, outputDir) : { hits: [] };
      record = { ...record, finishedAt, outputText: clip(redactSecrets(run.text), 60_000), outputFiles, changedFiles, ...(outsidePlan.length ? { outsidePlan } : {}), ...(secretScan.hits.length ? { secretHits: secretScan.hits } : {}), ...(memory ? { memory } : {}), usage: run.usage, permissionDenials: run.permissionDenials };
      record = await journal(scope, { ...record, status: "result_ready" });
      const report = composeReport({ skill, record, finalText: record.outputText, outputFiles, changedFiles, stages, outsidePlan, secretHits: secretScan.hits, memory });
      record = await finish(scope, record, report);
      if (record.status === "save_failed") {
        void notify({ title: "결과 저장을 다시 해야 해요", body: skill.label + " · 결과는 받았지만 저장하지 못했습니다." });
        return result("save_failed", record.userMessage, { run: record, outputText: record.outputText });
      }
      const fileNote = outputFiles.length ? " 만든 파일 " + outputFiles.length + "개." : "";
      const changeNote = changedFiles.length ? " 대상 폴더에서 바뀐 파일 " + changedFiles.length + "개." : "";
      const planNote = outsidePlan.length ? " 계획 밖에서 바뀐 파일 " + outsidePlan.length + "개(확인 필요)." : "";
      const secretNote = secretScan.hits.length ? " 결과 파일에 비밀값처럼 보이는 문자열이 있습니다(" + secretScan.hits.length + "개 파일)." : "";
      const doneMessage = skill.execution === "council"
        ? record.runtimeLabel + " 교차 검토로 " + skill.label + "을 마치고 결과를 저장했습니다."
        : record.runtimeLabel + "로 " + skill.label + " 스킬을 실행하고 결과를 저장했습니다.";
      void notify({ title: "크루 작업 완료", body: skill.label + " · " + record.runtimeLabel });
      return result("completed", doneMessage + fileNote + changeNote + planNote + secretNote + scriptsTail, { run: record, outputText: record.outputText });
    } catch (error) {
      const message = String(error?.message ?? error);
      // 실행기를 부른 뒤 오류로 멈췄으면 대상 폴더를 실행 전 목록과 다시 비교한다. 변경이 남았으면 '결과 확인 필요'로 남긴다.
      // 마지막으로 남긴 기록(context.record)을 이어 써서 대상 폴더·단계 같은 정보가 옛 기록으로 되돌아가지 않게 한다.
      const latest = context.record ?? record;
      let saved = record;
      if (latest) {
        const leftover = latest.changedFiles?.length ? latest.changedFiles : await changesAfterError(context);
        const note = leftover.length ? " 멈추기 전에 대상 폴더에서 바뀐 파일 " + leftover.length + "개(" + listChanges(leftover) + ")가 되돌리지 않은 채 남아 있어 결과 확인이 필요합니다." : "";
        saved = await journal(scope, { ...latest, status: "failed", finishedAt: now().toISOString(), ...(leftover.length ? { changedFiles: leftover, resultCheck: "failed" } : {}), userMessage: message + note + (scripts ? " " + scripts.note : "") }, leftover.length ? resultCheckState : undefined).catch(() => latest);
      }
      const status = error?.code === "NOT_INSTALLED" ? "not_installed" : "failed";
      return result(status, saved?.userMessage ?? message, saved ? { run: saved } : {});
    }
  }

  /** 앱 완전 종료: 진행 중인 실행을 멈추고 프로세스 묶음을 끝낸 뒤 '연결 끊김'으로 바로 기록한다. */
  function shutdown() {
    let stopped = 0;
    for (const context of active.values()) {
      context.quitting = true;
      context.controller.abort();
      const record = context.record;
      if (record && context.scope && ["running", "result_ready"].includes(record.status)) {
        try {
          writeJsonSync(runFile(context.scope, record.id), { ...record, status: "disconnected", workStatus: "disconnected", workReason: "unknown_outcome", workStatusLabel: "연결 끊김", interruptedBy: "app_quit", finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), userMessage: "앱을 종료해 실행을 멈췄습니다. 결과 폴더를 확인한 뒤 다시 실행할지 정해 주세요." });
          stopped += 1;
        } catch { /* 종료 중 저장 실패 — 다음 실행 때 '연결 끊김'으로 보인다 */ }
      }
    }
    const killed = killAllLiveChildrenSync();
    return { stopped, killed };
  }
  if (options.registerQuitHook ?? Boolean(process.versions?.electron)) {
    import("electron").then(({ app }) => app?.on?.("will-quit", () => { shutdown(); })).catch(() => undefined);
  }

  async function listRunRecords({ scope, limit = 400 }) {
    const scopes = scope ? [scope] : await io.readdir(stateRoot, { withFileTypes: true }).then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
    const records = [];
    const warnings = [];
    for (const name of scopes) {
      let ids = [];
      try { ids = (await io.readdir(path.join(stateRoot, name), { withFileTypes: true })).filter((entry) => entry.isDirectory() && uuidPattern.test(entry.name)).map((entry) => entry.name); }
      catch (error) { if (error.code !== "ENOENT") warnings.push("읽지 못한 실행 기록 폴더가 있습니다."); continue; }
      for (const id of ids) {
        if (records.length >= limit) break;
        try {
          const record = await readRecord(path.join(stateRoot, name, id, "run.json"));
          if (record) records.push({ scope: name, record: projectRecord(name, record) });
        } catch { warnings.push("읽지 못한 실행 기록이 있습니다. 원본 파일은 보존했습니다."); }
      }
    }
    return { records, warnings };
  }

  async function packageView(entry, { catalog, statuses, domain }) {
    const definition = domain.getCrewSkill(entry.name);
    const ready = statuses.filter((status) => status.loggedIn).length;
    let integrityOk; let installed = true; let pkg = null;
    if (entry.availability === "optional") {
      pkg = await packageStore.status(entry.name);
      installed = pkg.installed;
      if (pkg.integrityOk === false) integrityOk = false;
    } else {
      integrityOk = (await verifyBundledSkill(entry.name, { catalog, libraryRoot, io })).ok;
    }
    const mcpReady = {};
    for (const id of entry.requires?.mcpServers ?? []) mcpReady[id] = Boolean(await resolveMcp(id));
    const cliReady = {};
    for (const id of entry.requires?.cli ?? []) cliReady[id] = (await cliStatus(id)).ready === true;
    const lifecycle = definition ? domain.crewSkillLifecycle(definition, { integrityOk, installed, readyRuntimes: ready, mcpReady, cliReady }) : "error";
    const companions = await Promise.all((entry.companionSkills ?? []).map(async (name) => ({ name, installed: Boolean(await findInstalled(name)) })));
    return {
      name: entry.name, label: entry.label, description: entry.description, version: entry.version, category: entry.category, categoryLabel: entry.categoryLabel,
      availability: entry.availability, profile: entry.profile, execution: entry.execution, executionLabel: entry.executionLabel, owners: entry.ownerLabels,
      permissions: entry.permissions, permissionLabels: entry.permissionLabels, requires: entry.requires, io: entry.io, runtimeTools: entry.runtimeTools,
      platforms: entry.platforms, verification: entry.verification, sources: entry.sources, integrity: { sha256: entry.integrity.sha256, ok: integrityOk !== false },
      lifecycle, lifecycleLabel: domain.crewSkillLifecycleLabels[lifecycle], package: pkg, mcpReady, cliReady, companions,
    };
  }

  // 외부 도구(현재 agent-desktop) 연결 점검. 확장 센터를 열 때마다 실행하지 않도록 1분 동안 결과를 재사용한다.
  const cliProbeCache = new Map();
  async function cliStatus(id) {
    const cached = cliProbeCache.get(id);
    if (cached && Date.now() - cached.at < 60_000) return cached.value;
    let value = { ready: false, label: id + " 연결", userMessage: id + " 을(를) 확인하지 못했습니다." };
    if (id === "agent-desktop") {
      const probe = options.probeCli ? await options.probeCli(id) : await probeAgentDesktop(userDataRoot).catch((error) => ({ ready: false, userMessage: String(error?.message ?? error) }));
      value = { ready: probe.ready === true, version: probe.version ?? "", label: probe.installed === false ? "agent-desktop 설치(공식: npm install -g agent-desktop)" : "agent-desktop 연결(" + (probe.userMessage ?? "") + ")", userMessage: probe.userMessage ?? "" };
    }
    cliProbeCache.set(id, { at: Date.now(), value });
    return value;
  }

  async function installPrecheck(entry) {
    const statuses = await runtimeStatuses();
    const ready = statuses.filter((status) => status.loggedIn);
    const missing = [];
    const minRuntimes = entry.requires?.minRuntimes ?? 1;
    if (minRuntimes > 0 && ready.length < minRuntimes) missing.push("Codex 또는 Claude 로그인");
    for (const id of entry.requires?.mcpServers ?? []) if (!(await resolveMcp(id))) missing.push(id === "rea" ? "REA 분석 도구 연결(설치·Codex MCP 등록)" : id + " 연결");
    const cliNotes = [];
    for (const id of entry.requires?.cli ?? []) {
      cliProbeCache.delete(id);
      const status = await cliStatus(id);
      if (!status.ready) missing.push(status.label);
      else cliNotes.push(id + " " + status.version + " 연결");
    }
    if (missing.length) return { ok: false, missing, userMessage: "먼저 필요한 연결이 있습니다: " + missing.join(", ") + ". 모디크루가 대신 설치하지 않습니다." };
    const parts = [];
    if (minRuntimes > 0) parts.push(ready.map((status) => status.label).join("·") + " 로그인");
    if ((entry.requires?.mcpServers ?? []).length) parts.push(entry.requires.mcpServers.join(", ") + " 연결");
    parts.push(...cliNotes);
    return { ok: true, summary: parts.join(" · ") || "추가 연결 필요 없음" };
  }

  async function handle(payload = {}) {
    try {
      if (payload.kind === "status") return result("status", "실행기 로그인 상태입니다(모델을 부르지 않고 확인).", { runtimes: await runtimeStatuses() });
      if (payload.kind === "catalog") {
        const domain = await loadDomain();
        const catalog = await loadCatalog();
        const skills = [];
        for (const definition of domain.crewSkillCatalog) {
          const file = path.join(libraryRoot, definition.name, "SKILL.md");
          const companions = await Promise.all(definition.companionSkills.map(async (name) => ({ name, installed: Boolean(await findInstalled(name)) })));
          skills.push({ name: definition.name, label: definition.label, description: definition.description, execution: definition.execution, executionLabel: domain.describeCrewSkillExecution(definition.execution), owners: domain.describeCrewSkillOwners(definition), bundled: existsSync(file), companions, version: definition.version, category: definition.category, availability: definition.availability, profile: definition.profile });
        }
        return result("catalog", "모디크루 크루 스킬 목록입니다.", { skills, references: catalog.references ?? [] });
      }
      if (payload.kind === "packages") {
        const domain = await loadDomain();
        const catalog = await loadCatalog();
        const statuses = await runtimeStatuses();
        const skills = [];
        for (const entry of catalog.skills) skills.push(await packageView(entry, { catalog, statuses, domain }));
        return result("packages", "크루 스킬 확장 상태입니다.", { skills, references: catalog.references ?? [], lifecycleLabels: catalog.lifecycleLabels, referenceStateLabels: catalog.referenceStateLabels, runtimes: statuses, persistence: domain.modyWorkPersistence });
      }
      if (payload.kind === "install") {
        const domain = await loadDomain();
        const catalog = await loadCatalog();
        const entry = catalog.skills.find((skill) => skill.name === clip(payload.name, 64));
        if (!entry) throw new Error("카탈로그에 없는 확장입니다.");
        const before = await packageStore.status(entry.name);
        const update = Boolean(before.activeVersion);
        const expanded = update ? before.addedPermissions : entry.permissions;
        const precheck = await installPrecheck(entry);
        if (!precheck.ok) return result("precheck_failed", precheck.userMessage, { missing: precheck.missing });
        const approval = await confirmInstall({
          name: entry.name, label: entry.label, version: entry.version, update, permissions: entry.permissions, permissionLabels: entry.permissionLabels,
          expanded, expandedLabels: expanded.map((permission) => domain.crewSkillPermissionLabels[permission] ?? permission),
          license: entry.sources.map((item) => item.label + " — " + item.license).join(" / "), verification: entry.verification.note,
        });
        if (!approval?.approved) return result("declined", "추가를 취소했습니다. 아무것도 설치하지 않았습니다.");
        return packageStore.install(entry.name, { approvedPermissions: entry.permissions, precheck: async () => precheck });
      }
      if (payload.kind === "rollback") return packageStore.rollback(clip(payload.name, 64));
      if (payload.kind === "remove") {
        if (payload.confirmed !== true) return result("needs_confirmation", "확장을 빼려면 확인이 필요합니다. 실행 기록과 결과 파일은 지우지 않습니다.");
        return packageStore.remove(clip(payload.name, 64));
      }
      if (payload.kind === "select") {
        const domain = await loadDomain();
        const matches = domain.selectCrewSkillsForTeammate({ roleId: clip(payload.roleId, 80), templateId: clip(payload.templateId, 40) }, clip(payload.request, maxRequestChars), 3);
        return result("select", matches.length ? "요청에 맞는 크루 스킬입니다." : "요청에 맞는 크루 스킬이 없습니다.", { matches: matches.map((match) => ({ name: match.skill.name, label: match.skill.label, execution: match.skill.execution, availability: match.skill.availability, score: match.score })) });
      }
      if (payload.kind === "read") {
        const skill = await resolveSkill(payload.name);
        const resources = (await walkFiles(io, skill.dir, { limit: 60 })).map((file) => file.path).filter((file) => file !== "SKILL.md");
        return result("read", skill.label + " 스킬 지침입니다.", { skill: { name: skill.name, label: skill.label, origin: skill.origin, execution: skill.execution, source: skill.source, description: skill.doc.description, compatibility: skill.doc.compatibility, instructions: skill.doc.body.slice(0, 20_000), resources } });
      }
      if (payload.kind === "attention") {
        const domain = await loadDomain();
        const root = await rootFor(payload);
        const rootKey = rootKeyOf(root);
        const { records, warnings } = await listRunRecords({ limit: 600 });
        const items = records.filter((entry) => entry.record.rootKey === rootKey).map(({ record }) => {
          const state = domain.workStateFromCrewSkillRun(record);
          const check = resultCheckGuide(record, state);
          return { id: "crew-skill:" + record.id, source: "crew_skill", title: (record.label || record.name) + (record.runtimeLabel ? " · " + record.runtimeLabel : ""), detail: clip(record.userMessage, 240), status: state.status, ...(state.reason ? { reason: state.reason } : {}), threadId: record.threadId, runId: record.id, teammateId: record.teammateId, scopeKey: rootKey, updatedAt: record.updatedAt || record.finishedAt || record.startedAt, ...(check ? { changedFiles: check.changedFiles, resultCheck: check } : {}) };
        });
        // 같은 저장 위치의 PC 작업(승인 대기·결과 확인 필요·실패)도 함께 모은다. 기록 파일만 읽는다.
        const pcItems = userDataRoot ? await listDesktopAppActionAttention(userDataRoot, root).catch(() => []) : [];
        // 변경이 남은 채 멈춘 크루 실행은 상태 이름('결과 확인 필요')과 다음 행동에 바뀐 파일을 넣는다(대화 도구는 이 두 값을 보여 준다).
        const attention = domain.buildAttentionItems([...items, ...pcItems], { scopeKey: rootKey, limit: Number(payload.limit) || 30 })
          .map(({ resultCheck: check, ...item }) => (check ? { ...item, ...(check.statusLabel ? { statusLabel: check.statusLabel } : {}), nextAction: check.nextAction(item.nextAction) } : item));
        return result("attention", attention.length ? "확인이 필요한 크루 작업 " + attention.length + "건입니다." : "확인이 필요한 크루 작업이 없습니다.", { items: attention, warnings, persistence: domain.modyWorkPersistence });
      }
      const scope = await scopeFor(payload);
      if (payload.kind === "run") {
        if (!uuidPattern.test(payload.runId || "")) throw new Error("실행 식별자가 올바르지 않습니다.");
        // 확인(active·scopeLocks)과 등록 사이에 await 가 있으면 같은 순간에 온 두 요청(중복 클릭·화면 재시도)이 모두 통과한다.
        // 저장 위치를 먼저 읽고, 확인과 등록은 await 없이 한 번에 한다.
        const rootKey = rootKeyOf(await rootFor(payload));
        const key = scope + ":" + payload.runId;
        if (active.has(key)) return active.get(key).promise;
        if (scopeLocks.has(scope)) return result("busy", "이 대화의 크루 스킬 실행이 끝난 뒤 다시 시도해 주세요.");
        const context = { phase: "confirming", controller: new AbortController(), detail: "", watchers: [], scope };
        active.set(key, context);
        scopeLocks.set(scope, key);
        context.promise = execute(payload, context, scope, rootKey)
          .then(async (response) => (response?.run ? { ...response, ...(await workSignal(response.run)) } : response))
          .finally(() => { active.delete(key); if (scopeLocks.get(scope) === key) scopeLocks.delete(scope); });
        return context.promise;
      }
      if (payload.kind === "progress") {
        const domain = await loadDomain();
        const running = active.get(scope + ":" + payload.runId);
        if (!running) return result("not_running", "진행 중인 크루 스킬 실행이 없습니다.");
        const signal = (state) => ({ workStatus: state.status, ...(state.reason ? { workReason: state.reason } : {}), workStatusLabel: domain.workStatusLabel(state), officeSignal: domain.officeSignalForWorkState(state, officeActivityByCategory[domain.getCrewSkill(running.record?.name)?.category] ?? "drafting") });
        if (running.phase !== "running") return result("checking", "실행 확인 창에서 선택을 기다리고 있습니다.", signal({ status: "needs_approval", reason: "approval" }));
        const seconds = Math.round((Date.now() - (running.startedAt ?? Date.now())) / 1000);
        return result("running", (running.detail || "크루 스킬을 실행하고 있습니다.") + " (경과 " + Math.floor(seconds / 60) + "분 " + (seconds % 60) + "초)", signal({ status: "running" }));
      }
      if (payload.kind === "cancel") {
        const running = active.get(scope + ":" + payload.runId);
        running?.controller.abort();
        return result(running ? "cancelling" : "not_running", running ? "중지를 요청했습니다. 실행기를 끝내고 기록을 남깁니다." : "진행 중인 실행이 없습니다.");
      }
      if (payload.kind === "records") {
        const { records, warnings } = await listRunRecords({ scope });
        return result("records", "크루 스킬 실행 기록입니다.", { records: records.map((entry) => entry.record).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))), warnings });
      }
      if (payload.kind === "resave") {
        if (!uuidPattern.test(payload.runId || "")) throw new Error("실행 기록을 다시 선택해 주세요.");
        const record = await readRecord(runFile(scope, payload.runId));
        if (!record || record.status !== "save_failed" || !record.pendingReport) throw new Error("다시 저장할 결과가 없습니다.");
        const saved = await finish(scope, record, record.pendingReport);
        return result(saved.status === "completed" ? "completed" : "save_failed", saved.status === "completed" ? "AI를 다시 부르지 않고 결과를 저장했습니다." : saved.userMessage, { run: saved, ...(await workSignal(saved)) });
      }
      if (payload.kind === "open") {
        if (!uuidPattern.test(payload.runId || "")) throw new Error("실행 기록을 다시 선택해 주세요.");
        const record = await readRecord(runFile(scope, payload.runId));
        if (!record || !["completed", "needs_input"].includes(record.status) || !record.resultPath) throw new Error("저장이 끝난 결과만 열 수 있습니다.");
        const target = payload.target === "folder" && record.outputDir ? record.outputDir : record.resultPath;
        const openPath = options.openPath ?? (async (file) => (await import("electron")).shell.openPath(file));
        const error = await openPath(target);
        if (error) throw new Error(error);
        return result("opened", payload.target === "folder" ? "결과 폴더를 열었습니다." : "결과 문서를 열었습니다.");
      }
      throw new Error("지원하지 않는 크루 스킬 요청입니다.");
    } catch (error) {
      return result(error?.code === "NOT_INSTALLED" ? "not_installed" : "failed", String(error?.message ?? error));
    }
  }

  /** 승인함과 맞춘다: 밀린 기록·카드 갱신을 마치고 정본과 카드를 맞춘 뒤 승인함 결정을 처리한다(감시 주기는 결정 처리만 한다). */
  async function syncInbox() {
    await settleRunQueues();
    await reconcileInbox().catch(() => undefined);
    await settleRunQueues();
    await watchPlanCards();
    await settleRunQueues();
  }

  // 앱을 다시 켠 뒤에도 승인함의 설계 확인 카드 결정을 이어받고, 꺼진 사이 어긋난 카드를 정본에 맞춘다(설치 앱 또는 시험에서 승인함을 넣은 경우).
  if (options.watchInbox !== false && (options.inbox || options.loadInbox || process.versions?.electron)) {
    const resume = setTimeout(() => { void reconcileInbox().catch(() => undefined); }, options.inboxResumeMs ?? 5_000);
    resume.unref?.();
  }

  return { handle, shutdown, syncInbox };
}
