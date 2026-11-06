import type { AgentToolEntry } from "./agent-tools";
export type GeneratedFile = { name: string; content: string };
export type DeliverableScope = { workspaceRoot: string; threadId: string; messageId: string };
export type DeliverableReceipt = { status: string; userMessage?: string; directory?: string; location?: string; files?: Array<{ name: string; bytes: number; sha256: string }> };

// Preserve the explanation around artifacts without repeating their source in chat.
// This is presentation only: the original answer and saved bytes remain untouched.
export function deliverableDescription(answer: string): string {
  return answer.replace(/```[^\r\n]*\r?\n[\s\S]*?(?:\r?\n```|$)/gu, "")
    .replace(/(?:<!doctype\s+html[^>]*>\s*)?<html\b[^>]*>[\s\S]*?<\/html>/giu, "")
    .replace(/\n{3,}/gu, "\n\n").trim();
}

export function stripProseEmphasis(text: string): string {
  // Never strip Python ** / __name__ or Markdown headings inside generated files.
  return String(text ?? "").split(/(```[\s\S]*?(?:```|$)|(?:<!doctype\s+html[^>]*>\s*)?<html\b[^>]*>[\s\S]*?<\/html>)/giu).map((part, index) => index % 2 ? part : part
    .replace(/\*\*\*([^*\n]+)\*\*\*/gu, "$1")
    .replace(/\*\*([^*\n]+)\*\*/gu, "$1")
    .replace(/__([^_\n]+)__/gu, "$1")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/\*\*/gu, "")).join("");
}

const extensions: Record<string, string> = { html: "html", htm: "html", css: "css", javascript: "js", js: "js", typescript: "ts", ts: "ts", tsx: "tsx", jsx: "jsx", python: "py", py: "py", json: "json", markdown: "md", md: "md", text: "txt", txt: "txt" };
const defaults: Record<string, string> = { html: "index.html", css: "style.css", js: "script.js", py: "main.py", ts: "main.ts", tsx: "App.tsx", jsx: "App.jsx", json: "data.json", md: "README.md", txt: "result.txt" };

type DeliveryMessage = { role: string; text: string; generatedFiles?: GeneratedFile[] };
const deliveryDeclined = (text: string) => /저장(?:은|을)?\s*하지|파일로\s*(?:주지|만들지)|다운로드\s*하지|설명만|(?:^|\s)(?:취소|그만)(?:해(?:줘)?)?[.!?\s]*$/iu.test(text);
// Follow-ups inherit only the current task, never an older unrelated conversation.
const deliveryFollowup = (text: string) => !deliveryDeclined(text) && text.length < 200 && /다시\s*(?:줘|주세요|주라)|(?:여기|여기서|채팅에서|바로).*(?:확인|열어|실행|받|보이|볼 수|보여).*(?:줘|주세요|주라|주면|줘야|하게|있게)|(?:파일|첨부|결과물).*(?:안\s*보|없|나오지|안\s*나와)/iu.test(text);
const deliveryAcknowledgement = (text: string) => /^(?:(?:자|응|네|좋아|그래|맞아)[,.!\s]*)*(?:(?:이제|한번|한 번|다시)\s*)?(?:확인해\s*보자|확인해볼게|확인할게|해보자|알겠어|진행해(?:줘)?)?[.!\s]*$/u.test(text.trim());
                                                                                      
const revisionFollowup = (text: string) => !deliveryDeclined(text) && text.length < 300 &&
  /맞아야|맞게|되게|되도록|안\s*돼|안\s*되|작동|동작|버그|오류|에러|이상해|이상하|느려|빨라|빠르게|느리게|크게|작게|키워|줄여|늘려|드래그|클릭|터치|점수|난이도|레벨|색깔|색상|글자|글씨|위치|배치|속도|소리|효과|추가|넣어|빼\s*(?:줘|주|고)|없애|바꿔|바꾸|고쳐|고치|수정|개선|다듬|업그레이드/u.test(text);

/** 최근 메시지 몇 개 안에 앱이 저장한 결과 파일(또는 완성 코드 블록)이 있는가. */
function hasRecentGeneratedFile(messages: readonly DeliveryMessage[], window = 8): boolean {
  for (let i = messages.length - 1; i >= Math.max(0, messages.length - window); i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    if (sanitizeGeneratedFiles(message.generatedFiles)?.length || extractGeneratedFiles("파일로 제공", message.text).length) return true;
  }
  return false;
}
                                                                 
const shortNudge = (text: string) => /^(?:[?？!.~s]+|(?:응|어|음|왜|그래서|그럼|뭐야|해줘|해봐|빨리|다시|계속|아직)s*(?:안s*(?:해|돼|됨))?[?？!.~s]*)$/u.test(text.trim());
function previousUserRequest(messages: readonly DeliveryMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user" && messages[i].text.trim()) return messages[i].text.trim();
  return "";
}

export function resolveDeliverableRequest(request: string, messages: readonly DeliveryMessage[] = []): string {
  // 방금 만든 결과물을 고쳐 달라는 후속 요청은 그 결과물을 고쳐 새 버전으로 저장하는 일이다. 표시를 붙여 코드 블록이 파일로 저장되게 한다.
  if (!isDeliverableRequest(request) && revisionFollowup(request) && hasRecentGeneratedFile(messages)) return `${request}\n(앞서 만든 결과 파일을 고쳐 새 버전으로 저장해)`;
  // '??'처럼 재촉만 했으면 바로 앞의 고쳐 달라는 요청을 이어받는다(앱이 다시 열려 답이 끊긴 뒤의 실사용 화면).
  if (shortNudge(request) && hasRecentGeneratedFile(messages)) {
    const previous = previousUserRequest(messages);
    if (previous && !isDeliverableRequest(previous) && revisionFollowup(previous)) return `${previous}\n${request}\n(앞서 만든 결과 파일을 고쳐 새 버전으로 저장해)`;
  }
  if (deliveryDeclined(request) || isDeliverableRequest(request) || !(deliveryFollowup(request) || deliveryAcknowledgement(request))) return request;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    if (deliveryDeclined(message.text)) break;
    if (deliveryFollowup(message.text) || deliveryAcknowledgement(message.text)) continue;
    return isDeliverableRequest(message.text) ? `${message.text}\n${request}` : request;
  }
  return request;
}

export function isFileDeliveryRequest(request: string): boolean {
  if (deliveryDeclined(request)) return false;
  return /파일(?:로|을|\s*형태로|\s*자체|\s*(?:줘|주세요|주라|달라|보여|받|열))|첨부(?:로|해|해서)|다운로드|저장해|저장해줘|\b(download|attach|save as|give.{0,16}file)\b/iu.test(request);
}
export function isDeliverableRequest(request: string): boolean {
  if (deliveryDeclined(request)) return false;
  return isFileDeliveryRequest(request) || /만들|제작|개발|구현|생성|저장|코딩|수정|고쳐|바꿔|변경|개선|\b(build|create|implement|update|fix)\b/iu.test(request);
}

// Complete blocks become saved artifacts only for creation/delivery requests.
export function extractGeneratedFiles(request: string, answer: string): GeneratedFile[] {
  if (!isDeliverableRequest(request)) return [];
  const files: GeneratedFile[] = [];
  for (const match of answer.matchAll(/```([^\r\n]*)\r?\n([\s\S]*?)\r?\n```/gu)) {
    const header = match[1].trim().split(/\s+/u);
    const fileHeader = header[0].match(/^([A-Za-z0-9_-][A-Za-z0-9_.-]{0,79})\.([a-z]+)$/u);
    const extension = extensions[header[0].toLowerCase()] || (fileHeader && extensions[fileHeader[2]]);
    if (!extension || !match[2].trim()) continue;
    // 폴더·파일 위치만 적은 블록(예: D:\ModyCrew 결과\디자인\…)은 결과물이 아니라 위치 안내다. 파일로 저장하지 않고 답변에 남긴다.
                                                                        
    const blockLines = match[2].split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    if (!fileHeader && extension === "txt" && blockLines.length <= 3 && blockLines.every((line) => /^(?:[A-Za-z]:[\\/]|\\\\|~?\/)/u.test(line))) continue;
    const explicitName = fileHeader ? header[0] : header[1]?.replace(/^filename=/u, "").replace(/^["']|["']$/gu, "");
    // A basename is the current result-store contract. Never pretend a relative
    // project tree has been created by silently replacing its paths with defaults.
    if (explicitName && /[\\/]/u.test(explicitName)) continue;
    let name = explicitName && /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,79}$/u.test(explicitName) && explicitName.endsWith(`.${extension}`) ? explicitName : defaults[extension];
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])\./iu.test(name)) continue;
    let suffix = 2;
    const base = name.slice(0, -(extension.length + 1));
    while (files.some(file => file.name.toLowerCase() === name.toLowerCase())) name = `${base}-${suffix++}.${extension}`;
    files.push({ name, content: match[2] });
  }
  if (!files.length && !answer.includes("```")) {
    const html = answer.match(/(?:<!doctype\s+html[^>]*>\s*)?<html\b[^>]*>[\s\S]*?<\/html>/iu)?.[0];
    if (html) files.push({ name: "index.html", content: html });
  }
  return files.length <= 20 && files.reduce((size, file) => size + file.content.length, 0) <= 1_000_000 ? files : [];
}

export function sanitizeGeneratedFiles(value: unknown): GeneratedFile[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 20) return undefined;
  const names = new Set<string>(); let size = 0;
  for (const file of value) {
    if (!file || typeof file.name !== "string" || typeof file.content !== "string" || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,79}\.(?:html|css|js|ts|tsx|jsx|py|json|md|txt)$/u.test(file.name)) return undefined;
    if (names.has(file.name.toLowerCase())) return undefined;
    names.add(file.name.toLowerCase()); size += file.content.length;
    if (size > 1_000_000) return undefined;
  }
  return value.map(file => ({ name: file.name, content: file.content }));
}

export function sanitizeDeliverableReceipt(value: unknown): DeliverableReceipt | undefined {
  if (!value || typeof value !== "object") return undefined;
  const receipt = value as DeliverableReceipt;
  if (!["saved", "failed", "unavailable", "opened"].includes(receipt.status)) return undefined;
  return { status: receipt.status,
    userMessage: typeof receipt.userMessage === "string" ? receipt.userMessage : undefined,
    directory: typeof receipt.directory === "string" ? receipt.directory : undefined,
    location: typeof receipt.location === "string" ? receipt.location : undefined,
    files: Array.isArray(receipt.files) ? receipt.files.filter(file => file && typeof file.name === "string" && Number.isFinite(file.bytes) && typeof file.sha256 === "string").map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })) : undefined };
}

export function findRequestedExistingFiles(request: string, messages: readonly DeliveryMessage[]): GeneratedFile[] {
  if (!(isFileDeliveryRequest(request) || deliveryFollowup(request)) || /수정|바꿔|고쳐|변경|추가해|개선|새로|\b(fix|change|update)\b/iu.test(request)) return [];
  const requestedExtension = request.match(/\.(html|css|js|ts|tsx|jsx|py|json|md|txt|pdf|docx|hwpx|xlsx|pptx)\b/iu)?.[1]?.toLowerCase();
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user") {
      if (deliveryDeclined(message.text) || /수정|바꿔|고쳐|변경|새로|추가해|개선/iu.test(message.text) || !(isFileDeliveryRequest(message.text) || deliveryFollowup(message.text) || deliveryAcknowledgement(message.text))) break;
      continue;
    }
    if (message.role !== "assistant") continue;
    const files = sanitizeGeneratedFiles(message.generatedFiles) || extractGeneratedFiles("파일로 제공", message.text);
    if (files.length) return requestedExtension && !files.some(file => file.name.endsWith(`.${requestedExtension}`)) ? [] : files;
  }
  return [];
}

export function deliverableGenerationInstruction(request: string, messages: readonly DeliveryMessage[] = []): string {
  request = resolveDeliverableRequest(request, messages);
  if (!isDeliverableRequest(request) || !(isFileDeliveryRequest(request) || /게임|웹|앱|프로그램|스크립트|코드|html|개발|문서|보고서|마크다운/iu.test(request))) return "";
  return "\n\n[앱의 결과 파일 제공 방식]\n생성이 필요한 코드는 언어와 파일명을 표시한 코드 블록(예: ```html index.html)으로 완전하게 작성하세요. 간단한 브라우저 게임·페이지는 외부 라이브러리 없이 CSS와 JS를 포함한 단일 HTML로 만드세요. 모디크루가 완성된 코드 블록을 파일로 저장하고 HTML 실행 버튼을 제공합니다. 파일로 달라는 후속 요청도 이 방식으로 제공하세요. 메모장에 복사하라는 안내나 파일을 제공할 수 없다는 일반적인 답변은 하지 마세요. 실제 저장·실행·테스트는 앱의 확인 결과가 나오기 전에 완료했다고 말하지 마세요. 복잡한 프로젝트는 필요한 파일·의존성·남은 실행 조건을 명시하세요.";
}

const promptFenceLanguage = (name: string) => ({ js: "javascript", ts: "typescript", py: "python", md: "markdown", txt: "text" } as Record<string, string>)[name.split(".").pop() ?? ""] ?? name.split(".").pop() ?? "text";

   
                                                                   
                                                                
                         
                                                                       
                                                                  
                                                                  
   
export function buildConversationFilesPromptContext(request: string, messages: readonly DeliveryMessage[], maxContentChars = 60_000): string {
  const latest = new Map<string, { file: GeneratedFile; index: number }>();
  messages.forEach((message, index) => {
    if (message.role !== "assistant") return;
    for (const file of sanitizeGeneratedFiles(message.generatedFiles) ?? []) latest.set(file.name.toLowerCase(), { file, index });
  });
  if (!latest.size) return "";
  const entries = [...latest.values()].sort((a, b) => b.index - a.index).slice(0, 6);
  const lowered = request.toLowerCase();
  const named = entries.find(({ file }) => {
    const name = file.name.toLowerCase();
    const stem = name.replace(/\.[a-z0-9]+$/u, "");
    return lowered.includes(name) || (stem.length >= 3 && lowered.includes(stem));
  });
  const focus = named ?? entries[0];
  const recent = messages.length - focus.index <= 12;
  const asksForFileWork = (text: string) => revisionFollowup(text) || /파일|코드|게임|페이지|html|스크립트|실행/iu.test(text);
  const includeContent = !deliveryDeclined(request) &&
    (Boolean(named) || (recent && (asksForFileWork(request) || (shortNudge(request) && asksForFileWork(previousUserRequest(messages))))));
  const lines = [
    "[이 대화에서 앱이 저장한 결과 파일]",
    ...entries.map((entry, order) => `- ${entry.file.name} (${entry.file.content.length.toLocaleString("ko-KR")}자)${order === 0 ? " · 가장 최근" : ""}`),
    "이 파일들은 이미 이 대화의 결과 폴더에 저장돼 있습니다. 사용자가 이어서 고치거나 바꿔 달라고 하면 파일을 다시 첨부해 달라고 하지 마세요.",
  ];
  if (!includeContent) return lines.join("\n");
  const language = promptFenceLanguage(focus.file.name);
  if (focus.file.content.length > maxContentChars) {
    lines.push(
      `아래는 ${focus.file.name}의 앞부분입니다(파일이 길어 앞부분 ${maxContentChars.toLocaleString("ko-KR")}자만 전달). 전체를 본 것이 아니므로 같은 파일명의 전체 수정본을 새로 쓰지 말고, 고칠 부분과 바꿀 코드를 위치와 함께 제시하세요. 파일 전체를 고쳤다고 말하지 마세요.`,
      `[파일 앞부분: ${focus.file.name}]`,
      "````" + language,
      focus.file.content.slice(0, maxContentChars),
      "````",
    );
  } else {
    lines.push(
      `아래 최신 내용을 바탕으로 고친 전체 파일을 같은 파일명(${focus.file.name})의 코드 블록으로 다시 작성하면 앱이 새 버전으로 저장하고 실행 버튼을 보여 줍니다. 무엇을 고쳤는지는 코드 블록 밖에 짧게 적으세요.`,
      `[최신 파일 내용: ${focus.file.name}]`,
      "````" + language + " " + focus.file.name,
      focus.file.content,
      "````",
    );
  }
  return lines.join("\n");
}
export function requestDeliverables(scope: DeliverableScope, files: GeneratedFile[], kind: "save" | "open_folder" | "preview", name?: string): Promise<DeliverableReceipt> {
  const desktop = (window as unknown as { modyCrewDesktopBridge?: { projectDeliverables?: (payload: unknown) => Promise<DeliverableReceipt> } }).modyCrewDesktopBridge;
  if (!desktop?.projectDeliverables) return Promise.resolve({ status: "unavailable", userMessage: "파일 저장·실행은 업데이트된 데스크톱 앱에서 사용할 수 있습니다." });
  return desktop.projectDeliverables({ ...scope, files, kind, name });
}

/** In-app artifacts use the selected account for generation and the project's
 * existing result store for writes. No second agent/process/account selection. */
export function isNativeFileRequest(request: string, messages: readonly DeliveryMessage[] = []): boolean {
  const resolved = resolveDeliverableRequest(request, messages);
  return isDeliverableRequest(resolved) && /파일|게임|웹\s*페이지|html|코드|코딩|스크립트|마크다운|텍스트|csv|json/iu.test(resolved)
    && !/영상|동영상|음악|음성|이미지|사진|(?:pdf|docx|xlsx|pptx|hwp)\b/iu.test(resolved);
}

export function createChatFileTool(options: {
  scope: DeliverableScope;
  current: () => boolean;
  prepare: () => Promise<unknown>;
  onSaving: () => void;
  onSaved: (files: GeneratedFile[], receipt: DeliverableReceipt) => void;
}): AgentToolEntry {
  return {
    id: "project.files.save", korLabel: "프로젝트에 파일 저장",
    korDescription: "완성한 HTML·코드·텍스트 파일을 현재 대화의 프로젝트 결과 폴더에 실제 저장합니다. 파일을 달라는 요청에는 이 도구를 사용하세요. 별도 Codex·Claude 실행기를 열지 않습니다. 기존 파일을 덮어쓰지 않으며 저장 확인 후 채팅에 파일·위치·HTML 실행 버튼이 표시됩니다.",
    argsHint: '{"files":[{"name":"index.html","content":"완전한 파일 내용"}]}', permission: "auto",
    execute: async (_bridge, args) => {
      const files = sanitizeGeneratedFiles(args.files);
      if (!files?.length) return "저장 실패: 파일 이름과 완전한 내용을 files 배열로 지정하세요. 지원 형식은 html/css/js/ts/tsx/jsx/py/json/md/txt입니다. 경로·미지원 형식을 파일로 저장했다고 말하지 마세요.";
      if (!options.current()) return "요청이 중지되어 파일을 저장하지 않았습니다.";
      let receipt: DeliverableReceipt;
      try {
        await options.prepare();
        if (!options.current()) return "요청이 중지되어 파일을 저장하지 않았습니다.";
        options.onSaving();
        receipt = await requestDeliverables(options.scope, files, "save");
      } catch (error) {
        receipt = { status: "failed", userMessage: error instanceof Error ? error.message : "파일 저장 연결을 확인해 주세요." };
      }
      if (options.current()) options.onSaved(files, receipt);
      return receipt.status === "saved"
        ? `파일 ${files.length}개 저장 확인: ${files.map(file => file.name).join(", ")}. 위치: ${receipt.directory}. 채팅에 결과 카드가 표시됩니다. 최종 답변에는 짧은 결과 요약과 실행 방법만 쓰세요. 아직 실행하거나 테스트한 것은 아닙니다.`
        : `파일 저장 실패: ${receipt.userMessage || receipt.status}. 파일 내용을 보존했으며 다시 저장할 수 있습니다. 완료했다고 말하지 마세요.`;
    },
  };
}
