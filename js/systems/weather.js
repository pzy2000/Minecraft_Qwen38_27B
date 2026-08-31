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
  // 块状云层：占用网格 + 单 Mesh（顶点按绝对云格坐标写入预分配缓冲）
  var cloudLayer = null, cloudGeo = null, cloudMat = null;
  var cloudGrid = null, cloudPos = null, cloudShade = null;
  var cloudVerts = 0, cloudCells = 0;
  var cloudLevel = 2;     // 云质量档：0=关 1=流畅(平面) 2=高质量(立体)
  var cloudCi = 0, cloudCj = 0, cloudDirty = true;
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

  // ---------- 块状云层（原版：12 格云格 + 4 格厚，面分级明暗） ----------

  // 占用网格：矩形团块盖章 + 一次平滑，得到原版 clouds.png 那样的直角团块轮廓。
  // 只用种子随机（random()），同世界种子必须复现（禁止 Math.random）。
  function genCloudGrid() {
    var W = Voxel.Config.WEATHER, G = W.CLOUD_GRID, total = G * G;
    if (!cloudGrid || cloudGrid.length !== total) cloudGrid = new Uint8Array(total);
    else for (var z = 0; z < total; z++) cloudGrid[z] = 0;
    var wrap = function (v) { return ((v % G) + G) % G; };
    var target = total * W.CLOUD_COVER, filled = 0, guard = 0;
    while (filled < target && guard++ < 20000) {
      var cx = Math.floor(random() * G), cz = Math.floor(random() * G);
      var stamps = 1 + Math.floor(random() * 3);
      for (var s = 0; s < stamps; s++) {
        var sw = 3 + Math.floor(random() * 8), sh = 2 + Math.floor(random() * 5);
        var ox = cx + Math.floor(rand(-4, 5)), oz = cz + Math.floor(rand(-3, 4));
        for (var i = 0; i < sw; i++) {
          var gx = wrap(ox + i);
          for (var j = 0; j < sh; j++) {
            var idx = wrap(oz + j) * G + gx;
            if (!cloudGrid[idx]) { cloudGrid[idx] = 1; filled++; }
          }
        }
      }
    }
    // 平滑：去掉孤立单格（雪花感的来源），填掉单格空洞
    var src = cloudGrid.slice();
    cloudCells = 0;
    for (var gz = 0; gz < G; gz++) {
      for (var gxx = 0; gxx < G; gxx++) {
        var nb = src[gz * G + wrap(gxx - 1)] + src[gz * G + wrap(gxx + 1)] +
          src[wrap(gz - 1) * G + gxx] + src[wrap(gz + 1) * G + gxx];
        var v = src[gz * G + gxx];
        if (v && nb === 0) v = 0;
        else if (!v && nb >= 3) v = 1;
        cloudGrid[gz * G + gxx] = v;
        cloudCells += v;
      }
    }
  }

  // 占用网格摘要：布局确定性校验用（同种子必须一致）
  function cloudGridDigest() {
    if (!cloudGrid) return 0;
    var h = 0x811c9dc5;
    for (var i = 0; i < cloudGrid.length; i++)
      h = (Math.imul(h ^ cloudGrid[i], 16777619) >>> 0);
    return h;
  }

  function cellAt(gx, gz) {
    var G = Voxel.Config.WEATHER.CLOUD_GRID;
    return cloudGrid[(((gz % G) + G) % G) * G + (((gx % G) + G) % G)];
  }

  // 四边形：A-B-C + A-C-D（绕序按面法线朝外，配合 FrontSide 剔除背面）
  function pushQuad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, shade) {
    var p = cloudPos, s = cloudShade, n = cloudVerts;
    if (!p || (n + 6) * 3 > p.length) return;
    var o = n * 3;
    p[o] = ax; p[o + 1] = ay; p[o + 2] = az;
    p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz;
    p[o + 6] = cx; p[o + 7] = cy; p[o + 8] = cz;
    p[o + 9] = ax; p[o + 10] = ay; p[o + 11] = az;
    p[o + 12] = cx; p[o + 13] = cy; p[o + 14] = cz;
    p[o + 15] = dx; p[o + 16] = dy; p[o + 17] = dz;
    s[n] = shade; s[n + 1] = shade; s[n + 2] = shade;
    s[n + 3] = shade; s[n + 4] = shade; s[n + 5] = shade;
    cloudVerts = n + 6;
  }

  // 以相机所在云格 (ci,cj) 为中心重建局部网格：局部原点 = 该云格的西北角。
  // 顶/底面与 Z 侧面沿 X 做行合并，X 侧面逐格出面。
  function rebuildCloudMesh(ci, cj) {
    var W = Voxel.Config.WEATHER;
    var CELL = W.CLOUD_CELL, TH = W.CLOUD_THICK, R = W.CLOUD_RADIUS;
    cloudVerts = 0;
    if (!cloudGrid) genCloudGrid();
    var flat = cloudLevel < 2;
    for (var dj = -R; dj <= R; dj++) {
      var z0 = dj * CELL, z1 = z0 + CELL;
      var hasRun = false, run = 0;              // 顶/底面行合并
      var hasN = false, runN = 0;               // -Z 侧面行合并
      var hasP = false, runP = 0;               // +Z 侧面行合并
      for (var di = -R; di <= R + 1; di++) {
        var on = di <= R ? cellAt(ci + di, cj + dj) : 0;
        var x0 = di * CELL;
        if (on && !hasRun) { hasRun = true; run = x0; }
        else if (!on && hasRun) {
          pushQuad(run, TH, z1, x0, TH, z1, x0, TH, z0, run, TH, z0, 1.0);
          if (!flat) pushQuad(run, 0, z0, x0, 0, z0, x0, 0, z1, run, 0, z1, 0.7);
          hasRun = false;
        }
        if (!flat) {
          var openN = on && !cellAt(ci + di, cj + dj - 1);
          if (openN && !hasN) { hasN = true; runN = x0; }
          else if (!openN && hasN) {
            pushQuad(x0, 0, z0, runN, 0, z0, runN, TH, z0, x0, TH, z0, 0.9);
            hasN = false;
          }
          var openP = on && !cellAt(ci + di, cj + dj + 1);
          if (openP && !hasP) { hasP = true; runP = x0; }
          else if (!openP && hasP) {
            pushQuad(runP, 0, z1, x0, 0, z1, x0, TH, z1, runP, TH, z1, 0.9);
            hasP = false;
          }
          if (on) {
            if (!cellAt(ci + di - 1, cj + dj))
              pushQuad(x0, 0, z0, x0, 0, z1, x0, TH, z1, x0, TH, z0, 0.8);
            if (!cellAt(ci + di + 1, cj + dj)) {
              var x1 = x0 + CELL;
              pushQuad(x1, 0, z1, x1, 0, z0, x1, TH, z0, x1, TH, z1, 0.8);
            }
          }
        }
      }
    }
    cloudGeo.attributes.position.needsUpdate = true;
    cloudGeo.attributes.aShade.needsUpdate = true;
    cloudGeo.setDrawRange(0, cloudVerts);
    cloudCi = ci; cloudCj = cj; cloudDirty = false;
  }

  function makeCloudLayer() {
    var W = Voxel.Config.WEATHER;
    var cells = (2 * W.CLOUD_RADIUS + 1) * (2 * W.CLOUD_RADIUS + 1);
    // 行合并后实测约 3 顶点/占用云格（团块内部不出面），取 20 倍余量；
    // pushQuad 有溢出守卫，极端图案最多截断远处云而不会越界。
    var maxVerts = cells * 20;
    cloudPos = new Float32Array(maxVerts * 3);
    cloudShade = new Float32Array(maxVerts);
    cloudGeo = new THREE.BufferGeometry();
    var pAttr = new THREE.BufferAttribute(cloudPos, 3);
    var sAttr = new THREE.BufferAttribute(cloudShade, 1);
    if (pAttr.setUsage) pAttr.setUsage(THREE.DynamicDrawUsage);
    if (sAttr.setUsage) sAttr.setUsage(THREE.DynamicDrawUsage);
    cloudGeo.setAttribute('position', pAttr);
    cloudGeo.setAttribute('aShade', sAttr);
    cloudGeo.setDrawRange(0, 0);
    cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xffffff) },
        uOpacity: { value: W.CLOUD_ALPHA },
        uFadeNear: { value: W.CLOUD_FADE_NEAR },
        uFadeFar: { value: W.CLOUD_FADE_FAR }
      },
      vertexShader: [
        'attribute float aShade;',
        'uniform float uFadeNear;',
        'uniform float uFadeFar;',
        'varying float vShade;',
        'varying float vFade;',
        'void main(){',
        '  vec4 wp = modelMatrix * vec4(position, 1.0);',
        '  vShade = aShade;',
        // 水平距离淡出：既是原版的远景消隐，也遮住构建半径的硬边界
        '  vFade = 1.0 - smoothstep(uFadeNear, uFadeFar, length(wp.xz - cameraPosition.xz));',
        '  gl_Position = projectionMatrix * viewMatrix * wp;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor;',
        'uniform float uOpacity;',
        'varying float vShade;',
        'varying float vFade;',
        'void main(){',
        '  float a = uOpacity * vFade;',
        '  if (a < 0.01) discard;',
        '  gl_FragColor = vec4(uColor * vShade, a);',
        '}'
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide
    });
    cloudLayer = new THREE.Mesh(cloudGeo, cloudMat);
    cloudLayer.frustumCulled = false;
    cloudLayer.position.y = W.CLOUD_Y;
    return cloudLayer;
  }

  // 每帧：相机跨过云格边界就重建，其余时间只用小数部分位移（云在世界里连续漂移）
  function updateCloudLayer() {
    var W = Voxel.Config.WEATHER, CELL = W.CLOUD_CELL;
    if (!cloudLayer || !cam) return;
    if (spaceMode || cloudLevel < 1) { cloudLayer.visible = false; return; }
    cloudLayer.visible = true;
    var cu = (cam.position.x - driftX) / CELL, ci = Math.floor(cu);
    var cv = (cam.position.z - driftZ) / CELL, cj = Math.floor(cv);
    if (cloudDirty || ci !== cloudCi || cj !== cloudCj) rebuildCloudMesh(ci, cj);
    cloudLayer.position.set(cam.position.x - (cu - ci) * CELL, W.CLOUD_Y,
      cam.position.z - (cv - cj) * CELL);
    // 相机进入云层厚度范围（或平面档）时渲染双面，否则背面剔除
    var inside = cloudLevel < 2 ||
      (cam.position.y > W.CLOUD_Y - 2 && cam.position.y < W.CLOUD_Y + W.CLOUD_THICK + 2);
    var want = inside ? THREE.DoubleSide : THREE.FrontSide;
    if (cloudMat.side !== want) { cloudMat.side = want; cloudMat.needsUpdate = true; }
    cloudMat.uniforms.uOpacity.value =
      W.CLOUD_ALPHA + (W.CLOUD_ALPHA_WET - W.CLOUD_ALPHA) * intensity;
  }

  function setCloudQuality(level) {
    var v = Math.max(0, Math.min(2, Math.round(+level || 0)));
    if (v === cloudLevel) return;
    cloudLevel = v;
    cloudDirty = true;
    if (cloudLayer) {
      cloudLayer.visible = cloudLevel > 0 && !spaceMode;
      if (cloudLevel === 0) { cloudVerts = 0; cloudGeo.setDrawRange(0, 0); }
    }
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
    genCloudGrid();
    cloudDirty = true;
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

    // 云层：原版块状云（12 格云格 × 4 格厚），跟随相机重建、随风连续漂移
    genCloudGrid();
    scene.add(makeCloudLayer());

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
      if (cloudLayer) cloudLayer.visible = false;
      if (Voxel.Sound && Voxel.Sound.rainSet) Voxel.Sound.rainSet(0);
      intensity = 0; target = 0; flash = 0;
      syncVisualState();
      return;
    }

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

    // 云层：跟随相机重建 + 随风连续漂移（雨天变灰变密在 syncVisualState/该函数内）
    updateCloudLayer();

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
    if (cloudMat) {
      // 亮度随天光走（原版同理）：夜里若保持纯白，0.8 的不透明度会在暗天上发光
      cloudMat.uniforms.uColor.value.copy(C_WHITE).lerp(C_CLOUD_GRAY, intensity)
        .multiplyScalar(0.28 + 0.72 * sun);
    }
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
      if (cloudLayer) cloudLayer.visible = false;
    } else if (cloudLayer) {
      cloudLayer.visible = cloudLevel > 0;
    }
    syncVisualState();
  }

  return {
    setRainDensity: setRainDensity,
    setCloudQuality: setCloudQuality,
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
    cloudOpacity: function () { return cloudMat ? cloudMat.uniforms.uOpacity.value : 0; },
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
        values.push(driftX, driftZ, cloudCells, cloudGridDigest());
        return JSON.stringify(values.map(function (v) {
          return typeof v === 'number' ? Math.round(v * 1000000) / 1000000 : v;
        }));
      },
      cloudStats: function () {
        var W = Voxel.Config.WEATHER, G = W.CLOUD_GRID;
        return {
          level: cloudLevel,
          visible: !!(cloudLayer && cloudLayer.visible),
          vertices: cloudVerts,
          cells: cloudCells,
          coverage: cloudCells / (G * G),
          y: W.CLOUD_Y,
          digest: cloudGridDigest()
        };
      },
      rebuildClouds: function () {
        cloudDirty = true;
        if (cam) updateCloudLayer();
        else if (cloudLayer && cloudLevel > 0) rebuildCloudMesh(0, 0);
      },
      spaceMode: function () { return spaceMode; }
    }
  };
})();
