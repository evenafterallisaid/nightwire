import {mkdir,readFile,writeFile,cp,chmod,rename,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),cache=join(root,'.cache');
const manifest=JSON.parse(await readFile(join(root,'scripts/components.json')));
const target=process.argv[2]||process.platform;if(!['darwin','win32'].includes(target))throw Error('supported targets: darwin, win32');
const platform=target==='darwin'?'darwin-arm64':'windows-amd64',suffix=target==='darwin'?'Mac':'Windows';
await mkdir(cache,{recursive:true});
function run(command,args){const p=spawnSync(command,args,{stdio:'inherit'});if(p.status!==0)throw Error(command+' failed');}
async function fetchAsset(name){
 const {url,sha256}=manifest.assets[name],file=join(cache,basename(new URL(url).pathname));
 try{if(createHash('sha256').update(await readFile(file)).digest('hex')===sha256)return file;}catch{}
 const response=await fetch(url);if(!response.ok)throw Error('download failed: '+response.status+' '+name);
 const bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('checksum mismatch: '+name);
 await writeFile(file+'.part',bytes);await rename(file+'.part',file);return file;
}
async function unpack(archive,dir){
 await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
 if(archive.endsWith('.tar.gz'))run('tar',['-xzf',archive,'-C',dir]);
 else if(process.platform==='win32')run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath '${archive.replaceAll("'","''")}' -DestinationPath '${dir.replaceAll("'","''")}' -Force`]);
 else run('/usr/bin/ditto',['-x','-k',archive,dir]);
}
const core=await fetchAsset('core'+suffix),unpacked=join(cache,'core-'+target);await unpack(core,unpacked);
const backend=join(root,'backend',platform);await mkdir(backend,{recursive:true});
for(const name of [target==='darwin'?'sing-box':'sing-box.exe','LICENSE'])await cp(join(unpacked,'sing-box-'+manifest.coreVersion+'-'+platform,name),join(backend,name));
if(target==='darwin')await chmod(join(backend,'sing-box'),0o755);
if(target==='win32'){
 const zip=await fetchAsset('wintun'),dir=join(cache,'wintun');await unpack(zip,dir);
 await cp(join(dir,'wintun/bin/amd64/wintun.dll'),join(backend,'wintun.dll'));
 await cp(join(dir,'wintun/LICENSE.txt'),join(backend,'wintun-LICENSE.txt'));
}
const runtime=join(cache,'runtime-'+target);await unpack(await fetchAsset('electron'+suffix),runtime);
console.log('verified components ready; runtime: '+(target==='darwin'?join(runtime,'Electron.app'):runtime));
