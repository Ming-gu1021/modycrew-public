const labels = Object.freeze({
  final_execution_sent_save_failed: '발송 기록 확인 필요',
  final_execution_sent_card_changed: '발송 기록 확인 필요',
  final_execution_sent_audit_failed: '발송 기록 확인 필요',
  final_execution_journal_already_sent: '발송 기록 확인 필요',
  final_execution_partial_save_failed: '일부 발송 확인 필요',
  final_execution_partial_card_changed: '일부 발송 확인 필요',
  final_execution_partial_audit_failed: '일부 발송 확인 필요',
  final_execution_journal_partial: '일부 발송 확인 필요',
  final_execution_outcome_unknown: '발송 결과 확인 필요',
  final_execution_journal_unavailable: '발송 기록 확인 필요',
  final_execution_not_sent_save_failed: '발송 기록 확인 필요',
  final_execution_in_progress: '발송 진행 상황 확인 필요',
});
export function mailDispatchReviewState(status) {
  const label = labels[status];
  return label ? { blockRetry:true, clearReview:true, label } : { blockRetry:false, clearReview:status === 'final_execution_card_changed', label:'' };
}
// Renderer-side local drafts must never hide an authoritative backend send or
// uncertain journal state merely because they share an ID.
export function retainAuthoritativeMailCard(item) {
  if (mailDispatchReviewState(item?.mailDispatchStatus?.status).blockRetry) return true;
  const action = item?.finalAction;
  return ['send_email','send_bulk_email'].includes(action?.kind) && (Boolean(action?.sentAt) || action?.readiness === 'sent');
}
