import type { ModyProviderMailMessagePreview } from "./provider-read-adapter.js";

import { extractRfcMessageId } from "./mail-threading.js";
import { attachHiddenOriginalSubject, attachHiddenReplyToAddress } from "./mail-reply-address.js";

export type ModyOutlookMailLiveStatus =
  | "needs_credentials"
  | "mail_loaded"
  | "outlook_mail_api_failed";

export type ModyOutlookMailLiveInput = {
  accessToken?: string;
  mailboxId?: string;
  limit?: number;
};

export type ModyOutlookMailLiveResult = {
  status: ModyOutlookMailLiveStatus;
  providerId: "outlook";
  action: "list_mail_messages";
  externalMutation: false;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  endpoint: string;
  mailboxId: string;
  messageCount?: number;
  messages?: ModyProviderMailMessagePreview[];
  userMessage: string;
  errorMessage?: string;
  auditMessages: string[];
};

type FetchLikeResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
};

type FetchLike = (url: string, init: {
  method: "GET";
  headers: Record<string, string>;
}) => Promise<FetchLikeResponse>;

type OutlookMessageResponse = {
  value?: Array<{
    id?: string;
    conversationId?: string;
    subject?: string;
    bodyPreview?: string;
    receivedDateTime?: string;
    hasAttachments?: boolean;
    isRead?: boolean;
    internetMessageId?: string;
    from?: {
      emailAddress?: {
        name?: string;
        address?: string;
      };
    };
    replyTo?: Array<{
      emailAddress?: {
        name?: string;
        address?: string;
      };
    }>;
  }>;
  error?: { message?: string; code?: string };
};

export class ModyOutlookMailLiveConnector {
  private readonly fetchImpl: FetchLike;
  private readonly endpoint: string;
  private readonly now: () => Date;

  constructor(options: {
    fetch?: FetchLike;
    now?: () => Date;
  } = {}) {
    const fetchImpl = options.fetch ?? (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (!fetchImpl) throw new Error("fetch runtime is required for Outlook mail live connector");
    this.fetchImpl = fetchImpl as FetchLike;
    this.endpoint = "https://graph.microsoft.com/v1.0/me/mailFolders";
    this.now = options.now ?? (() => new Date());
  }

  async listLatestMessages(input: ModyOutlookMailLiveInput): Promise<ModyOutlookMailLiveResult> {
    const accessToken = sanitizeAccessToken(input.accessToken);
    if (!accessToken) return needsCredentials("Outlook Mail OAuth access token이 필요합니다.");

    const limit = clampLimit(input.limit);
    const mailboxId = sanitizeMailboxId(input.mailboxId);
    const endpoint = "https://graph.microsoft.com/v1.0/me/mailFolders/" + encodeURIComponent(mailboxId) + "/messages";
    const url = new URL(endpoint);
    url.searchParams.set("$top", String(limit));
    url.searchParams.set("$select", "id,conversationId,subject,from,replyTo,receivedDateTime,bodyPreview,hasAttachments,internetMessageId,isRead");
    url.searchParams.set("$orderby", "receivedDateTime desc");

    try {
      const response = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/json",
          "Prefer": 'outlook.body-content-type="text"',
        },
      });
      const json = await response.json().catch(() => ({})) as OutlookMessageResponse;
      if (!response.ok) {
        throw new Error(redactOutlookMailToken(json.error?.message ?? response.statusText, [accessToken]));
      }

      const messages = (json.value ?? []).slice(0, limit).map((message) =>
        toMessagePreview(message, mailboxId, this.now().toISOString()),
      );

      return {
        status: "mail_loaded",
        providerId: "outlook",
        action: "list_mail_messages",
        externalMutation: false,
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        endpoint,
        mailboxId,
        messageCount: messages.length,
        messages,
        userMessage: `Microsoft Graph에서 최신 Outlook 메일 ${messages.length}건을 읽기 전용으로 확인했습니다.`,
        auditMessages: [
          "Microsoft Graph GET /me/mailFolders/{mailboxId}/messages 호출 완료",
          "Mail.Read 읽기 권한을 전제로 하며 메일 발송, 수정, 삭제는 실행하지 않았습니다.",
          "OAuth access token 원문은 결과, 로그, 리포트에 반환하지 않습니다.",
        ],
      };
    } catch (error) {
      return apiFailure(
        "Microsoft Graph 메일 읽기 호출에 실패했습니다.",
        redactOutlookMailToken(error instanceof Error ? error.message : String(error), [accessToken]),
        mailboxId,
      );
    }
  }
}

function needsCredentials(userMessage: string): ModyOutlookMailLiveResult {
  return {
    status: "needs_credentials",
    providerId: "outlook",
    action: "list_mail_messages",
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    endpoint: "https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages",
    mailboxId: "Inbox",
    userMessage,
    auditMessages: [
      "Outlook mail live connector needs OAuth access token",
      "access token 원문은 앱 결과에 반환하지 않습니다.",
    ],
  };
}

function apiFailure(userMessage: string, errorMessage: string, mailboxId: string): ModyOutlookMailLiveResult {
  return {
    status: "outlook_mail_api_failed",
    providerId: "outlook",
    action: "list_mail_messages",
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    endpoint: "https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages",
    mailboxId,
    userMessage,
    errorMessage,
    auditMessages: [
      "Outlook Mail API live call failed before any mutation",
      "오류 메시지는 OAuth token-like 문자열을 마스킹한 뒤 반환합니다.",
    ],
  };
}

function toMessagePreview(
  message: NonNullable<OutlookMessageResponse["value"]>[number],
  mailboxId: string,
  fallbackReceivedAt: string,
): ModyProviderMailMessagePreview {
  const senderName = message.from?.emailAddress?.name || "";
  const senderAddress = message.from?.emailAddress?.address || "";
  const threadId = sanitizeId(message.conversationId);
  const rfcMessageId = extractRfcMessageId(String(message.internetMessageId ?? ""));
  const preview: ModyProviderMailMessagePreview = {
    messageId: `outlook-${sanitizeId(message.id) || "message"}`,
    mailboxId,
    providerId: "outlook",
    subject: sanitizeText(message.subject || "(제목 없음)"),
    from: sanitizeText(senderName || senderAddress || "Outlook sender"),
    receivedAt: sanitizeDate(message.receivedDateTime) || fallbackReceivedAt,
    snippet: sanitizeText(message.bodyPreview || message.subject || ""),
    ...(threadId ? { threadId } : {}),
    ...(rfcMessageId ? { rfcMessageId } : {}),
    labels: [],
    ...(typeof message.isRead === "boolean" ? { isRead: message.isRead } : {}),
    hasAttachments: Boolean(message.hasAttachments),
    sourceMetadata: {
      connectorName: "Microsoft Graph Mail",
      sourceUri: `outlook:message:${sanitizeId(message.id) || "unknown"}`,
    },
  };
  // 보이는 from 은 이름만, subject 는 가린 사본으로 쓰고, 답장 받을 주소와 실제 제목 원문은
  // 열거되지 않는 속성으로만 나른다.
  attachHiddenOriginalSubject(preview, message.subject);
  return attachHiddenReplyToAddress(preview, message.replyTo?.[0]?.emailAddress?.address, senderAddress);
}

function sanitizeAccessToken(value: unknown): string {
  const token = typeof value === "string" ? value.trim() : "";
  return token.length >= 20 && token.length <= 4096 ? token : "";
}

function sanitizeMailboxId(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_ -]{1,80}$/.test(text) ? text : "Inbox";
}

function sanitizeId(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9._~+/=-]{1,220}$/.test(text) ? text : "";
}

function sanitizeDate(value: unknown): string {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function clampLimit(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(20, Math.trunc(number))) : 10;
}

function sanitizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

export function redactOutlookMailToken(value: string, secrets: string[] = []): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join("[outlook-mail-token-redacted]");
  }
  return redacted
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [outlook-mail-token-redacted]")
    .replace(/\bEw[A-Za-z0-9._~+/=-]{20,}\b/g, "[outlook-mail-token-redacted]");
}
