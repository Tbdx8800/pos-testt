const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const url = require('url');

// Simple HTTP server to serve files (fixes relative path issues)
function startLocalServer() {
  const server = http.createServer((req, res) => {
    let filePath;
    
    // Root request should serve pos/index.html
    if (req.url === '/' || req.url === '') {
      filePath = path.join(__dirname, 'pos', 'index.html');
    } else {
      // For other requests, try to serve from the pos directory first
      // This ensures relative paths from pos/index.html work correctly
      let requestPath = req.url.split('?')[0]; // Remove query string
      
      // Check if file exists in pos directory
      let possiblePath = path.join(__dirname, 'pos', requestPath);
      if (fs.existsSync(possiblePath)) {
        filePath = possiblePath;
      } else {
        // Otherwise try from root
        filePath = path.join(__dirname, requestPath);
      }
    }
    
    // Security: prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(path.normalize(__dirname))) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found: ' + filePath);
        return;
      }

      // Set correct MIME types
      let contentType = 'text/plain';
      const ext = path.extname(filePath);
      if (ext === '.html') contentType = 'text/html; charset=utf-8';
      else if (ext === '.css') contentType = 'text/css';
      else if (ext === '.js') contentType = 'application/javascript';
      else if (ext === '.json') contentType = 'application/json';
      else if (ext === '.svg') contentType = 'image/svg+xml';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.gif') contentType = 'image/gif';
      else if (ext === '.webp') contentType = 'image/webp';
      else if (ext === '.woff') contentType = 'font/woff';
      else if (ext === '.woff2') contentType = 'font/woff2';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });

  server.listen(3000, () => {
    console.log('Local server running on http://localhost:3000');
  });

  return server;
}

let localServer;

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Load from local HTTP server instead of file:// protocol
  win.loadURL('http://localhost:3000');

  // Open DevTools to debug any issues (comment out for production)
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  localServer = startLocalServer();
  
  // Wait a bit for server to start
  setTimeout(() => {
    createMainWindow();
  }, 100);

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', function () {
  // Close the local server
  if (localServer) {
    localServer.close();
  }
  if (process.platform !== 'darwin') app.quit();
});

// IPC: print silently using a hidden BrowserWindow
ipcMain.handle('print-silent', async (event, { html, options }) => {
  return new Promise((resolve) => {
    try {
      // Create window sized for 80mm thermal printer (approx 300px width, flexible height)
      const printWin = new BrowserWindow({ 
        show: false, 
        width: 350, 
        height: 1200,
        webPreferences: { 
          offscreen: false,
          contextIsolation: false,
          nodeIntegration: false
        } 
      });
      
      // Load HTML and wait for it to render
      printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      
      printWin.webContents.on('did-finish-load', () => {
        // Wait longer for all content to render
        setTimeout(() => {
          // Get document size
          printWin.webContents.executeJavaScript(`
            document.body.scrollHeight;
          `).then(height => {
            // Resize window to fit content
            if (height && height > 0) {
              printWin.setContentSize(350, Math.ceil(height) + 20);
            }
            
            // Print with appropriate options for thermal printer
            const printOptions = {
              silent: true,
              printBackground: true,
              color: false,
              margin: {
                marginType: 'none'
              },
              pageSize: 'A6',
              landscape: false
            };
            
            // If printer name is specified, use it
            if (options && options.printerName) {
              printOptions.deviceName = options.printerName;
            }
            
            printWin.webContents.print(printOptions, (success, errorType) => {
              try { printWin.close(); } catch (e) {}
              resolve({ success: !!success, errorType: errorType || null });
            });
          }).catch(err => {
            // Fallback if executeJavaScript fails
            printWin.webContents.print({ silent: true, printBackground: true }, (success, errorType) => {
              try { printWin.close(); } catch (e) {}
              resolve({ success: !!success, errorType: errorType || null });
            });
          });
        }, 500);
      });
      
      // Safety timeout
      setTimeout(() => {
        try { printWin.close(); } catch (e) {}
        resolve({ success: false, errorType: 'timeout' });
      }, 10000);
    } catch (err) {
      resolve({ success: false, errorType: String(err) });
    }
  });
});
