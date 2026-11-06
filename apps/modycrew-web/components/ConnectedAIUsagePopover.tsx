"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createDesktopBridge, type AIUsageSummaryResult } from "@/lib/desktop-bridge";
import { useAnchoredPopover } from "@/lib/use-anchored-popover";
import { connectedUsageProviders, currentUsageWindows, providerUsageHeadline, providerUsageName, type ProviderLimit } from "@/lib/provider-usage-presentation";
import styles from "./ConnectedAIUsagePopover.module.css";

export type ConnectedUsageSnapshot = {
  connections: Array<{ provider?: string; status?: string; hasLocalKey?: boolean; modelAvailability?: { state: string; models: Array<{ id: string; label?: string; availability: string }> } }>;
  summary: (AIUsageSummaryResult & { providerLimits?: ProviderLimit[] }) | null;
  incomplete: boolean;
};

async function bounded<T>(request: () => Promise<T>, timeout = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve().then(request), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("usage_timeout")), timeout); })]); }
  finally { clearTimeout(timer); }
}

export async function loadConnectedUsage(): Promise<ConnectedUsageSnapshot> {
  const bridge = createDesktopBridge();
  const [keys, usage, runtimes, local] = await Promise.allSettled([
    bounded(() => bridge.getAIProviderStatus()),
    bounded(async () => { if (!bridge.getAIUsageSummary) throw new Error("unsupported"); const value = await bridge.getAIUsageSummary(7, true); if (value.status !== "ai_usage_loaded") throw new Error("usage_unavailable"); return value; }),
    bounded(() => bridge.listSubscriptionAIRuntimes()),
    bounded(() => bridge.listLocalAIModels()),
  ]);
  return {
    connections: [
      ...(keys.status === "fulfilled" ? keys.value.providers ?? [] : []),
      ...(runtimes.status === "fulfilled" ? (runtimes.value.runtimes ?? []).filter(row => row.installed && row.loggedIn).map(row => ({ provider: row.providerId, status: "connected", modelAvailability: row.modelAvailability })) : []),
      ...(local.status === "fulfilled" && local.value.models?.length ? [{ provider: "local", status: "connected" }] : []),
    ],
    summary: usage.status === "fulfilled" ? usage.value : null,
    incomplete: [keys, usage, runtimes, local].some(result => result.status === "rejected"),
  };
}

export default function ConnectedAIUsagePopover({ collapsed, load = loadConnectedUsage }: { collapsed: boolean; load?: () => Promise<ConnectedUsageSnapshot> }) {
  const id = `connected-usage-${useId().replace(/:/g, "")}`;
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const open = useAnchoredPopover(trigger, panel, "right");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<ConnectedUsageSnapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let active = true;
    setBusy(true); setSnapshot(null); setError("");
    void bounded(load, 16000).then(value => { if (active) setSnapshot(value); }, () => { if (active) setError("사용량을 확인하지 못했습니다. 다시 시도해 주세요."); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open, revision, load]);
  useEffect(() => {
    if (!open) return;
    const refresh = () => setRevision(value => value + 1);
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [open]);
  const data = snapshot?.summary;
  const ids = connectedUsageProviders(snapshot?.connections ?? [], data?.providerLimits);
  const groups = (data?.groups ?? []).filter(group => ids.includes(group.provider));
  return <>
    <button ref={trigger} type="button" className={styles.trigger} popoverTarget={id} aria-haspopup="dialog" aria-expanded={open} aria-label="연결 AI와 사용량" title="연결 AI와 사용량">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9h-9V3Z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15V3.5Z"/></svg>
      {!collapsed && <span>AI 사용량</span>}
    </button>
    <div id={id} ref={panel} popover="auto" role="dialog" aria-label="연결 AI와 사용량" className={styles.panel}>
      <header className={styles.heading}><strong>연결된 AI</strong><button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="AI 사용량 닫기">×</button></header>
      <p className={styles.note}>서비스별 한도와 크레딧</p>
      {busy && <p role="status">사용량 확인 중…</p>}
      {error && <p role="alert" className={styles.warning}>{error}</p>}
      {snapshot?.incomplete && <p className={styles.warning} role="status">일부 연결을 확인하지 못했습니다. 확인된 연결만 표시합니다.</p>}
      {ids.map(provider => {
        const limit = data?.providerLimits?.find(row => row.provider === provider);
        const view = providerUsageHeadline(provider, limit, groups);
        const name = providerUsageName(provider);
        return <section key={provider} className={styles.service} aria-label={`${name} 사용량`}>
          <div className={styles.row}><strong>{name}</strong><span className={styles.value} data-low={view.remaining !== null && view.remaining <= 20}>{view.text}</span></div>
          {view.primary && <>
            <div className={styles.meter} role="meter" aria-label={`${name} 남은 한도`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.remaining!}><span style={{ width: `${view.remaining}%` }} data-low={view.remaining! <= 20}/></div>
            <div className={styles.row}><small>{view.primary.label}</small>{view.primary.resetsAt !== null && <small>{new Date(view.primary.resetsAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 초기화</small>}</div>
          </>}
          {view.credits && view.remaining !== null && <div className={styles.row}><small>추가 사용</small><span className={styles.value}>{view.credits}</span></div>}
          {view.api && !view.credits && <small>이 PC · 최근 7일 기록 {view.requests.toLocaleString("ko-KR")}건</small>}
        </section>;
      })}
      {!busy && snapshot && !ids.length && <p className={styles.note}>{snapshot.incomplete ? "연결 확인을 마치지 못했습니다." : "연결된 AI가 없습니다."}</p>}
      {ids.length > 0 && <details className={styles.details}><summary>한도 · 사용 기록 자세히</summary>
        {ids.map(provider => {
          const limit = data?.providerLimits?.find(row => row.provider === provider);
          const models = [...new Set((snapshot?.connections ?? []).filter(row => row.provider === provider && row.modelAvailability?.state === "available").flatMap(row => row.modelAvailability!.models.filter(model => model.availability === "available").map(model => model.label || model.id)))];
          return <section key={provider} className={styles.record}><strong>{providerUsageName(provider)}</strong>
            {models.length > 0 && <small>사용 가능 모델: {models.join(", ")}</small>}
            {currentUsageWindows(limit).map(row => <div key={row.id} className={styles.row}><span>{row.label}{row.accountWide === false ? " · 개별 모델" : ""}</span><span>{(Math.floor((100 - row.usedPercent) * 10 + 1e-8) / 10).toLocaleString("ko-KR")}% 남음</span></div>)}
            {limit?.source && <small>{limit.source}{limit.checkedAt && Number.isFinite(limit.checkedAt) ? ` · ${new Date(limit.checkedAt).toLocaleTimeString("ko-KR")} 조회` : ""}</small>}
            {groups.filter(group => group.provider === provider).map(group => <div className={styles.record} key={group.model}><div className={styles.row}><span>{group.model}</span><span>{group.requests.toLocaleString("ko-KR")}건</span></div><small>보고된 토큰 {group.totalTokens === null ? "확인 불가" : group.totalTokens.toLocaleString("ko-KR")}</small><small>사용량 포함 응답 {group.usageReported ?? 0}/{group.requests}건 · 실패 {group.failed ?? 0} · 취소 {group.cancelled ?? 0}</small></div>)}
          </section>;
        })}
        <p className={styles.note}>요청·토큰은 최근 7일 이 PC의 기록입니다. 다른 기기·계정의 사용이나 전체 청구액과 다릅니다. 기록이 없어도 실제 사용량이 0이라는 뜻은 아닙니다.</p>
        <p className={styles.note}>제공자가 알려 준 수치만 표시합니다. 크레딧·금액·토큰은 서로 환산하거나 합산하지 않습니다.</p>
        {data && (data.recordingWarning || data.unreadableRecords || data.limited) && <p className={styles.warning}>일부 사용 기록이 누락됐습니다.</p>}
      </details>}
      <footer className={styles.footer}><button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>새로고침</button><a href="/metrics/">상세 기록</a><a href="/account/#ai-connection">AI 연결 관리</a></footer>
    </div>
  </>;
}
