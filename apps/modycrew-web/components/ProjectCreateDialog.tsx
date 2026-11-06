"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import WorkspaceIcon from "./WorkspaceIcon";
import styles from "./ProjectCreateDialog.module.css";

export default function ProjectCreateDialog({ onCreate, onClose }: { onCreate: (name: string, folder?: string) => void | Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const working = useRef(false);
  const alive = useRef(true);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const leaf = (value: string) => value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || value;
  const cloud = /google ?drive|내 드라이브|my drive|onedrive|dropbox|icloud/iu.test(folder);
  useEffect(() => {
    alive.current = true;
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    element?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { alive.current = false; element?.close(); previous?.focus(); };
  }, []);
  async function run(task: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setPending(true); setError("");
    try { await task(); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "프로젝트를 저장하지 못했습니다. 다시 시도해 주세요."); }
    finally { working.current = false; if (alive.current) setPending(false); }
  }
  async function pickFolder() {
    const native = (window as unknown as { modyCrewFiles?: { request: (payload: { kind: string }) => Promise<{ status: string; path?: string; name?: string; userMessage?: string }> } }).modyCrewFiles;
    if (!native) throw new Error("PC 폴더 선택은 설치 앱에서 지원합니다. 웹에서는 앱 저장소로 만들 수 있습니다.");
    const result = await native.request({ kind: "select-project-folder" });
    if (!alive.current) return;
    if (result.status === "selected" && result.path) {
      setFolder(result.path); if (!name.trim() || name === leaf(folder)) setName(result.name || leaf(result.path));
    } else if (/fail|error|denied/u.test(result.status)) throw new Error(result.userMessage || "폴더를 선택하지 못했습니다. 다시 선택해 주세요.");
  }
  function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    void run(async () => { await onCreate(name.trim(), folder || undefined); if (alive.current) onClose(); });
  }
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby="new-project-title" onCancel={event => { event.preventDefault(); if (!working.current) onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget || working.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>
    <form onSubmit={create}>
      <header><h2 id="new-project-title">프로젝트 만들기</h2><button type="button" aria-label="프로젝트 만들기 닫기" disabled={pending} onClick={onClose}><WorkspaceIcon name="close" /></button></header>
      <label className={styles.name}><span className={styles.srOnly}>프로젝트 이름</span><WorkspaceIcon name="folder" size={21} /><input autoFocus value={name} maxLength={80} placeholder="프로젝트 이름" disabled={pending} onChange={event => setName(event.target.value)} required /></label>
      <div className={styles.folderHeading}>소스 폴더</div>
      {folder ? <div className={styles.folderSelected} data-folder-selected><WorkspaceIcon name="folder" size={24} /><div><strong>{leaf(folder)}</strong><small>{folder}</small><small>{cloud ? "클라우드 동기화 폴더 · 동기화 상태는 연결 앱에서 확인" : "내 PC 폴더"}</small></div><button type="button" disabled={pending} aria-label="폴더 선택 해제" onClick={() => setFolder("")}><WorkspaceIcon name="close" /></button></div>
        : <button type="button" className={styles.folderPick} aria-label="내 PC 폴더 선택" disabled={pending} onClick={() => void run(pickFolder)}><WorkspaceIcon name="folder" size={28} /><strong>이 컴퓨터의 폴더 추가</strong><span><WorkspaceIcon name="plus" size={16} /> 폴더 선택</span></button>}
      {folder && <button type="button" className={styles.changeFolder} disabled={pending} onClick={() => void run(pickFolder)}>다른 폴더 선택</button>}
      <p className={styles.hint}>{folder ? "이 폴더에 결과를 저장합니다. 기존 파일은 그대로 유지됩니다." : "폴더 없이 시작하면 앱 저장소에 보관합니다."}</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <footer><button type="button" disabled={pending} onClick={onClose}>취소</button><button type="submit" className={styles.primary} disabled={pending || !name.trim()}>{pending ? "처리 중…" : "프로젝트 만들기"}</button></footer>
    </form>
  </dialog>, document.body);
}
