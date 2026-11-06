"use client";

import { Fragment, type CSSProperties, type PointerEvent, useEffect, useId, useReducer, useRef, useState } from "react";
import type { OfficeWorkMotion } from "@/lib/office-work-motion";
import { getOfficeRoomCharacter } from "@/lib/office-room-characters";
import { alignOfficeSeats, commitOfficeLayout, defaultOfficeSeat, normalizeOfficeSeat, officeLayoutChangeEvent, officeLayoutStorageKey, readOfficeSeatLayout, sameOfficeLayout, type OfficeSeat, type OfficeSeatLayout } from "@/lib/office-room-layout";
import { createOfficeLayoutHistory, officeDraftKey, officeLayoutHistory, readOfficeLayoutDraft } from "@/lib/office-layout-history";
import { useDisplayPreferences } from "./DisplayPreferences";
import styles from "./OfficeRoom.module.css";
import OfficeWorkBubble from "./OfficeWorkBubble";
import { officeBackgrounds, useOfficeAppearance } from "@/lib/office-appearance";
import { buildOfficeLayoutPreset, officeLayoutPresets, overlappingOfficeSeats, type OfficeLayoutPreset } from "@/lib/office-room-presets";
import { navigateInternalPathKeepingPreview } from "@/lib/safe-navigation";

export type OfficeRoomStatus = "working" | "moving" | "waiting" | "idle" | "done" | "failed" | "unknown" | "offline";
export type OfficeRoomWorker = {
  id: string;
  layoutId?: string;
  name: string;
  role: "mail" | "doc" | "file" | "approval";
  roleLabel?: string;
  avatarId?: string;
  status: OfficeRoomStatus;
  workMotion?: OfficeWorkMotion;
  workMotionUntil?: number;
  task?: string;
};
type Props = {
  workers: OfficeRoomWorker[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onAdd?: () => void;
  addActions?: { id: string; label: string; onSelect: () => void }[];
  notice?: string;
  placementRequest?: { id: string; nonce: number };
};

const statusLabels: Record<OfficeRoomStatus, string> = {
  working: "일하는 중", moving: "정리 중", waiting: "확인 필요", idle: "대기", done: "결과 준비", failed: "실패", unknown: "상태 확인 필요", offline: "쉬는 중",
};
// 상태 요약 순서: 사용자가 손을 써야 하는 상태(확인 필요·실패·상태 확인 필요)를 먼저 보여 준다.
const summaryOrder: OfficeRoomStatus[] = ["waiting", "failed", "unknown", "working", "moving", "done", "idle", "offline"];

function RoomIcon({ kind }: { kind: "pause" | "play" | "plus" | "fold" | "left" | "right" | "up" | "down" | "layout" }) {
  return <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {kind === "pause" ? <path d="M7 5v10M13 5v10" /> : kind === "play" ? <path d="m7 4 8 6-8 6Z" /> : kind === "plus" ? <path d="M10 4v12M4 10h12" /> : kind === "left" ? <path d="m12.5 5-5 5 5 5" /> : kind === "right" ? <path d="m7.5 5 5 5-5 5" /> : kind === "down" ? <path d="m5 7.5 5 5 5-5" /> : kind === "layout" ? <><rect x="3.5" y="3.5" width="5" height="5" rx="1" /><rect x="11.5" y="3.5" width="5" height="5" rx="1" /><path d="M4 14h12M7 11l-3 3 3 3m6-6 3 3-3 3" /></> : <path d="m5 12.5 5-5 5 5" />}
  </svg>;
}

function spritePositionX(worker: OfficeRoomWorker) {
  const character = getOfficeRoomCharacter(worker.avatarId, worker.role);
  return character.column * (100 / 3) + character.offsetX / (1774 * 3 / 4) * 100;
}

export default function OfficeRoom({ workers, selectedId, onSelect, onAdd, addActions, notice, placementRequest }: Props) {
  const matteId = `office-matte-${useId().replace(/:/g, "")}`;
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; pointerId: number; clientX: number; clientY: number; seat: OfficeSeat } | null>(null);
  const [savedLayout, setSavedLayout] = useState<OfficeSeatLayout>({});
  const [history, edit] = useReducer(officeLayoutHistory, undefined, () => createOfficeLayoutHistory());
  const draftLayout = history.present;
  const [editBase, setEditBase] = useState<OfficeSeatLayout>({});
  const [draftReady, setDraftReady] = useState(false);
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [geometry, setGeometry] = useState({ aspect: 2, labels: {} as Record<string, number> });
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState("");
  const [draggingId, setDraggingId] = useState("");
  const [layoutNotice, setLayoutNotice] = useState("");
  const { motion, roomSize, update } = useDisplayPreferences();
  const { background, updateBackground, saveFailed: backgroundSaveFailed } = useOfficeAppearance();
  const [snap, setSnap] = useState(true);
  const backdrop = officeBackgrounds.find(item => item.id === background) ?? officeBackgrounds[0];
  const [bubbleId, setBubbleId] = useState("");
  const [folded, setFolded] = useState(false);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [page, setPage] = useState(0);
  const [roomWidth, setRoomWidth] = useState<number | null>(null);
  const [motionClock, setMotionClock] = useState(() => Date.now());
  useEffect(() => setMotionClock(Date.now()), [workers]);
  useEffect(() => {
    const now = Date.now();
    const deadlines = workers.map(worker => worker.workMotionUntil).filter((value): value is number => typeof value === "number" && value > now);
    if (!deadlines.length) return;
    const timer = window.setTimeout(() => setMotionClock(Date.now()), Math.max(0, Math.min(...deadlines) - now + 1));
    return () => window.clearTimeout(timer);
  }, [workers, motionClock]);
  const displayStatus = (worker: OfficeRoomWorker): OfficeRoomStatus =>
    worker.status === "working" && (!worker.workMotion || worker.workMotionUntil === undefined || motionClock >= worker.workMotionUntil) ? "unknown" : worker.status;
  const displayTask = (worker: OfficeRoomWorker) =>
    worker.status === "working" && displayStatus(worker) === "unknown"
      ? [worker.task ? `마지막 업무 기록: ${worker.task}` : "", "현재 상태를 확인해 주세요."].filter(Boolean).join("\n")
      : worker.task;
  // 모든 크루(다른 페이지에 있는 크루 포함)의 실제 상태를 한 줄로 모은다. 확인이 필요한 상태를 앞에 둔다.
  const statusSummary = summaryOrder
    .map(state => ({ state, count: workers.filter(worker => displayStatus(worker) === state).length }))
    .filter(item => item.count > 0);
  const waitingCount = statusSummary.find(item => item.state === "waiting")?.count ?? 0;
  const smallScreen = roomWidth !== null && roomWidth < 520;
  // Keep six stations only when there is enough room for readable labels.
  const pageSize = smallScreen ? 1 : roomSize === "large" && (roomWidth === null || roomWidth >= 860) ? 6 : 3;
  const pageCount = Math.max(1, Math.ceil(workers.length / pageSize));
  const editIndex = editing ? workers.findIndex(worker => worker.id === editId || worker.layoutId === editId) : -1;
  const currentPage = editIndex >= 0 ? Math.floor(editIndex / pageSize) : Math.min(page, pageCount - 1);
  const shown = workers.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const activeWorker = shown.find(worker => worker.id === editId || worker.layoutId === editId) ?? shown[0];
  const layout = editing ? draftLayout : savedLayout;
  const layoutKey = (id: string) => workers.find(worker => worker.id === id)?.layoutId ?? id;
  const seatFor = (id: string) => {
    const savedSeat = layout[layoutKey(id)];
    const defaultSeat = defaultOfficeSeat(shown.findIndex(worker => worker.id === id), shown.length);
    // Leave saved choices untouched; only new/default three-person layouts use a smaller desk.
    const seat = normalizeOfficeSeat(savedSeat ?? (shown.length <= 3 ? { ...defaultSeat, y: 87, size: 80 } : defaultSeat), smallScreen);
    const label = geometry.labels[id];
    if (label === undefined) return seat;
    const minimumY = (smallScreen ? 34 : 22) * seat.size / 100 * geometry.aspect * .92 + label + 2;
    return { ...seat, y: Math.max(seat.y, Math.min(100, minimumY)) };
  };
  const activeSeat = activeWorker ? seatFor(activeWorker.id) : null;
  const depthOrder = [...shown].sort((a, b) => seatFor(a.id).y - seatFor(b.id).y);
  const dirty = !sameOfficeLayout(editBase, draftLayout);
  const shownIds = shown.map(worker => worker.id).join('|');
  const overlapCount = overlappingOfficeSeats(shown.map(worker => seatFor(worker.id)), geometry.aspect, smallScreen);

  useEffect(() => {
    rootRef.current?.querySelectorAll<HTMLElement>('[data-office-work-bubble]:popover-open').forEach(popup => popup.hidePopover());
    setBubbleId("");
  }, [shownIds]);

  useEffect(() => {
    if (!rootRef.current) return;
    const observer = new ResizeObserver(([entry]) => setRoomWidth(entry.contentRect.width));
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const draft = readOfficeLayoutDraft();
    if (draft && !sameOfficeLayout(draft.base, draft.layout)) {
      setEditBase(draft.base);
      edit({ type: 'load', layout: draft.layout });
      setEditId(draft.selectedId);
      setEditing(true);
      setLayoutNotice('저장 전 배치를 복원했어요. 이어서 편집하거나 취소할 수 있어요.');
    }
    setDraftReady(true);
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    try {
      if (editing && dirty) sessionStorage.setItem(officeDraftKey, JSON.stringify({ version: 1, base: editBase, layout: draftLayout, selectedId: layoutKey(editId) }));
      else sessionStorage.removeItem(officeDraftKey);
      setDraftSaveFailed(false);
    } catch { setDraftSaveFailed(true); }
  }, [draftReady, editing, dirty, editBase, draftLayout, editId]);

  useEffect(() => {
    if (!editing || !dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [editing, dirty]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || folded) return;
    const labels = [...canvas.querySelectorAll<HTMLElement>('[data-office-nameplate]')];
    const measure = () => {
      const box = canvas.getBoundingClientRect();
      if (!box.height) return;
      const next = { aspect: box.width / box.height, labels: Object.fromEntries(labels.map(label => [label.parentElement!.dataset.officeSceneWorker!, label.getBoundingClientRect().height / box.height * 100])) };
      setGeometry(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    labels.forEach(label => observer.observe(label));
    measure();
    return () => observer.disconnect();
  }, [shownIds, folded, smallScreen]);

  useEffect(() => {
    const sync = () => setSavedLayout(readOfficeSeatLayout());
    const onStorage = (event: StorageEvent) => { if (event.key === officeLayoutStorageKey || event.key === null) sync(); };
    sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener(officeLayoutChangeEvent, sync);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(officeLayoutChangeEvent, sync); };
  }, []);

  const changeSeat = (id: string, patch: Partial<OfficeSeat>) => {
    const fallback = seatFor(id);
    const key = layoutKey(id);
    const next = { ...fallback, ...patch };
    if (snap && patch.x !== undefined) next.x = Math.round(next.x / 2) * 2;
    if (snap && patch.y !== undefined) next.y = Math.round(next.y / 2) * 2;
    edit({ type: 'seat', id: key, seat: normalizeOfficeSeat(next, smallScreen) });
    setLayoutNotice('');
  };
  const startDrag = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (!editing || saving || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    edit({ type: 'begin' });
    drag.current = { id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, seat: seatFor(id) };
    setEditId(id);
    setDraggingId(id);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!current || current.pointerId !== event.pointerId || !rect?.width || !rect.height) return;
    changeSeat(current.id, { x: current.seat.x + (event.clientX - current.clientX) / rect.width * 100, y: current.seat.y + (event.clientY - current.clientY) / rect.height * 100 });
  };
  const endDrag = () => { drag.current = null; setDraggingId(""); edit({ type: 'end' }); };
  const beginEditing = (workerId = shown[0]?.id ?? '') => {
    setBubbleId("");
    const latest = readOfficeSeatLayout();
    setSavedLayout(latest); setEditBase(latest); edit({ type: 'load', layout: latest });
    setEditId(workerId); setFolded(false); setLayoutNotice(''); setConflict(false); setEditing(true);
  };
  useEffect(() => {
    if (placementRequest && workers.some(worker => worker.id === placementRequest.id)) beginEditing(placementRequest.id);
  }, [placementRequest]);
  const saveLayout = async () => {
    if (saving) return;
    setSaving(true);
    const result = await commitOfficeLayout(editBase, draftLayout);
    setSaving(false);
    if (result.status === 'conflict') {
      setConflict(true);
      setLayoutNotice('다른 창에서 같은 크루의 자리가 바뀌었어요. 최신 배치로 다시 편집해 주세요.');
      return;
    }
    if (result.status === 'saved') {
      setPage(currentPage); setSavedLayout(result.layout); setEditing(false); setConflict(false); setLayoutNotice('자리 배치를 저장했어요.');
    } else setLayoutNotice(result.status === 'unavailable' ? '안전한 저장 기능을 사용할 수 없어요. 설치 앱 또는 보안 연결된 웹에서 다시 열어 주세요.' : '저장하지 못했어요. 다시 저장해 주세요.');
  };
  const alignShown = () => {
    const next = { ...draftLayout };
    if (shown.length > 3) {
      edit({ type: 'replace', layout: { ...next, ...buildOfficeLayoutPreset(shown.map(worker => layoutKey(worker.id)), 'together', smallScreen) } });
      setLayoutNotice('모든 크루가 보이도록 두 줄로 정리했어요.');
      return;
    }
    alignOfficeSeats(shown.map(worker => seatFor(worker.id)), smallScreen).forEach((seat, index) => { next[layoutKey(shown[index].id)] = seat; });
    edit({ type: 'replace', layout: next }); setLayoutNotice('현재 보이는 크루를 크기 그대로 정렬했어요.');
  };
  const applyPreset = (preset: OfficeLayoutPreset) => {
    const arranged = buildOfficeLayoutPreset(shown.map(worker => layoutKey(worker.id)), preset, smallScreen);
    edit({ type: 'replace', layout: { ...draftLayout, ...arranged } });
    setLayoutNotice(`${officeLayoutPresets.find(item => item.id === preset)?.label} 배치를 미리 보고 있어요. 마음에 들면 저장해 주세요.`);
  };
  const turnPage = (next: number) => {
    setBubbleId("");
    setPage(next);
    if (editing) setEditId(workers[next * pageSize]?.id ?? '');
  };

  useEffect(() => {
    try { setFolded(localStorage.getItem("modycrew-office-room-fold-v1") === "folded" && !readOfficeLayoutDraft()); } catch { /* Optional preference. */ }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => setReduced(query.matches);
    onMotion();
    query.addEventListener("change", onMotion);
    let intersecting = true;
    const refreshVisibility = () => setVisible(intersecting && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; refreshVisibility(); });
    if (rootRef.current) observer.observe(rootRef.current);
    document.addEventListener("visibilitychange", refreshVisibility);
    refreshVisibility();
    return () => { observer.disconnect(); query.removeEventListener("change", onMotion); document.removeEventListener("visibilitychange", refreshVisibility); };
  }, []);

  return (
    <section ref={rootRef} className={styles.room} aria-label="크루 사무실" data-office-room="soft-3d" data-office-background={background} data-capacity={pageSize} data-motion={motion && visible && !reduced && !folded && !editing ? "playing" : "paused"} data-folded={folded} data-editing={editing} style={{ "--sprite-filter": `url(#${matteId})` } as CSSProperties}>
      {/* Chroma-key the backdrop while preserving white clothes, faces and desk details. */}
      <svg className={styles.filterDefinitions} aria-hidden="true" focusable="false">
        <defs><filter id={matteId} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -5 12 -5 3 0" />
        </filter></defs>
      </svg>
      <header className={styles.header}>
        <h2>우리 크루의 사무실 <span className={styles.crewCount}>{workers.length}명</span></h2>
        <div className={styles.tools}>
          {notice ? <span className={styles.notice} role="status">{notice}</span> : null}
          <button type="button" aria-label={motion ? "캐릭터 움직임 멈추기" : "캐릭터 움직임 켜기"} aria-pressed={!motion} onClick={() => update({ motion: !motion })} title={motion ? "움직임 멈추기" : "움직임 켜기"}><RoomIcon kind={motion ? "pause" : "play"} /></button>
          {workers.length ? <button type="button" aria-label="자리 배치와 크기 조절" aria-pressed={editing} disabled={editing} onClick={() => beginEditing()}><RoomIcon kind="layout" /><span>사무실 꾸미기</span></button> : null}
          {addActions?.length ? <details className={styles.addMenu}>
            <summary><RoomIcon kind="plus" /><span>크루 추가</span></summary>
            <div>{addActions.map((action) => <button key={action.id} type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); action.onSelect(); }}>{action.label}</button>)}</div>
          </details> : onAdd ? <button type="button" className={styles.addButton} onClick={onAdd}><RoomIcon kind="plus" /><span>크루 추가</span></button> : null}
          <button type="button" disabled={editing} aria-label={folded ? "사무실 펼치기" : "사무실 접기"} aria-expanded={!folded} onClick={() => { const next = !folded; setBubbleId(""); setFolded(next); try { localStorage.setItem("modycrew-office-room-fold-v1", next ? "folded" : "open"); } catch { /* Session preference still works. */ } }}><RoomIcon kind="fold" /></button>
        </div>
      </header>
      {workers.length ? <div className={styles.statusSummary} data-office-room-summary="all_crew_states">
        <ul aria-label="크루 상태 요약">{statusSummary.map(item => <li key={item.state} data-state={item.state}><i aria-hidden="true" />{statusLabels[item.state]}<b>{item.count}명</b></li>)}</ul>
        {waitingCount ? <a className={styles.summaryAction} href="/office/?officeView=approval" onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return; event.preventDefault(); navigateInternalPathKeepingPreview("/office?officeView=approval"); }}>승인함에서 확인<RoomIcon kind="right" /></a> : null}
      </div> : null}
      {!folded ? <>
        <div className={styles.playground}>
        <div className={styles.scenePane}>
        <div ref={canvasRef} className={styles.canvas} data-testid="office-scene-floor">
          <img className={styles.backdrop} src={backdrop.src} alt={backdrop.label} draggable={false} width={1774} height={887} />
          {editing ? <span className={styles.floorGrid} aria-hidden="true" data-snap={snap} /> : null}
          {shown.length ? <div className={styles.stations} data-count={shown.length}>
            {shown.map((worker, index) => <Fragment key={worker.id}><button type="button" id={`${matteId}-worker-${index}`} popoverTarget={editing ? undefined : `${matteId}-bubble-${index}`} aria-controls={editing ? undefined : `${matteId}-bubble-${index}`} aria-haspopup={editing ? undefined : "dialog"} aria-expanded={editing ? undefined : bubbleId === worker.id} className={styles.worker} data-state={displayStatus(worker)} data-work-motion={worker.status === "working" && worker.workMotionUntil !== undefined && motionClock < worker.workMotionUntil ? worker.workMotion : undefined} data-office-scene-worker={worker.id} data-office-scene-worker-role={worker.role} data-office-scene-worker-avatar-id={worker.avatarId ?? ""} data-selected={editing ? activeWorker?.id === worker.id : (selectedId === worker.id || bubbleId === worker.id)} data-dragging={draggingId === worker.id} aria-label={`${worker.name}, ${editing ? "자리 이동 및 크기 조절" : `${statusLabels[displayStatus(worker)]}, 현재 업무 보기`}`} aria-pressed={editing ? activeWorker?.id === worker.id : undefined} disabled={saving} onClick={() => { if (editing) setEditId(worker.id); }} onPointerDown={event => startDrag(event, worker.id)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} title={editing ? "끌어서 자리 이동" : [worker.name, worker.roleLabel, displayTask(worker)].filter(Boolean).join(" · ")} style={{ "--sprite-x": `${spritePositionX(worker)}%`, "--sprite-image": `url("${getOfficeRoomCharacter(worker.avatarId, worker.role).atlas}")`, "--crew-delay": `${index * -1.7}s`, "--seat-x": `${seatFor(worker.id).x}%`, "--seat-y": `${seatFor(worker.id).y}%`, "--seat-width": `${22 * seatFor(worker.id).size / 100}%`, zIndex: editing && activeWorker?.id === worker.id ? 4 : depthOrder.findIndex(item => item.id === worker.id) + 1 } as CSSProperties}>
              <span className={styles.art} aria-hidden="true">
                <span className={styles.furniture} />
                <span className={styles.person} />
                <span className={styles.typing}><i /><i /><i /></span>
                <span className={styles.reading} />
                {displayStatus(worker) === "done" ? <span className={styles.done}>✓</span> : null}
              </span>
              <span className={styles.nameplate} data-office-nameplate><strong>{worker.name}</strong><span><i />{statusLabels[displayStatus(worker)]}</span></span>
            </button>
            {!editing ? <OfficeWorkBubble id={`${matteId}-bubble-${index}`} anchorId={`${matteId}-worker-${index}`} worker={{ ...worker, status: displayStatus(worker), task: displayTask(worker) }} statusLabel={statusLabels[displayStatus(worker)]} onSelect={onSelect} onOpenChange={open => setBubbleId(current => open ? worker.id : current === worker.id ? "" : current)} /> : null}
            </Fragment>)}
          </div> : <div className={styles.empty} data-office-scene-empty="no_created_agents"><p>함께 일할 크루를 추가해 보세요.</p>{onAdd ? <button type="button" onClick={onAdd}>첫 크루 만들기</button> : null}</div>}
        </div>
        {editing ? <p className={styles.stageHint}><span>크루를 끌어서 원하는 자리에 놓아 보세요.</span><label><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)} />격자에 맞추기</label></p> : null}
        </div>
        {editing && activeWorker && activeSeat ? <fieldset disabled={saving} className={styles.layoutEditor} aria-label="사무실 자리 배치" aria-busy={saving}>
          <div className={styles.editorToolbar}>
            <span><strong>자리 배치</strong><small>{dirty ? '저장 전' : '변경 없음'}</small></span>
            <div className={styles.historyActions}>
              <button type="button" aria-label="배치 되돌리기" title="되돌리기" disabled={!history.past.length && !(history.gesture && !sameOfficeLayout(history.gesture, draftLayout))} onClick={() => { edit({ type: 'undo' }); setLayoutNotice('이전 배치로 되돌렸어요.'); }}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 4 4 8l4 4M4 8h8a4 4 0 0 1 0 8" /></svg></button>
              <button type="button" aria-label="배치 다시 실행" title="다시 실행" disabled={!history.future.length} onClick={() => { edit({ type: 'redo' }); setLayoutNotice('배치를 다시 적용했어요.'); }}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 4 4 4-4 4m4-4H8a4 4 0 0 0 0 8" /></svg></button>
            </div>
          </div>
          <div className={styles.decorSection}>
            <strong>사무실 분위기</strong>
            <div className={styles.backgroundChoices}>{officeBackgrounds.map(item => <button key={item.id} type="button" aria-label={`${item.label} 배경`} aria-pressed={background === item.id} onClick={() => updateBackground(item.id)}><img src={item.src} alt="" /><span>{item.label.replace(' 오피스', '')}</span></button>)}</div>
            <div className={styles.roomSizes} aria-label="사무실 크기">{([{ id: 'compact', label: '아담하게' }, { id: 'standard', label: '기본' }, { id: 'large', label: '넓게 · 6명' }] as const).map(item => <button key={item.id} type="button" aria-pressed={roomSize === item.id} onClick={() => update({ roomSize: item.id })}>{item.label}</button>)}</div>
            <small>분위기와 사무실 크기는 바로 적용돼요.</small>
            {backgroundSaveFailed ? <small role="status">배경을 저장하지 못했어요. 다시 선택해 주세요.</small> : null}
          </div>
          <div className={styles.decorSection}>
            <strong>한 번에 배치</strong>
            <div className={styles.presetChoices}>{officeLayoutPresets.map(item => <button key={item.id} type="button" onClick={() => applyPreset(item.id)} title={item.detail}><span className={styles.presetMini} data-arrangement={item.id} aria-hidden="true"><i /><i /><i /></span><span>{item.label}</span></button>)}</div>
          </div>
          <div className={styles.editorControls}>
            <label className={styles.workerChoice}>크루<select aria-label="배치할 크루" value={activeWorker.id} onChange={event => { setEditId(event.target.value); setPage(Math.floor(workers.findIndex(worker => worker.id === event.target.value) / pageSize)); }}>{workers.map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>
            <label className={styles.sizeControl}><span>캐릭터·책상 크기 <output>{Math.round(activeSeat.size)}%</output></span><input type="range" aria-label="캐릭터와 책상 크기" min="45" max="140" step="5" value={activeSeat.size} onPointerDown={() => edit({ type: 'begin' })} onPointerUp={() => edit({ type: 'end' })} onPointerCancel={() => edit({ type: 'end' })} onKeyDown={() => edit({ type: 'begin' })} onKeyUp={() => edit({ type: 'end' })} onBlur={() => edit({ type: 'end' })} onChange={event => changeSeat(activeWorker.id, { size: Number(event.target.value) })} /></label>
            <div className={styles.moveControls} role="group" aria-label="선택한 크루 자리 이동">{([{ kind: "left", label: "왼쪽으로 이동", x: -2, y: 0 }, { kind: "right", label: "오른쪽으로 이동", x: 2, y: 0 }, { kind: "up", label: "뒤쪽으로 이동", x: 0, y: -2 }, { kind: "down", label: "앞쪽으로 이동", x: 0, y: 2 }] as const).map(direction => <button type="button" key={direction.kind} aria-label={direction.label} title={direction.label} onClick={() => changeSeat(activeWorker.id, { x: activeSeat.x + direction.x, y: activeSeat.y + direction.y })}><RoomIcon kind={direction.kind} /></button>)}</div>
          </div>
          <p className={styles.editorHint}>{overlapCount ? '책상끼리 가까운 곳이 있어요. 한 번에 배치로 간격을 정리할 수 있어요.' : '크기를 바꾸면 사무실에 바로 보여요.'}</p>
          <div className={styles.editorFooter}>
            <details className={styles.layoutTools}><summary>배치 도구</summary><div>
              <button type="button" onClick={alignShown}>한 줄 정렬<small>현재 크기를 유지해요.</small></button>
              <button type="button" disabled={!Object.hasOwn(draftLayout, layoutKey(activeWorker.id))} onClick={() => { const next = { ...draftLayout }; delete next[layoutKey(activeWorker.id)]; edit({ type: 'replace', layout: next }); setLayoutNotice('선택한 크루만 기본 배치로 바꿨어요.'); }}>선택 크루 초기화</button>
              <button type="button" onClick={() => { edit({ type: 'replace', layout: {} }); setLayoutNotice('전체 배치를 초기화했어요. 되돌리기로 복원할 수 있어요.'); }}>기본 배치</button>
            </div></details>
            <div><button type="button" disabled={saving} onClick={() => { setPage(currentPage); setEditing(false); setConflict(false); setLayoutNotice(''); }}>취소</button><button type="button" className={styles.saveLayout} disabled={saving} onClick={() => void saveLayout()}>{saving ? '저장 중…' : '배치 저장'}</button></div>
          </div>
          {conflict ? <button type="button" className={styles.reloadLayout} onClick={() => beginEditing()}>최신 배치로 다시 편집</button> : null}
          {draftSaveFailed && dirty ? <p className={styles.editorHint} role="status">초안을 보관하지 못했어요. 화면을 옮기기 전에 배치를 저장해 주세요.</p> : null}
        </fieldset> : null}
        </div>
        {shown.length > 1 ? <ul className={styles.roster} aria-label="현재 보이는 크루 이름과 상태">{shown.map(worker => <li key={worker.id}><strong>{worker.name}</strong><span>{statusLabels[displayStatus(worker)]}</span></li>)}</ul> : null}
        {layoutNotice ? <p className={styles.layoutNotice} role="status" aria-label="자리 배치 안내">{layoutNotice}</p> : null}
        {pageCount > 1 ? <nav className={styles.pagination} aria-label="사무실 크루 페이지"><button type="button" disabled={saving || currentPage === 0} aria-label="이전 크루 보기" onClick={() => turnPage(currentPage - 1)}><RoomIcon kind="left" /></button><span>{currentPage + 1} / {pageCount}</span><button type="button" disabled={saving || currentPage === pageCount - 1} aria-label="다음 크루 보기" onClick={() => turnPage(currentPage + 1)}><RoomIcon kind="right" /></button></nav> : null}
      </> : null}
    </section>
  );
}
