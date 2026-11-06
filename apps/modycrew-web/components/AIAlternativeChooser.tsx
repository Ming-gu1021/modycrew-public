"use client";

/**
 * "다른 AI로 연결" 선택지 목록.
 *
 * 예전에는 AI 연결 버튼이 전부 ChatGPT 로그인 하나로만 이어졌고, '대체 답변 연결'은
 * AI 가 아니라 외부 사이트 아이디·비밀번호 보관함으로 갔다. Claude 구독만 쓰는 사람은
 * 갈 곳이 없었다. 여기서는 쓸 수 있는 길(구독 계정·API 키·내 PC 모델)을 한 줄씩 보여준다.
 *
 * 마크업에 li·small 을 쓰지 않는다. 연결 패널에는 'li 는 번호 칸 24px + 내용' 격자,
 * '요약 보기에서는 small 을 숨김' 같은 넓은 규칙이 있어 목록이 세로로 찌그러지고 설명이 사라졌다.
 */

import type { AIAlternativeChoice } from "@/lib/home-journey-rules";
import styles from "./AIAlternativeChooser.module.css";

type AIAlternativeChooserProps = {
  choices: AIAlternativeChoice[];
  onChoose: (id: string) => void;
  disabled?: boolean;
  /** 목록 위 한 줄 설명. 비우면 제목만 보인다. */
  intro?: string;
  /** 고른 뒤 결과(로그인 창을 열었어요, 모델 n개를 찾았어요 등). 입력칸 안내가 안 보이는 화면에서도 보이게. */
  notice?: string;
};

export default function AIAlternativeChooser({ choices, onChoose, disabled = false, intro, notice }: AIAlternativeChooserProps) {
  return (
    <section className={styles.chooser} aria-label="다른 AI 연결 방법" data-ai-alternative-chooser="subscription_api_key_local">
      <div className={styles.heading}>
        <strong>다른 AI로 연결</strong>
        {intro ? <span className={styles.intro}>{intro}</span> : null}
      </div>
      <div className={styles.list} role="list">
        {choices.map((choice) => (
          <div key={choice.id} role="listitem" className={styles.item}>
            <button
              type="button"
              className={styles.choice}
              onClick={() => onChoose(choice.id)}
              disabled={disabled}
              data-ai-alternative={choice.id}
              data-recommended={choice.recommended ? "true" : "false"}
            >
              <span className={styles.choiceLabel}>{choice.label}</span>
              <span className={styles.choiceDetail}>{choice.detail}</span>
            </button>
          </div>
        ))}
      </div>
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    </section>
  );
}
