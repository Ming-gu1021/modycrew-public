'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDesktopBridge, type ToolchainStatusResult, type ToolchainToolStatus } from '@/lib/desktop-bridge';
import styles from './DevWorkspace.module.css';

type Project = { id: string; name: string; sourceFolder?: string; archivedAt?: number | null };
type Session = { threadId: string; title?: string; projectId?: string; status?: string; archivedAt?: number | null; updatedAt?: number };
type Thread = { id: string; title?: string; updatedAt?: number };
type ResultBundle = { directory: string; projectId: string; location: string; threadId: string; sessionTitle: string; archived: boolean; savedAt: number; files: Array<{ name: string; bytes: number }>; runnable: boolean };
type Overview = { status: string; userMessage?: string; folder?: string; entries?: Array<{ name: string; kind: 'directory' | 'file'; heavy: boolean }>; truncated?: boolean; git?: boolean; packageName?: string; scripts?: Array<{ name: string; command: string }>; readmeName?: string; readme?: string; stacks?: string[]; totalEntries?: number };
type DeliverableBridge = { projectDeliverables?: (payload: unknown) => Promise<{ status: string; userMessage?: string; results?: ResultBundle[] } & Overview> };

const leaf = (value: string) => value.replace(/[\\/]+$/u, '').split(/[\\/]/u).pop() || value;
const when = (ms: number) => ms ? new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const sessionStatus: Record<string, string> = { todo: '할 일', in_progress: '진행 중', waiting: '대기', done: '완료' };

// 설치 앱의 도구 점검 결과에 붙는 추가 정보(구버전 응답에는 없을 수 있어 모두 선택 항목).
type ToolView = ToolchainToolStatus & { optional?: boolean; version?: string; reason?: string; reasonDetail?: string; bundledWithApp?: boolean; bundledPath?: string };
type ToolchainView = ToolchainStatusResult & { bundle?: { expected?: boolean } };
type ToolState = 'ready' | 'pc' | 'problem' | 'missing';
const TOOLCHAIN_TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(value => { window.clearTimeout(timer); resolve(value); }, error => { window.clearTimeout(timer); reject(error); });
  });
}

const toolVersion = (tool: ToolView) => tool.version || /\d+\.\d+(?:\.\d+)?/u.exec(tool.detectedVersion || '')?.[0] || '';

function toolReason(tool: ToolView) {
  switch (tool.reason) {
    case 'exit_code': return tool.reasonDetail ? `오류로 종료(${tool.reasonDetail})` : '오류로 종료';
    case 'blocked': return '보안 프로그램이나 정책이 실행을 막음';
    case 'not_found': return tool.status === 'installed_but_unusable' ? '파일이 사라짐(보안 프로그램 격리 가능)' : '이 PC에서 찾지 못함';
    case 'killed': return '강제로 종료됨';
    case 'spawn_failed': return '실행하지 못함';
    default: return tool.status === 'installed_but_unusable' ? '실행하지 못함' : '이 PC에서 찾지 못함';
  }
}

/** 도구 한 줄 설명: 앱 동봉본은 '앱과 함께 설치됨', PC 설치본은 '이 PC', 없을 때만 이유와 함께 '없음'. */
function describeTool(tool: ToolView): { state: ToolState; text: string; title?: string } {
  const version = toolVersion(tool);
  const suffix = version ? ` · ${version}` : '';
  if (tool.status === 'ready') {
    if (tool.source === 'bundled') return { state: 'ready', text: `앱과 함께 설치됨${suffix}` };
    return { state: 'pc', text: `이 PC${suffix}`, title: tool.command };
  }
  if (tool.reason === 'timeout') return { state: 'problem', text: '확인 시간 초과 · 다시 확인 필요' };
  if (tool.status === 'installed_but_unusable') return { state: 'problem', text: `앱 동봉본 실행 실패 · ${toolReason(tool)}` };
  if (tool.reason === 'bundle_missing') return { state: 'missing', text: '없음 · 설치 파일 손상 가능, 다시 설치 필요' };
  return { state: 'missing', text: `없음 · ${toolReason(tool)}` };
}

/**
 * Development workspace: folder-backed projects, their conversations and the result bundles
 * ModyCrew saved into those folders. Everything shown is read from the installed app; nothing
 * here edits project files.
 */
export default function DevWorkspace() {
  const [bridgeAvailable, setBridgeAvailable] = useState<boolean | null>(null);
  const [root, setRoot] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [results, setResults] = useState<ResultBundle[]>([]);
  const [toolchain, setToolchain] = useState<ToolchainView | null>(null);
  const [toolchainPhase, setToolchainPhase] = useState<'idle' | 'checking' | 'done' | 'failed'>('idle');
  const [toolchainNotice, setToolchainNotice] = useState('');
  const toolchainRun = useRef(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState('');
  const [busyDirectory, setBusyDirectory] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);

  const refresh = useCallback(async () => {
    const bridge = createDesktopBridge();
    if (!bridge.isAvailable) { setBridgeAvailable(false); setLoading(false); return; }
    setBridgeAvailable(true); setLoading(true);
    const problems: string[] = [];
    const memory = await bridge.getLocalMemoryStatus().catch(() => null);
    const workspaceRoot = memory?.root || memory?.defaultRoot || '';
    setRoot(workspaceRoot);
    const [workspace, history] = await Promise.allSettled([bridge.loadWorkSessionWorkspace(workspaceRoot || undefined), bridge.loadChatThreads<Thread>()]);
    if (workspace.status === 'fulfilled' && workspace.value.workspace) {
      setProjects((workspace.value.workspace.projects as Project[]).filter(project => !project.archivedAt));
      setSessions((workspace.value.workspace.sessions as Session[]).filter(session => !session.archivedAt));
    } else { problems.push('프로젝트와 대화 목록을 불러오지 못했습니다.'); setProjects([]); setSessions([]); }
    setThreads(history.status === 'fulfilled' && Array.isArray(history.value.threads) ? history.value.threads : []);
    const deliverables = (window as unknown as { modyCrewDesktopBridge?: DeliverableBridge }).modyCrewDesktopBridge;
    if (workspaceRoot && deliverables?.projectDeliverables) {
      const listed: { status: string; userMessage?: string; results?: ResultBundle[] } = await deliverables.projectDeliverables({ kind: 'list', workspaceRoot }).catch(() => ({ status: 'failed', userMessage: '' }));
      if (listed.status === 'listed' && Array.isArray(listed.results)) setResults(listed.results);
      else { setResults([]); problems.push(listed.userMessage || '저장된 결과 목록을 불러오지 못했습니다. 업데이트된 설치 앱이 필요할 수 있습니다.'); }
    } else { setResults([]); if (workspaceRoot) problems.push('결과 목록은 업데이트된 설치 앱에서 볼 수 있습니다.'); }
    setErrors(problems); setLoading(false);
  }, []);
  useEffect(() => { void refresh(); const onFocus = () => void refresh(); window.addEventListener('focus', onFocus); return () => window.removeEventListener('focus', onFocus); }, [refresh]);

  // 개발 도구 점검은 프로젝트 목록과 따로 돈다. 점검이 늦어도 목록 로딩을 붙잡지 않고, 90초가 지나면 실패로 안내한다.
  const checkToolchain = useCallback(async (mode: 'status' | 'recheck') => {
    const bridge = createDesktopBridge();
    if (!bridge.isAvailable) return;
    const run = ++toolchainRun.current;
    setToolchainPhase('checking');
    if (mode === 'recheck') setToolchainNotice('');
    try {
      const result = await withTimeout(mode === 'recheck' ? bridge.prepareToolchain() : bridge.getToolchainStatus(), TOOLCHAIN_TIMEOUT_MS);
      if (run !== toolchainRun.current) return;
      if (!result || !Array.isArray(result.tools)) throw new Error('unexpected');
      setToolchain(result);
      setToolchainPhase('done');
      if (mode === 'recheck') setToolchainNotice(result.userMessage || '개발 환경을 다시 확인했습니다.');
    } catch (error) {
      if (run !== toolchainRun.current) return;
      setToolchainPhase('failed');
      setToolchainNotice(error instanceof Error && error.message === 'timeout'
        ? `개발 환경 확인이 ${TOOLCHAIN_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다. PC가 바쁠 수 있으니 잠시 후 ‘다시 확인’을 눌러 주세요.`
        : '개발 환경을 확인하지 못했습니다. 앱을 다시 시작한 뒤 ‘다시 확인’을 눌러 주세요.');
    }
  }, []);
  useEffect(() => { void checkToolchain('status'); }, [checkToolchain]);

  const folderProjects = useMemo(() => projects.filter(project => project.sourceFolder), [projects]);
  const selected = folderProjects.find(project => project.id === selectedId) ?? folderProjects[0];
  useEffect(() => {
    setOverview(null);
    const deliverables = (window as unknown as { modyCrewDesktopBridge?: DeliverableBridge }).modyCrewDesktopBridge;
    if (!selected || !root || !deliverables?.projectDeliverables) return;
    let alive = true;
    deliverables.projectDeliverables({ kind: 'project_overview', workspaceRoot: root, projectId: selected.id })
      .then(result => { if (alive) setOverview(result); })
      .catch(() => { if (alive) setOverview({ status: 'failed', userMessage: '폴더 구성을 읽지 못했습니다.' }); });
    return () => { alive = false; };
  }, [selected?.id, root, results]);
  const projectSessions = useMemo(() => sessions.filter(session => session.projectId === selected?.id).map(session => ({ ...session, title: session.title || threads.find(thread => thread.id === session.threadId)?.title || '업무 대화', updatedAt: session.updatedAt || threads.find(thread => thread.id === session.threadId)?.updatedAt || 0 })).sort((left, right) => right.updatedAt - left.updatedAt), [sessions, threads, selected?.id]);
  const projectResults = useMemo(() => results.filter(result => result.projectId === selected?.id), [results, selected?.id]);
  const looseResults = useMemo(() => results.filter(result => !result.projectId), [results]);
  const toolViews = (toolchain?.tools ?? []) as ToolView[];
  const attentionTools = toolViews.filter(tool => tool.status !== 'ready');
  const bundledReadyCount = toolViews.filter(tool => tool.status === 'ready' && tool.source === 'bundled').length;
  const pcReadyCount = toolViews.filter(tool => tool.status === 'ready' && tool.source === 'path').length;
  const needsReinstall = attentionTools.some(tool => tool.reason === 'bundle_missing' || (tool.status === 'installed_but_unusable' && !['timeout', 'blocked'].includes(tool.reason || '')));
  const substitutedTools = toolchain?.bundle?.expected ? toolViews.filter(tool => tool.bundledWithApp && !tool.bundledPath && tool.status === 'ready') : [];
  const checkingTools = toolchainPhase === 'checking';
  const toolchainSummary = !toolchain
    ? (checkingTools || toolchainPhase === 'idle' ? '확인 중…' : '확인하지 못함')
    : !toolViews.length
      ? '도구 정보 없음'
      : attentionTools.length
        ? `${attentionTools.length}개 확인 필요`
        : `기본 도구 ${toolViews.length}개 준비됨${bundledReadyCount ? ` · 앱과 함께 설치 ${bundledReadyCount}` : ''}${pcReadyCount ? ` · 이 PC ${pcReadyCount}` : ''}`;
  const toolchainState = !toolchain ? (checkingTools || toolchainPhase === 'idle' ? 'checking' : 'missing') : !toolViews.length ? 'checking' : attentionTools.length ? 'missing' : 'ready';

  async function act(result: ResultBundle, kind: 'open_result' | 'preview_result', name?: string) {
    const deliverables = (window as unknown as { modyCrewDesktopBridge?: DeliverableBridge }).modyCrewDesktopBridge;
    if (!deliverables?.projectDeliverables || busyDirectory) return;
    setBusyDirectory(result.directory); setNotice('');
    try {
      const response = await deliverables.projectDeliverables({ kind, workspaceRoot: root, directory: result.directory, name });
      if (response.status !== 'opened') setNotice(response.userMessage || '결과를 열지 못했습니다.');
    } catch { setNotice('결과를 열지 못했습니다. 저장 위치를 확인해 주세요.'); }
    finally { setBusyDirectory(''); }
  }

  if (bridgeAvailable === false) return <section className={styles.workspace} aria-label="개발 작업실"><header className={styles.heading}><div><h1>개발 작업실</h1><p>폴더를 연결한 프로젝트에서 코드를 만들고 결과를 실행합니다.</p></div></header><p className={styles.empty}>이 화면은 설치 앱에서 사용할 수 있습니다. 웹에서는 프로젝트 폴더와 저장된 결과에 접근하지 않습니다.</p></section>;

  return <section className={styles.workspace} aria-label="개발 작업실" data-dev-workspace>
    <header className={styles.heading}>
      <div><h1>개발 작업실</h1><p>폴더를 연결한 프로젝트에서 코드를 만들고, 저장된 결과를 열거나 실행합니다. 새 코드는 대화에서 요청하면 프로젝트 폴더 안 ‘ModyCrew 결과’에 저장됩니다.</p></div>
      <div className={styles.quick}><Link href={'/' as Route}>대화로 가기</Link><button type="button" onClick={() => { void refresh(); void checkToolchain('status'); }} disabled={loading}>새로고침</button></div>
    </header>

    <section className={styles.environment} aria-label="개발 환경" data-toolchain-phase={toolchainPhase}>
      <div className={styles.environmentHeading}><h2>개발 환경</h2><span aria-live="polite" data-state={toolchainState}>{toolchainSummary}{toolchain && checkingTools ? ' · 다시 확인 중…' : ''}</span></div>
      {toolViews.length > 0 && <ul className={styles.tools}>{toolViews.map(tool => { const view = describeTool(tool); return <li key={tool.id} data-state={view.state} title={view.title}><strong>{tool.label}</strong><small>{view.text}</small></li>; })}</ul>}
      {needsReinstall && <p role="alert" className={styles.toolchainAlert}>앱과 함께 설치되어야 할 도구가 없거나 실행되지 않습니다. 설치 파일이 손상되었을 수 있으니 최신 ModyCrew 설치파일로 다시 설치해 주세요. 다시 설치해도 내 작업과 설정은 그대로 남습니다.</p>}
      {!needsReinstall && substitutedTools.length > 0 && <p className={styles.muted}>{substitutedTools.map(tool => tool.label).join(', ')}: 앱 동봉본이 없어 이 PC에 설치된 도구로 대신 동작합니다. 최신 설치파일로 업데이트하면 앱 전용 도구가 함께 설치됩니다.</p>}
      <div className={styles.environmentActions}><button type="button" onClick={() => void checkToolchain('recheck')} disabled={checkingTools}>{checkingTools ? '확인 중…' : '다시 확인'}</button><small>Git·Node.js·Python·ripgrep·Codex CLI는 ModyCrew 설치 폴더 안에 앱과 함께 설치되어 앱 작업에만 쓰입니다. 이 PC에 이미 설치된 도구와 전역 설정은 바꾸지 않습니다.</small></div>
      {toolchainNotice && <p role="status" className={styles.alert}>{toolchainNotice}</p>}
    </section>

    {errors.map(error => <p key={error} role="alert" className={styles.alert}>{error}</p>)}
    {notice && <p role="status" className={styles.alert}>{notice}</p>}

    {loading && !folderProjects.length ? <p role="status" className={styles.empty}>프로젝트를 불러오는 중…</p> : !folderProjects.length ? <div className={styles.empty}><strong>폴더를 연결한 프로젝트가 없습니다.</strong><p>대화 화면 왼쪽의 프로젝트에서 ‘＋ 만들기 → 내 PC 폴더 선택’으로 작업 폴더를 연결하면 여기에서 코드 결과를 모아 봅니다.</p><Link href={'/' as Route}>대화 화면 열기</Link></div> : <div className={styles.columns}>
      <nav className={styles.projects} aria-label="개발 프로젝트">
        {folderProjects.map(project => { const count = results.filter(result => result.projectId === project.id).length; return <button type="button" key={project.id} aria-current={project.id === selected?.id ? 'true' : undefined} onClick={() => setSelectedId(project.id)}><strong>{project.name}</strong><small title={project.sourceFolder}>{leaf(project.sourceFolder || '')}</small><small>{sessions.filter(session => session.projectId === project.id).length}개 대화{count ? ` · 결과 ${count}` : ''}</small></button>; })}
        {projects.length > folderProjects.length && <p className={styles.muted}>폴더 없이 만든 프로젝트 {projects.length - folderProjects.length}개는 대화 화면에서 계속 사용할 수 있습니다.</p>}
      </nav>
      {selected && <div className={styles.detail}>
        <header className={styles.detailHeading}><div><h2>{selected.name}</h2><p title={selected.sourceFolder}>{selected.sourceFolder}</p></div>{projectSessions[0] && <Link href={`/?thread=${encodeURIComponent(projectSessions[0].threadId)}` as Route}>최근 대화 이어가기</Link>}</header>
        <section aria-label="폴더 구성" className={styles.structure}>
          <h3>폴더 구성 {overview?.status === 'overview' && <small>{overview.totalEntries}개 항목{overview.git ? ' · Git 저장소' : ''}</small>}</h3>
          {overview?.status === 'overview' ? <>
            {overview.stacks && overview.stacks.length > 0 && <p className={styles.stacks}>{overview.stacks.join(' · ')}{overview.packageName ? ` · ${overview.packageName}` : ''}</p>}
            {overview.scripts && overview.scripts.length > 0 && <dl className={styles.scripts} aria-label="실행 명령">{overview.scripts.map(script => <div key={script.name}><dt>npm run {script.name}</dt><dd>{script.command}</dd></div>)}</dl>}
            <button type="button" className={styles.linkButton} aria-expanded={overviewOpen} onClick={() => setOverviewOpen(value => !value)}>{overviewOpen ? '파일 목록 접기' : `파일 목록 보기 (${overview.entries?.length ?? 0})`}</button>
            {overviewOpen && <ul className={styles.entries}>{(overview.entries ?? []).map(entry => <li key={entry.name} data-kind={entry.kind} data-heavy={entry.heavy}><span aria-hidden="true">{entry.kind === 'directory' ? '▸' : '·'}</span>{entry.name}{entry.heavy ? <small>생성 폴더</small> : null}</li>)}{overview.truncated && <li className={styles.muted}>항목이 많아 80개까지만 표시합니다.</li>}</ul>}
            {overview.readme && <details className={styles.readme}><summary>{overview.readmeName} 앞부분</summary><pre>{overview.readme}</pre></details>}
            <p className={styles.muted}>실행 명령은 참고용입니다. 앱 안에서 자동 실행·미리보기는 아직 제공하지 않습니다.</p>
          </> : overview?.status === 'failed' ? <p role="alert" className={styles.muted}>{overview.userMessage || '폴더 구성을 읽지 못했습니다.'}</p> : <p className={styles.muted}>폴더 구성을 확인하는 중…</p>}
        </section>
        <section aria-label="프로젝트 대화">
          <h3>대화 <small>{projectSessions.length}</small></h3>
          {projectSessions.length ? <ul className={styles.list}>{projectSessions.slice(0, 12).map(session => <li key={session.threadId}><div><strong>{session.title}</strong><small>{sessionStatus[session.status || ''] || session.status || ''}{session.updatedAt ? ` · ${when(session.updatedAt)}` : ''}</small></div><Link href={`/?thread=${encodeURIComponent(session.threadId)}` as Route}>대화 열기</Link></li>)}</ul> : <p className={styles.muted}>이 프로젝트의 대화가 아직 없습니다. 대화 화면의 프로젝트에서 ‘＋ 새 대화’로 시작하세요.</p>}
        </section>
        <section aria-label="저장된 결과">
          <h3>저장된 결과 <small>{projectResults.length}</small></h3>
          {projectResults.length ? <ul className={styles.results}>{projectResults.map(result => <li key={result.directory}>
            <div className={styles.resultHead}><strong>{result.sessionTitle || (result.threadId ? '업무 대화' : '대화 기록 없음')}</strong><small>{when(result.savedAt)}{result.archived ? ' · 보관된 대화' : ''}</small></div>
            <ul className={styles.files}>{result.files.map(file => <li key={file.name}><span aria-hidden="true">▤</span>{file.name}<small>{file.bytes.toLocaleString()} B</small></li>)}</ul>
            <div className={styles.resultActions}><button type="button" disabled={busyDirectory === result.directory} onClick={() => void act(result, 'open_result')}>폴더 열기</button>{result.runnable && <button type="button" disabled={busyDirectory === result.directory} onClick={() => void act(result, 'preview_result', result.files.find(file => file.name.endsWith('.html'))?.name)}>실행</button>}{result.threadId && <Link href={`/?thread=${encodeURIComponent(result.threadId)}` as Route}>대화 보기</Link>}</div>
          </li>)}</ul> : <p className={styles.muted}>저장된 결과가 없습니다. 대화에서 코드를 만들어 달라고 하면 파일로 저장돼 여기에 쌓입니다.</p>}
        </section>
      </div>}
    </div>}
    {looseResults.length > 0 && <details className={styles.loose}><summary>폴더 없는 대화의 결과 {looseResults.length}개 (앱 작업 결과 폴더)</summary><ul className={styles.results}>{looseResults.slice(0, 20).map(result => <li key={result.directory}><div className={styles.resultHead}><strong>{result.sessionTitle || '업무 대화'}</strong><small>{when(result.savedAt)}</small></div><ul className={styles.files}>{result.files.map(file => <li key={file.name}>{file.name}<small>{file.bytes.toLocaleString()} B</small></li>)}</ul><div className={styles.resultActions}><button type="button" disabled={busyDirectory === result.directory} onClick={() => void act(result, 'open_result')}>폴더 열기</button>{result.runnable && <button type="button" disabled={busyDirectory === result.directory} onClick={() => void act(result, 'preview_result', result.files.find(file => file.name.endsWith('.html'))?.name)}>실행</button>}</div></li>)}</ul></details>}
    <p className={styles.footnote}>빌드·테스트 자동 실행과 외부 배포(Vercel·Cloudflare·Supabase 등)는 아직 이 화면에서 제공하지 않습니다. 결과 실행은 네트워크가 차단된 별도 창에서 HTML만 엽니다.</p>
  </section>;
}
