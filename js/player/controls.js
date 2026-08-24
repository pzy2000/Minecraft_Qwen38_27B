// 键盘 + 指针锁定鼠标（灵敏度可在设置中调节）；触控模式下豁免指针锁定
window.Voxel = window.Voxel || {};

Voxel.Controls = (function () {
  var keys = {};
  var yaw = 0, pitch = 0;
  var locked = false;
  var SENS_BASE = 0.0023;
  var sensMul = 1.0;
  var canvas = null;

  // 触控模式：无指针锁定，isLocked 恒真（隐藏锁定提示、跳过 tryLock/pause-on-unlock）
  function touchMode() {
    return !!(Voxel.Touch && Voxel.Touch.enabled);
  }

  function applyLook(dx, dy, sensScale) {
    var s = SENS_BASE * sensMul * (sensScale || 1);
    yaw -= dx * s;
    pitch -= dy * s;
    var lim = Math.PI / 2 - 0.01;
    if (pitch > lim) pitch = lim;
    if (pitch < -lim) pitch = -lim;
  }

  function isInteractiveTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest('input, textarea, select, button, [contenteditable]:not([contenteditable="false"])');
  }

  function isModifiedCommand(e) {
    return !!(e.ctrlKey || e.metaKey || e.altKey);
  }

  function init(c) {
    canvas = c;
    if (Voxel.Settings) sensMul = Voxel.Settings.get('sens');
    document.addEventListener('keydown', function (e) {
      // 表单、按钮、可编辑内容、IME 和浏览器快捷键完全保留原生语义。
      if (isInteractiveTarget(e.target) || e.isComposing || isModifiedCommand(e)) return;
      keys[e.code] = true;
      var gameplay = Voxel.Game && (Voxel.Game.state === 'playing' || Voxel.Game.state === 'cockpit');
      if (gameplay && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0)
        e.preventDefault();
      // repeat 只维持移动 keys；开关/一次性命令每次物理按键最多执行一次。
      if (!e.repeat && Voxel.Game) Voxel.Game.onKey(e.code);
    });
    document.addEventListener('keyup', function (e) { keys[e.code] = false; });
    window.addEventListener('blur', function () {
      for (var k in keys) delete keys[k];
    });

    document.addEventListener('mousemove', function (e) {
      if (!locked) return;
      var s = SENS_BASE * sensMul;
      yaw -= e.movementX * s;
      pitch -= e.movementY * s;
      var lim = Math.PI / 2 - 0.01;
      if (pitch > lim) pitch = lim;
      if (pitch < -lim) pitch = -lim;
    });

    document.addEventListener('pointerlockchange', function () {
      locked = document.pointerLockElement === canvas ||
        (document.webkitPointerLockElement === canvas);
      if (Voxel.Game) Voxel.Game.onLockChange(locked);
    });
    document.addEventListener('pointerlockerror', function () {
      if (Voxel.Game) Voxel.Game.onLockError();
    });

    document.addEventListener('wheel', function (e) {
      if (!locked) return;
      if (Voxel.Game && Voxel.Game.state === 'playing')
        Voxel.Game.cycleSlot(e.deltaY > 0 ? 1 : -1);
    });
  }

  function setSens(m) { sensMul = m || 1; }

  return {
    init: init,
    setSens: setSens,
    applyLook: applyLook,
    touchMode: touchMode,
    keys: keys,
    yaw: function () { return yaw; },
    setYaw: function (v) { yaw = v; },
    pitch: function () { return pitch; },
    setPitch: function (v) { pitch = v; },
    isLocked: function () { return locked || touchMode(); },
    requestLock: function () {
      if (touchMode()) return true;
      try {
        var fn = canvas.requestPointerLock || canvas.webkitRequestPointerLock;
        if (!fn) return false; // 浏览器不支持指针锁定
        var p = fn.call(canvas);
        if (p && p.catch) p.catch(function () { });
        return true;
      } catch (e) { return false; }
    },
    exitLock: function () {
      if (touchMode()) return;
      try {
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        else if (document.webkitPointerLockElement === canvas) document.webkitExitPointerLock();
      } catch (e) { }
    }
  };
})();
