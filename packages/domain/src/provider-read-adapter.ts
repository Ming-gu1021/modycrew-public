import type { ModyConnectorPermission } from "./connector-setup.js";
import {
  ModyToolUserFacingError,
  type ModyToolAdapter,
} from "./tool-adapter.js";
import type { KnowledgeSourceMetadata } from "./types.js";

export type ModyProviderId =
  | "gmail"
  | "outlook"
  | "imap_smtp"
  | "webmail"
  | "mobile_share"
  | "google_calendar"
  | "outlook_calendar";

export type ModyProviderReadActionKind =
  | "list_mail_messages"
  | "list_calendar_events";

export type ModyProviderCredentialStatus =
  | "valid"
  | "missing"
  | "expired"
  | "revoked";

export type ModyProviderReadCredential = {
  connectorId: string;
  providerId: ModyProviderId;
  referenceId: string;
  status: ModyProviderCredentialStatus;
  grantedPermissions: ModyConnectorPermission[];
  storage: "os_keychain" | "enterprise_vault" | "user_supplied_runtime";
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
};

export type ModyProviderReadClientContext = {
  connectorId: string;
  providerId: ModyProviderId;
  credentialReferenceId: string;
  grantedPermissions: ModyConnectorPermission[];
};

export type ModyProviderMailMessagePreview = {
  messageId: string;
  mailboxId: string;
  providerId: ModyProviderId;
  subject: string;
  from: string;
  receivedAt: string;
  snippet: string;
  threadId?: string;
  labels?: string[];
  /** Provider reading state at collection time; absent means unknown. */
  isRead?: boolean;
  hasAttachments?: boolean;
  /**
   * 원문의 RFC Message-ID(꺾쇠 제거). `messageId`는 provider 내부 id라
   * 스레딩에 쓸 수 없으므로 별도 필드로 나른다 — 답장 발송 시
   * In-Reply-To/References 헤더의 재료.
   */
  rfcMessageId?: string;
  /** 원문의 In-Reply-To(꺾쇠 제거) — References 체인 근사에 사용. */
  inReplyTo?: string;
  /**
   * 답장 받을 주소(Reply-To, 없으면 From)의 원문. 열거되지 않는 속성으로만 붙는다
   * (`attachHiddenReplyToAddress`) — 직렬화·AI 프롬프트·로그에 절대 싣지 않는다.
   */
  readonly replyToAddress?: string;
  /**
   * 받은 메일의 실제 제목 원문(제어문자만 제거, 최대 300자). 보이는 `subject`는 가린 사본일 수 있어
   * `Re: 원제목`의 재료로 쓰지 못한다. 열거되지 않는 속성으로만 붙는다(`attachHiddenOriginalSubject`).
   */
  readonly originalSubject?: string;
  sourceMetadata?: KnowledgeSourceMetadata;
};

export type ModyProviderCalendarEventPreview = {
  eventId: string;
  calendarId: string;
  providerId: ModyProviderId;
  title: string;
  startsAt: string;
  endsAt: string;
  organizer?: string;
  attendees?: string[];
  location?: string;
  sourceMetadata?: KnowledgeSourceMetadata;
};

export type ModyProviderMailReadInput = {
  mailboxId?: string;
  query?: string;
  limit?: number;
};

export type ModyProviderCalendarReadInput = {
  calendarId?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export type ModyProviderMailReadOutput = {
  status: "read_completed";
  action: "list_mail_messages";
  connectorId: string;
  providerId: ModyProviderId;
  externalMutation: false;
  rawSecretMaterialStored: false;
  credentialReferenceId: string;
  messages: ModyProviderMailMessagePreview[];
  sourceMetadata: KnowledgeSourceMetadata;
  auditMessage: string;
};

export type ModyProviderCalendarReadOutput = {
  status: "read_completed";
  action: "list_calendar_events";
  connectorId: string;
  providerId: ModyProviderId;
  externalMutation: false;
  rawSecretMaterialStored: false;
  credentialReferenceId: string;
  events: ModyProviderCalendarEventPreview[];
  sourceMetadata: KnowledgeSourceMetadata;
  auditMessage: string;
};

export type ModyProviderReadOutput =
  | ModyProviderMailReadOutput
  | ModyProviderCalendarReadOutput;

export type ModyProviderReadClient = {
  providerId: ModyProviderId;
  listMailMessages?: (
    input: Required<Pick<ModyProviderMailReadInput, "mailboxId" | "limit">> &
      Pick<ModyProviderMailReadInput, "query">,
    context: ModyProviderReadClientContext,
  ) => Promise<ModyProviderMailMessagePreview[]>;
  listCalendarEvents?: (
    input: Required<
      Pick<ModyProviderCalendarReadInput, "calendarId" | "from" | "to" | "limit">
    >,
    context: ModyProviderReadClientContext,
  ) => Promise<ModyProviderCalendarEventPreview[]>;
};

const providerLabels: Record<ModyProviderId, string> = {
  gmail: "Gmail",
  outlook: "Outlook Mail",
  imap_smtp: "IMAP/SMTP",
  webmail: "웹메일",
  mobile_share: "휴대폰 선택 메일",
  google_calendar: "Google Calendar",
  outlook_calendar: "Outlook Calendar",
};

const requiredPermissionByAction: Record<
  ModyProviderReadActionKind,
  ModyConnectorPermission
> = {
  list_mail_messages: "read_messages",
  list_calendar_events: "read_calendar",
};

export class ModyProviderReadAdapterFactory {
  constructor(private readonly client: ModyProviderReadClient) {}

  createToolAdapters(credential: ModyProviderReadCredential): ModyToolAdapter[] {
    if (credential.providerId !== this.client.providerId) {
      throw new Error(
        `provider credential mismatch: ${credential.providerId} cannot be used by ${this.client.providerId}`,
      );
    }

    const adapters: ModyToolAdapter[] = [];

    if (this.client.listMailMessages) {
      adapters.push({
        definition: {
          name: `provider.${credential.providerId}.mail.list`,
          permissionLevel: "read",
          operationKind: "read_data",
          externalMutation: false,
          userVisibleDescription: `${providerLabels[credential.providerId]} 메일함을 읽기 전용으로 확인합니다.`,
          expectedImpact: "외부 메일함을 변경하지 않고 받은 메일 요약 데이터만 가져옵니다.",
        },
        run: async (input) => this.runMailRead(input, credential),
      });
    }

    if (this.client.listCalendarEvents) {
      adapters.push({
        definition: {
          name: `provider.${credential.providerId}.calendar.list`,
          permissionLevel: "read",
          operationKind: "read_data",
          externalMutation: false,
          userVisibleDescription: `${providerLabels[credential.providerId]} 일정을 읽기 전용으로 확인합니다.`,
          expectedImpact: "외부 캘린더를 변경하지 않고 일정 요약 데이터만 가져옵니다.",
        },
        run: async (input) => this.runCalendarRead(input, credential),
      });
    }

    return adapters;
  }

  private async runMailRead(
    input: unknown,
    credential: ModyProviderReadCredential,
  ): Promise<ModyProviderMailReadOutput> {
    const clientMethod = this.client.listMailMessages;
    if (!clientMethod) {
      throw providerCapabilityError(credential, "메일 읽기");
    }

    assertReadableCredential(credential, "list_mail_messages");
    const readInput = normalizeMailInput(input);
    const messages = await clientMethod(readInput, createClientContext(credential));

    return {
      status: "read_completed",
      action: "list_mail_messages",
      connectorId: credential.connectorId,
      providerId: credential.providerId,
      externalMutation: false,
      rawSecretMaterialStored: false,
      credentialReferenceId: credential.referenceId,
      messages: messages.map((message) =>
        normalizeMessagePreview(message, credential),
      ),
      sourceMetadata: createSourceMetadata(credential, "mail"),
      auditMessage: `${providerLabels[credential.providerId]}에서 메일 ${messages.length}건을 읽기 전용으로 확인했습니다.`,
    };
  }

  private async runCalendarRead(
    input: unknown,
    credential: ModyProviderReadCredential,
  ): Promise<ModyProviderCalendarReadOutput> {
    const clientMethod = this.client.listCalendarEvents;
    if (!clientMethod) {
      throw providerCapabilityError(credential, "일정 읽기");
    }

    assertReadableCredential(credential, "list_calendar_events");
    const readInput = normalizeCalendarInput(input);
    const events = await clientMethod(readInput, createClientContext(credential));

    return {
      status: "read_completed",
      action: "list_calendar_events",
      connectorId: credential.connectorId,
      providerId: credential.providerId,
      externalMutation: false,
      rawSecretMaterialStored: false,
      credentialReferenceId: credential.referenceId,
      events: events.map((event) => normalizeCalendarEventPreview(event, credential)),
      sourceMetadata: createSourceMetadata(credential, "calendar"),
      auditMessage: `${providerLabels[credential.providerId]}에서 일정 ${events.length}건을 읽기 전용으로 확인했습니다.`,
    };
  }
}

export function createProviderReadOnlyCredential(
  input: Omit<
    ModyProviderReadCredential,
    "appMayPersistSecret" | "rawSecretMaterialStored"
  >,
): ModyProviderReadCredential {
  return {
    ...input,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
  };
}

function assertReadableCredential(
  credential: ModyProviderReadCredential,
  action: ModyProviderReadActionKind,
): void {
  if (credential.status !== "valid") {
    throw new ModyToolUserFacingError(
      {
        kind: "permission_error",
        retryable: false,
        userMessage: `${providerLabels[credential.providerId]} 연결이 아직 유효하지 않습니다. 연결 설정에서 계정을 다시 연결한 뒤 읽기 작업을 진행해 주세요.`,
        technicalMessage: `Provider read credential is not valid: providerId=${credential.providerId}, connectorId=${credential.connectorId}, credentialStatus=${credential.status}`,
      },
    );
  }

  const requiredPermission = requiredPermissionByAction[action];
  if (!credential.grantedPermissions.includes(requiredPermission)) {
    throw new ModyToolUserFacingError(
      {
        kind: "permission_error",
        retryable: false,
        userMessage: `${providerLabels[credential.providerId]} 연결에 필요한 읽기 권한이 없습니다. 연결 설정에서 권한 범위를 확인해 주세요.`,
        technicalMessage: `Provider read credential does not include the required read permission: providerId=${credential.providerId}, connectorId=${credential.connectorId}, requiredPermission=${requiredPermission}`,
      },
    );
  }
}

function providerCapabilityError(
  credential: ModyProviderReadCredential,
  capabilityName: string,
): ModyToolUserFacingError {
  return new ModyToolUserFacingError(
    {
      kind: "provider_error",
      retryable: false,
      userMessage: `${providerLabels[credential.providerId]} 연결은 아직 ${capabilityName} 기능을 지원하지 않습니다.`,
      technicalMessage: `Provider read client capability is missing: providerId=${credential.providerId}, connectorId=${credential.connectorId}, capabilityName=${capabilityName}`,
    },
  );
}

function createClientContext(
  credential: ModyProviderReadCredential,
): ModyProviderReadClientContext {
  return {
    connectorId: credential.connectorId,
    providerId: credential.providerId,
    credentialReferenceId: credential.referenceId,
    grantedPermissions: [...credential.grantedPermissions],
  };
}

function normalizeMailInput(
  input: unknown,
): Required<Pick<ModyProviderMailReadInput, "mailboxId" | "limit">> &
  Pick<ModyProviderMailReadInput, "query"> {
  const maybeInput = isRecord(input) ? input : {};
  const normalized = {
    mailboxId:
      typeof maybeInput.mailboxId === "string" && maybeInput.mailboxId.trim()
        ? maybeInput.mailboxId.trim()
        : "inbox",
    limit: clampLimit(maybeInput.limit),
  };

  if (typeof maybeInput.query === "string" && maybeInput.query.trim()) {
    return {
      ...normalized,
      query: maybeInput.query.trim(),
    };
  }

  return normalized;
}

function normalizeCalendarInput(input: unknown): Required<
  Pick<ModyProviderCalendarReadInput, "calendarId" | "from" | "to" | "limit">
> {
  const maybeInput = isRecord(input) ? input : {};
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return {
    calendarId:
      typeof maybeInput.calendarId === "string" && maybeInput.calendarId.trim()
        ? maybeInput.calendarId.trim()
        : "primary",
    from:
      typeof maybeInput.from === "string" && maybeInput.from.trim()
        ? maybeInput.from.trim()
        : now.toISOString(),
    to:
      typeof maybeInput.to === "string" && maybeInput.to.trim()
        ? maybeInput.to.trim()
        : tomorrow.toISOString(),
    limit: clampLimit(maybeInput.limit),
  };
}

function normalizeMessagePreview(
  message: ModyProviderMailMessagePreview,
  credential: ModyProviderReadCredential,
): ModyProviderMailMessagePreview {
  return {
    ...message,
    providerId: credential.providerId,
    sourceMetadata:
      message.sourceMetadata ?? createSourceMetadata(credential, "mail"),
  };
}

function normalizeCalendarEventPreview(
  event: ModyProviderCalendarEventPreview,
  credential: ModyProviderReadCredential,
): ModyProviderCalendarEventPreview {
  return {
    ...event,
    providerId: credential.providerId,
    sourceMetadata:
      event.sourceMetadata ?? createSourceMetadata(credential, "calendar"),
  };
}

function createSourceMetadata(
  credential: ModyProviderReadCredential,
  sourceKind: "mail" | "calendar",
): KnowledgeSourceMetadata {
  return {
    connectorName: providerLabels[credential.providerId],
    sourceUri: `${credential.providerId}:${sourceKind}:${credential.connectorId}`,
  };
}

function clampLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10;
  }

  return Math.max(1, Math.min(Math.floor(value), 50));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
