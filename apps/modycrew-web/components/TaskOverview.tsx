'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { metricLabels, priorityLabel, workQueue, type MetricRecord } from '@/lib/work-metrics.mjs';
import styles from './TaskOverview.module.css';

export default function TaskOverview({records, charts=false, onVisibleRowsChange}: {records: MetricRecord[]; charts?: boolean; onVisibleRowsChange?: (rows: MetricRecord[]) => void}) {
  const [owner,setOwner]=useState(''); const [status,setStatus]=useState(''); const [query,setQuery]=useState('');
  const rows=useMemo(()=>workQueue(records),[records]);
  const owners=[...new Set(rows.map(r=>r.group||'담당 미지정'))];
  const activeOwner=owners.includes(owner)?owner:'';
  const shown=useMemo(()=>rows.filter(r=>(!activeOwner||(r.group||'담당 미지정')===activeOwner)&&(!status||r.state===status)&&(!query||`${r.title} ${r.group||''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))),[rows,activeOwner,status,query]);
  useEffect(()=>{onVisibleRowsChange?.(shown);},[shown,onVisibleRowsChange]);
  const counts=Object.keys(metricLabels).map(key=>({key,label:metricLabels[key],count:rows.filter(r=>r.state===key).length})).filter(r=>r.count>0);
  return <section className={styles.root} aria-label="실제 업무 목록과 담당 현황">
    {charts&&<div className={styles.charts}>
      <article><h3>업무 상태</h3><p>등록 {rows.length}건 · 기한 지남 {rows.filter(r=>r.overdue).length}건 · 중요 {rows.filter(r=>r.priority==='high'&&!['done','canceled'].includes(r.state)).length}건</p>{counts.map(r=><button key={r.key} className={styles.bar} aria-pressed={status===r.key} onClick={()=>setStatus(status===r.key?'':r.key)}><span>{r.label}</span><span className={styles.track}><span style={{width:`${r.count/Math.max(1,rows.length)*100}%`}}/></span><strong>{r.count}건</strong></button>)}</article>
      <article><h3>담당별 남은 업무</h3>{owners.map(name=>{const all=rows.filter(r=>(r.group||'담당 미지정')===name);const active=all.filter(r=>!['done','canceled'].includes(r.state));return <button key={name} className={styles.owner} aria-pressed={activeOwner===name} onClick={()=>setOwner(activeOwner===name?'':name)}><strong>{name}</strong><span>진행할 일 {active.length} · 완료 {all.filter(r=>r.state==='done').length} · 지연 {active.filter(r=>r.overdue).length}</span></button>;})}</article>
    </div>}
    <header className={styles.heading}><div><h2>업무별 담당과 우선순위</h2><p>미완료 업무를 먼저, 기한 지남 → 우선순위 → 가까운 기한 순으로 표시합니다.</p></div><strong aria-live="polite">{shown.length}건</strong></header>
    <div className={styles.filters}><label>업무 찾기<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="업무명 또는 담당자"/></label><label>담당자<select aria-label="담당자" value={activeOwner} onChange={e=>setOwner(e.target.value)}><option value="">전체 담당자</option>{owners.map(name=><option key={name}>{name}</option>)}</select></label><label>상태<select aria-label="업무 상태" value={status} onChange={e=>setStatus(e.target.value)}><option value="">전체 상태</option>{Object.entries(metricLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
    <table className={styles.table}><caption>업무 제목, 담당, 우선순위, 기한과 현재 상태</caption><thead><tr>{['업무','담당','우선순위','기한 / 예정','상태'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{shown.map(row=><tr key={row.id} data-overdue={row.overdue}><td data-label="업무">{row.href?<Link href={row.href}>{row.title}</Link>:<strong>{row.title}</strong>}</td><td data-label="담당">{row.group||'담당 미지정'}</td><td data-label="우선순위"><span className={styles.priority} data-high={row.priority==='high'}>{priorityLabel(row.priority)}</span></td><td data-label="기한 / 예정">{row.dueDate?<>기한 {row.dueDate}{row.overdue&&<strong className={styles.overdue}>기한 지남</strong>}</>:row.scheduledAt?`실행 예정 ${new Date(row.scheduledAt).toLocaleString('ko-KR')}`:'기한 미지정'}</td><td data-label="상태">{metricLabels[row.state]}</td></tr>)}</tbody></table>
    {!shown.length&&<p className={styles.empty}>해당하는 업무가 없습니다.</p>}
  </section>;
}
