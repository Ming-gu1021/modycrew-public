/** A quick setup only describes work the existing company runner can execute. */
export type QuickPlanDepartment = { id: string; name: string; keywords: string[]; sourceIds: string[]; enabled: boolean };
export type QuickAutomationPlan = {
  request: string;
  trigger: 'schedule' | 'message' | null;
  repeat?: 'daily' | 'weekly';
  nextRunAt?: string;
  whenLabel: string;
  usesDefaultTime: boolean;
  departmentIds: string[];
  sourceRequired: boolean;
  needsMail: boolean;
  needsMessenger: boolean;
  issues: string[];
  notes: string[];
};

export const QUICK_AUTOMATION_DRAFT_KEY = 'modycrew.quick-automation.pending.v1';
export type QuickAutomationDraft = { request: string; root: string; setupId: string; createdAt: number; saved?: boolean; connectionId?: string; nextRunAt?: string };
const weekdays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const externalBoundary = '메일 발송·일정 등록·파일 변경·공유는 자동 실행하지 않고 최종 확인할 항목으로 남깁니다.';

export function isQuickAutomationRequest(request: string): boolean {
  const text = request.trim();
  if (!text || /(?:자동화|반복\s*업무|규칙).*(?:중지|끄|삭제|상태|로그|조회|설명|방법|어떻게|보여)/u.test(text)) return false;
  if (/(?:자동화|반복\s*업무|규칙).*(?:점검|확인)(?:해\s*줘|해\s*주세요)?[.!?]?$/u.test(text)) return false;
  const explicitCreation = /(?:자동화|반복\s*업무|규칙).*(?:만들|설정해|설정\s*해|세팅|추가|준비|생성|시작|하고\s*싶|해\s*줘|해주세요)/u.test(text);
  if (explicitCreation) return true;
  // 한 번짜리 요청('새 메일 확인해줘', '주말 근무표 정리해줘', '월말 정산 보고서 작성해줘')이 채팅 대신
  // 자동화 화면으로 튕기지 않도록, 반복·수신 조건이 분명한 문장만 자동화로 본다.
  // 낱말 하나(새 메일·주말·평일·월말·정기·반복)만으로는 반복 요청이라고 판단하지 않는다.
  // '매'는 낱말 첫머리일 때만 '매일·매주'로 읽는다. 판매·도매·소매·경매 일정처럼 낱말 끝의 '매'는
  // 반복이 아니다(한때 이 때문에 '판매 일정 정리해줘'가 채팅을 떠났다). 신문 이름(매일경제 등)과
  // '매달다(걸다)'도 반복이 아니다.
  const strongRecurrence = /(?:^|[^가-힣])매\s*(?:일(?!경제|신문|유업)|주|월|달(?![아려리기])|아침|저녁)|[월화수목금토일]요일\s*마다|(?:평일|주말|월말|아침|저녁)\s*마다/u.test(text);
  // '평일·주말 + 몇 시에'는 정해진 일정이다. 단 '이번·다음 주말 오후 3시에'처럼 특정한 날은 한 번짜리다.
  const weekdayWithTime = /(?:^|[^가-힣])(?:평일|주말|영업일)(?:에는|에|엔)?\s*(?:(?:오전|오후|아침|저녁|새벽|밤)\s*)?\d{1,2}\s*시(?:\s*\d{1,2}\s*분|\s*반)?\s*(?:에|마다)/u.test(text)
    && !/(?:이번|다음|지난|오는)\s*(?:주\s*)?(?:평일|주말)/u.test(text);
  const incomingTrigger = /메일(?:이|을)?\s*(?:새로\s*|새로이\s*|또\s*)?(?:오면|들어오면|도착하면|수신되면|받으면)|문의(?:가)?\s*(?:오면|들어오면)|(?:올|들어올|도착할)\s*때\s*마다/u.test(text);
  return (strongRecurrence || weekdayWithTime || incomingTrigger)
    && /만들|작성|정리|요약|알려|확인|분류|초안|해\s*줘|해주세요|자동화|세팅|설정/u.test(text);
}

export function buildQuickAutomationPlan(request: string, departments: QuickPlanDepartment[], now = new Date()): QuickAutomationPlan {
  const text = request.trim();
  const active = departments.filter((department) => department.enabled);
  const matching = active.filter((department) => department.keywords.some((word) => word.trim() && text.toLowerCase().includes(word.toLowerCase())));
  const assigned = matching.length ? matching : active.slice(0, 1);
  const plan: QuickAutomationPlan = {
    request, trigger: null, whenLabel: '시작 조건을 입력해 주세요', usesDefaultTime: false,
    departmentIds: assigned.map((department) => department.id),
    sourceRequired: /자료|파일|문서|보고서|장부|정산|매출|거래|증빙|재고/u.test(text),
    needsMail: false, needsMessenger: /텔레그램|telegram|슬랙|slack|디스코드|discord|카카오|메신저/u.test(text),
    issues: [], notes: [externalBoundary],
  };
  if (!text) { plan.issues.push('반복할 업무를 한 줄로 입력해 주세요.'); return plan; }
  if (text.length > 5000) plan.issues.push('요청은 5,000자 안으로 입력해 주세요.');
  if (!active.length) plan.issues.push('자료·부서에서 담당 부서를 하나 이상 활성화해 주세요.');
  if (/매월|매달|월말|월간|격주|격일|평일|주말|공휴일|영업일|\d+\s*(?:분|시간|일|주)\s*(?:마다|간격)|특정\s*날짜|\d{1,2}\s*월\s*\d{1,2}\s*일|매시간|매분/u.test(text)) {
    plan.issues.push('간편 설정은 매일, 매주 한 요일, 새 메일 수신을 지원합니다. 월간·여러 날·시간 간격은 요청을 나누거나 실행 조건을 바꿔 주세요.');
  }
  if (/(?:이번|다음)\s*주|(?:내일|모레|오늘)\s*(?:부터|오전|오후|아침|저녁|밤|새벽|\d+\s*시)|\d{4}[-./]\d{1,2}[-./]\d{1,2}/u.test(text)) plan.issues.push('특정 날짜나 다음 주부터 시작하는 조건은 간편 설정에서 적용하지 않습니다. 직접 조건 설정에서 처음 실행할 일시를 지정해 주세요.');
  const emailEvent = /새\s*메일|메일(?:이|을)?\s*(?:새로\s*)?(?:오면|도착|받으면|수신)|문의(?:가)?\s*오면/u.test(text);
  const daily = /매일|매\s*아침/u.test(text);
  const dayMatches = [...text.matchAll(/([월화수목금토일])요일/gu)].map((match) => `${match[1]}요일`);
  const days = [...new Set(dayMatches)];
  const compactMultipleDays = /[월화수목금토일]{2,}요일/u.test(text);
  const weekly = /매주|[월화수목금토일]요일\s*마다/u.test(text);
  if (/(?:새\s*(?:파일|메시지|메세지)|파일.*들어오면|메시지.*오면|메세지.*오면)/u.test(text)) {
    plan.issues.push('파일 변경과 메신저 메시지 조건은 이 간편 설정에서 연결하지 않습니다. 메일·메신저 또는 기존 자동화 규칙에서 지원 범위를 확인해 주세요.');
  }
  if (plan.needsMessenger) plan.issues.push('메신저 연결은 메일·메신저에서 먼저 설정해 주세요. 간편 설정의 결과는 앱 안에서 확인합니다.');
  if (emailEvent) {
    plan.trigger = 'message'; plan.whenLabel = '승인한 메일함에 새 업무 메일이 오면'; plan.needsMail = true;
    // The incoming message is already a source. Separate company-file requests still need assigned records.
    plan.sourceRequired = /(?:회사|기존|등록|지정|보관).*?(?:자료|파일|양식|문서)|장부|매출|재고/u.test(text);
    if (daily || weekly) plan.issues.push('새 메일 수신과 정해진 시간을 한 규칙에 함께 적용할 수 없습니다. 시작 조건을 하나만 남겨 주세요.');
    const mailPrefix = text.match(/^(.*?)메일(?:이|을)?\s*(?:새로\s*)?(?:오면|도착|받으면|수신)/u)?.[1]?.trim();
    if (/때만|경우에?만|메일만|문의만|(?:제목|본문|발신자|수신자|키워드|보낸\s*사람).*(?:포함|있으면|있을|일치|같으면|경우|조건)|(?:포함|일치).*메일/u.test(text)
      || (mailPrefix !== undefined && !/^(?:(?:새|새로운)\s*)?(?:업무\s*)?$/u.test(mailPrefix))) {
      plan.issues.push('제목·발신자·키워드 같은 추가 수신 조건은 간편 설정에서 적용하지 않습니다. 모든 새 업무 메일로 바꾸거나 직접 조건 설정에서 지원하는 키워드를 지정해 주세요.');
    }
  } else if (daily || weekly) {
    plan.trigger = 'schedule'; plan.repeat = weekly ? 'weekly' : 'daily';
    if (daily && weekly) plan.issues.push('매일과 매주 조건 중 하나만 선택해 주세요.');
    if (weekly && days.length !== 1) plan.issues.push('매주 실행할 요일 하나를 적어 주세요. 예: 매주 월요일 오전 9시');
    if (days.length > 1 || compactMultipleDays || /[월화수목금토일]\s*[,·/]\s*[월화수목금토일]/u.test(text)) plan.issues.push('여러 요일은 각각의 자동화로 나누어 주세요. 요일을 임의로 바꾸지 않습니다.');
    const time = parseTime(text);
    if (time.issue) plan.issues.push(time.issue);
    plan.usesDefaultTime = time.isDefault;
    const timeLabel = `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
    plan.whenLabel = `${weekly ? `매주 ${days[0] || '요일 선택 필요'}` : '매일'} ${timeLabel}${time.isDefault ? ' · 시간 미지정, 기본 오전 9시' : ''}`;
    if (!time.issue && (!weekly || days.length === 1)) {
      const next = new Date(now); next.setHours(time.hour, time.minute, 0, 0);
      if (weekly) {
        next.setDate(next.getDate() + (weekdays.indexOf(days[0]) - next.getDay() + 7) % 7);
        if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 7);
      } else if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
      plan.nextRunAt = next.toISOString();
    }
    if (/메일함|(?:메일|문의).*(?:확인|읽|요약|분류)|(?:받은|도착한)\s*메일|gmail|outlook/iu.test(text)) {
      plan.needsMail = true;
      plan.sourceRequired = /(?:회사|기존|등록|지정|보관).*?(?:자료|파일|양식|문서)|장부|매출|재고/u.test(text);
      plan.notes.push('선택한 메일함의 최근 업무 메일을 최대 50건 확인하고, AI에는 최대 8건·약 4,000자를 발췌해 전달합니다. 해당 기간의 모든 메일을 확인했다는 뜻은 아닙니다.');
    }
  } else {
    plan.issues.push('시작 조건을 적어 주세요. 예: 매일 오전 9시, 매주 월요일 오전 9시, 새 메일이 오면');
  }
  if (/(?:캘린더|calendar).*(?:조회|확인|읽|충돌|요약)|(?:오늘|내일|기존)\s*일정.*(?:조회|확인|읽|충돌|요약)/iu.test(text)) plan.issues.push('캘린더 조회는 기존 일정 기능에서 연결해 주세요. 간편 자동화는 회사 자료와 연결한 업무 메일을 읽고 초안을 만듭니다.');
  if (plan.trigger === 'schedule') plan.notes.push('앱이 실행 중인 PC에서 확인합니다. 종료 중 밀린 예약은 다시 켰을 때 한 번 처리합니다.');
  if (plan.trigger === 'message') plan.notes.push('읽기 범위를 승인한 이후 도착한 업무 메일만 보안 분류를 거쳐 처리합니다.');
  plan.issues = [...new Set(plan.issues)];
  return plan;
}

function parseTime(text: string): { hour: number; minute: number; isDefault: boolean; issue?: string } {
  const matches = [...text.matchAll(/(?:(오전|오후|아침|저녁|밤|새벽)\s*)?(\d+)(?:\s*:\s*(\d+)|\s*시(?!간)(?:\s*(\d+)\s*분|\s*(반))?)/gu)];
  if (matches.length > 1) return { hour: 9, minute: 0, isDefault: false, issue: '한 자동화에 실행 시각 하나만 적어 주세요.' };
  if (!matches.length) {
    if (/(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|열한|열두|하나|둘|셋|넷)\s*시/u.test(text)) return { hour: 9, minute: 0, isDefault: false, issue: '실행 시각을 숫자로 적어 주세요. 예: 오전 10시' };
    if (/점심|정오/u.test(text)) return { hour: 12, minute: 0, isDefault: false };
    if (/자정/u.test(text)) return { hour: 0, minute: 0, isDefault: false };
    if (/오후|저녁|밤|새벽/u.test(text)) return { hour: 9, minute: 0, isDefault: false, issue: '실행 시각을 숫자로 적어 주세요. 예: 오후 6시 30분' };
    return { hour: 9, minute: 0, isDefault: true };
  }
  const [, period, rawHour, colonMinute, minuteText, half] = matches[0];
  let hour = Number(rawHour); const minute = half ? 30 : Number(colonMinute || minuteText || 0);
  if (hour > 23 || minute > 59 || (period && (hour > 12 || (hour < 1 && period !== '새벽')))) return { hour, minute, isDefault: false, issue: '시각은 00:00~23:59 범위로 입력해 주세요.' };
  if (period) { const midnight = period === '밤' && hour === 12; hour %= 12; if (!midnight && ['오후', '저녁', '밤'].includes(period)) hour += 12; }
  return { hour, minute, isDefault: false };
}

export function normalizeQuickAutomationRoot(root: string): string { return root.replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase(); }
export function readQuickAutomationDraft(raw: string | null, root: string): QuickAutomationDraft | null {
  if (!raw || !root.trim()) return null;
  try {
    const value = JSON.parse(raw) as Partial<QuickAutomationDraft>;
    if (typeof value.request !== 'string' || value.request.length > 5000 || typeof value.root !== 'string' || normalizeQuickAutomationRoot(value.root) !== normalizeQuickAutomationRoot(root)
      || typeof value.setupId !== 'string' || !/^[a-zA-Z0-9:_-]{8,120}$/u.test(value.setupId) || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return null;
    if (value.nextRunAt !== undefined && (typeof value.nextRunAt !== 'string' || !Number.isFinite(Date.parse(value.nextRunAt)))) return null;
    return { request: value.request, root, setupId: value.setupId, createdAt: value.createdAt, saved: value.saved === true, connectionId: typeof value.connectionId === 'string' ? value.connectionId : undefined, nextRunAt: value.nextRunAt };
  } catch { return null; }
}
