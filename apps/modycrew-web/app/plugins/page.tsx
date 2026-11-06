"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  defaultBundledPluginCards,
  readActiveAISkillIds,
  readAISkillPacks,
  saveActiveAISkillIds,
  type AISkillPack,
  type BundledPluginCard,
} from "@/lib/ai-skills";
import {
  activateFeature,
  featureCatalog,
  isFeatureActive,
  pauseFeature,
  readFeatureActivationRecords,
  type ModyFeatureActivationRecord,
} from "@/lib/feature-activation";
import { createDesktopBridge, type ConnectorStatusRecord } from "@/lib/desktop-bridge";
import styles from "./page.module.css";
import DownloadablePdfViewer from '@/components/DownloadablePdfViewer';
import { CrewSkillExtensions } from "@/components/CrewSkillExtensions";

// 카테고리 라벨/색 — 카드 아이콘 타일과 필터 라벨에 사용
const categoryMeta: Record<BundledPluginCard["category"], { label: string; accent: string }> = {
  desktop: { label: "내 PC", accent: "#0e7490" },
  documents: { label: "문서·자료", accent: "#b45309" },
  communication: { label: "메일·메시지", accent: "#0d9488" },
  knowledge: { label: "지식", accent: "#7c3aed" },
  business: { label: "업무", accent: "#2563eb" },
  finance: { label: "재무", accent: "#15803d" },
  design: { label: "디자인", accent: "#be185d" },
  development: { label: "개발", accent: "#334155" },
};

type ConnectCard = {
  id: string;
  label: string;
  summary: string;
  accent: string;
  href: string;
  match: RegExp;
};

// 연결 카드 — 실제 인증이 필요한 항목은 기존 연결 흐름으로 이동한다(가짜 설치 버튼 금지)
const connectCards: ConnectCard[] = [
  {
    id: "connect-mail-calendar",
    label: "메일·캘린더 연결",
    summary: "받은 메일 정리, 답장 초안, 일정 후보까지 — 이메일 주소만 넣으면 서버를 자동 탐색해요.",
    accent: "#0d9488",
    href: "/connect?singleSetting=mail-calendar",
    match: /mail|imap|calendar|smtp|outlook|gmail/iu,
  },
  {
    id: "connect-ai",
    label: "AI 답변 연결",
    summary: "팀원이 실제로 생각하고 답하게 하는 AI 계정 연결이에요. 로그인 한 번이면 됩니다.",
    accent: "#2563eb",
    href: "/connect?singleSetting=codex-oauth",
    match: /codex|openai|ai-provider|provider/iu,
  },
  {
    id: "connect-messenger",
    label: "알림 메신저 연결",
    summary: "승인 요청과 업무 결과를 텔레그램·슬랙으로 받아보고 답할 수 있어요.",
    accent: "#7c3aed",
    href: "/connect?singleSetting=messenger-channel",
    match: /telegram|slack|messenger|channel/iu,
  },
  {
    id: "connect-vault",
    label: "계정 보관함",
    summary: "앱 비밀번호 같은 민감한 값은 채팅 대신 보관함에 안전하게 넣어요.",
    accent: "#475569",
    href: "/connect?singleSetting=vault",
    match: /vault|secret/iu,
  },
];

const connectedStatusPattern = /ready|connected|ok|active|저장|연결/iu;

function initialFor(label: string): string {
  const first = label.trim().charAt(0);
  return first || "?";
}


export default function PluginsPage() {
  const [query, setQuery] = useState("");
  const [allToolsOpen, setAllToolsOpen] = useState(false);
  const [skillPacks, setSkillPacks] = useState<AISkillPack[]>([]);
  const [activeSkillIds, setActiveSkillIds] = useState<string[]>([]);
  const [featureRecords, setFeatureRecords] = useState<ModyFeatureActivationRecord[]>([]);
  const [connectorStatuses, setConnectorStatuses] = useState<ConnectorStatusRecord[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setSkillPacks(readAISkillPacks());
    setActiveSkillIds(readActiveAISkillIds());
    setFeatureRecords(readFeatureActivationRecords());
    const bridge = createDesktopBridge();
    if (!bridge.isAvailable) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await bridge.listConnectorStatuses();
        if (!cancelled) setConnectorStatuses(result.connectors ?? []);
      } catch {
        // 연결 상태를 못 읽어도 카탈로그는 그대로 보여준다
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  }, []);

  const activeSkillIdSet = useMemo(() => new Set(activeSkillIds), [activeSkillIds]);
  const skillTitleById = useMemo(() => new Map(skillPacks.map((pack) => [pack.id, pack.title])), [skillPacks]);

  const isPluginOn = useCallback(
    (card: BundledPluginCard) =>
      card.crewKitIds.length > 0 && card.crewKitIds.every((id) => activeSkillIdSet.has(id)),
    [activeSkillIdSet],
  );

  const togglePlugin = useCallback(
    (card: BundledPluginCard) => {
      if (!card.crewKitIds.length) return;
      const turnOn = !isPluginOn(card);
      setActiveSkillIds((current) => {
        const next = turnOn
          ? Array.from(new Set([...current, ...card.crewKitIds]))
          : current.filter((id) => !card.crewKitIds.includes(id));
        saveActiveAISkillIds(next);
        return next;
      });
      showNotice(turnOn ? `${card.label} 켜짐` : `${card.label} 꺼짐`);
    },
    [isPluginOn, showNotice],
  );

  const toggleSkill = useCallback(
    (pack: AISkillPack) => {
      const turnOn = !activeSkillIdSet.has(pack.id);
      setActiveSkillIds((current) => {
        const next = turnOn ? Array.from(new Set([...current, pack.id])) : current.filter((id) => id !== pack.id);
        saveActiveAISkillIds(next);
        return next;
      });
      showNotice(turnOn ? `${pack.title} 켜짐` : `${pack.title} 꺼짐`);
    },
    [activeSkillIdSet, showNotice],
  );

  const toggleFeature = useCallback(
    (featureId: (typeof featureCatalog)[number]["id"], title: string) => {
      const active = isFeatureActive(featureRecords, featureId);
      const next = active ? pauseFeature(featureId) : activateFeature(featureId, "plugins_page");
      setFeatureRecords(next);
      showNotice(active ? `${title} 끔` : `${title} 켜짐`);
    },
    [featureRecords, showNotice],
  );

  const isConnected = useCallback(
    (card: ConnectCard) =>
      connectorStatuses.some(
        (record) =>
          card.match.test(`${record.connectorId} ${record.category ?? ""}`) &&
          connectedStatusPattern.test(record.status),
      ),
    [connectorStatuses],
  );

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = useCallback(
    (...texts: Array<string | undefined>) =>
      !normalizedQuery || texts.some((text) => (text ?? "").toLocaleLowerCase().includes(normalizedQuery)),
    [normalizedQuery],
  );

  const visiblePlugins = useMemo(
    () =>
      defaultBundledPluginCards.filter((card) =>
        matches(card.label, card.summary, categoryMeta[card.category].label),
      ),
    [matches],
  );
  const visibleConnects = useMemo(() => connectCards.filter((card) => matches(card.label, card.summary)), [matches]);
  const visibleSkills = useMemo(
    () => skillPacks.filter((pack) => matches(pack.title, pack.summary)),
    [matches, skillPacks],
  );
  const visibleFeatures = useMemo(
    () => featureCatalog.filter((feature) => matches(feature.title, feature.description)),
    [matches],
  );

  const inUseTiles = useMemo(() => {
    const tiles: Array<{ id: string; label: string; accent: string }> = [];
    for (const card of connectCards) {
      if (isConnected(card)) tiles.push({ id: card.id, label: card.label, accent: card.accent });
    }
    for (const card of defaultBundledPluginCards) {
      if (isPluginOn(card)) tiles.push({ id: card.id, label: card.label, accent: categoryMeta[card.category].accent });
    }
    for (const feature of featureCatalog) {
      if (isFeatureActive(featureRecords, feature.id)) {
        tiles.push({ id: `feature-${feature.id}`, label: feature.title, accent: "#2563eb" });
      }
    }
    return tiles.slice(0, 18);
  }, [featureRecords, isConnected, isPluginOn]);

  const nothingVisible =
    !visiblePlugins.length && !visibleConnects.length && !visibleSkills.length && !visibleFeatures.length;
  const showingAllTools = allToolsOpen || Boolean(normalizedQuery);
  const primaryConnect = visibleConnects.find((card) => !isConnected(card)) ?? visibleConnects[0];
  const primaryPlugin = primaryConnect ? undefined : visiblePlugins[0];
  const displayedConnects = showingAllTools ? visibleConnects : primaryConnect ? [primaryConnect] : [];
  const displayedPlugins = showingAllTools ? visiblePlugins : primaryPlugin ? [primaryPlugin] : [];
  const hiddenToolCount = Math.max(0, visibleConnects.length - (primaryConnect ? 1 : 0)) +
      Math.max(0, visiblePlugins.length - (primaryPlugin ? 1 : 0)) +
      visibleSkills.length +
      visibleFeatures.length;

  return (
    <main className={styles.shell} aria-label="플러그인">
      <div className={styles.wrap}>
        <header className={styles.head}>
          <h1 className={styles.title}>플러그인</h1>
          <p className={styles.subtitle}>즐겨 쓰는 도구와 연결을 한 곳에서 켜고 끄세요. AI 팀원이 바로 씁니다.</p>
          <div className={styles.searchRow}>
            <input
              type="search"
              className={styles.search}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="플러그인 검색"
              aria-label="플러그인 검색"
            />
            {notice ? (
              <span className={styles.notice} role="status">
                {notice}
              </span>
            ) : null}
          </div>
        </header>

        {!normalizedQuery || /pdf|문서|뷰어|viewer/iu.test(normalizedQuery) ? <DownloadablePdfViewer /> : null}
        <CrewSkillExtensions query={normalizedQuery} />
        {inUseTiles.length ? (
          <section className={styles.section} aria-label="사용 중">
            <h2 className={styles.sectionTitle}>사용 중</h2>
            <div className={styles.tileRow}>
              {inUseTiles.map((tile) => (
                <span
                  key={tile.id}
                  className={styles.tile}
                  style={{ ["--tile-accent" as string]: tile.accent }}
                >
                  <b aria-hidden="true">{initialFor(tile.label)}</b>
                  {tile.label}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {displayedConnects.length ? (
          <section className={styles.section} aria-label="연결">
            <h2 className={styles.sectionTitle}>{showingAllTools ? "연결" : "추천 연결"}</h2>
            <div className={styles.grid}>
              {displayedConnects.map((card) => {
                const connected = isConnected(card);
                return (
                  <article key={card.id} className={styles.card}>
                    <span className={styles.cardIcon} style={{ ["--tile-accent" as string]: card.accent }}>
                      {initialFor(card.label)}
                    </span>
                    <div className={styles.cardBody}>
                      <b className={styles.cardTitle}>{card.label}</b>
                      <p className={styles.cardSummary}>{card.summary}</p>
                    </div>
                    <div className={styles.cardAction}>
                      {connected ? <span className={styles.onBadge}>연결됨</span> : null}
                      <a className={styles.linkButton} href={card.href}>
                        {connected ? "관리" : "연결하기"}
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {displayedPlugins.length ? (
          <section className={styles.section} aria-label="추천 플러그인">
            <h2 className={styles.sectionTitle}>플러그인 관리</h2>
            <div className={styles.grid}>
              {displayedPlugins.map((card) => {
                const meta = categoryMeta[card.category];
                const on = isPluginOn(card);
                const toggleable = card.crewKitIds.length > 0;
                return (
                  <article key={card.id} className={styles.card} data-on={on ? "true" : undefined}>
                    <span className={styles.cardIcon} style={{ ["--tile-accent" as string]: meta.accent }}>
                      {initialFor(card.label)}
                    </span>
                    <div className={styles.cardBody}>
                      <b className={styles.cardTitle}>{card.label}</b>
                      <p className={styles.cardSummary}>{card.summary}</p>
                      <span className={styles.cardMeta}>
                        {meta.label}
                        {card.crewKitIds.length
                          ? ` · ${card.crewKitIds
                              .map((id) => skillTitleById.get(id) ?? "")
                              .filter(Boolean)
                              .slice(0, 2)
                              .join(" · ")}`
                          : ""}
                      </span>
                    </div>
                    <div className={styles.cardAction}>
                      {toggleable ? (
                        <button
                          type="button"
                          className={on ? styles.onButton : styles.installButton}
                          aria-pressed={on}
                          onClick={() => togglePlugin(card)}
                        >
                          {on ? "켜짐" : "켜기"}
                        </button>
                      ) : (
                        <span className={styles.onBadge}>기본 제공</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {!normalizedQuery && hiddenToolCount > 0 ? (
          <button
            type="button"
            className={styles.allToolsButton}
            onClick={() => setAllToolsOpen((current) => !current)}
            aria-label={allToolsOpen ? "추천만 보기" : `다른 도구 ${hiddenToolCount}개 보기`}
            aria-expanded={allToolsOpen}
          >
            {allToolsOpen ? "추천만 보기" : `다른 도구 ${hiddenToolCount}개 보기`}
          </button>
        ) : null}

        {showingAllTools && visibleSkills.length ? (
          <section className={styles.section} aria-label="업무 도구">
            <h2 className={styles.sectionTitle}>업무 도구</h2>
            <p className={styles.sectionHint}>문서 작성, 폴더 정리 같은 개별 도구를 하나씩 켜고 끕니다.</p>
            <div className={styles.chipGrid}>
              {visibleSkills.map((pack) => {
                const on = activeSkillIdSet.has(pack.id);
                return (
                  <button
                    key={pack.id}
                    type="button"
                    className={styles.skillChip}
                    data-on={on ? "true" : undefined}
                    aria-pressed={on}
                    onClick={() => toggleSkill(pack)}
                    title={pack.summary}
                  >
                    <i aria-hidden="true" />
                    {pack.title}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {showingAllTools && visibleFeatures.length ? (
          <section className={styles.section} aria-label="앱 기능">
            <h2 className={styles.sectionTitle}>앱 기능</h2>
            <p className={styles.sectionHint}>업무 처리·연결 추천처럼 앱이 먼저 움직이는 기능을 관리해요.</p>
            <div className={styles.grid}>
              {visibleFeatures.map((feature) => {
                const on = isFeatureActive(featureRecords, feature.id);
                return (
                  <article key={feature.id} className={styles.card} data-on={on ? "true" : undefined}>
                    <span className={styles.cardIcon} style={{ ["--tile-accent" as string]: "#2563eb" }}>
                      {initialFor(feature.title)}
                    </span>
                    <div className={styles.cardBody}>
                      <b className={styles.cardTitle}>{feature.title}</b>
                      <p className={styles.cardSummary}>{feature.description}</p>
                      <span className={styles.cardMeta}>{feature.safetyBoundary}</span>
                    </div>
                    <div className={styles.cardAction}>
                      <button
                        type="button"
                        className={on ? styles.onButton : styles.installButton}
                        aria-pressed={on}
                        onClick={() => toggleFeature(feature.id, feature.title)}
                      >
                        {on ? "켜짐" : "켜기"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {nothingVisible ? <p className={styles.empty}>검색과 맞는 플러그인이 없어요. 다른 말로 찾아보세요.</p> : null}
      </div>
    </main>
  );
}
