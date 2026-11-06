export const COMPANY_PRIVACY_NOTICE = 'AI 전달용 문맥에서 인증정보와 이메일·전화번호·주민등록번호의 일부 패턴을 가립니다. 모든 개인정보나 영업비밀을 탐지하는 기능은 아닙니다. 원본 자료는 변경하지 않습니다.';

const secretField = /^(?:password|passwd|pwd|api[_ -]?key|secret|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|session[_ -]?id|cookie|authorization|database[_ -]?url|connection[_ -]?string|비밀번호|접속암호|인증키)$/iu;

/** Only derived AI context is redacted. Local originals and their hashes stay intact. */
export function redactCompanyText(value) {
  let text = String(value ?? '');
  let redactionCount = 0;
  const categories = new Set();
  const replace = (pattern, category, replacement) => {
    text = text.replace(pattern, (...args) => {
      const redacted = typeof replacement === 'function' ? replacement(...args) : replacement;
      if (redacted === args[0]) return redacted;
      redactionCount += 1; categories.add(category);
      return redacted;
    });
  };
  replace(/-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/giu, 'credential', '[비밀 키 가림]');
  replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/giu, 'credential', '[인증값 가림]');
  replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, 'credential', '[JWT 가림]');
  replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{20,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{12,})\b/gu, 'credential', '[인증 키 가림]');
  replace(/((?:password|passwd|pwd|api[_ -]?key|secret|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|session[_ -]?id|cookie|authorization|database[_ -]?url|connection[_ -]?string|비밀번호|접속암호|인증키)\s*["']?\s*[:=]\s*)(\[(?:비밀값|비밀 키|인증값|JWT|인증 키|자격정보|이메일|전화번호|주민등록번호) 가림\]|"[^"\r\n]+"|'[^'\r\n]+'|[^\s,;\]}]+)/giu, 'credential', (match, key, value) => value.startsWith('[') && value.endsWith(' 가림]') ? match : `${key}[비밀값 가림]`);
  replace(/(\b(?:https?|postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps|smtp):\/\/)[^@\s/:]+:[^@\s/]+@/giu, 'credential', (_match, scheme) => `${scheme}[자격정보 가림]@`);
  replace(/(?<!\d)\d{6}[-\s]?[1-8]\d{6}(?!\d)/gu, 'resident_id', '[주민등록번호 가림]');
  // Token boundary and bounded local/domain parts avoid quadratic scans on long IDs.
  replace(/(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,63}(?![a-z0-9.-])/giu, 'email', '[이메일 가림]');
  replace(/(?<!\d)(?:\+82[\s-]?(?:0)?1[016789]|0(?:1[016789]|2|[3-6]\d|70))[\s-]?\d{3,4}[\s-]?\d{4}(?!\d)/gu, 'phone', '[전화번호 가림]');
  return { text, redactionCount, categories: [...categories].sort() };
}

/** Apply the same boundary to nested rows, tool results and metadata, not only prose. */
export function redactCompanyValue(value) {
  if (typeof value === 'string') return redactCompanyText(value).text;
  if (Array.isArray(value)) return value.map(redactCompanyValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactCompanyText(key).text, secretField.test(key) ? '[비밀값 가림]' : redactCompanyValue(item)]));
  return value;
}

/** Company/document generation only: preserve the local input and redact its AI copy. */
export function redactCompanyAIRequest(input) {
  return redactCompanyValue(input);
}
