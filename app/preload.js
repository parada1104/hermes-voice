const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hermesNative', {
  onGlobalPttToggle(callback) {
    ipcRenderer.on('global-ptt-toggle', () => callback())
  },
  chooseWorkingDirectory() {
    return ipcRenderer.invoke('choose-working-directory')
  },
})
