'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ModyAuthSession } from '@/lib/firebase-client';
import type { CompanyMember, CompanyTask, CompanyTeam } from '@/lib/company-types';
import { subscribeCompanyTasks, taskStatusLabels } from '@/lib/company-collaboration';
import { localDateKey, summarizeTasks, upcomingTasks } from '@/lib/company-agenda';
import styles from './CompanyHome.module.css';

const TEAM_LIMIT = 12;
type TeamTasks = Record<string, { tasks: CompanyTask[]; error: string }>;
type Props = {
  session: ModyAuthSession; companyId: string; companyName: string; teams: CompanyTeam[]; members: CompanyMember[]; isAdmin: boolean;
  online: boolean; hostLabel: string;
  onOpenConversation: (teamId: string) => void; onAssignTask: (teamId: string) => void; onOpenAgenda: (teamId: string) => void;
  onShareFile: (teamId: string) => void; onNewConversation: () => void; onOpenMembers: () => void;
};

/**
 * One screen with the company's real saved work: task deadlines across the member's
 * conversations, the conversations themselves and the AI host. Figures come from stored
 * rows only; nothing here is an estimate or sample.
 */
export default function CompanyHome({ session, companyId, companyName, teams, members, isAdmin, online, hostLabel, onOpenConversation, onAssignTask, onOpenAgenda, onShareFile, onNewConversation, onOpenMembers }: Props) {
  const [byTeam, setByTeam] = useState<TeamTasks>({});
  const [retry, setRetry] = useState(0);
  const watched = teams.slice(0, TEAM_LIMIT);
  const watchedKey = watched.map(team => team.id).join('|');
  useEffect(() => {
    let alive = true;
    const stops: Array<() => void> = [];
    setByTeam({});
    for (const team of watched) {
      const failed = () => { if (alive) setByTeam(current => ({ ...current, [team.id]: { tasks: [], error: '불러오지 못함' } })); };
      void subscribeCompanyTasks(session, companyId, team.id, rows => {
        if (alive) setByTeam(current => ({ ...current, [team.id]: { tasks: rows, error: '' } }));
      }, failed).then(stop => { if (alive) stops.push(stop); else stop(); }).catch(failed);
    }
    return () => { alive = false; stops.forEach(stop => stop()); };
  // watchedKey stands in for the team list identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, companyId, watchedKey, retry]);
  const today = localDateKey(new Date());
  const loadedTeams = watched.filter(team => byTeam[team.id]);
  const failedTeams = watched.filter(team => byTeam[team.id]?.error);
  const allTasks = loadedTeams.flatMap(team => (byTeam[team.id]?.tasks || []).map(task => ({ ...task, teamId: team.id, teamName: team.name })));
  const summary = summarizeTasks(allTasks, session.uid, today);
  const upcoming = upcomingTasks(allTasks, 6) as Array<CompanyTask & { teamId: string; teamName: string }>;
  const loading = watched.length > 0 && loadedTeams.length < watched.length;
  const general = teams.find(team => team.id === 'general') || teams[0];
  const teamFor = (task: CompanyTask & { teamId: string }) => task.teamId;
  return <section className={styles.homeRoot} aria-label="회사 홈">
    <header className={styles.homeHead}><div className={styles.homeTitle}><p className={styles.homeEyebrow}>{companyName}</p><h2>오늘의 회사 업무</h2><p className={styles.homeMeta}>{today} · 구성원 {members.length}명 · 대화방 {teams.length}개</p></div>
      <div className={styles.homeQuick} aria-label="빠른 실행">
        <button type="button" onClick={onNewConversation}>새 대화</button>
        {general && <button type="button" className={styles.homePrimary} onClick={() => onAssignTask(general.id)}>업무 지시</button>}
        {general && <button type="button" onClick={() => onShareFile(general.id)}>파일 공유</button>}
        {general && <button type="button" onClick={() => onOpenAgenda(general.id)}>일정 보기</button>}
      </div>
    </header>

    <section className={styles.homeMetrics} aria-label="업무 현황">
      <div><span>진행 중</span><strong>{summary.active}</strong></div>
      <div><span>오늘 기한</span><strong>{summary.dueToday}</strong></div>
      <div data-alert={summary.overdue > 0}><span>기한 지남</span><strong>{summary.overdue}</strong></div>
      <div><span>내가 맡은 일</span><strong>{summary.mine}</strong></div>
      <div><span>내 검토 대기</span><strong>{summary.awaitingReview}</strong></div>
      <div><span>완료</span><strong>{summary.done}</strong></div>
    </section>
    {loading && <p role="status" className={styles.homeMuted}>대화방 {watched.length}개의 업무를 불러오는 중…</p>}
    {failedTeams.length > 0 && <p role="alert" className={styles.homeAlert}>{failedTeams.map(team => team.name).join(', ')} 대화방의 업무를 불러오지 못했습니다. 현황 숫자에 포함되지 않았습니다. <button type="button" className={styles.homeLink} onClick={() => setRetry(value => value + 1)}>다시 불러오기</button></p>}
    {teams.length > TEAM_LIMIT && <p className={styles.homeMuted}>대화방 {TEAM_LIMIT}개까지만 집계합니다. 나머지는 각 대화방의 업무에서 확인하세요.</p>}

    <div className={styles.homeColumns}>
      <section className={styles.homeCard} aria-label="다가오는 업무">
        <h3>다가오는 업무</h3>
        {!loading && !upcoming.length && <p className={styles.homeMuted}>진행 중인 업무가 없습니다. 대화에서 ‘업무로 지시’를 누르거나 업무 지시에서 등록하세요.</p>}
        <ul className={styles.homeTasks}>{upcoming.map(task => <li key={task.teamId + ':' + task.id} data-overdue={Boolean(task.dueDate && task.dueDate < today)}>
          <span className={styles.homeStatus} data-status={task.status}>{taskStatusLabels[task.status]}</span>
          <div><strong>{task.title}</strong><small>{task.teamName} · {task.assigneeName || '담당자 확인 필요'}{task.dueDate ? ' · 기한 ' + task.dueDate : ' · 기한 미지정'}{task.priority === 'high' ? ' · 중요' : ''}</small></div>
          <button type="button" onClick={() => onAssignTask(teamFor(task))} aria-label={task.title + ' 업무 열기'}>열기</button>
        </li>)}</ul>
      </section>
      <section className={styles.homeCard} aria-label="대화방">
        <h3>대화방</h3>
        <ul className={styles.homeRooms}>{teams.map(team => { const count = byTeam[team.id]?.tasks.filter(task => task.status !== 'done' && task.status !== 'canceled').length; return <li key={team.id}>
          <button type="button" className={styles.homeRoom} onClick={() => onOpenConversation(team.id)}><span aria-hidden="true">{team.kind === 'direct' ? '○' : '#'}</span><span>{team.name}</span><small>{team.kind === 'direct' ? '개인 대화' : team.visibility === 'company' ? '회사 전체' : '지정 ' + team.memberIds.length + '명'}{count ? ' · 업무 ' + count : ''}</small></button>
        </li>; })}</ul>
        <button type="button" className={styles.homeLink} onClick={onOpenMembers}>구성원과 팀 관리{isAdmin ? ' · 직원 초대' : ''}</button>
      </section>
    </div>

    <section className={styles.homeCard + ' ' + styles.homeSystem} aria-label="회사 시스템 상태">
      <h3>회사 시스템</h3>
      <dl>
        <div><dt>회사 AI</dt><dd>{hostLabel ? <span className={styles.homeHost} data-online={online}>{hostLabel + ' · ' + (online ? '온라인' : '오프라인')}</span> : '메인 PC 미지정'}</dd></div>
        <div><dt>업무 인수인계</dt><dd><Link href="/automation?tab=handover">회사 업무 방식과 진행 중인 일 정리 열기</Link></dd></div>
        <div><dt>외부 캘린더</dt><dd>Google 캘린더 자동 동기화는 아직 연결되지 않았습니다. 이 화면의 기한은 등록한 업무 기준입니다.</dd></div>
        <div><dt>회사 드라이브</dt><dd>공유 파일은 회사 저장소에 올라갑니다. Google 드라이브 폴더 권한 연동은 아직 제공되지 않습니다.</dd></div>
      </dl>
    </section>
  </section>;
}
