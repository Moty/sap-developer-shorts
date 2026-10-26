const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  state: () => ipcRenderer.invoke("desktop:state"),
  action: (input) => ipcRenderer.invoke("desktop:action", input),
  openOnlineStudio: (origin) => ipcRenderer.invoke("desktop:online", origin),
  openStudio: () => ipcRenderer.invoke("desktop:studio"),
  showFiles: () => ipcRenderer.invoke("desktop:files"),
  subscribe: (listener) => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on("desktop:state", handler);
    return () => ipcRenderer.removeListener("desktop:state", handler);
  },
});
