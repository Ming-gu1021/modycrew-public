type Message = { role: string; text: string };
export type DesktopTidyIntent = "offer" | "prepare" | "apply" | "cancel";
const topic = (text: string) => /바탕\s*화면/.test(text) && /정리|정돈|치워/.test(text);
const forbidden = /하지\s*마|하지말|안\s*해|안\s*하|필요\s*없|취소|그만|중지|말고|코드|프로그램|앱을?\s*만들|방법만|방법\s*(알려|설명)|예시|설명만/;
const proceed = /^(?:(?:그럼|그러면|이제|응|네|좋아|자|알아서|계속|문제없게|한번|다시)\s*[,!.]?\s*)*(?:(?:정리|진행|시작|해)\s*(?:해\s*)?(?:줘|봐|주세요|보자|하자|보세요|해|부탁해)|진행|시작)[.!~\s]*$/;
const approve = /^(?:(?:그럼|네|응|좋아|이제)\s*[,!.]?\s*)*(?:승인(?:해|할게|하고\s*정리해|하고\s*진행해)?|(?:이대로|목록대로)\s*(?:정리|진행)해(?:줘|봐)?)[.!~\s]*$/;
const cancel = /^(?:(?:그럼|이제|정리|바탕\s*화면\s*정리)\s*)*(?:취소|그만|중지)(?:해|해줘)?[.!~\s]*$/;

/** Only actual user turns establish a desktop task. Assistant text, attached
 * document instructions and a stale task before an unrelated turn cannot do so. */
export function resolveDesktopTidyIntent(text: string, history: Message[] = []): DesktopTidyIntent | null {
  const request = text.trim();
  const users = history.filter(message => message.role === "user").map(message => message.text.trim());
  // The chat caller includes the current user message; tests may pass prior turns.
  if (users.at(-1) === request) users.pop();
  let continuation = false;
  for (const prior of users.slice(-8).reverse()) {
    if (forbidden.test(prior)) break;
    if (topic(prior)) { continuation = true; break; }
    if (!proceed.test(prior) && !approve.test(prior)) break;
  }
  if (cancel.test(request) && (topic(request) || continuation)) return "cancel";
  if (forbidden.test(request)) return null;
  if (topic(request)) return "offer";
  if (!continuation) return null;
  if (approve.test(request)) return "apply";
  if (proceed.test(request)) return "prepare";
  return null;
}
