// 星系生成：由一个 64 位根种子稳定派生行星、空间站、门户与跃迁距离。
// 纯逻辑模块，无 DOM/THREE 依赖，可直接在 Node 测试中加载。
window.Voxel = window.Voxel || {};

Voxel.Galaxy = (function () {
  var CURRENT_TERRAIN_VERSION = 2;
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
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
  }

  function fuelCost(a, b) {
    return Math.max(8, Math.min(42, 6 + Math.ceil(distance(a, b) * 0.42)));
  }

  function portalsFor(galaxy, world) {
    if (!galaxy || !world) return [];
    var all = galaxy.catalog;
    var count = world.kind === 'station' ? 3 : 3 + (Voxel.SeedUtil.derive32(world.seed, 0x9911) % 2);
    var candidates = [];
    for (var i = 0; i < all.length; i++) if (all[i].id !== world.id) candidates.push(all[i]);
    var out = [];
    for (var p = 0; p < count; p++) {
      var r = Voxel.SeedUtil.derive32(world.seed, 0xaa00 + p);
      var dest = candidates[(r + p) % candidates.length];
      var ang = (Voxel.SeedUtil.derive32(world.seed, 0xbb00 + p) / 4294967296) * Math.PI * 2;
      var rad = 18 + (Voxel.SeedUtil.derive32(world.seed, 0xcc00 + p) % 30);
      out.push({
        id: world.id + '-gate-' + p,
        destinationId: dest.id,
        x: 128 + Math.round(Math.cos(ang) * rad),
        z: 128 + Math.round(Math.sin(ang) * rad)
      });
    }
    // 每颗行星至少有一扇门通往空间站。
    if (world.kind === 'planet' && out.length) out[out.length - 1].destinationId = 'station-0';
    return out;
  }

  return {
    CURRENT_TERRAIN_VERSION: CURRENT_TERRAIN_VERSION,
    normalizeTerrainVersion: normalizeTerrainVersion,
    TYPES: TYPES,
    create: create,
    hydrate: hydrate,
    find: find,
    distance: distance,
    fuelCost: fuelCost,
    portalsFor: portalsFor
  };
})();
