import type { ModyProviderMailReadOutput } from "./provider-read-adapter.js";
import type { ModyProviderWorkIntakeReport } from "./provider-work-intake.js";

export type ModyMailWorkScenarioId =
  | "connection_preflight"
  | "read_only_intake"
  | "inbound_triage"
  | "customer_inquiry"
  | "vendor_procurement"
  | "hr_recruiting"
  | "document_submission"
  | "security_account_alert"
  | "internal_collaboration"
  | "thread_context_reconstruction"
  | "delivery_failure_bounce"
  | "out_of_office_auto_reply"
  | "sent_history_audit"
  | "mail_info_digest"
  | "mobile_review_handoff"
  | "reply_draft"
  | "calendar_coordination"
  | "recipient_selection"
  | "bulk_mail"
  | "quote_proposal"
  | "invoice_payment"
  | "contract_legal"
  | "public_tax"
  | "complaint_escalation"
  | "reservation_order"
  | "compliance_unsubscribe"
  | "attachment_followup"
  | "noise_filter"
  | "high_risk_approval"
  | "follow_up_tracking"
  | "work_memory_learning";

export type ModyMailWorkScenarioStatus = "observed" | "ready" | "needs_setup";

export type ModyMailWorkScenarioDefinition = {
  id: ModyMailWorkScenarioId;
  label: string;
  purpose: string;
  userDecision: string;
  safetyGate: string;
  learningValue: string;
};

export type ModyMailWorkScenarioCoverage = ModyMailWorkScenarioDefinition & {
  status: ModyMailWorkScenarioStatus;
  evidenceCount: number;
  guidance: string;
  nextAction: string;
};

export type ModyMailWorkScenarioStats = {
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
  followUpSignals?: number;
  recipientSourceSignals?: number;
  quoteProposalSignals?: number;
  invoicePaymentSignals?: number;
  contractLegalSignals?: number;
  publicTaxSignals?: number;
  complaintEscalationSignals?: number;
  reservationOrderSignals?: number;
  complianceUnsubscribeSignals?: number;
  customerInquirySignals?: number;
  vendorProcurementSignals?: number;
  hrRecruitingSignals?: number;
  documentSubmissionSignals?: number;
  securityAccountAlertSignals?: number;
  internalCollaborationSignals?: number;
  threadContextSignals?: number;
  deliveryFailureSignals?: number;
  outOfOfficeSignals?: number;
  sentHistoryAuditSignals?: number;
  mailInfoDigestSignals?: number;
  mobileReviewHandoffSignals?: number;
};

export const modyMailWorkScenarioTaxonomy: readonly ModyMailWorkScenarioDefinition[] = [
  {
    id: "connection_preflight",
    label: "메일 연결 준비",
    purpose: "메일 링크, 아이디, 비밀번호, 2차 인증, 앱 비밀번호를 업무 시작 전에 안전하게 준비합니다.",
    userDecision: "어떤 메일 계정을 연결할지 선택",
    safetyGate: "비밀번호와 인증값은 채팅에 쓰지 않고 계정 보관함이나 OS 보안 저장소에만 입력",
    learningValue: "provider별 연결 방식과 실패 복구 경로를 기억",
  },
  {
    id: "read_only_intake",
    label: "메일함 읽기",
    purpose: "메일함을 읽기 전용으로 확인하고 변경 없이 업무 후보를 만듭니다.",
    userDecision: "어느 메일함과 기간을 볼지 선택",
    safetyGate: "읽음 처리, 이동, 삭제, 발송 없음",
    learningValue: "메일함별 업무 밀도와 확인 주기를 기억",
  },
  {
    id: "inbound_triage",
    label: "받은 업무 분류",
    purpose: "문의, 견적, 예약, 공지, 광고, 확인 필요 메일을 분리합니다.",
    userDecision: "확인 필요 메일의 처리 방향 결정",
    safetyGate: "애매한 메일은 자동 처리하지 않고 확인 필요로 남김",
    learningValue: "업무/잡음/확인 필요 기준을 회사별로 축적",
  },
  {
    id: "customer_inquiry",
    label: "고객/상담 문의",
    purpose: "고객 질문, 상담 요청, 문의 답변을 답장 초안과 담당자 확인으로 정리합니다.",
    userDecision: "답변 범위, 담당자, 회신 톤, 추가 확인 질문 확정",
    safetyGate: "고객 약속, 가격, 보상, 확정 답변은 사용자 확인 전까지 발송하지 않음",
    learningValue: "자주 묻는 질문, 상담 답변 톤, 담당자 배정 기준을 기억",
  },
  {
    id: "vendor_procurement",
    label: "구매/발주/거래처",
    purpose: "거래처 발주, 구매 요청, 납품, 재고, 공급 조건을 확인 카드로 분리합니다.",
    userDecision: "품목, 수량, 납기, 거래 조건, 담당자 확정",
    safetyGate: "발주 확정, 조건 변경, 납품 약속은 최종 승인 전까지 실행하지 않음",
    learningValue: "거래처별 발주 양식, 납기 표현, 조건 확인 순서를 기억",
  },
  {
    id: "hr_recruiting",
    label: "채용/인사",
    purpose: "지원자, 면접, 근태, 휴가, 인사 문서를 개인정보 보호 기준으로 처리합니다.",
    userDecision: "면접 일정, 회신 대상, 개인정보 포함 여부, 내부 공유 범위 확정",
    safetyGate: "개인정보, 평가, 급여/계약 조건은 승인 전 외부 공유하지 않음",
    learningValue: "채용/인사 회신 문체, 일정 기준, 민감정보 차단 기준을 기억",
  },
  {
    id: "document_submission",
    label: "자료/보고서 제출",
    purpose: "제출 요청, 보고서, 증빙, 파일 공유 메일을 첨부와 마감 기준으로 정리합니다.",
    userDecision: "제출 파일, 기한, 공유 범위, 저장/첨부 여부 확정",
    safetyGate: "파일 첨부, 권한 변경, 외부 공유는 승인 전까지 차단",
    learningValue: "자주 제출하는 양식, 파일 위치, 제출 전 체크리스트를 기억",
  },
  {
    id: "security_account_alert",
    label: "보안/계정 알림",
    purpose: "로그인, 비밀번호, 2차 인증, 권한, 결제 보안 알림을 위험 신호로 분리합니다.",
    userDecision: "정상 알림 여부, 계정 확인 필요 여부, 보안 조치 확정",
    safetyGate: "비밀번호, 인증코드, 토큰은 채팅에 쓰지 않고 보안 저장소/공식 화면으로만 처리",
    learningValue: "계정별 보안 알림 패턴과 의심 알림 대응 순서를 기억",
  },
  {
    id: "internal_collaboration",
    label: "내부 공유/협업",
    purpose: "팀 공지, 업무 요청, 승인 요청, 내부 회람을 담당자와 다음 행동으로 묶습니다.",
    userDecision: "담당자, 마감, 공유 채널, 후속 작업 확정",
    safetyGate: "내부 자료라도 외부 공유/파일 변경/자동 회신은 승인 전까지 실행하지 않음",
    learningValue: "팀별 담당자, 반복 요청, 내부 보고/공유 형식을 기억",
  },
  {
    id: "thread_context_reconstruction",
    label: "스레드 맥락 정리",
    purpose: "이전 회신, 전달, 참조 변경, 오래된 대화를 한 업무 흐름으로 묶어 최신 요청만 분리합니다.",
    userDecision: "어느 메일을 기준으로 답할지, 이전 약속/첨부/참조를 반영할지 확정",
    safetyGate: "오래된 스레드 내용을 최신 사실처럼 단정하지 않고 확인 필요로 남김",
    learningValue: "스레드별 결정 이력, 최신 요청, 반복 참조 대상을 기억",
  },
  {
    id: "delivery_failure_bounce",
    label: "반송/발송 실패",
    purpose: "반송, SMTP 오류, 주소 오류, 용량 초과 같은 실패 메일을 재발송 전 점검으로 분리합니다.",
    userDecision: "주소 수정, 첨부 축소, 대체 연락, 재발송 여부 확정",
    safetyGate: "실패 원인과 수신자를 다시 확인하기 전까지 자동 재발송하지 않음",
    learningValue: "반복 실패 주소, provider 오류, 첨부 용량 제한과 재시도 기준을 기억",
  },
  {
    id: "out_of_office_auto_reply",
    label: "부재중/자동응답",
    purpose: "부재중, 휴가, 자동응답, 담당자 변경 안내를 후속 확인 또는 대체 담당자 후보로 분리합니다.",
    userDecision: "언제 다시 보낼지, 대체 담당자에게 보낼지, 후속 알림을 남길지 확정",
    safetyGate: "자동응답에는 바로 추가 발송하지 않고 후속 후보로만 기록",
    learningValue: "상대 부재 기간, 대체 담당자, 재시도 시점을 기억",
  },
  {
    id: "sent_history_audit",
    label: "처리 이력/발송 감사",
    purpose: "어떤 방식으로 처리했는지, 누가 승인했는지, 언제 초안/검토/발송 후보가 생겼는지 기록합니다.",
    userDecision: "처리 기록 저장, 되돌림 기준, 다음에 같은 방식으로 처리할지 확정",
    safetyGate: "감사 기록에는 원문 주소, 비밀번호, 인증값을 저장하지 않고 결정 라벨과 근거만 남김",
    learningValue: "처리 방식, 승인 습관, 되돌림 기준, 다음 업무 자동화 기준을 기억",
  },
  {
    id: "mail_info_digest",
    label: "메일 정보 전달/요약",
    purpose: "중요 메일, 처리 현황, 확인 필요 정보를 요약해 사용자나 팀에 전달 후보로 정리합니다.",
    userDecision: "요약 범위, 전달 대상, 공유 채널, 민감정보 제외 기준 확정",
    safetyGate: "자동 전달 없이 요약/공유 후보만 만들고 민감정보 포함 시 승인함에 보류",
    learningValue: "보고 형식, 전달 대상, 민감정보 제외 기준을 기억",
  },
  {
    id: "mobile_review_handoff",
    label: "휴대폰 검토/승인",
    purpose: "답장 후보, 승인 대기, 긴급 확인 메일을 휴대폰 알림이나 모바일 검토 화면으로 이어 봅니다.",
    userDecision: "휴대폰에서 볼 항목, 알림 채널, 승인/수정/보류 여부, 앱 최종 확인 필요 여부 확정",
    safetyGate: "휴대폰 알림은 요약과 결정 후보만 보내며 실제 전송은 앱의 마지막 확인과 사용자 승인 뒤에만 실행",
    learningValue: "모바일에서 바로 확인할 메일 유형, 알림 시간, 승인 습관, 보류 기준을 기억",
  },
  {
    id: "reply_draft",
    label: "답장 초안",
    purpose: "사용자 말투와 업무 맥락에 맞춰 답장 초안을 만듭니다.",
    userDecision: "초안 승인, 수정 요청, 보류, 거절",
    safetyGate: "발송은 최종 사용자 확인 전까지 차단",
    learningValue: "승인/수정된 문장을 사용자 답장 톤으로 저장",
  },
  {
    id: "calendar_coordination",
    label: "일정 조율",
    purpose: "메일의 일정 표현을 가능한 시간 후보와 캘린더 충돌 확인으로 연결합니다.",
    userDecision: "일정 후보와 참석자 확정",
    safetyGate: "캘린더 등록과 초대 발송은 최종 확인 전까지 차단",
    learningValue: "선호 요일, 시간대, 회의 길이, 준비 자료를 기억",
  },
  {
    id: "recipient_selection",
    label: "수신자 판단",
    purpose: "누구에게 보내야 하는지 보낸 사람, 스레드, 고객/거래처 분류로 후보화합니다.",
    userDecision: "받는 사람, 참조, 숨은참조, 제외 대상 확정",
    safetyGate: "외부 주소는 후보로만 두고 요약에 원문 주소를 그대로 노출하지 않음",
    learningValue: "상대 역할과 발송 대상 그룹 기준을 기억",
  },
  {
    id: "bulk_mail",
    label: "대량 메일",
    purpose: "여러 사람에게 보낼 내용을 대상 그룹별 문안과 개인화 변수로 정리합니다.",
    userDecision: "전체 명단, 제외 대상, 개인화 항목, 샘플 문안 확인",
    safetyGate: "전체 수신자 목록과 샘플 문안 확인 전 발송 차단",
    learningValue: "대량 발송 그룹, 제외 규칙, 중복 제거 기준을 기억",
  },
  {
    id: "quote_proposal",
    label: "견적/제안",
    purpose: "견적 요청, 제안서, 단가표, 납기 문의를 답장 초안과 첨부/승인 후보로 정리합니다.",
    userDecision: "견적 범위, 금액/단가, 유효기간, 첨부 포함 여부 확정",
    safetyGate: "금액, 조건, 첨부파일은 사용자가 확인하기 전까지 외부 발송하지 않음",
    learningValue: "자주 쓰는 견적 표현, 조건, 유효기간, 첨부 기준을 기억",
  },
  {
    id: "invoice_payment",
    label: "정산/청구",
    purpose: "세금계산서, 정산표, 입금, 결제, 청구 메일을 금액 확인과 후속 확인 후보로 묶습니다.",
    userDecision: "금액, 계좌/결제 상태, 증빙 파일, 회신 대상 확정",
    safetyGate: "결제/환불/계좌/세금계산서 관련 발송은 초안과 확인 목록까지만 자동 생성",
    learningValue: "정산 주기, 자주 확인하는 금액/증빙 항목, 회신 양식을 기억",
  },
  {
    id: "contract_legal",
    label: "계약/법무",
    purpose: "계약서, 약관, NDA, 서명 요청을 고위험 검토 업무로 분류합니다.",
    userDecision: "계약 조건, 수정 요청, 법무 검토 필요 여부 확정",
    safetyGate: "계약/법무 메일은 자동 승인하지 않고 요약, 체크리스트, 수정 초안까지만 생성",
    learningValue: "반복 계약 유형, 확인 조항, 금지 표현, 검토 담당자 기준을 기억",
  },
  {
    id: "public_tax",
    label: "공공/세무",
    purpose: "국세청, 홈택스, 공공기관, 지원사업, 신고/제출 메일을 별도 고위험 업무로 잠급니다.",
    userDecision: "제출 기한, 첨부 서류, 담당 기관, 최종 제출 여부 확정",
    safetyGate: "공공기관/세무 제출, 신고, 민감 서류 공유는 사용자 최종 확인 전까지 실행하지 않음",
    learningValue: "기관별 제출 양식, 마감 패턴, 필요한 증빙 목록을 기억",
  },
  {
    id: "complaint_escalation",
    label: "클레임/긴급",
    purpose: "불만, 환불, 장애, 오류, 긴급 요청을 우선순위와 응대 톤 기준으로 분리합니다.",
    userDecision: "응대 우선순위, 보상/환불 가능 여부, 내부 공유 대상 확정",
    safetyGate: "환불, 보상, 사과문, 책임 인정 표현은 사용자 확인 전까지 발송하지 않음",
    learningValue: "클레임 분류 기준, 금지 표현, 긴급도 판단과 후속 SLA를 기억",
  },
  {
    id: "reservation_order",
    label: "예약/주문",
    purpose: "상담 예약, 방문, 주문, 배송, 출고 메일을 일정/고객 응대/후속 확인과 연결합니다.",
    userDecision: "예약 시간, 주문 상태, 배송/방문 안내, 변경 가능 여부 확정",
    safetyGate: "예약 확정, 주문 변경, 배송 안내 발송은 확인 카드와 최종 승인 뒤에만 실행",
    learningValue: "자주 쓰는 예약 안내, 주문 상태 문구, 변경/취소 처리 기준을 기억",
  },
  {
    id: "compliance_unsubscribe",
    label: "수신거부/마케팅 준수",
    purpose: "광고성 메일, 수신거부, 마케팅 동의, 개인정보 문구를 발송 전 준수 체크로 분리합니다.",
    userDecision: "광고성 여부, 수신거부 제외, 필수 고지 문구 포함 여부 확정",
    safetyGate: "수신거부/마케팅 동의가 불명확하면 대량 발송을 잠그고 제외 규칙부터 확인",
    learningValue: "수신거부 제외 규칙, 마케팅 고지 문구, 발송 금지 조건을 기억",
  },
  {
    id: "attachment_followup",
    label: "첨부/자료 확인",
    purpose: "첨부파일, 누락 자료, 파일 근거를 답장과 보고서 업무에 연결합니다.",
    userDecision: "첨부 포함 여부와 파일 근거 확인",
    safetyGate: "파일 공유, 첨부 발송, 권한 변경은 승인 전 차단",
    learningValue: "반복 첨부 종류와 누락 자료 요청 패턴을 기억",
  },
  {
    id: "noise_filter",
    label: "잡음 제외",
    purpose: "광고, 뉴스레터, 시스템 알림을 업무 인박스에서 분리합니다.",
    userDecision: "무시 규칙 유지 또는 예외 처리",
    safetyGate: "분류가 불확실하면 삭제하지 않고 확인 필요로 남김",
    learningValue: "광고/공지/시스템 알림 제외 규칙을 기억",
  },
  {
    id: "high_risk_approval",
    label: "고위험 승인",
    purpose: "외부 발송, 일정 등록, 파일 공유, 공공기관/계약/세무성 업무를 승인함에 잠급니다.",
    userDecision: "최종 실행, 수정 요청, 보류, 거절",
    safetyGate: "finalUserPresence=true 전에는 외부 변경 없음",
    learningValue: "어떤 업무가 사용자 최종 확인을 요구하는지 기록",
  },
  {
    id: "follow_up_tracking",
    label: "후속 추적",
    purpose: "마감, 회신 대기, 재안내, 리마인드가 필요한 메일을 다음 확인 후보로 둡니다.",
    userDecision: "언제 다시 확인할지 결정",
    safetyGate: "자동 독촉 발송 없음, 알림 후보만 생성",
    learningValue: "후속 확인 주기와 마감 표현을 기억",
  },
  {
    id: "work_memory_learning",
    label: "업무 방식 학습",
    purpose: "처리 결과, 승인/수정, 말투, 대상 그룹, 일정 기준을 다음 메일 업무 기준으로 저장합니다.",
    userDecision: "이번 처리 방식을 저장하거나 수정",
    safetyGate: "원문 메일, 주소, 비밀번호, 인증값은 기억 요약에 저장하지 않음",
    learningValue: "사용자별 메일 업무 처리 방식을 누적",
  },
] as const;

export function analyzeMailWorkScenarioCoverage(input: {
  providerRead?: ModyProviderMailReadOutput;
  workReport?: ModyProviderWorkIntakeReport;
  stats: ModyMailWorkScenarioStats;
}): ModyMailWorkScenarioCoverage[] {
  const messages = input.providerRead?.messages ?? [];
  const report = input.workReport;
  const stats = input.stats;
  const text = messages.map(messageText).join("\n");
  const followUpSignals =
    stats.followUpSignals ??
    countMatches(text, /(마감|기한|회신\s*대기|리마인드|재안내|후속|follow[-\s]?up|remind|deadline)/giu);
  const quoteProposalSignals =
    stats.quoteProposalSignals ?? countMatches(text, /(견적|견적서|단가|제안서|제안|납기|발주|proposal|quote|estimate)/giu);
  const invoicePaymentSignals =
    stats.invoicePaymentSignals ?? countMatches(text, /(세금계산서|계산서|정산|입금|결제|청구|영수증|송금|환불|invoice|payment|billing)/giu);
  const contractLegalSignals =
    stats.contractLegalSignals ?? countMatches(text, /(계약|계약서|약관|NDA|비밀유지|서명|날인|법무|조항|contract|legal|signature)/giu);
  const publicTaxSignals =
    stats.publicTaxSignals ?? countMatches(text, /(공공기관|관공서|정부|국세청|홈택스|세무|신고|지원사업|보조금|제출|hometax|tax)/giu);
  const complaintEscalationSignals =
    stats.complaintEscalationSignals ?? countMatches(text, /(클레임|불만|항의|장애|오류|긴급|환불|취소|컴플레인|escalat|urgent|complaint)/giu);
  const reservationOrderSignals =
    stats.reservationOrderSignals ?? countMatches(text, /(예약|상담\s*예약|방문|주문|배송|출고|픽업|변경|booking|reservation|order|delivery)/giu);
  const complianceUnsubscribeSignals =
    stats.complianceUnsubscribeSignals ?? countMatches(text, /(수신거부|구독\s*해지|unsubscribe|opt[-\s]?out|마케팅\s*동의|광고성|개인정보|privacy)/giu);
  const customerInquirySignals =
    stats.customerInquirySignals ?? countMatches(text, /(문의|상담|질문|고객|답변\s*요청|확인\s*부탁|inquiry|question|support)/giu);
  const vendorProcurementSignals =
    stats.vendorProcurementSignals ?? countMatches(text, /(구매|발주|납품|재고|거래처|공급|품목|수량|purchase|procurement|supplier|vendor)/giu);
  const hrRecruitingSignals =
    stats.hrRecruitingSignals ?? countMatches(text, /(채용|지원자|면접|이력서|근태|휴가|급여|인사|recruit|interview|hr)/giu);
  const documentSubmissionSignals =
    stats.documentSubmissionSignals ?? countMatches(text, /(자료|보고서|제출|증빙|첨부|공유|파일|서류|document|report|submit|attachment)/giu);
  const securityAccountAlertSignals =
    stats.securityAccountAlertSignals ?? countMatches(text, /(보안|로그인|비밀번호|2차\s*인증|인증코드|권한|토큰|계정|security|login|password|2fa|otp|token)/giu);
  const internalCollaborationSignals =
    stats.internalCollaborationSignals ?? countMatches(text, /(내부|팀|부서|공유|협업|회람|승인\s*요청|업무\s*요청|공지|collaboration|internal|team)/giu);
  const threadContextSignals =
    stats.threadContextSignals ?? countMatches(text, /(스레드|이전\s*메일|이전\s*회신|전달|FW:|Fwd:|Re:|참조\s*변경|reply\s*chain|thread)/giu);
  const deliveryFailureSignals =
    stats.deliveryFailureSignals ?? countMatches(text, /(반송|발송\s*실패|전송\s*실패|메일\s*실패|주소\s*오류|수신\s*불가|메일함\s*가득|bounce|undeliver|delivery\s*failed|smtp\s*error)/giu);
  const outOfOfficeSignals =
    stats.outOfOfficeSignals ?? countMatches(text, /(부재중|자동\s*응답|휴가|자리\s*비움|대체\s*담당자|out\s*of\s*office|auto[-\s]?reply|vacation)/giu);
  const sentHistoryAuditSignals =
    stats.sentHistoryAuditSignals ?? countMatches(text, /(처리\s*이력|발송\s*이력|감사\s*기록|승인\s*기록|로그|되돌리기|audit|history|receipt|rollback)/giu);
  const mailInfoDigestSignals =
    stats.mailInfoDigestSignals ??
    countMatches(text, /(요약|보고|전달|공유\s*후보|처리\s*현황|확인\s*필요\s*정보|digest|summary|brief|forward\s*candidate|status\s*update)/giu);
  const mobileReviewHandoffSignals =
    stats.mobileReviewHandoffSignals ??
    countMatches(text, /(휴대폰|핸드폰|모바일|푸시|알림|텔레그램|카카오|문자|앱에서\s*확인|밖에서\s*확인|phone|mobile|push|telegram|sms)/giu);
  const evidenceById: Record<ModyMailWorkScenarioId, number> = {
    connection_preflight: stats.totalMessages > 0 || report ? 1 : 0,
    read_only_intake: stats.totalMessages,
    inbound_triage: stats.workItems + stats.reviewItems + stats.ignoredItems,
    customer_inquiry: customerInquirySignals,
    vendor_procurement: vendorProcurementSignals,
    hr_recruiting: hrRecruitingSignals,
    document_submission: documentSubmissionSignals,
    security_account_alert: securityAccountAlertSignals,
    internal_collaboration: internalCollaborationSignals,
    thread_context_reconstruction: threadContextSignals,
    delivery_failure_bounce: deliveryFailureSignals,
    out_of_office_auto_reply: outOfOfficeSignals,
    sent_history_audit: sentHistoryAuditSignals + stats.approvalCandidates,
    mail_info_digest: mailInfoDigestSignals + stats.reviewItems,
    mobile_review_handoff: mobileReviewHandoffSignals + stats.approvalCandidates,
    reply_draft: stats.replyCandidates,
    calendar_coordination: stats.calendarCandidates + (report?.calendarBusyWindows?.length ?? 0),
    recipient_selection: stats.recipientDecisionSignals,
    bulk_mail: stats.bulkMailSignals,
    quote_proposal: quoteProposalSignals,
    invoice_payment: invoicePaymentSignals,
    contract_legal: contractLegalSignals,
    public_tax: publicTaxSignals,
    complaint_escalation: complaintEscalationSignals,
    reservation_order: reservationOrderSignals,
    compliance_unsubscribe: complianceUnsubscribeSignals,
    attachment_followup: stats.attachmentSignals + (stats.recipientSourceSignals ?? 0),
    noise_filter: stats.ignoredItems,
    high_risk_approval:
      stats.approvalCandidates +
      invoicePaymentSignals +
      contractLegalSignals +
      publicTaxSignals +
      complaintEscalationSignals,
    follow_up_tracking: followUpSignals,
    work_memory_learning: stats.totalMessages > 0 || stats.approvalCandidates > 0 ? 1 : 0,
  };

  return modyMailWorkScenarioTaxonomy.map((scenario) => {
    const evidenceCount = evidenceById[scenario.id] ?? 0;
    const status = scenarioStatusFor(scenario.id, evidenceCount, stats);
    return {
      ...scenario,
      status,
      evidenceCount,
      guidance: scenarioGuidance(scenario.id, status),
      nextAction: scenarioNextAction(scenario.id, status),
    };
  });
}

function scenarioStatusFor(
  id: ModyMailWorkScenarioId,
  evidenceCount: number,
  stats: ModyMailWorkScenarioStats,
): ModyMailWorkScenarioStatus {
  if (evidenceCount > 0) return "observed";
  if (id === "connection_preflight") return "ready";
  if (id === "read_only_intake") return stats.totalMessages > 0 ? "observed" : "needs_setup";
  if (id === "work_memory_learning") return "ready";
  return stats.totalMessages > 0 ? "ready" : "needs_setup";
}

function scenarioGuidance(id: ModyMailWorkScenarioId, status: ModyMailWorkScenarioStatus): string {
  if (status === "observed") {
    if (id === "bulk_mail") return "이번 메일에서 대량 발송 신호가 보여 대상 그룹과 샘플 문안을 먼저 나눕니다.";
    if (id === "recipient_selection") return "이번 메일에서 발송 대상 판단 신호가 보여 수신자 후보를 사용자 확인 전까지 잠급니다.";
    if (id === "quote_proposal") return "견적/제안 신호가 보여 금액, 조건, 첨부 여부를 초안 전에 분리합니다.";
    if (id === "invoice_payment") return "정산/청구 신호가 보여 금액과 증빙 확인을 고위험 승인 흐름으로 둡니다.";
    if (id === "contract_legal") return "계약/법무 신호가 보여 자동 발송 대신 검토 체크리스트로 잠급니다.";
    if (id === "public_tax") return "공공/세무 신호가 보여 제출/신고 전 사용자 최종 확인을 요구합니다.";
    if (id === "complaint_escalation") return "클레임/긴급 신호가 보여 응대 우선순위와 금지 표현을 먼저 확인합니다.";
    if (id === "reservation_order") return "예약/주문 신호가 보여 일정, 상태, 변경 가능 여부를 확인합니다.";
    if (id === "compliance_unsubscribe") return "수신거부/마케팅 준수 신호가 보여 제외 규칙과 고지 문구를 먼저 확인합니다.";
    if (id === "customer_inquiry") return "고객/상담 문의 신호가 보여 답변 범위와 담당자 확인을 먼저 분리합니다.";
    if (id === "vendor_procurement") return "구매/발주 신호가 보여 품목, 수량, 납기, 거래 조건을 확인합니다.";
    if (id === "hr_recruiting") return "채용/인사 신호가 보여 개인정보와 내부 공유 범위를 먼저 잠급니다.";
    if (id === "document_submission") return "자료/보고서 제출 신호가 보여 파일, 기한, 공유 범위를 확인합니다.";
    if (id === "security_account_alert") return "보안/계정 알림 신호가 보여 공식 화면 확인과 비밀값 비노출을 우선합니다.";
    if (id === "internal_collaboration") return "내부 협업 신호가 보여 담당자, 마감, 공유 채널을 다음 행동으로 묶습니다.";
    if (id === "thread_context_reconstruction") return "스레드/전달/이전 회신 신호가 보여 최신 요청과 과거 약속을 분리합니다.";
    if (id === "delivery_failure_bounce") return "반송/발송 실패 신호가 보여 주소, 첨부, provider 오류를 재발송 전 확인합니다.";
    if (id === "out_of_office_auto_reply") return "부재중/자동응답 신호가 보여 재시도 시점과 대체 담당자 후보로 분리합니다.";
    if (id === "sent_history_audit") return "처리 이력/승인 기록 신호가 보여 어떤 방식으로 처리했는지 감사 기록으로 남깁니다.";
    if (id === "mail_info_digest") return "요약/전달 신호가 보여 중요 메일, 확인 필요 정보, 공유 후보를 승인함에 묶습니다.";
    if (id === "mobile_review_handoff") return "모바일 검토/승인 신호가 보여 휴대폰 알림은 요약만 보내고 전송은 앱 최종 확인으로 잠급니다.";
    if (id === "high_risk_approval") return "실행 후보가 있어 오피스 승인함에서 최종 확인해야 합니다.";
    return "이번 메일 점검에서 해당 업무 경우의 수가 관측됐습니다.";
  }
  if (status === "needs_setup") return "메일 읽기 또는 필요한 연결이 준비되면 이 경우의 수를 판단합니다.";
  return "아직 관측되지는 않았지만 메일 업무 흐름에서 바로 대응할 준비가 된 경우입니다.";
}

function scenarioNextAction(id: ModyMailWorkScenarioId, status: ModyMailWorkScenarioStatus): string {
  if (status === "needs_setup") return "업무 탭에서 메일 점검을 선택하고 필요한 연결만 확인";
  if (id === "connection_preflight") return "계정 보관함에서 메일 계정과 2차 인증/앱 비밀번호 확인";
  if (id === "bulk_mail") return "대상 그룹, 제외 대상, 개인화 항목, 샘플 문안 검토";
  if (id === "recipient_selection") return "받는 사람, 참조, 숨은참조, 제외 대상을 사용자에게 확인";
  if (id === "customer_inquiry") return "답변 범위, 담당자, 추가 확인 질문, 회신 톤 확인";
  if (id === "vendor_procurement") return "품목, 수량, 납기, 거래 조건, 담당자 확인";
  if (id === "hr_recruiting") return "개인정보 포함 여부, 면접 일정, 내부 공유 범위 확인";
  if (id === "document_submission") return "제출 파일, 기한, 첨부/공유 권한, 저장 위치 확인";
  if (id === "security_account_alert") return "공식 화면에서 계정 상태와 2차 인증 준비 확인";
  if (id === "internal_collaboration") return "담당자, 마감, 공유 채널, 후속 작업 확인";
  if (id === "thread_context_reconstruction") return "최신 메일, 이전 약속, 참조 변경, 첨부 근거 확인";
  if (id === "delivery_failure_bounce") return "실패 원인, 주소 수정, 첨부 용량, 재발송 여부 확인";
  if (id === "out_of_office_auto_reply") return "재시도 날짜, 대체 담당자, 후속 알림 후보 확인";
  if (id === "sent_history_audit") return "처리 방식, 승인 기록, 되돌림 기준, 다음 학습 여부 확인";
  if (id === "mail_info_digest") return "요약 범위, 전달 대상, 공유 채널, 민감정보 제외 기준 확인";
  if (id === "mobile_review_handoff") return "휴대폰 알림 대상, 모바일 검토 요약, 승인/수정/보류 버튼, 앱 최종 확인 경계 확인";
  if (id === "quote_proposal") return "견적 조건, 금액, 유효기간, 첨부 여부 확인";
  if (id === "invoice_payment") return "금액, 증빙, 세금계산서/결제 상태 확인";
  if (id === "contract_legal") return "계약 조건과 법무/담당자 검토 필요 여부 확인";
  if (id === "public_tax") return "기관, 제출 기한, 필수 서류, 최종 제출 여부 확인";
  if (id === "complaint_escalation") return "긴급도, 응대 톤, 환불/보상 가능 여부 확인";
  if (id === "reservation_order") return "예약/주문 상태, 변경 가능 여부, 안내 문구 확인";
  if (id === "compliance_unsubscribe") return "수신거부 제외, 광고성 고지, 마케팅 동의 확인";
  if (id === "reply_draft") return "답장 초안을 승인함에서 검토";
  if (id === "calendar_coordination") return "가능 시간과 참석자를 확인한 뒤 일정 후보 검토";
  if (id === "work_memory_learning") return "승인/수정 결과를 지난 업무 기억에 저장";
  return "오피스 승인함 또는 업무 기억에서 다음 처리 기준 확인";
}

function countMatches(value: string, pattern: RegExp): number {
  return Array.from(value.matchAll(pattern)).length;
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
