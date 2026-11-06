/** Workers have separate durable tasks, but share the conversation that assigned them. */
export function createConversationDelegation<T extends { id: string }>(threadId: string, batchId: string, teammates: readonly T[]) {
  return teammates.map((teammate, index) => ({ teammate, threadId,
    taskId: `chat:crew:${batchId}:${teammates.length}:${index}`, eventId: `delegation-${batchId}-${index}`,
  }));
}

type Conversation = { id: string; taskId?: string };
type Task = { id: string; status: string; origin?: { kind: string; threadId?: string }; execution?: { state: string; sourceThreadId?: string } };
export function isConversationTask(task: Task, conversation: Conversation) {
  if (task.origin?.kind !== "chat" || task.origin.threadId !== conversation.id || !conversation.taskId) return false;
  if (task.id === conversation.taskId) return true;
  const prefix = conversation.taskId.match(/^(chat:crew:[^:]+:(?:\d+:)?)\d+$/)?.[1];
  return Boolean(prefix && task.id.startsWith(prefix) && /^\d+$/.test(task.id.slice(prefix.length))
    && task.execution?.sourceThreadId === conversation.id);
}

export function conversationTaskStatus(tasks: readonly Task[]): "in_progress" | "done" | "waiting" {
  if (tasks.some(task => ["running", "queued"].includes(task.execution?.state ?? ""))) return "in_progress";
  // The count is durable in every task ID. A crash before enqueueing the last
  // worker must not turn a partial batch into a completed conversation.
  const batch = tasks[0]?.id.match(/^(chat:crew:[^:]+:)(\d+):\d+$/);
  if (batch) {
    const expected = Number(batch[2]);
    const prefix = `${batch[1]}${expected}:`;
    const indices = new Set(tasks.filter(task => task.id.startsWith(prefix))
      .map(task => task.id.slice(prefix.length)).filter(index => /^\d+$/.test(index) && Number(index) < expected));
    if (expected < 1 || indices.size !== expected) return "waiting";
  }
  return tasks.length > 0 && tasks.every(task => task.execution?.state === "completed" && task.status === "done") ? "done" : "waiting";
}

type LegacyConversation = { id: string; projectId?: string; parentThreadId?: string; archivedAt?: number; linkedThreadIds: string[] };
/** Only provable old auto-generated children are grouped. Orphans, moved rows,
 * manual conversations and broken/cyclic links stay visible and recoverable. */
export function groupLegacyDelegations<T extends LegacyConversation>(sessions: readonly T[]) {
  const byId = new Map(sessions.map(session => [session.id, session]));
  const children = new Map<string, T[]>();
  const grouped = new Set<string>();
  for (const session of sessions) {
    if (!session.id.startsWith("delegated-") || !session.parentThreadId || session.archivedAt) continue;
    const parent = byId.get(session.parentThreadId);
    if (!parent || parent.archivedAt || parent.id === session.id || parent.parentThreadId
      || (parent.projectId ?? null) !== (session.projectId ?? null) || !session.linkedThreadIds.includes(parent.id)) continue;
    children.set(parent.id, [...(children.get(parent.id) ?? []), session]);
    grouped.add(session.id);
  }
  return { conversations: sessions.filter(session => !grouped.has(session.id)), children };
}
