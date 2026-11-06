import crypto from "node:crypto";

import { handleGoogleDriveMessage } from "./google-drive-handler.mjs";
import { handleReceiptAgentMessage } from "./receipt-agent-handler.mjs";

const approvalTtlMs = 10 * 60 * 1000;
const approvalLimit = 64;

const approvalSpecs = {
  receipt_upload: {
    confirmationText: "\uB4DC\uB77C\uC774\uBE0C\uC5D0 \uC800\uC7A5",
    actionLabel: "Drive\uC5D0 \uC601\uC218\uC99D \uC800\uC7A5",
    buttonLabel: "\uC800\uC7A5",
  },
  file_organization: {
    confirmationText: "\uC120\uD0DD \uD30C\uC77C \uC815\uB9AC",
    actionLabel: "\uC120\uD0DD\uD55C Drive \uD30C\uC77C \uC815\uB9AC",
    buttonLabel: "\uC815\uB9AC",
  },
};

/**
 * Adapter for the receipt-only Electron IPC surface.
 * It binds Drive previews to a sender-scoped native final confirmation.
 */
export function createReceiptIpcAdapter(options = {}) {
  const approvals = new Map();

  return async function handleReceiptIpcMessage(event, payload = {}) {
    try {
      assertTrustedReceiptIpcSender(event, options);
      pruneExpiredApprovals(approvals);
      const kind = String(payload?.kind ?? "");

      if (kind === "import_files") {
        return await receiptMessage(event, { kind: "import_receipt_files", files: payload.files }, options);
      }
      if (kind === "analyze") {
        return await receiptMessage(event, {
          kind: "analyze_receipts",
          grantId: payload.grantId,
          fileIds: payload.fileIds,
          instruction: payload.instruction,
          template: payload.template,
          provider: payload.provider,
          receiptImageConsent: payload.receiptImageConsent === true,
        }, options);
      }
      if (kind === "regenerate") {
        return await receiptMessage(event, {
          kind: "regenerate_receipt",
          artifactId: payload.artifactId,
          receipt: payload.receipt,
          template: payload.template,
        }, options);
      }
      if (kind === "list") return await receiptMessage(event, { kind: "list_receipts" }, options);
      if (kind === "open") return await receiptMessage(event, { kind: "open_receipt", artifactId: payload.artifactId }, options);
      if (kind === "drive_status") return await driveMessage(event, { kind: "status" }, options);
      if (kind === "connect_drive") return await driveMessage(event, { kind: "start_connect" }, options);
      if (kind === "list_drive_files") {
        return await driveMessage(event, {
          kind: "list_files",
          parentId: payload.parentId,
          driveId: payload.driveId,
          pageSize: payload.pageSize,
        }, options);
      }
      if (kind === "download_drive_for_learning") {
        // 읽기 전용이라 승인 절차 없이 바로 간다 — Drive 원본을 바꾸지 않는다.
        return await driveMessage(event, {
          kind: "download_for_learning",
          fileIds: safeDriveIds(payload.fileIds),
          driveId: safeDriveId(payload.driveId),
        }, options);
      }
      if (kind === "preview_upload") return await createUploadApproval(event, payload, approvals, options);
      if (kind === "upload") return await commitDriveApproval(event, payload, approvals, options, "receipt_upload");
      if (kind === "preview_organization") return await createOrganizationApproval(event, payload, approvals, options);
      if (kind === "apply_organization") return await commitDriveApproval(event, payload, approvals, options, "file_organization");

      return receiptAdapterResult("receipt_ipc_unsupported", "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uC601\uC218\uC99D \uC694\uCCAD\uC785\uB2C8\uB2E4.");
    } catch (error) {
      return receiptAdapterResult(
        /origin|frame|sender|access/iu.test(String(error?.message ?? error))
          ? "receipt_access_denied"
          : "receipt_ipc_failed",
        "\uC601\uC218\uC99D \uC791\uC5C5\uC744 \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC0AC\uC9C4\uACFC \uAE30\uC874 \uBB38\uC11C\uB294 \uBC14\uAFB8\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.",
      );
    }
  };
}

async function receiptMessage(event, payload, options) {
  const handler = options.handleReceiptMessage ?? handleReceiptAgentMessage;
  return await handler(event, payload, {
    app: options.app,
    shell: options.shell,
    receiptOutputRoot: options.receiptOutputRoot,
    userDataPath: options.userDataPath,
    generateReceiptVision: async (input) => {
      if (typeof options.generateReceiptVision !== "function") {
        return {
          status: "receipt_vision_connection_required",
          userMessage: "\uC601\uC218\uC99D \uC0AC\uC9C4\uC744 \uC77D\uC744 AI \uC5F0\uACB0\uC744 \uC124\uC815\uD574 \uC8FC\uC138\uC694.",
        };
      }
      return await options.generateReceiptVision(event, input);
    },
  });
}

async function driveMessage(event, payload, options) {
  const handler = options.handleDriveMessage ?? handleGoogleDriveMessage;
  return await handler(event, payload, {
    app: options.app,
    safeStorage: options.safeStorage,
    shell: options.shell,
    fetch: options.fetch,
    googleDriveClientId: options.googleDriveClientId,
    googleDriveClientSecret: options.googleDriveClientSecret,
    userDataPath: options.userDataPath,
    receiptOutputRoot: options.receiptOutputRoot,
    // 학습용으로 받은 Drive 파일을 둘 위치. 없으면 핸들러가 userDataPath 로 대체한다.
    localMemoryRoot: options.localMemoryRoot,
  });
}

async function createUploadApproval(event, payload, approvals, options) {
  const artifactId = safeId(payload.artifactId);
  if (!artifactId) return receiptAdapterResult("receipt_artifact_required", "\uC800\uC7A5\uD560 \uC601\uC218\uC99D \uBB38\uC11C\uB97C \uBA3C\uC800 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");

  const preview = await driveMessage(event, {
    kind: "preview_receipt_upload",
    artifactId,
    rootFolderId: payload.rootFolderId,
    driveId: payload.driveId,
  }, options);
  if (preview.status !== "google_drive_upload_preview") return preview;

  const approval = rememberApproval(approvals, {
    type: "receipt_upload",
    senderId: senderId(event),
    artifactId,
    rootFolderId: safeDriveId(payload.rootFolderId) || "root",
    driveId: safeDriveId(payload.driveId),
    targetFolders: safeTextList(preview.targetFolders, 8, 120),
    fileSnapshots: Array.isArray(preview.fileSnapshots) ? preview.fileSnapshots : [],
  });
  const { fileSnapshots: _privateFileSnapshots, ...publicPreview } = preview;
  return {
    ...publicPreview,
    approvalId: approval.id,
    approvalExpiresAt: new Date(approval.expiresAt).toISOString(),
  };
}

async function createOrganizationApproval(event, payload, approvals, options) {
  const fileIds = safeDriveIds(payload.fileIds);
  if (!fileIds.length) return receiptAdapterResult("google_drive_files_required", "\uC815\uB9AC\uD560 Drive \uD30C\uC77C\uC744 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");

  const preview = await driveMessage(event, {
    kind: "preview_organization",
    fileIds,
    rootFolderId: payload.rootFolderId,
    driveId: payload.driveId,
  }, options);
  if (preview.status !== "google_drive_organization_preview") return preview;

  const approval = rememberApproval(approvals, {
    type: "file_organization",
    senderId: senderId(event),
    fileIds,
    rootFolderId: safeDriveId(payload.rootFolderId) || "root",
    driveId: safeDriveId(payload.driveId),
    operations: Array.isArray(preview.operations) ? preview.operations : [],
  });
  return {
    ...preview,
    approvalId: approval.id,
    approvalExpiresAt: new Date(approval.expiresAt).toISOString(),
  };
}

async function commitDriveApproval(event, payload, approvals, options, type) {
  const spec = approvalSpecs[type];
  const approval = findApproval(approvals, payload.approvalId, type, event);
  if (!approval) {
    return receiptAdapterResult(
      "google_drive_approval_required",
      "\uC791\uC5C5 \uBBF8\uB9AC\uBCF4\uAE30\uB97C \uB2E4\uC2DC \uD655\uC778\uD55C \uB4A4 \uC2B9\uC778\uD574 \uC8FC\uC138\uC694.",
      { finalApprovalRequired: true, confirmationText: spec.confirmationText },
    );
  }
  if (String(payload.confirmationText ?? "").replace(/\s+/g, " ").trim() !== spec.confirmationText) {
    return receiptAdapterResult(
      "google_drive_approval_required",
      "\uC815\uD655\uD788 \"" + spec.confirmationText + "\"\uC744 \uC785\uB825\uD574 \uC2B9\uC778\uD574 \uC8FC\uC138\uC694.",
      { finalApprovalRequired: true, confirmationText: spec.confirmationText },
    );
  }

  const confirmation = await showNativeConfirmation(event, approval, spec, options);
  if (confirmation !== true) {
    return receiptAdapterResult(
      type + "_cancelled",
      "\uC791\uC5C5 \uC2B9\uC778\uC744 \uCDE8\uC18C\uD588\uC2B5\uB2C8\uB2E4. Drive\uC5D0\uB294 \uC544\uBB34 \uBCC0\uACBD\uB3C4 \uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.",
      { finalApprovalRequired: false },
    );
  }

  approvals.delete(approval.id);
  if (type === "receipt_upload") {
    return await driveMessage(event, {
      kind: "upload_receipt",
      artifactId: approval.artifactId,
      rootFolderId: approval.rootFolderId,
      driveId: approval.driveId,
      expectedFiles: approval.fileSnapshots,
      finalApproval: true,
      confirmationText: spec.confirmationText,
    }, options);
  }
  return await driveMessage(event, {
    kind: "apply_organization",
    fileIds: approval.fileIds,
    rootFolderId: approval.rootFolderId,
    driveId: approval.driveId,
    expectedOperations: approval.operations,
    finalApproval: true,
    confirmationText: spec.confirmationText,
  }, options);
}

async function showNativeConfirmation(event, approval, spec, options) {
  const dialog = options.dialog;
  if (typeof dialog?.showMessageBox !== "function") return false;

  const detail = approval.type === "receipt_upload"
    ? [
        "\uC800\uC7A5 \uACBD\uB85C: " + ((approval.targetFolders ?? []).join(" / ") || "Drive \uCD5C\uC0C1\uC704"),
        "Word \uBB38\uC11C\uC640 \uC601\uC218\uC99D \uC0AC\uC9C4\uC744 \uC0C8 \uD30C\uC77C\uB85C \uC800\uC7A5\uD569\uB2C8\uB2E4.",
      ].join("\n")
    : [
        String(approval.fileIds?.length ?? 0) + "\uAC1C \uD30C\uC77C\uC744 \uB0A0\uC9DC\uBCC4 \uD3F4\uB354\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4.",
        "\uC0AD\uC81C\uB098 \uACF5\uC720 \uAD8C\uD55C \uD3B8\uC9D1\uC740 \uD558\uC9C0 \uC54A\uC9C0\uB9CC, \uB300\uC0C1 \uD3F4\uB354\uC758 \uC811\uADFC \uADDC\uCE59\uC740 \uD655\uC778\uD574 \uC8FC\uC138\uC694.",
      ].join("\n");
  const messageBoxOptions = {
    type: "warning",
    buttons: ["\uCDE8\uC18C", spec.buttonLabel],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: "ModyCrew \uCD5C\uC885 \uC2B9\uC778",
    message: spec.actionLabel,
    detail,
  };
  const BrowserWindow = options.BrowserWindow;
  const owner = BrowserWindow?.fromWebContents?.(event?.sender);
  const result = owner && !owner.isDestroyed?.()
    ? await dialog.showMessageBox(owner, messageBoxOptions)
    : await dialog.showMessageBox(messageBoxOptions);
  return Number(result?.response) === 1;
}

function rememberApproval(approvals, input) {
  pruneExpiredApprovals(approvals);
  const id = "receipt-approval-" + crypto.randomUUID();
  const approval = {
    ...input,
    id,
    expiresAt: Date.now() + approvalTtlMs,
  };
  approvals.set(id, approval);
  while (approvals.size > approvalLimit) {
    const oldest = approvals.keys().next().value;
    if (!oldest) break;
    approvals.delete(oldest);
  }
  return approval;
}

function findApproval(approvals, approvalId, type, event) {
  const id = String(approvalId ?? "");
  const approval = approvals.get(id);
  if (!approval || approval.type !== type || approval.expiresAt < Date.now()) return null;
  if (approval.senderId !== senderId(event)) return null;
  return approval;
}

function pruneExpiredApprovals(approvals) {
  for (const [id, approval] of approvals.entries()) {
    if (!approval || approval.expiresAt < Date.now()) approvals.delete(id);
  }
}

function assertTrustedReceiptIpcSender(event, options) {
  if (options.trustedSender === true) return;
  const sender = event?.sender;
  const frame = event?.senderFrame;
  if (!sender || !frame || !Number.isInteger(sender.id)) throw new Error("receipt_untrusted_sender");
  if (sender.mainFrame && frame !== sender.mainFrame) throw new Error("receipt_nested_frame_blocked");
  const senderUrl = String(frame.url || sender.getURL?.() || "");
  if (!senderUrl.startsWith("modycrew://") && !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/iu.test(senderUrl)) {
    throw new Error("receipt_sender_origin_blocked");
  }
}

function senderId(event) {
  return Number.isInteger(event?.sender?.id) ? String(event.sender.id) : "";
}

function safeId(value) {
  const id = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]{6,160}$/u.test(id) ? id : "";
}

function safeDriveId(value) {
  const id = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]{3,200}$/u.test(id) ? id : "";
}

function safeDriveIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(safeDriveId).filter(Boolean))].slice(0, 100);
}

function safeTextList(value, maxItems, maxLength) {
  return (Array.isArray(value) ? value : [])
    .slice(0, maxItems)
    .map((item) => String(item ?? "").replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength))
    .filter(Boolean);
}

function receiptAdapterResult(status, userMessage, extra = {}) {
  return {
    status,
    userMessage,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    ...extra,
  };
}
