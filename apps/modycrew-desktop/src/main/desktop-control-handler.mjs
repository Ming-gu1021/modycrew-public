import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
// 무거운 문서 라이브러리(exceljs·mammoth·pdf-parse)는 실제로 쓸 때 불러온다.
// 예전엔 앱을 켤 때마다 전부 읽어 창이 뜨기까지 0.6~0.9초를 더 기다렸다(실측).
let excelModulePromise;
const loadExcelJS = () => (excelModulePromise ??= import("exceljs").then((module) => module.default ?? module));
let mammothModulePromise;
const loadMammoth = () => (mammothModulePromise ??= import("mammoth").then((module) => module.default ?? module));
let pdfParseModulePromise;
const loadPDFParse = () => (pdfParseModulePromise ??= import("pdf-parse").then((module) => module.PDFParse));
import { mapMailWorkIntakeResultToInboxItems } from "./mail-work-intake-handler.mjs";
import { resolveDesktopDomainEntryPath } from "./runtime-paths.mjs";
import { defaultCurrentWorkspaceRoot, getDesktopAppControl, sameWorkspaceRoot } from "./desktop-app-control.mjs";

const pendingConfirmations = new Map();
const confirmationTtlMs = 2 * 60 * 1000;
let domainRuntimePromise;

const safeReadCapabilities = [
  {
    id: "read_screen",
    label: "화면 상태 확인",
    risk: "low",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "사용자가 요청한 화면 소스의 이름과 상태를 확인합니다. 화면 이미지 저장이나 클릭·입력은 하지 않습니다.",
  },
  {
    id: "list_windows",
    label: "열린 창 목록 확인",
    risk: "low",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "Windows에서는 열린 창 제목과 프로세스명만 read-only로 가져옵니다.",
  },
  {
    id: "open_url",
    label: "업무 URL 준비",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "주소를 준비하고, 사용자가 열기를 확인하면 앱 내 업무 브라우저에서 이어 갑니다.",
  },
  {
    id: "stage_browser_work_item",
    label: "브라우저 업무 카드 만들기",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "사이트 열기, 클릭, 입력 없이 브라우저 업무 계획만 승인 대기 카드로 남깁니다.",
  },
  {
    id: "read_webmail_metadata",
    label: "웹메일 목록 읽기",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary:
      "IMAP이 없는 웹메일은 보안 저장소/브라우저 세션 참조만 사용해 목록 메타데이터를 읽고 업무 후보만 승인함에 올립니다.",
  },
  {
    id: "plan_browser_actions",
    label: "브라우저 행동 후보 제안",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "화면 읽기와 다음 행동 후보만 제안하고 클릭/입력/브라우저 자동 조작은 실행하지 않습니다.",
  },
  {
    id: "stage_browser_action_candidate",
    label: "브라우저 조작 최종 확인 카드",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "선택한 클릭/입력 후보를 실행 전 미리보기/최종 확인 카드로만 올리고 실제 조작은 실행하지 않습니다.",
  },
  {
    id: "attach_browser_screen_evidence",
    label: "브라우저 화면 증거 붙이기",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "현재 화면 소스와 대상 요소 설명을 확인 카드에 붙이고 클릭/입력은 실행하지 않습니다.",
  },
  {
    id: "match_browser_target_element",
    label: "브라우저 대상 요소 매칭",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "화면 증거와 미리보기 대상 설명을 비교해 대상 요소 확인 기록만 남기고 클릭/입력은 실행하지 않습니다.",
  },
  {
    id: "prepare_browser_limited_execution",
    label: "브라우저 마지막 확인",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "화면 증거와 대상 요소 매칭을 확인한 뒤 실행 준비 감사 기록만 남기고 실제 클릭/입력은 실행하지 않습니다.",
  },
  {
    id: "confirm_browser_limited_execution",
    label: "브라우저 제한 실행 최종 문구 확인",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "사용자의 최종 확인 문구를 감사 기록에 남기고, 실제 실행 연결이 없으면 클릭/입력은 계속 차단합니다.",
  },
  {
    id: "request_browser_limited_execution",
    label: "브라우저 제한 실행 요청 점검",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "최종 문구 확인 뒤 실행 요청을 감사 기록으로 남기고, 실제 실행 연결이 없으면 즉시 차단합니다.",
  },
  {
    id: "verify_browser_limited_execution_result",
    label: "브라우저 제한 실행 결과 확인",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "클립보드 복사 뒤 사용자가 붙여넣은 화면 결과를 read-only 화면 증거로 다시 확인하고 감사 기록을 남깁니다.",
  },
  {
    id: "open_local_file",
    label: "로컬 파일 열기 준비",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "파일 경로를 직접 실행하지 않고 열기 전 확인 단계까지만 시뮬레이션합니다.",
  },
  {
    id: "list_recent_files",
    label: "최근 업무 파일 후보",
    risk: "low",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "파일 내용은 읽지 않고 사용자 폴더의 최근 문서 메타데이터만 확인합니다.",
  },
  {
    id: "choose_local_file",
    label: "파일 선택 후 열기",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "사용자가 직접 파일 선택 창에서 고른 파일만 확인 후 열 수 있습니다.",
  },
  {
    id: "stage_file_work_item",
    label: "문서/폴더 업무 카드 만들기",
    risk: "low",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "파일/폴더 내용은 읽지 않고 사용자가 직접 선택한 대상의 메타데이터와 지시만 인박스 업무 카드로 남깁니다.",
  },
  {
    id: "analyze_local_file",
    label: "선택 문서 분석",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "사용자가 선택한 단일 문서만 읽고 요약/체크리스트를 인박스 업무 카드에 남깁니다.",
  },
  {
    id: "draft_from_local_file",
    label: "문서 산출물 초안",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "분석된 문서를 읽기 전용으로 참고해 보고서/답장/표 정리 초안을 업무 카드에 남깁니다.",
  },
];

const guardedMutationCapabilities = [
  {
    id: "click",
    label: "클릭",
    risk: "high",
    enabled: false,
    granted: false,
    externalMutation: true,
    safetyBoundary: "사용자 마지막 확인 흐름이 붙기 전까지 차단합니다.",
  },
  {
    id: "type_text",
    label: "텍스트 입력",
    risk: "high",
    enabled: false,
    granted: false,
    externalMutation: true,
    safetyBoundary: "비밀번호, 메시지, 결제/발송 화면 입력 가능성이 있어 최종 확인 전 차단합니다.",
  },
  {
    id: "send_hotkey",
    label: "단축키",
    risk: "high",
    enabled: false,
    granted: false,
    externalMutation: true,
    safetyBoundary: "저장, 발송, 삭제 단축키 위험이 있어 명시 승인 UI 전까지 차단합니다.",
  },
  {
    id: "browser_automation",
    label: "브라우저 자동화",
    risk: "high",
    enabled: false,
    granted: false,
    externalMutation: true,
    safetyBoundary: "로그인 세션과 외부 사이트 변경 가능성이 있어 승인 큐가 필요합니다.",
  },
  {
    id: "write_local_file",
    label: "파일 쓰기",
    risk: "high",
    enabled: false,
    granted: false,
    externalMutation: true,
    safetyBoundary: "로컬 파일 변경은 별도 파일 권한과 승인 기록이 붙기 전까지 차단합니다.",
  },
];

// PC 앱 조작(agent-desktop). 읽기는 화면 요소(접근성 정보)만, 조작은 실행 확인 창·승인함 승인 뒤 한 번만 실행한다.
// 실제 판정·실행·기록은 desktop-app-control.mjs 가 하고, 여기서는 기존 컴퓨터 조작 요청 통로에 연결만 한다.
const appControlCapabilities = [
  {
    id: "inspect_app_elements",
    label: "앱 화면 요소 확인",
    risk: "medium",
    enabled: true,
    granted: true,
    externalMutation: false,
    safetyBoundary: "사용자가 고른 앱 창 하나의 버튼·입력칸 이름과 값만 읽습니다. 화면 이미지는 만들거나 보내지 않습니다.",
  },
  {
    id: "request_app_action",
    label: "앱 조작 승인 요청",
    risk: "high",
    enabled: true,
    granted: true,
    externalMutation: true,
    safetyBoundary: "실행 확인 창이나 승인함에서 사용자가 승인한 단계만 한 번씩 실행하고, 실행 뒤 화면을 다시 읽어 확인합니다.",
  },
];
const appControlCapabilityIds = new Set([
  "inspect_app_elements",
  "request_app_action",
  "run_app_action",
  "app_action_status",
  "cancel_app_action",
  "open_app_action_result",
]);

const allCapabilities = [...safeReadCapabilities, ...appControlCapabilities, ...guardedMutationCapabilities];
const simulatedCapabilityIds = new Set(safeReadCapabilities.map((capability) => capability.id));
const blockedCapabilityIds = new Set(guardedMutationCapabilities.map((capability) => capability.id));

// 앱을 다시 켠 뒤에도 승인함에 남은 PC 작업 승인을 이어받고, 실행 중 꺼진 작업은 '결과 확인 필요'로 돌린다.
if (process.versions?.electron) {
  const resumeTimer = setTimeout(() => {
    void import("./inbox-handler.mjs")
      .then((inbox) => getDesktopAppControl({ upsertInboxItem: inbox.upsertAutomationInboxItem, getInboxSnapshot: inbox.getAutomationInboxSnapshot }).ensureLoaded())
      .catch(() => undefined);
  }, 15_000);
  resumeTimer.unref?.();
}

export async function handleDesktopControlMessage(_event, payload = {}, deps = {}) {
  const kind = sanitizeKind(payload.kind);
  const featureEnabled = payload.featureEnabled === true;

  if (kind === "status") {
    return createStatusResult(featureEnabled);
  }

  if (kind === "request") {
    return createRequestResult({
      capability: sanitizeCapability(payload.capability),
      featureEnabled,
      target: sanitizeTarget(payload.target),
      instruction: sanitizeInstruction(payload.instruction),
      workItemId: sanitizeWorkItemId(payload.workItemId),
      browserActionId: sanitizeBrowserActionId(payload.browserActionId),
      outputKind: sanitizeOutputKind(payload.outputKind),
      webmailFallback: payload.webmailFallback ?? payload.webmail ?? {},
      webmailMessages: payload.webmailMessages ?? payload.messages ?? [],
      webmailDomRows: payload.webmailDomRows ?? payload.webmailRows ?? payload.domRows ?? [],
      includeTempCandidates: payload.includeTempCandidates === true,
      appAction: payload.appAction,
      event: _event,
      deps,
    });
  }

  if (kind === "confirm") {
    return confirmDesktopControlAction(payload, deps);
  }

  return {
    status: "blocked",
    capability: "list_windows",
    userMessage: "지원하지 않는 컴퓨터 조작 요청입니다.",
    sideEffect: "none",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createStatusResult(featureEnabled) {
  return {
    status: featureEnabled ? "desktop_control_ready" : "desktop_control_disabled",
    mode: featureEnabled ? "native_os_read_only" : "simulated_only",
    capabilities: allCapabilities.map((capability) => ({
      ...capability,
      enabled: featureEnabled && capability.enabled,
      granted: featureEnabled && capability.granted,
    })),
    userMessage: featureEnabled
      ? "컴퓨터 조작 안전 모드가 켜졌습니다. 창 목록은 read-only로 확인하고 URL/파일 열기는 확인 후 실행합니다."
      : "컴퓨터 조작 기능 스위치를 켜야 데스크톱 요청을 보낼 수 있습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function createRequestResult({
  capability,
  featureEnabled,
  target,
  instruction,
  workItemId,
  browserActionId,
  outputKind,
  webmailFallback,
  webmailMessages,
  webmailDomRows,
  includeTempCandidates,
  appAction,
  event,
  deps,
}) {
  if (!featureEnabled) {
    return {
      status: "desktop_control_disabled",
      capability,
      userMessage: "컴퓨터 조작 기능 스위치를 먼저 켜 주세요.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (appControlCapabilityIds.has(capability)) {
    return handleAppControlRequest({ capability, appAction, event, deps });
  }

  if (blockedCapabilityIds.has(capability)) {
    return {
      status: "needs_approval",
      capability,
      userMessage: "클릭, 입력, 파일 쓰기 같은 변경 작업은 최종 사용자 확인 UI가 붙기 전까지 차단됩니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (!simulatedCapabilityIds.has(capability)) {
    return {
      status: "capability_missing",
      capability,
      userMessage: "현재 데스크톱 앱이 지원하지 않는 조작입니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (capability === "list_windows") {
    const observedWindows = await listVisibleWindows();
    return {
      status: "read_completed",
      capability,
      userMessage: observedWindows.length
        ? `열린 창 ${observedWindows.length}개를 read-only로 확인했습니다.`
        : "읽을 수 있는 열린 창이 없습니다. 실제 OS 변경은 없습니다.",
      sideEffect: "read_only",
      observedAt: new Date().toISOString(),
      observedWindows,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (capability === "read_screen") {
    const base = { capability, sideEffect: "read_only", externalMutation: false, rawSecretMaterialStored: false, rawSecretMaterialReturned: false };
    if (typeof deps?.captureScreenEvidence !== "function") return { ...base, status: "capability_missing", userMessage: "설치 앱에서 화면 연결 상태를 확인해 주세요." };
    try {
      const observed = await deps.captureScreenEvidence({ targetUrl: target, targetElementDescription: instruction });
      if (observed?.status !== "screen_evidence_captured") return { ...base, status: "screen_evidence_capture_failed", userMessage: "확인할 화면 소스를 찾지 못했습니다. 창을 연 뒤 다시 시도해 주세요." };
      return { ...base, status: "read_completed", observedAt: observed.capturedAt,
        userMessage: `${sanitizeWindowText(observed.sourceLabel || "현재 화면")} 화면 소스를 확인했습니다. 화면 내용 분석이나 클릭·입력은 실행하지 않았습니다.`,
        observedScreen: { sourceKind: observed.sourceKind, sourceLabel: sanitizeWindowText(observed.sourceLabel), sourceCount: observed.sourceCount, rawPixelsStored: false },
      };
    } catch {
      return { ...base, status: "screen_evidence_capture_failed", userMessage: "화면 연결을 확인하지 못했습니다. 화면 권한과 열린 창을 확인한 뒤 다시 시도해 주세요." };
    }
  }

  if (capability === "list_recent_files") {
    const observedFiles = listRecentWorkFiles({
      includeTempCandidates,
      intentText: `${instruction} ${target}`,
    });
    return {
      status: "read_completed",
      capability,
      userMessage: observedFiles.length
        ? `최근 업무 파일 후보 ${observedFiles.length}개를 read-only로 확인했습니다.`
        : "추천할 최근 업무 파일 후보가 없습니다.",
      sideEffect: "read_only",
      observedAt: new Date().toISOString(),
      observedFiles,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (capability === "open_url") {
    const normalizedUrl = normalizeAllowedUrl(target);
    if (!normalizedUrl) {
      return createInvalidTargetResult(capability, "https:// 로 시작하는 안전한 업무 URL만 열 수 있습니다.");
    }
    return createConfirmationResult({
      capability,
      target: normalizedUrl,
      instruction,
      label: "업무 URL 열기",
    });
  }

  if (capability === "stage_browser_work_item") {
    return stageBrowserWorkItem({ target, instruction, deps });
  }

  if (capability === "read_webmail_metadata") {
    return readWebmailMetadata({ target, instruction, webmailFallback, webmailMessages, webmailDomRows, deps });
  }

  if (capability === "plan_browser_actions") {
    return planBrowserActions({ target, instruction, workItemId, deps });
  }

  if (capability === "stage_browser_action_candidate") {
    return stageBrowserActionCandidate({ target, instruction, workItemId, browserActionId, deps });
  }

  if (capability === "attach_browser_screen_evidence") {
    return attachBrowserScreenEvidence({ target, instruction, workItemId, deps });
  }

  if (capability === "match_browser_target_element") {
    return matchBrowserTargetElement({ instruction, workItemId, deps });
  }

  if (capability === "prepare_browser_limited_execution") {
    return prepareBrowserLimitedExecution({ instruction, workItemId, deps });
  }

  if (capability === "confirm_browser_limited_execution") {
    return confirmBrowserLimitedExecution({ instruction, workItemId, deps });
  }

  if (capability === "request_browser_limited_execution") {
    return requestBrowserLimitedExecution({ instruction, workItemId, deps });
  }

  if (capability === "verify_browser_limited_execution_result") {
    return verifyBrowserLimitedExecutionResult({ instruction, workItemId, deps });
  }

  if (capability === "choose_local_file") {
    return chooseLocalFileForOpen({ deps, instruction });
  }

  if (capability === "open_local_file") {
    const normalizedPath = normalizeAllowedLocalPath(target);
    if (!normalizedPath) {
      return createInvalidTargetResult(
        capability,
        "열 파일의 절대 경로가 필요합니다. 사용자 폴더, 임시 폴더, 현재 작업 폴더 안의 파일만 허용합니다.",
      );
    }
    return createConfirmationResult({
      capability,
      target: normalizedPath,
      instruction,
      label: "로컬 파일 열기",
    });
  }

  if (capability === "stage_file_work_item") {
    return stageFileWorkItem({ target, instruction, deps });
  }

  if (capability === "analyze_local_file") {
    return analyzeLocalFile({ target, instruction, workItemId, deps });
  }

  if (capability === "draft_from_local_file") {
    return draftFromLocalFile({ target, instruction, workItemId, outputKind, deps });
  }

  const actionLabel = target || instruction || "현재 업무 화면";
  return {
    status: "simulated_completed",
    capability,
    userMessage: `${actionLabel} 요청을 안전 모드에서 준비했습니다. 실제 OS 변경은 없습니다.`,
    sideEffect: "simulated_only",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function stageBrowserWorkItem({ target, instruction, deps }) {
  if (typeof deps?.appendInboxItems !== "function") {
    return {
      status: "capability_missing",
      capability: "stage_browser_work_item",
      userMessage: "브라우저 업무 카드 생성은 설치된 데스크톱 앱 인박스와 연결된 상태에서 사용할 수 있습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const rawTarget = String(target ?? "").trim();
  const normalizedUrl = rawTarget ? normalizeAllowedUrl(rawTarget) : null;
  if (rawTarget && !normalizedUrl) {
    return createInvalidTargetResult(
      "stage_browser_work_item",
      "브라우저 업무는 http/https URL만 대상 사이트로 기록할 수 있습니다. URL이 없으면 요청 내용만 업무 카드로 남깁니다.",
    );
  }

  const createdAt = new Date().toISOString();
  const safeUrl = normalizedUrl ? redactSensitiveUrl(normalizedUrl) : "";
  const hostLabel = safeUrl ? safeHostname(safeUrl) : "사이트 확인 필요";
  const intent = instruction || "이 사이트에서 처리할 업무를 단계별로 확인해줘.";
  const workItem = {
    id: `browser-work-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    title: `브라우저 업무 준비: ${hostLabel}`,
    source: "web_page",
    sourceLabel: "브라우저 업무",
    senderLabel: hostLabel,
    body: [
      `대상 사이트: ${safeUrl || "사용자 확인 필요"}`,
      `요청: ${intent}`,
      "실행 계획:",
      "1. 사용자가 사이트와 계정을 확인합니다.",
      "2. AI는 화면을 읽고 필요한 클릭/입력 후보를 먼저 설명합니다.",
      "3. 클릭, 입력, 발송, 결제, 삭제는 사용자 최종 확인 전까지 실행하지 않습니다.",
    ].join("\n"),
    summary: safeUrl
      ? `${hostLabel} 브라우저 업무를 열기 전 승인 대기 카드로 준비했습니다.`
      : "브라우저 업무를 사이트 확인 필요 상태의 승인 대기 카드로 준비했습니다.",
    status: "approval_pending",
    riskLabel: "medium",
    riskSignals: [
      {
        id: `browser-work:${Date.now().toString(36)}:final-presence`,
        label: "브라우저 조작 전 최종 확인",
        riskLabel: "medium",
        reason: "사이트 열기 이후의 클릭, 입력, 발송, 결제, 삭제는 사용자가 화면에서 다시 확인해야 합니다.",
      },
    ],
    receivedAt: createdAt,
    draft: {
      id: `browser-work:${Date.now().toString(36)}:draft`,
      toneLabel: "브라우저 업무 실행 계획",
      body: [
        `대상: ${safeUrl || "사이트 확인 필요"}`,
        `요청: ${intent}`,
        "다음 단계: 사이트를 열기 전 계정/권한을 확인하고, 열린 화면에서 AI가 할 수 있는 행동 후보를 다시 보여줍니다.",
        "안전 경계: 지금은 브라우저를 열거나 클릭/입력하지 않고, 승인 대기 업무 카드만 생성했습니다.",
      ].join("\n"),
      operationKind: "stage_approval",
      requiresApprovalBeforeSend: true,
    },
    browserTask: {
      targetUrl: safeUrl,
      host: hostLabel,
      requiresFinalUserPresence: true,
      blockedCapabilities: ["click", "type_text", "send_hotkey", "browser_automation"],
    },
  };
  const stageAudit = persistDesktopWorkItemStageAudit({
    kind: "browser_work_item_staged",
    capability: "stage_browser_work_item",
    workItem,
    targetLabel: hostLabel,
    instruction: intent,
    rollbackGuide: "실행 전 카드라 취소하면 외부 사이트, 파일, 메일은 바뀌지 않습니다.",
  });

  const inboxResult = deps.appendInboxItems([workItem], { createdAt });

  return {
    status: "browser_work_item_staged",
    capability: "stage_browser_work_item",
    userMessage:
      inboxResult.addedCount > 0
        ? `${hostLabel} 브라우저 업무를 승인 대기 카드로 올렸습니다.`
        : "이미 같은 브라우저 업무 카드가 있거나 새로 올릴 카드가 없습니다.",
    sideEffect: "none",
    observedAt: createdAt,
    stagedWorkItem: workItem,
    inboxResult,
    auditFile: stageAudit.auditFile,
    rollbackGuide: stageAudit.auditRecord.rollbackGuide,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function readWebmailMetadata({
  target,
  instruction,
  webmailFallback = {},
  webmailMessages = [],
  webmailDomRows = [],
  deps = {},
}) {
  if (typeof deps?.appendInboxItems !== "function") {
    return {
      status: "capability_missing",
      capability: "read_webmail_metadata",
      userMessage: "웹메일 목록 읽기는 설치된 데스크톱 앱 인박스와 연결된 상태에서 사용할 수 있습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const createdAt = new Date().toISOString();
  const normalizedUrl = normalizeAllowedUrl(target || webmailFallback.loginUrl || "");
  const domain = await loadDomainRuntime(deps);
  const plan = domain.createWebmailFallbackPollingPlan({
    connectorId: sanitizeReferenceLikeId(webmailFallback.connectorId || "webmail-fallback"),
    providerLabel: sanitizeInstruction(webmailFallback.providerLabel || "회사/일반 웹메일") || "회사/일반 웹메일",
    loginUrl: normalizedUrl || String(target || webmailFallback.loginUrl || ""),
    accountReferenceId: sanitizeReferenceLikeId(webmailFallback.accountReferenceId || ""),
    passwordReferenceId: sanitizeReferenceLikeId(webmailFallback.passwordReferenceId || ""),
    browserSessionReferenceId: sanitizeReferenceLikeId(webmailFallback.browserSessionReferenceId || ""),
    twoFactorMode: normalizeWebmailTwoFactorMode(webmailFallback.twoFactorMode),
    cadenceMinutes: normalizeWebmailCadenceMinutes(webmailFallback.cadenceMinutes),
    mailboxLabel: sanitizeInstruction(webmailFallback.mailboxLabel || "받은메일함") || "받은메일함",
    createdAt,
    ...(webmailFallback.rawUsername ? { rawUsername: true } : {}),
    ...(webmailFallback.rawPassword ? { rawPassword: true } : {}),
    ...(webmailFallback.rawSessionCookie ? { rawSessionCookie: true } : {}),
  });
  const domCaptureProfile = domain.createWebmailDomCaptureProfile({
    providerLabel: plan.providerLabel,
    loginUrl: plan.loginUrl,
    mailboxLabel: plan.mailboxLabel,
    maxRows: 50,
  });

  if (plan.status !== "ready_for_metadata_polling") {
    return {
      status: "webmail_metadata_read_blocked",
      capability: "read_webmail_metadata",
      userMessage: plan.userMessage,
      sideEffect: "none",
      observedAt: createdAt,
      webmailPlan: sanitizeWebmailPlanForUi(plan),
      webmailDomCaptureProfile: sanitizeWebmailDomCaptureProfileForUi(domCaptureProfile),
      webmailDomRecoveryGuide: sanitizeWebmailDomRecoveryGuideForUi(
        domain.createWebmailDomRecoveryGuide(domCaptureProfile, {
          captureStatus: "plan_blocked",
          extractionStatus: "not_started",
          rowCount: 0,
          extractedCount: 0,
        }),
      ),
      auditMessages: plan.auditMessages,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  let providerRead;
  let domExtraction = null;
  const normalizedDirectMessages = normalizeWebmailMetadataMessages(webmailMessages, createdAt);
  let rowsForExtraction = normalizeWebmailDomRows(webmailDomRows);
  let domCapture = null;
  if (normalizedDirectMessages.length === 0 && rowsForExtraction.length === 0 && typeof deps?.captureWebmailDomRows === "function") {
    domCapture = await deps.captureWebmailDomRows({
      targetUrl: plan.loginUrl,
      host: safeHostname(plan.loginUrl),
      providerLabel: plan.providerLabel,
      mailboxLabel: plan.mailboxLabel,
      maxRows: 50,
      captureProfile: domCaptureProfile,
      semanticRowTargets: domCaptureProfile.semanticRowTargets,
      requiredVisibleSignals: domCaptureProfile.requiredVisibleSignals,
    });
    if (domCapture?.status === "webmail_dom_rows_captured") {
      rowsForExtraction = normalizeWebmailDomRows(domCapture.rows);
    }
  }
  const messagesForProvider = normalizedDirectMessages.length > 0
    ? normalizedDirectMessages
    : (() => {
        const extraction = domain.extractWebmailMetadataFromDomSnapshot({
          rows: rowsForExtraction,
          checkedAt: createdAt,
          mailboxLabel: plan.mailboxLabel,
          rawPageHtmlStored: webmailFallback.rawPageHtmlStored === true ? true : false,
          rawBodyStored: webmailFallback.rawBodyStored === true ? true : false,
        });
        domExtraction = extraction;
        return extraction.status === "metadata_extracted" || extraction.status === "empty"
          ? extraction.messages
          : null;
      })();
  const domRecoveryGuide = domain.createWebmailDomRecoveryGuide(domCaptureProfile, {
    captureStatus: domCapture?.status ?? (rowsForExtraction.length > 0 ? "manual_rows_provided" : "webmail_dom_rows_unavailable"),
    extractionStatus: domExtraction?.status ?? (normalizedDirectMessages.length > 0 ? "direct_messages_provided" : "not_started"),
    rowCount: domCapture?.rowCount ?? rowsForExtraction.length,
    extractedCount: domExtraction?.extractedCount ?? normalizedDirectMessages.length,
    unsafeSnapshotRejected: domExtraction?.status === "unsafe_snapshot_rejected",
    capabilityMissing: typeof deps?.captureWebmailDomRows !== "function",
  });
  if (
    normalizedDirectMessages.length === 0 &&
    (!messagesForProvider || messagesForProvider.length === 0) &&
    isBlockingWebmailDomRecoveryGuide(domRecoveryGuide)
  ) {
    return {
      status: "webmail_metadata_read_blocked",
      capability: "read_webmail_metadata",
      userMessage: `${domRecoveryGuide.reasonLabel}: ${domRecoveryGuide.nextUserAction}`,
      sideEffect: "none",
      observedAt: createdAt,
      messageCount: 0,
      createdWorkItemsCount: 0,
      approvalQueueCount: 0,
      ignoredItemsCount: 0,
      reviewItemsCount: 0,
      bodyPreviewAllowedCount: 0,
      bodyPreviewSkippedBeforeBodyCount: 0,
      webmailPlan: sanitizeWebmailPlanForUi(plan),
      webmailDomCaptureProfile: sanitizeWebmailDomCaptureProfileForUi(domCaptureProfile),
      webmailDomCapture: sanitizeWebmailDomCaptureForUi(domCapture),
      webmailDomExtraction: sanitizeWebmailDomExtractionForUi(domExtraction),
      webmailDomRecoveryGuide: sanitizeWebmailDomRecoveryGuideForUi(domRecoveryGuide),
      auditMessages: domRecoveryGuide.checklist,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      appMayPersistSecret: false,
      aiMayReadSecret: false,
    };
  }
  if (!messagesForProvider) {
    return {
      status: "webmail_metadata_read_blocked",
      capability: "read_webmail_metadata",
      userMessage: "웹메일 화면 snapshot에 raw HTML/body가 섞여 있어 목록 읽기를 중단했습니다.",
      sideEffect: "none",
      observedAt: createdAt,
      webmailPlan: sanitizeWebmailPlanForUi(plan),
      webmailDomCaptureProfile: sanitizeWebmailDomCaptureProfileForUi(domCaptureProfile),
      webmailDomCapture: sanitizeWebmailDomCaptureForUi(domCapture),
      webmailDomExtraction: sanitizeWebmailDomExtractionForUi(domExtraction),
      webmailDomRecoveryGuide: sanitizeWebmailDomRecoveryGuideForUi(domRecoveryGuide),
      auditMessages: domExtraction?.auditMessages ?? [],
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  try {
    providerRead = domain.createProviderMailReadFromWebmailFallback({
      plan,
      checkedAt: createdAt,
      rawPageHtmlStored: false,
      rawBodyStored: false,
      messages: messagesForProvider,
    });
  } catch (error) {
    return {
      status: "webmail_metadata_read_blocked",
      capability: "read_webmail_metadata",
      userMessage: cleanWebmailErrorMessage(error, "웹메일 목록 snapshot에 원문 HTML/본문 또는 안전하지 않은 값이 있어 중단했습니다."),
      sideEffect: "none",
      observedAt: createdAt,
      webmailPlan: sanitizeWebmailPlanForUi(plan),
      webmailDomCaptureProfile: sanitizeWebmailDomCaptureProfileForUi(domCaptureProfile),
      webmailDomRecoveryGuide: sanitizeWebmailDomRecoveryGuideForUi(domRecoveryGuide),
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const writingProfile = normalizeWebmailWritingProfile(webmailFallback.writingProfile ?? deps.writingProfile);
  const workReport = new domain.ModyProviderWorkIntakePlanner({
    now: () => new Date(createdAt),
  }).createReport({
    reads: [providerRead],
    writingProfile,
    reportChannelId: sanitizeReferenceLikeId(webmailFallback.reportChannelId || "desktop") || "desktop",
    appDeepLinkBase: "modycrew://webmail-fallback",
  });
  const workAnalysis = domain.analyzeMailWorkPattern({
    providerRead,
    workReport,
    writingProfile,
  });
  const initialLearningProfile = domain.createMailInitialLearningProfile({
    providerReads: [providerRead],
    workReports: [workReport],
    workAnalysis,
    writingProfile,
    createdAt,
    sourceScopes: ["webmail_dom_metadata"],
  });
  const attachmentOrganizerPlan = domain.createMailAttachmentOrganizerPlan({
    providerReads: [providerRead],
    workReports: [workReport],
    workAnalysis,
    createdAt,
  });
  const intakeResult = {
    status: workReport.status,
    connectorId: plan.connectorId,
    providerId: "webmail",
    mailbox: plan.mailboxLabel,
    providerRead,
    workReport,
    workAnalysis,
    initialLearningProfile,
    attachmentOrganizerPlan,
    auditMessages: [
      ...plan.auditMessages,
      ...(domExtraction?.auditMessages ?? []),
      providerRead.auditMessage,
      ...workReport.auditMessages,
      "초기 웹메일 프로필 학습이 말투, 광고 제외, 대량 발송, 일정, 승인 습관을 비밀값 없이 저장 후보로 요약했습니다.",
      ...(attachmentOrganizerPlan.auditMessages ?? []),
    ],
  };
  const inboxItems = mapMailWorkIntakeResultToInboxItems(intakeResult, createdAt);
  const inboxResult =
    inboxItems.length > 0
      ? deps.appendInboxItems(inboxItems, { createdAt })
      : {
          status: "webmail_metadata_read_quiet",
          addedCount: 0,
          totalInboxItems: 0,
          userMessage: "웹메일 목록을 확인했지만 새 업무 후보는 없습니다.",
          externalMutation: false,
          rawSecretMaterialStored: false,
          rawSecretMaterialReturned: false,
        };
  const audit = persistDesktopWorkItemStageAudit({
    kind: "webmail_metadata_read_staged",
    capability: "read_webmail_metadata",
    workItem: inboxItems[0] ?? {
      id: `webmail-read-${Date.now().toString(36)}`,
      title: `${plan.providerLabel} 웹메일 목록 읽기`,
      source: "webmail",
    },
    targetLabel: plan.providerLabel,
    instruction: instruction || `${plan.mailboxLabel} 목록 메타데이터 ${providerRead.messages.length}건 확인`,
    rollbackGuide: "읽기 전용 목록 점검이라 취소해도 메일함, 일정, 파일은 변경되지 않습니다.",
    scopeKind: "webmail_metadata",
  });

  return {
    status: workReport.status === "ready_for_review" ? "webmail_metadata_work_ready" : "webmail_metadata_quiet",
    capability: "read_webmail_metadata",
    userMessage:
      inboxResult.addedCount > 0
        ? `${plan.providerLabel} 웹메일 목록 ${providerRead.messages.length}건을 확인하고 승인함 후보 ${inboxResult.addedCount}건을 올렸습니다.`
        : `${plan.providerLabel} 웹메일 목록 ${providerRead.messages.length}건을 확인했지만 새 승인 후보는 없습니다.`,
    sideEffect: "read_only",
    observedAt: createdAt,
    messageCount: providerRead.messages.length,
    credentialReferenceId:
      providerRead.credentialReferenceId ||
      plan.credentialReferences.browserSessionReferenceId ||
      plan.credentialReferences.passwordReferenceId ||
      plan.credentialReferences.accountReferenceId ||
      "",
    credentialReferenceCount: Object.values(plan.credentialReferences ?? {}).filter(Boolean).length,
    credentialReferencePolicy: "os_keychain_reference_only_ai_secret_unreadable",
    credentialStorage: sanitizeInstruction(webmailFallback.credentialStorage || "os_keychain") || "os_keychain",
    aiSecretReadable: false,
    createdWorkItemsCount: workReport.createdWorkItemsCount,
    approvalQueueCount: workReport.approvalQueue.length,
    ignoredItemsCount: workReport.ignoredItemsCount,
    reviewItemsCount: workReport.reviewItemsCount,
    bodyPreviewAllowedCount: workReport.secureIntakeSummary?.bodyPreviewAllowedCount ?? domExtraction?.bodyPreviewAllowedCount ?? 0,
    bodyPreviewSkippedBeforeBodyCount:
      workReport.secureIntakeSummary?.skippedBeforeBodyCount ?? domExtraction?.bodyPreviewSkippedBeforeBodyCount ?? 0,
    webmailBodyPreviewPolicy:
      domExtraction?.bodyPreviewPolicy || "work_candidates_only_metadata_preview_no_raw_body",
    webmailBodyPreviewMaxChars: domExtraction?.bodyPreviewMaxChars ?? 420,
    attachmentCandidateCount: attachmentOrganizerPlan.attachmentCandidateCount ?? 0,
    calendarCandidateCount: workReport.approvalQueue.filter((request) => request.operationKind === "create_calendar_event").length,
    webmailPlan: sanitizeWebmailPlanForUi(plan),
    webmailDomCaptureProfile: sanitizeWebmailDomCaptureProfileForUi(domCaptureProfile),
    webmailDomCapture: sanitizeWebmailDomCaptureForUi(domCapture),
    webmailDomExtraction: sanitizeWebmailDomExtractionForUi(domExtraction),
    webmailDomRecoveryGuide: sanitizeWebmailDomRecoveryGuideForUi(domRecoveryGuide),
    workAnalysis,
    initialLearningProfile,
    workReport: sanitizeDesktopControlMailReport(workReport),
    stagedWorkItem: inboxItems[0],
    inboxResult,
    auditFile: audit.auditFile,
    rollbackGuide: audit.auditRecord.rollbackGuide,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    appMayPersistSecret: false,
    aiMayReadSecret: false,
  };
}

function stageBrowserActionCandidate({ target, instruction, workItemId, browserActionId, deps }) {
  if (typeof deps?.appendInboxItems !== "function") {
    return {
      status: "capability_missing",
      capability: "stage_browser_action_candidate",
      userMessage: "브라우저 조작 최종 확인 카드는 설치된 데스크톱 앱 인박스와 연결된 상태에서 사용할 수 있습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const rawTarget = String(target ?? "").trim();
  const normalizedUrl = rawTarget ? normalizeAllowedUrl(rawTarget) : null;
  if (rawTarget && !normalizedUrl) {
    return createInvalidTargetResult(
      "stage_browser_action_candidate",
      "브라우저 조작 후보는 http/https URL 또는 사이트 확인 필요 상태에서만 최종 확인 카드로 올릴 수 있습니다.",
    );
  }

  const createdAt = new Date().toISOString();
  const safeUrl = normalizedUrl ? redactSensitiveUrl(normalizedUrl) : "";
  const hostLabel = safeUrl ? safeHostname(safeUrl) : "사이트 확인 필요";
  const intent = instruction || "선택한 브라우저 행동 후보를 최종 확인 카드로 준비해줘.";
  const selectedAction = selectBrowserActionCandidate({
    browserActionId,
    hostLabel,
    intent,
    targetUrl: safeUrl,
  });
  const dryRunPlan = createBrowserDryRunPlan({
    selectedAction,
    hostLabel,
    intent,
    targetUrl: safeUrl,
  });
  const finalPresenceContract = createBrowserFinalPresenceContract({
    selectedAction,
    dryRunPlan,
    hostLabel,
    targetUrl: safeUrl,
  });
  const itemId = `browser-action-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const workItem = {
    id: itemId,
    title: `브라우저 최종 확인: ${selectedAction.label}`,
    source: "web_page",
    sourceLabel: "브라우저 조작 후보",
    senderLabel: hostLabel,
    body: [
      `원본 업무 카드: ${workItemId || "확인 필요"}`,
      `대상 사이트: ${safeUrl || "사용자 확인 필요"}`,
      `선택 행동: ${selectedAction.label}`,
      `조작 종류: ${selectedAction.capability}`,
      `요청: ${intent}`,
      "실행 전 미리보기:",
      "1. 실행 전 현재 화면과 대상 요소를 다시 확인합니다.",
      "2. 클릭/입력 내용, 대상 버튼, 예상 결과를 사용자에게 보여줍니다.",
      "3. 사용자 최종 확인 전에는 실제 조작하지 않습니다.",
      "",
      "미리보기 상세:",
      `- 입력될 내용: ${dryRunPlan.intendedInput}`,
      `- 클릭 대상: ${dryRunPlan.clickTarget}`,
      `- 예상 결과: ${dryRunPlan.expectedResult}`,
      `- 취소/되돌리기: ${dryRunPlan.cancelPath} ${dryRunPlan.rollbackGuide}`,
      "",
      "현장 마지막 확인:",
      `- 상태: ${finalPresenceContract.readiness}`,
      `- 확인 문구: ${finalPresenceContract.userConfirmationPhrase}`,
      `- 차단 사유: ${finalPresenceContract.blockedReason}`,
    ].join("\n"),
    summary: `${hostLabel}의 ${selectedAction.label} 후보를 실행 전 미리보기/최종 확인 대기 카드로 만들었습니다.`,
    status: "approval_pending",
    riskLabel: selectedAction.riskLabel === "high" ? "high" : "medium",
    riskSignals: [
      {
        id: `browser-action:${Date.now().toString(36)}:final-presence`,
        label: "브라우저 조작 최종 확인 필요",
        riskLabel: selectedAction.riskLabel === "high" ? "high" : "medium",
        reason: "클릭, 입력, 단축키, 브라우저 자동화는 외부 서비스 상태를 바꿀 수 있어 실행 전 미리보기와 사용자 현장 확인 전까지 실행하지 않습니다.",
      },
    ],
    receivedAt: createdAt,
    draft: {
      id: `${itemId}:dry-run-plan`,
      toneLabel: "브라우저 조작 실행 전 미리보기",
      body: [
        `대상: ${safeUrl || "사이트 확인 필요"}`,
        `선택 행동: ${selectedAction.label}`,
        `조작 종류: ${selectedAction.capability}`,
        `이유: ${selectedAction.reason}`,
        "",
        "미리보기 상세",
        `- 입력될 내용: ${dryRunPlan.intendedInput}`,
        `- 클릭 대상: ${dryRunPlan.clickTarget}`,
        `- 예상 결과: ${dryRunPlan.expectedResult}`,
        `- 취소 안내: ${dryRunPlan.cancelPath}`,
        `- 되돌리기 안내: ${dryRunPlan.rollbackGuide}`,
        "",
        "현장 마지막 확인",
        `- 대상 요소: ${finalPresenceContract.targetElementDescription}`,
        `- 화면 증거: ${finalPresenceContract.screenEvidenceStatus}`,
        `- 확인 문구: ${finalPresenceContract.userConfirmationPhrase}`,
        `- 차단 사유: ${finalPresenceContract.blockedReason}`,
        "",
        "실행 전 확인할 것",
        ...dryRunPlan.preflightChecklist.map((item) => `- ${item}`),
      ].join("\n"),
      operationKind: "stage_approval",
      requiresApprovalBeforeSend: true,
    },
    browserTask: {
      targetUrl: safeUrl,
      host: hostLabel,
      requiresFinalUserPresence: true,
      blockedCapabilities: ["click", "type_text", "send_hotkey", "browser_automation"],
      actionPlan: [selectedAction],
      stagedAction: selectedAction,
      sourceWorkItemId: workItemId || "",
      dryRunRequired: true,
      dryRunPlan,
      finalPresenceContract,
    },
  };

  const inboxResult = deps.appendInboxItems([workItem], { createdAt });

  return {
    status: "browser_action_confirmation_staged",
    capability: "stage_browser_action_candidate",
    userMessage: `${selectedAction.label} 후보를 실행 전 미리보기/최종 확인 대기 카드로 올렸습니다.`,
    sideEffect: "none",
    observedAt: createdAt,
    stagedWorkItem: workItem,
    actionPlan: [selectedAction],
    inboxResult,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function attachBrowserScreenEvidence({ target, instruction, workItemId, deps }) {
  if (typeof deps?.getInboxSnapshot !== "function" || typeof deps?.upsertInboxItem !== "function") {
    return {
      status: "capability_missing",
      capability: "attach_browser_screen_evidence",
      userMessage: "화면 증거 붙이기는 설치된 데스크톱 앱 인박스와 연결된 상태에서 사용할 수 있습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (typeof deps?.captureScreenEvidence !== "function") {
    return {
      status: "capability_missing",
      capability: "attach_browser_screen_evidence",
      userMessage: "현재 데스크톱 앱에서 화면 캡처 확인 기능을 찾지 못했습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const itemId = sanitizeWorkItemId(workItemId);
  const sourceItem = deps.getInboxSnapshot().find((item) => item.id === itemId);
  const contract = sourceItem?.browserTask?.finalPresenceContract;
  if (!sourceItem || !contract) {
    return createInvalidTargetResult(
      "attach_browser_screen_evidence",
      "화면 증거를 붙일 브라우저 최종 확인 카드를 찾지 못했습니다.",
    );
  }

  const targetUrl = normalizeAllowedUrl(target || contract.targetUrl || sourceItem.browserTask.targetUrl) || "";
  const createdAt = new Date().toISOString();
  let captureResult;
  try {
    captureResult = await deps.captureScreenEvidence({
      targetUrl,
      host: contract.host || sourceItem.browserTask.host,
      actionLabel: contract.actionLabel,
      targetElementDescription: instruction || contract.targetElementDescription,
    });
  } catch (error) {
    return {
      status: "screen_evidence_capture_failed",
      capability: "attach_browser_screen_evidence",
      userMessage: `화면 증거를 붙이지 못했습니다: ${sanitizeWindowText(error?.message ?? error).slice(0, 160)}`,
      sideEffect: "read_only",
      observedAt: createdAt,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (!captureResult || captureResult.status !== "screen_evidence_captured") {
    return {
      status: "screen_evidence_capture_failed",
      capability: "attach_browser_screen_evidence",
      userMessage: sanitizeWindowText(captureResult?.userMessage ?? "화면 증거를 붙이지 못했습니다."),
      sideEffect: "read_only",
      observedAt: createdAt,
      screenEvidence: createBrowserScreenEvidenceRecord(captureResult, {
        createdAt,
        contract,
        instruction,
      }),
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const screenEvidence = createBrowserScreenEvidenceRecord(captureResult, {
    createdAt,
    contract,
    instruction,
  });
  const updatedContract = {
    ...contract,
    readiness: contract.screenEvidenceRequired === false ? "read_only_review" : "ready_for_user_confirmation",
    targetElementDescription: screenEvidence.targetElementDescription,
    screenEvidenceStatus: "captured",
    screenEvidence,
    blockedReason:
      "화면 증거와 대상 요소 설명은 카드에 붙었지만 실제 클릭/입력은 사용자 최종 확인 전까지 잠겨 있습니다.",
    allowedNextStep:
      "사용자가 화면 대상과 입력될 내용을 확인하면 다음 단계에서 제한 실행 후보로 넘길 수 있습니다.",
  };
  const bodyLines = [
    sourceItem.body,
    "",
    "화면 증거:",
    `- 캡처 시각: ${screenEvidence.capturedAt}`,
    `- 화면 소스: ${screenEvidence.sourceLabel}`,
    `- 매칭 사유: ${screenEvidence.matchReason}`,
    `- raw pixels 저장: ${screenEvidence.rawPixelsStored}`,
  ];
  const draftBody = [
    sourceItem.draft?.body || "",
    "",
    "화면 증거 붙임",
    `- 대상 요소: ${screenEvidence.targetElementDescription}`,
    `- 화면 소스: ${screenEvidence.sourceLabel}`,
    `- 매칭 사유: ${screenEvidence.matchReason}`,
    "- 실제 클릭/입력/발송/저장은 아직 실행하지 않았습니다.",
  ].join("\n");
  const updatedWorkItem = {
    ...sourceItem,
    status: "approval_pending",
    body: bodyLines.join("\n"),
    summary: `${sourceItem.browserTask.host} 화면 증거를 붙였습니다. 실제 조작은 여전히 사용자 최종 확인 전까지 잠겨 있습니다.`,
    draft: sourceItem.draft
      ? {
          ...sourceItem.draft,
          body: draftBody,
        }
      : sourceItem.draft,
    browserTask: {
      ...sourceItem.browserTask,
      finalPresenceContract: updatedContract,
    },
  };
  const inboxResult = deps.upsertInboxItem(updatedWorkItem, { createdAt });

  return {
    status: "browser_screen_evidence_attached",
    capability: "attach_browser_screen_evidence",
    userMessage: "브라우저 화면 증거를 최종 확인 카드에 붙였습니다. 실제 조작은 아직 잠겨 있습니다.",
    sideEffect: "read_only",
    observedAt: createdAt,
    stagedWorkItem: updatedWorkItem,
    screenEvidence,
    inboxResult,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function matchBrowserTargetElement({ instruction, workItemId, deps }) {
  if (typeof deps?.getInboxSnapshot !== "function" || typeof deps?.upsertInboxItem !== "function") {
    return {
      status: "capability_missing",
      capability: "match_browser_target_element",
      userMessage: "대상 요소 매칭은 설치된 데스크톱 앱 인박스와 연결된 상태에서 사용할 수 있습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const itemId = sanitizeWorkItemId(workItemId);
  const sourceItem = deps.getInboxSnapshot().find((item) => item.id === itemId);
  const contract = sourceItem?.browserTask?.finalPresenceContract;
  if (!sourceItem || !contract) {
    return createInvalidTargetResult(
      "match_browser_target_element",
      "대상 요소를 매칭할 브라우저 최종 확인 카드를 찾지 못했습니다.",
    );
  }

  if (!contract.screenEvidence || contract.screenEvidenceStatus !== "captured") {
    return {
      status: "target_element_match_blocked",
      capability: "match_browser_target_element",
      userMessage: "먼저 화면 증거를 붙여야 대상 버튼/입력칸 매칭을 진행할 수 있습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const createdAt = new Date().toISOString();
  const targetElementMatch = createBrowserTargetElementMatch({
    createdAt,
    contract,
    dryRunPlan: sourceItem.browserTask?.dryRunPlan,
    instruction,
  });
  const updatedContract = {
    ...contract,
    targetElementDescription: targetElementMatch.targetLabel,
    targetElementMatchStatus: "matched",
    targetElementMatch,
    blockedReason:
      "대상 요소 확인까지 완료됐지만 실제 클릭/입력은 사용자 최종 확인 전까지 잠겨 있습니다.",
    allowedNextStep:
      "사용자가 화면 대상 확인 문구와 미리보기 내용을 확인하면 다음 단계에서 마지막 확인을 준비합니다.",
  };
  const updatedWorkItem = {
    ...sourceItem,
    status: "approval_pending",
    summary: `${sourceItem.browserTask.host} 대상 요소 매칭을 완료했습니다. 실제 조작은 아직 잠겨 있습니다.`,
    body: [
      sourceItem.body,
      "",
      "대상 요소 매칭:",
      `- 상태: ${targetElementMatch.status}`,
      `- 신뢰도: ${targetElementMatch.confidence}`,
      `- 대상: ${targetElementMatch.targetLabel}`,
      `- 방식: ${targetElementMatch.matchingMethod}`,
    ].join("\n"),
    draft: sourceItem.draft
      ? {
          ...sourceItem.draft,
          body: [
            sourceItem.draft.body,
            "",
            "대상 요소 매칭 완료",
            `- 대상: ${targetElementMatch.targetLabel}`,
            `- 신뢰도: ${targetElementMatch.confidence}`,
            `- 안전 메모: ${targetElementMatch.safetyNotes.join(" / ")}`,
            "- 실제 클릭/입력/발송/저장은 아직 실행하지 않았습니다.",
          ].join("\n"),
        }
      : sourceItem.draft,
    browserTask: {
      ...sourceItem.browserTask,
      finalPresenceContract: updatedContract,
    },
  };
  const inboxResult = deps.upsertInboxItem(updatedWorkItem, { createdAt });

  return {
    status: "browser_target_element_matched",
    capability: "match_browser_target_element",
    userMessage: "화면 증거와 미리보기 대상 설명을 비교해 대상 요소 확인 기록을 남겼습니다.",
    sideEffect: "read_only",
    observedAt: createdAt,
    stagedWorkItem: updatedWorkItem,
    targetElementMatch,
    inboxResult,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function prepareBrowserLimitedExecution({ instruction, workItemId, deps }) {
  if (typeof deps?.getInboxSnapshot !== "function" || typeof deps?.upsertInboxItem !== "function") {
    return {
      status: "capability_missing",
      capability: "prepare_browser_limited_execution",
      userMessage: "브라우저 마지막 확인은 설치된 데스크톱 앱 인박스와 연결된 상태에서 사용할 수 있습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const itemId = sanitizeWorkItemId(workItemId);
  const sourceItem = deps.getInboxSnapshot().find((item) => item.id === itemId);
  const contract = sourceItem?.browserTask?.finalPresenceContract;
  if (!sourceItem || !contract) {
    return createInvalidTargetResult(
      "prepare_browser_limited_execution",
      "브라우저 마지막 확인을 준비할 최종 확인 카드를 찾지 못했습니다.",
    );
  }

  if (contract.targetElementMatchStatus !== "matched" || !contract.targetElementMatch) {
    return {
      status: "limited_execution_gate_blocked",
      capability: "prepare_browser_limited_execution",
      userMessage: "먼저 화면 증거와 대상 요소 확인을 완료해야 브라우저 마지막 확인을 준비할 수 있습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const createdAt = new Date().toISOString();
  const limitedExecutionGate = createBrowserLimitedExecutionGate({
    createdAt,
    contract,
    dryRunPlan: sourceItem.browserTask?.dryRunPlan,
    instruction,
  });
  const audit = persistBrowserLimitedExecutionAudit({
    gate: limitedExecutionGate,
    workItem: sourceItem,
    contract,
  });
  const gateWithAudit = {
    ...limitedExecutionGate,
    auditFile: audit.auditFile,
    auditRecorded: true,
  };
  const updatedContract = {
    ...contract,
    readiness: "limited_execution_ready",
    limitedExecutionGate: gateWithAudit,
    blockedReason:
      "브라우저 마지막 확인과 감사 기록은 준비됐지만 실제 클릭/입력은 사용자 최종 문구 확인 전까지 잠겨 있습니다.",
    allowedNextStep:
      "사용자가 '화면 대상 실행 확인' 문구를 확인하면 다음 단계에서 실제 조작 연결 여부를 점검합니다.",
  };
  const updatedWorkItem = {
    ...sourceItem,
    status: "approval_pending",
    summary: `${sourceItem.browserTask.host} 브라우저 마지막 확인을 준비하고 감사 기록을 남겼습니다.`,
    body: [
      sourceItem.body,
      "",
      "브라우저 마지막 확인:",
      `- 감사 ID: ${gateWithAudit.auditId}`,
      `- 확인 문구: ${gateWithAudit.confirmationPhrase}`,
      `- 실제 실행 활성화: ${gateWithAudit.liveExecutionEnabled}`,
      `- 감사 파일: ${gateWithAudit.auditFile}`,
    ].join("\n"),
    draft: sourceItem.draft
      ? {
          ...sourceItem.draft,
          body: [
            sourceItem.draft.body,
            "",
            "브라우저 마지막 확인 준비",
            `- 감사 ID: ${gateWithAudit.auditId}`,
            `- 확인 문구: ${gateWithAudit.confirmationPhrase}`,
            `- 되돌리기 안내: ${gateWithAudit.rollbackGuide}`,
            "- 실제 클릭/입력/발송/저장은 아직 실행하지 않았습니다.",
          ].join("\n"),
        }
      : sourceItem.draft,
    browserTask: {
      ...sourceItem.browserTask,
      finalPresenceContract: updatedContract,
    },
  };
  const inboxResult = deps.upsertInboxItem(updatedWorkItem, { createdAt });

  return {
    status: "browser_limited_execution_prepared",
    capability: "prepare_browser_limited_execution",
    userMessage: "브라우저 마지막 확인과 감사 기록을 준비했습니다. 실제 조작은 아직 잠겨 있습니다.",
    sideEffect: "read_only",
    observedAt: createdAt,
    stagedWorkItem: updatedWorkItem,
    limitedExecutionGate: gateWithAudit,
    auditFile: gateWithAudit.auditFile,
    inboxResult,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function confirmBrowserLimitedExecution({ instruction, workItemId, deps }) {
  if (typeof deps?.getInboxSnapshot !== "function" || typeof deps?.upsertInboxItem !== "function") {
    return {
      status: "capability_missing",
      capability: "confirm_browser_limited_execution",
      userMessage: "브라우저 최종 문구 확인은 설치된 데스크톱 앱 인박스와 연결된 상태에서 사용할 수 있습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const itemId = sanitizeWorkItemId(workItemId);
  const sourceItem = deps.getInboxSnapshot().find((item) => item.id === itemId);
  const contract = sourceItem?.browserTask?.finalPresenceContract;
  const gate = contract?.limitedExecutionGate;
  if (!sourceItem || !contract || !gate) {
    return createInvalidTargetResult(
      "confirm_browser_limited_execution",
      "최종 문구를 확인할 브라우저 마지막 확인 카드를 찾지 못했습니다.",
    );
  }

  const typedPhrase = sanitizeInstruction(instruction);
  const expectedPhrase = sanitizeInstruction(gate.confirmationPhrase || "화면 대상 실행 확인");
  if (typedPhrase !== expectedPhrase) {
    return {
      status: "limited_execution_confirmation_required",
      capability: "confirm_browser_limited_execution",
      userMessage: `최종 확인 문구가 필요합니다: ${expectedPhrase}`,
      sideEffect: "none",
      expectedPhrase,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const confirmedAt = new Date().toISOString();
  const audit = persistBrowserLimitedExecutionConfirmationAudit({
    gate,
    workItem: sourceItem,
    contract,
    confirmedAt,
  });
  const confirmedGate = {
    ...gate,
    status: "blocked",
    userConfirmedAt: confirmedAt,
    userConfirmationVerified: true,
    adapterReadiness: "adapter_not_connected",
    executionStatus: "adapter_locked",
    confirmationAuditFile: audit.auditFile,
    confirmationAuditRecorded: true,
    liveExecutionEnabled: false,
    dryRunOnly: true,
  };
  const updatedContract = {
    ...contract,
    readiness: "limited_execution_confirmed_adapter_locked",
    limitedExecutionGate: confirmedGate,
    blockedReason:
      "사용자 최종 문구는 확인됐지만 실제 브라우저 클릭/입력 연결이 없어 실행을 차단했습니다.",
    allowedNextStep:
      "다음 단계에서 화면 대상 검증과 실행 전후 감사 기록, 되돌리기 절차를 검증합니다.",
  };
  const updatedWorkItem = {
    ...sourceItem,
    status: "approval_pending",
    summary: `${sourceItem.browserTask.host} 최종 확인 문구를 기록했고, 실제 조작 연결이 없어 실행을 차단했습니다.`,
    body: [
      sourceItem.body,
      "",
      "제한 실행 최종 문구 확인:",
      `- 확인 시각: ${confirmedAt}`,
      `- 확인 문구: ${expectedPhrase}`,
      `- 실행 연결 상태: ${confirmedGate.adapterReadiness}`,
      `- 확인 감사 파일: ${confirmedGate.confirmationAuditFile}`,
    ].join("\n"),
    draft: sourceItem.draft
      ? {
          ...sourceItem.draft,
          body: [
            sourceItem.draft.body,
            "",
            "최종 문구 확인 기록",
            `- 확인 문구: ${expectedPhrase}`,
            `- 실행 상태: ${confirmedGate.executionStatus}`,
            "- 실제 클릭/입력/발송/저장은 실행 연결이 없어 진행하지 않았습니다.",
          ].join("\n"),
        }
      : sourceItem.draft,
    browserTask: {
      ...sourceItem.browserTask,
      finalPresenceContract: updatedContract,
    },
  };
  const inboxResult = deps.upsertInboxItem(updatedWorkItem, { createdAt: confirmedAt });

  return {
    status: "browser_limited_execution_confirmed_adapter_locked",
    capability: "confirm_browser_limited_execution",
    userMessage: "최종 확인 문구를 기록했습니다. 실제 브라우저 조작 연결이 없어 실행은 차단했습니다.",
    sideEffect: "read_only",
    observedAt: confirmedAt,
    stagedWorkItem: updatedWorkItem,
    limitedExecutionGate: confirmedGate,
    auditFile: confirmedGate.confirmationAuditFile,
    inboxResult,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function requestBrowserLimitedExecution({ instruction, workItemId, deps }) {
  if (typeof deps?.getInboxSnapshot !== "function" || typeof deps?.upsertInboxItem !== "function") {
    return {
      status: "capability_missing",
      capability: "request_browser_limited_execution",
      userMessage: "제한 실행 요청 점검은 설치된 데스크톱 앱 인박스와 연결된 상태에서 사용할 수 있습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const itemId = sanitizeWorkItemId(workItemId);
  const sourceItem = deps.getInboxSnapshot().find((item) => item.id === itemId);
  const contract = sourceItem?.browserTask?.finalPresenceContract;
  const gate = contract?.limitedExecutionGate;
  if (!sourceItem || !contract || !gate) {
    return createInvalidTargetResult(
      "request_browser_limited_execution",
      "실행 요청을 점검할 브라우저 마지막 확인 카드를 찾지 못했습니다.",
    );
  }

  if (gate.userConfirmationVerified !== true) {
    return {
      status: "limited_execution_confirmation_required",
      capability: "request_browser_limited_execution",
      userMessage: `실행 요청 전 최종 확인 문구가 필요합니다: ${gate.confirmationPhrase || "화면 대상 실행 확인"}`,
      sideEffect: "none",
      expectedPhrase: sanitizeInstruction(gate.confirmationPhrase || "화면 대상 실행 확인"),
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const attemptedAt = new Date().toISOString();
  const liveAdapterEnabled = deps?.enableLiveBrowserLimitedExecution === true;
  const liveAdapterAvailable = typeof deps?.executeBrowserLimitedAction === "function";
  if (liveAdapterEnabled && liveAdapterAvailable) {
    return executeBrowserLimitedActionWithAdapter({
      instruction,
      workItem: sourceItem,
      contract,
      gate,
      attemptedAt,
      deps,
    });
  }

  const audit = persistBrowserLimitedExecutionAttemptAudit({
    gate,
    workItem: sourceItem,
    contract,
    attemptedAt,
    instruction,
  });
  const blockedReason =
    "브라우저 실행 연결이 없어 실제 클릭/입력을 차단했습니다.";
  const attemptedGate = {
    ...gate,
    status: "blocked",
    executionAttemptedAt: attemptedAt,
    executionAttemptAuditFile: audit.auditFile,
    executionAttemptAuditRecorded: true,
    adapterReadiness: "adapter_not_connected",
    executionStatus: "adapter_locked",
    blockedReason,
    liveExecutionEnabled: false,
    dryRunOnly: true,
    rawCoordinatesStored: false,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  const updatedContract = {
    ...contract,
    readiness: "limited_execution_confirmed_adapter_locked",
    limitedExecutionGate: attemptedGate,
    blockedReason,
    allowedNextStep:
      "실제 브라우저 조작은 화면 대상 검증, 실행 직전 재확인, 실행 후 감사 기록이 모두 붙은 뒤에만 열 수 있습니다.",
  };
  const updatedWorkItem = {
    ...sourceItem,
    status: "approval_pending",
    summary: `${sourceItem.browserTask.host} 실행 요청을 점검했고, 실행 연결이 없어 실제 조작을 차단했습니다.`,
    body: [
      sourceItem.body,
      "",
      "제한 실행 요청 점검:",
      `- 요청 시각: ${attemptedAt}`,
      `- 요청 지시: ${sanitizeInstruction(instruction || gate.actionLabel)}`,
      `- 실행 상태: ${attemptedGate.executionStatus}`,
      `- 실행 요청 감사 파일: ${attemptedGate.executionAttemptAuditFile}`,
    ].join("\n"),
    draft: sourceItem.draft
      ? {
          ...sourceItem.draft,
          body: [
            sourceItem.draft.body,
            "",
            "실행 요청 차단 기록",
            `- 요청 시각: ${attemptedAt}`,
            `- 차단 사유: ${blockedReason}`,
            "- 실제 클릭/입력/발송/저장은 실행하지 않았습니다.",
          ].join("\n"),
        }
      : sourceItem.draft,
    browserTask: {
      ...sourceItem.browserTask,
      finalPresenceContract: updatedContract,
    },
  };
  const inboxResult = deps.upsertInboxItem(updatedWorkItem, { createdAt: attemptedAt });

  return {
    status: "browser_limited_execution_adapter_blocked",
    capability: "request_browser_limited_execution",
    userMessage: "실행 요청을 감사 기록으로 남겼고, 실행 연결이 없어 실제 조작은 차단했습니다.",
    sideEffect: "read_only",
    observedAt: attemptedAt,
    stagedWorkItem: updatedWorkItem,
    limitedExecutionGate: attemptedGate,
    auditFile: attemptedGate.executionAttemptAuditFile,
    inboxResult,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function executeBrowserLimitedActionWithAdapter({ instruction, workItem, contract, gate, attemptedAt, deps }) {
  const audit = persistBrowserLimitedExecutionAttemptAudit({
    gate,
    workItem,
    contract,
    attemptedAt,
    instruction,
    adapterReadiness: "ready",
    executionStatus: "adapter_requested",
    kind: "browser_limited_execution_attempt_requested",
  });
  const adapterResult = await deps.executeBrowserLimitedAction({
    auditId: gate.auditId,
    workItemId: sanitizeWorkItemId(workItem?.id),
    targetUrl: contract.targetUrl,
    host: contract.host,
    actionCapability: gate.actionCapability,
    actionLabel: gate.actionLabel,
    targetLabel: gate.targetLabel,
    intendedInput: gate.intendedInput,
    expectedResult: gate.expectedResult,
    instruction: sanitizeInstruction(instruction || gate.actionLabel),
    finalUserPresence: true,
    userConfirmationVerified: true,
    rawCoordinatesStored: false,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  });
  const executedAt = new Date().toISOString();
  const normalizedResult = normalizeBrowserLimitedExecutionAdapterResult(adapterResult, executedAt);
  const resultAudit = persistBrowserLimitedExecutionResultAudit({
    gate,
    workItem,
    contract,
    attemptedAt,
    executedAt,
    adapterResult: normalizedResult,
  });
  const executedGate = {
    ...gate,
    status: normalizedResult.status === "executed" ? "executed" : "blocked",
    executionAttemptedAt: attemptedAt,
    executionAttemptAuditFile: audit.auditFile,
    executionAttemptAuditRecorded: true,
    executedAt: normalizedResult.status === "executed" ? executedAt : "",
    executionAuditFile: resultAudit.auditFile,
    executionAuditRecorded: true,
    adapterReadiness: normalizedResult.status === "executed" ? "ready" : "adapter_not_connected",
    executionStatus: normalizedResult.status === "executed" ? "executed" : "adapter_locked",
    adapterResultSummary: normalizedResult.summary,
    blockedReason: normalizedResult.status === "executed" ? "" : normalizedResult.userMessage,
    liveExecutionEnabled: normalizedResult.status === "executed",
    dryRunOnly: normalizedResult.status !== "executed",
    rawCoordinatesStored: false,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  const externalMutation = normalizedResult.externalMutation === true;
  const updatedContract = {
    ...contract,
    readiness:
      normalizedResult.status === "executed"
        ? "limited_execution_executed"
        : "limited_execution_confirmed_adapter_locked",
    limitedExecutionGate: executedGate,
    blockedReason:
      normalizedResult.status === "executed"
        ? "실행 연결이 감사 기록과 함께 제한 작업을 완료했습니다."
        : normalizedResult.userMessage,
    allowedNextStep:
      normalizedResult.status === "executed"
        ? "실행 후 화면 결과와 되돌리기 안내를 사용자가 확인합니다."
        : "실행 결과가 조건을 만족하지 않아 실제 조작을 차단했습니다.",
  };
  const updatedWorkItem = {
    ...workItem,
    status: normalizedResult.status === "executed" ? "needs_review" : "approval_pending",
    summary:
      normalizedResult.status === "executed"
        ? `${workItem.browserTask.host} 제한 실행을 완료하고 감사 기록을 남겼습니다.`
        : `${workItem.browserTask.host} 실행 연결이 제한 실행을 차단했습니다.`,
    body: [
      workItem.body,
      "",
      "제한 실행 결과:",
      `- 요청 시각: ${attemptedAt}`,
      `- 결과 시각: ${executedAt}`,
      `- 실행 상태: ${executedGate.executionStatus}`,
      `- 결과 요약: ${normalizedResult.summary}`,
      `- 결과 감사 파일: ${executedGate.executionAuditFile}`,
    ].join("\n"),
    draft: workItem.draft
      ? {
          ...workItem.draft,
          body: [
            workItem.draft.body,
            "",
            "제한 실행 결과",
            `- 실행 상태: ${executedGate.executionStatus}`,
            `- 외부 변경 여부: ${externalMutation}`,
            `- 결과: ${normalizedResult.summary}`,
          ].join("\n"),
        }
      : workItem.draft,
    browserTask: {
      ...workItem.browserTask,
      finalPresenceContract: updatedContract,
    },
  };
  const inboxResult = deps.upsertInboxItem(updatedWorkItem, { createdAt: executedAt });

  return {
    status:
      normalizedResult.status === "executed"
        ? "browser_limited_execution_executed"
        : "browser_limited_execution_adapter_blocked",
    capability: "request_browser_limited_execution",
    userMessage: normalizedResult.userMessage,
    sideEffect: normalizedResult.sideEffect,
    observedAt: executedAt,
    stagedWorkItem: updatedWorkItem,
    limitedExecutionGate: executedGate,
    auditFile: executedGate.executionAuditFile,
    adapterResult: normalizedResult,
    inboxResult,
    externalMutation,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function verifyBrowserLimitedExecutionResult({ instruction, workItemId, deps }) {
  if (
    typeof deps?.getInboxSnapshot !== "function" ||
    typeof deps?.upsertInboxItem !== "function" ||
    typeof deps?.captureScreenEvidence !== "function"
  ) {
    return {
      status: "capability_missing",
      capability: "verify_browser_limited_execution_result",
      userMessage: "실행 결과 확인은 설치된 데스크톱 앱 인박스와 화면 증거 확인 기능이 연결된 상태에서 사용할 수 있습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const itemId = sanitizeWorkItemId(workItemId);
  const sourceItem = deps.getInboxSnapshot().find((item) => item.id === itemId);
  const contract = sourceItem?.browserTask?.finalPresenceContract;
  const gate = contract?.limitedExecutionGate;
  if (!sourceItem || !contract || !gate) {
    return createInvalidTargetResult(
      "verify_browser_limited_execution_result",
      "결과를 확인할 제한 실행 카드를 찾지 못했습니다.",
    );
  }

  if (gate.executionStatus !== "executed" || gate.executionAuditRecorded !== true) {
    return {
      status: "browser_limited_execution_result_verification_blocked",
      capability: "verify_browser_limited_execution_result",
      userMessage: "먼저 제한 실행이 완료된 카드에서만 결과 화면을 확인할 수 있습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const verifiedAt = new Date().toISOString();
  const evidence = await deps.captureScreenEvidence({
    targetUrl: contract.targetUrl,
    targetElementDescription: `${gate.targetLabel} 실행 후 결과 화면`,
    instruction: instruction || gate.expectedResult,
    postExecution: true,
  });
  const postExecutionEvidence = createBrowserPostExecutionEvidence({
    evidence,
    gate,
    verifiedAt,
    instruction,
  });
  const verificationStatus =
    evidence?.status === "screen_evidence_captured" ? "verified" : "needs_user_review";
  const audit = persistBrowserLimitedExecutionVerificationAudit({
    gate,
    workItem: sourceItem,
    contract,
    postExecutionEvidence,
    verifiedAt,
    verificationStatus,
  });
  const verifiedGate = {
    ...gate,
    postExecutionVerifiedAt: verifiedAt,
    postExecutionStatus: verificationStatus,
    postExecutionAuditFile: audit.auditFile,
    postExecutionAuditRecorded: true,
    postExecutionEvidence,
    userVisibleOutcome:
      verificationStatus === "verified"
        ? "붙여넣기 후 화면 결과를 read-only로 확인했습니다. 발송/저장/예약 확정은 사용자가 화면에서 별도로 확인합니다."
        : "붙여넣기 후 화면 결과 확인에 추가 사용자 검토가 필요합니다.",
    rawCoordinatesStored: false,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  const updatedContract = {
    ...contract,
    readiness:
      verificationStatus === "verified"
        ? "limited_execution_result_verified"
        : "limited_execution_result_needs_review",
    limitedExecutionGate: verifiedGate,
    blockedReason:
      verificationStatus === "verified"
        ? "실행 후 결과 화면은 확인됐지만 최종 발송/저장/확정은 사용자가 직접 판단합니다."
        : "실행 후 화면 결과 확인에 추가 사용자 검토가 필요합니다.",
    allowedNextStep:
      verificationStatus === "verified"
        ? "사용자는 붙여넣은 내용을 확인한 뒤 발송, 저장, 확정 여부를 직접 선택합니다."
        : "사용자가 현재 화면을 직접 확인하고 필요하면 다시 화면 증거를 붙입니다.",
  };
  const updatedWorkItem = {
    ...sourceItem,
    status: "needs_review",
    summary:
      verificationStatus === "verified"
        ? `${sourceItem.browserTask.host} 붙여넣기 후 화면 결과를 확인했습니다.`
        : `${sourceItem.browserTask.host} 붙여넣기 후 화면 결과 추가 확인이 필요합니다.`,
    body: [
      sourceItem.body,
      "",
      "제한 실행 후 결과 확인:",
      `- 확인 시각: ${verifiedAt}`,
      `- 확인 상태: ${verificationStatus}`,
      `- 화면 소스: ${postExecutionEvidence.sourceLabel}`,
      `- 감사 파일: ${verifiedGate.postExecutionAuditFile}`,
    ].join("\n"),
    draft: sourceItem.draft
      ? {
          ...sourceItem.draft,
          body: [
            sourceItem.draft.body,
            "",
            "실행 후 결과 확인",
            `- 상태: ${verificationStatus}`,
            `- 화면 소스: ${postExecutionEvidence.sourceLabel}`,
            "- 최종 발송/저장/예약 확정은 사용자가 화면에서 직접 확인합니다.",
          ].join("\n"),
        }
      : sourceItem.draft,
    browserTask: {
      ...sourceItem.browserTask,
      finalPresenceContract: updatedContract,
    },
  };
  const inboxResult = deps.upsertInboxItem(updatedWorkItem, { createdAt: verifiedAt });

  return {
    status:
      verificationStatus === "verified"
        ? "browser_limited_execution_result_verified"
        : "browser_limited_execution_result_needs_review",
    capability: "verify_browser_limited_execution_result",
    userMessage:
      verificationStatus === "verified"
        ? "붙여넣기 후 화면 결과를 read-only로 확인하고 감사 기록을 남겼습니다."
        : "붙여넣기 후 화면 결과 확인에 추가 검토가 필요해 감사 기록을 남겼습니다.",
    sideEffect: "read_only",
    observedAt: verifiedAt,
    stagedWorkItem: updatedWorkItem,
    limitedExecutionGate: verifiedGate,
    postExecutionEvidence,
    auditFile: verifiedGate.postExecutionAuditFile,
    inboxResult,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function planBrowserActions({ target, instruction, workItemId, deps }) {
  if (typeof deps?.upsertInboxItem !== "function") {
    return {
      status: "capability_missing",
      capability: "plan_browser_actions",
      userMessage: "브라우저 행동 후보는 설치된 데스크톱 앱 인박스와 연결된 상태에서 사용할 수 있습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const rawTarget = String(target ?? "").trim();
  const normalizedUrl = rawTarget ? normalizeAllowedUrl(rawTarget) : null;
  if (rawTarget && !normalizedUrl) {
    return createInvalidTargetResult(
      "plan_browser_actions",
      "브라우저 행동 후보는 http/https URL 또는 사이트 확인 필요 상태에서만 만들 수 있습니다.",
    );
  }

  const createdAt = new Date().toISOString();
  const safeUrl = normalizedUrl ? redactSensitiveUrl(normalizedUrl) : "";
  const hostLabel = safeUrl ? safeHostname(safeUrl) : "사이트 확인 필요";
  const intent = instruction || "브라우저에서 처리할 다음 행동 후보를 정리해줘.";
  const actionPlan = createBrowserActionPlan({ hostLabel, intent, targetUrl: safeUrl });
  const itemId = workItemId || `browser-plan-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const workItem = {
    id: itemId,
    title: `브라우저 행동 후보: ${hostLabel}`,
    source: "web_page",
    sourceLabel: "브라우저 업무",
    senderLabel: hostLabel,
    body: [
      `대상 사이트: ${safeUrl || "사용자 확인 필요"}`,
      `요청: ${intent}`,
      "AI 행동 후보:",
      ...actionPlan.map((action, index) =>
        `${index + 1}. ${action.label} - ${action.capability} / ${action.requiresFinalUserPresence ? "최종 확인 필요" : "읽기 전용"}`,
      ),
    ].join("\n"),
    summary: `${hostLabel}에서 AI가 다음에 할 수 있는 행동 후보 ${actionPlan.length}개를 준비했습니다.`,
    status: "draft_ready",
    riskLabel: "medium",
    riskSignals: [
      {
        id: `browser-plan:${Date.now().toString(36)}:blocked-mutation`,
        label: "클릭/입력 실행 차단",
        riskLabel: "medium",
        reason: "이 단계는 행동 후보 제안만 수행하며 실제 클릭, 입력, 단축키, 브라우저 자동화는 실행하지 않습니다.",
      },
    ],
    receivedAt: createdAt,
    draft: {
      id: `${itemId}:browser-action-plan`,
      toneLabel: "브라우저 행동 후보",
      body: [
        `대상: ${safeUrl || "사이트 확인 필요"}`,
        `요청: ${intent}`,
        "",
        "행동 후보",
        ...actionPlan.map((action, index) =>
          `${index + 1}. ${action.label}\n- 종류: ${action.capability}\n- 이유: ${action.reason}\n- 실행 조건: ${
            action.requiresFinalUserPresence ? "사용자 최종 확인 후 별도 단계" : "읽기 전용 확인"
          }`,
        ),
        "",
        "안전 경계: 지금은 클릭, 입력, 발송, 결제, 삭제를 실행하지 않았습니다.",
      ].join("\n"),
      operationKind: "stage_approval",
      requiresApprovalBeforeSend: true,
    },
    browserTask: {
      targetUrl: safeUrl,
      host: hostLabel,
      requiresFinalUserPresence: true,
      blockedCapabilities: ["click", "type_text", "send_hotkey", "browser_automation"],
      actionPlan,
    },
  };

  const inboxResult = deps.upsertInboxItem(workItem, { createdAt });

  return {
    status: "browser_actions_planned",
    capability: "plan_browser_actions",
    userMessage: `${hostLabel} 브라우저 업무의 다음 행동 후보 ${actionPlan.length}개를 만들었습니다.`,
    sideEffect: "read_only",
    observedAt: createdAt,
    stagedWorkItem: workItem,
    actionPlan,
    inboxResult,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function stageFileWorkItem({ target, instruction, deps }) {
  if (typeof deps?.appendInboxItems !== "function") {
    return {
      status: "capability_missing",
      capability: "stage_file_work_item",
      userMessage: "업무 카드 생성은 설치된 데스크톱 앱 인박스와 연결된 상태에서 사용할 수 있습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const normalizedPath = normalizeAllowedLocalPath(target);
  if (!normalizedPath && !String(target ?? "").trim() && deps?.dialog?.showOpenDialog) {
    const selection = await chooseLocalScopePathForWorkItem({ deps });
    if (selection.result) return selection.result;
    return stageFileWorkItem({ target: selection.path, instruction, deps });
  }

  if (!normalizedPath) {
    return createInvalidTargetResult(
      "stage_file_work_item",
      "업무 카드로 만들 파일의 절대 경로가 필요합니다. 설치 앱에서는 파일 선택창으로 직접 고른 파일만 승인 후보로 만들 수 있습니다.",
    );
  }

  const createdAt = new Date().toISOString();
  const targetName = sanitizeWindowText(path.basename(normalizedPath)).slice(0, 120);
  const parentFolderName = sanitizeWindowText(path.basename(path.dirname(normalizedPath))).slice(0, 80);
  let fileSize = "확인 필요";
  let modifiedAt = createdAt;
  let scopeKind = "file";
  let childCountLabel = "";
  try {
    const stats = statSync(normalizedPath);
    scopeKind = stats.isDirectory() ? "folder" : "file";
    fileSize = stats.isDirectory() ? "폴더" : formatFileSize(stats.size);
    modifiedAt = stats.mtime.toISOString();
    if (stats.isDirectory()) {
      childCountLabel = summarizeSelectedFolderChildren(normalizedPath);
    }
  } catch {
    // normalizeAllowedLocalPath already checked existence. Keep a safe fallback for race conditions.
  }

  const intent = instruction || "이 문서를 기준으로 필요한 확인 항목과 다음 업무를 정리해줘.";
  const targetKindLabel = scopeKind === "folder" ? "폴더" : "문서";
  const safeScopePolicy = "selected_file_or_folder_only_no_recursive_mutation";
  const folderPolicyText =
    scopeKind === "folder"
      ? "선택한 폴더 안의 이름/개수만 승인 후보로 기록하고, 하위 파일 읽기·이동·삭제는 실행하지 않습니다."
      : "선택한 파일의 이름/위치/크기만 승인 후보로 기록하고, 본문 읽기·수정·이동·삭제는 실행하지 않습니다.";
  const workItem = {
    id: `local-file-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    title: `${targetKindLabel} 확인: ${targetName}`,
    source: "local_file",
    sourceLabel: scopeKind === "folder" ? "내 컴퓨터 폴더" : "내 컴퓨터 문서",
    senderLabel: parentFolderName || "로컬 파일",
    body: [
      `${targetKindLabel}명: ${targetName}`,
      `위치: ${parentFolderName}`,
      `크기/범위: ${fileSize}${childCountLabel ? ` · ${childCountLabel}` : ""}`,
      `수정: ${modifiedAt}`,
      `요청: ${intent}`,
      `선택 범위 정책: ${safeScopePolicy}`,
      `안전 경계: ${folderPolicyText}`,
    ].join("\n"),
    summary: `${targetName} ${targetKindLabel}를 업무 카드로 올렸습니다. 내용 변경 없이 선택 범위 미리보기와 승인 대기만 준비했습니다.`,
    status: "approval_pending",
    riskLabel: "medium",
    riskSignals: [
      {
        id: `local-file:${Date.now().toString(36)}:open-confirm`,
        label: `${targetKindLabel} 작업 전 확인`,
        riskLabel: "medium",
        reason: `${targetKindLabel} 열기, 내용 분석, 이동, 삭제는 사용자가 선택한 범위 안에서 승인 흐름으로만 진행합니다.`,
      },
    ],
    receivedAt: createdAt,
    draft: {
      id: `local-file:${Date.now().toString(36)}:draft`,
      toneLabel: "문서 업무 준비",
      body: [
        `대상 ${targetKindLabel}: ${targetName}`,
        `사용자 요청: ${intent}`,
        "다음 단계: 선택 범위를 확인한 뒤 누락, 금액, 일정, 답장 초안, 폴더 정리 계획 등 필요한 결과물을 만들 수 있습니다.",
        `안전 경계: ${folderPolicyText}`,
      ].join("\n"),
      operationKind: "stage_approval",
      requiresApprovalBeforeSend: true,
    },
    localFile: createLocalFileMetadata(normalizedPath, {
      fileName: targetName,
      folderName: parentFolderName,
      fileSize,
      modifiedAt,
      scopeKind,
      selectionMode: "user_selected_file_or_folder",
      folderScopePolicy: safeScopePolicy,
      childCountLabel,
    }),
  };
  const stageAudit = persistDesktopWorkItemStageAudit({
    kind: "file_work_item_staged",
    capability: "stage_file_work_item",
    workItem,
    targetLabel: targetName,
    instruction: intent,
    rollbackGuide: "실행 전 카드라 취소하면 원본 파일 변경 없이 승인 후보만 멈춥니다.",
    scopeKind,
    folderScopePolicy: safeScopePolicy,
  });

  const inboxResult = deps.appendInboxItems([workItem], { createdAt });

  return {
    status: "work_item_staged",
    capability: "stage_file_work_item",
    userMessage:
      inboxResult.addedCount > 0
        ? `${targetName} ${targetKindLabel}를 승인 대기 업무 카드로 올렸습니다.`
        : "이미 같은 문서 업무 카드가 있거나 새로 올릴 카드가 없습니다.",
    sideEffect: "none",
    observedAt: createdAt,
    stagedWorkItem: workItem,
    inboxResult,
    auditFile: stageAudit.auditFile,
    rollbackGuide: stageAudit.auditRecord.rollbackGuide,
    scopeFlow: stageAudit.auditRecord.scopeFlow,
    folderScopePolicy: stageAudit.auditRecord.folderScopePolicy,
    previewBeforeApproval: stageAudit.auditRecord.previewBeforeApproval,
    executionLogBoundary: stageAudit.auditRecord.executionLogBoundary,
    rollbackGuideRequired: stageAudit.auditRecord.rollbackGuideRequired,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function chooseLocalScopePathForWorkItem({ deps }) {
  const result = await deps.dialog.showOpenDialog({
    title: "ModyCrew에서 업무 카드로 만들 파일 또는 폴더 선택",
    properties: ["openFile", "openDirectory"],
    filters: [
      { name: "업무 문서", extensions: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "hwp", "hwpx", "txt", "csv"] },
      { name: "모든 파일", extensions: ["*"] },
    ],
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return {
      result: {
        status: "confirmation_rejected",
        capability: "stage_file_work_item",
        userMessage: "파일 선택이 취소되었습니다.",
        sideEffect: "none",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
    };
  }

  const normalizedPath = normalizeAllowedLocalPath(result.filePaths[0]);
  if (!normalizedPath) {
    return {
      result: createInvalidTargetResult(
        "stage_file_work_item",
        "선택한 파일/폴더를 업무 카드로 만들 수 없습니다. 사용자 폴더, 임시 폴더, 현재 작업 폴더 안의 대상만 허용합니다.",
      ),
    };
  }

  return { path: normalizedPath };
}

async function analyzeLocalFile({ target, instruction, workItemId, deps }) {
  const normalizedPath = normalizeAllowedLocalPath(target);
  if (!normalizedPath) {
    return createInvalidTargetResult(
      "analyze_local_file",
      "분석할 파일의 절대 경로가 필요합니다. 사용자 폴더, 임시 폴더, 현재 작업 폴더 안의 파일만 허용합니다.",
    );
  }

  if (typeof deps?.upsertInboxItem !== "function") {
    return {
      status: "capability_missing",
      capability: "analyze_local_file",
      userMessage: "문서 분석 결과를 남길 인박스 연결을 찾지 못했습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  let stats;
  try {
    stats = statSync(normalizedPath);
  } catch {
    return createInvalidTargetResult("analyze_local_file", "분석할 파일을 찾지 못했습니다.");
  }
  if (!stats.isFile() || stats.size <= 0) {
    return createInvalidTargetResult("analyze_local_file", "비어 있거나 읽을 수 없는 파일입니다.");
  }
  if (stats.size > 20 * 1024 * 1024) {
    return {
      status: "blocked",
      capability: "analyze_local_file",
      userMessage: "20MB가 넘는 파일은 현재 안전 모드에서 분석하지 않습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const fileName = sanitizeWindowText(path.basename(normalizedPath)).slice(0, 120);
  const folderName = sanitizeWindowText(path.basename(path.dirname(normalizedPath))).slice(0, 80);
  let extractedText = "";
  try {
    extractedText = await extractLocalDocumentText(normalizedPath);
  } catch (error) {
    return {
      status: "blocked",
      capability: "analyze_local_file",
      userMessage:
        error instanceof Error
          ? `문서 내용을 읽지 못했습니다: ${sanitizeWindowText(error.message).slice(0, 120)}`
          : "문서 내용을 읽지 못했습니다.",
      sideEffect: "read_only",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const analysis = createDocumentAnalysis({
    fileName,
    instruction,
    text: extractedText,
  });
  const createdAt = new Date().toISOString();
  const itemId = workItemId || `local-file-analysis-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const workItem = {
    id: itemId,
    title: `문서 분석: ${fileName}`,
    source: "local_file",
    sourceLabel: "내 컴퓨터 문서",
    senderLabel: folderName || "로컬 파일",
    body: [
      `파일명: ${fileName}`,
      `폴더: ${folderName}`,
      `크기: ${formatFileSize(stats.size)}`,
      `수정: ${stats.mtime.toISOString()}`,
      `요청: ${instruction || "문서 내용을 읽고 확인할 업무를 정리해줘."}`,
    ].join("\n"),
    summary: analysis.summary,
    status: "draft_ready",
    riskLabel: analysis.riskLabel,
    riskSignals: analysis.riskSignals,
    receivedAt: createdAt,
    draft: {
      id: `${itemId}:analysis`,
      toneLabel: "문서 분석 결과",
      body: analysis.body,
      operationKind: "stage_approval",
      requiresApprovalBeforeSend: true,
    },
    localFile: createLocalFileMetadata(normalizedPath, {
      fileName,
      folderName,
      fileSize: formatFileSize(stats.size),
      modifiedAt: stats.mtime.toISOString(),
      extractedTextStatus: "ready",
      preview: compactText(extractedText, 280),
    }),
  };

  const inboxResult = deps.upsertInboxItem(workItem, { createdAt });

  return {
    status: "file_analyzed",
    capability: "analyze_local_file",
    userMessage: `${fileName} 문서를 읽고 확인 항목 ${analysis.checklist.length}개를 업무 카드에 반영했습니다.`,
    sideEffect: "read_only",
    observedAt: createdAt,
    stagedWorkItem: workItem,
    analysis: {
      summary: analysis.summary,
      checklist: analysis.checklist,
      extractedCharacterCount: extractedText.length,
      preview: compactText(extractedText, 240),
    },
    inboxResult,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function draftFromLocalFile({ target, instruction, workItemId, outputKind, deps }) {
  const normalizedPath = normalizeAllowedLocalPath(target);
  if (!normalizedPath) {
    return createInvalidTargetResult(
      "draft_from_local_file",
      "초안을 만들 파일의 절대 경로가 필요합니다. 사용자 폴더, 임시 폴더, 현재 작업 폴더 안의 파일만 허용합니다.",
    );
  }

  if (typeof deps?.upsertInboxItem !== "function") {
    return {
      status: "capability_missing",
      capability: "draft_from_local_file",
      userMessage: "문서 산출물 초안을 남길 인박스 연결을 찾지 못했습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  let stats;
  try {
    stats = statSync(normalizedPath);
  } catch {
    return createInvalidTargetResult("draft_from_local_file", "초안을 만들 파일을 찾지 못했습니다.");
  }
  if (!stats.isFile() || stats.size <= 0) {
    return createInvalidTargetResult("draft_from_local_file", "비어 있거나 읽을 수 없는 파일입니다.");
  }
  if (stats.size > 20 * 1024 * 1024) {
    return {
      status: "blocked",
      capability: "draft_from_local_file",
      userMessage: "20MB가 넘는 파일은 현재 안전 모드에서 산출물 초안을 만들지 않습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const fileName = sanitizeWindowText(path.basename(normalizedPath)).slice(0, 120);
  const folderName = sanitizeWindowText(path.basename(path.dirname(normalizedPath))).slice(0, 80);
  let extractedText = "";
  try {
    extractedText = await extractLocalDocumentText(normalizedPath);
  } catch (error) {
    return {
      status: "blocked",
      capability: "draft_from_local_file",
      userMessage:
        error instanceof Error
          ? `문서 초안을 만들 수 없습니다: ${sanitizeWindowText(error.message).slice(0, 120)}`
          : "문서 초안을 만들 수 없습니다.",
      sideEffect: "read_only",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const analysis = createDocumentAnalysis({ fileName, instruction, text: extractedText });
  const outputDraft = createFileOutputDraft({
    fileName,
    outputKind,
    instruction,
    text: extractedText,
    analysis,
  });
  const createdAt = new Date().toISOString();
  const itemId = workItemId || `local-file-output-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const workItem = {
    id: itemId,
    title: `${outputDraft.label}: ${fileName}`,
    source: "local_file",
    sourceLabel: "내 컴퓨터 문서",
    senderLabel: folderName || "로컬 파일",
    body: [
      `파일명: ${fileName}`,
      `폴더: ${folderName}`,
      `크기: ${formatFileSize(stats.size)}`,
      `수정: ${stats.mtime.toISOString()}`,
      `요청: ${instruction || outputDraft.label}`,
    ].join("\n"),
    summary: outputDraft.summary,
    status: "draft_ready",
    riskLabel: analysis.riskLabel,
    riskSignals: analysis.riskSignals,
    receivedAt: createdAt,
    draft: {
      id: `${itemId}:${outputKind}`,
      toneLabel: outputDraft.label,
      body: outputDraft.body,
      operationKind: "stage_approval",
      requiresApprovalBeforeSend: true,
    },
    localFile: createLocalFileMetadata(normalizedPath, {
      fileName,
      folderName,
      fileSize: formatFileSize(stats.size),
      modifiedAt: stats.mtime.toISOString(),
      extractedTextStatus: "ready",
      preview: compactText(extractedText, 280),
    }),
  };

  const inboxResult = deps.upsertInboxItem(workItem, { createdAt });

  return {
    status: "output_drafted",
    capability: "draft_from_local_file",
    userMessage: `${fileName} 문서로 ${outputDraft.label}을 만들었습니다. 실행 없이 초안만 갱신했습니다.`,
    sideEffect: "read_only",
    observedAt: createdAt,
    stagedWorkItem: workItem,
    outputDraft: {
      kind: outputKind,
      label: outputDraft.label,
      summary: outputDraft.summary,
      preview: compactText(outputDraft.body, 260),
    },
    inboxResult,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createBrowserActionPlan({ hostLabel, intent, targetUrl }) {
  const text = `${intent} ${targetUrl}`.toLowerCase();
  const actions = [
    {
      id: "read-current-screen",
      label: `${hostLabel} 현재 화면 읽기`,
      capability: "read_screen",
      riskLabel: "low",
      requiresFinalUserPresence: false,
      reason: "버튼, 입력칸, 경고 문구, 로그인 상태를 먼저 확인합니다.",
    },
  ];

  if (/검색|search|조회|찾|filter|필터/i.test(text)) {
    actions.push({
      id: "prepare-search-input",
      label: "검색어 입력 후보 준비",
      capability: "type_text",
      riskLabel: "medium",
      requiresFinalUserPresence: true,
      reason: "검색창 입력은 사이트 상태를 바꿀 수 있어 사용자가 화면에서 확인해야 합니다.",
    });
  }

  if (/답장|회신|문의|작성|등록|예약|보내|전송|submit|send|book|reserve/i.test(text)) {
    actions.push({
      id: "prepare-form-fill",
      label: "폼 입력/답장 후보 준비",
      capability: "type_text",
      riskLabel: "high",
      requiresFinalUserPresence: true,
      reason: "메시지나 예약/등록 양식 입력은 외부 상태 변경 전 단계이므로 최종 확인이 필요합니다.",
    });
  }

  actions.push({
    id: "prepare-next-click",
    label: "다음 버튼 클릭 후보 표시",
    capability: "click",
    riskLabel: "medium",
    requiresFinalUserPresence: true,
    reason: "클릭 대상과 결과를 사용자가 확인한 뒤 별도 승인 단계에서만 진행합니다.",
  });

  return actions.slice(0, 5);
}

function selectBrowserActionCandidate({ browserActionId, hostLabel, intent, targetUrl }) {
  const planned = createBrowserActionPlan({ hostLabel, intent, targetUrl });
  const selected = planned.find((action) => action.id === browserActionId) ?? planned[planned.length - 1];
  return {
    ...selected,
    requiresFinalUserPresence: selected.requiresFinalUserPresence !== false,
  };
}

function createBrowserDryRunPlan({ selectedAction, hostLabel, intent, targetUrl }) {
  const actionLabel = sanitizeInstruction(selectedAction?.label || "브라우저 행동 후보");
  const capability = String(selectedAction?.capability ?? "");
  const siteLabel = targetUrl ? hostLabel : "사용자가 확인한 사이트";
  const safeIntent = sanitizeInstruction(intent || actionLabel);
  const commonChecklist = [
    "현재 사이트와 로그인 계정이 맞는지 확인",
    "대상 버튼/입력칸이 화면에 실제로 보이는지 확인",
    "입력 문구에 개인정보, 토큰, 결제 정보가 섞이지 않았는지 확인",
    "발송, 결제, 삭제, 예약 확정 같은 외부 변경 여부 확인",
    "finalUserPresence=true: 사용자가 화면에서 대상과 문구를 최종 확인",
    "사용자 최종 확인 전 실행 차단",
  ];

  if (capability === "type_text") {
    return {
      intendedInput:
        safeIntent || "사용자가 카드에서 승인한 문구만 입력합니다. 비밀번호와 토큰은 입력하지 않습니다.",
      clickTarget: `${siteLabel}의 답장창, 검색창, 문의/예약 입력칸 중 사용자가 화면에서 지정한 필드`,
      expectedResult:
        "입력 후 화면에 초안이나 검색어가 표시됩니다. 발송, 저장, 예약 확정은 별도 최종 확인 전까지 실행하지 않습니다.",
      cancelPath: "취소하면 이 확인 카드를 보류/거절하고 원본 업무 카드로 돌아갑니다.",
      rollbackGuide:
        "아직 외부 입력을 실행하지 않았으므로 되돌릴 변경은 없습니다. 실행 후에는 사이트의 삭제/수정/초안 폐기 경로를 먼저 안내해야 합니다.",
      preflightChecklist: commonChecklist,
    };
  }

  if (capability === "click") {
    return {
      intendedInput: "입력 없음. 버튼이나 링크 클릭 후보만 확인합니다.",
      clickTarget: `${siteLabel}에서 사용자가 화면으로 확인한 '${actionLabel}' 대상 버튼/링크`,
      expectedResult:
        "다음 화면, 확인 모달, 또는 초안 단계로 이동할 수 있습니다. 즉시 발송/결제/삭제되는 버튼이면 실행하지 않습니다.",
      cancelPath: "취소하면 클릭 후보를 폐기하고 현재 화면 상태를 유지합니다.",
      rollbackGuide:
        "실행 전에는 되돌릴 변경이 없습니다. 클릭 후 이동만 발생하면 브라우저 뒤로가기, 확정 변경이면 서비스의 취소/수정 경로를 먼저 확인합니다.",
      preflightChecklist: commonChecklist,
    };
  }

  return {
    intendedInput: "입력 없음. 화면 읽기와 상태 확인만 합니다.",
    clickTarget: `${siteLabel} 현재 화면`,
    expectedResult: "버튼, 입력칸, 경고 문구, 로그인 상태를 읽기 전용으로 확인합니다.",
    cancelPath: "취소하면 읽기 후보를 폐기하고 업무 카드는 유지합니다.",
    rollbackGuide: "읽기 전용 단계라 외부 서비스나 로컬 파일에 되돌릴 변경이 없습니다.",
    preflightChecklist: [
      "현재 사이트와 로그인 계정이 맞는지 확인",
      "민감정보가 화면에 보이면 결과에 원문을 남기지 않기",
      "사용자 최종 확인이 필요한 후속 클릭/입력은 별도 카드로 분리",
    ],
  };
}

function createBrowserFinalPresenceContract({ selectedAction, dryRunPlan, hostLabel, targetUrl }) {
  const capability = sanitizeInstruction(selectedAction?.capability || "browser_automation");
  const actionLabel = sanitizeInstruction(selectedAction?.label || "브라우저 행동 후보");
  const targetElementDescription = sanitizeInstruction(dryRunPlan?.clickTarget || "사용자가 화면에서 확인한 대상");
  const screenEvidenceStatus = "not_captured";
  const readiness =
    capability === "read_screen" ? "read_only_review" : "screen_evidence_required";
  const checklist = [
    "현재 브라우저 화면의 URL과 로그인 계정을 사용자가 직접 확인",
    "대상 버튼/입력칸이 화면 캡처 또는 요소 설명과 일치하는지 확인",
    "입력될 내용과 예상 결과가 카드의 실행 전 미리보기와 일치하는지 확인",
    "즉시 발송/결제/삭제/예약 확정 버튼이면 실행하지 않고 보류",
    "사용자가 '화면 대상 확인' 문구를 직접 확인하기 전 클릭/입력 차단",
  ];

  return {
    finalUserPresence: true,
    readiness,
    host: hostLabel,
    targetUrl,
    actionLabel,
    capability,
    targetElementDescription,
    screenEvidenceRequired: capability !== "read_screen",
    screenEvidenceStatus,
    userConfirmationPhrase: "화면 대상 확인",
    blockedReason:
      capability === "read_screen"
        ? "읽기 전용 후보입니다. 후속 클릭/입력은 별도 현장 확인 카드로 분리해야 합니다."
        : "화면 캡처, 대상 요소 설명, 사용자 현장 확인이 붙기 전까지 실제 클릭/입력을 차단합니다.",
    allowedNextStep:
      capability === "read_screen"
        ? "화면 상태를 읽고 필요한 후속 클릭/입력 후보를 다시 카드로 만듭니다."
        : "브라우저 화면 캡처와 대상 요소 매칭 결과를 카드에 붙인 뒤 사용자가 최종 확인합니다.",
    manualVerificationChecklist: checklist,
  };
}

function createBrowserScreenEvidenceRecord(value, { createdAt, contract, instruction } = {}) {
  const targetElementDescription = sanitizeInstruction(
    instruction || value?.targetElementDescription || contract?.targetElementDescription || "사용자가 화면에서 확인한 대상",
  );
  const sourceLabel =
    sanitizeWindowText(value?.sourceLabel || value?.sourceName || "현재 화면 소스").slice(0, 160) || "현재 화면 소스";
  const sourceKind = ["window", "screen", "unknown"].includes(String(value?.sourceKind ?? ""))
    ? String(value.sourceKind)
    : "unknown";
  const sourceCount = Number.isFinite(Number(value?.sourceCount))
    ? Math.max(0, Math.min(99, Math.round(Number(value.sourceCount))))
    : 0;
  const matchReason =
    sanitizeWindowText(value?.matchReason || "대상 사이트/업무 설명과 가장 가까운 화면 소스를 확인").slice(0, 240) ||
    "대상 사이트/업무 설명과 가장 가까운 화면 소스를 확인";

  return {
    capturedAt: sanitizeWindowText(value?.capturedAt || createdAt || new Date().toISOString()).slice(0, 40),
    mode: "desktop_capturer_metadata",
    sourceKind,
    sourceLabel,
    sourceCount,
    matchReason,
    targetElementDescription,
    evidenceSummary: `${sourceLabel} 화면 소스를 read-only로 확인했습니다. ${matchReason}`,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createBrowserTargetElementMatch({ createdAt, contract, dryRunPlan, instruction } = {}) {
  const targetLabel = sanitizeInstruction(
    instruction || contract?.targetElementDescription || dryRunPlan?.clickTarget || "사용자가 화면에서 확인한 대상",
  );
  const evidenceSourceLabel =
    sanitizeWindowText(contract?.screenEvidence?.sourceLabel || "현재 화면 소스").slice(0, 160) || "현재 화면 소스";
  const method = "screen_evidence_metadata_and_dry_run_contract";
  const confidence = inferTargetElementMatchConfidence({ contract, dryRunPlan, targetLabel });
  const safetyNotes = [
    "화면 소스 메타데이터와 미리보기 대상 설명만 비교했습니다.",
    "DOM selector, 좌표, 픽셀 원문은 저장하지 않았습니다.",
    "사용자가 화면에서 대상 버튼/입력칸을 직접 확인해야 실제 실행 단계로 넘어갑니다.",
  ];

  return {
    matchedAt: sanitizeWindowText(createdAt || new Date().toISOString()).slice(0, 40),
    status: "matched",
    confidence,
    targetLabel,
    evidenceSourceLabel,
    matchingMethod: method,
    safetyNotes,
    rawCoordinatesStored: false,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function inferTargetElementMatchConfidence({ contract, dryRunPlan, targetLabel } = {}) {
  const haystack = sanitizeWindowText(
    [
      contract?.screenEvidence?.targetElementDescription,
      contract?.targetElementDescription,
      dryRunPlan?.clickTarget,
    ]
      .filter(Boolean)
      .join(" "),
  ).toLowerCase();
  const target = sanitizeWindowText(targetLabel).toLowerCase();
  if (target && haystack.includes(target)) return "high";
  if (target && target.split(/[^a-z0-9가-힣]+/u).some((token) => token.length >= 2 && haystack.includes(token))) {
    return "medium";
  }
  return "low";
}

function createBrowserLimitedExecutionGate({ createdAt, contract, dryRunPlan, instruction } = {}) {
  const actionCapability = sanitizeInstruction(contract?.capability || "browser_automation");
  const targetLabel = sanitizeInstruction(
    contract?.targetElementMatch?.targetLabel || contract?.targetElementDescription || "사용자가 화면에서 확인한 대상",
  );
  const auditId = `browser-exec-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const checklist = [
    "화면 증거가 captured 상태인지 확인",
    "대상 요소 매칭 상태가 matched인지 확인",
    "입력될 내용과 예상 결과가 실행 전 미리보기와 일치하는지 확인",
    "발송, 결제, 삭제, 예약 확정 버튼이면 실제 실행하지 않고 보류",
    "사용자가 '화면 대상 실행 확인' 문구를 직접 확인하기 전 실행 차단",
  ];

  return {
    preparedAt: sanitizeWindowText(createdAt || new Date().toISOString()).slice(0, 40),
    status: "prepared",
    auditId,
    actionCapability,
    actionLabel: sanitizeInstruction(contract?.actionLabel || "브라우저 행동 후보"),
    targetLabel,
    intendedInput: sanitizeInstruction(dryRunPlan?.intendedInput || instruction || "입력 없음"),
    expectedResult: sanitizeInstruction(dryRunPlan?.expectedResult || "실행 전 예상 결과 확인 필요"),
    confirmationPhrase: "화면 대상 실행 확인",
    requiresFinalUserPresence: true,
    liveExecutionEnabled: false,
    dryRunOnly: true,
    rollbackGuide: sanitizeInstruction(dryRunPlan?.rollbackGuide || "실행 전에는 되돌릴 외부 변경이 없습니다."),
    safetyChecklist: checklist,
    blockedCapabilities: ["click", "type_text", "send_hotkey", "browser_automation"],
    rawCoordinatesStored: false,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function persistBrowserLimitedExecutionAudit({ gate, workItem, contract }) {
  const folder = resolveBrowserLimitedExecutionAuditDir();
  mkdirSync(folder, { recursive: true });
  const auditFile = path.join(folder, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  const auditRecord = {
    kind: "browser_limited_execution_gate",
    recordedAt: new Date().toISOString(),
    auditId: gate.auditId,
    workItemId: sanitizeWorkItemId(workItem?.id),
    host: sanitizeWindowText(contract?.host).slice(0, 120),
    targetUrl: redactSensitiveUrl(contract?.targetUrl || ""),
    actionCapability: gate.actionCapability,
    actionLabel: gate.actionLabel,
    targetLabel: gate.targetLabel,
    readiness: "limited_execution_ready",
    liveExecutionEnabled: false,
    dryRunOnly: true,
    externalMutation: false,
    rawCoordinatesStored: false,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  writeFileSync(auditFile, `${JSON.stringify(auditRecord)}\n`, { encoding: "utf8", flag: "a" });
  return {
    auditFile,
    auditRecord,
  };
}

function persistDesktopWorkItemStageAudit({
  kind,
  capability,
  workItem,
  targetLabel,
  instruction,
  rollbackGuide,
  scopeKind = "",
  folderScopePolicy = "selected_file_or_folder_only_no_recursive_mutation",
}) {
  const folder = resolveDesktopWorkItemStageAuditDir();
  mkdirSync(folder, { recursive: true });
  const auditFile = path.join(folder, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  const auditRecord = {
    kind: sanitizeWindowText(kind).slice(0, 80),
    recordedAt: new Date().toISOString(),
    auditId: `desktop-stage-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    capability: sanitizeCapability(capability),
    workItemId: sanitizeWorkItemId(workItem?.id),
    workTitle: sanitizeWindowText(workItem?.title).slice(0, 160),
    source: sanitizeWindowText(workItem?.source).slice(0, 80),
    targetLabel: sanitizeInstruction(targetLabel).slice(0, 160),
    instruction: sanitizeInstruction(instruction).slice(0, 500),
    scopeKind: sanitizeInstruction(scopeKind || workItem?.localFile?.scopeKind || workItem?.source || "selected_scope").slice(0, 80),
    scopeFlow: "choose_scope_read_preview_approve_log",
    folderScopePolicy,
    previewBeforeApproval: "required",
    executionLogBoundary: "office_receipt_or_audit_file",
    rollbackGuideRequired: true,
    approvalStatus: "approval_pending",
    executionBoundary: "approval_queue_only",
    rollbackGuide: sanitizeInstruction(rollbackGuide).slice(0, 300),
    externalMutation: false,
    rawPathStored: false,
    rawUrlQueryStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  writeFileSync(auditFile, `${JSON.stringify(auditRecord)}\n`, { encoding: "utf8", flag: "a" });
  return {
    auditFile,
    auditRecord,
  };
}

function persistBrowserLimitedExecutionConfirmationAudit({ gate, workItem, contract, confirmedAt }) {
  const folder = resolveBrowserLimitedExecutionAuditDir();
  mkdirSync(folder, { recursive: true });
  const auditFile = path.join(folder, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  const auditRecord = {
    kind: "browser_limited_execution_user_confirmation",
    recordedAt: new Date().toISOString(),
    confirmedAt,
    auditId: gate.auditId,
    workItemId: sanitizeWorkItemId(workItem?.id),
    host: sanitizeWindowText(contract?.host).slice(0, 120),
    targetUrl: redactSensitiveUrl(contract?.targetUrl || ""),
    actionCapability: sanitizeInstruction(gate.actionCapability),
    actionLabel: sanitizeInstruction(gate.actionLabel),
    targetLabel: sanitizeInstruction(gate.targetLabel),
    confirmationPhrase: sanitizeInstruction(gate.confirmationPhrase || "화면 대상 실행 확인"),
    adapterReadiness: "adapter_not_connected",
    executionStatus: "adapter_locked",
    liveExecutionEnabled: false,
    dryRunOnly: true,
    externalMutation: false,
    rawCoordinatesStored: false,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  writeFileSync(auditFile, `${JSON.stringify(auditRecord)}\n`, { encoding: "utf8", flag: "a" });
  return {
    auditFile,
    auditRecord,
  };
}

function persistBrowserLimitedExecutionAttemptAudit({
  gate,
  workItem,
  contract,
  attemptedAt,
  instruction,
  adapterReadiness = "adapter_not_connected",
  executionStatus = "adapter_locked",
  kind = "browser_limited_execution_attempt_blocked",
}) {
  const folder = resolveBrowserLimitedExecutionAuditDir();
  mkdirSync(folder, { recursive: true });
  const auditFile = path.join(folder, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  const auditRecord = {
    kind,
    recordedAt: new Date().toISOString(),
    attemptedAt,
    auditId: gate.auditId,
    workItemId: sanitizeWorkItemId(workItem?.id),
    host: sanitizeWindowText(contract?.host).slice(0, 120),
    targetUrl: redactSensitiveUrl(contract?.targetUrl || ""),
    actionCapability: sanitizeInstruction(gate.actionCapability),
    actionLabel: sanitizeInstruction(gate.actionLabel),
    targetLabel: sanitizeInstruction(gate.targetLabel),
    requestedInstruction: sanitizeInstruction(instruction || gate.actionLabel),
    adapterReadiness,
    executionStatus,
    blockedReason:
      adapterReadiness === "ready"
        ? ""
        : "브라우저 실행 연결이 없어 실제 클릭/입력을 차단했습니다.",
    liveExecutionEnabled: adapterReadiness === "ready",
    dryRunOnly: adapterReadiness !== "ready",
    externalMutation: false,
    rawCoordinatesStored: false,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  writeFileSync(auditFile, `${JSON.stringify(auditRecord)}\n`, { encoding: "utf8", flag: "a" });
  return {
    auditFile,
    auditRecord,
  };
}

function persistBrowserLimitedExecutionResultAudit({ gate, workItem, contract, attemptedAt, executedAt, adapterResult }) {
  const folder = resolveBrowserLimitedExecutionAuditDir();
  mkdirSync(folder, { recursive: true });
  const auditFile = path.join(folder, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  const auditRecord = {
    kind:
      adapterResult.status === "executed"
        ? "browser_limited_execution_result_executed"
        : "browser_limited_execution_result_blocked",
    recordedAt: new Date().toISOString(),
    attemptedAt,
    executedAt,
    auditId: gate.auditId,
    adapterRunId: adapterResult.adapterRunId,
    workItemId: sanitizeWorkItemId(workItem?.id),
    host: sanitizeWindowText(contract?.host).slice(0, 120),
    targetUrl: redactSensitiveUrl(contract?.targetUrl || ""),
    actionCapability: sanitizeInstruction(gate.actionCapability),
    actionLabel: sanitizeInstruction(gate.actionLabel),
    targetLabel: sanitizeInstruction(gate.targetLabel),
    adapterStatus: adapterResult.status,
    adapterResultSummary: adapterResult.summary,
    adapterUserMessage: adapterResult.userMessage,
    externalMutation: adapterResult.externalMutation === true,
    rawCoordinatesStored: false,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  writeFileSync(auditFile, `${JSON.stringify(auditRecord)}\n`, { encoding: "utf8", flag: "a" });
  return {
    auditFile,
    auditRecord,
  };
}

function normalizeBrowserLimitedExecutionAdapterResult(value, executedAt) {
  const status = value?.status === "executed" || value?.status === "completed" ? "executed" : "blocked";
  const adapterRunId = sanitizeInstruction(value?.adapterRunId || `browser-adapter-${Date.now().toString(36)}`);
  const summary = sanitizeInstruction(
    value?.summary ||
      (status === "executed"
        ? "제한 실행 연결이 작업을 완료했습니다."
        : "제한 실행 연결이 작업을 차단했습니다."),
  ).slice(0, 500);
  const userMessage = sanitizeInstruction(
    value?.userMessage ||
      (status === "executed"
        ? "제한 실행 연결이 작업을 완료했습니다. 실행 후 화면을 확인해 주세요."
        : "제한 실행 연결이 작업을 완료하지 못해 차단했습니다."),
  ).slice(0, 500);

  return {
    status,
    adapterRunId,
    executedAt,
    summary,
    userMessage,
    externalMutation: value?.externalMutation === true,
    sideEffect:
      value?.sideEffect === "clipboard_write" || value?.sideEffect === "external_open"
        ? value.sideEffect
        : status === "executed"
          ? "external_open"
          : "read_only",
    rawCoordinatesStored: false,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createBrowserPostExecutionEvidence({ evidence, gate, verifiedAt, instruction } = {}) {
  const sourceKind = ["window", "screen", "unknown"].includes(String(evidence?.sourceKind ?? ""))
    ? String(evidence.sourceKind)
    : "unknown";
  const sourceLabel = sanitizeInstruction(evidence?.sourceLabel || "결과 화면 소스");
  const matchReason = sanitizeInstruction(
    evidence?.matchReason || "실행 후 결과 화면을 read-only 메타데이터로 확인했습니다.",
  );

  return {
    verifiedAt: sanitizeWindowText(verifiedAt || new Date().toISOString()).slice(0, 40),
    sourceKind,
    sourceLabel: sourceLabel.slice(0, 160) || "결과 화면 소스",
    sourceCount: Number.isFinite(Number(evidence?.sourceCount))
      ? Math.max(0, Math.min(99, Math.round(Number(evidence.sourceCount))))
      : 0,
    matchReason,
    targetLabel: sanitizeInstruction(gate?.targetLabel || "사용자가 화면에서 확인한 대상"),
    expectedResult: sanitizeInstruction(gate?.expectedResult || instruction || "실행 후 예상 결과 확인"),
    verificationSummary: sanitizeInstruction(
      evidence?.status === "screen_evidence_captured"
        ? "실행 후 화면 소스를 확인했습니다. raw pixels와 좌표는 저장하지 않았습니다."
        : "실행 후 화면 소스를 자동 확인하지 못해 사용자 검토가 필요합니다.",
    ),
    rawCoordinatesStored: false,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function persistBrowserLimitedExecutionVerificationAudit({
  gate,
  workItem,
  contract,
  postExecutionEvidence,
  verifiedAt,
  verificationStatus,
}) {
  const folder = resolveBrowserLimitedExecutionAuditDir();
  mkdirSync(folder, { recursive: true });
  const auditFile = path.join(folder, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  const auditRecord = {
    kind:
      verificationStatus === "verified"
        ? "browser_limited_execution_post_result_verified"
        : "browser_limited_execution_post_result_needs_review",
    recordedAt: new Date().toISOString(),
    verifiedAt,
    auditId: gate.auditId,
    workItemId: sanitizeWorkItemId(workItem?.id),
    host: sanitizeWindowText(contract?.host).slice(0, 120),
    targetUrl: redactSensitiveUrl(contract?.targetUrl || ""),
    actionCapability: sanitizeInstruction(gate.actionCapability),
    actionLabel: sanitizeInstruction(gate.actionLabel),
    targetLabel: sanitizeInstruction(gate.targetLabel),
    verificationStatus,
    sourceKind: postExecutionEvidence.sourceKind,
    sourceLabel: postExecutionEvidence.sourceLabel,
    matchReason: postExecutionEvidence.matchReason,
    externalMutation: false,
    rawCoordinatesStored: false,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  writeFileSync(auditFile, `${JSON.stringify(auditRecord)}\n`, { encoding: "utf8", flag: "a" });
  return {
    auditFile,
    auditRecord,
  };
}

function resolveBrowserLimitedExecutionAuditDir() {
  const baseDir =
    process.env.MODYCREW_OUTPUT_DIR ||
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    os.tmpdir();
  return path.join(baseDir, "ModyCrew", "local-live-workflow", "browser-limited-execution-audits");
}

function resolveDesktopWorkItemStageAuditDir() {
  const baseDir =
    process.env.MODYCREW_OUTPUT_DIR ||
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    os.tmpdir();
  return path.join(baseDir, "ModyCrew", "local-live-workflow", "desktop-work-item-stage-audits");
}

async function chooseLocalFileForOpen({ deps, instruction }) {
  if (!deps?.dialog?.showOpenDialog) {
    return {
      status: "capability_missing",
      capability: "choose_local_file",
      userMessage: "파일 선택은 설치된 데스크톱 앱에서만 사용할 수 있습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const result = await deps.dialog.showOpenDialog({
    title: "ModyCrew에서 열 파일 선택",
    properties: ["openFile"],
    filters: [
      { name: "업무 문서", extensions: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "hwp", "hwpx", "txt", "csv"] },
      { name: "모든 파일", extensions: ["*"] },
    ],
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return {
      status: "confirmation_rejected",
      capability: "choose_local_file",
      userMessage: "파일 선택이 취소되었습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const normalizedPath = normalizeAllowedLocalPath(result.filePaths[0]);
  if (!normalizedPath) {
    return createInvalidTargetResult(
      "choose_local_file",
      "선택한 파일을 열 수 없습니다. 사용자 폴더, 임시 폴더, 현재 작업 폴더 안의 파일만 허용합니다.",
    );
  }

  return createConfirmationResult({
    capability: "open_local_file",
    target: normalizedPath,
    instruction,
    label: "선택한 파일 열기",
  });
}

export async function confirmDesktopControlAction(payload = {}, deps = {}) {
  const confirmationId = sanitizeConfirmationId(payload.confirmationId);
  const pending = pendingConfirmations.get(confirmationId);
  pendingConfirmations.delete(confirmationId);

  if (!pending || pending.expiresAtMs < Date.now()) {
    return {
      status: "confirmation_expired",
      capability: "open_url",
      userMessage: "확인 요청이 만료되었습니다. 다시 요청해 주세요.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (payload.approved !== true) {
    return {
      status: "confirmation_rejected",
      capability: pending.capability,
      userMessage: "사용자가 열기 요청을 취소했습니다.",
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (payload.dryRun === true) {
    return createOpenedResult(pending, "dry_run");
  }

  const openResult =
    pending.capability === "open_url"
      ? typeof deps.openWorkBrowserTarget === 'function'
        ? await deps.openWorkBrowserTarget(pending.target)
        : await openExternalTarget(pending.target)
      : await openLocalTarget(pending.target);

  if (!openResult.ok) {
    return {
      status: "blocked",
      capability: pending.capability,
      userMessage: openResult.userMessage,
      sideEffect: "none",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const result = createOpenedResult(pending, "external_open");
  return pending.capability === 'open_url' && typeof deps.openWorkBrowserTarget === 'function'
    ? { ...result, userMessage: '앱 내 업무 브라우저에서 주소를 열었습니다.' }
    : result;
}

function sanitizeKind(value) {
  return value === "status" || value === "request" || value === "confirm" ? value : "unknown";
}

/**
 * PC 앱 조작 요청 → desktop-app-control. 화면에서 온 값은 크기·형식만 거르고, 계획 검사·승인·실행·기록 판단은
 * 실행기가 한다. 실행이 실제로 앱을 바꿨을 수 있으면 externalMutation=true 로 정직하게 알린다.
 * 저장 위치는 메인이 가진 설정(기억 폴더)으로 정한다. 화면이 보낸 저장 위치가 그것과 다르면 처리하지 않는다
 * (다른 회사 기록 조회·실행 방지). 화면 읽기 허용·실행 승인은 실행기의 네이티브 확인 창에서만 생긴다.
 */
async function handleAppControlRequest({ capability, appAction, event, deps }) {
  const base = { capability, rawSecretMaterialStored: false, rawSecretMaterialReturned: false };
  const input = appAction && typeof appAction === "object" && !Array.isArray(appAction) ? appAction : {};
  let size = 0;
  try { size = JSON.stringify(input).length; } catch { size = Infinity; }
  if (size > 40_000) {
    return { ...base, status: "invalid_plan", sideEffect: "none", externalMutation: false, userMessage: "PC 작업 요청이 너무 깁니다. 단계를 나눠 다시 요청해 주세요." };
  }
  const text = (value, max) => String(value ?? "").trim().slice(0, max);
  const claimedRoot = text(input.workspaceRoot, 1000);
  let trustedRoot = "";
  try { trustedRoot = String((await (typeof deps?.currentWorkspaceRoot === "function" ? deps.currentWorkspaceRoot() : defaultCurrentWorkspaceRoot())) ?? "").trim(); } catch { trustedRoot = ""; }
  if (trustedRoot && claimedRoot && !sameWorkspaceRoot(trustedRoot, claimedRoot)) {
    return { ...base, status: "workspace_mismatch", sideEffect: "none", externalMutation: false, userMessage: "지금 앱의 저장 위치와 다른 요청이라 PC 작업을 처리하지 않았습니다. 화면을 새로 고친 뒤 다시 요청해 주세요." };
  }
  if (!trustedRoot && process.versions?.electron) {
    return { ...base, status: "failed", sideEffect: "none", externalMutation: false, userMessage: "지금 앱의 저장 위치를 확인하지 못해 PC 작업을 처리하지 않았습니다. 설정의 저장 위치를 확인해 주세요." };
  }
  const ctx = {
    workspaceRoot: trustedRoot || claimedRoot,
    teammateId: text(input.teammateId, 120),
    teammateName: text(input.teammateName, 60),
    threadId: text(input.threadId, 240),
    event,
  };
  const actionId = text(input.actionId, 64);
  try {
    const control = getDesktopAppControl({ ...deps, currentWorkspaceRoot: typeof deps?.currentWorkspaceRoot === "function" ? deps.currentWorkspaceRoot : defaultCurrentWorkspaceRoot });
    if (capability === "inspect_app_elements") return { ...base, sideEffect: "read_only", externalMutation: false, ...(await control.inspect(input, ctx)) };
    if (capability === "app_action_status") return { ...base, sideEffect: "read_only", externalMutation: false, ...(await control.status(actionId, ctx)) };
    if (capability === "open_app_action_result") return { ...base, sideEffect: "read_only", externalMutation: false, ...(await control.openResult(actionId, ctx)) };
    const result = capability === "request_app_action"
      ? await control.request(input, ctx)
      : capability === "run_app_action"
        ? await control.runAgain(actionId, ctx)
        : await control.cancel(actionId, ctx);
    const touched = (result?.action?.stepResults ?? []).some((step) => step.outcome !== "not_delivered");
    // 업무 상태(사무실 화면·하루 보고)는 실행기가 기록을 만들 때부터 메인 업무 이벤트 'pc-action-<id>' 에 직접 남긴다.
    return { ...base, sideEffect: touched ? "desktop_app_action" : "none", externalMutation: touched, ...result };
  } catch (error) {
    return { ...base, status: "failed", sideEffect: "none", externalMutation: false, userMessage: "PC 작업을 처리하지 못했습니다: " + String(error?.message ?? error).slice(0, 200) };
  }
}

async function loadDomainRuntime(options = {}) {
  if (!domainRuntimePromise) {
    // 설치본에서 도메인 런타임은 resources/domain 에 있다. cwd 기준 개발 경로만 조립하면
    // 패키지 앱에서 Cannot find module 로 죽는다(공용 헬퍼로 통일).
    const domainEntryPath =
      options.domainEntryPath ?? resolveDesktopDomainEntryPath({ repoRoot: options.repoRoot });
    domainRuntimePromise = import(pathToFileURL(domainEntryPath).href).catch((error) => {
      domainRuntimePromise = undefined;
      throw error;
    });
  }
  return domainRuntimePromise;
}

function sanitizeCapability(value) {
  const text = String(value ?? "").trim();
  if (appControlCapabilityIds.has(text)) return text;
  return allCapabilities.some((capability) => capability.id === text) ? text : "list_windows";
}

function sanitizeConfirmationId(value) {
  return String(value ?? "")
    .replace(/[^a-z0-9-]/gi, "")
    .slice(0, 80);
}

function sanitizeWorkItemId(value) {
  return String(value ?? "")
    .replace(/[^a-z0-9:_-]/gi, "")
    .slice(0, 140);
}

function sanitizeBrowserActionId(value) {
  return String(value ?? "")
    .replace(/[^a-z0-9:_-]/gi, "")
    .slice(0, 100);
}

function sanitizeOutputKind(value) {
  const text = String(value ?? "").trim();
  return ["report", "reply", "table"].includes(text) ? text : "report";
}

function sanitizeTarget(value) {
  return redactSensitiveUrlsInText(String(value ?? ""))
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{8,}\b/g, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function sanitizeInstruction(value) {
  return sanitizeTarget(value).slice(0, 240);
}

function sanitizeReferenceLikeId(value) {
  const text = String(value ?? "").trim();
  if (/^[a-z0-9._:/-]{3,180}$/iu.test(text)) return text;
  return "";
}

function normalizeWebmailTwoFactorMode(value) {
  const text = String(value ?? "").trim();
  return [
    "disabled_by_user",
    "manual_once_then_session",
    "enabled_needs_user_presence",
    "unknown",
  ].includes(text)
    ? text
    : "unknown";
}

function normalizeWebmailCadenceMinutes(value) {
  const minutes = Number(value);
  return Number.isFinite(minutes) ? minutes : 5;
}

function normalizeWebmailMetadataMessages(messages, fallbackReceivedAt) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(0, 50).map((message, index) => ({
    messageId: sanitizeWebmailMessageId(message?.messageId || message?.id || `row-${index + 1}`),
    senderPreview: sanitizeInstruction(message?.senderPreview || message?.from || "보낸 사람 확인"),
    subject: sanitizeTarget(message?.subject || "(제목 없음)").slice(0, 220) || "(제목 없음)",
    receivedAt: normalizeIsoString(message?.receivedAt, fallbackReceivedAt),
    threadId: message?.threadId ? sanitizeWebmailMessageId(message.threadId) : undefined,
    labels: Array.isArray(message?.labels) ? message.labels.map((label) => sanitizeInstruction(label)).filter(Boolean) : [],
    hasAttachments: message?.hasAttachments === true,
    metadataSnippet: sanitizeTarget(message?.metadataSnippet || message?.snippet || "").slice(0, 420),
  }));
}

function normalizeWebmailDomRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 100).map((row) => ({
    rowId: sanitizeWebmailMessageId(row?.rowId || row?.id || ""),
    role: sanitizeInstruction(row?.role || ""),
    ariaLabel: sanitizeTarget(row?.ariaLabel || "").slice(0, 500),
    textContent: sanitizeTarget(row?.textContent || row?.text || "").slice(0, 800),
    cells: Array.isArray(row?.cells)
      ? row.cells.map((cell) => sanitizeTarget(cell).slice(0, 240)).filter(Boolean).slice(0, 12)
      : [],
    hrefs: Array.isArray(row?.hrefs)
      ? row.hrefs.map((href) => redactSensitiveUrl(String(href ?? ""))).filter(Boolean).slice(0, 4)
      : [],
    timeText: sanitizeInstruction(row?.timeText || ""),
    labels: Array.isArray(row?.labels) ? row.labels.map((label) => sanitizeInstruction(label)).filter(Boolean).slice(0, 8) : [],
    hasAttachmentIcon: row?.hasAttachmentIcon === true,
    unread: row?.unread === true,
  }));
}

function sanitizeWebmailDomExtractionForUi(extraction) {
  if (!extraction) return null;
  return {
    status: extraction.status,
    extractionContract: extraction.extractionContract,
    bodyPreviewPolicy: extraction.bodyPreviewPolicy,
    rowCount: extraction.rowCount,
    extractedCount: extraction.extractedCount,
    skippedCount: extraction.skippedCount,
    bodyPreviewAllowedCount: extraction.bodyPreviewAllowedCount,
    bodyPreviewSkippedBeforeBodyCount: extraction.bodyPreviewSkippedBeforeBodyCount,
    bodyPreviewMaxChars: extraction.bodyPreviewMaxChars,
    readOnly: true,
    externalMutation: false,
    rawPageHtmlStored: false,
    rawBodyStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeWebmailDomCaptureForUi(capture) {
  if (!capture) return null;
  return {
    status: sanitizeInstruction(capture.status || "webmail_dom_rows_unavailable"),
    capturedAt: sanitizeInstruction(capture.capturedAt || ""),
    sourceKind: sanitizeInstruction(capture.sourceKind || "unknown"),
    sourceLabel: sanitizeInstruction(capture.sourceLabel || "웹메일 화면 확인 필요"),
    rowCount: Number.isFinite(Number(capture.rowCount)) ? Math.max(0, Math.min(100, Math.round(Number(capture.rowCount)))) : 0,
    matchReason: sanitizeInstruction(capture.matchReason || ""),
    readOnly: true,
    externalMutation: false,
    rawPageHtmlStored: false,
    rawBodyStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeWebmailDomCaptureProfileForUi(profile) {
  if (!profile) return null;
  return {
    profileId: sanitizeInstruction(profile.profileId || "webmail-capture:generic_groupware"),
    hostKind: sanitizeInstruction(profile.hostKind || "generic_groupware"),
    providerLabel: sanitizeInstruction(profile.providerLabel || "회사/일반 웹메일"),
    mailboxLabel: sanitizeInstruction(profile.mailboxLabel || "받은메일함"),
    semanticRowTargets: Array.isArray(profile.semanticRowTargets)
      ? profile.semanticRowTargets.map((item) => sanitizeInstruction(item)).filter(Boolean).slice(0, 6)
      : [],
    requiredVisibleSignals: Array.isArray(profile.requiredVisibleSignals)
      ? profile.requiredVisibleSignals.map((item) => sanitizeInstruction(item)).filter(Boolean).slice(0, 6)
      : [],
    blockedStateHints: Array.isArray(profile.blockedStateHints)
      ? profile.blockedStateHints.map((item) => sanitizeInstruction(item)).filter(Boolean).slice(0, 6)
      : [],
    nextUserAction: sanitizeInstruction(profile.nextUserAction || "받은메일함 목록 화면을 열고 다시 점검합니다."),
    maxRows: Number.isFinite(Number(profile.maxRows)) ? Math.max(1, Math.min(100, Math.round(Number(profile.maxRows)))) : 50,
    readOnly: true,
    externalMutation: false,
    rawSelectorStored: false,
    rawPageHtmlStored: false,
    rawBodyStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeWebmailDomRecoveryGuideForUi(guide) {
  if (!guide) return null;
  return {
    status: sanitizeInstruction(guide.status || "needs_mailbox_list_view"),
    reasonLabel: sanitizeInstruction(guide.reasonLabel || "받은메일함 목록 화면 확인 필요"),
    nextUserAction: sanitizeInstruction(guide.nextUserAction || "받은메일함 목록 화면을 열고 다시 점검합니다."),
    checklist: Array.isArray(guide.checklist)
      ? guide.checklist.map((item) => sanitizeInstruction(item)).filter(Boolean).slice(0, 5)
      : [],
    readOnly: true,
    externalMutation: false,
    rawSelectorStored: false,
    rawPageHtmlStored: false,
    rawBodyStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function isBlockingWebmailDomRecoveryGuide(guide) {
  if (!guide?.status) return false;
  return [
    "needs_login_or_two_factor",
    "needs_mailbox_list_view",
    "unsafe_snapshot_rejected",
    "capture_unavailable",
  ].includes(String(guide.status));
}

function sanitizeWebmailMessageId(value) {
  return String(value ?? "")
    .replace(/[^a-z0-9:_-]/gi, "-")
    .replace(/-+/g, "-")
    .slice(0, 120) || `row-${Date.now().toString(36)}`;
}

function normalizeIsoString(value, fallback) {
  const text = String(value ?? "").trim();
  const date = text ? new Date(text) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function normalizeWebmailWritingProfile(value = {}) {
  return {
    toneLabel: sanitizeInstruction(value.toneLabel || "정중하고 짧은 업무 담당자 말투"),
    formatLabel: sanitizeInstruction(value.formatLabel || "메일 답장과 일정 후보"),
    calendarPreference: sanitizeInstruction(value.calendarPreference || "기존 캘린더 일정과 충돌하지 않는 시간 우선"),
    ...(value.signature ? { signature: sanitizeInstruction(value.signature) } : {}),
  };
}

function sanitizeWebmailPlanForUi(plan) {
  return {
    status: plan.status,
    connectorId: plan.connectorId,
    providerLabel: plan.providerLabel,
    loginUrl: redactSensitiveUrl(plan.loginUrl),
    mailboxLabel: plan.mailboxLabel,
    cadenceMinutes: plan.cadenceMinutes,
    nextUserAction: plan.nextUserAction,
    canRunWithoutUserPresence: plan.canRunWithoutUserPresence,
    credentialReferenceCount: Object.values(plan.credentialReferences ?? {}).filter(Boolean).length,
    browserAutomationContract: plan.browserAutomationContract,
    secureIntakeContract: plan.secureIntakeContract,
    readOnly: true,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    appMayPersistSecret: false,
    aiMayReadSecret: false,
  };
}

function sanitizeDesktopControlMailReport(report) {
  return redactSensitiveMailText(report);
}

function redactSensitiveMailText(value) {
  if (typeof value === "string") {
    return sanitizeTarget(value).slice(0, 1000);
  }
  if (Array.isArray(value)) return value.map(redactSensitiveMailText);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSensitiveMailText(item)]));
  }
  return value;
}

function cleanWebmailErrorMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  return sanitizeInstruction(message || fallback) || fallback;
}

function redactSensitiveUrlsInText(value) {
  return String(value ?? "").replace(/\bhttps?:\/\/[^\s"'<>]+/giu, (urlText) => {
    const redacted = redactSensitiveUrl(urlText);
    return redacted || "[redacted-url]";
  });
}

function createInvalidTargetResult(capability, userMessage) {
  return {
    status: "target_invalid",
    capability,
    userMessage,
    sideEffect: "none",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createConfirmationResult({ capability, target, instruction, label }) {
  cleanupExpiredConfirmations();
  const confirmationId = randomUUID();
  const expiresAtMs = Date.now() + confirmationTtlMs;
  const pending = {
    confirmationId,
    capability,
    target,
    instruction,
    label,
    expiresAtMs,
  };
  pendingConfirmations.set(confirmationId, pending);

  return {
    status: "needs_user_confirmation",
    capability,
    userMessage: `${label} 전 사용자 확인이 필요합니다.`,
    sideEffect: "none",
    confirmation: {
      confirmationId,
      capability,
      target,
      label,
      expiresAt: new Date(expiresAtMs).toISOString(),
      safetyBoundary: "확인 전에는 브라우저나 파일 앱을 열지 않습니다.",
    },
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createOpenedResult(pending, sideEffect) {
  return {
    status: "confirmed_opened",
    capability: pending.capability,
    userMessage:
      sideEffect === "dry_run"
        ? `${pending.label} 확인 흐름을 검증했습니다. 실제 앱은 열지 않았습니다.`
        : `${pending.label} 요청을 실행했습니다.`,
    sideEffect,
    openedTarget: pending.target,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function cleanupExpiredConfirmations() {
  const now = Date.now();
  for (const [id, pending] of pendingConfirmations.entries()) {
    if (pending.expiresAtMs < now) pendingConfirmations.delete(id);
  }
}

function normalizeAllowedUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    if (!url.hostname || url.href.length > 500) return null;
    return url.href;
  } catch {
    return null;
  }
}

function redactSensitiveUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|key|password|passwd|auth|code|session/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.href.slice(0, 500);
  } catch {
    return "";
  }
}

function safeHostname(value) {
  try {
    return new URL(value).hostname.slice(0, 120) || "사이트 확인 필요";
  } catch {
    return "사이트 확인 필요";
  }
}

function normalizeAllowedLocalPath(value) {
  const input = String(value ?? "").trim();
  if (!input || input.length > 500) return null;
  const resolved = path.resolve(input);
  if (!path.isAbsolute(resolved) || !existsSync(resolved)) return null;
  const allowedRoots = [os.homedir(), os.tmpdir(), process.cwd()]
    .filter(Boolean)
    .map((root) => path.resolve(root).toLowerCase());
  const normalized = resolved.toLowerCase();
  if (!allowedRoots.some((root) => normalized === root || normalized.startsWith(`${root}${path.sep}`))) {
    return null;
  }
  return resolved;
}

function summarizeSelectedFolderChildren(folderPath) {
  try {
    const entries = readdirSync(folderPath, { withFileTypes: true }).filter((entry) => !entry.name.startsWith("."));
    const fileCount = entries.filter((entry) => entry.isFile()).length;
    const folderCount = entries.filter((entry) => entry.isDirectory()).length;
    return `1단계 미리보기: 파일 ${fileCount}개 · 폴더 ${folderCount}개`;
  } catch {
    return "1단계 미리보기: 확인 필요";
  }
}

function listRecentWorkFiles({ includeTempCandidates = false, intentText = "" } = {}) {
  const baseRoots = [
    path.join(os.homedir(), "Desktop"),
    path.join(os.homedir(), "Documents"),
    path.join(os.homedir(), "Downloads"),
  ];
  if (includeTempCandidates) baseRoots.push(os.tmpdir());
  baseRoots.push(process.cwd());
  const roots = uniqueExistingPaths(baseRoots);
  const candidates = [];
  const budget = { entries: 0, maxEntries: 900 };

  for (const root of roots) {
    collectRecentFiles(root, candidates, budget, 0);
    if (budget.entries >= budget.maxEntries) break;
  }

  return rankRecentWorkFiles(candidates, intentText).slice(0, 8);
}

function rankRecentWorkFiles(candidates, intentText) {
  const intent = buildRecentFileIntent(intentText);
  const nowMs = Date.now();

  return candidates
    .map((candidate) => {
      const haystack = `${candidate.name} ${candidate.folder} ${candidate.extension}`.toLowerCase();
      const reasons = [];
      let score = 0;

      if (intent.hasIntent) {
        for (const keyword of intent.keywords) {
          if (keyword && haystack.includes(keyword.toLowerCase())) {
            score += 24;
            reasons.push(`'${keyword}' 일치`);
          }
        }

        if (intent.extensionBoosts.has(candidate.extension)) {
          score += 12;
          reasons.push(`${candidate.extension.toUpperCase()} 형식`);
        }
      }

      const modifiedMs = Date.parse(candidate.modifiedAt);
      const ageHours = Number.isFinite(modifiedMs) ? Math.max(0, (nowMs - modifiedMs) / 36e5) : 240;
      const recencyScore = Math.max(0, 10 - Math.min(10, ageHours / 24));
      score += recencyScore;

      return {
        ...candidate,
        score: Math.round(score * 10) / 10,
        matchReason: reasons.slice(0, 2).join(", ") || "최근 수정",
        rankedByIntent: intent.hasIntent,
      };
    })
    .sort((a, b) => b.score - a.score || Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
}

function buildRecentFileIntent(value) {
  const normalized = sanitizeWindowText(value).toLowerCase();
  const keywords = new Set(
    normalized
      .split(/[^a-z0-9가-힣]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .slice(0, 10),
  );
  const extensionBoosts = new Set();

  const addKeywords = (...items) => {
    for (const item of items) keywords.add(item);
  };
  const addExtensions = (...items) => {
    for (const item of items) extensionBoosts.add(item);
  };

  if (/견적|quote|estimate/.test(normalized)) {
    addKeywords("견적", "견적서", "quote", "estimate");
    addExtensions("pdf", "xls", "xlsx", "doc", "docx");
  }
  if (/세금|계산서|정산|금액|invoice|tax/.test(normalized)) {
    addKeywords("세금", "계산서", "정산", "금액", "invoice", "tax");
    addExtensions("pdf", "xls", "xlsx", "csv");
  }
  if (/보고|보고서|report/.test(normalized)) {
    addKeywords("보고", "보고서", "report");
    addExtensions("pdf", "ppt", "pptx", "doc", "docx");
  }
  if (/엑셀|excel|xlsx|표|table/.test(normalized)) {
    addKeywords("엑셀", "excel", "표", "table");
    addExtensions("xls", "xlsx", "csv");
  }
  if (/발표|제안|ppt|presentation/.test(normalized)) {
    addKeywords("발표", "제안", "ppt", "presentation");
    addExtensions("ppt", "pptx", "pdf");
  }

  return {
    hasIntent: normalized.length > 0,
    keywords: [...keywords].slice(0, 16),
    extensionBoosts,
  };
}

async function extractLocalDocumentText(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (extension === "docx") {
    const mammoth = await loadMammoth();
    const result = await mammoth.extractRawText({ path: filePath });
    return sanitizeExtractedText(result.value);
  }

  if (extension === "xlsx") {
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const rows = [];
    workbook.eachSheet((sheet) => {
      rows.push(`[${sanitizeWindowText(sheet.name).slice(0, 80)}]`);
      sheet.eachRow((row) => {
        const values = [];
        row.eachCell((cell) => values.push(sanitizeWindowText(cell.text ?? cell.value).slice(0, 120)));
        if (values.length) rows.push(values.join(" | "));
      });
    });
    return sanitizeExtractedText(rows.join("\n"));
  }

  if (extension === "pdf") {
    const buffer = readFileSync(filePath);
    const PDFParse = await loadPDFParse();
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return sanitizeExtractedText(result.text);
    } finally {
      await parser.destroy();
    }
  }

  if (["txt", "csv", "md"].includes(extension)) {
    return sanitizeExtractedText(readFileSync(filePath, "utf8"));
  }

  throw new Error(`${extension || "unknown"} 형식은 아직 본문 분석을 지원하지 않습니다.`);
}

function sanitizeExtractedText(value) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:\+?82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, "[redacted-phone]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, 12000);
}

function createDocumentAnalysis({ fileName, instruction, text }) {
  const compact = compactText(text, 380);
  const normalized = `${fileName} ${instruction} ${text}`.toLowerCase();
  const checklist = new Set();

  checklist.add("원문과 파일명을 비교해 처리 대상이 맞는지 확인");
  if (/견적|quote|estimate|단가|공급가/.test(normalized)) {
    checklist.add("견적 금액, 수량, 단가, 유효기간 확인");
    checklist.add("기존 거래처 조건이나 이전 견적과 차이 확인");
  }
  if (/세금|계산서|invoice|tax|정산|입금|미수|금액/.test(normalized)) {
    checklist.add("합계 금액, 입금 상태, 누락 항목 확인");
    checklist.add("세무/정산 관련 실행은 사용자 최종 승인 후 진행");
  }
  if (/예약|상담|일정|calendar|schedule|시간/.test(normalized)) {
    checklist.add("가능 시간, 확정 전 고객 안내 문구, 일정 충돌 확인");
  }
  if (/보고|보고서|월별|실적|report/.test(normalized)) {
    checklist.add("보고서에 들어갈 핵심 지표와 예외 항목 분리");
  }

  const amountMatches = [...text.matchAll(/(?:₩|￦)?\s?\d[\d,]*(?:\.\d+)?\s?(?:원|만원|천원|krw)?/gi)]
    .map((match) => match[0].trim())
    .filter((value) => /\d/.test(value))
    .slice(0, 5);
  const dateMatches = [...text.matchAll(/\b20\d{2}[-./년 ]\s?\d{1,2}[-./월 ]\s?\d{1,2}|\b\d{1,2}\/\d{1,2}\b/g)]
    .map((match) => match[0].trim())
    .slice(0, 5);

  if (amountMatches.length) checklist.add(`금액 후보 확인: ${amountMatches.join(", ")}`);
  if (dateMatches.length) checklist.add(`날짜 후보 확인: ${dateMatches.join(", ")}`);

  const riskSignals = [
    {
      id: `analysis:${Date.now().toString(36)}:approval`,
      label: "분석 결과 확인 필요",
      riskLabel: "medium",
      reason: "문서 분석은 읽기 전용이며, 발송/등록/세무/계약 실행은 별도 승인 후 진행합니다.",
    },
  ];

  const checklistItems = [...checklist].slice(0, 8);
  return {
    riskLabel: /세금|계약|환불|결제|공공기관|tax|contract|refund|payment/.test(normalized) ? "high" : "medium",
    riskSignals,
    checklist: checklistItems,
    summary: `${fileName} 본문을 읽고 확인 항목 ${checklistItems.length}개를 만들었습니다. ${compact}`,
    body: [
      `문서: ${fileName}`,
      `요청: ${instruction || "문서 내용을 읽고 업무 확인 항목을 정리"}`,
      "",
      "요약",
      compact || "추출된 본문이 짧아 파일명과 메타데이터 중심으로 확인이 필요합니다.",
      "",
      "확인 체크리스트",
      ...checklistItems.map((item) => `- ${item}`),
      "",
      "안전 경계",
      "이 분석은 로컬 파일 읽기 전용입니다. 외부 발송, 일정 등록, 결제, 세무/계약 실행은 하지 않았습니다.",
    ].join("\n"),
  };
}

function createFileOutputDraft({ fileName, outputKind, instruction, text, analysis }) {
  const compact = compactText(text, 700);
  const checklist = analysis.checklist.length
    ? analysis.checklist
    : ["처리 대상 문서가 맞는지 확인", "외부 발송 전 사용자 승인 확인"];
  const requestedTask = instruction || "문서 기반 업무 산출물 작성";

  if (outputKind === "reply") {
    const body = [
      `제목: ${fileName} 건 확인드립니다`,
      "",
      "안녕하세요.",
      "",
      `${fileName} 내용을 확인했습니다. 바로 실행하지 않고 아래 항목을 먼저 확인한 뒤 진행하겠습니다.`,
      "",
      "확인한 내용",
      ...checklist.slice(0, 6).map((item) => `- ${item}`),
      "",
      "필요하시면 제가 위 항목을 기준으로 최종 답장 문구까지 정리하겠습니다.",
      "",
      "감사합니다.",
    ].join("\n");
    return {
      label: "답장 초안",
      summary: `${fileName} 내용을 바탕으로 승인 전 답장 초안을 만들었습니다.`,
      body,
    };
  }

  if (outputKind === "table") {
    const rows = checklist.slice(0, 8).map((item, index) => {
      const status = /승인|확인 필요|세무|계약|발송/.test(item) ? "사용자 확인" : "검토";
      return `${index + 1} | ${item.replace(/\|/g, "/")} | ${status}`;
    });
    const body = [
      `문서 표 정리: ${fileName}`,
      "",
      "번호 | 항목 | 상태",
      "--- | --- | ---",
      ...rows,
      "",
      "원문 미리보기",
      compact || "본문 추출 결과가 짧아 원본 확인이 필요합니다.",
      "",
      "안전 경계: 원본 파일은 수정하지 않았고, 외부 발송이나 일정 등록도 실행하지 않았습니다.",
    ].join("\n");
    return {
      label: "표 정리 초안",
      summary: `${fileName} 확인 항목을 표 형태로 정리했습니다.`,
      body,
    };
  }

  const body = [
    "# 문서 확인 보고서",
    "",
    `대상 문서: ${fileName}`,
    `요청: ${requestedTask}`,
    "",
    "## 요약",
    compact || "추출된 본문이 짧아 파일명과 메타데이터 중심으로 추가 확인이 필요합니다.",
    "",
    "## 확인 항목",
    ...checklist.slice(0, 8).map((item) => `- ${item}`),
    "",
    "## 다음 행동",
    "- 사용자가 승인하면 답장, 보고서 저장, 일정 등록 같은 후속 작업으로 넘깁니다.",
    "- 외부 발송, 일정 등록, 파일 쓰기, 결제/세무/계약 실행은 아직 하지 않았습니다.",
  ].join("\n");

  return {
    label: "보고서 초안",
    summary: `${fileName} 내용을 바탕으로 문서 확인 보고서 초안을 만들었습니다.`,
    body,
  };
}

function createLocalFileMetadata(filePath, metadata = {}) {
  const fileName = metadata.fileName ?? sanitizeWindowText(path.basename(filePath)).slice(0, 120);
  return {
    path: filePath,
    name: fileName,
    folder: metadata.folderName ?? sanitizeWindowText(path.basename(path.dirname(filePath))).slice(0, 80),
    extension: sanitizeWindowText(path.extname(filePath).replace(".", "").toLowerCase()).slice(0, 12),
    sizeLabel: metadata.fileSize ?? "확인 필요",
    modifiedAt: metadata.modifiedAt ?? new Date().toISOString(),
    extractedTextStatus: metadata.extractedTextStatus ?? "pending",
    preview: metadata.preview ?? "",
    scopeKind: metadata.scopeKind ?? "file",
    selectionMode: metadata.selectionMode ?? "explicit_path",
    folderScopePolicy: metadata.folderScopePolicy ?? "selected_file_or_folder_only_no_recursive_mutation",
    childCountLabel: metadata.childCountLabel ?? "",
  };
}

function compactText(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}

function uniqueExistingPaths(paths) {
  const seen = new Set();
  const result = [];
  for (const candidate of paths) {
    const resolved = path.resolve(candidate);
    const key = resolved.toLowerCase();
    if (seen.has(key) || !existsSync(resolved)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

function collectRecentFiles(dir, output, budget, depth) {
  if (budget.entries >= budget.maxEntries || depth > 2) return;

  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const orderedEntries = [
    ...entries.filter((entry) => entry.isFile()),
    ...entries.filter((entry) => entry.isDirectory()),
  ];

  for (const entry of orderedEntries) {
    if (budget.entries >= budget.maxEntries) return;
    if (entry.name.startsWith(".") || shouldSkipFileCandidate(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) continue;
      budget.entries += 1;
      collectRecentFiles(fullPath, output, budget, depth + 1);
      continue;
    }

    if (!entry.isFile() || !isWorkFile(entry.name)) continue;
    budget.entries += 1;

    try {
      const stats = statSync(fullPath);
      if (!stats.isFile() || stats.size <= 0) continue;
      const normalizedPath = normalizeAllowedLocalPath(fullPath);
      if (!normalizedPath) continue;
      output.push({
        path: normalizedPath,
        name: sanitizeWindowText(path.basename(normalizedPath)).slice(0, 120),
        folder: sanitizeWindowText(path.basename(path.dirname(normalizedPath))).slice(0, 80),
        extension: sanitizeWindowText(path.extname(normalizedPath).replace(".", "").toLowerCase()).slice(0, 12),
        modifiedAt: stats.mtime.toISOString(),
        sizeLabel: formatFileSize(stats.size),
      });
    } catch {
      continue;
    }
  }
}

function shouldSkipDirectory(name) {
  const lower = name.toLowerCase();
  return (
    lower === "node_modules" ||
    lower === ".git" ||
    lower === ".next" ||
    lower === "out" ||
    lower === "dist" ||
    lower === "appdata"
  );
}

function shouldSkipFileCandidate(name) {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".tmp") ||
    lower.endsWith(".log") ||
    lower.endsWith(".lock") ||
    lower.endsWith("log.txt") ||
    lower.includes("ngllog")
  );
}

function isWorkFile(name) {
  return new Set([
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".hwp",
    ".hwpx",
    ".txt",
    ".csv",
    ".md",
  ]).has(path.extname(name).toLowerCase());
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
}

async function openExternalTarget(target) {
  if (!normalizeAllowedUrl(target)) {
    return { ok: false, userMessage: "허용되지 않은 URL입니다." };
  }
  return runStartProcess(target, "url_open_failed");
}

async function openLocalTarget(target) {
  if (!normalizeAllowedLocalPath(target)) {
    return { ok: false, userMessage: "허용되지 않은 파일 경로입니다." };
  }
  return runStartProcess(target, "file_open_failed");
}

function runStartProcess(target, failureCode) {
  return new Promise((resolve) => {
    const script = "Start-Process -FilePath $env:MODYCREW_OPEN_TARGET";
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          ...process.env,
          MODYCREW_OPEN_TARGET: target,
        },
      },
    );

    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, userMessage: `${failureCode}:timeout` });
    }, 5000);

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, userMessage: `${failureCode}:${String(error?.message ?? error)}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      resolve({ ok: false, userMessage: stderr.trim() || `${failureCode}:${code}` });
    });
  });
}

async function listVisibleWindows() {
  if (process.platform !== "win32") {
    return [];
  }

  const command = [
    "$ErrorActionPreference='Stop';",
    "Get-Process |",
    "Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 } |",
    "Sort-Object ProcessName |",
    "Select-Object -First 12 Id,ProcessName,MainWindowTitle |",
    "ConvertTo-Json -Compress",
  ].join(" ");

  try {
    const output = await runPowerShellJson(command);
    const parsed = JSON.parse(output || "[]");
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map(sanitizeWindowRecord).filter(Boolean).slice(0, 12);
  } catch {
    return [];
  }
}

function runPowerShellJson(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("window_list_timeout"));
    }, 3500);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 32_000) {
        child.kill();
        reject(new Error("window_list_too_large"));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `window_list_failed:${code}`));
    });
  });
}

function sanitizeWindowRecord(value) {
  if (!value || typeof value !== "object") return null;
  const processName = sanitizeWindowText(value.ProcessName).slice(0, 80);
  const title = sanitizeWindowText(value.MainWindowTitle).slice(0, 160);
  const processId = Number(value.Id);
  if (!processName || !title || !Number.isFinite(processId)) return null;
  return {
    processId,
    processName,
    title,
  };
}

function sanitizeWindowText(value) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
