'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createDesktopBridge } from '@/lib/desktop-bridge';
import { buildWorkMetrics, metricsCsv, metricLabels, workQueue, type MetricRecord } from '@/lib/work-metrics.mjs';
import styles from './WorkMetrics.module.css';
import TaskOverview from './TaskOverview';
import CompanyTaskOverview from './CompanyTaskOverview';

export function WorkMetrics() {
  const [scope,setScope]=useState<'personal'|'company'|'team'>('personal');
  const [days,setDays]=useState(30);
  const [dateBasis,setDateBasis]=useState<'created'|'completed'>('created');
  const dateLabel=dateBasis==='completed'?'완료':'등록';
  const [data,setData]=useState<{personal:MetricRecord[];company:MetricRecord[]}>({personal:[],company:[]});
  const [errors,setErrors]=useState({personal:'',company:''});
  const [busy,setBusy]=useState(true);
  const [loadedAt,setLoadedAt]=useState(0);
  const [company,setCompany]=useState('회사 운영');
  const [selectedDay,setSelectedDay]=useState('');
  const [selectedStatus,setSelectedStatus]=useState('');
  const [owner,setOwner]=useState('');
  const [selectedPriority,setSelectedPriority]=useState('');
  const [overdueOnly,setOverdueOnly]=useState(false);
  const [visibleRows,setVisibleRows]=useState<MetricRecord[]>([]);
  const [exporting,setExporting]=useState(false);
  const [exportNotice,setExportNotice]=useState('');
  const [warning,setWarning]=useState('');
  const [reminderCount,setReminderCount]=useState(0);
  const refresh=useCallback(async()=>{
    setBusy(true);const bridge=createDesktopBridge();
    if(!bridge.isAvailable){setErrors({personal:'설치 앱에서 실제 업무 기록을 확인해 주세요.',company:'설치 앱에서 실제 회사 운영 기록을 확인해 주세요.'});setBusy(false);return;}
    const [tasks,works,sessions,history]=await Promise.allSettled([bridge.listTasks(),bridge.companyAutomation({kind:'status'}),bridge.loadWorkSessionWorkspace(),bridge.loadChatThreads<{id:string;title:string;createdAt:number;taskId?:string}>()]);
    const personal=tasks.status==='fulfilled'&&tasks.value.status==='local_memory_tasks_loaded'&&Array.isArray(tasks.value.tasks)?tasks.value.tasks:null;
    setReminderCount((personal||[]).filter(task=>task.id.startsWith('inbox:schedule-briefing:')).length);
    const state=works.status==='fulfilled'?works.value.state:undefined;
    const workspace=sessions.status==='fulfilled'?sessions.value.workspace:undefined;
    const threads=history.status==='fulfilled'?history.value.threads:[];
    const activeSessions=workspace?.sessions.filter(item=>!item.archivedAt)||[];
    const ids=new Set(activeSessions.map(item=>item.threadId));
    const representedTasks=new Set(threads.filter(thread=>ids.has(thread.id)).map(thread=>thread.taskId).filter(Boolean));
    const sessionRows:MetricRecord[]=activeSessions.map(item=>{const thread=threads.find(thread=>thread.id===item.threadId);return {id:`session:${item.threadId}`,title:item.title||thread?.title||'업무 대화',status:item.status==='in_progress'?'doing':item.status==='waiting'?'review':item.status,createdAt:thread?.createdAt&&Number.isFinite(thread.createdAt)?new Date(thread.createdAt).toISOString():'',completedAt:item.completedAt?new Date(item.completedAt).toISOString():undefined,group:item.assigneeName||'나',priority:item.priority,dueDate:item.dueDate,href:`/?thread=${encodeURIComponent(item.threadId)}`};});
    setData({personal:[...sessionRows,...(personal||[]).filter(x=>!x.id.startsWith('inbox:schedule-briefing:')&&!representedTasks.has(x.id)&&!(x.origin?.kind==='chat'&&ids.has(x.origin.threadId||''))).map(x=>({id:x.id,title:x.title,status:x.status,createdAt:x.createdAt,completedAt:x.completedAt||x.execution?.lastCompletedAt,group:x.assigneeName||'담당 미지정',priority:x.priority,scheduledAt:x.execution?.dueAt}))],company:(state?.works||[]).map(x=>({id:x.id,title:x.request,status:x.status,createdAt:x.createdAt,completedAt:x.completedAt,group:[...new Set(x.tasks.map(t=>t.departmentName).filter(Boolean))].join(' · ')||'담당 미지정'}))});
    setWarning([!personal?'맡긴 자동화 업무를 불러오지 못했습니다.':'',!workspace?'업무 대화 정보를 불러오지 못했습니다.':'',history.status!=='fulfilled'?'대화의 등록 시각을 확인하지 못했습니다.':''].filter(Boolean).join(' '));
    setCompany(state?.companyName||'회사 운영');setErrors({personal:personal||workspace?'':'업무 기록을 읽지 못했습니다. 다시 불러와 주세요.',company:state?'':'회사 운영 기록을 읽지 못했습니다. 다시 불러와 주세요.'});setLoadedAt(Date.now());setBusy(false);
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  const localScope=scope==='personal'?'personal':'company';
  const owners=[...new Set(data[localScope].map(row=>row.group||'담당 미지정'))];
  const activeOwner=owners.includes(owner)?owner:'';
  const metrics=useMemo(()=>buildWorkMetrics(data[localScope].filter(row=>!activeOwner||(row.group||'담당 미지정')===activeOwner),{now:loadedAt||Date.now(),days,dateBasis}),[data,localScope,days,loadedAt,activeOwner,dateBasis]);
  const queue=useMemo(()=>workQueue(metrics.rows,loadedAt||Date.now()),[metrics.rows,loadedAt]);
  const priorityKey=(row:MetricRecord)=>typeof row.priority==='number'?'rank':row.priority||'unspecified';
  const priorities=[['urgent','긴급'],['high','중요'],['normal','보통'],['low','낮음'],['rank','순위 지정'],['unspecified','미지정']].map(([key,label])=>({key,label,count:queue.filter(row=>priorityKey(row)===key).length}));
  const listedRows=useMemo(()=>queue.filter(row=>(!selectedStatus||row.state===selectedStatus)&&(!selectedPriority||priorityKey(row)===selectedPriority)&&(!overdueOnly||row.overdue)&&(!selectedDay||`${new Date((dateBasis==='completed'?row.completedAt:row.createdAt)||'').getFullYear()}-${String(new Date((dateBasis==='completed'?row.completedAt:row.createdAt)||'').getMonth()+1).padStart(2,'0')}-${String(new Date((dateBasis==='completed'?row.completedAt:row.createdAt)||'').getDate()).padStart(2,'0')}`===selectedDay)),[queue,selectedStatus,selectedDay,selectedPriority,overdueOnly,dateBasis]);
  function clearSelection(){setSelectedDay('');setSelectedStatus('');setSelectedPriority('');setOverdueOnly(false);}
  useEffect(()=>{setSelectedDay('');setSelectedStatus('');setSelectedPriority('');setOverdueOnly(false);},[scope,days,activeOwner,dateBasis]);
  const maxDay=Math.max(1,...metrics.daily.map(day=>day.count));
  const scopeLabel=scope==='company'?`${company} · 이 PC의 회사 운영`:'이 PC의 내 업무';
  async function exportCsv(){
    setExporting(true);setExportNotice('');
    try {
      const csv=metricsCsv({...metrics,rows:visibleRows},scopeLabel);const fileName=`ModyCrew_업무현황_${scope}_${dateBasis}_${metrics.from}_${metrics.to}.csv`;
      const native=(window as Window & {modyCrewMetrics?:{saveCsv:(payload:{csv:string;fileName:string})=>Promise<{status:string;fileName?:string}>}}).modyCrewMetrics;
      if(native){const result=await native.saveCsv({csv,fileName});setExportNotice(result.status==='saved'?`${result.fileName} 저장 완료`:result.status==='canceled'?'저장을 취소했습니다.':'열려 있는 저장 창을 확인해 주세요.');return;}
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);setExportNotice('브라우저 다운로드에서 저장 결과를 확인해 주세요.');
    } catch { setExportNotice('보고서를 저장하지 못했습니다. 저장 위치와 파일 사용 여부를 확인한 뒤 다시 시도해 주세요.'); }
    finally {setExporting(false);}
  }
  return <section className={styles.page}>
    <header className={styles.heading}><div><h1>업무 현황</h1></div>{scope!=='team'&&<div className={styles.actions}><button disabled={busy} onClick={()=>void refresh()}>{busy?'불러오는 중…':'새로고침'}</button><button disabled={busy||exporting||Boolean(errors[localScope])||!visibleRows.length} onClick={()=>void exportCsv()}>{exporting?'저장 중…':'보고서용 CSV'}</button></div>}</header>
    {exportNotice&&<p role="status">{exportNotice}</p>}
    {scope==='personal'&&warning&&<p role="alert">{warning} 불러온 기록만 표시합니다.</p>}
    <div className={styles.filters}><label>기록 범위<select value={scope} onChange={e=>setScope(e.target.value as 'personal'|'company'|'team')}><option value="team">회사 직원 업무</option><option value="company">이 PC의 회사 자동화</option><option value="personal">내 업무</option></select></label>{scope!=='team'&&<><label>기간 기준<select aria-label="기간 기준" value={dateBasis} onChange={e=>setDateBasis(e.target.value as 'created'|'completed')}><option value="created">등록일 기준</option><option value="completed">완료일 기준</option></select></label><label>조회 기간<select value={days} onChange={e=>setDays(Number(e.target.value))}><option value={7}>최근 7일</option><option value={30}>최근 30일</option><option value={90}>최근 90일</option></select></label><label>담당자<select value={activeOwner} onChange={e=>setOwner(e.target.value)}><option value="">전체 담당자</option>{owners.map(name=><option key={name}>{name}</option>)}</select></label><p>{scopeLabel}<br/><small>{metrics.from} ~ {metrics.to}{loadedAt?` · ${new Date(loadedAt).toLocaleTimeString('ko-KR')} 기준`:''}</small></p></>}</div>
    {scope==='team'?<CompanyTaskOverview/>:errors[localScope]?<p role="alert" className={styles.empty}>{errors[localScope]}</p>:busy?<p role="status">실제 업무 기록을 불러오고 있습니다.</p>:<>
      <div className={styles.cards}>{[{label:dateLabel+' 업무',count:metrics.total,select:()=>clearSelection()},{label:'진행 중',count:metrics.counts.doing,select:()=>{clearSelection();setSelectedStatus('doing');}},{label:'검토 대기',count:metrics.counts.review,select:()=>{clearSelection();setSelectedStatus('review');}},{label:'기한 지남',count:queue.filter(row=>row.overdue).length,select:()=>{clearSelection();setOverdueOnly(true);}}].map(({label,count,select})=><article key={label}><button type="button" style={{border:0,padding:0,textAlign:'left',width:'100%'}} onClick={select}><span>{label}</span><strong>{count}건</strong></button></article>)}</div>
      {!metrics.total&&<div className={styles.empty}><h2>선택한 기간에 {dateLabel}된 업무가 없습니다</h2><p>업무를 시작하면 실제 기록을 차트로 보여드립니다.</p><Link href={scope==='company'?'/automation':'/office'}>{scope==='company'?'회사 운영에서 업무 시작':'오피스에서 업무 맡기기'} →</Link></div>}
      <section aria-label="차트에서 선택한 업무 목록">{(selectedDay||selectedStatus||selectedPriority||overdueOnly)&&<p role="status">{[selectedDay,metricLabels[selectedStatus],priorities.find(item=>item.key===selectedPriority)?.label,overdueOnly?'기한 지남':''].filter(Boolean).join(' · ')} · {listedRows.length}건 <button type="button" onClick={clearSelection}>전체 업무 보기</button></p>}<TaskOverview key={`${scope}:${dateBasis}:${selectedDay}:${selectedStatus}:${activeOwner}:${selectedPriority}:${overdueOnly}`} records={listedRows} onVisibleRowsChange={setVisibleRows}/></section>
      <details className={styles.analysis} data-work-analysis><summary>차트와 상세 분석</summary>
      <div className={styles.charts}><article className={styles.panel}><h2>업무 상태</h2><p>선택 기간에 {dateLabel}된 업무의 현재 상태</p><div className={styles.bars}>{Object.entries(metricLabels).filter(([key])=>key!=='unknown'||metrics.counts.unknown>0).map(([key,label])=><button type="button" className={styles.barRow} key={key} aria-pressed={selectedStatus===key} onClick={()=>{setSelectedStatus(selectedStatus===key?'':key);setSelectedDay('');}}><span>{label}</span><div className={styles.track}><span data-status={key} style={{width:`${metrics.total?metrics.counts[key]/metrics.total*100:0}%`}} /></div><strong>{metrics.counts[key]}건</strong></button>)}</div></article>
      <article className={styles.panel}><h2>날짜별 업무 {dateLabel}</h2><p>막대를 누르면 그날 {dateLabel}한 업무만 아래에 표시합니다.</p><div className={styles.daily} role="img" aria-label={`최근 ${days}일 업무 ${dateLabel} ${metrics.total}건. 아래 표에서 날짜별 건수를 확인할 수 있습니다.`}>{metrics.daily.map(day=><button type="button" key={day.date} title={`${day.date} ${dateLabel} ${day.count}건`} aria-label={`${day.date} ${dateLabel} ${day.count}건`} style={{height:`${Math.max(2,day.count/maxDay*100)}%`}} aria-pressed={selectedDay===day.date} onClick={()=>{setSelectedDay(selectedDay===day.date?'':day.date);setSelectedStatus('');}} />)}</div><div className={styles.axis}><span>{metrics.from}</span><span>{metrics.to}</span></div><output aria-live="polite">{selectedDay}</output><details><summary>날짜별 수치 표</summary><div className={styles.tableWrap}><table><thead><tr><th>{dateLabel}일</th><th>{dateLabel} 업무</th></tr></thead><tbody>{metrics.daily.map(day=><tr key={day.date}><td>{day.date}</td><td>{day.count}건</td></tr>)}</tbody></table></div></details></article></div>
      <div className={styles.charts}><article className={styles.panel}><h2>우선순위 분포</h2><p>항목을 선택하면 해당 업무만 표시합니다.</p><div className={styles.bars}>{priorities.map(({key,label,count})=><button type="button" key={key} className={styles.barRow} aria-pressed={selectedPriority===key} onClick={()=>{clearSelection();setSelectedPriority(selectedPriority===key?'':key);}}><span>{label}</span><div className={styles.track}><span style={{width:`${metrics.total?count/metrics.total*100:0}%`}}/></div><strong>{count}건</strong></button>)}</div></article>
      <article className={styles.panel}><h2>{scope==='company'?'담당 부서 조합별':'담당별'} 업무</h2><p>공동 담당 업무는 해당 조합에 한 번만 집계합니다.</p><div className={styles.tableWrap}><table><thead><tr><th>담당</th><th>{dateLabel} 업무</th><th>완료</th><th>확인 필요</th></tr></thead><tbody>{metrics.groups.map(group=><tr key={group.name}><td><button type="button" aria-pressed={activeOwner===group.name} onClick={()=>setOwner(activeOwner===group.name?'':group.name)}>{group.name}</button></td><td>{group.total}건</td><td>{group.done}건</td><td>{group.blocked}건</td></tr>)}</tbody></table></div></article></div>
<p className={styles.note}>{scope==='personal'&&reminderCount>0?`일정·마감 알림 ${reminderCount}건은 별도 안내이므로 업무 건수에서 제외했습니다. `:''}{dateBasis==='created'?`완료 비율 ${metrics.completionRate===null?'—':metrics.completionRate+'%'} = 현재 완료된 업무 ÷ 선택 기간에 등록된 업무.`:'완료 처리한 시각을 기준으로 집계합니다. 다시 진행 중인 업무는 제외합니다.'} 회사 전체 구성원의 실적·매출·절감 시간을 뜻하지 않습니다. {metrics.undated>0?`${dateLabel}일을 확인할 수 없는 ${metrics.undated}건은 기간 집계에서 제외했습니다.`:''} {dateBasis==='created'&&metrics.completionUndated>0?`과거 완료 업무 ${metrics.completionUndated}건은 완료일 기록이 없어 완료일 기준 집계에 포함되지 않습니다.`:''}</p>
      </details>
    </>}
  </section>;
}
