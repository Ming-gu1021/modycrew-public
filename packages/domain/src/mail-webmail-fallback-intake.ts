import type { ModyCredentialVaultReferenceInput } from "./connector-credential-vault.js";
import type { ModyProviderMailReadOutput } from "./provider-read-adapter.js";
import type { ISODateTimeString } from "./types.js";

export type ModyWebmailFallbackTwoFactorMode =
  | "disabled_by_user"
  | "manual_once_then_session"
  | "enabled_needs_user_presence"
  | "unknown";

export type ModyWebmailFallbackPlanStatus =
  | "ready_for_metadata_polling"
  | "needs_credential_reference"
  | "needs_browser_session"
  | "needs_user_two_factor"
  | "unsafe_secret_rejected"
  | "invalid_login_url";

export type ModyWebmailFallbackCredentialInput = {
  connectorId: string;
  providerLabel: string;
  loginUrl: string;
  accountReferenceId?: string;
  passwordReferenceId?: string;
  browserSessionReferenceId?: string;
  twoFactorMode: ModyWebmailFallbackTwoFactorMode;
  cadenceMinutes?: number;
  mailboxLabel?: string;
  createdAt: ISODateTimeString;
  rawUsername?: unknown;
  rawPassword?: unknown;
  rawSessionCookie?: unknown;
};

export type ModyWebmailFallbackVaultRecordInput = {
  connectorId?: string;
  method?: string;
  category?: string;
  status?: string;
  siteUrl?: string;
  siteHost?: string;
  siteLabel?: string;
  userMessage?: string;
  appPath?: string;
  secretFingerprint?: string;
  credentialReferenceId?: string;
  accountReferenceId?: string;
  usernameReferenceId?: string;
  passwordReferenceId?: string;
  secretReferenceId?: string;
  browserSessionReferenceId?: string;
  twoFactorMode?: ModyWebmailFallbackTwoFactorMode;
  cadenceMinutes?: number;
  mailboxLabel?: string;
  rawUsername?: unknown;
  rawPassword?: unknown;
  rawSessionCookie?: unknown;
};

export type ModyWebmailFallbackVaultRecordOptions = {
  createdAt?: ISODateTimeString;
  defaultTwoFactorMode?: ModyWebmailFallbackTwoFactorMode;
  defaultCadenceMinutes?: number;
  mailboxLabel?: string;
  assumeBrowserSessionReference?: boolean;
};

export type ModyWebmailFallbackCredentialReferences = {
  accountReferenceId?: string;
  passwordReferenceId?: string;
  browserSessionReferenceId?: string;
};

export type ModyWebmailFallbackPollingPlan = {
  status: ModyWebmailFallbackPlanStatus;
  connectorId: string;
  providerLabel: string;
  loginUrl: string;
  mailboxLabel: string;
  cadenceMinutes: number;
  nextUserAction: string;
  canRunWithoutUserPresence: boolean;
  readOnly: true;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  appMayPersistSecret: false;
  aiMayReadSecret: false;
  aiCredentialPolicy: "credential_reference_id_only";
  credentialReferences: ModyWebmailFallbackCredentialReferences;
  vaultReferenceInputs: ModyCredentialVaultReferenceInput[];
  browserAutomationContract: "webmail_login_reference_to_metadata_scan_to_approval_queue";
  secureIntakeContract: "metadata_first_secret_blind_mail_intake";
  stagePlan: string[];
  auditMessages: string[];
  userMessage: string;
};

export type ModyWebmailFallbackMessageMetadata = {
  messageId: string;
  senderPreview?: string;
  subject: string;
  receivedAt?: ISODateTimeString;
  threadId?: string;
  labels?: string[];
  hasAttachments?: boolean;
  metadataSnippet?: string;
};

export type ModyWebmailFallbackReadSnapshot = {
  plan: ModyWebmailFallbackPollingPlan;
  messages: ModyWebmailFallbackMessageMetadata[];
  checkedAt: ISODateTimeString;
  cursor?: string;
  rawPageHtmlStored?: false;
  rawBodyStored?: false;
};

export type ModyWebmailFallbackDomRowSnapshot = {
  rowId?: string;
  role?: string;
  ariaLabel?: string;
  textContent?: string;
  cells?: string[];
  hrefs?: string[];
  timeText?: string;
  labels?: string[];
  hasAttachmentIcon?: boolean;
  unread?: boolean;
};

export type ModyWebmailFallbackDomCaptureProfile = {
  profileId: string;
  hostKind: "google_workspace" | "microsoft_365" | "naver_works" | "kakao_daum" | "generic_groupware";
  providerLabel: string;
  mailboxLabel: string;
  semanticRowTargets: string[];
  requiredVisibleSignals: string[];
  blockedStateHints: string[];
  nextUserAction: string;
  maxRows: number;
  readOnly: true;
  externalMutation: false;
  rawSelectorStored: false;
  rawPageHtmlStored: false;
  rawBodyStored: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  auditMessages: string[];
};

export type ModyWebmailFallbackDomRecoveryGuide = {
  status:
    | "rows_ready"
    | "needs_login_or_two_factor"
    | "needs_mailbox_list_view"
    | "unsafe_snapshot_rejected"
    | "capture_unavailable";
  reasonLabel: string;
  nextUserAction: string;
  checklist: string[];
  readOnly: true;
  externalMutation: false;
  rawSelectorStored: false;
  rawPageHtmlStored: false;
  rawBodyStored: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ModyWebmailFallbackDomExtractionInput = {
  rows: ModyWebmailFallbackDomRowSnapshot[];
  checkedAt: ISODateTimeString;
  mailboxLabel?: string;
  maxRows?: number;
  rawPageHtmlStored?: false;
  rawBodyStored?: false;
};

export type ModyWebmailFallbackDomExtractionResult = {
  status: "metadata_extracted" | "empty" | "unsafe_snapshot_rejected";
  extractionContract: "browser_dom_rows_to_webmail_metadata_no_raw_html";
  bodyPreviewPolicy: "work_candidates_only_metadata_preview_no_raw_body";
  checkedAt: ISODateTimeString;
  rowCount: number;
  extractedCount: number;
  skippedCount: number;
  bodyPreviewAllowedCount: number;
  bodyPreviewSkippedBeforeBodyCount: number;
  bodyPreviewMaxChars: 420;
  messages: ModyWebmailFallbackMessageMetadata[];
  readOnly: true;
  externalMutation: false;
  rawPageHtmlStored: false;
  rawBodyStored: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  auditMessages: string[];
};

export function createWebmailDomCaptureProfile(input: {
  providerLabel?: string;
  loginUrl?: string;
  siteHost?: string;
  mailboxLabel?: string;
  maxRows?: number;
} = {}): ModyWebmailFallbackDomCaptureProfile {
  const providerLabel = sanitizeLabel(input.providerLabel, "회사/일반 웹메일");
  const mailboxLabel = sanitizeLabel(input.mailboxLabel, "받은메일함");
  const host = safeHostname(input.loginUrl || input.siteHost || "");
  const hostKind = classifyWebmailHost(host, providerLabel);
  const hostTargets = semanticTargetsForHost(hostKind);
  const requiredVisibleSignals = requiredVisibleSignalsForHost(hostKind, mailboxLabel);
  const blockedStateHints = blockedStateHintsForHost(hostKind);
  const maxRows = clampDomRowLimit(input.maxRows);
  return {
    profileId: `webmail-capture:${hostKind}`,
    hostKind,
    providerLabel,
    mailboxLabel,
    semanticRowTargets: hostTargets,
    requiredVisibleSignals,
    blockedStateHints,
    nextUserAction: `${providerLabel}에서 ${mailboxLabel} 목록 화면을 열고, 제목/보낸 사람/시간이 보이는 행이 1개 이상 보이게 둔 뒤 다시 점검합니다.`,
    maxRows,
    readOnly: true,
    externalMutation: false,
    rawSelectorStored: false,
    rawPageHtmlStored: false,
    rawBodyStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    auditMessages: [
      `웹메일 캡처 프로필: ${hostKind}`,
      `semantic row target ${hostTargets.length}개를 raw selector 저장 없이 사용합니다.`,
      `provider visible signal ${requiredVisibleSignals.length}개와 blocked hint ${blockedStateHints.length}개를 사용합니다.`,
      "DOM selector, 좌표, 픽셀 원문, raw HTML/body는 리포트에 저장하지 않습니다.",
    ],
  };
}

export function createWebmailDomRecoveryGuide(
  profile: ModyWebmailFallbackDomCaptureProfile,
  input: {
    captureStatus?: string;
    extractionStatus?: string;
    rowCount?: number;
    extractedCount?: number;
    unsafeSnapshotRejected?: boolean;
    capabilityMissing?: boolean;
  } = {},
): ModyWebmailFallbackDomRecoveryGuide {
  const rowCount = safeCount(input.rowCount);
  const extractedCount = safeCount(input.extractedCount);
  const captureStatus = String(input.captureStatus ?? "");
  const extractionStatus = String(input.extractionStatus ?? "");
  const base = {
    readOnly: true as const,
    externalMutation: false as const,
    rawSelectorStored: false as const,
    rawPageHtmlStored: false as const,
    rawBodyStored: false as const,
    rawSecretMaterialStored: false as const,
    rawSecretMaterialReturned: false as const,
  };

  if (input.unsafeSnapshotRejected === true || extractionStatus === "unsafe_snapshot_rejected") {
    return {
      ...base,
      status: "unsafe_snapshot_rejected",
      reasonLabel: "raw HTML/body 또는 script-like snapshot 감지",
      nextUserAction: "웹메일 본문/페이지 원문을 저장하지 말고 받은메일함 목록 행 메타데이터만 다시 캡처합니다.",
      checklist: [
        "원문 HTML, 본문, script-like 문자열 제거",
        "목록 행의 제목, 보낸 사람, 시간, 첨부 여부만 남기기",
        "비밀번호, 토큰, 세션 쿠키 원문이 없는지 확인",
      ],
    };
  }

  if (rowCount > 0 && extractedCount > 0) {
    return {
      ...base,
      status: "rows_ready",
      reasonLabel: "웹메일 목록 행 메타데이터 추출됨",
      nextUserAction: "오피스 승인함에서 업무 후보와 제외된 광고/뉴스레터 근거를 확인합니다.",
      checklist: [
        "업무 후보만 제한 preview",
        "광고/스팸은 본문 preview 전 제외",
        "발송, 일정 등록, 첨부 이동은 마지막 확인 전 잠금",
      ],
    };
  }

  if (/login|auth|2fa|two.?factor|session|expired|signin|sign-in|로그인|인증/u.test(captureStatus)) {
    return {
      ...base,
      status: "needs_login_or_two_factor",
      reasonLabel: "로그인 또는 2차 인증 확인 필요",
      nextUserAction: "사용자가 웹메일 로그인/2차 인증을 직접 완료한 뒤 브라우저 세션 참조만 저장하고 다시 점검합니다.",
      checklist: [
        "로그인 창에서 사용자가 직접 인증",
        "2차 인증값은 저장하지 않음",
        "인증 후 받은메일함 목록 화면으로 이동",
      ],
    };
  }

  if (captureStatus && !/captured|ready|ok|success/u.test(captureStatus)) {
    return {
      ...base,
      status: "capture_unavailable",
      reasonLabel: "웹메일 목록 행을 아직 캡처하지 못함",
      nextUserAction: profile.nextUserAction,
      checklist: profile.blockedStateHints.slice(0, 4),
    };
  }

  return {
    ...base,
    status: "needs_mailbox_list_view",
    reasonLabel: rowCount > 0 ? "목록 행 후보는 있으나 메일 메타데이터로 추출되지 않음" : "받은메일함 목록 화면 확인 필요",
    nextUserAction: profile.nextUserAction,
    checklist: profile.requiredVisibleSignals.slice(0, 4),
  };
}

export function createWebmailFallbackPollingPlan(
  input: ModyWebmailFallbackCredentialInput,
): ModyWebmailFallbackPollingPlan {
  const connectorId = sanitizeConnectorId(input.connectorId);
  const providerLabel = sanitizeLabel(input.providerLabel, "회사/일반 웹메일");
  const mailboxLabel = sanitizeLabel(input.mailboxLabel, "받은메일함");
  const cadenceMinutes = clampCadenceMinutes(input.cadenceMinutes);
  const loginUrl = sanitizeLoginUrl(input.loginUrl);
  const credentialReferences = credentialReferencesFor(input);
  const base = {
    connectorId,
    providerLabel,
    loginUrl: loginUrl || input.loginUrl,
    mailboxLabel,
    cadenceMinutes,
    readOnly: true as const,
    externalMutation: false as const,
    rawSecretMaterialStored: false as const,
    rawSecretMaterialReturned: false as const,
    appMayPersistSecret: false as const,
    aiMayReadSecret: false as const,
    aiCredentialPolicy: "credential_reference_id_only" as const,
    credentialReferences,
    vaultReferenceInputs: vaultReferenceInputsFor(input, connectorId),
    browserAutomationContract: "webmail_login_reference_to_metadata_scan_to_approval_queue" as const,
    secureIntakeContract: "metadata_first_secret_blind_mail_intake" as const,
  };

  if (hasRawSecret(input)) {
    return finishPlan({
      ...base,
      status: "unsafe_secret_rejected",
      canRunWithoutUserPresence: false,
      nextUserAction: "아이디/비밀번호/세션 원문은 앱 상태나 AI에게 넘기지 말고 OS 보안 저장소나 회사 보안 저장소에 먼저 저장해야 합니다.",
      stagePlan: ["credential 원문 제거", "보안 저장소 참조 ID 생성", "웹메일 점검 다시 연결"],
    });
  }

  if (!loginUrl) {
    return finishPlan({
      ...base,
      status: "invalid_login_url",
      canRunWithoutUserPresence: false,
      nextUserAction: "https 웹메일 로그인 주소를 입력해야 합니다.",
      stagePlan: ["웹메일 로그인 주소 확인", "보안 저장소 참조 ID 확인"],
    });
  }

  if (!credentialReferences.passwordReferenceId && !credentialReferences.browserSessionReferenceId) {
    return finishPlan({
      ...base,
      status: "needs_credential_reference",
      canRunWithoutUserPresence: false,
      nextUserAction: "비밀번호 원문 대신 passwordReferenceId 또는 browserSessionReferenceId를 먼저 등록해야 합니다.",
      stagePlan: ["OS/회사 보안 저장소에 계정 정보 저장", "참조 ID만 연결", "5분 점검은 기본 꺼짐으로 대기"],
    });
  }

  if (input.twoFactorMode === "enabled_needs_user_presence" || input.twoFactorMode === "unknown") {
    return finishPlan({
      ...base,
      status: "needs_user_two_factor",
      canRunWithoutUserPresence: false,
      nextUserAction: "2차 인증이 켜져 있거나 상태가 불명확해 첫 로그인은 사용자가 직접 승인해야 합니다.",
      stagePlan: [
        "사용자가 웹메일 로그인 창에서 2차 인증 완료",
        "브라우저 세션 참조만 저장",
        "이후 5분 점검은 세션 참조로 메타데이터만 읽기",
      ],
    });
  }

  if (!credentialReferences.browserSessionReferenceId && input.twoFactorMode === "manual_once_then_session") {
    return finishPlan({
      ...base,
      status: "needs_browser_session",
      canRunWithoutUserPresence: false,
      nextUserAction: "첫 로그인 후 browserSessionReferenceId를 만든 뒤 자동 점검을 켤 수 있습니다.",
      stagePlan: ["사용자 로그인", "세션 참조 저장", "메일 메타데이터 점검 시작"],
    });
  }

  return finishPlan({
    ...base,
    status: "ready_for_metadata_polling",
    canRunWithoutUserPresence: true,
    nextUserAction: "사용자가 자동 점검을 켜면 5분마다 웹메일 메타데이터를 읽고 업무 후보만 승인함에 올립니다.",
    stagePlan: [
      "웹메일 로그인은 보안 저장소/브라우저 세션 참조로만 수행",
      "받은메일함 목록에서 보낸 사람, 제목, 날짜, 첨부 여부만 먼저 스캔",
      "광고/뉴스레터/스팸 후보는 본문 preview 없이 제외",
      "업무 후보만 제한 preview를 secure intake에 전달",
      "답장, 미팅, 첨부 정리는 오피스 승인함 후보로 생성",
      "메일 발송, 일정 등록, 첨부 이동/삭제는 사용자 최종 승인 전까지 잠금",
    ],
  });
}

export function createWebmailFallbackPollingPlanFromVaultRecord(
  record: ModyWebmailFallbackVaultRecordInput,
  options: ModyWebmailFallbackVaultRecordOptions = {},
): ModyWebmailFallbackPollingPlan {
  const connectorId = sanitizeConnectorId(
    record.connectorId || record.siteHost || record.siteLabel || "company-webmail",
  );
  const referenceRoot = `os-keychain:/modycrew/${safeId(connectorId)}`;
  const accountReferenceId = firstSafeReference(record.accountReferenceId, record.usernameReferenceId);
  const passwordReferenceId =
    firstSafeReference(record.passwordReferenceId, record.credentialReferenceId, record.secretReferenceId) ||
    (record.secretFingerprint ? `${referenceRoot}/site-login-secret` : undefined);
  const browserSessionReferenceId =
    firstSafeReference(record.browserSessionReferenceId) ||
    (options.assumeBrowserSessionReference ? `${referenceRoot}/browser-session` : undefined);
  const credentialInput: ModyWebmailFallbackCredentialInput = {
    connectorId,
    providerLabel: record.siteLabel || record.userMessage || record.siteHost || "회사/일반 웹메일",
    loginUrl: inferVaultRecordLoginUrl(record),
    twoFactorMode: normalizeTwoFactorMode(record.twoFactorMode || options.defaultTwoFactorMode || "unknown"),
    cadenceMinutes: record.cadenceMinutes ?? options.defaultCadenceMinutes ?? 5,
    mailboxLabel: record.mailboxLabel || options.mailboxLabel || "받은메일함",
    createdAt: options.createdAt || new Date().toISOString(),
  };

  if (accountReferenceId) credentialInput.accountReferenceId = accountReferenceId;
  if (passwordReferenceId) credentialInput.passwordReferenceId = passwordReferenceId;
  if (browserSessionReferenceId) credentialInput.browserSessionReferenceId = browserSessionReferenceId;
  if (record.rawUsername !== undefined) credentialInput.rawUsername = record.rawUsername;
  if (record.rawPassword !== undefined) credentialInput.rawPassword = record.rawPassword;
  if (record.rawSessionCookie !== undefined) credentialInput.rawSessionCookie = record.rawSessionCookie;

  return createWebmailFallbackPollingPlan(credentialInput);
}

export function extractWebmailMetadataFromDomSnapshot(
  input: ModyWebmailFallbackDomExtractionInput,
): ModyWebmailFallbackDomExtractionResult {
  if (input.rawPageHtmlStored !== false && input.rawPageHtmlStored !== undefined) {
    return createDomExtractionResult(input, [], "unsafe_snapshot_rejected", input.rows?.length ?? 0);
  }

  if (input.rawBodyStored !== false && input.rawBodyStored !== undefined) {
    return createDomExtractionResult(input, [], "unsafe_snapshot_rejected", input.rows?.length ?? 0);
  }

  const rows = Array.isArray(input.rows) ? input.rows.slice(0, clampDomRowLimit(input.maxRows)) : [];
  if (rows.some(hasUnsafeRawMarkup)) {
    return createDomExtractionResult(input, [], "unsafe_snapshot_rejected", rows.length);
  }

  const messages = rows
    .map((row, index) => domRowToMessageMetadata(row, input, index))
    .filter((message): message is ModyWebmailFallbackMessageMetadata => Boolean(message));

  return createDomExtractionResult(
    input,
    messages,
    messages.length > 0 ? "metadata_extracted" : "empty",
    rows.length - messages.length,
  );
}

export function createProviderMailReadFromWebmailFallback(
  input: ModyWebmailFallbackReadSnapshot,
): ModyProviderMailReadOutput {
  if (input.plan.status !== "ready_for_metadata_polling") {
    throw new Error(`웹메일 fallback provider read는 준비된 계획만 받을 수 있습니다: ${input.plan.status}`);
  }

  if (input.rawPageHtmlStored !== false && input.rawPageHtmlStored !== undefined) {
    throw new Error("웹메일 fallback read snapshot은 raw page HTML을 저장할 수 없습니다.");
  }

  if (input.rawBodyStored !== false && input.rawBodyStored !== undefined) {
    throw new Error("웹메일 fallback read snapshot은 raw mail body를 저장할 수 없습니다.");
  }

  return {
    status: "read_completed",
    action: "list_mail_messages",
    connectorId: input.plan.connectorId,
    providerId: "webmail",
    externalMutation: false,
    rawSecretMaterialStored: false,
    credentialReferenceId:
      input.plan.credentialReferences.browserSessionReferenceId ||
      input.plan.credentialReferences.passwordReferenceId ||
      input.plan.credentialReferences.accountReferenceId ||
      `webmail-reference:${input.plan.connectorId}`,
    messages: input.messages.map((message) => toProviderMessage(message, input)),
    sourceMetadata: {
      connectorName: `${input.plan.providerLabel} 웹메일`,
      sourceUri: `webmail:${input.plan.connectorId}:${input.plan.mailboxLabel}`,
    },
    auditMessage: `${input.plan.providerLabel} 웹메일에서 목록 메타데이터 ${input.messages.length}건을 읽기 전용 업무 후보로 변환했습니다.`,
  };
}

function createDomExtractionResult(
  input: ModyWebmailFallbackDomExtractionInput,
  messages: ModyWebmailFallbackMessageMetadata[],
  status: ModyWebmailFallbackDomExtractionResult["status"],
  skippedCount: number,
): ModyWebmailFallbackDomExtractionResult {
  const rowCount = Array.isArray(input.rows) ? input.rows.length : 0;
  const bodyPreviewAllowedCount = status === "metadata_extracted"
    ? messages.filter((message) => !isNoiseWebmailMessage(message)).length
    : 0;
  const bodyPreviewSkippedBeforeBodyCount = status === "metadata_extracted"
    ? messages.length - bodyPreviewAllowedCount + Math.max(0, skippedCount)
    : Math.max(0, skippedCount);
  return {
    status,
    extractionContract: "browser_dom_rows_to_webmail_metadata_no_raw_html",
    bodyPreviewPolicy: "work_candidates_only_metadata_preview_no_raw_body",
    checkedAt: input.checkedAt,
    rowCount,
    extractedCount: messages.length,
    skippedCount: Math.max(0, skippedCount),
    bodyPreviewAllowedCount,
    bodyPreviewSkippedBeforeBodyCount,
    bodyPreviewMaxChars: 420,
    messages,
    readOnly: true,
    externalMutation: false,
    rawPageHtmlStored: false,
    rawBodyStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    auditMessages: [
      `웹메일 DOM 행 ${rowCount}개를 raw HTML 없이 메타데이터 후보로 점검했습니다.`,
      `추출 ${messages.length}건, 제외 ${Math.max(0, skippedCount)}건입니다.`,
      `업무 후보 제한 preview ${bodyPreviewAllowedCount}건, 광고/스팸 preview 전 제외 ${bodyPreviewSkippedBeforeBodyCount}건입니다.`,
      status === "unsafe_snapshot_rejected"
        ? "raw HTML/body 또는 script-like snapshot이 감지되어 웹메일 목록 읽기를 중단했습니다."
        : "보낸 사람/제목/시간/첨부 여부 수준의 목록 메타데이터만 다음 단계로 전달했습니다.",
    ],
  };
}

function finishPlan(
  plan: Omit<ModyWebmailFallbackPollingPlan, "auditMessages" | "userMessage">,
): ModyWebmailFallbackPollingPlan {
  return {
    ...plan,
    auditMessages: [
      `웹메일 fallback 상태: ${plan.status}`,
      `점검 주기: ${plan.cadenceMinutes}분`,
      `credential 참조: ${Object.values(plan.credentialReferences).filter(Boolean).length}개`,
      "AI에는 credential 원문을 전달하지 않습니다.",
      "외부 발송, 일정 등록, 첨부 이동/삭제는 승인 전 실행하지 않습니다.",
    ],
    userMessage: `${plan.providerLabel} 웹메일 점검: ${plan.nextUserAction}`,
  };
}

function vaultReferenceInputsFor(
  input: ModyWebmailFallbackCredentialInput,
  connectorId: string,
): ModyCredentialVaultReferenceInput[] {
  const records: ModyCredentialVaultReferenceInput[] = [];
  if (input.accountReferenceId) {
    records.push({
      connectorId,
      secretKind: "mail_account_username",
      storage: "os_keychain",
      referenceId: input.accountReferenceId,
      displayLabel: "메일 아이디 참조",
      createdAt: input.createdAt,
      materialPresent: false,
    });
  }
  if (input.passwordReferenceId) {
    records.push({
      connectorId,
      secretKind: "mail_account_password",
      storage: "os_keychain",
      referenceId: input.passwordReferenceId,
      displayLabel: "메일 비밀번호 참조",
      createdAt: input.createdAt,
      materialPresent: false,
    });
  }
  if (input.browserSessionReferenceId) {
    records.push({
      connectorId,
      secretKind: "browser_session_reference",
      storage: "os_keychain",
      referenceId: input.browserSessionReferenceId,
      displayLabel: "웹메일 브라우저 세션 참조",
      createdAt: input.createdAt,
      materialPresent: false,
    });
  }
  return records;
}

function credentialReferencesFor(input: ModyWebmailFallbackCredentialInput): ModyWebmailFallbackCredentialReferences {
  const references: ModyWebmailFallbackCredentialReferences = {};
  if (isSafeReferenceId(input.accountReferenceId)) references.accountReferenceId = input.accountReferenceId;
  if (isSafeReferenceId(input.passwordReferenceId)) references.passwordReferenceId = input.passwordReferenceId;
  if (isSafeReferenceId(input.browserSessionReferenceId)) {
    references.browserSessionReferenceId = input.browserSessionReferenceId;
  }
  return references;
}

function hasRawSecret(input: ModyWebmailFallbackCredentialInput): boolean {
  return [input.rawUsername, input.rawPassword, input.rawSessionCookie].some((value) => {
    if (value === undefined || value === null) return false;
    return String(value).trim().length > 0;
  });
}

function sanitizeLoginUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function safeHostname(value: string): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = text.includes("://") ? new URL(text) : new URL(`https://${text}`);
    return url.hostname.toLowerCase();
  } catch {
    return text.toLowerCase().replace(/^https?:\/\//u, "").split(/[/?#]/u)[0] ?? "";
  }
}

function classifyWebmailHost(
  host: string,
  providerLabel: string,
): ModyWebmailFallbackDomCaptureProfile["hostKind"] {
  const text = `${host} ${providerLabel}`.toLowerCase();
  if (/gmail|google|workspace/u.test(text)) return "google_workspace";
  if (/outlook|office365|microsoft|exchange/u.test(text)) return "microsoft_365";
  if (/naver|works/u.test(text)) return "naver_works";
  if (/daum|kakao/u.test(text)) return "kakao_daum";
  return "generic_groupware";
}

function semanticTargetsForHost(hostKind: ModyWebmailFallbackDomCaptureProfile["hostKind"]): string[] {
  const common = [
    "role=row 또는 listitem인 메일 목록 행",
    "제목, 보낸 사람, 받은 시각이 같은 반복 행 안에 있는 후보",
    "첨부 아이콘 또는 attachment 라벨이 같은 행에 붙은 후보",
  ];
  if (hostKind === "google_workspace") {
    return ["Gmail/Workspace inbox table row metadata", "aria-label 안의 sender subject time", ...common].slice(0, 6);
  }
  if (hostKind === "microsoft_365") {
    return ["Outlook/Microsoft 365 message list item metadata", "Focused/Other inbox list row", ...common].slice(0, 6);
  }
  if (hostKind === "naver_works") {
    return ["Naver Works mail list row metadata", "읽지 않음/첨부/보낸 사람/제목 반복 행", ...common].slice(0, 6);
  }
  if (hostKind === "kakao_daum") {
    return ["Kakao/Daum mail list row metadata", "보낸 사람/제목/날짜 목록 행", ...common].slice(0, 6);
  }
  return ["회사 그룹웨어 메일 목록 반복 행", "받은메일함 표 또는 목록의 한 메일 단위", ...common].slice(0, 6);
}

function requiredVisibleSignalsForHost(
  hostKind: ModyWebmailFallbackDomCaptureProfile["hostKind"],
  mailboxLabel: string,
): string[] {
  const common = [
    `${mailboxLabel} 또는 Inbox 목록 화면이 열려 있음`,
    "보낸 사람 표시명, 제목, 시간 중 2개 이상이 한 행 안에 보임",
    "메일 본문 화면이 아니라 목록 화면임",
    "로그인/2차 인증/세션 만료 화면이 아님",
  ];
  if (hostKind === "google_workspace") {
    return [
      "Gmail Inbox 또는 Primary/Updates/Promotions 목록 영역이 보임",
      "각 행에 sender, subject snippet, received time 단서가 함께 보임",
      ...common,
    ].slice(0, 6);
  }
  if (hostKind === "microsoft_365") {
    return [
      "Outlook Focused/Other 또는 Inbox message list가 보임",
      "각 list item에 sender, subject preview, received time 단서가 함께 보임",
      ...common,
    ].slice(0, 6);
  }
  if (hostKind === "naver_works") {
    return [
      "Naver Works Mail 받은메일함 또는 안읽은메일 목록이 보임",
      "읽지 않음, 첨부, 보낸 사람, 제목, 날짜 단서가 같은 반복 행에 보임",
      ...common,
    ].slice(0, 6);
  }
  if (hostKind === "kakao_daum") {
    return [
      "Kakao/Daum 메일 받은메일함 목록 또는 전체메일 목록이 보임",
      "보낸 사람, 제목, 날짜와 첨부 아이콘 단서가 같은 반복 행에 보임",
      ...common,
    ].slice(0, 6);
  }
  return common;
}

function blockedStateHintsForHost(hostKind: ModyWebmailFallbackDomCaptureProfile["hostKind"]): string[] {
  const common = [
    "로그인 또는 2차 인증 화면이면 사용자가 직접 완료",
    "메일 상세 본문 화면이면 받은메일함 목록으로 이동",
    "검색 결과/광고 탭만 보이면 전체 받은메일함 또는 업무 폴더로 이동",
    "행이 0개이면 화면 확대/목록 밀도/정렬 상태를 확인",
  ];
  if (hostKind === "google_workspace") {
    return [
      "Google 로그인/Workspace SSO/2-Step Verification 화면이면 사용자가 직접 완료",
      "메일 본문, 검색 결과, 프로모션 탭만 보이면 Inbox 또는 Primary 목록으로 이동",
      ...common,
    ].slice(0, 6);
  }
  if (hostKind === "microsoft_365") {
    return [
      "Microsoft 로그인, 조직 SSO, MFA 또는 세션 만료 화면이면 사용자가 직접 완료",
      "Reading pane만 보이면 message list가 보이도록 받은메일함으로 이동",
      ...common,
    ].slice(0, 6);
  }
  if (hostKind === "naver_works") {
    return [
      "Naver Works 조직 로그인/OTP 화면이면 사용자가 직접 완료",
      "메일 본문 또는 팝업 작성창이면 받은메일함 목록으로 이동",
      ...common,
    ].slice(0, 6);
  }
  if (hostKind === "kakao_daum") {
    return [
      "Kakao/Daum 로그인 또는 인증 화면이면 사용자가 직접 완료",
      "메일 상세/쓰기 화면이면 받은메일함 목록으로 이동",
      ...common,
    ].slice(0, 6);
  }
  return common;
}

function sanitizeConnectorId(value: string): string {
  const normalized = value.trim();
  if (/^[a-z0-9._:-]{2,96}$/iu.test(normalized)) return normalized;
  return "webmail-fallback";
}

function sanitizeLabel(value: unknown, fallback: string): string {
  const label = String(value ?? "").replace(/\s+/gu, " ").trim();
  return (label || fallback).slice(0, 80);
}

function clampCadenceMinutes(value: unknown): number {
  const minutes = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 5;
  return Math.min(60, Math.max(5, minutes));
}

function isSafeReferenceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9._:/-]{3,180}$/iu.test(value);
}

function firstSafeReference(...values: unknown[]): string | undefined {
  return values.find(isSafeReferenceId);
}

function normalizeTwoFactorMode(value: unknown): ModyWebmailFallbackTwoFactorMode {
  if (
    value === "disabled_by_user" ||
    value === "manual_once_then_session" ||
    value === "enabled_needs_user_presence" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function inferVaultRecordLoginUrl(record: ModyWebmailFallbackVaultRecordInput): string {
  if (record.siteUrl) return record.siteUrl;
  const host = String(record.siteHost ?? "").trim();
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/iu.test(host)) return `https://${host}`;
  return "";
}

function domRowToMessageMetadata(
  row: ModyWebmailFallbackDomRowSnapshot,
  input: ModyWebmailFallbackDomExtractionInput,
  index: number,
): ModyWebmailFallbackMessageMetadata | null {
  const parts = rowTextParts(row);
  if (parts.length === 0) return null;

  const subject = inferSubject(parts, row) || "(제목 없음)";
  const senderPreview = inferSenderPreview(parts);
  const receivedAt = inferReceivedAt(row, input.checkedAt);
  const labels = [
    ...(row.labels ?? []),
    row.unread ? "unread" : "",
    input.mailboxLabel || "",
  ].map((label) => sanitizeLabel(label, "")).filter(Boolean);
  const metadataSnippet = parts
    .filter((part) => part !== subject && part !== senderPreview && !looksLikeDate(part))
    .slice(0, 4)
    .join(" ");

  return {
    messageId: inferDomRowMessageId(row, index),
    senderPreview,
    subject,
    receivedAt,
    labels,
    hasAttachments: Boolean(row.hasAttachmentIcon || parts.some((part) => /첨부|attachment|paperclip|파일/iu.test(part))),
    metadataSnippet,
  };
}

function rowTextParts(row: ModyWebmailFallbackDomRowSnapshot): string[] {
  const source: unknown[] = (row.cells?.length ?? 0) > 0
    ? (row.cells ?? [])
    : [row.ariaLabel, row.textContent, row.timeText].filter(Boolean);
  return source
    .flatMap((part) => String(part ?? "").split(/\s{2,}|\n|\t|\|/gu))
    .map((part) => redactMetadataText(part))
    .filter(Boolean)
    .filter((part) => !/^(inbox|받은메일함|메일|선택됨)$/iu.test(part))
    .slice(0, 12);
}

function inferSenderPreview(parts: string[]): string {
  const sender = parts.find((part) =>
    part === "[redacted-email]" || /보낸\s*사람|from|sender|@/iu.test(part) || /^[\p{L}\p{N} ._-]{2,80}$/u.test(part),
  );
  return sender ? redactMetadataText(sender).slice(0, 120) : "보낸 사람 확인";
}

function inferSubject(parts: string[], row: ModyWebmailFallbackDomRowSnapshot): string {
  const ariaSubject = matchLabelValue(row.ariaLabel, /(subject|제목)\s*[:：]\s*([^,|]+)/iu);
  if (ariaSubject) return ariaSubject;

  return parts.find((part) =>
    part.length >= 2 &&
    part !== "[redacted-email]" &&
    !looksLikeDate(part) &&
    !/^(unread|read|from|sender|보낸 사람|첨부)$/iu.test(part),
  ) ?? "";
}

function inferReceivedAt(row: ModyWebmailFallbackDomRowSnapshot, fallback: ISODateTimeString): ISODateTimeString {
  const candidates = [row.timeText, ...(row.cells ?? []), row.ariaLabel, row.textContent].filter(Boolean);
  for (const candidate of candidates) {
    const text = String(candidate);
    const isoMatch = text.match(/\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z?)?/u);
    if (!isoMatch) continue;
    const date = new Date(isoMatch[0].replace(" ", "T"));
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return fallback;
}

function inferDomRowMessageId(row: ModyWebmailFallbackDomRowSnapshot, index: number): string {
  const candidates = [row.rowId, row.hrefs?.[0], row.ariaLabel, row.textContent].filter(Boolean);
  const raw = candidates[0] || `dom-row-${index + 1}`;
  return safeId(String(raw)).slice(0, 120) || `dom-row-${index + 1}`;
}

function looksLikeDate(value: string): boolean {
  return /\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}|오전|오후|yesterday|today|오늘|어제/iu.test(value);
}

function matchLabelValue(value: unknown, pattern: RegExp): string {
  const match = String(value ?? "").match(pattern);
  return match?.[2] ? redactMetadataText(match[2]) : "";
}

function hasUnsafeRawMarkup(row: ModyWebmailFallbackDomRowSnapshot): boolean {
  const text = [
    row.textContent,
    row.ariaLabel,
    row.cells?.join(" "),
    row.hrefs?.join(" "),
  ].filter(Boolean).join(" ");
  return /<\s*(?:html|body|script|iframe|form|input|style|table|div|span)\b|<\/[a-z][^>]*>/iu.test(text);
}

function isNoiseWebmailMessage(message: ModyWebmailFallbackMessageMetadata): boolean {
  const text = [
    message.subject,
    message.metadataSnippet,
    ...(message.labels ?? []),
  ].join(" ");
  return /광고|홍보|프로모션|쿠폰|뉴스레터|수신거부|unsubscribe|sale|promotion|newsletter|coupon|no-?reply|자동\s*발송|스팸/iu.test(text);
}

function clampDomRowLimit(value: unknown): number {
  const rows = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 50;
  return Math.min(100, Math.max(1, rows));
}

function safeCount(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function toProviderMessage(
  message: ModyWebmailFallbackMessageMetadata,
  input: ModyWebmailFallbackReadSnapshot,
): ModyProviderMailReadOutput["messages"][number] {
  const labels = [...(message.labels ?? [])]
    .map((label) => sanitizeLabel(label, ""))
    .filter(Boolean)
    .slice(0, 8);
  const subject = redactMetadataText(message.subject || "(제목 없음)");
  const metadataSnippet = redactMetadataText(
    [
      subject,
      message.metadataSnippet,
      message.hasAttachments ? "attachment 첨부" : "",
      labels.join(" "),
    ]
      .filter(Boolean)
      .join(" "),
  );

  return {
    messageId: `webmail_${safeId(input.plan.connectorId)}_${safeId(message.messageId)}`,
    mailboxId: input.plan.mailboxLabel || "INBOX",
    providerId: "webmail",
    subject,
    from: sanitizeSenderPreview(message.senderPreview),
    receivedAt: message.receivedAt || input.checkedAt,
    snippet: metadataSnippet,
    ...(message.threadId ? { threadId: `webmail_thread_${safeId(message.threadId)}` } : {}),
    ...(labels.length ? { labels } : {}),
    hasAttachments: Boolean(message.hasAttachments),
    sourceMetadata: {
      connectorName: `${input.plan.providerLabel} 웹메일`,
      sourceUri: `webmail:${input.plan.connectorId}:message:${safeId(message.messageId)}`,
    },
  };
}

function sanitizeSenderPreview(value: unknown): string {
  const preview = redactMetadataText(String(value ?? "").trim());
  if (!preview || preview === "[redacted-email]") return "보낸 사람 확인";
  return preview.slice(0, 120);
}

function redactMetadataText(value: unknown): string {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redacted-email]")
    .replace(/\b(?:sk|pk|rk|ak)-[A-Za-z0-9_-]{12,}\b/gu, "[redacted-key]")
    .replace(/\b(?:token|password|secret|api[_-]?key|cookie)\s*[:=]\s*\S+/giu, "$1=[redacted-secret]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 600);
}

function safeId(value: string): string {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
  return normalized || "mail";
}
