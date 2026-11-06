"use client";

import { useState } from "react";
import { clampPercent, isDesktopUpdateActionable, useDesktopUpdateRailButtonMounted, useDesktopUpdateState } from "@/lib/desktop-update";
import styles from "./DesktopUpdateBanner.module.css";

/**
 * 설치 앱 업데이트 안내 띠.
 * - 업데이트가 적용된 첫 실행에는 "x로 업데이트됐습니다"를 한 번 알린다(확인하면 다시 띄우지 않음).
 * - 새 버전 받는 중/받음은 왼쪽 메뉴의 업데이트 버튼이 맡는다. 그 버튼이 없는 화면에서만 이 띠가 대신 보여 준다.
 * - 다만 설치를 시작할 때(앱이 곧 닫힘)와 지난 설치가 적용되지 않았을 때는 버튼만으로 이유가 보이지 않으므로
 *   버튼이 있어도 이 띠로 알린다.
 * 웹(브라우저)에서는 아무것도 그리지 않는다.
 */
const DISMISS_KEY = "modycrew-update-banner-dismissed-v1";

function readDismissed() {
  try { return window.sessionStorage.getItem(DISMISS_KEY) ?? ""; } catch { return ""; }
}

export default function DesktopUpdateBanner() {
  const { state, busy, notice, installNow, download, ackUpdated } = useDesktopUpdateState();
  const railMounted = useDesktopUpdateRailButtonMounted();
  const [dismissedVersion, setDismissedVersion] = useState(() => (typeof window === "undefined" ? "" : readDismissed()));

  if (!state || state.isPackaged === false) return null;
  const version = state.updateVersion || "";
  const updatedFrom = state.updatedFromVersion || "";
  const unconfirmed = state.installUnconfirmedVersion || "";
  const installing = state.status === "install_requested";
  const needsExplanation = installing || Boolean(unconfirmed);
  const showUpdate = isDesktopUpdateActionable(state)
    && (!railMounted || needsExplanation)
    && (installing || version !== dismissedVersion);

  if (!showUpdate && updatedFrom) {
    return (
      <div className={styles.banner} role="status" aria-live="polite" data-desktop-update-status="updated" data-desktop-update-version={state.currentVersion || ""}>
        <span className={styles.icon} aria-hidden="true">✓</span>
        <div className={styles.text}>
          <strong>ModyCrew가 {state.currentVersion || "새 버전"}으로 업데이트됐습니다</strong>
          <small>이전 {updatedFrom}에서 올라왔습니다. 앞으로 새 버전이 나오면 왼쪽 메뉴의 업데이트 버튼과 트레이, 알림으로 알려 드립니다.</small>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => void ackUpdated()} aria-label="업데이트 완료 안내 닫기">확인</button>
        </div>
      </div>
    );
  }
  if (!showUpdate) return null;

  const pct = clampPercent(state.progressPercent);
  const dismiss = () => {
    setDismissedVersion(version);
    try { window.sessionStorage.setItem(DISMISS_KEY, version); } catch { /* 무시 */ }
  };
  const headline = state.status === "ready"
    ? (unconfirmed ? "지난 업데이트가 적용되지 않았습니다" : `새 버전 ${version}을 받았습니다`)
    : state.status === "downloading" ? `새 버전 ${version} 받는 중 ${pct}%`
    : installing ? "업데이트 설치 중"
    : `새 버전 ${version}이 있습니다`;
  const detail = notice || (state.status === "ready"
    ? (unconfirmed
      ? (state.userMessage || `새 버전 ${version}을 설치 창으로 다시 설치합니다.`)
      : `지금 업데이트하면 앱을 닫고 설치한 뒤 다시 엽니다. 몇 분 걸릴 수 있어요. 현재 ${state.currentVersion || "?"}.`)
    : state.status === "downloading" ? "다 받으면 '지금 업데이트' 버튼이 켜집니다."
    : installing ? (state.userMessage || "잠시만 기다려 주세요.")
    : "다운로드를 시작하면 바로 받습니다.");

  return (
    <div className={styles.banner} role="status" aria-live="polite" data-desktop-update-status={state.status} data-desktop-update-version={version} data-desktop-update-unconfirmed={unconfirmed || undefined}>
      <span className={styles.icon} aria-hidden="true">{unconfirmed && !installing ? "!" : "⬆"}</span>
      <div className={styles.text}>
        <strong>{headline}</strong>
        <small>{detail}</small>
      </div>
      <div className={styles.actions}>
        {state.status === "ready" ? <button type="button" className={styles.primary} disabled={busy} onClick={() => void installNow()}>{unconfirmed ? "설치 창으로 업데이트" : "지금 업데이트"}</button> : null}
        {state.status === "available" ? <button type="button" className={styles.primary} disabled={busy} onClick={() => void download()}>다운로드</button> : null}
        {!installing ? <button type="button" className={styles.secondary} disabled={busy} onClick={dismiss} aria-label="업데이트 알림 나중에 보기">나중에</button> : null}
      </div>
    </div>
  );
}
