'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createDesktopBridge, type DocumentLearningSearchResult } from '@/lib/desktop-bridge';
import { subscribeCompanyTeams, subscribeCompanyResources, loadMoreCompanyResources } from '@/lib/company-client';
import type { CompanyResource, CompanyTeam } from '@/lib/company-types';
import { type LocalFilePreview, type WorkspaceFileTarget } from '@/lib/workspace-side-pane';
import ShareToTeamButton, { useTeamShareMemberships } from './ShareToTeamButton';
import { SafeLinkText } from './TeamResourceTools';
import CompanyFileShelf from './CompanyFileShelf';
import styles from './WorkspaceFiles.module.css';

export function WorkspaceFiles({target}: {target?:WorkspaceFileTarget}){
  const {session,memberships,loaded}=useTeamShareMemberships();
  const [scope,setScope]=useState<'personal'|'company'>('personal');
  const [recent,setRecent]=useState<DocumentLearningSearchResult[]>([]);
  const [opened,setOpened]=useState<LocalFilePreview[]>([]);
  const [file,setFile]=useState<LocalFilePreview|null>(null);
  const [companyId,setCompanyId]=useState('');const [teamId,setTeamId]=useState('');
  const [teams,setTeams]=useState<CompanyTeam[]>([]);const [resources,setResources]=useState<CompanyResource[]>([]);
  const [resourceId,setResourceId]=useState('');const [query,setQuery]=useState('');
  const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [loadingShared,setLoadingShared]=useState(false);
  const generation=useRef(0);const targetHandled=useRef(0);const scopeNow=useRef('');const pendingResource=useRef('');
  const listRef=useRef<HTMLDivElement>(null);
  scopeNow.current=`${session?.uid||''}:${companyId}:${teamId}`;
  const activeMembership=memberships.find(m=>m.companyId===companyId&&m.status==='active');
  const availableTeams=teams.filter(t=>t.visibility==='company'||t.memberIds.includes(session?.uid||''));
  const activeTeam=activeMembership?availableTeams.find(t=>t.id===teamId):undefined;
  const shared=activeTeam?resources.find(r=>r.id===resourceId):undefined;
  const refresh=useCallback(async()=>{
    try{const result=await createDesktopBridge().searchDocumentLearningIndex({query:'',limit:40});setRecent(result.results||[]);}catch{setRecent([]);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{generation.current++;setBusy(false);setOpened([]);setFile(null);setResources([]);setResourceId('');setCompanyId('');setTeamId('');setTeams([]);setNotice('');},[session?.uid]);
  useEffect(()=>{if(loaded&&!activeMembership){setCompanyId(memberships[0]?.companyId||'');setTeamId('');setResources([]);setResourceId('');}},[loaded,memberships,activeMembership]);
  useEffect(()=>{
    let alive=true;let stop:(()=>void)|undefined;setTeams([]);setResources([]);setResourceId('');
    if(session&&activeMembership)void subscribeCompanyTeams(session,companyId,rows=>{if(!alive)return;setTeams(rows);const visible=rows.filter(t=>t.visibility==='company'||t.memberIds.includes(session.uid));setTeamId(current=>visible.some(t=>t.id===current)?current:visible[0]?.id||'');},()=>{if(alive){setTeams([]);setResources([]);setNotice('회사 자료에 접근하지 못했습니다. 소속과 팀 권한을 확인해 주세요.');}}).then(s=>{if(alive)stop=s;else s();}).catch(()=>{if(alive)setNotice('회사 연결을 확인해 주세요.');});
    return()=>{alive=false;stop?.();};
  },[session,companyId,activeMembership]);
  useEffect(()=>{
    let alive=true;let stop:(()=>void)|undefined;setResources([]);setLoadingShared(Boolean(session&&activeTeam));
    if(session&&activeTeam)void subscribeCompanyResources(session,companyId,teamId,rows=>{if(alive){setResources(rows);setLoadingShared(false);}},()=>{if(alive){setResources([]);setResourceId('');setLoadingShared(false);setNotice('이 팀의 공유 자료를 읽을 수 없습니다.');}}).then(s=>{if(alive)stop=s;else s();}).catch(()=>{if(alive){setLoadingShared(false);setNotice('공유 자료를 불러오지 못했습니다.');}});
    return()=>{alive=false;stop?.();};
  },[session,companyId,teamId,activeTeam]);
  async function openFile(path?:string){
    const tick=++generation.current;setBusy(true);setNotice('');
    try{if(!window.modyCrewFiles)throw new Error('파일 미리보기는 최신 설치 앱에서 사용할 수 있습니다.');const result=await window.modyCrewFiles.request(path?{kind:'preview',path}:{kind:'pick'});if(tick!==generation.current)return;if(result.file){setFile(result.file);setScope('personal');setOpened(current=>[result.file!,...current.filter(x=>x.path!==result.file!.path)].slice(0,12));}}
    catch(error){if(tick===generation.current)setNotice(error instanceof Error?error.message:'파일을 열지 못했습니다.');}finally{if(tick===generation.current)setBusy(false);}
  }
  useEffect(()=>{
    if(!target?.revision||targetHandled.current===target.revision)return;
    if(target.path){targetHandled.current=target.revision;void openFile(target.path);return;}
    if(target.companyId){if(!loaded)return;targetHandled.current=target.revision;if(!memberships.some(m=>m.companyId===target.companyId)){setNotice('이 회사의 자료에 접근할 수 없습니다.');return;}generation.current++;setBusy(false);pendingResource.current=target.resourceId||'';setScope('company');setCompanyId(target.companyId);setTeamId(target.teamId||'');setResourceId(target.resourceId||'');setFile(null);}
  // A target is consumed once; live subscriptions enforce current access independently.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[target,loaded,memberships]);
  useEffect(()=>{if(target?.companyId===companyId&&pendingResource.current&&resources.some(r=>r.id===pendingResource.current)){setResourceId(pendingResource.current);pendingResource.current='';}},[resources,target,companyId]);
  const chooseScope=(value:'personal'|'company')=>{generation.current++;setBusy(false);setScope(value);setQuery('');setNotice('');};
  const filtered=scope==='company'?resources.filter(r=>r.title.toLowerCase().includes(query.toLowerCase())):recent.filter(r=>r.title.toLowerCase().includes(query.toLowerCase()));
  return <section className={styles.files} aria-label="파일과 회사 공유 자료">
    <div className={styles.scope} role="group" aria-label="자료 범위"><button type="button" aria-pressed={scope==='personal'} onClick={()=>chooseScope('personal')}>내 파일</button><button type="button" aria-pressed={scope==='company'} onClick={()=>chooseScope('company')}>회사 공유</button></div>
    {notice&&<p className={styles.notice} role="status">{notice}</p>}
    {scope==='personal'&&file?<>
      <div className={styles.documentHeader}><button type="button" onClick={()=>setFile(null)}>← 파일 목록</button><h2 title={file.name}>{file.name}</h2><small>{file.extension.toUpperCase()} · {Math.ceil(file.size/1024).toLocaleString()} KB</small></div>
      <div className={styles.actions}><button type="button" disabled={busy} onClick={()=>void openFile()}>다른 파일 열기</button><button type="button" onClick={()=>void window.modyCrewFiles?.request({kind:'open-original',path:file.path}).catch(()=>setNotice('원본 파일을 열지 못했습니다.'))}>원본 앱에서 열기</button>{file.text&&<ShareToTeamButton source="document" title={file.name} text={file.text.slice(0,16000)} label="회사 팀에 공유" />}</div>
      <div className={styles.preview} data-file-preview>{file.kind==='image'?<img src={file.dataUrl} alt={file.name}/>:<><p className={styles.hint}>본문 미리보기{file.truncated?' · 앞부분만 표시':''}</p><pre>{file.text||'읽을 수 있는 본문이 없습니다. 원본 앱에서 확인해 주세요.'}</pre></>}</div>
    </>:scope==='company'&&shared?<>
      <div className={styles.documentHeader}><button type="button" onClick={()=>setResourceId('')}>← 공유 자료 목록</button><h2>{shared.title}</h2><small>{activeMembership?.companyName} · {activeTeam?.name} · {shared.authorName}</small></div>
      <div className={styles.preview} data-shared-preview><SafeLinkText text={shared.text}/></div>
    </>:<>
      {scope==='personal'?<div className={styles.toolbar}><button className={styles.primary} type="button" disabled={busy} onClick={()=>void openFile()}>{busy?'파일 여는 중…':'＋ 파일 열기'}</button><button type="button" onClick={()=>void refresh()} aria-label="파일 목록 새로고침">↻</button></div>:<div className={styles.selectors}>
        <label>회사<select aria-label="자료를 볼 회사" value={companyId} onChange={e=>{setCompanyId(e.target.value);setTeamId('');setResourceId('');setNotice('');}}>{memberships.map(m=><option key={m.companyId} value={m.companyId}>{m.companyName}</option>)}</select></label>
        <label>대화방<select aria-label="공유 자료 대화방" value={teamId} onChange={e=>{setTeamId(e.target.value);setResourceId('');setNotice('');}}>{availableTeams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      </div>}
      <input className={styles.search} aria-label="사이드 패널 파일 찾기" placeholder="파일 또는 자료 이름 찾기" value={query} onChange={e=>setQuery(e.target.value)}/>
      <div className={styles.list} ref={listRef}>
        {scope==='personal'&&opened.length>0&&<><h3>최근에 연 파일</h3>{opened.filter(f=>f.name.toLowerCase().includes(query.toLowerCase())).map(f=><button type="button" className={styles.fileRow} key={f.path} onClick={()=>setFile(f)}><span className={styles.fileIcon}>{f.extension.slice(0,4).toUpperCase()}</span><span><strong>{f.name}</strong><small>이 PC · 나만 보기</small></span><span>↗</span></button>)}</>}
        <h3>{scope==='personal'?'업무에 연결한 자료':'팀이 공유한 자료'}</h3>{scope==='company'&&session&&activeTeam&&<CompanyFileShelf key={session.uid+':'+companyId+':'+teamId} session={session} companyId={companyId} teamId={teamId} destination={activeMembership?.companyName+' · '+activeTeam.name} dropTarget={listRef}/>}
        {scope==='company'&&!loaded?<p className={styles.empty}>회사 정보를 불러오는 중…</p>:scope==='company'&&!memberships.length?<div className={styles.empty}>연결된 회사가 없습니다.<Link href="/company">회사 연결하기</Link></div>:loadingShared&&scope==='company'?<p className={styles.empty}>공유 자료를 불러오는 중…</p>:!filtered.length?<p className={styles.empty}>{scope==='personal'?'파일을 열면 이 자리에서 보며 작업할 수 있습니다.':'이 대화방에 공유된 자료가 없습니다.'}</p>:filtered.map(row=>scope==='personal'?<button type="button" className={styles.fileRow} key={row.id} disabled={busy} onClick={()=>void openFile((row as DocumentLearningSearchResult).path)}><span className={styles.fileIcon}>파일</span><span><strong>{row.title}</strong><small>이 PC · 연결한 자료</small></span><span>↗</span></button>:<button type="button" className={styles.fileRow} key={row.id} onClick={()=>setResourceId(row.id)}><span className={styles.fileIcon}>공유</span><span><strong>{row.title}</strong><small>{(row as CompanyResource).authorName} · 팀 공개</small></span><span>↗</span></button>)}
        {scope==='company'&&resources.length>=50&&session&&activeTeam&&<button type="button" onClick={()=>{const snapshot=scopeNow.current;void loadMoreCompanyResources(session,companyId,teamId,resources.at(-1)!.updatedAtEpochMs).then(rows=>{if(snapshot===scopeNow.current)setResources(current=>[...current,...rows.filter(r=>!current.some(c=>c.id===r.id))]);}).catch(()=>{if(snapshot===scopeNow.current)setNotice('이전 자료를 불러오지 못했습니다.');});}}>이전 자료 더 보기</button>}
      </div>
      <footer className={styles.footer}>{scope==='personal'?<><span>파일은 이 PC에서만 열립니다.</span><Link href="/learn?view=full">자료 연결 관리</Link></>:<><span>선택한 회사·대화방의 공유 자료입니다.</span><Link href="/company">회사 대화 열기</Link></>}</footer>
    </>}
  </section>;
}
