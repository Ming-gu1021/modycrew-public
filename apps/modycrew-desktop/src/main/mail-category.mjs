/**
 * 메일함 분류 — Gmail의 기본함/프로모션/소셜/업데이트/스팸처럼 받은 메일을 나눈다.
 *
 * 원칙:
 *  - 제공자가 준 라벨(Gmail CATEGORY_*, SPAM)이 있으면 그것을 먼저 믿는다.
 *  - 라벨이 없으면 제목·보낸 사람·미리보기만으로 판단한다(본문 원문은 쓰지 않는다).
 *  - 한국 광고 메일은 제목 앞의 "(광고)" 표시가 법정 표기라 가장 강한 신호로 본다.
 *  - 업무 신호(견적·계약·회신 요청 등)가 있는 메일은 광고 단어가 섞여 있어도 기본함에 둔다.
 *    조용히 버려지는 쪽보다 한 번 더 보이는 쪽이 안전하다.
 *  - 결제·영수증은 광고가 아니다. 주문 확인·결제 완료·청구서는 따로 모은다.
 *  - 일정 후보는 "미팅·회의·예약" 같은 말과 "날짜·시간"이 함께 있을 때 올린다.
 *    AI 인테이크가 일정 초안을 만든 기본함 메일은 그런 말이 없어도 올린다.
 *    뉴스레터가 날짜를 언급한다고 일정 후보가 되지 않는다.
 */

export const MAIL_CATEGORIES = Object.freeze(["primary", "receipt", "notification", "promotion", "social", "spam"]);

const text = (value) => String(value ?? "").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ko-KR");

// 한국 전자상거래·정보통신망법 광고 표기: (광고), [광고], 【광고】
const koreanAdMarker = /^\s*[\(\[【]\s*광\s*고\s*[\)\]】]/u;
const promotionWords = /광고|프로모션|할인|쿠폰|특가|세일\b|\bsale\b|이벤트\s*(?:안내|참여|당첨|혜택)|뉴스레터|newsletter|unsubscribe|수신\s*거부|구독\s*(?:해지|취소)|\bpromo(?:tion)?\b|%\s*off|limited\s*time|추천\s*상품|신상품|혜택|적립|마케팅|\bmarketing\b|웨비나|webinar|설문\s*(?:조사|참여)|survey|오픈\s*기념|런칭|launch\s*(?:event|sale)|지금\s*바로|신청하세요|놓치지\s*마세요|마감\s*임박|\bd-\d|무료\s*(?:상담|진단|체험|참가)|도와드립니다|소식지|매거진|magazine|digest|vol\.?\s*\d|제\s*\d+\s*호|뉴스\s*(?:레터|vol)|news\s*vol|only\s*a\s*few\s*(?:hours|days)|last\s*chance|don'?t\s*miss|학습\s*메일|오늘의\s*(?:영어|표현|단어|문장)|데일리\s*(?:영어|뉴스)|daily\s*(?:english|lesson|digest)/iu;
const promotionSenders = /newsletter|news@|marketing|promo|campaign|mailchimp|stibee|sendgrid\.net|hubspot|salesforce|@e\.|@em\.|@mail\.|noreply@.*(?:shop|store|mall)|학습\s*메일|뉴스레터|소식지/iu;
const spamWords = /스팸|피싱|phishing|당첨(?:되셨|자\s*발표|을\s*축하)|복권|lottery|urgent\s*wire|wire\s*transfer|western\s*union|크립토|bitcoin|비트코인|카지노|casino|viagra|비아그라|대출\s*(?:승인|가능|한도)|무담보|급전|성인\s*(?:사이트|용품)|\$\$\$|100%\s*free|click\s*here\s*now|congratulations\s*you/iu;
const socialSenders = /linkedin|facebook|instagram|twitter|x\.com|tiktok|youtube|pinterest|threads\.net|kakao\S*채널|band\.us|cafe\.naver|disqus|discord|reddit|medium\.com/iu;
const socialWords = /님이\s*회원님|팔로우|좋아요를|댓글을|connection\s*request|wants\s*to\s*connect|job\s*alert|jobs?\s*(?:for|matching)\s*you|recommended\s*for\s*you|people\s*you\s*may\s*know|회원님을\s*위한/iu;
const notificationSenders = /no-?reply|noreply|do-?not-?reply|notification|notifications?@|alerts?@|mailer-daemon|postmaster|system@|automated|bounce|github|gitlab|atlassian|jira|notion|slack|vercel|firebase|cloudflare|aws|azure|calendar-notification/iu;
// 예약·쇼핑·구독 서비스의 자동 발송. 사람이 보낸 업무 메일과 구분해 알림함으로 보낸다.
const serviceSenders = /trip\.com|booking\.com|agoda|expedia|airbnb|yanolja|여기어때|interpark|kakaomobility|coupang|11st|gmarket|auction\.co|musinsa|baemin|netflix|spotify|apple\.com|google\.com|googleplay|play-?store|toss\.im|kakao\.com|naver\.com\s*$|@naver\.com>|linkedin|indeed|wanted\.co|saramin|jobkorea|rocketpunch/iu;
const notificationWords = /알림|notification|run\s*failed|build\s*(?:failed|succeeded|passed)|verify\s*your|verification\s*code|인증\s*(?:코드|번호|메일)|보안\s*알림|security\s*alert|new\s*sign-?in|로그인\s*알림|비밀번호\s*(?:재설정|변경|초기화)|password\s*reset|계정\s*(?:확인|보안|활동)|deployment|배포\s*(?:완료|실패)|workflow|pull\s*request|issue\s*#|가입을\s*환영|welcome\s*to|계정이\s*생성|your\s*account|usage\s*(?:report|limit)|plan\s*is\s*now/iu;
const receiptWords = /영수증|결제\s*(?:완료|내역|승인|확인|안내|알림|명세)|결제가\s*(?:완료|승인)|결제되었|청구서|청구\s*(?:내역|안내|금액)|인보이스|invoice|receipt|payment\s*(?:received|confirmation|confirmed|successful|succeeded|summary)|your\s*(?:receipt|invoice|order|payment|purchase)|order\s*(?:confirmation|confirmed|received|#\s*\d)|주문\s*(?:확인|완료|접수|내역|번호|이\s*접수)|구매\s*(?:확인|내역|완료)|배송\s*(?:출발|완료|안내|시작|예정)|구독\s*(?:갱신|결제|요금)|자동\s*결제|이용\s*요금|요금\s*(?:청구|안내|명세)|billing\s*statement|statement\s*is\s*ready|세금계산서|현금영수증|정기\s*결제|renewal\s*(?:receipt|confirmation|notice)|subscription\s*(?:renewed|receipt|confirmed)|환불\s*(?:완료|처리)|refund\s*(?:issued|processed)|입금\s*(?:확인|완료|안내)|출금|이체\s*(?:완료|안내)|거래\s*(?:내역|알림)|transaction/iu;
// 제목만으로도 "돈이 오간 기록"이라고 확신할 수 있는 표현. 기사·광고가 결제 단어를 쓰는 경우를 거른다.
const receiptStrongWords = /영수증|receipt|invoice|인보이스|청구서|결제\s*(?:완료|내역|승인|명세)|결제가\s*(?:완료|승인)|결제되었|payment\s*(?:received|confirmation|confirmed|successful|succeeded)|order\s*(?:confirmation|confirmed|received)|주문\s*(?:확인|완료|접수|내역)|주문이\s*접수|배송\s*(?:출발|완료|시작)|billing\s*statement|세금계산서|현금영수증|환불\s*(?:완료|처리)|refund\s*(?:issued|processed)|입금\s*(?:확인|완료)|구독\s*(?:갱신|결제)\s*(?:완료|안내|내역)|자동\s*결제\s*(?:완료|안내|내역)|거래\s*내역/iu;
const receiptSenders = /billing|receipt|invoice|payment|pay@|orders?@|@(?:toss|tosspayments|kakaopay|naverpay|payco|stripe|paypal|wise)\.|noreply@(?:apple|google|microsoft|amazon|coupang|11st|gmarket|auction|musinsa|baemin|yanolja)\.|appleid|itunes|play-?store|gumroad|lemonsqueezy|paddle|openai\.com|anthropic\.com/iu;
const businessWords = /견적|계약|발주|납품|입찰|제안서|회신\s*(?:부탁|요청|바랍니다)|답변\s*(?:부탁|요청|바랍니다)|문의드립니다|요청드립니다|확인\s*(?:부탁|요청)|검토\s*(?:부탁|요청|바랍니다)|미팅|회의(?!록)|면접|인터뷰|지원서|서류\s*제출|협조\s*(?:요청|부탁)|승인\s*(?:요청|부탁)|rfq|quotation|proposal|please\s*(?:confirm|review|advise|reply)|could\s*you|회신\s*주시|부탁드립니다/iu;
const meetingWords = /미팅|회의(?!록)|면담|상담|방문|약속|일정\s*(?:조율|확인|제안|안내|을\s*잡|잡)|스케줄|예약|meeting|appointment|interview|면접|발표|세미나|워크숍|workshop|행사\s*(?:참석|참가)|초대합니다|invite|invitation|call\s*(?:on|at)|통화/iu;
const dateTimeWords = /\d{1,2}\s*월\s*\d{1,2}\s*일|\d{4}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}|\d{1,2}\s*[./]\s*\d{1,2}\s*\(?[월화수목금토일]\)?|(?:오전|오후|am|pm)\s*\d{1,2}|\d{1,2}\s*시(?:\s*\d{1,2}\s*분|\s*반)?|[월화수목금토일]요일|\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b|내일|모레|이번\s*주|다음\s*주|next\s*week|tomorrow|\d{1,2}:\d{2}/iu;
const calendarInvitationFrom = /calendar-notification@google\.com|calendar@|invitations?@|zoom\.us|teams\.microsoft|webex|meet\.google/iu;
const calendarInvitationSubject = /^(?:초대|invitation|updated\s*invitation|새\s*일정|일정\s*초대|수락됨|accepted|거절됨|declined)\s*[:：]/iu;
// 내가 보낸 메일에 대한 회신·전달 스레드. 사람이 답했을 수 있어 광고·알림으로 몰지 않는다.
const replyThreadSubject = /^\s*(?:re|fw|fwd)\s*[:：]|^\s*(?:답장|회신|전달)\s*[:：]/iu;
// 보낸 사람 이름·주소가 스스로 뉴스레터·학습메일이라고 밝힌 경우. 제목에 '회의'·'미팅' 같은 업무 낱말이 섞여도
// ('…회의를 엽니다'의 영어 표현은?) 사람이 보낸 업무 메일이 아니다. '@mail.' 같은 약한 신호는 회사 메일 서버와 겹쳐 여기 넣지 않는다.
const declaredBulkSenders = /newsletter|news-?letter|뉴스레터|소식지|학습\s*메일|mailchimp|stibee|campaign-archive|\bpromo(?:tion)?s?@|marketing@/iu;
// 금융·쇼핑·교육 기관이 제목 앞에 이름표를 달아 대량으로 보내는 공지('[키움증권] 잠자고 있는…'). 메일함 분류는 바꾸지 않고
// 승인 카드를 만들지 않는 판단에만 쓴다. 업무 요청 표현이 있으면('[OO투자] 미팅 요청') 카드를 남긴다.
const institutionalNoticeSubject = /^\s*\[[^\]]{1,24}(?:증권|은행|카드|보험|캐피탈|저축은행|자산운용|페이|쇼핑|홈쇼핑|항공|인강|어학원|토익|토플)\]/iu;

function normalizeLabels(labels) {
  return Array.isArray(labels) ? labels.map((label) => String(label ?? "").trim()).filter(Boolean).slice(0, 12) : [];
}

function labelCategory(labels) {
  const upper = labels.map((label) => label.toUpperCase());
  if (upper.includes("SPAM")) return "spam";
  if (upper.includes("CATEGORY_PROMOTIONS")) return "promotion";
  if (upper.includes("CATEGORY_SOCIAL") || upper.includes("CATEGORY_FORUMS")) return "social";
  if (upper.includes("CATEGORY_UPDATES")) return "updates";
  if (upper.includes("CATEGORY_PERSONAL")) return "primary";
  return "";
}

function candidateHasCalendarSignal(candidate) {
  if (!candidate || typeof candidate !== "object") return false;
  if (candidate.calendarDraft) return true;
  if (candidate.classification === "calendar_context") return true;
  return (Array.isArray(candidate.approvalQueue) ? candidate.approvalQueue : []).some((item) =>
    /calendar|schedule|event/u.test(`${item?.operationKind ?? ""} ${item?.toolName ?? ""}`),
  );
}

/**
 * @param {{subject?: string, from?: string, preview?: string, snippet?: string, labels?: string[], hasAttachments?: boolean}} message
 * @param {object|null} candidate 인테이크 분류 결과(없으면 null). calendarDraft·draftReply·classification·approvalQueue 를 본다.
 * @param {{storedScheduleCandidate?: boolean, storedReplyCandidate?: boolean}} [previous] 이미 저장된 판단(재분류 때 참고).
 */
export function classifyMailRow(message = {}, candidate = null, previous = {}) {
  const subject = text(message.subject);
  const from = text(message.from);
  const preview = text(message.preview ?? message.snippet);
  const labels = normalizeLabels(message.labels);
  const subjectAndPreview = `${subject} ${preview}`;
  const reasons = [];

  const invitation = calendarInvitationFrom.test(from) || calendarInvitationSubject.test(String(message.subject ?? "").trim());
  const business = businessWords.test(subjectAndPreview);
  const replyThread = replyThreadSubject.test(String(message.subject ?? ""));
  const fromLabels = labelCategory(labels);
  const automatedSender = notificationSenders.test(from) || serviceSenders.test(from);
  const receiptStrong = receiptStrongWords.test(subject);
  const receiptLike = receiptStrong || (receiptSenders.test(from) && receiptWords.test(subjectAndPreview));

  let category = "primary";
  if (invitation) {
    category = "primary";
    reasons.push("일정 초대");
  } else if (fromLabels === "spam" || (spamWords.test(`${from} ${subject}`) && !business)) {
    // 미리보기 본문의 "피싱 주의" 같은 안내 문구로는 스팸 판정하지 않는다. 제목·보낸 사람만 본다.
    category = "spam";
    reasons.push(fromLabels === "spam" ? "제공자가 스팸으로 분류" : "스팸·피싱 표현");
  } else if (koreanAdMarker.test(String(message.subject ?? ""))) {
    category = "promotion";
    reasons.push("제목의 (광고) 표기");
  } else if (declaredBulkSenders.test(from) && !replyThread) {
    category = "promotion";
    reasons.push("뉴스레터·학습메일 발송");
  } else if (receiptLike && (receiptStrong || (!promotionWords.test(subject) && !(business && !automatedSender)))) {
    category = "receipt";
    reasons.push("결제·영수증·주문 표현");
  } else if (fromLabels === "promotion") {
    category = business && !automatedSender ? "primary" : "promotion";
    reasons.push(category === "primary" ? "프로모션 라벨이지만 업무 요청 표현이 있어 기본함 유지" : "제공자의 프로모션 라벨");
  } else if (fromLabels === "social" || socialSenders.test(from) || socialWords.test(subject)) {
    category = "social";
    reasons.push("소셜·커뮤니티 알림");
  } else if (!business && (promotionWords.test(subjectAndPreview) || promotionSenders.test(from))) {
    category = "promotion";
    reasons.push("광고·뉴스레터 표현");
  } else if (fromLabels === "updates" || automatedSender) {
    category = "notification";
    reasons.push(fromLabels === "updates" ? "제공자의 업데이트 라벨" : "자동 발송 서비스 알림");
  } else if (notificationWords.test(subject) && !business) {
    category = "notification";
    reasons.push("시스템 알림 표현");
  } else {
    reasons.push(business ? "업무 요청 표현" : "기본함");
  }

  // 이전 버전 원장의 일정 후보 표시는 넓은 규칙으로 찍힌 것이라 다시 믿지 않는다. 인테이크의 일정 신호만 강한 신호로 본다.
  // AI 인테이크가 일정 초안(calendarDraft)을 만든 기본함 메일은 제목·미리보기에 날짜·회의 표현이 없어도 일정 후보다.
  // 광고·뉴스레터·알림·소셜·스팸은 위 분류에서 이미 기본함이 아니므로 여기서 후보가 되지 않는다.
  const calendarDraft = Boolean(candidate && typeof candidate === "object" && candidate.calendarDraft);
  const calendarSignal = candidateHasCalendarSignal(candidate);
  const meeting = meetingWords.test(subjectAndPreview);
  const dated = dateTimeWords.test(subjectAndPreview);
  const scheduleCandidate =
    category === "primary" && (invitation || calendarDraft || (calendarSignal ? meeting || dated : meeting && dated));
  const receiptCandidate = category === "receipt";
  const replyCandidate =
    category === "primary" &&
    (candidate ? candidate.shouldCreateWorkItem === true && candidate.classification !== "ignored_noise" && Boolean(candidate.draftReply) : previous.storedReplyCandidate === true);

  return { category, reasons, scheduleCandidate, receiptCandidate, replyCandidate, labels };
}

export function isNoiseCategory(category) {
  return category === "promotion" || category === "social" || category === "notification" || category === "spam";
}

   
                                                                             
  
                               
                                                                        
                                                                                 
                                                           
   
export function isWorkCardNoise(message = {}, verdict = classifyMailRow(message)) {
  const category = verdict?.category;
  if (category === "spam" || category === "promotion" || category === "social") return true;
  const subject = String(message.subject ?? "");
  if (replyThreadSubject.test(subject)) return false;
  const asksForWork = businessWords.test(`${text(message.subject)} ${text(message.preview ?? message.snippet)}`);
  if (category === "notification") return !asksForWork;
  return category === "primary" && institutionalNoticeSubject.test(subject) && !asksForWork;
}
