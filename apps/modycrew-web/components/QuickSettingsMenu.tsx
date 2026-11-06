"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import styles from "./QuickSettingsMenu.module.css";
import DisplayPreferences from "./DisplayPreferences";
import { openFirstUseTutorial } from "@/lib/first-use-tutorial";

export type QuickSettingsSurface = "sidebar" | "mobile" | "home";

type QuickSettingsMenuProps = {
  surface: QuickSettingsSurface;
  aiConnected: boolean;
  memoryReady: boolean;
  theme: "light" | "dark" | "system";
  onClose: () => void;
  onConnectAI: () => void;
  onOpenAccounts: () => void;
  onOpenMemory: () => void;
  onOpenApproval: () => void;
  onToggleTheme: () => void;
  onOpenLearn: () => void;
  onOpenConnections: () => void;
  onOpenMessenger: () => void;
  onOpenTools: () => void;
  onOpenComputer: () => void;
  onOpenWorkers: () => void;
  onInspectMemory: () => void;
};

function StatusIcon({ kind }: { kind: "ai" | "account" | "memory" | "approval" | "theme" | "more" }) {
  if (kind === "ai") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.5 14 8l4.5 2-4.5 2-2 4.5-2-4.5-4.5-2L10 8l2-4.5Z" />
      </svg>
    );
  }
  if (kind === "account") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="3.25" />
        <path d="M5.5 19c.75-3.35 3-5 6.5-5s5.75 1.65 6.5 5" />
      </svg>
    );
  }
  if (kind === "memory") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.5 7.5h6l1.5 2h9.5v8.75A1.75 1.75 0 0 1 18.75 20H5.25a1.75 1.75 0 0 1-1.75-1.75V7.5Z" />
      </svg>
    );
  }
  if (kind === "approval") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="m8.25 12 2.4 2.4 5.2-5.2" />
      </svg>
    );
  }
  if (kind === "theme") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 14.3A8 8 0 0 1 9.7 4a8 8 0 1 0 10.3 10.3Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18" cy="12" r="1.5" />
    </svg>
  );
}

export default function QuickSettingsMenu({
  surface,
  aiConnected,
  memoryReady,
  theme,
  onClose,
  onConnectAI,
  onOpenAccounts,
  onOpenMemory,
  onOpenApproval,
  onToggleTheme,
  onOpenLearn,
  onOpenConnections,
  onOpenMessenger,
  onOpenTools,
  onOpenComputer,
  onOpenWorkers,
  onInspectMemory,
}: QuickSettingsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const priority = !aiConnected
    ? { label: "AI 답변 연결", target: "ai" as const, action: onConnectAI }
    : !memoryReady
      ? { label: "기억 위치 정하기", target: "memory-root" as const, action: onOpenMemory }
      : { label: "승인함 확인", target: "approval-office" as const, action: onOpenApproval };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    menuRef.current?.focus();
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const runAndClose = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <>
      {surface !== "sidebar" ? (
        <button
          type="button"
          className={styles.scrim}
          onClick={onClose}
          aria-label="간단 설정 닫기"
          data-settings-surface={surface}
        />
      ) : null}
      <div
        ref={menuRef}
        className={styles.menu}
        role="menu"
        tabIndex={-1}
        aria-label="간단 설정"
        data-settings-organization="basic_connection_advanced"
        data-settings-disclosure="single_next_action_advanced_folded"
        data-settings-top-priority="single_next_action"
        data-settings-surface={surface}
      >
        <header className={styles.header}>
          <div>
            <strong>설정</strong>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="간단 설정 닫기">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button>
        </header>

        <button
          type="button"
          role="menuitem"
          className={styles.priorityAction}
          data-settings-priority-action="first_missing_requirement"
          data-settings-priority-target={priority.target}
          data-settings-priority-visible="single_next_action"
          onClick={() => runAndClose(priority.action)}
        >
          <span className={styles.iconBox}>
            <StatusIcon kind={priority.target === "ai" ? "ai" : priority.target === "memory-root" ? "memory" : "approval"} />
          </span>
          <span className={styles.actionCopy}>
            <strong>{priority.label}</strong>
          </span>
          <span className={styles.arrow} aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M4 10h12m-5-5 5 5-5 5" /></svg></span>
        </button>

        <DisplayPreferences />
        <button type="button" role="menuitem" className={styles.priorityAction} onClick={() => runAndClose(openFirstUseTutorial)}>튜토리얼 다시 보기</button>
        <details className={styles.moreSettings} data-settings-advanced-fold="optional_tools_on_demand" data-settings-advanced-default="closed">
          <summary>
            <span className={styles.iconBox}><StatusIcon kind="more" /></span>
            <span>
              <strong>다른 설정</strong>
            </span>
            <span className={styles.chevron} aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m5 7.5 5 5 5-5" /></svg></span>
          </summary>
          <div className={styles.readiness} aria-label="설정 준비 상태">
            <span data-ready={aiConnected ? "true" : "false"}>{aiConnected ? "AI 연결됨" : "AI 연결 필요"}</span>
            <span data-ready={memoryReady ? "true" : "false"}>{memoryReady ? "기억 준비됨" : "기억 위치 선택"}</span>
          </div>
          <div className={styles.quickActions} aria-label="자주 쓰는 설정">
            <Link href="/account" role="menuitem" onClick={onClose} data-settings-entry="account">
              <StatusIcon kind="account" />
              <span>내 계정</span>
            </Link>
            {/* AI 연결 설정은 계정 화면의 접힘을 여러 번 열어야 나왔다. 바로 그 칸으로 간다. */}
            <Link href="/account#ai-connection" role="menuitem" onClick={onClose} data-settings-entry="ai-settings">
              <StatusIcon kind="ai" />
              <span>AI 연결 설정</span>
            </Link>
            <button type="button" role="menuitem" onClick={onToggleTheme} data-settings-entry="theme" data-settings-theme-toggle="korean_label_same_as_header">
              <StatusIcon kind="theme" />
              <span>{theme === "dark" ? "밝게 보기" : "어둡게 보기"}</span>
            </button>
          </div>
          <div className={styles.moreGrid} role="group" aria-label="설정 안쪽 전체 기능" data-settings-advanced-group="learn_connections_messenger_tools_pc_workers">
            <button type="button" role="menuitem" onClick={() => runAndClose(onOpenAccounts)} data-settings-entry="vault">계정 보관함</button>
            <button type="button" role="menuitem" onClick={() => runAndClose(onOpenMemory)} data-settings-entry="memory-root">기억 위치</button>
            <button type="button" role="menuitem" onClick={() => runAndClose(onOpenApproval)} data-settings-entry="approval-office">승인함</button>
            <button type="button" role="menuitem" onClick={() => runAndClose(onOpenConnections)}>업무 연결</button>
            <button type="button" role="menuitem" onClick={() => runAndClose(onOpenLearn)}>자료 분석</button>
            <button type="button" role="menuitem" onClick={() => runAndClose(onOpenWorkers)}>AI 직원</button>
            <button type="button" role="menuitem" onClick={() => runAndClose(onOpenMessenger)}>알림 채널</button>
            <button type="button" role="menuitem" onClick={() => runAndClose(onOpenComputer)}>내 PC 작업</button>
            <button type="button" role="menuitem" onClick={() => runAndClose(onOpenTools)}>업무 도구</button>
            <button type="button" role="menuitem" onClick={() => runAndClose(onInspectMemory)}>기억 점검</button>
          </div>
        </details>
      </div>
    </>
  );
}
