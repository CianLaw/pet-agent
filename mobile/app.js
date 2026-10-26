/* 豆包桌宠 · 手机版逻辑：触摸互动 / 状态 / 皮肤 / 聊天 */
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'doubao_pet_mobile_v1';

  /* ---------- 持久化数据 ---------- */
  const data = Object.assign({
    affection: 0,
    hunger: 100, mood: 100, energy: 100,
    skin: 'default',
    lastDay: new Date().toDateString(),
    msgCount: 0
  }, JSON.parse(localStorage.getItem(KEY) || '{}'));

  function save() { localStorage.setItem(KEY, JSON.stringify(data)); }

  /* ---------- 状态渲染 ---------- */
  function setBar(id, v) { $(id).style.width = (v == null ? 0 : Math.max(0, Math.min(100, v))) + '%'; }
  function render() {
    setBar('sHunger', data.hunger); setBar('sMood', data.mood); setBar('sEnergy', data.energy);
    $('tHunger').textContent = Math.round(data.hunger) + '%';
    $('tMood').textContent = Math.round(data.mood) + '%';
    $('tEnergy').textContent = Math.round(data.energy) + '%';
    $('petImg').src = 'assets/skin/' + data.skin + '/pet.png';
  }

  /* ---------- 宠物互动（视觉表演委托给 main-pet.js 表演引擎：起承转合、绝不瞬切） ---------- */
  const FOODS = ['🍎', '🍰', '🍖', '🍩', '🥕'];
  function act(key, lineKey) {
    const text = window.__mainPet.pickLine(lineKey || key);
    let voice;
    if (key === 'feed') voice = Math.random() < 0.5 ? 'feed-yummy' : 'feed-love';
    else if (key === 'pet') voice = Math.random() < 0.5 ? 'pet-comfy' : 'pet-more';
    else if (key === 'play') voice = Math.random() < 0.5 ? 'play-with' : 'play-happy';
    window.__mainPet.say(text, voice);
    window.__mainPet.actVisual(key);
    window.__mainPet.buzz(16);
    if (key === 'feed') data.hunger = Math.min(100, data.hunger + 12);
    if (key === 'pet') { data.affection = Math.min(999, data.affection + 2); data.mood = Math.min(100, data.mood + 6); }
    if (key === 'play') { data.energy = Math.max(0, data.energy - 8); data.mood = Math.min(100, data.mood + 10); data.affection = Math.min(999, data.affection + 3); }
    data.msgCount++;
    render(); save();
  }

  $('actFeed').addEventListener('click', () => act('feed', 'feed'));
  $('actPet').addEventListener('click', () => act('pet', 'pet'));
  $('actPlay').addEventListener('click', () => act('play', 'play'));
  $('petZone').addEventListener('click', (e) => {
    if (e.target.closest('.bubble')) return;
    const t = window.__mainPet.pickLine('pet');
    window.__mainPet.say(t);
    window.__mainPet.actVisual('pet');
    window.__mainPet.buzz(16);
    data.affection = Math.min(999, data.affection + 2);
    data.mood = Math.min(100, data.mood + 6);
    data.msgCount++;
    render(); save();
  });

  /* ---------- 状态衰减（跨天） ---------- */
  setInterval(() => {
    const today = new Date().toDateString();
    if (data.lastDay !== today) {
      data.lastDay = today;
      data.hunger = Math.max(0, data.hunger - 10);
      data.energy = Math.max(0, data.energy - 6);
      save(); render();
      const gkey = (() => { const h = new Date().getHours(); if (h < 6) return 'greet-evening'; if (h < 11) return 'greet-morning'; if (h < 14) return 'greet-noon'; if (h < 18) return 'greet-afternoon'; return 'greet-evening'; })();
      window.__mainPet.say('主人来啦！本兔等你半天了～', gkey);
    }
  }, 30 * 1000);
  render();

  /* ---------- 皮肤 ---------- */
  // 与桌面端同步：动态读取各皮肤 skin.json（含团团两款）
  const SKIN_DIRS = ['default', 'cat', 'shiba', 'bear', 'doubaotu', 'doubaotu2'];
  const FALLBACK_SKINS = [
    { id: 'default', name: '默认' },
    { id: 'cat', name: '橘猫' },
    { id: 'shiba', name: '柴犬' },
    { id: 'bear', name: '小白熊' },
    { id: 'doubaotu', name: '豆包兔娘·团团' },
    { id: 'doubaotu2', name: '豆包兔娘·团团（裙摆限定）' }
  ];
  let SKINS = FALLBACK_SKINS;
  async function loadSkins() {
    const list = [];
    for (const dir of SKIN_DIRS) {
      let meta = { name: dir };
      try {
        const r = await fetch('assets/skin/' + dir + '/skin.json');
        if (r.ok) meta = await r.json();
      } catch (_) { /* 无 skin.json：用目录名 */ }
      list.push({ id: dir, name: meta.name || dir, desc: meta.desc || '' });
    }
    if (list.length) SKINS = list;
    renderSkins();
  }
  function renderSkins() {
    const list = $('skinList');
    list.innerHTML = '';
    SKINS.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'skin-card' + (data.skin === s.id ? ' using' : '');
      card.innerHTML = `<img src="assets/skin/${s.id}/pet.png" alt="" />
        <div class="skin-card-info">
          <span>${s.name}${data.skin === s.id ? ' · 使用中' : ''}</span>
          ${s.desc ? `<em>${s.desc}</em>` : ''}
        </div>`;
      card.addEventListener('click', () => {
        data.skin = s.id; save(); render();
        $('aboutAvatar').src = 'assets/skin/' + s.id + '/pet.png';
        window.__mainPet.refreshRig();
        closeSkin(); window.__mainPet.say('换上新形象啦～');
      });
      list.appendChild(card);
    });
  }
  const openSkin = () => { $('skinSheet').classList.remove('hidden'); renderSkins(); };
  const closeSkin = () => $('skinSheet').classList.add('hidden');
  $('btnSkin').addEventListener('click', openSkin);
  $('skinMask').addEventListener('click', closeSkin);

  /* ---------- 设置 ---------- */
  const APP_VERSION = '5.9.9';
  const REPO = 'CianLaw/pet-agent';
  const CHANGELOG = [
    { v: '5.9.9', items: ['更新日志收纳：不再平铺展开，点「检查更新」那一横即可打开独立日志界面', '查看日志与检查更新拆成两个独立入口：按钮只管检查更新', '手机 / 电脑主窗口 / 桌宠设置面板三端统一'] },
    { v: '5.9.8', items: ['声音不再被系统静音：首次点按自动解锁音频，喂食/摸摸/问候/天气配音稳定出声', '桌面天气播报修复：天气台词在桌面真正生效（网络限制 + 函数冲突一并解决）', '天气台词配上了专属语音：下雨/晴天/寒冷都会开口提醒，三端统一'] },
    { v: '5.9.7', items: ['立绘 2x 高清化：团团全套贴图分辨率翻倍，手机上不再发糊/像素化', '兔娘两款式 + 裙摆/耳/丝带部件同步高清'] },
    { v: '5.9.6', items: ['团团会说话啦：13 句软萌配音，喂食/摸摸/陪玩/问候都有声音回应', '天气感知：下雨/晴天/寒冷团团会提醒你，每 30 分钟自动刷新', '配音+天气：桌面 / 悬浮窗 / 主界面三端同步'] },
    { v: '5.9.5', items: ['新增裙摆物理层：裙摆与飘带随风缓摆，不再直挺挺', '互动联动：喝水抬手裙摆前倾、喂食低头跟随、跳跃后飘，动作起承转合', '桌面 / 悬浮窗 / 主界面三端同步'] },
    { v: '5.9.4', items: ['手机版主界面团团全面活化：呼吸/眨眼/兔耳丝带弹簧，不再僵直站立', '待机行为链：张望/点头/伸懒腰/揉眼/喝水/看书/玩手机，有起承转合', '互动动作序列化：喂食咀嚼、摸摸贴贴、陪玩跳跃，杜绝凭空变出', '统一团团台词库，与悬浮窗/桌面一致'] },
    { v: '5.9.3', items: ['手机版悬浮窗桌宠：团团常驻手机桌面（需授权）', '悬浮窗可拖动、可关闭，点击有互动', '动作引擎升级：连续插值+呼吸+眨眼+行为链，不再生硬切换'] },
    { v: '5.9.2', items: ['手机版与桌面端百分百同步', '新增软件封面（关于区）', '新增「检查更新」一键检测下载'] },
    { v: '5.9.1', items: ['兔娘 IP 命名「团团」', '团团专属台词库（傲娇口吻）', '皮肤简介展示'] },
    { v: '5.9.0', items: ['伪骨骼实体化：分层物理+眨眼+物品状态机', '动作导演器统一调度'] },
    { v: '5.5.4', items: ['修复贴图皮肤无法点击/拖拽', '兔娘动作大幅增强'] },
    { v: '5.5.3', items: ['新增豆包兔娘·团团两款皮肤', '兔娘专属动作：耳抖/转圈/比心'] }
  ];
  function renderLog() {
    const box = $('logList');
    box.innerHTML = '';
    CHANGELOG.forEach((c) => {
      const el = document.createElement('div');
      el.className = 'log-item';
      el.innerHTML = `<b>v${c.v}</b><ul>${c.items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
      box.appendChild(el);
    });
  }
  const openSet = () => {
    $('setSheet').classList.remove('hidden');
    $('curVer').textContent = '当前版本 v' + APP_VERSION;
    $('aboutVer').textContent = 'v' + APP_VERSION;
    $('aboutAvatar').src = 'assets/skin/' + data.skin + '/pet.png';
    const cfg = JSON.parse(localStorage.getItem('doubao_pet_api') || '{}');
    $('setApiBase').value = cfg.apiBase || 'https://api.deepseek.com';
    $('setApiKey').value = cfg.apiKey || '';
    $('setChatModel').value = cfg.chatModel || 'deepseek-chat';
    if (window.__floatRefresh) window.__floatRefresh();
  };
  const closeSet = () => $('setSheet').classList.add('hidden');
  $('btnSettings').addEventListener('click', openSet);
  $('setMask').addEventListener('click', closeSet);

  /* ---------- 悬浮窗桌宠（v5.9.3，Android 原生桥，浏览器预览自动降级隐藏） ---------- */
  const floatBtn = $('btnFloat');
  const floatStatus = $('floatStatus');
  let floatApi = null;
  try {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FloatingPet) {
      floatApi = window.Capacitor.Plugins.FloatingPet;
    }
  } catch (_) { /* 非原生环境 */ }
  const FLOAT_TEXT = {
    needPerm: '未授权 · 点击「去授权」跳转系统设置',
    idle: '已授权 · 点击开启悬浮窗',
    running: '正在悬浮 · 团团在桌面上陪着你',
    unsupported: '此环境不支持悬浮窗'
  };
  async function refreshFloatUI() {
    if (!floatApi) {
      const row = document.querySelector('.float-row');
      if (row) row.classList.add('hidden');
      return;
    }
    try {
      const perm = await floatApi.hasPermission();
      const open = await floatApi.isOpen();
      if (!perm.granted) {
        floatStatus.textContent = FLOAT_TEXT.needPerm;
        floatBtn.textContent = '去授权';
        floatBtn.disabled = false;
      } else if (open.open) {
        floatStatus.textContent = FLOAT_TEXT.running;
        floatBtn.textContent = '关闭悬浮窗';
        floatBtn.disabled = false;
      } else {
        floatStatus.textContent = FLOAT_TEXT.idle;
        floatBtn.textContent = '开启悬浮窗';
        floatBtn.disabled = false;
      }
    } catch (e) {
      floatStatus.textContent = FLOAT_TEXT.unsupported;
      floatBtn.disabled = true;
    }
  }
  floatBtn.addEventListener('click', async () => {
    if (!floatApi) return;
    try {
      const perm = await floatApi.hasPermission();
      if (!perm.granted) {
        await floatApi.requestPermission();
        floatStatus.textContent = '授权后将自动刷新状态';
        return;
      }
      const open = await floatApi.isOpen();
      if (open.open) {
        await floatApi.close();
      } else {
        try {
          await floatApi.open();
        } catch (err) {
          if (err && (err.message === 'need_permission' || err.code === 'need_permission')) {
            floatStatus.textContent = FLOAT_TEXT.needPerm;
            floatBtn.textContent = '去授权';
            return;
          }
          throw err;
        }
      }
      await refreshFloatUI();
    } catch (e) {
      floatStatus.textContent = FLOAT_TEXT.unsupported;
      floatBtn.disabled = true;
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && floatApi) refreshFloatUI();
  });
  window.__floatRefresh = refreshFloatUI;
  $('setSave').addEventListener('click', () => {
    const cfg = {
      apiBase: $('setApiBase').value.trim(),
      apiKey: $('setApiKey').value.trim(),
      chatModel: $('setChatModel').value.trim() || 'deepseek-chat'
    };
    localStorage.setItem('doubao_pet_api', JSON.stringify(cfg));
    $('setTip').textContent = '已保存。若未配 Key，桌宠会用离线回话陪你聊天。';
    setTimeout(closeSet, 900);
  });

  /* ---------- 检查更新（与桌面端一致：GitHub Releases） ---------- */
  const updateResult = $('updateResult');
  async function checkUpdate() {
    const btn = $('btnCheckUpdate');
    btn.disabled = true;
    btn.textContent = '检查中…';
    $('latestInfo').textContent = '正在连接 GitHub Releases…';
    updateResult.classList.add('hidden');
    try {
      const r = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
        headers: { 'Accept': 'application/vnd.github+json' }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const rel = await r.json();
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      if (!latest) throw new Error('empty');
      const hasNew = cmpVer(latest, APP_VERSION) > 0;
      $('latestInfo').textContent = hasNew ? '发现新版本 v' + latest + '！' : '已是最新版本（v' + APP_VERSION + '）';
      updateResult.classList.remove('hidden');
      if (hasNew) {
        let apkUrl = '';
        (rel.assets || []).forEach((a) => {
          if (/\.apk$/i.test(a.name)) apkUrl = a.browser_download_url || '';
        });
        updateResult.innerHTML = `<span>点击下载最新 APK 安装更新（免重装数据）。</span>
          <button class="btn-primary btn-dl" id="btnDlApk">下载 APK（v${latest}）</button>`;
        const dl = $('btnDlApk');
        dl.addEventListener('click', () => {
          if (apkUrl) {
            // Capacitor 原生 WebView 打开系统浏览器下载
            const w = window.open(apkUrl, '_system');
            if (!w) location.href = apkUrl;
          } else {
            location.href = 'https://github.com/' + REPO + '/releases/latest';
          }
        });
      } else {
        updateResult.innerHTML = `<span>当前已是最新版本，无需更新。</span>`;
      }
    } catch (err) {
      $('latestInfo').textContent = '检查失败：' + (err.message || err);
      updateResult.classList.remove('hidden');
      updateResult.innerHTML = `<span>请检查网络后重试，或到 GitHub Releases 手动下载：<a href="https://github.com/${REPO}/releases/latest" target="_blank" rel="noopener">打开 Releases</a></span>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '检查更新';
    }
  }
  function cmpVer(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }
  $('btnCheckUpdate').addEventListener('click', (e) => {
    e.stopPropagation();
    checkUpdate();
  });

  /* 更新日志界面：点击「检查更新」那一横打开（独立于检查按钮） */
  $('updateRow').addEventListener('click', () => {
    renderLog();
    $('logSheet').classList.remove('hidden');
  });
  $('logClose').addEventListener('click', () => $('logSheet').classList.add('hidden'));
  $('logMask').addEventListener('click', () => $('logSheet').classList.add('hidden'));

  /* ---------- 聊天 ---------- */
  const CHAT_KEY = 'doubao_pet_chat';
  let history = JSON.parse(localStorage.getItem(CHAT_KEY) || '[]');
  const OFFLINE = [
    '嘿嘿，我在呢！',
    '摸摸我呀～',
    '今天也要开开心心哦！',
    '我吃饱啦，精神满满～',
    '你说什么我都愿意听~',
    '主人最好啦！'
  ];
  function addMsg(role, text) {
    const box = $('chatMsgs');
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    el.textContent = text;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }
  function showChat() {
    $('chatPanel').classList.remove('hidden');
    $('chatMsgs').innerHTML = '';
    history = history.slice(-20);
    history.forEach((m) => addMsg(m.role, m.text));
    if (!history.length) {
      addMsg('bot', '嗨～我是你的豆包桌宠，想聊什么都可以！');
    }
    setTimeout(() => $('chatInput').focus(), 200);
  }
  $('actChat').addEventListener('click', showChat);
  $('chatClose').addEventListener('click', () => $('chatPanel').classList.add('hidden'));
  loadSkins();

  async function chatSend() {
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg('user', text);
    history.push({ role: 'user', text });
    const cfg = JSON.parse(localStorage.getItem('doubao_pet_api') || '{}');
    if (cfg.apiKey) {
      try {
        const sys = '你是陪伴主人的桌面宠物「豆包桌宠」，说话可爱、贴心、简短（50字内），偶尔傲娇，称呼主人为"主人"。';
        const res = await fetch((cfg.apiBase || 'https://api.deepseek.com') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
          body: JSON.stringify({
            model: cfg.chatModel || 'deepseek-chat',
            messages: [{ role: 'system', content: sys }, ...history.slice(-8).map((m) => ({ role: m.role, content: m.text }))],
            max_tokens: 120
          })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!reply) throw new Error('empty');
        addMsg('bot', reply);
        history.push({ role: 'assistant', text: reply });
      } catch (err) {
        addMsg('bot', '（联网聊天失败：' + (err.message || err) + '。可能是接口地址/CORS 限制，或去设置里检查 Key。先用离线回话陪你～）');
        offlineReply();
      }
    } else {
      offlineReply();
    }
    localStorage.setItem(CHAT_KEY, JSON.stringify(history.slice(-40)));
  }
  function offlineReply() {
    const r = OFFLINE[Math.floor(Math.random() * OFFLINE.length)];
    setTimeout(() => {
      addMsg('bot', r);
      history.push({ role: 'assistant', text: r });
      localStorage.setItem(CHAT_KEY, JSON.stringify(history.slice(-40)));
    }, 350);
  }
  $('chatSend').addEventListener('click', chatSend);
  $('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') chatSend(); });
})();
