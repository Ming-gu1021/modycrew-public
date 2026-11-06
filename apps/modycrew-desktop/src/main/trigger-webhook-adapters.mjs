const defaultConnectorId = "generic-inquiry-site";

export const triggerWebhookAdapterCatalog = Object.freeze([
  {
    id: "mody_direct",
    label: "Mody 표준 이벤트",
    connectorId: defaultConnectorId,
    inputKind: "standard_event",
  },
  {
    id: "generic_form",
    label: "일반 문의 폼",
    connectorId: defaultConnectorId,
    inputKind: "form_submission",
  },
  {
    id: "chat_message",
    label: "상담 채팅 메시지",
    connectorId: defaultConnectorId,
    inputKind: "chat_message",
  },
  {
    id: "channel_talk",
    label: "채널톡 상담 메시지",
    connectorId: "channel-talk",
    inputKind: "chat_message",
  },
  {
    id: "slack_slash_command",
    label: "Slack slash command",
    connectorId: "slack-app",
    inputKind: "messenger_command",
  },
  {
    id: "naver_talktalk",
    label: "네이버 톡톡/문의",
    connectorId: "naver-talktalk",
    inputKind: "chat_message",
  },
  {
    id: "booking_update",
    label: "예약 변경",
    connectorId: "naver-booking",
    inputKind: "booking_update",
  },
  {
    id: "commerce_order",
    label: "주문/정산 변경",
    connectorId: "pos-system",
    inputKind: "commerce_order",
  },
]);

const catalogById = new Map(triggerWebhookAdapterCatalog.map((adapter) => [adapter.id, adapter]));

export function normalizeTriggerWebhookPayload(body, context = {}) {
  const value = unwrapBody(body);
  const adapterId = detectAdapterId(value, context);
  const adapter = catalogById.get(adapterId) ?? catalogById.get("mody_direct");
  const now = context.now ?? new Date().toISOString();

  if (adapter.id === "generic_form") {
    return normalizeGenericForm(value, adapter, now, context);
  }

  if (adapter.id === "chat_message" || adapter.id === "channel_talk" || adapter.id === "naver_talktalk") {
    return normalizeChatMessage(value, adapter, now, context);
  }

  if (adapter.id === "slack_slash_command") {
    return normalizeSlackSlashCommand(value, adapter, now, context);
  }

  if (adapter.id === "booking_update") {
    return normalizeBookingUpdate(value, adapter, now, context);
  }

  if (adapter.id === "commerce_order") {
    return normalizeCommerceOrder(value, adapter, now, context);
  }

  return normalizeDirectEvent(value, adapter, now, context);
}

function normalizeDirectEvent(value, adapter, now, context) {
  const connectorId = cleanConnectorId(value.connectorId ?? context.sourceHint ?? adapter.connectorId);
  const title = sanitizeWebhookText(value.title ?? value.subject ?? "앱/문의 이벤트 도착");
  const summary = sanitizeWebhookText(
    value.summary ?? value.body ?? value.message ?? "연결된 앱에서 새 이벤트가 들어왔습니다.",
  );
  const cursor = sanitizeWebhookText(
    value.cursor ?? value.id ?? context.eventIdHint ?? `local-webhook:${connectorId}:${compactDate(now)}`,
  );

  return {
    adapter: summarizeAdapter(adapter),
    event: {
      ruleId: sanitizeWebhookText(value.ruleId ?? ""),
      connectorId,
      title,
      summary,
      cursor,
      occurredAt: sanitizeIso(value.occurredAt ?? value.createdAt ?? value.receivedAt, now),
      changedFieldLabels: normalizeChangedFieldLabels(value.changedFieldLabels, ["로컬 webhook"]),
    },
  };
}

function normalizeGenericForm(value, adapter, now, context) {
  const formId = firstText(value.formId, value.form_id, value.form?.id, value.source?.formId, "form");
  const submissionId = firstText(
    value.submissionId,
    value.submission_id,
    value.id,
    value.eventId,
    context.eventIdHint,
    compactDate(now),
  );
  const customerName = firstText(value.name, value.customerName, value.customer?.name, value.sender?.name, "고객");
  const subject = firstText(value.subject, value.title, value.form?.title, "새 문의");
  const message = firstText(value.message, value.body, value.content, value.text, value.answers?.message, "");
  const pageUrl = firstText(value.pageUrl, value.page_url, value.url, value.sourceUrl, value.referrer, "");

  return {
    adapter: summarizeAdapter(adapter),
    event: {
      ruleId: sanitizeWebhookText(value.ruleId ?? ""),
      connectorId: cleanConnectorId(value.connectorId ?? context.sourceHint ?? adapter.connectorId),
      title: sanitizeWebhookText(`${subject} · ${customerName}`),
      summary: sanitizeWebhookText(
        [
          `문의 폼 ${formId}에서 새 제출이 들어왔습니다.`,
          message ? `내용: ${message}` : "",
          pageUrl ? `유입: ${pageUrl}` : "",
          value.email || value.phone ? `연락처: ${value.email ?? ""} ${value.phone ?? ""}` : "",
        ].filter(Boolean).join(" "),
      ),
      cursor: sanitizeWebhookText(`generic_form:${formId}:${submissionId}`),
      occurredAt: sanitizeIso(value.submittedAt ?? value.createdAt ?? value.receivedAt, now),
      changedFieldLabels: normalizeChangedFieldLabels(value.changedFieldLabels, [
        "문의 폼",
        "고객 이름",
        "연락처",
        "문의 내용",
      ]),
    },
  };
}

function normalizeChatMessage(value, adapter, now, context) {
  const messageId = firstText(
    value.messageId,
    value.message_id,
    value.message?.id,
    value.entity?.id,
    value.id,
    context.eventIdHint,
    compactDate(now),
  );
  const roomId = firstText(
    value.roomId,
    value.room_id,
    value.room?.id,
    value.channel?.id,
    value.entity?.channel?.id,
    value.chat?.id,
    "room",
  );
  const text = firstText(
    value.text,
    value.message,
    value.content,
    value.message?.text,
    value.message?.plainText,
    value.entity?.plainText,
    value.entity?.message,
    value.body,
    "",
  );
  const customerName = firstText(
    value.customerName,
    value.customer?.name,
    value.user?.name,
    value.sender?.name,
    value.person?.name,
    value.entity?.person?.name,
    "고객",
  );
  const serviceName = firstText(value.serviceName, value.channel?.name, value.entity?.channel?.name, adapter.label);

  return {
    adapter: summarizeAdapter(adapter),
    event: {
      ruleId: sanitizeWebhookText(value.ruleId ?? ""),
      connectorId: cleanConnectorId(value.connectorId ?? context.sourceHint ?? adapter.connectorId),
      title: sanitizeWebhookText(`${serviceName} 메시지 · ${customerName}`),
      summary: sanitizeWebhookText(
        [
          `${serviceName}에서 새 상담 메시지가 들어왔습니다.`,
          text ? `내용: ${text}` : "",
          value.email || value.sender?.email || value.entity?.person?.email
            ? `고객: ${value.email ?? value.sender?.email ?? value.entity?.person?.email}`
            : "",
        ].filter(Boolean).join(" "),
      ),
      cursor: sanitizeWebhookText(`${adapter.id}:${roomId}:${messageId}`),
      occurredAt: sanitizeIso(
        value.occurredAt ?? value.createdAt ?? value.receivedAt ?? value.message?.createdAt,
        now,
      ),
      changedFieldLabels: normalizeChangedFieldLabels(value.changedFieldLabels, [
        "상담방",
        "메시지",
        "고객",
      ]),
    },
  };
}

function normalizeSlackSlashCommand(value, adapter, now, context) {
  const triggerId = firstText(value.trigger_id, value.triggerId, context.eventIdHint, compactDate(now));
  const command = firstText(value.command, value.commandName, "/mody");
  const text = firstText(value.text, value.message, value.commandText, "");
  const userId = firstText(value.user_id, value.userId, value.senderId, "slack-user");
  const channelId = firstText(value.channel_id, value.channelId, value.roomId, "slack-channel");
  const teamId = firstText(value.team_id, value.teamId, "");
  const receivedAt = sanitizeIso(value.receivedAt ?? value.createdAt ?? value.event_time, now);
  const commandText = sanitizeWebhookText(text || `${command} 명령`);

  return {
    adapter: summarizeAdapter(adapter),
    event: {
      ruleId: sanitizeWebhookText(value.ruleId ?? ""),
      connectorId: cleanConnectorId(value.connectorId ?? context.sourceHint ?? adapter.connectorId),
      triggerKind: "messenger_command",
      sourceKind: "message_channel",
      title: sanitizeWebhookText(`Slack 명령 · ${command}`),
      summary: sanitizeWebhookText(`Slack slash command에서 업무 답장이 들어왔습니다. 내용: ${commandText}`),
      cursor: sanitizeWebhookText(`slack:${triggerId}`),
      occurredAt: receivedAt,
      changedFieldLabels: normalizeChangedFieldLabels(value.changedFieldLabels, [
        "Slack command",
        "보낸 사람",
        "채널",
        "메시지",
      ]),
      channelMessage: {
        updateId: sanitizeWebhookText(triggerId),
        text: commandText,
        senderId: sanitizeWebhookText(userId),
        channelId: sanitizeWebhookText(channelId),
        chatId: sanitizeWebhookText(channelId),
        threadId: sanitizeWebhookText(firstText(value.thread_ts, value.threadId, channelId)),
        teamId: sanitizeWebhookText(teamId),
        receivedAt,
      },
    },
  };
}

function normalizeBookingUpdate(value, adapter, now, context) {
  const bookingId = firstText(
    value.bookingId,
    value.booking_id,
    value.reservationId,
    value.reservation_id,
    value.id,
    context.eventIdHint,
    compactDate(now),
  );
  const status = firstText(value.status, value.bookingStatus, value.reservationStatus, "상태 확인 필요");
  const customerName = firstText(value.customerName, value.customer?.name, value.guest?.name, "예약 고객");
  const serviceName = firstText(value.serviceName, value.productName, value.resourceName, value.service?.name, "예약");
  const startsAt = firstText(value.startsAt, value.startAt, value.start_time, value.schedule?.startsAt, "");

  return {
    adapter: summarizeAdapter(adapter),
    event: {
      ruleId: sanitizeWebhookText(value.ruleId ?? ""),
      connectorId: cleanConnectorId(value.connectorId ?? context.sourceHint ?? adapter.connectorId),
      title: sanitizeWebhookText(`${serviceName} 예약 ${status}`),
      summary: sanitizeWebhookText(
        [
          `${customerName}님의 예약 변경이 들어왔습니다.`,
          startsAt ? `일정: ${startsAt}` : "",
          `예약번호: ${bookingId}`,
        ].filter(Boolean).join(" "),
      ),
      cursor: sanitizeWebhookText(`booking_update:${bookingId}:${status}`),
      occurredAt: sanitizeIso(value.occurredAt ?? value.updatedAt ?? value.createdAt, now),
      changedFieldLabels: normalizeChangedFieldLabels(value.changedFieldLabels, [
        "예약번호",
        "예약상태",
        "일정",
        "고객",
      ]),
    },
  };
}

function normalizeCommerceOrder(value, adapter, now, context) {
  const orderId = firstText(value.orderId, value.order_id, value.id, context.eventIdHint, compactDate(now));
  const status = firstText(value.status, value.orderStatus, value.paymentStatus, "주문 변경");
  const buyerName = firstText(value.buyerName, value.customerName, value.buyer?.name, value.customer?.name, "구매 고객");
  const itemText = summarizeItems(value.items ?? value.orderItems ?? value.products);
  const platform = firstText(value.platform, value.storeName, value.marketplace, adapter.label);

  return {
    adapter: summarizeAdapter(adapter),
    event: {
      ruleId: sanitizeWebhookText(value.ruleId ?? ""),
      connectorId: cleanConnectorId(value.connectorId ?? context.sourceHint ?? adapter.connectorId),
      title: sanitizeWebhookText(`${platform} 주문 ${status}`),
      summary: sanitizeWebhookText(
        [
          `${buyerName}님의 주문 변경이 들어왔습니다.`,
          itemText ? `품목: ${itemText}` : "",
          value.totalAmount || value.total_amount ? `금액: ${value.totalAmount ?? value.total_amount}` : "",
          `주문번호: ${orderId}`,
        ].filter(Boolean).join(" "),
      ),
      cursor: sanitizeWebhookText(`commerce_order:${orderId}:${status}`),
      occurredAt: sanitizeIso(value.occurredAt ?? value.updatedAt ?? value.createdAt, now),
      changedFieldLabels: normalizeChangedFieldLabels(value.changedFieldLabels, [
        "주문번호",
        "주문상태",
        "품목",
        "금액",
      ]),
    },
  };
}

function detectAdapterId(value, context) {
  const explicit = normalizeAdapterId(
    context.adapterHint ?? value.adapterId ?? value.adapter ?? value.provider ?? value.source,
  );
  if (catalogById.has(explicit)) return explicit;

  const eventName = firstText(value.event, value.type, value.eventType, value.event_type, "");
  if (/channel[_ -]?talk/i.test(eventName) || /channel[_ -]?talk/i.test(firstText(value.provider, ""))) {
    return "channel_talk";
  }
  if (
    value.trigger_id ||
    value.team_id ||
    (value.command && (value.response_url || value.api_app_id || value.token)) ||
    /slack/i.test(eventName) ||
    /slack/i.test(firstText(value.provider, value.source, ""))
  ) {
    // trigger_id / team_id 는 Slack 슬래시 커맨드 고유 신호입니다. command 만 있는
    // 일반 웹훅(폼/주문 등)을 Slack 으로 오분류하지 않도록, command 는 Slack 고유
    // 필드와 함께 있을 때만 Slack 으로 판단합니다.
    return "slack_slash_command";
  }
  if (/talktalk|naver/i.test(eventName) || /talktalk|naver/i.test(firstText(value.provider, value.serviceName, ""))) {
    return "naver_talktalk";
  }
  if (value.bookingId || value.reservationId || value.booking_id || value.reservation_id) {
    return "booking_update";
  }
  if (value.orderId || value.order_id || value.orderItems || value.products) {
    return "commerce_order";
  }
  if (value.formId || value.submissionId || value.answers || value.form) {
    return "generic_form";
  }
  if (value.message || value.messageId || value.room || value.channel || value.entity?.plainText) {
    return "chat_message";
  }
  return "mody_direct";
}

function unwrapBody(body) {
  if (!body || typeof body !== "object") return {};
  if (body.event && typeof body.event === "object") return body.event;
  if (body.payload && typeof body.payload === "object") return body.payload;
  if (body.data && typeof body.data === "object") return body.data;
  return body;
}

function normalizeAdapterId(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized === "channeltalk") return "channel_talk";
  if (normalized === "slack" || normalized === "slack_command" || normalized === "slack_slash") return "slack_slash_command";
  if (normalized === "naver_talk" || normalized === "naver_talk_talk") return "naver_talktalk";
  if (normalized === "form" || normalized === "contact_form") return "generic_form";
  if (normalized === "booking" || normalized === "reservation") return "booking_update";
  if (normalized === "order" || normalized === "commerce") return "commerce_order";
  return normalized || "mody_direct";
}

function summarizeAdapter(adapter) {
  return {
    id: adapter.id,
    label: adapter.label,
    connectorId: adapter.connectorId,
    inputKind: adapter.inputKind,
  };
}

function normalizeChangedFieldLabels(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const labels = value.map((item) => sanitizeWebhookText(item)).filter(Boolean).slice(0, 8);
  return labels.length > 0 ? labels : fallback;
}

function summarizeItems(value) {
  if (!Array.isArray(value)) return firstText(value, "");
  return value
    .map((item) => firstText(item?.name, item?.title, item?.productName, item?.sku, "품목"))
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function cleanConnectorId(value) {
  const connectorId = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return connectorId || defaultConnectorId;
}

function sanitizeIso(value, fallback) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function compactDate(value) {
  return String(value).replace(/[^0-9]/g, "").slice(0, 14);
}

export function sanitizeWebhookText(value) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi, "[redacted-slack-token]")
    .replace(/\bsk-(ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
