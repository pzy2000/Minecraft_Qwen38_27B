// 星际旅行表现层：像素飞船、种子门户、星图和跃迁 HUD。
window.Voxel = window.Voxel || {};

Voxel.SpaceTravel = (function () {
  var scene = null, group = null, ship = null, portals = [];
  var galaxy = null, world = null, nearShip = false, nearPortal = null, portalCooldown = 0;
  var fuelEl = null, worldEl = null, coordEl = null, mapGrid = null, mapButton = null;
  var scanEl = null, scanWorldEl = null, scanPositionEl = null, scanBiomeEl = null;
  var scanEnvironmentEl = null, scanTargetEl = null, scanDistanceEl = null;
  var scanTarget = { kind: 'none', label: '无锁定目标', distance: null };
  var scanLastSampleAt = -Infinity, scanLastSignature = '', scanUrgent = false;
  var scanOnline = false;
  var shipBaseY = 0;
  var shipParts = { engines: [], door: null, ramp: null };
  var stationHub = null, stationDock = null, stationTerminal = null;
  var reservedBounds = [], resolvedPortalSites = [];
  var portalArmed = false, portalInside = false;
  var activePortalProof = null;
  var animatedRings = [];
  var reducedMotion = false, visualTimeOverride = null;
  var rampTarget = 0, rampFrom = 0, rampChangedAt = 0, rampProgress = 0;
  var selectedDestinationId = null, flightMode = 'ship', flightSkipping = false;
  var aboardShip = false, boardedWorldId = null, cockpitSignature = '', shieldImpactUntil = 0;
  var cockpitLastSyncAt = -Infinity;
  var flightState = null, flightEvents = [], lastSafeExit = null, lastLandingPose = null;
  var flightRestoreValid = true;
  var arrivalTimer = null;
  var generation = 0;
  var owned = { geometries: [], materials: [], textures: [] };
  var created = { roots: 0, geometries: 0, materials: 0, textures: 0 };
  var disposed = { roots: 0, geometries: 0, materials: 0, textures: 0 };
  var SCAN_INTERVAL_MS = 125; // 约 8Hz；目标种类/名称改变时允许立即刷新。
  var PORTAL_ENTER_R2 = 1.35, PORTAL_ENTER_Y = 2.2;
  var PORTAL_EXIT_R2 = 1.8 * 1.8, PORTAL_EXIT_Y = 2.7;
  var PORTAL_MIN_DISTANCE = 8;
  var FUNCTIONAL_BLOCKS = { 15: true, 17: true, 37: true, 38: true };
  var ORGANIC_BLOCKS = { 4: true, 5: true, 20: true, 21: true, 22: true, 23: true,
    24: true, 26: true, 33: true, 34: true, 35: true, 36: true };
  var STATION_PADS = [
    [104, 128], [152, 128], [108, 144], [148, 144], [116, 152], [140, 152]
  ];
  var STATION_SITE_OFFSETS = [
    [0, 0], [4, 0], [-4, 0], [0, 4], [0, -4],
    [4, 4], [-4, 4], [4, -4], [-4, -4],
    [8, 0], [-8, 0], [0, 8], [0, -8]
  ];
  var _interactionPoint = new THREE.Vector3();
  var _cockpitPoint = new THREE.Vector3();
  var _flightCandidate = new THREE.Object3D();
  var _flightBox = new THREE.Box3();
  var _flightCorner = new THREE.Vector3();
  var SHIP_LOCAL_MIN = [-5.8, 0, -6.2];
  var SHIP_LOCAL_MAX = [5.8, 3.15, 5.05];
  var COCKPIT_LOCAL = [0, 2.53, -1.45];
  var EXIT_LOCAL = [3.25, 0.8, 0.5];
  var GEAR_LOCAL = [[-1.55, 0, -2.15], [1.55, 0, -2.15], [-1.55, 0, 2.15], [1.55, 0, 2.15]];

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
    if (mapButton) {
      setText(mapButton, '星图');
      setAttr(mapButton, 'aria-label', '打开星图');
    }
  }

  function isAboard() {
    return !!(aboardShip && ship && world && world.kind === 'planet' && boardedWorldId === world.id);
  }

  function canBoardShip() {
    return !!(world && world.kind === 'planet' && ship && nearShip && !aboardShip);
  }

  function syncMapButton() {
    if (!mapButton) return;
    var boardingAvailable = canBoardShip();
    setText(mapButton, boardingAvailable ? '登舰' : '星图');
    setAttr(mapButton, 'aria-label', boardingAvailable
      ? '进入飞船避难并打开座舱导航' : '打开星图');
    setAttr(mapButton, 'data-action', boardingAvailable ? 'board' : 'starmap');
  }

  function cockpitModel() {
    var sealed = isAboard();
    var status = null;
    try { status = Voxel.Environment && Voxel.Environment.status ? Voxel.Environment.status() : null; }
    catch (e) { status = null; }
    status = status && typeof status === 'object' ? status : {};
    var exposure = finite(status.exposure, 0, 0, 100);
    var percent = Math.round(exposure);
    var hazard = safeText(status.label, '环境危害', 32);
    var hasHazard = status.hazard && status.hazard !== 'none';
    var purging = sealed && hasHazard && exposure > 0;
    var st = shipText(galaxy);
    var weather = safeText(Voxel.Weather && Voxel.Weather.label ? Voxel.Weather.label() : '', '晴', 20);
    var phase = Voxel.DayNight && Voxel.DayNight.isNight && Voxel.DayNight.isNight() ? '夜间' : '日间';
    var impact = sealed && visualTime() < shieldImpactUntil;
    var flight = flightStatus();
    var snap = flight && flight.snapshot;
    var wt = worldText(world);
    return {
      sealed: sealed,
      purging: purging,
      impact: impact,
      exposure: exposure,
      percent: percent,
      hazardKey: hasHazard ? safeText(status.hazard, 'hazard', 18) : 'none',
      shelter: impact ? '电磁冲击已导流' : (purging ? '密封完成 · 净化循环' : '密封完成 · 舱内安全'),
      detail: hasHazard
        ? (purging ? hazard + '已隔绝 · 残留暴露正降至 0%' : hazard + '已隔绝 · 有害暴露 0%')
        : '外界环境稳定 · 生命维持系统在线',
      atmosphere: sealed ? 'O₂ 98% · 1.00 ATM' : '外部链路',
      hull: impact ? '导流中' : '100%',
      engine: '跃迁 ' + st.fuel + '/' + st.maxFuel,
      exterior: phase + ' · ' + weather,
      world: wt.icon + ' ' + wt.name,
      position: snap ? 'X ' + signed(snap.position[0], 1) + ' · Y ' + signed(snap.position[1], 1) +
        ' · Z ' + signed(snap.position[2], 1) : '坐标不可用',
      speed: flight ? Math.round(flight.speed * 10) / 10 : 0,
      altitude: flight ? Math.round(flight.altitude * 10) / 10 : 0,
      throttle: snap ? Math.round(snap.throttle * 100) : 0,
      roll: snap ? snap.roll : 0,
      landed: !!(flight && flight.landed),
      canDisembark: !!(flight && flight.canDisembark),
      flightMode: flight && flight.landed ? 'LANDED' : (flight && flight.collided ? 'ASSIST // COLLISION' : 'ATMOSPHERIC FLIGHT')
    };
  }

  function syncCockpitRadar(model) {
    if (typeof document === 'undefined' || !ship) return;
    for (var i = 0; i < 4; i++) {
      var marker = document.getElementById('cockpit-radar-marker-' + i);
      var portal = portals[i];
      if (!marker) continue;
      if (!portal) { marker.style.display = 'none'; continue; }
      var dx = portal.position.x - ship.position.x, dz = portal.position.z - ship.position.z;
      var c = Math.cos(-ship.rotation.y), s = Math.sin(-ship.rotation.y);
      var lx = dx * c - dz * s, lz = dx * s + dz * c;
      var scale = Math.max(1, Math.sqrt(lx * lx + lz * lz) / 28);
      lx /= scale; lz /= scale;
      marker.style.display = 'block';
      marker.style.left = (50 + Math.max(-42, Math.min(42, lx / 28 * 42))) + '%';
      marker.style.top = (50 + Math.max(-42, Math.min(42, lz / 28 * 42))) + '%';
    }
    var radar = document.querySelector('#cockpit-hud .cockpit-radar');
    if (radar) radar.style.setProperty('--radar-heading', (-model.roll * 180 / Math.PI) + 'deg');
  }

  function syncCockpit(force) {
    if (typeof document === 'undefined') return null;
    var model = cockpitModel();
    var overlay = document.getElementById('overlay-starmap');
    var systems = document.getElementById('cockpit-hud');
    var close = document.getElementById('btn-starmap-close');
    var exit = document.getElementById('btn-cockpit-exit');
    if (systems) {
      systems.style.setProperty('--cockpit-throttle', Math.max(0, model.throttle) + '%');
      systems.style.setProperty('--cockpit-reverse', Math.max(0, -model.throttle) + '%');
      systems.style.setProperty('--cockpit-roll', (model.roll * 180 / Math.PI) + 'deg');
    }
    var syncNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (!force && syncNow - cockpitLastSyncAt < SCAN_INTERVAL_MS) return model;
    cockpitLastSyncAt = syncNow;
    var signature = [model.sealed ? 1 : 0, model.purging ? 1 : 0, model.impact ? 1 : 0,
      model.percent, model.hazardKey, model.shelter, model.detail, model.atmosphere,
      model.hull, model.engine, model.exterior, model.world, model.position, model.speed,
      model.altitude, model.throttle, Math.round(model.roll * 1000), model.landed ? 1 : 0,
      model.canDisembark ? 1 : 0, model.flightMode].join('|');
    if (!force && signature === cockpitSignature) return model;
    cockpitSignature = signature;
    if (overlay) {
      setAttr(overlay, 'data-mode', model.sealed ? 'cockpit-link' : 'remote');
    }
    if (document.body) document.body.setAttribute('data-ship-boarded', model.sealed ? 'true' : 'false');
    if (systems) {
      setAttr(systems, 'aria-hidden', model.sealed ? 'false' : 'true');
      setAttr(systems, 'data-state', model.impact ? 'impact' : (model.purging ? 'purging' : 'safe'));
      setAttr(systems, 'data-landed', model.landed ? 'true' : 'false');
      setAttr(systems, 'data-impact', model.impact ? 'true' : 'false');
      systems.style.setProperty('--cockpit-hazard', model.percent + '%');
    }
    if (close) {
      setAttr(close, 'aria-label', model.sealed ? '离开飞船' : '关闭星图');
      setAttr(close, 'title', model.sealed ? '离开飞船' : '关闭星图');
    }
    setText(document.getElementById('starmap-title'), '星系航行图');
    var kicker = document.querySelector('#overlay-starmap .starmap-kicker');
    setText(kicker, model.sealed ? 'COCKPIT LINK // ROUTE SELECT' : 'ARK NAVIGATION // ROUTE SELECT');
    if (exit) {
      exit.disabled = !model.canDisembark;
      setAttr(exit, 'aria-disabled', model.canDisembark ? 'false' : 'true');
    }
    setText(document.getElementById('cockpit-shelter-state'), model.shelter);
    setText(document.getElementById('cockpit-shelter-detail'), model.detail);
    setText(document.getElementById('cockpit-hazard-value'), model.percent + '%');
    setText(document.getElementById('cockpit-atmosphere-value'), model.atmosphere);
    setText(document.getElementById('cockpit-hull-value'), model.hull);
    setText(document.getElementById('cockpit-engine-value'), model.engine);
    setText(document.getElementById('cockpit-weather-value'), model.exterior);
    setText(document.getElementById('cockpit-world-value'), model.world);
    setText(document.getElementById('cockpit-position-value'), model.position);
    var speedNumber = document.querySelector('#cockpit-speed > b');
    setText(speedNumber, model.speed.toFixed(1).replace(/\.0$/, ''));
    setText(document.getElementById('cockpit-throttle'), model.throttle + '%');
    setText(document.getElementById('cockpit-altitude'), model.altitude.toFixed(1).replace(/\.0$/, '') + ' m');
    setText(document.getElementById('cockpit-flight-mode'), model.flightMode);
    setText(document.getElementById('cockpit-exit-status'), model.canDisembark
      ? '安全离舰就绪' : (model.landed ? '舱门外无安全站立点' : '需先安全着陆'));
    var throttleMeter = document.querySelector('.cockpit-throttle-track');
    if (throttleMeter) setAttr(throttleMeter, 'aria-valuenow', String(model.throttle));
    var meter = document.getElementById('cockpit-hazard-meter');
    if (meter) {
      setAttr(meter, 'aria-valuenow', String(model.percent));
      setAttr(meter, 'aria-valuetext', model.percent === 0
        ? '有害环境残留已净化至 0%' : '有害环境残留 ' + model.percent + '%，正在净化');
    }
    syncCockpitRadar(model);
    return model;
  }

  function boardShip() {
    if (!canBoardShip() || !flightState) return false;
    aboardShip = true;
    boardedWorldId = world.id;
    shieldImpactUntil = 0;
    var boardingPos = Voxel.Player && Voxel.Player.pos ? Voxel.Player.pos() : null;
    lastSafeExit = boardingPos && boardingPos.clone ? boardingPos.clone() : null;
    setRampTarget(0, visualTime());
    syncMapButton();
    syncCockpit(true);
    announceTravel('已进入飞船密封舱；外界环境已隔绝，生命维持与净化循环启动。');
    return true;
  }

  function restoreBoarding() {
    if (!flightRestoreValid || !world || world.kind !== 'planet' || !ship || !flightState) return false;
    aboardShip = true;
    boardedWorldId = world.id;
    shieldImpactUntil = 0;
    setRampTarget(0, visualTime());
    applyVisualState(visualTime());
    syncMapButton();
    syncCockpit(true);
    return true;
  }

  function disembarkShip(options) {
    options = options || {};
    if (!aboardShip) { syncCockpit(true); return false; }
    aboardShip = false;
    boardedWorldId = null;
    shieldImpactUntil = 0;
    syncMapButton();
    syncCockpit(true);
    if (!options.silent)
      announceTravel('已离开飞船；外界环境防护由玩家当前位置重新判定。');
    return true;
  }

  function registerShieldImpact(kind) {
    if (!isAboard()) return false;
    shieldImpactUntil = visualTime() + (reducedMotion ? 0.7 : 1.25);
    syncCockpit(true);
    return kind === 'lightning' || !!kind;
  }

  function absorbsDamage(cause) {
    if (!isAboard()) return false;
    return ['lightning', 'zombie', 'heat', 'cold', 'toxic', 'ash', 'pressure'].indexOf(String(cause || '')) >= 0;
  }

  function updateCockpit(renderDt) {
    if (!isAboard()) return syncCockpit(false);
    if (typeof renderDt !== 'number' || !isFinite(renderDt) || renderDt < 0) renderDt = 0;
    return syncCockpit(false);
  }

  function shipFlightConfig() {
    var raw = Voxel.Config && Voxel.Config.SHIP_FLIGHT || {};
    return {
      maxForward: raw.MAX_FORWARD, maxReverse: raw.MAX_REVERSE,
      maxVertical: raw.MAX_VERTICAL, forwardAccel: raw.FORWARD_ACCEL,
      brakeDecel: raw.BRAKE_DECEL, throttleUp: raw.THROTTLE_UP,
      throttleDown: raw.THROTTLE_DOWN, yawRate: raw.YAW_RATE,
      pitchRate: raw.PITCH_RATE, pitchLimit: raw.PITCH_LIMIT,
      rollMax: raw.ROLL_MAX, rollResponse: raw.ROLL_RESPONSE,
      keyYawRate: raw.KEY_YAW_RATE
    };
  }

  function defaultFlightSnapshot() {
    var p = ship ? ship.position : { x: 0, y: 2, z: 0 };
    return {
      v: 1,
      position: [finite(p.x, 0), finite(p.y, 2, 0, 120), finite(p.z, 0)],
      velocity: [0, 0, 0],
      yaw: ship ? finite(ship.rotation.y, 0) : 0,
      pitch: 0, roll: 0, throttle: 0, landed: true
    };
  }

  function validSavedFlight(raw) {
    if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Array.isArray(raw.position) ||
      !Array.isArray(raw.velocity) || raw.position.length !== 3 || raw.velocity.length !== 3) return false;
    var values = raw.position.concat(raw.velocity, [raw.yaw, raw.pitch, raw.roll, raw.throttle]);
    return values.every(function (v) { return typeof v === 'number' && isFinite(v); }) &&
      Math.abs(raw.position[0]) <= 30000000 && raw.position[1] >= 0 && raw.position[1] <= 120 &&
      Math.abs(raw.position[2]) <= 30000000;
  }

  function applyFlightTransform() {
    if (!ship || !flightState) return false;
    ship.position.set(flightState.position[0], flightState.position[1], flightState.position[2]);
    ship.rotation.order = 'YXZ';
    ship.rotation.set(flightState.pitch, flightState.yaw, flightState.roll);
    ship.updateMatrixWorld(true);
    shipBaseY = ship.position.y;
    return true;
  }

  function flightBounds(position, attitude) {
    _flightCandidate.position.set(position[0], position[1], position[2]);
    _flightCandidate.rotation.order = 'YXZ';
    _flightCandidate.rotation.set(attitude.pitch || 0, attitude.yaw || 0, attitude.roll || 0);
    _flightCandidate.updateMatrixWorld(true);
    _flightBox.makeEmpty();
    for (var xi = 0; xi < 2; xi++) for (var yi = 0; yi < 2; yi++) for (var zi = 0; zi < 2; zi++) {
      _flightCorner.set(xi ? SHIP_LOCAL_MAX[0] : SHIP_LOCAL_MIN[0],
        yi ? SHIP_LOCAL_MAX[1] : SHIP_LOCAL_MIN[1],
        zi ? SHIP_LOCAL_MAX[2] : SHIP_LOCAL_MIN[2]);
      _flightCorner.applyMatrix4(_flightCandidate.matrixWorld);
      _flightBox.expandByPoint(_flightCorner);
    }
    return _flightBox;
  }

  function flightCollisionCount(position, attitude) {
    var box3 = flightBounds(position, attitude);
    var x0 = Math.floor(box3.min.x + 0.01), x1 = Math.floor(box3.max.x - 0.01);
    var y0 = Math.max(0, Math.floor(box3.min.y + 0.01));
    var y1 = Math.min((Voxel.Config && Voxel.Config.WORLD_H || 64) - 1, Math.floor(box3.max.y - 0.01));
    var z0 = Math.floor(box3.min.z + 0.01), z1 = Math.floor(box3.max.z - 0.01);
    var checked = 0, collisions = 0;
    for (var x = x0; x <= x1; x++) for (var z = z0; z <= z1; z++) for (var y = y0; y <= y1; y++) {
      if (++checked > 8192) return 8192;
      var id = Voxel.World.get(x, y, z);
      if (!Voxel.Blocks.isSolid(id)) continue;
      var top = y + (Voxel.Blocks.defs[id] && Voxel.Blocks.defs[id].half ? 0.5 : 1);
      if (box3.min.y < top - 0.01 && box3.max.y > y + 0.01) collisions++;
    }
    return collisions;
  }

  function flightBoxCollides(position, attitude) { return flightCollisionCount(position, attitude) > 0; }

  function landingSurface(position, attitude) {
    var ys = [], dry = true;
    _flightCandidate.position.set(position[0], position[1], position[2]);
    _flightCandidate.rotation.order = 'YXZ';
    _flightCandidate.rotation.set(0, attitude.yaw || 0, 0);
    _flightCandidate.updateMatrixWorld(true);
    for (var i = 0; i < GEAR_LOCAL.length; i++) {
      _flightCorner.set(GEAR_LOCAL[i][0], 0, GEAR_LOCAL[i][2]).applyMatrix4(_flightCandidate.matrixWorld);
      var gx = Math.floor(_flightCorner.x), gz = Math.floor(_flightCorner.z);
      var gy = Voxel.World.surfaceAt(gx, gz);
      var ground = Voxel.World.get(gx, gy, gz);
      if (!Voxel.Blocks.isSolid(ground) || ground === 7) dry = false;
      ys.push(gy);
    }
    var min = Math.min.apply(Math, ys), max = Math.max.apply(Math, ys);
    return { stable: dry && max - min <= 1, y: max + finite(Voxel.Config.SHIP_FLIGHT.SHIP_BASE_CLEARANCE, 1.02) };
  }

  function resolveFlightMove(from, proposed, velocity, attitude) {
    var cfg = Voxel.Config.SHIP_FLIGHT;
    var surface = Voxel.World.surfaceAt(Math.floor(proposed[0]), Math.floor(proposed[2]));
    var minY = surface + cfg.SHIP_BASE_CLEARANCE;
    var maxY = Math.min(cfg.MAX_ABSOLUTE_Y, minY + cfg.MAX_ALTITUDE);
    var floorContact = proposed[1] <= minY + 0.001 && velocity[1] < 0;
    proposed[1] = Math.max(minY, Math.min(maxY, proposed[1]));
    var dx = proposed[0] - from[0], dy = proposed[1] - from[1], dz = proposed[2] - from[2];
    var distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (attitude.landed && distance < 1e-7)
      return { position: from.slice(), velocity: [0, 0, 0], landed: true, collided: false };
    var steps = Math.max(1, Math.ceil(distance / cfg.SWEEP_STEP));
    var current = from.slice(), collided = false;
    var currentCollisions = flightCollisionCount(current, attitude);
    var stepX = dx / steps, stepY = dy / steps, stepZ = dz / steps;
    var takeoffAssist = stepY > 0 && from[1] - minY < 4;
    var returnLandingAssist = false;
    if (stepY < 0 && lastLandingPose) {
      var returnDx = from[0] - lastLandingPose[0], returnDz = from[2] - lastLandingPose[2];
      returnLandingAssist = returnDx * returnDx + returnDz * returnDz <= 4 && from[1] >= lastLandingPose[1];
    }
    for (var s = 0; s < steps; s++) {
      if (Math.abs(stepX) > 1e-9) {
        var nx = [current[0] + stepX, current[1], current[2]];
        var xCollisions = flightCollisionCount(nx, attitude);
        if (xCollisions === 0 || xCollisions < currentCollisions) {
          current[0] = nx[0]; currentCollisions = xCollisions;
        } else { velocity[0] = 0; collided = true; }
      }
      if (Math.abs(stepZ) > 1e-9) {
        var nz = [current[0], current[1], current[2] + stepZ];
        var zCollisions = flightCollisionCount(nz, attitude);
        if (zCollisions === 0 || zCollisions < currentCollisions) {
          current[2] = nz[2]; currentCollisions = zCollisions;
        } else { velocity[2] = 0; collided = true; }
      }
      if (Math.abs(stepY) > 1e-9) {
        var ny = [current[0], current[1] + stepY, current[2]];
        var yCollisions = flightCollisionCount(ny, attitude);
        if (takeoffAssist || returnLandingAssist || yCollisions === 0 || yCollisions < currentCollisions ||
          (stepY > 0 && yCollisions <= currentCollisions)) {
          current[1] = ny[1]; currentCollisions = yCollisions;
        } else { velocity[1] = 0; collided = true; }
      }
    }
    surface = Voxel.World.surfaceAt(Math.floor(current[0]), Math.floor(current[2]));
    minY = surface + cfg.SHIP_BASE_CLEARANCE;
    if (current[1] < minY) { current[1] = minY; velocity[1] = Math.max(0, velocity[1]); collided = true; }
    if (floorContact && current[1] <= minY + 0.03) velocity[1] = 0;
    var speed = Math.sqrt(velocity[0] * velocity[0] + velocity[1] * velocity[1] + velocity[2] * velocity[2]);
    var landing = landingSurface(current, attitude);
    if (!landing.stable && lastLandingPose) {
      var ldx = current[0] - lastLandingPose[0], ldz = current[2] - lastLandingPose[2];
      if (ldx * ldx + ldz * ldz <= 4) landing = { stable: true, y: lastLandingPose[1] };
    }
    var canLand = landing.stable && velocity[1] <= 0.05 && speed <= cfg.LAND_SPEED &&
      Math.abs(attitude.pitch || 0) <= 0.12 && Math.abs(attitude.roll || 0) <= 0.12 &&
      current[1] <= landing.y + 0.28;
    if (canLand) {
      current[1] = landing.y;
      velocity = [0, 0, 0];
    }
    return { position: current, velocity: velocity, landed: canLand, collided: collided };
  }

  function updateFlight(dt, input) {
    if (!isAboard() || !flightState || !Voxel.ShipFlight) return null;
    var previous = flightState;
    var result = Voxel.ShipFlight.step(flightState, dt, input, {
      config: shipFlightConfig(), resolve: resolveFlightMove
    });
    flightState = result.state;
    flightEvents = result.events.slice();
    if (flightEvents.indexOf('takeoff') >= 0) {
      lastSafeExit = null;
      lastLandingPose = [previous.position[0], previous.position[1], previous.position[2], previous.yaw];
    }
    if (flightEvents.indexOf('landed') >= 0)
      lastLandingPose = [flightState.position[0], flightState.position[1], flightState.position[2], flightState.yaw];
    applyFlightTransform();
    setRampTarget(0, visualTime());
    applyVisualState(visualTime());
    syncCockpit(false);
    return result;
  }

  function cockpitWorldPosition() {
    if (!ship || !flightState) return null;
    _cockpitPoint.set(COCKPIT_LOCAL[0], COCKPIT_LOCAL[1], COCKPIT_LOCAL[2]);
    ship.localToWorld(_cockpitPoint);
    return _cockpitPoint.clone();
  }

  function applyCockpitCamera(camera) {
    if (!camera || !isAboard() || !ship) return false;
    var point = cockpitWorldPosition();
    camera.position.copy(point);
    camera.quaternion.copy(ship.quaternion);
    camera.updateMatrixWorld(true);
    return true;
  }

  function safeExitPosition() {
    if (!flightState || !flightState.landed || !ship) return null;
    _interactionPoint.set(EXIT_LOCAL[0], EXIT_LOCAL[1], EXIT_LOCAL[2]);
    ship.localToWorld(_interactionPoint);
    var x = Math.floor(_interactionPoint.x), z = Math.floor(_interactionPoint.z);
    var y = Voxel.World.surfaceAt(x, z) + 1.001;
    if (Voxel.World.get(x, Math.floor(y) - 1, z) === 7) return null;
    var candidate = new THREE.Vector3(_interactionPoint.x, y, _interactionPoint.z);
    if (Voxel.Player && Voxel.Player.canStandAt && !Voxel.Player.canStandAt(candidate, true)) {
      if (lastSafeExit && lastSafeExit.distanceTo(ship.position) <= 10 && Voxel.Player.canStandAt(lastSafeExit, true))
        return lastSafeExit.clone();
      return null;
    }
    lastSafeExit = candidate.clone();
    return candidate;
  }

  function canDisembark() { return !!safeExitPosition(); }

  function flightSnapshot() {
    return flightState && Voxel.ShipFlight ? Voxel.ShipFlight.snapshot(flightState) : null;
  }

  function flightStatus() {
    var snap = flightSnapshot();
    if (!snap) return null;
    var speed = Math.sqrt(snap.velocity[0] * snap.velocity[0] + snap.velocity[1] * snap.velocity[1] + snap.velocity[2] * snap.velocity[2]);
    var surface = Voxel.World.surfaceAt(Math.floor(snap.position[0]), Math.floor(snap.position[2]));
    return {
      speed: speed, altitude: Math.max(0, snap.position[1] - surface - Voxel.Config.SHIP_FLIGHT.SHIP_BASE_CLEARANCE),
      throttle: snap.throttle, landed: snap.landed, collided: !!(flightState && flightState.collided),
      canDisembark: canDisembark(), events: flightEvents.slice(), snapshot: snap
    };
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
    kind = kind === 'block' || kind === 'mob' || kind === 'portal' ? kind : 'none';
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

  function worldHeight() {
    return Voxel.Config && isFinite(Voxel.Config.WORLD_H) ? Voxel.Config.WORLD_H : 64;
  }

  function waterLevel() {
    return Voxel.Config && isFinite(Voxel.Config.WATER_LEVEL) ? Voxel.Config.WATER_LEVEL : 23;
  }

  function editedAt(x, y, z) {
    try { return !!(Voxel.World.isEdited && Voxel.World.isEdited(x, y, z)); }
    catch (e) { return true; }
  }

  function metaAt(x, y, z) {
    try { return Voxel.World.getMeta ? Voxel.World.getMeta(x, y, z) : null; }
    catch (e) { return {}; }
  }

  function solidBlock(id) {
    if (Voxel.Blocks && Voxel.Blocks.isSolid) return !!Voxel.Blocks.isSolid(id);
    return id > 0 && id !== 7 && id !== 19;
  }

  // 精确门址只接受干燥实体地板和五格净空；附近已有玩家编辑、容器或功能块时
  // 宁可换候选，也不能把传送门覆盖到玩家建筑上。
  function dryPortalSite(x, z) {
    x = Math.round(x); z = Math.round(z);
    if (!isFinite(x) || !isFinite(z) || Math.abs(x) > 30000000 || Math.abs(z) > 30000000) return null;
    var y;
    try { y = Voxel.World.surfaceAt(x, z); } catch (e) { return null; }
    if (!isFinite(y) || Math.floor(y) !== y || y < 2 || y >= worldHeight() - 6) return null;
    var floor = Voxel.World.get(x, y, z);
    if (!solidBlock(floor) || floor === 7 || FUNCTIONAL_BLOCKS[floor] || ORGANIC_BLOCKS[floor] ||
      editedAt(x, y, z) || metaAt(x, y, z)) return null;
    for (var airY = y + 1; airY <= y + 5; airY++) if (Voxel.World.get(x, airY, z) !== 0) return null;
    return { x: x, y: y, z: z, platform: false };
  }

  function platformMarkerMatches(x, y, z) {
    var marker = metaAt(x, y, z);
    return !!marker && marker.type === 'portal-platform' && marker.v === 1 &&
      marker.networkVersion === (Voxel.Galaxy && Voxel.Galaxy.PORTAL_NETWORK_VERSION || 2) &&
      marker.worldId === (world && world.id);
  }

  function platformMatches(x, y, z) {
    if (!platformMarkerMatches(x, y, z)) return false;
    for (var dx = -3; dx <= 3; dx++) for (var dz = -3; dz <= 3; dz++) {
      if (Voxel.World.get(x + dx, y, z + dz) !== 3) return false;
      for (var ay = y + 1; ay <= y + 5; ay++) if (Voxel.World.get(x + dx, ay, z + dz) !== 0) return false;
    }
    return true;
  }

  function wetColumn(x, z) {
    var surface;
    try { surface = Voxel.World.surfaceAt(x, z); } catch (e) { return false; }
    var top = Math.min(waterLevel(), worldHeight() - 2);
    for (var y = Math.max(0, surface + 1); y <= top; y++) if (Voxel.World.get(x, y, z) === 7) return true;
    return false;
  }

  // 海洋世界的固定pad可能完全无干地。仅在未编辑的水/空气中铺7×7石质甲板，
  // 并清掉上方水体；完全匹配时直接复用，保证保存/重载幂等。
  function ensureOceanPlatform(x, z) {
    x = Math.round(x); z = Math.round(z);
    var y = Math.max(3, Math.min(worldHeight() - 6, waterLevel() + 1));
    if (platformMatches(x, y, z)) return { x: x, y: y, z: z, platform: true };
    if (!Voxel.World.set || !Voxel.World.setMeta || !wetColumn(x, z)) return null;
    for (var dx = -3; dx <= 3; dx++) for (var dz = -3; dz <= 3; dz++) {
      for (var yy = y; yy <= y + 5; yy++) {
        var id = Voxel.World.get(x + dx, yy, z + dz);
        if (editedAt(x + dx, yy, z + dz) || metaAt(x + dx, yy, z + dz) ||
          FUNCTIONAL_BLOCKS[id] || (yy === y ? (id !== 0 && id !== 7) : (id !== 0 && id !== 7))) return null;
      }
    }
    var changes = [];
    for (var px = -3; px <= 3; px++) for (var pz = -3; pz <= 3; pz++) {
      if (Voxel.World.get(x + px, y, z + pz) !== 3)
        changes.push({ x: x + px, y: y, z: z + pz, id: 3 });
      for (var py = y + 1; py <= y + 5; py++)
        if (Voxel.World.get(x + px, py, z + pz) === 7)
          changes.push({ x: x + px, y: py, z: z + pz, id: 0 });
    }
    if (changes.length) {
      var written = Voxel.World.applyInfrastructure
        ? Voxel.World.applyInfrastructure(changes) : 0;
      if (written !== changes.length) {
        for (var wi = 0; wi < changes.length; wi++)
          Voxel.World.set(changes[wi].x, changes[wi].y, changes[wi].z, changes[wi].id);
      }
    }
    Voxel.World.setMeta(x, y, z, {
      type: 'portal-platform',
      v: 1,
      networkVersion: Voxel.Galaxy && Voxel.Galaxy.PORTAL_NETWORK_VERSION || 2,
      worldId: world && world.id || ''
    });
    return platformMatches(x, y, z) ? { x: x, y: y, z: z, platform: true } : null;
  }

  function portalYaw(site, anchor) {
    var dx = finite(anchor && anchor.x, 128.5) - (site.x + 0.5);
    var dz = finite(anchor && anchor.z, 128.5) - (site.z + 0.5);
    return Math.atan2(dx, dz);
  }

  function conservativePortalBounds(site, yaw) {
    var c = Math.cos(yaw), s = Math.sin(yaw);
    var hx = Math.abs(c) * 2.7 + Math.abs(s) * 0.55;
    var hz = Math.abs(s) * 2.7 + Math.abs(c) * 0.55;
    return new THREE.Box3(
      new THREE.Vector3(site.x + 0.5 - hx, site.y + 0.35, site.z + 0.5 - hz),
      new THREE.Vector3(site.x + 0.5 + hx, site.y + 6.25, site.z + 0.5 + hz)
    );
  }

  function reserveBox(role, box) {
    if (!box || box.isEmpty && box.isEmpty()) return;
    reservedBounds.push({ role: role, box: box.clone ? box.clone() : box });
  }

  function reserveObject(role, object, padding) {
    if (!object) return;
    var box = new THREE.Box3().setFromObject(object);
    if (padding && box.expandByScalar) box.expandByScalar(padding);
    reserveBox(role, box);
  }

  function boundsConflict(box, sites) {
    for (var i = 0; i < reservedBounds.length; i++) if (box.intersectsBox(reservedBounds[i].box)) return true;
    for (var j = 0; j < sites.length; j++) if (box.intersectsBox(sites[j].bounds)) return true;
    return false;
  }

  function deterministicOffsets(gate, index) {
    var out = [[0, 0]], ring = [];
    for (var r = 2; r <= 18; r += 2) {
      ring.length = 0;
      for (var x = -r; x <= r; x += 2) ring.push([x, -r]);
      for (var z = -r + 2; z <= r; z += 2) ring.push([r, z]);
      for (var x2 = r - 2; x2 >= -r; x2 -= 2) ring.push([x2, r]);
      for (var z2 = r - 2; z2 > -r; z2 -= 2) ring.push([-r, z2]);
      var salt = 0;
      if (Voxel.SeedUtil && Voxel.SeedUtil.derive32)
        salt = Voxel.SeedUtil.derive32((world && world.seed) || '0', 0x7710 + index * 31 + r);
      var start = ring.length ? salt % ring.length : 0;
      for (var q = 0; q < ring.length; q++) out.push(ring[(start + q) % ring.length]);
    }
    return out;
  }

  function sitePlacementClear(site, bounds, sites) {
    for (var i = 0; i < sites.length; i++) {
      var dx = site.x - sites[i].x, dz = site.z - sites[i].z;
      if (dx * dx + dz * dz < PORTAL_MIN_DISTANCE * PORTAL_MIN_DISTANCE) return false;
    }
    return !boundsConflict(bounds, sites);
  }

  function portalVolumeClear(site, bounds) {
    var x0 = Math.floor(bounds.min.x), x1 = Math.ceil(bounds.max.x) - 1;
    var y0 = Math.max(0, Math.floor(bounds.min.y)), y1 = Math.min(worldHeight() - 1, Math.ceil(bounds.max.y) - 1);
    var z0 = Math.floor(bounds.min.z), z1 = Math.ceil(bounds.max.z) - 1;
    for (var x = x0; x <= x1; x++) for (var z = z0; z <= z1; z++)
      for (var y = y0; y <= y1; y++) {
        var id = Voxel.World.get(x, y, z), metadata = metaAt(x, y, z);
        if (y >= site.y + 1) {
          if (id !== 0 || editedAt(x, y, z) || metadata) return false;
        } else {
          // 地板层允许天然地形；系统自有平台的stone edits和中心marker也允许。
          var ownPlatformMarker = site.platform && metadata && metadata.type === 'portal-platform';
          if (FUNCTIONAL_BLOCKS[id] || (metadata && !ownPlatformMarker) ||
            (editedAt(x, y, z) && !site.platform)) return false;
        }
      }
    return true;
  }

  function acceptResolvedSite(site, gate, anchor, sites) {
    if (!site) return null;
    var yaw = portalYaw(site, anchor);
    var bounds = conservativePortalBounds(site, yaw);
    if (!portalVolumeClear(site, bounds) || !sitePlacementClear(site, bounds, sites)) return null;
    site.gate = gate;
    site.rotationY = yaw;
    site.bounds = bounds;
    return site;
  }

  function resolvePortalSites(layout, anchor) {
    var sites = [], max = world && world.kind === 'station' ? Math.min(6, layout.length) : layout.length;
    for (var i = 0; i < max; i++) {
      var gate = layout[i] || {};
      var base = world && world.kind === 'station' ? STATION_PADS[i] : [Number(gate.x), Number(gate.z)];
      if (!base || !isFinite(base[0]) || !isFinite(base[1])) continue;
      var offsets = world && world.kind === 'station' ? STATION_SITE_OFFSETS : deterministicOffsets(gate, i);
      var accepted = null;
      for (var oi = 0; oi < offsets.length && !accepted; oi++) {
        var candidateX = Math.round(base[0] + offsets[oi][0]);
        var candidateZ = Math.round(base[1] + offsets[oi][1]);
        var platformY = Math.max(3, Math.min(worldHeight() - 6, waterLevel() + 1));
        var dry = platformMatches(candidateX, platformY, candidateZ)
          ? { x: candidateX, y: platformY, z: candidateZ, platform: true }
          : dryPortalSite(candidateX, candidateZ);
        accepted = acceptResolvedSite(dry, gate, anchor, sites);
      }
      // 严格搜索仍无干地时，只在确定的水面候选上建有限平台；编辑冲突时直接跳过，
      // 绝不退回危险原坐标。
      if (!accepted && world && world.kind !== 'station') {
        for (var pi = 0; pi < offsets.length && !accepted; pi++) {
          var px = Math.round(base[0] + offsets[pi][0]), pz = Math.round(base[1] + offsets[pi][1]);
          if (!wetColumn(px, pz)) continue;
          var preview = { x: px, y: Math.max(3, Math.min(worldHeight() - 6, waterLevel() + 1)), z: pz };
          var previewYaw = portalYaw(preview, anchor);
          if (!sitePlacementClear(preview, conservativePortalBounds(preview, previewYaw), sites)) continue;
          var platform = ensureOceanPlatform(px, pz);
          accepted = acceptResolvedSite(platform, gate, anchor, sites);
        }
      }
      if (accepted) sites.push(accepted);
    }
    return sites;
  }

  function insidePortalTrigger(portal, player, expanded) {
    if (!portal || !player) return false;
    var dx = player.x - portal.position.x;
    var dy = player.y - (portal.position.y + 2);
    var dz = player.z - portal.position.z;
    return dx * dx + dz * dz < (expanded ? PORTAL_EXIT_R2 : PORTAL_ENTER_R2) &&
      Math.abs(dy) < (expanded ? PORTAL_EXIT_Y : PORTAL_ENTER_Y);
  }

  function anyPortalInside(player, expanded) {
    for (var i = 0; i < portals.length; i++) if (insidePortalTrigger(portals[i], player, expanded)) return true;
    return false;
  }

  // Main只在真实inside边沿的同步调用栈内接受这份不可猜引用；公开
  // requestTravel(destination,'portal') 无法绕过物理门径免费跳转。
  function authorizePortalTravel(proof, destinationId) {
    if (!proof || proof !== activePortalProof || !proof.portal ||
      portals.indexOf(proof.portal) < 0 || !Voxel.Player || !Voxel.Player.pos) return false;
    var gate = proof.portal.userData && proof.portal.userData.portal;
    if (!gate || gate.id !== proof.gateId || gate.pairId !== proof.pairId ||
      gate.destinationGateId !== proof.destinationGateId || gate.destinationId !== destinationId ||
      !insidePortalTrigger(proof.portal, Voxel.Player.pos(), false)) return false;
    var planned = Voxel.Galaxy && Voxel.Galaxy.portalsFor ? Voxel.Galaxy.portalsFor(galaxy, world) : [];
    for (var i = 0; i < planned.length; i++) if (planned[i].id === gate.id)
      return planned[i].pairId === gate.pairId && planned[i].destinationGateId === gate.destinationGateId &&
        planned[i].destinationId === destinationId;
    return false;
  }

  function nearestPortalTo(player, limit) {
    var best = null, bestDistance = limit === undefined ? Infinity : limit;
    for (var i = 0; i < portals.length; i++) {
      var portal = portals[i];
      var dx = player.x - portal.position.x;
      var dy = player.y - (portal.position.y + 2);
      var dz = player.z - portal.position.z;
      var distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance < bestDistance) { bestDistance = distance; best = portal; }
    }
    return best;
  }

  function syncPortalOccupancy() {
    var currentPlayer = Voxel.Player && Voxel.Player.pos ? Voxel.Player.pos() : null;
    portalInside = anyPortalInside(currentPlayer, false);
    portalArmed = !anyPortalInside(currentPlayer, true);
    nearPortal = currentPlayer ? nearestPortalTo(currentPlayer, 7) : null;
    return { armed: portalArmed, inside: portalInside };
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
    g.userData.cockpitLocal = COCKPIT_LOCAL.slice();
    g.userData.exitLocal = EXIT_LOCAL.slice();
    g.userData.gearLocal = GEAR_LOCAL.map(function (v) { return v.slice(); });
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
    var thrustLevel = flightState ? Math.min(1, Math.abs(flightState.throttle)) : 0;
    var enginePulse = reducedMotion ? 0.72 + thrustLevel * 0.24 :
      0.68 + thrustLevel * 0.22 + Math.sin(now * (5.2 + thrustLevel * 5)) * (0.08 + thrustLevel * 0.08);
    for (var e = 0; e < shipParts.engines.length; e++) {
      var engine = shipParts.engines[e];
      if (!engine) continue;
      if (engine.material) engine.material.opacity = enginePulse;
      var engineScale = reducedMotion ? 1 + thrustLevel * 0.08 :
        1 + thrustLevel * 0.18 + Math.sin(now * 5.2) * 0.06;
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
    aboardShip = false; boardedWorldId = null; shieldImpactUntil = 0; cockpitSignature = '';
    cockpitLastSyncAt = -Infinity;
    flightState = null; flightEvents.length = 0; lastSafeExit = null; lastLandingPose = null;
    flightRestoreValid = true;
    group = null; ship = null; shipBaseY = 0; portals = []; nearShip = false; nearPortal = null;
    shipParts = { engines: [], door: null, ramp: null };
    stationHub = null; stationDock = null; stationTerminal = null;
    reservedBounds.length = 0;
    resolvedPortalSites.length = 0;
    portalArmed = false; portalInside = false; activePortalProof = null;
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
    syncCockpit(true);
    return hadRoot;
  }

  function loadWorld(w, g, savedFlight) {
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

    reservedBounds.length = 0;
    resolvedPortalSites.length = 0;
    var arrivalAnchor;
    if (safeWorldKind(world) === 'planet') {
      var sp = Voxel.World.spawnPoint();
      arrivalAnchor = sp.clone ? sp.clone() : new THREE.Vector3(sp.x, sp.y, sp.z);
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
      var fallbackFlight = defaultFlightSnapshot();
      var worldFlight = savedFlight;
      if (worldFlight === undefined && g && g.worlds && g.worlds[w.id])
        worldFlight = g.worlds[w.id].shipFlight;
      flightRestoreValid = worldFlight === undefined || worldFlight === null || validSavedFlight(worldFlight);
      flightState = Voxel.ShipFlight
        ? Voxel.ShipFlight.restore(worldFlight, fallbackFlight) : fallbackFlight;
      applyFlightTransform();
      if (flightBoxCollides(flightState.position, flightState)) {
        flightState = Voxel.ShipFlight
          ? Voxel.ShipFlight.restore(fallbackFlight, fallbackFlight) : fallbackFlight;
        applyFlightTransform();
      }
      if (flightState && flightState.landed)
        lastLandingPose = [flightState.position[0], flightState.position[1], flightState.position[2], flightState.yaw];
      reserveObject('ship', ship, 2.5);
    } else {
      flightState = null;
      arrivalAnchor = new THREE.Vector3(128.5, 24.01, 128.5);
      stationHub = makeStationHub();
      stationHub.position.set(128.5, 24, 112.5);
      group.add(stationHub);
      stationDock = makeStationDock();
      stationDock.position.set(128.5, 24, 128.5);
      group.add(stationDock);
      // 与可见屏幕中心一致；扫描/测试不再依赖旧的出生点硬编码。
      stationTerminal = new THREE.Vector3(128.5, 27.7, 114.22);
      reserveObject('station-hub', stationHub, 2.25);
      reserveObject('station-dock', stationDock, 1.75);
    }
    reserveBox('arrival', new THREE.Box3(
      new THREE.Vector3(arrivalAnchor.x - 3, arrivalAnchor.y - 2, arrivalAnchor.z - 3),
      new THREE.Vector3(arrivalAnchor.x + 3, arrivalAnchor.y + 5, arrivalAnchor.z + 3)));

    var layout = Voxel.Galaxy.portalsFor(galaxy, world);
    resolvedPortalSites = resolvePortalSites(Array.isArray(layout) ? layout : [], arrivalAnchor);
    for (var i = 0; i < resolvedPortalSites.length; i++) {
      var site = resolvedPortalSites[i], gate = site.gate || {};
      var dest = Voxel.Galaxy.find(galaxy, gate.destinationId) || {};
      var pg = makePortal(gate, dest);
      pg.position.set(site.x + 0.5, site.y + 1, site.z + 0.5);
      pg.rotation.y = site.rotationY;
      pg.userData.pairId = gate.pairId || null;
      pg.userData.destinationGateId = gate.destinationGateId || null;
      pg.userData.slot = gate.slot || null;
      pg.userData.kind = gate.kind || null;
      pg.userData.platform = !!site.platform;
      pg.userData.resolvedSite = site;
      group.add(pg);
      portals.push(pg);
    }
    group.userData.portalPlanCount = Array.isArray(layout) ? layout.length : 0;
    group.userData.portalLayoutComplete = portals.length === group.userData.portalPlanCount;
    if (!group.userData.portalLayoutComplete && Voxel.HUD && Voxel.HUD.toast)
      Voxel.HUD.toast('部分传送门泊位被玩家建筑阻挡：可移开附近方块后重新载入');
    rampChangedAt = visualTime();
    applyVisualState(rampChangedAt);
    portalCooldown = 0;
    // enterWorld完成玩家位置恢复后会再次同步；提前准备基础设施时这里只建立安全默认值。
    syncPortalOccupancy();
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
    mapButton = document.getElementById('btn-starmap-hud');
    bindScanDom();
    if (world && galaxy) { syncHud(); syncScan(true); syncMapButton(); }
    else { setHudOffline(); setScanOffline(); }
    syncCockpit(true);
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
      if (flightState) applyFlightTransform();
      var il = ship.userData.interactionLocal || [0, 1, 0];
      _interactionPoint.set(il[0], il[1], il[2]);
      ship.localToWorld(_interactionPoint);
      nearShip = !isAboard() && _interactionPoint.distanceTo(p) < 7.5;
    } else nearShip = world.kind === 'station';
    nearPortal = nearestPortalTo(p, 7);
    setRampTarget(nearShip && (!flightState || flightState.landed) && !isAboard(), now);
    applyVisualState(now);
    portalInside = anyPortalInside(p, false);
    var withinExitLatch = anyPortalInside(p, true);
    if (!portalArmed) {
      if (!withinExitLatch) portalArmed = true;
    } else if (!isAboard() && portalInside && portalCooldown <= 0) {
      // 无论事务是否接受，当前inside事件已经消费；必须先离开扩大体积再重入。
      portalArmed = false;
      for (var i = 0; i < portals.length; i++) {
        var o = portals[i];
        if (!insidePortalTrigger(o, p, false)) continue;
        if (Voxel.Game && Voxel.Game.requestTravel) {
          var gate = o.userData.portal || {};
          var proof = {
            portal: o,
            gateId: gate.id,
            pairId: gate.pairId,
            destinationGateId: gate.destinationGateId
          };
          activePortalProof = proof;
          try { Voxel.Game.requestTravel(gate.destinationId, 'portal', proof); }
          finally { activePortalProof = null; }
        }
        break;
      }
    }
    syncHud();
    syncMapButton();
    if (isAboard()) syncCockpit(false);
  }

  function actionHint() {
    if (!world) return '';
    if (nearPortal && nearPortal.userData)
      return '传送门 → ' + worldText(nearPortal.userData.destination).name + ' · 接触后免费传送';
    if (world.kind === 'station') return '航行终端：' + (Voxel.Controls.touchMode() ? '点右上角「星图」' : '按 H 打开星图');
    if (nearShip) return '飞船舱门已就绪：' + (Voxel.Controls.touchMode()
      ? '点右上角「登舰」进入密封舱' : '按 E 登舰避难 · H 打开外部星图');
    return '';
  }

  function actionHintKind() {
    if (nearPortal) return 'portal';
    if (world && world.kind === 'station') return 'terminal';
    return nearShip ? 'ship' : '';
  }

  function nearPortalInfo() {
    if (!nearPortal || !nearPortal.userData || !Voxel.Player || !Voxel.Player.pos) return null;
    var p = Voxel.Player.pos();
    var dx = p.x - nearPortal.position.x;
    var dy = p.y - (nearPortal.position.y + 2);
    var dz = p.z - nearPortal.position.z;
    return {
      destinationId: nearPortal.userData.portal && nearPortal.userData.portal.destinationId || '',
      label: '传送门 → ' + worldText(nearPortal.userData.destination).name + ' · 免费',
      distance: Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz) * 10) / 10
    };
  }

  function canOpenMap() { return !!world && (world.kind === 'station' || nearShip || isAboard()); }

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

  function routePlanFor(dest) {
    try {
      if (Voxel.Galaxy && Voxel.Galaxy.routePlan)
        return Voxel.Galaxy.routePlan(galaxy, world, dest, galaxy && galaxy.ship);
    } catch (e) { }
    var distance = dest && world ? galaxyDistance(dest) : 0;
    var cost = dest && world && dest.id !== world.id
      ? Math.round(finite(Voxel.Galaxy.fuelCost(world, dest), 0, 0, 1000000)) : 0;
    var st = shipText(galaxy);
    return {
      valid: !!dest && !!world,
      distanceLy: distance,
      costUnits: cost,
      fuel: st.fuel,
      maxFuel: st.maxFuel,
      remainingFuel: Math.max(0, st.fuel - cost),
      shortfall: Math.max(0, cost - st.fuel),
      reachable: !!dest && st.fuel >= cost,
      portalPath: [],
      portalHops: -1,
      directPortal: false
    };
  }

  function visitStateFor(dest, current, known, surveyed) {
    if (current) return 'current';
    if (surveyed) return 'surveyed';
    if (known) return 'visited';
    return 'unknown';
  }

  function hasPhysicalPortalTo(destinationId) {
    for (var i = 0; i < portals.length; i++) {
      var gate = portals[i].userData && portals[i].userData.portal;
      if (gate && gate.destinationId === destinationId) return true;
    }
    return false;
  }

  function physicalPortalLayoutComplete() {
    try {
      var planned = Voxel.Galaxy.portalsFor(galaxy, world);
      return planned.length > 0 && portals.length === planned.length;
    } catch (e) { return false; }
  }

  function portalRouteLabel(plan, destinationId) {
    if (!plan || plan.portalHops < 1) return '无可用门网路径';
    if (hasPhysicalPortalTo(destinationId)) return '本地门径直达 · 免费';
    if (!physicalPortalLayoutComplete()) return '本地门径受阻 · 请检查附近建筑';
    return '门网 ' + plan.portalHops + ' 跳 · 免费';
  }

  function routeMapCoordinates() {
    var out = Object.create(null), list = galaxy && Array.isArray(galaxy.catalog) ? galaxy.catalog : [];
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < list.length; i++) {
      var x = finite(list[i] && list[i].x, 0, -1000000, 1000000);
      var y = finite(list[i] && list[i].y, 0, -1000000, 1000000);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (!isFinite(minX)) return out;
    var spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
    for (var j = 0; j < list.length; j++) {
      var wx = finite(list[j] && list[j].x, 0, -1000000, 1000000);
      var wy = finite(list[j] && list[j].y, 0, -1000000, 1000000);
      out[list[j].id] = {
        x: Math.round((38 + (wx - minX) / spanX * 624) * 100) / 100,
        y: Math.round((102 - (wy - minY) / spanY * 84) * 100) / 100
      };
    }
    return out;
  }

  function syncRouteMap(selected, selectedPlan) {
    if (typeof document === 'undefined') return false;
    var root = document.getElementById('starmap-route-map');
    if (!root || !galaxy || !world) return false;
    var coords = routeMapCoordinates();
    var list = Array.isArray(galaxy.catalog) ? galaxy.catalog : [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i], node = document.getElementById('starmap-node-' + item.id), point = coords[item.id];
      if (!node || !point) continue;
      var summary = Voxel.Discovery && Voxel.Discovery.worldSummary
        ? Voxel.Discovery.worldSummary(galaxy.discovery, item.id) : null;
      var surveyed = !!(summary && summary.surveyed);
      var known = surveyed || !!(galaxy.discovered && galaxy.discovered[item.id]);
      var base = visitStateFor(item, item.id === world.id, known, surveyed);
      var stateName = base;
      if (selected && selected.id === item.id)
        stateName = selectedPlan && !selectedPlan.reachable ? 'insufficient' : 'selected';
      node.setAttribute('data-base-state', base);
      node.setAttribute('data-state', stateName);
      node.setAttribute('data-x', String(point.x));
      node.setAttribute('data-y', String(point.y));
      node.setAttribute('transform', 'translate(' + point.x + ' ' + point.y + ')');
    }
    var edgeEls = document.querySelectorAll('#starmap-portal-edges .starmap-portal-edge');
    for (var e = 0; e < edgeEls.length; e++) edgeEls[e].setAttribute('data-active', 'false');
    var gates = [];
    for (var pi = 0; pi < portals.length; pi++)
      if (portals[pi].userData && portals[pi].userData.portal) gates.push(portals[pi].userData.portal);
    var origin = coords[world.id];
    for (var g = 0; origin && g < gates.length && g < edgeEls.length; g++) {
      var target = coords[gates[g].destinationId];
      if (!target) continue;
      edgeEls[g].setAttribute('x1', String(origin.x));
      edgeEls[g].setAttribute('y1', String(origin.y));
      edgeEls[g].setAttribute('x2', String(target.x));
      edgeEls[g].setAttribute('y2', String(target.y));
      edgeEls[g].setAttribute('data-destination-id', gates[g].destinationId);
      edgeEls[g].setAttribute('data-active', 'true');
    }
    var active = document.getElementById('starmap-active-route');
    var destinationPoint = selected && coords[selected.id];
    if (active && origin && destinationPoint) {
      active.setAttribute('x1', String(origin.x)); active.setAttribute('y1', String(origin.y));
      active.setAttribute('x2', String(destinationPoint.x)); active.setAttribute('y2', String(destinationPoint.y));
      active.setAttribute('data-from-id', world.id);
      active.setAttribute('data-to-id', selected.id);
      active.setAttribute('data-active', 'true');
    } else if (active) {
      active.removeAttribute('data-from-id'); active.removeAttribute('data-to-id');
      active.setAttribute('data-active', 'false');
    }
    root.setAttribute('data-ready', Object.keys(coords).length === list.length && list.length === 7 ? 'true' : 'false');
    return true;
  }

  function setSelectedDestination(destinationId) {
    var dest = destinationId === null || destinationId === undefined || !galaxy
      ? null : Voxel.Galaxy.find(galaxy, destinationId);
    if (!dest || !world || dest.id === world.id) dest = null;
    var plan = dest ? routePlanFor(dest) : null;
    if (dest && (!plan || !plan.valid)) { dest = null; plan = null; }
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
    var requiresBoarding = !!(world && world.kind === 'planet' && !isAboard());
    if (dest) {
      insufficient = !plan.reachable;
      if (requiresBoarding) {
        setText(selection, '外部星图只读 · 请先按 E 登舰，再按 H 打开星图点火跃迁');
      } else if (insufficient) {
        setText(selection, '航线不可用 · ' + worldText(dest).name + ' · 需要 ' + plan.costUnits +
          ' 能量 · 当前 ' + plan.fuel + ' · 缺少 ' + plan.shortfall + ' · 前往阿特拉斯中继站补给');
      } else {
        setText(selection, '航线已锁定：' + worldText(dest).name + ' · 距离 ' + plan.distanceLy +
          ' LY · 飞船消耗 ' + plan.costUnits + ' 能量 · 到达后 ' + plan.remainingFuel + '/' +
          plan.maxFuel + ' · ' + portalRouteLabel(plan, dest.id));
      }
    } else setText(selection, '请选择目的地以锁定跃迁航线');
    if (cockpit) cockpit.setAttribute('data-state', dest ?
      (requiresBoarding ? 'external' : (insufficient ? 'insufficient' : 'locked')) : 'idle');
    if (ignite) {
      ignite.disabled = !dest || insufficient || requiresBoarding;
      ignite.setAttribute('aria-disabled', ignite.disabled ? 'true' : 'false');
    }
    syncRouteMap(dest, plan);
    return !!dest && !insufficient;
  }

  function showMap() {
    if (!mapGrid || !galaxy || !world) return;
    mapGrid.innerHTML = '';
    var list = Array.isArray(galaxy.catalog) ? galaxy.catalog.filter(function (d) {
      return d && typeof d === 'object';
    }).slice() : [];
    list.sort(function (a, b) {
      if (a.id === world.id) return -1;
      if (b.id === world.id) return 1;
      var delta = galaxyDistance(a) - galaxyDistance(b);
      return delta || String(a.id).localeCompare(String(b.id));
    });
    for (var i = 0; i < list.length; i++) {
      (function (dest) {
        var current = dest.id === world.id;
        var plan = routePlanFor(dest);
        var distance = plan.distanceLy;
        var cost = plan.costUnits;
        var visited = !!(galaxy.discovered && galaxy.discovered[dest.id]);
        var discovery = Voxel.Discovery && Voxel.Discovery.worldSummary
          ? Voxel.Discovery.worldSummary(galaxy.discovery, dest.id) : null;
        var surveyed = !!(discovery && discovery.surveyed);
        var known = visited || surveyed;
        var visitState = visitStateFor(dest, current, known, surveyed);
        var routeState = current ? 'current' : (plan.reachable ? 'available' : 'insufficient');
        var wt = worldText(dest);
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'star-card' + (current ? ' current' : '') + (known ? ' discovered' : '') +
          (surveyed ? ' surveyed' : '') + (!known && !current ? ' unknown' : '') +
          (routeState === 'insufficient' ? ' insufficient' : '');
        card.disabled = current;
        card.setAttribute('data-destination-id', String(dest.id));
        card.setAttribute('data-route-state', routeState);
        card.setAttribute('data-visit-state', visitState);
        card.setAttribute('data-distance-ly', String(distance));
        card.setAttribute('data-fuel-cost', String(cost));
        card.setAttribute('data-portal-reachable', hasPhysicalPortalTo(dest.id) ? 'true' : 'false');
        card.setAttribute('aria-pressed', 'false');
        if (current) card.setAttribute('aria-current', 'location');
        card.style.setProperty('--accent', safeAccent(!known && !current ? '#8190a8' : dest.accent));
        var icon = document.createElement('span');
        icon.className = 'star-icon';
        icon.textContent = !known && !current ? '◇' : wt.icon;
        var main = document.createElement('span');
        main.className = 'star-main';
        var name = document.createElement('b');
        name.textContent = wt.name;
        var detail = document.createElement('small');
        detail.textContent = !known && !current
          ? '远距档案未确认'
          : wt.typeName + ' · ' + safeText(dest.desc, '暂无环境档案', 80);
        main.appendChild(name); main.appendChild(detail);
        var meta = document.createElement('span');
        meta.className = 'star-meta';
        meta.appendChild(document.createTextNode(current ? '当前位置' : (known ? '已抵达' : '未抵达 · 光谱未确认')));
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
          meta.appendChild(document.createTextNode('距离 ' + distance + ' LY · 飞船 ' + cost + ' 能量'));
          meta.appendChild(document.createElement('br'));
          meta.appendChild(document.createTextNode(plan.reachable
            ? portalRouteLabel(plan, dest.id)
            : '能量不足 · 缺少 ' + plan.shortfall));
        }
        var accessibleState = current ? '当前位置' : (surveyed ? '已测绘' : (known ? '已抵达未测绘' : '未抵达'));
        var accessibleRoute = current ? '' : '，距离 ' + distance + ' 光年，飞船消耗 ' + cost +
          ' 能量，' + (plan.reachable ? '到达后剩余 ' + plan.remainingFuel : '能量不足，缺少 ' + plan.shortfall) +
          '，' + portalRouteLabel(plan, dest.id);
        card.setAttribute('aria-label', wt.name + '，' + accessibleState + accessibleRoute);
        card.appendChild(icon); card.appendChild(main); card.appendChild(meta);
        card.addEventListener('click', function (event) {
          if (Voxel.Game && Voxel.Game.selectTravelDestination &&
            (typeof dest.id === 'string' || typeof dest.id === 'number'))
            Voxel.Game.selectTravelDestination(dest.id);
          else setSelectedDestination(dest.id);
          var ignite = document.getElementById('btn-travel-ignite');
          if (event && event.detail === 0 && ignite && !ignite.disabled && ignite.focus)
            ignite.focus({ preventScroll: true });
        });
        mapGrid.appendChild(card);
      })(list[i]);
    }
    var title = document.getElementById('starmap-status');
    var st = shipText(galaxy);
    setText(title, st.engine + ' · 能量 ' + st.fuel + '/' + st.maxFuel);
    setSelectedDestination(null);
    syncCockpit(true);
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

  function relativeDirection(dx, dz) {
    var yaw = Voxel.Controls && Voxel.Controls.yaw ? finite(Voxel.Controls.yaw(), 0) : 0;
    var targetYaw = Math.atan2(-dx, -dz);
    var delta = targetYaw - yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    var names = ['前方', '左前方', '左侧', '左后方', '后方', '右后方', '右侧', '右前方'];
    var index = Math.round(delta / (Math.PI / 4));
    if (index < 0) index += 8;
    return names[index % 8];
  }

  function arrivalGuidance(from, mode) {
    if (!Voxel.Player || !Voxel.Player.pos) return '';
    var target = null, label = '';
    if (mode === 'portal' && from && from.id) {
      for (var i = 0; i < portals.length; i++) {
        var gate = portals[i].userData && portals[i].userData.portal;
        if (gate && gate.destinationId === from.id) { target = portals[i].position; label = '返程门'; break; }
      }
    }
    if (!target && world && world.kind === 'station' && stationTerminal) {
      target = stationTerminal; label = '航行终端';
    }
    if (!target && ship) {
      var il = ship.userData.interactionLocal || [0, 1, 0];
      _interactionPoint.set(il[0], il[1], il[2]);
      ship.localToWorld(_interactionPoint);
      target = _interactionPoint; label = '飞船';
    }
    if (!target) return '';
    var p = Voxel.Player.pos();
    var dx = target.x - p.x, dz = target.z - p.z;
    var distance = Math.max(0, Math.round(Math.sqrt(dx * dx + dz * dz) * 10) / 10);
    return label + ' · ' + relativeDirection(dx, dz) + ' ' + distance.toFixed(1) + 'm';
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
    var guidance = arrivalGuidance(from, mode);
    setText(document.getElementById('arrival-guidance'), guidance || '导航锚点正在同步');
    setText(document.getElementById('arrival-detail'), details.join(' · '));
    terminal.setAttribute('data-view', 'arrival');
    terminal.setAttribute('aria-labelledby', 'arrival-world');
    if (passive) passive.setAttribute('aria-hidden', 'true');
    card.classList.remove('hidden');
    if (!options.silent) announceTravel('已抵达 ' + wt.name + '，' + wt.typeName +
      (guidance ? '；' + guidance : '') + '。');
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
    var player = Voxel.Player && Voxel.Player.pos ? Voxel.Player.pos() : null;
    var portalSnapshots = portals.map(function (portal) {
      var normal = new THREE.Vector3(0, 0, 1);
      if (portal.getWorldQuaternion) normal.applyQuaternion(portal.getWorldQuaternion(new THREE.Quaternion()));
      return {
        id: portal.userData && portal.userData.portal ? portal.userData.portal.id : null,
        destinationId: portal.userData && portal.userData.portal ? portal.userData.portal.destinationId : null,
        destinationGateId: portal.userData ? portal.userData.destinationGateId : null,
        pairId: portal.userData ? portal.userData.pairId : null,
        slot: portal.userData ? portal.userData.slot : null,
        kind: portal.userData ? portal.userData.kind : null,
        position: [round4(portal.position.x), round4(portal.position.y), round4(portal.position.z)],
        rotationY: round4(portal.rotation.y),
        normal: [round4(normal.x), round4(normal.y), round4(normal.z)],
        bounds: boundsFor(portal),
        platform: !!(portal.userData && portal.userData.platform),
        armed: portalArmed,
        inside: insidePortalTrigger(portal, player, false),
        near: nearPortal === portal,
        trigger: { radius: round4(Math.sqrt(PORTAL_ENTER_R2)), halfHeight: PORTAL_ENTER_Y,
          exitRadius: round4(Math.sqrt(PORTAL_EXIT_R2)), exitHalfHeight: PORTAL_EXIT_Y }
      };
    });
    var reserved = reservedBounds.map(function (entry) {
      return {
        role: entry.role,
        bounds: {
          min: [round4(entry.box.min.x), round4(entry.box.min.y), round4(entry.box.min.z)],
          max: [round4(entry.box.max.x), round4(entry.box.max.y), round4(entry.box.max.z)]
        }
      };
    });
    return {
      generation: generation,
      worldId: world ? world.id : null,
      kind: world ? safeWorldKind(world) : null,
      rootCount: group ? 1 : 0,
      portalPlanCount: group && group.userData ? finite(group.userData.portalPlanCount, 0, 0, 64) : 0,
      portalLayoutComplete: !!(group && group.userData && group.userData.portalLayoutComplete),
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
        rotation: [round4(ship.rotation.x), round4(ship.rotation.y), round4(ship.rotation.z)],
        cockpit: (function () {
          var p = cockpitWorldPosition();
          return p ? [round4(p.x), round4(p.y), round4(p.z)] : null;
        })(),
        flight: flightSnapshot(),
        bounds: boundsFor(ship)
      } : null,
      station: stationHub ? {
        hubBounds: boundsFor(stationHub),
        dockBounds: boundsFor(stationDock),
        terminal: stationTerminal ? [round4(stationTerminal.x), round4(stationTerminal.y), round4(stationTerminal.z)] : null
      } : null,
      portals: portalSnapshots,
      reserved: reserved,
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
    actionHintKind: actionHintKind,
    nearPortalInfo: nearPortalInfo,
    canBoardShip: canBoardShip,
    boardShip: boardShip,
    restoreBoarding: restoreBoarding,
    disembarkShip: disembarkShip,
    isAboard: isAboard,
    absorbsDamage: absorbsDamage,
    updateFlight: updateFlight,
    applyCockpitCamera: applyCockpitCamera,
    cockpitWorldPosition: cockpitWorldPosition,
    safeExitPosition: safeExitPosition,
    canDisembark: canDisembark,
    flightSnapshot: flightSnapshot,
    flightStatus: flightStatus,
    syncCockpit: syncCockpit,
    updateCockpit: updateCockpit,
    registerShieldImpact: registerShieldImpact,
    canOpenMap: canOpenMap,
    authorizePortalTravel: authorizePortalTravel,
    syncPortalOccupancy: syncPortalOccupancy,
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
