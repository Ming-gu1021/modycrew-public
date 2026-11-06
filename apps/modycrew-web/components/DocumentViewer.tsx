'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  classifyLink, documentAction, formatBytes, hasDocumentViewerBridge, inlineDocumentModel, isDocumentReady, joinDocumentPath, openDocumentInApp,
  parseDelimited, parseMarkdown, pickDocumentInApp, renderPdfPageImage, resolveRelativeDocumentPath, sensitiveSummaryText, splitLines,
  type DocumentBlock, type DocumentContent, type DocumentInline, type DocumentViewerResult, type DocumentViewModel, type InlineDocumentInput,
  type LineDiff, type MdBlock, type MdInline,
} from '@/lib/document-viewer';
import { openWorkBrowserPane } from '@/lib/work-browser';
import { copyLink, openExternalLinkSafely } from '@/lib/desktop-links';
import styles from './DocumentViewer.module.css';

/** 무엇을 보여 줄지: 데스크톱이 확인하는 파일 경로, 이미 화면에 있는 글, 또는 사용자가 고를 파일. */
export type DocumentViewerSource =
  | { kind: 'path'; path: string; workspaceRoot?: string }
  | ({ kind: 'inline' } & Omit<InlineDocumentInput, 'reveal'>)
  | { kind: 'pick'; workspaceRoot?: string };

type OnLink = (href: string) => void;
type LinkRequest = { href: string; kind: 'web' | 'mail' | 'relative'; target?: string };
type TextContent = Extract<DocumentContent, { kind: 'text' }>;
type BlocksContent = Extract<DocumentContent, { kind: 'blocks' }>;
type PdfContent = Extract<DocumentContent, { kind: 'pdf' }>;

const FAILURE_TITLES: Record<string, string> = {
  denied: '열 수 없는 위치예요', not_found: '파일을 찾지 못했어요', too_large: '파일이 너무 커요', protected: '암호가 걸린 문서예요',
  corrupt: '문서를 읽지 못했어요', unsupported: '앱 안에서 볼 수 없는 형식이에요', unsafe: '안전하지 않은 문서 구조예요', timeout: '읽는 시간이 너무 길어요',
  changed: '파일이 바뀌었어요', desktop_required: '데스크톱 앱에서 열 수 있어요', unavailable: '이 화면에서는 쓸 수 없어요',
};
const TEXT_LINE_STEP = 2000;
const BLOCK_STEP = 400;
const PDF_PAGE_STEP = 20;
const LARGE_MARKDOWN = 300_000;
const HEADING_TAGS = ['h3', 'h4', 'h5', 'h6', 'h6', 'h6'] as const;
const headingTag = (level: number) => HEADING_TAGS[Math.min(6, Math.max(1, Math.round(level) || 1)) - 1];

function LinkText({ href, children, onLink }: { href: string; children: ReactNode; onLink?: OnLink }) {
  const kind = classifyLink(href);
  if (kind === 'blocked') return <span className={styles.blockedLink} title="안전하지 않은 주소라 열지 않습니다">{children}</span>;
  if (kind === 'anchor' || !onLink) return <span>{children}</span>;
  return <button type="button" className={styles.link} title={href} onClick={() => onLink(href)}>{children}</button>;
}

function renderMdInline(nodes: MdInline[], onLink?: OnLink): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text': return <Fragment key={index}>{node.text}</Fragment>;
      case 'code': return <code key={index} className={styles.inlineCode}>{node.text}</code>;
      case 'strong': return <strong key={index}>{renderMdInline(node.children, onLink)}</strong>;
      case 'em': return <em key={index}>{renderMdInline(node.children, onLink)}</em>;
      case 'del': return <del key={index}>{renderMdInline(node.children, onLink)}</del>;
      case 'link': return <LinkText key={index} href={node.href} onLink={onLink}>{renderMdInline(node.children, onLink)}</LinkText>;
      case 'image': return <LinkText key={index} href={node.src} onLink={onLink}><span className={styles.imageRef}>[이미지{node.alt ? `: ${node.alt}` : ''}]</span></LinkText>;
      case 'break': return <br key={index} />;
      default: return null;
    }
  });
}

function MarkdownBlocks({ blocks, onLink }: { blocks: MdBlock[]; onLink?: OnLink }) {
  return <>{blocks.map((block, index) => {
    switch (block.type) {
      case 'heading': {
        const Tag = headingTag(block.level);
        return <Tag key={index} className={styles.heading} data-level={block.level}>{renderMdInline(block.children, onLink)}</Tag>;
      }
      case 'paragraph': return <p key={index}>{renderMdInline(block.children, onLink)}</p>;
      case 'code': return <figure key={index} className={styles.codeBlock}>{block.lang ? <figcaption>{block.lang}</figcaption> : null}<pre tabIndex={0}><code>{block.text}</code></pre></figure>;
      case 'quote': return <blockquote key={index}><MarkdownBlocks blocks={block.children} onLink={onLink} /></blockquote>;
      case 'list': {
        const items = block.items.map((item, itemIndex) => {
          const [first, ...rest] = item.children;
          return <li key={itemIndex} data-task={item.checked === null ? undefined : item.checked ? 'done' : 'open'}>
            {item.checked !== null ? <span className={styles.task} role="img" aria-label={item.checked ? '완료한 항목' : '남은 항목'}>{item.checked ? '☑' : '☐'}</span> : null}
            {block.tight && first?.type === 'paragraph' ? <>{renderMdInline(first.children, onLink)}<MarkdownBlocks blocks={rest} onLink={onLink} /></> : <MarkdownBlocks blocks={item.children} onLink={onLink} />}
          </li>;
        });
        return block.ordered ? <ol key={index} start={block.start}>{items}</ol> : <ul key={index}>{items}</ul>;
      }
      case 'table': return <div key={index} className={styles.tableWrap} tabIndex={0}><table>
        <thead><tr>{block.header.map((cell, column) => <th key={column} scope="col" style={{ textAlign: block.align[column] ?? undefined }}>{renderMdInline(cell, onLink)}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column} style={{ textAlign: block.align[column] ?? undefined }}>{renderMdInline(cell, onLink)}</td>)}</tr>)}</tbody>
      </table></div>;
      case 'rule': return <hr key={index} />;
      case 'html': return <figure key={index} className={styles.codeBlock}><figcaption>HTML 원문 · 실행하지 않음</figcaption><pre tabIndex={0}><code>{block.text}</code></pre></figure>;
      default: return null;
    }
  })}</>;
}

function LineNumberedText({ text, label }: { text: string; label: string }) {
  const lines = useMemo(() => splitLines(text), [text]);
  const [limit, setLimit] = useState(TEXT_LINE_STEP);
  useEffect(() => { setLimit(TEXT_LINE_STEP); }, [text]);
  if (!lines.length) return <p className={styles.muted}>내용이 비어 있습니다.</p>;
  return <>
    <pre className={styles.code} tabIndex={0} aria-label={`${label} 파일 내용`}><code>{lines.slice(0, limit).map((line, index) => <span className={styles.line} key={index}><span className={styles.number} aria-hidden="true">{index + 1}</span><span className={styles.lineText}>{line || ' '}</span></span>)}</code></pre>
    {lines.length > limit ? <button type="button" className={styles.more} onClick={() => setLimit((value) => value + TEXT_LINE_STEP)}>{(lines.length - limit).toLocaleString('ko-KR')}줄 더 보기</button> : null}
  </>;
}

function DelimitedTable({ text, delimiter }: { text: string; delimiter: string }) {
  const parsed = useMemo(() => parseDelimited(text, delimiter), [text, delimiter]);
  if (!parsed.rows.length) return <p className={styles.muted}>내용이 비어 있습니다.</p>;
  const [head, ...rows] = parsed.rows;
  const width = Math.max(...parsed.rows.map((row) => row.length));
  return <>
    <div className={styles.tableWrap} tabIndex={0}><table>
      <thead><tr>{Array.from({ length: width }, (_value, column) => <th key={column} scope="col">{head[column] ?? ''}</th>)}</tr></thead>
      <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{Array.from({ length: width }, (_value, column) => <td key={column}>{row[column] ?? ''}</td>)}</tr>)}</tbody>
    </table></div>
    {parsed.truncated ? <p className={styles.muted}>표가 커서 앞부분만 보여 줍니다. 원문에서 전체 내용을 볼 수 있습니다.</p> : null}
  </>;
}

function JsonText({ text, label }: { text: string; label: string }) {
  const [pretty, setPretty] = useState(false);
  const formatted = useMemo(() => {
    if (!pretty) return null;
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return null; }
  }, [pretty, text]);
  return <>
    <div className={styles.tabs} role="group" aria-label="보기 방식"><button type="button" aria-pressed={!pretty} onClick={() => setPretty(false)}>원문</button><button type="button" aria-pressed={pretty} onClick={() => setPretty(true)}>정렬해서 보기</button></div>
    {pretty && formatted === null ? <p className={styles.muted}>JSON 구조를 확인하지 못해 원문으로 보여 줍니다.</p> : null}
    <LineNumberedText text={formatted ?? text} label={label} />
  </>;
}

function TextView({ content, name, onLink }: { content: TextContent; name: string; onLink?: OnLink }) {
  const large = content.text.length > LARGE_MARKDOWN;
  const [mode, setMode] = useState<'rendered' | 'source'>(large && content.syntax === 'markdown' ? 'source' : 'rendered');
  const markdown = useMemo(() => (content.syntax === 'markdown' && mode === 'rendered' ? parseMarkdown(content.text) : null), [content.syntax, content.text, mode]);
  const tabs = content.syntax === 'markdown' || content.syntax === 'csv';
  return <>
    {tabs ? <div className={styles.tabs} role="group" aria-label="보기 방식"><button type="button" aria-pressed={mode === 'rendered'} onClick={() => setMode('rendered')}>{content.syntax === 'csv' ? '표' : '보기'}</button><button type="button" aria-pressed={mode === 'source'} onClick={() => setMode('source')}>원문</button></div> : null}
    {large && content.syntax === 'markdown' && mode === 'source' ? <p className={styles.muted}>문서가 길어 원문으로 먼저 보여 줍니다.</p> : null}
    {markdown ? <div className={styles.markdown}><MarkdownBlocks blocks={markdown} onLink={onLink} /></div>
      : content.syntax === 'csv' && mode === 'rendered' ? <DelimitedTable text={content.text} delimiter={content.delimiter || ','} />
        : content.syntax === 'json' ? <JsonText text={content.text} label={name} />
          : <LineNumberedText text={content.text} label={name} />}
    {content.truncated ? <p className={styles.muted}>파일이 커서 앞부분 {formatBytes(content.shownBytes ?? 0)}만 보여 줍니다.</p> : null}
  </>;
}

function InlineRuns({ runs, onLink }: { runs: DocumentInline[]; onLink?: OnLink }) {
  return <>{runs.map((run, index) => {
    let node: ReactNode = run.text;
    if (run.italic) node = <em>{node}</em>;
    if (run.bold) node = <strong>{node}</strong>;
    return run.href ? <LinkText key={index} href={run.href} onLink={onLink}>{node}</LinkText> : <Fragment key={index}>{node}</Fragment>;
  })}</>;
}

function DocumentBlockView({ block, onLink }: { block: DocumentBlock; onLink?: OnLink }) {
  switch (block.type) {
    case 'heading': {
      const Tag = headingTag(block.level);
      return <Tag className={styles.heading} data-level={block.level}>{block.inlines ? <InlineRuns runs={block.inlines} onLink={onLink} /> : block.text}</Tag>;
    }
    case 'paragraph': return <p className={styles.preWrap}>{block.inlines ? <InlineRuns runs={block.inlines} onLink={onLink} /> : block.text}</p>;
    case 'list': {
      const items = block.items.map((item, index) => <li key={index} className={styles.preWrap} style={item.depth ? { marginInlineStart: `${item.depth * 1.4}em` } : undefined}>{item.inlines ? <InlineRuns runs={item.inlines} onLink={onLink} /> : item.text}</li>);
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case 'table': return <div className={styles.tableWrap} tabIndex={0}><table><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => (rowIndex === 0 && block.rows.length > 1 ? <th key={column} scope="col" className={styles.preWrap}>{cell}</th> : <td key={column} className={styles.preWrap}>{cell}</td>))}</tr>)}</tbody></table></div>;
    case 'image': return <p className={styles.imageRef}>[그림{block.alt ? `: ${block.alt}` : ''}]</p>;
    default: return null;
  }
}

function BlocksView({ content, onLink }: { content: BlocksContent; onLink?: OnLink }) {
  const [limit, setLimit] = useState(BLOCK_STEP);
  return <div className={styles.document}>
    {content.blocks.slice(0, limit).map((block, index) => <DocumentBlockView key={index} block={block} onLink={onLink} />)}
    {content.blocks.length > limit ? <button type="button" className={styles.more} onClick={() => setLimit((value) => value + BLOCK_STEP)}>{(content.blocks.length - limit).toLocaleString('ko-KR')}개 문단 더 보기</button> : null}
    {!content.blocks.length ? <p className={styles.muted}>표시할 글자가 없습니다.</p> : null}
    {content.truncated ? <p className={styles.muted}>문서가 커서 앞부분만 보여 줍니다.</p> : null}
    {content.notes.length ? <ul className={styles.notes}>{content.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
  </div>;
}

type PageImage = { status: 'loading' | 'ready' | 'failed'; dataUrl?: string; message?: string };

function PdfView({ content, path, workspaceRoot, hiddenSensitive }: { content: PdfContent; path?: string; workspaceRoot?: string; hiddenSensitive: number }) {
  const [limit, setLimit] = useState(PDF_PAGE_STEP);
  const [images, setImages] = useState<Record<number, PageImage>>({});
  const [consent, setConsent] = useState(hiddenSensitive === 0);
  const [asking, setAsking] = useState<number | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async (page: number) => {
    if (!path) return;
    setImages((current) => ({ ...current, [page]: { status: 'loading' } }));
    const result = await renderPdfPageImage(path, page, { width: 900, workspaceRoot });
    if (!alive.current) return;
    setImages((current) => ({ ...current, [page]: result.status === 'ready' && result.dataUrl ? { status: 'ready', dataUrl: result.dataUrl } : { status: 'failed', message: result.userMessage } }));
  }, [path, workspaceRoot]);
  useEffect(() => { if (!content.textLayer && path && consent) void load(1); }, [content.textLayer, path, consent, load]);
  const request = (page: number) => { if (consent) void load(page); else setAsking(page); };
  return <div className={styles.pdf}>
    <p className={styles.muted}>총 {content.pageCount.toLocaleString('ko-KR')}쪽{content.truncated ? ` · 앞 ${content.pages.length}쪽만 글자를 읽었습니다` : ''}</p>
    {content.notes.map((note) => <p key={note} className={styles.notice}>{note}</p>)}
    {asking !== null ? <div className={styles.confirm} role="alertdialog" aria-label="페이지 이미지 확인">
      <p>페이지 이미지는 가릴 수 없어, 가려 둔 민감정보 {hiddenSensitive}건이 원본 그대로 보일 수 있습니다.</p>
      <div className={styles.actions}><button type="button" onClick={() => { const page = asking; setConsent(true); setAsking(null); void load(page); }}>그래도 이미지 보기</button><button type="button" onClick={() => setAsking(null)}>취소</button></div>
    </div> : null}
    {content.pages.slice(0, limit).map((page) => {
      const image = images[page.number];
      return <section key={page.number} className={styles.pdfPage} aria-label={`${page.number}쪽`}>
        <div className={styles.pdfPageHead}><h4>{page.number}쪽</h4>{path ? <button type="button" disabled={image?.status === 'loading'} onClick={() => request(page.number)}>{image?.status === 'ready' ? '이미지 다시 그리기' : '페이지 이미지 보기'}</button> : null}</div>
        {image?.status === 'ready' && image.dataUrl ? <img className={styles.pdfImage} src={image.dataUrl} alt={`${page.number}쪽 페이지 이미지`} /> : null}
        {image?.status === 'loading' ? <p className={styles.muted} role="status">페이지를 그리는 중…</p> : null}
        {image?.status === 'failed' ? <p className={styles.notice} role="alert">{image.message}</p> : null}
        {page.text ? <p className={styles.preWrap}>{page.text}</p> : <p className={styles.muted}>이 쪽에는 읽을 수 있는 글자가 없습니다.</p>}
      </section>;
    })}
    {content.pages.length > limit ? <button type="button" className={styles.more} onClick={() => setLimit((value) => value + PDF_PAGE_STEP)}>{content.pages.length - limit}쪽 더 보기</button> : null}
  </div>;
}

function ContentView({ model, path, workspaceRoot, onLink }: { model: DocumentViewModel; path?: string; workspaceRoot?: string; onLink?: OnLink }) {
  const content = model.content;
  const hidden = model.security.sensitive.masked ? model.security.sensitive.total : 0;
  switch (content.kind) {
    case 'text': return <TextView content={content} name={model.file.name} onLink={onLink} />;
    case 'blocks': return <BlocksView content={content} onLink={onLink} />;
    case 'pdf': return <PdfView key={`${model.file.path}:${hidden}`} content={content} path={path} workspaceRoot={workspaceRoot} hiddenSensitive={hidden} />;
    case 'image': return <figure className={styles.imageFrame}><img className={styles.image} src={content.dataUrl} alt={model.file.name} />{content.notes?.map((note) => <figcaption key={note}>{note}</figcaption>)}</figure>;
    default: return <div className={styles.failure}><strong>{FAILURE_TITLES.unsupported}</strong><p>{content.reason}</p></div>;
  }
}

/** 줄 단위 변경 보기(Codex 의 변경 사항처럼 +/−). diff 는 미리 가림 처리한 것을 넘긴다. */
export function DiffView({ diff, label }: { diff: LineDiff; label?: string }) {
  if (diff.identical) return <p className={styles.muted}>바뀐 줄이 없습니다.</p>;
  return <div className={styles.diff} role="region" aria-label={`${label ? `${label} ` : ''}바뀐 줄`}>
    <p className={styles.diffSummary}><span className={styles.added}>+{diff.added.toLocaleString('ko-KR')}</span> <span className={styles.removed}>−{diff.removed.toLocaleString('ko-KR')}</span>{diff.approximate ? <span className={styles.muted}> · 변경이 많아 줄을 맞추지 않고 전체를 바뀐 것으로 보여 줍니다</span> : null}</p>
    {diff.hunks.map((hunk, hunkIndex) => <div key={hunkIndex} className={styles.hunk}>
      <div className={styles.hunkHeader} aria-hidden="true">@@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</div>
      <pre tabIndex={0}><code>{hunk.lines.map((line, index) => <span key={index} className={styles.diffLine} data-type={line.type}>
        <span className={styles.number} aria-hidden="true">{line.oldNumber ?? ''}</span>
        <span className={styles.number} aria-hidden="true">{line.newNumber ?? ''}</span>
        <span className={styles.sign} aria-hidden="true">{line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}</span>
        <span className={styles.lineText}>{line.type !== 'context' ? <span className="sr-only">{line.type === 'add' ? '추가: ' : '삭제: '}</span> : null}{line.text || ' '}</span>
      </span>)}</code></pre>
    </div>)}
    {diff.truncated ? <p className={styles.muted}>바뀐 줄이 많아 앞부분만 보여 줍니다.</p> : null}
  </div>;
}

/** 앱 안 문서 보기. 원본은 읽기만 하고, 민감정보는 기본으로 가리며, 링크는 확인한 뒤에만 연다. */
export default function DocumentViewer({ source, compact = false, onClose }: { source: DocumentViewerSource; compact?: boolean; onClose?: () => void }) {
  const inline = source.kind === 'inline' ? source : null;
  const identity = inline ? `inline:${inline.name}:${inline.sha256 || inline.content.length}:${inline.pending ? 1 : 0}` : source.kind === 'path' ? `path:${source.path}` : 'pick';
  const [seenIdentity, setSeenIdentity] = useState(identity);
  const [reveal, setReveal] = useState(false);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [loaded, setLoaded] = useState<DocumentViewerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickedPath, setPickedPath] = useState('');
  const [relativePath, setRelativePath] = useState('');
  const [notice, setNotice] = useState('');
  const [link, setLink] = useState<LinkRequest | null>(null);
  const [acting, setActing] = useState(false);
  if (seenIdentity !== identity) {
    // 다른 문서로 바뀌면 가림·링크 확인 상태를 처음으로 되돌린다(이전 문서의 '가림 해제'를 넘기지 않는다).
    setSeenIdentity(identity); setReveal(false); setConfirmReveal(false); setLoaded(null); setPickedPath(''); setRelativePath(''); setNotice(''); setLink(null);
  }
  const generation = useRef(0);
  const skipNextLoad = useRef('');
  const workspaceRoot = source.kind === 'inline' ? undefined : source.workspaceRoot;
  const desktopPath = relativePath || (source.kind === 'path' ? source.path : source.kind === 'pick' ? pickedPath : '');
  const savedInlinePath = inline && inline.directory && !inline.pending ? joinDocumentPath(inline.directory, inline.name) : '';
  const actionPath = desktopPath || savedInlinePath;

  const inlineModel = useMemo(() => (inline && !relativePath ? inlineDocumentModel({ name: inline.name, content: inline.content, sha256: inline.sha256, bytes: inline.bytes, location: inline.location, directory: inline.directory, isNewFile: inline.isNewFile, pending: inline.pending, reveal }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inline?.name, inline?.content, inline?.sha256, inline?.bytes, inline?.location, inline?.directory, inline?.isNewFile, inline?.pending, relativePath, reveal]);

  useEffect(() => {
    if (!desktopPath) return;
    // 파일 선택 직후에는 이미 받은 결과를 쓰므로 한 번만 건너뛴다. 표시는 항상 지금의 가림 상태와 맞춘다.
    const skip = skipNextLoad.current === desktopPath && !reveal;
    skipNextLoad.current = '';
    if (skip) return;
    const token = ++generation.current;
    setLoading(true);
    void openDocumentInApp(desktopPath, { workspaceRoot, reveal }).then((result) => { if (token === generation.current) setLoaded(result); })
      .finally(() => { if (token === generation.current) setLoading(false); });
  }, [desktopPath, workspaceRoot, reveal]);

  const model: DocumentViewerResult | null = inlineModel ?? (desktopPath || source.kind === 'pick' ? loaded : null);
  const ready = isDocumentReady(model) ? model : null;
  const file = model?.file;
  const security = model?.security;
  const sensitive = security?.sensitive;

  async function pick() {
    setLoading(true); setNotice('');
    const result = await pickDocumentInApp({ workspaceRoot });
    setLoading(false);
    if (result.status === 'cancelled') { setNotice(result.userMessage); return; }
    // 고른 파일은 열지 못해도(암호·손상) 파일 정보와 '기본 프로그램으로 열기'를 쓸 수 있게 경로를 기억한다.
    const chosenPath = isDocumentReady(result) ? result.file.path : result.file?.path || '';
    generation.current += 1;
    setReveal(false); setConfirmReveal(false); setLoaded(result); setNotice('');
    if (chosenPath) {
      skipNextLoad.current = chosenPath;
      setPickedPath(chosenPath);
    }
  }

  async function act(kind: 'open_external' | 'show_in_folder' | 'open_pdf_viewer') {
    if (!actionPath || acting) return;
    setActing(true); setNotice('');
    const result = await documentAction(kind, actionPath, workspaceRoot);
    setActing(false);
    setNotice(result.userMessage);
  }

  const onLink = useCallback((href: string) => {
    const kind = classifyLink(href);
    setNotice('');
    if (kind === 'web') { setLink({ href, kind }); return; }
    if (kind === 'mail') { setLink({ href, kind }); return; }
    if (kind !== 'relative') return;
    const base = desktopPath || savedInlinePath;
    const target = base ? resolveRelativeDocumentPath(base, href) : null;
    if (target && hasDocumentViewerBridge()) setLink({ href, kind, target });
    else setNotice('이 링크가 가리키는 파일을 앱 안에서 열 수 없습니다.');
  }, [desktopPath, savedInlinePath]);

  const sensitiveTone = !sensitive?.total ? 'safe' : sensitive.masked ? 'notice' : 'warning';
  return <section className={styles.viewer} data-compact={compact || undefined} aria-label={file ? `${file.name} 문서 보기` : '문서 보기'} aria-busy={loading || undefined}>
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <h3 className={styles.title} title={file?.path || undefined}>{file?.name || (source.kind === 'pick' ? '파일 골라 보기' : '문서')}</h3>
        {relativePath ? <button type="button" className={styles.ghost} onClick={() => { setRelativePath(''); setLoaded(null); setReveal(false); setConfirmReveal(false); }}>처음 문서로</button> : null}
        {source.kind === 'pick' && desktopPath ? <button type="button" className={styles.ghost} disabled={loading} onClick={() => void pick()}>다른 파일</button> : null}
        {onClose ? <button type="button" className={styles.ghost} onClick={onClose} aria-label="문서 보기 닫기">닫기</button> : null}
      </div>
      {file ? <p className={styles.meta}>{[file.formatLabel, formatBytes(file.bytes), file.modifiedAt ? new Date(file.modifiedAt).toLocaleString('ko-KR') : ''].filter(Boolean).join(' · ')}</p> : null}
      {security && sensitive ? <ul className={styles.badges} aria-label="보안 상태">
        <li data-tone="safe">{security.isNewFile ? (inline?.pending ? '저장 전 · 원본 덮어쓰기 없음' : '새 파일 · 원본 덮어쓰기 없음') : '읽기 전용 · 원본 변경 없음'}</li>
        <li data-tone={sensitiveTone}>{sensitive.total ? (sensitive.masked ? `민감정보 ${sensitive.total}건 가림` : `민감정보 ${sensitive.total}건 표시 중`) : '민감정보 없음'}</li>
        <li>{security.rootLabel}</li>
        <li data-tone="safe">외부 전송 없음</li>
        {!security.unchangedDuringRead ? <li data-tone="warning">읽는 중 파일이 바뀜</li> : null}
      </ul> : null}
      {ready && sensitive && sensitive.total > 0 ? <div className={styles.revealRow}>
        {sensitive.masked
          ? confirmReveal
            ? <><span>가린 내용({sensitiveSummaryText(sensitive)})을 화면에 표시합니다. 화면 공유 중이면 주의하세요.</span><button type="button" onClick={() => { setReveal(true); setConfirmReveal(false); }}>표시</button><button type="button" onClick={() => setConfirmReveal(false)}>취소</button></>
            : <button type="button" onClick={() => setConfirmReveal(true)}>가린 내용 보기</button>
          : <button type="button" onClick={() => setReveal(false)}>다시 가리기</button>}
      </div> : null}
      {actionPath && (security || model) ? <div className={styles.actions}>
        {ready?.content.kind === 'pdf' && ready.content.viewer.available && desktopPath ? <button type="button" disabled={acting} onClick={() => void act('open_pdf_viewer')}>PDF 창에서 열기</button> : null}
        {desktopPath && security?.canOpenExternally ? <button type="button" disabled={acting} onClick={() => void act('open_external')}>기본 프로그램으로 열기</button> : null}
        {model?.status !== 'denied' && model?.status !== 'not_found' ? <button type="button" disabled={acting} onClick={() => void act('show_in_folder')}>폴더에서 보기</button> : null}
      </div> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    </header>
    {link ? <div className={styles.linkPrompt} role="alertdialog" aria-label="링크 열기 확인">
      <p>{link.kind === 'relative' ? '문서 안 링크가 가리키는 파일을 앱 안에서 엽니다.' : link.kind === 'mail' ? '메일 주소 링크입니다. 메일을 보내지 않고 주소만 복사할 수 있습니다.' : '외부 사이트로 이동합니다. 주소가 맞는지 확인해 주세요.'}</p>
      <code className={styles.linkTarget}>{link.target || link.href}</code>
      <div className={styles.actions}>
        {link.kind === 'web' ? <>
          <button type="button" onClick={() => { openWorkBrowserPane(link.href); setLink(null); }}>앱 안 브라우저로 열기</button>
          <button type="button" onClick={async () => { const target = link.href; setLink(null); const opened = await openExternalLinkSafely(target); setNotice(opened.message); }}>기본 브라우저로 열기</button>
        </> : null}
        {link.kind === 'relative' && link.target ? <button type="button" onClick={() => { setRelativePath(link.target || ''); setLoaded(null); setReveal(false); setConfirmReveal(false); setLink(null); }}>앱에서 열기</button> : null}
        {link.kind !== 'relative' ? <button type="button" onClick={async () => { const value = link.kind === 'mail' ? link.href.replace(/^mailto:/iu, '').split('?')[0] : link.href; setLink(null); setNotice(await copyLink(value) ? '주소를 복사했습니다.' : '주소를 복사하지 못했습니다.'); }}>주소 복사</button> : null}
        <button type="button" onClick={() => setLink(null)}>취소</button>
      </div>
    </div> : null}
    <div className={styles.body}>
      {source.kind === 'pick' && !desktopPath && !loading && !model ? <div className={styles.empty}>
        <p>워드·한글·PDF·마크다운·표·이미지 파일을 골라 앱 안에서 읽기 전용으로 확인하세요. 원본은 바뀌지 않습니다.</p>
        <button type="button" className={styles.primary} onClick={() => void pick()}>파일 고르기</button>
      </div> : null}
      {loading && !ready ? <p className={styles.muted} role="status">문서를 여는 중…</p> : null}
      {model && !ready && !loading ? <div className={styles.failure} role="alert"><strong>{FAILURE_TITLES[model.status] || '문서를 열지 못했어요'}</strong><p>{model.userMessage}</p>{source.kind === 'pick' && !desktopPath ? <button type="button" onClick={() => void pick()}>다시 고르기</button> : null}</div> : null}
      {ready ? <ContentView model={ready} path={desktopPath || undefined} workspaceRoot={workspaceRoot} onLink={onLink} /> : null}
    </div>
    {security && sensitive ? <details className={styles.securityDetails}><summary>보안 정보</summary><dl>
      <dt>원본</dt><dd>{security.isNewFile ? (inline?.pending ? '아직 저장하지 않은 글입니다. 저장할 때도 새 파일로만 만듭니다.' : '새로 만든 파일이며 기존 파일을 덮어쓰지 않았습니다.') : '읽기 전용으로 열었고 앱이 원본을 바꾸지 않았습니다.'}</dd>
      <dt>위치</dt><dd>{security.rootLabel}{security.relativePath ? ` · ${security.relativePath}` : ''}</dd>
      {security.location ? <><dt>저장 폴더</dt><dd>{security.location}</dd></> : null}
      {security.sha256 ? <><dt>파일 지문(SHA-256)</dt><dd><code>{security.sha256}</code></dd></> : null}
      {ready?.content.kind === 'text' ? <><dt>인코딩</dt><dd>{ready.content.encoding}</dd></> : null}
      <dt>민감정보</dt><dd>{sensitive.total ? `${sensitiveSummaryText(sensitive)} · ${sensitive.masked ? '화면에서 가림' : '원래 값 표시 중'}` : '감지하지 못함'} (그림·페이지 이미지 속 글자는 검사하지 않습니다)</dd>
      <dt>외부 전송</dt><dd>문서 보기는 이 컴퓨터 안에서만 읽고, AI나 인터넷으로 보내지 않습니다.</dd>
      {security.notes.map((note, index) => <Fragment key={index}><dt>참고</dt><dd>{note}</dd></Fragment>)}
    </dl></details> : null}
  </section>;
}

/** 문서 보기를 화면 위에 띄운다. Esc·바깥 누르기로 닫고, 닫으면 원래 버튼으로 초점을 돌려준다. */
export function DocumentViewerDialog({ source, onClose, title = '문서 보기' }: { source: DocumentViewerSource; onClose: () => void; title?: string }) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return; }
      if (event.key !== 'Tab' || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], summary, [tabindex]:not([tabindex="-1"])')].filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close.current(); }}>
    <div ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.dialogBar}><strong>{title}</strong><button ref={closeButton} type="button" onClick={() => close.current()} aria-label={`${title} 닫기`}>닫기</button></div>
      <DocumentViewer source={source} />
    </div>
  </div>;
}

