import { createMailAttachmentOrganizerPlan, type ModyMailAttachmentOrganizerPlan } from "./mail-attachment-organizer.js";
import { createMailInitialLearningProfile, type ModyMailInitialLearningProfile } from "./mail-initial-profile-learning.js";
import { analyzeMailWorkPattern, type ModyMailWorkPatternAnalysis } from "./mail-work-pattern-analysis.js";
import { ModyProviderWorkIntakePlanner, type ModyProviderWorkIntakeReport } from "./provider-work-intake.js";
import type { ModyProviderMailMessagePreview, ModyProviderMailReadOutput } from "./provider-read-adapter.js";
import type { ISODateTimeString, ModyChannelId } from "./types.js";
import type { ModyUserWritingProfile } from "./mail-workflow.js";

export type ModyMobileMailShareSource = "mobile_share_sheet" | "pwa_paste" | "manual_phone_forward";

export type ModyMobileMailShareDecisionActionId = "reply_draft" | "revise" | "hold" | "approve_candidate";

export type ModyMobileMailShareDecisionAction = {
  id: ModyMobileMailShareDecisionActionId;
  label: string;
  description: string;
  externalMutation: false;
  requiresFinalConfirmation: true;
};

export type ModyMobileSharedMailPreview = {
  id: string;
  from: string;
  subject: string;
  bodyPreview?: string;
  receivedAt?: ISODateTimeString;
  mailboxId?: string;
  source?: ModyMobileMailShareSource;
  labels?: string[];
  hasAttachments?: boolean;
};

export type ModyMobileSharedMailWorkIntakeInput = {
  messages: ModyMobileSharedMailPreview[];
  connectorId?: string;
  credentialReferenceId?: string;
  writingProfile: ModyUserWritingProfile;
  reportChannelId: ModyChannelId;
  appDeepLinkBase?: string;
};

export type ModyMobileSharedMailWorkIntakeResult = {
  status: "mobile_shared_mail_ready_for_review" | "mobile_shared_mail_empty";
  providerId: "mobile_share";
  connectorId: string;
  readOnly: true;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  appMayPersistSecret: false;
  providerRead?: ModyProviderMailReadOutput;
  workReport?: ModyProviderWorkIntakeReport;
  workAnalysis?: ModyMailWorkPatternAnalysis;
  initialLearningProfile?: ModyMailInitialLearningProfile;
  attachmentOrganizerPlan?: ModyMailAttachmentOrganizerPlan;
  userMessage: string;
  auditMessages: string[];
  mobileShareContract: "selected_phone_mail_to_workbench_draft_approval_final_confirmation";
  decisionContract: "phone_shared_mail_reply_edit_hold_approve_to_workbench";
  decisionActions: ModyMobileMailShareDecisionAction[];
  finalActionLock: "external_send_calendar_file_change_until_app_final_confirmation";
};

type ModyMobileSharedMailWorkIntakeRunnerOptions = {
  now?: () => Date;
};

export class ModyMobileSharedMailWorkIntakeRunner {
  private readonly now: () => Date;

  constructor(options: ModyMobileSharedMailWorkIntakeRunnerOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  run(input: ModyMobileSharedMailWorkIntakeInput): ModyMobileSharedMailWorkIntakeResult {
    const createdAt = this.now().toISOString();
    const messages = normalizeSharedMessages(input.messages, createdAt);
    const connectorId = sanitizeConnectorId(input.connectorId);

    if (messages.length === 0) {
      return {
        status: "mobile_shared_mail_empty",
        providerId: "mobile_share",
        connectorId,
        readOnly: true,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        appMayPersistSecret: false,
        userMessage: "휴대폰에서 선택한 메일이 없어 업무 후보를 만들지 않았습니다.",
        auditMessages: [
          "휴대폰 선택 메일 수신은 사용자가 공유한 항목만 처리합니다.",
          "메일함 전체 읽기, 메일 삭제, 읽음 처리, 답장 발송은 실행하지 않았습니다.",
        ],
        mobileShareContract: "selected_phone_mail_to_workbench_draft_approval_final_confirmation",
        decisionContract: "phone_shared_mail_reply_edit_hold_approve_to_workbench",
        decisionActions: createMobileMailShareDecisionActions(),
        finalActionLock: "external_send_calendar_file_change_until_app_final_confirmation",
      };
    }

    const providerRead = createProviderMailReadFromMobileSharedMessages({
      messages,
      connectorId,
      credentialReferenceId: sanitizeCredentialReferenceId(input.credentialReferenceId),
      createdAt,
    });
    const planner = new ModyProviderWorkIntakePlanner({ now: this.now });
    const workReport = planner.createReport({
      reads: [providerRead],
      writingProfile: input.writingProfile,
      reportChannelId: input.reportChannelId,
      ...(input.appDeepLinkBase ? { appDeepLinkBase: input.appDeepLinkBase } : {}),
    });
    const workAnalysis = analyzeMailWorkPattern({ providerRead, workReport, writingProfile: input.writingProfile });
    const initialLearningProfile = createMailInitialLearningProfile({
      providerReads: [providerRead],
      workReports: [workReport],
      workAnalysis,
      writingProfile: input.writingProfile,
      createdAt,
      sourceScopes: ["selected_mail_preview"],
    });
    const attachmentOrganizerPlan = createMailAttachmentOrganizerPlan({
      providerReads: [providerRead],
      workReports: [workReport],
      workAnalysis,
      createdAt,
    });

    return {
      status: "mobile_shared_mail_ready_for_review",
      providerId: "mobile_share",
      connectorId,
      readOnly: true,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      appMayPersistSecret: false,
      providerRead,
      workReport,
      workAnalysis,
      initialLearningProfile,
      attachmentOrganizerPlan,
      userMessage:
        `휴대폰에서 선택한 메일 ${messages.length}건을 업무대장으로 가져왔습니다. ` +
        `${workAnalysis.summary} 앱 최종 확인 전에는 발송하지 않습니다.`,
      auditMessages: [
        "휴대폰 공유/PWA/붙여넣기로 사용자가 선택한 메일만 읽기 전용 스냅샷으로 변환했습니다.",
        "ProviderWorkIntakePlanner가 답장 필요, 확인 필요, 제외 메일을 분류했습니다.",
        "초기 메일 프로필 학습이 선택 메일의 말투, 광고 제외, 대량 발송, 일정, 승인 습관을 비밀값 없이 저장 후보로 요약했습니다.",
        ...attachmentOrganizerPlan.auditMessages,
        "답장 초안과 일정 후보는 승인 후보로만 만들고 외부 메일 발송은 실행하지 않았습니다.",
        "휴대폰 결정은 의사 기록이며 실제 발송은 앱 최종 확인 뒤에만 가능합니다.",
      ],
      mobileShareContract: "selected_phone_mail_to_workbench_draft_approval_final_confirmation",
      decisionContract: "phone_shared_mail_reply_edit_hold_approve_to_workbench",
      decisionActions: createMobileMailShareDecisionActions(),
      finalActionLock: "external_send_calendar_file_change_until_app_final_confirmation",
    };
  }
}

export function createMobileMailShareDecisionActions(): ModyMobileMailShareDecisionAction[] {
  return [
    {
      id: "reply_draft",
      label: "답장 후보",
      description: "AI가 답장 초안과 일정 후보를 만들지만 외부 발송은 하지 않습니다.",
      externalMutation: false,
      requiresFinalConfirmation: true,
    },
    {
      id: "revise",
      label: "수정",
      description: "사용자가 문구, 일정, 수신자 조건을 앱 안에서 고칩니다.",
      externalMutation: false,
      requiresFinalConfirmation: true,
    },
    {
      id: "hold",
      label: "보류",
      description: "불확실하거나 위험한 메일은 작업 큐에 남기고 전송하지 않습니다.",
      externalMutation: false,
      requiresFinalConfirmation: true,
    },
    {
      id: "approve_candidate",
      label: "승인 후보",
      description: "승인은 최종 확인 후보만 만들며 실제 발송은 마지막 확인 뒤에만 가능합니다.",
      externalMutation: false,
      requiresFinalConfirmation: true,
    },
  ];
}

export function createProviderMailReadFromMobileSharedMessages(input: {
  messages: ModyMobileSharedMailPreview[];
  connectorId?: string;
  credentialReferenceId?: string;
  createdAt: ISODateTimeString;
}): ModyProviderMailReadOutput {
  const connectorId = sanitizeConnectorId(input.connectorId);
  const messages = normalizeSharedMessages(input.messages, input.createdAt);
  return {
    status: "read_completed",
    action: "list_mail_messages",
    connectorId,
    providerId: "mobile_share",
    externalMutation: false,
    rawSecretMaterialStored: false,
    credentialReferenceId: sanitizeCredentialReferenceId(input.credentialReferenceId),
    messages: messages.map((message) => toProviderMessage(message, input.createdAt)),
    sourceMetadata: {
      connectorName: "휴대폰 선택 메일",
      sourceUri: "mobile-share:selected-mail",
    },
    auditMessage: `휴대폰에서 선택한 메일 ${messages.length}건을 읽기 전용 업무 후보로 변환했습니다.`,
  };
}

function toProviderMessage(
  message: ModyMobileSharedMailPreview,
  fallbackReceivedAt: ISODateTimeString,
): ModyProviderMailMessagePreview {
  const source = message.source ?? "mobile_share_sheet";
  return {
    messageId: `mobile_share_${safeId(message.id)}`,
    mailboxId: message.mailboxId ?? "PHONE_SELECTED",
    providerId: "mobile_share",
    subject: message.subject,
    from: message.from,
    receivedAt: message.receivedAt ?? fallbackReceivedAt,
    snippet: [message.subject, message.bodyPreview, ...(message.labels ?? [])].filter(Boolean).join(" ").trim(),
    labels: ["phone_selected", source, ...(message.labels ?? [])],
    hasAttachments: Boolean(message.hasAttachments),
    sourceMetadata: {
      connectorName: "휴대폰 선택 메일",
      sourceUri: `mobile-share:${source}:${safeId(message.id)}`,
    },
  };
}

function normalizeSharedMessages(
  messages: ModyMobileSharedMailPreview[] | undefined,
  fallbackReceivedAt: ISODateTimeString,
): ModyMobileSharedMailPreview[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message, index) => ({
      id: sanitizeText(message?.id) || `phone-mail-${index + 1}`,
      from: sanitizeText(message?.from) || "phone-selected-mail",
      subject: sanitizeText(message?.subject).slice(0, 240),
      bodyPreview: sanitizeText(message?.bodyPreview).slice(0, 1200),
      receivedAt: sanitizeIso(message?.receivedAt, fallbackReceivedAt),
      mailboxId: sanitizeText(message?.mailboxId).slice(0, 80) || "PHONE_SELECTED",
      source: normalizeSource(message?.source),
      labels: Array.isArray(message?.labels)
        ? message.labels.map(sanitizeText).filter(Boolean).slice(0, 8)
        : [],
      hasAttachments: Boolean(message?.hasAttachments),
    }))
    .filter((message) => message.subject || message.bodyPreview);
}

function normalizeSource(value: unknown): ModyMobileMailShareSource {
  if (value === "pwa_paste" || value === "manual_phone_forward") return value;
  return "mobile_share_sheet";
}

function sanitizeConnectorId(value: unknown): string {
  const connectorId = typeof value === "string" ? value.trim() : "";
  if (/^[a-z0-9._:-]{2,96}$/i.test(connectorId)) return connectorId;
  return "mobile-mail-share";
}

function sanitizeCredentialReferenceId(value: unknown): string {
  const referenceId = typeof value === "string" ? value.trim() : "";
  if (/^[a-z0-9._:-]{2,160}$/i.test(referenceId)) return referenceId;
  return "user-supplied-runtime:mobile-mail-share";
}

function sanitizeIso(value: unknown, fallback: ISODateTimeString): ISODateTimeString {
  const text = typeof value === "string" ? value.trim() : "";
  if (text && !Number.isNaN(new Date(text).getTime())) return new Date(text).toISOString();
  return fallback;
}

function sanitizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replaceAll(/\s+/g, " ").trim();
}

function safeId(value: string): string {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
  return normalized || "mail";
}
