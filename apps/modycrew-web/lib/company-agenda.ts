import type { CompanyTask } from './company-types';

/** Local calendar date as YYYY-MM-DD. Uses the PC's local time zone, never UTC. */
export const localDateKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
export const isValidDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && localDateKey(new Date(`${value}T12:00:00`)) === value;

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const addDays = (base: Date, days: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, 12);
const build = (year: number, month: number, day: number) => {
  const value = new Date(year, month - 1, day, 12);
  return value.getFullYear() === year && value.getMonth() === month - 1 && value.getDate() === day ? value : null;
};

/**
 * Reads one deadline from a Korean chat sentence so the task form can start with it.
 * Returns '' when the text has no clear date. The result is a suggestion the user confirms;
 * nothing is saved from here.
 */
export function suggestDueDate(text: string, now: Date = new Date()): string {
  const source = String(text ?? '').replace(/\s+/g, ' ');
  if (!source.trim()) return '';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  let match: RegExpMatchArray | null;

  if ((match = source.match(/(\d{4})[-./년]\s?(\d{1,2})[-./월]\s?(\d{1,2})일?/u))) {
    const value = build(Number(match[1]), Number(match[2]), Number(match[3]));
    return value ? localDateKey(value) : '';
  }
  if ((match = source.match(/(?<![\w.])(\d{1,2})\s?[/.월]\s?(\d{1,2})일?(?![\d.%])/u))) {
    const month = Number(match[1]), day = Number(match[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let value = build(today.getFullYear(), month, day);
      if (value && value < today) value = build(today.getFullYear() + 1, month, day);
      return value ? localDateKey(value) : '';
    }
  }
  if (/오늘/u.test(source)) return localDateKey(today);
  if (/내일/u.test(source)) return localDateKey(addDays(today, 1));
  if (/모레/u.test(source)) return localDateKey(addDays(today, 2));
  if ((match = source.match(/(이번\s?주|다음\s?주|다다음\s?주|차주)?\s?([일월화수목금토])요일/u))) {
    const target = WEEKDAYS.indexOf(match[2]);
    const mondayOffset = (today.getDay() + 6) % 7; // Monday-based week, as Korean offices read it.
    const weekStart = addDays(today, -mondayOffset);
    const targetIndex = (target + 6) % 7;
    const week = match[1]?.replace(/\s/g, '');
    const weekShift = week === '다음주' || week === '차주' ? 7 : week === '다다음주' ? 14 : 0;
    let value = addDays(weekStart, targetIndex + weekShift);
    if (value < today) value = addDays(value, 7);
    return localDateKey(value);
  }
  if (/(이번\s?달\s?말|월말)/u.test(source)) return localDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0, 12));
  if ((match = source.match(/다음\s?달\s?(\d{1,2})일/u))) {
    const value = build(today.getFullYear(), today.getMonth() + 2, Number(match[1]));
    return value ? localDateKey(value) : '';
  }
  if ((match = source.match(/(?<![\d.월/])(\d{1,2})일\s?(까지|안에|내로|마감|전까지)/u))) {
    const day = Number(match[1]);
    let value = build(today.getFullYear(), today.getMonth() + 1, day);
    if (value && value < today) value = build(today.getFullYear(), today.getMonth() + 2, day);
    return value ? localDateKey(value) : '';
  }
  // "이번 주까지" means the end of this Monday-based week; "다음 주" the end of the following week.
  const weekStart = addDays(today, -((today.getDay() + 6) % 7));
  if (/다음\s?주|차주/u.test(source)) return localDateKey(addDays(weekStart, 13));
  if (/이번\s?주/u.test(source)) return localDateKey(addDays(weekStart, 6));
  return '';
}

export type TaskSummary = { active: number; dueToday: number; overdue: number; undated: number; mine: number; awaitingReview: number; done: number };

/** Counts the saved task rows for one team. Canceled tasks stay out of every figure. */
export function summarizeTasks(tasks: CompanyTask[], uid: string, today: string): TaskSummary {
  const summary: TaskSummary = { active: 0, dueToday: 0, overdue: 0, undated: 0, mine: 0, awaitingReview: 0, done: 0 };
  for (const task of tasks) {
    if (task.status === 'canceled') continue;
    if (task.status === 'done') { summary.done += 1; continue; }
    summary.active += 1;
    if (task.assigneeUid === uid) summary.mine += 1;
    if (task.status === 'review' && task.creatorUid === uid) summary.awaitingReview += 1;
    if (!isValidDateKey(task.dueDate)) summary.undated += 1;
    else if (task.dueDate === today) summary.dueToday += 1;
    else if (task.dueDate < today) summary.overdue += 1;
  }
  return summary;
}

/** Active tasks for the home list: overdue first, then nearest deadline, undated last. */
export function upcomingTasks(tasks: CompanyTask[], limit = 6): CompanyTask[] {
  return tasks.filter(task => task.status !== 'done' && task.status !== 'canceled').sort((a, b) => {
    const left = isValidDateKey(a.dueDate) ? a.dueDate : '9999-99-99';
    const right = isValidDateKey(b.dueDate) ? b.dueDate : '9999-99-99';
    return left === right ? b.updatedAtEpochMs - a.updatedAtEpochMs : left < right ? -1 : 1;
  }).slice(0, limit);
}
