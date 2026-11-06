/**
 * 설치형 업데이트 상태를 트레이 메뉴·OS 알림·화면(사이드바 버튼)으로 잇는 순수 규칙.
 * Electron 객체를 만지지 않으므로 node --test 로 바로 검증한다.
 */

const ACTIONABLE = new Set(["available", "downloading", "ready", "install_requested"]);

function text(value, max) {
  return String(value ?? "").slice(0, max);
}

/** 화면(렌더러)으로 보내는 상태. 필요한 필드만 길이 제한을 두고 넘긴다. */
export function sanitizeDesktopUpdateState(state = {}) {
  const pct = Number(state.progressPercent);
  return {
    status: text(state.status || "idle", 40),
    currentVersion: text(state.currentVersion, 40),
    updateVersion: text(state.updateVersion, 40),
    progressPercent: Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : 0,
    isPackaged: state.isPackaged === true,
    updatedFromVersion: text(state.updatedFromVersion, 40),
    // 설치를 요청했는데 다음 실행에도 옛 버전이었던(적용이 확인되지 않은) 버전. 있으면 다음 설치는 설치 창으로 진행한다.
    installUnconfirmedVersion: text(state.installUnconfirmedVersion, 40),
    installMode: text(state.installMode, 20),
    userMessage: text(state.userMessage, 300),
    errorMessage: state.errorMessage ? text(state.errorMessage, 300) : "",
    lastCheckedAt: text(state.lastCheckedAt, 40),
    downloadedAt: text(state.downloadedAt, 40),
  };
}

/** 사용자가 손댈 수 있는 업데이트가 있는가(받는 중 포함). */
export function isDesktopUpdateActionable(state) {
  return Boolean(state && ACTIONABLE.has(state.status) && state.updateVersion);
}

/**
 * 트레이 메뉴에 넣을 업데이트 항목. action 은 메인이 실제 클릭 동작으로 바꾼다.
 * - ready: 지금 설치 / downloading: 진행률(비활성) / available: 다운로드 / 그 외: 업데이트 확인
 */
export function buildUpdateMenuEntries(state, options = {}) {
  if (!state?.isPackaged) return [];
  const version = text(state.updateVersion, 40);
  const checking = options.checking === true;
  const current = text(state.currentVersion || options.currentVersion, 40);
  if (state.status === "ready" && version) {
    const label = state.installUnconfirmedVersion ? `새 버전 ${version} 설치 창으로 다시 설치` : `새 버전 ${version} 지금 설치`;
    return [{ id: "install", label, enabled: true, action: "install_now" }];
  }
  if (state.status === "install_requested") {
    return [{ id: "installing", label: "업데이트 설치 중…", enabled: false, action: null }];
  }
  if (state.status === "downloading" && version) {
    const pct = sanitizeDesktopUpdateState(state).progressPercent;
    return [{ id: "downloading", label: `새 버전 ${version} 받는 중 ${pct}%`, enabled: false, action: null }];
  }
  if (state.status === "available" && version) {
    return [{ id: "download", label: `새 버전 ${version} 다운로드`, enabled: true, action: "download" }];
  }
  return [{
    id: "check",
    label: checking ? "업데이트 확인 중…" : `업데이트 확인 (현재 ${current || "?"})`,
    enabled: !checking,
    action: checking ? null : "check",
  }];
}

/** 받기 완료를 한 버전당 한 번만 OS 알림으로 알린다. 알릴 필요가 없으면 null. */
export function decideUpdateReadyNotification(state, notifiedVersion = "") {
  if (state?.status !== "ready" || !state.updateVersion || notifiedVersion === state.updateVersion) return null;
  const version = text(state.updateVersion, 40);
  if (state.installUnconfirmedVersion) {
    // 지난 설치가 적용되지 않았는데 같은 약속("다시 엽니다")을 되풀이하지 않는다.
    return {
      version,
      title: "ModyCrew 업데이트가 아직 적용되지 않았습니다",
      body: `누르면 앱을 닫고 새 버전 ${version} 설치 창을 엽니다. 진행 상황과 오류를 설치 창에서 볼 수 있습니다.`,
    };
  }
  return {
    version,
    title: `ModyCrew 새 버전 ${version} 준비됨`,
    body: "누르면 앱을 닫고 업데이트한 뒤 다시 엽니다. 창을 열면 왼쪽 메뉴의 업데이트 버튼으로도 설치할 수 있습니다.",
  };
}

/** 트레이에서 직접 '업데이트 확인'을 눌렀을 때 결과 알림 문구. 자동 확인은 조용히 지나간다. */
export function describeManualCheckResult(state) {
  if (state?.status === "uptodate") {
    return { title: "ModyCrew는 최신 버전입니다", body: `현재 ${text(state.currentVersion, 40) || "?"} · 새 버전이 나오면 왼쪽 메뉴와 트레이, 알림으로 알려 드립니다.` };
  }
  if (state?.status === "error") {
    return { title: "업데이트를 확인하지 못했습니다", body: "인터넷 연결을 확인한 뒤 트레이 메뉴에서 다시 눌러 주세요." };
  }
  return null;
}
