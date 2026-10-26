/* 豆包桌宠 · 主界面逻辑：首页状态 / 皮肤管理 / 模块开关 / 设置与更新 */
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);

  /* ---------- UI 主题跟随皮肤（与悬浮窗一致） ---------- */
  function applyMwTheme(skin) {
    const theme = skin && skin.theme;
    if (theme && theme.mode === 'light') {
      document.body.dataset.ui = 'light';
      if (theme.accent) document.documentElement.style.setProperty('--ui-accent', theme.accent);
    } else {
      document.body.dataset.ui = 'dark';
      document.documentElement.style.removeProperty('--ui-accent');
    }
  }
  window.petAgent.getState().then((s) => applyMwTheme(s && s.skin));

  /* ---------- 导航切换 ---------- */
  function activatePage(page) {
    document.querySelectorAll('.mw-nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === page));
    ['home', 'skin', 'module', 'setting'].forEach((p) => {
      $('page-' + p).classList.toggle('hidden', p !== page);
    });
    if (page === 'home') loadHome();
    if (page === 'skin') loadSkins();
    if (page === 'module') loadModules();
    if (page === 'setting') loadSettingsForm();
  }
  document.querySelectorAll('.mw-nav-item').forEach((el) => {
    el.addEventListener('click', () => activatePage(el.dataset.page));
  });

  /* ---------- 首页：宠物状态 ---------- */
  function loadHome() {
    window.petAgent.getState().then((s) => {
      if (!s || !s.pet) return;
      const p = s.pet;
      $('mwStage').textContent = '当前阶段：' + (p.stage ? p.stage.name : '--');
      $('mwAffection').textContent = '好感度 ' + p.affection;
      const st = p.states || {};
      setBar('mwHunger', st.hunger);
      setBar('mwMood', st.mood);
      setBar('mwEnergy', st.energy);
    });
  }
  function setBar(id, val) {
    const el = $(id);
    if (el) el.style.width = (val != null ? Math.max(0, Math.min(100, val)) : 0) + '%';
  }

  /* ---------- 皮肤 ---------- */
  let skinList = [];
  function loadSkins() {
    window.petAgent.getSkinList().then((r) => {
      if (!r || !r.ok || !r.list) return;
      skinList = r.list;
      renderSkins();
    });
  }
  function renderSkins() {
    const grid = $('mwSkinGrid');
    grid.innerHTML = '';
    for (const s of skinList) {
      const card = document.createElement('div');
      card.className = 'mw-skin-card' + (s.using ? ' using' : '');
      const thumb = s.thumb
        ? `<img class="mw-skin-thumb" src="${s.thumb}" alt="" />`
        : `<div class="mw-skin-thumb mw-skin-thumb-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-4.5-4.5L6 21"/></svg></div>`;
      card.innerHTML = `
        ${thumb}
        <div class="mw-skin-name">${s.name}</div>
        <div class="mw-skin-type">${s.type === 'live2d' ? 'Live2D 动画' : '贴图皮肤'}</div>
        ${s.desc ? `<div class="mw-skin-desc">${s.desc}</div>` : ''}
        ${s.using ? '<span class="mw-skin-badge">使用中</span>' : ''}
      `;
      card.addEventListener('click', () => {
        if (s.using) return;
        window.petAgent.setSkin(s.id).then((r) => {
          if (r && r.ok) {
            renderSkins();
            loadSkins();
            // 切肤后刷新主题（主窗口不随桌宠窗口重载，需自己取新皮肤的主题）
            window.petAgent.getState().then((st) => applyMwTheme(st && st.skin));
          }
        });
      });
      grid.appendChild(card);
    }
  }
  $('btnOpenSkinFolder').addEventListener('click', () => window.petAgent.openSkinFolder());
  $('btnRefreshSkin').addEventListener('click', loadSkins);

  /* ---------- 模块开关 ---------- */
  const MODULES = [
    { key: 'vision', name: '屏幕感知（视觉理解）', desc: '定时"看"你的屏幕，主动说话、联动表情' },
    { key: 'frontApp', name: '前台应用感知', desc: '识别你在用的应用，说应景的话（需辅助功能权限）' },
    { key: 'weather', name: '实时天气播报', desc: '定时获取你所在城市的天气并播报' },
    { key: 'monitor', name: '系统监测', desc: '电池 / 网络 / 内存 / CPU 实时监测与提醒' },
    { key: 'greeting', name: '情景台词与问候', desc: '分时段问候、专注模式、温馨提示' }
  ];
  function loadModules() {
    window.petAgent.getModules().then((r) => {
      const mods = (r && r.ok && r.modules) || {};
      const list = $('mwModuleList');
      list.innerHTML = '';
      for (const m of MODULES) {
        const row = document.createElement('div');
        row.className = 'mw-module-row';
        const on = !!mods[m.key];
        row.innerHTML = `
          <div class="mw-module-info">
            <span class="mw-module-name">${m.name}</span>
            <span class="mw-module-desc">${m.desc}</span>
          </div>
          <div class="mw-switch${on ? ' on' : ''}" data-key="${m.key}"></div>
        `;
        row.querySelector('.mw-switch').addEventListener('click', (e) => {
          const sw = e.currentTarget;
          const key = sw.dataset.key;
          const next = !sw.classList.contains('on');
          sw.classList.toggle('on', next);
          window.petAgent.setModules({ [key]: next }).then((res) => {
            if (res && res.ok && res.needRestart) {
              // 开关已生效，提示部分需重启
            }
          });
        });
        list.appendChild(row);
      }
    });
  }

  /* ---------- 设置 ---------- */
  function loadSettingsForm() {
    window.petAgent.getSettings().then((s) => {
      if (!s || !s.ok) return;
      $('mwCurVer').textContent = s.version || '--';
      $('mwApiBase').value = s.config.apiBase || '';
      $('mwApiKey').value = '';
      $('mwApiKey').placeholder = s.config.apiKeySet ? (s.config.apiKeyMasked || '已设置 Key') : '未设置 Key';
      $('mwChatModel').value = s.config.chatModel || '';
    });
  }
  $('btnSaveSettings').addEventListener('click', async () => {
    const patch = {
      apiBase: $('mwApiBase').value.trim(),
      chatModel: $('mwChatModel').value.trim()
    };
    const keyVal = $('mwApiKey').value.trim();
    if (keyVal) patch.apiKey = keyVal;
    const btn = $('btnSaveSettings');
    btn.disabled = true;
    try {
      const r = await window.petAgent.saveSettings(patch);
      $('mwUpdateStatus').textContent = (r && r.ok) ? '设置已保存，重启桌宠后生效 ✓' : '保存失败';
    } catch (e) {
      $('mwUpdateStatus').textContent = '保存失败：' + e.message;
    }
    btn.disabled = false;
  });

  /* ---------- 更新 ---------- */
  $('btnCheckUpdate').addEventListener('click', async () => {
    const btn = $('btnCheckUpdate');
    btn.disabled = true;
    $('mwUpdateStatus').textContent = '正在检查更新…';
    try {
      const r = await window.petAgent.checkUpdate();
      if (!r || !r.ok) {
        $('mwUpdateStatus').textContent = '检查失败：' + (r && r.error ? r.error : '网络异常');
        btn.disabled = false;
        return;
      }
      $('mwLatVer').textContent = r.latest || '--';
      if (r.hasUpdate) {
        $('mwUpdateStatus').textContent = '发现新版本 ' + r.latest + '！点「立即更新」自动升级';
        $('btnApplyUpdate').disabled = false;
      } else {
        $('mwUpdateStatus').textContent = '已是最新版本（' + r.current + '）';
        $('btnApplyUpdate').disabled = true;
      }
    } catch (e) {
      $('mwUpdateStatus').textContent = '检查失败：' + e.message;
    }
    btn.disabled = false;
  });
  $('btnApplyUpdate').addEventListener('click', async () => {
    $('btnApplyUpdate').disabled = true;
    $('mwUpdateStatus').textContent = '正在下载新版本并升级…请稍候（期间请勿关机）';
    try {
      const r = await window.petAgent.applyUpdate();
      $('mwUpdateStatus').textContent = (r && r.ok)
        ? '升级完成（' + r.updatedTo + '），正在自动重启…'
        : '更新失败：' + (r && r.error ? r.error : '未知错误');
    } catch (e) {
      $('mwUpdateStatus').textContent = '更新失败：' + e.message;
    }
  });

  /* ---------- 更新日志 ---------- */
  const CHANGELOG = [
    { v: '5.9.8', date: '2026-10-26', items: [
      '声音不再被系统静音：首次点按自动解锁音频，问候 / 天气配音稳定出声',
      '桌面天气播报修复：天气台词在桌面真正生效（网络策略 + 函数冲突一并解决）',
      '天气台词配专属语音：下雨 / 晴天 / 寒冷都会开口提醒，三端统一'
    ] },
    { v: '5.9.7', date: '2026-10-26', items: [
      '立绘 2x 高清化：团团全套贴图（立绘/底图/耳/丝带/裙摆/眨眼）分辨率翻倍',
      '手机高分辨率屏上不再发糊、像素化；显示尺寸不变，脸型等形象完全一致'
    ] },
    { v: '5.9.6', date: '2026-10-26', items: [
      '团团会说话啦：13 句软萌配音（TTS 预生成），喂食 / 摸摸 / 陪玩 / 时段问候都有声音回应',
      '天气感知：下雨 / 晴天 / 寒冷团团会主动提醒，每 30 分钟自动刷新，拿不到天气静默降级',
      '配音 + 天气：桌面 / 悬浮窗 / 主界面三端同步生效'
    ] },
    { v: '5.9.5', date: '2026-10-26', items: [
      '新增裙摆物理层：裙摆与飘带随风缓摆，配合呼吸轻颤，不再直挺挺',
      '互动联动：喝水抬手时裙摆前倾、喂食低头时裙摆跟随、跳跃时裙摆后飘，起承转合',
      '桌面 / 悬浮窗 / 主界面三端同步生效'
    ] },
    { v: '5.9.4', date: '2026-10-26', items: [
      '手机版主界面团团全面"活化"：引入与桌面端一致的表演引擎',
      '持续呼吸 + 眨眼 + 兔耳/丝带弹簧物理：团团在主界面也不再僵直站立',
      '加权待机行为链：张望 / 点头 / 伸懒腰 / 揉眼 / 喝水 / 看书 / 玩手机，有起承转合',
      '互动动作序列化：喂食低头咀嚼、摸摸前倾贴贴、陪玩三段式跳跃，杜绝"凭空变出来"',
      '统一团团台词库：主界面与悬浮窗、桌面完全一致的口吻'
    ] },
    { v: '5.9.3', date: '2026-10-25', items: [
      '手机版悬浮窗桌宠上线：团团常驻手机桌面（需「显示在其他应用上层」授权）',
      '悬浮窗可拖动、可关闭，点击团团有互动回应',
      '动作引擎升级：连续参数插值 + Idle 呼吸层 + 眨眼 + 加权行为链，姿态变化有起点有路径有落点，不再生硬跳变',
      '手机版与桌面版保持百分百同步：皮肤 / 版本 / 更新日志一致'
    ] },
    { v: '5.9.2', date: '2026-10-25', items: [
      '手机版与桌面端百分百同步：版本号 / 皮肤 / 更新日志完全一致',
      '手机版新增软件封面（关于区：团团形象 + 品牌标语 + 版本号）',
      '手机版新增「检查更新」：一键检测 GitHub 最新版，发现新版本直接下载 APK 安装',
      '手机版皮肤列表动态化：团团两款皮肤 + 人设简介与桌面端一致'
    ] },
    { v: '5.9.1', date: '2026-10-25', items: [
      '兔娘 IP 正式命名「团团」：豆包兔娘·团团 / 豆包兔娘·团团（裙摆限定）',
      '全新团团专属台词库：点击互动、待机小动作、时段问候、场景台词全部换成傲娇兔娘口吻',
      '新增 5 条团团冷笑话、常驻口头禅「别看我，看兔子」',
      '皮肤卡片新增人设简介，一句话认识每只团团'
    ] },
    { v: '5.9.0', date: '2026-10-25', items: [
      '伪骨骼实体化：分层物理（头/耳/身体独立摆动）+ 眨眼 + 物品持有状态机',
      '动作导演器统一调度：待机行为链与互动互不抢占，表演更连贯',
      'UI 皮肤主题：主窗口配色跟随当前皮肤'
    ] },
    { v: '5.5.4', date: '2026-10-25', items: [
      '修复贴图皮肤（兔娘等）下无法点击、无法拖拽移动的问题——事件绑定跟随到当前皮肤主体',
      '兔娘皮肤动作大幅增强：呼吸起伏幅度翻倍、动作频率加快（每隔几秒就有小动作），不再"像图片"',
      '修复引擎首帧参数初始化问题（偶发姿态参数失效）'
    ] },
    { v: '5.5.3', date: '2026-10-25', items: [
      '新增专属皮肤「豆包兔娘」（比心款）与「豆包兔娘·拎裙」（蓝白洛丽塔），透明底立绘，皮肤页可直接切换',
      '兔娘专属动作：耳朵抖动、转圈跳舞、比心跳跳——只有豆包兔娘皮肤会表演',
      '桌面版与手机版同步上线两款兔娘皮肤'
    ] },
    { v: '5.5.2', date: '2026-10-25', items: [
      '新增「物品持有行为」：待机时会喝水（☕）、看书（📖）、玩手机（📱）',
      '物品严格按「拿出 → 使用 → 收回」过渡帧进出，不再凭空出现/消失',
      '物品与身体姿态双轨并行：举杯时宠物会低头配合，收回后自然落回呼吸层'
    ] },
    { v: '5.5.1', date: '2026-10-25', items: [
      '新增「待机行为链」：发呆时会随机做张望、点头、歪头、伸懒腰、揉眼睛、打哈欠等小动作，动作间由呼吸层自然衔接',
      '待机动作按权重抽取（张望/点头最常出现、哈欠最少），行为与行为之间有逻辑过渡，不再机械切换',
      '点击/喂食/入睡会自然打断待机行为，让位给互动'
    ] },
    { v: '5.5.0', date: '2026-10-25', items: [
      '全新「连续动作表演引擎」：点击弹跳、吃食物摇摆、入睡下沉全部改为逐帧参数插值，动作有起点、路径、落点，不再瞬间切换闪现',
      '常驻 Idle 呼吸层：宠物任何时候都在轻微呼吸浮动，任何动作结束后自然落回，不再"突然静止"',
      '睡眠改为缓缓下沉入睡、自然浮起醒来'
    ] },
    { v: '5.4.9', date: '2026-10-25', items: [
      '修复皮肤切换后新旧皮肤重叠的问题（切换贴图皮肤时 Live2D 完全隐藏，切换回 Live2D 时贴图完全隐藏）',
      '动画平滑过渡：台词气泡、用量面板、聊天窗、设置面板、睡眠遮罩、拖放提示等全部改为淡入淡出，不再突然出现/消失',
      '喂食/摸头爱心特效改为柔和出现、缓缓飘落'
    ] },
    { v: '5.4.8', date: '2026-10-24', items: [
      '新增多款桌宠皮肤：橘猫、柴犬、小白熊（皮肤页可切换）',
      '新增「搬桌子」动作动画：散步时宠物会把桌子搬着走，不再凭空消失',
      '新增更新日志功能',
      '走路动画优化：步伐更自然，带上下起伏'
    ]},
    { v: '5.4.7', date: '2026-10-24', items: [
      '应用图标改为纯白背景 Q 版头像（macOS / Android / PWA 全端统一）'
    ]},
    { v: '5.4.6', date: '2026-10-24', items: [
      '重新设计应用图标：AI 生成磨砂玻璃质感（桌面 + 手机版）'
    ]},
    { v: '5.4.5', date: '2026-10-24', items: [
      '手机版 APP 发布：Android APK 云端自动构建、GitHub 下载',
      '主界面图标升级为 SVG 线性风格'
    ]},
    { v: '5.4.4', date: '2026-10-24', items: [
      '新增 APP 主界面：首页 / 皮肤 / 模块 / 设置四页',
      '新增皮肤系统与模块开关，可自由切换形象与能力'
    ]},
    { v: '5.4.3', date: '2026-10-24', items: [
      '修复 macOS 辅助功能权限弹窗反复出现的问题'
    ]},
    { v: '5.4.2', date: '2026-10-24', items: [
      '屏幕感知（视觉理解）：主动看屏幕、应景台词与表情联动'
    ]},
    { v: '5.4.1', date: '2026-10-24', items: [
      '软件内一键自动更新：设置页检查并更新，无需重装'
    ]},
    { v: '5.4.0', date: '2026-10-24', items: [
      '豆包桌宠初版：Live2D 桌宠 + AI 聊天 + 好感度养成 + 喂食/摸头/陪玩互动'
    ]}
  ];
  function renderChangelog() {
    const body = $('changelogBody');
    body.innerHTML = CHANGELOG.map((c) => `
      <div class="mw-log-item">
        <div class="mw-log-head">
          <span class="mw-log-ver">v${c.v}</span>
          <span class="mw-log-date">${c.date}</span>
        </div>
        <ul class="mw-log-list">${c.items.map((t) => `<li>${t}</li>`).join('')}</ul>
      </div>
    `).join('');
  }
  function openChangelog() {
    renderChangelog();
    $('changelogModal').classList.remove('hidden');
  }
  function closeChangelog() {
    $('changelogModal').classList.add('hidden');
  }
  $('btnChangelog').addEventListener('click', openChangelog);
  $('changelogClose').addEventListener('click', closeChangelog);
  $('changelogMask').addEventListener('click', closeChangelog);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeChangelog();
  });

  /* ---------- 初始化 ---------- */
  window.petAgent.getSettings().then((s) => {
    if (s && s.ok) $('mwVersion').textContent = 'v' + s.version;
  });
  const pageFromUrl = new URLSearchParams(location.search).get('page');
  activatePage(['home', 'skin', 'module', 'setting'].includes(pageFromUrl) ? pageFromUrl : 'home');
})();
