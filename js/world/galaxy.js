// 恒星系生成：由宇宙种子 + 银河/恒星系坐标确定性派生行星、空间站、门户与跃迁距离。
// 起源恒星系 (g=0,s=0) 的目录派生公式与旧版单星系逐位一致（存档兼容边界）。
// 纯逻辑模块，无 DOM/THREE 依赖；依赖 seed.js 与 universe.js，可直接在 Node 测试中加载。
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

  function plainInt(value) {
    // 无限宇宙坐标（curG/curS）允许任意方向。
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value
      ? Math.floor(value) : null;
  }

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

  // 按恒星系描述符构建目录。字段派生公式与旧版逐字一致；起源系描述符
  // （6 行星、类型顺序固定）使输出与历史版本完全相同。
  function buildCatalog(root, desc) {
    var worlds = [];
    var count = Math.max(1, Math.min(6, desc.planetCount | 0));
    for (var i = 0; i < count; i++) {
      var typeIndex = desc.typeKeys[i] >= 0 && desc.typeKeys[i] < TYPES.length
        ? desc.typeKeys[i] : (i % TYPES.length);
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
      id: 'station-0', kind: 'station', index: count,
      name: '阿特拉斯中继站', seed: signedDerived(root, 0x7700),
      typeKey: 'station', typeName: '轨道空间站', icon: '▣',
      desc: '跃迁补给 · 星系航行终端', accent: '#e992ff',
      skyTop: 0x030511, horizon: 0x090d22, terrainVersion: CURRENT_TERRAIN_VERSION, x: 0, y: 0
    });
    return worlds;
  }

  function stampCatalog(galaxy) {
    for (var i = 0; i < galaxy.catalog.length; i++)
      galaxy.catalog[i].terrainVersion = CURRENT_TERRAIN_VERSION;
    return galaxy;
  }

  function create(seed) {
    var root = rootString(seed);
    var desc = Voxel.Universe.describe(root, 0, 0);
    return {
      version: 1,
      terrainVersion: CURRENT_TERRAIN_VERSION,
      rootSeed: root,
      // 无限宇宙坐标：当前所在恒星系（起源系 = 旧版单星系，逐位兼容）
      curG: 0,
      curS: 0,
      currentId: 'planet-0',
      discovered: { 'planet-0': true },
      ship: { fuel: 100, maxFuel: 100, engine: '脉冲跃迁引擎 MK-I', warpCells: 2 },
      discovery: null,
      worlds: {},
      // 其他恒星系的玩家档案桶 { addr: {discovered, worlds, discovery, lastVisit} }
      archive: {},
      visitedSys: { 'g0/s0': true },
      catalog: buildCatalog(root, desc)
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
    // 主题精选世界（北欧城堡等）的 typeKey 覆盖标记随 galaxy 持久化；
    // 这里只透传字符串，是否为已知主题由 main.js 的 PlanetRules.knownType 校验。
    if (typeof saved.legacyTheme === 'string' && /^[a-z]{2,12}$/.test(saved.legacyTheme))
      fresh.legacyTheme = saved.legacyTheme;
    // 无限宇宙坐标：损坏/缺失一律回落起源系（其目录与旧版逐位一致）。
    var curG = plainInt(saved.curG), curS = plainInt(saved.curS);
    if (curG === null || curS === null || !Voxel.Universe.addr(curG, curS)) {
      curG = 0; curS = 0;
    }
    if (curG !== 0 || curS !== 0) {
      var desc = Voxel.Universe.describe(fresh.rootSeed, curG, curS);
      fresh.curG = curG; fresh.curS = curS;
      fresh.catalog = buildCatalog(desc.root, desc);
      stampTerrainVersion(fresh, normalizeTerrainVersion(saved.terrainVersion, 1));
      // 非起源系的行星名来自各自 root；visited 标记按地址重置。
      fresh.currentId = 'station-0';
      fresh.discovered = { 'station-0': true };
      fresh.visitedSys[Voxel.Universe.addr(curG, curS)] = true;
    }
    fresh.currentId = find(fresh, saved.currentId) ? saved.currentId : fresh.currentId;
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

      if (typeof savedShip.warpCells === 'number' && isFinite(savedShip.warpCells))
        fresh.ship.warpCells = Math.max(0, Math.floor(savedShip.warpCells));
    }
    fresh.ship.maxFuel = Math.max(1, fresh.ship.maxFuel);
    fresh.ship.fuel = Math.max(0, Math.min(fresh.ship.maxFuel, fresh.ship.fuel));
    fresh.worlds = plainObject(saved.worlds) ? saved.worlds : {};
    // 其他恒星系档案桶：只接受普通对象，桶内字段由 switchSystem 使用时再收紧。
    fresh.archive = plainObject(saved.archive) ? saved.archive : {};
    fresh.visitedSys = plainObject(saved.visitedSys) ? saved.visitedSys : fresh.visitedSys;
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
      !Array.isArray(galaxy.catalog) || galaxy.catalog.length < 3 || galaxy.catalog.length > 7)
      return null;
    var worlds = {}, planets = [];
    for (var i = 0; i < galaxy.catalog.length; i++) {
      var body = galaxy.catalog[i];
      if (!plainObject(body) || !own(body, 'id') || !own(body, 'kind') ||
        !own(body, 'x') || !own(body, 'y')) return null;
      if (body.kind === 'planet') {
        // 行星必须按目录顺序连续编号：planet-0..N
        if (body.id !== 'planet-' + planets.length) return null;
        if (typeof body.x !== 'number' || !isFinite(body.x) || Math.abs(body.x) > 10000000 ||
          typeof body.y !== 'number' || !isFinite(body.y) || Math.abs(body.y) > 10000000) return null;
        worlds[body.id] = body;
        planets.push(body);
      } else if (body.kind === 'station') {
        if (body.id !== 'station-0') return null;
        if (typeof body.x !== 'number' || !isFinite(body.x) || Math.abs(body.x) > 10000000 ||
          typeof body.y !== 'number' || !isFinite(body.y) || Math.abs(body.y) > 10000000) return null;
        worlds[body.id] = body;
      }
    }
    // 必须恰好一颗空间站且至少两颗行星（环与星形拓扑才有意义）。
    var station = worlds['station-0'];
    if (!plainObject(station) || station.kind !== 'station' || planets.length < 2) return null;
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
  // 泛化：行星数 2..6 均可成网；对径边仅当两端配对存在时加入（奇数颗时中位行星缺席）。
  function portalNetwork(galaxy) {
    var root = canonicalNetworkRoot(galaxy && galaxy.rootSeed);
    var required = requiredNetworkWorlds(galaxy);
    var empty = networkShell(root);
    if (!root || !required) return empty;

    var cycle = seededPlanetCycle(root, required.planets);
    var half = Math.floor(cycle.length / 2);
    var edges = [], edgeMap = {};
    var i;
    for (i = 0; i < required.planets.length; i++)
      addEdge(edges, edgeMap, 'station-0', required.planets[i].id, 'station');
    for (i = 0; i < cycle.length; i++)
      addEdge(edges, edgeMap, cycle[i], cycle[(i + 1) % cycle.length], 'cycle');
    for (i = 0; i < half; i++)
      addEdge(edges, edgeMap, cycle[i], cycle[i + half], 'opposite');

    var byWorld = {}, cycleIndex = {};
    for (i = 0; i < cycle.length; i++) cycleIndex[cycle[i]] = i;
    for (i = 0; i < required.planets.length; i++) {
      var planetId = required.planets[i].id;
      var ci = cycleIndex[planetId];
      var oppositeId = null;
      // 奇数行星数时 (ci + floor(N/2)) 不是对称映射；必须从已经建立的
      // 无向 edge 查找另一端，才能保证每条 opposite 门在两端都有返程门。
      for (var oi = 0; oi < edges.length; oi++) {
        var oppositeEdge = edges[oi];
        if (oppositeEdge.kind !== 'opposite') continue;
        if (oppositeEdge.a === planetId) oppositeId = oppositeEdge.b;
        else if (oppositeEdge.b === planetId) oppositeId = oppositeEdge.a;
        if (oppositeId) break;
      }
      var destinations = [
        { id: 'station-0', kind: 'station' },
        { id: cycle[(ci + cycle.length - 1) % cycle.length], kind: 'cycle' },
        { id: cycle[(ci + 1) % cycle.length], kind: 'cycle' }
      ];
      var seenIds = {};
      for (var e = 0; e < destinations.length; e++) seenIds[destinations[e].id] = true;
      // 对径目的地：仅在边存在且未与前三个目的地重复（N=2/3 时会与环邻居重合）时加入。
      if (oppositeId && !seenIds[oppositeId] && edgeMap[pairKey(planetId, oppositeId)]) {
        seenIds[oppositeId] = true;
        destinations.push({ id: oppositeId, kind: 'opposite' });
      }
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
    for (var key in required.worlds) {
      if (!own(required.worlds, key)) continue;
      out.byWorld[key] = [];
      for (var g = 0; g < byWorld[key].length; g++)
        out.byWorld[key].push(cloneGate(byWorld[key][g]));
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

  // ---- 无限宇宙：恒星系切换 / 档案裁剪 / 跨系跃迁 ----

  function sysAddr(galaxy) {
    var a = Voxel.Universe.addr(galaxy && galaxy.curG, galaxy && galaxy.curS);
    return a || 'g0/s0';
  }

  // 当前系统的描述符（名称/恒星/行星数/类型布局）。
  function sysDesc(galaxy) {
    return Voxel.Universe.describe(galaxy && galaxy.rootSeed,
      galaxy ? galaxy.curG : 0, galaxy ? galaxy.curS : 0);
  }

  // 预览任意恒星系的完整目录（不切换当前系统）。用于跨系跃迁前获取
  // 目的地空间站的种子与名称。坐标非法返回 null。
  function catalogFor(galaxy, g, s) {
    var gi = plainInt(g), si = plainInt(s);
    if (!galaxy || gi === null || si === null) return null;
    var desc = Voxel.Universe.describe(galaxy.rootSeed, gi, si);
    var list = buildCatalog(desc.root, desc);
    for (var i = 0; i < list.length; i++) list[i].terrainVersion = CURRENT_TERRAIN_VERSION;
    return list;
  }

  function archiveMax() {
    return Voxel.Config && Voxel.Config.UNIVERSE &&
      typeof Voxel.Config.UNIVERSE.ARCHIVE_MAX_SYSTEMS === 'number'
      ? Math.max(1, Voxel.Config.UNIVERSE.ARCHIVE_MAX_SYSTEMS) : 24;
  }

  // LRU 裁剪其他恒星系档案；永不触碰当前系统（它不在 archive 里）。
  function pruneArchive(galaxy, nowTs) {
    if (!plainObject(galaxy) || !plainObject(galaxy.archive)) return galaxy;
    var max = archiveMax();
    var addrs = [];
    for (var key in galaxy.archive)
      if (own(galaxy.archive, key)) addrs.push(key);
    if (addrs.length <= max) return galaxy;
    addrs.sort(function (a, b) {
      var ta = plainObject(galaxy.archive[a]) ? (galaxy.archive[a].lastVisit || 0) : 0;
      var tb = plainObject(galaxy.archive[b]) ? (galaxy.archive[b].lastVisit || 0) : 0;
      return ta - tb;
    });
    while (addrs.length > max) delete galaxy.archive[addrs.shift()];
    return galaxy;
  }

  // 切换当前恒星系：把当前桶（discovered/worlds/discovery）存入 archive，
  // 取回目标系档案或全新初始化，并重建目录。arriveWorldId 必须存在于新目录。
  function switchSystem(galaxy, g, s, arriveWorldId, nowTs) {
    if (!galaxy || plainInt(g) === null || plainInt(s) === null) return null;
    var targetAddr = Voxel.Universe.addr(g, s);
    if (!targetAddr) return null;
    if (g === galaxy.curG && s === galaxy.curS) return galaxy;

    var ts = typeof nowTs === 'number' && isFinite(nowTs) ? nowTs : Date.now();
    if (!plainObject(galaxy.archive)) galaxy.archive = {};
    if (!plainObject(galaxy.visitedSys)) galaxy.visitedSys = {};

    // 归档当前系统
    galaxy.archive[sysAddr(galaxy)] = {
      discovered: plainObject(galaxy.discovered) ? galaxy.discovered : {},
      worlds: plainObject(galaxy.worlds) ? galaxy.worlds : {},
      discovery: galaxy.discovery || null,
      lastVisit: ts
    };

    // 恢复目标系统
    var bucket = plainObject(galaxy.archive[targetAddr]) ? galaxy.archive[targetAddr] : null;
    delete galaxy.archive[targetAddr];
    galaxy.curG = g;
    galaxy.curS = s;
    var desc = Voxel.Universe.describe(galaxy.rootSeed, g, s);
    galaxy.catalog = buildCatalog(desc.root, desc);
    stampCatalog(galaxy);
    galaxy.discovered = bucket && plainObject(bucket.discovered) ? bucket.discovered : {};
    galaxy.worlds = bucket && plainObject(bucket.worlds) ? bucket.worlds : {};
    galaxy.discovery = bucket ? (bucket.discovery || null) : null;
    galaxy.visitedSys[targetAddr] = true;

    var arriveId = find(galaxy, arriveWorldId) ? arriveWorldId :
      (find(galaxy, 'station-0') ? 'station-0' : galaxy.catalog[0].id);
    galaxy.currentId = arriveId;
    galaxy.discovered[arriveId] = true;
    pruneArchive(galaxy, ts);
    return galaxy;
  }

  // 存档前瘦身：删除「可从种子再生」的世界快照。保留有玩家痕迹的
  // （edits/meta/drops/床/飞船状态），以及当前世界本身。
  function stripRegenerable(worlds, keepId) {
    if (!plainObject(worlds)) return worlds;
    for (var id in worlds) {
      if (!own(worlds, id) || id === keepId) continue;
      var snap = worlds[id];
      if (!plainObject(snap)) { delete worlds[id]; continue; }
      var hasEdits = plainObject(snap.edits) && Object.keys(snap.edits).length > 0;
      var hasMeta = plainObject(snap.meta) && Object.keys(snap.meta).length > 0;
      var hasDrops = Array.isArray(snap.drops) && snap.drops.length > 0;
      var hasBed = Array.isArray(snap.bed);
      var hasShip = !!snap.shipFlight ||
        (plainObject(snap.player) && snap.player.aboard === true);
      if (!hasEdits && !hasMeta && !hasDrops && !hasBed && !hasShip) {
        // 昼夜时间与天气不是种子可再生数据；保留为最小快照，删除其余
        // 普通玩家/空容器字段，既维持按天体时间语义又完成存档瘦身。
        var lean = {};
        if (typeof snap.time === 'number' && isFinite(snap.time)) lean.time = snap.time;
        if (typeof snap.weather === 'string' && snap.weather) lean.weather = snap.weather;
        if (Object.keys(lean).length) worlds[id] = lean;
        else delete worlds[id];
      }
    }
    return worlds;
  }

  function copyOwnObject(value) {
    if (!plainObject(value)) return value;
    var out = Object.create(null);
    for (var key in value) if (own(value, key)) out[key] = value[key];
    return out;
  }

  function pruneForSave(galaxy) {
    if (!plainObject(galaxy)) return galaxy;
    // 只复制裁剪会触碰的容器；catalog/ship/发现数据保持只读引用，避免为一次
    // autosave 对整个大存档做 JSON 深拷贝，同时保证运行态绝不被裁剪修改。
    var out = copyOwnObject(galaxy);
    out.worlds = copyOwnObject(galaxy.worlds);
    stripRegenerable(out.worlds, galaxy.currentId);
    if (plainObject(galaxy.archive)) {
      out.archive = Object.create(null);
      for (var addr in galaxy.archive) {
        if (!own(galaxy.archive, addr)) continue;
        var bucket = galaxy.archive[addr];
        if (!plainObject(bucket)) { out.archive[addr] = bucket; continue; }
        var bucketCopy = copyOwnObject(bucket);
        bucketCopy.worlds = copyOwnObject(bucket.worlds);
        stripRegenerable(bucketCopy.worlds, null);
        out.archive[addr] = bucketCopy;
      }
      pruneArchive(out);
    }
    return out;
  }

  // 跨恒星系跃迁计划：曲速电池记账（与 routePlan 的普通燃料互不干扰）。
  function jumpPlan(galaxy, g, s) {
    if (!galaxy || plainInt(g) === null || plainInt(s) === null) {
      return { valid: false };
    }
    var fromAddr = sysAddr(galaxy), toAddr = Voxel.Universe.addr(g, s);
    if (!toAddr || toAddr === fromAddr) return { valid: false };
    var cells = boundedUnits(galaxy.ship && galaxy.ship.warpCells, 0, 0, 1000000);
    var cost = Voxel.Universe.jumpCells(
      { g: galaxy.curG, s: galaxy.curS }, { g: g, s: s });
    return {
      valid: true,
      fromAddr: fromAddr,
      toAddr: toAddr,
      cost: cost,
      cells: cells,
      shortfall: Math.max(0, cost - cells),
      reachable: cells >= cost
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
    routePlan: routePlan,
    sysAddr: sysAddr,
    sysDesc: sysDesc,
    catalogFor: catalogFor,
    switchSystem: switchSystem,
    pruneArchive: pruneArchive,
    pruneForSave: pruneForSave,
    jumpPlan: jumpPlan
  };
})();
