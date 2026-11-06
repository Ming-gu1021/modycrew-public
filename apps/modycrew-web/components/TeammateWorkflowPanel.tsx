"use client";

/**
 * TeammateWorkflowPanel — 직원별 워크플로우 칸
 *
 * 직원(AI 팀원)이 만들어지면 그 직원에게 어울리는 업무 흐름을 한 곳에서 보여준다.
 * ① 폴더 맡기기 → ② 읽고 학습(맞춤 직원) → ③ 정리 제안(승인 후 실행) → ④ 파일 찾기·반복 업무
 *
 * - 가상 오피스 장면(VirtualOfficeScene) 바로 아래에서 현재 직원과 연동
 * - 외부 의존성 없음. --mc-* 디자인 토큰만 사용 (라이트/다크 자동 대응)
 * - 원본 이동/삭제/외부 전송은 이 칸에서 직접 실행하지 않고 승인 흐름으로만 넘긴다.
 */

import { useState } from "react";
import styles from "./TeammateWorkflowPanel.module.css";

export type TeammateWorkflowPanelLiveState = "working" | "waiting" | "idle";

export interface TeammateWorkflowPanelFolder {
  id: string;
  label: string;
  path: string;
  fileCount?: number;
  lastScannedAt?: string;
}

export interface TeammateWorkflowPanelRule {
  id: string;
  title: string;
  enabled: boolean;
  cadenceLabel?: string;
}

export interface TeammateWorkflowPanelProps {
  teammateName: string;
  roleTitle: string;
  teamLabel: string;
  liveState: TeammateWorkflowPanelLiveState;
  liveDetail?: string;
  desktopReady: boolean;
  busy?: boolean;
  folders: TeammateWorkflowPanelFolder[];
  learnedFileCount: number;
  lastLearnedAt?: string;
  rules: TeammateWorkflowPanelRule[];
  onPickFolders: () => void;
  onAssignDesktop: () => void;
  onRemoveFolder: (folderId: string) => void;
  onLearn: () => void;
  onTidy: () => void;
  onTidyReview: () => void;
  onFindFile: (query: string) => void;
  onToggleRule: (ruleId: string) => void;
  onOpenOffice: () => void;
}

const LIVE_LABELS: Record<TeammateWorkflowPanelLiveState, string> = {
  working: "일하는 중",
  waiting: "승인 대기",
  idle: "대기 중",
};

function formatKoreanDateTime(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TeammateWorkflowPanel({
  teammateName,
  roleTitle,
  teamLabel,
  liveState,
  liveDetail,
  desktopReady,
  busy = false,
  folders,
  learnedFileCount,
  lastLearnedAt,
  rules,
  onPickFolders,
  onAssignDesktop,
  onRemoveFolder,
  onLearn,
  onTidy,
  onTidyReview,
  onFindFile,
  onToggleRule,
  onOpenOffice,
}: TeammateWorkflowPanelProps) {
  const [findQuery, setFindQuery] = useState("");

  const hasFolders = folders.length > 0;
  const hasLearned = learnedFileCount > 0;
  const learnedLabel = hasLearned
    ? `파일 ${learnedFileCount}개 학습${lastLearnedAt ? ` · ${formatKoreanDateTime(lastLearnedAt)}` : ""}`
    : "아직 학습 전";

  const steps: Array<{ key: string; label: string; note: string; state: "done" | "next" | "waiting" }> = [
    {
      key: "assign",
      label: "폴더 맡기기",
      note: hasFolders ? `${folders.length}곳 담당` : "담당 위치 지정",
      state: hasFolders ? "done" : "next",
    },
    {
      key: "learn",
      label: "읽고 학습",
      note: hasLearned ? learnedLabel : "맞춤 직원 만들기",
      state: hasLearned ? "done" : hasFolders ? "next" : "waiting",
    },
    {
      key: "tidy",
      label: "정리 제안",
      note: "승인 후에만 이동",
      state: hasLearned ? "next" : "waiting",
    },
    {
      key: "assist",
      label: "찾기·반복 업무",
      note: rules.some((rule) => rule.enabled) ? `반복 ${rules.filter((rule) => rule.enabled).length}개 켜짐` : "필요할 때 지시",
      state: rules.some((rule) => rule.enabled) ? "done" : "waiting",
    },
  ];

  function submitFind() {
    const query = findQuery.trim();
    if (!query) return;
    onFindFile(query);
    setFindQuery("");
  }

  return (
    <section
      className={styles.panel}
      data-testid="teammate-workflow-panel"
      data-live-state={liveState}
      data-external-mutation="false"
      aria-label={`${teammateName} 직원 워크플로우`}
    >
      <header className={styles.head}>
        <div className={styles.headIdentity}>
          <span>현재 업무</span>
          <strong>{teammateName}</strong>
        </div>
        <b className={styles.liveBadge} data-state={liveState}>
          <i aria-hidden />
          {LIVE_LABELS[liveState]}
        </b>
      </header>

      <button type="button" className={`${styles.actionButton} ${styles.actionButtonPrimary} ${styles.primaryAction}`} onClick={onOpenOffice}>
        오피스에서 이어가기
      </button>

      <details className={styles.management}>
        <summary className={styles.managementSummary}>업무 관리</summary>
        <div className={styles.managementContent}>
          <p className={styles.liveDetail}>{liveDetail || "지시를 기다리는 중이에요. 폴더를 맡기면 그 범위 안에서 일합니다."}</p>
          <p className={styles.roleDetail}>{roleTitle} · {teamLabel}</p>

      <ol className={styles.steps} aria-label="직원 업무 단계">
        {steps.map((step) => (
          <li key={step.key} data-state={step.state}>
            <strong>{step.label}</strong>
            <small>{step.note}</small>
          </li>
        ))}
      </ol>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <span>맡은 폴더</span>
          <small>{hasFolders ? `${folders.length}곳 · ${learnedLabel}` : "0곳"}</small>
        </div>
        {hasFolders ? (
          <div className={styles.folderList}>
            {folders.map((folder) => (
              <div key={folder.id} className={styles.folderRow}>
                <strong>{folder.label}</strong>
                <small title={folder.path}>{folder.path}</small>
                {typeof folder.fileCount === "number" ? <small>{folder.fileCount}개</small> : null}
                <button
                  type="button"
                  className={styles.folderRemove}
                  onClick={() => onRemoveFolder(folder.id)}
                  disabled={busy}
                  aria-label={`${folder.label} 담당 해제`}
                  title="담당 해제 (원본 폴더는 그대로 둡니다)"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.emptyHint}>
            아직 맡은 폴더가 없어요. 폴더를 지정하면 {teammateName} 직원이 그 안의 파일을 읽고 학습해 맞춤 직원이 됩니다.
            {desktopReady ? "" : " (폴더 접근은 설치된 Windows 앱에서 열립니다)"}
          </p>
        )}
        <div className={styles.actionRow}>
          <button type="button" className={styles.actionButton} onClick={onPickFolders} disabled={busy}>
            폴더 지정
          </button>
          <button type="button" className={styles.actionButton} onClick={onAssignDesktop} disabled={busy}>
            바탕화면 맡기기
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
            onClick={onLearn}
            disabled={busy || !hasFolders}
            title={hasFolders ? "맡은 폴더를 읽고 업무 방식을 학습합니다" : "먼저 폴더를 지정해 주세요"}
          >
            읽고 학습하기
          </button>
        </div>
      </div>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <span>바로 지시</span>
          <small>정리는 승인 후에만 실행</small>
        </div>
        <div className={styles.actionRow}>
          <button type="button" className={styles.actionButton} onClick={onTidy} disabled={busy}>
            정리안 만들기
          </button>
          <button type="button" className={styles.actionButton} onClick={onTidyReview} disabled={busy}>
            정리안 검토
          </button>
        </div>
        <div className={styles.findRow}>
          <input
            value={findQuery}
            placeholder="찾을 파일을 설명해 주세요 — 예: 3월 견적서"
            onChange={(event) => setFindQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitFind();
              }
            }}
            disabled={busy}
            aria-label="파일 찾기 검색어"
          />
          <button type="button" className={styles.actionButton} onClick={submitFind} disabled={busy || !findQuery.trim()}>
            파일 찾기
          </button>
        </div>
      </div>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <span>반복 업무</span>
          <small>{rules.length ? `${rules.length}개 · 기본 꺼짐` : "학습을 마치면 맞춤 반복 업무를 제안해요"}</small>
        </div>
        {rules.length ? (
          <div className={styles.ruleList}>
            {rules.map((rule) => (
              <div key={rule.id} className={styles.ruleRow}>
                <button
                  type="button"
                  className={styles.ruleToggle}
                  data-enabled={rule.enabled ? "true" : "false"}
                  onClick={() => onToggleRule(rule.id)}
                  disabled={busy}
                  aria-label={rule.enabled ? `${rule.title} 끄기` : `${rule.title} 켜기`}
                >
                  {rule.enabled ? "켜짐" : "꺼짐"}
                </button>
                <strong title={rule.title}>{rule.title}</strong>
                {rule.cadenceLabel ? <small>{rule.cadenceLabel}</small> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <footer className={styles.foot}>
        <small>원본 이동·삭제·외부 전송은 승인 전에 실행하지 않아요.</small>
        <button type="button" className={styles.footLink} onClick={onOpenOffice}>
          오피스 보기
        </button>
      </footer>
        </div>
      </details>
    </section>
  );
}
