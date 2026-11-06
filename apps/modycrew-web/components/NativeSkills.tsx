"use client";
import { useEffect, useRef, useState } from "react";
import { nativeSkills, type NativeSkill, type NativeSkillRun, type NativeSkillScope } from "@/lib/native-skills";
import styles from "./NativeSkills.module.css";

const states: Record<string, string> = { running: "실행 중", completed: "저장 완료", cancelled: "중지됨", failed: "실행 실패", interrupted: "재시작 후 확인 필요", result_ready: "결과 저장 대기", save_failed: "결과 저장 실패" };
export function NativeSkills({ scope, onSelect, disabled, openRequest = 0, hideTrigger = false }: { scope: NativeSkillScope; onSelect: (skill: NativeSkill) => void; disabled?: boolean; openRequest?: number; hideTrigger?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sequence = useRef(0);
  const [skills, setSkills] = useState<NativeSkill[]>([]);
  const [records, setRecords] = useState<NativeSkillRun[]>([]);
  const [query, setQuery] = useState("");
  const [includeTools, setIncludeTools] = useState(false);
  const [limit, setLimit] = useState(30);
  const [tab, setTab] = useState<"skills" | "records">("skills");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lastOpenRequest = useRef(openRequest);
  useEffect(() => {
    if (lastOpenRequest.current === openRequest) return;
    lastOpenRequest.current = openRequest;
    if (!disabled) { dialog.current?.showModal(); void load("skills"); }
  }, [openRequest]);
  async function load(target: "skills" | "records") {
    const request = ++sequence.current; setTab(target); setBusy(true); setNotice(""); setRecords([]);
    try {
      const result = await nativeSkills({ ...scope, kind: target === "skills" ? "catalog" : "records" });
      if (request !== sequence.current) return;
      if (target === "skills") setSkills(result.skills || []); else setRecords(result.records || []);
      setNotice([result.userMessage, ...(result.warnings || []).slice(0, 3)].join(" "));
    } catch { if (request === sequence.current) setNotice("스킬을 불러오지 못했습니다. 저장된 결과는 보존됩니다. 다시 시도해 주세요."); }
    finally { if (request === sequence.current) setBusy(false); }
  }
  async function action(kind: string, runId: string) {
    setBusy(true);
    try { const result = await nativeSkills({ ...scope, kind, runId }); setNotice(result.userMessage); if (result.status === "completed") await load("records"); }
    catch { setNotice("요청을 완료하지 못했습니다. 기존 결과를 보존했습니다."); }
    finally { setBusy(false); }
  }
  const visible = skills.filter(skill => (includeTools || skill.mode === "instructions") && `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    {!hideTrigger && <button type="button" className={styles.trigger} disabled={disabled} onClick={() => { dialog.current?.showModal(); void load("skills"); }}>스킬</button>}
    <dialog ref={dialog} className={styles.dialog} aria-label="Claude·Codex 스킬" onClose={() => { sequence.current++; setBusy(false); }}>
      <header><h2>Claude·Codex 스킬</h2><button type="button" aria-label="스킬 닫기" onClick={() => dialog.current?.close()}>닫기</button></header>
      <p>이 PC의 개인 작업용 스킬을 채팅에서 사용합니다. 현재는 지침형 텍스트 작업을 실행하고 결과를 저장합니다. 별도 스크립트·MCP·외부 도구, 회사 공유 권한 연동은 추가 준비가 필요합니다.</p>
      <nav className={styles.tabs} aria-label="스킬 보기"><button type="button" aria-pressed={tab === "skills"} onClick={() => void load("skills")}>설치된 스킬</button><button type="button" aria-pressed={tab === "records"} onClick={() => void load("records")}>이 대화의 결과</button><button type="button" disabled={busy} onClick={() => void load(tab)}>새로고침</button></nav>
      {tab === "skills" && <><input aria-label="스킬 검색" placeholder="스킬 이름·역할로 찾기" value={query} onChange={event => { setQuery(event.target.value); setLimit(30); }} /><label><input className={styles.check} type="checkbox" checked={includeTools} onChange={event => { setIncludeTools(event.target.checked); setLimit(30); }} />추가 도구가 필요한 스킬도 보기</label><p>검색 결과 {visible.length}개 · 중복 설치·버전이 포함될 수 있습니다.</p></>}
      <p role="status">{busy ? "확인하고 있습니다…" : notice}</p>
      {tab === "skills" ? <ul className={styles.list}>{visible.slice(0, limit).map(skill => <li key={skill.id}><strong>{skill.name}</strong><small>{skill.source} · {skill.mode === "instructions" ? "지침 적용 가능 · 개별 품질 미검증" : "추가 연결 필요"}</small><p>{skill.description}</p>{skill.compatibility && <small>{skill.compatibility}</small>}{skill.requirements.length > 0 && <small>{skill.requirements.join(" · ")}</small>}<button type="button" disabled={busy || skill.mode !== "instructions"} onClick={() => { onSelect(skill); dialog.current?.close(); }}>채팅에서 사용</button></li>)}</ul>
        : <ul className={styles.list}>{records.map(run => <li key={run.id}><strong>{run.name}</strong><small>{states[run.status] || run.status} · {new Date(run.startedAt).toLocaleString("ko-KR")}</small>{run.userMessage && <p>{run.userMessage}</p>}{run.outputText && <details><summary>결과 보기</summary><pre>{run.outputText}</pre></details>}{run.status === "completed" && <button type="button" disabled={busy} onClick={() => void action("open", run.id)}>저장 파일 열기</button>}{["result_ready", "save_failed"].includes(run.status) && <button type="button" disabled={busy} onClick={() => void action("retry_save", run.id)}>AI 재실행 없이 저장 다시 시도</button>}</li>)}</ul>}
      {!busy && tab === "skills" && !visible.length && <p>표시할 스킬이 없습니다. Claude·Codex에 설치된 스킬을 확인한 뒤 새로고침하세요.</p>}
      {tab === "skills" && visible.length > limit && <button type="button" onClick={() => setLimit(value => value + 30)}>30개 더 보기</button>}
      {!busy && tab === "records" && !records.length && <p>이 대화에서 저장한 스킬 결과가 없습니다.</p>}
    </dialog>
  </>;
}
