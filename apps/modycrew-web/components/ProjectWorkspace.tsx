"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { WorkSessionPatch, WorkSessionPriority, WorkSessionSavedView, WorkMailSource, WorkReference, WorkArtifact } from "../../../packages/domain/dist/work-session-workspace.js";
import { compareSidebarSessions } from "../../../packages/domain/dist/work-session-workspace.js";
import { isValidDateKey, localDateKey, matchesOrganizationQuery, organizeWorkSessions, parseWorkTags, type OrganizationFilters, type OrganizationSort } from "../lib/work-session-organization";
import styles from "./ProjectWorkspace.module.css";
import { groupLegacyDelegations } from "../lib/delegation-conversation";
import ProjectCreateDialog from "./ProjectCreateDialog";
import WorkspaceIcon from "./WorkspaceIcon";

export type WorkspaceStatus = "todo" | "in_progress" | "waiting" | "done";
export interface WorkspaceProjectView {
  id: string;
  name: string;
  description?: string;
  sourceFolder?: string;
  pinned?: boolean;
  collapsed?: boolean;
  archivedAt?: number;
}
export interface WorkspaceSessionView {
  sidebarOrder?: number;
  source?: WorkMailSource;
  assigneeName?: string;
  nextAction?: string;
  priorityReason?: string;
  references?: WorkReference[];
  artifacts?: WorkArtifact[];
  replyCardId?: string;
  id: string;
  title: string;
  projectId?: string;
  teammateName?: string;
  updatedAt: number;
  status: WorkspaceStatus;
  pinned?: boolean;
  archivedAt?: number;
  linkedThreadIds: string[];
  parentThreadId?: string;
  running?: boolean;
  preview?: { label: string; text: string };
  searchText?: string;
  description?: string;
  dueDate?: string;
  priority?: WorkSessionPriority;
  tags?: string[];
}
export type WorkspaceSessionPatch = WorkSessionPatch;
export type WorkspaceBulkPatch = Pick<WorkSessionPatch, "projectId" | "priority" | "dueDate" | "pinned" | "status" | "archivedAt">;
type ActionResult = void | Promise<void>;
export interface ProjectWorkspaceActions {
  onCreateProject: (name: string, sourceFolder?: string) => ActionResult;
  onProjectPreferences?: (id: string, patch: { pinned?: boolean; collapsed?: boolean }) => ActionResult;
  onMoveProject?: (id: string, relativeTo: string, position: "before" | "after") => ActionResult;
  onMoveSession?: (id: string, projectId?: string, relativeTo?: string, position?: "before" | "after") => ActionResult;
  onRenameProject: (id: string, name: string) => ActionResult;
  onArchiveProject: (id: string, archived: boolean) => ActionResult;
  onRemoveProject?: (id: string) => ActionResult;
  onRemoveSession?: (id: string) => ActionResult;
  onNewSession: (projectId?: string) => ActionResult;
  onOpenSession: (id: string) => ActionResult;
  onUpdateSession: (id: string, patch: WorkspaceSessionPatch) => ActionResult;
  onOverview: (projectId?: string) => ActionResult;
  onSelectProject: (projectId?: string) => ActionResult;
  onQuickCreateSession: (input: { title: string; projectId?: string; status: WorkspaceStatus }) => Promise<void>;
  onBulkUpdateSessions: (ids: string[], patch: WorkspaceBulkPatch, addTags?: string[], removeTags?: string[]) => Promise<void>;
  onCreateView: (view: Omit<WorkSessionSavedView, "createdAt" | "updatedAt">) => Promise<void>;
  onUpdateView: (id: string, patch: Partial<Pick<WorkSessionSavedView, "name" | "layout" | "filters" | "sort">>) => Promise<void>;
  onRemoveView: (id: string) => Promise<void>;
}
export interface ProjectWorkspaceProps {
  projects: WorkspaceProjectView[];
  sessions: WorkspaceSessionView[];
  activeSessionId?: string;
  /** all: 전체, unassigned: 프로젝트 없는 업무, 나머지: 프로젝트 ID */
  projectFilter?: string;
  loading?: boolean;
  error?: string;
  actions: ProjectWorkspaceActions;
  savedViews?: WorkSessionSavedView[];
  workspaceScopeKey?: string;
  unreadSessionIds?: ReadonlySet<string>;
}
const statusLabels: Record<WorkspaceStatus, string> = { todo: "할 일", in_progress: "진행 중", waiting: "대기", done: "완료" };
const statuses = Object.keys(statusLabels) as WorkspaceStatus[];
const displayedStatus = (session: WorkspaceSessionView) => session.running ? "in_progress" : session.status;
/** Last path segment for display; the stored path is never changed. */
export const folderLeaf = (path: string) => String(path || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
/** Folders synced by a cloud client are labelled so users know edits leave this PC. Detection is by path name only. */
export const isCloudSyncFolder = (path: string) => /google ?drive|내 드라이브|my drive|onedrive|dropbox|icloud|box sync|synology ?drive/iu.test(String(path || ""));
const inProject = (session: WorkspaceSessionView, filter?: string) => !filter || filter === "all" || (filter === "unassigned" ? !session.projectId : session.projectId === filter);
const projectForNew = (filter?: string) => filter && !["all", "unassigned"].includes(filter) ? filter : undefined;
// 포맷터는 한 번만 만든다. 행마다 new Intl.DateTimeFormat 을 만들면 대화가 300개일 때
// 목록을 한 번 그리는 데만 느린 PC 에서 0.1초가 넘게 걸렸다(답변이 흐르는 동안 초당 여러 번).
const shortDateFormatter = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" });
const timeLabel = (value: number) => shortDateFormatter.format(new Date(value || Date.now()));
const matchesSessionQuery = matchesOrganizationQuery;
const priorityLabels: Record<WorkSessionPriority, string> = { low: "낮음", normal: "보통", high: "높음", urgent: "긴급" };
const priorities = Object.keys(priorityLabels) as WorkSessionPriority[];

function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingRef = useRef(false);
  // ref 와 setState 만 쓰므로 한 번 만든 함수를 계속 써도 된다(목록 행 memo 가 헛돌지 않게).
  const run = useCallback(async (action: () => ActionResult) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try { await action(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "변경을 저장하지 못했습니다. 다시 시도해 주세요."); return false; }
    finally { pendingRef.current = false; setPending(false); }
  }, []);
  const clearError = useCallback(() => setError(""), []);
  return { pending, error, run, clearError };
}

function Status({ session }: { session: WorkspaceSessionView }) {
  const status = displayedStatus(session);
  return <span className={styles.status} data-status={status}><i aria-hidden="true" />{statusLabels[status]}</span>;
}

function SessionProperties({ session, actions }: { session: WorkspaceSessionView; actions: ProjectWorkspaceActions }) {
  const action = useAction();
  const initial = { title: session.title, description: session.description ?? "", dueDate: session.dueDate ?? "", priority: session.priority ?? "normal", tags: (session.tags ?? []).join(", ") };
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(baseline);
  if (!changed && !action.pending && JSON.stringify(initial) !== JSON.stringify(baseline)) {
    setBaseline(initial); setDraft(initial);
  }
  function edit<K extends keyof typeof draft>(key: K, value: typeof draft[K]) { setDraft(current => ({ ...current, [key]: value })); setSaved(false); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const submitted = { ...draft };
    const ok = await action.run(async () => {
      if (!submitted.title.trim()) throw new Error("업무 이름을 입력해 주세요.");
      if (submitted.dueDate && !isValidDateKey(submitted.dueDate)) throw new Error("실제 달력에 있는 마감일을 입력해 주세요.");
      const patch: WorkspaceSessionPatch = {};
      if (submitted.title !== baseline.title) patch.title = submitted.title.trim();
      if (submitted.description !== baseline.description) patch.description = submitted.description.trim() || null;
      if (submitted.dueDate !== baseline.dueDate) patch.dueDate = submitted.dueDate || null;
      if (submitted.priority !== baseline.priority) patch.priority = submitted.priority;
      if (submitted.tags !== baseline.tags) patch.tags = parseWorkTags(submitted.tags);
      if (Object.keys(patch).length) await actions.onUpdateSession(session.id, patch);
    });
    if (ok) { setBaseline(submitted); setSaved(true); }
  }
  return <details className={styles.properties} data-work-session-properties>
    <summary>업무 정보 수정</summary>
    <form aria-label={`${session.title} 업무 정보`} onSubmit={submit}>
      <label>업무 이름<input value={draft.title} maxLength={160} required disabled={action.pending} onChange={event => edit("title", event.target.value)} /></label>
      <div className={styles.propertyPair}>
        <label>마감일<input type="date" value={draft.dueDate} min="0001-01-01" max="9999-12-31" disabled={action.pending} onChange={event => edit("dueDate", event.target.value)} /></label>
        <label>우선순위<select value={draft.priority} disabled={action.pending} onChange={event => edit("priority", event.target.value as WorkSessionPriority)}>{priorities.map(priority => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}</select></label>
      </div>
      <label>태그(쉼표로 구분)<input value={draft.tags} maxLength={420} placeholder="예: 회계, 검토 필요" disabled={action.pending} onChange={event => edit("tags", event.target.value)} /></label>
      <label>업무 메모<textarea value={draft.description} maxLength={4000} rows={3} placeholder="완료 기준이나 다음에 확인할 내용을 적어 두세요." disabled={action.pending} onChange={event => edit("description", event.target.value)} /></label>
      <button type="submit" disabled={action.pending || !changed}>{action.pending ? "저장 중…" : "업무 정보 저장"}</button>
      {action.error ? <p className={styles.error} role="alert">{action.error}</p> : saved ? <p className={styles.muted} role="status">업무 정보를 저장했습니다.</p> : null}
    </form>
  </details>;
}

function QuickAdd({ status, projectId, actions, disabled, compact = false, filtered = false }: { status: WorkspaceStatus; projectId?: string; actions: ProjectWorkspaceActions; disabled?: boolean; compact?: boolean; filtered?: boolean }) {
  const [title, setTitle] = useState("");
  const [saved, setSaved] = useState(false);
  const action = useAction();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    if (await action.run(() => actions.onQuickCreateSession({ title: title.trim(), projectId, status }))) { setTitle(""); setSaved(true); }
  }
  return <form className={compact ? styles.quickAddCompact : styles.quickAdd} data-work-quick-add onSubmit={submit}>
    <label>{compact ? `${statusLabels[status]} 업무 추가` : "빠른 업무 추가"}<input aria-label={compact ? `${statusLabels[status]} 업무 이름` : "새 업무 이름"} value={title} maxLength={160} placeholder="업무 이름을 적고 Enter" disabled={disabled || action.pending} onChange={event => { setTitle(event.target.value); setSaved(false); }} /></label>
    <button type="submit" disabled={disabled || action.pending || !title.trim()}>{action.pending ? "추가 중…" : "업무 추가"}</button>
    {action.error ? <p className={styles.error} role="alert">{action.error}</p> : saved ? <p className={styles.muted} role="status">업무를 추가했습니다.{filtered ? " 기한·태그 등 조건에 맞지 않으면 전체 보기에서 확인할 수 있습니다." : ""}</p> : null}
  </form>;
}

// 행 하나. 바뀐 대화의 행만 다시 그린다(행 데이터는 page.tsx 가 대화별로 기억해 둔 같은 객체).
const SessionRow = memo(function SessionRow({ session, active, unread, onOpen }: { session: WorkspaceSessionView; active: boolean; unread: boolean; onOpen: (id: string) => void }) {
  return <button type="button" data-work-session-id={session.id} data-unread={unread || undefined} aria-current={active ? "page" : undefined} title={session.title} onClick={() => onOpen(session.id)}>
    <span className={styles.sessionTitle}>{session.title}</span>
    {session.pinned && <WorkspaceIcon name="pin" size={13} />}
    {session.running ? <span className={styles.runningIndicator} aria-label="실행 중" title="실행 중" /> : unread ? <span className={styles.unreadIndicator} aria-label="읽지 않은 새 답변" title="읽지 않은 새 답변" /> : null}
  </button>;
});

function RemovalDialog({ name, project, onConfirm, onClose }: { name: string; project: boolean; onConfirm: () => ActionResult; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const action = useAction();
  useEffect(() => { const prior = document.activeElement as HTMLElement | null; ref.current?.showModal(); return () => prior?.focus(); }, []);
  return createPortal(<dialog ref={ref} className={styles.removalDialog} aria-labelledby="remove-work-title" onCancel={event => { event.preventDefault(); if (!action.pending) onClose(); }}>
    <h2 id="remove-work-title">{project ? "프로젝트 삭제" : "대화 삭제"}</h2>
    <p>‘{name}’{project ? " 프로젝트와 대화를 목록에서 삭제합니다. 대화는 보관한 항목에서 확인할 수 있습니다." : " 대화 기록을 삭제합니다."}</p>
    <p>PC 폴더와 이미 만든 파일은 그대로 보존합니다.</p>
    {action.error && <p role="alert">{action.error}</p>}
    <footer><button type="button" disabled={action.pending} onClick={onClose}>취소</button><button type="button" disabled={action.pending} onClick={() => void action.run(onConfirm).then(ok => { if (ok) onClose(); })}>{action.pending ? "처리 중…" : "삭제"}</button></footer>
  </dialog>, document.body);
}

function MoveConversationDialog({ session, projects, onMove, onClose }: { session: WorkspaceSessionView; projects: WorkspaceProjectView[]; onMove: (projectId?: string) => ActionResult; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [destination, setDestination] = useState(session.projectId ?? "");
  const action = useAction();
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => previous?.focus(); }, []);
  return createPortal(<dialog ref={dialog} className={`${styles.removalDialog} ${styles.moveDialog}`} aria-labelledby="move-conversation-title" onCancel={event => { event.preventDefault(); if (!action.pending) onClose(); }}>
    <h2 id="move-conversation-title">대화 이동</h2><p>{session.title}</p>
    <label>이동할 프로젝트<select autoFocus aria-label="이동할 프로젝트" value={destination} disabled={action.pending} onChange={event => setDestination(event.target.value)}><option value="">프로젝트 없는 업무</option>{projects.filter(project => !project.archivedAt).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    <p>대화만 옮깁니다. PC 폴더와 이미 만든 파일은 원래 위치에 보관합니다.</p>
    {action.error && <p role="alert">{action.error}</p>}
    <footer><button type="button" disabled={action.pending} onClick={onClose}>취소</button><button type="button" disabled={action.pending || destination === (session.projectId ?? "")} onClick={() => void action.run(() => onMove(destination || undefined)).then(ok => { if (ok) onClose(); })}>{action.pending ? "이동 중…" : "이동"}</button></footer>
  </dialog>, document.body);
}

// 왼쪽 대화 목록은 늘 떠 있어서, 채팅 화면이 다시 그려질 때마다(답변 조각·입력 멈춤·주기 확인)
// 같이 다시 그려지면 대화가 쌓인 사용자일수록 앱 전체가 굼떠진다. 그래서 memo 로 감싸고,
// page.tsx 는 늘 같은 함수 묶음(actions)과 목록 배열을 넘긴다 — 바뀐 게 없으면 건너뛴다.
export const ProjectSidebar = memo(function ProjectSidebar({ projects, sessions, activeSessionId, projectFilter, loading, error, actions, unreadSessionIds, workspaceScopeKey }: ProjectWorkspaceProps) {
  const [removing, setRemoving] = useState<{ id: string; name: string; project: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
  const [movingSession, setMovingSession] = useState<WorkspaceSessionView | null>(null);
  const [moveNotice, setMoveNotice] = useState("");
  const dragItem = useRef<{ kind: "project" | "session"; id: string } | null>(null);
  const [dropTarget, setDropTarget] = useState("");
  const sessionMenu = useRef<HTMLDivElement>(null);
  useEffect(() => { if (menuSessionId) sessionMenu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, [menuSessionId]);
  useEffect(() => { setMenuProjectId(null); setMenuSessionId(null); setMovingSession(null); setRemoving(null); setDropTarget(""); setMoveNotice(""); dragItem.current = null; }, [workspaceScopeKey]);
  useEffect(() => {
    if (!menuProjectId && !menuSessionId) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-project-menu-trigger], [data-session-menu-trigger], [role="menu"]')) { setMenuProjectId(null); setMenuSessionId(null); }
      else if (event.target.closest("[data-project-menu-trigger]")) setMenuSessionId(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuProjectId(null); setMenuSessionId(null); } };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [menuProjectId, menuSessionId]);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const action = useAction();
  const groupedWork = useMemo(() => groupLegacyDelegations(sessions), [sessions]);
  // A search can still find old worker records. In the normal list they belong
  // below the original conversation, without deleting or rewriting any data.
  const displaySessions = query ? sessions : groupedWork.conversations;
  const orderedSessions = useMemo(() => displaySessions.filter(session => !session.archivedAt).sort(compareSidebarSessions), [displaySessions]);
  const visible = useMemo(() => orderedSessions.filter(session => matchesSessionQuery(session, projects, query)), [orderedSessions, projects, query]);
  const sessionPeers = useMemo(() => {
    const result = new Map<string, WorkspaceSessionView[]>();
    for (const session of orderedSessions) { const key = JSON.stringify([session.projectId ?? null, Boolean(session.pinned)]); const peers = result.get(key) ?? []; peers.push(session); result.set(key, peers); }
    return result;
  }, [orderedSessions]);
  const groups = useMemo(() => {
    const result = new Map<string, WorkspaceSessionView[]>();
    for (const session of visible) { const key = session.projectId || "unassigned"; const entries = result.get(key) || []; entries.push(session); result.set(key, entries); }
    for (const project of projects) if (!project.archivedAt && (!query || project.name.toLowerCase().includes(query.toLowerCase())) && !result.has(project.id)) result.set(project.id, []);
    if (!query && !result.has("unassigned")) result.set("unassigned", []);
    const projectOrder = new Map(projects.map((project, index) => [project.id, index]));
    return [...result].map(([id, items]) => ({ id, project: projects.find(project => project.id === id), name: projects.find(project => project.id === id)?.name || (id === "unassigned" ? "프로젝트 없는 업무" : "이전 프로젝트"), items })).sort((a,b) => Number(Boolean(b.project?.pinned)) - Number(Boolean(a.project?.pinned)) || (projectOrder.get(a.id) ?? projects.length) - (projectOrder.get(b.id) ?? projects.length));
  }, [visible, projects, query]);
  // 프로젝트마다 sessions.filter 를 다시 돌지 않고 한 번에 센다.
  const counts = useMemo(() => {
    let running = 0;
    let active = 0;
    let unassigned = 0;
    const byProject = new Map<string, number>();
    for (const session of groupedWork.conversations) {
      if (session.running) running += 1;
      if (session.archivedAt) continue;
      active += 1;
      if (!session.projectId) unassigned += 1;
      else byProject.set(session.projectId, (byProject.get(session.projectId) ?? 0) + 1);
    }
    return { running, active, unassigned, byProject };
  }, [groupedWork]);
  const runningCount = counts.running;
  const { run } = action;
  const openSession = useCallback((id: string) => { void run(() => actions.onOpenSession(id)); }, [actions, run]);
  useEffect(() => { if (action.pending) setMoveNotice(""); }, [action.pending]);
  function announceMove() { action.clearError(); setMenuProjectId(null); setMenuSessionId(null); setMoveNotice("순서와 이동 위치를 저장했습니다."); }
  function startDrag(event: DragEvent, kind: "project" | "session", id: string) {
    if (loading || action.pending || (kind === "project" ? !actions.onMoveProject : !actions.onMoveSession)) { event.preventDefault(); return; }
    event.stopPropagation(); setMenuProjectId(null); setMenuSessionId(null); dragItem.current = { kind, id }; setMoveNotice("");
    event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-modycrew-sidebar", `${kind}:${id}`);
  }
  function dragPosition(event: DragEvent): "before" | "after" { const rect = event.currentTarget.getBoundingClientRect(); return event.clientY < rect.top + rect.height / 2 ? "before" : "after"; }
  function acceptDrag(event: DragEvent, target: string) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; setDropTarget(target); }
  function endDrag() { dragItem.current = null; setDropTarget(""); }
  function drop(event: DragEvent, projectId?: string, session?: WorkspaceSessionView, position = dragPosition(event)) {
    const item = dragItem.current; if (!item || loading || action.pending) return;
    event.preventDefault(); event.stopPropagation(); endDrag();
    if (item.kind === "project") { if (projectId && !session && item.id !== projectId) void run(() => actions.onMoveProject?.(item.id, projectId, position)).then(ok => { if (ok) announceMove(); }); }
    else if (item.id !== session?.id) void run(() => actions.onMoveSession?.(item.id, projectId, session?.id, position)).then(ok => { if (ok) announceMove(); });
  }
  // 행 사이 여백에서도 가장 가까운 표시 중인 행을 기준으로 이동한다.
  // 접힌 대화·외부 파일·메뉴 위의 드롭은 대상으로 삼지 않는다.
  function nearbyDrop(event: DragEvent<HTMLDivElement>) {
    const item = dragItem.current;
    if (!item || loading || action.pending || !(event.target instanceof Element)
      || event.target.closest('[data-project-drag-id], [data-session-drag-id], [role="menu"], button, input')) return null;
    const selector = item.kind === "project" ? "[data-project-drag-id]" : "[data-project-drag-id], [data-session-drag-id]";
    const candidates = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(selector)).flatMap(element => {
      if (!element.getClientRects().length) return [];
      const projectId = element.dataset.projectDragId;
      const session = element.dataset.sessionDragId ? visible.find(value => value.id === element.dataset.sessionDragId) : undefined;
      if (item.kind === "project" && (!projects.some(project => project.id === projectId && !project.archivedAt) || item.id === projectId)) return [];
      if (item.kind === "session" && element.dataset.sessionDragId && (!session || item.id === session.id)) return [];
      const rect = element.getBoundingClientRect();
      const position: "before" | "after" = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      return [{
        projectId: session ? session.projectId : projectId === "unassigned" ? undefined : projectId,
        session, position,
        distance: Math.max(rect.top - event.clientY, event.clientY - rect.bottom, 0),
        key: session ? `session:${session.id}:${position}` : `project:${projectId}:${item.kind === "session" ? "inside" : position}`,
      }];
    });
    return candidates.sort((a, b) => a.distance - b.distance)[0] ?? null;
  }
  return <section className={styles.sidebar} aria-label="프로젝트와 업무 대화" data-work-project-sidebar>
    <button className={styles.newConversation} aria-label="＋ 새 업무 대화" type="button" onClick={() => void action.run(() => actions.onNewSession(projectForNew(projectFilter)))} disabled={loading || action.pending}><WorkspaceIcon name="edit" />새 대화</button>
    <button className={styles.overviewButton} type="button" onClick={() => void action.run(() => actions.onOverview())}>전체 업무 보기<span>{runningCount ? `${runningCount}개 실행 중` : ""}</span></button>
    <label className={styles.search}><WorkspaceIcon name="search" size={17} /><span className={styles.srOnly}>대화 찾기</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="대화와 프로젝트 검색" /></label>
    <div className={styles.projectHeading}><strong>프로젝트</strong><button type="button" aria-label="새 프로젝트 만들기" title="프로젝트 만들기" className={styles.iconButton} disabled={loading} onClick={() => setCreatingProject(true)}><WorkspaceIcon name="plus" /></button></div>
    {creatingProject && <ProjectCreateDialog key={workspaceScopeKey} onCreate={actions.onCreateProject} onClose={() => setCreatingProject(false)} />}
    {removing && <RemovalDialog key={`${workspaceScopeKey}-${removing.id}`} name={removing.name} project={removing.project} onClose={() => setRemoving(null)} onConfirm={() => removing.project ? actions.onRemoveProject?.(removing.id) : actions.onRemoveSession?.(removing.id)} />}
    {movingSession && actions.onMoveSession && <MoveConversationDialog key={`${workspaceScopeKey}-${movingSession.id}`} session={movingSession} projects={projects} onClose={() => setMovingSession(null)} onMove={async projectId => { await actions.onMoveSession!(movingSession.id, projectId); announceMove(); }} />}
    <span className={styles.srOnly} role="status" aria-live="polite">{moveNotice}</span>
    <button className={styles.allConversations} type="button" aria-current={!projectFilter || projectFilter === "all" ? "page" : undefined} onClick={() => void action.run(() => actions.onSelectProject())}>모든 대화<span>{counts.active}</span></button>
    {!loading && (error || action.error) ? <p className={styles.error} role="alert">{action.error || error}</p> : null}
    {loading ? (error ? null : <p className={styles.muted} role="status">업무 목록을 불러오는 중입니다.</p>) : <div className={styles.sessionList} aria-label="업무 대화 목록"
      onDragOver={event => { const target = nearbyDrop(event); if (target) acceptDrag(event, target.key); }}
      onDrop={event => { const target = nearbyDrop(event); if (target) drop(event, target.projectId, target.session, target.position); }}
      onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(""); }}>
      {groups.map(group => {
        const limit = query || expandedGroups.includes(group.id) ? group.items.length : Math.max(5, group.items.findIndex(session => session.id === activeSessionId) + 1);
        const projectPeers = projects.filter(project => !project.archivedAt && Boolean(project.pinned) === Boolean(group.project?.pinned));
        const projectIndex = projectPeers.findIndex(project => project.id === group.id);
        return <details key={group.id} className={styles.sessionGroup} open={Boolean(query) || (group.project ? !group.project.collapsed : !collapsedGroups.includes(group.id))} onToggle={event => {
          if (query) return;
          const element = event.currentTarget, shown = element.open;
          if (group.project && actions.onProjectPreferences) {
            if (shown !== !group.project.collapsed) void action.run(() => actions.onProjectPreferences!(group.id, { collapsed: !shown })).then(saved => { if (!saved && element.isConnected) element.open = !group.project?.collapsed; });
            return;
          }
          setCollapsedGroups(current => shown ? current.filter(id => id !== group.id) : current.includes(group.id) ? current : [...current, group.id]);
        }}>
          <summary onClick={event => { if (action.pending) event.preventDefault(); }} data-project-filtered={projectFilter === group.id || undefined}
            data-project-drag-id={group.id} draggable={Boolean(group.project && actions.onMoveProject && !loading && !action.pending)}
            onDragStart={event => startDrag(event, "project", group.id)} onDragEnd={endDrag}
            data-drop-position={dropTarget.startsWith(`project:${group.id}:`) ? dropTarget.split(":").at(-1) : undefined}
            onDragOver={event => { if (dragItem.current && (dragItem.current.kind === "session" || (group.project && dragItem.current.id !== group.id))) acceptDrag(event, `project:${group.id}:${dragItem.current.kind === "session" ? "inside" : dragPosition(event)}`); }}
            onDrop={event => drop(event, group.project?.id)}>
            <button type="button" className={styles.iconButton} disabled={action.pending} aria-label={`${group.name} 대화 목록 접기·펼치기`} onClick={event => { event.preventDefault(); event.stopPropagation(); const groupElement = event.currentTarget.closest("details"); if (groupElement) groupElement.open = !groupElement.open; }}><WorkspaceIcon name="chevron" size={14} className={styles.groupChevron} /></button>
            <WorkspaceIcon name="folder" size={17} className={styles.groupFolder} />
            {group.project ? <button className={styles.projectNameButton} type="button" data-project-id={group.id} title={group.project.sourceFolder || group.name} onClick={event => { event.preventDefault(); event.stopPropagation(); void action.run(() => actions.onSelectProject(group.id)); }}>{group.name}</button> : <span className={styles.projectName}>{group.name}</span>}
            {group.project?.pinned && <WorkspaceIcon name="pin" size={13} />}
            <span className={styles.groupActions}>
              <button type="button" className={styles.iconButton} disabled={loading || action.pending} aria-label={`${group.name} 새 대화`} title="새 대화" onClick={event => { event.preventDefault(); event.stopPropagation(); void action.run(() => actions.onNewSession(group.project?.id)); }}><WorkspaceIcon name="plus" size={16} /></button>
              {group.project && <button type="button" className={styles.iconButton} data-project-menu-trigger aria-label={`${group.name} 프로젝트 메뉴`} title="프로젝트 메뉴" aria-expanded={menuProjectId === group.id} onClick={event => { event.preventDefault(); event.stopPropagation(); if (group.project?.collapsed && actions.onProjectPreferences) { void action.run(() => actions.onProjectPreferences!(group.id, { collapsed: false })).then(ok => { if (ok) setMenuProjectId(group.id); }); } else setMenuProjectId(current => current === group.id ? null : group.id); }}><WorkspaceIcon name="more" size={17} /></button>}
            </span>
          </summary>
          {group.project && menuProjectId === group.id && <div className={styles.projectMenu} role="menu" aria-label={`${group.name} 설정`} onKeyDown={event => { if (event.key === "Escape") setMenuProjectId(null); }}>
            {actions.onMoveProject && <><button type="button" role="menuitem" disabled={action.pending || projectIndex <= 0} onClick={() => void action.run(() => actions.onMoveProject!(group.id, projectPeers[projectIndex - 1].id, "before")).then(ok => { if (ok) announceMove(); })}><WorkspaceIcon name="chevron" size={16} style={{ transform: "rotate(-90deg)" }} />위로 이동</button><button type="button" role="menuitem" disabled={action.pending || projectIndex < 0 || projectIndex >= projectPeers.length - 1} onClick={() => void action.run(() => actions.onMoveProject!(group.id, projectPeers[projectIndex + 1].id, "after")).then(ok => { if (ok) announceMove(); })}><WorkspaceIcon name="chevron" size={16} style={{ transform: "rotate(90deg)" }} />아래로 이동</button></>}
            <button type="button" role="menuitem" onClick={() => { setEditing({ id: group.id, name: group.name }); setMenuProjectId(null); }}><WorkspaceIcon name="edit" size={16} />이름 바꾸기</button>
            {actions.onProjectPreferences && <button type="button" role="menuitem" disabled={action.pending} aria-label={`${group.name} ${group.project.pinned ? "고정 해제" : "상단 고정"}`} onClick={() => void action.run(() => actions.onProjectPreferences!(group.id, { pinned: !group.project?.pinned })).then(ok => { if (ok) setMenuProjectId(null); })}><WorkspaceIcon name="pin" size={16} />{group.project.pinned ? "고정 해제" : "상단 고정"}</button>}
            <small title={group.project.sourceFolder}>{group.project.sourceFolder || "앱 저장소"}</small>
            {actions.onRemoveProject && <button type="button" role="menuitem" onClick={() => { setRemoving({ id: group.id, name: group.name, project: true }); setMenuProjectId(null); }}>프로젝트 삭제</button>}
          </div>}
          {editing?.id === group.id && <form className={styles.renameProject} onSubmit={event => { event.preventDefault(); void action.run(() => actions.onRenameProject(group.id, editing.name.trim())).then(saved => { if (saved) setEditing(null); }); }}><input autoFocus aria-label="새 프로젝트 이름" value={editing.name} maxLength={120} onChange={event => setEditing({ id: group.id, name: event.target.value })} /><button type="submit" disabled={action.pending || !editing.name.trim()}>이름 저장</button><button type="button" onClick={() => setEditing(null)}>취소</button></form>}
          {group.items.slice(0, limit).map(session => {
            const peers = sessionPeers.get(JSON.stringify([session.projectId ?? null, Boolean(session.pinned)])) ?? [];
            const index = peers.findIndex(item => item.id === session.id);
            return <div key={session.id}><div className={styles.sessionRow} data-session-drag-id={session.id}
              draggable={Boolean(actions.onMoveSession && !loading && !action.pending)} onDragStart={event => startDrag(event, "session", session.id)} onDragEnd={endDrag}
              data-drop-position={dropTarget.startsWith(`session:${session.id}:`) ? dropTarget.split(":").at(-1) : undefined}
              onDragOver={event => { if (dragItem.current?.kind === "session" && dragItem.current.id !== session.id) acceptDrag(event, `session:${session.id}:${dragPosition(event)}`); }} onDrop={event => drop(event, session.projectId, session)}>
              <SessionRow session={session} active={activeSessionId === session.id} unread={Boolean(unreadSessionIds?.has(session.id))} onOpen={openSession} />
              {actions.onMoveSession && <button type="button" className={styles.sessionMenuTrigger} data-session-menu-trigger title="대화 메뉴" aria-label={`${session.title} 대화 메뉴`} aria-expanded={menuSessionId === session.id} disabled={action.pending} onClick={() => { setMenuProjectId(null); setMenuSessionId(current => current === session.id ? null : session.id); }}><WorkspaceIcon name="more" size={16} /></button>}
              {actions.onRemoveSession && <button type="button" className={styles.deleteSession} title="대화 삭제" aria-label={`${session.title} 대화 삭제`} onClick={() => setRemoving({ id: session.id, name: session.title, project: false })}><WorkspaceIcon name="close" size={14} /></button>}
              {menuSessionId === session.id && actions.onMoveSession && <div ref={sessionMenu} className={`${styles.projectMenu} ${styles.sessionMenu}`} role="menu" aria-label={`${session.title} 대화 설정`} onKeyDown={event => {
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
                if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) { event.preventDefault(); const current = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
                if (event.key === "Escape") { event.preventDefault(); setMenuSessionId(null); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('[data-session-menu-trigger]')?.focus(); }
              }}>
                <button type="button" role="menuitem" disabled={action.pending || index <= 0} onClick={() => void action.run(() => actions.onMoveSession!(session.id, session.projectId, peers[index - 1].id, "before")).then(ok => { if (ok) announceMove(); })}>위로 이동</button>
                <button type="button" role="menuitem" disabled={action.pending || index >= peers.length - 1} onClick={() => void action.run(() => actions.onMoveSession!(session.id, session.projectId, peers[index + 1].id, "after")).then(ok => { if (ok) announceMove(); })}>아래로 이동</button>
                <button type="button" role="menuitem" disabled={action.pending || session.running} title={session.running ? "진행 중인 작업이 끝나거나 중지된 뒤 옮길 수 있습니다." : undefined} onClick={() => { setMovingSession(session); setMenuSessionId(null); }}>다른 프로젝트로 이동…</button>
              </div>}
            </div>
            {!query && groupedWork.children.has(session.id) && <details open={groupedWork.children.get(session.id)?.some(child => child.id === activeSessionId) || undefined} style={{ margin: "0 8px 6px 24px" }}>
              <summary className={styles.showMore}>이전 크루 작업 {groupedWork.children.get(session.id)!.length}개</summary>
              <div className={styles.linkedNav}>{groupedWork.children.get(session.id)!.map(child => <button key={child.id} type="button" aria-current={activeSessionId === child.id ? "page" : undefined} title={child.title} onClick={() => openSession(child.id)}>{child.teammateName || child.title}</button>)}</div>
            </details>}
            </div>;
          })}
          {group.items.length > 5 && !query && <button type="button" className={styles.showMore} onClick={() => setExpandedGroups(current => current.includes(group.id) ? current.filter(id => id !== group.id) : [...current, group.id])}>{expandedGroups.includes(group.id) ? "접기" : `더 보기 · ${Math.max(0, group.items.length - limit)}개`}</button>}
        </details>;
      })}
      {!visible.length ? <p className={styles.emptySidebar}>{query ? "검색에 맞는 대화가 없습니다." : "새 업무 대화를 만들면 여기에 계속 보관됩니다."}</p> : null}
    </div>}
  </section>;
});

function BulkActions({ sessions, projects, actions, onApplied }: { sessions: WorkspaceSessionView[]; projects: WorkspaceProjectView[]; actions: ProjectWorkspaceActions; onApplied: () => void }) {
  const action = useAction();
  const [kind, setKind] = useState("project");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<WorkspaceStatus>("todo");
  const [priority, setPriority] = useState<WorkSessionPriority>("normal");
  const [dueDate, setDueDate] = useState("");
  const [tags, setTags] = useState("");
  const [archive, setArchive] = useState("archive");
  const hasRunning = sessions.some(session => session.running);
  const blocked = hasRunning && (kind === "status" || kind === "archive");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!sessions.length || blocked) return;
    if (await action.run(async () => {
      const patch: WorkspaceBulkPatch = {};
      let addTags: string[] | undefined; let removeTags: string[] | undefined;
      if (kind === "project") patch.projectId = projectId || null;
      if (kind === "status") patch.status = status;
      if (kind === "priority") patch.priority = priority;
      if (kind === "due") {
        if (dueDate && !isValidDateKey(dueDate)) throw new Error("실제 달력에 있는 마감일을 입력해 주세요.");
        patch.dueDate = dueDate || null;
      }
      if (kind === "tags-add" || kind === "tags-remove") {
        const values = parseWorkTags(tags);
        if (!values.length) throw new Error("변경할 태그를 입력해 주세요.");
        if (kind === "tags-add") addTags = values; else removeTags = values;
      }
      if (kind === "archive") patch.archivedAt = archive === "archive" ? Date.now() : null;
      await actions.onBulkUpdateSessions(sessions.map(session => session.id), patch, addTags, removeTags);
    })) onApplied();
  }
  return <form className={styles.bulkActions} data-work-bulk-actions onSubmit={submit}>
    <strong>{sessions.length}개 업무 선택</strong>
    <label>변경할 항목<select aria-label="선택 업무 변경 항목" value={kind} disabled={action.pending} onChange={event => setKind(event.target.value)}>
      <option value="project">프로젝트 이동</option><option value="status" disabled={hasRunning}>상태 변경</option><option value="priority">우선순위</option><option value="due">마감일</option><option value="tags-add">태그 추가</option><option value="tags-remove">태그 제거</option><option value="archive" disabled={hasRunning}>보관 · 해제</option>
    </select></label>
    {kind === "project" ? <label>이동할 프로젝트<select value={projectId} disabled={action.pending} onChange={event => setProjectId(event.target.value)}><option value="">프로젝트 없음</option>{projects.filter(project => !project.archivedAt).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label> : null}
    {kind === "status" ? <label>변경할 상태<select value={status} disabled={action.pending} onChange={event => setStatus(event.target.value as WorkspaceStatus)}>{statuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label> : null}
    {kind === "priority" ? <label>변경할 우선순위<select value={priority} disabled={action.pending} onChange={event => setPriority(event.target.value as WorkSessionPriority)}>{priorities.map(value => <option key={value} value={value}>{priorityLabels[value]}</option>)}</select></label> : null}
    {kind === "due" ? <label>변경할 마감일<input type="date" min="0001-01-01" max="9999-12-31" value={dueDate} disabled={action.pending} onChange={event => setDueDate(event.target.value)} /><small>비워 두면 마감일을 해제합니다.</small></label> : null}
    {kind.startsWith("tags-") ? <label>변경할 태그<input value={tags} maxLength={420} disabled={action.pending} placeholder="쉼표로 구분" onChange={event => setTags(event.target.value)} /></label> : null}
    {kind === "archive" ? <label>보관 설정<select value={archive} disabled={action.pending} onChange={event => setArchive(event.target.value)}><option value="archive">보관하기</option><option value="restore">보관 해제</option></select></label> : null}
    <button type="submit" disabled={action.pending || blocked}>{action.pending ? "적용 중…" : "선택 업무에 적용"}</button>
    {hasRunning ? <p className={styles.muted}>실행 중인 업무를 선택한 동안에는 상태 변경과 보관을 사용할 수 없습니다.</p> : null}
    {action.error ? <p className={styles.error} role="alert">{action.error}</p> : null}
  </form>;
}

export function ProjectOverview(props: ProjectWorkspaceProps) {
  const project = props.projects.find(item => item.id === props.projectFilter);
  return project ? <ProjectConversationHome key={`${props.workspaceScopeKey}:${project.id}`} {...props} project={project} /> : <WorkOverview {...props} />;
}

function ProjectConversationHome({ project, sessions, actions, loading, error }: ProjectWorkspaceProps & { project: WorkspaceProjectView }) {
  const action = useAction();
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState(project.name);
  const groupedWork = groupLegacyDelegations(sessions);
  const conversations = (query ? sessions : groupedWork.conversations).filter(session => session.projectId === project.id && (showArchived ? Boolean(session.archivedAt) : !session.archivedAt) && matchesSessionQuery(session, [project], query))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);
  return <section className={`${styles.overview} ${styles.projectHome}`} data-project-overview="conversations" aria-label="프로젝트 대화">
    <header className={styles.overviewHeader}><div><span className={styles.muted}>프로젝트</span><h1>{project.name}</h1><p className={styles.muted}>같은 자료를 참고하며 대화별로 일을 이어가세요.</p></div><button type="button" className={styles.primary} disabled={loading || action.pending} onClick={() => void action.run(() => actions.onNewSession(project.id))}>＋ 새 대화</button></header>
    <div className={styles.projectLocation}><strong>{project.sourceFolder ? isCloudSyncFolder(project.sourceFolder) ? "클라우드 동기화 폴더로 보입니다" : "내 PC 폴더" : "폴더 미연결"}</strong><span>{project.sourceFolder || "대화는 앱 저장소에 보관됩니다. PC 폴더는 새 프로젝트를 만들 때 선택할 수 있습니다."}</span></div>
    <details className={styles.projectPreferences}><summary>프로젝트 설정</summary><form onSubmit={event => { event.preventDefault(); void action.run(() => actions.onRenameProject(project.id, name.trim())); }}><label>프로젝트 이름<input aria-label="프로젝트 이름 수정" value={name} onChange={event => setName(event.target.value)} /></label><button type="submit" disabled={action.pending || !name.trim() || name.trim() === project.name}>이름 저장</button></form><button type="button" disabled={action.pending} onClick={() => void action.run(() => actions.onProjectPreferences?.(project.id, { pinned: !project.pinned }))}>{project.pinned ? "상단 고정 해제" : "상단에 고정"}</button></details>
    <div className={styles.projectSearch}><input aria-label="프로젝트 대화 검색" placeholder="이 프로젝트의 대화 찾기" value={query} onChange={event => setQuery(event.target.value)} /><button type="button" aria-pressed={showArchived} onClick={() => setShowArchived(value => !value)}>{showArchived ? "최근 대화" : "보관한 대화"}</button></div>
    {error || action.error ? <p role="alert" className={styles.error}>{error || action.error}</p> : null}
    {loading ? <p role="status">대화를 불러오는 중입니다.</p> : conversations.length ? <ul className={styles.projectConversations} aria-label="프로젝트 대화 목록">{conversations.map(session => <li key={session.id}><button type="button" disabled={action.pending} onClick={() => void action.run(() => actions.onOpenSession(session.id))}><span><strong>{session.pinned ? "⌖ " : ""}{session.title}</strong>{session.preview?.text ? <small>{session.preview.text}</small> : null}</span><time dateTime={new Date(session.updatedAt || Date.now()).toISOString()}>{timeLabel(session.updatedAt)}</time>{session.running ? <em>답변 중</em> : null}</button>{!query && groupedWork.children.has(session.id) && <details style={{ padding: "0 8px 12px" }}><summary>이전 크루 작업 {groupedWork.children.get(session.id)!.length}개</summary><div className={styles.linkedNav}>{groupedWork.children.get(session.id)!.map(child => <button key={child.id} type="button" onClick={() => void action.run(() => actions.onOpenSession(child.id))}>{child.teammateName || child.title}</button>)}</div></details>}</li>)}</ul> : <div className={styles.empty}><h2>{query ? "찾는 대화가 없습니다" : showArchived ? "보관한 대화가 없습니다" : "이 프로젝트에서 첫 대화를 시작하세요"}</h2><p>{query || showArchived ? "다른 검색어나 최근 대화를 확인해 보세요." : "요청하면 마스터크루가 필요한 작업을 정리합니다."}</p>{!query && !showArchived ? <button type="button" disabled={action.pending} onClick={() => void action.run(() => actions.onNewSession(project.id))}>새 대화 시작</button> : null}</div>}
  </section>;
}

function WorkOverview({ projects, sessions, projectFilter, loading, error, actions, savedViews = [], workspaceScopeKey = "default" }: ProjectWorkspaceProps) {
  const [view, setView] = useState<"board" | "list">("board");
  const [filters, setFilters] = useState<OrganizationFilters>({});
  const [sort, setSort] = useState<OrganizationSort>("updated");
  const [viewId, setViewId] = useState("");
  const [viewName, setViewName] = useState("");
  const [viewNotice, setViewNotice] = useState("");
  const action = useAction();
  const project = projects.find(item => item.id === projectFilter);
  const projectName = project?.name ?? (projectFilter === "unassigned" ? "프로젝트 없는 업무" : "전체 업무");
  const effectiveFilters: OrganizationFilters = { ...filters };
  if (projectFilter === "unassigned") effectiveFilters.projectId = null;
  else if (projectForNew(projectFilter)) effectiveFilters.projectId = projectFilter;
  else delete effectiveFilters.projectId;
  const filtered = organizeWorkSessions(sessions, projects, effectiveFilters, sort);
  const scoped = sessions.filter(session => !session.archivedAt && inProject(session, projectFilter));
  const showArchived = Boolean(filters.archived);
  const query = filters.query ?? "";
  const statusFilter = filters.status ?? "all";
  const tagOptions = [...new Set(sessions.flatMap(session => session.tags ?? []))].sort((a, b) => a.localeCompare(b, "ko-KR"));
  const activeSavedView = savedViews.find(item => item.id === viewId);
  const selectionContext = JSON.stringify([workspaceScopeKey, projectFilter, filters, sort, view]);
  const [selection, setSelection] = useState<{ context: string; ids: string[] }>({ context: selectionContext, ids: [] });
  if (selection.context !== selectionContext) setSelection({ context: selectionContext, ids: [] });
  const selected = filtered.filter(session => selection.context === selectionContext && selection.ids.includes(session.id));
  const selectedIds = new Set(selected.map(session => session.id));
  const hasFilters = Boolean(query || filters.status || filters.priority || filters.tag || filters.due);
  const selectionDisabled = loading || action.pending;
  function setFilter<K extends keyof OrganizationFilters>(key: K, value: OrganizationFilters[K]) {
    setFilters(current => { const next = { ...current }; if (value === undefined || value === "") delete next[key]; else next[key] = value; return next; });
    setViewNotice("");
  }
  function clearFilters() { setFilters({}); setSort("updated"); setViewId(""); setViewName(""); setViewNotice(""); }
  function toggleSelection(id: string, checked: boolean) { setSelection({ context: selectionContext, ids: checked ? [...new Set([...selectedIds, id])] : [...selectedIds].filter(value => value !== id) }); }
  async function chooseSavedView(id: string) {
    if (!id) { clearFilters(); return; }
    const saved = savedViews.find(item => item.id === id);
    if (!saved) return;
    if (await action.run(() => actions.onSelectProject(saved.filters.projectId === null ? "unassigned" : saved.filters.projectId))) {
      setViewId(id); setViewName(saved.name); setView(saved.layout); setFilters({ ...saved.filters }); setSort(saved.sort); setViewNotice("");
    }
  }
  function currentView() {
    const cleanFilters = Object.fromEntries(Object.entries(effectiveFilters).filter(([, value]) => value !== undefined && value !== "")) as OrganizationFilters;
    return { name: viewName.trim(), layout: view, filters: cleanFilters, sort };
  }
  const viewConfig = (item: { layout: string; sort: string; filters: OrganizationFilters }) => JSON.stringify([item.layout, item.sort, Object.entries(item.filters).filter(([, value]) => value !== undefined && value !== "" && value !== false).sort(([a], [b]) => a.localeCompare(b))]);
  const viewChanged = activeSavedView && (activeSavedView.name !== viewName.trim() || viewConfig(activeSavedView) !== viewConfig(currentView()));
  async function saveView(event: FormEvent) {
    event.preventDefault();
    if (!viewName.trim()) return;
    const id = `view-${crypto.randomUUID()}`;
    if (await action.run(() => actions.onCreateView({ id, ...currentView() }))) { setViewId(id); setViewNotice("현재 조건을 새 보기로 저장했습니다."); }
  }
  function renderSession(session: WorkspaceSessionView, table = false) {
    const currentProject = projects.find(item => item.id === session.projectId);
    const overdue = session.dueDate && session.dueDate < localDateKey() && displayedStatus(session) !== "done";
    const selectionBox = <input type="checkbox" aria-label={`${session.title} 업무 선택`} checked={selectedIds.has(session.id)} disabled={selectionDisabled} onChange={event => toggleSelection(session.id, event.target.checked)} />;
    const content = <>
      <div className={styles.cardTitle}>{table ? null : selectionBox}<button type="button" className={styles.openSession} onClick={() => void action.run(() => actions.onOpenSession(session.id))}>{session.pinned ? "◆ " : ""}{session.title}</button></div>
      <span className={styles.cardMeta}>{currentProject?.name ?? "프로젝트 없음"} · {session.teammateName || "업무 비서"}</span>
      <span className={styles.cardMeta}>{session.parentThreadId ? "위임된 업무" : session.linkedThreadIds.length ? `연결 대화 ${session.linkedThreadIds.length}개` : "독립 대화"} · {timeLabel(session.updatedAt)}</span>
      <div className={styles.propertyBadges}><span>{priorityLabels[session.priority ?? "normal"]}</span>{session.dueDate ? <time dateTime={session.dueDate} className={overdue ? styles.overdue : undefined}>{overdue ? "기한 지남 · " : "마감 "}{session.dueDate}</time> : <span>마감일 없음</span>}{session.tags?.map(tag => <span key={tag}>#{tag}</span>)}</div>
      {session.description ? <p className={styles.description}>{session.description}</p> : null}
      {session.preview ? <p className={styles.preview} data-work-session-preview><span className={styles.previewLabel}>{session.preview.label}</span><span className={styles.previewText}>{session.preview.text}</span></p> : null}
    </>;
    const statusSelect = <select aria-label={`${session.title} 업무 상태`} value={session.status} disabled={Boolean(session.running) || action.pending} onChange={event => void action.run(() => actions.onUpdateSession(session.id, { status: event.target.value as WorkspaceStatus }))}>{statuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select>;
    const restore = showArchived ? <button type="button" disabled={session.running || action.pending} onClick={() => void action.run(() => actions.onUpdateSession(session.id, { archivedAt: null }))}>보관 해제</button> : null;
    return table ? <tr key={session.id} data-overview-session-id={session.id} data-selected={selectedIds.has(session.id)}><td className={styles.selectionCell}>{selectionBox}</td><td><div className={styles.listTitle}>{content}<SessionProperties session={session} actions={actions} /></div></td><td className={styles.statusCell}><Status session={session} />{statusSelect}</td><td>{restore ?? <button type="button" onClick={() => void action.run(() => actions.onOpenSession(session.id))}>대화 열기</button>}</td></tr>
      : <article className={styles.card} key={session.id} data-overview-session-id={session.id} data-selected={selectedIds.has(session.id)}>{content}<div className={styles.cardFooter}>{session.running ? <Status session={session} /> : statusSelect}{restore}</div><SessionProperties session={session} actions={actions} /></article>;
  }
  return <section className={styles.overview} aria-label="프로젝트 업무 한눈에 보기" data-project-overview>
    <header className={styles.overviewHeader}><div><h1>{projectName}</h1><p className={styles.muted}>기한과 우선순위를 정리하고 필요한 업무 대화를 이어가세요.</p></div><button type="button" className={styles.primary} disabled={loading || action.pending} onClick={() => void action.run(() => actions.onNewSession(projectForNew(projectFilter)))}>＋ 새 업무 대화</button></header>
    <div className={styles.summary} aria-label="업무 상태 요약">{statuses.map(status => <button key={status} type="button" aria-pressed={statusFilter === status} onClick={() => setFilter("status", filters.status === status ? undefined : status)}><span>{statusLabels[status]}</span><strong>{scoped.filter(session => displayedStatus(session) === status).length}</strong></button>)}</div>
    <section className={styles.savedViews} data-work-saved-views aria-label="업무 보기 저장과 관리">
      <label>저장한 보기<select aria-label="저장한 업무 보기" value={activeSavedView?.id ?? ""} disabled={action.pending} onChange={event => void chooseSavedView(event.target.value)}><option value="">직접 설정</option>{savedViews.map(saved => <option key={saved.id} value={saved.id}>{saved.name}</option>)}</select></label>
      <details><summary>현재 보기 저장 · 관리</summary><form onSubmit={saveView}><label>보기 이름<input value={viewName} maxLength={80} required placeholder="예: 이번 주 회계 업무" disabled={action.pending} onChange={event => setViewName(event.target.value)} /></label><button type="submit" disabled={action.pending || !viewName.trim()}>새 보기로 저장</button>
        {activeSavedView ? <><button type="button" disabled={action.pending || !viewName.trim()} onClick={() => void action.run(async () => { await actions.onUpdateView(activeSavedView.id, currentView()); setViewNotice("보기 이름과 현재 조건을 업데이트했습니다."); })}>보기 업데이트</button><details className={styles.removeView}><summary>보기 삭제</summary><p className={styles.muted}>‘{activeSavedView.name}’ 보기 설정을 삭제합니다. 업무 대화는 그대로 보관됩니다.</p><button type="button" disabled={action.pending} onClick={() => void action.run(async () => { await actions.onRemoveView(activeSavedView.id); setViewId(""); setViewName(""); setViewNotice("보기 설정을 삭제했습니다."); })}>보기 삭제 확인</button></details></> : null}
      </form></details>
      {viewNotice ? <p className={styles.muted} role="status">{viewNotice}</p> : null}
      {viewChanged ? <p className={styles.muted}>변경한 조건은 아직 보기에 저장되지 않았습니다.</p> : null}
    </section>
    <div className={styles.filters}>
      <label>프로젝트<select aria-label="업무 프로젝트 필터" value={projectFilter ?? "all"} disabled={action.pending} onChange={event => void action.run(() => actions.onSelectProject(event.target.value === "all" ? undefined : event.target.value))}><option value="all">전체 프로젝트</option><option value="unassigned">프로젝트 없는 업무</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}{item.archivedAt ? " (보관됨)" : ""}</option>)}</select></label>
      <label className={styles.overviewSearch}>업무 검색<input type="search" value={query} onChange={event => setFilter("query", event.target.value || undefined)} placeholder="업무 · 담당자 · 프로젝트 · 최근 내용 · 메모 · 태그" /></label>
      <label>상태<select aria-label="업무 상태 필터" value={statusFilter} onChange={event => setFilter("status", event.target.value === "all" ? undefined : event.target.value as WorkspaceStatus)}><option value="all">전체 상태</option>{statuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
      <div className={styles.viewSwitch} aria-label="업무 보기 방식"><button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}>보드</button><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>목록</button></div>
    </div>
    <div className={styles.quickFilters} aria-label="빠른 기한 선택">{([{ value: undefined, label: "전체 기한" }, { value: "today", label: "오늘" }, { value: "week", label: "이번 주" }, { value: "overdue", label: "기한 지남" }, { value: "none", label: "기한 없음" }] as const).map(item => <button key={item.label} type="button" aria-pressed={filters.due === item.value} onClick={() => setFilter("due", item.value)}>{item.label}</button>)}<span className={styles.muted}>오늘·이번 주·기한 지난 업무는 미완료만 표시합니다.</span></div>
    <details className={styles.moreFilters}><summary>기한 · 우선순위 · 태그 · 정렬</summary><div className={styles.filters}>
      <label>기한<select aria-label="업무 기한 필터" value={filters.due ?? "all"} onChange={event => setFilter("due", event.target.value === "all" ? undefined : event.target.value as OrganizationFilters["due"])}><option value="all">전체 기한</option><option value="today">오늘</option><option value="week">이번 주 (월~일)</option><option value="overdue">기한 지남</option><option value="none">기한 없음</option></select></label>
      <label>우선순위<select aria-label="업무 우선순위 필터" value={filters.priority ?? "all"} onChange={event => setFilter("priority", event.target.value === "all" ? undefined : event.target.value as WorkSessionPriority)}><option value="all">전체 우선순위</option>{priorities.map(priority => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}</select></label>
      <label>태그<select aria-label="업무 태그 필터" value={filters.tag ?? ""} onChange={event => setFilter("tag", event.target.value || undefined)}><option value="">전체 태그</option>{filters.tag && !tagOptions.includes(filters.tag) ? <option value={filters.tag}>{filters.tag}</option> : null}{tagOptions.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select></label>
      <label>정렬<select aria-label="업무 정렬" value={sort} onChange={event => setSort(event.target.value as OrganizationSort)}><option value="updated">최근 변경순</option><option value="due">마감일순</option><option value="priority">우선순위순</option><option value="title">이름순</option></select><small>고정한 업무가 먼저 표시됩니다.</small></label>
    </div></details>
    <div className={styles.secondaryRow}><label className={styles.checkbox}><input type="checkbox" checked={showArchived} onChange={event => setFilter("archived", event.target.checked || undefined)} />보관한 대화</label><label className={styles.checkbox}><input type="checkbox" aria-label="현재 보이는 업무 모두 선택" checked={filtered.length > 0 && selected.length === filtered.length} disabled={!filtered.length || selectionDisabled} onChange={event => setSelection({ context: selectionContext, ids: event.target.checked ? filtered.map(session => session.id) : [] })} />모두 선택</label><span className={styles.muted}>{filtered.length}개 업무</span>{hasFilters ? <button type="button" onClick={clearFilters}>조건 초기화</button> : null}
      {project ? <details className={styles.projectSettings}><summary>프로젝트 관리</summary><form key={project.id + project.name} onSubmit={event => { event.preventDefault(); const name = String(new FormData(event.currentTarget).get("name") || "").trim(); if (name) void action.run(() => actions.onRenameProject(project.id, name)); }}><label>프로젝트 이름<input name="name" defaultValue={project.name} maxLength={80} required /></label><button type="submit" disabled={action.pending}>이름 저장</button><button type="button" disabled={action.pending} onClick={() => void action.run(() => actions.onArchiveProject(project.id, !project.archivedAt))}>{project.archivedAt ? "프로젝트 보관 해제" : "프로젝트 보관"}</button><small>보관한 프로젝트와 대화는 다시 열 수 있습니다.</small></form></details> : null}
    </div>
    {selected.length ? <BulkActions sessions={selected} projects={projects} actions={actions} onApplied={() => setSelection({ context: selectionContext, ids: [] })} /> : null}
    {error || action.error ? <p className={styles.error} role="alert">{action.error || error}</p> : null}
    {!showArchived ? <QuickAdd status={filters.status ?? "todo"} projectId={projectForNew(projectFilter)} actions={actions} disabled={loading} filtered={hasFilters} /> : null}
    {loading ? <p role="status">업무 목록을 불러오는 중입니다.</p> : !filtered.length ? <div className={styles.empty}><h2>{hasFilters ? "조건에 맞는 업무가 없습니다" : showArchived ? "보관한 대화가 없습니다" : "첫 업무를 시작해 보세요"}</h2><p>{showArchived ? "보관한 대화는 이곳에서 다시 열 수 있습니다." : "업무 이름만 적어 먼저 정리하고, 필요할 때 대화를 열어 일을 맡길 수 있습니다."}</p>{hasFilters ? <button type="button" onClick={clearFilters}>조건 초기화</button> : !showArchived ? <button type="button" onClick={() => void action.run(() => actions.onNewSession(projectForNew(projectFilter)))}>새 업무 대화 만들기</button> : null}</div>
      : view === "board" ? <div className={styles.board}>{statuses.filter(status => statusFilter === "all" || statusFilter === status).map(status => <section className={styles.column} key={status} aria-label={`${statusLabels[status]} 업무`}><h2>{statusLabels[status]}<span>{filtered.filter(session => displayedStatus(session) === status).length}</span></h2>{filtered.filter(session => displayedStatus(session) === status).map(session => renderSession(session))}{!filtered.some(session => displayedStatus(session) === status) ? <p className={styles.columnEmpty}>아직 없습니다</p> : null}{!showArchived ? <QuickAdd compact status={status} projectId={projectForNew(projectFilter)} actions={actions} disabled={loading} filtered={hasFilters} /> : null}</section>)}</div>
      : <div className={styles.tableScroll}><table><caption className={styles.srOnly}>프로젝트의 업무 대화와 진행 상태</caption><thead><tr><th scope="col"><span className={styles.srOnly}>선택</span></th><th scope="col">업무 대화</th><th scope="col">상태</th><th scope="col">열기</th></tr></thead><tbody>{filtered.map(session => renderSession(session, true))}</tbody></table></div>}
  </section>;
}

export function SessionToolbar({ session, sessions, projects, actions, error, onStop }: {
  session: WorkspaceSessionView;
  sessions: WorkspaceSessionView[];
  projects: WorkspaceProjectView[];
  actions: ProjectWorkspaceActions;
  error?: string;
  onStop?: () => ActionResult;
}) {
  const action = useAction();
  const [linkQuery, setLinkQuery] = useState("");
  const project = projects.find(item => item.id === session.projectId);
  const candidates = sessions.filter(item => item.id !== session.id && !item.archivedAt && item.title.toLocaleLowerCase("ko-KR").includes(linkQuery.trim().toLocaleLowerCase("ko-KR")));
  const linked = sessions.filter(item => session.linkedThreadIds.includes(item.id));
  return <section className={styles.toolbar} aria-label="현재 업무 대화 관리" data-active-work-session={session.id}>
    <div className={styles.toolbarTop}>
      <div className={styles.currentIdentity}>
        <button type="button" className={styles.breadcrumb} onClick={() => void action.run(() => actions.onOverview(session.projectId))}>{project?.name ?? "프로젝트 없는 업무"}</button>
        <h2>{session.title}</h2>{session.running ? <Status session={session} /> : null}
      </div>
      <div className={styles.toolbarActions}>
        <button type="button" onClick={() => void action.run(() => actions.onNewSession(session.projectId))}>＋ 새 대화</button>
        <button type="button" onClick={() => void action.run(() => actions.onOverview(session.projectId))}>업무 한눈에</button>
        {session.running && onStop ? <button type="button" onClick={() => void action.run(onStop)}>이 업무 중지</button> : null}
      </div>
    </div>
    <details className={styles.sessionSettings}><summary>대화 설정{linked.length ? ` · 참고 대화 ${linked.length}개` : ""}</summary><div className={styles.settingsGrid}>
      <form key={session.id + session.title} onSubmit={event => { event.preventDefault(); const title = String(new FormData(event.currentTarget).get("title") || "").trim(); if (title) void action.run(() => actions.onUpdateSession(session.id, { title })); }}><label>대화 이름<input name="title" defaultValue={session.title} maxLength={160} required /></label><button type="submit" disabled={action.pending}>이름 저장</button></form>
      <label>소속 프로젝트<select value={session.projectId ?? ""} disabled={action.pending} onChange={event => void action.run(() => actions.onUpdateSession(session.id, { projectId: event.target.value || null }))}><option value="">프로젝트 없음</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}{item.archivedAt ? " (보관됨)" : ""}</option>)}</select></label>
      <label>업무 상태<select value={session.status} disabled={session.running || action.pending} onChange={event => void action.run(() => actions.onUpdateSession(session.id, { status: event.target.value as WorkspaceStatus }))}>{statuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
      <div className={styles.metadataActions}><button type="button" aria-pressed={Boolean(session.pinned)} disabled={action.pending} onClick={() => void action.run(() => actions.onUpdateSession(session.id, { pinned: !session.pinned }))}>{session.pinned ? "고정 해제" : "대화 고정"}</button><button type="button" disabled={session.running || action.pending} onClick={() => void action.run(() => actions.onUpdateSession(session.id, { archivedAt: session.archivedAt ? null : Date.now() }))}>{session.archivedAt ? "대화 보관 해제" : "대화 보관"}</button></div>
      <fieldset className={styles.links}>
        <legend>참고할 업무 대화</legend>
        <p>최대 8개 대화의 최근 메시지를 발췌해 다음 요청에 참고합니다. 프로젝트가 같아도 선택하지 않은 대화는 포함하지 않습니다.</p>
        <input type="search" aria-label="연결할 대화 검색" placeholder="대화 이름 검색" value={linkQuery} onChange={event => setLinkQuery(event.target.value)} />
        <div className={styles.linkChoices}>
          {candidates.map(item => <label className={styles.checkbox} key={item.id}>
            <input type="checkbox" checked={session.linkedThreadIds.includes(item.id)} disabled={action.pending || (session.linkedThreadIds.length >= 8 && !session.linkedThreadIds.includes(item.id))} onChange={event => {
              const ids = event.target.checked ? [...session.linkedThreadIds, item.id] : session.linkedThreadIds.filter(id => id !== item.id);
              void action.run(() => actions.onUpdateSession(session.id, { linkedThreadIds: ids }));
            }} />
            <span>{item.title}<small>{projects.find(candidate => candidate.id === item.projectId)?.name ?? "프로젝트 없음"}</small></span>
          </label>)}
          {!candidates.length ? <p className={styles.muted}>연결할 다른 대화가 없습니다.</p> : null}
        </div>
      </fieldset>
    </div>{!session.source && <SessionProperties session={session} actions={actions} />}</details>
    {linked.length || session.parentThreadId ? <nav className={styles.linkedNav} aria-label="연결된 업무 대화">
      {session.parentThreadId ? <button type="button" onClick={() => void action.run(() => actions.onOpenSession(session.parentThreadId!))}>← 맡긴 대화</button> : null}
      {linked.map(item => <button key={item.id} type="button" onClick={() => void action.run(() => actions.onOpenSession(item.id))}>↗ {item.title}</button>)}
    </nav> : null}
    {error || action.error ? <p className={styles.error} role="alert">{action.error || error}</p> : null}
  </section>;
}
