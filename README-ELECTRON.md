Electron scaffold for RealPhone POS

Quick start (development)

1. Install dependencies:

```bash
npm install
```

2. Run the app (opens POS inside Electron):

```bash
npm start
```

Behavior
- The Electron main process loads `pos/index.html` and exposes a secure `window.electronAPI.printSilent(html)` method to renderer code.
- When running inside Electron, the POS will attempt to print silently via `webContents.print({silent:true})`.
- When not inside Electron (regular browser), the system falls back to opening a print preview window.

Notes
- Electron must be installed locally (`npm install`) which will download a Chromium binary.
- To produce installers use `electron-builder` or similar (not included in this scaffold).
