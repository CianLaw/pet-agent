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

  /* ---------- 宠物互动 ---------- */
  const FOODS = ['🍎', '🍰', '🍖', '🍩', '🥕'];
  const LINES = {
    pet: ['嘿嘿，好舒服～', '再摸摸头嘛！', '喵呜～被摸到了！', '酥酥麻麻的~'],
    feed: ['这个好好吃！', '主人喂我啦！', '吃饱饱，开心心～', '再来一口嘛'],
    play: ['陪我玩咯！', '追球球～', '好开心呀！', '再来一局！'],
    greet: ['主人来啦！', '等你半天了～', '今天也要元气满满哦']
  };
  function say(text) {
    const b = $('bubble');
    $('bubbleText').textContent = text;
    b.classList.remove('hidden');
    clearTimeout(b._t);
    b._t = setTimeout(() => b.classList.add('hidden'), 2200);
  }
  function burst() {
    const box = $('particles');
    const icons = ['💗', '💙', '✨', '💖', '🌟'];
    for (let i = 0; i < 8; i++) {
      const p = document.createElement('span');
      p.className = 'particle';
      p.textContent = icons[Math.floor(Math.random() * icons.length)];
      p.style.left = (18 + Math.random() * 64) + '%';
      p.style.animationDelay = (Math.random() * 0.2) + 's';
      box.appendChild(p);
      setTimeout(() => p.remove(), 1100);
    }
  }
  function petTick(key) {
    const img = $('petImg');
    img.classList.remove('tick', 'bounce');
    void img.offsetWidth;
    img.classList.add(key === 'play' ? 'bounce' : 'tick');
  }

  function act(key, lineKey) {
    const lines = LINES[lineKey || key];
    say(lines[Math.floor(Math.random() * lines.length)]);
    burst();
    petTick(key);
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
    act('pet', 'pet');
  });

  /* ---------- 状态衰减（跨天） ---------- */
  setInterval(() => {
    const today = new Date().toDateString();
    if (data.lastDay !== today) {
      data.lastDay = today;
      data.hunger = Math.max(0, data.hunger - 10);
      data.energy = Math.max(0, data.energy - 6);
      save(); render();
      say(LINES.greet[Math.floor(Math.random() * LINES.greet.length)]);
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
        closeSkin(); say('换上新形象啦～');
      });
      list.appendChild(card);
    });
  }
  const openSkin = () => { $('skinSheet').classList.remove('hidden'); renderSkins(); };
  const closeSkin = () => $('skinSheet').classList.add('hidden');
  $('btnSkin').addEventListener('click', openSkin);
  $('skinMask').addEventListener('click', closeSkin);

  /* ---------- 设置 ---------- */
  const APP_VERSION = '5.9.2';
  const REPO = 'CianLaw/pet-agent';
  const CHANGELOG = [
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
    renderLog();
    const cfg = JSON.parse(localStorage.getItem('doubao_pet_api') || '{}');
    $('setApiBase').value = cfg.apiBase || 'https://api.deepseek.com';
    $('setApiKey').value = cfg.apiKey || '';
    $('setChatModel').value = cfg.chatModel || 'deepseek-chat';
  };
  const closeSet = () => $('setSheet').classList.add('hidden');
  $('btnSettings').addEventListener('click', openSet);
  $('setMask').addEventListener('click', closeSet);
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
  $('btnCheckUpdate').addEventListener('click', checkUpdate);

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
