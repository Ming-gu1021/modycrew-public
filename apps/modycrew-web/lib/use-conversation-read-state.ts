"use client";
import { useEffect, useMemo, useState } from "react";
import { conversationReadKey, parseReadState, replyRevision, unreadReplies } from "./conversation-read-state.mjs";

type Thread = { id: string; messages: readonly { id: string; role: string; text: string }[] };
export function useConversationReadState(scope: string, threads: readonly Thread[], activeId: string | undefined, runningIds: ReadonlySet<string>, enabled: boolean) {
  const [state, setState] = useState<{ key: string; seen: Record<string, string> }>({ key: "", seen: {} });
  const [error, setError] = useState("");
  const key = conversationReadKey(scope);
  useEffect(() => {
    if (!enabled || !scope || state.key === key) return;
    try {
      // Older installations did not record reads. Start from the current history;
      // only replies arriving after this baseline are marked as new.
      const stored = parseReadState(localStorage.getItem(key));
      const seen = stored ?? Object.fromEntries(threads.map(thread => [thread.id, replyRevision(thread)]));
      if (!stored) localStorage.setItem(key, JSON.stringify({ version: 1, seen }));
      setState({ key, seen }); setError("");
    } catch { setState({ key, seen: Object.fromEntries(threads.map(thread => [thread.id, replyRevision(thread)])) }); setError("읽음 상태를 저장하지 못했습니다. 새로 열면 표시가 달라질 수 있습니다."); }
  }, [enabled, scope, key, state.key, threads]);
  const active = threads.find(thread => thread.id === activeId);
  const revision = active ? replyRevision(active) : "";
  const running = Boolean(activeId && runningIds.has(activeId));
  useEffect(() => {
    if (!enabled || state.key !== key || !activeId || !revision || running) return;
    function markSeen() {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      if (state.seen[activeId!] === revision) return;
      try {
        const stored = parseReadState(localStorage.getItem(key)) ?? state.seen;
        const seen = { ...stored, [activeId!]: revision };
        localStorage.setItem(key, JSON.stringify({ version: 1, seen }));
        setState({ key, seen }); setError("");
      } catch { setError("읽음 상태를 저장하지 못했습니다. 새로 열면 표시가 달라질 수 있습니다."); }
    }
    markSeen(); window.addEventListener("focus", markSeen); document.addEventListener("visibilitychange", markSeen);
    return () => { window.removeEventListener("focus", markSeen); document.removeEventListener("visibilitychange", markSeen); };
  }, [enabled, state, key, activeId, revision, running]);
  useEffect(() => {
    const receive = (event: StorageEvent) => {
      if (event.key !== key || event.storageArea !== localStorage) return;
      try { const seen = parseReadState(event.newValue); if (seen) setState({ key, seen }); }
      catch { setError("다른 창의 읽음 상태를 불러오지 못했습니다."); }
    };
    window.addEventListener("storage", receive); return () => window.removeEventListener("storage", receive);
  }, [key]);
  const unreadIds = useMemo<ReadonlySet<string>>(() => state.key === key ? unreadReplies(threads, state.seen, runningIds) : new Set<string>(), [key, state, threads, runningIds]);
  return { unreadIds, error };
}
