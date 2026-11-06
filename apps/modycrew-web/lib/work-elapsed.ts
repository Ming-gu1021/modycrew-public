/**
 * 작업 시간 표시 — Codex 처럼 '3분 5초 동안 작업 중', 끝나면 '3분 5초 만에 작업 완료'로 보여 준다.
 * 오래 걸리는 업무(크루 스킬 실행·여러 도구 호출)는 몇 분씩 걸리므로, 멈췄는지 진행 중인지 시간으로 알 수 있어야 한다.
 */

/** 경과 시간을 한국어로. 1분 미만은 초만, 1시간 미만은 분·초(0초는 생략), 그 이상은 시간·분. */
export function formatWorkElapsed(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  if (total < 60) return `${total}초`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return minutes ? `${hours}시간 ${minutes}분` : `${hours}시간`;
  return seconds ? `${minutes}분 ${seconds}초` : `${minutes}분`;
}

export type WorkProgressState = { active: boolean; complete: boolean; failed: boolean; phase?: string; startedAt?: number; finishedAt?: number; now: number };

/** 진행 표시의 굵은 글씨. 시작 시각을 모르면(이전 버전 기록) 예전 문구를 쓴다. */
export function workProgressHeadline(state: WorkProgressState): string {
  const started = typeof state.startedAt === "number" && Number.isFinite(state.startedAt) && state.startedAt > 0 ? state.startedAt : null;
  const end = state.active ? state.now : typeof state.finishedAt === "number" && Number.isFinite(state.finishedAt) ? state.finishedAt : null;
  const elapsed = started !== null && end !== null && end >= started ? formatWorkElapsed(end - started) : "";
  if (state.failed) return elapsed ? `${elapsed} 작업 · 확인 필요` : "확인 필요";
  if (state.complete) return elapsed ? `${elapsed} 만에 작업 완료` : "답변 마침";
  if (!state.active) return elapsed ? `${elapsed} 작업` : "처리 중";
  if (elapsed) return `${elapsed} 동안 작업 중`;
  return state.phase === "generating" ? "답변 중" : "처리 중";
}
