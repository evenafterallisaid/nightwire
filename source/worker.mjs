import {readFileSync,writeFileSync,renameSync,statSync,chownSync} from 'node:fs';
import {dirname,join,isAbsolute} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';

const manifestPath=process.argv[2];
const spec=JSON.parse(readFileSync(manifestPath,'utf8'));
if(spec.version!==1||!/^[a-f0-9]{64}$/.test(spec.token)||![spec.core,spec.config,spec.statusFile].every(isAbsolute)||dirname(spec.statusFile)!==dirname(manifestPath))throw Error('invalid worker session');
const owner=statSync(dirname(manifestPath));
if(spec.metricsPort!==undefined&&(!Number.isInteger(spec.metricsPort)||spec.metricsPort<1024||spec.metricsPort>65535))throw Error('invalid metrics port');
const state={version:1,pid:process.pid,port:null,running:false,corePid:null,error:null,logs:'',stopReason:null,traffic:null};
let child,lastBeat=Date.now(),closing=false,lease,meter,previousSample;
async function sampleTraffic(){
 if(!spec.metricsPort||closing)return;
 try{
  const response=await fetch(`http://127.0.0.1:${spec.metricsPort}/connections`,{headers:{authorization:'Bearer '+spec.token},signal:AbortSignal.timeout(800)});if(!response.ok)return;
  const value=await response.json();if(closing)return;const uploaded=value.uploadTotal,downloaded=value.downloadTotal,now=Date.now();
  if(![uploaded,downloaded].every(x=>Number.isSafeInteger(x)&&x>=0))return;
  const seconds=previousSample?(now-previousSample.time)/1000:1;
  state.traffic={uploaded,downloaded,upBps:previousSample?Math.max(0,uploaded-previousSample.uploaded)/seconds:0,downBps:previousSample?Math.max(0,downloaded-previousSample.downloaded)/seconds:0,updatedAt:now};
  previousSample={uploaded,downloaded,time:now};
 }catch{}
}
const ttl=Math.min(60000,Math.max(1000,spec.leaseMs||20000));
function redact(text){return String(text).replaceAll(spec.token,'[session]').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,'[login]').replace(/\x1b\[[0-9;]*m/g,'');}
function persist(){
 const tmp=spec.statusFile+'.tmp';writeFileSync(tmp,JSON.stringify(state),{mode:0o600});
 if(process.platform!=='win32'&&process.getuid()===0)chownSync(tmp,owner.uid,owner.gid);
 renameSync(tmp,spec.statusFile);
}
function log(data){state.logs=(state.logs+redact(data)).slice(-12000);persist();}
function authorized(req){const actual=Buffer.from(req.headers.authorization||'');const expected=Buffer.from('Bearer '+spec.token);return actual.length===expected.length&&timingSafeEqual(actual,expected);}
function windowsInterrupt(pid){
 const code=`Add-Type 'using System;using System.Runtime.InteropServices;public static class NwSignal{[DllImport("kernel32.dll")]public static extern bool FreeConsole();[DllImport("kernel32.dll")]public static extern bool AttachConsole(uint p);[DllImport("kernel32.dll")]public static extern bool SetConsoleCtrlHandler(IntPtr h,bool a);[DllImport("kernel32.dll")]public static extern bool GenerateConsoleCtrlEvent(uint e,uint g);}';[NwSignal]::FreeConsole()|Out-Null;if([NwSignal]::AttachConsole(${pid})){[NwSignal]::SetConsoleCtrlHandler([IntPtr]::Zero,$true)|Out-Null;[NwSignal]::GenerateConsoleCtrlEvent(0,0)|Out-Null;Start-Sleep -Milliseconds 200;[NwSignal]::FreeConsole()|Out-Null}`;
 spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,timeout:3500,stdio:'ignore'});
}
async function shutdown(reason){
 if(closing)return;closing=true;clearInterval(lease);clearInterval(meter);state.stopReason=reason;if(state.traffic){state.traffic.upBps=0;state.traffic.downBps=0;}persist();
 if(child&&child.exitCode===null){
  await new Promise(resolve=>{
   child.once('exit',resolve);
   const timer=setTimeout(()=>{if(child.exitCode===null){state.logs+='\nforced backend stop after grace period\n';child.kill('SIGKILL');}},5000);timer.unref();
   if(process.platform==='win32')windowsInterrupt(child.pid);else child.kill('SIGTERM');
  });
 }
 state.running=false;persist();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),500).unref();
}
const server=createServer((req,res)=>{
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 if(!authorized(req)){res.writeHead(403);return res.end('{"error":"unauthorized"}');}
 if(req.method==='POST'&&req.url==='/heartbeat'){lastBeat=Date.now();return res.end('{"ok":true}');}
 if(req.method==='GET'&&req.url==='/status')return res.end(JSON.stringify(state));
 if(req.method==='POST'&&req.url==='/stop'){res.writeHead(202);res.end('{"ok":true}');shutdown('requested');return;}
 res.writeHead(404);res.end('{"error":"not found"}');
});
server.listen(0,'127.0.0.1',()=>{
 state.port=server.address().port;persist();
 const check=spawnSync(spec.core,['check','-c',spec.config],{encoding:'utf8',timeout:12000,windowsHide:true});
 if(check.status!==0){state.error=redact(check.stderr||check.error?.message||'backend validation failed');persist();return shutdown('invalid configuration');}
 child=spawn(spec.core,['run','-c',spec.config],{stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform==='win32'});
 child.on('error',e=>{state.error=redact(e.message);persist();shutdown('backend failed');});
 child.stdout.on('data',log);child.stderr.on('data',log);state.corePid=child.pid;state.running=true;persist();
 child.once('exit',(code,signal)=>{state.running=false;if(!closing)state.error=redact(state.logs||`backend stopped (${code??signal})`);persist();if(!closing)shutdown('backend stopped');});
 lastBeat=Date.now();lease=setInterval(()=>{if(Date.now()-lastBeat>ttl)shutdown('controller disconnected');},500);
 if(spec.metricsPort)meter=setInterval(sampleTraffic,1000);
});
process.on('SIGTERM',()=>shutdown('controller stopped'));process.on('SIGINT',()=>shutdown('controller stopped'));
