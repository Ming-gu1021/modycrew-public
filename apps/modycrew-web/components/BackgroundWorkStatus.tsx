"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readBackgroundService, type BackgroundPreferences, type BackgroundStatus } from "@/lib/background-service";
import { navigateInternalPathKeepingPreview } from "@/lib/safe-navigation";
import styles from "./BackgroundWorkStatus.module.css";

function timeLabel(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function openWork(path: string) {
  navigateInternalPathKeepingPreview(path);
}

const workerLabels: Record<string, string> = { ready: "확인됨", checking: "점검 중", starting: "시작 중", error: "연결 확인 필요", stale: "응답 확인 필요" };

export default function BackgroundWorkStatus({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<BackgroundStatus | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const active = useRef(false);
  const sequence = useRef(0);
  const mutation = useRef(false);

  const refresh = useCallback(async () => {
    if (mutation.current) return;
    const id = ++sequence.current;
    setRefreshing(true);
    try {
      const result = await readBackgroundService();
      if (!active.current || id !== sequence.current) return;
      setStatus(result);
      setError(result.status === "background_service_ready" || result.status === "desktop_required" ? "" : result.userMessage || "상태를 확인하지 못했습니다.");
    } catch {
      if (active.current && id === sequence.current) setError("앱의 응답이 늦어지고 있습니다. 상태를 다시 확인해 주세요.");
    } finally { if (active.current && id === sequence.current) setRefreshing(false); }
  }, []);

  useEffect(() => {
    active.current = true;
    void refresh();
    const check = () => { if (!document.hidden) void refresh(); };
    const timer = setInterval(check, 15000);
    document.addEventListener("visibilitychange", check);
    return () => { active.current = false; sequence.current++; clearInterval(timer); document.removeEventListener("visibilitychange", check); };
  }, [refresh]);

  async function configure(patch: Partial<BackgroundPreferences>) {
    if (mutation.current) return;
    mutation.current = true;
    ++sequence.current;
    setSaving(true);
    try {
      const result = await readBackgroundService(patch);
      if (!active.current) return;
      if (result.status !== "background_service_ready") { setError(result.userMessage || "설정을 저장하지 못했습니다."); return; }
      setStatus(result);
      setError("");
    } catch { if (active.current) setError("설정 저장을 확인하지 못했습니다. 상태를 다시 확인해 주세요."); }
    finally { mutation.current = false; if (active.current) { setSaving(false); setRefreshing(false); } }
  }

  const summary = status?.summary;
  const desktopOnly = status?.status === "desktop_required";
  const healthy = !error && status?.state === "ready";
  const title = error ? "상태 확인 필요" : desktopOnly ? "설치 앱에서 상시 업무를 켜세요" : !status || status.state === "starting" ? "상시 업무 준비 중"
    : status.state === "sleeping" ? "PC 절전 중" : status.state === "stopped" ? "상시 업무 중지됨" : status.state === "attention" ? "실행기 확인 필요"
    : summary?.running ? `AI가 업무 ${summary.running}건 처리 중` : summary?.connectionErrors ? "업무 연결을 확인해 주세요"
    : summary && (summary.enabledRules + summary.connections + summary.queued > 0) ? "다음 업무를 기다리고 있어요" : "맡긴 업무를 기다리고 있어요";

  return <details className={styles.panel} open={compact ? undefined : true} data-background-work-state={error ? "error" : status?.state || "loading"}>
    <summary className={styles.heading}>
      <span className={styles.dot} data-ready={healthy} aria-hidden="true" />
      <span><strong>상시 업무</strong><span className={styles.title}>{title}</span></span>
      <span className={styles.expand}>상태·설정</span>
    </summary>
    <div className={styles.body}>
      <p className={styles.hint}>PC와 앱이 켜져 있으면 창을 닫아도 켜 둔 자동화와 예약 업무를 이어갑니다. PC 종료·수동 절전 중에는 멈추고, 다시 실행하면 저장한 업무를 확인합니다.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {desktopOnly && <p className={styles.hint}>브라우저에서는 실행 상태를 확인할 수 없습니다. 설치된 ModyCrew를 열어 주세요.</p>}
      {summary && !error && <>
        <div className={styles.metrics} aria-label="실제 업무 현황">
          <span>처리 중 <b>{summary.running}</b></span><span>예정 <b>{summary.queued}</b></span>
          <span>답변·복구 필요 <b>{summary.waiting}</b></span><span>승인 대기 <b>{summary.approvals}</b></span>
          <span>오늘 완료한 업무 <b>{summary.completedToday}</b></span><span>자동화 규칙 <b>{summary.enabledRules}</b></span>
        </div>
        {summary.retrying > 0 && <p className={styles.hint}>일시적 연결 오류 {summary.retrying}건을 잠시 후 다시 시도합니다. 최대 3회 뒤에는 업무판에서 확인을 기다립니다.</p>}
        {summary.connectionErrors > 0 && <p className={styles.error}>연결 {summary.connectionErrors}개에 확인이 필요합니다. 자동화 설정의 메일·메신저에서 연결 상태를 확인하세요.</p>}
        <p className={styles.time}>최근 상태 확인 {timeLabel(status?.checkedAt)}{summary.nextRunAt ? ` · 다음 예약 ${timeLabel(summary.nextRunAt)}` : ""}</p>
        <ul className={styles.workers}>{status?.workers?.map((worker) => <li key={worker.id}><span>{worker.label}</span><span>{workerLabels[worker.state] || "확인 필요"} · {timeLabel(worker.lastSuccessAt)}</span></li>)}</ul>
      </>}
      {status?.preferences && <fieldset className={styles.preferences} disabled={saving}>
        <legend>이 PC의 상시 업무 설정</legend>
        <label><input type="checkbox" checked={status.preferences.openAtLogin} disabled={!status.canOpenAtLogin || saving} onChange={(event) => void configure({ openAtLogin: event.target.checked })} />PC 로그인 시 자동 시작</label>
        {!status.canOpenAtLogin && <small>자동 시작은 설치된 Windows 앱에서 설정할 수 있습니다.</small>}
        <label><input type="checkbox" checked={status.preferences.keepAwake} onChange={(event) => void configure({ keepAwake: event.target.checked })} />앱 실행 중 자동 절전 방지</label>
        <small>화면은 꺼져도 됩니다. 전원을 연결해 두세요. 노트북 덮개 닫기와 직접 선택한 절전은 막지 않습니다.{status.keepAwakeActive ? " 현재 적용 중입니다." : ""}</small>
        <label><input type="checkbox" checked={status.preferences.taskNotifications === true} onChange={(event) => void configure({ taskNotifications: event.target.checked })} />질문·승인 대기·예약 완료 시 PC 알림</label>
        <small>알림에는 업무 제목과 질문이 표시될 수 있습니다.</small>
      </fieldset>}
      <div className={styles.actions}>
        <button type="button" onClick={() => openWork("/office/?officeView=today#task-board")}>예약 업무 보기</button>
        <button type="button" onClick={() => openWork("/automation/")}>자동화 설정</button>
        <button type="button" onClick={() => openWork("/office/?officeView=approval")}>승인함 열기</button>
        {!desktopOnly && <button type="button" disabled={refreshing || saving} onClick={() => void refresh()}>{refreshing ? "상태 확인 중" : "상태 다시 확인"}</button>}
      </div>
      <p className={styles.safety}>메일 발송·일정 등록·외부 작업은 최종 승인을 기다립니다.</p>
    </div>
  </details>;
}
