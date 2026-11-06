'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { ModyAuthSession } from '@/lib/firebase-client';
import type { CompanyFile } from '@/lib/company-types';
import { COMPANY_FILE_ACCEPT, COMPANY_FILE_MAX, downloadCompanyFile, subscribeCompanyFiles, uploadCompanyFile } from '@/lib/company-collaboration';
import '@/lib/workspace-side-pane';
import styles from './CompanyCollaboration.module.css';

type UploadStatus='waiting'|'uploading'|'done'|'failed'|'canceled';
type UploadRow={key:string;name:string;size:number;status:UploadStatus;progress:number;message:string};
// Shape shared by React's synthetic DragEvent and the native one, so the same handlers serve the card and an optional outer drop target.
type DropLike={dataTransfer:DataTransfer|null;preventDefault():void;nativeEvent?:Event};

const size=(bytes:number)=>bytes<1024*1024?Math.ceil(bytes/1024)+' KB':(bytes/1024/1024).toFixed(1)+' MB';
const errorText=(e:unknown)=>/unauthorized|permission|insufficient/i.test(String(e))?'파일에 접근할 수 없습니다. 회사 소속과 대화방 참여 상태를 확인해 주세요.':e instanceof Error?e.message:'파일을 처리하지 못했습니다.';
const SIZE_MESSAGE='내용이 있는 20MB 이하 파일을 선택해 주세요.';
const TYPE_MESSAGE='20MB 이하의 문서·표·이미지·ZIP 파일을 선택해 주세요.';
const CANCEL_MESSAGE='업로드를 취소했습니다.';
const SHARED_MESSAGE='원본 파일을 공유했습니다. 이 대화방의 참여자가 내려받을 수 있습니다.';
const LIMIT_HINT='문서·표·이미지·ZIP · 파일당 최대 20MB';
const accepted=COMPANY_FILE_ACCEPT.split(',');
const extensionOf=(name:string)=>name.includes('.')?'.'+name.split('.').at(-1)!.toLowerCase():'';
// Same rules as uploadCompanyFile, checked before the upload starts so one bad file never blocks the others.
const precheck=(file:File)=>!accepted.includes(extensionOf(file.name))||/[\\/]/.test(file.name)?TYPE_MESSAGE:!file.size||file.size>COMPANY_FILE_MAX?SIZE_MESSAGE:'';
const rowLabel=(row:UploadRow)=>row.status==='waiting'?'대기 중':row.status==='uploading'?row.progress+'%':row.status==='done'?'완료':row.status==='canceled'?'취소됨':row.message;
const hasFiles=(event:DropLike)=>{const transfer=event.dataTransfer;if(!transfer)return false;return Array.from(transfer.types||[]).includes('Files')||Array.from(transfer.items||[]).some(item=>item.kind==='file');};
// Folders arrive as pseudo-files; keep them out of the queue so the user sees the format message instead of a silent failure.
function collect(transfer:DataTransfer){const files:File[]=[];const folders:string[]=[];
  for(const item of Array.from(transfer.items||[])){if(item.kind!=='file')continue;const file=item.getAsFile();if(!file)continue;const entry=typeof item.webkitGetAsEntry==='function'?item.webkitGetAsEntry():null;if(entry?.isDirectory)folders.push(file.name);else files.push(file);}
  if(!files.length&&!folders.length)files.push(...Array.from(transfer.files||[]));
  return {files,folders};
}
const UploadIcon=()=><svg className={styles.dropIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 16V5m0 0-4 4m4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 15v2.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;

// dropTarget: an ancestor element (for example the side-pane list) that should also accept drops; the card itself always does.
export default function CompanyFileShelf({session,companyId,teamId,destination,dropTarget,compact=false}:{session:ModyAuthSession;companyId:string;teamId:string;destination:string;dropTarget?:{current:HTMLElement|null};compact?:boolean}){
  const [expanded,setExpanded]=useState(false);
  const [files,setFiles]=useState<CompanyFile[]>([]);const [loaded,setLoaded]=useState(false);const [rows,setRows]=useState<UploadRow[]>([]);
  const [busy,setBusy]=useState('');const [error,setError]=useState('');const [notice,setNotice]=useState('');const [search,setSearch]=useState('');const [dragging,setDragging]=useState(false);
  const controller=useRef<AbortController|null>(null);const mounted=useRef(true);const running=useRef(false);const downloading=useRef(false);
  const queue=useRef<{key:string;file:File}[]>([]);const rowsRef=useRef<UploadRow[]>([]);const dragDepth=useRef(0);const input=useRef<HTMLInputElement>(null);const seen=useRef(new WeakSet<object>());
  useEffect(()=>{mounted.current=true;let alive=true;let stop:(()=>void)|undefined;
    void subscribeCompanyFiles(session,companyId,teamId,list=>{if(alive){setFiles(list);setLoaded(true);}},e=>{if(alive){setFiles([]);setError(errorText(e));}}).then(s=>{if(alive)stop=s;else s();}).catch(e=>{if(alive)setError(errorText(e));});
    return()=>{alive=false;mounted.current=false;stop?.();queue.current=[];controller.current?.abort();};
  },[session,companyId,teamId]);
  useEffect(()=>{const reset=()=>{dragDepth.current=0;setDragging(false);};window.addEventListener('dragend',reset);window.addEventListener('drop',reset);return()=>{window.removeEventListener('dragend',reset);window.removeEventListener('drop',reset);};},[]);
  const handlers=useRef({enter:(_e:DropLike)=>{},over:(_e:DropLike)=>{},leave:(_e:DropLike)=>{},drop:(_e:DropLike)=>{}});
  useEffect(()=>{const target=dropTarget?.current;if(!target)return;
    const enter=(e:globalThis.DragEvent)=>handlers.current.enter(e);const over=(e:globalThis.DragEvent)=>handlers.current.over(e);const leave=(e:globalThis.DragEvent)=>handlers.current.leave(e);const drop=(e:globalThis.DragEvent)=>handlers.current.drop(e);
    target.addEventListener('dragenter',enter);target.addEventListener('dragover',over);target.addEventListener('dragleave',leave);target.addEventListener('drop',drop);
    return()=>{target.removeEventListener('dragenter',enter);target.removeEventListener('dragover',over);target.removeEventListener('dragleave',leave);target.removeEventListener('drop',drop);};
  },[dropTarget]);
  const update=(next:UploadRow[])=>{rowsRef.current=next;if(mounted.current)setRows(next);};
  const patch=(key:string,part:Partial<UploadRow>)=>update(rowsRef.current.map(row=>row.key===key?{...row,...part}:row));
  function enqueue(list:File[],folders:string[]=[]){
    if(!list.length&&!folders.length)return;
    if(compact)setExpanded(true);
    setError('');setNotice('');const stamp=Date.now()+'-'+Math.random().toString(36).slice(2,7);
    const added:UploadRow[]=folders.map((name,index)=>({key:stamp+'-dir'+index,name,size:0,status:'failed',progress:0,message:TYPE_MESSAGE}));
    list.forEach((file,index)=>{const key=stamp+'-'+index;const message=precheck(file);added.push({key,name:file.name,size:file.size,status:message?'failed':'waiting',progress:0,message});if(!message)queue.current.push({key,file});});
    update([...(running.current?rowsRef.current:[]),...added]);
    void run();
  }
  async function run(){
    if(running.current)return;running.current=true;setBusy('upload');
    while(queue.current.length&&mounted.current){
      const next=queue.current.shift()!;const abort=new AbortController();controller.current=abort;patch(next.key,{status:'uploading',progress:0});
      try{await uploadCompanyFile(session,companyId,teamId,next.file,p=>{if(mounted.current)patch(next.key,{progress:p});},abort.signal);patch(next.key,{status:'done',progress:100});}
      catch(e){patch(next.key,abort.signal.aborted?{status:'canceled',message:CANCEL_MESSAGE}:{status:'failed',message:errorText(e)});}
    }
    controller.current=null;running.current=false;
    if(!mounted.current)return;
    const finished=rowsRef.current;const done=finished.filter(row=>row.status==='done').length;const failed=finished.filter(row=>row.status==='failed');const canceled=finished.some(row=>row.status==='canceled');
    update(failed);setBusy('');
    if(canceled)setNotice(done?'파일 '+done+'개를 공유한 뒤 업로드를 취소했습니다.':CANCEL_MESSAGE);else if(done)setNotice(done===1?SHARED_MESSAGE:'파일 '+done+'개를 공유했습니다. 이 대화방의 참여자가 내려받을 수 있습니다.');
    if(failed.length)setError('파일 '+failed.length+'개를 공유하지 못했습니다.');
  }
  function cancel(){queue.current=[];update(rowsRef.current.map(row=>row.status==='waiting'?{...row,status:'canceled',message:CANCEL_MESSAGE}:row));controller.current?.abort();}
  function pick(){if(downloading.current)return;input.current?.click();}
  function onPicked(event:ChangeEvent<HTMLInputElement>){const list=Array.from(event.target.files||[]);event.target.value='';enqueue(list);}
  // The card's events also bubble to the outer drop target; handle each native event once no matter which listener sees it first.
  const fresh=(event:DropLike)=>{const key=event.nativeEvent||event;if(seen.current.has(key))return false;seen.current.add(key);return hasFiles(event);};
  function onDragEnter(event:DropLike){if(!fresh(event))return;event.preventDefault();dragDepth.current+=1;setDragging(true);}
  function onDragOver(event:DropLike){if(!fresh(event))return;event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';}
  function onDragLeave(event:DropLike){if(!fresh(event))return;dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragging(false);}
  function onDrop(event:DropLike){if(!fresh(event)||!event.dataTransfer)return;event.preventDefault();dragDepth.current=0;setDragging(false);if(downloading.current)return;const picked=collect(event.dataTransfer);enqueue(picked.files,picked.folders);}
  handlers.current={enter:onDragEnter,over:onDragOver,leave:onDragLeave,drop:onDrop};
  async function download(id:string){if(downloading.current||running.current)return;downloading.current=true;setBusy(id);setError('');setNotice('');
    try{const file=await downloadCompanyFile(session,companyId,teamId,id);if(!mounted.current)return;
      if(window.modyCrewFiles){let binary='';const bytes=new Uint8Array(file.bytes);for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        const saved=await window.modyCrewFiles.request({kind:'save-shared',name:file.name,base64:btoa(binary)});if(mounted.current)setNotice(saved.status==='saved'?'파일을 저장했습니다.':'저장을 취소했습니다.');
      }else{const url=URL.createObjectURL(new Blob([file.bytes],{type:'application/octet-stream'}));const link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);setNotice('원본 확인 후 다운로드를 시작했습니다.');}
    }catch(e){if(mounted.current)setError(errorText(e));}finally{downloading.current=false;if(mounted.current)setBusy('');}
  }
  const shown=files.filter(f=>f.name.toLowerCase().includes(search.toLowerCase()));
  const uploading=busy==='upload';const current=rows.find(row=>row.status==='uploading');const position=current?rows.indexOf(current)+1:rows.length;
  const failedRows=uploading?[]:rows.filter(row=>row.status==='failed');
  const shareButton=<button type="button" className={styles.shareButton} disabled={Boolean(busy)&&!uploading} onClick={pick}><UploadIcon/>파일 공유하기</button>;
  const content=<>
    <input ref={input} className={styles.hiddenInput} type="file" accept={COMPANY_FILE_ACCEPT} multiple tabIndex={-1} aria-label="공유할 원본 파일" onChange={onPicked}/>
    {dragging&&<div className={styles.dropOverlay} role="status">여기에 놓으면 이 대화방에 공유됩니다</div>}
    {!compact&&<div className={styles.header+' '+styles.shelfHeader}><div><h3>공유 파일 · {files.length}</h3><p>{destination} 참여자에게 공유한 원본입니다.</p></div>{loaded&&files.length>0&&shareButton}</div>}
    {compact&&<p className={styles.shelfHint}>{destination} 참여자에게 공유한 원본입니다.</p>}
    {loaded&&!files.length&&<div className={styles.dropzone} role="group" aria-label="파일을 끌어다 놓아 이 대화방에 공유"><UploadIcon/><p className={styles.dropTitle}>파일을 끌어다 놓거나</p>{shareButton}<p className={styles.shelfHint}>{LIMIT_HINT}</p></div>}
    {loaded&&files.length>0&&<p className={styles.shelfHint}>파일을 이 영역에 끌어다 놓아도 됩니다 · {LIMIT_HINT}</p>}
    {uploading&&<div className={styles.uploadList}><p className={styles.uploadSummary} role="status">파일 올리는 중 {position}/{rows.length}{current?' · '+current.name+' '+current.progress+'%':''}</p>
      <ul>{rows.map(row=><li key={row.key} className={styles.uploadRow} data-status={row.status}><span className={styles.uploadName}>{row.name}{row.size>0&&<small> · {size(row.size)}</small>}</span><span className={styles.uploadMeta}>{rowLabel(row)}</span>{row.status==='uploading'&&<progress value={row.progress} max={100} aria-label={row.name+' 업로드 진행률'}/>}</li>)}</ul>
      <div className={styles.actions}><button type="button" onClick={cancel}>업로드 취소</button></div></div>}
    {error&&<div className={styles.notice} role="alert"><p>{error}</p>{failedRows.length>0&&<><ul className={styles.failedList}>{failedRows.map(row=><li key={row.key}><strong>{row.name}</strong> · {row.message}</li>)}</ul><div className={styles.actions}><button type="button" onClick={()=>{update([]);setError('');}}>닫기</button></div></>}</div>}
    {notice&&<p className={styles.notice} role="status">{notice}</p>}
    {files.length>0&&<div className={styles.form}><label>공유 파일 찾기<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="파일 이름"/></label></div>}
    {shown.length>0&&<ul className={styles.fileList}>{shown.map(f=><li className={styles.fileRow} key={f.id}><span className={styles.fileBadge} aria-hidden="true">{extensionOf(f.name).slice(1,5).toUpperCase()||'파일'}</span><div><strong>{f.name}</strong><span className={styles.fileMeta}>{f.authorName} · {size(f.size)} · {new Date(f.createdAtEpochMs).toLocaleDateString('ko-KR')}</span></div><button type="button" aria-label={f.name+' 내려받기'} disabled={Boolean(busy)} onClick={()=>void download(f.id)}>{busy===f.id?'원본 확인 중…':'내려받기'}</button></li>)}</ul>}
    {files.length>0&&!shown.length&&<p className={styles.shelfHint}>‘{search}’와 이름이 맞는 공유 파일이 없습니다.</p>}
    {!loaded&&!error&&<p className={styles.shelfHint} role="status">파일을 불러오는 중…</p>}{files.length>=100&&<p className={styles.shelfHint}>최근 파일 100개를 표시합니다.</p>}
  </>;
  return <section className={styles.section+' '+styles.shelf+(compact?' '+styles.chatShelf:'')} aria-label="회사 원본 파일" data-company-chat-files={compact||undefined} data-dragging={dragging||undefined}
    onDragEnter={event=>{onDragEnter(event);if(compact&&hasFiles(event))setExpanded(true);}} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    {compact?<details open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
      <summary><span>공유 파일{loaded?' · '+files.length:''}{error?' · 확인 필요':''}{uploading?' · '+(current?.progress??0)+'%':''}</span>
        <button type="button" aria-label="이 대화방에 파일 공유" disabled={Boolean(busy)&&!uploading} title={destination+'에 파일 공유'} onClick={event=>{event.preventDefault();event.stopPropagation();pick();}}>＋ 파일 추가</button>
      </summary>
      <div className={styles.chatShelfContent}>{content}</div>
    </details>:content}
  </section>;
}
