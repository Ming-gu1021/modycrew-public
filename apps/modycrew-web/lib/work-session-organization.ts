import type { WorkSessionPriority, WorkSessionSavedView } from "../../../packages/domain/dist/work-session-workspace.js";

export interface OrganizationSession {
  id: string;
  title: string;
  projectId?: string;
  teammateName?: string;
  status: "todo" | "in_progress" | "waiting" | "done";
  running?: boolean;
  pinned?: boolean;
  archivedAt?: number;
  updatedAt: number;
  description?: string;
  dueDate?: string;
  priority?: WorkSessionPriority;
  tags?: string[];
  preview?: { text: string };
  searchText?: string;
}
type ProjectName = { id: string; name: string };
export type OrganizationFilters = WorkSessionSavedView["filters"];
export type OrganizationSort = WorkSessionSavedView["sort"];
const fold = (text: string) => text.trim().toLocaleLowerCase("ko-KR");
const priorityRank: Record<WorkSessionPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

/** Date-only values stay in the user's local calendar, including near UTC midnight. */
export function localDateKey(date = new Date()): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function localWeekRange(now = new Date()): { start: string; end: string } {
  const monday = new Date(now);
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { start: localDateKey(monday), end: localDateKey(sunday) };
}

export const organizationStatus = (session: OrganizationSession) => session.running ? "in_progress" : session.status;

export function matchesWorkDueDate(session: OrganizationSession, due: OrganizationFilters["due"], now = new Date()): boolean {
  if (!due) return true;
  if (due === "none") return !session.dueDate;
  if (organizationStatus(session) === "done" || !isValidDateKey(session.dueDate)) return false;
  const today = localDateKey(now);
  if (due === "today") return session.dueDate === today;
  if (due === "overdue") return session.dueDate < today;
  const week = localWeekRange(now);
  return session.dueDate >= week.start && session.dueDate <= week.end;
}

export function matchesOrganizationQuery(session: OrganizationSession, projects: ProjectName[], query = ""): boolean {
  const search = fold(query);
  return !search || fold([session.title, session.teammateName, projects.find(project => project.id === session.projectId)?.name,
    session.description, ...(session.tags ?? []), session.preview?.text, session.searchText].filter(Boolean).join(" ")).includes(search);
}

export function organizeWorkSessions<T extends OrganizationSession>(sessions: readonly T[], projects: ProjectName[], filters: OrganizationFilters = {}, sort: OrganizationSort = "updated", now = new Date()): T[] {
  const filtered = sessions.filter(session => {
    if (Boolean(session.archivedAt) !== Boolean(filters.archived)) return false;
    if (filters.projectId === null ? Boolean(session.projectId) : filters.projectId !== undefined && session.projectId !== filters.projectId) return false;
    if (filters.status && organizationStatus(session) !== filters.status) return false;
    if (filters.priority && (session.priority ?? "normal") !== filters.priority) return false;
    if (filters.tag && !(session.tags ?? []).some(tag => fold(tag) === fold(filters.tag!))) return false;
    return matchesWorkDueDate(session, filters.due, now) && matchesOrganizationQuery(session, projects, filters.query);
  });
  return filtered.sort((a, b) => {
    const pinned = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinned) return pinned;
    let order = 0;
    if (sort === "due") order = (isValidDateKey(a.dueDate) ? a.dueDate : "9999-99-99").localeCompare(isValidDateKey(b.dueDate) ? b.dueDate : "9999-99-99");
    else if (sort === "priority") order = priorityRank[b.priority ?? "normal"] - priorityRank[a.priority ?? "normal"];
    else if (sort === "title") order = a.title.localeCompare(b.title, "ko-KR", { numeric: true });
    return order || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
  });
}

export function parseWorkTags(input: string): string[] {
  const tags = input.split(",").map(tag => tag.trim()).filter(Boolean);
  const unique = tags.filter((tag, index) => tags.findIndex(other => fold(other) === fold(tag)) === index);
  if (unique.length > 12) throw new Error("태그는 최대 12개까지 입력해 주세요.");
  if (unique.some(tag => tag.length > 32 || /[\u0000-\u001f\u007f]/u.test(tag))) throw new Error("태그는 줄바꿈 없이 32자 이내로 입력해 주세요.");
  return unique;
}
