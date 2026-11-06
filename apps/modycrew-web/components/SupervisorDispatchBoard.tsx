"use client";

import type { SupervisorTeamId, SupervisorWorkPlan } from "@/lib/work-supervisor";

import styles from "./SupervisorDispatchBoard.module.css";

export type SupervisorDispatchWorker = {
  teamId: SupervisorTeamId;
  name: string;
  status: "ready" | "queued" | "running" | "done" | "waiting" | "error";
};

type SupervisorDispatchBoardProps = {
  plan: SupervisorWorkPlan;
  state: "idle" | "planned" | "routing" | "review" | "approval";
  workers: SupervisorDispatchWorker[];
  doneCount: number;
  totalCount: number;
  aiReady: boolean;
  desktopReady: boolean;
  primaryActionLabel: string;
  primaryActionDisabled?: boolean;
  onPrimaryAction: () => void;
  onBackToChat: () => void;
};

const STATE_LABELS: Record<SupervisorDispatchBoardProps["state"], string> = {
  idle: "업무 대기",
  planned: "배정안 준비",
  routing: "직원 처리 중",
  review: "결과 취합 준비",
  approval: "사용자 확인 대기",
};

const WORKER_STATE_LABELS: Record<SupervisorDispatchWorker["status"], string> = {
  ready: "준비",
  queued: "배정됨",
  running: "처리 중",
  done: "결과 준비",
  waiting: "연결 필요",
  error: "확인 필요",
};

export default function SupervisorDispatchBoard({
  plan,
  state,
  workers,
  doneCount,
  totalCount,
  aiReady,
  desktopReady,
  primaryActionLabel,
  primaryActionDisabled = false,
  onPrimaryAction,
  onBackToChat,
}: SupervisorDispatchBoardProps) {
  const hasRequest = Boolean(plan.requestText);
  const visibleRoutes = plan.routes;
  const progressLabel = totalCount ? `${doneCount}/${totalCount}명 결과` : plan.modeLabel;

  return (
    <section
      className={styles.board}
      aria-label="총괄 AI 업무 배정"
      data-supervisor-dispatch-board="request_route_merge_approval"
      data-supervisor-contract={plan.contract}
      data-supervisor-mode={plan.mode}
      data-supervisor-state={state}
      data-auto-dispatch={plan.dispatchTeams.length ? "ready" : "held"}
      data-final-boundary="approval_before_external_mutation"
      data-external-mutation="false"
    >
      <div className={styles.atmosphere} aria-hidden="true" />
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.monogram} aria-hidden="true">총</span>
          <div>
            <small>총괄 담당자</small>
            <strong>말하면, 알맞은 직원에게 알아서 나눕니다</strong>
            <p>업무 영역을 판단하고 직원별 결과를 다시 하나로 모읍니다.</p>
          </div>
        </div>
        <div className={styles.stateBadge} data-state={state} role="status" aria-live="polite">
          <i aria-hidden="true" />
          <span>{STATE_LABELS[state]}</span>
          <strong>{progressLabel}</strong>
        </div>
      </header>

      <div className={styles.commandLane}>
        <div className={styles.requestCard} data-empty={hasRequest ? "false" : "true"}>
          <span>{hasRequest ? "총괄이 이해한 요청" : "이렇게 맡겨보세요"}</span>
          <strong>{plan.requestSummary}</strong>
          <small>
            {hasRequest
              ? plan.routes.length
                ? `판단 확신 ${plan.confidence === "high" ? "높음" : plan.confidence === "medium" ? "보통" : "확인 필요"} · ${plan.modeLabel}`
                : "직원 배정이 필요하지 않아 총괄이 대화에서 바로 답합니다."
              : "예: 매장 운영 현황과 이번 달 매출 영향을 함께 정리해줘"}
          </small>
        </div>
        <div className={styles.readinessCard} aria-label="총괄 실행 준비">
          <div data-ready={aiReady ? "true" : "false"}>
            <span>AI</span>
            <strong>{aiReady ? "연결됨" : "연결 필요"}</strong>
          </div>
          <div data-ready={desktopReady ? "true" : "false"}>
            <span>내 PC</span>
            <strong>{desktopReady ? "사용 가능" : "앱 필요"}</strong>
          </div>
          <p>연결이 없어도 배정안은 만들고, 실행 가능한 지점에서 이어갑니다.</p>
        </div>
      </div>

      <div className={styles.routeSection}>
        <div className={styles.sectionTitle}>
          <span>담당 배정</span>
          <strong>{visibleRoutes.length ? `${visibleRoutes.length}개 역할` : "요청에 맞춰 자동 선택"}</strong>
          <small>관련 없는 직원에게는 보내지 않습니다.</small>
        </div>
        {visibleRoutes.length ? (
          <ol className={styles.routeGrid}>
            {visibleRoutes.map((route, index) => {
              const worker = workers.find((item) => item.teamId === route.teamId);
              return (
                <li key={route.teamId} data-state={worker?.status ?? "ready"}>
                  <div className={styles.routeIndex}>
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <span>{route.shortLabel}</span>
                  </div>
                  <div className={styles.routeCopy}>
                    <small>{route.teamLabel}</small>
                    <strong>{worker?.name ?? route.roleLabel}</strong>
                    <p>{route.reason}</p>
                    <em>{route.outputLabel}</em>
                    <span className={styles.routeInput}>필요: {route.requiredInputLabel}</span>
                  </div>
                  <span className={styles.workerState}>
                    {worker
                      ? WORKER_STATE_LABELS[worker.status]
                      : plan.dispatchTeams.includes(route.teamId)
                        ? "배정 예정"
                        : plan.mode === "dedicated_runtime"
                          ? "전담 흐름"
                          : "현재 직원 처리"}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className={styles.emptyRoutes}>
            <span>한 문장으로 요청</span>
            <span>총괄이 역할 판단</span>
            <span>필요한 직원만 배정</span>
          </div>
        )}
      </div>

      <ol className={styles.flow} aria-label="총괄 업무 처리 순서">
        {plan.steps.map((step, index) => (
          <li key={step.id} data-current={index === (state === "routing" ? 1 : state === "review" ? 2 : state === "approval" ? 3 : 0) ? "true" : "false"}>
            <span>{index + 1}</span>
            <div>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </div>
          </li>
        ))}
      </ol>

      <footer className={styles.footer}>
        <div>
          <span aria-hidden="true">✓</span>
          <p><strong>안전 잠금</strong>{plan.safetyLabel}</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryAction} onClick={onBackToChat}>대화로</button>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={onPrimaryAction}
            disabled={primaryActionDisabled}
            data-supervisor-primary-action="true"
          >
            {primaryActionLabel}
          </button>
        </div>
      </footer>
    </section>
  );
}
