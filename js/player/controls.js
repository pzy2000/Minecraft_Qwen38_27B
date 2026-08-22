// 键盘 + 指针锁定鼠标（灵敏度可在设置中调节）
window.Voxel = window.Voxel || {};

Voxel.Controls = (function () {
  var keys = {};
  var yaw = 0, pitch = 0;
  var locked = false;
  var SENS_BASE = 0.0023;
  var sensMul = 1.0;
  var canvas = null;

  function init(c) {
    canvas = c;
    if (Voxel.Settings) sensMul = Voxel.Settings.get('sens');
    document.addEventListener('keydown', function (e) {
      keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
      if (Voxel.Game) Voxel.Game.onKey(e.code);
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
    keys: keys,
    yaw: function () { return yaw; },
    setYaw: function (v) { yaw = v; },
    pitch: function () { return pitch; },
    setPitch: function (v) { pitch = v; },
    isLocked: function () { return locked; },
    requestLock: function () {
      try {
        var fn = canvas.requestPointerLock || canvas.webkitRequestPointerLock;
        if (!fn) return false; // 浏览器不支持指针锁定
        var p = fn.call(canvas);
        if (p && p.catch) p.catch(function () { });
        return true;
      } catch (e) { return false; }
    },
    exitLock: function () {
      try {
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        else if (document.webkitPointerLockElement === canvas) document.webkitExitPointerLock();
      } catch (e) { }
    }
  };
})();
