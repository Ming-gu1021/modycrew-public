"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useAnchoredPopover } from "@/lib/use-anchored-popover";
import BackgroundWorkStatus from "./BackgroundWorkStatus";
import { ASSISTANT_ACT_EVENT, ASSISTANT_SUGGESTIONS_EVENT, type AssistantSuggestionSummary } from "./ProactiveAssistant";
import styles from "./MasterCrewPanel.module.css";

const nameKey = "modycrew-master-name-v1";
type SuggestionFeed = { suggestions: AssistantSuggestionSummary[]; status: "off" | "quiet" | "ready" | "loading" };
export default function MasterCrewPanel({ collapsed }: { collapsed: boolean }) {
  const [name, setName] = useState("마스터크루"), [draft, setDraft] = useState("마스터크루"), [error, setError] = useState("");
  const [feed, setFeed] = useState<SuggestionFeed>({ suggestions: [], status: "loading" });
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const id = `master-${useId().replace(/:/g, "")}`;
  const open = useAnchoredPopover(trigger, panel, "right");
  useEffect(() => { try { const saved = window.localStorage.getItem(nameKey); if (saved?.trim()) { setName(saved); setDraft(saved); } } catch { setError("이름 설정을 읽지 못했습니다. 기존 자료는 보존됩니다."); } }, []);
  useEffect(() => {
    // 업무 비서가 계산한 제안을 그대로 받아 보여 준다. 여기서 따로 판단하지 않는다.
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<Partial<SuggestionFeed>>).detail;
      if (!detail) return;
      setFeed({ suggestions: Array.isArray(detail.suggestions) ? detail.suggestions.slice(0, 5) : [], status: detail.status ?? "ready" });
    };
    window.addEventListener(ASSISTANT_SUGGESTIONS_EVENT, listener);
    return () => window.removeEventListener(ASSISTANT_SUGGESTIONS_EVENT, listener);
  }, []);
  function save(event: FormEvent) { event.preventDefault(); const next = draft.trim(); if (!next) return; try { window.localStorage.setItem(nameKey, next); setName(next); setError(""); } catch { setError("이름을 저장하지 못했습니다. 이전 이름을 유지합니다."); } }
  const act = (suggestion: AssistantSuggestionSummary, mode?: "ai") => { window.dispatchEvent(new CustomEvent(ASSISTANT_ACT_EVENT, { detail: { id: suggestion.id, ...(mode ? { mode } : {}) } })); panel.current?.hidePopover?.(); };
  const count = feed.suggestions.length;
  return <>
    <button ref={trigger} className={styles.trigger} type="button" popoverTarget={id} aria-haspopup="dialog" aria-expanded={open} aria-label={`${name} 열기${count ? ` · 먼저 확인할 일 ${count}개` : ""}`} title={`${name} · 상시 업무${count ? ` · 먼저 확인할 일 ${count}개` : ""}`} data-suggestion-count={count}><span className={styles.mark} aria-hidden="true">✦</span>{!collapsed && <span>{name}<small>{count ? `먼저 확인할 일 ${count}개` : "상시 업무 비서"}</small></span>}{count > 0 && <span className={styles.badge} aria-hidden="true">{count}</span>}</button>
    <div id={id} ref={panel} popover="auto" role="dialog" aria-label="마스터크루 상시 업무" className={styles.panel}>
      <header><div><strong>{name}</strong><p>맡긴 업무와 다음 할 일을 한곳에서</p></div><button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="마스터크루 닫기">×</button></header>
      <section className={styles.suggestions} aria-label="먼저 확인할 일">
        <h3>먼저 확인할 일{count ? ` ${count}개` : ""}</h3>
        {feed.status === "off" ? <p className={styles.note}>먼저 제안하기가 꺼져 있습니다. 홈의 업무 비서 설정에서 켤 수 있습니다.</p>
          : feed.status === "quiet" ? <p className={styles.note}>밤 9시~아침 8시는 조용한 시간입니다. 홈의 업무 비서에서 ‘지금 보기’를 누르면 확인할 수 있습니다.</p>
          : count === 0 ? <p className={styles.note}>{feed.status === "loading" ? "업무와 메일을 확인하고 있습니다." : "지금 먼저 확인할 일은 없습니다. 새 메일·일정·승인이 생기면 여기에 먼저 올립니다."}</p>
          : <ul>{feed.suggestions.map(suggestion => <li key={suggestion.id}><strong>{suggestion.title}</strong><p>{suggestion.reason}</p><div><button type="button" onClick={() => act(suggestion)}>{suggestion.actionLabel}</button>{suggestion.kind === "receipt" && <button type="button" onClick={() => act(suggestion, "ai")}>AI로 정리표 만들기</button>}</div></li>)}</ul>}
      </section>
      {open && <BackgroundWorkStatus />}
      <nav aria-label="마스터크루 업무 연결"><a href="/">대화에서 업무 맡기기</a><a href="/automation/">자동화 규칙 만들기</a><a href="/account/">부족한 연결 설정하기</a></nav>
      <details className={styles.settings}><summary>마스터크루 설정</summary><form onSubmit={save}><label>이 기기에 표시할 이름<input value={draft} maxLength={30} required onChange={event => setDraft(event.target.value)} /></label><button type="submit" disabled={!draft.trim() || draft.trim() === name}>이름 저장</button></form></details>
      {error && <p role="alert">{error}</p>}
      <p className={styles.note}>PC가 꺼진 뒤의 클라우드 실행은 아직 지원하지 않습니다. 24시간 연속 실행은 검증 중입니다.</p>
    </div>
  </>;
}
