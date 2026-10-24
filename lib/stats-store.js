/**
 * 用量统计存储：按天累计 token 与费用，持久化到 data/stats.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PetAgent')
  : path.join(os.homedir(), 'Library', 'Application Support', 'PetAgent');
const DATA_FILE = path.join(DATA_DIR, 'stats.json');

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

class StatsStore {
  constructor() {
    this.data = this._load();
    this.listeners = [];
  }

  _load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      }
    } catch (e) {
      console.error('[stats] load failed, resetting:', e.message);
    }
    return {
      days: {},          // { "2026-10-23": { prompt, completion, total, cost, requests } }
      total: { prompt: 0, completion: 0, total: 0, cost: 0, requests: 0 },
      last: null         // 最近一次请求的 usage 明细
    };
  }

  _save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('[stats] save failed:', e.message);
    }
  }

  onUpdate(fn) {
    this.listeners.push(fn);
  }

  _emit() {
    const snapshot = this.snapshot();
    for (const fn of this.listeners) {
      try { fn(snapshot); } catch (e) { console.error('[stats] listener error:', e.message); }
    }
  }

  /**
   * 记录一次 API 消耗
   * @param {object} usage { prompt_tokens, completion_tokens, total_tokens, prompt_cache_hit_tokens? }
   * @param {string} model 模型名
   * @param {number} ms 本次耗时（毫秒）
   */
  record(usage, model, ms) {
    if (!usage || typeof usage.total_tokens !== 'number') return null;
    const cfg = this._modelConfig(model);
    const prompt = usage.prompt_tokens || 0;
    const completion = usage.completion_tokens || 0;
    const cacheHit = usage.prompt_cache_hit_tokens || 0;
    const cacheMiss = prompt - cacheHit;
    // DeepSeek 计价：输入（缓存未命中）/ 缓存命中输入 / 输出，单位 元/百万 token
    const cost = (
      (cacheMiss / 1e6) * cfg.input +
      (cacheHit / 1e6) * cfg.cache +
      (completion / 1e6) * cfg.output
    );

    const key = todayKey();
    const day = this.data.days[key] || (this.data.days[key] = { prompt: 0, completion: 0, total: 0, cost: 0, requests: 0 });
    day.prompt += prompt;
    day.completion += completion;
    day.total += usage.total_tokens;
    day.cost += cost;
    day.requests += 1;

    this.data.total.prompt += prompt;
    this.data.total.completion += completion;
    this.data.total.total += usage.total_tokens;
    this.data.total.cost += cost;
    this.data.total.requests += 1;

    this.data.last = {
      model,
      prompt,
      completion,
      total: usage.total_tokens,
      cost,
      cacheHit,
      ms,
      time: new Date().toISOString()
    };

    // 只保留最近 90 天
    const keys = Object.keys(this.data.days).sort();
    while (keys.length > 90) {
      delete this.data.days[keys.shift()];
    }

    this._save();
    this._emit();
    return this.data.last;
  }

  _modelConfig(model) {
    try {
      const cfg = require('../config.json');
      return cfg.models[model] || cfg.defaultModel;
    } catch (e) {
      return { input: 0.27, output: 1.1, cache: 0.07 };
    }
  }

  snapshot() {
    const key = todayKey();
    const day = this.data.days[key] || { prompt: 0, completion: 0, total: 0, cost: 0, requests: 0 };
    return {
      today: { ...day },
      total: { ...this.data.total },
      last: this.data.last ? { ...this.data.last } : null,
      date: key
    };
  }
}

module.exports = new StatsStore();
