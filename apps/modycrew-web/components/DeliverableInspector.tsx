'use client';
import { useEffect, useMemo, useState } from 'react';
import { requestDeliverables } from '@/lib/generated-deliverables';
import { savedFileSummary, type SavedResult } from '@/lib/deliverable-changes';
import { collectConversationChanges, computeLineDiff, maskDiff } from '@/lib/document-viewer';
import DocumentViewer, { DiffView } from './DocumentViewer';
import styles from './DeliverableInspector.module.css';
import WorkspaceIcon from './WorkspaceIcon';

export default function DeliverableInspector({ result }: { result: SavedResult & { selectedName?: string } }) {
  const [selected, setSelected] = useState(result.selectedName || result.files[0]?.name || '');
  useEffect(() => { setSelected(result.selectedName || result.files[0]?.name || ''); }, [result]);
  const [view, setView] = useState<'document' | 'diff'>('document');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const files = savedFileSummary(result);
  const file = files.find(item => item.name === selected);
  const proof = result.receipt.files?.find(item => item.name === selected);
  const totalAdded = files.reduce((sum, item) => sum + item.addedLines, 0);
  // 이번 결과 묶음은 결과 저장소가 새 파일로만 만든다. 그래서 '원본 수정 없음'은 이 묶음 기준으로 정확하다.
  const security = useMemo(() => collectConversationChanges({ threadId: result.scope.threadId, results: [result], modifiedFiles: [] }).security.items.filter(item => item.id === 'original' || item.id === 'location' || item.id === 'sensitive'), [result]);
  const fileName = file?.name;
  const fileContent = file?.content;
  const diff = useMemo(() => (view === 'diff' && typeof fileContent === 'string' ? maskDiff(computeLineDiff('', fileContent)).diff : null), [view, fileContent]);
  async function open(kind: 'open_folder' | 'preview', name?: string) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const receipt = await requestDeliverables(result.scope, result.files, kind, name);
      if (receipt.status !== 'opened') setError(receipt.userMessage || '파일을 열지 못했습니다.');
    } catch { setError('파일을 열지 못했습니다. 저장 위치를 확인해 주세요.'); }
    finally { setBusy(false); }
  }
  return <section className={styles.inspector} aria-label="저장된 결과 파일">
    <header><h2>이번 결과</h2><span>새 파일 {files.length}개</span><strong className={styles.counts} aria-label={`추가 ${totalAdded}줄, 삭제 0줄`}><span className={styles.added}>+{totalAdded.toLocaleString('ko-KR')}</span> <span className={styles.removed}>−0</span></strong></header>
    <p className={styles.hint}>프로젝트 원본을 덮어쓰지 않고 새 파일로 저장한 결과입니다.</p>
    <nav className={styles.files} aria-label="결과 파일 목록">{files.map(item => <button key={item.name} type="button" aria-pressed={selected === item.name} onClick={() => setSelected(item.name)}><WorkspaceIcon name="file" /><span>{item.name}<small>{item.bytes.toLocaleString('ko-KR')} B · 새 파일</small></span><strong className={styles.counts}><span className={styles.added}>+{item.addedLines.toLocaleString('ko-KR')}</span> <span className={styles.removed}>−0</span></strong></button>)}</nav>
    <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void open('open_folder')}>결과 폴더 열기</button>{file?.name.endsWith('.html') && <button type="button" disabled={busy} onClick={() => void open('preview', file.name)}>실행</button>}</div>
    {error && <p role="alert">{error}</p>}
    {file && fileName ? <div className={styles.source}>
      <div className={styles.viewSwitch} role="group" aria-label={`${fileName} 보기 방식`}>
        <button type="button" aria-pressed={view === 'document'} onClick={() => setView('document')}>문서로 보기</button>
        <button type="button" aria-pressed={view === 'diff'} onClick={() => setView('diff')}>바뀐 줄 <span className={styles.added}>+{file.addedLines.toLocaleString('ko-KR')}</span></button>
      </div>
      {view === 'diff' && diff ? <DiffView diff={diff} label={fileName} /> : <DocumentViewer key={fileName} source={{ kind: 'inline', name: fileName, content: file.content, sha256: proof?.sha256, bytes: file.bytes, location: result.receipt.location, directory: result.receipt.directory, isNewFile: true }} />}
    </div> : <p className={styles.empty}>파일을 선택하면 내용을 확인할 수 있습니다.</p>}
    <section className={styles.security} aria-label="이번 결과의 보안 상태"><h3>보안</h3><ul>{security.map(item => <li key={item.id} data-tone={item.tone}><strong>{item.title}</strong><span>{item.detail}</span></li>)}</ul></section>
  </section>;
}
