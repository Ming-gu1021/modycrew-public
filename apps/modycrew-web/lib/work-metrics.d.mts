export type MetricRecord = { id: string; title: string; status: string; createdAt: string; completedAt?: string; group?: string; priority?: string | number; dueDate?: string; scheduledAt?: string; href?: string };
export function priorityLabel(value?: string | number): string;
export function workQueue(records: MetricRecord[], now?: number): (MetricRecord & {state: string; overdue: boolean})[];
export type Metrics = {dateBasis:'created'|'completed';total:number;counts:Record<string,number>;completionRate:number|null;undated:number;completionUndated:number;daily:{date:string;count:number;done:number}[];groups:{name:string;total:number;done:number;blocked:number}[];from:string;to:string;rows:MetricRecord[]};
export const metricLabels: Record<string,string>;
export function buildWorkMetrics(records: MetricRecord[], options?:{now?:number;days?:number;dateBasis?:'created'|'completed'}):Metrics;
export function metricsCsv(metrics: Metrics, scope: string):string;
