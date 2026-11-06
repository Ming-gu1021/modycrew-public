/** Fixed wheels are data until a separately approved parser invocation. No pip/build hooks. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {sourcePath} from './reviewed-source-bundles.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function extractReviewedWheel(buffer,wheel){
 if(buffer.length!==wheel.bytes||hash(buffer)!==wheel.sha256)throw new Error('wheel 원본 크기·해시 불일치');
 const expected=new Map(wheel.files.map(f=>[f.path,f])),out=new Map();let end=-1;
 const need=(at,n)=>{if(at<0||n<0||at+n>buffer.length)throw new Error('wheel ZIP 경계 오류');};
 for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}
 if(end<0)throw new Error('wheel ZIP 종료 오류');
 const count=buffer.readUInt16LE(end+10),start=buffer.readUInt32LE(end+16),size=buffer.readUInt32LE(end+12);
 if(count>4096||buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6)||buffer.readUInt16LE(end+8)!==count||start+size!==end)throw new Error('wheel ZIP 구조 오류');
 let at=start;const ranges=[];
 for(let i=0;i<count;i++){
  need(at,46);if(buffer.readUInt32LE(at)!==0x02014b50)throw new Error('wheel 파일 명세 오류');
  const flags=buffer.readUInt16LE(at+8),method=buffer.readUInt16LE(at+10),compressed=buffer.readUInt32LE(at+20),bytes=buffer.readUInt32LE(at+24),n=buffer.readUInt16LE(at+28),extra=buffer.readUInt16LE(at+30),comment=buffer.readUInt16LE(at+32),mode=(buffer.readUInt32LE(at+38)>>>16)&0xf000,offset=buffer.readUInt32LE(at+42);
  need(at+46,n+extra+comment);const name=buffer.subarray(at+46,at+46+n).toString('utf8');at+=46+n+extra+comment;
  if(flags&1||buffer.readUInt16LE(at-46-n-extra-comment+34)||![0,8].includes(method))throw new Error('wheel 암호화·압축 방식 오류');
  if(name.endsWith('/')){sourcePath(name.slice(0,-1));if(bytes!==0||![0,0x4000].includes(mode)||!wheel.files.some(f=>f.path.startsWith(name)))throw new Error('wheel 폴더 오류');continue;}
  sourcePath(name);const file=expected.get(name);if(!file||out.has(name)||bytes!==file.bytes||![0,0x8000].includes(mode))throw new Error('wheel 허용 파일 명세 불일치');
  need(offset,30);if(buffer.readUInt32LE(offset)!==0x04034b50||buffer.readUInt16LE(offset+6)!==flags||buffer.readUInt16LE(offset+8)!==method)throw new Error('wheel 로컬 명세 불일치');
  const ln=buffer.readUInt16LE(offset+26),le=buffer.readUInt16LE(offset+28),dataAt=offset+30+ln+le;need(offset+30,ln+le+compressed);
  if(buffer.subarray(offset+30,offset+30+ln).toString('utf8')!==name||dataAt+compressed>start||ranges.some(([a,b])=>offset<b&&dataAt+compressed>a))throw new Error('wheel 파일 경계 불일치');
  ranges.push([offset,dataAt+compressed]);const packed=buffer.subarray(dataAt,dataAt+compressed);const data=method===0?Buffer.from(packed):inflateRawSync(packed,{maxOutputLength:Math.max(1,bytes)});
  if(data.length!==bytes||hash(data)!==file.sha256)throw new Error('wheel 해제 파일 무결성 불일치');out.set(name,data);
 }
 if(at!==end||out.size!==expected.size)throw new Error('wheel 필수 파일 누락');return out;
}
async function download(fetchImpl,wheel){
 const url=new URL(wheel.url);if(url.protocol!=='https:'||url.hostname!=='files.pythonhosted.org'||url.username||url.password||url.port)throw new Error('허용되지 않은 패키지 출처');
 const response=await fetchImpl(wheel.url,{redirect:'error',signal:AbortSignal.timeout(60000)});
 if(!response.ok||!response.body?.getReader)throw new Error('wheel 다운로드 실패');
 const reader=response.body.getReader();let size=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>wheel.bytes)throw new Error('wheel 다운로드 용량 초과');chunks.push(Buffer.from(value));}}
 finally{await reader.cancel().catch(()=>{});}const data=Buffer.concat(chunks);if(size!==wheel.bytes||hash(data)!==wheel.sha256)throw new Error('wheel 다운로드 무결성 불일치');return data;
}
export function createReviewedWheelBundle({root,manifest,io=fs,fetch:fetchImpl=globalThis.fetch,confirm=async()=>false}){
 if(!/^[a-zA-Z0-9.-]{1,60}$/u.test(manifest.version)||!manifest.packages?.length||manifest.packages.length>12)throw new Error('패키지 명세 오류');
 const files=new Map();let total=0;
 for(const wheel of manifest.packages){
  if(!Number.isSafeInteger(wheel.bytes)||wheel.bytes<1||wheel.bytes>16*1024*1024||!/^[a-f0-9]{64}$/u.test(wheel.sha256)||!wheel.licenseFiles?.length)throw new Error('wheel 명세 오류');
  for(const f of wheel.files){sourcePath(f.path);if(files.has(f.path.toLowerCase())||f.path.endsWith('.pth')||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>16*1024*1024||!/^[a-f0-9]{64}$/u.test(f.sha256))throw new Error('패키지 파일 명세 오류');files.set(f.path.toLowerCase(),f);total+=f.bytes;}
  if(wheel.licenseFiles.some(p=>!wheel.files.some(f=>f.path===p)))throw new Error('패키지 라이선스 파일 누락');
 }
 if(files.size>4096||total>64*1024*1024)throw new Error('패키지 전체 용량 초과');
 const target=path.join(root,manifest.version),manifestHash=hash(Buffer.from(JSON.stringify(manifest)));let busy=false;
 const exists=async p=>{try{await io.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 const dir=async p=>{const s=await io.lstat(p);if(!s.isDirectory()||s.isSymbolicLink())throw new Error('패키지 폴더 형식 오류');};
 async function verify(folder){
  await dir(root);await dir(folder);const names=await io.readdir(folder);if(names.length!==2||!names.includes('packages')||!names.includes('receipt.json'))throw new Error('패키지 설치 구성 오류');
  let count=0;const visit=async(p,prefix='')=>{await dir(p);for(const e of await io.readdir(p,{withFileTypes:true})){const relative=prefix+e.name;sourcePath(relative);if(e.isSymbolicLink())throw new Error('패키지 링크 불허');if(e.isDirectory()){if(![...files.values()].some(f=>f.path.startsWith(relative+'/')))throw new Error('추가 패키지 폴더');await visit(path.join(p,e.name),relative+'/');}else{const f=files.get(relative.toLowerCase()),full=path.join(p,e.name);if(!e.isFile()||!f||f.path!==relative||(await io.stat(full)).size!==f.bytes||hash(await io.readFile(full))!==f.sha256)throw new Error('패키지 파일 변조');count++;}}};
  await visit(path.join(folder,'packages'));if(count!==files.size)throw new Error('패키지 필수 파일 누락');
  const rp=path.join(folder,'receipt.json'),stat=await io.lstat(rp);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)throw new Error('패키지 출처 기록 오류');
  const receipt=JSON.parse(await io.readFile(rp,'utf8'));if(receipt.manifestHash!==manifestHash||typeof receipt.approvedAt!=='string')throw new Error('패키지 출처 불일치');return path.join(folder,'packages');
 }
 return {
  async resolve(){if(!await exists(target))return null;return await verify(target);},
  async prepare(){
   if(busy)return {status:'busy',userMessage:'패키지를 준비 중입니다.'};busy=true;let stage,physicalRoot,lock,lockPath;
   try{
    if(await exists(target))return {status:'tool_available',packages:await verify(target),reused:true,userMessage:'검증된 정적 분석 패키지를 재사용합니다. HTML 분석 실행은 별도 확인합니다.'};
    if(!await confirm({kind:'install_tool',name:'Scrapling 정적 HTML 분석',detail:[
      '정적 HTML 분석용 원본 7개 패키지를 앱 전용 폴더에 저장합니다. 설치 스크립트·pip·브라우저 설치는 실행하지 않습니다.',
      '출처: PyPI / files.pythonhosted.org','다운로드 '+manifest.packages.reduce((n,p)=>n+p.bytes,0)+'바이트; 해제 '+total+'바이트 / '+files.size+'파일','위치: '+target,
      ...manifest.packages.map(p=>p.name+' '+p.version+' · '+String(p.license).slice(0,160)),
      '명세 SHA-256: '+manifestHash,'원본 라이선스·메타데이터를 함께 보존합니다. 기존 Python이나 전역 패키지를 변경하지 않습니다.',
      '이 승인은 다운로드·저장에만 적용됩니다. 실제 Python 실행과 HTML 분석은 별도 승인을 받습니다. 오류 시 임시 폴더만 정리합니다.',
    ].join('\n')}))return {status:'declined',userMessage:'정적 분석 패키지 설치를 취소했습니다.'};
    await io.mkdir(root,{recursive:true});await dir(root);physicalRoot=await io.realpath(root);lockPath=path.join(physicalRoot,'.install.lock');
    try{lock=await io.open(lockPath,'wx');}catch(e){if(e.code==='EEXIST')return {status:'busy',userMessage:'다른 패키지 설치 잠금이 있습니다. 자동 해제하지 않았습니다.'};throw e;}
    if(await exists(target))return {status:'tool_available',packages:await verify(target),reused:true,userMessage:'동일 패키지를 재사용합니다.'};
    stage=path.join(physicalRoot,'.stage-'+randomUUID());await io.mkdir(path.join(stage,'packages'),{recursive:true});
    for(const wheel of manifest.packages)for(const [name,data] of extractReviewedWheel(await download(fetchImpl,wheel),wheel)){const p=path.join(stage,'packages',name);await io.mkdir(path.dirname(p),{recursive:true});await io.writeFile(p,data,{flag:'wx'});}
    await io.writeFile(path.join(stage,'receipt.json'),JSON.stringify({manifestHash,approvedAt:new Date().toISOString()}),{flag:'wx'});await verify(stage);
    if(await exists(target))throw new Error('설치 위치가 변경됐습니다.');await io.rename(stage,target);stage=null;return {status:'tool_available',packages:await verify(target),installedNow:true,userMessage:'정적 분석 패키지를 검증해 저장했습니다. 아직 원본 코드를 실행하지 않았습니다. scrapling.html.extract로 별도 실행 승인을 받으세요.'};
   }catch(e){return {status:'review_required',userMessage:e.message+' 기존 설치본은 덮어쓰지 않았습니다.'};}
   finally{if(stage&&path.dirname(stage)===physicalRoot&&path.basename(stage).startsWith('.stage-'))await io.rm(stage,{recursive:true,force:true}).catch(()=>{});if(lock){await lock.close().catch(()=>{});await io.unlink(lockPath).catch(()=>{});}busy=false;}
  },
 };
}
