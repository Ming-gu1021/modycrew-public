"use client";

/**
 * 업무판 — "지금 무슨 일이 어디까지 됐는지"를 한 곳에서 본다.
 *
 * 메일에서 온 카드, 대화에서 맡긴 일, 자동 점검이 만든 카드가 각각 다른 자리에
 * 흩어져 있어서 전체를 볼 수 없었다. 도메인 업무 원장(hive/task-ledger)은 완성돼
 * 있었지만 앱 호출부가 0곳이었다. 이 판이 그 첫 호출부다.
 *
 * 스스로 데이터를 가져온다(props 로 7,000줄짜리 오피스 판을 뚫고 내려보내지 않는다).
 * 승인/거절 두 갈래뿐이던 자리에 "이건 어떻게 할까요?" 라는 질문과 답이 들어간다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createDesktopBridge, type TaskLedgerTask } from "@/lib/desktop-bridge";
import { delegationReceiptLinks } from "@/lib/home-journey-rules";
import { navigateInternalPathKeepingPreview } from "@/lib/safe-navigation";
import { classifyWorkItemFocusTarget, subscribeWorkItemFocus } from "@/lib/work-item-focus";
import {
  buildAssignedTaskFields,
  normalizeTaskAssigneeRoster,
  taskApprovalHref,
  type TaskAssigneeOption,
} from "@/lib/task-assignee";
import { resolveModyTeammateWorkPackIds } from "../../../packages/domain/dist/work-pack.js";
import styles from "./TaskBoard.module.css";
import BackgroundWorkStatus from "./BackgroundWorkStatus";

/** 맡긴 일 접수 뒤의 두 갈래(진행 보기·승인할 것). 다른 '일 맡기기' 화면과 같은 곳을 가리킨다. */
function openReceiptLink(href: string) {
  navigateInternalPathKeepingPreview(href);
}

type Lane = "blocked" | "doing" | "todo" | "done";

const laneOrder: Lane[] = ["blocked", "doing", "todo", "done"];
const laneLabels: Record<Lane, string> = {
  blocked: "답이 필요해요",
  doing: "하는 중",
  todo: "기다리는 중",
  done: "끝남",
};

function originLabel(task: TaskLedgerTask): string {
  const kind = task.origin?.kind;
  if (kind === "mail") return "메일";
  if (kind === "chat") return "대화";
  if (kind === "calendar") return "일정";
  if (kind === "trigger") return "자동 점검";
  return "직접";
}

function shortDate(iso: string | undefined): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getMonth() + 1}월 ${parsed.getDate()}일`;
}

/** 아직 답하지 않은 마지막 질문. 카드가 blocked 인 이유가 여기 있다. */
function openQuestion(task: TaskLedgerTask) {
  return [...(task.humanQA ?? [])].reverse().find((qa) => !qa.answer && !qa.dismissedAt);
}

export function TaskBoard() {
  const [tasks, setTasks] = useState<TaskLedgerTask[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ id: string; kind: "answer" | "complete" | "run" } | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [repeat, setRepeat] = useState<"none" | "daily" | "weekly">("none");
  // 담당: 비워 두면 기본 비서가 맡는다. 직원을 고르면 그 직원의 역할·지침으로 일한다.
  const [roster, setRoster] = useState<TaskAssigneeOption[]>([]);
  const [assigneeId, setAssigneeId] = useState("");
  const mutationPending = useRef(false);
  const refreshSequence = useRef(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [showDone, setShowDone] = useState(false);
  const [visibleCounts, setVisibleCounts] = useState<Partial<Record<Lane, number>>>({});
  /** 방금 맡긴 일 한 줄. 어디서 진행과 승인을 확인하는지 바로 이어준다. */
  const [receipt, setReceipt] = useState("");
  // 맡긴 업무 알림·트레이에서 온 "이 업무를 보여 달라" 요청. taskId 가 비면 판 맨 위(답이 필요해요).
  // waitingFor: 그 업무가 목록에 없어 다시 읽는 중일 때, 다시 읽기 전의 목록(바뀌면 다시 찾는다).
  const [focusRequest, setFocusRequest] = useState<{ taskId: string; waitingFor: TaskLedgerTask[] | null } | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState("");
  const boardRef = useRef<HTMLElement | null>(null);
  const pendingScrollRef = useRef<{ taskId: string; attempts: number } | null>(null);

  const refresh = useCallback(async (successNotice = "", quiet = false) => {
    const bridge = createDesktopBridge();
    const sequence = ++refreshSequence.current;
    if (!quiet) setBusy(true);
    try {
      const result = await bridge.listTasks();
      if (sequence !== refreshSequence.current) return;
      if (result.status !== "local_memory_tasks_loaded" || !Array.isArray(result.tasks)) {
        setNotice(result.userMessage || "업무판을 불러오지 못했습니다. 다시 읽기를 눌러 주세요.");
        return;
      }
      setTasks(result.tasks);
      setLoaded(true);
      if (!quiet) setNotice(successNotice);
    } catch {
      if (sequence === refreshSequence.current) setNotice("업무판을 불러오지 못했습니다. 다시 읽기를 눌러 주세요.");
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void createDesktopBridge()
      .loadAppProfile()
      .then((result) => {
        if (!cancelled) setRoster(normalizeTaskAssigneeRoster(result?.profile));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden && !mutationPending.current) void refresh("", true);
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const [includeReminders, setIncludeReminders] = useState(false);
  const reminderCount = tasks.filter(task => task.id.startsWith('inbox:schedule-briefing:')).length;
  const visibleTasks = useMemo(() => tasks.filter(task => includeReminders || !task.id.startsWith('inbox:schedule-briefing:')), [tasks, includeReminders]);
  const lanes = useMemo(() => {
    const byLane: Record<Lane, TaskLedgerTask[]> = { blocked: [], doing: [], todo: [], done: [] };
    for (const task of visibleTasks) byLane[task.status]?.push(task);
    for (const lane of laneOrder) {
      byLane[lane].sort((left, right) => left.priority - right.priority || (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt));
    }
    return byLane;
  }, [visibleTasks]);

  const openCount = visibleTasks.filter((task) => task.status !== "done").length;

  // 알림을 누르면 main 이 창을 다시 불러오지 않고 신호만 보낸다. 그 업무가 있는 칸을 펼치고 그 자리로 옮긴다.
  useEffect(
    () =>
      subscribeWorkItemFocus((request) => {
        if (classifyWorkItemFocusTarget(request) !== "office_task") return false;
        setFocusRequest({ taskId: request.workItemId, waitingFor: null });
        return true;
      }),
    [],
  );

  useEffect(() => {
    if (!focusRequest || !loaded) return;
    const task = focusRequest.taskId ? tasks.find((item) => item.id === focusRequest.taskId) : undefined;
    if (focusRequest.taskId && !task) {
      // 방금 멈춘 업무가 아직 목록에 없으면 한 번만 다시 읽고, 새 목록이 올 때까지 기다린다.
      if (focusRequest.waitingFor === null) {
        setFocusRequest({ ...focusRequest, waitingFor: tasks });
        void refresh("", true);
        return;
      }
      if (focusRequest.waitingFor === tasks) return;
    }
    if (task?.id.startsWith('inbox:schedule-briefing:') && !includeReminders) { setIncludeReminders(true); return; }
    setFocusRequest(null);
    if (task) {
      if (task.status === "done") setShowDone(true);
      const index = lanes[task.status]?.findIndex((item) => item.id === task.id) ?? -1;
      if (index >= (visibleCounts[task.status] ?? 5)) {
        setVisibleCounts((current) => ({ ...current, [task.status]: index + 1 }));
      }
    }
    setFocusedTaskId(task?.id ?? "");
    pendingScrollRef.current = { taskId: task?.id ?? "", attempts: 0 };
  }, [focusRequest, loaded, tasks, lanes, visibleCounts, refresh, includeReminders]);

  // 칸을 펼친 화면이 그려진 뒤에 옮긴다(펼치기 전에는 그 업무가 화면에 없다).
  useEffect(() => {
    const pending = pendingScrollRef.current;
    const board = boardRef.current;
    if (!pending || !board) return;
    const item = pending.taskId
      ? Array.from(board.querySelectorAll<HTMLElement>("[data-task-id]")).find((node) => node.dataset.taskId === pending.taskId)
      : null;
    // 펼친 칸이 아직 안 그려졌으면 다음 그리기를 기다린다. 그래도 없으면 판 맨 위로 간다.
    if (pending.taskId && !item && pending.attempts < 3) {
      pending.attempts += 1;
      return;
    }
    pendingScrollRef.current = null;
    const target = item ?? board.querySelector<HTMLElement>('[data-task-lane="blocked"]') ?? board;
    target.scrollIntoView({ block: item ? "center" : "start" });
    // 질문에 답해야 하는 업무면 바로 적을 수 있게 입력칸에 커서를 둔다.
    item?.querySelector<HTMLInputElement>("form input")?.focus({ preventScroll: true });
  });

  useEffect(() => {
    if (!focusedTaskId) return;
    const timer = window.setTimeout(() => setFocusedTaskId(""), 8000);
    return () => window.clearTimeout(timer);
  }, [focusedTaskId]);

  async function answer(task: TaskLedgerTask) {
    const text = (answers[task.id] ?? "").trim();
    if (!text || busy || mutationPending.current) return;
    mutationPending.current = true;
    setPendingAction({ id: task.id, kind: "answer" });
    const bridge = createDesktopBridge();
    try {
      const result = await bridge.answerTaskQuestion({ taskId: task.id, answer: text, askedAt: openQuestion(task)?.askedAt });
      if (result.status !== "local_memory_task_answered") {
        setNotice(result.userMessage || "답을 전달하지 못했습니다.");
        return;
      }
      setAnswers((current) => ({ ...current, [task.id]: "" }));
      if (Array.isArray(result.tasks)) {
        setTasks(result.tasks);
        setNotice(result.userMessage || "답을 저장했습니다.");
      } else {
        await refresh(result.userMessage || "답을 저장했습니다.");
      }
    } catch {
      setNotice("답을 전달하지 못했습니다.");
    } finally {
      mutationPending.current = false;
      setPendingAction(null);
    }
  }

  async function complete(task: TaskLedgerTask) {
    if (busy || mutationPending.current) return;
    mutationPending.current = true;
    setPendingAction({ id: task.id, kind: "complete" });
    const bridge = createDesktopBridge();
    try {
      const result = await bridge.completeTask({ taskId: task.id, result: "사용자가 끝냈다고 표시" });
      if (result.status !== "local_memory_task_completed") {
        setNotice(result.userMessage || "끝낸 것으로 표시하지 못했습니다.");
        return;
      }
      if (Array.isArray(result.tasks)) {
        setTasks(result.tasks);
        setNotice(result.userMessage || "끝난 것으로 표시했습니다.");
      } else {
        await refresh(result.userMessage || "끝난 것으로 표시했습니다.");
      }
    } catch {
      setNotice("끝낸 것으로 표시하지 못했습니다.");
    } finally {
      mutationPending.current = false;
      setPendingAction(null);
    }
  }

  async function runTask(task?: TaskLedgerTask, action?: "pause" | "resume" | "retry") {
    if (busy || mutationPending.current) return;
    mutationPending.current = true;
    setPendingAction({ id: task?.id ?? "new", kind: "run" });
    try {
      const bridge = createDesktopBridge();
      const result = task && action
        ? await bridge.controlTaskExecution({ taskId: task.id, action })
        : await bridge.runTask(task ? { taskId: task.id, title: task.title, requestText: task.description || task.title }
          : {
              requestText: requestText.trim(),
              ...(scheduledFor ? { scheduledFor: new Date(scheduledFor).toISOString() } : {}),
              repeat,
              ...buildAssignedTaskFields(
                roster.find((option) => option.id === assigneeId),
                (option) => resolveModyTeammateWorkPackIds({ templateId: option.templateId, workPackIds: option.workPackIds }),
              ),
            });
      if (!result.status.startsWith("task_execution_") || ["task_execution_invalid", "task_execution_missing"].includes(result.status)) {
        setNotice(result.userMessage || "업무를 저장하지 못했습니다. 다시 시도해 주세요.");
        return;
      }
      if (Array.isArray(result.tasks)) setTasks(result.tasks);
      setNotice(result.userMessage || "업무 상태를 갱신했습니다.");
      if (!task) {
        const summary = requestText.trim().replace(/\s+/gu, " ");
        setReceipt(`맡긴 일: ${summary.length > 60 ? `${summary.slice(0, 60)}…` : summary}`);
        setRequestText(""); setScheduledFor(""); setRepeat("none"); setAssigneeId(""); setShowNewTask(false);
      }
    } catch {
      setNotice("업무를 저장하지 못했습니다. 입력은 유지됩니다. 다시 시도해 주세요.");
    } finally {
      mutationPending.current = false;
      setPendingAction(null);
    }
  }

  return (
    <section ref={boardRef} id="task-board" className={styles.board} aria-label="업무판" data-task-board-open={openCount}>
      <header>
        <div>
          <strong>업무판</strong>
          <p>{openCount > 0 ? `진행할 업무 ${openCount}건` : "맡긴 일과 결과를 확인하세요."}</p>
        </div>
        <div className={styles.headerActions}>
        <button type="button" onClick={() => void refresh()} disabled={busy || pendingAction !== null}>
          {busy ? "읽는 중" : "다시 읽기"}
        </button>
        <button type="button" className={styles.newTaskButton} onClick={() => setShowNewTask((value) => !value)} aria-expanded={showNewTask}>
          {showNewTask ? "입력 접기" : "업무 맡기기"}
        </button>
        </div>
      </header>
      <BackgroundWorkStatus compact />
      {showNewTask ? (
        <form className={styles.newTask} aria-label="새 업무" onSubmit={(event) => { event.preventDefault(); void runTask(); }}>
          <label>처리할 업무<textarea aria-label="처리할 업무" value={requestText} onChange={(event) => setRequestText(event.target.value)} rows={3} maxLength={12000} required /></label>
          <label>담당<select aria-label="담당" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} data-task-assignee-select="true">
            <option value="">기본 비서가 알아서</option>
            {roster.map((option) => (
              <option key={option.id} value={option.id}>{option.name}{option.roleTitle ? ` · ${option.roleTitle}` : ""}</option>
            ))}
          </select></label>
          <div className={styles.schedule}>
            <label>시작 시간<input aria-label="시작 시간" type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} /></label>
            <label>반복<select aria-label="반복" value={repeat} onChange={(event) => setRepeat(event.target.value as typeof repeat)}>
              <option value="none">반복 안 함</option><option value="daily">매일</option><option value="weekly">매주</option>
            </select></label>
          </div>
          <small>시간을 비우면 바로 시작합니다. 예약 업무는 앱이 켜져 있을 때 실행하며, 놓친 일정은 다음 실행 때 한 번 확인합니다.</small>
          <button type="submit" disabled={busy || pendingAction !== null || !requestText.trim()}>{pendingAction?.id === "new" ? "저장 중" : scheduledFor ? "업무 예약" : "업무 시작"}</button>
        </form>
      ) : null}

      {notice ? (
        <small role="status" className={styles.notice}>
          {notice}
        </small>
      ) : null}

      {receipt ? (
        <p className={styles.receipt} aria-live="polite" data-delegation-receipt="task_board">
          <span>{receipt}</span>
          {delegationReceiptLinks().map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(event) => {
                event.preventDefault();
                openReceiptLink(link.href);
              }}
            >
              {link.label}
            </a>
          ))}
        </p>
      ) : null}

      {visibleTasks.length === 0 && !busy && loaded && !notice ? (
        <p className={styles.empty} data-task-board-empty="true">
          아직 올라온 일이 없습니다. 메일을 연결하거나 직원에게 일을 맡기면 여기에 쌓입니다.
        </p>
      ) : null}

      {reminderCount > 0 && <button type="button" className={styles.doneToggle} aria-pressed={includeReminders} onClick={() => setIncludeReminders(!includeReminders)}>{includeReminders ? '일정·마감 알림 접기' : `일정·마감 알림 ${reminderCount}건 보기`}</button>}
      {laneOrder.map((lane) => {
        const items = lanes[lane];
        if (items.length === 0) return null;
        if (lane === "done" && !showDone) {
          return (
            <button
              key={lane}
              type="button"
              className={styles.doneToggle}
              onClick={() => setShowDone(true)}
            >
              끝난 일 {items.length}건 보기
            </button>
          );
        }
        return (
          <section key={lane} className={styles.lane} data-task-lane={lane}>
            <h3>
              {laneLabels[lane]} <b>{items.length}</b>
            </h3>
            <ul>
              {items.slice(0, visibleCounts[lane] ?? 5).map((task) => {
                const question = openQuestion(task);
                const approvalHref = taskApprovalHref(task);
                return (
                  <li
                    key={task.id}
                    data-task-id={task.id}
                    data-task-status={task.status}
                    data-task-focused={focusedTaskId === task.id ? "true" : undefined}
                  >
                    <div className={styles.taskHead}>
                      <strong>{task.title}</strong>
                      <small>
                        {originLabel(task)}
                        {task.updatedAt || task.createdAt ? ` · ${shortDate(task.updatedAt ?? task.createdAt)}` : ""}
                      </small>
                      {task.assigneeName ? (
                        <span className={styles.assigneeChip} data-task-assignee={task.assigneeId || "assigned"}>
                          담당 · {task.assigneeName}
                        </span>
                      ) : null}
                    </div>
                    {task.description ? <p className={styles.taskBody}>{task.description}</p> : null}
                    {task.execution?.state === "queued" && task.execution.dueAt ? <small>예정: {new Date(task.execution.dueAt).toLocaleString("ko-KR")}{task.execution.repeat === "daily" ? " · 매일" : task.execution.repeat === "weekly" ? " · 매주" : ""}</small> : null}
                    {task.execution?.state === "paused" ? <small>일시 중지됨</small> : null}
                    {task.execution?.state === "waiting_approval" ? (
                      <p role="status">
                        {task.execution.approvalCardId
                          ? "메일 초안을 승인함에 올려 두었어요. 받는 사람과 내용을 보고 보낼지 정해 주세요."
                          : "외부 작업은 실행하지 않았습니다. 준비한 결과를 확인한 뒤 해당 기능의 최종 확인 화면에서 승인해 주세요."}
                      </p>
                    ) : null}
                    {task.execution?.error ? <p role="status" className={styles.notice}>{task.execution.error}</p> : null}
                    {question ? (
                      <form
                        className={styles.question}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void answer(task);
                        }}
                      >
                        <span>{question.question}</span>
                        <div>
                          <input
                            value={answers[task.id] ?? ""}
                            onChange={(event) =>
                              setAnswers((current) => ({ ...current, [task.id]: event.target.value }))
                            }
                            placeholder="여기에 답을 적어 주세요"
                            aria-label={`${task.title} 질문에 답하기`}
                            maxLength={1000}
                            onKeyDown={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }}
                            disabled={pendingAction !== null}
                          />
                          <button type="submit" disabled={busy || pendingAction !== null || !(answers[task.id] ?? "").trim()}>
                            {pendingAction?.id === task.id && pendingAction.kind === "answer" ? "전달 중" : "답하기"}
                          </button>
                        </div>
                      </form>
                    ) : null}
                    {task.result ? (
                      <p className={styles.result}>{task.result}</p>
                    ) : null}
                    {task.status !== "done" ? (
                      <div className={styles.taskActions}>
                        {approvalHref ? (
                          <a className={styles.approvalLink} href={approvalHref} data-task-approval-link={task.execution?.approvalCardId ? "card" : "approval"}>
                            {task.execution?.state === "waiting_approval" ? "승인함에서 확인" : "승인함에서 보기"}
                          </a>
                        ) : null}
                        {!task.execution && !question && !approvalHref ? <button type="button" onClick={() => void runTask(task)} disabled={busy || pendingAction !== null}>업무 시작</button> : null}
                        {task.execution?.state === "failed" ? <button type="button" onClick={() => void runTask(task, "retry")} disabled={busy || pendingAction !== null}>다시 시도</button> : null}
                        {task.execution?.state === "paused" ? <button type="button" onClick={() => void runTask(task, "resume")} disabled={busy || pendingAction !== null}>이어가기</button> : null}
                        {task.execution && ["queued", "running"].includes(task.execution.state) ? <button type="button" onClick={() => void runTask(task, "pause")} disabled={busy || pendingAction !== null}>일시 중지</button> : null}
                        <button type="button" onClick={() => void complete(task)} disabled={busy || pendingAction !== null}>
                          {pendingAction?.id === task.id && pendingAction.kind === "complete" ? "저장 중" : "끝났어요"}
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {items.length > (visibleCounts[lane] ?? 5) ? (
              <button type="button" className={styles.doneToggle} onClick={() => setVisibleCounts((current) => ({ ...current, [lane]: (current[lane] ?? 5) + 5 }))}>
                {laneLabels[lane]} 더 보기 ({items.length - (visibleCounts[lane] ?? 5)}건 남음)
              </button>
            ) : null}
            {lane === "done" ? (
              <button type="button" className={styles.doneToggle} onClick={() => setShowDone(false)}>끝난 일 접기</button>
            ) : null}
          </section>
        );
      })}
    </section>
  );
}

export default TaskBoard;
