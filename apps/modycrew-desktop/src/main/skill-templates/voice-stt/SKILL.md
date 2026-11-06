---
name: mody-voice-stt
description: 녹음·회의·음성 메모·영상 파일의 말을 이 PC의 로컬 음성 인식(whisper.cpp)으로 받아써서 글(텍스트·시간 표시·자막)로 만드는 모디크루 받아쓰기 담당 절차입니다. '전사', '받아쓰기', '녹취', '음성을 글로', 'STT', '회의 녹음 정리', '자막 만들기' 요청에 씁니다. 설치·모델 다운로드·외부 전송 없이 결과 폴더(output)에만 저장합니다.
license: 모디크루 앱 템플릿(내부 작성)
compatibility: Windows 10/11 · Windows PowerShell 5.1 · whisper.cpp(whisper-cli)와 ggml 모델이 이 PC에 있어야 실행 · ffmpeg 권장
metadata:
  version: "1.0.0"
  author: ModyCrew
  template: voice-stt
allowed-tools: Bash Read Write
---

# 모디크루 받아쓰기 담당(STT)

사용자가 고른 음성·영상 파일을 **이 PC 안에서만** 받아써서 글로 만듭니다. 파일을 인터넷으로 보내지 않고, 엔진이나 모델을 설치하거나 내려받지 않습니다. 원본 파일은 바꾸지 않습니다.
실제 받아쓰기는 이 스킬 폴더의 `scripts/transcribe.ps1` 이 합니다. AI는 어떤 파일을 어떤 언어·고유명사 힌트로 받아쓸지만 정합니다. 그래서 어떤 AI(Claude·GPT·Gemini 등)가 이 지침을 읽어도 같은 결과가 나옵니다.

## 실행 방법 고르기

1. 모디크루 앱 안의 대화라면 앱 도구 `voice.stt.transcribe`(받아쓰기)를 먼저 씁니다. 앱이 파일 선택 창을 띄우고, 사용자가 고른 파일만 이 스킬의 같은 스크립트로 받아씁니다.
2. 명령 실행 도구가 있는 실행기(Codex CLI·Claude Code·Gemini CLI 등)라면 아래 명령을 실행합니다. `<스킬 폴더>` 는 이 SKILL.md 가 있는 폴더입니다. 받아쓸 파일은 사용자가 지정한 파일만 씁니다.
3. 둘 다 없으면 받아쓰지 말고, 어디에서 실행할 수 있는지 답합니다. 들리지 않은 내용을 지어내지 않습니다.

## 먼저 확인할 것

1. 받아쓸 파일 경로가 사용자가 직접 준 것인지 확인합니다. 다른 폴더를 뒤져서 파일을 고르지 않습니다.
2. 언어를 정합니다. 기본은 한국어(`ko`), 모르면 `auto`, 영어는 `en` 입니다.
3. 사람 이름·회사 이름·전문 용어가 있으면 `-Prompt` 힌트로 넘깁니다(400자 이내, 예: "모디크루, 업무팩, 크루").
4. 엔진이 준비됐는지 봅니다.
   `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<스킬 폴더>/scripts/transcribe.ps1" -ListEngines`
   `ready` 가 false 면 `missing` 항목을 그대로 보고하고 멈춥니다. 설치는 references/engines.md 의 안내를 사용자에게 보여 주고 승인을 받습니다.

## 받아쓰는 순서(명령 실행 도구가 있을 때)

1. 받아씁니다. 결과는 작업 폴더의 `output` 아래에 둡니다. 작업 폴더가 따로 안내됐다면 그 output 폴더의 절대 경로를 `-OutputRoot` 로 넘깁니다.
   `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<스킬 폴더>/scripts/transcribe.ps1" -InputFile "<사용자가 준 파일>" -OutputRoot "output" -Language ko`
   선택 인자: `-Prompt "고유명사"` · `-OutName meeting-1102` · `-NoGpu`(그래픽카드를 쓰지 않음) · `-NoVad`(무음 구간 감지 끔)
2. 스크립트는 마지막 줄에 JSON 한 줄을 출력합니다. `ok` 가 true 인지, `files` 의 네 파일이 있는지 확인합니다.
   - `<이름>.txt` 받아쓴 글 · `<이름>.timed.txt` [시:분:초] 표시 · `<이름>.srt` 자막 · `<이름>.json` 구간별 시각
3. 결과를 사용자에게 보여 줄 때는 처음 몇 줄과 파일 위치를 알려 줍니다. 요약·회의록이 필요하면 받아쓴 글을 근거로만 정리하고, 들리지 않았거나 불확실한 부분은 '확인 필요'로 남깁니다.

## 지킬 것

- 녹음·영상 파일을 외부 서버나 클라우드 전사 서비스로 보내지 않습니다. 사용자가 클라우드 전사를 연결하고 따로 승인한 경우에만 그 경로를 씁니다(이 스킬 1.0.0 에는 없음).
- whisper.cpp·모델·ffmpeg·Python 패키지를 설치하거나 내려받지 않습니다. 필요하면 references/engines.md 의 크기·출처를 보여 주고 사용자 승인을 받습니다.
- 다른 사람이 등장하는 녹음은 사용자가 받아쓸 권한이 있는 파일만 다룹니다. 말한 사람 구분(화자 분리)은 하지 않습니다.
- 받아쓴 글은 기계 인식 결과입니다. 숫자·이름·금액은 사람이 확인해야 한다고 함께 알립니다.
- 스크립트가 실패하면 `error` 코드와 `detail` 을 그대로 보고합니다.

## 오류 코드

| error | 뜻 | 할 일 |
|---|---|---|
| no_engine | whisper-cli 를 찾지 못함 | 엔진 준비 안내(references/engines.md), 설치는 승인 뒤 |
| no_model | 모델 파일(ggml-*.bin)이 없음 | 모델 준비 안내(용량 확인 뒤 승인) |
| no_ffmpeg | 변환 도구가 없어 이 형식을 못 읽음 | wav·mp3·flac·ogg 로 주거나 ffmpeg 준비 안내 |
| input_missing / bad_input_type | 파일이 없거나 지원하지 않는 형식 | 파일을 다시 받는다 |
| too_long | 너무 긴 녹음(기본 180분) | 나눠서 받아쓴다 |
| convert_failed / engine_failed | 변환·인식 실패 | detail 을 그대로 보고 |
| exists | 같은 이름 결과가 있음 | 새 이름(-OutName)을 쓰거나 사용자 확인 뒤 -Force |

## 결과 보고 형식

- 한 줄 결론(받아쓴 길이·구간 수)
- 파일 목록과 처음 몇 줄
- 쓴 엔진·모델·언어, 걸린 시간
- 확인 필요 부분 / 사용자 승인 필요 항목(있으면)
