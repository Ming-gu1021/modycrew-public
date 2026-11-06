import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { redactCompanyText } from "./company-automation/privacy.mjs";

/**
 * 메인 프로세스에서 아무도 잡지 않은 오류를 userData/logs/main-errors.log 에 남긴다.
 *
 * 예전엔 배경 메일 점검·업무 실행이 실패해도 흔적이 어디에도 없어
 * '가끔 안 된다'를 사용자도 개발자도 추적할 수 없었다.
 *
 *  - 한 줄에 JSON 하나. 비밀값·이메일·전화번호 같은 값은 가린다.
 *  - 1MB 를 넘으면 한 번만 옛 파일(.1)로 돌리고 새로 쓴다.
 *  - 처리되지 않은 Promise 거절(unhandledRejection)은 기록만 하고 앱은 계속 돈다.
 *  - 잡히지 않은 예외는 uncaughtExceptionMonitor 로 기록만 한다. 'uncaughtException'
 *    처리기를 따로 달면 Electron 기본 동작(오류 창 표시)이 꺼져 조용히 넘어가게 되므로
 *    일부러 달지 않는다.
 */

export const mainErrorLogFileName = "main-errors.log";
export const mainErrorLogMaxBytes = 1024 * 1024;
const maxStackChars = 4_000;
const maxMessageChars = 1_000;
const burstWindowMs = 60_000;
const burstLimit = 50;

function redact(value, limit) {
  return redactCompanyText(String(value ?? "")).text.slice(0, limit);
}

export function formatMainErrorLogLine(kind, error, { now = new Date(), origin } = {}) {
  const isError = error instanceof Error;
  const entry = {
    at: now.toISOString(),
    kind,
    ...(origin ? { origin: String(origin).slice(0, 60) } : {}),
    name: isError ? String(error.name).slice(0, 80) : typeof error,
    message: redact(isError ? error.message : safeStringify(error), maxMessageChars),
    ...(isError && error.code ? { code: String(error.code).slice(0, 80) } : {}),
    ...(isError && error.stack ? { stack: redact(error.stack, maxStackChars) } : {}),
  };
  return `${JSON.stringify(entry)}\n`;
}

function safeStringify(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** 로그 한 줄을 붙인다. 파일이 상한을 넘으면 먼저 .1 로 한 번 돌린다. 실패해도 throw 하지 않는다. */
export function appendMainErrorLog(logDir, line, { maxBytes = mainErrorLogMaxBytes } = {}) {
  try {
    mkdirSync(logDir, { recursive: true });
    const filePath = path.join(logDir, mainErrorLogFileName);
    let size = 0;
    try {
      size = statSync(filePath).size;
    } catch {
      size = 0;
    }
    if (size + Buffer.byteLength(line) > maxBytes && size > 0) {
      const rotated = `${filePath}.1`;
      rmSync(rotated, { force: true });
      renameSync(filePath, rotated);
    }
    appendFileSync(filePath, line, "utf8");
    return filePath;
  } catch {
    return null;
  }
}

export function resolveMainErrorLogDir(app) {
  try {
    return path.join(app.getPath("userData"), "logs");
  } catch {
    return null;
  }
}

/**
 * 처리기를 한 번만 단다. processRef·now 는 테스트에서 바꿔 끼운다.
 * 돌려주는 값: { logDir(), uninstall() }
 */
export function installMainProcessErrorLog({ app, processRef = process, now = () => new Date(), log = console } = {}) {
  let windowStartedAt = 0;
  let windowCount = 0;
  let suppressed = 0;

  const write = (kind, error, origin) => {
    const logDir = resolveMainErrorLogDir(app);
    if (!logDir) return;
    const current = now();
    if (current.getTime() - windowStartedAt > burstWindowMs) {
      if (suppressed > 0) {
        appendMainErrorLog(
          logDir,
          `${JSON.stringify({ at: current.toISOString(), kind: "suppressed", count: suppressed })}\n`,
        );
      }
      windowStartedAt = current.getTime();
      windowCount = 0;
      suppressed = 0;
    }
    windowCount += 1;
    if (windowCount > burstLimit) {
      suppressed += 1;
      return;
    }
    appendMainErrorLog(logDir, formatMainErrorLogLine(kind, error, { now: current, origin }));
  };

  const onUnhandledRejection = (reason) => {
    write("unhandledRejection", reason);
    try {
      log.error?.("[main] 처리되지 않은 Promise 거절:", reason instanceof Error ? reason.message : reason);
    } catch {
      // 콘솔 출력 실패는 무시한다.
    }
  };
  const onUncaughtExceptionMonitor = (error, origin) => {
    write("uncaughtException", error, origin);
  };

  processRef.on("unhandledRejection", onUnhandledRejection);
  processRef.on("uncaughtExceptionMonitor", onUncaughtExceptionMonitor);

  return {
    logDir: () => resolveMainErrorLogDir(app),
    uninstall() {
      processRef.off?.("unhandledRejection", onUnhandledRejection);
      processRef.off?.("uncaughtExceptionMonitor", onUncaughtExceptionMonitor);
    },
  };
}
