/**
 * 本地代理记账服务器
 *
 * 作用：
 *  - 监听本地端口，接收任意 OpenAI 兼容客户端的请求
 *  - 把请求转发到 DeepSeek API（或其他配置的上游）
 *  - 解析每次响应的 usage（含流式 SSE 的末块 usage），记录到统计存储
 *  - 提供 /user/balance 余额查询透传
 *
 * 使用方式：在 AI 客户端里把 Base URL 配置为 http://127.0.0.1:<port>/v1
 */
'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const stats = require('./stats-store');

/** 按协议选择对应模块 */
function transportFor(protocol) {
  return protocol === 'http:' ? http : https;
}

const BUF_LIMIT = 20 * 1024 * 1024; // 请求体上限 20MB

class ProxyServer {
  /**
   * @param {object} opts { port, apiBase, apiKey }
   */
  constructor(opts) {
    this.port = opts.port || 8899;
    this.apiBase = opts.apiBase || 'https://api.deepseek.com';
    this.apiKey = opts.apiKey || '';
    this.usageListeners = [];
  }

  onUsage(fn) {
    this.usageListeners.push(fn);
  }

  start() {
    this.server = http.createServer((req, res) => this._handle(req, res));
    return new Promise((resolve, reject) => {
      this.server.on('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`[proxy] listening on http://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    if (this.server) this.server.close();
  }

  /** 解析请求体（JSON） */
  _readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > BUF_LIMIT) {
          reject(new Error('request body too large'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw ? JSON.parse(raw) : null);
        } catch (e) {
          reject(new Error('invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  _handle(req, res) {
    const base = new URL(this.apiBase);
    const reqPath = req.url.split('?')[0];

    // CORS（本地客户端不强制，但友好）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 余额接口直接透传（无需请求体）
    if (req.method === 'GET' && /\/user\/balance$/.test(reqPath)) {
      return this._forwardBalance(req, res, base);
    }

    // 其余统一按 chat/completions 处理（兼容 /v1/chat/completions 与 /chat/completions）
    if (!/chat\/completions$/.test(reqPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `proxy: unsupported path ${reqPath}` } }));
      return;
    }

    this._readBody(req)
      .then((body) => this._forwardChat(req, res, base, body))
      .catch((e) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'proxy: ' + e.message } }));
      });
  }

  _headers(req, base, extra) {
    const h = {};
    // 透传内容类头
    if (req.headers['content-type']) h['Content-Type'] = req.headers['content-type'];
    if (req.headers.accept) h['Accept'] = req.headers.accept;
    // Authorization：优先请求自带，否则用本地配置 key
    const auth = req.headers.authorization || (this.apiKey ? `Bearer ${this.apiKey}` : '');
    if (auth) h['Authorization'] = auth;
    h['Host'] = base.host;
    Object.assign(h, extra || {});
    return h;
  }

  _forwardBalance(req, res, base) {
    const target = `${base.protocol}//${base.host}/user/balance`;
    const headers = this._headers(req, base);
    const upstream = transportFor(base.protocol).request(target, { method: 'GET', headers }, (upRes) => {
      let data = '';
      upRes.on('data', (c) => (data += c));
      upRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          this._emitBalance(parsed);
        } catch (_) { /* 忽略解析失败 */ }
        res.writeHead(upRes.statusCode || 500, { 'Content-Type': 'application/json' });
        res.end(data || '{}');
      });
    });
    upstream.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'proxy: balance upstream error ' + e.message } }));
    });
    upstream.end();
  }

  _forwardChat(req, res, base, body) {
    const isStream = !!(body && body.stream);

    // 流式场景强制请求上游返回 usage（OpenAI 兼容协议字段）
    const outBody = JSON.parse(JSON.stringify(body || {}));
    if (isStream) {
      outBody.stream_options = outBody.stream_options || {};
      outBody.stream_options.include_usage = true;
    }

    const target = `${base.protocol}//${base.host}/chat/completions`;
    const headers = this._headers(req, base, {
      'Content-Length': Buffer.byteLength(JSON.stringify(outBody))
    });

    const startTs = Date.now();
    const upstream = transportFor(base.protocol).request(target, { method: 'POST', headers }, (upRes) => {
      // 流式：逐块透传并扫描 usage；非流式：整体读取后解析 usage
      if (isStream) {
        res.writeHead(upRes.statusCode || 500, {
          'Content-Type': upRes.headers['content-type'] || 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        let buffer = '';
        upRes.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          // 按 SSE 事件边界切分
          let idx;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            this._scanStreamEvent(event, body);
          }
          res.write(chunk);
        });
        upRes.on('end', () => {
          if (buffer) {
            this._scanStreamEvent(buffer, body);
            res.write(Buffer.from(buffer, 'utf8'));
          }
          res.end();
        });
      } else {
        let data = '';
        upRes.on('data', (c) => (data += c));
        upRes.on('end', () => {
          res.writeHead(upRes.statusCode || 500, { 'Content-Type': upRes.headers['content-type'] || 'application/json' });
          res.end(data);
          try {
            const parsed = JSON.parse(data);
            if (parsed && parsed.usage) {
              this._recordUsage(parsed.usage, body, Date.now() - startTs);
            }
          } catch (_) { /* 忽略 */ }
        });
      }
    });

    upstream.on('error', (e) => {
      // 上游已开始响应时只能中断
      if (res.writableEnded) return;
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'proxy: upstream error ' + e.message } }));
    });

    upstream.end(JSON.stringify(outBody));
  }

  /** 扫描 SSE 流中的一个事件，捕获带 usage 的数据块 */
  _scanStreamEvent(event, body) {
    if (!event || event.indexOf('data:') !== 0) return;
    const payload = event.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const parsed = JSON.parse(payload);
      if (parsed && parsed.usage) {
        this._recordUsage(parsed.usage, body, null);
      }
    } catch (_) { /* 忽略非 JSON 行 */ }
  }

  _recordUsage(usage, body, ms) {
    if (!usage || typeof usage.total_tokens !== 'number') return;
    const model = (body && body.model) || 'unknown';
    const recorded = stats.record(usage, model, ms == null ? 0 : ms);
    for (const fn of this.usageListeners) {
      try { fn(recorded); } catch (e) { console.error('[proxy] usage listener:', e.message); }
    }
  }

  _emitBalance(parsed) {
    // 余额数据通过 stats 透传给主进程
    try {
      const balances = (parsed.balance_infos || []).map((b) => ({
        currency: b.currency || 'CNY',
        total: parseFloat(b.total_balance) || 0,
        granted: parseFloat(b.granted_balance) || 0,
        toppedUp: parseFloat(b.topped_up_balance) || 0
      }));
      const total = balances.reduce((s, b) => s + (b.total || 0), 0);
      this.lastBalance = { total, list: balances, raw: parsed, time: new Date().toISOString() };
    } catch (e) {
      console.error('[proxy] balance parse:', e.message);
    }
  }

  getBalance() {
    return this.lastBalance || null;
  }
}

module.exports = ProxyServer;
