"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectorCatalog } from "@/components/ConnectorCatalog";
import { FocusedConnection } from "@/components/FocusedConnection";
import { ConnectorDrawer, type ConnectorConnectPayload } from "@/components/ConnectorDrawer";
import { ExternalAccountVaultCard } from "@/components/ExternalAccountVaultCard";
import {
  categoryLabels,
  methodLabels,
  sampleConnectors,
  triggerLabels,
  type ConnectorDefinition,
} from "@/lib/connectors";
import {
  getFeatureLauncherCatalogItem,
  getProgressiveDisclosureFeatureLauncherItems,
  getQualityGateFeatureLauncherItems,
  validateFeatureLauncherReplacement,
  type FeatureLauncherCatalogItem,
} from "@/lib/feature-launcher-catalog";
import {
  createDesktopBridge,
  type ConnectorStatusRecord,
  type DesktopBridgeApi,
  type LocalMemoryConnectorRecoveryMemory,
  type LocalMemoryStatusResult,
} from "@/lib/desktop-bridge";
import { saveLocalAutomationDraft, type LocalAutomationDraft } from "@/lib/local-automation-drafts";
import { createLocalAutomationRuleFromDraft } from "@/lib/local-automation-rules";
import { normalizeInternalReturnPath } from "@/lib/safe-navigation";
import {
  connectorIdsForSingleWorkSetting,
  getSingleWorkSettingDefinition,
  normalizeSingleWorkSettingId,
  singleWorkSettingFocusLabel,
} from "@/lib/single-work-settings";
import styles from "./page.module.css";

type RelayStatus = Awaited<ReturnType<DesktopBridgeApi["getPublicTriggerRelayStatus"]>>;
type AutomationDraft = ReturnType<typeof buildAutomationDraft>;
type ConnectPageView = "focus" | "vault" | "recovery";
type ConnectHandoffSource =
  | "work-check"
  | "rule-check"
  | "mail-automation-notification"
  | "restore-reauth"
  | "mailops-session"
  | "home-readiness"
  | "office"
  | "setup"
  | "setup-work"
  | "chat"
  | "manual";
type AIConnectionChoiceId = "codex-oauth" | "api-key" | "local-engine";
const connectPageViewStorageKey = "modycrew-connect-page-view-v1";

function readStoredConnectPageView(): ConnectPageView {
  if (typeof window === "undefined") return "focus";
  try {
    return normalizeConnectPageView(window.localStorage.getItem(connectPageViewStorageKey));
  } catch {
    return "focus";
  }
}

function normalizeConnectPageView(value: unknown): ConnectPageView {
  return value === "vault" || value === "recovery" || value === "focus" ? value : "focus";
}
type SettingQualityGateItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  replacementUserPath: string;
  replacementFeatureId: string;
  replacementHomeAction: string;
  replacementHref: string;
  runtimeProofLabel: string;
  verifyCommand: string;
  nextUserChoice: string;
  originalExposurePolicy: string;
  replacementReadiness: string;
  replacementExecutionContract: string;
  absorptionConnectionHref?: string;
  absorptionConnectionLabel?: string;
  absorptionConnectionAction?: string;
  absorptionConnectionRole?: string;
  state: "ready" | "setup" | "hidden" | "rebuild" | "progressive";
};

// returnTo는 주소에서 오므로 같은 앱 안의 경로만 받는다. "/\host"나 탭이 섞인 값처럼 브라우저에서 다른 사이트로
// 풀리는 값은 버린다. 이 값은 FocusedConnection의 돌아가기 링크·닫기 이동과 발송 권한 화면의 돌아가기 링크에 쓰인다.
function normalizeConnectReturnTo(value: string): string {
  return normalizeInternalReturnPath(value);
}

export default function ConnectPage() {
  const connectors = useMemo(() => sampleConnectors, []);
  const inlineGuideRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [goalText, setGoalText] = useState("");
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);
  const [preferredMode, setPreferredMode] = useState<"read" | "write" | "send">("read");
  const [connectorStatuses, setConnectorStatuses] = useState<ConnectorStatusRecord[]>([]);
  const [bridge, setBridge] = useState<DesktopBridgeApi | null>(null);
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null);
  const [localMemoryStatus, setLocalMemoryStatus] = useState<LocalMemoryStatusResult | null>(null);
  const [relayBusy, setRelayBusy] = useState(false);
  const [createdDraft, setCreatedDraft] = useState<LocalAutomationDraft | null>(null);
  const [createdDraftHref, setCreatedDraftHref] = useState("/");
  const [handoffMessage, setHandoffMessage] = useState("");
  const [hasUrlHandoff, setHasUrlHandoff] = useState(false);
  const [handoffSource, setHandoffSource] = useState<ConnectHandoffSource>("manual");
  const [isReauthorizationHandoff, setIsReauthorizationHandoff] = useState(false);
  const [homeReadinessHandoff, setHomeReadinessHandoff] = useState(false);
  const [mailAutomationNotificationHandoff, setMailAutomationNotificationHandoff] = useState(false);
  const [singleSettingMode, setSingleSettingMode] = useState(false);
  const [activeSingleSetting, setActiveSingleSetting] = useState("");
  const [connectPageView, setConnectPageView] = useState<ConnectPageView>(readStoredConnectPageView);
  const [bareConnectOptionsOpen, setBareConnectOptionsOpen] = useState(false);
  const [fullCatalogOpen, setFullCatalogOpen] = useState(false);
  const [aiConnectionChoice, setAIConnectionChoice] = useState<AIConnectionChoiceId>("codex-oauth");
  const [aiConnectionChoiceMessage, setAIConnectionChoiceMessage] = useState("");
  const aiConnectionInFlightRef = useRef(false);
  const aiConnectionLastStartedAtRef = useRef(0);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [computerUseHandoffOpen, setComputerUseHandoffOpen] = useState(false);
  const [connectionAdvancedDetailsOpen, setConnectionAdvancedDetailsOpen] = useState(false);
  const [routeFocusLabel, setRouteFocusLabel] = useState("");
  const [guideFocusMessage, setGuideFocusMessage] = useState("");
  const [lastConnectedId, setLastConnectedId] = useState<string | null>(null);
  const [homeReturnHref, setHomeReturnHref] = useState("/?queue=approval");
  const [homeRecheckHref, setHomeRecheckHref] = useState("/?queue=approval");
  const [returnRuleId, setReturnRuleId] = useState("");
  const [setupReturnWork, setSetupReturnWork] = useState("");
  const [sendPermissionUpgradeMode, setSendPermissionUpgradeMode] = useState(false);
  const [sendPermissionResumeContext, setSendPermissionResumeContext] = useState({
    resume: "",
    workItemId: "",
    source: "",
    returnTo: "",
  });

  useEffect(() => {
    const nextBridge = createDesktopBridge();
    setBridge(nextBridge);
    void nextBridge.getPublicTriggerRelayStatus().then(setRelayStatus);
    void nextBridge.listConnectorStatuses().then((result) => {
      setConnectorStatuses(result.connectors ?? []);
    }).catch(() => setConnectorStatuses([]));
    void nextBridge.getLocalMemoryStatus().then(setLocalMemoryStatus);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasRouteHandoff = [...params.keys()].some((key) => key !== "preview" && key !== "mockRuntime");
    setHasUrlHandoff(hasRouteHandoff);
    const goal = params.get("goal")?.trim() || params.get("intent")?.trim() || "";
    const recommend = params.get("recommend")?.trim() ?? "";
    const open = params.get("open")?.trim() || params.get("connector")?.trim() || "";
    const singleSettingParam = params.get("singleSetting")?.trim() || "";
    const singleSetting = normalizeSingleWorkSettingId(singleSettingParam) || singleSettingParam;
    const singleSettingDefinition = getSingleWorkSettingDefinition(singleSettingParam || singleSetting);
    const mode = params.get("mode")?.trim() ?? "";
    const isSendPermissionUpgrade = mode === "send";
    const resume = params.get("resume")?.trim() ?? "";
    const resumeWorkItemId = params.get("resumeWorkItemId")?.trim() ?? "";
    const resumeSource = params.get("resumeSource")?.trim() ?? "";
    const resumeReturnTo = normalizeConnectReturnTo(params.get("returnTo")?.trim() ?? "");
    const ruleId = params.get("rule")?.trim() ?? "";
    const setupWork = params.get("setupWork")?.trim() ?? "";
    const source = parseConnectHandoffSource(params.get("from"));
    const isHomeReadinessHandoff =
      source === "home-readiness" || params.get("readiness") === "real_read_only_no_fake_success";
    const isMailAutomationNotificationHandoff =
      source === "mail-automation-notification" ||
      params.get("notificationDraft") === "mail-automation" ||
      /메일\s*자동\s*점검|앱\s*알림\s*초안/u.test(goal);
    const wantsVault =
      singleSettingDefinition?.canonicalId === "vault" ||
      params.get("externalAccounts") === "1" ||
      params.get("vault") === "1" ||
      mode === "site_login";
    const wantsComputerUse =
      params.get("computerUse") === "1" ||
      params.get("fallback") === "computer-use" ||
      params.get("route") === "computer-use";
    const reauthorization =
      params.get("reauth") === "1" || source === "restore-reauth" || /재승인|복원/u.test(goal);
    const isWorkbenchPreview = params.get("preview") === "workbench";
    const normalizedOpen = normalizeConnectorId(open);
    const singleSettingConnectorIds = connectorIdsForSingleSetting(singleSetting);
    const inferredIds = inferRecommendedConnectorIds(goal);
    const recommendedFromQuery = recommend
      .split(",")
      .map((id) => normalizeConnectorId(id.trim()))
      .filter(Boolean);
    const nextRecommendedIds = uniqueConnectorIds(
      recommendedFromQuery.length
        ? recommendedFromQuery
        : normalizedOpen
          ? [normalizedOpen]
          : singleSettingConnectorIds.length
            ? singleSettingConnectorIds
          : goal
            ? inferredIds
            : [],
    );
    const singleSettingFallbackOpen = singleSettingConnectorIds.find((id) => connectors.some((connector) => connector.id === id)) ?? "";
    const openedConnector = connectors.find((connector) => connector.id === (normalizedOpen || singleSettingFallbackOpen));
    const singleSettingLabel = singleSettingFocusLabel(singleSetting);

    setGoalText(goal);
    setHandoffSource(source);
    setIsReauthorizationHandoff(reauthorization);
    setHomeReadinessHandoff(isHomeReadinessHandoff);
    setMailAutomationNotificationHandoff(isMailAutomationNotificationHandoff);
    setSetupReturnWork(setupWork);
    setSingleSettingMode(Boolean(singleSetting || openedConnector || wantsVault || wantsComputerUse || isSendPermissionUpgrade));
    setActiveSingleSetting(singleSetting);
    setVaultOpen(wantsVault);
    setComputerUseHandoffOpen(wantsComputerUse);
    setRouteFocusLabel(
      isHomeReadinessHandoff
        ? buildRouteFocusLabel(source, wantsVault, wantsComputerUse, openedConnector?.label)
        : singleSettingLabel || buildRouteFocusLabel(source, wantsVault, wantsComputerUse, openedConnector?.label),
    );
    setReturnRuleId(ruleId);
    setHomeReturnHref(makeHomeReturnHref(isWorkbenchPreview, ruleId, false, source, goal, undefined, setupWork));
    setHomeRecheckHref(makeHomeReturnHref(
      isWorkbenchPreview,
      ruleId,
      source === "work-check" || source === "rule-check",
      source,
      goal,
      undefined,
      setupWork,
    ));
    setPreferredMode(mode === "send" ? "send" : mode === "write" ? "write" : "read");
    setSendPermissionUpgradeMode(isSendPermissionUpgrade);
    setSendPermissionResumeContext({
      resume,
      workItemId: resumeWorkItemId,
      source: resumeSource,
      returnTo: resumeReturnTo,
    });
    setRecommendedIds(nextRecommendedIds);
    if (source === "setup-work") {
      setSelectedId(null);
    } else if (openedConnector) {
      setSelectedId(openedConnector.id);
    }
    setHandoffMessage(
      goal || openedConnector || wantsVault || wantsComputerUse || singleSettingLabel
        ? `${connectHandoffSourceLabel(source)} · ${goal || singleSettingLabel || openedConnector?.label}에 맞춰 ${
            openedConnector
              ? `${openedConnector.label} 연결창을 열었습니다.`
              : wantsVault
                ? "계정 보관함 입력칸을 열었습니다."
                : wantsComputerUse
                  ? "내 PC 작업 도우미 읽기 후보를 열었습니다."
                  : "필요한 연결을 추천했습니다."
          }`
        : "",
    );
  }, [connectors]);

  useEffect(() => {
    if (!guideFocusMessage) return;
    const timeout = window.setTimeout(() => setGuideFocusMessage(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [guideFocusMessage]);

  useEffect(() => {
    try {
      window.localStorage.setItem(connectPageViewStorageKey, connectPageView);
    } catch {
      // 저장소가 막힌 환경에서는 현재 세션에서만 연결 화면 보기 방식을 유지합니다.
    }
  }, [connectPageView]);

  const selected = useMemo(
    () => connectors.find((c) => c.id === selectedId) ?? null,
    [connectors, selectedId],
  );

  const recommended = useMemo(() => {
    if (!goalText.trim() && recommendedIds.length === 0) return [];
    const ids = recommendedIds.length > 0 ? recommendedIds : inferRecommendedConnectorIds(goalText);
    const idSet = new Set(ids);
    return connectors
      .filter((connector) => idSet.has(connector.id))
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  }, [connectors, goalText, recommendedIds]);
  const connectorStatusMap = useMemo(() => {
    return new Map(connectorStatuses.map((record) => [record.connectorId, record]));
  }, [connectorStatuses]);
  const connectorRecoveryMemoryMap = useMemo(() => {
    return new Map((localMemoryStatus?.connectorRecoveryMemories ?? []).map((record) => [record.connectorId, record]));
  }, [localMemoryStatus?.connectorRecoveryMemories]);
  const readyRecommended = recommended.filter((connector) =>
    isConnectorReady(connectorStatusMap.get(connector.id)),
  );
  const pendingRecommendedConnector =
    recommended.find((connector) => !isConnectorReady(connectorStatusMap.get(connector.id))) ??
    recommended[0] ??
    null;
  const lastConnectedConnector = lastConnectedId
    ? connectors.find((connector) => connector.id === lastConnectedId) ?? null
    : null;
  const hasGoalHandoff = Boolean(goalText.trim() || recommendedIds.length > 0);
  const hasConnectionPlan = hasGoalHandoff || selectedId !== null;
  const nextConnector = hasConnectionPlan ? pendingRecommendedConnector : null;
  const shouldAutoOpenGuide =
    handoffSource !== "setup-work" &&
    (selected !== null ||
      handoffSource === "work-check" ||
      handoffSource === "rule-check" ||
      handoffSource === "mailops-session" ||
      handoffSource === "restore-reauth");
  const guideConnector =
    hasConnectionPlan && shouldAutoOpenGuide
      ? selected ?? nextConnector ?? recommended[0] ?? null
      : null;
  const sendPermissionConnector = guideConnector ?? selected ?? nextConnector ?? recommended[0] ?? null;
  const sendPermissionCopy = sendPermissionUpgradeCopy(sendPermissionConnector?.id, sendPermissionConnector?.label);
  const hasFinalConfirmationResume = sendPermissionResumeContext.resume === "mail_final_confirmation";
  const sendPermissionResumeReturnHref = sendPermissionResumeContext.returnTo || homeRecheckHref;
  const automationDraft = useMemo<AutomationDraft>(
    () => buildAutomationDraft(goalText, recommended.map((connector) => connector.label)),
    [goalText, recommended],
  );
  const setupPercent =
    hasConnectionPlan && recommended.length > 0
      ? Math.round((readyRecommended.length / recommended.length) * 100)
      : 0;
  const connectionPlanProgress = hasConnectionPlan
    ? setupPercent
    : goalText.trim().length > 0
      ? 18
      : 0;
  const visibleRecommended = hasConnectionPlan
    ? (nextConnector ? [nextConnector] : recommended.slice(0, 1)).filter(Boolean)
    : [];
  const visibleConnectionFlow = recommended.slice(0, 1);
  const hiddenConnectionFlow = recommended.slice(1);
  const hiddenConnectionCount = hiddenConnectionFlow.length;
  const activeSingleSettingDefinition = getSingleWorkSettingDefinition(activeSingleSetting);
  const singleSettingDisplayTitle = activeSingleSettingDefinition?.title ?? (selected ? `${selected.label} 설정` : "선택한 연결 설정");
  const singleSettingDisplayLabel = activeSingleSettingDefinition?.label ?? selected?.label ?? routeFocusLabel;
  const activeSingleSettingPlan = activeSingleSettingDefinition
    ? buildSingleSettingScopePlan(activeSingleSettingDefinition)
    : [];
  const settingQualityGateItems = activeSingleSettingDefinition
    ? buildSettingQualityGateItems(
        activeSingleSettingDefinition,
        getQualityGateFeatureLauncherItems(),
        getProgressiveDisclosureFeatureLauncherItems(),
      )
    : [];
  const showSingleSettingOnlyCard = singleSettingMode && !guideConnector && activeSingleSettingDefinition !== null;
  const showAIConnectionChoices = activeSingleSettingDefinition?.canonicalId === "ai";

  async function startAIConnectionChoiceLogin(choiceId: AIConnectionChoiceId) {
    const now = Date.now();
    setAIConnectionChoice(choiceId);
    if (aiConnectionInFlightRef.current || now - aiConnectionLastStartedAtRef.current < 1_500) {
      setAIConnectionChoiceMessage("AI 로그인 요청은 이미 처리 중입니다. 새 창을 반복해서 열지 않고 현재 요청 결과만 기다립니다.");
      return;
    }
    aiConnectionInFlightRef.current = true;
    aiConnectionLastStartedAtRef.current = now;
    setAIConnectionChoiceMessage("AI 로그인을 여는 중입니다.");
    try {
      const result = await bridge?.startAIProviderOAuth("codex_oauth", { model: "latest", forceReconnect: false });
      setAIConnectionChoiceMessage(
        result?.status === "codex_oauth_ready"
          ? "AI 로그인은 준비됐습니다. 실제 답변 확인을 마치면 채팅을 이어갈 수 있습니다."
          : result?.userMessage ?? "AI 로그인 창을 한 번 열었습니다. 완료되면 이 대화로 돌아옵니다.",
      );
    } catch {
      setAIConnectionChoiceMessage("AI 로그인 창을 열지 못했습니다. 추가 AI 연결이나 내 PC 준비를 선택할 수 있습니다.");
    } finally {
      aiConnectionInFlightRef.current = false;
    }
  }
  const showReleaseLiveSmokeGuide = shouldShowReleaseLiveSmokeGuide(
    activeSingleSetting,
    guideConnector ?? selected ?? nextConnector,
  );
  const activeConnectPageView = singleSettingMode ? "focus" : connectPageView;
  const isBareConnectStart =
    !hasUrlHandoff &&
    !singleSettingMode &&
    !hasConnectionPlan &&
    activeConnectPageView === "focus" &&
    !vaultOpen &&
    !computerUseHandoffOpen;
  const showBareConnectionCatalog = isBareConnectStart && bareConnectOptionsOpen;
  const showConnectionWorkspaceChrome = !isBareConnectStart;
  const showConnectionSupportChrome = showConnectionWorkspaceChrome && !singleSettingMode;
  const showConnectionOptions = showConnectionWorkspaceChrome || showBareConnectionCatalog;
  const showConnectStartDetails =
    showConnectionSupportChrome && (hasConnectionPlan || activeConnectPageView !== "focus");
  const connectPageCustomized = activeConnectPageView !== "focus" || vaultOpen || computerUseHandoffOpen;
  const connectLayoutSummary = getConnectPageViewSummary(
    activeConnectPageView,
    recommended.length,
    connectorRecoveryMemoryMap.size,
  );
  const connectPageFocusCards = getConnectPageFocusCards({
    hasConnectionPlan,
    recommendedCount: recommended.length,
    visibleConnectionCount: visibleConnectionFlow.length,
    vaultOpen,
    recoveryMemoryCount: connectorRecoveryMemoryMap.size,
  });
  const activeConnectPageFocusCard =
    connectPageFocusCards.find((item) => item.id === activeConnectPageView) ?? connectPageFocusCards[0];
  const otherConnectPageFocusCards = connectPageFocusCards.filter((item) => item.id !== activeConnectPageView);
  const visibleOtherConnectPageFocusCards = otherConnectPageFocusCards.slice(0, 1);
  const hiddenOtherConnectPageFocusCards = otherConnectPageFocusCards.slice(1);
  const connectQuickSettingGuideItems = [
    {
      id: "current",
      label: "먼저",
      title: singleSettingMode
        ? `${singleSettingDisplayLabel || activeSingleSettingDefinition?.label || "선택한 설정"}만`
        : hasConnectionPlan
          ? "추천 연결만"
          : "업무 한 줄",
      detail: singleSettingMode
        ? "다른 연결 목록은 접고 이 설정 안에서만 진행합니다."
        : hasConnectionPlan
          ? "업무에 필요한 후보만 먼저 펼칩니다."
          : "하고 싶은 일을 적으면 필요한 연결만 골라줍니다.",
    },
    {
      id: "safe",
      label: "보안",
      title: "보관함에서만",
      detail: "비밀번호, 토큰, 앱 위치는 채팅 본문에 남기지 않습니다.",
    },
    {
      id: "return",
      label: "복귀",
      title: singleSettingMode ? "저장 후 복귀" : "같은 업무 점검",
      detail: singleSettingMode
        ? "설정이 끝나면 원래 대화나 오피스 승인함으로 돌아옵니다."
        : "연결 뒤 홈에서 같은 업무를 다시 확인합니다.",
    },
  ];
  const showConnectionAdvancedDetails =
    !singleSettingMode &&
    (handoffSource === "mailops-session" ||
      vaultOpen ||
      computerUseHandoffOpen ||
      isReauthorizationHandoff ||
      recommended.length > 1 ||
      activeConnectPageView === "recovery");
  const showConnectRouteHandoff =
    handoffSource === "mailops-session" || (!singleSettingMode && (vaultOpen || computerUseHandoffOpen));
  const forceOpenConnectionAdvancedDetails = vaultOpen || computerUseHandoffOpen || isReauthorizationHandoff;
  const openConnectionAdvancedDetails = forceOpenConnectionAdvancedDetails || connectionAdvancedDetailsOpen;
  const reauthorizationPlanItems = useMemo(
    () =>
      recommended.map((connector) => {
        const statusRecord = connectorStatusMap.get(connector.id);
        return {
          connector,
          recovery: recoveryHintForConnector(statusRecord, !bridge?.isAvailable),
          ready: isConnectorReady(statusRecord),
          requirements: buildReauthorizationRequirements(connector, statusRecord),
        };
      }),
    [bridge?.isAvailable, connectorStatusMap, recommended],
  );

  const focusInlineGuideForConnector = (connectorId: string, reason?: string) => {
    const connector = connectors.find((item) => item.id === connectorId);
    setSelectedId(connectorId);
    setSingleSettingMode(true);
    setGuideFocusMessage(reason ?? `${connector?.label ?? "선택한 연결"} 연결 가이드를 열었습니다.`);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        inlineGuideRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        inlineGuideRef.current?.focus({ preventScroll: true });
      });
    });
  };

  const selectConnectPageView = (nextView: ConnectPageView) => {
    setConnectPageView(nextView);
    if (nextView === "vault") {
      setVaultOpen(true);
      setComputerUseHandoffOpen(false);
    }
    if (nextView === "recovery") {
      setComputerUseHandoffOpen(true);
    }
    if (nextView === "focus") {
      setVaultOpen(false);
      setComputerUseHandoffOpen(false);
      setConnectionAdvancedDetailsOpen(false);
    }
    setGuideFocusMessage(`${connectPageViewLabel(nextView)} 보기로 정리했습니다.`);
  };

  const resetConnectPageLayout = () => {
    setConnectPageView("focus");
    setVaultOpen(false);
    setComputerUseHandoffOpen(false);
    setConnectionAdvancedDetailsOpen(false);
    setGuideFocusMessage("바로 연결 보기로 돌아왔습니다.");
  };

  const handleConnect = async (id: string, payload: ConnectorConnectPayload) => {
    if (!bridge) {
      return {
        status: "desktop_bridge_loading",
        userMessage: "데스크톱 연결 상태를 확인하는 중입니다. 잠시 후 다시 눌러 주세요.",
      };
    }
    const result = await bridge.connectConnector(id, payload);
    if (isSuccessfulConnectorStatus(result.status)) {
      const connector = connectors.find((item) => item.id === id);
      if (result.status === "site_login_stored") {
        setLastConnectedId(null);
        const returnHref = makeHomeReturnHref(isCurrentWorkbenchPreview(), returnRuleId, false, handoffSource, goalText, undefined, setupReturnWork);
        setHomeReturnHref(returnHref);
        setHomeRecheckHref(returnHref);
        setHandoffMessage("사이트 계정 정보를 저장했습니다. 실제 연결과 업무 사용 가능 여부는 별도로 확인해 주세요.");
      } else {
        setLastConnectedId(id);
        setHomeReturnHref(makeHomeReturnHref(isCurrentWorkbenchPreview(), returnRuleId, true, handoffSource, goalText, id, setupReturnWork));
        setHomeRecheckHref(makeHomeReturnHref(isCurrentWorkbenchPreview(), returnRuleId, true, handoffSource, goalText, id, setupReturnWork));
        setHandoffMessage(
          handoffSource === "mailops-session"
            ? `${connector?.label ?? "연결"} 상태를 확인했습니다. 메일 업무실에서 이어가세요.`
            : `${connector?.label ?? "연결"} 상태를 확인했습니다. 홈 업무에서 이어가세요.`,
        );
      }
      try {
        const refreshed = await bridge.listConnectorStatuses();
        setConnectorStatuses(refreshed.connectors ?? []);
        const memory = await bridge.getLocalMemoryStatus();
        setLocalMemoryStatus(memory);
      } catch {
        setConnectorStatuses((current) => upsertConnectorStatus(current, id, payload.method, result.status));
      }
    }
    return result;
  };

  const handleRelayPull = async () => {
    if (!bridge) return;
    setRelayBusy(true);
    try {
      await bridge.pullPublicTriggerRelay();
      setRelayStatus(await bridge.getPublicTriggerRelayStatus());
    } finally {
      setRelayBusy(false);
    }
  };

  const handleCreateAutomationDraft = () => {
    const draft = saveLocalAutomationDraft({
      title: automationDraft.title,
      goal: goalText || automationDraft.title,
      trigger: automationDraft.trigger,
      output: automationDraft.output,
      approval: automationDraft.approval,
      connectorIds: recommended.map((connector) => connector.id),
      connectorLabels: recommended.map((connector) => connector.label),
    });
    const rule = createLocalAutomationRuleFromDraft(draft);
    setCreatedDraft(draft);
    setReturnRuleId(rule.id);
    setHomeReturnHref(makeHomeReturnHref(isCurrentWorkbenchPreview(), rule.id, false));
    setCreatedDraftHref(makeDraftHomeHref(draft.id, rule.id));
  };

  if (guideConnector) {
    return <FocusedConnection
      key={`${guideConnector.id}:${preferredMode}`}
      connector={guideConnector}
      preferredMode={preferredMode}
      returnHref={sendPermissionUpgradeMode ? (sendPermissionResumeContext.returnTo || "/office") : homeRecheckHref}
      onConnect={handleConnect}
      onSwitchConnector={setSelectedId}
    />;
  }

  return (
    <>
      <section className={styles.connectHero} aria-label="연결 시작">
        <div>
          <span className={styles.eyebrow}>연결</span>
          <h1>{singleSettingMode ? singleSettingDisplayTitle : !showConnectionWorkspaceChrome ? "무엇을 도와드릴까요?" : "필요한 연결만 하나씩 추가합니다"}</h1>
          <p>
            {singleSettingMode
              ? "다른 연결 목록은 접어두고 지금 선택한 설정만 처리합니다."
              : !showConnectionWorkspaceChrome ? "원하는 일을 한 줄로 적어주세요." : "업무를 적으면 지금 필요한 도구만 추천하고, 나머지는 접어둡니다."}
          </p>
        </div>
        {singleSettingMode ? (
          <div className={styles.singleSettingSummary} role="status">
            <span>필요 설정</span>
            <strong>{singleSettingDisplayLabel || "선택한 연결"}만 열림</strong>
            <button type="button" onClick={() => setSingleSettingMode(false)}>
              다른 연결 보기
            </button>
          </div>
        ) : (
          <>
        <label className={styles.goalInput}>
          <span>{!showConnectionWorkspaceChrome ? "업무 요청" : "자동화할 일"}</span>
          <input
            id="connect-goal"
            name="connectGoal"
            value={goalText}
            onChange={(event) => setGoalText(event.target.value)}
            placeholder="예: 문의 메일이 오면 답장 초안을 만들어줘"
          />
          {handoffMessage ? <small className={styles.handoffNotice}>{handoffMessage}</small> : null}
        </label>
        {!showConnectionOptions ? (
          <button
            type="button"
            className={styles.bareConnectOptions}
            onClick={() => {
              setBareConnectOptionsOpen(true);
              setFullCatalogOpen(true);
            }}
          >
            다른 연결 보기
          </button>
        ) : null}
          </>
        )}
        {showConnectionSupportChrome ? (
          <>
        <ol
          className={styles.connectSetupLane}
          aria-label="연결 진행 순서"
          data-connect-setup-lane="three_step_numbers_titles_only"
          data-connect-setup-lane-visible="numbers_titles_no_descriptions"
        >
          <li data-state={goalText.trim() ? "done" : "active"}>
            <span>1</span>
            <strong>{singleSettingMode ? "설정 선택" : "업무 적기"}</strong>
            <small>{singleSettingMode ? "누른 설정만 전용으로 엽니다." : "어떤 일을 자동화할지만 먼저 입력합니다."}</small>
          </li>
          <li data-state={hasConnectionPlan ? "active" : "next"}>
            <span>2</span>
            <strong>{singleSettingMode ? "전용 설정칸" : "필요 연결만 보기"}</strong>
            <small>{singleSettingMode ? "다른 탭과 목록은 숨김" : hasConnectionPlan ? `${recommended.length}개 후보만 펼쳐짐` : "전체 목록은 아래에 접어둡니다."}</small>
          </li>
          <li data-state={readyRecommended.length > 0 ? "done" : "next"}>
            <span>3</span>
            <strong>{singleSettingMode ? "저장 후 복귀" : "따라하고 점검"}</strong>
            <small>{singleSettingMode ? "설정 완료 후 원래 업무로 돌아갑니다." : "연결 후 홈에서 같은 업무 점검을 이어갑니다."}</small>
          </li>
        </ol>
        <details
          className={styles.connectSetupDetailsFold}
          aria-label="연결 진행 상세"
          data-connect-setup-details="step_descriptions_on_demand"
          data-connect-setup-details-default="closed"
          data-connect-setup-details-body="hidden_until_user_opens"
        >
          <summary>
            <span>진행 상세</span>
            <strong>3단계 설명은 필요할 때만</strong>
          </summary>
          <ol>
            <li>
              <span>1</span>
              <strong>{singleSettingMode ? "설정 선택" : "업무 적기"}</strong>
              <small>{singleSettingMode ? "누른 설정만 전용으로 엽니다." : "어떤 일을 자동화할지만 먼저 입력합니다."}</small>
            </li>
            <li>
              <span>2</span>
              <strong>{singleSettingMode ? "전용 설정칸" : "필요 연결만 보기"}</strong>
              <small>{singleSettingMode ? "다른 탭과 목록은 숨김" : hasConnectionPlan ? `${recommended.length}개 후보만 펼쳐짐` : "전체 목록은 아래에 접어둡니다."}</small>
            </li>
            <li>
              <span>3</span>
              <strong>{singleSettingMode ? "저장 후 복귀" : "따라하고 점검"}</strong>
              <small>{singleSettingMode ? "설정 완료 후 원래 업무로 돌아갑니다." : "연결 후 홈에서 같은 업무 점검을 이어갑니다."}</small>
            </li>
          </ol>
        </details>
          </>
        ) : null}
        {showConnectStartDetails ? (
          <section
          className={styles.connectFirstScreenDesk}
          aria-label="연결 첫 화면 업무 책상"
          data-connect-first-screen-desk="task_needed_connection_readonly_approval"
          data-connect-first-screen-visible="task_needed_connection_readonly_check_approval_return"
          data-connect-first-screen-hidden="provider_settings_vault_diagnostics_full_catalog_until_details"
          data-connect-first-screen-order="task_needed_connection_readonly_approval_then_details"
          data-connect-first-screen-source="goal_handoff_connector_readiness"
          data-connect-first-screen-final-boundary="approval_before_external_mutation"
          data-connect-first-screen-external-mutation="false"
        >
          <header>
            <div>
              <span data-step="task">업무 선택</span>
              <strong data-step="needed_connection">{nextConnector ? `${nextConnector.label} 연결` : "연결 후보 대기"}</strong>
              <small>{goalText.trim() ? "현재 업무 연결 확인" : "연결할 업무부터 선택"}</small>
            </div>
            <div role="group" aria-label="연결 첫 화면 바로가기">
              <button type="button" onClick={() => document.getElementById("connect-goal")?.focus()}>
                업무 입력
              </button>
              <a href={homeReturnHref}>오피스 승인함</a>
            </div>
          </header>
          <div
            className={styles.connectFirstScreenStatus}
            role="status"
            aria-label="현재 연결 상태"
            data-connect-first-screen-status="connection_readonly_check_before_return"
          >
            <span data-step="readonly_check" data-state={readyRecommended.length ? "done" : "next"}>
              <strong>읽기 전용 점검</strong>
              <small>연결 전 실제 메일은 읽지 않음</small>
            </span>
            <span data-step="approval" data-state="locked">
              <strong>승인함 복귀</strong>
              <small>발송·등록은 최종 승인 전 잠금</small>
            </span>
          </div>
          </section>
        ) : showConnectionSupportChrome ? (
          <a className={styles.connectApprovalShortcut} href={homeReturnHref}>
            오피스 승인함
          </a>
        ) : null}
      </section>

      {showConnectionWorkspaceChrome && !singleSettingMode ? (
        <nav
          className={styles.connectPageViewTabs}
          aria-label="연결 화면 보기 방식"
          data-connect-page-organization="focus_vault_recovery"
          data-connect-page-tab-format="summary_setup_records_fixed"
          data-connect-page-tab-visible="base_label_only_detail_in_folder_map"
          data-connect-page-tab-detail-default="hidden"
          data-connect-page-user-config="preferred_view_per_page"
          data-connect-page-view={activeConnectPageView}
        >
          {getConnectPageViewTabs(vaultOpen, connectorRecoveryMemoryMap.size).map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-label={`연결 화면 ${connectPageViewBaseLabel(tab.id)} 보기 · ${tab.label}`}
              aria-selected={activeConnectPageView === tab.id}
              data-connect-page-tab={tab.id}
              data-connect-page-tab-role={connectPageViewBaseLabel(tab.id)}
              data-active={activeConnectPageView === tab.id ? "true" : "false"}
              onClick={() => selectConnectPageView(tab.id)}
            >
              <span>{connectPageViewBaseLabel(tab.id)}</span>
              <small>
                <b>{tab.label}</b>
                {" · "}
                {tab.detail}
              </small>
            </button>
          ))}
        </nav>
      ) : null}

      {showConnectionWorkspaceChrome && !singleSettingMode ? (
        <details
          className={styles.connectLayoutFolder}
          aria-label="연결 페이지 폴더 구성"
          data-connect-folder-map="focus_vault_recovery_slots"
          data-connect-folder-map-visible="summary_first_folder_slots_on_demand"
          data-connect-folder-map-default="closed"
          data-connect-folder-map-body="hidden_until_user_opens"
        >
          <summary>
            <span>내 구성</span>
            <strong>{connectPageViewLabel(activeConnectPageView)} 보기로 시작</strong>
            <small>탭 포맷은 유지하고 시작 화면만 바꾸기</small>
          </summary>
          <aside
            className={styles.connectLayoutGuide}
            data-connect-page-customization="preferred_view_reset"
            data-page-layout-format="fixed_tabs_user_start_view"
            data-connect-page-view={activeConnectPageView}
            data-custom-layout={connectPageCustomized ? "true" : "false"}
            data-preferred-view-state={connectPageCustomized ? "custom" : "default"}
            aria-label="연결 페이지 내 구성"
          >
            <div>
              <span>내 시작 화면</span>
              <strong>{connectPageViewLabel(activeConnectPageView)} 보기로 시작</strong>
              <small>{connectLayoutSummary} · 탭 포맷은 유지하고 시작 화면만 바꿉니다.</small>
            </div>
            <p data-connect-layout-helper="desktop_only_context">
              {connectPageCustomized ? "현재 보기가 저장됨" : "기본은 업무를 적고 필요한 연결만 여는 방식"}
            </p>
            <button type="button" onClick={resetConnectPageLayout}>
              기본 보기
            </button>
          </aside>
        </details>
      ) : null}

      {!singleSettingMode ? (
        <section
          className={styles.connectFocusSummary}
          aria-label="연결 화면 보기별 한눈에 보기"
          data-connect-page-focus-summary="active_view_first_then_other_views_on_demand"
          data-connect-page-view={activeConnectPageView}
          data-active-view-count={activeConnectPageFocusCard.countLabel}
          data-other-view-disclosure="all_other_views_inside_details"
          data-other-view-visible-count={visibleOtherConnectPageFocusCards.length}
          data-other-view-hidden-count={hiddenOtherConnectPageFocusCards.length}
        >
          <article data-state={activeConnectPageFocusCard.state}>
            <span>{activeConnectPageFocusCard.label}</span>
            <strong>{activeConnectPageFocusCard.title}</strong>
            <small>{activeConnectPageFocusCard.detail}</small>
            <button type="button" onClick={() => selectConnectPageView(activeConnectPageFocusCard.id)}>
              {activeConnectPageFocusCard.actionLabel}
            </button>
          </article>
          <details
            className={styles.connectOtherViewsFold}
            aria-label="연결 화면 다른 보기 접힘"
            data-connect-page-other-views-fold="all_other_views_on_demand"
            data-connect-page-other-views-default="closed"
            data-connect-page-other-views-body="hidden_until_user_opens"
          >
            <summary>
              <span>다른 보기</span>
              <strong>
                {visibleOtherConnectPageFocusCards.length + hiddenOtherConnectPageFocusCards.length}개
              </strong>
            </summary>
            <div className={styles.connectOtherViewRail} aria-label="연결 화면 다른 보기 요약">
              <ol
                className={styles.connectOtherViewList}
                aria-label="연결 화면 바로 갈 다른 보기"
                data-connect-page-other-view-list="one_next_view"
              >
                {visibleOtherConnectPageFocusCards.map((item) => (
                  <li key={item.id} data-state={item.state}>
                    <button type="button" onClick={() => selectConnectPageView(item.id)}>
                      <span>{item.label}</span>
                      <strong>{item.countLabel}</strong>
                      <small>{item.actionLabel}</small>
                    </button>
                  </li>
                ))}
              </ol>
              {hiddenOtherConnectPageFocusCards.length ? (
                <details
                  className={styles.connectFocusMore}
                  aria-label="연결 화면 나머지 보기"
                  data-connect-page-other-views-more="remaining_views_collapsed"
                  data-connect-page-other-views-more-default="closed"
                >
                  <summary>
                    <span>나머지 보기</span>
                    <strong>{hiddenOtherConnectPageFocusCards.length}개 접힘</strong>
                  </summary>
                  <ol>
                    {hiddenOtherConnectPageFocusCards.map((item) => (
                      <li key={item.id} data-state={item.state}>
                        <button type="button" onClick={() => selectConnectPageView(item.id)}>
                          <span>{item.label}</span>
                          <strong>{item.countLabel}</strong>
                          <small>{item.actionLabel}</small>
                        </button>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </div>
          </details>
        </section>
      ) : null}

      <section
        className={styles.connectQuickSettingGuide}
        aria-label="연결 설정 한 줄 정리"
        data-connect-quick-setting-guide="current_task_secret_return"
        data-connect-quick-setting-visible="three_cells_detail_folded"
        data-connect-page-view={activeConnectPageView}
        data-single={singleSettingMode ? "true" : "false"}
      >
        <ol aria-label="연결 설정 먼저 볼 것">
          {connectQuickSettingGuideItems.map((item) => (
            <li key={item.id}>
              <span>{item.label}</span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </li>
          ))}
        </ol>
        <details
          className={styles.connectQuickSettingDetails}
          aria-label="연결 설정 상세 기준"
          data-connect-quick-setting-details="mail_vault_recovery_on_demand"
          data-connect-quick-setting-details-default="closed"
        >
          <summary>
            <span>상세 기준</span>
            <strong>필요할 때만 보기</strong>
          </summary>
          <dl>
            <div>
              <dt>메일 설정</dt>
              <dd>메일 종류, 제외 기준, 확인 주기를 먼저 고르고 서버값은 나중에 엽니다.</dd>
            </div>
            <div>
              <dt>보관함</dt>
              <dd>계정값과 앱 위치는 보관함에서만 다룹니다.</dd>
            </div>
            <div>
              <dt>복구</dt>
              <dd>막힌 연결은 같은 포맷 안에서 대체 경로를 보여줍니다.</dd>
            </div>
          </dl>
        </details>
      </section>

      {showConnectionOptions ? (
        <section
          className={styles.recommendPanel}
          aria-label={singleSettingMode ? "필요 연결 설정" : "목표 기반 연결 추천"}
          data-single={singleSettingMode ? "true" : "false"}
          data-connect-page-view={activeConnectPageView}
        >
          {hasConnectionPlan ? (
            <div className={styles.workHandoffPanel} aria-label="지금 이 업무에 필요한 연결">
              <div className={styles.workHandoffHead}>
                <div>
                  <span className={styles.eyebrow}>업무 맞춤 연결</span>
                  <h2>
                    {handoffSource === "setup-work"
                      ? "첫 업무에 필요한 연결"
                      : singleSettingMode && nextConnector
                      ? `${nextConnector.label} 설정만 진행`
                      : isReauthorizationHandoff
                      ? "복원한 업무 도구 다시 승인"
                      : handoffSource === "work-check"
                      ? "점검 결과에서 부족한 연결"
                      : handoffSource === "rule-check"
                      ? "반복 업무에 부족한 연결"
                      : handoffSource === "mailops-session"
                      ? "메일 업무 세션에 필요한 연결"
                      : handoffSource === "setup"
                      ? "첫 설정에 필요한 AI 연결"
                      : "지금 이 업무에 필요한 연결"}
                  </h2>
                  <p>
                    {handoffSource === "setup-work"
                      ? "필요한 업무 연결만 실제 상태로 확인합니다."
                      : singleSettingMode && nextConnector
                      ? "선택한 설정만 확인합니다."
                      : isReauthorizationHandoff
                      ? "이전 PC에서 쓰던 업무 도구와 AI 팀원 설정은 복원됐습니다. 접속 토큰, 로그인 동의, 비밀번호 원문은 가져오지 않으므로 이 PC에서 필요한 연결만 다시 확인합니다."
                      : handoffSource === "work-check"
                      ? "부족한 연결을 확인한 뒤 업무로 돌아갑니다."
                      : handoffSource === "rule-check"
                        ? "부족한 연결을 확인한 뒤 업무로 돌아갑니다."
                      : handoffSource === "mailops-session"
                        ? "필요한 연결만 확인한 뒤 메일 업무실로 돌아갑니다."
                      : handoffSource === "setup"
                        ? "AI 연결을 확인한 뒤 첫 설정으로 돌아갑니다."
                      : homeReadinessHandoff
                        ? "실제 상태만 확인하고, 외부 실행은 승인 전까지 잠급니다."
                      : goalText.trim()
                      ? goalText
                      : "필요한 연결만 먼저 확인합니다."}
                  </p>
                </div>
                <a href={homeReturnHref} className={styles.backToWork}>
                  {handoffSource === "setup" || handoffSource === "setup-work" ? "첫 설정으로 돌아가기" : "홈 업무로 돌아가기"}
                </a>
              </div>

              {sendPermissionUpgradeMode ? (
                <section
                  className={styles.sendPermissionUpgradePanel}
                  aria-label="메일 발송 권한 추가 모드"
                  data-mail-send-permission-upgrade="gmail_outlook_smtp_send_scope"
                  data-send-mode="send"
                  data-send-provider={sendPermissionConnector?.id ?? ""}
                  data-required-scope={sendPermissionCopy.scopeValue}
                  data-return-after-setup="office_final_confirmation"
                  data-final-action-lock="required_before_external_mutation"
                  data-mail-send-permission-boundary="read_scope_kept_send_scope_only_final_confirmation_resume"
                >
                  <header>
                    <span>발송 권한</span>
                    <strong>{sendPermissionCopy.actionLabel}</strong>
                    <small>읽기 연결은 유지하고, 최종 발송에 필요한 권한만 추가합니다.</small>
                  </header>
                  <ol
                    className={styles.sendPermissionStepRail}
                    aria-label="메일 발송 권한 추가 3단계"
                    data-mail-send-permission-steps="read_keep_send_scope_resume"
                  >
                    <li data-state="kept">
                      <span>1</span>
                      <strong>읽기 유지</strong>
                      <small>받은 메일 확인 권한은 그대로 둡니다</small>
                    </li>
                    <li data-state="active">
                      <span>2</span>
                      <strong>발송 권한만 추가</strong>
                      <small>{sendPermissionCopy.scopeLabel}</small>
                    </li>
                    <li data-state="locked">
                      <span>3</span>
                      <strong>같은 승인 항목 복귀</strong>
                      <small>마지막 확인 전에는 발송하지 않습니다</small>
                    </li>
                  </ol>
                  {hasFinalConfirmationResume ? (
                    <div
                      className={styles.sendResumePanel}
                      aria-label="메일 발송 권한 복구 후 이어가기"
                      data-mail-send-resume-context="provider_dispatch_recovery_to_final_confirmation"
                      data-mail-send-resume-work-item={sendPermissionResumeContext.workItemId}
                      data-mail-send-resume-return-to={sendPermissionResumeReturnHref}
                      data-mail-send-resume-source={sendPermissionResumeContext.source}
                      data-mail-send-resume-mode={preferredMode}
                      data-mail-send-resume-proof="send_scope_upgrade_returns_to_same_final_confirmation_item"
                    >
                      <div>
                        <span>이어가기</span>
                        <strong>권한 추가 후 같은 승인 메일로 돌아갑니다</strong>
                      </div>
                      <a href={sendPermissionResumeReturnHref} data-mail-send-resume-return-link="office_final_confirmation">
                        승인 항목으로 돌아가기
                      </a>
                      <details>
                        <summary>복구 경로 상세</summary>
                        <p>
                          {sendPermissionResumeContext.workItemId
                            ? `승인 항목 ${sendPermissionResumeContext.workItemId}의 dry-run과 마지막 확인을 이어갑니다.`
                            : "오피스 승인함의 마지막 확인 흐름으로 돌아갑니다."}
                        </p>
                      </details>
                    </div>
                  ) : null}
                  <details>
                    <summary>
                      <span>전송 준비 상세</span>
                      <strong>{sendPermissionCopy.providerLabel} · {sendPermissionCopy.scopeLabel}</strong>
                      <small>권한 추가 후 이 승인 메일로 돌아와 dry-run부터 이어가기</small>
                    </summary>
                    <div>
                      <article>
                        <span>필요 권한</span>
                        <strong>{sendPermissionCopy.scopeValue}</strong>
                        <small>{sendPermissionCopy.scopeDetail}</small>
                      </article>
                      <article>
                        <span>실행 잠금</span>
                        <strong>오피스 마지막 확인 전까지 발송 안 함</strong>
                        <small>외부 발송은 오피스 마지막 확인 전까지 실행하지 않습니다.</small>
                      </article>
                    </div>
                  </details>
                  <a href={homeRecheckHref}>오피스로 돌아가 마지막 확인</a>
                </section>
              ) : null}

              {singleSettingMode && activeSingleSettingDefinition && !showSingleSettingOnlyCard ? (
                <>
                  <section className={styles.singleSettingScopePanel} aria-label={`${activeSingleSettingDefinition.label} 전용 설정 범위`}>
                    <header>
                      <div>
                        <span>전용 범위</span>
                        <strong>이 설정 안에서만 필요한 값을 정리합니다</strong>
                      </div>
                      <small>다른 설정 섞지 않음</small>
                    </header>
                    <div>
                      {activeSingleSettingPlan.map((item) => (
                        <article key={item.id} data-state={item.state}>
                          <span>{item.label}</span>
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </article>
                      ))}
                    </div>
                  </section>
                  {mailAutomationNotificationHandoff && activeSingleSettingDefinition.canonicalId === "messenger-channel" ? (
                    <section
                      className={styles.mailAutomationNotificationHandoff}
                      aria-label="메일 자동 점검 알림 연결 안내"
                      data-mail-automation-notification-handoff="draft_to_messenger_channel_setup"
                      data-notification-draft-contract="mail_polling_to_app_approval_notification_draft"
                      data-dispatch-policy="app_inbox_first_external_push_requires_user_channel_setup"
                      data-final-action-lock="mail_send_calendar_attachment_locked_until_app_final_confirmation"
                    >
                      <header>
                        <div>
                          <span>메일 자동 점검 알림</span>
                          <strong>앱 승인함 초안을 외부 알림 채널로 이어갑니다</strong>
                        </div>
                        <small>발송 아님</small>
                      </header>
                      <ol>
                        <li data-state="ready">
                          <span>1</span>
                          <strong>앱 승인함 기본</strong>
                          <small>자동 점검 결과는 먼저 앱 승인함 알림 초안으로만 남깁니다.</small>
                        </li>
                        <li data-state="active">
                          <span>2</span>
                          <strong>채널 연결</strong>
                          <small>Telegram, Slack 같은 외부 알림은 사용자가 채널을 연결한 뒤에만 후보가 됩니다.</small>
                        </li>
                        <li data-state="approval">
                          <span>3</span>
                          <strong>실행 잠금 유지</strong>
                          <small>메일 발송, 일정 등록, 첨부 이동은 앱 마지막 확인 전까지 실행하지 않습니다.</small>
                        </li>
                      </ol>
                      <a
                        href={homeRecheckHref}
                        data-mail-automation-notification-return="office_approval_queue"
                        data-return-after-setup="office_approval_queue"
                      >
                        오피스 승인함으로 돌아가기
                      </a>
                    </section>
                  ) : null}
                  {homeReadinessHandoff ? <HomeReadinessHandoffPanel /> : null}
                  {isMailSetupSingleSetting(activeSingleSettingDefinition.canonicalId) ? (
                    <section
                      className={styles.mailSetupTemplatePanel}
                      aria-label="쉬운 메일 설정 템플릿"
                      data-mail-setup-contract="provider_choice_read_first_calendar_optional_vault_safe"
                    >
                      <header>
                        <div>
                          <span>쉬운 메일 설정</span>
                          <strong>Gmail도, 회사/일반 메일도 같은 1순위로 연결합니다</strong>
                        </div>
                        <small>메일 종류, 제외 기준, 확인 주기를 먼저 고르고 서버값은 필요할 때만 보여줍니다.</small>
                      </header>
                      <ol>
                        {buildEasyMailSetupRows().map((row) => (
                          <li key={row.id} data-state={row.state}>
                            <span>{row.label}</span>
                            <div>
                              <strong>{row.title}</strong>
                              <small>{row.detail}</small>
                            </div>
                            <a href={row.href}>{row.actionLabel}</a>
                          </li>
                        ))}
                      </ol>
                      <section
                        className={styles.mailSetupPollingRail}
                        aria-label="메일 5분 자동 점검 알림 흐름"
                        data-mail-setup-polling-rail="five_minute_app_inbox_first_optional_external_notice"
                        data-mail-setup-polling-cadence="5m"
                        data-mail-setup-polling-default-route="app_inbox"
                        data-mail-setup-polling-external-notice="user_selected_only"
                        data-mail-setup-polling-final-lock="send_calendar_attachment_locked_until_app_final_confirmation"
                      >
                        {buildMailAutomationPollingRows().map((row) => (
                          <article key={row.id} data-state={row.state}>
                            <span>{row.badge}</span>
                            <div>
                              <strong>{row.title}</strong>
                              <small>{row.detail}</small>
                            </div>
                          </article>
                        ))}
                      </section>
                      <details
                        className={styles.mailSetupRuleFold}
                        aria-label="메일 자동 정리 기본 규칙 접힘"
                        data-mail-setup-rule-fold="default_rules_on_demand"
                        data-mail-setup-rule-default="closed"
                      >
                        <summary>
                          <span>정리 기준</span>
                          <strong>중요/제외 규칙은 필요할 때만</strong>
                          <small>기본값은 유지하고 바꾸고 싶을 때 엽니다.</small>
                        </summary>
                        <div className={styles.mailSetupRuleGrid} aria-label="메일 자동 정리 기본 규칙">
                          {buildEasyMailRuleRows().map((rule) => (
                            <article key={rule.id} data-tone={rule.tone}>
                              <span>{rule.badge}</span>
                              <strong>{rule.title}</strong>
                              <small>{rule.detail}</small>
                            </article>
                          ))}
                        </div>
                      </details>
                    </section>
                  ) : null}
                  {showReleaseLiveSmokeGuide ? <ReleaseLiveSmokeGuide /> : null}
                  {showAIConnectionChoices ? (
                    <details className={styles.aiConnectionChoices}>
                      <summary>
                        <span>다른 방식 선택</span>
                        <small>필요한 사람만 연결 방식을 바꿉니다.</small>
                      </summary>
                      <div className={styles.aiConnectionChoiceList} role="list" aria-label="AI 답변 방식 선택">
                        {buildAIConnectionChoices().map((choice) => (
                          <article key={choice.id} role="listitem" data-active={aiConnectionChoice === choice.id ? "true" : "false"}>
                            <div>
                              <span>{choice.badge}</span>
                              <strong>{choice.title}</strong>
                              <small>{choice.detail}</small>
                            </div>
                            {"href" in choice ? (
                              <a
                                href={choice.href}
                                onClick={() => {
                                  setAIConnectionChoice(choice.id);
                                  setAIConnectionChoiceMessage(choice.message ?? "");
                                }}
                              >
                                {choice.actionLabel}
                              </a>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void startAIConnectionChoiceLogin(choice.id)}
                              >
                                {choice.actionLabel}
                              </button>
                            )}
                          </article>
                        ))}
                      </div>
                      {aiConnectionChoiceMessage ? <p role="status">{aiConnectionChoiceMessage}</p> : null}
                    </details>
                  ) : null}
                  <SettingQualityGateRail items={settingQualityGateItems} />
                </>
              ) : null}

              {handoffSource === "mailops-session" ? (
                <details className={styles.compactSafetyDetails}>
                  <summary>메일 실행 안전 기준</summary>
                  <div className={styles.mailOpsHandoffSafety} aria-label="메일 업무 세션 안전 경계">
                  <div>
                    <span>읽기 우선</span>
                    <strong>메일함 분석부터</strong>
                    <small>연결 직후에는 최신 메일을 read-only로 읽고 업무 후보만 만듭니다.</small>
                  </div>
                  <div>
                    <span>승인 대기</span>
                    <strong>답장/일정 후보</strong>
                    <small>답장 초안, 일정 후보, 확인 질문은 오피스 승인함으로 보냅니다.</small>
                  </div>
                  <div>
                    <span>실행 잠금</span>
                    <strong>마지막 확인 후 발송</strong>
                    <small>메일 원문 발송과 캘린더 등록은 사용자가 마지막으로 확인하기 전에는 실행하지 않습니다.</small>
                  </div>
                  </div>
                </details>
              ) : null}

              {showConnectRouteHandoff ? (
                <section
                  className={styles.connectRecoveryPrimaryPath}
                  aria-label="연결 막힘 지금 누를 것"
                  data-connection-recovery-path="primary_connect_then_vault_or_computer_use_then_return"
                  data-first-button="연결창"
                  data-vault-button="보관함 열기"
                  data-computer-use-button="읽기 후보"
                  data-return-button="홈에서 점검 이어가기"
                  data-secret-policy="no_secret_in_chat"
                  data-final-action-lock="required_before_external_mutation"
                  data-mobile-safe-width="390"
                >
                  <span>지금 누를 것</span>
                  <strong>{nextConnector ? "연결창" : computerUseHandoffOpen ? "읽기 후보" : vaultOpen ? "보관함 열기" : "연결창"}</strong>
                  <small>공식 연결을 먼저 확인하고, 막히면 보관함 또는 내 PC 읽기 후보로 넘깁니다. 실제 발송·등록·클릭은 오피스 승인함 전까지 잠깁니다.</small>
                </section>
              ) : null}

              {showConnectionAdvancedDetails ? (
                <details
                  className={styles.connectionAdvancedDetails}
                  aria-label="연결 세부 정보 접힘"
                  open={openConnectionAdvancedDetails}
                  onToggle={(event) => setConnectionAdvancedDetailsOpen(event.currentTarget.open)}
                  data-connection-advanced-fold="summary_first_recovery_candidates_on_demand"
                  data-connection-advanced-open={openConnectionAdvancedDetails ? "true" : "false"}
                  data-connection-candidate-count={recommended.length}
                  data-connection-candidate-hidden-count={hiddenConnectionCount}
                  data-connect-page-view={activeConnectPageView}
                >
                  <summary>
                    <span>연결 세부 정보 보기</span>
                    <strong>계정 연결, 보관함, 다른 방법은 필요할 때만 펼칩니다</strong>
                    <small>
                      {recommended.length > 1
                        ? `${recommended.length}개 후보 중 다음 연결만 먼저 보여줌`
                        : "막힌 연결의 다음 방법만 보관"}
                    </small>
                  </summary>
                  <div className={styles.connectionAdvancedBody}>
                    {showConnectRouteHandoff ? (
                      <section
                        className={styles.connectRouteHandoff}
                        aria-label="연결 다음 방법"
                        data-connect-route-handoff="primary_decision_first_support_steps_folded"
                        data-connect-route-primary-visible="next_action_secret_boundary_approval_return"
                        data-connect-route-support-default="closed"
                        data-connect-route-final-boundary="approval_before_external_mutation"
                      >
                        <header>
                          <div>
                            <span>바로 이어가기</span>
                            <strong>{routeFocusLabel || "필요한 연결과 다른 방법을 이 화면에서 처리합니다"}</strong>
                          </div>
                          <small>비밀번호와 보안 정보 원문은 채팅에 남기지 않습니다</small>
                        </header>
                        <section
                          className={styles.connectRouteDecisionRail}
                          aria-label="연결 복구 지금 결정"
                          data-connect-route-decision-rail="official_vault_computer_use_next_action_first"
                          data-connect-route-external-mutation="false"
                          data-connect-route-secret-policy="no_secret_in_chat"
                        >
                          <article data-step="next_action">
                            <span>지금</span>
                            <strong>{nextConnector ? "연결창" : computerUseHandoffOpen ? "읽기 후보" : vaultOpen ? "보관함 열기" : "연결창"}</strong>
                            <small>가장 가까운 다음 행동만 먼저 누릅니다.</small>
                          </article>
                          <article data-step="secret_boundary">
                            <span>보안</span>
                            <strong>보안 정보는 보관함에서만</strong>
                            <small>비밀번호, 토큰, 앱 위치는 채팅에 남기지 않습니다.</small>
                          </article>
                          <article data-step="approval_return">
                            <span>복귀</span>
                            <strong>승인함에서 마지막 확인</strong>
                            <small>발송, 등록, 클릭, 파일 변경은 마지막 확인 전까지 잠깁니다.</small>
                          </article>
                        </section>
                        <details
                          className={styles.connectRouteSupportFold}
                          aria-label="연결 복구 경로 더 보기"
                          data-connect-route-support-fold="official_vault_computer_use_steps_on_demand"
                          data-connect-route-support-default="closed"
                          data-connect-route-support-body="hidden_until_user_opens"
                        >
                          <summary>
                            <span>상세 경로</span>
                            <strong>공식 연결 · 보관함 · 내 PC 읽기</strong>
                            <small>필요할 때만 3단계를 펼칩니다</small>
                          </summary>
                          <ol>
                            <li data-state={nextConnector ? "active" : "todo"}>
                              <span>1</span>
                              <div>
                                <strong>공식 연결 먼저</strong>
                                <small>공식 로그인, 메일함 연결, 메신저 봇 연결이 있으면 먼저 점검합니다.</small>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  nextConnector &&
                                  focusInlineGuideForConnector(
                                    nextConnector.id,
                                    `${nextConnector.label} 연결 가이드를 열었습니다.`,
                                  )
                                }
                                disabled={!nextConnector}
                              >
                                연결창
                              </button>
                            </li>
                            <li data-state={vaultOpen ? "active" : "todo"}>
                              <span>2</span>
                              <div>
                                <strong>막히면 계정 보관함</strong>
                                <small>사이트 링크, 아이디, 비밀번호, 앱 위치는 보안 입력칸에만 저장합니다.</small>
                              </div>
                              <button type="button" onClick={() => setVaultOpen(true)}>
                                보관함 열기
                              </button>
                            </li>
                            <li data-state={computerUseHandoffOpen ? "active" : "todo"}>
                              <span>3</span>
                              <div>
                                <strong>내 PC 작업 도우미 읽기</strong>
                                <small>공식 연결이 안 되는 사이트는 화면 확인과 후보 정리부터 시작하고 실행은 승인 뒤로 둡니다.</small>
                              </div>
                              <button type="button" onClick={() => setComputerUseHandoffOpen(true)}>
                                읽기 후보
                              </button>
                            </li>
                          </ol>
                        </details>
                      </section>
                    ) : null}

                    {vaultOpen ? (
                      <section className={styles.connectVaultDock} aria-label="외부 계정 보관함 바로 입력">
                        <header>
                          <div>
                            <span>보안 입력</span>
                            <strong>외부 계정 정보는 여기에서 등록합니다</strong>
                          </div>
                          <button type="button" onClick={() => setVaultOpen(false)}>
                            접기
                          </button>
                        </header>
                        <ExternalAccountVaultCard />
                      </section>
                    ) : null}

                    {computerUseHandoffOpen ? (
                      <section className={styles.computerUseRouteCard} aria-label="내 PC 작업 도우미 읽기 후보">
                        <div>
                          <span>내 PC 작업 도우미</span>
                          <strong>공식 연결이 안 되는 사이트는 읽기 모드부터 준비합니다</strong>
                          <p>
                            로그인된 사이트 화면을 읽어 후보를 정리하고, 클릭·입력·발송·등록은 업무 오피스 승인 카드에서 다시 확인합니다.
                          </p>
                        </div>
                        <a href="/?computerUse=1&source=connect-recovery">홈에서 내 PC 작업 도우미 확인</a>
                      </section>
                    ) : null}

                    {isReauthorizationHandoff ? (
                      <div className={styles.restoreReauthPanel} aria-label="복원 후 다시 확인할 연결">
                        <div className={styles.restoreReauthHeader}>
                          <div>
                            <span className={styles.eyebrow}>복원 후 연결 확인</span>
                            <strong>업무 도구는 이어받고, 민감한 연결만 이 PC에서 다시 확인합니다</strong>
                            <p>
                              보관함에는 사이트 링크와 계정 설명만 저장하고, 실제 비밀번호와 보안 정보 원문은 화면에 다시 보여주지 않습니다.
                            </p>
                          </div>
                          <a href="/account#external-accounts">계정 보관함 열기</a>
                        </div>
                        <div className={styles.restoreReauthList}>
                          {reauthorizationPlanItems.map(({ connector, recovery, ready, requirements }) => (
                            <article key={`restore-reauth-${connector.id}`} data-ready={ready}>
                              <div>
                                <span aria-hidden="true">{connector.iconText}</span>
                                <strong>{connector.label}</strong>
                                <small>{ready ? "실제 연결 확인 완료" : recovery.shortLabel}</small>
                              </div>
                              <p>{recovery.detail}</p>
                              {connectorRecoveryMemoryMap.get(connector.id) ? (
                                <ConnectorRecoveryMemoryNote
                                  memory={connectorRecoveryMemoryMap.get(connector.id)!}
                                  compact
                                />
                              ) : null}
                              <div className={styles.restoreRequirementChips} aria-label={`${connector.label} 재승인 준비값`}>
                                {requirements.slice(0, 5).map((item) => (
                                  <span key={`${connector.id}-${item}`}>{item}</span>
                                ))}
                              </div>
                              <div className={styles.restoreReauthActions}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    focusInlineGuideForConnector(
                                      connector.id,
                                      `${connector.label} 재승인 가이드를 열었습니다.`,
                                    )
                                  }
                                >
                                  이 연결 확인
                                </button>
                                {recovery.needsVault || connector.method === "site_login" ? (
                                  <a href="/account#external-accounts">보관함</a>
                                ) : null}
                                {recovery.needsComputerUse || connector.method === "site_login" ? (
                                  <a href="/?computerUse=1">읽기 후보</a>
                                ) : null}
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {!singleSettingMode ? (
                      <section
                        className={styles.compactConnectionFlow}
                        aria-label="추천 연결 순서"
                        data-connection-candidate-fold="first_one_then_more_inside_details"
                        data-connection-visible-count={visibleConnectionFlow.length}
                        data-connection-hidden-count={hiddenConnectionCount}
                        data-connection-visible-limit="1"
                      >
                        <header>
                          <div>
                            <span>필요 연결</span>
                            <strong>{recommended.length ? `${recommended.length}개 중 다음 연결만 먼저` : "추천 연결 없음"}</strong>
                          </div>
                          {hiddenConnectionCount > 0 ? <small>{hiddenConnectionCount}개는 아래에 접힘</small> : null}
                        </header>
                        <div className={styles.connectionFlow}>
                        {visibleConnectionFlow.map((connector, index) => {
                          const statusRecord = connectorStatusMap.get(connector.id);
                          const ready = isConnectorReady(statusRecord);
                          const active = nextConnector?.id === connector.id;
                          const recovery = recoveryHintForConnector(statusRecord, !bridge?.isAvailable);
                          return (
                            <button
                              key={connector.id}
                              type="button"
                              data-ready={ready}
                              data-active={active}
                              data-recovery={recovery.tone}
                              onClick={() =>
                                focusInlineGuideForConnector(
                                  connector.id,
                                  `${connector.label} 연결 가이드를 열었습니다.`,
                                )
                              }
                            >
                              <span>{index + 1}</span>
                              <strong>{connector.label}</strong>
                              <small>{recovery.shortLabel}</small>
                            </button>
                          );
                        })}
                        </div>
                        {hiddenConnectionFlow.length > 0 ? (
                          <details
                            className={styles.connectionMoreCandidates}
                            aria-label="추천 연결 나머지 후보"
                            data-connection-candidate-more="remaining_candidates_collapsed"
                            data-connection-candidate-more-default="closed"
                          >
                            <summary>
                              <span>나머지 연결</span>
                              <strong>{hiddenConnectionCount}개 접힘</strong>
                              <small>필요할 때만 열어 다음 후보를 고릅니다</small>
                            </summary>
                            <ol>
                              {hiddenConnectionFlow.map((connector, index) => {
                                const statusRecord = connectorStatusMap.get(connector.id);
                                const ready = isConnectorReady(statusRecord);
                                const active = nextConnector?.id === connector.id;
                                const recovery = recoveryHintForConnector(statusRecord, !bridge?.isAvailable);
                                return (
                                  <li key={connector.id} data-ready={ready} data-active={active} data-recovery={recovery.tone}>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        focusInlineGuideForConnector(
                                          connector.id,
                                          `${connector.label} 연결 가이드를 열었습니다.`,
                                        )
                                      }
                                    >
                                      <span>{index + 2}</span>
                                      <strong>{connector.label}</strong>
                                      <small>{recovery.shortLabel}</small>
                                    </button>
                                  </li>
                                );
                              })}
                            </ol>
                          </details>
                        ) : null}
                      </section>
                    ) : null}
                  </div>
                </details>
              ) : null}

              {singleSettingMode && vaultOpen ? (
                <section className={styles.connectVaultDock} aria-label="외부 계정 보관함 바로 입력">
                  <header>
                    <div>
                      <span>보안 입력</span>
                      <strong>외부 계정 정보는 여기에서 등록합니다</strong>
                    </div>
                    <button type="button" onClick={() => setVaultOpen(false)}>
                      접기
                    </button>
                  </header>
                  <ExternalAccountVaultCard />
                </section>
              ) : null}

              {singleSettingMode && computerUseHandoffOpen ? (
                <section className={styles.computerUseRouteCard} aria-label="내 PC 작업 도우미 읽기 후보">
                  <div>
                    <span>내 PC 작업 도우미</span>
                    <strong>공식 연결이 안 되는 사이트는 읽기 모드부터 준비합니다</strong>
                    <p>
                      로그인된 사이트 화면을 읽어 후보를 정리하고, 클릭·입력·발송·등록은 업무 오피스 승인 카드에서 다시 확인합니다.
                    </p>
                  </div>
                  <a href="/?computerUse=1&source=connect-recovery">홈에서 내 PC 작업 도우미 확인</a>
                </section>
              ) : null}

              {showSingleSettingOnlyCard && activeSingleSettingDefinition ? (
                <section className={styles.singleSettingOnlyCard} aria-label={`${activeSingleSettingDefinition.label} 필요 설정`}>
                  <header>
                    <div>
                      <span>필요 설정</span>
                      <strong>{activeSingleSettingDefinition.title}</strong>
                    </div>
                  </header>
                  <section className={styles.singleSettingScopePanel} aria-label={`${activeSingleSettingDefinition.label} 전용 설정 범위`}>
                    <header>
                      <div>
                        <span>현재 설정</span>
                        <strong>{activeSingleSettingDefinition.focusLabel}</strong>
                      </div>
                      <small>이 설정 안에서만 필요한 값을 정리합니다 · 다른 설정 섞지 않음</small>
                    </header>
                    <small className={styles.singleSettingGuard}>
                      방금 누른 설정과 관련 없는 연결 목록은 열지 않습니다. 비밀번호·토큰은 채팅에 남기지 않습니다.
                    </small>
                    <div>
                      {activeSingleSettingPlan
                        .filter((item) => item.id === "storage" || item.id === "boundary")
                        .map((item) => (
                          <article key={item.id} data-state={item.state}>
                            <span>{item.label}</span>
                            <strong>{item.title}</strong>
                          </article>
                        ))}
                    </div>
                  </section>
                  {homeReadinessHandoff ? <HomeReadinessHandoffPanel /> : null}
                  {isMailSetupSingleSetting(activeSingleSettingDefinition.canonicalId) ? (
                    <section
                      className={styles.mailSetupTemplatePanel}
                      aria-label="쉬운 메일 설정 템플릿"
                      data-mail-setup-contract="provider_choice_read_first_calendar_optional_vault_safe"
                    >
                      <header>
                        <div>
                          <span>쉬운 메일 설정</span>
                          <strong>Gmail도, 회사/일반 메일도 같은 1순위로 연결합니다</strong>
                        </div>
                        <small>메일 종류, 제외 기준, 확인 주기를 먼저 고르고 서버값은 필요할 때만 보여줍니다.</small>
                      </header>
                      <ol>
                        {buildEasyMailSetupRows().map((row) => (
                          <li key={row.id} data-state={row.state}>
                            <span>{row.label}</span>
                            <div>
                              <strong>{row.title}</strong>
                              <small>{row.detail}</small>
                            </div>
                            <a href={row.href}>{row.actionLabel}</a>
                          </li>
                        ))}
                      </ol>
                      <section
                        className={styles.mailSetupPollingRail}
                        aria-label="메일 5분 자동 점검 알림 흐름"
                        data-mail-setup-polling-rail="five_minute_app_inbox_first_optional_external_notice"
                        data-mail-setup-polling-cadence="5m"
                        data-mail-setup-polling-default-route="app_inbox"
                        data-mail-setup-polling-external-notice="user_selected_only"
                        data-mail-setup-polling-final-lock="send_calendar_attachment_locked_until_app_final_confirmation"
                      >
                        {buildMailAutomationPollingRows().map((row) => (
                          <article key={row.id} data-state={row.state}>
                            <span>{row.badge}</span>
                            <div>
                              <strong>{row.title}</strong>
                              <small>{row.detail}</small>
                            </div>
                          </article>
                        ))}
                      </section>
                      <details
                        className={styles.mailSetupRuleFold}
                        aria-label="메일 자동 정리 기본 규칙 접힘"
                        data-mail-setup-rule-fold="default_rules_on_demand"
                        data-mail-setup-rule-default="closed"
                      >
                        <summary>
                          <span>정리 기준</span>
                          <strong>중요/제외 규칙은 필요할 때만</strong>
                          <small>기본값은 유지하고 바꾸고 싶을 때 엽니다.</small>
                        </summary>
                        <div className={styles.mailSetupRuleGrid} aria-label="메일 자동 정리 기본 규칙">
                          {buildEasyMailRuleRows().map((rule) => (
                            <article key={rule.id} data-tone={rule.tone}>
                              <span>{rule.badge}</span>
                              <strong>{rule.title}</strong>
                              <small>{rule.detail}</small>
                            </article>
                          ))}
                        </div>
                      </details>
                    </section>
                  ) : null}
                  {showAIConnectionChoices ? (
                    <details className={styles.aiConnectionChoices}>
                      <summary>
                        <span>다른 방식 선택</span>
                        <small>필요한 사람만 연결 방식을 바꿉니다.</small>
                      </summary>
                      <div className={styles.aiConnectionChoiceList} role="list" aria-label="AI 답변 방식 선택">
                        {buildAIConnectionChoices().map((choice) => (
                          <article key={choice.id} role="listitem" data-active={aiConnectionChoice === choice.id ? "true" : "false"}>
                            <div>
                              <span>{choice.badge}</span>
                              <strong>{choice.title}</strong>
                              <small>{choice.detail}</small>
                            </div>
                            {"href" in choice ? (
                              <a
                                href={choice.href}
                                onClick={() => {
                                  setAIConnectionChoice(choice.id);
                                  setAIConnectionChoiceMessage(choice.message ?? "");
                                }}
                              >
                                {choice.actionLabel}
                              </a>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void startAIConnectionChoiceLogin(choice.id)}
                              >
                                {choice.actionLabel}
                              </button>
                            )}
                          </article>
                        ))}
                      </div>
                      {aiConnectionChoiceMessage ? <p role="status">{aiConnectionChoiceMessage}</p> : null}
                    </details>
                  ) : null}
                  <SettingQualityGateRail items={settingQualityGateItems} />
                  <nav aria-label={`${activeSingleSettingDefinition.label} 필요 설정 액션`}>
                    <a href={singleSettingDestinationHref(activeSingleSettingDefinition.panel, activeSingleSettingDefinition.canonicalId)}>
                      전용 설정 열기
                    </a>
                  </nav>
                </section>
              ) : null}

              <div className={styles.returnToWorkPanel} role="status">
                <div>
                  <strong>
                    {lastConnectedConnector
                      ? `${lastConnectedConnector.label} 연결 확인 완료`
                      : handoffSource === "mailops-session"
                        ? "연결을 마치면 메일 업무실로 돌아갑니다"
                        : handoffSource === "office"
                          ? "연결을 마치면 오피스로 돌아가 마지막 확인을 이어갑니다"
                        : handoffSource === "setup"
                          ? "연결을 마치면 첫 설정으로 돌아갑니다"
                        : handoffSource === "setup-work"
                          ? "업무 연결을 마치면 첫 설정으로 돌아갑니다"
                        : "연결을 마치면 홈에서 점검을 이어갑니다"}
                  </strong>
                  <p>
                    {handoffSource === "mailops-session"
                      ? "추천 연결을 확인한 뒤 홈 메일 업무실로 돌아가면 메일함 다시 읽기, 답장 초안, 일정 후보, 승인 대기 생성을 바로 이어갈 수 있습니다."
                      : handoffSource === "office"
                        ? "필요한 연결을 확인한 뒤 오피스로 돌아가면 마지막 확인 후보에서 실행 전 검토를 이어갈 수 있습니다."
                      : handoffSource === "setup"
                        ? "AI 연결을 확인한 뒤 첫 설정 화면으로 돌아가면 첫 업무 연결과 승인함 테스트를 이어갈 수 있습니다."
                      : handoffSource === "setup-work"
                        ? "메일/일정 연결을 확인한 뒤 첫 설정 화면으로 돌아가면 승인함 테스트와 업무실 미리보기를 이어갈 수 있습니다."
                      : "추천 연결을 확인한 뒤 홈 업무 화면으로 돌아가면 승인 대기 카드와 반복 업무 점검을 바로 이어갈 수 있습니다."}
                    {returnRuleId ? " 연결 확인 후 켜진 반복 업무는 홈에서 바로 점검할 수 있습니다." : ""}
                  </p>
                </div>
                <a href={homeRecheckHref}>
                  {handoffSource === "mailops-session"
                    ? "메일 업무실로 돌아가기"
                    : handoffSource === "office"
                      ? "오피스로 돌아가 마지막 확인"
                    : handoffSource === "setup" || handoffSource === "setup-work"
                      ? "첫 설정으로 돌아가기"
                      : "홈에서 점검 이어가기"}
                </a>
              </div>
            </div>
          ) : activeConnectPageView === "vault" ? (
            <section className={styles.connectVaultDock} aria-label="외부 계정 보관함 바로 입력">
              <header>
                <div>
                  <span>계정 보관함</span>
                  <strong>외부 계정 정보는 여기에서만 등록합니다</strong>
                  <small>비밀번호와 보안 정보 원문은 채팅에 남기지 않고, 필요한 연결에서만 불러옵니다.</small>
                </div>
                <button type="button" onClick={() => setConnectPageView("focus")}>
                  바로 연결로
                </button>
              </header>
              <ExternalAccountVaultCard />
            </section>
          ) : activeConnectPageView === "recovery" ? (
            <section
              className={styles.connectRecoveryPrimaryPath}
              aria-label="연결 복구 기록과 다음 방법"
              data-connect-recovery-empty-state="vault_or_computer_use_when_needed"
            >
              <span>복구 기록</span>
              <strong>막힌 연결은 보관함 또는 내 PC 읽기 후보로 이어갑니다</strong>
              <small>
                아직 선택한 업무가 없어서 구체 연결은 펼치지 않았습니다. 업무를 적거나 보관함을 열면 필요한 연결만 다시 보여줍니다.
              </small>
              {localMemoryStatus?.connectorRecoveryMemories?.slice(0, 3).map((memory) => (
                <ConnectorRecoveryMemoryNote key={`${memory.connectorId}-${memory.actionLabel}`} memory={memory} compact />
              ))}
            </section>
          ) : showBareConnectionCatalog ? null : (
            <div className={styles.connectEmptyState} aria-label="연결 추천 대기">
              <div className={styles.connectMotion} aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div>
                <strong>업무를 적으면 필요한 연결만 나타납니다</strong>
                <p>처음에는 연결 목록을 펼치지 않고, 메일·캘린더·자료 같은 후보를 하나씩 추천합니다.</p>
              </div>
            </div>
          )}

          {hasConnectionPlan && !singleSettingMode ? (
            <>
              <div className={styles.recommendTop}>
                <div className={styles.recommendHeader}>
                  <span className={styles.eyebrow}>다음 연결</span>
                  <h2>{nextConnector ? nextConnector.label : "연결 준비 완료"}</h2>
                  <p>{nextConnector?.shortDescription ?? "필요한 연결은 업무를 입력하면 다시 추천됩니다."}</p>
                </div>
                <div className={styles.setupMeter} aria-label="연결 준비율">
                  <div>
                    <strong>{connectionPlanProgress}%</strong>
                    <span>{`${readyRecommended.length} / ${recommended.length} 연결 준비`}</span>
                  </div>
                  <div className={styles.meterTrack}>
                    <span style={{ width: `${connectionPlanProgress}%` }} />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      nextConnector &&
                      focusInlineGuideForConnector(nextConnector.id, `${nextConnector.label} 연결 가이드를 열었습니다.`)
                    }
                    disabled={!nextConnector}
                  >
                    {readyRecommended.length === recommended.length ? "가이드 다시 보기" : "다음 연결 시작"}
                  </button>
                </div>
              </div>

              {goalText.trim() ? (
                <details className={styles.progressiveDetails}>
                  <summary>자동화 카드 만들기</summary>
                  <div className={styles.automationDraft} aria-label="자동화 초안">
                    <div>
                      <span>초안</span>
                      <strong>{automationDraft.title}</strong>
                      <button type="button" onClick={handleCreateAutomationDraft}>
                        홈에 추가
                      </button>
                    </div>
                    <dl>
                      <div>
                        <dt>감지</dt>
                        <dd>{automationDraft.trigger}</dd>
                      </div>
                      <div>
                        <dt>결과</dt>
                        <dd>{automationDraft.output}</dd>
                      </div>
                      <div>
                        <dt>승인</dt>
                        <dd>{automationDraft.approval}</dd>
                      </div>
                    </dl>
                  </div>
                </details>
              ) : null}

              {createdDraft ? (
                <div className={styles.createdDraft} role="status">
                  <strong>자동화 초안과 규칙이 홈에 추가됐습니다</strong>
                  <p>아직 외부 실행은 하지 않았고, 홈에서 켜짐 상태와 수동 점검을 확인할 수 있습니다.</p>
                  <a href={createdDraftHref}>
                    홈에서 보기
                  </a>
                </div>
              ) : null}

              <div
                className={styles.recommendList}
                data-recommended-connector-list="first_one_visible"
                data-recommended-connector-visible-count={visibleRecommended.length}
                data-recommended-connector-hidden-count={Math.max(0, recommended.length - visibleRecommended.length)}
              >
                {visibleRecommended.map((connector) => {
                  const statusRecord = connectorStatusMap.get(connector.id);
                  const recovery = recoveryHintForConnector(statusRecord, !bridge?.isAvailable);
                  const recoveryMemory = connectorRecoveryMemoryMap.get(connector.id);
                  return (
                  <button
                    key={connector.id}
                    type="button"
                    className={`${styles.recommendCard} ${
                      isConnectorReady(statusRecord) ? styles.recommendCardReady : ""
                    }`}
                    data-recovery={recovery.tone}
                    onClick={() =>
                      focusInlineGuideForConnector(connector.id, `${connector.label} 연결 가이드를 열었습니다.`)
                    }
                  >
                    <span aria-hidden="true">{connector.iconText}</span>
                    <strong>
                      {connector.label}
                      <small>
                        {recovery.shortLabel}
                      </small>
                    </strong>
                    <small>{connector.shortDescription}</small>
                    {recoveryMemory ? <small>{`지난 복구: ${recoveryMemory.actionLabel}`}</small> : null}
                    <em>{recovery.actionLabel}</em>
                  </button>
                  );
                })}
              </div>
              {recommended.length > visibleRecommended.length ? (
                <details
                  className={styles.progressiveDetails}
                  aria-label="다른 추천 연결 접힘"
                  data-recommended-connector-more="remaining_recommendations_on_demand"
                  data-recommended-connector-more-default="closed"
                >
                  <summary>다른 추천 연결 {recommended.length - visibleRecommended.length}개</summary>
                  <div className={styles.recommendList}>
                    {recommended
                      .filter((connector) => !visibleRecommended.some((item) => item.id === connector.id))
                      .map((connector) => {
                        const statusRecord = connectorStatusMap.get(connector.id);
                        const recovery = recoveryHintForConnector(statusRecord, !bridge?.isAvailable);
                        const recoveryMemory = connectorRecoveryMemoryMap.get(connector.id);
                        return (
                        <button
                          key={connector.id}
                          type="button"
                          className={`${styles.recommendCard} ${
                            isConnectorReady(statusRecord) ? styles.recommendCardReady : ""
                          }`}
                          data-recovery={recovery.tone}
                          onClick={() =>
                            focusInlineGuideForConnector(
                              connector.id,
                              `${connector.label} 연결 가이드를 열었습니다.`,
                            )
                          }
                        >
                          <span aria-hidden="true">{connector.iconText}</span>
                          <strong>
                            {connector.label}
                            <small>
                              {recovery.shortLabel}
                            </small>
                          </strong>
                          <small>{connector.shortDescription}</small>
                          {recoveryMemory ? <small>{`지난 복구: ${recoveryMemory.actionLabel}`}</small> : null}
                          <em>{recovery.actionLabel}</em>
                        </button>
                        );
                      })}
                  </div>
                </details>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {showConnectionWorkspaceChrome && !singleSettingMode ? (
      <details className={styles.progressiveDetails}>
        <summary>공개 문의 릴레이</summary>
      <section className={styles.relayPanel} aria-label="개인용 공개 릴레이 상태">
        <div className={styles.relayHeader}>
          <div>
            <span className={styles.eyebrow}>개인 파일럿</span>
            <h2 className={styles.relayTitle}>공개 문의 릴레이</h2>
            <p className={styles.relayCopy}>
              일반 문의 폼, 개인 채팅, 앱 연결 주소 이벤트만 받고 데스크톱 앱이 확인한 뒤 업무
              인박스 카드로 넘깁니다.
            </p>
          </div>
          <button
            type="button"
            className={styles.pullButton}
            onClick={handleRelayPull}
            disabled={!bridge?.isAvailable || relayBusy}
          >
            {relayBusy ? "확인 중" : "지금 확인"}
          </button>
        </div>

        <div className={styles.relayGrid}>
          <div className={styles.metric}>
            <span>상태</span>
            <strong>
              {relayStatus?.status === "public_trigger_relay_ready"
                ? "데스크톱 pull 대기"
                : "데스크톱 앱 필요"}
            </strong>
          </div>
          <div className={styles.metric}>
            <span>대기 이벤트</span>
            <strong>{relayStatus?.queuedEventCount ?? 0}건</strong>
          </div>
          <div className={styles.metric}>
            <span>전달 방식</span>
            <strong>{relayStatus?.route?.deliveryMode === "desktop_pull" ? "설치 앱에서 확인" : "로컬 확인"}</strong>
          </div>
        </div>

        <div className={styles.relayLists}>
          <div>
            <span className={styles.listLabel}>허용</span>
            <div className={styles.chips}>
              {(relayStatus?.route?.allowedAdapters ?? ["mody_direct", "generic_form", "chat_message"]).map(
                (adapter) => (
                  <span key={adapter} className={styles.chipSafe}>
                    {adapterLabel(adapter)}
                  </span>
                ),
              )}
            </div>
          </div>
          <div>
            <span className={styles.listLabel}>보류</span>
            <div className={styles.chips}>
              {(
                relayStatus?.route?.deferredAdapters ?? [
                  { adapterId: "channel_talk" },
                  { adapterId: "naver_talktalk" },
                  { adapterId: "booking_update" },
                  { adapterId: "commerce_order" },
                ]
              ).map((adapter) => (
                <span key={adapter.adapterId} className={styles.chipPending}>
                  {adapterLabel(adapter.adapterId)}
                </span>
              ))}
            </div>
          </div>
        </div>

        <section
          className={styles.relaySafetyPath}
          aria-label="공개 문의 릴레이 안전 경계"
          data-relay-safety-path="secret_hidden_draft_only_final_approval"
          data-secret-display-policy="hidden_original_values"
          data-first-result="inbox_draft_card"
          data-final-action-lock="send_schedule_payment_submit_delete_until_approval"
          data-primary-button="지금 확인"
          data-mobile-safe-width="390"
        >
          <header>
            <span>안전 경계</span>
            <strong>먼저 문의 초안만 받고, 실행은 승인 뒤에 합니다</strong>
          </header>
          <ol>
            <li data-step="secret">
              <span>1</span>
              <strong>비밀값 원문 숨김</strong>
              <small>연결에 필요한 값과 연락처 원문은 화면에 보이지 않습니다.</small>
            </li>
            <li data-step="draft">
              <span>2</span>
              <strong>초안 카드로 받기</strong>
              <small>문의 내용은 업무 인박스 후보로만 들어옵니다.</small>
            </li>
            <li data-step="approval">
              <span>3</span>
              <strong>승인 전 실행 잠금</strong>
              <small>발송, 일정 등록, 결제, 제출, 삭제는 최종 확인 전까지 실행하지 않습니다.</small>
            </li>
          </ol>
        </section>
      </section>
      </details>
      ) : null}

      {showConnectionOptions && !singleSettingMode ? (
      <details
        className={styles.progressiveDetails}
        aria-label="전체 연결 목록"
        data-connect-full-catalog-fold="summary_first_catalog_on_demand"
        data-connect-full-catalog-default={showBareConnectionCatalog ? "open" : "closed"}
        data-connect-full-catalog-count={connectors.length}
        data-connect-bare-catalog={showBareConnectionCatalog ? "true" : "false"}
        open={fullCatalogOpen}
        onToggle={(event) => setFullCatalogOpen(event.currentTarget.open)}
      >
        <summary>전체 연결 목록 {connectors.length}개</summary>
      <ConnectorCatalog
        connectors={connectors}
        selectedId={selectedId}
        onSelect={setSelectedId}
        connectedIds={
          new Set(
            connectors
              .filter((connector) => isConnectorReady(connectorStatusMap.get(connector.id)))
              .map((connector) => connector.id),
          )
        }
      />
      </details>
      ) : null}
      <ConnectorDrawer
        connector={selected}
        onClose={() => setSelectedId(null)}
        statusRecord={selected ? connectorStatusMap.get(selected.id) : undefined}
        preferredMode={preferredMode}
        onConnect={handleConnect}
        onSwitchConnector={setSelectedId}
      />
    </>
  );
}

function ConnectorRecoveryMemoryNote({
  memory,
  compact = false,
}: {
  memory: LocalMemoryConnectorRecoveryMemory;
  compact?: boolean;
}) {
  return (
    <div className={styles.connectorRecoveryMemoryNote} data-kind={memory.recoveryKind} data-compact={compact}>
      <div>
        <span>지난 복구 기억</span>
        <strong>{memory.actionLabel || "연결 확인"}</strong>
      </div>
      <p>{memory.summary}</p>
      {memory.signals.length ? (
        <ul>
          {memory.signals.slice(0, compact ? 2 : 4).map((signal) => (
            <li key={`${memory.id}-${signal}`}>{signal}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SettingQualityGateRail({ items }: { items: SettingQualityGateItem[] }) {
  return (
    <details
      className={styles.settingQualityGateRail}
      aria-label="설정 품질 기준"
      data-setting-quality-gate-fold="summary_first_quality_rules_on_demand"
      data-setting-quality-gate-default="closed"
      data-setting-quality-gate-visible="summary_only_until_user_opens"
      data-setting-quality-gate-count={items.length}
    >
      <summary>
        <div>
          <span>설정 품질 기준</span>
          <strong>부족한 설정은 쉬운 경로로, 큰 기능은 필요할 때 엽니다</strong>
        </div>
        <small>{items.length}개 기준 · 필요할 때 열기</small>
      </summary>
      <ol data-setting-quality-gate-body="hidden_until_user_opens">
        {items.map((item) => (
          <li
            key={item.id}
            data-state={item.state}
            data-replacement-feature-id={item.replacementFeatureId}
            data-replacement-action={item.replacementHomeAction}
            data-runtime-proof={item.runtimeProofLabel}
            data-verify-command={item.verifyCommand}
            data-next-user-choice={item.nextUserChoice}
            data-original-exposure-policy={item.originalExposurePolicy}
            data-replacement-readiness={item.replacementReadiness}
            data-replacement-execution-contract={item.replacementExecutionContract}
          >
            <span>{item.label}</span>
            <div>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
              <small>작동 확인된 대표 기능만 실행</small>
              <small>막히면: {item.nextUserChoice}</small>
            </div>
            <a
              href={item.replacementHref}
              data-feature-id={item.replacementFeatureId}
              data-original-exposure-policy={item.originalExposurePolicy}
              data-replacement-readiness={item.replacementReadiness}
              data-replacement-execution-contract={item.replacementExecutionContract}
            >
              {item.replacementUserPath}
            </a>
            {item.absorptionConnectionHref ? (
              <a
                href={item.absorptionConnectionHref}
                data-absorption-connection-action={item.absorptionConnectionAction}
                data-absorption-connection-role={item.absorptionConnectionRole}
              >
                {item.absorptionConnectionLabel}
              </a>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

function HomeReadinessHandoffPanel() {
  const rows = [
    {
      id: "read-first",
      label: "읽기",
      title: "가짜 결과 없이 읽기부터",
      detail: "연결 전에는 메일이나 일정을 읽은 척하지 않습니다.",
      state: "read",
    },
    {
      id: "approval-lock",
      label: "승인",
      title: "외부 실행은 승인 뒤",
      detail: "발송, 일정 등록, 파일 변경은 오피스 마지막 확인 전까지 잠급니다.",
      state: "approval",
    },
    {
      id: "next-user-step",
      label: "다음",
      title: "다음 버튼이 보여야 함",
      detail: "다음 버튼, 승인함, 실행 로그, 다음부터 이렇게 저장 위치를 계속 확인합니다.",
      state: "next",
    },
  ] as const;

  return (
    <section
      className={styles.homeReadinessHandoffPanel}
      aria-label="홈에서 이어온 실제 확인 기준"
      data-home-connect-readiness-handoff="real_read_only_no_fake_success"
      data-external-action-lock="approval_required_before_mutation"
      data-first-user-check="next_button_approval_log_memory_visible"
      data-source="home_connection_snapshot"
    >
      <header>
        <div>
          <span>홈에서 이어온 기준</span>
          <strong>읽기 전용 확인부터 이어갑니다</strong>
        </div>
        <small>같은 안전 기준 유지</small>
      </header>
      <div>
        {rows.map((row) => (
          <article key={row.id} data-state={row.state}>
            <span>{row.label}</span>
            <strong>{row.title}</strong>
            <small>{row.detail}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function ReleaseLiveSmokeGuide() {
  const fieldGuideSteps = [
    {
      id: "field-guide",
      label: "현장 가이드",
      title: "한 장으로 순서 확인",
      detail: "AI live, 메일/캘린더 smoke, 첫 사용자 관찰, operator runner를 같은 순서로 봅니다.",
      command: "npm.cmd run prepare:release-field-guide",
      state: "ready",
    },
    {
      id: "ai-live",
      label: "AI 대화",
      title: "실제 답변 또는 복구",
      detail: "OpenAI/Gemini 중 하나가 실제 답변을 내거나, 연결이 없으면 가짜 답변 없이 멈춰야 합니다.",
      command: "npm.cmd run run:ai-runtime-live-unblock",
      state: "active",
    },
    {
      id: "mail-calendar-live",
      label: "메일 실기",
      title: "읽기 전용 live smoke",
      detail: "IMAP/Calendar 값이 없으면 missing credential로 멈추고, 있으면 읽기 전용 증거만 남깁니다.",
      command: "npm.cmd run run:release-live-smoke-unblock",
      state: "locked",
    },
    {
      id: "human-observation",
      label: "사람 관찰",
      title: "처음 쓰는 사람 확인",
      detail: "AI 답변/복구, 가짜 결과 차단, 가상오피스 근거를 사람이 직접 확인한 뒤에만 통과합니다.",
      command: "npm.cmd run run:first-user-observation-unblock",
      state: "locked",
    },
    {
      id: "operator-runner",
      label: "운영자 실행",
      title: "증거 준비 뒤 이어가기",
      detail: "실제 키와 실제 관찰이 준비된 뒤에만 operator runner로 최종 gate까지 점검합니다.",
      command: "npm.cmd run verify:release-operator-runner",
      state: "proof",
    },
  ] as const;

  const steps = [
    {
      id: "prepare",
      label: "1",
      command: "npm.cmd run prepare:release-live-smoke",
      title: "운영자 준비",
      detail: "템플릿, 체크리스트, operator scorecard를 먼저 만듭니다.",
      state: "ready",
    },
    {
      id: "placeholder",
      label: "2",
      command: "npm.cmd run verify:release-live-readiness-placeholder",
      title: "가짜 완료 차단",
      detail: "placeholder는 연결 완료가 아닙니다.",
      state: "blocked",
    },
    {
      id: "smoke",
      label: "3",
      command: "npm.cmd run run:release-live-smoke-unblock",
      title: "읽기 전용 실기",
      detail: "IMAP은 최신 제목/봉투만, Calendar는 freeBusy만 확인합니다.",
      state: "active",
    },
    {
      id: "readiness",
      label: "4",
      command: "npm.cmd run verify:release-live-readiness",
      title: "증거 확인",
      detail: "live_reports_verified일 때만 실제 연결 완료로 봅니다.",
      state: "proof",
    },
    {
      id: "blockers",
      label: "5",
      command: "npm.cmd run audit:release-blockers",
      title: "남은 blocker",
      detail: "사람 관찰, 설정 누락, 실패 이력은 남은 작업으로 유지합니다.",
      state: "locked",
    },
  ] as const;

  return (
    <section
      className={styles.releaseLiveSmokeGuide}
      aria-label="실계정 읽기 전용 검증 순서"
      data-live-smoke-ui="mail_calendar_read_only_release_gate"
      data-secret-policy="local_only_no_chat"
      data-placeholder-policy="placeholder_never_ready"
      data-calendar-scope="freebusy_read_only"
      data-mail-scope="imap_subject_envelope_read_only"
      data-release-field-guide-ui="single_operator_handoff_without_live_secrets"
      data-ai-live-readiness="ai_live_runtime_verified_required"
      data-human-observation-gate="human_observation_required_no_fake_pass"
      data-final-status="blocked_until_live_reports_verified"
    >
      <header>
        <div>
          <span>실계정 검증</span>
          <strong>메일/캘린더는 읽기 전용 증거가 있어야 완료됩니다</strong>
        </div>
        <small>비밀값은 로컬 입력만</small>
      </header>
      <section className={styles.releaseFieldGuidePanel} aria-label="현장 실행 가이드">
        <header>
          <div>
            <span>현장 가이드</span>
            <strong>실제 연결과 관찰을 한 순서로 봅니다</strong>
          </div>
          <small>fake pass 금지</small>
        </header>
        <ol>
          {fieldGuideSteps.map((step) => (
            <li key={step.id} data-state={step.state} data-field-guide-step={step.id}>
              <span>{step.label}</span>
              <div>
                <strong>{step.title}</strong>
                <small>{step.detail}</small>
                <code>{step.command}</code>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <ol>
        {steps.map((step) => (
          <li key={step.id} data-state={step.state} data-verify-command={step.command}>
            <span>{step.label}</span>
            <div>
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
              <code>{step.command}</code>
            </div>
          </li>
        ))}
      </ol>
      <p>
        원문 삭제, 이동, 읽음 처리, 발송, 일정 생성/수정/삭제는 이 검증에서 하지 않습니다. 최종 상태가
        live_reports_verified가 아니면 릴리스는 계속 막힌 상태로 남깁니다.
      </p>
    </section>
  );
}

function inferRecommendedConnectorIds(goalText: string): string[] {
  const text = goalText.toLowerCase();
  if (["예약", "상담", "일정", "캘린더"].some((keyword) => text.includes(keyword))) {
    return ["gmail", "google-calendar", "telegram-bot", "naver-booking"];
  }
  if (["카카오톡", "카톡", "kakaotalk"].some((keyword) => text.includes(keyword))) {
    return ["kakaotalk-local-app", "kakao-channel", "telegram-bot"];
  }
  if (["메신저", "메세지", "메시지", "슬랙", "디스코드", "텔레그램"].some((keyword) => text.includes(keyword))) {
    return ["telegram-bot", "slack-app", "discord-app", "kakaotalk-local-app"];
  }
  if (["쇼핑몰", "주문", "환불", "재고", "정산"].some((keyword) => text.includes(keyword))) {
    return ["company-mail", "inventory-system", "pos-system", "local-folder-index"];
  }
  if (["문서", "자료", "pdf", "엑셀", "세금계산서", "견적서"].some((keyword) => text.includes(keyword))) {
    return ["local-folder-index", "gmail", "notion-workspace", "google-gemini"];
  }
  return ["gmail", "public-trigger-relay", "telegram-bot", "google-calendar"];
}

function normalizeConnectorId(id: string): string {
  const value = id.trim();
  if (!value) return "";
  const aliases: Record<string, string> = {
    "business-system": "inventory-system",
    "supplier-mail": "gmail",
    "business-mail": "company-mail",
    discord: "discord-app",
    slack: "slack-app",
    telegram: "telegram-bot",
    "telegram-channel": "telegram-bot",
    kakao: "kakao-channel",
    "kakao-talk": "kakaotalk-local-app",
    kakaotalk: "kakaotalk-local-app",
    "kakao-local": "kakaotalk-local-app",
  };
  return aliases[value] ?? value;
}

function connectorIdsForSingleSetting(singleSetting: string): string[] {
  return connectorIdsForSingleWorkSetting(singleSetting);
}

function singleSettingFocusLabel(singleSetting: string): string {
  return singleWorkSettingFocusLabel(singleSetting);
}

function parseConnectHandoffSource(value: string | null): ConnectHandoffSource {
  if (value === "work-check" || value === "rule-check") return value;
  if (value === "mail-automation-notification") return value;
  if (value === "restore-reauth") return value;
  if (value === "mailops-session") return value;
  if (value === "home-readiness") return value;
  if (value === "office") return value;
  if (value === "setup") return value;
  if (value === "setup-work") return value;
  if (value === "chat") return value;
  return "manual";
}

function buildRouteFocusLabel(
  source: ConnectHandoffSource,
  wantsVault: boolean,
  wantsComputerUse: boolean,
  connectorLabel?: string,
) {
  if (source === "mailops-session") {
    return "메일 업무 세션에서 막힌 연결을 바로 복구합니다";
  }
  if (source === "home-readiness") {
    return "홈 연결 상태에서 이어온 실제 확인 기준을 유지합니다";
  }
  if (source === "mail-automation-notification") {
    return "메일 자동 점검의 앱 승인함 알림 초안을 외부 알림 채널로 이어갑니다";
  }
  if (source === "office") {
    return `${connectorLabel ? `${connectorLabel} ` : ""}연결 후 오피스로 돌아가 마지막 확인을 이어갑니다`;
  }
  if (source === "setup") {
    return "첫 설정에서 이어온 AI 연결만 확인합니다";
  }
  if (source === "setup-work") {
    return "첫 설정에서 이어온 업무 연결만 확인합니다";
  }
  if (source === "restore-reauth") {
    return "복원된 기능의 외부 권한을 이 PC에서 다시 확인합니다";
  }
  if (connectorLabel) {
    return `${connectorLabel} 연결을 먼저 확인합니다`;
  }
  if (wantsVault) {
    return "외부 사이트 계정 보관함을 바로 열었습니다";
  }
  if (wantsComputerUse) {
    return "내 PC 작업 도우미 읽기 후보를 준비합니다";
  }
  return "";
}

function connectHandoffSourceLabel(source: ConnectHandoffSource) {
  if (source === "work-check") return "업무 점검";
  if (source === "rule-check") return "반복 업무";
  if (source === "mail-automation-notification") return "메일 자동 점검 알림";
  if (source === "restore-reauth") return "복원 재승인";
  if (source === "mailops-session") return "메일 업무 세션";
  if (source === "home-readiness") return "홈 연결 상태";
  if (source === "office") return "오피스 마지막 확인";
  if (source === "setup") return "첫 설정";
  if (source === "setup-work") return "첫 업무 설정";
  if (source === "chat") return "채팅 연결";
  return "연결";
}

function connectPageViewLabel(view: ConnectPageView) {
  if (view === "vault") return "계정 보관함";
  if (view === "recovery") return "복구 기록";
  return "바로 연결";
}

function connectPageViewBaseLabel(view: ConnectPageView) {
  if (view === "vault") return "설정";
  if (view === "recovery") return "기록";
  return "요약";
}

function getConnectPageViewSummary(
  view: ConnectPageView,
  recommendedCount: number,
  recoveryMemoryCount: number,
) {
  if (view === "vault") return "사이트 로그인과 비밀번호 입력은 보관함 안에서만 처리합니다.";
  if (view === "recovery") {
    return recoveryMemoryCount
      ? `막힌 연결 ${recoveryMemoryCount}개를 먼저 확인합니다.`
      : "복구 기록이 생기면 이 폴더에서만 자세히 봅니다.";
  }
  return recommendedCount
    ? `추천 연결 ${recommendedCount}개만 펼칩니다.`
    : "업무를 적기 전에는 전체 연결 목록을 접어둡니다.";
}

function getConnectPageViewTabs(
  vaultOpen: boolean,
  recoveryMemoryCount: number,
): Array<{
  id: ConnectPageView;
  label: string;
  detail: string;
}> {
  return [
    { id: "focus", label: "바로 연결", detail: "필요한 것만" },
    {
      id: "vault",
      label: "계정 보관함",
      detail: vaultOpen ? "열림" : "숨김",
    },
    {
      id: "recovery",
      label: "복구 기록",
      detail: recoveryMemoryCount ? `${recoveryMemoryCount}개` : "필요할 때",
    },
  ];
}

function getConnectPageFocusCards(input: {
  hasConnectionPlan: boolean;
  recommendedCount: number;
  visibleConnectionCount: number;
  vaultOpen: boolean;
  recoveryMemoryCount: number;
}): Array<{
  id: ConnectPageView;
  label: string;
  title: string;
  detail: string;
  countLabel: string;
  actionLabel: string;
  state: "focus" | "vault" | "recovery";
}> {
  return [
    {
      id: "focus",
      label: "바로 연결",
      title: input.hasConnectionPlan ? "지금 필요한 연결만" : "업무를 적기 전엔 접어둠",
      detail: input.hasConnectionPlan
        ? `처음에는 ${Math.min(input.visibleConnectionCount, 3)}개만 보여주고 나머지는 상세에 둡니다.`
        : "전체 연결 목록은 사용자가 필요할 때만 펼칩니다.",
      countLabel: input.hasConnectionPlan ? `${input.recommendedCount}개` : "대기",
      actionLabel: "바로 보기",
      state: "focus",
    },
    {
      id: "vault",
      label: "보관함",
      title: input.vaultOpen ? "계정 보관함 열림" : "민감한 입력은 보관함에서만",
      detail: "사이트 로그인, 비밀번호, 보안 정보는 채팅이 아니라 보관함에서 처리합니다.",
      countLabel: input.vaultOpen ? "열림" : "숨김",
      actionLabel: "보관함 보기",
      state: "vault",
    },
    {
      id: "recovery",
      label: "복구 기록",
      title: input.recoveryMemoryCount ? "막힌 연결 확인" : "복구 기록 대기",
      detail: input.recoveryMemoryCount
        ? "실패한 연결과 다음 방법은 복구 기록에서만 자세히 봅니다."
        : "막힌 연결이 생기면 이 폴더에 모아 보여줍니다.",
      countLabel: input.recoveryMemoryCount ? `${input.recoveryMemoryCount}개` : "없음",
      actionLabel: "기록 보기",
      state: "recovery",
    },
  ];
}

function singleSettingDestinationLabel(panel: NonNullable<ReturnType<typeof getSingleWorkSettingDefinition>>["panel"]) {
  if (panel === "account") return "계정/기억 설정";
  if (panel === "office") return "오피스";
  if (panel === "workers") return "AI 팀원";
  if (panel === "skills") return "필요 기능";
  if (panel === "learn") return "자료 학습";
  if (panel === "computer-use") return "내 PC 작업 도우미";
  return "연결";
}

function singleSettingDestinationHref(
  panel: NonNullable<ReturnType<typeof getSingleWorkSettingDefinition>>["panel"],
  singleSetting: string,
) {
  if (panel === "account") {
    return singleSetting === "memory-root" ? "/account#memory-root" : "/account#external-accounts";
  }
  if (panel === "office") return "/office?preview=workbench";
  if (panel === "workers") return "/?panel=workers";
  if (panel === "skills") return "/?panel=skills";
  if (panel === "learn") return "/learn";
  if (panel === "computer-use") return "/?computerUse=1";
  return `/connect?singleSetting=${encodeURIComponent(singleSetting)}`;
}

function buildAIConnectionChoices() {
  return [
    {
      id: "codex-oauth" as const,
      badge: "추천",
      title: "AI 로그인",
      detail: "이 앱이 선호하는 방식입니다. 키를 직접 복사하지 않고 계정 로그인으로 답변 엔진을 연결합니다.",
      actionLabel: "AI 로그인 열기",
    },
    {
      id: "api-key" as const,
      badge: "선택",
      title: "추가 AI 연결",
      detail: "이미 쓰는 OpenAI나 Gemini 연결 비밀값이 있으면 계정 보안 화면에서 직접 저장합니다.",
      actionLabel: "보안 입력 열기",
      href: "/account#ai-connection",
      message: "추가 AI 연결은 계정의 AI 연결 화면에서 보안 입력으로 저장합니다.",
    },
    {
      id: "local-engine" as const,
      badge: "선택",
      title: "내 PC AI 준비",
      detail: "Ollama, LM Studio 같은 PC 실행형 AI는 내 PC 작업 도우미에서 앱 위치와 실행 상태부터 확인합니다.",
      actionLabel: "PC 준비 열기",
      href: `/connect?singleSetting=computer-use&from=chat&goal=${encodeURIComponent("로컬 AI 엔진 연결 준비")}`,
      message: "내 PC AI는 먼저 이 PC에서 실행 앱과 권한을 확인한 뒤 연결합니다.",
    },
  ];
}

function isMailSetupSingleSetting(singleSetting: string) {
  return singleSetting === "mail-calendar" || singleSetting === "mail-learning" || singleSetting === "calendar-suggestions";
}

function shouldShowReleaseLiveSmokeGuide(singleSetting: string, connector?: ConnectorDefinition | null) {
  const normalized = normalizeSingleWorkSettingId(singleSetting) || singleSetting;
  if (isMailSetupSingleSetting(normalized)) return true;
  if (!connector) return false;
  return connector.category === "mail" || connector.category === "calendar" || connector.method === "imap_smtp";
}

function buildEasyMailSetupRows() {
  return [
    {
      id: "gmail",
      label: "1",
      title: "Gmail은 동의 연결",
      detail: "Google 계정 동의로 읽기부터 연결합니다. 발송 권한은 승인 카드 최종 확인 뒤에만 다시 봅니다.",
      href: "/connect?singleSetting=mail-calendar&connector=gmail&from=mailops-session",
      actionLabel: "Gmail 설정",
      state: "ready",
    },
    {
      id: "outlook",
      label: "2",
      title: "Outlook은 회사 정책 확인",
      detail: "Microsoft 365는 관리자 승인이 막을 수 있어 메일 읽기와 일정 읽기를 분리해 점검합니다.",
      href: "/connect?singleSetting=mail-calendar&connector=outlook&from=mailops-session",
      actionLabel: "Outlook 설정",
      state: "ready",
    },
    {
      id: "company-mail",
      label: "3",
      title: "일반 메일은 주소부터",
      detail: "NAVER, Daum, Kakao, 회사/공공기관 메일은 주소와 연결 비밀번호를 먼저 넣고 서버값은 자동 추정합니다.",
      href: "/connect?singleSetting=mail-calendar&connector=company-mail&externalAccounts=1&from=mailops-session",
      actionLabel: "일반 메일",
      state: "active",
    },
    {
      id: "mail-rules",
      label: "4",
      title: "볼 메일과 제외 메일 선택",
      detail: "중요 발신자, 계약/결제/마감 키워드는 우선 확인하고 스팸, 광고, 뉴스레터, 자동 알림은 기본 제외합니다.",
      href: "/connect?singleSetting=mail-learning&connector=company-mail&from=mailops-session",
      actionLabel: "정리 기준",
      state: "active",
    },
    {
      id: "calendar",
      label: "5",
      title: "일정은 읽기 먼저",
      detail: "가능 시간과 충돌 확인만 먼저 켜고, 실제 등록과 초대 발송은 오피스 마지막 확인 뒤에만 엽니다.",
      href: "/connect?singleSetting=calendar-suggestions&connector=google-calendar&from=mailops-session",
      actionLabel: "일정 설정",
      state: "approval",
    },
  ] as const;
}

function buildEasyMailRuleRows() {
  return [
    {
      id: "important",
      badge: "중요",
      title: "먼저 알려줄 메일",
      detail: "거래처, 학교/기관, 결제·계약·마감, 개인 약속, 사용자가 추가한 발신자와 키워드를 우선 확인합니다.",
      tone: "important",
    },
    {
      id: "exclude",
      badge: "제외",
      title: "기본 제외 메일",
      detail: "스팸, 프로모션·광고, 뉴스레터, 자동 알림은 업무 카드로 올리지 않고 필요하면 사용자가 해제합니다.",
      tone: "muted",
    },
    {
      id: "cadence",
      badge: "주기",
      title: "지속 모니터링 기준",
      detail: "처음에는 읽기 전용으로 수집하고, 메일이 올 때마다 정리하되 요약 알림 주기는 사용자가 조정합니다.",
      tone: "cadence",
    },
  ] as const;
}

function buildMailAutomationPollingRows() {
  return [
    {
      id: "cadence",
      badge: "5분",
      title: "사용자가 켠 뒤에만 자동 점검",
      detail: "5분마다 새 메일 신호와 웹메일 목록 메타데이터를 확인하고 중복은 건너뜁니다.",
      state: "ready",
    },
    {
      id: "app-inbox",
      badge: "승인함",
      title: "기본 도착지는 앱 승인함",
      detail: "광고 제외, 중요 후보, 승인 필요한 작업 수를 먼저 앱 승인함 카드와 알림 초안에 남깁니다.",
      state: "active",
    },
    {
      id: "external-notice",
      badge: "선택",
      title: "휴대폰/메신저 알림은 선택",
      detail: "Telegram 같은 외부 알림은 채널을 연결하고 사용자가 보낼 때만 요약을 전달합니다.",
      state: "optional",
    },
    {
      id: "final-lock",
      badge: "잠금",
      title: "발송·일정·첨부 이동은 마지막 확인 후",
      detail: "알림은 안내만 하고 실제 메일 발송, 캘린더 등록, 첨부 이동은 앱 최종 확인 전까지 잠깁니다.",
      state: "approval",
    },
  ] as const;
}

function buildSingleSettingScopePlan(definition: NonNullable<ReturnType<typeof getSingleWorkSettingDefinition>>) {
  const destination = singleSettingDestinationLabel(definition.panel);
  const connectorSummary = definition.connectorIds.length
    ? definition.connectorIds.slice(0, 4).join(", ")
    : "앱 내부 설정";
  const storageLabel =
    definition.canonicalId === "vault"
      ? "계정 보관함"
      : definition.canonicalId === "memory-root"
        ? "업무 방식 저장 위치"
        : definition.panel === "connect"
          ? "연결 상태 기록"
          : `${destination} 설정`;
  const executionBoundary =
    definition.canonicalId === "computer-use"
      ? "화면 읽기와 후보 정리만 먼저 허용하고 클릭·입력은 승인 뒤로 둡니다."
      : definition.canonicalId === "mail-calendar" || definition.canonicalId === "mail-learning"
        ? "메일 발송과 일정 등록은 사용자가 마지막으로 확인하기 전에는 실행하지 않습니다."
        : definition.canonicalId === "notification-assistant" || definition.canonicalId === "messenger-channel"
          ? "메신저 승인은 의사 기록으로만 저장하고 실제 외부 실행은 앱의 마지막 확인에서 처리합니다."
          : "외부 발송, 삭제, 이동, 결제, 등록은 오피스 승인 전에는 실행하지 않습니다.";

  return [
    {
      id: "scope",
      label: "설정 범위",
      title: `${definition.label}만 표시`,
      detail: definition.focusLabel,
      state: "active",
    },
    {
      id: "storage",
      label: "저장 위치",
      title: storageLabel,
      detail: `${connectorSummary} 값만 저장하고 비밀번호와 보안 정보 원문은 채팅에 남기지 않습니다.`,
      state: "safe",
    },
    {
      id: "boundary",
      label: "실행 경계",
      title: "승인 전 실행 잠금",
      detail: executionBoundary,
      state: "approval",
    },
    {
      id: "return",
      label: "복귀",
      title: `${destination}에서 이어가기`,
      detail: "저장 후 원래 대화, 메일 업무실, 오피스 승인함으로 돌아갑니다.",
      state: "ready",
    },
  ] as const;
}

function buildSettingQualityGateItems(
  definition: NonNullable<ReturnType<typeof getSingleWorkSettingDefinition>>,
  qualityGateFeatures: readonly FeatureLauncherCatalogItem[],
  progressiveFeatures: readonly FeatureLauncherCatalogItem[],
): SettingQualityGateItem[] {
  const currentSetting: SettingQualityGateItem = {
    id: `setting-${definition.canonicalId}`,
    label: definition.panel === "connect" ? "연결하기" : "전용 설정",
    title: `${definition.label}만 유지`,
    detail: "현재 설정은 필요한 값, 저장 위치, 승인 경계가 분리되어 있어 필요 설정으로 열 수 있습니다.",
    replacementUserPath: singleSettingDestinationLabel(definition.panel),
    replacementFeatureId: `setting-${definition.canonicalId}`,
    replacementHomeAction: definition.canonicalId,
    replacementHref: singleSettingDestinationHref(definition.panel, definition.canonicalId),
    runtimeProofLabel: "전용 설정 범위",
    verifyCommand: "npm run verify:single-setting-routing-browser",
    nextUserChoice: `${singleSettingDestinationLabel(definition.panel)}에서 이어가기`,
    originalExposurePolicy: "current_single_setting_visible",
    replacementReadiness: "single_setting_scoped",
    replacementExecutionContract: "single_setting_runtime_scope_verified",
    state: definition.panel === "connect" ? "setup" : "ready",
  };

  const qualityItems = [...qualityGateFeatures]
    .sort((left, right) => settingQualityGatePriority(left) - settingQualityGatePriority(right))
    .slice(0, 2)
    .map((item) => {
    const replacement = item.replacementFeatureId ? getFeatureLauncherCatalogItem(item.replacementFeatureId) : null;
    const replacementAction = item.replacementHomeAction || replacement?.homeAction || "";
    const isNotificationAbsorbed = item.id === "feature-notify-assistant" || item.id === "feature-messengers";
    const isFinalApprovalAbsorbed = item.id === "feature-final-approval";
    const replacementReadiness = validateFeatureLauncherReplacement({
      replacementFeatureId: item.replacementFeatureId,
      replacementHomeAction: replacementAction,
    });
    return {
      id: `quality-${item.id}`,
      label: item.qualityStatus === "remove_or_rebuild" ? "재구축" : "흡수됨",
      title: item.userLabel,
      detail: item.qualityReason,
      replacementUserPath: item.replacementUserPath || replacement?.userLabel || (item.id === "feature-rules" ? "반복 업무 만들기" : "대표 업무 흐름"),
      replacementFeatureId: item.replacementFeatureId || replacement?.id || "",
      replacementHomeAction: replacementAction,
      replacementHref: homeActionHref(replacementAction),
      runtimeProofLabel: replacement?.runtimeProofLabel || item.runtimeProofLabel,
      verifyCommand: replacement?.verifyCommand || item.verifyCommand,
      nextUserChoice: replacement?.nextUserChoice || item.nextUserChoice,
      originalExposurePolicy: "locked_until_rebuilt_or_absorbed",
      replacementReadiness: replacementReadiness.ready ? "launch_ready_verified" : replacementReadiness.reason,
      replacementExecutionContract: replacementReadiness.ready
        ? "replacement_launch_ready_runtime_safety_evidence_verified"
        : "replacement_blocked_until_runtime_safety_evidence_verified",
      absorptionConnectionHref: isNotificationAbsorbed
        ? "/connect?singleSetting=messenger-channel"
        : isFinalApprovalAbsorbed
          ? "/office?preview=workbench"
          : undefined,
      absorptionConnectionLabel: isNotificationAbsorbed ? "알림 연결" : isFinalApprovalAbsorbed ? "마지막 확인 준비" : undefined,
      absorptionConnectionAction: isNotificationAbsorbed
        ? "messenger_channels"
        : isFinalApprovalAbsorbed
          ? "open_office_final_confirmation"
          : undefined,
      absorptionConnectionRole: isNotificationAbsorbed
        ? "supplemental_notification_connection"
        : isFinalApprovalAbsorbed
          ? "supplemental_final_confirmation"
          : undefined,
      state: item.qualityStatus === "remove_or_rebuild" ? "rebuild" as const : "hidden" as const,
    };
    });

  const progressiveItems = progressiveFeatures
    .filter((item) => item.id !== currentSetting.replacementFeatureId)
    .slice(0, 2)
    .map((item) => ({
      id: `progressive-${item.id}`,
      label: "필요할 때",
      title: item.userLabel,
      detail: "검증된 기능이지만 현재 설정 화면을 복잡하게 만들지 않도록 필요한 순간에만 엽니다.",
      replacementUserPath: item.userLabel,
      replacementFeatureId: item.id,
      replacementHomeAction: item.homeAction,
      replacementHref: homeActionHref(item.homeAction),
      runtimeProofLabel: item.runtimeProofLabel,
      verifyCommand: item.verifyCommand,
      nextUserChoice: item.nextUserChoice,
      originalExposurePolicy: "progressive_disclosure_until_needed",
      replacementReadiness: "launch_ready_verified",
      replacementExecutionContract: "replacement_launch_ready_runtime_safety_evidence_verified",
      state: "progressive" as const,
    }));

  return [currentSetting, ...qualityItems, ...progressiveItems].slice(0, 4);
}

function homeActionHref(action: string) {
  if (action === "automation_check" || action === "repeat_work_builder" || action === "repeat_work_save_draft") return "/?workTools=repeat";
  if (action === "workers") return "/?panel=workers";
  if (action === "mailops_check") return "/?easyStart=mail";
  if (action === "messenger_channels") return "/connect?singleSetting=messenger-channel";
  if (action === "computer_use") return "/?computerUse=1";
  if (action === "learn_files") return "/learn";
  if (action === "open_office") return "/office?preview=workbench";
  return "/";
}

function settingQualityGatePriority(item: FeatureLauncherCatalogItem) {
  if (item.id === "feature-rules") return 0;
  if (item.id === "feature-notify-assistant") return 1;
  if (item.id === "feature-messengers") return 2;
  if (item.id === "feature-final-approval") return 3;
  return 10;
}

function uniqueConnectorIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

function buildAutomationDraft(goalText: string, connectorLabels: string[]) {
  const text = goalText.toLowerCase();
  const connectors = connectorLabels.length > 0 ? connectorLabels.join(", ") : "메일, 문의, 캘린더";

  if (["예약", "상담", "일정", "캘린더"].some((keyword) => text.includes(keyword))) {
    return {
      title: "예약 문의가 오면 가능 시간과 답장 초안을 만듭니다",
      trigger: `${connectors}에서 예약/상담 신호 감지`,
      output: "가능 시간 3개, 답장 초안, 일정 등록 후보",
      approval: "일정 등록과 외부 답장은 승인 후 실행",
    };
  }

  if (["쇼핑몰", "주문", "환불", "재고", "정산"].some((keyword) => text.includes(keyword))) {
    return {
      title: "주문/환불/재고 변화를 업무 카드로 정리합니다",
      trigger: `${connectors}에서 주문, 환불, 재고 부족 감지`,
      output: "확인 질문, 고객 답장 초안, 발주/정산 체크리스트",
      approval: "환불, 결제, 발주는 승인 후 실행",
    };
  }

  if (["문서", "자료", "pdf", "엑셀", "세금계산서", "견적서"].some((keyword) => text.includes(keyword))) {
    return {
      title: "자료가 들어오면 누락 항목과 보고 초안을 만듭니다",
      trigger: `${connectors}에서 파일/메일 첨부 감지`,
      output: "문서 요약, 누락 체크, 보고서 초안",
      approval: "세무/계약/공공기관 제출은 승인 후 진행",
    };
  }

  return {
    title: "문의가 오면 분류하고 답장 초안을 준비합니다",
    trigger: `${connectors}에서 새 문의 또는 메일 감지`,
    output: "문의 분류, 확인 질문, 답장 초안, 승인 카드",
    approval: "외부 발송과 일정 등록은 승인 후 실행",
  };
}

function isConnectorReady(record?: ConnectorStatusRecord) {
  if (!record) return false;
  if (record.status === "site_login_stored") return false;
  if (
    record.recovery?.kind === "install_required" ||
    record.recovery?.kind === "permission_required" ||
    record.recovery?.kind === "credential_failed" ||
    record.recovery?.kind === "connection_required"
  ) {
    return false;
  }
  return isSuccessfulConnectorStatus(record.status);
}

function isSuccessfulConnectorStatus(status?: string) {
  if (!status) return false;
  return [
    "imap_connected",
    "telegram_command_inbox_ready",
    "slack_command_inbox_ready",
    "discord_command_inbox_ready",
    "token_verified",
    "freebusy_loaded",
    "mail_loaded",
    "oauth_token_ready",
    "site_login_stored",
    "connector_ready",
    "connected",
  ].includes(status);
}

function buildReauthorizationRequirements(
  connector: ConnectorDefinition,
  record?: ConnectorStatusRecord,
): string[] {
  const items = [
    categoryLabels[connector.category],
    methodLabels[connector.method],
    connector.officialFirst ? "공식 연결 우선" : "보관함 대체 가능",
    ...connector.triggers.slice(0, 2).map((trigger) => triggerLabels[trigger]),
    ...(connector.preparation ?? []).slice(0, 3),
  ];

  if (record?.recovery?.kind === "credential_failed") {
    items.unshift("인증값 재확인");
  }
  if (record?.recovery?.kind === "permission_required") {
    items.unshift("권한 승인");
  }
  if (record?.recovery?.kind === "install_required") {
    items.unshift("설치 앱에서 점검");
  }
  if (connector.method === "site_login") {
    items.push("사이트 링크", "아이디/비밀번호는 보관함");
  }
  if (connector.method === "bot_token") {
    items.push("봇 접속 정보", "대상 채널");
  }
  if (connector.method === "oauth") {
    items.push("브라우저 로그인 승인");
  }

  return Array.from(new Set(items.filter(Boolean)));
}

function recoveryHintForConnector(record: ConnectorStatusRecord | undefined, desktopUnavailable: boolean) {
  if (!record) {
    return {
      tone: desktopUnavailable ? "preview" : "missing",
      shortLabel: desktopUnavailable ? "설치 앱 필요" : "연결 필요",
      title: desktopUnavailable ? "설치 앱에서 상태 확인" : "연결 상태 없음",
      detail: desktopUnavailable
        ? "브라우저 미리보기에서는 이 PC 보안 저장소의 연결 상태를 읽지 않습니다. 설치 앱에서 같은 계정으로 열면 실제 상태를 확인합니다."
        : "아직 저장된 연결 상태가 없습니다. 따라하기 가이드에서 계정과 권한을 연결하세요.",
      actionLabel: desktopUnavailable ? "설치 안내" : "연결 시작",
      fallbackRoutes: desktopUnavailable
        ? ["설치 앱에서 OS 보안 저장소와 로컬 앱 위치를 확인합니다."]
        : ["공식 연결이 없으면 계정 보관함에 사이트 링크와 앱 위치를 저장합니다."],
      needsVault: !desktopUnavailable,
      needsComputerUse: false,
    } as const;
  }

  const fallbackRoutes = record.recovery?.fallbackRoutes ?? [];
  const fallbackIds = record.recovery?.fallbackConnectorIds ?? [];
  const needsVault =
    fallbackIds.includes("external-account-vault") ||
    record.method === "site_login" ||
    record.recovery?.kind === "credential_failed";
  const needsComputerUse =
    fallbackIds.includes("computer-use") ||
    record.method === "site_login" ||
    fallbackRoutes.some((route) => /내 PC 작업 도우미|앱 위치|사이트 링크/u.test(route));

  if (record.status === "site_login_stored") {
    return {
      tone: "missing",
      shortLabel: "정보 저장됨",
      title: "계정 정보 저장됨 · 연결 미확인",
      detail: "계정 정보를 보관했습니다. 실제 연결과 업무 사용 가능 여부는 별도로 확인해야 합니다.",
      actionLabel: "연결 방법 확인",
      fallbackRoutes,
      needsVault,
      needsComputerUse,
    } as const;
  }

  if (record.recovery?.kind === "install_required") {
    return {
      tone: "preview",
      shortLabel: record.recovery.label || "설치 앱 필요",
      title: record.recovery.label || "설치 앱에서 상태 확인",
      detail: record.recovery.detail,
      actionLabel: record.recovery.actionLabel,
      fallbackRoutes,
      needsVault,
      needsComputerUse,
    } as const;
  }

  if (record.recovery?.kind === "permission_required") {
    return {
      tone: "permission",
      shortLabel: record.recovery.label || "권한 필요",
      title: record.recovery.label || "권한 확인 필요",
      detail: record.recovery.detail,
      actionLabel: record.recovery.actionLabel,
      fallbackRoutes,
      needsVault,
      needsComputerUse,
    } as const;
  }

  if (record.recovery?.kind === "credential_failed") {
    return {
      tone: "blocked",
      shortLabel: record.recovery.label || "인증 실패",
      title: record.recovery.label || "인증 복구 필요",
      detail: record.recovery.detail,
      actionLabel: record.recovery.actionLabel,
      fallbackRoutes,
      needsVault,
      needsComputerUse,
    } as const;
  }

  if (record.recovery?.kind === "connection_required") {
    return {
      tone: "missing",
      shortLabel: record.recovery.label || "연결 필요",
      title: record.recovery.label || "연결 확인 필요",
      detail: record.recovery.detail,
      actionLabel: record.recovery.actionLabel,
      fallbackRoutes,
      needsVault,
      needsComputerUse,
    } as const;
  }

  if (record.recovery?.kind === "ready" || isSuccessfulConnectorStatus(record.status)) {
    return {
      tone: "ready",
      shortLabel: record.recovery?.label || "연결됨",
      title: record.recovery?.label || "연결됨",
      detail: record.recovery?.detail || record.userMessage || "이 연결은 자동화 점검에 사용할 수 있습니다.",
      actionLabel: record.recovery?.actionLabel || "확인",
      fallbackRoutes,
      needsVault,
      needsComputerUse,
    } as const;
  }

  return {
    tone: "missing",
    shortLabel: "확인 필요",
    title: "연결 확인 필요",
    detail: record.userMessage || `${record.status} 상태입니다. 연결 가이드에서 다시 확인하세요.`,
    actionLabel: "연결 확인",
    fallbackRoutes,
    needsVault,
    needsComputerUse,
  } as const;
}

function upsertConnectorStatus(
  records: ConnectorStatusRecord[],
  connectorId: string,
  method: string,
  status: string,
): ConnectorStatusRecord[] {
  const nextRecord: ConnectorStatusRecord = {
    connectorId,
    method,
    status,
    lastCheckedAt: new Date().toISOString(),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  const exists = records.some((record) => record.connectorId === connectorId);
  if (!exists) return [nextRecord, ...records];
  return records.map((record) => (record.connectorId === connectorId ? nextRecord : record));
}

function makeDraftHomeHref(draftId: string, ruleId?: string) {
  const params = new URLSearchParams();
  if (typeof window !== "undefined") {
    const current = new URLSearchParams(window.location.search);
    if (current.get("preview") === "workbench") {
      params.set("preview", "workbench");
    }
  }
  params.set("draft", draftId);
  if (ruleId) {
    params.set("rule", ruleId);
    params.set("queue", "approval");
  }
  return `/?${params.toString()}`;
}

function makeHomeReturnHref(
  isWorkbenchPreview: boolean,
  ruleId?: string,
  runRule = true,
  source?: ConnectHandoffSource,
  goal?: string,
  connectedConnectorId?: string,
  setupWork?: string,
) {
  const params = new URLSearchParams();
  if (isWorkbenchPreview) {
    params.set("preview", "workbench");
  }
  if (source === "office") {
    return `/office?${params.toString()}`;
  }
  if (source === "mail-automation-notification") {
    params.set("view", "approval");
    return `/office?${params.toString()}#learned-draft-approval`;
  }
  if (source === "setup" || source === "setup-work") {
    params.set("setupStep", "2");
    params.set("from", source === "setup-work" ? "work_connection" : "ai_connection");
    if (setupWork) params.set("setupWork", setupWork);
    return `/setup?${params.toString()}`;
  }
  params.set("queue", "approval");
  if (source === "mailops-session") {
    params.set("mailOps", "1");
    if (goal) params.set("mailOpsGoal", goal);
    if (connectedConnectorId) params.set("mailOpsConnected", connectedConnectorId);
  }
  if (ruleId) {
    params.set("rule", ruleId);
    if (runRule) params.set("runRule", "1");
  }
  return `/?${params.toString()}`;
}

function makeSingleConnectorHref(
  goal: string,
  connectorId: string,
  isWorkbenchPreview: boolean,
  mode?: "read" | "write" | "send",
  ruleId?: string,
  source?: ConnectHandoffSource,
) {
  const params = new URLSearchParams();
  if (isWorkbenchPreview) {
    params.set("preview", "workbench");
  }
  params.set("intent", goal);
  params.set("connector", connectorId);
  params.set("recommend", connectorId);
  if (mode) params.set("mode", mode);
  if (ruleId) params.set("rule", ruleId);
  if (source && source !== "manual") params.set("from", source);
  return `/connect?${params.toString()}`;
}

function sendPermissionUpgradeCopy(connectorId?: string, connectorLabel?: string) {
  if (connectorId === "gmail") {
    return {
      providerLabel: "Gmail",
      actionLabel: "Gmail 발송 권한 추가",
      scopeLabel: "Gmail send 권한",
      scopeValue: "https://www.googleapis.com/auth/gmail.send",
      scopeDetail: "Gmail 읽기 연결과 분리해 최종 발송 권한만 추가합니다.",
    };
  }
  if (connectorId === "outlook") {
    return {
      providerLabel: "Outlook",
      actionLabel: "Outlook 발송 권한 추가",
      scopeLabel: "Microsoft Mail.Send 권한",
      scopeValue: "Mail.Send",
      scopeDetail: "Microsoft Graph 발송 권한을 최종 확인 단계에서만 씁니다.",
    };
  }
  if (connectorId === "company-mail") {
    return {
      providerLabel: "회사/일반 메일",
      actionLabel: "회사 메일 SMTP 확인",
      scopeLabel: "SMTP 발송 설정",
      scopeValue: "smtp_send_enabled",
      scopeDetail: "IMAP 읽기와 별개로 SMTP 발송 설정을 확인합니다.",
    };
  }
  return {
    providerLabel: connectorLabel ?? "메일",
    actionLabel: `${connectorLabel ?? "메일"} 발송 권한 추가`,
    scopeLabel: "메일 발송 권한",
    scopeValue: "mail_send_scope_required",
    scopeDetail: "현재 메일 공급자의 발송 권한을 확인한 뒤 오피스로 돌아갑니다.",
  };
}

function isCurrentWorkbenchPreview() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("preview") === "workbench";
}

function adapterLabel(adapterId: string) {
  if (adapterId === "mody_direct") return "앱으로 직접 받기";
  if (adapterId === "generic_form") return "일반 문의 폼";
  if (adapterId === "chat_message") return "개인 채팅";
  if (adapterId === "channel_talk") return "채널톡";
  if (adapterId === "naver_talktalk") return "네이버 톡톡";
  if (adapterId === "booking_update") return "예약 변경";
  if (adapterId === "commerce_order") return "주문/정산";
  return "연결 방식";
}
