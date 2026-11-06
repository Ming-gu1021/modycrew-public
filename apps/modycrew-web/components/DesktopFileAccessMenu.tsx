"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./DesktopFileAccessMenu.module.css";

export type DesktopFileAccessMode = "disabled" | "approval" | "auto";
export type DesktopFileAccess = { mode: DesktopFileAccessMode; revision: string };
const choices: { mode: DesktopFileAccessMode; label: string; detail: string }[] = [
  { mode: "disabled", label: "끄기", detail: "바탕화면을 읽거나 정리하지 않습니다." },
  { mode: "approval", label: "승인 후 정리", detail: "이동할 파일을 확인한 뒤 실행합니다." },
  { mode: "auto", label: "자동 정리", detail: "정리를 요청하면 일반 파일을 종류별로 이동합니다." },
];

export default function DesktopFileAccessMenu({ load, save, onChanged }: {
  load: () => Promise<DesktopFileAccess>;
  save: (mode: DesktopFileAccessMode) => Promise<DesktopFileAccess>;
  onChanged?: () => void;
}) {
  const [access, setAccess] = useState<DesktopFileAccess | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const mounted = useRef(true), busy = useRef(false);
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    loadRef.current().then(value => { if (alive) setAccess(value); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; mounted.current = false; };
  }, []);
  async function change(mode: DesktopFileAccessMode) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    try { const next = await save(mode); if (mounted.current) { setAccess(next); onChanged?.(); } }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "설정을 저장하지 못했습니다."); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  return <section className={styles.access} aria-label="바탕화면 파일 접근 설정">
    <h3>내 PC 파일 접근 <small>바탕화면 · 이 대화</small></h3>
    <div role="group" aria-label="파일 정리 허용 범위">{choices.map(choice => <button type="button" key={choice.mode}
      aria-pressed={access?.mode === choice.mode} disabled={pending || !access} onClick={() => void change(choice.mode)}>
      <span aria-hidden="true">{access?.mode === choice.mode ? "✓" : "○"}</span><span><strong>{choice.label}</strong><small>{choice.detail}</small></span>
    </button>)}</div>
    <p>기존 폴더·바로가기는 유지하며 삭제·덮어쓰기 없이 정리합니다. 화면·다른 앱 조작 권한은 별도입니다.</p>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
