import type { ModyProviderMailMessagePreview } from "./provider-read-adapter.js";

export type ModyMailSecureIntakePhase =
  | "metadata_only"
  | "noise_skipped_before_body"
  | "business_preview_allowed"
  | "review_metadata_only";

export type ModyMailSecureIntakeClassification =
  | "likely_noise"
  | "business_candidate"
  | "needs_review";

export type ModyMailSecureIntakeDecision = {
  messageId: string;
  phase: ModyMailSecureIntakePhase;
  classification: ModyMailSecureIntakeClassification;
  aiMayReadBodyPreview: boolean;
  aiMayReadSecret: false;
  connectorMayUseCredentialReferenceOnly: true;
  bodyPreviewForAi: string;
  reason: string;
  matchedRules: string[];
};

export type ModyMailSecureIntakeSummary = {
  contract: "metadata_first_secret_blind_mail_intake";
  totalMessages: number;
  metadataOnlyCount: number;
  skippedBeforeBodyCount: number;
  bodyPreviewAllowedCount: number;
  reviewMetadataOnlyCount: number;
  aiSecretReadable: false;
  rawCredentialMaterialReturned: false;
  credentialInputPolicy: "write_only_to_os_vault_or_enterprise_vault";
  aiCredentialPolicy: "credential_reference_id_only";
  recommendedPollIntervalMinutes: 5;
  safetyBoundary: string;
};

const noiseRules = [
  { label: "광고/프로모션", pattern: /광고|프로모션|할인|쿠폰|이벤트|특가|sale|marketing|promotion/iu },
  { label: "뉴스레터/수신거부", pattern: /뉴스레터|newsletter|unsubscribe|수신\s*거부/iu },
  { label: "스팸/피싱", pattern: /스팸|피싱|crypto|lottery|urgent wire/iu },
  { label: "자동 알림", pattern: /no-?reply|noreply|자동\s*알림|system notification|daemon/iu },
];

const securityReviewRules = [
  {
    label: "계정/인증 보안 알림",
    pattern: /비밀번호\s*(?:재설정|변경|초기화)|계정\s*(?:잠금|보안)|새(?:로운)?\s*로그인|의심스러운\s*(?:로그인|활동)|인증\s*(?:코드|번호)|password\s*reset|security\s*alert|new\s*sign[ -]?in|suspicious\s*(?:login|activity)|one[- ]time\s*(?:passcode|code)|otp/iu,
  },
];

const businessRules = [
  { label: "문의/상담", pattern: /문의|상담|질문|고객|답변\s*요청|inquiry|question|support/iu },
  { label: "일정/미팅", pattern: /예약|미팅|회의|일정|방문|시간|날짜|meeting|schedule|appointment/iu },
  { label: "견적/계약/정산", pattern: /견적|계약|납품|정산|세금계산서|invoice|quote|contract|billing/iu },
  { label: "자료/첨부/보고", pattern: /자료|보고서|제출|증빙|첨부|파일|document|report|attachment/iu },
  { label: "긴급/클레임/보안", pattern: /긴급|클레임|장애|오류|보안|인증|권한|urgent|complaint|security/iu },
];

const strongBusinessRules = businessRules.filter((rule) => rule.label !== "자료/첨부/보고");

export function createMailSecureIntakeDecision(
  message: ModyProviderMailMessagePreview,
): ModyMailSecureIntakeDecision {
  const metadataText = normalizeText([
    message.from,
    message.subject,
    ...(message.labels ?? []),
    message.hasAttachments ? "attachment 첨부" : "",
  ].join(" "));
  const previewText = normalizeText(message.snippet);
  const securityReviewMatches = matchRules(metadataText, securityReviewRules);
  if (securityReviewMatches.length > 0) {
    return {
      messageId: message.messageId,
      phase: "review_metadata_only",
      classification: "needs_review",
      aiMayReadBodyPreview: false,
      aiMayReadSecret: false,
      connectorMayUseCredentialReferenceOnly: true,
      bodyPreviewForAi: "",
      reason: "계정 또는 인증 보안 알림이 감지되어 광고로 제외하지 않고 사용자가 직접 확인하도록 남겼습니다.",
      matchedRules: securityReviewMatches,
    };
  }

  const noiseMatches = matchRules(metadataText, noiseRules);
  const strongBusinessMetadataMatches = matchRules(metadataText, strongBusinessRules);

  if (noiseMatches.length > 0 && strongBusinessMetadataMatches.length === 0) {
    return {
      messageId: message.messageId,
      phase: "noise_skipped_before_body",
      classification: "likely_noise",
      aiMayReadBodyPreview: false,
      aiMayReadSecret: false,
      connectorMayUseCredentialReferenceOnly: true,
      bodyPreviewForAi: "",
      reason: "광고/뉴스레터/스팸성 메타데이터가 먼저 감지되어 본문 preview를 AI 처리에서 제외했습니다.",
      matchedRules: noiseMatches,
    };
  }

  const businessMatches = matchRules(`${metadataText} ${previewText}`, businessRules);
  if (businessMatches.length > 0) {
    return {
      messageId: message.messageId,
      phase: "business_preview_allowed",
      classification: "business_candidate",
      aiMayReadBodyPreview: true,
      aiMayReadSecret: false,
      connectorMayUseCredentialReferenceOnly: true,
      bodyPreviewForAi: previewText,
      reason: "업무 신호가 감지되어 제한된 preview만 AI 업무 분류에 사용할 수 있습니다.",
      matchedRules: businessMatches,
    };
  }

  return {
    messageId: message.messageId,
    phase: "review_metadata_only",
    classification: "needs_review",
    aiMayReadBodyPreview: false,
    aiMayReadSecret: false,
    connectorMayUseCredentialReferenceOnly: true,
    bodyPreviewForAi: "",
    reason: "업무 여부가 애매해 메타데이터만 확인 필요 카드로 넘기고 본문 preview는 AI 처리에서 제외했습니다.",
    matchedRules: ["확인 필요"],
  };
}

export function summarizeMailSecureIntake(
  decisions: readonly ModyMailSecureIntakeDecision[],
): ModyMailSecureIntakeSummary {
  const skippedBeforeBodyCount = decisions.filter((decision) => decision.phase === "noise_skipped_before_body").length;
  const bodyPreviewAllowedCount = decisions.filter((decision) => decision.aiMayReadBodyPreview).length;
  const reviewMetadataOnlyCount = decisions.filter((decision) => decision.phase === "review_metadata_only").length;

  return {
    contract: "metadata_first_secret_blind_mail_intake",
    totalMessages: decisions.length,
    metadataOnlyCount: decisions.length - bodyPreviewAllowedCount,
    skippedBeforeBodyCount,
    bodyPreviewAllowedCount,
    reviewMetadataOnlyCount,
    aiSecretReadable: false,
    rawCredentialMaterialReturned: false,
    credentialInputPolicy: "write_only_to_os_vault_or_enterprise_vault",
    aiCredentialPolicy: "credential_reference_id_only",
    recommendedPollIntervalMinutes: 5,
    safetyBoundary:
      "메일 점검은 메타데이터를 먼저 보고 광고/잡음은 본문 preview 없이 제외하며, AI는 비밀번호/token 원문 대신 credentialReferenceId만 받습니다.",
  };
}

function matchRules(text: string, rules: readonly { label: string; pattern: RegExp }[]): string[] {
  return rules
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.label);
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redacted-email]")
    .replace(/\b(?:sk|pk|rk|ak)-[A-Za-z0-9_-]{12,}\b/gu, "[redacted-key]")
    .replace(/\b(?:token|password|secret|api[_-]?key)\s*[:=]\s*\S+/giu, "$1=[redacted-secret]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}
