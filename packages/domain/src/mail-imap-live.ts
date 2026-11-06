import { ImapFlow } from "imapflow";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { DownloadObject, FetchMessageObject, ImapFlowOptions, MailboxLockObject, MessageStructureObject } from "imapflow";

import { createMailSecureIntakeDecision } from "./mail-secure-intake.js";
import { stripMailHtmlToText } from "./mail-quote.js";
import { extractRfcMessageId } from "./mail-threading.js";
import { attachHiddenOriginalSubject, attachHiddenReplyToAddress } from "./mail-reply-address.js";

export type ModyMailImapLiveStatus =
  | "needs_credentials"
  | "imap_connected"
  | "imap_connect_failed";

export type ModyMailImapAttachmentDownloadStatus =
  | "needs_credentials"
  | "needs_download_root"
  | "imap_attachment_downloaded"
  | "imap_attachment_not_found"
  | "imap_connect_failed";

export type ModyMailImapLiveAction = "read_latest_messages";

export type ModyMailImapLiveMessagePreview = {
  uid: number;
  seq: number;
  subject: string;
  from?: string;
  receivedAt?: string;
  size?: number;
  flags: string[];
  /** 목록 fetch의 bodyStructure에서 확인한 첨부 포함 여부. 구조를 읽지 않으면 생략한다. */
  hasAttachments?: boolean;
  /** text 파트 본문 미리보기(읽기 전용 EXAMINE, 비밀값 마스킹, 최대 800자). */
  previewText?: string;
  /** 원문의 RFC Message-ID(꺾쇠 제거) — 답장 스레딩 헤더용. */
  rfcMessageId?: string;
  /** 원문의 In-Reply-To(꺾쇠 제거). */
  inReplyTo?: string;
  /** 답장 받을 주소(Reply-To, 없으면 From). 열거되지 않는 속성으로만 붙는다. */
  readonly replyToAddress?: string;
  /** 받은 메일의 실제 제목 원문(최대 300자). 열거되지 않는 속성으로만 붙는다. */
  readonly originalSubject?: string;
};

export type ModyMailImapLiveInput = {
  providerId?: string;
  host?: string;
  port?: number | string;
  secure?: boolean;
  startTls?: boolean;
  username?: string;
  password?: string;
  mailbox?: string;
  limit?: number | string;
  /**
   * false면 본문 미리보기 fetch를 끄고 envelope만 읽는다(기본 true).
   * 라이브 read-only 증거 스크립트처럼 envelope-only 계약을 유지해야 하는
   * 경로에서 사용한다.
   */
  includeBodyPreview?: boolean;
};

export type ModyMailImapAttachmentDownloadInput = ModyMailImapLiveInput & {
  uid?: number | string;
  downloadRootPath?: string;
  maxAttachments?: number | string;
  maxBytesPerAttachment?: number | string;
};

export type ModyMailImapDownloadedAttachment = {
  id: string;
  uid: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
  savedPath: string;
};

export type ModyMailImapAttachmentDownloadResult = {
  status: ModyMailImapAttachmentDownloadStatus;
  providerId: string;
  action: "download_message_attachments_to_local_staging";
  uid?: number;
  mailbox?: string;
  downloadRootPath?: string;
  attachmentCount: number;
  attachments: ModyMailImapDownloadedAttachment[];
  readOnlyMailboxLock: true;
  externalMutation: false;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  rawMessageSourceReturned: false;
  localFileWrite: boolean;
  originalMailMutated: false;
  userMessage: string;
  errorMessage?: string;
  auditMessages: string[];
};

export type ModyMailImapLiveResult = {
  status: ModyMailImapLiveStatus;
  providerId: string;
  action: ModyMailImapLiveAction;
  externalMutation: false;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  host?: string;
  port?: number;
  secure?: boolean;
  mailbox?: string;
  mailboxExists?: number;
  messages?: ModyMailImapLiveMessagePreview[];
  messageCount?: number;
  userMessage: string;
  errorMessage?: string;
  auditMessages: string[];
};

type ModyMailImapLiveClient = {
  connect: () => Promise<void>;
  getMailboxLock: (mailbox: string, options?: { readOnly?: boolean; description?: string }) => Promise<MailboxLockObject>;
  fetchOne: (
    seq: string,
    query: { uid: true; envelope?: true; bodyStructure?: true },
    options?: { uid?: boolean },
  ) => Promise<FetchMessageObject | false>;
  download: (range: string, part?: string, options?: { uid?: boolean; maxBytes?: number }) => Promise<DownloadObject>;
  fetch: (
    range: string,
    query: { uid: true; flags: true; envelope: true; internalDate: true; size: true; bodyStructure?: true },
  ) => AsyncIterable<FetchMessageObject>;
  logout: () => Promise<void>;
  mailbox: { exists: number; path: string; readOnly?: boolean } | false;
};

type ModyMailImapLiveConnectorOptions = {
  imapClientFactory?: (options: ImapFlowOptions) => ModyMailImapLiveClient;
};

export class ModyMailImapLiveConnector {
  private readonly imapClientFactory: (options: ImapFlowOptions) => ModyMailImapLiveClient;

  constructor(options: ModyMailImapLiveConnectorOptions = {}) {
    this.imapClientFactory = options.imapClientFactory ?? ((imapOptions) => new ImapFlow(imapOptions) as unknown as ModyMailImapLiveClient);
  }

  async readLatestMessages(input: ModyMailImapLiveInput): Promise<ModyMailImapLiveResult> {
    const normalized = normalizeInput(input);
    if (!normalized.ok) return normalized.result;

    const { providerId, host, port, secure, startTls, username, password, mailbox, limit } = normalized;
    const client = this.imapClientFactory({
      host,
      port,
      secure,
      ...(startTls ? { doSTARTTLS: true } : {}),
      auth: {
        user: username,
        pass: password,
      },
      logger: false,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
      tls: {
        servername: host,
      },
    });

    let lock: MailboxLockObject | undefined;
    try {
      await client.connect();
      lock = await client.getMailboxLock(mailbox, {
        readOnly: true,
        description: "ModyCrew read-only latest mail preview",
      });

      const mailboxExists = client.mailbox && typeof client.mailbox.exists === "number"
        ? client.mailbox.exists
        : 0;
      const range = mailboxExists > 0
        ? `${Math.max(1, mailboxExists - limit + 1)}:*`
        : "";
      const messages: ModyMailImapLiveMessagePreview[] = [];
      const includeBodyPreview = input.includeBodyPreview !== false;
      const bodyStructuresByUid = new Map<number, MessageStructureObject>();

      if (range) {
        for await (const message of client.fetch(range, {
          uid: true,
          flags: true,
          envelope: true,
          internalDate: true,
          size: true,
          ...(includeBodyPreview ? { bodyStructure: true } : {}),
        })) {
          const preview = toPreview(message);
          messages.push(preview);
          if (message.bodyStructure) {
            bodyStructuresByUid.set(preview.uid, message.bodyStructure);
          }
        }
      }

      // 본문 미리보기는 최신 일부만 best-effort로 가져온다. readOnly 락(EXAMINE)
      // 상태라 서버가 읽음 플래그를 바꾸지 않으며, 실패해도 목록 읽기는 유지한다.
      if (includeBodyPreview) {
        await attachBodyPreviews(
          client,
          selectBusinessBodyPreviewCandidates(messages, mailbox),
          bodyStructuresByUid,
        );
      }

      await client.logout();
      return successResult({
        providerId,
        host,
        port,
        secure,
        mailbox,
        mailboxExists,
        messages: messages.reverse(),
        bodyPreviewEnabled: includeBodyPreview,
      });
    } catch (error) {
      try {
        if (lock) lock.release();
      } catch {
        // best-effort cleanup only
      }
      try {
        await client.logout();
      } catch {
        // best-effort cleanup only
      }
      return failureResult({
        providerId,
        host,
        port,
        secure,
        mailbox,
        userMessage: "IMAP 메일함 읽기 연결에 실패했습니다. 서버, 포트, 아이디, 앱 비밀번호를 확인하세요.",
        errorMessage: redactMailImapSecret(error instanceof Error ? error.message : String(error), [password]),
      });
    } finally {
      try {
        if (lock) lock.release();
      } catch {
        // best-effort cleanup only
      }
    }
  }

  async downloadMessageAttachments(input: ModyMailImapAttachmentDownloadInput): Promise<ModyMailImapAttachmentDownloadResult> {
    const normalized = normalizeInput(input);
    const providerId = normalized.ok ? normalized.providerId : normalized.result.providerId;
    const mailbox = normalized.ok ? normalized.mailbox : sanitizeMailbox(input.mailbox);
    const uid = sanitizeUid(input.uid);
    const downloadRootPath = sanitizeDownloadRootPath(input.downloadRootPath);
    const maxAttachments = sanitizeAttachmentLimit(input.maxAttachments);
    const maxBytesPerAttachment = sanitizeAttachmentBytes(input.maxBytesPerAttachment);

    if (!normalized.ok) {
      return attachmentDownloadResult({
        status: "needs_credentials",
        providerId,
        mailbox,
        attachmentCount: 0,
        attachments: [],
        localFileWrite: false,
        userMessage: normalized.result.userMessage,
        auditMessages: [
          ...normalized.result.auditMessages,
          "첨부 다운로드는 credential이 준비되기 전에는 시작하지 않습니다.",
        ],
      });
    }

    if (!uid) {
      return attachmentDownloadResult({
        status: "imap_attachment_not_found",
        providerId,
        mailbox,
        attachmentCount: 0,
        attachments: [],
        localFileWrite: false,
        userMessage: "다운로드할 메일 UID가 필요합니다.",
        auditMessages: ["IMAP attachment download skipped because uid was missing"],
      });
    }

    if (!downloadRootPath) {
      return attachmentDownloadResult({
        status: "needs_download_root",
        providerId,
        uid,
        mailbox,
        attachmentCount: 0,
        attachments: [],
        localFileWrite: false,
        userMessage: "메일 첨부를 임시 저장할 로컬 폴더가 필요합니다.",
        auditMessages: ["IMAP attachment download skipped because download root was missing"],
      });
    }

    const { host, port, secure, startTls, username, password } = normalized;
    const client = this.imapClientFactory({
      host,
      port,
      secure,
      ...(startTls ? { doSTARTTLS: true } : {}),
      auth: {
        user: username,
        pass: password,
      },
      logger: false,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      tls: {
        servername: host,
      },
    });

    let lock: MailboxLockObject | undefined;
    try {
      await mkdir(downloadRootPath, { recursive: true });
      await client.connect();
      lock = await client.getMailboxLock(mailbox, {
        readOnly: true,
        description: "ModyCrew read-only attachment staging",
      });
      const message = await client.fetchOne(String(uid), {
        uid: true,
        envelope: true,
        bodyStructure: true,
      }, { uid: true });
      const attachmentParts = collectAttachmentParts(message ? message.bodyStructure : undefined).slice(0, maxAttachments);
      const saved: ModyMailImapDownloadedAttachment[] = [];

      for (const [index, part] of attachmentParts.entries()) {
        if (!part.part) continue;
        const downloaded = await client.download(String(uid), part.part, {
          uid: true,
          maxBytes: maxBytesPerAttachment,
        });
        const filename = safeAttachmentFilename(part.filename || downloaded.meta.filename || `attachment-${index + 1}`);
        const savedPath = path.join(downloadRootPath, uniqueAttachmentFilename(uid, index, filename));
        await pipeline(downloaded.content, createWriteStream(savedPath, { flags: "wx" }));
        saved.push({
          id: `imap-${uid}-${index + 1}`,
          uid,
          filename,
          contentType: downloaded.meta.contentType || part.contentType || "application/octet-stream",
          sizeBytes: Number(downloaded.meta.expectedSize ?? part.size ?? 0),
          savedPath,
        });
      }

      await client.logout();
      return attachmentDownloadResult({
        status: saved.length > 0 ? "imap_attachment_downloaded" : "imap_attachment_not_found",
        providerId,
        uid,
        mailbox,
        downloadRootPath,
        attachmentCount: saved.length,
        attachments: saved,
        localFileWrite: saved.length > 0,
        userMessage: saved.length > 0
          ? `IMAP 메일 UID ${uid}의 첨부 ${saved.length}개를 로컬 임시 폴더에 저장했습니다. 정리는 승인 카드에서만 진행합니다.`
          : `IMAP 메일 UID ${uid}에서 다운로드할 첨부를 찾지 못했습니다.`,
        auditMessages: [
          "ImapFlow connect 완료",
          "getMailboxLock readOnly=true로 mailbox를 열었습니다.",
          "fetchOne bodyStructure로 첨부 part만 확인했습니다.",
          "download(part)로 첨부 파일만 로컬 임시 폴더에 저장했습니다.",
          "메일 삭제, 이동, 읽음 처리, 답장 발송은 실행하지 않았습니다.",
          "비밀번호와 원문 메일 source/body는 결과에 반환하지 않습니다.",
        ],
      });
    } catch (error) {
      try {
        if (lock) lock.release();
      } catch {
        // best-effort cleanup only
      }
      try {
        await client.logout();
      } catch {
        // best-effort cleanup only
      }
      return attachmentDownloadResult({
        status: "imap_connect_failed",
        providerId,
        uid,
        mailbox,
        downloadRootPath,
        attachmentCount: 0,
        attachments: [],
        localFileWrite: false,
        userMessage: "IMAP 첨부 임시 저장에 실패했습니다. 서버, 포트, 아이디, 앱 비밀번호와 저장 폴더를 확인하세요.",
        errorMessage: redactMailImapSecret(error instanceof Error ? error.message : String(error), [password]),
        auditMessages: [
          "IMAP attachment download failed before mail mutation",
          "오류 메시지는 password-like 문자열을 마스킹한 뒤 반환합니다.",
        ],
      });
    } finally {
      try {
        if (lock) lock.release();
      } catch {
        // best-effort cleanup only
      }
    }
  }
}

function normalizeInput(input: ModyMailImapLiveInput):
  | {
    ok: true;
    providerId: string;
    host: string;
    port: number;
    secure: boolean;
    startTls: boolean;
    username: string;
    password: string;
    mailbox: string;
    limit: number;
  }
  | { ok: false; result: ModyMailImapLiveResult } {
  const providerId = sanitizeProviderId(input.providerId);
  const host = sanitizeHost(input.host);
  const port = sanitizePort(input.port);
  const secure = input.secure !== false;
  const startTls = !secure && input.startTls === true;
  const username = sanitizeUsername(input.username);
  const password = sanitizePassword(input.password);
  const mailbox = sanitizeMailbox(input.mailbox);
  const limit = sanitizeLimit(input.limit);

  if (!host || !username || !password) {
    return {
      ok: false,
      result: {
        status: "needs_credentials",
        providerId,
        action: "read_latest_messages",
        externalMutation: false,
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        ...(host ? { host } : {}),
        ...(port ? { port } : {}),
        secure,
        mailbox,
        userMessage: "IMAP 서버, 메일 아이디, 앱 비밀번호가 필요합니다.",
        auditMessages: [
          "IMAP live connector needs user-provided host, username, and app password",
          "비밀번호 원문은 결과, 로그, 리포트에 반환하지 않습니다.",
        ],
      },
    };
  }

  if (!port) {
    return {
      ok: false,
      result: {
        status: "needs_credentials",
        providerId,
        action: "read_latest_messages",
        externalMutation: false,
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        host,
        secure,
        mailbox,
        userMessage: "IMAP 포트가 올바르지 않습니다. 일반적으로 SSL IMAP은 993을 사용합니다.",
        auditMessages: [
          "IMAP live connector rejected invalid port",
          "외부 메일함에는 접속하지 않았습니다.",
        ],
      },
    };
  }

  return {
    ok: true,
    providerId,
    host,
    port,
    secure,
    startTls,
    username,
    password,
    mailbox,
    limit,
  };
}

function successResult(input: {
  providerId: string;
  host: string;
  port: number;
  secure: boolean;
  mailbox: string;
  mailboxExists: number;
  messages: ModyMailImapLiveMessagePreview[];
  bodyPreviewEnabled: boolean;
}): ModyMailImapLiveResult {
  return {
    status: "imap_connected",
    providerId: input.providerId,
    action: "read_latest_messages",
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    host: input.host,
    port: input.port,
    secure: input.secure,
    mailbox: input.mailbox,
    mailboxExists: input.mailboxExists,
    messageCount: input.messages.length,
    messages: input.messages,
    userMessage: `IMAP ${input.mailbox} 메일함에 읽기 전용으로 접속해 최신 ${input.messages.length}건을 확인했습니다.`,
    auditMessages: [
      "ImapFlow connect 완료",
      "getMailboxLock readOnly=true로 mailbox를 열었습니다.",
      input.bodyPreviewEnabled
        ? "fetch envelope/internalDate/flags/size/bodyStructure를 먼저 사용했고, 메타데이터 보안 분류에서 업무 후보인 최신 일부의 text 파트 미리보기(최대 800자)만 readOnly(EXAMINE) 상태에서 확인했습니다. 광고/잡음·확인 필요 메일의 본문은 가져오지 않았으며 raw source는 가져오지 않았습니다."
        : "fetch envelope/internalDate/flags/size만 사용하고 source/body를 가져오지 않았습니다.",
      "메일 삭제, 이동, 읽음 처리, 답장 발송은 실행하지 않았습니다.",
      "비밀번호 원문은 결과, 로그, 리포트에 반환하지 않습니다.",
    ],
  };
}

function failureResult(input: {
  providerId: string;
  host: string;
  port: number;
  secure: boolean;
  mailbox: string;
  userMessage: string;
  errorMessage: string;
}): ModyMailImapLiveResult {
  return {
    status: "imap_connect_failed",
    providerId: input.providerId,
    action: "read_latest_messages",
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    host: input.host,
    port: input.port,
    secure: input.secure,
    mailbox: input.mailbox,
    userMessage: input.userMessage,
    errorMessage: input.errorMessage,
    auditMessages: [
      "IMAP live read failed before any mutation",
      "오류 메시지는 password-like 문자열을 마스킹한 뒤 반환합니다.",
    ],
  };
}

function toPreview(message: FetchMessageObject): ModyMailImapLiveMessagePreview {
  const envelope = message.envelope;
  const preview: ModyMailImapLiveMessagePreview = {
    uid: Number(message.uid),
    seq: Number(message.seq),
    subject: normalizeText(envelope?.subject, "(제목 없음)"),
    flags: normalizeFlags(message.flags),
  };
  const from = envelope?.from?.[0]?.address;
  if (from) preview.from = from;
  // 답장 받을 주소: Reply-To가 있으면 그것, 없으면 From. 열거되지 않게 숨겨 나른다.
  attachHiddenReplyToAddress(preview, envelope?.replyTo?.[0]?.address, from);
  // 실제 제목 원문(240자로 자른 보이는 제목과 달리 최대 300자)도 숨겨 나른다.
  attachHiddenOriginalSubject(preview, envelope?.subject);
  const receivedAt = message.internalDate ?? envelope?.date;
  if (receivedAt instanceof Date) preview.receivedAt = receivedAt.toISOString();
  if (typeof message.size === "number") preview.size = message.size;
  const rfcMessageId = extractRfcMessageId(String(envelope?.messageId ?? ""));
  if (rfcMessageId) preview.rfcMessageId = rfcMessageId;
  const inReplyTo = extractRfcMessageId(String(envelope?.inReplyTo ?? ""));
  if (inReplyTo) preview.inReplyTo = inReplyTo;
  if (message.bodyStructure) {
    preview.hasAttachments = collectAttachmentParts(message.bodyStructure).length > 0;
  }
  return preview;
}

const bodyPreviewMaxMessages = 12;
const bodyPreviewMaxBytes = 4096;
const bodyPreviewMaxChars = 800;

/**
 * 본문을 읽기 전에 IMAP envelope 메타데이터만 secure-intake 규칙으로 판정한다.
 * 광고/잡음과 확인 필요 메일은 text part download 대상에서 제외해,
 * 업무 후보에 한해서만 제한된 미리보기를 가져온다.
 */
function selectBusinessBodyPreviewCandidates(
  messages: ModyMailImapLiveMessagePreview[],
  mailbox: string,
): ModyMailImapLiveMessagePreview[] {
  // Filter first: a burst of newsletters must not consume the body-preview budget
  // and hide the business mail already included in this read-only fetch.
  return messages.filter((message) =>
    createMailSecureIntakeDecision({
      messageId: String(message.uid),
      mailboxId: mailbox,
      providerId: "imap_smtp",
      subject: message.subject,
      from: message.from ?? "",
      receivedAt: message.receivedAt ?? "",
      snippet: "",
      labels: message.flags,
    }).classification === "business_candidate",
  ).slice(-bodyPreviewMaxMessages);
}

/**
 * 최신 일부 메시지의 text 파트 본문 미리보기를 best-effort로 채운다.
 * readOnly 락(EXAMINE) 하에서만 호출되므로 읽음 플래그가 변하지 않는다.
 * 어떤 실패도 목록 읽기를 막지 않는다(미리보기만 생략).
 */
async function attachBodyPreviews(
  client: ModyMailImapLiveClient,
  messages: ModyMailImapLiveMessagePreview[],
  bodyStructuresByUid: ReadonlyMap<number, MessageStructureObject>,
): Promise<void> {
  const start = Math.max(0, messages.length - bodyPreviewMaxMessages);
  for (let index = start; index < messages.length; index += 1) {
    const preview = messages[index];
    if (!preview) continue;
    try {
      let structure = bodyStructuresByUid.get(preview.uid);
      if (!structure) {
        const detail = await client.fetchOne(
          String(preview.uid),
          { uid: true, bodyStructure: true },
          { uid: true },
        );
        structure = detail ? detail.bodyStructure : undefined;
      }
      if (!structure) continue;
      const selected = selectTextPartForPreview(structure);
      if (!selected) continue;
      const downloaded = await client.download(String(preview.uid), selected.part, {
        uid: true,
        maxBytes: bodyPreviewMaxBytes,
      });
      const raw = await readDownloadedTextPreview(downloaded);
      // HTML 전용 메일(한국 업무/알림 메일에 흔함)은 태그를 제거해야
      // 미리보기와 AI 입력에 마크업이 새지 않는다.
      const text = selected.isHtml ? stripMailHtmlToText(raw) : raw;
      if (text) preview.previewText = redactMailPreviewText(text);
    } catch {
      // 미리보기는 best-effort — 목록 읽기 자체를 막지 않는다.
    }
  }
}

/**
 * bodyStructure에서 첨부가 아닌 text/plain(없으면 text/*) 파트 키를 고른다.
 * message/rfc822(전달된 .eml 첨부) 내부로는 재귀하지 않는다 — 내장 메시지는
 * wrapper와 같은 part 번호를 재사용해 원시 rfc822 헤더가 미리보기로 새어
 * 나올 수 있다.
 */
function selectTextPartForPreview(
  structure: MessageStructureObject,
): { part: string; isHtml: boolean } | null {
  const isAttachment = (node: MessageStructureObject): boolean =>
    String(node.disposition ?? "").toLowerCase() === "attachment";
  const collect = (node: MessageStructureObject): MessageStructureObject[] => {
    if (String(node.type ?? "").toLowerCase() === "message/rfc822") return [];
    const children = Array.isArray(node.childNodes) ? node.childNodes : [];
    return [node, ...children.flatMap(collect)];
  };
  const nodes = collect(structure).filter((node) => !isAttachment(node));
  const plain = nodes.find((node) => String(node.type ?? "").toLowerCase() === "text/plain");
  const anyText = plain ?? nodes.find((node) => String(node.type ?? "").toLowerCase().startsWith("text/"));
  if (!anyText) return null;
  const isHtml = String(anyText.type ?? "").toLowerCase() === "text/html";
  return { part: anyText.part ?? "1", isHtml };
}

/** download 스트림을 상한까지 모아 charset을 반영해 텍스트로 디코드한다. */
async function readDownloadedTextPreview(downloaded: DownloadObject): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of downloaded.content) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    total += buffer.length;
    if (total >= bodyPreviewMaxBytes) break;
  }
  if (!chunks.length) return "";
  const merged = Buffer.concat(chunks).subarray(0, bodyPreviewMaxBytes);
  const charset = String(downloaded.meta?.charset ?? "utf-8");
  try {
    return new TextDecoder(charset).decode(merged);
  } catch {
    return merged.toString("utf8");
  }
}

/** 미리보기용 마스킹 — 토큰/키 형태 문자열 제거, 제어문자 제거, 길이 상한. */
function redactMailPreviewText(text: string): string {
  return String(text)
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\bpass(?:word)?\s*[=:]\s*[^\s&"']+/gi, "password=[redacted]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, bodyPreviewMaxChars);
}

function attachmentDownloadResult(input: {
  status: ModyMailImapAttachmentDownloadStatus;
  providerId: string;
  uid?: number;
  mailbox?: string;
  downloadRootPath?: string;
  attachmentCount: number;
  attachments: ModyMailImapDownloadedAttachment[];
  localFileWrite: boolean;
  userMessage: string;
  errorMessage?: string;
  auditMessages: string[];
}): ModyMailImapAttachmentDownloadResult {
  return {
    status: input.status,
    providerId: input.providerId,
    action: "download_message_attachments_to_local_staging",
    ...(typeof input.uid === "number" ? { uid: input.uid } : {}),
    ...(input.mailbox ? { mailbox: input.mailbox } : {}),
    ...(input.downloadRootPath ? { downloadRootPath: input.downloadRootPath } : {}),
    attachmentCount: input.attachmentCount,
    attachments: input.attachments,
    readOnlyMailboxLock: true,
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    rawMessageSourceReturned: false,
    localFileWrite: input.localFileWrite,
    originalMailMutated: false,
    userMessage: input.userMessage,
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    auditMessages: input.auditMessages,
  };
}

function collectAttachmentParts(structure?: MessageStructureObject): Array<{
  part: string;
  filename?: string;
  contentType?: string;
  size?: number;
}> {
  if (!structure) return [];
  const parts: Array<{ part: string; filename?: string; contentType?: string; size?: number }> = [];
  const visit = (node: MessageStructureObject) => {
    const filename = node.dispositionParameters?.filename ?? node.parameters?.name;
    const disposition = String(node.disposition ?? "").toLowerCase();
    const attachmentLike = Boolean(filename) || disposition === "attachment";
    if (node.part && attachmentLike) {
      parts.push({
        part: node.part,
        ...(filename ? { filename } : {}),
        contentType: node.type,
        ...(typeof node.size === "number" ? { size: node.size } : {}),
      });
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(structure);
  return parts;
}

function sanitizeUid(value: unknown): number | undefined {
  const uid = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(uid) || uid < 1) return undefined;
  return uid;
}

function sanitizeDownloadRootPath(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || /[\u0000\r\n]/u.test(text)) return "";
  return path.resolve(text);
}

function sanitizeAttachmentLimit(value: unknown): number {
  const limit = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(limit)) return 5;
  return Math.min(Math.max(limit, 1), 12);
}

function sanitizeAttachmentBytes(value: unknown): number {
  const bytes = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(bytes)) return 20 * 1024 * 1024;
  return Math.min(Math.max(bytes, 64 * 1024), 50 * 1024 * 1024);
}

function safeAttachmentFilename(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  const normalized = text
    .replaceAll(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, "-")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return normalized || "attachment.bin";
}

function uniqueAttachmentFilename(uid: number, index: number, filename: string): string {
  const extension = path.extname(filename).slice(0, 16);
  const base = path.basename(filename, extension).slice(0, 80) || "attachment";
  return `${uid}-${index + 1}-${Date.now()}-${base}${extension}`;
}

function sanitizeProviderId(value: unknown): string {
  const providerId = typeof value === "string" ? value.trim() : "";
  return /^[a-z0-9._-]{2,64}$/i.test(providerId) ? providerId : "imap_smtp";
}

function sanitizeHost(value: unknown): string {
  const host = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9.-]{3,253}$/i.test(host)) return "";
  if (host.includes("..")) return "";
  return host;
}

function sanitizePort(value: unknown): number | undefined {
  const port = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  return port;
}

function sanitizeUsername(value: unknown): string {
  const username = typeof value === "string" ? value.trim() : "";
  return username.length > 0 && username.length <= 320 ? username : "";
}

function sanitizePassword(value: unknown): string {
  const password = typeof value === "string" ? value.trim() : "";
  return password.length > 0 && password.length <= 512 ? password : "";
}

function sanitizeMailbox(value: unknown): string {
  const mailbox = typeof value === "string" ? value.trim() : "";
  if (!mailbox || mailbox.length > 128 || /[\r\n]/.test(mailbox)) return "INBOX";
  return mailbox;
}

function sanitizeLimit(value: unknown): number {
  const limit = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(limit)) return 5;
  return Math.min(Math.max(limit, 1), 50);
}

function normalizeText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 240) : fallback;
}

function normalizeFlags(value: unknown): string[] {
  if (value instanceof Set) return [...value].filter((flag): flag is string => typeof flag === "string").slice(0, 20);
  if (Array.isArray(value)) return value.filter((flag): flag is string => typeof flag === "string").slice(0, 20);
  return [];
}

export function redactMailImapSecret(value: string, secrets: string[] = []): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join("[imap-secret-redacted]");
  }
  return redacted
    .replace(/\b[A-Za-z0-9+/=._-]{16,}\b/g, "[imap-secret-redacted]")
    .replace(/pass(word)?=[^&\s]+/gi, "password=[imap-secret-redacted]");
}
