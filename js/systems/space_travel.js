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
  // 传送门的四层几何在多个门之间共享，只构建一次；clear() 必须置空，
  // 否则下次 loadWorld 会复用已经被 disposeList 释放掉的僵尸 geometry。
  var portalGeoCache = null;
  var reducedMotion = false, visualTimeOverride = null;
  var rampTarget = 0, rampFrom = 0, rampChangedAt = 0, rampProgress = 0;
  var selectedDestinationId = null, flightMode = 'ship', flightSkipping = false;
  // 银河星图的标签页/视窗/选择状态由 ui/galaxy_map.js 管理。
  var aboardShip = false, boardedWorldId = null, cockpitSignature = '', shieldImpactUntil = 0;
  var cockpitLastSyncAt = -Infinity;
  var flightState = null, flightEvents = [], lastSafeExit = null, lastLandingPose = null;
  var flightRestoreValid = true;
  var landingAssist = null, landingAssistDistance = null;
  var arrivalTimer = null;
  var generation = 0;
  var owned = { geometries: [], materials: [], textures: [] };
  var created = { roots: 0, geometries: 0, materials: 0, textures: 0 };
  var disposed = { roots: 0, geometries: 0, materials: 0, textures: 0 };
  var SCAN_INTERVAL_MS = 125; // 约 8Hz；目标种类/名称改变时允许立即刷新。
  var PORTAL_ENTER_R2 = 1.35, PORTAL_ENTER_Y = 2.2;
  var PORTAL_EXIT_R2 = 1.8 * 1.8, PORTAL_EXIT_Y = 2.7;
  var PORTAL_MIN_DISTANCE = 8;
  var FUNCTIONAL_BLOCKS = { 15: true, 17: true, 37: true, 38: true,
    67: true, 68: true, 69: true, 70: true, 71: true };   // 床头/床尾同为功能方块
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
  // 合批用的临时对象：避免每个盒子都新建 Euler/Matrix4。
  var _clusterEuler = new THREE.Euler();
  var _clusterMat4 = new THREE.Matrix4();
  var _camWorldPos = new THREE.Vector3();
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
    var assist = landingAssistInfo();
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
      assist: assist.active,
      assistPhase: assist.phase,
      assistDistance: assist.distance,
      flightMode: assist.active ? 'AUTO LAND' :
        (flight && flight.landed ? 'LANDED' : (flight && flight.collided ? 'ASSIST // COLLISION' : 'ATMOSPHERIC FLIGHT'))
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
      model.canDisembark ? 1 : 0, model.flightMode, model.assistPhase,
      model.assistDistance === null ? '' : Math.round(model.assistDistance)].join('|');
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
      setAttr(systems, 'data-assist', model.assist ? 'true' : 'false');
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
    setText(document.getElementById('cockpit-exit-status'), model.assist
      ? '自动着陆中 · 距目标 ' + Math.max(0, Math.round(model.assistDistance || 0)) + ' m'
      : (model.canDisembark ? '安全离舰就绪' : (model.landed ? '舱门外无安全站立点' : '需先安全着陆')));
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

  function landingAssistConfig() {
    var raw = Voxel.Config && Voxel.Config.SHIP_FLIGHT || {};
    return {
      searchRadius: raw.LANDING_ASSIST_SEARCH_RADIUS,
      maxAltitude: raw.LANDING_ASSIST_MAX_ALT,
      holdMs: raw.LANDING_ASSIST_HOLD_MS,
      landSpeed: raw.LAND_SPEED,
      brakeDecel: raw.BRAKE_DECEL,
      baseClearance: raw.SHIP_BASE_CLEARANCE,
      gearOffsets: GEAR_LOCAL.map(function (g) { return [g[0], g[2]]; })
    };
  }

  function assistWorldApi() {
    return {
      surfaceAt: function (x, z) { return Voxel.World.surfaceAt(x, z); },
      get: function (x, y, z) { return Voxel.World.get(x, y, z); },
      isSolid: function (id) { return !!Voxel.Blocks.isSolid(id); }
    };
  }

  function assistController() {
    if (!landingAssist && Voxel.LandingAssist)
      landingAssist = Voxel.LandingAssist.create(landingAssistConfig());
    return landingAssist;
  }

  function manualFlightInput(input) {
    if (!input || typeof input !== 'object' || !Voxel.ShipFlight) return false;
    var n = Voxel.ShipFlight.normalizeInput(input);
    return Math.abs(n.steerYaw) > 1e-3 || Math.abs(n.steerPitch) > 1e-3 ||
      Math.abs(n.bank) > 1e-3 || Math.abs(n.lift) > 1e-3 ||
      n.thrust === true || n.brake === true;
  }

  function engageLandingAssist() {
    var controller = assistController();
    if (!isAboard() || !flightState || !controller) return { ok: false, reason: 'aboard' };
    return controller.begin(flightState, assistWorldApi());
  }

  function cancelLandingAssist(reason) {
    landingAssistDistance = null;
    return !!(landingAssist && landingAssist.cancel(reason));
  }

  function landingAssistInfo() {
    if (!landingAssist) return { active: false, phase: 'idle', target: null, distance: null, lastResult: null };
    var s = landingAssist.status();
    return { active: s.active, phase: s.phase, target: s.target,
      distance: s.active ? landingAssistDistance : null, lastResult: s.lastResult };
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
      // 树叶对飞行不构成硬碰撞：第 23 轮树冠显著加高加宽后，树叶实心
      // 会让林间垂直起飞/低空穿越必然卡死在冠层内。
      if (!Voxel.Blocks.isSolid(id) ||
        (Voxel.Blocks.defs[id] && Voxel.Blocks.defs[id].leaves)) continue;
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
        // 贴地沉降辅助：垂直末段水平近零的缓慢下降，允许"不劣于当前
        // 计数"的向下移动。否则两类自锁都无法脱困：
        // 1) 出生时与树冠重叠的基线计数卡住下降，船悬停在树冠底面；
        // 2) 贴地瞬间机身角擦过单块凸起(+1)被判停，距判定面差一格。
        var horizSpeed = Math.sqrt(velocity[0] * velocity[0] + velocity[2] * velocity[2]);
        var settleAssist = stepY < 0 && horizSpeed <= 0.6 &&
          yCollisions <= Math.max(currentCollisions, 1);
        if (takeoffAssist || returnLandingAssist || yCollisions === 0 ||
          yCollisions < currentCollisions || (stepY > 0 && yCollisions <= currentCollisions) ||
          settleAssist) {
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
    // 姿态门槛 0.17rad(约9.7°)：满舵诱导滚转即达 0.35*ROLL_MAX≈0.11rad，
    // 原值 0.12 几乎无余量，贴地瞬间任何微小扰动都会拒判落地。
    var canLand = landing.stable && velocity[1] <= 0.05 && speed <= cfg.LAND_SPEED &&
      Math.abs(attitude.pitch || 0) <= 0.17 && Math.abs(attitude.roll || 0) <= 0.17 &&
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
    var controller = assistController();
    var effectiveInput = input;
    if (controller && controller.isActive()) {
      if (manualFlightInput(input)) {
        controller.cancel('cancelled');
        landingAssistDistance = null;
      } else {
        var assist = controller.tick(flightState, dt, assistWorldApi());
        effectiveInput = assist.input;
        landingAssistDistance = assist.distance;
        if (!assist.active) {
          if (assist.expired) controller.cancel('expired');
          else if (assist.blocked) controller.cancel('blocked');
        }
      }
    }
    var result = Voxel.ShipFlight.step(flightState, dt, effectiveInput, {
      config: shipFlightConfig(), resolve: resolveFlightMove
    });
    flightState = result.state;
    flightEvents = result.events.slice();
    if (flightEvents.indexOf('takeoff') >= 0) {
      lastSafeExit = null;
      lastLandingPose = [previous.position[0], previous.position[1], previous.position[2], previous.yaw];
    }
    if (flightEvents.indexOf('landed') >= 0) {
      lastLandingPose = [flightState.position[0], flightState.position[1], flightState.position[2], flightState.yaw];
      if (controller && controller.isActive()) controller.notifyLanded();
      landingAssistDistance = null;
    }
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

  // 离舰位门口被自然方块（凸石/新树干等）占用时，按确定性偏移序在
  // 舱门周围小范围回退搜索，避免玩家被自己停船的位置卡死。
  var EXIT_FALLBACKS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
    [2, 0], [-2, 0], [0, 2], [0, -2],
    [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]
  ];

  function exitCandidate(localX, localZ) {
    _interactionPoint.set(EXIT_LOCAL[0] + localX, EXIT_LOCAL[1], EXIT_LOCAL[2] + localZ);
    ship.localToWorld(_interactionPoint);
    var x = Math.floor(_interactionPoint.x), z = Math.floor(_interactionPoint.z);
    var y = Voxel.World.surfaceAt(x, z) + 1.001;
    if (!(y > 1) || Voxel.World.get(x, Math.floor(y) - 1, z) === 7) return null;
    var candidate = new THREE.Vector3(_interactionPoint.x, y, _interactionPoint.z);
    if (Voxel.Player && Voxel.Player.canStandAt && !Voxel.Player.canStandAt(candidate, true))
      return null;
    return candidate;
  }

  function safeExitPosition() {
    if (!flightState || !flightState.landed || !ship) return null;
    var candidate = exitCandidate(0, 0);
    for (var i = 0; !candidate && i < EXIT_FALLBACKS.length; i++)
      candidate = exitCandidate(EXIT_FALLBACKS[i][0] * 1.4, EXIT_FALLBACKS[i][1] * 1.4);
    if (candidate) { lastSafeExit = candidate.clone(); return candidate; }
    if (lastSafeExit && lastSafeExit.distanceTo(ship.position) <= 10 &&
      (!Voxel.Player || !Voxel.Player.canStandAt || Voxel.Player.canStandAt(lastSafeExit, true)))
      return lastSafeExit.clone();
    return null;
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
      if (hazard && hazard.hazard && hazard.hazard !== 'none') {
        environment += ' · ' + safeText(hazard.label, '环境危害', 18) + ' ' +
          Math.max(0, Math.min(100, Math.round(Number(hazard.percent) || 0))) + '%';
        if (hazard.intensityText) environment += ' · ' + safeText(hazard.intensityText, '', 64);
      }
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

  // 阿特拉斯轨道空间站统一色板：蓝灰合金分层读形，青色只做功能发光，
  // 琥珀只做警示/导航灯，品红仅保留给慢速信标脉冲。
  var STATION_PALETTE = {
    deep: 0x232c44,      // 深空合金：底座/塔肩/设备箱
    mid: 0x4d5f85,       // 中层装甲
    cyan: 0x6fe0ff,      // 功能发光（屏幕/灯带）
    cyanDim: 0x1b5a70,   // 描边暗态
    amber: 0xffb356,     // 导航灯
    beacon: 0xd46bff     // 慢速信标专属
  };

  function stationMaterial(color, options) {
    options = options || {};
    return track('materials', new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      fog: options.fog !== false,
      transparent: !!options.transparent,
      opacity: options.opacity === undefined ? 1 : options.opacity,
      depthWrite: options.depthWrite === undefined ? true : !!options.depthWrite,
      blending: options.blending
    }));
  }

  // 盒簇顶点属性 aMat 的取值：决定程序化纹理分支与质感。
  // 有了分区，装甲板/散热口/陶瓷瓦/发光纹路可以挤在同一个 drawcall 里。
  var MAT_ARMOR = 0;    // 装甲板：面板分割线 + 铆钉 + 轻微磨损，金属高光
  var MAT_STRUCT = 1;   // 深色结构：细面板 + 重磨损条纹，无铆钉，哑光
  var MAT_VENT = 2;     // 散热格栅：横向筋条 + 缝隙内暗腔
  var MAT_CERAMIC = 3;  // 陶瓷隔热瓦：细密瓦片接缝，漫反射强、高光窄而白
  var MAT_ENERGY = 4;   // 能量纹路：自发光，输出 HDR 供 Bloom 高阈值拾取
  var MAT_GRATE = 5;    // 粗网格（坡道/甲板）

  // 飞船色板：比空间站更冷更暗，让青色能量纹路成为唯一的高饱和信息。
  var SHIP_PALETTE = {
    hull: 0x2c3b5a,      // 主装甲
    hullLit: 0x35486c,   // 受光面/背脊
    hullDark: 0x27344f,  // 侧脊/引擎短舱
    keel: 0x151f38,      // 龙骨深色结构
    fin: 0x2a3852,       // 翼根整流
    ceramic: 0xd8e2ec,   // 机鼻陶瓷隔热瓦
    ceramicLit: 0xeef4f9,
    ceramicDark: 0x8fa2b8,
    vent: 0x2a3348,      // 散热格栅
    conduit: 0x6e7d94,   // 表面导管（比装甲亮一档，才读得出走线）
    clamp: 0x49556a,     // 导管卡箍
    joint: 0x4a5c80,     // 关节轴承座/转轴
    glowCyan: 0x7fe9ff,  // 能量纹路
    glowAmber: 0xffb356  // 尾灯/导航灯
  };

  // 把一组盒子合并成单个 BufferGeometry。每盒恒 24 顶点 / 36 索引。
  // part 字段：s 尺寸[w,h,d]、p 位置[x,y,z]、r 绕Y偏航、t 切角[rx,rz]、
  //           m 材质分区、c 分区色、g 自发光强度。除 s/p 外全部可选。
  // options.normals === false 时只产出 position+index（旧行为，供纯 Basic 材质复用）。
  // 新增的 normal/aLocal/aMat/aTint/aEmis 对 MeshBasicMaterial 无害：three 只绑定
  // 着色器实际声明的 attribute，未使用的不产生任何开销。
  function boxClusterGeometry(parts, options) {
    options = options || {};
    var full = options.normals !== false;
    var n = parts.length, vertCount = n * 24;
    var IndexArray = vertCount > 65535 ? Uint32Array : Uint16Array;
    var pos = new Float32Array(vertCount * 3);
    var idx = new IndexArray(n * 36);
    var nrm = full ? new Float32Array(vertCount * 3) : null;
    var loc = full ? new Float32Array(vertCount * 3) : null;
    var mat = full ? new Float32Array(vertCount) : null;
    var tin = full ? new Float32Array(vertCount * 3) : null;
    var emi = full ? new Float32Array(vertCount) : null;
    var vertexOffset = 0;
    for (var i = 0; i < n; i++) {
      var part = parts[i];
      var scratch = new THREE.BoxGeometry(part.s[0], part.s[1], part.s[2]);
      // aLocal 取变换前的盒内坐标：position 会被旋转/平移污染、跨盒不连续，
      // 而程序化纹理要沿着每个零件自己的轴向铺，密度也不该随盒子大小拉伸。
      if (full) loc.set(scratch.attributes.position.array, vertexOffset * 3);
      var rx = part.t ? (part.t[0] || 0) : 0;
      var rz = part.t ? (part.t[1] || 0) : 0;
      if (rx || rz || part.r) {
        // applyMatrix4 会用 normalMatrix 同步变换 normal，切角后受光依然正确。
        _clusterEuler.set(rx, part.r || 0, rz);
        _clusterMat4.makeRotationFromEuler(_clusterEuler);
        _clusterMat4.setPosition(part.p[0], part.p[1], part.p[2]);
        scratch.applyMatrix4(_clusterMat4);
      } else {
        scratch.translate(part.p[0], part.p[1], part.p[2]);
      }
      pos.set(scratch.attributes.position.array, vertexOffset * 3);
      if (full) nrm.set(scratch.attributes.normal.array, vertexOffset * 3);
      var src = scratch.index.array;
      for (var k = 0; k < src.length; k++) idx[i * 36 + k] = src[k] + vertexOffset;
      if (full) {
        var m = part.m === undefined ? MAT_ARMOR : part.m;
        var g = part.g || 0;
        var col = part.c === undefined ? 0xffffff : part.c;
        var cr = ((col >> 16) & 255) / 255, cg = ((col >> 8) & 255) / 255, cb = (col & 255) / 255;
        for (var v = 0; v < 24; v++) {
          mat[vertexOffset + v] = m;
          emi[vertexOffset + v] = g;
          tin[(vertexOffset + v) * 3] = cr;
          tin[(vertexOffset + v) * 3 + 1] = cg;
          tin[(vertexOffset + v) * 3 + 2] = cb;
        }
      }
      vertexOffset += 24;
      scratch.dispose();                 // 临时几何立即释放，不进账本
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    if (full) {
      out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      out.setAttribute('aLocal', new THREE.BufferAttribute(loc, 3));
      out.setAttribute('aMat', new THREE.BufferAttribute(mat, 1));
      out.setAttribute('aTint', new THREE.BufferAttribute(tin, 3));
      out.setAttribute('aEmis', new THREE.BufferAttribute(emi, 1));
    }
    return track('geometries', out);
  }

  function cluster(parent, parts, material, role) {
    var mesh = new THREE.Mesh(boxClusterGeometry(parts), material);
    setRole(mesh, role || 'structure');
    mesh.name = 'SpaceTravel_' + (role || 'structure');
    parent.add(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------------------
  // 程序化受光着色器
  //
  // 场景里没有任何 Light 实例（地形/生物用的是自己的 Basic 材质与自定义着色器），
  // 所以这里不引入真光源，而是在 GLSL 里手搓一套够用的受光模型：
  // 半球环境光 + wrap 漫反射 + Blinn-Phong 高光 + Fresnel 边缘光，
  // 再叠加基于盒内坐标（aLocal）的三平面程序化纹理做面板线/铆钉/格栅/陶瓷瓦。
  // 这样既拿到了金属与陶瓷的质感差异，又不影响场景里其它任何东西。
  // ---------------------------------------------------------------------------

  // 所有自写 ShaderMaterial 的 uniforms 都登记在这里，applyVisualState 统一推进
  // uTime / uCamPos；clear() 里必须清空，否则会持有已释放材质的引用。
  var shaderUniforms = [];

  var PROGRAM_COMMON = [
    'float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    // 三平面权重：把法线幂次化后归一化，让接缝处过渡自然。
    'vec3 triW(vec3 n){ vec3 w = abs(n); w = w * w * w * w; return w / max(1e-4, w.x + w.y + w.z); }',
    // 面板分割线：返回缝隙遮罩，同时用 out 参数输出倒角高光。
    'float gridSeam(vec2 uv, out float bevel) {',
    '  vec2 f = abs(fract(uv) - 0.5);',
    '  float d = min(f.x, f.y);',
    '  bevel = 1.0 - smoothstep(0.030, 0.090, d);',
    '  return 1.0 - smoothstep(0.0, 0.022, d);',
    '}',
    // 铆钉：格子四角小圆点，约一半格子缺失。
    'float rivets(vec2 uv) {',
    '  vec2 cell = floor(uv), c = fract(uv) - 0.5;',
    '  if (hash21(cell) < 0.45) return 0.0;',
    '  return 1.0 - smoothstep(0.030, 0.062, length(abs(c) - 0.36));',
    '}',
    // 磨损条纹：沿一个方向拉长的斑驳。
    'float streaks(vec2 uv) {',
    '  float n = hash21(floor(vec2(uv.x * 6.0, uv.y)));',
    '  float m = hash21(floor(vec2(uv.x * 6.0 + 3.7, uv.y + 1.3)));',
    '  return smoothstep(0.55, 0.95, n) * (0.35 + 0.65 * (sin(uv.y * 40.0 + m * 30.0) * 0.5 + 0.5));',
    '}',
    'float grille(vec2 uv){ return smoothstep(0.18, 0.34, abs(fract(uv.y * 8.0) - 0.5)); }',
    'float tiles(vec2 uv){ vec2 f = abs(fract(uv * 3.0) - 0.5); return 1.0 - smoothstep(0.0, 0.05, min(f.x, f.y)); }'
  ].join('\n');

  var SHELL_VERT = [
    'attribute vec3 aLocal;',
    'attribute float aMat;',
    'attribute vec3 aTint;',
    'attribute float aEmis;',
    'varying vec3 vNrmW;',
    'varying vec3 vPosW;',
    'varying vec3 vLocal;',
    'varying vec3 vTint;',
    'varying float vMat;',
    'varying float vEmis;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vNrmW = normalize(mat3(modelMatrix) * normal);',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vPosW = wp.xyz;',
    '  vLocal = aLocal; vTint = aTint; vMat = aMat; vEmis = aEmis;',
    '  vec4 mvPosition = viewMatrix * wp;',   // fog_vertex 依赖这个变量名
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}'
  ].join('\n');

  var SHELL_FRAG = [
    'uniform vec3 uBase, uSunDir, uSunColor, uAmbTop, uAmbBot, uRimMetal, uRimCera;',
    'uniform vec3 uEmisColor, uCamPos;',
    'uniform float uSunStr, uAmbStr, uRimStr, uRough, uSpec, uMetal, uEmisGain;',
    'uniform float uTexScale, uWear, uOpacity;',
    'varying vec3 vNrmW;',
    'varying vec3 vPosW;',
    'varying vec3 vLocal;',
    'varying vec3 vTint;',
    'varying float vMat;',
    'varying float vEmis;',
    '#include <fog_pars_fragment>',
    PROGRAM_COMMON,
    'void main() {',
    '  vec3 N = normalize(vNrmW);',
    '  vec3 V = normalize(uCamPos - vPosW);',
    '  vec3 L = normalize(uSunDir);',
    '  vec3 H = normalize(L + V);',
    '  vec3 W = triW(N);',
    '  float sc = uTexScale;',
    // ---- 按材质分区决定表面细节与质感系数 ----
    // 金属度/粗糙度也逐顶点算（而不是走 uniform），这样一个 drawcall 里可以同时
    // 混装装甲板、散热格栅、陶瓷瓦和发光纹路，不用为了质感差异拆成多个 Mesh。
    '  float seam = 0.0, bevelA = 0.0, bevelB = 0.0, bevelC = 0.0, bevel = 0.0;',
    '  float dark = 0.0, roughBias = 0.0, met = 1.0, specMul = 1.0;',
    '  vec2 uvA = vLocal.yz * sc, uvB = vLocal.zx * sc, uvC = vLocal.xy * sc;',
    '  if (vMat < 0.5) {',                                   // ARMOR：面板 + 铆钉
    '    seam = gridSeam(uvA, bevelA) * W.x + gridSeam(uvB, bevelB) * W.y + gridSeam(uvC, bevelC) * W.z;',
    '    dark = (rivets(uvA) * W.x + rivets(uvB) * W.y + rivets(uvC) * W.z) * 0.55;',
    '    bevel = bevelA * W.x + bevelB * W.y + bevelC * W.z;',
    '    roughBias = -0.10; met = 1.00; specMul = 0.85;',
    '  } else if (vMat < 1.5) {',                            // STRUCT：细面板 + 重磨损
    '    seam = gridSeam(uvA * 2.0, bevelA) * W.x + gridSeam(uvB * 2.0, bevelB) * W.y + gridSeam(uvC * 2.0, bevelC) * W.z;',
    '    dark = (streaks(uvA) * W.x + streaks(uvB) * W.y + streaks(uvC) * W.z) * uWear;',
    '    bevel = bevelA * W.x + bevelB * W.y + bevelC * W.z;',
    '    roughBias = 0.25; met = 0.85; specMul = 0.35;',
    '  } else if (vMat < 2.5) {',                            // VENT：格栅 + 缝隙内暗腔
    '    float g = grille(uvA) * W.x + grille(uvB) * W.y + grille(uvC) * W.z;',
    '    dark = (1.0 - g) * 0.85; roughBias = 0.45; met = 0.90; specMul = 0.25;',
    '  } else if (vMat < 3.5) {',                            // CERAMIC：细密瓦片
    '    seam = tiles(uvA) * W.x + tiles(uvB) * W.y + tiles(uvC) * W.z;',
    '    dark = streaks(uvA * 0.5) * uWear * 0.4; roughBias = 0.05; met = 0.05; specMul = 1.00;',
    '  } else if (vMat < 4.5) {',                            // ENERGY
    '    bevel = 1.0; roughBias = -0.50; met = 0.00; specMul = 0.00;',
    '  } else {',                                            // GRATE
    '    float g = grille(uvA * 0.5) * W.x + grille(uvC * 0.5) * W.z;',
    '    dark = (1.0 - g) * 0.7; roughBias = 0.40; met = 0.90; specMul = 0.30;',
    '  }',
    '  float rgh = clamp(uRough + roughBias, 0.0, 1.0);',
    // ---- 受光 ----
    '  float hemi = N.y * 0.5 + 0.5;',
    '  vec3 ambient = mix(uAmbBot, uAmbTop, hemi) * uAmbStr;',
    '  float wrap = clamp(dot(N, L) * 0.55 + 0.45, 0.0, 1.0);',  // 背光不死黑
    '  float ndl = max(dot(N, L), 0.0);',
    '  vec3 baseCol = uBase * vTint * (1.0 - dark * 0.55);',
    '  vec3 diffCol = mix(baseCol, baseCol * 0.22, met);',        // 金属压暗漫反射
    '  vec3 specCol = mix(vec3(1.0), baseCol, met);',             // 金属高光染基色
    '  float shin = mix(14.0, 96.0, 1.0 - rgh);',
    '  float spec = pow(max(dot(N, H), 0.0), shin) * (1.0 - rgh * 0.85) * uSpec * specMul;',
    '  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);',
    '  vec3 rim = mix(uRimCera, uRimMetal, met) * fres * uRimStr;',
    '  vec3 col = ambient * diffCol',
    '           + uSunColor * (diffCol * mix(wrap, ndl, 0.35) + specCol * spec) * uSunStr',
    '           + rim;',
    '  col += uSunColor * bevel * 0.10 * (0.4 + 0.6 * ndl) * (1.0 - met * 0.5);',
    '  col *= 1.0 - seam * 0.45;',
    // ---- 自发光：颜色取分区色，亮度乘增益超过 1.0，供 Bloom 高阈值拾取 ----
    '  col += uEmisColor * vTint * vEmis * uEmisGain;',
    '  gl_FragColor = vec4(col, uOpacity);',
    '  #include <fog_fragment>',
    '}'
  ].join('\n');

  var GLASS_VERT = [
    'varying vec3 vNrmW;',
    'varying vec3 vPosW;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vNrmW = normalize(mat3(modelMatrix) * normal);',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vPosW = wp.xyz;',
    '  vec4 mvPosition = viewMatrix * wp;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}'
  ].join('\n');

  var GLASS_FRAG = [
    'uniform vec3 uSunDir, uSunColor, uGlassDeep, uGlassRim, uCamPos;',
    'uniform float uOpacity, uSpec;',
    'varying vec3 vNrmW;',
    'varying vec3 vPosW;',
    '#include <fog_pars_fragment>',
    'void main() {',
    '  vec3 N = normalize(vNrmW);',
    '  vec3 V = normalize(uCamPos - vPosW);',
    '  if (dot(N, V) < 0.0) N = -N;',                          // 薄壳玻璃：从内侧直视按正面算，避免整面磨砂发白
    '  vec3 H = normalize(normalize(uSunDir) + V);',
    '  float f = pow(1.0 - max(dot(N, V), 0.0), 2.5);',        // 菲涅尔
    '  float s = pow(max(dot(N, H), 0.0), 140.0) * uSpec;',    // 窄高光
    '  vec3 col = mix(uGlassDeep, uGlassRim, f) + uSunColor * s;',
    '  gl_FragColor = vec4(col, uOpacity * (0.30 + 0.70 * f));', // 边缘更不透明
    '  #include <fog_fragment>',
    '}'
  ].join('\n');

  var VORTEX_VERT = [
    'varying vec2 vUv;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vUv = uv;',
    '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}'
  ].join('\n');

  var VORTEX_FRAG = [
    'uniform float uTime, uGain, uOpacity;',
    'uniform vec3 uColorA, uColorB;',
    'varying vec2 vUv;',
    '#include <fog_pars_fragment>',
    'float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'void main() {',
    '  vec2 p = vUv * 2.0 - 1.0;',
    '  float r = length(p), a = atan(p.y, p.x);',
    '  float swirl = a + uTime * 1.6 - 3.0 / max(r, 0.12);',   // 漩涡：相位随半径扭曲
    '  float rings = sin(r * 14.0 - uTime * 3.0) * 0.5 + 0.5;', // 同心能量环
    '  float spokes = sin(swirl * 6.0) * 0.5 + 0.5;',          // 放射状流线
    '  float grain = hash21(floor(vec2(swirl * 3.0, r * 9.0 - uTime * 1.2)));',
    '  float core = 1.0 - smoothstep(0.0, 1.0, r);',
    '  float lip = smoothstep(0.86, 1.0, r);',                 // 外缘收口
    '  float e = core * (0.55 + 0.45 * rings) * (0.60 + 0.40 * spokes);',
    '  e += lip * (0.35 + 0.65 * grain) * 0.8;',
    '  e *= 1.0 - smoothstep(0.965, 1.0, r);',                 // 圆形硬边
    '  vec3 col = mix(uColorA, uColorB, clamp(rings * 0.7 + spokes * 0.3, 0.0, 1.0));',
    '  gl_FragColor = vec4(col * e * uGain, e * uOpacity);',   // uGain > 1 → HDR
    '  #include <fog_fragment>',
    '}'
  ].join('\n');

  // 受光方向与环境色：模拟"恒星主光 + 行星反照"的太空环境，与场景零光源无关。
  var SHELL_LIGHT = {
    sunDir: new THREE.Vector3(0.42, 0.78, 0.46).normalize(),
    sunColor: new THREE.Color(0xfff2d8),
    ambTop: new THREE.Color(0x2b3f66),   // 天顶：冷色深空
    ambBot: new THREE.Color(0x241d18),   // 地面：行星反照的暖色
    rimMetal: new THREE.Color(0x7fa8d8),
    rimCera: new THREE.Color(0xc9d8e8)
  };

  // 质感预设只调整体"新旧程度"与边缘光强度；金属/陶瓷的硬差异由 aMat 分区决定。
  var SHELL_PRESETS = {
    armor: { rough: 0.42, spec: 1.0, rimStr: 0.55, wear: 0.35 },
    struct: { rough: 0.55, spec: 1.0, rimStr: 0.35, wear: 0.85 },
    ceramic: { rough: 0.30, spec: 1.0, rimStr: 0.22, wear: 0.20 }
  };

  // 自发光增益：让能量纹路的亮度超过 1.0，Bloom 的高阈值就能只挑中它们。
  var HDR_GAIN = 2.6;

  function shellMaterial(presetName, options) {
    options = options || {};
    var p = SHELL_PRESETS[presetName] || SHELL_PRESETS.armor;
    var uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uBase: { value: new THREE.Color(options.base === undefined ? 0xffffff : options.base) },
        uSunDir: { value: SHELL_LIGHT.sunDir.clone() },
        uSunColor: { value: SHELL_LIGHT.sunColor.clone() },
        uAmbTop: { value: SHELL_LIGHT.ambTop.clone() },
        uAmbBot: { value: SHELL_LIGHT.ambBot.clone() },
        uRimMetal: { value: SHELL_LIGHT.rimMetal.clone() },
        uRimCera: { value: SHELL_LIGHT.rimCera.clone() },
        uEmisColor: { value: new THREE.Color(options.emissive === undefined ? 0xffffff : options.emissive) },
        uCamPos: { value: new THREE.Vector3() },
        uSunStr: { value: 1.15 },
        uAmbStr: { value: 1.0 },
        uRimStr: { value: p.rimStr },
        uRough: { value: p.rough },
        uSpec: { value: p.spec },
        uEmisGain: { value: HDR_GAIN },
        uTexScale: { value: finite(options.texScale, 1.0, 0.1, 8) },
        uWear: { value: p.wear },
        uOpacity: { value: 1 }
      }
    ]);
    var mat = track('materials', new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
      // r128 的 ShaderMaterial.fog 默认是 false，且必须同时有 scene.fog 才会定义 USE_FOG。
      fog: true,
      transparent: !!options.transparent,
      opacity: 1,
      depthWrite: options.depthWrite === undefined ? true : !!options.depthWrite,
      side: options.side === undefined ? THREE.FrontSide : options.side
    }));
    shaderUniforms.push(uniforms);
    return mat;
  }

  function glassMaterial(options) {
    options = options || {};
    var uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSunDir: { value: SHELL_LIGHT.sunDir.clone() },
        uSunColor: { value: SHELL_LIGHT.sunColor.clone() },
        uGlassDeep: { value: new THREE.Color(options.deep === undefined ? 0x123a55 : options.deep) },
        uGlassRim: { value: new THREE.Color(options.rim === undefined ? 0x6bdcff : options.rim) },
        uCamPos: { value: new THREE.Vector3() },
        uOpacity: { value: finite(options.opacity, 0.46, 0, 1) },
        uSpec: { value: 0.9 }
      }
    ]);
    var mat = track('materials', new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: GLASS_VERT,
      fragmentShader: GLASS_FRAG,
      fog: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    }));
    shaderUniforms.push(uniforms);
    return mat;
  }

  function vortexMaterial(accent, options) {
    options = options || {};
    var c = new THREE.Color(accent);
    var uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uGain: { value: finite(options.gain, HDR_GAIN, 0, 12) },
        uOpacity: { value: finite(options.opacity, 0.85, 0, 1) },
        uColorA: { value: c.clone() },
        uColorB: { value: c.clone().offsetHSL(0.08, -0.25, 0.22) }
      }
    ]);
    var mat = track('materials', new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: VORTEX_VERT,
      fragmentShader: VORTEX_FRAG,
      fog: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    }));
    shaderUniforms.push(uniforms);
    return mat;
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

  // 把一组零件沿 YZ 平面镜像：位置和绕 Y 的偏航取反，绕 Z 的切角也取反。
  // 不能直接给 Mesh 用 scale.x = -1，那会翻转法线、把受光算反。
  function mirrorPartsX(parts) {
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var q = parts[i];
      out.push({
        s: q.s,
        p: [-q.p[0], q.p[1], q.p[2]],
        r: q.r ? -q.r : 0,
        t: q.t ? [q.t[0], -q.t[1]] : undefined,
        m: q.m, c: q.c, g: q.g
      });
    }
    return out;
  }

  // 建一个"位置在原点"的合批零件，方便之后直接改 mesh.position 做动画。
  // 不能直接拿 box()：它的 BoxGeometry 没有着色器需要的 aLocal/aMat/aTint/aEmis，
  // 缺了 aTint 会让基色变成全黑。
  function shellPart(parent, parts, material, role, detail) {
    var mesh = new THREE.Mesh(boxClusterGeometry(parts), material);
    setRole(mesh, role, detail);
    mesh.name = 'SpaceTravel_' + (role || 'structure');
    parent.add(mesh);
    return mesh;
  }

  function makeShip() {
    var g = setRole(new THREE.Group(), 'ship-root');
    g.name = 'SpaceShip';
    shipParts = { engines: [], door: null, ramp: null };
    var P = SHIP_PALETTE;
    var hullMat = shellMaterial('armor', { base: 0xffffff });
    var structMat = shellMaterial('struct', { base: 0xffffff });
    var ceramicMat = shellMaterial('ceramic', { base: 0xffffff });

    // ---- 船体：20 个盒子合成一个 drawcall ----
    // 包络约束 x±5.8 / y 0..3.15 / z -6.2..5.05，下面每个坐标都核算过极值。
    cluster(g, [
      { s: [3.5, 0.9, 6.6], p: [0, 1.60, 0.3], m: MAT_ARMOR, c: P.hull },
      { s: [2.8, 0.62, 2.2], p: [0, 1.70, -3.6], t: [0.06, 0], m: MAT_ARMOR, c: P.hull },
      { s: [2.5, 0.5, 7.5], p: [0, 0.95, 0.5], m: MAT_STRUCT, c: P.keel },
      { s: [1.8, 0.4, 1.8], p: [0, 1.00, -4.0], t: [0.06, 0], m: MAT_STRUCT, c: P.keel },
      { s: [0.62, 0.62, 6.4], p: [1.92, 1.26, 0.4], t: [0, 0.62], m: MAT_ARMOR, c: P.hullDark },
      { s: [0.62, 0.62, 6.4], p: [-1.92, 1.26, 0.4], t: [0, -0.62], m: MAT_ARMOR, c: P.hullDark },
      { s: [0.72, 0.4, 4.8], p: [0, 2.14, 0.9], m: MAT_ARMOR, c: P.hullLit },
      { s: [0.5, 0.28, 1.6], p: [0, 2.08, -2.3], t: [0.10, 0], m: MAT_ARMOR, c: P.hullLit },
      { s: [2.0, 0.12, 2.4], p: [0, 0.70, 1.3], m: MAT_VENT, c: P.vent },
      { s: [1.6, 0.12, 1.5], p: [0, 0.70, -1.1], m: MAT_VENT, c: P.vent },
      // 青色侧舷灯带：原来在 y=1.48，被侧脊（x 1.49~2.35、y 0.83~1.69）整个吞掉，
      // 实测可见面 0%。挪到 y=1.95（侧脊之上、导管束之上）并加粗到 0.10×0.12，可见面 61%。
      { s: [0.10, 0.12, 4.6], p: [1.79, 1.95, 0.30], m: MAT_ENERGY, c: P.glowCyan, g: 1 },
      { s: [0.10, 0.12, 4.6], p: [-1.79, 1.95, 0.30], m: MAT_ENERGY, c: P.glowCyan, g: 1 },
      { s: [2.9, 0.85, 0.55], p: [0, 1.55, 3.35], m: MAT_STRUCT, c: P.keel },
      { s: [1.3, 0.55, 3.6], p: [2.05, 1.10, 1.5], t: [0, -0.12], m: MAT_ARMOR, c: P.fin },
      { s: [1.3, 0.55, 3.6], p: [-2.05, 1.10, 1.5], t: [0, 0.12], m: MAT_ARMOR, c: P.fin },
      { s: [0.9, 0.22, 1.2], p: [0, 2.05, 2.6], t: [0.12, 0], m: MAT_ARMOR, c: P.hullLit },
      // 尾部结构块：原来在 z=3.0，整个埋在机身主盒（z≤3.6）里，可见面 0%。后移到 z=3.85。
      { s: [3.2, 0.3, 1.0], p: [0, 1.28, 3.85], t: [0.14, 0], m: MAT_STRUCT, c: P.keel },
      // 琥珀色导航灯：原来在 [±1.55, 1.30, 3.7]，被引擎短舱（x 1.08~2.08）吞掉，可见面 0%。
      // 挪到短舱顶后段，可见面 65%。
      { s: [0.14, 0.14, 0.9], p: [1.58, 1.66, 4.30], m: MAT_ENERGY, c: P.glowAmber, g: 1 },
      { s: [0.14, 0.14, 0.9], p: [-1.58, 1.66, 4.30], m: MAT_ENERGY, c: P.glowAmber, g: 1 },
      { s: [2.2, 0.16, 0.8], p: [0, 0.62, 3.2], m: MAT_VENT, c: P.vent },
      // ---- 表面导管束：上下各两路并排细管纵贯全机长，走 MAT_STRUCT 哑光金属 ----
      // 取位要点：船体主盒 x 到 ±1.75，侧脊盖到 x 2.23 但只到 y 1.57，
      // 所以上部导管放 x=±1.79 且 y≥1.72 才露在外面；腹部导管放 x=±1.35，
      // 正好卡在龙骨（x≤1.25）与翼根整流（x≥1.40）之间的空隙。
      { s: [0.09, 0.09, 5.8], p: [1.79, 1.72, 0.30], m: MAT_STRUCT, c: P.conduit },
      { s: [0.07, 0.07, 5.8], p: [1.79, 1.84, 0.30], m: MAT_STRUCT, c: P.conduit },
      { s: [0.09, 0.09, 5.8], p: [-1.79, 1.72, 0.30], m: MAT_STRUCT, c: P.conduit },
      { s: [0.07, 0.07, 5.8], p: [-1.79, 1.84, 0.30], m: MAT_STRUCT, c: P.conduit },
      { s: [0.09, 0.09, 6.8], p: [1.35, 0.95, 0.50], m: MAT_STRUCT, c: P.conduit },
      { s: [0.07, 0.07, 6.8], p: [1.35, 0.86, 0.50], m: MAT_STRUCT, c: P.conduit },
      { s: [0.09, 0.09, 6.8], p: [-1.35, 0.95, 0.50], m: MAT_STRUCT, c: P.conduit },
      { s: [0.07, 0.07, 6.8], p: [-1.35, 0.86, 0.50], m: MAT_STRUCT, c: P.conduit },
      // ---- 卡箍：每隔一段把导管束固定在船体上 ----
      { s: [0.15, 0.15, 0.10], p: [1.79, 1.72, -1.60], m: MAT_STRUCT, c: P.clamp },
      { s: [0.15, 0.15, 0.10], p: [1.79, 1.72, 1.60], m: MAT_STRUCT, c: P.clamp },
      { s: [0.15, 0.15, 0.10], p: [-1.79, 1.72, -1.60], m: MAT_STRUCT, c: P.clamp },
      { s: [0.15, 0.15, 0.10], p: [-1.79, 1.72, 1.60], m: MAT_STRUCT, c: P.clamp }
    ], hullMat, 'ship-hull');

    // ---- 机鼻：陶瓷隔热瓦，阶梯收窄到鼻尖 ----
    var nose = cluster(g, [
      { s: [2.4, 0.55, 1.4], p: [0, 1.66, -4.7], t: [0.10, 0], m: MAT_CERAMIC, c: P.ceramic },
      { s: [1.7, 0.45, 1.1], p: [0, 1.58, -5.45], t: [0.14, 0], m: MAT_CERAMIC, c: 0xe4ecf3 },
      { s: [0.95, 0.32, 0.8], p: [0, 1.50, -5.72], t: [0.16, 0], m: MAT_CERAMIC, c: P.ceramicLit },
      { s: [1.5, 0.3, 1.6], p: [0, 0.95, -4.9], t: [0.08, 0], m: MAT_CERAMIC, c: 0xaebccd },
      { s: [0.12, 0.12, 1.2], p: [0, 1.42, -5.85], t: [0.14, 0], m: MAT_ENERGY, c: 0x9be8ff, g: 0.8 },
      { s: [0.34, 0.26, 0.5], p: [0.55, 1.30, -4.6], m: MAT_CERAMIC, c: P.ceramicDark },
      { s: [0.34, 0.26, 0.5], p: [-0.55, 1.30, -4.6], m: MAT_CERAMIC, c: P.ceramicDark }
    ], ceramicMat, 'ship-nose');

    // ---- 座舱：菲涅尔玻璃，边缘更不透明 ----
    // 注意：COCKPIT_LOCAL=[0,2.53,-1.45] 是硬契约，驾驶位眼睛就坐在这个高度。
    // 座舱框绝不能在眼位前方（z<-1.45 一侧）放 y<=2.66 的实心装甲，
    // 否则下半屏会被装甲内壁糊死（21b1649 曾因此挡掉整个前向视野）。
    cluster(g, [
      { s: [1.9, 0.62, 2.2], p: [0, 2.32, -1.15], t: [0.05, 0], m: MAT_ARMOR, c: 0x2a3550 },
      { s: [0.14, 0.62, 2.2], p: [0.88, 2.32, -1.15], m: MAT_ARMOR, c: 0x35486c },
      { s: [0.14, 0.62, 2.2], p: [-0.88, 2.32, -1.15], m: MAT_ARMOR, c: 0x35486c },
      { s: [1.9, 0.12, 0.16], p: [0, 2.62, -0.10], m: MAT_ARMOR, c: 0x35486c }
    ], hullMat, 'ship-canopy-frame');
    cluster(g, [
      { s: [1.72, 0.50, 2.05], p: [0, 2.34, -1.18], t: [0.05, 0], m: MAT_ARMOR, c: 0xffffff },
      { s: [1.22, 0.32, 0.98], p: [0, 2.47, -2.28], t: [0.16, 0], m: MAT_ARMOR, c: 0xffffff }
    ], glassMaterial({ deep: 0x0d2a44, rim: 0x7fe0ff, opacity: 0.52 }), 'ship-canopy');

    // ---- 机翼：后掠梯形 + 翼尖小翼，左右各一个 Mesh（测试断言 wing===2）----
    var wingParts = [
      // 翼根轴承座：翼面插进机身的位置，做出可动关节的机械感。
      // y 必须 ≥1.77 —— 该处（x=1.98）机身外表面在 y=1.68，放低了会被鳍整流罩整个埋掉。
      { s: [0.44, 0.34, 0.52], p: [1.98, 1.77, 1.05], m: MAT_ARMOR, c: P.joint },
      { s: [2.6, 0.18, 1.9], p: [3.05, 1.14, 1.05], t: [0, -0.06], r: 0.30, m: MAT_ARMOR, c: 0x2f405f },
      { s: [1.7, 0.16, 1.2], p: [4.35, 1.10, 1.95], t: [0, -0.06], r: 0.30, m: MAT_ARMOR, c: 0x2f405f },
      { s: [0.16, 0.50, 1.0], p: [4.95, 1.34, 2.40], m: MAT_ARMOR, c: 0x3a4d70 },
      { s: [0.9, 0.14, 0.7], p: [3.05, 1.06, 2.35], t: [0, -0.06], r: 0.30, m: MAT_STRUCT, c: 0x1e2a44 },
      // 翼根整流罩：原来 s=[0.5,0.2,1.6] 几乎全埋在机翼主盒里（可见面 1.9%）。
      // 加厚到 0.44 并外移到 x=2.55，让它从翼面上下鼓出来，可见面 33%。
      { s: [0.52, 0.44, 1.6], p: [2.55, 1.12, 0.40], t: [0, -0.06], r: 0.30, m: MAT_ARMOR, c: 0x2f405f },
      { s: [0.10, 0.06, 1.4], p: [3.20, 1.24, 1.00], r: 0.30, m: MAT_ENERGY, c: P.glowCyan, g: 0.9 }
    ];
    cluster(g, wingParts, hullMat, 'ship-wing');
    cluster(g, mirrorPartsX(wingParts), hullMat, 'ship-wing');

    // ---- 尾翼：水平安定面 + 垂尾 + 端板 ----
    cluster(g, [
      // 水平安定面：原来在 y=1.58，整个埋在机身主盒（y 1.15~2.05、z≤3.6）里，可见面 0%。
      // 抬到 y=2.16 —— 机身顶面在 y=2.05，留 0.03 缝隙既贴合又不共面（共面会 z-fighting）。
      { s: [3.4, 0.16, 1.3], p: [0, 2.16, 3.15], t: [0.06, 0], m: MAT_ARMOR, c: 0x33456a },
      { s: [0.20, 1.25, 1.5], p: [0, 2.20, 3.05], m: MAT_ARMOR, c: 0x3a4d70 },
      // 安定面根部整流块：跟着安定面抬上去，坐在机背与安定面之间
      { s: [1.1, 0.30, 0.9], p: [0, 2.24, 2.50], t: [0.10, 0], m: MAT_STRUCT, c: P.keel },
      { s: [0.60, 0.26, 0.8], p: [0, 1.55, 3.85], t: [0.16, 0], m: MAT_STRUCT, c: P.keel },
      { s: [0.70, 0.34, 1.0], p: [0, 2.05, 1.40], t: [0.10, 0], m: MAT_ARMOR, c: P.hullLit },
      { s: [0.10, 0.06, 1.1], p: [0, 2.82, 3.05], m: MAT_ENERGY, c: 0x9be8ff, g: 1 },
      // 安定面端板：跟着安定面抬到 y=2.16（原来 1.56 时可见面只有 3.7%）
      { s: [0.50, 0.16, 0.6], p: [1.35, 2.16, 3.30], t: [0, 0.50], m: MAT_ARMOR, c: 0x2f405f },
      { s: [0.50, 0.16, 0.6], p: [-1.35, 2.16, 3.30], t: [0, -0.50], m: MAT_ARMOR, c: 0x2f405f },
      // 垂尾转轴耳片：夹在垂尾（x ±0.10）两侧。y 要在 2.34 以上 ——
      // 垂尾根部那一段机身外表面到 y=2.34，放低了会被机身吞掉。
      { s: [0.14, 0.26, 0.34], p: [0.16, 2.50, 3.05], m: MAT_ARMOR, c: P.joint },
      { s: [0.14, 0.26, 0.34], p: [-0.16, 2.50, 3.05], m: MAT_ARMOR, c: P.joint },
      // 水平安定面枢轴：坐在安定面上表面（y=2.24）之上，抬高 0.02 避共面。
      // z 取 3.70 是因为机身只到 z=3.63；x 取 ±0.62 是为了避开垂尾（x ±0.10）又别太靠外。
      { s: [0.30, 0.24, 0.22], p: [0.62, 2.38, 3.70], m: MAT_ARMOR, c: P.joint },
      { s: [0.30, 0.24, 0.22], p: [-0.62, 2.38, 3.70], m: MAT_ARMOR, c: P.joint }
    ], hullMat, 'ship-tail');

    // ---- 引擎短舱：短舱 + 进气环 + 挂架 + 喷口 ----
    var engineParts = [
      { s: [1.00, 0.78, 2.30], p: [1.58, 1.22, 3.35], m: MAT_ARMOR, c: P.hullDark },
      // 进气环：原来 1.14×0.90 大半埋在短舱（1.0×0.78）里，可见面 13%。
      // 放大到 1.30×1.06，让它比短舱粗一圈、从上下缘露出来，可见面 20%。
      { s: [1.30, 1.06, 0.40], p: [1.58, 1.22, 2.35], m: MAT_STRUCT, c: P.keel },
      { s: [0.14, 0.14, 0.90], p: [2.16, 1.30, 3.35], m: MAT_STRUCT, c: P.keel },
      // 挂架尾端接头：卡在挂架靠后那一端（挂架 z 2.90~3.80）。
      // 曾因"挂架被埋"而砍掉 —— 那是中心射线只看 ±X/±Y 的误判，表面采样实测可见面 50%。
      { s: [0.26, 0.26, 0.22], p: [2.16, 1.30, 3.90], m: MAT_ARMOR, c: P.joint },
      { s: [0.95, 0.62, 0.22], p: [1.58, 1.22, 4.60], m: MAT_VENT, c: P.vent }
    ];
    cluster(g, engineParts, hullMat, 'ship-engine');
    cluster(g, mirrorPartsX(engineParts), hullMat, 'ship-engine');

    // ---- 引擎辉光：保持 MeshBasicMaterial，沿用 opacity/scale 脉冲动画 ----
    // 颜色分量乘以增益超过 1.0（THREE.Color 不 clamp），Bloom 的高阈值就能只挑中它。
    var glowGeo = track('geometries', new THREE.BoxGeometry(0.86, 0.62, 0.18));
    var glowMat = track('materials', new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x8ff6ff).multiplyScalar(HDR_GAIN),
      transparent: true, opacity: 0.82, depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    [-1, 1].forEach(function (side) {
      var glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(side * 1.58, 1.22, 4.78);
      setRole(glow, 'ship-engine-glow', side < 0 ? 'left' : 'right');
      glow.name = 'SpaceTravel_ship-engine-glow';
      g.add(glow);
      shipParts.engines.push(glow);
    });

    // ---- 起落架：一份合批几何 + 4 个 Mesh ----
    // 测试断言 byRole['ship-landing-gear'] === 4，所以必须是 4 个独立 Mesh；
    // 但共享同一份 geometry/material，账本里只记 1 个。
    var gearGeo = boxClusterGeometry([
      // 支柱 + 脚垫 + 顶端铰接轴环（比支柱略粗，露出一圈才读得出关节）
      { s: [0.26, 0.62, 0.26], p: [0, 0.42, 0], m: MAT_STRUCT, c: 0x78879a },
      { s: [0.34, 0.14, 0.34], p: [0, 0.70, 0], m: MAT_ARMOR, c: P.joint },
      { s: [0.52, 0.12, 0.52], p: [0, 0.06, 0], m: MAT_STRUCT, c: 0x5b6a7d }
    ]);
    GEAR_LOCAL.forEach(function (v, i) {
      var gear = new THREE.Mesh(gearGeo, structMat);
      gear.position.set(v[0], v[1], v[2]);
      setRole(gear, 'ship-landing-gear', 'gear-' + i);
      gear.name = 'SpaceTravel_ship-landing-gear';
      g.add(gear);
    });

    // ---- 舱门与坡道：位置烘焙为原点，靠 mesh.position 做开合动画 ----
    shipParts.door = shellPart(g, [
      { s: [0.16, 1.30, 1.70], p: [0, 0, 0], m: MAT_ARMOR, c: P.hullDark },
      { s: [0.05, 0.10, 1.40], p: [0.10, 0.45, 0], m: MAT_ENERGY, c: P.glowCyan, g: 0.8 },
      { s: [0.05, 0.10, 1.40], p: [0.10, -0.45, 0], m: MAT_ENERGY, c: P.glowCyan, g: 0.8 }
    ], hullMat, 'ship-door', 'starboard');
    shipParts.door.position.set(2.24, 1.56, 0.5);
    shipParts.door.userData.baseY = shipParts.door.position.y;

    shipParts.ramp = shellPart(g, [
      { s: [1.8, 0.12, 1.55], p: [0, 0, 0], m: MAT_GRATE, c: 0x71839a }
    ], structMat, 'ship-ramp', 'starboard');
    shipParts.ramp.position.set(2.34, 0.32, 0.5);
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

  // 把 #rgb / #rrggbb 之类的强调色转成整数，供合批的分区色 c 使用。
  function accentInt(v) {
    var s = safeAccent(v).slice(1);
    if (s.length === 3)
      s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    var n = parseInt(s.slice(0, 6), 16);
    return isFinite(n) ? n : 0x8df7ff;
  }

  // 传送门的三个"通用"几何在所有门之间共享，只构建一次：
  // 同一份 geometry 被多个 Mesh 复用，账本里只记一次。
  // 门框几何不能共享——它把每扇门的 accent 色烘焙进了 aTint 顶点属性。
  function portalShared() {
    if (portalGeoCache) return portalGeoCache;
    portalGeoCache = {
      ring: track('geometries', new THREE.TorusGeometry(1.68, 0.15, 6, 16)),
      inner: track('geometries', new THREE.TorusGeometry(1.16, 0.05, 4, 12)),
      core: track('geometries', new THREE.CircleGeometry(1.42, 20)),
      frameMat: shellMaterial('struct', { base: 0xffffff })
    };
    return portalGeoCache;
  }

  function makePortal(p, dest) {
    var g = setRole(new THREE.Group(), 'portal-root');
    var shared = portalShared();
    // 必须自己取一次调色板别名：makeShip 里的 var P = SHIP_PALETTE 是函数内局部的，
    // 这里直接用 P 会 ReferenceError，而且因为 makePortal 在 loadWorld 里被调用、
    // 异常会被上层吞掉，表现是"传送门一个都不出现"却没有任何报错，极难定位。
    var P = SHIP_PALETTE;
    var accent = accentInt(dest && dest.accent);
    var accentColor = new THREE.Color(accent);

    // ---- 门框：13 个盒子合成一个 drawcall（底座/双柱/斜撑/顶梁/灯带/散热片）----
    // 外形严格控制在 conservativePortalBounds 内：半宽 ≤2.10 < 2.7，局部顶 ≤5.25。
    cluster(g, [
      { s: [0.50, 3.90, 0.50], p: [-1.72, 1.95, 0], m: MAT_STRUCT, c: 0x20283b },
      { s: [0.50, 3.90, 0.50], p: [1.72, 1.95, 0], m: MAT_STRUCT, c: 0x20283b },
      { s: [4.10, 0.46, 0.80], p: [0, 4.06, 0], m: MAT_ARMOR, c: 0x33415f },
      { s: [3.60, 0.10, 0.10], p: [0, 3.78, 0.42], m: MAT_ENERGY, c: accent, g: 0.9 },
      { s: [0.95, 0.30, 0.95], p: [-1.72, 0.15, 0], m: MAT_STRUCT, c: 0x1a2133 },
      { s: [0.95, 0.30, 0.95], p: [1.72, 0.15, 0], m: MAT_STRUCT, c: 0x1a2133 },
      { s: [4.20, 0.16, 1.10], p: [0, 0.08, 0], m: MAT_STRUCT, c: 0x1a2133 },
      // 斜撑：x 必须取 ±1.30 而不是 ±1.72 —— 立柱占 x 1.47~1.97，贴在立柱上会被整个吞掉。
      // 往内侧挪之后（含 0.34 切角撑开到 x 0.95~1.65）会从门洞内侧露出来。
      { s: [0.22, 1.50, 0.22], p: [-1.30, 3.10, 0], t: [0, 0.34], m: MAT_STRUCT, c: 0x20283b },
      { s: [0.22, 1.50, 0.22], p: [1.30, 3.10, 0], t: [0, -0.34], m: MAT_STRUCT, c: 0x20283b },
      { s: [0.14, 0.90, 0.14], p: [0, 4.75, 0], m: MAT_STRUCT, c: 0x2a3550 },
      { s: [0.26, 0.26, 0.26], p: [0, 5.05, 0], m: MAT_ENERGY, c: accent, g: 1 },
      // 散热片：进深给到 0.62（立柱是 0.50），前后各凸出 0.06。
      // 之前和立柱前表面精确共面（都是 z ±0.25），既看不见又会 z-fighting 闪。
      { s: [0.30, 1.20, 0.62], p: [-1.72, 1.20, 0], m: MAT_VENT, c: 0x2a3348 },
      { s: [0.30, 1.20, 0.62], p: [1.72, 1.20, 0], m: MAT_VENT, c: 0x2a3348 },
      // ---- 立柱走线与柱顶关节：和飞船用同一套"管线 / 机械关节"的造型语言，保证风格统一 ----
      // 导管贴在立柱正面（立柱 z ±0.25，导管到 0.265~0.335），实测可见面 43%。
      // 内/外侧都试过：内侧只有 22%，外侧虽 50% 但会顶到 2.10 的半宽上限，所以取正面。
      { s: [0.07, 3.60, 0.07], p: [-1.72, 2.00, 0.30], m: MAT_STRUCT, c: P.conduit },
      { s: [0.07, 3.60, 0.07], p: [1.72, 2.00, 0.30], m: MAT_STRUCT, c: P.conduit },
      // 柱顶关节：立柱与顶梁的接合处，顶梁下沿在 y=3.83，所以卡在 3.56~3.80
      { s: [0.62, 0.24, 0.62], p: [-1.72, 3.68, 0], m: MAT_ARMOR, c: P.joint },
      { s: [0.62, 0.24, 0.62], p: [1.72, 3.68, 0], m: MAT_ARMOR, c: P.joint }
    ], shared.frameMat, 'portal-frame');

    // ---- 内外双环：外环正向、内环反向，制造齿轮般的相对转动 ----
    // 颜色分量乘增益超过 1.0，配合 AdditiveBlending 形成可被 Bloom 拾取的亮环。
    // 增益统一取 HDR_GAIN，和飞船引擎/能量纹路同一个标准：实测外环是门上辉光的
    // 主要来源（1.8 只有 0.71% 画面被提亮，2.2 就有 1.85%），核心增益则几乎无感。
    var ringMat = track('materials', new THREE.MeshBasicMaterial({
      color: accentColor.clone().multiplyScalar(HDR_GAIN),
      transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    var ring = setRole(new THREE.Mesh(shared.ring, ringMat), 'portal-ring');
    ring.name = 'SpaceTravel_portal-ring';
    ring.position.y = 2.05;
    g.add(ring);

    var inner = setRole(new THREE.Mesh(shared.inner, ringMat), 'portal-ring-inner');
    inner.name = 'SpaceTravel_portal-ring-inner';
    inner.position.y = 2.05;
    g.add(inner);

    // ---- 能量核心：同心涡流 + 放射流线，全部在 GLSL 里算 ----
    var field = setRole(new THREE.Mesh(
      shared.core,
      vortexMaterial(accentColor, { gain: HDR_GAIN, opacity: 0.85 })
    ), 'portal-field');
    field.name = 'SpaceTravel_portal-field';
    field.position.y = 2.05;
    g.add(field);

    var key = String(p && p.id || 'portal');
    var hash = 2166136261 >>> 0;
    for (var hi = 0; hi < key.length; hi++)
      hash = Math.imul((hash ^ key.charCodeAt(hi)) >>> 0, 16777619) >>> 0;
    g.userData = {
      role: 'portal-root', portal: p, ring: ring, inner: inner, field: field,
      core: field, destination: dest,
      spinPhase: (hash / 4294967296) * Math.PI * 2,
      spinRate: (hash & 1) ? -0.8 : 0.8
    };
    animatedRings.push({ mesh: ring, phase: g.userData.spinPhase, rate: g.userData.spinRate });
    animatedRings.push({ mesh: inner, phase: -g.userData.spinPhase, rate: -g.userData.spinRate * 1.7 });
    return g;
  }

  function makeStationHub() {
    var g = setRole(new THREE.Group(), 'station-hub-root');
    g.name = 'StationTerminalHub';
    // 高塔负责远距离识别；抵达点位于其南侧，不再出生在不参与碰撞的装饰盒内部。
    // 阿特拉斯 v2 造型：阶梯基座 → 分层塔身 → 桅杆/通讯环 → 信标，全部合批，
    // 大幅减少 drawable 数量的同时用色块分层与发光灯带补足形体可读性。
    var P = STATION_PALETTE;

    // ---- 基座：深空合金阶梯 + 四角设备箱（deep），中层装甲过渡（mid）----
    cluster(g, [
      { s: [11, 0.5, 11], p: [0, 0.25, 0] },
      { s: [8.6, 0.55, 8.6], p: [0, 0.78, 0] },
      { s: [1.5, 1.2, 1.5], p: [-2.8, 1.65, -2.8] },
      { s: [1.5, 1.2, 1.5], p: [2.8, 1.65, -2.8] },
      { s: [1.5, 1.2, 1.5], p: [-2.8, 1.65, 2.8] },
      { s: [1.5, 1.2, 1.5], p: [2.8, 1.65, 2.8] },
      { s: [3.98, 0.42, 3.98], p: [0, 5.06, 0] },
      { s: [2.55, 0.5, 2.55], p: [0, 7.32, 0] },
      { s: [1.5, 2.2, 0.3], p: [0, 1.65, 1.85] },
      { s: [0.95, 4.3, 0.95], p: [-10 * 0.7071, 2.15, -10 * 0.7071] },
      { s: [0.95, 4.3, 0.95], p: [10 * 0.7071, 2.15, -10 * 0.7071] },
      { s: [0.95, 4.3, 0.95], p: [-10 * 0.7071, 2.15, 10 * 0.7071] },
      { s: [0.95, 4.3, 0.95], p: [10 * 0.7071, 2.15, 10 * 0.7071] },
      { s: [1.25, 0.25, 1.25], p: [-10 * 0.7071, 0.12, -10 * 0.7071] },
      { s: [1.25, 0.25, 1.25], p: [10 * 0.7071, 0.12, -10 * 0.7071] },
      { s: [1.25, 0.25, 1.25], p: [-10 * 0.7071, 0.12, 10 * 0.7071] },
      { s: [1.25, 0.25, 1.25], p: [10 * 0.7071, 0.12, 10 * 0.7071] }
    ], stationMaterial(P.deep), 'station-terminal-base');

    cluster(g, [
      { s: [6.4, 0.62, 6.4], p: [0, 1.36, 0] },
      { s: [5.4, 0.9, 5.4], p: [0, 2.05, 0] },
      { s: [3.4, 2.3, 3.4], p: [0, 3.7, 0] },
      { s: [3.05, 1.8, 3.05], p: [0, 6.17, 0] }
    ], stationMaterial(P.mid), 'station-terminal');

    // ---- 发光灯带：基座边线、塔角竖缝、门楣、顶盖压线（单网格青光）----
    cluster(g, [
      { s: [8.72, 0.13, 0.13], p: [0, 1.06, 4.29] },
      { s: [8.72, 0.13, 0.13], p: [0, 1.06, -4.29] },
      { s: [0.13, 0.13, 8.72], p: [4.29, 1.06, 0] },
      { s: [0.13, 0.13, 8.72], p: [-4.29, 1.06, 0] },
      { s: [0.14, 2.2, 0.14], p: [-1.58, 3.7, -1.58] },
      { s: [0.14, 2.2, 0.14], p: [1.58, 3.7, -1.58] },
      { s: [0.14, 2.2, 0.14], p: [-1.58, 3.7, 1.58] },
      { s: [0.14, 2.2, 0.14], p: [1.58, 3.7, 1.58] },
      { s: [2.9, 0.12, 0.09], p: [0, 4.62, 1.76] },
      { s: [1.9, 0.12, 0.09], p: [0, 0.62, 2.02] },
      { s: [2.66, 0.12, 2.66], p: [0, 7.6, 0] }
    ], stationMaterial(P.cyanDim), 'station-lightstrip');

    // 显示面朝南方抵达点（+Z）；测试语义角色名保持不变。
    box(g, [2.5, 1.1, 0.22], [0, 5.9, 1.64], P.cyan, null,
      'station-terminal-screen', { transparent: true, opacity: 0.82, depthWrite: false });

    // ---- 桅杆 + 通讯环 + 信标 ----
    cluster(g, [
      { s: [0.34, 4.6, 0.34], p: [0, 9.85, 0] },
      { s: [1.7, 0.18, 0.18], p: [0, 11.6, 0] },
      { s: [0.16, 0.5, 0.16], p: [0, 12.45, 0] },
      { s: [0.9, 0.22, 0.9], p: [0, 7.68, 0] }
    ], stationMaterial(P.deep), 'station-mast');
    var ring = setRole(new THREE.Mesh(
      track('geometries', new THREE.TorusGeometry(0.95, 0.07, 4, 14)),
      stationMaterial(P.cyan, { transparent: true, opacity: 0.72, depthWrite: false })
    ), 'station-ring');
    ring.name = 'SpaceTravel_station-ring';
    ring.position.set(0, 10.7, 0);
    ring.rotation.x = 0.5;
    g.add(ring);
    animatedRings.push({ mesh: ring, phase: 0.35, rate: 0.34, tiltX: 0.5 });
    var beacon = box(g, [0.26, 1.7, 0.26], [0, 13.3, 0], P.beacon, null,
      'station-beacon', { transparent: true, opacity: 0.8, depthWrite: false });
    g.userData.beacon = beacon;

    // ---- 信标塔灯帽：琥珀导航灯四盏合一 ----
    cluster(g, [
      { s: [1.06, 0.3, 1.06], p: [-10 * 0.7071, 4.42, -10 * 0.7071] },
      { s: [1.06, 0.3, 1.06], p: [10 * 0.7071, 4.42, -10 * 0.7071] },
      { s: [1.06, 0.3, 1.06], p: [-10 * 0.7071, 4.42, 10 * 0.7071] },
      { s: [1.06, 0.3, 1.06], p: [10 * 0.7071, 4.42, 10 * 0.7071] }
    ], stationMaterial(P.amber, { transparent: true, opacity: 0.92, depthWrite: false }),
      'navigation-light');
    // 深空星场、远方母星与星环由 Atmosphere 单点拥有；这里仅生成空间站建筑，
    // 避免与全局天空叠加第二套不跟随相机的 Points。
    return g;
  }

  function makeStationDock() {
    var g = setRole(new THREE.Group(), 'station-dock-root');
    g.name = 'StationArrivalDock';
    var P = STATION_PALETTE;
    // 下沉式泊位标记环：平面光环取代旧高段圆管，三角数减半以上。
    var ring = setRole(new THREE.Mesh(
      track('geometries', new THREE.RingGeometry(2.7, 3.35, 20)),
      stationMaterial(0x53e8ff, {
        transparent: true, opacity: 0.75, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      })
    ), 'dock-beacon');
    ring.position.y = 0.16;
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
    // 泊位拱门与地面引导虚线（合批）。
    cluster(g, [
      { s: [0.42, 3.3, 0.42], p: [-3.3, 1.65, -5.0] },
      { s: [0.42, 3.3, 0.42], p: [3.3, 1.65, -5.0] },
      { s: [7.1, 0.4, 0.44], p: [0, 3.42, -5.0] },
      { s: [0.62, 0.18, 0.62], p: [-3.3, 0.09, -5.0] },
      { s: [0.62, 0.18, 0.62], p: [3.3, 0.09, -5.0] }
    ], stationMaterial(STATION_PALETTE.deep), 'dock-arch');
    cluster(g, [
      { s: [6.7, 0.14, 0.14], p: [0, 3.2, -4.97] },
      { s: [0.5, 0.08, 1.5], p: [0, 0.07, -2.5] },
      { s: [0.5, 0.08, 1.5], p: [0, 0.07, -5.6] },
      { s: [0.5, 0.08, 1.5], p: [0, 0.07, -8.7] },
      { s: [0.5, 0.08, 1.5], p: [0, 0.07, -11.8] }
    ], stationMaterial(P.cyanDim, { transparent: true, opacity: 0.88, depthWrite: false }),
      'navigation-light');
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

  // 推进自写着色器的时间与相机位置：Fresnel 边缘光与能量涡流都依赖它们。
  // 相机位置用玩家坐标近似（第一人称下两者基本重合），省去把 camera 传进本模块。
  function updateShaderUniforms(now) {
    var pp = (Voxel.Player && Voxel.Player.pos) ? Voxel.Player.pos() : null;
    if (pp && isFinite(pp.x) && isFinite(pp.y) && isFinite(pp.z))
      _camWorldPos.set(pp.x, pp.y + 1.6, pp.z);
    for (var i = 0; i < shaderUniforms.length; i++) {
      var u = shaderUniforms[i];
      if (!u) continue;
      if (u.uTime) u.uTime.value = reducedMotion ? 0.35 : now;
      if (u.uCamPos) u.uCamPos.value.copy(_camWorldPos);
    }
  }

  function applyVisualState(now) {
    now = finite(now, 0, 0, 1e9);
    updateShaderUniforms(now);
    for (var i = 0; i < animatedRings.length; i++) {
      var item = animatedRings[i];
      if (!item || !item.mesh) continue;
      if (item.tiltX !== undefined) item.mesh.rotation.x = item.tiltX;
      item.mesh.rotation.z = item.phase + (reducedMotion ? 0 : now * item.rate);
    }
    for (var p = 0; p < portals.length; p++) {
      var portal = portals[p];
      if (!portal || !portal.userData) continue;
      var fieldMat = portal.userData.field && portal.userData.field.material;
      if (!fieldMat) continue;
      var fieldPulse = reducedMotion ? 0.85 : 0.78 + Math.sin(now * 4 + portal.userData.spinPhase) * 0.07;
      // 涡流核心是自写着色器，透明度走 uOpacity uniform；这里两种材质都照顾到。
      if (fieldMat.uniforms && fieldMat.uniforms.uOpacity) fieldMat.uniforms.uOpacity.value = fieldPulse;
      else fieldMat.opacity = fieldPulse;
    }
    // 空间站信标慢速脉冲；减少动态时保持恒定亮度不随时间漂移。
    if (stationHub && stationHub.userData && stationHub.userData.beacon &&
      stationHub.userData.beacon.material)
      stationHub.userData.beacon.material.opacity = reducedMotion ? 0.8 :
        0.58 + Math.sin(now * 2.6) * 0.26;
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
    // 材质已随账本释放，这里的 uniforms 引用必须一并断开，否则会持有僵尸对象。
    shaderUniforms.length = 0;
    portalGeoCache = null;
    aboardShip = false; boardedWorldId = null; shieldImpactUntil = 0; cockpitSignature = '';
    cockpitLastSyncAt = -Infinity;
    flightState = null; flightEvents.length = 0; lastSafeExit = null; lastLandingPose = null;
    flightRestoreValid = true;
    landingAssist = null; landingAssistDistance = null;
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
      // 损坏的存档姿态一律回退泊位默认姿态（landed），即使其解析位置
      // 恰好悬空不撞地——否则飞行模拟暂停时该状态永远不会结算落地。
      if (!flightRestoreValid || flightBoxCollides(flightState.position, flightState)) {
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
    var sysLabel = '';
    if (Voxel.Universe) {
      var desc = Voxel.Galaxy.sysDesc ? Voxel.Galaxy.sysDesc(galaxy) : null;
      if (desc) sysLabel = desc.galaxyName + ' · ' + desc.name + ' · ';
    }
    setText(coordEl, sysLabel + '坐标 ' + signed(world.x, 0) + ' / ' + signed(world.y, 0));
    if (fuelEl) {
      var cells = galaxy.ship && typeof galaxy.ship.warpCells === 'number'
        ? galaxy.ship.warpCells : 0;
      setText(fuelEl, '跃迁 ' + st.percent + '%' + ' · 电池 ' + cells);
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
      ? '点右上角「登舰」进入密封舱' : '按 E 登舰避难 · 准星对箱子等则直接交互 · H 打开外部星图');
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

  var BEARING_LABELS = ['前方', '右前方', '右侧', '右后方', '后方', '左后方', '左侧', '左前方'];

  function shipBearing() {
    if (!ship || !world || world.kind !== 'planet' || !Voxel.Player || !Voxel.Player.pos) return null;
    if (isAboard()) return null;
    var p = Voxel.Player.pos();
    var dx = ship.position.x - p.x;
    var dy = ship.position.y - p.y;
    var dz = ship.position.z - p.z;
    var distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(distance > 0)) return null;
    var yaw = Voxel.Controls.yaw ? Voxel.Controls.yaw() : 0;
    var fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    var rx = Math.cos(yaw), rz = -Math.sin(yaw);
    var hx = dx, hz = dz;
    var hLen = Math.sqrt(hx * hx + hz * hz);
    if (hLen < 1e-4) { hx = fx; hz = fz; hLen = 1; }
    var fwdDot = (hx * fx + hz * fz) / hLen;
    var rightDot = (hx * rx + hz * rz) / hLen;
    var sector = Math.round(Math.atan2(rightDot, fwdDot) / (Math.PI / 4));
    sector = ((sector % 8) + 8) % 8;
    var distanceText = distance < 10
      ? (Math.round(distance * 10) / 10) + 'm'
      : Math.round(distance) + 'm';
    return {
      direction: BEARING_LABELS[sector],
      distance: Math.round(distance * 10) / 10,
      text: BEARING_LABELS[sector] + ' ' + distanceText
    };
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
    // 目录长度随恒星系行星数（2..6+空间站）变化；只要求全部节点就位。
    root.setAttribute('data-ready', Object.keys(coords).length === list.length && list.length >= 3 ? 'true' : 'false');
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
    mapGrid.setAttribute('data-mode', 'system');
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

  // ---- 银河星图（跨恒星系）：渲染委托 ui/galaxy_map.js 纯 DOM 模块 ----

  function galaxyMapCtx() {
    return {
      galaxy: galaxy,
      grid: mapGrid,
      doc: typeof document !== 'undefined' ? document : null
    };
  }

  function setMapMode(mode) {
    return Voxel.GalaxyMap.setMode(mode, Object.assign(galaxyMapCtx(), {
      onShowSystem: showMap
    }));
  }

  function panGalaxyView(dg, ds) { return Voxel.GalaxyMap.pan(dg, ds, galaxyMapCtx()); }
  function homeGalaxyView() { return Voxel.GalaxyMap.home(galaxyMapCtx()); }
  function selectJumpTarget(addrStr) {
    // 状态守卫由 main.js 的 Game.selectJumpTarget 承担；这里只负责渲染选择。
    return Voxel.GalaxyMap.select(addrStr, galaxyMapCtx());
  }
  function selectedJumpInfo() { return Voxel.GalaxyMap.getSelection(galaxy); }

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
    if (Voxel.GalaxyMap && Voxel.GalaxyMap.clearSelection) Voxel.GalaxyMap.clearSelection();
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
    engageLandingAssist: engageLandingAssist,
    cancelLandingAssist: cancelLandingAssist,
    landingAssistInfo: landingAssistInfo,
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
    shipBearing: shipBearing,
    showMap: showMap,
    refreshMap: function () {
      return Voxel.GalaxyMap.getMode() === 'galaxy'
        ? Voxel.GalaxyMap.render(galaxyMapCtx()) : showMap();
    },
    setMapMode: setMapMode,
    mapMode: function () { return Voxel.GalaxyMap.getMode(); },
    panGalaxyView: panGalaxyView,
    homeGalaxyView: homeGalaxyView,
    selectJumpTarget: selectJumpTarget,
    selectedJump: selectedJumpInfo,
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
