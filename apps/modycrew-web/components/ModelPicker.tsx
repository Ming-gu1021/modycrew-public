"use client";

   
                              
  
                                            
                                                   
                                                
                      
  
                                           
                                              
                                              
                       
   

import { useEffect, useId, useRef, useState } from "react";
import { useAnchoredPopover } from "@/lib/use-anchored-popover";
import { MODEL_DISPLAY_EVENT, MODEL_DISPLAY_KEY, modelDisplayId, readHiddenModels, saveHiddenModels, visibleModels } from "@/lib/model-display-preferences.mjs";
import styles from "./ModelPicker.module.css";

export type ModelChoice = {
  /** 저장·호출에 쓰는 실제 모델 id */
  id: string;
  /** 사람이 읽는 이름 */
  label: string;
  /** "빠름", "깊게 생각" 같은 한 마디 */
  hint?: string;
  provider: string;
  /** "GPT", "Claude", "내 PC" */
  providerLabel: string;
  /** 지금 바로 고를 수 있는가 */
  ready: boolean;
  /** 못 고르면 무엇이 필요한지 — "API 키 입력", "내 PC에 설치" */
  needs?: string;
  /** 미연결 항목만 연결 화면을 연다. 권한 미확인·거절 항목은 비활성이다. */
  setupRequired?: boolean;
};

type ModelPickerProps = {
  choices: ModelChoice[];
  /** 지금 답하고 있는 모델 id */
  activeId: string;
  /** 같은 모델 id를 제공하는 계정이 여러 개면 제공자까지 구분한다. */
  activeProvider?: string;
  disabled?: boolean;
  /** 로컬 모델을 아직 찾는 중인가 — 목록이 비어 보이는 이유를 말해 준다 */
  scanningLocal?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onSelect: (choice: ModelChoice) => void;
  /** 준비가 필요한 제공자를 눌렀을 때 — 연결 화면으로 데려간다 */
  onSetUp: (choice: ModelChoice) => void;
};

/** 목록에 없는 id 여도 무엇이 답하는지는 보여줘야 한다 — 빈 칸보다 낫다. */
function activeLabel(choices: ModelChoice[], activeId: string, activeProvider?: string): string {
  const wanted = activeId.trim();
  // 빈 id 로 찾으면 안 된다. 목록에는 id 가 빈 자리표시자("설치된 모델 없음")가 들어
  // 있어서, 아직 아무 모델도 안 정해진 상태가 그 자리표시자로 표시된다 — 실제로 그랬다.
  if (!wanted) return "연결 후 선택";
  const found = choices.find((choice) => choice.id && choice.id === wanted && (!activeProvider || choice.provider === activeProvider));
  return found ? found.label : wanted;
}

export default function ModelPicker({
  choices,
  activeId,
  activeProvider,
  disabled = false,
  scanningLocal = false,
  refreshing = false,
  onRefresh,
  onSelect,
  onSetUp,
}: ModelPickerProps) {
  const menuId = `model-picker-${useId().replace(/:/g, "")}`;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const open = useAnchoredPopover(triggerRef, menuRef);
  const [hidden, setHidden] = useState<string[]>([]);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferenceError, setPreferenceError] = useState("");
  useEffect(() => {
    const sync = () => { try { setHidden(readHiddenModels(window.localStorage)); setPreferenceError(""); setPreferencesReady(true); } catch { setPreferencesReady(false); setPreferenceError("표시 설정을 읽지 못했습니다. 기존 저장값은 보존했습니다."); } };
    const storage = (event: StorageEvent) => { if (!event.key || event.key === MODEL_DISPLAY_KEY) sync(); };
    sync(); window.addEventListener(MODEL_DISPLAY_EVENT, sync); window.addEventListener("storage", storage);
    return () => { window.removeEventListener(MODEL_DISPLAY_EVENT, sync); window.removeEventListener("storage", storage); };
  }, []);
  function updateHidden(next: string[]) {
    try { saveHiddenModels(window.localStorage, next); setHidden(next); setPreferencesReady(true); setPreferenceError(""); window.dispatchEvent(new Event(MODEL_DISPLAY_EVENT)); }
    catch { setPreferenceError("표시 설정을 저장하지 못했습니다. 이전 설정과 선택 모델을 유지합니다."); }
  }
  const connected = choices.filter(choice => choice.ready && choice.id);
  const selected = choices.find((choice) => Boolean(choice.id) && choice.id === activeId.trim() && (!activeProvider || choice.provider === activeProvider));
  const label = activeLabel(choices, activeId, activeProvider);
  // 연결 상태 안내: 화면에는 입력창 위 띠로 보이고, 화면 낭독기에는 모델 버튼 설명으로 읽힌다.
  const needsConnection = !activeId.trim();
  const needsCheck = Boolean(selected && !selected.ready);
  const hintId = `${menuId}-hint`;
  const hint = needsConnection
    ? "AI가 아직 연결되지 않았어요. 눌러서 연결할 AI를 고르면 쓴 글을 그대로 보낼 수 있어요."
    : needsCheck
      ? `선택한 모델을 지금 쓸 수 있는지 확인이 필요해요. ${selected?.needs || "사용 가능 여부 확인 필요"}`
      : "";

  // 제공자별로 묶되 순서는 넘어온 대로 유지한다 — 쓸 수 있는 것이 앞에 오도록
  // 부르는 쪽이 정렬해서 준다.
  const groups: Array<{ provider: string; providerLabel: string; items: ModelChoice[] }> = [];
  for (const choice of visibleModels(choices, hidden)) {
    const existing = groups.find((group) => group.provider === choice.provider);
    if (existing) existing.items.push(choice);
    else groups.push({ provider: choice.provider, providerLabel: choice.providerLabel, items: [choice] });
  }

  return (
    <div className={styles.root} data-model-picker="home">
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        popoverTarget={menuId}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-controls={menuId}
        aria-expanded={open}
        aria-label={`답변 모델 ${label} — 눌러서 바꾸기`}
        title={`답변 모델: ${label}${selected && !selected.ready ? ` · ${selected.needs || "사용 가능 여부 확인 필요"}` : ""}`}
        data-needs-connection={needsConnection ? "true" : undefined}
        aria-describedby={hint ? hintId : undefined}
      >
        <span className={styles.triggerCaption}>답변 모델</span>
        <strong>{label}{selected && !selected.ready ? " · 확인 필요" : ""}</strong>
        <svg className={styles.caret} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
      </button>
      {hint ? <span id={hintId} className="sr-only">{hint}</span> : null}

      <div id={menuId} ref={menuRef} popover="auto" className={styles.menu} role="dialog" aria-label="답변 모델 선택">
        <header className={styles.heading}>
          <h3>답변 모델</h3>
          <button type="button" popoverTarget={menuId} popoverTargetAction="hide" aria-label="답변 모델 선택 닫기"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
        </header>
        {onRefresh ? (
          <section className={styles.group} aria-label="모델 목록 확인">
            <button type="button" onClick={onRefresh} disabled={disabled || refreshing}>
              {refreshing ? "모델 목록 확인 중…" : "모델 목록 새로고침"}
            </button>
            <p className={styles.scanning} role="status">{refreshing ? "연결한 계정의 지원 모델을 확인하고 있습니다." : "계정에서 확인된 모델만 선택할 수 있습니다. 실제 요청에서 사용 가능 여부를 다시 확인합니다."}</p>
          </section>
        ) : null}
        <p className={styles.scanning}>연결된 계정에서 사용 가능으로 확인된 모델입니다. 사용량은 왼쪽 AI 사용량에서 확인하세요.</p>
        {!groups.length && <p className={styles.empty} role="status">{connected.length ? "표시할 모델이 모두 숨겨져 있습니다. 아래 표시 모델 설정에서 선택하세요." : "사용 가능한 연결 모델이 없습니다. 연결 설정에서 계정과 권한을 확인하세요."}</p>}
        {groups.map((group, index) => (
          <section key={group.provider} className={styles.group} role="group" aria-labelledby={`${menuId}-group-${index}`}>
            <h4 id={`${menuId}-group-${index}`}>{group.providerLabel}</h4>
            {group.items.map((choice) => (
              <button
                key={`${choice.provider}:${choice.id}`}
                type="button"
                disabled={disabled || refreshing || (!choice.ready && !choice.setupRequired)}
                aria-pressed={choice === selected}
                data-active={choice === selected ? "true" : undefined}
                data-ready={choice.ready ? "true" : "false"}
                onClick={() => {
                  if (disabled || refreshing || (!choice.ready && !choice.setupRequired)) return;
                  menuRef.current?.hidePopover();
                  if (choice.ready) onSelect(choice);
                  else if (choice.setupRequired) onSetUp(choice);
                }}
              >
                <span className={styles.name}>{choice.label}</span>
                {choice.hint ? <small className={styles.hint}>{choice.hint}</small> : null}
                {/* 준비가 필요한 것은 **무엇이** 필요한지 그 자리에서 말한다.
                    "사용 불가"로 끝내면 사용자가 무엇을 할지 모른다. */}
                {!choice.ready && choice.needs ? <small className={styles.needs}>{choice.needs}</small> : null}
                {choice === selected ? (
                  <span className={styles.check} aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
            ))}
          </section>
        ))}

        {scanningLocal ? (
          <p className={styles.scanning} role="status">
            내 PC에 깔린 모델을 찾는 중…
          </p>
        ) : null}
        <details className={styles.preferences}>
          <summary>표시 모델 설정</summary>
          <p>이 기기에서 목록에 보일 모델을 선택하세요. 숨겨도 현재 선택과 계정 연결은 유지됩니다.</p>
          {connected.map(choice => <label key={modelDisplayId(choice)}>
            <input type="checkbox" disabled={!preferencesReady} checked={!hidden.includes(modelDisplayId(choice))} onChange={event => updateHidden(event.target.checked ? hidden.filter(id => id !== modelDisplayId(choice)) : [...hidden, modelDisplayId(choice)])} />
            <span>{choice.label}<small>{choice.providerLabel}</small></span>
          </label>)}
          <button type="button" onClick={() => updateHidden([])}>표시 설정 초기화</button>
        </details>
        {preferenceError && <p role="alert" className={styles.empty}>{preferenceError}</p>}
        <a className={styles.settingsLink} href="/account/">연결 계정·AI 설정 열기 →</a>
      </div>
    </div>
  );
}
