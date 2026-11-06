/**
 * 메일 서버 자동 찾기 런타임.
 *
 * 사용자가 서버 주소를 모르는 학교·공공기관·회사 메일을 위해
 * 이메일 주소만으로 IMAP 서버를 찾아냅니다.
 *
 * 순서: MX/SRV 조회 → 도메인 자동구성(autoconfig) → 후보 생성(도메인 순수 로직)
 *      → DNS 존재 확인으로 재정렬 → TCP 접속 확인 → 첫 성공 후보 반환.
 *
 * 안전 경계:
 *  - 읽기 전용 탐색입니다. 로그인/메일 읽기/발송을 하지 않습니다.
 *  - 자격정보(아이디·비밀번호)를 받지 않습니다. 도메인 정보만 씁니다.
 *  - 실패하면 학교/회사 IT 담당자에게 그대로 보낼 문의 문장을 만들어 돌려줍니다.
 */

import dns from "node:dns/promises";
import net from "node:net";
import { pathToFileURL } from "node:url";

import { resolveDesktopDomainEntryPath } from "./runtime-paths.mjs";

const probeTimeoutMs = 3_000;
const autoconfigTimeoutMs = 4_000;
const maxProbeCandidates = 8;

let domainRuntimePromise;

async function loadDomainRuntime(options = {}) {
  if (!domainRuntimePromise) {
    // 설치본에서 도메인 런타임은 resources/domain 에 들어간다(electron-builder extraResources).
    // 예전에는 여기서만 process.cwd() 기준 개발 경로(packages/domain/dist)를 직접 조립해서,
    // 패키지 앱의 '서버 자동 찾기' 가 항상 Cannot find module 로 죽었다. 학교·기관 메일에는
    // 이 버튼이 유일한 탈출구인데 설치본에서만 막히는 형태라 dev 실행으로는 잡히지 않았다.
    // 형제 핸들러들이 이미 쓰는 공용 헬퍼로 통일한다.
    const domainEntryPath =
      options.domainEntryPath ?? resolveDesktopDomainEntryPath({ repoRoot: options.repoRoot });
    // 실패를 캐시하지 않는다 — 일시적 원인(경로 준비 전 호출 등)으로 한 번 실패했다고
    // 앱을 재시작할 때까지 버튼이 영구히 죽으면 안 된다.
    domainRuntimePromise = import(pathToFileURL(domainEntryPath).href).catch((error) => {
      domainRuntimePromise = undefined;
      throw error;
    });
  }
  return domainRuntimePromise;
}

async function resolveMxHosts(domain) {
  try {
    const records = await dns.resolveMx(domain);
    return records
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((record) => String(record.exchange ?? "").toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function resolveSrvTargets(domain) {
  const targets = [];
  for (const [name, secure] of [
    [`_imaps._tcp.${domain}`, true],
    [`_imap._tcp.${domain}`, false],
  ]) {
    try {
      const records = await dns.resolveSrv(name);
      for (const record of records) {
        const target = String(record.name ?? "").toLowerCase();
        if (!target || target === ".") continue;
        targets.push({ target, port: Number(record.port) || (secure ? 993 : 143), secure });
      }
    } catch {
      // SRV 미공개는 정상 — 다음 단계로 넘어갑니다.
    }
  }
  return targets;
}

/** Thunderbird ISPDB + 도메인 자체 autoconfig XML 에서 IMAP 호스트를 찾습니다. */
async function resolveAutoconfigHosts(domain, fetchImpl) {
  const doFetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
  if (typeof doFetch !== "function") return [];
  const urls = [
    `https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`,
    `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=user@${domain}`,
  ];
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), autoconfigTimeoutMs);
      const response = await doFetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
      if (!response?.ok) continue;
      const xml = await response.text();
      const hosts = parseAutoconfigImapHosts(xml);
      if (hosts.length) return hosts;
    } catch {
      // 자동구성 미제공/네트워크 실패는 무시하고 다음 단계로 갑니다.
    }
  }
  return [];
}

/** autoconfig XML 에서 incomingServer type="imap" 의 hostname/port/보안 방식을 뽑습니다. */
export function parseAutoconfigImapHosts(xml) {
  const text = String(xml ?? "");
  const hosts = [];
  const blockPattern = /<incomingServer[^>]*type=["']imap["'][^>]*>([\s\S]*?)<\/incomingServer>/giu;
  let match = blockPattern.exec(text);
  while (match) {
    const block = match[1] ?? "";
    const host = /<hostname>\s*([^<\s]+)\s*<\/hostname>/iu.exec(block)?.[1];
    const port = Number(/<port>\s*(\d+)\s*<\/port>/iu.exec(block)?.[1] ?? "");
    const socketType = /<socketType>\s*([^<\s]+)\s*<\/socketType>/iu.exec(block)?.[1] ?? "";
    if (host) {
      hosts.push({
        host: host.toLowerCase(),
        port: Number.isFinite(port) && port > 0 ? port : 993,
        secure: /ssl/iu.test(socketType) || port === 993,
      });
    }
    match = blockPattern.exec(text);
  }
  return hosts;
}

async function hostResolves(host) {
  try {
    const addresses = await dns.resolve4(host);
    if (Array.isArray(addresses) && addresses.length) return true;
  } catch {
    // A 레코드 없으면 AAAA 도 확인합니다.
  }
  try {
    const addresses = await dns.resolve6(host);
    return Array.isArray(addresses) && addresses.length > 0;
  } catch {
    return false;
  }
}

/** TCP 접속만 확인합니다(로그인하지 않음). */
function probeTcpPort(host, port, timeoutMs = probeTimeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    try {
      socket.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

/**
 * 이메일 주소만으로 IMAP 서버를 찾습니다.
 * payload: { email }
 */
export async function discoverMailServer(payload = {}, options = {}) {
  const domainRuntime = await loadDomainRuntime(options);
  const {
    createMailAutodiscoveryPlan,
    createMailAutodiscoveryHelpRequest,
    extractMailDomain,
  } = domainRuntime;

  const email = String(payload.email ?? "").trim();
  const mailDomain = extractMailDomain(email);
  if (!mailDomain) {
    return {
      status: "mail_autodiscovery_invalid_email",
      userMessage: "이메일 주소를 정확히 입력해 주세요. 예: 이름@school.ac.kr",
      email,
      externalMutation: false,
      rawSecretMaterialStored: false,
    };
  }

  const resolveDns = options.resolveDns ?? {
    mx: resolveMxHosts,
    srv: resolveSrvTargets,
    exists: hostResolves,
  };
  const probe = options.probeTcpPort ?? probeTcpPort;

  const [mxHosts, srvTargets, autoconfigHosts] = await Promise.all([
    resolveDns.mx(mailDomain),
    resolveDns.srv(mailDomain),
    options.skipAutoconfig ? Promise.resolve([]) : resolveAutoconfigHosts(mailDomain, options.fetch),
  ]);

  const draftPlan = createMailAutodiscoveryPlan({ email, mxHosts, srvTargets, autoconfigHosts });
  if (!draftPlan.candidates.length) {
    return {
      status: "mail_autodiscovery_no_candidate",
      userMessage: "서버 후보를 만들지 못했습니다. 메일 주소를 다시 확인해 주세요.",
      email,
      domain: mailDomain,
      externalMutation: false,
      rawSecretMaterialStored: false,
    };
  }

  // DNS 에 실제로 존재하는 후보만 앞으로 올립니다(없는 주소로 접속 시도해 시간 낭비 방지).
  const uniqueHosts = [...new Set(draftPlan.candidates.map((candidate) => candidate.host))];
  const existence = await Promise.all(uniqueHosts.map(async (host) => [host, await resolveDns.exists(host)]));
  const resolvedHosts = existence.filter(([, exists]) => exists).map(([host]) => host);

  const plan = createMailAutodiscoveryPlan({
    email,
    mxHosts,
    srvTargets,
    autoconfigHosts,
    resolvedHosts,
  });

  const attempts = [];
  let match = null;
  for (const candidate of plan.candidates.slice(0, maxProbeCandidates)) {
    if (resolvedHosts.length && !resolvedHosts.includes(candidate.host)) {
      attempts.push({ host: candidate.host, port: candidate.port, result: "dns_not_found" });
      continue;
    }
    const securePortOpen = await probe(candidate.host, 993);
    if (securePortOpen) {
      match = { host: candidate.host, port: 993, secure: true, label: candidate.label, source: candidate.source };
      attempts.push({ host: candidate.host, port: 993, result: "reachable" });
      break;
    }
    attempts.push({ host: candidate.host, port: 993, result: "unreachable" });

    const startTlsOpen = await probe(candidate.host, 143);
    if (startTlsOpen) {
      match = { host: candidate.host, port: 143, secure: false, label: candidate.label, source: candidate.source };
      attempts.push({ host: candidate.host, port: 143, result: "reachable" });
      break;
    }
    attempts.push({ host: candidate.host, port: 143, result: "unreachable" });
  }

  if (!match) {
    const help = createMailAutodiscoveryHelpRequest({
      email,
      attemptedHosts: attempts.map((attempt) => attempt.host),
    });
    return {
      status: "mail_autodiscovery_not_found",
      userMessage:
        plan.providerKind === "google_workspace"
          ? "이 도메인은 구글이 메일을 운영합니다. 학교/기관 계정으로 구글 로그인 방식이 필요할 수 있습니다."
          : plan.providerKind === "microsoft365"
            ? "이 도메인은 마이크로소프트가 메일을 운영합니다. 기관 계정 로그인 방식이 필요할 수 있습니다."
            : "메일 서버를 자동으로 찾지 못했습니다. 아래 문의 문장을 학교/회사 IT 담당자에게 보내면 필요한 값을 바로 받을 수 있습니다.",
      email,
      domain: mailDomain,
      providerKind: plan.providerKind,
      oauthRecommended: plan.oauthRecommended,
      notes: plan.notes,
      attempts,
      helpRequest: help,
      externalMutation: false,
      rawSecretMaterialStored: false,
    };
  }

  return {
    status: "mail_autodiscovery_found",
    userMessage:
      plan.providerKind === "known_provider"
        ? `${match.label}로 확인했습니다. 이제 앱 비밀번호만 넣으면 됩니다.`
        : `메일 서버를 찾았습니다: ${match.host} (포트 ${match.port}). 아이디와 앱 비밀번호만 넣으면 됩니다.`,
    email,
    domain: mailDomain,
    providerKind: plan.providerKind,
    knownProviderId: plan.knownProviderId,
    oauthRecommended: plan.oauthRecommended,
    imapHost: match.host,
    imapPort: match.port,
    secure: match.secure,
    matchSource: match.source,
    notes: plan.notes,
    attempts,
    externalMutation: false,
    rawSecretMaterialStored: false,
  };
}

export async function handleMailAutodiscoveryMessage(payload = {}, options = {}) {
  const kind = String(payload.kind ?? "discover");
  if (kind !== "discover") {
    return {
      status: "mail_autodiscovery_unsupported_kind",
      userMessage: "지원하지 않는 자동 찾기 요청입니다.",
      externalMutation: false,
    };
  }
  return discoverMailServer(payload.payload ?? payload, options);
}
