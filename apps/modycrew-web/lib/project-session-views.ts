import type { WorkSessionMeta } from "../../../packages/domain/dist/work-session-workspace.js";
import type { WorkspaceSessionView } from "../components/ProjectWorkspace";
import { buildWorkSessionPreview } from "./work-session-preview";

type SessionThread = {
  id: string;
  title: string;
  updatedAt: number;
  teammateId?: string;
  messages: readonly { id: string; role: string; text: string }[];
};
type SessionRun = { detail: string } | undefined;

type CachedView = {
  meta: WorkSessionMeta | undefined;
  teammateName: string | undefined;
  running: boolean;
  runDetail: string | undefined;
  view: WorkspaceSessionView;
};

/**
 * 왼쪽 대화 목록에 넘길 업무 대화 행을 만든다.
 *
 * 답변이 흐르는 동안에는 대화 하나(지금 답하는 대화)만 80ms 마다 바뀌는데, 예전에는 그때마다
 * 저장된 대화 전부의 행(메시지 전체 훑기 + 미리보기 정규식 8개)을 새로 만들었다. 여기서는
 * 대화 객체(불변으로 교체된다)를 열쇠로 행을 기억해 두고, 바뀐 대화의 행만 다시 만든다.
 * 행 목록이 통째로 같으면 이전 배열을 그대로 돌려줘서 memo 된 목록이 다시 그려지지 않게 한다.
 */
export function createProjectSessionViewBuilder<Thread extends SessionThread>(isPersistable: (thread: Thread) => boolean) {
  const persistable = new WeakMap<Thread, boolean>();
  const cache = new WeakMap<Thread, CachedView>();
  let previous: WorkspaceSessionView[] = [];

  return function buildProjectSessionViews(
    threads: readonly Thread[],
    metas: readonly WorkSessionMeta[],
    teammateNames: ReadonlyMap<string, string>,
    runFor: (threadId: string) => SessionRun,
  ): WorkspaceSessionView[] {
    const metadata = new Map(metas.map((item) => [item.threadId, item]));
    const next: WorkspaceSessionView[] = [];
    for (const thread of threads) {
      let keep = persistable.get(thread);
      if (keep === undefined) {
        keep = isPersistable(thread);
        persistable.set(thread, keep);
      }
      if (!keep) continue;
      const meta = metadata.get(thread.id);
      const run = runFor(thread.id);
      const teammateName = thread.teammateId ? teammateNames.get(thread.teammateId) : undefined;
      const running = Boolean(run);
      const runDetail = run?.detail;
      const cached = cache.get(thread);
      if (cached && cached.meta === meta && cached.teammateName === teammateName && cached.running === running && cached.runDetail === runDetail) {
        next.push(cached.view);
        continue;
      }
      const view: WorkspaceSessionView = {
        id: thread.id,
        title: meta?.title || thread.title,
        projectId: meta?.projectId,
        teammateName,
        updatedAt: Math.max(thread.updatedAt, meta?.updatedAt ?? 0),
        status: meta?.status ?? "todo",
        pinned: meta?.pinned,
        sidebarOrder: meta?.sidebarOrder,
        archivedAt: meta?.archivedAt,
        linkedThreadIds: meta?.linkedThreadIds ?? [],
        description: meta?.description,
        dueDate: meta?.dueDate,
        priority: meta?.priority,
        tags: meta?.tags,
        source: meta?.source,
        assigneeName: meta?.assigneeName,
        nextAction: meta?.nextAction,
        priorityReason: meta?.priorityReason,
        references: meta?.references,
        artifacts: meta?.artifacts,
        replyCardId: meta?.replyCardId,
        parentThreadId: meta?.parentThreadId,
        running,
        preview: buildWorkSessionPreview(thread.messages, run),
      };
      cache.set(thread, { meta, teammateName, running, runDetail, view });
      next.push(view);
    }
    if (next.length === previous.length && next.every((view, index) => view === previous[index])) return previous;
    previous = next;
    return next;
  };
}
