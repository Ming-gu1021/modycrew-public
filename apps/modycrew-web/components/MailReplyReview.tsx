'use client';

import Link from 'next/link';
import { useRef } from 'react';
import type { FinalConfirmationContract, FinalActionDryRunResult, FinalActionExecutionResult } from '@/lib/desktop-bridge';
import type { WorkItem } from '@/lib/types';
import { MailRedraftForm, type MailRedraftOutcome } from './MailRedraftForm';
import styles from './MailReplyReview.module.css';

type Props = {
  item: WorkItem;
  confirmation: FinalConfirmationContract | null;
  values: Record<string,string>;
  dryRun: FinalActionDryRunResult | null;
  execution: FinalActionExecutionResult | null;
  dispatchBlock: {label:string; message:string} | null;
  notice: string;
  busy: boolean;
  liveEnabled: boolean;
  onPrepare: () => void;
  onChange: (id:string,value:string) => void;
  onReview: () => void;
  onSend: () => void;
  onSave: () => void;
  onHold: () => void;
  onUnlock: () => void;
  onRedraft?: (instruction:string) => Promise<MailRedraftOutcome>;
};

/** A single reply stays a readable document; execution remains behind the existing main-process approval checks. */
export function MailReplyReview({item,confirmation,values,dryRun,execution,dispatchBlock,notice,busy,liveEnabled,onPrepare,onChange,onReview,onSend,onSave,onHold,onUnlock,onRedraft}:Props) {
  const dialog=useRef<HTMLDialogElement>(null);
  const sent=Boolean(item.finalAction?.sentAt)||item.finalAction?.readiness==='sent'||execution?.alreadySent===true||['final_execution_provider_dispatched','final_execution_provider_partial','final_execution_already_sent'].includes(execution?.status||'');
  const locked=Boolean(dispatchBlock);
  const ready=dryRun?.status==='final_action_dry_run_ready'&&Boolean(dryRun.dryRun);
  const value=(id:string)=>values[id]??confirmation?.defaultValues?.[id]??'';
  const attachments=confirmation?.attachmentCandidates||[];
  const selected=value('attachment_selection').split(',').filter(Boolean);
  const title=item.sourceEvidence?.messageSubject||item.title;
  const body=item.draft?.body||item.sourceEvidence?.draftPreview||item.summary;
  return <section className={styles.review} aria-label="메일 답장 검토" data-mail-reply-review={item.id}>
    <header className={styles.heading}>
      <div><Link href="/">← 업무로 돌아가기</Link><h1>답장 검토</h1><p>내용을 다듬고, 보낼 파일을 선택하세요.</p></div>
      <span className={styles.state}>{dispatchBlock?.label || (sent?'발송 완료':ready?'발송 전 검토 완료':'초안 · 발송 전 확인')}</span>
    </header>
    <div className={styles.paper}>
      <header className={styles.subject}><span>연결된 메일</span><h2>{title}</h2></header>
      {!confirmation ? <>
        <div className={styles.actions}><button className={styles.primary} onClick={onPrepare} disabled={busy||sent||locked}>{busy?'불러오는 중…':'답장 수정 및 첨부 확인'}</button><small>수신자와 파일을 확인한 뒤에만 발송할 수 있습니다.</small></div>
        <div className={styles.preview} role="region" aria-label="답장 초안 미리보기" tabIndex={0}>{body||'답장 초안을 먼저 준비해 주세요.'}</div>
      </> : <>
        <div className={styles.fields}>
          {confirmation.requiredFields.filter(field=>!['cc','bcc','attachment_selection','body_reviewed','cc_bcc_reviewed'].includes(field.id)).map(field=><label key={field.id} className={field.multiline?styles.body:styles.field}>
            <span>{field.label}{field.required?' *':''}</span>
            {field.multiline?<textarea rows={12} value={value(field.id)} placeholder={field.placeholder} onChange={event=>onChange(field.id,event.target.value)} disabled={busy||sent||locked}/>:<input value={value(field.id)} placeholder={field.placeholder} onChange={event=>onChange(field.id,event.target.value)} disabled={busy||sent||locked}/>}
          </label>)}
        </div>
        {confirmation.requiredFields.some(field=>field.id==='cc')&&<details className={styles.details}><summary>참조·숨은참조{value('cc')||value('bcc')?' · 주소 있음':''}</summary><div className={styles.fields}>
          <label className={styles.field}><span>참조</span><input aria-label="참조" value={value('cc')} onChange={event=>onChange('cc',event.target.value)} placeholder="name@example.com, colleague@example.com" disabled={busy||sent||locked}/></label>
          <label className={styles.field}><span>숨은참조</span><input aria-label="숨은참조" value={value('bcc')} onChange={event=>onChange('bcc',event.target.value)} placeholder="다른 수신자에게 표시하지 않을 주소" disabled={busy||sent||locked}/></label>
          <p>주소는 쉼표로 구분하세요. 받는 사람을 포함해 최대 50명입니다.</p>
        </div></details>}
        <fieldset className={styles.attachments}><legend>첨부할 결과물 <span>{selected.length}개 선택</span></legend>
          {attachments.map(file=><label key={file.key}><input type="checkbox" checked={selected.includes(file.key)} disabled={busy||sent||locked} onChange={event=>onChange('attachment_selection',event.target.checked?[...selected,file.key].join(','):selected.filter(key=>key!==file.key).join(','))}/><span><strong>{file.filename}</strong><small>{Math.ceil(file.bytes/1024)} KB</small></span></label>)}
          <p>{confirmation.attachmentNotice||(!attachments.length?'이 업무에서 문서를 저장하면 첨부 후보가 여기에 표시됩니다.':'선택한 파일만 보냅니다. 최대 5개 · 합계 10 MB')}</p>
        </fieldset>
        {confirmation.sendScopeRecovery&&<div className={styles.notice} role="status"><strong>메일 발송 권한 연결이 필요합니다</strong><p>{confirmation.sendScopeRecovery.userMessage}</p><Link href={confirmation.sendScopeRecovery.connectHref}>{confirmation.sendScopeRecovery.actionLabel} →</Link></div>}
        {dryRun&&<div className={styles.notice} role="status"><strong>{ready?'발송 전 검토를 마쳤습니다':'발송 전에 확인할 내용이 있습니다'}</strong><p>{dryRun.userMessage}</p>{dryRun.validationMessages?.map(message=><p key={message}>{message}</p>)}</div>}
        <label className={styles.reviewCheck}><input type="checkbox" checked={value('body_reviewed')==='본문과 민감정보 확인 완료'} disabled={busy||sent||locked} onChange={event=>onChange('body_reviewed',event.target.checked?'본문과 민감정보 확인 완료':'')}/><span>모든 수신자, 본문과 첨부파일을 확인했습니다.</span></label>
        <footer className={styles.actions}>
          <button onClick={onSave} disabled={busy||sent||locked}>초안 저장</button>
          <button onClick={onReview} disabled={busy||sent||locked||value('body_reviewed')!=='본문과 민감정보 확인 완료'}>{busy?'확인 중…':'실행 전 검토'}</button>
          <button className={styles.primary} disabled={busy||sent||locked||!ready||!liveEnabled||Boolean(confirmation.sendScopeRecovery)} onClick={()=>dialog.current?.showModal()}>{locked?'발송 상태 확인 필요':sent?'발송 완료':'검토한 내용으로 보내기'}</button>
          {!liveEnabled&&!sent&&<button className={styles.textButton} onClick={onUnlock}>발송 실행 설정</button>}
        </footer>
      </>}
    </div>
    {dispatchBlock ? <p className={styles.feedback} role="alert">{dispatchBlock.message}</p> : notice&&<p className={styles.feedback} role="status">{notice}</p>}
    {onRedraft&&!sent&&!locked&&<details className={styles.details}><summary>AI에게 초안 수정 요청</summary><MailRedraftForm workItemId={item.id} title={item.title} onRedraft={onRedraft}/></details>}
    <details className={styles.details}><summary>처리 기록과 확인 사항</summary><p>{item.summary}</p><ul>{confirmation?.checklist.map(check=><li key={check}>{check}</li>)}</ul>{execution&&<p>{execution.userMessage}</p>}<p>{execution?.auditId?`실행 기록: ${execution.auditId}`:dispatchBlock?'발송 상태는 보낸 편지함에서 확인해 주세요.':'이 앱에서 확인된 발송 결과가 없습니다.'}</p><p>발송한 메일은 회수되지 않을 수 있습니다.</p>{!sent&&!locked&&<button onClick={onHold} disabled={busy}>이 답장 보류하기</button>}</details>
    <dialog ref={dialog} className={styles.dialog} role="alertdialog" aria-labelledby="mail-send-title" aria-describedby="mail-send-description"><h2 id="mail-send-title">이 내용으로 메일을 보낼까요?</h2><p id="mail-send-description">받는 사람: {value('recipient')}<br/>{value('cc')&&<>참조: {value('cc')}<br/></>}{value('bcc')&&<>숨은참조: {value('bcc')}<br/></>}제목: {value('subject')}<br/>첨부: {selected.length}개</p><p>확인하면 실제 메일이 발송됩니다.</p><div className={styles.actions}><button autoFocus onClick={()=>dialog.current?.close()}>돌아가서 수정</button><button className={styles.primary} disabled={busy||sent||locked||!ready||!liveEnabled} onClick={()=>{dialog.current?.close();onSend();}}>확인하고 발송</button></div></dialog>
  </section>;
}
