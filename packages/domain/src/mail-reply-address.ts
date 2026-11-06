/**
 * 답장 받을 주소(Reply-To, 없으면 From)를 메일 미리보기 객체에 "숨겨서" 나른다.
 *
 * 메일 미리보기는 AI 프롬프트, 보고서, 로그, 화면 응답으로 여러 번 직렬화된다.
 * 그중 어느 곳에도 상대 주소 원문이 새지 않도록 열거되지 않는(non-enumerable)
 * 속성으로 붙인다 — JSON.stringify, 구조화 복제(IPC), 객체 펼치기(`{...message}`)
 * 모두 이 값을 버린다. 필요한 곳(승인 카드의 수신자 기본값)만 `message.replyToAddress`로
 * 직접 읽는다. 펼치기로 새 객체를 만드는 곳은 값을 잃으므로, 이어 가려면 다시 붙인다.
 */

const replyAddressPattern = /^[A-Z0-9._%+'-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}$/i;

/** `"이름" <addr@example.com>`, `addr@example.com`, `mailto:addr@...` → `addr@example.com`. 형식이 틀리면 빈 문자열. */
export function parseMailboxAddress(raw: unknown): string {
  const text = String(raw ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (!text) return "";
  const angle = text.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/);
  const candidate = (angle?.[1] ?? text.split(/[\s,;]+/).find((part) => part.includes("@")) ?? "")
    .replace(/^mailto:/i, "")
    .replace(/^["'(<]+|["')>.,;:]+$/g, "");
  if (!candidate || candidate.length > 254) return "";
  return replyAddressPattern.test(candidate) ? candidate : "";
}

/** 받은 메일의 실제 제목 원문. 제어문자만 지우고 가리지 않는다(최대 300자). 비어 있으면 빈 문자열. */
export function sanitizeOriginalMailSubjectText(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * 받은 메일의 실제 제목(`Re: 원제목`의 재료)을 열거되지 않는 `originalSubject` 속성으로 붙인다.
 *
 * 보이는 `subject`는 화면·AI 프롬프트·로그로 흘러가서 메일 주소·전화번호를 가린 사본일 수 있다.
 * 가린 제목으로 답장하면 거래처가 `Re: 견적 문의 ([redacted-phone])`를 받는다. 원제목에는
 * 개인정보가 들어 있을 수 있으니 답장 주소처럼 직렬화되지 않게 숨겨 나르고, 승인 카드에만 싣는다.
 * 후보를 순서대로 보고 비어 있지 않은 첫 값만 쓴다.
 */
export function attachHiddenOriginalSubject<T extends object>(target: T, ...candidates: unknown[]): T {
  if (!target || typeof target !== "object") return target;
  for (const candidate of candidates) {
    const subject = sanitizeOriginalMailSubjectText(candidate);
    if (!subject) continue;
    Object.defineProperty(target, "originalSubject", {
      value: subject,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    break;
  }
  return target;
}

/** 형식이 맞는 주소만 열거되지 않는 `replyToAddress` 속성으로 붙인다. */
export function attachHiddenReplyToAddress<T extends object>(target: T, ...candidates: unknown[]): T {
  if (!target || typeof target !== "object") return target;
  for (const candidate of candidates) {
    const address = parseMailboxAddress(candidate);
    if (!address) continue;
    Object.defineProperty(target, "replyToAddress", {
      value: address,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    break;
  }
  return target;
}
