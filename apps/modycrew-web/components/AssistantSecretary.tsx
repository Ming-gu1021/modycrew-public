"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { createDesktopBridge } from "@/lib/desktop-bridge";
import { navigateInternalPath } from "@/lib/safe-navigation";
import {
  AI_CONNECT_HREF,
  buildOfflineSecretaryAnswer,
  callSecretary,
  formatMessageTime,
  mailDraftRequestText,
  readAssistantName,
  runSecretaryTurn,
  saveAssistantName,
  secretaryAvailable,
  subscribeSecretary,
  SECRETARY_NAME_EVENT,
  type SecretaryAction,
  type SecretaryMessage,
  type SecretaryPreferences,
  type SecretaryState,
  type SecretaryTurnBridge,
} from "@/lib/assistant-secretary";
import {
  checkSkillUpdatesForSecretary,
  detectEmployeeBuilderRequest,
  employeeBuilderHref,
  employeeSkillsBridge,
  formatEmployeePlanForChat,
  planEmployeeFromRequest,
} from "@/lib/employee-builder";
import BackgroundWorkStatus from "./BackgroundWorkStatus";
import VoiceInputButton from "./VoiceInputButton";
import styles from "./AssistantSecretary.module.css";

const quickPrompts = ["오늘 일정 알려줘", "답장할 메일 정리해줘", "오늘 할 일 우선순위 정해줘", "승인 대기 정리 도와줘"];
// 스킬 새 버전 알림은 같은 내용을 한 번만 대화에 남긴다(보관함 쪽도 원격 확인을 6시간 캐시한다).
const SKILL_UPDATE_NOTICE_KEY = "mody.secretary.skill-update-notices.v1";
const SKILL_UPDATE_CHECK_MS = 6 * 60 * 60_000;

function readAnnouncedSkillUpdates(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SKILL_UPDATE_NOTICE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(-200) : [];
  } catch {
    return [];
  }
}

/** 내 스킬 보관함에 새 버전이 있으면 MODY 대화에 알림으로 남긴다. 적용은 보관함 화면에서 사람이 고른다. */
async function announceSkillUpdates(): Promise<number> {
  if (!employeeSkillsBridge()) return 0;
  const { notifications } = await checkSkillUpdatesForSecretary();
  const announced = new Set(readAnnouncedSkillUpdates());
  let added = 0;
  for (const item of notifications) {
    const key = item.name + "|" + item.text;
    if (announced.has(key)) continue;
    const saved = await callSecretary<{ status?: string }>({ kind: "append", role: "assistant", message: { kind: "skill_update", text: item.text, actions: [item.action] } });
    if (saved?.status !== "assistant_secretary_appended") continue;
    announced.add(key);
    added += 1;
  }
  try { window.localStorage.setItem(SKILL_UPDATE_NOTICE_KEY, JSON.stringify([...announced].slice(-200))); } catch { /* 다음에 다시 알릴 수 있음 */ }
  return added;
}
const kindLabels: Record<string, string> = {
  briefing: "오늘 브리핑",
  meeting: "곧 시작하는 일정",
  deadline: "마감 임박",
  mail: "새 메일",
  connection: "연결 상태",
  setup: "연결 안내",
  approval: "승인 대기",
  skill_update: "스킬 새 버전",
};

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*/gu;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(<strong key={keyPrefix + "-b" + index++}>{match[1]}</strong>);
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** 비서 답변의 간단한 서식(제목·목록·굵게)만 안전하게 그린다. HTML 은 넣지 않는다. */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{renderInline(item, "li" + blocks.length + "-" + i)}</li>);
    blocks.push(list.ordered ? <ol key={"l" + blocks.length}>{items}</ol> : <ul key={"l" + blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*(?:[-*•·])\s+(.*)$/u.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/u.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered && !bullet);
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = /^#{1,4}\s+(.*)$/u.exec(line);
    if (heading) { blocks.push(<p key={"h" + blocks.length} className={styles.heading}>{renderInline(heading[1], "h" + blocks.length)}</p>); continue; }
    blocks.push(<p key={"p" + blocks.length}>{renderInline(line, "p" + blocks.length)}</p>);
  }
  flush();
  return <div className={styles.rich}>{blocks}</div>;
}

function timeOnly(iso: string) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "기록 없음";
  const date = new Date(time);
  return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}

export default function AssistantSecretary() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [state, setState] = useState<SecretaryState | null>(null);
  const [name, setName] = useState("MODY");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // 말로 입력하는 중(녹음·받아쓰기·모델 내려받기)에는 보내기를 잠근다. 받아쓴 글은 입력창에만 넣고 자동으로 보내지 않는다.
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const memoryRoot = useRef("");
  const stateRef = useRef<SecretaryState | null>(null);
  const markingRead = useRef(false);
  const busyRef = useRef(false);

  const reload = useCallback(async () => {
    try {
      const next = await callSecretary<SecretaryState>({ kind: "state" });
      if (next?.status !== "assistant_secretary_ready") {
        setNotice(next?.userMessage || "MODY 비서 상태를 읽지 못했어요. 잠시 후 다시 열어 주세요.");
        return null;
      }
      stateRef.current = next;
      setState(next);
      return next;
    } catch {
      setNotice("MODY 비서 상태를 읽지 못했어요. 앱을 업데이트했는지 확인해 주세요.");
      return null;
    }
  }, []);

  const markRead = useCallback(async (current: SecretaryState | null) => {
    if (!current?.unread || markingRead.current || document.visibilityState !== "visible") return;
    markingRead.current = true;
    try {
      const next = await callSecretary<SecretaryState>({ kind: "mark_read" });
      if (next?.status === "assistant_secretary_ready") { stateRef.current = next; setState(next); }
    } catch { /* 다음 갱신 때 다시 시도 */ } finally { markingRead.current = false; }
  }, []);

  useEffect(() => {
    const ok = secretaryAvailable();
    setAvailable(ok);
    setName(readAssistantName());
    const onName = () => setName(readAssistantName());
    window.addEventListener(SECRETARY_NAME_EVENT, onName);
    window.addEventListener("storage", onName);
    if (!ok) return () => { window.removeEventListener(SECRETARY_NAME_EVENT, onName); window.removeEventListener("storage", onName); };
    const bridge = createDesktopBridge();
    void (async () => {
      const first = await reload();
      // 처음 열었는데 아직 한 번도 살펴보지 않았다면 바로 살펴서 첫 브리핑을 띄운다.
      if (first && !first.lastTickAt) {
        setRefreshing(true);
        try { await callSecretary({ kind: "run_now" }); } catch { /* 상태 패널에 표시 */ }
        setRefreshing(false);
        await reload().then((next) => markRead(next));
      } else {
        await markRead(first);
      }
      try {
        const memory = await bridge.getLocalMemoryStatus();
        memoryRoot.current = String((memory as { root?: string; defaultRoot?: string })?.root || (memory as { defaultRoot?: string })?.defaultRoot || "");
      } catch { memoryRoot.current = ""; }
      try {
        const ai = await bridge.getAIProviderStatus();
        setAiConfigured(Array.isArray(ai?.providers) && ai.providers.length > 0);
      } catch { setAiConfigured(null); }
      try {
        if (await announceSkillUpdates()) await reload();
      } catch { /* 보관함을 확인하지 못해도 대화는 그대로 */ }
    })();
    const unsubscribe = subscribeSecretary(() => { void reload().then((next) => markRead(next)); });
    const onVisible = () => { if (document.visibilityState === "visible") void reload().then((next) => markRead(next)); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void reload(); }, 60_000);
    const skillTimer = window.setInterval(() => { void announceSkillUpdates().then((added) => (added ? reload() : null)).catch(() => undefined); }, SKILL_UPDATE_CHECK_MS);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener(SECRETARY_NAME_EVENT, onName);
      window.removeEventListener("storage", onName);
      window.clearInterval(timer);
      window.clearInterval(skillTimer);
    };
  }, [reload, markRead]);

  const messages = state?.messages ?? [];
  const lastMessageId = messages.at(-1)?.id ?? "";
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lastMessageId, busy]);

  const send = useCallback(async (requestText: string, displayText?: string) => {
    const text = requestText.trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setProgress("요청을 확인하는 중");
    setNotice("");
    try {
      await callSecretary({ kind: "append", role: "user", message: { text: (displayText ?? text).slice(0, 4000) } });
      // "○○ 담당 만들어줘": 필요한 능력과 스킬 출처(우리 웹사이트·이 PC·새로 만들기)를 정리해 직원 만들기 화면으로 잇는다.
      if (detectEmployeeBuilderRequest(text)) {
        setProgress("필요한 능력과 스킬 출처를 정리하는 중");
        try {
          const plan = await planEmployeeFromRequest(text, { useAI: false });
          await callSecretary({
            kind: "append",
            role: "assistant",
            message: { text: formatEmployeePlanForChat(plan), actions: [{ kind: "open", label: "직원 만들기 열기", href: employeeBuilderHref(text) }], read: true },
          });
          return;
        } catch { /* 계획을 못 만들면 아래 일반 대화로 답한다 */ }
      }
      const current = (await reload()) ?? stateRef.current;
      const bridge = createDesktopBridge() as unknown as SecretaryTurnBridge;
      let result;
      try {
        result = await runSecretaryTurn({
          bridge,
          text,
          name,
          summary: current?.summary ?? null,
          history: (current?.messages ?? []).filter((message) => message.role !== "notice" || message.kind === "briefing").slice(-14),
          localStorageRoot: memoryRoot.current || undefined,
          onProgress: (detail) => setProgress(detail),
        });
      } catch (error) {
        result = { ok: false, text: "", usedTools: [], stagedDraftIds: [], approvalLabels: [], failure: "failed" as const, failureDetail: error instanceof Error ? error.message : String(error) };
      }
      if (result.ok) {
        const actions: SecretaryAction[] = [];
        if (result.stagedDraftIds.length) actions.push({ kind: "open", label: "승인함에서 초안 보기", href: "/office/?officeView=approval&focusFinalActionCard=" + encodeURIComponent(result.stagedDraftIds[0]) });
        if (result.approvalLabels.length) actions.push({ kind: "open", label: "승인할 일 보기", href: "/office/?officeView=approval" });
        const tail = result.approvalLabels.length ? "\n\n승인이 필요한 작업: " + result.approvalLabels.join(", ") : "";
        await callSecretary({ kind: "append", role: "assistant", message: { text: result.text + tail, actions, read: true, meta: { usedTools: result.usedTools, stagedDraftIds: result.stagedDraftIds } } });
      } else {
        const offline = buildOfflineSecretaryAnswer(text, current?.summary ?? null);
        const detail = (result.failureDetail || "").replace(/\s+/gu, " ").slice(0, 120);
        const lead = result.failure === "ai_unavailable"
          ? "AI 답변 연결이 확인되지 않아 제가 답을 만들지 못했어요" + (detail ? " (" + detail + ")" : "") + ". 'AI 연결 화면 열기'에서 연결을 확인하면 바로 이어서 할게요."
          : "답을 만드는 중에 문제가 생겼어요" + (detail ? " (" + detail + ")" : "") + ". 다시 시도해 주세요.";
        await callSecretary({
          kind: "append",
          role: "assistant",
          message: {
            text: lead + (offline ? "\n\n지금 앱에서 확인되는 것만 말씀드리면:\n" + offline : ""),
            actions: [{ kind: "open", label: "AI 연결 화면 열기", href: AI_CONNECT_HREF }, { kind: "prompt", label: "다시 시도", prompt: text }],
            read: true,
            meta: { failed: true },
          },
        });
        if (result.failure === "ai_unavailable") setAiConfigured(false);
      }
    } catch {
      setNotice("대화를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress("");
      await reload();
    }
  }, [name, reload]);

  const runAction = useCallback(async (action: SecretaryAction) => {
    if (action.kind === "open") { navigateInternalPath(action.href); return; }
    if (action.kind === "prompt") { await send(action.prompt, action.label); return; }
    if (action.kind === "mail_draft") { await send(mailDraftRequestText(action), "'" + (action.subject || "메일") + "' 답장 초안 만들어줘"); return; }
    if (action.kind === "tick") {
      setRefreshing(true);
      try { await callSecretary({ kind: "run_now" }); setNotice("방금 다시 확인했어요."); } catch { setNotice("다시 확인하지 못했어요."); }
      setRefreshing(false);
      await reload();
    }
  }, [reload, send]);

  async function refreshNow() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const next = await callSecretary<SecretaryState>({ kind: "run_now" });
      setNotice(next?.status === "assistant_secretary_ready" ? "일정·메일·연결 상태를 다시 확인했어요." : "다시 확인하지 못했어요.");
    } catch { setNotice("다시 확인하지 못했어요."); }
    setRefreshing(false);
    await reload();
  }

  async function savePreferences(patch: Partial<SecretaryPreferences>) {
    try {
      const next = await callSecretary<SecretaryState>({ kind: "set_preferences", preferences: patch });
      if (next?.status === "assistant_secretary_ready") { stateRef.current = next; setState(next); }
      else setNotice("설정을 저장하지 못했어요.");
    } catch { setNotice("설정을 저장하지 못했어요."); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft;
    if (!text.trim() || busy) return;
    setDraft("");
    void send(text);
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const text = draft;
      if (!text.trim() || busy) return;
      setDraft("");
      void send(text);
    }
  }
  function renameAssistant(event: FormEvent) {
    event.preventDefault();
    const next = nameDraft.trim();
    if (!next) return;
    if (saveAssistantName(next)) { setName(next); setNameDraft(""); void savePreferences({ assistantName: next }); }
    else setNotice("이름을 저장하지 못했어요.");
  }

  const summary = state?.summary ?? null;
  const preferences = state?.preferences;
  const statusLine = useMemo(() => {
    if (!state) return "상태를 확인하는 중";
    const parts = ["항상 켜져 있어요"];
    if (state.lastTickAt) parts.push("마지막 확인 " + timeOnly(state.lastTickAt));
    if (summary?.connectionIssues.length) parts.push("다시 연결 필요 " + summary.connectionIssues.length + "곳");
    else if (summary?.connectionsKnown === false) parts.push("연결 상태 확인 못 함");
    else if (summary?.mailConnected) parts.push("메일 정상");
    if (summary && summary.connectionsKnown !== false && !summary.calendarConnected) parts.push("캘린더 미연결");
    return parts.join(" · ");
  }, [state, summary]);

  if (available === false) {
    return <section className={styles.page} aria-label="MODY 비서"><div className={styles.unavailable}><h1>{name} 비서</h1><p>MODY 비서는 설치된 ModyCrew 앱에서 동작해요. 앱이 켜져 있는 동안 일정·메일·연결 상태를 살펴 먼저 알려드려요.</p></div></section>;
  }

  return <section className={styles.page} aria-label={name + " 비서와 대화"} data-assistant-secretary>
    <div className={styles.chat}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.mark} aria-hidden="true">✦</span>
          <div><h1>{name}</h1><p>{statusLine}</p></div>
        </div>
        <button type="button" className={styles.ghost} onClick={() => void refreshNow()} disabled={refreshing}>{refreshing ? "확인하는 중…" : "지금 다시 확인"}</button>
      </header>
      {state?.storeWarning ? <p className={styles.warning} role="status">{state.storeWarning}</p> : null}
      {state?.saveError && state.saveError !== state.storeWarning ? <p className={styles.warning} role="alert">{state.saveError}</p> : null}
      {aiConfigured === false ? <div className={styles.aiBanner} role="alert"><span>AI 답변 연결이 확인되지 않았어요. 먼저 알림·브리핑은 계속 드리지만, 대화로 일을 시키려면 AI 연결이 필요해요.</span><button type="button" onClick={() => navigateInternalPath(AI_CONNECT_HREF)}>AI 연결 화면 열기</button></div> : null}
      <div ref={listRef} className={styles.messages} role="log" aria-live="polite" aria-label="MODY 대화">
        {messages.length === 0 && !busy ? <div className={styles.empty}>
          <strong>안녕하세요, {name}예요.</strong>
          <p>앱이 켜져 있는 동안 일정·마감·새 메일·연결 상태를 살펴 먼저 알려드리고, 말씀하시면 메일 정리·답장 초안·할 일 정리를 바로 해 드릴게요. 발송이나 일정 등록은 승인함에서 확인하신 뒤에만 해요.</p>
        </div> : null}
        {messages.map((message) => <MessageRow key={message.id} message={message} name={name} onAction={(action) => void runAction(action)} disabled={busy} />)}
        {busy ? <div className={styles.progress} role="status"><span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>{name}가 {progress || "확인하는 중"}…</div> : null}
      </div>
      <div className={styles.dock}>
        <div className={styles.quick} aria-label="자주 하는 요청">
          {quickPrompts.map((prompt) => <button key={prompt} type="button" onClick={() => void send(prompt)} disabled={busy}>{prompt}</button>)}
        </div>
        <form className={styles.composer} onSubmit={submit}>
          <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder={name + "에게 말하기 — 예: 내일 미팅 준비할 것 알려줘"} aria-label={name + "에게 보낼 메시지"} rows={2} maxLength={4000} />
          <VoiceInputButton
            disabled={busy}
            onBusyChange={setVoiceBusy}
            onText={(spoken) => {
              setDraft((current) => (current.trim() ? current.replace(/\s*$/u, " ") + spoken : spoken).slice(0, 4000));
              inputRef.current?.focus();
            }}
          />
          <button type="submit" disabled={busy || voiceBusy || !draft.trim()}>보내기</button>
        </form>
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      </div>
    </div>
    <aside className={styles.side} aria-label="지금 상태와 설정">
      <section>
        <h2>지금 상태</h2>
        {summary ? <ul className={styles.facts}>
          <li><span>오늘 일정</span><b>{summary.todayEvents.length ? summary.todayEvents.length + "건" : summary.calendarConnected ? "없음" : summary.connectionsKnown === false ? "확인 못 함" : "캘린더 미연결"}</b></li>
          <li><span>오늘 마감</span><b>{summary.dueToday.length}건{summary.overdueCount ? " · 지난 마감 " + summary.overdueCount : ""}</b></li>
          <li><span>먼저 볼 업무 메일</span><b>{summary.mailProposalCounts ? summary.mailProposalCounts.total + "통" : summary.replyCandidateCount + "통"}</b></li>
          {summary.mailWorkCards?.draftsReady ? <li><span>준비된 답장 초안</span><b>{summary.mailWorkCards.draftsReady}건</b></li> : null}
          <li><span>승인 대기</span><b>{summary.approvals}건</b></li>
          <li><span>메일 마지막 확인</span><b>{summary.mailSync.lastSuccessAt ? timeOnly(summary.mailSync.lastSuccessAt) : "기록 없음"}</b></li>
          {summary.calendarCheckedAt ? <li><span>캘린더 마지막 확인</span><b>{timeOnly(summary.calendarCheckedAt)}</b></li> : null}
        </ul> : <p className={styles.muted}>업무 현황을 확인하는 중이에요.</p>}
        {summary?.unavailableSources?.length ? <p className={styles.muted} role="status">이번에 읽지 못한 정보: {summary.unavailableSources.join(", ")} — 잠시 뒤 다시 확인해요.</p> : null}
        {summary?.calendarBusyOnly ? <p className={styles.muted}>캘린더 연결은 바쁜 시간만 읽어요. '캘린더 일정'의 제목은 캘린더에서 확인해 주세요.</p> : null}
      </section>
      <section>
        <h2>연결</h2>
        {summary?.connections.length ? <ul className={styles.connections}>
          {summary.connections.map((row) => <li key={row.key} data-ok={row.ok}>
            <span className={styles.dot} aria-hidden="true" />
            <div><strong>{row.label}</strong><small>{row.ok ? "정상" : row.reason || "다시 연결이 필요해요"}</small></div>
            {!row.ok ? <button type="button" onClick={() => navigateInternalPath(row.href)}>다시 연결</button> : null}
          </li>)}
        </ul> : <p className={styles.muted}>{summary?.connectionsKnown === false ? "이번에는 연결 목록을 읽지 못했어요. 잠시 뒤 다시 확인해요." : "저장된 메일·캘린더 연결이 없어요."}</p>}
        <div className={styles.connectLinks}>
          {summary && summary.connectionsKnown !== false && !summary.calendarConnected && !summary.connections.some((row) => row.category === "calendar") ? <button type="button" onClick={() => navigateInternalPath("/connect?open=google-calendar&from=chat")}>캘린더 연결하기</button> : null}
          {summary && summary.connectionsKnown !== false && !summary.mailConnected ? <button type="button" onClick={() => navigateInternalPath("/connect?open=gmail&from=chat")}>메일 연결하기</button> : null}
          <button type="button" onClick={() => navigateInternalPath(AI_CONNECT_HREF)}>AI 연결 확인</button>
        </div>
      </section>
      <BackgroundWorkStatus compact />
      <details className={styles.settings}>
        <summary>{name} 설정</summary>
        {preferences ? <fieldset>
          <legend className={styles.srOnly}>알림 설정</legend>
          <label><input type="checkbox" checked={preferences.notifications} onChange={(event) => void savePreferences({ notifications: event.target.checked })} />PC 알림 받기 (일정·마감·새 메일·연결 끊김)</label>
          <label><input type="checkbox" checked={preferences.quietHours} onChange={(event) => void savePreferences({ quietHours: event.target.checked })} />밤 {preferences.quietStartHour}시~아침 {preferences.quietEndHour}시는 급한 일정만 알림</label>
          <label><input type="checkbox" checked={preferences.hideNotificationContent === true} onChange={(event) => void savePreferences({ hideNotificationContent: event.target.checked })} />PC 알림에 내용 숨기기 (잠금 화면 등에서 메일·일정 제목을 가려요)</label>
          <label>아침 브리핑 시각
            <select value={preferences.briefingHour + ":" + preferences.briefingMinute} onChange={(event) => { const [hour, minute] = event.target.value.split(":").map(Number); void savePreferences({ briefingHour: hour, briefingMinute: minute }); }}>
              {[6, 7, 8, 9, 10].flatMap((hour) => [0, 30].map((minute) => <option key={hour + ":" + minute} value={hour + ":" + minute}>{hour}:{String(minute).padStart(2, "0")}</option>))}
            </select>
          </label>
          <small>{preferences.hideNotificationContent ? "PC 알림에는 종류만 보이고, 내용은 MODY 대화에서 확인해요." : "알림에는 일정·메일 제목이 보일 수 있어요. 메일 원문은 알림에 넣지 않아요."} 한 번에 여러 건이면 알림 하나로 묶어요.</small>
        </fieldset> : null}
        <form onSubmit={renameAssistant} className={styles.rename}>
          <label>비서 이름<input value={nameDraft} placeholder={name} maxLength={30} onChange={(event) => setNameDraft(event.target.value)} /></label>
          <button type="submit" disabled={!nameDraft.trim() || nameDraft.trim() === name}>이름 바꾸기</button>
        </form>
        <button type="button" className={styles.linkButton} onClick={() => { if (window.confirm("MODY 대화 기록을 지울까요? 알림 기준과 설정은 그대로 둡니다.")) void callSecretary({ kind: "clear" }).then(() => reload()); }}>대화 기록 지우기</button>
      </details>
      <p className={styles.boundary}>앱이 켜져 있으면(창을 닫아 트레이에 있어도) 1분마다 살펴요. PC가 꺼져 있거나 절전 중이면 멈추고, 다시 켜면 이어서 확인해요. 메일 발송·일정 등록은 승인 후에만 실행해요.</p>
    </aside>
  </section>;
}

function MessageRow({ message, name, onAction, disabled }: { message: SecretaryMessage; name: string; onAction: (action: SecretaryAction) => void; disabled: boolean }) {
  const time = formatMessageTime(message.createdAt);
  if (message.role === "user") {
    return <div className={styles.userRow}><div className={styles.userBubble}><RichText text={message.text} /><time>{time}</time></div></div>;
  }
  const isNotice = message.role === "notice";
  return <article className={isNotice ? styles.noticeCard : styles.assistantRow} data-kind={message.kind} data-severity={message.severity} data-failed={message.meta?.failed === true ? "true" : undefined}>
    <header>
      <span className={styles.who}>{isNotice ? (kindLabels[message.kind] ?? "알림") : name}</span>
      {isNotice && message.severity !== "info" ? <span className={styles.severity}>{message.severity === "urgent" ? "곧" : "확인 필요"}</span> : null}
      <time>{time}</time>
    </header>
    <RichText text={message.text} />
    {message.meta?.usedTools?.length ? <p className={styles.tools}>사용한 도구: {message.meta.usedTools.join(", ")}</p> : null}
    {message.actions.length ? <div className={styles.actions}>
      {message.actions.map((action, index) => <button key={action.label + index} type="button" className={index === 0 ? styles.primary : undefined} onClick={() => onAction(action)} disabled={disabled && action.kind !== "open"}>{action.label}</button>)}
    </div> : null}
  </article>;
}

