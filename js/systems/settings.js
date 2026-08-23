// 全局设置：灵敏度 / 音量 / FOV / 雾距，localStorage 持久化
window.Voxel = window.Voxel || {};

Voxel.Settings = (function () {
  var KEY = 'voxelcraft_settings_v1';
  var DEFAULTS = { sens: 1.0, volume: 0.5, fov: 75, fog: 1.0, tsens: 1.0, res: 1.0 };
  var LIMITS = {
    sens: [0.3, 3.0],
    volume: [0, 1],
    fov: [60, 100],
    fog: [0.5, 2.0],
    tsens: [0.4, 3.0],
    res: [0.5, 1.0]
  };
  var vals = {};
  var listeners = [];

  function load() {
    vals = {};
    for (var k in DEFAULTS) vals[k] = DEFAULTS[k];
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        for (var k2 in DEFAULTS) {
          if (typeof saved[k2] === 'number' && isFinite(saved[k2])) {
            vals[k2] = Math.min(LIMITS[k2][1], Math.max(LIMITS[k2][0], saved[k2]));
          }
        }
      }
    } catch (e) { }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(vals)); } catch (e) { }
  }

  function get(k) { return vals[k]; }

  function set(k, v) {
    if (!(k in DEFAULTS)) return;
    v = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], +v || 0));
    vals[k] = v;
    save();
    for (var i = 0; i < listeners.length; i++) listeners[i](k, v);
  }

  function onChange(fn) { listeners.push(fn); }
  // 应用全部（游戏 init 后调用）
  function applyAll() {
    for (var k in vals) {
      for (var i = 0; i < listeners.length; i++) listeners[i](k, vals[k]);
    }
  }

  load();

  return {
    get: get,
    set: set,
    onChange: onChange,
    applyAll: applyAll,
    defaults: DEFAULTS,
    limits: LIMITS
  };
})();
