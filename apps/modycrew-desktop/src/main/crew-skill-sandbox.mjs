/**
 * 크루 스킬 실행 격리 — 실제 Codex·Claude 프로세스에 넘기는 환경과 자원을 앱 로직으로 제한한다.
 *
 *   - 환경변수 허용 목록: 실행에 필요한 경로·로캘·프록시만 넘긴다. API 키·토큰·비밀번호는 넘기지 않는다.
 *     (예: ANTHROPIC_API_KEY 가 있으면 Claude Code 가 구독 대신 API 과금으로 바뀐다 — 넘기지 않아 구독으로만 쓴다.)
 *   - 메모리 한도: 실행 프로세스 묶음(자식 포함)의 사용량을 주기적으로 재고, 넘으면 묶음째 끝낸다.
 *   - 비밀값: 앱이 저장하는 기록·보고서의 접속 키·토큰 형태 문자열은 가리고, 실행기가 만든 결과 파일은
 *     고치지 않은 채 위치(파일·개수)만 알려 준다(산출물 원본을 바꾸지 않는다).
 *   - 앱 종료 정리: 앱이 꺼질 때 남은 실행 프로세스를 끝낸다(윈도우는 부모가 끝나도 자식이 남는다).
 *
 * OS 수준 격리는 실행기마다 다르다. Codex 는 자체 Windows 제한 토큰 샌드박스(읽기 전용·작업 폴더 쓰기, 네트워크 차단)를
 * 쓰고, Claude Code 는 도구 제한(--restricted·--tools)으로 명령 실행·웹 조회를 없앤다. 이 모듈은 그 위에 환경·자원 제한을 더한다.
 */
import { execFile, spawnSync } from "node:child_process";
import path from "node:path";

const baseAllowedEnv = [
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "SYSTEMDRIVE", "TEMP", "TMP", "TMPDIR",
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME", "APPDATA", "LOCALAPPDATA",
  "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "OS", "USERNAME", "USERDOMAIN", "PSMODULEPATH",
  "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TERM", "TZ", "SHELL", "USER", "LOGNAME",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR",
  "CODEX_HOME", "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_GIT_BASH_PATH",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR",
];
/** 이름에 이런 말이 들어간 변수는 허용 목록에 있어도 따로 허락한 경우가 아니면 넘기지 않는다. */
const secretNamePattern = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|SESSION|PRIVATE)/iu;

/**
 * 자식 프로세스 환경을 허용 목록으로 만든다. extraAllowed 는 실행기별 추가 허용(예: Claude 구독 토큰).
 * 윈도우는 변수 이름의 대소문자를 구분하지 않으므로 원래 이름을 그대로 쓰되 비교는 대문자로 한다.
 */
export function buildChildEnv(source = process.env, { extraAllowed = [], set = {} } = {}) {
  const allowed = new Set([...baseAllowedEnv, ...extraAllowed].map((name) => name.toUpperCase()));
  const explicitlyAllowedSecrets = new Set(extraAllowed.map((name) => name.toUpperCase()));
  const env = {};
  for (const [name, value] of Object.entries(source ?? {})) {
    if (typeof value !== "string") continue;
    const upper = name.toUpperCase();
    if (!allowed.has(upper)) continue;
    if (secretNamePattern.test(upper) && !explicitlyAllowedSecrets.has(upper)) continue;
    env[name] = value;
  }
  for (const [name, value] of Object.entries(set)) if (typeof value === "string") env[name] = value;
  return env;
}

/** 허용 목록 밖으로 빠진 변수 이름만 돌려준다(값은 돌려주지 않는다). 검증·보고용. */
export function droppedEnvNames(source, env) {
  const kept = new Set(Object.keys(env).map((name) => name.toUpperCase()));
  return Object.keys(source ?? {}).filter((name) => !kept.has(name.toUpperCase())).sort();
}

// ── 비밀값 가림 ───────────────────────────────────────────────────────────────
const secretPatterns = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, "[개인 키 가림]"],
  [/\b(?:sk-(?:ant-|proj-)?|ghp_|gho_|ghs_|ghu_|github_pat_|xox[abposr]-|AIza|glpat-)[A-Za-z0-9_-]{16,}\b/gu, "[접속 키 가림]"],
  [/\bAKIA[0-9A-Z]{16}\b/gu, "[접속 키 가림]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu, "[인증 토큰 가림]"],
];
const passwordPattern = /\b(password|passwd|pwd|secret|비밀번호)(\s*[:=]\s*)(["']?)([^\s"',;]{4,})\3/giu;

/** 문자열의 비밀값을 가리고 가린 횟수를 함께 돌려준다. */
export function redactSecretsWithCount(value) {
  let text = String(value ?? "");
  let count = 0;
  for (const [pattern, label] of secretPatterns) {
    text = text.replace(pattern, () => { count += 1; return label; });
  }
  text = text.replace(passwordPattern, (_match, name, sep, quote) => { count += 1; return name + sep + quote + "[가림]" + quote; });
  return { text, count };
}

export function redactSecrets(value) {
  return redactSecretsWithCount(value).text;
}

const textExtensions = new Set([".md", ".txt", ".json", ".html", ".htm", ".csv", ".tsv", ".xml", ".yaml", ".yml", ".log", ".js", ".mjs", ".ts", ".tsx", ".css", ".py", ".sh", ".ps1", ".diff", ".patch", ".env"]);

/**
 * 결과 폴더의 텍스트 파일에서 비밀값처럼 보이는 문자열을 센다. 파일은 고치지 않는다(산출물 원본 보존).
 * 2MB 넘는 파일과 이진 파일은 건너뛰고, 건너뛴 수도 함께 돌려준다.
 */
export async function scanTextFilesForSecrets(io, dir, { maxBytes = 2 * 1024 * 1024, maxFiles = 300 } = {}) {
  let files = 0;
  let skipped = 0;
  const hits = [];
  const visit = async (folder) => {
    let entries;
    try { entries = await io.readdir(folder, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files >= maxFiles) return;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) { if (!entry.isSymbolicLink?.()) await visit(full); continue; }
      if (!entry.isFile() || !textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      try {
        const info = await io.stat(full);
        if (info.size > maxBytes) { skipped += 1; continue; }
        files += 1;
        const { count } = redactSecretsWithCount(await io.readFile(full, "utf8"));
        if (count > 0) hits.push({ path: path.relative(dir, full).replaceAll("\\", "/"), count });
      } catch { skipped += 1; }
    }
  };
  await visit(dir);
  return { files, skipped, hits };
}

// ── 메모리 한도 ───────────────────────────────────────────────────────────────
/** 프로세스 목록에서 rootPid 와 그 자손의 메모리 합을 구한다. rows: [{pid, ppid, bytes}] */
export function sumProcessTreeBytes(rows, rootPid) {
  const children = new Map();
  const bytesByPid = new Map();
  for (const row of rows) {
    bytesByPid.set(row.pid, row.bytes);
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row.pid);
  }
  let total = 0;
  const seen = new Set();
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    total += bytesByPid.get(pid) ?? 0;
    for (const child of children.get(pid) ?? []) if (child !== pid) stack.push(child);
  }
  return total;
}

function execFileText(command, args, timeout) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolve(error ? "" : String(stdout ?? "")));
  });
}

/** 실제 운영체제에서 프로세스 묶음의 메모리(작업 집합/RSS) 합을 잰다. 재지 못하면 null. */
export async function probeProcessTreeBytes(rootPid, platform = process.platform) {
  if (!Number.isInteger(rootPid)) return null;
  if (platform === "win32") {
    const out = await execFileText("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize | ForEach-Object { \"$($_.ProcessId),$($_.ParentProcessId),$($_.WorkingSetSize)\" }"], 15_000);
    const rows = out.split(/\r?\n/u).map((line) => line.trim().split(",")).filter((parts) => parts.length === 3)
      .map(([pid, ppid, bytes]) => ({ pid: Number(pid), ppid: Number(ppid), bytes: Number(bytes) || 0 }))
      .filter((row) => Number.isInteger(row.pid));
    return rows.length ? sumProcessTreeBytes(rows, rootPid) : null;
  }
  const out = await execFileText("ps", ["-A", "-o", "pid=,ppid=,rss="], 10_000);
  const rows = out.split(/\r?\n/u).map((line) => line.trim().split(/\s+/u)).filter((parts) => parts.length === 3)
    .map(([pid, ppid, rss]) => ({ pid: Number(pid), ppid: Number(ppid), bytes: (Number(rss) || 0) * 1024 }));
  return rows.length ? sumProcessTreeBytes(rows, rootPid) : null;
}

/**
 * 실행 중인 프로세스 묶음의 메모리를 주기적으로 잰다. maxBytes 를 넘으면 onExceeded 를 한 번 부른다.
 * 재기에 실패하면 한도를 추측하지 않고 계속 실행한다(peakBytes 는 잰 값만 기록).
 */
export function startResourceWatch({ pid, maxBytes, intervalMs = 10_000, probe = probeProcessTreeBytes, onExceeded }) {
  let stopped = false;
  let peakBytes = 0;
  let samples = 0;
  let timer = null;
  const tick = async () => {
    if (stopped) return;
    const bytes = await probe(pid).catch(() => null);
    if (stopped) return;
    if (typeof bytes === "number" && Number.isFinite(bytes)) {
      samples += 1;
      peakBytes = Math.max(peakBytes, bytes);
      if (maxBytes > 0 && bytes > maxBytes) { stopped = true; onExceeded?.(bytes); return; }
    }
    timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, Math.min(intervalMs, 2_000));
  return {
    stop() { stopped = true; if (timer) clearTimeout(timer); },
    get peakBytes() { return peakBytes; },
    get samples() { return samples; },
  };
}

// ── 앱 종료 정리 ──────────────────────────────────────────────────────────────
const liveChildren = new Map();

export function registerLiveChild(child) {
  if (child && Number.isInteger(child.pid)) liveChildren.set(child.pid, child);
  return () => { if (child && Number.isInteger(child.pid)) liveChildren.delete(child.pid); };
}

export function liveChildCount() {
  return liveChildren.size;
}

/** 남아 있는 실행 프로세스를 묶음째 바로 끝낸다(동기). 앱 종료 직전에 부른다. */
export function killAllLiveChildrenSync(platform = process.platform, spawnSyncFn = spawnSync) {
  let killed = 0;
  for (const [pid, child] of liveChildren) {
    try {
      if (platform === "win32") {
        const result = spawnSyncFn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, timeout: 5_000, stdio: "ignore" });
                                                                                         
        // 제한 시간을 넘기거나 실패하면, 적어도 직접 띄운 프로세스는 바로 끝내 앱 종료 뒤에 남지 않게 한다.
        if (!result || result.error || result.status !== 0) child.kill("SIGKILL");
      } else child.kill("SIGKILL");
      killed += 1;
    } catch { /* 이미 끝난 프로세스 */ }
    liveChildren.delete(pid);
  }
  return killed;
}

