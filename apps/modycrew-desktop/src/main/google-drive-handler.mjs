import crypto from "node:crypto";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveReceiptArtifactForDrive } from "./receipt-agent-handler.mjs";
import { openConnectionSetupUrl } from "./approved-external-navigation.mjs";

const googleAuthorizeUrl = "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenUrl = "https://oauth2.googleapis.com/token";
const googleDriveApiBase = "https://www.googleapis.com/drive/v3";
const googleDriveUploadBase = "https://www.googleapis.com/upload/drive/v3";
const callbackPath = "/oauth/google-drive";
const connectionTimeoutMs = 180_000;
const driveScope = "https://www.googleapis.com/auth/drive";
const driveVaultFileName = "google-drive-vault.json";
const folderMimeType = "application/vnd.google-apps.folder";

let activeConnection = null;

/**
 * 회사 Google Drive를 위한 최소 권한 경계입니다.
 * 업로드와 이동은 각각 별도 최종 확인 문구가 있어야 실행됩니다.
 */
export async function handleGoogleDriveMessage(event, payload = {}, options = {}) {
  const kind = String(payload.kind ?? payload.action ?? "");
  try {
    assertTrustedDriveSender(event, options);
    if (kind === "status") return await getDriveStatus(options);
    if (kind === "start_connect") return await startDriveConnection(options);
    if (kind === "list_files") return await listDriveFiles(payload, options);
    if (kind === "download_for_learning") return await downloadDriveFilesForLearning(payload, options);
    if (kind === "preview_receipt_upload") return await previewReceiptUpload(payload, options);
    if (kind === "upload_receipt") return await uploadReceipt(payload, options);
    if (kind === "preview_organization") return await previewOrganization(payload, options);
    if (kind === "apply_organization") return await applyOrganization(payload, options);
    return driveResult("unsupported_action", "지원하지 않는 Google Drive 요청입니다.");
  } catch (error) {
    return driveResult(
      "google_drive_failed",
      "Google Drive 작업을 처리하지 못했습니다. 기존 Drive 파일은 바꾸지 않았습니다.",
      { errorCode: driveErrorCode(error) },
    );
  }
}
/**
 * 보기 전용 Drive 창구 — 팀 공유 자료에 드라이브 파일 링크를 걸 때만 쓴다.
 * 영수증 채널에 기대지 않도록 따로 두고, 연결 상태와 파일 목록만 볼 수 있다.
 * 올리기·옮기기는 여기로 오지 않는다(영수증 쪽의 최종 확인 절차를 그대로 거친다).
 */
export async function handleGoogleDriveReadMessage(event, payload = {}, options = {}) {
  const kind = String(payload?.kind ?? "");
  try {
    assertTrustedDriveSender(event, options);
    if (kind === "status") return await getDriveStatus(options);
    if (kind === "list_files") {
      return await listDriveFiles({ parentId: payload.parentId, driveId: payload.driveId, pageSize: payload.pageSize }, options);
    }
    if (kind === "list_recent_files") return await listRecentDriveFiles(payload, options);
    return driveResult("unsupported_action", "여기서는 Google Drive 파일 목록만 볼 수 있습니다.");
  } catch (error) {
    return driveResult(
      "google_drive_failed",
      "Google Drive 파일 목록을 불러오지 못했습니다. 기존 Drive 파일은 바꾸지 않았습니다.",
      { errorCode: driveErrorCode(error) },
    );
  }
}

/** 최근에 고친 파일부터(폴더 제외). 이름 일부로 찾을 수 있다. */
async function listRecentDriveFiles(payload, options) {
  const credential = await requireDriveCredential(options);
  const search = safeText(payload?.query, 80);
  const clauses = ["trashed = false", `mimeType != '${folderMimeType}'`];
  if (search) clauses.push(`name contains '${escapeDriveQueryValue(search)}'`);
  const url = new URL(`${googleDriveApiBase}/files`);
  url.searchParams.set("q", clauses.join(" and "));
  url.searchParams.set("pageSize", String(clampNumber(payload?.pageSize, 1, 50, 30)));
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("fields", "files(id,name,mimeType,createdTime,modifiedTime,parents,size,webViewLink),nextPageToken");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  const json = await driveJsonFetch(url.toString(), { method: "GET" }, credential, options);
  const files = Array.isArray(json?.files) ? json.files.map(publicDriveFile).filter(Boolean) : [];
  return driveResult("google_drive_files_loaded", files.length ? "최근 Drive 파일을 불러왔습니다." : "조건에 맞는 Drive 파일이 없습니다.", {
    files,
    query: search,
    externalMutation: false,
  });
}

function assertTrustedDriveSender(event, options) {
  if (options.trustedDriveHandlerForTest === true) return;
  const sender = event?.sender;
  const frame = event?.senderFrame;
  if (!sender || !frame || !Number.isInteger(sender.id)) throw new Error("google_drive_untrusted_sender");
  if (sender.mainFrame && frame !== sender.mainFrame) throw new Error("google_drive_nested_frame_blocked");
  const senderUrl = String(frame.url || sender.getURL?.() || "");
  if (!senderUrl.startsWith("modycrew://") && !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/iu.test(senderUrl)) {
    throw new Error("google_drive_sender_origin_blocked");
  }
}



async function getDriveStatus(options) {
  const vault = await readDriveVault(options);
  const configured = Boolean(resolveDriveClientId(options));
  const credential = vault.credential ? await readDriveCredential(vault, options).catch(() => null) : null;
  return driveResult(
    credential?.accessToken ? "google_drive_connected" : configured ? "google_drive_not_connected" : "google_drive_client_required",
    credential?.accessToken
      ? "회사 Google Drive가 연결되어 있습니다. 업로드나 기존 파일 이동은 실행 전 다시 확인합니다."
      : configured
        ? "회사 Google Drive를 연결하면 생성 문서를 올리고 선택한 파일을 정리할 수 있습니다."
        : "Google Drive OAuth 클라이언트 설정이 필요합니다.",
    {
      configured,
      connected: Boolean(credential?.accessToken),
      grantedScope: vault.scope === driveScope ? "file_read_write_folder_manage" : "",
      externalAuthorization: false,
    },
  );
}

async function startDriveConnection(options) {
  const clientId = resolveDriveClientId(options);
  if (!clientId) {
    return driveResult(
      "google_drive_client_required",
      "Google Cloud의 데스크톱 OAuth 클라이언트 ID를 MODYCREW_GOOGLE_DRIVE_CLIENT_ID 또는 MODYCREW_GOOGLE_OAUTH_CLIENT_ID에 설정한 뒤 연결해 주세요.",
      { configured: false, externalAuthorization: false },
    );
  }
  if (!canSecurelyStoreDriveCredential(options)) {
    return driveResult(
      "google_drive_secure_storage_required",
      "이 PC의 보안 저장소를 사용할 수 없어 Google Drive 토큰을 저장하지 않았습니다.",
      { configured: true, externalAuthorization: false },
    );
  }
  if (activeConnection && Date.now() - activeConnection.startedAt < 90_000) {
    return driveResult("google_drive_connecting", "이미 열린 브라우저에서 회사 Google 계정 연결을 마쳐 주세요.", {
      configured: true,
      externalAuthorization: true,
      authorizationUrl: activeConnection.authorizationUrl,
    });
  }
  activeConnection?.cancel?.("이전 Google Drive 연결 세션을 새 요청으로 교체했습니다.");

  const state = base64Url(crypto.randomBytes(24));
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return await new Promise((resolve) => {
    let settled = false;
    const sessionId = crypto.randomUUID();
    let server;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        server?.close();
      } catch {
        // 이미 닫힌 callback 서버는 무시합니다.
      }
      if (activeConnection?.id === sessionId) activeConnection = null;
      resolve(driveResult(result.status, result.userMessage, {
        configured: true,
        externalAuthorization: true,
        ...result,
      }));
    };
    const timeout = setTimeout(() => {
      finish({ status: "google_drive_connect_timeout", userMessage: "Google Drive 연결 응답이 시간 안에 오지 않았습니다. 다시 시도해 주세요." });
    }, connectionTimeoutMs);

    server = createServer(async (request, response) => {
      const port = server.address()?.port;
      const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      if (requestUrl.pathname !== callbackPath) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }
      const returnedState = requestUrl.searchParams.get("state") ?? "";
      const code = requestUrl.searchParams.get("code") ?? "";
      const oauthError = requestUrl.searchParams.get("error") ?? "";
      if (oauthError) {
        response.statusCode = 400;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(renderCallbackPage("연결 취소", "Google Drive 권한 연결이 취소되었습니다.", false));
        finish({ status: "google_drive_connect_denied", userMessage: "Google Drive 연결이 취소되었습니다." });
        return;
      }
      if (!code || returnedState !== state) {
        response.statusCode = 400;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(renderCallbackPage("연결 실패", "인증 확인 값이 맞지 않습니다. 앱에서 다시 시도해 주세요.", false));
        finish({ status: "google_drive_state_mismatch", userMessage: "Google Drive 연결 검증값이 맞지 않아 중단했습니다." });
        return;
      }
      try {
        const redirectUri = `http://127.0.0.1:${port}${callbackPath}`;
        const token = await exchangeAuthorizationCode({ code, verifier, redirectUri, clientId, options });
        if (!token.access_token) throw new Error("google_drive_token_missing");
        const previous = await readDriveVault(options);
        const previousCredential = await readStoredDriveCredential(previous, options);
        const credential = {
          accessToken: String(token.access_token),
          refreshToken: String(token.refresh_token || previousCredential?.refreshToken || ""),
          expiresAt: Date.now() + Math.max(60, Number(token.expires_in ?? 3600)) * 1000,
          tokenType: String(token.token_type ?? "Bearer"),
        };
        await writeDriveVault({
          schema: "modycrew.google-drive.v1",
          scope: driveScope,
          connectedAt: new Date().toISOString(),
          credential: encryptDriveCredential(credential, options),
        }, options);
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(renderCallbackPage("연결 완료", "ModyCrew 앱으로 돌아가 영수증 문서를 저장할 수 있습니다.", true));
        finish({ status: "google_drive_connected", userMessage: "회사 Google Drive 연결을 마쳤습니다. 파일 업로드와 이동은 실행 전 다시 확인합니다.", connected: true });
      } catch (error) {
        response.statusCode = 500;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(renderCallbackPage("연결 실패", "Google Drive 토큰을 안전하게 저장하지 못했습니다. 앱에서 다시 시도해 주세요.", false));
        finish({ status: "google_drive_token_failed", userMessage: "Google Drive 연결을 마무리하지 못했습니다." });
      }
    });
    server.once("error", () => finish({ status: "google_drive_callback_failed", userMessage: "Google Drive 연결용 로컬 수신 서버를 열지 못했습니다." }));
    server.listen(0, "127.0.0.1", async () => {
      const port = server.address()?.port;
      const redirectUri = `http://127.0.0.1:${port}${callbackPath}`;
      const url = new URL(googleAuthorizeUrl);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", driveScope);
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent select_account");
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", state);
      activeConnection = {
        id: sessionId,
        startedAt: Date.now(),
        authorizationUrl: url.toString(),
        cancel: (userMessage) => finish({ status: "google_drive_connect_cancelled", userMessage }),
      };
      try {
        await openGoogleAuthorizationUrl(options.shell, url.toString());
      } catch {
        finish({ status: "google_drive_browser_failed", userMessage: "기본 브라우저를 열지 못했습니다. 앱에서 다시 시도해 주세요." });
      }
    });
  });
}

async function listDriveFiles(payload, options) {
  const credential = await requireDriveCredential(options);
  const parentId = normalizeDriveId(payload.parentId) || "root";
  const driveId = normalizeDriveId(payload.driveId);
  const query = `'${parentId}' in parents and trashed = false`;
  const url = new URL(`${googleDriveApiBase}/files`);
  url.searchParams.set("q", query);
  url.searchParams.set("pageSize", String(clampNumber(payload.pageSize, 1, 100, 50)));
  url.searchParams.set("orderBy", "folder,name_natural");
  url.searchParams.set("fields", "files(id,name,mimeType,createdTime,modifiedTime,parents,size,webViewLink),nextPageToken");
  appendSharedDriveParams(url, driveId);
  const json = await driveJsonFetch(url.toString(), { method: "GET" }, credential, options);
  const files = Array.isArray(json?.files) ? json.files.map(publicDriveFile).filter(Boolean) : [];
  return driveResult("google_drive_files_loaded", "선택한 Drive 폴더의 파일을 불러왔습니다.", {
    files,
    parentId,
    nextPageToken: safeText(json?.nextPageToken, 240),
    externalMutation: false,
  });
}

async function previewReceiptUpload(payload, options) {
  const artifact = await resolveReceiptArtifactForDrive(payload.artifactId, options);
  const reviewIssues = receiptDriveReviewIssues(artifact);
  if (reviewIssues.length) {
    return driveResult("receipt_review_required", "\u0044rive\uC5D0 \uC800\uC7A5\uD558\uAE30 \uC804\uC5D0 \uC0AC\uC6A9 \uC77C\uC790, \uC0AC\uC6A9\uCC98, \uD569\uACC4 \uAE08\uC561\uC744 \uD655\uC778 \uC644\uB8CC\uB85C \uC800\uC7A5\uD574 \uC8FC\uC138\uC694.", {
      artifactId: artifact.artifactId,
      reviewIssues,
      finalApprovalRequired: false,
    });
  }
  const rootFolderId = normalizeDriveId(payload.rootFolderId) || "root";
  const fileSnapshots = await createLocalFileSnapshots(artifact.files);
  return driveResult("google_drive_upload_preview", "Drive에 올릴 파일과 폴더 경로를 확인하세요.", {
    artifactId: artifact.artifactId,
    rootFolderId,
    targetFolders: artifact.folderSegments,
    files: artifact.files.map((file) => ({ name: file.name, sizeBytes: file.sizeBytes, mimeType: file.mimeType })),
    fileSnapshots,
    finalApprovalRequired: true,
    confirmationText: "드라이브에 저장",
  });
}

async function uploadReceipt(payload, options) {
  if (payload.finalApproval !== true || normalizeConfirmation(payload.confirmationText) !== "드라이브에 저장") {
    return driveResult("google_drive_upload_approval_required", "Drive 업로드는 파일과 경로를 확인한 뒤 ‘드라이브에 저장’으로 승인해야 합니다.", {
      finalApprovalRequired: true,
      confirmationText: "드라이브에 저장",
    });
  }
  const credential = await requireDriveCredential(options);
  const artifact = await resolveReceiptArtifactForDrive(payload.artifactId, options);
  const reviewIssues = receiptDriveReviewIssues(artifact);
  if (reviewIssues.length) {
    return driveResult("receipt_review_required", "\u0044rive\uC5D0 \uC800\uC7A5\uD558\uAE30 \uC804\uC5D0 \uC0AC\uC6A9 \uC77C\uC790, \uC0AC\uC6A9\uCC98, \uD569\uACC4 \uAE08\uC561\uC744 \uD655\uC778 \uC644\uB8CC\uB85C \uC800\uC7A5\uD574 \uC8FC\uC138\uC694.", {
      artifactId: artifact.artifactId,
      reviewIssues,
      finalApprovalRequired: false,
    });
  }
  const expectedFiles = Array.isArray(payload.expectedFiles) ? payload.expectedFiles : [];
  const currentFiles = await createLocalFileSnapshots(artifact.files);
  if (!expectedFiles.length || !sameLocalFileSnapshots(expectedFiles, currentFiles)) {
    return driveResult("google_drive_preview_stale", "\uBBF8\uB9AC\uBCF4\uAE30 \uB4A4 \uC800\uC7A5\uD560 \uD30C\uC77C\uC774 \uBC14\uB00C\uC5C8\uC2B5\uB2C8\uB2E4. \uD30C\uC77C\uACFC \uACBD\uB85C\uB97C \uB2E4\uC2DC \uD655\uC778\uD574 \uC8FC\uC138\uC694.", {
      artifactId: artifact.artifactId,
      finalApprovalRequired: true,
      confirmationText: "\uB4DC\uB77C\uC774\uBE0C\uC5D0 \uC800\uC7A5",
    });
  }
  const rootFolderId = normalizeDriveId(payload.rootFolderId) || "root";
  const driveId = normalizeDriveId(payload.driveId);
  const folder = await ensureDriveFolderPath(rootFolderId, artifact.folderSegments, credential, driveId, options);
  const uploaded = [];
  const failures = [];
  for (const file of artifact.files) {
    try {
      uploaded.push(await uploadDriveFile(file, folder.id, credential, driveId, options));
    } catch (error) {
      failures.push({ name: file.name, errorCode: driveErrorCode(error) });
    }
  }
  if (failures.length) {
    return driveResult(
      "google_drive_receipt_upload_partial",
      uploaded.length + "\uAC1C \uD30C\uC77C\uC740 \uC800\uC7A5\uD588\uACE0 " + failures.length + "\uAC1C \uD30C\uC77C\uC740 \uC800\uC7A5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
      {
        artifactId: artifact.artifactId,
        targetFolder: publicDriveFile(folder),
        uploadedFiles: uploaded.map(publicDriveFile),
        failedFiles: failures,
        executionReceipt: {
          operation: "receipt_upload",
          artifactId: artifact.artifactId,
          rootFolderId,
          targetFolderId: folder.id,
          uploadedCount: uploaded.length,
          failedCount: failures.length,
          completedAt: new Date().toISOString(),
          externalMutation: true,
        },
        externalMutation: true,
      },
    );
  }
  return driveResult("google_drive_receipt_uploaded", `${uploaded.length}개 파일을 회사 Google Drive에 저장했습니다.`, {
    artifactId: artifact.artifactId,
    targetFolder: publicDriveFile(folder),
    uploadedFiles: uploaded.map(publicDriveFile),
    executionReceipt: {
      operation: "receipt_upload",
      artifactId: artifact.artifactId,
      rootFolderId,
      targetFolderId: folder.id,
      uploadedCount: uploaded.length,
      completedAt: new Date().toISOString(),
      externalMutation: true,
    },
    externalMutation: true,
  });
}

async function previewOrganization(payload, options) {
  const credential = await requireDriveCredential(options);
  const fileIds = normalizeDriveIds(payload.fileIds);
  if (!fileIds.length) {
    return driveResult("google_drive_files_required", "정리할 Drive 파일을 먼저 선택해 주세요.", { operations: [] });
  }
  const rootFolderId = normalizeDriveId(payload.rootFolderId) || "root";
  const driveId = normalizeDriveId(payload.driveId);
  const files = await Promise.all(fileIds.map((id) => getDriveFile(id, credential, driveId, options)));
  const operations = files.filter((file) => file && file.mimeType !== folderMimeType).map(buildDriveOrganizationOperation);
  return driveResult("google_drive_organization_preview", "선택한 파일의 이동 계획입니다. 원본 파일을 삭제하거나 공유 권한을 바꾸지 않습니다.", {
    rootFolderId,
    operations,
    finalApprovalRequired: true,
    confirmationText: "선택 파일 정리",
  });
}

async function applyOrganization(payload, options) {
  if (payload.finalApproval !== true || normalizeConfirmation(payload.confirmationText) !== "선택 파일 정리") {
    return driveResult("google_drive_organization_approval_required", "선택한 Drive 파일 이동은 계획을 확인한 뒤 ‘선택 파일 정리’로 승인해야 합니다.", {
      finalApprovalRequired: true,
      confirmationText: "선택 파일 정리",
    });
  }
  const credential = await requireDriveCredential(options);
  const fileIds = normalizeDriveIds(payload.fileIds);
  if (!fileIds.length) return driveResult("google_drive_files_required", "정리할 Drive 파일을 먼저 선택해 주세요.", { operations: [] });
  const rootFolderId = normalizeDriveId(payload.rootFolderId) || "root";
  const driveId = normalizeDriveId(payload.driveId);
  const expectedOperations = Array.isArray(payload.expectedOperations) ? payload.expectedOperations : [];
  if (!expectedOperations.length) {
    return driveResult("google_drive_preview_stale", "\uBBF8\uB9AC\uBCF4\uAE30\uB97C \uB2E4\uC2DC \uC5F4\uC5B4 \uC774\uB3D9 \uB300\uC0C1\uACFC \uACBD\uB85C\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694.", {
      finalApprovalRequired: true,
      confirmationText: "\uC120\uD0DD \uD30C\uC77C \uC815\uB9AC",
    });
  }
  const currentFiles = await Promise.all(fileIds.map((id) => getDriveFile(id, credential, driveId, options)));
  const currentOperations = currentFiles.filter((file) => file && file.mimeType !== folderMimeType).map(buildDriveOrganizationOperation);
  if (!sameDriveOrganizationOperations(expectedOperations, currentOperations)) {
    return driveResult("google_drive_preview_stale", "\uBBF8\uB9AC\uBCF4\uAE30 \uB4A4 \uD30C\uC77C \uC0C1\uD0DC\uAC00 \uBC14\uB00C\uC5C8\uC2B5\uB2C8\uB2E4. \uC774\uB3D9 \uACC4\uD68D\uC744 \uB2E4\uC2DC \uD655\uC778\uD574 \uC8FC\uC138\uC694.", {
      finalApprovalRequired: true,
      confirmationText: "\uC120\uD0DD \uD30C\uC77C \uC815\uB9AC",
    });
  }
  const blockedOperations = currentOperations.filter((operation) => operation.action !== "move");
  if (blockedOperations.length) {
    return driveResult("google_drive_organization_blocked", "\uB0A0\uC9DC\uAC00 \uD655\uC778\uB418\uC9C0 \uC54A\uC558\uAC70\uB098 \uB450 \uAC1C \uC774\uC0C1\uC758 \uD3F4\uB354\uC5D0 \uC788\uB294 \uD30C\uC77C\uC740 \uC774\uB3D9\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.", {
      operations: currentOperations,
      blockedCount: blockedOperations.length,
      externalMutation: false,
    });
  }
  const moved = [];
  const skipped = [];
  const failures = [];
  for (const id of fileIds) {
    const file = await getDriveFile(id, credential, driveId, options);
    if (!file || file.mimeType === folderMimeType) {
      skipped.push(id);
      continue;
    }
    const date = driveDateParts(file.createdTime || file.modifiedTime);
    if (!date.isValid) {
      failures.push({ id, errorCode: "google_drive_date_required" });
      continue;
    }
    try {
      const destination = await ensureDriveFolderPath(rootFolderId, ["ModyCrew \uC815\uB9AC", date.year + "\uB144", date.month + "\uC6D4"], credential, driveId, options);
      moved.push(await moveDriveFile(file, destination.id, credential, driveId, options));
    } catch (error) {
      failures.push({ id, errorCode: driveErrorCode(error) });
    }
  }
  if (failures.length) {
    return driveResult(
      "google_drive_organization_partial",
      moved.length + "\uAC1C \uD30C\uC77C\uC744 \uC774\uB3D9\uD588\uACE0 " + failures.length + "\uAC1C \uD30C\uC77C\uC740 \uC774\uB3D9\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
      {
        movedFiles: moved.map(publicDriveFile),
        failedFiles: failures,
        skippedCount: skipped.length,
        executionReceipt: {
          operation: "selected_files_organization",
          movedCount: moved.length,
          failedCount: failures.length,
          skippedCount: skipped.length,
          rootFolderId,
          completedAt: new Date().toISOString(),
          externalMutation: true,
          deleted: false,
          permissionsChanged: false,
          accessInheritanceMayChange: true,
        },
        externalMutation: true,
      },
    );
  }
  return driveResult("google_drive_organization_applied", moved.length + "\uAC1C \uD30C\uC77C\uC744 \uB0A0\uC9DC\uBCC4 \uD3F4\uB354\uB85C \uC774\uB3D9\uD588\uC2B5\uB2C8\uB2E4. \uC0AD\uC81C\uB098 \uACF5\uC720 \uAD8C\uD55C \uD3B8\uC9D1\uC740 \uD558\uC9C0 \uC54A\uC558\uC9C0\uB9CC, \uC774\uB3D9 \uB300\uC0C1 \uD3F4\uB354\uC758 \uAE30\uC874 \uC811\uADFC \uADDC\uCE59\uC740 \uD655\uC778\uD574 \uC8FC\uC138\uC694.", {
    movedFiles: moved.map(publicDriveFile),
    skippedCount: skipped.length,
    executionReceipt: {
      operation: "selected_files_organization",
      movedCount: moved.length,
      skippedCount: skipped.length,
      rootFolderId,
      completedAt: new Date().toISOString(),
      externalMutation: true,
      deleted: false,
      permissionsChanged: false,
      accessInheritanceMayChange: true,
    },
    externalMutation: true,
  });
}

async function ensureDriveFolderPath(rootFolderId, segments, credential, driveId, options) {
  let parentId = rootFolderId;
  let last = null;
  for (const rawSegment of segments) {
    const name = safeFolderName(rawSegment);
    const existing = await findDriveFolder(parentId, name, credential, driveId, options);
    last = existing ?? await createDriveFolder(parentId, name, credential, driveId, options);
    parentId = last.id;
  }
  return last ?? { id: rootFolderId, name: "내 드라이브", mimeType: folderMimeType };
}

async function findDriveFolder(parentId, name, credential, driveId, options) {
  const url = new URL(`${googleDriveApiBase}/files`);
  url.searchParams.set("q", `mimeType = '${folderMimeType}' and '${escapeDriveQueryValue(parentId)}' in parents and name = '${escapeDriveQueryValue(name)}' and trashed = false`);
  url.searchParams.set("pageSize", "1");
  url.searchParams.set("fields", "files(id,name,mimeType,parents,webViewLink)");
  appendSharedDriveParams(url, driveId);
  const json = await driveJsonFetch(url.toString(), { method: "GET" }, credential, options);
  return Array.isArray(json?.files) && json.files[0] ? json.files[0] : null;
}

async function createDriveFolder(parentId, name, credential, driveId, options) {
  const url = new URL(`${googleDriveApiBase}/files`);
  url.searchParams.set("fields", "id,name,mimeType,parents,webViewLink");
  appendSharedDriveParams(url, driveId);
  return await driveJsonFetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: folderMimeType, parents: [parentId] }),
  }, credential, options);
}

async function getDriveFile(id, credential, driveId, options) {
  const url = new URL(`${googleDriveApiBase}/files/${encodeURIComponent(id)}`);
  url.searchParams.set("fields", "id,name,mimeType,createdTime,modifiedTime,parents,size,webViewLink");
  appendSharedDriveParams(url, driveId);
  return await driveJsonFetch(url.toString(), { method: "GET" }, credential, options);
}

async function moveDriveFile(file, targetFolderId, credential, driveId, options) {
  const parents = normalizeDriveIds(file?.parents);
  if (parents.length !== 1) throw new Error("google_drive_multi_parent_blocked");
  const url = new URL(`${googleDriveApiBase}/files/${encodeURIComponent(file.id)}`);
  url.searchParams.set("addParents", targetFolderId);
  url.searchParams.set("removeParents", parents[0]);
  url.searchParams.set("fields", "id,name,mimeType,createdTime,modifiedTime,parents,size,webViewLink");
  appendSharedDriveParams(url, driveId);
  return await driveJsonFetch(url.toString(), { method: "PATCH" }, credential, options);
}

async function uploadDriveFile(file, parentId, credential, driveId, options) {
  const boundary = `modycrew-${crypto.randomUUID()}`;
  const metadata = Buffer.from(JSON.stringify({ name: file.name, parents: [parentId] }), "utf8");
  const content = await fs.readFile(file.path);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, "utf8"),
    metadata,
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${file.mimeType || "application/octet-stream"}\r\n\r\n`, "utf8"),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
  const url = new URL(`${googleDriveUploadBase}/files`);
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,name,mimeType,createdTime,modifiedTime,parents,size,webViewLink");
  appendSharedDriveParams(url, driveId);
  return await driveJsonFetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  }, credential, options);
}

async function requireDriveCredential(options) {
  const vault = await readDriveVault(options);
  if (!vault.credential) throw new Error("google_drive_not_connected");
  return await readDriveCredential(vault, options);
}

async function readStoredDriveCredential(vault, options) {
  if (!canSecurelyStoreDriveCredential(options)) return null;
  const encrypted = String(vault?.credential ?? "");
  if (!encrypted) return null;
  try {
    const raw = options.safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    const credential = JSON.parse(raw);
    return credential && typeof credential === "object" ? credential : null;
  } catch {
    return null;
  }
}


async function readDriveCredential(vault, options) {
  if (!canSecurelyStoreDriveCredential(options)) throw new Error("google_drive_secure_storage_required");
  const encrypted = String(vault?.credential ?? "");
  if (!encrypted) throw new Error("google_drive_not_connected");
  const raw = options.safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  const credential = JSON.parse(raw);
  if (!credential?.accessToken) throw new Error("google_drive_credential_invalid");
  if (Number(credential.expiresAt) > Date.now() + 60_000) return credential;
  if (!credential.refreshToken || !resolveDriveClientId(options)) throw new Error("google_drive_reconnect_required");
  const refreshed = await refreshDriveCredential(credential, options);
  const next = { ...credential, ...refreshed };
  await writeDriveVault({
    ...vault,
    credential: encryptDriveCredential(next, options),
    updatedAt: new Date().toISOString(),
  }, options);
  return next;
}

async function refreshDriveCredential(credential, options) {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: String(credential.refreshToken),
    client_id: resolveDriveClientId(options),
  });
  const secret = resolveDriveClientSecret(options);
  if (secret) form.set("client_secret", secret);
  const response = await (options.fetch ?? globalThis.fetch)(googleTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.access_token) throw new Error("google_drive_refresh_failed");
  return {
    accessToken: String(json.access_token),
    refreshToken: String(json.refresh_token || credential.refreshToken),
    expiresAt: Date.now() + Math.max(60, Number(json.expires_in ?? 3600)) * 1000,
    tokenType: String(json.token_type ?? credential.tokenType ?? "Bearer"),
  };
}

async function exchangeAuthorizationCode({ code, verifier, redirectUri, clientId, options }) {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const secret = resolveDriveClientSecret(options);
  if (secret) form.set("client_secret", secret);
  const response = await (options.fetch ?? globalThis.fetch)(googleTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("google_drive_token_exchange_failed");
  return json;
}

/**
 * 구글 기본 문서(Docs/Sheets/Slides)는 원본 바이트가 없어 그대로 내려받을 수 없다.
 * 앱이 이미 읽을 수 있는 형식으로 내보내 받는다 —
 * docx 는 mammoth, xlsx 는 exceljs, pdf 는 pdf-parse 가 처리한다.
 */
const driveLearningExportTypes = {
  "application/vnd.google-apps.document": {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: ".docx",
  },
  "application/vnd.google-apps.spreadsheet": {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: ".xlsx",
  },
  "application/vnd.google-apps.presentation": {
    mimeType: "application/pdf",
    extension: ".pdf",
  },
};

/** 학습이 실제로 읽을 수 있는 형식만 받는다. 그 외는 받아도 쓰지 못한다. */
const driveLearningDirectTypes = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const driveLearningMaxFiles = 20;
const driveLearningMaxBytes = 20 * 1024 * 1024;

/** 파일 이름을 저장 가능한 형태로 정리한다. 경로 조작 문자를 남기지 않는다. */
function safeDriveFileName(name, fallbackId) {
  const raw = String(name ?? "").normalize("NFC");
  let cleaned = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0);
    const banned = code < 32 || ch === "<" || ch === ">" || ch === ":" || ch === '"' ||
      ch === "/" || ch === "|" || ch === "?" || ch === "*" || code === 92;
    cleaned += banned ? " " : ch;
  }
  cleaned = cleaned.split(/\s+/u).filter(Boolean).join(" ").trim();
  return (cleaned || `drive-${fallbackId}`).slice(0, 120);
}

async function driveBinaryFetch(url, credential, options) {
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${credential.accessToken}` },
  });
  if (!response.ok) {
    const status = Number(response.status ?? 0);
    if (status === 401) throw new Error("google_drive_reconnect_required");
    if (status === 403) throw new Error("google_drive_permission_denied");
    if (status === 404) throw new Error("google_drive_resource_not_found");
    throw new Error("google_drive_api_failed");
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * 고른 Drive 파일을 로컬로 받아 **학습 소스**로 넘길 수 있게 만든다.
 *
 * 학습 파이프라인은 로컬 경로(absolutePath)를 받는다. Drive 파일은 원격이라 그대로는
 * 넣을 수 없어, 기억 폴더 아래 drive-learning/ 에 받아 두고 그 경로를 돌려준다.
 * Drive 쪽은 읽기만 한다 — 원본을 옮기거나 바꾸지 않는다(externalMutation: false).
 */
async function downloadDriveFilesForLearning(payload, options) {
  const credential = await requireDriveCredential(options);
  const driveId = normalizeDriveId(payload.driveId);
  const ids = (Array.isArray(payload.fileIds) ? payload.fileIds : [])
    .map((value) => normalizeDriveId(value))
    .filter(Boolean)
    .slice(0, driveLearningMaxFiles);
  if (!ids.length) {
    return driveResult("google_drive_learning_no_files", "학습에 쓸 파일을 먼저 고르세요.");
  }

  /* 기억 폴더가 정해져 있으면 거기에, 아직이면 앱 데이터 폴더에 둔다.
     "받을 곳이 없다"는 이유로 기능을 막지 않는다 — 나중에 기억 폴더를 정하면 옮기면 된다. */
  const memoryRoot =
    (typeof options.localMemoryRoot === "string" ? options.localMemoryRoot.trim() : "") ||
    (typeof options.userDataPath === "string" ? options.userDataPath.trim() : "");
  if (!memoryRoot) {
    return driveResult(
      "google_drive_learning_memory_root_required",
      "받은 파일을 둘 위치를 찾지 못했습니다.",
    );
  }
  const targetRoot = path.join(memoryRoot, "drive-learning");
  await fs.mkdir(targetRoot, { recursive: true });

  const files = [];
  const skipped = [];
  for (const id of ids) {
    let meta;
    try {
      meta = await getDriveFile(id, credential, driveId, options);
    } catch {
      skipped.push({ id, reason: "파일 정보를 읽지 못했습니다." });
      continue;
    }
    const mimeType = String(meta?.mimeType ?? "");
    const displayName = safeText(meta?.name, 120);
    if (mimeType === folderMimeType) {
      skipped.push({ id, name: displayName, reason: "폴더는 학습에 바로 넣을 수 없습니다." });
      continue;
    }
    const exportType = driveLearningExportTypes[mimeType];
    if (!exportType && !driveLearningDirectTypes.has(mimeType)) {
      skipped.push({ id, name: displayName, reason: "앱이 읽을 수 없는 형식입니다." });
      continue;
    }
    if (!exportType && Number(meta?.size ?? 0) > driveLearningMaxBytes) {
      skipped.push({ id, name: displayName, reason: "20MB 를 넘어 건너뛰었습니다." });
      continue;
    }

    const url = exportType
      ? new URL(`${googleDriveApiBase}/files/${encodeURIComponent(id)}/export`)
      : new URL(`${googleDriveApiBase}/files/${encodeURIComponent(id)}`);
    if (exportType) url.searchParams.set("mimeType", exportType.mimeType);
    else url.searchParams.set("alt", "media");
    appendSharedDriveParams(url, driveId);

    let bytes;
    try {
      bytes = await driveBinaryFetch(url.toString(), credential, options);
    } catch {
      skipped.push({ id, name: displayName, reason: "받지 못했습니다." });
      continue;
    }
    if (bytes.byteLength > driveLearningMaxBytes) {
      skipped.push({ id, name: displayName, reason: "20MB 를 넘어 건너뛰었습니다." });
      continue;
    }

    const baseName = safeDriveFileName(meta?.name, id);
    const fileName =
      exportType && !baseName.toLowerCase().endsWith(exportType.extension)
        ? `${baseName}${exportType.extension}`
        : baseName;
    const absolutePath = path.join(targetRoot, fileName);
    await fs.writeFile(absolutePath, bytes);
    files.push({
      id,
      absolutePath,
      fileName,
      sizeBytes: bytes.byteLength,
      modifiedAt: safeText(meta?.modifiedTime, 40),
      sourceKind: "google_drive",
    });
  }

  if (!files.length) {
    return driveResult(
      "google_drive_learning_nothing_ready",
      "학습에 쓸 수 있는 파일이 없었습니다. 문서·표·PDF 를 골라 주세요.",
      { skipped, externalMutation: false },
    );
  }
  return driveResult(
    "google_drive_learning_files_ready",
    `Drive 파일 ${files.length}개를 받아 학습에 넣을 준비를 마쳤습니다. Drive 원본은 그대로입니다.`,
    { files, skipped, folder: targetRoot, externalMutation: false },
  );
}

async function driveJsonFetch(url, init, credential, options) {
  const headers = {
    Authorization: `Bearer ${credential.accessToken}`,
    ...(init.headers ?? {}),
  };
  const response = await (options.fetch ?? globalThis.fetch)(url, { ...init, headers });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = Number(response.status ?? 0);
    if (status === 401) throw new Error("google_drive_reconnect_required");
    if (status === 403) throw new Error("google_drive_permission_denied");
    if (status === 404) throw new Error("google_drive_resource_not_found");
    throw new Error("google_drive_api_failed");
  }
  return json;
}

function appendSharedDriveParams(url, driveId) {
  url.searchParams.set("supportsAllDrives", "true");
  if (driveId) {
    url.searchParams.set("driveId", driveId);
    url.searchParams.set("corpora", "drive");
    url.searchParams.set("includeItemsFromAllDrives", "true");
  }
}

function driveFileSnapshot(file) {
  return {
    id: normalizeDriveId(file?.id),
    createdTime: safeText(file?.createdTime, 48),
    modifiedTime: safeText(file?.modifiedTime, 48),
    parents: normalizeDriveIds(file?.parents).sort(),
  };
}

function buildDriveOrganizationOperation(file) {
  const date = driveDateParts(file?.createdTime || file?.modifiedTime);
  const parents = normalizeDriveIds(file?.parents);
  const moveAllowed = Boolean(date?.isValid && parents.length === 1);
  return {
    file: publicDriveFile(file),
    targetFolders: ["ModyCrew \uC815\uB9AC", date.year + "\uB144", date.month + "\uC6D4"],
    action: moveAllowed ? "move" : "blocked",
    reason: !date?.isValid ? "date_required" : parents.length !== 1 ? "multiple_parents" : "",
    snapshot: driveFileSnapshot(file),
  };
}

function sameDriveOrganizationOperations(expected, current) {
  const compact = (value) => (Array.isArray(value) ? value : [])
    .map((operation) => ({
      id: normalizeDriveId(operation?.file?.id ?? operation?.snapshot?.id),
      targetFolders: (Array.isArray(operation?.targetFolders) ? operation.targetFolders : []).map((item) => safeText(item, 120)),
      action: String(operation?.action ?? ""),
      reason: String(operation?.reason ?? ""),
      createdTime: safeText(operation?.snapshot?.createdTime, 48),
      modifiedTime: safeText(operation?.snapshot?.modifiedTime, 48),
      parents: normalizeDriveIds(operation?.snapshot?.parents).sort(),
    }))
    .filter((operation) => operation.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify(compact(expected)) === JSON.stringify(compact(current));
}


function receiptDriveReviewIssues(artifact) {
  const receipt = artifact?.receipt && typeof artifact.receipt === "object" ? artifact.receipt : {};
  const issues = [];
  if (receipt.reviewStatus !== "confirmed") issues.push("review_status");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(receipt.purchaseDate ?? ""))) issues.push("purchase_date");
  if (!safeText(receipt.merchantName, 100)) issues.push("merchant_name");
  if (!Number.isFinite(Number(receipt.totalAmount)) || Number(receipt.totalAmount) <= 0) issues.push("total_amount");
  return issues;
}

async function createLocalFileSnapshots(files) {
  return await Promise.all((Array.isArray(files) ? files : []).map(createLocalFileSnapshot));
}

async function createLocalFileSnapshot(file) {
  const filePath = String(file?.path ?? "").trim();
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error("receipt_file_snapshot_unavailable");
  const bytes = await fs.readFile(filePath);
  return {
    name: safeText(file?.name, 220),
    sizeBytes: stat.size,
    modifiedMs: Math.round(stat.mtimeMs),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function sameLocalFileSnapshots(expected, current) {
  const compact = (value) => (Array.isArray(value) ? value : [])
    .map((item) => ({
      name: safeText(item?.name, 220),
      sizeBytes: Number(item?.sizeBytes),
      modifiedMs: Number(item?.modifiedMs),
      sha256: String(item?.sha256 ?? "").toLowerCase(),
    }))
    .filter((item) => item.name && Number.isFinite(item.sizeBytes) && Number.isFinite(item.modifiedMs) && /^[a-f0-9]{64}$/u.test(item.sha256))
    .sort((left, right) => left.name.localeCompare(right.name));
  return JSON.stringify(compact(expected)) === JSON.stringify(compact(current));
}


function publicDriveFile(file) {
  const id = normalizeDriveId(file?.id);
  if (!id) return null;
  return {
    id,
    name: safeText(file?.name, 180) || "이름 없음",
    mimeType: safeText(file?.mimeType, 160),
    createdTime: safeText(file?.createdTime, 48),
    modifiedTime: safeText(file?.modifiedTime, 48),
    sizeBytes: Number.isFinite(Number(file?.size)) ? Number(file.size) : 0,
    webViewLink: safeHttpUrl(file?.webViewLink),
  };
}

function driveDateParts(value) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return { year: "\uAC80\uD1A0 \uD544\uC694", month: "\uB0A0\uC9DC \uD655\uC778 \uD544\uC694", isValid: false };
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, "0"),
    isValid: true,
  };
}

function resolveDriveClientId(options) {
  return String(
    options.googleDriveClientId ?? process.env.MODYCREW_GOOGLE_DRIVE_CLIENT_ID ?? process.env.MODYCREW_GOOGLE_OAUTH_CLIENT_ID ?? "",
  ).trim();
}

function resolveDriveClientSecret(options) {
  return String(
    options.googleDriveClientSecret ?? process.env.MODYCREW_GOOGLE_DRIVE_CLIENT_SECRET ?? process.env.MODYCREW_GOOGLE_OAUTH_CLIENT_SECRET ?? "",
  ).trim();
}

function canSecurelyStoreDriveCredential(options) {
  return Boolean(options.safeStorage?.isEncryptionAvailable?.() && typeof options.safeStorage?.encryptString === "function" && typeof options.safeStorage?.decryptString === "function");
}

function encryptDriveCredential(credential, options) {
  return options.safeStorage.encryptString(JSON.stringify(credential)).toString("base64");
}

function driveVaultPath(options) {
  const root = String(options.userDataPath ?? options.app?.getPath?.("userData") ?? "").trim() || path.join(os.homedir(), "AppData", "Roaming", "ModyCrew");
  return path.join(root, driveVaultFileName);
}

async function readDriveVault(options) {
  try {
    const parsed = JSON.parse(await fs.readFile(driveVaultPath(options), "utf8"));
    if (parsed && typeof parsed === "object") return parsed;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      // 토큰 원본을 노출하지 않고 미연결 상태로 되돌립니다.
    }
  }
  return { schema: "modycrew.google-drive.v1" };
}

async function writeDriveVault(value, options) {
  const target = driveVaultPath(options);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await fs.rename(temp, target);
}

async function openGoogleAuthorizationUrl(shell, value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "accounts.google.com" || url.pathname !== "/o/oauth2/v2/auth") {
    throw new Error("google_drive_authorization_url_invalid");
  }
  await openConnectionSetupUrl(shell, url.toString(), "google-drive");
}

function normalizeDriveId(value) {
  const id = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]{3,200}$/u.test(id) ? id : "";
}

function normalizeDriveIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(normalizeDriveId).filter(Boolean))].slice(0, 100);
}

function safeFolderName(value) {
  return safeText(value, 120).replace(/[<>:"/\\|?*]/g, " ").trim() || "미분류";
}

function safeText(value, maxLength) {
  return String(value ?? "").replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" && url.hostname.endsWith("google.com") ? url.toString() : "";
  } catch {
    return "";
  }
}

function escapeDriveQueryValue(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function normalizeConfirmation(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function renderCallbackPage(title, message, success) {
  const color = success ? "#137333" : "#b3261e";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ModyCrew Google Drive</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f8fafc;color:#172033}main{max-width:420px;padding:28px;border:1px solid #d7deea;background:#fff;border-radius:10px}h1{margin:0 0 10px;font-size:20px;color:${color}}p{margin:0;line-height:1.6}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function driveResult(status, userMessage, extra = {}) {
  return {
    status,
    userMessage,
    rawSecretMaterialReturned: false,
    rawSecretMaterialStored: false,
    ...extra,
  };
}

function driveErrorCode(error) {
  const message = String(error?.message ?? error ?? "");
  if (/not_connected/iu.test(message)) return "google_drive_not_connected";
  if (/reconnect|refresh/iu.test(message)) return "google_drive_reconnect_required";
  if (/permission/iu.test(message)) return "google_drive_permission_denied";
  if (/resource_not_found/iu.test(message)) return "google_drive_resource_not_found";
  if (/secure_storage/iu.test(message)) return "google_drive_secure_storage_required";
  return "google_drive_operation_failed";
}
