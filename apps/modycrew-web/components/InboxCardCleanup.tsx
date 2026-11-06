"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent, type KeyboardEvent } from "react";
import { createDesktopBridge } from "@/lib/desktop-bridge";
import { cardAccount, cardOriginLabel, dispositionLabels, filterCleanupCards } from "@/lib/inbox-card-disposition";
import type { WorkItem } from "@/lib/types";
import styles from "./InboxCardCleanup.module.css";

type Action = "acknowledged" | "ignored" | "deferred" | "restore" | "restore_batch";
type Pending = { action: Action; ids: string[]; batchId?: string };
type Menu = { x: number; y: number; item: WorkItem };
type Context = { hidden: Set<string>; selected: Set<string>; busy: boolean; supported: boolean; toggle: (id: string) => void; menu: (event: MouseEvent | KeyboardEvent, item: WorkItem) => void; dismiss: (item: WorkItem) => void };
const CleanupContext = createContext<Context | null>(null);
export const useInboxCleanup = () => useContext(CleanupContext);
const statusLabels: Record<string, string> = { needs_review: "검토 필요", approval_pending: "승인 대기", draft_ready: "초안", completed: "완료", held: "보류", rejected: "거절", change_requested: "수정 요청" };
const clock = (value: string) => new Date(value).toLocaleString("ko-KR");

export function InboxCleanupProvider({ children }: { children: (controls: ReactNode) => ReactNode }) {
  const bridge = useMemo(createDesktopBridge, []);
  const [active, setActive] = useState<WorkItem[]>([]);
  const [handled, setHandled] = useState<WorkItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"closed" | "active" | "handled">("closed");
  const [filters, setFilters] = useState({ account: "", date: "", status: "", origin: "" });
  const [limit, setLimit] = useState(100);
  const [pending, setPending] = useState<Pending | null>(null);
  // 방금 치운 묶음 — 알림 옆 '되살리기'로 바로 되돌린다.
  const [lastBatch, setLastBatch] = useState<{ batchId: string; count: number } | null>(null);
  const [context, setContext] = useState<Menu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  const supported = Boolean(bridge.isAvailable && bridge.fetchHandledInbox && bridge.setInboxCardDisposition);
  async function refresh() {
    if (!supported) return;
    const version = ++requestVersion.current;
    try {
      const items = await bridge.fetchInbox();
      const processed = await bridge.fetchHandledInbox!();
      if (!mounted.current || version !== requestVersion.current) return;
      setActive(items); setHandled(processed); setReady(true); setError("");
    } catch { if (mounted.current && version === requestVersion.current) setError("카드 목록을 불러오지 못했어요. 다시 불러오기를 눌러 주세요."); }
  }
  useEffect(() => {
    mounted.current = true; void refresh();
    const unsubscribe = bridge.onInboxChanged?.(() => { if (!inFlight.current) void refresh(); });
    return () => { mounted.current = false; requestVersion.current++; unsubscribe?.(); };
    // The bridge is stable for this mounted office.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);
  function closeMenu() { setContext(null); trigger.current?.focus(); }
  useEffect(() => {
    if (!pending) return;
    confirmationRef.current?.scrollIntoView({ block: "nearest" });
    confirmationRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [pending]);
  useEffect(() => {
    if (!context) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setContext(null); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [context]);
  const hidden = useMemo(() => new Set(handled.map(item => item.id)), [handled]);
  const toggle = (id: string) => { if (!busy) setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  function menu(event: MouseEvent | KeyboardEvent, item: WorkItem) {
    if (!supported || busy) return;
    if ("key" in event && event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault(); event.stopPropagation();
    trigger.current = event.currentTarget as HTMLElement;
    const rect = trigger.current.getBoundingClientRect();
    setContext({ item, x: Math.max(8, Math.min("clientX" in event ? event.clientX : rect.left, window.innerWidth - 240)), y: Math.max(8, Math.min("clientY" in event ? event.clientY : rect.top, window.innerHeight - 240)) });
  }
  const shown = filterCleanupCards(view === "handled" ? handled : active, filters);
  function prepare(action: Action, ids: string[], batchId?: string) { setPending({ action, ids, batchId }); setError(""); closeMenu(); }
  async function run(operation: Pending) {
    if (inFlight.current || !supported) return;
    inFlight.current = true; setBusy(true); requestVersion.current++;
    try {
      const result = await bridge.setInboxCardDisposition!({ action: operation.action, workItemIds: operation.ids, batchId: operation.batchId });
      if (result.status !== "card_disposition_saved") throw new Error("저장이 확인되지 않았습니다. 다시 불러온 뒤 확인해 주세요.");
      if (!mounted.current) return;
      setPending(null); setSelected(new Set());
      const restoring = operation.action.startsWith("restore");
      setLastBatch(!restoring && typeof result.batchId === "string" ? { batchId: result.batchId, count: result.count } : null);
      setNotice(`${result.count}장 ${restoring ? "되살렸어요. 실행하려면 다시 승인해 주세요." : "치웠어요. 발송·등록·원본 삭제는 하지 않았어요."}`);
      await refresh();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "저장하지 못해 기존 상태를 유지했어요."); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function apply() { if (pending) await run(pending); }
  // 상세 화면의 '치우기': 한 장은 확인 없이 바로 치우고(무시), 알림의 '되살리기'로 되돌린다.
  function dismiss(item: WorkItem) { if (!busy) void run({ action: "ignored", ids: [item.id] }); }
  const noiseCards = active.filter(item => item.looksLikeNoise && !hidden.has(item.id));
  function switchView(next: "active" | "handled") { setView(view === next ? "closed" : next); setFilters({ account: "", date: "", status: "", origin: "" }); setLimit(100); setSelected(new Set()); setPending(null); }
  const controls = <div className={styles.root} data-testid="inbox-card-cleanup">
      <div className={styles.toolbar}>
        <button type="button" disabled={!supported || busy} aria-expanded={view === "active"} onClick={() => switchView("active")}>여러 카드 정리{selected.size ? ` · ${selected.size}장 선택` : ""}</button>
        <button type="button" disabled={!supported || busy} aria-expanded={view === "handled"} onClick={() => switchView("handled")}>처리한 카드{ready ? ` · ${handled.length}` : ""}</button>
        {supported && noiseCards.length ? <button type="button" data-inbox-noise-cleanup disabled={busy} onClick={() => prepare("ignored", noiseCards.map(item => item.id))}>광고·알림으로 보이는 카드 {noiseCards.length}장 치우기</button> : null}
        <span>확인함·무시·보류는 실행 없이 목록만 정리해요.</span>
      </div>
      {!supported ? <p>카드 정리는 지원되는 설치 앱에서 사용할 수 있어요.</p> : null}
      {error ? <p role="alert">{error} <button type="button" disabled={busy} onClick={() => void refresh()}>다시 불러오기</button></p> : null}
      {notice ? <p role="status">{notice}{lastBatch ? <> <button type="button" disabled={busy} onClick={() => void run({ action: "restore_batch", ids: ["batch"], batchId: lastBatch.batchId })}>되살리기</button></> : null}</p> : null}
      {pending ? <div ref={confirmationRef} className={styles.confirm} role="group" aria-label="카드 처리 확인" onKeyDown={e => { if (e.key === "Escape" && !busy) { setPending(null); trigger.current?.focus(); } }}>
        <strong>{pending.ids.length}장 {pending.action.startsWith("restore") ? "되살리기" : dispositionLabels[pending.action as keyof typeof dispositionLabels]}</strong>
        <span>{pending.action.startsWith("restore") ? "원래 목록과 상태로 돌아가요. 발송·등록은 다시 승인해야 해요." : "카드와 원본 메일은 보존해요. 승인·발송·일정 등록은 실행하지 않아요."}</span>
        <button type="button" disabled={busy} onClick={() => void apply()}>{busy ? "저장 중…" : "처리 적용"}</button>
        <button type="button" disabled={busy} onClick={() => setPending(null)}>취소</button>
      </div> : null}
      {view !== "closed" ? <section className={styles.panel} aria-label={view === "handled" ? "처리한 카드" : "여러 카드 선택"}>
        <div className={styles.filters}>
          <label>계정<select value={filters.account} disabled={busy} onChange={e => { setFilters({ ...filters, account: e.target.value }); setSelected(new Set()); }}><option value="">전체 계정</option>{[...new Set([...active, ...handled].map(cardAccount))].map(account => <option key={account}>{account}</option>)}</select></label>
          <label>받은 날짜<input type="date" value={filters.date} disabled={busy} onChange={e => { setFilters({ ...filters, date: e.target.value }); setSelected(new Set()); }} /></label>
          <label>상태<select value={filters.status} disabled={busy} onChange={e => { setFilters({ ...filters, status: e.target.value }); setSelected(new Set()); }}><option value="">전체 상태</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>생성 경로<select value={filters.origin} disabled={busy} onChange={e => { setFilters({ ...filters, origin: e.target.value }); setSelected(new Set()); }}><option value="">전체 경로</option>{[...new Set([...active, ...handled].map(cardOriginLabel))].map(origin => <option key={origin}>{origin}</option>)}</select></label>
        </div>
        <div className={styles.toolbar}>
          <label><input type="checkbox" disabled={busy || !shown.length} checked={shown.length > 0 && shown.every(item => selected.has(item.id))} onChange={e => setSelected(e.target.checked ? new Set(shown.map(item => item.id)) : new Set())} />검색된 {shown.length}장 전체 선택</label>
          {(view === "handled" ? ["restore"] as const : ["acknowledged", "ignored", "deferred"] as const).map(action => <button key={action} type="button" disabled={!selected.size || busy} onClick={() => prepare(action, [...selected])}>{action === "restore" ? "선택 되살리기" : dispositionLabels[action]}</button>)}
        </div>
        {!shown.length ? <p>{ready ? view === "handled" ? "처리한 카드가 없어요." : "조건에 맞는 카드가 없어요." : "카드를 불러오는 중…"}</p> : <ul className={styles.cards}>
          {shown.slice(0, limit).map(item => <li key={item.id}>
            <label><input type="checkbox" disabled={busy} checked={selected.has(item.id)} onChange={() => toggle(item.id)} /><span><strong>{item.title}</strong><small>{cardOriginLabel(item)} · {cardAccount(item)} · {statusLabels[item.status] || item.status} · {clock(item.receivedAt)}</small>{item.cardDisposition && view === "handled" ? <small>{dispositionLabels[item.cardDisposition.kind]} · {clock(item.cardDisposition.at)}</small> : null}</span></label>
            {view === "handled" ? <div className={styles.toolbar}><button type="button" disabled={busy} onClick={() => prepare("restore", [item.id])}>되살리기</button><button type="button" disabled={busy} onClick={() => prepare("restore_batch", handled.filter(row => row.cardDisposition?.batchId === item.cardDisposition?.batchId).map(row => row.id), item.cardDisposition?.batchId)}>같이 처리한 묶음 되살리기</button></div> : null}
          </li>)}
        </ul>}
        {shown.length > limit ? <button type="button" onClick={() => setLimit(limit + 100)}>100장 더 보기</button> : null}
      </section> : null}
      {context ? <div ref={menuRef} role="menu" aria-label="카드 정리 메뉴" className={styles.menu} style={{ left: context.x, top: context.y }} onKeyDown={e => {
        if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault(); const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])]; const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
      }}>
        <small>카드만 정리 · 원본 보존</small>
        {(["acknowledged", "ignored", "deferred"] as const).map(action => <button type="button" role="menuitem" key={action} onClick={() => prepare(action, selected.has(context.item.id) ? [...selected] : [context.item.id])}>{dispositionLabels[action]}{selected.has(context.item.id) && selected.size > 1 ? ` · ${selected.size}장` : ""}</button>)}
        <button type="button" role="menuitem" onClick={closeMenu}>닫기</button>
      </div> : null}
    </div>;
  return <CleanupContext.Provider value={{ hidden, selected, busy, supported, toggle, menu, dismiss }}>{children(controls)}</CleanupContext.Provider>;
}

export function InboxCardRowTools({ item }: { item: WorkItem }) {
  const cleanup = useInboxCleanup();
  if (!cleanup?.supported) return null;
  return <div className={styles.rowTools}>
    <label><input type="checkbox" aria-label={`${item.title} 선택`} disabled={cleanup.busy} checked={cleanup.selected.has(item.id)} onChange={() => cleanup.toggle(item.id)} /><span>{cardOriginLabel(item)}</span></label>
    <button type="button" aria-label={`${item.title} 카드 메뉴`} aria-haspopup="menu" disabled={cleanup.busy} onClick={e => cleanup.menu(e, item)}>···</button>
  </div>;
}
