import { execFile, spawn } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const manifestFileName = "toolchain-manifest.json";
const manifestSchemaVersion = 2;

/**
 * 도구 확인 실행 규칙.
 * 예전에는 5개 도구를 5초 제한으로 한꺼번에 띄워, 앱 시작 직후처럼 메인 프로세스나 PC가 바쁠 때
 * 정상 도구도 "Command failed" 로 끝났다(시간 초과로 강제 종료되면 출력도 사라진다).
 */
export const toolchainProbeDefaults = Object.freeze({
  timeoutMs: 20_000, // 한 번 실행을 기다리는 시간
  retries: 1, // 시간 초과일 때만 한 번 더 시도
  concurrency: 2, // 동시에 띄우는 확인 프로세스 수
  budgetMs: 75_000, // 한 번의 전체 점검 상한 — 화면이 끝없이 기다리지 않게
  statusCacheMs: 30_000, // 화면 이동·새로고침마다 프로세스를 다시 띄우지 않도록 짧게 재사용
});

const requiredTools = [
  {
    id: "git",
    // 앱 핵심 기능(메일·일정·문서·승인)은 이 도구를 쓰지 않는다. 채팅 화면의 "준비 필요" 경고 대상은
    // 아니지만(optional), Windows 설치본에는 앱과 함께 들어 있어야 한다(bundledWithApp).
    optional: true,
    bundledWithApp: true,
    label: "Git",
    command: "git",
    args: ["--version"],
    purpose: "프로젝트 복제, 변경 추적, 코드 작업 기록",
    particles: { object: "을", subject: "이", topic: "은" },
    bundledCandidates: [
      ["toolchain", "git", "cmd", "git.exe"],
      ["toolchain", "git", "ucrt64", "bin", "git.exe"],
      ["toolchain", "git", "mingw64", "bin", "git.exe"],
      ["toolchain", "git", "bin", "git.exe"],
    ],
  },
  {
    id: "node",
    optional: true,
    bundledWithApp: true,
    label: "Node.js",
    command: "node",
    args: ["--version"],
    purpose: "자동화 스크립트와 개발 도구 실행",
    particles: { object: "를", subject: "가", topic: "는" },
    bundledCandidates: [
      ["toolchain", "node", "node.exe"],
      ["toolchain", "nodejs", "node.exe"],
    ],
  },
  {
    id: "python",
    optional: true,
    bundledWithApp: true,
    label: "Python",
    command: "python",
    args: ["--version"],
    fallbackCommand: "py",
    fallbackArgs: ["--version"],
    purpose: "문서/파일 분석, 로컬 업무 자동화 보조",
    particles: { object: "을", subject: "이", topic: "은" },
    bundledCandidates: [
      ["toolchain", "python", "python.exe"],
      ["toolchain", "python", "bin", "python.exe"],
    ],
  },
  {
    id: "rg",
    optional: true,
    bundledWithApp: true,
    label: "ripgrep",
    command: "rg",
    args: ["--version"],
    purpose: "로컬 파일/프로젝트 빠른 검색",
    // 사용자용 이름("빠른 파일 검색") 기준 조사
    particles: { object: "을", subject: "이", topic: "은" },
    bundledCandidates: [
      ["toolchain", "ripgrep", "rg.exe"],
      // Codex CLI 패키지 안에도 같은 ripgrep 이 들어 있다(이전 설치본 호환).
      ["toolchain", "codex", "codex-path", "rg.exe"],
    ],
  },
  {
    id: "codex",
    bundledWithApp: true,
    label: "Codex CLI",
    command: "codex",
    args: ["--version"],
    fallbackCommand: "codex.cmd",
    fallbackArgs: ["--version"],
    purpose: "앱 안 AI 채팅의 백그라운드 답변 생성 예비 경로",
    redistributionPolicy: "bundled_after_apache_2_0_license_review",
    // 사용자용 이름("AI 연결 복구 도구") 기준 조사
    particles: { object: "를", subject: "가", topic: "는" },
    bundledCandidates: [
      ["toolchain", "codex", "bin", "codex.exe"],
      ["toolchain", "codex", "codex.exe"],
      ["toolchain", "codex", "codex.cmd"],
    ],
  },
];

export async function handleToolchainMessage(_event, payload = {}, options = {}) {
  const kind = String(payload.kind ?? "status");

  if (kind === "status") {
    return getToolchainStatus({ ...options, force: payload.force === true });
  }

  if (kind === "prepare") {
    return prepareToolchain({ ...options, trigger: "user" });
  }

  if (kind === "install_codex") {
    return installCodexRecoveryTool(payload, options);
  }

  throw new Error(`unsupported toolchain kind: ${kind}`);
}

const codexGuidedInstallCommand = "npm install -g @openai/codex";

export async function installCodexRecoveryTool(payload = {}, options = {}) {
  const startedAt = getNow(options);
  const base = {
    installMode: "guided_user_approved_install_or_official_fallback",
    installCommand: codexGuidedInstallCommand,
    requiresUserApproval: true,
    approvedByUser: payload.approved === true,
    fallbackRoute: "openai_or_gemini_api_connection",
    startedAt,
    externalMutation: false,
    localMachineInstallPerformed: false,
    globalInstallPerformed: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };

  if (payload.approved !== true) {
    return {
      ...base,
      status: "codex_install_approval_required",
      userMessage: "AI 연결 복구 도구 설치는 사용자가 설치 버튼으로 직접 승인한 뒤에만 진행합니다.",
    };
  }

  const codexTool = requiredTools.find((tool) => tool.id === "codex");
  const alreadyDetected = await detectTool(codexTool, createProbeContext(options));
  if (alreadyDetected.status === "ready") {
    return {
      ...base,
      status: "codex_install_already_ready",
      tool: alreadyDetected,
      userMessage: "AI 연결 복구 도구가 이미 준비되어 있습니다. 이제 AI 브라우저 로그인만 하면 됩니다.",
    };
  }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmProbe = await createProbeContext(options).run(npmCommand, ["--version"]);
  if (!npmProbe.ok) {
    return {
      ...base,
      status: "codex_install_npm_missing",
      userMessage:
        "이 PC에서 설치 도우미(npm)를 찾지 못해 자동 설치를 진행할 수 없습니다. 공식 설치 안내 또는 대체 AI 연결을 사용해 주세요.",
    };
  }

  const runInstall =
    typeof options.runInstallCommand === "function"
      ? options.runInstallCommand
      : async () => {
          try {
            const result = await execFileAsync(npmCommand, ["install", "-g", "@openai/codex"], {
              timeout: 240000,
              windowsHide: true,
              maxBuffer: 512 * 1024,
              shell: process.platform === "win32",
            });
            return { ok: true, stdout: sanitizeOneLine(result.stdout), stderr: sanitizeOneLine(result.stderr) };
          } catch (error) {
            return {
              ok: false,
              stdout: sanitizeOneLine(error?.stdout),
              stderr: sanitizeOneLine(error?.stderr || error?.message),
            };
          }
        };

  const installResult = await runInstall(codexGuidedInstallCommand);
  const finishedAt = getNow(options);
  resetToolchainStatusCache();
  if (!installResult.ok) {
    return {
      ...base,
      status: "codex_install_failed",
      finishedAt,
      output: sanitizeOneLine(installResult.stderr || installResult.stdout || ""),
      userMessage:
        "AI 연결 복구 도구 설치가 완료되지 않았습니다. 공식 설치 안내 또는 대체 AI 연결을 사용할 수 있습니다.",
    };
  }

  const detectedAfterInstall = await detectTool(codexTool, createProbeContext(options));
  const installVerified = detectedAfterInstall.status === "ready";
  return {
    ...base,
    status: installVerified ? "codex_install_completed" : "codex_install_failed",
    finishedAt,
    output: sanitizeOneLine(installResult.stdout || ""),
    tool: detectedAfterInstall,
    localMachineInstallPerformed: true,
    globalInstallPerformed: true,
    userMessage: installVerified
      ? "AI 연결 복구 도구 설치가 끝났습니다. 이제 AI 브라우저 로그인으로 이어서 연결해 주세요."
      : "설치 명령은 끝났지만 도구 확인에 실패했습니다. 앱을 다시 시작하거나 대체 AI 연결을 사용해 주세요.",
  };
}

let sharedStatus = null;
let sharedPending = null;

/** 다음 상태 확인이 캐시를 쓰지 않고 새로 점검하게 한다(설치 직후·테스트용). */
export function resetToolchainStatusCache() {
  sharedStatus = null;
  sharedPending = null;
}

/**
 * 도구 상태 확인. 같은 앱에서 동시에 들어온 확인은 하나로 합치고(시작 점검 + 화면 진입 등),
 * 시간 초과가 없던 결과는 짧게 재사용한다. force=true 면 새로 점검한다.
 */
export async function getToolchainStatus(options = {}) {
  if (!usesSharedStatusCache(options)) return computeToolchainStatus(options);
  const key = statusCacheKey(options);
  if (sharedPending && sharedPending.key === key) return sharedPending.promise;
  if (options.force !== true && sharedStatus && sharedStatus.key === key && Date.now() - sharedStatus.at < sharedStatus.ttlMs) {
    return { ...sharedStatus.result, cached: true };
  }
  const entry = { key, promise: null };
  entry.promise = computeToolchainStatus(options).then((result) => {
    const hadTimeout = result.tools.some((tool) => tool.reason === "timeout");
    sharedStatus = { key, at: Date.now(), ttlMs: hadTimeout ? 0 : resolveCacheMs(options), result };
    return result;
  });
  sharedPending = entry;
  try {
    return await entry.promise;
  } finally {
    if (sharedPending === entry) sharedPending = null;
  }
}

async function computeToolchainStatus(options = {}) {
  const startedAtMs = Date.now();
  const checkedAt = getNow(options);
  const toolchainRoot = resolveToolchainRoot(options);
  const ctx = createProbeContext(options);
  const [manifest, tools] = await Promise.all([
    readManifest(toolchainRoot),
    Promise.all(requiredTools.map((tool) => ctx.limit(() => detectTool(tool, ctx)))),
  ]);
  const missing = tools.filter((tool) => tool.status !== "ready");
  // 앱 기능을 실제로 막는 것은 optional=false 도구뿐이다. optional 도구가 없다고
  // 사용자에게 "준비 필요"를 띄우면 거짓 경고가 된다.
  const requiredMissing = missing.filter((tool) => tool.optional !== true);
  const readyCount = tools.length - missing.length;
  const bundle = createBundleRecord(tools, ctx);

  return {
    status: missing.length === 0 ? "toolchain_ready" : "toolchain_needs_prepare",
    checkedAt,
    toolchainRoot,
    manifest,
    tools,
    readyCount,
    missingCount: missing.length,
    missingToolIds: missing.map((tool) => tool.id),
    requiredMissingCount: requiredMissing.length,
    requiredMissingToolIds: requiredMissing.map((tool) => tool.id),
    bundle,
    devToolsReady: missing.length === 0,
    attentionToolIds: missing.map((tool) => tool.id),
    probe: {
      timeoutMs: ctx.timeoutMs,
      retries: ctx.retries,
      concurrency: ctx.concurrency,
      budgetMs: ctx.budgetMs,
      durationMs: Date.now() - startedAtMs,
      cached: false,
    },
    embeddedRuntime: createEmbeddedRuntimeRecord(options),
    installPlan: createInstallPlan(missing),
    userMessage: createStatusMessage(tools, ctx),
    externalMutation: false,
    globalInstallPerformed: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/** 사용자가 누른 "다시 확인"(또는 시작 점검): 새로 점검하고 앱 데이터 폴더에 점검 기록을 남긴다. */
export async function prepareToolchain(options = {}) {
  const status = await getToolchainStatus({ ...options, force: options.force !== false });
  const preparedAt = getNow(options);
  const toolchainRoot = resolveToolchainRoot(options);
  await mkdir(toolchainRoot, { recursive: true });
  const requiredMissingCount = status.requiredMissingCount ?? status.missingCount;

  const manifest = {
    schemaVersion: manifestSchemaVersion,
    preparedAt,
    checkedAt: status.checkedAt,
    trigger: String(options.trigger ?? "user"),
    appVersion: readAppVersion(options.app),
    toolchainRoot,
    externalMutation: false,
    globalInstallPerformed: false,
    bundle: status.bundle,
    probe: status.probe,
    embeddedRuntime: status.embeddedRuntime,
    tools: status.tools,
    installPlan: status.installPlan,
    nextAction: resolveNextAction(status),
  };

  const manifestPath = path.join(toolchainRoot, manifestFileName);
  await writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    ...status,
    status: requiredMissingCount === 0 ? "toolchain_prepared" : "toolchain_prepare_recorded",
    preparedAt,
    manifestPath,
    manifest,
    userMessage: createPreparedMessage(status),
    externalMutation: false,
    globalInstallPerformed: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/**
 * 앱 시작 후 한 번 도구를 점검하고 점검 기록(toolchain-manifest.json)을 남긴다.
 * 시작을 막지 않도록 절대 throw 하지 않는다. 이미 진행 중이거나 방금 끝난 점검이 있으면 그 결과를 쓴다.
 */
export async function ensureToolchainOnStartup(options = {}) {
  const log = typeof options.log === "function" ? options.log : (message) => console.info(message);
  try {
    const result = await prepareToolchain({ ...options, force: false, trigger: "startup" });
    log(`[toolchain] 시작 점검: ${summarizeForLog(result)}`);
    return result;
  } catch (error) {
    const message = sanitizeOneLine(error?.message || error);
    log(`[toolchain] 시작 점검을 마치지 못했습니다: ${message}`);
    return {
      status: "toolchain_startup_check_failed",
      tools: [],
      error: message,
      userMessage: "개발 도구 시작 점검을 마치지 못했습니다. 개발 작업실에서 다시 확인할 수 있습니다.",
      externalMutation: false,
      globalInstallPerformed: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
}

async function detectTool(tool, ctx) {
  const checks = [];
  const bundled = findBundledCandidate(tool, ctx);
  let bundledFailure = null;
  if (bundled) {
    const result = await probeWithRetry(bundled.path, tool.args, ctx);
    checks.push(summarizeCheck("bundled", bundled.relative, result));
    if (result.ok) return createToolRecord(tool, "ready", result, "bundled", { ctx, bundled, checks });
    // 동봉본이 깨져도 PC에 정상 설치본이 있으면 그것을 쓴다.
    bundledFailure = result;
  }

  let pathFailure = null;
  const tried = new Set();
  for (const [command, args] of pathCommandsFor(tool)) {
    const target = ctx.resolve(command);
    if (!target) {
      const notFound = { ok: false, command, stdout: "", stderr: "", firstLine: "", reason: "not_found", reasonDetail: "PATH 에서 찾지 못함", attempts: 0, durationMs: 0 };
      checks.push(summarizeCheck("path", command, notFound));
      pathFailure ??= notFound;
      continue;
    }
    const identity = String(target).toLowerCase();
    if (tried.has(identity)) continue;
    tried.add(identity);
    const result = await probeWithRetry(target, args, ctx);
    checks.push(summarizeCheck("path", command, result));
    if (result.ok) return createToolRecord(tool, "ready", result, "path", { ctx, checks });
    pathFailure = pickInformativeFailure(pathFailure, result);
  }

  if (bundledFailure) {
    return createToolRecord(tool, "installed_but_unusable", bundledFailure, "bundled", { ctx, bundled, checks });
  }
  const failure = pathFailure ?? { ok: false, command: tool.command, stdout: "", stderr: "", firstLine: "", reason: "not_found" };
  const expectedInBundle = ctx.expectBundled && tool.bundledWithApp === true;
  // 설치본이라면 동봉 파일이 있어야 한다. 없으면 PC 쪽 실패 이유보다 "설치 파일 손상"이 핵심 원인이다.
  const reason = expectedInBundle ? "bundle_missing" : failure.reason ?? "not_found";
  return createToolRecord(tool, "missing", { ...failure, reason }, "none", { ctx, checks });
}

function pathCommandsFor(tool) {
  const commands = [[tool.command, tool.args]];
  if (tool.fallbackCommand) commands.push([tool.fallbackCommand, tool.fallbackArgs ?? tool.args]);
  return commands;
}

function pickInformativeFailure(previous, next) {
  if (!previous) return next;
  // "찾지 못함"보다 실제로 실행했다가 실패한 이유가 더 쓸모 있다.
  return previous.reason === "not_found" && next.reason !== "not_found" ? next : previous;
}

async function probeWithRetry(command, args, ctx) {
  let result = await ctx.run(command, args);
  let attempts = 1;
  while (!result.ok && result.reason === "timeout" && !result.skipped && attempts <= ctx.retries) {
    attempts += 1;
    result = { ...(await ctx.run(command, args)), retriedAfter: "timeout" };
  }
  return { ...result, attempts };
}

function createProbeContext(options = {}) {
  const injected = typeof options.runCommand === "function" ? options.runCommand : null;
  const timeoutMs = positiveNumber(options.probeTimeoutMs, toolchainProbeDefaults.timeoutMs);
  const retries = nonNegativeInteger(options.probeRetries, toolchainProbeDefaults.retries);
  const concurrency = Math.max(1, nonNegativeInteger(options.probeConcurrency, toolchainProbeDefaults.concurrency));
  const budgetMs = positiveNumber(options.probeBudgetMs, toolchainProbeDefaults.budgetMs);
  const deadline = Date.now() + budgetMs;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = typeof options.exists === "function" ? options.exists : existsSync;
  const resourcesPath = resolveResourcesPath(options);
  const packaged = resolvePackaged(options);
  return {
    platform,
    env,
    exists,
    resourcesPath,
    packaged,
    // 동봉 도구는 Windows 설치본에만 들어 있다(mac/Linux 미리보기 패키지는 toolchain 을 제외).
    expectBundled: packaged && platform === "win32" && Boolean(resourcesPath),
    timeoutMs,
    retries,
    concurrency,
    budgetMs,
    limit: createLimiter(concurrency),
    resolve(command) {
      if (injected) return command;
      return resolveExecutable(command, { env, platform });
    },
    async run(command, args) {
      const remaining = deadline - Date.now();
      if (remaining < 500) {
        return { ok: false, command: String(command), stdout: "", stderr: "", firstLine: "", reason: "timeout", reasonDetail: "전체 점검 시간 상한 도달", skipped: true, durationMs: 0 };
      }
      if (injected) {
        try {
          return normalizeInjectedResult(await injected(command, args), command);
        } catch (error) {
          return { ok: false, command: String(command), stdout: "", stderr: sanitizeOneLine(error?.message), firstLine: "", reason: "spawn_failed", reasonDetail: sanitizeOneLine(error?.message), durationMs: 0 };
        }
      }
      return runToolProbe(command, args, { timeoutMs: Math.min(timeoutMs, remaining), env, platform });
    },
  };
}

function createLimiter(maxConcurrent) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= maxConcurrent || queue.length === 0) return;
    active += 1;
    const { task, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (task) =>
    new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      next();
    });
}

function normalizeInjectedResult(result, command) {
  const value = result && typeof result === "object" ? result : {};
  const ok = value.ok === true;
  const stdout = sanitizeOneLine(value.stdout);
  const stderr = sanitizeOneLine(value.stderr);
  return {
    ok,
    command: String(value.command ?? command),
    stdout,
    stderr,
    firstLine: firstOutputLine(value.stdout) || firstOutputLine(value.stderr),
    exitCode: Number.isInteger(value.exitCode) ? value.exitCode : ok ? 0 : null,
    ...(ok ? {} : { reason: value.reason ?? inferFailureReason(`${stderr} ${stdout}`), reasonDetail: value.reasonDetail ? sanitizeOneLine(value.reasonDetail) : "" }),
    skipped: value.skipped === true,
    durationMs: Number(value.durationMs) || 0,
  };
}

function inferFailureReason(text) {
  if (/ENOENT|not found|not recognized|찾을 수 없/i.test(text)) return "not_found";
  if (/timed? ?out|ETIMEDOUT|시간 초과/i.test(text)) return "timeout";
  if (/EACCES|EPERM|access is denied|액세스가 거부/i.test(text)) return "blocked";
  return "exit_code";
}

/**
 * 도구 하나를 실제로 실행해 본다(테스트에서도 직접 쓴다).
 * - 이름만 주면 PATH(+PATHEXT)에서 찾는다. 찾지 못하면 실행하지 않고 not_found.
 * - Windows .cmd/.bat(npm 이 만든 codex.cmd 같은 shim)은 cmd.exe 로 실행한다.
 * - 결과 이유: timeout / exit_code / not_found / blocked / spawn_failed / killed.
 * - 손자 프로세스가 출력 파이프를 붙잡아도 끝없이 기다리지 않는다.
 */
export async function runToolProbe(command, args = [], options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const timeoutMs = positiveNumber(options.timeoutMs, toolchainProbeDefaults.timeoutMs);
  const startedAtMs = Date.now();
  const requested = String(command ?? "");
  const target = path.isAbsolute(requested) ? (isRunnableFile(requested, platform) ? requested : null) : resolveExecutable(requested, { env, platform });
  const base = { command: target ?? requested, stdout: "", stderr: "", firstLine: "" };
  if (!target) {
    return { ...base, ok: false, reason: "not_found", reasonDetail: path.isAbsolute(requested) ? "파일 없음" : "PATH 에서 찾지 못함", exitCode: null, durationMs: Date.now() - startedAtMs };
  }

  const probeArgs = (Array.isArray(args) ? args : []).map(String);
  const isBatch = platform === "win32" && /\.(cmd|bat)$/i.test(target);
  let file = target;
  let spawnArgs = probeArgs;
  const spawnOptions = { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env, shell: false };
  if (isBatch) {
    // 경로와 고정 인자만 큰따옴표로 감싸 한 줄 명령으로 넘긴다. 위험 문자가 있으면 실행하지 않는다.
    if (/["%^&|<>]/.test(target) || probeArgs.some((arg) => !/^[A-Za-z0-9._=:/-]+$/.test(arg))) {
      return { ...base, ok: false, reason: "spawn_failed", reasonDetail: "안전하지 않은 명령 경로", exitCode: null, durationMs: Date.now() - startedAtMs };
    }
    file = readEnvValue(env, "ComSpec") || process.env.ComSpec || "cmd.exe";
    spawnArgs = ["/d", "/s", "/c", `"${[`"${target}"`, ...probeArgs].join(" ")}"`];
    spawnOptions.windowsVerbatimArguments = true;
  }

  return new Promise((resolve) => {
    let child = null;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let exitTimer = null;
    let deadlineTimer = null;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(exitTimer);
      try {
        child?.stdout?.destroy();
        child?.stderr?.destroy();
      } catch {
        // 이미 닫힌 스트림
      }
      resolve({
        ...base,
        stdout: sanitizeOneLine(stdout),
        stderr: sanitizeOneLine(stderr),
        firstLine: firstOutputLine(stdout) || firstOutputLine(stderr),
        durationMs: Date.now() - startedAtMs,
        ...outcome,
      });
    };
    try {
      child = spawn(file, spawnArgs, spawnOptions);
    } catch (error) {
      finish(classifySpawnError(error));
      return;
    }
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      if (stdout.length < 16_384) stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < 16_384) stderr += chunk;
    });
    child.on("error", (error) => finish(classifySpawnError(error)));
    child.on("close", (code, signal) => finish(classifyExit(code, signal)));
    child.on("exit", (code, signal) => {
      // 출력 파이프를 물려받은 손자 프로세스가 남아 close 가 늦어도 결과를 확정한다.
      exitTimer = setTimeout(() => finish(classifyExit(code, signal)), 750);
    });
    deadlineTimer = setTimeout(() => {
      // 메인 프로세스가 바빠 타이머가 늦게 돌았다면, 그동안 쌓인 종료·출력 이벤트를 먼저 처리한 뒤 판정한다.
      setImmediate(() =>
        setImmediate(() => {
          if (settled) return;
          killProbe(child, isBatch, platform);
          finish({ ok: false, reason: "timeout", reasonDetail: `${Math.round(timeoutMs / 1000)}초 안에 응답 없음`, exitCode: null });
        }),
      );
    }, timeoutMs);
  });
}

function classifySpawnError(error) {
  const code = String(error?.code ?? "");
  if (code === "ENOENT") return { ok: false, reason: "not_found", reasonDetail: "ENOENT", exitCode: null };
  if (code === "EACCES" || code === "EPERM") return { ok: false, reason: "blocked", reasonDetail: code, exitCode: null };
  return { ok: false, reason: "spawn_failed", reasonDetail: code || sanitizeOneLine(error?.message), exitCode: null };
}

const knownWindowsExitCodes = new Map([
  [0xc0000135, "실행에 필요한 DLL 없음"],
  [0xc0000142, "DLL 초기화 실패"],
  [0xc0000005, "접근 위반으로 종료"],
  [0xc000007b, "실행 파일 형식 오류"],
]);

function classifyExit(code, signal) {
  if (code === 0) return { ok: true, exitCode: 0 };
  if ((code === null || code === undefined) && signal) return { ok: false, reason: "killed", reasonDetail: `신호 ${signal}`, exitCode: null };
  const unsigned = Number(code) >>> 0;
  // cmd.exe 와 Microsoft Store 의 python 별칭은 "명령을 찾지 못함"을 9009 로 알린다.
  if (unsigned === 9009) return { ok: false, reason: "not_found", reasonDetail: "종료 코드 9009", exitCode: code };
  const known = knownWindowsExitCodes.get(unsigned);
  return {
    ok: false,
    reason: "exit_code",
    reasonDetail: known ? `${known} (0x${unsigned.toString(16).toUpperCase()})` : `종료 코드 ${code}`,
    exitCode: code,
  };
}

function killProbe(child, isBatch, platform) {
  if (!child) return;
  const pid = child.pid;
  if (platform === "win32" && isBatch && Number.isInteger(pid)) {
    // cmd.exe 만 끝내면 그 아래 node/codex 가 남는다. 프로세스 트리째 정리한다.
    try {
      const killer = spawn("taskkill.exe", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      const fallback = () => {
        try {
          child.kill();
        } catch {
          // 이미 종료됨
        }
      };
      killer.on("error", fallback);
      killer.on("exit", fallback);
      killer.unref();
      return;
    } catch {
      // taskkill 을 못 띄우면 아래 기본 종료로 넘어간다.
    }
  }
  try {
    child.kill();
  } catch {
    // 이미 종료됨
  }
}

/** PATH(+Windows PATHEXT)에서 실행 파일을 찾는다. 현재 폴더는 찾지 않는다. */
export function resolveExecutable(command, { env = process.env, platform = process.platform, exists } = {}) {
  const name = String(command ?? "").trim();
  if (!name) return null;
  const isFile = typeof exists === "function" ? exists : (candidate) => isRunnableFile(candidate, platform);
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (pathApi.isAbsolute(name)) return isFile(name) ? name : null;
  if (/[\\/]/.test(name)) return null;
  const separator = platform === "win32" ? ";" : ":";
  const directories = String(readEnvValue(env, "PATH") ?? "")
    .split(separator)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
  let candidates = [name];
  if (platform === "win32") {
    const runnable = [".exe", ".com", ".cmd", ".bat"];
    const extension = pathApi.extname(name).toLowerCase();
    if (!runnable.includes(extension)) {
      const fromEnv = String(readEnvValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => runnable.includes(entry));
      candidates = (fromEnv.length ? fromEnv : [".com", ".exe", ".bat", ".cmd"]).map((entry) => name + entry);
    }
  }
  for (const directory of directories) {
    for (const candidate of candidates) {
      const full = pathApi.join(directory, candidate);
      if (isFile(full)) return full;
    }
  }
  return null;
}

function isRunnableFile(file, platform = process.platform) {
  try {
    if (!statSync(file).isFile()) return false;
    if (platform !== "win32") accessSync(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readEnvValue(env, name) {
  if (!env) return undefined;
  if (env[name] !== undefined) return env[name];
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

function findBundledCandidate(tool, ctx) {
  if (!ctx.resourcesPath) return null;
  for (const segments of tool.bundledCandidates ?? []) {
    const candidate = path.join(ctx.resourcesPath, ...segments);
    if (ctx.exists(candidate)) return { path: candidate, relative: segments.join("/") };
  }
  return null;
}

function createToolRecord(tool, status, result, source, { ctx, bundled, checks = [] } = {}) {
  const userFacingLabel = getUserFacingToolLabel(tool);
  const ready = status === "ready";
  const firstLine = sanitizeOneLine(result.firstLine || firstOutputLine(result.stdout) || firstOutputLine(result.stderr));
  const version = ready ? parseToolVersion(firstLine) : "";
  const reason = ready ? undefined : result.reason ?? "exit_code";
  return {
    id: tool.id,
    label: tool.label,
    userFacingLabel,
    optional: tool.optional === true,
    status,
    source,
    command: source === "none" ? tool.command : String(result.command ?? tool.command),
    detectedVersion: firstLine,
    version,
    bundledWithApp: Boolean(ctx?.expectBundled && tool.bundledWithApp === true),
    ...(bundled ? { bundledPath: bundled.relative } : {}),
    ...(reason ? { reason, reasonDetail: sanitizeOneLine(result.reasonDetail || "") } : {}),
    attempts: Number(result.attempts) || (ready ? 1 : 0),
    durationMs: Number(result.durationMs) || 0,
    checks,
    purpose: tool.purpose,
    userMessage: describeTool(tool, status, source, reason, version),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function summarizeCheck(source, target, result) {
  return {
    source,
    target: String(target),
    ok: result.ok === true,
    ...(result.ok ? {} : { reason: result.reason ?? "exit_code", reasonDetail: sanitizeOneLine(result.reasonDetail || "") }),
    attempts: Number(result.attempts) || 0,
    durationMs: Number(result.durationMs) || 0,
  };
}

const reasonLabels = {
  timeout: "확인 시간 초과",
  exit_code: "오류로 종료",
  not_found: "파일을 찾지 못함",
  blocked: "실행이 차단됨",
  spawn_failed: "실행하지 못함",
  killed: "강제로 종료됨",
  bundle_missing: "설치 파일에 없음",
};

function describeTool(tool, status, source, reason, version) {
  const label = getUserFacingToolLabel(tool);
  const object = tool.particles?.object ?? "을(를)";
  const subject = tool.particles?.subject ?? "이(가)";
  const versionText = version ? ` (${version})` : "";
  if (status === "ready") {
    return source === "bundled" ? `${label}: 앱과 함께 설치됨${versionText}` : `${label}: 이 PC에 설치된 도구 사용${versionText}`;
  }
  if (status === "installed_but_unusable") {
    const hint =
      reason === "timeout"
        ? "PC가 바쁠 수 있으니 잠시 후 다시 확인해 주세요."
        : reason === "blocked"
          ? "보안 프로그램이나 회사 정책이 실행을 막았는지 확인해 주세요."
          : "보안 프로그램이 파일을 격리했거나 설치 파일이 손상되었을 수 있어 ModyCrew를 다시 설치하면 복구됩니다.";
    return `앱과 함께 설치된 ${label}${object} 실행하지 못했습니다(${reasonLabels[reason] ?? "실행 실패"}). ${hint}`;
  }
  if (reason === "bundle_missing") {
    return `앱과 함께 설치되어야 할 ${label}${subject} 없습니다. 설치 파일이 손상되었을 수 있어 ModyCrew를 다시 설치해야 합니다.`;
  }
  if (reason === "timeout") {
    return `${label} 확인이 시간 안에 끝나지 않았습니다. 잠시 후 다시 확인해 주세요.`;
  }
  return `${label}${object} 이 PC에서 찾지 못했습니다.`;
}

function createBundleRecord(tools, ctx) {
  return {
    expected: ctx.expectBundled,
    platform: ctx.platform,
    toolchainDir: ctx.resourcesPath ? path.join(ctx.resourcesPath, "toolchain") : "",
    bundledReadyToolIds: tools.filter((tool) => tool.status === "ready" && tool.source === "bundled").map((tool) => tool.id),
    pcToolIds: tools.filter((tool) => tool.status === "ready" && tool.source === "path").map((tool) => tool.id),
    missingFromBundleToolIds: tools.filter((tool) => tool.reason === "bundle_missing").map((tool) => tool.id),
    unusableBundledToolIds: tools.filter((tool) => tool.status === "installed_but_unusable").map((tool) => tool.id),
    // 설치본에 있어야 할 동봉 파일이 없지만 이 PC의 도구로 대신 동작하는 경우까지 포함한다.
    filesMissingToolIds: ctx.expectBundled ? tools.filter((tool) => tool.bundledWithApp && !tool.bundledPath).map((tool) => tool.id) : [],
  };
}

function joinLabels(tools) {
  return tools.map((tool) => tool.userFacingLabel || tool.label).join(", ");
}

function createStatusMessage(tools, ctx) {
  const notReady = tools.filter((tool) => tool.status !== "ready");
  const requiredHard = notReady.filter((tool) => tool.optional !== true && tool.reason !== "timeout");
  const bundleProblems = notReady.filter((tool) => tool.bundledWithApp && tool.reason !== "timeout");
  const timeouts = notReady.filter((tool) => tool.reason === "timeout");
  if (requiredHard.length > 0) {
    return `기본 업무 도구 ${requiredHard.length}개가 아직 없습니다. 앱 안에서 준비 상태를 먼저 정리하겠습니다.`;
  }
  if (bundleProblems.length > 0) {
    return `앱과 함께 설치된 개발 도구 중 ${joinLabels(bundleProblems)}에 문제가 있습니다. 설치 파일이 손상되었을 수 있어 ModyCrew를 다시 설치해 주세요.`;
  }
  if (timeouts.length > 0) {
    return `${joinLabels(timeouts)} 확인이 시간 안에 끝나지 않았습니다. PC가 바쁠 수 있으니 잠시 후 다시 확인해 주세요.`;
  }
  if (ctx.expectBundled && notReady.length === 0) {
    return "Git, Node.js, Python, ripgrep, Codex CLI가 모두 준비되어 있습니다.";
  }
  return "이 PC에서 기본 업무 도구를 바로 사용할 수 있습니다.";
}

function createPreparedMessage(status) {
  const tools = Array.isArray(status.tools) ? status.tools : [];
  const requiredMissing = tools.filter((tool) => tool.status !== "ready" && tool.optional !== true);
  if (requiredMissing.length > 0) {
    return `기본 업무 도구 ${requiredMissing.length}개를 사용할 수 없습니다(${joinLabels(requiredMissing)}). 점검 기록을 남겼습니다. AI 연결 복구 도구는 ModyCrew를 다시 설치하거나 설치 버튼으로 승인해 공식 배포 채널에서 받을 수 있고, 그동안 대체 AI 연결로 계속 쓸 수 있습니다.`;
  }
  const notReady = tools.filter((tool) => tool.status !== "ready");
  if (notReady.length > 0) return status.userMessage;
  if (status.bundle?.expected) {
    const bundledCount = status.bundle.bundledReadyToolIds?.length ?? 0;
    const pcCount = status.bundle.pcToolIds?.length ?? 0;
    return pcCount > 0
      ? `개발 도구 확인을 마쳤습니다. ${bundledCount}개는 앱과 함께 설치된 도구, ${pcCount}개는 이 PC의 도구를 씁니다.`
      : "개발 도구 확인을 마쳤습니다. 모두 앱과 함께 설치되어 바로 쓸 수 있습니다.";
  }
  return "기본 업무 도구 확인이 끝났습니다. 이제 이 PC에서 로컬 작업을 바로 실행할 수 있습니다.";
}

function resolveNextAction(status) {
  const tools = Array.isArray(status.tools) ? status.tools : [];
  if (tools.every((tool) => tool.status === "ready")) return "ready";
  const notReady = tools.filter((tool) => tool.status !== "ready");
  if (notReady.some((tool) => tool.bundledWithApp && tool.reason !== "timeout")) return "reinstall_app";
  if (notReady.every((tool) => tool.reason === "timeout")) return "retry_check";
  return "portable_bundle_or_guided_installer_required";
}

function summarizeForLog(result) {
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  const parts = tools.map((tool) => {
    if (tool.status === "ready") return `${tool.id}=${tool.source === "bundled" ? "bundled" : "pc"} ${tool.version || "?"}`;
    return `${tool.id}=${tool.status}(${tool.reason ?? "?"})`;
  });
  const duration = Number(result?.probe?.durationMs);
  return `${parts.join(", ")}${Number.isFinite(duration) ? ` (${duration}ms)` : ""}`;
}

function createEmbeddedRuntimeRecord(options = {}) {
  const versions = options.versions ?? process.versions;
  return {
    status: versions?.node ? "embedded_ready" : "unknown",
    label: "ModyCrew 내장 실행 엔진",
    node: versions?.node ?? "",
    electron: versions?.electron ?? "",
    chrome: versions?.chrome ?? "",
    userMessage:
      "앱 내부 자동화는 내장 실행 엔진으로 처리하고, Git·Node.js 같은 개발 도구는 앱과 함께 설치된 전용 도구를 먼저 씁니다.",
    externalMutation: false,
  };
}

function createInstallPlan(missingTools) {
  return missingTools.map((tool) => {
    const userFacingLabel = tool.userFacingLabel || tool.label;
    const definition = requiredTools.find((candidate) => candidate.id === tool.id);
    const topic = definition?.particles?.topic ?? "은(는)";
    if (tool.id === "codex") {
      return {
        toolId: tool.id,
        label: userFacingLabel,
        technicalLabel: tool.label,
        mode: "guided_user_approved_install_or_official_fallback",
        userMessage:
          tool.reason === "bundle_missing" || tool.status === "installed_but_unusable"
            ? "앱과 함께 설치되는 AI 연결 복구 도구를 쓸 수 없습니다. ModyCrew를 다시 설치하면 복구되고, 설치 버튼으로 승인하면 공식 배포 채널에서 받을 수도 있습니다. 그동안 OpenAI/Gemini 대체 AI 연결을 계속 쓸 수 있습니다."
            : "AI 연결 복구 도구는 라이선스 검토를 마치고 설치팩에 동봉됩니다. 이 PC에서 찾지 못한 경우 설치 버튼으로 승인하면 앱이 공식 배포 채널에서 다시 설치하고, OpenAI/Gemini 대체 AI 연결도 계속 제공합니다.",
        externalMutation: false,
        redistributionRequired: false,
        fallbackRoute: "openai_or_gemini_api_connection",
        guidedInstall: {
          kind: "install_codex",
          command: codexGuidedInstallCommand,
          requiresUserApproval: true,
        },
      };
    }

    if (tool.reason === "timeout") {
      return {
        toolId: tool.id,
        label: userFacingLabel,
        technicalLabel: tool.label,
        mode: "retry_check",
        userMessage: `${userFacingLabel} 확인이 시간 안에 끝나지 않았습니다. 잠시 후 다시 확인해 주세요.`,
        externalMutation: false,
        redistributionRequired: false,
      };
    }

    if (tool.bundledWithApp) {
      return {
        toolId: tool.id,
        label: userFacingLabel,
        technicalLabel: tool.label,
        mode: "reinstall_app",
        userMessage: `${userFacingLabel}${topic} 앱과 함께 설치되는 도구입니다. 설치 파일이 손상되었을 수 있어 ModyCrew를 다시 설치하면 복구됩니다.`,
        externalMutation: false,
        redistributionRequired: false,
      };
    }

    return {
      toolId: tool.id,
      label: userFacingLabel,
      technicalLabel: tool.label,
      mode: "bundled_with_windows_installer",
      userMessage: `${userFacingLabel}${topic} Windows용 ModyCrew 설치본에 함께 들어 있습니다. 지금 실행 환경에서는 찾지 못했습니다.`,
      externalMutation: false,
      redistributionRequired: true,
    };
  });
}

function getUserFacingToolLabel(tool) {
  if (tool.id === "codex") return "AI 연결 복구 도구";
  if (tool.id === "rg") return "빠른 파일 검색";
  return tool.label;
}

async function readManifest(toolchainRoot) {
  try {
    const raw = await readFile(path.join(toolchainRoot, manifestFileName), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeFileAtomic(filePath, text) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, text, "utf8");
    await rename(temporary, filePath);
  } catch {
    // 백신 등이 기존 파일을 잠깐 잡고 있으면 교체 대신 직접 쓴다.
    await rm(temporary, { force: true }).catch(() => {});
    await writeFile(filePath, text, "utf8");
  }
}

function readAppVersion(app) {
  try {
    return typeof app?.getVersion === "function" ? String(app.getVersion()) : "";
  } catch {
    return "";
  }
}

function resolveToolchainRoot(options = {}) {
  const base =
    options.toolchainRoot ||
    (typeof options.app?.getPath === "function"
      ? path.join(options.app.getPath("userData"), "toolchain")
      : path.join(process.cwd(), ".modycrew-toolchain"));
  return path.resolve(String(base));
}

function resolveResourcesPath(options = {}) {
  return String(options.resourcesPath ?? process.resourcesPath ?? "");
}

function resolvePackaged(options = {}) {
  if (typeof options.isPackaged === "boolean") return options.isPackaged;
  return options.app?.isPackaged === true;
}

function usesSharedStatusCache(options = {}) {
  // 테스트가 가짜 실행기를 넣으면 호출마다 결과가 달라야 하므로 공유 캐시를 쓰지 않는다(cacheMs 를 주면 사용).
  return typeof options.runCommand !== "function" || Number.isFinite(options.cacheMs);
}

function resolveCacheMs(options = {}) {
  return Number.isFinite(options.cacheMs) ? Math.max(0, options.cacheMs) : toolchainProbeDefaults.statusCacheMs;
}

function statusCacheKey(options = {}) {
  return [resolveResourcesPath(options), resolveToolchainRoot(options), resolvePackaged(options), options.platform ?? process.platform].join("|");
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function getNow(options = {}) {
  return typeof options.now === "function" ? options.now() : new Date().toISOString();
}

function firstOutputLine(value) {
  return (
    String(value ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

/** "git version 2.56.0.windows.4" → "2.56.0", "v24.22.2" → "24.22.2", "codex-cli 0.162.1" → "0.162.1" */
export function parseToolVersion(text) {
  const match = /(\d+\.\d+(?:\.\d+)?)/.exec(String(text ?? ""));
  return match ? match[1] : "";
}

function sanitizeOneLine(value) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}
