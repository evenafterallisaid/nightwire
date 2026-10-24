const {contextBridge,ipcRenderer}=require('electron');
const channels=new Set(['state','import-text','import-file','select','remove','export','connect','test','disconnect']);
contextBridge.exposeInMainWorld('nightwire',{invoke:(channel,...args)=>{if(!channels.has(channel))return Promise.reject(Error('unknown request'));return ipcRenderer.invoke(channel,...args);},subscribe:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('state-changed',listener);return ()=>ipcRenderer.removeListener('state-changed',listener);}});
