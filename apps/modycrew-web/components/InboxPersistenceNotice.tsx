"use client";

import { useEffect, useRef, useState } from "react";
import { createDesktopBridge } from "@/lib/desktop-bridge";

/** Persistence recovery only: never rerun an AI request or external action. */
export function InboxPersistenceNotice() {
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const sequence = useRef(0);

  useEffect(() => {
    const bridge = createDesktopBridge();
    if (!bridge.isAvailable || !bridge.fetchInboxRevision) return;
    let active = true;
    const refresh = async () => {
      if (busy.current) return;
      const request = ++sequence.current;
      try {
        const result = await bridge.fetchInboxRevision!();
        if (active && request === sequence.current && result.persistence) setPending(result.persistence.pending);
      } catch { /* A polling error cannot clear an existing unsaved warning. */ }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => { active = false; window.clearInterval(timer); sequence.current++; };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  async function retry() {
    if (busy.current) return;
    busy.current = true; sequence.current++; setSaving(true); setMessage("");
    try {
      const bridge = createDesktopBridge();
      if (!bridge.retryInboxSave) throw new Error("저장 재시도를 지원하는 앱 업데이트가 필요합니다.");
      const result = await bridge.retryInboxSave();
      setPending(result.persistence.pending);
      setMessage(result.userMessage);
    } catch {
      setPending(true);
      setMessage("아직 저장하지 못했습니다. 저장 공간과 폴더 쓰기 권한을 확인해 주세요.");
    } finally { busy.current = false; setSaving(false); }
  }

  if (!pending) return null;
  return (
    <aside role="alert" data-testid="inbox-persistence-notice" style={{ position: "fixed", bottom: 16, left: 16, right: 16, zIndex: 10000, maxWidth: 640, margin: "0 auto", padding: 16, borderRadius: 12, border: "1px solid #a16207", background: "#fff8db", color: "#422006", boxShadow: "0 4px 24px #0002", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <div style={{ flex: "1 1 260px" }}>
        <strong>아직 저장되지 않은 승인함 변경이 있어요</strong>
        <p style={{ margin: "6px 0 0", fontSize: 14 }}>내용은 현재 앱에 남아 있습니다. 앱을 닫기 전에 다시 저장해 주세요.</p>
        {message && <p style={{ margin: "6px 0 0", fontSize: 14 }}>{message}</p>}
      </div>
      <button type="button" disabled={saving} onClick={() => { void retry(); }} style={{ padding: "10px 14px", border: "1px solid #854d0e", borderRadius: 8, background: "#713f12", color: "white", cursor: saving ? "wait" : "pointer" }}>
        {saving ? "저장 중…" : "저장 다시 시도"}
      </button>
    </aside>
  );
}
