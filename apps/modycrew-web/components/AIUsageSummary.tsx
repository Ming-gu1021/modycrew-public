'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createDesktopBridge, type AIUsageSummaryResult } from '@/lib/desktop-bridge';
import styles from './AIUsageSummary.module.css';

const names: Record<string, string> = { openai: 'OpenAI API', codex_oauth: 'ChatGPT / Codex', anthropic: 'Claude API', gemini: 'Gemini API', local: '로컬 모델', claude_code: 'Claude Code', codex_cli: 'Codex CLI' };
const number = (value: number | null) => value === null ? '확인 불가' : value.toLocaleString('ko-KR');

export function AIUsageSummary() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AIUsageSummaryResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const loading = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    loading.current = true;
    setBusy(true); setError(''); setData(null);
    try {
      const bridge = createDesktopBridge();
      if (!bridge.getAIUsageSummary) throw new Error('이 설치 앱은 사용량 조회를 지원하지 않습니다. 지원 버전의 PC 앱에서 확인해 주세요.');
      const result = await bridge.getAIUsageSummary(days);
      if (request !== revision.current) return;
      if (result.status !== 'ai_usage_loaded') throw new Error('개인 연결의 사용량을 확인할 수 없습니다. 현재 연결과 앱 상태를 확인해 주세요.');
      setData(result);
    } catch (cause) {
      if (request === revision.current) setError(cause instanceof Error ? cause.message : '사용량을 불러오지 못했습니다. 다시 불러와 주세요.');
    } finally { if (request === revision.current) { loading.current = false; setBusy(false); } }
  }, [days]);
  useEffect(() => { void refresh(); return () => { revision.current++; }; }, [refresh]);
  const groups = data?.groups ?? [];
  return <section className={styles.panel} aria-labelledby="ai-usage-heading" aria-busy={busy}>
    <div className={styles.heading}>
      <div><span className={styles.eyebrow}>이 PC · 개인 AI 연결</span><h2 id="ai-usage-heading">AI 사용량</h2></div>
      <div className={styles.actions}>
        <label>기간 <select aria-label="AI 사용량 기간" value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>최근 7일</option><option value={30}>최근 30일</option><option value={90}>최근 90일</option></select></label>
        <button type="button" disabled={busy} onClick={() => { if (!loading.current) void refresh(); }}>{busy ? '확인 중…' : '사용량 새로고침'}</button>
      </div>
    </div>
    <p className={styles.note}>이 기능을 적용한 뒤 이 PC의 개인 채팅에서 기록한 요청입니다. 현재 연결의 기록만 표시하며, 회사 업무·다른 기기·공급자 전체 청구 내역은 포함하지 않습니다.</p>
    {error && <p role="alert" className={styles.warning}>{error}</p>}
    {busy && <p role="status">기록을 확인하고 있습니다.</p>}
    {data && <>
      {(data.recordingWarning || data.unreadableRecords || data.limited) ? <p role="alert" className={styles.warning}>일부 사용량 기록을 저장하거나 읽지 못했습니다. 아래 수치는 전체 사용량이 아닙니다. AI 답변이 완료돼도 기록 저장은 실패할 수 있습니다.</p> : null}
      {!groups.length && <p role="status">이 기간에 현재 연결로 기록된 요청이 없습니다. 실제 사용량이 0이라는 뜻은 아닙니다.</p>}
      <div className={styles.grid}>{groups.map(group => <article className={styles.card} key={`${group.provider}:${group.model}`}>
        <h3>{names[group.provider] ?? group.provider}</h3><p className={styles.model}>{group.model}</p>
        <dl><div><dt>앱에 기록된 요청</dt><dd>{number(group.requests)}건</dd></div><div><dt>성공 / 실패 / 취소</dt><dd>{group.succeeded} / {group.failed} / {group.cancelled}</dd></div><div><dt>진행 중·종료 확인 불가</dt><dd>{group.unconfirmed}건</dd></div></dl>
        <p className={styles.subheading}>{group.provider === 'local' ? '로컬 서버 응답 수치' : '제공자 응답 수치'} · {group.usageReported}/{group.requests}건에 사용량 포함</p>
        <dl><div><dt>입력 토큰</dt><dd>{number(group.inputTokens)} <small>({group.inputTokensRequests}건 보고)</small></dd></div><div><dt>출력 토큰</dt><dd>{number(group.outputTokens)} <small>({group.outputTokensRequests}건 보고)</small></dd></div><div><dt>보고된 전체 토큰</dt><dd>{number(group.totalTokens)} <small>({group.totalTokensRequests}건 보고)</small></dd></div></dl>
      </article>)}</div>
      {!!data.unsupportedProviders?.length && <p className={styles.note}>계정 식별·사용량 집계 미지원: {data.unsupportedProviders.map(provider => names[provider] ?? provider).join(', ')}. 구독형 CLI의 전체 사용량은 제공자에서 확인해 주세요.</p>}
      <div className={styles.limits}><span>제공자 청구액: 확인 불가</span><span>예상 비용: 계산 미지원</span><span>잔여 한도: 확인 불가</span></div>
      <details className={styles.note}><summary>수치의 범위와 기록 방식</summary><p>입력·출력·전체는 응답에 포함된 값만 합산합니다. 캐시·추론 토큰의 포함 방식은 제공자마다 달라 입력과 출력의 합이 전체와 다를 수 있습니다. 응답 누락·실패·취소 요청에도 제공자 요금이 발생할 수 있습니다. API 키를 교체하면 별도 연결로 집계합니다. 키 원문·대화 내용은 사용량 기록에 저장하지 않습니다.</p></details>
      {data.checkedAt && <p className={styles.updated}>최근 확인 {new Date(data.checkedAt).toLocaleString('ko-KR')}</p>}
    </>}
  </section>;
}
