import { clean, listCompanyRecords } from './company-records.mjs';
import { loadCompanyState } from './runtime.mjs';
import { loadHandoverStore, saveHandover, transitionHandover, askHandover, suggestHandover, handoverSource } from './handover.mjs';
import { exportHandoverPackage, previewHandoverImport, applyHandoverImport } from './handover-transfer.mjs';

const result = (status, userMessage, extra = {}) => ({ status, userMessage, externalMutation: false, ...extra });
// Entry is exclusively behind handleCompanyAutomationMessage's trusted main-frame check.
export async function handleHandoverMessage(event, input = {}, options = {}) {
  try {
    const trustedOptions = { ...options, senderId: event?.sender?.id ?? (options.trustedSender ? (options.senderId ?? 1) : undefined) };
    if (input.kind === 'handover_status') {
      const company = await loadCompanyState(options);
      return result('ready', '인계할 업무와 자료를 선택하고 새 담당자가 배울 절차를 정리하세요.', { handoverState: await loadHandoverStore(options), records: await listCompanyRecords(options), departments: company.departments, companyName: company.companyName, works: company.works.slice(-100).reverse().map(({ id, request, status, createdAt }) => ({ id, request, status, createdAt })) });
    }
    let extra = {}; let userMessage = '';
    if (input.kind === 'handover_save') { extra.handover = await saveHandover(input, options); userMessage = '인계 내용을 초안으로 저장했습니다. 변경한 내용은 다시 확인해 주세요.'; }
    else if (['handover_approve', 'handover_accept', 'handover_step', 'handover_complete'].includes(input.kind)) {
      extra.handover = await transitionHandover(input.kind.slice(9), input, options);
      userMessage = { handover_approve: '인계 내용을 확인했습니다. 새 담당자가 질문하고 인수를 확인할 수 있습니다.', handover_accept: '인수 확인을 기록했습니다. 절차를 익히며 진행 상황을 표시하세요.', handover_step: '업무 학습 진행을 저장했습니다.', handover_complete: '인수 완료와 접근 권한 확인 기록을 남겼습니다. 실제 계정 권한은 각 서비스에서 관리해 주세요.' }[input.kind];
    } else if (input.kind === 'handover_ask') { extra.answer = await askHandover(input, options); userMessage = extra.answer.status === 'needs_confirmation' ? '자료에서 확인할 수 없는 질문입니다.' : '선택한 인계 자료의 원문과 다음 확인할 절차입니다.'; }
    else if (input.kind === 'handover_read_source') return result('record_loaded', '인계 자료의 원문을 확인하세요.', { record: await handoverSource(input, options) });
    else if (input.kind === 'handover_suggest') return result('proposed', 'AI의 절차 제안입니다. 원문을 확인한 뒤 초안에 적용해 주세요.', { suggestion: await suggestHandover(input, options) });
    else if (input.kind === 'handover_export') { extra = await exportHandoverPackage(input, trustedOptions); if (extra.cancelled) return result('cancelled', '자료 내보내기를 취소했습니다.'); return result('exported', '선택한 회사 자료와 인수인계 내용을 암호화 파일로 저장했습니다.', extra); }
    else if (input.kind === 'handover_import_preview') { extra = await previewHandoverImport(input, trustedOptions); if (extra.cancelled) return result('cancelled', '파일 선택을 취소했습니다.'); return result('preview_ready', '가져올 회사 자료의 범위와 제외 항목을 확인해 주세요.', extra); }
    else if (input.kind === 'handover_import_apply') { extra = await applyHandoverImport(input, trustedOptions); userMessage = extra.alreadyImported ? '이미 가져온 자료입니다. 기존 인수인계 초안을 열었습니다.' : '새 인수인계 초안으로 가져왔습니다. 받는 담당자와 절차를 확인하고 계정을 다시 연결해 주세요.'; }
    else throw new Error('지원하지 않는 인수인계 요청입니다.');
    return result('saved', userMessage, { ...extra, handoverState: await loadHandoverStore(options) });
  } catch (error) { return result('error', clean(error.message, 1500) || '인수인계 업무를 처리하지 못했습니다.'); }
}
