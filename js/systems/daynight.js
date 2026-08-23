// 昼夜时钟与大气调色。天空 GPU 资源由 Atmosphere 单点拥有；本模块只计算
// 时间、日照、地形 tint 和当前 profile 的顶部/地平线颜色。
window.Voxel = window.Voxel || {};

Voxel.DayNight = (function () {
  var time = 0.3;
  var scene = null;
  var profile = null;
  var sunlight = 1;
  var duskAmount = 0;
  var skyColor = new THREE.Color(0xbfe3f2);
  var tint = new THREE.Color(1, 1, 1);
  var topC = new THREE.Color(0x5aa0e0);
  var horC = new THREE.Color(0xbfe3f2);
  var pDayTop = new THREE.Color(0x5aa0e0);
  var pDayHor = new THREE.Color(0xbfe3f2);
  var pDuskTop = new THREE.Color(0x53386e);
  var pDuskHor = new THREE.Color(0xff7a3c);
  var pNightTop = new THREE.Color(0x04060f);
  var pNightHor = new THREE.Color(0x0b1026);
  var pTintDay = new THREE.Color(0xffffff);
  var pTintNight = new THREE.Color(0x52647a);
  var lastCam = { x: 128, y: 30, z: 128 };

  function smoothstep(a, b, x) {
    var t = (x - a) / (b - a);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }

  function safeHex(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  function fallbackProfile(world) {
    return {
      typeKey: world && world.kind === 'station' ? 'station' : 'lush',
      worldId: world && world.id ? String(world.id) : '',
      seed: world && world.seed ? String(world.seed) : '0',
      station: !!(world && world.kind === 'station'),
      day: { top: 0x5aa0e0, horizon: 0xbfe3f2 },
      dusk: { top: 0x53386e, horizon: 0xff7a3c },
      night: { top: 0x04060f, horizon: 0x0b1026 },
      tintDay: 0xffffff, tintNight: 0x52647a,
      ambientFloor: 0.2, exponent: 0.72, weatherMix: 0.75,
      weather: {}, stars: { count: 320, color: 0xffffff, secondaryColor: 0x8dcfff },
      nebula: { colorA: 0x276d8a, colorB: 0x563d86, opacity: 0.2, rotation: 0, seed: 1 },
      suns: [], moons: [], landmark: null,
      signatureRole: 'pollen', particles: { role: 'pollen', count: 24, color: 0xc8ffb0 }
    };
  }

  function cacheProfileColors() {
    var p = profile || fallbackProfile(null);
    pDayTop.setHex(safeHex(p.day && p.day.top, 0x5aa0e0));
    pDayHor.setHex(safeHex(p.day && p.day.horizon, 0xbfe3f2));
    pDuskTop.setHex(safeHex(p.dusk && p.dusk.top, 0x53386e));
    pDuskHor.setHex(safeHex(p.dusk && p.dusk.horizon, 0xff7a3c));
    pNightTop.setHex(safeHex(p.night && p.night.top, 0x04060f));
    pNightHor.setHex(safeHex(p.night && p.night.horizon, 0x0b1026));
    pTintDay.setHex(safeHex(p.tintDay, 0xffffff));
    pTintNight.setHex(safeHex(p.tintNight, 0x52647a));
  }

  function phaseState() {
    return {
      time: time,
      sunlight: sunlight,
      dusk: duskAmount,
      isNight: sunlight < 0.4
    };
  }

  function init(sceneArg) {
    scene = sceneArg || scene;
    if (Voxel.Atmosphere && Voxel.Atmosphere.init && scene) Voxel.Atmosphere.init(scene);
  }

  function loadWorld(world, options) {
    profile = Voxel.AtmosphereProfiles && Voxel.AtmosphereProfiles.create
      ? Voxel.AtmosphereProfiles.create(world) : fallbackProfile(world);
    cacheProfileColors();
    if (Voxel.Atmosphere) {
      if (Voxel.Atmosphere.init && scene) Voxel.Atmosphere.init(scene);
      if (Voxel.Atmosphere.loadWorld) Voxel.Atmosphere.loadWorld(world || {}, options || {});
    }
    update(0);
    return profile;
  }

  function update(dt) {
    dt = typeof dt === 'number' && isFinite(dt) && dt > 0 ? dt : 0;
    time = (time + dt / Voxel.Config.DAY_LENGTH) % 1;
    if (time < 0) time += 1;
    var el = Math.sin(time * Math.PI * 2); // t=0 日出 .25 正午 .5 日落 .75 午夜
    sunlight = smoothstep(-0.12, 0.25, el);
    duskAmount = Math.max(0, 1 - Math.abs(el) / 0.5);

    topC.copy(pNightTop).lerp(pDayTop, sunlight);
    horC.copy(pNightHor).lerp(pDayHor, sunlight);
    topC.lerp(pDuskTop, duskAmount * 0.78);
    horC.lerp(pDuskHor, duskAmount * (0.45 + 0.45 * sunlight));
    skyColor.copy(horC);

    tint.copy(pTintNight).lerp(pTintDay, sunlight);
    if (duskAmount > 0) {
      tint.r = Math.min(1.25, tint.r + duskAmount * 0.08);
      tint.g = Math.min(1.15, tint.g + duskAmount * 0.025);
    }

    if (Voxel.Atmosphere) {
      if (Voxel.Atmosphere.setColors) Voxel.Atmosphere.setColors(topC, horC);
      if (Voxel.Atmosphere.update) Voxel.Atmosphere.update(dt, lastCam, phaseState());
    }
  }

  function updateCamera(p) {
    if (!p) return;
    var x = Number(p.x), y = Number(p.y), z = Number(p.z);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
    lastCam.x = x; lastCam.y = y; lastCam.z = z;
    if (Voxel.Atmosphere && Voxel.Atmosphere.update)
      Voxel.Atmosphere.update(0, lastCam, phaseState());
  }

  function setTime(t) {
    t = Number(t);
    if (!isFinite(t)) t = 0.3;
    time = ((t % 1) + 1) % 1;
  }

  function applySky(top, hor) {
    // topC/horC 是 profile 的“无天气基色”。不能把最终天气色写回它们，
    // 否则高刷无物理步帧和暂停画面会每次再次 lerp，逐帧收敛成统一灰天。
    if (hor) skyColor.copy(hor);
    else skyColor.copy(horC);
    if (Voxel.Atmosphere && Voxel.Atmosphere.setColors)
      Voxel.Atmosphere.setColors(top || topC, hor || horC);
  }

  function clearWorld() {
    profile = null;
    if (Voxel.Atmosphere && Voxel.Atmosphere.clear) Voxel.Atmosphere.clear();
  }

  return {
    init: init,
    loadWorld: loadWorld,
    clearWorld: clearWorld,
    update: update,
    updateCamera: updateCamera,
    time: function () { return time; },
    setTime: setTime,
    isNight: function () { return sunlight < 0.4; },
    sunlight: function () { return sunlight; },
    ambientFloor: function () {
      var n = profile && Number(profile.ambientFloor);
      return isFinite(n) ? Math.max(0.08, Math.min(0.5, n)) : 0.2;
    },
    weatherMix: function () {
      var n = profile && Number(profile.weatherMix);
      return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.75;
    },
    profile: function () { return profile; },
    getTint: function () { return tint; },
    getSky: function () { return skyColor; },
    topColor: function () { return topC; },
    horizonColor: function () { return horC; },
    applySky: applySky,
    setDensity: function (value) {
      if (Voxel.Atmosphere && Voxel.Atmosphere.setDensity) Voxel.Atmosphere.setDensity(value);
    },
    setReducedMotion: function (on) {
      if (Voxel.Atmosphere && Voxel.Atmosphere.setReducedMotion) Voxel.Atmosphere.setReducedMotion(on);
    },
    snapshot: function () {
      return Voxel.Atmosphere && Voxel.Atmosphere.snapshot ? Voxel.Atmosphere.snapshot() : null;
    },
    resourceStats: function () {
      return Voxel.Atmosphere && Voxel.Atmosphere.resourceStats ? Voxel.Atmosphere.resourceStats() : null;
    }
  };
})();
