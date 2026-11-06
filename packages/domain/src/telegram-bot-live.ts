export type ModyTelegramBotLiveAction =
  | "verify_bot"
  | "poll_updates"
  | "send_test_message"
  | "send_report_message";

export type ModyTelegramBotLiveStatus =
  | "needs_credentials"
  | "token_verified"
  | "updates_received"
  | "no_updates"
  | "message_sent"
  | "blocked"
  | "telegram_api_failed"
  | "network_failed";

export type ModyTelegramBotProfile = {
  id: number;
  isBot: true;
  firstName: string;
  username?: string;
};

export type ModyTelegramInboundCommandMessage = {
  updateId: number;
  messageId?: number;
  chatId: string;
  senderId: string;
  text: string;
  receivedAt?: string;
};

export type ModyTelegramBotLiveResult = {
  status: ModyTelegramBotLiveStatus;
  providerId: "telegram";
  action: ModyTelegramBotLiveAction;
  externalMutation: boolean;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  bot?: ModyTelegramBotProfile;
  chatId?: string;
  messageId?: number;
  updates?: ModyTelegramInboundCommandMessage[];
  nextOffset?: number;
  userMessage: string;
  errorMessage?: string;
  auditMessages: string[];
};

export type ModyTelegramBotLiveInput = {
  botToken?: string;
  chatId?: string;
  message?: string;
  allowExternalSend?: boolean;
  offset?: number;
  limit?: number;
  allowedUpdates?: string[];
};

type TelegramApiMethod = "getMe" | "getUpdates" | "sendMessage";

type TelegramApiOk = {
  ok: true;
  result: unknown;
};

type TelegramApiFail = {
  ok: false;
  description?: string;
};

type TelegramApiResponse = TelegramApiOk | TelegramApiFail;

type FetchLikeResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
};

type FetchLike = (url: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}) => Promise<FetchLikeResponse>;

export class ModyTelegramBotLiveConnector {
  private readonly fetchImpl: FetchLike;
  private readonly endpointBase: string;

  constructor(options: {
    fetch?: FetchLike;
    endpointBase?: string;
  } = {}) {
    const fetchImpl = options.fetch ?? (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (!fetchImpl) {
      throw new Error("fetch runtime is required for Telegram Bot live connector");
    }
    this.fetchImpl = fetchImpl as FetchLike;
    this.endpointBase = options.endpointBase ?? "https://api.telegram.org";
  }

  async verifyBot(input: ModyTelegramBotLiveInput): Promise<ModyTelegramBotLiveResult> {
    const credentialIssue = validateCredentialInput(input, "verify_bot");
    if (credentialIssue) return credentialIssue;

    const apiResult = await this.telegramApiRequest(input.botToken!, "getMe", {});
    if (apiResult.status !== "ok") {
      return apiFailure("verify_bot", false, apiResult.userMessage, apiResult.errorMessage);
    }

    const bot = normalizeBotProfile(apiResult.result);
    if (!bot) {
      return apiFailure("verify_bot", false, "Telegram getMe 응답을 읽을 수 없습니다.", "Invalid Telegram getMe result shape");
    }

    return {
      status: "token_verified",
      providerId: "telegram",
      action: "verify_bot",
      externalMutation: false,
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      bot,
      userMessage: `Telegram Bot @${bot.username ?? bot.firstName} token을 실제 getMe 호출로 확인했습니다.`,
      auditMessages: [
        "Telegram Bot API getMe 호출 완료",
        "bot token 원문은 결과, 로그, 리포트에 반환하지 않습니다.",
      ],
    };
  }

  async sendTestMessage(input: ModyTelegramBotLiveInput): Promise<ModyTelegramBotLiveResult> {
    return this.sendMessage("send_test_message", input);
  }

  async sendReportMessage(input: ModyTelegramBotLiveInput): Promise<ModyTelegramBotLiveResult> {
    return this.sendMessage("send_report_message", input);
  }

  async pollCommandUpdates(input: ModyTelegramBotLiveInput): Promise<ModyTelegramBotLiveResult> {
    const credentialIssue = validateCredentialInput(input, "poll_updates");
    if (credentialIssue) return credentialIssue;

    const apiResult = await this.telegramApiRequest(input.botToken!, "getUpdates", {
      ...(Number.isInteger(input.offset) ? { offset: input.offset } : {}),
      limit: sanitizeLimit(input.limit),
      timeout: 0,
      allowed_updates: sanitizeAllowedUpdates(input.allowedUpdates),
    });
    if (apiResult.status !== "ok") {
      return apiFailure("poll_updates", false, apiResult.userMessage, apiResult.errorMessage);
    }

    const updates = normalizeInboundCommandMessages(apiResult.result);
    const nextOffset = updates.length > 0
      ? Math.max(...updates.map((update) => update.updateId)) + 1
      : undefined;

    return {
      status: updates.length > 0 ? "updates_received" : "no_updates",
      providerId: "telegram",
      action: "poll_updates",
      externalMutation: false,
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      updates,
      ...(nextOffset !== undefined ? { nextOffset } : {}),
      userMessage: updates.length > 0
        ? `Telegram에서 사용자 명령 ${updates.length}건을 실제 getUpdates 호출로 수신했습니다.`
        : "Telegram getUpdates 호출은 성공했지만 새 사용자 명령은 없습니다.",
      auditMessages: [
        "Telegram Bot API getUpdates 호출 완료",
        "getUpdates는 사용자 명령 수신 확인이며 외부 메시지를 보내지 않습니다.",
        "bot token 원문은 결과, 로그, 리포트에 반환하지 않습니다.",
      ],
    };
  }

  async connectAndSendTest(input: ModyTelegramBotLiveInput): Promise<ModyTelegramBotLiveResult> {
    const verified = await this.verifyBot(input);
    if (verified.status !== "token_verified") return verified;

    const sent = await this.sendTestMessage(input);
    if (sent.status !== "message_sent") return sent;

    return {
      ...sent,
      ...(verified.bot ? { bot: verified.bot } : {}),
      auditMessages: [
        ...verified.auditMessages,
        ...sent.auditMessages,
      ],
    };
  }

  private async sendMessage(
    action: "send_test_message" | "send_report_message",
    input: ModyTelegramBotLiveInput,
  ): Promise<ModyTelegramBotLiveResult> {
    const credentialIssue = validateCredentialInput(input, action);
    if (credentialIssue) return credentialIssue;

    const chatId = sanitizeChatId(input.chatId);
    if (!chatId) {
      return needsCredentials(action, "보고 받을 Telegram chat_id가 필요합니다.");
    }

    if (input.allowExternalSend !== true) {
      return {
        status: "blocked",
        providerId: "telegram",
        action,
        externalMutation: false,
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        chatId,
        userMessage: "Telegram 전송은 외부 메시지 발송이므로 사용자가 명시적으로 전송을 눌렀을 때만 실행합니다.",
        auditMessages: [
          "Telegram sendMessage blocked before user-triggered external send",
          "allowExternalSend=true가 없으면 실제 메시지를 보내지 않습니다.",
        ],
      };
    }

    const text = sanitizeMessage(input.message);
    const apiResult = await this.telegramApiRequest(input.botToken!, "sendMessage", {
      chat_id: chatId,
      text,
    });
    if (apiResult.status !== "ok") {
      return apiFailure(action, false, "Telegram 테스트 메시지 전송에 실패했습니다.", apiResult.errorMessage, chatId);
    }

    const messageId = extractMessageId(apiResult.result);
    return {
      status: "message_sent",
      providerId: "telegram",
      action,
      externalMutation: true,
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      chatId,
      ...(messageId !== undefined ? { messageId } : {}),
      userMessage: "Telegram으로 실제 테스트 메시지를 전송했습니다.",
      auditMessages: [
        "Telegram Bot API sendMessage 호출 완료",
        "사용자가 명시적으로 연결 테스트를 실행했기 때문에 외부 메시지 발송을 허용했습니다.",
        "bot token 원문은 결과, 로그, 리포트에 반환하지 않습니다.",
      ],
    };
  }

  private async telegramApiRequest(
    botToken: string,
    method: TelegramApiMethod,
    body: Record<string, unknown>,
  ): Promise<{ status: "ok"; result: unknown } | { status: "failed"; userMessage: string; errorMessage: string }> {
    try {
      const response = await this.fetchImpl(`${this.endpointBase}/bot${botToken}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => ({})) as TelegramApiResponse;
      if (!response.ok || json.ok !== true) {
        const description = "description" in json && typeof json.description === "string"
          ? json.description
          : response.statusText;
        return {
          status: "failed",
          userMessage: `Telegram Bot API ${method} 호출에 실패했습니다.`,
          errorMessage: redactTelegramToken(description),
        };
      }
      return { status: "ok", result: json.result };
    } catch (error) {
      return {
        status: "failed",
        userMessage: `Telegram Bot API ${method} 네트워크 호출에 실패했습니다.`,
        errorMessage: redactTelegramToken(error instanceof Error ? error.message : String(error)),
      };
    }
  }
}

function validateCredentialInput(
  input: ModyTelegramBotLiveInput,
  action: ModyTelegramBotLiveAction,
): ModyTelegramBotLiveResult | undefined {
  const botToken = typeof input.botToken === "string" ? input.botToken.trim() : "";
  if (!botToken) return needsCredentials(action, "Telegram Bot token이 필요합니다.");
  if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
    return needsCredentials(action, "Telegram Bot token 형식이 올바르지 않습니다. BotFather token을 확인하세요.");
  }
  return undefined;
}

function needsCredentials(action: ModyTelegramBotLiveAction, userMessage: string): ModyTelegramBotLiveResult {
  return {
    status: "needs_credentials",
    providerId: "telegram",
    action,
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    userMessage,
    auditMessages: [
      "Telegram live connector needs user-provided credential",
      "bot token 원문은 앱 결과에 반환하지 않습니다.",
    ],
  };
}

function apiFailure(
  action: ModyTelegramBotLiveAction,
  externalMutation: boolean,
  userMessage: string,
  errorMessage?: string,
  chatId?: string,
): ModyTelegramBotLiveResult {
  return {
    status: "telegram_api_failed",
    providerId: "telegram",
    action,
    externalMutation,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    ...(chatId ? { chatId } : {}),
    userMessage,
    ...(errorMessage ? { errorMessage: redactTelegramToken(errorMessage) } : {}),
    auditMessages: [
      "Telegram Bot API live call failed",
      "오류 메시지는 token-like 문자열을 마스킹한 뒤 반환합니다.",
    ],
  };
}

function normalizeBotProfile(value: unknown): ModyTelegramBotProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "number" || record.is_bot !== true || typeof record.first_name !== "string") {
    return undefined;
  }
  const profile: ModyTelegramBotProfile = {
    id: record.id,
    isBot: true,
    firstName: record.first_name,
  };
  if (typeof record.username === "string" && record.username.length > 0) {
    profile.username = record.username;
  }
  return profile;
}

function extractMessageId(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const messageId = (value as Record<string, unknown>).message_id;
  return typeof messageId === "number" ? messageId : undefined;
}

function normalizeInboundCommandMessages(value: unknown): ModyTelegramInboundCommandMessage[] {
  if (!Array.isArray(value)) return [];

  const updates: ModyTelegramInboundCommandMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const update = item as Record<string, unknown>;
    const updateId = update.update_id;
    if (typeof updateId !== "number") continue;

    const message = update.message;
    if (!message || typeof message !== "object") continue;
    const messageRecord = message as Record<string, unknown>;
    const text = typeof messageRecord.text === "string" ? messageRecord.text.trim() : "";
    if (!text) continue;

    const chat = messageRecord.chat;
    const from = messageRecord.from;
    const chatRecord = chat && typeof chat === "object" ? chat as Record<string, unknown> : {};
    const fromRecord = from && typeof from === "object" ? from as Record<string, unknown> : {};
    const chatId = normalizeTelegramId(chatRecord.id);
    const senderId = normalizeTelegramId(fromRecord.id);
    if (!chatId || !senderId) continue;

    const normalized: ModyTelegramInboundCommandMessage = {
      updateId,
      chatId,
      senderId,
      text,
    };

    if (typeof messageRecord.message_id === "number") {
      normalized.messageId = messageRecord.message_id;
    }
    if (typeof messageRecord.date === "number" && Number.isFinite(messageRecord.date)) {
      normalized.receivedAt = new Date(messageRecord.date * 1000).toISOString();
    }

    updates.push(normalized);
  }

  return updates;
}

function normalizeTelegramId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function sanitizeLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function sanitizeAllowedUpdates(value: unknown): string[] {
  if (!Array.isArray(value)) return ["message"];
  const updates = value
    .filter((item): item is string => typeof item === "string" && /^[a-z_]{3,32}$/.test(item))
    .slice(0, 12);
  return updates.length > 0 ? updates : ["message"];
}

function sanitizeChatId(value: unknown): string | undefined {
  const chatId = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (/^-?\d{3,20}$/.test(chatId)) return chatId;
  if (/^@[A-Za-z0-9_]{5,32}$/.test(chatId)) return chatId;
  return undefined;
}

function sanitizeMessage(value: unknown): string {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) return "[ModyCrew] Telegram 연결 테스트입니다.";
  return message.slice(0, 3500);
}

export function redactTelegramToken(value: string): string {
  return value.replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g, "[telegram-token-redacted]");
}
