import { ModyMailImapLiveConnector, type ModyMailImapLiveInput, type ModyMailImapLiveMessagePreview, type ModyMailImapLiveResult } from "./mail-imap-live.js";
import { createMailAttachmentOrganizerPlan, type ModyMailAttachmentOrganizerPlan } from "./mail-attachment-organizer.js";
import { createMailInitialLearningProfile, type ModyMailInitialLearningProfile } from "./mail-initial-profile-learning.js";
import { analyzeMailWorkPattern, type ModyMailWorkPatternAnalysis } from "./mail-work-pattern-analysis.js";
import { ModyProviderWorkIntakePlanner, type ModyProviderWorkIntakeReport } from "./provider-work-intake.js";
import type { ModyProviderMailMessagePreview, ModyProviderMailReadOutput } from "./provider-read-adapter.js";
import type { ISODateTimeString, ModyChannelId } from "./types.js";
import type { ModyUserWritingProfile } from "./mail-workflow.js";
import { attachHiddenOriginalSubject, attachHiddenReplyToAddress } from "./mail-reply-address.js";

export type ModyMailImapWorkIntakeStatus =
  | "needs_credentials"
  | "imap_connected_ready_for_review"
  | "imap_connected_quiet"
  | "imap_connect_failed";

export type ModyMailImapWorkIntakeInput = ModyMailImapLiveInput & {
  connectorId?: string;
  credentialReferenceId?: string;
  writingProfile: ModyUserWritingProfile;
  reportChannelId: ModyChannelId;
  appDeepLinkBase?: string;
};

export type ModyMailImapWorkIntakeResult = {
  status: ModyMailImapWorkIntakeStatus;
  providerId: string;
  connectorId: string;
  readOnly: true;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  appMayPersistSecret: false;
  imapRead: ModyMailImapLiveResult;
  providerRead?: ModyProviderMailReadOutput;
  workReport?: ModyProviderWorkIntakeReport;
  workAnalysis?: ModyMailWorkPatternAnalysis;
  initialLearningProfile?: ModyMailInitialLearningProfile;
  attachmentOrganizerPlan?: ModyMailAttachmentOrganizerPlan;
  userMessage: string;
  auditMessages: string[];
};

type ModyMailImapWorkIntakeRunnerOptions = {
  imapConnector?: ModyMailImapLiveConnector;
  now?: () => Date;
};

export class ModyMailImapWorkIntakeRunner {
  private readonly imapConnector: ModyMailImapLiveConnector;
  private readonly now: () => Date;

  constructor(options: ModyMailImapWorkIntakeRunnerOptions = {}) {
    this.imapConnector = options.imapConnector ?? new ModyMailImapLiveConnector();
    this.now = options.now ?? (() => new Date());
  }

  async run(input: ModyMailImapWorkIntakeInput): Promise<ModyMailImapWorkIntakeResult> {
    const imapRead = await this.imapConnector.readLatestMessages(input);
    const providerId = imapRead.providerId;
    const connectorId = sanitizeConnectorId(input.connectorId, providerId);

    if (imapRead.status !== "imap_connected") {
      return {
        status: imapRead.status === "needs_credentials" ? "needs_credentials" : "imap_connect_failed",
        providerId,
        connectorId,
        readOnly: true,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        appMayPersistSecret: false,
        imapRead,
        userMessage: imapRead.userMessage,
        auditMessages: [
          ...imapRead.auditMessages,
          "IMAP 업무 수집은 메일함 연결 성공 전에는 업무 후보를 만들지 않습니다.",
        ],
      };
    }

    const providerRead = createProviderMailReadFromImapResult({
      imapRead,
      connectorId,
      credentialReferenceId: sanitizeCredentialReferenceId(input.credentialReferenceId, providerId),
      createdAt: this.now().toISOString(),
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
      createdAt: this.now().toISOString(),
      sourceScopes: ["inbox_metadata", "sent_history_metadata"],
    });
    const attachmentOrganizerPlan = createMailAttachmentOrganizerPlan({
      providerReads: [providerRead],
      workReports: [workReport],
      workAnalysis,
      createdAt: this.now().toISOString(),
    });

    return {
      status: workReport.status === "ready_for_review"
        ? "imap_connected_ready_for_review"
        : "imap_connected_quiet",
      providerId,
      connectorId,
      readOnly: true,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      appMayPersistSecret: false,
      imapRead,
      providerRead,
      workReport,
      workAnalysis,
      initialLearningProfile,
      attachmentOrganizerPlan,
      userMessage: `${imapRead.userMessage} ${workAnalysis.summary} 제안: ${workAnalysis.improvementSuggestions[0]}`,
      auditMessages: [
        ...imapRead.auditMessages,
        "IMAP 최신 메일 envelope를 provider read-only snapshot으로 변환했습니다.",
        "ProviderWorkIntakePlanner가 광고/스팸/업무/확인 필요를 분류했습니다.",
        "메일 업무 분석이 집계 신호로 작업 방식과 개선 제안을 만들었습니다.",
        "초기 메일 프로필 학습이 말투, 광고 제외, 대량 발송, 일정, 승인 습관을 비밀값 없이 저장 후보로 요약했습니다.",
        ...attachmentOrganizerPlan.auditMessages,
        "답장 발송과 캘린더 등록은 approvalQueue에만 올라가며 즉시 실행하지 않습니다.",
      ],
    };
  }
}

export function createProviderMailReadFromImapResult(input: {
  imapRead: ModyMailImapLiveResult;
  connectorId: string;
  credentialReferenceId: string;
  createdAt: ISODateTimeString;
}): ModyProviderMailReadOutput {
  const host = input.imapRead.host ?? input.imapRead.providerId;
  return {
    status: "read_completed",
    action: "list_mail_messages",
    connectorId: input.connectorId,
    providerId: "imap_smtp",
    externalMutation: false,
    rawSecretMaterialStored: false,
    credentialReferenceId: input.credentialReferenceId,
    messages: (input.imapRead.messages ?? []).map((message) => toProviderMessage(message, input.imapRead, input.createdAt)),
    sourceMetadata: {
      connectorName: `IMAP ${host}`,
      sourceUri: `imap:${host}:${input.imapRead.mailbox ?? "INBOX"}`,
    },
    auditMessage: `IMAP ${host}에서 메일 ${input.imapRead.messageCount ?? 0}건을 읽기 전용 업무 후보로 변환했습니다.`,
  };
}

function toProviderMessage(
  message: ModyMailImapLiveMessagePreview,
  imapRead: ModyMailImapLiveResult,
  fallbackReceivedAt: ISODateTimeString,
): ModyProviderMailMessagePreview {
  const host = imapRead.host ?? imapRead.providerId;
  const preview: ModyProviderMailMessagePreview = {
    messageId: `imap_${safeId(host)}_${message.uid}`,
    mailboxId: imapRead.mailbox ?? "INBOX",
    providerId: "imap_smtp",
    subject: message.subject,
    from: message.from ?? "unknown-sender",
    receivedAt: message.receivedAt ?? fallbackReceivedAt,
    // 본문 미리보기가 있으면 snippet에 실어 선필터/AI preview로 흘린다.
    // 본문이 없으면 빈 미리보기로 둔다. IMAP 내부 플래그를 본문처럼 표시하지 않는다.
    snippet: message.previewText
      ? `${message.subject} ${message.previewText}`.trim()
      : "",
    labels: message.flags,
    isRead: message.flags.some((flag) => flag.toLowerCase() === "\\seen"),
    hasAttachments: (message as ModyMailImapLiveMessagePreview & { hasAttachments?: boolean }).hasAttachments === true,
    ...(message.rfcMessageId ? { rfcMessageId: message.rfcMessageId } : {}),
    ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
    sourceMetadata: {
      connectorName: `IMAP ${host}`,
      sourceUri: `imap:${host}:uid:${message.uid}`,
    },
  };
  // 답장 받을 주소·실제 제목은 열거되지 않는 속성으로만 이어 붙인다(직렬화되지 않음).
  attachHiddenOriginalSubject(preview, message.originalSubject, message.subject);
  return attachHiddenReplyToAddress(preview, message.replyToAddress, message.from);
}

function sanitizeConnectorId(value: unknown, providerId: string): string {
  const connectorId = typeof value === "string" ? value.trim() : "";
  if (/^[a-z0-9._:-]{2,96}$/i.test(connectorId)) return connectorId;
  return `imap-work-intake-${safeId(providerId)}`;
}

function sanitizeCredentialReferenceId(value: unknown, providerId: string): string {
  const referenceId = typeof value === "string" ? value.trim() : "";
  if (/^[a-z0-9._:-]{2,160}$/i.test(referenceId)) return referenceId;
  return `runtime-imap-reference:${safeId(providerId)}`;
}

function safeId(value: string): string {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
  return normalized || "mail";
}
