   
                                 
  
                
  
                                                         
                                             
                                              
               
  
                                                   
                                                
                                                       
                                                       
  
                                                   
                                                                  
                          
  
                             
  
                                               
                                                       
                                              
                                          
  
                                                      
                                      
  
                                                                  
                                                 
                                                  
                               
   

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** 프롬프트를 보내고 답을 기다리는 최대 시간. 요즘 모델은 오래 생각한다. */
const defaultCliTimeoutMs = 180_000;
/** 로그인 여부만 묻는 호출. 모델을 부르지 않으므로 짧아도 된다. */
const statusTimeoutMs = 15_000;

/**
 * 구독 CLI 표. 새 제공자는 실측한 뒤에만 한 줄 추가한다.
 *
 * bundledPath: 설치팩에 동봉한 바이너리(라이선스 검토 후 고지와 함께 동봉).
 * pathNames:   PATH 에서 찾을 이름. 사용자가 이미 깔아 둔 것을 그대로 쓴다 —
 *              앱이 몰래 전역 설치를 하지 않는다는 저장소 정책(docs/103)을 따른다.
 */
const subscriptionRuntimes = {
  claude_subscription: {
    providerId: "claude_subscription",
    label: "Claude",
    loginHint: "Claude Pro·Max 계정으로 로그인합니다. API 키는 필요 없습니다.",
    bundledPath: ["toolchain", "claude"],
    pathNames: ["claude.exe", "claude.cmd", "claude"],
    statusArgs: ["auth", "status"],
    loginArgs: ["auth", "login"],
    /** 프롬프트는 stdin 으로 준다 — 명령줄에 실으면 따옴표·줄바꿈에서 깨진다. */
    buildRunArgs: (model) => [
      "-p",
      "--output-format",
      "json",
      ...(model ? ["--model", model] : []),
    ],
  },
};

export function listSubscriptionRuntimeIds() {
  return Object.keys(subscriptionRuntimes);
}

/**
 * 구독 계정의 '계정 기본 모델'. CLI 에 --model 을 넘기지 않고 계정에 딸린 기본 모델을 쓴다.
 * 모델 고르기·저장 흐름은 비어 있지 않은 id 를 요구하므로 이 값을 id 로 쓴다.
 */
export const subscriptionDefaultModelId = "default";

function toCliModel(model) {
  const value = String(model ?? "").trim();
  return !value || /^(default|latest)$/iu.test(value) ? "" : value;
}

/**
 * 로그인 상태로 모델 목록(가용성)을 만든다. 로그인돼 있으면 계정 기본 모델을 쓸 수 있다.
 * 계정이 실제로 어떤 모델을 허용하는지는 CLI 가 부를 때 확인하므로, 목록 자체는
 * 권한 증명이 아니다(availabilityIsNotEntitlementProof).
 */
export function buildSubscriptionModelAvailability(providerId, status, selectedModel = "") {
  const spec = subscriptionRuntimes[providerId];
  const label = spec?.label ?? "구독";
  const checkedAt = new Date().toISOString();
  if (!spec || !status?.installed || !status.loggedIn) {
    return {
      state: "blocked",
      source: "subscription_cli",
      models: [{ id: subscriptionDefaultModelId, label: `${label} 계정 기본 모델`, availability: "blocked", evidence: "cli_login", reason: "connection_required" }],
      checkedAt,
      userMessage: status?.userMessage || `${label} 로그인이 필요합니다.`,
      availabilityIsNotEntitlementProof: true,
    };
  }
  const models = [{ id: subscriptionDefaultModelId, label: `${label} 계정 기본 모델`, availability: "available", evidence: "cli_login" }];
  const chosen = String(selectedModel ?? "").trim();
  if (chosen && chosen !== subscriptionDefaultModelId && !/^latest$/iu.test(chosen)) {
    models.push({ id: chosen.slice(0, 120), label: chosen.slice(0, 120), availability: "available", evidence: "user_selected" });
  }
  return { state: "available", source: "subscription_cli", models, checkedAt, userMessage: status.userMessage, availabilityIsNotEntitlementProof: true };
}

export function getSubscriptionRuntimeSpec(providerId) {
  return subscriptionRuntimes[providerId] ?? null;
}

export function buildSubscriptionRunArgs(providerId, model, { companySharedContext = false } = {}) {
  const spec = subscriptionRuntimes[providerId];
  if (!spec) throw new Error("알 수 없는 AI 연결입니다.");
  const args = spec.buildRunArgs(model);
  // Safe mode preserves OAuth while skipping CLAUDE.md, memory, hooks and plugins.
  // Unsupported older CLIs fail closed; never retry a shared request with tools enabled.
  if (companySharedContext) args.push("--safe-mode", "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands");
  return args;
}

/** PATH 를 직접 훑는다. where/which 를 부르면 셸이 하나 더 뜨고 느리다. */
function findOnSystemPath(fileName) {
  const raw = String(process.env.PATH ?? process.env.Path ?? "");
  for (const rawDir of raw.split(path.delimiter)) {
    const dir = rawDir.trim().replace(/^"|"$/gu, "");
    if (!dir) continue;
    try {
      const candidate = path.join(dir, fileName);
      if (existsSync(candidate)) return candidate;
    } catch {
      // 접근할 수 없는 PATH 항목은 건너뛴다 — 여기서 던지면 탐색이 통째로 멈춘다
    }
  }
  return "";
}

/**
 * 실행 파일을 찾는다. 동봉본을 먼저, 사용자가 이미 깔아 둔 것을 그다음으로 본다.
 *
 * 동봉본을 먼저 보는 이유: 사용자 PC 의 것이 아주 옛 버전이면 플래그가 달라 실패한다.
 * 그렇다고 사용자 것을 무시하지도 않는다 — 동봉본이 없는 개발 환경에서도 돌아야 한다.
 */
export function resolveSubscriptionCliExecutable(providerId, options = {}) {
  const spec = subscriptionRuntimes[providerId];
  if (!spec) return "";

  const explicit = String(options.executablePath ?? "").trim();
  if (explicit && existsSync(explicit)) return explicit;

  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  if (resourcesPath) {
    for (const name of spec.pathNames) {
      for (const candidate of [
        path.join(resourcesPath, ...spec.bundledPath, name),
        path.join(resourcesPath, ...spec.bundledPath, "bin", name),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  for (const name of spec.pathNames) {
    const resolved = findOnSystemPath(name);
    if (resolved) return resolved;
  }
  return "";
}

/**
 * 윈도우에서 .cmd/.bat 은 실행 파일이 아니라 **배치 스크립트**라 spawn 이 바로 못 띄운다
 * (EINVAL). npm 으로 설치하면 claude.cmd 를 받으므로, 이걸 처리하지 않으면
 * "npm 으로 깐 사람만 안 되는" 상태가 된다. cmd.exe 를 거쳐 부른다.
 *
 * shell: true 를 쓰지 않는 이유: 인자가 셸 파싱을 한 번 더 거치면 경로의 공백과
 * 특수문자에서 깨진다. 사용자 질문은 stdin 으로만 가므로 여기 인자는 우리 것뿐이지만,
 * 경로는 사용자 PC 마다 다르다.
 */
function buildSpawnTarget(executable, args) {
  const isBatch = new RegExp("\\.(cmd|bat)$", "iu").test(executable);
  if (!isBatch || process.platform !== "win32") return { command: executable, spawnArgs: args, shell: false };
  const comSpec = process.env.ComSpec || "cmd.exe";
  // /d 프로필 스크립트 건너뜀, /s 따옴표 처리 규칙 고정, /c 실행 후 종료.
  return { command: comSpec, spawnArgs: ["/d", "/s", "/c", executable, ...args], shell: false };
}

/**
 * 자식 프로세스를 그 아래에 딸린 프로세스까지 함께 끝낸다.
 *
 * 윈도우에서 child.kill() 은 바로 띄운 껍데기(cmd.exe·powershell.exe)만 끝낸다.
 * 그 껍데기가 부른 실제 codex/claude 는 뒤에 남아 계속 일하면서 PC 자원과 구독
 * 사용량을 쓴다(시간 초과·'중지' 때마다 하나씩 쌓였다). 그래서 윈도우에서는
 * taskkill /T(딸린 프로세스까지) /F(강제)로 끝낸다. 다른 OS 는 이 경로에서 껍데기를
 * 거치지 않으므로 SIGKILL 로 충분하다.
 *
 * 끝난 뒤에 풀리는 Promise 를 돌려준다(기다리지 않아도 된다). 이미 끝난 프로세스는
 * 건드리지 않는다 — 그 번호를 다른 프로그램이 다시 받았을 수 있다.
 */
export function killProcessTree(child, { platform = process.platform, spawnFn = spawn } = {}) {
  if (!child || !Number.isInteger(child.pid)) return Promise.resolve(false);
  if (child.exitCode !== null && child.exitCode !== undefined) return Promise.resolve(false);
  if (child.signalCode !== null && child.signalCode !== undefined) return Promise.resolve(false);
  const killDirect = () => {
    try {
      return child.kill("SIGKILL");
    } catch {
      return false;
    }
  };
  if (platform !== "win32") return Promise.resolve(killDirect());
  return new Promise((resolve) => {
    let killer;
    try {
      killer = spawnFn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      resolve(killDirect());
      return;
    }
    killer.once("error", () => resolve(killDirect()));
    killer.once("exit", (code) => {
      // taskkill 이 실패하면(권한 등) 최소한 껍데기는 끝낸다.
      if (code !== 0) killDirect();
      resolve(true);
    });
  });
}

/** 자식 프로세스를 돌리고 stdout/stderr 를 모은다. */
function runProcess(executable, args, { input = "", timeoutMs, env, abortSignal } = {}) {
  return new Promise((resolve) => {
    if (abortSignal?.aborted) {
      resolve({ ok: false, code: -1, stdout: "", stderr: "", cancelled: true });
      return;
    }
    let child;
    try {
      const target = buildSpawnTarget(executable, args);
      child = spawn(target.command, target.spawnArgs, {
        windowsHide: true,
        env: { ...process.env, ...(env ?? {}) },
      });
    } catch (error) {
      resolve({ ok: false, code: -1, stdout: "", stderr: String(error?.message ?? error) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener?.("abort", onAbort);
      resolve(result);
    };

    const timer = setTimeout(() => {
      // 껍데기(cmd.exe)만 끝내면 실제 CLI 가 뒤에 남는다 — 딸린 프로세스까지 끝낸다.
      void killProcessTree(child);
      finish({ ok: false, code: -1, stdout, stderr, timedOut: true });
    }, timeoutMs);
    // 사용자가 '중지'를 누르면 기다리지 않고 바로 끝낸다.
    const onAbort = () => {
      void killProcessTree(child);
      finish({ ok: false, code: -1, stdout, stderr, cancelled: true });
    };
    abortSignal?.addEventListener?.("abort", onAbort, { once: true });
    if (abortSignal?.aborted) onAbort();

    child.stdout?.on("data", (chunk) => {
      // 4MB 를 넘기면 더 받지 않는다. 무한히 받으면 메모리가 터진다.
      if (stdout.length < 4 * 1024 * 1024) stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < 256 * 1024) stderr += String(chunk);
    });
    child.on("error", (error) =>
      finish({ ok: false, code: -1, stdout, stderr: String(error?.message ?? error) }),
    );
    child.on("close", (code) => finish({ ok: code === 0, code: Number(code ?? -1), stdout, stderr }));

    if (child.stdin) {
      child.stdin.on("error", () => {
        // 프로세스가 먼저 죽으면 EPIPE 가 난다 — close 쪽에서 이미 처리한다
      });
      if (input) child.stdin.write(input);
      child.stdin.end();
    }
  });
}

/**
 * 로그인 상태를 확인한다. 모델을 부르지 않으므로 돈이 들지 않는다.
 *
 * 연결 확인을 위해 실제 질문을 보내면 사용자 구독 할당량이 조용히 닳는다.
 * 상태 조회가 따로 있는 것이 이 방식의 큰 장점이라 반드시 이 길로 확인한다.
 */
export async function readSubscriptionRuntimeStatus(providerId, options = {}) {
  const spec = subscriptionRuntimes[providerId];
  if (!spec) {
    return { providerId, installed: false, loggedIn: false, userMessage: "알 수 없는 AI 연결입니다." };
  }

  const executable = resolveSubscriptionCliExecutable(providerId, options);
  if (!executable) {
    return {
      providerId,
      label: spec.label,
      installed: false,
      loggedIn: false,
      loginHint: spec.loginHint,
      userMessage: `${spec.label}를 쓰려면 ${spec.label} 앱이 이 PC에 있어야 합니다. 설치한 뒤 다시 확인해 주세요.`,
    };
  }

  const result = await runProcess(executable, spec.statusArgs, {
    timeoutMs: Number(options.statusTimeoutMs ?? statusTimeoutMs),
  });

  // 출력이 JSON 이면 그대로 읽고, 아니면 글자에서 단서를 찾는다. 버전이 오르며
  // 출력 모양이 바뀌어도 "설치는 됐다" 까지는 알 수 있어야 한다.
  let loggedIn = false;
  let authMethod = "";
  try {
    const parsed = JSON.parse(result.stdout.trim());
    loggedIn = parsed?.loggedIn === true;
    authMethod = String(parsed?.authMethod ?? "");
  } catch {
    const text = String(result.stdout ?? "");
    loggedIn = /logged\s*in|로그인\s*됨/iu.test(text) && !/not\s*logged/iu.test(text);
  }

  return {
    providerId,
    label: spec.label,
    installed: true,
    executablePath: executable,
    loggedIn,
    authMethod,
    loginHint: spec.loginHint,
    userMessage: loggedIn
      ? `${spec.label} 계정이 연결돼 있습니다. 추가 요금 없이 구독 그대로 씁니다.`
      : `${spec.label} 앱은 있는데 아직 로그인 전입니다. 로그인 한 번이면 API 키 없이 바로 씁니다.`,
  };
}

/** 로그인 창을 띄운다. 실제 확인과 동의는 사용자가 직접 한다. */
export async function startSubscriptionRuntimeLogin(providerId, options = {}) {
  const spec = subscriptionRuntimes[providerId];
  const executable = spec ? resolveSubscriptionCliExecutable(providerId, options) : "";
  if (!spec || !executable) {
    return { providerId, started: false, userMessage: "이 PC에서 실행할 수 있는 앱을 찾지 못했습니다." };
  }
  // 로그인은 대화형이라 여기서 끝까지 기다리지 않는다. 창을 띄우고 사용자에게 넘긴다.
  try {
    const target = buildSpawnTarget(executable, spec.loginArgs);
    const child = spawn(target.command, target.spawnArgs, { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
  } catch (error) {
    return {
      providerId,
      started: false,
      userMessage: `로그인 창을 열지 못했습니다: ${String(error?.message ?? error).slice(0, 120)}`,
    };
  }
  return {
    providerId,
    started: true,
    userMessage: `${spec.label} 로그인 창을 열었습니다. 로그인을 마치고 이 화면에서 연결 확인을 눌러 주세요.`,
  };
}

/** CLI 출력에서 답변 글을 꺼낸다. 버전마다 모양이 달라도 무너지지 않게 넓게 받는다. */
export function extractSubscriptionAnswerText(stdout) {
  const raw = String(stdout ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    // 알려진 자리들을 순서대로 본다. 하나라도 글이 있으면 그것이 답이다.
    for (const key of ["result", "text", "output", "content", "message"]) {
      const value = parsed?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    if (Array.isArray(parsed?.content)) {
      const joined = parsed.content
        .filter((block) => block?.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("");
      if (joined.trim()) return joined.trim();
    }
  } catch {
    // JSON 이 아니면 글 자체가 답이다(--output-format text 와 같은 모양)
  }
  return raw;
}

/**
 * 구독 계정으로 답변을 만든다.
 *
 * 프롬프트는 stdin 으로만 보낸다. 명령줄 인자에 실으면 따옴표·줄바꿈·한글에서
 * 깨진다 — Codex 배선이 같은 이유로 stdin 을 쓴다.
 */
export async function generateWithSubscriptionRuntime(providerId, prompt, options = {}) {
  const spec = subscriptionRuntimes[providerId];
  if (!spec) {
    return {
      status: "subscription_runtime_unknown",
      provider: providerId,
      userMessage: "알 수 없는 AI 연결입니다.",
      externalMutation: false,
    };
  }

  const text = String(prompt ?? "").trim();
  if (!text) {
    return {
      status: "subscription_runtime_prompt_required",
      provider: providerId,
      userMessage: "보낼 내용이 비어 있습니다.",
      externalMutation: false,
    };
  }

  const executable = resolveSubscriptionCliExecutable(providerId, options);
  if (!executable) {
    return {
      status: "subscription_runtime_missing",
      provider: providerId,
      userMessage: `${spec.label} 앱을 찾지 못했습니다. 설치한 뒤 다시 시도해 주세요.`,
      externalMutation: false,
    };
  }

  const model = String(options.model ?? "").trim();
  // '계정 기본 모델'(default/latest)은 --model 없이 부른다.
  const result = await runProcess(executable, buildSubscriptionRunArgs(providerId, toCliModel(model), options), {
    input: text,
    timeoutMs: Number(options.timeoutMs ?? defaultCliTimeoutMs),
    env: options.env,
    abortSignal: options.abortSignal,
  });

  if (result.cancelled) {
    return {
      status: "subscription_runtime_cancelled",
      provider: providerId,
      model,
      userMessage: `${spec.label} 답변을 멈췄어요.`,
      externalMutation: false,
    };
  }

  if (result.timedOut) {
    return {
      status: "subscription_runtime_timeout",
      provider: providerId,
      model,
      // 왜 오래 걸렸는지 알려 준다. "실패" 로만 끝내면 사용자는 앱이 고장 난 줄 안다.
      userMessage: `${spec.label}가 시간 안에 답하지 못했습니다. 질문이 길거나 복잡하면 오래 걸립니다 — 나눠서 다시 물어봐 주세요.`,
      externalMutation: false,
    };
  }

  const outputText = extractSubscriptionAnswerText(result.stdout);
  if (!result.ok || !outputText) {
    const stderr = String(result.stderr ?? "");
    // 로그인 문제는 안내가 달라야 한다. "실패" 로 뭉뚱그리면 사용자가 엉뚱한 데를 고친다.
    const needsLogin = /not\s*logged|login|unauthor|authenticat/iu.test(`${stderr}${result.stdout}`);
    return {
      status: needsLogin ? "subscription_runtime_login_required" : "subscription_runtime_failed",
      provider: providerId,
      model,
      userMessage: needsLogin
        ? `${spec.label} 로그인이 필요합니다. ${spec.loginHint}`
        : `${spec.label}에서 답변을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.`,
      errorMessage: stderr.slice(0, 400),
      externalMutation: false,
    };
  }

  return {
    status: "generate_content_loaded",
    provider: providerId,
    model,
    outputText,
    outputChars: outputText.length,
    promptChars: text.length,
    userMessage: `${spec.label} 구독 계정으로 답변을 만들었습니다. 추가 요금은 들지 않습니다.`,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/** 화면이 "무엇을 붙일 수 있나" 를 물을 때 쓴다. 설치·로그인 상태를 한 번에 준다. */
export async function detectSubscriptionRuntimes(options = {}) {
  const runtimes = [];
  for (const id of listSubscriptionRuntimeIds()) {
    const status = await readSubscriptionRuntimeStatus(id, options);
    const spec = subscriptionRuntimes[id];
    // 화면이 이 목록만으로 '고를 수 있는 모델'을 그릴 수 있게 모델과 가용성을 함께 준다.
    runtimes.push({
      ...status,
      models: [{ id: subscriptionDefaultModelId, label: `${spec?.label ?? "구독"} 계정 기본 모델`, hint: "구독에 포함된 기본 모델 · 추가 요금 없이 계정 조건을 따릅니다." }],
      modelAvailability: buildSubscriptionModelAvailability(id, status),
    });
  }
  return { runtimes, externalMutation: false };
}
