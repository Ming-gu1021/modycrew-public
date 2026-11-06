const KOREAN_TIME_ZONE = "Asia/Seoul";

export function formatKoreanClock(iso?: string): string {
  if (!iso) return "";

  try {
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: KOREAN_TIME_ZONE,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function formatKoreanDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: KOREAN_TIME_ZONE,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}
