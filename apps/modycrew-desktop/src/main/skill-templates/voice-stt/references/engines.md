# 받아쓰기 엔진 안내(받아쓰기 담당)

이 스킬 1.0.0 은 이 PC에 이미 있는 **whisper.cpp(whisper-cli)** 만 실행합니다. 다른 엔진과 모델은 사용자가 크기·출처를 보고 승인한 뒤에만 준비합니다. 스킬이 대신 설치하거나 내려받지 않습니다.

## 스크립트가 찾는 위치

1. `-WhisperCli` 인자 또는 환경변수 `MODY_WHISPER_CLI`
2. PATH 의 `whisper-cli`
3. `%LOCALAPPDATA%\Programs\whisper.cpp\bin\Release\whisper-cli.exe` 등 흔한 설치 위치
4. 모델: `-Model` 인자, 환경변수 `MODY_WHISPER_MODEL_DIR`, whisper-cli 옆 또는 상위의 `models` 폴더, `%LOCALAPPDATA%\ModyCrew\models\whisper`
   - 여러 개면 large-v3 → large-v3-turbo → large → medium → small → base → tiny 순으로 고릅니다. 1MB 미만 파일과 영어 전용(.en) 모델은 한국어에 쓰지 않습니다.
5. 무음 구간 감지(VAD): 모델 폴더의 `ggml-silero-*.bin` 이 있으면 씁니다.
6. 변환: PATH 의 `ffmpeg` 또는 `%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe`. 없으면 wav·mp3·flac·ogg 만 바로 받아씁니다.

## 준비 안내(사용자 승인 대상, 자동 실행 금지)

| 항목 | 출처 | 대략 크기 | 비고 |
|---|---|---|---|
| whisper.cpp 실행 파일 | github.com/ggml-org/whisper.cpp 릴리스(MIT) | CPU판 수 MB · CUDA판은 GPU 라이브러리 포함 1GB 이상 | 그래픽카드가 없으면 CPU판 |
| Whisper 모델(ggml) | huggingface.co/ggerganov/whisper.cpp (모델 MIT) | base 약 150MB · small 약 0.5GB · medium 약 1.5GB · large-v3-q5_0 약 1.1GB · large-v3 약 3GB | 한국어는 small 이상 권장. 받기 전에 크기와 저장 위치를 사용자에게 확인 |
| Silero VAD 모델(선택) | 같은 저장소의 ggml-silero-*.bin | 1MB 미만 | 긴 녹음의 무음 구간을 건너뜀 |
| ffmpeg(권장) | ffmpeg.org · Windows 는 winget install Gyan.FFmpeg | 약 100MB 이상 | m4a·mp4·webm 변환 |

대신 쓸 수 있는 공개 엔진(이 스킬 1.0.0 은 실행하지 않음):
- faster-whisper(Python, MIT): Python 패키지와 모델 내려받기 필요. 이 PC 의 Hugging Face 캐시에는 faster-whisper-small 이 있으나 model.bin 이 비어 있어 쓸 수 없음(2026-11-02 확인).
- openai-whisper(Python, MIT): pip 설치와 첫 실행 때 모델 자동 내려받기가 있어 자동 실행하지 않음.
- 클라우드 전사(OpenAI·Gemini 등): 녹음이 외부로 전송되고 비용이 생김. 사용자가 연결하고 따로 승인한 경우에만 쓸 수 있으며 이 스킬 1.0.0 에는 경로가 없음.

## 검토한 공개 스킬(2026-11-02, 채택하지 않음)

| 저장소 | 라이선스 | 판단 |
|---|---|---|
| github.com/claude-world/claude-agent · .claude/skills/speech-to-text (6273ad7d) | MIT | openai-whisper pip 설치·모델 자동 내려받기 전제, Claude 전용 머리말(model·user-invocable). 흐름만 참고 |
| github.com/KalarisLabs/research-agent-skills · skills/whisper (fa023d6d) | MIT(일부 제3자 MIT 고지) | openai-whisper·torch 전제(Python 3.8~3.11). 이 PC Python 3.14 와 맞지 않을 수 있음. 모델 크기 표만 참고 |

## 개인정보

- 녹음은 PC 밖으로 나가지 않습니다. 변환용 임시 파일은 받아쓰기가 끝나면 지웁니다.
- 결과 글은 작업 폴더의 output 에만 저장합니다.
