const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 420,
    minHeight: 640,
    backgroundColor: '#eef6f1',
    title: 'GuideEye',
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    }
  });

  win.loadFile(path.join(__dirname, '..', 'web', 'app.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) { event.preventDefault(); shell.openExternal(url); }
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    try {
      const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
      app.dock.setIcon(iconPath);
    } catch (_) {}
  }
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

