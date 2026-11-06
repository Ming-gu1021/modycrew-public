'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTeamShareMemberships } from './ShareToTeamButton';
import { subscribeCompanyTeams } from '@/lib/company-client';
import { subscribeCompanyTasks } from '@/lib/company-collaboration';
import type { CompanyTeam } from '@/lib/company-types';
import type { MetricRecord } from '@/lib/work-metrics.mjs';
import TaskOverview from './TaskOverview';
import styles from './WorkMetrics.module.css';

export default function CompanyTaskOverview() {
  const {session,memberships,loaded}=useTeamShareMemberships();
  const [selection,setSelection]=useState(''); const [teamFilter,setTeamFilter]=useState('');
  const company=memberships.find(m=>m.companyId===selection)||memberships[0];
  const companyId=company?.companyId||'';
  const scope=`${session?.uid||''}:${companyId}`;
  const [result,setResult]=useState<{scope:string;teams:CompanyTeam[];rows:MetricRecord[];pending:boolean;error:string}>({scope:'',teams:[],rows:[],pending:true,error:''});
  useEffect(()=>{
    let alive=true; let stopTeams:(()=>void)|undefined;let taskStops:(()=>void)[]=[];let version=0;
    const clear=()=>{taskStops.forEach(stop=>stop());taskStops=[];};
    setResult({scope,teams:[],rows:[],pending:Boolean(session&&companyId),error:''});
    if(session&&companyId)void subscribeCompanyTeams(session,companyId,teams=>{
      if(!alive)return; const tick=++version;clear();
      const visible=teams.filter(t=>t.visibility==='company'||t.memberIds.includes(session.uid));
      const rows=new Map<string,MetricRecord[]>();const waiting=new Set(visible.map(t=>t.id));const failures=new Set<string>();
      const publish=()=>{if(alive&&version===tick)setResult({scope,teams:visible,rows:[...rows.values()].flat(),pending:waiting.size>0,error:failures.size?`${failures.size}개 대화방의 업무를 읽지 못했습니다. 표시된 기록은 불러온 대화방 기준입니다.`:''});};
      publish();
      for(const team of visible){const fail=()=>{if(!alive||version!==tick)return;waiting.delete(team.id);failures.add(team.id);rows.delete(team.id);publish();};
        void subscribeCompanyTasks(session,companyId,team.id,tasks=>{if(!alive||version!==tick)return;waiting.delete(team.id);failures.delete(team.id);rows.set(team.id,tasks.map(task=>({id:`${team.id}:${task.id}`,title:task.title,status:task.status,createdAt:new Date(task.createdAtEpochMs).toISOString(),group:task.assigneeName||'담당 미지정',priority:task.priority,dueDate:task.dueDate,href:`/company/?company=${encodeURIComponent(companyId)}&team=${encodeURIComponent(team.id)}&tab=tasks`})));publish();},fail).then(stop=>{if(alive&&version===tick)taskStops.push(stop);else stop();}).catch(fail);
      }
    },()=>{if(!alive)return;version++;clear();setResult({scope,teams:[],rows:[],pending:false,error:'회사 업무에 접근하지 못했습니다. 소속과 대화방 참여 상태를 확인해 주세요.'});}).then(stop=>{if(alive)stopTeams=stop;else stop();}).catch(()=>{if(alive)setResult({scope,teams:[],rows:[],pending:false,error:'회사 업무 연결을 확인해 주세요.'});});
    return()=>{alive=false;version++;stopTeams?.();clear();};
  },[session,companyId,scope]);
  if(!loaded)return <p role="status">회사 소속을 확인하고 있습니다.</p>;
  if(!session||!company)return <div className={styles.empty}><h2>연결된 회사가 없습니다</h2><p>회사를 연결하면 참여한 대화방의 실제 업무를 함께 볼 수 있습니다.</p><Link href="/company">우리 회사 연결하기 →</Link></div>;
  const current=result.scope===scope?result:undefined;
  const selectedTeam=current?.teams.some(t=>t.id===teamFilter)?teamFilter:'';
  const rows=(current?.rows||[]).filter(r=>!selectedTeam||r.id.startsWith(`${selectedTeam}:`));
  return <>
    <div className={styles.filters}><label>회사<select value={companyId} onChange={e=>{setSelection(e.target.value);setTeamFilter('');}}>{memberships.map(m=><option key={m.companyId} value={m.companyId}>{m.companyName}</option>)}</select></label><label>대화방<select value={selectedTeam} onChange={e=>setTeamFilter(e.target.value)}><option value="">참여한 대화방 전체</option>{current?.teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>
    <p className={styles.note}>회사에 실제 등록한 업무 · 접근 가능한 대화방마다 최근 갱신한 200건 · 변경 시 자동 반영</p>
    {current?.error&&<p role="alert" className={styles.empty}>{current.error}</p>}
    {!current||current.pending?<p role="status">회사 업무를 불러오고 있습니다.</p>:<TaskOverview key={scope} records={rows} charts/>}
  </>;
}
