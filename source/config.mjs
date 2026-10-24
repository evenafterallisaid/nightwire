import {isIP} from 'node:net';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PRIVATE_NETS=['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.168.0.0/16','198.18.0.0/15','224.0.0.0/4','240.0.0.0/4','::/128','::1/128','fc00::/7','fe80::/10','ff00::/8'];
function hostname(value){
 if(typeof value!=='string'||value.length>253||!value||/[\s/\\@?#:]/.test(value)&&!isIP(value))throw Error('Enter a valid server hostname or IP address.');
 if(!isIP(value)&&!value.split('.').every(x=>/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(x)&&x.length<=63))throw Error('Invalid server hostname.');
 return value;
}
export function normalizeProfile(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid profile.');
 const p={version:1,name:String(value.name||'Home connection').slice(0,100),server:hostname(value.server),port:Number(value.port??443),uuid:value.uuid,transport:value.transport??'ws',tls:value.tls!==false,serverName:hostname(value.serverName||value.server),path:value.path??'/nightwire'};
 if(!Number.isInteger(p.port)||p.port<1||p.port>65535)throw Error('Invalid server port.');
 if(typeof p.uuid!=='string'||!UUID.test(p.uuid))throw Error('Invalid VLESS login ID.');
 if(!['ws','tcp'].includes(p.transport))throw Error('Only WebSocket and TCP profiles are supported.');
 if(typeof p.path!=='string'||!p.path.startsWith('/')||p.path.length>512||/[\r\n\0]/.test(p.path))throw Error('Invalid WebSocket path.');
 if(!p.tls&&!['127.0.0.1','::1','localhost'].includes(p.server))throw Error('Unencrypted connections are only allowed for local tests.');
 return p;
}
export function parseProfile(text){
 if(typeof text!=='string'||text.length>65536)throw Error('Profile must be smaller than 64 KB.');
 text=text.trim();if(text.startsWith('{'))return normalizeProfile(JSON.parse(text));
 const u=new URL(text);if(u.protocol!=='vless:')throw Error('Import a VLESS link or nightwire JSON profile.');
 if(u.searchParams.get('security')==='reality'||u.searchParams.get('flow'))throw Error('This release supports TLS WebSocket or TCP profiles, without REALITY/Vision.');
 if(u.searchParams.get('allowInsecure')==='1'||u.searchParams.get('insecure')==='1')throw Error('Profiles that disable certificate verification are not accepted.');
 const encryption=u.searchParams.get('encryption');if(encryption&&encryption!=='none')throw Error('Unsupported VLESS encryption mode.');
 return normalizeProfile({name:decodeURIComponent(u.hash.slice(1))||u.hostname,server:u.hostname.replace(/^\[|\]$/g,''),port:u.port||443,uuid:decodeURIComponent(u.username),transport:u.searchParams.get('type')||'tcp',tls:u.searchParams.get('security')!=='none',serverName:u.searchParams.get('sni')||u.hostname.replace(/^\[|\]$/g,''),path:u.searchParams.get('path')||'/nightwire'});
}
export function shareLink(value){
 const p=normalizeProfile(value);const host=isIP(p.server)===6?`[${p.server}]`:p.server;
 const u=new URL(`vless://${p.uuid}@${host}:${p.port}`);
 for(const [k,v] of Object.entries({encryption:'none',security:p.tls?'tls':'none',type:p.transport,sni:p.serverName,...p.transport==='ws'?{path:p.path,host:p.serverName}:{}}))u.searchParams.set(k,v);
 u.hash=p.name;return u.toString();
}
function resolver(tag,detour){return {type:'https',tag,server:'1.1.1.1',path:'/dns-query',tls:{enabled:true,server_name:'cloudflare-dns.com'},...(detour?{detour}:{})};}
export function clientConfig(value,{mode='proxy',port=10808,platform=process.platform,endpointIPs=[]}={}){
 const p=normalizeProfile(value);if(!['proxy','tun'].includes(mode))throw Error('Invalid connection mode.');
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local proxy port.');
 const proxy={type:'vless',tag:'proxy',server:endpointIPs.find(ip=>isIP(ip)===4)||endpointIPs[0]||p.server,server_port:p.port,uuid:p.uuid,packet_encoding:'xudp',...(p.tls?{tls:{enabled:true,server_name:p.serverName}}:{}),...(p.transport==='ws'?{transport:{type:'ws',path:p.path,headers:{Host:p.serverName}}}:{}),domain_resolver:'bootstrap'};
 const inbound={type:'mixed',tag:'local',listen:'127.0.0.1',listen_port:port};
 const inbounds=[inbound];
 if(mode==='tun'){
  if(!['darwin','win32','linux'].includes(platform))throw Error('Full-device routing is unsupported on this system.');
  if(!endpointIPs.length||endpointIPs.some(ip=>!isIP(ip)))throw Error('Resolve the server before enabling full-device routing.');
  inbounds.push({type:'tun',tag:'device',interface_name:platform==='darwin'?'utun188':'nightwire',address:['172.29.255.1/30','fdfe:dcba:9876::1/126'],mtu:1400,auto_route:true,strict_route:true,dns_mode:'hijack',stack:'mixed'});
 }
 return {log:{level:'warn',timestamp:true},dns:{servers:[{type:'local',tag:'bootstrap'},resolver('remote','proxy')],final:'remote',strategy:'prefer_ipv4'},inbounds,outbounds:[proxy,{type:'direct',tag:'direct'}],route:{auto_detect_interface:true,default_domain_resolver:'bootstrap',rules:[{port:53,action:'hijack-dns'}],final:'proxy'}};
}
export function serverConfig(users,{port=2087,path='/nightwire'}={}){
 if(!Array.isArray(users)||!users.length)throw Error('At least one user is required.');
 const names=new Set(),ids=new Set();
 const accounts=users.filter(u=>u.enabled!==false).map(u=>{
  if(!/^[a-z0-9][a-z0-9_-]{0,47}$/i.test(u.name)||!UUID.test(u.uuid)||names.has(u.name)||ids.has(u.uuid))throw Error('Invalid or duplicate server user.');
  names.add(u.name);ids.add(u.uuid);return {name:u.name,uuid:u.uuid};
 });
 if(!accounts.length)throw Error('At least one active user is required.');
 if(!Number.isInteger(port)||port<1024||port>65535||!/^\/[a-zA-Z0-9_/-]+$/.test(path))throw Error('Invalid server listener.');
 return {log:{level:'warn',timestamp:true},dns:{servers:[resolver('public')],final:'public',strategy:'prefer_ipv4'},inbounds:[{type:'vless',tag:'friends',listen:'127.0.0.1',listen_port:port,users:accounts,transport:{type:'ws',path}}],outbounds:[{type:'direct',tag:'internet'}],route:{default_domain_resolver:'public',rules:[{action:'resolve',strategy:'prefer_ipv4'},{ip_cidr:PRIVATE_NETS,action:'reject'}],final:'internet'}};
}
