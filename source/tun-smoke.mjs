// an explicit privileged smoke test, never part of an ordinary desktop startup.
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import net from 'node:net';
import {clientConfig} from './config.mjs';
import {probeDevice} from './device.mjs';
if(!process.argv.includes('--privileged'))throw Error('this test changes routes; run explicitly with --privileged as administrator');
const dir=await mkdtemp(join(tmpdir(),'nightwire-tun-smoke-')),token=randomBytes(32).toString('hex');
const core=process.env.SING_BOX||resolve(import.meta.dirname,'../backend',process.platform==='win32'?'windows-amd64':'darwin-arm64',process.platform==='win32'?'sing-box.exe':'sing-box');
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const config=clientConfig({server:'127.0.0.1',port:2087,uuid:randomUUID(),tls:false},{mode:'tun',port,endpointIPs:['127.0.0.1']});
// exercise the real driver and routes with direct egress, without a remote account.
config.outbounds=[{type:'direct',tag:'proxy'}];
const file=join(dir,'config.json'),statusFile=join(dir,'status.json'),manifest=join(dir,'session.json');
await writeFile(file,JSON.stringify(config),{mode:0o600});await writeFile(manifest,JSON.stringify({version:1,core,config:file,statusFile,token,leaseMs:8000}),{mode:0o600});
const child=spawn(process.execPath,[resolve(import.meta.dirname,'worker.mjs'),manifest],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
let status,heartbeat;
async function control(path){return fetch(`http://127.0.0.1:${status.port}${path}`,{method:'POST',headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(2000)});}
try{
 for(let n=0;n<100;n++){try{status=JSON.parse(await readFile(statusFile,'utf8'));if(status.running)break;if(status.error)throw Error(status.error);}catch(e){if(e.code!=='ENOENT')throw e;}await new Promise(r=>setTimeout(r,100));}
 assert.equal(status?.running,true);heartbeat=setInterval(()=>control('/heartbeat').catch(()=>{}),1000);
 let verified;for(let n=0;n<20;n++){try{verified=await probeDevice();break;}catch(e){if(n===19)throw e;await new Promise(r=>setTimeout(r,250));}}
 assert.equal(verified?.ok,true);console.log('real tun driver, ipv4/ipv6 routes, system dns and direct https passed');
}finally{
 clearInterval(heartbeat);if(status?.port)await control('/stop').catch(()=>{});
 await new Promise((resolve,reject)=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>reject(Error('worker shutdown timed out')),15000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
 const after=JSON.parse(await readFile(statusFile,'utf8'));assert.equal(after.running,false);
 if(process.platform==='win32'){
  const routes=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-NetRoute -InterfaceAlias nightwire -ErrorAction SilentlyContinue | Where-Object { $_.DestinationPrefix -in @('0.0.0.0/1','128.0.0.0/1','::/1','8000::/1','0.0.0.0/0','::/0') } | Measure-Object | Select-Object -ExpandProperty Count"],{encoding:'utf8'});assert.equal(Number(routes.trim()),0);
 }else assert.throws(()=>execFileSync('/sbin/ifconfig',['utun188'],{stdio:'ignore'}));
 await rm(dir,{recursive:true,force:true});console.log('worker stopped and tunnel routes removed');
}
