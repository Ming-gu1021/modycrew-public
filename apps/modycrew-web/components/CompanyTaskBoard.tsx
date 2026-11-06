'use client';

import { useEffect, useRef, useState } from 'react';
import type { ModyAuthSession } from '@/lib/firebase-client';
import type { CompanyMember, CompanyTeam, CompanyTask, CompanyTaskEvent, CompanyTaskStatus } from '@/lib/company-types';
import { createCompanyTask, subscribeCompanyTasks, subscribeTaskEvents, taskStatusLabels, updateCompanyTask } from '@/lib/company-collaboration';
import styles from './CompanyCollaboration.module.css';

const stamp=(ms:number)=>new Date(ms).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const fail=(e:unknown)=>e instanceof Error?e.message:'업무를 처리하지 못했습니다.';
type Props={session:ModyAuthSession;companyId:string;team:CompanyTeam;members:CompanyMember[];isAdmin:boolean;seed?:string;seedDueDate?:string};

function TaskCard({task,session,companyId,teamId,isAdmin}:{task:CompanyTask;session:ModyAuthSession;companyId:string;teamId:string;isAdmin:boolean}){
  const [open,setOpen]=useState(false); const [events,setEvents]=useState<CompanyTaskEvent[]>([]); const [result,setResult]=useState(task.resultText);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const pending=useRef(false);
  const assigned=task.assigneeUid===session.uid;const manages=isAdmin||task.creatorUid===session.uid;
  const active=['todo','doing','review'].includes(task.status);
  useEffect(()=>{setResult(task.resultText);},[task.resultText]);
  useEffect(()=>{if(!open)return;let alive=true;let stop:(()=>void)|undefined;
    void subscribeTaskEvents(session,companyId,teamId,task.id,rows=>{if(alive)setEvents(rows);},e=>{if(alive)setError(fail(e));}).then(s=>{if(alive)stop=s;else s();}).catch(e=>{if(alive)setError(fail(e));});
    return()=>{alive=false;stop?.();};
  },[open,session,companyId,teamId,task.id]);
  async function update(status:CompanyTaskStatus){if(pending.current)return;pending.current=true;setBusy(true);setError('');
    try{await updateCompanyTask(session,companyId,teamId,task.id,{status,resultText:result});}catch(e){setError(fail(e));}finally{pending.current=false;setBusy(false);}
  }
  const overdue=Boolean(task.dueDate&&active&&task.dueDate<new Date().toLocaleDateString('sv-SE'));
  return <details className={styles.taskCard} open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary><span className={styles.taskBadge} data-status={task.status}>{taskStatusLabels[task.status]}</span><strong>{task.title}</strong><small>{task.assigneeName}{task.priority==='high'?' · 중요':''}</small><small className={overdue?styles.taskOverdue:undefined}>{task.dueDate?task.dueDate+(overdue?' · 기한 지남':''):'기한 미지정'}</small></summary>
    {open&&<div className={styles.taskDetail}>
      <p className={styles.hint}>지시자 {task.creatorName} · {stamp(task.createdAtEpochMs)}</p><p className={styles.taskDesc}>{task.description||'별도 설명 없음'}</p>
      {(assigned&&active)||(manages&&['review','done','canceled'].includes(task.status))?<label>진행 내용·결과 보고<textarea rows={3} maxLength={6000} value={result} onChange={e=>setResult(e.target.value)} placeholder="처리한 내용, 결과 파일 또는 자료 위치를 적어 주세요."/></label>:task.resultText&&<p className={styles.taskDesc}>{task.resultText}</p>}
      {error&&<p className={styles.notice} role="alert">{error}</p>}
      <div className={styles.actions}>
        {assigned&&active&&<><button disabled={busy} onClick={()=>void update('doing')}>{task.status==='doing'?'진행 내용 저장':'진행 시작'}</button><button className={styles.primary} disabled={busy||!result.trim()} onClick={()=>void update('review')}>결과 보고 · 검토 요청</button></>}
        {manages&&task.status==='review'&&<button className={styles.primary} disabled={busy} onClick={()=>void update('done')}>검토 후 완료 확인</button>}
        {manages&&['review','done','canceled'].includes(task.status)&&<button disabled={busy} onClick={()=>void update('todo')}>다시 요청</button>}
        {manages&&active&&<button disabled={busy} onClick={()=>void update('canceled')}>업무 취소</button>}
      </div>
      <h4>업무 기록</h4><ol className={styles.taskLog}>{events.map(e=><li key={e.id}><strong>{e.authorName} · {taskStatusLabels[e.status]}</strong><p>{e.note}</p><time>{stamp(e.createdAtEpochMs)}</time></li>)}</ol>
    </div>}
  </details>;
}

export default function CompanyTaskBoard({session,companyId,team,members,isAdmin,seed='',seedDueDate=''}:Props){
  const [tasks,setTasks]=useState<CompanyTask[]>([]);const [loaded,setLoaded]=useState(false);const [filter,setFilter]=useState<'all'|'mine'|CompanyTaskStatus>('all');
  const [form,setForm]=useState(Boolean(seed));const [title,setTitle]=useState(seed.slice(0,160));const [description,setDescription]=useState(seed);
  const [assignee,setAssignee]=useState(session.uid);const [dueDate,setDueDate]=useState(seedDueDate);const [priority,setPriority]=useState<'normal'|'high'>('normal');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');const pending=useRef(false);
  const eligible=members.filter(m=>m.status==='active'&&(team.visibility==='company'||team.memberIds.includes(m.uid)));
  useEffect(()=>{let alive=true;let stop:(()=>void)|undefined;
    void subscribeCompanyTasks(session,companyId,team.id,rows=>{if(alive){setTasks(rows);setLoaded(true);}},e=>{if(alive){setTasks([]);setError(fail(e));}}).then(s=>{if(alive)stop=s;else s();}).catch(e=>{if(alive)setError(fail(e));});
    return()=>{alive=false;stop?.();};
  },[session,companyId,team.id]);
  const shown=tasks.filter(t=>filter==='all'||(filter==='mine'?t.assigneeUid===session.uid:t.status===filter));
  return <section className={styles.section} aria-label="회사 업무 지시">
    <div className={styles.header}><div><h3>{team.name} · 업무</h3><p>담당자에게 요청하고, 결과를 검토해 완료합니다.</p></div><button className={styles.primary} aria-expanded={form} onClick={()=>setForm(!form)}>{form?'작성 접기':'+ 업무 지시'}</button></div>
    {/* 목록 거르기: 회색 트랙 위 흰 알약(세그먼트) + 개수 */}
    <div className={styles.taskFilter} aria-label="업무 현황"><button aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>전체 <span className={styles.segmentCount}>{tasks.length}</span></button><button aria-pressed={filter==='mine'} onClick={()=>setFilter('mine')}>내가 맡은 일 <span className={styles.segmentCount}>{tasks.filter(t=>t.assigneeUid===session.uid).length}</span></button>{(['todo','doing','review','done'] as const).map(s=><button key={s} aria-pressed={filter===s} onClick={()=>setFilter(s)}>{taskStatusLabels[s]} <span className={styles.segmentCount}>{tasks.filter(t=>t.status===s).length}</span></button>)}</div>
    {tasks.length>=200&&<p className={styles.hint}>최근 갱신한 업무 200개 기준입니다.</p>}
    {error&&<p className={styles.notice} role="alert">{error}</p>}{notice&&<p className={styles.notice} role="status">{notice}</p>}
    {form&&<form className={styles.form} onSubmit={async e=>{e.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');setNotice('');
      try{await createCompanyTask(session,companyId,team.id,{title,description,assigneeUid:assignee,dueDate,priority});setTitle('');setDescription('');setForm(false);setFilter('all');setNotice('업무를 등록했습니다. 담당자는 이 대화방의 업무에서 진행 내용을 보고할 수 있습니다.');}
      catch(error){setError(fail(error));}finally{pending.current=false;setBusy(false);}
    }}><label>업무 제목<input autoFocus value={title} onChange={e=>setTitle(e.target.value)} maxLength={160} required placeholder="예: 이번 주 매출 자료 정리"/></label><label>요청 내용<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={6000} rows={3}/></label>
      <div className={styles.fieldRow}><label>담당자<select value={assignee} onChange={e=>setAssignee(e.target.value)} required>{eligible.map(m=><option key={m.uid} value={m.uid}>{m.displayName}{m.uid===session.uid?' (나)':''}</option>)}</select></label><label>완료 기한<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label><label>우선순위<select value={priority} onChange={e=>setPriority(e.target.value as 'normal'|'high')}><option value="normal">보통</option><option value="high">중요</option></select></label></div>
      {seedDueDate&&dueDate===seedDueDate&&<p className={styles.hint} role="status">대화 내용에서 기한 {seedDueDate}을(를) 읽어 미리 채웠습니다. 등록 전에 확인해 주세요.</p>}
      <div className={styles.actions}><button className={styles.primary} disabled={busy||!title.trim()||!eligible.some(m=>m.uid===assignee)}>{busy?'등록 중…':'업무 지시 등록'}</button><button type="button" disabled={busy} onClick={()=>setForm(false)}>취소</button></div>
    </form>}
    <div className={styles.taskList}>{shown.map(task=><TaskCard key={task.id} task={task} session={session} companyId={companyId} teamId={team.id} isAdmin={isAdmin}/>)}</div>
    {!loaded&&!error&&<p className={styles.hint} role="status">업무를 불러오는 중…</p>}{loaded&&!shown.length&&<p className={styles.taskEmpty}>해당하는 업무가 없습니다. 대화 내용에서도 ‘업무로 지시’를 눌러 등록할 수 있습니다.</p>}
  </section>;
}
