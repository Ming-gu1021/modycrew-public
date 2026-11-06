'use client';
import { useEffect, useRef, useState } from 'react';
import { createDesktopBridge, type MailLedgerRow } from '@/lib/desktop-bridge';
import styles from './MailThreadReader.module.css';

type Message = {message:{messageId:string;subject:string;from:string;receivedAt:string};body:string;truncated:boolean;attachments:{key:string;name:string;size:number}[]};
export default function MailThreadReader({mail}:{mail:MailLedgerRow}) {
  const [messages,setMessages]=useState<Message[]|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[saving,setSaving]=useState('');
  const scope=`${mail.accountId}:${mail.messageId}`,active=useRef(scope);active.current=scope;
  useEffect(()=>{setMessages(null);setNotice('');setBusy(false);setSaving('');},[scope]);
  async function load(){
    setBusy(true);setNotice('');const expected=scope;
    try{
      const result=await createDesktopBridge().readMail({connectorId:mail.accountId,messageId:mail.messageId,conversation:true});
      if(active.current!==expected)return;
      if(result.status!=='mail_conversation_loaded'||!Array.isArray(result.messages))throw new Error(result.userMessage||'메일 대화를 불러오지 못했습니다.');
      setMessages(result.messages as Message[]);setNotice(`${result.messages.length}통 / 전체 ${result.totalCount}통${result.truncated?' · 일부 내용만 표시합니다. 전체 내용은 원래 메일함에서 확인해 주세요.':''}`);
    }catch(error){if(active.current===expected)setNotice(error instanceof Error?error.message:'메일을 불러오지 못했습니다.');}
    finally{if(active.current===expected)setBusy(false);}
  }
  async function save(messageId:string,attachmentKey:string){
    const expected=scope;setSaving(`${messageId}:${attachmentKey}`);setNotice('첨부파일을 불러오고 있습니다.');
    try{
      const result=await createDesktopBridge().readMail({connectorId:mail.accountId,messageId,attachmentKey});
      if(active.current===expected)setNotice(result.userMessage||'저장 결과를 확인해 주세요.');
    }catch{if(active.current===expected)setNotice('첨부파일을 저장하지 못했습니다. 다시 시도해 주세요.');}
    finally{if(active.current===expected)setSaving('');}
  }
  return <section className={styles.reader} aria-label="메일 원문과 대화">
    <div className={styles.toolbar}><span>{messages?'원본 메일 대화':'메일 미리보기'}</span><button type="button" disabled={busy} onClick={()=>void load()}>{busy?'불러오는 중…':messages?'다시 불러오기':'본문·이전 대화 보기'}</button></div>
    {notice&&<p role="status" className={styles.notice}>{notice}</p>}
    {messages?messages.map(item=><details key={item.message.messageId} open={item.message.messageId===mail.messageId} className={styles.message}>
      <summary><strong>{item.message.subject||'제목 없음'}</strong><span>{item.message.from} · {new Date(item.message.receivedAt).toLocaleString('ko-KR')}</span></summary>
      <div className={styles.body}>{item.body||'표시할 텍스트 본문이 없습니다.'}</div>
      {item.truncated&&<p className={styles.notice}>긴 본문의 일부를 표시합니다.</p>}
      {!!item.attachments.length&&<ul className={styles.files} aria-label="이 메일의 첨부파일">{item.attachments.map(file=><li key={file.key}><div><strong>{file.name}</strong><span>{(file.size/1024).toLocaleString('ko-KR',{maximumFractionDigits:1})} KB</span></div><button type="button" disabled={Boolean(saving)} onClick={()=>void save(item.message.messageId,file.key)}>{saving===`${item.message.messageId}:${file.key}`?'저장 중…':'저장'}</button></li>)}</ul>}
    </details>):<><div className={styles.body}>{mail.preview||'저장된 미리보기가 없습니다.'}</div><p className={styles.notice}>저장된 미리보기입니다. 본문을 열면 이전 대화와 첨부파일을 함께 확인할 수 있습니다.</p></>}
  </section>;
}
