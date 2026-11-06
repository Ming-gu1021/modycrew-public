"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { deliverableDescription, extractGeneratedFiles, requestDeliverables, type DeliverableScope, type DeliverableReceipt, type GeneratedFile } from "@/lib/generated-deliverables";
import WorkspaceIcon from "./WorkspaceIcon";
import DocumentViewer from "./DocumentViewer";
import styles from "./ChatDeliverables.module.css";
import { RESULT_PANE_OPEN, RESULT_PANE_CLEAR, resultKey, savedFileSummary } from "@/lib/deliverable-changes";
import ChatFileDelivery, { FileOpenActions } from "./ChatFileDelivery";
import { savedDeliverablePath } from "@/lib/chat-file-delivery";

/** 펼칠 때만 문서 보기를 만든다. 저장 전 글은 '저장 전'으로, 저장된 글은 저장 위치·지문과 함께 보여 주며 민감정보는 기본으로 가린다. */
function FilePreview({ file, receipt, saved }: { file: GeneratedFile; receipt: DeliverableReceipt | null; saved: boolean }) {
  const [open, setOpen] = useState(false);
  const proof = saved ? receipt?.files?.find(item => item.name === file.name) : undefined;
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>내용 보기</summary>{open ? <DocumentViewer compact source={{ kind: "inline", name: file.name, content: file.content, sha256: proof?.sha256, bytes: proof?.bytes, location: saved ? receipt?.location : undefined, directory: saved ? receipt?.directory : undefined, isNewFile: true, pending: !saved }} /> : null}</details>;
}

export default function ChatDeliverables({ request, answer, scope, busy, children, providedFiles, initialReceipt, onSaved, renderText }: { request: string; answer: string; scope: DeliverableScope; busy: boolean; children: ReactNode; providedFiles?: GeneratedFile[]; initialReceipt?: DeliverableReceipt; onSaved?: (files: GeneratedFile[], receipt: DeliverableReceipt) => void; renderText?: (text: string) => ReactNode }) {
  const savedCallback = useRef(onSaved); savedCallback.current = onSaved;
  const files = useMemo(() => providedFiles?.length ? providedFiles : extractGeneratedFiles(request, answer), [request, answer, providedFiles]);
  const [receipt, setReceipt] = useState<DeliverableReceipt | null>(null);
  const [retry, setRetry] = useState(0);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [showAllFiles, setShowAllFiles] = useState(false);
  const { workspaceRoot, threadId, messageId } = scope;
  useEffect(() => () => { window.dispatchEvent(new CustomEvent(RESULT_PANE_CLEAR, { detail: resultKey({ workspaceRoot, threadId, messageId }) })); }, [workspaceRoot, threadId, messageId, answer]);
  useEffect(() => {
    setReceipt(null); setError("");
    if (initialReceipt && (retry === 0 || initialReceipt.status === "saved")) { setReceipt(initialReceipt); return; }
    if (busy || !files.length || !workspaceRoot || !threadId) return;
    let current = true;
    requestDeliverables({ workspaceRoot, threadId, messageId }, files, "save").then(result => {
      if (current) { setReceipt(result); if (result.status === "saved") savedCallback.current?.(files, result); }
    }).catch(() => { if (current) setReceipt({ status: "failed", userMessage: "파일을 저장하지 못했습니다. 답변 원문을 보존했으니 다시 시도해 주세요." }); });
    return () => { current = false; };
  }, [files, busy, workspaceRoot, threadId, messageId, retry, initialReceipt]);
  if (!files.length) {
    const codeStart = answer.search(/```|<!doctype\s+html|<html\b/iu);
    if (busy && codeStart >= 0) {
      const introduction = answer.slice(0, codeStart).trim();
      return <div className={styles.explanation}>
        {introduction && <p>{renderText ? renderText(introduction) : introduction}</p>}
        <p role="status">파일을 작성하고 있습니다…</p>
        <details><summary>작성 중인 코드 보기</summary><pre><code>{answer.slice(codeStart)}</code></pre></details>
      </div>;
    }
    const blocks = busy ? [] : [...answer.matchAll(/```([^\r\n]*)\r?\n([\s\S]*?)(?:\r?\n```|$)/gu)];
    if (!blocks.length) return <>{children}<ChatFileDelivery answer={answer} workspaceRoot={workspaceRoot} busy={busy} /></>;
    let offset = 0; const parts: ReactNode[] = [];
    for (const block of blocks) {
      const prose = answer.slice(offset, block.index).trim();
      if (prose) parts.push(<p key={`text-${offset}`}>{renderText ? renderText(prose) : prose}</p>);
      parts.push(<details key={`code-${block.index}`}><summary>{block[1].trim() ? `${block[1].trim()} · ` : ""}{block[0].endsWith("```") ? "코드 보기" : "미완성 코드 보기"}</summary><pre><code>{block[2]}</code></pre></details>);
      offset = block.index! + block[0].length;
    }
    const remaining = answer.slice(offset).trim();
    if (remaining) parts.push(<p key="remaining">{renderText ? renderText(remaining) : remaining}</p>);
    return <div className={styles.explanation}>{parts}<ChatFileDelivery answer={answer} workspaceRoot={workspaceRoot} busy={busy} /></div>;
  }
  const saved = receipt?.status === "saved";
  const summary = receipt ? savedFileSummary({ scope, files, receipt }) : [];
  const addedLines = summary.reduce((sum, file) => sum + file.addedLines, 0);
  const description = deliverableDescription(answer);
  const visibleFiles = showAllFiles ? files : files.slice(0, 3);
  async function open(kind: "open_folder" | "preview", name?: string) {
    if (action || !saved) return;
    setAction(kind); setError("");
    try {
      const result = await requestDeliverables(scope, files, kind, name);
      if (result.status !== "opened") setError(result.userMessage || "결과를 열지 못했습니다.");
    } catch { setError("결과를 열지 못했습니다. 저장된 파일은 유지됩니다."); }
    finally { setAction(""); }
  }
  return <section className={styles.results} aria-label="만든 파일">
    {description && <div className={styles.description}>{renderText ? renderText(description) : description}</div>}
    <header><strong>{saved ? `파일 ${files.length}개를 저장했습니다` : busy ? "파일을 작성하고 있습니다" : "결과 파일"}</strong>
      {saved && <div className={styles.resultActions}><button type="button" title={`변경 사항: 새 파일 ${summary.length}개, ${addedLines}줄 추가, 삭제 없음`} onClick={() => window.dispatchEvent(new CustomEvent(RESULT_PANE_OPEN, { detail: { scope, files, receipt } }))}>파일 목록 보기 <span className={styles.added}>+{addedLines.toLocaleString("ko-KR")}</span><span style={{ color: "var(--mc-danger-ink, #c22c2c)", fontSize: 12, marginLeft: 4, fontVariantNumeric: "tabular-nums" }}>−0</span></button><button type="button" disabled={Boolean(action)} onClick={() => void open("open_folder")}>결과 폴더 열기</button></div>}
    </header>
    {visibleFiles.map(file => <div className={styles.file} key={file.name}>
      <span className={styles.fileIcon}><WorkspaceIcon name={/\.(md|txt)$/u.test(file.name) ? "file" : "code"} size={21} /></span><div><button type="button" className={styles.fileName} disabled={!saved} onClick={() => window.dispatchEvent(new CustomEvent(RESULT_PANE_OPEN, { detail: { scope, files, receipt, selectedName: file.name } }))}>{file.name}</button><small>{saved ? "저장됨" : "작성된 파일"}{file.name.endsWith(".html") ? " · 브라우저 페이지" : " · 파일"}{summary.find(item => item.name === file.name) ? ` · ${summary.find(item => item.name === file.name)!.bytes.toLocaleString()} B` : ""}</small></div>
      {file.name.endsWith(".html") && <button type="button" disabled={!saved || Boolean(action)} onClick={() => void open("preview", file.name)}>실행</button>}
      {saved && <button type="button" className={styles.fileLocation} aria-label={`${file.name} 파일 위치 열기`} title="파일 위치 열기" disabled={Boolean(action)} onClick={() => void open("open_folder")}><WorkspaceIcon name="folder" size={17} /></button>}
      {saved && savedDeliverablePath(receipt?.directory, file.name) && <FileOpenActions filePath={savedDeliverablePath(receipt?.directory, file.name)!} workspaceRoot={workspaceRoot} onPreview={() => window.dispatchEvent(new CustomEvent(RESULT_PANE_OPEN, { detail: { scope, files, receipt, selectedName: file.name } }))} />}
      <FilePreview file={file} receipt={receipt} saved={saved} />
    </div>)}
    {files.length > 3 && <button type="button" className={styles.moreFiles} aria-expanded={showAllFiles} onClick={() => setShowAllFiles(value => !value)}>{showAllFiles ? "파일 목록 접기" : `${files.length - 3}개 파일 더 보기`} <WorkspaceIcon name="chevron" size={14} style={{ transform: `rotate(${showAllFiles ? -90 : 90}deg)` }} /></button>}
    {!saved && <p role="status">{receipt?.userMessage || (busy ? "답변이 끝나면 파일로 저장합니다." : "파일을 저장하고 있습니다.")}</p>}
    {receipt && !saved && <button type="button" onClick={() => setRetry(value => value + 1)}>저장 다시 시도</button>}
    {saved && <details className={styles.location}><summary>{receipt.location}에 저장됨 · 위치 보기</summary><small>{receipt.directory}</small></details>}
    {saved && !files.some(file => file.name.endsWith(".html")) && <p>소스 파일을 저장했습니다. 이 답변의 빌드·테스트는 아직 실행하지 않았습니다.</p>}
    {error && <p role="alert">{error}</p>}
    <ChatFileDelivery answer={answer} workspaceRoot={workspaceRoot} busy={busy} excludePaths={saved ? files.flatMap(file => { const value = savedDeliverablePath(receipt?.directory, file.name); return value ? [value] : []; }) : undefined} />
    <details className={styles.original}><summary>답변·코드 원문</summary>{children}</details>
  </section>;
}
