import Link from "next/link";
import styles from "./page.module.css";

const openSourceItems = [
  {
    name: "Hermes Agent",
    owner: "Nous Research",
    license: "MIT License",
    use: "코드 복사 없이 에이전트 구조를 clean-room 방식으로 참고",
  },
  {
    name: "OpenAI Codex CLI",
    owner: "OpenAI",
    license: "Apache License 2.0",
    use: "설치팩에 무수정 동봉되는 백그라운드 AI 답변 복구 실행 파일",
  },
  {
    name: "Node/Electron packages",
    owner: "각 패키지 저작권자",
    license: "패키지별 라이선스",
    use: "데스크톱 앱, 문서 처리, 메일/일정 처리, 정적 웹 앱 빌드",
  },
];

export default function LegalPage() {
  return (
    <section className={styles.page} aria-label="법적 고지">
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <span className={styles.kicker}>ModyCrew</span>
            <h1>법적 고지</h1>
          </div>
          <Link href="/account">설정으로 돌아가기</Link>
        </header>

        <section className={styles.noticeBlock}>
          <h2>제품 안내</h2>
          <p>
            ModyCrew는 메일, 일정, 파일, 문서, 보고서, 승인 업무를 정리하는 한국형 AI 업무 오피스입니다.
            AI가 만든 초안과 자동화 결과는 틀릴 수 있으므로 중요한 발송, 제출, 등록, 삭제, 이동 전에는 사용자가 확인해야 합니다.
          </p>
        </section>

        <section className={styles.noticeBlock}>
          <h2>승인 필요 작업</h2>
          <ul>
            <li>외부 메일/메신저 발송</li>
            <li>일정 최종 등록 또는 초대 발송</li>
            <li>파일 삭제, 이동, 대량 변경</li>
            <li>계약, 세무, 공공기관, 결제, 환불 관련 작업</li>
            <li>개인정보가 포함된 자료 공유, 제출, 외부 업로드</li>
          </ul>
        </section>

        <section className={styles.noticeBlock}>
          <h2>출시 전 공개 문서</h2>
          <div className={styles.noticeCards} aria-label="출시 전 필수 공개 항목">
            <article>
              <strong>개인정보처리방침</strong>
              <small>
                <Link href="/privacy">계정, AI 제공자, 로컬 기억, 메일/일정/메신저 연결, 고객지원 데이터 흐름 기준</Link>
              </small>
            </article>
            <article>
              <strong>이용약관</strong>
              <small>
                <Link href="/terms">AI 결과 검토 책임, 사용자 승인, 데스크톱 자동화, 유료 기능/환불, 지원 범위 기준</Link>
              </small>
            </article>
            <article>
              <strong>오픈소스 고지</strong>
              <small>배포물의 LEGAL_NOTICES.md, THIRD_PARTY_NOTICES.md, LEGAL_DEPENDENCY_SUMMARY.md 포함</small>
            </article>
            <article>
              <strong>보안 경계 고지</strong>
              <small>오피스 승인함은 안전장치이며 OS 권한, 폴더 범위, 실행 로그, 되돌리기 설계가 함께 필요</small>
            </article>
          </div>
        </section>

        <section className={styles.noticeBlock}>
          <h2>오픈소스 및 참고 프로젝트</h2>
          <div className={styles.noticeTable} role="table" aria-label="오픈소스 고지">
            <div role="row" className={styles.noticeTableHead}>
              <span role="columnheader">프로젝트</span>
              <span role="columnheader">저작권자</span>
              <span role="columnheader">라이선스</span>
              <span role="columnheader">사용 목적</span>
            </div>
            {openSourceItems.map((item) => (
              <div role="row" className={styles.noticeTableRow} key={item.name}>
                <span role="cell">{item.name}</span>
                <span role="cell">{item.owner}</span>
                <span role="cell">{item.license}</span>
                <span role="cell">{item.use}</span>
              </div>
            ))}
          </div>
          <p className={styles.muted}>
            Hermes Agent는 Nous Research가 공개한 MIT 라이선스 프로젝트입니다. ModyCrew는 해당 프로젝트를
            코드 복사 없이 clean-room 방식으로 참고하며, Nous Research 또는 Hermes Agent와 제휴, 후원, 보증
            관계가 아닙니다. 실제 코드가 배포물에 포함되는 경우 저작권 및 MIT 고지를 함께 포함합니다.
          </p>
          <p className={styles.muted}>
            OpenAI Codex CLI는 OpenAI가 공개한 Apache License 2.0 프로젝트로, Windows 설치팩에 무수정
            바이너리로 동봉되며 라이선스 전문은 배포물의 THIRD_PARTY_NOTICES.md에 포함합니다. ModyCrew는
            OpenAI와 제휴, 후원, 보증 관계가 아니며, 로그인 계정과 비밀 정보는 사용자 소유로 남습니다.
          </p>
        </section>

        <section className={styles.noticeBlock}>
          <h2>배포물 고지 파일</h2>
          <div className={styles.noticeCards} aria-label="배포물 법적 고지 파일">
            <article>
              <strong>LEGAL_NOTICES.md</strong>
              <small>제품 고지, 승인 필요 작업, 개인정보/보안 경계, Hermes clean-room 참고 원칙을 포함합니다.</small>
            </article>
            <article>
              <strong>THIRD_PARTY_NOTICES.md</strong>
              <small>Hermes Agent MIT 고지, Nous Research 저작권, 런타임 의존성 고지 기준을 포함합니다.</small>
            </article>
            <article>
              <strong>LEGAL_DEPENDENCY_SUMMARY.md</strong>
              <small>package-lock.json 기준 의존성 라이선스 요약, 누락 메타데이터, 수동 검토 후보를 포함합니다.</small>
            </article>
            <article>
              <strong>브라우저 미리보기 패키지</strong>
              <small>배포 전 확인용 zip에도 /legal 화면과 세 고지 파일을 함께 포함합니다.</small>
            </article>
            <article>
              <strong>Windows 설치/무설치 패키지</strong>
              <small>설치형 resources와 테스터 릴리스 폴더에서 같은 고지 파일을 확인할 수 있어야 합니다.</small>
            </article>
          </div>
        </section>

        <section className={styles.noticeBlock}>
          <h2>개인정보와 보안</h2>
          <p>
            API 키, OAuth 비밀값, 비밀번호, 결제정보, 민감한 개인 정보는 코드나 로그에 노출하지 않아야 합니다.
            오피스 승인함과 경고 문구는 안전장치일 뿐 완전한 보안 경계가 아니므로, 고위험 데스크톱 자동화는 OS 권한,
            폴더 범위 제한, 실행 로그, 되돌리기 가능한 흐름과 함께 설계합니다.
          </p>
        </section>

        <footer className={styles.footer}>
          <p>이 화면은 출시용 고지의 제품 내 표시 위치입니다. 최종 상용 출시 전 개인정보처리방침과 이용약관은 실제 데이터 흐름에 맞춰 별도 법률 검토가 필요합니다.</p>
        </footer>
      </div>
    </section>
  );
}
