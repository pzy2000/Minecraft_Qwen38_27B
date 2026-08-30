// 小地图（仿中国版「新版小地图」）：右上角可缩放地形图 + 坐标/群系/时间信息条。
// - 地形按玩家朝向旋转（雷达式），草/水/沙等直接取方块定义色并按高度明暗化；
// - 白色箭头为玩家自身，飞船以琥珀色三角常驻显示，越出图幅时吸附边缘；
// - 重绘节流：静止不重画，移动 >1 格或视角转动 >6° 才触发下一次采样。
window.Voxel = window.Voxel || {};

Voxel.MiniMap = (function () {
  var CSS_SIZE = 148;                 // 地图画布显示边长（px）
  var ZOOMS = [0.75, 1.5, 3];         // 每格像素数（缩小 ↔ 放大）
  var zoomIndex = 1;
  var REDRAW_INTERVAL = 220;          // 地形采样最小间隔 ms
  var MOVE_EPS = 1, YAW_EPS = 0.105;  // 约 1 格 / 约 6°

  var rootEl = null, canvas = null, infoEl = null;
  var hidden = false;

  var lastDrawAt = -1e9;
  var lastPx = NaN, lastPz = NaN, lastYaw = NaN, lastZoom = NaN;
  var infoKey = '';

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function playerPos() {
    try {
      if (Voxel.Player && Voxel.Player.pos) return Voxel.Player.pos();
    } catch (e) { }
    return null;
  }

  function playerYaw() {
    try { return Voxel.Controls && Voxel.Controls.yaw ? Voxel.Controls.yaw() : 0; }
    catch (e) { return 0; }
  }

  function blockColor(id) {
    var defs = Voxel.Blocks && Voxel.Blocks.defs;
    return defs && defs[id] && typeof defs[id].color === 'number' ? defs[id].color : 0x2a2a2a;
  }

  function hexToRgb(hex) {
    return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  }

  function shipInfo() {
    if (!Voxel.SpaceTravel || !Voxel.SpaceTravel.ship) return null;
    var st = Voxel.SpaceTravel.currentWorld ? Voxel.SpaceTravel.currentWorld() : null;
    if (!st || st.kind !== 'planet') return null;
    var ship = Voxel.SpaceTravel.ship();
    if (!ship || !ship.position) return null;
    var p = ship.position;
    if (!isFinite(p.x) || !isFinite(p.z)) return null;
    return { x: p.x, y: p.y, z: p.z };
  }

  function summonActive() {
    try {
      var s = Voxel.SpaceTravel && Voxel.SpaceTravel.summonStatus
        ? Voxel.SpaceTravel.summonStatus() : null;
      return !!(s && s.active);
    } catch (e) { return false; }
  }

  // ---------- 地形绘制 ----------

  function drawTerrain(ctx, size, scale, px, pz, yaw, imgData) {
    var half = size / 2;
    var fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    var rx = Math.cos(yaw), rz = -Math.sin(yaw);
    var data = imgData.data;
    var surfGet = Voxel.World.surfaceAt, blkGet = Voxel.World.get;

    for (var sy = 0; sy < size; sy++) {
      var b = -(sy - half) / scale;   // forward 分量
      var wxB_x = b * fx, wxB_z = b * fz;
      for (var sx = 0; sx < size; sx++) {
        var a = (sx - half) / scale;  // right 分量
        var wx = px + a * rx + wxB_x;
        var wz = pz + a * rz + wxB_z;
        var xi = Math.floor(wx), zi = Math.floor(wz);
        var col = [26, 30, 36];
        var shade = 0.82;
        try {
          var top = surfGet(xi, zi);
          var id = blkGet(xi, top, zi);
          col = hexToRgb(blockColor(id));
          // 高度明暗：以水面附近为基准，越高越亮、洼地越暗
          var rel = Math.max(-24, Math.min(24, top - 31));
          shade = 0.78 + rel * 0.009;
          if (!Voxel.Blocks.isSolid(id)) shade *= 0.92; // 水面略压暗
        } catch (e) { /* 未加载区块：保留背景色 */ }
        var o = (sy * size + sx) * 4;
        data[o] = Math.min(255, col[0] * shade);
        data[o + 1] = Math.min(255, col[1] * shade);
        data[o + 2] = Math.min(255, col[2] * shade);
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function tri(ctx, cx, cy, r, rotDeg, fill, stroke) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotDeg * Math.PI / 180);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.72, r * 0.66);
    ctx.lineTo(0, r * 0.32);
    ctx.lineTo(-r * 0.72, r * 0.66);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }

  function drawMarkers(size, scale, px, py, pz, yaw, nowSec) {
    var ctx = canvas.getContext('2d');
    var half = size / 2;
    var fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    var rx = Math.cos(yaw), rz = -Math.sin(yaw);

    // 指北针（N 随地图旋转，贴圆环上缘）
    var northDot = worldToScreen(rx, rz, fx, fz, half, 0, -1, scale);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ff8a7a';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', northDot.x, northDot.y);
    ctx.restore();

    // 飞船标记：琥珀色三角，出图幅时吸附到边缘并降低透明度
    var st = shipInfo();
    if (st) {
      var dot = worldToScreen(rx, rz, fx, fz, half, st.x - px, st.z - pz, scale);
      var offscreen = false;
      if (Math.abs(dot.x - half) > half - 9 || Math.abs(dot.y - half) > half - 9) {
        var dxv = dot.x - half, dyv = dot.y - half;
        var len = Math.sqrt(dxv * dxv + dyv * dyv) || 1;
        var lim = half - 10;
        dot = { x: half + dxv / len * lim, y: half + dyv / len * lim };
        offscreen = true;
      }
      var pulse = summonActive()
        ? 0.75 + 0.25 * Math.sin(nowSec * 5)
        : (offscreen ? 0.65 : 1);
      ctx.save();
      ctx.globalAlpha = pulse;
      tri(ctx, dot.x, dot.y, 6, 180, '#ffc85c', 'rgba(20,14,4,.85)');
      ctx.restore();
    }

    // 玩家白色箭头：始终位于中心（地图随人旋转）
    tri(ctx, half, half, 7, 0, '#ffffff', 'rgba(10,10,12,.9)');
  }

  // 世界偏移 → 屏幕坐标（与 drawTerrain 的投影互逆）
  function worldToScreen(rx, rz, fx, fz, half, dxw, dzw, scale) {
    return {
      x: half + (dxw * rx + dzw * rz) * scale,
      y: half - (dxw * fx + dzw * fz) * scale
    };
  }

  function redraw(nowMs) {
    if (!canvas) return;
    var p = playerPos();
    if (!p || !Voxel.World || !Voxel.World.surfaceAt || !Voxel.World.get) return;
    var yaw = playerYaw();
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var size = Math.round(CSS_SIZE * dpr);
    if (canvas.width !== size) canvas.width = size;
    if (canvas.height !== size) canvas.height = size;
    var scale = ZOOMS[zoomIndex] * dpr;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.clip();

    var imgData = ctx.getImageData(0, 0, size, size);
    drawTerrain(ctx, size, scale, p.x, p.z, yaw, imgData);
    drawMarkers(size, scale, p.x, p.y, p.z, yaw, nowMs / 1000);

    ctx.restore();
    lastDrawAt = nowMs;
    lastPx = p.x; lastPz = p.z; lastYaw = playerYaw(); lastZoom = zoomIndex;
  }

  // ---------- 信息条 ----------

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function refreshInfo(p) {
    if (!infoEl) return;
    var coords = Math.floor(p.x) + ', ' + Math.floor(p.y) + ', ' + Math.floor(p.z);
    var biome = '?';
    try {
      var bid = Voxel.World.biomeAt(Math.floor(p.x), Math.floor(p.z));
      var def = Voxel.Biomes && Voxel.Biomes.def ? Voxel.Biomes.def(bid) : null;
      if (def && def.name) biome = def.name;
    } catch (e) { /* 未加载区域 */ }
    var timeTxt = '--:--';
    try {
      var hours = (Voxel.DayNight.time() % 1) * 24;
      timeTxt = pad2(Math.floor(hours)) + ':' + pad2(Math.floor((hours % 1) * 60));
    } catch (e) { }
    var key = coords + '\u001f' + biome + '\u001f' + timeTxt;
    if (key === infoKey) return;
    infoKey = key;
    infoEl.textContent = '';
    var c = document.createElement('b');
    c.textContent = coords;
    infoEl.appendChild(c);
    var mid = document.createElement('span');
    mid.textContent = biome;
    infoEl.appendChild(mid);
    var t = document.createElement('span');
    t.textContent = timeTxt;
    infoEl.appendChild(t);
    infoEl.setAttribute('aria-label',
      '小地图 · 坐标 ' + coords + ' · 生物群系 ' + biome + ' · 时间 ' + timeTxt);
  }

  // ---------- 控制按钮（隐藏 / 缩放） ----------

  function makeBtn(cls, label, title, action) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'minimap-btn ' + cls;
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      action();
    }, { passive: false });
    return btn;
  }

  function applyHiddenState() {
    if (!rootEl) return;
    rootEl.classList.toggle('minimap-hidden', hidden);
    var body = rootEl.querySelector('.minimap-body');
    if (body) body.hidden = hidden;
    var toggle = rootEl.querySelector('.minimap-btn[data-role="toggle"]');
    if (toggle) {
      toggle.textContent = hidden ? '+' : '−';
      toggle.setAttribute('aria-pressed', hidden ? 'false' : 'true');
    }
  }

  function buildDom() {
    rootEl = document.createElement('div');
    rootEl.id = 'minimap';
    rootEl.className = 'minimap';
    rootEl.setAttribute('role', 'region');
    rootEl.setAttribute('aria-label', '小地图');

    var bar = document.createElement('div');
    bar.className = 'minimap-bar';
    bar.appendChild(makeBtn('', '−', '收起/展开小地图', function () {
      hidden = !hidden;
      applyHiddenState();
      Voxel.Sound.select();
    })).setAttribute('data-role', 'toggle');
    bar.appendChild(makeBtn('small', '+', '放大（视野更近）', function () {
      if (zoomIndex < ZOOMS.length - 1) { zoomIndex++; Voxel.Sound.select(); }
    }));
    bar.appendChild(makeBtn('small', '–', '缩小（视野更远）', function () {
      if (zoomIndex > 0) { zoomIndex--; Voxel.Sound.select(); }
    }));
    rootEl.appendChild(bar);

    var body = document.createElement('div');
    body.className = 'minimap-body';
    canvas = document.createElement('canvas');
    canvas.id = 'minimap-canvas';
    canvas.width = CSS_SIZE; canvas.height = CSS_SIZE;
    canvas.setAttribute('aria-hidden', 'true');
    body.appendChild(canvas);
    infoEl = document.createElement('div');
    infoEl.className = 'minimap-info';
    infoEl.setAttribute('aria-live', 'off');
    body.appendChild(infoEl);
    rootEl.appendChild(body);

    document.body.appendChild(rootEl);
    applyHiddenState();
  }

  function init() {
    if (rootEl) return;
    buildDom();
  }

  // 主循环每帧调用；visible=false 时整体隐藏并跳过渲染。
  function update(nowMs, visible) {
    if (!rootEl) init();
    if (!visible) {
      if (rootEl.style.display !== 'none') rootEl.style.display = 'none';
      return;
    }
    if (rootEl.style.display !== '') rootEl.style.display = '';
    var p = playerPos();
    if (!p) return;
    if (!isFinite(lastPx)) { redraw(nowMs); refreshInfo(p); return; }
    var moved =
      Math.abs(p.x - lastPx) >= MOVE_EPS || Math.abs(p.z - lastPz) >= MOVE_EPS;
    var yawDelta = Math.abs(
      ((playerYaw() - lastYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    turned = yawDelta > YAW_EPS;
    // 静止低频重绘；召唤进行中提高脉冲帧率让飞船标记呼吸。
    var due = zoomIndex !== lastZoom || moved || turned ||
      nowMs - lastDrawAt >= REDRAW_INTERVAL ||
      (summonActive() && nowMs - lastDrawAt > 100);
    if (due) redraw(nowMs);
    refreshInfo(p);
  }

  return {
    init: init,
    update: update,
    isVisible: function () { return !!rootEl && rootEl.style.display !== 'none' && !hidden; },
    _test: {
      drawTerrain: drawTerrain,
      worldToScreen: worldToScreen,
      refreshInfo: refreshInfo,
      setZoom: function (i) { zoomIndex = Math.max(0, Math.min(ZOOMS.length - 1, i | 0)); return zoomIndex; }
    }
  };
})();
