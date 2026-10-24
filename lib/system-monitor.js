/**
 * 系统监测：电池充电状态 + 网络流畅度 + 内存/CPU + 温度（降频指标）
 *  - 电池：macOS pmset -g batt / Windows WMI Win32_Battery（PowerShell）
 *  - 网络：对多个目标做 TCP 握手延迟测量，计算平均 RTT 与"流畅度"评级（跨平台）
 *  - CPU：macOS loadavg/核数；Windows WMI Processor LoadPercentage
 *  - 温度：macOS pmset therm CPU_Speed_Limit；Windows 无通用指标，降级
 *  - 前台应用：active-win（macOS/Windows 均免权限）
 *  - 天气：ipwho.is 定位 → open-meteo 实时天气（失败静默降级）
 */
'use strict';

const { execFile } = require('child_process');
const net = require('net');
const https = require('https');
const http = require('http');
// active-win 是原生模块（平台相关）：跨平台打包时若 .node 不匹配，降级为不可用
let getOpenWindows = null;
try {
  const aw = require('active-win');
  getOpenWindows = (aw.getOpenWindows || (aw.default && aw.default.getOpenWindows) || aw.activeWindow);
} catch (_) {
  getOpenWindows = null;
}

const IS_WIN = process.platform === 'win32';

/* macOS 辅助功能权限探测。
 * active-win 在 macOS 读取前台应用需要"辅助功能"授权；未授权时系统会
 * 在每次调用时弹授权窗。若继续每 5 秒轮询，用户拒绝后会无限反复弹窗。
 * 因此：未授权 → 直接禁用前台应用监测（frontApp=null，场景台词降级）。 */
let accessibilityGranted = true;
let accessibilityChecked = false;
try {
  if (process.platform === 'darwin') {
    const { systemPreferences } = require('electron');
    // isTrustedAccessibilityClient(false) 仅查询不弹窗
    accessibilityGranted = systemPreferences.isTrustedAccessibilityClient(false);
    accessibilityChecked = true;
  }
} catch (_) { /* 非 Electron 或探测失败：默认放行 */ }

/* Windows 统一走 PowerShell 读 WMI，返回 JSON 或 null */
function winCim(query, cb) {
  const ps = [
    '-NoProfile', '-NonInteractive', '-Command',
    `try { ${query} | ConvertTo-Json -Compress } catch { '{}' }`
  ];
  execFile('powershell.exe', ps, { timeout: 8000, windowsHide: true }, (err, stdout) => {
    if (err) return cb(null);
    try { cb(JSON.parse(stdout.toString().trim())); }
    catch (_) { cb(null); }
  });
}

class SystemMonitor {
  constructor(config) {
    this.cfg = config || {};
    this.battery = null;
    this.network = null;
    this.frontApp = null;
    this.weather = null;
    this._timers = [];
  }

  start() {
    this._runBattery();
    this._runNetwork();
    this._runMemCpu();
    this._runTherm();
    // 前台应用监测：macOS 未授予辅助功能权限时禁用，避免系统反复弹授权窗
    if (accessibilityChecked && !accessibilityGranted) {
      this.frontApp = null;
      this.frontAppDisabled = true;
    } else {
      this._runFrontApp();
      this._timers.push(setInterval(() => this._runFrontApp(), 5000));
    }
    this._runWeather();
    this._timers.push(setInterval(() => this._runBattery(), (this.cfg.batteryIntervalSec || 10) * 1000));
    this._timers.push(setInterval(() => this._runNetwork(), (this.cfg.networkIntervalSec || 10) * 1000));
    this._timers.push(setInterval(() => this._runMemCpu(), (this.cfg.memCpuIntervalSec || 6) * 1000));
    this._timers.push(setInterval(() => this._runTherm(), (this.cfg.thermIntervalSec || 20) * 1000));
    this._timers.push(setInterval(() => this._runWeather(), 10 * 60 * 1000));
  }

  stop() {
    for (const t of this._timers) clearInterval(t);
    this._timers = [];
  }

  snapshot() {
    return { battery: this.battery, network: this.network, memory: this.memory, cpu: this.cpu, therm: this.therm, frontApp: this.frontApp, frontAppDisabled: this.frontAppDisabled, weather: this.weather };
  }

  /* 前台应用（active-win 原生 API）
     注意：macOS 上读取其他应用窗口列表需要"辅助功能"权限，未授权会反复弹系统授权窗，
     因此启动时探测（accessibilityGranted），未授权则禁用本功能（场景台词降级为时间问候）。 */
  async _runFrontApp() {
    if (process.env.PET_DISABLE_FRONTAPP === '1') { this.frontApp = null; return; }
    if (!getOpenWindows) { this.frontApp = null; return; }
    try {
      const windows = await getOpenWindows();
      for (const w of windows || []) {
        const owner = (w && w.owner) || {};
        const name = owner.name || '';
        const bundleId = owner.bundleId || '';
        // 过滤：桌宠自身（开发 com.github.Electron / 打包 com.doubao.petagent / 豆包桌宠.exe）
        if (bundleId === 'com.doubao.petagent' || bundleId === 'com.github.Electron') continue;
        if (name.includes('豆包桌宠') || name.toLowerCase().includes('petagent')) continue;
        // 系统 UI
        if (name.includes('通知中心') || bundleId === 'com.apple.notificationcenterui') continue;
        if (IS_WIN && ['explorer.exe', 'dwm.exe', 'shellexperiencehost.exe', 'searchapp.exe'].includes(name.toLowerCase())) continue;
        if (!name) continue;
        this.frontApp = { name, bundleId, time: Date.now() };
        return;
      }
      this.frontApp = null;
    } catch (_) {
      this.frontApp = null;
    }
  }

  /* 天气：ipwho.is 定位 → open-meteo 实时天气 */
  _runWeather() {
    httpGet('http://ipwho.is/', 6000, (geoErr, geoText) => {
      if (geoErr) return;
      try {
        const geo = JSON.parse(geoText);
        if (!geo.success && !geo.latitude) return;
        const lat = geo.latitude, lon = geo.longitude;
        const city = geo.city || '';
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
        httpGet(url, 8000, (wErr, wText) => {
          if (wErr) return;
          try {
            const w = JSON.parse(wText);
            const cur = w.current || {};
            const tempC = cur.temperature_2m;
            const code = cur.weather_code;
            this.weather = {
              ok: tempC != null,
              city,
              tempC: tempC != null ? Math.round(tempC) : null,
              code: code != null ? code : null,
              desc: code != null ? wmoDesc(code) : '',
              time: Date.now()
            };
          } catch (_) { /* 忽略解析失败 */ }
        });
      } catch (_) { /* 忽略 */ }
    });
  }

  _runTherm() {
    if (IS_WIN) {
      // Windows 无通用 CPU 温度 WMI，标记降级
      this.therm = { ok: false, error: 'Windows 无通用温度指标' };
      return;
    }
    // pmset -g therm 输出形如: CPU_Speed_Limit = 100
    execFile('/usr/bin/pmset', ['-g', 'therm'], { timeout: 5000 }, (err, stdout) => {
      if (err) { this.therm = { ok: false }; return; }
      const text = stdout.toString();
      const m = text.match(/CPU_Speed_Limit\s*=\s*(\d+)/);
      const limit = m ? parseInt(m[1], 10) : null;
      this.therm = {
        ok: limit != null,
        speedLimit: limit,
        hot: limit != null && limit < 90,   // 系统降频说明机身偏热
        time: Date.now()
      };
    });
  }

  _runMemCpu() {
    if (IS_WIN) {
      // Windows：WMI 内存 + CPU
      winCim('Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize', (os) => {
        if (os && os.FreePhysicalMemory != null) {
          const freeKb = Number(os.FreePhysicalMemory);
          const totalKb = Number(os.TotalVisibleMemorySize);
          const usedPct = totalKb > 0 ? Math.round((1 - freeKb / totalKb) * 100) : null;
          this.memory = { ok: usedPct != null, usedPct, freeBytes: freeKb * 1024, totalBytes: totalKb * 1024, time: Date.now() };
        } else {
          this.memory = { ok: false };
        }
      });
      winCim('Get-CimInstance Win32_Processor | Select-Object LoadPercentage,NumberOfCores', (cpu) => {
        if (cpu && cpu.LoadPercentage != null) {
          this.cpu = {
            ok: true,
            avgPct: Math.round(Number(cpu.LoadPercentage)),
            load1: Number(cpu.LoadPercentage),
            cores: Number(cpu.NumberOfCores) || 1,
            time: Date.now()
          };
        } else {
          this.cpu = { ok: false };
        }
      });
      // 占用最高的进程（Windows：按 CPU 时间采样两次太繁琐，用当前进程 CPU 简单展示）
      winCim('Get-Process | Sort-Object CPU -Descending | Select-Object -First 1 ProcessName,CPU', (p) => {
        if (p && p.ProcessName && this.cpu) { this.cpu.topProc = p.ProcessName; this.cpu.topPct = Math.round(Number(p.CPU) || 0); }
      });
      return;
    }
    // 内存压力与占用（macOS）
    execFile('/usr/bin/vm_stat', [], { timeout: 5000 }, (err, stdout) => {
      if (err) { this.memory = { ok: false }; return; }
      const text = stdout.toString();
      const pageSize = 4096;
      const num = (k) => {
        const m = text.match(new RegExp(k + ':\\s+([0-9]+)'));
        return m ? parseInt(m[1], 10) : 0;
      };
      const free = num('Pages free');
      const active = num('Pages active');
      const inactive = num('Pages inactive');
      const wired = num('Pages wired down');
      const compressed = num('Pages occupied by compressor');
      const totalUsed = active + wired + compressed;
      const total = totalUsed + free + inactive;
      const usedPct = total > 0 ? Math.round((totalUsed / total) * 100) : null;
      this.memory = { ok: true, usedPct, freeBytes: free * pageSize, totalBytes: total * pageSize, time: Date.now() };
    });
    // CPU 负载：loadavg(1min) / 核心数 → 百分比；另取占用最高进程
    execFile('/usr/sbin/sysctl', ['vm.loadavg', 'hw.ncpu'], { timeout: 5000 }, (err, stdout) => {
      if (err) { this.cpu = { ok: false }; return; }
      const text = stdout.toString();
      const lm = text.match(/loadavg:\s*\{?\s*([\d.]+)/);
      const cm = text.match(/hw\.ncpu:\s*(\d+)/);
      const load1 = lm ? parseFloat(lm[1]) : NaN;
      const cores = cm ? parseInt(cm[1], 10) : 1;
      const loadPct = !isNaN(load1) ? Math.round((load1 / Math.max(cores, 1)) * 100) : null;
      this.cpu = {
        ok: loadPct != null,
        avgPct: loadPct,
        load1,
        cores,
        time: Date.now()
      };
    });
    // 占用最高的进程（供面板展示）
    execFile('/bin/ps', ['-A', '-o', '%cpu', '-o', 'comm='], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return;
      const lines = stdout.toString().split('\n').filter(Boolean);
      let max = 0, maxName = '';
      for (const line of lines) {
        const m = line.match(/^\s*([\d.]+)\s+(.+)$/);
        if (!m) continue;
        const v = parseFloat(m[1]);
        if (isNaN(v)) continue;
        if (v > max) { max = v; maxName = m[2].trim(); }
      }
      if (this.cpu) { this.cpu.topProc = maxName; this.cpu.topPct = max; }
    });
  }

  _runBattery() {
    if (IS_WIN) {
      // Windows WMI：EstimatedChargeRemaining=剩余%，BatteryStatus: 1=放电 2=充电 3=充满
      winCim('Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus', (b) => {
        if (b && b.EstimatedChargeRemaining != null) {
          const pct = Math.round(Number(b.EstimatedChargeRemaining));
          const st = Number(b.BatteryStatus);
          const charging = st === 2 || st === 3;
          const acPower = st === 2 || st === 3;
          this.battery = { ok: true, percent: pct, charging, acPower, source: 'WMI Win32_Battery', time: Date.now() };
        } else {
          this.battery = { ok: false, error: 'WMI 电池不可用' };
        }
      });
      return;
    }
    execFile('/usr/bin/pmset', ['-g', 'batt'], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        this.battery = { ok: false, error: 'pmset 不可用' };
        return;
      }
      const text = stdout.toString();
      // 示例: "Now drawing from 'AC Power'\n -InternalBattery-0 (id=4732506)	100%; charged; 0:00:00 remaining present: true"
      let pct = null;
      let charging = null;
      let acPower = /'AC Power'/.test(text);
      const m = text.match(/(\d+)%;/);
      if (m) pct = parseInt(m[1], 10);
      if (text.includes('charged')) charging = false;
      else if (text.includes('discharging')) charging = false;
      else if (text.includes('charging')) charging = true;
      else charging = acPower ? false : null;
      if (acPower && pct === 100) charging = false;
      this.battery = {
        ok: true,
        percent: pct,
        charging,
        acPower,
        source: text.trim().split('\n')[0] || '',
        time: Date.now()
      };
    });
  }

  _measureLatency(target) {
    // target 形如 "api.deepseek.com:443"
    return new Promise((resolve) => {
      const [host, portStr] = target.split(':');
      const port = parseInt(portStr || '443', 10);
      const sock = new net.Socket();
      const started = Date.now();
      sock.setTimeout(3000);
      sock.connect(port, host, () => {
        const ms = Date.now() - started;
        sock.destroy();
        resolve(ms);
      });
      sock.on('timeout', () => { sock.destroy(); resolve(null); });
      sock.on('error', () => { sock.destroy(); resolve(null); });
    });
  }

  async _runNetwork() {
    const targets = (this.cfg.networkTargets || ['api.deepseek.com:443']).slice(0, 3);
    const results = [];
    for (const t of targets) {
      const ms = await this._measureLatency(t);
      if (ms != null) results.push(ms);
    }
    if (!results.length) {
      this.network = { ok: false, error: '无法连接任何目标', rtt: null, grade: '离线', time: Date.now() };
      return;
    }
    const avg = Math.round(results.reduce((a, b) => a + b, 0) / results.length);
    let grade;
    if (avg < 50) grade = '极佳';
    else if (avg < 120) grade = '流畅';
    else if (avg < 300) grade = '一般';
    else grade = '卡顿';
    this.network = { ok: true, rtt: avg, grade, targets: results, time: Date.now() };
  }
}

/* 轻量 HTTP GET（返回文本） */
function httpGet(url, timeoutMs, cb) {
  const mod = url.startsWith('https') ? https : http;
  const req = mod.get(url, { timeout: timeoutMs }, (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => cb(null, data));
  });
  req.on('timeout', () => { req.destroy(); cb(new Error('timeout')); });
  req.on('error', (e) => cb(e));
}

/* WMO 天气代码 → 中文描述 */
function wmoDesc(code) {
  const map = {
    0: '晴', 1: '大部晴朗', 2: '多云', 3: '阴',
    45: '雾', 48: '雾凇',
    51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨',
    71: '小雪', 73: '中雪', 75: '大雪',
    80: '阵雨', 81: '阵雨', 82: '强阵雨',
    95: '雷雨', 96: '雷雨冰雹', 99: '强雷暴'
  };
  return map[code] || '未知';
}

module.exports = SystemMonitor;
