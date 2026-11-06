import type { DocumentFormat, DocumentSearchMatch, DocumentTemplate, SavedDocument } from "@/lib/document-production";

   
                                                                
                                                                
                                                   
   
export type LibraryDocument = SavedDocument;
export type DocumentGroup = { key: string; title: string; latest: LibraryDocument; versions: LibraryDocument[]; formats: DocumentFormat[]; category: string };
export type DocumentSection = { key: string; label: string; groups: DocumentGroup[] };
export type LibraryPeriod = "" | "7" | "30" | "90";
export type LibraryFilters = { format: DocumentFormat | ""; category: string; period: LibraryPeriod; sort: "recent" | "name" };
export const defaultLibraryFilters: LibraryFilters = { format: "", category: "", period: "", sort: "recent" };
export type LibrarySearchHit = { document: LibraryDocument; group: DocumentGroup; snippet: string; matchedIn: "title" | "content" };

const DAY = 86_400_000;
const time = (document: LibraryDocument) => Date.parse(document.createdAt) || 0;
const titleKey = (value: string) => value.normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ko-KR");
const normalize = (value: string) => value.normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ko-KR");

/** 문서 종류. 설치 앱이 붙인 분류가 없으면(새로 저장한 문서) 양식 목록에서 찾는다. */
export function documentCategoryOf(document: LibraryDocument, catalog: readonly DocumentTemplate[] = []): string {
  if (document.category?.trim()) return document.category.trim();
  const template = catalog.find((entry) => entry.id === document.templateId);
  return template?.category || "기타";
}

export function groupDocumentsByTitle(documents: readonly LibraryDocument[], catalog: readonly DocumentTemplate[] = []): DocumentGroup[] {
  const groups = new Map<string, LibraryDocument[]>();
  for (const document of documents) {
    const key = titleKey(document.title || document.name || document.id);
    const list = groups.get(key);
    if (list) list.push(document); else groups.set(key, [document]);
  }
  return [...groups.entries()].map(([key, versions]) => {
    versions.sort((a, b) => time(b) - time(a));
    const latest = versions[0];
    return { key, title: latest.title || latest.name, latest, versions, formats: [...new Set(versions.map((version) => version.format))], category: documentCategoryOf(latest, catalog) };
  });
}

/** 최신순 묶음의 날짜 구역. 주는 월요일부터 센다. */
export function documentDateBucket(iso: string, now = new Date()): { key: string; label: string } {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return { key: "unknown", label: "날짜 모름" };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (at >= today) return { key: "today", label: "오늘" };
  if (at >= today - DAY) return { key: "yesterday", label: "어제" };
  const weekStart = today - ((now.getDay() + 6) % 7) * DAY;
  if (at >= weekStart) return { key: "week", label: "이번 주" };
  if (at >= new Date(now.getFullYear(), now.getMonth(), 1).getTime()) return { key: "month", label: "이번 달" };
  const date = new Date(at);
  return { key: date.getFullYear() + "-" + (date.getMonth() + 1), label: date.getFullYear() + "년 " + (date.getMonth() + 1) + "월" };
}

export function filterLibraryDocuments(documents: readonly LibraryDocument[], filters: LibraryFilters, catalog: readonly DocumentTemplate[] = [], now = new Date()): LibraryDocument[] {
  const since = filters.period ? now.getTime() - Number(filters.period) * DAY : 0;
  return documents.filter((document) =>
    (!filters.format || document.format === filters.format || (filters.format === "hwpx" && document.format === "hwp")) &&
    (!filters.category || documentCategoryOf(document, catalog) === filters.category) &&
    (!since || time(document) >= since));
}

export function buildDocumentLibrary(documents: readonly LibraryDocument[], filters: LibraryFilters, catalog: readonly DocumentTemplate[] = [], now = new Date()): DocumentSection[] {
  const groups = groupDocumentsByTitle(filterLibraryDocuments(documents, filters, catalog, now), catalog);
  if (filters.sort === "name") return groups.length ? [{ key: "name", label: "이름순", groups: groups.sort((a, b) => a.title.localeCompare(b.title, "ko-KR")) }] : [];
  groups.sort((a, b) => time(b.latest) - time(a.latest));
  const sections: DocumentSection[] = [];
  for (const group of groups) {
    const bucket = documentDateBucket(group.latest.createdAt, now);
    let section = sections.find((item) => item.key === bucket.key);
    if (!section) sections.push(section = { key: bucket.key, label: bucket.label, groups: [] });
    section.groups.push(group);
  }
  return sections;
}

/** 거르기 칩에 쓸 형식·종류와 문서 수(많은 순). 한글은 HWP·HWPX를 한 칩으로 센다. */
export function libraryFacets(documents: readonly LibraryDocument[], catalog: readonly DocumentTemplate[] = []) {
  const count = <K,>(keys: K[]) => [...keys.reduce((map, key) => map.set(key, (map.get(key) ?? 0) + 1), new Map<K, number>())].sort((a, b) => b[1] - a[1]);
  return {
    formats: count(documents.map((document) => (document.format === "hwp" ? "hwpx" : document.format) as DocumentFormat)).map(([format, total]) => ({ format, total })),
    categories: count(documents.map((document) => documentCategoryOf(document, catalog))).map(([category, total]) => ({ category, total })),
  };
}

/**
 * 검색 결과. 설치 앱의 본문 검색 결과(matches)가 있으면 그 순서를 따르고, 아직 없거나(입력 중) 쓸 수 없으면
 * 제목·파일 이름·종류에서 바로 찾는다. 같은 제목의 여러 버전은 가장 최근 것 하나만 보여 준다.
 */
export function searchLibrary(documents: readonly LibraryDocument[], query: string, matches: readonly DocumentSearchMatch[] | null, catalog: readonly DocumentTemplate[] = []): LibrarySearchHit[] {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (!terms.length) return [];
  const groups = groupDocumentsByTitle(documents, catalog);
  const groupOf = new Map(groups.flatMap((group) => group.versions.map((version) => [version.id, group] as const)));
  const hits: LibrarySearchHit[] = [];
  const seen = new Set<string>();
  const push = (document: LibraryDocument, snippet: string, matchedIn: "title" | "content") => {
    const group = groupOf.get(document.id);
    if (!group || seen.has(group.key)) return;
    seen.add(group.key);
    hits.push({ document, group, snippet, matchedIn });
  };
  const byId = new Map(documents.map((document) => [document.id, document]));
  for (const match of matches ?? []) {
    const document = byId.get(match.id);
    if (document) push(document, match.snippet, match.matchedIn);
  }
  for (const group of groups) {
    const head = normalize([group.title, group.latest.name, group.latest.templateName ?? "", group.category].join(" "));
    if (terms.every((term) => head.includes(term))) push(group.latest, "", "title");
  }
  return hits;
}
