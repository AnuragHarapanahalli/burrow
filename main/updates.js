// Updates from GitHub Releases (electron-updater). Only in the installed app: Burrow checks on launch
// and every 6 hours, downloads quietly, then Mochi says "Update ready". Restarting installs it.
// (While developing — npm start — and in the portable .exe there's nothing to update.)
const { app } = require('electron');

const EVERY_MS = 6 * 3600e3;

class Updates {
  /** h: { onState(state) } — state: { status, version, error } */
  constructor(h) {
    this.h = h;
    this.state = { status: app.isPackaged ? 'idle' : 'dev', version: null, current: app.getVersion() };
    this.updater = null;
    if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) {
      if (process.env.PORTABLE_EXECUTABLE_DIR) this.state.status = 'portable';
      return;
    }
    try {
      this.updater = require('electron-updater').autoUpdater;
    } catch { this.state.status = 'dev'; return; }
    const u = this.updater;
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.on('checking-for-update', () => this.set({ status: 'checking' }));
    u.on('update-not-available', () => this.set({ status: 'latest' }));
    u.on('update-available', (info) => this.set({ status: 'downloading', version: info?.version || null }));
    u.on('update-downloaded', (info) => this.set({ status: 'ready', version: info?.version || this.state.version }));
    u.on('error', (err) => this.failed(err));
    setTimeout(() => this.check(), 15000);
    setInterval(() => this.check(), EVERY_MS);
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.h.onState(this.state);
  }

  check() {
    if (!this.updater) return this.state;
    this.updater.checkForUpdates().catch((err) => this.failed(err));
    return this.state;
  }

  // No release published yet (GitHub answers 404 / "no published versions") means you're up to date.
  failed(err) {
    const msg = String(err?.message || err);
    if (/404|no published versions|unable to find latest version/i.test(msg)) this.set({ status: 'latest', error: null });
    else this.set({ status: 'error', error: msg.slice(0, 200) });
  }

  install() {
    if (this.updater && this.state.status === 'ready') this.updater.quitAndInstall();
  }
}

module.exports = { Updates };
