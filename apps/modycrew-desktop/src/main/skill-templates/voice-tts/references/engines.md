# 음성 엔진 안내(목소리 담당)

이 스킬 1.0.0 은 **Windows 기본 음성(System.Speech, SAPI)** 만 실행합니다. 다른 엔진은 사용자가 고르고 승인한 뒤에만 준비합니다. 스킬이 대신 설치하지 않습니다.

| 엔진 | 설치 | 비용·전송 | 이 스킬 1.0.0 |
|---|---|---|---|
| Windows 기본 음성(예 Microsoft Heami Desktop, ko-KR) | 필요 없음(Windows 포함). 한국어 음성이 없으면 Windows 설정 > 시간 및 언어 > 음성에서 추가 | 무료 · PC 안에서만 처리 | 실행함 |
| Supertonic(로컬 온디바이스 TTS) | Python 3.11 가상환경 + ONNX 모델 내려받기 필요(supertone-oss-archive/supertonic, 코드 MIT · 모델 OpenRAIL-M). 저장소가 보관(archived) 상태 | 무료 · PC 안에서만 처리 | 실행하지 않음(준비 확인만) |
| 클라우드 TTS(OpenAI·Gemini·ElevenLabs 등) | API 키 필요. 키는 모디크루 보관함에만 저장 | 유료 · 대본이 외부 서버로 전송됨 | 실행하지 않음 |

## 검토한 공개 스킬(2026-11-02, 채택하지 않음)

| 저장소 | 라이선스 | 판단 |
|---|---|---|
| github.com/captjt/skill-tts (51ff049a) | MIT | 첫 실행 때 약 7MB 실행 파일을 내려받는 macOS·Linux용 도구. Windows 미지원, 설치 승인 필요 |
| github.com/farandclose/speak-skills (57f6cc29) | 저장소에 LICENSE 파일 없음(README 에만 MIT 표기) | ElevenLabs·OpenAI 키 또는 macOS say 필요. 라이선스 확인 전 사용 보류 |
| github.com/ferrants/skill-tts (5d6e0f3f) | MIT | OpenAI TTS API 전용(키 필요, 대본 외부 전송). 클라우드 엔진을 연결할 때 참고 |

## 개인정보

- 대본은 PC 밖으로 나가지 않습니다. 결과 WAV 는 작업 폴더의 output 에만 저장합니다.
- 다른 사람의 목소리를 흉내 내는 음성 복제는 이 스킬의 범위가 아닙니다.
