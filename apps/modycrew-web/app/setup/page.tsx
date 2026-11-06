"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { createDesktopBridge } from "@/lib/desktop-bridge";
import type { AIProviderKeyStatus, AIRuntimeLiveProofItem, AIRuntimeLiveProofsResult } from "@/lib/desktop-bridge";
import {
  getSetupToolMode,
  getSetupStep,
  getSetupWorkMode,
  isBasePicked,
  isToolPicked,
  markBasePicked,
  markSetupDone,
  markToolPicked,
  setSetupStep,
  setSetupToolMode,
  setSetupWorkMode,
} from "@/lib/onboarding";
import styles from "./page.module.css";

type Step = 1 | 2 | 3;
type FirstRunAIState = "checking" | "live" | "ready" | "needs";

const firstWorkTasks = [
  {
    id: "mail",
    featureId: "feature-mail",
    label: "메일 점검",
    desc: "메일을 읽고 답장·일정 후보를 승인함에 올립니다.",
    prep: "메일 계정만 먼저 확인",
  },
  {
    id: "document",
    featureId: "feature-document-learning",
    label: "문서 학습",
    desc: "파일이나 폴더를 골라 요약과 업무 기억 후보를 만듭니다.",
    prep: "자료 위치만 먼저 선택",
  },
  {
    id: "tidy",
    featureId: "feature-tidy",
    label: "폴더 정리",
    desc: "이동·삭제 없이 정리 후보와 되돌리기 기준을 먼저 봅니다.",
    prep: "정리할 폴더만 선택",
  },
  {
    id: "schedule",
    featureId: "feature-schedule-prep",
    label: "일정 준비",
    desc: "가능 시간, 일정 제목, 참석자 후보를 먼저 정리합니다.",
    prep: "캘린더 연결만 확인",
  },
  {
    id: "report",
    featureId: "feature-draft-report",
    label: "보고서 만들기",
    desc: "학습한 자료와 AI 팀원 결과를 보고서 초안으로 묶습니다.",
    prep: "자료 선택부터 시작",
  },
  {
    id: "repeat",
    featureId: "feature-repeat-work",
    label: "반복 업무 만들기",
    desc: "언제, 무엇을, 어디에 보여줄지 문장으로 정리합니다.",
    prep: "반복 문장만 먼저 작성",
  },
  {
    id: "computer",
    featureId: "feature-computer-use",
    label: "내 PC 작업 도우미",
    desc: "열린 창, 최근 파일, 선택 파일을 읽기 모드부터 확인합니다.",
    prep: "볼 범위만 먼저 선택",
  },
] as const;

type FirstWorkTask = (typeof firstWorkTasks)[number];
type FirstWorkTaskId = FirstWorkTask["id"];
type SetupPageView = "recommended" | "all";

const setupPageViewStorageKey = "modycrew-setup-page-view-v1";

function readStoredSetupPageView(): SetupPageView {
  if (typeof window === "undefined") return "recommended";
  try {
    return normalizeSetupPageView(window.localStorage.getItem(setupPageViewStorageKey));
  } catch {
    return "recommended";
  }
}

function normalizeSetupPageView(value: unknown): SetupPageView {
  return value === "all" || value === "recommended" ? value : "recommended";
}

function setupPageViewLabel(view: SetupPageView) {
  return view === "all" ? "전체 업무" : "추천 업무";
}

function getSetupPageViewSummary(view: SetupPageView, hiddenCount: number) {
  if (view === "all") return "모든 업무를 폴더처럼 한 화면에서 고릅니다.";
  return hiddenCount > 0
    ? `지금 고른 업무 1개만 먼저 보이고 ${hiddenCount}개는 바꾸기 안에 둡니다.`
    : "지금 고른 업무만 먼저 보고 바로 다음 단계로 이어갑니다.";
}

const setupPageViewTabs: Array<{ id: SetupPageView; label: string; detail: string }> = [
  { id: "recommended", label: "추천", detail: "처음 할 일만" },
  { id: "all", label: "전체", detail: "모든 업무" },
];

const setupNextPageRoutes = [
  {
    id: "connect",
    href: "/connect",
    label: "연결",
    title: "필요한 계정만 확인",
    detail: "AI, 메일, 캘린더, 보관함을 한 화면씩 연결합니다.",
    state: "primary",
  },
  {
    id: "learn",
    href: "/learn",
    label: "자료 학습",
    title: "파일과 폴더 기억",
    detail: "업무에 필요한 자료만 읽고 기억 후보로 정리합니다.",
    state: "support",
  },
  {
    id: "office",
    href: "/office",
    label: "업무 오피스",
    title: "승인함에서 확인",
    detail: "실행 후보, 승인, 기록을 탭으로 나눠 봅니다.",
    state: "support",
  },
  {
    id: "account",
    href: "/account",
    label: "계정",
    title: "내 설정 보관",
    detail: "계정, 기기, 고급 설정을 필요할 때만 엽니다.",
    state: "support",
  },
  {
    id: "home",
    href: "/",
    label: "홈",
    title: "대화로 돌아가기",
    detail: "한 줄 업무 요청과 최근 실행 흐름으로 돌아갑니다.",
    state: "support",
  },
] as const;

function setupPageRouteHref(pathname: string, previewMode?: string | null): string {
  if (previewMode !== "workbench") return pathname;
  const params = new URLSearchParams();
  params.set("preview", "workbench");
  if (pathname === "/" || pathname === "/office") params.set("mockRuntime", "1");
  const query = params.toString();
  return `${pathname}?${query}`;
}

function setupPreviewHref(task: FirstWorkTask, previewMode?: string | null): string {
  const params = new URLSearchParams();
  params.set("setupTask", task.featureId);
  params.set("setupPreview", "1");
  if (previewMode === "workbench") params.set("preview", "workbench");
  return `/?${params.toString()}`;
}

function setupAIConnectionHref(task: FirstWorkTask, previewMode?: string | null): string {
  const params = new URLSearchParams();
  params.set("singleSetting", "codex-oauth");
  params.set("from", "setup");
  params.set("setupStep", "2");
  params.set("setupWork", task.id);
  params.set("goal", "AI 연결 확인 후 첫 업무 설정으로 돌아갑니다");
  if (previewMode === "workbench") params.set("preview", "workbench");
  return `/connect?${params.toString()}`;
}

function setupWorkConnectionHref(task: FirstWorkTask, previewMode?: string | null): string | null {
  const singleSetting =
    task.id === "mail" ? "mail-calendar" : task.id === "schedule" ? "calendar-suggestions" : null;
  if (!singleSetting) return null;
  const params = new URLSearchParams();
  params.set("singleSetting", singleSetting);
  params.set("from", "setup-work");
  params.set("setupStep", "2");
  params.set("setupWork", task.id);
  params.set("goal", `${task.label} 연결 확인 후 첫 설정으로 돌아갑니다`);
  if (previewMode === "workbench") params.set("preview", "workbench");
  return `/connect?${params.toString()}`;
}

function normalizeSetupStepParam(value?: string | null): Step | null {
  if (value === "1" || value === "2" || value === "3") return Number(value) as Step;
  return null;
}

function normalizeSetupWorkParam(value?: string | null): FirstWorkTaskId | null {
  return firstWorkTasks.some((task) => task.id === value) ? (value as FirstWorkTaskId) : null;
}

function firstPreparationChoices(task: FirstWorkTask) {
  return [
    {
      id: "prepare",
      label: task.prep,
      desc: "필요한 계정, 자료, 폴더 중 지금 업무에 필요한 것만 확인합니다.",
    },
    {
      id: "preview",
      label: "AI 미리보기부터",
      desc: "실행 전 무엇을 만들지 먼저 보고, 실제 변경은 승인 뒤로 둡니다.",
    },
    {
      id: "approval",
      label: "승인함까지 보기",
      desc: "실행 후보가 어디에서 멈추고 사용자가 무엇을 확인하는지 봅니다.",
    },
    {
      id: "later",
      label: "나중에 연결",
      desc: "업무실을 먼저 열고 필요할 때 연결과 자료 선택을 이어갑니다.",
    },
  ] as const;
}

function setupPreparationTitle(task: FirstWorkTask): string {
  if (task.id === "schedule") return "일정 연결 준비";
  return `${task.label} 준비`;
}

function firstRealReadinessRows(task: FirstWorkTask, desktopReady: boolean) {
  const readDetail =
    task.id === "mail"
      ? "메일은 최신 제목, 보낸 사람, 시간처럼 업무 판단에 필요한 읽기 정보만 먼저 확인합니다."
      : task.id === "schedule"
        ? "일정은 바쁜 시간 확인처럼 읽기 정보만 먼저 보고, 등록은 승인 뒤에만 진행합니다."
        : task.id === "document" || task.id === "report"
          ? "자료는 사용자가 고른 파일과 폴더 안에서만 읽고, 저장이나 공유는 승인 전까지 잠급니다."
          : task.id === "tidy"
            ? "폴더는 이동·삭제 없이 후보와 되돌리기 기준만 먼저 보여줍니다."
            : task.id === "computer"
              ? "내 PC 작업은 열린 창과 선택 파일을 읽기 후보로만 만들고 클릭·입력은 승인 뒤로 둡니다."
              : "반복 업무는 저장만으로 실행하지 않고, 사용자가 켠 뒤에만 점검합니다.";

  return [
    {
      id: "real-read",
      label: desktopReady ? "실제 확인 가능" : "설치 앱 필요",
      title: "가짜 결과 없이 읽기부터",
      detail: readDetail,
      state: desktopReady ? "ready" : "needs",
    },
    {
      id: "approval-lock",
      label: "실행 잠금",
      title: "외부 실행은 승인 뒤",
      detail: "발송, 일정 등록, 파일 저장·이동·삭제, 공유는 승인함의 마지막 확인 전까지 실행하지 않습니다.",
      state: "locked",
    },
    {
      id: "first-user",
      label: "처음 쓰는 사람 기준",
      title: "다음 버튼이 보여야 함",
      detail: "처음 쓰는 사람도 다음 버튼, 승인함, 실행 로그, 다음부터 이렇게 저장 위치를 찾을 수 있어야 합니다.",
      state: "observe",
    },
  ] as const;
}

function isAIProviderReady(provider: AIProviderKeyStatus) {
  const status = String(provider.status ?? "").toLowerCase();
  const hasReadySignal = ["ready", "verified", "loaded", "connected"].some((token) => status.includes(token));
  const hasBlockSignal = ["missing", "not_connected", "error", "failed", "required"].some((token) => status.includes(token));
  const isStoredApiProvider = provider.provider === "openai" || provider.provider === "gemini";
  const credentialReady = isStoredApiProvider
    ? provider.hasLocalKey && provider.chatContentAllowed === true
    : Boolean(provider.hasLocalKey || provider.authMode === "codex_oauth");
  return credentialReady && (isStoredApiProvider || hasReadySignal) && !hasBlockSignal;
}

function firstRunWizardRows(task: FirstWorkTask, toolLabel: string, desktopReady: boolean, aiState: FirstRunAIState) {
  const aiLiveReady = aiState === "live";
  const aiReady = aiLiveReady || aiState === "ready";
  return [
    {
      id: "ai",
      label: "AI 연결",
      state: aiLiveReady ? "done" : "active",
      result:
        aiState === "checking"
          ? "확인 중"
          : aiLiveReady
            ? "실답변 검증됨"
            : aiReady
              ? "짧은 실답변 테스트 필요"
              : "AI 연결 확인 필요",
      detail: aiLiveReady
        ? "첫 채팅, 역할 호출, 메일 업무 후보로 이어질 실제 답변 증거가 확인됐습니다."
        : aiReady
          ? "계정 또는 키는 준비됐지만 실제 모델 답변과 역할 실행 증거를 한 번 더 확인해야 합니다."
        : "연결 전에는 답변이나 업무 후보를 만든 척하지 않고, 앱 안에서 AI 연결부터 확인합니다.",
      action: "AI 연결 확인",
      passed: aiLiveReady,
    },
    {
      id: "work",
      label: "첫 업무 연결",
      state: aiLiveReady ? "active" : "waiting",
      result: aiLiveReady ? `${task.label} 준비 선택됨` : aiReady ? "실답변 테스트 뒤 진행" : "AI 연결 뒤 진행",
      detail: desktopReady
        ? `${toolLabel} 기준으로 필요한 계정, 자료, 폴더만 단계별로 확인합니다.`
        : "설치 앱이 연결되면 실제 메일, 파일, 캘린더 읽기 상태를 확인합니다.",
      action: task.id === "mail" || task.id === "schedule" ? task.prep : `${task.label} 준비`,
      passed: false,
    },
    {
      id: "approval",
      label: "승인함 테스트",
      state: "waiting",
      result: "실행 전 잠금",
      detail: "발송, 일정 등록, 파일 저장·이동·삭제는 승인함에서 사용자가 확인하기 전까지 실행하지 않습니다.",
      action: "승인함에서 확인",
      passed: false,
    },
  ] as const;
}

function isFreshLiveProof(proof?: AIRuntimeLiveProofItem | null) {
  return Boolean(proof?.liveVerified && proof.reportFresh !== false && proof.proofExpired !== true);
}

function findLiveProof(proofs: AIRuntimeLiveProofsResult | null, id: string) {
  return proofs?.proofs?.find((proof) => proof.id === id) ?? null;
}

function firstRunProofRows(proofs: AIRuntimeLiveProofsResult | null, providerReady: boolean) {
  const releaseProof = findLiveProof(proofs, "release_readiness");
  const roleProof = findLiveProof(proofs, "role_live");
  const mailOpsProof = findLiveProof(proofs, "mailops_workqueue");
  const setupProof = findLiveProof(proofs, "setup_doctor");
  const releaseReady = isFreshLiveProof(releaseProof);
  const roleReady = isFreshLiveProof(roleProof);
  const mailOpsReady = isFreshLiveProof(mailOpsProof);
  return [
    {
      id: "provider",
      label: "연결",
      state: releaseReady || providerReady ? "ready" : "needs",
      value: releaseReady ? "실답변" : providerReady ? "테스트 필요" : "연결 필요",
      detail: releaseProof?.liveProviderTrackStatus || setupProof?.status || "AI 연결 상태",
    },
    {
      id: "role",
      label: "역할",
      state: roleReady ? "ready" : releaseReady ? "test" : "locked",
      value: roleReady ? "역할 증거" : "메일 비서 테스트",
      detail: roleProof?.contract || "role_assignment_runtime_v1",
    },
    {
      id: "mailops",
      label: "업무큐",
      state: mailOpsReady ? "ready" : roleReady ? "test" : "locked",
      value: mailOpsReady ? "업무 후보" : "메일큐 확인",
      detail: mailOpsProof?.workContract || "role_assignment_to_work_automation_engine_v1",
    },
    {
      id: "approval",
      label: "실행",
      state: mailOpsReady ? "ready" : "locked",
      value: "승인 전 잠금",
      detail: "externalMutation=false",
    },
  ] as const;
}

const stepCopy: Record<Step, { title: string; desc: string }> = {
  1: {
    title: "기본 업무만 고릅니다",
    desc: "첫 업무 하나만 고르면 필요한 설정은 뒤에서 한 단계씩 열립니다. 복잡한 준비는 앱이 필요한 순간에 한 가지씩 안내합니다.",
  },
  2: {
    title: "첫 연결만 정합니다",
    desc: "계정, 자료, 폴더, 승인함 중 지금 필요한 준비만 고릅니다.",
  },
  3: {
    title: "업무실 준비 완료",
    desc: "가짜 데이터 없이 현재 연결 상태와 실행 가능한 버튼만 보여줍니다.",
  },
};

export default function SetupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setupStepParam = searchParams?.get("setupStep") ?? searchParams?.get("step");
  const setupWorkParam = searchParams?.get("setupWork") ?? searchParams?.get("work");
  const searchSignature = searchParams?.toString() ?? "";
  const [step, setStep] = useState<Step>(() => getSetupStep() as Step);
  const [workMode, setWorkMode] = useState<string>(() => getSetupWorkMode() || (isBasePicked() ? "mail" : ""));
  const [firstTool, setFirstTool] = useState<string>(() => getSetupToolMode() || (isToolPicked() ? "prepare" : ""));
  const [desktopReady, setDesktopReady] = useState(false);
  const [aiState, setAiState] = useState<FirstRunAIState>("checking");
  const [aiLiveProofs, setAiLiveProofs] = useState<AIRuntimeLiveProofsResult | null>(null);
  const [setupPageView, setSetupPageView] = useState<SetupPageView>(readStoredSetupPageView);

  useEffect(() => {
    const requestedStep = normalizeSetupStepParam(setupStepParam);
    const requestedWork = normalizeSetupWorkParam(setupWorkParam);
    if (!requestedStep) return;
    setStep(requestedStep);
    setSetupStep(requestedStep);
    if (requestedWork) {
      setWorkMode(requestedWork);
      setSetupWorkMode(requestedWork);
      markBasePicked(true);
    }
    if (requestedStep >= 2 && !workMode) {
      setWorkMode("mail");
      setSetupWorkMode("mail");
      markBasePicked(true);
    }
    if (requestedStep >= 2 && !firstTool) {
      setFirstTool("prepare");
      setSetupToolMode("prepare");
      markToolPicked(true);
    }
  }, [firstTool, setupStepParam, setupWorkParam, workMode]);

  useEffect(() => {
    const activeBridge = createDesktopBridge();
    setDesktopReady(activeBridge.isAvailable);
    setAiState("checking");
    setAiLiveProofs(null);
    let cancelled = false;
    void activeBridge
      .getAIProviderStatus()
      .then(async (result) => {
        if (cancelled) return;
        const providers = Array.isArray(result?.providers) ? result.providers : [];
        const providerReady = providers.some(isAIProviderReady);
        let liveProofs: AIRuntimeLiveProofsResult | null = null;
        try {
          liveProofs = await activeBridge.getAIRuntimeLiveProofs();
          if (!cancelled) setAiLiveProofs(liveProofs);
        } catch {
          liveProofs = null;
        }
        const releaseReady = isFreshLiveProof(findLiveProof(liveProofs, "release_readiness"));
        const roleReady = isFreshLiveProof(findLiveProof(liveProofs, "role_live"));
        const mailOpsReady = isFreshLiveProof(findLiveProof(liveProofs, "mailops_workqueue"));
        setAiState(releaseReady || (roleReady && mailOpsReady) ? "live" : providerReady ? "ready" : "needs");
      })
      .catch(() => {
        if (!cancelled) setAiState("needs");
      });
    return () => {
      cancelled = true;
    };
  }, [searchSignature]);

  useEffect(() => {
    try {
      window.localStorage.setItem(setupPageViewStorageKey, setupPageView);
    } catch {
      // 저장 실패는 화면 구성만 기본값으로 유지합니다.
    }
  }, [setupPageView]);

  const progress = useMemo(() => {
    const doneCount = Number(Boolean(workMode)) + Number(Boolean(firstTool)) + Number(step === 3);
    return Math.round((doneCount / 3) * 100);
  }, [firstTool, step, workMode]);

  const selectedMode = firstWorkTasks.find((mode) => mode.id === workMode) ?? firstWorkTasks[0];
  const preparationChoices = firstPreparationChoices(selectedMode);
  const selectedTool = preparationChoices.find((tool) => tool.id === firstTool) ?? preparationChoices[0];
  const visiblePreparationChoices = [selectedTool];
  const hiddenPreparationChoices = preparationChoices.filter((tool) => tool.id !== selectedTool.id);
  const realReadinessRows = firstRealReadinessRows(selectedMode, desktopReady);
  const visibleRealReadinessRows = realReadinessRows.slice(0, 1);
  const hiddenRealReadinessRows = realReadinessRows.slice(1);
  const firstRunRows = firstRunWizardRows(selectedMode, selectedTool.label, desktopReady, aiState);
  const providerReadyForProof = aiState === "live" || aiState === "ready";
  const firstRunProofRailRows = firstRunProofRows(aiLiveProofs, providerReadyForProof);
  const firstRunLiveGateReady = aiState === "live";
  const workConnectionHref = setupWorkConnectionHref(selectedMode, searchParams?.get("preview"));
  const activeSetupPageView = normalizeSetupPageView(setupPageView);
  const visibleFirstWorkTasks = activeSetupPageView === "all" ? firstWorkTasks : [selectedMode];
  const visibleFirstWorkTaskIds = new Set<FirstWorkTaskId>(visibleFirstWorkTasks.map((task) => task.id));
  const hiddenFirstWorkTasks = firstWorkTasks.filter((task) => !visibleFirstWorkTaskIds.has(task.id));
  const setupPageCustomized = activeSetupPageView !== "recommended";
  const setupLayoutSummary = getSetupPageViewSummary(activeSetupPageView, hiddenFirstWorkTasks.length);
  const setupNextPageRouteLinks = setupNextPageRoutes.map((route) => ({
    ...route,
    href: setupPageRouteHref(route.href, searchParams?.get("preview")),
  }));
  const primarySetupNextRoute = setupNextPageRouteLinks[0];
  const remainingSetupNextRoutes = setupNextPageRouteLinks.slice(1);
  const setupPageFocusCards = [
    {
      id: "recommended" as const,
      label: "추천",
      title: "지금 고른 일만 먼저",
      detail: hiddenFirstWorkTasks.length
        ? `현재 업무 1개만 먼저 보고 나머지 ${hiddenFirstWorkTasks.length}개는 업무 바꾸기 안에 둡니다.`
        : "현재 업무만 먼저 보고 바로 다음 단계로 이어갑니다.",
      countLabel: `${visibleFirstWorkTasks.length}개`,
      actionLabel: "추천 보기",
      state: "recommended",
    },
    {
      id: "all" as const,
      label: "전체",
      title: "모든 업무를 폴더처럼",
      detail: "익숙해진 뒤 메일, 문서, 폴더, 일정, 보고서, 반복, PC 업무를 한 번에 봅니다.",
      countLabel: `${firstWorkTasks.length}개`,
      actionLabel: "전체 업무 보기",
      state: "all",
    },
  ];
  const activeSetupPageFocusCard =
    setupPageFocusCards.find((card) => card.id === activeSetupPageView) ?? setupPageFocusCards[0];
  const otherSetupPageFocusCards = setupPageFocusCards.filter((card) => card.id !== activeSetupPageView);

  const selectSetupPageView = (nextView: SetupPageView) => {
    setSetupPageView(normalizeSetupPageView(nextView));
  };

  const resetSetupPageLayout = () => {
    setSetupPageView("recommended");
  };

  const goto = (nextStep: Step) => {
    setStep(nextStep);
    setSetupStep(nextStep);
  };

  const finish = () => {
    markSetupDone(true);
    router.replace(setupPreviewHref(selectedMode, searchParams?.get("preview")) as Route);
  };

  const prepareQuickStart = (tool: string) => {
    const defaultTask = firstWorkTasks[0];
    setWorkMode(defaultTask.id);
    setSetupWorkMode(defaultTask.id);
    setFirstTool(tool);
    setSetupToolMode(tool);
    markBasePicked(true);
    markToolPicked(true);
    return defaultTask;
  };

  const startWithoutSetup = () => {
    prepareQuickStart("later");
    setStep(3);
    setSetupStep(3);
    markSetupDone(true);
    router.replace(setupPageRouteHref("/", searchParams?.get("preview")) as Route);
  };

  const startAIOnly = () => {
    const defaultTask = prepareQuickStart("prepare");
    goto(2);
    router.push(setupAIConnectionHref(defaultTask, searchParams?.get("preview")) as Route);
  };

  const startMailOnly = () => {
    const defaultTask = prepareQuickStart("prepare");
    const href = setupWorkConnectionHref(defaultTask, searchParams?.get("preview"));
    if (!href) return;
    goto(2);
    router.push(href as Route);
  };

  return (
    <div className={styles.page}>
      <main className={styles.quickStartShell}>
        <section
          className={styles.quickStart}
          aria-label="처음 시작 빠른 선택"
          data-quick-start="skip_or_single_connection"
          data-quick-start-safety="external_actions_require_approval"
        >
          <header className={styles.quickStartHeader}>
            <span>처음 설정</span>
            <h1>설정은 지금 하지 않아도 됩니다</h1>
            <p>지금 필요한 것 하나만 누르세요. 나머지는 업무를 부탁할 때 필요한 순간에만 안내합니다.</p>
          </header>
          <div className={styles.quickStartActions} aria-label="빠른 시작 버튼">
            <button
              type="button"
              className={styles.quickStartPrimary}
              data-quick-start-action="start_without_setup"
              onClick={startWithoutSetup}
            >
              <strong>설정 없이 시작</strong>
              <span>홈으로 가서 하고 싶은 일을 한 줄로 말합니다.</span>
            </button>
          </div>
          <details
            className={styles.quickStartConnections}
            aria-label="연결해서 시작"
            data-quick-start-connections="ai_mail_on_demand"
            data-quick-start-connections-default="closed"
          >
            <summary>연결해서 시작</summary>
            <div className={styles.quickStartConnectionActions}>
              <button
                type="button"
                data-quick-start-action="connect_ai_only"
                onClick={startAIOnly}
              >
                <strong>AI 연결</strong>
              </button>
              <button
                type="button"
                data-quick-start-action="connect_mail_only"
                onClick={startMailOnly}
              >
                <strong>메일 연결</strong>
              </button>
            </div>
          </details>
          <p className={styles.quickStartSafety}>외부 실행은 승인 후</p>
        </section>

        <details
          className={styles.detailedSetup}
          aria-label="상세 초기 설정"
          data-detailed-setup="optional_after_quick_start"
          data-detailed-setup-default="closed"
        >
          <summary>다른 업무부터 시작하거나 세부 설정이 필요하면 열기</summary>
          <div className={styles.detailedSetupBody}>
            <header className={styles.header}>
        <div className={styles.progressBlock} aria-label={`기본 설정 진행률 ${progress}%`}>
          <div className={styles.progressCircle} style={{ "--setup-progress": `${progress}%` } as CSSProperties}>
            <span>{progress}%</span>
          </div>
          <div>
            <p>기본 설정</p>
            <h1>{stepCopy[step].title}</h1>
            <span>{stepCopy[step].desc}</span>
          </div>
        </div>
        <ol className={styles.stepRail} aria-label="온보딩 단계">
          {[1, 2, 3].map((item) => (
            <li key={item} data-state={step === item ? "active" : step > item ? "done" : "next"}>
              <span>{item}</span>
              <strong>{item === 1 ? "업무" : item === 2 ? "연결" : "완료"}</strong>
            </li>
          ))}
        </ol>
      </header>

            <section className={styles.panel}>
        <nav
          className={styles.setupPageViewTabs}
          aria-label="설정 화면 보기"
          data-setup-page-organization="recommended_all_details"
          data-setup-page-view={activeSetupPageView}
        >
          {setupPageViewTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-selected={activeSetupPageView === tab.id}
              data-active={activeSetupPageView === tab.id ? "true" : "false"}
              onClick={() => selectSetupPageView(tab.id)}
            >
              <strong>{tab.label}</strong>
              <span>{tab.detail}</span>
            </button>
          ))}
        </nav>
        <details
          className={styles.setupPageRouteFold}
          aria-label="첫 설정 다음 페이지 접힘"
          data-setup-page-map-fold="closed_summary_then_next_page_map"
          data-setup-page-map-default="closed"
          data-setup-page-map-body="hidden_until_user_opens"
        >
          <summary>
            <span>다음 위치</span>
            <strong>{primarySetupNextRoute.title}</strong>
            <small>설정 뒤에는 연결 화면 1개만 먼저 제안하고 나머지는 접습니다.</small>
          </summary>
          <section
            className={styles.setupPageRouteMap}
            aria-label="첫 설정 다음 페이지 지도"
            data-setup-page-map="connect_learn_office_account_home"
            data-page-map-customization="same_tab_format_user_start_view"
            data-page-map-route-disclosure="one_recommended_route_then_remaining_inside_details"
            data-page-map-primary-route="connect"
            data-page-map-visible-route-count="1"
            data-page-map-hidden-route-count={remainingSetupNextRoutes.length}
          >
            <header>
              <span>페이지 이동</span>
              <strong>다음에 볼 화면을 한 줄로 정리</strong>
              <small>연결부터 확인하고, 자료/승인/계정/홈은 필요할 때 엽니다.</small>
            </header>
            <div className={styles.setupPageRouteRack} aria-label="첫 설정 추천 이동과 나머지 페이지">
              <a
                className={styles.setupPagePrimaryRoute}
                href={primarySetupNextRoute.href}
                data-page-map-route={primarySetupNextRoute.id}
                data-state={primarySetupNextRoute.state}
              >
                <span>{primarySetupNextRoute.label}</span>
                <strong>{primarySetupNextRoute.title}</strong>
                <small>{primarySetupNextRoute.detail}</small>
              </a>
              <details
                className={styles.setupPageMoreRoutes}
                aria-label="첫 설정 나머지 페이지 이동"
                data-setup-page-map-more="remaining_routes_on_demand"
                data-setup-page-map-more-default="closed"
              >
                <summary>
                  <span>나머지 페이지</span>
                  <strong>{remainingSetupNextRoutes.length}개 접힘</strong>
                </summary>
                <ol>
                  {remainingSetupNextRoutes.map((route) => (
                    <li key={route.id} data-state={route.state}>
                      <a href={route.href} data-page-map-route={route.id}>
                        <span>{route.label}</span>
                        <strong>{route.title}</strong>
                        <small>{route.detail}</small>
                      </a>
                    </li>
                  ))}
                </ol>
              </details>
            </div>
          </section>
        </details>
        <details
          className={styles.setupFolderMap}
          aria-label="첫 설정 폴더 지도"
          data-setup-folder-map="recommended_all_slots"
          data-setup-folder-map-visible="summary_first_folder_slots_on_demand"
          data-setup-folder-map-default="closed"
          data-setup-folder-map-body="hidden_until_user_opens"
          data-setup-folder-map-details-default="closed"
          data-setup-page-view={activeSetupPageView}
          data-active-view-count={activeSetupPageFocusCard.countLabel}
        >
          <summary>
            <span>내 설정 화면</span>
            <strong>{activeSetupPageFocusCard.title}</strong>
            <small>{setupLayoutSummary} · 필요한 업무만 펼치기</small>
          </summary>
          <div className={styles.setupFolderMapBody}>
          <div className={styles.setupFolderHeader}>
            <span>설정 폴더</span>
            <strong>{activeSetupPageFocusCard.title}</strong>
            <small>{setupLayoutSummary} · 필요한 업무만 먼저 보고 나머지는 접습니다.</small>
          </div>
          <ol aria-label="첫 설정 폴더">
            {setupPageFocusCards.map((item) => (
              <li
                key={item.id}
                data-state={item.state}
                data-current={item.id === activeSetupPageView ? "true" : "false"}
              >
                <button type="button" onClick={() => selectSetupPageView(item.id)}>
                  <span>{item.label}</span>
                  <strong>{item.countLabel}</strong>
                  <small>{item.actionLabel}</small>
                </button>
              </li>
            ))}
          </ol>
          <details
            className={styles.setupFolderDetails}
            aria-label="첫 설정 구성 상세"
            data-setup-folder-details-default="closed"
          >
            <summary>
              <span>구성 정리</span>
              <strong>내 시작 화면과 보기별 설명</strong>
            </summary>
            <div className={styles.setupFolderDetailsBody}>
              <div
                className={styles.setupLayoutGuide}
                data-setup-page-customization="preferred_view_reset"
                data-page-layout-format="fixed_tabs_user_start_view"
                data-setup-page-view={activeSetupPageView}
                data-custom-layout={setupPageCustomized ? "true" : "false"}
                data-preferred-view-state={setupPageCustomized ? "custom" : "default"}
                aria-label="첫 설정 페이지 내 구성"
              >
                <div>
                  <span>내 시작 화면</span>
                  <strong>{setupPageViewLabel(activeSetupPageView)} 보기로 시작</strong>
                  <p>{setupLayoutSummary} · 탭 포맷은 유지하고 시작 화면만 바꿉니다.</p>
                </div>
                <button type="button" onClick={resetSetupPageLayout} disabled={activeSetupPageView === "recommended"}>
                  기본 보기
                </button>
              </div>
              <section
                className={styles.setupFocusSummary}
                aria-label="첫 설정 보기별 한눈에 보기"
                data-setup-page-focus-summary="active_view_first_then_other_views_on_demand"
                data-setup-page-view={activeSetupPageView}
                data-active-view-count={activeSetupPageFocusCard.countLabel}
                data-other-view-disclosure="one_next_view_no_more_for_two_tabs"
                data-other-view-visible-count={otherSetupPageFocusCards.length}
                data-other-view-hidden-count={0}
              >
                <article data-state={activeSetupPageFocusCard.state}>
                  <span>{activeSetupPageFocusCard.label}</span>
                  <strong>{activeSetupPageFocusCard.title}</strong>
                  <small>{activeSetupPageFocusCard.detail}</small>
                  <button type="button" onClick={() => selectSetupPageView(activeSetupPageFocusCard.id)}>
                    {activeSetupPageFocusCard.actionLabel}
                  </button>
                </article>
                <div className={styles.setupOtherViewRail} aria-label="첫 설정 다른 보기 요약">
                  <ol
                    className={styles.setupOtherViewList}
                    aria-label="첫 설정 바로 갈 다른 보기"
                    data-setup-page-other-view-list="one_next_view"
                  >
                    {otherSetupPageFocusCards.map((item) => (
                      <li key={item.id} data-state={item.state}>
                        <button type="button" onClick={() => selectSetupPageView(item.id)}>
                          <span>{item.label}</span>
                          <strong>{item.countLabel}</strong>
                          <small>{item.actionLabel}</small>
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              </section>
            </div>
          </details>
          </div>
        </details>

        {step === 1 ? (
          <section
            className={styles.section}
            aria-label="업무 유형 선택"
            data-setup-task-fold="selected_one_then_more_inside_details"
            data-setup-task-visible-count={visibleFirstWorkTasks.length}
            data-setup-task-hidden-count={hiddenFirstWorkTasks.length}
          >
            <div className={styles.sectionHead}>
              <strong>처음 맡길 업무</strong>
              <span>지금 고른 업무만 먼저 확인하고, 다른 업무는 필요할 때 바꿉니다.</span>
            </div>
            <div className={styles.choiceGrid} data-visible-task-count={visibleFirstWorkTasks.length}>
              {visibleFirstWorkTasks.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={workMode === mode.id ? styles.activeChoice : undefined}
                  data-feature-id={mode.featureId}
                  onClick={() => {
                    setWorkMode(mode.id);
                    setSetupWorkMode(mode.id);
                    setFirstTool("prepare");
                    setSetupToolMode("prepare");
                    markBasePicked(true);
                  }}
                >
                  <strong>{mode.label}</strong>
                  <small>{mode.desc}</small>
                </button>
              ))}
            </div>
            {hiddenFirstWorkTasks.length > 0 ? (
              <details className={styles.moreTaskDetails} data-setup-task-more-default="closed">
                <summary>
                  <span>업무 바꾸기 {hiddenFirstWorkTasks.length}개</span>
                  <em>다른 일을 맡길 때만 엽니다</em>
                </summary>
                <div className={styles.choiceGrid}>
                  {hiddenFirstWorkTasks.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={workMode === mode.id ? styles.activeChoice : undefined}
                      data-feature-id={mode.featureId}
                      onClick={() => {
                        setWorkMode(mode.id);
                        setSetupWorkMode(mode.id);
                        setFirstTool("prepare");
                        setSetupToolMode("prepare");
                        markBasePicked(true);
                      }}
                    >
                      <strong>{mode.label}</strong>
                      <small>{mode.desc}</small>
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
          </section>
        ) : null}

        {step === 2 ? (
          <section
            className={styles.section}
            aria-label="첫 연결 선택"
            data-setup-tool-fold="selected_one_then_more_inside_details"
            data-setup-tool-visible-count={visiblePreparationChoices.length}
            data-setup-tool-hidden-count={hiddenPreparationChoices.length}
          >
            <div className={styles.sectionHead}>
              <strong>{setupPreparationTitle(selectedMode)}</strong>
              <span>필요한 계정, 자료, 폴더를 앱 화면에서 한 가지씩 확인합니다.</span>
            </div>
            <div className={styles.choiceGrid} data-visible-tool-count={visiblePreparationChoices.length}>
              {visiblePreparationChoices.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  className={firstTool === tool.id ? styles.activeChoice : undefined}
                  onClick={() => {
                    setFirstTool(tool.id);
                    setSetupToolMode(tool.id);
                    markToolPicked(true);
                  }}
                >
                  <strong>{tool.label}</strong>
                  <small>{tool.desc}</small>
                </button>
              ))}
            </div>
            {hiddenPreparationChoices.length > 0 ? (
              <details className={styles.moreTaskDetails} data-setup-tool-more-default="closed">
                <summary>
                  <span>준비 방식 바꾸기 {hiddenPreparationChoices.length}개</span>
                  <em>미리보기, 승인함, 나중에 연결은 필요할 때 엽니다</em>
                </summary>
                <div className={styles.choiceGrid}>
                  {hiddenPreparationChoices.map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      className={firstTool === tool.id ? styles.activeChoice : undefined}
                      onClick={() => {
                        setFirstTool(tool.id);
                        setSetupToolMode(tool.id);
                        markToolPicked(true);
                      }}
                    >
                      <strong>{tool.label}</strong>
                      <small>{tool.desc}</small>
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
            <div className={styles.runtimeNote} data-state={desktopReady ? "ready" : "needs"}>
              <strong>{desktopReady ? "설치 앱 연결됨" : "설치 앱에서 실제 연결 가능"}</strong>
              <p>
                미리보기에서는 메일/파일을 가짜로 만들지 않습니다. 실제 읽기와 저장은
                설치 앱에서만 실행됩니다.
              </p>
            </div>
            <section
              className={styles.firstRunWizard}
              aria-label="첫 실행 마법사"
              data-first-run-wizard="ai_work_approval"
              data-ai-connection-state={aiState}
              data-ai-live-proof-state={firstRunLiveGateReady ? "live_proof_ready" : "live_proof_needed"}
              data-ai-live-proof-contract="provider_answer_role_assignment_mailops_workqueue"
              data-ai-role-proof-required="role_assignment_runtime_v1"
              data-ai-mailops-proof-required="role_assignment_to_work_automation_engine_v1"
              data-ai-fake-result-policy="no_live_receipt_no_work_candidate"
              data-desktop-runtime-state={desktopReady ? "desktop_ready" : "desktop_required"}
            >
              <header>
                <strong>첫 실행 순서</strong>
                <span>AI 연결, 첫 업무 연결, 승인함 테스트를 한 줄로 확인합니다.</span>
              </header>
              <ol>
                {firstRunRows.map((row, index) => (
                  <li
                    key={row.id}
                    data-first-run-step={row.id}
                    data-first-run-step-state={row.state}
                    data-first-run-step-passed={row.passed ? "true" : "false"}
                  >
                    <b>{index + 1}</b>
                    <div>
                      <span>{row.label}</span>
                      <strong>{row.result}</strong>
                      <small>{row.detail}</small>
                      <em>
                        첫 버튼:{" "}
                        {row.id === "ai" ? (
                          <a
                            href={setupAIConnectionHref(selectedMode, searchParams?.get("preview"))}
                            data-first-run-primary-action="ai_connection_route"
                            data-first-run-return-goal="setup_ai_then_work"
                          >
                            {row.action}
                          </a>
                        ) : row.id === "work" && workConnectionHref ? (
                          <a
                            href={workConnectionHref}
                            data-first-run-primary-action="work_connection_route"
                            data-first-run-return-goal="setup_work_then_approval"
                            data-first-run-work-setting={selectedMode.id === "schedule" ? "calendar-suggestions" : "mail-calendar"}
                          >
                            {row.action}
                          </a>
                        ) : (
                          row.action
                        )}
                      </em>
                    </div>
                  </li>
                ))}
              </ol>
              <details
                className={styles.setupDetailFold}
                aria-label="AI 실답변 역할 업무 증거"
                data-setup-proof-fold="summary_first_details_on_demand"
              >
                <summary>
                  <span>실답변 증거</span>
                  <em>연결, 역할, 업무큐, 실행 잠금</em>
                </summary>
                <div className={styles.firstRunProofStrip}>
                  {firstRunProofRailRows.map((row) => (
                    <div
                      key={row.id}
                      data-ai-live-proof-step={row.id}
                      data-ai-live-proof-step-state={row.state}
                    >
                      <span>{row.label}</span>
                      <strong>{row.value}</strong>
                      <small>{row.detail}</small>
                    </div>
                  ))}
                </div>
              </details>
            </section>
            <details
              className={styles.realReadinessRail}
              aria-label="실제 읽기 확인 기준"
              data-setup-readiness-fold="summary_first_rule_then_more_on_demand"
              data-setup-readiness-visible-count={visibleRealReadinessRows.length}
              data-setup-readiness-hidden-count={hiddenRealReadinessRows.length}
              data-setup-live-readiness="real_read_only_no_fake_success"
              data-external-action-lock="approval_required_before_mutation"
              data-first-user-check="next_button_approval_log_memory_visible"
            >
              <summary>
                <strong>되는 척하지 않는 기준</strong>
                <span>{visibleRealReadinessRows[0]?.title ?? "실제 읽기부터"} · 나머지 {hiddenRealReadinessRows.length}개는 펼침</span>
              </summary>
              <ol data-setup-readiness-list="all_rules_inside_details">
                {[...visibleRealReadinessRows, ...hiddenRealReadinessRows].map((row) => (
                  <li key={row.id} data-state={row.state}>
                    <span>{row.label}</span>
                    <div>
                      <strong>{row.title}</strong>
                      <small>{row.detail}</small>
                    </div>
                  </li>
                ))}
              </ol>
            </details>
          </section>
        ) : null}

        {step === 3 ? (
          <section className={styles.done} aria-label="설정 완료">
            <span aria-hidden="true">✓</span>
            <h2>이제 업무실로 들어갑니다</h2>
            <p>
              선택한 기준: {selectedMode.label} · 첫 준비: {selectedTool.label}. 고급 연결은 필요할 때만
              안쪽에서 확인합니다. 업무실에서는 이 선택의 쉬운 세팅 미리보기를 바로 엽니다.
            </p>
            <dl>
              <div>
                <dt>복잡한 준비</dt>
                <dd>앱이 대신 정리</dd>
              </div>
              <div>
                <dt>실제 읽기</dt>
                <dd>{desktopReady ? "준비됨" : "설치 앱 필요"}</dd>
              </div>
              <div>
                <dt>외부 실행</dt>
                <dd>사용자 승인 후</dd>
              </div>
            </dl>
          </section>
        ) : null}
            </section>

            <footer className={styles.actions}>
        {step > 1 ? (
          <button type="button" className={styles.secondary} onClick={() => goto((step - 1) as Step)}>
            이전
          </button>
        ) : (
          <span />
        )}
        {step < 3 ? (
          <button
            type="button"
            className={styles.primary}
            disabled={step === 1 ? !workMode : !firstTool}
            onClick={() => goto((step + 1) as Step)}
          >
            다음
          </button>
        ) : (
          <button type="button" className={styles.primary} onClick={finish}>
            업무실 열기
          </button>
        )}
            </footer>
          </div>
        </details>
      </main>
    </div>
  );
}
