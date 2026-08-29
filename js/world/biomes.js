// 生物群系注册表：MultiNoise 气候参数空间最近邻选择（对齐 MC 1.18 MultiNoiseSource）
// 五维气候通道：温度 T / 湿度 H / 大陆性 C / 侵蚀度 E / 奇异性 W ∈ [-1,1]
// 无 DOM/THREE 依赖，可在 Node 冒烟测试中加载
window.Voxel = window.Voxel || {};

Voxel.Biomes = (function () {
  var SNOW_LEVEL = Voxel.Config.SNOW_LEVEL;

  // 群系 ID 枚举
  var B = {
    OCEAN: 0,            // 海洋
    BEACH: 1,            // 海滩
    STONY_SHORE: 2,      // 石岸
    PLAINS: 3,           // 平原
    FOREST: 4,           // 森林
    BIRCH_FOREST: 5,     // 白桦森林
    DESERT: 6,           // 沙漠
    JUNGLE: 7,           // 丛林
    SPARSE_JUNGLE: 8,    // 稀疏丛林
    SAVANNA: 9,          // 热带草原
    TAIGA: 10,           // 针叶林
    MEGA_TAIGA: 11,      // 原始针叶林
    SNOWY: 12,           // 雪原
    WINDSWEPT_HILLS: 13, // 风袭丘陵
    JAGGED_PEAKS: 14,    // 尖峭山峰
    FROZEN_PEAKS: 15,    // 冰封山峰
    STONY_PEAKS: 16,     // 石峰
    BADLANDS: 17,        // 恶地
    MUSHROOM_FIELDS: 18, // 蘑菇林
    SWAMP: 19,           // 沼泽
    CHERRY_GROVE: 20,    // 樱花树林
    DARK_FOREST: 21,     // 黑森林
    PLAYGROUND: 22       // 星海嘉年华（v7 新增）
  };

  // 方块 ID 引用（与 blocks.js 保持一致）
  var BLK = {
    GRASS: 1, DIRT: 2, STONE: 3, GRAVEL: 14, SAND: 6, SNOW: 18,
    SPRUCE_LOG: 20, JUNGLE_LOG: 22, PODZOL: 24, CACTUS: 26,
    RED_SAND: 28, TERRACOTTA: 29, ICE: 32, BIRCH_LOG: 33, ACACIA_LOG: 35,
    MYCELIUM: 53, MUSHROOM_STEM: 54, CAP_RED: 55, CAP_BROWN: 56,
    CHERRY_LOG: 57, CHERRY_LEAVES: 58, DARK_LEAVES: 59,
    // 星海嘉年华
    PARK_LAWN: 74, CREAM_PAVE: 75, PASTEL_BRICK: 76, CANDY_STRIPE: 77,
    GOLD_TRIM: 78, LANTERN: 79, RAIL_WHITE: 80, ROOF_BLUE: 81,
    NEON_PURPLE: 82, NEON_CYAN: 83, BUNTING: 84, RIDE_PAD: 85,
    CASTLE_PINK: 86, CASTLE_BLUE: 87
  };

  var defs = [];
  defs[B.OCEAN] = {
    name: '海洋', surface: BLK.SAND, filler: BLK.SAND, oceanFloor: true,
    mobs: []
  };
  defs[B.BEACH] = {
    name: '海滩', surface: BLK.SAND, filler: BLK.SAND,
    treeType: null, treeChance: 0, plantOn: [],
    mobs: ['rabbit']
  };
  defs[B.STONY_SHORE] = {
    name: '石岸', surface: BLK.STONE, filler: BLK.STONE,
    treeType: null, treeChance: 0, plantOn: [],
    mobs: ['sheep']
  };
  defs[B.PLAINS] = {
    name: '平原', surface: BLK.GRASS, filler: BLK.DIRT,
    treeType: 'oak', treeChance: 0.0015, plantOn: [BLK.GRASS],
    mobs: ['sheep', 'pig', 'chicken', 'cat']
  };
  defs[B.FOREST] = {
    name: '森林', surface: BLK.GRASS, filler: BLK.DIRT,
    treeType: 'oak', treeChance: 0.02, plantOn: [BLK.GRASS],
    mobs: ['sheep', 'pig', 'chicken', 'cat']
  };
  defs[B.BIRCH_FOREST] = {
    name: '白桦森林', surface: BLK.GRASS, filler: BLK.DIRT,
    treeType: 'birch', treeChance: 0.016, plantOn: [BLK.GRASS],
    mobs: ['sheep', 'pig', 'cat']
  };
  defs[B.DESERT] = {
    name: '沙漠', surface: BLK.SAND, filler: BLK.SAND,
    treeType: 'cactus', treeChance: 0.01, plantOn: [BLK.SAND],
    mobs: ['rabbit']
  };
  defs[B.JUNGLE] = {
    name: '丛林', surface: BLK.GRASS, filler: BLK.DIRT,
    treeType: 'jungle', treeChance: 0.02, giantChance: 0.25,
    plantOn: [BLK.GRASS],
    mobs: ['chicken', 'pig', 'sheep', 'cat']
  };
  defs[B.SPARSE_JUNGLE] = {
    name: '稀疏丛林', surface: BLK.GRASS, filler: BLK.DIRT,
    treeType: 'jungle', treeChance: 0.004, giantChance: 0.08,
    plantOn: [BLK.GRASS],
    mobs: ['pig', 'chicken', 'cat']
  };
  defs[B.SAVANNA] = {
    name: '热带草原', surface: BLK.GRASS, filler: BLK.DIRT,
    treeType: 'acacia', treeChance: 0.0022, plantOn: [BLK.GRASS],
    mobs: ['sheep', 'chicken', 'cat']
  };
  defs[B.TAIGA] = {
    name: '针叶林', surface: BLK.GRASS, filler: BLK.DIRT,
    treeType: 'spruce', treeChance: 0.012, plantOn: [BLK.GRASS],
    mobs: ['sheep', 'rabbit']
  };
  defs[B.MEGA_TAIGA] = {
    name: '原始针叶林', surface: BLK.PODZOL, filler: BLK.DIRT,
    treeType: 'mega_spruce', treeChance: 0.01, boulders: true,
    plantOn: [BLK.PODZOL, BLK.GRASS],
    mobs: ['sheep', 'pig', 'rabbit']
  };
  defs[B.SNOWY] = {
    name: '雪原', surface: BLK.SNOW, filler: BLK.DIRT,
    treeType: 'spruce', treeChance: 0.003, plantOn: [BLK.SNOW],
    mobs: ['rabbit', 'sheep']
  };
  defs[B.WINDSWEPT_HILLS] = {
    name: '风袭丘陵', surface: BLK.GRASS, filler: BLK.DIRT, gravelPatches: true,
    treeType: 'spruce', treeChance: 0.003, plantOn: [BLK.GRASS],
    mobs: ['sheep']
  };
  defs[B.JAGGED_PEAKS] = {
    name: '尖峭山峰', surface: BLK.STONE, filler: BLK.STONE,
    treeType: 'spruce', treeChance: 0.0004, plantOn: [BLK.GRASS],
    mobs: []
  };
  defs[B.FROZEN_PEAKS] = {
    name: '冰封山峰', surface: BLK.SNOW, filler: BLK.ICE,
    treeType: null, treeChance: 0, plantOn: [],
    mobs: []
  };
  defs[B.STONY_PEAKS] = {
    name: '石峰', surface: BLK.STONE, filler: BLK.STONE,
    treeType: null, treeChance: 0, plantOn: [],
    mobs: []
  };
  defs[B.BADLANDS] = {
    name: '恶地', surface: BLK.RED_SAND, filler: BLK.TERRACOTTA, badlandsBands: true,
    treeType: null, treeChance: 0, plantOn: [],
    mobs: ['rabbit']
  };
  defs[B.MUSHROOM_FIELDS] = {
    name: '蘑菇林', surface: BLK.MYCELIUM, filler: BLK.DIRT,
    treeType: 'giant_mushroom', treeChance: 0.006, plantOn: [BLK.MYCELIUM],
    mobs: []
  };
  defs[B.SWAMP] = {
    name: '沼泽', surface: BLK.GRASS, filler: BLK.DIRT,
    treeType: 'swamp_oak', treeChance: 0.004, plantOn: [BLK.GRASS],
    mobs: ['pig', 'chicken', 'sheep']
  };
  defs[B.CHERRY_GROVE] = {
    name: '樱花树林', surface: BLK.GRASS, filler: BLK.DIRT,
    treeType: 'cherry', treeChance: 0.01, plantOn: [BLK.GRASS],
    mobs: ['sheep', 'rabbit', 'cat']
  };
  defs[B.DARK_FOREST] = {
    name: '黑森林', surface: BLK.GRASS, filler: BLK.DIRT,
    treeType: 'dark_oak', treeChance: 0.03, boulders: true,
    plantOn: [BLK.GRASS],
    mobs: ['sheep', 'pig']
  };

  // 星海嘉年华：欢乐园区地貌——平原暖坡上的嘉年华乐园群。
  // 植被关闭（plantOn 空），园貌由 Structures 的园区结构负责铺陈；
  // 保留少量羊/兔子在围栏外的草坪上走动，避免园区死寂。
  defs[B.PLAYGROUND] = {
    name: '星海嘉年华', surface: BLK.PARK_LAWN, filler: BLK.DIRT,
    treeType: null, treeChance: 0, plantOn: [],
    mobs: ['sheep', 'rabbit']
  };

  // ---- 气候参数点：每个群系在五维气候空间的目标位置 ----
  // 顺序：[温度 T, 湿度 H, 大陆性 C, 侵蚀度 E, 奇异性 W]
  var points = [];
  points[B.OCEAN] = [0, 0, -0.85, 0.35, 0];
  points[B.BEACH] = [0, 0, -0.25, 0.85, 0];
  points[B.STONY_SHORE] = [0, 0, -0.25, -0.65, 0];
  points[B.PLAINS] = [0, -0.15, 0.15, 0.55, 0];
  points[B.FOREST] = [0, 0.45, 0.15, 0.35, 0];
  points[B.BIRCH_FOREST] = [-0.15, 0.6, 0.2, 0.35, 0.45];
  points[B.DESERT] = [0.85, -0.7, 0.3, 0.45, 0];
  points[B.JUNGLE] = [0.9, 0.75, 0.1, 0.35, 0];
  points[B.SPARSE_JUNGLE] = [0.75, 0.3, 0.1, 0.45, 0];
  points[B.SAVANNA] = [0.55, -0.3, 0.15, 0.4, 0];
  points[B.TAIGA] = [-0.5, 0.1, 0.15, 0.35, 0];
  points[B.MEGA_TAIGA] = [-0.7, 0.45, 0.15, 0.25, 0];
  points[B.SNOWY] = [-0.95, -0.15, 0.15, 0.5, 0];
  points[B.WINDSWEPT_HILLS] = [0, 0, 0.35, -0.5, 0];
  points[B.JAGGED_PEAKS] = [-0.25, 0, 0.55, -0.9, 0.85];
  points[B.FROZEN_PEAKS] = [-0.9, 0, 0.55, -0.9, 0.75];
  points[B.STONY_PEAKS] = [0.8, 0, 0.55, -0.9, 0.65];
  points[B.BADLANDS] = [0.95, -0.95, 0.35, -0.35, 0.5];
  // 群系扩展（2026-08）：气候点取自种子 12345 气候场的实测空隙，
  // 保证含全部 22 个群系的同时，每个群系在 20..235 主活动窗内都有连片区域
  // （精选世界按该窗口选择出生点），18 个旧群系的覆盖面积不受明显挤压。
  points[B.MUSHROOM_FIELDS] = [0.98, 0.6, -0.3, 0.52, -0.78]; // 温暖湿润的近海孤岛
  points[B.SWAMP] = [0.77, 0.3, -0.53, 0.23, 0.33];           // 暖湿低地沼带
  points[B.CHERRY_GROVE] = [0.93, 0.32, -0.11, 0.9, 0.73];    // 温和湿润的开阔坡地
  points[B.DARK_FOREST] = [0.05, 0.75, -0.05, 0.35, 0.52];    // 凉爽湿润内陆密林
  // v7：星海嘉年华。气候点取自种子 12345 五维场实测空隙（tools/find_biome_point.js）：
  // 主活动窗内约 830+ 干地胜出格连片（x[78,144] z[138,285]），高侵蚀=平坦开阔，
  // 与樱花林/草原吸引域边界清晰；乐园园区结构只落在本群系干地上。
  points[B.PLAYGROUND] = [0.32, -0.42, 0.12, 0.9, 0.82];

  // ---- 气候采样器：低频噪声通道，输出归一化到 [-1,1] ----
  // 世界仅 256×256，频率相对 MC 压缩以保证一张图内出现多样群系。
  // 增益(GAIN)：OctavePerlin 均值输出集中在 ±0.4 内，放大后极端气候点才可达。
  // 频率除以 3（第 23 轮）：五维 Voronoi 单元线性尺度 ×3，各群系连片面积约 ×9，
  // 让蘑菇林/樱花/黑森林等稀有群系获得接近 10x 的实际占地。
  function makeClimate(noise) {
    var N = Voxel.Noise.SALT;
    var tCh = noise.channel(N.TEMP, 3);
    var hCh = noise.channel(N.HUMID, 3);
    var cCh = noise.channel(N.CONT, 3);
    var eCh = noise.channel(N.EROSION, 3);
    var wCh = noise.channel(N.WEIRD, 3);
    var GAIN_T = 2.4, GAIN_H = 2.5, GAIN_C = 2.6, GAIN_E = 2.5, GAIN_W = 2.2;
    function g1(v) { return v > 1 ? 1 : (v < -1 ? -1 : v); }
    return function (x, z) {
      return {
        t: g1(tCh.at2(x * 0.00167, z * 0.00167) * GAIN_T),
        h: g1(hCh.at2(x * 0.00233 + 31.7 / 3, z * 0.00233 + 11.3 / 3) * GAIN_H),
        c: g1(cCh.at2(x * 0.00133 + 57.1 / 3, z * 0.00133 + 73.9 / 3) * GAIN_C),
        e: g1(eCh.at2(x * 0.002 + 91.7 / 3, z * 0.002 + 17.3 / 3) * GAIN_E),
        w: g1(wCh.at2(x * 0.00333 + 23.9 / 3, z * 0.00333 + 47.7 / 3) * GAIN_W)
      };
    };
  }

  // 最近邻匹配：欧氏距离平方最小的群系胜出（MC ParameterPoint 的简化版）
  function pick(cl) {
    var best = B.PLAINS, bestD = Infinity;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (!p) continue;
      var dt = cl.t - p[0], dh = cl.h - p[1], dc = cl.c - p[2], de = cl.e - p[3], dw = cl.w - p[4];
      var d = dt * dt + dh * dh + dc * dc + de * de + dw * dw;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // 在给定白名单中做同一套五维最近邻选择。与按方块哈希随机改写群系相比，
  // 连续气候场只会在 Voronoi 边界处切换，供 terrainVersion=2 的行星规则复用。
  // 不可信/缺失气候不会产生 NaN 扩散，而是回退到允许集合中的 fallback/首项。
  function distanceSq(cl, id) {
    var p = points[id];
    if (!p || !cl || typeof cl !== 'object') return Infinity;
    var t = cl.t, h = cl.h, c = cl.c, e = cl.e, w = cl.w;
    if (typeof t !== 'number' || !isFinite(t) || typeof h !== 'number' || !isFinite(h) ||
      typeof c !== 'number' || !isFinite(c) || typeof e !== 'number' || !isFinite(e) ||
      typeof w !== 'number' || !isFinite(w)) return Infinity;
    var dt = t - p[0], dh = h - p[1], dc = c - p[2];
    var de = e - p[3], dw = w - p[4];
    return dt * dt + dh * dh + dc * dc + de * de + dw * dw;
  }

  function pickAllowed(cl, allowed, fallback) {
    var fallbackValid = typeof fallback === 'number' && isFinite(fallback) &&
      Math.floor(fallback) === fallback && !!points[fallback];
    if (!Array.isArray(allowed) || !allowed.length) return fallbackValid ? fallback : B.PLAINS;
    var firstValid = -1, fallbackAllowed = false, best = -1, bestD = Infinity;
    // 热路径：每个世界约 65k 列。不得创建 valid/vals 等临时数组，也不改写调用方白名单。
    for (var i = 0; i < allowed.length; i++) {
      var id = allowed[i];
      if (typeof id !== 'number' || !isFinite(id) || Math.floor(id) !== id || !points[id]) continue;
      var duplicate = false;
      for (var prior = 0; prior < i; prior++) {
        if (allowed[prior] === id) { duplicate = true; break; }
      }
      if (duplicate) continue;
      if (firstValid < 0) firstValid = id;
      if (fallbackValid && id === fallback) fallbackAllowed = true;
      var d = distanceSq(cl, id);
      if (d < bestD) { bestD = d; best = id; }
    }
    if (firstValid < 0) return fallbackValid ? fallback : B.PLAINS;
    if (bestD < Infinity) return best;
    return fallbackAllowed ? fallback : firstValid;
  }

  function def(id) { return defs[id] || defs[B.PLAINS]; }

  // ---- 精选世界出生列搜索（纯逻辑，Node 可测） ----
  // 群系由纯气候最近邻决定而不看地形高度，整片气候单元可能沉在水位之下
  // （标签对但只有海床，种子 12345 蘑菇林实机回归）。opts.dry 时要求候选
  // 自体 api.predictedHeightAt > 水位（可种植群系 >水位+3，低地会被生成器
  // 改写成沙滩），支持分按「标签&干地」邻居占比；胜出列终验真实 biomeAt
  // + surfaceAt。dry 链落空回退旧标签评分；api 缺探针时退化为旧行为。
  function pickSpawnColumn(api, want, opts) {
    if (!api || typeof api.biomeAt !== 'function') return null;
    var step = opts && typeof opts.step === 'number' && opts.step > 0 ? opts.step : 4;
    var x0 = opts && typeof opts.x0 === 'number' ? opts.x0 : 0;
    var x1 = opts && typeof opts.x1 === 'number' ? opts.x1 : 255;
    var canProbe = typeof api.climateAt === 'function' &&
      typeof api.pick === 'function';
    var dry = !!(opts && opts.dry) && canProbe && !!defs[want] &&
      typeof api.predictedHeightAt === 'function';
    var WATER = Voxel.Config.WATER_LEVEL;
    var minSelf = dry && defs[want].plantOn && defs[want].plantOn.length
      ? WATER + 3 : WATER;
    function pickAt(x, z) {
      if (!canProbe) return api.biomeAt(x, z);
      var cl = api.climateAt(x, z);
      return cl ? api.pick(cl) : api.biomeAt(x, z);
    }
    function offer(top, cand) {
      var prev = null, cur = top, n = 0;
      while (cur && cur.score >= cand.score && n < 3) { prev = cur; cur = cur.next; n++; }
      if (n >= 3) return top;
      cand.next = cur;
      if (prev) prev.next = cand; else top = cand;
      var tail = top, cnt = 1;
      while (tail.next) { if (++cnt >= 3) { tail.next = null; break; } tail = tail.next; }
      return top;
    }
    var topAll = null, topDry = null;
    for (var x = x0; x <= x1; x += step) {
      for (var z = x0; z <= x1; z += step) {
        if (pickAt(x, z) !== want) continue;
        var same = 0, sup = 0, total = 0, dx, dz;
        for (dx = -16; dx <= 16; dx += 8)
          for (dz = -16; dz <= 16; dz += 8) {
            total++;
            if (pickAt(x + dx, z + dz) === want) {
              same++;
              if (dry && api.predictedHeightAt(x + dx, z + dz) > WATER) sup++;
            }
          }
        topAll = offer(topAll, { score: same / total, x: x, z: z, next: null });
        if (dry && api.predictedHeightAt(x, z) > minSelf)
          topDry = offer(topDry, { score: sup / total, x: x, z: z, next: null });
      }
    }
    function verify(chain, needLand) {
      for (var c = chain; c; c = c.next) {
        if (api.biomeAt(c.x, c.z) !== want) continue;
        if (!needLand || (api.surfaceAt && api.surfaceAt(c.x, c.z) > WATER))
          return { x: c.x, z: c.z };
      }
      return null;
    }
    return verify(topDry, true) || verify(topAll, false);
  }

  return {
    B: B,
    BLK: BLK,
    defs: defs,
    points: points,
    makeClimate: makeClimate,
    pick: pick,
    pickAllowed: pickAllowed,
    distanceSq: distanceSq,
    def: def,
    pickSpawnColumn: pickSpawnColumn,
    count: defs.length,
    name: function (id) { return def(id).name; },
    SNOW_LEVEL: SNOW_LEVEL
  };
})();
