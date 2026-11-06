"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  VOICE_MAX_RECORDING_SECONDS,
  VoiceInputError,
  assertRecordingUsable,
  cancelSpeechRecognition,
  createVoiceRecorder,
  describeEngineResult,
  formatDuration,
  getSpeechEngineStatus,
  isSpeechRecognitionAvailable,
  newRequestId,
  prepareSpeechEngine,
  transcribeWav,
  type VoiceRecorder,
} from "@/lib/voice-input";
import styles from "./VoiceInputButton.module.css";

/**
 * 말로 입력하기 버튼.
 * - 누르면 녹음, 다시 누르면 멈추고 받아쓴 글을 onText(text)로 넘긴다(자동 전송하지 않음).
 * - 녹음 중에는 시간과 소리 크기를 보여 주고, Esc 로 녹음·받아쓰기를 취소한다.
 * - 엔진이나 모델이 없으면 내려받기를 물어본다(사용자가 "내려받기"를 눌러야만 받는다).
 * - 녹음은 이 PC 안의 받아쓰기 엔진으로만 보낸다.
 */

type Phase = "idle" | "checking" | "recording" | "transcribing" | "setup" | "preparing";
type Notice = { tone: "info" | "warning" | "error"; text: string; helpUrl?: string };
type Setup = { modelId: string; downloadBytes: number; message: string };

export type VoiceInputButtonProps = {
  onText: (text: string) => void;
  disabled?: boolean;
  language?: string;
  maxSeconds?: number;
  className?: string;
  /** 녹음·받아쓰기·내려받기 중이면 true. 부모가 보내기 버튼을 잠글 때 쓴다. */
  onBusyChange?: (busy: boolean) => void;
};

const megabytes = (bytes: number) => Math.max(1, Math.round(bytes / 1024 / 1024)) + "MB";

export default function VoiceInputButton({
  onText,
  disabled = false,
  language = "ko",
  maxSeconds = VOICE_MAX_RECORDING_SECONDS,
  className,
  onBusyChange,
}: VoiceInputButtonProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [progress, setProgress] = useState(0);
  const [available, setAvailable] = useState(false);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const requestRef = useRef("");
  const mountedRef = useRef(true);
  const phaseRef = useRef<Phase>("idle");
  const stopRef = useRef<() => void>(() => undefined);

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    if (mountedRef.current) setPhase(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setAvailable(isSpeechRecognitionAvailable());
    return () => {
      mountedRef.current = false;
      recorderRef.current?.cancel();
      if (phaseRef.current === "transcribing") void cancelSpeechRecognition(requestRef.current);
    };
  }, []);

  useEffect(() => {
    onBusyChange?.(phase === "recording" || phase === "transcribing" || phase === "preparing" || phase === "checking");
  }, [phase, onBusyChange]);

  const showError = useCallback((error: unknown) => {
    if (!mountedRef.current) return;
    if (error instanceof VoiceInputError) {
      if (error.code === "cancelled") setNotice({ tone: "info", text: "받아쓰기를 취소했습니다." });
      else setNotice({ tone: error.code === "no_speech" || error.code === "too_short" ? "warning" : "error", text: error.message, helpUrl: error.helpUrl || undefined });
    } else {
      setNotice({ tone: "error", text: "받아쓰기를 끝내지 못했습니다. 잠시 후 다시 시도해 주세요." });
    }
  }, []);

  const finishRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || phaseRef.current !== "recording") return;
    recorderRef.current = null;
    changePhase("transcribing");
    setLevel(0);
    try {
      const recording = await recorder.stop();
      assertRecordingUsable(recording);
      const requestId = newRequestId();
      requestRef.current = requestId;
      const result = await transcribeWav(recording.wav, { language, requestId, audioSeconds: recording.seconds });
      if (!mountedRef.current) return;
      if (!result.text) {
        setNotice({ tone: "warning", text: "알아들을 수 있는 말소리가 없었습니다. 다시 말씀해 주세요." });
      } else {
        onText(result.text);
        setNotice(result.possibleHallucination ? { tone: "warning", text: result.userMessage } : null);
      }
    } catch (error) {
      showError(error);
    } finally {
      requestRef.current = "";
      changePhase("idle");
    }
  }, [changePhase, language, onText, showError]);

  stopRef.current = () => { void finishRecording(); };

  const startRecording = useCallback(async () => {
    const recorder = createVoiceRecorder({
      maxSeconds,
      onTick: (value) => { if (mountedRef.current) setSeconds(value); },
      onLevel: (value) => { if (mountedRef.current) setLevel(value); },
      onLimit: () => {
        if (mountedRef.current) setNotice({ tone: "info", text: formatDuration(maxSeconds) + "까지 녹음해 받아씁니다." });
        stopRef.current();
      },
    });
    recorderRef.current = recorder;
    setSeconds(0);
    setLevel(0);
    try {
      await recorder.start();
      if (!mountedRef.current) { recorder.cancel(); return; }
      changePhase("recording");
    } catch (error) {
      recorderRef.current = null;
      changePhase("idle");
      showError(error);
    }
  }, [changePhase, maxSeconds, showError]);

  const handleClick = useCallback(async () => {
    if (disabled) return;
    const current = phaseRef.current;
    if (current === "recording") { await finishRecording(); return; }
    if (current !== "idle" && current !== "setup") return;
    setNotice(null);
    setSetup(null);
    changePhase("checking");
    try {
      const status = await getSpeechEngineStatus();
      if (status.status === "ready") { await startRecording(); return; }
      if (status.status === "needs_model" || status.status === "needs_engine") {
        const recommended = status.models?.find((model) => model.id === status.defaultModelId) ?? status.models?.find((model) => model.recommended);
        setSetup({ modelId: recommended?.id ?? "", downloadBytes: recommended?.downloadBytes ?? 0, message: status.userMessage });
        changePhase("setup");
        return;
      }
      const failure = describeEngineResult(status);
      changePhase("idle");
      setNotice({ tone: "error", text: failure?.message ?? status.userMessage, helpUrl: failure?.helpUrl });
    } catch (error) {
      changePhase("idle");
      showError(error);
    }
  }, [changePhase, disabled, finishRecording, showError, startRecording]);

  const handlePrepare = useCallback(async () => {
    if (!setup) return;
    changePhase("preparing");
    setProgress(0);
    try {
      const status = await prepareSpeechEngine({
        modelId: setup.modelId || undefined,
        approved: true,
        onProgress: (percent) => { if (mountedRef.current) setProgress(percent); },
      });
      if (!mountedRef.current) return;
      setSetup(null);
      if (status.status === "ready") setNotice({ tone: "info", text: "받아쓰기 준비가 끝났습니다. 버튼을 눌러 말씀해 주세요." });
      else if (status.status === "cancelled") setNotice({ tone: "info", text: status.userMessage });
      else {
        const failure = describeEngineResult(status);
        setNotice({ tone: "error", text: failure?.message ?? status.userMessage, helpUrl: failure?.helpUrl });
      }
    } catch (error) {
      showError(error);
    } finally {
      changePhase("idle");
    }
  }, [changePhase, setup, showError]);

  const cancelAll = useCallback(() => {
    const current = phaseRef.current;
    if (current === "recording") {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      changePhase("idle");
      setLevel(0);
      setNotice({ tone: "info", text: "녹음을 취소했습니다." });
    } else if (current === "transcribing") {
      void cancelSpeechRecognition(requestRef.current);
    } else if (current === "preparing") {
      void cancelSpeechRecognition();
    } else if (current === "setup") {
      setSetup(null);
      changePhase("idle");
    }
  }, [changePhase]);

  useEffect(() => {
    if (phase !== "recording" && phase !== "transcribing" && phase !== "setup") return;
    // 캡처 단계에서 받아 입력창·패널의 Esc(닫기 등)와 겹치지 않게 한다.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelAll();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase, cancelAll]);

  useEffect(() => {
    if (!notice || notice.tone === "error") return;
    const timer = setTimeout(() => { if (mountedRef.current) setNotice(null); }, 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const recording = phase === "recording";
  const busy = phase === "checking" || phase === "transcribing" || phase === "preparing";
  const liveText =
    phase === "recording" ? "녹음 중입니다. 다시 누르면 받아씁니다. Esc 를 누르면 취소합니다."
      : phase === "transcribing" ? "받아쓰는 중입니다."
        : phase === "preparing" ? "받아쓰기 모델을 내려받는 중입니다. " + Math.round(progress) + "%"
          : notice?.text ?? "";

  return (
    <span className={[styles.root, className].filter(Boolean).join(" ")} data-phase={phase}>
      <button
        type="button"
        className={styles.button}
        aria-label="말로 입력하기"
        aria-pressed={recording}
        aria-busy={busy}
        title={recording ? "다시 누르면 받아쓰기 · Esc 취소" : "말로 입력하기"}
        disabled={disabled || !available || busy}
        onClick={() => { void handleClick(); }}
      >
        {busy ? <span className={styles.spinner} aria-hidden="true" /> : (
          <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            {recording ? <rect x="7" y="7" width="10" height="10" rx="2" /> : (
              <>
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" strokeWidth="1.8" strokeLinecap="round" />
              </>
            )}
          </svg>
        )}
      </button>
      {recording ? (
        <span className={styles.meter} aria-hidden="true">
          <span className={styles.time}>{formatDuration(seconds)}</span>
          <span className={styles.levelTrack}><span className={styles.levelBar} style={{ transform: "scaleX(" + Math.max(0.04, level).toFixed(3) + ")" }} /></span>
        </span>
      ) : null}
      {phase === "transcribing" ? <span className={styles.status} aria-hidden="true">받아쓰는 중…</span> : null}
      {phase === "setup" && setup ? (
        <span className={styles.popover} role="dialog" aria-label="받아쓰기 준비">
          <span className={styles.popoverText}>{setup.message}</span>
          <span className={styles.popoverHint}>내려받은 뒤에는 인터넷 없이 이 PC 안에서 받아씁니다.</span>
          <span className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => { void handlePrepare(); }}>
              내려받기{setup.downloadBytes ? " (" + megabytes(setup.downloadBytes) + ")" : ""}
            </button>
            <button type="button" className={styles.secondary} onClick={() => { setSetup(null); changePhase("idle"); }}>나중에</button>
          </span>
        </span>
      ) : null}
      {phase === "preparing" ? (
        <span className={styles.popover} role="group" aria-label="받아쓰기 모델 내려받기">
          <span className={styles.popoverText}>받아쓰기 모델을 내려받는 중입니다. {Math.round(progress)}%</span>
          <span className={styles.progressTrack}><span className={styles.progressBar} style={{ transform: "scaleX(" + Math.min(1, Math.max(0, progress / 100)).toFixed(3) + ")" }} /></span>
          <span className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => { void cancelSpeechRecognition(); }}>내려받기 취소</button>
          </span>
        </span>
      ) : null}
      {notice && phase !== "setup" && phase !== "preparing" ? (
        <span className={styles.popover} data-tone={notice.tone} role={notice.tone === "error" ? "alert" : undefined}>
          <span className={styles.popoverText}>{notice.text}</span>
          {notice.helpUrl ? <span className={styles.popoverHint}>안내 주소: {notice.helpUrl}</span> : null}
          <button type="button" className={styles.close} aria-label="안내 닫기" onClick={() => setNotice(null)}>×</button>
        </span>
      ) : null}
      <span className={styles.srOnly} role="status" aria-live="polite">{liveText}</span>
    </span>
  );
}
