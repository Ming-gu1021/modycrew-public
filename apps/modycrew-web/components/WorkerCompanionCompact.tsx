"use client";

import VirtualOfficeScene, { type VirtualOfficeWorker } from "./VirtualOfficeScene";

import styles from "./WorkerCompanionCompact.module.css";

export type WorkerCompanionSizePreset = "compact" | "standard" | "large";

export type WorkerCompanionCompactCard = {
  id: "mail" | "document" | "approval";
  label: string;
  value: string;
  workerName: string;
  state: string;
  stageLabel: string;
  nextActionLabel: string;
  safetyLabel: string;
};

type WorkerCompanionCompactProps = {
  headline: string;
  evidenceLabel: string;
  workers: VirtualOfficeWorker[];
  approvalCount: number;
  cards: WorkerCompanionCompactCard[];
  primaryCard: WorkerCompanionCompactCard;
  displayMode: "app_preview" | "desktop_overlay";
  desktopReady: boolean;
  motionLabel: string;
  sizePreset: WorkerCompanionSizePreset;
  busy: boolean;
  onBackToChat: () => void;
  onWorkerClick: (workerId: string) => void;
  onCreateWorker?: () => void;
  onOpenAppPreview: () => void;
  onOpenDesktop: () => void;
  onToggleMotion: () => void;
  onSetSize: (sizePreset: WorkerCompanionSizePreset) => void;
  onOpenCard: (cardId: WorkerCompanionCompactCard["id"]) => void;
};

const SIZE_OPTIONS: Array<{ id: WorkerCompanionSizePreset; label: string; detail: string }> = [
  { id: "compact", label: "작게", detail: "440 × 640" },
  { id: "standard", label: "보통", detail: "620 × 760" },
  { id: "large", label: "넓게", detail: "900 × 820" },
];
function cardStateLabel(card: WorkerCompanionCompactCard) {
  if (card.id === "approval" && card.state === "approval_pending") return "확인 필요";
  if (card.state === "idle") return "대기";
  return "작업 중";
}

export default function WorkerCompanionCompact({
  headline,
  evidenceLabel,
  workers,
  approvalCount,
  cards,
  primaryCard,
  displayMode,
  desktopReady,
  motionLabel,
  sizePreset,
  busy,
  onBackToChat,
  onWorkerClick,
  onCreateWorker,
  onOpenAppPreview,
  onOpenDesktop,
  onToggleMotion,
  onSetSize,
  onOpenCard,
}: WorkerCompanionCompactProps) {
  return (
    <div className={styles.shell} data-worker-companion-compact="true" data-display-mode={displayMode}>
      <div className={styles.topbar}>
        <div className={styles.liveState}>
          <span aria-hidden="true" />
          <strong>{headline}</strong>
          <small>{evidenceLabel}</small>
        </div>
        <button type="button" className={styles.backButton} onClick={onBackToChat}>
          ← 대화로 돌아가기
        </button>
      </div>

      <section
        className={styles.nowStrip}
        aria-label="직원 오피스 지금 할 일"
        data-worker-companion-compact-now="current_next_safety"
        data-work-kind={primaryCard.id}
      >
        <article>
          <span>지금 하는 일</span>
          <strong>{primaryCard.workerName}</strong>
          <small>{primaryCard.stageLabel} · {primaryCard.value}</small>
        </article>
        <article data-kind="next">
          <span>다음에 누를 것</span>
          <strong>{primaryCard.nextActionLabel}</strong>
          <button type="button" onClick={() => onOpenCard(primaryCard.id)} disabled={busy}>
            열기
          </button>
        </article>
        <article data-kind="safety">
          <span>안전 잠금</span>
          <strong>{primaryCard.safetyLabel}</strong>
          <small>사용자 확인 전 외부 변경 없음</small>
        </article>
      </section>

      <div className={styles.mainGrid}>
        <section className={styles.officeScene} aria-label="직원 오피스 장면">
          <VirtualOfficeScene
            workers={workers}
            approvalCount={approvalCount}
            height={sizePreset === "large" ? 500 : sizePreset === "standard" ? 420 : 360}
            sizePreset={sizePreset}
            onWorkerClick={onWorkerClick}
            onCreateWorker={onCreateWorker}
          />
        </section>

        <aside className={styles.workRail} aria-label="메일 문서 승인 바로가기">
          <header>
            <span>업무 바로가기</span>
            <strong>직원을 눌러 작업을 엽니다</strong>
          </header>
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              className={styles.workCard}
              data-work-kind={card.id}
              data-state={card.state}
              onClick={() => onOpenCard(card.id)}
              disabled={busy}
              aria-label={`${card.workerName} ${card.nextActionLabel}`}
            >
              <span className={styles.workMarker} aria-hidden="true">{card.id === "mail" ? "M" : card.id === "document" ? "D" : "✓"}</span>
              <span>
                <small>{card.label} · {cardStateLabel(card)}</small>
                <strong>{card.workerName}</strong>
                <em>{card.stageLabel}</em>
              </span>
              <b>{card.nextActionLabel}</b>
            </button>
          ))}
        </aside>
      </div>

      <details
        className={styles.displayOptions}
        data-worker-companion-compact-support="display_options_only"
        data-worker-companion-size-control="compact_standard_large"
      >
        <summary>
          <span>표시 옵션</span>
          <strong>{displayMode === "desktop_overlay" ? "바탕화면에 표시 중" : "앱 안에서 표시 중"} · {SIZE_OPTIONS.find((option) => option.id === sizePreset)?.label}</strong>
          <small>필요할 때만 변경</small>
        </summary>
        <div role="group" aria-label="직원 오피스 표시 방식">
          <button type="button" aria-pressed={displayMode === "app_preview"} onClick={onOpenAppPreview} disabled={busy}>
            앱 안에서 보기
          </button>
          <button type="button" aria-pressed={displayMode === "desktop_overlay"} onClick={onOpenDesktop} disabled={busy}>
            {desktopReady ? "바탕화면에 띄우기" : "설치 앱에서 사용"}
          </button>
          <button type="button" onClick={onToggleMotion} disabled={busy}>
            움직임 · {motionLabel}
          </button>
        </div>
        <section
          className={styles.sizeOptions}
          aria-label="바탕화면 직원 창 크기"
          data-worker-companion-size-options="compact_standard_large"
          data-current-size={sizePreset}
        >
          <header>
            <span>창 크기</span>
            <small>버튼으로 맞추거나 창 테두리를 드래그해 조절할 수 있습니다.</small>
          </header>
          <div role="group" aria-label="직원 창 크기 선택">
            {SIZE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={sizePreset === option.id}
                data-size-preset={option.id}
                onClick={() => onSetSize(option.id)}
                disabled={busy}
              >
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
        </section>
      </details>
    </div>
  );
}
