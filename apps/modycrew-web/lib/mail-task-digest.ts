import type { MailLedgerRow } from './desktop-bridge';

const line = (value: string) => String(value || '')
  .replace(/&#(x[\da-f]+|\d+);/gi, (raw, code: string) => { const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1),16) : Number(code); return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : raw; })
  .replace(/&(amp|quot|apos|nbsp|lt|gt);/gi, (_, key: string) => ({amp:'&',quot:'"',apos:"'",nbsp:' ',lt:'<',gt:'>'}[key.toLowerCase()] || ' '))
  .replace(/[\p{Cf}\u034f]/gu, '').replace(/[\r\n\u0000-\u001f]/g, ' ').replace(/\s+/g,' ').trim();

/** Summarize only loaded, selected-account mail. Dates in mail text are never invented as deadlines. */
export function buildMailTaskDigest(messages: MailLedgerRow[], accountId: string, now = new Date()) {
  const unique = new Map<string, MailLedgerRow>();
  for (const row of messages) {
    if (row.accountId === accountId && !unique.has(row.messageId)) unique.set(row.messageId, row);
  }
  const rows = [...unique.values()];
  const excludedAds = rows.filter(row => /^\s*(?:\(광고\)|\[광고\]|광고\s*[:：])/u.test(row.subject));
  const excludedIds = new Set(excludedAds.map(row=>row.messageId));
  const candidates = rows.filter(row => !excludedIds.has(row.messageId) && (row.replyCandidate === true || row.scheduleCandidate === true || row.isRead === false));
  const date = now.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const shown = candidates.slice(0, 100);
  const tasks = shown.map((row, index) => {
    const actions = [row.replyCandidate === true && '답장 검토', row.scheduleCandidate === true && '일정 확인', row.isRead === false && '내용 확인'].filter(Boolean);
    const preview = line(row.preview).replace(/\\(?:Seen|Recent|Answered|Flagged|Deleted|Draft)\b/gi, '').trim();
    return `${index + 1}. [${actions.join(' · ')}] ${line(row.subject) || '(제목 없음)'}\n   받은 날짜: ${line(row.receivedAt) || '확인 필요'}\n   내용: ${preview && preview !== line(row.subject) ? preview.slice(0, 400) : '본문 미리보기 없음. 메일 원문에서 확인해 주세요.'}`;
  });
  return {
    subject: `[ModyCrew] ${date} 메일 할 일 요약`,
    sourceCount: rows.length,
    taskCount: candidates.length,
    excludedAdCount: excludedAds.length,
    body: [
      `${date} 메일에서 정리한 할 일`,
      `선택한 계정에서 앱에 불러온 ${rows.length}통 기준 · 확인할 메일 ${candidates.length}통`,
      '이 내용은 메일에서 찾은 업무 후보입니다. 처리 완료 여부와 정확한 기한은 원문에서 확인해 주세요.',
      ...(excludedAds.length ? [`제목에 광고로 표시된 ${excludedAds.length}통은 할 일 후보에서 제외했습니다. 원본 메일은 유지됩니다.`] : []),
      tasks.length ? tasks.join('\n\n') : '현재 불러온 메일에는 답장·일정·안 읽은 메일 후보가 없습니다.',
      ...(candidates.length > shown.length ? [`본문에는 첫 ${shown.length}건을 담았습니다. 나머지 ${candidates.length - shown.length}건은 메일함에서 확인해 주세요.`] : []),
      '출처: ModyCrew 통합 메일함. 서버 전체 메일함을 조회한 결과는 아닙니다.',
    ].join('\n\n'),
  };
}
