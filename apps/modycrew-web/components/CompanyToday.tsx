'use client';

import { useEffect, useState } from 'react';
import type { ModyAuthSession } from '@/lib/firebase-client';
import type { CompanyTask, CompanyTeam } from '@/lib/company-types';
import { subscribeCompanyTasks, taskStatusLabels } from '@/lib/company-collaboration';
import styles from './CompanyToday.module.css';

const dateKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const isActive = (task: CompanyTask) => !['done', 'canceled'].includes(task.status);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && dateKey(new Date(`${value}T12:00:00`)) === value;

/** Shows persisted task deadlines only. It does not create external calendar events. */
export default function CompanyToday({ session, companyId, team, onManage }: {
  session: ModyAuthSession; companyId: string; team: CompanyTeam; onManage: () => void;
}) {
  const [tasks, setTasks] = useState<CompanyTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12));
  const [selected, setSelected] = useState(() => dateKey(new Date()));
  const [mine, setMine] = useState(false);
  const today = dateKey(new Date());
  useEffect(() => {
    let alive = true;
    let stop: (() => void) | undefined;
    setTasks([]); setLoaded(false); setError('');
    const failed = () => { if (alive) { setTasks([]); setLoaded(false); setError('업무 일정을 불러오지 못했습니다. 연결과 대화방 접근 권한을 확인해 주세요.'); } };
    void subscribeCompanyTasks(session, companyId, team.id, rows => {
      if (alive) { setTasks(rows); setLoaded(true); setError(''); }
    }, failed).then(unsubscribe => { if (alive) stop = unsubscribe; else unsubscribe(); }).catch(failed);
    return () => { alive = false; stop?.(); };
  }, [session, companyId, team.id, retry]);
  const visible = tasks.filter(task => task.status !== 'canceled' && (!mine || task.assigneeUid === session.uid));
  const active = visible.filter(isActive);
  const dated = visible.filter(task => validDate(task.dueDate));
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const start = first.getDate() - first.getDay();
  const days = Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), start + index, 12));
  const selectedTasks = dated.filter(task => task.dueDate === selected);
  function changeMonth(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1, 12);
    setMonth(next); setSelected(dateKey(next));
  }
  return <section className={styles.agenda} aria-label="회사 업무 일정">
    <header className={styles.agendaHead}><div className={styles.agendaTitle}><h2>업무 일정</h2><p>{team.name}에 등록한 업무의 기한입니다.</p></div><button type="button" onClick={onManage}>업무 등록·관리</button></header>
    <div className={styles.agendaFilters} role="group" aria-label="일정 범위"><button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>대화방 전체</button><button type="button" aria-pressed={mine} onClick={() => setMine(true)}>내 담당 업무</button></div>
    {error ? <div role="alert" className={styles.agendaError}><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>다시 불러오기</button></div> : !loaded ? <p role="status" className={styles.agendaEmpty}>업무 일정을 불러오는 중…</p> : <>
      <div className={styles.agendaMetrics}>
        <div><span>진행할 업무</span><strong>{active.length}</strong></div>
        <div><span>오늘 기한</span><strong>{active.filter(task => task.dueDate === today).length}</strong></div>
        <div data-alert={active.some(task => validDate(task.dueDate) && task.dueDate < today)}><span>기한 지남</span><strong>{active.filter(task => validDate(task.dueDate) && task.dueDate < today).length}</strong></div>
        <div><span>기한 미지정·확인 필요</span><strong>{active.filter(task => !validDate(task.dueDate)).length}</strong></div>
      </div>
      <div className={styles.agendaCard}>
        <div className={styles.agendaCalendarHead}><h3>{month.getFullYear()}년 {month.getMonth() + 1}월</h3><div><button type="button" aria-label="이전 달" onClick={() => changeMonth(-1)}>‹</button><button type="button" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1, 12)); setSelected(dateKey(now)); }}>오늘</button><button type="button" aria-label="다음 달" onClick={() => changeMonth(1)}>›</button></div></div>
        <div className={styles.agendaWeekdays} aria-hidden="true">{['일','월','화','수','목','금','토'].map(day => <span key={day}>{day}</span>)}</div>
        <div className={styles.agendaCalendar} aria-label="업무 기한 달력">
          {days.map(day => { const key = dateKey(day); const rows = dated.filter(task => task.dueDate === key); return <button type="button" key={key} aria-label={key + ' 업무 ' + rows.length + '건'} aria-pressed={selected === key} data-outside={day.getMonth() !== month.getMonth()} data-today={key === today} onClick={() => setSelected(key)}><time dateTime={key}>{day.getDate()}</time>{rows.length > 0 && <><span className={styles.agendaCount}>{rows.length}건</span><span className={styles.agendaPreview}>{rows[0].title}</span></>}</button>; })}
        </div>
      </div>
      <div className={styles.agendaDayHead}><h3>{selected} 업무</h3><small>{selectedTasks.length}건</small></div>
      {selectedTasks.length ? <ul className={styles.agendaList}>{selectedTasks.map(task => <li key={task.id}><span className={styles.agendaStatus} data-status={task.status}>{taskStatusLabels[task.status]}</span><div><strong>{task.title}</strong><small>{task.assigneeName || '담당자 확인 필요'}{task.priority === 'high' ? ' · 중요' : ''}</small></div><button type="button" onClick={onManage} aria-label={task.title + ' 업무에서 관리'}>업무에서 관리</button></li>)}</ul> : <p className={styles.agendaEmpty}>이 날짜에 등록된 업무 기한이 없습니다.</p>}
      {tasks.length >= 200 && <p className={styles.agendaNote}>최근 갱신된 업무 최대 200건 기준입니다. 이전 업무는 포함되지 않을 수 있습니다.</p>}
    </>}
    <details className={styles.agendaNote}><summary>일정에 표시되는 내용</summary><p>대화에서 업무로 등록하고 기한을 정하면 이 달력에 표시됩니다. 회의·약속 및 Google 캘린더 일정과의 자동 동기화는 아직 연결되지 않았습니다.</p></details>
  </section>;
}
