"use client";

import { useState } from "react";
import type { WorkspaceProjectView, WorkspaceSessionView, WorkspaceStatus } from "./ProjectWorkspace";
import styles from "./HomeWorkResume.module.css";

export interface HomeWorkResumeProps {
  sessions: WorkspaceSessionView[];
  projects: WorkspaceProjectView[];
  loading?: boolean;
  error?: string;
  onOpenSession: (id: string) => void;
  onOpenOverview: () => void;
}

type WorkFilter = "all" | "waiting" | "in_progress" | "done";

const filters: { id: WorkFilter; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "waiting", label: "대기" },
  { id: "in_progress", label: "진행 중" },
  { id: "done", label: "완료" },
];
const statusLabels: Record<WorkspaceStatus, string> = {
  todo: "할 일",
  in_progress: "진행 중",
  waiting: "대기",
  done: "완료",
};
const statusOrder: Record<WorkspaceStatus, number> = { waiting: 0, in_progress: 1, todo: 2, done: 3 };
const displayedStatus = (session: WorkspaceSessionView): WorkspaceStatus => session.running ? "in_progress" : session.status;

export default function HomeWorkResume({ sessions, projects, loading = false, error, onOpenSession, onOpenOverview }: HomeWorkResumeProps) {
  const [filter, setFilter] = useState<WorkFilter>("all");
  const projectById = new Map(projects.map(project => [project.id, project]));
  const available = sessions.filter(session => !session.archivedAt && !(session.projectId && projectById.get(session.projectId)?.archivedAt));
  const filtered = available
    .filter(session => filter === "all" || displayedStatus(session) === filter)
    .sort((left, right) => statusOrder[displayedStatus(left)] - statusOrder[displayedStatus(right)]
      || Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
      || right.updatedAt - left.updatedAt);
  const visible = filtered.slice(0, 4);

  return (
    <section className={styles.resume} aria-label="업무 이어가기" data-home-work-resume>
      <header className={styles.header}>
        <h2>업무 이어가기</h2>
        <button type="button" className={styles.overview} onClick={onOpenOverview}>전체 업무 <span aria-hidden="true">↗</span></button>
      </header>

      {loading ? <p className={styles.message} role="status">업무 목록을 불러오는 중입니다.</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {!loading && available.length > 0 ? (
        <>
          <div className={styles.filters} role="group" aria-label="이어갈 업무 상태">
            {filters.map(item => {
              const count = item.id === "all" ? available.length : available.filter(session => displayedStatus(session) === item.id).length;
              return <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                {item.label}<span>{count}</span>
              </button>;
            })}
          </div>
          {visible.length ? (
            <ul className={styles.list}>
              {visible.map(session => {
                const status = displayedStatus(session);
                const projectName = session.projectId ? projectById.get(session.projectId)?.name : undefined;
                const preview = session.preview;
                return (
                  <li key={session.id}>
                    <button type="button" className={styles.session} onClick={() => onOpenSession(session.id)} data-home-work-session-id={session.id}>
                      <span className={styles.sessionHeading}>
                        <span className={styles.title} title={session.title}>{session.pinned ? <span className={styles.pin} aria-label="고정됨">◆ </span> : null}{session.title}</span>
                        <span className={styles.status} data-status={status}><i aria-hidden="true" />{statusLabels[status]}</span>
                      </span>
                      <span className={styles.metadata}>{projectName ?? "프로젝트 없음"}{session.teammateName ? ` · ${session.teammateName}` : ""}</span>
                      {preview?.text ? <span className={styles.preview}><span>{preview.label}</span> {preview.text}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <p className={styles.message} role="status">{filters.find(item => item.id === filter)?.label} 상태의 업무가 없습니다.</p>}
          {filtered.length > visible.length ? <button type="button" className={styles.more} onClick={onOpenOverview}>전체 업무에서 {filtered.length - visible.length}개 더 보기</button> : null}
        </>
      ) : null}

      {!loading && !error && !available.length ? <p className={styles.message}>업무를 시작하면 진행 상황과 결과가 여기에 모입니다.</p> : null}
    </section>
  );
}
