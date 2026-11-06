"use client";

/**
 * 승인함 답장 카드의 '어떻게 고칠까요?' 한 줄 입력.
 *
 * 예전 '고쳐달라고 하기'는 상태만 바꾸고 지시를 버려서, "좀 더 공손하게"라고 해도 아무 일도
 * 일어나지 않았다. 여기에 적은 지시로 AI 가 초안을 다시 쓰고, 새 초안을 바로 보여 준다.
 * 보내지 않는다 — 보내기는 여전히 마지막 확인을 거친다.
 */

import { useId, useState, type FormEvent } from "react";

import styles from "./MailRedraftForm.module.css";

export type MailRedraftOutcome = { ok: boolean; message: string; draftBody?: string };

type Props = {
  workItemId: string;
  title: string;
  onRedraft: (instruction: string) => Promise<MailRedraftOutcome>;
};

export function MailRedraftForm({ workItemId, title, onRedraft }: Props) {
  const inputId = useId();
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<MailRedraftOutcome | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = instruction.trim();
    if (!text || busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await onRedraft(text);
      setOutcome(result);
      if (result.ok) setInstruction("");
    } catch {
      setOutcome({ ok: false, message: "다시 쓰지 못했어요. 잠시 뒤 다시 눌러 주세요." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.form}
      aria-label={`${title} AI 에게 다시 쓰게 하기`}
      aria-busy={busy}
      data-mail-redraft-form={workItemId}
      data-mail-redraft-external-mutation="false"
      onSubmit={(event) => void submit(event)}
    >
      <label htmlFor={inputId}>어떻게 고칠까요?</label>
      <div className={styles.row}>
        <input
          id={inputId}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
          }}
          placeholder="예: 납기 날짜를 넣고 조금 더 공손하게"
          maxLength={600}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !instruction.trim()}>
          {busy ? "다시 쓰는 중…" : "다시 써 주세요"}
        </button>
      </div>
      {busy ? (
        <p role="status" className={styles.status}>
          AI 가 지시대로 초안을 다시 쓰고 있어요. 보내지는 않아요.
        </p>
      ) : outcome ? (
        <p role="status" className={styles.status} data-state={outcome.ok ? "ok" : "error"}>
          {outcome.message}
        </p>
      ) : null}
      {outcome?.ok && outcome.draftBody ? (
        <div className={styles.draft} data-mail-redraft-new-draft="true">
          <strong>새 초안</strong>
          <p>{outcome.draftBody}</p>
          <small>보내기 전에 [마지막 확인 준비]에서 받는 사람·제목·본문을 한 번 더 봅니다.</small>
        </div>
      ) : null}
    </form>
  );
}

export default MailRedraftForm;
