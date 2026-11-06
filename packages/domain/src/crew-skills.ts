   
                                            
  
                                                                                                       
                                                                             
                                                                                        
                                                                                    
                                                             
                                                            
                                                                                  
                                                                   
   
import { builtinExperts } from "./builtin-experts.js";

/** instructions = 대화 안 지침 · agent = Codex·Claude 작업 폴더 실행 · council = 교차 검토 · app_tool = 앱 도구(PC 조작 등)를 승인 뒤 실행. */
export type CrewSkillExecution = "instructions" | "agent" | "council" | "app_tool";
/** 확장 센터 분류(요청서 8절): 개발·디자인·보안 검토·문서·한국 업무·콘텐츠·영상·리버스 엔지니어링·선택형 연구 도구. */
export type CrewSkillCategory = "development" | "design" | "security" | "documents" | "content" | "reverse_engineering" | "research";
/** core = 기본 탑재(앱에 동봉, 바로 사용) · optional = 확장 화면에서 추가해야 사용. */
export type CrewSkillAvailability = "core" | "optional";
/** 실행기가 강제하는 실행 조건. audit = 읽기 전용·명령 실행 없음, reverse = REA 분석 도구만·대상 사본 분석. */
export type CrewSkillProfile = "standard" | "audit" | "reverse";
export type CrewSkillPermission = "read_target" | "write_output" | "write_target" | "run_scripts" | "multi_runtime" | "mcp:rea" | "desktop_control";
export type CrewSkillRuntimeId = "codex" | "claude";
/** 확장 센터 상태(요청서 8절): 참고자료·구현 중·설치 가능·연결 필요·검증 완료·오류. */
export type CrewSkillLifecycle = "reference" | "in_progress" | "installable" | "needs_connection" | "verified" | "error";
export type CrewSkillVerificationLevel = "real_run" | "connection_check" | "unit_test" | "none";
export type CrewSkillSource = { label: string; url?: string; license: string; status: string; reviewedVersion?: string; checkedAt?: string };
export type CrewSkillDefinition = {
  /** SKILL.md 의 name. 소문자·숫자·하이픈. 웹·앱 공통 ID. */
  name: string;
  label: string;
  /** SKILL.md 의 description 과 한 글자도 다르지 않다. */
  description: string;
  execution: CrewSkillExecution;
  /**
   * 이 스킬을 맡는 직무(builtin expert id). 비슷한 일을 여러 직원이 나눠 갖지 않도록 스킬마다 담당 크루는
   * 하나로 둔다 — 심층 검토만 기획·개발 두 직무가 함께 쓰는 검토 절차다. 기본 비서는 모든 크루 스킬을 본다.
   */
  ownerRoleIds: readonly string[];
  /** 스킬 문서 버전(semver). 바뀌면 카탈로그 해시와 함께 올린다. */
  version: string;
  category: CrewSkillCategory;
  availability: CrewSkillAvailability;
  profile: CrewSkillProfile;
  /** 큰 변경이면 계획 단계에서 멈추고 사용자 설계 확인 뒤에 구현한다(실행기가 강제). */
  planGate?: boolean;
  /** 확인 창에 보여 주는 권한. 업데이트 때 늘어나면 다시 승인받는다. */
  permissions: readonly CrewSkillPermission[];
  /** 실행 조건. minRuntimes = 로그인된 실행기 최소 개수(0이면 채팅 안에서도 가능). cli = 이 PC에 공식 경로로 설치돼 있어야 하는 외부 도구. */
  requires: { runtimes: readonly CrewSkillRuntimeId[]; minRuntimes: number; mcpServers?: readonly string[]; cli?: readonly string[] };
  /** 실제로 검증한 운영체제. 없으면 세 운영체제 공통(지침·실행기형). */
  platforms?: readonly ("win32" | "darwin" | "linux")[];
  /** 입출력 규격(확장 센터 카드의 입출력 예시). */
  io: { inputs: readonly string[]; outputs: readonly string[] };
  /** 마지막으로 확인한 검증 수준. real_run 만 '검증 완료'로 보인다. */
  verification: { level: CrewSkillVerificationLevel; checkedAt: string; note: string; runtimes?: readonly CrewSkillRuntimeId[] };
  /** 자동 선택 키워드. 공백을 빼고 소문자로 비교한다. 두 글자 영문은 다른 단어 속에 섞이므로 쓰지 않는다. */
  triggers: readonly string[];
  /** 채팅 프롬프트에 넣는 압축 절차. 전체 지침은 SKILL.md 에 있다. */
  steps: readonly string[];
  outputFormat: readonly string[];
  guardrails: readonly string[];
  /** 이 PC에 설치돼 있으면 실제 실행 때 함께 읽는 Codex·Claude 스킬 이름. 없으면 없다고 적고 진행한다. */
  companionSkills: readonly string[];
  sources: readonly CrewSkillSource[];
};
export type CrewSkillMatch = { skill: CrewSkillDefinition; score: number; ownerRoleId: string };

export const personalOperatorCrewRoleId = "personal-operator";

const catalog: CrewSkillDefinition[] = [
{
  "name": "mody-b2b-discovery",
  "label": "B2B 고객개발 전문가",
  "description": "공개 기업 신호와 적합도 근거로 잠재고객을 선별하고 첫 제안 초안을 준비합니다.",
  "execution": "instructions",
  "ownerRoleIds": [
    "b2b-customer-developer",
    "sales-consultant",
    "research-assistant"
  ],
  "version": "1.0.0",
  "category": "research",
  "availability": "core",
  "profile": "standard",
  "permissions": [],
  "requires": {
    "runtimes": [
      "codex",
      "claude"
    ],
    "minRuntimes": 0
  },
  "io": {
    "inputs": [
      "제품의 검증된 가치·타깃 기업 기준·출처가 있는 기업 자료"
    ],
    "outputs": [
      "기업 잠재고객 조사·선별",
      "근거·보류 사유 정리",
      "첫 제안 초안과 영업 인계"
    ]
  },
  "verification": {
    "level": "unit_test",
    "checkedAt": "2026-11-05",
    "note": "역할·공용 도구·근거 검증의 모의 테스트. 실제 고객 조사·Harvey 실행·고객 전송·성과 검증 없음."
  },
  "triggers": [
    "B2B 고객",
    "기업 후보",
    "잠재고객",
    "기업 고객개발",
    "기업 영업"
  ],
  "steps": [
    "목표 시장·제품 가치·제외 업종·타깃 기업 조건을 정하고 기업 단위의 공개 사업 정보와 사용자가 제공한 자료를 비교합니다. 연락처를 추정하거나 무단 대량 수집하지 않습니다.",
    "기업마다 관찰 사실·출처 URL·관찰일·사용자 판단과 미확인을 분리합니다. 채용·신규 사업 등 공개 신호가 구매 의사나 예산을 입증한다고 단정하지 않습니다.",
    "customer.discovery.plan의 b2b 모드로 제공 근거와 사용자 적합도 판단을 정리할 수 있습니다. 이 도구는 웹을 조회하거나 실제 신호를 검증하지 않으므로 독립 조사 완료라고 표현하지 않습니다.",
    "우선 검토·추가 확인·제외를 나누고 수신거부 대상은 제외합니다. 근거가 있는 기업 맥락과 검증된 제품 가치만 써서 첫 제안 초안을 만들고 제안·견적은 기존 B2B 영업 전문가에게 인계합니다.",
    "Harvey는 선택적 기업 영업 참고 원본이며 현재 설치·실행 어댑터가 없습니다. Python·CLI 로그인·메일 권한·주소 검증 서비스·비용·전송 범위를 확인하기 전 연결하지 않습니다. 국내 규정·한국어 수신거부 처리는 미검증입니다.",
    "메일 발송·고객 자료 외부 전송·대량 수집·계정 연결·유료 서비스는 대상·내용·권한·비용을 보여주고 사용자 승인 후에만 별도 실행합니다. 이번 경로는 초안만 만들며 발송하거나 예약하지 않습니다."
  ],
  "outputFormat": [
    "대상·자료 범위",
    "출처·관찰일·미확인",
    "검토 우선순위·제외 사유",
    "초안·다음 검증",
    "승인 필요·한계"
  ],
  "guardrails": [
    "기업 신호는 구매 의사와 구분",
    "연락처 추정 없이 근거 있는 후보만 검토",
    "초안 준비와 실제 발송 승인을 분리",
    "customer.discovery.plan은 제공 자료만 정리하며 새 조회·발송·설치를 하지 않습니다.",
    "필요한 관련 크루 누구나 공용 스킬과 도구를 검색·재사용할 수 있습니다."
  ],
  "companionSkills": [],
  "sources": [
    {
      "label": "Harvey",
      "url": "https://github.com/ethanplusai/harvey",
      "license": "MIT",
      "reviewedVersion": "6b6a23a789090e165802baef4104ee4618a3e169",
      "checkedAt": "2026-11-05",
      "status": "기업 영업 구조 참고만. 원문·코드 미동봉, 설치·실행 어댑터 미연결. AI 구독·메일·외부 검증 비용과 전송 별도 확인."
    }
  ]
},
{
  "name": "mody-b2c-growth",
  "label": "B2C 고객성장 전문가",
  "description": "익명 집계 자료로 고객군·가입 전환의 가설을 세우고 동의 기반 성장 실험 초안을 준비합니다.",
  "execution": "instructions",
  "ownerRoleIds": [
    "b2c-customer-growth",
    "growth-strategist",
    "content-editor"
  ],
  "version": "1.0.0",
  "category": "research",
  "availability": "core",
  "profile": "standard",
  "permissions": [],
  "requires": {
    "runtimes": [
      "codex",
      "claude"
    ],
    "minRuntimes": 0
  },
  "io": {
    "inputs": [
      "익명화된 고객군 집계·제품 가치·집계 기간·동의 범위"
    ],
    "outputs": [
      "익명 고객군·가입 전환 분석",
      "동의 기반 메시지 가설",
      "실험 지표·중단 기준 설계"
    ]
  },
  "verification": {
    "level": "unit_test",
    "checkedAt": "2026-11-05",
    "note": "역할·공용 도구·근거 검증의 모의 테스트. 실제 고객 조사·Harvey 실행·고객 전송·성과 검증 없음."
  },
  "triggers": [
    "B2C",
    "개인 고객",
    "익명 고객군",
    "가입 전환",
    "고객성장"
  ],
  "steps": [
    "기업 영업과 구분해 개인 고객군·유입 채널·가입/구매 단계·집계 기간을 정리합니다. 개인 이름·이메일·전화·계정 식별자를 수집하거나 입력하지 않고 익명 집계와 동의된 인터뷰 요약만 사용합니다.",
    "customer.discovery.plan의 b2c 모드는 aggregateOnly:true인 집계 자료만 받습니다. 표본 수가 10 미만인 자료는 입력을 거부하며 이것이 완전한 익명성이나 통계적 유의성을 보장하지 않음을 명시합니다.",
    "관찰된 고객군 문제와 제품 가치 가설을 구분하고 표본·분모·기간·중복과 편향을 표시합니다. 민감 특성·취약성 추론이나 개인별 구매 확률 점수화는 하지 않습니다.",
    "가입·활성화·구매의 병목 가설마다 메시지 초안·단일 실험 변수·성공 지표·중단 조건을 제안합니다. 광고 캠페인 전략과 예산은 기존 마케팅 전문가에게 인계하고 실제 집행은 하지 않습니다.",
    "B2C 절차는 모디가 별도로 작성한 지침과 로컬 근거 정리 도구입니다. Harvey의 개인 고객 확보 기능으로 표현하지 않습니다. 실제 광고 플랫폼·CRM·성과 개선 효과는 미검증입니다.",
    "고객군 자료 외부 전송·개인 대상 연락·대량 메시지·게시·광고비 집행은 별도 사용자 승인과 적절한 동의 범위 확인 뒤에만 진행합니다. 수신거부·미동의 대상은 연락에서 제외합니다."
  ],
  "outputFormat": [
    "대상·자료 범위",
    "출처·관찰일·미확인",
    "검토 우선순위·제외 사유",
    "초안·다음 검증",
    "승인 필요·한계"
  ],
  "guardrails": [
    "개인 명단 대신 익명 고객군 집계 사용",
    "작은 표본의 가설을 성과 확신으로 바꾸지 않음",
    "성장 실험 초안과 광고·메시지 집행을 분리",
    "customer.discovery.plan은 제공 자료만 정리하며 새 조회·발송·설치를 하지 않습니다.",
    "필요한 관련 크루 누구나 공용 스킬과 도구를 검색·재사용할 수 있습니다."
  ],
  "companionSkills": [],
  "sources": [
    {
      "label": "Mody B2C 고객성장 절차",
      "license": "Mody 자체 작성 지침 · 외부 재배포 권한 별도 확인",
      "checkedAt": "2026-11-05",
      "status": "Harvey B2C 구현이 아닌 별도 지침. 익명 집계 입력의 로컬 계획만 모의 검증; 광고·CRM 미연결."
    }
  ]
},
{
  "name": "mody-securities-research",
  "label": "증권 리서치",
  "description": "종목의 공개 자료를 재무·뉴스·시장 심리·차트로 나누고 강세·약세 가설과 위험을 검토하는 리서치 절차입니다. 실제 매매와 증권계정 접근은 하지 않습니다.",
  "execution": "instructions",
  "ownerRoleIds": [
    "securities-researcher"
  ],
  "version": "1.0.0",
  "category": "research",
  "availability": "core",
  "profile": "standard",
  "permissions": [],
  "requires": {
    "runtimes": ["codex", "claude"],
    "minRuntimes": 0
  },
  "io": {
    "inputs": [
      "종목·거래소·기준일·투자 기간",
      "출처·시각이 있는 공시·가격·뉴스 자료"
    ],
    "outputs": [
      "근거·지연·결측 표",
      "강세·약세 가설과 반증 조건",
      "위험·불확실성 보고"
    ]
  },
  "verification": {
    "level": "unit_test",
    "checkedAt": "2026-11-04",
    "note": "역할·프롬프트 연결 단위 테스트 통과. 실제 TradingAgents 실행 및 시세 공급자 연결 미검증"
  },
  "triggers": [
    "증권",
    "주식 분석",
    "종목 분석",
    "투자 리서치",
    "강세 약세",
    "tradingagents",
    "재무 뉴스 심리 차트"
  ],
  "steps": [
    "대상 종목·거래소·통화·기준일·투자 기간을 확인하고 자료마다 출처 URL·공표 시각·조회 시각·시간대·시세 지연과 결측을 적습니다.",
    "재무·뉴스·시장 심리·차트를 구분해 근거를 검토합니다. 사실·계산·추정과 미확인을 나누며 국내 공시는 DART 등 실제 확인한 범위만 다룹니다.",
    "강세와 약세 가설을 같은 자료로 비교하고 각 가설을 뒤집을 조건을 적습니다. 단일 모델 관점 분리를 실제 여러 분석가의 독립 검증으로 표현하지 않습니다.",
    "변동성·유동성·집중·환율·하방 위험과 데이터 한계를 종합합니다. 과거 결정 평가를 주문 체결이나 잔고 시뮬레이션으로 표현하지 않습니다.",
    "투자 손실 위험과 불확실성을 밝힌 리서치 보고서를 제공합니다. 수익을 보장하지 않으며 실제 매매·주문·증권 계정 접근은 하지 않습니다."
  ],
  "outputFormat": [
    "분석 기준·출처·시각·지연",
    "재무·뉴스·시장 심리·차트",
    "강세·약세 및 반증 조건",
    "위험·불확실성·추가 확인"
  ],
  "guardrails": [
    "자료가 없으면 수치·시세를 만들지 않습니다.",
    "투자 손실 가능성이 있으며 최종 판단은 사용자에게 있습니다.",
    "미국 중심 데이터를 국내 공시 완전 지원으로 간주하지 않습니다.",
    "실제 거래·주문·증권계정 접근을 하지 않습니다."
  ],
  "companionSkills": [
    "k-dart",
    "korean-stock-search",
    "market-event-impact"
  ],
  "sources": [
    {
      "label": "TradingAgents",
      "url": "https://github.com/TauricResearch/TradingAgents",
      "license": "Apache-2.0",
      "reviewedVersion": "9fa1196fffbcfd9de5146d2dd2869df84ab99838",
      "checkedAt": "2026-11-04",
      "status": "역할 분담을 참고한 독자 지침. 별도 승인형 전체 원본 분석 어댑터 구현·모의 검사; 실제 원본 실행·공급자 호환성 미검증"
    }
  ]
},
  {
    name: "mody-deep-review",
    label: "심층 검토(여러 AI 교차 검토)",
    description: "중요한 기획·설계·결정·코드 변경안을 여러 AI가 각자 독립적으로 답한 뒤, 서로의 답을 익명으로 교차 검토하고, 의견 차이를 지우지 않은 채 최종안을 종합하는 심층 검토 절차입니다. '심층 검토', '교차 검토', '크로스체크', '여러 AI 의견', 'LLM 카운슬', '다른 AI한테도 물어봐' 같은 요청에 씁니다.",
    execution: "council",
    ownerRoleIds: ["product-planner", "software-engineer"],
    version: "1.0.0",
    category: "development",
    availability: "core",
    profile: "standard",
    permissions: ["multi_runtime"],
    requires: { runtimes: ["codex", "claude"], minRuntimes: 1 },
    io: { inputs: ["검토할 질문·결정 기준·제약"], outputs: ["result.md — 참여 AI와 단계별 상태, 답변 비교표, 남은 이견, 최종안"] },
    verification: { level: "real_run", checkedAt: "2026-10-31", note: "Claude 기본 모델+Sonnet 두 모델 3단계 123초 완료. Codex 포함 교차 검토는 미실행", runtimes: ["claude"] },
    triggers: ["심층 검토", "심층검토", "교차 검토", "교차검토", "크로스체크", "크로스 체크", "여러 ai", "다른 ai", "ai끼리", "llm 카운슬", "llm council", "카운슬", "재검토", "반론", "의견 비교", "검증해"],
    steps: [
      "검토할 질문·결정 기준·제약을 한 문단으로 고정하고 모든 참여 AI에 같은 문장을 줍니다.",
      "참여 AI마다 다른 답을 보지 않은 채 독립 답변(결론·근거·위험·확인 방법)을 씁니다.",
      "답을 A·B·C로 익명화해 서로 평가합니다: 사실 오류, 빠진 위험, 근거 강도, 순위와 이유.",
      "의장 단계에서 합의된 점, 남은 이견(누가 무엇을 왜), 최종안을 따로 적습니다. 다수결을 정답으로 삼지 않습니다.",
      "근거·테스트 증거가 약한 주장은 '확인 필요'로 남기고 다음 검증 방법을 붙입니다.",
    ],
    outputFormat: ["질문 요약", "참여 AI와 단계별 상태", "답변 요지 비교표", "익명 교차 검토 요지", "합의된 점", "남은 이견", "최종안", "확인 필요·다음 검증"],
    guardrails: [
      "실제로 여러 AI가 답하지 않았으면 첫 줄에 '단일 AI 관점 분리 검토(교차 검증 아님)'라고 밝힙니다.",
      "참여 모델·단계·구독 사용량이 생긴다는 점을 숨기지 않고, 사용자가 중단하면 그 단계까지만 보고합니다.",
    ],
    companionSkills: [],
    sources: [
      { label: "LLM Council(karpathy/llm-council)", url: "https://github.com/karpathy/llm-council", license: "라이선스 표기 없음(2026-11-02 재확인, 92e1fccb1bdc) — 코드 복제 없이 흐름만 독자 구현", status: "모디크루 실행기에 교차 검토 단계 구현", reviewedVersion: "92e1fccb1bdc", checkedAt: "2026-11-02" },
    ],
  },
  {
    name: "mody-insta-content",
    label: "인스타 콘텐츠 제작",
    description: "인스타그램 릴스·캐러셀 콘텐츠를 레퍼런스 분석, 소재 발굴, 첫 문장(훅), 대본, 표지 문구, 게시 전 검토까지 한 번에 만드는 제작 절차입니다. '인스타', '릴스', '캐러셀', '숏폼 대본', '훅 문장', '표지 문구', 'SNS 콘텐츠' 요청에 씁니다. 게시·예약·DM은 하지 않습니다.",
    execution: "instructions",
    ownerRoleIds: ["content-editor"],
    version: "1.1.0",
    category: "content",
    availability: "core",
    profile: "standard",
    permissions: [],
    requires: { runtimes: ["codex", "claude"], minRuntimes: 0 },
    io: { inputs: ["레퍼런스 링크·캡처 설명", "목표 고객·브랜드 말투"], outputs: ["레퍼런스 분석표", "훅 비교표", "대본(초 단위)·장별 문구", "댓글·DM 응대 초안(발송 안 함)", "게시 전 점검표"] },
    verification: { level: "unit_test", checkedAt: "2026-11-02", note: "지침형 — 채팅 프롬프트 자동 선택만 테스트. 실제 실행기 실행 기록 없음" },
    triggers: ["인스타", "instagram", "릴스", "reels", "캐러셀", "카드뉴스", "숏폼", "쇼츠 대본", "훅 문장", "후킹", "표지 문구", "썸네일 문구", "sns 콘텐츠", "콘텐츠 소재"],
    steps: [
      "사용자가 준 레퍼런스(링크·캡처·설명)만 근거로 주제·구성·첫 3초·톤을 분석합니다. 조회 수 같은 수치를 지어내지 않습니다.",
      "목표 고객의 문제·욕구로 소재 후보 5개를 만들고 공감도·차별성·제작 난이도로 고릅니다.",
      "첫 문장(훅) 3안 이상을 질문형·숫자형·반전형으로 비교하고 추천 이유를 붙입니다.",
      "릴스는 초 단위 타임라인 대본(0~3초 훅, 본문, 마지막 행동 유도), 캐러셀은 장별 문구(1장 표지~마지막 장 행동 유도)로 씁니다.",
      "표지 문구 5안(15자 안팎), 캡션·해시태그 초안을 만듭니다. 예상 댓글·DM 질문 3개에 답장 초안을 붙이되 보내지 않습니다.",
      "게시 전 점검: 사실 확인, 저작권·초상권, 광고 표기, 개인정보, 브랜드 말투.",
    ],
    outputFormat: [
      "레퍼런스 분석표",
      "소재 후보와 선택 이유",
      "훅 비교표",
      "대본(초 단위) 또는 장별 문구",
      "표지 문구 5안",
      "캡션·해시태그",
      "댓글·DM 응대 초안(발송 안 함)",
      "게시 전 점검표",
    ],
    guardrails: [
      "게시·예약·DM·댓글 답장은 하지 않습니다. 실제 계정 게시는 계정 연결과 별도 승인 후의 일입니다.",
      "무료 자료만으로 영상 제작·예약 게시·DM 자동화가 완성된다고 말하지 않습니다.",
    ],
    companionSkills: ["korean-humanizer", "korean-spell-check", "korean-slang-writing"],
    sources: [
      { label: "인스타 콘텐츠 자동화 무료 프롬프트 가이드", url: "https://every-ai-guides.vercel.app/posts/insta-automation-free-prompts", license: "가이드 참고 — 문장은 독자 작성", status: "제작 절차 반영. 프롬프트 6개와 실제 영상 생성·예약 게시·DM 실행은 구분, 계정 게시·DM 연동은 미구현" },
      { label: "피클 소개 게시물(SNS 조사·후킹 비교·캐러셀/릴스·댓글/DM 흐름)", url: "https://www.instagram.com/p/DfBdYNkkUGI/?img_index=10", license: "게시물 참고 — 문장은 독자 작성", status: "흐름만 참고. 댓글·DM은 초안까지, 발송은 연결·별도 승인 뒤" },
    ],
  },
  {
    name: "mody-motion-video",
    label: "모션 영상 제작",
    description: "자막·로고·차트·앱 소개처럼 코드로 만드는 모션 영상을 대본과 장면 구성표, 장면 코드(HTML·CSS 애니메이션), 미리보기, 승인, 출력 순서로 만듭니다. '모션', '모션 그래픽', '애니메이션 영상', '자막 영상', '로고 애니메이션', '차트 영상', '앱 소개 영상' 요청에 씁니다.",
    execution: "agent",
    ownerRoleIds: ["content-editor"],
    version: "1.0.1",
    category: "content",
    availability: "core",
    profile: "standard",
    permissions: ["write_output"],
    requires: { runtimes: ["codex", "claude"], minRuntimes: 1 },
    io: { inputs: ["목적·길이·화면 비율·브랜드 색·꼭 넣을 문구"], outputs: ["output/storyboard.md", "output/motion.html", "output/README.md"] },
    verification: { level: "real_run", checkedAt: "2026-10-31", note: "Claude Code 격리 폴더 225초 완료(storyboard·motion.html·README). MP4 렌더는 미구현", runtimes: ["claude"] },
    triggers: ["모션", "motion", "애니메이션 영상", "모션 그래픽", "자막 영상", "로고 애니메이션", "차트 영상", "앱 소개 영상", "인트로 영상", "영상 만들", "영상 제작", "remotion", "hyperframes"],
    steps: [
      "목적·길이·화면 비율(16:9 또는 9:16)·브랜드 색·꼭 넣을 문구를 정합니다.",
      "장면 구성표를 씁니다: 장면 번호·시작~끝 초·화면 문구·움직임·전환.",
      "장면 코드는 외부 라이브러리·네트워크 없이 단일 HTML·CSS 애니메이션으로 만들고 재생·정지·장면 이동을 넣습니다.",
      "미리보기 방법과 확인할 점을 적고 사용자 승인을 받습니다.",
      "MP4 출력은 렌더링 도구가 있고 승인된 경우에만 진행합니다. 없으면 필요한 도구와 비용 조건을 적습니다.",
    ],
    outputFormat: ["장면 구성표(storyboard.md)", "장면 코드(motion.html)", "미리보기·출력 안내(README.md)"],
    guardrails: [
      "승인 전 MP4 렌더·업로드·게시를 하지 않습니다.",
      "모델만 연결된 상태에서는 영상을 만들었다고 쓰지 않고, 파일을 만든 경우에만 경로를 적습니다.",
    ],
    companionSkills: ["animation-vocabulary", "improve-animations", "review-animations", "fixing-motion-performance"],
    sources: [
      { label: "Claude 모션 100 가이드", url: "https://every-ai-guides.vercel.app/posts/claude-motion-100", license: "가이드 참고 — 문장은 독자 작성", status: "장면 구성·코드 장면 절차 반영. 100개를 사무실 캐릭터 동작으로 해석하지 않음" },
      { label: "HyperFrames(heygen-com/hyperframes)", url: "https://github.com/heygen-com/hyperframes", license: "Apache-2.0 · Copyright 2026 HeyGen, Inc.", status: "MP4 렌더 엔진 후보, 자동 설치하지 않음. Node 22+·Chrome·FFmpeg 필요, 로컬 렌더 무료, CLI 사용 정보 기본 전송, 클라우드 렌더는 업로드. 0.9.0 의 깨지는 변경은 Lambda·Cloud Run 분산 렌더(Plan v1 제거) 전용이라 로컬 렌더 후보에는 영향 없음(분산·클라우드 렌더는 쓰지 않음)", reviewedVersion: "v0.9.0 (f1391156e031)", checkedAt: "2026-11-02" },
    ],
  },
  {
    name: "mody-design-crew",
    label: "디자인팀 기본 절차",
    description: "모디크루 디자인팀 기본 절차입니다. 요구·브랜드·화면 조건 정리, 시안 제작(HTML·CSS 프로토타입 또는 화면 명세), 작은 화면·접근성 검수, 개발 인계까지 진행합니다. '디자인', 'UI', 'UX', '화면 설계', '랜딩 페이지', '배너', '와이어프레임', '시안', '접근성 검수' 요청에 씁니다. 어떤 AI가 붙어도 같은 절차와 결과 규격을 따릅니다.",
    execution: "agent",
    ownerRoleIds: ["product-designer"],
    version: "1.1.0",
    category: "design",
    availability: "core",
    profile: "standard",
    permissions: ["read_target", "write_output", "write_target"],
    requires: { runtimes: ["codex", "claude"], minRuntimes: 1 },
    io: { inputs: ["목적·대상·사용 환경", "브랜드 자료·참고 화면", "대상 폴더(기존 디자인 시스템·컴포넌트가 있으면)"], outputs: ["output/design-brief.md", "output/design-tokens.md — 디자인 시스템(토큰·컴포넌트 규칙)", "output/prototype.html", "output/qa-checklist.md — 14개 항목", "output/handoff.md"] },
    verification: { level: "real_run", checkedAt: "2026-11-02", note: "Codex 209초·Claude 447초 실행 완료(결과 5개, 검수 14항목, 브랜드 폴더 불변). 시안을 360·768·1280px·200% 확대에서 따로 열어 넘침·겹침·44px 미만 0", runtimes: ["codex", "claude"] },
    triggers: ["디자인", "시안", "화면 설계", "화면 구성", "와이어프레임", "랜딩 페이지", "랜딩페이지", "배너", "목업", "프로토타입", "접근성", "디자인 시스템", "브랜드 컬러", "레이아웃", "ui 디자인", "ux 설계"],
    steps: [
      "목적·대상 사용자·사용 환경(모바일·PC)·브랜드 자료·참고 화면을 정리하고 없는 자료는 가정으로 표시합니다.",
      "대상 폴더에 디자인 시스템·브랜드 토큰·공용 컴포넌트가 있으면 그것을 먼저 쓰고, 없을 때만 새 토큰을 만듭니다.",
      "화면마다 목적·정보 우선순위·핵심 행동을 정하고 색·글자·간격·모서리·움직임 기준과 컴포넌트 규칙을 디자인 시스템 표로 정리합니다.",
      "시안은 실제 문구와 상태(기본·빈 화면·오류·로딩)를 포함한 HTML·CSS 프로토타입 또는 화면 명세로 만듭니다.",
      "검수: 360·768·1280px 폭과 200% 확대에서 겹침·잘림, 명도 대비 4.5:1(큰 글자 3:1), 터치 영역 44px·간격 8px, 키보드 포커스, 대체 텍스트, 움직임 줄이기 설정.",
      "개발 인계: 화면별 구성요소·상태·간격·토큰·문구·남은 결정을 적습니다.",
    ],
    outputFormat: [
      "디자인 요구 정리",
      "디자인 시스템 표(토큰·컴포넌트 규칙)",
      "시안(프로토타입 또는 화면 명세)",
      "작은 화면·확대·접근성 점검표(통과·실패·미확인)",
      "개발 인계 명세",
    ],
    guardrails: [
      "이미지·영상 생성은 연결된 생성 도구가 있을 때만 하고, 모델만 연결된 상태에서는 만들었다고 쓰지 않습니다.",
      "외부 게시·배포·브랜드 기준 확정은 사용자 승인 후에 합니다.",
      "브라우저로 직접 보지 않은 검수 항목은 '미확인'으로 둡니다.",
    ],
    companionSkills: ["hallmark", "baseline-ui", "fixing-accessibility", "make-interfaces-feel-better", "improve-ui", "design-md-from-reference", "create-design-md", "ui-ux-pro-max"],
    sources: [
      { label: "디자인 스킬·도구 42가지 가이드", url: "https://yeongseon.kr/archive/f3dcb7349a5d4e6b99d86cecbc9c1d14.html", license: "가이드 참고 — 문장은 독자 작성", status: "디자인팀 기본 절차로 반영. 42개를 검증된 실행 스킬로 표시하지 않음" },
      { label: "UI UX Pro Max(nextlevelbuilder/ui-ux-pro-max-skill)", url: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill", license: "MIT · Copyright (c) 2024 Next Level Builder", status: "디자인 시스템 정리·접근성 우선 규칙 반영. 검색 스크립트는 Python 3 표준 라이브러리만 쓰고 네트워크 없음 — 이 PC에 설치돼 있을 때만 동반 스킬로 읽고 자동 설치하지 않음", reviewedVersion: "3a13158ff1f3 (v2.15.0 이후 main)", checkedAt: "2026-11-02" },
      { label: "사용자 요구(2026-10-30)", license: "내부 요구", status: "디자인팀 기본 탑재, 어떤 AI가 붙어도 같은 절차" },
    ],
  },
  {
    name: "mody-dev-crew",
    label: "개발팀 기본 절차",
    description: "모디크루 개발팀 기본 절차입니다. 요구사항 정리, 기존 코드 이해, 설계·분담, 코드 수정, 테스트·리뷰, 실제 실행 확인까지 진행하고 변경 파일·검사 결과·남은 실패를 함께 보고합니다. '개발', '기능 추가', '버그 수정', '코드 리뷰', '리팩터링', '테스트 작성', '코드베이스 파악' 요청에 씁니다.",
    execution: "agent",
    ownerRoleIds: ["software-engineer"],
    version: "1.1.0",
    category: "development",
    availability: "core",
    profile: "standard",
    planGate: true,
    permissions: ["read_target", "write_output", "write_target", "run_scripts"],
    requires: { runtimes: ["codex", "claude"], minRuntimes: 1 },
    io: { inputs: ["요청(기능·버그·리팩터링·테스트·리뷰)", "대상 폴더(읽기 또는 수정 허용)"], outputs: ["output/plan.json·plan.md — 작업 크기 판정과 계획", "output/dev-report.md", "output/proposed.diff(읽기 권한일 때)"] },
    verification: { level: "real_run", checkedAt: "2026-11-02", note: "Codex 210초·Claude 202초 실행 완료(작은 수정 판정 → 실패 테스트 확인 → 1줄 수정 → 테스트 통과). 큰 변경 설계 확인 흐름은 단위 테스트만", runtimes: ["codex", "claude"] },
    triggers: ["개발", "코딩", "코드 리뷰", "코드리뷰", "버그", "리팩터", "리팩토링", "테스트 코드", "테스트 작성", "기능 추가", "구현", "코드베이스", "pr 리뷰", "풀 리퀘스트", "pull request", "디버깅", "오류 수정", "에러 수정"],
    steps: [
      "작업 크기를 먼저 정합니다. 작은 수정(바꿀 파일 3개 이하, 공개 API·데이터 구조·인증·결제 변경 없음)은 짧은 계획 뒤 바로 진행하고, 큰 변경은 설계안 2~3개와 추천을 남긴 뒤 사용자 확인을 받고 구현합니다.",
      "저장소 지침과 관련 코드를 읽고, 새로 만들기 전에 꼭 필요한지 → 이미 있는 기능·컴포넌트 → 표준 라이브러리·플랫폼 기능 → 설치된 의존성 → 최소 코드 순서로 찾습니다.",
      "작업 계획은 바꿀 파일 경로와 확인 방법이 붙은 작은 단계로 나눕니다.",
      "테스트를 먼저 써서 실패를 확인한 뒤 최소 구현으로 통과시킵니다. 버그는 재현 테스트부터 씁니다.",
      "필요한 최소 변경만 하되 입력 검증·오류 처리·보안·접근성·데이터 보호·테스트는 줄이지 않고, 사용자가 이미 바꾼 내용을 보존합니다.",
      "변경을 처음부터 다시 읽어 정확성→안전→테스트→성능→군더더기 순으로 검토하고, 검사 명령을 다시 돌린 출력으로만 완료를 말합니다.",
      "변경 파일·검사 결과·남은 실패·되돌리는 방법을 보고합니다.",
    ],
    outputFormat: [
      "작업 크기 판정과 계획(plan.json·plan.md)",
      "요구사항·인수 조건",
      "코드 이해 요약",
      "설계·분담",
      "변경 파일 표",
      "실행한 검사와 결과(명령·종료 코드)",
      "남은 실패·위험",
      "되돌리는 방법",
    ],
    guardrails: [
      "코드 수정은 사용자가 수정 권한을 준 폴더에서만 합니다. 큰 변경은 설계 확인 전에 고치지 않습니다(실행기가 계획 단계를 따로 둡니다).",
      "배포·푸시·삭제·의존성 설치는 사용자 승인 필요로 남깁니다.",
      "코드 줄 수를 줄이려고 보안·예외 처리·테스트를 빼지 않습니다.",
    ],
    companionSkills: ["codebase-onboarding", "senior-architect", "senior-frontend", "senior-qa", "pr-review-expert", "agile-product-owner"],
    sources: [
      { label: "claude-skills(alirezarezvani/claude-skills)", url: "https://github.com/alirezarezvani/claude-skills", license: "MIT(Copyright 2025 Alireza Rezvani) · 원본 commit 0496583603e56cdd5022dd61c823bd784a80a752", status: "이 PC Codex 스킬 6개 설치됨, 실제 실행 때 함께 읽음. 최신 e4a1dc369590(v2.14.5)과 차이는 SKILL.md 설명 한 줄뿐이라 재설치하지 않음", reviewedVersion: "0496583603e5 (설치) · e4a1dc369590 (최신)", checkedAt: "2026-11-02" },
      { label: "Superpowers(obra/superpowers)", url: "https://github.com/obra/superpowers", license: "MIT · Copyright (c) 2025 Jesse Vincent", status: "작업 크기 판정·설계 확인·계획·테스트 먼저·완료 전 재검증 흐름을 독자 구현. 원본 미설치·코드 미복사", reviewedVersion: "v7.0.1 (2ce8aa15d05b)", checkedAt: "2026-11-02" },
      { label: "Ponytail(DietrichGebert/ponytail)", url: "https://github.com/DietrichGebert/ponytail", license: "MIT · Copyright (c) 2026 DietrichGebert", status: "재사용 사다리와 '검증·보안·접근성·데이터 보호는 줄이지 않음' 규칙 반영. 원본 미설치", reviewedVersion: "v5.3.3 (96608e078b2d)", checkedAt: "2026-11-02" },
    ],
  },
  {
    name: "mody-doc-to-skill",
    label: "문서로 업무 스킬 만들기",
    description: "회사 문서와 폴더를 읽어 업무 절차를 구조화하고, 원문 위치와 근거를 남긴 재사용 업무 스킬(SKILL.md)과 인수인계 문서로 만듭니다. '업무 매뉴얼', '절차서', '인수인계 문서', '스킬로 만들어', '업무 정리', '문서 구조화' 요청에 씁니다.",
    execution: "agent",
    ownerRoleIds: ["document-writer"],
    version: "1.0.1",
    category: "documents",
    availability: "core",
    profile: "standard",
    permissions: ["read_target", "write_output"],
    requires: { runtimes: ["codex", "claude"], minRuntimes: 1 },
    io: { inputs: ["읽을 문서·폴더(읽기 전용)", "만들 업무 단위"], outputs: ["output/source-index.md — 읽은 자료(경로·수정일·원문 SHA-256)", "output/skills/<업무>/SKILL.md 초안", "output/handover.md"] },
    verification: { level: "unit_test", checkedAt: "2026-11-02", note: "실행기 단위 테스트만. 회사 문서 실제 실행 기록 없음" },
    triggers: ["업무 매뉴얼", "매뉴얼", "절차서", "인수인계", "스킬로 만들", "스킬 만들", "업무 정리", "문서 구조화", "업무 절차", "업무 표준", "sop"],
    steps: [
      "읽을 문서·폴더 범위와 만들 업무 단위를 정하고 읽은 파일 목록(경로·수정일·SHA-256 앞 12자리)을 남깁니다.",
      "업무마다 목적·담당·주기·입력·출력·단계·예외 처리를 뽑고 단계마다 근거(파일 경로·쪽/절)를 붙입니다.",
      "문서끼리 충돌하면 둘 다 근거와 함께 적고 확정하지 않습니다.",
      "재사용 업무 스킬(SKILL.md: 이름·설명·단계 지침·원문 버전)과 인수인계 문서를 만듭니다. 크루가 바뀌어도 이 문서로 이어받게 씁니다.",
      "개인정보·비밀번호·계좌 같은 민감 정보는 옮기지 않고 '민감 정보 있음(위치)'으로 표시합니다.",
    ],
    outputFormat: ["읽은 자료 목록", "업무 절차 표(근거 포함)", "업무 스킬 SKILL.md 초안", "인수인계 문서", "확인 필요"],
    guardrails: [
      "원본 파일을 고치거나 옮기거나 지우지 않습니다.",
      "근거 없는 단계는 만들지 않고 '확인 필요'로 남깁니다.",
    ],
    companionSkills: ["hwp", "rhwp-edit"],
    sources: [
      { label: "모디크루 문서 크루 요구(2026-10-30)", license: "내부 요구", status: "문서→업무 스킬 절차 구현" },
      { label: "Agent Skills 규격", url: "https://agentskills.io/specification", license: "공개 규격", status: "SKILL.md 형식 준수" },
    ],
  },
  {
    name: "mody-security-audit",
    label: "보안 점검(읽기 전용 감사)",
    description: "내 코드·앱 폴더를 읽기 전용으로 살펴 구조와 신뢰 경계를 정리하고, 취약점 후보를 찾은 뒤 반박·검증해 confirmed·needs_validation·rejected로 나눠 보고하는 선택형 보안 점검 절차입니다. '보안 점검', '보안 감사', '취약점 점검', '보안 검토', 'security audit' 요청에 씁니다. 코드를 고치지 않고 운영 서비스 공격·외부 업로드·유료 호출을 하지 않습니다.",
    execution: "agent",
    ownerRoleIds: ["software-engineer"],
    version: "1.0.0",
    category: "security",
    availability: "optional",
    profile: "audit",
    permissions: ["read_target"],
    requires: { runtimes: ["codex", "claude"], minRuntimes: 1 },
    io: { inputs: ["점검할 폴더(읽기 전용)", "점검 범위·제외 범위"], outputs: ["security-report.md — 범위·판정별 표·검사하지 못한 범위", "findings.json — 앱이 근거 위치를 검사한 판정 목록"] },
    verification: { level: "real_run", checkedAt: "2026-11-02", note: "연습용 서버 코드에서 Codex 47초·Claude 55초 실행 완료(대상 폴더 불변, 보고서에 키 원문 없음). 같은 코드에서도 판정이 실행기마다 달랐음", runtimes: ["codex", "claude"] },
    triggers: ["보안 점검", "보안점검", "보안 감사", "보안감사", "취약점", "보안 검토", "보안검토", "security audit", "시큐리티 점검", "보안 취약"],
    steps: [
      "점검 대상 폴더·범위·소유 권한을 확인합니다. 내 코드가 아니거나 운영 서비스 공격이 필요한 요청은 하지 않습니다.",
      "구조와 신뢰 경계(입력 지점·인증·권한·비밀값·외부 연결)를 정리하고 검사할 범위 목록을 만듭니다.",
      "범위마다 취약점 후보를 찾고, 후보마다 반대 근거를 찾아 반박을 시도합니다.",
      "판정: 진입점부터 위험 지점까지 근거가 이어지면 confirmed, 실행·환경 확인이 필요하면 needs_validation, 반박되면 rejected로 둡니다.",
      "항목마다 근거 파일·줄, 재현 조건, 영향, 검증 방법, 권장 수정, 검증 한계를 적고 검사한 범위와 못 한 범위를 남깁니다.",
    ],
    outputFormat: [
      "점검 범위와 실행 조건",
      "구조·신뢰 경계 요약",
      "confirmed 표",
      "needs_validation 표",
      "rejected 표",
      "검사한 범위·못 한 범위",
      "강화 메모",
    ],
    guardrails: [
      "대상 코드를 실행하지 않고 읽기만 합니다. 실행이 필요한 확인은 needs_validation 으로 남깁니다.",
      "코드 수정·운영 서비스 공격·외부 업로드·유료 호출을 하지 않고, 이 점검으로 앱 전체가 안전하다고 말하지 않습니다.",
      "비밀값은 위치만 적고 값을 옮겨 쓰지 않습니다.",
    ],
    companionSkills: [],
    sources: [
      { label: "Cloudflare security-audit-skill", url: "https://github.com/cloudflare/security-audit-skill", license: "MIT · Copyright (c) 2025-2026 Cloudflare, Inc.", status: "정찰→후보 발견→반박 검증→판정→보고 흐름과 판정 규칙을 독자 구현. OS 샌드박스 조건을 다 갖추지 못하므로 대상 코드는 실행하지 않음", reviewedVersion: "c1c8a8c14710", checkedAt: "2026-11-02" },
      { label: "바이브 코딩 앱 보안 감사 가이드", url: "https://sdk-kim-builds.com/guides/vibe-coding-app-security-audit/", license: "가이드 참고 — 문장은 독자 작성", status: "자기 코드에만 쓰기·한 번에 다 찾지 못함·사용량 주의 반영" },
    ],
  },
  {
    name: "mody-reverse-engineering",
    label: "기능 분석(리버스 엔지니어링)",
    description: "분석 권한이 있는 프로그램·앱 파일(설치본·APK·실행 파일·웹 번들)을 이 PC의 REA 분석 도구로 살펴 기능과 요구사항을 뽑고, 기존 앱과 대조해 독자 구현 계획과 검증 방법을 만드는 선택형 개발 절차입니다. '리버스 엔지니어링', '역공학', '디컴파일', '바이너리 분석', 'APK 분석' 요청에 씁니다. 확인한 사실·추정·확인하지 못한 것을 나눠 저장합니다.",
    execution: "agent",
    ownerRoleIds: ["software-engineer"],
    version: "1.0.1",
    category: "reverse_engineering",
    availability: "optional",
    profile: "reverse",
    permissions: ["read_target", "write_output", "mcp:rea"],
    requires: { runtimes: ["codex", "claude"], minRuntimes: 1, mcpServers: ["rea"] },
    io: { inputs: ["분석할 파일·폴더(사본으로 분석)", "목적·비교할 기존 기능"], outputs: ["output/re-findings.md — 확인한 사실·추정·확인하지 못한 것", "output/requirements.md", "output/comparison.md"] },
    verification: { level: "connection_check", checkedAt: "2026-11-02", note: "이 PC REA MCP 서버가 도구 229개로 응답(모델 미호출). 실제 분석 실행은 QA 기록 참고" },
    triggers: ["리버스 엔지니어링", "리버스엔지니어링", "리버스", "역공학", "역분석", "디컴파일", "decompile", "바이너리 분석", "apk 분석", "reverse engineer", "ghidra", "jadx"],
    steps: [
      "분석 대상이 사용자 소유이거나 분석이 허용된 것인지, 목적과 범위를 먼저 확인합니다. 접근 제한·인증·보호 장치는 우회하지 않습니다.",
      "원본 대신 실행 폴더에 복사한 사본을 REA 도구로 분석해 화면·기능·데이터 흐름·외부 연결을 정리합니다.",
      "관찰한 동작에서 요구사항(사용자 행동·입출력·예외)을 뽑고 근거(함수·주소·파일 위치)를 붙입니다.",
      "기존 모디크루 기능과 대조해 이미 있는 것·부족한 것·새로 필요한 것을 나눕니다.",
      "원본 코드를 옮기지 않는 독자 구현 계획(또는 라이선스가 허용한 재사용 범위)과 검증 방법을 씁니다.",
    ],
    outputFormat: [
      "대상·권한·범위 확인",
      "확인한 사실(근거 위치 포함)",
      "추정",
      "확인하지 못한 것",
      "요구사항 목록",
      "기존 기능 대조표",
      "구현·검증 계획",
    ],
    guardrails: [
      "권한이 확인되지 않은 대상, 보호 장치 해제, 라이선스 키·인증 우회 요청은 하지 않습니다.",
      "원본 코드·자산을 결과물에 옮겨 쓰지 않고 동작 설명과 독자 구현 계획만 남깁니다.",
      "확인한 사실과 추정을 섞지 않습니다.",
    ],
    companionSkills: ["reverse-engineer-anything"],
    sources: [
      { label: "REA(rea-agents, npm)", url: "https://github.com/morluto/rea", license: "MIT(설치 패키지 package.json 선언)", status: "이 PC에 6.8.0 설치·Codex/Claude MCP 등록. 설치 패키지 README 가 공식 출처로 밝힌 곳(morluto/rea·rea.tools·npm)과 GitHub 릴리스 rea-agents-6.8.0 의 package.json 이 설치본과 일치(이름이 비슷한 다른 저장소는 연결하지 않음). REA 가 Ghidra 12.1.x 만 지원해 12.1.4 를 유지 — 12.2 에서만 고쳐진 공개 보안 권고가 남아 있어 스킬에 주의 절을 둠", reviewedVersion: "rea-agents 6.8.0 · reverse-engineer-anything 스킬 version 49", checkedAt: "2026-11-02" },
      { label: "Ghidra(NationalSecurityAgency/ghidra)", url: "https://github.com/NationalSecurityAgency/ghidra", license: "Apache-2.0 + 저장소 NOTICE(정부 저작물·구성요소 조건)", status: "REA 분석용 12.1.4(REA 지원 범위), 별도 GUI 12.2. 12.1.4 에는 12.2 에서 고쳐진 공개 보안 권고가 남아 있어 출처 모를 파일의 압축 가져오기·확장·디버거·서버 연결을 쓰지 않음", reviewedVersion: "12.1.4(REA)·12.2(GUI)", checkedAt: "2026-11-02" },
      { label: "jadx-headless-mcp", url: "https://github.com/1013503897/jadx-headless-mcp", license: "Apache-2.0", status: "REA 가 0.7.1 을 고정(jadx-core 1.5.6 포함). 최신 0.8.0 이 있으나 REA 가 버전을 바꿀 때까지 교체하지 않음", reviewedVersion: "v0.7.1 (REA 고정)", checkedAt: "2026-11-02" },
    ],
  },
  {
    name: "mody-pc-control",
    label: "PC 앱 조작",
    description: "이 PC에 열린 앱 창의 버튼·입력칸을 읽고, 사용자가 승인한 단계만 한 번씩 실행한 뒤 화면을 다시 읽어 결과를 확인하는 선택형 업무 절차입니다. 'PC 조작', '프로그램에 입력', '창에서 눌러 줘', '메모장·계산기' 요청에 씁니다. 화면 내용은 사용자가 '화면 읽기 확인'에서 허용한 창만 대화 AI 모델에 전달하고, 화면 이미지는 쓰지 않으며, 비밀번호 칸·키 입력·관리자 권한 앱은 다루지 않습니다.",
    execution: "app_tool",
    ownerRoleIds: ["work-manager"],
    version: "1.1.0",
    category: "documents",
    availability: "optional",
    profile: "standard",
    permissions: ["desktop_control", "write_output"],
    requires: { runtimes: [], minRuntimes: 0, cli: ["agent-desktop"] },
    platforms: ["win32"],
    io: {
      inputs: ["조작할 앱(열려 있는 창, 메모장·계산기·그림판은 열기까지 가능)", "하려는 일(예: 메모 입력칸에 회의록 제목을 넣고 저장 누르기)"],
      outputs: ["승인함 'PC 작업' 카드(승인 대기→실행 중→완료·실패·결과 확인 필요)", "단계별 결과·화면 재확인 기록", "결과 문서(.md) — 앱 데이터 폴더 desktop-app-control/results"],
    },
    verification: { level: "real_run", checkedAt: "2026-11-02", note: "앱 코드 격리 실행에서 실제 확인 창을 눌러 17/17(화면 읽기 거절·허용, 실행·승인함 승인, 업무 이벤트, 재시작 뒤 재확인). 실제 모델이 앱 도구 설명만으로 pc.inspect→pc.request 를 골라 완료. 채팅 화면 전체 경로는 이 PC 모델 실행기 지연(약 50초)으로 미완 — QA 기록 참고" },
    triggers: ["pc 조작", "pc에서", "컴퓨터 조작", "컴퓨터 사용", "화면 조작", "앱 조작", "프로그램 조작", "프로그램에 입력", "창에 입력", "창에서 눌러", "클릭해", "눌러 줘", "체크해 줘", "메모장", "계산기", "그림판", "agent-desktop", "computer use"],
    steps: [
      "pc.inspect 로 대상 앱 창의 화면 요소(역할·이름·값)를 먼저 읽습니다. 사용자가 '화면 읽기 확인' 창에서 허용해야 내용이 돌아옵니다(같은 대화·같은 창은 10분). 거절하면 같은 읽기를 반복하지 말고 사용자에게 직접 알려 달라고 합니다. 앱 이름을 모르면 app 없이 불러 열린 앱 이름 목록을 보여 줘도 되는지 묻습니다.",
      "읽은 요소 이름을 그대로 써서 단계(action·role·name·value)를 6개 이내로 정하고, 확인할 결과 글자(verify.textContains)가 있으면 함께 적어 pc.request 로 승인을 요청합니다.",
      "실행은 사용자가 실행 확인 창이나 승인함에서 승인한 뒤에만 됩니다. 승인 전에는 했다고 쓰지 않습니다.",
      "실행 결과(완료·실패·결과 확인 필요), 화면 재확인 결과, 결과 문서 위치를 그대로 알립니다. 실패하거나 불확실한 단계는 다시 시도하지 말고 사용자 확인을 받습니다.",
      "키 입력·단축키·마우스 좌표·비밀번호 칸·관리자 권한 앱·최소화된 창·잠긴 PC 는 지원하지 않는다고 안내합니다.",
    ],
    outputFormat: ["대상 앱·창", "단계와 승인 상태", "실행 결과와 화면 재확인", "결과 문서 위치", "확인하지 못한 것"],
    guardrails: [
      "비밀번호·인증번호·결제 정보는 입력하지 않고 사용자에게 맡깁니다.",
      "화면 이미지를 만들거나 요구하지 않습니다. 화면 내용은 사용자가 허용한 창만 받고, 읽은 화면 요소는 이 작업에만 씁니다.",
      "다른 대화·다른 저장 위치의 PC 작업은 보이지 않으니 지어내지 않습니다.",
      "보내기·삭제·결제처럼 되돌리기 어려운 버튼은 승인 창에 위험 표시가 붙은 상태로만 요청합니다.",
      "보안 차단 우회·권한 상승·잠금 해제·다른 사용자 세션 조작을 하지 않습니다.",
    ],
    companionSkills: ["agent-desktop", "agent-desktop-windows"],
    sources: [
      { label: "agent-desktop (vercel-labs)", url: "https://github.com/vercel-labs/agent-desktop", license: "Apache-2.0 (npm 패키지 package.json 선언)", status: "공식 CLI 를 이 PC의 npm 전역 설치본으로 호출. 코드 내장·재배포 없음. 기본 Codex 스킬(agent-desktop·agent-desktop-windows)은 실행 파일에 동봉된 문서와 같은 버전", reviewedVersion: "1.0.2", checkedAt: "2026-11-02" },
    ],
  },
];

/** 참고자료·후보·보류 목록(요청서 6절). 스킬이 아닌 자료도 웹·앱 확장 센터에 같은 상태로 보인다. */
export type CrewExtensionReferenceState = "reflected" | "candidate" | "on_hold" | "unverified";
export type CrewExtensionReference = {
  requires?: Readonly<Record<string, unknown>>; permissions?: readonly string[]; cost?: Readonly<Record<string, unknown>>;
  ownerRoleIds?: readonly string[];
  kind?: "skill" | "tool" | "framework" | "model";
  installation?: { type: "reviewed_source_bundle"; name: string; manifestSha256: string } | { type: "github_skill_bundle"; owner: string; repo: string; commit: string; licensePath: string; licenseSha256: string; entrypoint: string; packages: readonly { name: string; path: string; sha256: string }[] };
  id: string; label: string; category: CrewSkillCategory; url?: string; license: string; reviewedVersion: string;
  state: CrewExtensionReferenceState; reflectedIn: readonly string[]; note: string; checkedAt: string;
};
export const crewExtensionReferenceStateLabels: Readonly<Record<CrewExtensionReferenceState, string>> = Object.freeze({
  reflected: "반영됨",
  candidate: "후보(미설치)",
  on_hold: "보류(승인 대기)",
  unverified: "확인 불가",
});
export const crewExtensionReferences: readonly CrewExtensionReference[] = Object.freeze([
{
  "id": "humanizer",
  "state": "candidate",
  "reflectedIn": [],
  "reviewedVersion": "0ef9fe5bc3572734fd3ae6c448fe00a30cd5dcf0",
  "label": "Humanizer",
  "category": "content",
  "url": "https://github.com/blader/humanizer",
  "license": "MIT",
  "kind": "skill",
  "ownerRoleIds": [
    "content-editor",
    "document-writer"
  ],
  "requires": {
    "runtime": [
      "Agent Skill 호스트와 SKILL.md. 기존 im-not-ai와 다른 원본이며 한국어 품질 별도 평가"
    ],
    "imageMatch": {
      "status": "candidate_name_match",
      "publisherLinkVerified": false,
      "collection": "claude-tools-image-2026-11-05"
    },
    "sourceReview": {
      "commit": "0ef9fe5bc3572734fd3ae6c448fe00a30cd5dcf0",
      "license": "MIT",
      "licensePath": "LICENSE",
      "licenseSha256": "4ac4810254ab36d45419141aeb8e69bf50652cfafe5b2dab947d06d44e5cbf96",
      "readmeSha256": "500b53c0d29cd3219d160b5f9a109c0969f706aec74b49a4a081d2026ba48ec7",
      "checkedAt": "2026-11-05",
      "installedVersionUnchanged": true
    }
  },
  "permissions": [
    "선택한 문서 읽기·수정",
    "모델 이용 시 문서 전송"
  ],
  "cost": {
    "status": "provider_dependent",
    "note": "원본 라이선스는 서비스 무료 보장이 아님. 모델·호스트·선택적 API/프록시 비용은 실행 전 확인; 이번 조사 비용성 호출 없음."
  },
  "note": "AI 문장의 상투적 표현을 검토하고 자연스러운 초안으로 수정. 이미지의 이름·설명에 따른 후보 매칭이며 게시자 원본 링크는 미확인. 이번 조사는 메타데이터 확인만 수행했으며 실제 설치·실행·한국어 품질은 검증하지 않음. 모디크루 실행·설치 어댑터 미연결. 공용 검색 후 필요 시 연결 검토.",
  "checkedAt": "2026-11-05"
},
{
  "id": "taste-skill",
  "state": "candidate",
  "reflectedIn": [],
  "reviewedVersion": "822e0b9d872e10deb931afad2c6c2bd943cf4c7b",
  "label": "Taste Skill",
  "category": "design",
  "url": "https://github.com/Leonxlnx/taste-skill",
  "license": "MIT",
  "kind": "skill",
  "ownerRoleIds": [
    "product-designer",
    "software-engineer"
  ],
  "requires": {
    "runtime": [
      "Node 22+와 Chrome/Edge/Chromium. ffmpeg 선택; 추가 사진·아이콘 검색은 네트워크 사용. 번들 자산 권리는 개별 확인"
    ],
    "imageMatch": {
      "status": "candidate_name_match",
      "publisherLinkVerified": false,
      "collection": "claude-tools-image-2026-11-05"
    },
    "sourceReview": {
      "commit": "822e0b9d872e10deb931afad2c6c2bd943cf4c7b",
      "license": "MIT",
      "licensePath": "LICENSE",
      "licenseSha256": "4575a543ab88dad12ccea7d97e563d0bce5b448b06072e65d3264497dad326df",
      "readmeSha256": "6b9f220382bc3089f300ea90fc296686266afc33b47b381210c547df78b76625",
      "checkedAt": "2026-11-05",
      "installedVersionUnchanged": true
    }
  },
  "permissions": [
    "프로젝트 파일 읽기·수정",
    "브라우저 실행",
    "선택적 외부 자산 요청"
  ],
  "cost": {
    "status": "provider_dependent",
    "note": "원본 라이선스는 서비스 무료 보장이 아님. 모델·호스트·선택적 API/프록시 비용은 실행 전 확인; 이번 조사 비용성 호출 없음."
  },
  "note": "웹사이트 디자인 시스템·구성·브라우저 일관성 검토. 이미지의 이름·설명에 따른 후보 매칭이며 게시자 원본 링크는 미확인. 이번 조사는 메타데이터 확인만 수행했으며 실제 설치·실행·한국어 품질은 검증하지 않음. 모디크루 실행·설치 어댑터 미연결. 공용 검색 후 필요 시 연결 검토.",
  "checkedAt": "2026-11-05"
},
{
  "id": "impeccable",
  "state": "candidate",
  "reflectedIn": [],
  "reviewedVersion": "5af4319c4e7a7ee3e5e2b9fe899bcfb21c6190cb",
  "label": "Impeccable",
  "category": "design",
  "url": "https://github.com/pbakaus/impeccable",
  "license": "Apache-2.0",
  "kind": "skill",
  "ownerRoleIds": [
    "product-designer",
    "software-engineer"
  ],
  "requires": {
    "runtime": [
      "호환 에이전트; CLI·렌더 기능은 Node 및 Chrome/Edge 등 모드별 조건 확인. live Apply의 CLI 대체 실행은 승인·샌드박스 우회 옵션을 사용할 수 있어 자동 실행 금지. IMPECCABLE_LIVE_COPY_AGENT=chat/off도 사용 전 설정 검토 필요"
    ],
    "imageMatch": {
      "status": "candidate_name_match",
      "publisherLinkVerified": false,
      "collection": "claude-tools-image-2026-11-05"
    },
    "sourceReview": {
      "commit": "5af4319c4e7a7ee3e5e2b9fe899bcfb21c6190cb",
      "license": "Apache-2.0",
      "licensePath": "LICENSE",
      "licenseSha256": "02bb8c3b4e70190e3986c0404ad2fd8d639b4f534252d82379cc1b502b6d1812",
      "readmeSha256": "6c4a86424a12eac2a568e4cc3afa411d9f2acb08fce3e97b41c9d6e951ba8bdf",
      "checkedAt": "2026-11-05",
      "installedVersionUnchanged": true
    }
  },
  "permissions": [
    "파일 수정·훅·로컬 서버·브라우저",
    "live는 환경 상속 및 페이지 HTML·텍스트·경로의 모델 전송 가능",
    "검증 스크립트 실행 가능",
    "승인·샌드박스 우회 금지"
  ],
  "cost": {
    "status": "provider_dependent",
    "note": "원본 라이선스는 서비스 무료 보장이 아님. 모델·호스트·선택적 API/프록시 비용은 실행 전 확인; 이번 조사 비용성 호출 없음."
  },
  "note": "UI 디자인 비평·품질 검사와 수정 지침. 이미지의 이름·설명에 따른 후보 매칭이며 게시자 원본 링크는 미확인. 이번 조사는 메타데이터 확인만 수행했으며 실제 설치·실행·한국어 품질은 검증하지 않음. live Apply는 승인·샌드박스 우회 CLI를 실행할 수 있으므로 자동 실행 금지. 모디크루 실행·설치 어댑터 미연결. 공용 검색 후 필요 시 연결 검토.",
  "checkedAt": "2026-11-05"
},
{
  "id": "diagram-design",
  "state": "candidate",
  "reflectedIn": [],
  "reviewedVersion": "f24d98b05e2d7a5e68c2dedfe46e5b7173f50118",
  "label": "Diagram Design",
  "category": "documents",
  "url": "https://github.com/cathrynlavery/diagram-design",
  "license": "MIT",
  "kind": "skill",
  "ownerRoleIds": [
    "document-writer",
    "product-planner",
    "product-designer"
  ],
  "requires": {
    "runtime": [
      "SKILL.md뿐 아니라 references/assets/scripts 묶음 필요. 내보내기·가져오기 등은 호스트 플러그인 및 브라우저 의존성 별도 확인"
    ],
    "imageMatch": {
      "status": "candidate_name_match",
      "publisherLinkVerified": false,
      "collection": "claude-tools-image-2026-11-05"
    },
    "sourceReview": {
      "commit": "f24d98b05e2d7a5e68c2dedfe46e5b7173f50118",
      "license": "MIT",
      "licensePath": "LICENSE",
      "licenseSha256": "bb7e12e91fecef43024111123ff784cec6c485585561d8b552557c0173b3ed29",
      "readmeSha256": "fcdb4da27c134afdb48e0640db24d55aba4918856c9c3bf1fdb01d4664205979",
      "checkedAt": "2026-11-05",
      "installedVersionUnchanged": true
    }
  },
  "permissions": [
    "자료 읽기·결과 파일 생성",
    "선택적 스크립트·브라우저 실행"
  ],
  "cost": {
    "status": "provider_dependent",
    "note": "원본 라이선스는 서비스 무료 보장이 아님. 모델·호스트·선택적 API/프록시 비용은 실행 전 확인; 이번 조사 비용성 호출 없음."
  },
  "note": "설명용 다이어그램을 HTML/SVG로 구성하고 검토. 이미지의 이름·설명에 따른 후보 매칭이며 게시자 원본 링크는 미확인. 이번 조사는 메타데이터 확인만 수행했으며 실제 설치·실행·한국어 품질은 검증하지 않음. 모디크루 실행·설치 어댑터 미연결. 공용 검색 후 필요 시 연결 검토.",
  "checkedAt": "2026-11-05"
},
{
  "id": "last30days",
  "state": "candidate",
  "reflectedIn": [],
  "reviewedVersion": "e9c31b868ab9d284c1a988e528c3391c51ebf944",
  "label": "Last 30 Days",
  "category": "research",
  "url": "https://github.com/mvanhorn/last30days-skill",
  "license": "MIT",
  "kind": "skill",
  "ownerRoleIds": [
    "research-assistant",
    "growth-strategist",
    "b2c-customer-growth"
  ],
  "requires": {
    "runtime": [
      "Python 스크립트·호환 호스트; 출처별 API 키·CLI·세션 필요 여부 다름. 첫 설정의 추가 CLI 설치, 쿠키 읽기 계획을 먼저 검토"
    ],
    "imageMatch": {
      "status": "candidate_name_match",
      "publisherLinkVerified": false,
      "collection": "claude-tools-image-2026-11-05"
    },
    "sourceReview": {
      "commit": "e9c31b868ab9d284c1a988e528c3391c51ebf944",
      "license": "MIT",
      "licensePath": "LICENSE",
      "licenseSha256": "31803213a789825dc419de43542381e1d570b4408cf2bcf2e8a9947a6d3fd2ab",
      "readmeSha256": "923e4e31e282d525a4b5936ed9aae0dfab0259d6cdef343c85aa96db949ce14e",
      "checkedAt": "2026-11-05",
      "installedVersionUnchanged": true
    }
  },
  "permissions": [
    "검색어 외부 전송·결과 파일 기록",
    "선택적 로그인 세션·쿠키·API 키 접근은 별도 승인"
  ],
  "cost": {
    "status": "provider_dependent",
    "note": "원본 라이선스는 서비스 무료 보장이 아님. 모델·호스트·선택적 API/프록시 비용은 실행 전 확인; 이번 조사 비용성 호출 없음."
  },
  "note": "최근 30일 자료와 커뮤니티 신호 조사. 이미지의 이름·설명에 따른 후보 매칭이며 게시자 원본 링크는 미확인. 이번 조사는 메타데이터 확인만 수행했으며 실제 설치·실행·한국어 품질은 검증하지 않음. 모디크루 실행·설치 어댑터 미연결. 공용 검색 후 필요 시 연결 검토.",
  "checkedAt": "2026-11-05"
},
{
  "id": "harvey",
  "label": "Harvey · 기업 영업 참고 원본",
  "category": "research",
  "url": "https://github.com/ethanplusai/harvey",
  "license": "MIT · Copyright 2026 Ethan Rogers",
  "reviewedVersion": "6b6a23a789090e165802baef4104ee4618a3e169",
  "state": "candidate",
  "reflectedIn": [
    "mody-b2b-discovery"
  ],
  "checkedAt": "2026-11-05",
  "ownerRoleIds": [
    "b2b-customer-developer"
  ],
  "kind": "tool",
  "requires": {
    "python": ">=3.11",
    "packageVersion": "0.3.0",
    "runtime": "Claude Code 또는 원본에서 검증한 Codex CLI 0.159.3. 원본 Codex 공급자는 Windows 미지원.",
    "dependencies": [
      "pyyaml",
      "python-dotenv",
      "httpx",
      "playwright",
      "beautifulsoup4",
      "dnspython",
      "aiosmtplib",
      "aiosqlite",
      "pydantic",
      "pytz",
      "fastapi",
      "uvicorn"
    ],
    "connection": "원본 설치·메일함·선택 주소 검증 서비스 연결 미실행"
  },
  "permissions": [
    "원본 모델 서비스로 기업 자료·초안·답장 전송 가능",
    "메일 읽기·수정·발송; Gmail gmail.modify 권한 필요",
    "선택 주소 검증 서비스로 연락처 전송 가능; 별도 승인 필요"
  ],
  "cost": {
    "status": "provider_dependent",
    "note": "MIT 코드 사용과 서비스 비용은 별개. AI 구독·메일·주소 검증 서비스의 현재 요금과 한도를 실행 전 확인."
  },
  "note": "기업·매장 공개 정보와 영업 신호 중심의 원본. 모디 B2B 지침에 구조만 참고했으며 원본 설치·실행 어댑터는 미연결. B2C 개인 고객 확보 기능은 검증되지 않았고 별도 모디 익명 집계 절차로 제공. 메일 발송·자동 수집·계정 연결·개인정보 외부 전송 실행 없음. 한국어 수신거부와 국내 광고 규정 준수 미검증. Gmail gmail.modify 및 모델·메일·주소 검증 서비스 전송/비용은 별도 승인·확인 필요. 가이드: https://lazyowen.com/guides/claude-harvey-sales-agent"
},
{
  "id": "nemotron-transcribe-3-5",
  "label": "NVIDIA Nemotron 3.5 Transcribe · 공용 음성 전사 후보",
  "category": "research",
  "url": "https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B",
  "license": "OpenMDW-1.1",
  "reviewedVersion": "c17667641642c4265ff2b7037dd101b7d4567634",
  "state": "candidate",
  "reflectedIn": [],
  "note": "공용 후보: 모든 크루가 필요할 때 검색 가능하며 문서·회의록은 추천 역할일 뿐 독점 권한이 아님. 음성 받아쓰기 STT·전사·번역. 공식 모델 카드 확인: 한국어 포함 다화자 전사와 한국어↔영어 음성→텍스트 번역을 지원하는 오프라인 배치 모델. 약 34B 전체·4.3B 활성 파라미터이며 BF16 공식 예시는 H100 80GB. 구성별 GPU·메모리 확인 필요, 이 PC 실행 가능 여부 미검증. 실시간 통역·완벽한 화자 식별·실제 인물 식별 기능으로 제공하지 않음. 가중치 다운로드·설치·실행·녹음 업로드 없음; 검토 후보이며 실행 어댑터 미연결.",
  "checkedAt": "2026-11-04",
  "ownerRoleIds": [
    "document-writer"
  ],
  "kind": "model"
},
{
  "id": "tradingagents",
  "label": "TradingAgents",
  "category": "research",
  "url": "https://github.com/TauricResearch/TradingAgents",
  "license": "Apache-2.0",
  "reviewedVersion": "9fa1196fffbcfd9de5146d2dd2869df84ab99838",
  "state": "candidate",
  "reflectedIn": [
    "mody-securities-research"
  ],
  "note": "전체 소스·Python wheel 85개 고정 원본 설치와 tradingagents.analysis.run 분석 어댑터 구현. 사용자 선택 로컬 JSON의 OpenAI 모델·키·단가·요청/토큰/시간/예상비용 한도, yfinance 및 선택 Reddit/StockTwits만 사용. 설치와 외부 전송·비용 승인은 별도. 재무·뉴스·심리·차트→강세/약세→위험 검토 호출. 키는 대화·명령 인자에 반환하지 않음. 요청 전 추정 비용 제한은 실제 청구액 보장이 아님. 원본 및 85개 의존성 무결성과 격리 모의 테스트만 검증; 실제 원본 실행·유료 공급자·네이티브 호환성 미검증. 기존 검토 Python 3.14.0 필요. 거래·계정 접근·체결/잔고 시뮬레이션·국내 공시 완전 지원 없음. 과거 심리 자료 시점 일치 미보장. 별도 tradingagents.rating.read 문구 읽기 유지.",
  "checkedAt": "2026-11-04",
  "ownerRoleIds": [
    "securities-researcher"
  ],
  "kind": "framework"
},
{
  "id": "stageshow",
  "installation": {"type": "reviewed_source_bundle", "name": "stageshow", "manifestSha256": "190ecd1f1724b7f7a91bf6d05a78ba28b4d451b75d72d01ca24accc64af1303b"},
  "label": "Stageshow",
  "category": "research",
  "url": "https://github.com/benjitaylor/skills",
  "license": "MIT · stageshow/LICENSE",
  "reviewedVersion": "ccb6a382ae0bd3c9bdfc010d7fdfaec23ee2be21",
  "state": "candidate",
  "reflectedIn": [],
  "note": "공용 원본 스킬. 추천: 디자인·콘텐츠. v1.1.0 전체 372개 파일(이미지·TSX·예제·라이선스·NOTICE 포함)을 고정 커밋·파일별 SHA-256으로 확인해 필요할 때 설치하고 재사용. 원본을 잘라 넣지 않음. React·Vite·Playwright 등 실행 의존성 설치와 실제 렌더링은 미검증이며 자동 실행하지 않음.",
  "checkedAt": "2026-11-04",
  "ownerRoleIds": [
    "product-designer",
    "content-editor"
  ],
  "kind": "skill"
},
{
  "id": "grill-me",
  "label": "Grill Me · 기획 검토",
  "category": "research",
  "url": "https://github.com/mattpocock/skills",
  "license": "MIT",
  "reviewedVersion": "4ae2317ddb22b046e26455e4f9c9b3aaaf62212d",
  "state": "candidate",
  "reflectedIn": [],
  "note": "담당: 기획. 필요시 고정 커밋의 grill-me와 필수 grilling을 함께 확보. 원문·저작권 고지 보존. 설치 확인 뒤 전체 지침을 읽음. 원본 다중 에이전트 요구는 현재 환경 권한 내에서만 수행.",
  "checkedAt": "2026-11-04",
  "ownerRoleIds": [
    "product-planner"
  ],
  "kind": "skill",
  "installation": {
    "type": "github_skill_bundle",
    "owner": "mattpocock",
    "repo": "skills",
    "commit": "4ae2317ddb22b046e26455e4f9c9b3aaaf62212d",
    "licensePath": "LICENSE",
    "licenseSha256": "0e7ac423bf2c6e223b7c5b156f8cf72da49d748e56a1641402c31f22ad07dbb5",
    "entrypoint": "grilling",
    "packages": [
      {
        "name": "grilling",
        "path": "skills/productivity/grilling",
        "sha256": "27a1863fff81bc6ca0edf64426da6c2ca240644ce74fa09a78c3e5104bb17409"
      },
      {
        "name": "grill-me",
        "path": "skills/productivity/grill-me",
        "sha256": "bc29b52b74b5f409b625f6d4ce819f5fa3c02d5496cb8b382feeff606694a6c7"
      }
    ]
  }
},
{
  "id": "qmd",
  "label": "QMD · 로컬 자료 검색",
  "category": "research",
  "url": "https://github.com/tobi/qmd",
  "license": "MIT",
  "reviewedVersion": "86d2365d17fc682e491c2c53d1e4a884aee8682a",
  "state": "candidate",
  "reflectedIn": [],
  "note": "부분 연결: QMD 2.8.3 및 Windows x64 의존성 154개·4456파일을 고정 SHA-512/파일 SHA-256으로 검증하고 승인 후 앱 전용 설치. 원본 설치 스크립트는 실행하지 않음. qmd.documents.search는 제공 문서 문자열 1~20개만 별도 승인 후 임시 Markdown/SQLite에 색인해 원본 SDK searchLex(BM25)로 조회하고 제거. 기존 검토된 Node 24.13.1 필요. 기존 폴더·설정·인덱스 접근, 모델 다운로드·임베딩·재정렬·의미 검색 미지원. 원본 압축 무결성과 모의 설치/검색 경로 검증; 실제 원본 실행 및 네이티브 호환성 미검증. OS 전체 격리 보장 아님.",
  "checkedAt": "2026-11-04",
  "ownerRoleIds": [
    "research-assistant",
    "document-writer"
  ],
  "kind": "tool"
},
{
  "id": "im-not-ai",
  "installation": {"type": "reviewed_source_bundle", "name": "humanize-korean", "manifestSha256": "56ed146621a2f8685ed82bcef163c1102b1d75c45dcde1b41e14d8e1c67cb0d7"},
  "label": "Humanize Korean · 한글 윤문",
  "category": "research",
  "url": "https://github.com/epoko77-ai/im-not-ai",
  "license": "MIT",
  "reviewedVersion": "b37e0206d31fffd9149bf57168d4d62eb2086bee",
  "state": "candidate",
  "reflectedIn": [],
  "note": "공용 원본 스킬. 추천: 문서·콘텐츠. 공식 install.sh의 Codex --copy 구성에 맞춰 원본 SKILL.md·참조 18개·공통 런타임 스크립트 9개·에이전트 설정·라이선스를 포함한 31개 파일을 필요할 때 설치. 설치 스크립트를 실행하거나 전역 에이전트를 추가하지 않음. Python과 진단·윤문·finalize 실행 환경 필요; 전체 윤문 작업 실행은 미검증.",
  "checkedAt": "2026-11-04",
  "ownerRoleIds": [
    "document-writer",
    "content-editor"
  ],
  "kind": "skill"
},
{
  "id": "yt-dlp",
  "label": "yt-dlp · 영상 자료 수집",
  "category": "research",
  "url": "https://github.com/yt-dlp/yt-dlp",
  "license": "Unlicense · 일부 배포 바이너리 GPLv3+",
  "reviewedVersion": "412e7f0a4b0588fe884a02b344ac66a06538475b",
  "state": "candidate",
  "reflectedIn": [],
  "note": "공용 원본 도구. media.video.inspect로 공개 YouTube 메타데이터 조회. 공식 해시가 일치하는 기존 설치본 재사용; 없으면 Windows x64 원본 2026.03.17과 라이선스 3개 파일(18,681,589바이트)을 앱 전용 폴더에 별도 승인 후 설치하도록 연결. 설치와 주소 전송·조회 실행 승인을 분리. PATH·관리자 권한·기존 설치본 변경 없음. 승인·다운로드·해시·실패 정리·설치 후 조회 경로는 격리 모의 검사 통과, 실제 새 프로그램 설치는 미실행. 기존 설치본의 공개 메타데이터 조회는 이전 확인. 영상·자막 다운로드, 로그인·쿠키·플러그인·외부 JS 실행 미지원.",
  "checkedAt": "2026-11-04",
  "ownerRoleIds": [
    "content-editor"
  ],
  "kind": "tool"
},
{
  "id": "scrapling",
  "label": "Scrapling",
  "category": "research",
  "url": "https://github.com/D4Vinci/Scrapling",
  "license": "BSD-3-Clause",
  "reviewedVersion": "PyPI 0.5 / manifest 7263c22096ae3542cebc1e5b7d38482a98dc8d165003a177cdfba1d22d83c5e8",
  "state": "candidate",
  "reflectedIn": [],
  "note": "HTML 파싱과 웹 자료 추출 프레임워크. 이미지의 이름·설명에 따른 후보 매칭이며 게시자 원본 링크는 미확인. 이번 조사는 메타데이터 확인만 수행했으며 실제 설치·실행·한국어 품질은 검증하지 않음. 기존 기록: 공용 정적 HTML 분석. scrapling.html.extract에 HTML 문자열과 CSS 선택자를 주면 로컬에서 최대 100개 값을 추출하도록 연결. 검토된 C:\\Python314의 Python 3.14.0 x64 핵심 파일 해시가 일치할 때만 지원. Scrapling 0.5와 의존성 6개 wheel의 314개 파일을 승인 후 앱 전용 폴더에 준비(다운로드 4,783,664바이트). 설치 스크립트·pip·전역 Python 변경 없이 원본 라이선스 보존. HTML 실행 승인 별도. 경로·해시·거절·변조·모의 추출 검사; 실제 원본 패키지 설치·파싱 실행은 미실행. URL 수집·브라우저·로그인·쿠키·사용자 파일 열기 미지원.",
  "checkedAt": "2026-11-05",
  "ownerRoleIds": [
    "research-assistant",
    "b2b-customer-developer"
  ],
  "kind": "tool",
  "requires": {
    "runtime": [
      "Python 및 모드별 HTTP·브라우저 의존성. 앱 연결은 기존 승인형 정적 HTML 파싱 범위 유지; 원본 전체 크롤러 지원 아님"
    ],
    "imageMatch": {
      "status": "candidate_name_match",
      "publisherLinkVerified": false,
      "collection": "claude-tools-image-2026-11-05"
    },
    "sourceReview": {
      "commit": "3a4bb5b0a008233c85269a0a38a6d08edd4ce329",
      "license": "BSD-3-Clause",
      "licensePath": "LICENSE",
      "licenseSha256": "5c782ef0346e4fbfe0dc76fd435f181a0f1e4a1a7a6b13c169c6e74314ff5964",
      "readmeSha256": "10c8b77189722e52a517f234a301e4964bb47992aaa907e3e20a917e951a3382",
      "checkedAt": "2026-11-05",
      "installedVersionUnchanged": true
    }
  },
  "permissions": [
    "기존 앱 입력 HTML 파싱",
    "외부 웹·로그인·쿠키·프록시 접근은 별도 승인과 연결 필요"
  ],
  "cost": {
    "status": "provider_dependent",
    "note": "원본 라이선스는 서비스 무료 보장이 아님. 모델·호스트·선택적 API/프록시 비용은 실행 전 확인; 이번 조사 비용성 호출 없음."
  }
},
{
  "id": "beads",
  "label": "Beads · 작업 추적",
  "category": "research",
  "url": "https://github.com/gastownhall/beads",
  "license": "MIT",
  "reviewedVersion": "v1.3.4 / e66e7b66c0d1ac6a878951462edddb4a177532aff3fc22989daac115feaaef11",
  "state": "candidate",
  "reflectedIn": [],
  "note": "공용 원본. Windows x64 v1.3.4 공식 ZIP 승인형 설치·무결성 검증 및 별도 버전 진단. beads.tasks.analyze는 제공한 1~100개 업무와 선행 관계를 별도 승인 후 앱 전용 임시 DB에 가져와 원본 list --ready로 조회하고 제거함. 고정 명령·빈 환경·명시 BEADS_DIR·후크/에이전트 생성 제외·sandbox 플래그 사용. OS 수준 격리는 아님. 설치·실행 경로는 가짜 프로세스와 임시 폴더로 검증; 실제 원본 실행·DB 호환성은 미검증. 기존 프로젝트·DB 연결, 영구 업무 등록/수정, 원격 동기화 미지원. 기존 프로젝트 연결은 설정·redirect·환경 파일·Dolt 연결·마이그레이션·백업 검토 및 별도 승인이 필요함.",
  "checkedAt": "2026-11-04",
  "ownerRoleIds": [
    "software-engineer",
    "work-manager"
  ],
  "kind": "tool"
},
{
  "id": "agent-desktop",
  "label": "agent-desktop · PC 제어",
  "category": "research",
  "url": "https://github.com/vercel-labs/agent-desktop",
  "license": "Apache-2.0",
  "reviewedVersion": "1.0.2 (기존 정본)",
  "state": "reflected",
  "reflectedIn": [
    "mody-pc-control"
  ],
  "note": "담당: 기본 비서·PC 제어. 기존 mody-pc-control·PC 화면 읽기 및 조작 승인 경로 재사용. 재설치하지 않음.",
  "checkedAt": "2026-11-04",
  "ownerRoleIds": [
    "personal-operator"
  ],
  "kind": "tool"
},
  { id: "superpowers", label: "Superpowers", category: "development", url: "https://github.com/obra/superpowers", license: "MIT · Copyright (c) 2025 Jesse Vincent", reviewedVersion: "v7.0.1 (2ce8aa15d05b)", state: "reflected", reflectedIn: ["mody-dev-crew", "설계 확인 단계"], note: "작업 크기 판정·큰 변경 설계 확인·계획·테스트 먼저·완료 전 재검증을 개발팀 절차와 실행기에 독자 구현. 원본 미설치. 시각 보조 기능은 기본 사용 정보 전송이 있어 쓰지 않음", checkedAt: "2026-11-02" },
  {
  "id": "ponytail",
  "label": "Ponytail",
  "category": "development",
  "url": "https://github.com/DietrichGebert/ponytail",
  "license": "MIT · Copyright (c) 2026 DietrichGebert",
  "reviewedVersion": "v5.3.3 (96608e078b2d)",
  "state": "reflected",
  "reflectedIn": [
    "mody-dev-crew"
  ],
  "note": "기존 코드 재사용과 최소 구현·검증을 지원. 이미지의 이름·설명에 따른 후보 매칭이며 게시자 원본 링크는 미확인. 이번 조사는 메타데이터 확인만 수행했으며 실제 설치·실행·한국어 품질은 검증하지 않음. 기존 기록: 재사용 사다리(필요성→기존 코드→표준·플랫폼→설치된 의존성→최소 코드)와 검증·보안·접근성·데이터 보호를 줄이지 않는 규칙 반영. 원본 미설치",
  "checkedAt": "2026-11-05",
  "kind": "skill",
  "ownerRoleIds": [
    "software-engineer"
  ],
  "requires": {
    "runtime": [
      "호환 에이전트. 선택적 band는 Claude Code 2.1.290+ 등 호스트 조건; 기존 반영 버전 유지"
    ],
    "imageMatch": {
      "status": "candidate_name_match",
      "publisherLinkVerified": false,
      "collection": "claude-tools-image-2026-11-05"
    },
    "sourceReview": {
      "commit": "96608e078b2d5ea607c5c3b8b5a54d1c1fba6846",
      "license": "MIT",
      "licensePath": "LICENSE",
      "licenseSha256": "fb1bc6909ac3ef82d5c22106e32ef682b0cff66788fa915fb9b53b15c9d2f3ab",
      "readmeSha256": "9608191c42ef942138857c44b54037fff7606cfda205d7320f4a3c82a7d8d41e",
      "checkedAt": "2026-11-05",
      "installedVersionUnchanged": true
    }
  },
  "permissions": [
    "프로젝트 읽기·수정",
    "선택적 로컬 세션·비용 기록 읽기"
  ],
  "cost": {
    "status": "provider_dependent",
    "note": "원본 라이선스는 서비스 무료 보장이 아님. 모델·호스트·선택적 API/프록시 비용은 실행 전 확인; 이번 조사 비용성 호출 없음."
  }
},
  {
  "id": "ui-ux-pro-max",
  "label": "UI UX Pro Max",
  "category": "design",
  "url": "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
  "license": "MIT · Copyright (c) 2024 Next Level Builder",
  "reviewedVersion": "3a13158ff1f3",
  "state": "reflected",
  "reflectedIn": [
    "mody-design-crew"
  ],
  "note": "UI/UX 디자인 시스템과 접근성 검토. 이미지의 이름·설명에 따른 후보 매칭이며 게시자 원본 링크는 미확인. 이번 조사는 메타데이터 확인만 수행했으며 실제 설치·실행·한국어 품질은 검증하지 않음. 기존 기록: 기존 디자인 시스템·컴포넌트 우선, 디자인 시스템 표, 접근성 우선 검수 반영. 검색은 Python 3 표준 라이브러리만 쓰고 네트워크 없음. 이 PC 미설치 — 설치돼 있을 때만 동반 스킬로 읽음",
  "checkedAt": "2026-11-05",
  "kind": "skill",
  "ownerRoleIds": [
    "product-designer",
    "software-engineer"
  ],
  "requires": {
    "runtime": [
      "Python 3 검색 스크립트와 호환 스킬 호스트. 기존 연결 기록과 핀 유지"
    ],
    "imageMatch": {
      "status": "candidate_name_match",
      "publisherLinkVerified": false,
      "collection": "claude-tools-image-2026-11-05"
    },
    "sourceReview": {
      "commit": "ccce51cba388476d4f403091ddb91636d5cd9fed",
      "license": "MIT",
      "licensePath": "LICENSE",
      "licenseSha256": "738f69dfa83db5c347c678fb9d90e560877059f0de93a327c39001bff92dc014",
      "readmeSha256": "195e52d5e4fc9e973e86902726f9434c8f58bb1fa4f495de165938c4e3711257",
      "checkedAt": "2026-11-05",
      "installedVersionUnchanged": true
    }
  },
  "permissions": [
    "프로젝트 읽기·수정",
    "설치·갱신은 별도 검토"
  ],
  "cost": {
    "status": "provider_dependent",
    "note": "원본 라이선스는 서비스 무료 보장이 아님. 모델·호스트·선택적 API/프록시 비용은 실행 전 확인; 이번 조사 비용성 호출 없음."
  }
},
  { id: "design-42-guide", label: "디자인 스킬·도구 42가지 가이드", category: "design", url: "https://yeongseon.kr/archive/f3dcb7349a5d4e6b99d86cecbc9c1d14.html", license: "가이드 참고 — 문장 독자 작성", reviewedVersion: "2026-10-31 열람", state: "reflected", reflectedIn: ["mody-design-crew"], note: "10/31 반영. 42개를 검증된 실행 스킬로 표시하지 않음. 이미지 생성은 실제 도구가 연결된 경우에만", checkedAt: "2026-11-02" },
  { id: "claude-skills", label: "claude-skills 선택 스킬 6개", category: "development", url: "https://github.com/alirezarezvani/claude-skills", license: "MIT", reviewedVersion: "설치 0496583603e5 · 최신 e4a1dc369590(v2.14.5)", state: "reflected", reflectedIn: ["mody-dev-crew"], note: "이 PC Codex 스킬로 설치돼 실행 때 동반 스킬로 읽음. 최신과 차이는 SKILL.md 설명 한 줄뿐이라 재설치하지 않음. senior-qa 등에는 로컬 검토 메모가 더해져 원본과 완전히 같지 않음", checkedAt: "2026-11-02" },
  { id: "cloudflare-security-audit", label: "Cloudflare security-audit-skill", category: "security", url: "https://github.com/cloudflare/security-audit-skill", license: "MIT · Copyright (c) 2025-2026 Cloudflare, Inc.", reviewedVersion: "c1c8a8c14710", state: "reflected", reflectedIn: ["mody-security-audit"], note: "흐름과 판정 규칙을 독자 구현. 대상 코드 실행에 필요한 OS 샌드박스 조건을 모두 갖추지 못해 실행하지 않고 needs_validation 으로 남김", checkedAt: "2026-11-02" },
  { id: "vibe-coding-security-guide", label: "바이브 코딩 앱 보안 감사 가이드", category: "security", url: "https://sdk-kim-builds.com/guides/vibe-coding-app-security-audit/", license: "가이드 참고", reviewedVersion: "2026-10-30 게시", state: "reflected", reflectedIn: ["mody-security-audit"], note: "원본 스킬의 OS 샌드박스 요구가 가이드에 빠져 있어 원본 기준을 따름", checkedAt: "2026-11-02" },
  { id: "herdr", label: "Herdr(herdr-app·herdr-core)", category: "development", url: "https://github.com/herdrdev/herdr-core", license: "Apache-2.0(저작권자 칸 미기재) · 제3자 고지 있음", reviewedVersion: "app v0.1.11(f896da489de5) · core v0.1.16(5a9de29b2f9b)", state: "reflected", reflectedIn: ["업무 상태 정본", "내 확인 필요", "앱 종료 시 연결 끊김 기록"], note: "상태 이름·멈춘 이유·확인 필요 모아보기·재연결 때 자동 재실행 안 함을 앱 기능으로 편입. 코드 미복사·엔진 미설치. core 는 샌드박스·권한 장치가 아니어서 API 를 노출하지 않음. OSC 7501 을 보고하는 실행기가 없어 쓰지 않음", checkedAt: "2026-11-02" },
  { id: "llm-council", label: "LLM Council", category: "development", url: "https://github.com/karpathy/llm-council", license: "라이선스 표기 없음", reviewedVersion: "92e1fccb1bdc", state: "reflected", reflectedIn: ["mody-deep-review"], note: "코드 재사용 없이 3단계 흐름만 독자 구현", checkedAt: "2026-11-02" },
  { id: "insta-automation-guide", label: "인스타 콘텐츠 자동화 무료 프롬프트", category: "content", url: "https://every-ai-guides.vercel.app/posts/insta-automation-free-prompts", license: "가이드 참고", reviewedVersion: "2026-10-30 열람", state: "reflected", reflectedIn: ["mody-insta-content"], note: "프롬프트 6개와 실제 영상 생성·예약 게시·DM 실행을 구분. 게시·DM은 연결과 별도 승인 뒤", checkedAt: "2026-11-02" },
  { id: "claude-motion-100", label: "Claude 모션 100 가이드", category: "content", url: "https://every-ai-guides.vercel.app/posts/claude-motion-100", license: "가이드 참고", reviewedVersion: "2026-10-30 열람", state: "reflected", reflectedIn: ["mody-motion-video"], note: "100개를 사무실 캐릭터 동작으로 해석하지 않음. 10/31 독립 시험은 앱 자동 연동·MP4 출력 완료가 아님", checkedAt: "2026-11-02" },
  { id: "hyperframes", label: "HyperFrames", category: "content", url: "https://github.com/heygen-com/hyperframes", license: "Apache-2.0 · Copyright 2026 HeyGen, Inc.", reviewedVersion: "v0.9.0 (f1391156e031)", state: "candidate", reflectedIn: [], note: "MP4 렌더 엔진 후보. Node 22+·Chrome(자동 내려받음)·FFmpeg 필요, 로컬 렌더 무료, CLI 사용 정보 기본 전송(끄기 가능), 클라우드 렌더는 프로젝트 업로드. 0.9.0 의 깨지는 변경은 분산 렌더 전용이라 로컬 렌더 후보에는 영향 없음. 자동 설치하지 않음", checkedAt: "2026-11-02" },
  { id: "detectorscope", label: "DetectorScope", category: "research", url: "https://github.com/google-deepmind/detectorscope", license: "코드 Apache-2.0 · 자료 CC-BY 4.0 · 가중치 Gemma 약관", reviewedVersion: "52ecc8777515 (0.0.1)", state: "on_hold", reflectedIn: [], note: "AI 작성 흔적 연구용 선택 기능 후보. 가중치 약 11.8GB 다운로드와 Gemma 약관 동의 대기. 한국어 성능 미검증, 점수로 저자·진위를 단정하지 않고 개인 판정에 쓰지 않음, 회사 문서를 공개 데모에 올리지 않음", checkedAt: "2026-11-02" },
  {
  "id": "rea",
  "label": "REA",
  "category": "reverse_engineering",
  "url": "https://github.com/morluto/rea",
  "license": "MIT(설치 패키지 선언)",
  "reviewedVersion": "rea-agents 6.8.0 · 스킬 version 49",
  "state": "reflected",
  "reflectedIn": [
    "mody-reverse-engineering"
  ],
  "note": "권한 있는 소프트웨어 구조 분석과 리버스 엔지니어링. 이미지의 이름·설명에 따른 후보 매칭이며 게시자 원본 링크는 미확인. 이번 조사는 메타데이터 확인만 수행했으며 실제 설치·실행·한국어 품질은 검증하지 않음. 기존 기록: 이 PC 설치본 재사용(재설치 안 함). MCP 도구 229개 응답 확인. 출처는 설치 패키지 README 가 밝힌 공식 출처·npm 정보·GitHub 릴리스 rea-agents-6.8.0 이 같은 곳(morluto/rea)이라 연결. REA 가 Ghidra 12.1.x 만 지원해 12.1.4 유지(12.2 보안 수정 미적용 — 스킬 주의 절 참고)",
  "checkedAt": "2026-11-05",
  "kind": "tool",
  "ownerRoleIds": [
    "software-engineer"
  ],
  "requires": {
    "runtime": [
      "현재 원본과 기존 설치 버전은 별개. Node/npm; 대상별 Ghidra/Hopper/IDA·브라우저 등 선택. 기존 PC 설치와 MCP 기록 유지"
    ],
    "imageMatch": {
      "status": "candidate_name_match",
      "publisherLinkVerified": false,
      "collection": "claude-tools-image-2026-11-05"
    },
    "sourceReview": {
      "commit": "71f680d7c1aa7a45ba0325fe87b104744b0c105f",
      "license": "MIT",
      "licensePath": "LICENSE",
      "licenseSha256": "798f9e4d18e49b30bf2f12696c8ced73dc4e1413da375a333d01281543a1ea8b",
      "readmeSha256": "cb5b40c5752a403fbe20be9af2c08b5ca915c033af142f6f57af227cbaa2b6ba",
      "checkedAt": "2026-11-05",
      "installedVersionUnchanged": true
    }
  },
  "permissions": [
    "허가된 파일·프로젝트 읽기",
    "대상별 분석기 실행 및 출력 기록",
    "외부 모델 전송은 별도 승인"
  ],
  "cost": {
    "status": "provider_dependent",
    "note": "원본 라이선스는 서비스 무료 보장이 아님. 모델·호스트·선택적 API/프록시 비용은 실행 전 확인; 이번 조사 비용성 호출 없음."
  }
},
  { id: "pickle-mobile-assistant", label: "피클 모바일 비서 소개", category: "documents", url: "https://www.instagram.com/p/DfCCtQqmk2m/?img_index=6", license: "게시물 참고", reviewedVersion: "2026-10-30 열람", state: "candidate", reflectedIn: [], note: "모바일 요청·진행 확인·승인·결과 열람, 메일·일정·문서 선제 제안, 앱별 접근 범위·연결 해제 흐름을 참고로 보존. 보안·전화 대행·예약·주문은 검증된 기능으로 옮기지 않음", checkedAt: "2026-11-02" },
  { id: "pickle-sns-flow", label: "피클 SNS 콘텐츠 흐름", category: "content", url: "https://www.instagram.com/p/DfBdYNkkUGI/?img_index=10", license: "게시물 참고", reviewedVersion: "2026-10-30 열람", state: "reflected", reflectedIn: ["mody-insta-content"], note: "SNS 조사·후킹 비교·캐러셀/릴스·댓글/DM 흐름을 콘텐츠 크루 참고로 보존. 댓글·DM은 초안까지", checkedAt: "2026-11-02" },
  { id: "tool-card-openglean", label: "OpenGlean(도구 소개 카드)", category: "research", license: "확인 불가", reviewedVersion: "원본 이미지 대조 전", state: "unverified", reflectedIn: [], note: "검색·기억·문서·콘텐츠·음성·개발·운영 분야 후보로 보존. 카드 제목과 화면명이 다른 사례가 있어 원본 이미지와 대조하기 전에는 저장소를 연결하거나 설치하지 않음", checkedAt: "2026-11-02" },
  { id: "tool-card-hindsight", label: "Hindsight(도구 소개 카드)", category: "research", license: "확인 불가", reviewedVersion: "원본 이미지 대조 전", state: "unverified", reflectedIn: [], note: "검색·기억·문서·콘텐츠·음성·개발·운영 분야 후보로 보존. 카드 제목과 화면명이 다른 사례가 있어 원본 이미지와 대조하기 전에는 저장소를 연결하거나 설치하지 않음", checkedAt: "2026-11-02" },
  { id: "tool-card-foreman", label: "Foreman(도구 소개 카드)", category: "research", license: "확인 불가", reviewedVersion: "원본 이미지 대조 전", state: "unverified", reflectedIn: [], note: "검색·기억·문서·콘텐츠·음성·개발·운영 분야 후보로 보존. 카드 제목과 화면명이 다른 사례가 있어 원본 이미지와 대조하기 전에는 저장소를 연결하거나 설치하지 않음", checkedAt: "2026-11-02" },
  { id: "tool-card-openrig", label: "OpenRig(도구 소개 카드)", category: "research", license: "확인 불가", reviewedVersion: "원본 이미지 대조 전", state: "unverified", reflectedIn: [], note: "검색·기억·문서·콘텐츠·음성·개발·운영 분야 후보로 보존. 카드 제목과 화면명이 다른 사례가 있어 원본 이미지와 대조하기 전에는 저장소를 연결하거나 설치하지 않음", checkedAt: "2026-11-02" },
  { id: "tool-card-repolyze", label: "Repolyze(도구 소개 카드)", category: "research", license: "확인 불가", reviewedVersion: "원본 이미지 대조 전", state: "unverified", reflectedIn: [], note: "검색·기억·문서·콘텐츠·음성·개발·운영 분야 후보로 보존. 카드 제목과 화면명이 다른 사례가 있어 원본 이미지와 대조하기 전에는 저장소를 연결하거나 설치하지 않음", checkedAt: "2026-11-02" },
  { id: "tool-card-openjev", label: "OpenJev(도구 소개 카드)", category: "research", license: "확인 불가", reviewedVersion: "원본 이미지 대조 전", state: "unverified", reflectedIn: [], note: "검색·기억·문서·콘텐츠·음성·개발·운영 분야 후보로 보존. 카드 제목과 화면명이 다른 사례가 있어 원본 이미지와 대조하기 전에는 저장소를 연결하거나 설치하지 않음", checkedAt: "2026-11-02" },
  { id: "tool-card-voicestudio", label: "VoiceStudio(도구 소개 카드)", category: "research", license: "확인 불가", reviewedVersion: "원본 이미지 대조 전", state: "unverified", reflectedIn: [], note: "검색·기억·문서·콘텐츠·음성·개발·운영 분야 후보로 보존. 카드 제목과 화면명이 다른 사례가 있어 원본 이미지와 대조하기 전에는 저장소를 연결하거나 설치하지 않음", checkedAt: "2026-11-02" },
  { id: "tool-card-mineru", label: "MinerU(도구 소개 카드)", category: "research", license: "확인 불가", reviewedVersion: "원본 이미지 대조 전", state: "unverified", reflectedIn: [], note: "검색·기억·문서·콘텐츠·음성·개발·운영 분야 후보로 보존. 카드 제목과 화면명이 다른 사례가 있어 원본 이미지와 대조하기 전에는 저장소를 연결하거나 설치하지 않음", checkedAt: "2026-11-02" },
  { id: "instagram-dfhtqklfbsc", label: "인스타 게시물 DfHTQklFBSC(5번째 이미지)", category: "research", url: "https://www.instagram.com/p/DfHTQklFBSC/?img_index=5", license: "확인 불가", reviewedVersion: "본문·이미지 미확인", state: "unverified", reflectedIn: [], note: "본문과 5번째 이미지를 확인하지 못해 보류", checkedAt: "2026-11-02" },
  { id: "craft-series", label: "“CRAFT” 시리즈", category: "content", license: "확인 불가", reviewedVersion: "이 PC: FilmCraft 0.16.0·PhotoCraft 0.19.0·PdfCraft 0.17.0", state: "unverified", reflectedIn: [], note: "이 PC에 ArtCraft FilmCraft(영상 편집)·PhotoCraft(이미지 편집)·PdfCraft가 설치돼 Codex MCP에 등록돼 있음. 사용자가 말한 CRAFT 시리즈인지 확인 필요. 모디크루 통합 없음", checkedAt: "2026-11-02" },
  {
  "id": "halmarker",
  "label": "Hallmark (기존 halmarker 후보)",
  "category": "design",
  "license": "MIT",
  "reviewedVersion": "이름 미확인",
  "state": "unverified",
  "reflectedIn": [],
  "note": "테마 기반 웹 디자인과 정적·브라우저 품질 검사. 이미지의 이름·설명에 따른 후보 매칭이며 게시자 원본 링크는 미확인. 이번 조사는 메타데이터 확인만 수행했으며 실제 설치·실행·한국어 품질은 검증하지 않음. 기존 기록: 이 PC에 설치된 hallmark 디자인 스킬(디자인팀 동반 스킬로 이미 연결)일 가능성. 이름 확인 필요",
  "checkedAt": "2026-11-05",
  "url": "https://github.com/Nutlope/hallmark",
  "kind": "skill",
  "ownerRoleIds": [
    "product-designer",
    "software-engineer"
  ],
  "requires": {
    "runtime": [
      "Node 18+; 렌더 검사는 puppeteer-core와 Chrome 추가 필요. 기존 로컬 hallmark와 이 저장소의 동일성은 미확인"
    ],
    "imageMatch": {
      "status": "candidate_name_match",
      "publisherLinkVerified": false,
      "collection": "claude-tools-image-2026-11-05"
    },
    "sourceReview": {
      "commit": "de4999e0cd7a7a41df0b4e6903fa02fe9f1492a8",
      "license": "MIT",
      "licensePath": "LICENSE",
      "licenseSha256": "06088a8b94598626f27612dea42300154bf7be967c85d9d3eee4490cb056af7d",
      "readmeSha256": "d21933f906e8b9a2db0d32982b1523a679a89e97dc77a635e124c9a98ac3d8c5",
      "checkedAt": "2026-11-05",
      "installedVersionUnchanged": true
    }
  },
  "permissions": [
    "프로젝트 파일 읽기·수정",
    "선택적 훅 등록·브라우저 실행"
  ],
  "cost": {
    "status": "provider_dependent",
    "note": "원본 라이선스는 서비스 무료 보장이 아님. 모델·호스트·선택적 API/프록시 비용은 실행 전 확인; 이번 조사 비용성 호출 없음."
  }
},
  { id: "field-needs", label: "모델링·한국 업무·카톡 설정·영상 편집", category: "research", license: "해당 없음", reviewedVersion: "필요 분야", state: "unverified", reflectedIn: [], note: "특정 제품 설치 완료가 아닌 필요 분야. 카카오톡 업무 맥락 연결은 별도 개발 작업으로 진행 중", checkedAt: "2026-11-02" },
  { id: "api-credits", label: "인증·API 크레딧 분리", category: "development", url: "https://developers.openai.com/api/docs/guides/chatgpt-api-credits", license: "공식 안내 참고", reviewedVersion: "2026-11-02 열람", state: "reflected", reflectedIn: ["실행 확인 창", "환경변수 허용 목록"], note: "구독 로그인과 API 크레딧을 분리. 확인 창에 구독 사용량·크레딧 차감 가능성 고지, 실행 프로세스에 API 키 환경변수를 넘기지 않음. 키·토큰 추출이나 인증 우회 없음", checkedAt: "2026-11-02" },
].map((entry) => Object.freeze({ ...entry, reflectedIn: Object.freeze([...entry.reflectedIn]) })) as CrewExtensionReference[]);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export const crewSkillCatalog: readonly CrewSkillDefinition[] = deepFreeze(catalog);
const byName = new Map<string, CrewSkillDefinition>(crewSkillCatalog.map((skill) => [skill.name, skill]));

/** 템플릿 팀으로 만든 직원(예: 위임 중 자동 생성된 '마케팅 담당')이 꺼내 쓰는 직무 묶음. */
export const crewSkillRoleIdsByTemplate: Readonly<Record<string, readonly string[]>> = deepFreeze({
  finance: ["securities-researcher", "finance-analyst"],
  marketing: ["content-editor", "growth-strategist", "b2c-customer-growth"],
  development: ["software-engineer", "product-planner", "product-designer"],
  operations: ["work-manager", "people-operations", "document-writer", "b2b-customer-developer"],
  personal: [personalOperatorCrewRoleId],
});

export const crewSkillCategoryLabels: Readonly<Record<CrewSkillCategory, string>> = deepFreeze({
  development: "개발",
  design: "디자인",
  security: "보안 검토",
  documents: "문서·한국 업무",
  content: "콘텐츠·영상",
  reverse_engineering: "리버스 엔지니어링",
  research: "선택형 연구 도구",
});

export const crewSkillLifecycleLabels: Readonly<Record<CrewSkillLifecycle, string>> = deepFreeze({
  reference: "참고자료",
  in_progress: "구현 중",
  installable: "설치 가능",
  needs_connection: "연결 필요",
  verified: "검증 완료",
  error: "오류",
});

export const crewSkillPermissionLabels: Readonly<Record<CrewSkillPermission, string>> = deepFreeze({
  read_target: "사용자가 고른 폴더 읽기",
  write_output: "모디크루 결과 폴더에 파일 만들기",
  write_target: "사용자가 허락한 폴더 수정",
  run_scripts: "확인 창에서 허락한 경우 테스트·스크립트 명령 실행",
  multi_runtime: "로그인된 여러 AI 실행기 호출",
  "mcp:rea": "이 PC의 REA 분석 도구(MCP) 사용",
  desktop_control: "이 PC의 앱 창 화면 요소 읽기(허용한 창만 대화 AI에 전달) · 승인한 단계만 조작(agent-desktop)",
});

export function getCrewSkill(name: string | null | undefined): CrewSkillDefinition | undefined {
  return typeof name === "string" ? byName.get(name.trim()) : undefined;
}

/** 이 직무가 꺼내 쓰는 크루 스킬. 기본 비서는 요청을 나누는 총괄이라 모든 크루 스킬을 본다. */
export function crewSkillsForRole(roleId: string | null | undefined): readonly CrewSkillDefinition[] {
  const id = typeof roleId === "string" ? roleId.trim() : "";
  if (!id) return [];
  if (id === personalOperatorCrewRoleId) return crewSkillCatalog;
  return crewSkillCatalog.filter((skill) => skill.ownerRoleIds.includes(id));
}

const expertNames = new Map<string, string>(builtinExperts.map((expert) => [expert.id, expert.name + " " + expert.roleTitle]));

/** 화면·프롬프트용 담당 크루 이름. 채용 목록에 없는 직무 id 는 건너뛴다. */
export function describeCrewSkillOwners(skill: CrewSkillDefinition): string {
  return skill.ownerRoleIds.map((id) => expertNames.get(id)).filter(Boolean).join(", ");
}

export function describeCrewSkillExecution(execution: CrewSkillExecution): string {
  if (execution === "agent") return "실제 실행형 · Codex·Claude 작업 폴더";
  if (execution === "council") return "교차 검토형 · 여러 실행기";
  if (execution === "app_tool") return "앱 도구형 · 승인 뒤 이 PC에서 실행";
  return "지침형 · 이 대화에서 바로 적용";
}

/** 늘어난 권한(업데이트 때 다시 승인받을 목록). */
export function expandedCrewSkillPermissions(previous: readonly string[] | null | undefined, next: readonly string[]): string[] {
  const before = new Set(previous ?? []);
  return next.filter((permission) => !before.has(permission));
}

/**
 * 확장 센터 상태. 정적 정본에 실제 점검 결과(무결성·설치·로그인·MCP 연결)를 더해 정한다.
 * 실제 실행 검증(real_run)이 없는 스킬은 사용할 수 있어도 '검증 완료'가 아니라 '구현 중'으로 둔다.
 */
export function crewSkillLifecycle(
  skill: CrewSkillDefinition,
  state: { integrityOk?: boolean; installed?: boolean; readyRuntimes?: number; mcpReady?: Readonly<Record<string, boolean>>; cliReady?: Readonly<Record<string, boolean>> } = {},
): CrewSkillLifecycle {
  if (state.integrityOk === false) return "error";
  if (skill.availability === "optional" && !state.installed) return "installable";
  if ((state.readyRuntimes ?? 0) < skill.requires.minRuntimes) return "needs_connection";
  if ((skill.requires.mcpServers ?? []).some((id) => state.mcpReady?.[id] !== true)) return "needs_connection";
  if ((skill.requires.cli ?? []).some((id) => state.cliReady?.[id] !== true)) return "needs_connection";
  return skill.verification.level === "real_run" ? "verified" : "in_progress";
}

function compactText(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, "");
}

function scoreSkill(skill: CrewSkillDefinition, compactRequest: string): number {
  let score = 0;
  const seen = new Set<string>();
  for (const trigger of skill.triggers) {
    const key = compactText(trigger);
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    if (compactRequest.includes(key)) score += key.length >= 3 ? 3 : 2;
  }
  return score;
}

function rankSkills(skills: readonly CrewSkillDefinition[], requestText: string, ownerRoleId: string): CrewSkillMatch[] {
  const compactRequest = compactText(String(requestText ?? ""));
  if (!compactRequest) return [];
  return skills
    .map((skill, index) => ({ skill, index, score: scoreSkill(skill, compactRequest) }))
    .filter((entry) => entry.score > 0)
    // 점수가 같으면 기본 탑재 스킬이 먼저다(설치된 기능부터 쓰고, 부족할 때만 확장을 제안한다).
    .sort((a, b) => b.score - a.score || Number(a.skill.availability === "optional") - Number(b.skill.availability === "optional") || a.index - b.index)
    .map(({ skill, score }) => ({ skill, score, ownerRoleId }));
}

/** 요청과 맞는 이 직무의 크루 스킬(점수 순). 맞는 것이 없거나 요청이 비면 빈 목록. */
export function selectCrewSkills(roleId: string | null | undefined, requestText: string | null | undefined, limit = 2): CrewSkillMatch[] {
  const max = Math.max(1, Math.min(3, Math.floor(Number(limit) || 2)));
  const id = typeof roleId === "string" ? roleId.trim() : "";
  return rankSkills(crewSkillsForRole(id), String(requestText ?? ""), id).slice(0, max);
}

/**
 * 직원 → 크루 스킬 선택. 자기 직무 스킬을 먼저 보고, 맞는 것이 없으면 같은 팀(템플릿) 직무의 스킬로 넓힌다.
 * 위임은 팀 단위로 첫 직원에게 가기 때문에(예: 마케팅 팀 → 리서치 전문가), 팀 안의 다른 직무 스킬이
 * 요청에 맞으면 그 스킬을 꺼내 쓰게 한다. 담당 크루 이름은 프롬프트에 그대로 남는다.
 */
export function selectCrewSkillsForTeammate(
  teammate: { roleId?: string | null; templateId?: string | null } | null | undefined,
  requestText: string | null | undefined,
  limit = 2,
): CrewSkillMatch[] {
  const roleId = typeof teammate?.roleId === "string" ? teammate.roleId : "";
  const own = selectCrewSkills(roleId, requestText, limit);
  if (own.length) return own;
  const templateId = typeof teammate?.templateId === "string" ? teammate.templateId : "";
  const teamRoles = crewSkillRoleIdsByTemplate[templateId] ?? [];
  const seen = new Set<string>();
  const pooled: CrewSkillDefinition[] = [];
  for (const id of teamRoles) for (const skill of crewSkillsForRole(id)) if (!seen.has(skill.name)) { seen.add(skill.name); pooled.push(skill); }
  const max = Math.max(1, Math.min(3, Math.floor(Number(limit) || 2)));
  return rankSkills(pooled, String(requestText ?? ""), templateId ? "template:" + templateId : "").slice(0, max);
}

const executionGuide: Readonly<Record<CrewSkillExecution, string>> = deepFreeze({
  instructions: "이 대화에서 위 절차대로 바로 결과를 작성합니다.",
  agent: "파일 생성·코드 수정·실행 확인이 필요한 단계는 도구 목록에 crew.skill.run 이 있으면 그 도구로 실제 Codex·Claude 실행기에 맡기고(사용자 확인 창이 뜹니다), 없으면 결과에 '실행 필요'로 표시합니다. 실행하지 않은 일을 했다고 쓰지 않습니다.",
  council: "도구 목록에 crew.skill.run 이 있으면 여러 실행기 교차 검토로 실제 실행하고, 없으면 기획·개발·검증 세 관점을 나눠 쓰되 첫 줄에 '단일 AI 관점 분리 검토(교차 검증 아님)'라고 밝힙니다.",
  app_tool: "도구 목록에 pc.inspect·pc.request 가 있으면 화면 요소를 먼저 읽고 승인 요청으로 진행합니다(사용자가 실행 확인 창이나 승인함에서 승인해야 실행됩니다). 도구가 없거나 'PC 앱 조작' 확장이 추가되지 않았으면 '플러그인 > 크루 스킬 확장'에서 추가하도록 안내하고, 실행했다고 쓰지 않습니다.",
});

const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];

/** 고른 크루 스킬 → 모델 프롬프트 블록. 맞는 스킬이 없으면 "" — 프롬프트를 늘리지 않는다. */
export function formatCrewSkillMatchesForPrompt(matches: readonly CrewSkillMatch[]): string {
  if (!matches.length) return "";
  const [first, ...rest] = matches;
  if (!first) return "";
  const skill = first.skill;
  const owners = describeCrewSkillOwners(skill);
  const lines = [
    "[크루 스킬 · 자동 선택]",
    "요청에 맞춰 모디크루가 고른 크루 스킬입니다. 아래 절차와 결과 구성을 따르고, 받은 자료에 없는 내용은 '확인 필요'로 표시하세요.",
    "■ " + skill.label + " (" + skill.name + ")" + (owners ? " · 담당 크루: " + owners : "") + " · " + describeCrewSkillExecution(skill.execution),
    "- 절차: " + skill.steps.map((step, index) => (circled[index] ?? "·") + " " + step).join(" "),
    "- 결과 구성: " + skill.outputFormat.join(" → "),
    "- 지킬 기준: " + skill.guardrails.join(" "),
    "- 실행 방식: " + executionGuide[skill.execution],
  ];
  if (skill.availability === "optional") lines.push("- 선택형 확장입니다. 아직 추가하지 않았다면 실행 결과가 '설치 필요'로 돌아오니, 사용자에게 확장 화면에서 추가할지 묻고 추가 전에는 실행했다고 쓰지 마세요.");
  if (skill.companionSkills.length) lines.push("- 함께 쓰는 설치 스킬(실제 실행 때 이 PC에 있으면 원문 지침을 읽음): " + skill.companionSkills.join(", "));
  if (rest.length) lines.push("- 함께 맞는 스킬: " + rest.map((match) => match.skill.label + "(" + match.skill.name + ")").join(", ") + " — 필요한 부분만 이어서 적용");
  return lines.join("\n");
}

export function formatCrewSkillsForPrompt(roleId: string | null | undefined, requestText: string | null | undefined): string {
  return formatCrewSkillMatchesForPrompt(selectCrewSkills(roleId, requestText, 2));
}
