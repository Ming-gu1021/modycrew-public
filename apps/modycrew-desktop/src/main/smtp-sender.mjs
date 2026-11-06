import net from "node:net";
import tls from "node:tls";
import { randomBytes } from "node:crypto";
import { mailRecipientLists, mailAddressHeader } from './mail-recipient-list.mjs';

const SMTP_TIMEOUT_MS = 15000;
export const MAIL_ATTACHMENT_MAX_COUNT = 5;
export const MAIL_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const mailAttachmentTypes = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  hwp: ["application/x-hwp", "application/haansofthwp", "application/vnd.hancom.hwp"],
  hwpx: ["application/hwp+zip", "application/vnd.hancom.hwpx"],
  odt: ["application/vnd.oasis.opendocument.text"],
  ods: ["application/vnd.oasis.opendocument.spreadsheet"],
  txt: ["text/plain"],
  csv: ["text/csv"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
};

/** Main에서 승인 파일의 바이트를 읽은 뒤 호출한다. 경로/URL을 열지 않는다. */
export function prepareMailAttachments(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("mail_attachments_array_required");
  if (value.length > MAIL_ATTACHMENT_MAX_COUNT) throw new Error("mail_attachments_count_exceeded");
  let totalBytes = 0;
  return Array.from(value, (attachment) => {
    if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
      throw new Error("mail_attachment_invalid");
    }
    if (["path", "filePath", "absolutePath", "url", "href"].some((key) => key in attachment)) {
      throw new Error("mail_attachment_bytes_required");
    }
    const filename = attachment.filename;
    if (
      typeof filename !== "string" || !filename || !filename.isWellFormed() || filename !== filename.trim() ||
      Buffer.byteLength(filename, "utf8") > 240 ||
      /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069\\/:"<>|?*]/u.test(filename)
    ) throw new Error("mail_attachment_filename_invalid");
    const extension = /\.([a-z0-9]+)$/iu.exec(filename)?.[1]?.toLowerCase();
    const contentTypes = Object.hasOwn(mailAttachmentTypes, extension ?? "") ? mailAttachmentTypes[extension] : null;
    if (!contentTypes) throw new Error("mail_attachment_type_unsupported");
    const contentType = attachment.contentType === undefined ? contentTypes[0] : attachment.contentType;
    if (typeof contentType !== "string" || !contentTypes.includes(contentType)) {
      throw new Error("mail_attachment_content_type_mismatch");
    }
    const contentBase64 = attachment.contentBase64;
    if (typeof contentBase64 !== "string" || !contentBase64) throw new Error("mail_attachment_base64_required");
    // Node Buffer의 관대한 디코딩에 맡기지 않는다. 크기 검사부터 수행해 대용량 할당을 막는다.
    if (contentBase64.length > 4 * Math.ceil(MAIL_ATTACHMENT_MAX_BYTES / 3)) {
      throw new Error("mail_attachment_size_exceeded");
    }
    const padding = contentBase64.endsWith("==") ? 2 : contentBase64.endsWith("=") ? 1 : 0;
    if (contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+$/u.test(contentBase64.slice(0, contentBase64.length - padding))) {
      throw new Error("mail_attachment_base64_invalid");
    }
    const byteLength = contentBase64.length / 4 * 3 - padding;
    if (byteLength > MAIL_ATTACHMENT_MAX_BYTES) throw new Error("mail_attachment_size_exceeded");
    totalBytes += byteLength;
    if (totalBytes > MAIL_ATTACHMENT_MAX_BYTES) throw new Error("mail_attachments_total_size_exceeded");
    const bytes = Buffer.from(contentBase64, "base64");
    if (bytes.toString("base64") !== contentBase64) throw new Error("mail_attachment_base64_invalid");
    return { filename, contentType, contentBase64, byteLength: bytes.length };
  });
}

/** SMTP와 Gmail이 같은 MIME 첨부 인코딩을 사용한다. SMTP dot-stuffing은 호출자가 적용한다. */
export function renderMailMimeContent(text, attachmentInput) {
  const attachments = prepareMailAttachments(attachmentInput);
  if (!attachments.length) {
    return {
      headers: ["MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit"],
      body: String(text).replace(/\r?\n/g, "\r\n"),
    };
  }
  const boundary = `modycrew-${randomBytes(18).toString("hex")}`;
  const parts = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapMailBase64(Buffer.from(String(text).replace(/\r?\n/g, "\r\n"), "utf8").toString("base64")),
  ];
  attachments.forEach((attachment, index) => {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}`,
      "Content-Transfer-Encoding: base64",
      renderAttachmentDisposition(attachment.filename, index),
      "",
      wrapMailBase64(attachment.contentBase64),
    );
  });
  parts.push(`--${boundary}--`, "");
  return {
    headers: ["MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`],
    body: parts.join("\r\n"),
  };
}

function wrapMailBase64(value) {
  return value.match(/.{1,76}/gu)?.join("\r\n") ?? "";
}

function renderAttachmentDisposition(filename, index) {
  if (/^[\x20-\x7e]+$/u.test(filename)) return `Content-Disposition: attachment; filename="${filename}"`;
  const extension = filename.slice(filename.lastIndexOf(".") + 1);
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  // RFC 2231 continuation: 긴 한국어 파일명도 헤더 줄 길이를 넘거나 %XX 중간에서 끊기지 않는다.
  const segments = [];
  for (const token of encoded.match(/%[0-9A-F]{2}|./gu) ?? []) {
    if (!segments.length || segments[segments.length - 1].length + token.length > 60) segments.push("");
    segments[segments.length - 1] += token;
  }
  return [
    `Content-Disposition: attachment; filename="attachment-${index + 1}.${extension}"`,
    ...segments.map((segment, part) => ` filename*${part}*=${part === 0 ? "utf-8''" : ""}${segment}`),
  ].join(";\r\n");
}

export async function createSmtpSender(input = {}) {
  let socket;

  try {
    // 입력이 잘못돼도 예외로 터지지 않고 {status:"failed"} 로 돌려줍니다(감사 기록·한국어 안내가 남도록).
    const options = withSmtpStage("payload", () => normalizeSmtpInput(input));
    socket = await withSmtpStageAsync("connect", () => openSmtpSocket(options));
    let reader = createSmtpReader(socket);
    await withSmtpStageAsync("greeting", () => expectSmtp(reader, [220]));
    await withSmtpStageAsync("ehlo", () => sendSmtpCommand(socket, reader, `EHLO ${options.clientName}`, [250]));
    if (options.startTls) {
      await withSmtpStageAsync("starttls", () => sendSmtpCommand(socket, reader, "STARTTLS", [220]));
      reader.dispose();
      socket = await withSmtpStageAsync("starttls", () => upgradeSmtpSocket(socket, options));
      reader = createSmtpReader(socket);
      await withSmtpStageAsync("ehlo", () => sendSmtpCommand(socket, reader, `EHLO ${options.clientName}`, [250]));
    }

    await withSmtpStageAsync("auth", async () => {
      await sendSmtpCommand(socket, reader, "AUTH LOGIN", [334]);
      await sendSmtpCommand(socket, reader, Buffer.from(options.username).toString("base64"), [334]);
      await sendSmtpCommand(socket, reader, Buffer.from(options.password).toString("base64"), [235]);
    });
    await withSmtpStageAsync("mail_from", () => sendSmtpCommand(socket, reader, `MAIL FROM:<${options.from}>`, [250]));
    for (const recipient of options.recipients) await withSmtpStageAsync("rcpt_to", () => sendSmtpCommand(socket, reader, `RCPT TO:<${recipient}>`, [250, 251]));
    await withSmtpStageAsync("data", async () => {
      await sendSmtpCommand(socket, reader, "DATA", [354]);
      socket.write(`${renderSmtpMessage(options)}\r\n.\r\n`);
      await expectSmtp(reader, [250]);
    });
    await withSmtpStageAsync("quit", () => sendSmtpCommand(socket, reader, "QUIT", [221]));

    return {
      status: "sent",
      messageId: options.messageId,
      externalMutation: true,
      rawSecretMaterialStored: false,
      transportSecurity: options.secure ? "tls" : options.startTls ? "starttls" : "local_test_plain",
      rawSecretMaterialReturned: false,
    };
  } catch (error) {
    const smtpCode = Number.isInteger(error?.smtpCode) ? error.smtpCode : undefined;
    const errorCode = smtpCode ? String(smtpCode) : sanitizeErrorCode(error?.code);
    const smtpStage = typeof error?.smtpStage === "string" ? error.smtpStage : "";
    const failure = describeSmtpFailure({ smtpCode, errorCode, smtpStage, errorMessage: String(error?.message ?? "") });
    return {
      status: "failed",
      errorMessage: sanitizeSmtpError(error),
      ...(errorCode ? { errorCode } : {}),
      ...(smtpCode ? { smtpCode } : {}),
      ...(smtpStage ? { smtpStage } : {}),
      failureKind: failure.failureKind,
      userMessage: failure.userMessage,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  } finally {
    socket?.destroy();
  }
}

function tagSmtpStage(error, stage) {
  if (error && typeof error === "object" && !error.smtpStage) {
    try {
      error.smtpStage = stage;
    } catch {
      // 얼린 오류 객체라면 단계 표시는 생략합니다.
    }
  }
  return error;
}

function withSmtpStage(stage, run) {
  try {
    return run();
  } catch (error) {
    throw tagSmtpStage(error, stage);
  }
}

async function withSmtpStageAsync(stage, run) {
  try {
    return await run();
  } catch (error) {
    throw tagSmtpStage(error, stage);
  }
}

function sanitizeErrorCode(value) {
  const text = String(value ?? "").trim();
  return /^[A-Z][A-Z0-9_]{1,40}$/.test(text) ? text : "";
}

/**
 * SMTP 실패 이유를 사용자가 스스로 고칠 수 있는 한국어 안내로 바꿉니다.
 * 535(인증 거절) → 아이디/앱 비밀번호, 550/553/554(주소 거절) → 보내는 주소(받는 사람 단계면 받는 주소),
 * 시간 초과·연결 거부 → 보내는 서버 주소·포트.
 */
export function describeSmtpFailure(input = {}) {
  const smtpCode = Number(input.smtpCode ?? (/^\d{3}$/.test(String(input.errorCode ?? "")) ? input.errorCode : NaN));
  const errorCode = String(input.errorCode ?? "").toUpperCase();
  const stage = String(input.smtpStage ?? "");
  const message = String(input.errorMessage ?? "");
  if (stage === "payload") {
    if (/credential/i.test(message)) {
      return {
        failureKind: "auth_failed",
        userMessage: "메일 계정의 아이디나 비밀번호가 비어 있어요. 메일 연결에서 아이디와 앱 비밀번호를 다시 넣어 주세요.",
      };
    }
    if (/host|port|TLS/i.test(message)) {
      return {
        failureKind: "server_unreachable",
        userMessage: "보내는 메일 서버 설정이 올바르지 않아요. 보내는 서버 주소와 포트(보통 465 또는 587)를 확인해 주세요.",
      };
    }
    return {
      failureKind: "payload_invalid",
      userMessage: "보내는 메일 주소, 받는 사람, 제목, 본문 중 빠진 것이 있어 보내지 않았어요. 보내는 메일 주소를 확인해 주세요.",
    };
  }
  if (smtpCode === 535 || smtpCode === 534 || smtpCode === 530 || stage === "auth") {
    return {
      failureKind: "auth_failed",
      userMessage: "메일 서버가 로그인을 거절했어요. 아이디와 앱 비밀번호를 다시 확인해 주세요. 네이버·다음·Gmail은 일반 비밀번호 대신 앱 비밀번호가 필요해요.",
    };
  }
  if ([550, 551, 552, 553, 554].includes(smtpCode)) {
    if (stage === "rcpt_to") {
      return {
        failureKind: "recipient_rejected",
        userMessage: "메일 서버가 받는 사람 주소를 받아 주지 않았어요. 받는 사람 주소를 다시 확인해 주세요.",
      };
    }
    return {
      failureKind: "sender_rejected",
      userMessage: "보내는 주소가 메일 서버에서 허용되지 않았어요. 연결한 계정의 메일 주소로만 보낼 수 있는지 확인해 주세요.",
    };
  }
  if (
    ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH", "ECONNRESET", "EAI_AGAIN", "ENETUNREACH"].includes(errorCode) ||
    /timeout|timed out/i.test(message) ||
    stage === "connect" ||
    stage === "starttls"
  ) {
    return {
      failureKind: "server_unreachable",
      userMessage: "보내는 메일 서버에 연결하지 못했어요. 보내는 서버 주소와 포트(보통 465 또는 587)를 확인해 주세요.",
    };
  }
  return {
    failureKind: "unknown",
    userMessage: `메일 서버가 발송을 끝내지 못했어요${Number.isFinite(smtpCode) ? ` (응답 ${smtpCode})` : ""}. 잠시 뒤 다시 시도해 주세요.`,
  };
}

function normalizeSmtpInput(input) {
  const host = sanitizeHost(input.host);
  const port = Number(input.port);
  const username = String(input.username ?? "");
  const password = String(input.password ?? "");
  const from = sanitizeEmailAddress(input.from || username);
  const to = sanitizeEmailAddress(input.to);
  const recipientLists = mailRecipientLists(to, input.cc, input.bcc);
  const subject = sanitizeHeader(input.subject).slice(0, 180);
  // 인박스 발송 원문 한도(20000자)와 같게 둡니다 — 더 짧으면 긴 답장이 말없이 잘립니다.
  const text = sanitizeBody(input.text).slice(0, 20000);

  const secure = input.secure !== false;
  const startTls = input.startTls === true || (!secure && port === 587);
  if (!host) throw new Error("SMTP host is required");
  if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new Error("SMTP port is invalid");
  if (!username || !password) throw new Error("SMTP credential is required");
  if (!from || !to || !subject || !text) throw new Error("SMTP message payload is incomplete");
  if (!secure && !startTls && host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("SMTP transport must use TLS or STARTTLS");
  }

  const fromDomain = from.split("@")[1] || "modycrew.local";
  const inReplyTo = sanitizeRfcMessageId(input.inReplyTo);
  const references = (Array.isArray(input.references) ? input.references : [])
    .map(sanitizeRfcMessageId)
    .filter(Boolean)
    .slice(0, 20);

  return {
    host,
    port,
    secure,
    startTls,
    username,
    password,
    from,
    to,
    ...recipientLists,
    subject,
    text,
    attachments: prepareMailAttachments(input.attachments),
    inReplyTo,
    references,
    clientName: sanitizeHost(input.clientName) || "modycrew.local",
    messageId: `<modycrew-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@${fromDomain}>`,
  };
}

/** RFC message-id 값 정리 — 꺾쇠/공백 제거, 인쇄 가능 ASCII + @ 필수, 길이 제한. */
function sanitizeRfcMessageId(value) {
  const text = String(value ?? "").trim().replace(/[<>\s]/g, "").slice(0, 160);
  return text.includes("@") && /^[\x21-\x7e]+$/.test(text) ? text : "";
}

function openSmtpSocket(options) {
  return new Promise((resolve, reject) => {
    const socket = options.secure
      ? tls.connect({
          host: options.host,
          port: options.port,
          servername: options.host,
          timeout: SMTP_TIMEOUT_MS,
        })
      : net.connect({
          host: options.host,
          port: options.port,
          timeout: SMTP_TIMEOUT_MS,
        });

    socket.once(options.secure ? "secureConnect" : "connect", () => resolve(socket));
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("SMTP connection timeout"));
    });
    socket.once("error", reject);
  });
}

function createSmtpReader(socket) {
  let buffer = "";
  const waiters = [];

  const onData = (chunk) => {
    buffer += chunk.toString("utf8");
    flushWaiters();
  };
  const onError = (error) => {
    while (waiters.length) waiters.shift().reject(error);
  };

  socket.on("data", onData);
  socket.on("error", onError);

  function flushWaiters() {
    while (waiters.length) {
      const response = readCompleteSmtpResponse();
      if (!response) return;
      waiters.shift().resolve(response);
    }
  }

  function readCompleteSmtpResponse() {
    const lines = buffer.split(/\r?\n/);
    if (lines.length <= 1) return null;

    let consumed = 0;
    const responseLines = [];
    for (const line of lines) {
      if (!line) {
        consumed += 1;
        continue;
      }
      responseLines.push(line);
      consumed += 1;
      if (/^\d{3} /.test(line)) {
        buffer = lines.slice(consumed).join("\r\n");
        return responseLines.join("\n");
      }
    }
    return null;
  }

  return {
    next() {
      const response = readCompleteSmtpResponse();
      if (response) return Promise.resolve(response);
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    dispose() {
      socket.off("data", onData);
      socket.off("error", onError);
    },
  };
}

async function sendSmtpCommand(socket, reader, command, expectedCodes) {
  socket.write(`${command}\r\n`);
  return expectSmtp(reader, expectedCodes);
}

async function expectSmtp(reader, expectedCodes) {
  const response = await reader.next();
  const code = Number(response.slice(0, 3));
  if (!expectedCodes.includes(code)) {
    const error = new Error(`SMTP response ${code || "unknown"} was not expected`);
    if (Number.isInteger(code) && code > 0) error.smtpCode = code;
    throw error;
  }
  return response;
}

// 답장 스레딩 헤더(In-Reply-To/References)를 포함해야 상대 메일함에서
// 우리 답장이 원문 스레드에 붙는다. 헤더가 없으면 새 메일로 흩어진다.
export function renderSmtpMessage(options) {
  const mime = renderMailMimeContent(options.text, options.attachments);
  const headers = [
    `From: <${options.from}>`,
    `To: <${options.to}>`,
    ...(options.cc?.length ? [mailAddressHeader('Cc', options.cc)] : []),
    // Bcc goes only in the SMTP envelope; never expose it in recipients' MIME.
    `Subject: ${encodeMimeHeader(options.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${options.messageId}`,
    ...(options.inReplyTo ? [`In-Reply-To: <${options.inReplyTo}>`] : []),
    ...(options.references?.length
      ? [`References: ${options.references.map((reference) => `<${reference}>`).join(" ")}`]
      : []),
    ...mime.headers,
  ];
  return `${headers.join("\r\n")}\r\n\r\n${dotStuff(mime.body)}`;
}

/** 스모크 전용 — 네트워크 없이 메시지 렌더링 계약을 검증하기 위한 노출. */
export function normalizeSmtpInputForTest(input) {
  return normalizeSmtpInput(input);
}

function dotStuff(text) {
  return String(text)
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function encodeMimeHeader(value) {
  const text = String(value);
  return /^[\x00-\x7f]*$/.test(text)
    ? text
    : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function sanitizeHost(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-z0-9.-]/gi, "")
    .slice(0, 120);
}

function sanitizeEmailAddress(value) {
  const text = String(value ?? "").trim().slice(0, 320);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : "";
}

function sanitizeHeader(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeBody(value) {
  return String(value ?? "")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\bsk-(ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim();
}

function sanitizeSmtpError(error) {
  return String(error?.message ?? error ?? "SMTP send failed")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .slice(0, 240);
}
function upgradeSmtpSocket(socket, options) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({
      socket,
      servername: options.host,
    });
    secureSocket.setTimeout(SMTP_TIMEOUT_MS);
    secureSocket.once("secureConnect", () => resolve(secureSocket));
    secureSocket.once("timeout", () => {
      secureSocket.destroy();
      reject(new Error("SMTP STARTTLS handshake timeout"));
    });
    secureSocket.once("error", reject);
  });
}
