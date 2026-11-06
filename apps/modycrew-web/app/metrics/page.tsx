import { WorkMetrics } from '@/components/WorkMetrics';
import { AIUsageSummary } from '@/components/AIUsageSummary';
// 업무 현황(제목·필터·표)을 먼저 보여 주고, AI 사용량은 그 아래 보조 정보로 둔다.
export default function MetricsPage() { return <><WorkMetrics /><AIUsageSummary /></>; }
