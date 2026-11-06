"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { describeDocumentFile, documentAction, formatBytes, listDocumentApps, openDocumentWithApp, type DocumentOpenApp, type DocumentFileInfoResult } from "@/lib/document-viewer";
import { extractChatFileReferences, fileReferenceKey, type ChatFileReference } from "@/lib/chat-file-delivery";
import DocumentViewer from "./DocumentViewer";
import WorkspaceIcon from "./WorkspaceIcon";
import styles from "./ChatFileDelivery.module.css";

type Action = "preview" | "open_external" | "open_with" | "show_in_folder" | "save_copy";

export function FileOpenActions({ filePath, workspaceRoot, onPreview, onInfo }: {
  filePath: string; workspaceRoot: string; onPreview: () => void; onInfo?: (info: DocumentFileInfoResult) => void;
}) {
  const [info, setInfo] = useState<DocumentFileInfoResult | null>(null);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const active = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [apps, setApps] = useState<DocumentOpenApp[] | null>(null);
  const [loadingApps, setLoadingApps] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ left: 0, top: 0, maxHeight: 360 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const callback = useRef(onInfo); callback.current = onInfo;
  useEffect(() => {
    let current = true;
    setInfo(null); setNotice(""); setFailed(false); setApps(null); setExpanded(false);
    void describeDocumentFile(filePath, workspaceRoot).then(result => {
      if (current) { setInfo(result); callback.current?.(result); }
    });
    return () => { current = false; };
  }, [filePath, workspaceRoot]);
  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setExpanded(false);
    };
    const closeScroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setExpanded(false); };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", closeScroll);
    window.addEventListener("scroll", closeScroll, true);
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => { document.removeEventListener("pointerdown", closeOutside); window.removeEventListener("resize", closeScroll); window.removeEventListener("scroll", closeScroll, true); };
  }, [expanded]);
  useEffect(() => {
    if (!expanded || !info?.actions?.openWith || apps !== null) return;
    let current = true;
    setLoadingApps(true);
    void listDocumentApps(filePath, workspaceRoot).then(result => {
      if (!current) return;
      setApps(result.apps ?? []);
      if (result.status !== "ready") setNotice(result.userMessage);
    }).finally(() => { if (current) setLoadingApps(false); });
    return () => { current = false; };
  }, [expanded, filePath, workspaceRoot, info, apps]);
  function toggle() {
    if (!trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const above = rect.top > window.innerHeight - rect.bottom;
    setPosition({ left: Math.max(12, Math.min(rect.right - 260, window.innerWidth - 272)), ...(above ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }), maxHeight: Math.max(80, Math.min(360, (above ? rect.top : window.innerHeight - rect.bottom) - 18)) });
    setExpanded(value => !value);
  }
  async function run(action: Action | number) {
    if (active.current || !info?.actions) return;
    setExpanded(false); trigger.current?.focus();
    if (action === "preview") { onPreview(); return; }
    active.current = true; setPending(true); setNotice(""); setFailed(false);
    try {
      const result = typeof action === "number" ? await openDocumentWithApp(filePath, action, workspaceRoot) : await documentAction(action, filePath, workspaceRoot);
      setNotice(result.userMessage);
      setFailed(!["opened", "saved", "cancelled"].includes(result.status));
    } finally { active.current = false; setPending(false); }
  }
  const actions = info?.actions;
  return <span className={styles.actions}>
    <button ref={trigger} type="button" className={styles.trigger} aria-haspopup="menu" aria-expanded={expanded} aria-controls={expanded ? menuId : undefined} disabled={pending || !actions} onClick={toggle} onKeyDown={event => { if (event.key === "ArrowDown" && !expanded) { event.preventDefault(); toggle(); } }}>{pending ? "처리 중…" : "다음에서 열기"}<WorkspaceIcon name="chevron" size={13} style={{ transform: "rotate(90deg)" }} /></button>
    {expanded && createPortal(<div ref={menu} id={menuId} className={styles.menu} role="menu" aria-label="파일 열기 및 저장 방법" style={position} onKeyDown={event => {
      if (event.key === "Escape" || event.key === "Tab") { setExpanded(false); if (event.key === "Escape") { event.preventDefault(); trigger.current?.focus(); } return; }
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length; items[index]?.focus(); }
    }}>
      {actions?.preview && <button role="menuitem" onClick={() => void run("preview")}><WorkspaceIcon name="file" />앱 안에서 보기</button>}
      {loadingApps && apps === null && <span className={styles.loading} role="status">이 PC의 앱 확인 중…</span>}
      {apps?.map(app => <button role="menuitem" key={app.index} onClick={() => void run(app.index)}>{app.icon ? <img src={app.icon} alt="" width={20} height={20} /> : <WorkspaceIcon name="external" />}<span>{app.name}</span></button>)}
      {actions?.openExternal && <button role="menuitem" onClick={() => void run("open_external")}><WorkspaceIcon name="external" />기본 앱</button>}
      {actions?.openWith && <button role="menuitem" onClick={() => void run("open_with")}><WorkspaceIcon name="more" />다른 앱 선택…</button>}
      {actions?.showInFolder && <button role="menuitem" onClick={() => void run("show_in_folder")}><WorkspaceIcon name="folder" />{actions.openWith ? "파일 탐색기에서 보기" : "폴더에서 보기"}</button>}
      {actions?.saveCopy && <button role="menuitem" onClick={() => void run("save_copy")}><WorkspaceIcon name="file" />사본 저장</button>}
    </div>, document.body)}
    {notice ? <small className={styles.notice} role={failed ? "alert" : "status"}>{notice}</small> : info && info.status !== "ready" ? <small className={styles.notice} role="status">{info.userMessage}</small> : null}
  </span>;
}

function FileDeliveryCard({ file, workspaceRoot }: { file: ChatFileReference; workspaceRoot: string }) {
  const [info, setInfo] = useState<DocumentFileInfoResult | null>(null);
  const [preview, setPreview] = useState(false);
  return <article className={styles.card} aria-label={`${file.name} 파일`}>
    <span className={styles.badge} aria-hidden="true">{file.name.split(".").at(-1)?.toUpperCase()}</span>
    <div className={styles.identity}><strong>{file.name}</strong><small>{info?.file ? `${info.file.formatLabel} · ${formatBytes(info.file.bytes)}` : info ? "파일 확인 안 됨" : "파일 확인 중"}</small></div>
    <FileOpenActions filePath={file.path} workspaceRoot={workspaceRoot} onPreview={() => setPreview(value => !value)} onInfo={setInfo} />
    {preview && <div className={styles.preview}><DocumentViewer compact source={{ kind: "path", path: file.path, workspaceRoot }} onClose={() => setPreview(false)} /></div>}
  </article>;
}

export default function ChatFileDelivery({ answer, workspaceRoot, busy, excludePaths }: { answer: string; workspaceRoot: string; busy: boolean; excludePaths?: string[] }) {
  const files = useMemo(() => busy ? [] : extractChatFileReferences(answer).filter(file => !excludePaths?.some(excluded => fileReferenceKey(excluded) === fileReferenceKey(file.path))), [answer, busy, excludePaths]);
  if (!files.length) return null;
  return <section className={styles.files} aria-label="전달받은 파일">{files.map(file => <FileDeliveryCard key={file.path} file={file} workspaceRoot={workspaceRoot} />)}</section>;
}
