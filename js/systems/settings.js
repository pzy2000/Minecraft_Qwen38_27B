// 全局设置：灵敏度/音量/FOV/雾距/触摸灵敏度/渲染分辨率/帧率上限/粒子雨滴生物密度
window.Voxel = window.Voxel || {};

Voxel.Settings = (function () {
  var KEY = 'voxelcraft_settings_v1';
  var DEFAULTS = {
    sens: 1.0, volume: 0.5, fov: 75, fog: 1.0,
    tsens: 1.0, res: 1.0,
    fpsCap: 0,              // 0=原生帧率，30/60=上限
    particleDensity: 1.0,
    rainDensity: 1.0,
    mobDensity: 1.0,
    // 分音效开关（1=开，0=关），键名对应 Sound 内部分类
    sndSheep: 1, sndPig: 1, sndChicken: 1, sndZombie: 1, sndRabbit: 1,
    sndStep: 1, sndDig: 1, sndEat: 1, sndWater: 1, sndLand: 1,
    sndUi: 1, sndMusic: 1, sndRain: 1, sndThunder: 1
  };
  // 分音效开关的中文标签（供 UI 与测试使用）
  var SND_LABELS = {
    sndSheep: '羊叫', sndPig: '猪叫', sndChicken: '鸡叫', sndZombie: '僵尸', sndRabbit: '兔子',
    sndStep: '脚步', sndDig: '挖掘/放置', sndEat: '进食', sndWater: '水声', sndLand: '跳跃/落地',
    sndUi: '界面/交互', sndMusic: '背景音乐', sndRain: '雨声', sndThunder: '雷声'
  };
  var LIMITS = {
    sens: [0.3, 3.0],
    volume: [0, 1],
    fov: [60, 100],
    fog: [0.5, 2.0],
    tsens: [0.4, 3.0],
    res: [0.35, 1.0],
    fpsCap: [0, 60],
    particleDensity: [0.25, 1],
    rainDensity: [0.25, 1],
    mobDensity: [0.25, 1]
  };
  // 分音效开关均为 0/1
  for (var sndKey in SND_LABELS) LIMITS[sndKey] = [0, 1];
  // 触屏设备首启默认（无任何存档设置时）：均衡档，避免手机端默认满配卡顿
  var TOUCH_DEFAULTS = {
    fpsCap: 60, res: 0.8,
    particleDensity: 0.7, rainDensity: 0.7, mobDensity: 0.75
  };
  var vals = {};
  var listeners = [];

  // 轻量触屏判定（与 ui/touch.js 主判定一致；settings 加载早于 touch.js）
  function isTouchDevice() {
    try {
      if (window.__FORCE_TOUCH__) return true;
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    } catch (e) { }
    return false;
  }

  function load() {
    vals = {};
    for (var k in DEFAULTS) vals[k] = DEFAULTS[k];
    var saved = null;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) saved = JSON.parse(raw);
    } catch (e) { }
    if (saved) {
      for (var k2 in DEFAULTS) {
        if (typeof saved[k2] === 'number' && isFinite(saved[k2])) {
          vals[k2] = Math.min(LIMITS[k2][1], Math.max(LIMITS[k2][0], saved[k2]));
        }
      }
    } else if (isTouchDevice()) {
      // 首次游玩的触屏设备：应用均衡默认档
      for (var k3 in TOUCH_DEFAULTS) vals[k3] = TOUCH_DEFAULTS[k3];
    }
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
    limits: LIMITS,
    touchDefaults: TOUCH_DEFAULTS,
    sndLabels: SND_LABELS
  };
})();
