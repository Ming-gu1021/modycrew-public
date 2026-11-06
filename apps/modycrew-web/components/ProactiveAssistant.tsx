"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { DesktopBridgeApi, MailLedgerRow } from "@/lib/desktop-bridge";
import type { MailFocus } from "@/lib/mail-inbox-view";
import {
  buildAssistantBriefing, buildAssistantSuggestions, defaultAssistantPreferences, visibleAssistantSuggestions,
  type AssistantPreferences, type AssistantSuggestion, type SuggestionKind,
} from "@/lib/proactive-assistant";
import { assistantStorageKey, readAssistantPreferences, updateAssistantPreferences } from "@/lib/proactive-assistant-storage";
import { excludeHandledMailRows } from "@/lib/inbox-card-disposition";
import type { WorkItem } from "@/lib/types";
import type { WorkspaceProjectView, WorkspaceSessionView } from "./ProjectWorkspace";
import styles from "./ProactiveAssistant.module.css";

type Props = {
  scope: string;
  name?: string;
  sessions: WorkspaceSessionView[];
  projects: WorkspaceProjectView[];
  bridge?: DesktopBridgeApi | null;
  approvalCount: number;
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  floating?: boolean;
  onOpenSession: (id: string) => void;
  onOpenInbox: (workItemId?: string, kind?: SuggestionKind) => void;
  onRequest: (prompt: string, threadId?: string) => boolean;
  /** 메일 창의 특정 탭(답장 후보·일정 후보·결제·영수증)을 연다. */
  onOpenMail?: (focus: MailFocus) => void;
  /** 메일 원장이 바뀔 때 올라가는 번호. 바뀌면 메일 근거를 다시 읽는다. */
  mailRevision?: number;
};
const labels: Record<SuggestionKind, string> = { deadline: "마감 확인", stalled: "대기 업무", mail: "메일 확인", meeting: "일정 준비", weekly: "주간보고서", approval: "승인 확인", receipt: "영수증 정리" };
/** 마스터크루 창 등 다른 곳에서 같은 제안을 보여 주고 누를 수 있게 하는 창 이벤트. */
export const ASSISTANT_SUGGESTIONS_EVENT = "modycrew-assistant-suggestions";
export const ASSISTANT_ACT_EVENT = "modycrew-assistant-act";
export type AssistantSuggestionSummary = { id: string; kind: SuggestionKind; title: string; reason: string; actionLabel: string };

export default function ProactiveAssistant({ scope, name = "업무 비서", sessions, projects, bridge, approvalCount, loading, error, disabled, floating = false, onOpenSession, onOpenInbox, onRequest, onOpenMail, mailRevision = 0 }: Props) {
  const [preferences, setPreferences] = useState(defaultAssistantPreferences);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [inbox, setInbox] = useState<WorkItem[]>([]);
  const [handledInbox, setHandledInbox] = useState<WorkItem[]>([]);
  const [mailRows, setMailRows] = useState<MailLedgerRow[]>([]);
  const [inboxError, setInboxError] = useState("");
  const [open, setOpen] = useState(!floating);
  const [settings, setSettings] = useState(false);
  const [manual, setManual] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(false);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const panelId = useId();
  const launcher = useRef<HTMLButtonElement>(null);

  function reloadPreferences() {
    try {
      if (!scope) return;
      setPreferences(readAssistantPreferences(window.localStorage.getItem(assistantStorageKey(scope))));
      setStorageError(""); setReady(true);
    } catch {
      setReady(false); setStorageError("AI 비서 설정을 불러오지 못했어요. 기존 기록은 보존했어요.");
    }
  }

  useEffect(() => {
    mounted.current = true;
    reloadPreferences();
    const refresh = () => { setNow(Date.now()); reloadPreferences(); };
    const storage = (event: StorageEvent) => { if (event.key === assistantStorageKey(scope) || event.key === null) refresh(); };
    const localChange = (event: Event) => { if ((event as CustomEvent<{ scope: string }>).detail?.scope === scope) refresh(); };
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") setNow(Date.now()); }, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", storage);
    window.addEventListener("modycrew-assistant-settings-changed", localChange);
    return () => { mounted.current = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("storage", storage); window.removeEventListener("modycrew-assistant-settings-changed", localChange); };
    // scope 변경 시 호출부의 key로 인스턴스 전체를 교체해 이전 회사의 상태를 노출하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    if (!bridge?.isAvailable || loading || error || !scope || !ready || !preferences.enabled) { setInbox([]); setMailRows([]); setHandledInbox([]); return; }
    let alive = true;
    let running = false;
    const refresh = async () => {
      if (!alive || running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const [items, mail, processed] = await Promise.all([
          bridge.fetchInbox(),
          bridge.listMailMessages({ limit: 100 }).catch(() => null),
          bridge.fetchHandledInbox?.() ?? Promise.resolve([]),
        ]);
        const visibleMail = await excludeHandledMailRows(Array.isArray(mail?.messages) ? mail.messages : [], processed);
        if (alive) { setInbox(Array.isArray(items) ? items : []); setHandledInbox(Array.isArray(processed) ? processed : []); setMailRows(visibleMail); setInboxError(""); setNow(Date.now()); }
      } catch {
        if (alive) { setInbox([]); setMailRows([]); setHandledInbox([]); setInboxError("메일·일정 업무함을 확인하지 못했어요. 저장된 업무 기준으로 제안해요."); }
      } finally { running = false; }
    };
    void refresh();
    const visibility = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(() => void refresh(), 60_000);
    const unsubscribe = bridge.onInboxChanged?.(() => void refresh());
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", visibility);
    return () => { alive = false; window.clearInterval(timer); if (typeof unsubscribe === "function") unsubscribe(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("focus", visibility); };
  }, [bridge, scope, loading, error, ready, preferences.enabled, mailRevision]);

  const available = !loading && !error && ready;
  const suggestions = useMemo(() => available ? buildAssistantSuggestions({ sessions, projects, inbox, handledInbox, mailRows, approvalCount, now }) : [], [available, sessions, projects, inbox, handledInbox, mailRows, approvalCount, now]);
  const visible = useMemo(() => visibleAssistantSuggestions(suggestions, preferences, now, manual), [suggestions, preferences, now, manual]);
  const quiet = preferences.quietHours && (new Date(now).getHours() >= 21 || new Date(now).getHours() < 8) && !manual;
  const shown = useMemo(() => quiet ? [] : visible, [quiet, visible]);

  // 마스터크루 창 등에서도 같은 제안을 보이게 알린다(제목·근거만, 메일 원문은 싣지 않는다).
  useEffect(() => {
    const summary: AssistantSuggestionSummary[] = shown.map(({ id, kind, title, reason, actionLabel }) => ({ id, kind, title, reason, actionLabel }));
    window.dispatchEvent(new CustomEvent(ASSISTANT_SUGGESTIONS_EVENT, { detail: { scope, name, suggestions: summary, status: !preferences.enabled ? "off" : quiet ? "quiet" : available ? "ready" : "loading" } }));
  }, [shown, scope, name, preferences.enabled, quiet, available]);

  async function save(change: (current: AssistantPreferences) => AssistantPreferences) {
    if (!ready || saveInFlight.current) return;
    saveInFlight.current = true; setSaving(true);
    try {
      const write = () => updateAssistantPreferences(window.localStorage, scope, change, Date.now());
      const next = navigator.locks ? await navigator.locks.request(assistantStorageKey(scope), write) : write();
      if (mounted.current) { setPreferences(next); setStorageError(""); }
      window.dispatchEvent(new CustomEvent("modycrew-assistant-settings-changed", { detail: { scope } }));
    } catch {
      if (mounted.current) setStorageError("비서 설정을 저장하지 못했어요. 선택을 다시 시도해 주세요.");
    } finally { saveInFlight.current = false; if (mounted.current) setSaving(false); }
  }
  const remember = (suggestion: AssistantSuggestion, until: number, kind: "skipped" | "snoozed" | "used" = "used") => save(current => ({ ...current, decisions: { ...current.decisions, [suggestion.id]: { fingerprint: suggestion.fingerprint, until, kind, at: Date.now() } } }));
  const dismissed = Object.entries(preferences.decisions).filter(([, decision]) => decision.until > now && decision.kind !== "used");
  const act = (suggestion: AssistantSuggestion) => {
    if (!available || disabled) return;
    if (suggestion.mailFocus && onOpenMail) onOpenMail(suggestion.mailFocus);
    else if (suggestion.prompt) { if (!onRequest(suggestion.prompt, suggestion.threadId)) return; }
    else onOpenInbox(suggestion.workItemId, suggestion.kind);
    void remember(suggestion, Date.now() + 60 * 60_000);
    if (floating) setOpen(false);
  };
  const actWithAi = (suggestion: AssistantSuggestion) => {
    if (!available || disabled || !suggestion.prompt) return;
    if (!onRequest(suggestion.prompt, suggestion.threadId)) return;
    void remember(suggestion, Date.now() + 60 * 60_000);
    if (floating) setOpen(false);
  };
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; mode?: "ai" }>).detail;
      const suggestion = detail?.id ? shown.find(item => item.id === detail.id) : undefined;
      if (!suggestion) return;
      if (detail?.mode === "ai") actWithAi(suggestion); else act(suggestion);
    };
    window.addEventListener(ASSISTANT_ACT_EVENT, listener);
    return () => window.removeEventListener(ASSISTANT_ACT_EVENT, listener);
    // act/actWithAi 는 최신 props 를 쓰는 클로저라 shown 이 바뀔 때마다 다시 건다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, available, disabled]);

  const status = !preferences.enabled ? "먼저 제안하기 꺼짐" : loading ? "업무를 불러오는 중" : !available ? "업무 기록 확인 필요" : quiet ? "조용한 시간" : visible.length ? `먼저 확인할 일 ${visible.length}개` : "새로운 제안이 없어요";
  return (
    <aside className={`${styles.assistant} ${floating ? styles.floating : ""}`} aria-label="AI 업무 비서" data-proactive-assistant data-floating={floating} data-open={open} onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); launcher.current?.focus(); } }}>
      <button ref={launcher} className={styles.launcher} type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)} aria-label={floating ? `할 일 ${open ? "접기" : "확인"}${visible.length ? ` · ${visible.length}개` : ''}` : `AI 비서 ${open ? "접기" : "열기"}`} title={status}>
        <span className={styles.dot} data-attention={visible.length > 0} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M6.3 17.7 17.7 6.3" /></svg></span>
        <span><strong>{floating ? '할 일' : name || "업무 비서"}</strong>{!floating && <small>{status}</small>}</span>
        {floating && visible.length > 0 && <span className={styles.count}>{visible.length}</span>}
        <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true"><path d={open ? "m7 14 5-5 5 5" : "m7 10 5 5 5-5"} /></svg>
      </button>
      {open ? <div id={panelId} className={styles.panel}>
        <div className={styles.toolbar}>
          <p>업무 기록을 보고 다음 할 일을 먼저 제안해요.</p>
          <button type="button" onClick={() => setSettings(value => !value)} aria-expanded={settings}>비서 설정</button>
        </div>
        {loading ? <p className={styles.message} role="status">업무를 불러온 뒤 제안할게요.</p> : null}
        {error ? <p className={styles.error} role="alert">업무 기록을 불러오지 못해 제안을 멈췄어요.</p> : null}
        {storageError ? <div className={styles.error} role="alert">{storageError}<button type="button" onClick={reloadPreferences}>다시 불러오기</button></div> : null}
        {inboxError && available ? <p className={styles.message}>{inboxError}</p> : null}
        {settings ? <fieldset className={styles.settings} disabled={!ready || saving}>
          <legend>먼저 제안하기 설정</legend>
          <label><input type="checkbox" checked={preferences.enabled} onChange={event => { const enabled = event.target.checked; void save(current => ({ ...current, enabled })); }} />먼저 제안하기</label>
          <label>제안 개수<select aria-label="비서 제안 개수" value={preferences.frequency} onChange={event => { const frequency = event.target.value as AssistantPreferences["frequency"]; void save(current => ({ ...current, frequency })); }}><option value="normal">한 번에 최대 3개</option><option value="quiet">중요한 제안 1개만</option></select></label>
          <label><input type="checkbox" checked={preferences.quietHours} onChange={event => { const quietHours = event.target.checked; void save(current => ({ ...current, quietHours })); }} />밤 9시~아침 8시에는 조용히 있기</label>
          <div className={styles.categories}>{Object.entries(labels).map(([kind, label]) => <label key={kind}><input type="checkbox" checked={!preferences.disabledKinds.includes(kind as SuggestionKind)} onChange={event => { const enabled = event.target.checked; void save(current => ({ ...current, disabledKinds: enabled ? current.disabledKinds.filter(value => value !== kind) : [...current.disabledKinds, kind as SuggestionKind] })); }} />{label}</label>)}</div>
        </fieldset> : null}
        {available && preferences.enabled && quiet ? <div className={styles.empty}><p>지금은 조용한 시간이에요. 원하면 제안을 확인할 수 있어요.</p><button type="button" onClick={() => setManual(true)}>지금 보기</button></div> : null}
        {visible.length ? <ul className={styles.suggestions} aria-label="비서의 업무 제안">
          {visible.map(suggestion => <li key={suggestion.id} data-assistant-suggestion={suggestion.kind} data-suggestion-id={suggestion.id}>
            <strong>{suggestion.title}</strong><p>{suggestion.reason}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} disabled={disabled || saving} onClick={() => act(suggestion)}>{suggestion.actionLabel}</button>
              {suggestion.mailFocus && suggestion.prompt ? <button type="button" disabled={disabled || saving} onClick={() => actWithAi(suggestion)}>AI로 정리표 만들기</button> : null}
              {suggestion.threadId ? <button type="button" onClick={() => onOpenSession(suggestion.threadId!)}>업무 보기</button> : null}
              <button type="button" disabled={saving} onClick={() => void remember(suggestion, Date.now() + 24 * 60 * 60_000, "snoozed")}>내일 다시</button>
              <button type="button" disabled={saving} onClick={() => void remember(suggestion, Number.MAX_SAFE_INTEGER, "skipped")}>넘기기</button>
            </div>
          </li>)}
        </ul> : available && preferences.enabled && !quiet ? <p className={styles.message}>지금 먼저 확인할 일은 없어요. 새로운 업무가 생기면 다시 제안할게요.</p> : null}
        {!preferences.enabled && ready ? <p className={styles.message}>먼저 제안하기를 껐어요. 비서 설정에서 다시 켤 수 있어요.</p> : null}
        {ready ? <details className={styles.settings}>
          <summary>넘긴 제안 · {dismissed.length}</summary>
          {dismissed.length ? <ul className={styles.suggestions} aria-label="넘긴 제안">
            {dismissed.map(([id, decision]) => <li key={id}>
              <strong>{suggestions.find(item => item.id === id)?.title || "이전 업무 제안"}</strong>
              <p>{decision.until === Number.MAX_SAFE_INTEGER ? "넘기기" : decision.kind === "snoozed" ? "내일 다시" : "이전 숨김"}{decision.at ? ` · ${new Date(decision.at).toLocaleString("ko-KR")}` : ""}</p>
              <button type="button" disabled={saving} onClick={() => void save(current => {
                const decisions = { ...current.decisions }; delete decisions[id]; return { ...current, decisions };
              })}>되살리기</button>
            </li>)}
          </ul> : <p className={styles.message}>넘긴 제안이 없어요.</p>}
          <p className={styles.boundary}>되살리기는 숨김만 해제해요. 현재도 필요한 제안이면 다시 표시돼요.</p>
        </details> : null}
        {visible.length ? <button type="button" className={styles.briefing} disabled={disabled || saving} onClick={() => onRequest(buildAssistantBriefing(visible))}>오늘 브리핑 만들기</button> : null}
        <p className={styles.boundary}>제안을 선택하면 AI가 초안을 준비해요. 발송·일정 등록은 최종 확인 후 실행해요.</p>
      </div> : null}
    </aside>
  );
}
