"use client";

import { useEffect, useState } from "react";
import { normalizeWorkApproach, type WorkApproach } from "../lib/work-refinement";
import styles from "./WorkApproachControl.module.css";

export function useWorkApproach(scope: string) {
  const key = `modycrew-work-approach-v1:${scope}`;
  const [selection, setSelection] = useState<{ key: string; value: WorkApproach }>({ key: "", value: "auto" });
  useEffect(() => {
    let value: WorkApproach = "auto";
    try { value = normalizeWorkApproach(localStorage.getItem(key)); } catch { /* Session choice remains usable. */ }
    setSelection({ key, value });
  }, [key]);
  return {
    value: selection.key === key ? selection.value : "auto" as WorkApproach,
    ready: selection.key === key,
    change(value: WorkApproach) {
      const normalized = normalizeWorkApproach(value);
      setSelection({ key, value: normalized });
      try { localStorage.setItem(key, normalized); return true; } catch { return false; }
    },
  };
}

export default function WorkApproachControl({ value, onChange, disabled }: { value: WorkApproach; onChange: (value: WorkApproach) => void; disabled?: boolean }) {
  return <label className={styles.control} title="작업 방향을 맡기거나, 제안을 확인한 뒤 진행할 수 있습니다. 실행 권한은 액세스 설정을 따릅니다.">
    <span aria-hidden="true">✧</span>
    <select aria-label="업무 진행 방식" value={value} onChange={event => onChange(normalizeWorkApproach(event.target.value))} disabled={disabled}>
      <option value="auto">알아서 진행</option>
      <option value="propose">먼저 제안받기</option>
    </select>
  </label>;
}

export function WorkProposalActions({ disabled, onUse, onRevise }: { disabled?: boolean; onUse: () => void; onRevise: () => void }) {
  return <div className={styles.proposal} aria-label="작업 제안 확인">
    <span>제안 단계 · 아직 실행하지 않았습니다</span>
    <div><button type="button" disabled={disabled} onClick={onUse}>이 제안으로 요청 작성</button><button type="button" disabled={disabled} onClick={onRevise}>방향 바꾸기</button></div>
  </div>;
}
