/** 프로젝트와 업무 대화의 관계만 보관한다. 대화 원문은 기존 저장소에 남는다. */
export type WorkProject = {
  id: string;
  name: string;
  description?: string;
  sourceFolder?: string;
  pinned?: boolean;
  collapsed?: boolean;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
};

export type WorkSessionPriority = "low" | "normal" | "high" | "urgent";

export type WorkMailSource = {
  kind: "mail";
  accountId: string;
  messageId: string;
  threadId?: string;
  subject: string;
  from: string;
  receivedAt: string;
  preview: string;
  contentKind?: 'preview' | 'body';
  bodyTruncated?: boolean;
  fetchedAt?: string;
  previousMessages?: Omit<WorkMailSource,'previousMessages'>[];
};
export type WorkReference = {
  id: string;
  title: string;
  url: string;
  note: string;
  savedAt: number;
};
export type WorkArtifact = { documentId:string; title:string; format:string; bytes:number; sha256:string; savedAt:number };

export type WorkSessionMeta = {
  threadId: string;
  projectId?: string;
  title?: string;
  pinned?: boolean;
  /** 사용자가 지정한 프로젝트 안의 표시 순서. 답변 시각과 독립적으로 보존한다. */
  sidebarOrder?: number;
  archivedAt?: number;
  status: "todo" | "in_progress" | "waiting" | "done";
  /** 수동 진행 상태를 중단된 AI 실행으로 오인하지 않도록 구분한다. 미지정은 기존 복구 규칙을 따른다. */
  statusOrigin?: "manual" | "execution";
  /** 실제 완료 전환 시각. 과거 자료의 updatedAt을 완료일로 추정하지 않는다. */
  completedAt?: number;
  linkedThreadIds: string[];
  parentThreadId?: string;
  description?: string;
  dueDate?: string;
  priority?: WorkSessionPriority;
  tags?: string[];
  source?: WorkMailSource;
  assigneeName?: string;
  nextAction?: string;
  priorityReason?: string;
  references?: WorkReference[];
  artifacts?: WorkArtifact[];
  replyCardId?: string;
  updatedAt: number;
};

export type WorkSessionSavedView = {
  id: string;
  name: string;
  layout: "board" | "list";
  filters: {
    projectId?: string | null;
    status?: WorkSessionMeta["status"];
    priority?: WorkSessionPriority;
    tag?: string;
    query?: string;
    due?: "today" | "overdue" | "week" | "none";
    archived?: boolean;
  };
  sort: "updated" | "due" | "priority" | "title";
  createdAt: number;
  updatedAt: number;
};

export type WorkSessionWorkspace = {
  version: 1;
  revision: number;
  projects: WorkProject[];
  sessions: WorkSessionMeta[];
  savedViews?: WorkSessionSavedView[];
};

export type WorkSessionPatch = {
  source?: WorkMailSource;
  assigneeName?: string | null;
  nextAction?: string | null;
  priorityReason?: string | null;
  replyCardId?: string | null;
  projectId?: string | null;
  title?: string;
  pinned?: boolean;
  archivedAt?: number | null;
  status?: WorkSessionMeta["status"];
  statusOrigin?: WorkSessionMeta["statusOrigin"];
  linkedThreadIds?: string[];
  parentThreadId?: string | null;
  description?: string | null;
  dueDate?: string | null;
  priority?: WorkSessionPriority | null;
  tags?: string[];
};

export type WorkSessionWorkspaceCommand =
  | { type: "save_artifact"; threadId: string; artifact: WorkArtifact }
  | { type: "save_reference"; threadId: string; reference: WorkReference }
  | { type: "create_project"; project: { id: string; name: string; description?: string; sourceFolder?: string } }
  | { type: "project_preferences"; projectId: string; patch: { pinned?: boolean; collapsed?: boolean } }
  | { type: "move_project"; projectId: string; relativeTo: string; position: "before" | "after" }
  | { type: "move_session"; threadId: string; projectId: string | null; relativeTo?: string; position?: "before" | "after"; sidebarSnapshot?: { threadId: string; updatedAt: number }[] }
  | { type: "rename_project"; projectId: string; name: string }
  | { type: "archive_project"; projectId: string; archived: boolean }
  | { type: "remove_project"; projectId: string }
  | { type: "upsert_session"; threadId: string; patch: WorkSessionPatch }
  | { type: "bulk_update_sessions"; threadIds: string[]; patch: Pick<WorkSessionPatch, "projectId" | "priority" | "dueDate" | "pinned" | "status" | "statusOrigin" | "archivedAt">; addTags?: string[]; removeTags?: string[] }
  | { type: "create_view"; view: Omit<WorkSessionSavedView, "createdAt" | "updatedAt"> }
  | { type: "update_view"; viewId: string; patch: Partial<Pick<WorkSessionSavedView, "name" | "layout" | "filters" | "sort">> }
  | { type: "remove_view"; viewId: string }
  | { type: "remove_session"; threadId: string };

export type WorkSessionWorkspaceResult = {
  status: "work_session_workspace_loaded" | "work_session_workspace_updated" | "work_session_workspace_failed";
  workspace?: WorkSessionWorkspace;
  storage: "desktop" | "browser";
  root?: string;
  userMessage: string;
};

export const createWorkSessionWorkspace = (): WorkSessionWorkspace => ({ version: 1, revision: 0, projects: [], sessions: [] });

/** 새 대화는 위에, 수동 정렬한 대화끼리는 저장된 순서를 유지한다. 고정은 항상 우선한다. */
export function compareSidebarSessions(a: Pick<WorkSessionMeta, "pinned" | "sidebarOrder" | "updatedAt">, b: Pick<WorkSessionMeta, "pinned" | "sidebarOrder" | "updatedAt">): number {
  return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
    || (a.sidebarOrder ?? -1) - (b.sidebarOrder ?? -1)
    || b.updatedAt - a.updatedAt;
}

function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("업무 대화 저장 형식이 올바르지 않습니다.");
}
function string(value: unknown, label: string, max = 200): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/u.test(value)) throw new Error(`${label} 값을 확인해 주세요.`);
}
function timestamp(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("업무 대화 시각 값이 올바르지 않습니다.");
}
const statuses = new Set(["todo", "in_progress", "waiting", "done"]);
const priorities = new Set(["low", "normal", "high", "urgent"]);
const sessionPatchKeys = new Set(["projectId", "title", "pinned", "archivedAt", "status", "statusOrigin", "linkedThreadIds", "parentThreadId", "description", "dueDate", "priority", "tags", "source", "assigneeName", "nextAction", "priorityReason", "replyCardId"]);
const nullableSessionKeys = new Set(["projectId", "archivedAt", "parentThreadId", "description", "dueDate", "priority", "assigneeName", "nextAction", "priorityReason", "replyCardId"]);
const bulkPatchKeys = new Set(["projectId", "priority", "dueDate", "pinned", "status", "statusOrigin", "archivedAt"]);
const viewFilterKeys = new Set(["projectId", "status", "priority", "tag", "query", "due", "archived"]);
const viewPatchKeys = new Set(["name", "layout", "filters", "sort"]);

function allowedKeys(value: Record<string, unknown>, keys: Set<string>, label: string) {
  if (Object.keys(value).some((key) => !keys.has(key))) throw new Error(`${label} 수정 항목을 확인해 주세요.`);
}

function plainText(value: unknown, label: string, max: number): asserts value is string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new Error(`${label} 값을 확인해 주세요.`);
}

/** 날짜만 저장한다. UTC 변환이나 실행 PC의 시간대에 따라 마감일이 바뀌지 않는다. */
function dueDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("마감일은 올바른 연-월-일로 입력해 주세요.");
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0)) throw new Error("존재하는 날짜를 마감일로 입력해 주세요.");
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 12) throw new Error("태그는 최대 12개까지 지정할 수 있습니다.");
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new Error("태그 이름을 확인해 주세요.");
    const tag = item.trim().normalize("NFC");
    string(tag, "태그 이름", 32);
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function validateViewFilters(value: unknown, projectIds: Set<string>) {
  object(value);
  if (value.projectId !== undefined && value.projectId !== null) {
    string(value.projectId, "보기 프로젝트 식별자");
    if (!projectIds.has(value.projectId)) throw new Error("저장할 보기의 프로젝트를 찾을 수 없습니다.");
  }
  if (value.status !== undefined && (typeof value.status !== "string" || !statuses.has(value.status))) throw new Error("보기의 업무 상태를 확인해 주세요.");
  if (value.priority !== undefined && (typeof value.priority !== "string" || !priorities.has(value.priority))) throw new Error("보기의 우선순위를 확인해 주세요.");
  if (value.tag !== undefined) string(value.tag, "보기 태그", 32);
  if (value.query !== undefined) plainText(value.query, "보기 검색어", 500);
  if (value.due !== undefined && (typeof value.due !== "string" || !["today", "overdue", "week", "none"].includes(value.due))) throw new Error("보기의 마감일 조건을 확인해 주세요.");
  if (value.archived !== undefined && typeof value.archived !== "boolean") throw new Error("보기의 보관 조건을 확인해 주세요.");
}

function applySessionPatch(workspace: WorkSessionWorkspace, threadId: string, patch: Record<string, unknown>, now: number): WorkSessionMeta {
  let session = workspace.sessions.find((item) => item.threadId === threadId);
  if (!session) {
    session = { threadId, status: "todo", linkedThreadIds: [], updatedAt: now };
    workspace.sessions.push(session);
  }
  const previousStatus = session.status;
  for (const [key, item] of Object.entries(patch)) {
    if (item === undefined) continue;
    if (item === null && nullableSessionKeys.has(key)) delete (session as unknown as Record<string, unknown>)[key];
    else (session as unknown as Record<string, unknown>)[key] = key === "tags" ? normalizeTags(item) : structuredClone(item);
  }
  if (session.status === 'done' && previousStatus !== 'done') session.completedAt = now;
  else if (session.status !== 'done') delete session.completedAt;
  session.updatedAt = now;
  return session;
}

/** 기존 확장 필드를 남기고, 알려진 필터는 이번에 지정한 조건으로 교체한다. */
function replaceViewFilters(current: unknown, next: unknown): WorkSessionSavedView["filters"] {
  object(next);
  allowedKeys(next, viewFilterKeys, "저장할 보기 조건");
  const filters: Record<string, unknown> = current && typeof current === "object" && !Array.isArray(current) ? structuredClone(current) as Record<string, unknown> : {};
  for (const key of viewFilterKeys) delete filters[key];
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) filters[key] = key === "tag" && typeof value === "string" ? value.trim().normalize("NFC") : structuredClone(value);
  }
  return filters as WorkSessionSavedView["filters"];
}

/** 손상 자료를 빈 상태로 바꿔 덮어쓰지 않는다. 알 수 없는 추가 필드는 보존한다. */
export function readWorkSessionWorkspace(value: unknown): WorkSessionWorkspace {
  object(value);
  if (value.version !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.projects) || !Array.isArray(value.sessions)) throw new Error("업무 대화 저장 버전을 읽을 수 없습니다. 기존 파일을 보존했습니다.");
  const projectIds = new Set<string>();
  for (const project of value.projects) {
    object(project); string(project.id, "프로젝트 식별자"); string(project.name, "프로젝트 이름", 120);
    if (projectIds.has(project.id)) throw new Error("프로젝트 식별자가 중복되었습니다.");
    projectIds.add(project.id);
    timestamp(project.createdAt); timestamp(project.updatedAt);
    if (project.description !== undefined && (typeof project.description !== "string" || project.description.length > 2000)) throw new Error("프로젝트 설명을 확인해 주세요.");
    if (project.archivedAt !== undefined) timestamp(project.archivedAt);
    for (const key of ["pinned", "collapsed"]) if (project[key] !== undefined && typeof project[key] !== "boolean") throw new Error("프로젝트 표시 설정을 확인해 주세요.");
    if (project.sourceFolder !== undefined && (typeof project.sourceFolder !== "string" || project.sourceFolder.length > 4096 || /[\u0000-\u001f]/u.test(project.sourceFolder) || !/^(?:[a-z]:[\\/]|\/|\\\\)/iu.test(project.sourceFolder))) throw new Error("프로젝트 폴더를 다시 선택해 주세요.");
  }
  const sessionIds = new Set<string>();
  for (const session of value.sessions) {
    object(session); string(session.threadId, "대화 식별자"); timestamp(session.updatedAt);
    if (session.sidebarOrder !== undefined && (!Number.isSafeInteger(session.sidebarOrder) || Number(session.sidebarOrder) < 0)) throw new Error("대화 표시 순서를 확인해 주세요.");
    if (sessionIds.has(session.threadId)) throw new Error("업무 대화 식별자가 중복되었습니다.");
    sessionIds.add(session.threadId);
    if (typeof session.status !== "string" || !statuses.has(session.status) || !Array.isArray(session.linkedThreadIds)) throw new Error("업무 대화 상태를 확인해 주세요.");
    if (session.statusOrigin !== undefined && session.statusOrigin !== "manual" && session.statusOrigin !== "execution") throw new Error("업무 상태의 변경 출처를 확인해 주세요.");
    if (session.completedAt !== undefined) { timestamp(session.completedAt); if (session.status !== 'done') throw new Error('완료하지 않은 업무의 완료일을 확인해 주세요.'); }
    if (session.projectId !== undefined) { string(session.projectId, "프로젝트 식별자"); if (!projectIds.has(session.projectId)) throw new Error("업무 대화의 프로젝트를 찾을 수 없습니다."); }
    if (session.title !== undefined) string(session.title, "대화 이름", 160);
    if (session.pinned !== undefined && typeof session.pinned !== "boolean") throw new Error("고정 설정을 확인해 주세요.");
    if (session.archivedAt !== undefined) timestamp(session.archivedAt);
    if (session.description !== undefined) plainText(session.description, "업무 설명", 4000);
    if (session.assigneeName !== undefined) string(session.assigneeName, "업무 담당자", 120);
    if (session.nextAction !== undefined) plainText(session.nextAction, "다음 행동", 2000);
    if (session.priorityReason !== undefined) plainText(session.priorityReason, "우선순위 근거", 2000);
    if (session.replyCardId !== undefined) string(session.replyCardId, "답장 초안", 200);
    if (session.source !== undefined) {
      object(session.source);
      if (session.source.kind !== "mail") throw new Error("업무 출처를 확인해 주세요.");
      string(session.source.accountId, "메일 계정", 250);
      string(session.source.messageId, "원본 메일", 500);
      plainText(session.source.subject, "메일 제목", 1000);
      plainText(session.source.from, "보낸 사람", 500);
      plainText(session.source.receivedAt, "수신 시각", 100);
      plainText(session.source.preview, "메일 미리보기", 12000);
      if(session.source.contentKind!==undefined&&!['preview','body'].includes(String(session.source.contentKind)))throw new Error("메일 내용 종류를 확인해 주세요.");
      if(session.source.bodyTruncated!==undefined&&typeof session.source.bodyTruncated!=='boolean')throw new Error("메일 본문 범위를 확인해 주세요.");
      if(session.source.fetchedAt!==undefined)string(session.source.fetchedAt,"메일 확인 시각",100);
      if(session.source.threadId!==undefined)string(session.source.threadId,"메일 대화",500);
      if(session.source.previousMessages!==undefined){
        if(!Array.isArray(session.source.previousMessages)||session.source.previousMessages.length>100)throw new Error("한 업무에는 이전 메일 100통까지 연결할 수 있습니다.");
        const ids=new Set([String(session.source.messageId)]);
        for(const previous of session.source.previousMessages){
          object(previous);
          if(previous.kind!=='mail'||previous.accountId!==session.source.accountId||previous.previousMessages!==undefined)throw new Error("이전 메일의 계정을 확인해 주세요.");
          string(previous.messageId,"이전 메일",500);plainText(previous.subject,"메일 제목",1000);plainText(previous.from,"보낸 사람",500);plainText(previous.receivedAt,"수신 시각",100);plainText(previous.preview,"메일 미리보기",12000);
          if(previous.threadId!==undefined)string(previous.threadId,"메일 대화",500);
          if(previous.contentKind!==undefined&&!['preview','body'].includes(String(previous.contentKind)))throw new Error("이전 메일 내용 종류를 확인해 주세요.");
          if(previous.bodyTruncated!==undefined&&typeof previous.bodyTruncated!=='boolean')throw new Error("이전 메일 본문 범위를 확인해 주세요.");
          if(previous.fetchedAt!==undefined)string(previous.fetchedAt,"메일 확인 시각",100);
          if(ids.has(previous.messageId as string))throw new Error("연결된 메일이 중복되었습니다.");ids.add(previous.messageId as string);
        }
      }
    }
    if (session.references !== undefined) {
      if (!Array.isArray(session.references) || session.references.length > 100) throw new Error("업무별 참고 자료는 최대 100개까지 저장할 수 있습니다.");
      const referenceIds = new Set<string>();
      for (const reference of session.references) {
        object(reference); string(reference.id, "자료 식별자", 200); string(reference.title, "자료 제목", 300);
        string(reference.url, "자료 주소", 2000); plainText(reference.note, "자료 메모", 12000); timestamp(reference.savedAt);
        const url = new URL(reference.url);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("웹 자료 주소를 확인해 주세요.");
        if (referenceIds.has(reference.id)) throw new Error("참고 자료가 중복되었습니다.");
        referenceIds.add(reference.id);
      }
    }
    if(session.artifacts!==undefined) {
      if(!Array.isArray(session.artifacts)||session.artifacts.length>100) throw new Error("업무 결과물은 최대 100개까지 연결할 수 있습니다.");
      const ids=new Set<string>();
      for(const artifact of session.artifacts) {
        object(artifact);string(artifact.documentId,"문서 식별자",200);string(artifact.title,"문서 제목",300);timestamp(artifact.savedAt);
        if(typeof artifact.format!=="string"||!["docx","pptx","xlsx","pdf","hwpx","hwp"].includes(artifact.format)) throw new Error("문서 형식을 확인해 주세요.");
        if(typeof artifact.bytes!=="number"||!Number.isSafeInteger(artifact.bytes)||artifact.bytes<=0||typeof artifact.sha256!=="string"||!/^[a-f0-9]{64}$/i.test(artifact.sha256)) throw new Error("저장된 문서 정보를 확인해 주세요.");
        if(ids.has(artifact.documentId)) throw new Error("연결된 문서가 중복되었습니다.");
        ids.add(artifact.documentId);
      }
    }
    if (session.dueDate !== undefined) dueDate(session.dueDate);
    if (session.priority !== undefined && (typeof session.priority !== "string" || !priorities.has(session.priority))) throw new Error("업무 우선순위를 확인해 주세요.");
    if (session.tags !== undefined && normalizeTags(session.tags).length !== (session.tags as unknown[]).length) throw new Error("업무 태그가 중복되었습니다.");
    if (session.parentThreadId !== undefined) { string(session.parentThreadId, "출발 대화 식별자"); if (session.parentThreadId === session.threadId) throw new Error("자기 자신을 출발 대화로 지정할 수 없습니다."); }
    const links = new Set<string>();
    for (const id of session.linkedThreadIds) { string(id, "연결 대화 식별자"); if (id === session.threadId || links.has(id)) throw new Error("연결 대화가 중복되었거나 자기 자신을 참조합니다."); links.add(id); }
  }
  const byId = new Map(value.sessions.map((session: WorkSessionMeta) => [session.threadId, session]));
  for (const session of value.sessions) {
    const visited = new Set<string>([session.threadId]);
    let parent = session.parentThreadId;
    while (parent) { if (visited.has(parent)) throw new Error("출발 대화 연결이 순환합니다."); visited.add(parent); parent = byId.get(parent)?.parentThreadId; }
  }
  if (value.savedViews !== undefined) {
    if (!Array.isArray(value.savedViews) || value.savedViews.length > 30) throw new Error("저장한 보기는 최대 30개까지 사용할 수 있습니다.");
    const viewIds = new Set<string>();
    for (const view of value.savedViews) {
      object(view); string(view.id, "보기 식별자"); string(view.name, "보기 이름", 120);
      if (viewIds.has(view.id)) throw new Error("저장한 보기 식별자가 중복되었습니다.");
      viewIds.add(view.id);
      timestamp(view.createdAt); timestamp(view.updatedAt);
      if (view.layout !== "board" && view.layout !== "list") throw new Error("보기 표시 방식을 확인해 주세요.");
      if (typeof view.sort !== "string" || !["updated", "due", "priority", "title"].includes(view.sort)) throw new Error("보기 정렬 방식을 확인해 주세요.");
      validateViewFilters(view.filters, projectIds);
    }
  }
  return structuredClone(value) as WorkSessionWorkspace;
}

/** 전체 snapshot 대신 명령의 필드만 최신 상태에 적용한다. */
export function applyWorkSessionWorkspaceCommand(value: unknown, command: unknown, now = Date.now()): WorkSessionWorkspace {
  const workspace = readWorkSessionWorkspace(value);
  object(command); timestamp(now);
  if (command.type === "create_project") {
    object(command.project); string(command.project.id, "프로젝트 식별자"); string(command.project.name, "프로젝트 이름", 120);
    const projectId = command.project.id;
    if (workspace.projects.some((project) => project.id === projectId)) throw new Error("이미 있는 프로젝트입니다.");
    const project: WorkProject = { id: command.project.id, name: command.project.name.trim(), createdAt: now, updatedAt: now };
    if (command.project.sourceFolder !== undefined) { if (typeof command.project.sourceFolder !== "string") throw new Error("프로젝트 폴더를 다시 선택해 주세요."); project.sourceFolder = command.project.sourceFolder; }
    if (command.project.description !== undefined) {
      if (typeof command.project.description !== "string" || command.project.description.length > 2000) throw new Error("프로젝트 설명을 확인해 주세요.");
      project.description = command.project.description;
    }
    workspace.projects.push(project);
  } else if (command.type === "project_preferences") {
    string(command.projectId, "프로젝트 식별자"); object(command.patch);
    allowedKeys(command.patch, new Set(["pinned", "collapsed"]), "프로젝트 표시");
    const project = workspace.projects.find(item => item.id === command.projectId);
    if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
    for (const key of ["pinned", "collapsed"] as const) if (command.patch[key] !== undefined) {
      if (typeof command.patch[key] !== "boolean") throw new Error("프로젝트 표시 설정을 확인해 주세요.");
      project[key] = command.patch[key];
    }
    project.updatedAt = now;
  } else if (command.type === "move_project") {
    string(command.projectId, "프로젝트 식별자"); string(command.relativeTo, "기준 프로젝트");
    if (command.position !== "before" && command.position !== "after") throw new Error("프로젝트를 놓을 위치를 확인해 주세요.");
    const project = workspace.projects.find(item => item.id === command.projectId && !item.archivedAt);
    const anchor = workspace.projects.find(item => item.id === command.relativeTo && !item.archivedAt);
    if (!project || !anchor) throw new Error("프로젝트 목록이 바뀌었습니다. 다시 선택해 주세요.");
    if (Boolean(project.pinned) !== Boolean(anchor.pinned)) throw new Error("고정한 프로젝트는 고정 영역 안에서 옮길 수 있습니다. 다른 영역으로 옮기려면 고정 설정을 바꿔 주세요.");
    if (project !== anchor) {
      workspace.projects.splice(workspace.projects.indexOf(project), 1);
      workspace.projects.splice(workspace.projects.indexOf(anchor) + (command.position === "after" ? 1 : 0), 0, project);
    }
  } else if (command.type === "move_session") {
    string(command.threadId, "대화 식별자");
    if (command.projectId !== null) string(command.projectId, "이동할 프로젝트");
    if (command.position !== undefined && command.position !== "before" && command.position !== "after") throw new Error("대화를 놓을 위치를 확인해 주세요.");
    // 화면의 최신 대화 순서를 기준으로 배치한다. 별도 업무 정보가 없는 이전 대화도 지원한다.
    const snapshotOrder = new Map<string, number>();
    if (command.sidebarSnapshot !== undefined) {
      if (!Array.isArray(command.sidebarSnapshot) || command.sidebarSnapshot.length > 10000) throw new Error("대화 목록을 다시 불러와 주세요.");
      const existing = new Set(workspace.sessions.map(item => item.threadId));
      for (const [index, entry] of command.sidebarSnapshot.entries()) {
        object(entry); string(entry.threadId, "대화 식별자"); timestamp(entry.updatedAt);
        if (snapshotOrder.has(entry.threadId)) throw new Error("대화 목록이 중복되었습니다.");
        snapshotOrder.set(entry.threadId, index);
        if (!existing.has(entry.threadId)) workspace.sessions.push({ threadId: entry.threadId, updatedAt: entry.updatedAt, status: "todo", linkedThreadIds: [] });
      }
    }
    const session = workspace.sessions.find(item => item.threadId === command.threadId && !item.archivedAt);
    const destination = command.projectId === null ? undefined : workspace.projects.find(item => item.id === command.projectId && !item.archivedAt);
    if (!session || (command.projectId !== null && !destination)) throw new Error("이동할 대화나 프로젝트를 찾을 수 없습니다.");
    if (session.projectId !== destination?.id && session.status === "in_progress" && session.statusOrigin !== "manual") throw new Error("작업이 끝나거나 중지된 뒤 다른 프로젝트로 옮길 수 있습니다.");
    let anchor: WorkSessionMeta | undefined;
    if (command.relativeTo !== undefined) {
      string(command.relativeTo, "기준 대화");
      anchor = workspace.sessions.find(item => item.threadId === command.relativeTo && !item.archivedAt);
      if (!anchor || anchor.projectId !== destination?.id) throw new Error("대화 목록이 바뀌었습니다. 다시 선택해 주세요.");
      if (Boolean(anchor.pinned) !== Boolean(session.pinned)) throw new Error("고정한 대화는 고정 영역 안에서 순서를 바꿀 수 있습니다.");
    }
    if (anchor !== session) {
      const peers = workspace.sessions.filter(item => !item.archivedAt && item !== session && item.projectId === destination?.id && Boolean(item.pinned) === Boolean(session.pinned)).sort((a, b) => {
        const left = snapshotOrder.get(a.threadId), right = snapshotOrder.get(b.threadId);
        // 다른 창에서 새로 생긴 대화는 보존하고 기존 화면에 있던 대화끼리의 순서를 유지한다.
        if (left === undefined || right === undefined) return left === right ? compareSidebarSessions(a, b) : left === undefined ? -1 : 1;
        return left - right;
      });
      const index = anchor ? peers.indexOf(anchor) + (command.position === "after" ? 1 : 0) : 0;
      peers.splice(index, 0, session);
      if (session.projectId !== destination?.id) {
        if (destination) { session.projectId = destination.id; destination.collapsed = false; }
        else delete session.projectId;
        session.updatedAt = now;
      }
      peers.forEach((item, order) => { item.sidebarOrder = order; });
    }
  } else if (command.type === "rename_project" || command.type === "archive_project") {
    string(command.projectId, "프로젝트 식별자");
    const project = workspace.projects.find((item) => item.id === command.projectId);
    if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
    if (command.type === "rename_project") { string(command.name, "프로젝트 이름", 120); project.name = command.name.trim(); }
    else { if (typeof command.archived !== "boolean") throw new Error("프로젝트 보관 설정을 확인해 주세요."); if (command.archived) project.archivedAt = now; else delete project.archivedAt; }
    project.updatedAt = now;
  } else if (command.type === "remove_project") {
    string(command.projectId, "프로젝트 식별자");
    const project = workspace.projects.find(item => item.id === command.projectId);
    if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
    // Recoverable removal: retain the folder binding, receipts and references.
    // No filesystem operation is performed by a workspace metadata command.
    project.archivedAt = now; project.updatedAt = now;
    for (const session of workspace.sessions) if (session.projectId === project.id) {
      session.archivedAt = now; session.updatedAt = now;
    }
  } else if (command.type === "upsert_session") {
    string(command.threadId, "대화 식별자"); object(command.patch);
    allowedKeys(command.patch, sessionPatchKeys, "업무 대화");
    applySessionPatch(workspace, command.threadId, command.patch, now);
  } else if (command.type === "bulk_update_sessions") {
    object(command.patch); allowedKeys(command.patch, bulkPatchKeys, "여러 업무");
    if (!Array.isArray(command.threadIds) || command.threadIds.length < 1 || command.threadIds.length > 200) throw new Error("한 번에 정리할 업무는 1개에서 200개까지 선택해 주세요.");
    const ids = new Set<string>();
    for (const id of command.threadIds) {
      string(id, "대화 식별자");
      if (ids.has(id)) throw new Error("정리할 업무가 중복 선택되었습니다.");
      ids.add(id);
    }
    const addTags = command.addTags === undefined ? [] : normalizeTags(command.addTags);
    const removeTags = command.removeTags === undefined ? [] : normalizeTags(command.removeTags);
    if (addTags.some((tag) => removeTags.includes(tag))) throw new Error("같은 태그를 추가하고 제거할 수 없습니다.");
    // 작업 중 여부와 실제 대화 존재 여부는 호출자가 검사한다. 이 명령은 metadata만 원자적으로 변경한다.
    for (const threadId of ids) {
      const session = applySessionPatch(workspace, threadId, command.patch, now);
      if (command.addTags !== undefined || command.removeTags !== undefined) {
        const tags = normalizeTags(session.tags ?? []).filter((tag) => !removeTags.includes(tag));
        session.tags = [...new Set([...tags, ...addTags])];
        if (session.tags.length > 12) throw new Error("업무별 태그가 12개를 넘습니다. 선택한 업무는 변경하지 않았습니다.");
      }
    }
  } else if (command.type === "create_view") {
    object(command.view);
    allowedKeys(command.view, new Set(["id", ...viewPatchKeys]), "저장할 보기");
    string(command.view.id, "보기 식별자"); string(command.view.name, "보기 이름", 120);
    const views = workspace.savedViews ?? [];
    if (views.length >= 30) throw new Error("저장한 보기는 최대 30개까지 사용할 수 있습니다.");
    if (views.some((view) => view.id === (command.view as Record<string, unknown>).id)) throw new Error("이미 있는 보기입니다.");
    const view = {
      ...structuredClone(command.view), name: command.view.name.trim(),
      filters: replaceViewFilters(undefined, command.view.filters), createdAt: now, updatedAt: now,
    } as WorkSessionSavedView;
    workspace.savedViews = [...views, view];
  } else if (command.type === "update_view") {
    string(command.viewId, "보기 식별자"); object(command.patch); allowedKeys(command.patch, viewPatchKeys, "저장한 보기");
    const view = workspace.savedViews?.find((item) => item.id === command.viewId);
    if (!view) throw new Error("수정할 보기를 찾을 수 없습니다.");
    for (const [key, item] of Object.entries(command.patch)) {
      if (item === undefined) continue;
      if (key === "name") { string(item, "보기 이름", 120); view.name = item.trim(); }
      else if (key === "filters") view.filters = replaceViewFilters(view.filters, item);
      else (view as unknown as Record<string, unknown>)[key] = structuredClone(item);
    }
    view.updatedAt = now;
  } else if (command.type === "remove_view") {
    string(command.viewId, "보기 식별자");
    if (!workspace.savedViews?.some((view) => view.id === command.viewId)) throw new Error("삭제할 보기를 찾을 수 없습니다.");
    workspace.savedViews = workspace.savedViews.filter((view) => view.id !== command.viewId);
  } else if(command.type === "save_artifact") {
    string(command.threadId,"대화 식별자");object(command.artifact);string(command.artifact.documentId,"문서 식별자",200);
    const artifact=command.artifact as WorkArtifact;
    const session=workspace.sessions.find(item=>item.threadId===command.threadId);
    if(!session) throw new Error("결과물을 연결할 업무를 찾을 수 없습니다.");
    session.artifacts=[...(session.artifacts??[]).filter(item=>item.documentId!==artifact.documentId),structuredClone(artifact)];
    session.updatedAt=now;
  } else if (command.type === "save_reference") {
    string(command.threadId, "대화 식별자");
    object(command.reference);
    string(command.reference.id, "자료 식별자", 200);
    const reference = command.reference as WorkReference;
    const session = workspace.sessions.find(item => item.threadId === command.threadId);
    if (!session) throw new Error("자료를 연결할 업무를 찾을 수 없습니다.");
    session.references = [...(session.references ?? []).filter(item => item.id !== reference.id), structuredClone(reference)];
    session.updatedAt = now;
  } else if (command.type === "remove_session") {
    string(command.threadId, "대화 식별자");
    workspace.sessions = workspace.sessions.filter((session) => session.threadId !== command.threadId);
    for (const session of workspace.sessions) {
      if (session.linkedThreadIds.includes(command.threadId) || session.parentThreadId === command.threadId) {
        session.linkedThreadIds = session.linkedThreadIds.filter((id) => id !== command.threadId);
        if (session.parentThreadId === command.threadId) delete session.parentThreadId;
        session.updatedAt = now;
      }
    }
  } else throw new Error("지원하지 않는 업무 대화 명령입니다.");
  workspace.revision += 1;
  return readWorkSessionWorkspace(workspace);
}
