// The only bridge the web UI gets: app updates and links the OS hands a running app.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("froggNextDesktop", {
  updates: {
    get: () => ipcRenderer.invoke("frogg-next:update-get"),
    check: () => ipcRenderer.invoke("frogg-next:update-check"),
    download: () => ipcRenderer.invoke("frogg-next:update-download"),
    install: () => ipcRenderer.invoke("frogg-next:update-install"),
    onState(listener) {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on("frogg-next:update-state", handler);
      return () => ipcRenderer.removeListener("frogg-next:update-state", handler);
    },
  },
  onOpenUrl(listener) {
    const handler = (_event, url) => listener(url);
    ipcRenderer.on("frogg-next:open-url", handler);
    return () => ipcRenderer.removeListener("frogg-next:open-url", handler);
  },
});
