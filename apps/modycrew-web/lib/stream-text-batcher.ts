// AI 답변 스트리밍 조각(delta)을 모아 화면에 한 번씩 반영한다.
//
// 모델은 초당 수십 개의 조각을 보낸다. 조각마다 setMessages 를 부르면 5만 줄짜리
// TodayPage 가 조각 수만큼 통째로 다시 그려지고, 그때마다 대화 전체 저장까지 따라
// 붙어 답변이 나오는 동안 앱 전체가 버벅였다. 여기서는 intervalMs 동안 들어온 조각을
// 하나로 합쳐 apply 를 한 번만 부른다. 글자가 빠지거나 순서가 바뀌지 않으며,
// 스트림이 끝나면 호출부가 flush() 로 남은 조각을 즉시 반영한다.

export type StreamTextBatcher = {
  push: (delta: string) => void;
  /** 모아 둔 조각을 지금 반영한다(스트림 종료·최종 답변 교체 직전에 호출). */
  flush: () => void;
  /** 모아 둔 조각을 버린다(임시 말풍선을 지울 때). */
  cancel: () => void;
};

export function createStreamTextBatcher(apply: (text: string) => void, intervalMs = 80): StreamTextBatcher {
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    clear();
    if (!buffer) return;
    const text = buffer;
    buffer = "";
    apply(text);
  };

  return {
    push(delta) {
      if (!delta) return;
      buffer += delta;
      if (timer === null) timer = setTimeout(flush, intervalMs);
    },
    flush,
    cancel() {
      clear();
      buffer = "";
    },
  };
}
