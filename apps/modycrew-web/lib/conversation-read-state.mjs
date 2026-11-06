const revisions = new WeakMap();
export const conversationReadKey = scope => `modycrew-conversation-read-v1:${encodeURIComponent(scope)}`;

/** Reply identity only. No message text is retained in read-state storage. */
export function replyRevision(thread) {
  if (revisions.has(thread)) return revisions.get(thread);
  let seenUser = false, reply;
  for (const message of thread.messages || []) {
    if (message.role === 'user') seenUser = true;
    else if (seenUser && message.role === 'assistant' && message.text?.trim()) reply = message;
  }
  let revision = '';
  if (reply) {
    let hash = 2166136261;
    for (let index = 0; index < reply.text.length; index++) hash = Math.imul(hash ^ reply.text.charCodeAt(index), 16777619);
    revision = `${reply.id}:${reply.text.length}:${hash >>> 0}`;
  }
  revisions.set(thread, revision);
  return revision;
}

export function parseReadState(raw) {
  if (raw == null) return null;
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !value.seen || typeof value.seen !== 'object' || Array.isArray(value.seen)) throw new Error('읽음 상태를 불러오지 못했습니다.');
  return Object.fromEntries(Object.entries(value.seen).filter(([id, revision]) => id && typeof revision === 'string'));
}

export function unreadReplies(threads, seen, runningIds = new Set()) {
  return new Set(threads.filter(thread => !runningIds.has(thread.id) && replyRevision(thread) && seen[thread.id] !== replyRevision(thread)).map(thread => thread.id));
}
