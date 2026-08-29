// 天气系统：晴/雨/雷雨自动循环、雨滴、流动云层、闪电雷鸣（可劈玩家）、雨后彩虹
window.Voxel = window.Voxel || {};

Voxel.Weather = (function () {
  var scene = null, cam = null;
  var state = 'clear';
  var spaceMode = false;
  var worldProfile = null;
  var rngState = 0x6d2b79f5;
  var intensity = 0;      // 当前雨量 0~1（平滑过渡）
  var target = 0;
  var timer = 0;          // 距下次自动切换的秒数
  var flash = 0;          // 闪电白屏 0~1
  var flash2 = -1;        // 二次闪烁延时
  var thunderT = -1;      // 雷鸣延迟
  var boltT = 0;          // 闪电枝可见倒计时
  var lightningT = 0;     // 雷暴时下次闪电倒计时
  var windA = 0;
  var driftX = 0, driftZ = 0; // 云层累计漂移（程序化云影同步用）
  var rainFadeT = 0;      // 雨后彩虹窗口（秒）
  var rainbowT = -1;      // 彩虹计时（<0 未激活）

  var rain = null, rainPos = null, dropXZ = null, dropY = null, dropSpd = null;
  var bolt = null, boltGeo = null;
  var clouds = [];        // { m, baseOp }
  var rainbow = null, rainbowMats = [];
  var tintC = new THREE.Color(1, 1, 1);
  var skyC = new THREE.Color(0x525a63);
  var skyTopC = new THREE.Color(0x454e58);
  var C_RAIN_SKY_DAY = new THREE.Color(0x525a63);
  var C_RAIN_SKY_NIGHT = new THREE.Color(0x14181f);
  var C_RAIN_TOP_DAY = new THREE.Color(0x454e58);
  var C_RAIN_TOP_NIGHT = new THREE.Color(0x0d1016);
  var C_RAIN_TINT = new THREE.Color(0.62, 0.66, 0.72);
  var C_CLOUD_GRAY = new THREE.Color(0x5a646e);
  var C_PRECIP = new THREE.Color(0x9fc0e8);
  var C_WHITE = new THREE.Color(0xffffff);
  var tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
  var RAINBOW_COLORS = [0xff3b30, 0xff9500, 0xffe135, 0x34c759, 0x32ade6, 0x0a84ff, 0xaf52de];
  var RAIN_TOP = 40, RAIN_BOT = -22;
  var rainDensityF = 1;        // 雨滴密度倍率（设置项，setDrawRange 实时生效）
  var rainVisibleN = 0;        // 实际模拟/绘制的雨丝数

  function seedRng(seed) {
    var s = 0;
    try {
      s = Voxel.SeedUtil && Voxel.SeedUtil.derive32
        ? Voxel.SeedUtil.derive32(String(seed || 'weather-default'), 0x71e47) : 0;
    } catch (e) { s = 0; }
    rngState = (s >>> 0) || 0x6d2b79f5;
  }

  function random() {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 4294967296;
  }

  function rand(a, b) { return a + random() * (b - a); }

  function duration(s) {
    var W = Voxel.Config.WEATHER;
    if (s === 'rain') return rand(W.RAIN_MIN, W.RAIN_MAX);
    if (s === 'storm') return rand(W.STORM_MIN, W.STORM_MAX);
    return rand(W.CLEAR_MIN, W.CLEAR_MAX);
  }

  function pickNext() {
    var r = random();
    if (state === 'clear') return r < 0.55 ? 'rain' : (r < 0.8 ? 'storm' : 'clear');
    if (state === 'rain') return r < 0.55 ? 'clear' : (r < 0.8 ? 'storm' : 'rain');
    return r < 0.7 ? 'clear' : 'rain';
  }

  function setState(s, toast) {
    state = s;
    timer = duration(s);
    target = (s === 'clear') ? 0 : 1;
    if (s === 'storm') lightningT = rand(1, 3);
    else lightningT = 0;
    if (toast && Voxel.HUD) {
      if (s === 'rain') Voxel.HUD.toast('环境变化：' + label());
      else if (s === 'storm') Voxel.HUD.toast('环境警报：' + label());
      else if (intensity > 0.3) Voxel.HUD.toast('天晴了');
    }
  }

  // ---------- 云纹理（程序化软斑点） ----------

  function makeCloudTex() {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    var c2 = cv.getContext('2d');
    for (var i = 0; i < 14; i++) {
      var x = 20 + random() * 88, y = 20 + random() * 88, r = 14 + random() * 30;
      var g = c2.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.4)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c2.fillStyle = g;
      c2.fillRect(0, 0, 128, 128);
    }
    return new THREE.CanvasTexture(cv);
  }

  function resetLayout(seed) {
    seedRng(seed);
    windA = random() * Math.PI * 2;
    driftX = random() * 1000; driftZ = random() * 1000;
    var W = Voxel.Config.WEATHER;
    if (dropY && dropXZ && dropSpd) {
      for (var i = 0; i < dropY.length; i++) {
        dropXZ[i * 2] = rand(-W.RAIN_BOX, W.RAIN_BOX);
        dropXZ[i * 2 + 1] = rand(-W.RAIN_BOX, W.RAIN_BOX);
        dropY[i] = rand(RAIN_BOT, RAIN_TOP);
        dropSpd[i] = W.RAIN_SPEED * rand(0.85, 1.2);
      }
    }
    for (var c = 0; c < clouds.length; c++) {
      clouds[c].m.position.set(rand(-330, 330), rand(110, 138), rand(-330, 330));
      clouds[c].baseOp = rand(0.22, 0.4);
    }
  }

  // ---------- 初始化 ----------

  function init(sceneArg) {
    if (scene && rain) return;
    var W = Voxel.Config.WEATHER;
    scene = sceneArg;
    seedRng('weather-default');

    // 雨滴：线段池，跟随相机
    var n = W.RAIN_DROPS;
    rainPos = new Float32Array(n * 6);
    dropXZ = new Float32Array(n * 2);
    dropY = new Float32Array(n);
    dropSpd = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      dropXZ[i * 2] = rand(-W.RAIN_BOX, W.RAIN_BOX);
      dropXZ[i * 2 + 1] = rand(-W.RAIN_BOX, W.RAIN_BOX);
      dropY[i] = rand(RAIN_BOT, RAIN_TOP);
      dropSpd[i] = W.RAIN_SPEED * rand(0.85, 1.2);
    }
    var rg = new THREE.BufferGeometry();
    var rattr = new THREE.BufferAttribute(rainPos, 3);
    if (rattr.setUsage) rattr.setUsage(THREE.DynamicDrawUsage);
    rg.setAttribute('position', rattr);
    rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({
      color: 0x9fc0e8, transparent: true, opacity: 0
    }));
    rain.frustumCulled = false;
    rain.visible = false;
    scene.add(rain);
    applyRainDensity();

    // 云层：水平面片 + 程序化纹理，随风漂移
    var tex1 = makeCloudTex(), tex2 = makeCloudTex();
    for (var c = 0; c < W.CLOUD_COUNT; c++) {
      var m = new THREE.Mesh(
        new THREE.PlaneGeometry(rand(50, 110), rand(30, 65)),
        new THREE.MeshBasicMaterial({
          map: (c % 2) ? tex2 : tex1, transparent: true, depthWrite: false,
          side: THREE.DoubleSide, fog: false, opacity: 0.3, color: 0xffffff
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(rand(-330, 330), rand(110, 138), rand(-330, 330));
      scene.add(m);
      clouds.push({ m: m, baseOp: rand(0.22, 0.4) });
    }

    // 闪电枝：锯齿折线
    boltGeo = new THREE.BufferGeometry();
    var battr = new THREE.BufferAttribute(new Float32Array(20 * 3), 3);
    if (battr.setUsage) battr.setUsage(THREE.DynamicDrawUsage);
    boltGeo.setAttribute('position', battr);
    bolt = new THREE.Line(boltGeo, new THREE.LineBasicMaterial({
      color: 0xdfe9ff, transparent: true, opacity: 0.95, fog: false
    }));
    bolt.frustumCulled = false;
    bolt.visible = false;
    scene.add(bolt);

    // 彩虹：七色同心弧，始终面向相机
    rainbow = new THREE.Group();
    for (var b = 0; b < 7; b++) {
      rainbowMats.push(new THREE.MeshBasicMaterial({
        color: RAINBOW_COLORS[b], transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false, fog: false
      }));
      rainbow.add(new THREE.Mesh(new THREE.TorusGeometry(100 + b * 3.4, 3.0, 6, 40, Math.PI), rainbowMats[b]));
    }
    rainbow.visible = false;
    scene.add(rainbow);

    reset();
  }

  // ---------- 闪电 ----------

  function setBolt(sx, sy, sz) {
    var a = boltGeo.attributes.position.array;
    var SEG = 16;
    var topY = sy + 78; // 相对落点取顶（世界限高提升后不再用绝对高度，任何海拔都不穿帮）
    var x = sx, z = sz;
    a[0] = x; a[1] = topY; a[2] = z;
    for (var i = 1; i <= SEG; i++) {
      var t = i / SEG;
      x += (random() - 0.5) * 7 * (1 - t * 0.4);
      z += (random() - 0.5) * 7 * (1 - t * 0.4);
      a[i * 3] = x;
      a[i * 3 + 1] = topY + (sy - topY) * t;
      a[i * 3 + 2] = z;
    }
    a[SEG * 3] = sx; a[SEG * 3 + 1] = sy; a[SEG * 3 + 2] = sz; // 末段收拢到落点
    boltGeo.attributes.position.needsUpdate = true;
    bolt.visible = true;
  }

  function playerInSealedShip() {
    try {
      return !!(Voxel.SpaceTravel && Voxel.SpaceTravel.isAboard && Voxel.SpaceTravel.isAboard());
    } catch (e) { return false; }
  }

  function applyPlayerStrike(p) {
    if (!p) return false;
    if (playerInSealedShip()) {
      if (Voxel.SpaceTravel && Voxel.SpaceTravel.registerShieldImpact)
        Voxel.SpaceTravel.registerShieldImpact('lightning');
      if (Voxel.HUD) Voxel.HUD.toast('雷击已被飞船舱体导流 · 生命维持稳定');
      return false;
    }
    var W = Voxel.Config.WEATHER;
    Voxel.Player.damage(W.STRIKE_DMG, "lightning", p.x + 0.01, p.z);
    if (Voxel.HUD) Voxel.HUD.toast('你被雷劈了！(-' + W.STRIKE_DMG + ')');
    return true;
  }

  function fireBolt() {
    var W = Voxel.Config.WEATHER;
    var p = (Voxel.Player && Voxel.Player.hp() > 0) ? Voxel.Player.pos() : null;
    var sx, sz, sy0, strike = false;
    if (p && random() < W.STRIKE_CHANCE) {
      sx = p.x; sz = p.z; sy0 = p.y; strike = true;
    } else {
      var a = random() * Math.PI * 2, r = rand(120, 380);
      sx = Math.cos(a) * r; sz = Math.sin(a) * r; sy0 = 6 + random() * 22;
      if (p) {
        var dx = p.x - sx, dz = p.z - sz;
        if (Math.sqrt(dx * dx + dz * dz) < W.STRIKE_RANGE) { sx = p.x; sz = p.z; sy0 = p.y; strike = true; }
      }
    }
    flash = 1;
    flash2 = 0.07;
    boltT = 0.13;
    thunderT = 0.35 + random() * 1.3;
    setBolt(sx, sy0, sz);
    if (strike && p) applyPlayerStrike(p);
  }

  // ---------- 主更新 ----------

  function update(dt) {
    var W = Voxel.Config.WEATHER;
    cam = (Voxel.Game && Voxel.Game.camera) ? Voxel.Game.camera : null;
    if (!cam) return;
    var DN = Voxel.DayNight;
    if (spaceMode) {
      rain.visible = false;
      if (bolt) bolt.visible = false;
      if (rainbow) rainbow.visible = false;
      for (var sc = 0; sc < clouds.length; sc++) clouds[sc].m.visible = false;
      if (Voxel.Sound && Voxel.Sound.rainSet) Voxel.Sound.rainSet(0);
      intensity = 0; target = 0; flash = 0;
      syncVisualState();
      return;
    }
    for (var vc = 0; vc < clouds.length; vc++) clouds[vc].m.visible = true;

    // 风向缓变
    windA += dt * 0.05;
    var wx = Math.cos(windA) * W.WIND, wz = Math.sin(windA) * W.WIND;
    driftX += wx * dt * 0.45;
    driftZ += wz * dt * 0.45;

    // 状态机：到点自动切换
    timer -= dt;
    if (timer <= 0) setState(pickNext(), true);

    // 雨量平滑过渡
    if (intensity !== target) {
      var stepLen = dt / W.TRANSITION;
      if (target > intensity) intensity = Math.min(target, intensity + stepLen);
      else intensity = Math.max(target, intensity - stepLen);
    }

    // 雨声
    if (Voxel.Sound && Voxel.Sound.rainSet) Voxel.Sound.rainSet(intensity * (0.4 + 0.6 * DN.sunlight()));

    // 雨滴
    rain.visible = intensity > 0.02;
    rain.material.opacity = 0.4 * intensity * (0.45 + 0.55 * DN.sunlight());
    if (rain.visible) {
      rain.position.copy(cam.position);
      var p = rainPos, box = W.RAIN_BOX;
      var n = rainVisibleN;
      for (var i = 0; i < n; i++) {
        var i6 = i * 6, i2 = i * 2;
        var spd = dropSpd[i];
        dropY[i] -= spd * dt;
        var x = dropXZ[i2] + wx * dt, z = dropXZ[i2 + 1] + wz * dt;
        if (dropY[i] < RAIN_BOT) {
          dropY[i] = RAIN_TOP;
          x = rand(-box, box); z = rand(-box, box);
        }
        if (x > box) x -= 2 * box; else if (x < -box) x += 2 * box;
        if (z > box) z -= 2 * box; else if (z < -box) z += 2 * box;
        dropXZ[i2] = x; dropXZ[i2 + 1] = z;
        // 雨丝沿速度方向（下落+风偏）拉伸
        var l = 0.9, k = l / Math.sqrt(spd * spd + wx * wx + wz * wz);
        var dx = wx * k * 0.5, dy = spd * k * 0.5, dz = wz * k * 0.5;
        p[i6] = x - dx; p[i6 + 1] = dropY[i] - dy; p[i6 + 2] = z - dz;
        p[i6 + 3] = x + dx; p[i6 + 4] = dropY[i] + dy; p[i6 + 5] = z + dz;
      }
      rain.geometry.attributes.position.needsUpdate = true;
    }

    // 云层：漂移 + 雨天变灰变密（环绕范围相对相机，地图边缘也有云）
    for (var c = 0; c < clouds.length; c++) {
      var cl = clouds[c], m = cl.m;
      m.position.x += wx * dt * 0.45;
      m.position.z += wz * dt * 0.45;
      var rx = m.position.x - cam.position.x;
      if (rx > 340 || rx < -340)
        m.position.x = cam.position.x + ((((rx + 340) % 680) + 680) % 680) - 340;
      var rz = m.position.z - cam.position.z;
      if (rz > 340 || rz < -340)
        m.position.z = cam.position.z + ((((rz + 340) % 680) + 680) % 680) - 340;
      m.material.opacity = cl.baseOp + (0.85 - cl.baseOp) * intensity;
      m.material.color.copy(C_WHITE).lerp(C_CLOUD_GRAY, intensity);
    }

    // 雷暴闪电
    if (state === 'storm' && intensity > 0.4) {
      lightningT -= dt;
      if (lightningT <= 0) {
        lightningT = rand(W.LIGHTNING_MIN, W.LIGHTNING_MAX);
        fireBolt();
      }
    }
    if (flash2 > 0) { flash2 -= dt; if (flash2 <= 0) flash = Math.max(flash, 0.75); }
    if (flash > 0) flash = Math.max(0, flash - dt * 6.5);
    if (boltT > 0) { boltT -= dt; if (boltT <= 0) bolt.visible = false; }
    if (thunderT > 0) {
      thunderT -= dt;
      if (thunderT <= 0) { thunderT = -1; if (Voxel.Sound && Voxel.Sound.thunder) Voxel.Sound.thunder(0.7 + random() * 0.3); }
    }

    // 彩虹：雨刚停 + 太阳当空 → 淡入淡出
    if (intensity > 0.3) rainFadeT = 90;
    else if (rainFadeT > 0) rainFadeT -= dt;
    if (rainbowT < 0 && state === 'clear' && intensity < 0.05 && rainFadeT > 0 && DN.sunlight() > 0.3) {
      rainbowT = 0;
    }
    var D = W.RAINBOW_DURATION;
    if (rainbowT >= 0) {
      rainbowT += dt;
      if (rainbowT >= D || DN.sunlight() < 0.15) {
        rainbowT = -1;
        rainbow.visible = false;
        for (var b = 0; b < rainbowMats.length; b++) rainbowMats[b].opacity = 0;
      } else {
        var op = Math.sin(Math.PI * rainbowT / D) * 0.5;
        for (var b2 = 0; b2 < rainbowMats.length; b2++) rainbowMats[b2].opacity = op;
        // 定位：反太阳方向 320 单位，弧基线在视平线，始终面向相机
        var ang = DN.time() * Math.PI * 2;
        tmpV.set(Math.cos(ang) * 480, Math.sin(ang) * 480, 140); // 太阳位置
        tmpV2.copy(cam.position).sub(tmpV);
        tmpV2.y = 0;
        if (tmpV2.lengthSq() < 0.01) tmpV2.set(0, 0, -1);
        tmpV2.normalize().multiplyScalar(320);
        rainbow.position.copy(cam.position).add(tmpV2);
        rainbow.lookAt(cam.position);
        rainbow.visible = true;
      }
    }

    syncVisualState();
  }

  // ---------- 对外接口 ----------

  function safeColor(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  function syncVisualState() {
    var sun = Voxel.DayNight && Voxel.DayNight.sunlight ? Voxel.DayNight.sunlight() : 1;
    if (spaceMode) {
      tintC.setRGB(1, 1, 1);
      var stationTop = worldProfile && worldProfile.nightTop;
      var stationHor = worldProfile && worldProfile.nightHorizon;
      skyTopC.setHex(safeColor(stationTop, 0x030511));
      skyC.setHex(safeColor(stationHor, 0x090d22));
      return;
    }
    tintC.setRGB(1, 1, 1).lerp(C_RAIN_TINT, intensity * 0.9);
    if (flash > 0) { tintC.r += flash * 0.9; tintC.g += flash * 0.92; tintC.b += flash * 0.95; }
    skyC.copy(C_RAIN_SKY_NIGHT).lerp(C_RAIN_SKY_DAY, sun);
    skyTopC.copy(C_RAIN_TOP_NIGHT).lerp(C_RAIN_TOP_DAY, sun);
    if (rain && rain.material) rain.material.color.copy(C_PRECIP);
    for (var i = 0; i < clouds.length; i++)
      clouds[i].m.material.color.copy(C_WHITE).lerp(C_CLOUD_GRAY, intensity);
  }

  function setWorldProfile(profile) {
    worldProfile = profile && typeof profile === 'object' ? profile : null;
    var w = worldProfile && worldProfile.weather && typeof worldProfile.weather === 'object'
      ? worldProfile.weather : {};
    C_RAIN_TOP_DAY.setHex(safeColor(w.topDay, 0x454e58));
    C_RAIN_SKY_DAY.setHex(safeColor(w.horizonDay, 0x525a63));
    C_RAIN_TOP_NIGHT.setHex(safeColor(w.topNight, 0x0d1016));
    C_RAIN_SKY_NIGHT.setHex(safeColor(w.horizonNight, 0x14181f));
    C_RAIN_TINT.setHex(safeColor(w.tint, 0x9ea8b8));
    C_CLOUD_GRAY.setHex(safeColor(w.cloud, 0x5a646e));
    C_PRECIP.setHex(safeColor(w.precipitationColor, 0x9fc0e8));
    resetLayout((worldProfile && worldProfile.seed) || 'weather-default');
    syncVisualState();
  }

  function reset() {
    state = 'clear';
    target = 0; intensity = 0;
    timer = duration('clear');
    flash = 0; flash2 = -1; thunderT = -1; boltT = 0; lightningT = 0;
    rainFadeT = 0; rainbowT = -1;
    if (bolt) bolt.visible = false;
    if (rain) rain.visible = false;
    if (rainbow) {
      rainbow.visible = false;
      for (var b = 0; b < rainbowMats.length; b++) rainbowMats[b].opacity = 0;
    }
    if (Voxel.Sound && Voxel.Sound.rainSet) Voxel.Sound.rainSet(0);
    tintC.setRGB(1, 1, 1);
    syncVisualState();
  }

  function restore(name) {
    if (name === 'rain' || name === 'storm') setState(name, false);
    else reset();
    syncVisualState();
  }

  function set(s) {
    if (s === 'clear' || s === 'rain' || s === 'storm') setState(s, false);
    syncVisualState();
  }

  function next() {
    var s = (state === 'clear') ? 'rain' : (state === 'rain' ? 'storm' : 'clear');
    setState(s, false);
    return s;
  }

  function label() {
    if (state === 'clear') return '晴';
    var kind = worldProfile && worldProfile.weather ? worldProfile.weather.precipitation : 'rain';
    var names = {
      dust: ['沙尘', '强沙暴'],
      snow: ['降雪', '暴风雪'],
      spores: ['孢子雨', '毒性风暴'],
      ash: ['火山灰', '灰烬风暴'],
      none: ['真空', '真空']
    };
    var pair = names[kind] || ['雨', '雷雨'];
    return state === 'rain' ? pair[0] : pair[1];
  }

  function applyRainDensity() {
    var total = Voxel.Config.WEATHER.RAIN_DROPS;
    if (!total) return;
    rainVisibleN = Math.max(1, Math.round(total * Math.max(0.05, Math.min(1, rainDensityF))));
    if (rain && rain.geometry) {
      rain.geometry.setDrawRange(0, rainVisibleN * 2);   // LineSegments：每段 2 顶点
    }
  }

  function setRainDensity(f) {
    rainDensityF = (typeof f === 'number' && isFinite(f)) ? f : 1;
    applyRainDensity();
  }

  function setSpaceMode(on) {
    spaceMode = !!on;
    if (spaceMode) {
      intensity = 0; target = 0; flash = 0;
      if (rain) rain.visible = false;
      if (bolt) bolt.visible = false;
      if (rainbow) rainbow.visible = false;
      for (var i = 0; i < clouds.length; i++) clouds[i].m.visible = false;
    }
    syncVisualState();
  }

  return {
    setRainDensity: setRainDensity,
    setSpaceMode: setSpaceMode,
    setWorldProfile: setWorldProfile,
    syncVisualState: syncVisualState,
    init: init,
    update: update,
    reset: reset,
    restore: restore,
    set: set,
    next: next,
    stateName: function () { return state; },
    label: label,
    intensity: function () { return intensity; },
    rainFactor: function () { return intensity; },
    // 当前风矢量（树叶摇摆 / 云影漂移共用同一风向）
    getWind: function () {
      var W = Voxel.Config.WEATHER;
      return { x: Math.cos(windA) * W.WIND, z: Math.sin(windA) * W.WIND, angle: windA };
    },
    // 云层累计漂移量（程序化云影与可见云层保持同步）
    getCloudDrift: function () { return { x: driftX, z: driftZ }; },
    flash: function () { return flash; },
    rainVisible: function () { return rain ? rain.visible : false; },
    cloudOpacity: function () { return clouds.length ? clouds[0].m.material.opacity : 0; },
    rainbowVisible: function () { return rainbow ? rainbow.visible : false; },
    rainbowOpacity: function () {
      if (rainbowT < 0) return 0;
      var D = Voxel.Config.WEATHER.RAINBOW_DURATION;
      return Math.sin(Math.PI * Math.min(rainbowT, D) / D) * 0.5;
    },
    getTint: function () { return tintC; },
    getSky: function () { return skyC; },
    getSkyTop: function () { return skyTopC; },
    // 测试/调试钩子
    _test: {
      fireLightning: fireBolt,
      flashBoltAt: function (x, y, z) {
        flash = 1; flash2 = 0.07; boltT = 0.13; thunderT = 0.3;
        setBolt(x, y, z);
      },
      forceStrike: function () {
        if (!(Voxel.Player && Voxel.Player.hp() > 0)) return;
        var p = Voxel.Player.pos();
        flash = 1; flash2 = 0.07; boltT = 0.13;
        thunderT = 0.3;
        setBolt(p.x, p.y, p.z);
        applyPlayerStrike(p);
      },
      triggerRainbow: function () { rainbowT = 0; rainFadeT = 90; },
      layoutSignature: function () {
        var values = [worldProfile && worldProfile.typeKey, windA];
        for (var i = 0; dropY && i < Math.min(8, dropY.length); i++)
          values.push(dropXZ[i * 2], dropXZ[i * 2 + 1], dropY[i], dropSpd[i]);
        for (var c = 0; c < Math.min(4, clouds.length); c++)
          values.push(clouds[c].m.position.x, clouds[c].m.position.y,
            clouds[c].m.position.z, clouds[c].baseOp);
        return JSON.stringify(values.map(function (v) {
          return typeof v === 'number' ? Math.round(v * 1000000) / 1000000 : v;
        }));
      },
      spaceMode: function () { return spaceMode; }
    }
  };
})();
