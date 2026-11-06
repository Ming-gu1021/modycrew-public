"use client";

type InternalNavigationMode = "assign" | "replace";

const allowedInternalPathnames = new Set([
  "/",
  "/account",
  "/connect",
  "/crew",
  "/documents",
  "/automation",
  "/company",
  "/learn",
  "/legal",
  "/office",
  "/plugins",
  "/privacy",
  "/setup",
  "/terms",
  "/welcome",
]);

function toAllowedInternalPath(rawPath: string): string {
  if (typeof window === "undefined") {
    throw new Error("브라우저 환경에서만 내부 이동을 실행할 수 있습니다.");
  }

  const current = new URL(window.location.href);
  const next = new URL(rawPath, current);
  const pathname = next.pathname.replace(/\/+$/u, "") || "/";
  if (next.protocol !== current.protocol || next.host !== current.host || next.username || next.password || !allowedInternalPathnames.has(pathname)) {
    throw new Error(`허용되지 않은 내부 이동 경로입니다: ${rawPath}`);
  }

  return `${next.pathname}${next.search}${next.hash}`;
}

/**
 * 주소의 returnTo처럼 밖에서 들어온 "돌아갈 곳" 값을 같은 앱 안의 경로로만 정규화한다.
 * 브라우저가 실제로 이동할 때와 같은 규칙(역슬래시를 슬래시로 읽고 탭·줄바꿈을 지움)으로 풀어 보고,
 * 다른 출처로 풀리거나, / 로 시작하지 않거나, 역슬래시가 든 값은 빈 문자열로 돌려준다.
 * 예: "/\evil.example"은 브라우저에서 "//evil.example"(다른 사이트)로 풀리므로 버린다.
 */
export function normalizeInternalReturnPath(value: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "";
  try {
    const base = new URL("https://modycrew.invalid/");
    const next = new URL(raw, base);
    if (next.origin !== base.origin || next.username || next.password) return "";
    return `${next.pathname}${next.search}${next.hash}`;
  } catch {
    return "";
  }
}

/** Preserve the preview context using the same URL/route boundary as every internal move. */
export function navigateInternalPathKeepingPreview(rawPath: string) {
  const safePath = toAllowedInternalPath(rawPath);
  const current = new URL(window.location.href);
  const next = new URL(safePath, current);
  const preview = current.searchParams.get("preview");
  if (preview && !next.searchParams.has("preview")) next.searchParams.set("preview", preview);
  navigateInternalPath(`${next.pathname}${next.search}${next.hash}`);
}

export function navigateInternalPath(rawPath: string, mode: InternalNavigationMode = "assign") {
  const safePath = toAllowedInternalPath(rawPath);
  if (mode === "replace") {
    window.location.replace(safePath);
    return;
  }
  window.location.assign(safePath);
}

export function openInternalOfficeWindow(rawPath = "/office?from=chat-window") {
  const safePath = toAllowedInternalPath(rawPath);
  return window.open(safePath, "modycrew-office", "width=1320,height=860");
}
