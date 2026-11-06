import {
  applyWorkSessionWorkspaceCommand,
  createWorkSessionWorkspace,
  readWorkSessionWorkspace,
  type WorkSessionWorkspace,
  type WorkSessionWorkspaceCommand,
  type WorkSessionWorkspaceResult,
} from "../../../packages/domain/dist/work-session-workspace.js";

export const workSessionStorageKey = "modycrew-work-sessions-v1";
export const workSessionChangedEvent = "modycrew-work-sessions-changed";

type ScopeToken = { source: unknown; scopeKey: string; enabled: boolean; generation: number };

/** 저장소가 바뀌면 revision 비교 기준과 비동기 응답의 소유권을 함께 바꾼다. */
export function createWorkSessionScopeState() {
  let token: ScopeToken | null = null;
  let ready = false;
  let view = { state: createWorkSessionWorkspace(), loading: true, error: "", storage: "browser" as "browser" | "desktop" };
  const current = (candidate: ScopeToken) => candidate === token && candidate.enabled;
  return {
    select(source: unknown, scopeKey: string, enabled: boolean): ScopeToken {
      if (!token || token.source !== source || token.scopeKey !== scopeKey || token.enabled !== enabled) {
        token = { source, scopeKey, enabled, generation: (token?.generation ?? 0) + 1 };
        ready = false;
        view = { state: createWorkSessionWorkspace(), loading: true, error: "", storage: "browser" };
      }
      return token;
    },
    snapshot: () => view,
    isCurrent: current,
    canUpdate: (candidate: ScopeToken) => current(candidate) && ready,
    fail(candidate: ScopeToken, message: string, failedLoad = false) {
      if (!current(candidate)) return;
      if (failedLoad) ready = false;
      view = { ...view, error: message, loading: failedLoad ? false : view.loading };
    },
    accept(candidate: ScopeToken, result: WorkSessionWorkspaceResult): WorkSessionWorkspace | null {
      if (!current(candidate)) return null;
      if (result.status === "work_session_workspace_failed" || !result.workspace) {
        view = { ...view, error: result.userMessage || "업무 대화를 저장하지 못했습니다.", loading: false };
        return null;
      }
      if (result.storage === "desktop" && candidate.scopeKey && candidate.scopeKey !== "browser" && result.root !== candidate.scopeKey) {
        ready = false;
        view = { ...view, error: "기억 저장소가 바뀌었습니다. 현재 저장소를 다시 불러와 주세요.", loading: false };
        return null;
      }
      const state = !ready || result.storage !== view.storage || result.workspace.revision >= view.state.revision ? result.workspace : view.state;
      ready = true;
      view = { state, storage: result.storage, error: "", loading: false };
      return state;
    },
  };
}

function storageKey(scopeKey?: string) { return scopeKey ? `${workSessionStorageKey}:${encodeURIComponent(scopeKey)}` : workSessionStorageKey; }

function read(scopeKey?: string) {
  const text = window.localStorage.getItem(storageKey(scopeKey));
  return text === null ? createWorkSessionWorkspace() : readWorkSessionWorkspace(JSON.parse(text));
}

function failed(error: unknown): WorkSessionWorkspaceResult {
  return { status: "work_session_workspace_failed", storage: "browser", userMessage: error instanceof Error ? error.message : "이 브라우저에 업무 대화를 저장하지 못했습니다." };
}

export async function loadBrowserWorkSessionWorkspace(scopeKey?: string): Promise<WorkSessionWorkspaceResult> {
  try { return { status: "work_session_workspace_loaded", workspace: read(scopeKey), storage: "browser", userMessage: "이 브라우저에 저장한 업무 대화를 불러왔습니다." }; }
  catch (error) { return failed(error); }
}

export async function updateBrowserWorkSessionWorkspace(command: WorkSessionWorkspaceCommand, scopeKey?: string): Promise<WorkSessionWorkspaceResult> {
  try {
    const write = (): WorkSessionWorkspaceResult => {
      // 명령을 보낸 창이 가진 snapshot 대신 저장소의 최신 내용을 다시 읽는다.
      const workspace = applyWorkSessionWorkspaceCommand(read(scopeKey), command);
      window.localStorage.setItem(storageKey(scopeKey), JSON.stringify(workspace));
      window.dispatchEvent(new Event(workSessionChangedEvent));
      return { status: "work_session_workspace_updated", workspace, storage: "browser", userMessage: "이 브라우저에 업무 대화를 저장했습니다." };
    };
    return navigator.locks ? await navigator.locks.request(storageKey(scopeKey), write) : write();
  } catch (error) { return failed(error); }
}
