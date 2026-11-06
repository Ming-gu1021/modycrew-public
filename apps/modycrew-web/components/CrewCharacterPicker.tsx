"use client";

import { CSSProperties, KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import {
  CREW_CHARACTERS,
  CrewCharacter,
  CrewCharacterGender,
  CrewCharacterId,
  CrewCharacterRoleAffinity,
  crewCharacterRoleAffinityLabels,
  getCrewCharacter,
  getCrewCharacterRoleAffinity,
  resolveCrewCharacterAsset,
} from "@/lib/crew-character-catalog";
import styles from "./CrewCharacterPicker.module.css";

type CrewCharacterGenderFilter = "all" | CrewCharacterGender;

export type CrewCharacterPickerProps = {
  value?: CrewCharacterId | string | null;
  onChange: (characterId: CrewCharacterId) => void;
  /** A role title or role affinity used only to gently highlight suitable portraits. */
  roleHint?: CrewCharacterRoleAffinity | string | null;
  disabled?: boolean;
  className?: string;
};

const genderLabels: Record<CrewCharacterGenderFilter, string> = {
  all: "전체",
  male: "남자",
  female: "여자",
};

const genderDescription: Record<CrewCharacterGender, string> = {
  male: "남성 캐릭터",
  female: "여성 캐릭터",
};

function getVisibleCharacters(filter: CrewCharacterGenderFilter) {
  return filter === "all" ? CREW_CHARACTERS : CREW_CHARACTERS.filter((character) => character.gender === filter);
}

export default function CrewCharacterPicker({
  value,
  onChange,
  roleHint,
  disabled = false,
  className,
}: CrewCharacterPickerProps) {
  const generatedId = useId().replace(/:/g, "");
  const [filter, setFilter] = useState<CrewCharacterGenderFilter>("all");
  const tabRefs = useRef<Partial<Record<CrewCharacterGenderFilter, HTMLButtonElement | null>>>({});
  const optionRefs = useRef<Partial<Record<CrewCharacterId, HTMLButtonElement | null>>>({});
  const selectedCharacter = getCrewCharacter(value);
  const affinityHint = getCrewCharacterRoleAffinity(roleHint);
  const filters = useMemo(
    () =>
      (["all", "male", "female"] as const).map((item) => ({
        id: item,
        label: genderLabels[item],
        count: getVisibleCharacters(item).length,
      })),
    [],
  );
  const visibleCharacters = getVisibleCharacters(filter);
  const focusableId = visibleCharacters.some((character) => character.id === selectedCharacter?.id)
    ? selectedCharacter?.id
    : visibleCharacters[0]?.id;
  const panelId = `crew-character-panel-${generatedId}`;
  const tabId = (item: CrewCharacterGenderFilter) => `crew-character-tab-${item}-${generatedId}`;
  const classes = [styles.picker, className].filter(Boolean).join(" ");

  const selectCharacter = (character: CrewCharacter) => {
    if (!disabled) onChange(character.id);
  };

  const moveOptionFocus = (currentIndex: number, nextIndex: number) => {
    const nextCharacter = visibleCharacters[(nextIndex + visibleCharacters.length) % visibleCharacters.length];
    if (!nextCharacter || disabled) return;
    onChange(nextCharacter.id);
    optionRefs.current[nextCharacter.id]?.focus();
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (!visibleCharacters.length) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveOptionFocus(currentIndex, currentIndex + 1);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveOptionFocus(currentIndex, currentIndex - 1);
    }
    if (event.key === "Home") {
      event.preventDefault();
      moveOptionFocus(currentIndex, 0);
    }
    if (event.key === "End") {
      event.preventDefault();
      moveOptionFocus(currentIndex, visibleCharacters.length - 1);
    }
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? filters.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + filters.length) % filters.length;
    const nextFilter = filters[nextIndex]?.id;
    if (!nextFilter) return;
    setFilter(nextFilter);
    tabRefs.current[nextFilter]?.focus();
  };

  return (
    <section className={classes} aria-label="직원 캐릭터 선택">
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>직원 모습 선택</h3>
          <p className={styles.description}>업무 중 모습까지 함께 저장됩니다.</p>
        </div>
        {affinityHint ? <span className={styles.roleHint}>{crewCharacterRoleAffinityLabels[affinityHint]} 역할</span> : null}
      </div>

      <div className={styles.tabList} role="tablist" aria-label="캐릭터 성별 필터">
        {filters.map((item, index) => {
          const active = filter === item.id;
          return (
            <button
              key={item.id}
              ref={(element) => {
                tabRefs.current[item.id] = element;
              }}
              className={styles.tab}
              data-active={active}
              id={tabId(item.id)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              disabled={disabled}
              onClick={() => setFilter(item.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <span>{item.label}</span>
              <span aria-label={`${item.count}명`}>{item.count}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.panel} id={panelId} role="tabpanel" aria-labelledby={tabId(filter)}>
        <div className={styles.grid} role="radiogroup" aria-label={`${genderLabels[filter]} 직원 캐릭터`}>
          {visibleCharacters.map((character, index) => {
            const selected = selectedCharacter?.id === character.id;
            const pose = resolveCrewCharacterAsset(character, "idle");
            const recommended = affinityHint === character.roleAffinity;
            const portraitStyle = pose
              ? ({
                  "--crew-character-image-height": `${pose.crop.imageHeightMultiplier * 100}%`,
                  "--crew-character-image-translate-y": pose.crop.translateY,
                  objectPosition: pose.crop.objectPosition,
                } as CSSProperties)
              : undefined;

            return (
              <button
                key={character.id}
                ref={(element) => {
                  optionRefs.current[character.id] = element;
                }}
                className={styles.option}
                data-selected={selected}
                data-recommended={recommended}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${character.label}, ${genderDescription[character.gender]}, ${crewCharacterRoleAffinityLabels[character.roleAffinity]}`}
                tabIndex={focusableId === character.id ? 0 : -1}
                disabled={disabled}
                onClick={() => selectCharacter(character)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
              >
                <span className={styles.portraitFrame} aria-hidden="true">
                  {pose ? (
                    <img
                      className={styles.portrait}
                      data-asset-kind={character.asset.kind}
                      src={pose.src}
                      alt=""
                      draggable={false}
                      decoding="async"
                      style={portraitStyle}
                    />
                  ) : null}
                  {selected ? <span className={styles.selectedMark}>✓</span> : null}
                </span>
                <span className={styles.optionText}>
                  <strong>{character.label}</strong>
                  <small>{crewCharacterRoleAffinityLabels[character.roleAffinity]}</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className={styles.selectionSummary} aria-live="polite">
        {selectedCharacter
          ? `${selectedCharacter.label} · ${crewCharacterRoleAffinityLabels[selectedCharacter.roleAffinity]} 역할 모습 선택됨`
          : "캐릭터를 한 명 선택하세요."}
      </p>
    </section>
  );
}
