/**
 * 메일 서버 자동 탐색(autodiscovery) — 학교·공공기관·회사 메일처럼
 * 사용자가 서버 주소를 모르는 경우를 위해, 이메일 주소만으로 후보 목록을 만듭니다.
 *
 * 왜 필요한가: 기존 추정은 `imap.<도메인>` 하나만 시도했는데
 * 국내 대학·기관은 `mail.<도메인>` 형태가 훨씬 많습니다.
 * (실측 예: koreatech.ac.kr → imap.* 없음, mail.* 존재 + IMAP 993 개방)
 *
 * 이 모듈은 순수 함수만 담습니다(네트워크 I/O 없음).
 * DNS(MX/SRV/A) 조회와 실제 접속 시도는 데스크톱 런타임이 수행하고,
 * 그 결과를 입력으로 넣어 우선순위가 매겨진 후보 목록을 받습니다.
 */

export type MailAutodiscoverySource =
  | "known_provider"
  | "srv_record"
  | "autoconfig"
  | "mx_hosted_google"
  | "mx_hosted_microsoft"
  | "mx_domain_pattern"
  | "host_pattern";

export type MailAutodiscoveryProviderKind =
  | "known_provider"
  | "google_workspace"
  | "microsoft365"
  | "self_hosted"
  | "unknown";

export type MailAutodiscoveryCandidate = {
  host: string;
  port: number;
  secure: boolean;
  /** 사용자에게 보여줄 짧은 설명 */
  label: string;
  source: MailAutodiscoverySource;
  /** 이 후보를 DNS에서 확인했는지 (런타임이 채웁니다) */
  dnsResolved?: boolean;
};

export type MailAutodiscoveryHint = {
  /** MX 레코드의 교환 호스트 목록 (예: aspmx.l.google.com) */
  mxHosts?: string[];
  /** _imaps._tcp / _imap._tcp SRV 결과 */
  srvTargets?: Array<{ target: string; port: number; secure?: boolean }>;
  /** Thunderbird ISPDB / autoconfig XML 에서 얻은 IMAP 호스트 */
  autoconfigHosts?: Array<{ host: string; port?: number; secure?: boolean }>;
  /** DNS A 레코드가 실제로 존재하는 호스트 목록 (런타임이 걸러 넣음) */
  resolvedHosts?: string[];
};

export type MailAutodiscoveryPlan = {
  email: string;
  domain: string;
  providerKind: MailAutodiscoveryProviderKind;
  /** 알려진 국내/글로벌 제공사인 경우의 식별자 */
  knownProviderId?: string;
  candidates: MailAutodiscoveryCandidate[];
  /** OAuth(계정 동의)로 가야 하는 경우 안내 */
  oauthRecommended: boolean;
  notes: string[];
};

/** 자주 쓰는 제공사 — 이 표에 있으면 탐색 없이 바로 확정합니다. */
const knownProviders: Array<{
  id: string;
  label: string;
  domains: string[];
  host: string;
  port: number;
  oauthPreferred?: boolean;
}> = [
  { id: "gmail", label: "Gmail", domains: ["gmail.com", "googlemail.com"], host: "imap.gmail.com", port: 993, oauthPreferred: true },
  { id: "naver-mail", label: "NAVER 메일", domains: ["naver.com"], host: "imap.naver.com", port: 993 },
  { id: "daum-kakao-mail", label: "Daum 메일", domains: ["daum.net", "hanmail.net"], host: "imap.daum.net", port: 993 },
  { id: "kakao-mail", label: "Kakao 메일", domains: ["kakao.com"], host: "imap.kakao.com", port: 993 },
  { id: "nate-mail", label: "네이트 메일", domains: ["nate.com"], host: "imap.mail.nate.com", port: 993 },
  {
    id: "outlook",
    label: "Outlook / 핫메일",
    domains: ["outlook.com", "outlook.kr", "hotmail.com", "hotmail.co.kr", "live.com", "live.co.kr", "msn.com"],
    host: "outlook.office365.com",
    port: 993,
    oauthPreferred: true,
  },
  { id: "icloud-mail", label: "iCloud 메일", domains: ["icloud.com", "me.com", "mac.com"], host: "imap.mail.me.com", port: 993 },
  { id: "yahoo-mail", label: "Yahoo 메일", domains: ["yahoo.com", "yahoo.co.kr", "ymail.com", "rocketmail.com"], host: "imap.mail.yahoo.com", port: 993 },
];

/**
 * 국내 학교·기관 자체 운영 메일에서 실제로 자주 쓰이는 호스트 접두사.
 * `imap.` 만 시도하던 기존 로직이 국내 대학에서 대부분 실패했기에 순서를 조정했습니다.
 */
const hostPatternPrefixes = ["mail", "imap", "email", "webmail", "imap.mail", "mail2", "mx", "mailsvr", "post"];

export function extractMailDomain(email: string): string {
  const raw = String(email ?? "").trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at < 0) return "";
  const domain = raw.slice(at + 1).replace(/[>\s]/gu, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/u.test(domain) ? domain : "";
}

function isGoogleHostedMx(mxHosts: string[]): boolean {
  return mxHosts.some((host) => /(^|\.)google\.com$|(^|\.)googlemail\.com$|aspmx.*\.google\.com$/iu.test(host));
}

function isMicrosoftHostedMx(mxHosts: string[]): boolean {
  return mxHosts.some((host) => /mail\.protection\.outlook\.com$|(^|\.)outlook\.com$/iu.test(host));
}

function normalizeHost(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\.$/u, "");
}

function pushCandidate(
  list: MailAutodiscoveryCandidate[],
  seen: Set<string>,
  candidate: MailAutodiscoveryCandidate,
): void {
  const host = normalizeHost(candidate.host);
  if (!host || !host.includes(".")) return;
  const key = `${host}:${candidate.port}`;
  if (seen.has(key)) return;
  seen.add(key);
  list.push({ ...candidate, host });
}

/**
 * 이메일 주소(+ 런타임이 조회한 힌트)로 우선순위가 매겨진 IMAP 서버 후보를 만듭니다.
 * 앞쪽 후보부터 접속을 시도하면 됩니다.
 */
export function createMailAutodiscoveryPlan(
  input: { email: string } & MailAutodiscoveryHint,
): MailAutodiscoveryPlan {
  const email = String(input.email ?? "").trim();
  const domain = extractMailDomain(email);
  const notes: string[] = [];
  const candidates: MailAutodiscoveryCandidate[] = [];
  const seen = new Set<string>();

  if (!domain) {
    return {
      email,
      domain: "",
      providerKind: "unknown",
      candidates: [],
      oauthRecommended: false,
      notes: ["이메일 주소 형식을 확인해 주세요. 예: name@school.ac.kr"],
    };
  }

  const known = knownProviders.find((provider) => provider.domains.includes(domain));
  if (known) {
    pushCandidate(candidates, seen, {
      host: known.host,
      port: known.port,
      secure: true,
      label: `${known.label} 기본 서버`,
      source: "known_provider",
    });
    notes.push(`${known.label}로 확인했습니다. 서버 주소를 입력할 필요가 없습니다.`);
    return {
      email,
      domain,
      providerKind: "known_provider",
      knownProviderId: known.id,
      candidates,
      oauthRecommended: known.oauthPreferred === true,
      notes,
    };
  }

  const mxHosts = (input.mxHosts ?? []).map(normalizeHost).filter(Boolean);
  const srvTargets = input.srvTargets ?? [];
  const autoconfigHosts = input.autoconfigHosts ?? [];
  const resolvedHosts = new Set((input.resolvedHosts ?? []).map(normalizeHost).filter(Boolean));

  // 1순위: SRV 레코드(RFC 6186) — 기관이 공식적으로 알려주는 값
  for (const srv of srvTargets) {
    const host = normalizeHost(srv.target);
    if (!host) continue;
    const port = Number(srv.port) > 0 ? Number(srv.port) : 993;
    pushCandidate(candidates, seen, {
      host,
      port,
      secure: srv.secure ?? port !== 143,
      label: "기관이 공개한 메일 서버(SRV)",
      source: "srv_record",
    });
  }
  if (srvTargets.length) notes.push("도메인이 공개한 SRV 레코드에서 메일 서버를 찾았습니다.");

  // 2순위: autoconfig(Thunderbird ISPDB 등)
  for (const entry of autoconfigHosts) {
    const host = normalizeHost(entry.host);
    if (!host) continue;
    const port = Number(entry.port) > 0 ? Number(entry.port) : 993;
    pushCandidate(candidates, seen, {
      host,
      port,
      secure: entry.secure ?? port !== 143,
      label: "메일 설정 자동구성에서 찾은 서버",
      source: "autoconfig",
    });
  }
  if (autoconfigHosts.length) notes.push("공개 메일 설정 정보(autoconfig)에서 서버를 찾았습니다.");

  // 3순위: MX가 구글/MS 위탁이면 그쪽 서버 + OAuth 권고
  let providerKind: MailAutodiscoveryProviderKind = mxHosts.length ? "self_hosted" : "unknown";
  let oauthRecommended = false;
  if (isGoogleHostedMx(mxHosts)) {
    providerKind = "google_workspace";
    oauthRecommended = true;
    pushCandidate(candidates, seen, {
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      label: "구글 기반 기관 메일(Google Workspace)",
      source: "mx_hosted_google",
    });
    notes.push("이 도메인은 구글이 메일을 운영합니다(Google Workspace). 학교/기관 계정으로 구글 로그인하거나, IMAP을 켠 뒤 앱 비밀번호가 필요합니다.");
  } else if (isMicrosoftHostedMx(mxHosts)) {
    providerKind = "microsoft365";
    oauthRecommended = true;
    pushCandidate(candidates, seen, {
      host: "outlook.office365.com",
      port: 993,
      secure: true,
      label: "마이크로소프트 기반 기관 메일(Microsoft 365)",
      source: "mx_hosted_microsoft",
    });
    notes.push("이 도메인은 마이크로소프트가 메일을 운영합니다(Microsoft 365). 기관 계정 로그인 또는 IMAP 허용 여부를 확인해야 합니다.");
  }

  // 4순위: MX 호스트 자체의 도메인 패턴 (spam.school.ac.kr → mail.school.ac.kr 류)
  for (const mxHost of mxHosts) {
    if (!mxHost.endsWith(domain)) continue;
    for (const prefix of hostPatternPrefixes.slice(0, 3)) {
      pushCandidate(candidates, seen, {
        host: `${prefix}.${domain}`,
        port: 993,
        secure: true,
        label: "기관 메일 서버 후보",
        source: "mx_domain_pattern",
        ...(resolvedHosts.size ? { dnsResolved: resolvedHosts.has(`${prefix}.${domain}`) } : {}),
      });
    }
  }

  // 5순위: 일반 호스트 패턴 — 국내 기관에서 mail.* 이 가장 흔합니다.
  for (const prefix of hostPatternPrefixes) {
    const host = `${prefix}.${domain}`;
    pushCandidate(candidates, seen, {
      host,
      port: 993,
      secure: true,
      label: "자주 쓰이는 서버 이름 후보",
      source: "host_pattern",
      ...(resolvedHosts.size ? { dnsResolved: resolvedHosts.has(host) } : {}),
    });
  }

  // 도메인 자체도 후보 (mail 없이 school.ac.kr 로 받는 곳이 있습니다)
  pushCandidate(candidates, seen, {
    host: domain,
    port: 993,
    secure: true,
    label: "도메인 그대로 접속 후보",
    source: "host_pattern",
    ...(resolvedHosts.size ? { dnsResolved: resolvedHosts.has(domain) } : {}),
  });

  // DNS 확인된 후보를 앞으로 (확인 정보가 있을 때만 재정렬)
  const ordered = resolvedHosts.size
    ? [...candidates].sort((a, b) => {
        const rank = (candidate: MailAutodiscoveryCandidate) => {
          // 기관이 공개한 값(SRV/autoconfig)이 최우선.
          if (candidate.source === "srv_record" || candidate.source === "autoconfig") return 0;
          // 구글/MS 위탁 도메인은 위탁사 서버가 정답입니다.
          // (학교 도메인의 옛 mail.* 호스트가 우연히 993을 열어둔 경우보다 먼저 시도)
          if (candidate.source === "mx_hosted_google" || candidate.source === "mx_hosted_microsoft") return 1;
          if (candidate.dnsResolved) return 2;
          if (candidate.dnsResolved === false) return 4;
          return 3;
        };
        return rank(a) - rank(b);
      })
    : candidates;

  if (!notes.length) {
    notes.push("서버 주소를 모를 때 앱이 자주 쓰이는 이름부터 차례로 접속해 봅니다.");
  }

  return { email, domain, providerKind, candidates: ordered, oauthRecommended, notes };
}

/**
 * 자동 탐색이 모두 실패했을 때, 사용자가 학교/회사 IT 담당자에게 그대로 보낼 수 있는 문의 문장.
 * "어디서부터 물어야 하나" 막막함을 없애는 것이 목적입니다.
 */
export function createMailAutodiscoveryHelpRequest(input: {
  email: string;
  attemptedHosts?: string[];
}): { subject: string; body: string; checklist: string[] } {
  const email = String(input.email ?? "").trim();
  const domain = extractMailDomain(email);
  const attempted = (input.attemptedHosts ?? []).map(normalizeHost).filter(Boolean).slice(0, 8);

  const checklist = [
    "외부 메일 프로그램(IMAP) 접속이 허용되나요?",
    "허용된다면 IMAP 서버 주소와 포트를 알려주세요.",
    "일반 로그인 비밀번호로 되나요, 아니면 앱 전용 비밀번호를 발급해야 하나요?",
    "교내망(VPN) 안에서만 접속이 되나요?",
    "2단계 인증을 쓰는 계정도 IMAP을 쓸 수 있나요?",
  ];

  const body = [
    `안녕하세요. ${domain || "기관"} 메일을 업무 프로그램에 연결하려고 합니다.`,
    "메일을 읽기 전용으로만 가져오려 하며, 발송이나 삭제는 하지 않습니다.",
    "",
    "아래 내용을 확인해 주실 수 있을까요?",
    ...checklist.map((item, index) => `${index + 1}. ${item}`),
    ...(attempted.length
      ? ["", `참고로 다음 주소로 접속을 시도했지만 연결되지 않았습니다: ${attempted.join(", ")}`]
      : []),
    "",
    "감사합니다.",
  ].join("\n");

  return {
    subject: `${domain || "기관"} 메일 IMAP 접속 문의`,
    body,
    checklist,
  };
}
