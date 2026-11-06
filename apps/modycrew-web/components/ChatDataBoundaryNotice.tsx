import styles from "./ChatDataBoundaryNotice.module.css";

export default function ChatDataBoundaryNotice() {
  return (
    <section aria-label="자료 참고와 AI 제공 안내" className={styles.notice}>
      <p>외부 AI 사용 시 자료가 전송될 수 있어요.</p>
      <details>
        <summary>자세히</summary>
        <p>대화·첨부·기억·도구 자료가 AI에 전달될 수 있습니다. 기능 추천에는 다른 AI 연결이 쓰일 수 있으며, 이미 보낸 자료는 중지해도 회수되지 않습니다.</p>
        <p>학습 자료·메일·일정의 자동 첨부는 보류 중입니다. 자료별 제공 승인과 이 화면의 전송 목적지 확인은 아직 지원하지 않습니다. 자료는 각 업무 화면에서 확인하세요.</p>
      </details>
    </section>
  );
}
