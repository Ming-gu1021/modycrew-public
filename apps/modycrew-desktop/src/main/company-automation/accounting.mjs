import { clean, digest } from './company-records.mjs';

const aliases = { date: ['거래일', '거래일자', '일자', '날짜', 'date'], description: ['적요', '내용', '거래내용', 'description'], counterparty: ['거래처', '상대방', '상호', 'counterparty'], account: ['계정과목', '계정', 'account'], income: ['입금', '입금액', '수입', '수입금액', 'income'], expense: ['출금', '출금액', '지출', '지출금액', 'expense'] };
export function suggestMapping(table) {
  const headers = table?.rows?.[0] || [];
  return Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, headers.findIndex((s) => names.includes(clean(s).replace(/\s/gu, '').toLowerCase()))]));
}
export function money(value, currency = 'KRW') {
  const scale = { KRW: 0, USD: 2, EUR: 2, VND: 0, JPY: 0 }[currency];
  if (scale === undefined) throw new Error('지원하는 통화를 선택해 주세요.');
  let s = clean(String(value ?? ''), 80).replace(/^[₩$€¥]\s*/u, '').replace(/\s*(원|KRW|USD|EUR|VND|JPY)$/iu, '');
  if (s === '' || s === '-') return 0n;
  if (/^\(.*\)$/u.test(s)) s = `-${s.slice(1, -1)}`;
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/u.test(s)) throw new Error('금액 형식 확인');
  s = s.replace(/,/gu, ''); const negative = s.startsWith('-'); s = s.replace(/^[+-]/u, '');
  const [whole, fraction = ''] = s.split('.');
  if (whole.length > 16 || fraction.slice(scale).replace(/0/gu, '')) throw new Error('금액 자릿수 확인');
  return (negative ? -1n : 1n) * (BigInt(whole) * (10n ** BigInt(scale)) + BigInt(fraction.slice(0, scale).padEnd(scale, '0') || '0'));
}
export function formatMoney(value, currency = 'KRW') {
  const scale = ['USD', 'EUR'].includes(currency) ? 2 : 0; const n = BigInt(value); const s = (n < 0n ? -n : n).toString().padStart(scale + 1, '0');
  return `${n < 0n ? '-' : ''}${scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s}`;
}
function dateValue(value) {
  const m = clean(value, 40).match(/^(\d{4})[-/.년]\s*(\d{1,2})[-/.월]\s*(\d{1,2})(?:일)?(?:\s.*)?$/u);
  if (!m) return '';
  const s = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const d = new Date(`${s}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : '';
}
export function reviewAccounting(record, tableIndex, mapping, currency = 'KRW', existing = []) {
  const table = record.tables?.[tableIndex]; if (!table) throw new Error('장부의 시트를 선택해 주세요.');
  if (!Number.isInteger(mapping.date) || mapping.date < 0 || (!Number.isInteger(mapping.income) || mapping.income < 0) && (!Number.isInteger(mapping.expense) || mapping.expense < 0)) throw new Error('거래일과 입금 또는 출금 열을 연결해 주세요.');
  const assigned = Object.values(mapping).filter((v) => Number.isInteger(v) && v >= 0);
  if (new Set(assigned).size !== assigned.length || assigned.some((v) => v >= table.rows[0].length)) throw new Error('각 항목을 서로 다른 실제 열에 연결해 주세요.');
  const fingerprints = new Set(existing.map((r) => r.fingerprint)); const rows = []; let income = 0n; let expense = 0n;
  for (let i = 1; i < table.rows.length; i += 1) {
    const raw = table.rows[i]; if (raw.every((c) => !clean(String(c)))) continue;
    const value = (key) => Number.isInteger(mapping[key]) && mapping[key] >= 0 ? String(raw[mapping[key]] ?? '') : '';
    const issues = []; const date = dateValue(value('date')); if (!date) issues.push('거래일 확인');
    const description = clean(value('description'), 500); const counterparty = clean(value('counterparty'), 180); const account = clean(value('account'), 100);
    let incoming = 0n; let outgoing = 0n;
    try { incoming = money(value('income'), currency); outgoing = money(value('expense'), currency); } catch (error) { issues.push(error.message); }
    if (!incoming && !outgoing) issues.push('금액 없음');
    if (incoming && outgoing) issues.push('입금·출금 동시 기재');
    if (incoming < 0n || outgoing < 0n) issues.push('취소·환불 금액 검토');
    if (!description && !counterparty) issues.push('거래 내용 없음');
    if (table.unresolvedFormulas?.some((address) => Number(address.match(/\d+$/u)?.[0]) === i + 1)) issues.push('계산되지 않은 수식');
    const fingerprint = digest(JSON.stringify([date, description, counterparty, account, currency, incoming.toString(), outgoing.toString()]));
    if (fingerprints.has(fingerprint)) issues.push('중복 거래 확인'); fingerprints.add(fingerprint);
    const id = digest(`${record.hash}:${table.name}:${i + 1}`);
    rows.push({ id, date, description, counterparty, account, currency, income: formatMoney(incoming, currency), expense: formatMoney(outgoing, currency), fingerprint, issues, source: { id: record.id, name: record.name, hash: record.hash, sheet: table.name, row: i + 1, original: raw } });
    if (!issues.length) { income += incoming; expense += outgoing; }
  }
  return { sourceId: record.id, sourceHash: record.hash, tableIndex, mapping, currency, rows, totals: { income: formatMoney(income, currency), expense: formatMoney(expense, currency), balance: formatMoney(income - expense, currency) }, validCount: rows.filter((r) => !r.issues.length).length, issueCount: rows.filter((r) => r.issues.length).length };
}
export function accountingDocument(rows, currency = 'KRW') {
  const selected = rows.filter((r) => r.currency === currency); let income = 0n; let expense = 0n;
  for (const row of selected) { income += money(row.income, currency); expense += money(row.expense, currency); }
  return { title: '회사 입출금 장부', templateId: 'general', company: '', author: '', period: '', sections: [{ heading: `검토한 입출금 내역 (${currency})`, paragraphs: [`입금 ${formatMoney(income, currency)} / 출금 ${formatMoney(expense, currency)} / 차액 ${formatMoney(income - expense, currency)}`], table: { columns: ['거래일', '적요', '거래처', '계정과목', '입금', '출금', '원본 근거'], rows: selected.map((r) => [r.date, r.description, r.counterparty, r.account, r.income, r.expense, `${r.source.name} / ${r.source.sheet} ${r.source.row}행`]) } }], sources: [...new Set(selected.map((r) => `${r.source.name} SHA256:${r.source.hash}`))], notes: ['선택한 원본의 입출금 장부입니다. 세무 신고·전표 확정·이체는 실행하지 않습니다.'] };
}
