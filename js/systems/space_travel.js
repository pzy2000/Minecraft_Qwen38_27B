// 星际旅行表现层：像素飞船、种子门户、星图和跃迁 HUD。
window.Voxel = window.Voxel || {};

Voxel.SpaceTravel = (function () {
  var scene = null, group = null, ship = null, portals = [];
  var galaxy = null, world = null, nearShip = false, portalCooldown = 0;
  var fuelEl = null, worldEl = null, coordEl = null, mapGrid = null;
  var scanEl = null, scanWorldEl = null, scanPositionEl = null, scanBiomeEl = null;
  var scanEnvironmentEl = null, scanTargetEl = null, scanDistanceEl = null;
  var scanTarget = { kind: 'none', label: '无锁定目标', distance: null };
  var scanLastSampleAt = -Infinity, scanLastSignature = '', scanUrgent = false;
  var scanOnline = false;
  var shipBaseY = 0;
  var shipParts = { engines: [], door: null, ramp: null };
  var stationHub = null, stationDock = null, stationTerminal = null;
  var animatedRings = [];
  var reducedMotion = false, visualTimeOverride = null;
  var rampTarget = 0, rampFrom = 0, rampChangedAt = 0, rampProgress = 0;
  var selectedDestinationId = null, flightMode = 'ship', flightSkipping = false;
  var arrivalTimer = null;
  var generation = 0;
  var owned = { geometries: [], materials: [], textures: [] };
  var created = { roots: 0, geometries: 0, materials: 0, textures: 0 };
  var disposed = { roots: 0, geometries: 0, materials: 0, textures: 0 };
  var SCAN_INTERVAL_MS = 125; // 约 8Hz；目标种类/名称改变时允许立即刷新。
  var _interactionPoint = new THREE.Vector3();

  function finite(v, fallback, min, max) {
    var n = Number(v);
    if (!isFinite(n)) n = fallback;
    if (!isFinite(n)) n = 0;
    if (typeof min === 'number' && n < min) n = min;
    if (typeof max === 'number' && n > max) n = max;
    return n;
  }

  function safeText(v, fallback, maxLen) {
    var s = (typeof v === 'string' || typeof v === 'number') ? String(v) : '';
    s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    // 这些是程序值泄漏，不是可展示的遥测文本。
    if (!s || /\b(?:undefined|null|nan|infinity)\b|\[object object\]/i.test(s) ||
      /^[-—?？\s]+$/.test(s) || /^未知(?:星域|天体)?$/.test(s)) s = fallback || '';
    if (!s) s = '不可用';
    return s.slice(0, Math.max(1, maxLen || 64));
  }

  function signed(v, digits) {
    var n = finite(v, 0, -9999999.9, 9999999.9);
    var s = n.toFixed(digits);
    return (n >= 0 ? '+' : '') + s;
  }

  function safeWorldKind(w) { return w && w.kind === 'station' ? 'station' : 'planet'; }

  function safeAccent(v) {
    var s = typeof v === 'string' ? v.trim() : '';
    return /^#[0-9a-f]{3,8}$/i.test(s) ? s : '#8df7ff';
  }

  function track(kind, resource) {
    if (!resource || !owned[kind] || owned[kind].indexOf(resource) >= 0) return resource;
    owned[kind].push(resource);
    created[kind]++;
    return resource;
  }

  function disposeList(kind) {
    var list = owned[kind];
    for (var i = 0; i < list.length; i++) {
      var resource = list[i];
      if (resource && typeof resource.dispose === 'function') {
        try { resource.dispose(); } catch (e) { /* 单个GPU资源失败不能阻断换世界 */ }
      }
      disposed[kind]++;
    }
    list.length = 0;
  }

  function setRole(obj, role, detail) {
    if (!obj) return obj;
    obj.userData = obj.userData || {};
    obj.userData.role = role;
    if (detail) obj.userData.detail = detail;
    return obj;
  }

  function visualTime() {
    if (visualTimeOverride !== null) return visualTimeOverride;
    return ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) * 0.001;
  }

  function ease01(v) {
    v = Math.max(0, Math.min(1, v));
    return v * v * (3 - 2 * v);
  }

  function worldText(w) {
    var kind = safeWorldKind(w);
    return {
      icon: safeText(w && w.icon, kind === 'station' ? '▣' : '◆', 4),
      name: safeText(w && w.name, kind === 'station' ? '未命名空间站' : '未命名行星', 48),
      typeName: safeText(w && w.typeName, kind === 'station' ? '轨道空间站' : '行星', 32),
      kind: kind
    };
  }

  function shipText(g) {
    var raw = g && g.ship && typeof g.ship === 'object' ? g.ship : {};
    var maxFuel = finite(raw.maxFuel, 100, 1, 999);
    var fuel = finite(raw.fuel, 0, 0, maxFuel);
    return {
      engine: safeText(raw.engine, '跃迁引擎', 40),
      maxFuel: Math.round(maxFuel),
      fuel: Math.round(fuel),
      percent: Math.round(fuel / maxFuel * 100)
    };
  }

  function setText(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }

  function setAttr(el, name, value) {
    if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function bindScanDom() {
    if (typeof document === 'undefined') return;
    if (scanEl && scanWorldEl && scanPositionEl && scanBiomeEl && scanEnvironmentEl &&
      scanTargetEl && scanDistanceEl && document.documentElement.contains(scanEl)) return;
    scanEl = document.getElementById('scan-terminal');
    scanWorldEl = document.getElementById('scan-world');
    scanPositionEl = document.getElementById('scan-position');
    scanBiomeEl = document.getElementById('scan-biome');
    scanEnvironmentEl = document.getElementById('scan-environment');
    scanTargetEl = document.getElementById('scan-target');
    scanDistanceEl = document.getElementById('scan-distance');
  }

  function resetScanTarget() {
    scanTarget = { kind: 'none', label: '无锁定目标', distance: null };
    scanUrgent = true;
  }

  function setScanOffline() {
    bindScanDom();
    setAttr(scanEl, 'data-status', 'offline');
    setAttr(scanEl, 'data-target-kind', 'none');
    setText(scanWorldEl, '遥测离线');
    setText(scanPositionEl, '坐标不可用');
    setText(scanBiomeEl, '区域不可用');
    setText(scanEnvironmentEl, '环境不可用');
    setText(scanTargetEl, '无锁定目标');
    setText(scanDistanceEl, '—');
    scanLastSignature = '';
    scanLastSampleAt = -Infinity;
  }

  function setHudOffline() {
    setText(worldEl, '◆ 导航链路离线');
    setText(coordEl, '星图坐标离线');
    if (fuelEl) {
      setText(fuelEl, '跃迁待机');
      fuelEl.style.setProperty('--fuel', '0%');
    }
  }

  function scanModel() {
    var wt = worldText(world);
    var p = Voxel.Player && Voxel.Player.pos ? Voxel.Player.pos() : null;
    var px = finite(p && p.x, 0, -9999999.9, 9999999.9);
    var py = finite(p && p.y, 0, -9999999.9, 9999999.9);
    var pz = finite(p && p.z, 0, -9999999.9, 9999999.9);
    var biome = '空间站平台';
    var environment = '真空 · 人工重力';
    if (wt.kind !== 'station') {
      try {
        var bid = Voxel.World && Voxel.World.biomeAt ? Voxel.World.biomeAt(Math.floor(px), Math.floor(pz)) : 0;
        biome = safeText(Voxel.Biomes && Voxel.Biomes.name ? Voxel.Biomes.name(bid) : '', '未识别群系', 32);
      } catch (e) { biome = '未识别群系'; }
      var phase = Voxel.DayNight && Voxel.DayNight.isNight && Voxel.DayNight.isNight() ? '夜间' : '日间';
      var weather = safeText(Voxel.Weather && Voxel.Weather.label ? Voxel.Weather.label() : '', '晴', 16);
      environment = phase + ' · ' + weather;
      var hazard = Voxel.Environment && Voxel.Environment.status ? Voxel.Environment.status() : null;
      if (hazard && hazard.hazard && hazard.hazard !== 'none')
        environment += ' · ' + safeText(hazard.label, '环境危害', 18) + ' ' +
          Math.max(0, Math.min(100, Math.round(Number(hazard.percent) || 0))) + '%';
    }
    var kind = scanTarget.kind;
    var label = kind === 'none' ? '无锁定目标' : safeText(scanTarget.label, '未命名目标', 48);
    var distance = kind === 'none' || scanTarget.distance === null ? '—' : finite(scanTarget.distance, 0, 0, 9999.9).toFixed(1) + ' m';
    return {
      status: 'online',
      targetKind: kind,
      world: wt.icon + ' ' + wt.name + ' · ' + wt.typeName,
      position: 'X ' + signed(px, 1) + ' · Y ' + signed(py, 1) + ' · Z ' + signed(pz, 1),
      biome: biome,
      environment: environment,
      target: label,
      distance: distance
    };
  }

  function syncScan(force) {
    bindScanDom();
    if (!scanEl || !scanOnline || !world || !galaxy) { setScanOffline(); return; }
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (!force && !scanUrgent && now - scanLastSampleAt < SCAN_INTERVAL_MS) return;
    scanLastSampleAt = now;
    var model = scanModel();
    var sig = [model.status, model.targetKind, model.world, model.position, model.biome,
      model.environment, model.target, model.distance].join('\u001f');
    if (force || sig !== scanLastSignature) {
      setAttr(scanEl, 'data-status', model.status);
      setAttr(scanEl, 'data-target-kind', model.targetKind);
      setText(scanWorldEl, model.world);
      setText(scanPositionEl, model.position);
      setText(scanBiomeEl, model.biome);
      setText(scanEnvironmentEl, model.environment);
      setText(scanTargetEl, model.target);
      setText(scanDistanceEl, model.distance);
      scanLastSignature = sig;
    }
    scanUrgent = false;
  }

  function setScanTarget(kind, label, distance) {
    kind = kind === 'block' || kind === 'mob' ? kind : 'none';
    var nextLabel = kind === 'none' ? '无锁定目标' : safeText(label, '未命名目标', 48);
    var nextDistance = kind === 'none' ? null : finite(distance, 0, 0, 9999.9);
    // 距离显示到 0.1m，先量化可避免微小浮点抖动制造无意义 DOM 写入。
    if (nextDistance !== null) nextDistance = Math.round(nextDistance * 10) / 10;
    if (scanTarget.kind !== kind || scanTarget.label !== nextLabel) scanUrgent = true;
    scanTarget = { kind: kind, label: nextLabel, distance: nextDistance };
    return { kind: kind, label: nextLabel, distance: nextDistance };
  }

  function box(parent, size, pos, color, emissive, role, options) {
    options = options || {};
    var lit = new THREE.Color(color);
    if (emissive) lit.lerp(new THREE.Color(emissive), 0.32);
    var matOptions = {
      color: lit,
      fog: options.fog !== false,
      transparent: !!options.transparent,
      opacity: options.opacity === undefined ? 1 : options.opacity,
      depthWrite: options.depthWrite === undefined ? true : !!options.depthWrite
    };
    if (options.side !== undefined) matOptions.side = options.side;
    if (options.blending !== undefined) matOptions.blending = options.blending;
    var mat = track('materials', new THREE.MeshBasicMaterial(matOptions));
    var mesh = new THREE.Mesh(track('geometries', new THREE.BoxGeometry(size[0], size[1], size[2])), mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (options.rotation)
      mesh.rotation.set(options.rotation[0] || 0, options.rotation[1] || 0, options.rotation[2] || 0);
    setRole(mesh, role || 'structure', options.detail);
    mesh.name = 'SpaceTravel_' + (role || 'structure');
    parent.add(mesh);
    return mesh;
  }

  function safeSurface(x, z) {
    var best = null;
    var finiteStation = !!world && world.kind === 'station';
    for (var r = 0; r <= 14; r += 2) {
      for (var dx = -r; dx <= r; dx += Math.max(2, r || 2))
        for (var dz = -r; dz <= r; dz += Math.max(2, r || 2)) {
          var xx = x + dx, zz = z + dz;
          // 空间站仍是有限真空平台；行星地表使用无限世界坐标，不得夹回旧边界。
          if (finiteStation) {
            xx = Math.max(4, Math.min(251, xx));
            zz = Math.max(4, Math.min(251, zz));
          }
          var y = Voxel.World.surfaceAt(xx, zz);
          var ground = Voxel.World.get(xx, y, zz);
          var organic = ground === 4 || ground === 5 || ground === 20 || ground === 21 ||
            ground === 22 || ground === 23 || ground === 26 || ground === 33 || ground === 34 ||
            ground === 35 || ground === 36;
          if (y > 2 && y < 58 && !organic && Voxel.World.get(xx, y + 1, zz) === 0) {
            if (!best || y > best.y) best = { x: xx, y: y, z: zz };
          }
        }
      if (best) return best;
    }
    if (finiteStation) {
      x = Math.max(4, Math.min(251, x));
      z = Math.max(4, Math.min(251, z));
    }
    var sy = Voxel.World.surfaceAt(x, z);
    return { x: x, y: Math.max(2, Math.min(58, sy)), z: z };
  }

  function makeShip() {
    var g = setRole(new THREE.Group(), 'ship-root');
    g.name = 'SpaceShip';
    shipParts = { engines: [], door: null, ramp: null };
    box(g, [4.4, 1.25, 6.8], [0, 1.42, 0], 0x22304a, null, 'ship-hull', { detail: 'upper' });
    box(g, [3.2, 0.42, 7.7], [0, 0.82, 0.22], 0x172238, null, 'ship-hull', { detail: 'keel' });
    var nose = box(g, [3.0, 0.92, 2.0], [0, 1.48, -4.05], 0xbec9d5, null,
      'ship-nose', { detail: 'forward', rotation: [0.08, 0, 0] });
    box(g, [1.65, 0.55, 1.25], [0, 1.38, -5.32], 0xe1e8ee, null,
      'ship-nose', { detail: 'tip', rotation: [0.14, 0, 0] });
    box(g, [2.45, 0.82, 2.75], [0, 2.28, -1.12], 0x6bdcff, 0x123a55, 'ship-canopy', {
      transparent: true, opacity: 0.46, depthWrite: false, side: THREE.DoubleSide
    });
    box(g, [4.25, 0.22, 2.35], [-3.45, 1.17, 0.48], 0x53647d, null,
      'ship-wing', { detail: 'left', rotation: [0, -0.22, 0] });
    box(g, [4.25, 0.22, 2.35], [3.45, 1.17, 0.48], 0x53647d, null,
      'ship-wing', { detail: 'right', rotation: [0, 0.22, 0] });
    box(g, [5.1, 0.18, 1.35], [0, 1.53, 3.18], 0x40516d, null,
      'ship-tail', { detail: 'stabilizer' });
    box(g, [0.22, 1.55, 1.75], [0, 2.28, 3.05], 0x6d7f99, null,
      'ship-tail', { detail: 'fin' });
    [-1, 1].forEach(function (side) {
      box(g, [1.12, 0.86, 2.45], [side * 1.58, 1.25, 3.45], 0x263852, null,
        'ship-engine', { detail: side < 0 ? 'left' : 'right' });
      var glow = box(g, [0.78, 0.58, 0.16], [side * 1.58, 1.25, 4.75], 0x42e8ff, 0x0788c8,
        'ship-engine-glow', {
          detail: side < 0 ? 'left' : 'right', transparent: true, opacity: 0.82,
          depthWrite: false, blending: THREE.AdditiveBlending
        });
      shipParts.engines.push(glow);
    });
    [[-1.55, -2.15], [1.55, -2.15], [-1.55, 2.15], [1.55, 2.15]].forEach(function (v, i) {
      box(g, [0.28, 0.76, 0.28], [v[0], 0.38, v[1]], 0x78879a, null,
        'ship-landing-gear', { detail: 'gear-' + i });
    });
    shipParts.door = box(g, [0.14, 1.28, 1.7], [2.26, 1.56, 0.5], 0x91e8ff, 0x123a55,
      'ship-door', { detail: 'starboard' });
    shipParts.door.userData.baseY = shipParts.door.position.y;
    shipParts.ramp = box(g, [1.8, 0.12, 1.55], [2.34, 0.32, 0.5], 0x71839a, null,
      'ship-ramp', { detail: 'starboard' });
    shipParts.ramp.userData.baseX = shipParts.ramp.position.x;
    shipParts.ramp.scale.x = 0.04;
    shipParts.ramp.visible = false;
    g.userData.interactionLocal = [3.25, 0.8, 0.5];
    nose.userData.forward = true;
    return g;
  }

  function makePortal(p, dest) {
    var g = setRole(new THREE.Group(), 'portal-root');
    var c = new THREE.Color(dest.accent || '#8df7ff');
    var ring = setRole(new THREE.Mesh(
      track('geometries', new THREE.TorusGeometry(1.65, 0.18, 4, 12)),
      track('materials', new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.92 }))
    ), 'portal-ring');
    ring.name = 'SpaceTravel_portal-ring';
    ring.position.y = 2.05;
    g.add(ring);
    box(g, [0.55, 3.8, 0.55], [-1.75, 1.9, 0], 0x20283b, null, 'portal-frame', { detail: 'left' });
    box(g, [0.55, 3.8, 0.55], [1.75, 1.9, 0], 0x20283b, null, 'portal-frame', { detail: 'right' });
    box(g, [4.0, 0.5, 0.75], [0, 3.8, 0], 0x33415f, null, 'portal-frame', { detail: 'top' });
    var field = setRole(new THREE.Mesh(
      track('geometries', new THREE.PlaneGeometry(2.9, 2.9)),
      track('materials', new THREE.MeshBasicMaterial({
        color: c, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending
      }))
    ), 'portal-field');
    field.name = 'SpaceTravel_portal-field';
    field.position.y = 2.0;
    g.add(field);
    var key = String(p && p.id || 'portal');
    var hash = 2166136261 >>> 0;
    for (var hi = 0; hi < key.length; hi++)
      hash = Math.imul((hash ^ key.charCodeAt(hi)) >>> 0, 16777619) >>> 0;
    g.userData = {
      role: 'portal-root', portal: p, ring: ring, field: field, destination: dest,
      spinPhase: (hash / 4294967296) * Math.PI * 2,
      spinRate: (hash & 1) ? -0.8 : 0.8
    };
    animatedRings.push({ mesh: ring, phase: g.userData.spinPhase, rate: g.userData.spinRate });
    return g;
  }

  function makeStationHub() {
    var g = setRole(new THREE.Group(), 'station-hub-root');
    g.name = 'StationTerminalHub';
    // 高塔负责远距离识别；抵达点位于其南侧，不再出生在不参与碰撞的装饰盒内部。
    box(g, [8, 1, 8], [0, 0.5, 0], 0x202c43, null, 'station-terminal-base');
    box(g, [5.5, 0.35, 5.5], [0, 1.15, 0], 0x39d8f2, 0x126b7d, 'station-terminal-glow');
    box(g, [3.2, 4.8, 3.2], [0, 3.4, 0], 0x263c59, null, 'station-terminal');
    // 显示面朝南方抵达点（+Z）。
    box(g, [3.35, 1.4, 0.24], [0, 3.7, 1.72], 0x75f5ff, 0x176b88,
      'station-terminal-screen', { transparent: true, opacity: 0.78, depthWrite: false });
    box(g, [1.3, 6.8, 1.3], [0, 8.5, 0], 0x4b5b7c, null, 'station-mast');
    box(g, [0.55, 3.6, 0.55], [0, 13.6, 0], 0xf16dff, 0x7b2488,
      'station-beacon', { transparent: true, opacity: 0.9, depthWrite: false });
    for (var i = 0; i < 4; i++) {
      var a = i * Math.PI / 2 + Math.PI / 4;
      var px = Math.cos(a) * 10, pz = Math.sin(a) * 10;
      box(g, [1.1, 4.2, 1.1], [px, 2.1, pz], 0x354867, null,
        'station-pylon', { detail: 'pylon-' + i });
      box(g, [1.45, 0.45, 1.45], [px, 4.45, pz], i % 2 ? 0xf16dff : 0x53e8ff,
        i % 2 ? 0x6b236f : 0x176b88, 'navigation-light', {
          detail: 'pylon-' + i, transparent: true, opacity: 0.88, depthWrite: false
        });
    }
    var ring = setRole(new THREE.Mesh(
      track('geometries', new THREE.TorusGeometry(2.25, 0.12, 4, 16)),
      track('materials', new THREE.MeshBasicMaterial({
        color: 0x75f5ff, transparent: true, opacity: 0.72,
        depthWrite: false, blending: THREE.AdditiveBlending
      }))
    ), 'station-ring');
    ring.position.set(0, 7.2, 0);
    ring.rotation.x = 0.38;
    g.add(ring);
    animatedRings.push({ mesh: ring, phase: 0.35, rate: 0.34, tiltX: 0.38 });
    // 深空星场、远方母星与星环由 Atmosphere 单点拥有；这里仅生成空间站建筑，
    // 避免与全局天空叠加第二套不跟随相机的 Points。
    return g;
  }

  function makeStationDock() {
    var g = setRole(new THREE.Group(), 'station-dock-root');
    g.name = 'StationArrivalDock';
    var ring = setRole(new THREE.Mesh(
      track('geometries', new THREE.TorusGeometry(3.15, 0.1, 4, 24)),
      track('materials', new THREE.MeshBasicMaterial({
        color: 0x53e8ff, transparent: true, opacity: 0.7,
        depthWrite: false, blending: THREE.AdditiveBlending
      }))
    ), 'dock-beacon');
    ring.position.y = 0.18;
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    box(g, [0.38, 3.2, 0.38], [-3.2, 1.6, -5.0], 0x354867, null,
      'dock-arch', { detail: 'left' });
    box(g, [0.38, 3.2, 0.38], [3.2, 1.6, -5.0], 0x354867, null,
      'dock-arch', { detail: 'right' });
    box(g, [6.75, 0.34, 0.42], [0, 3.25, -5.0], 0x53e8ff, 0x176b88,
      'dock-arch', { detail: 'header', transparent: true, opacity: 0.9, depthWrite: false });
    [-2.5, -7.0, -11.0].forEach(function (z, row) {
      [-1, 1].forEach(function (side) {
        box(g, [0.42, 0.24, 0.42], [side * 2.15, 0.18, z], row % 2 ? 0xf16dff : 0x53e8ff,
          row % 2 ? 0x6b236f : 0x176b88, 'navigation-light', {
            detail: 'approach-' + row + '-' + side,
            transparent: true, opacity: 0.9, depthWrite: false
          });
      });
    });
    return g;
  }

  function safeShipSurface(spawn) {
    // 机鼻朝玩家会向出生点再伸出约5格；中心至少前置18格才能让整船落入75°视锥，
    // 避免只看到贴脸的船腹。
    var targets = [[0, -18], [-6, -20], [6, -20], [0, -24]];
    var fallback = null;
    for (var i = 0; i < targets.length; i++) {
      var pos = safeSurface(Math.round(spawn.x + targets[i][0]), Math.round(spawn.z + targets[i][1]));
      if (!fallback) fallback = pos;
      // yaw=0 朝 -Z；优先保证玩家第一眼确实能看到前方飞船，而不是重新落到身后。
      if (pos.z <= spawn.z - 10) return pos;
    }
    return fallback || safeSurface(Math.round(spawn.x), Math.round(spawn.z - 18));
  }

  function rampValueAt(now) {
    if (reducedMotion) return rampTarget;
    var elapsed = Math.max(0, now - rampChangedAt);
    return rampFrom + (rampTarget - rampFrom) * ease01(elapsed / 0.42);
  }

  function setRampTarget(value, now) {
    value = value ? 1 : 0;
    if (value === rampTarget) return;
    rampFrom = rampValueAt(now);
    rampTarget = value;
    rampChangedAt = now;
  }

  function applyVisualState(now) {
    now = finite(now, 0, 0, 1e9);
    for (var i = 0; i < animatedRings.length; i++) {
      var item = animatedRings[i];
      if (!item || !item.mesh) continue;
      if (item.tiltX !== undefined) item.mesh.rotation.x = item.tiltX;
      item.mesh.rotation.z = item.phase + (reducedMotion ? 0 : now * item.rate);
    }
    for (var p = 0; p < portals.length; p++) {
      var portal = portals[p];
      if (portal && portal.userData && portal.userData.field && portal.userData.field.material)
        portal.userData.field.material.opacity = reducedMotion ? 0.22 :
          0.2 + Math.sin(now * 4 + portal.userData.spinPhase) * 0.05;
    }
    var enginePulse = reducedMotion ? 0.82 : 0.78 + Math.sin(now * 5.2) * 0.14;
    for (var e = 0; e < shipParts.engines.length; e++) {
      var engine = shipParts.engines[e];
      if (!engine) continue;
      if (engine.material) engine.material.opacity = enginePulse;
      var engineScale = reducedMotion ? 1 : 1 + Math.sin(now * 5.2) * 0.08;
      engine.scale.x = engineScale;
      engine.scale.y = engineScale;
    }
    rampProgress = rampValueAt(now);
    if (shipParts.door) shipParts.door.position.y = shipParts.door.userData.baseY + rampProgress * 0.86;
    if (shipParts.ramp) {
      shipParts.ramp.position.x = shipParts.ramp.userData.baseX + rampProgress * 0.86;
      shipParts.ramp.scale.x = Math.max(0.04, rampProgress);
      shipParts.ramp.visible = rampProgress > 0.015;
    }
  }

  function clear() {
    var hadRoot = !!group;
    if (group && group.parent) group.parent.remove(group);
    if (hadRoot) disposed.roots++;
    // 未来模型会共享几何/材质；按账本唯一释放，禁止 traverse 时重复dispose。
    disposeList('materials');
    disposeList('geometries');
    disposeList('textures');
    group = null; ship = null; shipBaseY = 0; portals = []; nearShip = false;
    shipParts = { engines: [], door: null, ramp: null };
    stationHub = null; stationDock = null; stationTerminal = null;
    animatedRings.length = 0;
    rampTarget = rampFrom = rampProgress = 0;
    rampChangedAt = visualTime();
    selectedDestinationId = null;
    hideArrival();
    galaxy = null; world = null;
    scanOnline = false;
    resetScanTarget();
    setScanOffline();
    setHudOffline();
    return hadRoot;
  }

  function loadWorld(w, g) {
    clear();
    galaxy = g; world = w;
    scanOnline = !!world && !!galaxy;
    resetScanTarget();
    // DOM 遥测不依赖 3D 建模完成；首帧以及缺少 scene 的测试环境都必须立刻可读。
    syncHud();
    syncScan(true);
    if (!scene || !world || !galaxy) return;
    group = setRole(new THREE.Group(), 'space-travel-root');
    group.name = 'SpaceTravelRoot';
    group.userData.system = 'space-travel';
    group.userData.generation = ++generation;
    created.roots++;
    scene.add(group);

    var layout = Voxel.Galaxy.portalsFor(galaxy, world);
    for (var i = 0; i < layout.length; i++) {
      var pos = safeSurface(layout[i].x, layout[i].z);
      var dest = Voxel.Galaxy.find(galaxy, layout[i].destinationId) || {};
      var pg = makePortal(layout[i], dest);
      pg.position.set(pos.x + 0.5, pos.y + 1, pos.z + 0.5);
      group.add(pg);
      portals.push(pg);
    }

    if (safeWorldKind(world) === 'planet') {
      var sp = Voxel.World.spawnPoint();
      var sPos = safeShipSurface(sp);
      ship = makeShip();
      ship.position.set(sPos.x + 0.5, sPos.y + 1.02, sPos.z + 0.5);
      shipBaseY = ship.position.y;
      var yawJitter = 0;
      if (Voxel.SeedUtil && Voxel.SeedUtil.derive32)
        yawJitter = ((Voxel.SeedUtil.derive32(world.seed, 0x5a17) % 2001) / 2000 - 0.5) * 0.28;
      // 机鼻朝出生点，默认yaw=0能看到座舱三分之四正面。
      ship.rotation.y = Math.PI + yawJitter;
      group.add(ship);
    } else {
      stationHub = makeStationHub();
      stationHub.position.set(128.5, 24, 112.5);
      group.add(stationHub);
      stationDock = makeStationDock();
      stationDock.position.set(128.5, 24, 128.5);
      group.add(stationDock);
      // 与可见屏幕中心一致；扫描/测试不再依赖旧的出生点硬编码。
      stationTerminal = new THREE.Vector3(128.5, 27.7, 114.22);
    }
    rampChangedAt = visualTime();
    applyVisualState(rampChangedAt);
    portalCooldown = 2.5;
    syncHud();
    syncScan(true);
  }

  function syncHud() {
    if (!world || !galaxy) return;
    var wt = worldText(world);
    var st = shipText(galaxy);
    setText(worldEl, wt.icon + ' ' + wt.name + ' · ' + wt.typeName);
    setText(coordEl, '坐标 ' + signed(world.x, 0) + ' / ' + signed(world.y, 0));
    if (fuelEl) {
      setText(fuelEl, '跃迁 ' + st.percent + '%');
      var fuelCss = st.percent + '%';
      if (fuelEl.style.getPropertyValue('--fuel') !== fuelCss)
        fuelEl.style.setProperty('--fuel', fuelCss);
    }
  }

  function init(s) {
    if (scene && scene !== s && group) clear();
    scene = s;
    try {
      reducedMotion = typeof window !== 'undefined' && window.matchMedia
        ? !!window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    } catch (e) { reducedMotion = false; }
    fuelEl = document.getElementById('warp-fuel');
    worldEl = document.getElementById('world-name');
    coordEl = document.getElementById('world-coord');
    mapGrid = document.getElementById('starmap-grid');
    bindScanDom();
    if (world && galaxy) { syncHud(); syncScan(true); }
    else { setHudOffline(); setScanOffline(); }
  }

  function update(dt, renderDt) {
    syncScan(false);
    if (!world || !galaxy || !group || !Voxel.Player) return;
    if (typeof dt !== 'number' || !isFinite(dt) || dt < 0) dt = 0;
    if (typeof renderDt !== 'number' || !isFinite(renderDt) || renderDt < 0) renderDt = dt;
    portalCooldown = Math.max(0, portalCooldown - dt);
    var p = Voxel.Player.pos();
    var now = visualTime();
    if (ship) {
      var il = ship.userData.interactionLocal || [0, 1, 0];
      _interactionPoint.set(il[0], il[1], il[2]);
      ship.localToWorld(_interactionPoint);
      nearShip = _interactionPoint.distanceTo(p) < 7.5;
      ship.position.y = shipBaseY; // 起落架稳定接地；动效集中在引擎和舱门。
    } else nearShip = world.kind === 'station';
    setRampTarget(nearShip, now);
    applyVisualState(now);
    for (var i = 0; i < portals.length; i++) {
      var o = portals[i];
      if (portalCooldown <= 0) {
        var dx = p.x - o.position.x, dy = p.y - (o.position.y + 2), dz = p.z - o.position.z;
        if (dx * dx + dz * dz < 1.35 && Math.abs(dy) < 2.2) {
          portalCooldown = 5;
          if (Voxel.Game && Voxel.Game.requestTravel)
            Voxel.Game.requestTravel(o.userData.portal.destinationId, 'portal');
          break;
        }
      }
    }
    syncHud();
  }

  function actionHint() {
    if (!world) return '';
    if (world.kind === 'station') return '航行终端：' + (Voxel.Controls.touchMode() ? '点右上角「星图」' : '按 H 打开星图');
    if (nearShip) return '飞船已就绪：' + (Voxel.Controls.touchMode() ? '点右上角「星图」' : '按 E 登舰 / H 打开星图');
    return '';
  }

  function canOpenMap() { return !!world && (world.kind === 'station' || nearShip); }

  function scanLandmark() {
    if (!world || !Voxel.Player || !Voxel.Player.pos) return null;
    var p = Voxel.Player.pos();
    var best = null;
    function consider(kind, id, x, y, z, limit) {
      var dx = p.x - x, dy = p.y - y, dz = p.z - z;
      var distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance <= limit && (!best || distance < best.distance))
        best = { kind: kind, id: id, distance: distance };
    }
    if (world.kind === 'station' && stationTerminal)
      consider('station-terminal', 'station-terminal', stationTerminal.x, stationTerminal.y, stationTerminal.z, 20);
    if (ship) {
      var il = ship.userData.interactionLocal || [0, 1.5, 0];
      _interactionPoint.set(il[0], il[1], il[2]);
      ship.localToWorld(_interactionPoint);
      consider('ship', 'ship', _interactionPoint.x, _interactionPoint.y, _interactionPoint.z, 8);
    }
    for (var i = 0; i < portals.length; i++) {
      var portal = portals[i];
      consider('portal', portal.userData && portal.userData.portal ? portal.userData.portal.id : ('portal-' + i),
        portal.position.x, portal.position.y + 2, portal.position.z, 6);
    }
    return best;
  }

  function galaxyDistance(dest) {
    try { return Math.round(finite(Voxel.Galaxy.distance(world, dest), 0, 0, 999999)); }
    catch (e) { return 0; }
  }

  function galaxyFuelCost(dest) {
    try { return Math.round(finite(Voxel.Galaxy.fuelCost(world, dest), 0, 0, 100)); }
    catch (e) { return 0; }
  }

  function setSelectedDestination(destinationId) {
    var dest = destinationId === null || destinationId === undefined || !galaxy
      ? null : Voxel.Galaxy.find(galaxy, destinationId);
    if (!dest || !world || dest.id === world.id) dest = null;
    selectedDestinationId = dest ? dest.id : null;
    if (mapGrid) {
      var cards = mapGrid.querySelectorAll('.star-card');
      for (var i = 0; i < cards.length; i++) {
        var selected = dest && cards[i].getAttribute('data-destination-id') === String(dest.id);
        cards[i].classList.toggle('selected', !!selected);
        cards[i].setAttribute('aria-pressed', selected ? 'true' : 'false');
      }
    }
    var cockpit = typeof document !== 'undefined' ? document.getElementById('starmap-cockpit') : null;
    var selection = typeof document !== 'undefined' ? document.getElementById('cockpit-selection') : null;
    var ignite = typeof document !== 'undefined' ? document.getElementById('btn-travel-ignite') : null;
    var insufficient = false;
    if (dest) {
      var cost = galaxyFuelCost(dest), st = shipText(galaxy);
      insufficient = st.fuel < cost;
      setText(selection, (insufficient ? '能量不足：' : '航线已锁定：') + worldText(dest).name +
        ' · 距离 ' + galaxyDistance(dest) + ' LY · 能量 ' + cost + '%');
    } else setText(selection, '请选择目的地以锁定跃迁航线');
    if (cockpit) cockpit.setAttribute('data-state', dest ? (insufficient ? 'insufficient' : 'locked') : 'idle');
    if (ignite) {
      ignite.disabled = !dest || insufficient;
      ignite.setAttribute('aria-disabled', ignite.disabled ? 'true' : 'false');
    }
    return !!dest && !insufficient;
  }

  function showMap() {
    if (!mapGrid || !galaxy || !world) return;
    mapGrid.innerHTML = '';
    var list = Array.isArray(galaxy.catalog) ? galaxy.catalog.filter(function (d) {
      return d && typeof d === 'object';
    }).slice() : [];
    list.sort(function (a, b) { return galaxyDistance(a) - galaxyDistance(b); });
    for (var i = 0; i < list.length; i++) {
      (function (dest) {
        var current = dest.id === world.id;
        var distance = galaxyDistance(dest);
        var cost = current ? 0 : galaxyFuelCost(dest);
        var known = !!(galaxy.discovered && galaxy.discovered[dest.id]);
        var discovery = Voxel.Discovery && Voxel.Discovery.worldSummary
          ? Voxel.Discovery.worldSummary(galaxy.discovery, dest.id) : null;
        var surveyed = !!(discovery && discovery.surveyed);
        var wt = worldText(dest);
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'star-card' + (current ? ' current' : '') + (known ? ' discovered' : '') +
          (surveyed ? ' surveyed' : '');
        card.disabled = current;
        card.setAttribute('data-destination-id', String(dest.id));
        card.setAttribute('aria-pressed', 'false');
        card.style.setProperty('--accent', safeAccent(dest.accent));
        var icon = document.createElement('span');
        icon.className = 'star-icon';
        icon.textContent = wt.icon;
        var main = document.createElement('span');
        main.className = 'star-main';
        var name = document.createElement('b');
        name.textContent = wt.name;
        var detail = document.createElement('small');
        detail.textContent = wt.typeName + ' · ' + safeText(dest.desc, '暂无环境档案', 80);
        main.appendChild(name); main.appendChild(detail);
        var meta = document.createElement('span');
        meta.className = 'star-meta';
        meta.appendChild(document.createTextNode(current ? '当前位置' : (known ? '已抵达' : '未抵达')));
        if (surveyed) {
          meta.appendChild(document.createElement('br'));
          meta.appendChild(document.createTextNode('已测绘 · 群系 ' + discovery.counts.biomes +
            ' · 资源 ' + discovery.counts.resources + ' · 生命 ' + discovery.counts.fauna));
        } else if (known) {
          meta.appendChild(document.createElement('br'));
          meta.appendChild(document.createTextNode('尚未主动测绘'));
        }
        if (!current) {
          meta.appendChild(document.createElement('br'));
          meta.appendChild(document.createTextNode('距离 ' + distance + ' LY · 能量 ' + cost + '%'));
        }
        card.appendChild(icon); card.appendChild(main); card.appendChild(meta);
        card.addEventListener('click', function () {
          if (Voxel.Game && Voxel.Game.selectTravelDestination &&
            (typeof dest.id === 'string' || typeof dest.id === 'number'))
            Voxel.Game.selectTravelDestination(dest.id);
          else setSelectedDestination(dest.id);
        });
        mapGrid.appendChild(card);
      })(list[i]);
    }
    var title = document.getElementById('starmap-status');
    var st = shipText(galaxy);
    setText(title, st.engine + ' · 能量 ' + st.fuel + '/' + st.maxFuel);
    setSelectedDestination(null);
  }

  var FLIGHT_PHASES = {
    ignition: ['IGNITION // 01', '跃迁核心点火'],
    warp: ['FTL TUNNEL // 02', '超光速通道稳定'],
    target_loading: ['TARGET SYNC // 03', '正在构建目标世界'],
    target_ready: ['TARGET READY // 04', '目标世界就绪'],
    committing: ['NAV COMMIT // 05', '正在提交航行存档'],
    committed: ['NAV VERIFIED // 06', '航行存档已验证'],
    arrival: ['ARRIVAL // 07', '接近目标天体'],
    cockpit_arrived: ['DOCKED // 08', '驾驶舱已完成对接'],
    complete: ['COMPLETE // 09', '航行完成'],
    aborted: ['ABORTED // XX', '跃迁已中止']
  };

  function setFlightPhase(phase, progress, tx) {
    if (!Object.prototype.hasOwnProperty.call(FLIGHT_PHASES, phase)) phase = 'ignition';
    progress = Math.round(finite(progress, 0, 0, 100));
    var ui = FLIGHT_PHASES[phase];
    var el = document.getElementById('overlay-warp');
    if (tx && tx.mode) flightMode = tx.mode === 'portal' ? 'portal' : 'ship';
    if (el) {
      el.setAttribute('data-mode', flightMode);
      el.setAttribute('data-phase', phase);
      el.style.setProperty('--warp-progress', progress + '%');
    }
    setText(document.getElementById('warp-phase-code'), ui[0]);
    setText(document.getElementById('warp-phase-label'), ui[1]);
    var bar = document.getElementById('warp-progress');
    if (bar) {
      bar.setAttribute('aria-valuenow', String(progress));
      bar.setAttribute('aria-valuetext', ui[1]);
    }
    setText(document.getElementById('warp-eta'), progress >= 100 ? 'ARRIVAL LOCKED' :
      'ETA 00:' + String(Math.max(0, Math.ceil((100 - progress) * 0.017))).padStart(2, '0'));
    var skip = document.getElementById('btn-warp-skip');
    if (skip) {
      var skippable = (phase === 'ignition' || phase === 'warp') && !flightSkipping;
      skip.disabled = !skippable;
      skip.setAttribute('aria-disabled', skippable ? 'false' : 'true');
    }
    return { phase: phase, progress: progress, label: ui[1] };
  }

  function setFlightSkipping(value) {
    flightSkipping = !!value;
    var el = document.getElementById('overlay-warp');
    if (el) el.classList.toggle('skipping', flightSkipping);
    var button = document.getElementById('btn-warp-skip');
    if (button) {
      button.disabled = flightSkipping;
      button.setAttribute('aria-disabled', flightSkipping ? 'true' : 'false');
      setText(button, flightSkipping ? '正在跳过…' : '跳过演出');
    }
    return flightSkipping;
  }

  function setDisembarkReady(value) {
    var button = document.getElementById('btn-disembark');
    var ready = !!value && flightMode === 'ship';
    if (button) {
      button.hidden = !ready;
      button.disabled = !ready;
      button.setAttribute('aria-disabled', ready ? 'false' : 'true');
    }
    return ready;
  }

  function announceTravel(message) {
    var el = document.getElementById('travel-announcer');
    var value = safeText(message, '航行状态已更新', 160);
    if (!el) return false;
    // 相同通知也需重新进入live region；同步清空避免积累定时器。
    if (el.textContent === value) el.textContent = '';
    el.textContent = value;
    return true;
  }

  function showWarp(from, to, mode, tx) {
    flightMode = mode === 'portal' ? 'portal' : 'ship';
    setFlightSkipping(false);
    setDisembarkReady(false);
    var fromText = worldText(from), toText = worldText(to);
    setText(document.getElementById('warp-title'), flightMode === 'portal' ? '传送门同步中' : '跃迁序列启动');
    setText(document.getElementById('warp-origin'), fromText.name);
    setText(document.getElementById('warp-destination'), toText.name);
    setText(document.getElementById('warp-sub'), fromText.name + '  →  ' + toText.name);
    var el = document.getElementById('overlay-warp');
    if (el) {
      el.setAttribute('data-mode', flightMode);
      el.classList.remove('hidden');
    }
    setFlightPhase('ignition', 0, tx || { mode: flightMode });
    return true;
  }

  function hideWarp() {
    var el = document.getElementById('overlay-warp');
    var visible = !!(el && !el.classList.contains('hidden'));
    if (el) {
      el.classList.add('hidden');
      el.classList.remove('skipping');
    }
    setDisembarkReady(false);
    setFlightSkipping(false);
    return visible;
  }

  function showArrival(from, to, mode, options) {
    options = options || {};
    if (arrivalTimer) { clearTimeout(arrivalTimer); arrivalTimer = null; }
    var card = document.getElementById('arrival-card');
    var terminal = document.getElementById('scan-terminal');
    var passive = document.getElementById('scan-passive');
    if (!card || !terminal) return false;
    var wt = worldText(to);
    var isTravelArrival = (mode === 'ship' || mode === 'portal') && !options.presentationOnly;
    if (isTravelArrival) {
      flightMode = mode;
      var warp = document.getElementById('overlay-warp');
      if (warp) {
        warp.setAttribute('data-mode', flightMode);
        warp.classList.remove('hidden');
      }
    }
    card.setAttribute('data-mode', mode === 'portal' ? 'portal' : 'ship');
    setText(document.getElementById('arrival-world'), wt.icon + ' ' + wt.name);
    setText(document.getElementById('arrival-type'), wt.typeName);
    var details = [];
    if (options.firstVisit) details.push('首次抵达');
    else if (mode === 'resume') details.push('航行记录已恢复');
    else details.push('导航链路已重连');
    if (options.refueled) details.push('跃迁能量已补满');
    else details.push('启动主动扫描以建立档案');
    setText(document.getElementById('arrival-detail'), details.join(' · '));
    terminal.setAttribute('data-view', 'arrival');
    terminal.setAttribute('aria-labelledby', 'arrival-world');
    if (passive) passive.setAttribute('aria-hidden', 'true');
    card.classList.remove('hidden');
    if (!options.silent) announceTravel('已抵达 ' + wt.name + '，' + wt.typeName + '。');
    return true;
  }

  function hideArrival() {
    if (arrivalTimer) { clearTimeout(arrivalTimer); arrivalTimer = null; }
    var card = typeof document !== 'undefined' ? document.getElementById('arrival-card') : null;
    var terminal = typeof document !== 'undefined' ? document.getElementById('scan-terminal') : null;
    var passive = typeof document !== 'undefined' ? document.getElementById('scan-passive') : null;
    var visible = !!(card && !card.classList.contains('hidden'));
    if (card) card.classList.add('hidden');
    if (terminal) {
      terminal.setAttribute('data-view', 'passive');
      terminal.setAttribute('aria-labelledby', 'scan-terminal-title');
    }
    if (passive) passive.setAttribute('aria-hidden', 'false');
    return visible;
  }

  function showArrivalCard(from, to, mode, options) {
    var shown = showArrival(from, to, mode, options);
    if (shown) arrivalTimer = setTimeout(function () { hideArrival(); }, reducedMotion ? 2200 : 4200);
    return shown;
  }

  function round4(value) { return Math.round(finite(value, 0) * 10000) / 10000; }

  function boundsFor(object) {
    if (!object || !THREE.Box3) return null;
    var box3 = new THREE.Box3().setFromObject(object);
    function vec(v) { return [round4(v.x), round4(v.y), round4(v.z)]; }
    return { min: vec(box3.min), max: vec(box3.max), size: vec(box3.getSize(new THREE.Vector3())) };
  }

  function visualSnapshot() {
    var roles = [], byRole = {}, geometries = [], materials = [], textures = [];
    var nodes = 0, drawables = 0, vertices = 0, triangles = 0;
    if (group) group.traverse(function (obj) {
      nodes++;
      if (!obj.geometry || !obj.material) return;
      drawables++;
      var role = safeText(obj.userData && obj.userData.role, 'unclassified', 48);
      roles.push(role);
      byRole[role] = (byRole[role] || 0) + 1;
      if (geometries.indexOf(obj.geometry) < 0) geometries.push(obj.geometry);
      var attr = obj.geometry.attributes && obj.geometry.attributes.position;
      if (attr) vertices += finite(attr.count, 0, 0, 1e7);
      if (obj.geometry.index) triangles += finite(obj.geometry.index.count, 0, 0, 3e7) / 3;
      else if (attr) triangles += finite(attr.count, 0, 0, 3e7) / 3;
      var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (var m = 0; m < mats.length; m++) {
        var mat = mats[m];
        if (!mat) continue;
        if (materials.indexOf(mat) < 0) materials.push(mat);
        if (mat.map && textures.indexOf(mat.map) < 0) textures.push(mat.map);
      }
    });
    var engineOpacity = shipParts.engines.length && shipParts.engines[0].material
      ? round4(shipParts.engines[0].material.opacity) : null;
    return {
      generation: generation,
      worldId: world ? world.id : null,
      kind: world ? safeWorldKind(world) : null,
      rootCount: group ? 1 : 0,
      roles: roles,
      counts: {
        nodes: nodes,
        drawables: drawables,
        geometries: geometries.length,
        materials: materials.length,
        textures: textures.length,
        vertices: Math.round(vertices),
        triangles: Math.round(triangles),
        portals: portals.length,
        byRole: byRole
      },
      ship: ship ? {
        position: [round4(ship.position.x), round4(ship.position.y), round4(ship.position.z)],
        rotationY: round4(ship.rotation.y),
        bounds: boundsFor(ship)
      } : null,
      station: stationHub ? {
        hubBounds: boundsFor(stationHub),
        dockBounds: boundsFor(stationDock),
        terminal: stationTerminal ? [round4(stationTerminal.x), round4(stationTerminal.y), round4(stationTerminal.z)] : null
      } : null,
      animation: {
        reducedMotion: reducedMotion,
        engineOpacity: engineOpacity,
        rampProgress: round4(rampProgress),
        ringRotations: animatedRings.map(function (item) { return round4(item.mesh.rotation.z); })
      }
    };
  }

  function statsGroup(values) {
    var total = values.roots + values.geometries + values.materials + values.textures;
    return {
      roots: values.roots, geometries: values.geometries, materials: values.materials,
      textures: values.textures, total: total
    };
  }

  function resourceStats() {
    var live = {
      roots: created.roots - disposed.roots,
      geometries: created.geometries - disposed.geometries,
      materials: created.materials - disposed.materials,
      textures: created.textures - disposed.textures
    };
    return { created: statsGroup(created), disposed: statsGroup(disposed), live: statsGroup(live) };
  }

  function setReducedMotion(value) {
    value = !!value;
    if (value === reducedMotion) return false;
    reducedMotion = value;
    applyVisualState(visualTime());
    return true;
  }

  function setVisualTime(value) {
    if (value === null || value === undefined) visualTimeOverride = null;
    else visualTimeOverride = finite(value, 0, 0, 1e9);
    applyVisualState(visualTime());
    return visualTimeOverride;
  }

  return {
    init: init,
    clear: clear,
    loadWorld: loadWorld,
    update: update,
    setScanTarget: setScanTarget,
    actionHint: actionHint,
    canOpenMap: canOpenMap,
    scanLandmark: scanLandmark,
    showMap: showMap,
    setSelectedDestination: setSelectedDestination,
    showWarp: showWarp,
    hideWarp: hideWarp,
    setFlightPhase: setFlightPhase,
    setFlightSkipping: setFlightSkipping,
    setDisembarkReady: setDisembarkReady,
    announceTravel: announceTravel,
    showArrival: showArrival,
    hideArrival: hideArrival,
    showArrivalCard: showArrivalCard,
    visualSnapshot: visualSnapshot,
    resourceStats: resourceStats,
    setReducedMotion: setReducedMotion,
    setVisualTime: setVisualTime,
    currentWorld: function () { return world; },
    environment: function () { return world ? { top: world.skyTop, horizon: world.horizon } : null; },
    portals: function () { return portals; },
    ship: function () { return ship; }
  };
})();
