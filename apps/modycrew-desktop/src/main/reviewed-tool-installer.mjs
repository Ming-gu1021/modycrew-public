/** One fixed Windows tool. Downloads data only; never invokes an installer or executable. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const commit='7fd74d10097833ebce0cb162e0ccf7825de9b768';
export const ytDlpInstallManifest=Object.freeze({
  id:'yt-dlp',version:'2026.03.17',platform:'win32',arch:'x64',commit,
  license:'Unlicense 및 배포본의 GPLv3+ 등 제3자 라이선스; THIRD_PARTY_LICENSES.txt 참조',
  source:'https://github.com/yt-dlp/yt-dlp/releases/tag/2026.03.17',
  files:[
    {name:'yt-dlp.exe',bytes:18448981,sha256:'3db811b366b2da47337d2fcfdfe5bbd9a258dad3f350c54974f005df115a1545',url:'https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp.exe'},
    {name:'LICENSE',bytes:1211,sha256:'7e12e5df4bae12cb21581ba157ced20e1986a0508dd10d0e8a4ab9a4cf94e85c',url:`https://raw.githubusercontent.com/yt-dlp/yt-dlp/${commit}/LICENSE`},
    {name:'THIRD_PARTY_LICENSES.txt',bytes:231397,sha256:'b085c65586a953cdb4b13c6390d63ec984d66912e4b6a19e66ba3582f2ed104b',url:`https://raw.githubusercontent.com/yt-dlp/yt-dlp/${commit}/THIRD_PARTY_LICENSES.txt`},
  ],
});
async function download(fetchImpl,file) {
  let url=file.url;const signal=AbortSignal.timeout(120000);
  for(let i=0;i<3;i++){
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||!['github.com','raw.githubusercontent.com','release-assets.githubusercontent.com'].includes(parsed.hostname))throw new Error('허용되지 않은 다운로드 주소입니다.');
    const res=await fetchImpl(url,{redirect:'manual',signal});
    if([301,302,303,307,308].includes(res.status)) {await res.body?.cancel?.();const next=res.headers.get('location');if(!next)throw new Error('다운로드 이동 주소가 없습니다.');url=new URL(next,url).href;continue;}
    if(!res.ok)throw new Error('다운로드 실패: '+res.status);
    if(!res.body?.getReader)throw new Error('크기를 제한할 수 없는 다운로드 응답입니다.');
    const reader=res.body.getReader();const chunks=[];let size=0;
    try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>file.bytes)throw new Error('다운로드 크기 불일치');chunks.push(Buffer.from(value));}}
    finally{await reader.cancel().catch(()=>{});}
    const data=Buffer.concat(chunks);
    if(size!==file.bytes||hash(data)!==file.sha256)throw new Error('다운로드 무결성 불일치: '+file.name);
    return data;
  }
  throw new Error('다운로드 이동 횟수 초과');
}

export function createReviewedToolInstaller({root,io=fs,fetch:fetchImpl=globalThis.fetch,confirm=async()=>false,manifest=ytDlpInstallManifest}) {
  // Manifest is supplied only by application code, never IPC/model input.
  if(!root||!/^\d{4}\.\d{2}\.\d{2}$/u.test(manifest.version)||manifest.files.length!==3||manifest.files.some(f=>!['yt-dlp.exe','LICENSE','THIRD_PARTY_LICENSES.txt'].includes(f.name)||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>32*1024*1024||!/^[a-f0-9]{64}$/u.test(f.sha256)))throw new Error('검토된 설치 명세가 필요합니다.');
  const directory=path.join(root,manifest.version),exe=path.join(directory,'yt-dlp.exe');let busy=false;
  async function exists(file){try{await io.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
  async function verifyFolder(folder){
    for(const dir of [root,folder]){const info=await io.lstat(dir);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('설치 폴더가 일반 폴더가 아닙니다.');}
    const entries=await io.readdir(folder);const expected=[...manifest.files.map(f=>f.name),'receipt.json'];
    if(entries.length!==expected.length||entries.some(x=>!expected.includes(x)))throw new Error('설치 묶음의 파일 구성이 바뀌었습니다.');
    for(const file of manifest.files){const target=path.join(folder,file.name);const info=await io.lstat(target);if(!info.isFile()||info.isSymbolicLink()||info.size!==file.bytes||hash(await io.readFile(target))!==file.sha256)throw new Error('설치 파일 무결성 불일치: '+file.name);}
    const receiptPath=path.join(folder,'receipt.json');const stat=await io.lstat(receiptPath);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)throw new Error('설치 기록 형식 오류');
    const receipt=JSON.parse(await io.readFile(receiptPath,'utf8'));
    if(receipt.version!==manifest.version||receipt.manifestSha256!==hash(Buffer.from(JSON.stringify(manifest)))||typeof receipt.approvedAt!=='string')throw new Error('설치 출처 기록 불일치');
  }
  return {
    async resolve(){if(!await exists(directory))return null;await verifyFolder(directory);return exe;},
    async prepare(){
      if(busy)return {status:'busy',userMessage:'원본 도구를 준비 중입니다.'};busy=true;
      let stage,physicalRoot,lock,lockPath;
      try{
        if(await exists(directory)){await verifyFolder(directory);return {status:'tool_available',file:exe,reused:true,userMessage:'검증된 앱 전용 설치본을 재사용합니다. media.video.inspect로 별도 조회 승인을 받으세요.'};}
        const total=manifest.files.reduce((sum,f)=>sum+f.bytes,0);
        const approved=await confirm({kind:'install_tool',name:'yt-dlp '+manifest.version,detail:[
          '공개 영상 정보 조회에 사용할 Windows x64 원본 프로그램을 앱 전용 폴더에 설치합니다.',
          '출처: '+manifest.source,'버전: '+manifest.version,'용량: '+total+'바이트 (3개 파일 및 설치 기록)',
          '위치: '+directory,'실행 파일 SHA-256: '+manifest.files[0].sha256,'라이선스: '+manifest.license,
          'GitHub와 공식 배포 CDN에서 원본을 받습니다. 관리자 권한·PATH·레지스트리 변경은 없습니다.',
          '기존 설치본과 설정을 덮어쓰지 않습니다. 실패하면 임시 다운로드를 제거하며 자동 업데이트하지 않습니다.',
          '이 승인은 다운로드·저장에만 적용됩니다. 영상 주소 전송과 프로그램 실행은 별도 승인을 받습니다.',
        ].join('\n')});
        if(!approved)return {status:'declined',userMessage:'설치를 취소했습니다. 다운로드하거나 저장하지 않았습니다.'};
        await io.mkdir(root,{recursive:true});const info=await io.lstat(root);if(info.isSymbolicLink())throw new Error('설치 루트 링크를 사용할 수 없습니다.');
        physicalRoot=await io.realpath(root);lockPath=path.join(physicalRoot,'.install.lock');
        try{lock=await io.open(lockPath,'wx');}catch(e){if(e.code==='EEXIST')return {status:'busy',userMessage:'다른 설치 또는 중단된 설치 잠금이 있습니다. 자동 해제하지 않았습니다.'};throw e;}
        if(await exists(directory)){await verifyFolder(directory);return {status:'tool_available',file:exe,reused:true,userMessage:'먼저 준비된 동일 설치본을 재사용합니다.'};}
        stage=path.join(physicalRoot,'.stage-'+randomUUID());await io.mkdir(stage);
        for(const file of manifest.files)await io.writeFile(path.join(stage,file.name),await download(fetchImpl,file),{flag:'wx'});
        await io.writeFile(path.join(stage,'receipt.json'),JSON.stringify({version:manifest.version,source:manifest.source,commit:manifest.commit,license:manifest.license,manifestSha256:hash(Buffer.from(JSON.stringify(manifest))),approvedAt:new Date().toISOString()}),{flag:'wx'});
        await verifyFolder(stage);
        if(await exists(directory))throw new Error('설치 위치가 새로 생겼습니다. 기존 폴더를 보존했습니다.');
        await io.rename(stage,directory);stage=null;await verifyFolder(directory);
        return {status:'tool_available',file:exe,installedNow:true,userMessage:'공식 해시와 라이선스를 확인해 앱 전용 설치를 마쳤습니다. 아직 프로그램을 실행하지 않았습니다. media.video.inspect로 별도 조회 승인을 받으세요.'};
      }catch(error){return {status:'review_required',userMessage:error.message+' 자동 실행·기존 설치본 덮어쓰기는 하지 않았습니다.'};}
      finally{if(stage&&path.dirname(stage)===physicalRoot&&path.basename(stage).startsWith('.stage-'))await io.rm(stage,{recursive:true,force:true}).catch(()=>{});if(lock){await lock.close().catch(()=>{});await io.unlink(lockPath).catch(()=>{});}busy=false;}
    },
  };
}

export { download as downloadReviewedFile };
