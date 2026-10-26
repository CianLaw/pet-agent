/* 豆包桌宠 · 手机版主界面表演引擎（v5.9.4）
 * 与桌面端 / 悬浮窗同一套：motionBus 连续参数插值 + Idle 呼吸层 + 眨眼 +
 * 伪骨骼部件弹簧物理 + 加权待机行为链 + Action Director + 物品持有状态机。
 * 所有姿态变化都有起点、路径、落点——绝不"凭空变出来"，绝不僵直站立。
 */
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);

  const bubble = $('bubble');
  const bubbleText = $('bubbleText');
  const petBody = $('petBody');
  const petImg = $('petImg');
  const particles = $('particles');
  const heldItem = $('heldItem');
  const skinHeadGroup = $('skinHeadGroup');
  const rigHead = $('rigHead');
  const rigBlinkHalf = $('rigBlinkHalf');
  const rigBlinkClosed = $('rigBlinkClosed');
  const partWrap = $('partWrap');

  /* ---------- 团团台词库（与桌面端 / 悬浮窗完全一致） ---------- */
  const CHAT_LINES = [
    '咿呀——吓我一跳捏',
    '戳什么戳，本兔是让你云吸的，不是让你戳的',
    '这一戳，加一个胡萝卜，谢谢',
    '呼……刚才差点睡着，被你戳醒了',
    '你的手指是棒棒糖做的吗？这么爱戳',
    '好好好，陪你玩，就一秒钟哦',
    '别看我，看兔子',
    '本兔今天也很可爱，不信你看',
    '来啦来啦，兔兔驾到～',
    '你在忙啥？让兔看看',
    '偷偷告诉你，本兔是你的幸运兔',
    '充电完毕，又能再可爱一天'
  ];
  const ACTION_LINES = [
    '哈——欠……本兔的睡眠质量，了解一下',
    '一二三，起！这桌子今天归本兔管了',
    '吸溜～咖啡续命，兔命也是命',
    '看书看书，看的是《胡萝卜的一百种吃法》',
    '嗯？手机有消息？我先看一眼',
    '耳朵痒痒的，甩一下',
    '转个圈给你看看裙摆，好看吧？',
    '本兔的心跳，怦怦的，听见没'
  ];
  const JOKES = [
    '兔子为什么不吃窝边草？因为外卖到了',
    '团团去面试，考官问：你有什么特长？团团：耳朵特长',
    '为什么团团从不迟到？因为胡萝卜只能保温不能包退',
    '团团减肥失败的原因：胡萝卜是素的，但开心果不是',
    '团团今天起得早，因为闹钟叫了两次：起床和回笼'
  ];
  const FEED_LINES = ['这个好好吃！', '主人喂我啦！', '吃饱饱，开心心～', '再来一口嘛'];
  const PET_LINES = ['嘿嘿，好舒服～', '再摸摸头嘛！', '喵呜～被摸到了！', '酥酥麻麻的~'];
  const PLAY_LINES = ['陪我玩咯！', '追球球～', '好开心呀！', '再来一局！'];
  function timeGreeting() {
    const h = new Date().getHours();
    if (h < 6) return '夜深啦，本兔守着你～';
    if (h < 11) return '早上好呀，胡萝卜早餐已就位';
    if (h < 14) return '中午好，本兔在偷偷打盹';
    if (h < 18) return '下午好，来杯胡萝卜汁吗？';
    return '晚上好，今天也要开开心心哦';
  }
  function pickLine(key) {
    const pool = key === 'feed' ? FEED_LINES : key === 'pet' ? PET_LINES : key === 'play' ? PLAY_LINES : CHAT_LINES;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /* ---------- 持久化：当前皮肤（与主 App 同步） ---------- */
  const KEY = 'doubao_pet_mobile_v1';
  let data = {};
  try { data = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) {}
  let lastSkinId = data.skin || 'doubaotu';

  /* ---------- 说话：气泡 + 配音 + 头部轻点头 + 呼吸加快（有起承转合） ---------- */
  let bubbleTimer = null;
  let talking = false;
  function say(text, voiceKey) {
    bubbleText.textContent = text;
    bubble.classList.remove('hidden');
    talking = true;
    rig.nodPx = 1.1;
    if (voiceKey) playVoice(voiceKey);
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => {
      bubble.classList.add('hidden');
      talking = false;
    }, 2500);
  }

  /* ---------- 团团配音：预生成台词音频（TTS），说话即发声 ---------- */
  const VOICE = {
    'greet-morning': 'assets/sound/greet_morning.ogg',
    'greet-noon': 'assets/sound/greet_noon.ogg',
    'greet-afternoon': 'assets/sound/greet_afternoon.ogg',
    'greet-evening': 'assets/sound/greet_evening.ogg',
    'feed-yummy': 'assets/sound/feed_yummy.ogg',
    'feed-love': 'assets/sound/feed_love.ogg',
    'pet-comfy': 'assets/sound/pet_comfy.ogg',
    'pet-more': 'assets/sound/pet_more.ogg',
    'play-with': 'assets/sound/play_with.ogg',
    'play-happy': 'assets/sound/play_happy.ogg',
    'weather-rain': 'assets/sound/weather_rain.ogg',
    'weather-sun': 'assets/sound/weather_sun.ogg',
    'weather-cold': 'assets/sound/weather_cold.ogg'
  };
  let voiceEl = null;
  function playVoice(key) {
    const src = VOICE[key];
    if (!src) return;
    try {
      if (!voiceEl) { voiceEl = new Audio(); voiceEl.volume = 0.9; }
      voiceEl.src = src;
      voiceEl.currentTime = 0;
      const pr = voiceEl.play();
      if (pr && pr.catch) pr.catch(() => {});
    } catch (_) {}
  }
  function voiceGreetKey() {
    const h = new Date().getHours();
    if (h < 6) return 'greet-evening';
    if (h < 11) return 'greet-morning';
    if (h < 14) return 'greet-noon';
    if (h < 18) return 'greet-afternoon';
    return 'greet-evening';
  }

  /* ---------- 天气感知：下雨/晴天/寒冷提示（拿不到天气静默降级，不打扰） ---------- */
  let lastWeather = null;
  function weatherWord(cond) {
    const c = (cond || '').toLowerCase();
    if (c.includes('rain') || c.includes('drizzle') || c.includes('shower') || c.includes('thunder')) return 'rain';
    if (c.includes('snow') || c.includes('sleet') || c.includes('blizzard')) return 'snow';
    if (c.includes('sun') || c.includes('clear') || c.includes('fair')) return 'sun';
    if (c.includes('cloud') || c.includes('overcast') || c.includes('fog') || c.includes('mist') || c.includes('haze')) return 'cloud';
    return null;
  }
  function weatherLine(word, temp) {
    if (word === 'rain') return '外面下雨啦，出门记得带伞哦';
    if (word === 'snow') return '下雪啦！本兔想出去打滚～';
    if (word === 'sun') return '外面阳光好好，一起晒太阳吧～';
    if (word === 'cloud') return '今天云好多，适合在家陪本兔玩';
    if (temp <= 12) return '有点冷哦，多穿点再出门';
    if (temp >= 30) return '好热呀，本兔想喝冰胡萝卜汁～';
    return null;
  }
  function checkWeather() {
    fetch('https://wttr.in/?format=j1', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j) => {
        if (!j || !j.current_condition || !j.current_condition[0]) return;
        const cc = j.current_condition[0];
        const word = weatherWord(cc.weatherDesc && cc.weatherDesc[0] && cc.weatherDesc[0].value);
        const temp = parseInt(cc.temp_C, 10) || 0;
        if (lastWeather && lastWeather.word === word && Math.abs(lastWeather.temp - temp) < 4) return;
        lastWeather = { word, temp };
        const line = weatherLine(word, temp);
        if (line && !document.hidden) say(line);
      });
  }

  /* ---------- 粒子特效 ---------- */
  function spawnHearts(count, icons) {
    const box = icons || ['💗', '💙', '✨', '💖', '🌟'];
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'main-particle';
      p.textContent = box[Math.floor(Math.random() * box.length)];
      p.style.left = (18 + Math.random() * 64) + '%';
      p.style.bottom = (30 + Math.random() * 26) + '%';
      p.style.animationDelay = (Math.random() * 0.2) + 's';
      particles.appendChild(p);
      setTimeout(() => p.remove(), 1200);
    }
  }

  /* ---------- 伪骨骼层：眨眼 + 头部视差（贴图皮肤专用） ---------- */
  const rig = {
    group: null, headImg: null, blinkHalf: null, blinkClosed: null,
    on: false,
    followX: 0, followY: 0, followTX: 0, followTY: 0,
    blinkTimer: null, blinkBusy: false,
    partList: [],
    headTilt: 0,
    nodPx: 0,
    dragVX: 0,
    interactLean: 0, interactLeanT: 0,   // 互动时裙摆联动前倾（起→承→落，缓慢回正）
    _prevTilt: 0
  };

  function setBlinkFrame(which) {
    if (!rig.on || !rig.blinkHalf) return;
    rig.blinkHalf.style.opacity = which === 'half' ? '1' : '0';
    rig.blinkClosed.style.opacity = which === 'closed' ? '1' : '0';
  }
  function doBlink(opts) {
    if (!rig.on || rig.blinkBusy) return;
    rig.blinkBusy = true;
    const hold = opts && opts.hold;
    if (hold) {
      setBlinkFrame('closed');
      rig.nodPx = 0.9;
      setTimeout(() => { setBlinkFrame('none'); rig.blinkBusy = false; }, hold);
    } else {
      setBlinkFrame('half');
      rig.nodPx = 0.7;
      setTimeout(() => setBlinkFrame('closed'), 55);
      setTimeout(() => setBlinkFrame('half'), 150);
      setTimeout(() => { setBlinkFrame('none'); rig.blinkBusy = false; }, 205);
    }
  }
  function scheduleBlink() {
    clearTimeout(rig.blinkTimer);
    rig.blinkTimer = setTimeout(() => {
      if (rig.on) {
        doBlink();
        if (Math.random() < 0.22) setTimeout(() => doBlink(), 420);
      }
      scheduleBlink();
    }, 2300 + Math.random() * 3800);
  }

  /* ---------- 伪骨骼部件：耳朵/丝带弹簧物理（与桌面 buildParts 同构） ---------- */
  function buildParts(skinMeta) {
    if (rig.partWrap) rig.partWrap.remove();
    rig.partList = [];
    const parts = skinMeta && skinMeta.rig && skinMeta.rig.parts;
    if (!parts || !parts.earL) return;
    const wrap = document.createElement('div');
    wrap.className = 'skin-part-wrap';
    partWrap.appendChild(wrap);
    rig.partWrap = wrap;
    const SCALE = 200 / 496, TOP = (440 - 660 * SCALE) / 2;
    const defs = [
      Object.assign({ kind: 'ear', z: 5, k: 150, damp: 9, windAmp: 1.1, windFreq: 0.8, phase: 0 }, parts.earL),
      Object.assign({ kind: 'ear', z: 5, k: 150, damp: 9, windAmp: 1.1, windFreq: 0.92, phase: 2.1 }, parts.earR),
      Object.assign({ kind: 'ribbon', z: 6, k: 34, damp: 4.4, windAmp: 3.4, windFreq: 0.55, phase: 1.2 }, parts.ribbonL),
      Object.assign({ kind: 'ribbon', z: 6, k: 30, damp: 4.0, windAmp: 3.6, windFreq: 0.62, phase: 3.6 }, parts.ribbonR),
      Object.assign({ kind: 'skirt', z: 6, k: 24, damp: 3.4, windAmp: 1.2, windFreq: 0.42, phase: 0.6 }, parts.skirt)
    ];
    for (const def of defs) {
      if (!def || !def.file || !def.box) continue;
      const el = document.createElement('img');
      el.className = 'skin-part';
      el.alt = '';
      const [x0, y0, x1, y1] = def.box;
      el.src = 'assets/skin/' + lastSkinId + '/' + def.file;
      el.style.left = (x0 * SCALE) + 'px';
      el.style.top = (y0 * SCALE + TOP) + 'px';
      el.style.width = ((x1 - x0) * SCALE) + 'px';
      el.style.height = ((y1 - y0) * SCALE) + 'px';
      el.style.zIndex = def.z;
      const ox = ((def.pivot[0] - x0) / (x1 - x0) * 100).toFixed(1);
      const oy = ((def.pivot[1] - y0) / (y1 - y0) * 100).toFixed(1);
      el.style.transformOrigin = `${ox}% ${oy}%`;
      wrap.appendChild(el);
      rig.partList.push({
        el, kind: def.kind, k: def.k, damp: def.damp,
        windAmp: def.windAmp, windFreq: def.windFreq, phase: def.phase,
        angle: 0, vel: 0, twitchT: 0
      });
    }
  }

  /* ---------- 皮肤加载（异步读 skin.json，与桌面 scanSkins 同逻辑） ---------- */
  function ensureRig() {
    fetch('assets/skin/' + lastSkinId + '/skin.json?v=' + Date.now(), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((meta) => {
        petImg.src = 'assets/skin/' + lastSkinId + '/pet.png';
        const want = !!(meta.rig && meta.rig.blink);
        rig.on = want;
        rig.group = skinHeadGroup;
        rig.headImg = rigHead;
        rig.blinkHalf = rigBlinkHalf;
        rig.blinkClosed = rigBlinkClosed;
        if (!want) {
          skinHeadGroup.classList.add('hidden');
          if (rig.partWrap) { rig.partWrap.remove(); rig.partWrap = null; }
          rig.partList = [];
          clearTimeout(rig.blinkTimer);
          return;
        }
        skinHeadGroup.classList.remove('hidden');
        const dir = 'assets/skin/' + lastSkinId + '/';
        rigHead.src = (meta.rig.parts && meta.rig.parts.head) ? dir + meta.rig.parts.head : 'assets/skin/' + lastSkinId + '/pet.png';
        rigBlinkHalf.src = dir + 'eyes_half.png';
        rigBlinkClosed.src = dir + 'eyes_closed.png';
        const ny = Math.max(0.3, Math.min(0.5, (meta.rig.neckY || 0.41)));
        const mask = `linear-gradient(180deg, #000 0 ${((ny - 0.07) * 100).toFixed(1)}%, transparent ${((ny + 0.03) * 100).toFixed(1)}%)`;
        rigHead.style.webkitMaskImage = mask;
        rigHead.style.maskImage = mask;
        buildParts(meta);
        setBlinkFrame('none');
        scheduleBlink();
      });
  }

  /* ---------- motionBus：连续参数插值 + Idle 呼吸层（与桌面一致） ---------- */
  const motionBus = {
    els: {}, t: 0,
    cur: {}, tgt: {}, spd: {},
    init(id, el) {
      this.els[id] = el;
      this.cur[id] = { ty: 0, tx: 0, sc: 1, rt: 0, op: 1 };
      this.tgt[id] = { ...this.cur[id] };
      this.spd[id] = 0.12;
    },
    pose(id, target, opts = {}) {
      if (!this.els[id]) return;
      if (opts.speed != null) this.spd[id] = opts.speed;
      const c = this.tgt[id];
      this.tgt[id] = {
        ty: target.ty != null ? target.ty : c.ty,
        tx: target.tx != null ? target.tx : c.tx,
        sc: target.sc != null ? target.sc : c.sc,
        rt: target.rt != null ? target.rt : c.rt,
        op: target.op != null ? target.op : c.op
      };
    },
    snap(id, target) {
      if (!this.els[id]) return;
      this.pose(id, target);
      Object.assign(this.cur[id], this.tgt[id]);
    },
    play(id, target, opts = {}) {
      this.pose(id, target, opts);
      const at = opts.at || 0;
      const settle = Math.max(160, 850 / (opts.speed || this.spd[id] || 0.12));
      return new Promise((res) => setTimeout(res, at + settle));
    },
    tick(dt) {
      if (!isFinite(dt) || dt <= 0) dt = 0.016;
      this.t += dt;
      const rabbitMode = lastSkinId.startsWith('doubaotu');
      const talkingAmp = talking ? 1.6 : 0;
      const amp = (rabbitMode ? 3.0 : 2.2) + talkingAmp;
      const scAmp = (rabbitMode ? 0.010 : 0.008) + (talking ? 0.006 : 0);
      const freq = (rabbitMode ? 1.6 : 1.7) * (talking ? 1.5 : 1);
      const idleTy = Math.sin(this.t * freq) * amp;
      const idleSc = 1 + Math.sin(this.t * freq) * scAmp;
      for (const id in this.els) {
        const c = this.cur[id], tg = this.tgt[id];
        const k = 1 - Math.exp(-this.spd[id] * dt * 60);
        c.ty += (tg.ty - c.ty) * k;
        c.tx += (tg.tx - c.tx) * k;
        c.sc += (tg.sc - c.sc) * k;
        c.rt += (tg.rt - c.rt) * k;
        c.op += (tg.op - c.op) * k;
        const el = this.els[id];
        if (id === 'petBody') {
          const swayRt = Math.sin(this.t * 0.5) * 0.7;
          const swayTx = Math.sin(this.t * 0.35) * 1.4;
          el.style.transform = `translateY(${c.ty + idleTy}px) translateX(${c.tx + swayTx}px) scale(${c.sc * idleSc}) rotate(${c.rt + swayRt}deg)`;
          if (rig.on) {
            rig.followX += (rig.followTX - rig.followX) * 0.05;
            rig.followY += (rig.followTY - rig.followY) * 0.05;
            rig.headTilt += ((swayRt * 0.5 + rig.followX * 0.55) - rig.headTilt) * 0.04;
            const headRt = rig.headTilt + rig.followY * 0.25;
            const headTy = idleTy * 0.3 + rig.nodPx;
            if (skinHeadGroup && !skinHeadGroup.classList.contains('hidden')) {
              skinHeadGroup.style.transform =
                `translateY(${c.ty * 0.6 + headTy}px) translateX(${c.tx + rig.followX * 0.5}px) scale(${c.sc * idleSc}) rotate(${c.rt * 0.6 + headRt}deg)`;
            }
            const tiltVel = rig.headTilt - (rig._prevTilt || 0);
            rig._prevTilt = rig.headTilt;
            rig.interactLean += (rig.interactLeanT - rig.interactLean) * (1 - Math.exp(-4.5 * dt * 60));
            for (const part of rig.partList) {
              let target;
              if (part.kind === 'ear') {
                if (Math.random() < dt * 0.35) part.vel += (Math.random() < 0.5 ? -1 : 1) * (45 + Math.random() * 55);
                target = -tiltVel * 2.4 + Math.sin(this.t * part.windFreq + part.phase) * part.windAmp + rig.followX * 0.9;
              } else {
                const lean = part.kind === 'skirt' ? rig.interactLean : rig.interactLean * 0.25;
                target = Math.sin(this.t * part.windFreq + part.phase) * part.windAmp
                  + Math.sin(this.t * 1.7 + part.phase * 2) * part.windAmp * 0.35
                  + lean
                  - rig.dragVX * 0.045 - rig.followX * 1.1;
              }
              const acc = (target - part.angle) * part.k - part.vel * part.damp;
              part.vel += acc * dt;
              part.angle += part.vel * dt;
              part.el.style.transform = `rotate(${part.angle.toFixed(2)}deg)`;
            }
            rig.dragVX *= 0.9;
            rig.nodPx *= 0.88;
          }
        } else {
          el.style.opacity = Math.max(0, Math.min(1, c.op));
          el.style.transform = `translateY(${c.ty}px) translateX(${c.tx}px) scale(${c.sc}) rotate(${c.rt}deg)`;
        }
      }
    }
  };

  /* ---------- 物品持有状态机（过渡进出，不凭空出现/消失） ---------- */
  const director = { lock: false, cancelled: false };
  const itemState = { held: null, stowTimer: null };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ITEM_POSE = {
    handHidden: { tx: 30, ty: 24, op: 0, rt: 0 },
    held:       { tx: 24, ty: 8, op: 1, rt: -4 },
    drink:  { mid: { tx: 26, ty: 6, rt: 4 },  up: { tx: 14, ty: -84, rt: -6 } },
    read:   { mid: { tx: 34, ty: 16, rt: -8 }, up: { tx: 12, ty: -56, rt: 5 } },
    phone:  { mid: { tx: 38, ty: 14, rt: -10 }, up: { tx: 20, ty: -50, rt: -5 } }
  };

  async function itemPickup(spec) {
    clearTimeout(itemState.stowTimer);
    if (itemState.held !== spec.icon) {
      if (itemState.held) await itemStow();
      itemState.held = spec.icon;
      heldItem.textContent = spec.icon;
      motionBus.snap('itemBody', ITEM_POSE.handHidden);
      heldItem.classList.remove('hidden');
      const seq = ITEM_POSE[spec.kind] || ITEM_POSE.drink;
      rig.interactLeanT = 7;                       // 抬手：裙摆同向前倾，水杯路径=伸手→握住→举起
      await motionBus.play('itemBody', Object.assign({ op: 1 }, seq.mid), { speed: 0.22 });
      await motionBus.play('itemBody', seq.up, { speed: 0.16 });
      await sleep(700);
    }
  }
  async function itemStow() {
    if (!itemState.held) return;
    itemState.held = null;
    clearTimeout(itemState.stowTimer);
    rig.interactLeanT = 2;                        // 放下：裙摆缓收，不是瞬回
    await motionBus.play('itemBody', ITEM_POSE.handHidden, { speed: 0.18 });
    heldItem.classList.add('hidden');
    motionBus.snap('itemBody', ITEM_POSE.handHidden);
    rig.interactLeanT = 0;                        // 完全收好后落回
  }
  function keepHeld(ms) {
    clearTimeout(itemState.stowTimer);
    itemState.stowTimer = setTimeout(() => itemStow(), ms);
  }

  /* ---------- 加权待机行为链（起点→过程→落回 Idle，绝无硬切） ---------- */
  const IDLE_ACTIONS = {
    lookAround: { weight: 20, steps: [
      [0, { rt: 6, tx: 3 }, 0.14],
      [700, { rt: -6, tx: -3 }, 0.1],
      [1500, { rt: 0, tx: 0 }, 0.09]
    ] },
    nod: { weight: 16, steps: [
      [0, { ty: 4, rt: 3 }, 0.16],
      [260, { ty: 0, rt: 0 }, 0.14],
      [520, { ty: 3, rt: 2 }, 0.16],
      [780, { ty: 0, rt: 0 }, 0.12]
    ] },
    tilt: { weight: 14, steps: [
      [0, { rt: 10 }, 0.15],
      [900, { rt: -4 }, 0.12],
      [1400, { rt: 0 }, 0.1]
    ] },
    stretch: { weight: 11, steps: [
      [0, { ty: -8, sc: 1.06 }, 0.13],
      [900, { ty: 0, sc: 1 }, 0.1]
    ] },
    rubEyes: { weight: 11, eyesClosed: true, steps: [
      [0, { ty: 6, rt: 6 }, 0.15],
      [350, { ty: 4, rt: -5 }, 0.14],
      [700, { ty: 0, rt: 0 }, 0.12]
    ] },
    yawn: { weight: 6, steps: [
      [0, { ty: 5, sc: 1.05 }, 0.12],
      [600, { ty: 1, sc: 0.99 }, 0.12],
      [1100, { ty: 0, sc: 1 }, 0.1]
    ] },
    drink: { weight: 7, item: { icon: '☕', kind: 'drink' }, keep: 22000, steps: [
      [0,   { ty: 1, rt: 0 }, 0.14],
      [260, { ty: 2, rt: -3, tx: -1 }, 0.12],
      [900, { ty: 4, rt: -4 }, 0.1],
      [1550,{ ty: 1, rt: 0 }, 0.12]
    ] },
    read: { weight: 7, item: { icon: '📖', kind: 'read' }, keep: 26000, steps: [
      [0,   { ty: 1, rt: 0 }, 0.12],
      [260, { ty: 3, rt: 2 }, 0.12],
      [1300,{ ty: 4, rt: 2, tx: -1 }, 0.1],
      [1950,{ ty: 1, rt: 0 }, 0.12]
    ] },
    phone: { weight: 8, item: { icon: '📱', kind: 'phone' }, keep: 32000, steps: [
      [0,   { ty: 1, rt: 0 }, 0.12],
      [240, { ty: 2, rt: -2 }, 0.12],
      [1300,{ ty: 2, rt: -3 }, 0.1],
      [1850,{ ty: 1, rt: 0 }, 0.12]
    ] }
  };
  /* 兔娘专属：耳朵抖 / 转圈跳舞 / 比心跳 */
  const RABBIT_EXTRA = {
    earTwitch: { weight: 20, steps: [
      [0, { sc: 1.03, ty: -4, rt: 2 }, 0.24],
      [140, { sc: 0.985, ty: 3, rt: -2 }, 0.24],
      [300, { sc: 1.03, ty: -4, rt: 2 }, 0.24],
      [450, { sc: 0.99, ty: 1, rt: 0 }, 0.2],
      [680, { sc: 1, ty: 0 }, 0.16]
    ] },
    dance: { weight: 10, steps: [
      [0, { rt: 7, ty: -6, sc: 1.02 }, 0.16],
      [240, { rt: -7, ty: -2 }, 0.14],
      [480, { rt: 6, ty: -8, sc: 1.03 }, 0.14],
      [720, { rt: -5, ty: -3 }, 0.13],
      [980, { rt: 0, ty: 0, sc: 1 }, 0.12]
    ] },
    heartJump: { weight: 16, steps: [
      [0, { ty: -14, rt: 4, sc: 1.04 }, 0.22],
      [320, { ty: 0, rt: 0 }, 0.14],
      [640, { ty: -8, rt: -3 }, 0.18],
      [960, { ty: 0, rt: 0 }, 0.12]
    ] }
  };
  function idlePool() {
    if (lastSkinId.startsWith('doubaotu')) return Object.assign({}, IDLE_ACTIONS, RABBIT_EXTRA);
    return IDLE_ACTIONS;
  }
  function actionDuration(a) {
    const body = a.steps && a.steps.length ? a.steps[a.steps.length - 1][0] : 0;
    return Math.max(body, a.item ? 2150 : 0) + 350;
  }

  /* ---------- Action Director：动作锁 + 序列执行器 ---------- */
  async function executeSequence(action) {
    if (director.lock) return;
    director.lock = true;
    director.cancelled = false;
    try {
      if (action.item) await itemPickup(action.item);
      if (action.eyesClosed && rig.on) setBlinkFrame('closed');
      for (const [d, pose, spd] of action.steps) {
        if (director.cancelled) break;
        await motionBus.play('petBody', pose, { at: d, speed: spd });
      }
      if (action.eyesClosed && rig.on) setBlinkFrame('none');
      if (director.cancelled) return;
      if (action.item) {
        if (action.keep) {
          await motionBus.play('itemBody', ITEM_POSE.held, { speed: 0.18 });
          keepHeld(action.keep);
        } else {
          await itemStow();
        }
      }
      if (!director.cancelled && Math.random() < 0.35) {
        say(ACTION_LINES[Math.floor(Math.random() * ACTION_LINES.length)]);
      }
    } finally {
      director.lock = false;
    }
  }
  function scheduleIdle() {
    clearTimeout(idleTimer);
    const rabbitMode = lastSkinId.startsWith('doubaotu');
    const gap = rabbitMode ? 4200 + Math.random() * 6800 : 9000 + Math.random() * 14000;
    idleTimer = setTimeout(() => {
      if (director.lock) { scheduleIdle(); return; }
      const pool = idlePool();
      const pool2 = {};
      for (const k in pool) {
        if (pool[k].item && itemState.held && itemState.held !== pool[k].item.icon) continue;
        pool2[k] = pool[k];
      }
      const total = Object.keys(pool2).reduce((a, k) => a + pool2[k].weight, 0);
      let r = Math.random() * total;
      let action = pool2.lookAround;
      for (const k in pool2) {
        r -= pool2[k].weight;
        if (r <= 0) { action = pool2[k]; break; }
      }
      executeSequence(action);
      idleTimer = setTimeout(scheduleIdle, actionDuration(action) + (rabbitMode ? 1600 + Math.random() * 2400 : 2600 + Math.random() * 4200));
    }, gap);
  }
  let idleTimer = null;

  /* ---------- 互动表演序列（起→承→合，绝不瞬切） ---------- */
  function cancelCurrent() { director.cancelled = true; }

  function actVisual(key) {
    cancelCurrent();
    if (key === 'feed') {
      // 喂食：低头看→咀嚼点头（三次小幅起伏）→抬头回正；裙摆随低头前倾缓回
      rig.interactLeanT = 3;
      motionBus.pose('petBody', { ty: 6, rt: 5, sc: 0.98 }, { speed: 0.18 });
      setTimeout(() => motionBus.pose('petBody', { ty: 8, rt: 6 }, { speed: 0.22 }), 220);
      setTimeout(() => motionBus.pose('petBody', { ty: 5, rt: 4 }, { speed: 0.22 }), 480);
      setTimeout(() => motionBus.pose('petBody', { ty: 7, rt: 5 }, { speed: 0.22 }), 720);
      setTimeout(() => motionBus.pose('petBody', { ty: 3, rt: 2 }, { speed: 0.16 }), 960);
      setTimeout(() => { motionBus.pose('petBody', { ty: 0, rt: 0, sc: 1 }, { speed: 0.08 }); rig.interactLeanT = 0; }, 1250);
      spawnHearts(6, ['🍎', '🍰', '🍖', '🍩', '🥕', '✨']);
    } else if (key === 'pet') {
      // 摸摸：前倾贴近→微颤回应→回正（贴贴的起承转合）；裙摆随身体前倾
      rig.interactLeanT = 4;
      motionBus.pose('petBody', { ty: 3, rt: 4, sc: 1.01 }, { speed: 0.16 });
      setTimeout(() => motionBus.pose('petBody', { ty: 2, rt: -2 }, { speed: 0.2 }), 180);
      setTimeout(() => motionBus.pose('petBody', { ty: 3, rt: 3 }, { speed: 0.2 }), 360);
      setTimeout(() => { motionBus.pose('petBody', { ty: 0, rt: 0, sc: 1 }, { speed: 0.1 }); rig.interactLeanT = 0; }, 560);
      spawnHearts(7);
    } else if (key === 'play') {
      // 陪玩：起跳→滞空→落地缓冲→站稳（三段式跳跃曲线）；起跳时裙摆向后飘
      rig.interactLeanT = -4;
      motionBus.pose('petBody', { ty: -4, sc: 0.97, rt: 3 }, { speed: 0.2 });
      setTimeout(() => motionBus.pose('petBody', { ty: -22, sc: 1.08, rt: -4 }, { speed: 0.13 }), 120);
      setTimeout(() => motionBus.pose('petBody', { ty: -14, sc: 1.03 }, { speed: 0.12 }), 460);
      setTimeout(() => { motionBus.pose('petBody', { ty: 3, sc: 0.97, rt: 2 }, { speed: 0.18 }); rig.interactLeanT = 1; }, 760);
      setTimeout(() => { motionBus.pose('petBody', { ty: 0, sc: 1, rt: 0 }, { speed: 0.1 }); rig.interactLeanT = 0; }, 1000);
      spawnHearts(8, ['⭐', '🌟', '✨', '💙', '💫']);
    } else {
      // 点击：轻弹一下（小幅度起落），裙摆跟着颤一下
      rig.interactLeanT = 2;
      motionBus.pose('petBody', { ty: -8, sc: 1.04, rt: 3 }, { speed: 0.2 });
      setTimeout(() => motionBus.pose('petBody', { ty: 1, sc: 0.99 }, { speed: 0.15 }), 150);
      setTimeout(() => { motionBus.pose('petBody', { ty: 0, sc: 1, rt: 0 }, { speed: 0.08 }); rig.interactLeanT = 0; }, 330);
      spawnHearts(3);
    }
  }

  /* ---------- 触感反馈（Android） ---------- */
  function buzz(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 18); } catch (_) {}
  }

  /* ---------- 对外接口（供 app.js 委托视觉与台词） ---------- */
  window.__mainPet = {
    say,
    pickLine,
    actVisual,
    cancelCurrent,
    buzz,
    refreshRig() { ensureRig(); }
  };

  /* ---------- 初始化 ---------- */
  motionBus.init('petBody', petBody);
  motionBus.init('itemBody', heldItem);
  let lastFrame = performance.now();
  (function frame(now) {
    motionBus.tick(Math.min((now - lastFrame) / 1000, 0.05));
    lastFrame = now;
    requestAnimationFrame(frame);
  })(performance.now());
  scheduleIdle();

  /* 天气感知：首屏稳定后查一次，之后每 30 分钟刷新（失败静默） */
  setTimeout(checkWeather, 5000);
  setInterval(checkWeather, 30 * 60 * 1000);

  if (document.readyState === 'complete') {
    setTimeout(ensureRig, 300);
  } else {
    window.addEventListener('load', () => setTimeout(ensureRig, 300));
  }
})();
