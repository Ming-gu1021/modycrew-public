   
                                   
  
                                                                             
                                                                      
                                                             
  
                                                                                       
                                                                          
                                                                            
                                                                  
   

export type ExpertRoutingTeammate = { id: string; name: string };

export type ExpertRoutePick<T extends ExpertRoutingTeammate> = {
  teammate: T;
  /** 기본 전문가 정본 id. 사용자가 직접 만든 직원을 이름으로 부른 경우에는 빈 문자열. */
  expertId: string;
  score: number;
  reasons: string[];
  named: boolean;
};

export type ExpertRoute<T extends ExpertRoutingTeammate> = {
  contract: "modycrew.expert.route.v1";
  /** single: 한 명이 맡는다 · multiple: 사용자가 나눠 맡기라고 했거나 여러 명을 불렀다 · none: 비서가 직접 처리한다 */
  decision: "none" | "single" | "multiple";
  picks: ExpertRoutePick<T>[];
  /** 요청에 가장 맞지만 아직 고용하지 않은 전문가(채용 안내용). */
  unhiredExpertIds: string[];
  named: boolean;
  split: boolean;
};

type Signal = { pattern: RegExp; weight: number; reason: string };
const signal = (pattern: RegExp, weight: number, reason: string): Signal => ({ pattern, weight, reason });

/** 한 분야로 인정하는 최소 점수. 강한 신호(5) 하나나 중간 신호(4) 하나면 된다. */
export const expertRouteMinScore = 4;

   
                                                        
                                                            
                                                                               
                                                        
                                            
   
export const expertRouteSignals: Readonly<Record<string, readonly Signal[]>> = Object.freeze({
  "mail-secretary": [
    signal(/메일|이메일|메일함|받은\s*편지|답장|회신|gmail|outlook/iu, 5, "메일·답장"),
    signal(/고객\s*문의|문의\s*(?:답변|응대|정리|확인|처리)|클레임|민원|\bcs\b/iu, 4, "고객 문의 응대"),
    signal(/(?:미팅|회의|약속|상담)\s*(?:일정|시간)?\s*(?:을|를)?\s*(?:잡|조율|정해|맞춰)|일정\s*(?:을|를)?\s*(?:잡|조율)|캘린더/u, 3, "일정 조율"),
  ],
  "document-writer": [
    signal(/회의록|공문|인수\s*인계|품의서|결재\s*문서|업무\s*보고서|사업\s*계획서|신청서|안내문/u, 5, "공식 문서 작성"),
    signal(/워드|\bword\b|한글\s*(?:파일|문서)|hwp|ppt|피피티|발표\s*자료|양식에?\s*맞|서식/iu, 4, "문서 형식"),
    signal(/문서|보고서|요약본/u, 2, "문서 정리"),
  ],
  "research-assistant": [
    signal(/조사|리서치|경쟁사|시장\s*(?:규모|동향|현황)|트렌드|동향|사례\s*(?:를|을)?\s*(?:찾|조사)|벤치마킹/u, 5, "자료 조사"),
    signal(/비교\s*(?:표|분석)|통계|데이터\s*(?:분석|정리)|설문|지표\s*분석|출처|근거\s*(?:를|을)?\s*(?:찾|확인)/u, 4, "비교·데이터 분석"),
  ],
  "work-manager": [
    signal(/프로젝트\s*(?:일정|계획|관리|진행)|업무\s*(?:목록|분배|배정|계획)|우선\s*순위|진행\s*(?:상황|관리)|일정\s*계획|간트|\bwbs\b|마일스톤|체크\s*리스트/iu, 4, "업무·일정 관리"),
    signal(/pc\s*(?:작업|조작)|내\s*(?:pc|컴퓨터)|바탕\s*화면|폴더\s*정리|파일\s*정리|열린\s*창|(?:앱|프로그램)\s*(?:조작|실행)/iu, 5, "PC·파일 작업"),
  ],
  "sales-consultant": [
    signal(/견적서|견적\s*(?:을|를)?\s*(?:작성|계산|산출|내|뽑)|제안서|영업|세일즈|수주|입찰|\bb2b\b|단가\s*제안/iu, 5, "영업·견적·제안"),
    // 잠재 고객·리드 발굴은 B2B 고객개발 전문가의 일이라 여기서 뺐다. 기존 고객사·거래처 대응과 리드 관리만 남긴다.
    signal(/고객사|거래처|리드\s*관리/u, 3, "고객사 대응"),
  ],
  "b2b-customer-developer": [
    // 'B2B'만으로는 영업(지훈)과 나뉘지 않으므로 잠재 고객·발굴·기업 후보 같은 낱말로 본다. 리서치의 '조사'(5)와
    // 업무 관리의 '우선순위'(4)보다 뚜렷이 앞서도록 크게 준다.
    signal(/잠재\s*(?:고객|바이어)|고객\s*(?:개발|발굴)|(?:고객사|거래처|바이어)\s*(?:발굴|선별|후보|찾)|리드\s*(?:발굴|선별|조사|리스트|목록)|타깃\s*(?:기업|고객사)|기업\s*(?:고객|후보)|신규\s*(?:거래처|고객사)|아웃바운드\s*영업|프로스펙팅|prospect/iu, 8, "기업 잠재고객 발굴·선별"),
    signal(/접촉\s*(?:우선\s*순위|순서|대상)|고객\s*적합도|첫\s*제안/u, 3, "후보 근거·접촉 순서"),
  ],
  "growth-strategist": [
    signal(/마케팅|캠페인|광고|퍼널|전환율|유입|고객\s*획득|그로스|성장\s*전략|포지셔닝|타깃\s*고객|브랜딩/u, 5, "마케팅 전략"),
    signal(/출시\s*(?:전략|계획|준비)|가격\s*(?:전략|정책)/u, 3, "출시·가격 전략"),
  ],
  "b2c-customer-growth": [
    // 'B2C'만 있으면 약하게 본다('B2C 마케팅 캠페인'은 마케팅 몫). 고객군·코호트·가입 전환처럼 분석 낱말이 있어야 맡는다.
    // '이탈'은 고객 쪽만 본다('직원 이탈률'은 인사).
    signal(/\bb2c\b\s*(?:고객|사용자|회원|서비스|앱|전환|성장|그로스)|(?:개인|일반|소비자)\s*고객|고객\s*(?:군|세그먼트|성장)|코호트|(?<!(?:직원|인재)\s?)리텐션|재\s*구매\s*(?:율|률)|(?:고객|회원|사용자|가입자)\s*이탈|(?:회원\s*)?가입\s*(?:전환|실험|흐름|단계|이탈|률|율|장애)|활성\s*사용자|\bdau\b|\bmau\b|그로스\s*해킹/iu, 8, "개인 고객군·가입 전환 분석"),
    signal(/\bb2c\b|성장\s*실험|a\s*\/?\s*b\s*테스트|중단\s*기준|분모|익명\s*(?:고객|집계)/iu, 2, "성장 실험 설계"),
  ],
  "content-editor": [
    signal(/인스타|\bsns\b|블로그|유튜브|쇼츠|릴스|카드\s*뉴스|콘텐츠|게시물|카피|문구|해시태그|뉴스레터|보도\s*자료|홍보\s*글/iu, 5, "콘텐츠·홍보 글"),
    signal(/영상\s*(?:대본|편집|스크립트)|자막|캡션/u, 4, "영상 콘텐츠"),
  ],
  "product-planner": [
    signal(/기획|요구\s*사항|\bprd\b|기능\s*(?:정의|명세|아이디어|목록)|사용자\s*(?:시나리오|스토리|흐름)|로드맵|와이어\s*프레임|\bmvp\b|백로그|서비스\s*구조/iu, 5, "제품·서비스 기획"),
  ],
  "product-designer": [
    signal(/디자인|시안|로고|배너|포스터|썸네일|아이콘|일러스트|목업|랜딩\s*페이지|화면\s*(?:설계|구성)|\bui\b|\bux\b|홍보물|전단/iu, 5, "디자인·시안"),
  ],
  "software-engineer": [
    // '고객개발'의 '개발'은 코드 개발이 아니다.
    signal(/(?<!고객\s?)개발|코드|코딩|버그|배포|서버|\bapi\b|데이터베이스|스크립트|깃허브|github|리팩터|프로그램\s*(?:을|를)?\s*(?:만들|개발)|앱\s*(?:을|를)?\s*(?:개발|만들)|웹\s*(?:사이트|페이지)\s*(?:를|을)?\s*(?:만들|개발)/iu, 5, "개발·코드"),
    // '사과게임 만들고 실행해봐'처럼 실행되는 것을 만들어 달라는 말. '게임 홍보 콘텐츠 만들어'처럼 사이에 다른 말이 끼면 보지 않는다.
    signal(/(?:게임|어플|홈페이지|사이트|계산기|챗봇|봇|매크로|확장\s*프로그램|툴|도구)\s*(?:을|를|하나|좀|도)?\s*(?:만들|개발|제작|짜\s*(?:줘|봐|주))/u, 5, "실행되는 프로그램 제작"),
    signal(/오류\s*(?:수정|고쳐|원인)|에러|보안\s*(?:점검|취약)|취약점|리버스\s*엔지니어링|디컴파일|테스트\s*코드/u, 4, "오류·보안 점검"),
  ],
  "finance-analyst": [
    signal(/재무|회계|세무|세금|부가세|종합\s*소득세|원천세|정산|현금\s*흐름|손익|결산|장부|세금\s*계산서|영수증|경비|대사/u, 5, "재무·세무"),
    signal(/매출|매입|비용|예산|입출금|자금/u, 3, "금액 자료"),
  ],
  "contract-reviewer": [
    signal(/계약|약관|조항|\bnda\b|비밀\s*유지|법률|법령|법적|분쟁|위약|손해\s*배상|개인\s*정보\s*(?:처리|보호|방침)|규정\s*(?:검토|위반)/iu, 5, "계약·법률 검토"),
  ],
  "people-operations": [
    signal(/채용|면접|온보딩|입사|퇴사|인사\s*(?:평가|제도|규정|관리)|근태|연봉|직무\s*기술서|조직\s*(?:문화|개편|도)|교육\s*(?:계획|프로그램)|복리\s*후생/u, 5, "인사·채용"),
  ],
  "procurement-specialist": [
    signal(/발주|재고|구매|입고|출고|품목|자재|납기|공급\s*(?:처|업체|사)|협력\s*업체|단가\s*비교|견적\s*비교|받은\s*견적/u, 5, "구매·재고"),
  ],
  "securities-researcher": [
    // 증권 용어는 다른 분야와 거의 겹치지 않아 크게 준다('종목을 재무·뉴스로 검토'의 '재무'에 밀리지 않게). '주식회사'는 뺀다.
    signal(/종목|주가|주식(?!\s*회사)|증권|투자\s*(?:의견|가설|분석)|밸류에이션|\bper\b|\bpbr\b|차트\s*분석|공시(?!\s*지가)|\bdart\b|강세|약세|배당|\betf\b|시가\s*총액|코스피|코스닥|나스닥/iu, 8, "증권 리서치"),
  ],
});

/** '재무팀이랑', '문서 전문가한테'처럼 분야를 직접 부른 말. 이름만큼은 아니지만 강한 신호다. */
const roleMentionWeight = 8;
const roleMentions: ReadonlyArray<{ pattern: RegExp; expertId: string; reason: string }> = [
  { pattern: /메일|고객\s*응대/gu, expertId: "mail-secretary", reason: "메일 담당을 직접 부름" },
  { pattern: /문서/gu, expertId: "document-writer", reason: "문서 담당을 직접 부름" },
  { pattern: /리서치|조사|데이터\s*분석/gu, expertId: "research-assistant", reason: "리서치 담당을 직접 부름" },
  { pattern: /업무\s*관리|프로젝트\s*관리|\bpm\b|\bpc\b/giu, expertId: "work-manager", reason: "업무 관리 담당을 직접 부름" },
  { pattern: /영업/gu, expertId: "sales-consultant", reason: "영업 담당을 직접 부름" },
  { pattern: /고객\s*(?:개발|발굴)/gu, expertId: "b2b-customer-developer", reason: "고객개발 담당을 직접 부름" },
  { pattern: /마케팅/gu, expertId: "growth-strategist", reason: "마케팅 담당을 직접 부름" },
  { pattern: /고객\s*성장|\bb2c\b/giu, expertId: "b2c-customer-growth", reason: "고객성장 담당을 직접 부름" },
  { pattern: /콘텐츠|홍보/gu, expertId: "content-editor", reason: "콘텐츠 담당을 직접 부름" },
  { pattern: /기획/gu, expertId: "product-planner", reason: "기획 담당을 직접 부름" },
  { pattern: /디자인|디자이너/gu, expertId: "product-designer", reason: "디자인 담당을 직접 부름" },
  { pattern: /(?<!고객\s?)개발/gu, expertId: "software-engineer", reason: "개발 담당을 직접 부름" },
  { pattern: /재무|세무|회계/gu, expertId: "finance-analyst", reason: "재무 담당을 직접 부름" },
  { pattern: /계약|법무/gu, expertId: "contract-reviewer", reason: "계약 담당을 직접 부름" },
  { pattern: /인사|채용/gu, expertId: "people-operations", reason: "인사 담당을 직접 부름" },
  { pattern: /구매|재고/gu, expertId: "procurement-specialist", reason: "구매 담당을 직접 부름" },
  { pattern: /증권|투자/gu, expertId: "securities-researcher", reason: "증권 리서치 담당을 직접 부름" },
];
const roleMentionTail = /^\s*(?:전문가|담당자?|크루|직원|팀)/u;

/** 사용자가 여러 사람에게 나눠 맡기라고 한 말. 이 말이 없으면 섞인 요청을 쪼개지 않는다. */
export const expertSplitPattern =
  /나눠|나누어|분배|팀별|각\s*(?:팀|담당|직원|전문가)|여러\s*(?:명|팀)|병렬|(?:같이|함께)\s*(?:검토|보|볼|봐|맡|작업|처리|정리|만들|준비)|(?:와|과|이랑|랑|하고)\s*(?:같이|함께)/u;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^$(){}|[\]\\]/gu, "\\$&");
}

/** 이름을 맡기는 말과 함께 불렀는지. 앞 글자가 한글이면 다른 낱말의 일부로 본다('이지우'). */
export function mentionsTeammateName(text: string, name: string): boolean {
  const clean = String(name ?? "").replace(/\s+/gu, " ").trim();
  if (clean.length < 2) return false;
  const escaped = escapeRegExp(clean);
  const pattern = new RegExp(
    "(?:@" + escaped + ")|(?<![가-힣A-Za-z0-9])" + escaped +
      "(?:\\s*(?:님|씨)|한테|에게|께서?|이랑|랑|하고|\\s*(?:크루|직원|담당)|(?:아|야)(?=[\\s,!.?]|$)|\\s*[,:])",
    "u",
  );
  return pattern.test(String(text ?? ""));
}

export type ExpertRequestScore = { score: number; reasons: string[]; mentioned: boolean };

/** 전문가 id 별 점수와 근거. 분야를 직접 부른 말('재무팀이랑')이 있으면 크게 더하고 mentioned 로 표시한다. */
export function scoreExpertsForRequest(text: string): Map<string, ExpertRequestScore> {
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim();
  const scores = new Map<string, ExpertRequestScore>();
  if (!normalized) return scores;
  for (const [expertId, signals] of Object.entries(expertRouteSignals)) {
    let score = 0;
    const reasons: string[] = [];
    for (const item of signals) {
      if (!item.pattern.test(normalized)) continue;
      score += item.weight;
      if (!reasons.includes(item.reason)) reasons.push(item.reason);
    }
    if (score > 0) scores.set(expertId, { score, reasons, mentioned: false });
  }
  for (const mention of roleMentions) {
    let named = false;
    for (const match of normalized.matchAll(mention.pattern)) {
      if (roleMentionTail.test(normalized.slice((match.index ?? 0) + match[0].length))) { named = true; break; }
    }
    if (!named) continue;
    const current = scores.get(mention.expertId) ?? { score: 0, reasons: [], mentioned: false };
    current.score += roleMentionWeight;
    current.mentioned = true;
    if (!current.reasons.includes(mention.reason)) current.reasons.push(mention.reason);
    scores.set(mention.expertId, current);
  }
  return scores;
}

/**
 * 이 요청을 맡을 직원을 고른다. teammates 는 사무실에 있는(고용된) 직원 목록이고, excludeTeammateIds 는
 * 지금 대화의 직원(보통 업무 비서)처럼 후보에서 뺄 직원이다.
 */
export function routeRequestToExperts<T extends ExpertRoutingTeammate>(
  text: string,
  teammates: readonly T[],
  options: { resolveExpertId: (teammate: T) => string | undefined; excludeTeammateIds?: readonly string[]; maxPicks?: number },
): ExpertRoute<T> {
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim();
  const excluded = new Set(options.excludeTeammateIds ?? []);
  const maxPicks = Math.max(1, Math.min(4, options.maxPicks ?? 3));
  const scores = scoreExpertsForRequest(normalized);
  // '재무팀이랑 마케팅팀이 볼 예산'처럼 분야를 둘 이상 직접 부르면 나눠 맡기라는 뜻으로 본다.
  const split = expertSplitPattern.test(normalized) || [...scores.values()].filter((value) => value.mentioned).length >= 2;
  const empty: ExpertRoute<T> = { contract: "modycrew.expert.route.v1", decision: "none", picks: [], unhiredExpertIds: [], named: false, split };
  if (!normalized) return empty;

  const candidates = teammates.filter((teammate) => teammate && !excluded.has(teammate.id));
  const hiredByExpert = new Map<string, T>();
  for (const teammate of candidates) {
    const expertId = options.resolveExpertId(teammate) ?? "";
    if (expertId && expertId !== "personal-operator" && !hiredByExpert.has(expertId)) hiredByExpert.set(expertId, teammate);
  }
  const ranked = [...scores.entries()]
    .filter(([expertId, value]) => expertId !== "personal-operator" && value.score >= expertRouteMinScore)
    .sort((a, b) => b[1].score - a[1].score);
  const pickFor = (expertId: string, value: ExpertRequestScore): ExpertRoutePick<T> | null => {
    const teammate = hiredByExpert.get(expertId);
    return teammate ? { teammate, expertId, score: value.score, reasons: [...value.reasons], named: false } : null;
  };

  const namedPicks: ExpertRoutePick<T>[] = [];
  for (const teammate of candidates) {
    if (!mentionsTeammateName(normalized, teammate.name)) continue;
    if (namedPicks.some((pick) => pick.teammate.id === teammate.id)) continue;
    const expertId = options.resolveExpertId(teammate) ?? "";
    if (expertId === "personal-operator") continue;
    const value = scores.get(expertId);
    namedPicks.push({ teammate, expertId, score: 100 + (value?.score ?? 0), reasons: ["이름을 불러 맡김", ...(value?.reasons ?? [])], named: true });
  }
  if (namedPicks.length) {
    if (namedPicks.length === 1 && split) {
      const others = ranked
        .map(([expertId, value]) => pickFor(expertId, value))
        .filter((pick): pick is ExpertRoutePick<T> => pick !== null && pick.teammate.id !== namedPicks[0].teammate.id)
        .slice(0, maxPicks - 1);
      if (others.length) return { ...empty, decision: "multiple", picks: [namedPicks[0], ...others], named: true };
    }
    return { ...empty, decision: namedPicks.length > 1 ? "multiple" : "single", picks: namedPicks.slice(0, maxPicks), named: true };
  }

  if (!ranked.length) return empty;
  const hiredRanked = ranked
    .map(([expertId, value]) => pickFor(expertId, value))
    .filter((pick): pick is ExpertRoutePick<T> => pick !== null);
  // 가장 맞는 전문가가 아직 없으면 채용 안내용으로 알린다(맨 앞 1명, 고용된 후보가 하나도 없으면 앞의 2명까지).
  const unhiredAhead = ranked
    .filter(([expertId], index) => !hiredByExpert.has(expertId) && (index === 0 || hiredRanked.length === 0))
    .map(([expertId]) => expertId)
    .slice(0, 2);
  if (split && hiredRanked.length >= 2) {
    return { ...empty, decision: "multiple", picks: hiredRanked.slice(0, maxPicks), unhiredExpertIds: unhiredAhead };
  }
  const [top, second] = ranked;
  // 한 명이 뚜렷할 때만 맡긴다: 2위가 없거나, 3점 이상 앞서거나, 2배를 넘을 때.
  const dominant = !second || top[1].score >= second[1].score + 3 || top[1].score > 2 * second[1].score;
  // 메일 일이 섞였는데 1위가 메일 담당이 아니면 비서가 맡는다(메일 도구와 승인함 카드는 메일 직무와 비서에게만 있다).
  const mailMixed = top[0] !== "mail-secretary" && ranked.some(([expertId]) => expertId === "mail-secretary");
  const topPick = pickFor(top[0], top[1]);
  if (dominant && !mailMixed && topPick) return { ...empty, decision: "single", picks: [topPick] };
  return { ...empty, unhiredExpertIds: mailMixed ? [] : unhiredAhead };
}

