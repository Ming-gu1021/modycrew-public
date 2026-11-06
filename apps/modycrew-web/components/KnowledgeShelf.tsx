"use client";

/**
 * 정리함 화면 — 갈래 하나만 펼쳐 두고 나머지는 접는다.
 * 묶는 규칙은 lib/knowledge-shelf.ts 에 있다(화면 없이 검증한다).
 */

import { useMemo, useState } from "react";

import type {
  BackgroundDigestEntry,
  DocumentLearningSearchResult,
  LearningLesson,
} from "@/lib/desktop-bridge";
import {
  buildKnowledgeGroups,
  shortDate,
  type ShelfGroup,
} from "@/lib/knowledge-shelf";
import styles from "./KnowledgeShelf.module.css";

export type KnowledgeShelfProps = {
  documents: DocumentLearningSearchResult[];
  lessons: LearningLesson[];
  digests: BackgroundDigestEntry[];
  query: string;
  onQueryChange: (next: string) => void;
  onOpenDocument?: (path: string) => void;
  busy?: boolean;
  notice?: string;
  hasMoreDocuments?: boolean;
  onLoadMoreDocuments?: () => void;
};

export function KnowledgeShelf({
  documents,
  lessons,
  digests,
  query,
  onQueryChange,
  onOpenDocument,
  busy = false,
  notice = "",
  hasMoreDocuments = false,
  onLoadMoreDocuments,
}: KnowledgeShelfProps) {
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});

  const groups = useMemo<ShelfGroup[]>(
    () => buildKnowledgeGroups({ documents, lessons, digests, query }),
    [documents, lessons, digests, query],
  );

  const totalCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const activeGroupId = openGroupId === "" || groups.some((group) => group.id === openGroupId)
    ? openGroupId
    : groups[0]?.id ?? null;

  return (
    <section className={styles.shelf} aria-label="정리함" data-knowledge-shelf-groups={groups.length}>
      <header>
        <strong>정리함</strong>
        <p>앱이 알고 있는 것을 갈래별로 모았습니다. 한 줄로 찾을 수도 있습니다.</p>
      </header>

      <label className={styles.search}>
        <span>정리함에서 찾기</span>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setOpenGroupId(null);
            setVisibleCounts({});
            onQueryChange(event.target.value);
          }}
          placeholder="예: 견적, 세금계산서, 지난주 회의"
          aria-label="정리함에서 찾기"
        />
      </label>

      {notice ? (
        <small role="status" className={styles.notice}>
          {notice}
        </small>
      ) : null}
      {hasMoreDocuments ? (
        <button type="button" disabled={busy} onClick={onLoadMoreDocuments}>
          자료 더 불러오기
        </button>
      ) : null}

      {busy ? (
        <p className={styles.empty}>불러오는 중입니다.</p>
      ) : groups.length === 0 ? (
        <p className={styles.empty} data-knowledge-shelf-empty="true">
          {query.trim()
            ? "찾는 것이 아직 정리함에 없습니다."
            : "아직 정리함이 비어 있습니다. 자료를 학습시키거나 일을 맡기면 여기에 쌓입니다."}
        </p>
      ) : (
        <div className={styles.groups}>
          <p className={styles.count}>{totalCount}개</p>
          {groups.map((group) => {
            const open = group.id === activeGroupId;
            return (
              <section key={group.id} data-knowledge-group={group.id} data-open={open ? "true" : "false"}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenGroupId(open ? "" : group.id)}
                >
                  <strong>{group.label}</strong>
                  <small>{group.hint}</small>
                  <b>{group.items.length}</b>
                </button>
                {open ? (
                  <ul>
                    {group.items.slice(0, visibleCounts[group.id] ?? 40).map((item) => (
                      <li key={item.id}>
                        <div>
                          <strong>{item.title}</strong>
                          {item.detail ? <span>{item.detail}</span> : null}
                          <small>
                            {item.sourceLabel}
                            {item.at ? ` · ${shortDate(item.at)}` : ""}
                          </small>
                        </div>
                        {item.path && onOpenDocument ? (
                          <button type="button" onClick={() => onOpenDocument(item.path ?? "")}>
                            열기
                          </button>
                        ) : null}
                      </li>
                    ))}
                    {group.items.length > (visibleCounts[group.id] ?? 40) ? (
                      <li data-knowledge-overflow="true">
                        <button type="button" onClick={() => setVisibleCounts((current) => ({ ...current, [group.id]: (current[group.id] ?? 40) + 40 }))}>
                          더 보기 ({group.items.length - (visibleCounts[group.id] ?? 40)}개 남음)
                        </button>
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default KnowledgeShelf;
