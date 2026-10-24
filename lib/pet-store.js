/**
 * 宠物状态存储：好感度 + 饱食/心情/精力 + 窗口位置 + 设置
 * 持久化到跨平台数据目录 pet.json（macOS ~/Library/Application Support/PetAgent，Windows %APPDATA%/PetAgent）
 *  - 三状态随时间衰减（饱食/心情/精力）
 *  - 互动（喂食/抚摸/陪玩/聊天）补充状态并累计好感度
 *  - 好感度分阶段：生疏(<20) 熟悉(<50) 亲密(<80) 黏人(>=80)
 */
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PetAgent')
  : path.join(os.homedir(), 'Library', 'Application Support', 'PetAgent');
const DATA_FILE = path.join(DATA_DIR, 'pet.json');

const STAGE_DEFS = [
  { min: 0, name: '生疏', desc: '还不熟呢，多陪陪我' },
  { min: 20, name: '熟悉', desc: '我们已经是朋友啦' },
  { min: 50, name: '亲密', desc: '最喜欢主人了～' },
  { min: 80, name: '黏人', desc: '一刻都不想离开你' }
];

const GREETINGS = {
  morning: ['早上好呀，新的一天～', '早安！今天也要元气满满哦'],
  noon: ['中午好，记得按时吃饭', '下午好呀，休息一下眼睛吧'],
  night: ['晚上好，工作辛苦了', '夜深啦，注意休息哦']
};

class PetStore {
  constructor() {
    this.data = this._load();
    this.listeners = [];
  }

  _defaults() {
    const now = Date.now();
    return {
      version: 1,
      affection: 0,          // 好感度 0-100
      states: { hunger: 80, mood: 70, energy: 90 },  // 饱食/心情/精力
      lastTick: now,
      windowPos: null,       // 上次窗口位置
      walkEnabled: false,    // 自主活动开关（默认静止）
      feedCount: 0,
      chatCount: 0,
      lastGreetDay: ''
    };
  }

  _load() {
    try {
      if (!fs.existsSync(DATA_FILE)) return this._defaults();
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const d = Object.assign(this._defaults(), raw);
      // 状态钳制
      for (const k of ['hunger', 'mood', 'energy']) {
        d.states[k] = Math.max(0, Math.min(100, d.states[k] || 0));
      }
      return d;
    } catch (e) {
      console.error('[pet] load failed:', e.message);
      return this._defaults();
    }
  }

  _save() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('[pet] save failed:', e.message);
    }
  }

  onUpdate(fn) { this.listeners.push(fn); }
  _emit() { for (const fn of this.listeners) { try { fn(this.snapshot()); } catch (e) {} } }

  /** 状态衰减：每隔 intervalMs 按衰减率降低 */
  tick(intervalMs) {
    const d = this.data;
    const elapsed = Math.min(intervalMs, 10 * 60 * 1000);  // 单次最多算 10 分钟
    const mins = elapsed / 60000;
    // 每 10 分钟衰减量
    d.states.hunger = Math.max(0, d.states.hunger - 0.8 * mins);
    d.states.mood = Math.max(0, d.states.mood - 0.3 * mins);
    d.states.energy = Math.max(0, d.states.energy - 0.5 * mins);
    d.lastTick = Date.now();
    this._save();
    this._emit();
  }

  /** 好感度阶段 */
  stage() {
    const a = this.data.affection;
    for (let i = STAGE_DEFS.length - 1; i >= 0; i--) {
      if (a >= STAGE_DEFS[i].min) return STAGE_DEFS[i];
    }
    return STAGE_DEFS[0];
  }

  /** 互动：加好感 + 加状态 */
  interact(kind) {
    const d = this.data;
    const gains = {
      feed:    { affection: 2, hunger: 30, mood: 3 },
      pet:     { affection: 1.5, mood: 6, energy: 2 },
      play:    { affection: 1, mood: 4, energy: -3 },
      chat:    { affection: 2, mood: 8 },
      click:   { affection: 0.2, mood: 1 }
    }[kind] || { affection: 0.5, mood: 2 };
    d.affection = Math.max(0, Math.min(100, d.affection + gains.affection));
    for (const k of ['hunger', 'mood', 'energy']) {
      if (gains[k]) d.states[k] = Math.max(0, Math.min(100, d.states[k] + gains[k]));
    }
    if (kind === 'feed') d.feedCount++;
    if (kind === 'chat') d.chatCount++;
    this._save();
    this._emit();
    return this.snapshot();
  }

  /** 喂食后补一次状态 */
  feed() { return this.interact('feed'); }
  petHead() { return this.interact('pet'); }
  play() { return this.interact('play'); }

  setWindowPos(pos) {
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
    this.data.windowPos = { x: Math.round(pos.x), y: Math.round(pos.y) };
    this._save();
  }

  setWalk(enabled) {
    this.data.walkEnabled = !!enabled;
    this._save();
    this._emit();
  }

  /** 问候语（按早晚时段 + 好感阶段） */
  greeting() {
    const h = new Date().getHours();
    let bucket = 'night';
    if (h >= 5 && h < 12) bucket = 'morning';
    else if (h >= 12 && h < 19) bucket = 'noon';
    const lines = GREETINGS[bucket];
    const stage = this.stage();
    return lines[Math.floor(Math.random() * lines.length)] + `（${stage.name}阶段）`;
  }

  snapshot() {
    return {
      affection: Math.round(this.data.affection * 10) / 10,
      stage: this.stage(),
      states: {
        hunger: Math.round(this.data.states.hunger),
        mood: Math.round(this.data.states.mood),
        energy: Math.round(this.data.states.energy)
      },
      walkEnabled: this.data.walkEnabled,
      feedCount: this.data.feedCount,
      chatCount: this.data.chatCount,
      windowPos: this.data.windowPos
    };
  }
}

module.exports = PetStore;
