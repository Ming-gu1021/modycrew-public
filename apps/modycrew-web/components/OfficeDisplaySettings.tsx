"use client";

import { useId } from "react";
import DisplayPreferences from "./DisplayPreferences";
import styles from "./OfficeDisplaySettings.module.css";

export default function OfficeDisplaySettings() {
  const panelId = useId();

  return (
    <details className={styles.settings}>
      <summary
        className={styles.trigger}
        aria-label="사무실 화면 설정"
        aria-controls={panelId}
        title="화면 크기 · 사무실 크기 · 배경 · 움직임 설정"
        data-office-topbar-action="display-settings"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 5h3m4 0h7M3 10h9m4 0h1M3 15h1m4 0h9" />
          <circle cx="8" cy="5" r="2" />
          <circle cx="14" cy="10" r="2" />
          <circle cx="6" cy="15" r="2" />
        </svg>
        <span>화면</span>
      </summary>
      <div id={panelId} className={styles.panel}>
        <DisplayPreferences />
      </div>
    </details>
  );
}
