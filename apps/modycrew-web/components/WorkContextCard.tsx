'use client';

import { useRef, useState } from 'react';
import type { WorkSessionPatch } from '../../../packages/domain/dist/work-session-workspace.js';
import type { WorkspaceSessionView } from './ProjectWorkspace';
import { openWorkBrowserPane } from '@/lib/work-browser';
import { mailDraftApprovalHref } from '@/lib/chat-mail-draft-staging';
import type { MailWorkPlan } from '@/lib/mail-work-context';
import styles from './WorkContextCard.module.css';

type Props = {
  session: WorkspaceSessionView;
  onUpdate: (patch: WorkSessionPatch) => Promise<void>;
  onSource: () => void;
  onRequest: (prompt: string) => void;
  onDraft: () => Promise<void>;
  onOrganize: (instruction:string) => Promise<MailWorkPlan>;
  onDocument: () => Promise<void>;
  onOpenDocument: (id:string) => Promise<void>;
  onLoadBody: () => Promise<void>;
};
const priorities = { low: '낮음', normal: '보통', high: '높음', urgent: '긴급' };
export default function WorkContextCard({ session, onUpdate, onSource, onRequest, onDraft, onOrganize, onDocument, onOpenDocument, onLoadBody }: Props) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const [plan,setPlan]=useState<MailWorkPlan|null>(null);
  const [instruction,setInstruction]=useState('');
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice('');
    try { await action(); }
    catch (error) { setNotice(error instanceof Error ? error.message : '저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { pending.current = false; setBusy(false); }
  }
  if (!session.source) return null;
  return <section className={styles.card} aria-label="메일에서 이어가는 업무" data-mail-work-context>
    <div className={styles.header}><span>메일에서 시작한 업무</span><button type="button" onClick={onSource}>연결 메일 보기</button></div>
    <dl className={styles.facts}>
      <div><dt>담당</dt><dd>{session.assigneeName || '나'}</dd></div>
      <div><dt>우선순위</dt><dd>{priorities[session.priority ?? 'normal']}</dd></div>
      <div><dt>기한</dt><dd>{session.dueDate || '미정'}</dd></div>
      <div><dt>다음 행동</dt><dd>{session.nextAction || '메일의 요청 사항 확인'}</dd></div>
    </dl>
    {Boolean(session.artifacts?.length)&&<div className={styles.results} aria-label="저장된 결과물"><span>결과물 {session.artifacts!.length}</span>{session.artifacts!.slice(0,3).map(artifact=><button type="button" key={artifact.documentId} disabled={busy} onClick={()=>void run(()=>onOpenDocument(artifact.documentId))}><span>{artifact.title}</span><small>{artifact.format.toUpperCase()}</small></button>)}</div>}
    {session.replyCardId && <div className={styles.actions}><a href={mailDraftApprovalHref(session.replyCardId)}>답장 초안 검토</a></div>}
    <details className={styles.tools}><summary>업무 도구와 상세</summary>
    {session.priorityReason && <p className={styles.reason}>우선순위 근거 · {session.priorityReason}</p>}
    <div className={styles.actions}>
      <button type="button" disabled={busy||session.running} onClick={()=>void run(async()=>{await onLoadBody();setNotice('메일 본문을 업무 자료에 저장했습니다.');})}>{session.source.contentKind==='body'?'메일 본문 새로 확인':'메일 본문 불러오기'}</button>
      <button type="button" disabled={busy || session.running} onClick={()=>void run(async()=>{setPlan(await onOrganize(instruction));setNotice('업무 제안을 확인한 뒤 반영해 주세요.');})}>{busy?'처리 중…':'AI로 업무 정리'}</button>
      <button type="button" onClick={()=>openWorkBrowserPane()}>참고 자료 찾기</button>
      <button type="button" disabled={busy||session.running} onClick={()=>void run(onDocument)}>결과물 만들기</button>
      <button type="button" disabled={busy || session.running} onClick={()=>void run(onDraft)}>{busy ? '준비 중…' : session.replyCardId ? '답장 초안 다시 준비' : '답장 초안 준비'}</button>

    </div>
    <details className={styles.details}><summary>업무 정리에 요청 더하기</summary><label className={styles.instruction}>예: 오늘 제안서보다 이 회신부터 준비해 줘<input value={instruction} onChange={event=>setInstruction(event.target.value)} maxLength={2000} placeholder="처리 순서나 원하는 결과를 알려주세요"/></label></details>
    {plan&&<section className={styles.proposal} aria-label="AI 업무 제안">
      <strong>업무 제안</strong><p>{plan.summary}</p><p>다음 행동: {plan.nextAction}</p><p>우선순위: {priorities[plan.priority]} ({plan.priorityReason})</p>
      <p>기한 · {plan.dueDate||'원문에 확인된 기한 없음'}{plan.dueEvidence&&` (${plan.dueEvidence})`}</p>
      {plan.questions.length>0&&<ul>{plan.questions.map((question,index)=><li key={index}>{question}</li>)}</ul>}
      <div className={styles.actions}><button type="button" disabled={busy} onClick={()=>void run(async()=>{await onUpdate({description:plan.summary,nextAction:plan.nextAction,priority:plan.priority,priorityReason:`AI 제안 확인 · ${plan.priorityReason}`,...(plan.dueDate&&!session.dueDate?{dueDate:plan.dueDate}:{})});setPlan(null);setNotice('업무 요약과 처리 순서를 저장했습니다.');})}>업무에 반영</button><button type="button" disabled={busy} onClick={()=>setPlan(null)}>제안 닫기</button></div>
    </section>}
    <details className={styles.details}><summary>업무 정보 수정</summary>
      <form key={JSON.stringify([session.assigneeName,session.nextAction,session.priorityReason,session.priority,session.dueDate])} onSubmit={event=>{
        event.preventDefault(); const data=new FormData(event.currentTarget);
        void run(async()=>{await onUpdate({ assigneeName:String(data.get('assigneeName')||'').trim()||null,
          nextAction:String(data.get('nextAction')||'').trim()||null,
          priority:data.get('priority') as WorkSessionPatch['priority'], dueDate:String(data.get('dueDate')||'')||null,
          priorityReason:String(data.get('priorityReason')||'').trim()||null });setNotice('업무 정보를 저장했습니다.');});
      }}>
        <label>담당자<input name="assigneeName" defaultValue={session.assigneeName||'나'} maxLength={120}/></label>
        <label>우선순위<select name="priority" defaultValue={session.priority||'normal'}>{Object.entries(priorities).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label>기한<input name="dueDate" type="date" defaultValue={session.dueDate||''}/></label>
        <label>다음 행동<input name="nextAction" defaultValue={session.nextAction||''} maxLength={2000}/></label>
        <label className={styles.full}>우선순위 근거<textarea name="priorityReason" defaultValue={session.priorityReason||''} rows={2} maxLength={2000}/></label>
        <button type="submit" disabled={busy}>변경 저장</button>
      </form>
    </details>
    <details className={styles.details}><summary>연결된 메일과 참고 자료{session.references?.length ? ` · ${session.references.length}개` : ''}</summary>
      <article className={styles.source}><strong>{session.source.subject}</strong><small>{session.source.from} · 받은 시각 {session.source.receivedAt || '미확인'}</small><p>{session.source.preview || '본문 미리보기가 없습니다. 원문을 확인해 주세요.'}</p><small>{session.source.contentKind==='body'?(session.source.bodyTruncated?'저장된 본문 · 앞 12,000자':'저장된 메일 본문'):'저장된 미리보기'} · 수신 날짜는 마감일과 다릅니다.</small></article>
      {session.references?.map(reference=><article key={reference.id} className={styles.source}><button type="button" onClick={()=>openWorkBrowserPane(reference.url)}>{reference.title}</button><small>{reference.url}</small><p>{reference.note}</p></article>)}
    </details>
    {Boolean(session.artifacts?.length)&&<details className={styles.details}><summary>저장된 결과물 · {session.artifacts!.length}개</summary>{session.artifacts!.map(artifact=><article className={styles.source} key={artifact.documentId}><button type="button" disabled={busy} onClick={()=>void run(()=>onOpenDocument(artifact.documentId))}>{artifact.title}</button><small>{artifact.format.toUpperCase()} · {Math.ceil(artifact.bytes/1024)} KB · {new Date(artifact.savedAt).toLocaleDateString('ko-KR')}</small></article>)}</details>}
    </details>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
  </section>;
}
