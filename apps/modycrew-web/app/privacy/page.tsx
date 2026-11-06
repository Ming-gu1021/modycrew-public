import Link from "next/link";
import styles from "../legal/page.module.css";
import { commercialPrivacyDisclosure, showCommercialPrivacyDisclosure } from "../../lib/commercial-privacy-disclosure";

const privacyItems = [
  {
    title: "계정과 기기",
    detail: "로그인 상태, 기기 동기화 상태, 앱 설정, 연결 진행 상태를 저장해 같은 업무실을 이어 쓸 수 있게 합니다.",
  },
  {
    title: "업무 자료",
    detail: "사용자가 선택한 메일, 일정, 문서, 폴더, 보고서 양식을 읽어 요약, 초안, 승인 후보를 만듭니다.",
  },
  {
    title: "로컬 기억",
    detail: "다음부터 이렇게 하기로 저장한 업무 방식은 설치 앱의 로컬 기억 위치에 저장되며, 사용자가 수정하거나 삭제할 수 있어야 합니다.",
  },
  {
    title: "외부 연결",
    detail: "메일, 캘린더, 메신저, 알림 연결은 필요한 권한만 단계적으로 요청하고, 외부 발송과 등록은 승인 전 실행하지 않습니다.",
  },
];

export default function PrivacyPage() {
  return (
    <section className={styles.page} aria-label="개인정보처리방침">
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <span className={styles.kicker}>ModyCrew</span>
            <h1>개인정보처리방침</h1>
          </div>
          <Link href="/legal">법적 고지로 돌아가기</Link>
        </header>

        <section className={styles.noticeBlock}>
          <h2>출시 전 방침 기준</h2>
          <p>
            이 화면은 상용 출시 전 실제 데이터 흐름에 맞춰 확정해야 하는 개인정보처리방침의 제품 내 표시 위치입니다.
            최종 문구는 계정 시스템, AI 제공자, 로컬 기억, 메일/일정/메신저 연결, 고객지원 절차를 기준으로 법률 검토가 필요합니다.
          </p>
        </section>

        <section className={styles.noticeBlock}>
          <h2>처리할 수 있는 정보</h2>
          <div className={styles.noticeCards} aria-label="개인정보 처리 항목">
            {privacyItems.map((item) => (
              <article key={item.title}>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.noticeBlock}>
          <h2>민감 정보와 비밀값</h2>
          <p>
            API 키, OAuth 비밀값, 앱 비밀번호, 결제정보, 주민등록번호 같은 민감 정보는 코드, 로그, 공개 리포트에
            노출하지 않아야 합니다. 연결 토큰과 비밀번호 원문은 사용자가 승인한 보안 저장 경계 밖으로 표시하거나
            배포물에 포함하지 않습니다.
          </p>
        </section>

        <section className={styles.noticeBlock}>
          <h2>사용자 선택권</h2>
          <ul>
            <li>업무 자료, 폴더 범위, 외부 계정 연결은 사용자가 선택한 범위에서만 시작합니다.</li>
            <li>저장한 업무 방식은 앱에서 수정하거나 삭제할 수 있어야 합니다.</li>
            <li>외부 발송, 일정 등록, 파일 삭제/이동, 결제/계약/세무/공공기관 관련 작업은 승인 후 실행합니다.</li>
            <li>상용 출시 전 보관 기간, 파기 절차, 문의 창구, 제3자 제공 기준을 확정합니다.</li>
          </ul>
        </section>

        {showCommercialPrivacyDisclosure ? (
          <section
            className={styles.noticeBlock}
            data-commercial-privacy-disclosure="launch-visible"
            aria-label={commercialPrivacyDisclosure.title}
          >
            <h2>{commercialPrivacyDisclosure.title}</h2>
            <p>{commercialPrivacyDisclosure.intro}</p>
            {commercialPrivacyDisclosure.sections.map((section) => (
              <article key={section.title} className={styles.policySubsection}>
                <h3>{section.title}</h3>
                <ul>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
            <article className={styles.policySubsection}>
              <h3>출시 전 확인</h3>
              <ul>
                {commercialPrivacyDisclosure.launchChecklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </section>
        ) : null}

        <footer className={styles.footer}>
          <p>이 방침은 엔지니어링 기준이며 법률 자문이 아닙니다. 최종 출시 전 실제 운영 방식에 맞춘 검토가 필요합니다.</p>
        </footer>
      </div>
    </section>
  );
}
