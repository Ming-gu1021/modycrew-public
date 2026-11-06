                                                                                       
                                                                           
//
// 데스크톱 메인 프로세스(proxy-client.mjs)의 허용 목록이다. 사용자 PC에는 k-skill이 없으므로 런타임은 이 파일만 본다.
// - path: k-skill-proxy 의 GET 경로. {name} 은 같은 이름의 params 값으로 채운다.
// - params: 선언된 인자만 전송된다. pattern 은 "u" 플래그로 컴파일되므로 모두 ^…$ 로 고정했다.
//   min·max·maxLength 중 지침에 없던 값은 ModyCrew 보수 상한이다(보고서의 상한 표 참고).
// - listPath: 결과 목록까지의 점 표기. 숫자 조각은 배열 위치다(예: "ALLBILLV2.1.row").
//   XML로 오는 엔드포인트(공휴일·공연·검진기관)는 parseSimpleXml 변환 결과 기준이다.
// - fields: 목록 항목 기준 점 표기(예: "doc.bookname"), 최대 8개. 모델에게 줄 핵심 값만 골랐다.
                                                          

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const ymd8 = "^20\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])$";
const ymdFlexible = "^20\\d{2}[-.]?(0[1-9]|1[0-2])[-.]?(0[1-9]|[12]\\d|3[01])$";
const coordPair = "^\\d{3}(\\.\\d{1,15})?,\\d{2}(\\.\\d{1,15})?$";
const assemblyBillId = "^[A-Z]{3}_[A-Z0-9]{20,40}$";

const kakaoCategoryCodes = [
  "MT1", "CS2", "PS3", "SC4", "AC5", "PK6", "OL7", "SW8", "BK9",
  "CT1", "AG2", "PO3", "AT4", "AD5", "FD6", "CE7", "HP8", "PM9",
];
const kakaoCategoryDescription =
  "업종 코드: MT1 대형마트, CS2 편의점, PS3 어린이집·유치원, SC4 학교, AC5 학원, PK6 주차장, OL7 주유소·충전소, SW8 지하철역, BK9 은행, CT1 문화시설, AG2 중개업소, PO3 공공기관, AT4 관광명소, AD5 숙박, FD6 음식점, CE7 카페, HP8 병원, PM9 약국";
const kakaoPlaceFields = ["place_name", "road_address_name", "address_name", "phone", "distance", "place_url", "x", "y"];

// seoul-density/scripts/seoul_density.py 의 AREAS 119곳 그대로(지침 문구는 121곳).
const seoulDensityAreas = [
  "경복궁", "광화문·덕수궁", "보신각", "서울 암사동 유적", "창덕궁·종묘", "강남 MICE 관광특구",
  "동대문 관광특구", "명동 관광특구", "이태원 관광특구", "잠실 관광특구", "종로·청계 관광특구", "홍대 관광특구",
  "강서한강공원", "고척돔", "광나루한강공원", "광화문광장", "국립중앙박물관·용산가족공원", "난지한강공원",
  "남산공원", "노들섬", "뚝섬한강공원", "망원한강공원", "반포한강공원", "보라매공원",
  "북서울꿈의숲", "서대문독립공원", "서리풀공원·몽마르뜨공원", "서울대공원", "서울숲공원", "송현녹지광장",
  "아차산", "안양천", "양화한강공원", "어린이대공원", "여의도한강공원", "여의서로",
  "올림픽공원", "월드컵공원", "응봉산", "이촌한강공원", "잠실종합운동장", "잠실한강공원",
  "잠원한강공원", "청계산", "홍제폭포", "가락시장", "가로수길", "광장(전통)시장",
  "김포공항", "남대문시장", "노량진", "덕수궁길·정동길", "북창동 먹자골목", "북촌한옥마을",
  "서촌", "성수카페거리", "송리단길·호수단길", "신촌 스타광장", "압구정로데오거리", "여의도",
  "연남동", "영등포 타임스퀘어", "용리단길", "이태원 앤틱가구거리", "익선동", "인사동",
  "잠실롯데타워·석촌호수", "창동 신경제 중심지", "청담동 명품거리", "청량리 제기동 일대 전통시장", "해방촌·경리단길", "DDP(동대문디자인플라자)",
  "DMC(디지털미디어시티)", "가산디지털단지역", "강남역", "건대입구역", "고덕역", "고속터미널역",
  "교대역", "구로디지털단지역", "구로역", "군자역", "대림역", "동대문역",
  "뚝섬역", "미아사거리역", "발산역", "사당역", "삼각지역", "서울대입구역",
  "서울식물원·마곡나루역", "서울역", "성신여대입구역", "선릉역", "시의회 앞", "수유역",
  "신논현역·논현역", "신도림역", "신림역", "신촌·이대역", "쌍문역", "신정네거리역",
  "역삼역", "연신내역", "양재역", "왕십리역", "용산역", "오목교역·목동운동장",
  "잠실새내역", "잠실역", "장지역", "장한평역", "천호역", "총신대입구(이수)역",
  "충정로역", "합정역", "혜화역", "홍대입구역(2호선)", "회기역",
];

export const dailySkillCatalogVersion = "2026-10-27";

export const dailySkillCategories = deepFreeze([
  { id: "weather", label: "날씨·환경" },
  { id: "transport", label: "교통" },
  { id: "travel", label: "여행·안전" },
  { id: "shopping", label: "쇼핑·가격" },
  { id: "food", label: "먹거리" },
  { id: "finance", label: "금융·주식" },
  { id: "public", label: "공공·기업" },
  { id: "realestate", label: "부동산" },
  { id: "legal", label: "법률·정책" },
  { id: "health", label: "건강" },
  { id: "life", label: "생활" },
  { id: "culture", label: "문화·공연" },
  { id: "news", label: "뉴스" },
]);

export const dailySkills = deepFreeze([
  // ── 날씨·환경 ──────────────────────────────────────────────
  {
    id: "korea-weather",
    name: "날씨 예보",
    category: "weather",
    summary: "기상청 단기예보로 기온, 하늘 상태, 비 올 확률을 알려줘요.",
    examples: ["오늘 서울 날씨 어때?", "내일 부산에 비 와?", "이번 주말 강릉 기온 알려줘"],
    keywords: ["날씨", "기온", "온도", "비", "눈", "우산", "강수확률", "예보", "습도", "바람", "최고기온", "최저기온"],
    source: "기상청 단기예보",
    endpoints: [
      {
        id: "forecast",
        path: "/v1/korea-weather/forecast",
        summary: "위도·경도 기준 단기예보(오늘부터 약 4일) 조회",
        params: [
          { name: "lat", type: "number", required: true, min: 32, max: 44, description: "위도 (예: 37.5665)" },
          { name: "lon", type: "number", required: true, min: 123, max: 133, description: "경도 (예: 126.978)" },
        ],
        listPath: "response.body.items.item",
        fields: ["fcstDate", "fcstTime", "category", "fcstValue"],
        // 1,000행 안팎의 예보를 날짜별 요약 + 3시간 간격 값으로 접는다(proxy-client.mjs dailySkillTransforms).
        transform: "kma-forecast",
        sample: { lat: 37.5665, lon: 126.978 },
        verified: { status: 200, bytes: 134423, checkedAt: "2026-10-27T18:15:16+09:00" },
      },
    ],
    notes:
      "지역 이름만 있으면 kakao-map 장소 검색으로 좌표를 먼저 구해요(y가 위도=lat, x가 경도=lon). category: TMP 기온, TMN·TMX 최저·최고, SKY 하늘(1 맑음·3 구름많음·4 흐림), PTY 강수형태(0 없음·1 비·2 비/눈·3 눈·4 소나기), POP 강수확률%, PCP 강수량, REH 습도%, WSD 풍속m/s.",
  },
  {
    id: "han-river-water-level",
    name: "한강 수위",
    category: "weather",
    summary: "한강 관측소의 지금 수위와 유량, 홍수 기준 수위를 알려줘요.",
    examples: ["한강대교 지금 수위 어때?", "잠수교 물 많이 불었어?"],
    keywords: ["한강", "수위", "유량", "홍수", "범람", "잠수교", "한강대교", "관측소", "장마", "물높이"],
    source: "한강홍수통제소",
    endpoints: [
      {
        id: "water-level",
        path: "/v1/han-river/water-level",
        summary: "관측소 이름이나 코드로 현재 수위·유량 조회",
        params: [
          { name: "stationName", type: "string", maxLength: 40, description: "관측소·다리 이름 (예: 한강대교). stationCode와 둘 중 하나" },
          { name: "stationCode", type: "string", pattern: "^\\d{7}$", description: "관측소 코드 7자리 (예: 1018683)" },
        ],
        sample: { stationName: "한강대교" },
        verified: { status: 200, bytes: 684, checkedAt: "2026-10-27T18:15:15+09:00" },
      },
    ],
    notes: "'한강'처럼 넓은 이름은 후보 관측소 목록(candidate_stations)이 와요. 그중 하나로 다시 조회하고, 10분 단위 값이라 관측 시각을 같이 말해요.",
  },

  // ── 교통 ──────────────────────────────────────────────────
  {
    id: "seoul-subway-arrival",
    name: "지하철 도착",
    category: "transport",
    summary: "서울 지하철역에 곧 들어오는 열차와 남은 시간을 알려줘요.",
    examples: ["강남역 지하철 언제 와?", "서울역 1호선 도착 정보 알려줘"],
    keywords: ["지하철", "전철", "도착", "열차", "역", "호선", "몇분", "상행", "하행", "막차", "실시간"],
    source: "서울 열린데이터광장 실시간 지하철 도착정보",
    endpoints: [
      {
        id: "arrival",
        path: "/v1/seoul-subway/arrival",
        summary: "역 이름으로 실시간 도착 예정 열차 조회",
        params: [
          { name: "stationName", type: "string", required: true, maxLength: 30, description: "역 이름, '역' 없이 (예: 강남)" },
        ],
        listPath: "realtimeArrivalList",
        fields: ["subwayId", "trainLineNm", "updnLine", "arvlMsg2", "arvlMsg3", "barvlDt", "btrainSttus", "lstcarAt"],
        sample: { stationName: "강남" },
        verified: { status: 200, bytes: 5402, checkedAt: "2026-10-27T18:15:27+09:00" },
      },
    ],
    notes: "역 이름에서 '역'을 빼고 넣어요. subwayId는 노선 코드예요(1001~1009는 1~9호선, 1077은 신분당선). barvlDt는 도착까지 남은 초, lstcarAt 1은 막차예요. 몇 초 단위로 바뀌니 조회 시각을 같이 말해요.",
  },
  {
    id: "kakao-map",
    name: "장소·길찾기",
    category: "transport",
    summary: "카카오맵으로 장소를 찾고, 자동차 이동 시간과 택시비를 알려줘요.",
    examples: ["강남역 근처 스타벅스 찾아줘", "서울역에서 강남역까지 차로 얼마나 걸려?", "이 근처 약국 어디 있어?"],
    keywords: ["장소", "위치", "주소", "근처", "주변", "카페", "약국", "주차장", "길찾기", "자동차", "택시비", "소요시간", "거리", "좌표"],
    source: "카카오 로컬 API·카카오모빌리티 길찾기 API",
    endpoints: [
      {
        id: "keyword",
        path: "/v1/kakao-map/search/keyword",
        summary: "키워드로 장소 검색 (좌표를 주면 그 주변)",
        params: [
          { name: "q", type: "string", required: true, maxLength: 100, description: "검색어 (예: 스타벅스, 서울역)" },
          { name: "x", type: "number", min: 124, max: 132, description: "중심 경도 (예: 127.0276)" },
          { name: "y", type: "number", min: 33, max: 39, description: "중심 위도 (예: 37.4979)" },
          { name: "radius", type: "integer", min: 0, max: 20000, description: "반경 m (x·y와 함께)" },
          { name: "category_group_code", type: "enum", values: kakaoCategoryCodes, description: kakaoCategoryDescription },
          { name: "sort", type: "enum", values: ["accuracy", "distance"], description: "accuracy 정확도순, distance 거리순(x·y 필요)" },
          { name: "page", type: "integer", min: 1, max: 45, description: "페이지" },
          { name: "size", type: "integer", min: 1, max: 15, description: "한 번에 받을 개수" },
        ],
        listPath: "documents",
        fields: kakaoPlaceFields,
        sample: { q: "스타벅스", x: 127.0276, y: 37.4979, radius: 500, sort: "distance", size: 5 },
        verified: { status: 200, bytes: 2405, checkedAt: "2026-10-27T18:15:19+09:00" },
      },
      {
        id: "category",
        path: "/v1/kakao-map/search/category",
        summary: "좌표 주변을 업종 코드로 검색",
        params: [
          { name: "category_group_code", type: "enum", required: true, values: kakaoCategoryCodes, description: kakaoCategoryDescription },
          { name: "x", type: "number", required: true, min: 124, max: 132, description: "중심 경도" },
          { name: "y", type: "number", required: true, min: 33, max: 39, description: "중심 위도" },
          { name: "radius", type: "integer", min: 0, max: 20000, description: "반경 m (기본 500)" },
          { name: "sort", type: "enum", values: ["accuracy", "distance"], description: "accuracy 정확도순, distance 거리순" },
          { name: "page", type: "integer", min: 1, max: 45, description: "페이지" },
          { name: "size", type: "integer", min: 1, max: 15, description: "한 번에 받을 개수" },
        ],
        listPath: "documents",
        fields: kakaoPlaceFields,
        sample: { category_group_code: "FD6", x: 127.0276, y: 37.4979, radius: 300, size: 5 },
        verified: { status: 200, bytes: 2307, checkedAt: "2026-10-27T18:15:20+09:00" },
      },
      {
        id: "coord2address",
        path: "/v1/kakao-map/coord2address",
        summary: "좌표를 도로명·지번 주소로 바꾸기",
        params: [
          { name: "x", type: "number", required: true, min: 124, max: 132, description: "경도" },
          { name: "y", type: "number", required: true, min: 33, max: 39, description: "위도" },
        ],
        listPath: "documents",
        fields: ["road_address", "address"],
        sample: { x: 127.0276, y: 37.4979 },
        verified: { status: 200, bytes: 409, checkedAt: "2026-10-27T18:15:21+09:00" },
      },
      {
        id: "directions",
        path: "/v1/kakao-mobility/directions",
        summary: "자동차 길찾기: 거리, 소요 시간, 통행료, 예상 택시비",
        params: [
          { name: "origin", type: "string", required: true, maxLength: 40, pattern: coordPair, description: "출발 좌표 '경도,위도' (예: 126.9706,37.5559)" },
          { name: "destination", type: "string", required: true, maxLength: 40, pattern: coordPair, description: "도착 좌표 '경도,위도'" },
          {
            name: "waypoints",
            type: "string",
            maxLength: 200,
            pattern: "^\\d{3}(\\.\\d{1,15})?,\\d{2}(\\.\\d{1,15})?(\\|\\d{3}(\\.\\d{1,15})?,\\d{2}(\\.\\d{1,15})?){0,4}$",
            description: "경유지 좌표 최대 5개, '|'로 구분",
          },
          { name: "priority", type: "enum", values: ["RECOMMEND", "TIME", "DISTANCE"], description: "RECOMMEND 추천, TIME 최단시간, DISTANCE 최단거리" },
          {
            name: "avoid",
            type: "string",
            maxLength: 60,
            pattern: "^(ferries|toll|motorway|schoolzone|uturn)(\\|(ferries|toll|motorway|schoolzone|uturn)){0,4}$",
            description: "피할 길: ferries, toll, motorway, schoolzone, uturn ('|'로 여러 개)",
          },
        ],
        listPath: "routes",
        fields: ["result_code", "result_msg", "summary"],
        sample: { origin: "126.9706,37.5559", destination: "127.0276,37.4979", priority: "RECOMMEND" },
        verified: { status: 200, bytes: 10888, checkedAt: "2026-10-27T18:15:23+09:00" },
      },
    ],
    notes: "x는 경도, y는 위도예요. 길찾기는 자동차 전용이라 장소 검색으로 출발·도착 좌표를 먼저 구해요. summary의 distance는 m, duration은 초, fare.taxi·fare.toll은 원이에요. 길찾기는 공용 하루 한도가 작아(약 1,000건) 꼭 필요할 때만 불러요.",
  },
  {
    id: "seoul-bike",
    name: "따릉이 대여소",
    category: "transport",
    summary: "가까운 서울 따릉이 대여소의 빌릴 수 있는 자전거와 빈 거치대를 알려줘요.",
    examples: ["광화문 근처 따릉이 빌릴 수 있어?", "여의도역 근처 따릉이 반납할 자리 있어?"],
    keywords: ["따릉이", "자전거", "공공자전거", "대여소", "대여", "반납", "거치대", "서울자전거"],
    source: "서울 열린데이터광장 따릉이 실시간 대여정보",
    endpoints: [
      {
        id: "nearby",
        path: "/v1/seoul-bike/nearby",
        summary: "좌표 주변 대여소의 실시간 자전거 수 조회",
        params: [
          { name: "lat", type: "number", required: true, min: 37.4, max: 37.75, description: "위도 (예: 37.5717)" },
          { name: "lon", type: "number", required: true, min: 126.7, max: 127.3, description: "경도 (예: 126.9763)" },
          { name: "radius_m", type: "integer", min: 50, max: 2000, description: "반경 m (기본 500)" },
          { name: "limit", type: "integer", min: 1, max: 20, description: "대여소 수 (기본 10)" },
        ],
        listPath: "items",
        fields: ["station_name", "available_bikes", "empty_docks", "rack_total_count", "distance_m"],
        sample: { lat: 37.5717, lon: 126.9763, radius_m: 500, limit: 5 },
        verified: { status: 200, bytes: 1264, checkedAt: "2026-10-27T18:20:54+09:00" },
      },
    ],
    notes: "서울 따릉이만 돼요. 장소 이름은 kakao-map 장소 검색으로 좌표를 먼저 구해요(y가 위도=lat, x가 경도=lon). 실시간 값이라 조회 시각을 같이 말해요.",
  },
  {
    id: "komsa-ferry-info",
    name: "여객선 운항",
    category: "transport",
    summary: "연안여객선의 날짜별 운항 일정과 운항·통제 상태를 알려줘요.",
    examples: ["오늘 목포에서 제주 가는 배 떠?", "내일 백령도 여객선 운항해?"],
    keywords: ["여객선", "배", "페리", "선박", "운항", "결항", "통제", "항로", "섬", "출항", "제주", "울릉도"],
    source: "한국해양교통안전공단 MTIS",
    endpoints: [
      {
        id: "schedules",
        path: "/v1/komsa/ferry/schedules",
        summary: "날짜·선박·항로·기항지로 운항 일정 조회",
        params: [
          { name: "date", type: "string", pattern: "^20\\d{2}-?(0[1-9]|1[0-2])-?(0[1-9]|[12]\\d|3[01])$", description: "운항 날짜 YYYYMMDD 또는 YYYY-MM-DD" },
          { name: "vessel", type: "string", maxLength: 40, description: "선박 이름 (예: 섬사랑12호)" },
          { name: "route", type: "string", maxLength: 40, description: "항로 이름" },
          { name: "port", type: "string", maxLength: 40, description: "기항지 이름 (예: 목포)" },
          { name: "page", type: "integer", min: 1, max: 100, description: "페이지" },
          { name: "limit", type: "integer", min: 1, max: 50, description: "한 번에 받을 개수 (기본 10)" },
        ],
        listPath: "items",
        fields: ["rlvt_ymd", "sail_tm", "psnshp_nm", "oport_nm", "dest_nm", "nvg_seawy_nm", "nvg_stts_nm", "cntrl_rsn_nm"],
        sample: { date: "20261027", limit: 5 },
        verified: { status: 200, bytes: 3227, checkedAt: "2026-10-27T18:15:24+09:00" },
      },
    ],
    notes: "하루 전체가 700건이 넘으니 항로·기항지·선박 이름으로 좁혀요. sail_tm은 출항 시각 HHMM(앞 0 생략, 100은 01:00)이에요. 운항 정보일 뿐 예매 가능 좌석이 아니고 5분 주기로 바뀔 수 있어요.",
  },

  // ── 여행·안전 ──────────────────────────────────────────────
  {
    id: "mofa-travel-safety",
    name: "해외 여행경보",
    category: "travel",
    summary: "외교부가 정한 나라별 여행경보 단계와 해당 지역을 알려줘요.",
    examples: ["일본 여행경보 단계 알려줘", "태국 출장 가도 되는 지역이야?"],
    keywords: ["여행경보", "해외여행", "출장", "외교부", "위험지역", "여행금지", "출국권고", "여행자제", "안전", "나라"],
    source: "외교부 해외안전여행(0404) 국가·지역별 여행경보",
    endpoints: [
      {
        id: "travel-alerts",
        path: "/v1/mofa-travel-safety/travel-alerts",
        summary: "나라 이름이나 ISO 코드로 여행경보 조회",
        params: [
          { name: "country_nm", type: "string", maxLength: 30, description: "한글 나라 이름 (예: 일본). ISO 코드와 함께 쓰지 않아요" },
          { name: "country_iso_alp2", type: "string", pattern: "^[A-Za-z]{2}$", description: "ISO 2자리 국가코드 (예: JP)" },
          { name: "page", type: "integer", min: 1, max: 100, description: "페이지" },
          { name: "perPage", type: "integer", min: 1, max: 100, description: "한 번에 받을 개수 (기본 10)" },
        ],
        listPath: "items",
        fields: ["country_nm", "country_iso_alp2", "alarm_lvl", "region_ty", "remark", "written_dt", "dang_map_download_url"],
        sample: { country_nm: "일본", perPage: 10 },
        verified: { status: 200, bytes: 873, checkedAt: "2026-10-27T18:15:28+09:00" },
      },
    ],
    notes: "나라 이름과 ISO 코드는 하나만 넣어요. alarm_lvl 숫자는 외교부 경보 단계라 임의로 해석하지 말고, 지역(region_ty·remark)과 함께 원문대로 전하며 0404.go.kr 확인을 권해요.",
  },
  {
    id: "seoul-density",
    name: "서울 혼잡도",
    category: "travel",
    summary: "서울 주요 장소 119곳의 지금 혼잡 단계와 추정 인구를 알려줘요.",
    examples: ["지금 강남역 많이 붐벼?", "여의도한강공원 지금 사람 많아?"],
    keywords: ["혼잡도", "혼잡", "붐비", "붐벼", "인파", "사람", "유동인구", "나들이", "여유", "명동", "홍대", "강남역"],
    source: "서울시 실시간 도시데이터",
    endpoints: [
      {
        id: "citydata",
        path: "/v1/seoul-density/citydata",
        summary: "장소 이름으로 실시간 혼잡도·추정 인구 조회",
        params: [
          { name: "area", type: "enum", required: true, values: seoulDensityAreas, description: "지원 장소 이름 그대로 (예: 강남역, 홍대 관광특구)" },
        ],
        sample: { area: "강남역" },
        verified: { status: 200, bytes: 2255, checkedAt: "2026-10-27T18:20:53+09:00" },
      },
    ],
    notes: "장소는 지원 목록 이름 그대로 넣어요('홍대'는 '홍대 관광특구'나 '홍대입구역(2호선)'). 인구는 통신 신호 기반 추정치이고 약 15분 전 값이며, 새벽 1~5시에는 비어 있을 수 있어요.",
  },

  // ── 먹거리 ────────────────────────────────────────────────
  {
    id: "k-schoollunch-menu",
    name: "학교 급식",
    category: "food",
    summary: "나이스(NEIS) 자료로 학교 급식 메뉴와 칼로리를 알려줘요.",
    examples: ["경복고등학교 오늘 급식 뭐야?", "서울 미래초 내일 점심 메뉴 알려줘"],
    keywords: ["급식", "식단", "학교", "점심", "중식", "석식", "메뉴", "초등학교", "중학교", "고등학교", "나이스"],
    source: "교육부 나이스 교육정보 개방 포털",
    endpoints: [
      {
        id: "school-search",
        path: "/v1/neis/school-search",
        summary: "교육청과 학교 이름으로 학교 코드 찾기",
        params: [
          { name: "educationOffice", type: "string", required: true, maxLength: 30, description: "시도교육청 (예: 서울특별시교육청, 서울)" },
          { name: "schoolName", type: "string", required: true, maxLength: 50, description: "학교 이름 (예: 경복고등학교)" },
        ],
        listPath: "schoolInfo.1.row",
        fields: ["ATPT_OFCDC_SC_CODE", "SD_SCHUL_CODE", "SCHUL_NM", "SCHUL_KND_SC_NM", "ORG_RDNMA"],
        sample: { educationOffice: "서울특별시교육청", schoolName: "경복고등학교" },
        verified: { status: 200, bytes: 2136, checkedAt: "2026-10-27T18:15:54+09:00" },
      },
      {
        id: "school-meal",
        path: "/v1/neis/school-meal",
        summary: "학교 코드와 날짜로 급식 메뉴 조회",
        params: [
          { name: "educationOfficeCode", type: "string", required: true, pattern: "^[A-Z]\\d{2}$", description: "교육청 코드 (학교 찾기의 ATPT_OFCDC_SC_CODE, 예: B10)" },
          { name: "schoolCode", type: "string", required: true, pattern: "^\\d{7}$", description: "학교 코드 (학교 찾기의 SD_SCHUL_CODE, 예: 7010062)" },
          { name: "mealDate", type: "string", required: true, pattern: ymd8, description: "급식일 YYYYMMDD (한국 시간 기준)" },
          { name: "mealKindCode", type: "enum", values: ["1", "2", "3"], description: "1 조식, 2 중식, 3 석식" },
        ],
        listPath: "mealServiceDietInfo.1.row",
        fields: ["MLSV_YMD", "MMEAL_SC_NM", "DDISH_NM", "CAL_INFO"],
        sample: { educationOfficeCode: "B10", schoolCode: "7010062", mealDate: "20261027" },
        verified: { status: 200, bytes: 2130, checkedAt: "2026-10-27T18:20:38+09:00" },
      },
    ],
    notes: "학교 찾기로 두 코드를 먼저 얻은 뒤 급식을 조회해요. 같은 이름 학교가 여럿이면 주소를 보여 주고 고르게 해요. 메뉴 옆 괄호 숫자는 알레르기 유발 식품 번호이고, 주말·방학·공휴일은 급식 자료가 없을 수 있어요.",
  },

  // ── 공공·기업 ──────────────────────────────────────────────
  {
    id: "kr-whois-lookup",
    name: "도메인·IP 조회",
    category: "public",
    summary: ".kr·.한국 도메인과 IP 주소, AS 번호의 공개 등록 정보를 알려줘요.",
    examples: ["kisa.or.kr 도메인 만료일 언제야?", "202.30.50.51 IP는 어느 기관 거야?"],
    keywords: ["도메인", "후이즈", "만료일", "등록기관", "등록일", "네임서버", "IP주소", "아이피", "AS번호", "인터넷주소"],
    source: "한국인터넷진흥원 WHOIS (공공데이터포털)",
    endpoints: [
      {
        id: "domain",
        path: "/v1/kr-whois/domain",
        summary: ".kr·.한국 도메인 등록 정보",
        params: [
          { name: "domain", type: "string", required: true, maxLength: 100, pattern: "^[0-9A-Za-z가-힣.-]+\\.(kr|KR|한국)$", description: "도메인 (예: kisa.or.kr). http:// 와 경로는 빼요" },
        ],
        sample: { domain: "kisa.or.kr" },
        verified: { status: 200, bytes: 927, checkedAt: "2026-10-27T18:15:39+09:00" },
      },
      {
        id: "ip",
        path: "/v1/kr-whois/ip",
        summary: "IP 주소의 할당 기관과 네트워크 범위",
        params: [
          { name: "ip", type: "string", required: true, maxLength: 45, pattern: "^[0-9A-Fa-f:.]{2,45}$", description: "IPv4 또는 IPv6 (예: 202.30.50.51)" },
        ],
        sample: { ip: "202.30.50.51" },
        verified: { status: 200, bytes: 1562, checkedAt: "2026-10-27T18:15:40+09:00" },
      },
      {
        id: "as",
        path: "/v1/kr-whois/as",
        summary: "AS 번호의 할당 기관",
        params: [
          { name: "asn", type: "string", required: true, maxLength: 12, pattern: "^[Aa][Ss]\\d{1,10}$", description: "AS 번호 (예: AS9700)" },
        ],
        sample: { asn: "AS9700" },
        verified: { status: 200, bytes: 731, checkedAt: "2026-10-27T18:15:41+09:00" },
      },
    ],
    notes: "결과에 담당자 이메일·전화가 있어도 기관명·등록일·만료일·네임서버 위주로 요약하고 연락처는 옮기지 않아요. .com 같은 해외 도메인은 조회할 수 없어요.",
  },
  {
    id: "fsc-corporate-info",
    name: "법인 기본정보",
    category: "public",
    summary: "금융위원회 기업기본정보로 법인 대표자, 설립일, 주소를 찾아줘요.",
    examples: ["삼성전자 대표자랑 설립일 알려줘", "이 거래처 법인 주소 확인해줘"],
    keywords: ["법인", "회사", "기업", "기업정보", "대표자", "대표이사", "설립일", "법인등록번호", "거래처", "본사주소", "홈페이지"],
    source: "금융위원회 기업기본정보 (공공데이터포털)",
    endpoints: [
      {
        id: "corp-outline",
        path: "/v1/fsc/corp-outline",
        summary: "법인명으로 법인 개요 후보 조회",
        params: [
          { name: "name", type: "string", required: true, maxLength: 100, description: "법인명 (예: 삼성전자)" },
          { name: "b_no", type: "string", pattern: "^\\d{10}$", description: "사업자등록번호 10자리, 하이픈 없이. 후보 대조용" },
        ],
        listPath: "candidates",
        fields: ["corpNm", "crno", "enpRprFnm", "enpEstbDt", "enpBsadr", "bzno", "enpHmpgUrl", "enpEmpeCnt"],
        sample: { name: "삼성전자" },
        verified: { status: 200, bytes: 9266, checkedAt: "2026-10-27T18:21:03+09:00" },
      },
    ],
    notes: "법인명 부분 일치라 비슷한 이름의 다른 법인과 같은 법인의 과거 기록이 섞여 나와요. 사업자번호를 함께 넣으면 일치 후보를 따로 표시하고, 0건이어도 법인이 없다는 뜻은 아니에요.",
  },
  {
    id: "national-pension-workplace",
    name: "국민연금 사업장",
    category: "public",
    summary: "국민연금 가입 사업장의 가입자 수와 이번 달 고지금액을 알려줘요.",
    examples: ["삼성전자(주) 국민연금 가입자 몇 명이야?", "이 회사 직원 규모 국민연금으로 확인해줘"],
    keywords: ["국민연금", "가입자", "가입자수", "직원수", "사업장", "회사규모", "고지금액", "업종", "거래처"],
    source: "국민연금공단 가입 사업장 내역 (공공데이터포털)",
    endpoints: [
      {
        id: "workplace",
        path: "/v1/national-pension/workplace",
        summary: "사업장명(+사업자번호)으로 가입자 수·고지금액 조회",
        params: [
          { name: "name", type: "string", required: true, maxLength: 100, description: "사업장명(상호) (예: 삼성전자(주))" },
          { name: "b_no", type: "string", pattern: "^\\d{10}$", description: "사업자등록번호 10자리, 하이픈 없이. 앞 6자리로 후보를 좁혀요" },
        ],
        listPath: "detail",
        fields: ["wkplNm", "jnngpCnt", "crrmmNtcAmt", "adptDt", "scsnDt", "vldtVlKrnNm", "wkplRoadNmDtlAddr", "wkplJnngStcd"],
        sample: { name: "삼성전자(주)", b_no: "1248100998" },
        verified: { status: 200, bytes: 11620, checkedAt: "2026-10-27T18:21:05+09:00" },
      },
    ],
    notes: "jnngpCnt는 가입자 수, crrmmNtcAmt는 당월 고지금액(원)이에요. 후보가 여럿이라 하나로 정해지지 않으면 상세가 비어 있을 수 있으니, 정확한 상호나 사업자번호를 받아 다시 조회해요. 공단 공개 사업장 정보만 쓰고 개인 정보는 추정하지 않아요.",
  },

  // ── 부동산 ────────────────────────────────────────────────
  {
    id: "real-estate-search",
    name: "부동산 실거래가",
    category: "realestate",
    summary: "국토교통부 신고 자료로 아파트·오피스텔·빌라 등의 매매와 전월세 실거래가를 알려줘요.",
    examples: ["강남구 아파트 지난달 실거래가 알려줘", "마포구 오피스텔 전세 얼마에 거래됐어?"],
    keywords: ["실거래가", "부동산", "아파트", "매매", "전세", "월세", "전월세", "오피스텔", "빌라", "다세대", "단독주택", "상가", "시세", "집값"],
    source: "국토교통부 실거래가 공개시스템 (공공데이터포털)",
    endpoints: [
      {
        id: "region-code",
        path: "/v1/real-estate/region-code",
        summary: "지역 이름으로 법정동 코드(5자리) 찾기",
        params: [
          { name: "q", type: "string", required: true, maxLength: 40, description: "지역 이름 (예: 강남구, 서울 마포구)" },
        ],
        listPath: "results",
        fields: ["lawd_cd", "name"],
        sample: { q: "강남구" },
        verified: { status: 200, bytes: 201, checkedAt: "2026-10-27T18:15:44+09:00" },
      },
      {
        id: "transactions",
        path: "/v1/real-estate/{assetType}/{dealType}",
        summary: "자산 종류·거래 종류별 한 달 실거래 목록",
        params: [
          {
            name: "assetType",
            type: "enum",
            required: true,
            values: ["apartment", "officetel", "villa", "single-house", "commercial"],
            description: "apartment 아파트, officetel 오피스텔, villa 연립다세대, single-house 단독다가구, commercial 상업업무용",
          },
          { name: "dealType", type: "enum", required: true, values: ["trade", "rent"], description: "trade 매매, rent 전월세 (commercial은 trade만)" },
          { name: "lawd_cd", type: "string", required: true, pattern: "^\\d{5}$", description: "법정동 코드 5자리 (지역코드 찾기 결과, 예: 11680)" },
          { name: "deal_ymd", type: "string", required: true, pattern: "^20\\d{2}(0[1-9]|1[0-2])$", description: "거래 연월 YYYYMM (예: 202609)" },
          { name: "num_of_rows", type: "integer", min: 1, max: 1000, description: "받을 건수 (기본 100)" },
        ],
        listPath: "items",
        fields: ["name", "district", "area_m2", "floor", "price_10k", "deposit_10k", "monthly_rent_10k", "deal_date"],
        sample: { assetType: "apartment", dealType: "trade", lawd_cd: "11680", deal_ymd: "202609" },
        verified: { status: 200, bytes: 17168, checkedAt: "2026-10-27T18:15:45+09:00" },
      },
    ],
    notes: "지역코드 찾기로 lawd_cd를 먼저 얻어요. 금액 단위는 만원(245000은 24억 5천만 원)이고, total_count는 그 달 전체 건수예요. 신고 자료라 호가와 다르고 최근 달은 신고가 덜 들어왔을 수 있어요. commercial은 매매만 돼요.",
  },
  {
    id: "lh-notice-search",
    name: "LH 청약 공고",
    category: "realestate",
    summary: "LH 임대·분양·신혼희망타운 공고를 상태와 지역별로 찾아줘요.",
    examples: ["지금 접수중인 LH 행복주택 공고 있어?", "부산 LH 임대주택 공고 보여줘"],
    keywords: ["LH", "청약", "공고", "임대주택", "행복주택", "영구임대", "국민임대", "전세임대", "분양", "신혼희망타운", "모집공고", "마감"],
    source: "한국토지주택공사(LH) 공고 (공공데이터포털)",
    endpoints: [
      {
        id: "search",
        path: "/v1/lh-notice/search",
        summary: "공고 상태·유형·지역·키워드로 공고 목록 조회",
        params: [
          { name: "panSs", type: "enum", values: ["공고중", "접수중", "접수마감", "당첨자발표", "추정공고"], description: "공고 상태. 비우면 전체" },
          { name: "uppAisTpCd", type: "enum", values: ["01", "05", "06", "13", "22"], description: "01 토지, 05 분양주택, 06 임대주택, 13 주거복지·신혼희망타운, 22 상가" },
          { name: "aisTpCd", type: "string", pattern: "^\\d{2}$", description: "세부 유형 코드 (예: 09 영구임대, 10 행복주택, 17 전세임대)" },
          { name: "cnpCdNm", type: "string", maxLength: 20, description: "지역 이름 (예: 서울특별시, 부산광역시, 전국)" },
          { name: "panNm", type: "string", maxLength: 50, description: "공고명 키워드 (예: 행복주택, 청년)" },
          { name: "panNtStDt", type: "string", pattern: ymdFlexible, description: "공고 게시일 시작 (예: 2026-10-01)" },
          { name: "clsgDt", type: "string", pattern: ymdFlexible, description: "접수 마감일 끝 (예: 2026-11-30)" },
          { name: "page", type: "integer", min: 1, max: 1000, description: "페이지" },
          { name: "pageSize", type: "integer", min: 1, max: 100, description: "한 번에 받을 개수 (기본 50)" },
        ],
        listPath: "items",
        fields: ["pan_id", "pan_nm", "ais_tp_cd_nm", "cnp_cd_nm", "pan_ss", "pan_dt", "clsg_dt", "detail_url"],
        sample: { panSs: "공고중", pageSize: 10 },
        verified: { status: 200, bytes: 12784, checkedAt: "2026-10-27T18:15:43+09:00" },
      },
    ],
    notes: "마감 여부는 한국 시간 오늘과 clsg_dt를 비교해 말하고, 공고번호(pan_id)와 원문 링크(detail_url)를 함께 보여 줘요. SH·GH 같은 지방 공사 공고는 없어요.",
  },

  // ── 법률·정책 ──────────────────────────────────────────────
  {
    id: "korean-law-search",
    name: "법령·판례 검색",
    category: "legal",
    summary: "국가법령정보센터에서 법령과 조문, 판례를 찾아 원문을 보여줘요.",
    examples: ["관세법 제38조 보여줘", "부당해고 관련 판례 찾아줘", "개인정보 보호법 찾아줘"],
    keywords: ["법", "법령", "법률", "조문", "시행령", "판례", "판결", "대법원", "조항", "법조문", "규정", "법제처"],
    source: "법제처 국가법령정보센터 Open API",
    endpoints: [
      {
        id: "law-search",
        path: "/v1/korean-law/search",
        summary: "이름으로 현행 법령 찾기",
        params: [
          { name: "target", type: "enum", required: true, values: ["law"], description: "항상 law" },
          { name: "query", type: "string", required: true, maxLength: 100, description: "법령 이름이나 검색어 (예: 관세법)" },
          { name: "display", type: "integer", min: 1, max: 100, description: "받을 건수 (기본 20)" },
          { name: "page", type: "integer", min: 1, max: 100, description: "페이지" },
        ],
        listPath: "LawSearch.law",
        fields: ["법령명한글", "법령약칭명", "법령구분명", "소관부처명", "시행일자", "공포일자", "법령일련번호", "법령ID"],
        sample: { target: "law", query: "관세법" },
        verified: { status: 200, bytes: 7350, checkedAt: "2026-10-27T18:15:48+09:00" },
      },
      {
        id: "law-article",
        path: "/v1/korean-law/detail",
        summary: "법령일련번호와 조 번호로 조문 원문 보기",
        params: [
          { name: "target", type: "enum", required: true, values: ["law"], description: "항상 law" },
          { name: "MST", type: "string", required: true, pattern: "^\\d{1,10}$", description: "법령 찾기 결과의 법령일련번호 (예: 290673)" },
          { name: "JO", type: "string", required: true, pattern: "^\\d{6}$", description: "조 번호 6자리 = 조 4자리 + 가지 2자리 (제38조 003800, 제2조의3 000203)" },
        ],
        listPath: "법령.조문.조문단위",
        fields: ["조문번호", "조문제목", "조문내용", "항", "조문시행일자"],
        sample: { target: "law", MST: "290673", JO: "003800" },
        verified: { status: 200, bytes: 4110, checkedAt: "2026-10-27T18:20:41+09:00" },
      },
      {
        id: "precedent-search",
        path: "/v1/korean-law/search",
        summary: "검색어로 판례 목록 찾기",
        params: [
          { name: "target", type: "enum", required: true, values: ["prec"], description: "항상 prec" },
          { name: "query", type: "string", required: true, maxLength: 100, description: "검색어 (예: 부당해고)" },
          { name: "display", type: "integer", min: 1, max: 100, description: "받을 건수 (기본 20)" },
          { name: "page", type: "integer", min: 1, max: 100, description: "페이지" },
        ],
        listPath: "PrecSearch.prec",
        fields: ["사건명", "사건번호", "선고일자", "법원명", "사건종류명", "판결유형", "판례일련번호", "데이터출처명"],
        sample: { target: "prec", query: "부당해고", display: 5 },
        verified: { status: 200, bytes: 2499, checkedAt: "2026-10-27T18:28:32+09:00" },
      },
      {
        id: "precedent-detail",
        path: "/v1/korean-law/detail",
        summary: "판례일련번호로 판시사항·판결요지·본문 보기",
        params: [
          { name: "target", type: "enum", required: true, values: ["prec"], description: "항상 prec" },
          { name: "ID", type: "string", required: true, pattern: "^\\d{1,10}$", description: "판례 찾기 결과의 판례일련번호 (예: 228541)" },
        ],
        sample: { target: "prec", ID: "228541" },
        verified: { status: 200, bytes: 29965, checkedAt: "2026-10-27T18:15:50+09:00" },
      },
    ],
    notes: "약칭(예: 화관법)은 법령 찾기로 정식 이름부터 확인하고, 조문은 법령일련번호와 조 번호로 봐요. 0건이어도 관련 규범이 없다고 단정하지 말고 검색어를 바꿔 보며, 법률 자문처럼 단정하지 말고 출처(법제처)를 함께 적어요.",
  },
  {
    id: "assembly-bill-vote-search",
    name: "국회 의안·표결",
    category: "legal",
    summary: "열린국회정보로 법안 진행 상황과 본회의 표결 결과를 알려줘요.",
    examples: ["간호법 국회에서 어떻게 됐어?", "이 법안 본회의 표결에서 누가 반대했어?"],
    keywords: ["국회", "법안", "의안", "발의", "표결", "본회의", "찬성", "반대", "기권", "국회의원", "가결", "부결", "입법"],
    source: "국회사무처 열린국회정보 Open API",
    endpoints: [
      {
        id: "bills",
        path: "/v1/assembly/bills",
        summary: "의안 이름으로 의안 검색",
        params: [
          { name: "query", type: "string", maxLength: 100, description: "의안 이름 (예: 간호법)" },
          { name: "eraco", type: "string", pattern: "^제\\d{2}대$", description: "국회 대수 (예: 제22대). 비우면 제21대" },
          { name: "billNo", type: "string", pattern: "^\\d{7}$", description: "의안번호 7자리" },
          { name: "page", type: "integer", min: 1, max: 100, description: "페이지" },
          { name: "limit", type: "integer", min: 1, max: 100, description: "받을 건수" },
        ],
        listPath: "ALLBILLV2.1.row",
        fields: ["BILL_ID", "BILL_NO", "BILL_NM", "PPSR_NM", "PPSL_DT", "JRCMIT_NM", "RGS_CONF_RSLT", "LINK_URL"],
        sample: { query: "간호법", eraco: "제21대", limit: 10 },
        verified: { status: 200, bytes: 6304, checkedAt: "2026-10-27T18:15:38+09:00" },
      },
      {
        id: "bill-detail",
        path: "/v1/assembly/bill-detail",
        summary: "BILL_ID로 위원회·본회의 처리 경과 보기",
        params: [
          { name: "billId", type: "string", required: true, pattern: assemblyBillId, description: "의안 검색 결과의 BILL_ID" },
        ],
        listPath: "BILLINFODETAIL.1.row",
        fields: ["BILL_NM", "PPSR", "PPSL_DT", "JRCMIT_NM", "JRCMIT_PROC_RSLT", "RGS_CONF_NM", "RGS_CONF_RSLT", "PROM_DT"],
        sample: { billId: "PRC_A2L2Y0K5B1G7P1P8B1B2T3U0R1O9A6" },
        verified: { status: 200, bytes: 808, checkedAt: "2026-10-27T18:20:35+09:00" },
      },
      {
        id: "votes",
        path: "/v1/assembly/votes",
        summary: "본회의 표결의 의원별 찬반 보기",
        params: [
          { name: "age", type: "integer", required: true, min: 16, max: 22, description: "국회 대수 숫자 (예: 21)" },
          { name: "billId", type: "string", required: true, pattern: assemblyBillId, description: "의안 검색 결과의 BILL_ID" },
          { name: "memberName", type: "string", maxLength: 20, description: "의원 이름" },
          { name: "party", type: "string", maxLength: 30, description: "정당 이름" },
          { name: "page", type: "integer", min: 1, max: 100, description: "페이지" },
          { name: "limit", type: "integer", min: 1, max: 100, description: "받을 건수 (최대 100)" },
        ],
        listPath: "nojepdqqaweusdfbi.1.row",
        fields: ["HG_NM", "POLY_NM", "ORIG_NM", "RESULT_VOTE_MOD", "VOTE_DATE", "BILL_NAME"],
        sample: { age: 21, billId: "PRC_N2D0H0W9P2S3Z1Q2X0L8W4B1G8E3F4", limit: 20 },
        verified: { status: 200, bytes: 16516, checkedAt: "2026-10-27T18:23:49+09:00" },
      },
    ],
    notes: "의안 검색으로 BILL_ID를 먼저 확정해요. 대수를 비우면 제21대에서 찾으니 최근 법안은 eraco에 제22대를 넣어요. 표결은 300명 규모라 의원이나 정당으로 좁혀 보고, 기록이 없으면 INFO-200이 와요. 찬반 분류는 원문 그대로 전하고 정치적 평가는 하지 않아요.",
  },

  // ── 건강 ──────────────────────────────────────────────────
  {
    id: "mfds-drug-safety",
    name: "의약품 정보",
    category: "health",
    summary: "식약처 공식 자료로 약의 효능, 복용법, 주의사항, 상호작용을 알려줘요.",
    examples: ["타이레놀 효능이랑 주의사항 알려줘", "판콜 먹을 때 조심할 거 있어?"],
    keywords: ["약", "의약품", "효능", "복용법", "용법", "주의사항", "부작용", "상호작용", "감기약", "진통제", "해열제", "상비약", "식약처"],
    source: "식품의약품안전처 e약은요·안전상비의약품 (공공데이터포털)",
    endpoints: [
      {
        id: "lookup",
        path: "/v1/mfds/drug-safety/lookup",
        summary: "약 이름으로 공식 의약품 정보 조회",
        params: [
          { name: "itemName", type: "string", required: true, maxLength: 50, description: "약 이름 (예: 타이레놀)" },
          { name: "limit", type: "integer", min: 1, max: 10, description: "자료원별 받을 개수 (기본 5)" },
        ],
        listPath: "items",
        fields: ["item_name", "company_name", "efficacy", "how_to_use", "warnings", "cautions", "interactions", "side_effects"],
        sample: { itemName: "타이레놀", limit: 3 },
        verified: { status: 200, bytes: 13703, checkedAt: "2026-10-27T18:20:55+09:00" },
      },
    ],
    notes: "증상이나 복용 상황을 물으면 누가(아이·임산부·고령자), 무엇을, 언제 먹었는지 먼저 되묻고, 호흡곤란·의식저하·심한 발진 같은 응급 징후면 조회보다 119·응급실 안내가 먼저예요. 공식 문구만 요약하고 진단·처방·복용 지시는 하지 않으며 최종 판단은 약사·의사에게 확인하라고 해요.",
  },
  {
    id: "nhis-care-checkup-search",
    name: "건강검진기관",
    category: "health",
    summary: "국민건강보험공단 자료로 지역별 건강검진기관과 연락처를 찾아줘요.",
    examples: ["강남구에서 건강검진 받을 수 있는 병원 찾아줘", "성북구 검진기관 알려줘"],
    keywords: ["건강검진", "검진", "검진기관", "국가검진", "병원", "의원", "건강보험", "암검진", "위내시경", "건보공단"],
    source: "국민건강보험공단 검진기관 찾기 (공공데이터포털)",
    endpoints: [
      {
        id: "checkup-by-region",
        path: "/v1/nhis/checkup/by-region",
        summary: "시도·시군구 코드(와 기관 이름)로 검진기관 찾기",
        params: [
          { name: "sido", type: "string", pattern: "^\\d{2}$", description: "시도 코드 2자리 (예: 11 서울)" },
          { name: "sigungu", type: "string", pattern: "^\\d{3}$", description: "시군구 코드 3자리 (예: 680 강남구)" },
          { name: "q", type: "string", maxLength: 50, description: "기관 이름 일부" },
          { name: "page", type: "integer", min: 1, max: 100, description: "페이지" },
          { name: "limit", type: "integer", min: 1, max: 100, description: "받을 개수 (기본 10)" },
        ],
        listPath: "response.body.items.item",
        fields: ["hmcNm", "ykindnm", "locAddr", "hmcTelNo", "siGunGuCd"],
        sample: { sido: "11", sigungu: "680", limit: 5 },
        verified: { status: 200, bytes: 4082, checkedAt: "2026-10-27T18:23:47+09:00" },
      },
    ],
    notes: "지역 코드는 법정동 코드 앞 5자리를 2+3으로 나눈 값이에요(서울 강남구 11680 → sido 11, sigungu 680). real-estate-search의 지역코드 찾기로 얻을 수 있어요. 검진 항목·예약은 기관에 직접 확인하라고 안내하고 의료 판단은 하지 않아요.",
  },

  // ── 생활 ──────────────────────────────────────────────────
  {
    id: "household-waste-info",
    name: "쓰레기 배출일",
    category: "life",
    summary: "시군구별 생활쓰레기·음식물·재활용 배출 요일과 시간, 장소를 알려줘요.",
    examples: ["강남구 쓰레기 버리는 요일 알려줘", "우리 동네 음식물쓰레기 몇 시에 버려?"],
    keywords: ["쓰레기", "분리수거", "재활용", "음식물쓰레기", "생활쓰레기", "배출", "배출요일", "배출시간", "종량제", "수거"],
    source: "행정안전부 생활쓰레기 배출정보 (공공데이터포털)",
    endpoints: [
      {
        id: "info",
        path: "/v1/household-waste/info",
        summary: "시군구 이름으로 배출 요일·시간·장소 조회",
        params: [
          { name: "cond[SGG_NM::LIKE]", type: "string", required: true, maxLength: 30, description: "시군구 이름 (예: 강남구, 수원시)" },
          { name: "pageNo", type: "enum", required: true, values: ["1"], description: "항상 1" },
          { name: "numOfRows", type: "enum", required: true, values: ["100"], description: "항상 100" },
        ],
        listPath: "response.body.items.item",
        fields: [
          "MNG_ZONE_NM",
          "MNG_ZONE_TRGT_RGN_NM",
          "EMSN_PLC",
          "LF_WST_EMSN_DOW",
          "LF_WST_EMSN_BGNG_TM",
          "LF_WST_EMSN_END_TM",
          "FOD_WST_EMSN_DOW",
          "RCYCL_EMSN_DOW",
        ],
        sample: { "cond[SGG_NM::LIKE]": "강남구", pageNo: "1", numOfRows: "100" },
        verified: { status: 200, bytes: 1723, checkedAt: "2026-10-27T18:15:53+09:00" },
      },
    ],
    notes: "지역을 모르면 시군구부터 물어봐요. pageNo는 1, numOfRows는 100만 허용돼요. 요일은 '일+월+화'처럼 +로 이어져 있고, 관리구역이 여러 개면 대상 동 목록(MNG_ZONE_TRGT_RGN_NM)으로 맞는 곳을 골라요.",
  },
  {
    id: "korean-holiday-calendar",
    name: "공휴일 달력",
    category: "life",
    summary: "한국천문연구원 자료로 공휴일, 대체공휴일, 기념일, 24절기를 알려줘요.",
    examples: ["올해 12월 공휴일 알려줘", "다음 달에 대체공휴일 있어?", "2026년 24절기 언제야?"],
    keywords: ["공휴일", "휴일", "빨간날", "대체공휴일", "연휴", "국경일", "기념일", "절기", "24절기", "명절", "달력"],
    source: "한국천문연구원 특일 정보 (공공데이터포털)",
    endpoints: [
      {
        id: "calendar",
        path: "/v1/korean-holiday/calendar",
        summary: "연도·월별 공휴일·국경일·기념일·절기 조회",
        params: [
          {
            name: "operation",
            type: "enum",
            values: ["rest", "national", "anniversary", "solarTerm", "sundry"],
            description: "rest 공휴일(기본), national 국경일, anniversary 기념일, solarTerm 24절기, sundry 잡절",
          },
          { name: "year", type: "string", required: true, pattern: "^20\\d{2}$", description: "연도 4자리 (예: 2026)" },
          { name: "month", type: "string", pattern: "^(0[1-9]|1[0-2])$", description: "월 2자리 (예: 08). 비우면 한 해 전체" },
          { name: "page", type: "integer", min: 1, max: 100, description: "페이지" },
          { name: "limit", type: "integer", min: 1, max: 1000, description: "받을 개수 (기본 100)" },
        ],
        listPath: "response.body.items.item",
        fields: ["locdate", "dateName", "isHoliday", "dateKind"],
        sample: { operation: "rest", year: "2026", month: "10" },
        verified: { status: 200, bytes: 660, checkedAt: "2026-10-27T18:15:55+09:00" },
      },
    ],
    notes: "isHoliday가 Y면 쉬는 날이에요. '오늘 공휴일이야?'는 한국 시간 오늘 날짜(YYYYMMDD)를 locdate와 비교해 답해요.",
  },

  // ── 문화·공연 ──────────────────────────────────────────────
  {
    id: "library-book-search",
    name: "도서관 책 찾기",
    category: "culture",
    summary: "도서관 정보나루로 책을 찾고, 그 책이 있는 도서관과 대출 가능 여부를 알려줘요.",
    examples: ["역사책 많이 빌려 보는 거 찾아줘", "'역사의 역사' 있는 서울 도서관 알려줘", "그 도서관에서 지금 대출 가능해?"],
    keywords: ["도서관", "책", "도서", "대출", "소장", "ISBN", "저자", "출판사", "인기도서", "독서"],
    source: "국립중앙도서관 도서관 정보나루",
    endpoints: [
      {
        id: "book-search",
        path: "/v1/data4library/book-search",
        summary: "키워드로 책 검색",
        params: [
          { name: "keyword", type: "string", required: true, maxLength: 100, description: "검색어 (제목·저자·주제)" },
          { name: "pageNo", type: "integer", min: 1, max: 100, description: "페이지" },
          { name: "pageSize", type: "integer", min: 1, max: 50, description: "받을 개수 (예: 10)" },
        ],
        listPath: "response.docs",
        fields: ["doc.bookname", "doc.authors", "doc.publisher", "doc.publication_year", "doc.isbn13", "doc.loan_count"],
        sample: { keyword: "역사", pageNo: 1, pageSize: 10 },
        verified: { status: 200, bytes: 4942, checkedAt: "2026-10-27T18:15:56+09:00" },
      },
      {
        id: "book-detail",
        path: "/v1/data4library/book-detail",
        summary: "ISBN으로 책 상세 정보 보기",
        params: [
          { name: "isbn13", type: "string", required: true, pattern: "^\\d{13}$", description: "ISBN 13자리 (예: 9788971998557)" },
          { name: "loaninfoYN", type: "enum", values: ["Y", "N"], description: "대출 통계도 받을지 (Y/N)" },
        ],
        listPath: "response.detail",
        fields: ["book.bookname", "book.authors", "book.publisher", "book.publication_year", "book.isbn13", "book.class_nm", "book.description"],
        sample: { isbn13: "9788971998557", loaninfoYN: "Y" },
        verified: { status: 200, bytes: 1153, checkedAt: "2026-10-27T18:15:57+09:00" },
      },
      {
        id: "libraries-by-book",
        path: "/v1/data4library/libraries-by-book",
        summary: "ISBN과 지역으로 그 책이 있는 도서관 찾기",
        params: [
          { name: "isbn", type: "string", required: true, pattern: "^(\\d{13}|\\d{9}[\\dXx])$", description: "ISBN 13자리 또는 10자리" },
          { name: "region", type: "string", required: true, pattern: "^\\d{2}$", description: "도서관 정보나루 지역 코드 2자리 (예: 11 서울)" },
          { name: "pageNo", type: "integer", min: 1, max: 100, description: "페이지" },
          { name: "pageSize", type: "integer", min: 1, max: 50, description: "받을 개수 (예: 10)" },
        ],
        listPath: "response.libs",
        fields: ["lib.libCode", "lib.libName", "lib.address", "lib.tel", "lib.operatingTime", "lib.closed", "lib.homepage"],
        sample: { isbn: "9788971998557", region: "11", pageNo: 1, pageSize: 10 },
        verified: { status: 200, bytes: 4108, checkedAt: "2026-10-27T18:15:59+09:00" },
      },
      {
        id: "book-exists",
        path: "/v1/data4library/book-exists",
        summary: "특정 도서관의 소장·대출 가능 여부 확인",
        params: [
          { name: "libraryCode", type: "string", required: true, pattern: "^\\d{6}$", description: "도서관 코드 6자리 (소장 도서관 찾기의 libCode)" },
          { name: "isbn13", type: "string", required: true, pattern: "^\\d{13}$", description: "ISBN 13자리" },
        ],
        sample: { libraryCode: "711618", isbn13: "9788971998557" },
        verified: { status: 200, bytes: 303, checkedAt: "2026-10-27T18:20:43+09:00" },
      },
    ],
    notes: "책 검색으로 ISBN을, 소장 도서관 찾기로 도서관 코드를 얻은 뒤 대출 가능 여부를 확인해요. hasBook·loanAvailable이 Y면 소장·대출 가능이고, 도서관 반영이 늦을 수 있어 방문 전 확인을 권해요.",
  },
  {
    id: "kopis-performance-search",
    name: "공연 찾기",
    category: "culture",
    summary: "공연예술통합전산망(KOPIS)으로 기간·지역별 공연과 공연장 정보를 찾아줘요.",
    examples: ["다음 달 서울에서 하는 뮤지컬 알려줘", "세종문화회관 주차 돼?", "이 공연 가격이랑 시간 알려줘"],
    keywords: ["공연", "연극", "뮤지컬", "콘서트", "클래식", "국악", "무용", "공연장", "관람", "티켓", "공연시간", "세종문화회관"],
    source: "예술경영지원센터 공연예술통합전산망(KOPIS)",
    endpoints: [
      {
        id: "performances",
        path: "/v1/kopis/performances",
        summary: "기간·지역·장르로 공연 목록 조회",
        params: [
          { name: "start", type: "string", required: true, pattern: ymd8, description: "시작일 YYYYMMDD" },
          { name: "end", type: "string", required: true, pattern: ymd8, description: "종료일 YYYYMMDD (시작일부터 한 달 이내)" },
          {
            name: "genre",
            type: "enum",
            values: ["AAAA", "GGGA", "CCCA", "CCCC", "CCCD", "BBBC", "BBBE", "EEEA", "EEEB"],
            description: "AAAA 연극, GGGA 뮤지컬, CCCA 클래식, CCCC 국악, CCCD 대중음악, BBBC 무용, BBBE 대중무용, EEEA 복합, EEEB 서커스·마술",
          },
          { name: "areaCode", type: "string", pattern: "^\\d{2}$", description: "시도 코드 2자리 (예: 11 서울)" },
          { name: "prfstate", type: "enum", values: ["01", "02", "03"], description: "01 공연예정, 02 공연중, 03 공연완료" },
          { name: "page", type: "integer", min: 1, max: 100, description: "페이지" },
          { name: "limit", type: "integer", min: 1, max: 50, description: "받을 개수 (예: 10)" },
        ],
        listPath: "dbs.db",
        fields: ["mt20id", "prfnm", "prfpdfrom", "prfpdto", "fcltynm", "area", "genrenm", "prfstate"],
        sample: { start: "20261101", end: "20261130", areaCode: "11", limit: 10 },
        verified: { status: 200, bytes: 3993, checkedAt: "2026-10-27T18:16:03+09:00" },
      },
      {
        id: "performance-detail",
        path: "/v1/kopis/performances/{id}",
        summary: "공연 ID로 가격·공연 시간·관람 연령 보기",
        params: [
          { name: "id", type: "string", required: true, pattern: "^PF\\d{4,8}$", description: "공연 ID (목록의 mt20id, 예: PF304625)" },
        ],
        listPath: "dbs.db",
        fields: ["prfnm", "prfpdfrom", "prfpdto", "fcltynm", "dtguidance", "pcseguidance", "prfruntime", "prfage"],
        sample: { id: "PF304625" },
        verified: { status: 200, bytes: 1431, checkedAt: "2026-10-27T18:20:39+09:00" },
      },
      {
        id: "facilities",
        path: "/v1/kopis/facilities",
        summary: "공연장 이름으로 시설 찾기",
        params: [
          { name: "q", type: "string", required: true, maxLength: 50, description: "공연장 이름 (예: 세종문화회관)" },
          { name: "areaCode", type: "string", pattern: "^\\d{2}$", description: "시도 코드 2자리 (예: 11 서울)" },
          { name: "page", type: "integer", min: 1, max: 100, description: "페이지" },
          { name: "limit", type: "integer", min: 1, max: 50, description: "받을 개수 (예: 5)" },
        ],
        listPath: "dbs.db",
        fields: ["mt10id", "fcltynm", "sidonm", "gugunnm", "fcltychartr", "mt13cnt", "opende"],
        sample: { q: "세종문화회관", limit: 5 },
        verified: { status: 200, bytes: 276, checkedAt: "2026-10-27T18:16:04+09:00" },
      },
      {
        id: "facility-detail",
        path: "/v1/kopis/facilities/{id}",
        summary: "공연장 ID로 주소·좌석·주차·편의시설 보기",
        params: [
          { name: "id", type: "string", required: true, pattern: "^FC\\d{4,8}$", description: "공연장 ID (시설 찾기의 mt10id, 예: FC000020)" },
        ],
        listPath: "dbs.db",
        fields: ["fcltynm", "adres", "telno", "relateurl", "seatscale", "parkinglot", "restaurant", "cafe"],
        sample: { id: "FC000020" },
        verified: { status: 200, bytes: 3062, checkedAt: "2026-10-27T18:20:40+09:00" },
      },
    ],
    notes: "공연 목록은 기간을 한 달 이내로 좁혀 찾고, 상세는 목록의 mt20id로 봐요. 답에 공연 ID와 출처(KOPIS)를 같이 적고, 예매·좌석·결제는 하지 않아요.",
  },

  // ── 뉴스 ──────────────────────────────────────────────────
  {
    id: "naver-news-search",
    name: "뉴스 검색",
    category: "news",
    summary: "네이버 뉴스 검색으로 최신 기사 제목과 요약, 링크를 찾아줘요.",
    examples: ["오늘 삼성전자 관련 뉴스 찾아줘", "금리 인상 최신 기사 5개 알려줘"],
    keywords: ["뉴스", "기사", "속보", "최신", "보도", "언론", "헤드라인", "이슈", "소식", "네이버뉴스"],
    source: "네이버 검색 Open API (뉴스)",
    endpoints: [
      {
        id: "search",
        path: "/v1/naver-news/search",
        summary: "검색어로 뉴스 기사 목록 조회",
        params: [
          { name: "q", type: "string", required: true, maxLength: 100, pattern: "^.{2,}$", description: "검색어 2글자 이상 (예: 삼성전자 실적)" },
          { name: "display", type: "integer", min: 1, max: 100, description: "받을 건수 (기본 10)" },
          { name: "start", type: "integer", min: 1, max: 1000, description: "시작 위치. start+display-1은 1000 이하" },
          { name: "sort", type: "enum", values: ["sim", "date"], description: "sim 관련도순(기본), date 최신순" },
        ],
        listPath: "items",
        fields: ["title", "description", "pub_date_iso", "original_link", "link"],
        sample: { q: "삼성전자", display: 5, sort: "date" },
        verified: { status: 200, bytes: 3867, checkedAt: "2026-10-27T18:16:06+09:00" },
      },
    ],
    notes: "'최신'을 원하면 sort=date로 불러요. 제목·요약은 기사 요약이라 '기사에 따르면'으로 전하고, pub_date_iso(UTC)는 한국 시간으로 바꿔 말하며 원문 링크를 함께 줘요.",
  },
]);
