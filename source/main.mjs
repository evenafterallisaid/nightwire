import {app,BrowserWindow,ipcMain,dialog,session,Menu,safeStorage,powerMonitor} from 'electron';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseProfile,shareLink} from './config.mjs';
import {ProfileStore} from './profiles.mjs';
import {SessionManager} from './session.mjs';

const source=dirname(fileURLToPath(import.meta.url));app.setName('nightwire');
if(process.env.NIGHTWIRE_DATA_DIR)app.setPath('userData',resolve(process.env.NIGHTWIRE_DATA_DIR));
const directory=app.getPath('userData');
let window,manager,store,quitting=false,activeId=null,startupError=null;
const pendingFiles=[];
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',(_event,argv)=>{const file=argv.find(x=>x.endsWith('.nightwire'));if(file)importFile(file).catch(showError);window?.show();window?.focus();});
app.on('open-file',(event,file)=>{event.preventDefault();if(store)importFile(file).catch(showError);else pendingFiles.push(file);});
function showError(error){startupError=error.message;emit();}
function state(){return {...manager.snapshot(),profiles:store.list(),activeId,startupError,platform:process.platform,version:app.getVersion()};}
function emit(){if(window&&!window.isDestroyed())window.webContents.send('state-changed',state());}
function handle(channel,callback){ipcMain.handle(channel,async(event,...args)=>{
 if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)return {ok:false,error:'untrusted request'};
 try{return {ok:true,result:await callback(...args)};}catch(e){return {ok:false,error:String(e.message).replace(/vless:\/\/\S+/gi,'[invite]').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi,'[login]')};}
});}
function canImport(){if(manager?.session||manager?.busy)throw Error('disconnect before importing an invite');}
async function importFile(file){canImport();const text=await readFile(file,'utf8');const id=await store.add(parseProfile(text));activeId=id;emit();return id;}
await app.whenReady();
store=new ProfileStore(directory,safeStorage);
try{await store.load();}catch(e){startupError=e.message;}
manager=new SessionManager({core:process.env.NIGHTWIRE_CORE||resolve(source,'../backend',process.platform==='win32'?'windows-amd64':'darwin-arm64',process.platform==='win32'?'sing-box.exe':'sing-box'),runtime:process.execPath,worker:join(source,'worker.mjs'),directory:join(directory,'sessions'),onChange:emit});
await manager.cleanupPrevious();activeId=store.list()[0]?.id||null;
handle('state',state);
handle('import-text',async text=>{canImport();const id=await store.add(parseProfile(text));activeId=id;emit();return state();});
handle('import-file',async()=>{const choice=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'nightwire invites',extensions:['nightwire','json','txt']}]});if(!choice.canceled)await importFile(choice.filePaths[0]);return state();});
handle('select',id=>{store.get(id);if(manager.session||manager.busy)throw Error('disconnect before switching invites');activeId=id;emit();return state();});
handle('remove',async id=>{if(manager.session||manager.busy)throw Error('disconnect before removing an invite');store.get(id);await store.remove(id);if(activeId===id)activeId=store.list()[0]?.id||null;emit();return state();});
handle('export',async id=>{const profile=store.get(id);const choice=await dialog.showSaveDialog(window,{defaultPath:'my-nightwire-invite.nightwire',filters:[{name:'nightwire invite',extensions:['nightwire']}]});if(!choice.canceled)await writeFile(choice.filePath,JSON.stringify(profile,null,2),{mode:0o600});return {saved:!choice.canceled};});
handle('connect',async()=>{await manager.start(store.get(activeId));return state();});
handle('test',async()=>{await manager.start(store.get(activeId),{testOnly:true});return state();});
handle('disconnect',async()=>{await manager.stop();return state();});
session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
Menu.setApplicationMenu(Menu.buildFromTemplate(process.platform==='darwin'?[{label:'nightwire',submenu:[{role:'about',label:'about nightwire'},{type:'separator'},{role:'quit',label:'quit nightwire'}]},{label:'edit',submenu:[{role:'undo',label:'undo'},{role:'redo',label:'redo'},{type:'separator'},{role:'cut',label:'cut'},{role:'copy',label:'copy'},{role:'paste',label:'paste'},{role:'selectAll',label:'select all'}]}]:[]));
window=new BrowserWindow({width:1080,height:740,minWidth:900,minHeight:620,title:'nightwire',backgroundColor:'#152a3a',icon:join(source,'assets','icon.png'),autoHideMenuBar:true,webPreferences:{preload:join(source,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
const page=pathToFileURL(join(source,'index.html')).href;
window.webContents.on('will-navigate',(event,url)=>{if(url!==page)event.preventDefault();});window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
await window.loadFile(join(source,'index.html'));
for(const file of [...pendingFiles,...process.argv.filter(x=>x.endsWith('.nightwire'))])await importFile(file).catch(showError);
powerMonitor.on('suspend',()=>manager.stop().catch(showError));
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{if(quitting)return;event.preventDefault();manager.stop().catch(()=>{}).finally(()=>{quitting=true;app.quit();});});
