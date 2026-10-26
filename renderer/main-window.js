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

  /* ---------- 更新日志（数据源 renderer/changelog.js）---------- */
  const CHANGELOG = window.CHANGELOG || [];

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
  $('mwVersionTap').addEventListener('click', openChangelog);
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
