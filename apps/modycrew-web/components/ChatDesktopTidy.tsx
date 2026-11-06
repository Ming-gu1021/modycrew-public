"use client";
import { useEffect, useRef, useState } from "react";
import type { DesktopBridgeApi } from "@/lib/desktop-bridge";
import { requestDesktopTidy, requestDesktopFileAccess, type DesktopTidyResult, type DesktopTidyScope } from "@/lib/chat-desktop-tidy";
import styles from "./ChatDesktopTidy.module.css";

const working = (status: string) => ["scanning", "applying", "reverting"].includes(status);
export default function ChatDesktopTidy({ bridge, scope, onStatus, command, onCommandConsumed, onAccessChanged, onBeforeStart, refreshKey = 0 }: {
  bridge: DesktopBridgeApi | null | undefined; scope: DesktopTidyScope; onStatus?: (result: DesktopTidyResult) => void;
  command?: { id: string; action: "prepare" | "apply" | "cancel" }; onCommandConsumed?: (id: string) => void;
  onAccessChanged?: () => void; onBeforeStart?: () => Promise<unknown>; refreshKey?: number;
}) {
  const [result, setResult] = useState<DesktopTidyResult>({ status: "loading", files: [] });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const consumed = useRef("");
  const onStatusRef = useRef(onStatus); onStatusRef.current = onStatus;
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    requestDesktopTidy(bridge, scope, "status").then(value => { if (alive && !busy.current) { setResult(value); if (value.status !== "not_started") onStatusRef.current?.(value); } }).catch(e => { if (alive && !busy.current) { setError(e.message); setResult({ status: "not_started", files: [] }); } });
    return () => { alive = false; };
    // Caller keys this card by workspace, thread and request, preserving isolation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!working(result.status)) return;
    let alive = true, reading = false;
    const timer = window.setInterval(async () => {
      if (reading) return;
      reading = true;
      try { const value = await requestDesktopTidy(bridge, scope, "status"); if (alive && value.status !== "not_started") setResult(value); }
      catch { /* The initiating call reports its failure without losing the plan. */ }
      finally { reading = false; }
    }, 600);
    return () => { alive = false; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.status]);
  async function run(action: "prepare" | "apply" | "revert" | "cancel" | "open") {
    if (busy.current && action !== "cancel") return;
    if (action === "apply" && result.status !== "ready") { setError("먼저 이동 목록을 확인해 주세요. 처리된 작업은 다시 실행하지 않습니다."); return; }
    const oldStatus = result.status;
    busy.current = true; setPending(true); setError("");
    const phase = action === "prepare" ? "scanning" : action === "apply" ? "applying" : action === "revert" ? "reverting" : "";
    if (phase) { setResult(current => ({ ...current, status: phase })); onStatusRef.current?.({ ...result, status: phase }); }
    try {
      if (action === "prepare" || action === "apply") {
        await onBeforeStart?.();
        if (!mounted.current) return;
      }
      let value = await requestDesktopTidy(bridge, scope, action, result.approvalToken);
      if (mounted.current && action === "prepare" && value.status === "ready" && value.access?.mode === "auto") {
        if (mounted.current) { setResult({ ...value, status: "applying" }); onStatusRef.current?.({ ...value, status: "applying" }); }
        value = await requestDesktopTidy(bridge, scope, "apply", value.approvalToken, { automatic: true });
      }
      if (mounted.current) { setResult(value); onStatusRef.current?.(value); }
    } catch (e) {
      if (mounted.current) {
        const message = e instanceof Error ? e.message : "처리하지 못했습니다. 다시 확인해 주세요.";
        setError(message); setResult(current => ({ ...current, status: oldStatus }));
        onStatusRef.current?.({ ...result, status: oldStatus, userMessage: message });
      }
    } finally { if (action !== "cancel" || !working(oldStatus)) { busy.current = false; if (mounted.current) setPending(false); } }
  }
  const runRef = useRef(run); runRef.current = run;
  const consumedRef = useRef(onCommandConsumed); consumedRef.current = onCommandConsumed;
  useEffect(() => {
    if (!command || command.id === consumed.current || result.status === "loading" || (busy.current && command.action !== "cancel")) return;
    consumed.current = command.id;
    consumedRef.current?.(command.id);
    void runRef.current(command.action);
  }, [command, result.status, pending]);
  async function enableAndPrepare() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    try {
      await requestDesktopFileAccess(bridge, scope, "approval");
      if (mounted.current) { onAccessChanged?.(); busy.current = false; await run("prepare"); }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "접근 설정을 저장하지 못했습니다."); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  const active = working(result.status), disabled = result.access?.mode === "disabled";
  const label = result.status === "scanning" ? "바탕화면 파일 확인 중" : result.status === "applying" ? `파일 정리 중 · ${result.moved || 0}/${result.total || 0}개 이동` : result.status === "reverting" ? `되돌리는 중 · ${result.restored || 0}개` :
    result.status === "ready" ? `${result.total}개 파일 정리 준비` : result.status === "completed" ? `${result.moved}개 파일을 정리했습니다` : result.status === "reverted" ? `${result.restored}개 파일을 되돌렸습니다` : result.status === "empty" ? "정리할 일반 파일이 없습니다" : result.status === "cancelled" ? `정리 취소${result.moved ? ` · ${result.moved}개 이동됨` : ""}` : result.status === "partial" || result.status === "interrupted" ? `${result.moved || 0}개 이동 · 확인할 파일이 있습니다` : "바탕화면 정리";
  return <section className={styles.card} aria-label="바탕화면 정리" data-desktop-tidy={result.status}>
    <div className={styles.heading} role="status">{active ? <span aria-hidden="true" className={styles.pulse} /> : null}<strong>{label}</strong></div>
    {["not_started", "loading"].includes(result.status) ? <p>일반 파일을 종류별 폴더로 모읍니다. 기존 폴더와 바로가기는 그대로 둡니다.</p> : null}
    {result.status === "ready" ? <p>아래 목록대로 이동합니다. 원본 삭제·덮어쓰기는 하지 않습니다.</p> : null}
    {disabled ? <p>이 대화의 파일 접근이 꺼져 있습니다.</p> : result.access?.mode === "auto" ? <p>자동 정리 허용 · 입력창 권한 메뉴에서 끌 수 있습니다.</p> : null}
    {result.files.length ? <details open={result.status === "ready"}><summary>이동 목록 · {result.total}개{result.skipped ? ` / ${result.skipped}개 유지` : ""}</summary><ul>{result.files.map(file => <li key={file.name}><span>{file.name}</span><span>→ {file.destination}</span>{file.detail ? <small>{file.detail}</small> : null}</li>)}</ul></details> : null}
    {result.userMessage ? <p>{result.userMessage}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className={styles.actions}>
      {disabled && ["not_started", "ready"].includes(result.status) ? <button disabled={pending || !bridge?.isAvailable} onClick={() => void enableAndPrepare()}>파일 접근 허용하고 진행</button> : null}
      {result.status === "not_started" && !disabled ? <button disabled={pending || !bridge?.isAvailable} onClick={() => void run("prepare")}>진행하기</button> : null}
      {result.status === "ready" ? <><button disabled={pending || disabled} onClick={() => void run("apply")}>승인하고 정리</button><button disabled={pending} onClick={() => void run("cancel")}>취소</button></> : null}
      {active ? <button onClick={() => void run("cancel")}>중지</button> : null}
      {!active && (result.moved || 0) > 0 ? <><button disabled={pending} onClick={() => void run("open")}>정리 폴더 열기</button><button disabled={pending} onClick={() => void run("revert")}>정리 되돌리기</button></> : null}
    </div>
  </section>;
}
