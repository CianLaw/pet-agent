/**
 * 代理记账端到端测试：本地 mock 上游模拟 DeepSeek API，验证 usage 解析与统计
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ProxyServer = require('./lib/proxy');
const stats = require('./lib/stats-store');

// 重置持久化统计，保证测试可重复
const DATA_FILE = path.join(os.homedir(), 'Library', 'Application Support', 'PetAgent', 'stats.json');
try { fs.unlinkSync(DATA_FILE); } catch (_) {}
stats.data = { days: {}, total: { prompt: 0, completion: 0, total: 0, cost: 0, requests: 0 }, last: null };

// 1. 启动 mock 上游（模拟 DeepSeek API）
let mockRequests = 0;
const mock = http.createServer((req, res) => {
  // 余额接口
  if (req.url === '/user/balance') {
    mockRequests++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ balance_infos: [{ currency: 'CNY', total_balance: '5.47', granted_balance: '0', topped_up_balance: '5.47' }] }));
    return;
  }
  mockRequests++;
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    const isStream = !!parsed.stream;
    const usage = {
      prompt_tokens: 120,
      completion_tokens: 45,
      total_tokens: 165,
      prompt_cache_hit_tokens: 80
    };
    if (isStream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '你' } }] }) + '\n\n');
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '好' } }] }) + '\n\n');
      res.end('data: ' + JSON.stringify({ usage }) + '\n\ndata: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'x', choices: [{ message: { content: '你好' } }], usage }));
    }
  });
});

// 2. 启动代理指向 mock
const proxy = new ProxyServer({ port: 19001, apiBase: 'http://127.0.0.1:19002', apiKey: 'test-key' });
const records = [];
proxy.onUsage((r) => records.push(r));

// 3. 客户端请求函数
function chat(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: 19001, path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

(async () => {
  mock.listen(19002, '127.0.0.1', async () => {
    try {
      await proxy.start();

      // 非流式
      const r1 = await chat({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] });
      console.log('non-stream status:', r1.status);
      const b1 = JSON.parse(r1.body);
      console.log('non-stream usage echoed:', JSON.stringify(b1.usage));

      // 流式
      const r2 = await chat({ model: 'deepseek-reasoner', stream: true, messages: [{ role: 'user', content: 'hi' }] });
      console.log('stream status:', r2.status);
      console.log('stream tail:', JSON.stringify(r2.body.slice(-220)));

      // 验证统计
      const snap = stats.snapshot();
      console.log('---- stats ----');
      console.log('today.total:', snap.today.total, '(expect 330)');
      console.log('today.requests:', snap.today.requests, '(expect 2)');
      console.log('today.cost:', snap.today.cost.toFixed(6));
      console.log('last:', JSON.stringify(snap.last));
      console.log('mockRequests:', mockRequests, '(expect 2)');

      // 余额接口透传测试
      const r3 = await new Promise((resolve) => {
        http.get({ host: '127.0.0.1', port: 19001, path: '/user/balance', headers: { Authorization: 'Bearer test-key' } }, (res) => {
          let out = '';
          res.on('data', (c) => (out += c));
          res.on('end', () => resolve({ status: res.statusCode, body: out }));
        });
      });
      console.log('balance status:', r3.status, 'body:', r3.body);
      console.log('proxy.lastBalance:', JSON.stringify(proxy.getBalance()));

      const ok = snap.today.total === 330 && snap.today.requests === 2 && mockRequests === 3;
      console.log(ok ? '\n✅ ALL TESTS PASSED' : '\n❌ TEST FAILED');
      process.exit(ok ? 0 : 1);
    } catch (e) {
      console.error('test error:', e);
      process.exit(1);
    }
  });
})();
