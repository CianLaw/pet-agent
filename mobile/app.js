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
  const SKINS = [
    { id: 'default', name: '默认' },
    { id: 'cat', name: '橘猫' },
    { id: 'shiba', name: '柴犬' },
    { id: 'bear', name: '小白熊' }
  ];
  function renderSkins() {
    const list = $('skinList');
    list.innerHTML = '';
    SKINS.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'skin-card' + (data.skin === s.id ? ' using' : '');
      card.innerHTML = `<img src="assets/skin/${s.id}/pet.png" alt="" /><span>${s.name}${data.skin === s.id ? ' · 使用中' : ''}</span>`;
      card.addEventListener('click', () => {
        data.skin = s.id; save(); render();
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
  const openSet = () => {
    $('setSheet').classList.remove('hidden');
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
