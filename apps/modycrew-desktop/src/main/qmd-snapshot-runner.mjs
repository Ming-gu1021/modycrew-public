// Loads only the reviewed QMD SDK. No CLI, model methods or external document paths.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {syncBuiltinESMExports} from 'node:module';
import net from 'node:net';import tls from 'node:tls';import http from 'node:http';import https from 'node:https';import dgram from 'node:dgram';import cp from 'node:child_process';
const deny=()=>{throw Error('External operations disabled for QMD snapshot');};
globalThis.fetch=deny;globalThis.WebSocket=class{constructor(){deny();}};
net.connect=net.createConnection=net.Socket.prototype.connect=deny;tls.connect=deny;http.request=http.get=https.request=https.get=deny;dgram.createSocket=deny;
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=deny;
syncBuiltinESMExports();
console.log=(...args)=>console.error(...args);
let raw='',bytes=0;for await(const part of process.stdin){bytes+=part.length;if(bytes>4*1024*1024)throw Error('Input too large');raw+=part.toString('utf8');}
const {documents,query}=JSON.parse(raw);if(!Array.isArray(documents)||documents.length<1||documents.length>20||typeof query!=='string'||query.length>300)throw Error('Invalid input');
const work=process.cwd(),docs=path.join(work,'docs');await fs.mkdir(docs);
for(let i=0;i<documents.length;i++){const doc=documents[i];if(typeof doc.text!=='string'||Buffer.byteLength(doc.text)>65536)throw Error('Invalid document');await fs.writeFile(path.join(docs,'doc-'+i+'.md'),doc.text,{flag:'wx'});}
const sdk=await import(pathToFileURL(path.join(process.argv[2],'node_modules','@tobilu','qmd','dist','index.js')).href);
let store;try{
 store=await sdk.createStore({dbPath:path.join(work,'snapshot.sqlite'),config:{collections:{snapshot:{path:docs,pattern:'*.md'}}}});
 await store.update({collections:['snapshot']});
 const rows=await store.searchLex(query,{collection:'snapshot',limit:10});
 const matches=rows.map(row=>{const m=/(?:^|\/)doc-(\d+)\.md$/u.exec(String(row.filepath).replaceAll('\\','/'));const index=m?Number(m[1]):-1;if(index<0||index>=documents.length||!Number.isFinite(row.score))throw Error('Unknown result document');return {index,score:row.score};});
 process.stdout.write(JSON.stringify({matches,keywordOnly:true}));
}finally{if(store)await store.close();}
