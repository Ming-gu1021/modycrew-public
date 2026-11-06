/**
 * 역할별 AI 직원 정본 — 직무마다 실제로 여는 도구, 일상 도구 분류, 필요한 연결, 항상 승인받는 일,
 * 할 수 있는 일과 한계, 첫 업무, 업무 레시피를 한곳에 둔다.
 *
 * - 채용 화면·직원 설정 드로어·채팅 실행(page.tsx·agent-tools)이 같은 정본을 본다.
 * - toolIds 는 공용 도구 외에 이 역할이 "추가로" 여는 도구만 적는다. 지금 있는 도구 id 만 쓴다.
 * - canDo 는 실제 도구·레시피로 할 수 있는 일만 적고, 못 하는 일은 cannotDo 에 정직하게 남긴다.
 * - 업무 레시피는 Fabric(danielmiessler/fabric, MIT) 패턴을 참고해 한국어 업무 형식으로 새로 쓴 것이다.
 *   원문 문장을 옮기지 않았고, 영어 단어 수 기준은 한국어 글자·문장 수 기준으로 바꿨다.
 *   참고한 패턴 이름은 각 레시피의 sourcePattern 에 남긴다.
 * - 계약·세무 레시피는 법률·세무 자문이 아니며 최종 판단은 전문가가 한다는 문구를 포함한다.
 */
import { getBuiltinExpert, resolveBuiltinExpertId } from "./builtin-experts.js";
import { formatCrewSkillsForPrompt } from "./crew-skills.js";
import { resolveModyTeammateWorkPackIds } from "./work-pack.js";

export type ModyDailySkillCategoryId = "weather"|"transport"|"travel"|"shopping"|"food"|"finance"|"public"|"realestate"|"legal"|"health"|"life"|"culture"|"news";
export type ModyRoleRecipe = { id: string; label: string; whenToUse: string; keywords: readonly string[]; inputHint: string; outputFormat: readonly string[]; promptTemplate: string; sourcePattern?: string };
export type ModyRoleFirstTask = { label: string; prompt: string; requiresConnection?: "mail" | "calendar" | "drive"; fallbackPrompt?: string };
export type ModyRoleCapability = {
  roleId: string; label: string;
  dailySkillCategories: readonly ModyDailySkillCategoryId[] | "all";
  toolIds: readonly string[];
  connections: readonly { id: "mail" | "calendar" | "drive" | "ai"; label: string; neededFor: "first_task" | "optional" }[];
  approvalRequired: readonly string[];
  canDo: readonly string[];
  cannotDo: readonly string[];
  firstTasks: readonly ModyRoleFirstTask[];
  recipes: readonly ModyRoleRecipe[];
};
export type ModyRoleConnection = ModyRoleCapability["connections"][number];
export type ModyRoleConnectionId = ModyRoleConnection["id"];
export type ModyRoleConnectionStatus = "connected" | "missing" | "unknown";
export type ModyRoleConnectionState = Partial<Record<ModyRoleConnectionId, ModyRoleConnectionStatus>>;
export type ModyResolvedRoleFirstTask = {
  label: string;
  prompt: string;
  /** 필요한 연결이 없어 붙여 넣은 자료로 시작하는 대체 요청을 골랐는지. */
  usedFallback: boolean;
  requiresConnection?: "mail" | "calendar" | "drive";
};

export const modyDailySkillCategoryIds: readonly ModyDailySkillCategoryId[] = Object.freeze([
  "weather", "transport", "travel", "shopping", "food", "finance", "public",
  "realestate", "legal", "health", "life", "culture", "news",
] as const);

export const modyDailySkillCategoryLabels: Readonly<Record<ModyDailySkillCategoryId, string>> = Object.freeze({
  weather: "날씨", transport: "교통", travel: "여행", shopping: "쇼핑", food: "음식",
  finance: "금융·경제", public: "공공", realestate: "부동산", legal: "법률", health: "건강",
  life: "생활", culture: "문화", news: "뉴스",
});

/** 역할 정본이 열 수 있는 도구 전체. 여기 없는 id 를 지어내지 않는다(테스트가 지킨다). */
export const modyRoleToolIds: readonly string[] = Object.freeze(["mail.intake", "mail.search", "mail.read", "mail.draft", "daily.lookup"]);

const toolLabels: Readonly<Record<string, string>> = Object.freeze({
  "mail.intake": "메일 업무 모으기",
  "mail.search": "메일 검색",
  "mail.read": "메일 열람",
  "mail.draft": "답장 초안",
});

export const personalOperatorRoleId = "personal-operator";
export const customRoleId = "custom";

const allMailTools = ["mail.intake", "mail.search", "mail.read", "mail.draft"] as const;
const readDraftMailTools = ["mail.search", "mail.read", "mail.draft"] as const;
/** agent-tools 의 메일 도구 게이팅과 같은 업무 종류. 직접 만든 직원의 메일 권한을 그대로 따른다. */
const mailWorkPackIds = new Set<string>(["inquiry_response", "schedule_coordination"]);

const contractDisclaimer = "법률 자문이 아니며 최종 판단은 변호사 등 전문가가 합니다.";
const taxDisclaimer = "세무 자문이 아니며 공제 여부 등 최종 판단은 세무사 등 전문가가 합니다.";

const aiConnection: ModyRoleConnection = { id: "ai", label: "AI 답변 연결", neededFor: "first_task" };

// ── 업무 레시피 ──────────────────────────────────────────────────────────────
const recipes = {
  prd: {
    id: "prd",
    label: "요구사항 정의서",
    whenToUse: "기능 아이디어나 고객 요청을 개발팀이 검토할 요구사항 문서로 바꿀 때",
    keywords: ["요구사항", "기획서", "prd", "기능 정의", "기능 명세", "스펙", "개발 요청서"],
    inputHint: "제품 아이디어, 대상 사용자, 지금 쓰는 대안, 일정·개발 제약",
    outputFormat: ["개요", "목표와 성공 지표", "대상 사용자", "핵심 기능(첫 출시 표시)", "사용자 시나리오", "기능 요구사항", "비기능 요구사항", "일정", "확인 필요"],
    promptTemplate: "누가 어떤 상황에서 무엇을 불편해하는지 한 문단으로 먼저 쓰고, 목표와 성공 지표를 숫자로 확인할 수 있게 적습니다. 기능은 첫 출시에 꼭 필요한 것과 나중에 할 것을 나눠 표시합니다. 요구사항은 한 줄에 하나씩, 테스트로 확인할 수 있는 문장으로 씁니다. 자료에 없는 수치나 일정은 '가정' 또는 '확인 필요'로 표시합니다.",
    sourcePattern: "create_prd",
  },
  recursiveOutline: {
    id: "recursive-outline",
    label: "큰 일을 작은 단계로 쪼개기",
    whenToUse: "프로젝트·문서·행사처럼 큰 일을 바로 실행할 수 있는 작은 단계로 나눌 때",
    keywords: ["쪼개", "나눠서", "분해", "세부 단계", "단계별", "목차", "개요 잡", "작업 목록", "실행 계획"],
    inputHint: "해야 할 일이나 만들 결과물, 목적, 마감",
    outputFormat: ["목적", "큰 단계", "세부 작업(더 쪼갤 필요 없는 수준까지)", "선행 조건", "확인 필요"],
    promptTemplate: "이 일의 목적을 한 문장으로 적고 큰 단계 3~7개로 나눕니다. 각 단계는 다시 하위 작업으로 나누되, 한 사람이 하루 안에 끝내거나 바로 착수할 수 있는 크기가 될 때까지만 쪼갭니다. 문서라면 목차와 단락 요지를, 서비스라면 화면·데이터·운영 단위로 나눕니다. 맨 아래 작업에는 담당과 완료 확인 방법을 붙이고, 정해지지 않은 담당은 '배정 필요'로 남깁니다.",
    sourcePattern: "create_recursive_outline",
  },
  effortEstimate: {
    id: "effort-estimate",
    label: "작업량·일정 산정서",
    whenToUse: "새 업무나 개발 요청에 사람·기간·비용이 얼마나 드는지 미리 따져 볼 때",
    keywords: ["공수", "작업량", "얼마나 걸", "기간 산정", "일정 산정", "인력 산정", "투입 인력", "리소스"],
    inputHint: "할 일 설명, 범위, 참여할 수 있는 인력, 마감·예산 제약",
    outputFormat: ["작업 개요", "업무 효과", "범위와 산출물(제외 범위 포함)", "필요 인력", "작업별 예상 기간 표", "의존 관계", "위험과 대응", "가정과 제약", "남은 질문"],
    promptTemplate: "요청한 일을 설계·준비·실행·검수 같은 단위로 나누고 작업마다 예상 기간을 표로 적습니다. 크기는 작음·보통·큼·매우 큼으로 함께 표시하고, 합계에는 예상 밖 지연에 대비한 여유 기간을 따로 더합니다. 범위에 들어가는 일과 빠지는 일, 완료로 인정할 기준을 먼저 적습니다. 산정 근거가 된 가정과 외부 의존(다른 팀, 거래처, 승인)을 나눠 적고, 확인되지 않은 수치는 추정이라고 밝힙니다.",
    sourcePattern: "create_loe_document",
  },
  presentationFlow: {
    id: "presentation-flow",
    label: "발표 흐름과 슬라이드 구성",
    whenToUse: "보고·제안·강의 발표를 슬라이드 순서와 말할 내용으로 짤 때",
    keywords: ["발표", "슬라이드", "ppt", "피피티", "키노트", "프레젠테이션"],
    inputHint: "발표 목적, 청중, 발표 시간, 핵심 자료",
    outputFormat: ["이야기 흐름", "청중이 가져갈 한 문장", "슬라이드별 제목·핵심 문장·이미지 아이디어·발표 대본"],
    promptTemplate: "전체 이야기 흐름을 먼저 정하고, 청중이 발표 뒤에 기억할 한 문장을 마지막 슬라이드의 결론으로 둡니다. 슬라이드는 10~20장 안에서 한 장에 메시지 하나만 담습니다. 각 장에는 제목, 짧은 핵심 문장 3~5개(한 줄 25자 안팎), 넣을 이미지나 도표 아이디어, 발표자가 실제로 말할 대본을 적습니다. 대본은 말하듯 짧은 문장으로 쓰고 숫자는 자료에 있는 것만 씁니다.",
    sourcePattern: "create_keynote",
  },
  feedbackPriority: {
    id: "feedback-priority",
    label: "고객 의견 묶어서 우선순위 정하기",
    whenToUse: "후기·문의·설문 응답을 비슷한 의견끼리 묶고 무엇부터 고칠지 정할 때",
    keywords: ["피드백", "후기", "리뷰", "고객 의견", "설문", "불만", "voc", "건의"],
    inputHint: "고객 의견 원문 모음(후기, 문의, 설문 응답)",
    outputFormat: ["점수 매기는 기준", "우선순위 표(순위·묶은 의견 요약·유용도 1~10·핵심 주제)", "바로 할 일"],
    promptTemplate: "의견을 하나씩 읽고 같은 문제를 말하는 것끼리 묶습니다. 묶음마다 대표 요약을 쓰고, 몇 건이 나왔는지, 사용 경험에 주는 영향, 사업 목표와의 관련성, 고치기 쉬운 정도를 근거로 1~10점 유용도를 매깁니다. 표 위에 점수 기준을 두세 문장으로 설명하고 순위가 높은 순서로 정렬합니다. 원문에 없는 의견을 만들지 않고, 건수가 적은 의견은 '소수 의견'으로 표시합니다.",
    sourcePattern: "analyze_product_feedback",
  },
  summaryStandard: {
    id: "summary-standard",
    label: "핵심 요약",
    whenToUse: "긴 자료·기사·보고서의 핵심을 빠르게 파악할 때",
    keywords: ["요약", "핵심만", "간추려", "줄여서", "요점"],
    inputHint: "요약할 글이나 파일",
    outputFormat: ["한 문장 요약(60자 안팎)", "중요한 내용 10가지(항목당 40자 이내)", "바로 쓸 시사점 5가지"],
    promptTemplate: "자료 전체를 읽고 60자 안팎의 한 문장으로 요지를 씁니다. 이어서 중요한 내용 10가지를 번호를 붙여 항목마다 40자 이내로 적고, 업무에 바로 쓸 수 있는 시사점 5가지를 덧붙입니다. 같은 내용을 되풀이하지 않고 항목 첫머리를 같은 말로 시작하지 않습니다. 자료에 없는 해석은 넣지 않습니다.",
    sourcePattern: "summarize",
  },
  summaryMicro: {
    id: "summary-micro",
    label: "세 줄 요약",
    whenToUse: "메일·메신저로 바로 전할 아주 짧은 요약이 필요할 때",
    keywords: ["세 줄", "3줄", "짧게 요약", "한 줄 요약", "간단히 요약", "한눈에"],
    inputHint: "요약할 글, 메일, 대화",
    outputFormat: ["한 문장 요약(60자 안팎)", "핵심 3가지(항목당 30자 이내)", "할 일·시사점 3가지(항목당 30자 이내)"],
    promptTemplate: "한 문장 요약을 60자 안팎으로 쓰고, 핵심 3가지와 할 일 또는 시사점 3가지를 글머리표로 적습니다. 항목은 각각 30자 이내로 줄이고 같은 내용을 되풀이하지 않습니다. 날짜·금액·이름은 원문 그대로 옮깁니다.",
    sourcePattern: "summarize_micro",
  },
  meetingSummary: {
    id: "meeting-summary",
    label: "회의 내용 정리",
    whenToUse: "회의 녹취나 메모에서 결정·할 일·일정을 빠짐없이 뽑을 때",
    keywords: ["회의", "미팅", "녹취", "통화 내용", "회의 메모"],
    inputHint: "회의 녹취록이나 회의 메모",
    outputFormat: ["개요(목적·참석자, 80자 이내)", "주요 논의", "할 일(담당·기한)", "결정 사항", "쟁점·위험", "일정", "참고 자료", "다음 단계"],
    promptTemplate: "회의 목적과 참석자를 80자 이내로 요약한 뒤 주요 논의 10개 안팎을 글머리표로 정리합니다. 할 일은 담당과 기한이 드러나게 쓰고, 결정 사항은 이유가 있으면 함께 적습니다. 제기된 우려·위험, 언급된 날짜와 마감, 언급된 문서·도구를 따로 모읍니다. 각 항목은 한 문장(50자 안팎)으로 쓰고, 녹취에 없는 항목은 '언급 없음'으로 적습니다.",
    sourcePattern: "summarize_meeting",
  },
  minutes: {
    id: "minutes",
    label: "공식 회의록 작성",
    whenToUse: "녹취를 회사에 남길 회의록 형식으로 바꿀 때",
    keywords: ["회의록", "의사록", "회의 기록", "녹취"],
    inputHint: "회의 녹취록",
    outputFormat: ["회의 제목(15자 이내)", "핵심 내용 한 문장", "회의 내용(의미 있는 발언·아이디어)", "실행 항목(담당·기한)", "결정 사항과 이유", "문제와 해결 방안", "다음 단계"],
    promptTemplate: "녹취 전체를 읽고 15자 이내 제목과 회의의 핵심을 담은 한 문장을 씁니다. 회의 내용에는 의미 있는 발언과 아이디어를 있는 만큼(가능하면 20개 이상) 한 문장씩 적습니다. 누가 하겠다고 한 일은 모두 실행 항목으로 옮기고 기한이 있으면 붙입니다. 결정 사항은 이유와 함께, 문제는 제안된 해결 방안과 함께 2~3문장으로 정리합니다. 같은 내용을 여러 칸에 반복하지 않습니다.",
    sourcePattern: "transcribe_minutes",
  },
  boardMinutes: {
    id: "board-minutes",
    label: "이사회·주총 의사록 초안",
    whenToUse: "이사회·주주총회·위원회 회의를 공식 기록 형식으로 남길 때",
    keywords: ["이사회", "주주총회", "주총", "의결", "안건", "위원회"],
    inputHint: "회의 녹취록, 안건 목록, 참석자 명단",
    outputFormat: ["회의 정보(일시·장소·회의 종류)", "참석자(출석·불참·배석)", "안건별 논의", "의결 사항(제안·동의·표결 결과)", "실행 항목", "재무 사항", "다음 일정", "추가 기록(이해충돌·규정 관련·불명확한 부분)"],
    promptTemplate: "녹취를 처음부터 끝까지 읽고 일시·장소·회의 종류와 출석·불참·배석자를 정리합니다. 안건마다 배경, 주요 의견, 서로 다른 입장을 객관적으로 요약하고 잡담은 뺍니다. 의결 사항은 안건 문구, 제안자와 동의자, 표결 결과, 조건을 녹취 그대로 적고 추측해서 채우지 않습니다. 이름·숫자·날짜를 다시 대조하고, 들리지 않거나 불명확한 부분은 '확인 필요'로 남깁니다. 의사록 확정과 날인은 담당자가 검토한 뒤에 합니다.",
    sourcePattern: "summarize_board_meeting",
  },
  contractCheck: {
    id: "contract-check",
    label: "계약서 위험 조항 점검",
    whenToUse: "서명 전에 계약서·약관에서 불리하거나 놓치기 쉬운 조항을 찾을 때",
    keywords: ["계약", "약관", "조항", "협약", "합의서", "nda", "비밀유지"],
    inputHint: "계약서 원문, 우리 쪽 입장(공급자·구매자 등), 거래 목적",
    outputFormat: ["문서 요약(100자 안팎)", "눈여겨볼 조항 10가지(조항 번호와 이유)", "검토 등급(매우 중요·중요·기타)", "상대방에 보낼 수정 요청 문안", "전문가 확인 질문"],
    promptTemplate: contractDisclaimer + " 계약서 전체를 100자 안팎으로 요약하고, 대금·범위·납기·검수·책임·손해배상·해지·자동 갱신·지식재산·비밀유지·분쟁 조항에서 눈여겨볼 10가지를 조항 번호와 함께 한 줄씩 적습니다. 서명 전 확인할 사항을 매우 중요·중요·기타로 나누고, 매우 중요와 중요 항목마다 상대방에 보낼 수정 요청 문안을 씁니다. 조문·판례를 지어내지 말고 원문에 근거가 없으면 '확인 필요'로 둡니다.",
    sourcePattern: "check_agreement",
  },
  contractRedline: {
    id: "contract-redline",
    label: "수정 문안 비교표",
    whenToUse: "고치고 싶은 조항의 원문과 수정 문구를 나란히 놓고 협상을 준비할 때",
    keywords: ["수정안", "수정 문구", "대안 조항", "레드라인", "협상안", "문구 수정"],
    inputHint: "계약서 원문과 고치고 싶은 조항, 우리 쪽 요구",
    outputFormat: ["조항별 비교표(조항 번호·원문·제안 문구·바꾸는 이유·대안)", "협상 순서 제안", "전문가 확인 질문"],
    promptTemplate: contractDisclaimer + " 수정할 조항마다 원문, 제안 문구, 바꾸는 이유, 상대가 거절할 때의 대안을 한 줄씩 표로 비교합니다. 조항 번호를 붙이고, 없는 조문·판례를 근거로 들지 않습니다. 우리 쪽에 꼭 필요한 조항과 양보할 수 있는 조항을 나눠 협상 순서를 제안합니다. 원문 변경과 상대방 발송은 사용자가 승인한 뒤에 합니다.",
    sourcePattern: "compare_and_contrast",
  },
  formalEmail: {
    id: "formal-email",
    label: "격식 있는 업무 메일",
    whenToUse: "거래처·기관·고객에게 보내는 공식 메일을 쓰거나 답할 때",
    keywords: ["메일 써", "메일 작성", "회신", "답장", "공문", "안내 메일", "사과 메일", "요청 메일"],
    inputHint: "받는 사람과의 관계, 메일 목적, 꼭 넣을 내용, 받은 메일(답장이라면)",
    outputFormat: ["제목", "인사", "용건(첫 문단)", "세부 내용", "요청 사항과 마무리 인사", "서명"],
    promptTemplate: "받는 사람과의 관계와 메일 목적을 먼저 확인합니다. 제목은 용건이 드러나게 짧게 쓰고, 첫 문단에서 무엇 때문에 연락했는지 바로 밝힙니다. 본문에는 필요한 사실과 일정·금액을 원문 그대로 옮기고, 끝에 상대가 할 일과 회신 기한을 정중하게 정리합니다. 원문에 없는 약속·금액·일정은 넣지 않고, 발송은 사용자가 승인한 뒤에만 합니다.",
    sourcePattern: "create_formal_email",
  },
  polishWriting: {
    id: "polish-writing",
    label: "문장 다듬기·교정",
    whenToUse: "써 둔 글의 맞춤법·어색한 문장·흐름을 고칠 때",
    keywords: ["다듬", "교정", "맞춤법", "윤문", "문장 고쳐", "어색한", "퇴고"],
    inputHint: "고칠 글",
    outputFormat: ["고친 글", "주요 수정 내용 3가지 이내(요청한 경우)"],
    promptTemplate: "원래 뜻과 말투를 지키면서 맞춤법, 띄어쓰기, 어색한 문장, 문단 흐름을 고칩니다. 같은 언어로 돌려주고 사실·숫자·고유명사는 바꾸지 않습니다. 사용자가 원하지 않으면 설명 없이 고친 글만 제시합니다.",
    sourcePattern: "improve_writing",
  },
  translate: {
    id: "translate",
    label: "업무 문서 번역",
    whenToUse: "메일·계약·자료를 다른 언어로 옮길 때",
    keywords: ["번역", "영어로", "영문", "한국어로", "일본어", "중국어", "영작"],
    inputHint: "번역할 글과 목표 언어",
    outputFormat: ["번역문(원문 서식 그대로)", "확인이 필요한 용어(있을 때만)"],
    promptTemplate: "원문의 서식(제목, 목록, 표, 줄바꿈)을 그대로 두고 문장 단위로 뜻과 어조를 살려 옮깁니다. 의미를 바꾸거나 내용을 줄이지 않습니다. 회사명·제품명·법률 용어처럼 번역이 갈릴 수 있는 말은 원문을 괄호로 함께 적고, 확인이 필요한 용어는 끝에 따로 모읍니다. 계약·법률 문서 번역은 참고용이며 효력 판단은 전문가가 합니다.",
    sourcePattern: "translate",
  },
  compareTable: {
    id: "compare-table",
    label: "비교표 만들기",
    whenToUse: "서비스·제품·선택지 여러 개를 같은 기준으로 나란히 비교할 때",
    keywords: ["비교", "차이", "장단점", "어느 게 나", "뭐가 나", "대안"],
    inputHint: "비교할 대상 목록과 비교 기준(가격, 범위, 조건 등)",
    outputFormat: ["비교 기준 설명", "비교표(행: 대상, 열: 기준)", "선택지별 장단점", "추천과 근거", "확인 필요"],
    promptTemplate: "비교할 대상을 표의 행에, 기준을 열에 두고 같은 기준으로 값을 채웁니다. 단위·통화·부가세 포함 여부를 맞춘 뒤 비교하고, 값마다 출처나 기준일을 함께 적습니다. 표 아래에 선택지별 장단점과 추천을 짧게 덧붙이되, 자료로 확인되지 않은 칸은 비우지 말고 '미확인'으로 표시합니다.",
    sourcePattern: "compare_and_contrast",
  },
  tableExtract: {
    id: "table-extract",
    label: "자료에서 표 데이터 뽑기",
    whenToUse: "문서·메일·메모에 흩어진 숫자와 항목을 엑셀에 붙일 표로 모을 때",
    keywords: ["csv", "엑셀", "표로", "표 만들", "데이터 추출", "목록화", "스프레드시트"],
    inputHint: "숫자·항목이 담긴 문서, 메일, 메모",
    outputFormat: ["CSV 표(첫 줄은 항목 이름)", "비었거나 애매한 값 목록"],
    promptTemplate: "자료 전체에서 프로젝트·거래처·금액·날짜·지표처럼 반복되는 항목을 찾고, 자료에 쓰인 항목 이름 그대로 열을 만듭니다. 쉼표로 구분한 CSV로 내고 첫 줄에는 항목 이름을 둡니다. 없는 열을 지어내지 않고, 값이 비었거나 애매하면 칸을 비운 뒤 표 아래 목록에 이유를 적습니다. 숫자는 단위와 통화를 열 이름에 밝힙니다.",
    sourcePattern: "export_data_as_csv",
  },
  featureExtract: {
    id: "feature-extract",
    label: "제품 특징 뽑기",
    whenToUse: "제품 소개·출시 공지·상세페이지에서 내세울 기능과 특징을 정리할 때",
    keywords: ["특징", "기능 정리", "셀링 포인트", "장점", "소구점", "제품 소개", "상세페이지"],
    inputHint: "제품 소개서, 상세페이지, 출시 공지",
    outputFormat: ["제품·서비스 특징 목록(항목당 50자 안팎)", "근거가 약한 주장"],
    promptTemplate: "자료가 출시 공지인지, 소개서인지, 후기인지 먼저 파악하고 제품이나 서비스의 기능·특징을 말하는 부분만 골라냅니다. 특징은 글머리표로 항목마다 50자 안팎의 한 문장으로 쓰고, 항목 첫머리를 같은 말로 시작하지 않습니다. 자료에 근거가 없는 성능·수치는 넣지 않고, 근거가 약한 주장은 따로 표시합니다.",
    sourcePattern: "extract_product_features",
  },
  newsBrief: {
    id: "news-brief",
    label: "소식지용 한 단락",
    whenToUse: "기사·발표 내용을 소식지나 공지용 한 단락으로 줄일 때",
    keywords: ["소식지", "뉴스레터", "공지문", "기사 요약", "보도 요약", "한 단락"],
    inputHint: "기사, 발표 자료, 알릴 내용",
    outputFormat: ["제목 한 줄(사실 중심)", "본문 한 단락(250자 이내)"],
    promptTemplate: "가장 중요한 사실을 담은 제목을 한 줄로 쓰고 과장·홍보성 표현은 뺍니다. 본문은 제삼자가 차분하게 전하는 말투로 250자 이내 한 단락을 씁니다. 누가, 무엇을, 언제, 왜 했는지와 남은 쟁점을 사실 위주로 담고, 원문에 없는 수치나 인용은 넣지 않습니다. 외부 게시와 배포는 사용자가 승인한 뒤에 합니다.",
    sourcePattern: "create_newsletter_entry",
  },
  naturalKorean: {
    id: "natural-korean",
    label: "자연스러운 우리말로 다듬기",
    whenToUse: "AI가 쓴 듯 딱딱하거나 번역투인 글을 사람이 쓴 것처럼 바꿀 때",
    keywords: ["자연스럽게", "사람이 쓴", "ai 티", "번역투", "딱딱", "부드럽게", "말하듯"],
    inputHint: "다듬을 글과 읽는 사람",
    outputFormat: ["다듬은 글(문단 단위)"],
    promptTemplate: "원래 뜻과 어조를 지키면서 짧은 문장, 능동형, 일상적인 단어로 바꿉니다. 같은 단어와 같은 문장 시작이 되풀이되지 않게 하고 '또한·그리고·따라서' 같은 접속어를 줄입니다. 막연한 표현은 구체적인 상황이나 예로 바꾸되 없는 사실을 지어내지 않습니다. 글 전체가 한 사람이 쓴 것처럼 고르게 이어지도록 다듬습니다.",
    sourcePattern: "humanize",
  },
  priorityMatrix: {
    id: "priority-matrix",
    label: "할 일 우선순위 정리",
    whenToUse: "할 일이 쌓였을 때 급한 일과 중요한 일을 나눠 이번 주 계획을 세울 때",
    keywords: ["우선순위", "할 일", "급한", "투두", "todo", "뭐부터", "일정 정리"],
    inputHint: "할 일 목록(마감·관련자를 알면 함께)",
    outputFormat: ["할 일 분류표(할 일·구분·이유·추천 행동)", "현재 상태 진단", "이번 주 집중 지침 3가지"],
    promptTemplate: "할 일마다 숨은 마감과 관련자를 찾아 두 기준으로 판단합니다. 급함은 2~3일 안에 하지 않으면 바로 문제가 생기는지, 중요함은 장기 목표나 핵심 성과에 영향을 주는지입니다. 지금 하기(급하고 중요), 일정 잡기(중요하지만 급하지 않음), 맡기기(급하지만 덜 중요), 빼기(둘 다 아님)로 나누고 이유를 한 문장씩 붙입니다. 마지막에 급한 일에 쫓기는지, 덜 중요한 일로 바쁜지 진단하고 이번 주 집중 지침 3가지를 적습니다.",
    sourcePattern: "eisenhower_matrix",
  },
  fileTidyPlan: {
    id: "file-tidy-plan",
    label: "파일 정리 제안",
    whenToUse: "흩어진 파일을 프로젝트·날짜·종류 기준으로 정리할 안이 필요할 때",
    keywords: ["폴더 정리", "파일 정리", "바탕화면", "다운로드 폴더", "중복 파일", "파일 찾"],
    inputHint: "정리할 폴더 이름이나 학습한 업무 폴더 범위",
    outputFormat: ["정리 기준안 비교(2가지 이내)", "옮길 파일 표(파일·지금 위치·제안 위치·이유)", "중복 의심 파일", "사용자가 직접 할 단계"],
    promptTemplate: "학습한 폴더의 파일 이름·위치·수정일에서 프로젝트·날짜·종류 기준을 찾아 정리안을 2가지 이내로 비교합니다. 옮길 파일과 새 폴더 이름을 표로 보여 주고, 중복으로 보이는 파일은 크기·수정일을 근거로 표시만 합니다. 파일 이동·이름 변경·삭제는 실행하지 않고 사용자가 직접 할 단계를 순서대로 안내합니다.",
    sourcePattern: "create_recursive_outline",
  },
  taxEvidenceTable: {
    id: "tax-evidence-table",
    label: "세무사 전달용 증빙 표",
    whenToUse: "세금계산서·영수증 같은 증빙을 세무사에게 보내기 전에 표로 정리할 때",
    keywords: ["증빙", "세금계산서", "영수증", "부가세", "세무사", "경비", "종합소득세", "신고 자료"],
    inputHint: "증빙 파일이나 목록, 사업자 유형, 과세기간",
    outputFormat: ["증빙 표(일자·거래처·공급가액·세액·지출 구분·증빙 종류)", "중복·누락 의심", "세무사에게 물을 질문"],
    promptTemplate: taxDisclaimer + " 증빙 자료에서 일자, 거래처, 공급가액, 세액, 지출 구분, 증빙 종류를 찾아 CSV 표로 모읍니다. 같은 거래가 두 번 보이거나 세액·합계가 맞지 않는 줄, 증빙이 빠진 거래를 따로 표시합니다. 공제나 비용 인정 여부는 확정하지 말고 세무사에게 물을 질문으로 정리합니다.",
    sourcePattern: "export_data_as_csv",
  },
  taxNoticeSummary: {
    id: "tax-notice-summary",
    label: "세무 안내문 요약",
    whenToUse: "국세청·지자체 안내문이나 고지서의 기한과 준비물을 빠르게 파악할 때",
    keywords: ["국세청", "고지서", "안내문", "세무 안내", "신고 안내", "납부 기한"],
    inputHint: "세무 안내문이나 고지서",
    outputFormat: ["한 문장 요약(60자 안팎)", "세목·과세기간·기한·금액", "준비물", "세무사에게 물을 질문"],
    promptTemplate: taxDisclaimer + " 안내문에서 세목, 과세기간, 신고·납부 기한, 금액, 준비물을 뽑아 60자 안팎의 한 문장 요약과 핵심 3가지로 정리합니다. 기한과 금액은 원문 그대로 옮기고, 우리 사업에 해당하는지 애매한 내용은 세무사에게 물을 질문으로 남깁니다. 신고와 납부는 사용자가 확인한 뒤에 합니다.",
    sourcePattern: "summarize_micro",
  },
  financeReconcileTable: {
    id: "finance-reconcile-table",
    label: "정산 내역 대사표",
    whenToUse: "원장·청구서·입금 내역을 맞춰 차이와 미수금을 찾을 때",
    keywords: ["정산", "대사", "미수금", "입금", "청구", "매출표", "비용 내역"],
    inputHint: "원장, 청구서 목록, 입출금 내역",
    outputFormat: ["대사표(거래일·거래처·금액·식별 번호·상태)", "차이 금액과 계산식", "확인 요청 목록"],
    promptTemplate: "원장·청구서·입금 내역에서 거래일, 거래처, 금액, 식별 번호를 찾아 한 표로 맞춥니다. 짝이 맞는 거래, 금액이 다른 거래, 한쪽에만 있는 거래를 나눠 표시하고 차이 금액을 계산식과 함께 적습니다. 부가세 포함 여부와 통화를 열 이름에 밝히고 확인되지 않은 거래는 '확인 필요'로 남깁니다. 송금이나 장부 수정은 하지 않습니다.",
    sourcePattern: "export_data_as_csv",
  },
  metricChange: {
    id: "metric-change",
    label: "기간별 지표 비교",
    whenToUse: "지난달·지난해와 지표를 비교해 증감과 원인 후보를 볼 때",
    keywords: ["증감", "전월", "전년", "추세", "지표", "이상값", "매출 분석"],
    inputHint: "기간별 표 데이터와 지표 정의",
    outputFormat: ["지표 정의(분모·단위·기간)", "기간별 비교표(증감·증감률)", "이상값과 기준", "원인 후보와 확인 방법"],
    promptTemplate: "비교할 기간과 지표 정의(분모·단위·기간)를 먼저 적고, 기간별 값을 표로 나란히 놓아 증감과 증감률을 계산식과 함께 보여 줍니다. 이상값은 판단 기준을 밝혀 표시하고, 원인은 가격·수량·구성·계절성처럼 가능한 설명과 확인 방법으로 나눠 적습니다. 상관관계를 원인으로 단정하지 않습니다.",
    sourcePattern: "compare_and_contrast",
  },
  quoteCompare: {
    id: "quote-compare",
    label: "견적 비교와 발주안",
    whenToUse: "공급사 견적 여러 개를 총비용과 납기로 비교해 발주안을 만들 때",
    keywords: ["견적", "단가", "공급사", "업체 비교", "발주", "최저가"],
    inputHint: "견적서들, 필요한 수량·규격·납기",
    outputFormat: ["견적 비교표(품목·규격·수량·단가·운송비·세금·납기·결제 조건·유효기간)", "총비용 순위", "추천 공급사와 이유", "발주 전 확인 질문"],
    promptTemplate: "견적마다 품목·규격·단위·수량을 먼저 맞춘 뒤 단가뿐 아니라 운송비·세금·최소 주문량·결제 조건·납기·보증을 포함한 총비용을 표로 비교합니다. 견적 유효기간과 통화를 확인하고, 규격이 다르거나 빠진 항목은 '확인 필요'로 둡니다. 표 아래에 추천 공급사와 이유, 발주 전에 확인할 질문을 적습니다. 실제 주문은 사용자가 승인한 뒤에 합니다.",
    sourcePattern: "compare_and_contrast",
  },
  supportReply: {
    id: "support-reply",
    label: "고객 문의 답변",
    whenToUse: "환불·교환·배송·오류 같은 고객 문의에 답할 때",
    keywords: ["문의", "환불", "교환", "배송", "클레임", "고객 응대", "고객 답변"],
    inputHint: "고객 문의 원문, 관련 정책, 처리 이력",
    outputFormat: ["문의 요약(문제·원하는 해결)", "답변 초안(공감·확인한 사실·해결 순서·다음 안내 시점)", "이관이 필요하면 전달 메모"],
    promptTemplate: "고객이 겪은 문제와 원하는 해결을 먼저 정리합니다. 답변은 공감 한 문장, 확인한 사실, 쉬운 해결 순서, 다음 안내 시점 순서로 씁니다. 환불·보상·배송 약속은 정책과 처리 이력에 근거가 있을 때만 쓰고 책임을 추측하지 않습니다. 개인정보는 필요한 만큼만 요청하고, 발송은 사용자가 승인한 뒤에 합니다.",
    sourcePattern: "create_formal_email",
  },
  salesProposal: {
    id: "sales-proposal",
    label: "고객 맞춤 제안 메일",
    whenToUse: "상담 뒤 고객 상황에 맞춘 제안이나 후속 메일을 보낼 때",
    keywords: ["제안", "제안서", "고객사", "영업", "후속 메일", "미팅 후"],
    inputHint: "상담 메모, 제품 소개, 가격 기준",
    outputFormat: ["고객 상황 요약(확인된 사실·가설)", "제안 범위·일정·가격 조건", "메일 본문", "다음 미팅 제안"],
    promptTemplate: "상담 메모에서 고객의 문제, 결정권자, 예산, 도입 시기를 확인된 사실과 가설로 나눕니다. 검증된 기능만 고객 문제와 연결하고 근거 없는 절감률·사례는 쓰지 않습니다. 메일은 감사 인사, 고객 상황 요약, 제안 범위와 일정·가격 조건, 다음 미팅 제안 순서로 씁니다. 가격 확약과 발송은 사용자가 승인한 뒤에 합니다.",
    sourcePattern: "create_formal_email",
  },
  campaignMessage: {
    id: "campaign-message",
    label: "캠페인 메시지와 실험안",
    whenToUse: "제품 특징을 고객 상황에 맞는 메시지로 바꾸고 시험 계획을 세울 때",
    keywords: ["캠페인", "광고", "타깃", "메시지", "a/b", "전환", "마케팅"],
    inputHint: "제품 자료, 대상 고객, 예산·기간",
    outputFormat: ["메시지 2~3안(주장·근거·확인할 가설)", "실험 계획(대상·소재·행동 유도 문구·예산·기간·주지표·중단 기준)", "측정 방법"],
    promptTemplate: "제품 자료에서 내세울 특징을 고르고 대상 고객의 상황과 연결한 메시지 2~3안을 만듭니다. 안마다 주장과 그 근거, 확인할 가설을 나누고 실험 계획(대상·소재·행동 유도 문구·예산·기간·주지표·중단 기준)을 붙입니다. 한 번에 한 가지 변수만 바꾸고 근거 없는 효과는 약속하지 않습니다. 광고 집행과 게시는 사용자가 승인한 뒤에 합니다.",
    sourcePattern: "extract_product_features",
  },
  pressRelease: {
    id: "press-release",
    label: "보도자료 초안",
    whenToUse: "새 소식을 언론에 알릴 보도자료로 쓸 때",
    keywords: ["보도자료", "언론", "기자", "배포", "공식 발표", "보도"],
    inputHint: "알릴 소식, 날짜, 회사 소개, 문의처, 인용할 말(있으면)",
    outputFormat: ["제목·부제", "첫 문단(누가·무엇을·언제·어디서·왜)", "본문 3~5문단", "인용문(확인된 것만)", "회사 소개와 문의처"],
    promptTemplate: "사실 중심 제목과 부제를 쓰고, 첫 문단에 누가·무엇을·언제·어디서·왜를 담습니다. 본문은 중요한 순서대로 3~5문단으로 쓰고, 인용문은 사용자가 준 것만 쓰거나 '인용 확인 필요'로 표시합니다. 회사 소개와 문의처는 마지막에 둡니다. 수치·수상·고객사는 근거가 있을 때만 쓰고, 배포와 게시는 사용자가 승인한 뒤에 합니다.",
    sourcePattern: "create_newsletter_entry",
  },
  snsNotice: {
    id: "sns-notice",
    label: "SNS 공지 문안",
    whenToUse: "인스타그램·블로그·채널에 올릴 공지나 소식 글을 쓸 때",
    keywords: ["sns", "인스타", "공지", "게시물", "블로그", "카드뉴스", "채널 글"],
    inputHint: "알릴 내용, 올릴 채널, 일정·신청 방법",
    outputFormat: ["짧은 글(100자 안팎)", "자세한 글", "해시태그·이미지 아이디어(필요하면)"],
    promptTemplate: "공지 목적과 읽는 사람을 먼저 정하고 첫 줄에 핵심을 둡니다. 채널에 맞게 100자 안팎의 짧은 글과 자세한 글을 함께 쓰고, 일정·장소·신청 방법 같은 사실은 원문 그대로 옮깁니다. 딱딱한 표현은 말하듯 자연스럽게 바꾸되 과장된 약속은 넣지 않습니다. 게시는 사용자가 승인한 뒤에 합니다.",
    sourcePattern: "humanize",
  },
  interviewNotes: {
    id: "interview-notes",
    label: "면접 기록 정리",
    whenToUse: "면접 메모나 녹취를 평가 기준별 근거로 정리할 때",
    keywords: ["면접", "인터뷰", "지원자", "평가표"],
    inputHint: "면접 기록, 평가 기준표",
    outputFormat: ["질문별 답변 요지", "평가 기준별 근거 발언", "강점", "더 확인할 부분", "다음 면접 질문"],
    promptTemplate: "면접 기록에서 질문별 답변 요지와 그 답이 보여 준 역량을 정리합니다. 평가표 기준에 맞춰 근거가 된 발언을 함께 적고, 나이·출신·가족처럼 직무와 무관한 정보는 평가에 쓰지 않습니다. 강점, 더 확인할 부분, 다음 면접 질문을 나눠 적습니다. 합격·불합격 결정과 통보는 사용자가 합니다.",
    sourcePattern: "summarize_meeting",
  },
  onboardingOutline: {
    id: "onboarding-outline",
    label: "온보딩 계획 쪼개기",
    whenToUse: "새 동료의 첫날·첫 주·첫 달 할 일을 계획할 때",
    keywords: ["온보딩", "입사", "수습", "첫 주", "인수인계"],
    inputHint: "직무, 팀 구성, 필요한 계정·도구",
    outputFormat: ["첫날·첫 주·첫 달 단계", "단계별 결과물·담당·확인 시점", "필요한 계정 권한과 발급 승인"],
    promptTemplate: "새 사람이 첫날·첫 주·첫 달에 할 일을 단계로 나누고, 단계마다 결과물·담당·필요한 계정 권한·확인 시점을 붙입니다. 권한 발급처럼 다른 사람의 승인이 필요한 일은 따로 표시합니다. 정해지지 않은 담당은 '배정 필요'로 남깁니다.",
    sourcePattern: "create_recursive_outline",
  },
  devBreakdown: {
    id: "dev-breakdown",
    label: "개발 작업 쪼개기",
    whenToUse: "기능 구현이나 버그 수정을 작업·테스트 단위로 나눌 때",
    keywords: ["구현", "개발 작업", "기능 개발", "버그", "리팩터", "작업 분해"],
    inputHint: "목표 동작, 현재 동작, 관련 코드나 화면",
    outputFormat: ["목표 동작과 현재 동작", "작업 목록(화면·로직·데이터·테스트)", "작업별 검증 방법", "되돌리는 방법"],
    promptTemplate: "목표 동작과 현재 동작을 먼저 적고 작업을 화면·로직·데이터·테스트 단위로 나눕니다. 작업마다 바꿀 파일이나 모듈 후보, 검증 방법(정상·경계·실패·회귀), 되돌리는 방법을 붙입니다. 실행해 보지 않은 테스트는 '미실행'으로 표시하고 배포는 사용자 승인 뒤로 둡니다.",
    sourcePattern: "create_recursive_outline",
  },
} satisfies Record<string, ModyRoleRecipe>;

// ── 역할 정본 ────────────────────────────────────────────────────────────────
const capabilityList: ModyRoleCapability[] = [
{
  "roleId": "b2b-customer-developer",
  "label": "B2B 고객개발 전문가",
  "dailySkillCategories": [
    "public",
    "news"
  ],
  "toolIds": [
    "daily.lookup"
  ],
  "connections": [
    {
      "id": "ai",
      "label": "AI 답변 연결",
      "neededFor": "first_task"
    }
  ],
  "approvalRequired": [
    "외부 발송·게시",
    "고객 자료 외부 전송",
    "계정 연결·유료 서비스"
  ],
  "canDo": [
    "기업 잠재고객 조사·선별",
    "근거·보류 사유 정리",
    "첫 제안 초안과 영업 인계",
    "제공 자료의 근거·우선순위·초안 로컬 정리"
  ],
  "cannotDo": [
    "자동 고객 수집·메일 발송·CRM 변경",
    "Harvey 원본 실행 및 성과 보장",
    "개인 식별정보 수집·개인별 점수화"
  ],
  "firstTasks": [
    {
      "label": "B2B 고객개발 전문가 첫 업무",
      "prompt": "이 기업 후보들의 공개 근거를 비교해 접촉 우선순위와 첫 제안 초안을 준비해 줘"
    }
  ],
  "recipes": [recipes.compareTable, recipes.formalEmail]
},
{
  "roleId": "b2c-customer-growth",
  "label": "B2C 고객성장 전문가",
  "dailySkillCategories": [
    "shopping",
    "news"
  ],
  "toolIds": [
    "daily.lookup"
  ],
  "connections": [
    {
      "id": "ai",
      "label": "AI 답변 연결",
      "neededFor": "first_task"
    }
  ],
  "approvalRequired": [
    "외부 발송·게시",
    "고객 자료 외부 전송",
    "계정 연결·유료 서비스"
  ],
  "canDo": [
    "익명 고객군·가입 전환 분석",
    "동의 기반 메시지 가설",
    "실험 지표·중단 기준 설계",
    "제공 자료의 근거·우선순위·초안 로컬 정리"
  ],
  "cannotDo": [
    "자동 고객 수집·메일 발송·CRM 변경",
    "Harvey 원본 실행 및 성과 보장",
    "개인 식별정보 수집·개인별 점수화"
  ],
  "firstTasks": [
    {
      "label": "B2C 고객성장 전문가 첫 업무",
      "prompt": "이 익명 고객군 집계로 가입 전환의 장애물과 작은 성장 실험 초안을 만들어 줘"
    }
  ],
  "recipes": [recipes.feedbackPriority, recipes.metricChange]
},
{
  "roleId": "securities-researcher",
  "label": "증권 리서치 전문가",
  "dailySkillCategories": [
    "finance",
    "news"
  ],
  "toolIds": [
    "daily.lookup"
  ],
  "connections": [
    {
      "id": "ai",
      "label": "AI 답변 연결",
      "neededFor": "first_task"
    }
  ],
  "approvalRequired": [
    "보고서 외부 게시·전송"
  ],
  "canDo": [
    "출처가 있는 자료의 재무·뉴스·심리·차트 검토",
    "강세·약세 가설 및 위험 보고"
  ],
  "cannotDo": [
    "실제 매매·주문·증권계정 접근",
    "실시간 시세와 국내 공시 완전성 보장",
    "TradingAgents 원본 실행·체결 시뮬레이션"
  ],
  "firstTasks": [
    {
      "label": "종목 근거 검토",
      "prompt": "이 종목을 기준일 현재 재무·뉴스·심리·차트와 강세·약세 근거로 검토해 줘"
    }
  ],
  "recipes": [recipes.newsBrief, recipes.metricChange, recipes.compareTable]
},
  {
    roleId: personalOperatorRoleId,
    label: "기본 비서",
    dailySkillCategories: "all",
    toolIds: [...allMailTools, "daily.lookup"],
    connections: [
      { id: "mail", label: "메일", neededFor: "optional" },
      { id: "calendar", label: "캘린더", neededFor: "optional" },
      aiConnection,
    ],
    approvalRequired: ["메일 발송", "일정 등록", "파일 이동·삭제", "결제·외부 제출"],
    canDo: [
      "요청을 정리해 맞는 AI 직원에게 나눠 맡기기",
      "연결한 메일 검색·열람과 답장 초안 작성",
      "일상 정보 조회(13개 분류 전체)",
      "할 일을 급한 일·중요한 일로 나눠 순서 정하기",
    ],
    cannotDo: [
      "승인 없이 메일을 보내거나 일정을 확정하지 않아요",
      "비밀번호·인증값을 채팅으로 받지 않아요",
      "전문 직원의 고정 지침을 대신 바꾸지 않아요",
    ],
    firstTasks: [
      { label: "할 일 나누기", prompt: "지금 쌓인 일을 급한 일과 중요한 일로 나누고 맡길 직원을 정해 줘" },
      {
        label: "메일에서 내 할 일 찾기",
        prompt: "오늘 받은 메일에서 내가 처리할 일만 골라 줘",
        requiresConnection: "mail",
        fallbackPrompt: "아래에 붙여 넣은 메일에서 내가 처리할 일만 골라 줘",
      },
    ],
    recipes: [recipes.priorityMatrix, recipes.summaryMicro],
  },
  {
    roleId: "mail-secretary",
    label: "메일·고객 응대 전문가",
    dailySkillCategories: ["weather", "transport", "life", "shopping"],
    toolIds: [...allMailTools, "daily.lookup"],
    connections: [
      { id: "mail", label: "메일 (Gmail·Outlook·회사 메일)", neededFor: "first_task" },
      { id: "calendar", label: "캘린더 · 일정 후보 확인", neededFor: "optional" },
      aiConnection,
    ],
    approvalRequired: ["메일 발송·전달", "일정 등록", "환불·보상 안내 확정", "담당자 이관 요청 전송"],
    canDo: [
      "연결한 메일함에서 메일 검색·열람(읽기 전용)",
      "답장할 메일·고객 문의를 기한과 함께 표로 정리",
      "정책에 맞는 답장 초안을 만들어 승인함에 올리기",
      "반복 문의를 묶어 재발 방지 제안",
      "택배·교통·날씨·상품 같은 생활 정보 조회",
    ],
    cannotDo: [
      "승인 없이 메일을 보내지 않아요",
      "정책 근거 없이 환불·보상을 약속하지 않아요",
      "캘린더에 일정을 직접 넣지 않아요(후보만 제안)",
      "필요 이상으로 개인정보를 요구하지 않아요",
    ],
    firstTasks: [
      {
        label: "오늘 메일 정리",
        prompt: "오늘 받은 메일에서 답장할 일과 기한을 정리해 줘",
        requiresConnection: "mail",
        fallbackPrompt: "아래에 붙여 넣은 메일들에서 답장할 일과 기한을 정리해 줘",
      },
      {
        label: "문의 분류와 답변",
        prompt: "고객 문의를 분류하고 정책에 맞는 답변 초안을 만들어 줘",
        requiresConnection: "mail",
        fallbackPrompt: "아래에 붙여 넣은 고객 문의를 분류하고 정책에 맞는 답변 초안을 만들어 줘",
      },
    ],
    recipes: [recipes.formalEmail, recipes.supportReply, recipes.feedbackPriority, recipes.summaryMicro, recipes.translate],
  },
  {
    roleId: "document-writer",
    label: "문서 전문가",
    dailySkillCategories: ["news", "public", "legal"],
    toolIds: ["daily.lookup"],
    connections: [
      { id: "drive", label: "구글 드라이브 · 양식·자료 학습용", neededFor: "optional" },
      aiConnection,
    ],
    approvalRequired: ["완성 문서의 외부 발송·제출", "기존 파일 덮어쓰기"],
    canDo: [
      "첨부·학습 자료로 보고서·회의록 초안 작성",
      "학습한 문서에서 관련 자료 찾기",
      "요약·교정·번역 레시피로 문서 다듬기",
      "뉴스·공공·법령 정보를 조회해 근거 붙이기",
    ],
    cannotDo: [
      "빈 필수 항목을 임의로 채우지 않아요",
      "원본 파일을 덮어쓰지 않아요(새 파일로 저장)",
      "메일함을 열지 않아요",
    ],
    firstTasks: [
      { label: "1쪽 보고서", prompt: "이 자료를 임원 보고용 1쪽 보고서로 만들어 줘" },
      { label: "회의록 만들기", prompt: "이 회의 녹취로 결정 사항과 할 일이 담긴 회의록을 만들어 줘" },
    ],
    recipes: [recipes.summaryStandard, recipes.meetingSummary, recipes.minutes, recipes.boardMinutes, recipes.polishWriting, recipes.translate],
  },
  {
    roleId: "research-assistant",
    label: "리서치·데이터 분석 전문가",
    dailySkillCategories: ["news", "public", "finance", "shopping", "realestate", "legal"],
    toolIds: ["daily.lookup"],
    connections: [aiConnection],
    approvalRequired: ["조사·분석 결과 외부 공유·게시", "원본 데이터 수정·덮어쓰기"],
    canDo: [
      "받은 자료와 조회 결과로 비교표·장단점 정리",
      "표 데이터의 결측·중복·이상값 점검",
      "기간별 증감과 원인 후보 분석",
      "뉴스·공공 공고·경제 지표·가격·부동산·법령 조회",
    ],
    cannotDo: [
      "검색 결과 요약만으로 사실을 단정하지 않아요",
      "상관관계를 원인으로 단정하지 않아요",
      "원본 데이터를 고치지 않아요(복사본으로 계산)",
      "메일함을 열지 않아요",
    ],
    firstTasks: [
      { label: "경쟁 서비스 비교", prompt: "경쟁 서비스 3곳의 가격과 제공 범위를 공식 자료로 비교해 줘" },
      { label: "매출 이상값·증감", prompt: "이 매출표의 이상값과 증감 원인을 분석해 줘" },
    ],
    recipes: [recipes.compareTable, recipes.summaryStandard, recipes.featureExtract, recipes.metricChange, recipes.tableExtract],
  },
  {
    roleId: "work-manager",
    label: "업무 관리 전문가",
    dailySkillCategories: ["weather", "transport", "travel", "shopping", "food", "life", "health", "culture", "public", "news"],
    toolIds: ["daily.lookup"],
    connections: [
      { id: "calendar", label: "캘린더 · 일정 확인", neededFor: "optional" },
      { id: "drive", label: "구글 드라이브 · 파일 찾기 범위 넓히기", neededFor: "optional" },
      aiConnection,
    ],
    approvalRequired: ["일정 등록·변경", "팀 공유·담당자 확정 통보", "파일 이동·이름 변경·삭제"],
    canDo: [
      "목표를 담당·기한·완료 기준이 있는 실행계획으로 만들기",
      "큰 일을 작은 작업으로 쪼개고 작업량 산정",
      "할 일을 급한 일·중요한 일로 나눠 순서 정하기",
      "학습한 업무 폴더에서 파일 찾기·정리안 제안",
      "날씨·교통·여행·생활 같은 일상 정보 조회",
    ],
    cannotDo: [
      "착수만 한 일을 완료로 표시하지 않아요",
      "마우스 클릭·키보드 입력 같은 화면 자동 조작을 하지 않아요",
      "승인 없이 일정 등록·공유·파일 이동을 하지 않아요",
      "메일은 메일·고객 응대 전문가가 맡아요",
    ],
    firstTasks: [
      { label: "이번 달 실행계획", prompt: "이번 달 프로젝트를 담당자와 완료 기준이 있는 실행계획으로 만들어 줘" },
      { label: "오늘 할 일 순서", prompt: "오늘 할 일을 급한 일과 중요한 일로 나눠 순서를 정해 줘" },
    ],
    recipes: [recipes.recursiveOutline, recipes.effortEstimate, recipes.meetingSummary, recipes.priorityMatrix, recipes.fileTidyPlan],
  },
  {
    roleId: "sales-consultant",
    label: "B2B 영업 전문가",
    dailySkillCategories: ["public", "news", "transport", "finance"],
    toolIds: [...readDraftMailTools, "daily.lookup"],
    connections: [
      { id: "mail", label: "메일 · 고객 메일 확인", neededFor: "optional" },
      { id: "calendar", label: "캘린더 · 미팅 일정 확인", neededFor: "optional" },
      aiConnection,
    ],
    approvalRequired: ["제안서·견적 발송", "가격·할인 확약", "미팅 일정 확정"],
    canDo: [
      "상담 메모로 고객별 제안서·후속 질문 작성",
      "견적 수량·단가·부가세 검산",
      "고객 메일 검색·열람과 회신 초안 작성",
      "공공 발주 공고·업계 뉴스·환율 조회",
    ],
    cannotDo: [
      "근거 없는 성능·절감률·사례를 약속하지 않아요",
      "승인 없이 제안서를 보내거나 가격을 확약하지 않아요",
      "할인 권한을 대신 판단하지 않아요",
    ],
    firstTasks: [
      { label: "제안서와 후속 질문", prompt: "이 상담 메모로 고객별 제안서와 후속 질문을 만들어 줘" },
      {
        label: "고객 메일 회신",
        prompt: "최근 고객 메일 중 답하지 않은 문의에 보낼 회신 초안을 만들어 줘",
        requiresConnection: "mail",
        fallbackPrompt: "아래에 붙여 넣은 고객 메일에 보낼 회신 초안을 만들어 줘",
      },
    ],
    recipes: [recipes.salesProposal, recipes.featureExtract],
  },
  {
    roleId: "growth-strategist",
    label: "마케팅 전략 전문가",
    dailySkillCategories: ["news", "shopping", "culture"],
    toolIds: ["daily.lookup"],
    connections: [aiConnection],
    approvalRequired: ["광고 집행·예산 변경", "캠페인 게시", "고객 대상 메시지 발송"],
    canDo: [
      "고객·채널·예산별 캠페인 실험 설계",
      "제품 특징을 고객 문제와 잇는 메시지 작성",
      "고객 반응을 묶어 우선순위 정리",
      "업계 뉴스·경쟁 상품 가격·행사 일정 조회",
    ],
    cannotDo: [
      "광고 계정을 직접 조작하지 않아요",
      "근거 없는 효과를 약속하지 않아요",
      "메일함을 열지 않아요",
    ],
    firstTasks: [
      { label: "첫 고객 캠페인", prompt: "우리 제품의 첫 고객 확보 캠페인을 예산별로 설계해 줘" },
      { label: "메시지 실험안", prompt: "이 제품 소개로 고객에게 시험해 볼 메시지 3안과 측정 방법을 만들어 줘" },
    ],
    recipes: [recipes.campaignMessage, recipes.featureExtract, recipes.feedbackPriority],
  },
  {
    roleId: "content-editor",
    label: "콘텐츠·홍보 전문가",
    dailySkillCategories: ["news", "culture"],
    toolIds: ["daily.lookup"],
    connections: [aiConnection],
    approvalRequired: ["콘텐츠 게시·외부 채널 업로드", "보도자료 배포", "기자 문의 회신"],
    canDo: [
      "랜딩페이지·SNS·인스타 원고 완성본 작성",
      "보도자료 초안과 채널별 공지 문안 작성",
      "번역투를 자연스러운 우리말로 다듬기",
      "시즌 소재용 뉴스·공연·행사 정보 조회",
    ],
    cannotDo: [
      "허위 후기·과장된 보장을 쓰지 않아요",
      "근거 없는 수치·수상·고객사를 쓰지 않아요",
      "승인 없이 배포·게시·회신하지 않아요",
      "메일함을 열지 않아요(기자 메일은 붙여 넣기)",
    ],
    firstTasks: [
      { label: "랜딩·SNS 원고", prompt: "이 제품 소개로 랜딩페이지 문구와 SNS 원고를 작성해 줘" },
      { label: "보도자료와 SNS 공지", prompt: "이번 소식으로 보도자료 초안과 SNS 공지 문안을 만들어 줘" },
    ],
    recipes: [recipes.naturalKorean, recipes.polishWriting, recipes.newsBrief, recipes.pressRelease, recipes.snsNotice],
  },
  {
    roleId: "product-planner",
    label: "제품·서비스 기획 전문가",
    dailySkillCategories: ["news", "shopping", "public"],
    toolIds: ["daily.lookup"],
    connections: [aiConnection],
    approvalRequired: ["요구사항 확정·개발 착수 요청", "기획 문서 외부 공유"],
    canDo: [
      "아이디어를 요구사항 정의서로 구체화",
      "고객 의견을 묶어 개선 우선순위 정하기",
      "발표 흐름과 슬라이드 구성 짜기",
      "시장 뉴스·경쟁 상품 가격·지원사업 공고 조회",
    ],
    cannotDo: [
      "사용자 근거 없는 기능을 확정하지 않아요",
      "개발 일정을 대신 약속하지 않아요",
      "메일함을 열지 않아요",
    ],
    firstTasks: [
      { label: "요구사항 구체화", prompt: "이 기능 아이디어를 개발 가능한 요구사항으로 구체화해 줘" },
      { label: "고객 의견 우선순위", prompt: "이 고객 의견들을 묶어서 먼저 고칠 순서를 정해 줘" },
    ],
    recipes: [recipes.prd, recipes.feedbackPriority, recipes.presentationFlow, recipes.recursiveOutline],
  },
  {
    roleId: "product-designer",
    label: "디자인 전문가",
    dailySkillCategories: ["culture", "shopping", "news"],
    toolIds: ["daily.lookup"],
    connections: [
      { id: "drive", label: "구글 드라이브 · 브랜드 자료·참고 화면", neededFor: "optional" },
      aiConnection,
    ],
    approvalRequired: ["시안 외부 게시·공유", "브랜드 기준 확정", "기존 파일 덮어쓰기"],
    canDo: [
      "화면 시안과 개발 인계 명세 작성",
      "작은 화면·접근성 점검표 만들기",
      "색·글자·간격 기준을 디자인 토큰으로 정리",
      "전시·공연 소식과 상품 가격·뉴스 조회",
    ],
    cannotDo: [
      "생성 도구 없이 이미지를 만들었다고 하지 않아요",
      "승인 없이 게시·배포하지 않아요",
      "메일함을 열지 않아요",
    ],
    firstTasks: [
      { label: "첫 화면 시안", prompt: "이 서비스 첫 화면의 디자인 시안과 화면 명세를 만들어 줘" },
      { label: "접근성 점검", prompt: "이 화면의 작은 화면·접근성 문제를 점검해 고칠 순서를 정해 줘" },
    ],
    recipes: [recipes.recursiveOutline, recipes.feedbackPriority, recipes.compareTable],
  },
  {
    roleId: "software-engineer",
    label: "소프트웨어 개발 전문가",
    // public: 도메인·IP·AS 소유 정보(kr-whois-lookup) — 배포·장애 확인에 쓴다.
    dailySkillCategories: ["news", "public"],
    toolIds: ["daily.lookup"],
    connections: [aiConnection],
    approvalRequired: ["배포", "파일·데이터 삭제", "자격 증명 변경"],
    canDo: [
      "오류 재현 절차와 원인 가설 정리",
      "최소 수정안과 테스트 방법 작성",
      "개발 작업 쪼개기와 작업량 산정",
      "개발 관련 뉴스와 도메인·IP 소유 정보 조회",
    ],
    cannotDo: [
      "실행해 보지 않은 테스트를 통과했다고 말하지 않아요",
      "비밀값을 코드나 로그에 넣지 않아요",
      "승인 없이 배포하지 않아요",
    ],
    firstTasks: [
      { label: "오류 재현·수정안", prompt: "이 오류를 재현하고 최소 수정안과 테스트 방법을 만들어 줘" },
      { label: "작업 쪼개기", prompt: "이 기능을 구현 작업과 테스트 항목으로 쪼개고 작업량을 산정해 줘" },
    ],
    recipes: [recipes.devBreakdown, recipes.effortEstimate],
  },
  {
    roleId: "finance-analyst",
    label: "재무·세무 전문가",
    dailySkillCategories: ["finance", "public", "legal"],
    toolIds: ["daily.lookup"],
    connections: [
      { id: "drive", label: "구글 드라이브 · 증빙 파일 학습용", neededFor: "optional" },
      aiConnection,
    ],
    approvalRequired: ["송금·지급·거래 확정", "회계 장부 수정", "세금 신고·납부·기관 제출", "증빙 파일 이동·삭제"],
    canDo: [
      "원장·청구서·입금 내역 대사와 차이표 작성",
      "합계·수수료·세금·환율 계산 검산",
      "현금흐름 시나리오와 자금 부족 시점 표시",
      "증빙 분류와 중복·누락·합계 불일치 표시",
      "세무 안내문 요약과 세무사 질문 목록 작성",
    ],
    cannotDo: [
      "송금·장부 수정·신고·납부를 하지 않아요",
      "공제·비용 인정 여부를 확정하지 않아요(세무사 확인)",
      "세무 자격을 사칭하지 않아요",
      "메일함을 열지 않아요",
    ],
    firstTasks: [
      { label: "정산 대사", prompt: "이 정산표를 대사하고 미수금과 현금흐름을 정리해 줘" },
      { label: "분기 증빙 정리", prompt: "이번 분기 세무 증빙을 분류하고 세무사에게 물을 항목을 정리해 줘" },
    ],
    recipes: [recipes.financeReconcileTable, recipes.compareTable, recipes.taxEvidenceTable, recipes.taxNoticeSummary],
  },
  {
    roleId: "contract-reviewer",
    label: "계약 검토 전문가",
    dailySkillCategories: ["legal", "public"],
    toolIds: ["daily.lookup"],
    connections: [aiConnection],
    approvalRequired: ["계약서 원문 수정", "계약 체결·서명", "상대방에 수정안 발송"],
    canDo: [
      "조항별 위험과 우선순위 정리",
      "원문·수정 문구·이유를 비교한 수정안 작성",
      "협상 질문과 전문가 확인 항목 정리",
      "법령·사업자 상태 같은 공공 정보 조회",
    ],
    cannotDo: [
      "법적 효력을 단정하지 않아요(법률 자문 아님)",
      "없는 조문·판례를 근거로 들지 않아요",
      "승인 없이 계약을 체결하거나 원문을 고치지 않아요",
    ],
    firstTasks: [
      { label: "불리한 조항 찾기", prompt: "이 계약서의 불리한 조항과 수정 제안을 근거와 함께 정리해 줘" },
      { label: "수정안 비교표", prompt: "고치고 싶은 조항의 원문과 수정 문구를 비교표로 만들어 줘" },
    ],
    recipes: [recipes.contractCheck, recipes.contractRedline],
  },
  {
    roleId: "people-operations",
    label: "인사·조직 운영 전문가",
    dailySkillCategories: ["legal", "public"],
    toolIds: [...readDraftMailTools, "daily.lookup"],
    connections: [
      { id: "mail", label: "메일 · 지원자 연락 확인", neededFor: "optional" },
      { id: "calendar", label: "캘린더 · 면접 일정 확인", neededFor: "optional" },
      aiConnection,
    ],
    approvalRequired: ["채용 결과 통보", "면접 일정 확정", "보상·근로 조건 안내"],
    canDo: [
      "채용 공고·면접 평가표·온보딩 계획 작성",
      "면접 기록을 역량 근거 중심으로 정리",
      "지원자 메일 검색·열람과 안내 메일 초안 작성",
      "노동 관련 법령·공공 정보 조회",
    ],
    cannotDo: [
      "채용·해고·보상 결정을 대신 확정하지 않아요",
      "나이·출신처럼 직무와 무관한 정보로 평가하지 않아요",
      "승인 없이 지원자에게 연락하지 않아요",
    ],
    firstTasks: [
      { label: "채용 공고와 평가표", prompt: "이 직무의 채용 공고와 면접 평가표·온보딩 계획을 만들어 줘" },
      { label: "면접 기록 정리", prompt: "이 면접 기록을 평가 기준별 근거와 다음 질문으로 정리해 줘" },
    ],
    recipes: [recipes.interviewNotes, recipes.onboardingOutline],
  },
  {
    roleId: "procurement-specialist",
    label: "구매·재고 전문가",
    dailySkillCategories: ["shopping", "public", "food"],
    toolIds: [...readDraftMailTools, "daily.lookup"],
    connections: [
      { id: "mail", label: "메일 · 공급사 견적 확인", neededFor: "optional" },
      aiConnection,
    ],
    approvalRequired: ["실제 주문·발주", "대금 지급", "재고 수량 확정 변경"],
    canDo: [
      "견적을 총비용·납기 기준으로 비교",
      "재고·소요량으로 발주량 계산",
      "공급사 견적 메일 검색·열람과 문의 메일 초안 작성",
      "상품 가격·농수산물 시세·공공 조달 공고 조회",
    ],
    cannotDo: [
      "승인 없이 주문하거나 대금을 지급하지 않아요",
      "규격이 다른 견적을 같은 것으로 보지 않아요",
      "재고 수치를 임의로 고치지 않아요",
    ],
    firstTasks: [
      { label: "견적 비교·발주안", prompt: "이 견적들을 총비용과 납기 기준으로 비교하고 발주안을 만들어 줘" },
      {
        label: "공급사 견적 메일 정리",
        prompt: "최근 공급사 견적 메일에서 단가·납기·유효기간을 표로 정리해 줘",
        requiresConnection: "mail",
        fallbackPrompt: "아래에 붙여 넣은 견적 메일에서 단가·납기·유효기간을 표로 정리해 줘",
      },
    ],
    recipes: [recipes.quoteCompare, recipes.tableExtract],
  },
];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export const roleCapabilities: readonly ModyRoleCapability[] = deepFreeze(capabilityList);

const capabilityById = new Map<string, ModyRoleCapability>(roleCapabilities.map((capability) => [capability.roleId, capability]));

/** 직접 만든 직원·알 수 없는 직원의 안전한 기본값. 일상 도구는 생활·날씨·뉴스만 연다. */
export const customRoleCapability: ModyRoleCapability = deepFreeze({
  roleId: customRoleId,
  label: "직접 만든 직원",
  dailySkillCategories: ["life", "weather", "news"],
  toolIds: ["daily.lookup"],
  connections: [aiConnection],
  approvalRequired: ["메일 발송", "일정 등록", "파일 변경·삭제", "결제·외부 제출"],
  canDo: ["사용자가 정한 역할과 지침대로 초안·정리", "날씨·생활·뉴스 정보 조회"],
  cannotDo: ["승인 없이 외부로 보내거나 등록하지 않아요", "맡지 않은 업무의 도구를 쓰지 않아요"],
  firstTasks: [{ label: "맡길 일 정리", prompt: "내가 맡길 일을 목표·결과물·기한으로 정리하고 필요한 자료를 물어봐 줘" }],
  recipes: [recipes.summaryMicro, recipes.polishWriting],
} satisfies ModyRoleCapability);

/** 직접 만든 직원이 메일 문의·일정 조율 업무를 맡았을 때. 지금의 업무 종류 게이팅과 같은 메일 권한이다. */
const customMailRoleCapability: ModyRoleCapability = deepFreeze({
  ...customRoleCapability,
  toolIds: [...allMailTools, "daily.lookup"],
  connections: [{ id: "mail", label: "메일", neededFor: "optional" }, aiConnection],
  canDo: [...customRoleCapability.canDo, "맡은 메일 업무의 검색·열람과 답장 초안 작성"],
  cannotDo: ["승인 없이 메일을 보내거나 일정을 등록하지 않아요", "맡지 않은 업무의 도구를 쓰지 않아요"],
} satisfies ModyRoleCapability);

export function getRoleCapability(roleId: string | undefined | null): ModyRoleCapability | undefined {
  const id = typeof roleId === "string" ? roleId.trim() : "";
  // 통합 전 직무 id(예: pr-manager)로 물어도 합쳐진 직무 정본을 돌려준다.
  return id ? capabilityById.get(id) ?? capabilityById.get(resolveBuiltinExpertId(id)) : undefined;
}

/**
 * 직원 → 역할 정본. 기본 전문가 판정은 builtin-experts 의 getBuiltinExpert 와 같다(예약 id·표식 복원).
 * 모르는 직원은 customRoleCapability(일상 도구 전체 허용 아님). 직접 만든 직원이 메일 업무 종류를
 * 맡았으면(workPackIds·템플릿 기본값) 지금과 같은 메일 도구를 유지한다.
 */
export function resolveTeammateRoleCapability(
  teammate: { id?: string; builtinExpertId?: string; templateId?: string; workPackIds?: readonly string[] } | null | undefined,
): ModyRoleCapability {
  if (!teammate || typeof teammate !== "object") return customRoleCapability;
  const expert = getBuiltinExpert(teammate);
  const builtin = expert ? capabilityById.get(expert.id) : undefined;
  if (builtin) return builtin;
  const workPackIds = resolveModyTeammateWorkPackIds({
    ...(typeof teammate.templateId === "string" ? { templateId: teammate.templateId } : {}),
    ...(Array.isArray(teammate.workPackIds) ? { workPackIds: teammate.workPackIds } : {}),
  });
  return workPackIds.some((workPackId) => mailWorkPackIds.has(workPackId)) ? customMailRoleCapability : customRoleCapability;
}

/** 연결 상태에 맞는 첫 업무. 필요한 연결이 "missing" 으로 확인될 때만 대체 요청을 쓴다(모르면 원래 요청). */
export function resolveRoleFirstTasks(
  capability: ModyRoleCapability,
  connections?: ModyRoleConnectionState,
): ModyResolvedRoleFirstTask[] {
  return capability.firstTasks.map((task) => {
    const required = task.requiresConnection;
    const usedFallback = Boolean(required && connections?.[required] === "missing" && task.fallbackPrompt);
    return {
      label: task.label,
      prompt: usedFallback && task.fallbackPrompt ? task.fallbackPrompt : task.prompt,
      usedFallback,
      ...(required ? { requiresConnection: required } : {}),
    };
  });
}

/** 화면용: 이 역할이 일상 도구에서 볼 수 있는 분류. */
export function describeRoleDailySkillCategories(capability: ModyRoleCapability): string {
  if (capability.dailySkillCategories === "all") return "전체 분류";
  return capability.dailySkillCategories.map((id) => modyDailySkillCategoryLabels[id]).join("·");
}

/** 화면용: 공용 도구 외에 이 역할이 여는 도구를 쉬운 말로. */
export function describeRoleTools(capability: ModyRoleCapability): string[] {
  const labels = capability.toolIds
    .filter((id) => id !== "daily.lookup")
    .map((id) => toolLabels[id])
    .filter((label): label is string => Boolean(label));
  if (capability.toolIds.includes("daily.lookup")) {
    labels.push("일상 정보 조회(" + describeRoleDailySkillCategories(capability) + ")");
  }
  return labels;
}

function compactText(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, "");
}

function scoreRecipe(recipe: ModyRoleRecipe, compactRequest: string): number {
  let score = 0;
  const seen = new Set<string>();
  for (const keyword of recipe.keywords) {
    const key = compactText(keyword);
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    if (compactRequest.includes(key)) score += key.length >= 3 ? 3 : 2;
  }
  return score;
}

/**
 * 요청 문장과 맞는 레시피를 최대 limit(기본 2, 1~4)개 골라 모델 프롬프트용 한국어 블록을 만든다.
 * 이 직무가 꺼내 쓰는 크루 스킬(crew-skills.ts) 중 요청과 맞는 것이 있으면 뒤에 붙인다 — 채팅 실행이
 * 이 함수 하나로 레시피와 크루 스킬을 함께 받는다. 맞는 것이 없거나 요청이 비면 "" — 프롬프트를 늘리지 않는다.
 */
export function formatRoleRecipesForPrompt(capability: ModyRoleCapability, requestText?: string, limit?: number): string {
  const compactRequest = compactText(String(requestText ?? ""));
  if (!capability || !Array.isArray(capability.recipes) || !compactRequest) return "";
  const requested = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : 2;
  const max = Math.max(1, Math.min(4, requested || 2));
  const ranked = capability.recipes
    .map((recipe, index) => ({ recipe, index, score: scoreRecipe(recipe, compactRequest) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max);
  const crewSkillBlock = formatCrewSkillsForPrompt(capability.roleId, requestText);
  if (!ranked.length) return crewSkillBlock;
  const lines = [
    "[업무 레시피 · " + capability.label + "]",
    "요청에 맞는 작업 형식입니다. 사용자 요청과 받은 자료가 우선이며, 자료에 없는 내용은 지어내지 말고 '확인 필요'로 표시하세요.",
  ];
  ranked.forEach(({ recipe }, order) => {
    lines.push(
      String(order + 1) + ") " + recipe.label + " — " + recipe.whenToUse,
      "- 받을 자료: " + recipe.inputHint,
      "- 작업 방법: " + recipe.promptTemplate,
      "- 결과 구성: " + recipe.outputFormat.join(" → "),
    );
  });
  return [lines.join("\n"), crewSkillBlock].filter(Boolean).join("\n\n");
}
