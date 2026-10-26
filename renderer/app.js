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
  const statusPill = $('statusPill');
  const walkLayer = $('walkLayer');
  const walkSprite = $('walkSprite');
  const sleepOverlay = $('sleepOverlay');
  const sleepZzz = $('sleepZzz');
  const heldItem = $('heldItem');

  let state = null;
  let lastSpeed = { ts: 0, tokens: 0 };
  let clickCount = 0;
  let clickTimer = null;
  let mouseOverInteractive = false;
  let walkAnim = null;
  let petMode = 'awake';   // awake | idle(发呆) | sleep(睡觉)
  let modeTimer = null;
  let lastSkinId = '';     // 当前皮肤 id（motionBus/行为层引用，必须在本文件最前声明）

  const CHAT_LINES = [
    '咿呀——吓我一跳捏',
    '戳什么戳，本兔是让你云吸的，不是让你戳的',
    '这一戳，加一个胡萝卜，谢谢',
    '呼……刚才差点睡着，被你戳醒了',
    '你的鼠标是棒棒糖做的吗？这么爱戳',
    '好好好，陪你玩，就一秒钟哦',
    '别看我，看兔子',
    '本兔今天也很可爱，不信你看',
    '来啦来啦，兔兔驾到～',
    '你在忙啥？让兔看看',
    '偷偷告诉你，本兔是你的幸运兔',
    '充电完毕，又能再可爱一天'
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

    /* ---------- MotionBus：连续参数表演引擎 ----------
     * 放弃"播放动画片段/瞬间切类"的离散思路：
     * 每个可见姿态参数（translateY/X、scale、rotate、opacity）维护
     * 当前值 → 目标值的连续插值链路，每帧用缓动逼近；
     * Idle 呼吸微动作为常驻底层，任何动作结束后自然落回它——
     * 姿态变化有起点、有路径、有落点，不再"闪现/凭空变出来"。
     */
    const motionBus = {
      els: {}, t: 0,
      cur: {}, tgt: {}, spd: {},
      init(id, el) {
        this.els[id] = el;
        this.cur[id] = { ty: 0, tx: 0, sc: 1, rt: 0, op: 1 };
        this.tgt[id] = { ...this.cur[id] };
        this.spd[id] = 0.12;
      },
      // 设置目标姿态（连续逼近）；可用 setTimeout 追加下一段目标形成"动作序列"
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
      // 立即跳到某姿态（用于"隐形复位"，避免残留插值导致下次出场闪跳）
      snap(id, target) {
        if (!this.els[id]) return;
        this.pose(id, target);
        Object.assign(this.cur[id], this.tgt[id]);
      },
      // 可等待的动作步（Action Director 用）：在 at 毫秒后触发，姿态大致到位即 resolve。
      // 连续插值本身承担缓动（ease），导演器只管顺序与节拍——动作永远有起点、路径、落点。
      play(id, target, opts = {}) {
        this.pose(id, target, opts);
        const at = opts.at || 0;
        const settle = Math.max(160, 850 / (opts.speed || this.spd[id] || 0.12));
        return new Promise((res) => setTimeout(res, at + settle));
      },
      tick(dt) {
        if (!isFinite(dt) || dt <= 0) dt = 0.016;
        this.t += dt;
        // Idle 基底层：永远在运行的呼吸浮动（任何动作结束后自然落回）
        // Idle 呼吸基底：整体缓慢起伏；"活着"的细节主要由头颈分层与眨眼承担
        const rabbitMode = lastSkinId.startsWith('doubaotu');
        const amp = rabbitMode ? 3.0 : 2.2;
        const scAmp = rabbitMode ? 0.010 : 0.008;
        const freq = rabbitMode ? 1.6 : 1.7;
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
            // 动作层 + Idle 呼吸层 + 慢速重心摇摆（像站着的活物，不是贴图）
            const swayRt = Math.sin(this.t * 0.5) * 0.7;
            const swayTx = Math.sin(this.t * 0.35) * 1.4;
            el.style.transform = `translateY(${c.ty + idleTy}px) translateX(${c.tx + swayTx}px) scale(${c.sc * idleSc}) rotate(${c.rt + swayRt}deg)`;
            if (rig.on) {
              rig.followX += (rig.followTX - rig.followX) * 0.05;
              rig.followY += (rig.followTY - rig.followY) * 0.05;
              // ---- 头颈：绕颈部 pivot 转动，符合人的逻辑 ----
              // 人的头不会"上下提"：呼吸只是胸腔起伏，头是随重心轻微倾斜 + 偶尔低头轻点。
              rig.headTilt += ((swayRt * 0.5 + rig.followX * 0.55) - rig.headTilt) * 0.04;
              const headRt = rig.headTilt + rig.followY * 0.25;
              const headTy = idleTy * 0.3 + rig.nodPx;
              if (rig.group) {
                rig.group.style.transform =
                  `translateY(${c.ty * 0.6 + headTy}px) translateX(${c.tx + rig.followX * 0.5}px) scale(${c.sc * idleSc}) rotate(${c.rt * 0.6 + headRt}deg)`;
              }
              // ---- 分层部件弹簧物理 ----
              const tiltVel = rig.headTilt - (rig._prevTilt || 0);
              rig._prevTilt = rig.headTilt;
              rig.interactLean += (rig.interactLeanT - rig.interactLean) * (1 - Math.exp(-4.5 * dt * 60));
              for (const part of rig.partList) {
                let target;
                if (part.kind === 'ear') {
                  // 跟随头部转动速度（follow-through）+ 偶发抽动
                  if (Math.random() < dt * 0.35) part.vel += (Math.random() < 0.5 ? -1 : 1) * (45 + Math.random() * 55);
                  target = -tiltVel * 2.4 + Math.sin(this.t * part.windFreq + part.phase) * part.windAmp + rig.followX * 0.9;
                } else {
                  // 风场：慢波 + 阵风 + 拖动拖尾 + 互动联动（裙摆随互动前倾）
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
              rig.dragVX *= 0.9;                 // 拖动速度衰减
              rig.nodPx *= 0.88;                 // 点头回落
            }
          } else {
            el.style.transform = `translateY(${c.ty}px) translateX(${c.tx}px) scale(${c.sc}) rotate(${c.rt}deg)`;
          }
        }
      }
    };

    /* ---------- 伪骨骼层：眨眼 + 头部视差（贴图皮肤专用，媚娘式生动感） ----------
     * 眨眼：skin.json 声明眼位，预生成 eyes_half/eyes_closed 帧叠在贴图上层，
     *       随机间隔眨眼（偶尔双眨），被摸头/喂食时眯眼。
     * 头部：同一张贴图复制一层并用 CSS mask 在脖颈处渐隐，独立呼吸相位 +
     *       朝鼠标方向 ±2px 视差——平贴图立刻有了"骨骼感"。 */
    const rig = {
      group: null, headImg: null, blinkHalf: null, blinkClosed: null,
      on: false,
      followX: 0, followY: 0, followTX: 0, followTY: 0,
      blinkTimer: null, blinkBusy: false,
      partList: [],          // 耳朵/丝带等独立物理部件
      headTilt: 0,           // 头部当前倾角（跟随身体重心，带滞后）
      nodPx: 0,              // 眨眼时头部轻点（人眨眼会微微低头）
      dragVX: 0,             // 拖动速度（丝带随风摆动的输入）
      interactLean: 0, interactLeanT: 0   // 互动时裙摆联动前倾（起→承→落，缓慢回正）
    };
    function setBlinkFrame(which) {
      if (!rig.on || !rig.blinkHalf) return;
      rig.blinkHalf.style.opacity = which === 'half' ? '1' : '0';
      rig.blinkClosed.style.opacity = which === 'closed' ? '1' : '0';
    }
    function doBlink(opts) {
      if (!rig.on || rig.blinkBusy || petMode === 'sleep' || document.hidden) return;
      rig.blinkBusy = true;
      const hold = opts && opts.hold;
      if (hold) {
        setBlinkFrame('closed');
        rig.nodPx = 0.9;                                   // 眨眼时头轻轻一点
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
        if (rig.on && petMode !== 'sleep' && !document.hidden) {
          doBlink();
          if (Math.random() < 0.22) setTimeout(() => doBlink(), 420);  // 偶尔双眨
        }
        scheduleBlink();
      }, 2300 + Math.random() * 3800);
    }
    function ensureRig(skin) {
      const want = !!(skin && skin.type === 'image' && skin.file && skin.rig && skin.rig.blink);
      rig.on = want;
      if (!want) {
        if (rig.group) rig.group.style.display = 'none';
        if (rig.partWrap) { rig.partWrap.remove(); rig.partWrap = null; }
        rig.partList = [];
        clearTimeout(rig.blinkTimer);
        return;
      }
      if (!rig.group) {
        const g = document.createElement('div');
        g.className = 'skin-head-group';
        g.innerHTML = '<img class="rig-head" alt=""><img class="rig-blink rig-blink-half" alt=""><img class="rig-blink rig-blink-closed" alt="">';
        document.body.appendChild(g);
        rig.group = g;
        rig.headImg = g.querySelector('.rig-head');
        rig.blinkHalf = g.querySelector('.rig-blink-half');
        rig.blinkClosed = g.querySelector('.rig-blink-closed');
      }
      const dir = skin.file.replace(/pet\.png$/, '');
      rig.headImg.src = '../' + (skin.rig.parts && skin.rig.parts.head ? dir + skin.rig.parts.head : skin.file);
      rig.blinkHalf.src = '../' + dir + 'eyes_half.png';
      rig.blinkClosed.src = '../' + dir + 'eyes_closed.png';
      const ny = Math.max(0.3, Math.min(0.5, (skin.rig.neckY || 0.41)));
      const mask = `linear-gradient(180deg, #000 0 ${((ny - 0.07) * 100).toFixed(1)}%, transparent ${((ny + 0.03) * 100).toFixed(1)}%)`;
      rig.headImg.style.webkitMaskImage = mask;
      rig.headImg.style.maskImage = mask;
      rig.group.style.display = 'block';
      buildParts(skin);
      setBlinkFrame('none');
      scheduleBlink();
    }

    /* ---------- 分层部件：耳朵/丝带从底图切出，独立弹簧物理 ----------
     * 耳朵：跟随头部转动的角速度甩动（follow-through）+ 随机抽动；
     * 丝带：连续风场（双正弦叠加阵风）+ 拖动时向后拖尾。
     * 底图已挖掉这些区域（pet_body.png），部件旋转不会出现重影。 */
    function buildParts(skin) {
      if (rig.partWrap) rig.partWrap.remove();
      rig.partList = [];
      const dir = skin.file.replace(/pet\.png$/, '');
      const parts = skin.rig && skin.rig.parts;
      if (!parts || !parts.earL) return;
      // 部件容器与 skinImage 同几何（右下 200x440），内部坐标按贴图比例换算
      const wrap = document.createElement('div');
      wrap.className = 'skin-part-wrap';
      document.body.appendChild(wrap);
      rig.partWrap = wrap;
      const SCALE = 200 / 992, TOP = (440 - 1320 * SCALE) / 2;
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
        el.src = '../' + dir + def.file;
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
    motionBus.init('petBody', pet);
    motionBus.init('skinBody', document.getElementById('skinImage'));
    motionBus.init('itemBody', heldItem);
    let lastFrame = performance.now();
    (function frame(now) {
      motionBus.tick(Math.min((now - lastFrame) / 1000, 0.05));
      lastFrame = now;
      requestAnimationFrame(frame);
    })(performance.now());

    /* 天气感知：首屏稳定后查一次，之后每 30 分钟刷新（失败静默） */
    setTimeout(checkWeather, 6000);
    setInterval(checkWeather, 30 * 60 * 1000);

    /* ---------- 行为层：加权随机待机行为链 ----------
     * 每个待机行为是一串有头有尾的短序列（起点→过程→落回 Idle），
     * 按权重抽取，行为之间由 Idle 呼吸层兜底衔接，不硬切。
     * 任何用户交互（点击等）会打断当前行为，让位给互动。
     * 物品行为（喝水/看书/玩手机）带 heldItem 持有状态：
     * 物品按"拿出→使用→收回"过渡帧进出，不凭空出现/消失。
     */
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
    /* ---------- Action Director：动作序列执行器 + 物品状态机 ----------
     * 导演器持有动作锁，序列按步执行不被打断（step 之间可被用户交互取消）；
     * 物品独立于动作：pick_up 后挂在手上持续一段时间（item_state 持久化），
     * 动作切来切去杯子不会消失；drop/超时才收回。 */
    const director = { lock: false, cancelled: false };
    const itemState = { held: null, stowTimer: null };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // 物品姿态：手边(隐形) → 举到使用位 → 收回手边；HELD = 手里持握位
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
        await sleep(700);                       // 使用一会儿
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

    async function executeSequence(action) {
      if (director.lock) return;
      director.lock = true;
      director.cancelled = false;
      try {
        if (action.item) await itemPickup(action.item);
        if (action.eyesClosed && rig.on) setBlinkFrame('closed');   // 揉眼：闭着眼揉
        for (const [d, pose, spd] of action.steps) {
          if (director.cancelled) break;
          await motionBus.play('petBody', pose, { at: d, speed: spd });
        }
        if (action.eyesClosed && rig.on) setBlinkFrame('none');
        if (director.cancelled) return;
        if (action.item) {
          if (action.keep) {
            await motionBus.play('itemBody', ITEM_POSE.held, { speed: 0.18 });  // 留在手里
            keepHeld(action.keep);
          } else {
            await itemStow();
          }
        }
      } finally {
        director.lock = false;
      }
    }

    const idleDirector = {
      run(action) { executeSequence(action); },
      cancel() { director.cancelled = true; },   // 用户交互：本序列播完当前步即止，物品不没收
      isBusy() { return director.lock; }
    };
    /* 豆包兔娘专属动作：耳朵抖 / 转圈跳舞 / 比心跳（仅 doubaotu 系列皮肤启用） */
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
    function idleActionPool() {
      if (lastSkinId.startsWith('doubaotu')) {
        return Object.assign({}, IDLE_ACTIONS, RABBIT_EXTRA);
      }
      return IDLE_ACTIONS;
    }
    function pickIdleAction() {
      const pool = idleActionPool();
      const total = Object.keys(pool).reduce((a, k) => a + pool[k].weight, 0);
      let r = Math.random() * total;
      for (const k in pool) {
        r -= pool[k].weight;
        if (r <= 0) return pool[k];
      }
      return pool.lookAround;
    }
    let idleTimer = null;
    // 动作总时长：身体序列末拍与物品编排取较大者——下一个动作必须等本动作完整收尾，
    // 从根上消除"动作互相打断/物品凭空消失"的不一致感
    function actionDuration(a) {
      const body = a.steps && a.steps.length ? a.steps[a.steps.length - 1][0] : 0;
      return Math.max(body, a.item ? 2150 : 0) + 350;
    }
    function scheduleIdle() {
      clearTimeout(idleTimer);
      const rabbitMode = lastSkinId.startsWith('doubaotu');
      const gap = rabbitMode ? 4200 + Math.random() * 6800 : 9000 + Math.random() * 14000;
      idleTimer = setTimeout(async () => {
        if (petMode === 'sleep' || document.hidden) { scheduleIdle(); return; }
        if (director.lock) { scheduleIdle(); return; }          // 上一动作还没收尾
        const pool = Object.assign({}, IDLE_ACTIONS, lastSkinId.startsWith('doubaotu') ? RABBIT_EXTRA : {});
        // 手里已持有物品（item_state）：期间不再抽"拿东西"的动作，拿别的会先放下再拿
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
        idleDirector.run(action);
        idleTimer = setTimeout(scheduleIdle, actionDuration(action) + (rabbitMode ? 1600 + Math.random() * 2400 : 2600 + Math.random() * 4200));
      }, gap);
    }
    scheduleIdle();

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
    renderPill(s);
  }

  /* ---------- 迷你状态胶囊：一行关键信息，替代"点开就是大面板" ---------- */
  function renderPill(s) {
    if (!s) return;
    const sys = s.system || {};
    const p = s.pet || {};
    const affEl = $('spAff');
    if (affEl) affEl.textContent = p.affection != null ? p.affection : '--';
    const bat = sys.battery || {};
    const batEl = $('spBat');
    if (batEl) batEl.textContent = bat.ok && bat.percent != null ? bat.percent + '%' : '--';
    const batWrap = $('spBatWrap');
    if (batWrap) batWrap.style.display = bat.ok ? '' : 'none';
    const net = sys.network || {};
    const netEl = $('spNet');
    if (netEl) netEl.textContent = net.ok && net.rtt != null ? net.rtt + 'ms' : '--';
    const cpu = sys.cpu || {};
    const cpuEl = $('spCpu');
    if (cpuEl) cpuEl.textContent = cpu.ok && cpu.avgPct != null ? Math.round(cpu.avgPct) + '%' : '--';
  }

  let pillTimer = null;
  function showStatusPill() {
    if (!chatPanel.classList.contains('hidden')) return;   // 聊天窗优先
    statusPill.classList.remove('hidden');
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => statusPill.classList.add('hidden'), 5000);
  }
  function toggleStatusPill() {
    if (statusPill.classList.contains('hidden')) showStatusPill();
    else statusPill.classList.add('hidden');
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
  function showMini(text, isUsage, voiceKey) {
    miniBubble.textContent = text;
    miniBubble.classList.remove('hidden');
    miniBubble.classList.toggle('usage', !!isUsage);
    if (voiceKey) playVoice(voiceKey);
    clearTimeout(miniTimer);
    miniTimer = setTimeout(() => miniBubble.classList.add('hidden'), isUsage ? 6000 : 2500);
  }

  /* ---------- 团团配音：预生成台词音频（TTS），说话即发声 ---------- */
  const VOICE = {
    'greet-morning': '../assets/sound/greet_morning.ogg',
    'greet-noon': '../assets/sound/greet_noon.ogg',
    'greet-afternoon': '../assets/sound/greet_afternoon.ogg',
    'greet-evening': '../assets/sound/greet_evening.ogg',
    'feed-yummy': '../assets/sound/feed_yummy.ogg',
    'feed-love': '../assets/sound/feed_love.ogg',
    'pet-comfy': '../assets/sound/pet_comfy.ogg',
    'pet-more': '../assets/sound/pet_more.ogg',
    'play-with': '../assets/sound/play_with.ogg',
    'play-happy': '../assets/sound/play_happy.ogg',
    'weather-rain': '../assets/sound/weather_rain.ogg',
    'weather-sun': '../assets/sound/weather_sun.ogg',
    'weather-cold': '../assets/sound/weather_cold.ogg'
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
  /* 手势解锁：Chromium/Electron 会拦截无手势的自动播放（问候/天气配音） */
  function unlockAudio() {
    try {
      if (!voiceEl) voiceEl = new Audio();
      voiceEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
      voiceEl.volume = 0;
      voiceEl.play().catch(() => {});
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('click', unlockAudio);
    } catch (_) {}
  }
  document.addEventListener('touchstart', unlockAudio, { once: true });
  document.addEventListener('click', unlockAudio, { once: true });
  function voiceGreetKey() {
    const h = new Date().getHours();
    if (h < 6) return 'greet-evening';
    if (h < 11) return 'greet-morning';
    if (h < 14) return 'greet-noon';
    if (h < 18) return 'greet-afternoon';
    return 'greet-evening';
  }

  /* ---------- 天气感知：下雨/晴天/寒冷提示（拿不到天气静默降级） ---------- */
  let lastWeather = null;
  function weatherWord(cond) {
    const c = (cond || '').toLowerCase();
    if (c.includes('rain') || c.includes('drizzle') || c.includes('shower') || c.includes('thunder')) return 'rain';
    if (c.includes('snow') || c.includes('sleet') || c.includes('blizzard')) return 'snow';
    if (c.includes('sun') || c.includes('clear') || c.includes('fair')) return 'sun';
    if (c.includes('cloud') || c.includes('overcast') || c.includes('fog') || c.includes('mist') || c.includes('haze')) return 'cloud';
    return null;
  }
  function weatherLineByWord(word, temp) {
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
        const line = weatherLineByWord(word, temp);
        const vk = word === 'rain' ? 'weather-rain' : word === 'sun' ? 'weather-sun' : word === 'snow' || temp <= 12 ? 'weather-cold' : undefined;
        if (line) showMini(line, false, vk);
      });
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
    // 吃动作：左右快速轻摆（吃食物）——姿态曲线：左摆→右摆→回中；裙摆随低头前倾缓回
    idleDirector.cancel();
    rig.interactLeanT = 3;
    motionBus.pose('petBody', { rt: 3 }, { speed: 0.2 });
    setTimeout(() => motionBus.pose('petBody', { rt: -3 }, { speed: 0.2 }), 150);
    setTimeout(() => { motionBus.pose('petBody', { rt: 0 }, { speed: 0.12 }); rig.interactLeanT = 0; }, 320);
    spawnFood();
    spawnHearts(3);
  }
  function petPetAnim() {
    // 摸头：爱心 + 眯眼（眯眼用一颗大爱心在头顶）；裙摆随身体前倾
    rig.interactLeanT = 4;
    motionBus.pose('petBody', { ty: 2, rt: 3, sc: 1.01 }, { speed: 0.16 });
    const el = document.createElement('div');
    el.className = 'head-heart';
    el.textContent = '💗';
    fx.appendChild(el);
    setTimeout(() => { el.remove(); rig.interactLeanT = 0; }, 1100);
    spawnHearts(4);
  }

  /* ---------- 发呆 / 睡觉状态 ---------- */
  function setPetMode(mode) {
    if (mode === petMode) return;
    petMode = mode;
    if (mode === 'sleep') {
      idleDirector.cancel();
      sleepOverlay.classList.remove('hidden');
      sleepZzz.classList.remove('hidden');
      // 缓慢下沉入睡（而不是瞬间变出来）
      motionBus.pose('petBody', { ty: 12, sc: 0.985 }, { speed: 0.06 });
    } else {
      sleepOverlay.classList.add('hidden');
      sleepZzz.classList.add('hidden');
      // 自然浮起回位，落回 Idle 呼吸层
      motionBus.pose('petBody', { ty: 0, sc: 1 }, { speed: 0.07 });
    }
  }
  function wakePet() {
    if (petMode === 'awake') return;
    setPetMode('awake');
    showMini('嗯？叫本兔干嘛～', false, 'pet-comfy');
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
        showMini('(兔兔发呆中，勿cue)');
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
    // 弹跳姿态曲线：快速上弹 → 轻微回弹 → 缓缓回中（不再瞬切 class）
    idleDirector.cancel();
    motionBus.pose('petBody', { ty: -18, sc: 1.06 }, { speed: 0.25 });
    setTimeout(() => motionBus.pose('petBody', { ty: 2, sc: 0.99 }, { speed: 0.18 }), 160);
    setTimeout(() => motionBus.pose('petBody', { ty: 0, sc: 1 }, { speed: 0.08 }), 340);
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {}, 600);
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
      if (clickCount % 3 === 0) doBlink();
      spawnHearts(clickCount % 3 === 0 ? 6 : 3);
      showMini(randomChat(), false, 'pet-comfy');
      toggleStatusPill();          // 点一下：迷你胶囊（不再弹大面板挡视野）
      window.petAgent.notifyInteract();

      if (clickCount % 5 === 0) {
        window.petAgent.refreshBalance();
      }
    });

    container.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.petAgent.showContextMenu();
    });

    // 双击：打开 APP 主界面（完整信息在主界面看）
    container.addEventListener('dblclick', () => {
      window.petAgent.openMainWindow();
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

  // 互动/拖动绑定到"当前可见的宠物主体"：
  // 贴图皮肤 → skinImage（live2d-widget 此时被隐藏，事件必须跟到可见层）；
  // Live2D 皮肤 → live2d-widget。皮肤切换后重新绑定。
  const bindPetTarget = () => {
    const target = (lastSkin && lastSkin.type === 'image')
      ? document.getElementById('skinImage')
      : (document.getElementById('live2d-widget') || document.querySelector('#live2d-widget'));
    if (target) {
      bindPetEvents(target);
      setTimeout(updateMousePassthrough, 500);
    } else {
      setTimeout(bindPetTarget, 300);
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
  let _lastDragX = null;
  window.addEventListener('pointermove', (e) => {
    if (_lastDragX != null) rig.dragVX += (e.screenX - _lastDragX) * 0.5;   // 丝带拖尾输入
    _lastDragX = e.screenX;
    window.petAgent.dragMove([e.screenX, e.screenY]);
  });

  window.addEventListener('pointerup', () => {
    _lastDragX = null;
    window.petAgent.dragEnd();
  });

  /* ---------- 鼠标穿透：动态切换 ---------- */
  const INTERACTIVE_SELECTOR = '#live2d-widget, #live2d-widget canvas, #skinImage, #bubble, #miniBubble, #statusPill, #chatPanel, #chatPanel input, #settingsPanel, #settingsPanel input, #settingsPanel button, #walkSprite';

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
    // 视线跟随：头部朝鼠标方向轻微偏移（伪骨骼层的"看主人"效果）
    rig.followTX = Math.max(-1, Math.min(1, (e.clientX - 255) / 120)) * 1.8;
    rig.followTY = Math.max(-1, Math.min(1, (e.clientY - 300) / 160)) * 1.1;
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

  /* ---------- 状态胶囊 & 详情面板 ---------- */
  // 点胶囊 → 展开完整详情面板（显式意图才弹大面板）
  statusPill.addEventListener('click', () => {
    statusPill.classList.add('hidden');
    showBubble();
  });
  // 详情面板右上角 ✕ 关闭
  $('bubbleClose').addEventListener('click', () => bubble.classList.add('hidden'));

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

  /* 更新日志弹窗：点击版本栏打开（数据源 renderer/changelog.js） */
  function renderSetChangelog() {
    const body = $('setChangelogBody');
    const list = window.CHANGELOG || [];
    body.innerHTML = list.map((c) => `
      <div class="mw-log-item">
        <div class="mw-log-head">
          <span class="mw-log-ver">v${c.v}</span>
          <span class="mw-log-date">${c.date || ''}</span>
        </div>
        <ul class="mw-log-list">${(c.items || []).map((t) => `<li>${t}</li>`).join('')}</ul>
      </div>
    `).join('');
  }
  $('setVersionTap').addEventListener('click', () => {
    renderSetChangelog();
    $('setChangelogModal').classList.remove('hidden');
  });
  $('setChangelogClose').addEventListener('click', () => $('setChangelogModal').classList.add('hidden'));
  $('setChangelogMask').addEventListener('click', () => $('setChangelogModal').classList.add('hidden'));

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
    if (!el) return;
    // 贴图皮肤下 Live2D 永远隐藏（防止与贴图重叠）；Live2D 皮肤用 walk-hidden 控制透明度
    if (lastSkin && lastSkin.type === 'image') {
      el.style.display = 'none';
      return;
    }
    el.classList.toggle('walk-hidden', !visible);
  }

  function finishWalkOut() {
    const team = $('walkTeam');
    team.classList.remove('out', 'in', 'walk');
    team.onanimationend = null;
    walkLayer.classList.add('hidden');
    walkSprite.classList.add('hidden');
    setLive2DVisible(true);
    $('skinImage').classList.remove('walk-hidden-main');
    if (rig.group) rig.group.classList.remove('walk-hidden-main');
    clearInterval(walkAnim);
    walkAnim = null;
  }

  function startWalkAnim() {
    if (walkAnim) return;
    setLive2DVisible(false);
    // 贴图皮肤：散步时把站立的主体（含骨骼层）淡出，避免"既站着又在走"的双人重叠
    if (lastSkin && lastSkin.type === 'image') {
      $('skinImage').classList.add('walk-hidden-main');
      if (rig.group) rig.group.classList.add('walk-hidden-main');
    }
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
  let lastSkin = null;
  /* ---------- UI 主题跟随皮肤：skin.json theme.mode=light 时全部弹窗切浅色玻璃 ---------- */
  function applyUiTheme(theme) {
    const light = theme && theme.mode === 'light';
    document.body.dataset.ui = light ? 'light' : 'dark';
    if (theme && theme.accent) {
      document.documentElement.style.setProperty('--ui-accent', theme.accent);
    }
  }

  function applySkin(skin) {
    lastSkin = skin && skin.type ? skin : null;
    lastSkinId = (skin && skin.type === 'image' && skin.file) ? (skin.file.split('/')[2] || '') : '';
    applyUiTheme(skin && skin.theme);
    const img = $('skinImage');
    const l2d = document.getElementById('live2d-widget');
    if (skin && skin.type === 'image' && skin.file) {
      img.src = '../' + skin.file;
      img.style.display = 'block';
      if (l2d) l2d.style.display = 'none';
      walkSprite.style.backgroundImage = `url('../${skin.file}')`;
      ensureRig(skin);                  // 眨眼 + 头颈分层（skin.json 声明 rig 才启用）
      setTimeout(bindPetTarget, 400);   // 事件绑定跟到新的可见主体
      return;
    }
    img.style.display = 'none';
    ensureRig(null);                    // Live2D 皮肤：骨骼层隐藏（模型自带眨眼/骨骼）
    if (l2d) l2d.style.display = '';
    walkSprite.style.backgroundImage = '';
    setTimeout(bindPetTarget, 400);
  }
  // Live2D 容器由第三方库异步创建：容器出现后重放当前皮肤（避免贴图皮肤下 Live2D 重叠）
  function ensureSkinAfterLive2D() {
    const check = () => {
      const l2d = document.getElementById('live2d-widget');
      if (l2d && lastSkin && lastSkin.type === 'image') {
        l2d.style.display = 'none';
        return true;
      }
      return false;
    };
    if (check()) return;
    const obs = new MutationObserver(() => {
      if (check()) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 10000);   // 10s 兜底，避免长期占用
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
    showMini(text, true);          // 台词气泡播报即可，不再自动弹大面板
    petBounce();
  });

  // 右键菜单触发的动作（主进程已处理好感度，这里只播动画+音效）
  window.petAgent.onPetChatOpen(openChat);
  window.petAgent.onPetFeed(() => {
    petChew();
    doBlink({ hold: 420 });        // 吃到好吃的满足眯眼
    playTone('pop');
    showMini('好吃好吃！', false, Math.random() < 0.5 ? 'feed-yummy' : 'feed-love');
  });
  window.petAgent.onPetPetHead(() => {
    petPetAnim();
    doBlink({ hold: 500 });        // 被摸头舒服到闭眼
    playTone('ding');
    showMini('被摸头好舒服～', false, Math.random() < 0.5 ? 'pet-comfy' : 'pet-more');
  });
  window.petAgent.onPetPlay(() => {
    petBounce();
    doBlink();
    spawnHearts(6);
    playTone('boing');
    showMini('玩得好开心！', false, Math.random() < 0.5 ? 'play-with' : 'play-happy');
  });

  // 时间每秒刷新
  setInterval(() => {
    if (state) {
      $('time').textContent = nowTime();
    }
  }, 1000);

  // 开局保持画面干净：不再自动弹出用量面板，需要时点宠物看胶囊、点胶囊看详情

  // 定时随机小动作（不单调）
  const ACTION_LINES = [
    '耳朵在接收好运信号，你收到没',
    '这是本兔发的限定小心心，仅此一颗',
    '你在忙啥？让兔看看',
    '窗外没有胡萝卜，鉴定完毕',
    '唔——舒服。又是美好的一天（摸鱼）',
    '刚做了一个梦，梦里你在给我喂萝卜',
    '啊呜——本兔的睡眠质量，了解一下',
    '一二三，起！这桌子今天归本兔管了',
    '咔嚓咔嚓……别问，问就是身材好',
    '今天也是可爱的兔兔呢——本兔自己说的，但很客观',
    '在呼吸，在思考兔生',
    '兔兔巡视中，一切正常'
  ];
  const JOKES = [
    '为什么兔子上学从不迟到？因为它有长耳朵，能听更远的铃声。',
    '兔兔为什么不开车？因为它只考了胡萝卜驾驶证。',
    '为什么兔子从来不吵架？因为它会把耳朵竖起来，听你说完再服软。',
    '本兔为什么这么圆？因为知识都进了脑子，萝卜都进了肚子。',
    '为什么电脑里要养兔？因为代码写累了，可以rua一rua心情。'
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
    { kw: ['code', 'xcode', 'vscode', 'webstorm', 'intellij', 'cursor', 'windsurf', 'zed', 'sublime'], lines: ['在写代码呀～兔兔在旁边加油！', 'debug 顺利！本兔在这看着呢', '写代码记得喝水哦，兔兔说的'] },
    { kw: ['chrome', 'safari', 'edge', 'firefox', 'arc'], lines: ['在看网页呀，发现什么好玩的？', '摸鱼要适度哦，本兔可看着呢～'] },
    { kw: ['wechat', '微信', 'qq', 'discord', 'slack', 'teams', '钉钉', '飞书', 'lark'], lines: ['在聊天呀，兔兔也在陪着你～', '消息好多呀，慢慢回，兔不急'] },
    { kw: ['notion', 'obsidian', 'notes', '备忘录', 'pages', 'word', 'wps', 'typora', 'markdown'], lines: ['在写东西呀，灵感来了吗？', '写作加油，需要兔帮你顺句子吗？'] },
    { kw: ['terminal', 'iterm', '终端', 'warp'], lines: ['敲命令行中…感觉很专业，虽然兔看不懂', '黑窗口里都是魔法！'] },
    { kw: ['figma', 'sketch', 'photoshop', '剪映', 'premiere', 'final cut', 'illustrator'], lines: ['在设计东西呀，色彩真好看', '创意在流动～兔也想去打个滚'] },
    { kw: ['zoom', 'meeting', '会议', 'google meet'], lines: ['在开会呀，兔安静听着', '会议加油，别睡着啦——除非像兔一样可爱'] },
    { kw: ['game', 'steam', 'epic'], lines: ['打游戏呢！带带兔～', '赢了吗赢了吗？兔负责鼓掌'] }
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
    if (h >= 5 && h < 9) return '早呀。本兔昨晚守护了你的屏幕一整夜，不用谢';
    if (h >= 9 && h < 12) return '上午好～今天的兔兔和咖啡一样提神';
    if (h >= 12 && h < 14) return '饭点到了！你的外卖什么时候到？本兔帮你盯着';
    if (h >= 14 && h < 18) return '下午好，辛苦啦。本兔在，心里有底';
    if (h >= 18 && h < 23) return '晚上好呀，今天过得怎么样？跟兔说说呗';
    return '都这个点了……本兔陪你，反正兔也不需要睡觉。骗你的，困死了';
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
    // 互动/拖动绑定到当前可见的宠物主体（贴图皮肤时是 skinImage）
    setTimeout(bindPetTarget, 500);
    setTimeout(ensureSkinAfterLive2D, 600);
    console.log('[renderer] Live2D init requested');
  }

  if (document.readyState === 'complete') {
    setTimeout(initLive2D, 300);
  } else {
    window.addEventListener('load', () => setTimeout(initLive2D, 300));
  }
})();
