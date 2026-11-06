'use client';

import { useId, useMemo, useState } from 'react';
import {
  collectConversationChanges, computeLineDiff, formatBytes, inlineFormatForName, maskDiff, maskSensitiveText, outboundStatusLabel,
  type ConversationChangeFile, type ConversationChangesInput, type ConversationSource,
} from '@/lib/document-viewer';
import DocumentViewer, { DiffView } from './DocumentViewer';
import WorkspaceIcon from './WorkspaceIcon';
import styles from './ConversationChangesPanel.module.css';

export type ConversationChangesPanelProps = ConversationChangesInput & {
  /** 데스크톱이 허용 폴더(작업 기억·프로젝트·결과 폴더)를 계산할 업무 저장소 위치. */
  workspaceRoot?: string;
  /** 접힌 상태에서 보여 줄 항목 수. 나머지는 '모두 보기'로 편다. */
  collapsedLimit?: number;
  onClose?: () => void;
};

type FileMode = 'diff' | 'document';
const number = (value: number) => value.toLocaleString('ko-KR');

function defaultMode(file: ConversationChangeFile): FileMode {
  if (file.status === 'modified') return file.beforeMissing ? 'document' : 'diff';
  const syntax = inlineFormatForName(file.name).syntax;
  return syntax === 'code' || syntax === 'json' ? 'diff' : 'document';
}

function sourceIcon(source: ConversationSource) {
  if (source.kind === 'file') return 'file' as const;
  if (source.kind === 'connector' || source.kind === 'web') return 'external' as const;
  if (source.kind === 'memory') return 'pin' as const;
  if (source.kind === 'skill') return 'check' as const;
  return 'code' as const;
}

function FileDiff({ file }: { file: ConversationChangeFile }) {
  const [reveal, setReveal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const raw = useMemo(() => (file.status === 'added' ? computeLineDiff('', file.content ?? '') : typeof file.before === 'string' ? computeLineDiff(file.before, file.content ?? '') : null), [file.status, file.before, file.content]);
  const masked = useMemo(() => (raw ? maskDiff(raw) : null), [raw]);
  if (!raw || !masked) return <p className={styles.note}>이전본 기록이 없어 바뀐 줄을 비교할 수 없습니다. ‘문서로 보기’에서 현재 내용만 확인할 수 있습니다.</p>;
  return <>
    {masked.sensitive.total > 0 ? <div className={styles.reveal}>
      <span>{reveal ? `민감정보 ${masked.sensitive.total}건 표시 중` : `민감정보 ${masked.sensitive.total}건 가림`}</span>
      {reveal ? <button type="button" onClick={() => setReveal(false)}>다시 가리기</button>
        : confirm ? <><button type="button" onClick={() => { setReveal(true); setConfirm(false); }}>원래 값 표시</button><button type="button" onClick={() => setConfirm(false)}>취소</button></>
          : <button type="button" onClick={() => setConfirm(true)}>가린 내용 보기</button>}
    </div> : null}
    <DiffView diff={reveal ? raw : masked.diff} label={file.name} />
  </>;
}

function FileDocument({ file, workspaceRoot }: { file: ConversationChangeFile; workspaceRoot?: string }) {
  if (file.status === 'added' && typeof file.content === 'string') {
    return <DocumentViewer compact source={{ kind: 'inline', name: file.name, content: file.content, sha256: file.sha256, bytes: file.bytes, location: file.location, directory: file.directory, isNewFile: true }} />;
  }
  if (file.path) return <DocumentViewer compact source={{ kind: 'path', path: file.path, workspaceRoot }} />;
  return <DocumentViewer compact source={{ kind: 'inline', name: file.name, content: file.content ?? '', isNewFile: false }} />;
}

   
                                                         
                                                                                       
   
export default function ConversationChangesPanel(props: ConversationChangesPanelProps) {
  const { threadId, projectName, results, modifiedFiles, attachments, tools, outbound, aiDestination, workspaceRoot, collapsedLimit = 5, onClose } = props;
  const model = useMemo(() => collectConversationChanges({ threadId, projectName, results, modifiedFiles, attachments, tools, outbound, aiDestination }), [threadId, projectName, results, modifiedFiles, attachments, tools, outbound, aiDestination]);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const [openFile, setOpenFile] = useState<{ id: string; mode: FileMode } | null>(null);
  const [openSource, setOpenSource] = useState<string | null>(null);
  const ids = useId();
  const visibleFiles = showAllFiles ? model.files : model.files.slice(0, collapsedLimit);
  const visibleSources = showAllSources ? model.sources : model.sources.slice(0, collapsedLimit);
  return <section className={styles.panel} aria-label="이 대화의 변경 사항·소스·보안">
    <header className={styles.header}>
      <div className={styles.heading}>
        <h2 className={styles.project}>{model.projectName || '이 대화'}</h2>
        <p className={styles.subtitle}>만든 파일 {number(model.security.newFiles)}개{model.security.originalFilesModified ? ` · 고친 파일 ${number(model.security.originalFilesModified)}개` : ''}</p>
      </div>
      {onClose ? <button type="button" className={styles.ghost} onClick={onClose} aria-label="변경 사항 패널 닫기">닫기</button> : null}
    </header>

    <section className={styles.section} aria-labelledby={`${ids}-changes`}>
      <div className={styles.sectionHead}>
        <h3 id={`${ids}-changes`}>변경 사항 <span className={styles.totals}><span className={styles.added}>+{number(model.totals.added)}</span> <span className={styles.removed}>−{number(model.totals.removed)}</span></span></h3>
        {model.files.length > collapsedLimit ? <button type="button" className={styles.textButton} aria-expanded={showAllFiles} onClick={() => setShowAllFiles((value) => !value)}>{showAllFiles ? '접기' : `모두 보기 ${model.files.length}`}</button> : null}
      </div>
      {!model.files.length ? <p className={styles.empty}>이 대화에서 만들거나 고친 파일이 아직 없습니다.</p> : <ul className={styles.list}>
        {visibleFiles.map((file) => {
          const open = openFile?.id === file.id;
          const mode = open && openFile ? openFile.mode : defaultMode(file);
          return <li key={file.id} className={styles.item} data-open={open || undefined}>
            <button type="button" className={styles.row} aria-expanded={open} onClick={() => setOpenFile(open ? null : { id: file.id, mode: defaultMode(file) })}>
              <WorkspaceIcon name={inlineFormatForName(file.name).syntax === 'code' ? 'code' : 'file'} size={16} />
              <span className={styles.name}><span>{file.name}</span><small>{file.status === 'added' ? '새 파일' : '고친 파일'}{file.bytes ? ` · ${formatBytes(file.bytes)}` : ''}{file.sensitive.total ? ` · 민감정보 ${file.sensitive.total}건` : ''}</small></span>
              {file.added === null ? <span className={styles.unknown}>이전본 기록 없음</span> : <span className={styles.counts}><span className={styles.added}>+{number(file.added)}</span> <span className={styles.removed}>−{number(file.removed ?? 0)}</span></span>}
              <WorkspaceIcon name="chevron" size={14} className={styles.chevron} />
            </button>
            {open ? <div className={styles.detail}>
              <div className={styles.modes} role="group" aria-label={`${file.name} 보기 방식`}>
                <button type="button" aria-pressed={mode === 'diff'} disabled={file.beforeMissing} title={file.beforeMissing ? '이전본 기록이 없어 비교할 수 없습니다' : undefined} onClick={() => setOpenFile({ id: file.id, mode: 'diff' })}>바뀐 줄</button>
                <button type="button" aria-pressed={mode === 'document'} onClick={() => setOpenFile({ id: file.id, mode: 'document' })}>문서로 보기</button>
              </div>
              {mode === 'diff' ? <FileDiff file={file} /> : <FileDocument file={file} workspaceRoot={workspaceRoot} />}
            </div> : null}
          </li>;
        })}
      </ul>}
      {model.totals.unknownFiles ? <p className={styles.note}>이전본 기록이 없는 {model.totals.unknownFiles}개 파일은 합계에 넣지 않았습니다.</p> : null}
    </section>

    <section className={styles.section} aria-labelledby={`${ids}-sources`}>
      <div className={styles.sectionHead}>
        <h3 id={`${ids}-sources`}>소스 <span className={styles.count}>{model.sources.length}</span></h3>
        {model.sources.length > collapsedLimit ? <button type="button" className={styles.textButton} aria-expanded={showAllSources} onClick={() => setShowAllSources((value) => !value)}>{showAllSources ? '접기' : `모두 보기 ${model.sources.length}`}</button> : null}
      </div>
      {!model.sources.length ? <p className={styles.empty}>이 대화에 첨부하거나 참조한 자료가 없습니다.</p> : <ul className={styles.list}>
        {visibleSources.map((source) => {
          const open = openSource === source.id;
          const label = <>
            <WorkspaceIcon name={sourceIcon(source)} size={16} />
            <span className={styles.name}><span>{source.name}</span>{source.detail || source.bytes ? <small>{[source.detail, source.bytes ? formatBytes(source.bytes) : ''].filter(Boolean).join(' · ')}</small> : null}</span>
          </>;
          return <li key={source.id} className={styles.item} data-open={open || undefined}>
            {source.viewable && source.path
              ? <button type="button" className={styles.row} aria-expanded={open} onClick={() => setOpenSource(open ? null : source.id)}>{label}<span className={styles.hint}>앱에서 보기</span><WorkspaceIcon name="chevron" size={14} className={styles.chevron} /></button>
              : <div className={styles.row} data-static="true">{label}</div>}
            {open && source.path ? <div className={styles.detail}><DocumentViewer compact source={{ kind: 'path', path: source.path, workspaceRoot }} /></div> : null}
          </li>;
        })}
      </ul>}
    </section>

    <section className={styles.section} aria-labelledby={`${ids}-security`}>
      <div className={styles.sectionHead}><h3 id={`${ids}-security`}>보안</h3></div>
      <ul className={styles.security}>
        {model.security.items.map((item) => <li key={item.id} data-tone={item.tone}>
          <span className={styles.dot} aria-hidden="true" />
          <div>
            <strong>{item.title}</strong>
            <p>{item.detail}</p>
            {item.id === 'outbound' && outbound?.length ? <ul className={styles.outbound}>{outbound.map((entry) => <li key={entry.id}>{entry.label}{entry.target ? ` · ${maskSensitiveText(entry.target).text}` : ''} — {outboundStatusLabel(entry.status)}</li>)}</ul> : null}
          </div>
        </li>)}
      </ul>
    </section>
  </section>;
}

