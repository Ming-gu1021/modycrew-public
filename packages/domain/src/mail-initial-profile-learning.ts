import {
  createMailSecureIntakeDecision,
  summarizeMailSecureIntake,
  type ModyMailSecureIntakeSummary,
} from "./mail-secure-intake.js";
import type { ModyUserWritingProfile } from "./mail-workflow.js";
import type { ModyMailWorkPatternAnalysis } from "./mail-work-pattern-analysis.js";
import type { ModyProviderMailReadOutput } from "./provider-read-adapter.js";
import type { ModyProviderWorkIntakeReport } from "./provider-work-intake.js";
import type { ISODateTimeString } from "./types.js";

export type ModyMailInitialProfileStatus =
  | "profile_ready"
  | "needs_more_mail"
  | "profile_empty";

export type ModyMailInitialLearningSourceScope =
  | "inbox_metadata"
  | "sent_history_metadata"
  | "selected_mail_preview"
  | "webmail_dom_metadata";

export type ModyMailInitialLearningProfile = {
  contract: "initial_mail_profile_learning_secret_blind";
  status: ModyMailInitialProfileStatus;
  createdAt: ISODateTimeString;
  sourceScopes: ModyMailInitialLearningSourceScope[];
  readOnly: true;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  aiCredentialPolicy: "credential_reference_id_only";
  profileSummary: string;
  writingStyleProfile: {
    toneLabel: string;
    formatLabel: string;
    signaturePolicy: string;
    replyRules: string[];
  };
  noiseFilterProfile: {
    skippedBeforeBodyCount: number;
    reviewMetadataOnlyCount: number;
    bodyPreviewAllowedCount: number;
    rules: string[];
  };
  bulkMailProfile: {
    status: "review_required" | "not_detected";
    targetGroups: string[];
    excludedGroups: string[];
    personalizationFields: string[];
    approvalGate: string;
  };
  scheduleProfile: {
    status: "observed" | "not_detected";
    preferenceLabel: string;
    rules: string[];
  };
  approvalHabitProfile: {
    approvalRequiredFor: string[];
    defaultDecision: "draft_only_until_user_approval";
    finalActionLock: "send_calendar_file_external_mutation_locked";
  };
  scanDepthProfile: {
    sampledMessageCount: number;
    sourceScopeCount: number;
    depthLabel: "broad_initial_scan" | "starter_scan" | "empty_scan";
    recommendedInitialScanLimit: number;
    metadataFirst: true;
    rawBodyStored: false;
    nextScanGuidance: string[];
  };
  learningMemoryPreview: string[];
  safeToPersistKeys: string[];
  privacyBoundary: string;
  secureIntakeSummary: ModyMailSecureIntakeSummary;
};

export function createMailInitialLearningProfile(input: {
  providerReads: ModyProviderMailReadOutput[];
  workReports?: ModyProviderWorkIntakeReport[];
  workAnalysis?: ModyMailWorkPatternAnalysis;
  writingProfile?: ModyUserWritingProfile;
  createdAt?: ISODateTimeString;
  sourceScopes?: ModyMailInitialLearningSourceScope[];
}): ModyMailInitialLearningProfile {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const messages = input.providerReads.flatMap((read) => read.messages);
  const decisions = messages.map(createMailSecureIntakeDecision);
  const secureIntakeSummary = summarizeMailSecureIntake(decisions);
  const analysis = input.workAnalysis;
  const reportTotals = summarizeReports(input.workReports ?? []);
  const sourceScopes = input.sourceScopes?.length
    ? unique(input.sourceScopes)
    : inferSourceScopes(input.providerReads);
  const status = statusFor(messages.length, reportTotals.createdWorkItemsCount, secureIntakeSummary.bodyPreviewAllowedCount);
  const writingStyleProfile = createWritingStyleProfile(input.writingProfile, analysis);
  const noiseFilterProfile = createNoiseFilterProfile(secureIntakeSummary);
  const bulkMailProfile = createBulkMailProfile(analysis);
  const scheduleProfile = createScheduleProfile(analysis, input.writingProfile);
  const approvalHabitProfile = createApprovalHabitProfile(analysis, reportTotals.approvalQueueCount);
  const scanDepthProfile = createScanDepthProfile(messages.length, sourceScopes);
  const learningMemoryPreview = createLearningMemoryPreview({
    ...(analysis ? { analysis } : {}),
    writingStyleProfile,
    noiseFilterProfile,
    bulkMailProfile,
    scheduleProfile,
    approvalHabitProfile,
    scanDepthProfile,
  });

  return {
    contract: "initial_mail_profile_learning_secret_blind",
    status,
    createdAt,
    sourceScopes,
    readOnly: true,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    aiCredentialPolicy: "credential_reference_id_only",
    profileSummary: createProfileSummary(messages.length, reportTotals, secureIntakeSummary, status),
    writingStyleProfile,
    noiseFilterProfile,
    bulkMailProfile,
    scheduleProfile,
    approvalHabitProfile,
    scanDepthProfile,
    learningMemoryPreview,
    safeToPersistKeys: [
      "toneLabel",
      "formatLabel",
      "replyRules",
      "noiseRules",
      "bulkTargetGroupLabels",
      "bulkExclusionRuleLabels",
      "schedulePreferenceLabel",
      "approvalRequiredWorkKinds",
      "initialScanDepthLabel",
    ],
    privacyBoundary:
      "초기 메일 프로필 학습은 메일 원문, 실제 주소, 비밀번호, token, 2차 인증값을 저장하지 않고 업무 라벨과 승인 기준만 저장 후보로 만듭니다.",
    secureIntakeSummary,
  };
}

function summarizeReports(reports: ModyProviderWorkIntakeReport[]) {
  return reports.reduce(
    (summary, report) => ({
      createdWorkItemsCount: summary.createdWorkItemsCount + report.createdWorkItemsCount,
      ignoredItemsCount: summary.ignoredItemsCount + report.ignoredItemsCount,
      reviewItemsCount: summary.reviewItemsCount + report.reviewItemsCount,
      approvalQueueCount: summary.approvalQueueCount + report.approvalQueue.length,
    }),
    {
      createdWorkItemsCount: 0,
      ignoredItemsCount: 0,
      reviewItemsCount: 0,
      approvalQueueCount: 0,
    },
  );
}

function statusFor(
  totalMessages: number,
  createdWorkItemsCount: number,
  bodyPreviewAllowedCount: number,
): ModyMailInitialProfileStatus {
  if (totalMessages === 0) return "profile_empty";
  if (createdWorkItemsCount > 0 || bodyPreviewAllowedCount >= 3) return "profile_ready";
  return "needs_more_mail";
}

function inferSourceScopes(reads: ModyProviderMailReadOutput[]): ModyMailInitialLearningSourceScope[] {
  const scopes = reads.map((read) => {
    if (read.providerId === "webmail") return "webmail_dom_metadata";
    if (read.providerId === "mobile_share") return "selected_mail_preview";
    return read.messages.some((message) => /sent|보낸|발송|처리\s*이력|audit/iu.test(`${message.mailboxId} ${message.subject} ${(message.labels ?? []).join(" ")}`))
      ? "sent_history_metadata"
      : "inbox_metadata";
  });
  return unique(scopes);
}

function createWritingStyleProfile(
  writingProfile: ModyUserWritingProfile | undefined,
  analysis: ModyMailWorkPatternAnalysis | undefined,
): ModyMailInitialLearningProfile["writingStyleProfile"] {
  return {
    toneLabel: writingProfile?.toneLabel || "사용자 승인 초안을 기준으로 학습 대기",
    formatLabel: writingProfile?.formatLabel || "짧은 요약, 근거, 다음 행동 순서",
    signaturePolicy: writingProfile?.signature ? "사용자가 저장한 서명을 초안 말미 후보로만 사용" : "서명은 자동 추가하지 않고 승인 화면에서 확인",
    replyRules: withFallback(
      [
        ...(analysis?.replyToneGuidance ?? []),
        "확정 약속, 가격, 일정, 책임 표현은 사용자 승인 전까지 초안으로만 둡니다.",
      ],
      "사용자가 수정/승인한 답장만 다음 말투 기준으로 저장합니다.",
    ).slice(0, 5),
  };
}

function createNoiseFilterProfile(
  secureIntakeSummary: ModyMailSecureIntakeSummary,
): ModyMailInitialLearningProfile["noiseFilterProfile"] {
  return {
    skippedBeforeBodyCount: secureIntakeSummary.skippedBeforeBodyCount,
    reviewMetadataOnlyCount: secureIntakeSummary.reviewMetadataOnlyCount,
    bodyPreviewAllowedCount: secureIntakeSummary.bodyPreviewAllowedCount,
    rules: [
      "광고, 프로모션, 뉴스레터, 자동 알림은 본문 preview를 AI에 넘기기 전에 제외합니다.",
      "업무 신호가 약한 메일은 메타데이터 확인 카드로만 남깁니다.",
      "사용자가 업무로 전환한 제외 메일만 다음 규칙 조정 후보가 됩니다.",
    ],
  };
}

function createBulkMailProfile(
  analysis: ModyMailWorkPatternAnalysis | undefined,
): ModyMailInitialLearningProfile["bulkMailProfile"] {
  const plan = analysis?.bulkSendPlan;
  return {
    status: plan?.status === "review_required" ? "review_required" : "not_detected",
    targetGroups: withFallback(plan?.targetGroups ?? [], "대량 발송 대상 그룹은 명단 검토 뒤 저장").slice(0, 5),
    excludedGroups: withFallback(plan?.excludedGroups ?? [], "수신거부, 중복, 주소 누락은 기본 제외 후보").slice(0, 5),
    personalizationFields: withFallback(plan?.personalizationFields ?? [], "이름, 기관, 일정, 금액 같은 개인화 값은 샘플 검토 대상").slice(0, 5),
    approvalGate: plan?.approvalGate || "대량 메일은 샘플 문안과 전체 수신자 확인 전까지 발송하지 않습니다.",
  };
}

function createScheduleProfile(
  analysis: ModyMailWorkPatternAnalysis | undefined,
  writingProfile: ModyUserWritingProfile | undefined,
): ModyMailInitialLearningProfile["scheduleProfile"] {
  const observed = (analysis?.stats.calendarCandidates ?? 0) > 0;
  return {
    status: observed ? "observed" : "not_detected",
    preferenceLabel: writingProfile?.calendarPreference || "캘린더 연결 뒤 가능한 시간만 후보로 제안",
    rules: withFallback(
      analysis?.scheduleGuidance ?? [],
      "캘린더 등록은 메일 초안과 분리하고 사용자 승인 뒤에만 실행합니다.",
    ).slice(0, 5),
  };
}

function createApprovalHabitProfile(
  analysis: ModyMailWorkPatternAnalysis | undefined,
  approvalQueueCount: number,
): ModyMailInitialLearningProfile["approvalHabitProfile"] {
  const approvalRequiredFor = withFallback(
    [
      ...(analysis?.approvalPolicy ?? []),
      approvalQueueCount > 0 ? `이번 스캔에서 승인 대기 후보 ${approvalQueueCount}건을 감지했습니다.` : "",
    ],
    "메일 발송, 일정 등록, 파일 공유, 대량 발송은 사용자 승인 전까지 잠급니다.",
  ).slice(0, 6);

  return {
    approvalRequiredFor,
    defaultDecision: "draft_only_until_user_approval",
    finalActionLock: "send_calendar_file_external_mutation_locked",
  };
}

function createScanDepthProfile(
  sampledMessageCount: number,
  sourceScopes: ModyMailInitialLearningSourceScope[],
): ModyMailInitialLearningProfile["scanDepthProfile"] {
  const depthLabel =
    sampledMessageCount >= 30
      ? "broad_initial_scan"
      : sampledMessageCount > 0
        ? "starter_scan"
        : "empty_scan";
  return {
    sampledMessageCount,
    sourceScopeCount: sourceScopes.length,
    depthLabel,
    recommendedInitialScanLimit: 50,
    metadataFirst: true,
    rawBodyStored: false,
    nextScanGuidance: [
      depthLabel === "broad_initial_scan"
        ? "초기 학습 범위가 충분히 넓습니다. 이후에는 승인/수정 결과만 누적해 말투와 제외 규칙을 보강합니다."
        : "처음 연결 뒤에는 최근 50건까지 넓게 훑어 말투, 광고 제외, 대량 발송, 일정 기준을 먼저 잡습니다.",
      "오래 걸려도 비밀번호, 2차 인증값, 원문 주소, 전체 본문은 저장하지 않고 업무 라벨과 승인 기준만 저장 후보로 둡니다.",
    ],
  };
}

function createLearningMemoryPreview(input: {
  analysis?: ModyMailWorkPatternAnalysis;
  writingStyleProfile: ModyMailInitialLearningProfile["writingStyleProfile"];
  noiseFilterProfile: ModyMailInitialLearningProfile["noiseFilterProfile"];
  bulkMailProfile: ModyMailInitialLearningProfile["bulkMailProfile"];
  scheduleProfile: ModyMailInitialLearningProfile["scheduleProfile"];
  approvalHabitProfile: ModyMailInitialLearningProfile["approvalHabitProfile"];
  scanDepthProfile: ModyMailInitialLearningProfile["scanDepthProfile"];
}): string[] {
  return withFallback(
    [
      `초기 학습 범위: ${input.scanDepthProfile.sampledMessageCount}건 · ${input.scanDepthProfile.depthLabel}`,
      input.writingStyleProfile.replyRules[0] ?? "",
      input.analysis?.learningSignals?.[0] ?? "",
      input.bulkMailProfile.status === "review_required" ? `대량 메일 기준: ${input.bulkMailProfile.targetGroups[0] ?? "검토 필요"}` : "",
      input.noiseFilterProfile.skippedBeforeBodyCount > 0
        ? `광고/뉴스레터 ${input.noiseFilterProfile.skippedBeforeBodyCount}건은 본문 없이 제외`
        : "",
      input.scheduleProfile.status === "observed" ? `일정 기준: ${input.scheduleProfile.preferenceLabel}` : "",
      input.approvalHabitProfile.approvalRequiredFor[0] ?? "",
    ],
    "초기 학습은 저장 후보만 만들고 사용자가 승인한 방식만 다음 처리 기준으로 반영합니다.",
  ).slice(0, 6);
}

function createProfileSummary(
  totalMessages: number,
  reportTotals: ReturnType<typeof summarizeReports>,
  secureIntakeSummary: ModyMailSecureIntakeSummary,
  status: ModyMailInitialProfileStatus,
): string {
  if (status === "profile_empty") {
    return "초기 메일 프로필을 만들 메일이 아직 없습니다. 연결 범위나 메일함을 확인해야 합니다.";
  }

  return [
    `초기 메일 ${totalMessages}건을 읽기 전용으로 훑었습니다.`,
    `업무 후보 ${reportTotals.createdWorkItemsCount}건, 확인 필요 ${reportTotals.reviewItemsCount}건, 광고/알림 제외 ${reportTotals.ignoredItemsCount}건입니다.`,
    `본문 preview 없이 제외 ${secureIntakeSummary.skippedBeforeBodyCount}건, 제한 preview 허용 ${secureIntakeSummary.bodyPreviewAllowedCount}건입니다.`,
  ].join(" ");
}

function withFallback(values: readonly string[], fallback: string): string[] {
  const filtered = values.map((value) => value.trim()).filter(Boolean);
  return filtered.length > 0 ? unique(filtered) : [fallback];
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
