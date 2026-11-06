"use client";

/**
 * 일상 도구 패널 — 업무 도구 화면 안에서 "채팅에서 바로 물어볼 수 있는 공개 정보 조회"를 보여 준다.
 *
 * - 목록은 설치 앱(데스크톱 메인)이 동봉한 카탈로그에서 받는다. 웹 단독 화면에서는 안내만 한다.
 * - 켜기·끄기는 이 PC 저장소에 남고, 끄면 AI 직원이 daily.lookup 도구를 받지 않는다.
 * - 예문 버튼은 입력칸만 채운다. 보내기는 사용자가 한다.
 */

import { useEffect, useMemo, useState } from "react";
import styles from "./DailyToolsPanel.module.css";
import {
  dailySkillsEnabledEventName,
  loadDailySkillCatalog,
  readDailySkillsEnabled,
  writeDailySkillsEnabled,
  type DailySkillCatalog,
  type DailySkillsBridgeLike,
} from "@/lib/daily-skills";

type DailyToolsPanelProps = {
  bridge: DailySkillsBridgeLike | null;
  desktopAvailable: boolean;
  onTryExample: (example: string) => void;
};

type LoadState = "loading" | "ready" | "unavailable";

export default function DailyToolsPanel({ bridge, desktopAvailable, onTryExample }: DailyToolsPanelProps) {
  const [catalog, setCatalog] = useState<DailySkillCatalog | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [enabled, setEnabled] = useState(true);
  const [activeCategory, setActiveCategory] = useState("all");

  useEffect(() => {
    setEnabled(readDailySkillsEnabled());
    const sync = () => setEnabled(readDailySkillsEnabled());
    window.addEventListener(dailySkillsEnabledEventName, sync);
    return () => window.removeEventListener(dailySkillsEnabledEventName, sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!desktopAvailable || !bridge) {
      setLoadState("unavailable");
      return () => {
        cancelled = true;
      };
    }
    setLoadState("loading");
    void loadDailySkillCatalog(bridge).then((next) => {
      if (cancelled) return;
      setCatalog(next);
      setLoadState(next ? "ready" : "unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, desktopAvailable]);

  const categories = useMemo(() => {
    if (!catalog) return [];
    return catalog.categories
      .map((category) => ({
        ...category,
        count: catalog.skills.filter((skill) => skill.category === category.id).length,
      }))
      .filter((category) => category.count > 0);
  }, [catalog]);

  const visibleSkills = useMemo(() => {
    if (!catalog) return [];
    return activeCategory === "all"
      ? catalog.skills
      : catalog.skills.filter((skill) => skill.category === activeCategory);
  }, [catalog, activeCategory]);

  function toggle(next: boolean) {
    setEnabled(next);
    writeDailySkillsEnabled(next);
  }

  return (
    <section className={styles.panel} aria-label="일상 도구" data-daily-tools-state={loadState}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>일상 도구</span>
          <strong>날씨·교통·공휴일·법령 같은 공개 정보를 채팅에서 바로 물어보세요</strong>
          <small>
            {catalog
              ? `${catalog.skills.length}개 · 직원마다 맡은 일에 맞는 도구만 씁니다`
              : "직원마다 맡은 일에 맞는 도구만 씁니다"}
          </small>
        </div>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            onChange={(event) => toggle(event.currentTarget.checked)}
            disabled={loadState === "unavailable"}
            aria-label="채팅에서 일상 도구 쓰기"
          />
          <span>{enabled ? "켜짐" : "꺼짐"}</span>
        </label>
      </header>

      {loadState === "loading" ? <p className={styles.note}>도구 목록을 불러오는 중이에요.</p> : null}
      {loadState === "unavailable" ? (
        <p className={styles.note}>설치된 ModyCrew 앱에서 쓸 수 있어요. 앱을 최신 버전으로 업데이트하면 목록이 나타나요.</p>
      ) : null}

      {loadState === "ready" && catalog ? (
        <>
          <div className={styles.categories} role="group" aria-label="분류">
            <button
              type="button"
              className={styles.category}
              aria-pressed={activeCategory === "all"}
              onClick={() => setActiveCategory("all")}
            >
              전체 <b>{catalog.skills.length}</b>
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={styles.category}
                aria-pressed={activeCategory === category.id}
                onClick={() => setActiveCategory(category.id)}
              >
                {category.label} <b>{category.count}</b>
              </button>
            ))}
          </div>
          <ul className={styles.list}>
            {visibleSkills.map((skill) => (
              <li key={skill.id} className={styles.item}>
                <div className={styles.itemHead}>
                  <strong>{skill.name}</strong>
                  {skill.source ? <small>{skill.source}</small> : null}
                </div>
                <p>{skill.summary}</p>
                {skill.examples[0] ? (
                  <button
                    type="button"
                    className={styles.tryButton}
                    disabled={!enabled}
                    onClick={() => onTryExample(skill.examples[0])}
                  >
                    “{skill.examples[0]}” 물어보기
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            물어본 지역·검색어는 {catalog.proxy.provider}를 거쳐 각 기관의 공개 API로 전달되고, 답변에는 출처와 조회 시각이
            붙어요. 끄면 AI 직원이 이 도구를 쓰지 않아요. 도구 정보: {catalog.proxy.license}
          </p>
        </>
      ) : null}
    </section>
  );
}
