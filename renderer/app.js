/**
 * 渲染层逻辑：Live2D 桌宠 + 状态渲染 + 点击互动 + 拖动 + 鼠标穿透 + AI 聊天
 * - 无关闭按钮（右键菜单退出，不碍眼）
 * - 气泡在宠物头顶
 * - 鼠标穿透：在模型/气泡/聊天窗上可点，透明区域点穿到桌面
 * - 好感度状态条 / 喂食 / 摸头 / 陪玩 / AI 对话
 */
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const bubble = $('bubble');
  const miniBubble = $('miniBubble');
  const pet = $('pet');
  const fx = $('fx');
  const chatPanel = $('chatPanel');
  const chatLog = $('chatLog');
  const chatInput = $('chatInput');
  const walkLayer = $('walkLayer');
  const walkSprite = $('walkSprite');
  const sleepOverlay = $('sleepOverlay');
  const sleepZzz = $('sleepZzz');

  let state = null;
  let lastSpeed = { ts: 0, tokens: 0 };
  let clickCount = 0;
  let clickTimer = null;
  let mouseOverInteractive = false;
  let walkAnim = null;
  let petMode = 'awake';   // awake | idle(发呆) | sleep(睡觉)
  let modeTimer = null;

  const CHAT_LINES = [
    '主人来啦～',
    '今天也要加油哦！',
    '嘿嘿，摸摸头～',
    '我在看着你写代码呢',
    '电量满满，元气满满！',
    '网络好快呀，嗖嗖的～',
    '要记得喝水哦',
    '好耶！',
    '摸鱼时间到～',
    '让我看看你在干嘛',
    '豆包豆包，法力无边～',
    '专心干活，我陪你～'
  ];

  /* ---------- 工具 ---------- */
  function fmtMoney(n) {
    if (n == null || isNaN(n)) return '--';
    if (n === 0) return '¥0.00';
    return n >= 100 ? '¥' + n.toFixed(0) : '¥' + n.toFixed(n < 0.01 ? 4 : 2);
  }

  function fmtTokens(n) {
    if (n == null || isNaN(n)) return '--';
    return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
  }

  function fmtBattery(b) {
    if (!b || !b.ok) return '--';
    const pct = b.percent != null ? b.percent + '%' : '--';
    if (b.charging) return pct + ' 充电中';
    if (b.acPower) return pct + ' 电源';
    return pct;
  }

  function fmtNetwork(n) {
    if (!n || !n.ok) return '离线';
    return n.rtt + 'ms ' + n.grade;
  }

  const DT_STATUS_TEXT = {
    in_progress: '处理中…',
    completed: '已完成 ✅',
    failed: '失败',
    interrupted: '中断',
    unknown: '未知'
  };
  const DT_STATUS_CLS = {
    in_progress: 'dt-progress',
    completed: 'dt-done',
    failed: 'dt-fail',
    interrupted: 'dt-fail',
    unknown: ''
  };

  function fmtDoubaoTask(t) {
    if (!t || !t.status) return { text: '--', cls: '' };
    const base = DT_STATUS_TEXT[t.status] || '未知';
    const cls = DT_STATUS_CLS[t.status] || '';
    return { text: base, cls };
  }

  function nowTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  /* ---------- 状态渲染 ---------- */
  function setVal(id, text, empty) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('empty', !!empty);
  }

  function renderPetStatus(p) {
    if (!p) return;
    setVal('petStage', p.stage.name + '阶段');
    setVal('petAffection', '好感 ' + p.affection);
    const bars = {
      hunger: $('barHunger'),
      mood: $('barMood'),
      energy: $('barEnergy')
    };
    if (bars.hunger) bars.hunger.style.width = p.states.hunger + '%';
    if (bars.mood) bars.mood.style.width = p.states.mood + '%';
    if (bars.energy) bars.energy.style.width = p.states.energy + '%';
  }

  function render(s) {
    state = s;
    if (!s) return;
    const { stats: st, balance, system, pet: p } = s;

    const bal = balance && balance.total != null ? balance.total : null;
    $('balance').textContent = fmtMoney(bal);
    $('balance').classList.toggle('empty', bal == null);

    const today = st && st.today;
    setVal('todayCost', today && today.requests > 0 ? fmtMoney(today.cost) + ' · ' + fmtTokens(today.total) + ' tok / ' + today.requests + ' 次' : '暂无记录', !today || today.requests === 0);

    if (st && st.last && st.last.total) {
      setVal('lastTokens', fmtTokens(st.last.total) + ' tok / ' + fmtMoney(st.last.cost));
      setVal('model', st.last.model || '--');
      const hit = st.last.cacheHit ? Math.round((st.last.cacheHit / Math.max(st.last.prompt, 1)) * 100) : 0;
      setVal('cacheHit', st.last.prompt > 0 ? hit + '%' : '--');
    } else {
      setVal('lastTokens', '暂无记录', true);
      setVal('model', '暂无记录', true);
      setVal('cacheHit', '--');
    }

    if (st && st.last && st.last.total) {
      const now = Date.now();
      const delta = now - lastSpeed.ts;
      if (delta > 0 && lastSpeed.tokens > 0) {
        const rate = Math.round((st.last.total - lastSpeed.tokens) / (delta / 1000));
        setVal('speed', rate >= 0 ? rate + ' tok/s' : '--');
      }
      lastSpeed = { ts: now, tokens: st.last.total };
    } else if (!st || !st.last) {
      setVal('speed', '--');
    }

    setVal('battery', fmtBattery(system && system.battery));
    setVal('network', fmtNetwork(system && system.network));
    const mem = system && system.memory;
    const cpu = system && system.cpu;
    setVal('memcpu',
      (mem && mem.ok && mem.usedPct != null ? mem.usedPct + '%' : '--') + ' / ' +
      (cpu && cpu.ok && cpu.avgPct != null ? cpu.avgPct + '%' : '--'));
    const dt = fmtDoubaoTask(s.doubaoTask);
    const dtEl = $('doubaoTask');
    if (dtEl) {
      dtEl.textContent = dt.text;
      dtEl.className = 'value doubao-task ' + dt.cls;
    }
    $('time').textContent = nowTime();

    renderPetStatus(p);
  }

  /* ---------- 气泡显隐（头顶） ---------- */
  let bubbleTimer = null;
  function showBubble() {
    // 聊天窗打开时，用量面板让位，避免遮挡
    if (!chatPanel.classList.contains('hidden')) return;
    bubble.classList.remove('hidden');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), 15000);
  }

  let miniTimer = null;
  function showMini(text, isUsage) {
    miniBubble.textContent = text;
    miniBubble.classList.remove('hidden');
    miniBubble.classList.toggle('usage', !!isUsage);
    clearTimeout(miniTimer);
    miniTimer = setTimeout(() => miniBubble.classList.add('hidden'), isUsage ? 6000 : 2500);
  }

  function randomChat() {
    return CHAT_LINES[Math.floor(Math.random() * CHAT_LINES.length)];
  }

  /* ---------- 音效（Web Audio 合成，无需音频文件） ---------- */
  let audioCtx = null;
  function ensureAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) { /* 静默 */ }
  }
  function playTone(type) {
    ensureAudio();
    if (!audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      if (type === 'pop') {           // 喂食：短促上扬
        osc(now, 420, 0.12, 'square');
        osc(now + 0.06, 640, 0.1, 'square');
      } else if (type === 'ding') {    // 摸头：柔和叮
        osc(now, 880, 0.15, 'sine');
        osc(now + 0.09, 1320, 0.18, 'sine');
      } else if (type === 'boing') {   // 陪玩：弹跳
        osc(now, 200, 0.14, 'triangle');
        osc(now + 0.07, 340, 0.12, 'triangle');
      }
    } catch (_) { /* 静默 */ }
  }
  function osc(t, freq, dur, shape) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = shape;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /* ---------- 喂食/摸头/陪玩专属动画 ---------- */
  function spawnFood() {
    const foods = ['🍎', '🍰', '🍖', '🍩', '🥕'];
    const el = document.createElement('div');
    el.className = 'food-fx';
    el.textContent = foods[Math.floor(Math.random() * foods.length)];
    el.style.left = (90 + Math.random() * 60) + 'px';
    el.style.top = (180 + Math.random() * 40) + 'px';
    fx.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }
  function petChew() {
    // 吃动作：左右快速轻摆（吃食物）
    pet.classList.add('chew');
    setTimeout(() => pet.classList.remove('chew'), 500);
    spawnFood();
    spawnHearts(3);
  }
  function petPetAnim() {
    // 摸头：爱心 + 眯眼（眯眼用一颗大爱心在头顶）
    const el = document.createElement('div');
    el.className = 'head-heart';
    el.textContent = '💗';
    fx.appendChild(el);
    setTimeout(() => el.remove(), 1100);
    spawnHearts(4);
  }

  /* ---------- 发呆 / 睡觉状态 ---------- */
  function setPetMode(mode) {
    if (mode === petMode) return;
    petMode = mode;
    if (mode === 'sleep') {
      sleepOverlay.classList.remove('hidden');
      sleepZzz.classList.remove('hidden');
    } else {
      sleepOverlay.classList.add('hidden');
      sleepZzz.classList.add('hidden');
    }
  }
  function wakePet() {
    if (petMode === 'awake') return;
    setPetMode('awake');
    showMini('嗯？叫我呀～');
  }
  // 定时随机进入发呆/睡觉：发呆 40s 内随机、睡觉只在夜深（0-6 点）或长时间空闲
  function scheduleMode() {
    clearTimeout(modeTimer);
    const delay = 12000 + Math.random() * 20000;
    modeTimer = setTimeout(() => {
      const h = new Date().getHours();
      const idle = state && state.focusMode;
      if (idle || h >= 0 && h < 6) {
        setPetMode('sleep');                    // 空闲或深夜 → 睡觉
      } else {
        setPetMode('idle');                     // 发呆（视觉上保持原样，台词体现）
        showMini('(发呆中…)');
      }
      // 一段时间后自然醒
      clearTimeout(modeTimer);
      modeTimer = setTimeout(() => {
        setPetMode('awake');
        scheduleMode();
      }, 15000 + Math.random() * 15000);
    }, delay);
  }
  scheduleMode();
  // 点击 / 喂食 / 摸头 / 陪玩都会唤醒
  const wakeHooks = ['pointerdown'];
  wakeHooks.forEach((ev) => document.body.addEventListener(ev, () => wakePet(), { capture: true }));

  /* ---------- 点击互动（弹跳 + 爱心 + 台词） ---------- */
  function petBounce() {
    pet.classList.remove('bounce');
    void pet.offsetWidth;
    pet.classList.add('bounce');
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => pet.classList.remove('bounce'), 500);
  }

  function bindPetEvents(container) {
    if (!container) return;
    if (container.dataset.bound) return;
    container.dataset.bound = '1';

    container.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // 只响应在模型画布/容器本体上的主键点击；
      // 聊天窗等 UI 弹出层的事件不冒泡到这里（pointer-events 分离）
      try {
        if (window.L2Dwidget && L2Dwidget.trigger) {
          L2Dwidget.trigger('tap', {});
        }
      } catch (_) { /* 忽略 */ }

      clickCount++;
      petBounce();
      spawnHearts(clickCount % 3 === 0 ? 6 : 3);
      showMini(randomChat());
      showBubble();
      window.petAgent.notifyInteract();

      if (clickCount % 5 === 0) {
        window.petAgent.refreshBalance();
      }
    });

    container.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.petAgent.showContextMenu();
    });

    // 拖动：只在按住后移动超过阈值时启动，避免"点击也触发拖动"
    let dragPending = false;
    let dragMoved = false;
    let downPos = null;
    container.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = document.body.getBoundingClientRect();
      downPos = { clientX: e.clientX, clientY: e.clientY };
      dragPending = true;
      dragMoved = false;
    });
    container.addEventListener('pointermove', (e) => {
      if (!dragPending) return;
      if (Math.abs(e.clientX - downPos.clientX) < 5 && Math.abs(e.clientY - downPos.clientY) < 5) return;
      if (!dragMoved) {
        dragMoved = true;
        window.petAgent.dragStart({
          screen: { x: e.screenX, y: e.screenY },
          win: { x: window.screenX, y: window.screenY }
        });
      }
      window.petAgent.dragMove([e.screenX, e.screenY]);
    });
    container.addEventListener('pointerup', () => {
      if (dragPending && dragMoved) window.petAgent.dragEnd();
      dragPending = false;
      dragMoved = false;
    });
  }

  // 互动/拖动统一绑在 Live2D 容器（#live2d-widget）上，
  // 不再绑 #pet 外层（避免同一事件触发两次互动与拖动）
  const tryBindLive2D = () => {
    const el = document.getElementById('live2d-widget') || document.querySelector('#live2d-widget');
    if (el) {
      bindPetEvents(el);
      setTimeout(updateMousePassthrough, 500);
    } else {
      setTimeout(tryBindLive2D, 300);
    }
  };

  function spawnHearts(count) {
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'heart';
      el.textContent = ['💗', '💙', '✨', '💖', '🌟'][Math.floor(Math.random() * 5)];
      el.style.left = (30 + Math.random() * 80) + 'px';
      el.style.top = (40 + Math.random() * 60) + 'px';
      el.style.setProperty('--dx', (Math.random() * 90 - 45) + 'px');
      el.style.setProperty('--dy', -(70 + Math.random() * 70) + 'px');
      fx.appendChild(el);
      setTimeout(() => el.remove(), 1300);
    }
  }

  /* ---------- 拖动（全局 pointermove/up） ---------- */
  window.addEventListener('pointermove', (e) => {
    window.petAgent.dragMove([e.screenX, e.screenY]);
  });

  window.addEventListener('pointerup', () => {
    window.petAgent.dragEnd();
  });

  /* ---------- 鼠标穿透：动态切换 ---------- */
  const INTERACTIVE_SELECTOR = '#live2d-widget, #live2d-widget canvas, #bubble, #miniBubble, #chatPanel, #chatPanel input, #settingsPanel, #settingsPanel input, #settingsPanel button, #walkSprite';

  function updateMousePassthrough() {
    const el = document.elementFromPoint(lastMouse.x, lastMouse.y);
    const interactive = !!(el && el.closest && el.closest(INTERACTIVE_SELECTOR));
    if (interactive !== mouseOverInteractive) {
      mouseOverInteractive = interactive;
      window.petAgent.setIgnoreMouse(interactive ? false : true);
    }
  }

  let lastMouse = { x: 0, y: 0 };
  document.addEventListener('mousemove', (e) => {
    lastMouse = { x: e.clientX, y: e.clientY };
    updateMousePassthrough();
  });

  // 初始进入时若鼠标不在交互区则穿透
  setTimeout(() => {
    if (!mouseOverInteractive) {
      window.petAgent.setIgnoreMouse(true);
    }
  }, 800);

  /* ---------- AI 聊天 ---------- */
  function appendChat(role, text) {
    const row = document.createElement('div');
    row.className = 'chat-msg ' + (role === 'pet' ? 'pet' : 'user');
    row.textContent = text;
    chatLog.appendChild(row);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function openChat() {
    closeSettings();
    chatPanel.classList.remove('hidden');
    // 打开聊天窗时隐藏用量面板，聊天窗拥有最高优先级
    bubble.classList.add('hidden');
    setTimeout(() => chatInput.focus(), 50);
    if (!chatLog.children.length) {
      appendChat('pet', '主人找我聊天呀～(好感度阶段会影响我的性格哦)');
    }
  }

  function closeChat() {
    chatPanel.classList.add('hidden');
  }

  $('chatClose').addEventListener('click', closeChat);
  // 右键菜单"关闭聊天窗"也调用 closeChat
  window.petAgent.onPetChatClose(closeChat);

  /* ---------- 设置面板（右键菜单「设置…」打开） ---------- */
  const settingsPanel = $('settingsPanel');

  function openSettings() {
    closeChat();
    settingsPanel.classList.remove('hidden');
    bubble.classList.add('hidden');
    loadSettings();
  }
  function closeSettings() {
    settingsPanel.classList.add('hidden');
  }

  function loadSettings() {
    window.petAgent.getSettings().then((s) => {
      if (!s || !s.ok) return;
      $('setCurrentVersion').textContent = s.version || '--';
      $('setApiBase').value = (s.config.apiBase || '');
      $('setApiKey').value = '';
      $('setApiKey').placeholder = s.config.apiKeySet ? (s.config.apiKeyMasked || '已设置 Key') : '未设置 Key';
      $('setChatModel').value = (s.config.chatModel || '');
      $('setVisionEnabled').checked = !!s.config.vision.enabled;
      $('setVisionInterval').value = s.config.vision.intervalSec || 60;
      $('setVisionModel').value = (s.config.vision.model || '');
      $('setLatestVersion').textContent = '--';
      $('setUpdateStatus').textContent = '点击「检查更新」获取最新版本';
      $('btnApplyUpdate').disabled = true;
    });
  }

  $('settingsClose').addEventListener('click', closeSettings);
  window.petAgent.onSettingsOpen(openSettings);

  $('btnCheckUpdate').addEventListener('click', async () => {
    const btn = $('btnCheckUpdate');
    const status = $('setUpdateStatus');
    btn.disabled = true;
    status.textContent = '正在检查更新…';
    try {
      const r = await window.petAgent.checkUpdate();
      if (!r || !r.ok) {
        status.textContent = '检查失败：' + (r && r.error ? r.error : '网络异常');
        btn.disabled = false;
        return;
      }
      $('setLatestVersion').textContent = r.latest || '--';
      if (r.hasUpdate) {
        status.textContent = '发现新版本 ' + r.latest + '！点「立即更新」自动升级';
        $('btnApplyUpdate').disabled = false;
      } else {
        status.textContent = '已是最新版本（' + r.current + '）';
        $('btnApplyUpdate').disabled = true;
      }
    } catch (e) {
      status.textContent = '检查失败：' + e.message;
    }
    btn.disabled = false;
  });

  $('btnApplyUpdate').addEventListener('click', async () => {
    const btn = $('btnApplyUpdate');
    const status = $('setUpdateStatus');
    btn.disabled = true;
    status.textContent = '正在下载新版本并升级…请稍候（期间请勿关机）';
    try {
      const r = await window.petAgent.applyUpdate();
      if (!r || !r.ok) {
        status.textContent = '更新失败：' + (r && r.error ? r.error : '未知错误');
        btn.disabled = false;
      } else {
        status.textContent = '升级完成（' + r.updatedTo + '），正在自动重启…';
      }
    } catch (e) {
      status.textContent = '更新失败：' + e.message;
      btn.disabled = false;
    }
  });

  $('btnSaveSettings').addEventListener('click', async () => {
    const patch = {
      apiBase: $('setApiBase').value.trim(),
      chatModel: $('setChatModel').value.trim(),
      vision: {
        enabled: $('setVisionEnabled').checked,
        intervalSec: parseInt($('setVisionInterval').value, 10) || 60,
        model: $('setVisionModel').value.trim()
      }
    };
    const keyVal = $('setApiKey').value.trim();
    if (keyVal) patch.apiKey = keyVal;
    const btn = $('btnSaveSettings');
    const status = $('setUpdateStatus');
    btn.disabled = true;
    try {
      const r = await window.petAgent.saveSettings(patch);
      if (r && r.ok) {
        status.textContent = '设置已保存，重启桌宠后生效 ✓';
        loadSettings();
      } else {
        status.textContent = '保存失败：' + (r && r.error ? r.error : '未知错误');
      }
    } catch (e) {
      status.textContent = '保存失败：' + e.message;
    }
    btn.disabled = false;
  });

  /* ---------- 散步：宠物搬着桌子散步 ----------
   * 开始：宠物+桌子从窗口外滑入（搬着桌子来），随后左右往返走；
   * 停止：宠物搬着桌子滑出窗口，再恢复 Live2D 场景 —— 全程可见，不凭空出现/消失。
   */
  function setLive2DVisible(visible) {
    const el = document.getElementById('live2d-widget');
    if (el) {
      el.classList.toggle('walk-hidden', !visible);
    }
  }

  function finishWalkOut() {
    const team = $('walkTeam');
    team.classList.remove('out', 'in', 'walk');
    team.onanimationend = null;
    walkLayer.classList.add('hidden');
    walkSprite.classList.add('hidden');
    setLive2DVisible(true);
    clearInterval(walkAnim);
    walkAnim = null;
  }

  function startWalkAnim() {
    if (walkAnim) return;
    setLive2DVisible(false);
    // 散步时隐藏用量面板与台词气泡，露出"搬桌散步"的画面
    bubble.classList.add('hidden');
    miniBubble.classList.add('hidden');
    walkLayer.classList.remove('hidden');
    walkSprite.classList.remove('hidden');
    // 散步精灵也可交互（点击互动 + 右键菜单 → 可随时"保持静止"）
    bindPetEvents(walkSprite);
    const team = $('walkTeam');
    team.classList.remove('out', 'in', 'walk');
    void team.offsetWidth;
    team.classList.add('in');              // 搬着桌子从窗口外滑入
    team.onanimationend = () => {
      if (!team.classList.contains('in')) return;
      team.classList.remove('in');
      team.classList.add('walk');          // 开始搬桌散步循环
    };
    walkAnim = setInterval(() => {
      if (walkLayer.classList.contains('hidden')) return;
    }, 60000);
  }

  function stopWalkAnim() {
    if (!walkAnim) return;
    const team = $('walkTeam');
    if (team.classList.contains('walk') || team.classList.contains('in')) {
      team.classList.remove('walk', 'in');
      void team.offsetWidth;
      team.classList.add('out');           // 搬着桌子滑出窗口
      team.onanimationend = () => {
        if (team.classList.contains('out')) finishWalkOut();
      };
    } else {
      finishWalkOut();
    }
  }

  window.petAgent.onPetWalkStart(startWalkAnim);
  window.petAgent.onPetWalkStop(stopWalkAnim);

  async function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    appendChat('user', text);
    if (!state || !state.apiKeyConfigured) {
      appendChat('pet', '主人还没给我配置 API Key 哦～在 config.json 里填入 sk- 开头的密钥，我就能陪你聊天啦');
      return;
    }
    appendChat('pet', '思考中…');
    const last = chatLog.lastElementChild;
    try {
      const result = await window.petAgent.chat(text);
      if (result && result.ok) {
        last.textContent = result.text;
        showMini(result.text, true);
      } else if (result && result.error === 'no-key') {
        last.textContent = '主人还没给我配置 API Key 哦～';
      } else {
        last.textContent = '啊呜，我没听清…(网络或服务异常)';
      }
    } catch (e) {
      last.textContent = '啊呜，聊天失败啦(本地代理异常)';
    }
  }

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
    e.stopPropagation();
  });

  /* ---------- 拖文件给它吃 ---------- */
  const dropHint = $('dropHint');
  let dragDepth = 0;   // 进入/离开计数，防止子元素抖动
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    dropHint.classList.remove('hidden');
    // 拖拽期间关闭鼠标穿透，保证能接收 drop
    window.petAgent.setIgnoreMouse(false);
  });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  window.addEventListener('dragleave', (e) => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropHint.classList.add('hidden');
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropHint.classList.add('hidden');
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) {
      // 可能是文本/URL 拖拽，忽略
      window.petAgent.setIgnoreMouse(false);
      return;
    }
    const paths = files.map((f) => window.petAgent.getPathForFile(f)).filter(Boolean);
    if (paths.length) {
      petChew();
      playTone('pop');
      const r = await window.petAgent.trashFiles(paths);
      if (!r || !r.ok) {
        showMini('啊呜，这个文件我吃不动…');
      }
    }
    // 恢复鼠标穿透判定
    setTimeout(updateMousePassthrough, 300);
  });

  /* ---------- 订阅状态 ---------- */
  /* 皮肤：贴图皮肤时隐藏 Live2D、显示贴图层；Live2D 皮肤时反之 */
  function applySkin(skin) {
    const img = $('skinImage');
    const l2d = document.getElementById('live2d-widget');
    if (skin && skin.type === 'image' && skin.file) {
      img.src = '../' + skin.file;
      img.style.display = 'block';
      if (l2d) l2d.style.display = 'none';
      walkSprite.style.backgroundImage = `url('../${skin.file}')`;
    } else {
      img.style.display = 'none';
      if (l2d) l2d.style.display = '';
      walkSprite.style.backgroundImage = '';
    }
  }
  window.petAgent.onState((s) => {
    render(s);
    if (s && s.skin) applySkin(s.skin);
  });
  window.petAgent.getState().then((s) => {
    render(s);
    applySkin(s && s.skin);
  });

  window.petAgent.onPetSay((text) => showMini(text));

  /* 屏幕感知：主进程视觉分析结果 → 台词 + 表情动作 */
  window.petAgent.onPetVision((v) => {
    if (!v || !v.bubble) return;
    showMini(v.bubble);
    const mood = v.mood || 'calm';
    const action = v.action || 'other';
    if (mood === 'happy' || mood === 'cheerful') spawnHearts(2);
    if (action === 'video' || action === 'game') {
      petBounce();                      // 娱乐场景：轻轻"凑热闹"
    } else if (action === 'work' || action === 'study') {
      /* 工作/学习：保持安静陪伴（气泡已表达），不做打扰动作 */
    }
  });

  window.petAgent.onUsageRemind((usage) => {
    const total = (usage && usage.total) != null ? usage.total : null;
    const cost = (usage && usage.cost) != null ? usage.cost : null;
    const model = (usage && usage.model) || '豆包';
    if (total == null) return;
    const text = `本次回答完成 · 消耗 ${fmtTokens(total)} tok · ${fmtMoney(cost)} · ${model}`;
    showMini(text, true);
    petBounce();
    showBubble();
  });

  // 右键菜单触发的动作（主进程已处理好感度，这里只播动画+音效）
  window.petAgent.onPetChatOpen(openChat);
  window.petAgent.onPetFeed(() => {
    petChew();
    playTone('pop');
    showMini('好吃好吃！');
  });
  window.petAgent.onPetPetHead(() => {
    petPetAnim();
    playTone('ding');
    showMini('被摸头好舒服～');
  });
  window.petAgent.onPetPlay(() => {
    petBounce();
    spawnHearts(6);
    playTone('boing');
    showMini('玩得好开心！');
  });

  // 时间每秒刷新
  setInterval(() => {
    if (state) {
      $('time').textContent = nowTime();
    }
  }, 1000);

  // 首次进入 2.5 秒后自动展示气泡
  setTimeout(showBubble, 2500);

  // 定时随机小动作（不单调）
  const ACTION_LINES = [
    '诶嘿嘿～',
    '摸摸头！',
    '戳戳戳～',
    '我在发呆呢',
    '要抱抱！',
    '主人你看我～',
    '喵～',
    '电量不足啦，快充！'
  ];
  const JOKES = [
    '为什么程序员总分不清万圣节和圣诞节？因为 Oct 31 == Dec 25。',
    '我讲个冷笑话：一天孙悟空饿了，唐僧说吃吧——你笑了吗？',
    '为什么 Wi-Fi 最怕下雨？因为 5G 连不上！',
    '我问电脑：你为什么这么慢？它说：我在思考人生。',
    '为什么宠物不能上月球？因为那边没有猫粮卖。'
  ];
  setInterval(() => {
    // 专注模式（用户空闲）时保持安静，不打扰
    if (state && state.focusMode) return;
    // 偶尔（约1/6）讲个冷笑话，其余做小动作
    if (Math.random() < 1 / 6) {
      showMini(JOKES[Math.floor(Math.random() * JOKES.length)]);
    } else {
      showMini(ACTION_LINES[Math.floor(Math.random() * ACTION_LINES.length)]);
    }
    petBounce();
  }, 9000 + Math.random() * 6000);

  // 定时播报：每 90 秒随机播报一条系统状态
  // 场景感知台词：根据前台应用给出应景文案
  const APP_SCENES = [
    { kw: ['code', 'xcode', 'vscode', 'webstorm', 'intellij', 'cursor', 'windsurf', 'zed', 'sublime'], lines: ['在写代码呀～加油！', 'debug 顺利！我在这看着呢', '写代码记得喝水哦'] },
    { kw: ['chrome', 'safari', 'edge', 'firefox', 'arc'], lines: ['在看网页呀，发现什么好玩的？', '摸鱼要适度哦，我可看着呢～'] },
    { kw: ['wechat', '微信', 'qq', 'discord', 'slack', 'teams', '钉钉', '飞书', 'lark'], lines: ['在聊天呀，我也在陪着你～', '消息好多呀，慢慢回'] },
    { kw: ['notion', 'obsidian', 'notes', '备忘录', 'pages', 'word', 'wps', 'typora', 'markdown'], lines: ['在写东西呀，灵感来了吗？', '写作加油，需要我帮你顺句子吗？'] },
    { kw: ['terminal', 'iterm', '终端', 'warp'], lines: ['敲命令行中…感觉很专业', '黑窗口里都是魔法！'] },
    { kw: ['figma', 'sketch', 'photoshop', '剪映', 'premiere', 'final cut', 'illustrator'], lines: ['在设计东西呀，色彩真好看', '创意在流动～'] },
    { kw: ['zoom', 'meeting', '会议', 'google meet'], lines: ['在开会呀，我安静听着', '会议加油，别睡着啦'] },
    { kw: ['game', 'steam', 'epic'], lines: ['打游戏呢！带带我～', '赢了吗赢了吗？'] }
  ];
  function sceneLine(sys) {
    if (!sys || !sys.frontApp || !sys.frontApp.name) return null;
    const name = String(sys.frontApp.name).toLowerCase();
    for (const s of APP_SCENES) {
      if (s.kw.some((k) => name.includes(k))) {
        return s.lines[Math.floor(Math.random() * s.lines.length)];
      }
    }
    return null;
  }
  // 时间段问候
  function timeGreeting() {
    const h = new Date().getHours();
    if (h >= 5 && h < 9) return '早上好呀，新的一天元气满满！';
    if (h >= 9 && h < 12) return '上午好～今天也要加油哦！';
    if (h >= 12 && h < 14) return '中午好呀，记得吃午饭～';
    if (h >= 14 && h < 18) return '下午好，工作辛苦了！';
    if (h >= 18 && h < 23) return '晚上好呀，今天过得怎么样？';
    return '夜深了，主人早点休息哦～';
  }
  // 天气播报
  function weatherLine(sys) {
    if (!sys || !sys.weather || !sys.weather.ok) return null;
    const w = sys.weather;
    const temp = w.tempC != null ? w.tempC + '°C' : '';
    const city = w.city ? w.city + ' ' : '';
    return (city + (w.desc || '') + ' ' + temp + '，注意添衣哦～').replace(/\s+/g, ' ').trim();
  }

  const STATUS_LINES = () => {
    const s = state || {};
    const sys = s.system || {};
    const st = s.stats || {};
    const p = s.pet || {};
    const lines = [];
    if (sys.battery && sys.battery.ok) {
      if (sys.battery.charging) lines.push('正在充电中，电量 ' + sys.battery.percent + '%');
      else lines.push('电池电量 ' + sys.battery.percent + '%');
    }
    if (sys.network && sys.network.ok) {
      lines.push('网络 ' + sys.network.rtt + 'ms，' + sys.network.grade);
    }
    if (sys.memory && sys.memory.ok && sys.memory.usedPct != null) {
      lines.push('内存占用 ' + sys.memory.usedPct + '%');
    }
    if (st.today && st.today.requests > 0) {
      lines.push('今天已聊 ' + st.today.requests + ' 次，花费 ' + fmtMoney(st.today.cost));
    }
    if (s.balance && s.balance.total != null) {
      lines.push('账户余额 ' + fmtMoney(s.balance.total));
    }
    if (p && p.states) {
      if (p.states.hunger < 30) lines.push('我有点饿了…');
      if (p.states.energy < 30) lines.push('好累呀，想睡会儿');
    }
    const sc = sceneLine(sys);
    if (sc) lines.push(sc);
    const wl = weatherLine(sys);
    if (wl) lines.push(wl);
    lines.push(timeGreeting());
    lines.push(randomChat());
    return lines;
  };

  setInterval(() => {
    if (state && state.focusMode) return;   // 专注模式安静
    const lines = STATUS_LINES();
    showMini(lines[Math.floor(Math.random() * lines.length)]);
  }, 90000);

  /* ---------- Live2D 初始化 ---------- */
  function initLive2D() {
    if (!window.L2Dwidget) {
      console.error('L2Dwidget engine not loaded');
      return;
    }
    window.L2Dwidget.init({
      model: {
        jsonPath: '../assets/live2d/shizuku.model.json',
        scale: 1
      },
      display: {
        superSample: 2,
        width: 200,
        height: 440,
        position: 'right',
        hOffset: 0,
        vOffset: 0
      },
      mobile: { show: false },
      react: { opacity: 1 },
      dev: { border: false },
      dialog: { enable: false, hitokoto: false }
    });
    // 互动/拖动只绑定在 Live2D 容器上（修复双重触发）
    setTimeout(tryBindLive2D, 500);
    console.log('[renderer] Live2D init requested');
  }

  if (document.readyState === 'complete') {
    setTimeout(initLive2D, 300);
  } else {
    window.addEventListener('load', () => setTimeout(initLive2D, 300));
  }
})();
