"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createDesktopBridge, type MailWritingAccountMode, type MailWritingDefaultMode, type MailWritingProfile } from "@/lib/desktop-bridge";
import { buildCardSignature, emptyBusinessCard, mailWritingFormFor, type BusinessCardFields } from "@/lib/mail-writing-settings";
import styles from "./MailWritingSettings.module.css";

type Account = { key: string; label: string };

const defaultModeLabels: Record<MailWritingDefaultMode, string> = { name: "앱 프로필 이름", custom: "명함 서명", none: "서명 없음" };
const accountModeLabels: Record<MailWritingAccountMode, string> = { inherit: "기본 설정 따르기", custom: "이 계정 전용 명함", none: "서명 없음" };
const toneChips = ["결론부터 짧게", "정중하지만 딱딱하지 않게", "격식 있게", "회신 기한을 날짜로 적기", "맺음은 '감사합니다.'"];
const cardFieldLabels: Array<[keyof BusinessCardFields, string, string]> = [
  ["name", "이름", "홍길동"],
  ["title", "직함·부서", "대표"],
  ["company", "회사", "모디크루"],
  ["phone", "전화", "T. 02-000-0000 · M. 010-0000-0000"],
  ["email", "이메일", "name@company.com"],
  ["extra", "주소·웹사이트", "서울시 ○○구 ○○로 00 · www.company.com"],
];

   
                                                                          
                                                                       
   
export default function MailWritingSettings({ accounts }: { accounts: Account[] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<MailWritingProfile | null>(null);
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<MailWritingDefaultMode | MailWritingAccountMode>("name");
  const [signature, setSignature] = useState("");
  const [tone, setTone] = useState("");
  const [card, setCard] = useState<BusinessCardFields>(emptyBusinessCard);
  const [sample, setSample] = useState("");
  const [busy, setBusy] = useState<"" | "load" | "save" | "learn">("");
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const loaded = useRef(false);
  // 화면 값은 계정을 바꾸거나 처음 불러왔을 때만 다시 채운다. 저장으로 설정이 갱신될 때는 적던 값과 안내를 그대로 둔다.
  const formKey = useRef("");

  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    setBusy("load");
    void createDesktopBridge().mailWritingProfile({ kind: "writing_profile_load" })
      .then(result => {
        if (result.profile) setProfile(result.profile);
        else setNotice({ text: result.userMessage || "서명·말투 설정을 불러오지 못했어요.", error: true });
      })
      .catch(() => setNotice({ text: "서명·말투 설정을 불러오지 못했어요.", error: true }))
      .finally(() => setBusy(""));
  }, [open]);

  useEffect(() => {
    const key = target + "|" + (profile ? "loaded" : "empty");
    if (formKey.current === key) return;
    formKey.current = key;
    const form = mailWritingFormFor(profile, target);
    setMode(form.mode); setSignature(form.signature); setTone(form.tone); setCard(emptyBusinessCard); setNotice(null);
  }, [profile, target]);

  const isAccount = Boolean(target);
  const modes = isAccount ? (Object.keys(accountModeLabels) as MailWritingAccountMode[]) : (Object.keys(defaultModeLabels) as MailWritingDefaultMode[]);
  const configured = (key: string) => Boolean(profile?.accounts[key]);
  const cardSignature = buildCardSignature(card);

  const save = async () => {
    if (busy) return;
    if (mode === "custom" && !signature.trim()) { setNotice({ text: "서명을 적거나 명함 양식으로 만든 뒤 저장해 주세요.", error: true }); return; }
    setBusy("save"); setNotice(null);
    try {
      const result = await createDesktopBridge().mailWritingProfile({ kind: "writing_profile_save", ...(isAccount ? { accountKey: target } : {}), signatureMode: mode, signature, tone });
      if (!result.profile) throw new Error(result.userMessage || "저장하지 못했어요.");
      setProfile(result.profile);
      setNotice({ text: result.userMessage || "저장했어요. 다음 초안부터 반영돼요." });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.", error: true });
    } finally { setBusy(""); }
  };

  const learnTone = async () => {
    if (busy || !sample.trim()) return;
    setBusy("learn"); setNotice({ text: "붙여 넣은 메일에서 말투를 정리하고 있어요. 연락처는 가리고 AI 에 보내요." });
    try {
      const result = await createDesktopBridge().mailWritingProfile({ kind: "writing_profile_learn_tone", sample });
      if (result.tone) { setTone(result.tone); setSample(""); setNotice({ text: result.userMessage || "말투를 정리했어요. 확인하고 저장해 주세요." }); }
      else setNotice({ text: result.userMessage || "말투를 정리하지 못했어요. 직접 적어도 돼요.", error: true });
    } catch {
      setNotice({ text: "말투를 정리하지 못했어요. 직접 적어도 돼요.", error: true });
    } finally { setBusy(""); }
  };

  return (
    <details className={styles.writing} data-mail-writing-settings onToggle={event => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary>답장 서명·말투{profile ? <span className={styles.badge}>{defaultModeLabels[profile.defaults.signatureMode]}{Object.keys(profile.accounts).length ? " · 계정별 " + Object.keys(profile.accounts).length : ""}</span> : null}</summary>
      <div className={styles.body} aria-busy={busy === "load"}>
        <p className={styles.note}>답장 초안 끝에 붙일 서명(명함)과 평소 말투를 정해요. 서명은 이 PC에만 저장하고 AI 에 보내지 않아요. 계정마다 다르게 둘 수 있어요.</p>
        <label className={styles.field}>적용할 계정
          <select value={target} onChange={event => setTarget(event.target.value)} disabled={Boolean(busy)}>
            <option value="">모든 계정 기본값</option>
            {accounts.map(account => <option key={account.key} value={account.key}>{account.label}{configured(account.key) ? " · 따로 설정됨" : ""}</option>)}
          </select>
        </label>
        <fieldset className={styles.modes} disabled={Boolean(busy)}>
          <legend>서명</legend>
          {modes.map(value => (
            <label key={value} data-checked={mode === value}>
              <input type="radio" name={id + "-mode"} value={value} checked={mode === value} onChange={() => setMode(value)} />
              {isAccount ? accountModeLabels[value as MailWritingAccountMode] : defaultModeLabels[value as MailWritingDefaultMode]}
            </label>
          ))}
        </fieldset>
        {mode === "name" ? <p className={styles.hint}>설정의 내 이름(앱 프로필 이름)만 한 줄로 붙여요. 이름이 비어 있으면 서명을 붙이지 않아요.</p> : null}
        {mode === "none" ? <p className={styles.hint}>{isAccount ? "이 계정에서 보내는 답장에는 서명을 붙이지 않아요." : "답장에 서명을 붙이지 않아요."}</p> : null}
        {mode === "inherit" ? <p className={styles.hint}>모든 계정 기본값의 서명을 따라가요.</p> : null}
        {mode === "custom" ? (
          <div className={styles.card}>
            <details className={styles.cardForm}>
              <summary>명함 양식으로 만들기</summary>
              <div className={styles.cardGrid}>
                {cardFieldLabels.map(([key, label, placeholder]) => (
                  <label key={key}>{label}<input value={card[key]} placeholder={placeholder} maxLength={80} onChange={event => setCard(current => ({ ...current, [key]: event.target.value }))} /></label>
                ))}
              </div>
              <button type="button" className={styles.secondary} disabled={!cardSignature} onClick={() => setSignature(cardSignature)}>서명에 넣기</button>
            </details>
            <label className={styles.field}>서명(명함) <small>{signature.length}/400자 · 8줄까지</small>
              <textarea rows={5} maxLength={400} value={signature} placeholder={"홍길동 | 대표\n모디크루\nT. 02-000-0000 · M. 010-0000-0000\nname@company.com"} onChange={event => setSignature(event.target.value)} />
            </label>
          </div>
        ) : null}
        <label className={styles.field}>평소 말투 <small>{isAccount ? "비워 두면 기본 말투를 따라가요" : "AI 초안과 다시 쓰기에 반영돼요"}</small>
          <textarea rows={3} maxLength={600} value={tone} placeholder="예: 결론부터 짧게 쓰고, 회신 기한은 날짜로 적고, '감사합니다.'로 맺음" onChange={event => setTone(event.target.value)} />
        </label>
        <div className={styles.chips} role="group" aria-label="자주 쓰는 말투 넣기">
          {toneChips.map(chip => <button key={chip} type="button" disabled={tone.includes(chip)} onClick={() => setTone(current => (current.trim() ? current.trim() + "\n" : "") + chip)}>+ {chip}</button>)}
        </div>
        <details className={styles.learn}>
          <summary>내가 보낸 메일로 말투 정리</summary>
          <p className={styles.hint}>평소에 보낸 메일 한두 통을 붙여 넣으면 AI 가 말투만 정리해 위 칸에 넣어요. 연락처는 가리고 보내며, 붙여 넣은 글은 저장하지 않아요.</p>
          <textarea rows={5} maxLength={4000} value={sample} placeholder="예전에 보낸 업무 메일 본문을 붙여 넣으세요." onChange={event => setSample(event.target.value)} />
          <button type="button" className={styles.secondary} disabled={Boolean(busy) || sample.replace(/\s+/gu, "").length < 40} onClick={() => void learnTone()}>{busy === "learn" ? "정리하는 중…" : "AI로 말투 정리"}</button>
        </details>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => void save()}>{busy === "save" ? "저장하는 중…" : "저장"}</button>
          {notice ? <span role="status" data-error={notice.error ? "true" : "false"}>{notice.text}</span> : null}
        </div>
      </div>
    </details>
  );
}
