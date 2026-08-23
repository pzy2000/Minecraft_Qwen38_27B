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
  var SHIP_BOB_AMPLITUDE = 0.06;
  var SCAN_INTERVAL_MS = 125; // 约 8Hz；目标种类/名称改变时允许立即刷新。

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

  function box(parent, size, pos, color, emissive) {
    var lit = new THREE.Color(color);
    if (emissive) lit.lerp(new THREE.Color(emissive), 0.32);
    var mat = new THREE.MeshBasicMaterial({ color: lit, fog: true });
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
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
    var g = new THREE.Group();
    box(g, [4.8, 1.2, 7.2], [0, 1.4, 0], 0x24304a);
    box(g, [2.6, 1.0, 3.3], [0, 2.35, -0.6], 0x4c6d86);
    box(g, [7.8, 0.35, 3.6], [0, 1.25, 0.8], 0x53647d);
    box(g, [1.0, 0.7, 1.4], [-1.45, 1.35, 3.35], 0x24d7ff, 0x0b6688);
    box(g, [1.0, 0.7, 1.4], [1.45, 1.35, 3.35], 0x24d7ff, 0x0b6688);
    box(g, [1.5, 0.25, 2.2], [0, 2.98, -0.7], 0x91e8ff, 0x123a55);
    var nose = box(g, [2.8, 0.8, 1.5], [0, 1.55, -4.0], 0xc8d3db);
    nose.rotation.x = 0.1;
    return g;
  }

  function makePortal(p, dest) {
    var g = new THREE.Group();
    var c = new THREE.Color(dest.accent || '#8df7ff');
    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.65, 0.18, 4, 12),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.92 })
    );
    ring.position.y = 2.05;
    g.add(ring);
    box(g, [0.55, 3.8, 0.55], [-1.75, 1.9, 0], 0x20283b);
    box(g, [0.55, 3.8, 0.55], [1.75, 1.9, 0], 0x20283b);
    box(g, [4.0, 0.5, 0.75], [0, 3.8, 0], 0x33415f);
    var field = new THREE.Mesh(
      new THREE.PlaneGeometry(2.9, 2.9, 4, 4),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
    );
    field.position.y = 2.0;
    g.add(field);
    g.userData = { portal: p, ring: ring, field: field, destination: dest };
    return g;
  }

  function makeStationHub() {
    var g = new THREE.Group();
    // 中央航行塔：纯几何像素模型，不依赖外部资源。
    box(g, [8, 1, 8], [0, 0.5, 0], 0x202c43);
    box(g, [5.5, 0.35, 5.5], [0, 1.15, 0], 0x39d8f2, 0x126b7d);
    box(g, [3.2, 4.8, 3.2], [0, 3.4, 0], 0x263c59);
    box(g, [3.35, 1.4, 0.24], [0, 3.7, -1.72], 0x75f5ff, 0x176b88);
    box(g, [1.3, 6.8, 1.3], [0, 8.5, 0], 0x4b5b7c);
    box(g, [0.55, 3.6, 0.55], [0, 13.6, 0], 0xf16dff, 0x7b2488);
    for (var i = 0; i < 4; i++) {
      var a = i * Math.PI / 2 + Math.PI / 4;
      var px = Math.cos(a) * 10, pz = Math.sin(a) * 10;
      box(g, [1.1, 4.2, 1.1], [px, 2.1, pz], 0x354867);
      box(g, [1.45, 0.45, 1.45], [px, 4.45, pz], i % 2 ? 0xf16dff : 0x53e8ff, i % 2 ? 0x6b236f : 0x176b88);
    }
    // 深空星场、远方母星与星环由 Atmosphere 单点拥有；这里仅生成空间站建筑，
    // 避免与全局天空叠加第二套不跟随相机的 Points。
    return g;
  }

  function clear() {
    if (group && group.parent) group.parent.remove(group);
    if (group) {
      group.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    group = null; ship = null; shipBaseY = 0; portals = []; nearShip = false;
    galaxy = null; world = null;
    scanOnline = false;
    resetScanTarget();
    setScanOffline();
    setHudOffline();
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
    group = new THREE.Group();
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
      var sPos = safeSurface(Math.round(sp.x + 9), Math.round(sp.z + 7));
      ship = makeShip();
      ship.position.set(sPos.x + 0.5, sPos.y + 0.05, sPos.z + 0.5);
      shipBaseY = ship.position.y;
      ship.rotation.y = Math.PI * 0.25;
      group.add(ship);
    } else {
      var hub = makeStationHub();
      hub.position.set(128.5, 24, 128.5);
      group.add(hub);
    }
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
    scene = s;
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
    nearShip = world.kind === 'station' || !!(ship && ship.position.distanceTo(p) < 7.5);
    // 绝对基准上的正弦位移，与显示刷新率无关；旧 += 写法会在高刷屏累积漂移。
    if (ship) ship.position.y = shipBaseY + Math.sin(performance.now() * 0.002) * SHIP_BOB_AMPLITUDE;
    for (var i = 0; i < portals.length; i++) {
      var o = portals[i];
      o.userData.ring.rotation.z += renderDt * (i % 2 ? -0.8 : 0.8);
      o.userData.field.material.opacity = 0.18 + Math.sin(performance.now() * 0.004 + i) * 0.06;
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
    if (world.kind === 'station')
      consider('station-terminal', 'station-terminal', 128.5, 27.5, 128.5, 10);
    if (ship)
      consider('ship', 'ship', ship.position.x, ship.position.y + 1.5, ship.position.z, 8);
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
          if (Voxel.Game && Voxel.Game.requestTravel && (typeof dest.id === 'string' || typeof dest.id === 'number'))
            Voxel.Game.requestTravel(dest.id, 'ship');
        });
        mapGrid.appendChild(card);
      })(list[i]);
    }
    var title = document.getElementById('starmap-status');
    var st = shipText(galaxy);
    setText(title, st.engine + ' · 能量 ' + st.fuel + '/' + st.maxFuel);
  }

  function showWarp(from, to, mode) {
    var title = document.getElementById('warp-title');
    var sub = document.getElementById('warp-sub');
    setText(title, mode === 'portal' ? '传送门同步中' : '跃迁引擎点火');
    setText(sub, worldText(from).name + '  →  ' + worldText(to).name);
    var el = document.getElementById('overlay-warp');
    if (el) el.classList.remove('hidden');
  }

  function hideWarp() {
    var el = document.getElementById('overlay-warp');
    if (el) el.classList.add('hidden');
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
    showWarp: showWarp,
    hideWarp: hideWarp,
    currentWorld: function () { return world; },
    environment: function () { return world ? { top: world.skyTop, horizon: world.horizon } : null; },
    portals: function () { return portals; },
    ship: function () { return ship; }
  };
})();
