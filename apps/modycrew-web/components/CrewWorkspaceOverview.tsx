"use client";

import { useState, type ReactNode } from "react";
import CrewAvatar, { type CrewAvatarRole } from "./CrewAvatar";
import styles from "./CrewWorkspaceOverview.module.css";

type Crew = { id: string; name: string; roleTitle: string; brief: string; avatarId?: string; templateId?: string };
type Run = { phase: string; detail: string };
const roleFor = (crew: Crew): CrewAvatarRole => /메일|mail/u.test(crew.roleTitle) ? "mail" : /파일|폴더|정리/u.test(crew.roleTitle) ? "file" : /승인|검토/u.test(crew.roleTitle) ? "approval" : "doc";
function statusFor(run?: Run) {
  if (!run || run.phase === "idle") return "대기";
  return ({ checking: "요청 확인 중", connecting: "연결 확인 중", generating: "답변 작성 중", reading: "자료 확인 중", syncing: "업무 확인 중", running: "실행 중", error: "확인 필요" } as Record<string, string>)[run.phase] || "확인 중";
}

export function CrewSettingsDisclosure({ bypass, open, onToggle, children }: { bypass: boolean; open: boolean; onToggle: (open: boolean) => void; children: ReactNode }) {
  if (bypass) return <>{children}</>;
  return <details className={styles.advanced} open={open} onToggle={event => onToggle(event.currentTarget.open)}><summary>크루 추가·세부 설정·업무 기록</summary><div>{children}</div></details>;
}

export default function CrewWorkspaceOverview({ crews, activeId, runs, disabled, onMaster, onCreate, onChat, onConfigure }: {
  crews: Crew[]; activeId?: string; runs: Record<string, Run | undefined>; disabled?: boolean;
  onMaster: () => void; onCreate: () => void; onChat: (id: string) => void; onConfigure: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const selected = crews.find(crew => crew.id === selectedId) ?? crews.find(crew => crew.id === activeId) ?? crews[0];
  return <section className={styles.workspace} aria-label="크루 소개와 현재 업무">
    <header className={styles.header}><div><h2>함께 일하는 크루</h2><p>마스터크루에게 요청하면 필요한 담당자를 찾습니다.</p></div><button type="button" onClick={onCreate} disabled={disabled}>＋ 크루 추가</button></header>
    <button className={styles.master} type="button" onClick={onMaster} disabled={disabled}><strong>마스터크루에게 맡기기</strong><span>하고 싶은 일을 편하게 이야기하세요.</span></button>
    <div className={styles.roster} aria-label="크루 목록">
      {crews.map(crew => <button type="button" key={crew.id} className={styles.crew} aria-pressed={crew.id === selected?.id} onClick={() => setSelectedId(crew.id)} aria-label={`${crew.name} 역할 보기`}>
        <CrewAvatar role={roleFor(crew)} avatarId={crew.avatarId} size="compact" activity="idle" />
        <span><strong>{crew.name}</strong><small>{crew.roleTitle || "역할 미설정"}</small></span>
      </button>)}
    </div>
    {selected ? <article className={styles.profile} aria-label={`${selected.name} 소개`}>
      <div className={styles.hero}><CrewAvatar role={roleFor(selected)} avatarId={selected.avatarId} size="card" activity="idle" decorative={false} label={`${selected.name} 크루 모습`} /><div><h3>{selected.name}</h3><span>{selected.roleTitle || "역할을 설정해 주세요"}</span><p>{selected.brief || "아직 역할 설명이 없습니다. 크루 설정에서 맡길 일을 정할 수 있습니다."}</p></div></div>
      <div className={styles.current}><strong>현재 업무</strong><span>{statusFor(runs[selected.id])}</span>{runs[selected.id]?.phase !== "idle" && runs[selected.id]?.detail ? <p>{runs[selected.id]?.detail}</p> : <p>새 요청을 기다리고 있습니다.</p>}</div>
      <div className={styles.actions}><button type="button" disabled={disabled} onClick={() => onChat(selected.id)}>이 크루와 대화</button><button type="button" disabled={disabled} onClick={() => onConfigure(selected.id)}>이름·역할·모습 설정</button></div>
    </article> : <p className={styles.empty}>등록된 크루가 없습니다. 마스터크루에게 필요한 업무를 말하거나 크루를 추가하세요.</p>}
  </section>;
}
