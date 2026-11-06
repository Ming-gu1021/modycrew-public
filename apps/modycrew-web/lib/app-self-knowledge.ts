/**
 * 앱 자기지식(app self-knowledge) — 채팅 답변 프롬프트에 넣는 "ModyCrew가 무엇이고 무엇을 하는지" 블록.
 *
 * 목적: 사용자가 "이 앱 뭐야 / 뭘 할 수 있어 / 승인함이 뭐야" 같은 질문을 하면
 *       모델이 추측하지 않고 이 내용을 근거로 정확히(맞춤형으로) 답하게 한다.
 *
 * 원칙:
 *  - 제품 개요·주요 화면·실행 경계는 안정적으로 항상 포함(사실 기반)
 *  - 현재 요청과 관련된 "바로 열 수 있는 기능"만 몇 개 덧붙여 프롬프트 비대화 방지
 *  - **못 하는 일도 함께 넣는다.** 할 수 있는 것만 알려주면 모델은 나머지를 자기
 *    일반 지식으로 메운다(아래 APP_CANNOT 주석 참고)
 *  - 여기는 서술만: 실제 실행은 page.tsx 의 액션/커넥터 해석기가 담당
 */

import { getCapabilityRegistry, type CapabilityEntry } from "./capability-registry";

/** ModyCrew 공식 제품 한 문단 소개 (legal/page.tsx '제품 안내'와 동일 결의 단일 소스). */
export const MODYCREW_PRODUCT_OVERVIEW =
  "ModyCrew는 메일·일정·파일·문서·보고서·승인 업무를 대신 정리해 주는 한국형 AI 업무 오피스(설치형 Windows 데스크톱 앱)입니다. 사용자가 하고 싶은 일을 한 문장으로 맡기면 담당 AI 직원이 자료를 읽고 초안과 후보 작업을 만들며, 실제 발송·등록·삭제 같은 실행은 항상 승인함에서 사용자가 확인한 뒤에만 진행합니다.";

/** 사용자가 앱/기능/할 수 있는 일을 물을 때 근거로 삼는 주요 화면·기능 (안정 목록). */
const APP_SURFACES: Array<{ name: string; desc: string }> = [
  { name: "회사 운영 (/automation)", desc: "기존 회사 문서·장부를 원본 사본과 버전으로 보관하고 부서별 읽기 자료를 지정. 부서가 영속 실행기에서 업무를 처리하고 마스터가 결과를 취합. 입출금 장부는 원본 열·행과 금액을 검토한 뒤 사용자 선택으로 반영. 시간·업무 메일·메신저 조건으로 반복 업무 실행" },
  { name: "메신저 자동 설정", desc: "회사 운영의 메일·메신저에서 공식 로그인·앱 생성 단계를 보조하고 발급 정보를 보안 저장소에 연결. Telegram 관리 봇 생성과 그룹 초대, Discord·Slack 선택 채널 수신, LINE·WhatsApp·Zalo의 서명 검증 웹훅 지원. 공개 수신 서버는 사용자 Cloudflare 계정과 생성 승인이 필요. 계정 인증과 실제 수신 상태는 별도. 카카오 일반 단톡 전체를 읽는 공개 수신 API는 확인되지 않아 지원 완료로 답하지 말 것" },
  { name: "채팅 작업실(홈)", desc: "하고 싶은 일을 한 문장으로 맡기면 담당 AI 직원이 이어받는 기본 화면" },
  { name: "이미지·홍보물 만들기", desc: "포스터·홍보물·SNS 카드·배너·썸네일·로고 시안을 모디크루 디자인 크루가 실제 이미지 파일로 만들어 결과 폴더(D:\\ModyCrew 결과 등)에 저장. GPT(ChatGPT 계정)나 Gemini 연결이 필요하며, 없으면 연결을 시작" },
  { name: "AI 직원(팀원)", desc: "메일·문서·일정·정산 등 역할별 AI 직원을 만들어 각자 업무를 맡김" },
  { name: "업무판", desc: "업무 목표를 맡기고 진행·결과를 확인. 질문에 답하면 같은 업무를 이어서 처리하며, 실패 시 다시 시도하거나 일시 중지할 수 있음" },
  { name: "가상 오피스", desc: "내 AI 직원이 지금 무슨 일을 하는지 캐릭터로 실시간 보여주는 장면" },
  { name: "직원 워크플로우 칸", desc: "직원별로 맡은 폴더 지정→읽고 학습→정리안→파일 찾기·반복 업무를 한 곳에서" },
  { name: "승인함", desc: "메일 발송·일정 등록·파일 변경 등 실행 전 작업을 모아두고 사용자가 최종 승인" },
  { name: "연결(커넥터)", desc: "메일(일반 IMAP·Gmail·Outlook)·캘린더·메신저·AI를 로그인/자격증명으로 연결" },
  { name: "메일 점검", desc: "연결한 메일을 읽어 분류·요약하고 답장 초안을 준비(발송은 승인 후)" },
  { name: "폴더 학습·자동 정리", desc: "지정한 폴더를 읽어 업무 방식을 학습하고 정리안을 만듦(이동은 승인 후)" },
  { name: "로컬 기억", desc: "호칭·업무 방식·지난 업무를 사용자가 고른 위치에 저장해 다음에도 이어감" },
  { name: "일상 도구", desc: "날씨·지하철·장소/길찾기·공휴일·법령/판례·국회 법안·부동산 실거래가·의약품·공연·도서관·뉴스 같은 실시간 공개 정보 23종을 채팅에서 바로 조회(읽기 전용, 답변에 출처·조회 시각 표시). 주식 시세·쇼핑 가격 조회는 아직 없음. 업무 도구 화면에서 켜고 끄며, 직원마다 맡은 일에 맞는 분류만 씀. 설치된 Windows 앱에서 동작" },
  { name: "반복 업무(자동화)", desc: "업무판에서 시작 시간과 매일·매주 반복을 지정. 앱이 켜져 있을 때 실행하며 놓친 일정은 다시 켠 뒤 한 번 처리. 발송·등록은 별도 최종 승인 필요" },
];

   
                                                        
  
                
                                                             
                                                      
                                                  
                                                
  
                                                      
                                                    
  
                                        
   
const APP_CANNOT: Array<{ what: string; instead: string }> = [
  {
    what: "영상·음성·음악 만들기",
    instead: "대신 대본과 진행 순서를 글로 만들어 드립니다.",
  },
  {
    what: "일반 인터넷 검색·웹페이지 열람",
    instead: "일상 도구에 있는 공개 정보는 도구가 켜져 있고 조회가 성공한 경우 출처와 함께 보여줄 수 있습니다. 로컬 학습 문서는 화면에서 검색·열람할 수 있지만, 채팅에 자동으로 제공하는 기능은 현재 보류 중입니다. 메일 사용도 연결과 실제 조회 결과를 확인해야 합니다.",
  },
];

   
                                                                           
                                                              
                                           
   
const IMAGE_STUDIO_GUIDE =
  "[이미지·홍보물] 그림·포스터·홍보물·배너·썸네일·로고 시안·일러스트는 모디크루 디자인 크루가 실제 이미지 파일로 만든다. studio.image.generate 도구를 바로 부를 것. 실행기·저장 폴더는 앱이 고르니 사용자에게 묻지 말 것. GPT·Gemini 연결이 없으면 도구가 연결을 시작한다. 흉내(글자로 그린 그림·가짜 파일 경로)나 글로 된 시안 설명으로 대신하지 말고, 결과 파일이 생기기 전에는 만들었다고 쓰지 말 것.";

/** 실행 경계 — 답변이 이 경계를 지키고, 사용자가 물으면 정확히 설명. */
const APP_BOUNDARIES: string[] = [
  "새 문서 제작은 왼쪽 문서 메뉴(/documents)에서 자료 입력·양식 선택·초안 검토·파일 저장 순서로 진행합니다. DOCX·PPTX·XLSX·PDF·HWPX를 만들며 HWP 저장은 설치된 한글이 필요합니다. 회사 양식은 원본 사본에서 지정한 칸만 채웁니다. 채팅 답변만으로 파일 저장이 완료됐다고 말하지 않습니다.",
  "외부 발송(메일·메신저), 일정 등록, 파일 삭제·이동·대량 변경, 외부 공유·제출은 승인 전에 실행하지 않습니다.",
  "메일은 읽기 우선이고, 답장·발송은 승인함에서 확인한 뒤에만 나갑니다.",
  "업무 질문에 답하거나 예약을 등록하는 것은 외부 발송·일정 등록의 최종 승인이 아닙니다. 업무판의 자동 실행은 자료 확인과 초안 준비까지만 합니다.",
  "비밀번호·API 키·토큰은 채팅에 쓰지 않고 연결 창/계정 보관함에만 입력하며 OS 보안 저장소로 암호화합니다.",
  "AI가 만든 답변·초안·분류는 틀릴 수 있어 중요한 실행 전에는 사용자가 확인합니다.",
  "AI 연결 방식과 실제 사용 가능 여부는 선택한 제공자와 연결 상태에 따라 다릅니다. 로그인만으로 모든 기능이 준비되었다고 말하지 말고 연결 화면에서 확인합니다. 폴더·메일 작업은 설치된 Windows 앱과 필요한 연결이 있어야 합니다.",
];

function rankRelevantCapabilities(text: string, limit: number): CapabilityEntry[] {
  const lower = String(text ?? "").toLowerCase();
  if (!lower.trim()) return [];
  const scored: Array<{ entry: CapabilityEntry; score: number }> = [];
  for (const entry of getCapabilityRegistry()) {
    let score = 0;
    for (const hint of entry.triggerHints) {
      const normalized = hint.toLowerCase().trim();
      if (normalized.length >= 2 && lower.includes(normalized)) score += 3;
    }
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || b.entry.weight - a.entry.weight);
  return scored.slice(0, limit).map((item) => item.entry);
}

/**
 * 앱 이름을 대지 않고 **비서 자신에게** 능력을 묻는 말인지.
 *
 * "이 앱 뭐 할 수 있어?" 만 잡고 "너 뭐 할 수 있어?" 를 놓치면 가장 자연스러운
 * 말투가 통째로 빠진다. 실제로 이 빈틈 때문에 앱 정보가 하나도 안 들어간 채
 * 모델이 자기 일반 지식으로 답했다.
 */
function asksAssistantCapability(normalized: string): boolean {
  const toAssistant =
    /(?:^|\s)(?:너|넌|너는|네가|니가|당신|자네)\s*[^?]{0,24}?(?:할\s*수\s*있|만들\s*수\s*있|그릴\s*수\s*있|가능(?:해|한가|합니|하니)|되(?:나요|니|는지))/u;
  const bareCapability = /(?:뭐|무엇|어떤\s*(?:걸|것|일|기능|업무))\s*[^?]{0,16}?(?:할\s*수\s*있|가능)/u;
  return toAssistant.test(normalized) || bareCapability.test(normalized);
}

/**
 * **못 하는 일을 부탁하는 말**인지. 질문형이 아니라 명령형도 잡아야 한다.
 *
 * ASCII 강아지 사고는 질문("만들어줄 수 있어?")이 아니라 부탁("리트리버 그려줘")에서
 * 났다. 부탁을 놓치면 모델은 거절 대신 **흉내**를 낸다.
 */
function asksImageCreation(normalized: string): boolean {
  const image =
    /(?:이미지|그림|사진|일러스트|로고|포스터|썸네일|아이콘|홍보물|배너|전단)\s*(?:를|을|도|좀|하나)?\s*(?:만들|생성|그려|그리|제작|뽑아|출력|디자인)/u;
  // "리트리버 그려줘" 처럼 **대상이 그림 낱말이 아닌** 부탁도 그리기 동사로 잡는다(ASCII 강아지 사고의 모양).
  const drawVerb = /(?:그려\s*(?:줘|주세요|주라|봐|볼래)?|그리기|드로잉|스케치)/u;
  // 단, 표·목록은 글로 그릴 수 있다 — 채팅에서 바로 하는 일이라 이미지 도구로 보내지 않는다.
  const textualDraw = /(?:표|도표|목록|리스트|목차|개요|순서도)[^.!?]{0,14}?(?:그려|그리|만들)/u;
  return image.test(normalized) || (drawVerb.test(normalized) && !textualDraw.test(normalized));
}

   
                                                          
                                                                     
   
function asksUnavailableCapability(normalized: string): boolean {
  const media =
    /(?:영상|동영상|비디오|음성|목소리|노래|음악|더빙)\s*(?:를|을|도|좀|하나)?\s*(?:만들|생성|제작|뽑아|녹음|합성)/u;
  const web = /(?:인터넷|구글|웹|온라인)\s*(?:에서|으로)?\s*(?:검색|찾아)/u;
  return media.test(normalized) || web.test(normalized);
}

function isAppSelfKnowledgeQuestion(text: string): boolean {
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim().toLowerCase();
  if (!normalized) return false;
  const appQuestion =
    /(?:modycrew|모디크루|이 앱|우리 앱).*(?:뭐|무엇|어떤|기능|할 수|설명|어떻게|왜)|(?:뭐|무엇|어떤|기능|할 수|설명).*(?:modycrew|모디크루|이 앱|우리 앱)/u.test(normalized);
  const surfaceQuestion =
    /(?:승인함|업무판|반복\s*업무|예약\s*업무|가상\s*오피스|ai\s*직원|ai\s*팀원|커넥터|연결\s*화면|로컬\s*기억|채팅\s*작업실).*(?:뭐|무엇|어떤|뜻|설명|어떻게|왜|용도)/u.test(normalized);
  return appQuestion || surfaceQuestion || asksAssistantCapability(normalized) || asksUnavailableCapability(normalized) || asksImageCreation(normalized);
}

   
                                   
                                                   
                                                
   
export function buildAppSelfKnowledgePromptContext(text = "", relevantLimit = 3): string {
  if (!isAppSelfKnowledgeQuestion(text)) return "";
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim().toLowerCase();
  const asksOverview =
    /뭘\s*할\s*수|무엇을\s*할\s*수|기능|무슨\s*앱|뭐\s*하는\s*앱/u.test(normalized) || asksAssistantCapability(normalized);
  const asksSafety = /승인|안전|보안|실행|발송|삭제|권한|비밀번호|토큰/u.test(normalized);
  const wantsUnavailable = asksUnavailableCapability(normalized);
  const wantsImage = asksImageCreation(normalized);
  const relevant = rankRelevantCapabilities(text, relevantLimit);
  const primarySurfaces = asksOverview
    ? APP_SURFACES.filter((surface) => surface.name !== "연결(커넥터)" && surface.name !== "로컬 기억").slice(0, 6)
    : APP_SURFACES.filter((surface) => normalized.includes(surface.name.replace(/\(.+?\)/gu, "").toLowerCase())).slice(0, 2);
  const lines: string[] = [
    "[ModyCrew 앱 소개 — 앱·기능·할 수 있는 일을 물으면 아래를 근거로 정확히 설명하고, 모르면 추측하지 말 것]",
    MODYCREW_PRODUCT_OVERVIEW,
  ];
  if (primarySurfaces.length) {
    lines.push(asksOverview ? "대표적으로 맡길 수 있는 일:" : "질문한 화면:");
    for (const surface of primarySurfaces) lines.push(`- ${surface.name}: ${surface.desc}`);
  }
  if (relevant.length) {
    lines.push("질문과 직접 관련된 기능:");
    for (const entry of relevant) lines.push(`- ${entry.label}: ${entry.oneLineDesc}`);
  }
  if (wantsImage) lines.push(IMAGE_STUDIO_GUIDE);
  // 못 하는 일은 능력을 묻거나 못 하는 일을 부탁할 때만 넣는다. 항상 넣으면 프롬프트가
  // 커지고, "안 되는 것" 이야기가 관계없는 답변에까지 새어 나온다.
  if (asksOverview || wantsUnavailable) {
    lines.push(
      wantsUnavailable
        ? "[중요] 사용자가 방금 부탁한 것은 이 앱에서 **안 되는 일일 수 있다.** 아래에 해당하면 할 수 있는 척하지 말고, 안 된다고 분명히 말한 뒤 '대신' 쪽을 제안할 것. 흉내(글자로 그린 그림·가짜 링크·가짜 파일 경로)를 만들어 내지 말 것:"
        : "지금 이 앱에서 안 되는 일 (있는 척하지 말 것):",
    );
    for (const item of APP_CANNOT) lines.push(`- ${item.what} — ${item.instead}`);
  }
  if (asksSafety) {
    lines.push("필요한 실행 경계:", ...APP_BOUNDARIES.map((line) => `- ${line}`));
  }
  return lines.join("\n");
}
