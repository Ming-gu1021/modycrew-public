import { resolveMx as nodeResolveMx, resolveSrv as nodeResolveSrv } from "node:dns/promises";

const LOOKUP_TIMEOUT_MS = 5000;

const KNOWN_PROVIDERS = Object.freeze({
  "gmail.com": settings("google", "imap.gmail.com", 993, "smtp.gmail.com", 465, true, false),
  "googlemail.com": settings("google", "imap.gmail.com", 993, "smtp.gmail.com", 465, true, false),
  "naver.com": settings("naver", "imap.naver.com", 993, "smtp.naver.com", 465, true, false),
  "daum.net": settings("daum", "imap.daum.net", 993, "smtp.daum.net", 465, true, false),
  "hanmail.net": settings("daum", "imap.daum.net", 993, "smtp.daum.net", 465, true, false),
  "kakao.com": settings("kakao", "imap.kakao.com", 993, "smtp.kakao.com", 465, true, false),
  "outlook.com": settings("microsoft", "outlook.office365.com", 993, "smtp.office365.com", 587, false, true),
  "hotmail.com": settings("microsoft", "outlook.office365.com", 993, "smtp.office365.com", 587, false, true),
  "live.com": settings("microsoft", "outlook.office365.com", 993, "smtp.office365.com", 587, false, true),
  "icloud.com": settings("icloud", "imap.mail.me.com", 993, "smtp.mail.me.com", 587, false, true),
  "me.com": settings("icloud", "imap.mail.me.com", 993, "smtp.mail.me.com", 587, false, true),
  "mac.com": settings("icloud", "imap.mail.me.com", 993, "smtp.mail.me.com", 587, false, true),
});

export async function discoverMailServerSettings(emailAddress, options = {}) {
  const email = normalizeEmail(emailAddress);
  const domain = email.split("@")[1] || "";
  if (!domain) return emptyResult("invalid_email");

  const imapCandidates = [];
  const smtpCandidates = [];
  const add = (candidate, source) => {
    if (candidate?.imapHost) {
      imapCandidates.push({
        host: normalizeHost(candidate.imapHost),
        port: normalizePort(candidate.imapPort, 993),
        secure: candidate.imapSecure !== false,
        startTls: candidate.imapStartTls === true,
        source,
      });
    }
    if (candidate?.smtpHost) {
      smtpCandidates.push({
        host: normalizeHost(candidate.smtpHost),
        port: normalizePort(candidate.smtpPort, candidate.smtpSecure === false ? 587 : 465),
        secure: candidate.smtpSecure !== false,
        startTls: candidate.smtpStartTls === true,
        source,
      });
    }
  };

  const known = KNOWN_PROVIDERS[domain];
  if (known) add(known, "known_provider");

  const resolveMx = options.resolveMx ?? nodeResolveMx;
  const resolveSrv = options.resolveSrv ?? nodeResolveSrv;
  const mxRecords = await safeLookup(() => resolveMx(domain));
  const mxProvider = providerFromMx(mxRecords);
  if (mxProvider) add(mxProvider, "mx_provider");

  const [imapsSrv, submissionSrv] = await Promise.all([
    safeLookup(() => resolveSrv(`_imaps._tcp.${domain}`)),
    safeLookup(() => resolveSrv(`_submission._tcp.${domain}`)),
  ]);
  for (const row of prioritizeSrv(imapsSrv)) {
    add({ imapHost: row.name, imapPort: row.port, imapSecure: true }, "dns_srv");
  }
  for (const row of prioritizeSrv(submissionSrv)) {
    add({
      smtpHost: row.name,
      smtpPort: row.port,
      smtpSecure: row.port === 465,
      smtpStartTls: row.port !== 465,
    }, "dns_srv");
  }

  if (!known && !mxProvider) {
    const fetchFn = Object.prototype.hasOwnProperty.call(options, "fetchFn") ? options.fetchFn : globalThis.fetch;
    const autoConfig = await discoverFromAutoConfig(email, domain, fetchFn);
    if (autoConfig) add(autoConfig, "autoconfig");
  }

  add({
    imapHost: `imap.${domain}`,
    imapPort: 993,
    imapSecure: true,
    smtpHost: `smtp.${domain}`,
    smtpPort: 587,
    smtpSecure: false,
    smtpStartTls: true,
  }, "domain_convention");
  add({
    imapHost: `mail.${domain}`,
    imapPort: 993,
    imapSecure: true,
    smtpHost: `mail.${domain}`,
    smtpPort: 587,
    smtpSecure: false,
    smtpStartTls: true,
  }, "mail_host_convention");

  const uniqueImap = uniqueServers(imapCandidates).filter((item) => item.host).slice(0, 6);
  const uniqueSmtp = uniqueServers(smtpCandidates).filter((item) => item.host).slice(0, 6);
  return {
    status: uniqueImap.length ? "mail_servers_discovered" : "mail_servers_not_found",
    domain,
    provider: known?.provider ?? mxProvider?.provider ?? "custom",
    source: uniqueImap[0]?.source ?? "none",
    imapCandidates: uniqueImap,
    smtpCandidates: uniqueSmtp,
    smtp: uniqueSmtp[0] ?? null,
  };
}

function providerFromMx(records) {
  const hosts = (Array.isArray(records) ? records : [])
    .map((record) => normalizeHost(record?.exchange))
    .filter(Boolean);
  if (hosts.some((host) => /google\.com$|googlemail\.com$/u.test(host))) {
    return settings("google_workspace", "imap.gmail.com", 993, "smtp.gmail.com", 465, true, false);
  }
  if (hosts.some((host) => /mail\.protection\.outlook\.com$/u.test(host))) {
    return settings("microsoft_365", "outlook.office365.com", 993, "smtp.office365.com", 587, false, true);
  }
  if (hosts.some((host) => /zoho\.(com|eu|asia)$/u.test(host))) {
    return settings("zoho", "imap.zoho.com", 993, "smtp.zoho.com", 465, true, false);
  }
  if (hosts.some((host) => /messagingengine\.com$/u.test(host))) {
    return settings("fastmail", "imap.fastmail.com", 993, "smtp.fastmail.com", 465, true, false);
  }
  if (hosts.some((host) => /mail\.naver\.com$/u.test(host))) return KNOWN_PROVIDERS["naver.com"];
  if (hosts.some((host) => /mailplug\.(com|co\.kr)$/u.test(host))) {
    return settings("mailplug", "imap.mailplug.co.kr", 993, "smtp.mailplug.co.kr", 465, true, false);
  }
  return null;
}

async function discoverFromAutoConfig(email, domain, fetchFn) {
  if (typeof fetchFn !== "function") return null;
  const endpoints = [
    `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`,
    `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`,
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await withTimeout(
        fetchFn(endpoint, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) }),
      );
      if (!response?.ok) continue;
      const xml = String(await response.text()).slice(0, 250000);
      const incoming = parseServer(xml, "incomingServer", "imap");
      const outgoing = parseServer(xml, "outgoingServer", "smtp");
      if (incoming?.host) {
        return {
          provider: "autoconfig",
          imapHost: incoming.host,
          imapPort: incoming.port,
          imapSecure: incoming.secure,
          imapStartTls: incoming.startTls,
          smtpHost: outgoing?.host,
          smtpPort: outgoing?.port,
          smtpSecure: outgoing?.secure,
          smtpStartTls: outgoing?.startTls,
        };
      }
    } catch {
      // Continue with the next same-domain endpoint.
    }
  }
  return null;
}

function parseServer(xml, elementName, type) {
  const blocks = [...xml.matchAll(new RegExp(`<${elementName}[^>]*type=["']${type}["'][^>]*>([\\s\\S]*?)<\\/${elementName}>`, "giu"))];
  for (const match of blocks) {
    const body = match[1] || "";
    const host = normalizeHost(readTag(body, "hostname"));
    if (!host) continue;
    const port = normalizePort(readTag(body, "port"), type === "imap" ? 993 : 587);
    const socketType = readTag(body, "socketType").toUpperCase();
    return {
      host,
      port,
      secure: socketType === "SSL" || socketType === "SSL/TLS" || port === 465 || port === 993,
      startTls: /STARTTLS/u.test(socketType) || (type === "smtp" && port === 587),
    };
  }
  return null;
}

function readTag(xml, name) {
  return String(xml.match(new RegExp(`<${name}[^>]*>([^<]+)<\\/${name}>`, "iu"))?.[1] ?? "").trim();
}

function settings(provider, imapHost, imapPort, smtpHost, smtpPort, smtpSecure, smtpStartTls) {
  return { provider, imapHost, imapPort, imapSecure: true, smtpHost, smtpPort, smtpSecure, smtpStartTls };
}

function uniqueServers(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.host}:${item.port}:${item.secure ? "tls" : item.startTls ? "starttls" : "plain"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function prioritizeSrv(records) {
  return (Array.isArray(records) ? records : [])
    .filter((row) => normalizeHost(row?.name) && Number(row?.port) > 0)
    .sort((a, b) => Number(a.priority ?? 0) - Number(b.priority ?? 0) || Number(b.weight ?? 0) - Number(a.weight ?? 0));
}

async function safeLookup(task) {
  try {
    return await withTimeout(task());
  } catch {
    return [];
  }
}

async function withTimeout(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("mail discovery timeout")), LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeEmail(value) {
  const text = String(value ?? "").trim().toLowerCase().slice(0, 320);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(text) ? text : "";
}

function normalizeHost(value) {
  const host = String(value ?? "").trim().toLowerCase().replace(/\.$/u, "");
  return /^[a-z0-9.-]{3,253}$/u.test(host) && host.includes(".") && !host.includes("..") ? host : "";
}

function normalizePort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

function emptyResult(status) {
  return { status, domain: "", provider: "custom", source: "none", imapCandidates: [], smtpCandidates: [], smtp: null };
}

