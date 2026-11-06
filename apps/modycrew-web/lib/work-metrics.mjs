const dayMs = 86400000;
export const metricLabels = { todo:'대기', doing:'진행', review:'검토 요청', blocked:'확인 필요', done:'완료', canceled:'취소', unknown:'상태 미확인' };
const statusMap = {todo:'todo',queued:'todo',doing:'doing',running:'doing',ready_to_merge:'doing',review:'review',canceled:'canceled',blocked:'blocked',attention:'blocked',failed:'blocked',waiting_input:'blocked',waiting_approval:'blocked',paused:'blocked',done:'done',completed:'done'};
export const priorityLabel = value => typeof value === 'number' && Number.isFinite(value) ? `순위 ${value}` : ({urgent:'긴급',high:'중요',normal:'보통',low:'낮음'})[value] || '미지정';
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function workQueue(records, now = Date.now()) {
  const today = dayKey(new Date(now));
  const weight = value => typeof value === 'number' ? value : ({urgent:-100,high:0,normal:100,low:200})[value] ?? 300;
  return records.map(row => ({...row, state: statusMap[row.status] || 'unknown', overdue: Boolean(/^\d{4}-\d{2}-\d{2}$/.test(row.dueDate || '') && row.dueDate < today && !['done','completed','canceled'].includes(row.status))}))
    .sort((a,b) => Number(['done','canceled'].includes(a.state))-Number(['done','canceled'].includes(b.state)) || Number(b.overdue)-Number(a.overdue) || weight(a.priority)-weight(b.priority) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.title.localeCompare(b.title));
}
export function buildWorkMetrics(records, { now = Date.now(), days = 30, dateBasis = 'created' } = {}) {
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate()-(days-1));
  const unique = new Map();
  for (const row of records || []) if (row?.id) unique.set(row.id, row);
  let undated = 0;
  const completionUndated = [...unique.values()].filter(row=>statusMap[row.status]==='done'&&!Number.isFinite(Date.parse(row.completedAt))).length;
  const dateField = dateBasis === 'completed' ? 'completedAt' : 'createdAt';
  const rows = [...unique.values()].filter(row=>{
    if (dateBasis==='completed' && statusMap[row.status]!=='done') return false;
    const time=Date.parse(row[dateField]);if(!Number.isFinite(time)){undated++;return false;}return time>=start.getTime()&&time<=now;
  });
  const counts = {todo:0,doing:0,review:0,blocked:0,done:0,canceled:0,unknown:0};
  const groups = new Map();
  const dayKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const daily = Array.from({length:days},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return {date:dayKey(d),count:0,done:0};});
  for(const row of rows){
    const status=statusMap[row.status]||'unknown';counts[status]++;
    const date=dayKey(new Date(row[dateField])); const day=daily.find(x=>x.date===date);if(day)day.count++;
    const name=row.group||'기본 담당';const group=groups.get(name)||{name,total:0,done:0,blocked:0};group.total++;if(status==='done')group.done++;if(status==='blocked')group.blocked++;groups.set(name,group);
  }
  for (const row of unique.values()) {
    const time=Date.parse(row.completedAt);
    if(statusMap[row.status]!=='done'||!Number.isFinite(time)||time<start.getTime()||time>now)continue;
    const day=daily.find(x=>x.date===dayKey(new Date(time)));if(day)day.done++;
  }
  return {dateBasis,total:rows.length,counts,completionRate:rows.length?Math.round(counts.done/rows.length*100):null,undated,completionUndated,daily,groups:[...groups.values()].sort((a,b)=>b.total-a.total),from:dayKey(start),to:dayKey(new Date(now)),rows};
}
export function metricsCsv(metrics, scope) {
  const cell = value => {const text=String(value??'');return `"${(/^[=+@\-\t\r]/.test(text)?"'":'')+text.replaceAll('"','""')}"`;};
  return '\uFEFF'+[['범위','기간 기준','등록일','완료일','업무','현재 상태','담당','우선순위','완료 기한','실행 예정'],...metrics.rows.map(row=>[scope,metrics.dateBasis==='completed'?'완료일':'등록일',row.createdAt,statusMap[row.status]==='done'?row.completedAt||'완료일 미기록':'',row.title||'',metricLabels[statusMap[row.status]||'unknown'],row.group||'담당 미지정',priorityLabel(row.priority),row.dueDate||'',row.scheduledAt||''])].map(row=>row.map(cell).join(',')).join('\r\n');
}
