import type { ModyProviderMailMessagePreview } from "./provider-read-adapter.js";

import { extractRfcMessageId } from "./mail-threading.js";
import { attachHiddenOriginalSubject, attachHiddenReplyToAddress } from "./mail-reply-address.js";
import { stripMailHtmlToText } from "./mail-quote.js";

export type ModyGmailMailLiveStatus =
  | "needs_credentials"
  | "mail_loaded"
  | "gmail_api_failed";

export type ModyGmailMailLiveInput = {
  accessToken?: string;
  mailboxId?: string;
  query?: string;
  limit?: number;
};

export type ModyGmailMailLiveResult = {
  status: ModyGmailMailLiveStatus;
  providerId: "gmail";
  action: "list_mail_messages";
  externalMutation: false;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/messages";
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

type GmailListResponse = {
  messages?: Array<{ id?: string; threadId?: string }>;
  error?: { message?: string; status?: string };
};

type GmailMessageResponse = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
    mimeType?:string; filename?:string; body?:{data?:string;attachmentId?:string;size?:number}; parts?:GmailMessageResponse['payload'][];
  };
  error?: { message?: string; status?: string };
};

export class ModyGmailMailLiveConnector {
  private readonly fetchImpl: FetchLike;
  private readonly endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/messages";
  private readonly now: () => Date;

  constructor(options: {
    fetch?: FetchLike;
    now?: () => Date;
  } = {}) {
    const fetchImpl = options.fetch ?? (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (!fetchImpl) throw new Error("fetch runtime is required for Gmail mail live connector");
    this.fetchImpl = fetchImpl as FetchLike;
    this.endpoint = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
    this.now = options.now ?? (() => new Date());
  }

  async listLatestMessages(input: ModyGmailMailLiveInput): Promise<ModyGmailMailLiveResult> {
    const accessToken = sanitizeAccessToken(input.accessToken);
    if (!accessToken) return needsCredentials("Gmail OAuth access token이 필요합니다.");

    const limit = clampLimit(input.limit);
    const mailboxId = sanitizeMailboxId(input.mailboxId);
    const query = sanitizeQuery(input.query) || "in:inbox";
    const listUrl = new URL(this.endpoint);
    listUrl.searchParams.set("maxResults", String(limit));
    listUrl.searchParams.set("q", query);

    try {
      const listed = await this.fetchJson<GmailListResponse>(listUrl.toString(), accessToken);
      const previews = [];
      for (const message of listed.messages?.slice(0, limit) ?? []) {
        const id = sanitizeId(message.id);
        if (!id) continue;
        const detailUrl = new URL(`${this.endpoint}/${encodeURIComponent(id)}`);
        detailUrl.searchParams.set("format", "metadata");
        for (const header of ["Subject", "From", "Reply-To", "Date", "Message-ID", "In-Reply-To"]) {
          detailUrl.searchParams.append("metadataHeaders", header);
        }
        const detail = await this.fetchJson<GmailMessageResponse>(detailUrl.toString(), accessToken);
        previews.push(toMessagePreview(detail, message.threadId, mailboxId, this.now().toISOString()));
      }

      return {
        status: "mail_loaded",
        providerId: "gmail",
        action: "list_mail_messages",
        externalMutation: false,
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        endpoint: this.endpoint,
        mailboxId,
        messageCount: previews.length,
        messages: previews,
        userMessage: `Gmail API에서 최신 메일 ${previews.length}건을 읽기 전용으로 확인했습니다.`,
        auditMessages: [
          "Gmail API users.messages.list/get 호출 완료",
          "gmail.readonly scope를 전제로 하며 메일 발송, 수정, 삭제는 실행하지 않았습니다.",
          "OAuth access token 원문은 결과, 로그, 리포트에 반환하지 않습니다.",
        ],
      };
    } catch (error) {
      return apiFailure(
        "Gmail API 메일 읽기 호출에 실패했습니다.",
        redactGmailToken(error instanceof Error ? error.message : String(error), [accessToken]),
        mailboxId,
      );
    }
  }

  async readMessage(input:{accessToken?:string;messageId:string}) {
    const token=sanitizeAccessToken(input.accessToken);
    if(!token) return {status:'needs_credentials',externalMutation:false,userMessage:'Gmail 연결을 다시 확인해 주세요.'};
    const id=input.messageId.replace(/^gmail-/,'');
    if(!/^[A-Za-z0-9_-]{1,220}$/.test(id)) return {status:'mail_message_invalid',externalMutation:false,userMessage:'메일 식별자를 확인해 주세요.'};
    try {
      const message=await this.fetchJson<GmailMessageResponse>(`${this.endpoint}/${encodeURIComponent(id)}?format=full`,token);
      if(message.id!==id) throw new Error('요청한 메일과 응답이 일치하지 않습니다.');
      const {body,attachments,limited}=readGmailParts(message.payload);
      if(!body) return {status:'mail_body_unavailable',externalMutation:false,userMessage:'메일 본문을 읽을 수 없습니다. 원래 메일함에서 확인해 주세요.'};
      const truncated=body.length>12000||limited;
      return {status:'mail_body_loaded',message:toMessagePreview(message,message.threadId,'INBOX',this.now().toISOString()),body:body.slice(0,12000),truncated,attachments:attachments.slice(0,100),externalMutation:false,userMessage:truncated?'메일 본문의 일부를 불러왔습니다.':'메일 본문을 불러왔습니다.'};
    } catch(error) { return {status:'gmail_api_failed',externalMutation:false,userMessage:'Gmail 본문을 읽지 못했습니다. 연결 상태와 메일 보관 여부를 확인해 주세요.',errorMessage:redactGmailToken(error instanceof Error?error.message:String(error),[token])}; }
  }

  async readConversation(input:{accessToken?:string;messageId:string}) {
    const token=sanitizeAccessToken(input.accessToken);
    const id=input.messageId.replace(/^gmail-/, '');
    if(!token)return {status:'needs_credentials',externalMutation:false,userMessage:'Gmail 연결을 다시 확인해 주세요.'};
    if(!validGmailId(id))return {status:'mail_message_invalid',externalMutation:false,userMessage:'메일 식별자를 확인해 주세요.'};
    try {
      const selected=await this.fetchJson<GmailMessageResponse>(`${this.endpoint}/${encodeURIComponent(id)}?format=full`,token);
      if(selected.id!==id||!validGmailId(selected.threadId))throw new Error('메일 대화 식별자가 일치하지 않습니다.');
      const thread=await this.fetchJson<{id?:string;messages?:GmailMessageResponse[]}>(`${this.endpoint.replace(/messages$/, 'threads')}/${encodeURIComponent(selected.threadId!)}?format=full`,token);
      if(thread.id!==selected.threadId||!Array.isArray(thread.messages)||!thread.messages.some(message=>message.id===id)||thread.messages.some(message=>message.threadId!==thread.id||!validGmailId(message.id)))throw new Error('요청한 메일 대화와 응답이 일치하지 않습니다.');
      const sorted=[...thread.messages].sort((a,b)=>Number(a.internalDate||0)-Number(b.internalDate||0));
      const included=sorted.slice(-40);
      if(!included.some(message=>message.id===id)){included.shift();included.unshift(selected);}
      let remaining=200_000;
      const messages=included.map(message=>{
        const parsed=readGmailParts(message.payload);const length=Math.min(12000,remaining);const body=parsed.body.slice(0,length);remaining-=body.length;
        return {message:toMessagePreview(message,thread.id,'INBOX',this.now().toISOString()),body,truncated:parsed.limited||parsed.body.length>body.length,attachments:parsed.attachments.slice(0,100)};
      });
      return {status:'mail_conversation_loaded',threadId:thread.id,messages,totalCount:sorted.length,truncated:sorted.length>included.length||messages.some(message=>message.truncated),externalMutation:false,userMessage:`메일 대화 ${messages.length}통을 불러왔습니다.`};
    } catch(error) {return {status:'gmail_api_failed',externalMutation:false,userMessage:'메일 대화를 불러오지 못했습니다. 연결 상태를 확인해 주세요.',errorMessage:redactGmailToken(error instanceof Error?error.message:String(error),[token])};}
  }

  async readAttachment(input:{accessToken?:string;messageId:string;attachmentKey:string}) {
    const token=sanitizeAccessToken(input.accessToken),id=input.messageId.replace(/^gmail-/, '');
    if(!token)return {status:'needs_credentials',userMessage:'Gmail 연결을 다시 확인해 주세요.'};
    if(!validGmailId(id)||!/^part(?:\.\d{1,3}){0,12}$/.test(input.attachmentKey))return {status:'mail_attachment_invalid',userMessage:'첨부파일을 다시 선택해 주세요.'};
    try {
      const message=await this.fetchJson<GmailMessageResponse>(`${this.endpoint}/${encodeURIComponent(id)}?format=full`,token);
      if(message.id!==id)throw new Error('요청한 메일과 응답이 일치하지 않습니다.');
      const attachment=readGmailParts(message.payload).attachments.find(item=>item.key===input.attachmentKey);
      if(!attachment)throw new Error('메일에서 첨부파일을 찾을 수 없습니다.');
      if(attachment.size>20_000_000)throw new Error('20MB를 초과하는 첨부파일은 원래 메일함에서 저장해 주세요.');
      let part=message.payload;
      for(const index of input.attachmentKey.split('.').slice(1))part=part?.parts?.[Number(index)];
      let encoded=part?.body?.data;
      if(part?.body?.attachmentId){
        if(!validGmailId(part.body.attachmentId,2048))throw new Error('첨부 식별자가 올바르지 않습니다.');
        const result=await this.fetchJson<{data?:string;size?:number}>(`${this.endpoint}/${encodeURIComponent(id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`,token);
        if(result.size!==attachment.size)throw new Error('첨부파일 크기가 메일 정보와 일치하지 않습니다.');
        encoded=result.data;
      }
      if(typeof encoded!=='string'||encoded.length>26_666_672||! /^[A-Za-z0-9_-]*={0,2}$/.test(encoded))throw new Error('첨부파일을 읽을 수 없습니다.');
      const bytes=decodeGmailBase64(encoded);
      if(bytes.length!==attachment.size||bytes.length>20_000_000)throw new Error('첨부파일 크기를 확인하지 못했습니다.');
      return {status:'mail_attachment_loaded',name:attachment.name,bytes};
    } catch(error){return {status:'mail_attachment_failed',userMessage:redactGmailToken(error instanceof Error?error.message:String(error),[token])};}
  }

  private async fetchJson<T>(url: string, accessToken: string): Promise<T> {
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    });
    const json = await response.json().catch(() => ({})) as { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(redactGmailToken(json.error?.message ?? response.statusText, [accessToken]));
    }
    return json as T;
  }
}

function validGmailId(value:unknown,max=220):value is string {return typeof value==='string'&&value.length<=max&&/^[A-Za-z0-9_-]+$/.test(value);}
function decodeGmailBase64(value:string){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),character=>character.charCodeAt(0));}
function readGmailParts(payload:GmailMessageResponse['payload']) {
  const plain:string[]=[],html:string[]=[],attachments:Array<{key:string;name:string;size:number;mimeType:string}>=[];
  let visited=0,limited=false;
  const visit=(part:GmailMessageResponse['payload'],key='part',depth=0)=>{
    if(!part)return;
    if(depth>12||++visited>200){limited=true;return;}
    if(part.filename){attachments.push({key,name:String(part.filename).slice(0,300),size:Number(part.body?.size)||0,mimeType:part.mimeType||'application/octet-stream'});return;}
    if(part.body?.data&&part.body.data.length>2_000_000)limited=true;
    if(part.body?.data&&part.body.data.length<=2_000_000&&/^text\/(plain|html)$/i.test(part.mimeType||'')){
      const text=new TextDecoder().decode(decodeGmailBase64(part.body.data));
      if(part.mimeType?.toLowerCase()==='text/plain')plain.push(text);else html.push(text);
    }
    part.parts?.forEach((child,index)=>visit(child,`${key}.${index}`,depth+1));
  };
  visit(payload);
  return {body:(plain.length?plain.join('\n\n'):stripMailHtmlToText(html.join('\n\n'))).replace(/\r\n?/g,'\n').trim(),attachments,limited};
}

function needsCredentials(userMessage: string): ModyGmailMailLiveResult {
  return {
    status: "needs_credentials",
    providerId: "gmail",
    action: "list_mail_messages",
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    mailboxId: "INBOX",
    userMessage,
    auditMessages: [
      "Gmail mail live connector needs OAuth access token",
      "access token 원문은 앱 결과에 반환하지 않습니다.",
    ],
  };
}

function apiFailure(userMessage: string, errorMessage: string, mailboxId: string): ModyGmailMailLiveResult {
  return {
    status: "gmail_api_failed",
    providerId: "gmail",
    action: "list_mail_messages",
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    mailboxId,
    userMessage,
    errorMessage,
    auditMessages: [
      "Gmail API live call failed before any mutation",
      "오류 메시지는 OAuth token-like 문자열을 마스킹한 뒤 반환합니다.",
    ],
  };
}

function toMessagePreview(
  message: GmailMessageResponse,
  fallbackThreadId: string | undefined,
  mailboxId: string,
  fallbackReceivedAt: string,
): ModyProviderMailMessagePreview {
  const headers = new Map(
    (message.payload?.headers ?? []).map((header) => [
      String(header.name ?? "").toLowerCase(),
      String(header.value ?? ""),
    ]),
  );
  const receivedAt = dateFromInternalDate(message.internalDate) || sanitizeDate(headers.get("date")) || fallbackReceivedAt;
  const threadId = sanitizeId(message.threadId ?? fallbackThreadId);
  const rfcMessageId = extractRfcMessageId(headers.get("message-id") ?? "");
  const inReplyTo = extractRfcMessageId(headers.get("in-reply-to") ?? "");
  const preview: ModyProviderMailMessagePreview = {
    messageId: `gmail-${sanitizeId(message.id) || "message"}`,
    mailboxId,
    providerId: "gmail",
    subject: sanitizeText(headers.get("subject") || "(제목 없음)"),
    from: sanitizeText(headers.get("from") || "Gmail sender"),
    receivedAt,
    snippet: sanitizeText(message.snippet || headers.get("subject") || ""),
    ...(threadId ? { threadId } : {}),
    ...(rfcMessageId ? { rfcMessageId } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
    labels: (message.labelIds ?? []).map(sanitizeText).filter(Boolean).slice(0, 12),
    ...(Array.isArray(message.labelIds) ? { isRead: !message.labelIds.includes("UNREAD") } : {}),
    hasAttachments: false,
    sourceMetadata: {
      connectorName: "Gmail API",
      sourceUri: `gmail:message:${sanitizeId(message.id) || "unknown"}`,
    },
  };
  // 보이는 from·subject 는 가려 두고, 답장 받을 주소와 실제 제목 원문은 열거되지 않는 속성으로만 나른다.
  attachHiddenOriginalSubject(preview, headers.get("subject"));
  return attachHiddenReplyToAddress(preview, headers.get("reply-to"), headers.get("from"));
}

function sanitizeAccessToken(value: unknown): string {
  const token = typeof value === "string" ? value.trim() : "";
  return token.length >= 20 && token.length <= 4096 ? token : "";
}

function sanitizeMailboxId(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_ -]{1,80}$/.test(text) ? text : "INBOX";
}

function sanitizeQuery(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.replace(/[\r\n]/g, " ").slice(0, 180);
}

function sanitizeId(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9._~+/=-]{1,220}$/.test(text) ? text : "";
}

function sanitizeDate(value: unknown): string {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function dateFromInternalDate(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const date = new Date(number);
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

export function redactGmailToken(value: string, secrets: string[] = []): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join("[gmail-token-redacted]");
  }
  return redacted
    .replace(/\bya29\.[A-Za-z0-9._-]+\b/g, "[gmail-token-redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [gmail-token-redacted]");
}
