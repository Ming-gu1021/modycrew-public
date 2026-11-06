import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const reviewedPythonFiles=[
 {name:'python.exe',bytes:106328,sha256:'467014615a5255aca450ae88100dd2caf887da87657f00e3c2171ec44a685aec'},
 {name:'python314.dll',bytes:6760280,sha256:'f1722bd369d79fecbc85f3ed2790c30c330b9413fd74332f95b086e60dfacc2a'},
];
export async function verifyReviewedPython({io=fs,platform=process.platform,arch=process.arch,runtimeRoot='C:\\Python314',runtime=reviewedPythonFiles}={}){
 if(platform!=='win32'||arch!=='x64')throw new Error('현재 검토된 Windows x64 / Python 3.14.0 환경만 지원합니다.');
 const stat=await io.lstat(runtimeRoot);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Python 경로를 확인하지 못했습니다.');
 for(const f of runtime){const p=path.join(runtimeRoot,f.name),s=await io.lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.size!==f.bytes||createHash('sha256').update(await io.readFile(p)).digest('hex')!==f.sha256)throw new Error('기존 Python 핵심 파일이 검토한 버전과 다릅니다. 자동 설치·실행하지 않습니다.');}
 return path.join(runtimeRoot,'python.exe');
}
