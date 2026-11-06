"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ConnectorDefinition,
  categoryLabels,
  connectorBrandIconSrc,
  methodLabels,
  triggerLabels,
} from "@/lib/connectors";
import { createDesktopBridge } from "@/lib/desktop-bridge";
import type { ConnectorStatusRecord, MailServerDiscoveryResult } from "@/lib/desktop-bridge";
import type { WorkItem } from "@/lib/types";
import { useDrawerMotion } from "@/hooks/useDrawerMotion";
import styles from "./ConnectorDrawer.module.css";

type Props = {
  presentation?: "drawer" | "inline";
  connector: ConnectorDefinition | null;
  statusRecord?: ConnectorStatusRecord;
  preferredMode?: "read" | "write" | "send";
  initialImapUser?: string;
  initialWebmailUrl?: string;
  /** "credentials"면 역할 소개를 건너뛰고 바로 로그인 입력 단계로 연다 (채팅에서 입력창을 약속하고 연 경우). */
  initialStage?: "about" | "credentials";
  onClose: () => void;
  onConnect: (
    connectorId: string,
    payload: ConnectorConnectPayload,
  ) => Promise<ConnectorConnectResult>;
  /** gmail/outlook 처럼 계정 동의(OAuth)가 더 쉬운 주소를 감지했을 때, 해당 공식 커넥터로 갈아타는 콜백. */
  onSwitchConnector?: (connectorId: string) => void;
};

type DiscoveredMailServerCandidate = {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapStartTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpStartTls: boolean;
  source: string;
};

export type ConnectorConnectPayload = {
  method: ConnectorDefinition["method"];
  secret?: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpStartTls?: boolean;
  imapUser?: string;
  emailAddress?: string;
  confirmDiscoveredServer?: Pick<DiscoveredMailServerCandidate, "imapHost" | "imapPort">;
  siteUrl?: string;
  siteUserId?: string;
  appPath?: string;
  channelTargetId?: string;
  scope?: string;
  mode?: "read" | "write" | "send";
  warningAcknowledged?: boolean;
};

export type ConnectorConnectResult = {
  status: string;
  userMessage?: string;
  errorMessage?: string;
  authorizationUrl?: string;
  callbackUrl?: string;
  externalUrlOpened?: boolean;
  mailServerDiscovery?: {
    domain: string;
    provider: string;
    candidates: DiscoveredMailServerCandidate[];
  };
  recovery?: ConnectorStatusRecord["recovery"];
  stagedWorkItem?: WorkItem;
  fallbackStageStatus?: string;
  workAnalysis?: {
    summary: string;
    workingStyle: string[];
    improvementSuggestions: string[];
    automationOpportunities: string[];
    connectionPreparation?: string[];
    recipientGuidance?: string[];
    sendingPlanGuidance?: string[];
    learningSignals?: string[];
    bulkSendPlan?: {
      status?: string;
      targetGroups?: string[];
      excludedGroups?: string[];
      personalizationFields?: string[];
      sampleReviewChecklist?: string[];
      approvalGate?: string;
      privacyBoundary?: string;
    };
    followUpPlan?: {
      status?: string;
      waitingSignals?: string[];
      suggestedCadence?: string[];
      nextCheckLabel?: string;
      approvalGate?: string;
      privacyBoundary?: string;
    };
    recipientSourcePlan?: {
      status?: string;
      sourceTypes?: string[];
      fileReviewChecklist?: string[];
      matchingRules?: string[];
      approvalGate?: string;
      privacyBoundary?: string;
    };
    scenarioCoverage?: Array<{
      id: string;
      label: string;
      status: string;
      evidenceCount: number;
      guidance: string;
      nextAction: string;
    }>;
    riskNotes: string[];
    stats?: {
      totalMessages?: number;
      workItems?: number;
      reviewItems?: number;
      ignoredItems?: number;
      approvalCandidates?: number;
      replyCandidates?: number;
      calendarCandidates?: number;
      attachmentSignals?: number;
      bulkMailSignals?: number;
      recipientDecisionSignals?: number;
      followUpSignals?: number;
      recipientSourceSignals?: number;
    };
    privacyBoundary?: string;
  };
};

type ConnectorBulkSendPlan = NonNullable<ConnectorConnectResult["workAnalysis"]>["bulkSendPlan"];
type ConnectorFollowUpPlan = NonNullable<ConnectorConnectResult["workAnalysis"]>["followUpPlan"];
type ConnectorRecipientSourcePlan = NonNullable<ConnectorConnectResult["workAnalysis"]>["recipientSourcePlan"];

/** 연결 흐름 단계: 소개(무슨 일을 하는지) → 로그인 정보 입력. 자격증명이 필요 없는 방식은 소개에서 바로 연결한다. */
type ConnectorFlowStage = "about" | "credentials";

const credentialMethods: ReadonlyArray<ConnectorDefinition["method"]> = [
  "bot_token",
  "api_key",
  "imap_smtp",
  "site_login",
];

export function ConnectorDrawer({ connector, statusRecord, preferredMode, initialImapUser, initialWebmailUrl, initialStage, onClose, onConnect, onSwitchConnector, presentation = "drawer" }: Props) {
  const inline = presentation === "inline";
  const { panelRef, shown, closing, requestClose: closeDrawer } = useDrawerMotion(Boolean(connector) && !inline, onClose);
  const requestClose = inline ? onClose : closeDrawer;
  const [secret, setSecret] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");
  const [imapUser, setImapUser] = useState("");
  const [webmailUrl, setWebmailUrl] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [siteUserId, setSiteUserId] = useState("");
  const [appPath, setAppPath] = useState("");
  const [channelTargetId, setChannelTargetId] = useState("");
  const [warningOk, setWarningOk] = useState(false);
  const [guideStepIndex, setGuideStepIndex] = useState(0);
  const [guideSkipped, setGuideSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connectResult, setConnectResult] = useState<ConnectorConnectResult | null>(null);
  const [flowStage, setFlowStage] = useState<ConnectorFlowStage>("about");
  // 학교·기관 메일처럼 서버 주소를 모를 때 쓰는 자동 찾기 상태
  const [discovering, setDiscovering] = useState(false);
  const [discovery, setDiscovery] = useState<MailServerDiscoveryResult | null>(null);
  // 같은 주소로 자동 탐색이 반복 실행되는 것을 막는다.
  const autoDiscoveredEmailRef = useRef("");

  useEffect(() => {
    setSecret("");
    setImapHost("");
    setSmtpHost("");
    setSmtpPort("465");
    setImapPort(String(connector?.imapPresets?.[0]?.port ?? 993));
    setImapUser(initialImapUser ?? "");
    setWebmailUrl(initialWebmailUrl ?? "");
    setSiteUrl("");
    setSiteUserId("");
    setAppPath("");
    setChannelTargetId("");
    setWarningOk(false);
    setGuideStepIndex(0);
    setGuideSkipped(false);
    setConnectResult(null);
    setDiscovery(null);
    setDiscovering(false);
    autoDiscoveredEmailRef.current = "";
    // 채팅 안내 흐름이 주소를 미리 채웠거나 입력창을 약속하고 열었다면 바로 로그인 입력 단계로 이어간다.
    const method = connector?.method;
    const startsAtCredentials =
      Boolean(method && credentialMethods.includes(method)) &&
      Boolean(method === "imap_smtp" || initialImapUser || initialStage === "credentials");
    setFlowStage(startsAtCredentials ? "credentials" : "about");
  }, [connector?.id, connector?.method, initialImapUser, initialWebmailUrl, initialStage]);

  // 학교·공공기관 메일처럼 서버 주소를 모를 때: 이메일 주소만으로 서버를 찾아 채워 넣습니다.
  // (훅 규칙상 아래 자동 실행 effect 와 함께 조기 반환 위에 있어야 한다.)
  const handleDiscoverMailServer = useCallback(async () => {
    const email = imapUser.trim();
    if (!email) return;
    setDiscovering(true);
    setDiscovery(null);
    try {
      const result = await createDesktopBridge().discoverMailServer({ email });
      setDiscovery(result);
      if (result.status === "mail_autodiscovery_found" && result.imapHost) {
        setImapHost(result.imapHost);
        if (result.imapPort) setImapPort(String(result.imapPort));
      }
    } catch (err) {
      setDiscovery({
        status: "mail_autodiscovery_failed",
        userMessage:
          err instanceof Error
            ? `서버 자동 찾기 중 문제가 생겼습니다. ${err.message}`
            : "서버 자동 찾기 중 알 수 없는 문제가 생겼습니다.",
      });
    } finally {
      setDiscovering(false);
    }
  }, [imapUser]);

  // 주소를 다 치면 잠시 뒤 서버 자동 찾기를 자동 실행한다 — "버튼을 눌러야 한다"를
  // 사용자가 몰라서 멈추는 일이 없게. 버튼은 그대로 남긴다(수동 재시도 경로).
  useEffect(() => {
    if (connector?.method !== "imap_smtp") return;
    const email = imapUser.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return;
    // 채팅이 미리 채운 주소는 제외 — 마운트 즉시 실행하면 e2e 프리필 경로가 흔들린다.
    if (email === (initialImapUser ?? "").trim()) return;
    if (imapHost.trim()) return; // 서버 값을 이미 알고 있으면 손대지 않는다
    if (findMailProviderHint(email)) return; // 알려진 제공사는 서버가 이미 자동 설정됨
    if (isTrustedMailServerSuggestion(email, suggestMailServerFromAddress(email, connector?.imapPresets), connector?.imapPresets)) return;
    if (!createDesktopBridge().isAvailable) return; // 브라우저 미리보기: "설치 앱 전용" 경고 반복 방지
    if (autoDiscoveredEmailRef.current === email) return;
    const timer = setTimeout(() => {
      autoDiscoveredEmailRef.current = email;
      void handleDiscoverMailServer();
    }, 800);
    return () => clearTimeout(timer);
  }, [connector?.method, connector?.imapPresets, imapUser, imapHost, initialImapUser, handleDiscoverMailServer]);

  if (!connector) return null;

  const activeConnector = connector;
  const activeConnectorId = connector.id;
  const isCalendarConnector = activeConnectorId === "google-calendar" || activeConnectorId === "outlook-calendar";
  const needsCalendarWrite = isCalendarConnector && preferredMode === "write";
  const hasCalendarWrite = statusRecord?.permissions?.calendarWrite === true;
  const isReadOnlyCalendarConnected = isCalendarConnector && statusRecord && !hasCalendarWrite;
  const selectedOAuthScope = needsCalendarWrite ? calendarWriteScopeFor(connector.id) : undefined;
  const guide = connector.setupGuide;
  const currentGuideStep = guide?.steps[Math.min(guideStepIndex, guide.steps.length - 1)] ?? null;
  const guideStepCount = guide?.steps.length ?? 0;
  const guideDone = guide ? guideStepIndex >= guide.steps.length - 1 : false;
  const statusReady = isConnectorStatusReady(statusRecord?.status);
  const isMessengerConnector = connector.category === "messenger";
  const messengerStages = isMessengerConnector
    ? buildMessengerConnectionStages(connector.id, statusRecord, statusReady)
    : [];
  const needsWarning = Boolean(connector.warning);
  const imapHostIssue = connector.method === "imap_smtp" && imapHost.trim() ? validateImapHostInput(imapHost) : "";
  const imapPortIssue = connector.method === "imap_smtp" ? validateImapPortInput(imapPort) : "";
  const suggestedMailServer =
    connector.method === "imap_smtp" ? suggestMailServerFromAddress(imapUser, connector.imapPresets) : null;
  const mailProviderHint =
    connector.method === "imap_smtp" ? findMailProviderHint(imapUser) : null;
  const trustedMailServerSuggestion =
    connector.method === "imap_smtp"
      ? isTrustedMailServerSuggestion(imapUser, suggestedMailServer, connector.imapPresets)
      : false;
  const effectiveImapHost = connector.method === "imap_smtp" ? (imapHost.trim() || suggestedMailServer?.host || "") : "";
  const effectiveImapPort =
    connector.method === "imap_smtp" ? (imapPort.trim() || String(suggestedMailServer?.port ?? 993)) : "";
  const canAutomaticallyDiscoverMailServer = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(imapUser.trim());
  const imapHostForConnection =
    imapHost.trim() || (trustedMailServerSuggestion || !canAutomaticallyDiscoverMailServer ? effectiveImapHost : "");
  const effectiveImapHostIssue = connector.method === "imap_smtp" ? validateImapHostInput(effectiveImapHost) : "";
  const effectiveImapPortIssue = connector.method === "imap_smtp" ? validateImapPortInput(effectiveImapPort) : "";
  const siteUrlIssue = connector.method === "site_login" ? validateSiteUrlInput(siteUrl) : "";
  const imapHostIsWebLoginUrl = connector.method === "imap_smtp" && isWebLoginUrlInput(imapHost);
  const effectiveWebmailUrl = webmailUrl.trim() || (imapHostIsWebLoginUrl ? imapHost.trim() : "");
  const webmailUrlIssue = effectiveWebmailUrl ? validateSiteUrlInput(effectiveWebmailUrl) : "";
  const canStoreImapWebLoginFallback =
    Boolean(effectiveWebmailUrl && imapUser.trim() && secret.trim().length >= 4) &&
    !webmailUrlIssue;
  const canSubmit = (() => {
    if (needsWarning && !warningOk && connector.method !== "imap_smtp") return false;
    switch (connector.method) {
      case "bot_token":
      case "api_key":
        return secret.trim().length >= 8;
      case "imap_smtp":
        if (imapHostIsWebLoginUrl) return canStoreImapWebLoginFallback;
        return Boolean(
          effectiveImapHost &&
            imapUser.trim() &&
            secret.trim().length >= 4 &&
            !effectiveImapHostIssue &&
            !effectiveImapPortIssue,
        );
      case "site_login":
        return Boolean(siteUrl && siteUserId && secret.trim().length >= 4 && warningOk && !siteUrlIssue);
      case "oauth":
        return true;
      case "local_permission":
        return true;
      default:
        return false;
    }
  })();
  const resultReady = connectResult?.status === "site_login_stored" ? false : Boolean(connectResult && isConnectorStatusReady(connectResult.status)) || statusReady;
  const resultTone = connectResult ? connectorResultTone(connectResult) : "idle";
  const resultActions = connectResult ? buildConnectorResultActions(connectResult, connector) : [];
  const discoveredMailServerCandidates = connectResult?.mailServerDiscovery?.candidates ?? [];
  const primaryDiscoveredMailServer =
    discoveredMailServerCandidates.length === 1 ? discoveredMailServerCandidates[0] ?? null : null;
  const primaryResultAction =
    connectResult && !connectResult.authorizationUrl && discoveredMailServerCandidates.length === 0
      ? resultActions[0] ?? null
      : null;
  const resultDetailActions = primaryResultAction ? resultActions.slice(1) : resultActions;
  const needsCredentialStage = credentialMethods.includes(connector.method);
  const showCredentialFields = needsCredentialStage && flowStage === "credentials";
  const aboutHighlights = (
    activeConnector.afterConnect?.items ??
    activeConnector.workPreview?.items.map((item) => `${item.label}: ${item.detail}`) ??
    []
  ).slice(0, 3);
  const loginStepLabel =
    connector.method === "oauth"
      ? "계정 동의"
      : connector.method === "local_permission"
        ? "폴더 선택"
        : "로그인 정보";
  const aboutPrimaryLabel = resultReady
    ? "연결 완료"
    : connector.method === "oauth"
      ? "계정 동의 창 열기"
      : connector.method === "local_permission"
        ? "폴더 고르고 연결하기"
        : statusRecord?.recovery?.kind === "credential_failed"
          ? "로그인 정보 다시 입력"
          : "연결하기";
  const methodHint =
    connector.method === "oauth"
      ? "버튼을 누르면 브라우저에 동의 창이 열려요. 동의 한 번이면 연결이 끝납니다."
      : connector.method === "local_permission"
        ? "폴더 선택 창에서 읽어도 되는 폴더만 고르면 바로 연결됩니다."
        : connector.method === "imap_smtp"
          ? "다음 화면에서 메일 주소와 앱 비밀번호만 입력하면 돼요. 서버 값은 자동으로 채웁니다."
          : connector.method === "site_login"
            ? "다음 화면에서 사이트 주소와 로그인 정보를 입력하면 암호화 보관함에 저장돼요."
            : "다음 화면에서 발급받은 인증값 하나만 붙여넣으면 돼요.";

  const handleSubmit = async () => {
    if (connector.method === "imap_smtp" && imapHostIsWebLoginUrl) {
      await handleStoreImapWebLoginFallback();
      return;
    }
    setBusy(true);
    try {
      const result = await onConnect(connector.id, {
        method: connector.method,
        secret: secret || undefined,
        scope: selectedOAuthScope,
        mode: preferredMode,
        ...(connector.method === "imap_smtp" && smtpHost.trim() ? {
          smtpHost: smtpHost.trim(), smtpPort: Number(smtpPort),
          smtpSecure: smtpPort === "465", smtpStartTls: smtpPort === "587",
        } : {}),
        imapHost: imapHostForConnection || undefined,
        imapPort: imapHostForConnection && effectiveImapPort ? Number(effectiveImapPort) : undefined,
        imapUser: imapUser || undefined,
        emailAddress: imapUser || undefined,
        siteUrl: siteUrl || undefined,
        siteUserId: siteUserId || undefined,
        appPath: appPath || undefined,
        channelTargetId: channelTargetId || undefined,
        warningAcknowledged: warningOk,
      });
      setConnectResult(result);
      if (isConnectorStatusReady(result.status) || result.status === "site_login_stored") {
        setSecret("");
      }
    } catch (err) {
      setConnectResult({
        status: "connector_connect_failed",
        userMessage: err instanceof Error ? err.message : "연결에 실패했습니다.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleApproveDiscoveredServer = async (candidate: DiscoveredMailServerCandidate) => {
    if (connector.method !== "imap_smtp") return;
    setBusy(true);
    try {
      const result = await onConnect(connector.id, {
        method: "imap_smtp",
        secret: secret || undefined,
        scope: selectedOAuthScope,
        mode: preferredMode,
        imapUser: imapUser || undefined,
        emailAddress: imapUser || undefined,
        siteUrl: siteUrl || undefined,
        confirmDiscoveredServer: {
          imapHost: candidate.imapHost,
          imapPort: candidate.imapPort,
        },
      });
      setConnectResult(result);
      if (isConnectorStatusReady(result.status)) {
        setSecret("");
      }
    } catch (err) {
      setConnectResult({
        status: "connector_connect_failed",
        userMessage: err instanceof Error ? err.message : "연결에 실패했습니다.",
      });
    } finally {
      setBusy(false);
    }
  };
  const handleStoreImapWebLoginFallback = async () => {
    setBusy(true);
    try {
      const result = await onConnect(connector.id, {
        method: "site_login",
        secret: secret || undefined,
        siteUrl: effectiveWebmailUrl,
        siteUserId: imapUser.trim(),
        appPath: appPath || undefined,
        warningAcknowledged: true,
      });
      setConnectResult({
        ...result,
        userMessage:
          result.userMessage ??
          "웹 로그인 주소와 계정을 보관했습니다. 공식 메일 연결이 막혀도 내 PC 작업 도우미 읽기 후보로 이어갈 수 있습니다.",
      });
      if (isConnectorStatusReady(result.status)) {
        setSecret("");
      }
    } catch (err) {
      setConnectResult({
        status: "site_login_fallback_failed",
        userMessage: err instanceof Error ? err.message : "웹 로그인 계정 보관에 실패했습니다.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!inline && <button
        type="button"
        className={`${styles.backdrop} mc-drawer-backdrop`}
        data-open={shown}
        onClick={requestClose}
        tabIndex={-1}
        aria-label="패널 닫기"
      />}
      <aside ref={inline ? undefined : panelRef} className={inline ? `${styles.drawer} ${styles.inline}` : `${styles.drawer} t-panel-slide mc-drawer-motion`} data-open={inline || shown} data-closing={closing} role={inline ? "region" : "dialog"} aria-modal={inline ? undefined : true} tabIndex={-1} aria-label={`${connector.label} 연결 설정`}>
        {!inline && <header className={styles.head}>
          <div className={styles.headTitle}>
            <span className={styles.icon} data-category={connector.category} aria-hidden="true">
              {/* 연결 설정 창에서도 어떤 제품을 연결하는지 로고로 보여준다. */}
              {connectorBrandIconSrc(connector.id) ? (
                <img
                  src={connectorBrandIconSrc(connector.id) as string}
                  alt=""
                  width={22}
                  height={22}
                  style={{ width: "62%", height: "62%", objectFit: "contain", display: "block" }}
                />
              ) : (
                connector.iconText
              )}
            </span>
            <div>
              <small>{categoryLabels[connector.category]}</small>
              <h2>{connector.label}</h2>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={requestClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </header>}

        {connector.category === "messenger" && <p className={styles.note}><a href={`/automation?provider=${connector.id.startsWith("telegram") ? "telegram" : connector.id.startsWith("discord") ? "discord" : connector.id.startsWith("slack") ? "slack" : "kakao"}`}>봇 생성·업무방 수신·부서별 자동화 설정 →</a></p>}

        {flowStage === "about" ? (
          <details
            className={`${styles.fold} ${styles.connectionGuide}`}
            aria-label="연결 안내"
            data-connector-guide-default="closed"
            data-connector-guide-visible="title_primary_action"
            data-connector-guide-hidden="description_steps_highlights_until_open"
          >
            <summary>
              <span>연결 안내</span>
              <em>필요할 때 보기</em>
            </summary>
            <div className={styles.foldBody}>
              <p className={styles.description}>{connector.shortDescription}</p>
              <section
                className={styles.drawerStepRail}
                aria-label="연결 진행 단계"
                data-connector-flow={connector.method === "imap_smtp" ? "mail_credentials_live_inbox_check" : "about_login_check"}
                data-connector-flow-stage={flowStage}
                data-connector-flow-needs-login={needsCredentialStage ? "true" : "false"}
              >
                <div data-state={flowStage === "about" && !resultReady ? "active" : "done"}>
                  <span>1</span>
                  <strong>{connector.method === "imap_smtp" ? "메일 정보" : "어떤 역할인지"}</strong>
                  <small>{connector.method === "imap_smtp" ? "주소와 앱 비밀번호" : "역할 확인"}</small>
                </div>
                <div data-state={resultReady ? "done" : showCredentialFields || (!needsCredentialStage && busy) ? "active" : "todo"}>
                  <span>2</span>
                  <strong>{connector.method === "imap_smtp" ? "받은편지함 확인" : loginStepLabel}</strong>
                  <small>{connector.method === "imap_smtp" ? "실제 읽기 점검" : methodLabels[connector.method]}</small>
                </div>
                <div data-state={resultReady ? "done" : busy ? "active" : connectResult ? "active" : "todo"}>
                  <span>3</span>
                  <strong>{connector.method === "imap_smtp" ? "연결 완료" : "연결 확인"}</strong>
                  <small>{resultReady ? "사용 가능" : busy ? "확인 중" : connectResult ? "결과 확인" : "자동 점검"}</small>
                </div>
              </section>

              <section
                className={styles.aboutStage}
                aria-label={`${connector.label} 역할 소개`}
                data-connector-about-ready={resultReady ? "true" : "false"}
              >
                {resultReady ? (
                  <div className={styles.connectedBanner} role="status">
                    <strong>이미 연결되어 있어요.</strong>
                    <span>바로 업무를 맡길 수 있고, 아래에서 연결 상태와 다음 단계를 확인할 수 있어요.</span>
                  </div>
                ) : null}
                {aboutHighlights.length ? (
                  <div className={styles.aboutHighlights}>
                    <span>연결하면 바로 할 수 있는 일</span>
                    <ul>
                      {aboutHighlights.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {!resultReady ? <p className={styles.methodHint}>{methodHint}</p> : null}
              </section>
            </div>
          </details>
        ) : null}

        {showCredentialFields ? (
          <section className={styles.credentialIntro} aria-label="로그인 정보 입력 안내">
            {connector.method !== "imap_smtp" ? (
              <button type="button" className={styles.stageBack} onClick={() => setFlowStage("about")} disabled={busy}>
                ← 역할 소개 다시 보기
              </button>
            ) : null}
            <strong>{connector.method === "imap_smtp" ? "메일 주소와 앱 비밀번호만 넣어주세요." : "거의 다 됐어요 — 로그인 정보만 입력하면 끝나요."}</strong>
            <small>{connector.method === "imap_smtp" ? "서버를 자동으로 찾고 실제 받은편지함을 읽을 수 있는지 확인합니다." : "입력값은 화면에 다시 표시되지 않고 암호화 보관함에만 저장됩니다."}</small>
          </section>
        ) : null}

        {showCredentialFields ? (
          <section className={styles.section} aria-label="필요한 입력">
            <h3>{connector.method === "imap_smtp" ? "일반 메일 바로 연결" : `필요한 입력 — ${methodLabels[connector.method]}`}</h3>
            {renderMethodFields(connector.method)}
          </section>
        ) : null}

        {needsWarning && connector.method !== "imap_smtp" && (flowStage === "about" || showCredentialFields) ? (
          <section className={`${styles.section} ${styles.warning}`} aria-label="주의 사항">
            <h3>⚠ 연결 전 확인</h3>
            <p>{connector.warning}</p>
            <label>
              <input
                type="checkbox"
                checked={warningOk}
                onChange={(e) => setWarningOk(e.target.checked)}
              />
              <span>위 내용을 확인했고 연결을 진행합니다</span>
            </label>
          </section>
        ) : null}

        {!connectResult ? (
          <footer className={styles.actions}>
          {flowStage === "about" && needsCredentialStage ? (
            <button
              type="button"
              className={styles.connectButton}
              disabled={busy || resultReady}
              onClick={() => setFlowStage("credentials")}
            >
              {aboutPrimaryLabel}
            </button>
          ) : (
            <button
              type="button"
              className={styles.connectButton}
              disabled={!canSubmit || busy}
              onClick={handleSubmit}
            >
              {busy
                ? "연결 중..."
                : connector.method === "oauth"
                  ? "계정 동의 창 열기"
                  : connector.method === "imap_smtp" && imapHostIsWebLoginUrl
                    ? "보관함에 저장하고 다른 방법 준비"
                    : connector.method === "imap_smtp"
                      ? "받은편지함 연결 확인"
                      : "연결하기"}
            </button>
          )}
          {resultReady && needsCredentialStage && flowStage === "about" ? (
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => setFlowStage("credentials")}
              disabled={busy}
            >
              로그인 정보 다시 입력
            </button>
          ) : null}
          <button
            type="button"
            className={styles.cancelButton}
            onClick={requestClose}
            disabled={busy}
          >
            취소
          </button>
          </footer>
        ) : null}

        {connectResult ? (
          <div className={styles.result} data-tone={resultTone} role="status">
            <header className={styles.resultHead}>
              <div>
                <span>{connectorResultToneLabel(resultTone)}</span>
                <strong>{connectorResultTitle(connectResult)}</strong>
              </div>
              <em>{connectorVisibleStatusLabel(connectResult.status)}</em>
            </header>
            {connectResult.authorizationUrl ? (
              <section className={styles.resultActionRail} aria-label="연결 다음 행동" data-result-action-count="1">
                <a href={connectResult.authorizationUrl} target="_blank" rel="noreferrer">
                  <strong>동의 계속</strong>
                  <small>브라우저에서 승인한 뒤 이 앱으로 돌아옵니다.</small>
                </a>
              </section>
            ) : primaryDiscoveredMailServer ? (
              <section className={styles.resultActionRail} aria-label="연결 다음 행동" data-result-action-count="1">
                <button
                  type="button"
                  onClick={() => handleApproveDiscoveredServer(primaryDiscoveredMailServer)}
                  disabled={busy}
                >
                  <strong>{primaryDiscoveredMailServer.imapHost}:{primaryDiscoveredMailServer.imapPort}</strong>
                  <small>이 서버로 연결 확인</small>
                </button>
              </section>
            ) : primaryResultAction ? (
              <section className={styles.resultActionRail} aria-label="연결 다음 행동" data-result-action-count="1">
                {primaryResultAction.kind === "retry" ? (
                  <button type="button" onClick={handleSubmit} disabled={!canSubmit || busy}>
                    <strong>{primaryResultAction.label}</strong>
                    <small>{primaryResultAction.detail}</small>
                  </button>
                ) : (
                  <a href={primaryResultAction.href}>
                    <strong>{primaryResultAction.label}</strong>
                    <small>{primaryResultAction.detail}</small>
                  </a>
                )}
              </section>
            ) : null}
            {discoveredMailServerCandidates.length > 1 ? (
              <details
                className={styles.fold}
                aria-label="메일 서버 후보 고르기"
                data-mail-server-choice-default="closed"
              >
                <summary>
                  <span>메일 서버 고르기</span>
                  <em>{discoveredMailServerCandidates.length}개 후보</em>
                </summary>
                <div className={styles.foldBody}>
                  <p className={styles.resultMessage}>아직 비밀번호로 인증하지 않았습니다. 연결할 서버를 하나 선택하세요.</p>
                  <div className={styles.resultActionRail}>
                    {discoveredMailServerCandidates.map((candidate) => (
                      <button
                        key={`${candidate.imapHost}:${candidate.imapPort}`}
                        type="button"
                        onClick={() => handleApproveDiscoveredServer(candidate)}
                        disabled={busy}
                      >
                        <strong>{candidate.imapHost}:{candidate.imapPort}</strong>
                        <small>이 서버로 연결 확인</small>
                      </button>
                    ))}
                  </div>
                </div>
              </details>
            ) : null}
            <p className={styles.resultSafety}>
              보안값은 보관함에만 저장하며, 발송·등록·공유·외부 클릭은 마지막 승인 전까지 잠깁니다.
            </p>
            <details
              className={styles.fold}
              aria-label="연결 결과 세부 정보"
              data-connector-result-details-default="closed"
            >
              <summary>
                <span>다른 방법·상세</span>
                <em>필요할 때만</em>
              </summary>
              <div className={styles.foldBody}>
                <p className={styles.resultMessage}>{connectResult.userMessage ?? `연결 결과 — ${connectResult.status}`}</p>
                {connectResult.errorMessage ? (
                  <p className={styles.resultDiagnostic}>
                    진단: {connectResult.errorMessage}
                  </p>
                ) : null}
                {connectResult.callbackUrl ? (
                  <small className={styles.resultMessage}>브라우저 동의 완료 후 이 앱으로 돌아와 연결 상태가 저장됩니다.</small>
                ) : null}
            <section
              className={styles.gatewayRecoveryRail}
              aria-label={`${connector.label} 연결 복구 다음 단계`}
              data-tone={resultTone}
            >
              <div data-state={resultTone === "ready" || resultTone === "oauth" ? "ready" : "review"}>
                <span>1</span>
                <strong>{resultTone === "ready" ? "연결됨" : "막힌 이유"}</strong>
                <small
                  data-raw-detail={connectResult.recovery?.detail || connectResult.errorMessage || connectResult.userMessage || ""}
                  data-visible-detail={visibleConnectorRecoveryReason(connectResult)}
                >
                  {visibleConnectorRecoveryReason(connectResult)}
                </small>
              </div>
              <div data-state={resultActions.length ? "active" : "locked"}>
                <span>2</span>
                <strong>지금 누를 다음 버튼</strong>
                <small>
                  {resultActions[0]?.label
                    ? `${resultActions[0].label}부터 이어갑니다.`
                    : "필요한 값이 준비되면 다시 연결합니다."}
                </small>
              </div>
              <div data-state="locked">
                <span>3</span>
                <strong>승인 전 실행 잠금</strong>
                <small>발송, 등록, 공유, 클릭은 오피스 마지막 확인 전까지 실행하지 않습니다.</small>
              </div>
            </section>
            {resultDetailActions.length ? (
              <section className={styles.resultActionRail} aria-label="연결 다음 행동">
                {resultDetailActions.map((action) => (
                  action.kind === "retry" ? (
                    <button
                      key={action.label}
                      type="button"
                      onClick={handleSubmit}
                      disabled={!canSubmit || busy}
                    >
                      <strong>{action.label}</strong>
                      <small>{action.detail}</small>
                    </button>
                  ) : (
                    <a key={action.label} href={action.href}>
                      <strong>{action.label}</strong>
                      <small>{action.detail}</small>
                    </a>
                  )
                ))}
              </section>
            ) : null}
            {resultReady && needsCredentialStage && flowStage === "about" ? (
              <section className={styles.resultActionRail} aria-label="연결 결과 보조 행동" data-result-action-count="1">
                <button
                  type="button"
                  onClick={() => setFlowStage("credentials")}
                  disabled={busy}
                >
                  <strong>로그인 정보 다시 입력</strong>
                  <small>기존 연결을 바꾸려면 입력 화면을 다시 엽니다.</small>
                </button>
              </section>
            ) : null}
            {connectResult.recovery?.fallbackRoutes?.length ? (
              <section className={styles.resultRecovery} aria-label="연결 다음 방법">
                <div
                  className={styles.resultRecoveryHead}
                  data-raw-detail={connectResult.recovery.detail}
                  data-visible-detail={visibleConnectorRecoveryReason(connectResult)}
                >
                  <span>복구 루트</span>
                  <strong>{visibleConnectorRecoveryTitle(connectResult)}</strong>
                  <p>{visibleConnectorRecoveryReason(connectResult)}</p>
                </div>
                <ul>
                  {connectResult.recovery.fallbackRoutes.slice(0, 4).map((route) => (
                    <li
                      key={route}
                      data-raw-route={route}
                      data-visible-route={visibleConnectorFallbackRoute(route)}
                    >
                      {visibleConnectorFallbackRoute(route)}
                    </li>
                  ))}
                </ul>
                {connectResult.recovery.safeNextActions?.length ? (
                  <small data-raw-safe-next-actions={connectResult.recovery.safeNextActions.slice(0, 2).join(" · ")}>
                    {connectResult.recovery.safeNextActions.slice(0, 2).map(visibleConnectorSafeNextAction).join(" · ")}
                  </small>
                ) : null}
              </section>
            ) : null}
            {connectResult.stagedWorkItem ? (
              <section className={styles.resultRecovery} aria-label="업무 오피스 대체 카드">
                <div className={styles.resultRecoveryHead}>
                  <span>오피스 보류</span>
                  <strong>업무 오피스 카드 생성됨</strong>
                  <p>{connectResult.stagedWorkItem.title}</p>
                </div>
                <small>사이트를 열거나 입력하지 않고 승인 대기 카드만 만들었습니다.</small>
              </section>
            ) : null}
            {connectResult.workAnalysis ? (
              <section className={styles.resultAnalysis} aria-label="메일 업무 분석">
                <div className={styles.resultAnalysisHead}>
                  <span>메일 업무 분석</span>
                  <strong>{connectResult.workAnalysis.summary}</strong>
                </div>
                <div className={styles.resultMetricGrid}>
                  <span>
                    <strong>{connectResult.workAnalysis.stats?.totalMessages ?? 0}</strong>
                    읽은 메일
                  </span>
                  <span>
                    <strong>{connectResult.workAnalysis.stats?.workItems ?? 0}</strong>
                    업무 후보
                  </span>
                  <span>
                    <strong>{connectResult.workAnalysis.stats?.approvalCandidates ?? 0}</strong>
                    승인 후보
                  </span>
                </div>
                <details className={styles.resultAnalysisDetails} data-analysis-detail-default="closed">
                  <summary>
                    <span>업무 분석</span>
                    <strong>자세히</strong>
                  </summary>
                  <div className={styles.resultAnalysisDetailsBody}>
                    <AnalysisList title="작업 방식" items={connectResult.workAnalysis.workingStyle} />
                    <AnalysisList title="연결 준비" items={connectResult.workAnalysis.connectionPreparation ?? []} />
                    <AnalysisList title="수신자 판단" items={connectResult.workAnalysis.recipientGuidance ?? []} />
                    <AnalysisList title="발송 계획" items={connectResult.workAnalysis.sendingPlanGuidance ?? []} />
                    <AnalysisList
                      title="대량 발송 계획"
                      items={formatBulkSendPlanItems(connectResult.workAnalysis.bulkSendPlan)}
                    />
                    <AnalysisList
                      title="후속 확인 계획"
                      items={formatFollowUpPlanItems(connectResult.workAnalysis.followUpPlan)}
                    />
                    <AnalysisList
                      title="첨부/엑셀 명단 계획"
                      items={formatRecipientSourcePlanItems(connectResult.workAnalysis.recipientSourcePlan)}
                    />
                    <AnalysisList title="학습 신호" items={connectResult.workAnalysis.learningSignals ?? []} />
                    <AnalysisList
                      title="메일 업무 경우의 수"
                      items={(connectResult.workAnalysis.scenarioCoverage ?? [])
                        .filter((scenario) => scenario.status === "observed")
                        .map((scenario) => `${scenario.label}: ${scenario.guidance} 다음: ${scenario.nextAction}`)}
                    />
                    <AnalysisList title="개선 제안" items={connectResult.workAnalysis.improvementSuggestions} />
                    <AnalysisList title="자동화 후보" items={connectResult.workAnalysis.automationOpportunities} />
                    {connectResult.workAnalysis.privacyBoundary ? (
                      <small>{connectResult.workAnalysis.privacyBoundary}</small>
                    ) : null}
                  </div>
                </details>
              </section>
            ) : null}
              </div>
            </details>
          </div>
        ) : null}

        <section className={styles.detailFolds} aria-label="자세한 안내" hidden={Boolean(connectResult)}>
          {/* 연결 전 화면에는 입력 두 칸과 대표 버튼만 남긴다. 준비물·따라하기 가이드·연결 후
              보이는 일·보안 안내는 접힘 한 겹 안으로 모아, 처음 연결하는 사람이 글 벽을 만나지
              않게 한다. 내용은 그대로 두고 노출만 요청 시로 미룬다. */}
          <details className={styles.fold}>
            <summary>
              <span>자세한 안내</span>
              <em>필요할 때만</em>
            </summary>
            <div className={styles.foldBody}>

          {isMessengerConnector ? (
          <details className={styles.fold}>
            <summary>
              <span>메신저 연결 상태</span>
              <em>{statusReady ? "연결됨" : statusRecord ? "점검 필요" : "연결 전"}</em>
            </summary>
            <div className={styles.foldBody}>
              <section
                className={styles.messengerStatusPanel}
                data-ready={statusReady ? "true" : "false"}
                aria-label={`${connector.label} 메신저 연결 상태`}
              >
                <div className={styles.messengerStatusHead}>
                  <span>{statusReady ? "연결됨" : statusRecord ? "점검 필요" : "연결 전"}</span>
                  <strong>{messengerStatusTitle(connector.id, statusRecord, statusReady)}</strong>
                  <small>{messengerStatusDetail(connector.id, statusRecord, statusReady)}</small>
                </div>
                <ol className={styles.messengerStatusSteps}>
                  {messengerStages.map((stage) => (
                    <li key={stage.label} data-state={stage.state}>
                      <span />
                      <strong>{stage.label}</strong>
                      <small>{stage.detail}</small>
                    </li>
                  ))}
                </ol>
                <p>
                  보안값 원문은 연결 점검 후 암호화 보관함에만 남기고, 메신저에서 들어온 승인·수정·보류는 업무 오피스 결정함으로 들어옵니다.
                </p>
              </section>
            </div>
          </details>
        ) : null}

        {activeConnector.preparation?.length ? (
          <details className={styles.fold}>
            <summary>
              <span>준비물</span>
              <em>{activeConnector.preparation.length}개</em>
            </summary>
            <div className={styles.foldBody}>
              <section className={styles.preparation} aria-label="연결 전 준비물">
                <span>먼저 준비할 것</span>
                <ul>
                  {activeConnector.preparation.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            </div>
          </details>
        ) : null}

        {needsCalendarWrite || isReadOnlyCalendarConnected ? (
          <details className={`${styles.fold} ${styles.permissionFold}`}>
            <summary>
              <span>{hasCalendarWrite ? "일정 등록 가능" : "쓰기 권한 필요"}</span>
              <em>{hasCalendarWrite ? "등록 가능" : "권한 재연결"}</em>
            </summary>
            <div className={styles.foldBody}>
              <section
                className={styles.permissionUpgrade}
                data-ready={hasCalendarWrite}
                aria-label="캘린더 등록 권한 안내"
              >
                <div>
                  <span>{hasCalendarWrite ? "일정 등록 가능" : "쓰기 권한 필요"}</span>
                  <strong>
                    {hasCalendarWrite
                      ? "이 캘린더는 승인 후 실제 일정 등록까지 가능합니다"
                      : "일정 등록을 하려면 캘린더 쓰기 권한으로 다시 연결하세요"}
                  </strong>
                  <p>
                    읽기 전용 연결은 바쁜 시간 확인까지만 가능합니다. 실제 등록은
                    실행 전 검토, 사용자 최종 확인, 실제 실행 잠금 해제를 모두 통과한 뒤에만 실행됩니다.
                  </p>
                </div>
                <ul>
                  <li>{connector.id === "google-calendar" ? "Google 일정 등록 권한" : "Microsoft 일정 등록 권한"}</li>
                  <li>보안값 원문은 암호화 보관함에만 저장</li>
                  <li>등록 전 사용자 최종 확인 필수</li>
                </ul>
              </section>
            </div>
          </details>
        ) : null}

        {guide && currentGuideStep ? (
          <details className={styles.fold}>
            <summary>
              <span>따라하기 가이드</span>
              <em>{guideStepIndex + 1}/{guideStepCount}</em>
            </summary>
            <div className={styles.foldBody}>
              <section
                className={`${styles.guide} ${guideSkipped ? styles.guideCompact : ""}`}
                aria-label="따라하기 연결 가이드"
              >
                <div className={styles.guideIntro}>
                  <span>AI 연결 도우미</span>
                  <p>{guideSkipped ? "단계 설명을 접었습니다. 필요한 값만 입력하면 됩니다." : guide.assistantIntro}</p>
                </div>

                {!guideSkipped ? (
                  <>
                    <div className={styles.guideProgress} aria-label="가이드 진행 상태">
                      {guide.steps.map((step, index) => (
                        <button
                          key={step.title}
                          type="button"
                          className={`${styles.guideDot} ${index === guideStepIndex ? styles.guideDotActive : ""} ${
                            index < guideStepIndex ? styles.guideDotDone : ""
                          }`}
                          onClick={() => setGuideStepIndex(index)}
                          aria-label={`${index + 1}단계 ${step.title}`}
                        >
                          {index + 1}
                        </button>
                      ))}
                    </div>

                    <article className={styles.guideStep}>
                      <div className={styles.guideStepHead}>
                        <span>{guideStepIndex + 1} / {guideStepCount}</span>
                        <h3>{currentGuideStep.title}</h3>
                      </div>
                      <p>{currentGuideStep.description}</p>
                      <ul>
                        {currentGuideStep.checklist.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                      {currentGuideStep.actionHref && currentGuideStep.actionLabel ? (
                        <a
                          className={styles.guideActionLink}
                          href={currentGuideStep.actionHref}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {currentGuideStep.actionLabel}
                        </a>
                      ) : null}
                    </article>

                    <div className={styles.guideActions}>
                      <button
                        type="button"
                        onClick={() => setGuideStepIndex((value) => Math.max(0, value - 1))}
                        disabled={guideStepIndex === 0}
                      >
                        이전
                      </button>
                      <button
                        type="button"
                        className={styles.guidePrimary}
                        onClick={() => {
                          if (guideDone) setGuideSkipped(true);
                          else setGuideStepIndex((value) => Math.min(guideStepCount - 1, value + 1));
                        }}
                      >
                        {guideDone ? "이제 입력하기" : "다음 단계"}
                      </button>
                      <button
                        type="button"
                        className={styles.guideSkip}
                        onClick={() => setGuideSkipped(true)}
                      >
                        {guide.expertSkipLabel}
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.guideRestore}
                    onClick={() => setGuideSkipped(false)}
                  >
                    단계별 안내 다시 보기
                  </button>
                )}
              </section>
            </div>
          </details>
        ) : null}

        {activeConnector.workPreview ? (
          <details className={styles.fold}>
            <summary>
              <span>연결 후 보이는 일</span>
              <em>{activeConnector.workPreview.items.length}단계</em>
            </summary>
            <div className={styles.foldBody}>
              <section className={styles.workPreview} aria-label="AI 업무 미리보기">
                <div className={styles.workPreviewHead}>
                  <span>AI 업무 미리보기</span>
                  <strong>{activeConnector.workPreview.title}</strong>
                  <p>{activeConnector.workPreview.cadence}</p>
                </div>
                <div className={styles.workPreviewGrid}>
                  {activeConnector.workPreview.items.map((item) => (
                    <article key={item.label}>
                      <span>{item.label}</span>
                      <p>{item.detail}</p>
                    </article>
                  ))}
                </div>
                <p className={styles.workPreviewNote}>{activeConnector.workPreview.approvalNote}</p>
              </section>
            </div>
          </details>
        ) : null}

        <details className={styles.fold}>
          <summary>
            <span>연결 후 흐름</span>
            <em>{connector.triggers.length}개 신호</em>
          </summary>
          <div className={styles.foldBody}>
            {activeConnector.afterConnect ? (
              <section className={styles.afterConnect} aria-label="연결 후 AI 업무 흐름">
                <div>
                  <span>연결 후</span>
                  <strong>{activeConnector.afterConnect.title}</strong>
                </div>
                <ul>
                  {activeConnector.afterConnect.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section className={styles.section} aria-label="업무 신호">
              <h3>업무 신호</h3>
              <ul>
                {connector.triggers.map((t) => (
                  <li key={t}>{triggerLabels[t]}</li>
                ))}
              </ul>
              <p className={styles.sectionNote}>
                외부 발송·등록·SMS·세무 제출은 사용자 승인 후에만 실행됩니다.
              </p>
            </section>
          </div>
        </details>

        <details className={styles.fold}>
          <summary>
            <span>보안과 문제 해결</span>
            <em>필요할 때 열기</em>
          </summary>
          <div className={styles.foldBody}>
            <section className={`${styles.section} ${styles.security}`} aria-label="보안 안내">
              <h3>보안 처리</h3>
              <ul>
                <li>입력값은 <strong>암호화 보관함</strong>에만 들어갑니다</li>
                <li>화면, 저장된 대화, 리포트에는 원문이 남지 않습니다</li>
                <li>외부 실행은 별도 승인 단계에서만 진행됩니다</li>
              </ul>
            </section>
            {activeConnector.troubleshooting?.length ? (
              <section className={`${styles.section} ${styles.troubleshooting}`} aria-label="연결 문제 해결">
                <h3>연결이 안 되면</h3>
                <ul>
                  {activeConnector.troubleshooting.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </details>
            </div>
          </details>
        </section>
      </aside>
    </>
  );

  function renderMethodFields(method: ConnectorDefinition["method"]) {
    switch (method) {
      case "bot_token":
      case "api_key":
        return (
          <div className={styles.fieldGroup}>
            <label className={styles.field}>
              <span>{method === "bot_token" ? botTokenLabel(activeConnectorId) : "연결 키"}</span>
              <input
                type="password"
                name={`${activeConnectorId}-secret`}
                autoComplete="off"
                placeholder={`${method === "bot_token" ? botTokenPlaceholder(activeConnectorId) : "발급받은 연결 키"} 붙여넣기`}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
              <small>저장 즉시 마스킹되며 화면에 다시 표시되지 않습니다.</small>
            </label>
            {activeConnector.category === "messenger" ? (
              <label className={styles.field}>
                <span>{channelTargetLabel(activeConnectorId)}</span>
                <input
                  type="text"
                  name={`${activeConnectorId}-channel-target`}
                  autoComplete="off"
                  placeholder={channelTargetPlaceholder(activeConnectorId)}
                  value={channelTargetId}
                  onChange={(e) => setChannelTargetId(e.target.value)}
                />
                <small>비워도 연결 점검은 가능하지만, 외부 메신저로 승인 알림을 보내려면 대상 채널을 추가로 저장해야 합니다.</small>
              </label>
            ) : null}
          </div>
        );
      case "imap_smtp":
        return (
          <div className={styles.fieldGroup}>
            <label className={styles.field}>
              <span>메일 주소</span>
              <input
                type="text"
                name={`${activeConnectorId}-imap-user`}
                autoComplete="username"
                placeholder={activeConnector.imapPresets?.[0]?.userHint ?? "you@company.com"}
                value={imapUser}
                onChange={(e) => setImapUser(e.target.value)}
              />
              {suggestedMailServer ? (
                <small>{suggestedMailServer.label}로 자동 설정합니다. 틀리면 고급 설정에서 회사가 준 서버값으로 바꿀 수 있습니다.</small>
              ) : (
                <small>회사 메일이면 평소 쓰는 업무 메일 주소를 그대로 입력하세요.</small>
              )}
            </label>
            <section className={styles.mailDiscoveryBox} aria-label="메일 서버 자동 찾기">
              <div>
                <strong>서버 주소를 모르겠으면 눌러주세요</strong>
                <small>학교·기관·회사 메일은 주소만 넣고 누르면 앱이 서버를 직접 찾아봅니다.</small>
              </div>
              <button
                type="button"
                onClick={() => void handleDiscoverMailServer()}
                disabled={discovering || !imapUser.trim()}
                data-mail-discovery-action="discover"
              >
                {discovering ? "찾는 중…" : "서버 자동 찾기"}
              </button>
              {discovery ? (
                <p data-mail-discovery-status={discovery.status}>
                  {discovery.status === "mail_autodiscovery_found"
                    ? `찾았습니다 · ${discovery.imapHost}:${discovery.imapPort} — 이제 비밀번호만 넣으면 됩니다.`
                    : discovery.userMessage}
                </p>
              ) : null}
              {discovery?.oauthRecommended && discovery.providerKind === "google_workspace" ? (
                <p>
                  이 주소는 구글이 운영합니다. 비밀번호 없이 계정 로그인으로 연결하는 편이 쉽습니다.{" "}
                  {onSwitchConnector ? (
                    <button
                      type="button"
                      onClick={() => onSwitchConnector("gmail")}
                      data-mail-provider-switch="gmail"
                    >
                      구글 계정으로 연결
                    </button>
                  ) : (
                    <a href="/connect?open=gmail" data-mail-provider-switch="gmail">
                      구글 계정으로 연결
                    </a>
                  )}
                </p>
              ) : null}
              {discovery?.oauthRecommended && discovery.providerKind === "microsoft365" ? (
                <p>
                  이 주소는 마이크로소프트가 운영합니다. 비밀번호 없이 계정 로그인으로 연결하는 편이 쉽습니다.{" "}
                  {onSwitchConnector ? (
                    <button
                      type="button"
                      onClick={() => onSwitchConnector("outlook")}
                      data-mail-provider-switch="outlook"
                    >
                      Microsoft 계정으로 연결
                    </button>
                  ) : (
                    <a href="/connect?open=outlook" data-mail-provider-switch="outlook">
                      Microsoft 계정으로 연결
                    </a>
                  )}
                </p>
              ) : null}
              {discovery?.helpRequest ? (
                <details>
                  <summary>학교·회사 IT 담당자에게 물어볼 문장 보기</summary>
                  <p>제목: {discovery.helpRequest.subject}</p>
                  <textarea readOnly rows={9} value={discovery.helpRequest.body} aria-label="IT 담당자 문의 문장" />
                  <small>이 내용을 그대로 복사해 담당자에게 보내면 필요한 값을 받을 수 있습니다.</small>
                </details>
              ) : null}
            </section>
            {mailProviderHint && (mailProviderHint.enableImap || mailProviderHint.appPassword) ? (
              <section className={styles.mailProviderGuide} aria-label={`${mailProviderHint.label} 연결 준비`}>
                <strong>{mailProviderHint.label}은 이 두 가지만 준비하면 연결돼요</strong>
                <ol>
                  {mailProviderHint.enableImap ? (
                    <li>
                      <span>IMAP 켜기</span>
                      <small>{mailProviderHint.enableImap.path}</small>
                      <a href={mailProviderHint.enableImap.url} target="_blank" rel="noreferrer">켜는 곳 열기</a>
                    </li>
                  ) : null}
                  {mailProviderHint.appPassword ? (
                    <li>
                      <span>앱 비밀번호 만들기</span>
                      <small>{mailProviderHint.appPassword.path}</small>
                      <a href={mailProviderHint.appPassword.url} target="_blank" rel="noreferrer">만드는 곳 열기</a>
                    </li>
                  ) : null}
                </ol>
                {mailProviderHint.oauthPreferred ? (
                  <p>
                    더 쉬운 방법: {mailProviderHint.label} 계정은 IMAP 대신 “{mailProviderHint.label} 연결”(계정 동의 창)을 고르면 비밀번호 없이 연결됩니다.{" "}
                    {onSwitchConnector ? (
                      <button
                        type="button"
                        onClick={() => onSwitchConnector(mailProviderHint.id)}
                        data-mail-provider-switch={mailProviderHint.id}
                      >
                        {mailProviderHint.label} 연결로 바꾸기
                      </button>
                    ) : (
                      <a href={`/connect?open=${mailProviderHint.id}`} data-mail-provider-switch={mailProviderHint.id}>
                        {mailProviderHint.label} 연결로 바꾸기
                      </a>
                    )}
                  </p>
                ) : null}
              </section>
            ) : null}
            <label className={styles.field}>
              <span>메일 연결 비밀번호</span>
              <input
                type="password"
                name={`${activeConnectorId}-imap-secret`}
                autoComplete="off"
                placeholder={mailProviderHint?.needsAppPassword ? `${mailProviderHint.label} 앱 비밀번호를 붙여넣기` : "메일 서비스에서 만든 앱 비밀번호 또는 회사에서 준 비밀번호"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
              <small>
                {mailProviderHint?.needsAppPassword
                  ? `${mailProviderHint.label} 앱 비밀번호를 붙여넣으세요. 평소 로그인 비밀번호가 아니에요.`
                  : "일반 로그인 비밀번호가 안 되면, 앱 비밀번호 발급이 필요한 메일일 수 있어요."}
              </small>
            </label>
            <div className={styles.mailSimpleStart} role="status" aria-live="polite">
              <strong>{trustedMailServerSuggestion && suggestedMailServer ? `${suggestedMailServer.label} 서버를 자동으로 찾았어요.` : "메일 서버는 자동으로 찾습니다."}</strong>
              <span>{trustedMailServerSuggestion ? "아래 버튼을 누르면 실제 받은편지함 읽기까지 바로 확인합니다." : "회사 메일은 안전한 서버 후보를 찾은 뒤 한 번만 확인을 요청할 수 있습니다."}</span>
            </div>
            <details className={styles.mailExtraOptions}>
              <summary>연결이 안 될 때만: 웹메일 주소·메일 종류</summary>
              <div>
            <label className={styles.field}>
              <span>웹메일 접속 주소 <em>선택</em></span>
              <input
                type="url"
                inputMode="url"
                name={`${activeConnectorId}-webmail-url`}
                autoComplete="url"
                placeholder="https://portal.company.ac.kr/..."
                value={webmailUrl}
                onChange={(e) => setWebmailUrl(e.target.value)}
                aria-invalid={webmailUrlIssue ? "true" : "false"}
              />
              <small>Chrome에서 메일을 볼 때 여는 사이트 주소예요. 내 이메일 주소와 달라도 괜찮고, 몰라도 비워두면 됩니다.</small>
              {webmailUrlIssue ? <small className={styles.fieldError}>{webmailUrlIssue}</small> : null}
            </label>
            {activeConnector.imapPresets?.length ? (
              <div className={styles.imapPresetBox} aria-label="메일 서버 빠른 선택">
                <span>메일 종류를 고르면 자동으로 채워드려요</span>
                <div>
                  {activeConnector.imapPresets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setImapHost(preset.host);
                        setImapPort(String(preset.port));
                      }}
                    >
                      <strong>{preset.label}</strong>
                      <small>주소와 비밀번호만 입력하면 됩니다</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
              </div>
            </details>
            <details className={styles.imapAdvancedSettings}>
              <summary>회사에서 서버값을 받은 경우</summary>
              <div>
                <div className={styles.imapHostNotice} role="note">
                  <strong>대부분은 비워둬도 됩니다.</strong>
                  <span>자동 연결이 안 될 때만 회사 전산 담당자가 알려준 메일 서버값을 입력하세요.</span>
                </div>
                <label className={styles.field}>
                  <span>메일 서버</span>
                  <input
                    type="text"
                    name={`${activeConnectorId}-imap-host`}
                    placeholder={suggestedMailServer?.host ?? "mail.company.com"}
                    value={imapHost}
                    onChange={(e) => setImapHost(e.target.value)}
                    aria-invalid={imapHostIssue ? "true" : "false"}
                  />
                  {imapHostIssue ? <small className={styles.fieldError}>{imapHostIssue}</small> : null}
                </label>
                <label className={styles.field}>
                  <span>포트</span>
                  <input
                    type="number"
                    name={`${activeConnectorId}-imap-port`}
                    value={imapPort}
                    onChange={(e) => setImapPort(e.target.value)}
                    aria-invalid={imapPortIssue ? "true" : "false"}
                  />
                  {imapPortIssue ? <small className={styles.fieldError}>{imapPortIssue}</small> : null}
                </label>
                <label className={styles.field}>
                  <span>보내기 서버 (SMTP) · 선택</span>
                  <input type="text" value={smtpHost} onChange={e => setSmtpHost(e.target.value)} placeholder="smtp.company.com" autoComplete="off" />
                </label>
                <label className={styles.field}>
                  <span>보내기 포트</span>
                  <select value={smtpPort} onChange={e => setSmtpPort(e.target.value)}>
                    <option value="465">465 · TLS</option><option value="587">587 · STARTTLS</option>
                  </select>
                  <small>받기와 보내기 서버가 다를 때 입력하세요. 메일 발송은 승인 후 실행됩니다.</small>
                </label>
              </div>
            </details>
            {effectiveWebmailUrl ? (
              <section className={styles.imapFallbackBox} aria-label="웹 로그인 계정 보관 다음 방법">
                <div>
                  <span>웹메일 접속 주소를 따로 확인했어요.</span>
                  <strong>공식 메일 연결이 막히면 이 포털을 안전한 다음 방법으로 쓸 수 있습니다.</strong>
                  <p>
                    메일함을 직접 읽는 기능은 공식 메일 연결이 필요하지만, 포털 주소와 계정은 암호화 보관함에 저장해
                    내 PC 읽기 모드의 다음 방법으로 이어갈 수 있습니다.
                  </p>
                </div>
                <label className={styles.field}>
                  <span>앱 위치 또는 실행 이름 (선택)</span>
                  <input
                    type="text"
                    name={`${activeConnectorId}-imap-fallback-app-path`}
                    autoComplete="off"
                    placeholder="예: chrome.exe 또는 그룹웨어 앱 경로"
                    value={appPath}
                    onChange={(e) => setAppPath(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={handleStoreImapWebLoginFallback}
                  disabled={!canStoreImapWebLoginFallback || busy}
                >
                  {busy ? "보관 중..." : "웹메일 로그인으로 준비"}
                </button>
                <small>
                  보관 후에도 관리자에게 외부 메일 연결 허용 여부를 확인하면 메일함 분석 정확도가 더 좋아집니다.
                </small>
              </section>
            ) : null}
            <details className={styles.mailExtraOptions}>
              <summary>다른 방법·기본값 보기</summary>
              <div>
                <div className={styles.mailRouteChoices} aria-label="메일 연결 방식 선택 안내">
                  <article>
                    <span>계정 동의</span>
                    <strong>Gmail / Outlook</strong>
                    <small>공식 동의 창으로 읽기 권한부터 연결합니다.</small>
                  </article>
                  <article data-active="true">
                    <span>일반 메일</span>
                    <strong>NAVER / Daum / Kakao / 회사메일</strong>
                    <small>주소와 앱 비밀번호를 넣으면 IMAP 기본값을 자동 추정합니다.</small>
                  </article>
                  <article>
                    <span>막힐 때</span>
                    <strong>웹메일 보관함</strong>
                    <small>서버를 모르면 웹 로그인 주소를 보관하고 내 PC 읽기 후보로 이어갑니다.</small>
                  </article>
                </div>
                <div className={styles.mailFilterPreview} aria-label="메일 정리 기본값">
                  <article data-kind="important">
                    <span>먼저 확인</span>
                    <strong>중요 발신자와 업무 키워드</strong>
                    <small>결제, 계약, 마감, 일정, 학교·기관, 개인 약속은 우선 업무 후보로 올립니다.</small>
                  </article>
                  <article data-kind="exclude">
                    <span>기본 제외</span>
                    <strong>스팸, 광고, 뉴스레터, 자동 알림</strong>
                    <small>필요하면 나중에 제외 해제나 발신자/키워드 추가로 바꿀 수 있습니다.</small>
                  </article>
                </div>
              </div>
            </details>
          </div>
        );
      case "site_login":
        return (
          <div className={styles.fieldGroup}>
            <label className={styles.field}>
              <span>사이트 로그인 주소</span>
              <input
                type="url"
                name={`${activeConnectorId}-site-url`}
                autoComplete="off"
                placeholder="https://example.com/login"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                aria-invalid={Boolean(siteUrlIssue)}
              />
              {siteUrlIssue ? <small className={styles.fieldError}>{siteUrlIssue}</small> : null}
            </label>
            <label className={styles.field}>
              <span>사이트 아이디</span>
              <input
                type="text"
                name={`${activeConnectorId}-site-user`}
                autoComplete="off"
                value={siteUserId}
                onChange={(e) => setSiteUserId(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>사이트 비밀번호</span>
              <input
                type="password"
                name={`${activeConnectorId}-site-secret`}
                autoComplete="off"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>앱 위치 또는 실행 이름 (선택)</span>
              <input
                type="text"
                name={`${activeConnectorId}-app-path`}
                autoComplete="off"
                placeholder="예: C:\\Program Files\\... 또는 chrome.exe"
                value={appPath}
                onChange={(e) => setAppPath(e.target.value)}
              />
            </label>
            <small className={styles.note}>
              이 값은 사이트 자동 로그인 준비용 보관 정보입니다. 앱 위치를 함께 저장하면 공식 연결이 막혔을 때
              내 PC 작업 도우미 읽기 후보로 이어갈 수 있습니다. 메일 수신함을 읽으려면 메일함 연결, 계정 동의 연결, 전달 주소처럼 실제 메일 연결 방식이 별도로 필요할 수 있습니다.
            </small>
          </div>
        );
      case "oauth":
        return (
          <div className={styles.oauthBlock}>
            <p className={styles.oauthNote}>
              아래 버튼을 누르면 외부 브라우저로 동의 창이 열립니다. 동의가 끝나면 ModyCrew 가 자동으로
              연결 확인값을 암호화 보관함에 저장합니다. ModyCrew 자체 화면에는 보안값 원문을 보관하거나 표시하지 않습니다.
            </p>
            {selectedOAuthScope ? (
              <div className={styles.scopePreview}>
                <span>이번 연결 권한</span>
                <strong>{activeConnectorId === "outlook-calendar" ? "Microsoft 일정 등록 권한" : "Google 일정 등록 권한"}</strong>
                <small>일정 등록 권한은 사용자가 마지막으로 확인한 뒤에만 사용됩니다.</small>
              </div>
            ) : null}
          </div>
        );
      case "local_permission":
        return (
          <p className={styles.oauthNote}>
            폴더 선택 창을 열어 ModyCrew 에 읽기 권한을 줄 폴더를 정합니다. 선택한 폴더 밖은
            읽지 않습니다. 정보는 컴퓨터에 그대로 두고 ModyCrew 는 검색·요약만 수행합니다.
          </p>
        );
      default:
        return null;
    }
  }
}

function botTokenLabel(connectorId: string) {
  if (connectorId === "slack-app") return "Slack 앱 인증값";
  if (connectorId === "discord-app") return "Discord 봇 인증값";
  return "봇 인증값";
}

function botTokenPlaceholder(connectorId: string) {
  if (connectorId === "slack-app") return "Slack 앱에서 복사한 인증값";
  if (connectorId === "discord-app") return "Discord 개발자 화면에서 받은 인증값";
  return "BotFather에서 받은 인증값";
}

function channelTargetLabel(connectorId: string) {
  if (connectorId === "slack-app") return "보고 받을 Slack channel id";
  if (connectorId === "discord-app") return "보고 받을 Discord channel id";
  return "승인 알림 받을 chat_id";
}

function channelTargetPlaceholder(connectorId: string) {
  if (connectorId === "slack-app") return "예: C0123456789";
  if (connectorId === "discord-app") return "예: 123456789012345678";
  return "예: 987654321 또는 @channelusername";
}

function isConnectorStatusReady(status?: string) {
  if (!status) return false;
  return [
    "imap_connected",
    "mail_loaded",
    "freebusy_loaded",
    "oauth_token_ready",
    "telegram_command_inbox_ready",
    "slack_command_inbox_ready",
    "discord_command_inbox_ready",
    "connector_ready",
    "connected",
  ].includes(status);
}

type ConnectorResultTone = "ready" | "oauth" | "recovery" | "blocked" | "neutral" | "idle";

type ConnectorResultAction =
  | {
      kind: "retry";
      label: string;
      detail: string;
    }
  | {
      kind: "link";
      label: string;
      detail: string;
      href: string;
    };

function connectorResultTone(result: ConnectorConnectResult): ConnectorResultTone {
  if (result.status === "site_login_stored") return "neutral";
  if (isConnectorStatusReady(result.status)) return "ready";
  if (result.authorizationUrl || result.callbackUrl) return "oauth";
  if (result.recovery?.kind === "credential_failed" || /failed|invalid|error|blocked/u.test(result.status)) return "blocked";
  if (result.recovery?.kind) return "recovery";
  return "neutral";
}

function connectorResultToneLabel(tone: ConnectorResultTone) {
  if (tone === "ready") return "연결 완료";
  if (tone === "oauth") return "브라우저 승인";
  if (tone === "blocked") return "복구 필요";
  if (tone === "recovery") return "다음 단계";
  return "연결 결과";
}

function connectorVisibleStatusLabel(status = "") {
  const normalized = status.toLowerCase();
  if (normalized === "site_login_stored") return "정보 저장됨";
  if (/command_inbox_ready/u.test(normalized)) return "봇 인증 확인";
  if (!normalized) return "상태 확인";
  if (/discovery.*confirmation/u.test(normalized)) return "서버 확인";
  if (/connected|ready|loaded|verified|stored|exchanged/u.test(normalized)) return "사용 가능";
  if (/authorization|oauth|consent|callback/u.test(normalized)) return "승인 대기";
  if (/credential|password|token|secret|invalid|failed/u.test(normalized)) return "보안값 확인";
  if (/permission|scope|policy|admin/u.test(normalized)) return "권한 확인";
  if (/desktop|required|missing|not_found/u.test(normalized)) return "앱 확인";
  if (/blocked|error/u.test(normalized)) return "점검 필요";
  return "상태 확인";
}

function connectorResultTitle(result: ConnectorConnectResult) {
  if (result.status === "site_login_stored") return "계정 정보 저장됨 · 연결 미확인";
  if (/command_inbox_ready/u.test(result.status)) return "봇 인증을 확인했습니다. 회사 운영에서 업무방 수신을 확인해 주세요.";
  if (isConnectorStatusReady(result.status)) return "바로 업무 비서에 사용할 수 있습니다";
  if (result.mailServerDiscovery?.candidates.length) return "서버를 확인한 뒤 연결합니다";
  if (result.authorizationUrl) return "브라우저에서 승인하면 앱으로 돌아옵니다";
  if (result.recovery?.label) return result.recovery.label;
  if (result.errorMessage) return "연결 진단을 확인하세요";
  return "연결 결과를 확인하세요";
}

function visibleConnectorRecoveryTitle(result: ConnectorConnectResult) {
  if (result.status === "site_login_stored") return "연결 방법 확인";
  if (isConnectorStatusReady(result.status)) return "바로 사용 가능";
  if (result.authorizationUrl) return "브라우저 승인";
  if (result.recovery?.kind === "credential_failed") return "로그인 정보 다시 저장";
  if (result.recovery?.kind === "permission_required") return "권한 승인 확인";
  if (result.recovery?.kind === "install_required") return "앱 위치 확인";
  if (result.recovery?.kind === "connection_required") return "연결 다시 확인";
  if (result.recovery?.kind) return "다음 행동 선택";
  return "연결 다시 확인";
}

function visibleConnectorRecoveryReason(result: ConnectorConnectResult) {
  if (result.status === "site_login_stored") return "정보 보관과 실제 연결 확인은 별도입니다.";
  if (isConnectorStatusReady(result.status)) return "업무 비서에 바로 연결할 수 있습니다.";
  const raw = [
    result.recovery?.kind,
    result.recovery?.label,
    result.recovery?.detail,
    result.errorMessage,
    result.userMessage,
  ].filter(Boolean).join(" ");
  if (/credential|secret|token|토큰|비밀번호|인증|로그인|계정/u.test(raw)) {
    return "로그인 정보를 보관함에 다시 저장하세요.";
  }
  if (/permission|scope|admin|관리자|권한|초대|승인/u.test(raw)) {
    return "권한 승인이 필요합니다.";
  }
  if (/install|desktop|Windows|앱 위치|브라우저|설치/u.test(raw)) {
    return "앱 위치를 확인하세요.";
  }
  if (/mail|imap|smtp|oauth|메일|캘린더/u.test(raw)) {
    return "연결을 다시 확인하세요.";
  }
  if (result.authorizationUrl || result.callbackUrl) return "브라우저 승인을 마치면 앱으로 돌아옵니다.";
  return "연결 상태를 다시 확인하세요.";
}

function visibleConnectorFallbackRoute(route: string) {
  if (/보관함|비밀번호|계정|로그인|토큰|secret|credential/u.test(route)) return "계정 보관함 열기";
  if (/내 PC 작업 도우미|PC|desktop|Windows|화면/u.test(route)) return "읽기 후보 만들기";
  if (/앱 위치|사이트 링크|브라우저|설치/u.test(route)) return "앱 위치 확인";
  if (/오피스|승인|수동/u.test(route)) return "승인함 보기";
  if (/연결창|재점검|다시|live\s*check|공식/u.test(route)) return "연결 다시 확인";
  return "다음 행동 고르기";
}

function visibleConnectorSafeNextAction(action: string) {
  if (/발송|등록|공유|삭제|최종 승인|실행/u.test(action)) return "최종 승인 전 실행 안 함";
  if (/비밀번호|토큰|secret|원문/u.test(action)) return "비밀값은 채팅에 남기지 않음";
  if (/읽기/u.test(action)) return "읽기 전용으로 확인";
  return "안전하게 보류";
}

function buildConnectorResultActions(result: ConnectorConnectResult, connector: ConnectorDefinition): ConnectorResultAction[] {
  const recovery = result.recovery;
  const routes = recovery?.fallbackRoutes ?? [];
  const fallbackIds = recovery?.fallbackConnectorIds ?? [];
  const isReady = isConnectorStatusReady(result.status);
  const needsAuthorization = Boolean(result.authorizationUrl);
  const isDesktopRequired = /desktop_required|desktop_bridge_loading/u.test(result.status);
  const isGatewayConnector = connector.category === "mail" || connector.category === "messenger";
  const needsVault =
    (!isReady && !needsAuthorization && isGatewayConnector) ||
    connector.method === "site_login" ||
    connector.method === "imap_smtp" ||
    connector.method === "bot_token" ||
    connector.method === "api_key" ||
    recovery?.kind === "credential_failed" ||
    fallbackIds.includes("external-account-vault") ||
    routes.some((route) => /보관함|사이트 링크|앱 위치|비밀번호/u.test(route));
  const needsComputerUse =
    fallbackIds.includes("computer-use") ||
    connector.method === "site_login" ||
    connector.method === "imap_smtp" ||
    connector.id === "kakaotalk-local-app" ||
    connector.id === "kakao-channel" ||
    routes.some((route) => /내 PC 작업 도우미|앱 위치|사이트 링크/u.test(route));
  const needsOfficeReview =
    (!isReady && !needsAuthorization && isGatewayConnector) ||
    Boolean(result.stagedWorkItem) ||
    fallbackIds.includes("office-approval");
  const actions: ConnectorResultAction[] = [];

  if (!isReady && !needsAuthorization && !isDesktopRequired) {
    actions.push({
      kind: "retry",
      label: recovery?.actionLabel ?? "다시 연결",
      detail: "입력값을 고치고 다시 확인합니다.",
    });
  }

  if (needsVault) {
    actions.push({
      kind: "link",
      label: "계정 보관함",
      detail: "비밀번호와 사이트 계정은 채팅 대신 암호화 보관함에 저장합니다.",
      href: `/?panel=connect&externalAccounts=1&connector=${encodeURIComponent(connector.id)}`,
    });
  }

  if (needsComputerUse) {
    actions.push({
      kind: "link",
      label: "내 PC 작업 도우미",
      detail: "화면 읽기 후보만 만들고 실행은 멈춥니다.",
      href: `/?computerUse=1&source=connect-recovery&connector=${encodeURIComponent(connector.id)}`,
    });
  }

  if (needsOfficeReview) {
    actions.push({
      kind: "link",
      label: "오피스 확인",
      detail: "실행 후보는 승인함에서 미리보기와 잠금 상태를 확인합니다.",
      href: `/?panel=office&source=connect-recovery&connector=${encodeURIComponent(connector.id)}`,
    });
  }

  if (isReady) {
    actions.push({
      kind: "link",
      label: "업무 비서로 돌아가기",
      detail: connector.category === "mail" ? "메일함 읽기와 승인 후보 생성을 이어갑니다." : "채팅에서 바로 다음 일을 맡깁니다.",
      href: connector.category === "mail" ? "/?mailOps=1" : "/?panel=office",
    });
  }

  return actions.slice(0, 3);
}

function buildMessengerConnectionStages(
  connectorId: string,
  statusRecord: ConnectorStatusRecord | undefined,
  statusReady: boolean,
) {
  const targetStored = Boolean(statusRecord?.channelTargetId);
  const telegramTargetStored = connectorId === "telegram-bot" && Boolean((statusRecord as ConnectorStatusRecord & { chatId?: string } | undefined)?.chatId);
  const hasTarget = targetStored || telegramTargetStored;
  return [
    {
      label: "보관함 저장",
      detail: statusRecord ? "인증값 확인 정보만 표시" : "인증값 입력 후 OS 저장소 보관",
      state: statusRecord ? "done" : "active",
    },
    {
      label: "실제 연결 점검",
      detail: liveCheckLabelFor(connectorId),
      state: statusReady ? "done" : statusRecord ? "error" : "next",
    },
    {
      label: "보고 대상",
      detail: hasTarget ? "승인/보고 채널 저장됨" : "대상 id는 나중에 추가 가능",
      state: hasTarget ? "done" : statusReady ? "active" : "next",
    },
    {
      label: "오피스 라우팅",
      detail: statusReady ? "결정 인박스와 AI 팀원 승인함 연결" : "연결되면 자동으로 표시",
      state: statusReady ? "done" : "next",
    },
  ];
}

function liveCheckLabelFor(connectorId: string) {
  if (connectorId === "slack-app") return "Slack auth.test";
  if (connectorId === "discord-app") return "Discord /users/@me";
  if (connectorId === "kakaotalk-local-app") return "앱 위치/사이트 링크 저장 + 내 PC 작업 도우미 읽기 후보";
  return "Telegram getMe";
}

function messengerStatusTitle(connectorId: string, statusRecord: ConnectorStatusRecord | undefined, statusReady: boolean) {
  if (statusReady) return `${messengerShortName(connectorId)} 봇 인증 확인`;
  if (statusRecord?.status) return statusRecord.userMessage ?? `${messengerShortName(connectorId)} 상태: ${statusRecord.status}`;
  return `${messengerShortName(connectorId)} 연결을 시작하세요`;
}

function messengerStatusDetail(connectorId: string, statusRecord: ConnectorStatusRecord | undefined, statusReady: boolean) {
  if (statusReady) {
    const checkedAt = statusRecord?.lastCheckedAt ? ` · ${new Date(statusRecord.lastCheckedAt).toLocaleString("ko-KR")}` : "";
    return `계정 인증을 확인했습니다${checkedAt}. 실제 업무방 수신과 부서 배정은 회사 운영에서 설정·검증해 주세요.`;
  }
  if (statusRecord?.recovery?.detail) return statusRecord.recovery.detail;
  return `${liveCheckLabelFor(connectorId)} 점검 후 성공한 값만 보관합니다.`;
}

function messengerShortName(connectorId: string) {
  if (connectorId === "slack-app") return "Slack";
  if (connectorId === "discord-app") return "Discord";
  if (connectorId === "kakaotalk-local-app") return "KakaoTalk";
  if (connectorId === "kakao-channel") return "Kakao";
  return "Telegram";
}

function formatBulkSendPlanItems(plan: ConnectorBulkSendPlan): string[] {
  if (!plan || plan.status !== "review_required") return [];
  return [
    plan.targetGroups?.length ? `대상 그룹: ${plan.targetGroups.slice(0, 3).join(", ")}` : "",
    plan.excludedGroups?.length ? `제외 확인: ${plan.excludedGroups.slice(0, 2).join(", ")}` : "",
    plan.personalizationFields?.length ? `개인화: ${plan.personalizationFields.slice(0, 3).join(", ")}` : "",
    plan.approvalGate ?? "",
  ].filter(Boolean);
}

function formatFollowUpPlanItems(plan: ConnectorFollowUpPlan): string[] {
  if (!plan || plan.status !== "review_required") return [];
  return [
    plan.waitingSignals?.length ? `신호: ${plan.waitingSignals.slice(0, 3).join(", ")}` : "",
    plan.nextCheckLabel ? `다음 확인: ${plan.nextCheckLabel}` : "",
    plan.suggestedCadence?.length ? `주기: ${plan.suggestedCadence.slice(0, 2).join(" / ")}` : "",
    plan.approvalGate ?? "",
  ].filter(Boolean);
}

function formatRecipientSourcePlanItems(plan: ConnectorRecipientSourcePlan): string[] {
  if (!plan || plan.status !== "review_required") return [];
  return [
    plan.sourceTypes?.length ? `원천: ${plan.sourceTypes.slice(0, 3).join(", ")}` : "",
    plan.fileReviewChecklist?.length ? `검토: ${plan.fileReviewChecklist.slice(0, 2).join(" / ")}` : "",
    plan.matchingRules?.length ? `규칙: ${plan.matchingRules.slice(0, 2).join(" / ")}` : "",
    plan.approvalGate ?? "",
  ].filter(Boolean);
}

function AnalysisList({ title, items }: { title: string; items?: string[] }) {
  const visibleItems = (items ?? []).filter(Boolean).slice(0, 3);
  if (visibleItems.length === 0) return null;
  return (
    <div className={styles.analysisList}>
      <span>{title}</span>
      <ul>
        {visibleItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function calendarWriteScopeFor(connectorId: string) {
  if (connectorId === "outlook-calendar") return "offline_access Calendars.ReadWrite";
  return "https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events";
}

function validateImapHostInput(value: string) {
  const host = value.trim();
  if (!host) return "메일 서버 주소를 입력하세요.";
  if (/^https?:\/\//iu.test(host) || /[/?#]/u.test(host)) {
    return "웹 로그인 주소가 아니라 회사에서 알려준 메일 서버명만 입력하세요. 예: mail.example.com";
  }
  if (!/^[a-z0-9.-]{3,253}$/iu.test(host) || host.includes("..") || host.startsWith(".") || host.endsWith(".")) {
    return "서버 주소 형식이 올바르지 않습니다. 영문, 숫자, 점, 하이픈만 사용할 수 있습니다.";
  }
  if (!host.includes(".")) return "도메인이 포함된 메일 서버 주소가 필요합니다. 예: mail.example.com";
  return "";
}

// 메일 제공사별 "쉬운 연결" 지식: 이메일 주소만 치면 서버가 자동으로 맞춰지고,
// 앱 비밀번호가 필요한 곳은 어디를 눌러 켜고 발급하는지 정확한 경로/링크를 함께 안내합니다.
// host/port 는 packages/domain/src/mail-connection-readiness.ts 의 검증된 값과 일치시킵니다.
type MailProviderStep = { url: string; path: string };
export type MailProviderHint = {
  id: string;
  label: string;
  domains: string[];
  host: string;
  port: number;
  oauthPreferred?: boolean;
  needsAppPassword: boolean;
  enableImap?: MailProviderStep;
  appPassword?: MailProviderStep;
};

const MAIL_PROVIDER_HINTS: MailProviderHint[] = [
  {
    id: "gmail",
    label: "Gmail",
    domains: ["gmail.com", "googlemail.com"],
    host: "imap.gmail.com",
    port: 993,
    oauthPreferred: true,
    needsAppPassword: true,
    enableImap: { url: "https://mail.google.com/mail/u/0/#settings/fwdandpop", path: "설정(톱니) → 모든 설정 보기 → 전달 및 POP/IMAP → 'IMAP 사용'" },
    appPassword: { url: "https://myaccount.google.com/apppasswords", path: "Google 계정 → 보안 → 2단계 인증을 켠 뒤 → '앱 비밀번호' 생성" },
  },
  {
    id: "naver",
    label: "NAVER 메일",
    domains: ["naver.com"],
    host: "imap.naver.com",
    port: 993,
    needsAppPassword: true,
    enableImap: { url: "https://mail.naver.com", path: "환경설정 → POP3/IMAP 설정 → 'IMAP/SMTP 사용'을 '사용함'으로" },
    appPassword: { url: "https://nid.naver.com", path: "내정보 → 보안설정 → 2단계 인증을 쓰면 '애플리케이션 비밀번호' 발급" },
  },
  {
    id: "daum",
    label: "Daum 메일",
    domains: ["daum.net", "hanmail.net"],
    host: "imap.daum.net",
    port: 993,
    needsAppPassword: true,
    enableImap: { url: "https://mail.daum.net", path: "환경설정 → IMAP/POP3 설정 → 'IMAP 사용'" },
    appPassword: { url: "https://accounts.kakao.com", path: "카카오계정 → 보안 → 2단계 인증을 쓰면 앱 비밀번호 발급" },
  },
  {
    id: "kakao",
    label: "Kakao 메일",
    domains: ["kakao.com"],
    host: "imap.kakao.com",
    port: 993,
    needsAppPassword: true,
    enableImap: { url: "https://mail.kakao.com", path: "환경설정 → IMAP/POP3 → 'IMAP 사용'" },
    appPassword: { url: "https://accounts.kakao.com", path: "카카오계정 → 보안 → 2단계 인증을 쓰면 앱 비밀번호 발급" },
  },
  {
    id: "nate",
    label: "네이트 메일",
    domains: ["nate.com"],
    host: "imap.mail.nate.com",
    port: 993,
    needsAppPassword: false,
    enableImap: { url: "https://mail.nate.com", path: "환경설정 → POP/IMAP 설정 → 'IMAP 사용'" },
  },
  {
    id: "outlook",
    label: "Outlook / 핫메일",
    domains: ["outlook.com", "outlook.kr", "hotmail.com", "hotmail.co.kr", "live.com", "live.co.kr", "msn.com"],
    host: "outlook.office365.com",
    port: 993,
    oauthPreferred: true,
    needsAppPassword: true,
    enableImap: { url: "https://outlook.live.com/mail/0/options/mail/POP", path: "Outlook 웹 → 설정 → 메일 → 동기화 이메일 → POP/IMAP" },
    appPassword: { url: "https://account.microsoft.com/security", path: "보안 → 고급 보안 옵션 → '앱 암호' 만들기" },
  },
  {
    id: "icloud",
    label: "iCloud 메일",
    domains: ["icloud.com", "me.com", "mac.com"],
    host: "imap.mail.me.com",
    port: 993,
    needsAppPassword: true,
    appPassword: { url: "https://account.apple.com", path: "로그인 및 보안 → '앱 암호' → 앱 암호 생성 (반드시 필요)" },
  },
  {
    id: "yahoo",
    label: "Yahoo 메일",
    domains: ["yahoo.com", "yahoo.co.kr", "ymail.com", "rocketmail.com"],
    host: "imap.mail.yahoo.com",
    port: 993,
    needsAppPassword: true,
    appPassword: { url: "https://login.yahoo.com/account/security", path: "계정 보안 → '앱 비밀번호 생성/관리'" },
  },
];

function mailDomainFromAddress(value: string): string {
  const raw = value.trim().toLowerCase();
  const domain = raw.includes("@") ? raw.split("@").pop()?.replace(/[>\s]/gu, "") : "";
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/iu.test(domain)) return "";
  return domain;
}

// 입력한 이메일 주소의 제공사를 알아내 "IMAP 켜기 / 앱 비밀번호 만들기" 안내를 돌려줍니다.
function findMailProviderHint(value: string): MailProviderHint | null {
  const domain = mailDomainFromAddress(value);
  if (!domain) return null;
  return MAIL_PROVIDER_HINTS.find((hint) => hint.domains.includes(domain)) ?? null;
}

function suggestMailServerFromAddress(
  value: string,
  presets: ConnectorDefinition["imapPresets"] = [],
): { label: string; host: string; port: number } | null {
  const domain = mailDomainFromAddress(value);
  if (!domain) return presets[0] ?? null;
  const matchedPreset = presets.find((preset) => domainMatchesMailPreset(domain, preset.host));
  if (matchedPreset) return { label: matchedPreset.label, host: matchedPreset.host, port: matchedPreset.port };
  const known = MAIL_PROVIDER_HINTS.find((hint) => hint.domains.includes(domain));
  if (known) return { label: known.label, host: known.host, port: known.port };
  return { label: `${domain} 기본 메일 서버`, host: `imap.${domain}`, port: 993 };
}

function isTrustedMailServerSuggestion(
  value: string,
  suggestion: { label: string; host: string; port: number } | null,
  presets: ConnectorDefinition["imapPresets"] = [],
) {
  if (!suggestion) return false;
  const domain = value.trim().toLowerCase().split("@").pop()?.replace(/[>\s]/gu, "") ?? "";
  if (!domain) return false;
  if (
    [
      "gmail.com",
      "googlemail.com",
      "naver.com",
      "kakao.com",
      "daum.net",
      "hanmail.net",
      // 아래는 서버 주소를 이미 알고 있으면서도 목록에 없어 값을 비우고
      // 사용자에게 손입력을 시키던 제공사들이다.
      "outlook.com",
      "hotmail.com",
      "live.com",
      "msn.com",
      "icloud.com",
      "me.com",
      "mac.com",
      "yahoo.com",
      "yahoo.co.kr",
      "nate.com",
    ].includes(domain)
  )
    return true;
  return presets.some((preset) => preset.host === suggestion.host && preset.port === suggestion.port && domainMatchesMailPreset(domain, preset.host));
}

function domainMatchesMailPreset(domain: string, host: string) {
  const normalizedHost = host.toLowerCase();
  if (domain === "hanmail.net" && normalizedHost.includes("daum")) return true;
  return normalizedHost.includes(domain.replace(/\.(com|net|co\.kr)$/iu, ""));
}

function isWebLoginUrlInput(value: string) {
  const raw = value.trim();
  if (!raw) return false;
  if (/^https?:\/\//iu.test(raw)) return true;
  return /[/?#]/u.test(raw);
}

function validateImapPortInput(value: string) {
  const port = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return "포트는 1~65535 사이 숫자여야 합니다. 보통 보안 메일 연결은 993입니다.";
  }
  return "";
}

function validateSiteUrlInput(value: string) {
  const raw = value.trim();
  if (!raw) return "사이트 로그인 주소를 입력하세요.";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "http 또는 https 주소만 사용할 수 있습니다.";
    }
    if (!url.hostname.includes(".")) return "도메인이 포함된 사이트 주소가 필요합니다.";
    return "";
  } catch {
    return "사이트 주소 형식이 올바르지 않습니다. 예: https://example.com/login";
  }
}
