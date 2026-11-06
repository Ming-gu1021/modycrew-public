export type ChatFileReference = { name: string; path: string };
const extension = /\.(pdf|docx?|xlsx?|pptx?|hwpx?|odt|ods|odp|rtf|txt|md|markdown|csv|tsv|json|log|png|jpe?g|gif|webp|bmp|html|css|js|ts|tsx|jsx|py)$/iu;
export const fileReferenceKey = (value: string) => /^[A-Za-z]:/u.test(value) ? value.replaceAll('\\', '/').toLowerCase() : value;

// 답변 속 위치는 후보일 뿐이다. 실제 존재 여부와 접근 권한은 메인 프로세스가 확인한다.
export function localFileReference(raw: string): ChatFileReference | null {
  let value = raw.trim().replace(/^<|>$/gu, '');
  if (/^file:\/\//iu.test(value)) {
    try { const url = new URL(value); if (url.host) return null; value = decodeURIComponent(url.pathname).replace(/^\/(\w:)/u, '$1'); } catch { return null; }
  }
  if (!/^(?:[A-Za-z]:[\\/]|\/(?!\/))/u.test(value) || /[\u0000-\u001f]/u.test(value) || !extension.test(value)) return null;
  if (value.split(/[\\/]/u).includes('..')) return null;
  return { path: value, name: value.split(/[\\/]/u).at(-1)! };
}

export function extractChatFileReferences(answer: string): ChatFileReference[] {
  const text = answer.slice(0, 100_000).replace(/```[\s\S]*?(?:```|$)/gu, '');
  const found = new Map<string, ChatFileReference>();
  const add = (raw: string) => {
    const item = localFileReference(raw);
    if (!item || found.size >= 12) return;
    found.set(fileReferenceKey(item.path), item);
  };
  for (const line of text.split(/\r?\n/u)) {
    for (const match of line.matchAll(/\[[^\]\r\n]+\]\((<[^>\r\n]+>|(?:[^()\r\n]|\([^()\r\n]*\))+)\)/gu)) add(match[1]);
    for (const match of line.matchAll(/`([^`\r\n]+)`/gu)) add(match[1]);
    const match = line.match(/^(?:\s*[-*]?\s*)(?:(?:저장(?:된)? (?:위치|경로)|파일(?: 위치| 경로)?|결과(?: 파일)?)\s*:\s*)?((?:[A-Za-z]:[\\/]|\/(?!\/))[^\r\n]+)$/u);
    if (match) add(match[1]);
  }
  return [...found.values()];
}

export function savedDeliverablePath(directory: string | undefined, name: string): string | null {
  if (!directory || /[\\/]/u.test(name)) return null;
  return localFileReference(directory.replace(/[\\/]+$/u, '') + '/' + name)?.path ?? null;
}

/** 모델이 파일 경로를 답변에서 빠뜨려도 문서 도구의 저장 완료 기록은 대화에 남긴다. */
export function appendCompletedDocumentFiles(answer: string, tools: ReadonlyArray<{ id: string; summary: string }>): string {
  const known = new Set(extractChatFileReferences(answer).map(file => fileReferenceKey(file.path)));
  const paths: string[] = [];
  for (const tool of tools) {
    if (tool.id !== 'document.create' || !/^completed\s*·/u.test(tool.summary)) continue;
    const explicit = tool.summary.match(/^파일 위치: (.+?)(?: \(결과 폴더 복사 실패:.*)?$/mu)?.[1];
    const folder = tool.summary.match(/^결과 폴더: (.+)$/mu)?.[1]?.trim();
    const name = tool.summary.match(/^만든 파일: (.+)$/mu)?.[1]?.trim();
    const candidate = explicit ? localFileReference(explicit)?.path : name ? savedDeliverablePath(folder, name) : null;
    if (!candidate || known.has(fileReferenceKey(candidate))) continue;
    known.add(fileReferenceKey(candidate)); paths.push(candidate);
  }
  return paths.length ? answer + '\n\n' + paths.map(value => '파일: ' + value).join('\n') : answer;
}
