"use client";

import { useMemo, useState } from "react";
import {
  type ConnectorCategory,
  type ConnectorDefinition,
  categoryLabels,
  connectorBrandIconSrc,
} from "@/lib/connectors";
import styles from "./ConnectorCatalog.module.css";

type Props = {
  connectors: ConnectorDefinition[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 이미 연결이 확인된 커넥터 id 목록 — 카드에 연결됨 배지를 표시한다. */
  connectedIds?: ReadonlySet<string>;
};

type FilterCategory = ConnectorCategory | "all";

const categoryOrder: FilterCategory[] = [
  "all",
  "mail",
  "messenger",
  "calendar",
  "inquiry",
  "booking",
  "workspace",
  "ai",
  "business_system",
  "local",
];
const visibleConnectorLimit = 1;

const allLabel: Record<FilterCategory, string> = {
  all: "전체",
  ...categoryLabels,
};

export function ConnectorCatalog({ connectors, selectedId, onSelect, connectedIds }: Props) {
  const [filter, setFilter] = useState<FilterCategory>("all");
  const [query, setQuery] = useState("");

  const renderConnectorCard = (connector: ConnectorDefinition) => {
    const active = connector.id === selectedId;
    const connected = connectedIds?.has(connector.id) ?? false;
    const brandIconSrc = connectorBrandIconSrc(connector.id);
    return (
      <button
        type="button"
        className={`${styles.card} ${active ? styles.cardActive : ""}`}
        onClick={() => onSelect(connector.id)}
        aria-current={active ? "true" : undefined}
        data-connector-connected={connected ? "true" : "false"}
      >
        <div className={styles.cardTop}>
          <span
            className={styles.icon}
            data-category={connector.category}
            aria-hidden="true"
          >
            {/* 제품 카드에는 그 제품의 로고가 보여야 한다. 로고 자산이 없는 제품만 글자로 폴백. */}
            {brandIconSrc ? (
              <img
                src={brandIconSrc}
                alt=""
                width={20}
                height={20}
                style={{ width: "62%", height: "62%", objectFit: "contain", display: "block" }}
              />
            ) : (
              connector.iconText
            )}
          </span>
          <div className={styles.cardTitle}>
            <strong>{connector.label}</strong>
          </div>
          {connected ? (
            <span className={`${styles.badge} ${styles.badgeConnected}`} title="연결 확인됨">
              연결됨
            </span>
          ) : connector.officialFirst ? (
            <span
              className={`${styles.badge} ${styles.badgeOfficial}`}
              title="공식 계정 연결 지원"
            >
              공식
            </span>
          ) : (
            <span
              className={`${styles.badge} ${styles.badgeWarning}`}
              title="공식 연결 제한 - 별도 주의"
            >
              주의
            </span>
          )}
        </div>

        <span className={styles.cardConnectCta} data-connected={connected ? "true" : "false"}>
          {connected ? "연결됨" : "연결"}
        </span>
      </button>
    );
  };

  const filtered = useMemo(() => {
    return connectors
      .filter((c) => filter === "all" || c.category === filter)
      .filter((c) => {
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return (
          c.label.toLowerCase().includes(q) ||
          c.shortDescription.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.recommendScore - a.recommendScore);
  }, [connectors, filter, query]);
  // 기본 화면은 추천 1개만 노출한다(모바일 간소화 계약).
  // 다만 검색어를 넣거나 분류를 고른 것은 "직접 찾겠다"는 의사 표시이므로, 그때는
  // 걸러낸 결과를 접지 않고 전부 보여준다. 이게 없으면 추천 1위(Gmail)가 아닌 연결은
  // — 학교/회사 메일처럼 — 사용자가 끝내 찾지 못한다.
  const browsingIntent = query.trim().length > 0 || filter !== "all";
  const visibleFiltered = browsingIntent ? filtered : filtered.slice(0, visibleConnectorLimit);
  const hiddenFiltered = browsingIntent ? [] : filtered.slice(visibleConnectorLimit);

  return (
    <section
      className={styles.catalog}
      aria-label="연결 가능한 도구 카탈로그"
      data-connector-catalog-organization="one_recommended_connector_search_on_demand"
      data-connector-catalog-disclosure="one_recommended_connector_then_search_on_demand"
      data-connector-catalog-visible-count={visibleFiltered.length}
      data-connector-catalog-hidden-count={hiddenFiltered.length}
      data-connector-catalog-filter={filter}
    >
      <header className={styles.header}>
        <h1 className={styles.heading}>도구 연결</h1>
      </header>

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          <strong>일치하는 도구가 없습니다</strong>
          <p>이름을 확인하거나 채팅에서 연결할 도구를 말해 주세요.</p>
        </div>
      ) : (
        <ul className={styles.grid} role="list" aria-label="우선 연결 목록">
          {visibleFiltered.map((connector) => (
            <li key={connector.id}>{renderConnectorCard(connector)}</li>
          ))}
        </ul>
      )}

      <details
        className={styles.moreConnectorFold}
        data-connector-catalog-more="search_and_remaining_connectors_on_demand"
        data-connector-catalog-more-count={hiddenFiltered.length}
      >
        <summary>
          <span>다른 도구 찾기</span>
          <strong>{query.trim() || filter !== "all" ? allLabel[filter] : "검색·분류"}</strong>
        </summary>
        <div className={styles.catalogTools}>
          <input
            type="search"
            id="connector-search"
            name="connectorSearch"
            className={styles.search}
            placeholder="도구 이름 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="연결 검색"
          />
          <nav className={styles.tabs} aria-label="카테고리 필터">
            {categoryOrder.map((cat) => {
              const count = cat === "all" ? connectors.length : connectors.filter((connector) => connector.category === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  className={`${styles.tab} ${filter === cat ? styles.tabActive : ""}`}
                  onClick={() => setFilter(cat)}
                  aria-pressed={filter === cat}
                >
                  {allLabel[cat]} <span>{count}</span>
                </button>
              );
            })}
          </nav>
          {hiddenFiltered.length ? (
            <ul className={styles.grid} role="list" aria-label="나머지 연결 목록">
              {hiddenFiltered.map((connector) => (
                <li key={connector.id}>{renderConnectorCard(connector)}</li>
              ))}
            </ul>
          ) : filtered.length ? <p className={styles.empty}>이 조건의 다른 도구가 없습니다.</p> : null}
        </div>
      </details>
    </section>
  );
}
