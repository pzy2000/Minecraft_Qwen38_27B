// 生物群系注册表：气候（温度/湿度）+ 海拔 选择群系
// 无 DOM/THREE 依赖，可在 Node 冒烟测试中加载
window.Voxel = window.Voxel || {};

Voxel.Biomes = (function () {
  var WATER = Voxel.Config.WATER_LEVEL;
  var SNOW_LEVEL = Voxel.Config.SNOW_LEVEL;

  // 群系 ID 枚举
  var B = {
    PLAINS: 0,      // 平原
    FOREST: 1,      // 森林
    DESERT: 2,      // 沙漠
    SNOWY: 3,       // 雪原
    TAIGA: 4,       // 针叶林
    MEGA_TAIGA: 5,  // 原始巨型针叶林
    JUNGLE: 6,      // 丛林
    MOUNTAINS: 7    // 山地
  };

  // 方块 ID 引用（与 blocks.js 保持一致）
  var BLK = {
    GRASS: 1, DIRT: 2, STONE: 3, SAND: 6, SNOW: 18,
    SPRUCE_LOG: 20, JUNGLE_LOG: 22, PODZOL: 24, CACTUS: 26
  };

  var defs = [];
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
  defs[B.DESERT] = {
    name: '沙漠', surface: BLK.SAND, filler: BLK.SAND,
    treeType: 'cactus', treeChance: 0.006, plantOn: [BLK.SAND],
    mobs: ['rabbit']
  };
  defs[B.SNOWY] = {
    name: '雪原', surface: BLK.SNOW, filler: BLK.DIRT,
    treeType: 'spruce', treeChance: 0.003, plantOn: [BLK.SNOW],
    mobs: ['rabbit', 'sheep']
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
  defs[B.JUNGLE] = {
    name: '丛林', surface: BLK.GRASS, filler: BLK.DIRT,
    treeType: 'jungle', treeChance: 0.02, giantChance: 0.25,
    plantOn: [BLK.GRASS],
    mobs: ['chicken', 'pig', 'sheep']
  };
  defs[B.MOUNTAINS] = {
    name: '山地', surface: BLK.STONE, filler: BLK.STONE,
    treeType: 'spruce', treeChance: 0.0008,
    plantOn: [BLK.GRASS, BLK.SNOW, BLK.PODZOL],
    mobs: ['sheep']
  };

  var MOUNTAIN_H = 46;   // 此海拔以上视为山地
  var COLD_T = 0.40;     // 寒冷阈值（温度）
  var HOT_T = 0.60;      // 炎热阈值（温度）
  var DRY_M = 0.42;      // 干燥阈值（湿度）
  var WET_M = 0.56;      // 潮湿阈值（湿度）

  // 气候选择：t 温度 / m 湿度 ∈ [0,1)，h 海拔
  function pick(t, m, h) {
    if (h >= MOUNTAIN_H) return B.MOUNTAINS;
    if (h <= WATER + 2) {                       // 海滩/浅滩按气候归类，表层由地形生成覆盖为沙
      if (t < COLD_T) return B.SNOWY;
      if (t > HOT_T && m < DRY_M) return B.DESERT;
      return B.PLAINS;
    }
    if (t < COLD_T) return m > WET_M + 0.04 ? B.MEGA_TAIGA : (h >= SNOW_LEVEL - 5 ? B.SNOWY : B.TAIGA);
    if (t > HOT_T && m < DRY_M) return B.DESERT;
    if (t > HOT_T - 0.03 && m > WET_M) return B.JUNGLE;
    if (m > WET_M - 0.06) return B.FOREST;
    return B.PLAINS;
  }

  // 世界生成时调用：返回该列的群系 ID 并写入缓存由 world 管理
  function select(x, z, h, noise) {
    var t = noise.tempAt(x * 0.0028 + 13.7, z * 0.0028 + 71.3, 3);
    var m = noise.moistAt(x * 0.0035 + 47.9, z * 0.0035 + 29.1, 3);
    return pick(t, m, h);
  }

  function def(id) { return defs[id] || defs[B.PLAINS]; }

  return {
    B: B,
    BLK: BLK,
    defs: defs,
    def: def,
    select: select,
    count: defs.length,
    name: function (id) { return def(id).name; }
  };
})();
