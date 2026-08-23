// 移动端触控：王者荣耀式浮动摇杆（左半屏）+ 右半屏手势（滑动转视角 /
// 轻点放置交互 / 长按挖掘）+ 动作按钮。桌面浏览器自动禁用，?touch=1 可强制开启。
//
// 依赖：Voxel.Config.TOUCH、Voxel.Controls（keys/applyLook）、
//       Voxel.Game（state/setDigHold/setTouchAim/touchTap/onKey）、Voxel.Settings(tsens)
window.Voxel = window.Voxel || {};

// 纯数学：摇杆向量映射（可在 Node 中测试）
Voxel.TouchUtil = {
  // 屏幕系偏移 (dx,dy) 与摇杆半径 R → 归一化移动向量。
  // 返回 {x, y(-1..1，y 向下为正), mag(0..1 推动量), sprint}
  axes: function (dx, dy, R, deadzone, sprintFrac) {
    var dz = deadzone === undefined ? 0.12 : deadzone;
    var sf = sprintFrac === undefined ? 0.92 : sprintFrac;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len <= 0 || R <= 0) return { x: 0, y: 0, mag: 0, sprint: false };
    var frac = Math.min(1, len / R);
    if (frac < dz) return { x: 0, y: 0, mag: 0, sprint: false };
    return {
      x: dx / len * frac,
      y: dy / len * frac,
      mag: frac,
      sprint: frac >= sf
    };
  }
};

Voxel.Touch = (function () {
  var C = Voxel.Config.TOUCH;

  // ---- 触控模式判定 ----
  // 主信号：pointer: coarse（手机/平板）；?touch=1 强制开、?touch=0 强制关
  // （避免带触摸屏的笔记本误开启）
  function detect() {
    try {
      if (window.__FORCE_TOUCH__) return true;   // 测试注入
      var m = location.search.match(/[?&]touch=(1|0)/);
      if (m) return m[1] === '1';
    } catch (e) { }
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    } catch (e) { }
    return false;
  }

  var enabled = false;
  var domBuilt = false;
  var capture = null, base = null, knob = null;
  var btnJump = null, btnDescend = null, btnFly = null, btnPause = null, btnBag = null;

  // ---- 摇杆状态 ----
  var stickId = null, baseX = 0, baseY = 0;
  var STICK_R = 66;            // 与 CSS 底座半径一致（132px 直径）
  var moveX = 0, moveY = 0, moveMag = 0, stickSprint = false;

  // ---- 视角/手势状态 ----
  var lookId = null, look = null;   // look: {sx,sy,lx,ly,t0,dist,digOn}

  function tsens() {
    return (Voxel.Settings && Voxel.Settings.get('tsens')) || 1;
  }

  // ---- DOM 构建 ----
  function el(cls, css, html) {
    var d = document.createElement('div');
    d.className = cls;
    if (css) d.style.cssText += css;
    if (html !== undefined) d.innerHTML = html;
    return d;
  }

  function buildDom() {
    if (domBuilt) return;
    domBuilt = true;

    capture = el('touch-capture');
    capture.style.display = 'none';   // 首帧由 onFrame 按 playing 态显隐
    document.body.appendChild(capture);

    base = el('touch-stick-base');
    knob = el('touch-stick-knob');
    base.appendChild(knob);
    base.style.display = 'none';
    document.body.appendChild(base);

    btnJump = el('touch-btn touch-btn-main', '', '跳');
    btnDescend = el('touch-btn touch-btn-sub descend', 'display:none', '降');
    btnFly = el('touch-btn touch-btn-sub fly', '', '飞');
    btnPause = el('touch-btn touch-btn-top pause', '', 'Ⅱ');
    btnBag = el('touch-btn touch-btn-top bag', '', '包');
    [btnJump, btnFly, btnPause, btnBag].forEach(function (b) { b.style.display = 'none'; });
    document.body.appendChild(btnJump);
    document.body.appendChild(btnDescend);
    document.body.appendChild(btnFly);
    document.body.appendChild(btnPause);
    document.body.appendChild(btnBag);

    bindButtons();
    setupRotateHint();
  }

  // 竖屏提示：仅触控设备；本会话内点过"仍要继续"不再弹
  function setupRotateHint() {
    var rh = document.getElementById('rotate-hint');
    if (!rh) return;
    var btn = document.getElementById('btn-rotate-ok');
    function dismissed() {
      try { return sessionStorage.getItem('rh_dismissed') === '1'; } catch (e) { return false; }
    }
    function update() {
      var portrait = window.innerHeight > window.innerWidth;
      rh.classList.toggle('hidden', !portrait || dismissed());
    }
    update();
    window.addEventListener('resize', update);
    if (btn) btn.addEventListener('click', function () {
      try { sessionStorage.setItem('rh_dismissed', '1'); } catch (e) { }
      rh.classList.add('hidden');
    });
  }

  // 按钮：注入虚拟按键 / 直接调用 Game.onKey（与键盘同一路径）
  function holdKey(btn, code) {
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      Voxel.Controls.keys[code] = true;
      btn.classList.add('pressing');
    });
    function release(e) {
      if (e.cancelable) e.preventDefault();
      Voxel.Controls.keys[code] = false;
      btn.classList.remove('pressing');
    }
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
  }

  function tapKey(btn, code) {
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.add('pressing');
      if (Voxel.Game) Voxel.Game.onKey(code);
    });
    btn.addEventListener('pointerup', function () { btn.classList.remove('pressing'); });
    btn.addEventListener('pointercancel', function () { btn.classList.remove('pressing'); });
  }

  function bindButtons() {
    holdKey(btnJump, 'Space');        // 跳/游泳上浮/飞行上升
    holdKey(btnDescend, 'ShiftLeft'); // 飞行下降（仅飞行时显示）
    tapKey(btnFly, 'KeyF');
    tapKey(btnPause, 'KeyP');
    tapKey(btnBag, 'KeyE');
  }

  // ---- 手势主流程 ----
  function onDown(e) {
    if (!enabled) return;
    if (!Voxel.Game || Voxel.Game.state !== 'playing') return;
    e.preventDefault();
    var x = e.clientX, y = e.clientY;
    var W = window.innerWidth;
    if (stickId === null && x < W * C.LEFT_ZONE_FRAC) {
      // 浮动摇杆：底座落在手指处
      stickId = e.pointerId;
      baseX = x; baseY = y;
      placeBase(x, y);
      setStick(0, 0);
      return;
    }
    if (lookId === null) {
      lookId = e.pointerId;
      look = { sx: x, sy: y, lx: x, ly: y, t0: performance.now(), dist: 0, digOn: false, lpTimer: null };
      aimAt(x, y);
      // 长按挖掘：定时判定（手指完全不动也要能触发）
      look.lpTimer = setTimeout(function () {
        if (!look || look.digOn) return;
        if (look.dist <= C.LONGPRESS_DIST) {
          look.digOn = true;
          if (Voxel.Game) Voxel.Game.setDigHold(true);
        }
      }, C.LONGPRESS_MS);
    }
  }

  function onMove(e) {
    if (!enabled) return;
    if (e.pointerId === stickId) {
      e.preventDefault();
      setStick(e.clientX - baseX, e.clientY - baseY);
      return;
    }
    if (e.pointerId === lookId && look) {
      e.preventDefault();
      var dx = e.clientX - look.lx, dy = e.clientY - look.ly;
      look.lx = e.clientX; look.ly = e.clientY;
      look.dist += Math.abs(dx) + Math.abs(dy);
      Voxel.Controls.applyLook(dx * 1.35, dy * 1.35, tsens());
      aimAt(look.lx, look.ly);
      // 长按已触发时允许拖动瞄准跟随；未触发且已大幅滑动则取消本次长按
      if (!look.digOn && look.lpTimer && look.dist > C.LONGPRESS_DIST) {
        clearTimeout(look.lpTimer);
        look.lpTimer = null;
      }
    }
  }

  function onUp(e) {
    if (!enabled) return;
    if (e.pointerId === stickId) {
      e.preventDefault();
      releaseStick();
      return;
    }
    if (e.pointerId === lookId && look) {
      e.preventDefault();
      var dt = performance.now() - look.t0;
      var wasDig = look.digOn;
      var sx = look.sx, sy = look.sy, dist = look.dist;
      if (look.lpTimer) { clearTimeout(look.lpTimer); look.lpTimer = null; }
      lookId = null; look = null;
      if (wasDig) {
        if (Voxel.Game) Voxel.Game.setDigHold(false);
      } else if (dist <= C.TAP_DIST && dt <= C.TAP_MS) {
        // 轻点：放置 / 交互 / 攻击（MCPE 手势流）
        if (Voxel.Game) Voxel.Game.touchTap(
          sx / window.innerWidth, sy / window.innerHeight);
      }
      if (Voxel.Game) Voxel.Game.setTouchAim(null);
    }
  }

  // 系统取消（切后台/旋转/浏览器手势）只能释放状态，不能按轻点结算。
  function cancelLook() {
    if (look && look.lpTimer) {
      clearTimeout(look.lpTimer);
      look.lpTimer = null;
    }
    if (Voxel.Game) {
      Voxel.Game.setDigHold(false);
      Voxel.Game.setTouchAim(null);
    }
    lookId = null;
    look = null;
  }

  function onCancel(e) {
    if (!enabled) return;
    if (e.pointerId === stickId) {
      if (e.cancelable) e.preventDefault();
      releaseStick();
    } else if (e.pointerId === lookId) {
      if (e.cancelable) e.preventDefault();
      cancelLook();
    }
  }

  function resetActiveInputs() {
    releaseStick();
    cancelLook();
    Voxel.Controls.keys.Space = false;
    Voxel.Controls.keys.ShiftLeft = false;
  }

  // ---- 视觉 ----
  function placeBase(x, y) {
    base.style.display = 'block';
    base.style.left = (x - STICK_R) + 'px';
    base.style.top = (y - STICK_R) + 'px';
  }
  function setStick(dx, dy) {
    var v = Voxel.TouchUtil.axes(dx, dy, STICK_R,
      C.STICK_DEADZONE, C.STICK_SPRINT);
    moveX = v.x; moveY = v.y; moveMag = v.mag; stickSprint = v.sprint;
    // 拇指帽限制在圆内
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len > STICK_R) { dx = dx / len * STICK_R; dy = dy / len * STICK_R; }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    base.classList.toggle('active', moveMag > 0);
  }
  function releaseStick() {
    stickId = null;
    moveX = 0; moveY = 0; moveMag = 0; stickSprint = false;
    base.style.display = 'none';
    base.classList.remove('active');
    knob.style.transform = 'translate(0,0)';
  }

  // 触点 → 游戏内瞄准目标（归一化坐标交给 main 反投影）
  function aimAt(x, y) {
    if (Voxel.Game) Voxel.Game.setTouchAim(
      x / window.innerWidth, y / window.innerHeight);
  }

  // ---- 每帧同步：显隐与状态复位 ----
  var lastState = '';
  function onFrame(state) {
    if (!enabled) return;
    var show = state === 'playing';
    if (show !== (lastState === 'playing')) {
      capture.style.display = show ? 'block' : 'none';
      [btnJump, btnFly, btnPause, btnBag].forEach(function (b) {
        b.style.display = show ? 'flex' : 'none';
      });
      btnDescend.style.display =
        (show && Voxel.Player && Voxel.Player.flying()) ? 'flex' : 'none';
      if (!show) {
        resetActiveInputs();
      }
    }
    if (show && Voxel.Player) {
      var fly = Voxel.Player.flying();
      if ((fly ? 'flex' : 'none') !== btnDescend.style.display)
        btnDescend.style.display = fly ? 'flex' : 'none';
    }
    lastState = state;
  }

  function init() {
    enabled = detect();
    if (!enabled) return;
    buildDom();
    capture.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) resetActiveInputs();
    });
  }

  return {
    init: init,
    onFrame: onFrame,
    get enabled() { return enabled; },
    active: function () { return enabled && moveMag > 0; },
    moveVec: function () { return { x: moveX, y: moveY }; },
    sprint: function () { return stickSprint; },
    _test: {
      forceEnable: function () {
        enabled = true;
        buildDom();
        capture.addEventListener('pointerdown', onDown);
        document.addEventListener('pointermove', onMove, { passive: false });
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onCancel);
      },
      stickVec: function () { return { x: moveX, y: moveY, mag: moveMag, sprint: stickSprint }; },
      lookActive: function () { return lookId !== null; }
    }
  };
})();
