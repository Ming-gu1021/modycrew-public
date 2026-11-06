import type { ModyProviderMailReadOutput } from "./provider-read-adapter.js";
import type { ModyProviderWorkIntakeReport } from "./provider-work-intake.js";
import type { ModyUserWritingProfile } from "./mail-workflow.js";
import {
  analyzeMailWorkScenarioCoverage,
  type ModyMailWorkScenarioCoverage,
} from "./mail-work-scenario-taxonomy.js";

export type ModyMailWorkPatternAnalysis = {
  summary: string;
  workingStyle: string[];
  improvementSuggestions: string[];
  automationOpportunities: string[];
  replyToneGuidance: string[];
  scheduleGuidance: string[];
  connectionPreparation: string[];
  recipientGuidance: string[];
  sendingPlanGuidance: string[];
  learningSignals: string[];
  /** 실제 읽은 메일에서 뽑은 학습 신호(발신 도메인·주제어). 템플릿이 아니라 이번 메일함의 내용에서 파생된다. */
  contentLearningSignals: string[];
  scenarioCoverage: ModyMailWorkScenarioCoverage[];
  connectionReadinessPlan?: ModyMailConnectionReadinessPlan;
  bulkSendPlan?: ModyMailBulkSendPlan;
  followUpPlan?: ModyMailFollowUpPlan;
  recipientSourcePlan?: ModyMailRecipientSourcePlan;
  recipientCopyPlan?: ModyMailRecipientCopyPlan;
  approvalPolicy: string[];
  riskNotes: string[];
  stats: {
    totalMessages: number;
    workItems: number;
    reviewItems: number;
    ignoredItems: number;
    approvalCandidates: number;
    replyCandidates: number;
    calendarCandidates: number;
    attachmentSignals: number;
    bulkMailSignals: number;
    recipientDecisionSignals: number;
    followUpSignals: number;
    recipientSourceSignals: number;
    quoteProposalSignals: number;
    invoicePaymentSignals: number;
    contractLegalSignals: number;
    publicTaxSignals: number;
    complaintEscalationSignals: number;
    reservationOrderSignals: number;
    complianceUnsubscribeSignals: number;
    customerInquirySignals: number;
    vendorProcurementSignals: number;
    hrRecruitingSignals: number;
    documentSubmissionSignals: number;
    securityAccountAlertSignals: number;
    internalCollaborationSignals: number;
    threadContextSignals: number;
    deliveryFailureSignals: number;
    outOfOfficeSignals: number;
    sentHistoryAuditSignals: number;
    mailInfoDigestSignals: number;
    mobileReviewHandoffSignals: number;
  };
  privacyBoundary: string;
};

export type ModyMailConnectionReadinessPlan = {
  status: "review_required" | "ready_without_new_connection";
  workCaseLabels: string[];
  providerOptions: string[];
  vaultInputs: string[];
  twoFactorChecklist: string[];
  permissionBoundaries: string[];
  approvalGate: string;
  privacyBoundary: string;
};

export type ModyMailBulkSendPlan = {
  status: "review_required" | "not_detected";
  targetGroups: string[];
  excludedGroups: string[];
  personalizationFields: string[];
  sampleReviewChecklist: string[];
  approvalGate: string;
  privacyBoundary: string;
};

export type ModyMailFollowUpPlan = {
  status: "review_required" | "not_detected";
  waitingSignals: string[];
  suggestedCadence: string[];
  nextCheckLabel: string;
  approvalGate: string;
  privacyBoundary: string;
};

export type ModyMailRecipientSourcePlan = {
  status: "review_required" | "not_detected";
  sourceTypes: string[];
  fileReviewChecklist: string[];
  matchingRules: string[];
  approvalGate: string;
  privacyBoundary: string;
};

export type ModyMailRecipientCopyPlan = {
  status: "review_required" | "not_detected";
  sendTargetRules: string[];
  ccReviewRules: string[];
  bccReviewRules: string[];
  holdReviewRules: string[];
  approvalGate: string;
  privacyBoundary: string;
};

export function analyzeMailWorkPattern(input: {
  providerRead?: ModyProviderMailReadOutput;
  workReport?: ModyProviderWorkIntakeReport;
  writingProfile?: ModyUserWritingProfile;
}): ModyMailWorkPatternAnalysis {
  const messages = input.providerRead?.messages ?? [];
  const report = input.workReport;
  const candidates = report?.candidates ?? [];
  const approvalQueue = report?.approvalQueue ?? [];
  const replyCandidates = approvalQueue.filter((request) => request.operationKind === "send_email").length;
  const calendarCandidates = approvalQueue.filter((request) => request.operationKind === "create_calendar_event").length;
  const attachmentSignals = messages.filter((message) => message.hasAttachments === true).length;
  const bulkMailSignals = messages.filter(hasBulkMailSignal).length;
  const recipientDecisionSignals = messages.filter(hasRecipientDecisionSignal).length;
  const followUpSignals = messages.filter(hasFollowUpSignal).length;
  const recipientSourceSignals = messages.filter(hasRecipientSourceSignal).length;
  const quoteProposalSignals = messages.filter(hasQuoteProposalSignal).length;
  const invoicePaymentSignals = messages.filter(hasInvoicePaymentSignal).length;
  const contractLegalSignals = messages.filter(hasContractLegalSignal).length;
  const publicTaxSignals = messages.filter(hasPublicTaxSignal).length;
  const complaintEscalationSignals = messages.filter(hasComplaintEscalationSignal).length;
  const reservationOrderSignals = messages.filter(hasReservationOrderSignal).length;
  const complianceUnsubscribeSignals = messages.filter(hasComplianceUnsubscribeSignal).length;
  const customerInquirySignals = messages.filter(hasCustomerInquirySignal).length;
  const vendorProcurementSignals = messages.filter(hasVendorProcurementSignal).length;
  const hrRecruitingSignals = messages.filter(hasHrRecruitingSignal).length;
  const documentSubmissionSignals = messages.filter(hasDocumentSubmissionSignal).length;
  const securityAccountAlertSignals = messages.filter(hasSecurityAccountAlertSignal).length;
  const internalCollaborationSignals = messages.filter(hasInternalCollaborationSignal).length;
  const threadContextSignals = messages.filter(hasThreadContextSignal).length;
  const deliveryFailureSignals = messages.filter(hasDeliveryFailureSignal).length;
  const outOfOfficeSignals = messages.filter(hasOutOfOfficeSignal).length;
  const sentHistoryAuditSignals = messages.filter(hasSentHistoryAuditSignal).length;
  const mailInfoDigestSignals = messages.filter(hasMailInfoDigestSignal).length;
  const mobileReviewHandoffSignals = messages.filter(hasMobileReviewHandoffSignal).length;
  const stats = {
    totalMessages: messages.length,
    workItems: report?.createdWorkItemsCount ?? 0,
    reviewItems: report?.reviewItemsCount ?? 0,
    ignoredItems: report?.ignoredItemsCount ?? 0,
    approvalCandidates: approvalQueue.length,
    replyCandidates,
    calendarCandidates,
    attachmentSignals,
    bulkMailSignals,
    recipientDecisionSignals,
    followUpSignals,
    recipientSourceSignals,
    quoteProposalSignals,
    invoicePaymentSignals,
    contractLegalSignals,
    publicTaxSignals,
    complaintEscalationSignals,
    reservationOrderSignals,
    complianceUnsubscribeSignals,
    customerInquirySignals,
    vendorProcurementSignals,
    hrRecruitingSignals,
    documentSubmissionSignals,
    securityAccountAlertSignals,
    internalCollaborationSignals,
    threadContextSignals,
    deliveryFailureSignals,
    outOfOfficeSignals,
    sentHistoryAuditSignals,
    mailInfoDigestSignals,
    mobileReviewHandoffSignals,
  };

  const workingStyle = unique([
    stats.totalMessages === 0 ? "연결은 됐지만 아직 분석할 최신 메일이 없습니다." : "",
    stats.workItems > 0 ? `최근 메일 ${stats.totalMessages}건 중 업무로 처리할 신호가 ${stats.workItems}건 보입니다.` : "",
    stats.replyCandidates > 0 ? "답장 초안으로 이어지는 문의/확인 요청이 있습니다." : "",
    stats.calendarCandidates > 0 ? "메일 안에 일정 조율이나 예약성 업무가 섞여 있습니다." : "",
    stats.reviewItems > 0 ? "자동 분류만으로 확정하기 어려운 확인 필요 메일이 있습니다." : "",
    stats.ignoredItems > 0 ? "공지/광고성 메일도 섞여 있어 업무 신호와 잡음을 분리해야 합니다." : "",
    stats.attachmentSignals > 0 ? "첨부파일이 있는 메일은 파일 읽기와 함께 묶어야 정확도가 올라갑니다." : "",
    stats.recipientSourceSignals > 0 ? "엑셀/CSV/첨부 명단을 수신자 판단과 연결해야 하는 신호가 있습니다." : "",
    stats.followUpSignals > 0 ? "회신 대기, 마감, 리마인드처럼 다음 확인 시점을 잡아야 하는 메일이 있습니다." : "",
    stats.recipientDecisionSignals > 0 ? "누구에게 보내야 하는지 판단해야 하는 메일 신호가 있습니다." : "",
    stats.bulkMailSignals > 0 ? "여러 사람에게 같은 내용을 맞춰 보내야 하는 대량/단체 발송 신호가 있습니다." : "",
    stats.quoteProposalSignals > 0 ? "견적/제안 메일은 금액, 조건, 첨부 여부를 초안 전에 분리해야 합니다." : "",
    stats.invoicePaymentSignals > 0 ? "정산/청구 메일은 금액, 증빙, 세금계산서 상태를 확인해야 합니다." : "",
    stats.contractLegalSignals > 0 ? "계약/법무 메일은 자동 발송보다 검토 체크리스트가 우선입니다." : "",
    stats.publicTaxSignals > 0 ? "공공기관/세무 메일은 제출 기한과 필수 서류를 고위험 승인으로 잠가야 합니다." : "",
    stats.complaintEscalationSignals > 0 ? "클레임/긴급 메일은 응대 우선순위와 금지 표현을 먼저 확인해야 합니다." : "",
    stats.reservationOrderSignals > 0 ? "예약/주문 메일은 상태, 시간, 변경 가능 여부를 확인해야 합니다." : "",
    stats.complianceUnsubscribeSignals > 0 ? "수신거부/마케팅 준수 신호는 발송 전 제외 규칙으로 반영해야 합니다." : "",
    stats.customerInquirySignals > 0 ? "고객/상담 문의는 답변 범위와 담당자를 먼저 정해야 합니다." : "",
    stats.vendorProcurementSignals > 0 ? "구매/발주 메일은 품목, 수량, 납기, 거래 조건을 확인해야 합니다." : "",
    stats.hrRecruitingSignals > 0 ? "채용/인사 메일은 개인정보와 내부 공유 범위를 먼저 잠가야 합니다." : "",
    stats.documentSubmissionSignals > 0 ? "자료/보고서 제출 메일은 파일, 기한, 공유 권한을 함께 확인해야 합니다." : "",
    stats.securityAccountAlertSignals > 0 ? "보안/계정 알림은 공식 화면 확인과 비밀값 비노출을 우선해야 합니다." : "",
    stats.internalCollaborationSignals > 0 ? "내부 협업 메일은 담당자, 마감, 공유 채널을 다음 행동으로 정해야 합니다." : "",
    stats.threadContextSignals > 0 ? "스레드/전달 메일은 최신 요청과 이전 약속을 분리해 답장 기준을 정해야 합니다." : "",
    stats.deliveryFailureSignals > 0 ? "반송/발송 실패 메일은 주소, 첨부 용량, provider 오류를 재발송 전 확인해야 합니다." : "",
    stats.outOfOfficeSignals > 0 ? "부재중/자동응답 메일은 재시도 시점과 대체 담당자 후보로 나눠야 합니다." : "",
    stats.sentHistoryAuditSignals > 0 ? "처리 이력/승인 기록 신호는 발송 감사와 되돌림 기준으로 남겨야 합니다." : "",
    stats.mailInfoDigestSignals > 0 ? "메일 정보 전달/요약은 중요 메일, 확인 필요 정보, 민감정보 제외 기준을 먼저 정해야 합니다." : "",
    stats.mobileReviewHandoffSignals > 0 ? "휴대폰으로 받을 메일은 요약과 승인 후보만 보내고 실제 전송은 앱 최종 확인으로 이어야 합니다." : "",
    report?.calendarBusyWindows?.length ? "캘린더 바쁜 시간까지 함께 보면 일정 후보의 충돌을 줄일 수 있습니다." : "",
  ]);

  const improvementSuggestions = unique([
    stats.replyCandidates > 0 ? "반복 답장은 먼저 초안으로 만들고, 실제 발송은 승인 버튼 뒤에 두세요." : "",
    stats.calendarCandidates > 0 ? "일정 후보는 캘린더 충돌 확인 후 가능한 시간 2-3개를 제안하는 방식이 좋습니다." : "",
    stats.reviewItems > 0 ? "확인 필요 메일은 매일 한 번 우선순위 큐로 묶어 놓으면 놓치는 일이 줄어듭니다." : "",
    stats.ignoredItems > 0 ? "광고/공지/시스템 알림은 규칙으로 내려서 업무 카드가 지저분해지지 않게 하세요." : "",
    stats.attachmentSignals > 0 ? "첨부가 있는 메일은 파일 분석을 같이 실행해 답장 근거와 누락 자료를 자동 확인하세요." : "",
    stats.recipientSourceSignals > 0 ? "첨부/엑셀 명단은 발송 대상 원천으로만 연결하고, 전체 주소 목록은 승인 화면에서 별도 확인하게 하세요." : "",
    stats.followUpSignals > 0 ? "회신 대기와 마감성 메일은 자동 독촉 대신 다음 확인 후보와 리마인드 초안으로 분리하세요." : "",
    stats.recipientDecisionSignals > 0 ? "수신자 후보는 보낸 사람, 기존 거래처/고객 분류, 메일 스레드 맥락으로 먼저 추천하고 사용자가 확정하게 하세요." : "",
    stats.mobileReviewHandoffSignals > 0 ? "핸드폰 알림은 긴 제목과 본문 대신 1줄 요약, 승인/수정/보류 버튼, 앱에서 마지막 확인으로 구성하세요." : "",
    stats.bulkMailSignals > 0 ? "대량 메일은 대상 그룹, 제외 대상, 개인화 변수, 숨은 참조 기준을 분리한 뒤 발송 전 목록 검토를 필수로 두세요." : "",
    stats.quoteProposalSignals > 0 ? "견적/제안 답장은 단가, 납기, 유효기간, 첨부파일을 별도 확인 항목으로 두세요." : "",
    stats.invoicePaymentSignals > 0 ? "정산/청구 메일은 금액과 증빙 파일을 사용자가 확인하기 전까지 초안 상태로 두세요." : "",
    stats.contractLegalSignals > 0 ? "계약/법무 메일은 법무 또는 담당자 확인 필요 여부를 먼저 묻고 자동 발송하지 마세요." : "",
    stats.publicTaxSignals > 0 ? "공공/세무 메일은 제출 기한, 기관, 필수 서류를 한 카드로 묶고 최종 제출을 잠그세요." : "",
    stats.complaintEscalationSignals > 0 ? "클레임/긴급 메일은 사과/환불/책임 인정 표현을 별도 검토 대상으로 표시하세요." : "",
    stats.reservationOrderSignals > 0 ? "예약/주문 메일은 상태 확인과 안내 문구를 나누고 변경/취소 가능 여부를 묻도록 하세요." : "",
    stats.complianceUnsubscribeSignals > 0 ? "마케팅성 발송은 수신거부 제외와 필수 고지 문구가 확인되기 전까지 발송 후보를 잠그세요." : "",
    stats.customerInquirySignals > 0 ? "고객 문의 답변은 FAQ/이전 응대 기준과 비교하고, 확정 약속은 승인 전까지 초안으로 두세요." : "",
    stats.vendorProcurementSignals > 0 ? "구매/발주 메일은 조건 변경과 납기 약속을 별도 확인 카드로 분리하세요." : "",
    stats.hrRecruitingSignals > 0 ? "채용/인사 메일은 면접 일정과 개인정보 공유 범위를 분리하고 내부 공유를 잠그세요." : "",
    stats.documentSubmissionSignals > 0 ? "자료 제출 메일은 첨부 누락, 최신 파일, 권한 범위를 제출 전 체크리스트로 두세요." : "",
    stats.securityAccountAlertSignals > 0 ? "보안/계정 알림은 링크 클릭 대신 공식 연결/계정 보관함 확인으로 안내하세요." : "",
    stats.internalCollaborationSignals > 0 ? "내부 협업 메일은 담당자와 마감, 후속 작업을 업무 카드로 남기세요." : "",
    stats.threadContextSignals > 0 ? "긴 스레드는 최신 요청, 과거 결정, 첨부 근거를 분리한 뒤 답장 초안을 만드세요." : "",
    stats.deliveryFailureSignals > 0 ? "반송/발송 실패는 자동 재발송하지 말고 주소 수정, 첨부 축소, 대체 연락 후보로 분리하세요." : "",
    stats.outOfOfficeSignals > 0 ? "부재중/자동응답은 즉시 추가 발송 대신 재시도 날짜와 대체 담당자 확인으로 넘기세요." : "",
    stats.sentHistoryAuditSignals > 0 ? "처리 이력은 누가 무엇을 승인했는지, 실제 외부 실행 여부와 되돌림 기준을 함께 남기세요." : "",
    stats.mailInfoDigestSignals > 0 ? "메일 요약 전달은 원문/주소/민감정보를 그대로 공유하지 않고 승인함에서 제외 기준을 먼저 확인하게 하세요." : "",
    stats.totalMessages > 0 && stats.workItems === 0 ? "최신 메일에는 바로 처리할 업무 신호가 적습니다. 검색어/메일함 범위를 넓혀 다시 점검하세요." : "",
    stats.totalMessages === 0 ? "연결 직후에는 읽을 메일이 없을 수 있습니다. 받은편지함 범위나 IMAP 접근 권한을 확인하세요." : "",
  ]);

  const automationOpportunities = unique([
    stats.replyCandidates > 0 ? "문의 답장 초안 생성" : "",
    stats.calendarCandidates > 0 ? "일정 후보 생성과 충돌 시간 확인" : "",
    stats.reviewItems > 0 ? "확인 필요 메일 요약 카드 생성" : "",
    stats.ignoredItems > 0 ? "광고/공지 자동 제외 규칙" : "",
    stats.attachmentSignals > 0 ? "첨부파일 읽기와 근거 요약" : "",
    stats.recipientSourceSignals > 0 ? "첨부/엑셀 명단 기반 발송 대상 원천 검토" : "",
    stats.followUpSignals > 0 ? "회신 대기/마감 메일 후속 확인 계획" : "",
    stats.recipientDecisionSignals > 0 ? "수신자 후보 추천과 발송 대상 검토" : "",
    stats.bulkMailSignals > 0 ? "대량 메일 대상 분리, 개인화 초안, 승인 전 발송 목록 검토" : "",
    stats.quoteProposalSignals > 0 ? "견적/제안 조건 체크리스트와 답장 초안" : "",
    stats.invoicePaymentSignals > 0 ? "정산/청구 금액 확인과 증빙 후속 추적" : "",
    stats.contractLegalSignals > 0 ? "계약/법무 검토 체크리스트와 수정 요청 초안" : "",
    stats.publicTaxSignals > 0 ? "공공/세무 제출 기한과 서류 확인 카드" : "",
    stats.complaintEscalationSignals > 0 ? "클레임 우선순위 분류와 안전 응대 초안" : "",
    stats.reservationOrderSignals > 0 ? "예약/주문 상태 확인과 안내 답장 초안" : "",
    stats.complianceUnsubscribeSignals > 0 ? "수신거부/마케팅 고지 준수 체크" : "",
    stats.customerInquirySignals > 0 ? "고객/상담 문의 답변 초안과 담당자 확인" : "",
    stats.vendorProcurementSignals > 0 ? "구매/발주 조건 체크리스트" : "",
    stats.hrRecruitingSignals > 0 ? "채용/인사 회신과 면접 일정 후보" : "",
    stats.documentSubmissionSignals > 0 ? "자료/보고서 제출 전 파일 체크" : "",
    stats.securityAccountAlertSignals > 0 ? "보안/계정 알림 공식 확인 경로" : "",
    stats.internalCollaborationSignals > 0 ? "내부 협업 담당자/마감 업무 카드" : "",
    stats.threadContextSignals > 0 ? "스레드 맥락 재구성과 최신 요청 분리" : "",
    stats.deliveryFailureSignals > 0 ? "반송/발송 실패 원인 분석과 재발송 전 점검" : "",
    stats.outOfOfficeSignals > 0 ? "부재중/자동응답 후속 확인 후보 생성" : "",
    stats.sentHistoryAuditSignals > 0 ? "처리 이력/승인 감사 기록 요약" : "",
    stats.mailInfoDigestSignals > 0 ? "중요 메일 요약, 확인 필요 정보, 전달 후보 메시지 생성" : "",
    candidates.some((candidate) => candidate.shouldNotifyUserImmediately) ? "긴급/즉시 확인 알림" : "",
  ]);

  const replyToneGuidance = unique([
    input.writingProfile?.toneLabel ? `답장 톤은 '${input.writingProfile.toneLabel}'을 기본값으로 둡니다.` : "",
    input.writingProfile?.formatLabel ? `답장 형식은 '${input.writingProfile.formatLabel}'에 맞춰 초안을 만듭니다.` : "",
    stats.replyCandidates > 0 ? "메일 내용은 바로 발송하지 않고, 사용자가 자연스럽게 고칠 수 있는 초안 상태로 먼저 보여줍니다." : "",
    stats.reviewItems > 0 ? "정보가 부족한 메일은 답장을 단정하지 않고 확인 질문을 먼저 제안합니다." : "",
  ]);

  const scheduleGuidance = unique([
    input.writingProfile?.calendarPreference
      ? `일정 추천은 '${input.writingProfile.calendarPreference}' 기준으로 후보를 좁힙니다.`
      : "",
    stats.calendarCandidates > 0 ? "일정 조율 메일은 가능한 시간 후보와 충돌 확인 상태를 함께 보여줍니다." : "",
    report?.calendarBusyWindows?.length
      ? `연결된 캘린더의 바쁜 시간 ${report.calendarBusyWindows.length}개를 일정 후보 판단에 반영했습니다.`
      : "",
    stats.calendarCandidates > 0 && !report?.calendarBusyWindows?.length
      ? "캘린더가 아직 없으면 메일에서 후보만 만들고, 등록 직전에 캘린더 연결을 안내합니다."
      : "",
  ]);

  const connectionPreparation = unique([
    "메일 기능은 업무 탭에서 사용자가 선택할 때만 연결을 요청합니다.",
    "Gmail/Outlook은 가능하면 OAuth를 우선하고, 회사/NAVER/Daum/Kakao 메일은 2차 인증과 앱 비밀번호 준비 상태를 먼저 확인합니다.",
    "아이디, 비밀번호, 앱 비밀번호, token은 채팅에 쓰지 않고 계정 보관함이나 OS 보안 저장소에만 입력합니다.",
    "처음 연결은 메일 읽기 전용으로 시작하고, SMTP 발송이나 캘린더 쓰기는 최종 승인 단계에서 별도 권한으로 분리합니다.",
  ]);

  const recipientGuidance = unique([
    stats.recipientDecisionSignals > 0
      ? "수신자는 보낸 사람, reply-to, 스레드, 기존 거래처/고객 분류를 근거로 후보만 제안하고 사용자가 확정합니다."
      : "",
    "개인정보와 외부 수신자 주소는 분석 요약에 그대로 노출하지 않고 역할/그룹 라벨로 보여줍니다.",
    "여러 사람에게 보낼 때는 전체 명단, 제외 대상, 참조/숨은참조 기준을 발송 전 체크리스트로 분리합니다.",
  ]);

  const sendingPlanGuidance = unique([
    stats.replyCandidates > 0 ? "개별 답장은 사용자 말투를 반영한 초안, 근거, 수정 요청 버튼을 먼저 보여줍니다." : "",
    stats.bulkMailSignals > 0
      ? "대량 메일은 대상 그룹별 문안, 개인화 항목, 중복 수신자 제거, 발송 전 샘플 검토를 별도 단계로 둡니다."
      : "",
    stats.recipientSourceSignals > 0
      ? "엑셀/CSV/첨부 명단은 파일 원천, 중복 제거 기준, 제외 대상 확인을 통과한 뒤에만 발송 대상으로 씁니다."
      : "",
    "외부 발송은 항상 초안 생성, 수신자/첨부/본문 검토, 최종 사용자 확인 순서로만 진행합니다.",
    "사용자가 말한 발송 의도가 모호하면 바로 발송 후보를 만들지 않고 누구에게 보내는지부터 질문합니다.",
  ]);

  const learningSignals = unique([
    stats.totalMessages > 0 ? "보낸 사람 역할, 메일 제목 표현, 요청 유형, 마감/일정 표현을 업무 기억으로 축적합니다." : "",
    stats.replyCandidates > 0 ? "승인 또는 수정된 답장 초안을 사용자 말투와 금지 표현 학습 신호로 저장합니다." : "",
    stats.calendarCandidates > 0 ? "자주 제안되는 요일, 시간대, 회의 길이, 준비 자료를 일정 추천 기준으로 저장합니다." : "",
    stats.attachmentSignals > 0 ? "첨부파일 종류와 누락 자료 요청 패턴을 파일/문서 자동화와 연결합니다." : "",
    stats.recipientSourceSignals > 0 ? "엑셀/CSV/첨부 명단을 어떤 대상 그룹과 연결했는지 학습 항목으로 남깁니다." : "",
    stats.followUpSignals > 0 ? "회신 대기, 마감, 리마인드 주기를 후속 확인 기준으로 저장합니다." : "",
    stats.ignoredItems > 0 ? "광고, 공지, 시스템 알림 제외 기준을 쌓아 업무 인박스 잡음을 줄입니다." : "",
    stats.bulkMailSignals > 0 ? "대량 발송 대상 그룹, 제외 규칙, 개인화 변수, 승인 체크리스트를 별도 학습 항목으로 남깁니다." : "",
    stats.quoteProposalSignals > 0 ? "견적 조건, 유효기간, 자주 붙이는 자료를 다음 견적 답장 기준으로 저장합니다." : "",
    stats.invoicePaymentSignals > 0 ? "정산 주기, 금액 확인 항목, 증빙 파일 기준을 다음 청구 메일 처리 기준으로 저장합니다." : "",
    stats.contractLegalSignals > 0 ? "계약 유형, 검토 담당자, 확인 조항을 고위험 업무 기억으로 저장합니다." : "",
    stats.publicTaxSignals > 0 ? "기관별 제출 양식, 마감 표현, 필수 서류 목록을 업무 기억으로 저장합니다." : "",
    stats.complaintEscalationSignals > 0 ? "클레임 유형, 응대 금지 표현, 긴급도 기준을 다음 응대에 반영합니다." : "",
    stats.reservationOrderSignals > 0 ? "예약/주문 안내 문구, 변경/취소 기준, 상태 확인 순서를 저장합니다." : "",
    stats.complianceUnsubscribeSignals > 0 ? "수신거부 제외 규칙과 마케팅 고지 문구를 대량 발송 안전 기준으로 저장합니다." : "",
    stats.customerInquirySignals > 0 ? "고객 문의 유형, 자주 쓰는 답변, 담당자 배정 기준을 저장합니다." : "",
    stats.vendorProcurementSignals > 0 ? "거래처별 발주 양식, 납기, 조건 확인 순서를 저장합니다." : "",
    stats.hrRecruitingSignals > 0 ? "채용/인사 회신 문체, 면접 일정 기준, 개인정보 차단 기준을 저장합니다." : "",
    stats.documentSubmissionSignals > 0 ? "제출 파일 종류, 저장 위치, 제출 전 체크리스트를 저장합니다." : "",
    stats.securityAccountAlertSignals > 0 ? "계정별 보안 알림 패턴과 의심 알림 대응 순서를 저장합니다." : "",
    stats.internalCollaborationSignals > 0 ? "팀별 담당자, 반복 요청, 내부 공유 형식을 저장합니다." : "",
    stats.threadContextSignals > 0 ? "스레드별 최신 요청, 이전 약속, 참조 변경 기준을 저장합니다." : "",
    stats.deliveryFailureSignals > 0 ? "반복 반송 주소, provider 오류, 첨부 용량 제한과 재시도 기준을 저장합니다." : "",
    stats.outOfOfficeSignals > 0 ? "상대 부재 기간, 대체 담당자, 재시도 시점을 후속 확인 기준으로 저장합니다." : "",
    stats.sentHistoryAuditSignals > 0 ? "처리 방식, 승인 기록, 되돌림 기준을 다음 메일 업무 학습 신호로 저장합니다." : "",
    stats.mailInfoDigestSignals > 0 ? "보고 형식, 전달 대상, 민감정보 제외 기준을 다음 요약 전달 기준으로 저장합니다." : "",
    stats.mobileReviewHandoffSignals > 0 ? "휴대폰에서 바로 볼 메일 유형, 알림 시간, 승인/보류 습관을 모바일 검토 기준으로 저장합니다." : "",
  ]);

  const approvalPolicy = unique([
    stats.replyCandidates > 0 ? "메일 발송은 초안 보기, 수정 요청, 최종 승인 뒤에만 실행합니다." : "",
    stats.calendarCandidates > 0 ? "캘린더 등록은 가능한 시간과 참석자 확인 뒤에만 실행합니다." : "",
    stats.bulkMailSignals > 0 ? "대량 발송은 샘플 문안과 전체 수신자 목록을 사용자가 확인하기 전까지 실행하지 않습니다." : "",
    stats.recipientSourceSignals > 0 ? "첨부/엑셀 명단은 원문 주소를 요약에 노출하지 않고, 명단 검토 완료 전까지 발송 대상으로 쓰지 않습니다." : "",
    stats.followUpSignals > 0 ? "후속 추적은 알림/초안 후보만 만들고 자동 독촉 발송은 하지 않습니다." : "",
    stats.invoicePaymentSignals > 0 ? "정산, 결제, 환불, 세금계산서 관련 메일은 금액/증빙 확인 전까지 외부 발송하지 않습니다." : "",
    stats.contractLegalSignals > 0 ? "계약/법무 메일은 법적 조건과 책임 표현을 사용자 또는 담당자가 확인하기 전까지 발송하지 않습니다." : "",
    stats.publicTaxSignals > 0 ? "공공기관/세무 제출은 최종 제출 여부를 사용자가 확인하기 전까지 실행하지 않습니다." : "",
    stats.complaintEscalationSignals > 0 ? "클레임/환불/보상 응대는 책임 인정 또는 금전 조건 표현을 별도 확인 전까지 발송하지 않습니다." : "",
    stats.complianceUnsubscribeSignals > 0 ? "광고성/대량 발송은 수신거부 제외와 필수 고지 문구 확인 전까지 실행하지 않습니다." : "",
    stats.customerInquirySignals > 0 ? "고객 문의 답변은 확정 약속과 가격/보상 표현을 사용자 확인 전까지 발송하지 않습니다." : "",
    stats.vendorProcurementSignals > 0 ? "발주 확정, 납기 약속, 조건 변경은 담당자 확인 전까지 외부 발송하지 않습니다." : "",
    stats.hrRecruitingSignals > 0 ? "채용/인사 개인정보와 평가 내용은 승인 전 외부 공유하지 않습니다." : "",
    stats.documentSubmissionSignals > 0 ? "파일 첨부, 보고서 제출, 공유 권한 변경은 승인 전 실행하지 않습니다." : "",
    stats.securityAccountAlertSignals > 0 ? "보안/계정 알림은 비밀번호, 인증코드, token을 채팅에 쓰지 않고 공식 화면에서 확인합니다." : "",
    stats.internalCollaborationSignals > 0 ? "내부 협업 메일도 외부 공유, 파일 변경, 자동 회신은 승인 전까지 잠급니다." : "",
    stats.threadContextSignals > 0 ? "스레드 메일은 최신 요청과 과거 내용을 분리하기 전까지 답장 기준을 확정하지 않습니다." : "",
    stats.deliveryFailureSignals > 0 ? "반송/발송 실패 메일은 실패 원인과 수정 수신자를 확인하기 전까지 자동 재발송하지 않습니다." : "",
    stats.outOfOfficeSignals > 0 ? "부재중/자동응답에는 즉시 추가 발송하지 않고 후속 후보와 대체 담당자 확인으로만 처리합니다." : "",
    stats.sentHistoryAuditSignals > 0 ? "처리 이력/승인 기록에는 원문 주소와 비밀값 대신 결정 라벨, 감사 파일, 되돌림 기준만 남깁니다." : "",
    stats.mailInfoDigestSignals > 0 ? "메일 요약, 팀 공유, 사용자 전달은 승인 전 후보만 만들고 민감정보 제외 기준을 먼저 확인합니다." : "",
    stats.mobileReviewHandoffSignals > 0 ? "휴대폰 알림은 요약과 결정 후보만 보내고, 실제 메일 전송은 앱 최종 확인 전까지 실행하지 않습니다." : "",
    stats.approvalCandidates > 0 ? "외부로 나가는 작업은 모두 approvalQueue에 잠그고 finalUserPresence=true 전에는 실행하지 않습니다." : "",
    "사용자의 비밀번호, token, 원문 메일은 채팅 응답에 노출하지 않습니다.",
  ]);

  const riskNotes = unique([
    "메일 원문, 보낸 사람 주소, 비밀번호는 분석 결과에 그대로 노출하지 않습니다.",
    stats.approvalCandidates > 0 ? "메일 발송이나 일정 등록은 후보만 만들고 사용자 승인 전에는 실행하지 않습니다." : "",
    stats.reviewItems > 0 ? "분류가 애매한 메일은 자동 처리하지 말고 확인 필요로 남겨야 합니다." : "",
    stats.recipientSourceSignals > 0 ? "첨부 명단은 파일 권한, 최신 여부, 중복/제외 기준을 확인하기 전까지 발송에 쓰면 안 됩니다." : "",
    stats.invoicePaymentSignals > 0 || stats.contractLegalSignals > 0 || stats.publicTaxSignals > 0
      ? "정산/계약/공공기관 메일은 초안과 체크리스트까지만 만들고 제출/발송은 최종 확인 뒤에만 합니다."
      : "",
    stats.complaintEscalationSignals > 0 ? "긴급/클레임 메일은 빠른 처리보다 잘못된 책임 인정과 환불 약속을 피하는 것이 우선입니다." : "",
    stats.securityAccountAlertSignals > 0 ? "보안/계정 알림은 피싱 가능성을 고려해 링크 클릭보다 공식 연결 화면 확인이 우선입니다." : "",
    stats.hrRecruitingSignals > 0 ? "채용/인사 메일은 개인정보와 평가 내용을 요약에도 과하게 노출하지 않아야 합니다." : "",
    stats.threadContextSignals > 0 ? "오래된 스레드 내용을 최신 결정처럼 답장하면 안 되며 최신 요청 기준을 다시 확인해야 합니다." : "",
    stats.deliveryFailureSignals > 0 ? "반송/발송 실패 후 재발송은 중복 발송 위험이 있어 dry-run과 사용자 확인이 필요합니다." : "",
    stats.outOfOfficeSignals > 0 ? "부재중 자동응답은 실제 요청이 아닐 수 있어 업무 후보 대신 후속 확인 후보로 분리해야 합니다." : "",
    stats.sentHistoryAuditSignals > 0 ? "처리 이력은 감사 목적의 최소 정보만 남기고 원문 주소와 인증값을 저장하지 않아야 합니다." : "",
    stats.mailInfoDigestSignals > 0 ? "요약 전달 후보에는 원문 메일, 실제 주소, 민감정보를 그대로 넣지 않아야 합니다." : "",
    stats.mobileReviewHandoffSignals > 0 ? "휴대폰 알림에는 원문 본문과 실제 주소를 길게 노출하지 말고 앱에서 상세 확인으로 이어야 합니다." : "",
  ]);
  const scenarioCoverage = analyzeMailWorkScenarioCoverage({
    ...(input.providerRead ? { providerRead: input.providerRead } : {}),
    ...(report ? { workReport: report } : {}),
    stats,
  });
  const bulkSendPlan = createBulkSendPlan(messages, stats);
  const followUpPlan = createFollowUpPlan(messages, stats);
  const recipientSourcePlan = createRecipientSourcePlan(messages, stats);
  const recipientCopyPlan = createRecipientCopyPlan(messages, stats);
  const connectionReadinessPlan = createConnectionReadinessPlan(stats, scenarioCoverage);
  const contentLearningSignals = deriveMailContentLearningSignals(messages);

  return {
    summary: createSummary(stats),
    workingStyle: withFallback(workingStyle, "아직 뚜렷한 업무 패턴을 만들 만큼의 메일 신호가 적습니다."),
    improvementSuggestions: withFallback(improvementSuggestions, "메일함 범위와 연결 권한을 확인한 뒤 다시 업무 분석을 실행하세요."),
    automationOpportunities: withFallback(automationOpportunities, "최신 메일 점검과 업무 카드 생성"),
    replyToneGuidance: withFallback(replyToneGuidance, "답장 톤은 사용자 설정과 기존 업무 기억을 우선해서 초안으로만 제안합니다."),
    scheduleGuidance: withFallback(scheduleGuidance, "일정 후보는 메일에서 감지하되 캘린더 등록은 사용자 승인 전까지 실행하지 않습니다."),
    connectionPreparation,
    recipientGuidance: withFallback(recipientGuidance, "수신자와 발송 대상은 사용자가 확인하기 전까지 후보로만 둡니다."),
    sendingPlanGuidance: withFallback(sendingPlanGuidance, "메일 발송은 초안, 수신자 확인, 최종 승인 순서로만 진행합니다."),
    learningSignals: withFallback(learningSignals, "사용자가 승인하거나 수정한 업무 방식을 다음 메일 처리 기준으로 학습합니다."),
    contentLearningSignals,
    scenarioCoverage,
    connectionReadinessPlan,
    ...(bulkSendPlan.status === "review_required" ? { bulkSendPlan } : {}),
    ...(followUpPlan.status === "review_required" ? { followUpPlan } : {}),
    ...(recipientSourcePlan.status === "review_required" ? { recipientSourcePlan } : {}),
    ...(recipientCopyPlan.status === "review_required" ? { recipientCopyPlan } : {}),
    approvalPolicy,
    riskNotes,
    stats,
    privacyBoundary:
      "메일 업무 분석은 read-only snapshot에서 집계 신호만 만들며, 원문 메일/주소/비밀번호/2차 인증값을 분석 결과로 반환하지 않습니다.",
  };
}

function createFollowUpPlan(
  messages: ModyProviderMailReadOutput["messages"],
  stats: ModyMailWorkPatternAnalysis["stats"],
): ModyMailFollowUpPlan {
  if (stats.followUpSignals === 0) {
    return {
      status: "not_detected",
      waitingSignals: [],
      suggestedCadence: [],
      nextCheckLabel: "",
      approvalGate: "후속 추적 신호가 없어서 별도 확인 계획을 만들지 않았습니다.",
      privacyBoundary: "후속 계획은 원문 주소와 메일 본문을 반환하지 않습니다.",
    };
  }

  const text = messages.map(messageText).join("\n");
  return {
    status: "review_required",
    waitingSignals: inferFollowUpSignals(text),
    suggestedCadence: [
      "오늘 처리할 메일은 업무 탭에서 먼저 확인",
      "회신 대기는 다음 영업일에 상태만 재점검",
      "마감/기한 메일은 마감 전 1회 리마인드 후보로 보류",
    ],
    nextCheckLabel: inferNextCheckLabel(text),
    approvalGate: "후속 추적은 알림 후보와 리마인드 초안만 만들고, 자동 독촉 발송은 사용자 승인 전까지 실행하지 않습니다.",
    privacyBoundary: "후속 추적 계획은 상대 주소, 원문 메일, 전화번호를 노출하지 않고 업무 상태 라벨만 저장합니다.",
  };
}

function createRecipientSourcePlan(
  messages: ModyProviderMailReadOutput["messages"],
  stats: ModyMailWorkPatternAnalysis["stats"],
): ModyMailRecipientSourcePlan {
  if (stats.recipientSourceSignals === 0) {
    return {
      status: "not_detected",
      sourceTypes: [],
      fileReviewChecklist: [],
      matchingRules: [],
      approvalGate: "첨부/엑셀 명단 신호가 없어서 별도 명단 원천 계획을 만들지 않았습니다.",
      privacyBoundary: "명단 원천 계획은 주소 목록을 반환하지 않습니다.",
    };
  }

  const text = messages.map(messageText).join("\n");
  return {
    status: "review_required",
    sourceTypes: inferRecipientSourceTypes(messages, text),
    fileReviewChecklist: [
      "첨부/엑셀/CSV 파일의 최신 여부 확인",
      "수신 거부, 중복, 제외 대상 열 확인",
      "개인화에 필요한 이름/기관/일정/금액 열 확인",
      "샘플 3-5명 dry-run 문안 확인",
      "전체 주소 목록은 승인 화면에서만 확인",
    ],
    matchingRules: [
      "메일 스레드의 요청 목적과 명단 파일의 대상 그룹을 맞춥니다.",
      "역할/그룹 라벨만 요약하고 원문 주소는 채팅에 노출하지 않습니다.",
      "중복 주소와 제외 대상이 남아 있으면 발송 후보를 잠급니다.",
    ],
    approvalGate: "첨부/엑셀 명단은 파일 검토, 제외 규칙, 샘플 문안 확인 전까지 발송 대상에 반영하지 않습니다.",
    privacyBoundary: "명단 원천 계획은 파일명/주소 원문 대신 소스 유형과 검토 규칙만 반환합니다.",
  };
}

function createRecipientCopyPlan(
  messages: ModyProviderMailReadOutput["messages"],
  stats: ModyMailWorkPatternAnalysis["stats"],
): ModyMailRecipientCopyPlan {
  if (stats.recipientDecisionSignals === 0 && stats.bulkMailSignals === 0 && stats.replyCandidates === 0) {
    return {
      status: "not_detected",
      sendTargetRules: [],
      ccReviewRules: [],
      bccReviewRules: [],
      holdReviewRules: [],
      approvalGate: "수신자/참조 판단 신호가 없어서 별도 참조/숨은참조 계획을 만들지 않았습니다.",
      privacyBoundary: "참조/숨은참조 계획은 원문 주소를 반환하지 않습니다.",
    };
  }

  const text = messages.map(messageText).join("\n");
  return {
    status: "review_required",
    sendTargetRules: inferSendTargetRules(text),
    ccReviewRules: inferCcReviewRules(text),
    bccReviewRules: inferBccReviewRules(text),
    holdReviewRules: [
      "원문 이메일 주소가 2개 이상이면 받는 사람/참조/숨은참조를 직접 확인",
      "외부 고객, 내부 팀, 거래처가 섞이면 발송 전 보류",
      "전체/단체/대량 표현이 있으면 숨은참조 또는 명단 검토로 전환",
    ],
    approvalGate: "받는 사람, 참조, 숨은참조, 전체 발송 여부는 사용자가 확인하기 전까지 확정하지 않습니다.",
    privacyBoundary: "참조/숨은참조 계획은 원문 주소와 개인 이름을 반환하지 않고 역할/그룹 라벨과 확인 규칙만 제공합니다.",
  };
}

function createSummary(stats: ModyMailWorkPatternAnalysis["stats"]): string {
  if (stats.totalMessages === 0) {
    return "메일 연결은 준비됐지만 최신 메일 분석 결과는 아직 비어 있습니다.";
  }

  return [
    `최신 메일 ${stats.totalMessages}건을 읽어 업무 후보 ${stats.workItems}건을 만들었습니다.`,
    `답장 후보 ${stats.replyCandidates}건, 일정 후보 ${stats.calendarCandidates}건, 확인 필요 ${stats.reviewItems}건입니다.`,
    stats.ignoredItems > 0 ? `업무와 무관한 잡음 ${stats.ignoredItems}건은 분리했습니다.` : "",
  ].filter(Boolean).join(" ");
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function withFallback(values: string[], fallback: string): string[] {
  return values.length > 0 ? values : [fallback];
}

function createConnectionReadinessPlan(
  stats: ModyMailWorkPatternAnalysis["stats"],
  scenarioCoverage: ModyMailWorkScenarioCoverage[],
): ModyMailConnectionReadinessPlan {
  const observedWorkCases = scenarioCoverage
    .filter((scenario) => scenario.status === "observed")
    .map((scenario) => scenario.label);
  const workCaseLabels = withFallback(unique([
    ...observedWorkCases.slice(0, 6),
    stats.replyCandidates > 0 ? "답장 초안" : "",
    stats.calendarCandidates > 0 ? "일정 조율" : "",
    stats.bulkMailSignals > 0 ? "대량 메일 발송 준비" : "",
    stats.recipientDecisionSignals > 0 ? "수신자/참조 판단" : "",
    stats.securityAccountAlertSignals > 0 ? "보안/계정 알림" : "",
  ]), "메일 업무 보기");

  return {
    status: "review_required",
    workCaseLabels,
    providerOptions: unique([
      "Gmail/Outlook은 OAuth 동의 연결을 우선 확인",
      "회사/NAVER/Daum/Kakao 메일은 IMAP/SMTP 사용 가능 여부와 앱 비밀번호 필요 여부 확인",
      stats.calendarCandidates > 0 ? "일정 업무가 있으면 캘린더 읽기 권한을 먼저 확인하고 쓰기 권한은 등록 직전에 분리" : "",
      stats.recipientSourceSignals > 0 || stats.bulkMailSignals > 0 ? "명단/첨부 업무는 메일 계정과 파일 위치를 따로 확인" : "",
    ]),
    vaultInputs: [
      "메일 사이트 링크 또는 provider 이름",
      "메일 주소/아이디",
      "앱 비밀번호 또는 OAuth 동의 참조",
      "명단 파일 위치와 제외 규칙은 원문 주소 없이 별도 보관",
    ],
    twoFactorChecklist: unique([
      "2차 인증이 켜져 있는지 공식 계정 화면에서 확인",
      "일반 비밀번호가 막히면 앱 비밀번호를 새로 발급",
      "OAuth 연결은 브라우저 동의 흐름으로 처리하고 token 원문은 분석 결과에 반환하지 않음",
      "읽기 전용 IMAP 점검을 먼저 하고 SMTP 발송 권한은 최종 승인 직전에 확인",
      stats.calendarCandidates > 0 ? "캘린더 쓰기/초대 권한은 일정 등록 카드에서 별도 확인" : "",
    ]),
    permissionBoundaries: unique([
      "업무를 먼저 고른 뒤 필요한 계정만 연결",
      "처음에는 메일 읽기 전용으로 업무 후보만 생성",
      stats.replyCandidates > 0 ? "답장 발송은 초안/수신자/본문 확인 뒤 오피스 최종 승인 필요" : "",
      stats.bulkMailSignals > 0 ? "대량 발송은 대상표, 참조/숨은참조, 샘플 문안 확인 전까지 SMTP 실행 금지" : "",
      stats.calendarCandidates > 0 ? "캘린더 등록과 참석자 초대는 가능 시간 확인 뒤 별도 최종 승인 필요" : "",
      "비밀번호, token, 인증코드는 채팅/분석 결과에 노출하지 않음",
    ]),
    approvalGate: "메일 연결은 첫 화면에서 강요하지 않고, 사용자가 업무를 고른 뒤 보관함/2차 인증/읽기 전용 점검 순서로만 진행합니다.",
    privacyBoundary: "연결 준비 계획은 계정 종류와 체크리스트만 반환하며 비밀번호, token, 인증코드, 원문 이메일 주소는 반환하지 않습니다.",
  };
}

function createBulkSendPlan(
  messages: ModyProviderMailReadOutput["messages"],
  stats: ModyMailWorkPatternAnalysis["stats"],
): ModyMailBulkSendPlan {
  if (stats.bulkMailSignals === 0 && stats.recipientDecisionSignals === 0) {
    return {
      status: "not_detected",
      targetGroups: [],
      excludedGroups: [],
      personalizationFields: [],
      sampleReviewChecklist: [],
      approvalGate: "대량 발송 신호가 없어서 별도 발송 계획을 만들지 않았습니다.",
      privacyBoundary: "수신자 주소와 원문 명단은 분석 결과에 반환하지 않습니다.",
    };
  }

  const text = messages.map(messageText).join("\n");
  return {
    status: "review_required",
    targetGroups: inferBulkTargetGroups(text),
    excludedGroups: [
      "수신 거부 대상",
      "중복 주소",
      "최근 발송 완료 대상",
      "퇴사/이탈/권한 없는 대상",
    ],
    personalizationFields: inferBulkPersonalizationFields(text),
    sampleReviewChecklist: [
      "대상 그룹과 전체 명단 수 확인",
      "제외 대상과 중복 주소 확인",
      "샘플 문안과 개인화 값 확인",
      "참조/숨은참조 기준 확인",
      "최종 승인 전 dry-run 결과 확인",
    ],
    approvalGate:
      "대량 메일은 대상 명단, 제외 대상, 개인화 샘플을 사용자가 확인하기 전까지 발송하지 않습니다.",
    privacyBoundary:
      "대량 메일 계획은 역할/그룹 라벨만 반환하고 원문 주소, 비밀번호, 2차 인증값, 원문 명단을 노출하지 않습니다.",
  };
}

function inferBulkTargetGroups(text: string): string[] {
  const groups = [
    /학부모|보호자/iu.test(text) ? "학부모/보호자" : "",
    /회원|고객|수강생|이용자/iu.test(text) ? "회원/고객" : "",
    /거래처|협력사|업체|클라이언트/iu.test(text) ? "거래처/협력사" : "",
    /직원|팀원|임직원|전체\s*팀|부서/iu.test(text) ? "직원/팀" : "",
    /기관|담당자|공공기관|학교|병원/iu.test(text) ? "기관/담당자" : "",
    /멘토|강사|선생님|코치/iu.test(text) ? "멘토/강사" : "",
    /전체|단체|대량|일괄|broadcast|bulk/iu.test(text) ? "전체 발송 후보" : "",
  ];
  return withFallback(unique(groups), "발송 대상 후보 그룹");
}

function inferBulkPersonalizationFields(text: string): string[] {
  const fields = [
    /이름|성함|담당자/iu.test(text) ? "이름/담당자명" : "",
    /회사|기관|업체|학교|소속/iu.test(text) ? "회사/기관명" : "",
    /상담|예약|미팅|회의|일정|시간/iu.test(text) ? "예약/일정 정보" : "",
    /견적|정산|금액|입금|결제|청구/iu.test(text) ? "금액/정산 정보" : "",
    /마감|기한|제출|회신\s*기한/iu.test(text) ? "마감일/회신 기한" : "",
  ];
  return withFallback(unique(fields), "이름/역할과 업무 맥락");
}

function inferFollowUpSignals(text: string): string[] {
  const signals = [
    /마감|기한|deadline/iu.test(text) ? "마감/기한 확인" : "",
    /회신\s*대기|답변\s*대기|reply/iu.test(text) ? "회신 대기" : "",
    /리마인드|재안내|후속|remind|follow[-\s]?up/iu.test(text) ? "리마인드/재안내" : "",
    /제출|입금|결제|정산/iu.test(text) ? "제출/정산 후속 확인" : "",
  ];
  return withFallback(unique(signals), "다음 확인 필요");
}

function inferNextCheckLabel(text: string): string {
  if (/오늘|당일/iu.test(text)) return "오늘 안에 다시 확인";
  if (/내일|익일|다음\s*영업일/iu.test(text)) return "다음 영업일 확인";
  if (/마감|기한|deadline/iu.test(text)) return "마감 전 리마인드 후보";
  return "다음 업무 점검 때 확인";
}

function inferRecipientSourceTypes(
  messages: ModyProviderMailReadOutput["messages"],
  text: string,
): string[] {
  const sourceTypes = [
    messages.some((message) => message.hasAttachments === true) ? "첨부파일" : "",
    /엑셀|xlsx|xls/iu.test(text) ? "엑셀 명단" : "",
    /csv/iu.test(text) ? "CSV 명단" : "",
    /주소록|연락처/iu.test(text) ? "주소록/연락처" : "",
    /명단|리스트|목록|대상자/iu.test(text) ? "대상자 목록" : "",
  ];
  return withFallback(unique(sourceTypes), "명단 원천 후보");
}

function inferSendTargetRules(text: string): string[] {
  const rules = [
    /reply-to|회신|답장|보낸\s*사람/iu.test(text) ? "답장은 보낸 사람/reply-to를 기본 후보로 확인" : "",
    /고객|상담|학부모|회원/iu.test(text) ? "고객/상담/학부모 그룹은 직접 받는 사람 후보로 검토" : "",
    /거래처|협력사|업체|클라이언트/iu.test(text) ? "거래처/협력사는 담당자 기준으로 받는 사람 후보 검토" : "",
    /담당자|부서|팀|내부/iu.test(text) ? "담당자/내부 팀은 외부 발송 전 역할 확인" : "",
  ];
  return withFallback(unique(rules), "보낸 사람과 스레드 맥락을 받는 사람 후보로 검토");
}

function inferCcReviewRules(text: string): string[] {
  const rules = [
    /참조|cc/iu.test(text) ? "참조 요청이 있으면 관련 담당자와 내부 공유 범위 확인" : "",
    /팀|부서|담당자|매니저|관리자/iu.test(text) ? "팀/부서 공유는 참조 후보로만 두고 외부 공개 여부 확인" : "",
    /계약|정산|세금|공공기관|클레임/iu.test(text) ? "고위험 메일은 검토 담당자 참조 여부 확인" : "",
  ];
  return withFallback(unique(rules), "참조 대상은 담당자 공유 범위 확인 전까지 비워 둠");
}

function inferBccReviewRules(text: string): string[] {
  const rules = [
    /숨은\s*참조|bcc/iu.test(text) ? "숨은참조 표현이 있으면 주소 노출 방지 기준 확인" : "",
    /전체|단체|대량|일괄|뉴스레터|공지/iu.test(text) ? "여러 외부 대상 발송은 숨은참조 또는 명단 발송 방식 검토" : "",
    /수신거부|unsubscribe|광고성|마케팅/iu.test(text) ? "마케팅성 발송은 수신거부 제외와 필수 고지 확인" : "",
  ];
  return withFallback(unique(rules), "숨은참조는 전체/대량 발송일 때만 검토하고 기본값으로 자동 적용하지 않음");
}

function hasBulkMailSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(대량|단체|일괄|전체\s*발송|공지\s*발송|안내\s*발송|뉴스레터|명단|bcc|숨은\s*참조|bulk|broadcast|campaign)/iu.test(
    messageText(message),
  );
}

function hasRecipientDecisionSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(수신자|받는\s*사람|보낼\s*사람|발송\s*대상|참조|cc|bcc|명단|고객|거래처|학부모|회원|멘토|기관|담당자|reply-to)/iu.test(
    messageText(message),
  );
}

function hasFollowUpSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(마감|기한|회신\s*대기|답변\s*대기|리마인드|재안내|후속|제출|입금|정산|follow[-\s]?up|remind|deadline)/iu.test(
    messageText(message),
  );
}

function hasRecipientSourceSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return (
    message.hasAttachments === true ||
    /(첨부|엑셀|xlsx|xls|csv|명단|리스트|목록|주소록|연락처|대상자|수신자\s*목록|고객\s*목록)/iu.test(messageText(message))
  );
}

function hasQuoteProposalSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(견적|견적서|단가|제안서|제안|납기|발주|proposal|quote|estimate)/iu.test(messageText(message));
}

function hasInvoicePaymentSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(세금계산서|계산서|정산|입금|결제|청구|영수증|송금|환불|invoice|payment|billing)/iu.test(messageText(message));
}

function hasContractLegalSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(계약|계약서|약관|NDA|비밀유지|서명|날인|법무|조항|contract|legal|signature)/iu.test(messageText(message));
}

function hasPublicTaxSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(공공기관|관공서|정부|국세청|홈택스|세무|신고|지원사업|보조금|제출|hometax|tax)/iu.test(messageText(message));
}

function hasComplaintEscalationSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(클레임|불만|항의|장애|오류|긴급|환불|취소|컴플레인|escalat|urgent|complaint)/iu.test(messageText(message));
}

function hasReservationOrderSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(예약|상담\s*예약|방문|주문|배송|출고|픽업|변경|booking|reservation|order|delivery)/iu.test(messageText(message));
}

function hasComplianceUnsubscribeSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(수신거부|구독\s*해지|unsubscribe|opt[-\s]?out|마케팅\s*동의|광고성|개인정보|privacy)/iu.test(messageText(message));
}

function hasCustomerInquirySignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(문의|상담|질문|고객|답변\s*요청|확인\s*부탁|inquiry|question|support)/iu.test(messageText(message));
}

function hasVendorProcurementSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(구매|발주|납품|재고|거래처|공급|품목|수량|purchase|procurement|supplier|vendor)/iu.test(messageText(message));
}

function hasHrRecruitingSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(채용|지원자|면접|이력서|근태|휴가|급여|인사|recruit|interview|hr)/iu.test(messageText(message));
}

function hasDocumentSubmissionSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(자료|보고서|제출|증빙|첨부|공유|파일|서류|document|report|submit|attachment)/iu.test(messageText(message));
}

function hasSecurityAccountAlertSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(보안|로그인|비밀번호|2차\s*인증|인증코드|권한|토큰|계정|security|login|password|2fa|otp|token)/iu.test(messageText(message));
}

function hasInternalCollaborationSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(내부|팀|부서|공유|협업|회람|승인\s*요청|업무\s*요청|공지|collaboration|internal|team)/iu.test(messageText(message));
}

function hasThreadContextSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(스레드|이전\s*메일|이전\s*회신|전달|FW:|Fwd:|Re:|참조\s*변경|reply\s*chain|thread)/iu.test(messageText(message));
}

function hasDeliveryFailureSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(반송|발송\s*실패|전송\s*실패|메일\s*실패|주소\s*오류|수신\s*불가|메일함\s*가득|bounce|undeliver|delivery\s*failed|smtp\s*error)/iu.test(
    messageText(message),
  );
}

function hasOutOfOfficeSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(부재중|자동\s*응답|휴가|자리\s*비움|대체\s*담당자|out\s*of\s*office|auto[-\s]?reply|vacation)/iu.test(messageText(message));
}

function hasSentHistoryAuditSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(처리\s*이력|발송\s*이력|감사\s*기록|승인\s*기록|로그|되돌리기|audit|history|receipt|rollback)/iu.test(messageText(message));
}

function hasMailInfoDigestSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(요약|보고|전달|공유\s*후보|처리\s*현황|확인\s*필요\s*정보|digest|summary|brief|forward\s*candidate|status\s*update)/iu.test(
    messageText(message),
  );
}

function hasMobileReviewHandoffSignal(message: ModyProviderMailReadOutput["messages"][number]): boolean {
  return /(휴대폰|핸드폰|모바일|푸시|알림|텔레그램|카카오|문자|앱에서\s*확인|밖에서\s*확인|phone|mobile|push|telegram|sms)/iu.test(
    messageText(message),
  );
}

function messageText(message: ModyProviderMailReadOutput["messages"][number]): string {
  return [
    message.subject,
    message.snippet,
    message.from,
    message.mailboxId,
    ...(message.labels ?? []),
  ].filter(Boolean).join(" ");
}

/** 인사말/조사/공통 필러 등 주제어로서 의미가 낮은 토큰. 업무 키워드(상담/견적/문의 등)는 일부러 남긴다. */
const MAIL_TOPIC_STOPWORDS = new Set<string>([
  "안녕하세요", "안녕", "감사합니다", "감사", "드립니다", "드려요", "합니다", "입니다", "습니다",
  "메일", "관련", "관련하여", "님께", "귀하", "저희", "제가", "하기", "위해",
  "the", "and", "for", "you", "your", "with", "this", "that", "from", "have", "are", "was",
  "please", "thanks", "thank", "hello", "regards", "dear", "the", "mail", "email",
]);

/**
 * 실제 읽은 메일에서 파생한 학습 신호를 만든다(템플릿 아님).
 * 개인정보 보호: 발신자는 전체 주소 대신 도메인만, 본문/제목은 PII를 지운 뒤 주제어만 남긴다.
 */
function deriveMailContentLearningSignals(messages: ModyProviderMailReadOutput["messages"]): string[] {
  if (messages.length === 0) return [];
  const signals: string[] = [];
  const domains = topSenderDomains(messages, 4);
  if (domains.length) signals.push(`자주 받은 발신 도메인: ${domains.join(", ")}`);
  const keywords = topTopicKeywords(messages, 6);
  if (keywords.length) signals.push(`이번 메일 주요 주제어: ${keywords.join(", ")}`);
  const senderCount = new Set(
    messages
      .map((message) => (typeof message.from === "string" ? message.from.trim().toLowerCase() : ""))
      .filter(Boolean),
  ).size;
  if (senderCount > 0) signals.push(`발신자 ${senderCount}곳에서 최신 메일 ${messages.length}건`);
  return signals;
}

function topSenderDomains(messages: ModyProviderMailReadOutput["messages"], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const from = typeof message.from === "string" ? message.from : "";
    const at = from.lastIndexOf("@");
    if (at < 0) continue;
    const domain = from
      .slice(at + 1)
      .trim()
      .toLowerCase()
      .replace(/[>\s].*$/, "");
    if (!/^[a-z0-9.-]{3,253}$/.test(domain) || domain.includes("..")) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return rankByCount(counts, limit);
}

function topTopicKeywords(messages: ModyProviderMailReadOutput["messages"], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const text = redactPreviewPII([message.subject, message.snippet].filter(Boolean).join(" "));
    for (const token of text.toLowerCase().match(/[가-힣]{2,}|[a-z]{3,}/g) ?? []) {
      if (MAIL_TOPIC_STOPWORDS.has(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return rankByCount(counts, limit);
}

function redactPreviewPII(text: string): string {
  return text
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, " ")
    .replace(/\b(?:\+?82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, " ")
    .replace(/\b\d[\d-]{5,}\b/g, " ");
}

function rankByCount(counts: Map<string, number>, limit: number): string[] {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, Math.max(0, limit))
    .map(([value]) => value);
}
