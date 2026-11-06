'use client';

import { useRef, useState } from 'react';
import type { ModyAuthSession } from '@/lib/firebase-client';
import type { CompanyMember, CompanyTeam } from '@/lib/company-types';
import { startCompanyConversation } from '@/lib/company-collaboration';
import styles from './CompanyCollaboration.module.css';

export default function CompanyConversationPicker({ session, companyId, members, onOpen, onClose }: { session: ModyAuthSession; companyId: string; members: CompanyMember[]; onOpen: (team: CompanyTeam) => void; onClose: () => void }) {
  const [kind, setKind] = useState<'direct'|'group'>('direct');
  const [selected, setSelected] = useState<string[]>([]); const [name, setName] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const pending = useRef(false);
  const people = members.filter(m => m.status === 'active' && m.uid !== session.uid);
  return <section className={styles.section} aria-label="새 회사 대화">
    <div className={styles.header}><div><h3>동료와 대화 시작</h3><p>선택한 참여자에게만 대화·파일·업무를 공유합니다.</p></div><button onClick={onClose} disabled={busy}>닫기</button></div>
    <div className={styles.actions}><button aria-pressed={kind==='direct'} onClick={()=>{setKind('direct');setSelected(selected.slice(0,1));}}>1대1 대화</button><button aria-pressed={kind==='group'} onClick={()=>setKind('group')}>단체 대화</button></div>
    <form className={styles.form} onSubmit={async event=>{
      event.preventDefault(); if(pending.current)return; pending.current=true;setBusy(true);setError('');
      try { onOpen(await startCompanyConversation(session,companyId,{kind,name,memberIds:selected})); }
      catch(e){setError(e instanceof Error?e.message:'대화방을 만들지 못했습니다.');}
      finally{pending.current=false;setBusy(false);}
    }}>
      {kind==='group'&&<label>대화방 이름<input autoFocus value={name} onChange={e=>setName(e.target.value)} maxLength={80} required placeholder="예: 영업 주간 업무"/></label>}
      <fieldset className={styles.choices}><legend>{kind==='direct'?'대화할 직원 1명':'함께할 직원'} · 본인은 자동 참여</legend>
        {people.map(m=><label key={m.uid}><input type={kind==='direct'?'radio':'checkbox'} name="conversation-member" value={m.uid} checked={selected.includes(m.uid)} onChange={e=>setSelected(kind==='direct'?[m.uid]:e.target.checked?[...selected,m.uid]:selected.filter(id=>id!==m.uid))}/><span>{m.displayName}<small>{m.email}</small></span></label>)}
        {!people.length&&<p className={styles.hint}>아직 다른 직원이 없습니다. 직원이 초대를 수락하면 여기서 선택할 수 있습니다. 단체 대화방은 본인만 먼저 만들 수 있습니다.</p>}
      </fieldset>
      {error&&<p className={styles.notice} role="alert">{error}</p>}
      <div><button className={styles.primary} disabled={busy||(kind==='direct'?selected.length!==1:!name.trim())}>{busy?'대화방 여는 중…':'대화 시작'}</button></div>
    </form>
  </section>;
}
