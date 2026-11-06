/**
 * electron-updater 통합.
 *
 * - generic provider (Firebase Hosting URL) 에서 latest.yml 을 폴링
 * - 새 버전 발견 시 다운로드 → 사용자가 '업데이트'를 누르면 앱을 닫고 설치기를 실행
 * - 설치기는 앱이 닫힌 뒤 따로 돌고, 조용한 설치(/S)는 중간에 멈춰도 아무 창을 띄우지 않는다.
 *   그래서 설치를 요청하면(앱 종료와 함께 하는 조용한 설치 포함) 상태 파일에 남기고, 다음 실행에서
 *   실제로 실행 중인 버전으로 적용 여부를 확인한다. 같은 위치에서 옛 버전이 다시 켜졌으면
 *   "적용 확인 안 됨"을 알리고, 다음 설치는 조용한 설치를 되풀이하지 않고 설치 창을 띄워
 *   진행 상황과 오류가 보이게 한다.
 * - electron-updater 내부 기록과 설치 요청·확인 결과는 userData/logs/auto-updater.log 에 남긴다.
 *
 * package.json 의 build.publish 설정과 같은 URL 을 사용합니다.
 *
 * dev 모드 (electron 패키지 외부 실행) 에서는 updater 가 자동으로 비활성화됩니다.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { redactCompanyText } from "./company-automation/privacy.mjs";

let updater;
let periodicCheckTimer = null;
let installTimer = null;
let removeLifecycleListeners = () => {};
let checkInFlight = null;
let downloadInFlight = null;
let downloadedFileInfo = null;
let removeUpdaterListeners = () => {};
let lastCheckStartedAt = 0;
// update-downloaded 가 알려 준 설치 파일 경로. 앱을 닫기 전에 실제로 있는지 본다.
let downloadedInstallerPath = "";
let currentExecPath = "";
// 이 실행에서 사용자가 설치를 요청했는가(앱 종료 설치 기록과 겹치지 않게 한다).
let installRequestedThisSession = false;
// 앱이 켜져 있는 동안에도 새 버전을 알아채도록 주기적으로 확인한다. 처음 확인은 시작 직후 한 번.
const periodicCheckIntervalMs = Math.max(5, Number(process.env.MODYCREW_UPDATE_CHECK_MINUTES) || 5) * 60_000;
const defaultTiming = Object.freeze({
  // 화면 안내가 먼저 뜨도록 잠깐 기다린 뒤 설치기를 실행하고 앱을 닫는다.
  installDelayMs: 2_000,
  // 설치기를 실행하고 이만큼 지나도 이 실행이 살아 있으면 설치가 진행되지 않은 것으로 보고 다시 누를 수 있게 한다.
  // (정상이면 앱이 몇 초 안에 닫히고, 닫히지 않아도 설치기가 시작하자마자 설치 폴더에서 도는 프로세스를 끈다.)
  installWaitMs: 90_000,
});
let timing = { ...defaultTiming };
// 트레이 메뉴·OS 알림처럼 화면 밖에서도 상태를 따라가야 하는 곳이 구독한다.
const stateListeners = new Set();
let stateFilePath = "";
let logFilePath = "";
const logMaxBytes = 512 * 1024;
// 5분마다 반복되는 확인 기록은 파일만 채우므로 콘솔에만 남긴다.
const routineUpdaterInfo = /^(?:Checking for update|Update for version \S+ is not available)/u;

const silentInstallMessage = "앱을 닫고 업데이트를 설치합니다. 몇 분 걸리고 그동안 화면에 아무것도 보이지 않을 수 있어요. 끝나면 앱이 다시 열리니 그 전에 ModyCrew를 다시 실행하지 말아 주세요. 5분이 지나도 열리지 않으면 직접 실행해 주세요.";
const visibleInstallMessage = "앱을 닫고 설치 창을 엽니다. 설치 창에서 진행 상황을 확인하고, 마지막 화면에서 마침을 누르면 새 버전이 열립니다. 오류가 나면 설치 창의 안내를 따라 주세요.";
const appStillOpenMessage = "앱이 닫히지 않아 업데이트가 진행되지 않았어요. 작성 중인 내용을 저장한 뒤 다시 눌러 주세요. 이번에는 설치 창을 띄워 진행 상황을 보여 드립니다.";
const installerErrorMessage = "업데이트 설치 프로그램을 실행하지 못했어요. 다시 누르면 설치 창으로 진행합니다. 계속 안 되면 트레이 메뉴의 '완전히 종료'로 앱을 닫은 뒤 다시 열어 주세요.";
const missingInstallerMessage = "받아 둔 설치 파일을 찾지 못해 업데이트를 다시 받습니다.";

function notConfirmedMessage(version) {
  return "지난번 업데이트(" + version + ")가 적용되지 않았어요. 설치가 중간에 멈췄거나 시작되지 않았을 수 있어요. 이번에는 설치 창을 띄워 진행 상황과 오류를 보여 드립니다.";
}

let updaterState = {
  status: "idle",
  currentVersion: "",
  channel: "latest",
  isPackaged: false,
  updateVersion: "",
  progressPercent: 0,
  lastCheckedAt: "",
  downloadedAt: "",
  checkIntervalMinutes: periodicCheckIntervalMs / 60_000,
  // 직전 실행 버전과 다르면 "x → y 로 업데이트됨"을 한 번 알려 준다(사용자가 확인하면 비움).
  updatedFromVersion: "",
  // 설치를 요청했는데 그 뒤에도 옛 버전이 실행된(적용이 확인되지 않은) 버전. 있으면 다음 설치는 설치 화면을 띄운다.
  installUnconfirmedVersion: "",
  // 진행 중인 설치 요청 방식: silent(조용히 설치 후 다시 열기) / visible(설치 화면)
  installMode: "",
  userMessage: "업데이트 확인 대기 중",
};

function setUpdaterState(patch) {
  updaterState = { ...updaterState, ...patch };
  const snapshot = getAutoUpdaterState();
  for (const listener of stateListeners) {
    try { listener(snapshot); } catch { /* 한 구독자의 오류가 다른 구독자를 막지 않게 한다. */ }
  }
}

export function subscribeAutoUpdaterState(listener) {
  if (typeof listener !== "function") return () => {};
  stateListeners.add(listener);
  return () => { stateListeners.delete(listener); };
}

// ── 기록(userData/logs/auto-updater.log) ─────────────────────────────────
// electron-updater 의 기본 기록은 콘솔뿐이라, 설치가 왜 적용되지 않았는지 남는 흔적이 없었다.
// 콘솔·파일 쓰기 실패(EPIPE 등)가 업데이트 흐름을 끊지 않도록 모두 삼킨다.
function formatLogValue(value) {
  if (value instanceof Error) return value.stack || value.message || String(value);
  if (typeof value === "string") return value;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

function safeHomeDirectory() {
  try { return os.homedir(); } catch { return ""; }
}

/** 기록에 사용자 폴더 경로(계정 이름)·주소의 질의 문자열(토큰이 붙을 수 있음)·인증값을 남기지 않는다. */
export function maskUpdaterLogText(value, homeDirectory = safeHomeDirectory()) {
  let text = redactCompanyText(String(value ?? "")).text.replace(/(\bhttps?:\/\/[^\s?#"'<>]+)\?[^\s#"'<>]*/giu, "$1?[질의 가림]");
  if (homeDirectory && homeDirectory.length >= 4) {
    for (const variant of new Set([homeDirectory, homeDirectory.replace(/\\/gu, "/"), homeDirectory.replace(/\//gu, "\\")])) {
      const haystack = text.toLowerCase();
      const needle = variant.toLowerCase();
      let masked = "";
      let index = 0;
      for (let found = haystack.indexOf(needle); found >= 0; found = haystack.indexOf(needle, index)) {
        masked += text.slice(index, found) + "%USERPROFILE%";
        index = found + needle.length;
      }
      text = masked + text.slice(index);
    }
  }
  return text;
}

function writeUpdaterLog(level, values) {
  if (!logFilePath) return;
  try {
    const message = maskUpdaterLogText(values.map(formatLogValue).join(" ")).slice(0, 4_000);
    const line = new Date().toISOString() + " [" + level + "] " + message + "\n";
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    let size = 0;
    try { size = fs.statSync(logFilePath).size; } catch { size = 0; }
    if (size > 0 && size + Buffer.byteLength(line) > logMaxBytes) {
      try {
        fs.rmSync(logFilePath + ".1", { force: true });
        fs.renameSync(logFilePath, logFilePath + ".1");
      } catch {
        // 돌리지 못했으면(파일 잠김 등) 상한의 두 배까지만 이어 쓰고 멈춘다.
        if (size > logMaxBytes * 2) return;
      }
    }
    fs.appendFileSync(logFilePath, line, "utf8");
  } catch {
    // 기록 실패가 업데이트를 막지 않게 한다.
  }
}

function writeConsole(method, values) {
  try { console[method]("[auto-updater]", ...values); } catch { /* 콘솔이 닫힌 실행 환경 */ }
}

// electron-updater 의 logger 자리에 그대로 넣는다(info/warn/error/debug).
const updaterLog = {
  info: (...values) => {
    writeConsole("log", values);
    if (!(typeof values[0] === "string" && routineUpdaterInfo.test(values[0]))) writeUpdaterLog("info", values);
  },
  warn: (...values) => { writeConsole("warn", values); writeUpdaterLog("warn", values); },
  error: (...values) => { writeConsole("error", values); writeUpdaterLog("error", values); },
  debug: () => {},
};

function resolveLogFilePath(app, options) {
  if (typeof options.logFilePath === "string" && options.logFilePath) return options.logFilePath;
  try {
    const userData = app.getPath?.("userData");
    if (userData) return path.join(userData, "logs", "auto-updater.log");
  } catch {
    // 경로를 못 얻으면 상태 파일 옆에 둔다.
  }
  return stateFilePath ? path.join(path.dirname(stateFilePath), "logs", "auto-updater.log") : "";
}

// ── 상태 파일(직전 실행 버전·설치 요청·적용 미확인) ─────────────────────────
function readUpdateStateFile(filePath) {
  if (!filePath) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// 있던 값은 두고 patch 만 덮어쓴다. null 은 그 항목을 지운다. 임시 파일에 쓴 뒤 이름을 바꿔 반쯤 쓴 파일을 남기지 않는다.
function writeUpdateStateFile(filePath, patch) {
  if (!filePath) return false;
  const next = { ...readUpdateStateFile(filePath), ...patch, recordedAt: new Date().toISOString() };
  for (const [key, value] of Object.entries(next)) {
    if (value === null || value === undefined) delete next[key];
  }
  const temp = filePath + "." + process.pid + ".tmp";
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(next), "utf8");
    fs.renameSync(temp, filePath);
    return true;
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch { /* 무시 */ }
    updaterLog.warn("업데이트 상태 파일을 쓰지 못했습니다:", error?.message ?? error);
    return false;
  }
}

/**
 * "0.2.151" 같은 버전을 숫자 단위로 비교한다(문자열 비교가 아님). 앞이 크면 1, 같으면 0, 작으면 -1.
 * 숫자 부분이 같으면 사전 공개 표시(-beta 등)가 붙은 쪽을 낮게 본다.
 */
export function compareVersions(left, right) {
  const parse = (value) => {
    const [core, ...rest] = String(value ?? "").trim().replace(/^v/iu, "").split("+")[0].split("-");
    return { numbers: core.split(".").map((piece) => Number.parseInt(piece, 10) || 0), prerelease: rest.join("-") };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.numbers.length, b.numbers.length); index += 1) {
    const diff = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

function samePath(left, right) {
  const normalize = (value) => path.resolve(String(value)).replace(/[\\/]+$/u, "");
  return process.platform === "win32"
    ? normalize(left).toLowerCase() === normalize(right).toLowerCase()
    : normalize(left) === normalize(right);
}

function textField(source, field, max) {
  return typeof source?.[field] === "string" ? source[field].slice(0, max) : "";
}

function readPendingInstall(value) {
  if (!value || typeof value !== "object") return null;
  const version = textField(value, "version", 40);
  const requestedAt = textField(value, "requestedAt", 40);
  if (!version || !Number.isFinite(Date.parse(requestedAt))) return null;
  return {
    version,
    requestedAt,
    fromVersion: textField(value, "fromVersion", 40),
    mode: textField(value, "mode", 20) || "silent",
    reason: textField(value, "reason", 40),
    execPath: textField(value, "execPath", 400),
  };
}

function readUnconfirmedInstall(value) {
  const version = textField(value, "version", 40);
  if (!version) return null;
  const attempts = Number(value.attempts);
  return { version, attempts: Number.isFinite(attempts) && attempts > 0 ? Math.min(99, Math.floor(attempts)) : 1 };
}

function recordUnconfirmedInstall(pending, reason) {
  const previous = readUnconfirmedInstall(readUpdateStateFile(stateFilePath).installUnconfirmed);
  const attempts = previous?.version === pending.version ? Math.min(99, previous.attempts + 1) : 1;
  writeUpdateStateFile(stateFilePath, {
    pendingInstall: null,
    installUnconfirmed: {
      version: pending.version,
      fromVersion: pending.fromVersion,
      mode: pending.mode,
      requestedAt: pending.requestedAt,
      observedVersion: updaterState.currentVersion,
      observedAt: new Date().toISOString(),
      reason,
      attempts,
    },
  });
  updaterLog.warn("설치 적용 확인 안 됨: 목표 " + pending.version + ", 실행 중 " + (updaterState.currentVersion || "?") + ", 방식 " + pending.mode + ", 근거 " + reason + ", 같은 버전 " + attempts + "번째.");
  return pending.version;
}

// 설치본이 바뀌었는지(직전 실행 버전 ≠ 현재 버전)를 한 번만 알린다. 첫 설치는 알리지 않는다.
function detectUpdatedFromVersion(app, options) {
  const currentVersion = app.getVersion?.() ?? "";
  if (!currentVersion) return "";
  let filePath = options.stateFilePath ?? "";
  if (!filePath) {
    try { filePath = path.join(app.getPath("userData"), "desktop-update-state.json"); } catch { filePath = ""; }
  }
  if (!filePath) return "";
  stateFilePath = filePath;
  const stored = readUpdateStateFile(filePath);
  const lastRunVersion = typeof stored.lastRunVersion === "string" ? stored.lastRunVersion : "";
  if (lastRunVersion !== currentVersion) writeUpdateStateFile(filePath, { lastRunVersion: currentVersion });
  return lastRunVersion && lastRunVersion !== currentVersion ? lastRunVersion : "";
}

/**
 * 지난 실행이 남긴 설치 요청을 지금 실행 중인 버전으로 확인하고, 적용이 확인되지 않은 버전을 돌려준다(없으면 "").
 * - 지금 버전이 목표 이상: 적용 확인(요청·미확인 기록을 지운다)
 * - 다른 위치의 ModyCrew(무설치본 등)로 실행됨: 판단하지 않는다(기록을 그대로 둔다)
 * - 같은 위치에서 옛 버전이 다시 켜짐: 적용 확인 안 됨으로 남긴다. 설치기가 정상으로 돌고 있었다면
 *   이 실행은 곧 설치기에 의해 꺼지고, 새 버전이 켜질 때 이 기록도 지워진다.
 */
function reviewPreviousInstall(currentVersion, execPath) {
  if (!currentVersion || !stateFilePath) return "";
  const stored = readUpdateStateFile(stateFilePath);
  let unconfirmed = readUnconfirmedInstall(stored.installUnconfirmed);
  if (unconfirmed && compareVersions(currentVersion, unconfirmed.version) >= 0) {
    updaterLog.info("예전에 적용이 확인되지 않았던 " + unconfirmed.version + " 이상이 지금 실행 중입니다(현재 " + currentVersion + ").");
    writeUpdateStateFile(stateFilePath, { installUnconfirmed: null });
    unconfirmed = null;
  }
  const pending = readPendingInstall(stored.pendingInstall);
  if (!pending) return unconfirmed?.version ?? "";
  const seconds = Math.round((Date.now() - Date.parse(pending.requestedAt)) / 1000);
  if (compareVersions(currentVersion, pending.version) >= 0) {
    updaterLog.info("설치 확인: " + (pending.fromVersion || "?") + " → " + currentVersion + " (요청 " + seconds + "초 뒤 시작, 방식 " + pending.mode + ")");
    writeUpdateStateFile(stateFilePath, { pendingInstall: null, installUnconfirmed: null });
    return "";
  }
  if (pending.execPath && execPath && !samePath(pending.execPath, execPath)) {
    updaterLog.warn("설치를 요청한 앱(" + pending.execPath + ")과 다른 위치(" + execPath + ")에서 실행돼 설치 결과를 판단하지 않습니다.");
    return unconfirmed?.version ?? "";
  }
  updaterLog.warn(pending.version + " 설치를 요청하고 " + seconds + "초 뒤 옛 버전 " + currentVersion + "이 다시 시작됐습니다.");
  return recordUnconfirmedInstall(pending, "old_version_on_next_start");
}

function clearInstallTimer() {
  if (installTimer) { clearTimeout(installTimer); installTimer = null; }
}

function markInstallUnconfirmed(version) {
  setUpdaterState({ installUnconfirmedVersion: version });
  // 적용이 확인되지 않은 조용한 설치를 앱 종료 때 되풀이하지 않는다(설치 화면 경로만 남긴다).
  if (updater) updater.autoInstallOnAppQuit = false;
}

// 이 실행의 설치 요청이 진행되지 않았다(앱이 닫히지 않음, 설치기 실행 오류). 다시 누를 수 있게 되돌리고,
// 다음 시도는 설치 창으로 진행한다.
function returnToReadyAfterStall(pending, reason, error) {
  clearInstallTimer();
  if (error) updaterLog.error("설치기 실행 오류:", error);
  const version = pending ? recordUnconfirmedInstall(pending, reason) : updaterState.updateVersion;
  markInstallUnconfirmed(version);
  // electron-updater 는 설치기를 한 번 실행하면 quitAndInstallCalled 를 세워 같은 실행의 다음 설치 요청을 무시하고,
  // 설치기 실행에 실패했을 때만 스스로 내린다. 앱이 닫히지 않은 경우에도 다시 누르면 진행되게 같은 표시를 내린다.
  // 먼저 실행된 설치기가 아직 돌고 있으면 새 설치기는 NSIS 단일 실행 잠금(APP_GUID) 때문에 바로 끝나 둘이 겹쳐 돌지 않는다.
  if (updater && updater.quitAndInstallCalled === true) updater.quitAndInstallCalled = false;
  const installerReady = Boolean(downloadedInstallerPath) && fs.existsSync(downloadedInstallerPath);
  setUpdaterState({
    status: installerReady ? "ready" : "idle",
    installMode: "",
    errorMessage: error ? String(error?.message ?? error).slice(0, 300) : "",
    userMessage: error ? installerErrorMessage : appStillOpenMessage,
  });
  if (!installerReady) void checkForUpdates();
}

// 다운로드 직후 검증을 통과했어도, 오래 기다리는 동안 정리 도구나 다른 프로그램이
// 파일을 바꿀 수 있다. 앱을 닫기 직전에 메타데이터와 다시 비교한다(스트림으로 읽어 UI를 막지 않음).
async function verifyInstaller(file, info) {
  const stat = await fs.promises.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw new Error("invalid installer file");
  const entry = info?.files?.find((item) => {
    try { return path.basename(new URL(item.url, "https://update.invalid/").pathname) === path.basename(file); } catch { return false; }
  }) ?? info?.files?.find((item) => /\.exe$/iu.test(item.url ?? ""));
  if (Number.isFinite(entry?.size) && stat.size !== entry.size) throw new Error("installer size mismatch");
  const sha512 = entry?.sha512 ?? info?.sha512;
  if (sha512) {
    const hash = createHash("sha512");
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    if (hash.digest("base64") !== sha512) throw new Error("installer checksum mismatch");
  }
}

async function requestInstall({ visible = false, reason = "install_now" } = {}) {
  if (!updater || updaterState.status !== "ready") return getAutoUpdaterState();
  if (!downloadedInstallerPath || !fs.existsSync(downloadedInstallerPath)) {
    // 앱부터 닫으면 설치기 없이 꺼진다. 닫지 않고 다시 받는다.
    updaterLog.warn("받아 둔 설치 파일이 없어 앱을 닫지 않고 다시 받습니다: " + (downloadedInstallerPath || "(경로 없음)"));
    downloadedInstallerPath = "";
    setUpdaterState({ status: "idle", progressPercent: 0, downloadedAt: "", errorMessage: "", userMessage: missingInstallerMessage });
    void checkForUpdates();
    return getAutoUpdaterState();
  }
  const verifyingUpdater = updater;
  // 중복 클릭과 확인 타이머가 검증 중 설치/다운로드를 다시 시작하지 못하게 한다.
  setUpdaterState({ status: "install_requested", userMessage: "받아 둔 업데이트 파일을 확인하고 있습니다. 확인이 끝나면 설치를 시작합니다." });
  try {
    await verifyInstaller(downloadedInstallerPath, downloadedFileInfo);
  } catch (error) {
    if (updater !== verifyingUpdater) return getAutoUpdaterState();
    updater.autoInstallOnAppQuit = false;
    // 6.8.x는 같은 실행에서 받은 파일은 존재 여부만 확인한다. 메모리의 검증 결과를
    // 버려 다음 받기에서 디스크 캐시의 해시를 다시 확인하고 정상 파일로 교체하게 한다.
    if (updater.downloadedUpdateHelper) updater.downloadedUpdateHelper.versionInfo = null;
    downloadedInstallerPath = "";
    setUpdaterState({ status: "error", progressPercent: 0, downloadedAt: "", installMode: "", errorMessage: maskUpdaterLogText(error?.message ?? error), userMessage: "받아 둔 설치 파일이 손상되었거나 읽을 수 없습니다. 앱을 종료하지 않았어요. 업데이트를 다시 확인해 받아 주세요." });
    updaterLog.warn("설치 전 파일 검증 실패:", error);
    return getAutoUpdaterState();
  }
  if (updater !== verifyingUpdater) return getAutoUpdaterState();
  // 지난 설치의 적용이 확인되지 않았으면 이번에는 설치 화면을 띄워 진행 상황과 오류가 보이게 한다.
  let silent = !visible && !updaterState.installUnconfirmedVersion;
  const pending = {
    version: updaterState.updateVersion,
    fromVersion: updaterState.currentVersion,
    requestedAt: new Date().toISOString(),
    mode: silent ? "silent" : "visible",
    reason,
    execPath: currentExecPath,
  };
  if (!writeUpdateStateFile(stateFilePath, { pendingInstall: pending })) {
    // 기록하지 못하면 다음 실행에서 결과를 확인할 수 없다. 그 대신 설치 화면으로 진행해 결과가 눈에 보이게 한다.
    silent = false;
    pending.mode = "visible";
    updaterLog.warn("설치 요청을 기록하지 못해 설치 화면으로 진행합니다.");
  }
  installRequestedThisSession = true;
  updaterLog.info("설치 요청: " + (pending.fromVersion || "?") + " → " + pending.version + ", 방식 " + pending.mode + ", 설치 파일 " + downloadedInstallerPath);
  setUpdaterState({ status: "install_requested", installMode: pending.mode, errorMessage: "", userMessage: silent ? silentInstallMessage : visibleInstallMessage });
  const currentUpdater = updater;
  clearInstallTimer();
  installTimer = setTimeout(() => {
    installTimer = null;
    if (updater !== currentUpdater || updaterState.status !== "install_requested") return;
    try {
      // 조용한 설치는 끝나면 새 버전을 다시 연다. 설치 화면은 마지막 화면의 실행 선택이 그 일을 맡는다.
      currentUpdater.quitAndInstall(silent, true);
    } catch (error) {
      returnToReadyAfterStall(pending, "quit_and_install_threw", error);
      return;
    }
    if (updaterState.status !== "install_requested") return;
    // 정상이면 곧 이 프로세스가 닫히거나 설치기가 끈다. 그래도 살아 있으면 다시 누를 수 있게 한다.
    installTimer = setTimeout(() => {
      installTimer = null;
      if (updaterState.status === "install_requested") returnToReadyAfterStall(pending, "app_still_running_after_request");
    }, timing.installWaitMs);
    installTimer.unref?.();
  }, timing.installDelayMs);
  installTimer.unref?.();
  return getAutoUpdaterState();
}

function resolveTiming(overrides) {
  const next = { ...defaultTiming };
  if (!overrides || typeof overrides !== "object") return next;
  for (const key of Object.keys(defaultTiming)) {
    const value = Number(overrides[key]);
    if (key in overrides && Number.isFinite(value) && value >= 0) next[key] = value;
  }
  return next;
}

async function resolveElectronApp(explicitApp) {
  if (explicitApp) return explicitApp;

  const mod = await import("electron");
  const electronApi = typeof mod.default === "string" ? mod : (mod.default ?? mod);
  return electronApi.app;
}

async function checkForUpdates() {
  if (!updater || downloadInFlight || ["downloading", "ready", "install_requested"].includes(updaterState.status)) return;
  if (checkInFlight) return checkInFlight;
  lastCheckStartedAt = Date.now();
  const currentUpdater = updater;
  checkInFlight = Promise.resolve().then(() => currentUpdater.checkForUpdates()).then(result => {
    // checkForUpdates는 목록 조회가 끝나면 반환한다. 실제 받기의 거절은 별도 Promise에 온다.
    if (result?.downloadPromise) void observeDownload(result.downloadPromise, currentUpdater);
  }).catch(error => {
    if (updater === currentUpdater) reportUpdateError(error, "check");
  }).finally(() => { checkInFlight = null; });
  return checkInFlight;
}

function reportUpdateError(error, phase) {
  const detail = String(error?.message ?? error);
  let userMessage = phase === "download"
    ? "업데이트 다운로드를 마치지 못했습니다. 인터넷 연결을 확인한 뒤 업데이트를 다시 확인해 주세요. 앱은 계속 사용할 수 있어요."
    : "업데이트를 확인하지 못했습니다. 연결되면 다시 확인합니다. 앱은 계속 사용할 수 있어요.";
  if (/ENOSPC|no space/i.test(detail)) userMessage = "업데이트를 받을 저장 공간이 부족합니다. 공간을 확보한 뒤 업데이트를 다시 확인해 주세요. 앱은 계속 사용할 수 있어요.";
  else if (/EACCES|EPERM|access denied/i.test(detail)) userMessage = "업데이트 파일에 접근하지 못했습니다. 보안 프로그램의 차단 알림이나 폴더 권한을 확인한 뒤 다시 시도해 주세요. 앱은 계속 사용할 수 있어요.";
  else if (/sha512|checksum|ERR_UPDATER_INVALID/i.test(detail)) userMessage = "업데이트 파일 검증에 실패했습니다. 설치하지 않았어요. 업데이트를 다시 확인해 받아 주세요.";
  setUpdaterState({ status: "error", userMessage, errorMessage: maskUpdaterLogText(detail).slice(0, 300) });
  updaterLog.warn(phase + " 실패:", error);
}

function observeDownload(promise, owner) {
  if (owner === updater && !["ready", "error", "install_requested"].includes(updaterState.status)) {
    setUpdaterState({ status: "downloading", errorMessage: "", userMessage: "업데이트 다운로드를 준비하고 있습니다." });
  }
  const observed = Promise.resolve(promise).catch(error => {
    if (owner !== updater) return;
    if (error?.name === "CancellationError" || /cancelled/i.test(error?.message ?? "")) {
      setUpdaterState({ status: "available", progressPercent: 0, errorMessage: "", userMessage: "업데이트 다운로드를 취소했습니다. 다시 받을 수 있어요." });
    } else reportUpdateError(error, "download");
  }).finally(() => { if (downloadInFlight === observed) downloadInFlight = null; });
  downloadInFlight = observed;
  return observed;
}

export async function startAutoUpdater(options = {}) {
  removeLifecycleListeners();
  removeLifecycleListeners = () => {};
  if (periodicCheckTimer) { clearInterval(periodicCheckTimer); periodicCheckTimer = null; }
  clearInstallTimer();
  if (checkInFlight) await checkInFlight;
  removeUpdaterListeners();
  removeUpdaterListeners = () => {};
  downloadInFlight = null;
  downloadedFileInfo = null;
  updater = undefined;
  downloadedInstallerPath = "";
  installRequestedThisSession = false;
  stateFilePath = "";
  logFilePath = "";
  timing = resolveTiming(options.timing);
  currentExecPath = typeof options.execPath === "string" && options.execPath ? options.execPath : process.execPath;
  const app = await resolveElectronApp(options.app);
  if (!app) {
    writeConsole("warn", ["Electron app API를 찾지 못해 updater 비활성"]);
    setUpdaterState({
      status: "unavailable",
      userMessage: "Electron app API를 찾지 못해 업데이트를 확인할 수 없습니다.",
    });
    return null;
  }

  const currentVersion = app.getVersion?.() ?? "";
  setUpdaterState({
    status: "idle", updateVersion: "", progressPercent: 0, downloadedAt: "", errorMessage: "",
    installUnconfirmedVersion: "", installMode: "",
    currentVersion,
    isPackaged: app.isPackaged,
    channel: (process.env.MODYCREW_UPDATE_CHANNEL || "latest").trim(),
    updatedFromVersion: app.isPackaged ? detectUpdatedFromVersion(app, options) : "",
  });

  if (!app.isPackaged) {
    writeConsole("log", ["dev 모드 — updater 비활성"]);
    setUpdaterState({
      status: "dev_disabled",
      userMessage: "개발 모드에서는 설치형 업데이트 확인이 비활성화됩니다.",
    });
    return null;
  }

  logFilePath = resolveLogFilePath(app, options);
  const argv = Array.isArray(options.argv) ? options.argv : process.argv;
  const launchFlags = ["--hidden", "--updated"].filter((flag) => argv.includes(flag)).join(" ");
  updaterLog.info("시작: 현재 버전 " + (currentVersion || "?") + (updaterState.updatedFromVersion ? " (직전 실행 " + updaterState.updatedFromVersion + ")" : "") + ", 실행 파일 " + currentExecPath + (launchFlags ? ", 시작 인자 " + launchFlags : ""));
  const unconfirmedVersion = reviewPreviousInstall(currentVersion, currentExecPath);

  const overrideUrl = (process.env.MODYCREW_UPDATE_URL || "").trim();
  const channel = (process.env.MODYCREW_UPDATE_CHANNEL || "latest").trim();

  try {
    const mod = await (options.loadUpdaterModule?.() ?? import("electron-updater"));
    const candidate = mod.autoUpdater ?? mod.default?.autoUpdater;
    if (!candidate || typeof candidate.checkForUpdates !== "function") {
      throw new Error("electron-updater API를 찾지 못했습니다.");
    }
    updater = candidate;
  } catch (err) {
    updater = undefined;
    updaterLog.warn("electron-updater 모듈 로드 실패:", err);
    setUpdaterState({
      status: "module_missing",
      userMessage: "electron-updater 모듈을 불러오지 못했습니다.",
    });
    return null;
  }

  // electron-updater 내부 기록(설치기 실행 인자, 실행 실패, 차등 다운로드 실패 등)도 같은 파일에 남긴다.
  try { updater.logger = updaterLog; } catch { /* logger 를 바꿀 수 없는 구현이면 콘솔 기록만 남는다. */ }

  if (overrideUrl) {
    updater.setFeedURL({
      provider: "generic",
      url: overrideUrl,
      channel,
    });
    updaterLog.info("feed URL override = " + overrideUrl + " (channel=" + channel + ")");
  }

  updater.autoDownload = options.autoDownload ?? true;
  updater.autoInstallOnAppQuit = options.autoInstallOnAppQuit ?? true;
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  if (unconfirmedVersion) markInstallUnconfirmed(unconfirmedVersion);

  // 받아 둔 업데이트를 둔 채 앱을 끄면 electron-updater 가 조용히 설치한다(다시 열지는 않는다).
  // electron-updater 와 같은 조건(자동 설치 켜짐·정상 종료)에 설치 파일이 있을 때 그 설치도 기록해,
  // 다음 실행에서 적용 여부를 확인한다. 이 실행에서 직접 요청한 설치는 이미 기록했으므로 건너뛴다.
  const onQuit = (_event, exitCode) => {
    if (!updater || installRequestedThisSession || updaterState.status !== "ready" || updater.autoInstallOnAppQuit !== true) return;
    if (typeof exitCode === "number" && exitCode !== 0) return;
    if (!downloadedInstallerPath || !fs.existsSync(downloadedInstallerPath)) return;
    writeUpdateStateFile(stateFilePath, {
      pendingInstall: {
        version: updaterState.updateVersion,
        fromVersion: updaterState.currentVersion,
        requestedAt: new Date().toISOString(),
        mode: "on_quit",
        reason: "app_quit",
        execPath: currentExecPath,
      },
    });
    updaterLog.info("앱 종료와 함께 조용히 설치: " + (updaterState.currentVersion || "?") + " → " + updaterState.updateVersion);
  };
  app.on?.("quit", onQuit);

  const activeUpdater = updater;
  const listeners = [];
  const onUpdate = (event, listener) => {
    const guarded = (...args) => { if (updater === activeUpdater) listener(...args); };
    activeUpdater.on(event, guarded);
    listeners.push([event, guarded]);
  };
  removeUpdaterListeners = () => { for (const [event, listener] of listeners) activeUpdater.removeListener(event, listener); };

  onUpdate("checking-for-update", () => {
    setUpdaterState({ status: "checking", errorMessage: "", userMessage: "업데이트 확인 중" });
  });
  onUpdate("update-available", (info) => {
    setUpdaterState({
      status: "available",
      errorMessage: "",
      progressPercent: 0,
      updateVersion: info?.version ?? "",
      lastCheckedAt: new Date().toISOString(),
      userMessage: "새 버전 " + (info?.version ?? "") + "을 찾았습니다.",
    });
  });
  onUpdate("update-not-available", () => {
    setUpdaterState({ status: "uptodate", updateVersion: "", errorMessage: "", lastCheckedAt: new Date().toISOString(), userMessage: "최신 버전입니다." });
  });
  onUpdate("download-progress", (progress) => {
    const pct = Math.round(progress?.percent ?? 0);
    setUpdaterState({
      status: "downloading",
      progressPercent: pct,
      userMessage: "업데이트 다운로드 중 " + pct + "%",
    });
  });
  onUpdate("update-downloaded", (info) => {
    const version = info?.version ?? updaterState.updateVersion;
    downloadedInstallerPath = typeof info?.downloadedFile === "string" ? info.downloadedFile : "";
    downloadedFileInfo = info;
    setUpdaterState({
      status: "ready",
      updateVersion: version,
      progressPercent: 100,
      downloadedAt: new Date().toISOString(),
      errorMessage: "",
      userMessage: updaterState.installUnconfirmedVersion
        ? notConfirmedMessage(updaterState.installUnconfirmedVersion)
        : "새 버전 " + version + "을 받았습니다. 지금 업데이트하면 앱을 닫고 설치한 뒤 다시 엽니다.",
    });
    updaterLog.info("받기 완료: " + version + " → " + (downloadedInstallerPath || "(설치 파일 경로 없음)"));
  });
  onUpdate("update-cancelled", () => {
    setUpdaterState({ status: "available", progressPercent: 0, errorMessage: "", userMessage: "업데이트 다운로드를 취소했습니다. 다시 받을 수 있어요." });
  });
  onUpdate("error", (error) => {
    if (updaterState.status === "install_requested") {
      // 설치기 실행 단계의 오류(설치 파일 없음, 실행 거부 등). 이번 요청은 진행되지 않았다.
      returnToReadyAfterStall(readPendingInstall(readUpdateStateFile(stateFilePath).pendingInstall), "installer_error", error);
      return;
    }
    reportUpdateError(error, downloadInFlight || updaterState.status === "downloading" ? "download" : "check");
  });

  await checkForUpdates();
  if (!periodicCheckTimer && options.periodicCheck !== false) {
    periodicCheckTimer = setInterval(() => {
      void checkForUpdates();
    }, periodicCheckIntervalMs);
    periodicCheckTimer.unref?.();
  }
  // 트레이에서 돌아왔을 때도 확인한다. 창을 오가는 동안에는 1분에 한 번으로 제한한다.
  const onFocus = () => { if (Date.now() - lastCheckStartedAt >= 60_000) void checkForUpdates(); };
  const onBeforeQuit = () => {
    if (periodicCheckTimer) { clearInterval(periodicCheckTimer); periodicCheckTimer = null; }
    app.removeListener?.("browser-window-focus", onFocus);
  };
  app.on?.("browser-window-focus", onFocus);
  app.on?.("before-quit", onBeforeQuit);
  removeLifecycleListeners = () => {
    app.removeListener?.("browser-window-focus", onFocus);
    app.removeListener?.("before-quit", onBeforeQuit);
    app.removeListener?.("quit", onQuit);
  };

  return updater;
}

export function getAutoUpdater() {
  return updater ?? null;
}

export function getAutoUpdaterState() {
  return { ...updaterState };
}

export async function handleDesktopUpdateMessage(_event, payload = {}) {
  const action = String(payload.action ?? payload.kind ?? "");

  if (action === "status") {
    return getAutoUpdaterState();
  }

  if (action === "ack_updated") {
    // "x 로 업데이트됨" 안내를 봤다. 다음 실행부터는 다시 띄우지 않는다.
    setUpdaterState({ updatedFromVersion: "" });
    return getAutoUpdaterState();
  }

  if (action === "check") {
    if (!updater) return getAutoUpdaterState();
    await checkForUpdates();
    return getAutoUpdaterState();
  }

  if (action === "download") {
    if (!updater || ["ready", "install_requested"].includes(updaterState.status)) return getAutoUpdaterState();
    if (downloadInFlight) { await downloadInFlight; return getAutoUpdaterState(); }
    if (checkInFlight) { await checkInFlight; return getAutoUpdaterState(); }
    if (updaterState.status !== "available") { await checkForUpdates(); return getAutoUpdaterState(); }
    if (typeof updater.downloadUpdate === "function") {
      const owner = updater;
      setUpdaterState({ status: "downloading", errorMessage: "", userMessage: "업데이트 다운로드를 준비하고 있습니다." });
      await observeDownload(Promise.resolve().then(() => owner.downloadUpdate()), owner);
    }
    return getAutoUpdaterState();
  }

  if (action === "install_on_quit") {
    // 옛 화면이 쓰던 요청: 예전처럼 설치 화면을 띄워 바로 설치한다.
    return requestInstall({ visible: true, reason: "install_on_quit" });
  }

  if (action === "install_now") {
    // 받아 둔 업데이트를 바로 설치한다: 앱을 닫고 설치기를 실행한다(조용한 설치는 끝나면 다시 연다).
    return requestInstall({ visible: payload.mode === "visible", reason: "install_now" });
  }

  return {
    ...getAutoUpdaterState(),
    status: "unsupported_action",
    userMessage: "지원하지 않는 업데이트 요청입니다.",
  };
}

export function getAutoUpdaterStateFilePath() {
  return stateFilePath;
}

export function getAutoUpdaterLogFilePath() {
  return logFilePath;
}
