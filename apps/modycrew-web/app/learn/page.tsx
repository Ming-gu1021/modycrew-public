"use client";

import { useEffect, useMemo, useState } from "react";
import { documentDraftDisplay } from "@/lib/document-draft-display";
import {
  createDesktopBridge,
  type DesktopBridgeApi,
  type DocumentAutomationRecommendation,
  type DocumentLearnedOutputDraft,
  type DocumentLearningClassifyResult,
  type DocumentLearningFileRecord,
  type DocumentLearningFolderSource,
  type DocumentLearningFolderPlanResult,
  type DocumentLearningFolderPlanPreviewResult,
  type DocumentLearningIndexSearchResult,
} from "@/lib/desktop-bridge";
import {
  activateFeature,
  isFeatureActive,
  readFeatureActivationRecords,
  type ModyFeatureActivationRecord,
} from "@/lib/feature-activation";
import { modyTaxBeginnerGuide } from "@domain/tax-management-basics";
import { modyWorkPackCatalog } from "@domain/work-pack";
import styles from "./page.module.css";

const selectedKinds = ["word", "excel", "spreadsheet", "pdf", "report"];
const defaultSearchQuery = "";
const workPackTitleById = new Map<string, string>(modyWorkPackCatalog.map((pack) => [pack.id, pack.title]));
const learnPageViewStorageKey = "modycrew-learn-page-view-v1";

type LearnPageView = "start" | "memory" | "handoff" | "search";

const learnPageViewOrder: LearnPageView[] = ["start", "memory", "handoff", "search"];

type AutomationHandoffStep = {
  label: string;
  detail: string;
};

type AutomationPreviewCard = {
  id: string;
  title: string;
  detail: string;
  stateLabel: string;
  workPackId: string;
  confidencePercent: number;
  sourceLabels: string[];
  suggestedRuleLabel: string;
  workPackTitle: string;
  outputLabel: string;
  outputDraftTarget: string;
  outputHandoffLabel: string;
  outputApprovalGateLabel: string;
  learnedStyleGuidance: string[];
  learnedDraftTitle?: string;
  learnedDraftPreview?: string;
  learnedDraftApprovalGateLabel?: string;
  handoffSteps: AutomationHandoffStep[];
  href?: string;
};

type LearningExecutionBoundaryItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  state: "small" | "workspace" | "setting" | "approval";
};

type FolderPlanApprovalBoundaryItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  state: "dry-run" | "choice" | "approval" | "office";
};

function readStoredLearnPageView(): LearnPageView {
  if (typeof window === "undefined") return "start";
  try {
    return normalizeLearnPageView(window.localStorage.getItem(learnPageViewStorageKey));
  } catch {
    return "start";
  }
}

function normalizeLearnPageView(value: unknown): LearnPageView {
  return value === "memory" || value === "handoff" || value === "search" || value === "start" ? value : "start";
}

function buildLearningExecutionBoundaryRail(input: {
  hasFiles: boolean;
  hasLearningMemory: boolean;
  hasFolderPlan: boolean;
  localStorageRoot: string;
}): LearningExecutionBoundaryItem[] {
  return [
    {
      id: "small",
      label: "빠른 시작",
      title: input.hasFiles ? "선택 자료 읽기" : "자료 선택부터",
      detail: "채팅에서 시작한 자료 읽기와 검색 후보는 원본 변경 없이 결과만 만듭니다.",
      state: "small",
    },
    {
      id: "workspace",
      label: "큰 작업실",
      title: input.hasLearningMemory || input.hasFolderPlan ? "학습/정리 작업실" : "자료 학습 작업실",
      detail: "여러 폴더, 드라이브, 보고서 양식, 정리 그룹은 이 자료 학습 화면에서 넓게 확인합니다.",
      state: "workspace",
    },
    {
      id: "setting",
      label: "필요 설정",
      title: input.localStorageRoot ? "기억 위치 고정" : "기억 위치만 선택",
      detail: input.localStorageRoot ? input.localStorageRoot : "D드라이브 같은 저장 위치는 기억 위치 설정만 따로 엽니다.",
      state: "setting",
    },
    {
      id: "approval",
      label: "승인 잠금",
      title: input.hasFolderPlan ? "정리 적용 전 잠금" : "원본 변경 잠금",
      detail: "파일 이동, 삭제, 이름 변경, 외부 발송은 실행 전 미리보기와 사용자 최종 승인 뒤에만 진행합니다.",
      state: "approval",
    },
  ];
}

function buildFolderPlanApprovalBoundary(input: {
  hasFolderPlan: boolean;
  operationCount: number;
  addedInboxItemsCount: number;
  reportPath: string;
}): FolderPlanApprovalBoundaryItem[] {
  return [
    {
      id: "dry-run",
      label: "실행 전 미리보기",
      title: input.operationCount > 0 ? `${input.operationCount}개 후보` : "후보만 생성",
      detail: input.hasFolderPlan
        ? "원본 파일 이동·삭제는 실행하지 않았습니다."
        : "정리 기준을 만들기 전까지 원본은 그대로 둡니다.",
      state: "dry-run",
    },
    {
      id: "choice",
      label: "정리 방식",
      title: "프로젝트·날짜·파일 종류 선택",
      detail: "기본 방식 외 다른 정리 기준은 적용 전 다시 물어봅니다.",
      state: "choice",
    },
    {
      id: "approval",
      label: "승인 잠금",
      title: "최종 적용 전 멈춤",
      detail: "파일 이동, 삭제, 이름 변경은 앱 최종 승인 뒤에만 실행합니다.",
      state: "approval",
    },
    {
      id: "office",
      label: "오피스 승인함",
      title: input.addedInboxItemsCount > 0 ? `${input.addedInboxItemsCount}개 승인 카드` : "승인 카드 대기",
      detail: input.addedInboxItemsCount > 0 ? "오피스 승인함에서 미리보기 근거와 리포트를 확인합니다." : "승인 카드 저장은 아직 확인되지 않았습니다. 정리 미리보기와 저장 상태를 확인해 주세요.",
      state: "office",
    },
  ];
}

function formatSize(bytes?: number): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "크기 확인 전";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKindLabel(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "docx") return "Word";
  if (extension === "xlsx") return "Excel";
  if (extension === "pdf") return "PDF";
  if (extension === "csv") return "CSV";
  if (extension === "md") return "Markdown";
  return "Text";
}

function createWorkPackHandoffHref(
  workPackId: string,
  suggestedRuleLabel: string,
  confidence: number,
  sourceLabels: string[],
): string {
  const params = new URLSearchParams();
  params.set("workPack", workPackId);
  params.set("from", "learn");
  params.set("intent", suggestedRuleLabel);
  params.set("confidence", String(Math.round(confidence * 100)));
  const evidenceLabels = sourceLabels.slice(0, 3).filter(Boolean);
  if (evidenceLabels.length) params.set("evidence", evidenceLabels.join(" · "));
  return `/?${params.toString()}`;
}

function workPackTitleLabel(workPackId: string): string {
  return workPackTitleById.get(workPackId) ?? "추천 업무팩";
}

function createAutomationHandoffSteps(
  workPackId: string,
  suggestedRuleLabel: string,
  sourceLabels: string[],
  handoffLabel?: string,
  approvalGateLabel?: string,
): AutomationHandoffStep[] {
  const evidenceLabel = sourceLabels.slice(0, 2).join(" · ") || "선택 자료 출처";
  return [
    { label: "근거 묶기", detail: evidenceLabel },
    { label: "업무팩 설치", detail: `${handoffLabel ?? workPackTitleLabel(workPackId)} 기능만 켜기` },
    { label: "꺼진 반복 업무", detail: suggestedRuleLabel },
    { label: "승인 점검", detail: approvalGateLabel ?? "실제 발송·등록 전 확인" },
  ];
}

function fallbackOutputPlanForWorkPack(workPackId: string) {
  if (workPackId === "inquiry_response") {
    return {
      label: "메일/메신저 답장 초안",
      draftTarget: "상담 문의와 FAQ 형식을 반영한 답장 후보",
      handoffLabel: "메일 점검",
      approvalGateLabel: "고객 답장 발송 전 승인",
    };
  }
  if (workPackId === "schedule_coordination") {
    return {
      label: "일정 후보와 안내 문장",
      draftTarget: "운영 기준과 가능 시간을 반영한 일정 후보",
      handoffLabel: "Calendar FinalAction",
      approvalGateLabel: "캘린더 등록 전 승인",
    };
  }
  if (workPackId === "inventory_reorder") {
    return {
      label: "표 기반 점검 후보",
      draftTarget: "기존 기준표 형식을 반영한 점검표",
      handoffLabel: "운영 점검",
      approvalGateLabel: "발주 요청 전 승인",
    };
  }
  if (workPackId === "tax_contract_archive") {
    return {
      label: "세금·계약 정리표",
      draftTarget: "월별 증빙 묶음과 계약 위험 체크리스트",
      handoffLabel: "세금·계약 자료 정리",
      approvalGateLabel: "세무사 전달·계약 제출 전 승인",
    };
  }
  return {
    label: "보고서/인수인계 초안",
    draftTarget: "기존 보고서·정산표 양식을 반영한 문서 초안",
    handoffLabel: "문서 작성",
    approvalGateLabel: "보고서 공유 전 승인",
  };
}

export default function LearnPage() {
  const [bridge, setBridge] = useState<DesktopBridgeApi | null>(null);
  const [featureRecords, setFeatureRecords] = useState<ModyFeatureActivationRecord[]>([]);
  const [files, setFiles] = useState<DocumentLearningFileRecord[]>([]);
  const [sourceFolders, setSourceFolders] = useState<DocumentLearningFolderSource[]>([]);
  const [localStorageRoot, setLocalStorageRoot] = useState("");
  const [learningResult, setLearningResult] = useState<DocumentLearningClassifyResult | null>(null);
  const [folderPlan, setFolderPlan] = useState<DocumentLearningFolderPlanResult | null>(null);
  const [folderPlanPreview, setFolderPlanPreview] = useState<DocumentLearningFolderPlanPreviewResult | null>(null);
  const [searchQuery, setSearchQuery] = useState(defaultSearchQuery);
  const [searchResult, setSearchResult] = useState<DocumentLearningIndexSearchResult | null>(null);
  const [busy, setBusy] = useState<"files" | "folders" | "root" | "learn" | "plan" | "search" | "open" | null>(null);
  const [statusMessage, setStatusMessage] = useState("자료를 고르면 학습 상자가 열립니다.");
  const [learningFeedback, setLearningFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [learnPageView, setLearnPageView] = useState<LearnPageView>(readStoredLearnPageView);

  const isLearningActive = isFeatureActive(featureRecords, "document_learning");
  const learnedCount = learningResult?.summary?.extractedReady ?? 0;
  const groupCount = learningResult?.summary?.groups ?? folderPlan?.groups?.length ?? 0;
  const searchCount = searchResult?.results.length ?? learningResult?.searchHits?.length ?? 0;
  const automationRecommendations =
    learningResult?.automationRecommendations ?? folderPlan?.automationRecommendations ?? [];
  const learnedOutputDrafts = learningResult?.learnedOutputDrafts ?? folderPlan?.learnedOutputDrafts ?? [];
  const learnedDraftWorkItems = learningResult?.learnedDraftWorkItems ?? folderPlan?.learnedDraftWorkItems ?? [];
  const draftDisplay = documentDraftDisplay(learningResult ?? folderPlan);
  const learnedDraftInboxAddedCount = draftDisplay.stagedCount;
  const learnedDraftReviewRequired = draftDisplay.reviewRequired;
  const recommendationCount = automationRecommendations.length;
  const learningProgress = Math.min(
    100,
    Math.round(
      ((isLearningActive ? 1 : 0) +
        (files.length > 0 ? 1 : 0) +
        (localStorageRoot ? 1 : 0) +
        (learnedCount > 0 ? 2 : 0) +
        (recommendationCount > 0 ? 1 : 0) +
        (searchCount > 0 ? 1 : 0)) /
        7 *
        100,
    ),
  );
  const trimmedSearchQuery = searchQuery.trim();
  const hasFiles = files.length > 0;
  const hasIndexReady = Boolean(localStorageRoot || learningResult?.localStorageRoot);
  const hasLearningMemory = learnedCount > 0 || groupCount > 0;
  const activeLearnPageView = normalizeLearnPageView(learnPageView);
  const learnPageCustomized = activeLearnPageView !== "start";
  const learnLayoutSummary = getLearnPageViewSummary({
    view: activeLearnPageView,
    hasFiles,
    hasLearningMemory,
    recommendationCount,
    searchCount,
  });
  const folderPlanOperationCount = folderPlanPreview?.operationCount ?? Number(folderPlan?.filePlans?.length ?? 0);
  const folderPlanPreviewOperations = folderPlanPreview?.operations?.slice(0, 4) ?? [];
  const folderPlanApplySafetyReview = folderPlanPreview?.applySafetyReview;
  const folderPlanCollisionPolicies = folderPlanApplySafetyReview?.collisionPolicies ?? [];
  const folderPlanExclusionOptions = folderPlanApplySafetyReview?.exclusionOptions ?? [];
  const folderPlanApprovalBoundaryItems = buildFolderPlanApprovalBoundary({
    hasFolderPlan: Boolean(folderPlan),
    operationCount: folderPlanOperationCount,
    addedInboxItemsCount: folderPlanPreview?.addedInboxItemsCount ?? 0,
    reportPath: folderPlanPreview?.reportPath || folderPlan?.reportPath || "",
  });
  const automationPreviewCards = useMemo(
    () => createAutomationPreviewCards(files, automationRecommendations, learnedOutputDrafts, hasLearningMemory),
    [automationRecommendations, files, hasLearningMemory, learnedOutputDrafts],
  );
  const visibleAutomationPreviewCards = automationPreviewCards.slice(0, 1);
  const hiddenAutomationPreviewCards = automationPreviewCards.slice(1);
  const visibleAutomationRecommendations = automationRecommendations.slice(0, 1);
  const hiddenAutomationRecommendations = automationRecommendations.slice(1);
  const canRunLearning = hasFiles && !busy;
  const canSearch = !busy && hasIndexReady && trimmedSearchQuery.length > 0;
  const indexSearchResultRows = searchResult?.results ?? [];
  const visibleIndexSearchResultRows = indexSearchResultRows.slice(0, 1);
  const hiddenIndexSearchResultRows = indexSearchResultRows.slice(1);
  const learnedSearchHitRows = learningResult?.searchHits ?? [];
  const visibleLearnedSearchHitRows = learnedSearchHitRows.slice(0, 1);
  const hiddenLearnedSearchHitRows = learnedSearchHitRows.slice(1);
  const revealedBoxCount =
    (hasFiles ? 1 : 0) +
    (hasIndexReady || folderPlan ? 1 : 0) +
    (hasLearningMemory ? 1 : 0) +
    (recommendationCount > 0 ? 1 : 0) +
    (searchResult?.results.length || learningResult?.searchHits?.length ? 1 : 0);
  const learningStageLabel = busy
    ? "진행 중"
    : hasLearningMemory
      ? "업무 기억 준비"
      : hasFiles
        ? "자료 선택됨"
        : "기본 화면";
  const learningStageHint = hasLearningMemory
    ? "검색과 자동화 근거 상자가 열렸습니다."
    : hasFiles
      ? "이제 업무 기억을 만들 수 있습니다."
      : "처음에는 자료 선택만 보입니다.";
  const shouldShowLearningSummary = hasFiles || hasIndexReady || hasLearningMemory || busy !== null;
  const shouldShowAutomationHandoff = hasLearningMemory && automationPreviewCards.length > 0;
  const learningExecutionBoundaryItems = buildLearningExecutionBoundaryRail({
    hasFiles,
    hasLearningMemory,
    hasFolderPlan: Boolean(folderPlan),
    localStorageRoot: localStorageRoot || learningResult?.localStorageRoot || "",
  });
  const visibleLearningExecutionBoundaryItems = learningExecutionBoundaryItems.slice(0, 1);
  const hiddenLearningExecutionBoundaryItems = learningExecutionBoundaryItems.slice(1);
  const learnPageFocusCards = getLearnPageFocusCards({
    hasFiles,
    hasLearningMemory,
    recommendationCount,
    searchCount,
    revealedBoxCount,
  });
  const activeLearnPageFocusCard =
    learnPageFocusCards.find((item) => item.id === activeLearnPageView) ?? learnPageFocusCards[0];
  const activeLearnPageViewIndex = Math.max(learnPageViewOrder.indexOf(activeLearnPageView), 0);
  const orderedOtherLearnPageViews = [
    ...learnPageViewOrder.slice(activeLearnPageViewIndex + 1),
    ...learnPageViewOrder.slice(0, activeLearnPageViewIndex),
  ];
  const orderedOtherLearnPageFocusCards = orderedOtherLearnPageViews
    .map((view) => learnPageFocusCards.find((item) => item.id === view))
    .filter((item): item is NonNullable<(typeof learnPageFocusCards)[number]> => Boolean(item));
  const visibleOtherLearnPageFocusCards = orderedOtherLearnPageFocusCards.slice(0, 1);
  const hiddenOtherLearnPageFocusCards = orderedOtherLearnPageFocusCards.slice(1);

  const selectedPreview = useMemo(() => files.slice(0, 6), [files]);
  const automationMemoryCards = [
    {
      title: "업무 방식",
      value: `${groupCount}개 그룹`,
      detail: "파일명과 폴더 패턴에서 월별 보고, 정산, 상담, 매뉴얼 흐름을 잡습니다.",
    },
    {
      title: "업무 근거",
      value: `${learnedCount}개 자료`,
      detail: "원본은 컴퓨터에 두고 자료 검색 기록과 출처만 업무 자동화에 연결합니다.",
    },
    {
      title: "인수인계 답변",
      value: `${searchCount}개 후보`,
      detail: "다음 사람이 물어볼 질문에 출처가 있는 자료 후보로 답하게 만듭니다.",
    },
    {
      title: "추천 자동화",
      value: `${recommendationCount}개 후보`,
      detail: "자료 분류 결과를 업무팩, 승인 기준, 꺼진 반복 업무 후보로 연결합니다.",
    },
    {
      title: "승인 초안",
      value: `${learnedDraftWorkItems.length}개 후보`,
      detail: learnedDraftReviewRequired
        ? `승인함 저장 확인 ${learnedDraftInboxAddedCount}개 · 나머지는 현재 학습 화면에서만 전체 내용을 확인할 수 있습니다.`
        : learnedDraftInboxAddedCount
          ? `${learnedDraftInboxAddedCount}개 초안이 오피스 승인함에 올라갔습니다.`
          : "학습한 형식의 초안 후보입니다. 승인함 저장은 확인되지 않았습니다.",
    },
  ];

  useEffect(() => {
    setFeatureRecords(readFeatureActivationRecords());
    setBridge(createDesktopBridge());
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(learnPageViewStorageKey, activeLearnPageView);
    } catch {
      // 저장소가 막힌 환경에서는 현재 세션 안에서만 자료 학습 보기 방식을 유지합니다.
    }
  }, [activeLearnPageView]);

  const ensureLearningFeature = () => {
    if (!isFeatureActive(featureRecords, "document_learning")) {
      setFeatureRecords(activateFeature("document_learning", "컴퓨터 자료 기반 업무 기억 활성화"));
    }
  };

  const selectLearnPageView = (nextView: LearnPageView) => {
    const normalizedView = normalizeLearnPageView(nextView);
    setLearnPageView(normalizedView);
    setStatusMessage(`${learnPageViewLabel(normalizedView)} 보기로 정리했습니다.`);
  };

  const resetLearnPageLayout = () => {
    setLearnPageView("start");
    setStatusMessage("시작 보기로 돌아왔습니다.");
  };

  const handleChooseFiles = async () => {
    if (!bridge) return;
    ensureLearningFeature();
    setBusy("files");
    try {
      const result = await bridge.chooseDocumentLearningFiles();
      setFiles(result.files ?? []);
      setSourceFolders([]);
      setFolderPlan(null);
      setFolderPlanPreview(null);
      setStatusMessage(result.userMessage ?? "자료 파일 선택 결과를 확인했습니다.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "자료 파일 선택에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const handleChooseFolders = async (
    knownFolder: "desktop" | "documents" | "downloads" | "home" | "" = "",
    mode: "add" | "replace" = "add",
  ) => {
    if (!bridge) return;
    ensureLearningFeature();
    setBusy("folders");
    setLearningFeedback(null);
    try {
      const result = await bridge.chooseDocumentLearningFolders({
        knownFolder,
        maxFiles: 10000,
        maxDepth: knownFolder ? 8 : 32,
      });
      const cancelled = /cancelled|canceled/u.test(result.status);
      const failed = /failed|error|denied|required/u.test(result.status);
      const nextFiles = result.files ?? [];
      const nextFolders = result.folders ?? [];
      const message = result.userMessage?.trim() || (cancelled ? "폴더 선택을 취소했습니다." : failed ? "폴더 자료를 읽지 못했습니다. 다시 선택해 주세요." : nextFiles.length ? "선택한 폴더에서 자료를 확인했습니다." : "이 폴더에는 읽을 수 있는 자료가 없습니다. 다른 폴더를 선택해 주세요.");
      setStatusMessage(message);
      setLearningFeedback({ message, error: failed });
      if (cancelled || failed || (!nextFiles.length && !nextFolders.length)) return;
      setFiles((current) => mode === "replace" ? nextFiles : mergeDocumentLearningFiles(current, nextFiles));
      setSourceFolders((current) => mode === "replace" ? nextFolders : mergeDocumentLearningFolders(current, nextFolders));
      if (mode === "replace") {
        setLearningResult(null);
        setSearchResult(null);
        setLearnPageView("start");
      }
      setFolderPlan(null);
      setFolderPlanPreview(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "폴더 자료 선택에 실패했습니다.";
      setStatusMessage(message);
      setLearningFeedback({ message, error: true });
    } finally {
      setBusy(null);
    }
  };

  const handleChooseRoot = async () => {
    if (!bridge) return;
    ensureLearningFeature();
    setBusy("root");
    try {
      const result = await bridge.chooseDocumentLearningRoot();
      setLocalStorageRoot(result.localStorageRoot ?? "");
      setStatusMessage(result.userMessage ?? "자료 검색 저장 위치를 확인했습니다.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "저장 위치 선택에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const handleRunLearning = async () => {
    if (!bridge) return;
    ensureLearningFeature();
    setBusy("learn");
    setLearningFeedback(null);
    try {
      const result = await bridge.classifyDocumentLearning({
        files,
        localStorageRoot,
        selectedKinds,
        searchQuery,
      });
      if (result.status === "document_learning_drafts_need_review") {
        const message = result.userMessage?.trim() || "자료 근거를 다시 확인해 주세요. 이번 결과는 저장하지 않았습니다.";
        setLearningResult(null);
        setStatusMessage(message);
        setLearningFeedback({ message, error: true });
        return;
      }
      const failed = /failed|error|denied|required|no_files/u.test(result.status);
      const message = result.userMessage?.trim() || (failed ? "자료를 읽지 못했습니다. 다시 시도해 주세요." : "자료 읽기 결과를 확인했습니다.");
      setStatusMessage(message);
      setLearningFeedback({ message, error: failed });
      if (failed) return;
      setLearningResult(result);
      if (result.localStorageRoot) setLocalStorageRoot(result.localStorageRoot);
      setLearnPageView("memory");
    } catch (error) {
      const message = error instanceof Error ? error.message : "자료 학습 실행에 실패했습니다.";
      setStatusMessage(message);
      setLearningFeedback({ message, error: true });
    } finally {
      setBusy(null);
    }
  };

  const handleCreateFolderPlan = async () => {
    if (!bridge) return;
    ensureLearningFeature();
    setBusy("plan");
    try {
      const result = await bridge.createDocumentLearningFolderPlan({
        files,
        localStorageRoot,
        selectedKinds,
      });
      if (result.status === "document_learning_drafts_need_review") {
        setFolderPlan(null);
        setFolderPlanPreview(null);
        setStatusMessage(result.userMessage?.trim() || "자료 근거를 다시 확인해 주세요. 이번 정리 계획은 저장하지 않았습니다.");
        return;
      }
      const nextLocalStorageRoot = result.localStorageRoot || localStorageRoot;
      setFolderPlan(result);
      if (result.localStorageRoot) setLocalStorageRoot(result.localStorageRoot);
      try {
        const preview = await bridge.previewDocumentLearningFolderPlan({
          localStorageRoot: nextLocalStorageRoot,
        });
        setFolderPlanPreview(preview);
        setStatusMessage(preview.userMessage ?? result.userMessage ?? "폴더 정리 계획을 만들었습니다.");
      } catch {
        setFolderPlanPreview(null);
        setStatusMessage(
          `${result.userMessage ?? "폴더 정리 계획을 만들었습니다."} 실행 전 미리보기는 다시 확인 필요합니다.`,
        );
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "폴더 정리 계획 생성에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const handleSearch = async () => {
    if (!bridge) return;
    ensureLearningFeature();
    setBusy("search");
    try {
      const result = await bridge.searchDocumentLearningIndex({
        localStorageRoot: localStorageRoot || learningResult?.localStorageRoot,
        query: trimmedSearchQuery,
      });
      setSearchResult(result);
      setStatusMessage(result.userMessage ?? "로컬 업무 기억을 검색했습니다.");
      setLearnPageView("search");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "로컬 업무 기억 검색에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const handleOpenIndex = async () => {
    if (!bridge) return;
    setBusy("open");
    try {
      const result = await bridge.openDocumentLearningIndex({
        localStorageRoot: localStorageRoot || learningResult?.localStorageRoot,
      });
      setStatusMessage(result.userMessage ?? "자료 검색 폴더를 열었습니다.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "자료 검색 폴더를 열지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  // "파일 만들어/찾아주고 폴더 위치 주고" — 검색 결과의 실제 파일을 바로 열거나,
  // 그 파일이 들어있는 폴더를 탐색기에서 열어 위치를 알려줍니다(원본 변경 없음).
  const handleOpenFile = async (filePath?: string) => {
    if (!bridge || !filePath) return;
    setBusy("open");
    try {
      const result = await bridge.openDocumentLearningFile({ path: filePath });
      setStatusMessage(result.userMessage ?? "로컬 파일 열기 요청을 보냈습니다.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "로컬 파일을 열지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const handleRevealFolder = async (filePath?: string) => {
    if (!bridge || !filePath) return;
    setBusy("open");
    try {
      const result = await bridge.revealDocumentLearningPath({ path: filePath });
      setStatusMessage(result.userMessage ?? "파일이 있는 폴더 위치를 열었습니다.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "파일 위치를 열지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const legacyPage = (
    <section className={styles.memoryWorkbench} aria-label="업무 기억 학습">
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>자료 학습</span>
          <h1>폴더와 메일을 고르면 업무틀을 만듭니다</h1>
          <p>선택한 자료에서 답장·보고서·반복 업무를 찾습니다.</p>
          <div className={styles.heroActions}>
            <button type="button" onClick={handleChooseFiles} disabled={Boolean(busy)}>
              {hasFiles ? "자료 다시 선택" : "자료 선택"}
            </button>
            <button type="button" onClick={() => handleChooseFolders("")} disabled={Boolean(busy)}>
              폴더/드라이브 추가
            </button>
            {hasFiles ? (
              <button type="button" onClick={handleRunLearning} disabled={!canRunLearning}>
                업무 기억 만들기
              </button>
            ) : null}
            {hasIndexReady ? (
              <button type="button" onClick={handleSearch} disabled={!canSearch}>
              질문 검색
            </button>
            ) : null}
          </div>
          <details
            className={styles.quickLocationFold}
            data-learning-location-fold="common_locations_on_demand"
          >
            <summary>
              <span>자주 쓰는 위치</span>
              <em>필요할 때 열기</em>
            </summary>
            <div className={styles.quickLocationActions}>
              <button type="button" onClick={() => handleChooseFolders("desktop")} disabled={Boolean(busy)}>
                바탕화면 보기
              </button>
              <button type="button" onClick={() => handleChooseFolders("documents")} disabled={Boolean(busy)}>
                문서 보기
              </button>
              <button type="button" onClick={() => handleChooseFolders("downloads")} disabled={Boolean(busy)}>
                다운로드 보기
              </button>
            </div>
          </details>
          <section
            className={styles.learningFirstPath}
            aria-label="자료 학습 첫 흐름"
            data-learning-first-path="choose_preview_approval"
            data-primary-button={hasFiles ? "자료 다시 선택" : "자료 선택"}
            data-preview-step="읽기 미리보기"
            data-approval-step="승인 후보"
            data-final-action-lock="save_share_send_rename_delete_until_office_approval"
            data-mobile-safe-width="390"
          >
            <div data-step="choose">
              <span>1</span>
              <strong>{hasFiles ? "자료 선택됨" : "자료 선택"}</strong>
              <small>{hasFiles ? `${files.length}개 준비됨` : "파일·폴더 선택"}</small>
            </div>
            <div data-step="preview">
              <span>2</span>
              <strong>읽기 미리보기</strong>
              <small>요약·근거 확인</small>
            </div>
            <div data-step="approval">
              <span>3</span>
              <strong>승인 후보</strong>
              <small>변경은 승인 후</small>
            </div>
          </section>
          <details
            className={styles.learningStartSupportFold}
            aria-label="자료 학습 보조 정보"
            data-learning-start-support-fold="scope_progress_prompt_on_demand"
            data-learning-start-support-default="closed"
            data-learning-start-support-visible="first_path_only_scope_progress_prompt_folded"
          >
            <summary>
              <span>보조 정보</span>
              <strong>범위, 진행 순서, 내장 기준</strong>
              <em>필요할 때 열기</em>
            </summary>
            <div className={styles.learningStartSupportBody}>
              <section className={styles.scopePanel} aria-label="자료 접근 범위">
                <div>
                  <strong>읽는 범위</strong>
                  <span>{sourceFolders.length ? `${sourceFolders.length}개 위치 · ${files.length}개 파일` : "아직 선택 전"}</span>
                </div>
                <p>바탕화면, 문서, 다운로드, 여러 업무 폴더, 드라이브 루트까지 사용자가 직접 고른 범위만 읽습니다.</p>
                {sourceFolders.length ? (
                  <ol>
                    {sourceFolders.slice(0, 4).map((folder) => (
                      <li key={folder.id}>
                        <span>{sourceKindLabel(folder.sourceKind)}</span>
                        <strong>{folder.label}</strong>
                        <small>{folder.fileCount}개 파일</small>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </section>
              <ol className={styles.learnSetupLane} aria-label="자료 학습 진행 순서">
                <li data-state={hasFiles ? "done" : busy === "files" ? "active" : "active"}>
                  <span>1</span>
                  <strong>자료 선택</strong>
                  <small>{hasFiles ? `${files.length}개 자료 선택됨` : "컴퓨터 안 폴더와 업무 파일을 사용자가 직접 고릅니다."}</small>
                </li>
                <li data-state={hasLearningMemory ? "done" : hasFiles || busy === "learn" ? "active" : "next"}>
                  <span>2</span>
                  <strong>업무틀 만들기</strong>
                  <small>{hasLearningMemory ? `${learnedCount}개 근거 준비` : "답장 톤, 보고서 양식, 정산·상담 흐름을 추론합니다."}</small>
                </li>
                <li data-state={shouldShowAutomationHandoff ? "done" : hasLearningMemory ? "active" : "next"}>
                  <span>3</span>
                  <strong>자동화 후보 확인</strong>
                  <small>업무팩과 첫 반복 업무는 홈에서 승인 후 켭니다.</small>
                </li>
              </ol>
              <section
                className={styles.workTemplatePromptPanel}
                aria-label="내장 업무틀 프롬프트"
                data-learning-page-panel="work-template-prompt-fold"
              >
                <div className={styles.workTemplatePromptHead}>
                  <span>내장 프롬프트</span>
                  <strong>자료와 계정 연결을 업무 방식으로 바꾸는 기준</strong>
                </div>
                <ol>
                  <li>
                    <strong>분류</strong>
                    <small>메일, 보고서, 정산표, 상담 기록, 양식을 먼저 나눕니다.</small>
                  </li>
                  <li>
                    <strong>업무틀</strong>
                    <small>반복 답장, 보고서 목차, 일정 확인 질문, 승인 기준을 자동 생성합니다.</small>
                  </li>
                  <li>
                    <strong>승인</strong>
                    <small>발송, 일정 등록, 파일 변경은 최종 확인 전까지 잠급니다.</small>
                  </li>
                </ol>
              </section>
            </div>
          </details>
        </div>
        <aside className={styles.statusPanel}>
          <div className={styles.memoryMotion} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span>{bridge?.isAvailable ? "설치 앱 연결됨" : "설치 앱 필요"} · {learningStageLabel}</span>
          <strong>{learningProgress}%</strong>
          <p>{statusMessage}</p>
          <div className={styles.progressLine} aria-label={`자료 학습 진행률 ${learningProgress}%`}>
            <i style={{ width: `${learningProgress}%` }} />
          </div>
        </aside>
      </header>

      <nav
        className={styles.learnPageViewTabs}
        aria-label="자료 학습 보기 방식"
        data-learning-page-organization="start_memory_handoff_search"
        data-learning-page-tab-format="summary_memory_work_search_fixed"
        data-learning-page-tab-visible="base_label_only_detail_in_folder_map"
        data-learning-page-tab-detail-default="hidden"
        data-learning-page-user-config="preferred_view_per_page"
        data-learning-page-view={activeLearnPageView}
      >
        {getLearnPageViewTabs({
          hasFiles,
          hasLearningMemory,
          recommendationCount,
          searchCount,
        }).map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-label={`자료 학습 ${learnPageViewBaseLabel(tab.id)} 보기 · ${tab.label}`}
            aria-selected={activeLearnPageView === tab.id}
            data-learning-page-tab={tab.id}
            data-learning-page-tab-role={learnPageViewBaseLabel(tab.id)}
            data-active={activeLearnPageView === tab.id ? "true" : "false"}
            onClick={() => selectLearnPageView(tab.id)}
          >
            <span>{learnPageViewBaseLabel(tab.id)}</span>
            <small>
              <b>{tab.label}</b>
              {" · "}
              {tab.detail}
            </small>
          </button>
        ))}
      </nav>

      <details
        className={styles.learnFolderMap}
        aria-label="자료 학습 폴더 지도"
        data-learning-folder-map="start_memory_handoff_search_slots"
        data-learning-folder-map-visible="summary_first_folder_slots_on_demand"
        data-learning-folder-map-default="closed"
        data-learning-folder-map-body="hidden_until_user_opens"
        data-learning-folder-map-details-default="closed"
        data-learning-page-view={activeLearnPageView}
        data-active-view-count={activeLearnPageFocusCard.countLabel}
      >
        <summary>
          <span>내 자료 화면</span>
          <strong>{activeLearnPageFocusCard.title}</strong>
          <small>{learnLayoutSummary} · 필요한 폴더만 펼치기</small>
        </summary>
        <div className={styles.learnFolderMapBody}>
        <div className={styles.learnFolderHeader}>
          <span>자료 폴더</span>
          <strong>{activeLearnPageFocusCard.title}</strong>
          <small>{learnLayoutSummary} · 필요한 폴더만 열고 나머지는 접습니다.</small>
        </div>
        <ol aria-label="자료 학습 폴더">
          {learnPageFocusCards.map((item) => (
            <li
              key={item.id}
              data-state={item.state}
              data-current={item.id === activeLearnPageView ? "true" : "false"}
            >
              <button type="button" onClick={() => selectLearnPageView(item.id)}>
                <span>{item.label}</span>
                <strong>{item.countLabel}</strong>
                <small>{item.actionLabel}</small>
              </button>
            </li>
          ))}
        </ol>
        <details
          className={styles.learnFolderDetails}
          aria-label="자료 학습 구성 상세"
          data-learning-folder-details-default="closed"
        >
          <summary>
            <span>구성 정리</span>
            <strong>내 시작 화면과 보기별 설명</strong>
          </summary>
          <div className={styles.learnFolderDetailsBody}>
            <aside
              className={styles.learnLayoutGuide}
              data-learning-page-customization="preferred_view_reset"
              data-page-layout-format="fixed_tabs_user_start_view"
              data-learning-page-view={activeLearnPageView}
              data-custom-layout={learnPageCustomized ? "true" : "false"}
              data-preferred-view-state={learnPageCustomized ? "custom" : "default"}
              aria-label="자료 학습 페이지 내 구성"
            >
              <div>
                <span>내 시작 화면</span>
                <strong>{learnPageViewLabel(activeLearnPageView)} 보기로 시작</strong>
                <small>{learnLayoutSummary} · 탭 포맷은 유지하고 시작 화면만 바꿉니다.</small>
              </div>
              <p data-learning-layout-helper="desktop_only_context">
                {learnPageCustomized ? "현재 보기가 저장됨" : "기본은 자료 선택과 실행 경계만 먼저 표시"}
              </p>
              <button type="button" onClick={resetLearnPageLayout} disabled={activeLearnPageView === "start"}>
                기본 보기
              </button>
            </aside>
            <section
              className={styles.learnFocusSummary}
              aria-label="자료 학습 보기별 한눈에 보기"
              data-learning-page-focus-summary="active_view_first_then_other_views_on_demand"
              data-learning-page-view={activeLearnPageView}
              data-active-view-count={activeLearnPageFocusCard.countLabel}
              data-other-view-disclosure="all_other_views_inside_details"
              data-other-view-visible-count={visibleOtherLearnPageFocusCards.length}
              data-other-view-hidden-count={hiddenOtherLearnPageFocusCards.length}
            >
              <article data-state={activeLearnPageFocusCard.state}>
                <span>{activeLearnPageFocusCard.label}</span>
                <strong>{activeLearnPageFocusCard.title}</strong>
                <small>{activeLearnPageFocusCard.detail}</small>
                <button type="button" onClick={() => selectLearnPageView(activeLearnPageFocusCard.id)}>
                  {activeLearnPageFocusCard.actionLabel}
                </button>
              </article>
              <details
                className={styles.learnOtherViewsFold}
                aria-label="자료 학습 다른 보기 접힘"
                data-learning-page-other-views-fold="all_other_views_on_demand"
                data-learning-page-other-views-default="closed"
                data-learning-page-other-views-body="hidden_until_user_opens"
              >
                <summary>
                  <span>다른 보기</span>
                  <strong>{visibleOtherLearnPageFocusCards.length + hiddenOtherLearnPageFocusCards.length}개</strong>
                </summary>
                <div className={styles.learnOtherViewRail} aria-label="자료 학습 다른 보기 요약">
                  <ol
                    className={styles.learnOtherViewList}
                    aria-label="자료 학습 바로 갈 다른 보기"
                    data-learning-page-other-view-list="one_next_view"
                  >
                    {visibleOtherLearnPageFocusCards.map((item) => (
                      <li key={item.id} data-state={item.state}>
                        <button type="button" onClick={() => selectLearnPageView(item.id)}>
                          <span>{item.label}</span>
                          <strong>{item.countLabel}</strong>
                          <small>{item.actionLabel}</small>
                        </button>
                      </li>
                    ))}
                  </ol>
                  {hiddenOtherLearnPageFocusCards.length ? (
                    <details
                      className={styles.learnFocusMore}
                      aria-label="자료 학습 나머지 보기"
                      data-learning-page-other-views-more="remaining_views_collapsed"
                      data-learning-page-other-views-more-default="closed"
                    >
                      <summary>
                        <span>나머지 보기</span>
                        <strong>{hiddenOtherLearnPageFocusCards.length}개 접힘</strong>
                      </summary>
                      <ol>
                        {hiddenOtherLearnPageFocusCards.map((item) => (
                          <li key={item.id} data-state={item.state}>
                            <button type="button" onClick={() => selectLearnPageView(item.id)}>
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
          </div>
        </details>
        </div>
      </details>

      {activeLearnPageView === "start" ? (
      <section
        className={styles.learningExecutionBoundary}
        aria-label="자료 학습 실행 경계"
        data-learning-page-panel="start-boundary"
        data-learning-start-boundary="summary_first_details_on_demand"
        data-learning-start-visible-box-count={revealedBoxCount}
      >
        <header>
          <div>
            <span>실행 경계</span>
            <strong>원본은 바꾸지 않습니다</strong>
          </div>
          <small>변경은 승인 후</small>
        </header>
        <details
          className={styles.learningBoundaryDetails}
          data-learning-boundary-fold="summary_first_rule_then_more_on_demand"
          data-learning-boundary-count={learningExecutionBoundaryItems.length}
          data-learning-boundary-visible-count={visibleLearningExecutionBoundaryItems.length}
          data-learning-boundary-hidden-count={hiddenLearningExecutionBoundaryItems.length}
        >
          <summary>
            <span>안전 기준 자세히 보기</span>
            <em>{visibleLearningExecutionBoundaryItems[0]?.title ?? "원본 보존"} · 나머지 {hiddenLearningExecutionBoundaryItems.length}개</em>
          </summary>
          <ol data-learning-boundary-list="all_rules_inside_details">
            {[...visibleLearningExecutionBoundaryItems, ...hiddenLearningExecutionBoundaryItems].map((item) => (
              <li key={item.id} data-state={item.state}>
                <span>{item.label}</span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </li>
            ))}
          </ol>
        </details>
      </section>
      ) : null}

      {!shouldShowLearningSummary && activeLearnPageView === "start" ? (
        <section
          className={styles.learningEmptyState}
          aria-label="자료 선택 후 열리는 상자"
          data-learning-empty-state="pick_one_action"
        >
          <div>
            <strong>자료를 먼저 선택하세요</strong>
            <p>고른 자료만 읽고 원본은 그대로 둡니다.</p>
          </div>
          <button type="button" onClick={handleChooseFiles} disabled={Boolean(busy)}>
            자료 선택
          </button>
        </section>
      ) : null}

      {shouldShowLearningSummary && activeLearnPageView === "start" ? (
        <section className={styles.learningSummary} aria-label={`열린 자료 학습 상자 ${revealedBoxCount}개`}>
          <div>
            <strong>{learningStageHint}</strong>
            <span>{revealedBoxCount}개 상자 열림</span>
          </div>
          <ol className={styles.learningSteps}>
            <li data-state={hasFiles ? "done" : busy === "files" ? "active" : "todo"}>
              <span>1</span>
              <strong>자료</strong>
              <small>{hasFiles ? `${files.length}개` : "대기"}</small>
            </li>
            <li data-state={hasIndexReady ? "done" : busy === "learn" || busy === "plan" ? "active" : "todo"}>
              <span>2</span>
              <strong>기억</strong>
              <small>{hasLearningMemory ? `${learnedCount}개` : "대기"}</small>
            </li>
            <li data-state={searchCount > 0 ? "done" : busy === "search" ? "active" : "todo"}>
              <span>3</span>
              <strong>검색</strong>
              <small>{searchCount > 0 ? `${searchCount}개` : "대기"}</small>
            </li>
            <li data-state={recommendationCount > 0 ? "done" : hasLearningMemory ? "active" : "todo"}>
              <span>4</span>
              <strong>추천</strong>
              <small>{recommendationCount > 0 ? `${recommendationCount}개` : "대기"}</small>
            </li>
          </ol>
        </section>
      ) : null}

      {activeLearnPageView === "handoff" && shouldShowAutomationHandoff ? (
        <section
          className={styles.handoffPanel}
          aria-label="자료에서 바로 만들 업무"
          data-learning-handoff-disclosure="first_one_then_more_inside_details"
          data-learning-handoff-visible-limit="1"
          data-learning-handoff-visible-count={visibleAutomationPreviewCards.length}
          data-learning-handoff-hidden-count={hiddenAutomationPreviewCards.length}
        >
          <div className={styles.panelHead}>
            <h2>자료에서 바로 만들 업무</h2>
            <span>
              {hiddenAutomationPreviewCards.length
                ? `먼저 ${visibleAutomationPreviewCards.length}개 · 나머지 ${hiddenAutomationPreviewCards.length}개 접힘`
                : "추천 확정 · 기본 꺼짐"}
            </span>
          </div>
          <div className={styles.handoffGrid}>
            {visibleAutomationPreviewCards.map((item) => (
              <article key={item.id} className={styles.handoffCard} data-state={hasLearningMemory ? "ready" : "preview"}>
                <div>
                  <span>{item.stateLabel}</span>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
                <dl>
                  <div>
                    <dt>근거</dt>
                    <dd>{item.sourceLabels.slice(0, 2).join(" · ") || "선택 자료"}</dd>
                  </div>
                  <div>
                    <dt>신뢰도</dt>
                    <dd>{item.confidencePercent}%</dd>
                  </div>
                  <div>
                    <dt>업무팩</dt>
                    <dd>{item.workPackTitle}</dd>
                  </div>
                  <div>
                    <dt>만들 결과</dt>
                    <dd>{item.outputLabel}</dd>
                  </div>
                  <div>
                    <dt>형식 기준</dt>
                    <dd>{item.outputDraftTarget}</dd>
                  </div>
                  <div>
                    <dt>승인 잠금</dt>
                    <dd>{item.outputApprovalGateLabel}</dd>
                  </div>
                </dl>
                {item.learnedDraftPreview ? (
                  <section className={styles.learnedDraftPreview} aria-label={`${item.title} 학습 초안 미리보기`}>
                    <span>학습 초안</span>
                    <strong>{item.learnedDraftTitle}</strong>
                    <p>{item.learnedDraftPreview}</p>
                    <small>{item.learnedDraftApprovalGateLabel ?? item.outputApprovalGateLabel}</small>
                  </section>
                ) : null}
                <ol className={styles.handoffSteps} aria-label={`${item.title} 자동화 전환 단계`}>
                  {item.handoffSteps.map((step, index) => (
                    <li key={`${item.id}:${step.label}`}>
                      <span>{index + 1}</span>
                      <div>
                        <strong>{step.label}</strong>
                        <small>{step.detail}</small>
                      </div>
                    </li>
                  ))}
                </ol>
                {item.href ? (
                  <a href={item.href}>업무팩으로 만들기</a>
                ) : (
                  <button type="button" onClick={handleRunLearning} disabled={!canRunLearning}>
                    먼저 업무 기억 만들기
                  </button>
                )}
              </article>
            ))}
          </div>
          {hiddenAutomationPreviewCards.length ? (
            <details
              className={styles.handoffMoreFold}
              aria-label="나머지 업무화 후보"
              data-learning-handoff-more="remaining_work_candidates_on_demand"
              data-learning-handoff-more-count={hiddenAutomationPreviewCards.length}
            >
              <summary>
                <span>나머지 업무화 후보</span>
                <strong>{hiddenAutomationPreviewCards.length}개 더 보기</strong>
              </summary>
              <ol>
                {hiddenAutomationPreviewCards.map((item) => (
                  <li key={`more-handoff-${item.id}`}>
                    <span>{item.confidencePercent}%</span>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.outputLabel} · {item.outputApprovalGateLabel}</small>
                    </div>
                    {item.href ? <a href={item.href}>열기</a> : <button type="button" onClick={handleRunLearning} disabled={!canRunLearning}>기억 만들기</button>}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          <div className={styles.handoffPathNotice}>
            <strong>홈으로 이동하면 이어집니다</strong>
            <p>
              추천 신뢰도와 자료 근거가 업무팩 설치 카드에 붙고,
              {learnedDraftReviewRequired
                ? " 일부 초안은 기존 카드 보존 또는 저장 확인을 위해 승인함에 올라가지 않았습니다. 현재 학습 화면에서 내용을 확인해 주세요."
                : learnedDraftInboxAddedCount
                  ? ` ${learnedDraftInboxAddedCount}개 학습 초안은 오피스 승인함에서 수정/승인할 수 있습니다.`
                  : " 첫 반복 업무는 기본 꺼짐 상태로 표시됩니다."}
            </p>
          </div>
        </section>
      ) : null}

      {activeLearnPageView === "handoff" && !shouldShowAutomationHandoff ? (
        <section className={styles.learningViewEmpty} aria-label="업무화 준비 전 안내" data-learning-page-panel="handoff-empty">
          <strong>업무화 후보는 자료 학습 후 열립니다</strong>
          <p>먼저 자료를 선택하고 업무 기억을 만들면 답장, 보고서, 정산, 상담 흐름 같은 후보를 여기에서 확인합니다.</p>
          <button type="button" onClick={() => selectLearnPageView("start")}>자료 선택으로 돌아가기</button>
        </section>
      ) : null}

      {activeLearnPageView === "start" && hasFiles ? (
        <details className={styles.fileFold}>
          <summary>
            <span>선택된 자료</span>
            <em>{files.length}개</em>
          </summary>
          <section className={styles.filePanel} aria-label="선택된 자료">
            <ul className={styles.fileList}>
              {selectedPreview.map((file) => (
                <li key={file.id}>
                  <span>{fileKindLabel(file.fileName)}</span>
                  <strong>{file.fileName}</strong>
                  <small>{formatSize(file.sizeBytes)}</small>
                </li>
              ))}
            </ul>
          </section>
        </details>
      ) : null}

      {activeLearnPageView === "start" && hasFiles ? (
        <details className={styles.foldPanel}>
          <summary>
            <span>자료 정리 옵션</span>
            <em>{hasIndexReady ? "저장 위치 준비" : "필요할 때 열기"}</em>
          </summary>
          <section className={styles.pipelinePanel} aria-label="자료 학습 단계">
            <ol className={styles.pipeline}>
              <li data-state={hasFiles ? "done" : "todo"}>
                <strong>자료 선택</strong>
                <p>사용자가 고른 파일만 읽습니다.</p>
              </li>
              <li data-state={localStorageRoot ? "done" : "todo"}>
                <strong>저장 위치</strong>
                <p>자료 검색 기록을 내 컴퓨터에 둡니다.</p>
              </li>
              <li data-state={learnedCount > 0 ? "done" : "todo"}>
                <strong>업무 방식</strong>
                <p>반복 양식과 보고 흐름을 찾습니다.</p>
              </li>
              <li data-state={searchCount > 0 ? "done" : "todo"}>
                <strong>질문 답변</strong>
                <p>출처 있는 후보를 보여줍니다.</p>
              </li>
            </ol>
            <div className={styles.pipelineActions}>
              <button type="button" onClick={handleChooseRoot} disabled={Boolean(busy)}>
                저장 위치 선택
              </button>
              <button type="button" onClick={handleCreateFolderPlan} disabled={!canRunLearning}>
                정리 계획 만들기
              </button>
              <button type="button" onClick={handleOpenIndex} disabled={!hasIndexReady || Boolean(busy)}>
                검색 폴더 열기
              </button>
            </div>
          </section>
          {folderPlan || folderPlanPreview ? (
            <section className={styles.folderPlanDryRunPanel} aria-label="폴더 정리 실행 전 미리보기 승인 경계">
              <div className={styles.folderPlanDryRunHead}>
                <div>
                  <span>실행 전 미리보기</span>
                  <strong>폴더 정리 후보는 승인 전까지 원본을 건드리지 않습니다</strong>
                </div>
                <small>{folderPlanOperationCount > 0 ? `${folderPlanOperationCount}개 후보` : "후보 생성"}</small>
              </div>
              <ol className={styles.folderPlanApprovalRail}>
                {folderPlanApprovalBoundaryItems.map((item) => (
                  <li key={item.id} data-state={item.state}>
                    <span>{item.label}</span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </li>
                ))}
              </ol>
              {folderPlanPreviewOperations.length ? (
                <ul className={styles.folderPlanOperationList} aria-label="정리 후보 미리보기">
                  {folderPlanPreviewOperations.map((operation) => (
                    <li key={operation.id}>
                      <span>{operation.status === "dry_run_only" ? "미리보기만" : operation.status}</span>
                      <strong>{operation.fileName}</strong>
                      <small>{operation.targetFolder}</small>
                    </li>
                  ))}
                </ul>
              ) : null}
              {folderPlanApplySafetyReview ? (
                <div className={styles.folderPlanSafetyReview} aria-label="정리 적용 전 제외와 충돌 처리">
                  <div>
                    <span>적용 전 확인</span>
                    <strong>{folderPlanApplySafetyReview.confirmationTextRequired}</strong>
                    <small>{folderPlanApplySafetyReview.defaultOrganizedRoot}</small>
                  </div>
                  <ul>
                    {folderPlanCollisionPolicies.map((policy) => (
                      <li key={policy.id} data-selected={policy.selected ? "true" : "false"}>
                        <strong>{policy.label}</strong>
                        <small>{policy.detail}</small>
                      </li>
                    ))}
                  </ul>
                  <p>{folderPlanExclusionOptions.join(" · ")}</p>
                </div>
              ) : null}
              <div className={styles.folderPlanEvidence}>
                <strong>정리 리포트</strong>
                <p>{folderPlanPreview?.userMessage ?? folderPlan?.userMessage ?? "정리 계획을 만들었습니다."}</p>
                <small>{folderPlanPreview?.reportPath || folderPlan?.reportPath || "리포트 생성 후 표시"}</small>
              </div>
            </section>
          ) : null}
        </details>
      ) : null}

      {activeLearnPageView === "memory" && hasLearningMemory ? (
        <section className={styles.memoryPanel} aria-label="업무 자동화 기억">
          <div className={styles.panelHead}>
            <h2>자동화에 쓰일 기억</h2>
            <span>{learningProgress}%</span>
          </div>
          <div className={styles.memoryCards}>
            {automationMemoryCards.map((card) => (
              <article key={card.title}>
                <span>{card.title}</span>
                <strong>{card.value}</strong>
                <p>{card.detail}</p>
              </article>
            ))}
          </div>
          {automationRecommendations.length ? (
            <section
              className={styles.recommendationPanel}
              aria-label="자료 기반 자동화 추천"
              data-learning-recommendation-disclosure="first_one_then_more_inside_details"
              data-learning-recommendation-visible-limit="1"
              data-learning-recommendation-visible-count={visibleAutomationRecommendations.length}
              data-learning-recommendation-hidden-count={hiddenAutomationRecommendations.length}
            >
              <div className={styles.panelHead}>
                <h3>추천 업무팩</h3>
                <span>
                  {hiddenAutomationRecommendations.length
                    ? `먼저 ${visibleAutomationRecommendations.length}개 · 나머지 ${hiddenAutomationRecommendations.length}개 접힘`
                    : `${automationRecommendations.length}개 후보 · 기본 꺼짐`}
                </span>
              </div>
              <ol className={styles.recommendationList}>
                {visibleAutomationRecommendations.map((item) => (
                  <li key={item.id}>
                    <div>
                      <span>{Math.round(item.confidence * 100)}%</span>
                      <strong>{item.title}</strong>
                      <p>{item.reason}</p>
                    </div>
                    <small>{item.suggestedRuleLabel}</small>
                    {item.outputPlan ? (
                      <dl className={styles.recommendationOutputPlan}>
                        <div>
                          <dt>만들 결과</dt>
                          <dd>{item.outputPlan.label}</dd>
                        </div>
                        <div>
                          <dt>형식 기준</dt>
                          <dd>{item.outputPlan.draftTarget}</dd>
                        </div>
                        <div>
                          <dt>승인 잠금</dt>
                          <dd>{item.outputPlan.approvalGateLabel}</dd>
                        </div>
                      </dl>
                    ) : null}
                    {item.workPackId === "tax_contract_archive" ? (
                      <section
                        className={styles.taxArchivePreview}
                        aria-label="세금·계약 자료 정리함 미리보기"
                        data-tax-contract-archive-view="month_kind_counterparty_status_next_action"
                        data-tax-contract-archive-boundary="metadata_preview_only_office_approval_before_share_submit_sign"
                      >
                        <header>
                          <span>정리함 보기</span>
                          <strong>월별 증빙과 계약 확인표</strong>
                        </header>
                        <dl>
                          <div>
                            <dt>월</dt>
                            <dd>파일명 기준 월별 묶음</dd>
                          </div>
                          <div>
                            <dt>자료 종류</dt>
                            <dd>세금계산서·현금영수증·계약서</dd>
                          </div>
                          <div>
                            <dt>거래처</dt>
                            <dd>{item.sourceLabels.slice(0, 2).join(" · ") || "자료에서 확인"}</dd>
                          </div>
                          <div>
                            <dt>다음 행동</dt>
                            <dd>누락/위험 문구 확인 후 승인</dd>
                          </div>
                        </dl>
                        <section
                          className={styles.taxBeginnerGuide}
                          aria-label="처음 쓰는 사업자 세금관리 지도"
                          data-tax-beginner-guide="sales_purchase_contract_settlement_payroll"
                        >
                          <strong>{modyTaxBeginnerGuide.title}</strong>
                          <p>매출, 매입/비용, 계약, 정산, 인건비 자료를 먼저 나눠 보면 세금 흐름이 보입니다.</p>
                          <ul>
                            {modyTaxBeginnerGuide.evidenceGuides.slice(0, 4).map((guide) => (
                              <li key={guide.id}>
                                <span>{guide.appBucket}</span>
                                <em>{guide.label}</em>
                              </li>
                            ))}
                          </ul>
                          <small>{modyTaxBeginnerGuide.monthlyRoutine.slice(0, 3).join(" · ")}</small>
                        </section>
                        <small>원본 이동, 공유, 제출, 서명은 오피스 승인함 전까지 잠깁니다.</small>
                      </section>
                    ) : null}
                    {learnedOutputDrafts.find((draft) => draft.recommendationId === item.id) ? (
                      <section className={styles.recommendationDraftPreview} aria-label={`${item.title} 작성 가능한 초안`}>
                        <span>작성 가능한 초안</span>
                        <strong>{learnedOutputDrafts.find((draft) => draft.recommendationId === item.id)?.title}</strong>
                        <p>{previewMarkdown(learnedOutputDrafts.find((draft) => draft.recommendationId === item.id)?.markdown ?? "")}</p>
                        <details>
                          <summary>현재 초안 전체 보기</summary>
                          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{learnedOutputDrafts.find((draft) => draft.recommendationId === item.id)?.markdown ?? ""}</pre>
                          <small>이 화면의 초안은 저장이 확인되지 않았다면 화면을 닫거나 다시 학습한 뒤 보관이 보장되지 않습니다.</small>
                        </details>
                        <small>{learnedOutputDrafts.find((draft) => draft.recommendationId === item.id)?.approvalGateLabel}</small>
                      </section>
                    ) : null}
                    <em>{item.sourceLabels.slice(0, 2).join(" · ") || "자료 근거 확인 필요"}</em>
                    <a
                      href={createWorkPackHandoffHref(
                        item.workPackId,
                        item.suggestedRuleLabel,
                        item.confidence,
                        item.sourceLabels,
                      )}
                    >
                      업무팩으로 만들기
                    </a>
                  </li>
                ))}
              </ol>
              {hiddenAutomationRecommendations.length ? (
                <details
                  className={styles.recommendationMoreFold}
                  aria-label="나머지 추천 업무팩"
                  data-learning-recommendation-more="remaining_recommendations_on_demand"
                  data-learning-recommendation-more-count={hiddenAutomationRecommendations.length}
                >
                  <summary>
                    <span>나머지 추천 업무팩</span>
                    <strong>{hiddenAutomationRecommendations.length}개 더 보기</strong>
                  </summary>
                  <ol>
                    {hiddenAutomationRecommendations.map((item) => (
                      <li key={`more-recommendation-${item.id}`}>
                        <span>{Math.round(item.confidence * 100)}%</span>
                        <div>
                          <strong>{item.title}</strong>
                          <small>{item.suggestedRuleLabel}</small>
                        </div>
                        <a
                          href={createWorkPackHandoffHref(
                            item.workPackId,
                            item.suggestedRuleLabel,
                            item.confidence,
                            item.sourceLabels,
                          )}
                        >
                          열기
                        </a>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </section>
          ) : null}
          <details className={styles.inlineFold}>
            <summary>어디에 쓰이나</summary>
            <div className={styles.sourceMap}>
              <div>
                <strong>컴퓨터 자료</strong>
                <small>보고서, 매뉴얼, 정산표</small>
              </div>
              <div>
                <strong>연결 툴 자료</strong>
                <small>메일, 캘린더, 문의함</small>
              </div>
              <div>
                <strong>업무 실행</strong>
                <small>초안, 일정 후보, 승인 요청</small>
              </div>
            </div>
          </details>
        </section>
      ) : null}

      {activeLearnPageView === "memory" && !hasLearningMemory ? (
        <section className={styles.learningViewEmpty} aria-label="업무 기억 준비 전 안내" data-learning-page-panel="memory-empty">
          <strong>아직 보여줄 업무 기억이 없습니다</strong>
          <p>자료 선택 후 업무 기억을 만들면 그룹, 근거, 승인 초안, 추천 자동화가 이 탭에 정리됩니다.</p>
          <button type="button" onClick={() => selectLearnPageView("start")}>자료 선택으로 돌아가기</button>
        </section>
      ) : null}

      {activeLearnPageView === "search" && hasIndexReady ? (
        <section className={styles.searchPanel} aria-label="인수인계 질문 검색">
          <div className={styles.panelHead}>
            <h2>인수인계 질문</h2>
            <span>{searchCount ? `${searchCount}개 후보` : "질문 대기"}</span>
          </div>
          <div className={styles.searchRow}>
            <input
              id="learning-search-query"
              name="learningSearchQuery"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="예: 월말 정산은 어떻게 처리해?"
            />
            <button type="button" onClick={handleSearch} disabled={!canSearch}>
              검색
            </button>
          </div>
          {searchResult?.results.length ? (
            <>
              <ul
                className={styles.searchResults}
                data-learning-search-results="first_one_then_more_inside_details"
                data-learning-search-result-source="live_search"
                data-learning-search-visible-count={visibleIndexSearchResultRows.length}
                data-learning-search-hidden-count={hiddenIndexSearchResultRows.length}
              >
                {visibleIndexSearchResultRows.map((result) => (
                  <li key={result.id}>
                    <strong>{result.title}</strong>
                    <p>{result.summary}</p>
                    <small>{result.kind} · {result.matchedTerms?.join(", ") || "관련 자료"}</small>
                    {result.path ? (
                      <div
                        className={styles.searchResultLocation}
                        data-learning-search-result-path="true"
                      >
                        <code>{result.path}</code>
                        <div className={styles.searchResultLocationActions}>
                          <button type="button" onClick={() => handleOpenFile(result.path)} disabled={busy === "open"}>
                            파일 열기
                          </button>
                          <button type="button" onClick={() => handleRevealFolder(result.path)} disabled={busy === "open"}>
                            폴더 위치 열기
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {hiddenIndexSearchResultRows.length ? (
                <details
                  className={styles.searchMoreFold}
                  aria-label="나머지 검색 결과"
                  data-learning-search-more="remaining_results_on_demand"
                  data-learning-search-more-count={hiddenIndexSearchResultRows.length}
                  data-learning-search-more-default="closed"
                >
                  <summary>나머지 검색 결과 {hiddenIndexSearchResultRows.length}개</summary>
                  <ul className={styles.searchResults}>
                    {hiddenIndexSearchResultRows.map((result) => (
                      <li key={`more-${result.id}`}>
                        <strong>{result.title}</strong>
                        <p>{result.summary}</p>
                        <small>{result.kind} · {result.matchedTerms?.join(", ") || "관련 자료"}</small>
                        {result.path ? (
                          <div
                            className={styles.searchResultLocation}
                            data-learning-search-result-path="true"
                          >
                            <code>{result.path}</code>
                            <div className={styles.searchResultLocationActions}>
                              <button type="button" onClick={() => handleOpenFile(result.path)} disabled={busy === "open"}>
                                파일 열기
                              </button>
                              <button type="button" onClick={() => handleRevealFolder(result.path)} disabled={busy === "open"}>
                                폴더 위치 열기
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : learningResult?.searchHits?.length ? (
            <>
              <ul
                className={styles.searchResults}
                data-learning-search-results="first_one_then_more_inside_details"
                data-learning-search-result-source="learned_hits"
                data-learning-search-visible-count={visibleLearnedSearchHitRows.length}
                data-learning-search-hidden-count={hiddenLearnedSearchHitRows.length}
              >
                {visibleLearnedSearchHitRows.map((hit) => (
                  <li key={`${hit.title}:${hit.citation}`}>
                    <strong>{hit.title}</strong>
                    <p>{hit.preview}</p>
                    <small>{hit.citation}</small>
                  </li>
                ))}
              </ul>
              {hiddenLearnedSearchHitRows.length ? (
                <details
                  className={styles.searchMoreFold}
                  aria-label="나머지 검색 결과"
                  data-learning-search-more="remaining_results_on_demand"
                  data-learning-search-more-count={hiddenLearnedSearchHitRows.length}
                  data-learning-search-more-default="closed"
                >
                  <summary>나머지 검색 결과 {hiddenLearnedSearchHitRows.length}개</summary>
                  <ul className={styles.searchResults}>
                    {hiddenLearnedSearchHitRows.map((hit) => (
                      <li key={`more-${hit.title}:${hit.citation}`}>
                        <strong>{hit.title}</strong>
                        <p>{hit.preview}</p>
                        <small>{hit.citation}</small>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : (
            <div className={styles.emptyBox}>
              <strong>질문을 입력하면 검색합니다</strong>
              <p>학습된 자료 검색 기록에서 출처가 있는 후보만 보여줍니다.</p>
            </div>
          )}
        </section>
      ) : null}

      {activeLearnPageView === "search" && !hasIndexReady ? (
        <section className={styles.learningViewEmpty} aria-label="검색 준비 전 안내" data-learning-page-panel="search-empty">
          <strong>검색은 저장 위치가 준비되면 열립니다</strong>
          <p>자료를 학습하거나 저장 위치를 선택하면 인수인계 질문을 출처 있는 후보로 검색할 수 있습니다.</p>
          <button type="button" onClick={() => selectLearnPageView("start")}>자료 선택으로 돌아가기</button>
        </section>
      ) : null}
    </section>
  );


  void legacyPage;
  const selectedFolderLabel = sourceFolders.length === 1
    ? sourceFolders[0].label
    : sourceFolders.length > 1
      ? `${sourceFolders[0].label} 외 ${sourceFolders.length - 1}곳`
      : "";
  const isLearning = busy === "learn";

  return (
    <main className={styles.simpleLearning}>
      <section className={styles.simpleLearningCard} aria-label="내 업무 방식 익히기">
        <header className={styles.simpleLearningHeader}>
          <h1>내 업무 방식 익히기</h1>
        </header>

        {!hasFiles ? (
          <button className={styles.simplePrimaryAction} type="button" onClick={() => handleChooseFolders("")} disabled={Boolean(busy) || !bridge?.isAvailable}>
            {busy === "folders" ? "폴더 여는 중…" : "폴더 선택"}
          </button>
        ) : (
          <>
            <section className={styles.selectedFolder} aria-label="선택한 폴더">
              <strong>{selectedFolderLabel || "선택한 자료"}</strong>
              <small>파일 {files.length.toLocaleString("ko-KR")}개</small>
            </section>
            {!hasLearningMemory ? (
              <div className={styles.simpleLearningActions}>
              <button type="button" onClick={() => handleChooseFolders("", "replace")} disabled={Boolean(busy)}>다시 선택</button>
                <button type="button" onClick={handleRunLearning} disabled={!canRunLearning}>{isLearning ? "읽는 중…" : "읽고 기억하기"}</button>
              </div>
            ) : null}
          </>
        )}

        {isLearning ? (
          <section className={styles.simpleProgress} aria-live="polite">
            <strong>자료를 읽고 있습니다</strong>
            <span>{learningProgress}%</span>
            <div aria-label={`자료 읽기 진행률 ${learningProgress}%`}><i style={{ width: `${learningProgress}%` }} /></div>
          </section>
        ) : null}

        {hasLearningMemory ? (
          <section className={styles.simpleResult} aria-live="polite">
            <div className={styles.simpleResultTitle}>
              <strong>업무 방식을 기억했습니다</strong>
            </div>
            <div className={styles.simpleResultGrid}>
              <article><strong>{learnedCount.toLocaleString("ko-KR")}</strong><span>읽은 자료</span></article>
              <article><strong>{groupCount.toLocaleString("ko-KR")}</strong><span>기억한 방식</span></article>
              <article><strong>{recommendationCount.toLocaleString("ko-KR")}</strong><span>다음 작업 준비</span></article>
            </div>
            <div className={styles.simpleLearningActions}>
              <button type="button" onClick={() => handleChooseFolders("", "replace")} disabled={Boolean(busy)}>다른 폴더 선택</button>
              <button type="button" onClick={handleRunLearning} disabled={!canRunLearning}>다시 읽기</button>
            </div>
          </section>
        ) : null}

        {learningFeedback ? <p className={styles.simpleEmpty} role={learningFeedback.error ? "alert" : "status"} aria-label="자료 학습 안내">{learningFeedback.message}</p> : null}
        {!bridge?.isAvailable ? <p className={styles.simpleEmpty}>설치된 앱에서 사용할 수 있습니다.</p> : null}
      </section>
    </main>
  );
}

function learnPageViewLabel(view: LearnPageView) {
  if (view === "memory") return "기억";
  if (view === "handoff") return "업무화";
  if (view === "search") return "검색";
  return "시작";
}

function learnPageViewBaseLabel(view: LearnPageView) {
  if (view === "memory") return "기억";
  if (view === "handoff") return "업무화";
  if (view === "search") return "찾기";
  return "요약";
}

function getLearnPageViewSummary(input: {
  view: LearnPageView;
  hasFiles: boolean;
  hasLearningMemory: boolean;
  recommendationCount: number;
  searchCount: number;
}) {
  if (input.view === "memory") {
    return input.hasLearningMemory ? "학습된 근거와 추천만 모아 봅니다." : "기억은 자료 학습 후 이 폴더에 열립니다.";
  }
  if (input.view === "handoff") {
    return input.recommendationCount ? `업무화 후보 ${input.recommendationCount}개만 확인합니다.` : "업무화 후보는 필요할 때만 엽니다.";
  }
  if (input.view === "search") {
    return input.searchCount ? `검색 후보 ${input.searchCount}개를 확인합니다.` : "검색은 저장 위치가 준비된 뒤 엽니다.";
  }
  return input.hasFiles ? "선택 자료와 실행 경계만 먼저 확인합니다." : "처음에는 자료 선택과 안전 기준만 보여줍니다.";
}

function getLearnPageViewTabs(input: {
  hasFiles: boolean;
  hasLearningMemory: boolean;
  recommendationCount: number;
  searchCount: number;
}): Array<{ id: LearnPageView; label: string; detail: string }> {
  return [
    {
      id: "start",
      label: "시작",
      detail: input.hasFiles ? "자료 선택됨" : "자료부터",
    },
    {
      id: "memory",
      label: "기억",
      detail: input.hasLearningMemory ? "준비됨" : "학습 후",
    },
    {
      id: "handoff",
      label: "업무화",
      detail: input.recommendationCount ? `${input.recommendationCount}개 후보` : "필요할 때",
    },
    {
      id: "search",
      label: "검색",
      detail: input.searchCount ? `${input.searchCount}개` : "인수인계",
    },
  ];
}

function getLearnPageFocusCards(input: {
  hasFiles: boolean;
  hasLearningMemory: boolean;
  recommendationCount: number;
  searchCount: number;
  revealedBoxCount: number;
}): Array<{
  id: LearnPageView;
  label: string;
  title: string;
  detail: string;
  countLabel: string;
  actionLabel: string;
  state: "start" | "memory" | "handoff" | "search";
}> {
  return [
    {
      id: "start",
      label: "시작",
      title: input.hasFiles ? "선택 자료와 안전 기준만" : "자료 선택부터",
      detail: input.hasFiles
        ? "원본 변경 없이 미리보기와 승인 기준만 먼저 확인합니다."
        : "처음에는 파일/폴더 선택과 실행 경계만 보여줍니다.",
      countLabel: input.revealedBoxCount ? `${input.revealedBoxCount}칸` : "대기",
      actionLabel: "시작 보기",
      state: "start",
    },
    {
      id: "memory",
      label: "기억",
      title: input.hasLearningMemory ? "학습된 근거 모음" : "학습 후 열림",
      detail: input.hasLearningMemory
        ? "자료 그룹, 출처, 추천 근거는 기억 보기에서만 자세히 봅니다."
        : "자료를 학습하면 업무 기억과 근거가 이 폴더에 모입니다.",
      countLabel: input.hasLearningMemory ? "준비됨" : "없음",
      actionLabel: "기억 보기",
      state: "memory",
    },
    {
      id: "handoff",
      label: "업무화",
      title: input.recommendationCount ? "업무 후보 확인" : "업무화 후보 대기",
      detail: input.recommendationCount
        ? "반복 업무, 보고서 초안, 승인 후보는 업무화 보기에서만 펼칩니다."
        : "자료에서 추천할 일이 생기면 이 폴더에 보여줍니다.",
      countLabel: input.recommendationCount ? `${input.recommendationCount}개` : "없음",
      actionLabel: "업무화 보기",
      state: "handoff",
    },
    {
      id: "search",
      label: "검색",
      title: input.searchCount ? "인수인계 검색 후보" : "검색 준비 대기",
      detail: input.searchCount
        ? "출처가 있는 검색 결과만 검색 보기에서 확인합니다."
        : "저장 위치나 학습 결과가 준비되면 질문 검색을 엽니다.",
      countLabel: input.searchCount ? `${input.searchCount}개` : "대기",
      actionLabel: "검색 보기",
      state: "search",
    },
  ];
}

function createAutomationPreviewCards(
  files: DocumentLearningFileRecord[],
  recommendations: DocumentAutomationRecommendation[],
  learnedOutputDrafts: DocumentLearnedOutputDraft[],
  hasLearningMemory: boolean,
): AutomationPreviewCard[] {
  if (recommendations.length > 0) {
    return recommendations.slice(0, 3).map((item) => {
      const learnedDraft = learnedOutputDrafts.find((draft) => draft.recommendationId === item.id);
      return {
        id: item.id,
        title: item.title,
        detail: item.reason,
        stateLabel: "추천",
        workPackId: item.workPackId,
        confidencePercent: Math.round(item.confidence * 100),
        sourceLabels: item.sourceLabels,
        suggestedRuleLabel: item.suggestedRuleLabel,
        workPackTitle: workPackTitleLabel(item.workPackId),
        outputLabel: item.outputPlan?.label ?? fallbackOutputPlanForWorkPack(item.workPackId).label,
        outputDraftTarget: item.outputPlan?.draftTarget ?? fallbackOutputPlanForWorkPack(item.workPackId).draftTarget,
        outputHandoffLabel: item.outputPlan?.handoffLabel ?? fallbackOutputPlanForWorkPack(item.workPackId).handoffLabel,
        outputApprovalGateLabel:
          item.outputPlan?.approvalGateLabel ?? fallbackOutputPlanForWorkPack(item.workPackId).approvalGateLabel,
        learnedStyleGuidance: item.learnedStyleGuidance?.length
          ? item.learnedStyleGuidance.slice(0, 3)
          : ["선택 자료의 파일명, 월/날짜 표기, 기존 문서 양식을 우선 반영합니다."],
        learnedDraftTitle: learnedDraft?.title,
        learnedDraftPreview: learnedDraft ? previewMarkdown(learnedDraft.markdown) : undefined,
        learnedDraftApprovalGateLabel: learnedDraft?.approvalGateLabel,
        handoffSteps: createAutomationHandoffSteps(
          item.workPackId,
          item.suggestedRuleLabel,
          item.sourceLabels,
          item.outputPlan?.handoffLabel,
          item.outputPlan?.approvalGateLabel,
        ),
        href: createWorkPackHandoffHref(
          item.workPackId,
          item.suggestedRuleLabel,
          item.confidence,
          item.sourceLabels,
        ),
      };
    });
  }

  if (files.length === 0) return [];

  const sourceLabels = files.slice(0, 3).map((file) => file.fileName).filter(Boolean);
  const text = files.map((file) => file.fileName).join(" ").toLocaleLowerCase("ko-KR");
  const previews: AutomationPreviewCard[] = [];

  if (/문의|상담|예약|고객|faq|가격|수강료|inquiry|lead/u.test(text)) {
    const outputPlan = fallbackOutputPlanForWorkPack("inquiry_response");
    previews.push({
      id: "preview-inquiry",
      title: "문의 답장 후보",
      detail: "상담/문의 자료를 읽어 자주 묻는 질문과 답장 초안을 만들 준비를 합니다.",
      stateLabel: hasLearningMemory ? "준비" : "예상",
      workPackId: "inquiry_response",
      confidencePercent: 62,
      sourceLabels,
      suggestedRuleLabel: "문의 자료 기준으로 답장 초안 만들기",
      workPackTitle: workPackTitleLabel("inquiry_response"),
      outputLabel: outputPlan.label,
      outputDraftTarget: outputPlan.draftTarget,
      outputHandoffLabel: outputPlan.handoffLabel,
      outputApprovalGateLabel: outputPlan.approvalGateLabel,
      learnedStyleGuidance: ["상담 문의와 가격/FAQ 자료의 말투를 우선 반영합니다."],
      handoffSteps: createAutomationHandoffSteps(
        "inquiry_response",
        "문의 자료 기준으로 답장 초안 만들기",
        sourceLabels,
        outputPlan.handoffLabel,
        outputPlan.approvalGateLabel,
      ),
    });
  }

  if (/일정|운영|규칙|휴무|근무|calendar|schedule/u.test(text)) {
    const outputPlan = fallbackOutputPlanForWorkPack("schedule_coordination");
    previews.push({
      id: "preview-schedule",
      title: "일정 후보 점검",
      detail: "운영 기준과 가능 시간을 기준으로 미팅/예약 후보를 승인 전 카드로 만듭니다.",
      stateLabel: hasLearningMemory ? "준비" : "예상",
      workPackId: "schedule_coordination",
      confidencePercent: 60,
      sourceLabels,
      suggestedRuleLabel: "운영 기준으로 일정 후보 만들기",
      workPackTitle: workPackTitleLabel("schedule_coordination"),
      outputLabel: outputPlan.label,
      outputDraftTarget: outputPlan.draftTarget,
      outputHandoffLabel: outputPlan.handoffLabel,
      outputApprovalGateLabel: outputPlan.approvalGateLabel,
      learnedStyleGuidance: ["운영 기준과 기존 안내 문구를 기준으로 후보 시간을 설명합니다."],
      handoffSteps: createAutomationHandoffSteps(
        "schedule_coordination",
        "운영 기준으로 일정 후보 만들기",
        sourceLabels,
        outputPlan.handoffLabel,
        outputPlan.approvalGateLabel,
      ),
    });
  }

  if (/보고서|정산|거래처|월별|인수|양식|서식|report|settlement/u.test(text) || previews.length === 0) {
    const outputPlan = fallbackOutputPlanForWorkPack("report_cleanup");
    previews.push({
      id: "preview-report",
      title: "보고서·정산 누락 확인",
      detail: "보고서와 정산표 패턴을 잡아 다음 담당자가 볼 요약과 확인 목록을 만듭니다.",
      stateLabel: hasLearningMemory ? "준비" : "예상",
      workPackId: "report_cleanup",
      confidencePercent: previews.length === 0 ? 52 : 64,
      sourceLabels,
      suggestedRuleLabel: "보고서·정산표 기준으로 누락 확인하기",
      workPackTitle: workPackTitleLabel("report_cleanup"),
      outputLabel: outputPlan.label,
      outputDraftTarget: outputPlan.draftTarget,
      outputHandoffLabel: outputPlan.handoffLabel,
      outputApprovalGateLabel: outputPlan.approvalGateLabel,
      learnedStyleGuidance: ["월별 보고서와 정산표의 파일명/표 흐름을 초안 형식에 반영합니다."],
      handoffSteps: createAutomationHandoffSteps(
        "report_cleanup",
        "보고서·정산표 기준으로 누락 확인하기",
        sourceLabels,
        outputPlan.handoffLabel,
        outputPlan.approvalGateLabel,
      ),
    });
  }

  return previews.slice(0, 3);
}

function previewMarkdown(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.replace(/^#+\s*/u, "").trim())
    .filter((line) => line && !line.startsWith("| ---"))
    .slice(0, 4)
    .join(" · ")
    .slice(0, 220);
}

function mergeDocumentLearningFiles(
  current: DocumentLearningFileRecord[],
  incoming: DocumentLearningFileRecord[],
): DocumentLearningFileRecord[] {
  const byPath = new Map<string, DocumentLearningFileRecord>();
  for (const file of current) {
    byPath.set((file.absolutePath || file.path || file.fileName).toLocaleLowerCase("ko-KR"), file);
  }
  for (const file of incoming) {
    byPath.set((file.absolutePath || file.path || file.fileName).toLocaleLowerCase("ko-KR"), file);
  }
  return [...byPath.values()];
}

function mergeDocumentLearningFolders(
  current: DocumentLearningFolderSource[],
  incoming: DocumentLearningFolderSource[],
): DocumentLearningFolderSource[] {
  const byPath = new Map<string, DocumentLearningFolderSource>();
  for (const folder of current) {
    byPath.set(folder.path.toLocaleLowerCase("ko-KR"), folder);
  }
  for (const folder of incoming) {
    byPath.set(folder.path.toLocaleLowerCase("ko-KR"), folder);
  }
  return [...byPath.values()];
}

function sourceKindLabel(value: string): string {
  if (value === "desktop") return "바탕화면";
  if (value === "documents") return "문서";
  if (value === "downloads") return "다운로드";
  if (value === "home") return "사용자";
  return "폴더";
}
