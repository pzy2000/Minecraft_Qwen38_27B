// 星际旅行表现层：像素飞船、种子门户、星图和跃迁 HUD。
window.Voxel = window.Voxel || {};

Voxel.SpaceTravel = (function () {
  var scene = null, group = null, ship = null, portals = [];
  var galaxy = null, world = null, nearShip = false, portalCooldown = 0;
  var fuelEl = null, worldEl = null, coordEl = null, mapGrid = null;

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
    // 像素星空：空间站拥有独立的深空参照，避免平台悬在纯色背景中。
    var positions = [], s = Voxel.SeedUtil.derive32(world.seed, 0xd001) || 1;
    function rnd() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }
    for (var j = 0; j < 520; j++) {
      var theta = rnd() * Math.PI * 2;
      var u = rnd() * 2 - 1;
      var rad = 150 + rnd() * 180;
      var rr = Math.sqrt(1 - u * u) * rad;
      positions.push(Math.cos(theta) * rr, u * rad, Math.sin(theta) * rr);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    var stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xcfe9ff, size: 1.45, sizeAttenuation: true, fog: false }));
    stars.position.y = 20;
    g.add(stars);
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
    group = null; ship = null; portals = []; nearShip = false;
  }

  function loadWorld(w, g) {
    clear();
    galaxy = g; world = w;
    if (!scene || !world || !galaxy) return;
    group = new THREE.Group();
    scene.add(group);

    var layout = Voxel.Galaxy.portalsFor(galaxy, world);
    for (var i = 0; i < layout.length; i++) {
      var pos = safeSurface(layout[i].x, layout[i].z);
      var dest = Voxel.Galaxy.find(galaxy, layout[i].destinationId);
      var pg = makePortal(layout[i], dest);
      pg.position.set(pos.x + 0.5, pos.y + 1, pos.z + 0.5);
      group.add(pg);
      portals.push(pg);
    }

    if (world.kind === 'planet') {
      var sp = Voxel.World.spawnPoint();
      var sPos = safeSurface(Math.round(sp.x + 9), Math.round(sp.z + 7));
      ship = makeShip();
      ship.position.set(sPos.x + 0.5, sPos.y + 0.05, sPos.z + 0.5);
      ship.rotation.y = Math.PI * 0.25;
      group.add(ship);
    } else {
      var hub = makeStationHub();
      hub.position.set(128.5, 24, 128.5);
      group.add(hub);
    }
    portalCooldown = 2.5;
    syncHud();
  }

  function syncHud() {
    if (!world || !galaxy) return;
    if (worldEl) worldEl.textContent = world.icon + ' ' + world.name + ' · ' + world.typeName;
    if (coordEl) coordEl.textContent = '坐标 ' + (world.x >= 0 ? '+' : '') + world.x + ' / ' + (world.y >= 0 ? '+' : '') + world.y;
    if (fuelEl) {
      var f = Math.round(galaxy.ship.fuel);
      fuelEl.textContent = '跃迁 ' + f + '%';
      fuelEl.style.setProperty('--fuel', f + '%');
    }
  }

  function init(s) {
    scene = s;
    fuelEl = document.getElementById('warp-fuel');
    worldEl = document.getElementById('world-name');
    coordEl = document.getElementById('world-coord');
    mapGrid = document.getElementById('starmap-grid');
  }

  function update(dt) {
    if (!world || !galaxy || !group || !Voxel.Player) return;
    portalCooldown = Math.max(0, portalCooldown - dt);
    var p = Voxel.Player.pos();
    nearShip = world.kind === 'station' || !!(ship && ship.position.distanceTo(p) < 7.5);
    if (ship) ship.position.y += Math.sin(performance.now() * 0.002) * 0.0015;
    for (var i = 0; i < portals.length; i++) {
      var o = portals[i];
      o.userData.ring.rotation.z += dt * (i % 2 ? -0.8 : 0.8);
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

  function showMap() {
    if (!mapGrid || !galaxy || !world) return;
    mapGrid.innerHTML = '';
    var list = galaxy.catalog.slice();
    list.sort(function (a, b) { return Voxel.Galaxy.distance(world, a) - Voxel.Galaxy.distance(world, b); });
    for (var i = 0; i < list.length; i++) {
      (function (dest) {
        var current = dest.id === world.id;
        var cost = current ? 0 : Voxel.Galaxy.fuelCost(world, dest);
        var known = !!galaxy.discovered[dest.id];
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'star-card' + (current ? ' current' : '') + (known ? ' discovered' : '');
        card.disabled = current;
        card.style.setProperty('--accent', dest.accent || '#8df7ff');
        card.innerHTML =
          '<span class="star-icon">' + dest.icon + '</span>' +
          '<span class="star-main"><b>' + dest.name + '</b><small>' + dest.typeName + ' · ' + dest.desc + '</small></span>' +
          '<span class="star-meta">' + (current ? '当前位置' : (known ? '已发现' : '未发现')) + '<br>' +
          (current ? '' : ('距离 ' + Voxel.Galaxy.distance(world, dest) + ' LY · 能量 ' + cost + '%')) + '</span>';
        card.addEventListener('click', function () {
          if (Voxel.Game && Voxel.Game.requestTravel) Voxel.Game.requestTravel(dest.id, 'ship');
        });
        mapGrid.appendChild(card);
      })(list[i]);
    }
    var title = document.getElementById('starmap-status');
    if (title) title.textContent = galaxy.ship.engine + ' · 能量 ' + Math.round(galaxy.ship.fuel) + '/' + galaxy.ship.maxFuel;
  }

  function showWarp(from, to, mode) {
    var title = document.getElementById('warp-title');
    var sub = document.getElementById('warp-sub');
    if (title) title.textContent = mode === 'portal' ? '传送门同步中' : '跃迁引擎点火';
    if (sub) sub.textContent = (from ? from.name : '未知星域') + '  →  ' + (to ? to.name : '未知星域');
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
    actionHint: actionHint,
    canOpenMap: canOpenMap,
    showMap: showMap,
    showWarp: showWarp,
    hideWarp: hideWarp,
    currentWorld: function () { return world; },
    environment: function () { return world ? { top: world.skyTop, horizon: world.horizon } : null; },
    portals: function () { return portals; },
    ship: function () { return ship; }
  };
})();
