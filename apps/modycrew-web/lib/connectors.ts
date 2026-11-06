/**
 * UI 용 connector 타입 (Phase 3 PoC).
 *
 * 도메인의 `modyQuickConnectToolProfiles` 를 사용자 시각으로 재구성합니다.
 * - 카테고리로 그룹화해 "메일 연결하기 / 메신저 연결하기" 같은 자연스러운
 *   사용 흐름으로 보여줌
 * - 각 connector 가 어떤 트리거 소스가 되는지 명시 (재고→발주 같은 자동화의
 *   기점이 어디인지 사용자가 한눈에 봄)
 * - 보안 입력 방식별 라벨/주의를 명확히
 *
 * Phase 4 에서 도메인 패키지 직접 import 로 교체.
 */

export type ConnectorCategory =
  | "mail"
  | "messenger"
  | "calendar"
  | "inquiry"
  | "booking"
  | "workspace"
  | "ai"
  | "business_system"
  | "local";

export type ConnectorMethod =
  | "oauth"
  | "bot_token"
  | "api_key"
  | "imap_smtp"
  | "site_login"
  | "local_permission";

export type ConnectorStatus =
  | "not_connected"
  | "ready_for_health_check"
  | "connected"
  | "needs_repair"
  | "expired";

export type ConnectorTriggerKind =
  | "mail_arrived"
  | "inquiry_arrived"
  | "booking_changed"
  | "calendar_event"
  | "inventory_low"
  | "messenger_command"
  | "document_added"
  | "manual_only";

export type ConnectorGuideStep = {
  title: string;
  description: string;
  checklist: string[];
  actionLabel?: string;
  actionHref?: string;
  canSkip?: boolean;
};

export type ConnectorSetupGuide = {
  assistantIntro: string;
  expertSkipLabel: string;
  steps: ConnectorGuideStep[];
};

export type ConnectorPostConnectPlan = {
  title: string;
  items: string[];
};

export type ConnectorWorkPreviewItem = {
  label: string;
  detail: string;
};

export type ConnectorWorkPreview = {
  title: string;
  cadence: string;
  items: ConnectorWorkPreviewItem[];
  approvalNote: string;
};

export type ConnectorImapPreset = {
  label: string;
  host: string;
  port: number;
  userHint: string;
};

/** 커넥터 id → public/connector-brand-icons/<slug>.svg.
 *  로고 자산은 `npm run assets:connector-icons` 로 simple-icons 에서 생성한다.
 *  simple-icons v16 에 Microsoft·Slack·OpenAI 가 없어 그 제품들은 글자 배지로 남는다. */
const connectorBrandIconSlugs: Record<string, string> = {
  gmail: "gmail",
  "naver-mail": "naver",
  "daum-kakao-mail": "kakao",
  "telegram-bot": "telegram",
  "discord-app": "discord",
  "kakao-channel": "kakao",
  "kakaotalk-local-app": "kakao",
  "naver-talktalk": "naver",
  "google-calendar": "google-calendar",
  "naver-booking": "naver",
  "kakao-booking": "kakao",
  "google-drive": "google-drive",
  "notion-workspace": "notion",
  "figma-design": "figma",
  "google-gemini": "google-gemini",
  "anthropic-claude": "claude",
};

/** 제품 썸네일 경로. 브랜드 로고가 없는 커넥터는 null → 호출부가 iconText 로 폴백한다. */
export function connectorBrandIconSrc(connectorId: string): string | null {
  const slug = connectorBrandIconSlugs[connectorId];
  return slug ? `/connector-brand-icons/${slug}.svg` : null;
}

export type ConnectorDefinition = {
  id: string;
  label: string;
  iconText: string;
  category: ConnectorCategory;
  shortDescription: string;
  /** 자동화의 시작점이 되는 트리거들 — "이 도구에서 무슨 일이 생기면 AI가 일을 받는가" */
  triggers: ConnectorTriggerKind[];
  method: ConnectorMethod;
  officialFirst: boolean;
  warning?: string;
  status: ConnectorStatus;
  /** 추천 점수 (사용 목적 매칭 + 공식 우선 + 인기). 정렬용 */
  recommendScore: number;
  /** 연결 전에 사용자가 준비하면 좋은 항목 */
  preparation?: string[];
  /** IMAP 계열에서 사용자가 서버 주소를 외우지 않도록 제공하는 빠른 입력값 */
  imapPresets?: ConnectorImapPreset[];
  /** 일반 사용자가 따라 할 수 있는 단계별 연결 동행 가이드 */
  setupGuide?: ConnectorSetupGuide;
  /** 연결이 끝나면 사용자가 바로 체감하는 AI 업무 흐름 */
  afterConnect?: ConnectorPostConnectPlan;
  /** 연결 직후 AI가 읽고, 제안하고, 승인 대기로 올리는 실제 업무 미리보기 */
  workPreview?: ConnectorWorkPreview;
  /** 연결이 안 될 때 일반 사용자가 먼저 확인할 항목 */
  troubleshooting?: string[];
};

export const triggerLabels: Record<ConnectorTriggerKind, string> = {
  mail_arrived: "메일 도착",
  inquiry_arrived: "문의 도착",
  booking_changed: "예약 변경",
  calendar_event: "일정 변화",
  inventory_low: "재고 부족",
  messenger_command: "메신저 명령",
  document_added: "자료 추가",
  manual_only: "수동 트리거",
};

export const categoryLabels: Record<ConnectorCategory, string> = {
  mail: "메일",
  messenger: "메신저",
  calendar: "캘린더",
  inquiry: "문의/폼",
  booking: "예약 플랫폼",
  workspace: "협업/문서",
  ai: "AI 엔진",
  business_system: "사내 시스템",
  local: "로컬 폴더",
};

export const methodLabels: Record<ConnectorMethod, string> = {
  oauth: "계정 동의",
  bot_token: "메신저 승인값",
  api_key: "공식 연결 키",
  imap_smtp: "메일함 연결",
  site_login: "사이트 로그인",
  local_permission: "폴더 선택",
};

const gmailGuide: ConnectorSetupGuide = {
  assistantIntro:
    "Gmail은 복잡한 서버 주소를 외울 필요 없이 Google 동의 창을 따라가면 됩니다. ModyCrew는 먼저 읽기 중심으로 연결하고, 답장 발송은 승인 뒤에만 진행합니다.",
  expertSkipLabel: "Google 계정 동의 연결을 이미 알면 바로 진행",
  steps: [
    {
      title: "연결할 Google 계정 고르기",
      description: "업무 메일이 들어오는 Google 계정을 준비합니다. 개인 계정과 회사 계정이 다르면 회사 업무 계정을 선택하세요.",
      checklist: ["브라우저에 Google 로그인", "업무 메일함 확인", "공유 PC라면 다른 계정 로그아웃"],
      actionLabel: "Gmail 열기",
      actionHref: "https://mail.google.com/",
    },
    {
      title: "권한 내용 확인하기",
      description: "동의 창에서 ModyCrew가 요청하는 범위를 확인합니다. 처음 연결은 메일 읽기와 상태 확인 중심으로 안내합니다.",
      checklist: ["읽기 권한인지 확인", "발송/삭제 권한이 있으면 승인 정책 확인", "회사 계정은 관리자 정책 확인"],
    },
    {
      title: "연결 상태 점검하기",
      description: "동의가 끝나면 ModyCrew가 최신 메일 제목을 읽을 수 있는지만 확인합니다. 메일 원문과 보안값 원문은 화면에 남기지 않습니다.",
      checklist: ["최신 메일 읽기 테스트", "광고/업무 분류 준비", "외부 발송은 승인 대기로 고정"],
    },
  ],
};

const outlookGuide: ConnectorSetupGuide = {
  assistantIntro:
    "Outlook과 Microsoft 365는 회사 정책이 중요합니다. ModyCrew는 동의 창을 열기 전 어떤 계정을 써야 하는지부터 같이 확인합니다.",
  expertSkipLabel: "Microsoft 계정 동의 연결을 이미 알면 바로 진행",
  steps: [
    {
      title: "회사 Microsoft 계정 확인",
      description: "Outlook 메일과 캘린더가 붙어 있는 계정을 준비합니다. 회사 tenant는 관리자가 외부 앱 연결을 막아둘 수 있습니다.",
      checklist: ["업무 계정 로그인", "Outlook 메일함 접근 가능 확인", "관리자 승인 필요 여부 확인"],
      actionLabel: "Outlook 열기",
      actionHref: "https://outlook.office.com/mail/",
    },
    {
      title: "동의 범위 확인",
      description: "메일 읽기, 캘린더 읽기처럼 필요한 권한만 켭니다. 일정 생성과 발송은 승인 후 실행 범위로 남깁니다.",
      checklist: ["메일 읽기 권한 확인", "캘린더 읽기 권한 확인", "쓰기 권한은 승인 정책과 함께 확인"],
    },
    {
      title: "읽기 테스트",
      description: "연결 뒤 최신 메일과 일정 가능 시간을 읽을 수 있는지 확인합니다.",
      checklist: ["최신 메일 제목 확인", "캘린더 가능한 시간 확인", "실패하면 관리자 정책 안내"],
    },
  ],
};

const googleCalendarGuide: ConnectorSetupGuide = {
  assistantIntro:
    "Google Calendar는 먼저 읽기 권한으로 바쁜 시간과 1주일 일정을 확인합니다. 일정 등록은 사용자가 최종 승인할 때만 쓰기 권한으로 다시 연결합니다.",
  expertSkipLabel: "Google Calendar 권한을 이미 알면 바로 동의 창으로",
  steps: [
    {
      title: "업무 캘린더 계정 고르기",
      description: "미팅과 마감이 들어 있는 Google 계정을 선택합니다. 개인 캘린더와 회사 캘린더가 다르면 실제 업무 일정이 있는 계정을 고르세요.",
      checklist: ["Google 계정 로그인", "업무 캘린더 접근 확인", "공유 캘린더 권한 확인"],
      actionLabel: "Google Calendar 열기",
      actionHref: "https://calendar.google.com/",
    },
    {
      title: "읽기 권한으로 시작",
      description: "처음에는 freeBusy와 일정 읽기 중심으로 연결합니다. AI는 오늘 할 일, 마감 임박, 미팅 알림, 1주일 브리핑을 만들 수 있습니다.",
      checklist: ["바쁜 시간 확인", "1주일 일정 읽기", "일정 생성은 아직 실행하지 않음"],
    },
    {
      title: "일정 등록은 쓰기 권한으로 재확인",
      description: "메일에서 미팅 요청을 찾더라도 실제 캘린더 등록은 앱 최종 승인 화면과 쓰기 권한 연결을 모두 통과해야 합니다.",
      checklist: ["일정 승인 요약 확인", "참석자/장소/알림 확인", "승인 후 calendar.events 권한 사용"],
    },
  ],
};

const outlookCalendarGuide: ConnectorSetupGuide = {
  assistantIntro:
    "Outlook Calendar는 Microsoft 365 정책을 확인하면서 연결합니다. 먼저 일정 읽기와 가능한 시간 확인으로 시작하고, 등록은 승인 뒤에만 진행합니다.",
  expertSkipLabel: "Microsoft Calendar 권한을 이미 알면 바로 진행",
  steps: [
    {
      title: "업무 Microsoft 계정 확인",
      description: "회사 Outlook 일정이 들어 있는 Microsoft 365 계정을 준비합니다. 조직 정책에 따라 관리자 승인이 필요할 수 있습니다.",
      checklist: ["Outlook Calendar 로그인", "업무 캘린더 접근 확인", "관리자 앱 동의 정책 확인"],
      actionLabel: "Outlook Calendar 열기",
      actionHref: "https://outlook.office.com/calendar/",
    },
    {
      title: "읽기 범위부터 연결",
      description: "일정 후보와 미팅 알림을 만들기 위해 Calendar 읽기와 가능 시간 확인부터 연결합니다.",
      checklist: ["일정 읽기 권한 확인", "getSchedule 확인", "외부 변경 없음"],
    },
    {
      title: "등록이 필요하면 쓰기 범위 재연결",
      description: "메일에서 미팅 일정을 확정하려면 Calendars.ReadWrite 범위를 다시 확인합니다. 등록은 앱 최종 확인 뒤에만 실행됩니다.",
      checklist: ["Calendars.ReadWrite 확인", "일정 승인 요약 확인", "최종 사용자 확인"],
    },
  ],
};

const naverMailGuide: ConnectorSetupGuide = {
  assistantIntro:
    "NAVER 메일은 메일 주소와 앱 비밀번호만 먼저 준비하면 됩니다. 서버 주소와 포트는 ModyCrew가 기본값으로 채워둡니다.",
  expertSkipLabel: "서버값을 직접 아는 경우만 고급 설정으로",
  steps: [
    {
      title: "NAVER 메일 설정 열기",
      description: "NAVER 메일에서 환경설정으로 들어가 외부 메일 읽기 사용을 켭니다.",
      checklist: ["NAVER 메일 로그인", "환경설정 열기", "외부 메일 읽기 사용함 선택"],
      actionLabel: "NAVER 메일 열기",
      actionHref: "https://mail.naver.com/",
    },
    {
      title: "앱 비밀번호 준비",
      description: "일반 로그인 비밀번호를 넣지 않습니다. 2단계 인증을 쓰는 계정은 앱 비밀번호를 만들어 붙여넣습니다.",
      checklist: ["2단계 인증 상태 확인", "앱 비밀번호 발급", "발급 직후 복사"],
    },
    {
      title: "메일 주소 입력",
      description: "NAVER 메일 주소와 앱 비밀번호를 입력하면 서버값은 자동으로 채워집니다.",
      checklist: ["메일 주소 입력", "메일 연결 비밀번호 입력", "서버/포트는 고급 설정에만 표시"],
    },
    {
      title: "읽기 전용 점검",
      description: "최신 메일 제목을 읽을 수 있는지만 확인합니다. 답장 발송은 승인 전까지 하지 않습니다.",
      checklist: ["최신 메일 읽기 테스트", "실패 시 외부 메일 읽기 사용 여부 재확인", "비밀번호 원문 저장 금지 확인"],
    },
  ],
};

const daumKakaoMailGuide: ConnectorSetupGuide = {
  assistantIntro:
    "Daum/Kakao 메일은 메일 종류를 고르면 서버값을 자동으로 넣어둡니다. 사용자는 메일 주소와 앱 비밀번호만 먼저 확인하면 됩니다.",
  expertSkipLabel: "서버값을 직접 아는 경우만 고급 설정으로",
  steps: [
    {
      title: "Daum 또는 Kakao 메일 설정 열기",
      description: "사용 중인 메일 서비스의 환경설정에서 외부 메일 읽기 사용을 켭니다. Daum 메일과 Kakao 메일은 서버 주소가 다를 수 있습니다.",
      checklist: ["메일 로그인", "환경설정 열기", "외부 메일 읽기 사용함 선택", "Daum/Kakao 중 실제 사용하는 메일 확인"],
      actionLabel: "Kakao Mail 열기",
      actionHref: "https://mail.kakao.com/",
    },
    {
      title: "앱 비밀번호 준비",
      description: "일반 로그인 비밀번호를 넣지 않습니다. 2단계 인증을 쓰면 앱 비밀번호를 발급해 붙여넣습니다.",
      checklist: ["2단계 인증 확인", "앱 비밀번호 발급", "비밀번호 원문 공유 금지"],
    },
    {
      title: "메일 종류 선택",
      description: "Kakao Mail 또는 Daum Mail을 고르면 필요한 서버값은 자동으로 채워집니다.",
      checklist: ["Kakao 또는 Daum 선택", "메일 주소 입력", "메일 연결 비밀번호 입력"],
    },
    {
      title: "읽기 전용 점검",
      description: "최신 메일 제목을 읽을 수 있는지만 확인합니다. 답장 발송은 앱 최종 확인 전까지 실행하지 않습니다.",
      checklist: ["최신 메일 읽기 테스트", "업무/광고 분류", "외부 발송은 승인 대기로 유지"],
    },
  ],
};

const companyMailGuide: ConnectorSetupGuide = {
  assistantIntro:
    "회사/그룹웨어/공공기관 같은 일반 메일은 먼저 업무 메일 주소만 넣어도 됩니다. 자동으로 안 되면 그때 회사 전산 담당자에게 받은 고급 설정을 입력합니다.",
  expertSkipLabel: "회사 전산 담당자에게 받은 값이 있으면 고급 설정으로",
  steps: [
    {
      title: "업무 메일 주소부터 입력",
      description: "평소 쓰는 회사, 그룹웨어, 기관 메일 주소를 먼저 입력합니다. 가능한 기본 서버값은 ModyCrew가 자동으로 잡아봅니다.",
      checklist: ["업무 메일 주소", "메일 연결 비밀번호", "회사/기관 외부 연결 허용 여부"],
    },
    {
      title: "보안 정책 확인",
      description: "공공기관, 병원, 협회, 회사 메일은 외부 프로그램 연결이 금지되어 있을 수 있습니다.",
      checklist: ["외부 메일 연결 허용 여부", "사내망/VPN 필요 여부", "읽기 전용 연결 허용 여부"],
    },
    {
      title: "안 될 때만 고급 설정",
      description: "자동 연결이 실패하면 회사 전산 담당자가 알려준 메일 서버와 포트를 고급 설정에 넣습니다.",
      checklist: ["메일 서버 직접 입력", "포트 직접 입력", "앱 비밀번호 또는 별도 암호 입력"],
    },
    {
      title: "업무 메일 분류 테스트",
      description: "연결 뒤 광고/공지/업무 메일이 구분되는지 읽기 전용으로 확인합니다.",
      checklist: ["최신 메일 제목 확인", "중요 발신자/키워드 우선 확인", "스팸·광고·뉴스레터·자동 알림 기본 제외", "외부 발송은 승인 대기로 유지"],
    },
  ],
};

const telegramGuide: ConnectorSetupGuide = {
  assistantIntro:
    "Telegram 연결은 BotFather에서 봇을 만들고 토큰을 붙여넣는 과정입니다. 처음 쓰는 사람도 앱 설치부터 차례대로 따라가면 됩니다.",
  expertSkipLabel: "봇토큰을 이미 가지고 있으면 입력으로 건너뛰기",
  steps: [
    {
      title: "Telegram 앱 설치와 로그인",
      description: "휴대폰이나 PC에 Telegram을 설치하고 본인 번호로 로그인합니다. 이미 쓰고 있다면 이 단계는 건너뛰어도 됩니다.",
      checklist: ["Telegram 설치", "전화번호 로그인", "알림 수신 가능 확인"],
      actionLabel: "Telegram 열기",
      actionHref: "https://telegram.org/apps",
      canSkip: true,
    },
    {
      title: "BotFather 검색",
      description: "Telegram 검색창에서 BotFather를 찾습니다. 파란 인증 표시가 있는 공식 BotFather를 선택하세요.",
      checklist: ["검색창에 BotFather 입력", "공식 인증 표시 확인", "대화 시작 버튼 누르기"],
      actionLabel: "BotFather 열기",
      actionHref: "https://t.me/BotFather",
    },
    {
      title: "새 봇 만들기",
      description: "BotFather 대화창에 /newbot을 입력하고, 봇 이름과 username을 정합니다. username은 bot으로 끝나야 합니다.",
      checklist: ["/newbot 입력", "사람이 볼 봇 이름 입력", "영문 username 입력", "username 끝에 bot 포함"],
    },
    {
      title: "봇 인증값 복사",
      description: "BotFather가 긴 인증값을 보내줍니다. 이 값은 비밀번호처럼 다뤄야 하며 다른 사람에게 보내면 안 됩니다.",
      checklist: ["인증값 전체 복사", "메신저나 문서에 공유하지 않기", "필요하면 BotFather에서 재발급 가능"],
    },
    {
      title: "ModyCrew에 붙여넣고 점검",
      description: "아래 입력칸에 인증값을 붙여넣으면 데스크톱 앱이 안전 저장소에 넣고 연결 점검을 실행할 수 있습니다.",
      checklist: ["봇 인증값 입력", "연결하기 클릭", "성공하면 업무 보고/명령 수신 준비"],
    },
  ],
};

const discordGuide: ConnectorSetupGuide = {
  assistantIntro:
    "Discord는 개발자 포털에서 봇을 만들고 서버에 초대해야 합니다. 일반 사용자는 Telegram보다 단계가 많으니 천천히 따라가게 안내합니다.",
  expertSkipLabel: "Discord 봇 인증값이 있으면 입력으로",
  steps: [
    {
      title: "Discord Developer Portal 열기",
      description: "Discord 계정으로 개발자 포털에 들어가 새 애플리케이션을 만듭니다.",
      checklist: ["Discord 로그인", "New Application 선택", "앱 이름 입력"],
      actionLabel: "Developer Portal 열기",
      actionHref: "https://discord.com/developers/applications",
    },
    {
      title: "봇 추가와 인증값 복사",
      description: "Bot 메뉴에서 봇을 추가하고 인증값을 복사합니다. 인증값은 다시 보기 어려울 수 있으니 바로 붙여넣습니다.",
      checklist: ["Bot 메뉴 열기", "Add Bot", "인증값 재발급 또는 복사"],
    },
    {
      title: "서버 초대",
      description: "초대 링크 생성 화면에서 봇 권한을 골라 내 서버에 초대합니다.",
      checklist: ["봇 권한 선택", "필요 권한만 선택", "서버에 초대"],
    },
  ],
};

const apiKeyGuide: ConnectorSetupGuide = {
  assistantIntro:
    "연결 키 방식은 발급 위치만 알면 간단하지만, 키 원문을 안전하게 다루는 것이 중요합니다. ModyCrew는 키를 화면이나 리포트에 다시 보여주지 않습니다.",
  expertSkipLabel: "연결 키가 있으면 입력으로",
  steps: [
    {
      title: "공식 설정 화면에서 연결 키 발급",
      description: "도구의 공식 설정 화면에서 새 연결 키를 만듭니다.",
      checklist: ["공식 설정 화면 로그인", "새 연결 키 생성", "가능하면 읽기/초안 범위로 제한"],
    },
    {
      title: "키 붙여넣기",
      description: "발급 직후 아래 입력칸에 붙여넣습니다. 저장 후에는 원문을 다시 표시하지 않습니다.",
      checklist: ["연결 키 전체 복사", "ModyCrew에 붙여넣기", "원문 공유 금지"],
    },
  ],
};

const mailAfterConnect: ConnectorPostConnectPlan = {
  title: "연결 후 바로 되는 일",
  items: [
    "새 메일을 업무/광고/확인 필요로 분류하고 스팸·프로모션·뉴스레터·자동 알림은 기본 제외합니다.",
    "일정 요청이나 마감 표현이 있으면 오늘 할 일과 마감 브리핑 후보로 올립니다.",
    "중요 발신자와 키워드는 사용자가 추가할 수 있고, 제외 기준은 나중에 언제든 해제할 수 있습니다.",
    "답장 초안과 캘린더 등록 후보는 만들지만 외부 발송과 등록은 승인 전 실행하지 않습니다.",
  ],
};

const mailWorkPreview: ConnectorWorkPreview = {
  title: "메일이 오면 AI가 먼저 업무 신호를 골라냅니다",
  cadence: "홈의 오늘 업무 한번에 확인, 트레이 지금 업무 점검, 사용자가 켠 자동화 주기에서 실행",
  items: [
    {
      label: "읽기",
      detail: "새 메일 제목과 본문 일부를 읽기 전용으로 확인하고 광고/업무/확인 필요를 나눕니다.",
    },
    {
      label: "제안",
      detail: "일정 확인, 마감, 답장 필요 메일을 찾으면 오늘 할 일과 답장 초안 후보로 만듭니다.",
    },
    {
      label: "승인",
      detail: "메일 발송, 캘린더 등록, 파일 공유는 인박스 승인 카드와 최종 확인 전에는 실행하지 않습니다.",
    },
  ],
  approvalNote: "연결 직후에는 읽기와 초안 생성만 켜지고, 외부 답장은 사용자가 누른 최종 승인 뒤에만 가능합니다.",
};

const calendarAfterConnect: ConnectorPostConnectPlan = {
  title: "연결 후 일정 관리",
  items: [
    "매일 앞으로 1주일 일정과 마감을 브리핑합니다.",
    "미팅은 하루 전, 3시간 전, 30분 전 기준으로 알림 후보를 만듭니다.",
    "마감이 1시간 이내면 더 촘촘히 확인하고 널널한 일정은 하루 요약으로 묶습니다.",
  ],
};

const calendarWorkPreview: ConnectorWorkPreview = {
  title: "캘린더를 읽고 오늘/이번 주 우선순위를 계속 정리합니다",
  cadence: "매일 1주일 브리핑, 미팅 하루 전/3시간 전/30분 전, 마감 임박 시 더 촘촘한 확인",
  items: [
    {
      label: "읽기",
      detail: "앞으로 1주일 일정과 바쁜 시간을 읽어 미팅, 마감, 여유 시간을 구분합니다.",
    },
    {
      label: "제안",
      detail: "메일의 일정 요청과 캘린더 가능 시간을 맞춰 후보 시간, 알림, 일정 등록 초안을 만듭니다.",
    },
    {
      label: "승인",
      detail: "실제 일정 등록은 등록 권한, 실행 전 검토, 사용자 최종 확인을 모두 통과해야 실행됩니다.",
    },
  ],
  approvalNote: "읽기 연결만으로도 브리핑은 가능하지만 일정 등록은 쓰기 권한 재연결과 앱 최종 승인이 필요합니다.",
};

const messengerAfterConnect: ConnectorPostConnectPlan = {
  title: "연결 후 보고/승인 흐름",
  items: [
    "승인 대기 업무와 일정 브리핑을 사용자가 켠 채널로 보낼 수 있습니다.",
    "메신저 답장은 앱 인박스에 의사 기록으로 남고 실제 발송/등록은 앱에서 다시 확인합니다.",
    "급한 마감은 더 자주 보고하고 일반 일정은 요약으로 묶습니다.",
  ],
};

const documentAfterConnect: ConnectorPostConnectPlan = {
  title: "연결 후 자료 정리",
  items: [
    "새 문서와 공유 파일을 업무 자료 후보로 모읍니다.",
    "인수인계서, 보고서 양식, 가격표처럼 반복 기준이 되는 자료를 우선 읽습니다.",
    "원본 수정, 공유, 외부 전달은 승인 전 실행하지 않습니다.",
  ],
};

const documentWorkPreview: ConnectorWorkPreview = {
  title: "자료가 들어오면 AI가 업무 기준과 보고 초안을 만듭니다",
  cadence: "사용자가 허용한 폴더/공유 자료 범위에서 수동 점검 또는 켜진 자동화 주기로 실행",
  items: [
    {
      label: "읽기",
      detail: "선택한 파일과 공유 문서의 제목, 본문, 표 내용을 읽기 전용으로 추출합니다.",
    },
    {
      label: "학습",
      detail: "기존 보고서 양식, 인수인계서, 가격표를 업무 기준으로 요약해 다음 작업에 반영합니다.",
    },
    {
      label: "승인",
      detail: "문서 생성, 파일 공유, 외부 제출은 승인 카드와 최종 확인 전에는 실행하지 않습니다.",
    },
  ],
  approvalNote: "자료 연결은 읽기와 초안 생성부터 시작하고, 원본 변경과 공유는 사용자가 승인할 때만 진행합니다.",
};

const commonOAuthTroubleshooting = [
  "동의 창이 안 뜨면 브라우저 팝업 차단과 기본 브라우저 설정을 확인하세요.",
  "회사 계정은 관리자 앱 동의 정책 때문에 실패할 수 있습니다.",
  "연결 후에도 안 보이면 데스크톱 앱을 켠 상태에서 연결 상태 점검을 다시 누르세요.",
];

const commonImapTroubleshooting = [
  "일반 로그인 비밀번호가 아니라 메일 서비스에서 만든 앱 비밀번호를 입력했는지 확인하세요.",
  "외부 메일 연결 사용이 켜져 있는지 확인하세요.",
  "회사 메일은 사내망/VPN이나 관리자 허용이 필요할 수 있습니다.",
];

export const sampleConnectors: ConnectorDefinition[] = [
  // 메일
  {
    id: "gmail",
    label: "Gmail",
    iconText: "G",
    category: "mail",
    shortDescription: "Google 메일 계정 동의 연결. 받은 메일을 업무 인박스로.",
    triggers: ["mail_arrived"],
    method: "oauth",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 95,
    preparation: ["Google 업무 계정", "브라우저 로그인", "회사 관리자 계정 연결 정책 확인"],
    setupGuide: gmailGuide,
    afterConnect: mailAfterConnect,
    workPreview: mailWorkPreview,
    troubleshooting: commonOAuthTroubleshooting,
  },
  {
    id: "outlook",
    label: "Outlook / Microsoft 365",
    iconText: "O",
    category: "mail",
    shortDescription: "Microsoft Graph 읽기 권한. 회사 메일을 자동 분류.",
    triggers: ["mail_arrived", "calendar_event"],
    method: "oauth",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 88,
    preparation: ["Microsoft 365 업무 계정", "Outlook 메일함 접근", "관리자 앱 동의 정책 확인"],
    setupGuide: outlookGuide,
    afterConnect: mailAfterConnect,
    workPreview: mailWorkPreview,
    troubleshooting: commonOAuthTroubleshooting,
  },
  {
    id: "naver-mail",
    label: "NAVER 메일",
    iconText: "N",
    category: "mail",
    shortDescription: "메일 주소와 앱 비밀번호로 최신 메일 읽기.",
    triggers: ["mail_arrived"],
    method: "imap_smtp",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 80,
    preparation: ["NAVER 메일 주소", "메일 연결 비밀번호", "외부 메일 사용 허용"],
    imapPresets: [
      { label: "NAVER 기본값", host: "imap.naver.com", port: 993, userHint: "you@naver.com" },
    ],
    setupGuide: naverMailGuide,
    afterConnect: mailAfterConnect,
    workPreview: mailWorkPreview,
    troubleshooting: commonImapTroubleshooting,
  },
  {
    id: "daum-kakao-mail",
    label: "Daum / Kakao 메일",
    iconText: "D",
    category: "mail",
    shortDescription: "메일 주소와 앱 비밀번호로 읽기 전용 연결.",
    triggers: ["mail_arrived"],
    method: "imap_smtp",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 70,
    preparation: ["Daum 또는 Kakao 메일 주소", "메일 연결 비밀번호", "외부 메일 사용 허용"],
    imapPresets: [
      { label: "Kakao Mail", host: "imap.kakao.com", port: 993, userHint: "you@kakao.com" },
      { label: "Daum Mail", host: "imap.daum.net", port: 993, userHint: "you@daum.net" },
    ],
    setupGuide: daumKakaoMailGuide,
    afterConnect: mailAfterConnect,
    workPreview: mailWorkPreview,
    troubleshooting: commonImapTroubleshooting,
  },
  {
    id: "company-mail",
    label: "회사/일반 메일",
    iconText: "M",
    category: "mail",
    shortDescription: "학교, 대학, 회사, 그룹웨어, 공공기관 메일. 주소만 넣으면 서버를 자동으로 찾습니다.",
    triggers: ["mail_arrived"],
    method: "imap_smtp",
    officialFirst: true,
    warning: "회사 정책상 외부 도구 연결 허용 여부를 관리자와 확인하세요.",
    status: "not_connected",
    recommendScore: 65,
    preparation: ["회사/기관 메일 주소", "메일 연결 비밀번호", "외부 메일 연결 허용 여부"],
    setupGuide: companyMailGuide,
    afterConnect: mailAfterConnect,
    workPreview: mailWorkPreview,
    troubleshooting: commonImapTroubleshooting,
  },

  // 메신저
  {
    id: "telegram-bot",
    label: "Telegram Bot",
    iconText: "T",
    category: "messenger",
    shortDescription: "BotFather 인증값. 명령 수신 + 업무 보고 전송.",
    triggers: ["messenger_command"],
    method: "bot_token",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 90,
    setupGuide: telegramGuide,
    afterConnect: messengerAfterConnect,
    troubleshooting: [
      "BotFather 인증값 전체를 복사했는지 확인하세요.",
      "승인 알림을 받으려면 chat_id 또는 채널 username을 별도로 입력하세요.",
      "봇에게 먼저 말을 걸어야 getUpdates로 대화를 찾을 수 있습니다.",
    ],
  },
  {
    id: "slack-app",
    label: "Slack",
    iconText: "S",
    category: "messenger",
    shortDescription: "Slack 봇 인증값. 채널 메시지 + 명령어 처리.",
    triggers: ["messenger_command"],
    method: "bot_token",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 85,
    afterConnect: messengerAfterConnect,
    troubleshooting: commonOAuthTroubleshooting,
    setupGuide: {
      assistantIntro:
        "Slack은 워크스페이스에 앱을 설치하고 앱 인증값을 저장하는 방식입니다. ModyCrew가 필요한 권한을 설명하고, 설치 후에는 승인·수정 요청 같은 안전한 명령부터 연결합니다.",
      expertSkipLabel: "Slack 봇 인증값이 있으면 입력으로",
      steps: [
        {
          title: "워크스페이스 선택",
          description: "업무에 쓰는 Slack 워크스페이스에 로그인합니다. 개인 워크스페이스와 회사 워크스페이스를 헷갈리지 않게 확인하세요.",
          checklist: ["Slack 로그인", "업무 워크스페이스 선택", "앱 설치 권한 확인"],
          actionLabel: "Slack 열기",
          actionHref: "https://slack.com/signin",
        },
        {
          title: "권한 확인",
          description: "명령 수신, 메시지 읽기, 알림 전송처럼 필요한 범위만 확인하고 앱 인증값을 복사합니다.",
          checklist: ["명령 또는 멘션 권한", "메시지 전송 권한", "앱 인증값 복사", "관리자 승인 필요 여부"],
        },
        {
          title: "테스트 채널 선택",
          description: "처음에는 전체 회사 채널보다 테스트 채널에서 업무 보고와 승인 명령을 확인합니다.",
          checklist: ["테스트 채널 선택", "channel id 확인", "보고 메시지 테스트", "실행은 앱 승인으로 유지"],
        },
      ],
    },
  },
  {
    id: "discord-app",
    label: "Discord",
    iconText: "D",
    category: "messenger",
    shortDescription: "Discord Bot. 서버 메시지 + slash 명령.",
    triggers: ["messenger_command"],
    method: "bot_token",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 70,
    setupGuide: discordGuide,
    troubleshooting: [
      "Developer Portal에서 복사한 봇 인증값 전체를 넣었는지 확인하세요.",
      "승인 알림을 받으려면 guild/channel id 또는 채널 이름을 함께 저장하세요.",
      "서버 초대 권한이 없으면 앱 내부 메인 컨트롤 채널로 먼저 사용하세요.",
    ],
  },
  {
    id: "kakao-channel",
    label: "Kakao 채널",
    iconText: "K",
    category: "messenger",
    shortDescription: "비즈니스 채널 계정 동의 연결. 채널 정책 확인 후 사용.",
    triggers: ["inquiry_arrived"],
    method: "oauth",
    officialFirst: true,
    warning: "Kakao 비즈니스 채널 사용은 일부 업종 정책 확인이 필요합니다.",
    status: "not_connected",
    recommendScore: 75,
    setupGuide: {
      assistantIntro:
        "Kakao 채널은 공식 정책과 비즈니스 권한 확인이 먼저입니다. 연결 가능 범위를 확인하기 전에는 자동 실행을 켜지 않습니다.",
      expertSkipLabel: "비즈니스 채널 권한을 이미 확인했으면 계정 동의로",
      steps: [
        {
          title: "비즈니스 채널 확인",
          description: "사용 중인 카카오 채널이 비즈니스 채널인지 확인합니다.",
          checklist: ["채널 관리자 접근", "비즈니스 인증 상태 확인", "업종 정책 확인"],
        },
        {
          title: "공식 연결 범위 확인",
          description: "문의 수신, 메시지 발송, 고객 정보 접근 범위를 확인합니다.",
          checklist: ["수신 가능 범위", "발송 가능 조건", "동의/친구 관계 조건"],
        },
        {
          title: "초기 범위 제한",
          description: "정책 확인 전까지는 문의 후보와 수동 확인만 켭니다.",
          checklist: ["자동 발송 off", "승인 대기 고정", "정책 검토 기록"],
        },
      ],
    },
  },
  {
    id: "kakaotalk-local-app",
    label: "KakaoTalk 앱/웹",
    iconText: "톡",
    category: "messenger",
    shortDescription: "공식 연결이 막힐 때 앱 위치, 로그인 링크, 계정 보관함, 내 PC 작업 도우미 읽기 후보로 연결.",
    triggers: ["messenger_command"],
    method: "site_login",
    officialFirst: false,
    warning: "개인/업무 카카오톡 자동 전송은 기본 비활성입니다. 읽기 후보와 답장 초안까지만 준비하고 실제 전송은 앱 최종 승인 뒤에 진행하세요.",
    status: "not_connected",
    recommendScore: 68,
    preparation: ["카카오톡 PC 앱 위치 또는 실행 이름", "채널 관리자/웹 로그인 주소", "보관함에 저장할 계정 참조", "읽기 허용 대화 범위"],
    setupGuide: {
      assistantIntro:
        "카카오톡은 공식 연결이 제한되는 경우가 많습니다. ModyCrew는 먼저 공식 Kakao 채널 연결 가능 여부를 확인하고, 막히면 앱 위치와 사이트 링크를 보관함에 저장해 내 PC 작업 도우미 읽기 후보로만 이어갑니다.",
      expertSkipLabel: "앱 위치와 로그인 링크를 알고 있으면 보관함으로",
      steps: [
        {
          title: "공식 연결 가능 여부 확인",
          description: "비즈니스 채널 공식 연결을 쓸 수 있으면 그 경로를 우선합니다. 개인 카카오톡 자동화는 기본으로 켜지 않습니다.",
          checklist: ["Kakao Developers 권한 확인", "비즈니스 채널 여부 확인", "자동 발송 정책 확인"],
        },
        {
          title: "앱 위치와 로그인 링크 저장",
          description: "공식 연결이 막히면 카카오톡 PC 앱 위치, 관리자 사이트 링크, 계정 참조만 보관함에 저장합니다.",
          checklist: ["PC 카카오톡 실행 가능 확인", "관리자/웹 로그인 주소 확인", "비밀번호는 채팅에 입력하지 않음"],
          actionLabel: "KakaoTalk 다운로드",
          actionHref: "https://www.kakaocorp.com/page/service/service/KakaoTalk",
        },
        {
          title: "읽기 후보로만 시작",
          description: "내 PC 작업 도우미는 열린 대화와 최근 알림을 읽어 문의 요약과 답장 초안을 만들고, 전송은 오피스 승인 카드로 넘깁니다.",
          checklist: ["읽기 허용 대화 범위 지정", "답장 초안 생성", "전송은 최종 승인으로 잠금"],
        },
      ],
    },
    afterConnect: {
      title: "KakaoTalk 다른 방법이 준비되면",
      items: [
        "앱 위치/사이트 링크가 보관함에 남고, 실패 시 같은 경로를 다시 안내합니다.",
        "대화 내용은 사용자가 허용한 범위에서만 읽기 후보로 들어갑니다.",
        "답장, 예약 안내, 문의 분류는 오피스 승인 카드로 먼저 표시됩니다.",
      ],
    },
    workPreview: {
      title: "카카오톡 업무 후보",
      cadence: "사용자가 요청할 때 또는 승인한 읽기 세션에서만 확인",
      items: [
        { label: "문의 요약", detail: "최근 대화에서 고객 문의, 예약, 보류 항목을 분리" },
        { label: "답장 초안", detail: "전송하지 않고 문구 후보만 작성" },
        { label: "승인 카드", detail: "전송/등록이 필요하면 오피스에서 최종 확인" },
      ],
      approvalNote: "카카오톡 전송, 클릭, 입력은 최종 승인 전 실행하지 않습니다.",
    },
    troubleshooting: [
      "공식 연결이 가능한 업무 채널이면 Kakao 채널 연결을 우선 사용하세요.",
      "개인/업무 카카오톡 앱 자동 전송은 기본으로 켜지 않습니다.",
      "앱 위치나 사이트 링크만 저장해도 내 PC 작업 도우미 읽기 후보와 오피스 승인함으로 이어갈 수 있습니다.",
    ],
  },

  // 문의/폼
  {
    id: "business-inquiry",
    label: "홈페이지 문의함",
    iconText: "문",
    category: "inquiry",
    shortDescription: "홈페이지 문의 폼, 상담 신청, 앱 연결 주소로 들어오는 이벤트를 업무 인박스로 모읍니다.",
    triggers: ["inquiry_arrived"],
    method: "api_key",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 94,
    setupGuide: {
      assistantIntro:
        "홈페이지 문의함은 복잡한 자동화 빌더 대신 문의 도착 주소와 보안 입력값만 연결하면 됩니다. ModyCrew는 문의를 읽고 답장 초안과 확인 질문을 만들지만 실제 발송은 승인 후에만 진행합니다.",
      expertSkipLabel: "문의 전달 주소를 이미 알면 입력으로",
      steps: [
        {
          title: "문의 폼 위치 확인",
          description: "홈페이지, 랜딩페이지, 예약 폼 중 실제 고객 문의가 들어오는 곳을 확인합니다.",
          checklist: ["문의 폼 URL 확인", "관리자 접근 권한 확인", "테스트 문의 1건 준비"],
        },
        {
          title: "전달 방식 고르기",
          description: "가능하면 공식 연결 주소로 연결합니다. 어렵다면 공개 문의 릴레이로 먼저 받을 수 있습니다.",
          checklist: ["문의 전달 가능 여부 확인", "앱 연결 주소 또는 릴레이 선택", "고객 개인정보 최소 수집"],
        },
        {
          title: "업무 카드 점검",
          description: "테스트 문의를 보내 업무 인박스에 분류, 요약, 답장 초안이 생기는지 확인합니다.",
          checklist: ["테스트 문의 전송", "업무/광고 분류", "답장 초안 승인 대기 확인"],
        },
      ],
    },
    afterConnect: mailAfterConnect,
    workPreview: mailWorkPreview,
  },
  {
    id: "public-trigger-relay",
    label: "공개 문의 릴레이",
    iconText: "문",
    category: "inquiry",
    shortDescription: "웹 문의, 개인 폼, 앱 연결 주소 이벤트를 데스크톱 앱이 확인해 업무 카드로 전환.",
    triggers: ["inquiry_arrived"],
    method: "api_key",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 93,
    setupGuide: apiKeyGuide,
  },
  {
    id: "channel-talk",
    label: "채널톡",
    iconText: "C",
    category: "inquiry",
    shortDescription: "고객 문의 도착을 업무 인박스로 넘기고 답장 초안 후보를 생성.",
    triggers: ["inquiry_arrived", "messenger_command"],
    method: "oauth",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 82,
    setupGuide: {
      assistantIntro:
        "채널톡은 고객 문의를 업무 카드로 바꾸는 데 좋지만, 답변 발송은 승인형으로 묶어야 합니다. 처음에는 수신과 초안 생성부터 켭니다.",
      expertSkipLabel: "채널톡 관리자 설정을 알면 바로 연결",
      steps: [
        {
          title: "채널톡 관리자 열기",
          description: "사업장 채널톡 관리자 계정으로 로그인합니다.",
          checklist: ["관리자 로그인", "사이트/워크스페이스 선택", "앱 연동 권한 확인"],
        },
        {
          title: "문의 수신 방식 확인",
          description: "웹훅 또는 공식 연동으로 문의 도착 이벤트를 받을 수 있는지 확인합니다.",
          checklist: ["문의 도착 이벤트", "고객 식별 정보 최소화", "테스트 문의 준비"],
        },
        {
          title: "초기 자동화 범위 고정",
          description: "처음에는 문의 요약과 답장 초안까지만 켜고 실제 답변은 승인 후 보냅니다.",
          checklist: ["요약 생성", "답장 초안 생성", "자동 발송 off"],
        },
      ],
    },
  },
  {
    id: "naver-talktalk",
    label: "네이버 톡톡",
    iconText: "N",
    category: "inquiry",
    shortDescription: "톡톡 문의를 수집 대상으로 다루되 정책 확인 후 안전한 방식으로 연결.",
    triggers: ["inquiry_arrived"],
    method: "site_login",
    officialFirst: false,
    warning: "공식 연결 제공 범위와 서비스 약관 확인 후 제한적으로 사용합니다.",
    status: "not_connected",
    recommendScore: 74,
    setupGuide: {
      assistantIntro:
        "네이버 톡톡은 공식 제공 범위와 약관 확인이 먼저입니다. 무리한 자동화보다 수동 확인과 승인형 흐름으로 시작합니다.",
      expertSkipLabel: "톡톡 관리자 정보를 알면 입력으로",
      steps: [
        {
          title: "톡톡 관리자 접근 확인",
          description: "사업자 계정으로 톡톡 관리자에 접근할 수 있는지 확인합니다.",
          checklist: ["사업자 계정 로그인", "톡톡 채널 선택", "관리자 권한 확인"],
        },
        {
          title: "연동 가능 범위 확인",
          description: "공식 연결이나 알림 연동이 가능한지 확인합니다. 불확실하면 자동화 범위를 켜지 않습니다.",
          checklist: ["공식 연결 제공 여부", "약관 확인", "고객 정보 접근 범위 확인"],
        },
        {
          title: "안전한 시작",
          description: "처음에는 문의 후보 기록과 수동 확인만 진행합니다.",
          checklist: ["자동 답변 off", "승인 대기", "정책 확인 필요 표시"],
        },
      ],
    },
  },

  // 캘린더
  {
    id: "google-calendar",
    label: "Google Calendar",
    iconText: "G",
    category: "calendar",
    shortDescription: "freeBusy 읽기. 가능 시간 후보 자동 추출.",
    triggers: ["calendar_event"],
    method: "oauth",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 92,
    setupGuide: googleCalendarGuide,
    afterConnect: calendarAfterConnect,
    workPreview: calendarWorkPreview,
    troubleshooting: commonOAuthTroubleshooting,
  },
  {
    id: "outlook-calendar",
    label: "Outlook Calendar",
    iconText: "O",
    category: "calendar",
    shortDescription: "Microsoft Graph 일정 읽기.",
    triggers: ["calendar_event"],
    method: "oauth",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 80,
    setupGuide: outlookCalendarGuide,
    afterConnect: calendarAfterConnect,
    workPreview: calendarWorkPreview,
    troubleshooting: commonOAuthTroubleshooting,
  },

  // 예약
  {
    id: "naver-booking",
    label: "네이버예약",
    iconText: "N",
    category: "booking",
    shortDescription: "예약 도착/변경 트리거. 사이트 세션 기반.",
    triggers: ["booking_changed", "inquiry_arrived"],
    method: "site_login",
    officialFirst: false,
    warning: "공식 연결 제한. 격리 브라우저 세션으로만 다룹니다.",
    status: "not_connected",
    recommendScore: 72,
    setupGuide: {
      assistantIntro:
        "예약 플랫폼은 계정 잠금과 약관 위험이 있어 공식 연결이 없으면 조심해야 합니다. 처음에는 읽기와 후보 제안만 안내합니다.",
      expertSkipLabel: "예약 관리자 계정을 이미 알면 입력으로",
      steps: [
        {
          title: "예약 관리자 로그인 확인",
          description: "사업장 예약 관리 화면에 접근할 수 있는 계정을 확인합니다.",
          checklist: ["관리자 계정 확인", "2단계 인증 준비", "테스트 예약 확인"],
        },
        {
          title: "자동화 위험 확인",
          description: "공식 연결이 없으면 격리 브라우저 세션으로만 다루며 확정/변경은 자동 실행하지 않습니다.",
          checklist: ["약관 확인", "계정 잠금 위험 확인", "확정/변경 승인 고정"],
        },
        {
          title: "읽기 테스트",
          description: "예약 도착과 변경 정보를 읽을 수 있는지 먼저 확인합니다.",
          checklist: ["예약 목록 읽기", "변경 후보 생성", "확정 실행 off"],
        },
      ],
    },
  },
  {
    id: "kakao-booking",
    label: "카카오예약",
    iconText: "K",
    category: "booking",
    shortDescription: "카카오예약 도착/변경 트리거.",
    triggers: ["booking_changed"],
    method: "site_login",
    officialFirst: false,
    warning: "공식 연결 제한. 격리 브라우저 세션 사용.",
    status: "not_connected",
    recommendScore: 60,
    setupGuide: {
      assistantIntro:
        "카카오예약도 공식 연결과 정책 확인이 우선입니다. ModyCrew는 예약 변경 후보를 보여주고, 실제 확정은 승인 후에만 다룹니다.",
      expertSkipLabel: "관리자 계정을 이미 알면 입력으로",
      steps: [
        {
          title: "카카오 예약 관리자 확인",
          description: "예약을 관리하는 사업자 계정과 권한을 확인합니다.",
          checklist: ["관리자 로그인", "사업장 선택", "예약 목록 접근 확인"],
        },
        {
          title: "정책과 위험 확인",
          description: "공식 연동이 없으면 계정 자동 조작을 최소화합니다.",
          checklist: ["약관 확인", "자동 확정 off", "승인 대기 고정"],
        },
        {
          title: "읽기부터 시작",
          description: "예약 정보 읽기와 후보 정리부터 테스트합니다.",
          checklist: ["예약 변경 읽기", "가능 시간 후보", "확정 전 승인"],
        },
      ],
    },
  },

  // 협업/문서
  {
    id: "google-drive",
    label: "Google Drive",
    iconText: "G",
    category: "workspace",
    shortDescription: "Drive 파일과 공유 문서를 읽기 전용으로 찾아 업무 기준과 보고 초안에 반영.",
    triggers: ["document_added"],
    method: "oauth",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 84,
    setupGuide: {
      assistantIntro:
        "Google Drive는 전체 드라이브를 무작정 읽는 방식이 아니라 필요한 폴더와 공유 문서부터 연결합니다. 처음에는 자료 검색과 요약만 켜고 공유/수정은 승인 뒤에만 진행합니다.",
      expertSkipLabel: "Drive 계정 동의 연결을 이미 알면 바로 진행",
      steps: [
        {
          title: "업무 폴더 정하기",
          description: "인수인계서, 보고서 양식, 가격표, 제안서가 있는 Drive 폴더를 고릅니다.",
          checklist: ["Google 계정 로그인", "업무 폴더 위치 확인", "민감 폴더 제외"],
          actionLabel: "Google Drive 열기",
          actionHref: "https://drive.google.com/",
        },
        {
          title: "읽기 범위 확인",
          description: "처음에는 파일 검색과 읽기 권한만 사용합니다. 공유나 수정 권한은 승인형 기능을 켤 때 다시 확인합니다.",
          checklist: ["읽기 권한 확인", "공유 드라이브 접근 확인", "수정/공유 자동 실행 off"],
        },
        {
          title: "자료 추출 점검",
          description: "문서 제목과 본문 일부가 업무 기준으로 요약되는지 확인합니다.",
          checklist: ["샘플 문서 선택", "요약 결과 확인", "출처와 승인 경계 확인"],
        },
      ],
    },
    afterConnect: documentAfterConnect,
    workPreview: documentWorkPreview,
    troubleshooting: commonOAuthTroubleshooting,
  },
  {
    id: "notion-workspace",
    label: "Notion",
    iconText: "N",
    category: "workspace",
    shortDescription: "워크스페이스 계정 동의 연결. 문서 검색 + 보고서 자동 작성.",
    triggers: ["document_added"],
    method: "oauth",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 78,
    afterConnect: documentAfterConnect,
    workPreview: documentWorkPreview,
    setupGuide: {
      assistantIntro:
        "Notion은 계정 동의로 연결하고, 처음에는 문서 읽기와 업무 정리부터 시작합니다. DB 수정이나 댓글 작성은 승인 후 실행합니다.",
      expertSkipLabel: "Notion 계정 동의 연결을 알면 바로 진행",
      steps: [
        {
          title: "워크스페이스 선택",
          description: "업무 문서가 있는 Notion 워크스페이스를 고릅니다.",
          checklist: ["Notion 로그인", "워크스페이스 선택", "페이지 접근 권한 확인"],
          actionLabel: "Notion 열기",
          actionHref: "https://www.notion.so/",
        },
        {
          title: "공유 범위 확인",
          description: "모든 페이지가 아니라 필요한 페이지와 DB만 연결합니다.",
          checklist: ["필요 페이지 선택", "민감 페이지 제외", "쓰기 권한은 승인형"],
        },
      ],
    },
  },
  {
    id: "figma-design",
    label: "Figma",
    iconText: "F",
    category: "workspace",
    shortDescription: "Figma 계정 동의 연결. 디자인 파일 참조 + 자료 추출.",
    triggers: ["document_added"],
    method: "oauth",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 55,
    setupGuide: {
      assistantIntro:
        "Figma는 디자인 파일을 업무 자료로 읽어 작업 목록과 보고 초안을 만드는 데 씁니다. 댓글/수정은 승인 후 단계로 둡니다.",
      expertSkipLabel: "Figma 계정 동의 연결을 알면 바로 진행",
      steps: [
        {
          title: "Figma 계정과 팀 확인",
          description: "작업 파일이 있는 Figma 팀 또는 프로젝트를 확인합니다.",
          checklist: ["Figma 로그인", "팀/프로젝트 선택", "파일 접근 권한 확인"],
          actionLabel: "Figma 열기",
          actionHref: "https://www.figma.com/files",
        },
        {
          title: "읽기 중심으로 시작",
          description: "처음에는 파일 읽기와 화면 요약만 켭니다.",
          checklist: ["파일 읽기", "화면 요약", "댓글/수정은 승인 후"],
        },
      ],
    },
  },

  // AI 엔진 — BYOK
  {
    id: "google-gemini",
    label: "Google Gemini",
    iconText: "G",
    category: "ai",
    shortDescription: "AI 답장/요약 초안 엔진. 무료 tier 넓음.",
    triggers: ["manual_only"],
    method: "api_key",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 95,
    setupGuide: apiKeyGuide,
  },
  {
    id: "openai-gpt",
    label: "OpenAI (GPT)",
    iconText: "O",
    category: "ai",
    shortDescription: "GPT-4 계열. 한국어 품질 안정적.",
    triggers: ["manual_only"],
    method: "api_key",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 85,
    setupGuide: apiKeyGuide,
  },
  {
    id: "anthropic-claude",
    label: "Claude (Anthropic)",
    iconText: "A",
    category: "ai",
    shortDescription: "긴 문서 처리에 강함. 보안 가드 강력.",
    triggers: ["manual_only"],
    method: "api_key",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 70,
    setupGuide: apiKeyGuide,
  },

  // 사내 시스템
  {
    id: "inventory-system",
    label: "재고 시스템",
    iconText: "재",
    category: "business_system",
    shortDescription:
      "재고가 임계치 이하면 자동으로 거래처 발주 SMS 후보 생성 (승인 후 발송).",
    triggers: ["inventory_low"],
    method: "api_key",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 80,
    setupGuide: apiKeyGuide,
  },
  {
    id: "pos-system",
    label: "POS / 결제 시스템",
    iconText: "P",
    category: "business_system",
    shortDescription: "매출 변화 + 일일 정산 자동 보고서 생성.",
    triggers: ["document_added"],
    method: "api_key",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 65,
    setupGuide: apiKeyGuide,
  },

  // 로컬
  {
    id: "local-folder-index",
    label: "로컬 폴더 (자료 학습)",
    iconText: "📁",
    category: "local",
    shortDescription: "허용 폴더의 Excel/Word/PDF/HWP/CSV 를 자동 학습.",
    triggers: ["document_added"],
    method: "local_permission",
    officialFirst: true,
    status: "not_connected",
    recommendScore: 75,
    setupGuide: {
      assistantIntro:
        "로컬 폴더 연결은 보안 입력값이 아니라 권한 선택 문제입니다. 사용자가 고른 폴더 안에서만 읽고, 밖은 건드리지 않습니다.",
      expertSkipLabel: "폴더 권한을 알면 바로 선택",
      steps: [
        {
          title: "자료 폴더 정하기",
          description: "AI가 읽어도 되는 업무 자료 폴더를 고릅니다. 개인 사진, 민감 자료가 섞인 상위 폴더는 피하세요.",
          checklist: ["업무 자료 폴더 확인", "민감 자료 분리", "하위 폴더 포함 여부 결정"],
        },
        {
          title: "읽기 권한만 허용",
          description: "처음에는 파일 생성/이동이 아니라 읽기와 검색부터 켭니다.",
          checklist: ["읽기 권한", "허용 폴더 경계", "파일 쓰기는 승인 후"],
        },
        {
          title: "자료 추출 테스트",
          description: "PDF, Word, Excel, CSV가 잘 읽히는지 확인합니다.",
          checklist: ["샘플 문서 선택", "텍스트 추출 확인", "출처 메타데이터 확인"],
        },
      ],
    },
  },
];

export function recommendedConnectors(
  connectors: ConnectorDefinition[],
  goal?: ConnectorCategory | "all",
): ConnectorDefinition[] {
  const filtered = !goal || goal === "all" ? connectors : connectors.filter((c) => c.category === goal);
  return [...filtered].sort((a, b) => b.recommendScore - a.recommendScore);
}
