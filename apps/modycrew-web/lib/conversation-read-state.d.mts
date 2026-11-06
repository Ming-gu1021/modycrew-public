type ReadThread = { id?: string; messages: readonly { id: string; role: string; text: string }[] };
export function conversationReadKey(scope: string): string;
export function replyRevision(thread: ReadThread): string;
export function parseReadState(raw: string | null): Record<string, string> | null;
export function unreadReplies(threads: readonly (ReadThread & { id: string })[], seen: Record<string, string>, runningIds?: ReadonlySet<string>): Set<string>;
