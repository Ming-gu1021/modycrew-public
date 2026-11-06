/** Read-only discovery. A PATH file is evidence of a candidate, never permission to execute it. */
import fs from 'node:fs/promises';
import path from 'node:path';

const plans = {
  tradingagents: {
    probes: [{name:'python', files:['python.exe','python3','python'], role:'runtime'}],
    requirements: ['검토 버전의 Python 격리 환경과 고정 의존성', '모델·시세 공급자 및 비용·조회 범위 확인', '자격증명을 대화에 노출하지 않는 별도 연결'],
    approvals: ['패키지 설치', '모델·데이터 공급자 외부 요청과 비용'],
    restrictions: ['거래·주문·증권 계정 접근 금지', '결정 평가를 체결·잔고 시뮬레이션으로 표시하지 않음'],
  },
  qmd: {
    probes: [{name:'qmd',files:['qmd.cmd','qmd.exe','qmd'],role:'tool'}, {name:'node',files:['node.exe','node'],role:'runtime'}],
    requirements: ['검토 버전 CLI·네이티브 의존성', '사용자가 선택한 문서 폴더와 별도 인덱스 위치', '키워드 검색과 모델을 쓰는 임베딩·재정렬 기능 구분'],
    approvals: ['패키지 설치', '문서 읽기·인덱스 저장 범위', '별도 모델 다운로드와 용량'],
    restrictions: ['모델 자동 다운로드를 유발하는 query/embed를 준비 검사에서 호출하지 않음'],
  },
  scrapling: {
    probes: [{name:'scrapling',files:['scrapling.exe','scrapling'],role:'tool'}, {name:'python',files:['python.exe','python3','python'],role:'runtime'}],
    requirements: ['Python 격리 환경과 네이티브 의존성', '정적 추출과 선택 브라우저 실행 기능 구분', '허용된 대상 URL·요청량·저장 위치'],
    approvals: ['패키지·선택 브라우저 설치', '대상 사이트로 외부 요청'],
    restrictions: ['인증·접근 제한 우회와 기존 브라우저 쿠키 사용 금지'],
  },
  beads: {
    probes: [{name:'bd',files:['bd.exe','bd'],role:'tool'}],
    requirements: ['공식 배포 해시와 CLI 버전 확인', '기존 업무 원장과 중복 확인', '사용자가 선택한 프로젝트·데이터베이스 모드·백업 및 스키마 호환 확인'],
    approvals: ['CLI 설치', '프로젝트 초기화·데이터베이스·후크 변경', '원격 동기화'],
    restrictions: ['준비 검사에서 init/setup/migrate 또는 원격 동기화를 호출하지 않음'],
  },
};

export function createStandaloneToolReadiness({io=fs, environment=process.env, platform=process.platform, now=()=>new Date().toISOString()}={}) {
  return async function inspect(reference, catalog) {
    const plan=Object.hasOwn(plans,reference.id)?plans[reference.id]:null;
    if(!plan)return null;
    const paths=platform==='win32'?path.win32:path.posix;
    const raw=environment.PATH??environment.Path??'';
    const entries=[...new Set(raw.split(platform==='win32'?';':':').filter(Boolean))];
    // Avoid relative paths, UNC shares, device paths and control characters. Never execute shims.
    const eligible=entries.filter(p=>!/[\x00-\x1f]/u.test(p) && (platform==='win32'?/^[A-Za-z]:[\\/]/u.test(p):p.startsWith('/')&&!p.startsWith('//')));
    const roots=eligible.slice(0,64);
    const candidates=[]; let errors=0;
    for(const probe of plan.probes) {
      const found=[];
      for(const root of roots) {
        for(const filename of probe.files.filter(f=>platform==='win32'||!f.endsWith('.exe')&&!f.endsWith('.cmd'))) {
          const file=paths.join(root,filename);
          try {const info=await io.lstat(file); if(info.isFile()&&!info.isSymbolicLink())found.push({file,bytes:info.size});}
          catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))errors++;}
          if(found.length===3)break;
        }
        if(found.length===3)break;
      }
      candidates.push({name:probe.name,role:probe.role,status:found.length?'candidate_unverified':'not_found_in_scanned_path',files:found});
    }
    const existingSkills=(reference.reflectedIn??[]).filter(name=>catalog.skills?.some(s=>s.name===name));
    return {
      status:'needs_adapter', referenceId:reference.id,
      userMessage:'로컬 준비 조건을 확인했습니다. 발견된 파일은 버전·무결성·실행 가능성이 검증되지 않은 후보입니다. 원본 설치·실행 어댑터는 아직 연결되지 않았습니다.'+(existingSkills.length?' 기존 앱 스킬은 crew.skill.read로 지침을 읽어 재사용할 수 있습니다. 원본 프레임워크 실행과는 구분하세요.':''),
      checkedAt:now(), original:{url:reference.url,license:reference.license,reviewedVersion:reference.reviewedVersion},
      discovery:{scope:'PATH 파일 존재만 검사; 가상환경·전체 디스크·패키지 import 없음',directories:roots.length,omittedDirectories:entries.length-roots.length,errors,candidates},
      setup:{requirements:plan.requirements,approvalRequiredFor:plan.approvals,restrictions:plan.restrictions,installerAvailable:false,executionAvailable:false,nextStep:'기존 설치본이 있으면 버전과 공식 무결성을 검증한 전용 어댑터부터 연결합니다. 없으면 고정 버전·격리 경로·용량·권한을 제시한 뒤 설치 승인을 받아야 합니다. 이 응답 자체는 승인 요청이나 승인 기록이 아닙니다.'},
      existingSkills, performed:{processExecution:false,network:false,installation:false,modelDownload:false,writes:false},
    };
  };
}
