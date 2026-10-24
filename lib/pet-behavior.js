/**
 * 桌宠行为：乱逛 + 躲鼠标 + 边界约束
 *
 * 设计要点（修复抖动）：
 * - 单一 tick 循环驱动所有移动，杜绝多个定时器竞争 setPosition
 * - 平滑插值移动：每帧移动量 = min(剩余距离, speed*dt)，永不超过目标，不振荡
 * - flee 带滞回带：进入距离 < fleeDist，退出距离 > fleeDist*1.5，避免边界来回切换
 * - 鼠标悬停在窗口上（光标在窗口内）时不逃离，避免窗口在鼠标下"逃走"
 */
'use strict';

const { screen } = require('electron');

const TICK_MS = 120;         // 移动循环间隔
const STOP_EPS = 6;          // 到达判定阈值 px

class PetBehavior {
  constructor(getWindow) {
    this.getWindow = getWindow;
    this.mode = 'idle';      // idle | roam | flee | cooldown
    this.timer = null;
    this.pauseTimer = null;
    this.cooldownTimer = null;
    this.enabled = true;

    this.roamRadius = 110;   // 乱逛范围半径（小范围）
    this.roamSpeed = 38;     // 乱逛速度 px/s（慢速自然）
    this.fleeDist = 150;     // 鼠标进入该距离后躲开（收紧，避免日常误触）
    this.fleeSpeed = 55;     // 躲闪速度 px/s（平滑，不跳变）
    this.hideDelay = 75 * 1000; // 无交互 75s 后开始慢速游走
    this.pauseAfterArrive = 5000 + Math.random() * 5000; // 到达后停 5-10s
    this.cooldownAfterFlee = 6000 + Math.random() * 4000; // 躲开后冷却 6-10s

    this._target = null;     // 乱逛目标点
    this._lastTick = Date.now();
    this._mouseInside = false;
  }

  start() {
    this._lastTick = Date.now();
    this.timer = setInterval(() => this._tick(), TICK_MS);
    this.pauseTimer = setTimeout(() => this._startRoam(), this.hideDelay);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.timer = null;
    this.pauseTimer = null;
    this.cooldownTimer = null;
  }

  /** 用户交互（点击/拖动）时重置闲置计时并停下 */
  notifyInteract() {
    if (this.mode === 'roam' || this.mode === 'flee') {
      this.mode = 'idle';
      this._target = null;
    }
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = null;
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => this._startRoam(), this.hideDelay);
  }

  _startRoam() {
    if (!this.enabled || !this.getWindow()) return;
    this.mode = 'roam';
    this._nextRoamTarget();
  }

  _nextRoamTarget() {
    const win = this.getWindow();
    if (!win) return;
    const { workArea } = screen.getPrimaryDisplay();
    const [wx, wy] = win.getPosition();
    // 以当前位置为中心随机取目标点，限制在屏幕内
    const tx = Math.max(workArea.x + 40, Math.min(workArea.x + workArea.width - 360, wx + (Math.random() * 2 - 1) * this.roamRadius));
    const ty = Math.max(workArea.y + 40, Math.min(workArea.y + workArea.height - 420, wy + (Math.random() * 2 - 1) * this.roamRadius));
    this._target = [tx, ty];
  }

  /** 平滑移动一步：返回是否已到达 */
  _stepToward(tx, ty, speed) {
    const win = this.getWindow();
    if (!win) return true;
    const [wx, wy] = win.getPosition();
    const dx = tx - wx, dy = ty - wy;
    const dist = Math.hypot(dx, dy);
    if (dist < STOP_EPS) return true; // 已到达

    // dt 按真实间隔计算，避免系统休眠/卡顿导致跳变
    const now = Date.now();
    const dt = Math.min(Math.max(now - this._lastTick, 10), 500) / 1000;
    this._lastTick = now;

    const step = Math.min(dist, speed * dt); // 不超过剩余距离 → 不超调
    const nx = wx + (dx / dist) * step;
    const ny = wy + (dy / dist) * step;
    win.setPosition(Math.round(nx), Math.round(ny));
    return false;
  }

  _tick() {
    const win = this.getWindow();
    if (!win || !win.isVisible()) return;
    if (this.mode === 'cooldown') return; // 躲完后冷却期静止

    const cursor = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition();
    const [ww, wh] = win.getSize();
    const cx = wx + ww / 2, cy = wy + wh / 2;
    const dist = Math.hypot(cursor.x - cx, cursor.y - cy);

    // 鼠标是否落在窗口矩形内（含边框余量）→ 悬停不逃
    this._mouseInside =
      cursor.x >= wx - 10 && cursor.x <= wx + ww + 10 &&
      cursor.y >= wy - 10 && cursor.y <= wy + wh + 10;

    // 滞回：进入 flee / 退出 flee
    if (!this._mouseInside && dist < this.fleeDist) {
      this.mode = 'flee';
      this._target = null;
    } else if (this.mode === 'flee' && (dist > this.fleeDist * 1.6 || this._mouseInside)) {
      // 躲开鼠标后进入冷却期，静止一段时间，避免立刻乱逛再触发躲闪
      this.mode = 'cooldown';
      this._target = null;
      if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
      this.cooldownTimer = setTimeout(() => {
        this.mode = 'roam';
        if (this._target === null) this._nextRoamTarget();
      }, this.cooldownAfterFlee);
      return;
    }

    if (this.mode === 'flee') {
      // 朝远离鼠标的方向平滑移动
      const dx = cx - cursor.x, dy = cy - cursor.y;
      const len = Math.hypot(dx, dy) || 1;
      const { workArea } = screen.getPrimaryDisplay();
      const tx = Math.max(workArea.x + 30, Math.min(workArea.x + workArea.width - 350, wx + (dx / len) * 45));
      const ty = Math.max(workArea.y + 30, Math.min(workArea.y + workArea.height - 410, wy + (dy / len) * 45));
      this._stepToward(tx, ty, this.fleeSpeed);
      return;
    }

    if (this.mode === 'roam' && this._target) {
      const arrived = this._stepToward(this._target[0], this._target[1], this.roamSpeed);
      if (arrived) {
        this._target = null;
        this.mode = 'idle';
        // 停一会再走
        if (this.pauseTimer) clearTimeout(this.pauseTimer);
        this.pauseTimer = setTimeout(() => this._startRoam(), this.pauseAfterArrive);
      }
    }
  }

  /** 拖动结束后的位置：停在该位置，重置计时 */
  dockAt() {
    this.mode = 'idle';
    this._target = null;
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = null;
    this.notifyInteract();
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v && this.mode !== 'idle') {
      this.mode = 'idle';
      this._target = null;
    }
  }
}

module.exports = PetBehavior;
