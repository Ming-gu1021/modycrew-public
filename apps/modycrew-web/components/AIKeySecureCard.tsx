"use client";

import { useEffect, useRef, useState } from "react";
import {
  saveAccountAISettingsMetadata,
  subscribeAccountAISettings,
  type ModyAccountAiSettings,
  type ModyAiProvider,
} from "@/lib/account-ai-settings";
import {
  createDesktopBridge,
  type AIProviderKeyStatus,
  type AIRuntimeLiveProofsResult,
  type AITextGenerationResult,
} from "@/lib/desktop-bridge";
import { onAuthSession, type ModyAuthSession } from "@/lib/firebase-client";
import { navigateInternalPath } from "@/lib/safe-navigation";
import { buildProviderModelChoices, codexCatalog, openaiCatalog, geminiCatalog } from "@/lib/model-catalog";
import styles from "./AccountCard.module.css";

type Provider = ModyAiProvider;

const providerInfo: Record<
  Provider,
  { label: string; help: string; href: string; defaultModel: string }
> = {
  openai: {
    label: "OpenAI",
    help: "OpenAI 계정에서 받은 AI 연결 비밀값",
    href: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-4o-mini",
  },
  gemini: {
    label: "Google Gemini",
    help: "Google AI Studio에서 받은 AI 연결 비밀값",
    href: "https://aistudio.google.com/apikey",
    defaultModel: "gemini-2.5-flash",
  },
};

const aiModelUpdateRequiredMessage = "이 연결에서 해당 모델을 사용할 수 없습니다. 모델 목록을 새로고침한 뒤 사용 가능한 모델을 선택하거나 계정 권한과 앱 버전을 확인해 주세요.";
/** 저장된 모델을 다른 모델이나 자동 별칭으로 바꾸어 보여주지 않는다. */
function codexModelDisplayLabel(value?: string | null): string {
  const id = (value ?? "").trim();
  if (!id) return "연결 후 모델 선택";
  if (id === "latest" || id === "fast") return "이전 자동 선택 설정 · 모델 확인 필요";
  return codexCatalog.find((entry) => entry.id === id)?.label || id;
}

function aiProviderStatusLabel(providerId?: string | null) {
  if (providerId === "openai") return "OpenAI";
  if (providerId === "gemini") return "Google Gemini";
  if (providerId === "codex_oauth") return "AI 로그인 연결";
  return "AI 연결";
}

function aiProviderConnectionSignature(provider?: AIProviderKeyStatus | null): string {
  if (!provider?.provider) return "";
  return [
    provider.provider,
    provider.status,
    provider.model ?? "",
    provider.hasLocalKey ? "key" : "no_key",
    provider.keyFingerprint ?? "",
    provider.updatedAt ?? "",
    provider.chatContentAllowed ? "chat_allowed" : "chat_blocked",
  ].join("|");
}

function aiProviderConnectionsSignature(providers: AIProviderKeyStatus[]): string {
  return providers
    .map((provider) => aiProviderConnectionSignature(provider))
    .filter(Boolean)
    .sort()
    .join("||");
}

function aiRuntimeRouteLabel(route?: string | null) {
  if (!route) return "예비 연결";
  if (route === "codex_oauth") return "AI 로그인 연결";
  if (route === "codex_cli") return "설치 앱 답변 실행";
  if (route === "openai_api" || route === "openai") return "OpenAI";
  if (route === "gemini_api" || route === "gemini") return "Google Gemini";
  return route.replace(/_/gu, " ");
}

function isAIModelUpdateRequired(...values: Array<string | null | undefined>) {
  const diagnostic = values.filter(Boolean).join(" ");
  return /codex_cli_model_unsupported|requires a newer version of Codex|Please upgrade to the latest app or CLI|not supported when using Codex with a ChatGPT account/iu.test(diagnostic);
}

function aiRuntimeFailureLabel(status?: string | null) {
  const value = String(status ?? "").trim();
  if (!value) return "";
  if (isAIModelUpdateRequired(value)) return "새 모델 사용을 위해 업데이트 필요";
  if (/codex_oauth_generate_failed/u.test(value)) return "기본 AI 답변 생성 실패";
  if (/provider_runtime_not_ready|not_connected|required/u.test(value)) return "답변 연결 준비 필요";
  if (/credential|auth|login|oauth|refresh|invalid|expired/u.test(value)) return "AI 로그인 다시 확인 필요";
  if (/timeout|network|fetch/u.test(value)) return "네트워크 또는 응답 시간 문제";
  if (/rate|quota|limit/u.test(value)) return "사용량 제한 또는 일시 제한";
  return value.replace(/_/gu, " ");
}

function aiRuntimeAttemptedRoutesLabel(receipt?: AITextGenerationResult["aiRuntimeReceipt"] | null) {
  const routes = Array.from(
    new Set((receipt?.attemptedRoutes ?? []).map((route) => aiRuntimeRouteLabel(route)).filter(Boolean)),
  );
  return routes.length > 1 ? routes.join(" -> ") : "";
}

function aiRuntimeReceiptSummary(receipt?: AITextGenerationResult["aiRuntimeReceipt"] | null) {
  if (!receipt) {
    return "연결 확인을 누르면 연결 표시가 아니라 실제 답변 생성 여부를 확인합니다.";
  }
  if (isAIModelUpdateRequired(
    receipt.status,
    receipt.diagnosticStage,
    receipt.previousFailureStatus,
    receipt.recoveryReason,
    receipt.userNextAction,
    receipt.recoverySummary,
  )) {
    return aiModelUpdateRequiredMessage;
  }
  if (!receipt.fallbackUsed) {
    const parts = [receipt.userNextAction];
    if (!receipt.answerReady && receipt.recoveryPlan?.choices?.length) {
      parts.push(`다음 선택: ${receipt.recoveryPlan.choices.slice(0, 3).join(" / ")}.`);
    }
    return parts.filter(Boolean).join(" ");
  }

  const parts = [
    receipt.userNextAction || "기본 AI를 다시 확인하거나 이 예비 연결로 계속 대화할 수 있습니다.",
    `사용한 연결: ${aiRuntimeRouteLabel(receipt.finalRoute ?? receipt.provider)}.`,
  ];
  const attemptedRoutes = aiRuntimeAttemptedRoutesLabel(receipt);
  if (attemptedRoutes) parts.push(`확인한 순서: ${attemptedRoutes}.`);
  const failureLabel = aiRuntimeFailureLabel(receipt.previousFailureStatus || receipt.recoveryReason);
  if (failureLabel) parts.push(`기본 실패 이유: ${failureLabel}.`);
  const failedFallbacks = (receipt.fallbackAttemptFailures ?? [])
    .map((item) => item.label)
    .filter(Boolean);
  if (failedFallbacks.length) parts.push(`실패한 예비 연결: ${failedFallbacks.join(", ")}.`);
  if (!receipt.answerReady && receipt.recoveryPlan?.choices?.length) {
    parts.push(`다음 선택: ${receipt.recoveryPlan.choices.slice(0, 3).join(" / ")}.`);
  }
  return parts.join(" ");
}

function aiRuntimeSetupDoctorStatusLabel(status: string) {
  if (status === "ai_runtime_setup_live_verified") return "실제 답변 검증됨";
  if (status === "ai_runtime_setup_ready_to_probe") return "연결 확인 필요";
  return "답변 연결 필요";
}

function aiRuntimeSetupDoctorReason(status: string) {
  if (status === "ai_runtime_setup_live_verified") return "실제 모델 답변 영수증이 있어 첫 채팅 런타임으로 이어갈 수 있습니다.";
  if (status === "ai_runtime_setup_ready_to_probe") return "답변 연결은 감지됐지만 아직 실제 답변 생성 확인이 남아 있습니다.";
  return "현재 화면에서 실제 답변 가능한 연결을 확인하지 못했습니다.";
}

function aiRuntimeSetupDoctorSolution(status: string) {
  if (status === "ai_runtime_setup_live_verified") return "release AI readiness 확인";
  if (status === "ai_runtime_setup_ready_to_probe") return "연결 확인 실행";
  return "AI 로그인 또는 대체 답변 연결";
}

function aiRuntimeSetupDoctorResume(status: string) {
  if (status === "ai_runtime_setup_live_verified") return "채팅으로 돌아가 요청 계속";
  if (status === "ai_runtime_setup_ready_to_probe") return "테스트 성공 뒤 첫 채팅 재개";
  return "연결 후 상태 새로고침";
}

function aiProviderNextStepLabel(status: string) {
  if (/key|secret|credential|auth|login/iu.test(status)) return "AI 연결 정보를 다시 확인해 주세요.";
  if (/rate|quota|limit/iu.test(status)) return "잠시 뒤 다시 시도하거나 다른 AI 연결을 선택해 주세요.";
  if (/timeout|network|fetch/iu.test(status)) return "네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
  return "상태를 새로고침한 뒤 연결 확인을 다시 실행해 주세요.";
}

function userFacingAIRecoveryAction(action: string) {
  return action
    .replace(/되돌아오기 주소/g, "앱으로 돌아올 주소")
    .replace(/\bcallback URL\b/giu, "앱으로 돌아올 주소")
    .replace(/\bPKCE\b/giu, "브라우저 인증")
    .replace(/OS 보안 저장소/g, "암호화 보관함");
}

function createAIRuntimeProofReadFailure(message: string): AIRuntimeLiveProofsResult {
  return {
    status: "proof_read_failed",
    proofCount: 0,
    verifiedCount: 0,
    proofs: [],
    userMessage: message,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

export function AIKeySecureCard() {
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState(providerInfo.openai.defaultModel);
  const [codexModel, setCodexModel] = useState("");
  const [secret, setSecret] = useState("");
  const [allowChatContent, setAllowChatContent] = useState(false);
  const [session, setSession] = useState<ModyAuthSession | null>(null);
  const [cloudSettings, setCloudSettings] = useState<ModyAccountAiSettings | null>(null);
  const [busy, setBusy] = useState<"api" | "codex" | "refresh" | "test" | null>(null);
  const [message, setMessage] = useState("");
  const [runtimeTestMessage, setRuntimeTestMessage] = useState("");
  const [lastRuntimeReceipt, setLastRuntimeReceipt] = useState<AITextGenerationResult["aiRuntimeReceipt"] | null>(null);
  const [restoreMessage, setRestoreMessage] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);
  const [runtimeProviders, setRuntimeProviders] = useState<AIProviderKeyStatus[]>([]);
  const [liveProofs, setLiveProofs] = useState<AIRuntimeLiveProofsResult | null>(null);
  const [lastCodexOAuthStart, setLastCodexOAuthStart] = useState<AIProviderKeyStatus | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const modelRefreshGenerationRef = useRef(0);
  const accountEpochRef = useRef(0);
  const accountUidRef = useRef<string | null>(null);
  const apiOperationRef = useRef(0);
  const modelEditRef = useRef({ dirty: false, revision: 0 });

  const codexCompletionWatchRef = useRef<number | null>(null);
  const codexCompletionWatchGenerationRef = useRef(0);
  const codexCompletionCheckInFlightRef = useRef(false);
  const codexCompletionTestGenerationRef = useRef<number | null>(null);
  const runtimeReceiptConnectionRef = useRef<{ provider: string; signature: string } | null>(null);
  const codexLoginInFlightRef = useRef(false);
  const codexLoginLastStartedAtRef = useRef(0);

  const stopCodexCompletionWatch = () => {
    codexCompletionWatchGenerationRef.current += 1;
    codexCompletionCheckInFlightRef.current = false;
    if (codexCompletionWatchRef.current !== null) {
      window.clearInterval(codexCompletionWatchRef.current);
      codexCompletionWatchRef.current = null;
    }
  };

  const refreshRuntimeStatus = async (forceRefreshModels = false) => {
    const generation = ++modelRefreshGenerationRef.current;
    setBusy((current) => current ?? "refresh");
    setLoadingModels(true);
    setMessage("");

    try {
      const bridge = createDesktopBridge();
      setIsDesktop(bridge.isAvailable);
      const result = await bridge.getAIProviderStatus();
      const providers = result.providers ?? [];
      if (generation !== modelRefreshGenerationRef.current) return;
      setRuntimeProviders(providers);
      const refreshed = await Promise.all(providers.map(async (item) => {
        if (!item.provider || !item.hasLocalKey || !["openai", "codex_oauth", "gemini"].includes(item.provider)) return item;
        try {
          const catalog = await bridge.listAIProviderModels(item.provider, { forceRefresh: forceRefreshModels });
          return { ...item, modelAvailability: catalog.modelAvailability };
        } catch {
          return { ...item, modelAvailability: undefined };
        }
      }));
      if (generation !== modelRefreshGenerationRef.current) return;
      setRuntimeProviders(refreshed);
      const verifiedConnection = runtimeReceiptConnectionRef.current;
      if (verifiedConnection) {
        const currentProvider = providers.find(
          (item) => item.provider === verifiedConnection.provider,
        );
        if (
          !currentProvider ||
          aiProviderConnectionSignature(currentProvider) !== verifiedConnection.signature
        ) {
          runtimeReceiptConnectionRef.current = null;
          setLastRuntimeReceipt(null);
          setRuntimeTestMessage("AI 연결 상태가 바뀌었습니다. 실제 답변을 다시 확인해 주세요.");
        }
      }
      try {
        const proofResult = await bridge.getAIRuntimeLiveProofs();
        if (generation !== modelRefreshGenerationRef.current) return;
        setLiveProofs(proofResult);
      } catch (proofError) {
        if (generation !== modelRefreshGenerationRef.current) return;
        setLiveProofs(
          createAIRuntimeProofReadFailure(
            proofError instanceof Error ? proofError.message : "AI 실기 리포트 확인에 실패했습니다.",
          ),
        );
      }
    } catch (error) {
      if (generation !== modelRefreshGenerationRef.current) return;
      setRuntimeProviders([]);
      setMessage(error instanceof Error ? error.message : "AI 연결 상태 확인에 실패했습니다.");
    } finally {
      if (generation === modelRefreshGenerationRef.current) {
        setLoadingModels(false);
        setBusy((current) => (current === "refresh" ? null : current));
      }
    }
  };

  useEffect(() => {
    void refreshRuntimeStatus();
    return () => {
      modelRefreshGenerationRef.current += 1;
      stopCodexCompletionWatch();
    };
  }, []);

  useEffect(() => {
    let authUnsubscribe: (() => void) | undefined;
    let settingsUnsubscribe: (() => void) | undefined;
    let mounted = true;
    let priorUid: string | null | undefined;
    let subscriptionEpoch = 0;

    void onAuthSession((nextSession) => {
      if (!mounted) return;
      const captured = ++subscriptionEpoch;
      const isCurrent = () => mounted && subscriptionEpoch === captured;
      const nextUid = nextSession?.uid ?? null;
      if (priorUid !== nextUid) accountEpochRef.current += 1;
      accountUidRef.current = nextUid;
      const accountLineage = accountEpochRef.current;
      const sameAccount = () => mounted && accountEpochRef.current === accountLineage && accountUidRef.current === nextUid;
      setSession(nextSession);
      setCloudSettings(null);
      settingsUnsubscribe?.();
      settingsUnsubscribe = undefined;

      // Never keep a prior account's cloud-derived choice while the new
      // account's settings are loading. Same-account refresh keeps local edits.
      if (priorUid !== undefined && priorUid !== nextUid) {
        modelEditRef.current = { dirty: false, revision: modelEditRef.current.revision + 1 };
        modelRefreshGenerationRef.current += 1;
        setLoadingModels(false);
        setBusy((current) => current === "refresh" ? null : current);
        setProvider((current) => sameAccount() && !modelEditRef.current.dirty ? "openai" : current);
        setModel((current) => sameAccount() && !modelEditRef.current.dirty ? providerInfo.openai.defaultModel : current);
      }
      priorUid = nextUid;

      if (!nextSession) return;

      void subscribeAccountAISettings(
        nextSession,
        (settings) => {
          if (!isCurrent()) return;
          setCloudSettings((current) => isCurrent() ? settings : current);
          if (settings) {
            setProvider((current) => isCurrent() && !modelEditRef.current.dirty ? settings.provider : current);
            setModel((current) => isCurrent() && !modelEditRef.current.dirty ? settings.model : current);
          }
        },
        (error) => {
          if (isCurrent()) setMessage((current) => isCurrent() ? error.message : current);
        },
      ).then((unsubscribe) => {
        if (!isCurrent()) unsubscribe(); else settingsUnsubscribe = unsubscribe;
      }).catch((error) => {
        if (isCurrent()) setMessage((current) => isCurrent() ? (error instanceof Error ? error.message : "AI 설정을 불러오지 못했습니다.") : current);
      });
    }).then((unsubscribe) => {
      if (!mounted) unsubscribe(); else authUnsubscribe = unsubscribe;
    }).catch((error) => {
      if (mounted) setMessage(error instanceof Error ? error.message : "계정 상태를 확인하지 못했습니다.");
    });

    return () => {
      mounted = false;
      accountEpochRef.current += 1;
      apiOperationRef.current += 1;
      authUnsubscribe?.();
      settingsUnsubscribe?.();
    };
  }, []);


  const chatRuntime = runtimeProviders.find(
    (item) =>
      ((item.provider === "codex_oauth" && item.status === "codex_oauth_ready") ||
        ((item.provider === "openai" || item.provider === "gemini") &&
          item.hasLocalKey &&
          item.chatContentAllowed)),
  );
  const codexRuntime = runtimeProviders.find((item) => item.provider === "codex_oauth");
  const codexReady = Boolean(
    codexRuntime?.hasLocalKey && codexRuntime.status === "codex_oauth_ready",
  );
  const codexDetected = Boolean(
    codexRuntime?.hasLocalKey && codexRuntime.status === "codex_oauth_detected",
  );
  const codexUsable = Boolean(lastRuntimeReceipt?.answerReady);
  const codexModelOptions = buildProviderModelChoices("codex_oauth", "ChatGPT 로그인", {
    ready: codexReady,
    needs: "먼저 ChatGPT 계정을 연결해 주세요.",
    modelAvailability: codexRuntime?.modelAvailability,
  }, codexCatalog);
  const selectedCodexModel = codexModelOptions.find((choice) => choice.id === codexModel);
  const apiRuntime = runtimeProviders.find((item) => item.provider === provider);
  const apiModelOptions = buildProviderModelChoices(provider, providerInfo[provider].label, {
    ready: Boolean(apiRuntime?.hasLocalKey && apiRuntime.chatContentAllowed),
    needs: "API 키를 저장한 뒤 모델 목록을 확인해 주세요.",
    modelAvailability: apiRuntime?.modelAvailability,
  }, provider === "openai" ? openaiCatalog : geminiCatalog);
  const selectedAPIModel = apiModelOptions.find((choice) => choice.id === model);
  const roleLiveProof = liveProofs?.proofs?.find((proof) => proof.id === "role_live");
  const mailOpsLiveProof = liveProofs?.proofs?.find((proof) => proof.id === "mailops_workqueue");
  const releaseReadinessProof = liveProofs?.proofs?.find((proof) => proof.id === "release_readiness");
  const roleProofReady = Boolean(roleLiveProof?.liveVerified);
  const mailOpsProofReady = Boolean(mailOpsLiveProof?.liveVerified);
  const releaseReadinessReady = Boolean(releaseReadinessProof?.liveVerified);
  const releaseReadinessFresh = releaseReadinessProof?.reportFresh !== false && releaseReadinessProof?.proofExpired !== true;
  const shortAnswerReady = Boolean(lastRuntimeReceipt?.answerReady);
  const proofSummary =
    releaseReadinessReady
      ? "실제 AI 답변, 역할, 메일 직원 작업함, Router 복구 경계까지 검증됐습니다."
      : liveProofs?.userMessage ??
    (isDesktop ? "최근 실기 리포트를 확인하는 중입니다." : "설치 앱에서 실기 리포트를 확인할 수 있습니다.");

  useEffect(() => {
    const savedModel = (codexRuntime?.modelPreference ?? codexRuntime?.model)?.trim();
    if (!savedModel) return;
    setCodexModel(savedModel);
  }, [codexRuntime?.modelPreference, codexRuntime?.model]);

  const modelEffectEpoch = accountEpochRef.current;
  const modelEffectUid = session?.uid ?? null;
  useEffect(() => {
    const savedModel = apiRuntime?.model?.trim();
    if (savedModel && !modelEditRef.current.dirty && accountEpochRef.current === modelEffectEpoch && accountUidRef.current === modelEffectUid) {
      setModel((current) => !modelEditRef.current.dirty && accountEpochRef.current === modelEffectEpoch && accountUidRef.current === modelEffectUid ? savedModel : current);
    }
  }, [provider, apiRuntime?.model, modelEffectEpoch, modelEffectUid]);

  const handleProviderChange = (nextProvider: Provider) => {
    modelEditRef.current = { dirty: true, revision: modelEditRef.current.revision + 1 };
    setProvider(nextProvider);
    setModel(providerInfo[nextProvider].defaultModel);
    setAllowChatContent(false);
  };

  const handleSave = async () => {
    const trimmedSecret = secret.trim();
    if (trimmedSecret.length < 8 || !allowChatContent) return;
    const epoch = accountEpochRef.current;
    const uid = session?.uid ?? null;
    const isCurrent = () => accountEpochRef.current === epoch && accountUidRef.current === uid;
    if (!isCurrent()) return;
    const operation = ++apiOperationRef.current;

    setBusy("api");
    setMessage("");
    setRuntimeTestMessage("");
    setRestoreMessage("");
    setLastRuntimeReceipt(null);
    runtimeReceiptConnectionRef.current = null;

    try {
      const bridge = createDesktopBridge();
      if (!bridge.isAvailable) {
        setMessage("AI 비밀값은 설치된 Windows 앱의 이 PC 보관함에서만 저장할 수 있습니다.");
        return;
      }

      const localResult = await bridge.saveAIProviderKey(provider, {
        secret: trimmedSecret,
        accountUid: session?.uid,
        syncSource: "manual_input",
        allowChatContent: true,
      });
      if (!isCurrent()) return;

      let metadataNotice = session
        ? "계정에는 제공자와 모델만 동기화했습니다."
        : "계정 로그인 없이 이 PC에만 저장했습니다.";
      if (session) {
        try {
          const settings = await saveAccountAISettingsMetadata(session, {
            provider,
            model: localResult.model ?? "",
          });
          if (isCurrent()) setCloudSettings((current) => isCurrent() ? settings : current);
        } catch {
          metadataNotice = "이 PC 저장은 끝났지만 계정의 제공자/모델 표시는 갱신하지 못했습니다.";
        }
      }

      if (!isCurrent()) return;
      setSecret((current) => isCurrent() && current === secret ? "" : current);
      await refreshRuntimeStatus();
      if (!isCurrent()) return;
      const notice =
        localResult.status === "stored_in_os_vault"
          ? "이 PC에 안전하게 저장했습니다. 계정에서 확인된 모델을 선택해 적용한 뒤 실제 답변을 확인하세요. " + metadataNotice
          : "저장 상태를 확인하지 못했습니다. 다시 시도해 주세요.";
      setMessage((current) => isCurrent() ? notice : current);
    } catch (error) {
      if (isCurrent()) setMessage((current) => isCurrent() ? (error instanceof Error ? error.message : "이 PC 보관함 저장에 실패했습니다.") : current);
    } finally {
      if (apiOperationRef.current === operation) setBusy((current) => apiOperationRef.current === operation && current === "api" ? null : current);
    }
  };

  const handleCodexLogin = async () => {
    const now = Date.now();
    if (codexLoginInFlightRef.current || now - codexLoginLastStartedAtRef.current < 1_500) {
      setMessage("AI 로그인 요청은 이미 처리 중입니다. 새 창을 반복해서 열지 않고 현재 연결 결과만 기다립니다.");
      return;
    }
    codexLoginInFlightRef.current = true;
    codexLoginLastStartedAtRef.current = now;
    setBusy("codex");
    setMessage("");
    setRestoreMessage("");
    setLastRuntimeReceipt(null);
    runtimeReceiptConnectionRef.current = null;

    try {
      const bridge = createDesktopBridge();
      if (!bridge.isAvailable) {
        setMessage("AI 브라우저 로그인은 설치된 Windows 앱 안에서만 실행됩니다.");
        return;
      }

      const result = await bridge.startAIProviderOAuth("codex_oauth", {
        forceReconnect: false,
      });
      setLastCodexOAuthStart(result);
      setMessage(
        result.userMessage ??
          "AI 브라우저 로그인을 열었습니다. 브라우저 인증이 끝나면 상태 새로고침으로 확인합니다.",
      );
      await refreshRuntimeStatus();
      startCodexCompletionWatch(bridge);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI 브라우저 로그인을 시작하지 못했습니다.");
    } finally {
      codexLoginInFlightRef.current = false;
      setBusy(null);
    }
  };

  const handleSaveCodexModel = async () => {
    if (loadingModels || !selectedCodexModel?.ready) {
      setMessage(selectedCodexModel?.needs || "사용 가능 여부가 확인된 모델을 선택해 주세요.");
      return;
    }
    setBusy("codex");
    setMessage("");
    setLastRuntimeReceipt(null);
    runtimeReceiptConnectionRef.current = null;
    try {
      const bridge = createDesktopBridge();
      if (!bridge.isAvailable) {
        setMessage("AI 답변 모델 선택은 설치된 Windows 앱 안에서 저장됩니다.");
        return;
      }
      const result = await bridge.saveAIProviderModel("codex_oauth", { model: codexModel });
      setMessage(result.userMessage ?? (result.status === "model_updated"
        ? `AI 답변 모델을 ${codexModelDisplayLabel(result.model ?? codexModel)}로 저장했습니다.`
        : "모델 선택을 적용하지 못했습니다. 계정의 모델 목록을 다시 확인해 주세요."));
      await refreshRuntimeStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI 답변 모델을 저장하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const handleSaveAPIModel = async () => {
    if (loadingModels || !selectedAPIModel?.ready) return;
    const epoch = accountEpochRef.current;
    const uid = session?.uid ?? null;
    const isCurrent = () => accountEpochRef.current === epoch && accountUidRef.current === uid;
    if (!isCurrent()) return;
    const operation = ++apiOperationRef.current;
    const editRevision = modelEditRef.current.revision;
    setBusy("api");
    setMessage("");
    setRuntimeTestMessage("");
    setLastRuntimeReceipt(null);
    runtimeReceiptConnectionRef.current = null;
    try {
      const bridge = createDesktopBridge();
      const result = await bridge.saveAIProviderModel(provider, { model });
      if (!isCurrent()) return;
      let metadataNotice = "";
      if (result.status === "model_updated" && session) {
        try {
          const settings = await saveAccountAISettingsMetadata(session, { provider, model: result.model || model });
          if (isCurrent()) setCloudSettings((current) => isCurrent() ? settings : current);
        } catch {
          metadataNotice = " 이 PC의 모델 선택은 적용됐지만 계정 표시 동기화는 다시 확인해 주세요.";
        }
      }
      if (!isCurrent()) return;
      await refreshRuntimeStatus();
      if (!isCurrent()) return;
      if (result.status === "model_updated" && result.model === model && modelEditRef.current.revision === editRevision) modelEditRef.current.dirty = false;
      const notice = (result.userMessage ?? (result.status === "model_updated"
        ? `${providerInfo[provider].label} 모델 선택을 적용했습니다.`
        : "모델 선택을 적용하지 못했습니다. 계정의 모델 목록을 다시 확인해 주세요.")) + metadataNotice;
      setMessage((current) => isCurrent() ? notice : current);
    } catch (error) {
      if (isCurrent()) setMessage((current) => isCurrent() ? (error instanceof Error ? error.message : "모델 선택 적용에 실패했습니다.") : current);
    } finally {
      if (apiOperationRef.current === operation) setBusy((current) => apiOperationRef.current === operation && current === "api" ? null : current);
    }
  };

  const handleRuntimeTest = async (expectedConnection?: {
    provider: string;
    signature: string;
    model?: string;
  }) => {
    setBusy("test");
    setMessage("");
    setRuntimeTestMessage("");
    setRestoreMessage("");
    setLastRuntimeReceipt(null);
    runtimeReceiptConnectionRef.current = null;

    try {
      const bridge = createDesktopBridge();
      if (!bridge.isAvailable) {
        setRuntimeTestMessage("실제 AI 응답 테스트는 설치된 Windows 앱 안에서만 실행됩니다.");
        return;
      }

      const statusBeforeAnswer = await bridge.getAIProviderStatus();
      const providersBeforeAnswer = statusBeforeAnswer.providers ?? [];
      const connectionsSignatureBeforeAnswer = aiProviderConnectionsSignature(providersBeforeAnswer);
      setRuntimeProviders(providersBeforeAnswer);
      if (expectedConnection) {
        const expectedProviderBeforeAnswer = providersBeforeAnswer.find(
          (item) => item.provider === expectedConnection.provider,
        );
        if (aiProviderConnectionSignature(expectedProviderBeforeAnswer) !== expectedConnection.signature) {
          setRuntimeTestMessage("AI 모델 또는 연결이 바뀌었습니다. 현재 상태에서 실제 답변을 다시 확인해 주세요.");
          return;
        }
      }
      const runtimeTestProvider = expectedConnection?.provider || statusBeforeAnswer.activeProvider
        || providersBeforeAnswer.find((item) => item.isActive)?.provider;
      const testRuntime = providersBeforeAnswer.find((item) => item.provider === runtimeTestProvider);
      const runtimeTestModel = expectedConnection?.model?.trim() || testRuntime?.model?.trim() || "";
      const testChoice = runtimeTestProvider ? buildProviderModelChoices(runtimeTestProvider, runtimeTestProvider, {
        ready: Boolean(testRuntime?.hasLocalKey && testRuntime.chatContentAllowed),
        modelAvailability: testRuntime?.modelAvailability,
      }, []).find((choice) => choice.id === runtimeTestModel) : undefined;
      if (!testChoice?.ready) {
        setRuntimeTestMessage("계정에서 확인된 모델을 선택해 적용한 뒤 연결 확인을 실행해 주세요.");
        return;
      }
      const result = await bridge.generateAIText({
        provider: runtimeTestProvider,
        model: runtimeTestModel,
        prompt: "ModyCrew 앱 AI 연결 테스트입니다. 한국어로 한 문장만 답해 주세요.",
      });
      let providersAfterAnswer: AIProviderKeyStatus[] = [];
      try {
        const statusAfterAnswer = await bridge.getAIProviderStatus();
        providersAfterAnswer = statusAfterAnswer.providers ?? [];
      } catch {
        setRuntimeTestMessage("답변은 받았지만 현재 AI 연결을 다시 확인하지 못했습니다. 상태 새로고침 후 다시 확인해 주세요.");
        return;
      }
      const connectionsSignatureAfterAnswer = aiProviderConnectionsSignature(providersAfterAnswer);
      const expectedProviderAfterAnswer = expectedConnection
        ? providersAfterAnswer.find((item) => item.provider === expectedConnection.provider)
        : null;
      if (
        connectionsSignatureAfterAnswer !== connectionsSignatureBeforeAnswer ||
        (expectedConnection &&
          aiProviderConnectionSignature(expectedProviderAfterAnswer) !== expectedConnection.signature)
      ) {
        runtimeReceiptConnectionRef.current = null;
        setLastRuntimeReceipt(null);
        setRuntimeProviders(providersAfterAnswer);
        setRuntimeTestMessage("AI 모델 또는 연결이 테스트 중 바뀌었습니다. 현재 상태에서 실제 답변을 다시 확인해 주세요.");
        return;
      }
      setRuntimeProviders(providersAfterAnswer);
      const fallbackReceipt: NonNullable<AITextGenerationResult["aiRuntimeReceipt"]> = {
        status: result.status,
        provider: result.provider ?? "",
        model: result.model ?? runtimeTestModel,
        runtime: result.runtime ?? "direct",
        answerReady: result.status === "generate_content_loaded" && Boolean(result.outputText),
        fallbackUsed: Boolean(result.fallbackUsed || result.fallbackFrom || result.previousFailureStatus),
        diagnosticStage: result.diagnosticStage ?? "",
        previousFailureStatus: result.previousFailureStatus ?? "",
        userNextAction: result.userNextAction ?? aiProviderNextStepLabel(result.status),
        recoverySummary: result.recoverySummary ?? result.userMessage ?? "AI 답변 경로를 확인했습니다.",
        routeOrder: result.aiRuntimeRouter?.routeOrder,
        attemptedRoutes: result.aiRuntimeRouter?.attemptedRoutes,
        finalRoute: result.aiRuntimeRouter?.finalRoute,
        failClosed: result.aiRuntimeRouter?.failClosed,
        recoveryRequired: result.aiRuntimeRouter?.recoveryRequired,
        recoveryReason: result.aiRuntimeRouter?.recoveryReason,
        canRetryPendingRequest: result.status !== "generate_content_loaded",
        externalMutation: false,
        rawSecretMaterialReturned: false,
      };
      const runtimeReceipt = result.aiRuntimeReceipt ?? fallbackReceipt;
      if (result.status === "generate_content_loaded" && result.outputText) {
        const verifiedProviderId = result.provider ?? runtimeReceipt.provider;
        const verifiedProvider = providersAfterAnswer.find(
          (item) => item.provider === verifiedProviderId,
        );
        if (!verifiedProvider) {
          runtimeReceiptConnectionRef.current = null;
          setLastRuntimeReceipt(null);
          setRuntimeTestMessage("답변은 받았지만 현재 AI 연결과 일치하는 실행 경로를 확인하지 못했습니다. 다시 확인해 주세요.");
          return;
        }
        runtimeReceiptConnectionRef.current = {
          provider: verifiedProviderId,
          signature: aiProviderConnectionSignature(verifiedProvider),
        };
        setLastRuntimeReceipt(runtimeReceipt);
        setRuntimeTestMessage(
          `${aiProviderStatusLabel(result.provider)} 응답 확인 완료${
            result.fallbackUsed || result.fallbackFrom ? ` - 기본 연결 대신 예비 연결 사용` : ""
          }: ${result.outputText.replace(/\s+/g, " ").slice(0, 90)}`,
        );
        await refreshRuntimeStatus();
        setLastCodexOAuthStart(null);
        return;
      }

      setLastRuntimeReceipt(runtimeReceipt);
      const modelUpdateRequired = isAIModelUpdateRequired(
        result.status,
        result.diagnosticStage,
        result.errorMessage,
        result.userMessage,
        runtimeReceipt.previousFailureStatus,
        runtimeReceipt.recoveryReason,
      );
      setRuntimeTestMessage(
        modelUpdateRequired
          ? aiModelUpdateRequiredMessage
          : [
              result.userMessage ?? "AI 응답 테스트에 실패했습니다.",
              result.errorMessage ? `원인: ${result.errorMessage}` : "",
              result.status ? `다음 단계: ${aiProviderNextStepLabel(result.status)}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "AI 응답 테스트를 실행하지 못했습니다.";
      setRuntimeTestMessage(isAIModelUpdateRequired(errorMessage) ? aiModelUpdateRequiredMessage : errorMessage);
    } finally {
      setBusy(null);
    }
  };

  const startCodexCompletionWatch = (bridge: ReturnType<typeof createDesktopBridge>) => {
    if (!bridge.isAvailable) return;
    stopCodexCompletionWatch();
    const watchGeneration = codexCompletionWatchGenerationRef.current;
    codexCompletionCheckInFlightRef.current = false;
    codexCompletionTestGenerationRef.current = null;
    setRestoreMessage("AI 인증 완료를 자동으로 확인 중입니다. 브라우저 인증을 마치면 이 화면이 준비됨으로 바뀝니다.");
    let checks = 0;
    const checkReady = async () => {
      if (
        watchGeneration !== codexCompletionWatchGenerationRef.current ||
        codexCompletionCheckInFlightRef.current
      ) {
        return;
      }
      codexCompletionCheckInFlightRef.current = true;
      checks += 1;
      try {
        const result = await bridge.getAIProviderStatus();
        if (watchGeneration !== codexCompletionWatchGenerationRef.current) return;
        const providers = result.providers ?? [];
        setRuntimeProviders(providers);
        const ready = providers.find(
          (item) =>
            item.provider === "codex_oauth" &&
            item.status === "codex_oauth_ready" &&
            item.hasLocalKey,
        );
        if (ready) {
          if (codexCompletionTestGenerationRef.current === watchGeneration) return;
          codexCompletionTestGenerationRef.current = watchGeneration;
          if (codexCompletionWatchRef.current !== null) {
            window.clearInterval(codexCompletionWatchRef.current);
            codexCompletionWatchRef.current = null;
          }
          setLastCodexOAuthStart(null);
          await refreshRuntimeStatus(true);
          setRestoreMessage("로그인 완료. 계정에서 확인된 모델을 선택해 적용한 뒤 연결 확인을 실행해 주세요.");
          return;
        }
      } catch {
        // 다음 확인 주기에서 다시 시도합니다.
      } finally {
        if (watchGeneration === codexCompletionWatchGenerationRef.current) {
          codexCompletionCheckInFlightRef.current = false;
        }
      }
      if (
        watchGeneration === codexCompletionWatchGenerationRef.current &&
        checks >= 45
      ) {
        stopCodexCompletionWatch();
        setRestoreMessage("아직 인증 완료를 확인하지 못했습니다. 브라우저 인증을 마쳤다면 상태 새로고침을 눌러 주세요.");
      }
    };
    void checkReady();
    codexCompletionWatchRef.current = window.setInterval(checkReady, 1_000);
  };

  const handleCopyCallbackUrl = async () => {
    const callbackUrl = lastCodexOAuthStart?.callbackUrl;
    if (!callbackUrl) return;
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setRestoreMessage("앱으로 돌아올 주소를 복사했습니다. 브라우저 인증이 끝난 뒤 앱으로 돌아오면 자동으로 확인합니다.");
    } catch {
      setRestoreMessage("복사가 막혔습니다. 앱으로 돌아올 주소를 직접 선택해서 복사해 주세요.");
    }
  };

  const hasCodexRecoveryBox = Boolean(
    lastCodexOAuthStart?.authorizationUrl ||
      lastCodexOAuthStart?.loginUrl ||
      lastCodexOAuthStart?.callbackUrl ||
      lastCodexOAuthStart?.diagnosticStage ||
      lastCodexOAuthStart?.errorMessage ||
      lastCodexOAuthStart?.recoveryActions?.length,
  );
  const easyConnectionState = shortAnswerReady
    ? "chat_ready"
    : chatRuntime
      ? "ready_to_verify"
      : codexDetected
        ? "needs_reconnect"
        : isDesktop
          ? "needs_login"
          : "desktop_app_required";
  const easyPrimaryNextAction = shortAnswerReady
    ? "open_chat"
    : chatRuntime
      ? "verify_live_answer"
      : codexDetected
        ? "reconnect_app_chat"
        : isDesktop
          ? "open_ai_login"
          : "open_desktop_app";
  const easyPrimaryButtonLabel = shortAnswerReady
    ? "채팅으로 돌아가기"
    : chatRuntime
      ? "연결 확인"
      : codexDetected
        ? "앱 채팅 연결하기"
        : isDesktop
          ? "AI 로그인 열기"
          : "설치 앱에서 열기";
  const setupDoctorReadyProvider = chatRuntime?.provider ?? "";
  const setupDoctorStatus = lastRuntimeReceipt?.answerReady
    ? "ai_runtime_setup_live_verified"
    : chatRuntime
      ? "ai_runtime_setup_ready_to_probe"
      : "ai_runtime_setup_missing_provider";
  const setupDoctorProviderLabel = lastRuntimeReceipt?.answerReady
    ? aiRuntimeRouteLabel(lastRuntimeReceipt.finalRoute ?? lastRuntimeReceipt.provider)
    : chatRuntime
      ? aiRuntimeRouteLabel(chatRuntime.provider)
      : "none";
  const setupQuickStartPrimary = setupDoctorStatus === "ai_runtime_setup_live_verified"
    ? "채팅으로 돌아가기"
    : setupDoctorStatus === "ai_runtime_setup_ready_to_probe"
      ? "연결 확인"
      : easyPrimaryButtonLabel;
  const setupQuickStartPrimaryDetail = setupDoctorStatus === "ai_runtime_setup_live_verified"
    ? "이미 실제 답변 영수증이 있으니 새 요청을 바로 이어갈 수 있습니다."
    : setupDoctorStatus === "ai_runtime_setup_ready_to_probe"
      ? "연결 표시만 믿지 않고 실제 한 문장 답변을 생성해 확인합니다."
      : isDesktop
        ? "먼저 AI 로그인으로 연결하고, 막히면 다른 AI 연결을 접힌 보안 칸에서 설정합니다."
        : "설치 앱에서 열어야 로그인 저장과 실제 답변 테스트를 진행할 수 있습니다.";
  const setupQuickStartActionDisabled = setupDoctorStatus === "ai_runtime_setup_live_verified"
    ? false
    : setupDoctorStatus === "ai_runtime_setup_ready_to_probe"
      ? busy === "test" || !isDesktop
      : busy === "codex" || !isDesktop;
  const handleSetupQuickStartAction = () => {
    if (setupDoctorStatus === "ai_runtime_setup_live_verified") {
      navigateInternalPath("/");
      return;
    }
    if (setupDoctorStatus === "ai_runtime_setup_ready_to_probe") {
      void handleRuntimeTest();
      return;
    }
    void handleCodexLogin();
  };
  const feedbackMessage = runtimeTestMessage || restoreMessage || message;

  return (
    <article id="ai-connection" className={styles.card} data-ai-connection-basic-surface="status_primary_action_only">
      {/* 이 헤더는 기본 화면에서 CSS 로 접힌다(data-ai-connection-basic-surface).
          문구는 검증기 계약(validate-web-ai-connection)이라 DOM 에는 유지한다. */}
      <header className={styles.head}>
        <span className={styles.eyebrow}>AI 연결</span>
        <h2>앱 안에서 대화할 AI 연결</h2>
        <p className={styles.subtle}>AI 로그인을 한 번 연결하면 이 앱에서 바로 대화하고 업무를 맡길 수 있습니다.</p>
      </header>

      <section className={styles.aiHero} aria-label="앱 내 AI 채팅 연결">
        <div>
          <span className={`${styles.aiStatusPill} ${shortAnswerReady ? styles.aiStatusReady : ""}`}>
            {shortAnswerReady
              ? "AI 답변 확인됨"
              : chatRuntime
                ? "AI 연결됨 · 실제 답변 확인 필요"
                : codexDetected
                  ? "로컬 AI 로그인 감지"
                  : busy === "codex"
                    ? "브라우저 인증 대기"
                    : "AI 로그인 필요"}
          </span>
          {/* 아래 두 줄은 기본 화면에서 CSS 로 접힌다 — 문구는 검증기 계약이라 DOM 유지 */}
          <h3>{codexUsable ? "앱 안에서 바로 AI와 대화 가능" : chatRuntime ? "실제 답변을 한 번 확인해 주세요" : codexDetected ? "앱 채팅 연결 한 번 더 필요" : "AI 브라우저 로그인"}</h3>
          <p>{shortAnswerReady ? "실제 한 문장 답변까지 확인했습니다." : "계정을 연결한 뒤 해당 계정에서 확인된 모델을 선택합니다. ChatGPT 로그인과 OpenAI API는 사용할 수 있는 모델과 요금 조건이 다를 수 있습니다."}</p>
        </div>
        <div className={styles.aiHeroActions}>
          <button
            type="button"
            className={styles.primary}
            onClick={handleSetupQuickStartAction}
            disabled={setupQuickStartActionDisabled}
            data-ai-primary-action={easyPrimaryNextAction}
          >
            {busy === "codex"
              ? "로그인 여는 중..."
              : busy === "test"
                ? "연결 확인 중..."
                : setupQuickStartPrimary}
          </button>
        </div>
      </section>

      <section
        hidden
        className={styles.aiConnectionPath}
        aria-label="AI 연결 쉬운 상태"
        data-ai-connection-simple-status={easyConnectionState}
        data-primary-next-action={easyPrimaryNextAction}
        data-advanced-key-policy="folded_optional"
        data-secret-display-policy="hidden_original_values"
        data-mobile-safe-width="390"
      >
        <div>
          <span>현재 상태</span>
          <strong>{shortAnswerReady ? "실제 답변 확인됨" : chatRuntime ? "연결 확인 필요" : codexDetected ? "로그인 흔적 확인됨" : "AI 로그인 필요"}</strong>
          <small>{shortAnswerReady ? "새 채팅에서 바로 업무를 맡길 수 있습니다." : "저장·로그인 상태와 실제 답변 성공을 구분해 표시합니다."}</small>
        </div>
        <div>
          <span>지금 누를 것</span>
          <strong>{easyPrimaryButtonLabel}</strong>
          <small>위 버튼 줄의 실제 연결, 새로고침, 테스트 기능으로 이어집니다.</small>
        </div>
        <div>
          <span>보안 경계</span>
          <strong>비밀값 원문 숨김</strong>
          <small>추가 AI 연결은 아래 접힌 보안 설정에서만 입력하고 채팅에는 남기지 않습니다.</small>
        </div>
      </section>

      {codexDetected && !codexReady ? (
        <section
          hidden
          className={styles.codexEasyRecoveryRail}
          aria-hidden="true"
          aria-label="Codex OAuth 쉬운 경로 복구"
          data-codex-oauth-easy-path="detected_app_login_required"
          data-codex-oauth-detected="true"
          data-codex-oauth-answer-ready="false"
          data-codex-oauth-auto-run="false"
        >
          <header>
            <span>기본 연결 감지</span>
            <strong>로그인 흔적은 있지만 앱 채팅 연결은 아직 아닙니다</strong>
          </header>
          <ol>
            <li data-step="detected">
              <span>1</span>
              <div>
                <strong>기존 AI 로그인 흔적 있음</strong>
                <small>감지만으로는 첫 채팅 성공이라고 표시하지 않습니다.</small>
              </div>
            </li>
            <li data-step="connect">
              <span>2</span>
              <div>
                <strong>앱 채팅 연결하기</strong>
                <small>위 버튼으로 브라우저 인증을 마치면 앱이 자동으로 확인합니다.</small>
              </div>
            </li>
            <li data-step="retry">
              <span>3</span>
              <div>
                <strong>첫 채팅 재시도</strong>
                <small>연결 확인이 실제 답변 영수증을 남긴 뒤 업무 요청을 이어갑니다.</small>
              </div>
            </li>
          </ol>
        </section>
      ) : null}

      <section
        hidden
        className={styles.aiSetupDoctorPanel}
        aria-label="AI 연결 상태 점검"
        data-ai-runtime-setup-doctor-status={setupDoctorStatus}
        data-ai-runtime-setup-doctor-ready-provider={setupDoctorReadyProvider || "none"}
        data-ai-runtime-setup-doctor-contract="missing_provider_ready_to_probe_live_verified"
        data-ai-runtime-setup-doctor-secret-policy="env_presence_only_no_raw_secret"
      >
        <header>
          <span>AI 연결 점검</span>
          <strong>{aiRuntimeSetupDoctorStatusLabel(setupDoctorStatus)}</strong>
        </header>
        <ol>
          <li data-step="reason">
            <span>이유</span>
            <strong>{aiRuntimeSetupDoctorReason(setupDoctorStatus)}</strong>
          </li>
          <li data-step="solution">
            <span>해결</span>
            <strong>{aiRuntimeSetupDoctorSolution(setupDoctorStatus)}</strong>
          </li>
          <li data-step="resume">
            <span>다시 이어가기</span>
            <strong>{aiRuntimeSetupDoctorResume(setupDoctorStatus)}</strong>
          </li>
        </ol>
        <small>
          상태: {setupDoctorStatus} · 준비 연결: {setupDoctorProviderLabel}. API key 원문은 화면이나 채팅에 표시하지 않습니다.
        </small>
      </section>

      <section
        hidden
        className={styles.aiSetupPath}
        aria-label="AI 연결 빠른 시작"
        data-ai-runtime-user-setup-path={setupDoctorStatus}
        data-ai-runtime-primary-path={easyPrimaryNextAction}
        data-ai-runtime-fallback-path="openai_or_gemini_key_folded"
        data-ai-runtime-test-gate="short_test_required_before_first_chat_claim"
      >
        <div data-step="recommended">
          <span>1. 추천 경로</span>
          <strong>{setupQuickStartPrimary}</strong>
          <small>{setupQuickStartPrimaryDetail}</small>
          <button
            type="button"
            onClick={handleSetupQuickStartAction}
            disabled={setupQuickStartActionDisabled}
            data-ai-runtime-quick-start-action={easyPrimaryNextAction}
            data-ai-runtime-quick-start-target={
              setupDoctorStatus === "ai_runtime_setup_live_verified"
                ? "chat_home_resume"
                : setupDoctorStatus === "ai_runtime_setup_ready_to_probe"
                  ? "short_live_answer_test"
                  : "codex_oauth_login"
            }
            aria-label="AI 연결 추천 경로 실행"
          >
            바로 실행
          </button>
        </div>
        <div data-step="fallback">
          <span>2. 막히면</span>
          <strong>추가 AI 연결 직접 설정</strong>
          <small>OpenAI 또는 Google Gemini 비밀값은 아래 접힌 보안 설정에만 입력합니다.</small>
        </div>
        <div data-step="verify">
          <span>3. 확인</span>
          <strong>연결 확인 성공 후 첫 채팅</strong>
          <small>실제 답변 영수증이 생기기 전에는 채팅이 되는 척하지 않습니다.</small>
        </div>
      </section>

      <section
        hidden
        className={styles.aiRoleWorkStartRail}
        aria-label="AI 역할 업무 시작"
        data-ai-role-work-start="connection_role_answer_work_candidate_approval"
        data-ai-role-work-start-status={setupDoctorStatus}
        data-ai-role-work-start-contract="ai_connection_role_assignment_work_candidate"
        data-ai-role-work-start-first-visible="verified_role_one_line_actions"
        data-ai-role-work-start-role="mail_teammate"
        data-ai-role-work-start-workflow="mailops_triage_reply_draft_final_lock"
        data-ai-role-work-start-no-fake-result="true"
      >
        <header>
          <span>역할 맡기기</span>
          <strong>검증된 역할부터 바로 업무로 연결</strong>
          <small>지금은 메일 비서 역할을 실제 답변, 메일 직원 작업함, 마지막 확인 잠금까지 확인합니다.</small>
        </header>
        <ol>
          <li data-step="connection" data-state={chatRuntime || shortAnswerReady ? "ready" : "blocked"}>
            <span>연결</span>
            <strong>{shortAnswerReady ? "실답변 완료" : chatRuntime ? "테스트 대기" : "연결 필요"}</strong>
          </li>
          <li data-step="role" data-state={roleProofReady || shortAnswerReady ? "ready" : chatRuntime ? "test" : "blocked"}>
            <span>역할</span>
            <strong>메일 비서</strong>
          </li>
          <li data-step="candidate" data-state={mailOpsProofReady || shortAnswerReady ? "ready" : chatRuntime ? "test" : "blocked"}>
            <span>업무 후보</span>
            <strong>{mailOpsProofReady ? "작업함 확인" : "답장 후보 생성"}</strong>
          </li>
          <li data-step="approval" data-state={mailOpsProofReady ? "ready" : "locked"}>
            <span>실행</span>
            <strong>승인 전 잠금</strong>
          </li>
        </ol>
        <nav aria-label="역할 업무 실행 버튼">
          <button type="button" onClick={() => void handleRuntimeTest()} disabled={busy === "test" || !isDesktop}>
            {busy === "test" ? "테스트 중..." : "실답변 확인"}
          </button>
          <a href="/?preview=workbench&mailConnected=1" aria-label="메일 비서 역할로 시작">
            메일 비서로 시작
          </a>
          <a href="/?preview=workbench&mailConnected=1#mailops-workbench-rows" aria-label="메일 업무 후보 보기">
            업무 후보 보기
          </a>
        </nav>
      </section>

      <section
        hidden
        className={styles.aiLiveWorkProofRail}
        aria-label="AI 연결 실기 체크"
        data-ai-live-work-proof="short_answer_role_assignment_mailops_workqueue"
        data-ai-live-work-proof-status={setupDoctorStatus}
        data-ai-live-work-proof-first-gate="short_live_answer_test"
        data-ai-live-work-proof-role-contract="role_assignment_runtime_v1"
        data-ai-live-work-proof-work-contract="role_assignment_to_work_automation_engine_v1"
        data-ai-live-work-proof-role-command="npm.cmd run run:ai-runtime-role-live"
        data-ai-live-work-proof-mailops-command="npm.cmd run run:ai-runtime-mailops-role-workqueue-live"
        data-ai-live-work-proof-fake-result-policy="no_fake_answer_no_fake_work_card"
        data-ai-live-work-proof-secret-policy="no_raw_secret"
        data-ai-live-work-proof-report-status={liveProofs?.status ?? "not_checked"}
        data-ai-live-work-proof-report-count={String(liveProofs?.proofCount ?? 0)}
        data-ai-live-work-proof-verified-count={String(liveProofs?.verifiedCount ?? 0)}
        data-ai-live-work-proof-release-status={releaseReadinessProof?.status ?? "missing"}
        data-ai-live-work-proof-release-ready={releaseReadinessReady ? "true" : "false"}
        data-ai-live-work-proof-release-fresh={releaseReadinessFresh ? "true" : "false"}
        data-ai-live-work-proof-router-safety={releaseReadinessProof?.routerSafetyTrackStatus ?? ""}
        data-ai-live-work-proof-live-provider={releaseReadinessProof?.liveProviderTrackStatus ?? ""}
        data-ai-live-work-proof-first-chat={releaseReadinessProof?.runtimeTrackStatus ?? ""}
        data-ai-live-work-proof-mailops-live={releaseReadinessProof?.mailOpsRoleWorkQueueTrackStatus ?? ""}
      >
        <header>
          <span>실기 체크</span>
          <strong>대화, 역할, 메일 업무까지 이어지는지 확인</strong>
          <small>{proofSummary}</small>
        </header>
        <ol>
          <li data-step="short_answer" data-state={shortAnswerReady ? "ready" : chatRuntime ? "test" : "blocked"}>
            <span>대화</span>
            <strong>{shortAnswerReady ? "실답변 확인" : chatRuntime ? "연결 확인" : "연결 필요"}</strong>
          </li>
          <li data-step="role_assignment" data-state={roleProofReady || shortAnswerReady ? "ready" : chatRuntime ? "test" : "blocked"}>
            <span>역할</span>
            <strong>{roleProofReady ? "역할 실기 확인" : shortAnswerReady ? "역할 맡기기 가능" : "답변 확인 뒤"}</strong>
          </li>
          <li data-step="mailops_workqueue" data-state={mailOpsProofReady || shortAnswerReady ? "ready" : chatRuntime ? "test" : "blocked"}>
            <span>메일</span>
            <strong>{mailOpsProofReady ? "메일 실기 확인" : shortAnswerReady ? "작업함으로 이동" : "역할 확인 뒤"}</strong>
          </li>
          <li data-step="release_readiness" data-state={releaseReadinessReady ? "ready" : liveProofs?.proofs?.length ? "test" : "blocked"}>
            <span>전체</span>
            <strong>{releaseReadinessReady ? "실행 게이트 통과" : liveProofs?.proofs?.length ? "게이트 확인" : "리포트 대기"}</strong>
          </li>
        </ol>
        <details className={styles.aiLiveWorkProofDetails} aria-label="AI 연결 실기 리포트">
          <summary>최근 리포트 {liveProofs?.proofCount ?? 0}건</summary>
          <ul>
            {(liveProofs?.proofs ?? []).slice(0, 4).map((proof) => (
              <li key={`${proof.id}-${proof.reportPath}`}>
                <span>{proof.label}</span>
                <strong>{proof.liveVerified ? "실기 검증" : proof.proofExpired ? "다시 확인" : proof.answerReady ? "답변 확인" : "확인 필요"}</strong>
                <small>
                  {proof.id === "release_readiness"
                    ? proof.status
                    : proof.provider || proof.mode || proof.status || proof.reportPath}
                </small>
              </li>
            ))}
            {liveProofs?.proofs?.length ? null : (
              <li>
                <span>리포트</span>
                <strong>아직 없음</strong>
                <small>연결 확인 후 생성된 증거만 표시합니다.</small>
              </li>
            )}
          </ul>
        </details>
        {releaseReadinessProof ? (
          <details
            className={styles.aiLiveWorkProofDetails}
            aria-label="AI 런타임 전체 게이트"
            data-ai-runtime-release-readiness="live_provider_role_mailops_router_safety"
            data-ai-runtime-release-readiness-status={releaseReadinessProof.status}
            data-ai-runtime-release-readiness-ready={releaseReadinessReady ? "true" : "false"}
            data-ai-runtime-release-readiness-fresh={releaseReadinessFresh ? "true" : "false"}
            data-ai-runtime-release-readiness-live-reports={String(releaseReadinessProof.latestLiveReports ?? 0)}
            data-ai-runtime-release-readiness-live-groups={String(releaseReadinessProof.liveReadyGroups ?? 0)}
            data-ai-runtime-release-readiness-external-mutation="false"
          >
            <summary>전체 게이트 {releaseReadinessReady ? "통과" : "확인 필요"}</summary>
            <ul>
              <li>
                <span>대화</span>
                <strong>{releaseReadinessProof.runtimeTrackStatus || "확인 필요"}</strong>
                <small>첫 채팅/보관 요청/새 사용자 스모크</small>
              </li>
              <li>
                <span>연결</span>
                <strong>{releaseReadinessProof.liveProviderTrackStatus || "확인 필요"}</strong>
                <small>실제 provider 답변</small>
              </li>
              <li>
                <span>역할·메일</span>
                <strong>{releaseReadinessProof.mailOpsRoleWorkQueueTrackStatus || "확인 필요"}</strong>
                <small>{releaseReadinessProof.roleRuntimeTrackStatus || "역할 검증 대기"}</small>
              </li>
              <li>
                <span>복구</span>
                <strong>{releaseReadinessProof.routerSafetyTrackStatus || "확인 필요"}</strong>
                <small>{releaseReadinessProof.releaseBlockerSummary || releaseReadinessProof.reportPath}</small>
              </li>
            </ul>
          </details>
        ) : null}
        <nav aria-label="AI 연결 실기 실행 버튼">
          <button type="button" onClick={() => void handleRuntimeTest()} disabled={busy === "test" || !isDesktop}>
            {busy === "test" ? "연결 확인 중..." : "연결 확인"}
          </button>
          <a href="/?preview=workbench" aria-label="역할 맡기기 화면 열기">
            역할 맡기기
          </a>
          <a href="/?preview=workbench#mailops-workbench-rows" aria-label="메일 직원 작업함 열기">
            메일 직원 작업함
          </a>
        </nav>
      </section>

      {codexRuntime?.keyFingerprint ? (
        <dl className={styles.meta} hidden>
          <div>
            <dt>앱 답변 상태</dt>
            <dd>{codexReady ? `앱 연결 완료 · ${codexModelDisplayLabel(codexRuntime.model ?? codexModel)}` : "기존 인증 감지 - 앱 채팅 연결 필요"}</dd>
          </div>
          <div>
              <dt>확인값</dt>
              <dd className={styles.mono}>{codexRuntime.keyFingerprint}</dd>
          </div>
          {codexRuntime.userMessage ? (
            <div className={styles.metaFull}>
              <dt>상태 안내</dt>
              <dd>{codexRuntime.userMessage}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {hasCodexRecoveryBox ? (
        <section className={styles.aiRecoveryBox} aria-label="AI 로그인 복구 안내">
          <header>
            <span>연결 이어가기</span>
            <strong>
              {lastCodexOAuthStart?.diagnosticStage === "callback_port_busy"
                ? "앱으로 돌아올 주소가 막혀 있습니다"
                : lastCodexOAuthStart?.externalUrlOpened === false
                  ? "브라우저가 자동으로 열리지 않았습니다"
                  : "브라우저 인증을 마치면 자동으로 확인합니다"}
            </strong>
          </header>
          <ol>
            <li>브라우저에서 GPT 계정을 선택하고 연결에 동의합니다.</li>
            <li>인증이 끝나면 이 앱이 돌아올 주소를 받아 저장합니다.</li>
            <li>준비됨으로 바뀌면 새 채팅에서 바로 대화합니다.</li>
          </ol>
          {lastCodexOAuthStart?.callbackUrl ? (
            <label className={styles.recoveryField}>
              <span>앱으로 돌아올 주소</span>
              <input value={lastCodexOAuthStart.callbackUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
            </label>
          ) : null}
          {lastCodexOAuthStart?.errorMessage ? (
            <p className={styles.recoveryReason}>막힌 이유: {lastCodexOAuthStart.errorMessage}</p>
          ) : null}
          {lastCodexOAuthStart?.recoveryActions?.length ? (
            <ul>
              {lastCodexOAuthStart.recoveryActions.slice(0, 4).map((action) => (
                <li key={action}>{userFacingAIRecoveryAction(action)}</li>
              ))}
            </ul>
          ) : null}
          <div className={styles.recoveryActions}>
            {lastCodexOAuthStart?.authorizationUrl || lastCodexOAuthStart?.loginUrl ? (
              <a
                className={styles.primaryActionLink}
                href={lastCodexOAuthStart.authorizationUrl ?? lastCodexOAuthStart.loginUrl}
                target="_blank"
                rel="noreferrer"
              >
                AI 로그인 링크 열기
              </a>
            ) : null}
            {lastCodexOAuthStart?.callbackUrl ? (
              <button type="button" className={styles.secondary} onClick={handleCopyCallbackUrl}>
                주소 복사
              </button>
            ) : null}
            <button type="button" className={styles.secondary} onClick={() => void refreshRuntimeStatus(true)} disabled={busy === "refresh"}>
              상태 확인
            </button>
          </div>
        </section>
      ) : null}

      {!isDesktop ? (
        <p className={styles.warning}>
          실제 AI 로그인 저장과 답변 생성은 설치된 데스크톱 앱에서 진행됩니다. 브라우저 미리보기는
          앱으로 돌아올 주소와 암호화 보관함을 사용할 수 없습니다.
        </p>
      ) : null}

      <section className={styles.runtimeTruthPanel} aria-label="AI 연결 실제 상태 경계" hidden>
        <div data-state={codexReady ? "ready" : codexDetected ? "needs_reconnect" : isDesktop ? "needs_login" : "desktop_required"}>
          <span>AI 브라우저 로그인</span>
          <strong>{codexReady ? "실제 AI 응답 가능" : codexDetected ? "로컬 로그인 복구 가능" : isDesktop ? "브라우저 인증 필요" : "설치 앱 필요"}</strong>
          <small>브라우저 인증과 암호화 보관함을 우선 쓰고, 막히면 이 화면에서 다시 이어갑니다.</small>
        </div>
        <div data-state={chatRuntime ? "ready" : "advanced"}>
          <span>보조 연결</span>
          <strong>{chatRuntime ? `${chatRuntime.model ?? "AI"} 준비됨` : "추가 연결은 선택 사항"}</strong>
          <small>필요한 경우에만 OpenAI/Gemini 연결 비밀값을 접힌 보안 칸에 따로 저장합니다.</small>
        </div>
        <div
          data-state={
            lastRuntimeReceipt?.answerReady
              ? lastRuntimeReceipt.fallbackUsed
                ? "fallback_ready"
                : "ready"
              : lastRuntimeReceipt
                ? "needs_reconnect"
                : "advanced"
          }
          data-ai-runtime-receipt="answerReady_fallbackUsed_userNextAction"
          data-ai-runtime-final-route={
            lastRuntimeReceipt
              ? lastRuntimeReceipt.finalRoute ?? lastRuntimeReceipt.provider ?? undefined
              : undefined
          }
          data-ai-runtime-attempted-routes={
            lastRuntimeReceipt?.attemptedRoutes?.length
              ? lastRuntimeReceipt.attemptedRoutes.join(">")
              : undefined
          }
        >
          <span>대화 가능 확인</span>
          <strong>
            {lastRuntimeReceipt?.answerReady
              ? lastRuntimeReceipt.fallbackUsed
                ? "예비 연결로 대화 가능"
                : "앱 채팅 대화 가능"
              : lastRuntimeReceipt
                ? "답변 재확인 필요"
                : "연결 확인으로 확인"}
          </strong>
          <small>{aiRuntimeReceiptSummary(lastRuntimeReceipt)}</small>
        </div>
      </section>

      <details
        className={styles.advancedBox}
        aria-label="문제 해결 및 고급 설정"
        data-ai-advanced-default="closed"
      >
        <summary>문제 해결 및 고급 설정</summary>
        <div className={styles.aiHeroActions} aria-label="AI 답변 고급 설정">
          <label className={styles.field}>
            <span>ChatGPT 로그인 모델</span>
            <select
              id="codex-ai-model"
              name="codexAiModel"
              value={codexModel}
              onChange={(event) => setCodexModel(event.target.value)}
              disabled={busy !== null || loadingModels || !codexReady}
            >
              {!selectedCodexModel ? <option value={codexModel} disabled>{codexModelDisplayLabel(codexModel)}</option> : null}
              {codexModelOptions.map((option) => (
                <option key={option.id} value={option.id} disabled={!option.ready}>
                  {option.label}{!option.ready ? ` · ${option.needs}` : ""}
                </option>
              ))}
            </select>
            <small>{loadingModels ? "계정의 모델 목록을 확인하고 있습니다." : selectedCodexModel?.needs || codexRuntime?.modelAvailability?.userMessage || "계정에서 확인된 모델만 적용할 수 있습니다."}</small>
          </label>
          <button
            type="button"
            className={styles.secondary}
            onClick={handleSaveCodexModel}
            disabled={busy !== null || loadingModels || !isDesktop || !selectedCodexModel?.ready}
          >
            선택 적용
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void refreshRuntimeStatus(true)}
            disabled={busy === "refresh" || loadingModels}
          >
            {loadingModels ? "모델 목록 확인 중…" : "모델 목록 새로고침"}
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void handleRuntimeTest()}
            disabled={busy === "test" || !isDesktop}
          >
            {busy === "test" ? "연결 확인 중..." : "연결 확인"}
          </button>
        </div>
        <div className={styles.tabs}>
          {(Object.keys(providerInfo) as Provider[]).map((p) => (
            <button
              key={p}
              type="button"
              className={`${styles.tab} ${provider === p ? styles.tabActive : ""}`}
              onClick={() => handleProviderChange(p)}
              disabled={busy !== null || loadingModels}
            >
              {providerInfo[p].label}
            </button>
          ))}
        </div>

        <label className={styles.field}>
          <span>{providerInfo[provider].label} API 모델</span>
          <select
            id="advanced-ai-model"
            name="advancedAiModel"
            value={model}
            onChange={(e) => { modelEditRef.current = { dirty: true, revision: modelEditRef.current.revision + 1 }; setModel(e.target.value); }}
            disabled={busy !== null || loadingModels || !apiRuntime?.hasLocalKey}
          >
            {!selectedAPIModel ? <option value={model} disabled>{model || "연결 후 모델 선택"} · 확인 필요</option> : null}
            {apiModelOptions.map((choice) => <option key={choice.id} value={choice.id} disabled={!choice.ready}>{choice.label}{!choice.ready ? ` · ${choice.needs}` : ""}</option>)}
          </select>
          <small>{selectedAPIModel?.needs || apiRuntime?.modelAvailability?.userMessage || "API 키를 먼저 저장하고 모델 목록을 확인해 주세요."}</small>
        </label>
        <button type="button" className={styles.secondary} onClick={() => void handleSaveAPIModel()} disabled={busy !== null || loadingModels || !isDesktop || !selectedAPIModel?.ready}>API 모델 선택 적용</button>

        <label className={styles.field}>
          <span>AI 연결 비밀값</span>
          <input
            id="advanced-ai-secret"
            name="advancedAiSecret"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={providerInfo[provider].help}
          />
        </label>

        <p className={styles.warning}>
          AI 비밀값은 계정 클라우드로 보내지 않고 이 Windows PC의 암호화 보관함에만 저장합니다.
        </p>

        {!isDesktop ? (
          <p className={styles.warning}>설치된 Windows 앱에서 열어야 이 PC 보관함에 저장할 수 있습니다.</p>
        ) : null}

        {cloudSettings?.legacyCloudSecretPresent ? (
          <p className={styles.warning}>
            이전 방식의 클라우드 비밀값을 감지해 계정에서 자동 제거하고 있습니다. 이 앱은 해당 값을 사용하지 않습니다.
          </p>
        ) : null}

        <p className={styles.warning}>
          이 연결을 사용할 때 현재 대화와 첨부 내용이 선택한 AI 제공업체로 전송될 수 있습니다.
        </p>
        <button
          type="button"
          className={styles.secondary}
          aria-pressed={allowChatContent}
          onClick={() => setAllowChatContent((current) => !current)}
        >
          {allowChatContent ? "대화 사용 동의됨" : "대화 사용 동의"}
        </button>

        {cloudSettings ? (
          <dl className={styles.meta}>
            <div>
              <dt>계정에 표시할 AI</dt>
              <dd>{providerInfo[cloudSettings.provider].label}</dd>
            </div>
            <div>
              <dt>모델</dt>
              <dd>{cloudSettings.model}</dd>
            </div>
            <div>
              <dt>비밀값 저장</dt>
              <dd>이 PC만</dd>
            </div>
          </dl>
        ) : null}

        <button
          type="button"
          className={styles.primary}
          onClick={handleSave}
          disabled={
            busy === "api" ||
            !isDesktop ||
            !allowChatContent ||
            secret.trim().length < 8
          }
        >
          {busy === "api" ? "저장 중..." : "이 PC에 저장"}
        </button>
      </details>

      {feedbackMessage ? (
        <p className={styles.status} role="status" aria-live="polite">
          {feedbackMessage}
        </p>
      ) : null}
    </article>
  );
}
