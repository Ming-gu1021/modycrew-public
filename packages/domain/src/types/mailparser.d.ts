// Minimal ambient typing for `mailparser` (no bundled types, @types/mailparser absent).
// We only rely on `simpleParser` and the few ParsedMail fields the IMAP body preview reads.
// Keeping this local avoids adding a dev dependency while satisfying the strict domain build.
declare module "mailparser" {
  /** 첨부 여부 판단에만 쓰는 최소 필드 — 첨부 내용(content)은 읽지 않습니다. */
  export interface ParsedMailAttachment {
    filename?: string;
    contentType?: string;
    size?: number;
  }

  export interface ParsedMail {
    text?: string;
    html?: string | false;
    textAsHtml?: string;
    subject?: string;
    attachments?: ParsedMailAttachment[];
  }

  export interface SimpleParserOptions {
    skipHtmlToText?: boolean;
    skipImageLinks?: boolean;
    skipTextToHtml?: boolean;
    skipTextLinks?: boolean;
    maxHtmlLengthToParse?: number;
  }

  export function simpleParser(
    source: Buffer | string | Uint8Array,
    options?: SimpleParserOptions,
  ): Promise<ParsedMail>;
}
