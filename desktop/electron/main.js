const { app, BrowserWindow, shell, dialog } = require('electron')
const { spawn, spawnSync } = require('child_process')
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 8686
const URL = `http://127.0.0.1:${PORT}`

// 开发模式:desktop/electron/main.js → 项目根在上两级;打包后:资源目录
const isPackaged = app.isPackaged
const RES = isPackaged
  ? process.resourcesPath
  : path.resolve(__dirname, '..', '..')

const APP_DIR = isPackaged ? path.join(RES, 'paperloom') : RES
const LOG_FILE = path.join(APP_DIR, 'data', 'backend.log')

let pyProc = null
let weSpawned = false
let win = null

/** 后端日志追加一行(启动失败时靠它定位) */
function appendLog(line) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8')
  } catch {}
}

function tailLog(n = 12) {
  try {
    return fs
      .readFileSync(LOG_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(-n)
      .join('\n')
  } catch {
    return '(没有日志)'
  }
}

function serverUp() {
  return new Promise((resolve) => {
    const req = http.get(
      `${URL}/api/docs`,
      { timeout: 1500 },
      (res) => {
        resolve(res.statusCode === 200)
        req.destroy()
      },
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

function pythonTarget() {
  if (isPackaged) {
    return {
      exe: path.join(RES, 'runtime', 'python', 'python.exe'),
      env: { PYTHONPATH: path.join(RES, 'site-packages') },
      cwd: APP_DIR,
    }
  }
  return {
    exe: path.join(RES, '.venv', 'Scripts', 'python.exe'),
    env: {},
    cwd: RES,
  }
}

/** 内置 Python 到底能不能跑?跑不起来就别干等 120 秒了。
 *  虚拟机里最常见的失败是缺运行库/被安全软件拦截,这里直接把原始报错带出来。 */
function probePython(exe) {
  if (!fs.existsSync(exe)) return `找不到 Python 运行时:\n${exe}`
  const r = spawnSync(exe, ['-c', 'import sys;print(sys.version)'], {
    timeout: 20000,
    encoding: 'utf-8',
    windowsHide: true,
  })
  if (r.error) return `无法启动 ${exe}\n${r.error.message}`
  if (r.status !== 0) {
    return `Python 启动失败(退出码 ${r.status}):\n${(r.stderr || '').trim() || '(无输出)'}`
  }
  return null
}

async function ensureServer() {
  if (await serverUp()) return true
  const { exe, env, cwd } = pythonTarget()

  const bad = probePython(exe)
  if (bad) {
    appendLog(`[preflight failed] ${bad}`)
    dialog.showErrorBox('PaperLoom 启动失败', `${bad}\n\n日志:${LOG_FILE}`)
    return false
  }

  fs.mkdirSync(path.join(APP_DIR, 'data'), { recursive: true })
  appendLog(`\n===== ${new Date().toISOString()} 启动后端 =====`)
  appendLog(`exe=${exe}\ncwd=${cwd}`)

  const out = fs.openSync(LOG_FILE, 'a')
  pyProc = spawn(
    exe,
    ['-X', 'utf8', '-m', 'uvicorn', 'server.app:app', '--host', '127.0.0.1', '--port', String(PORT)],
    {
      cwd,
      env: { ...process.env, ...env, PYTHONUTF8: '1' },
      windowsHide: true,
      stdio: ['ignore', out, out], // 后端输出落盘,超时才有东西可查
    },
  )
  weSpawned = true
  pyProc.on('error', (e) => appendLog(`[spawn error] ${e.message}`))
  pyProc.on('exit', (code) => {
    pyProc = null
    appendLog(`[exit] code=${code}`)
  })

  for (let i = 0; i < 240; i++) {
    if (await serverUp()) return true
    if (pyProc === null) break // 进程已经退了,不用再等
    await new Promise((r) => setTimeout(r, 500))
  }

  const detail = tailLog(14)
  appendLog('[timeout] 后端未就绪')
  const choice = dialog.showMessageBoxSync({
    type: 'error',
    title: 'PaperLoom 启动失败',
    message: '后端在 120 秒内没有就绪。',
    detail:
      `Python:${exe}\n目录:${cwd}\n日志:${LOG_FILE}\n\n` +
      `—— 最后几行 ——\n${detail}\n\n` +
      `若这是首次启动,可能被安全软件扫描拖慢,点「重试」通常就好了。`,
    buttons: ['重试', '退出'],
    defaultId: 0,
    cancelId: 1,
  })
  if (choice === 0) return ensureServer()
  return false
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    title: 'PaperLoom · 织译',
    icon: path.join(__dirname, 'paperloom.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#f8f9fb',
    show: false,
    webPreferences: { contextIsolation: true },
  })
  win.loadURL(URL)
  win.once('ready-to-show', () => win.show())
  // 界面里的 target=_blank(独立 HTML 导出等)交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('closed', () => {
    win = null
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.whenReady().then(async () => {
    const ok = await ensureServer()
    if (ok) createWindow()
    else app.quit()
  })
  app.on('window-all-closed', () => {
    if (pyProc && weSpawned) {
      try {
        pyProc.kill()
      } catch {}
    }
    app.quit()
  })
}
