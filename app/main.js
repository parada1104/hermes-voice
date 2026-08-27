/**
 * Hermes Voice — App nativa (Electron)
 *
 * UI de escritorio: tabs (uno por agent/sesión) que son un PTY real por debajo
 * (modelo Orca/Codex), con un chat encima y UX de voz. Habla con el daemon
 * conector (localhost:8471).
 *
 * MVP: 1 tab (Hermes voice) + chat + botón de voz (envía audio al daemon,
 * reproduce la respuesta).
 */

const { app, BrowserWindow, globalShortcut, ipcMain, dialog } = require('electron')
const path = require('path')

let win

ipcMain.handle('choose-working-directory', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? '' : (result.filePaths[0] || '')
})

function toggleGlobalPtt() {
  if (win && !win.isDestroyed()) win.webContents.send('global-ptt-toggle')
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 720,
    title: 'Hermes Voice — Codex lite',
    backgroundColor: '#0f1115',
    webPreferences: { enableESM: true, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  win.loadFile(path.join(__dirname, 'ui', 'index.html'))
}

app.whenReady().then(() => {
  createWindow()
  const registered = globalShortcut.register('Alt+Space', toggleGlobalPtt)
  console.log(`[hermes-voice] global PTT Alt+Space: ${registered ? 'registered' : 'unavailable'}`)
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('window-all-closed', () => app.quit())
})