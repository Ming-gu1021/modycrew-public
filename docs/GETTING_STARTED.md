# 개발 환경과 실행

## 준비

- Node.js 22.12 이상과 npm
- Git
- 로그인에 사용할 본인의 Firebase 프로젝트
- 사용할 AI·메일·일정 서비스의 계정과 해당 서비스의 이용 권한

이 저장소는 웹 화면, 데스크톱 연결 계층, 업무 로직의 소스를 제공합니다. Node.js·Python·외부 CLI 같은 실행 환경과 유료 서비스 계정은 소스에 포함되지 않습니다.

## 설치

```sh
git clone https://github.com/Ming-gu1021/modycrew-public.git
cd modycrew-public
npm ci
npm ci --prefix apps/modycrew-web
```

`apps/modycrew-web/.env.example`을 같은 폴더의 `.env.local`로 복사하고 본인 Firebase 프로젝트의 값을 입력합니다. Firebase Authentication에서 사용할 로그인 방식을 켜고 개발 주소를 허용 도메인에 등록하세요. 데이터베이스와 파일 저장소를 사용할 때는 이 저장소의 Firestore·Storage 규칙을 본인 프로젝트에 적용하고 접근 권한을 점검하세요.

실제 비밀번호, API 키, 서비스 계정 파일은 Git에 올리지 않습니다. AI와 외부 서비스는 앱의 연결 설정에서 추가합니다. 연결 방식과 사용 가능 모델은 제공자 계정의 권한에 따라 달라집니다.

## 웹 개발

```sh
npm run dev
```

터미널에 표시되는 로컬 주소를 엽니다. 브라우저에서 실행하는 웹 화면에는 데스크톱 전용 파일·프로그램 조작 기능이 제공되지 않습니다.

## 데스크톱 실행

```sh
npm run build
npm run desktop:start
```

소스로 실행한 앱은 사용자 홈 폴더의 `.modycrew-source`에 별도의 프로필을 만듭니다. 필요하면 `MODYCREW_SOURCE_PROFILE` 환경 변수로 위치를 지정할 수 있습니다. 개발 실행에서는 설치 앱의 자동 업데이트를 사용하지 않습니다.

문서·코딩·영상 등 일부 기능은 해당 실행 환경이나 서비스 연결을 추가로 요구합니다. 화면에 표시되는 연결 상태와 권한을 확인하고 사용하세요.

## 코드 확인

```sh
npm run build:domain
npm run typecheck
```

메인 프로세스의 파일·실행 권한 검증과 승인 절차를 유지하세요. 파일 열기, 외부 발송, 일정 등록을 수정할 때는 임시 데이터와 본인의 시험 계정으로 확인합니다.

## 직접 서비스 운영하기

인증·데이터베이스·스토리지·OAuth 설정은 본인 소유 프로젝트를 사용합니다. GitHub 소스 공개에는 Mody의 운영 계정이나 서비스 이용 권한이 포함되지 않습니다. 공개 웹훅 릴레이를 운영한다면 `MODY_PUBLIC_RELAY_SIGNING_SECRET`과 `MODY_PUBLIC_RELAY_PULL_TOKEN`을 별도로 설정하세요. 두 값을 설정하지 않으면 공개 릴레이는 작동하지 않습니다.

배포용 코드 서명, 설치 프로그램, 업데이트 서버는 별도 구성이 필요합니다. 일반 사용자용 설치 파일은 [공식 다운로드](https://mody.ai.kr/modycrew#desktop-downloads)를 이용하세요.
