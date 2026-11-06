import Link from "next/link";
import styles from "../legal/page.module.css";

const termsItems = [
  {
    title: "AI 결과 검토",
    detail: "AI 초안, 요약, 추천, 자동화 결과는 틀릴 수 있으므로 중요한 업무는 사용자가 확인해야 합니다.",
  },
  {
    title: "승인 후 실행",
    detail: "메일 발송, 일정 등록, 파일 변경, 결제/계약/세무/공공기관 관련 작업은 최종 승인 전 실행하지 않습니다.",
  },
  {
    title: "데스크톱 자동화",
    detail: "내 PC 작업 도우미는 폴더 범위, 미리보기, 실행 로그, 되돌리기 안내를 함께 제공해야 합니다.",
  },
  {
    title: "오픈소스와 참고 프로젝트",
    detail: "Hermes Agent는 clean-room 방식으로 참고하며, ModyCrew는 Nous Research 또는 Hermes Agent와 제휴 관계가 아닙니다.",
  },
];

export default function TermsPage() {
  return (
    <section className={styles.page} aria-label="이용약관">
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <span className={styles.kicker}>ModyCrew</span>
            <h1>이용약관</h1>
          </div>
          <Link href="/legal">법적 고지로 돌아가기</Link>
        </header>

        <section className={styles.noticeBlock}>
          <h2>출시 전 약관 기준</h2>
          <p>
            이 화면은 상용 출시 전 실제 기능, 요금제, 지원 범위, 환불 기준, 자동화 경계에 맞춰 확정해야 하는
            이용약관의 제품 내 표시 위치입니다. 최종 문구는 법률 검토가 필요합니다.
          </p>
        </section>

        <section className={styles.noticeBlock}>
          <h2>핵심 이용 조건</h2>
          <div className={styles.noticeCards} aria-label="이용약관 핵심 항목">
            {termsItems.map((item) => (
              <article key={item.title}>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.noticeBlock}>
          <h2>사용 제한</h2>
          <ul>
            <li>권한 없는 계정, 파일, 시스템에 접근하도록 앱을 사용하면 안 됩니다.</li>
            <li>불법 제출, 스팸 발송, 개인정보 무단 공유, 결제 오남용을 목적으로 사용할 수 없습니다.</li>
            <li>오피스 승인함, 보안 경계, 실행 로그를 우회하는 사용은 허용하지 않습니다.</li>
          </ul>
        </section>

        <section className={styles.noticeBlock}>
          <h2>출시 전 확정 항목</h2>
          <p>
            유료 기능, 환불, 지원 SLA, 데이터 보관, 계정 해지, 분쟁 해결, 준거법, 제3자 서비스 연결 책임은
            실제 판매 방식과 배포 채널이 정해진 뒤 별도 확정합니다.
          </p>
        </section>

        <footer className={styles.footer}>
          <p>이 약관은 엔지니어링 기준이며 법률 자문이 아닙니다. 최종 출시 전 실제 운영 방식에 맞춘 검토가 필요합니다.</p>
        </footer>
      </div>
    </section>
  );
}
