"use client";

import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, MutableRefObject, Ref, TextareaHTMLAttributes } from "react";
import { flushSync } from "react-dom";

// 채팅 입력칸 전용 textarea.
//
// 왜 필요한가:
// 1) 입력 문자열을 부모(TodayPage, 5만 줄짜리 한 컴포넌트)의 state 로 두면 글자 하나 칠
//    때마다 화면 전체가 다시 그려져 타자가 밀리고 한글 조합이 끊긴다.
// 2) 제어형(value=) textarea 는 React 가 글자마다 textarea 안쪽 글자 노드를 다시 쓰는데,
//    page.module.css 의 :has() 규칙들 때문에 그 한 번의 변경이 앱 전체(요소 3천여 개)의
//    스타일 재계산을 일으켰다(긴 대화에서 키당 30~50ms, 느린 PC 약 270ms — 실측).
// 그래서 이 칸은 비제어형이다. 글자는 DOM 에만 쌓이고 React 는 입력 중 아무것도 다시 그리지
// 않는다. 부모에게는
//   ① 입력이 잠깐 멈췄을 때(commitDelayMs) 낮은 우선순위(transition)로,
//   ② 빈 칸 ↔ 글자 있음이 바뀌는 순간(보내기 버튼 활성화용)은 바로,
//   ③ Enter 로 보낼 때·칸을 벗어날 때(blur)·칸이 사라질 때는 즉시
// 알려준다. 그래서 보내기/버튼 클릭 핸들러는 언제나 최신 글자를 본다
// (버튼을 누르면 mousedown 에서 blur 가 먼저 일어나 즉시 반영된다).
//
// 부모가 setInput(...) 으로 글을 바꾸면(예시 문장 넣기, 보낸 뒤 비우기) value prop 이
// 달라지므로 그 값을 칸에 넣는다(.value 대입은 글자 노드를 건드리지 않는다). 단, 이 칸이
// 방금 올려 보낸 값이 되돌아온 것이면 그 사이에 더 친 글자를 지우지 않도록 무시한다.

type BufferedTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "defaultValue" | "onChange" | "onKeyDown" | "onBlur"
> & {
  value: string;
  onValueChange: (value: string) => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** Enter(Shift 없이)로 form 을 제출할지. 한글 조합 중 Enter 는 항상 무시한다. */
  submitOnEnter?: boolean;
  /** Enter 제출 직전, 최신 글자로 제출 가능 여부를 판단한다. 없으면 항상 제출. */
  canSubmit?: (text: string) => boolean;
  commitDelayMs?: number;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else (ref as MutableRefObject<T | null>).current = value;
}

export default function BufferedTextarea({
  value,
  onValueChange,
  textareaRef,
  submitOnEnter = true,
  canSubmit,
  // 단어 사이의 짧은 쉼마다 5만 줄 화면을 다시 그리지 않도록 넉넉히 둔다.
  // 보내기(Enter)·버튼 클릭(blur)·빈칸 전환은 이 지연과 무관하게 즉시 반영된다.
  commitDelayMs = 700,
  ...rest
}: BufferedTextareaProps) {
  // 처음 값만 DOM 에 심는다. 이후 React 는 이 값을 다시 쓰지 않는다.
  const [initialValue] = useState(value);
  const elementRef = useRef<HTMLTextAreaElement | null>(null);
  const latestTextRef = useRef(value);
  const reportedRef = useRef(value);
  const timerRef = useRef<number | null>(null);
  const onValueChangeRef = useRef(onValueChange);
  useEffect(() => {
    onValueChangeRef.current = onValueChange;
  }, [onValueChange]);

  const textareaRefRef = useRef(textareaRef);
  textareaRefRef.current = textareaRef;
  const setElement = useCallback((element: HTMLTextAreaElement | null) => {
    elementRef.current = element;
    assignRef(textareaRefRef.current, element);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 부모가 값을 바꿨을 때만 칸에 반영한다(방금 올려 보낸 값이 되돌아온 경우는 제외).
  useLayoutEffect(() => {
    if (value === reportedRef.current) return;
    clearTimer();
    reportedRef.current = value;
    latestTextRef.current = value;
    const element = elementRef.current;
    if (element && element.value !== value) element.value = value;
  }, [value, clearTimer]);

  const commitNow = useCallback((mode: "sync" | "urgent" | "transition") => {
    clearTimer();
    const next = latestTextRef.current;
    if (next === reportedRef.current) return;
    reportedRef.current = next;
    if (mode === "sync") {
      flushSync(() => onValueChangeRef.current(next));
    } else if (mode === "transition") {
      startTransition(() => onValueChangeRef.current(next));
    } else {
      onValueChangeRef.current(next);
    }
  }, [clearTimer]);

  // 칸이 사라질 때(홈 → 대화 화면 전환 등) 아직 안 올려 보낸 글자를 잃지 않는다.
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const next = latestTextRef.current;
    if (next !== reportedRef.current) {
      reportedRef.current = next;
      onValueChangeRef.current(next);
    }
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (!submitOnEnter || event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    const form = event.currentTarget.form;
    // 제출 핸들러가 최신 글자를 읽도록 부모 반영을 동기로 끝낸 뒤 제출한다.
    latestTextRef.current = event.currentTarget.value;
    commitNow("sync");
    if (canSubmit && !canSubmit(latestTextRef.current)) return;
    form?.requestSubmit();
  }

  return (
    <textarea
      {...rest}
      ref={setElement}
      defaultValue={initialValue}
      onChange={(event) => {
        const next = event.target.value;
        latestTextRef.current = next;
        clearTimer();
        // 빈 칸 ↔ 글자 있음이 바뀌는 순간은 바로 알린다(보내기 버튼 활성화 등).
        // 메시지 하나당 한두 번뿐이라 부담이 없다. 나머지 글자는 멈췄을 때 한 번에.
        if (!next.trim() !== !reportedRef.current.trim()) {
          commitNow("transition");
          return;
        }
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          commitNow("transition");
        }, commitDelayMs);
      }}
      onBlur={(event) => {
        latestTextRef.current = event.currentTarget.value;
        commitNow("urgent");
      }}
      onKeyDown={handleKeyDown}
    />
  );
}
