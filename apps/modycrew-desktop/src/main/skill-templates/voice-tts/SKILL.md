---
name: mody-voice-tts
description: 대본·문장을 이 PC의 Windows 기본 음성 합성(System.Speech)으로 WAV 음성 파일로 만드는 모디크루 목소리 담당 절차입니다. 'TTS', '음성 파일', '목소리', '낭독', '더빙', '나레이션', '읽어 줘' 요청에 씁니다. 설치·다운로드·외부 전송 없이 결과 폴더(output)에만 저장합니다.
license: 모디크루 앱 템플릿(내부 작성)
compatibility: Windows 10/11 · Windows PowerShell 5.1(기본 포함) · 한국어 음성(예 Microsoft Heami) 권장 · macOS·Linux 미지원
metadata:
  version: "1.0.0"
  author: ModyCrew
  template: voice-tts
allowed-tools: Bash Read Write
---

# 모디크루 목소리 담당(TTS)

사용자가 준 대본을 **이 PC 안에서만** 음성 파일(WAV)로 만듭니다. 인터넷으로 보내지 않고, 프로그램이나 음성 팩을 설치하거나 내려받지 않습니다.
실제 음성은 이 스킬 폴더의 `scripts/speak.ps1` 이 만듭니다. AI는 무엇을 읽을지와 인자(음성·빠르기·크기·파일 이름)만 정합니다. 그래서 어떤 AI(Claude·GPT·Gemini 등)가 이 지침을 읽어도 같은 결과가 나옵니다.

## 실행 방법 고르기

1. 모디크루 앱 안의 대화라면 앱 도구 `voice.tts.speak`(목소리 만들기)를 먼저 씁니다. 앱이 이 스킬의 같은 스크립트를 실행하고 확인 창을 띄웁니다.
2. 명령 실행 도구가 있는 실행기(Codex CLI·Claude Code·Gemini CLI 등)라면 아래 명령을 그대로 실행합니다. `<스킬 폴더>` 는 이 SKILL.md 가 있는 폴더입니다.
3. 둘 다 없으면 만들지 말고 "음성 파일은 모디크루 앱의 목소리 담당이나 명령 실행이 되는 실행기에서 만들 수 있다"고 답합니다.

## 먼저 확인할 것

1. 읽을 문장(대본)을 요청에서 그대로 뽑습니다. 대본이 없으면 지어내지 말고 대본을 달라고 답합니다.
2. 음성·빠르기·크기 요청이 있는지 봅니다. 없으면 기본값(한국어 음성, 빠르기 0, 크기 100)을 씁니다.
3. 대본이 5,000자를 넘으면 문단 단위로 나눠 voice-01.wav, voice-02.wav … 처럼 여러 파일로 만듭니다.

## 만드는 순서(명령 실행 도구가 있을 때)

1. 이 PC의 음성 목록을 확인합니다.
   `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<스킬 폴더>/scripts/speak.ps1" -ListVoices`
2. 대본을 UTF-8 텍스트 파일 `output/voice-script.txt` 로 저장합니다(여러 개면 voice-script-01.txt …).
3. WAV 를 만듭니다. 결과는 반드시 작업 폴더의 `output` 아래에 둡니다. 작업 폴더가 따로 안내됐다면 그 output 폴더의 절대 경로를 `-OutputRoot` 로 넘깁니다.
   `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<스킬 폴더>/scripts/speak.ps1" -TextFile "output/voice-script.txt" -OutFile "output/voice.wav" -OutputRoot "output"`
   선택 인자: `-Voice "Microsoft Heami Desktop"` · `-Rate -2`(-10~10) · `-Volume 90`(0~100) · `-SampleRate 22050`
4. 스크립트는 마지막 줄에 JSON 한 줄을 출력합니다. `ok` 가 true 이고 `bytes`·`durationSeconds` 가 0보다 큰지 확인합니다.
5. `output/README.md` 에 파일 이름, 음성, 길이(초), 크기, 대본 첫 줄을 적습니다.

## 지킬 것

- 결과 파일은 `output` 폴더에만 만듭니다. 다른 폴더의 파일을 바꾸거나 지우지 않습니다.
- 음성 엔진·언어 팩·Supertonic·pip·npm 설치, 클라우드 TTS 전송은 하지 않고 결과에 '승인 필요'로 남깁니다(references/engines.md 참고).
- 한국어 음성이 없으면 영어 음성으로 억지로 만들지 말고 "Windows 설정 > 시간 및 언어 > 음성에서 한국어 음성 추가 필요"라고 보고합니다. 사용자가 다른 언어 음성을 원하면 그 음성을 씁니다.
- 실존 인물의 목소리를 흉내 내거나 다른 사람인 척하는 음성은 만들지 않습니다.
- 스크립트가 실패하면 `error` 코드와 `detail` 을 그대로 보고하고, 만들지 못한 파일을 만들었다고 쓰지 않습니다.

## 오류 코드

| error | 뜻 | 할 일 |
|---|---|---|
| no_text | 읽을 문장이 없음 | 대본을 받는다 |
| text_too_long | 5,000자 초과 | 나눠서 여러 파일로 만든다 |
| no_korean_voice | 한국어 음성 없음 | 음성 추가를 안내하거나 -Voice 로 다른 음성 지정 |
| voice_not_found | 지정한 음성이 없음 | -ListVoices 로 이름을 다시 확인 |
| outside_output_root | 결과 경로가 output 밖 | output 아래 경로로 다시 실행 |
| exists | 같은 이름 파일이 있음 | 새 이름을 쓰거나 사용자 확인 뒤 -Force |
| unsupported_platform | Windows 가 아님 | 지원하지 않는다고 답한다 |

## 결과 보고 형식

- 한 줄 결론(만든 파일 수)
- 파일 목록: output/voice.wav — 길이 n.n초, 크기 n KB, 음성 이름
- 확인한 것 / 확인하지 못한 것
- 사용자 승인 필요 항목(있으면)
