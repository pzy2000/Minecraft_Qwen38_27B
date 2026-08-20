// 键盘 + 指针锁定鼠标
window.Voxel = window.Voxel || {};

Voxel.Controls = (function () {
  var keys = {};
  var yaw = 0, pitch = 0;
  var locked = false;
  var SENS = 0.0023;
  var canvas = null;

  function init(c) {
    canvas = c;
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
      yaw -= e.movementX * SENS;
      pitch -= e.movementY * SENS;
      var lim = Math.PI / 2 - 0.01;
      if (pitch > lim) pitch = lim;
      if (pitch < -lim) pitch = -lim;
    });

    document.addEventListener('pointerlockchange', function () {
      locked = document.pointerLockElement === canvas;
      if (Voxel.Game) Voxel.Game.onLockChange(locked);
    });

    document.addEventListener('wheel', function (e) {
      if (!locked) return;
      if (Voxel.Game && Voxel.Game.state === 'playing')
        Voxel.Game.cycleSlot(e.deltaY > 0 ? 1 : -1);
    });
  }

  return {
    init: init,
    keys: keys,
    yaw: function () { return yaw; },
    setYaw: function (v) { yaw = v; },
    pitch: function () { return pitch; },
    setPitch: function (v) { pitch = v; },
    isLocked: function () { return locked; },
    requestLock: function () {
      try {
        var p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(function () { });
      } catch (e) { }
    },
    exitLock: function () {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }
  };
})();
