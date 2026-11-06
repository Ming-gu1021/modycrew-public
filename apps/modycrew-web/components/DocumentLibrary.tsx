"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DocumentFormat, DocumentSearchMatch, DocumentTemplate } from "@/lib/document-production";
import { buildDocumentLibrary, defaultLibraryFilters, libraryFacets, searchLibrary, type DocumentGroup, type LibraryDocument, type LibraryFilters, type LibraryPeriod } from "@/lib/document-library";
import styles from "./DocumentLibrary.module.css";

const formatShort: Record<DocumentFormat, string> = { docx: "W", hwpx: "한", hwp: "한", pptx: "P", xlsx: "X", pdf: "PDF" };
const formatName: Record<DocumentFormat, string> = { docx: "Word", hwpx: "한글", hwp: "한글", pptx: "PPT", xlsx: "Excel", pdf: "PDF" };
const periodLabels: Record<LibraryPeriod, string> = { "": "전체 기간", "7": "최근 7일", "30": "최근 30일", "90": "최근 3개월" };

function when(iso: string) {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return "";
  const today = new Date();
  const sameDay = at.toDateString() === today.toDateString();
  return sameDay
    ? at.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })
    : at.toLocaleDateString("ko-KR", { year: at.getFullYear() === today.getFullYear() ? undefined : "numeric", month: "short", day: "numeric" });
}

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/u).filter(Boolean).map((term) => term.replace(/[.*+?^$()|[\]\\{}]/gu, "\\$&"));
  if (!text || !terms.length) return <>{text}</>;
  const parts = text.split(new RegExp("(" + terms.join("|") + ")", "giu"));
  return <>{parts.map((part, index) => (index % 2 ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>))}</>;
}

type Props = {
  documents: LibraryDocument[];
  catalog?: DocumentTemplate[];
  busy: boolean;
  onView: (document: LibraryDocument) => void;
  onOpen: (document: LibraryDocument) => void;
  onCopy: (document: LibraryDocument) => void;
  renderShare: (document: LibraryDocument) => ReactNode;
  /** 설치 앱의 본문 검색. null 이면 제목으로만 찾는다. */
  search: (query: string) => Promise<DocumentSearchMatch[] | null>;
};

   
                                                                        
                                              
   
export default function DocumentLibrary({ documents, catalog = [], busy, onView, onOpen, onCopy, renderShare, search }: Props) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<LibraryFilters>(defaultLibraryFilters);
  const [matches, setMatches] = useState<DocumentSearchMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const latestQuery = useRef("");
  const trimmed = query.trim();

  useEffect(() => {
    latestQuery.current = trimmed;
    setMatches(null);
    if (!trimmed) { setSearching(false); return; }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void search(trimmed).then((found) => { if (latestQuery.current === trimmed) setMatches(found); })
        .catch(() => { if (latestQuery.current === trimmed) setMatches(null); })
        .finally(() => { if (latestQuery.current === trimmed) setSearching(false); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [trimmed, search]);

  const facets = useMemo(() => libraryFacets(documents, catalog), [documents, catalog]);
  const sections = useMemo(() => buildDocumentLibrary(documents, filters, catalog), [documents, filters, catalog]);
  const hits = useMemo(() => searchLibrary(documents, trimmed, matches, catalog), [documents, trimmed, matches, catalog]);
  const groupCount = sections.reduce((total, section) => total + section.groups.length, 0);
  const update = (patch: Partial<LibraryFilters>) => setFilters((current) => ({ ...current, ...patch }));

  const row = (group: DocumentGroup, shown: LibraryDocument, snippet = "", matchedIn?: "title" | "content") => (
    <li key={group.key} className={styles.row} data-document-group={group.key}>
      <span className={styles.fileIcon} data-format={shown.format} aria-hidden="true">{formatShort[shown.format]}</span>
      <div className={styles.info}>
        <strong>{trimmed ? <Highlight text={group.title} query={trimmed} /> : group.title}</strong>
        <span className={styles.meta}>
          <span className={styles.kind}>{group.category}</span>
          <span>{group.formats.map((format) => formatName[format]).join(" · ")}</span>
          <span>{when(shown.createdAt)}</span>
          {group.versions.length > 1 ? <span>버전 {group.versions.length}개</span> : null}
          {matchedIn === "content" ? <span>본문에서 찾음</span> : null}
        </span>
        {snippet ? <p className={styles.snippet}><Highlight text={snippet} query={trimmed} /></p> : null}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={busy || !shown.path} onClick={() => onView(shown)}>앱에서 보기</button>
        <button type="button" disabled={busy} onClick={() => onOpen(shown)}>열기</button>
        <details className={styles.more}>
          <summary aria-label={group.title + " 더보기"}>⋯</summary>
          <div className={styles.menu}>
            <button type="button" disabled={busy} onClick={(event) => { (event.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open"); onCopy(shown); }}>복사해 작성</button>
            {renderShare(shown)}
          </div>
        </details>
      </div>
      {group.versions.length > 1 ? (
        <details className={styles.versions}>
          <summary>이전 버전 {group.versions.length - 1}개 보기</summary>
          <ul>
            {group.versions.map((version, index) => (
              <li key={version.id}>
                <span>{formatName[version.format]} · {new Date(version.createdAt).toLocaleString("ko-KR")}{index === 0 ? " · 최신" : ""}</span>
                <button type="button" disabled={busy || !version.path} onClick={() => onView(version)}>앱에서 보기</button>
                <button type="button" disabled={busy} onClick={() => onOpen(version)}>열기</button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );

  return (
    <section className={styles.library} aria-label="저장된 문서" data-document-library>
      <header className={styles.head}>
        <h2>내 문서<small>{documents.length}개{groupCount && groupCount !== documents.length ? " · 문서 " + groupCount + "종" : ""}</small></h2>
        <label className={styles.search}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
          <input type="search" aria-label="문서 검색" placeholder="제목이나 내용으로 찾기 (예: 납품 일정)" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </header>
      {!trimmed ? (
        <div className={styles.filters} role="group" aria-label="문서 정리">
          <div className={styles.chips}>
            <button type="button" aria-pressed={!filters.format} onClick={() => update({ format: "" })}>전체 {documents.length}</button>
            {facets.formats.map(({ format, total }) => (
              <button key={format} type="button" aria-pressed={filters.format === format} onClick={() => update({ format: filters.format === format ? "" : format })}>{formatName[format]} {total}</button>
            ))}
          </div>
          <select aria-label="문서 종류" value={filters.category} onChange={(event) => update({ category: event.target.value })}>
            <option value="">모든 종류</option>
            {facets.categories.map(({ category, total }) => <option key={category} value={category}>{category} ({total})</option>)}
          </select>
          <select aria-label="기간" value={filters.period} onChange={(event) => update({ period: event.target.value as LibraryPeriod })}>
            {(Object.keys(periodLabels) as LibraryPeriod[]).map((period) => <option key={period} value={period}>{periodLabels[period]}</option>)}
          </select>
          <select aria-label="정렬" value={filters.sort} onChange={(event) => update({ sort: event.target.value as LibraryFilters["sort"] })}>
            <option value="recent">최신순</option>
            <option value="name">이름순</option>
          </select>
        </div>
      ) : null}
      {!documents.length ? <p className={styles.empty}>아직 저장한 문서가 없습니다. 위의 문서 작성으로 시작하세요.</p> : null}
      {trimmed ? (
        <div className={styles.section} aria-live="polite">
          <h3>검색 결과 <small>{hits.length}개{searching ? " · 본문까지 찾는 중…" : matches ? " · 제목·본문·표에서 찾음" : " · 제목에서 찾음"}</small></h3>
          {hits.length ? <ul className={styles.list}>{hits.map((hit) => row(hit.group, hit.document, hit.snippet, hit.matchedIn))}</ul>
            : !searching ? <p className={styles.empty}>"{trimmed}"이(가) 들어간 문서가 없습니다. 다른 낱말로 찾아보세요.</p> : null}
        </div>
      ) : documents.length && !sections.length ? (
        <p className={styles.empty}>조건에 맞는 문서가 없습니다. <button type="button" onClick={() => setFilters(defaultLibraryFilters)}>조건 지우기</button></p>
      ) : sections.map((section) => (
        <div key={section.key} className={styles.section}>
          <h3>{section.label} <small>{section.groups.length}</small></h3>
          <ul className={styles.list}>{section.groups.map((group) => row(group, group.latest))}</ul>
        </div>
      ))}
    </section>
  );
}
