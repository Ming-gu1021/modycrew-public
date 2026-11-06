"use client";

import { useEffect } from "react";
import { clampPercent, isDesktopUpdateActionable, registerDesktopUpdateRailButton, useDesktopUpdateState } from "@/lib/desktop-update";
import styles from "./DesktopUpdateRailButton.module.css";

/**
 * 왼쪽 메뉴 아래의 작은 업데이트 버튼(Codex 식). 새 버전이 있을 때만 나타난다.
 * - 받는 중: 진행률 / 받음: '업데이트' (누르면 앱을 닫고 설치 후 다시 연다) / 설치 중: 안내만.
 * 상태는 메인이 밀어 주므로 창이 가려져 있어도 바로 바뀐다. 웹(브라우저)에서는 그리지 않는다.
 */
export default function DesktopUpdateRailButton({ collapsed = false }: { collapsed?: boolean }) {
  const { state, busy, notice, installNow, download } = useDesktopUpdateState();
  const actionable = Boolean(state && state.isPackaged !== false && isDesktopUpdateActionable(state));
  useEffect(() => (actionable ? registerDesktopUpdateRailButton() : undefined), [actionable]);
  if (!actionable || !state) return null;

  const version = state.updateVersion || "";
  const pct = clampPercent(state.progressPercent);
  const status = state.status;
  const unconfirmed = state.installUnconfirmedVersion || "";
  const label = status === "ready" ? "업데이트" : status === "downloading" ? `받는 중 ${pct}%` : status === "install_requested" ? "설치 중…" : "새 버전";
  // 지난 설치가 적용되지 않았거나 설치를 시작했으면 메인이 보낸 실제 안내를 그대로 보여 준다.
  const title = notice || (status === "ready"
    ? (unconfirmed ? (state.userMessage || `새 버전 ${version}을 설치 창으로 다시 설치합니다`) : `새 버전 ${version} 설치 — 앱을 닫고 다시 엽니다`)
    : status === "downloading" ? `새 버전 ${version} 받는 중 ${pct}%`
    : status === "install_requested" ? (state.userMessage || "업데이트를 설치하는 중입니다")
    : `새 버전 ${version} 다운로드`);
  const disabled = busy || status === "downloading" || status === "install_requested";
  const onClick = () => { if (status === "ready") void installNow(); else if (status === "available") void download(); };

  return (
    <button
      type="button"
      className={styles.button}
      data-desktop-update-sidebar="true"
      data-update-status={status}
      data-update-version={version}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={`${title}`}
      aria-live="polite"
    >
      <span className={styles.icon} aria-hidden="true">{status === "downloading" ? "↓" : "⬆"}</span>
      {collapsed ? null : <span className={styles.text}><strong>{label}</strong><small>{version}</small></span>}
      {status === "downloading" ? <span className={styles.progress} style={{ width: `${pct}%` }} aria-hidden="true" /> : null}
    </button>
  );
}
