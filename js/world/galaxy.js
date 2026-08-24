// 星系生成：由一个 64 位根种子稳定派生行星、空间站、门户与跃迁距离。
// 纯逻辑模块，无 DOM/THREE 依赖，可直接在 Node 测试中加载。
window.Voxel = window.Voxel || {};

Voxel.Galaxy = (function () {
  var CURRENT_TERRAIN_VERSION = 2;
  var PORTAL_NETWORK_VERSION = 2;
  var TYPES = [
    { key: 'lush', name: '繁茂星球', icon: '◆', desc: '温和生态 · 活性晶体', accent: '#63f5a6', skyTop: 0x183e63, horizon: 0x6bbfa1 },
    { key: 'arid', name: '荒漠星球', icon: '▲', desc: '烈日热负荷 · 硅晶富集', accent: '#ffb35c', skyTop: 0x5b2836, horizon: 0xd77b55 },
    { key: 'frozen', name: '冰封星球', icon: '✦', desc: '低温暴露 · 冰核矿脉', accent: '#9be7ff', skyTop: 0x182b57, horizon: 0x8cc7e8 },
    { key: 'toxic', name: '剧毒星球', icon: '⬡', desc: '毒性孢子 · 孢子晶矿', accent: '#b8ff59', skyTop: 0x243c24, horizon: 0x8da84d },
    { key: 'volcanic', name: '熔火星球', icon: '◈', desc: '火山灰暴露 · 熔核富集', accent: '#ff654d', skyTop: 0x351321, horizon: 0xb94b35 },
    { key: 'oceanic', name: '海洋星球', icon: '●', desc: '深水高压 · 潮汐晶矿', accent: '#59c9ff', skyTop: 0x102d59, horizon: 0x3b99c7 }
  ];
  var SYL_A = ['阿尔', '泽塔', '奈', '奥尔', '伊克', '卡利', '维斯', '泰拉', '诺瓦', '赫利'];
  var SYL_B = ['忒亚', '索恩', '米尔', '珀斯', '瑞斯', '塔恩', '欧拉', '希亚', '安', '洛斯'];

  function rootString(seed) {
    if (typeof seed === 'string') return Voxel.SeedUtil.toString(Voxel.SeedUtil.parse(seed));
    return Voxel.SeedUtil.toString(Voxel.SeedUtil.toBigInt(seed));
  }

  function signedDerived(root, salt) {
    var hi = BigInt(Voxel.SeedUtil.derive32(root, salt));
    var lo = BigInt(Voxel.SeedUtil.derive32(root, salt ^ 0x6d2b79f5));
    return BigInt.asIntN(64, (hi << 32n) | lo).toString(10);
  }

  function planetName(root, i) {
    var a = Voxel.SeedUtil.derive32(root, 0x1100 + i) % SYL_A.length;
    var b = Voxel.SeedUtil.derive32(root, 0x2200 + i) % SYL_B.length;
    return SYL_A[a] + SYL_B[b] + '-' + String.fromCharCode(65 + i);
  }

  function plainObject(value) {
    return !!value && Object.prototype.toString.call(value) === '[object Object]';
  }

  function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

  // 版本是存档兼容边界，不接受字符串/小数/未来值。只要“已有存档”没有一个
  // 明确合法的 1/2，就必须按 v1 解释，避免升级后给旧 edits 更换底图。
  function normalizeTerrainVersion(value, fallback) {
    if (value === 1 || value === 2) return value;
    return fallback === 2 ? 2 : 1;
  }

  function stampTerrainVersion(galaxy, version) {
    version = normalizeTerrainVersion(version, 1);
    galaxy.terrainVersion = version;
    for (var i = 0; i < galaxy.catalog.length; i++) galaxy.catalog[i].terrainVersion = version;
    return galaxy;
  }

  function create(seed) {
    var root = rootString(seed);
    var worlds = [];
    for (var i = 0; i < 6; i++) {
      // 首颗适合开局，且每个星系完整覆盖六种生态；种子决定名称、地形与轨道。
      var typeIndex = i;
      var t = TYPES[typeIndex];
      var angle = (Voxel.SeedUtil.derive32(root, 0x4400 + i) / 4294967296) * Math.PI * 2;
      var radius = 18 + i * 14 + (Voxel.SeedUtil.derive32(root, 0x5500 + i) % 9);
      worlds.push({
        id: 'planet-' + i,
        kind: 'planet',
        index: i,
        name: planetName(root, i),
        seed: signedDerived(root, 0x6600 + i),
        typeKey: t.key,
        typeName: t.name,
        icon: t.icon,
        desc: t.desc,
        accent: t.accent,
        skyTop: t.skyTop,
        horizon: t.horizon,
        terrainVersion: CURRENT_TERRAIN_VERSION,
        x: Math.round(Math.cos(angle) * radius),
        y: Math.round(Math.sin(angle) * radius)
      });
    }
    worlds.push({
      id: 'station-0', kind: 'station', index: 6,
      name: '阿特拉斯中继站', seed: signedDerived(root, 0x7700),
      typeKey: 'station', typeName: '轨道空间站', icon: '▣',
      desc: '跃迁补给 · 星系航行终端', accent: '#e992ff',
      skyTop: 0x030511, horizon: 0x090d22, terrainVersion: CURRENT_TERRAIN_VERSION, x: 0, y: 0
    });
    return {
      version: 1,
      terrainVersion: CURRENT_TERRAIN_VERSION,
      rootSeed: root,
      currentId: 'planet-0',
      discovered: { 'planet-0': true },
      ship: { fuel: 100, maxFuel: 100, engine: '脉冲跃迁引擎 MK-I' },
      discovery: null,
      worlds: {},
      catalog: worlds
    };
  }

  function hydrate(saved, fallbackSeed) {
    var fresh = create((saved && saved.rootSeed) || fallbackSeed);
    if (!saved) return fresh;
    // 任意既有存档若缺字段或字段损坏，一律走精确旧地形 v1；只有显式数字 2
    // 才进入连续群系/差异资源规则。catalog 全部由顶层版本重新盖章，拒绝混版世界。
    stampTerrainVersion(fresh, normalizeTerrainVersion(saved.terrainVersion, 1));
    // v4 及更早版本只有一个世界种子。迁移到 v5 时，起始行星必须永久沿用
    // 旧种子，否则下一次 hydrate 会重新派生 planet-0，导致原 edits/meta 被套到
    // 完全不同的底图上。兼容两种形态：
    // 1) 新代码写入的显式 legacyStartSeed；
    // 2) 旧迁移代码已保存过一次、catalog 中 planet-0 被覆写但尚无标记。
    var freshStart = find(fresh, 'planet-0');
    var savedStart = saved.catalog ? find(saved, 'planet-0') : null;
    var legacyStart = saved.legacyStartSeed;
    if (legacyStart === undefined && savedStart && freshStart && savedStart.seed !== freshStart.seed)
      legacyStart = savedStart.seed;
    if (legacyStart !== undefined && legacyStart !== null && freshStart) {
      legacyStart = rootString(legacyStart);
      fresh.legacyStartSeed = legacyStart;
      freshStart.seed = legacyStart;
    }
    fresh.currentId = find(fresh, saved.currentId) ? saved.currentId : 'planet-0';
    fresh.discovered = plainObject(saved.discovered) ? saved.discovered : fresh.discovered;
    // 存档字段是不可信输入：只从普通对象逐字段合并，缺失/损坏字段沿用当前版本默认值。
    // 不能直接 fresh.ship = saved.ship；旧档缺 engine 时会把 "undefined" 泄漏到航行终端，
    // 非对象 ship 还会令 fuel/maxFuel 变成 NaN。
    var savedShip = plainObject(saved.ship) ? saved.ship : null;
    if (savedShip) {
      if (typeof savedShip.engine === 'string' && savedShip.engine.trim())
        fresh.ship.engine = savedShip.engine.trim().slice(0, 64);

      if (typeof savedShip.maxFuel === 'number' && isFinite(savedShip.maxFuel) && savedShip.maxFuel > 0)
        fresh.ship.maxFuel = Math.floor(savedShip.maxFuel);

      if (typeof savedShip.fuel === 'number' && isFinite(savedShip.fuel))
        fresh.ship.fuel = Math.floor(savedShip.fuel);
    }
    fresh.ship.maxFuel = Math.max(1, fresh.ship.maxFuel);
    fresh.ship.fuel = Math.max(0, Math.min(fresh.ship.maxFuel, fresh.ship.fuel));
    fresh.worlds = plainObject(saved.worlds) ? saved.worlds : {};
    // 发现档案由 Discovery.hydrate 按当前 catalog 严格净化；Galaxy 这里只保留
    // 普通对象原料，不能把未知键直接当作有效扫描记录。
    fresh.discovery = plainObject(saved.discovery) ? saved.discovery : null;
    return fresh;
  }

  function find(galaxy, id) {
    if (!galaxy || !galaxy.catalog) return null;
    for (var i = 0; i < galaxy.catalog.length; i++)
      if (galaxy.catalog[i].id === id) return galaxy.catalog[i];
    return null;
  }

  function distance(a, b) {
    if (!a || !b) return 0;
    if (typeof a.x !== 'number' || !isFinite(a.x) || typeof a.y !== 'number' || !isFinite(a.y) ||
      typeof b.x !== 'number' || !isFinite(b.x) || typeof b.y !== 'number' || !isFinite(b.y)) return 0;
    var dx = a.x - b.x, dy = a.y - b.y;
    if (!isFinite(dx) || !isFinite(dy)) return 0;
    var result = Math.sqrt(dx * dx + dy * dy);
    return isFinite(result) ? Math.max(1, Math.round(result)) : 0;
  }

  function fuelCost(a, b) {
    return Math.max(8, Math.min(42, 6 + Math.ceil(distance(a, b) * 0.42)));
  }

  var PLANET_PORTAL_PADS = [
    { x: 80, z: 128, slot: 'station' },
    { x: 176, z: 128, slot: 'cycle-prev' },
    { x: 96, z: 176, slot: 'cycle-next' },
    { x: 160, z: 176, slot: 'opposite' }
  ];
  // 全部位于半径 32 的空间站甲板内，避开中心 dock、北侧终端/塔楼走廊；
  // 最近两个 pad 的中心距仍大于 8 格，门户模型与触发体积不会互相覆盖。
  var STATION_PORTAL_PADS = [
    { x: 104, z: 128, slot: 'planet-0' },
    { x: 152, z: 128, slot: 'planet-1' },
    { x: 108, z: 144, slot: 'planet-2' },
    { x: 148, z: 144, slot: 'planet-3' },
    { x: 116, z: 152, slot: 'planet-4' },
    { x: 140, z: 152, slot: 'planet-5' }
  ];

  function networkShell(root) {
    return {
      version: PORTAL_NETWORK_VERSION,
      rootSeed: root || '',
      cycle: [],
      edges: [],
      byWorld: {}
    };
  }

  function canonicalNetworkRoot(value) {
    try {
      if (typeof value === 'string' && value.trim()) return rootString(value);
      if (typeof value === 'number' && isFinite(value)) return rootString(value);
      if (typeof value === 'bigint') return rootString(value);
    } catch (e) { }
    return null;
  }

  function requiredNetworkWorlds(galaxy) {
    if (!plainObject(galaxy) || !own(galaxy, 'rootSeed') || !own(galaxy, 'catalog') ||
      !Array.isArray(galaxy.catalog) || galaxy.catalog.length !== 7)
      return null;
    var worlds = {}, planets = [];
    for (var i = 0; i < 6; i++) {
      var id = 'planet-' + i;
      var planet = find(galaxy, id);
      if (!plainObject(planet) || !own(planet, 'id') || !own(planet, 'kind') ||
        !own(planet, 'x') || !own(planet, 'y') || planet.id !== id || planet.kind !== 'planet' ||
        typeof planet.x !== 'number' || !isFinite(planet.x) || Math.abs(planet.x) > 10000000 ||
        typeof planet.y !== 'number' || !isFinite(planet.y) || Math.abs(planet.y) > 10000000) return null;
      worlds[id] = planet;
      planets.push(planet);
    }
    var station = find(galaxy, 'station-0');
    if (!plainObject(station) || !own(station, 'id') || !own(station, 'kind') ||
      !own(station, 'x') || !own(station, 'y') || station.id !== 'station-0' || station.kind !== 'station' ||
      typeof station.x !== 'number' || !isFinite(station.x) || Math.abs(station.x) > 10000000 ||
      typeof station.y !== 'number' || !isFinite(station.y) || Math.abs(station.y) > 10000000) return null;
    worlds['station-0'] = station;
    return { planets: planets, station: station, worlds: worlds };
  }

  function seededPlanetCycle(root, planets) {
    var cycle = [];
    for (var i = 0; i < planets.length; i++) cycle.push(planets[i].id);
    // 纯派生 Fisher-Yates；不读 Math.random，同 root 在任何加载顺序下完全一致。
    for (var p = cycle.length - 1; p > 0; p--) {
      var j = Voxel.SeedUtil.derive32(root, 0xd170 + p) % (p + 1);
      var tmp = cycle[p]; cycle[p] = cycle[j]; cycle[j] = tmp;
    }
    return cycle;
  }

  function pairKey(a, b) { return a < b ? a + '--' + b : b + '--' + a; }
  function pairId(a, b) { return 'portal-pair-v' + PORTAL_NETWORK_VERSION + '-' + pairKey(a, b); }
  function gateId(from, to) {
    return 'portal-gate-v' + PORTAL_NETWORK_VERSION + '-' + from + '--' + to;
  }

  function addEdge(edges, edgeMap, a, b, kind) {
    if (a === b) return false;
    var key = pairKey(a, b);
    if (edgeMap[key]) return false;
    var edge = {
      pairId: pairId(a, b),
      kind: kind,
      a: a,
      b: b,
      aGateId: gateId(a, b),
      bGateId: gateId(b, a)
    };
    edgeMap[key] = edge;
    edges.push(edge);
    return true;
  }

  function gateFor(edgeMap, from, to, pad, kind) {
    var edge = edgeMap[pairKey(from, to)];
    if (!edge) return null;
    return {
      id: gateId(from, to),
      pairId: edge.pairId,
      destinationId: to,
      destinationGateId: gateId(to, from),
      x: pad.x,
      z: pad.z,
      slot: pad.slot,
      kind: kind || edge.kind
    };
  }

  function cloneGate(gate) {
    return {
      id: gate.id,
      pairId: gate.pairId,
      destinationId: gate.destinationId,
      destinationGateId: gate.destinationGateId,
      x: gate.x,
      z: gate.z,
      slot: gate.slot,
      kind: gate.kind
    };
  }

  function cloneEdge(edge) {
    return {
      pairId: edge.pairId,
      kind: edge.kind,
      a: edge.a,
      b: edge.b,
      aGateId: edge.aGateId,
      bGateId: edge.bGateId
    };
  }

  // 整个星系一次派生一张双向网络，而不是让每个世界各自有放回抽样：
  // station 星形边保证任意两世界最多两跳；seeded 行星环与对径匹配提供地表捷径。
  function portalNetwork(galaxy) {
    var root = canonicalNetworkRoot(galaxy && galaxy.rootSeed);
    var required = requiredNetworkWorlds(galaxy);
    var empty = networkShell(root);
    if (!root || !required) return empty;

    var cycle = seededPlanetCycle(root, required.planets);
    var edges = [], edgeMap = {};
    var i;
    for (i = 0; i < required.planets.length; i++)
      addEdge(edges, edgeMap, 'station-0', required.planets[i].id, 'station');
    for (i = 0; i < cycle.length; i++)
      addEdge(edges, edgeMap, cycle[i], cycle[(i + 1) % cycle.length], 'cycle');
    for (i = 0; i < cycle.length / 2; i++)
      addEdge(edges, edgeMap, cycle[i], cycle[i + cycle.length / 2], 'opposite');

    var byWorld = {}, cycleIndex = {};
    for (i = 0; i < cycle.length; i++) cycleIndex[cycle[i]] = i;
    for (i = 0; i < required.planets.length; i++) {
      var planetId = required.planets[i].id;
      var ci = cycleIndex[planetId];
      var destinations = [
        { id: 'station-0', kind: 'station' },
        { id: cycle[(ci + cycle.length - 1) % cycle.length], kind: 'cycle' },
        { id: cycle[(ci + 1) % cycle.length], kind: 'cycle' },
        { id: cycle[(ci + cycle.length / 2) % cycle.length], kind: 'opposite' }
      ];
      byWorld[planetId] = [];
      for (var d = 0; d < destinations.length; d++)
        byWorld[planetId].push(gateFor(
          edgeMap, planetId, destinations[d].id, PLANET_PORTAL_PADS[d], destinations[d].kind));
    }
    byWorld['station-0'] = [];
    for (i = 0; i < required.planets.length; i++)
      byWorld['station-0'].push(gateFor(
        edgeMap, 'station-0', required.planets[i].id, STATION_PORTAL_PADS[i], 'station'));

    var out = networkShell(root);
    out.cycle = cycle.slice();
    for (i = 0; i < edges.length; i++) out.edges.push(cloneEdge(edges[i]));
    var ids = ['planet-0', 'planet-1', 'planet-2', 'planet-3', 'planet-4', 'planet-5', 'station-0'];
    for (i = 0; i < ids.length; i++) {
      out.byWorld[ids[i]] = [];
      for (var g = 0; g < byWorld[ids[i]].length; g++)
        out.byWorld[ids[i]].push(cloneGate(byWorld[ids[i]][g]));
    }
    return out;
  }

  function portalsFor(galaxy, world) {
    if (!plainObject(world) || !own(world, 'id') || typeof world.id !== 'string') return [];
    var network = portalNetwork(galaxy);
    var gates = network.byWorld[world.id];
    if (!Array.isArray(gates)) return [];
    var out = [];
    for (var i = 0; i < gates.length; i++) out.push(cloneGate(gates[i]));
    return out;
  }

  function networkWorldId(value) {
    if (typeof value === 'string') return value;
    if (plainObject(value) && own(value, 'id') && typeof value.id === 'string') return value.id;
    return '';
  }

  function portalRoute(galaxy, from, to) {
    var network = portalNetwork(galaxy);
    var fromId = networkWorldId(from), toId = networkWorldId(to);
    if (!Array.isArray(network.byWorld[fromId]) || !Array.isArray(network.byWorld[toId])) return [];
    if (fromId === toId) return [fromId];
    var queue = [fromId], head = 0, seen = {}, previous = {};
    seen[fromId] = true;
    while (head < queue.length && !seen[toId]) {
      var id = queue[head++], gates = network.byWorld[id];
      for (var i = 0; i < gates.length; i++) {
        var next = gates[i].destinationId;
        if (!Array.isArray(network.byWorld[next]) || seen[next]) continue;
        seen[next] = true;
        previous[next] = id;
        queue.push(next);
        if (next === toId) break;
      }
    }
    if (!seen[toId]) return [];
    var path = [toId], cursor = toId;
    while (cursor !== fromId) {
      cursor = previous[cursor];
      if (!cursor) return [];
      path.push(cursor);
      if (path.length > 8) return [];
    }
    path.reverse();
    return path;
  }

  function boundedUnits(value, fallback, min, max) {
    return typeof value === 'number' && isFinite(value)
      ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
  }

  // 权威航线视图：燃料字段使用绝对单位而非百分比；portalPath 与船燃料
  // 可达性并列返回，UI 不必再各自复制距离、扣费或门户直达判断。
  function routePlan(galaxy, from, to, ship) {
    var maxFuel = boundedUnits(ship && ship.maxFuel, 100, 1, 1000000);
    var fuel = boundedUnits(ship && ship.fuel, 0, 0, maxFuel);
    var fromId = networkWorldId(from), toId = networkWorldId(to);
    var network = portalNetwork(galaxy);
    var fromWorld = find(galaxy, fromId), toWorld = find(galaxy, toId);
    var valid = !!fromWorld && !!toWorld && Array.isArray(network.byWorld[fromId]) &&
      Array.isArray(network.byWorld[toId]);
    var portalPath = valid ? portalRoute(galaxy, fromId, toId) : [];
    var distanceLy = valid && fromId !== toId ? distance(fromWorld, toWorld) : 0;
    var costUnits = valid && fromId !== toId ? fuelCost(fromWorld, toWorld) : 0;
    var shortfall = valid ? Math.max(0, costUnits - fuel) : 0;
    return {
      valid: valid,
      fromId: valid ? fromId : '',
      toId: valid ? toId : '',
      distanceLy: distanceLy,
      costUnits: costUnits,
      fuel: fuel,
      maxFuel: maxFuel,
      remainingFuel: valid ? Math.max(0, fuel - costUnits) : fuel,
      shortfall: shortfall,
      reachable: valid && fuel >= costUnits,
      portalPath: portalPath.slice(),
      portalHops: portalPath.length ? portalPath.length - 1 : -1,
      directPortal: portalPath.length === 2
    };
  }

  return {
    CURRENT_TERRAIN_VERSION: CURRENT_TERRAIN_VERSION,
    PORTAL_NETWORK_VERSION: PORTAL_NETWORK_VERSION,
    normalizeTerrainVersion: normalizeTerrainVersion,
    TYPES: TYPES,
    create: create,
    hydrate: hydrate,
    find: find,
    distance: distance,
    fuelCost: fuelCost,
    portalNetwork: portalNetwork,
    portalsFor: portalsFor,
    portalRoute: portalRoute,
    routePlan: routePlan
  };
})();
