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
  // （避免带触摸屏的笔记本误开启）。模块加载期即判定，供渲染器 DPR 等提前分支。
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

  var enabled = detect();
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

  function viewportSize() {
    if (Voxel.Game && Voxel.Game.viewportSize) return Voxel.Game.viewportSize();
    var vv = window.visualViewport;
    return {
      width: Math.max(1, Math.round((vv && vv.width) || window.innerWidth || 1)),
      height: Math.max(1, Math.round((vv && vv.height) || window.innerHeight || 1))
    };
  }

  // ---- DOM 构建 ----
  function el(cls, css, html) {
    var d = document.createElement('div');
    d.className = cls;
    if (css) d.style.cssText += css;
    if (html !== undefined) d.innerHTML = html;
    return d;
  }

  function actionButton(cls, label, text) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.setAttribute('aria-label', label);
    b.textContent = text;
    return b;
  }

  function buildDom() {
    if (domBuilt) return;
    domBuilt = true;

    capture = el('touch-capture');
    capture.setAttribute('aria-hidden', 'true');
    capture.style.display = 'none';   // 首帧由 onFrame 按 playing 态显隐
    document.body.appendChild(capture);

    base = el('touch-stick-base');
    knob = el('touch-stick-knob');
    base.setAttribute('aria-hidden', 'true');
    knob.setAttribute('aria-hidden', 'true');
    base.appendChild(knob);
    base.style.display = 'none';
    document.body.appendChild(base);

    btnJump = actionButton('touch-btn touch-btn-main', '跳跃、游泳上浮或飞行上升', '跳');
    btnDescend = actionButton('touch-btn touch-btn-sub descend', '飞行下降', '降');
    btnDescend.style.display = 'none';
    btnFly = actionButton('touch-btn touch-btn-sub fly', '切换飞行模式', '飞');
    btnFly.setAttribute('aria-pressed', 'false');
    btnPause = actionButton('touch-btn touch-btn-top pause', '暂停游戏', 'Ⅱ');
    btnBag = actionButton('touch-btn touch-btn-top bag', '打开背包', '包');
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
      var size = viewportSize();
      var portrait = size.height > size.width;
      if (portrait && !dismissed()) {
        if (Voxel.Game && Voxel.Game.openRotateHint) Voxel.Game.openRotateHint();
        else rh.classList.remove('hidden');
      } else if (!rh.classList.contains('hidden')) {
        if (Voxel.Game && Voxel.Game.closeRotateHint) Voxel.Game.closeRotateHint(true);
        else rh.classList.add('hidden');
      }
    }
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', update);
    if (btn) btn.addEventListener('click', function () {
      try { sessionStorage.setItem('rh_dismissed', '1'); } catch (e) { }
      if (Voxel.Game && Voxel.Game.closeRotateHint) Voxel.Game.closeRotateHint(true);
      else rh.classList.add('hidden');
    });
    // Game.init 尾部会建立 menu 状态；延后一拍避免把初始 loading 误记为返回态。
    setTimeout(update, 0);
  }

  // 按钮：注入虚拟按键 / 直接调用 Game.onKey（与键盘同一路径）
  function holdKey(btn, code) {
    var lastPointerActivation = -Infinity;
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      lastPointerActivation = performance.now();
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
    // 键盘/开关控制/屏幕阅读器通常只派发 click；短脉冲保证固定步能观察到按键。
    btn.addEventListener('click', function (e) {
      if (performance.now() - lastPointerActivation < 600) { e.preventDefault(); return; }
      Voxel.Controls.keys[code] = true;
      btn.classList.add('pressing');
      setTimeout(function () {
        Voxel.Controls.keys[code] = false;
        btn.classList.remove('pressing');
      }, 120);
    });
  }

  function tapKey(btn, code) {
    var lastPointerActivation = -Infinity;
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      lastPointerActivation = performance.now();
      btn.classList.add('pressing');
      if (Voxel.Game) Voxel.Game.onKey(code);
    });
    btn.addEventListener('pointerup', function () { btn.classList.remove('pressing'); });
    btn.addEventListener('pointercancel', function () { btn.classList.remove('pressing'); });
    btn.addEventListener('click', function (e) {
      if (performance.now() - lastPointerActivation < 600) { e.preventDefault(); return; }
      if (Voxel.Game) Voxel.Game.onKey(code);
    });
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
    if (!Voxel.Game || (Voxel.Game.state !== 'playing' && Voxel.Game.state !== 'cockpit')) return;
    e.preventDefault();
    var x = e.clientX, y = e.clientY;
    var W = viewportSize().width;
    var cockpit = Voxel.Game.state === 'cockpit';
    if (!cockpit && stickId === null && x < W * C.LEFT_ZONE_FRAC) {
      // 浮动摇杆：底座落在手指处
      stickId = e.pointerId;
      baseX = x; baseY = y;
      placeBase(x, y);
      setStick(0, 0);
      return;
    }
    if (lookId === null) {
      lookId = e.pointerId;
      look = { sx: x, sy: y, lx: x, ly: y, t0: performance.now(), dist: 0,
        digOn: false, lpTimer: null, cockpit: cockpit };
      if (!cockpit) aimAt(x, y);
      // 长按挖掘：定时判定（手指完全不动也要能触发）
      if (!cockpit) look.lpTimer = setTimeout(function () {
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
      if (!look.cockpit) aimAt(look.lx, look.ly);
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
      var wasCockpit = look.cockpit;
      var sx = look.sx, sy = look.sy, dist = look.dist;
      if (look.lpTimer) { clearTimeout(look.lpTimer); look.lpTimer = null; }
      lookId = null; look = null;
      if (wasDig) {
        if (Voxel.Game) Voxel.Game.setDigHold(false);
      } else if (!wasCockpit && dist <= C.TAP_DIST && dt <= C.TAP_MS) {
        // 轻点：放置 / 交互 / 攻击（MCPE 手势流）
        var size = viewportSize();
        if (Voxel.Game) Voxel.Game.touchTap(
          sx / size.width, sy / size.height);
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
    Voxel.Controls.keys.KeyW = false;
    Voxel.Controls.keys.KeyS = false;
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
    var size = viewportSize();
    if (Voxel.Game) Voxel.Game.setTouchAim(
      x / size.width, y / size.height);
  }

  // ---- 每帧同步：显隐与状态复位 ----
  var lastState = '';
  function onFrame(state) {
    if (!enabled) return;
    var show = state === 'playing';
    var cockpit = state === 'cockpit';
    // 座舱把转向手势直接交给 WebGL 画布：透明视野中心仍真实命中
    // canvas，而不是一个不可见的全屏 HUD 捕获层。普通生存态继续使用
    // capture 来划分摇杆/观察区域。
    var captureShow = show;
    var previousCapture = lastState === 'playing';
    if (captureShow !== previousCapture || show !== (lastState === 'playing')) {
      capture.style.display = captureShow ? 'block' : 'none';
      [btnJump, btnFly, btnPause, btnBag].forEach(function (b) {
        b.style.display = show ? 'flex' : 'none';
      });
      btnDescend.style.display =
        (show && Voxel.Player && Voxel.Player.flying()) ? 'flex' : 'none';
      if (!captureShow) {
        resetActiveInputs();
      }
    }
    if (show && Voxel.Player) {
      var fly = Voxel.Player.flying();
      btnFly.setAttribute('aria-pressed', fly ? 'true' : 'false');
      if ((fly ? 'flex' : 'none') !== btnDescend.style.display)
        btnDescend.style.display = fly ? 'flex' : 'none';
    } else if (btnFly) {
      btnFly.setAttribute('aria-pressed', 'false');
    }
    lastState = state;
  }

  function resetActiveInputs() {
    releaseStick();
    if (look) {
      if (look.lpTimer) { clearTimeout(look.lpTimer); look.lpTimer = null; }
      if (look.digOn && Voxel.Game) Voxel.Game.setDigHold(false);
      lookId = null; look = null;
      if (Voxel.Game) Voxel.Game.setTouchAim(null);
    }
    Voxel.Controls.keys['Space'] = false;
    Voxel.Controls.keys['ShiftLeft'] = false;
    Voxel.Controls.keys['KeyW'] = false;
    Voxel.Controls.keys['KeyS'] = false;
  }

  function bindEvents() {
    capture.addEventListener('pointerdown', onDown);
    document.addEventListener('pointerdown', function (e) {
      if (!Voxel.Game || Voxel.Game.state !== 'cockpit') return;
      if (!e.target || e.target.tagName !== 'CANVAS') return;
      onDown(e);
    });
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) resetActiveInputs();
    });
  }

  function init() {
    if (!enabled) return;
    buildDom();
    bindEvents();
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
        bindEvents();
      },
      stickVec: function () { return { x: moveX, y: moveY, mag: moveMag, sprint: stickSprint }; },
      lookActive: function () { return lookId !== null; }
    }
  };
})();
