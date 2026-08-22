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
    BADLANDS: 17         // 恶地
  };

  // 方块 ID 引用（与 blocks.js 保持一致）
  var BLK = {
    GRASS: 1, DIRT: 2, STONE: 3, GRAVEL: 14, SAND: 6, SNOW: 18,
    SPRUCE_LOG: 20, JUNGLE_LOG: 22, PODZOL: 24, CACTUS: 26,
    RED_SAND: 28, TERRACOTTA: 29, ICE: 32, BIRCH_LOG: 33, ACACIA_LOG: 35
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
    mobs: ['sheep', 'pig', 'chicken']
  };
  defs[B.FOREST] = {
    name: '森林', surface: BLK.GRASS, filler: BLK.DIRT,
    treeType: 'oak', treeChance: 0.02, plantOn: [BLK.GRASS],
    mobs: ['sheep', 'pig', 'chicken']
  };
  defs[B.BIRCH_FOREST] = {
    name: '白桦森林', surface: BLK.GRASS, filler: BLK.DIRT,
    treeType: 'birch', treeChance: 0.016, plantOn: [BLK.GRASS],
    mobs: ['sheep', 'pig']
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
    mobs: ['chicken', 'pig', 'sheep']
  };
  defs[B.SPARSE_JUNGLE] = {
    name: '稀疏丛林', surface: BLK.GRASS, filler: BLK.DIRT,
    treeType: 'jungle', treeChance: 0.004, giantChance: 0.08,
    plantOn: [BLK.GRASS],
    mobs: ['pig', 'chicken']
  };
  defs[B.SAVANNA] = {
    name: '热带草原', surface: BLK.GRASS, filler: BLK.DIRT,
    treeType: 'acacia', treeChance: 0.0022, plantOn: [BLK.GRASS],
    mobs: ['sheep', 'chicken']
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

  // ---- 气候采样器：低频噪声通道，输出归一化到 [-1,1] ----
  // 世界仅 256×256，频率相对 MC 压缩以保证一张图内出现多样群系。
  // 增益(GAIN)：OctavePerlin 均值输出集中在 ±0.4 内，放大后极端气候点才可达
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
        t: g1(tCh.at2(x * 0.005, z * 0.005) * GAIN_T),
        h: g1(hCh.at2(x * 0.007 + 31.7, z * 0.007 + 11.3) * GAIN_H),
        c: g1(cCh.at2(x * 0.004 + 57.1, z * 0.004 + 73.9) * GAIN_C),
        e: g1(eCh.at2(x * 0.006 + 91.7, z * 0.006 + 17.3) * GAIN_E),
        w: g1(wCh.at2(x * 0.010 + 23.9, z * 0.010 + 47.7) * GAIN_W)
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

  function def(id) { return defs[id] || defs[B.PLAINS]; }

  return {
    B: B,
    BLK: BLK,
    defs: defs,
    points: points,
    makeClimate: makeClimate,
    pick: pick,
    def: def,
    count: defs.length,
    name: function (id) { return def(id).name; },
    SNOW_LEVEL: SNOW_LEVEL
  };
})();
