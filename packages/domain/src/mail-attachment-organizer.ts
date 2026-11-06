import type { ModyMailWorkPatternAnalysis } from "./mail-work-pattern-analysis.js";
import type { ModyProviderMailReadOutput, ModyProviderMailMessagePreview } from "./provider-read-adapter.js";
import type { ModyProviderWorkIntakeReport } from "./provider-work-intake.js";
import type { ISODateTimeString } from "./types.js";

export type ModyMailAttachmentOrganizerStatus =
  | "ready_for_download_review"
  | "not_detected";

export type ModyMailAttachmentCandidateSummary = {
  id: string;
  subjectLabel: string;
  receivedAt: ISODateTimeString;
  mailboxId: string;
  providerId: string;
  reasonLabels: string[];
  targetFolderHint: string;
  requiresDownloadReview: true;
};

export type ModyMailAttachmentOrganizerPlan = {
  contract: "mail_attachment_download_to_local_folder_plan_approval";
  status: ModyMailAttachmentOrganizerStatus;
  createdAt: ISODateTimeString;
  readOnly: true;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  aiCredentialPolicy: "credential_reference_id_only";
  attachmentCandidateCount: number;
  candidateSummaries: ModyMailAttachmentCandidateSummary[];
  downloadPlan: {
    credentialPolicy: "credential_reference_id_only";
    downloadRootLabel: string;
    dedupePolicy: string;
    allowedFilePolicy: string;
    localCopyOnly: true;
    originalMailMutation: false;
    externalShareBeforeApproval: false;
  };
  organizePlan: {
    organizeRootLabel: string;
    targetFolderHints: string[];
    classificationRules: string[];
  };
  stagingHandoff: {
    kind: "stage_mail_attachments_folder_plan";
    contract: "downloaded_mail_attachment_to_folder_plan_approval";
    sourceKind: "mail_attachment";
    localCopyOnly: true;
    originalMailMutation: false;
    originalAttachmentDeleted: false;
    externalShareBeforeApproval: false;
    requiredBeforeStage: string[];
  };
  approvalGate: string;
  privacyBoundary: string;
  auditMessages: string[];
};

const attachmentSignalPattern =
  /첨부|파일|자료|문서|계약서|견적서|제안서|세금계산서|홈택스|청구서|invoice|receipt|quote|proposal|contract|attachment|attached|document|report|spreadsheet|xlsx|pdf|csv/iu;

export function createMailAttachmentOrganizerPlan(input: {
  providerReads: ModyProviderMailReadOutput[];
  workReports?: ModyProviderWorkIntakeReport[];
  workAnalysis?: ModyMailWorkPatternAnalysis;
  createdAt?: ISODateTimeString;
  downloadRootLabel?: string;
  organizeRootLabel?: string;
}): ModyMailAttachmentOrganizerPlan {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const ignoredSourceIds = collectIgnoredMailSourceIds(input.workReports ?? []);
  const candidates = input.providerReads
    .flatMap((read) => read.messages)
    .filter((message) => !ignoredSourceIds.has(message.messageId))
    .map((message) => toAttachmentCandidate(message, createdAt))
    .filter((candidate): candidate is ModyMailAttachmentCandidateSummary => Boolean(candidate))
    .slice(0, 12);
  const targetFolderHints = unique([
    ...candidates.map((candidate) => candidate.targetFolderHint),
    ...inferFolderHintsFromAnalysis(input.workAnalysis),
  ]).slice(0, 8);
  const status: ModyMailAttachmentOrganizerStatus =
    candidates.length > 0 || (input.workAnalysis?.stats.attachmentSignals ?? 0) > 0
      ? "ready_for_download_review"
      : "not_detected";

  return {
    contract: "mail_attachment_download_to_local_folder_plan_approval",
    status,
    createdAt,
    readOnly: true,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    aiCredentialPolicy: "credential_reference_id_only",
    attachmentCandidateCount: candidates.length,
    candidateSummaries: candidates,
    downloadPlan: {
      credentialPolicy: "credential_reference_id_only",
      downloadRootLabel: sanitizeLabel(input.downloadRootLabel) || "메일 첨부 임시 보관함",
      dedupePolicy: "같은 메일/파일명 후보는 해시 또는 받은 시각 라벨로 중복 검토 후 보관합니다.",
      allowedFilePolicy: "실행 파일은 자동 열기/실행하지 않고 PDF, 문서, 스프레드시트, 이미지 같은 업무 파일만 정리 후보로 올립니다.",
      localCopyOnly: true,
      originalMailMutation: false,
      externalShareBeforeApproval: false,
    },
    organizePlan: {
      organizeRootLabel: sanitizeLabel(input.organizeRootLabel) || "업무 문서 보관함",
      targetFolderHints: targetFolderHints.length ? targetFolderHints : ["메일 첨부"],
      classificationRules: [
        "계약, 견적, 세금계산서, 보고/자료, 명단 신호를 기준으로 폴더 후보만 만듭니다.",
        "동명이인, 중복 파일, 확장자 불명 파일은 정리 전 사용자 확인 대상으로 둡니다.",
        "원본 메일/첨부 삭제, 덮어쓰기, 외부 공유는 자동 실행하지 않습니다.",
      ],
    },
    stagingHandoff: {
      kind: "stage_mail_attachments_folder_plan",
      contract: "downloaded_mail_attachment_to_folder_plan_approval",
      sourceKind: "mail_attachment",
      localCopyOnly: true,
      originalMailMutation: false,
      originalAttachmentDeleted: false,
      externalShareBeforeApproval: false,
      requiredBeforeStage: [
        "사용자가 다운로드할 첨부 후보를 확인합니다.",
        "앱은 내려받은 로컬 사본만 폴더 정리 승인 카드로 넘깁니다.",
        "정리 적용은 dry-run 결과와 최종 확인 문구가 맞을 때만 가능합니다.",
      ],
    },
    approvalGate: "첨부 다운로드, 이동, 삭제, 덮어쓰기, 외부 공유는 사용자 최종 승인 전까지 실행하지 않습니다.",
    privacyBoundary: "첨부 정리 계획은 비밀번호, 토큰, 실제 메일 원문, 원본 첨부 파일 내용을 AI에 저장하지 않고 제목/라벨 기반 후보와 로컬 사본 정리 경계만 만듭니다.",
    auditMessages: [
      status === "ready_for_download_review"
        ? `중요 첨부 후보 ${candidates.length}건을 다운로드 검토 대상으로 감지했습니다.`
        : "중요 첨부 후보가 없어 첨부 다운로드/정리 계획을 만들지 않았습니다.",
      "첨부 정리는 기존 downloaded_mail_attachment_to_folder_plan_approval 승인 카드로만 이어집니다.",
      "AI는 credential reference id와 후보 라벨만 다루며 비밀번호와 원본 첨부 파일을 읽지 않습니다.",
    ],
  };
}

function collectIgnoredMailSourceIds(reports: ModyProviderWorkIntakeReport[]): Set<string> {
  return new Set(
    reports
      .flatMap((report) => report.candidates ?? [])
      .filter((candidate) => candidate.sourceKind === "mail" && candidate.classification === "ignored_noise")
      .map((candidate) => candidate.sourceId),
  );
}

function toAttachmentCandidate(
  message: ModyProviderMailMessagePreview,
  fallbackReceivedAt: ISODateTimeString,
): ModyMailAttachmentCandidateSummary | null {
  const signalText = [message.subject, message.snippet, ...(message.labels ?? [])].join(" ");
  const reasonLabels = unique([
    message.hasAttachments ? "첨부 표시 있음" : "",
    attachmentSignalPattern.test(signalText) ? "업무 파일 신호" : "",
    /계약|contract/iu.test(signalText) ? "계약" : "",
    /견적|quote|proposal|제안/iu.test(signalText) ? "견적/제안" : "",
    /세금계산서|청구서|invoice|receipt|홈택스/iu.test(signalText) ? "정산/세금" : "",
    /보고|자료|document|report/iu.test(signalText) ? "보고/자료" : "",
    /명단|xlsx|spreadsheet|csv/iu.test(signalText) ? "명단/스프레드시트" : "",
  ].filter(Boolean));
  if (!message.hasAttachments && reasonLabels.length === 0) return null;

  return {
    id: safeId(message.messageId),
    subjectLabel: sanitizeSubject(message.subject),
    receivedAt: normalizeIso(message.receivedAt, fallbackReceivedAt),
    mailboxId: sanitizeLabel(message.mailboxId) || "INBOX",
    providerId: sanitizeLabel(message.providerId) || "mail",
    reasonLabels: reasonLabels.length ? reasonLabels.slice(0, 4) : ["첨부 검토"],
    targetFolderHint: inferFolderHint(signalText),
    requiresDownloadReview: true,
  };
}

function inferFolderHintsFromAnalysis(analysis?: ModyMailWorkPatternAnalysis): string[] {
  if (!analysis) return [];
  const text = [
    ...(analysis.workingStyle ?? []),
    ...(analysis.automationOpportunities ?? []),
    ...(analysis.learningSignals ?? []),
    ...(analysis.improvementSuggestions ?? []),
  ].join(" ");
  return unique([
    /계약|contract/iu.test(text) ? "계약" : "",
    /세금|정산|invoice|receipt|홈택스/iu.test(text) ? "정산/세금계산서" : "",
    /견적|제안|quote|proposal/iu.test(text) ? "견적/제안" : "",
    /보고|자료|document|report/iu.test(text) ? "보고/자료" : "",
  ].filter(Boolean));
}

function inferFolderHint(text: string): string {
  if (/세금계산서|청구서|invoice|receipt|홈택스/iu.test(text)) return "정산/세금계산서";
  if (/계약|contract/iu.test(text)) return "계약";
  if (/견적|quote|proposal|제안/iu.test(text)) return "견적/제안";
  if (/명단|xlsx|spreadsheet|csv/iu.test(text)) return "명단";
  if (/보고|자료|document|report/iu.test(text)) return "보고/자료";
  return "메일 첨부";
}

function normalizeIso(value: string | undefined, fallback: ISODateTimeString): ISODateTimeString {
  const text = typeof value === "string" ? value.trim() : "";
  if (text && !Number.isNaN(new Date(text).getTime())) return new Date(text).toISOString();
  return fallback;
}

function sanitizeSubject(value: unknown): string {
  const text = sanitizeLabel(value)
    .replaceAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[email]")
    .replaceAll(/\b(?:token|password|passwd|secret|otp|2fa|mfa)\s*[:=]\s*\S+/giu, "[secret]");
  return text.slice(0, 160) || "제목 없는 첨부 후보";
}

function sanitizeLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replaceAll(/\s+/g, " ").trim();
}

function safeId(value: string): string {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
  return normalized || "mail-attachment";
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
