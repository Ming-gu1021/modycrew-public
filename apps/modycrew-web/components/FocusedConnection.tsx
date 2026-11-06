"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectorDrawer, type ConnectorConnectPayload, type ConnectorConnectResult } from "./ConnectorDrawer";
import { connectorBrandIconSrc, type ConnectorDefinition } from "@/lib/connectors";
import { createDesktopBridge, type ConnectorStatusRecord } from "@/lib/desktop-bridge";
import { navigateInternalPath, normalizeInternalReturnPath } from "@/lib/safe-navigation";
import styles from "./FocusedConnection.module.css";

type Props = {
  connector: ConnectorDefinition;
  preferredMode: "read" | "write" | "send";
  returnHref: string;
  onConnect: (id: string, payload: ConnectorConnectPayload) => Promise<ConnectorConnectResult>;
  onSwitchConnector: (id: string) => void;
};

const readyStatuses = new Set(["imap_connected", "mail_loaded", "freebusy_loaded", "oauth_token_ready", "telegram_command_inbox_ready", "slack_command_inbox_ready", "discord_command_inbox_ready", "connector_ready", "connected"]);
const readableRecoveryKinds = new Set(["ready", "permission_required", "oauth_write_scope_required"]);

export function FocusedConnection({ connector, preferredMode, returnHref, onConnect, onSwitchConnector }: Props) {
  const [record, setRecord] = useState<ConnectorStatusRecord>();
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [hasResult, setHasResult] = useState(false);
  const pendingSince = useRef(0);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const permissions = record?.permissions as (ConnectorStatusRecord["permissions"] & { mailSend?: boolean }) | undefined;
  const connected = Boolean(record && readyStatuses.has(record.status) && (!record.recovery || readableRecoveryKinds.has(record.recovery.kind)));
  const hasRequiredPermission = preferredMode === "send" ? permissions?.mailSend === true : preferredMode === "write" ? permissions?.calendarWrite === true : true;
  const ready = connected && hasRequiredPermission;
  const isMail = connector.category === "mail";
  const isCalendar = connector.category === "calendar";
  // 돌아갈 곳은 같은 앱 안의 경로만 쓴다. 밖으로 풀리는 값이 들어오면 오피스로 돌아간다.
  const safeReturnHref = normalizeInternalReturnPath(returnHref) || "/office";
  const leave = () => {
    try {
      navigateInternalPath(safeReturnHref);
    } catch {
      navigateInternalPath("/office");
    }
  };

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const bridge = createDesktopBridge();
      if (!bridge.isAvailable) throw new Error("연결 상태는 설치 앱에서 확인할 수 있습니다.");
      const result = await bridge.listConnectorStatuses();
      const next = result.connectors?.find(item => item.connectorId === connector.id);
      if (!alive.current) return;
      setRecord(next);
      setError("");
      const nextPermissions = next?.permissions as (ConnectorStatusRecord["permissions"] & { mailSend?: boolean }) | undefined;
      const nextReady = next && readyStatuses.has(next.status) && (!next.recovery || readableRecoveryKinds.has(next.recovery.kind)) &&
        (preferredMode !== "send" || nextPermissions?.mailSend === true) &&
        (preferredMode !== "write" || nextPermissions?.calendarWrite === true);
      // An existing read connection must not complete a pending send-consent request.
      if (nextReady && pendingSince.current && Date.parse(next.lastCheckedAt || "") >= pendingSince.current) {
        pendingSince.current = 0;
        setPending(false);
        setEditing(false);
      }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : "연결 상태를 확인하지 못했습니다. 다시 확인해 주세요.");
    } finally {
      inFlight.current = false;
      if (alive.current) { setLoaded(true); setRefreshing(false); }
    }
  }, [connector.id, preferredMode]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 2500);
    return () => window.clearInterval(timer);
  }, [pending, refresh]);

  const connect = async (id: string, payload: ConnectorConnectPayload) => {
    const startedAt = Date.now();
    const result = await onConnect(id, payload);
    setHasResult(true);
    if (result.authorizationUrl) { pendingSince.current = startedAt; setPending(true); }
    else if (readyStatuses.has(result.status)) { setPending(false); setEditing(false); }
    await refresh();
    return result;
  };

  const title = !loaded ? "연결 상태 확인 중" : error ? "상태 확인 필요" : pending ? "브라우저에서 동의해 주세요" : ready ? "연결되었습니다" : connected ? (preferredMode === "send" ? "발송 권한을 추가해 주세요" : "일정 등록 권한을 추가해 주세요") : record?.status === "site_login_stored" ? "계정 정보 저장됨 · 연결 미확인" : "계정을 연결해 주세요";
  const detail = !loaded ? "저장된 계정과 사용 가능한 기능을 확인합니다." : error ? "아래에서 다시 확인하거나 연결 정보를 확인해 주세요." : pending ? "동의가 끝나면 이 화면에 자동으로 반영됩니다." : ready ? (isMail ? "받은 메일을 확인하고, 업무 정리와 답장 작성을 이어가세요." : "연결한 도구로 업무를 이어갈 수 있습니다.") : connected ? "기존 연결은 유지됩니다. 필요한 권한만 추가합니다." : record?.status === "site_login_stored" ? "계정 정보가 보관되어 있습니다. 실제 연결과 업무 사용 가능 여부는 별도로 확인해 주세요." : connector.method === "oauth" ? "브라우저에서 계정을 선택하고 요청 권한을 확인하세요." : "아래에 계정 정보를 입력하면 연결을 확인합니다.";

  return <section className={styles.page} aria-label={`${connector.label} 연결`} data-connection-state={!loaded ? "loading" : error ? "error" : pending ? "pending" : ready ? "ready" : "setup"}>
    <nav className={styles.breadcrumb} aria-label="연결 탐색"><a href="/connect">연결</a><span aria-hidden="true">/</span><span>{connector.label}</span></nav>
    <header className={styles.header}>
      <div className={styles.identity}>
        <span className={styles.logo} aria-hidden="true">{connectorBrandIconSrc(connector.id) ? <img src={connectorBrandIconSrc(connector.id)!} width={32} height={32} alt=""/> : connector.iconText}</span>
        <div><h1>{connector.label}</h1><p>{isMail ? "메일과 업무를 한곳에서" : "업무 도구 연결"}</p></div>
      </div>
      <button className={styles.refresh} onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "확인 중…" : "상태 새로고침"}</button>
    </header>

    <div className={styles.surface}>
      <div className={styles.status} aria-live="polite">
        <span className={styles.statusLabel}>{ready && !pending && !error ? "연결됨" : pending ? "동의 대기" : "연결 상태"}</span>
        <h2>{title}</h2><p>{detail}</p>
        {record?.emailAddress && <p className={styles.account}>{record.emailAddress}</p>}
      </div>
      {loaded && !error && (connected || pending) && <dl className={styles.permissions} aria-label="사용 가능한 기능">
        <div><dt>{isMail ? "메일 읽기" : isCalendar ? "일정 확인" : "계정 연결"}</dt><dd>{connected ? "사용 가능" : "연결 후 사용"}</dd></div>
        {isMail && <div><dt>메일 발송</dt><dd>{permissions?.mailSend ? "최종 확인 후 발송" : "추가 동의 필요"}</dd></div>}
        {isCalendar && <div><dt>일정 등록</dt><dd>{permissions?.calendarWrite ? "최종 확인 후 등록" : "추가 동의 필요"}</dd></div>}
      </dl>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {loaded && ready && !pending && !editing ? <div className={styles.actions}>
        <a className={styles.primary} href={safeReturnHref}>{preferredMode === "send" ? "검토하던 메일로 돌아가기" : isMail ? "메일 업무로 돌아가기" : "업무로 돌아가기"}<span aria-hidden="true">→</span></a>
        <button onClick={() => setEditing(true)}>연결 관리</button>
      </div> : loaded && <div className={styles.form}>
        <ConnectorDrawer presentation="inline" connector={connector} statusRecord={record} preferredMode={preferredMode} onConnect={connect} onSwitchConnector={onSwitchConnector} onClose={() => { if (ready) setEditing(false); else leave(); }}/>
      </div>}
      {(!hasResult || (ready && !pending && !editing)) && <p className={styles.footnote}>{isMail ? "메일은 내용을 검토하고 최종 확인한 뒤에만 발송됩니다." : "외부 작업은 내용을 확인하고 승인한 뒤에 실행됩니다."}</p>}
    </div>

    <details className={styles.help}><summary>연결 도움말</summary>
      <ol>{connector.setupGuide?.steps.map((step, index) => <li key={step.title}><span aria-hidden="true">{index + 1}</span><div><h3>{step.title}</h3><p>{step.description}</p></div></li>)}</ol>
      <p>계정과 권한을 확인하기 어렵다면 연결 상태를 새로고침하거나 연결 관리를 열어 다시 확인하세요.</p>
      {record?.lastCheckedAt && <p>마지막 확인: {new Date(record.lastCheckedAt).toLocaleString("ko-KR")}</p>}
    </details>
  </section>;
}
