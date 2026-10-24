/**
 * Electron 主进程：创建悬浮宠物窗口，启动本地代理 + 系统监测
 *  - 鼠标穿透（动态切换：模型区域可点、透明区域穿透）
 *  - 位置记忆（拖动后保存，重启恢复）
 *  - 好感度/状态系统（饱食/心情/精力 + 好感度阶段）
 *  - AI 对话（经本地代理转发 DeepSeek，以宠物性格+状态为上下文）
 *  - 实用提醒（喝水/久坐/番茄钟）+ 系统感知（内存高/CPU高/电量低主动说话）
 *  - 自主活动开关（默认静止，右键可开启散步）
 */
'use strict';

const { app, BrowserWindow, ipcMain, screen, Menu, dialog, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const config = loadConfig();
const ProxyServer = require('./lib/proxy');
const SystemMonitor = require('./lib/system-monitor');
const stats = require('./lib/stats-store');
const PetStore = require('./lib/pet-store');

let win = null;
let proxy = null;
let monitor = null;
const pet = new PetStore();

// 专注模式：用户空闲超过阈值（默认 5 分钟）→ 宠物安静待着，减少打扰
const FOCUS_IDLE_MS = 5 * 60 * 1000;
let focusMode = false;

// 数据目录：跨平台（macOS ~/Library/Application Support/PetAgent，Windows %APPDATA%/PetAgent）
const DATA_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PetAgent')
  : path.join(os.homedir(), 'Library', 'Application Support', 'PetAgent');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 豆包任务状态桥接：豆包侧（Agent）把当前会话处理状态写入 doubao_task.json，
// 桌宠轮询该文件实时显示"豆包处理中/已完成"。
const DOUBAO_TASK_FILE = path.join(DATA_DIR, 'doubao_task.json');
let doubaoTask = null;
let lastDoubaoStatus = null;

// 心情日记：每天记录一次当日心情分（好感度 + 三状态均值），最多保留 30 天
const MOOD_FILE = path.join(DATA_DIR, 'mood.json');
function recordMood() {
  try {
    const snap = pet.snapshot();
    const states = snap.states || {};
    const moodScore = Math.round(
      (snap.affection || 0) * 0.4 +
      ((states.hunger || 0) + (states.mood || 0) + (states.energy || 0)) / 3 * 0.6
    );
    let data = {};
    try { data = JSON.parse(fs.readFileSync(MOOD_FILE, 'utf8')); } catch (_) { /* 首写 */ }
    const today = new Date().toISOString().slice(0, 10);
    data[today] = Math.max(0, Math.min(100, moodScore));
    const keys = Object.keys(data).sort();
    while (keys.length > 30) {
      const drop = keys.shift();
      delete data[drop];
    }
    fs.writeFileSync(MOOD_FILE, JSON.stringify(data, null, 2));
  } catch (_) { /* 忽略 */ }
}
setInterval(recordMood, 30 * 60 * 1000);  // 每 30 分钟记一次（同一天覆盖）
setTimeout(recordMood, 15000);            // 启动后先记一次

// 自主活动（散步）状态：窗口保持原位，由渲染层播放"宠物离开桌子散步"的精灵动画
let walkTimer = null;
let walkAnimating = false;

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch (e) {
    console.error('[main] config load failed:', e.message);
    return {};
  }
}

function broadcast(channel, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function pushFullState() {
  broadcast('state', {
    stats: stats.snapshot(),
    balance: proxy ? proxy.getBalance() : null,
    system: monitor ? monitor.snapshot() : null,
    pet: pet.snapshot(),
    proxyPort: config.proxyPort,
    apiKeyConfigured: !!(config.apiKey || process.env.DEEPSEEK_API_KEY),
    doubaoTask: doubaoTask,
    focusMode: focusMode
  });
}

/* 豆包任务状态桥接：轮询 doubao_task.json（豆包侧定时/回合写入） */
function readDoubaoTask() {
  try {
    const raw = fs.readFileSync(DOUBAO_TASK_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.status !== 'string') return;
    doubaoTask = parsed;
    // 状态变化 → 让宠物说话（completed 时播报"已完成"）
    if (lastDoubaoStatus && parsed.status !== lastDoubaoStatus) {
      const map = {
        completed: '豆包完成任务啦！✅',
        in_progress: '豆包正在处理任务中…',
        failed: '豆包任务出错了，主人看看？',
        interrupted: '豆包任务中断了～'
      };
      const text = map[parsed.status];
      if (text) broadcast('pet-say', text);
    }
    lastDoubaoStatus = parsed.status;
  } catch (e) {
    // 文件不存在或未就绪：保持上次状态
  }
}
setInterval(readDoubaoTask, 3000);

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const remembered = pet.data.windowPos;
  // 位置记忆：有则用上次位置，否则右下角
  let bx = sw - 360;
  let by = sh - 510;
  if (remembered && typeof remembered.x === 'number' && typeof remembered.y === 'number') {
    // 防止窗口跑到屏幕外
    const cx = Math.max(0, Math.min(sw - 340, remembered.x));
    const cy = Math.max(0, Math.min(sh - 480, remembered.y));
    if (cx !== remembered.x || cy !== remembered.y) {
      pet.setWindowPos({ x: cx, y: cy });
    }
    bx = cx; by = cy;
  }

  win = new BrowserWindow({
    width: 340,
    height: 480,
    x: bx,
    y: by,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    type: 'panel',
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  console.log('[main] window bounds:', JSON.stringify(win.getBounds()));
  console.log('[main] window visible:', win.isVisible());
  console.log('[main] window screen:', JSON.stringify({ width: sw, height: sh }));

  win.webContents.on('did-finish-load', () => {
    console.log('[main] did-finish-load');
    win.showInactive();
    pushFullState();
  });

  win.webContents.on('console-message', (e, level, message) => {
    console.log('[renderer]', message);
  });

  win.on('show', () => console.log('[main] window shown'));
  win.on('hide', () => console.log('[main] window hidden'));
  win.on('closed', () => { win = null; });
}

async function queryBalance() {
  if (!proxy) return null;
  const base = new URL(config.apiBase || 'https://api.deepseek.com');
  const https = require('https');
  const auth = config.apiKey ? `Bearer ${config.apiKey}` : '';
  return new Promise((resolve) => {
    const req = https.request(`${base.protocol}//${base.host}/user/balance`, {
      method: 'GET',
      headers: { Authorization: auth }
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const list = (parsed.balance_infos || []).map((b) => ({
            currency: b.currency || 'CNY',
            total: parseFloat(b.total_balance) || 0,
            granted: parseFloat(b.granted_balance) || 0,
            toppedUp: parseFloat(b.topped_up_balance) || 0
          }));
          const total = list.reduce((s, b) => s + (b.total || 0), 0);
          proxy.lastBalance = { total, list, raw: parsed, time: new Date().toISOString() };
          resolve(proxy.lastBalance);
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

/* ---------------- AI 对话（经本地代理转发） ---------------- */
function chatWithPet(userText) {
  return new Promise((resolve) => {
    if (!proxy) return resolve({ ok: false, error: '代理未就绪' });
    if (!config.apiKey && !process.env.DEEPSEEK_API_KEY) {
      return resolve({ ok: false, error: 'no-key' });
    }
    const base = new URL(config.apiBase || 'https://api.deepseek.com');
    const stage = pet.stage();
    const states = pet.snapshot().states;
    const sys = monitor ? monitor.snapshot() : {};
    const bat = sys.battery || {};
    const net = sys.network || {};
    const mem = sys.memory || {};
    const now = new Date();
    const systemPrompt =
      `你是「豆包桌宠」，一只住在用户电脑桌面上的二次元 Live2D 宠物。` +
      `当前好感度阶段：${stage.name}（${stage.desc}）。` +
      `当前状态：饱食${states.hunger}/心情${states.mood}/精力${states.energy}（满分100）。` +
      `系统信息：电池${bat.ok ? (bat.percent + '%' + (bat.charging ? '充电中' : '')) : '未知'}，` +
      `网络${net.ok ? net.rtt + 'ms' + net.grade : '未知'}，` +
      `内存占用${mem.ok ? mem.usedPct + '%' : '未知'}。` +
      `现在是${now.getMonth() + 1}月${now.getDate()}日 ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}。` +
      `请用短句（不超过3句）、活泼可爱的语气回答用户，像有性格的伙伴一样，根据状态和好感度调整亲密度，偶尔关心用户健康和休息。`;

    const body = JSON.stringify({
      model: config.chatModel || 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText }
      ],
      stream: false,
      max_tokens: 400
    });

    const req = http.request({
      host: '127.0.0.1',
      port: config.proxyPort || 8899,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = (parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content) || '';
          resolve({ ok: true, text: text.trim() });
        } catch (e) {
          resolve({ ok: false, error: '响应解析失败' });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.end(body);
  });
}

/* ---------------- 提醒 ---------------- */
let reminders = {};  // { pomodoroEnd, lastDrink, lastSit }

function startReminderLoops() {
  // 喝水提醒：每 45 分钟
  reminders.lastDrink = Date.now();
  // 久坐提醒：每 60 分钟
  reminders.lastSit = Date.now();
  setInterval(() => {
    if (Date.now() - reminders.lastDrink > 45 * 60 * 1000) {
      reminders.lastDrink = Date.now();
      broadcast('pet-say', '该喝水啦～主人！');
    }
    if (Date.now() - reminders.lastSit > 60 * 60 * 1000) {
      reminders.lastSit = Date.now();
      broadcast('pet-say', '坐了好久啦，起来活动一下吧！');
    }
  }, 60 * 1000);

  // 番茄钟结束检测
  setInterval(() => {
    if (reminders.pomodoroEnd && Date.now() >= reminders.pomodoroEnd) {
      reminders.pomodoroEnd = null;
      broadcast('pet-say', '⏰ 番茄钟结束啦，休息 5 分钟吧！');
    }
  }, 30 * 1000);
}

/* ---------------- 自主活动（散步） ----------------
 * 设计：绝不移动窗口（否则"搬着桌子左右移动"很傻）。
 * 开启后广播 walk-start → 渲染层把宠物精灵从"桌前"抽出，
 * 在窗口内做左右散步动画（桌子/Live2D 场景保持原位）。
 */
function startWalk() {
  if (walkAnimating) return;
  walkAnimating = true;
  broadcast('pet-walk-start');
  // 主进程侧仅保留心跳：若渲染层报错，不会阻塞任何功能
  clearInterval(walkTimer);
  walkTimer = setInterval(() => {
    if (!pet.data.walkEnabled) stopWalk();
  }, 3000);
}

function stopWalk() {
  if (!walkAnimating) return;
  walkAnimating = false;
  clearInterval(walkTimer);
  walkTimer = null;
  broadcast('pet-walk-stop');
}

/* ---------------- 初始化 ---------------- */
async function init() {
  proxy = new ProxyServer({
    port: config.proxyPort || 8899,
    apiBase: config.apiBase || 'https://api.deepseek.com',
    apiKey: config.apiKey || process.env.DEEPSEEK_API_KEY || ''
  });

  try {
    await proxy.start();
  } catch (e) {
    console.error('[main] proxy start failed:', e.message);
  }

  proxy.onUsage((recorded) => {
    if (recorded) {
      broadcast('usage-remind', recorded);
      // 每次问答完成也给好感度加分（陪伴）
      pet.interact('chat');
    }
    pushFullState();
  });
  stats.onUpdate(() => pushFullState());
  pet.onUpdate(() => pushFullState());

  monitor = new SystemMonitor(config.system || {});
  monitor.start();
  setInterval(() => pushFullState(), 2000);

  // 状态衰减：每 5 分钟 tick 一次
  setInterval(() => pet.tick(5 * 60 * 1000), 5 * 60 * 1000);

  // 早上首次打招呼（每天一次）
  const greetDay = () => {
    const today = new Date().toDateString();
    if (pet.data.lastGreetDay !== today) {
      pet.data.lastGreetDay = today;
      setTimeout(() => broadcast('pet-say', pet.greeting()), 3000);
    }
  };
  greetDay();
  setInterval(() => {
    // 每小时检查一次是否需要问候（跨天）
    const today = new Date().toDateString();
    if (pet.data.lastGreetDay !== today) greetDay();
  }, 3600 * 1000);

  // 系统感知：电量低 / 内存高 / CPU 高负载 / 温度高 / 网络差 → 宠物主动说话
  // 每 3 分钟轮询；分级提醒避免轰炸（同一告警 5 分钟内只提醒一次）
  const warned = {};
  const warnOnce = (key, text) => {
    const now = Date.now();
    if (warned[key] && now - warned[key] < 5 * 60 * 1000) return;
    warned[key] = now;
    broadcast('pet-say', text);
  };
  setInterval(() => {
    const sys = monitor ? monitor.snapshot() : {};
    const bat = sys.battery;
    const net = sys.network;
    const mem = sys.memory;
    const cpu = sys.cpu;
    const therm = sys.therm;
    if (bat && bat.ok && !bat.charging && bat.percent != null && bat.percent <= 20) {
      warnOnce('battery', `主人，电量只剩 ${bat.percent}% 啦，快插上电源充电！`);
    } else if (mem && mem.ok && mem.usedPct != null && mem.usedPct >= 85) {
      warnOnce('memory', `内存占用 ${mem.usedPct}% 了，有点吃力，要不要我提醒你关掉些程序？`);
    } else if (cpu && cpu.ok && cpu.avgPct != null && cpu.avgPct >= 85) {
      warnOnce('cpu', `CPU 忙到 ${cpu.avgPct}% 了，主人是不是在跑重活？注意别让它太累哦`);
    } else if (therm && therm.ok && therm.hot) {
      warnOnce('therm', `电脑好像有点烫（系统开始降频保护），注意散热，让我也喘口气～`);
    } else if (net && net.ok && net.grade === '卡顿') {
      warnOnce('network', '网络有点卡哦，要不要检查一下？');
    }
  }, 3 * 60 * 1000);

  startReminderLoops();

  // 专注模式：检测用户空闲时间（powerMonitor.getSystemIdleTime 单位秒）
  // 空闲 ≥ 5 分钟 → 进入专注模式（宠物安静）；有输入 → 退出专注并可能打声招呼
  setInterval(() => {
    const idleSec = powerMonitor.getSystemIdleTime();
    const shouldFocus = idleSec * 1000 >= FOCUS_IDLE_MS;
    if (shouldFocus !== focusMode) {
      const prev = focusMode;
      focusMode = shouldFocus;
      pushFullState();
      if (shouldFocus) {
        broadcast('pet-say', '主人专注干活呢～我在旁边安静待着，不打扰你');
      } else if (prev) {
        broadcast('pet-say', '主人回来啦！专心干活辛苦了～');
      }
    }
  }, 10 * 1000);

  // 启动后立即查一次余额
  setTimeout(async () => {
    await queryBalance();
    pushFullState();
  }, 1500);

  createWindow();

  // 散步需等窗口创建完成后再广播（渲染层已就绪）
  // 延迟 1.2s 确保 Live2D 画布挂载完成
  if (pet.data.walkEnabled) {
    setTimeout(() => startWalk(), 1200);
  }
}

app.whenReady().then(init);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  if (monitor) monitor.stop();
  if (proxy) proxy.stop();
  stopWalk();
});

// ---- IPC ----
ipcMain.handle('get-state', () => ({
  stats: stats.snapshot(),
  balance: proxy ? proxy.getBalance() : null,
  system: monitor ? monitor.snapshot() : null,
  pet: pet.snapshot(),
  proxyPort: config.proxyPort,
  apiKeyConfigured: !!(config.apiKey || process.env.DEEPSEEK_API_KEY),
  doubaoTask: doubaoTask,
  focusMode: focusMode
}));

ipcMain.handle('refresh-balance', async () => {
  const b = await queryBalance();
  pushFullState();
  return b;
});

ipcMain.handle('quit-app', () => app.quit());

// 拖文件给宠物吃：把文件移到系统废纸篓（可恢复，非永久删除）
ipcMain.handle('trash-files', async (e, paths) => {
  if (!Array.isArray(paths)) return { ok: false, error: 'empty' };
  const done = [];
  const failed = [];
  for (const p of paths) {
    if (!p || typeof p !== 'string') { failed.push(p); continue; }
    try {
      if (process.platform === 'win32') {
        // Windows：PowerShell 送回收站
        await new Promise((res) => {
          const ps = [
            '-NoProfile', '-NonInteractive', '-Command',
            `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${p.replace(/'/g, "''")}', 'OnlyErrorDialogs', 'SendToRecycleBin')`
          ];
          const cp = require('child_process').execFile('powershell.exe', ps, { timeout: 10000, windowsHide: true }, (err) => res(!err));
        });
        done.push(p);
      } else {
        const trashDir = path.join(os.homedir(), '.Trash');
        const name = path.basename(p);
        let dest = path.join(trashDir, name);
        // 重名时加序号，避免覆盖
        let i = 1;
        while (fs.existsSync(dest)) {
          dest = path.join(trashDir, `${path.basename(name, path.extname(name))} ${i}${path.extname(name)}`);
          i++;
        }
        fs.renameSync(p, dest);
        done.push(dest);
      }
    } catch (err) {
      failed.push(p);
    }
  }
  if (done.length) broadcast('pet-say', done.length === 1 ? '嗷呜～文件被我吃掉啦（已移到废纸篓）' : `嗷呜～${done.length} 个文件被我吃掉啦（已移到废纸篓）`);
  return { ok: failed.length === 0, done, failed };
});

// 宠物被点击/互动 → 好感度小幅增长
ipcMain.on('pet-interact', () => {
  pet.interact('click');
});

// 喂食 / 抚摸 / 陪玩
ipcMain.on('pet-feed', () => {
  pet.feed();
  win.webContents.send('pet-feed-do');   // 渲染层播放吃动画+音效
  broadcast('pet-say', pet.stage().name === '黏人' ? '好吃！最喜欢主人投喂啦！' : '谢谢主人，好吃！');
});
ipcMain.on('pet-pet-head', () => {
  pet.petHead();
  win.webContents.send('pet-pet-head-do');   // 渲染层播放摸头动画+音效
  broadcast('pet-say', pet.stage().name === '黏人' ? '喵～被摸头好舒服' : '嘿嘿，被摸头了');
});
ipcMain.on('pet-play', () => {
  pet.play();
  win.webContents.send('pet-play-do');   // 渲染层播放陪玩动画+音效
  broadcast('pet-say', '玩得好开心！');
});

// AI 对话
ipcMain.handle('pet-chat', async (e, text) => {
  if (!text || !text.trim()) return { ok: false, error: 'empty' };
  const result = await chatWithPet(text);
  if (result.ok) {
    pet.interact('chat');
    pushFullState();
  }
  return result;
});

// 右键菜单
ipcMain.on('show-context-menu', (e) => {
  if (!win || win.isDestroyed()) return;
  const walkLabel = pet.data.walkEnabled ? '保持静止（关散步）' : '开启散步';
  const menu = Menu.buildFromTemplate([
    {
      label: '和豆包聊天…',
      click: () => {
        console.log('[main] menu: open chat');
        win.webContents.send('pet-chat-open');
      }
    },
    {
      label: '关闭聊天窗',
      click: () => {
        console.log('[main] menu: close chat');
        win.webContents.send('pet-chat-close');
      }
    },
    { type: 'separator' },
    {
      label: '喂食',
      click: () => {
        pet.feed();
        broadcast('pet-say', pet.stage().name === '黏人' ? '好吃！最喜欢主人投喂啦！' : '谢谢主人，好吃！');
        win.webContents.send('pet-feed-do');
      }
    },
    {
      label: '摸头',
      click: () => {
        pet.petHead();
        broadcast('pet-say', pet.stage().name === '黏人' ? '喵～被摸头好舒服' : '嘿嘿，被摸头了');
        win.webContents.send('pet-pet-head-do');
      }
    },
    {
      label: '陪玩',
      click: () => {
        pet.play();
        broadcast('pet-say', '玩得好开心！');
        win.webContents.send('pet-play-do');
      }
    },
    { type: 'separator' },
    {
      label: walkLabel,
      click: () => {
        pet.setWalk(!pet.data.walkEnabled);
        if (pet.data.walkEnabled) startWalk();
        else stopWalk();
        broadcast('pet-say', pet.data.walkEnabled ? '好呀，我去散散步～' : '好，我安静待着');
      }
    },
    {
      label: '番茄钟 25 分钟',
      click: () => {
        reminders.pomodoroEnd = Date.now() + 25 * 60 * 1000;
        broadcast('pet-say', '⏰ 专注模式开始！25 分钟后我提醒你休息');
      }
    },
    {
      label: '讲个笑话',
      click: () => {
        const jokes = [
          '为什么程序员总分不清万圣节和圣诞节？因为 Oct 31 == Dec 25。',
          '我讲个冷笑话：有一天，孙悟空问唐僧："师父，我饿了。"唐僧说："悟空，你饿了吗？"悟空说："饿。"唐僧说："那我们吃饭吧。"——你笑了吗？',
          '为什么桌子腿断了一条还能站住？因为它习惯了…（对不起，我刚断过腿）',
          '为什么宠物不能上月球？因为那边没有猫粮卖。',
          '我昨天给自己定了个小目标：今天一定要早睡。然后…然后就没有然后了。',
          '为什么 Wi-Fi 最怕下雨？因为 5G（5个G）连不上！',
          '我问电脑："你为什么这么慢？"它说："我在思考人生。"',
          '老板：你迟到了！我：我梦见自己迟到了，吓醒了，然后又睡回去了…'
        ];
        broadcast('pet-say', jokes[Math.floor(Math.random() * jokes.length)]);
      }
    },
    {
      label: '心情日记',
      click: () => {
        try {
          const data = JSON.parse(fs.readFileSync(MOOD_FILE, 'utf8'));
          const keys = Object.keys(data).sort();
          if (!keys.length) {
            broadcast('pet-say', '我还没有心情日记呢，多陪陪我吧～');
            return;
          }
          const recent = keys.slice(-7);
          const labels = recent.map((k) => k.slice(5)).join(' / ');
          const vals = recent.map((k) => data[k]);
          const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
          broadcast('pet-say', `近7天心情：${labels}\n分数：${vals.join(', ')}\n平均 ${avg} 分${avg >= 80 ? '，超开心！' : avg >= 60 ? '，还不错～' : '，要多陪陪我哦'}`);
        } catch (_) {
          broadcast('pet-say', '我还没有心情日记呢，多陪陪我吧～');
        }
      }
    },
    { type: 'separator' },
    {
      label: '刷新余额',
      click: async () => {
        await queryBalance();
        pushFullState();
      }
    },
    {
      label: '豆包桌宠 · 关于',
      click: () => {
        const p = pet.snapshot();
        win.webContents.send('pet-say', `我是豆包桌宠！好感度 ${p.affection}（${p.stage.name}）· 今天投喂 ${p.feedCount} 次 · 聊天 ${p.chatCount} 次`);
      }
    },
    { type: 'separator' },
    {
      label: '退出桌宠',
      click: () => app.quit()
    }
  ]);
  menu.popup({ window: win });
});

// 拖动 + 位置记忆（修复：统一使用"窗口内偏移"作为拖动锚点，
// 不再混用 clientX/screenX 两套坐标系导致跳位）
let dragStartScreen = null;
let dragStartWin = null;
ipcMain.on('drag-start', (e, offset) => {
  dragStartScreen = offset.screen;
  dragStartWin = offset.win;
  win.setIgnoreMouseEvents(false);
});
ipcMain.on('drag-move', (e, screenPos) => {
  if (!win || !dragStartScreen || !dragStartWin) return;
  const [sx, sy] = screenPos;
  const nx = dragStartWin.x + (sx - dragStartScreen.x);
  const ny = dragStartWin.y + (sy - dragStartScreen.y);
  win.setPosition(Math.round(nx), Math.round(ny));
});
ipcMain.on('drag-end', () => {
  dragStartScreen = null;
  dragStartWin = null;
  // 位置记忆
  if (win && !win.isDestroyed()) {
    const b = win.getBounds();
    pet.setWindowPos({ x: b.x, y: b.y });
  }
});

// 鼠标穿透：渲染层根据鼠标是否在可交互元素上动态切换
ipcMain.on('set-ignore-mouse', (e, ignore) => {
  if (!win || win.isDestroyed()) return;
  if (ignore && dragStartScreen) return;  // 拖动中不穿透
  console.log('[main] set-ignore-mouse:', ignore);
  win.setIgnoreMouseEvents(!!ignore, { forward: true });
});
