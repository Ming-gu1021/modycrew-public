// 받아쓰기(음성 인식) 엔진·모델 카탈로그.
// - 렌더러는 다운로드 주소·실행 파일·모델 경로를 정하지 못한다. 여기 고정한 버전·크기·SHA-256 만 쓴다.
// - 엔진: whisper.cpp 공식 GitHub 릴리스(v1.9.5 의 Windows 바이너리는 같은 커밋의 빌드 태그 b5454 에 첨부).
// - 모델: Hugging Face ggerganov/whisper.cpp 저장소의 리비전 고정 파일(OpenAI Whisper 가중치 변환본, MIT).
// - feature-modules/catalog.mjs(PDF 등)와 분리해 둔다. 이 파일만 바꿔 모델 목록을 갱신한다.

const huggingFaceRevision = '5359861c739e955e79d9a303bcbc70fb988958b1';
const modelUrl = (file) => 'https://huggingface.co/ggerganov/whisper.cpp/resolve/' + huggingFaceRevision + '/' + file;

export const speechEngineRelease = Object.freeze({
  id: 'whisper_cpp',
  name: 'whisper.cpp',
  version: '1.9.5',
  buildTag: 'b5454',
  commit: 'd1be6fde11ac6e0407606b4e42fe72d34add8037',
  license: 'MIT',
  upstream: 'https://github.com/ggml-org/whisper.cpp',
  platforms: Object.freeze(['win32']),
  arch: 'x64',
  archive: Object.freeze({
    name: 'whisper-bin-x64.zip',
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
    bytes: 8928640,
    sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
    // 압축 안의 실행 파일은 모두 Release/ 아래에 있다.
    folder: 'Release',
  }),
  licenseFile: Object.freeze({
    name: 'LICENSE',
    url: 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.9.5/LICENSE',
    bytes: 1078,
    sha256: '94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d',
  }),
  downloadHosts: Object.freeze(['github.com', '.githubusercontent.com']),
  // 받아쓰기에 필요한 파일만 꺼낸다(예제·테스트 실행 파일, SDL2, llama 는 넣지 않는다).
  // ggml 은 CPU 기능(SSE4.2·AVX2·AVX-512 등)에 맞는 ggml-cpu-*.dll 을 실행 중에 골라 쓰므로 변형을 모두 둔다.
  files: Object.freeze([
    'whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll',
    'ggml-cpu-x64.dll', 'ggml-cpu-sse42.dll', 'ggml-cpu-sandybridge.dll', 'ggml-cpu-haswell.dll',
    'ggml-cpu-skylakex.dll', 'ggml-cpu-icelake.dll', 'ggml-cpu-cascadelake.dll', 'ggml-cpu-cannonlake.dll', 'ggml-cpu-alderlake.dll',
  ]),
  requiredFiles: Object.freeze(['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu-x64.dll']),
  // whisper.cpp Windows 빌드는 Visual C++ 2015-2022 런타임(MSVCP140·VCRUNTIME140·VCRUNTIME140_1·VCOMP140)을 쓴다.
  // 설치파일 동봉본은 이 DLL 을 엔진 폴더에 함께 넣고(앱 로컬 배포), 자료실에서 받은 엔진은 PC 에 설치된 런타임을 쓴다.
  vcRuntimeFiles: Object.freeze(['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll']),
  vcRuntimeHelpUrl: 'https://aka.ms/vs/17/release/vc_redist.x64.exe',
});

   
                                                                                       
                                                                        
   
export const speechModelCatalog = Object.freeze({
  'small-q5_1': Object.freeze({
    id: 'small-q5_1',
    label: '표준',
    description: '한국어 받아쓰기 기본 모델입니다. 정확도와 속도의 균형이 좋습니다.',
    file: 'ggml-small-q5_1.bin',
    bytes: 190085487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
    url: modelUrl('ggml-small-q5_1.bin'),
    revision: huggingFaceRevision,
    license: 'MIT',
    upstream: 'https://huggingface.co/ggerganov/whisper.cpp',
    minimumMemoryMb: 1024,
    // 느린 PC 에서 녹음 1초당 허용하는 처리 시간(초). 시간 초과 계산에만 쓴다.
    slowPcSecondsPerAudioSecond: 3,
    // 측정: 그리디(빔 1)가 빔 5보다 긴 녹음에서 약 30% 빠르고 이 표본에서 오류가 같거나 적었다.
    beamSize: 1,
    recommended: true,
  }),
  base: Object.freeze({
    id: 'base',
    label: '가벼움',
    description: '내려받기가 가장 작고 빠르지만 받침·전문 용어를 더 자주 틀립니다.',
    file: 'ggml-base.bin',
    bytes: 147951465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    url: modelUrl('ggml-base.bin'),
    revision: huggingFaceRevision,
    license: 'MIT',
    upstream: 'https://huggingface.co/ggerganov/whisper.cpp',
    minimumMemoryMb: 512,
    slowPcSecondsPerAudioSecond: 2,
    // 측정: base 는 빔 5가 그리디보다 오류가 적었고(16 → 10글자), 그리디에서는 해독할 수 없는 바이트(U+FFFD)도 나왔다.
    beamSize: 5,
    recommended: false,
  }),
  'large-v3-turbo-q5_0': Object.freeze({
    id: 'large-v3-turbo-q5_0',
    label: '정확도 우선',
    description: '전문 용어까지 가장 정확하지만 CPU 에서는 말한 시간보다 오래 걸릴 수 있습니다. 긴 회의 녹음 정리에 알맞습니다.',
    file: 'ggml-large-v3-turbo-q5_0.bin',
    bytes: 574041195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    url: modelUrl('ggml-large-v3-turbo-q5_0.bin'),
    revision: huggingFaceRevision,
    license: 'MIT',
    upstream: 'https://huggingface.co/ggerganov/whisper.cpp',
    minimumMemoryMb: 2048,
    slowPcSecondsPerAudioSecond: 10,
    beamSize: 1,
    recommended: false,
  }),
});

export const speechModelDownloadHosts = Object.freeze(['huggingface.co', '.huggingface.co', '.hf.co']);
export const defaultSpeechModelId = 'small-q5_1';
// 사용자가 모델을 고르지 않았을 때 설치된 모델 중에서 고르는 순서.
export const speechModelPreference = Object.freeze(['small-q5_1', 'large-v3-turbo-q5_0', 'base']);

// whisper.cpp 가 아는 언어 코드(+ auto). 이 밖의 값은 엔진에 넘기지 않는다.
export const whisperLanguageCodes = Object.freeze(new Set([
  'auto', 'en', 'zh', 'de', 'es', 'ru', 'ko', 'fr', 'ja', 'pt', 'tr', 'pl', 'ca', 'nl', 'ar', 'sv', 'it', 'id', 'hi', 'fi', 'vi', 'he', 'uk',
  'el', 'ms', 'cs', 'ro', 'da', 'hu', 'ta', 'no', 'th', 'ur', 'hr', 'bg', 'lt', 'la', 'mi', 'ml', 'cy', 'sk', 'te', 'fa', 'lv', 'bn', 'sr',
  'az', 'sl', 'kn', 'et', 'mk', 'br', 'eu', 'is', 'hy', 'ne', 'mn', 'bs', 'kk', 'sq', 'sw', 'gl', 'mr', 'pa', 'si', 'km', 'sn', 'yo', 'so',
  'af', 'oc', 'ka', 'be', 'tg', 'sd', 'gu', 'am', 'yi', 'lo', 'uz', 'fo', 'ht', 'ps', 'tk', 'nn', 'mt', 'sa', 'lb', 'my', 'bo', 'tl', 'mg',
  'as', 'tt', 'haw', 'ln', 'ha', 'ba', 'jw', 'su', 'yue',
]));

export function resolveSpeechModel(id) {
  const key = String(id ?? '');
  if (!Object.hasOwn(speechModelCatalog, key)) throw new Error('지원하는 받아쓰기 모델을 선택해 주세요.');
  return speechModelCatalog[key];
}
