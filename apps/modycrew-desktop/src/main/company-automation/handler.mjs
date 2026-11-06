import path from 'node:path';
import { openConnectionSetupUrl } from '../approved-external-navigation.mjs';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { clean, digest, companyRoot, listCompanyRecords, importCompanyRecords, readCompanyRecord, companyContext } from './company-records.mjs';
import { suggestMapping, reviewAccounting, accountingDocument } from './accounting.mjs';
import { loadCompanyState, mutateCompany, planCompanyWork, defaultDepartments, encryptCompanySecret, readCompanySecret, companyDepartmentFingerprint } from './runtime.mjs';
import { verifyProvider, telegramCall, discoverProviderChannels } from './provider-adapters.mjs';
import { openSetupBrowser, proposeSetupStep, applySetupStep, captureSetupCredentials } from './setup-browser.mjs';
import { provisionCompanyRelay, checkCompanyRelay, removeCompanyRelay } from './relay-provision.mjs';
import { handleQuotationMessage } from './quotation-handler.mjs';
import { handleHandoverMessage } from './handover-handler.mjs';
import { previewOrganization, suggestOrganization, applyOrganizationSetup, runOrganizationSetupWork } from './setup-plan.mjs';

const catalog = JSON.parse(await readFile(new URL('./catalog.json', import.meta.url), 'utf8'));
const result = (status, userMessage, extra = {}) => ({ status, userMessage, externalMutation: false, ...extra });
const companyScopeId = (options) => digest(path.resolve(companyRoot(options)).toLowerCase());
function assertCompanyScope(payload, options) {
  if (payload.expectedScopeId !== undefined && (typeof payload.expectedScopeId !== 'string' || payload.expectedScopeId !== companyScopeId(options))) throw new Error('회사 저장소가 바뀌었습니다. 현재 회사 설정을 다시 확인한 뒤 저장해 주세요.');
}
function assertSender(event, options) {
  if (options.trustedSender) return;
  const frame = event?.senderFrame;
  if (!event?.sender || !frame || (event.sender.mainFrame && frame !== event.sender.mainFrame)) throw new Error('앱의 회사 운영 화면에서 실행해 주세요.');
  const url = new URL(frame.url || event.sender.getURL());
  if (!(url.protocol === 'modycrew:' && url.hostname === 'app') && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('허용되지 않은 회사 운영 요청입니다.');
}
async function publicState(options) {
  const scopedOptions = { ...options, companyRoot: companyRoot(options) };
  const state = await loadCompanyState(scopedOptions);
  return { ...state, scopeId: companyScopeId(scopedOptions), seen: undefined, ledger: state.ledger.slice(-100), ledgerCount: state.ledger.length, accountingReviews: undefined, works: state.works.slice(-100).reverse(), records: await listCompanyRecords(scopedOptions), catalog: catalog.providers, mailAccounts: await options.listMailAccounts?.() || [] };
}
function ruleText(value, label, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || value.includes('\u0000') || (required && !value.trim())) throw new Error(`${label}을 ${max.toLocaleString('ko-KR')}자 이내로 입력해 주세요.`);
  return value.trim();
}
function departmentDetails(value) {
  const details = {};
  if (value.reason !== undefined) details.reason = ruleText(value.reason, '담당자 추천 이유', 500);
  for (const [field, label] of [['responsibilities', '담당 업무'], ['deliverables', '예상 산출물']]) {
    if (value[field] === undefined) continue;
    if (!Array.isArray(value[field]) || value[field].length > 6) throw new Error(`${label}은 6개 이내로 입력해 주세요.`);
    details[field] = value[field].map((item) => ruleText(item, label, 160, true));
  }
  return details;
}
function ruleSchedule(value, repeat) {
  if (!['daily', 'weekly'].includes(repeat) || typeof value !== 'string') throw new Error('처음 실행할 일시와 반복 간격을 확인해 주세요.');
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.exec(value);
  const [, year, month, day, hour, minute, second = '0'] = parts || [];
  const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!parts || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days[Number(month) - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || !Number.isFinite(Date.parse(value))) throw new Error('처음 실행할 일시와 반복 간격을 확인해 주세요.');
  return new Date(value).toISOString();
}
function ruleDraft(payload) {
  const request = ruleText(payload.request, '반복할 업무', 5000, true);
  const name = ruleText(payload.name, '자동화 이름', 100) || request.slice(0, 60);
  if (!Array.isArray(payload.departmentIds) || !payload.departmentIds.length || payload.departmentIds.length > 20 || payload.departmentIds.some((id) => typeof id !== 'string' || !id)) throw new Error('담당 부서를 1개 이상 선택해 주세요.');
  const departmentIds = [...new Set(payload.departmentIds)];
  const trigger = payload.trigger;
  if (!['schedule', 'message'].includes(trigger)) throw new Error('업무 시작 조건을 선택해 주세요.');
  let setupId;
  if (payload.setupId !== undefined) {
    if (typeof payload.setupId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(payload.setupId)) throw new Error('자동화 설정 요청을 다시 시작해 주세요.');
    setupId = payload.setupId.toLowerCase();
  }
  let keywords = [];
  if (trigger === 'message') {
    if (payload.keywords !== undefined && (!Array.isArray(payload.keywords) || payload.keywords.length > 20)) throw new Error('업무 키워드는 20개 이내로 입력해 주세요.');
    keywords = [...new Set((payload.keywords || []).map((keyword) => ruleText(keyword, '업무 키워드', 50, true)))];
  }
  const draft = { name, request, departmentIds, trigger,
    connectionId: trigger === 'message' || payload.connectionId ? ruleText(payload.connectionId, '수신 계정', 200, true) : undefined,
    keywords, nextRunAt: trigger === 'schedule' ? ruleSchedule(payload.nextRunAt, payload.repeat) : undefined,
    repeat: trigger === 'schedule' ? payload.repeat : undefined };
  const setupFingerprint = setupId ? digest(JSON.stringify({ ...draft, departmentIds: [...departmentIds].sort(), keywords: [...new Set(keywords.map((keyword) => keyword.toLowerCase()))].sort() })) : undefined;
  return { draft, setupId, setupFingerprint };
}
export async function handleCompanyAutomationMessage(event, payload = {}, options = {}) {
  try {
    assertSender(event, options);
    assertCompanyScope(payload, options);
    if (typeof payload.kind === 'string' && payload.kind.startsWith('handover_')) return handleHandoverMessage(event, payload, options);
    if (typeof payload.kind === 'string' && payload.kind.startsWith('quotation_')) return handleQuotationMessage(event, payload, options);
    if (payload.kind === 'status') return result('ready', '회사 자료와 담당 부서를 연결하고 업무를 맡겨 주세요.', { state: await publicState(options) });
    if (payload.kind === 'import_records') {
      const imported = await mutateCompany(options, () => importCompanyRecords(options, { selection: payload.selection }));
      const limited = imported.importSummary.limitReached ? ' 폴더 탐색 또는 20개 한도에 도달해 일부만 가져왔습니다. 나머지는 더 작은 폴더로 선택해 주세요.' : '';
      return result(imported.cancelled ? 'cancelled' : 'imported', imported.cancelled ? '자료 선택을 취소했습니다.' : `${imported.records.length}개 회사 자료를 읽고 원본 사본을 보관했습니다.${limited}`, { records: imported.records, importedSourceIds: imported.importedSourceIds, importSummary: imported.importSummary, state: await publicState(options) });
    }
    if (payload.kind === 'read_record') { const record = await readCompanyRecord(payload.id, options); return result('record_loaded', '원본에서 읽은 내용을 확인해 주세요.', { record: { ...record, text: record.text.slice(0, 100000), tables: record.tables.map((t) => ({ ...t, rows: t.rows.slice(0, 6), rowCount: t.rows.length })) } }); }
    if (payload.kind === 'context') return result('context_ready', '선택한 회사 자료를 불러왔습니다.', await companyContext({ query: payload.query, sourceIds: payload.sourceIds }, options));
    if (payload.kind === 'save_company') {
      const requestedDepartments = payload.departments || defaultDepartments();
      if (!Array.isArray(requestedDepartments) || requestedDepartments.length > 20) throw new Error('담당 부서는 최대 20개까지 저장할 수 있습니다. 기존 담당자를 확인하고 20개 이내로 구성해 주세요.');
      const records = await listCompanyRecords(options); const valid = new Set(records.map((r) => r.id));
      const departments = requestedDepartments.map((d) => ({ id: clean(d.id, 80), name: clean(d.name, 40), role: clean(d.role, 500), keywords: (Array.isArray(d.keywords) ? d.keywords : []).map((k) => clean(k, 40)).filter(Boolean).slice(0, 20), sourceIds: [...new Set((d.sourceIds || []).filter((id) => valid.has(id)))], enabled: d.enabled === true, ...departmentDetails(d) }));
      if (!departments.length || departments.some((d) => !/^[a-z][a-z0-9-]{1,79}$/u.test(d.id) || !d.name || !d.role) || new Set(departments.map((d) => d.id)).size !== departments.length) throw new Error('부서 이름·역할·고유 ID를 확인해 주세요.');
      await mutateCompany(options, async (s) => {
        // Older editors submit only the core fields when pausing/resuming a department.
        for (const department of departments) {
          const previous = s.departments.find((item) => item.id === department.id);
          if (!previous) continue;
          for (const [field, value] of Object.entries(departmentDetails(previous))) if (department[field] === undefined) department[field] = value;
        }
        if (s.rules.some((rule) => rule.enabled && rule.departmentIds.some((id) => !departments.some((d) => d.id === id && d.enabled)))) throw new Error('자동화 규칙이 사용 중인 부서입니다. 해당 규칙을 먼저 일시 중지해 주세요.');
        if (options.syncOrganization) await options.syncOrganization(departments, s.masterId);
        s.companyName = clean(payload.companyName, 100); s.masterName = clean(payload.masterName, 60) || '마스터 에이전트'; s.departments = departments;
      });
      return result('saved', '회사와 부서 설정을 저장했습니다.', { state: await publicState(options) });
    }
    if (payload.kind === 'preview_organization') return result('preview_ready', 'AI에 전달할 자료 내용을 확인해 주세요. 아직 전송하지 않았습니다.', { preview: await previewOrganization(payload, options) });
    if (payload.kind === 'suggest_organization') return result('proposed', '추천 담당자와 업무 지침을 검토해 주세요. 아직 저장하거나 실행하지 않았습니다.', { proposal: await suggestOrganization(payload, options) });
    if (payload.kind === 'apply_organization_setup') {
      const setup = await applyOrganizationSetup(payload, options, ruleDraft);
      return result('saved', payload.enableRules === true ? '담당자와 선택한 자동화를 저장했습니다. 수동 업무는 직접 실행해 주세요.' : '담당자와 업무 환경을 저장했습니다. 업무를 실행하거나 반복 규칙을 시작할 수 있습니다.', { setup, state: await publicState(options) });
    }
    if (payload.kind === 'run_work') {
      const work = payload.setupId !== undefined || payload.setupWorkflowId !== undefined
        ? await runOrganizationSetupWork(payload, options)
        : await mutateCompany(options, (s) => planCompanyWork(s, { request: payload.request, departmentIds: payload.departmentIds }));
      void options.runtime?.tick().catch(() => {});
      return result('queued', '담당 부서에 업무를 저장했습니다. 마스터가 결과를 모아 검토합니다.', { work, state: await publicState(options) });
    }
    if (payload.kind === 'control_task') {
      const state = await loadCompanyState(options); const allowed = state.works.some((w) => w.masterTaskId === payload.taskId || w.tasks.some((t) => t.taskId === payload.taskId));
      if (!allowed || !['retry', 'pause', 'resume'].includes(payload.action)) throw new Error('이 회사 업무의 실행 상태를 다시 확인해 주세요.');
      const locallyControlled = await mutateCompany(options, (s) => {
        for (const work of s.works) {
          if (work.masterTaskId === payload.taskId && work.masterSubmissionFailed && payload.action === 'retry') { work.masterSubmissionFailed = false; work.masterError = ''; work.status = 'ready_to_merge'; work.masterStatus = 'queued'; return true; }
          const task = work.tasks.find((t) => t.taskId === payload.taskId && t.notSubmitted);
          if (!task) continue;
          if (payload.action === 'pause' && task.status === 'queued') { task.status = 'paused'; work.status = 'attention'; return true; }
          if ((payload.action === 'retry' && task.status === 'failed') || (payload.action === 'resume' && task.status === 'paused')) {
            const department = s.departments.find((d) => d.id === task.departmentId && d.enabled);
            if (!department) throw new Error('담당 부서를 먼저 활성화해 주세요.');
            if (!task.departmentFingerprint || task.departmentFingerprint !== companyDepartmentFingerprint(department)) throw new Error('담당자 지침 또는 참고 자료가 바뀌었습니다. 현재 설정으로 새 업무를 요청해 주세요.');
            task.status = 'queued'; task.error = ''; work.status = 'queued'; return true;
          }
        }
        return false;
      });
      if (locallyControlled) { void options.runtime?.tick().catch(() => {}); return result('saved', '업무 상태를 저장했습니다. 준비가 완료되면 같은 업무를 이어갑니다.', { state: await publicState(options) }); }
      const controlled = await options.controlTask?.({ taskId: payload.taskId, action: payload.action });
      // The task board changed the task; sync the company ledger now instead of on the next 15s tick.
      if (controlled && controlled.status !== 'error') void options.runtime?.tick().catch(() => {});
      return result(controlled?.status || 'error', controlled?.userMessage || '업무 실행기를 확인해 주세요.');
    }
    if (payload.kind === 'answer_task') {
      const s = await loadCompanyState(options);
      if (!s.works.some((w) => w.masterTaskId === payload.taskId || w.tasks.some((t) => t.taskId === payload.taskId)) || !clean(payload.answer)) throw new Error('이 업무의 질문에 답변을 입력해 주세요.');
      const answered = await options.answerTask?.(payload.taskId, clean(payload.answer, 5000));
      if (answered && answered.status !== 'error') void options.runtime?.tick().catch(() => {});
      return result(answered?.status || 'error', answered?.userMessage || '업무 답변을 저장하지 못했습니다.');
    }
    if (payload.kind === 'save_rule') {
      const { draft, setupId, setupFingerprint } = ruleDraft(payload);
      await mutateCompany(options, (s) => {
        assertCompanyScope(payload, options);
        const existing = setupId && s.rules.find((rule) => rule.setupId === setupId);
        if (existing) {
          if (existing.setupFingerprint !== setupFingerprint) throw new Error('이미 저장한 자동화 설정과 내용이 다릅니다. 변경한 내용으로 새 설정을 시작해 주세요.');
          return; // 재시도는 실행 시각이나 사용자가 일시 중지한 상태를 되돌리지 않는다.
        }
        if (draft.departmentIds.some((id) => !s.departments.some((d) => d.id === id && d.enabled))) throw new Error('사용할 부서를 다시 선택해 주세요. 선택한 부서 중 사용할 수 없는 부서가 있습니다.');
        if (draft.trigger === 'message' && !s.connections.some((c) => c.id === draft.connectionId && c.enabled && c.scopeApprovedAt)) throw new Error('사용할 수신 계정을 활성화하고 업무 대화방의 읽기 범위를 먼저 승인해 주세요.');
        if (draft.trigger === 'schedule' && draft.connectionId && !s.connections.some((c) => c.id === draft.connectionId && c.provider === 'mail' && c.enabled && c.scopeApprovedAt)) throw new Error('예약 업무에 참고할 메일 계정을 활성화하고 읽기 범위를 승인해 주세요.');
        s.rules.push({ id: randomUUID(), ...draft, ...(setupId ? { setupId, setupFingerprint } : {}), enabled: true, createdAt: new Date().toISOString() });
      });
      return result('saved', '자동화 규칙을 저장했습니다. 앱이 실행 중일 때 확인하며 외부 실행은 최종 승인을 기다립니다.', { state: await publicState(options) });
    }
    if (payload.kind === 'toggle_rule') {
      await mutateCompany(options, (s) => {
        const rule = s.rules.find((r) => r.id === payload.id); if (!rule) throw new Error('자동화 규칙을 찾지 못했습니다.');
        if (payload.enabled === true) {
          if (!rule.departmentIds.length || rule.departmentIds.some((id) => !s.departments.some((d) => d.id === id && d.enabled))) throw new Error('이 규칙의 담당 부서를 먼저 활성화해 주세요.');
          if (rule.trigger === 'message' && !s.connections.some((c) => c.id === rule.connectionId && c.enabled && c.scopeApprovedAt)) throw new Error('이 규칙의 수신 계정과 업무방을 먼저 연결해 주세요.');
          if (rule.trigger === 'schedule' && rule.connectionId && !s.connections.some((c) => c.id === rule.connectionId && c.provider === 'mail' && c.enabled && c.scopeApprovedAt)) throw new Error('이 예약 업무의 메일 계정을 활성화하고 읽기 범위를 승인해 주세요.');
        }
        rule.enabled = payload.enabled === true;
      });
      return result('saved', '자동화 상태를 변경했습니다.', { state: await publicState(options) });
    }
    if (payload.kind === 'review_accounting') {
      const record = await readCompanyRecord(payload.id, options); const table = Number(payload.tableIndex || 0); const mapping = payload.mapping || suggestMapping(record.tables[table]);
      const review = await mutateCompany(options, (s) => { const review = { ...reviewAccounting(record, table, mapping, payload.currency || 'KRW', s.ledger), id: randomUUID(), createdAt: new Date().toISOString() }; s.accountingReviews = [...s.accountingReviews.slice(-19), review]; return review; });
      return result('review_ready', `정상 ${review.validCount}건, 확인 필요 ${review.issueCount}건입니다. 원본과 비교 후 반영할 행을 선택해 주세요.`, { review });
    }
    if (payload.kind === 'commit_accounting') {
      if (payload.approved !== true) throw new Error('원본과 금액을 검토한 다음 장부 반영을 승인해 주세요.');
      await mutateCompany(options, async (s) => {
        const review = s.accountingReviews.find((r) => r.id === payload.reviewId); if (!review) throw new Error('장부를 다시 검토해 주세요.');
        const record = await readCompanyRecord(review.sourceId, options);
        const fresh = reviewAccounting(record, review.tableIndex, review.mapping, review.currency, s.ledger);
        const ids = new Set(payload.rowIds || []); const selected = fresh.rows.filter((r) => ids.has(r.id));
        if (!selected.length || selected.length !== ids.size || selected.some((r) => r.issues.length)) throw new Error('확인이 필요한 행이나 이미 반영한 거래가 있습니다. 장부를 다시 검토해 주세요.');
        s.ledger.push(...selected.map((r) => ({ ...r, approvedAt: new Date().toISOString() })));
        s.accountingReviews = s.accountingReviews.filter((r) => r.id !== review.id);
      });
      return result('saved', '선택한 거래를 원본 근거와 함께 회사 입출금 장부에 반영했습니다.', { state: await publicState(options) });
    }
    if (payload.kind === 'export_accounting') {
      const state = await loadCompanyState(options); if (!state.ledger.length) throw new Error('검토해 반영한 거래가 없습니다.');
      if (!['xlsx', 'docx', 'hwpx', 'pdf'].includes(payload.format)) throw new Error('장부 저장 형식을 선택해 주세요.');
      const from = clean(payload.from, 10); const to = clean(payload.to, 10);
      if ((from && !/^\d{4}-\d{2}-\d{2}$/u.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/u.test(to)) || (from && to && from > to)) throw new Error('장부 조회 기간을 확인해 주세요.');
      const rows = state.ledger.filter((r) => (!from || r.date >= from) && (!to || r.date <= to) && r.currency === (payload.currency || 'KRW'));
      if (!rows.length) throw new Error('선택한 기간과 통화의 거래가 없습니다.');
      if (rows.length > 2000) throw new Error('문서 한 개에 2,000건까지 저장할 수 있습니다. 기간을 나눠 저장해 주세요.');
      return await options.exportDocument?.({ kind: 'export', format: payload.format, spec: accountingDocument(rows, payload.currency || 'KRW') }) || result('error', '문서 제작기를 확인해 주세요.');
    }
    const provider = catalog.providers.find((p) => p.id === payload.provider);
    if (payload.kind === 'connect_mail_source') {
      if (payload.approved !== true) throw new Error('선택한 메일함의 업무 분류와 자동화 연결을 승인해 주세요.');
      const accounts = await options.listMailAccounts?.() || []; const account = accounts.find((a) => a.id === payload.accountId);
      if (!account) throw new Error('메일 연결 화면에서 계정을 먼저 연결해 주세요.');
      await mutateCompany(options, (s) => { assertCompanyScope(payload, options); const existing = s.connections.find((c) => c.provider === 'mail' && c.accountId === account.id); const fields = { provider: 'mail', accountId: account.id, name: account.name, status: 'waiting_message', enabled: true, channelIds: [account.id], scopeApprovedAt: new Date().toISOString(), nextPollAt: '', cursors: {} }; if (existing) Object.assign(existing, fields); else s.connections.push({ id: randomUUID(), createdAt: new Date().toISOString(), ...fields }); });
      return result('waiting_message', '승인한 메일함에서 업무로 분류된 새 메일을 자동화에 연결했습니다. 자동화 규칙에서 담당 부서를 선택해 주세요.', { state: await publicState(options) });
    }
    if (payload.kind === 'start_managed_bot') {
      const username = clean(payload.username, 32); if (!/^[A-Za-z][A-Za-z0-9_]{3,28}bot$/iu.test(username)) throw new Error('봇 사용자 이름은 영문으로 시작하고 bot으로 끝나는 7~32자로 입력해 주세요.');
      const token = clean(payload.managerToken, 8192); const manager = await verifyProvider({ provider: 'telegram', token }, options);
      const id = randomUUID(); await encryptCompanySecret(id, { token }, options);
      const updates = await telegramCall(token, 'getUpdates', { offset: -1, limit: 1, timeout: 0, allowed_updates: ['managed_bot'] }, options);
      await mutateCompany(options, (s) => { s.botSetup = { id, username, manager: manager.username, offset: updates.at(-1)?.update_id + 1 || 0, startedAt: new Date().toISOString() }; });
      const setupUrl = `https://t.me/newbot/${encodeURIComponent(manager.username)}/${encodeURIComponent(username)}?name=${encodeURIComponent(clean(payload.botName, 64) || '회사 업무 비서')}`;
      await openConnectionSetupUrl(options.shell, setupUrl, 'telegram-bot');
      return result('bot_creation_pending', 'Telegram에서 새 봇 생성을 승인한 다음 ‘생성한 봇 연결’을 눌러 주세요. 관리 봇은 BotFather의 Bot Management Mode가 활성화되어 있어야 합니다.', { setupUrl });
    }
    if (payload.kind === 'finish_managed_bot') {
      const state = await loadCompanyState(options); const setup = state.botSetup;
      if (!setup || Date.now() - Date.parse(setup.startedAt) > 2 * 3600000) throw new Error('봇 생성 요청을 다시 시작해 주세요.');
      const secret = await readCompanySecret(setup.id, options);
      const updates = await telegramCall(secret.token, 'getUpdates', { offset: setup.offset, limit: 100, timeout: 0, allowed_updates: ['managed_bot'] }, options);
      const created = updates.find((u) => u.managed_bot?.bot?.username?.toLowerCase() === setup.username.toLowerCase())?.managed_bot;
      if (!created) throw new Error('승인한 새 봇 생성 이벤트가 아직 없습니다. Telegram 생성 화면과 관리 봇 설정을 확인해 주세요.');
      const token = await telegramCall(secret.token, 'getManagedBotToken', { user_id: created.bot.id }, options);
      const verified = await verifyProvider({ provider: 'telegram', token }, options);
      const id = randomUUID(); await encryptCompanySecret(id, { token }, options);
      await mutateCompany(options, (s) => { if (s.connections.some((c) => c.provider === 'telegram' && c.accountId === verified.accountId)) throw new Error('이 봇은 이미 연결되어 있습니다.'); s.connections.push({ id, provider: 'telegram', ...verified, status: 'scope_required', channelIds: [], discoveredChannels: [], cursors: {}, enabled: false, createdAt: new Date().toISOString() }); delete s.botSetup; });
      await unlink(path.join(companyRoot(options), 'credentials', `${setup.id}.json`));
      return result('authenticated', '승인한 봇을 생성하고 보안 저장소에 연결했습니다. 업무방에 초대하고 읽기 범위를 선택해 주세요.', { state: await publicState(options) });
    }
    if (payload.kind === 'invite_telegram') {
      const connection = (await loadCompanyState(options)).connections.find((c) => c.id === payload.id && c.provider === 'telegram');
      if (!connection || !/^[A-Za-z0-9_]+$/u.test(connection.username || '')) throw new Error('초대할 봇을 다시 선택해 주세요.');
      await openConnectionSetupUrl(options.shell, `https://t.me/${connection.username}?startgroup=modycrew`, 'telegram-bot');
      return result('invite_opened', 'Telegram에서 초대할 업무방을 선택해 주세요. 대화방 ID를 입력하고 수신 범위를 승인하면 시작합니다.');
    }
    if (['provision_relay', 'check_relay'].includes(payload.kind)) {
      const connection = (await loadCompanyState(options)).connections.find((c) => c.id === payload.id);
      if (!connection) throw new Error('수신 계정을 선택해 주세요.');
      let credentials = await readCompanySecret(connection.id, options);
      if (payload.kind === 'provision_relay') {
        if (payload.approved !== true) throw new Error('수신 서버 생성과 클라우드 계정 사용을 승인해 주세요.');
        await provisionCompanyRelay(connection, credentials, payload, { ...options, onProvisioned: async (receipt) => {
          credentials = { ...credentials, ...receipt }; await encryptCompanySecret(connection.id, credentials, options);
          connection.relayUrl = receipt.relayUrl;
          await mutateCompany(options, (s) => { const c = s.connections.find((r) => r.id === connection.id); c.relayUrl = receipt.relayUrl; c.status = 'relay_check_required'; });
        } });
      }
      await checkCompanyRelay(connection, credentials, options);
      await mutateCompany(options, (s) => { const c = s.connections.find((r) => r.id === connection.id); c.status = 'relay_ready'; });
      return result('relay_ready', connection.provider === 'line' ? 'LINE 웹훅 주소를 등록했습니다. 공식 설정에서 웹훅 사용을 켜고 업무방 범위를 선택해 주세요.' : '수신 주소를 준비했습니다. 공식 앱 설정에 아래 웹훅 주소를 등록한 뒤 업무방 범위를 선택해 주세요.', { state: await publicState(options), setupUrl: `${connection.relayUrl}/webhook`, verifyToken: connection.provider === 'whatsapp' ? credentials.verifyToken : undefined, externalMutation: true });
    }
    if (['open_setup', 'propose_setup', 'apply_setup'].includes(payload.kind)) {
      if (!provider) throw new Error('연결할 서비스를 선택해 주세요.');
      if (payload.kind === 'open_setup') { await openSetupBrowser(provider, options); return result('setup_opened', '공식 설정 화면에서 로그인해 주세요. 로그인 후 다음 단계를 찾아 앱이 입력과 설정을 도울 수 있습니다.'); }
      if (payload.kind === 'propose_setup') return result('setup_proposed', '다음 설정 단계를 확인해 주세요.', { setupStep: await proposeSetupStep(provider, (await loadCompanyState(options)).companyName, options) });
      if (payload.approved !== true) throw new Error('표시된 설정 단계를 승인해 주세요.');
      await applySetupStep(provider.id, payload.proposalId); return result('setup_applied', '승인한 단계를 실행했습니다. 다음 설정을 확인해 주세요.', { externalMutation: true });
    }
    if (['connect_provider', 'capture_provider'].includes(payload.kind)) {
      if (!provider || !['poll', 'webhook'].includes(provider.mode)) throw new Error('이 서비스는 기존 연결 화면 또는 공식 도구에서 설정해 주세요.');
      if (payload.kind === 'capture_provider') payload = { ...payload, ...await captureSetupCredentials(provider.id) };
      const secrets = { token: clean(payload.token, 8192), appSecret: clean(payload.appSecret, 8192), appId: clean(payload.appId, 100) };
      if (provider.mode === 'webhook' && secrets.appSecret.length < 8) throw new Error('웹훅 검증에 사용할 서비스 Secret을 입력해 주세요.');
      const verified = await verifyProvider({ ...secrets, provider: provider.id, accountId: clean(payload.accountId, 100), apiVersion: clean(payload.apiVersion, 20) }, options);
      const id = randomUUID(); await encryptCompanySecret(id, secrets, options);
      await mutateCompany(options, (s) => { if (s.connections.some((c) => c.provider === provider.id && c.accountId === verified.accountId)) throw new Error('이미 연결한 계정입니다. 기존 계정의 수신 범위를 설정해 주세요.'); s.connections.push({ id, provider: provider.id, ...verified, apiVersion: clean(payload.apiVersion, 20), status: provider.mode === 'webhook' ? 'relay_required' : 'scope_required', channelIds: [], discoveredChannels: [], cursors: {}, enabled: false, createdAt: new Date().toISOString() }); });
      return result('authenticated', '계정을 확인했습니다. 수신할 업무 대화방과 접근 범위를 설정해 주세요.', { state: await publicState(options) });
    }
    if (payload.kind === 'discover_channels') {
      const connection = (await loadCompanyState(options)).connections.find((c) => c.id === payload.id);
      if (!connection || connection.provider === 'mail') throw new Error('대화방을 확인할 메신저 계정을 선택해 주세요.');
      const channels = await discoverProviderChannels(connection, await readCompanySecret(connection.id, options), options);
      await mutateCompany(options, (s) => { const c = s.connections.find((r) => r.id === connection.id); c.discoveredChannels = [...new Map(channels.map((r) => [r.id, r])).values()]; });
      return result('channels_loaded', channels.length ? `${channels.length}개 대화방 후보를 찾았습니다. 수신할 업무방을 선택하고 승인해 주세요.` : '대화방을 찾지 못했습니다. 봇을 초대하고 새 메시지를 보낸 다음 다시 확인해 주세요.', { state: await publicState(options) });
    }
    if (payload.kind === 'save_scope') {
      if (payload.approved !== true || payload.participantsInformed !== true) throw new Error('참여자에게 업무 대화 활용을 알리고 선택한 범위의 읽기를 승인해 주세요.');
      await mutateCompany(options, (s) => { const c = s.connections.find((item) => item.id === payload.id); if (!c) throw new Error('연결할 계정을 찾지 못했습니다.');
        if (catalog.providers.find((p) => p.id === c.provider)?.mode === 'webhook' && !c.relayUrl) throw new Error('공개 HTTPS 수신 연결을 먼저 준비해 주세요.');
        const ids = [...new Set((payload.channelIds || []).map((id) => clean(id, 100)).filter(Boolean))];
        if (!ids.length || ids.length > 20 || ids.some((id) => c.provider === 'mail' ? id !== c.accountId : !/^[A-Za-z0-9_-]+$/u.test(id))) throw new Error('수신할 대화방 ID를 1~20개 입력해 주세요.');
        c.channelIds = ids; c.scopeApprovedAt = new Date().toISOString(); c.enabled = true; c.status = 'waiting_message'; c.nextPollAt = ''; c.error = '';
        // Start at consent time. Historical discussion is not silently converted into new work.
        if (c.provider === 'slack') for (const id of ids) c.cursors[id] = String(Date.now() / 1000);
      });
      void options.runtime?.tick().catch(() => {}); return result('waiting_message', '수신을 시작했습니다. 선택한 대화방에 새 메시지가 도착하면 실제 수신 여부를 표시합니다.', { state: await publicState(options) });
    }
    if (payload.kind === 'pause_connection') { await mutateCompany(options, (s) => { const c = s.connections.find((item) => item.id === payload.id); if (!c) throw new Error('연결을 찾지 못했습니다.'); c.enabled = false; c.status = 'paused'; }); return result('saved', '대화 수신을 중지했습니다.', { state: await publicState(options) }); }
    if (payload.kind === 'disconnect_provider') { await mutateCompany(options, async (s) => { const c = s.connections.find((item) => item.id === payload.id); if (!c) throw new Error('연결을 찾지 못했습니다.'); if (c.relayUrl) await removeCompanyRelay(c, await readCompanySecret(c.id, options), options); await unlink(path.join(companyRoot(options), 'credentials', `${c.id}.json`)).catch((error) => { if (error.code !== 'ENOENT') throw error; }); s.connections = s.connections.filter((item) => item.id !== c.id); for (const rule of s.rules) if (rule.connectionId === c.id) rule.enabled = false; }); return result('saved', '수신 서버와 계정 인증 정보를 삭제하고 연결된 자동화를 중지했습니다.', { state: await publicState(options) }); }
    if (payload.kind === 'poll_now') { await options.runtime?.tick(); return result('checked', '수신과 업무 진행 상태를 확인했습니다.', { state: await publicState(options) }); }
    throw new Error('지원하지 않는 회사 운영 작업입니다.');
  } catch (error) { return result('error', clean(error.message, 1500) || '회사 운영 작업을 완료하지 못했습니다.'); }
}
