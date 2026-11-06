import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 무거운 문서 라이브러리(exceljs·mammoth·pdf-parse)는 실제로 쓸 때 불러온다.
// 예전엔 앱을 켤 때마다 전부 읽어 창이 뜨기까지 0.6~0.9초를 더 기다렸다(실측).
let excelModulePromise;
const loadExcelJS = () => (excelModulePromise ??= import("exceljs").then((module) => module.default ?? module));
let mammothModulePromise;
const loadMammoth = () => (mammothModulePromise ??= import("mammoth").then((module) => module.default ?? module));
let pdfParseModulePromise;
const loadPDFParse = () => (pdfParseModulePromise ??= import("pdf-parse").then((module) => module.PDFParse));

import { resolveDesktopDomainEntryPath } from "./runtime-paths.mjs";
import { handleChatDesktopTidy } from "./chat-desktop-tidy.mjs";

import {
  userFacingFolderPlanApprovalRecordLabel,
  userFacingFolderPlanLabel,
} from "./user-facing-labels.mjs";
import {
  updateLocalMemoryWorkspaceIntelligence,
} from "./local-memory-handler.mjs";
import {
  sanitizeDocumentLearningSupervisorTeammateProposal,
  sha256InChunks,
} from "./document-learning-supervisor.mjs";
import {
  createWorkspaceLearningSnapshotSessionId,
  updateWorkspaceIntelligenceFromLearningPlan,
} from "./workspace-intelligence-store.mjs";

let domainRuntimePromise;
const documentLearningPersistenceQueues = new Map();
const documentLearningSelectionGrants = new Map();
const documentLearningSelectionGrantTtlMs = 8 * 60 * 60 * 1000;
const documentLearningSelectionGrantLimit = 32;

export async function handleDocumentLearningMessage(event, payload = {}, options = {}) {
  try {
    assertTrustedDocumentLearningSender(event, options);
    const kind = payload.kind ?? payload.action;

    if (payload.chatTidy && ["create_folder_plan", "preview_folder_plan", "apply_folder_plan", "revert_folder_plan"].includes(kind)) {
      return await handleChatDesktopTidy(payload, options);
    }

    if (isDocumentLearningSupervisorAction(kind)) {
      return await handleDocumentLearningSupervisorAction(kind, { ...payload, event }, options);
    }

    if (kind === "choose_files") {
      const result = await chooseDocumentLearningFiles(options);
      rememberDocumentLearningSelection(event, result, options);
      return { ...result, supportsChatAttachmentReadOnly: true };
    }
    if (kind === "import_renderer_files") {
      await authorizeRendererDocumentLearningImport(event, payload, options);
      const result = await importRendererDocumentLearningFiles(payload, options);
      rememberDocumentLearningSelection(event, result, options);
      return { ...result, supportsChatAttachmentReadOnly: true };
    }
    if (kind === "choose_folders") {
      const confirmed = await confirmExplicitDocumentLearningFolderRequest(
        event,
        payload,
        options,
      );
      if (!confirmed) {
        return documentLearningPermissionCancelledResult(
          "document_learning_folder_confirmation_cancelled",
          "폴더 읽기 확인을 취소했습니다.",
        );
      }
      const result = await chooseDocumentLearningFolders(payload, options);
      rememberDocumentLearningSelection(event, result, options);
      const continuousLearning = payload.purpose === "chat_attachment" ? undefined
        : await maybeEnableDocumentLearningSupervisorSources(result, options);
      return {
        ...result,
        supportsChatAttachmentReadOnly: true,
        continuousLearning,
      };
    }
    if (kind === "choose_root") {
      const result = await chooseDocumentLearningRoot(options);
      rememberDocumentLearningSelection(event, result, options);
      return result;
    }

    payload = await resolveDocumentLearningRequestPayload(
      payload,
      options,
      String(kind ?? ""),
    );
    await assertAuthorizedDocumentLearningRequest(
      event,
      payload,
      options,
      String(kind ?? ""),
    );
    if (kind === "classify" && payload.purpose === "chat_attachment") return await readChatAttachments(payload);
    if (kind === "classify") return await runDocumentLearningRuntime(payload, options);
    if (kind === "create_folder_plan") return await createDocumentLearningFolderPlan(payload, options);
    if (kind === "preview_folder_plan") return await previewDocumentLearningFolderPlan(event, payload, options);
    if (kind === "stage_mail_attachments_folder_plan") return await stageMailAttachmentsFolderPlan(event, payload, options);
    if (kind === "apply_folder_plan") return await applyDocumentLearningFolderPlan(event, payload, options);
    if (kind === "revert_folder_plan") return await revertDocumentLearningFolderPlan(event, payload, options);
    if (kind === "search_index") return await searchDocumentLearningIndex(payload, options);
    if (kind === "open_index") return await openDocumentLearningIndex(payload, options);
    if (kind === "reveal_path") return await revealLocalDocumentLearningPath(payload.path, options);
    if (kind === "open_file") return await openLocalDocumentLearningPath(payload.path, options);

    return {
      status: "unsupported_action",
      rawSecretMaterialReturned: false,
      externalMutation: false,
      userMessage: "지원하지 않는 자료 학습 요청입니다.",
    };
  } catch (error) {
    const failedKind = payload.kind ?? payload.action;
    if (isDocumentLearningSupervisorAction(failedKind)) {
      return {
        status: "document_learning_supervisor_failed",
        errorCode: documentLearningSupervisorErrorCode(
          error instanceof Error ? error.message : String(error),
        ),
        rawSecretMaterialReturned: false,
        externalMutation: false,
        userMessage:
          "지속 학습 상태를 저장하지 못했습니다. 원본은 건드리지 않았고 다시 시도할 수 있습니다.",
      };
    }
    const failure = sanitizeDocumentLearningFailure(error);
    if (payload.chatTidy && failure.errorCode === "document_learning_error") {
      failure.errorCode = "desktop_tidy_failed";
      failure.userMessage = "바탕화면 정리 연결을 확인하지 못했습니다. 이 대화의 파일 접근과 저장 위치를 확인한 뒤 다시 시도해 주세요.";
    }
    return {
      status: "document_learning_failed",
      rawSecretMaterialReturned: false,
      externalMutation: false,
      errorCode: failure.errorCode,
      userMessage: failure.userMessage,
    };
  }
}

function assertTrustedDocumentLearningSender(event, options = {}) {
  if (options.trustedFileSelection === true) return;

  const sender = event?.sender;
  const senderFrame = event?.senderFrame;
  if (!sender || !senderFrame || !Number.isInteger(sender.id)) {
    throw new Error("자료 학습은 설치 앱의 확인된 창에서만 요청할 수 있습니다.");
  }
  if (sender.mainFrame && senderFrame !== sender.mainFrame) {
    throw new Error("하위 프레임에서는 자료 학습 파일을 요청할 수 없습니다.");
  }
  const senderUrl = String(senderFrame.url || sender.getURL?.() || "");
  if (
    !senderUrl.startsWith("modycrew://") &&
    !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/iu.test(senderUrl)
  ) {
    throw new Error("허용된 ModyCrew 화면에서만 자료 학습을 요청할 수 있습니다.");
  }
}

async function confirmExplicitDocumentLearningFolderRequest(
  event,
  payload,
  options = {},
) {
  if (options.trustedFileSelection === true) return true;
  const hasExplicitPath =
    Array.isArray(payload.paths) && payload.paths.some((value) => String(value ?? "").trim());
  const knownFolder = normalizeKnownFolder(payload.knownFolder);
  if (!hasExplicitPath && !knownFolder) return true;
  const labels = hasExplicitPath
    ? payload.paths
        .map((value) => sanitizeDocumentLearningFolderPath(value))
        .filter(Boolean)
        .map((value) => path.basename(value) || "선택 폴더")
        .slice(0, 8)
    : [knownFolderLabel(knownFolder) || "알려진 폴더"];
  return showDocumentLearningPermissionDialog(event, options, {
    title: payload.purpose === "chat_attachment" ? "첨부 폴더 읽기" : "업무 폴더 읽기 확인",
    message: payload.purpose === "chat_attachment"
      ? "이 폴더의 파일을 대화 자료로 읽을까요?"
      : "이 폴더의 지원 파일을 읽고 업무 패턴을 만들까요?",
    detail:
      `대상: ${labels.join(", ")}\n` +
      "원본 파일은 이동하거나 삭제하지 않습니다. 선택 범위 밖의 파일은 읽지 않습니다.",
    primaryLabel: "이 폴더 읽기",
  });
}

async function authorizeRendererDocumentLearningImport(
  event,
  payload,
  options = {},
) {
  if (options.trustedFileSelection === true) return;

  const externalPaths = (Array.isArray(payload.files) ? payload.files : [])
    .map((file) => sanitizeDocumentLearningFilePath(file?.absolutePath || file?.path))
    .filter(Boolean)
    .filter((filePath) => !isAuthorizedDocumentLearningPath(event, filePath, options));
  if (!externalPaths.length) return;
  const confirmed = await showDocumentLearningPermissionDialog(event, options, {
    title: "첨부 파일 읽기",
    message: "첨부한 파일을 이 대화에서 읽을까요?",
    detail:
      `대상: ${externalPaths.map((filePath) => path.basename(filePath)).slice(0, 8).join(", ")}\n` +
      "표시된 파일만 읽습니다. 원본 변경, 업무 패턴 생성, 자동 학습은 하지 않습니다.",
    primaryLabel: "이 파일 읽기",
  });
  if (!confirmed) {
    throw new Error("끌어온 파일 읽기 확인이 취소되어 첨부하지 않았습니다.");
  }
  rememberDocumentLearningPaths(event, { sourceFiles: externalPaths }, options);
}

async function showDocumentLearningPermissionDialog(
  event,
  options,
  input,
) {
  const dialog = requireOption(options, "dialog");
  if (typeof dialog.showMessageBox !== "function") {
    throw new Error("자료 학습 범위를 확인할 수 없어 파일을 읽지 않았습니다.");
  }
  const BrowserWindow = options.BrowserWindow;
  const parentWindow =
    (event?.sender &&
      typeof BrowserWindow?.fromWebContents === "function" &&
      BrowserWindow.fromWebContents(event.sender)) ||
    (typeof BrowserWindow?.getFocusedWindow === "function"
      ? BrowserWindow.getFocusedWindow()
      : undefined);
  const dialogOptions = {
    type: "question",
    title: input.title,
    message: input.message,
    detail: input.detail,
    buttons: [input.primaryLabel, "취소"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    normalizeAccessKeys: true,
  };
  const result = parentWindow && !parentWindow.isDestroyed?.()
    ? await dialog.showMessageBox(parentWindow, dialogOptions)
    : await dialog.showMessageBox(dialogOptions);
  return result.response === 0;
}

function documentLearningPermissionCancelledResult(status, userMessage) {
  return {
    status,
    files: [],
    folders: [],
    count: 0,
    skippedCount: 0,
    rawSecretMaterialReturned: false,
    externalMutation: false,
    originalFilesMoved: false,
    originalFilesDeleted: false,
    userMessage,
  };
}

function isDocumentLearningSupervisorAction(kind) {
  return [
    "supervisor_status",
    "pause_supervisor_source",
    "resume_supervisor_source",
    "revoke_supervisor_source",
    "reconcile_supervisor_source",
    "ack_supervisor_teammate_proposal",
  ].includes(String(kind ?? ""));
}

async function handleDocumentLearningSupervisorAction(kind, payload, options = {}) {
  if (!(await isAuthorizedDocumentLearningSupervisorControlSender(payload?.event, options))) {
    return {
      status: "document_learning_supervisor_control_unauthorized",
      supervisor: sanitizeDocumentLearningSupervisorStatus(),
      externalMutation: false,
      rawSecretMaterialReturned: false,
    };
  }
  const supervisor = options.documentLearningSupervisor;
  if (!supervisor || typeof supervisor.getStatus !== "function") {
    return {
      status: "document_learning_supervisor_unavailable",
      supervisor: sanitizeDocumentLearningSupervisorStatus(),
      externalMutation: false,
      rawSecretMaterialReturned: false,
      userMessage: "지속 학습 감독기가 아직 준비되지 않았습니다.",
    };
  }
  if (kind === "supervisor_status") {
    return {
      ...sanitizeDocumentLearningSupervisorStatus(supervisor.getStatus()),
      userMessage: "승인된 폴더의 지속 학습 상태를 불러왔습니다.",
    };
  }

  const sourceId = sanitizeDocumentLearningSupervisorSourceId(payload.sourceId);
  if (!sourceId) {
    return {
      status: "document_learning_supervisor_source_invalid",
      supervisor: sanitizeDocumentLearningSupervisorStatus(supervisor.getStatus()),
      externalMutation: false,
      rawSecretMaterialReturned: false,
      userMessage: "조정할 지속 학습 출처를 찾지 못했습니다.",
    };
  }
  if (kind === "ack_supervisor_teammate_proposal") {
    const draftId = sanitizeDocumentLearningSupervisorDraftId(payload.draftId);
    const proposalId = sanitizeDocumentLearningSupervisorProposalId(
      payload.proposalId,
    );
    if (!draftId || !proposalId) {
      return {
        status: "document_learning_supervisor_proposal_invalid",
        supervisor: sanitizeDocumentLearningSupervisorStatus(supervisor.getStatus()),
        externalMutation: false,
        rawSecretMaterialReturned: false,
        userMessage: "확인할 직원 제안 식별값이 올바르지 않습니다.",
      };
    }
    if (
      typeof supervisor.acknowledgeTeammateProposal !== "function" ||
      typeof options.verifyPersistedTeammateProposal !== "function"
    ) {
      return {
        status: "document_learning_supervisor_action_unavailable",
        supervisor: sanitizeDocumentLearningSupervisorStatus(supervisor.getStatus()),
        externalMutation: false,
        rawSecretMaterialReturned: false,
        userMessage: "이 직원 제안 확인 기능은 아직 사용할 수 없습니다.",
      };
    }
    const pendingProposal =
      sanitizeDocumentLearningSupervisorTeammateProposal(
        supervisor.getStatus()?.nextPendingTeammateProposal,
      );
    if (
      !pendingProposal ||
      pendingProposal.sourceId !== sourceId ||
      pendingProposal.draftId !== draftId ||
      pendingProposal.proposalId !== proposalId
    ) {
      return {
        status: "document_learning_teammate_proposal_not_found",
        supervisor: sanitizeDocumentLearningSupervisorStatus(supervisor.getStatus()),
        externalMutation: false,
        rawSecretMaterialReturned: false,
        userMessage: "현재 대기 중인 직원 제안과 일치하지 않아 완료하지 않았습니다.",
      };
    }
    const profileReceipt = await options.verifyPersistedTeammateProposal({
      sourceId,
      draftId,
      proposalId,
      proposal: pendingProposal,
    });
    if (profileReceipt?.verified !== true) {
      return {
        status: "document_learning_teammate_proposal_profile_unverified",
        supervisor: sanitizeDocumentLearningSupervisorStatus(supervisor.getStatus()),
        externalMutation: false,
        rawSecretMaterialReturned: false,
        userMessage:
          "직원 프로필이 로컬 기억에 저장된 것을 확인한 뒤 제안을 완료합니다.",
      };
    }
    const actionResult = await supervisor.acknowledgeTeammateProposal(
      sourceId,
      draftId,
      proposalId,
    );
    return {
      ...sanitizeDocumentLearningSupervisorActionResult(actionResult),
      supervisor: sanitizeDocumentLearningSupervisorStatus(supervisor.getStatus()),
      externalMutation: false,
      rawSecretMaterialReturned: false,
    };
  }

  const action = {
    pause_supervisor_source: "pause",
    resume_supervisor_source: "resume",
    revoke_supervisor_source: "revoke",
    reconcile_supervisor_source: "reconcile",
  }[kind];
  if (!action || typeof supervisor[action] !== "function") {
    return {
      status: "document_learning_supervisor_action_unavailable",
      supervisor: sanitizeDocumentLearningSupervisorStatus(supervisor.getStatus()),
      externalMutation: false,
      rawSecretMaterialReturned: false,
      userMessage: "이 지속 학습 조작은 사용할 수 없습니다.",
    };
  }
  const actionResult = await supervisor[action](sourceId, { reason: "user_requested" });
  return {
    ...sanitizeDocumentLearningSupervisorActionResult(actionResult),
    supervisor: sanitizeDocumentLearningSupervisorStatus(supervisor.getStatus()),
    externalMutation: false,
    rawSecretMaterialReturned: false,
  };
}

async function maybeEnableDocumentLearningSupervisorSources(selection, options = {}) {
  const folders = Array.isArray(selection?.folders) ? selection.folders : [];
  const supervisor = options.documentLearningSupervisor;
  if (!folders.length || !supervisor || typeof supervisor.enableSources !== "function") {
    return {
      status: folders.length
        ? "document_learning_supervisor_unavailable"
        : "document_learning_supervisor_no_folder_selected",
      supervisor: sanitizeDocumentLearningSupervisorStatus(supervisor?.getStatus?.()),
      externalMutation: false,
      rawSecretMaterialReturned: false,
    };
  }

  const rawCurrentStatus = supervisor.getStatus();
  const currentStatus = sanitizeDocumentLearningSupervisorStatus(rawCurrentStatus);
  const requestedKeys = new Set(
    folders
      .map((folder) => sanitizeDocumentLearningFolderPath(folder?.path || folder?.absolutePath))
      .filter(Boolean)
      .map(documentLearningPathKey),
  );
  const registeredKeys = new Set(
    (Array.isArray(rawCurrentStatus?.sources) ? rawCurrentStatus.sources : [])
      .filter((source) => source.status === "active" || source.status === "paused")
      .map((source) => documentLearningPathKey(source.canonicalRoot)),
  );
  if (requestedKeys.size > 0 && [...requestedKeys].every((key) => registeredKeys.has(key))) {
    return {
      status: "document_learning_sources_already_registered",
      supervisor: currentStatus,
      externalMutation: false,
      rawSecretMaterialReturned: false,
    };
  }

  const enabled = await supervisor.enableSources(
    folders.map((folder) => ({
      path: folder.path,
      label: folder.label,
      sourceKind: folder.sourceKind,
      maxFiles: Math.max(1, Math.min(30, Number(folder.maxFiles) || 30)),
      maxDepth: Math.max(0, Math.min(5, Number(folder.maxDepth) || 5)),
    })),
  );
  const sanitizedSupervisor = sanitizeDocumentLearningSupervisorStatus(
    enabled?.supervisor ?? supervisor.getStatus(),
  );
  return {
    status: String(enabled?.status ?? "document_learning_supervisor_enable_failed"),
    sources: sanitizedSupervisor.sources,
    supervisor: sanitizedSupervisor,
    externalMutation: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeDocumentLearningSupervisorStatus(value = {}) {
  return {
    status: String(value?.status ?? "document_learning_supervisor_unavailable"),
    stateStatus: String(value?.stateStatus ?? "unavailable"),
    started: value?.started === true,
    nextPendingTeammateProposal:
      sanitizeDocumentLearningSupervisorTeammateProposal(
        value?.nextPendingTeammateProposal,
      ),
    sources: (Array.isArray(value?.sources) ? value.sources : []).map((source) => ({
      sourceId: sanitizeDocumentLearningSupervisorSourceId(source?.sourceId),
      sourceLabel: String(source?.label ?? "업무 폴더").slice(0, 120),
      status: ["active", "paused", "needs_reapproval"].includes(source?.status)
        ? source.status
        : "needs_reapproval",
      approvedAt: typeof source?.approvedAt === "string" ? source.approvedAt : "",
      lastLearnedAt: typeof source?.lastLearnedAt === "string" ? source.lastLearnedAt : "",
      errorCode: documentLearningSupervisorErrorCode(source?.lastError),
      watcherErrorCode: documentLearningSupervisorErrorCode(source?.watcherError),
      knownFileCount: Math.max(0, Number(source?.knownFileCount) || 0),
      staleFileCount: Math.max(0, Number(source?.staleFileCount) || 0),
      lastResult: source?.lastResult && typeof source.lastResult === "object"
        ? {
            status: String(source.lastResult.status ?? ""),
            learnedCount: Math.max(0, Number(source.lastResult.learnedCount) || 0),
            candidateFiles: Math.max(0, Number(source.lastResult.candidateFiles) || 0),
            staleCount: Math.max(0, Number(source.lastResult.staleCount) || 0),
            skippedCount: Math.max(0, Number(source.lastResult.skippedCount) || 0),
          }
        : null,
    })),
    externalMutation: false,
    rawSecretMaterialReturned: false,
  };
}

async function isAuthorizedDocumentLearningSupervisorControlSender(event, options = {}) {
  if (options.trustedFileSelection === true) return true;
  if (typeof options.isAuthorizedDocumentLearningSupervisorControlSender !== "function") return false;
  try {
    return (await options.isAuthorizedDocumentLearningSupervisorControlSender(event)) === true;
  } catch {
    return false;
  }
}

function documentLearningSupervisorErrorCode(value) {
  const text = String(value ?? "");
  if (!text) return "";
  if (/reparse|symlink|junction/iu.test(text)) return "path_reapproval_required";
  if (/identity|canonical|root/iu.test(text)) return "source_reapproval_required";
  if (/abort/iu.test(text)) return "reconcile_aborted";
  return "supervisor_error";
}

function sanitizeDocumentLearningSupervisorActionResult(value = {}) {
  const rawStatus = String(value?.status ?? "");
  const status = /^[a-z0-9_]{1,120}$/u.test(rawStatus)
    ? rawStatus
    : "document_learning_supervisor_action_failed";
  const sourceId = sanitizeDocumentLearningSupervisorSourceId(value?.sourceId);
  const draftId = sanitizeDocumentLearningSupervisorDraftId(value?.draftId);
  const proposalId = sanitizeDocumentLearningSupervisorProposalId(
    value?.proposalId,
  );
  const errorCode = documentLearningSupervisorErrorCode(
    value?.errorMessage ?? value?.reason ?? value?.error,
  );
  return {
    status,
    ...(sourceId ? { sourceId } : {}),
    ...(draftId ? { draftId } : {}),
    ...(proposalId ? { proposalId } : {}),
    learnedCount: Math.max(0, Number(value?.learnedCount) || 0),
    candidateFiles: Math.max(0, Number(value?.candidateFiles) || 0),
    staleCount: Math.max(0, Number(value?.staleCount) || 0),
    skippedCount: Math.max(0, Number(value?.skippedCount) || 0),
    complete: value?.complete === true,
    ...(errorCode ? { errorCode } : {}),
  };
}

function sanitizeDocumentLearningFailure(error) {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const rules = [
    [
      /바탕화면 파일 접근이 꺼져/iu,
      "desktop_file_access_disabled",
      "이 대화의 바탕화면 파일 접근이 꺼져 있습니다. ‘파일 접근 허용하고 진행’을 누르면 이어서 확인할 수 있습니다.",
    ],
    [
      /표시된 (?:이동|정리) 목록을 승인/iu,
      "desktop_tidy_approval_required",
      "이동 목록을 확인하고 ‘승인하고 정리’를 눌러 주세요.",
    ],
    [
      /허용된 ModyCrew 화면|등록한 ModyCrew 창/iu,
      "sender_untrusted",
      "확인된 ModyCrew 앱 화면에서 다시 시도해 주세요.",
    ],
    [
      /먼저 파일 또는 폴더 선택창/iu,
      "selection_grant_required",
      "먼저 앱의 파일 또는 폴더 선택창에서 학습 범위를 골라 주세요.",
    ],
    [
      /확인된 ModyCrew 로컬 인덱스/iu,
      "local_index_untrusted",
      "확인된 ModyCrew 로컬 기억 위치에서 다시 시도해 주세요.",
    ],
    [
      /main-process 다운로드 경로/iu,
      "mail_attachment_provenance_required",
      "앱이 안전하게 내려받은 메일 첨부파일만 정리할 수 있습니다.",
    ],
    [
      /절대 경로/iu,
      "absolute_path_required",
      "앱이 확인한 파일 위치가 아니어서 처리하지 않았습니다.",
    ],
    [
      /사용자가 선택하지 않은 원본 파일/iu,
      "selection_scope_violation",
      "사용자가 선택한 범위 밖의 원본 파일이 있어 처리하지 않았습니다.",
    ],
    [
      /사용자가 선택하지 않은 복원 위치/iu,
      "restore_scope_violation",
      "사용자가 선택한 범위 밖의 복원 위치가 있어 처리하지 않았습니다.",
    ],
    [
      /main-process 무결성/iu,
      "control_integrity_failed",
      "앱의 안전 확인이 만료되었거나 일치하지 않아 다시 확인이 필요합니다.",
    ],
  ];
  const matched = rules.find(([pattern]) => pattern.test(text));
  return matched
    ? { errorCode: matched[1], userMessage: matched[2] }
    : {
        errorCode: "document_learning_error",
        userMessage: "자료 학습 처리 중 오류가 발생했습니다. 원본은 변경하지 않았습니다.",
      };
}

function sanitizeDocumentLearningSupervisorSourceId(value) {
  const sourceId = String(value ?? "");
  return /^docsrc_[a-f0-9]{24}$/u.test(sourceId) ? sourceId : "";
}

function sanitizeDocumentLearningSupervisorDraftId(value) {
  const draftId = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u.test(draftId) ? draftId : "";
}

function sanitizeDocumentLearningSupervisorProposalId(value) {
  const proposalId = String(value ?? "").trim();
  return /^docproposal_[a-f0-9]{32}$/u.test(proposalId) ? proposalId : "";
}
function rememberDocumentLearningSelection(event, result = {}, options = {}) {
  if (options.trustedFileSelection === true || !event?.sender) return;
  const sourceFiles = Array.isArray(result.files)
    ? result.files
        .map((file) => sanitizeDocumentLearningFilePath(file?.absolutePath || file?.path))
        .filter(Boolean)
    : [];
  const sourceRoots = Array.isArray(result.folders)
    ? result.folders
        .map((folder) =>
          sanitizeDocumentLearningFolderPath(
            typeof folder === "string" ? folder : folder?.absolutePath || folder?.path,
          ),
        )
        .filter(Boolean)
    : [];
  const indexRoots =
    result.status === "document_learning_root_selected" && result.localStorageRoot
      ? [sanitizeDocumentLearningRoot(result.localStorageRoot, options)]
      : [];
  rememberDocumentLearningPaths(
    event,
    { sourceFiles, sourceRoots, indexRoots },
    options,
  );
}

function rememberDocumentLearningPaths(
  event,
  input = {},
  options = {},
) {
  if (options.trustedFileSelection === true) return;

  const senderId = documentLearningSenderId(event);
  if (!senderId) return;
  pruneDocumentLearningSelectionGrants();
  const current = documentLearningSelectionGrants.get(senderId) ?? {
    sourceFiles: new Set(),
    sourceRoots: new Set(),
    indexRoots: new Set(),
    expiresAt: 0,
  };
  for (const value of input.sourceFiles ?? []) {
    const filePath = sanitizeDocumentLearningFilePath(value);
    if (filePath) current.sourceFiles.add(documentLearningPathKey(filePath));
  }
  for (const value of input.sourceRoots ?? []) {
    const folderPath = sanitizeDocumentLearningFolderPath(value);
    if (folderPath) current.sourceRoots.add(documentLearningPathKey(folderPath));
  }
  for (const value of input.indexRoots ?? []) {
    const rootPath = sanitizeDocumentLearningFolderPath(value);
    if (rootPath) current.indexRoots.add(documentLearningPathKey(rootPath));
  }
  current.expiresAt = Date.now() + documentLearningSelectionGrantTtlMs;
  documentLearningSelectionGrants.set(senderId, current);
  while (documentLearningSelectionGrants.size > documentLearningSelectionGrantLimit) {
    const oldestKey = documentLearningSelectionGrants.keys().next().value;
    if (oldestKey === undefined) break;
    documentLearningSelectionGrants.delete(oldestKey);
  }
}

async function resolveDocumentLearningRequestPayload(
  payload = {},
  options = {},
  kind = "",
) {
  const hasExplicitRoot =
    typeof payload.localStorageRoot === "string" && payload.localStorageRoot.trim();
  if (hasExplicitRoot && kind !== "stage_mail_attachments_folder_plan") {
    return payload;
  }
  if (
    ![
      "classify",
      "create_folder_plan",
      "preview_folder_plan",
      "stage_mail_attachments_folder_plan",
      "apply_folder_plan",
      "revert_folder_plan",
      "search_index",
      "open_index",
    ].includes(kind) ||
    typeof options.resolveAuthorizedLocalStorageRoot !== "function"
  ) {
    return payload;
  }
  try {
    const resolvedRoot = sanitizeDocumentLearningFolderPath(
      await options.resolveAuthorizedLocalStorageRoot(),
    );
    return resolvedRoot ? { ...payload, localStorageRoot: resolvedRoot } : payload;
  } catch {
    return payload;
  }
}
async function resolveAuthorizedMailAttachmentStagingPathKeys(
  requestedPaths = [],
  options = {},
) {
  const authorized = new Set();
  for (const value of options.authorizedMailAttachmentStagingPaths ?? []) {
    const filePath = sanitizeDocumentLearningFilePath(value);
    if (filePath) authorized.add(documentLearningPathKey(filePath));
  }
  if (typeof options.resolveAuthorizedMailAttachmentStagingPaths === "function") {
    try {
      const resolved = await options.resolveAuthorizedMailAttachmentStagingPaths(
        requestedPaths.slice(),
      );
      for (const value of Array.isArray(resolved) ? resolved : []) {
        const filePath = sanitizeDocumentLearningFilePath(value);
        if (filePath) authorized.add(documentLearningPathKey(filePath));
      }
    } catch {
      // Main-process lease lookup failure must not widen source-read access.
    }
  }
  return authorized;
}
function hasRelativeMailAttachmentStagePath(payload = {}) {
  const values = [
    ...(Array.isArray(payload.files) ? payload.files : []),
    ...(Array.isArray(payload.attachments) ? payload.attachments : []),
  ];
  return values.some((value) => {
    const requestedPath = String(
      value?.absolutePath ?? value?.path ?? value?.savedPath ?? "",
    ).trim();
    return requestedPath.length > 0 && !path.isAbsolute(requestedPath);
  });
}
function hasInlineMailAttachmentStagePayload(payload = {}) {
  const values = [
    ...(Array.isArray(payload.files) ? payload.files : []),
    ...(Array.isArray(payload.attachments) ? payload.attachments : []),
  ];
  return values.some((value) =>
    typeof value?.dataBase64 === "string" && value.dataBase64.trim().length > 0,
  );
}
async function assertAuthorizedDocumentLearningRequest(
  event,
  payload,
  options,
  kind,
) {
  if (options.trustedFileSelection === true) return;
  if (
    kind === "stage_mail_attachments_folder_plan" &&
    hasInlineMailAttachmentStagePayload(payload)
  ) {
    throw new Error("메일 첨부 정리는 main-process 다운로드 경로 또는 사용자가 선택한 파일만 사용할 수 있습니다.");
  }
  if (
    kind === "stage_mail_attachments_folder_plan" &&
    hasRelativeMailAttachmentStagePath(payload)
  ) {
    throw new Error("메일 첨부 파일은 main-process가 발급한 절대 경로만 사용할 수 있습니다.");
  }


  const grant = getDocumentLearningSelectionGrant(event);
  const allowedIndexRoots = await resolveAuthorizedDocumentLearningIndexRoots(
    options,
    grant,
  );
  const requestedPaths = collectDocumentLearningRequestPaths(payload, kind);
  const mailAttachmentStagingKeys =
    kind === "stage_mail_attachments_folder_plan"
      ? await resolveAuthorizedMailAttachmentStagingPathKeys(requestedPaths, options)
      : new Set();
  const indexPathAllowed = [
    "preview_folder_plan",
    "apply_folder_plan",
    "revert_folder_plan",
    "open_file",
  ].includes(kind);
  for (const requestedPath of requestedPaths) {
    const requestedKey = documentLearningPathKey(requestedPath);
    const selectedPath =
      grant &&
      (grant.sourceFiles.has(requestedKey) ||
        [...grant.sourceRoots].some((rootKey) =>
          isDocumentLearningPathInside(rootKey, requestedKey),
        ));
    const indexPath = [...allowedIndexRoots].some((rootKey) =>
      isDocumentLearningPathInside(rootKey, requestedKey),
    );
    const mailAttachmentStagingPath = mailAttachmentStagingKeys.has(requestedKey);
    if (
      !selectedPath &&
      !mailAttachmentStagingPath &&
      !(indexPathAllowed && indexPath)
    ) {
      throw new Error(
        grant
          ? "사용자가 선택하지 않은 파일 또는 폴더는 읽거나 변경할 수 없습니다."
          : "먼저 파일 또는 폴더 선택창에서 학습 범위를 골라 주세요.",
      );
    }
  }

  if (
    payload.localStorageRoot ||
    ["classify", "create_folder_plan", "preview_folder_plan", "stage_mail_attachments_folder_plan", "apply_folder_plan", "revert_folder_plan", "search_index", "open_index"].includes(kind)
  ) {
    const requestedRoot = sanitizeDocumentLearningRoot(
      payload.localStorageRoot,
      options,
    );
    if (!allowedIndexRoots.has(documentLearningPathKey(requestedRoot))) {
      throw new Error("확인된 로컬 기억 위치 밖에는 자료 학습 인덱스를 저장할 수 없습니다.");
    }
  }
}

async function resolveAuthorizedDocumentLearningIndexRoots(
  options = {},
  grant,
) {
  const allowedRoots = new Set([
    documentLearningPathKey(getDocumentLearningDefaultRoot(options)),
    ...(grant ? grant.indexRoots : []),
  ]);
  for (const value of options.authorizedLocalStorageRoots ?? []) {
    const cleanRoot = sanitizeDocumentLearningFolderPath(value);
    if (cleanRoot) allowedRoots.add(documentLearningPathKey(cleanRoot));
  }
  if (typeof options.resolveAuthorizedLocalStorageRoot === "function") {
    try {
      const resolved = await options.resolveAuthorizedLocalStorageRoot();
      const cleanRoot = sanitizeDocumentLearningFolderPath(resolved);
      if (cleanRoot) allowedRoots.add(documentLearningPathKey(cleanRoot));
    } catch {
      // No fallback to renderer-provided roots when the main-process resolver fails.
    }
  }
  return allowedRoots;
}
function collectDocumentLearningRequestPaths(payload = {}, kind = "") {
  const paths = [];
  const addPath = (value) => {
    if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value.trim())) return;
    paths.push(path.resolve(value.trim()));
  };
  for (const file of Array.isArray(payload.files) ? payload.files : []) {
    addPath(file?.absolutePath || file?.path);
  }
  for (const attachment of Array.isArray(payload.attachments) ? payload.attachments : []) {
    addPath(attachment?.absolutePath || attachment?.path);
  }
  for (const folder of Array.isArray(payload.folders) ? payload.folders : []) {
    addPath(typeof folder === "string" ? folder : folder?.absolutePath || folder?.path);
  }
  const operationLists = [
    payload.operations,
    payload.plan?.operations,
    payload.folderPlan?.operations,
  ];
  for (const operations of operationLists) {
    for (const operation of Array.isArray(operations) ? operations : []) {
      addPath(operation?.sourcePath || operation?.absolutePath || operation?.path);
      addPath(operation?.targetPath || operation?.destinationPath);
    }
  }
  addPath(payload.planPath);
  addPath(payload.manifestPath);
  if (kind === "open_file") addPath(payload.path);
  return [...new Set(paths.map((value) => documentLearningPathKey(value)))];
}

function isAuthorizedDocumentLearningPath(event, value, options = {}) {
  if (options.trustedFileSelection === true) return true;
  const requestedPath = sanitizeDocumentLearningFolderPath(value);
  if (!requestedPath) return false;
  const requestedKey = documentLearningPathKey(requestedPath);
  const grant = getDocumentLearningSelectionGrant(event);
  if (!grant) return false;
  if (grant.sourceFiles.has(requestedKey)) return true;
  return [...grant.sourceRoots].some((rootKey) =>
    isDocumentLearningPathInside(rootKey, requestedKey),
  );
}
function getDocumentLearningSelectionGrant(event) {
  pruneDocumentLearningSelectionGrants();
  const senderId = documentLearningSenderId(event);
  if (!senderId) return undefined;
  return documentLearningSelectionGrants.get(senderId);
}

function pruneDocumentLearningSelectionGrants() {
  const now = Date.now();
  for (const [senderId, grant] of documentLearningSelectionGrants) {
    if (!grant || grant.expiresAt <= now) {
      documentLearningSelectionGrants.delete(senderId);
    }
  }
}

function documentLearningSenderId(event) {
  return Number.isInteger(event?.sender?.id)
    ? String(event.sender.id)
    : "";
}

function documentLearningPathKey(value) {
  const resolvedPath = path.resolve(String(value ?? ""));
  let existingAncestor = resolvedPath;
  const missingSegments = [];
  while (!existsSync(existingAncestor)) {
    const parentPath = path.dirname(existingAncestor);
    if (parentPath === existingAncestor) break;
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parentPath;
  }
  let canonicalAncestor = existingAncestor;
  try {
    canonicalAncestor = realpathSync.native(existingAncestor);
  } catch {
    // Keep the resolved ancestor if the path disappears between exists/realpath.
  }
  return path
    .resolve(canonicalAncestor, ...missingSegments)
    .toLocaleLowerCase("ko-KR");
}

function isDocumentLearningPathInside(rootKey, candidateKey) {
  const relative = path.relative(rootKey, candidateKey);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function chooseDocumentLearningFiles(options) {
  const dialog = requireOption(options, "dialog");
  const browserWindow = options.BrowserWindow;
  const focusedWindow =
    browserWindow && typeof browserWindow.getFocusedWindow === "function"
      ? browserWindow.getFocusedWindow()
      : undefined;
  const result = await dialog.showOpenDialog(focusedWindow ?? undefined, {
    title: "파일 선택",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "업무 파일",
        extensions: [
          "doc",
          "docx",
          "xls",
          "xlsx",
          "csv",
          "txt",
          "md",
          "pdf",
          "ppt",
          "pptx",
          "key",
          "hwp",
          "hwpx",
          "png",
          "jpg",
          "jpeg",
          "webp",
          "gif",
          "bmp",
          "tif",
          "tiff",
          "heic",
          "json",
          "html",
          "xml",
          "rtf",
          "mp4",
          "mov",
          "mkv",
          "avi",
          "webm",
          "m4v",
          "psd",
          "ai",
          "fig",
          "sketch",
          "xd",
          "prproj",
          "aep",
          "indd",
          "eml",
          "msg",
          "mbox",
          "zip",
          "7z",
          "rar",
        ],
      },
      { name: "모든 파일", extensions: ["*"] },
    ],
  });

  if (result.canceled) {
    return {
      status: "document_learning_file_pick_cancelled",
      files: [],
      rawSecretMaterialReturned: false,
      externalMutation: false,
      userMessage: "파일 선택을 취소했습니다.",
    };
  }

  const files = [];
  for (const [index, filePath] of result.filePaths.entries()) {
    try {
      const file = await describeDocumentLearningFile(filePath, index);
      if (file) files.push(file);
    } catch {
      // unreadable entries are ignored; the UI reports the valid selections.
    }
  }

  return {
    status: files.length > 0 ? "document_learning_files_selected" : "document_learning_no_supported_files",
    files,
    count: files.length,
    rawSecretMaterialReturned: false,
    externalMutation: false,
    userMessage:
      files.length > 0
        ? `${files.length}개 파일을 선택했습니다.`
        : "지원되는 업무 파일을 선택하지 않았습니다. 문서, 표, PDF, 텍스트, 이미지 파일을 선택하세요.",
  };
}

async function importRendererDocumentLearningFiles(payload = {}, options = {}) {
  const source = Array.isArray(payload.files) ? payload.files : [];
  const sourceKind = sanitizeRendererSourceKind(payload.sourceKind);
  const files = [];
  let skippedCount = 0;

  for (const [index, file] of source.entries()) {
    try {
      const absolutePath = sanitizeDocumentLearningFilePath(file.absolutePath || file.path);
      if (absolutePath) {
        const described = await describeDocumentLearningFile(absolutePath, index, { sourceKind });
        if (described) files.push(described);
        else skippedCount += 1;
        continue;
      }

      const importedPath = await persistRendererFilePayload(file, index, sourceKind, options);
      if (!importedPath) {
        skippedCount += 1;
        continue;
      }
      const described = await describeDocumentLearningFile(importedPath, index, { sourceKind });
      if (described) files.push({ ...described, fileName: sanitizeImportFileName(file.fileName || file.name || described.fileName) });
      else skippedCount += 1;
    } catch {
      skippedCount += 1;
    }
  }

  return {
    status: files.length > 0 ? "document_learning_renderer_files_imported" : "document_learning_no_supported_files",
    files,
    count: files.length,
    skippedCount,
    rawSecretMaterialReturned: false,
    externalMutation: false,
    originalFilesMoved: false,
    originalFilesDeleted: false,
    userMessage:
      files.length > 0
        ? `${files.length}개 파일을 첨부했습니다. 끌어온 파일은 원본을 건드리지 않고, 붙여넣은 이미지는 앱 로컬 첨부 폴더에 저장했습니다.`
        : "붙여넣거나 끌어온 파일을 읽지 못했습니다. 문서, 표, PDF, 텍스트, 이미지 파일을 다시 넣어 주세요.",
  };
}

async function chooseDocumentLearningFolders(payload = {}, options) {
  const dialog = requireOption(options, "dialog");
  const folders = [];
  const knownFolder = normalizeKnownFolder(payload.knownFolder);
  const namedFolderHint = sanitizeNamedFolderHint(payload.namedFolderHint);
  let knownFolderRoot = "";
  let namedFolderMatched = false;
  if (knownFolder) {
    const knownPath = getKnownFolderPath(knownFolder, options);
    knownFolderRoot = knownPath;
    if (knownPath) {
      const hintedPath = namedFolderHint ? await findChildFolderByHint(knownPath, namedFolderHint) : "";
      namedFolderMatched = Boolean(hintedPath);
      folders.push(hintedPath || knownPath);
    }
  } else if (Array.isArray(payload.paths) && payload.paths.length) {
    for (const sourcePath of payload.paths) {
      const cleanPath = sanitizeDocumentLearningFolderPath(sourcePath);
      if (cleanPath) folders.push(cleanPath);
    }
  } else {
    const browserWindow = options.BrowserWindow;
    const focusedWindow =
      browserWindow && typeof browserWindow.getFocusedWindow === "function"
        ? browserWindow.getFocusedWindow()
        : undefined;
    const result = await dialog.showOpenDialog(focusedWindow ?? undefined, {
      title: payload.purpose === "chat_attachment" ? "대화에 첨부할 폴더 선택" : "학습할 폴더 또는 드라이브 선택",
      defaultPath: getKnownFolderPath("desktop", options) || os.homedir(),
      properties: ["openDirectory", "multiSelections"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return {
        status: "document_learning_folder_pick_cancelled",
        files: [],
        folders: [],
        count: 0,
        skippedCount: 0,
        rawSecretMaterialReturned: false,
        externalMutation: false,
        userMessage: "폴더 선택을 취소했습니다.",
      };
    }
    folders.push(...result.filePaths);
  }

  const uniqueFolders = [...new Set(folders.map((folder) => path.resolve(folder)))];
  const maxFiles = clampNumber(payload.maxFiles, 20, 500, 200);
  const maxDepth = clampNumber(payload.maxDepth, 1, 12, 5);
  const files = [];
  const folderRecords = [];
  let skippedCount = 0;

  for (const folderPath of uniqueFolders) {
    const scan = await scanDocumentLearningFolder(folderPath, {
      maxFiles: Math.max(0, maxFiles - files.length),
      maxDepth,
      sourceKind: knownFolder || "custom",
    });
    files.push(...scan.files);
    skippedCount += scan.skippedCount;
    folderRecords.push({
      id: documentLearningFolderId(folderPath),
      path: folderPath,
      label: namedFolderMatched && knownFolderRoot !== folderPath
        ? path.basename(folderPath) || namedFolderHint
        : knownFolderLabel(knownFolder) || path.basename(folderPath) || folderPath,
      sourceKind: knownFolder || "custom",
      fileCount: scan.files.length,
      skippedCount: scan.skippedCount,
      maxDepth,
      maxFiles,
    });
    if (files.length >= maxFiles) break;
  }

  return {
    status: files.length > 0 ? "document_learning_folders_scanned" : "document_learning_no_supported_files",
    files,
    folders: folderRecords,
    count: files.length,
    skippedCount,
    maxFiles,
    maxDepth,
    rawSecretMaterialReturned: false,
    externalMutation: false,
    originalFilesMoved: false,
    originalFilesDeleted: false,
    userMessage:
      files.length > 0
        ? `${folderRecords.length}개 위치에서 ${files.length}개 지원 문서를 찾았습니다. 원본은 이동하거나 삭제하지 않습니다.`
        : "선택한 위치에서 지원되는 업무 파일을 찾지 못했습니다. 문서, 표, PDF, 텍스트, 이미지 파일을 확인합니다.",
    namedFolderHint,
    namedFolderMatched,
  };
}

function sanitizeNamedFolderHint(value) {
  return String(value ?? "")
    .replace(/\0/g, "")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

async function findChildFolderByHint(rootPath, hint) {
  const normalizedHint = normalizeFolderSearchText(hint);
  if (!normalizedHint) return "";
  let entries = [];
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return "";
  }
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      score: folderHintScore(normalizeFolderSearchText(entry.name), normalizedHint),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "ko-KR"));
  return candidates[0] ? path.join(rootPath, candidates[0].name) : "";
}

function normalizeFolderSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function folderHintScore(candidate, hint) {
  if (!candidate || !hint) return 0;
  if (candidate === hint) return 100;
  if (candidate.includes(hint)) return 80;
  if (hint.includes(candidate) && candidate.length >= 2) return 60;
  return 0;
}

function sanitizeDocumentLearningFolderPath(value) {
  const input = String(value ?? "").replace(/\0/g, "").trim();
  if (!input) return "";
  try {
    return path.resolve(input);
  } catch {
    return "";
  }
}

async function chooseDocumentLearningRoot(options) {
  const dialog = requireOption(options, "dialog");
  const browserWindow = options.BrowserWindow;
  const focusedWindow =
    browserWindow && typeof browserWindow.getFocusedWindow === "function"
      ? browserWindow.getFocusedWindow()
      : undefined;
  const result = await dialog.showOpenDialog(focusedWindow ?? undefined, {
    title: "자료 학습 인덱스 저장 위치",
    defaultPath: getDocumentLearningDefaultRoot(options),
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || !result.filePaths[0]) {
    return {
      status: "document_learning_root_pick_cancelled",
      localStorageRoot: getDocumentLearningDefaultRoot(options),
      rawSecretMaterialReturned: false,
      externalMutation: false,
      userMessage: "저장 위치 선택을 취소했습니다.",
    };
  }

  return {
    status: "document_learning_root_selected",
    localStorageRoot: path.resolve(result.filePaths[0]),
    rawSecretMaterialReturned: false,
    externalMutation: false,
    userMessage: "로컬 인덱스 저장 위치를 선택했습니다.",
  };
}

function createReviewableLearningDrafts(recommendations, learningPlan, createDraft, userInstruction) {
  const drafts = [];
  const warnings = [];
  for (const recommendation of recommendations) {
    try {
      drafts.push(createDraft({ learningPlan, recommendation, userInstruction }));
    } catch {
      warnings.push({ recommendationId: recommendation.id, reason: "자료 근거가 없거나 모호해 이 초안을 보류했습니다." });
    }
  }
  return { drafts, warnings };
}

// Chat attachments are context, not a request to create staff, memories, skills
// or approval drafts. This path deliberately never calls the learning runtime.
async function readChatAttachments(payload = {}) {
  const extracted = [];
  for (const file of (Array.isArray(payload.files) ? payload.files : []).slice(0, 12)) {
    try {
      const raw = await extractLocalDocumentText(file.absolutePath);
      const text = redactDocumentLearningSensitiveText(raw);
      extracted.push({ id: file.id, absolutePath: file.absolutePath, fileName: file.fileName,
        preview: text.slice(0, 24000), characterCount: text.length, truncated: text.length > 24000, extractionStatus: "ready" });
    } catch {
      extracted.push({ id: file.id, absolutePath: file.absolutePath, fileName: file.fileName, preview: "", extractionStatus: "failed" });
    }
  }
  return { status: "chat_attachments_read", extracted, externalMutation: false, originalFilesMoved: false, originalFilesDeleted: false };
}

async function runDocumentLearningRuntime(payload = {}, options = {}) {
  const trustedSupervisorSnapshot = isTrustedDocumentLearningSupervisorSnapshot(payload, options);
  const files = (trustedSupervisorSnapshot
    ? await normalizeTrustedDocumentLearningSnapshotFiles(payload)
    : normalizeDocumentLearningFiles(payload)).filter((file) => file.selected !== false);
  const localStorageRoot = sanitizeDocumentLearningRoot(payload.localStorageRoot, options);
  const observedAt = documentLearningNowIso(options);
  const workspaceId = normalizeDocumentLearningWorkspaceId(payload.workspaceId);
  const signal = trustedSupervisorSnapshot ? payload.signal : undefined;
  if (trustedSupervisorSnapshot) {
    assertTrustedDocumentLearningSnapshot(payload, files);
  }

  if (files.length === 0 && !trustedSupervisorSnapshot) {
    return {
      status: "document_learning_no_files",
      localStorageRoot,
      rawSecretMaterialReturned: false,
      externalMutation: false,
      userMessage: "선택된 파일이 없습니다. 먼저 파일 선택을 누르세요.",
    };
  }

  const {
    ModyKnowledgeIngest,
    ModyLocalDocumentLearningPlanner,
    createDocumentAutomationRecommendations,
    createLearnedOutputDraft,
    createTeammateProfileDraft,
    ModyWorkspaceIntelligenceEngine,
  } = await loadDomainRuntime(options);
  const planner = new ModyLocalDocumentLearningPlanner();
  const learningPlan = planner.createPlan({
    workspaceId,
    localStorageRoot,
    createdAt: observedAt,
    selectedKinds: Array.isArray(payload.selectedKinds) ? payload.selectedKinds.map(String) : undefined,
    files,
  });
  const ingest = new ModyKnowledgeIngest();
  const extracted = [];
  const failures = [];
  const ingested = [];
  // 폴더 감시가 보낸 파일은 내용 해시(sha256)가 확인돼 있다. 같은 내용이면 지난번에 뽑아 둔
  // 본문(로컬 인덱스 폴더의 text-cache)을 다시 쓰고, 내용이 바뀐 파일만 새로 읽는다.
  // 예전에는 파일 하나만 저장해도 폴더 안 문서 30개를 전부 다시 추출해 앱이 거듭 멈췄다.
  const textCacheRoot = trustedSupervisorSnapshot
    ? path.join(path.resolve(learningPlan.localIndexRoot), documentLearningTextCacheFolderName)
    : "";
  let extractionCacheHits = 0;
  const pendingTextCacheWrites = [];
  const pendingTextCacheTouches = [];

  for (const [index, file] of files.entries()) {
    try {
      throwIfDocumentLearningAborted(signal);
      const extension = documentLearningExtension(file.fileName || file.absolutePath);
      if (!isDocumentLearningTextExtractableExtension(extension)) {
        extracted.push({
          id: file.id,
          fileName: file.fileName,
          absolutePath: file.absolutePath,
          characterCount: 0,
          extractedText: "",
          sensitiveValueRedacted: false,
          preview: "",
          extractionStatus: "unsupported_format",
        });
        continue;
      }
      const textCacheable = Boolean(textCacheRoot && file.contentSha256) && isDocumentLearningTextCacheableExtension(extension);
      const cachedText = textCacheable
        ? await readDocumentLearningTextCache(textCacheRoot, file.contentSha256, extension)
        : null;
      let extractedText;
      let sensitiveValueRedacted;
      if (cachedText) {
        extractionCacheHits += 1;
        pendingTextCacheTouches.push(file.contentSha256);
        extractedText = cachedText.extractedText;
        sensitiveValueRedacted = cachedText.sensitiveValueRedacted;
      } else {
        const rawExtractedText = file.trustedContentBuffer
          ? await extractTrustedDocumentLearningText(file, signal)
          : await extractLocalDocumentText(file.absolutePath);
        throwIfDocumentLearningAborted(signal);
        extractedText = redactDocumentLearningSensitiveText(rawExtractedText);
        sensitiveValueRedacted = rawExtractedText !== extractedText;
        if (textCacheable) {
          pendingTextCacheWrites.push({ contentSha256: file.contentSha256, extension, value: {
            extractedText,
            sensitiveValueRedacted,
          } });
        }
      }
      throwIfDocumentLearningAborted(signal);
      const provenanceAbsolutePath = file.provenanceAbsolutePath || file.absolutePath;
      const title = documentLearningTitleFor(file.fileName || provenanceAbsolutePath);
      const ingestResult = ingest.ingest({
        id: `desktop_doc_${index + 1}`,
        workspaceId,
        source: "local_file",
        title,
        sourceUri: provenanceAbsolutePath,
        originalFileName: file.fileName,
        mimeType: documentLearningMimeTypeFor(provenanceAbsolutePath),
        fileSizeBytes: file.sizeBytes,
        extractedText,
        retentionPolicy: "manual_delete_required",
      });
      extracted.push({
        id: file.id,
        fileName: file.fileName,
        absolutePath: file.absolutePath,
        characterCount: extractedText.length,
        extractedText,
        sensitiveValueRedacted,
        preview: compactDocumentLearningText(extractedText, 220),
        extractionStatus: "ready",
      });
      ingested.push({
        documentId: ingestResult.record.document.id,
        title: ingestResult.record.document.title,
        extractedTextStatus: ingestResult.record.document.extractedTextStatus,
        chunks: ingestResult.record.chunks.length,
        riskLabel: ingestResult.record.document.riskLabel,
      });
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      failures.push({
        id: file.id,
        fileName: file.fileName,
        absolutePath: file.absolutePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  learningPlan.sessionId = createWorkspaceLearningSnapshotSessionId({
    workspaceId,
    files,
    extracted,
  });

  if (trustedSupervisorSnapshot && failures.length > 0) {
    return {
      status: "document_learning_indexed_with_warnings",
      localStorageRoot,
      failures,
      summary: {
        selectedFiles: files.length,
        extractedReady: countReadyDocumentLearningExtractions(extracted),
        failed: failures.length,
        extractionCacheHits,
      },
      snapshotApplied: false,
      snapshotDigest: String(payload.snapshotDigest ?? ""),
      acceptedContentSha256s: [],
      rawSecretMaterialReturned: false,
      externalMutation: false,
      originalFilesMoved: false,
      originalFilesDeleted: false,
    };
  }

  const searchQuery =
    typeof payload.searchQuery === "string" && payload.searchQuery.trim()
      ? payload.searchQuery.trim()
      : "인수인계 보고서 일정 정산 상담";
  const searchHits = ingest.search(searchQuery, {
    topK: 5,
    workspaceId,
  }).map((hit) => ({
    title: hit.document.title,
    citation: hit.citationLabel,
    preview: compactDocumentLearningText(hit.chunk.text, 160),
  }));
  const automationRecommendations = createDocumentAutomationRecommendations(learningPlan);
  // 학습 결과로 "나와 같은 일을 하는 AI 직원" 초안을 함께 합성합니다.
  // 생성은 항상 웹 쪽 사용자 승인 카드 이후에만 이루어집니다.
  const teammateProfileDraft =
    typeof createTeammateProfileDraft === "function" ? createTeammateProfileDraft(learningPlan) : undefined;
  const draftResult = createReviewableLearningDrafts(automationRecommendations, learningPlan, createLearnedOutputDraft, "학습한 자료 형식으로 바로 검토 가능한 업무 초안을 만들어줘");
  const learnedOutputDrafts = draftResult.drafts;
  if (draftResult.warnings.length) {
    return {
      status: "document_learning_drafts_need_review", localStorageRoot,
      localIndexRoot: path.resolve(learningPlan.localIndexRoot), learningPlan,
      automationRecommendations, learnedOutputDrafts, draftWarnings: draftResult.warnings,
      extracted, failures, searchHits, saved: false,
      rawSecretMaterialReturned: false, externalMutation: false,
      originalFilesMoved: false, originalFilesDeleted: false,
      userMessage: "일부 초안의 자료 근거를 확인하지 못했습니다. 기존 기록을 보존하기 위해 이번 결과는 저장하지 않았습니다. 자료를 다시 확인해 주세요.",
    };
  }
  if (textCacheRoot) {
    const touchTime = new Date();
    for (const contentSha256 of pendingTextCacheTouches) {
      await fs.utimes(documentLearningTextCachePath(textCacheRoot, contentSha256), touchTime, touchTime).catch(() => undefined);
    }
    for (const pending of pendingTextCacheWrites) {
      await writeDocumentLearningTextCache(textCacheRoot, pending.contentSha256, pending.extension, pending.value);
    }
    await pruneDocumentLearningTextCache(textCacheRoot, new Set(files.map((file) => file.contentSha256).filter(Boolean)));
  }
  const learnedDraftWorkItems = createLearnedDraftApprovalWorkItems({
    createdAt: new Date().toISOString(),
    localStorageRoot,
    indexRoot: path.resolve(learningPlan.localIndexRoot),
    reportPath: path.join(path.resolve(learningPlan.localIndexRoot), "modycrew-document-index.md"),
    learnedOutputDrafts,
  });
  const indexRoot = path.resolve(learningPlan.localIndexRoot);
  await fs.mkdir(indexRoot, { recursive: true });

  const summary = {
    selectedFiles: files.length,
    indexedFiles: files.length,
    extractedReady: countReadyDocumentLearningExtractions(extracted),
    failed: failures.length,
    // 내용이 그대로라 지난번 본문을 다시 쓴 파일 수(폴더 감시 학습에서만 0보다 크다).
    extractionCacheHits,
    chunks: ingested.reduce((total, item) => total + item.chunks, 0),
    groups: learningPlan.groups.length,
    operationalMemoryFiles: learningPlan.operationalMemory?.fileMemories?.length ?? 0,
    primaryReferences: learningPlan.operationalMemory?.summary?.primaryReferences ?? 0,
    templates: learningPlan.operationalMemory?.summary?.templates ?? 0,
    drafts: learningPlan.operationalMemory?.summary?.drafts ?? 0,
    reviewNeeded: learningPlan.operationalMemory?.summary?.reviewNeeded ?? 0,
    mailReferences: learningPlan.operationalMemory?.summary?.mailReferences ?? 0,
    assetReferences: learningPlan.operationalMemory?.summary?.assetReferences ?? 0,
    searchHits: searchHits.length,
    databaseUsed: learningPlan.databaseUsed,
    rawFileContentStoredInAppDatabase: learningPlan.rawFileContentStoredInAppDatabase,
    rawFileContentStoredInLocalIndex: extracted.some(
      (item) => item.extractionStatus === "ready" && item.extractedText.length > 0,
    ),
    absolutePathsStoredInLocalIndex: files.length > 0,
    selectedSourceScopeOnly: true,
    sensitiveValueRedactions: extracted.filter((item) => item.sensitiveValueRedacted).length,
    originalFilesMoved: false,
    originalFilesDeleted: false,
  };
  const indexPayload = {
    createdAt: new Date().toISOString(),
    generationId: learningPlan.sessionId,
    summary,
    learningPlan,
    operationalMemory: learningPlan.operationalMemory,
    automationRecommendations,
    ...(teammateProfileDraft ? { teammateProfileDraft } : {}),
    learnedOutputDrafts,
    learnedDraftWorkItems,
    extracted,
    failures,
    ingested,
    searchHits,
  };
  const jsonPath = path.join(indexRoot, "modycrew-document-index.json");
  const reportPath = path.join(indexRoot, "modycrew-document-index.md");
  const workspaceIntelligence = await enqueueDocumentLearningPersistence(indexRoot, () =>
    persistDocumentLearningRuntimeSnapshot(
      {
        jsonPath,
        reportPath,
        indexPayload,
        WorkspaceIntelligenceEngine: ModyWorkspaceIntelligenceEngine,
        workspaceId,
        learningPlan,
        indexRoot,
        observedAt,
      },
      options,
    ),
  );
  // Publish review cards only after the index was saved successfully.
  const learnedDraftInboxResult = upsertLearnedDraftWorkItems(learnedDraftWorkItems, options);
  const centralWorkspaceIntelligence =
    workspaceIntelligence.centralWorkspaceIntelligence;
  const localWorkspaceIntelligenceCommitted =
    workspaceIntelligence.status === "workspace_intelligence_updated" &&
    workspaceIntelligence.persistence?.saved === true;
  const centralWorkspaceIntelligenceCommitted =
    centralWorkspaceIntelligence?.status === "workspace_intelligence_updated" &&
    centralWorkspaceIntelligence?.persistence?.saved === true;
  const continuousLearningCommitted =
    trustedSupervisorSnapshot &&
    localWorkspaceIntelligenceCommitted &&
    centralWorkspaceIntelligenceCommitted;
  const responseSummary = {
    ...summary,
    workspaceIntelligenceCycleCount: Number(workspaceIntelligence.cycleCount ?? 0),
    workspaceIntelligenceWorkSignals: workspaceIntelligence.workSignals.length,
    workspaceIntelligenceNewLearningSessions: workspaceIntelligence.newLearningSessionIds.length,
    workspaceIntelligenceStatus: workspaceIntelligence.status,
    ...(trustedSupervisorSnapshot
      ? { continuousLearningCommitted }
      : {}),
  };

  const response = {
    status:
      trustedSupervisorSnapshot && !continuousLearningCommitted
        ? "document_learning_continuous_commit_failed"
        : failures.length > 0
          ? "document_learning_indexed_with_warnings"
          : "document_learning_indexed",
    localStorageRoot,
    localIndexRoot: indexRoot,
    jsonPath,
    reportPath,
    summary: responseSummary,
    learningPlan,
    operationalMemory: learningPlan.operationalMemory,
    automationRecommendations,
    ...(teammateProfileDraft ? { teammateProfileDraft } : {}),
    learnedOutputDrafts,
    learnedDraftWorkItems,
    ...(learnedDraftInboxResult ? { learnedDraftInboxResult } : {}),
    extracted,
    failures,
    searchHits,
    workspaceIntelligence,
    ...(trustedSupervisorSnapshot
      ? {
          continuousLearningCommitted,
          snapshotApplied: continuousLearningCommitted,
          snapshotDigest: String(payload.snapshotDigest ?? ""),
          acceptedContentSha256s: continuousLearningCommitted
            ? files.map((file) => file.contentSha256).sort()
            : [],
        }
      : {}),
    rawSecretMaterialReturned: false,
    externalMutation: false,
    databaseUsed: false,
    rawFileContentStoredInAppDatabase: false,
    originalFilesMoved: false,
    originalFilesDeleted: false,
    userMessage:
      trustedSupervisorSnapshot && !continuousLearningCommitted
        ? "지속 학습 기억 저장이 완료되지 않아 다음 동기화에서 다시 시도합니다."
        : documentLearningWorkspaceIntelligenceMessage(
            extracted.length,
            workspaceIntelligence,
          ),
  };

  const activityEvent = createDocumentLearningActivityEvent(response, payload);
  let activityAuditFile;
  if (typeof options.recordActivity === "function") {
    try {
      const activityResult = await options.recordActivity(activityEvent);
      activityAuditFile = activityResult?.auditFile;
    } catch {
      // 로컬 인덱스 생성 결과는 유지하고, 감사 이벤트 저장 실패만 무시합니다.
    }
  }

  return {
    ...response,
    activityEvent,
    ...(activityAuditFile ? { activityAuditFile } : {}),
  };
}

async function persistDocumentLearningRuntimeSnapshot(input, options) {
  await writeDocumentLearningTextAtomically(
    input.jsonPath,
    `${JSON.stringify(input.indexPayload, null, 2)}\n`,
  );
  await writeDocumentLearningTextAtomically(
    input.reportPath,
    renderDocumentLearningReport(input.indexPayload),
  );
  let localResult;
  try {
    const updateWorkspaceIntelligence =
      options.updateWorkspaceIntelligenceFromLearningPlan ??
      updateWorkspaceIntelligenceFromLearningPlan;
    localResult = await updateWorkspaceIntelligence(
      {
        WorkspaceIntelligenceEngine: input.WorkspaceIntelligenceEngine,
        workspaceId: input.workspaceId,
        learningPlan: input.learningPlan,
        indexRoot: input.indexRoot,
        observedAt: input.observedAt,
      },
      options.workspaceIntelligenceOptions ?? {},
    );
  } catch (error) {
    localResult = {
      status: "workspace_intelligence_update_failed",
      workspaceId: input.workspaceId,
      cycleCount: 0,
      newLearningSessionIds: [],
      newAgentRunIds: [],
      workSignals: [],
      assignments: [],
      improvementProposals: [],
      skillProposals: [],
      recoveryReason: "",
      persistence: {
        saved: false,
        atomicReplace: false,
        recoverableBackup: false,
        bytesWritten: 0,
      },
      rawFileContentStored: false,
      rawSecretsStored: false,
      absolutePathsStoredInState: false,
      externalMutation: false,
      errorMessage: cleanOneLine(error instanceof Error ? error.message : String(error)).slice(0, 240),
    };
  }

  let centralWorkspaceIntelligence = {
    status: "workspace_intelligence_central_memory_not_configured",
    newLearningSessionIds: [],
    externalMutation: false,
  };
  if (options.app || options.localMemoryRoot) {
    const updateCentralWorkspaceIntelligence =
      options.updateLocalMemoryWorkspaceIntelligence ??
      updateLocalMemoryWorkspaceIntelligence;
    centralWorkspaceIntelligence = await updateCentralWorkspaceIntelligence(
      {
        WorkspaceIntelligenceEngine: input.WorkspaceIntelligenceEngine,
        workspaceId: input.workspaceId,
        learningPlan: input.learningPlan,
        observedAt: input.observedAt,
      },
      {
        ...options,
        WorkspaceIntelligenceEngine: input.WorkspaceIntelligenceEngine,
      },
    );
  }
  return {
    ...localResult,
    centralWorkspaceIntelligence,
  };
}

async function enqueueDocumentLearningPersistence(indexRoot, task) {
  const key = path.resolve(indexRoot).toLocaleLowerCase("ko-KR");
  const previous = documentLearningPersistenceQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  documentLearningPersistenceQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (documentLearningPersistenceQueues.get(key) === current) {
      documentLearningPersistenceQueues.delete(key);
    }
  }
}

async function writeDocumentLearningTextAtomically(filePath, content) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  const backupPath = `${tempPath}.previous`;
  let handle;
  let backupCreated = false;
  let backupMustBeRetained = false;
  await fs.mkdir(directory, { recursive: true });
  try {
    handle = await fs.open(tempPath, "wx", 0o600);
    await handle.writeFile(String(content), "utf8");
    if (typeof handle.sync === "function") await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (error) {
      if (!["EEXIST", "EPERM", "EACCES"].includes(error?.code)) throw error;
    }
    try {
      await fs.copyFile(filePath, backupPath);
      backupCreated = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await fs.rm(filePath, { force: true });
    try {
      await fs.rename(tempPath, filePath);
    } catch (error) {
      if (backupCreated) {
        try { await fs.copyFile(backupPath, filePath); }
        catch (restoreError) {
          backupMustBeRetained = true;
          throw new AggregateError([error, restoreError], `Index replace and restore failed; backup retained at ${backupPath}`);
        }
      }
      throw error;
    }
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    if (!backupMustBeRetained) await fs.rm(backupPath, { force: true }).catch(() => undefined);
  }
}

async function createDocumentLearningFolderPlan(payload = {}, options = {}) {
  const files = normalizeDocumentLearningFiles(payload).filter((file) => file.selected !== false);
  const localStorageRoot = sanitizeDocumentLearningRoot(payload.localStorageRoot, options);
  if (files.length === 0) {
    return {
      status: "document_learning_no_files",
      localStorageRoot,
      rawSecretMaterialReturned: false,
      externalMutation: false,
      userMessage: "정리 계획을 만들 파일이 없습니다.",
    };
  }

  const {
    ModyLocalDocumentLearningPlanner,
    createDocumentAutomationRecommendations,
    createLearnedOutputDraft,
  } = await loadDomainRuntime(options);
  const planner = new ModyLocalDocumentLearningPlanner();
  const learningPlan = planner.createPlan({
    workspaceId: payload.workspaceId ?? "local_desktop",
    localStorageRoot,
    selectedKinds: Array.isArray(payload.selectedKinds) ? payload.selectedKinds.map(String) : undefined,
    files,
  });
  const indexRoot = path.resolve(learningPlan.localIndexRoot);
  const planPath = path.join(indexRoot, "modycrew-folder-plan.json");
  const reportPath = path.join(indexRoot, "modycrew-folder-plan.md");
  const automationRecommendations = createDocumentAutomationRecommendations(learningPlan);
  const duplicateReviewCandidates = createDuplicateReviewCandidates(learningPlan.filePlans);
  const strategyChoices = createFolderPlanStrategyChoices({
    filePlans: learningPlan.filePlans,
    groups: learningPlan.groups,
    duplicateReviewCandidates,
  });
  const draftResult = createReviewableLearningDrafts(automationRecommendations, learningPlan, createLearnedOutputDraft, "폴더 정리 계획과 함께 검토할 업무 초안을 만들어줘");
  const learnedOutputDrafts = draftResult.drafts;
  if (draftResult.warnings.length) {
    return {
      status: "document_learning_drafts_need_review", localStorageRoot, localIndexRoot: indexRoot,
      groups: learningPlan.groups, filePlans: learningPlan.filePlans, automationRecommendations,
      learnedOutputDrafts, draftWarnings: draftResult.warnings, saved: false,
      rawSecretMaterialReturned: false, externalMutation: false,
      originalFilesMoved: false, originalFilesDeleted: false,
      userMessage: "일부 초안의 자료 근거를 확인하지 못했습니다. 기존 기록을 보존하기 위해 이번 정리 계획은 저장하지 않았습니다. 자료를 다시 확인해 주세요.",
    };
  }
  const learnedDraftWorkItems = createLearnedDraftApprovalWorkItems({
    createdAt: new Date().toISOString(),
    localStorageRoot,
    indexRoot,
    reportPath,
    learnedOutputDrafts,
  });
  await fs.mkdir(indexRoot, { recursive: true });
  const folderPayload = {
    createdAt: new Date().toISOString(),
    localStorageRoot,
    localIndexRoot: indexRoot,
    groups: learningPlan.groups,
    filePlans: learningPlan.filePlans,
    operationalMemory: learningPlan.operationalMemory,
    strategyChoices,
    duplicateReviewCandidates,
    automationRecommendations,
    learnedOutputDrafts,
    learnedDraftWorkItems,
    externalMutation: false,
    originalFilesMoved: false,
    originalFilesDeleted: false,
    userApprovalRequiredBeforeMoveOrDelete: true,
    ...(payload.mailAttachmentContext ? { mailAttachmentContext: sanitizeMailAttachmentContext(payload.mailAttachmentContext) } : {}),
  };
  const planText = `${JSON.stringify(folderPayload, null, 2)}\n`;
  await fs.writeFile(planPath, planText, "utf8");
  await fs.writeFile(reportPath, renderDocumentFolderPlanReport(folderPayload), "utf8");
  await persistDocumentLearningControlReceipt({
    kind: "folder_plan",
    controlPath: planPath,
    controlText: planText,
    localStorageRoot,
    indexRoot,
    authorizedPaths: learningPlan.filePlans.map((filePlan) => filePlan.absolutePath),
  }, options);
  const learnedDraftInboxResult = upsertLearnedDraftWorkItems(learnedDraftWorkItems, options);
  return {
    status: "document_learning_folder_plan_created",
    localStorageRoot,
    localIndexRoot: indexRoot,
    planPath,
    reportPath,
    groups: learningPlan.groups,
    filePlans: learningPlan.filePlans,
    operationalMemory: learningPlan.operationalMemory,
    strategyChoices,
    duplicateReviewCandidates,
    automationRecommendations,
    learnedOutputDrafts,
    learnedDraftWorkItems,
    ...(learnedDraftInboxResult ? { learnedDraftInboxResult } : {}),
    rawSecretMaterialReturned: false,
    externalMutation: false,
    originalFilesMoved: false,
    originalFilesDeleted: false,
    userMessage: `${learningPlan.groups.length}개 로컬 폴더 정리 계획을 저장했습니다. 원본 파일은 이동하지 않았습니다.`,
  };
}

async function stageMailAttachmentsFolderPlan(event, payload = {}, options = {}) {
  const importedFiles = await importMailAttachmentFiles(payload, options);
  const localStorageRoot = sanitizeDocumentLearningRoot(payload.localStorageRoot, options);
  rememberDocumentLearningPaths(event, {
    sourceFiles: importedFiles.map((file) => file.absolutePath),
  }, options);
  if (importedFiles.length === 0) {
    return {
      status: "mail_attachment_folder_plan_no_files",
      localStorageRoot,
      attachmentCount: 0,
      localCopyOnly: true,
      rawSecretMaterialReturned: false,
      externalMutation: false,
      originalMailMutation: false,
      originalAttachmentDeleted: false,
      externalShareBeforeApproval: false,
      originalFilesMoved: false,
      originalFilesDeleted: false,
      userApprovalRequiredBeforeMoveOrDelete: true,
      userMessage: "정리할 메일 첨부 파일이 아직 없습니다. 첨부 다운로드가 끝난 뒤 다시 시도해 주세요.",
    };
  }

  const mailAttachmentContext = sanitizeMailAttachmentContext(payload);
  const plan = await createDocumentLearningFolderPlan({
    ...payload,
    localStorageRoot,
    selectedKinds: Array.isArray(payload.selectedKinds)
      ? payload.selectedKinds
      : ["email", "pdf", "excel", "word", "image"],
    files: importedFiles,
    mailAttachmentContext,
  }, options);
  // 새 계획이 저장되지 않았다면 같은 위치의 이전 계획을 미리보지 않는다.
  if (plan.status !== "document_learning_folder_plan_created") return plan;
  if (!plan.planPath) throw new Error("저장된 정리 계획 경로를 확인하지 못했습니다.");
  const preview = await previewDocumentLearningFolderPlan(event, {
    localStorageRoot,
    planPath: plan.planPath,
  }, options);
  if (preview.status !== "document_learning_folder_plan_previewed") return preview;

  return {
    status: "mail_attachment_folder_plan_staged",
    localStorageRoot,
    localIndexRoot: plan.localIndexRoot,
    planPath: plan.planPath,
    reportPath: plan.reportPath,
    attachmentCount: importedFiles.length,
    stagedWorkItem: preview.stagedWorkItem,
    addedInboxItemsCount: preview.addedInboxItemsCount ?? 0,
    safetySummary: preview.safetySummary,
    collisionSummary: preview.collisionSummary,
    exclusionSummary: preview.exclusionSummary,
    nextUserChoice: preview.nextUserChoice,
    mailAttachmentContext,
    plan,
    preview,
    rawSecretMaterialReturned: false,
    externalMutation: false,
    localCopyOnly: true,
    originalMailMutation: false,
    originalAttachmentDeleted: false,
    externalShareBeforeApproval: false,
    originalFilesMoved: false,
    originalFilesDeleted: false,
    userApprovalRequiredBeforeMoveOrDelete: true,
    userMessage: `메일 첨부 ${importedFiles.length}개를 정리 승인 카드로 올렸습니다. 원본 이동/삭제는 아직 실행하지 않았습니다.`,
  };
}

async function previewDocumentLearningFolderPlan(event, payload = {}, options = {}) {
  const localStorageRoot = sanitizeDocumentLearningRoot(payload.localStorageRoot, options);
  const indexRoot = path.resolve(localStorageRoot, "ModyCrew_Local_Index");
  const planPath = path.join(indexRoot, "modycrew-folder-plan.json");
  const reportPath = path.join(indexRoot, "modycrew-folder-plan.md");

  if (!existsSync(planPath)) {
    return {
      status: "document_learning_folder_plan_missing",
      localStorageRoot,
      localIndexRoot: indexRoot,
      planPath,
      reportPath,
      operations: [],
      operationCount: 0,
      rawSecretMaterialReturned: false,
      externalMutation: false,
      originalFilesMoved: false,
      originalFilesDeleted: false,
      userApprovalRequiredBeforeMoveOrDelete: true,
      userMessage: "아직 확인할 폴더 정리 계획이 없습니다. 먼저 폴더 정리 후보를 만들어 주세요.",
    };
  }

  const plan = await readJsonFile(planPath);
  const filePlans = Array.isArray(plan.filePlans) ? plan.filePlans : [];
  await assertDocumentLearningPlanAuthorized(
    event,
    planPath,
    plan,
    filePlans,
    localStorageRoot,
    indexRoot,
    options,
  );
  const duplicateReviewCandidates = Array.isArray(plan.duplicateReviewCandidates) ? plan.duplicateReviewCandidates : [];
  const strategyChoices = Array.isArray(plan.strategyChoices) ? plan.strategyChoices : createFolderPlanStrategyChoices({
    filePlans,
    groups: Array.isArray(plan.groups) ? plan.groups : [],
    duplicateReviewCandidates,
  });
  const operations = filePlans
    .map((filePlan, index) => {
      const sourcePath = String(filePlan.absolutePath ?? "");
      const fileName = String(filePlan.fileName ?? (path.basename(sourcePath) || `file-${index + 1}`));
      const targetFolder = String(filePlan.targetFolder ?? indexRoot);
      return {
        id: String(filePlan.id ?? `folder_plan_operation_${index + 1}`),
        operation: "copy_to_organized_index",
        fileName,
        sourcePath,
        targetPath: path.join(targetFolder, fileName),
        targetFolder,
        strategyId: plan.selectedStrategyId ?? "default_category_period",
        approvalRequiredBeforeApply: true,
        status: "dry_run_only",
      };
    })
    .filter((operation) => operation.sourcePath && operation.targetPath)
    .slice(0, 120);
  const applySafetyReview = createFolderPlanApplySafetyReview({
    operations,
    duplicateReviewCandidates,
    localStorageRoot,
  });
  const safetyReceipt = createFolderPlanSafetyReceipt({
    phase: "preview",
    collisionPolicy: "rename",
    excludedOperationCount: 0,
    excludedPathKeywords: [],
    appliedCount: 0,
    skipped: [],
    operationCount: operations.length,
  });
  const stagedWorkItem = createFolderPlanApprovalWorkItem({
    createdAt: new Date().toISOString(),
    localStorageRoot,
    indexRoot,
    planPath,
    reportPath,
    groups: Array.isArray(plan.groups) ? plan.groups : [],
    strategyChoices,
    duplicateReviewCandidates,
    operations,
    applySafetyReview,
    operationCount: filePlans.length,
    mailAttachmentContext: sanitizeMailAttachmentContext(plan.mailAttachmentContext),
  });
  const inboxResult =
    typeof options.upsertInboxItem === "function"
      ? options.upsertInboxItem(stagedWorkItem, { createdAt: stagedWorkItem.receivedAt })
      : null;

  return {
    status: "document_learning_folder_plan_previewed",
    localStorageRoot,
    localIndexRoot: indexRoot,
    planPath,
    reportPath,
    groups: Array.isArray(plan.groups) ? plan.groups : [],
    strategyChoices,
    duplicateReviewCandidates,
    applySafetyReview,
    operations,
    operationCount: filePlans.length,
    stagedWorkItem,
    safetyReceipt,
    safetySummary: safetyReceipt.safetySummary,
    collisionSummary: safetyReceipt.collisionSummary,
    exclusionSummary: safetyReceipt.exclusionSummary,
    rollbackGuide: safetyReceipt.rollbackGuide,
    nextUserChoice: safetyReceipt.nextUserChoice,
    ...(inboxResult ? { inboxResult, addedInboxItemsCount: inboxResult.addedCount ?? 0 } : {}),
    rawSecretMaterialReturned: false,
    externalMutation: false,
    originalFilesMoved: false,
    originalFilesDeleted: false,
    userApprovalRequiredBeforeMoveOrDelete: true,
    userMessage: `${filePlans.length}개 파일 정리 작업을 dry-run으로 확인했습니다. 원본 이동과 삭제는 실행하지 않았습니다.`,
  };
}

const documentLearningControlReceiptVersion = 2;
const documentLearningControlReceiptTtlMs = 8 * 60 * 60 * 1000;
const documentLearningControlReceiptClockSkewMs = 5 * 60 * 1000;

function documentLearningSha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function documentLearningPathDigest(value) {
  return documentLearningSha256(documentLearningPathKey(value));
}

function getDocumentLearningReceiptNowMs(options = {}) {
  const candidate = typeof options.now === "function" ? options.now() : Date.now();
  if (candidate instanceof Date && Number.isFinite(candidate.getTime())) {
    return candidate.getTime();
  }
  const numericCandidate = Number(candidate);
  if (Number.isFinite(numericCandidate)) return numericCandidate;
  const parsedCandidate = new Date(candidate).getTime();
  return Number.isFinite(parsedCandidate) ? parsedCandidate : Date.now();
}

function getDocumentLearningControlReceiptRoot(options = {}) {
  const baseRoot =
    options.app && typeof options.app.getPath === "function"
      ? options.app.getPath("userData")
      : path.resolve(options.localMemoryRoot || getDocumentLearningDefaultRoot(options));
  return path.join(baseRoot, "document-learning-control-receipts");
}

function getDocumentLearningControlReceiptPath(kind, controlPath, options = {}) {
  const receiptId = documentLearningSha256(
    `${String(kind)}\u0000${documentLearningPathKey(controlPath)}`,
  );
  return path.join(getDocumentLearningControlReceiptRoot(options), `${receiptId}.json`);
}

function createDocumentLearningControlReceipt(input = {}) {
  return {
    version: documentLearningControlReceiptVersion,
    kind: String(input.kind ?? ""),
    issuedAtMs: Number(input.issuedAtMs),
    expiresAtMs: Number(input.expiresAtMs),
    controlPathDigest: documentLearningPathDigest(input.controlPath),
    contentSha256: documentLearningSha256(input.controlText),
    localStorageRootDigest: documentLearningPathDigest(input.localStorageRoot),
    indexRootDigest: documentLearningPathDigest(input.indexRoot),
    authorizedPathDigests: Array.from(
      new Set(
        (Array.isArray(input.authorizedPaths) ? input.authorizedPaths : [])
          .map((value) => documentLearningPathDigest(value))
          .filter(Boolean),
      ),
    ).sort(),
  };
}

async function persistDocumentLearningControlReceipt(input = {}, options = {}) {
  const issuedAtMs = getDocumentLearningReceiptNowMs(options);
  const receipt = createDocumentLearningControlReceipt({
    ...input,
    issuedAtMs,
    expiresAtMs: issuedAtMs + documentLearningControlReceiptTtlMs,
  });
  const receiptPath = getDocumentLearningControlReceiptPath(
    receipt.kind,
    input.controlPath,
    options,
  );
  await writeDocumentLearningTextAtomically(
    receiptPath,
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

async function verifyDocumentLearningControlReceipt(input = {}, options = {}) {
  const receiptPath = getDocumentLearningControlReceiptPath(
    input.kind,
    input.controlPath,
    options,
  );
  let stored;
  try {
    stored = JSON.parse(await fs.readFile(receiptPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing" };
    return { status: "invalid" };
  }
  const issuedAtMs = Number(stored?.issuedAtMs);
  const expiresAtMs = Number(stored?.expiresAtMs);
  const nowMs = getDocumentLearningReceiptNowMs(options);
  if (
    stored?.version !== documentLearningControlReceiptVersion ||
    !Number.isFinite(issuedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    issuedAtMs > nowMs + documentLearningControlReceiptClockSkewMs ||
    expiresAtMs <= nowMs ||
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > documentLearningControlReceiptTtlMs
  ) {
    return { status: "invalid" };
  }
  let controlText;
  try {
    controlText = await fs.readFile(input.controlPath, "utf8");
  } catch {
    return { status: "invalid" };
  }
  const expected = createDocumentLearningControlReceipt({
    ...input,
    controlText,
    issuedAtMs,
    expiresAtMs,
  });
  const normalizedStored = {
    version: stored?.version,
    kind: stored?.kind,
    issuedAtMs,
    expiresAtMs,
    controlPathDigest: stored?.controlPathDigest,
    contentSha256: stored?.contentSha256,
    localStorageRootDigest: stored?.localStorageRootDigest,
    indexRootDigest: stored?.indexRootDigest,
    authorizedPathDigests: Array.isArray(stored?.authorizedPathDigests)
      ? stored.authorizedPathDigests.map(String)
      : [],
  };
  if (JSON.stringify(normalizedStored) !== JSON.stringify(expected)) {
    return { status: "invalid" };
  }
  return {
    status: "verified",
    authorizedPathDigests: new Set(expected.authorizedPathDigests),
  };
}

async function isDocumentLearningControlReceiptSenderAuthorized(event, options = {}) {
  if (options.trustedFileSelection === true) return true;
  if (typeof options.isAuthorizedDocumentLearningControlReceiptSender !== "function") {
    return false;
  }
  try {
    return (
      (await options.isAuthorizedDocumentLearningControlReceiptSender(event)) === true
    );
  } catch {
    return false;
  }
}

function isDocumentLearningPathAuthorizedByControl(
  event,
  value,
  options = {},
  authorization = {},
) {
  if (authorization.status === "verified") {
    return authorization.authorizedPathDigests?.has(documentLearningPathDigest(value)) === true;
  }
  return isAuthorizedDocumentLearningPath(event, value, options);
}
function assertExpectedDocumentLearningControlPath(actualPath, expectedPath, label) {
  if (documentLearningPathKey(actualPath) !== documentLearningPathKey(expectedPath)) {
    throw new Error(`${label} 파일은 확인된 ModyCrew 로컬 인덱스에서만 사용할 수 있습니다.`);
  }
}

function assertStoredDocumentLearningScope(record, localStorageRoot, indexRoot, label) {
  const storedLocalStorageRoot = String(record?.localStorageRoot ?? "").trim();
  const storedIndexRoot = String(record?.localIndexRoot ?? "").trim();
  if (
    !path.isAbsolute(storedLocalStorageRoot) ||
    !path.isAbsolute(storedIndexRoot) ||
    documentLearningPathKey(storedLocalStorageRoot) !== documentLearningPathKey(localStorageRoot) ||
    documentLearningPathKey(storedIndexRoot) !== documentLearningPathKey(indexRoot)
  ) {
    throw new Error(`${label}의 저장 범위가 현재 확인된 로컬 기억 위치와 다릅니다.`);
  }
}

async function assertDocumentLearningPlanAuthorized(
  event,
  planPath,
  plan,
  filePlans,
  localStorageRoot,
  indexRoot,
  options = {},
) {
  assertStoredDocumentLearningScope(plan, localStorageRoot, indexRoot, "정리 계획");
  const sourcePaths = [];
  for (const filePlan of Array.isArray(filePlans) ? filePlans : []) {
    const rawSourcePath = String(filePlan?.absolutePath ?? "").trim();
    if (!path.isAbsolute(rawSourcePath) || !sanitizeDocumentLearningFilePath(rawSourcePath)) {
      throw new Error("정리 계획에 올바르지 않은 원본 파일 경로가 포함되어 실행하지 않았습니다.");
    }
    sourcePaths.push(rawSourcePath);
  }
  const receiptAuthorization = await verifyDocumentLearningControlReceipt({
    kind: "folder_plan",
    controlPath: planPath,
    localStorageRoot,
    indexRoot,
    authorizedPaths: sourcePaths,
  }, options);
  if (receiptAuthorization.status === "invalid") {
    throw new Error("정리 계획의 main-process 무결성 확인이 실패하여 실행하지 않았습니다.");
  }
  if (receiptAuthorization.status === "verified") {
    if (!(await isDocumentLearningControlReceiptSenderAuthorized(event, options))) {
      throw new Error("\uc815\ub9ac \uacc4\ud68d\uc740 main \ud504\ub85c\uc138\uc2a4\uac00 \ub4f1\ub85d\ud55c ModyCrew \ucc3d\uc5d0\uc11c\ub9cc \uc2e4\ud589\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.");
    }
    return receiptAuthorization;
  }
  for (const sourcePath of sourcePaths) {
    if (!isAuthorizedDocumentLearningPath(event, sourcePath, options)) {
      throw new Error("정리 계획에 사용자가 선택하지 않은 원본 파일이 포함되어 실행하지 않았습니다.");
    }
  }
  return { status: "grant" };
}
async function assertDocumentLearningRevertManifestAuthorized(
  event,
  manifestPath,
  manifest,
  applied,
  localStorageRoot,
  indexRoot,
  options = {},
) {
  assertStoredDocumentLearningScope(manifest, localStorageRoot, indexRoot, "되돌리기 기록");
  const organizedRoot = String(manifest?.organizedRoot ?? "").trim();
  if (!path.isAbsolute(organizedRoot) || !isPathInside(organizedRoot, localStorageRoot)) {
    throw new Error("되돌리기 기록의 정리 폴더가 확인된 로컬 기억 범위 밖입니다.");
  }
  const undoPaths = [];
  for (const operation of Array.isArray(applied) ? applied : []) {
    const currentPath = String(operation?.targetPath ?? "").trim();
    const undoPath = String(operation?.undoPath ?? operation?.sourcePath ?? "").trim();
    if (
      !path.isAbsolute(currentPath) ||
      !sanitizeDocumentLearningFilePath(currentPath) ||
      !isPathInside(currentPath, organizedRoot)
    ) {
      throw new Error("되돌리기 기록에 정리 폴더 밖의 현재 파일이 포함되어 실행하지 않았습니다.");
    }
    if (!path.isAbsolute(undoPath) || !sanitizeDocumentLearningFilePath(undoPath)) {
      throw new Error("되돌리기 기록에 올바르지 않은 복원 위치가 포함되어 실행하지 않았습니다.");
    }
    undoPaths.push(undoPath);
  }
  const receiptAuthorization = await verifyDocumentLearningControlReceipt({
    kind: "folder_apply_manifest",
    controlPath: manifestPath,
    localStorageRoot,
    indexRoot,
    authorizedPaths: undoPaths,
  }, options);
  if (receiptAuthorization.status === "invalid") {
    throw new Error("되돌리기 기록의 main-process 무결성 확인이 실패하여 실행하지 않았습니다.");
  }
  if (
    receiptAuthorization.status === "verified" &&
    !(await isDocumentLearningControlReceiptSenderAuthorized(event, options))
  ) {
    throw new Error("\ub418\ub3cc\ub9ac\uae30\ub294 main \ud504\ub85c\uc138\uc2a4\uac00 \ub4f1\ub85d\ud55c ModyCrew \ucc3d\uc5d0\uc11c\ub9cc \uc2e4\ud589\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.");
  }
  if (receiptAuthorization.status !== "verified") {
    for (const undoPath of undoPaths) {
      if (!isAuthorizedDocumentLearningPath(event, undoPath, options)) {
        throw new Error("되돌리기 기록에 사용자가 선택하지 않은 복원 위치가 포함되어 실행하지 않았습니다.");
      }
    }
  }
  return {
    organizedRoot: path.resolve(organizedRoot),
    authorization: receiptAuthorization.status === "verified"
      ? receiptAuthorization
      : { status: "grant" },
  };
}
async function confirmDocumentLearningFolderMutation(event, options = {}, input = {}) {
  if (options.trustedFileSelection === true) return true;
  return showDocumentLearningPermissionDialog(event, options, {
    title: input.title,
    message: input.message,
    detail: input.detail,
    primaryLabel: input.primaryLabel,
  });
}
async function applyDocumentLearningFolderPlan(event, payload = {}, options = {}) {
  const localStorageRoot = sanitizeDocumentLearningRoot(payload.localStorageRoot, options);
  const indexRoot = path.resolve(localStorageRoot, "ModyCrew_Local_Index");
  const expectedPlanPath = path.join(indexRoot, "modycrew-folder-plan.json");
  const planPath = path.resolve(String(payload.planPath || path.join(indexRoot, "modycrew-folder-plan.json")));
  assertExpectedDocumentLearningControlPath(planPath, expectedPlanPath, "정리 계획");
  const confirmation = cleanOneLine(payload.confirmationText || payload.confirmation || "");
  const collisionPolicy = sanitizeFolderPlanCollisionPolicy(payload.collisionPolicy);
  const excludedOperationIds = new Set(Array.isArray(payload.excludedOperationIds) ? payload.excludedOperationIds.map(String) : []);
  const excludedPathKeywords = sanitizeExclusionKeywords(payload.excludedPathKeywords);

  if (!confirmation.includes("정리 적용 승인") && payload.finalApproval !== true) {
    return {
      status: "document_learning_folder_plan_apply_needs_approval",
      localStorageRoot,
      localIndexRoot: indexRoot,
      planPath,
      rawSecretMaterialReturned: false,
      externalMutation: false,
      originalFilesMoved: false,
      originalFilesDeleted: false,
      userApprovalRequiredBeforeMoveOrDelete: true,
      userMessage: "실제 파일 이동은 '정리 적용 승인' 확인 문구 또는 최종 승인 후에만 실행합니다.",
    };
  }

  if (!existsSync(planPath)) {
    return {
      status: "document_learning_folder_plan_missing",
      localStorageRoot,
      localIndexRoot: indexRoot,
      planPath,
      rawSecretMaterialReturned: false,
      externalMutation: false,
      originalFilesMoved: false,
      originalFilesDeleted: false,
      userApprovalRequiredBeforeMoveOrDelete: true,
      userMessage: "적용할 폴더 정리 계획이 없습니다.",
    };
  }

  const plan = await readJsonFile(planPath);
  const filePlans = Array.isArray(plan.filePlans) ? plan.filePlans : [];
  const planAuthorization = await assertDocumentLearningPlanAuthorized(
    event,
    planPath,
    plan,
    filePlans,
    localStorageRoot,
    indexRoot,
    options,
  );
  const mailAttachmentContext = plan.mailAttachmentContext
    ? sanitizeMailAttachmentContext(plan.mailAttachmentContext)
    : null;
  const isMailAttachmentPlan = Boolean(mailAttachmentContext);
  const organizedRoot = sanitizeOrganizedFolderRoot(payload.organizedRoot, localStorageRoot);
  const operations = createFolderPlanApplyOperations(filePlans, organizedRoot);
  const nativeApproved = await confirmDocumentLearningFolderMutation(event, options, {
    title: "폴더 정리 최종 확인",
    message: `${operations.length}개 파일을 실제로 이동할까요?`,
    detail: `대상 위치: ${organizedRoot}\n현재 정리 계획의 파일만 이동하며 삭제하거나 덮어쓰지 않습니다.`,
    primaryLabel: "이동 실행",
  });
  if (!nativeApproved) {
    return {
      status: "document_learning_folder_plan_apply_cancelled",
      localStorageRoot,
      localIndexRoot: indexRoot,
      planPath,
      rawSecretMaterialReturned: false,
      externalMutation: false,
      originalFilesMoved: false,
      originalFilesDeleted: false,
      userApprovalRequiredBeforeMoveOrDelete: true,
      userMessage: "운영체제 확인창에서 폴더 정리 실행을 취소했습니다.",
    };
  }
  const executionPlanAuthorization = await assertDocumentLearningPlanAuthorized(
    event,
    planPath,
    plan,
    filePlans,
    localStorageRoot,
    indexRoot,
    options,
  );
  const applied = [];
  const skipped = [];
  const unknownMoves = [];

  for (const operation of operations) {
    let renameAttempted = false;
    let attemptedTargetPath = "";
    try {
      if (!isDocumentLearningPathAuthorizedByControl(event, operation.sourcePath, options, executionPlanAuthorization)) {
        skipped.push({ ...operation, status: "skipped_source_scope_changed" });
        continue;
      }
      if (!existsSync(operation.sourcePath)) {
        skipped.push({ ...operation, status: "skipped_source_missing" });
        continue;
      }
      const sourceStats = await fs.lstat(operation.sourcePath);
      if (!sourceStats.isFile()) {
        skipped.push({ ...operation, status: "skipped_source_not_regular_file" });
        continue;
      }
      if (excludedOperationIds.has(operation.id) || matchesExcludedPathKeyword(operation, excludedPathKeywords)) {
        skipped.push({ ...operation, status: "skipped_by_user_exclusion" });
        continue;
      }
      if (!isPathInside(operation.targetPath, organizedRoot)) {
        skipped.push({ ...operation, status: "skipped_target_outside_tidy_root" });
        continue;
      }

      if (existsSync(operation.targetPath) && collisionPolicy === "skip") {
        skipped.push({ ...operation, status: "skipped_collision_existing_target" });
        continue;
      }
      const safeTargetPath = collisionPolicy === "rename" ? await nextAvailablePath(operation.targetPath) : operation.targetPath;
      if (!isPathInside(safeTargetPath, organizedRoot)) {
        skipped.push({ ...operation, status: "skipped_target_scope_changed" });
        continue;
      }
      await fs.mkdir(path.dirname(safeTargetPath), { recursive: true });
      attemptedTargetPath = safeTargetPath;
      renameAttempted = true;
      await fs.rename(operation.sourcePath, safeTargetPath);
      applied.push({
        ...operation,
        targetPath: safeTargetPath,
        status: "moved",
        undoPath: operation.sourcePath,
      });
    } catch (error) {
      // A rejected rename is not proof that the filesystem made no change.
      // Stop rather than retrying or applying later operations automatically.
      if (renameAttempted) {
        unknownMoves.push({ ...operation, targetPath: attemptedTargetPath, status: "move_outcome_unknown" });
        break;
      }
      skipped.push({
        ...operation,
        status: "skipped_error",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (unknownMoves.length) {
    return {
      status: "document_learning_folder_plan_apply_outcome_unknown",
      localStorageRoot, localIndexRoot: indexRoot, planPath, organizedRoot, collisionPolicy,
      applied, skipped, unknownMoves, appliedCount: applied.length, skippedCount: skipped.length,
      recordPersistence: { manifest: "not_attempted", report: "not_attempted", receipt: "not_attempted" },
      rawSecretMaterialReturned: false,
      externalMutation: applied.length > 0 ? true : null,
      originalFilesMoved: applied.length > 0 ? true : null,
      originalFilesDeleted: false,
      userApprovalRequiredBeforeMoveOrDelete: true,
      userMessage: `확인된 이동 ${applied.length}건이 있고 다른 파일의 이동 결과는 확인되지 않았습니다. 기록은 저장되지 않았으니 원본과 대상 위치를 확인하고 같은 작업을 자동으로 다시 실행하지 마세요.`,
    };
  }

  const recordPersistence = { manifest: "not_attempted", report: "not_attempted", receipt: "not_attempted" };
  try {
  const manifest = {
    id: `folder_tidy_apply_${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    localStorageRoot,
    localIndexRoot: indexRoot,
    planPath,
    organizedRoot,
    collisionPolicy,
    excludedOperationCount: excludedOperationIds.size,
    excludedPathKeywords,
    appliedCount: applied.length,
    skippedCount: skipped.length,
    applied,
    skipped,
    canRevert: applied.length > 0,
    revertRequiresApprovalText: "정리 되돌리기 승인",
    rawSecretMaterialReturned: false,
    externalMutation: applied.length > 0,
    originalFilesMoved: applied.length > 0,
    originalFilesDeleted: false,
    overwritePerformed: false,
    userApprovalRequiredBeforeMoveOrDelete: true,
    ...(isMailAttachmentPlan
      ? {
          mailAttachmentOrganizerApply: {
            contract: "downloaded_mail_attachment_to_folder_plan_final_apply",
            sourceContract: "downloaded_mail_attachment_to_folder_plan_approval",
            sourceKind: "mail_attachment_local_copy",
            connectorId: mailAttachmentContext.connectorId,
            providerId: mailAttachmentContext.providerId,
            sourceMessageId: mailAttachmentContext.messageId,
            messageSubject: mailAttachmentContext.messageSubject,
            appliedLocalCopyCount: applied.length,
            skippedLocalCopyCount: skipped.length,
            localCopyOnly: true,
            originalMailMutation: false,
            originalAttachmentDeleted: false,
            externalShareBeforeApproval: false,
            originalShareCreated: false,
            finalApprovalEvidence: confirmation || (payload.finalApproval === true ? "finalApproval:true" : ""),
          },
        }
      : {}),
  };
  const safetyReceipt = createFolderPlanSafetyReceipt({
    phase: "apply",
    collisionPolicy,
    excludedOperationCount: excludedOperationIds.size,
    excludedPathKeywords,
    appliedCount: applied.length,
    skipped,
    operationCount: operations.length,
  });
  manifest.safetyReceipt = safetyReceipt;
  manifest.safetySummary = safetyReceipt.safetySummary;
  manifest.collisionSummary = safetyReceipt.collisionSummary;
  manifest.exclusionSummary = safetyReceipt.exclusionSummary;
  manifest.rollbackGuide = safetyReceipt.rollbackGuide;
  manifest.nextUserChoice = safetyReceipt.nextUserChoice;
  const manifestPath = path.join(indexRoot, "modycrew-folder-apply-manifest.json");
  const reportPath = path.join(indexRoot, "modycrew-folder-apply-report.md");
  await fs.mkdir(indexRoot, { recursive: true });
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  recordPersistence.manifest = "unconfirmed";
  await fs.writeFile(manifestPath, manifestText, "utf8");
  recordPersistence.manifest = "completed";
  recordPersistence.report = "unconfirmed";
  await fs.writeFile(reportPath, renderFolderPlanApplyReport(manifest), "utf8");
  recordPersistence.report = "completed";
  recordPersistence.receipt = "unconfirmed";
  await persistDocumentLearningControlReceipt({
    kind: "folder_apply_manifest",
    controlPath: manifestPath,
    controlText: manifestText,
    localStorageRoot,
    indexRoot,
    authorizedPaths: applied.map((operation) => operation.undoPath),
  }, options);
  recordPersistence.receipt = "completed";

  return {
    status: "document_learning_folder_plan_applied",
    localStorageRoot,
    localIndexRoot: indexRoot,
    planPath,
    manifestPath,
    reportPath,
    organizedRoot,
    collisionPolicy,
    applied,
    skipped,
    appliedCount: applied.length,
    skippedCount: skipped.length,
    safetyReceipt,
    safetySummary: safetyReceipt.safetySummary,
    collisionSummary: safetyReceipt.collisionSummary,
    exclusionSummary: safetyReceipt.exclusionSummary,
    rollbackGuide: safetyReceipt.rollbackGuide,
    nextUserChoice: safetyReceipt.nextUserChoice,
    rawSecretMaterialReturned: false,
    externalMutation: applied.length > 0,
    originalFilesMoved: applied.length > 0,
    originalFilesDeleted: false,
    overwritePerformed: false,
    userApprovalRequiredBeforeMoveOrDelete: true,
    ...(manifest.mailAttachmentOrganizerApply
      ? { mailAttachmentOrganizerApply: manifest.mailAttachmentOrganizerApply }
      : {}),
    userMessage: `${applied.length}개 파일을 ModyCrew_정리로 이동했습니다. 삭제/덮어쓰기는 실행하지 않았고 되돌리기 기록을 저장했습니다.`,
  };
  } catch {
    // Do not expose a fixed-path manifest as a verified recovery record when
    // any part of its persistence failed or may have completed ambiguously.
    return {
      status: "document_learning_folder_plan_apply_record_unconfirmed",
      localStorageRoot, localIndexRoot: indexRoot, planPath, organizedRoot, collisionPolicy,
      applied, skipped, appliedCount: applied.length, skippedCount: skipped.length,
      recordPersistence,
      rawSecretMaterialReturned: false,
      externalMutation: applied.length > 0,
      originalFilesMoved: applied.length > 0,
      originalFilesDeleted: false,
      userApprovalRequiredBeforeMoveOrDelete: true,
      userMessage: applied.length > 0
        ? `${applied.length}개 파일의 이동은 확인됐지만 되돌리기 기록 저장을 확인하지 못했습니다. 자동 되돌리기를 보장할 수 없으니 원본과 대상 위치를 확인하고 같은 작업을 다시 실행하지 마세요.`
        : "확인된 파일 이동은 없지만 정리 기록 저장을 확인하지 못했습니다. 원본과 대상 위치를 확인한 뒤 진행해 주세요.",
    };
  }
}

async function revertDocumentLearningFolderPlan(event, payload = {}, options = {}) {
  const localStorageRoot = sanitizeDocumentLearningRoot(payload.localStorageRoot, options);
  const indexRoot = path.resolve(localStorageRoot, "ModyCrew_Local_Index");
  const expectedManifestPath = path.join(indexRoot, "modycrew-folder-apply-manifest.json");
  const manifestPath = path.resolve(String(payload.manifestPath || path.join(indexRoot, "modycrew-folder-apply-manifest.json")));
  assertExpectedDocumentLearningControlPath(manifestPath, expectedManifestPath, "되돌리기 기록");
  const confirmation = cleanOneLine(payload.confirmationText || payload.confirmation || "");

  if (!confirmation.includes("정리 되돌리기 승인") && payload.finalApproval !== true) {
    return {
      status: "document_learning_folder_plan_revert_needs_approval",
      localStorageRoot,
      localIndexRoot: indexRoot,
      manifestPath,
      rawSecretMaterialReturned: false,
      externalMutation: false,
      originalFilesMoved: false,
      originalFilesDeleted: false,
      userApprovalRequiredBeforeMoveOrDelete: true,
      userMessage: "정리 되돌리기는 '정리 되돌리기 승인' 확인 문구 또는 최종 승인 후에만 실행합니다.",
    };
  }

  if (!existsSync(manifestPath)) {
    return {
      status: "document_learning_folder_apply_manifest_missing",
      localStorageRoot,
      localIndexRoot: indexRoot,
      manifestPath,
      rawSecretMaterialReturned: false,
      externalMutation: false,
      originalFilesMoved: false,
      originalFilesDeleted: false,
      userMessage: "되돌릴 폴더 정리 적용 기록이 없습니다.",
    };
  }

  const manifest = await readJsonFile(manifestPath);
  const applied = Array.isArray(manifest.applied) ? manifest.applied : [];
  const {
    organizedRoot: manifestOrganizedRoot,
    authorization: manifestAuthorization,
  } = await assertDocumentLearningRevertManifestAuthorized(
    event,
    manifestPath,
    manifest,
    applied,
    localStorageRoot,
    indexRoot,
    options,
  );
  const nativeApproved = await confirmDocumentLearningFolderMutation(event, options, {
    title: "폴더 정리 되돌리기 최종 확인",
    message: `${applied.length}개 파일을 원래 위치로 되돌릴까요?`,
    detail: `현재 정리 위치: ${manifestOrganizedRoot}\n기존 파일은 덮어쓰지 않고 충돌 시 새 이름을 사용합니다.`,
    primaryLabel: "되돌리기 실행",
  });
  if (!nativeApproved) {
    return {
      status: "document_learning_folder_plan_revert_cancelled",
      localStorageRoot,
      localIndexRoot: indexRoot,
      manifestPath,
      rawSecretMaterialReturned: false,
      externalMutation: false,
      originalFilesMoved: false,
      originalFilesDeleted: false,
      userApprovalRequiredBeforeMoveOrDelete: true,
      userMessage: "운영체제 확인창에서 폴더 정리 되돌리기를 취소했습니다.",
    };
  }
  const {
    authorization: executionManifestAuthorization,
  } = await assertDocumentLearningRevertManifestAuthorized(
    event,
    manifestPath,
    manifest,
    applied,
    localStorageRoot,
    indexRoot,
    options,
  );
  const reverted = [];
  const skipped = [];

  for (const operation of applied.slice().reverse()) {
    const currentPath = path.resolve(String(operation.targetPath || ""));
    const undoPath = path.resolve(String(operation.undoPath || operation.sourcePath || ""));
    try {
      if (!isDocumentLearningPathAuthorizedByControl(event, undoPath, options, executionManifestAuthorization)) {
        skipped.push({ ...operation, status: "skipped_restore_scope_changed" });
        continue;
      }
      if (!isPathInside(currentPath, manifestOrganizedRoot)) {
        skipped.push({ ...operation, status: "skipped_current_outside_tidy_root" });
        continue;
      }
      if (!existsSync(currentPath)) {
        skipped.push({ ...operation, status: "skipped_target_missing" });
        continue;
      }
      const currentStats = await fs.lstat(currentPath);
      if (!currentStats.isFile()) {
        skipped.push({ ...operation, status: "skipped_target_not_regular_file" });
        continue;
      }
      const safeUndoPath = await nextAvailablePath(undoPath);
      await fs.mkdir(path.dirname(safeUndoPath), { recursive: true });
      await fs.rename(currentPath, safeUndoPath);
      reverted.push({
        ...operation,
        revertedPath: safeUndoPath,
        status: "reverted",
      });
    } catch (error) {
      skipped.push({
        ...operation,
        status: "skipped_error",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const revertManifest = {
    id: `folder_tidy_revert_${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    localStorageRoot,
    localIndexRoot: indexRoot,
    applyManifestPath: manifestPath,
    revertedCount: reverted.length,
    skippedCount: skipped.length,
    reverted,
    skipped,
    rawSecretMaterialReturned: false,
    externalMutation: reverted.length > 0,
    originalFilesMoved: reverted.length > 0,
    originalFilesDeleted: false,
    overwritePerformed: false,
  };
  const safetyReceipt = createFolderPlanSafetyReceipt({
    phase: "revert",
    collisionPolicy: manifest.collisionPolicy,
    excludedOperationCount: Number(manifest.excludedOperationCount ?? 0),
    excludedPathKeywords: Array.isArray(manifest.excludedPathKeywords) ? manifest.excludedPathKeywords : [],
    appliedCount: reverted.length,
    skipped,
    operationCount: applied.length,
  });
  revertManifest.safetyReceipt = safetyReceipt;
  revertManifest.safetySummary = safetyReceipt.safetySummary;
  revertManifest.collisionSummary = safetyReceipt.collisionSummary;
  revertManifest.exclusionSummary = safetyReceipt.exclusionSummary;
  revertManifest.rollbackGuide = safetyReceipt.rollbackGuide;
  revertManifest.nextUserChoice = safetyReceipt.nextUserChoice;
  const revertManifestPath = path.join(indexRoot, "modycrew-folder-revert-manifest.json");
  await fs.writeFile(revertManifestPath, `${JSON.stringify(revertManifest, null, 2)}\n`, "utf8");

  return {
    status: "document_learning_folder_plan_reverted",
    localStorageRoot,
    localIndexRoot: indexRoot,
    manifestPath,
    revertManifestPath,
    reverted,
    skipped,
    revertedCount: reverted.length,
    skippedCount: skipped.length,
    safetyReceipt,
    safetySummary: safetyReceipt.safetySummary,
    collisionSummary: safetyReceipt.collisionSummary,
    exclusionSummary: safetyReceipt.exclusionSummary,
    rollbackGuide: safetyReceipt.rollbackGuide,
    nextUserChoice: safetyReceipt.nextUserChoice,
    rawSecretMaterialReturned: false,
    externalMutation: reverted.length > 0,
    originalFilesMoved: reverted.length > 0,
    originalFilesDeleted: false,
    overwritePerformed: false,
    userMessage: `${reverted.length}개 파일을 원래 위치로 되돌렸습니다. 삭제/덮어쓰기는 실행하지 않았습니다.`,
  };
}

function createFolderPlanStrategyChoices(input = {}) {
  const filePlans = Array.isArray(input.filePlans) ? input.filePlans : [];
  const groups = Array.isArray(input.groups) ? input.groups : [];
  const duplicateReviewCandidates = Array.isArray(input.duplicateReviewCandidates)
    ? input.duplicateReviewCandidates
    : [];
  const periodCount = new Set(filePlans.map((item) => cleanOneLine(item.periodLabel)).filter(Boolean)).size;
  const kindCount = new Set(filePlans.map((item) => cleanOneLine(item.kind ?? item.category)).filter(Boolean)).size;

  return [
    {
      id: "default_category_period",
      label: "기본 정리 방식",
      settingPage: "folder-plan/default-category-period",
      detail: `기간과 문서 유형 기준으로 ${groups.length}개 폴더 후보를 만듭니다.`,
      selected: true,
      externalMutation: false,
      requiresApprovalBeforeMove: true,
    },
    {
      id: "project_first",
      label: "프로젝트별 분류",
      settingPage: "folder-plan/project-first",
      detail: "파일명과 상위 폴더의 업무 단어를 기준으로 프로젝트별 정리 후보만 따로 검토합니다.",
      selected: false,
      externalMutation: false,
      requiresApprovalBeforeMove: true,
    },
    {
      id: "date_first",
      label: "날짜별 분류",
      settingPage: "folder-plan/date-first",
      detail: `수정일과 파일명 날짜 기준으로 ${periodCount || 1}개 기간 축을 따로 검토합니다.`,
      selected: false,
      externalMutation: false,
      requiresApprovalBeforeMove: true,
    },
    {
      id: "file_type_first",
      label: "파일 종류별 분류",
      settingPage: "folder-plan/file-type-first",
      detail: `문서, 표, PDF, 이미지 등 ${kindCount || 1}개 파일 종류 축을 따로 검토합니다.`,
      selected: false,
      externalMutation: false,
      requiresApprovalBeforeMove: true,
    },
    {
      id: "manual_duplicate_review",
      label: "중복 후보 수동 검토",
      settingPage: "folder-plan/manual-duplicate-review",
      detail: `${duplicateReviewCandidates.length}개 중복 후보를 삭제 없이 keep/candidate로만 분리해 검토합니다.`,
      selected: false,
      reviewMode: "manual_review_only",
      externalMutation: false,
      requiresApprovalBeforeMove: true,
      userApprovalRequiredBeforeDelete: true,
    },
  ];
}

function createDuplicateReviewCandidates(filePlans = []) {
  const groups = new Map();
  for (const filePlan of Array.isArray(filePlans) ? filePlans : []) {
    const key = duplicateReviewKey(filePlan);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(filePlan);
    groups.set(key, list);
  }

  return Array.from(groups.values())
    .filter((items) => items.length > 1)
    .map((items, index) => {
      const sorted = items.slice().sort(compareDuplicateReviewFiles);
      const primary = sorted[0] ?? {};
      return {
        id: `duplicate_review_${index + 1}`,
        reviewMode: "manual_review_only",
        fileName: cleanOneLine(primary.fileName ?? path.basename(String(primary.absolutePath ?? ""))),
        reason: "파일명, 확장자, 크기 또는 수정일이 유사합니다. 자동 삭제하지 않고 수동 검토 후보로만 표시합니다.",
        candidateCount: sorted.length,
        keepRecommendation: "newest_modified_at_or_user_select",
        externalMutation: false,
        originalFilesDeleted: false,
        userApprovalRequiredBeforeDelete: true,
        files: sorted.map((item, fileIndex) => ({
          fileName: cleanOneLine(item.fileName ?? path.basename(String(item.absolutePath ?? ""))),
          absolutePath: String(item.absolutePath ?? ""),
          sizeBytes: Number.isFinite(Number(item.sizeBytes)) ? Number(item.sizeBytes) : null,
          modifiedAt: cleanOneLine(item.modifiedAt ?? ""),
          reviewRole: fileIndex === 0 ? "keep_candidate" : "duplicate_candidate",
        })),
      };
    })
    .slice(0, 40);
}

function duplicateReviewKey(filePlan = {}) {
  const fileName = String(filePlan.fileName ?? path.basename(String(filePlan.absolutePath ?? ""))).trim();
  if (!fileName) return "";
  const parsed = path.parse(fileName);
  const normalizedBase = parsed.name
    .toLocaleLowerCase("ko-KR")
    .replace(/\s*(복사본|사본|복사|copy)\s*/gu, " ")
    .replace(/\s*[\(\[]\d+[\)\]]\s*$/u, "")
    .replace(/\s+-\s*\d+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  const extension = parsed.ext.toLocaleLowerCase("ko-KR");
  return `${normalizedBase}${extension}`;
}

function compareDuplicateReviewFiles(left, right) {
  const leftModified = Date.parse(left?.modifiedAt ?? "");
  const rightModified = Date.parse(right?.modifiedAt ?? "");
  if (Number.isFinite(leftModified) && Number.isFinite(rightModified) && leftModified !== rightModified) {
    return rightModified - leftModified;
  }
  const leftPath = String(left?.absolutePath ?? left?.fileName ?? "");
  const rightPath = String(right?.absolutePath ?? right?.fileName ?? "");
  return leftPath.localeCompare(rightPath, "ko-KR");
}

function sanitizeOrganizedFolderRoot(value, localStorageRoot) {
  const requested = typeof value === "string" && value.trim() ? path.resolve(value.trim()) : "";
  const fallback = path.join(path.resolve(localStorageRoot), "ModyCrew_정리");
  if (!requested) return fallback;
  return isPathInside(requested, localStorageRoot) ? requested : fallback;
}

function createFolderPlanApplyOperations(filePlans = [], organizedRoot) {
  return (Array.isArray(filePlans) ? filePlans : [])
    .map((filePlan, index) => {
      const sourcePath = path.resolve(String(filePlan.absolutePath ?? ""));
      const fileName = sanitizeMoveFileName(filePlan.fileName || path.basename(sourcePath) || `file-${index + 1}`);
      const periodLabel = sanitizePathSegment(filePlan.periodLabel || "미분류");
      const category = sanitizePathSegment(filePlan.category || "general_document");
      const targetFolder = path.join(path.resolve(organizedRoot), periodLabel, category);
      return {
        id: String(filePlan.id ?? `folder_plan_apply_${index + 1}`),
        operation: "move_to_modycrew_tidy_folder",
        fileName,
        sourcePath,
        targetFolder,
        targetPath: path.join(targetFolder, fileName),
        approvalRequiredBeforeApply: true,
        originalFilesDeleted: false,
        overwriteAllowed: false,
      };
    })
    .filter((operation) => operation.sourcePath && operation.targetPath)
    .slice(0, 250);
}

function createFolderPlanApplySafetyReview(input = {}) {
  const operations = Array.isArray(input.operations) ? input.operations : [];
  const duplicateReviewCandidates = Array.isArray(input.duplicateReviewCandidates) ? input.duplicateReviewCandidates : [];
  const localStorageRoot = path.resolve(String(input.localStorageRoot || ""));
  const targetFolders = Array.from(new Set(operations.map((operation) => operation.targetFolder).filter(Boolean)));
  return {
    confirmationTextRequired: "정리 적용 승인",
    revertConfirmationTextRequired: "정리 되돌리기 승인",
    defaultOrganizedRoot: localStorageRoot ? path.join(localStorageRoot, "ModyCrew_정리") : "ModyCrew_정리",
    collisionPolicies: [
      {
        id: "rename",
        label: "이름 바꿔 보관",
        detail: "같은 이름이 있으면 -modycrew-1 같은 꼬리표를 붙여 덮어쓰지 않습니다.",
        selected: true,
      },
      {
        id: "skip",
        label: "충돌 파일 건너뛰기",
        detail: "같은 이름이 있으면 해당 파일 이동을 건너뛰고 manifest에 사유를 남깁니다.",
        selected: false,
      },
    ],
    exclusionOptions: [
      "파일별 제외",
      "폴더명/파일명 키워드 제외",
      "중복 후보는 삭제 없이 수동 검토",
      "적용 후 manifest 기반 되돌리기",
    ],
    targetFolderCount: targetFolders.length,
    duplicateReviewCount: duplicateReviewCandidates.length,
    operationCount: operations.length,
    externalMutationBeforeApproval: false,
    originalFilesDeleted: false,
    overwriteAllowed: false,
  };
}

function createFolderPlanSafetyReceipt(input = {}) {
  const phase = String(input.phase || "preview");
  const collisionPolicy = sanitizeFolderPlanCollisionPolicy(input.collisionPolicy);
  const excludedOperationCount = Number(input.excludedOperationCount ?? 0);
  const excludedPathKeywords = Array.isArray(input.excludedPathKeywords) ? input.excludedPathKeywords : [];
  const skipped = Array.isArray(input.skipped) ? input.skipped : [];
  const operationCount = Number(input.operationCount ?? 0);
  const changedCount = Number(input.appliedCount ?? 0);
  const collisionSkipCount = skipped.filter((item) => item?.status === "skipped_collision_existing_target").length;
  const userExcludedCount = skipped.filter((item) => item?.status === "skipped_by_user_exclusion").length;
  const safetySummary = "원본 삭제와 기존 파일 덮어쓰기는 비활성화되어 있습니다.";
  const collisionSummary =
    collisionPolicy === "skip"
      ? collisionSkipCount
        ? `겹치는 대상 ${collisionSkipCount}개는 덮어쓰지 않고 건너뛰었습니다.`
        : "겹치는 대상은 덮어쓰지 않고 건너뛰도록 설정했습니다."
      : "겹치는 대상은 덮어쓰지 않고 새 이름으로 이동하도록 설정했습니다.";
  const exclusionSummary =
    excludedOperationCount || excludedPathKeywords.length || userExcludedCount
      ? `사용자 제외 기준 ${excludedOperationCount + excludedPathKeywords.length}개를 적용했고 ${userExcludedCount}개 작업을 제외했습니다.`
      : "사용자 제외 기준은 없고 중복 후보는 수동 검토로 남깁니다.";
  const rollbackGuide =
    phase === "preview"
      ? "적용 전에는 원본 변경이 없고, 적용 후에는 manifest 기록이 있을 때만 '정리 되돌리기 승인'으로 되돌립니다."
      : "되돌리기는 적용 기록 파일이 있을 때만 '정리 되돌리기 승인' 확인 후 실행합니다.";
  const nextUserChoice =
    phase === "preview"
      ? "오피스 승인함에서 겹침 처리, 제외 단어를 확인한 뒤 실행하기, 고쳐달라고 하기, 보류하기 중 하나를 선택하세요."
      : phase === "revert"
        ? "되돌리기 기록을 확인하거나 새 폴더 정리 후보를 다시 만들 수 있습니다."
        : "적용 기록을 확인한 뒤 필요하면 정리 되돌리기 승인을 선택하세요.";
  return {
    phase,
    operationCount,
    changedCount,
    collisionPolicy,
    collisionSkipCount,
    userExcludedCount,
    excludedOperationCount,
    excludedPathKeywordCount: excludedPathKeywords.length,
    safetySummary,
    collisionSummary,
    exclusionSummary,
    rollbackGuide,
    nextUserChoice,
    originalFilesDeleted: false,
    overwritePerformed: false,
  };
}

function sanitizeFolderPlanCollisionPolicy(value) {
  const policy = String(value ?? "").trim();
  return policy === "skip" ? "skip" : "rename";
}

function sanitizeExclusionKeywords(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanOneLine(item).toLocaleLowerCase("ko-KR"))
    .filter((item) => item.length >= 2)
    .slice(0, 30);
}

function matchesExcludedPathKeyword(operation, keywords) {
  if (!keywords.length) return false;
  const haystack = [operation.fileName, operation.sourcePath, operation.targetPath, operation.targetFolder]
    .join(" ")
    .toLocaleLowerCase("ko-KR");
  return keywords.some((keyword) => haystack.includes(keyword));
}

function isPathInside(candidatePath, rootPath) {
  return isDocumentLearningPathInside(
    documentLearningPathKey(rootPath),
    documentLearningPathKey(candidatePath),
  );
}

async function nextAvailablePath(targetPath) {
  const parsed = path.parse(targetPath);
  let candidate = targetPath;
  let index = 1;
  while (existsSync(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}-modycrew-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function sanitizeMoveFileName(value) {
  const fileName = String(value ?? "modycrew-file")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return fileName || "modycrew-file";
}

function sanitizePathSegment(value) {
  const segment = String(value ?? "미분류")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return segment || "미분류";
}

function createFolderPlanApprovalWorkItem(input) {
  const strategyChoices = Array.isArray(input.strategyChoices) ? input.strategyChoices : [];
  const duplicateReviewCandidates = Array.isArray(input.duplicateReviewCandidates) ? input.duplicateReviewCandidates : [];
  const applySafetyReview = input.applySafetyReview ?? {};
  const mailAttachmentContext = sanitizeMailAttachmentContext(input.mailAttachmentContext);
  const isMailAttachmentPlan = mailAttachmentContext.sourceKind === "mail_attachment";
  const operationPreview = input.operations
    .slice(0, 6)
    .map((operation, index) => `${index + 1}. ${operation.fileName} -> ${operation.targetFolder}`)
    .join("\n");
  const strategyPreview = strategyChoices
    .slice(0, 6)
    .map((strategy, index) => `${index + 1}. ${strategy.label}: ${strategy.detail}`)
    .join("\n");
  const duplicatePreview = duplicateReviewCandidates
    .slice(0, 5)
    .map((candidate, index) => `${index + 1}. ${candidate.fileName} (${candidate.candidateCount}개, ${candidate.reviewMode})`)
    .join("\n");
  const title = isMailAttachmentPlan
    ? `메일 첨부 정리 승인 대기: ${input.operationCount}개 파일`
    : `폴더 정리 승인 대기: ${input.operationCount}개 파일`;
  const folderPlanLabel = userFacingFolderPlanLabel();
  const approvalRecordLabel = userFacingFolderPlanApprovalRecordLabel();
  return {
    id: `tidy-folder-plan-${createHash("sha1").update(input.planPath).digest("hex").slice(0, 10)}`,
    title,
    source: "local_file",
    sourceLabel: isMailAttachmentPlan ? "메일 첨부 정리" : folderPlanLabel,
    senderLabel: isMailAttachmentPlan ? mailAttachmentContext.senderPreview || "메일 첨부" : "로컬 폴더 정리",
    body: [
      ...(isMailAttachmentPlan
        ? [
            `메일 제목: ${mailAttachmentContext.messageSubject || "확인 필요"}`,
            `보낸 사람: ${mailAttachmentContext.senderPreview || "확인 필요"}`,
            `연결: ${mailAttachmentContext.connectorId || mailAttachmentContext.providerId || "메일함"}`,
          ]
        : []),
      `저장 위치: ${input.localStorageRoot}`,
      `정리 계획: ${input.planPath}`,
      `보고서: ${input.reportPath}`,
      `정리 그룹: ${input.groups.length}개`,
      `dry-run 작업: ${input.operationCount}개`,
      `정리 방식 후보: ${strategyChoices.length}개`,
      `중복 검토 후보: ${duplicateReviewCandidates.length}개`,
      `적용 확인 문구: ${applySafetyReview.confirmationTextRequired ?? "정리 적용 승인"}`,
      `되돌리기 확인 문구: ${applySafetyReview.revertConfirmationTextRequired ?? "정리 되돌리기 승인"}`,
      "",
      "정리 방식 선택",
      strategyPreview || "정리 방식 후보 없음",
      "",
      "중복 후보 수동 검토",
      duplicatePreview || "중복 후보 없음 - 삭제 검토도 실행하지 않습니다.",
      "",
      "대표 작업",
      operationPreview || "대표 작업 없음",
      "",
      "안전 경계",
      "- 이 카드는 승인 대기 상태만 만듭니다.",
      ...(isMailAttachmentPlan
        ? [
            "- 메일 첨부는 내려받은 로컬 사본만 정리 후보로 다룹니다.",
            "- 원본 메일/첨부 삭제, 외부 공유, 덮어쓰기는 실행하지 않습니다.",
          ]
        : []),
      "- 승인해도 원본 이동/삭제는 실행하지 않고 승인 기록과 산출물만 저장합니다.",
      "- 실제 파일 정리는 별도의 최종 적용 단계에서 사용자 확인 문구, 제외 범위, 충돌 처리 방식을 다시 받아야 합니다.",
    ].join("\n"),
    summary: isMailAttachmentPlan
      ? `메일 첨부 ${input.operationCount}개 정리 계획을 dry-run으로 확인했습니다. 실제 이동/정리 전 사용자 승인과 최종 적용 단계가 필요합니다.`
      : `${input.operationCount}개 파일 정리 계획을 dry-run으로 확인했습니다. 실제 이동/삭제 전 사용자 승인과 최종 적용 단계가 필요합니다.`,
    status: "approval_pending",
    riskLabel: "medium",
    receivedAt: input.createdAt,
    sourceEvidence: {
      connectorId: "local-folder-index",
      providerId: "document_learning",
      mailboxLabel: isMailAttachmentPlan ? mailAttachmentContext.mailboxLabel || "메일 첨부" : "로컬 폴더",
      messageSubject: title,
      senderPreview: isMailAttachmentPlan ? mailAttachmentContext.senderPreview || "메일 첨부" : folderPlanLabel,
      receivedAt: input.createdAt,
      messageSnippet: `${input.groups.length}개 그룹, ${input.operationCount}개 dry-run 작업, ${strategyChoices.length}개 정리 방식, ${duplicateReviewCandidates.length}개 중복 후보. 원본 이동/삭제는 false.`,
      detectedIntentLabels: [
        isMailAttachmentPlan ? "메일 첨부 정리" : folderPlanLabel,
        "dry-run",
        "승인 필요",
        "정리 방식 선택",
        "중복 후보 수동 검토",
      ],
      approvalCandidateLabels: [
        isMailAttachmentPlan ? "첨부 정리 승인" : "정리 계획 승인",
        "기본/프로젝트/날짜/파일종류 방식 선택",
        "중복 삭제 전 수동 검토",
        "최종 적용 전 확인",
      ],
      ...(isMailAttachmentPlan
        ? {
            mailAttachmentOrganizer: {
              contract: "downloaded_mail_attachment_to_folder_plan_approval",
              connectorId: mailAttachmentContext.connectorId,
              providerId: mailAttachmentContext.providerId,
            sourceMessageId: mailAttachmentContext.messageId,
            messageSubject: mailAttachmentContext.messageSubject,
            attachmentCandidateCount: input.operationCount,
            downloadedAttachmentCount: input.operationCount,
            downloadStatus: "downloaded_local_copy_ready_for_folder_plan",
            stagingHandoffKind: "stage_mail_attachments_folder_plan",
            stagingHandoffContract: "downloaded_mail_attachment_to_folder_plan_approval",
            localCopyOnly: true,
            originalMailMutation: false,
            originalAttachmentDeleted: false,
            externalShareBeforeApproval: false,
          },
          }
        : {}),
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    },
    localFile: {
      path: input.reportPath,
      name: path.basename(input.reportPath),
      folder: path.basename(path.dirname(input.reportPath)),
      extension: "md",
      sizeLabel: isMailAttachmentPlan ? `${input.operationCount}개 첨부 후보` : `${input.operationCount}개 후보`,
      modifiedAt: input.createdAt,
      extractedTextStatus: "ready",
      preview: operationPreview || "정리 후보 보고서",
    },
    riskSignals: [
      {
        id: "tidy-folder-plan-final-confirmation",
        label: isMailAttachmentPlan ? "첨부 파일 정리 전 최종 확인" : "파일 이동/삭제 전 최종 확인",
        riskLabel: "medium",
        reason: isMailAttachmentPlan
          ? "메일 첨부 정리는 로컬 파일 위치를 바꿀 수 있으므로 dry-run, 제외 범위, 최종 확인 문구가 필요합니다."
          : "정리 계획 적용은 로컬 파일 위치를 바꿀 수 있으므로 dry-run, 제외 범위, 최종 확인 문구가 필요합니다.",
      },
    ],
    draft: {
      id: `tidy-folder-plan-${Date.now().toString(36)}:draft`,
      toneLabel: approvalRecordLabel,
      operationKind: "stage_approval",
      requiresApprovalBeforeSend: true,
      body: [
        approvalRecordLabel,
        "",
        `정리 계획: ${input.planPath}`,
        `보고서: ${input.reportPath}`,
        `정리 그룹: ${input.groups.length}개`,
        `dry-run 작업: ${input.operationCount}개`,
        `정리 방식 후보: ${strategyChoices.length}개`,
        `중복 후보 수동 검토: ${duplicateReviewCandidates.length}개`,
        `적용 확인 문구: ${applySafetyReview.confirmationTextRequired ?? "정리 적용 승인"}`,
        `충돌 처리 기본값: 이름 바꿔 보관`,
        "",
        "정리 방식",
        strategyPreview || "정리 방식 후보 없음",
        "",
        "중복 후보",
        duplicatePreview || "중복 후보 없음",
        "",
        "대표 작업",
        operationPreview || "대표 작업 없음",
        "",
        "승인 범위",
        "- 이 승인은 계획 검토 기록입니다.",
        "- 원본 파일 이동/삭제는 아직 실행하지 않습니다.",
        "- 실제 적용 단계에서는 사용자가 제외 폴더/파일, 충돌 처리, 최종 확인 문구를 다시 확인해야 합니다.",
      ].join("\n"),
    },
  };
}

function createLearnedDraftApprovalWorkItems(input) {
  return input.learnedOutputDrafts.slice(0, 6).map((draft) => {
    const operationKind = operationKindForLearnedDraft(draft.outputKind);
    const title = `학습 초안 승인 대기: ${draft.title}`;
    const draftPreview = compactDocumentLearningText(draft.markdown, 360);
    const sourcePreview = Array.isArray(draft.sourceLabels) && draft.sourceLabels.length
      ? draft.sourceLabels.slice(0, 3).join(" · ")
      : "학습 자료";

    return {
      id: `learned-output-draft-${createHash("sha1").update(draft.id).digest("hex").slice(0, 10)}`,
      title,
      source: "local_file",
      sourceLabel: draft.handoffLabel,
      senderLabel: "자료 학습",
      body: [
        `초안 종류: ${draft.outputKind}`,
        `학습 세션: ${draft.learningSessionId}`,
        `근거 자료: ${sourcePreview}`,
        `로컬 인덱스: ${input.indexRoot}`,
        `보고서: ${input.reportPath}`,
        "",
        "초안 미리보기",
        draftPreview,
        "",
        "안전 경계",
        `- 승인 확인: ${draft.approvalGateLabel}`,
        "- 이 카드는 승인 대기 상태만 만듭니다.",
        "- 사용자가 수정/최종 승인하기 전에는 메일 발송, 캘린더 등록, 파일 공유, 발주 요청을 실행하지 않습니다.",
      ].join("\n"),
      summary: `${draft.handoffLabel}에서 검토할 ${draft.outputKind} 초안을 만들었습니다. ${draft.approvalGateLabel} 전까지 외부 실행은 잠겨 있습니다.`,
      status: "approval_pending",
      riskLabel: operationKind === "stage_approval" ? "medium" : "high",
      receivedAt: input.createdAt,
      sourceEvidence: {
        connectorId: "local-document-learning",
        providerId: "document_learning",
        mailboxLabel: "자료 학습",
        messageSubject: title,
        senderPreview: draft.handoffLabel,
        receivedAt: input.createdAt,
        messageSnippet: sourcePreview,
        draftPreview,
        detectedIntentLabels: [draft.outputKind, draft.handoffLabel, "학습 초안"],
        approvalCandidateLabels: [draft.approvalGateLabel, "사용자 수정/최종 승인 필요"],
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
      localFile: {
        path: input.reportPath,
        name: path.basename(input.reportPath),
        folder: path.basename(path.dirname(input.reportPath)),
        extension: "md",
        sizeLabel: `${draft.sourceLabels.length}개 근거`,
        modifiedAt: input.createdAt,
        extractedTextStatus: "ready",
        preview: draftPreview,
      },
      riskSignals: [
        {
          id: "learned-draft-external-execution-lock",
          label: "외부 실행 전 최종 승인",
          riskLabel: operationKind === "stage_approval" ? "medium" : "high",
          reason: `${draft.approvalGateLabel} 전까지 초안은 앱 내부 승인 카드에만 보관합니다.`,
        },
      ],
      draft: {
        id: `${draft.id}:approval-draft`,
        toneLabel: draft.handoffLabel,
        operationKind,
        requiresApprovalBeforeSend: true,
        body: draft.markdown,
      },
    };
  });
}

function upsertLearnedDraftWorkItems(items, options) {
  if (!items.length || typeof options.upsertInboxItem !== "function") return null;
  const results = items.map((item) => {
    try { return options.upsertInboxItem(item, { createdAt: item.receivedAt, preserveExisting: true }); }
    catch { return { status: "document_draft_save_unconfirmed", addedCount: 0 }; }
  });
  return {
    status: results.some((result) => Number(result?.addedCount ?? 0) !== 1) ? "learned_output_drafts_review_required" : "learned_output_drafts_staged",
    addedCount: results.reduce((total, result) => total + Number(result?.addedCount ?? 0), 0),
    updatedCount: results.reduce((total, result) => total + Number(result?.updatedCount ?? 0), 0),
    stagedItemIds: items.filter((_, index) => Number(results[index]?.addedCount ?? 0) === 1).map((item) => item.id),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function operationKindForLearnedDraft(outputKind) {
  if (outputKind === "mail_reply_draft") return "draft_reply";
  if (outputKind === "calendar_candidate") return "draft_calendar_event";
  return "stage_approval";
}

async function searchDocumentLearningIndex(payload = {}, options = {}) {
  const localStorageRoot = sanitizeDocumentLearningRoot(payload.localStorageRoot, options);
  const indexRoot = path.resolve(localStorageRoot, "ModyCrew_Local_Index");
  const jsonPath = path.join(indexRoot, "modycrew-document-index.json");
  const query = typeof payload.query === "string" ? payload.query.trim() : "";

  const indexPayload = await enqueueDocumentLearningPersistence(indexRoot, async () =>
    existsSync(jsonPath) ? readJsonFile(jsonPath) : undefined,
  );
  if (!indexPayload) {
    return {
      status: "document_learning_index_missing",
      localStorageRoot,
      localIndexRoot: indexRoot,
      results: [],
      rawSecretMaterialReturned: false,
      externalMutation: false,
      userMessage: "아직 검색할 로컬 자료 인덱스가 없습니다. 자료 탭에서 파일을 선택하고 학습을 먼저 실행하세요.",
    };
  }

  const searchable = Array.isArray(indexPayload.extracted) ? indexPayload.extracted : [];
  const normalizedQuery = query.toLocaleLowerCase("ko-KR");
  const queryTerms = normalizedQuery.split(/\s+/u).filter(Boolean);
  const results = searchable
    .map((item, index) => {
      const memory = findOperationalFileMemory(indexPayload.operationalMemory, item.id);
      const haystack = [
        item.fileName,
        item.absolutePath,
        item.preview,
        item.extractedText,
        memory?.materialType,
        memory?.completionState,
        memory?.retrievalRole,
        ...(memory?.reuseFor ?? []),
        ...(memory?.promptHints ?? []),
      ]
        .join(" ")
        .toLocaleLowerCase("ko-KR");
      const matchedTerms = queryTerms.filter((term) => haystack.includes(term));
      const score =
        queryTerms.length === 0
          ? (memory?.referencePriority ?? 0.5) + 1 / (index + 1)
          : matchedTerms.length / queryTerms.length +
            (String(item.fileName || "").toLocaleLowerCase("ko-KR").includes(normalizedQuery) ? 0.25 : 0) +
            ((memory?.referencePriority ?? 0) * 0.15);
      return {
        id: item.id || `indexed_doc_${index + 1}`,
        title: item.fileName || "로컬 문서",
        path: item.absolutePath || "",
        kind: documentLearningExtension(item.fileName || item.absolutePath || "") || "문서",
        summary: createDocumentLearningSnippet(item.extractedText || item.preview || "", queryTerms),
        score,
        matchedTerms,
        ...(memory ? {
          referencePriority: memory.referencePriority,
          retrievalRole: memory.retrievalRole,
          completionState: memory.completionState,
          materialType: memory.materialType,
        } : {}),
      };
    })
    .filter((item) => queryTerms.length === 0 || item.matchedTerms.length > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "ko-KR"));
  const limit = Math.min(Math.max(Math.floor(Number(payload.limit)) || (queryTerms.length === 0 ? 60 : 12), 1), 200);
  const offset = Number.isFinite(Number(payload.offset)) ? Math.max(0, Math.floor(Number(payload.offset))) : 0;
  const pageResults = results.slice(offset, offset + limit);

  return {
    status: "document_learning_index_searched",
    localStorageRoot,
    localIndexRoot: indexRoot,
    jsonPath,
    results: pageResults,
    count: pageResults.length,
    totalCount: results.length,
    offset,
    hasMore: offset + pageResults.length < results.length,
    query,
    rawSecretMaterialReturned: false,
    externalMutation: false,
    userMessage: results.length > 0 ? `${results.length}개 로컬 자료를 찾았습니다.` : "검색어와 일치하는 로컬 자료가 없습니다.",
  };
}

async function openDocumentLearningIndex(payload = {}, options = {}) {
  const shell = requireOption(options, "shell");
  const localStorageRoot = sanitizeDocumentLearningRoot(payload.localStorageRoot, options);
  const indexRoot = path.resolve(localStorageRoot, "ModyCrew_Local_Index");
  if (!existsSync(indexRoot)) {
    return {
      status: "document_learning_index_missing",
      localStorageRoot,
      localIndexRoot: indexRoot,
      externalMutation: false,
      userMessage: "열 로컬 자료 인덱스 폴더가 없습니다.",
    };
  }

  await shell.openPath(indexRoot);
  return {
    status: "document_learning_index_opened",
    localStorageRoot,
    localIndexRoot: indexRoot,
    externalMutation: false,
    userMessage: "로컬 자료 인덱스 폴더를 열었습니다.",
  };
}

function findOperationalFileMemory(operationalMemory, fileId) {
  if (!operationalMemory || !Array.isArray(operationalMemory.fileMemories)) return null;
  return operationalMemory.fileMemories.find((memory) => String(memory.fileId ?? "") === String(fileId ?? "")) ?? null;
}

async function revealLocalDocumentLearningPath(filePath, options = {}) {
  const shell = requireOption(options, "shell");
  const resolved = sanitizeDocumentLearningFilePath(filePath);
  if (!resolved || !existsSync(resolved)) {
    return {
      status: "document_learning_file_missing",
      externalMutation: false,
      userMessage: "표시할 로컬 파일이 없습니다.",
    };
  }
  if (typeof shell.showItemInFolder === "function") {
    await shell.showItemInFolder(resolved);
  } else {
    await shell.openPath(path.dirname(resolved));
  }
  return {
    status: "document_learning_folder_revealed",
    path: resolved,
    externalMutation: false,
    userMessage: "로컬 파일이 있는 폴더를 표시했습니다.",
  };
}

async function openLocalDocumentLearningPath(filePath, options = {}) {
  const shell = requireOption(options, "shell");
  const resolved = sanitizeDocumentLearningFilePath(filePath);
  if (!resolved || !existsSync(resolved)) {
    return {
      status: "document_learning_file_missing",
      externalMutation: false,
      userMessage: "열 수 있는 로컬 파일이 없습니다.",
    };
  }
  await shell.openPath(resolved);
  return {
    status: "document_learning_file_opened",
    path: resolved,
    externalMutation: false,
    userMessage: "로컬 파일 열기 요청을 보냈습니다.",
  };
}

async function describeDocumentLearningFile(filePath, index, source = {}) {
  const resolved = sanitizeDocumentLearningFilePath(filePath);
  if (!resolved) return null;
  const stats = await fs.stat(resolved);
  if (!stats.isFile()) return null;
  return {
    id: documentLearningFileId(resolved, index),
    name: path.basename(resolved),
    path: resolved,
    absolutePath: resolved,
    fileName: path.basename(resolved),
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    mimeType: documentLearningMimeTypeFor(resolved),
    selected: true,
    sourceFolderPath: source.sourceFolderPath,
    sourceFolderLabel: source.sourceFolderLabel,
    sourceKind: source.sourceKind,
  };
}

async function scanDocumentLearningFolder(folderPath, options = {}) {
  const root = path.resolve(folderPath);
  const maxFiles = Number(options.maxFiles ?? 200);
  const maxDepth = Number(options.maxDepth ?? 5);
  const sourceKind = String(options.sourceKind ?? "custom");
  const files = [];
  let skippedCount = 0;
  const stack = [{ dir: root, depth: 0 }];
  const ignoredDirectories = new Set([
    ".git",
    ".next",
    "node_modules",
    "$Recycle.Bin",
    "System Volume Information",
    "Windows",
    "Program Files",
    "Program Files (x86)",
    "ProgramData",
    "ModyCrew_Local_Index",
    "ModyCrew_Local_Data",
  ].map((name) => name.toLocaleLowerCase("en-US")));

  while (stack.length && files.length < maxFiles) {
    const current = stack.shift();
    if (!current) break;
    let entries = [];
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      skippedCount += 1;
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, "ko-KR"));
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const entryPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth >= maxDepth) {
          skippedCount += 1;
          continue;
        }
        if (ignoredDirectories.has(entry.name.toLocaleLowerCase("en-US"))) {
          skippedCount += 1;
          continue;
        }
        stack.push({ dir: entryPath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isSupportedDocumentLearningExtension(documentLearningExtension(entry.name))) continue;
      try {
        const file = await describeDocumentLearningFile(entryPath, files.length, {
          sourceFolderPath: root,
          sourceFolderLabel: path.basename(root) || root,
          sourceKind,
        });
        if (file) files.push(file);
      } catch {
        skippedCount += 1;
      }
    }
  }

  return { files, skippedCount };
}

async function extractLocalDocumentText(filePath) {
  const extension = documentLearningExtension(filePath);
  if (isImageDocumentLearningExtension(extension)) {
    const stats = await fs.stat(filePath);
    return normalizeExtractedDocumentText(
      [
        "[이미지 첨부]",
        `파일명: ${path.basename(filePath)}`,
        `확장자: ${extension || "unknown"}`,
        `크기: ${stats.size} bytes`,
        `수정일: ${stats.mtime.toISOString()}`,
        "현재 단계에서는 이미지를 로컬 첨부 자료로 인식하고 메타데이터를 저장합니다. 이미지 내용 판독/OCR은 비전 엔진 연결 후 실행합니다.",
      ].join("\n"),
    );
  }

  if (extension === "docx") {
    const mammoth = await loadMammoth();
    const result = await mammoth.extractRawText({ path: filePath });
    return normalizeExtractedDocumentText(result.value);
  }

  if (extension === "xlsx") {
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    return normalizeExtractedDocumentText(collectWorkbookLearningText(workbook));
  }

  if (extension === "pdf") {
    const buffer = await fs.readFile(filePath);
    const PDFParse = await loadPDFParse();
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return normalizeExtractedDocumentText(result.text);
    } finally {
      await parser.destroy();
    }
  }

  if (isPlainTextDocumentLearningExtension(extension)) {
    return normalizeExtractedDocumentText(await fs.readFile(filePath, "utf8"));
  }

  const stats = await fs.stat(filePath);
  return normalizeExtractedDocumentText(
    [
      "[첨부 파일]",
      `파일명: ${path.basename(filePath)}`,
      `확장자: ${extension || "unknown"}`,
      `크기: ${stats.size} bytes`,
      `수정일: ${stats.mtime.toISOString()}`,
      "이 파일 형식은 첨부와 로컬 기억 인덱스에는 보관되지만, 본문 파서는 아직 준비 중입니다.",
    ].join("\n"),
  );
}

function normalizeExtractedDocumentText(value) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, documentLearningExtractedTextMaxChars);
}

const documentLearningExtractedTextMaxChars = 120000;
// 학습에는 시트마다 앞쪽 5,000행이면 충분하다. 2만 행짜리 장부를 통째로 글로 바꾸느라
// 앱이 수백 ms 씩 멈췄고, 어차피 뒤쪽은 120,000자 제한에서 잘려 나갔다.
const documentLearningXlsxMaxRowsPerSheet = 5000;

function collectWorkbookLearningText(workbook) {
  const lines = [];
  let characterCount = 0;
  workbook.eachSheet((sheet) => {
    if (characterCount > documentLearningExtractedTextMaxChars) return;
    lines.push(`[${sheet.name}]`);
    let learnedRows = 0;
    let skippedRows = 0;
    sheet.eachRow((row) => {
      if (learnedRows >= documentLearningXlsxMaxRowsPerSheet || characterCount > documentLearningExtractedTextMaxChars) {
        skippedRows += 1;
        return;
      }
      const values = [];
      row.eachCell((cell) => values.push(String(cell.text ?? cell.value ?? "")));
      if (!values.length) return;
      const line = values.join(" | ");
      lines.push(line);
      characterCount += line.length + 1;
      learnedRows += 1;
    });
    if (skippedRows > 0 && learnedRows >= documentLearningXlsxMaxRowsPerSheet) {
      lines.push(`(이 시트는 앞쪽 ${documentLearningXlsxMaxRowsPerSheet.toLocaleString("ko-KR")}행까지만 학습했어요. 나머지 ${skippedRows.toLocaleString("ko-KR")}행은 원본 파일에 그대로 있어요.)`);
    }
  });
  return lines.join("\n");
}

function countReadyDocumentLearningExtractions(extracted = []) {
  return extracted.filter((item) => item.extractionStatus === "ready").length;
}

async function persistRendererFilePayload(file = {}, index = 0, sourceKind = "renderer", options = {}) {
  const dataBase64 = String(file.dataBase64 ?? "");
  if (!dataBase64) return "";
  const buffer = Buffer.from(dataBase64, "base64");
  if (!buffer.length || buffer.length > 25 * 1024 * 1024) return "";
  const extension = extensionForRendererFile(file);
  if (!isSupportedDocumentLearningExtension(extension)) return "";
  const importRoot = getRendererImportRoot(options);
  await fs.mkdir(importRoot, { recursive: true });
  const baseName = sanitizeImportFileName(file.fileName || file.name || `clipboard-${index + 1}.${extension}`);
  const fileName = baseName.includes(".") ? baseName : `${baseName}.${extension}`;
  const targetPath = path.join(importRoot, `${Date.now()}-${randomUUID()}-${index}-${fileName}`);
  await fs.writeFile(targetPath, buffer, { flag: "wx" });
  return targetPath;
}

function getRendererImportRoot(options = {}) {
  if (options.app && typeof options.app.getPath === "function") {
    return path.join(options.app.getPath("userData"), "renderer-attachments");
  }
  return path.join(os.tmpdir(), "ModyCrew", "renderer-attachments");
}

function extensionForRendererFile(file = {}) {
  const fromName = documentLearningExtension(file.fileName || file.name || "");
  if (fromName) return fromName;
  const mime = String(file.mimeType ?? "").toLowerCase();
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "text/plain") return "txt";
  if (mime === "text/markdown") return "md";
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("spreadsheet")) return "xlsx";
  if (mime.includes("wordprocessingml")) return "docx";
  if (mime.includes("presentationml")) return "pptx";
  return "bin";
}

function sanitizeRendererSourceKind(value) {
  const sourceKind = String(value ?? "").trim();
  return ["paste", "drop", "renderer", "mail_attachment"].includes(sourceKind) ? sourceKind : "renderer";
}

function sanitizeImportFileName(value) {
  const name = String(value ?? "clipboard-file")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return name || "clipboard-file";
}

function isTrustedDocumentLearningSupervisorSnapshot(payload = {}, options = {}) {
  return (
    options.trustedFileSelection === true &&
    options.trustedDocumentLearningSupervisorSnapshot === true &&
    payload?.trustedSupervisorSnapshot === true
  );
}

async function normalizeTrustedDocumentLearningSnapshotFiles(payload = {}) {
  const files = Array.isArray(payload.files) ? payload.files : [];
  const normalized = [];
  for (const [index, file] of files.entries()) {
    normalized.push(await normalizeTrustedDocumentLearningSnapshotFile(file, index));
  }
  return normalized.filter(Boolean);
}

async function normalizeTrustedDocumentLearningSnapshotFile(file, index) {
  const trustedContentBuffer = Buffer.isBuffer(file?.trustedContentBuffer)
    ? Buffer.from(file.trustedContentBuffer)
    : null;
  const contentSha256 = String(file?.contentSha256 ?? "");
  const sourceMetadata = file?.sourceMetadata && typeof file.sourceMetadata === "object" && !Array.isArray(file.sourceMetadata) ? file.sourceMetadata : {};
  const provenanceAbsolutePath = String(sourceMetadata.provenanceAbsolutePath ?? "");
  const fileName = String(file?.fileName || file?.name || `trusted-file-${index + 1}`).slice(0, 240);
  const relativePath = String(file?.relativePath ?? sourceMetadata.relativePath ?? "");
  if (!trustedContentBuffer || !/^[a-f0-9]{64}$/u.test(contentSha256)) return null;
  // 최대 50MB 묶음을 한 번에 해시하면 앱이 멈추므로 1MB 씩 나눠 확인한다(결과는 같다).
  if (await sha256InChunks(trustedContentBuffer) !== contentSha256) return null;
  if (!path.isAbsolute(provenanceAbsolutePath) || !relativePath || path.isAbsolute(relativePath)) return null;
  return {
    id: String(file?.id || documentLearningFileId(provenanceAbsolutePath, index)),
    absolutePath: provenanceAbsolutePath,
    provenanceAbsolutePath,
    fileName,
    selected: file?.selected !== false,
    sizeBytes: trustedContentBuffer.length,
    modifiedAt: typeof file?.modifiedAt === "string" ? file.modifiedAt : undefined,
    sourceKind: "approved_folder_watch",
    relativePath,
    contentSha256,
    trustedContentBuffer,
  };
}

function assertTrustedDocumentLearningSnapshot(payload = {}, files = []) {
  const expectedHashes = files.map((file) => file.contentSha256).sort();
  const receivedHashes = Array.isArray(payload.acceptedContentSha256s)
    ? payload.acceptedContentSha256s.map(String).sort()
    : [];
  if (
    receivedHashes.length !== expectedHashes.length ||
    receivedHashes.some((value, index) => value !== expectedHashes[index])
  ) {
    throw new Error("trusted document learning snapshot hash list did not match");
  }
  const digest = createTrustedDocumentLearningSnapshotDigest(files);
  if (typeof payload.snapshotDigest !== "string" || payload.snapshotDigest !== digest) {
    throw new Error("trusted document learning snapshot digest did not match");
  }
}

function createTrustedDocumentLearningSnapshotDigest(files = []) {
  const digest = createHash("sha256");
  for (const file of [...files].sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en-US"))) {
    digest.update(file.relativePath).update("\0").update(file.contentSha256).update("\0");
  }
  return digest.digest("hex");
}

function throwIfDocumentLearningAborted(signal) {
  if (signal?.aborted) {
    const error = new Error("document learning snapshot was aborted");
    error.name = "AbortError";
    throw error;
  }
}

async function extractTrustedDocumentLearningText(file, signal) {
  throwIfDocumentLearningAborted(signal);
  const buffer = Buffer.from(file.trustedContentBuffer);
  const extension = documentLearningExtension(file.fileName || file.provenanceAbsolutePath);
  if (isImageDocumentLearningExtension(extension)) {
    return normalizeExtractedDocumentText([
      "[이미지 첨부]",
      `파일명: ${file.fileName}`,
      `확장자: ${extension || "unknown"}`,
      `크기: ${buffer.length} bytes`,
      "현재 단계에서는 이미지를 로컬 첨부 자료로 인식하고 메타데이터를 저장합니다.",
    ].join("\n"));
  }
  if (extension === "docx") {
    const mammoth = await loadMammoth();
    const result = await mammoth.extractRawText({ buffer });
    throwIfDocumentLearningAborted(signal);
    return normalizeExtractedDocumentText(result.value);
  }
  if (extension === "xlsx") {
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    throwIfDocumentLearningAborted(signal);
    return normalizeExtractedDocumentText(collectWorkbookLearningText(workbook));
  }
  if (extension === "pdf") {
    const PDFParse = await loadPDFParse();
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      throwIfDocumentLearningAborted(signal);
      return normalizeExtractedDocumentText(result.text);
    } finally {
      await parser.destroy();
    }
  }
  if (isPlainTextDocumentLearningExtension(extension)) {
    return normalizeExtractedDocumentText(buffer.toString("utf8"));
  }
  return normalizeExtractedDocumentText([
    "[첨부 파일]",
    `파일명: ${file.fileName}`,
    `확장자: ${extension || "unknown"}`,
    `크기: ${buffer.length} bytes`,
    "이 파일 형식은 메타데이터만 로컬 인덱스에 보관합니다.",
  ].join("\n"));
}
// 내용 해시별로 뽑아 둔 본문. 원본 파일이 아니라, 이미 로컬 인덱스(modycrew-document-index.json)에
// 저장하던 것과 같은 '가림 처리 끝난' 본문만 둔다. 추출·가림 규칙을 바꾸면 버전을 올린다.
const documentLearningTextCacheFolderName = "text-cache";
const documentLearningTextCacheSchema = "modycrew.document-text-cache.v1";
const documentLearningTextCacheVersion = 1;
const documentLearningTextCacheMaxEntries = 240;
const documentLearningTextCacheMaxChars = 200000;

// 본문이 파일 내용만으로 정해지고 추출이 비싼 형식만 캐시한다. 이미지·기타 형식은 파일 이름을
// 본문에 넣으므로(같은 내용이라도 이름이 다르면 본문이 다르다) 캐시하지 않고, 글 파일은 바로 읽는 편이 빠르다.
function isDocumentLearningTextCacheableExtension(extension) {
  return extension === "docx" || extension === "xlsx" || extension === "pdf";
}

function documentLearningTextCachePath(cacheRoot, contentSha256) {
  return path.join(cacheRoot, `${contentSha256}.json`);
}

async function readDocumentLearningTextCache(cacheRoot, contentSha256, extension) {
  if (!/^[a-f0-9]{64}$/u.test(String(contentSha256))) return null;
  const filePath = documentLearningTextCachePath(cacheRoot, contentSha256);
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile() || stats.size > documentLearningTextCacheMaxChars * 4) return null;
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (
      parsed?.schema !== documentLearningTextCacheSchema ||
      parsed.version !== documentLearningTextCacheVersion ||
      parsed.contentSha256 !== contentSha256 ||
      parsed.extension !== extension ||
      typeof parsed.extractedText !== "string" ||
      parsed.extractedText.length > documentLearningTextCacheMaxChars
    ) {
      return null;
    }
    return { extractedText: parsed.extractedText, sensitiveValueRedacted: parsed.sensitiveValueRedacted === true };
  } catch {
    return null;
  }
}

async function writeDocumentLearningTextCache(cacheRoot, contentSha256, extension, value = {}) {
  if (!/^[a-f0-9]{64}$/u.test(String(contentSha256))) return;
  if (typeof value.extractedText !== "string" || value.extractedText.length > documentLearningTextCacheMaxChars) return;
  try {
    await writeDocumentLearningTextAtomically(
      documentLearningTextCachePath(cacheRoot, contentSha256),
      JSON.stringify({
        schema: documentLearningTextCacheSchema,
        version: documentLearningTextCacheVersion,
        contentSha256,
        extension,
        sensitiveValueRedacted: value.sensitiveValueRedacted === true,
        extractedText: value.extractedText,
      }),
    );
  } catch {
    // 캐시는 없어도 학습은 된다. 다음에 다시 추출할 뿐이다.
  }
}

async function pruneDocumentLearningTextCache(cacheRoot, keepSha256s = new Set()) {
  try {
    const names = (await fs.readdir(cacheRoot)).filter((name) => /^[a-f0-9]{64}\.json$/u.test(name));
    if (names.length <= documentLearningTextCacheMaxEntries) return;
    const entries = [];
    for (const name of names) {
      if (keepSha256s.has(name.slice(0, 64))) continue;
      const stats = await fs.stat(path.join(cacheRoot, name)).catch(() => null);
      if (stats) entries.push({ name, mtimeMs: stats.mtimeMs });
    }
    entries.sort((left, right) => left.mtimeMs - right.mtimeMs);
    const removeCount = Math.min(entries.length, names.length - documentLearningTextCacheMaxEntries);
    for (const entry of entries.slice(0, removeCount)) {
      await fs.rm(path.join(cacheRoot, entry.name), { force: true }).catch(() => undefined);
    }
  } catch {
    // 정리는 다음 학습 때 다시 시도한다.
  }
}

function normalizeDocumentLearningFiles(payload = {}) {
  const source = Array.isArray(payload.files) ? payload.files : [];
  return source
    .map((file, index) => {
      const filePath = sanitizeDocumentLearningFilePath(file.absolutePath || file.path);
      if (!filePath) return null;
      return {
        id: String(file.id || documentLearningFileId(filePath, index)),
        absolutePath: filePath,
        fileName: String(file.fileName || file.name || path.basename(filePath)),
        selected: file.selected !== false,
        sizeBytes: Number(file.sizeBytes || 0) || undefined,
        modifiedAt: typeof file.modifiedAt === "string" ? file.modifiedAt : undefined,
        sourceKind: typeof file.sourceKind === "string" ? file.sourceKind : undefined,
      };
    })
    .filter(Boolean);
}

async function importMailAttachmentFiles(payload = {}, options = {}) {
  const normalized = normalizeDocumentLearningFiles(payload).map((file) => ({
    ...file,
    sourceKind: "mail_attachment",
  }));
  const inlineAttachments = Array.isArray(payload.attachments) ? payload.attachments : [];

  for (const [index, attachment] of inlineAttachments.entries()) {
    const attachmentPath = sanitizeDocumentLearningFilePath(attachment.absolutePath || attachment.path);
    if (attachmentPath) {
      normalized.push({
        id: String(attachment.id || documentLearningFileId(attachmentPath, normalized.length + index)),
        absolutePath: attachmentPath,
        fileName: String(attachment.fileName || attachment.name || path.basename(attachmentPath)),
        selected: attachment.selected !== false,
        sizeBytes: Number(attachment.sizeBytes || 0) || undefined,
        modifiedAt: typeof attachment.modifiedAt === "string" ? attachment.modifiedAt : undefined,
        sourceKind: "mail_attachment",
      });
      continue;
    }

    const importedPath = await persistRendererFilePayload(attachment, index, "mail_attachment", options);
    if (!importedPath) continue;
    normalized.push({
      id: String(attachment.id || documentLearningFileId(importedPath, normalized.length + index)),
      absolutePath: importedPath,
      fileName: String(attachment.fileName || attachment.name || path.basename(importedPath)),
      selected: attachment.selected !== false,
      sizeBytes: Number(attachment.sizeBytes || 0) || undefined,
      modifiedAt: typeof attachment.modifiedAt === "string" ? attachment.modifiedAt : undefined,
      sourceKind: "mail_attachment",
    });
  }

  const seen = new Set();
  return normalized
    .filter((file) => file.selected !== false)
    .filter((file) => {
      const key = path.resolve(file.absolutePath).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sanitizeMailAttachmentContext(value = {}) {
  return {
    sourceKind: "mail_attachment",
    connectorId: cleanOneLine(value?.connectorId ?? value?.mailAttachmentContext?.connectorId ?? "").slice(0, 96),
    providerId: cleanOneLine(value?.providerId ?? value?.mailAttachmentContext?.providerId ?? "").slice(0, 80),
    messageId: cleanOneLine(value?.messageId ?? value?.sourceMessageId ?? value?.mailAttachmentContext?.messageId ?? "").slice(0, 160),
    messageSubject: cleanOneLine(value?.messageSubject ?? value?.subject ?? value?.mailAttachmentContext?.messageSubject ?? "").slice(0, 180),
    senderPreview: cleanOneLine(value?.senderPreview ?? value?.from ?? value?.mailAttachmentContext?.senderPreview ?? "").slice(0, 140),
    mailboxLabel: cleanOneLine(value?.mailboxLabel ?? value?.mailbox ?? value?.mailAttachmentContext?.mailboxLabel ?? "").slice(0, 120),
  };
}

function documentLearningNowIso(options = {}) {
  const value = typeof options.now === "function" ? options.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function normalizeDocumentLearningWorkspaceId(value) {
  return (
    cleanOneLine(value ?? "local_desktop")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80) || "local_desktop"
  );
}

function documentLearningWorkspaceIntelligenceMessage(extractedCount, result = {}) {
  if (result.status === "workspace_intelligence_updated") {
    if ((result.newLearningSessionIds?.length ?? 0) === 0) {
      return (
        extractedCount +
        "개 파일을 확인했습니다. 이미 학습한 같은 상태라 업무 기억은 중복 저장하지 않았습니다."
      );
    }
    return (
      extractedCount +
      "개 파일을 로컬 업무 기억으로 만들고 메인 엔진의 업무 패턴도 갱신했습니다."
    );
  }
  if (result.status === "workspace_intelligence_recovered_and_updated") {
    return extractedCount + "개 파일을 학습하고 이전 안전 상태에서 메인 엔진의 업무 기억을 복원했습니다.";
  }
  if (result.status === "workspace_intelligence_state_recovery_required") {
    return extractedCount + "개 파일 학습은 완료했습니다. 메인 엔진의 이전 상태는 보호하고 복구 확인이 필요합니다.";
  }
  return extractedCount + "개 파일 학습은 완료했습니다. 메인 엔진의 업무 기억 갱신은 다음 실행에서 다시 시도합니다.";
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

function getDocumentLearningDefaultRoot(options = {}) {
  if (options.app && typeof options.app.getPath === "function") {
    return path.join(options.app.getPath("documents"), "ModyCrew", "LocalIndex");
  }
  return path.join(os.tmpdir(), "ModyCrew", "LocalIndex");
}

function normalizeKnownFolder(value) {
  const known = String(value ?? "").trim();
  return ["desktop", "documents", "downloads", "home"].includes(known) ? known : "";
}

function getKnownFolderPath(knownFolder, options = {}) {
  try {
    if (options.app && typeof options.app.getPath === "function") {
      if (knownFolder === "desktop") return options.app.getPath("desktop");
      if (knownFolder === "documents") return options.app.getPath("documents");
      if (knownFolder === "downloads") return options.app.getPath("downloads");
      if (knownFolder === "home") return options.app.getPath("home");
    }
  } catch {
    // fall through to homedir based fallback
  }
  const home = os.homedir();
  if (!home) return "";
  if (knownFolder === "desktop") return path.join(home, "Desktop");
  if (knownFolder === "documents") return path.join(home, "Documents");
  if (knownFolder === "downloads") return path.join(home, "Downloads");
  if (knownFolder === "home") return home;
  return "";
}

function knownFolderLabel(knownFolder) {
  if (knownFolder === "desktop") return "바탕화면";
  if (knownFolder === "documents") return "문서";
  if (knownFolder === "downloads") return "다운로드";
  if (knownFolder === "home") return "사용자 폴더";
  return "";
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function sanitizeDocumentLearningRoot(value, options = {}) {
  const fallback = getDocumentLearningDefaultRoot(options);
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return path.resolve(raw);
}

function redactDocumentLearningSensitiveText(value) {
  return String(value ?? "")
    .replace(
      /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/giu,
      "[비밀 키 가림]",
    )
    .replace(
      /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/giu,
      "[인증값 가림]",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
      "[JWT 가림]",
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/giu,
      "[GitHub 토큰 가림]",
    )
    .replace(
      /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/giu,
      "[Slack 토큰 가림]",
    )
    .replace(/\bAKIA[A-Z0-9]{16}\b/gu, "[AWS 키 가림]")
    .replace(
      /((?:password|passwd|pwd|api[_ -]?key|secret|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|session(?:[_ -]?id)?|cookie|authorization|database[_ -]?url|redis[_ -]?url|smtp[_ -]?url|connection[_ -]?string|token)\s*[:=]\s*)(?:"[^"]{6,}"|'[^']{6,}'|[^\s,;]{6,})/giu,
      "$1[비밀값 가림]",
    )
    .replace(
      /(\b(?:https?|postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps|smtp):\/\/)[^@\s/:]+:[^@\s/]+@/giu,
      "$1[자격정보 가림]@",
    );
}
function documentLearningExtension(filePath) {
  return path.extname(String(filePath || "")).slice(1).toLowerCase();
}

function isSupportedDocumentLearningExtension(extension) {
  return [
    "doc",
    "docx",
    "xls",
    "xlsx",
    "csv",
    "txt",
    "md",
    "pdf",
    "ppt",
    "pptx",
    "key",
    "hwp",
    "hwpx",
    "png",
    "jpg",
    "jpeg",
    "webp",
    "gif",
    "bmp",
    "tif",
    "tiff",
    "heic",
    "json",
    "html",
    "xml",
    "rtf",
    "mp4",
    "mov",
    "mkv",
    "avi",
    "webm",
    "m4v",
    "psd",
    "ai",
    "fig",
    "sketch",
    "xd",
    "prproj",
    "aep",
    "indd",
    "eml",
    "msg",
    "mbox",
    "zip",
    "7z",
    "rar",
  ].includes(extension);
}

function isImageDocumentLearningExtension(extension) {
  return ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "heic"].includes(extension);
}

function isPlainTextDocumentLearningExtension(extension) {
  return ["csv", "txt", "md", "json", "html", "xml", "rtf", "eml", "mbox"].includes(extension);
}

function isDocumentLearningTextExtractableExtension(extension) {
  return (
    isImageDocumentLearningExtension(extension) ||
    ["docx", "xlsx", "pdf"].includes(extension) ||
    isPlainTextDocumentLearningExtension(extension)
  );
}

function sanitizeDocumentLearningFilePath(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const input = value.trim();
  if (!path.isAbsolute(input)) return "";
  const resolved = path.resolve(input);
  const extension = documentLearningExtension(resolved);
  return isSupportedDocumentLearningExtension(extension) ? resolved : "";
}

function createDocumentLearningActivityEvent(result, payload = {}) {
  const createdAt = new Date().toISOString();
  const summary = result.summary ?? {};
  const selectedFiles = Number(summary.selectedFiles ?? 0);
  const extractedReady = Number(summary.extractedReady ?? 0);
  const failed = Number(summary.failed ?? 0);
  const chunks = Number(summary.chunks ?? 0);
  const groups = Number(summary.groups ?? 0);
  const searchHits = Number(summary.searchHits ?? 0);
  const recommendations = Array.isArray(result.automationRecommendations)
    ? result.automationRecommendations.length
    : 0;
  const workspaceIntelligence = result.workspaceIntelligence ?? {};
  const intelligenceCycleCount = Number(workspaceIntelligence.cycleCount ?? 0);
  const intelligenceWorkSignals = Array.isArray(workspaceIntelligence.workSignals)
    ? workspaceIntelligence.workSignals.length
    : 0;
  const intelligenceNewLearningSessions = Array.isArray(
    workspaceIntelligence.newLearningSessionIds,
  )
    ? workspaceIntelligence.newLearningSessionIds.length
    : 0;
  const auditTrail = [
    `선택 파일: ${selectedFiles}개`,
    `텍스트 추출: ${extractedReady}개`,
    `실패: ${failed}개`,
    `지식 조각: ${chunks}개`,
    `업무 그룹: ${groups}개`,
    `자동화 추천: ${recommendations}개`,
    result.reportPath ? `보고서: ${path.basename(result.reportPath)}` : "",
  ]
    .map(cleanOneLine)
    .filter(Boolean)
    .slice(0, 8);

  return {
    id: cleanOneLine(payload.activityEventId || `document-learning-${createdAt.replace(/[^0-9A-Za-z]/g, "")}`).slice(
      0,
      120,
    ),
    workItemId: "document-learning-latest",
    label: "자료 학습",
    detail: `자료 ${extractedReady}개 · 그룹 ${groups}개 · 자동화 추천 ${recommendations}개`,
    status: failed > 0 ? "error" : "done",
    createdAt,
    evidence: `localIndex:true files:${selectedFiles} extracted:${extractedReady} chunks:${chunks} recommendations:${recommendations}`,
    kind: "document_learning",
    sourceLabel: "자료 학습",
    metrics: {
      selectedFiles,
      extractedReady,
      failed,
      chunks,
      groups,
      searchHits,
      automationRecommendations: recommendations,
      workspaceIntelligenceCycleCount: intelligenceCycleCount,
      workspaceIntelligenceWorkSignals: intelligenceWorkSignals,
      workspaceIntelligenceNewLearningSessions: intelligenceNewLearningSessions,
      workspaceIntelligenceStatus: cleanOneLine(workspaceIntelligence.status ?? ""),
      originalFilesMoved: false,
      originalFilesDeleted: false,
    },
    auditTrail,
  };
}

function cleanOneLine(value) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:\+?82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, "[redacted-phone]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function documentLearningMimeTypeFor(filePath) {
  const extension = documentLearningExtension(filePath);
  if (extension === "doc") return "application/msword";
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === "xls") return "application/vnd.ms-excel";
  if (extension === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (extension === "csv") return "text/csv";
  if (extension === "md") return "text/markdown";
  if (extension === "pdf") return "application/pdf";
  if (extension === "ppt") return "application/vnd.ms-powerpoint";
  if (extension === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (extension === "hwp") return "application/x-hwp";
  if (extension === "hwpx") return "application/x-hwpx";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "bmp") return "image/bmp";
  if (extension === "tif" || extension === "tiff") return "image/tiff";
  if (extension === "heic") return "image/heic";
  if (extension === "json") return "application/json";
  if (extension === "html") return "text/html";
  if (extension === "xml") return "application/xml";
  if (extension === "rtf") return "application/rtf";
  return "text/plain";
}

function documentLearningTitleFor(filePath) {
  return path.basename(filePath).replace(/\.[^.]+$/u, "");
}

function documentLearningFileId(filePath, index) {
  const hash = createHash("sha1").update(filePath).digest("hex").slice(0, 10);
  return `local_doc_${index + 1}_${hash}`;
}

function documentLearningFolderId(folderPath) {
  const hash = createHash("sha1").update(path.resolve(folderPath)).digest("hex").slice(0, 10);
  return `local_folder_${hash}`;
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function renderDocumentLearningReport(payload) {
  const lines = [
    "# ModyCrew 로컬 자료 학습 결과",
    "",
    `- 학습 세대: ${payload.generationId}`,
    `- 추출 완료: ${payload.summary.extractedReady}/${payload.summary.selectedFiles}`,
    `- 검색 chunk: ${payload.summary.chunks}`,
    `- 정리 그룹: ${payload.summary.groups}`,
    `- DB 저장 사용: ${String(payload.summary.databaseUsed)}`,
    "- 원본 이동/삭제: false",
    "",
    "## 추출 미리보기",
  ];
  for (const item of payload.extracted) {
    lines.push(`- ${item.fileName}: ${item.preview}`);
  }
  if (payload.failures.length > 0) {
    lines.push("", "## 추출 실패");
    for (const item of payload.failures) {
      lines.push(`- ${item.fileName}: ${item.reason}`);
    }
  }
  lines.push("", "## 검색 결과");
  for (const hit of payload.searchHits) {
    lines.push(`- ${hit.title} (${hit.citation}): ${hit.preview}`);
  }
  lines.push("", "## 자동화 추천");
  for (const item of payload.automationRecommendations ?? []) {
    lines.push(`- ${item.title}: ${item.suggestedRuleLabel} (${item.sourceLabels.join(", ")})`);
  }
  lines.push(
    "",
    "## 안전 경계",
    "- 사용자가 직접 선택한 파일만 읽었습니다.",
    "- 원본 파일은 이동/삭제하지 않았습니다.",
    "- 원문은 앱 클라우드 DB에 저장하지 않고 사용자가 선택한 로컬 인덱스에만 저장했습니다.",
    "",
  );
  return lines.join("\n");
}

function renderDocumentFolderPlanReport(payload) {
  const strategyChoices = Array.isArray(payload.strategyChoices) ? payload.strategyChoices : [];
  const duplicateReviewCandidates = Array.isArray(payload.duplicateReviewCandidates)
    ? payload.duplicateReviewCandidates
    : [];
  const lines = [
    "# ModyCrew 로컬 폴더 정리 계획",
    "",
    "- 원본 이동/삭제: false",
    "- 이동/삭제 전 사용자 승인 필요: true",
    "",
  ];
  if (strategyChoices.length > 0) {
    lines.push("## 정리 방식 선택", "");
    for (const strategy of strategyChoices) {
      lines.push(`- ${strategy.label}: ${strategy.detail}`);
      lines.push(`  - 설정 페이지: ${strategy.settingPage}`);
      lines.push(`  - 자동 이동/삭제: ${String(strategy.externalMutation)}`);
    }
    lines.push("");
  }
  lines.push("## 중복 후보 수동 검토", "");
  if (duplicateReviewCandidates.length > 0) {
    for (const candidate of duplicateReviewCandidates) {
      lines.push(`- ${candidate.fileName}: ${candidate.candidateCount}개 후보 (${candidate.reviewMode})`);
      lines.push("  - 자동 삭제: false");
      lines.push("  - 삭제 전 사용자 승인 필요: true");
    }
  } else {
    lines.push("- 중복 후보 없음 - 삭제 검토도 실행하지 않습니다.");
  }
  lines.push("");
  for (const group of payload.groups) {
    lines.push(`## ${group.label}`);
    lines.push(`- 대상 폴더: ${group.targetFolder}`);
    lines.push(`- 파일 수: ${group.fileIds.length}`);
    lines.push("");
  }
  lines.push("## 자동화 추천", "");
  for (const item of payload.automationRecommendations ?? []) {
    lines.push(`- ${item.title}: ${item.suggestedRuleLabel}`);
  }
  return lines.join("\n");
}

function renderFolderPlanApplyReport(payload) {
  const lines = [
    "# ModyCrew 폴더 정리 적용 기록",
    "",
    `- 적용 시각: ${payload.createdAt}`,
    `- 정리 위치: ${payload.organizedRoot}`,
    `- 적용 파일: ${payload.appliedCount}개`,
    `- 건너뜀: ${payload.skippedCount}개`,
    `- 원본 이동: ${String(payload.originalFilesMoved)}`,
    `- 원본 삭제: ${String(payload.originalFilesDeleted)}`,
    `- 덮어쓰기: ${String(payload.overwritePerformed)}`,
    `- 되돌리기 가능: ${String(payload.canRevert)}`,
    `- 안전 요약: ${payload.safetySummary || "원본 삭제와 덮어쓰기는 실행하지 않았습니다."}`,
    `- 충돌 처리: ${payload.collisionSummary || "겹치는 대상은 덮어쓰지 않습니다."}`,
    `- 제외 기준: ${payload.exclusionSummary || "사용자 제외 기준 없음"}`,
    `- 다음 선택: ${payload.nextUserChoice || "적용 기록 확인 또는 되돌리기 승인"}`,
    ...(payload.mailAttachmentOrganizerApply
      ? [
          `- 메일 첨부 적용 계약: ${payload.mailAttachmentOrganizerApply.contract}`,
          `- 메일 원본 변경: ${String(payload.mailAttachmentOrganizerApply.originalMailMutation)}`,
          `- 원본 첨부 삭제: ${String(payload.mailAttachmentOrganizerApply.originalAttachmentDeleted)}`,
          `- 외부 공유 생성: ${String(payload.mailAttachmentOrganizerApply.originalShareCreated)}`,
          `- 로컬 사본만 적용: ${String(payload.mailAttachmentOrganizerApply.localCopyOnly)}`,
          `- 적용 대상: 내려받은 로컬 사본 ${payload.mailAttachmentOrganizerApply.appliedLocalCopyCount}개`,
        ]
      : []),
    "",
    "## 이동한 파일",
    "",
  ];
  if (payload.applied.length === 0) {
    lines.push("- 이동한 파일 없음");
  } else {
    for (const item of payload.applied) {
      lines.push(`- ${item.fileName}`);
      lines.push(`  - 이전: ${item.undoPath}`);
      lines.push(`  - 현재: ${item.targetPath}`);
    }
  }
  lines.push("", "## 건너뛴 파일", "");
  if (payload.skipped.length === 0) {
    lines.push("- 건너뛴 파일 없음");
  } else {
    for (const item of payload.skipped) {
      lines.push(`- ${item.fileName}: ${item.status}${item.reason ? ` (${item.reason})` : ""}`);
    }
  }
  lines.push(
    "",
    "## 안전 경계",
    "",
    "- 삭제는 실행하지 않았습니다.",
    "- 기존 파일을 덮어쓰지 않았습니다.",
    "- 되돌리기는 별도 승인 문구 `정리 되돌리기 승인` 후에만 실행합니다.",
  );
  return lines.join("\n");
}

function compactDocumentLearningText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}...` : text;
}

/* 근거 발췌를 만들 때 훑는 범위와 잘라 내는 길이.
 *
 * 예전에는 문서를 **앞 800자로 자른 뒤** 그 안에서만 검색어를 찾았다. 그런데 문서를
 * 고르는 점수 계산(위 haystack)은 **전문 12만 자**를 본다. 그래서 검색어가 5,000번째
 * 글자에 있는 문서는 "관련 있음" 으로 뽑히지만, 발췌 함수는 그 말을 못 찾고
 * firstHit 이 0 이 되어 **문서 맨 앞 220자를 근거랍시고** 넘겼다.
 * 모델은 그 엉뚱한 문단을 근거로 자신 있게 답했다 — 제한이 아니라 정확성 버그였다.
 *
 * 이제 점수 계산과 **같은 범위**(전문)를 본다. 두 곳이 다른 글을 보면 안 된다. */
const documentSnippetSearchChars = 120_000;
const documentSnippetChars = 1_200;

function createDocumentLearningSnippet(value, queryTerms) {
  const text = compactDocumentLearningText(value, documentSnippetSearchChars);
  if (!queryTerms.length) return compactDocumentLearningText(text, documentSnippetChars);
  const lower = text.toLocaleLowerCase("ko-KR");
  const hits = queryTerms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  if (!hits.length) {
    // 못 찾았으면 못 찾았다고 말한다. 맨 앞을 근거로 내밀면 모델이 그걸 답의 근거로 쓴다.
    return `(찾는 말이 이 문서 본문에 없습니다 — 파일 이름이나 경로로 걸렸습니다. 문서 앞부분: ${compactDocumentLearningText(text, 200)})`;
  }
  // 앞뒤 맥락을 함께 준다. 딱 맞는 자리만 잘라 주면 문장이 중간부터 시작해 읽히지 않는다.
  const start = Math.max(0, hits[0] - 200);
  const snippet = text.slice(start, start + documentSnippetChars);
  return `${start > 0 ? "... " : ""}${compactDocumentLearningText(snippet, documentSnippetChars)}`;
}

function requireOption(options, name) {
  if (!options?.[name]) throw new Error(`document learning handler requires ${name}`);
  return options[name];
}
