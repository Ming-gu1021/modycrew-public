import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
export const beadsArchiveManifest=Object.freeze({version:'1.3.4',license:'MIT',bytes:54271934,sha256:'e66e7b66c0d1ac6a878951462edddb4a177532aff3fc22989daac115feaaef11',url:'https://github.com/gastownhall/beads/releases/download/v1.3.4/beads_1.3.4_windows_amd64.zip',source:'https://github.com/gastownhall/beads/releases/tag/v1.3.4'});
export const beadsFiles=['bd.exe','LICENSE','README.md','CHANGELOG.md'];
export function extractBeadsArchive(buffer,manifest=beadsArchiveManifest){
 if(buffer.length!==manifest.bytes||createHash('sha256').update(buffer).digest('hex')!==manifest.sha256)throw new Error('beads 배포 압축 파일의 크기·SHA-256이 다릅니다.');
 // Only ordinary single-disk ZIP32 with four flat upstream files. No shell archiver.
 const need=(offset,length)=>{if(offset<0||offset+length>buffer.length)throw new Error('ZIP 경계 오류');};
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--){if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}}
 if(end<0)throw new Error('ZIP 종료 레코드 없음');
 const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),start=buffer.readUInt32LE(end+16);
 if(buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6)||buffer.readUInt16LE(end+8)!==count||count!==4||start+size!==end)throw new Error('지원하지 않는 ZIP 구조');
 const files=new Map(),ranges=[];let at=start,total=0;
 for(let i=0;i<count;i++){
   need(at,46);if(buffer.readUInt32LE(at)!==0x02014b50)throw new Error('ZIP 파일 명세 오류');
   const flags=buffer.readUInt16LE(at+8),method=buffer.readUInt16LE(at+10),compressed=buffer.readUInt32LE(at+20),bytes=buffer.readUInt32LE(at+24),n=buffer.readUInt16LE(at+28),extra=buffer.readUInt16LE(at+30),comment=buffer.readUInt16LE(at+32),mode=(buffer.readUInt32LE(at+38)>>>16)&0xf000,offset=buffer.readUInt32LE(at+42);
   need(at+46,n+extra+comment);const name=buffer.subarray(at+46,at+46+n).toString('utf8');
   if(!beadsFiles.includes(name)||files.has(name)||flags&1||![0,8].includes(method)||![0,0x8000].includes(mode)||buffer.readUInt16LE(at+34)||bytes===0||bytes>256*1024*1024)throw new Error('ZIP 경로·파일·용량을 허용하지 않습니다.');
   total+=bytes;if(total>260*1024*1024)throw new Error('ZIP 전체 용량 초과');
   need(offset,30);if(buffer.readUInt32LE(offset)!==0x04034b50||buffer.readUInt16LE(offset+6)!==flags||buffer.readUInt16LE(offset+8)!==method)throw new Error('ZIP 로컬 명세 불일치');
   const localN=buffer.readUInt16LE(offset+26),localExtra=buffer.readUInt16LE(offset+28),dataAt=offset+30+localN+localExtra;
   need(offset+30,localN+localExtra+compressed);
   if(buffer.subarray(offset+30,offset+30+localN).toString('utf8')!==name||dataAt+compressed>start||ranges.some(([a,b])=>offset<b&&dataAt+compressed>a))throw new Error('ZIP 파일 범위 불일치');
   ranges.push([offset,dataAt+compressed]);
   const payload=buffer.subarray(dataAt,dataAt+compressed);const data=method===0?Buffer.from(payload):inflateRawSync(payload,{maxOutputLength:bytes});
   if(data.length!==bytes)throw new Error('ZIP 해제 크기 불일치');files.set(name,data);at+=46+n+extra+comment;
 }
 if(at!==end||files.size!==4)throw new Error('ZIP 명세 끝 불일치');
 return files;
}
