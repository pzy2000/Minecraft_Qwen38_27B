// 方块定义 + 程序化 16x16 像素纹理图集
window.Voxel = window.Voxel || {};

Voxel.Blocks = (function () {
  var T = {
    GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, LOG_SIDE: 4, LOG_TOP: 5,
    LEAVES: 6, SAND: 7, WATER: 8, COAL: 9, IRON: 10, PLANKS: 11, COBBLE: 12,
    BEDROCK: 13, GLASS: 14, GRAVEL: 15,
    TABLE_TOP: 16, TABLE_SIDE: 17, WOOL: 18, BED_TOP: 19, BED_SIDE: 20,
    BED_TOP_PX: 101, BED_TOP_NZ: 102, BED_TOP_PZ: 103,
    BED_TOP_FOOT: 104, BED_SIDE_FOOT: 105,
    SNOW: 21,
    STICK: 22, PICK_WOOD: 23, PICK_STONE: 24, PICK_IRON: 25,
    SWORD_WOOD: 26, SWORD_STONE: 27, SWORD_IRON: 28, TORCH: 29,
    SPRUCE_LOG_SIDE: 30, SPRUCE_LOG_TOP: 31, SPRUCE_LEAVES: 32,
    JUNGLE_LOG_SIDE: 33, JUNGLE_LOG_TOP: 34, JUNGLE_LEAVES: 35,
    PODZOL_TOP: 36, PODZOL_SIDE: 37, MOSSY_COBBLE: 38,
    CACTUS_SIDE: 39, CACTUS_TOP: 40,
    SANDSTONE_SIDE: 41, SANDSTONE_TOP: 42,
    TERRACOTTA: 43, TERRACOTTA_YELLOW: 44, TERRACOTTA_BROWN: 45,
    RED_SAND: 46, ICE: 47,
    ACACIA_LOG_SIDE: 48, ACACIA_LOG_TOP: 49, ACACIA_LEAVES: 50,
    BIRCH_LOG_SIDE: 51, BIRCH_LOG_TOP: 52, BIRCH_LEAVES: 53,
    INGOT: 58,
    MEAT_RAW: 59, MEAT_COOKED: 60,
    CHICKEN_RAW: 61, CHICKEN_COOKED: 62,
    RABBIT_RAW: 63, RABBIT_COOKED: 64,
    FURNACE_TOP: 65, FURNACE_SIDE: 66, FURNACE_FRONT: 67,
    CHEST_TOP: 68, CHEST_SIDE: 69, CHEST_FRONT: 70,
    ACTIVE_CRYSTAL: 71, SILICA_CRYSTAL: 72, ICE_CORE: 73,
    SPORE_CRYSTAL: 74, MAGMA_CORE: 75, TIDAL_CRYSTAL: 76,
    CAT_FUR: 77, FELT: 78, WARP_CELL: 79,
    ALIEN_LOG_SIDE: 54, ALIEN_LOG_TOP: 55, GLOW_CAP: 56,
    RUIN_BRICK: 57, BASALT: 80, CORAL: 81,
    RUIN_BRICK_MOSSY: 82, DEAD_LOG_SIDE: 83, DEAD_LOG_TOP: 84,
    MYCELIUM_TOP: 85, MYCELIUM_SIDE: 86, MUSHROOM_STEM: 87,
    MUSHROOM_CAP_RED: 88, MUSHROOM_CAP_BROWN: 89,
    CHERRY_LOG_SIDE: 90, CHERRY_LOG_TOP: 91, CHERRY_LEAVES: 92, DARK_LEAVES: 93,
    STATION_HULL: 94, STATION_GRATE: 95, STATION_SEAM: 96, STATION_HAZARD: 97,
    STATION_TRIM: 98, STATION_PORT: 99, STATION_DARK: 100
  };

  // hard: 徒手挖掘秒数（Infinity=不可破坏）；pick: 镐可加速；tier: 需要的最低镐等级(1木2石3铁)
  var defs = [
    { name: '空气', solid: false, opaque: false, tiles: null, sound: null, color: 0x000000 },
    { name: '草方块', solid: true, opaque: true, tiles: [T.GRASS_TOP, T.GRASS_SIDE, T.GRASS_SIDE], sound: 'dirt', color: 0x6fae4e, hard: 0.75 },
    { name: '泥土', solid: true, opaque: true, tiles: [T.DIRT, T.DIRT, T.DIRT], sound: 'dirt', color: 0x8a6043, hard: 0.65 },
    { name: '石头', solid: true, opaque: true, tiles: [T.STONE, T.STONE, T.STONE], sound: 'stone', color: 0x7f7f7f, hard: 4, pick: true },
    { name: '橡木', solid: true, opaque: true, tiles: [T.LOG_TOP, T.LOG_SIDE, T.LOG_TOP], sound: 'wood', color: 0x7a5c38, hard: 1.6 },
    { name: '树叶', solid: true, opaque: true, leaves: true, tiles: [T.LEAVES, T.LEAVES, T.LEAVES], sound: 'leaves', color: 0x3f8f2f, hard: 0.35 },
    { name: '沙子', solid: true, opaque: true, tiles: [T.SAND, T.SAND, T.SAND], sound: 'sand', color: 0xdacfa3, hard: 0.6 },
    { name: '水', solid: false, opaque: false, tiles: [T.WATER, T.WATER, T.WATER], sound: 'water', color: 0x3d7dd8 },
    { name: '煤矿石', solid: true, opaque: true, tiles: [T.COAL, T.COAL, T.COAL], sound: 'stone', color: 0x3a3a3a, hard: 5, pick: true, tier: 1, drop: 107 },
    { name: '铁矿石', solid: true, opaque: true, tiles: [T.IRON, T.IRON, T.IRON], sound: 'stone', color: 0xd8af87, hard: 6, pick: true, tier: 2 },
    { name: '木板', solid: true, opaque: true, tiles: [T.PLANKS, T.PLANKS, T.PLANKS], sound: 'wood', color: 0xa2824e, hard: 1.5 },
    { name: '圆石', solid: true, opaque: true, tiles: [T.COBBLE, T.COBBLE, T.COBBLE], sound: 'stone', color: 0x6f6f6f, hard: 4.5, pick: true },
    { name: '基岩', solid: true, opaque: true, tiles: [T.BEDROCK, T.BEDROCK, T.BEDROCK], sound: 'stone', color: 0x3c3c3c, hard: Infinity },
    { name: '玻璃', solid: true, opaque: false, tiles: [T.GLASS, T.GLASS, T.GLASS], sound: 'glass', color: 0xbfe3ee, hard: 0.45 },
    { name: '沙砾', solid: true, opaque: true, tiles: [T.GRAVEL, T.GRAVEL, T.GRAVEL], sound: 'dirt', color: 0x857f77, hard: 0.5 },
    { name: '工作台', solid: true, opaque: true, tiles: [T.TABLE_TOP, T.TABLE_SIDE, T.TABLE_SIDE], sound: 'wood', color: 0xb08d57, hard: 1.5 },
    { name: '羊毛', solid: true, opaque: true, tiles: [T.WOOL, T.WOOL, T.WOOL], sound: 'wool', color: 0xf0f0f0, hard: 0.7 },
    // 床头半格（枕头朝 -x）。17 同时是床的物品/合成产物 ID；
    // 旧存档里的单格床按此方块渲染，兼容不动。
    { name: '床', solid: true, opaque: false, half: true, bed: 'head',
      tiles: [T.BED_TOP, T.BED_SIDE, T.BED_SIDE], sound: 'wood', color: 0xc0504d, hard: 0.8 },
    { name: '雪块', solid: true, opaque: true, tiles: [T.SNOW, T.SNOW, T.SNOW], sound: 'snow', color: 0xeef4f8, hard: 0.35 },
    { name: '火把', solid: false, opaque: false, cross: true, light: 14,
      tiles: [T.TORCH, T.TORCH, T.TORCH], sound: 'wood', color: 0xffcc66, hard: 0.05, icon: T.TORCH },
    { name: '云杉木', solid: true, opaque: true, tiles: [T.SPRUCE_LOG_TOP, T.SPRUCE_LOG_SIDE, T.SPRUCE_LOG_TOP], sound: 'wood', color: 0x5a4428, hard: 1.6 },
    { name: '云杉树叶', solid: true, opaque: true, leaves: true, tiles: [T.SPRUCE_LEAVES, T.SPRUCE_LEAVES, T.SPRUCE_LEAVES], sound: 'leaves', color: 0x2e6154, hard: 0.35 },
    { name: '丛林木', solid: true, opaque: true, tiles: [T.JUNGLE_LOG_TOP, T.JUNGLE_LOG_SIDE, T.JUNGLE_LOG_TOP], sound: 'wood', color: 0x8a6b3c, hard: 1.6 },
    { name: '丛林树叶', solid: true, opaque: true, leaves: true, tiles: [T.JUNGLE_LEAVES, T.JUNGLE_LEAVES, T.JUNGLE_LEAVES], sound: 'leaves', color: 0x3da02f, hard: 0.35 },
    { name: '灰化土', solid: true, opaque: true, tiles: [T.PODZOL_TOP, T.PODZOL_SIDE, T.DIRT], sound: 'dirt', color: 0x7a5a34, hard: 0.65 },
    { name: '苔石', solid: true, opaque: true, tiles: [T.MOSSY_COBBLE, T.MOSSY_COBBLE, T.MOSSY_COBBLE], sound: 'stone', color: 0x6d7d5f, hard: 4.5, pick: true },
    { name: '仙人掌', solid: true, opaque: true, tiles: [T.CACTUS_TOP, T.CACTUS_SIDE, T.CACTUS_TOP], sound: 'wool', color: 0x4a7f28, hard: 0.5 },
    { name: '砂岩', solid: true, opaque: true, tiles: [T.SANDSTONE_TOP, T.SANDSTONE_SIDE, T.SANDSTONE_TOP], sound: 'stone', color: 0xd6cb9c, hard: 3, pick: true },

    // ---- MultiNoise 地质群系新方块 ----
    { name: '红沙', solid: true, opaque: true, tiles: [T.RED_SAND, T.RED_SAND, T.RED_SAND], sound: 'sand', color: 0xc67f51, hard: 0.6 },
    { name: '陶瓦', solid: true, opaque: true, tiles: [T.TERRACOTTA, T.TERRACOTTA, T.TERRACOTTA], sound: 'stone', color: 0xa15c3e, hard: 3, pick: true },
    { name: '黄陶瓦', solid: true, opaque: true, tiles: [T.TERRACOTTA_YELLOW, T.TERRACOTTA_YELLOW, T.TERRACOTTA_YELLOW], sound: 'stone', color: 0xbf8a3b, hard: 3, pick: true },
    { name: '棕陶瓦', solid: true, opaque: true, tiles: [T.TERRACOTTA_BROWN, T.TERRACOTTA_BROWN, T.TERRACOTTA_BROWN], sound: 'stone', color: 0x714d2e, hard: 3, pick: true },
    { name: '浮冰', solid: true, opaque: true, tiles: [T.ICE, T.ICE, T.ICE], sound: 'glass', color: 0x9fc4ee, hard: 1.5, pick: true },
    { name: '白桦木', solid: true, opaque: true, tiles: [T.BIRCH_LOG_TOP, T.BIRCH_LOG_SIDE, T.BIRCH_LOG_TOP], sound: 'wood', color: 0xd7cdb4, hard: 1.6 },
    { name: '白桦树叶', solid: true, opaque: true, leaves: true, tiles: [T.BIRCH_LEAVES, T.BIRCH_LEAVES, T.BIRCH_LEAVES], sound: 'leaves', color: 0x74a644, hard: 0.35 },
    { name: '金合欢木', solid: true, opaque: true, tiles: [T.ACACIA_LOG_TOP, T.ACACIA_LOG_SIDE, T.ACACIA_LOG_TOP], sound: 'wood', color: 0x9a5b38, hard: 1.6 },
    { name: '金合欢树叶', solid: true, opaque: true, leaves: true, tiles: [T.ACACIA_LEAVES, T.ACACIA_LEAVES, T.ACACIA_LEAVES], sound: 'leaves', color: 0x5f9426, hard: 0.35 },
    { name: '熔炉', solid: true, opaque: true, tiles: [T.FURNACE_TOP, T.FURNACE_FRONT, T.FURNACE_TOP], sound: 'stone', color: 0x6e6e70, hard: 4.5, pick: true },
    { name: '箱子', solid: true, opaque: true, tiles: [T.CHEST_TOP, T.CHEST_FRONT, T.CHEST_TOP], sound: 'wood', color: 0xa8763f, hard: 2 }
  ];

  // ---- terrainVersion 2 行星专属资源（稳定方块 ID 39..44）----
  // 只在旧注册表尾部追加，不得复用/移动旧 ID；自然生成由 PlanetRules 按版本决定。
  defs[39] = { name: '活性晶簇', solid: true, opaque: true,
    tiles: [T.ACTIVE_CRYSTAL, T.ACTIVE_CRYSTAL, T.ACTIVE_CRYSTAL], sound: 'stone',
    color: 0x63e78f, hard: 4.8, pick: true, tier: 1, drop: 115, resourceKey: 'verdant_crystal' };
  defs[40] = { name: '硅晶矿', solid: true, opaque: true,
    tiles: [T.SILICA_CRYSTAL, T.SILICA_CRYSTAL, T.SILICA_CRYSTAL], sound: 'stone',
    color: 0xe4bd75, hard: 5.0, pick: true, tier: 1, drop: 116, resourceKey: 'silica_crystal' };
  defs[41] = { name: '冰核矿', solid: true, opaque: true,
    tiles: [T.ICE_CORE, T.ICE_CORE, T.ICE_CORE], sound: 'glass',
    color: 0x8fdcf2, hard: 5.4, pick: true, tier: 2, drop: 117, resourceKey: 'frost_core' };
  defs[42] = { name: '孢子晶矿', solid: true, opaque: true,
    tiles: [T.SPORE_CRYSTAL, T.SPORE_CRYSTAL, T.SPORE_CRYSTAL], sound: 'stone',
    color: 0xa8dc55, hard: 5.2, pick: true, tier: 2, drop: 118, resourceKey: 'spore_crystal' };
  defs[43] = { name: '熔核矿', solid: true, opaque: true,
    tiles: [T.MAGMA_CORE, T.MAGMA_CORE, T.MAGMA_CORE], sound: 'stone',
    color: 0xff6138, hard: 7.0, pick: true, tier: 3, drop: 119, resourceKey: 'magma_core' };
  defs[44] = { name: '潮汐晶矿', solid: true, opaque: true,
    tiles: [T.TIDAL_CRYSTAL, T.TIDAL_CRYSTAL, T.TIDAL_CRYSTAL], sound: 'glass',
    color: 0x55c9df, hard: 5.8, pick: true, tier: 2, drop: 120, resourceKey: 'tidal_crystal' };
  defs[45] = { name: '猫毛毡', solid: true, opaque: true,
    tiles: [T.FELT, T.FELT, T.FELT], sound: 'wool', color: 0xc4b8a6, hard: 0.7 };

  // ---- 外星巨型植物 / 遗迹方块（稳定方块 ID 46..52）----
  // 只在旧注册表尾部追加，不得复用/移动旧 ID。自然生成由 Structures 按版本决定
  // （仅 terrainVersion=2 的行星外围），旧存档地形逐位不变。
  defs[46] = { name: '外星茎干', solid: true, opaque: true,
    tiles: [T.ALIEN_LOG_TOP, T.ALIEN_LOG_SIDE, T.ALIEN_LOG_TOP], sound: 'wood',
    color: 0x8a7a9e, hard: 1.6 };
  defs[47] = { name: '荧光菌伞', solid: true, opaque: true,
    tiles: [T.GLOW_CAP, T.GLOW_CAP, T.GLOW_CAP], sound: 'wool', light: 13,
    color: 0x59d6c4, hard: 0.5 };
  defs[48] = { name: '玄武岩柱', solid: true, opaque: true,
    tiles: [T.BASALT, T.BASALT, T.BASALT], sound: 'stone', color: 0x4c4a52,
    hard: 4.2, pick: true };
  defs[49] = { name: '珊瑚块', solid: true, opaque: true,
    tiles: [T.CORAL, T.CORAL, T.CORAL], sound: 'stone', color: 0xd97a6c,
    hard: 3, pick: true };
  defs[50] = { name: '遗迹石砖', solid: true, opaque: true,
    tiles: [T.RUIN_BRICK, T.RUIN_BRICK, T.RUIN_BRICK], sound: 'stone', color: 0x8f9094,
    hard: 4.5, pick: true };
  defs[51] = { name: '苔痕遗迹石砖', solid: true, opaque: true,
    tiles: [T.RUIN_BRICK_MOSSY, T.RUIN_BRICK_MOSSY, T.RUIN_BRICK_MOSSY], sound: 'stone',
    color: 0x77855f, hard: 4.5, pick: true };
  defs[52] = { name: '枯巨木', solid: true, opaque: true,
    tiles: [T.DEAD_LOG_TOP, T.DEAD_LOG_SIDE, T.DEAD_LOG_TOP], sound: 'wood',
    color: 0x54473a, hard: 1.6 };

  // ---- 群系扩展新方块（稳定方块 ID 53..59）----
  // 只在旧注册表尾部追加，不得复用/移动旧 ID；旧存档地形逐位不变。
  defs[53] = { name: '菌丝体', solid: true, opaque: true,
    tiles: [T.MYCELIUM_TOP, T.MYCELIUM_SIDE, T.DIRT], sound: 'dirt',
    color: 0x7d6a84, hard: 0.65 };
  defs[54] = { name: '蘑菇柄', solid: true, opaque: true,
    tiles: [T.MUSHROOM_STEM, T.MUSHROOM_STEM, T.MUSHROOM_STEM], sound: 'wood',
    color: 0xc4b8a2, hard: 1.2 };
  defs[55] = { name: '红色菌盖', solid: true, opaque: true,
    tiles: [T.MUSHROOM_CAP_RED, T.MUSHROOM_CAP_RED, T.MUSHROOM_CAP_RED], sound: 'wool',
    color: 0xb2302a, hard: 0.4 };
  defs[56] = { name: '棕色菌盖', solid: true, opaque: true,
    tiles: [T.MUSHROOM_CAP_BROWN, T.MUSHROOM_CAP_BROWN, T.MUSHROOM_CAP_BROWN], sound: 'wool',
    color: 0x996b3f, hard: 0.4 };
  defs[57] = { name: '樱花木', solid: true, opaque: true,
    tiles: [T.CHERRY_LOG_TOP, T.CHERRY_LOG_SIDE, T.CHERRY_LOG_TOP], sound: 'wood',
    color: 0x9c6070, hard: 1.6 };
  defs[58] = { name: '樱花树叶', solid: true, opaque: true, leaves: true,
    tiles: [T.CHERRY_LEAVES, T.CHERRY_LEAVES, T.CHERRY_LEAVES], sound: 'leaves',
    color: 0xe49bb8, hard: 0.35 };
  defs[59] = { name: '暗色树叶', solid: true, opaque: true, leaves: true,
    tiles: [T.DARK_LEAVES, T.DARK_LEAVES, T.DARK_LEAVES], sound: 'leaves',
    color: 0x2a462c, hard: 0.35 };

  // ---- 阿特拉斯轨道空间站舱段方块（稳定方块 ID 60..66）----
  // 只在注册表尾部追加，不得复用/移动旧 ID；仅 station 世界自然生成，
  // 行星地形逐位不变，旧存档安全。
  defs[60] = { name: '舱壁板', solid: true, opaque: true,
    tiles: [T.STATION_HULL, T.STATION_HULL, T.STATION_HULL], sound: 'stone',
    color: 0x9aa7b8, hard: 3.5, pick: true };
  defs[61] = { name: '格栅甲板', solid: true, opaque: true,
    tiles: [T.STATION_GRATE, T.STATION_GRATE, T.STATION_GRATE], sound: 'stone',
    color: 0x46536b, hard: 3, pick: true };
  defs[62] = { name: '光缝灯带', solid: true, opaque: true,
    tiles: [T.STATION_SEAM, T.STATION_SEAM, T.STATION_SEAM], sound: 'glass', light: 12,
    color: 0x6fe8ff, hard: 0.8 };
  defs[63] = { name: '警示条纹', solid: true, opaque: true,
    tiles: [T.STATION_HAZARD, T.STATION_HAZARD, T.STATION_HAZARD], sound: 'stone',
    color: 0xd99a2b, hard: 3, pick: true };
  defs[64] = { name: '辉光饰条', solid: true, opaque: true,
    tiles: [T.STATION_TRIM, T.STATION_TRIM, T.STATION_TRIM], sound: 'glass', light: 7,
    color: 0x57d8f2, hard: 3, pick: true };
  defs[65] = { name: '舷窗玻璃', solid: true, opaque: false,
    tiles: [T.STATION_PORT, T.STATION_PORT, T.STATION_PORT], sound: 'glass',
    color: 0x8fd4e0, hard: 0.6 };
  defs[66] = { name: '深空装甲', solid: true, opaque: true,
    tiles: [T.STATION_DARK, T.STATION_DARK, T.STATION_DARK], sound: 'stone',
    color: 0x2b3448, hard: 4.5, pick: true };

  // ---- 双格床（稳定方块 ID 67..71）----
  // 与 Minecraft 一致，一张床占两个方块位：床尾(67) + 床头(68..71，按枕头
  // 朝向分四向，放置时按玩家视线主方向选型)。破坏任一半整张床掉落为
  // 物品 17。17 保留为床的物品 ID 与旧存档兼容（单格 17 视作枕头朝 -x 的床头）。
  defs[67] = { name: '床', solid: true, opaque: false, half: true, bed: 'foot', drop: 17,
    tiles: [T.BED_TOP_FOOT, T.BED_SIDE_FOOT, T.BED_SIDE_FOOT], sound: 'wood',
    color: 0xc0504d, hard: 0.8, icon: T.BED_TOP_FOOT };
  defs[68] = { name: '床', solid: true, opaque: false, half: true, bed: 'head', drop: 17,
    tiles: [T.BED_TOP, T.BED_SIDE, T.BED_SIDE], sound: 'wood',
    color: 0xc0504d, hard: 0.8, icon: T.BED_TOP };
  defs[69] = { name: '床', solid: true, opaque: false, half: true, bed: 'head', drop: 17,
    tiles: [T.BED_TOP_PX, T.BED_SIDE, T.BED_SIDE], sound: 'wood',
    color: 0xc0504d, hard: 0.8, icon: T.BED_TOP_PX };
  defs[70] = { name: '床', solid: true, opaque: false, half: true, bed: 'head', drop: 17,
    tiles: [T.BED_TOP_NZ, T.BED_SIDE, T.BED_SIDE], sound: 'wood',
    color: 0xc0504d, hard: 0.8, icon: T.BED_TOP_NZ };
  defs[71] = { name: '床', solid: true, opaque: false, half: true, bed: 'head', drop: 17,
    tiles: [T.BED_TOP_PZ, T.BED_SIDE, T.BED_SIDE], sound: 'wood',
    color: 0xc0504d, hard: 0.8, icon: T.BED_TOP_PZ };

  // 物品（item:true 不可放置）：ID 固定 100+，工具/材料
  // 工具 maxDur=耐久上限，maxStack=1 不堆叠；food=恢复饥饿值
  defs[100] = { name: '木棍', item: true, solid: false, opaque: false, tiles: [T.STICK, T.STICK, T.STICK], sound: 'wood', color: 0x9a764a, icon: T.STICK };
    defs[101] = { name: '木镐', item: true, solid: false, opaque: false, tiles: [T.PICK_WOOD, T.PICK_WOOD, T.PICK_WOOD], sound: 'wood', color: 0x9a764a, tool: 'pick', tier: 1, dmg: 2, maxDur: 60, maxStack: 1, icon: T.PICK_WOOD };
    defs[102] = { name: '石镐', item: true, solid: false, opaque: false, tiles: [T.PICK_STONE, T.PICK_STONE, T.PICK_STONE], sound: 'stone', color: 0x8f8f92, tool: 'pick', tier: 2, dmg: 3, maxDur: 132, maxStack: 1, icon: T.PICK_STONE };
    defs[103] = { name: '铁镐', item: true, solid: false, opaque: false, tiles: [T.PICK_IRON, T.PICK_IRON, T.PICK_IRON], sound: 'stone', color: 0xd8af87, tool: 'pick', tier: 3, dmg: 4, maxDur: 251, maxStack: 1, icon: T.PICK_IRON };
    defs[104] = { name: '木剑', item: true, solid: false, opaque: false, tiles: [T.SWORD_WOOD, T.SWORD_WOOD, T.SWORD_WOOD], sound: 'wood', color: 0x9a764a, tool: 'sword', dmg: 4, maxDur: 60, maxStack: 1, icon: T.SWORD_WOOD };
    defs[105] = { name: '石剑', item: true, solid: false, opaque: false, tiles: [T.SWORD_STONE, T.SWORD_STONE, T.SWORD_STONE], sound: 'stone', color: 0x8f8f92, tool: 'sword', dmg: 5, maxDur: 132, maxStack: 1, icon: T.SWORD_STONE };
    defs[106] = { name: '铁剑', item: true, solid: false, opaque: false, tiles: [T.SWORD_IRON, T.SWORD_IRON, T.SWORD_IRON], sound: 'stone', color: 0xd8af87, tool: 'sword', dmg: 6, maxDur: 251, maxStack: 1, icon: T.SWORD_IRON };
    defs[107] = { name: '煤炭', item: true, solid: false, opaque: false, tiles: [T.COAL, T.COAL, T.COAL], sound: 'stone', color: 0x3a3a3a, icon: T.COAL };
    defs[108] = { name: '铁锭', item: true, solid: false, opaque: false, tiles: [T.INGOT, T.INGOT, T.INGOT], sound: 'stone', color: 0xd8af87, icon: T.INGOT };
    // 食物（food=恢复的饥饿值，见饥饿系统）
    defs[109] = { name: '生猪排', item: true, solid: false, opaque: false, tiles: [T.MEAT_RAW, T.MEAT_RAW, T.MEAT_RAW], sound: 'wool', color: 0xe88a8a, food: 3, icon: T.MEAT_RAW };
    defs[110] = { name: '熟猪排', item: true, solid: false, opaque: false, tiles: [T.MEAT_COOKED, T.MEAT_COOKED, T.MEAT_COOKED], sound: 'wool', color: 0xb5764a, food: 8, icon: T.MEAT_COOKED };
    defs[111] = { name: '生鸡肉', item: true, solid: false, opaque: false, tiles: [T.CHICKEN_RAW, T.CHICKEN_RAW, T.CHICKEN_RAW], sound: 'wool', color: 0xe8c8a8, food: 2, icon: T.CHICKEN_RAW };
    defs[112] = { name: '熟鸡肉', item: true, solid: false, opaque: false, tiles: [T.CHICKEN_COOKED, T.CHICKEN_COOKED, T.CHICKEN_COOKED], sound: 'wool', color: 0xc9955a, food: 6, icon: T.CHICKEN_COOKED };
    defs[113] = { name: '生兔肉', item: true, solid: false, opaque: false, tiles: [T.RABBIT_RAW, T.RABBIT_RAW, T.RABBIT_RAW], sound: 'wool', color: 0xc4756e, food: 3, icon: T.RABBIT_RAW };
    defs[114] = { name: '熟兔肉', item: true, solid: false, opaque: false, tiles: [T.RABBIT_COOKED, T.RABBIT_COOKED, T.RABBIT_COOKED], sound: 'wool', color: 0xa8673f, food: 5, icon: T.RABBIT_COOKED };

    // 行星专属矿物掉落（稳定物品 ID 115..120）。
    defs[115] = { name: '活性晶体', item: true, solid: false, opaque: false,
      tiles: [T.ACTIVE_CRYSTAL, T.ACTIVE_CRYSTAL, T.ACTIVE_CRYSTAL], sound: 'glass', color: 0x63e78f,
      icon: T.ACTIVE_CRYSTAL, resourceKey: 'verdant_crystal' };
    defs[116] = { name: '硅晶', item: true, solid: false, opaque: false,
      tiles: [T.SILICA_CRYSTAL, T.SILICA_CRYSTAL, T.SILICA_CRYSTAL], sound: 'glass', color: 0xe4bd75,
      icon: T.SILICA_CRYSTAL, resourceKey: 'silica_crystal' };
    defs[117] = { name: '冰核', item: true, solid: false, opaque: false,
      tiles: [T.ICE_CORE, T.ICE_CORE, T.ICE_CORE], sound: 'glass', color: 0x8fdcf2,
      icon: T.ICE_CORE, resourceKey: 'frost_core' };
    defs[118] = { name: '孢子晶', item: true, solid: false, opaque: false,
      tiles: [T.SPORE_CRYSTAL, T.SPORE_CRYSTAL, T.SPORE_CRYSTAL], sound: 'glass', color: 0xa8dc55,
      icon: T.SPORE_CRYSTAL, resourceKey: 'spore_crystal' };
    defs[119] = { name: '熔核', item: true, solid: false, opaque: false,
      tiles: [T.MAGMA_CORE, T.MAGMA_CORE, T.MAGMA_CORE], sound: 'stone', color: 0xff6138,
      icon: T.MAGMA_CORE, resourceKey: 'magma_core' };
    defs[120] = { name: '潮汐晶', item: true, solid: false, opaque: false,
      tiles: [T.TIDAL_CRYSTAL, T.TIDAL_CRYSTAL, T.TIDAL_CRYSTAL], sound: 'glass', color: 0x55c9df,
      icon: T.TIDAL_CRYSTAL, resourceKey: 'tidal_crystal' };

    // 猫相关材料（稳定物品 ID 121）。
    defs[121] = { name: '猫毛', item: true, solid: false, opaque: false,
      tiles: [T.CAT_FUR, T.CAT_FUR, T.CAT_FUR], sound: 'wool', color: 0xe0aa6e, icon: T.CAT_FUR };

    // 跨恒星系跃迁燃料（稳定物品 ID 122）：任意两枚 tier≥2 晶体 + 铁锭合成。
    defs[122] = { name: '曲速电池', item: true, solid: false, opaque: false,
      tiles: [T.WARP_CELL, T.WARP_CELL, T.WARP_CELL], sound: 'glass', color: 0xb08cf0,
      icon: T.WARP_CELL };

  var atlasCanvas = null, atlasTexture = null;
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildAtlas() {
    atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = 256;
    atlasCanvas.height = 256;
    var ctx = atlasCanvas.getContext('2d');
    var img = ctx.createImageData(256, 256);
    var d = img.data;

    function px(x, y, r, g, b, a) {
      var i = (y * 256 + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = (a === undefined ? 255 : a);
    }

    function drawTile(idx, fn) {
      var ox = (idx % 16) * 16, oy = ((idx / 16) | 0) * 16;
      var r = rng(idx * 1013 + 7);
      for (var y = 0; y < 16; y++)
        for (var x = 0; x < 16; x++) {
          var c = fn(x, y, r);
          if (c) px(ox + x, oy + y, c[0] | 0, c[1] | 0, c[2] | 0, c[3]);
        }
    }

    function n(r, base, v) { return base + (r() - 0.5) * v; }

    drawTile(T.GRASS_TOP, function (x, y, r) {
      var v = n(r, 0, 30);
      return [84 + v, 160 + v, 60 + v * 0.6];
    });

    drawTile(T.GRASS_SIDE, function (x, y, r) {
      var band = 3 + ((x * 7 + 3) % 3);
      if (y < band || (y === band && r() < 0.5)) {
        return [76 + r() * 30, 148 + r() * 40, 50 + r() * 24];
      }
      var v = n(r, 0, 24);
      return [134 + v, 96 + v, 67 + v * 0.8];
    });

    drawTile(T.DIRT, function (x, y, r) {
      var v = n(r, 0, 26);
      return [134 + v, 96 + v, 67 + v * 0.8];
    });

    drawTile(T.STONE, function (x, y, r) {
      var v = n(r, 0, 22);
      if (r() < 0.07) v -= 26;
      return [125 + v, 125 + v, 127 + v];
    });

    drawTile(T.LOG_SIDE, function (x, y, r) {
      var dark = (x % 4 < 2);
      var v = n(r, 0, 16);
      return dark ? [104 + v, 84 + v, 52 + v] : [84 + v, 64 + v, 40 + v];
    });

    drawTile(T.LOG_TOP, function (x, y, r) {
      var dx = x - 7.5, dy = y - 7.5;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var ring = ((dist * 1.4) | 0) % 2 === 0;
      var v = n(r, 0, 10);
      return ring ? [160 + v, 130 + v, 80 + v] : [120 + v, 94 + v, 58 + v];
    });

    drawTile(T.LEAVES, function (x, y, r) {
      if (r() < 0.16) return [34 + r() * 14, 78 + r() * 18, 24 + r() * 10];
      var v = n(r, 0, 40);
      return [52 + v, 116 + v, 36 + v * 0.7];
    });

    drawTile(T.SAND, function (x, y, r) {
      var v = n(r, 0, 18);
      return [222 + v, 209 + v, 164 + v];
    });

    drawTile(T.WATER, function (x, y, r) {
      var v = n(r, 0, 14);
      if ((y + ((x / 2) | 0)) % 5 === 0) v += 14;
      return [48 + v, 110 + v, 200 + v, 195];
    });

    function oreTile(color) {
      return function (x, y, r) {
        var cl = [];
        for (var i = 0; i < 5; i++) cl.push([r() * 16, r() * 16]);
        for (var j = 0; j < 5; j++) {
          var ddx = x - cl[j][0], ddy = y - cl[j][1];
          if (ddx * ddx + ddy * ddy < 2.2) return color;
        }
        var v = n(r, 0, 22);
        return [125 + v, 125 + v, 127 + v];
      };
    }

    drawTile(T.COAL, oreTile([38, 38, 40]));
    drawTile(T.IRON, oreTile([216, 175, 135]));

    drawTile(T.PLANKS, function (x, y, r) {
      if (y % 4 === 3) return [118 + r() * 10, 92 + r() * 10, 54 + r() * 8];
      var seam = (y < 8) ? 2 : 6;
      if (x === seam && r() < 0.4) return [110, 88, 52];
      var v = n(r, 0, 16);
      return [166 + v, 134 + v, 82 + v * 0.8];
    });

    drawTile(T.COBBLE, function (x, y, r) {
      var cl = [];
      for (var i = 0; i < 6; i++) cl.push([r() * 16, r() * 16, 1.6 + r() * 1.6]);
      for (var j = 0; j < 6; j++) {
        var ddx = x - cl[j][0], ddy = y - cl[j][1];
        if (ddx * ddx + ddy * ddy < cl[j][2] * cl[j][2]) return [92 + r() * 18, 92 + r() * 18, 95 + r() * 18];
      }
      var v = n(r, 0, 30);
      return [128 + v, 128 + v, 130 + v];
    });

    drawTile(T.BEDROCK, function (x, y, r) {
      var v = n(r, 0, 70);
      return [68 + v, 68 + v, 70 + v];
    });

    drawTile(T.GLASS, function (x, y, r) {
      if (x === 0 || y === 0 || x === 15 || y === 15) return [235, 245, 250, 255];
      if (((x - y) % 8 + 8) % 8 < 2) return [255, 255, 255, 110];
      return [205, 232, 242, 36];
    });

    drawTile(T.GRAVEL, function (x, y, r) {
      var v = n(r, 0, 46);
      return [133 + v, 127 + v, 119 + v];
    });

    // 木板底纹（工作台/床共用）
    function plank(x, y, r) {
      if (y % 4 === 3) return [118 + r() * 10, 92 + r() * 10, 54 + r() * 8];
      var seam = (y < 8) ? 2 : 6;
      if (x === seam && r() < 0.4) return [110, 88, 52];
      var v = n(r, 0, 16);
      return [166 + v, 134 + v, 82 + v * 0.8];
    }

    drawTile(T.TABLE_TOP, function (x, y, r) {
      if (x === 4 || x === 11 || y === 4 || y === 11) return [74, 56, 32];
      if (x < 3 || y < 3 || x > 12 || y > 12) return [120 + r() * 12, 94 + r() * 10, 56 + r() * 8];
      return plank(x, y, r);
    });

    drawTile(T.TABLE_SIDE, function (x, y, r) {
      if (y < 2) return [110, 88, 52];
      var inBox = x >= 3 && x <= 12 && y >= 4 && y <= 11;
      if (inBox && (x === 3 || x === 12 || y === 4 || y === 11)) return [74, 56, 32];
      if (inBox) {
        // 中间的"工具"图案：一把锯
        if (x >= 5 && x <= 10 && (y === 6 || y === 7)) return [190, 190, 196];
        if (x === 5 && y >= 5 && y <= 8) return [150, 150, 158];
        if (x === 9 && y === 8) return [90, 70, 44];
        return [150 + r() * 14, 120 + r() * 12, 74 + r() * 10];
      }
      return plank(x, y, r);
    });

    drawTile(T.WOOL, function (x, y, r) {
      var v = n(r, 0, 22);
      var base = 236 + v;
      // 波浪状深色纹理
      if (((y + (x >> 1)) % 5) === 2 && r() < 0.7) return [206 + v, 204 + v, 200 + v];
      return [base, base - 2, base - 6];
    });

    drawTile(T.BED_TOP, function (x, y, r) {
      // 枕头（左上）+ 红色床品
      if (x <= 5 && y >= 2 && y <= 13 && (x === 1 || y === 2 || y === 13)) return [196, 52, 48];
      if (x >= 2 && x <= 5 && y >= 3 && y <= 12) return [238 + r() * 10, 234 + r() * 10, 228 + r() * 10];
      var v = n(r, 0, 26);
      if (x === 7) return [150 + v, 44 + v * 0.5, 40 + v * 0.5];
      return [204 + v, 64 + v * 0.6, 58 + v * 0.6];
    });

    drawTile(T.BED_SIDE, function (x, y, r) {
      if (y >= 10) return [96 + r() * 14, 74 + r() * 10, 44 + r() * 8];        // 木质床脚
      if (y === 9) return [70, 52, 30];
      if (y <= 1) return [196, 52, 48];
      var v = n(r, 0, 22);
      if (x >= 2 && x <= 5 && y >= 3 && y <= 7) return [236 + r() * 10, 232 + r() * 10, 226 + r() * 10]; // 枕头侧面
      if (x === 6) return [150 + v, 44 + v * 0.5, 40 + v * 0.5];
      return [202 + v, 62 + v * 0.6, 56 + v * 0.6];
    });

    // 双格床：床头四向顶面（顶面纹理 canvas x→世界 +x、canvas y→世界 +z，
    // 枕头必须落在床头块的远端）+ 床尾顶/侧面（纯床品无枕头）
    function bedSeam(v) { return [150 + v, 44 + v * 0.5, 40 + v * 0.5]; }
    drawTile(T.BED_TOP_PX, function (x, y, r) {                                // 枕头朝 +x（BED_TOP 左右镜像）
      if (x >= 10 && y >= 2 && y <= 13 && (x === 14 || y === 2 || y === 13)) return [196, 52, 48];
      if (x >= 10 && x <= 13 && y >= 3 && y <= 12) return [238 + r() * 10, 234 + r() * 10, 228 + r() * 10];
      var v = n(r, 0, 26);
      if (x === 8) return bedSeam(v);
      return [204 + v, 64 + v * 0.6, 58 + v * 0.6];
    });
    drawTile(T.BED_TOP_NZ, function (x, y, r) {                                // 枕头朝 -z（BED_TOP 逆时针旋转）
      if (y === 1 || x === 2 || x === 13) {
        if (y >= 1 && y <= 5 && x >= 2 && x <= 13) return [196, 52, 48];
        var vb0 = n(r, 0, 26);
        return [204 + vb0, 64 + vb0 * 0.6, 58 + vb0 * 0.6];
      }
      if (y >= 2 && y <= 4 && x >= 3 && x <= 12) return [238 + r() * 10, 234 + r() * 10, 228 + r() * 10];
      var v = n(r, 0, 26);
      if (y === 7) return bedSeam(v);
      return [204 + v, 64 + v * 0.6, 58 + v * 0.6];
    });
    drawTile(T.BED_TOP_PZ, function (x, y, r) {                                // 枕头朝 +z（BED_TOP 顺时针旋转）
      if (y === 14 || x === 2 || x === 13) {
        if (y >= 10 && y <= 14 && x >= 2 && x <= 13) return [196, 52, 48];
        var vb1 = n(r, 0, 26);
        return [204 + vb1, 64 + vb1 * 0.6, 58 + vb1 * 0.6];
      }
      if (y >= 11 && y <= 13 && x >= 3 && x <= 12) return [238 + r() * 10, 234 + r() * 10, 228 + r() * 10];
      var v2 = n(r, 0, 26);
      if (y === 8) return bedSeam(v2);
      return [204 + v2, 64 + v2 * 0.6, 58 + v2 * 0.6];
    });
    drawTile(T.BED_TOP_FOOT, function (x, y, r) {                              // 床尾顶面：纯床品
      var v3 = n(r, 0, 26);
      return [204 + v3, 64 + v3 * 0.6, 58 + v3 * 0.6];
    });
    drawTile(T.BED_SIDE_FOOT, function (x, y, r) {                             // 床尾侧面：无枕头
      if (y >= 10) return [96 + r() * 14, 74 + r() * 10, 44 + r() * 8];        // 木质床脚
      if (y === 9) return [70, 52, 30];
      if (y <= 1) return [196, 52, 48];
      var v4 = n(r, 0, 22);
      return [202 + v4, 62 + v4 * 0.6, 56 + v4 * 0.6];
    });

    drawTile(T.SNOW, function (x, y, r) {
      if (r() < 0.10) return [222 + r() * 12, 234 + r() * 10, 250];           // 淡蓝晶点
      var v = n(r, 0, 12);
      return [240 + v, 246 + v * 0.5, 252];
    });

    // ---- 新生物群系方块纹理 ----
    function logSideTile(a, b) {
      return function (x, y, r) {
        var stripe = (x % 4 < 2);
        var v = n(r, 0, 14);
        var c = stripe ? a : b;
        return [c[0] + v, c[1] + v, c[2] + v];
      };
    }
    function logTopTile(light, dark) {
      return function (x, y, r) {
        var dx = x - 7.5, dy = y - 7.5;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var ring = ((dist * 1.4) | 0) % 2 === 0;
        var c = ring ? light : dark;
        var v = n(r, 0, 10);
        return [c[0] + v, c[1] + v, c[2] + v];
      };
    }
    function leavesTile(base, spot) {
      return function (x, y, r) {
        if (r() < 0.16) return [spot[0] + r() * 10, spot[1] + r() * 12, spot[2] + r() * 8];
        var v = n(r, 0, 36);
        return [base[0] + v, base[1] + v * 0.85, base[2] + v * 0.6];
      };
    }

    drawTile(T.SPRUCE_LOG_SIDE, logSideTile([64, 46, 28], [88, 66, 40]));
    drawTile(T.SPRUCE_LOG_TOP, logTopTile([118, 90, 54], [80, 58, 34]));
    drawTile(T.SPRUCE_LEAVES, leavesTile([44, 94, 82], [26, 58, 48]));

    drawTile(T.JUNGLE_LOG_SIDE, function (x, y, r) {
      var stripe = (x % 5 < 2);
      var v = n(r, 0, 16);
      // 藓斑
      if (!stripe && r() < 0.18) return [92 + v, 108 + v, 56 + v * 0.6];
      var c = stripe ? [96, 74, 42] : [128, 100, 58];
      return [c[0] + v, c[1] + v, c[2] + v * 0.8];
    });
    drawTile(T.JUNGLE_LOG_TOP, logTopTile([178, 144, 90], [132, 104, 62]));
    drawTile(T.JUNGLE_LEAVES, leavesTile([56, 136, 40], [28, 84, 20]));

    drawTile(T.PODZOL_TOP, function (x, y, r) {
      var v = n(r, 0, 26);
      if (r() < 0.12) return [104 + v, 72 + v * 0.7, 38 + v * 0.5];            // 深色腐殖斑
      return [146 + v, 106 + v * 0.9, 56 + v * 0.6];
    });
    drawTile(T.PODZOL_SIDE, function (x, y, r) {
      var band = 3 + ((x * 5 + 2) % 3);
      if (y < band || (y === band && r() < 0.5)) {
        var vp = n(r, 0, 22);
        return [140 + vp, 102 + vp * 0.9, 54 + vp * 0.6];
      }
      var v = n(r, 0, 24);
      return [134 + v, 96 + v, 67 + v * 0.8];                                   // 泥土
    });

    drawTile(T.MOSSY_COBBLE, function (x, y, r) {
      var cl = [];
      for (var i = 0; i < 6; i++) cl.push([r() * 16, r() * 16, 1.6 + r() * 1.6]);
      for (var j = 0; j < 6; j++) {
        var ddx = x - cl[j][0], ddy = y - cl[j][1];
        if (ddx * ddx + ddy * ddy < cl[j][2] * cl[j][2]) return [92 + r() * 18, 92 + r() * 18, 95 + r() * 18];
      }
      var v = n(r, 0, 26);
      if (r() < 0.35) return [92 + v, 118 + v, 74 + v];                         // 苔藓
      return [124 + v, 124 + v, 126 + v];
    });

    drawTile(T.CACTUS_SIDE, function (x, y, r) {
      if (r() < 0.05) return [216, 228, 190];                                   // 刺
      var ridge = (x % 4 === 0);
      var v = n(r, 0, 14);
      return ridge ? [40 + v, 88 + v, 30 + v] : [56 + v, 114 + v, 42 + v];
    });
    drawTile(T.CACTUS_TOP, function (x, y, r) {
      if (x === 0 || y === 0 || x === 15 || y === 15) return [40, 86, 30];
      if (r() < 0.06) return [200 + r() * 30, 220, 170];
      var v = n(r, 0, 14);
      return [64 + v, 124 + v, 48 + v];
    });

    drawTile(T.SANDSTONE_TOP, function (x, y, r) {
      var v = n(r, 0, 12);
      if (r() < 0.08) return [196 + v, 182 + v, 132 + v];                       // 颗粒杂点
      return [222 + v, 210 + v, 162 + v];
    });
    drawTile(T.SANDSTONE_SIDE, function (x, y, r) {
      var v = n(r, 0, 10);
      if (y % 5 === 4) return [188 + v, 174 + v, 126 + v];                      // 沉积层理
      if ((y > 5 && y < 11 && x > 3 && x < 12 && r() < 0.2)) return [204 + v, 190 + v, 140 + v];
      return [218 + v, 205 + v, 156 + v];
    });

    // ---- 地质群系方块纹理（恶地/山峰/白桦/金合欢） ----
    function terracottaTile(base) {
      return function (x, y, r) {
        var v = n(r, 0, 18);
        if (r() < 0.08) return [base[0] * 0.88 + v, base[1] * 0.88 + v, base[2] * 0.88 + v];
        return [base[0] + v, base[1] + v, base[2] + v];
      };
    }
    drawTile(T.TERRACOTTA, terracottaTile([162, 92, 62]));
    drawTile(T.TERRACOTTA_YELLOW, terracottaTile([186, 133, 56]));
    drawTile(T.TERRACOTTA_BROWN, terracottaTile([102, 70, 44]));

    drawTile(T.RED_SAND, function (x, y, r) {
      var v = n(r, 0, 18);
      if (r() < 0.06) return [176 + v, 96 + v, 58 + v];
      return [198 + v, 127 + v, 81 + v];
    });

    drawTile(T.ICE, function (x, y, r) {
      // 冰裂纹理：对角亮线
      var dcrack = Math.abs((x + y * 1.5) % 7 - 3);
      var v = n(r, 0, 10);
      if (dcrack < 0.6) return [200 + v, 232, 255];
      return [150 + v, 196 + v, 240 + v * 0.6];
    });

    drawTile(T.ACACIA_LOG_SIDE, logSideTile([104, 60, 36], [140, 84, 50]));
    drawTile(T.ACACIA_LOG_TOP, logTopTile([172, 118, 72], [120, 74, 44]));
    drawTile(T.ACACIA_LEAVES, leavesTile([86, 138, 40], [52, 96, 24]));

    drawTile(T.BIRCH_LOG_SIDE, function (x, y, r) {
      var v = n(r, 0, 12);
      if ((y === 3 && x % 5 < 3) || (y === 10 && x % 4 === 1)) return [52 + v, 48 + v, 42 + v];   // 黑色横纹
      return [216 + v, 210 + v, 194 + v];
    });
    drawTile(T.BIRCH_LOG_TOP, logTopTile([206, 192, 158], [168, 152, 118]));
    drawTile(T.BIRCH_LEAVES, leavesTile([110, 160, 66], [66, 108, 38]));

    // ---- 工具 / 材料图标（透明背景，像素画） ----

    // 斜握柄：从左下到右上
    function handle(x, y) {
      return (x + y >= 9 && x + y <= 11 && x >= 2 && x <= 10 && y >= 5 && y <= 13);
    }
    function shade(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

    drawTile(T.STICK, function (x, y, r) {
      var d = x - (15 - y);                       // 对角线距离
      if (d >= -1 && d <= 1 && x >= 3 && x <= 12 && y >= 3 && y <= 12)
        return (d === 0) ? [134 + r() * 14, 102 + r() * 10, 60] : [104, 78, 44];
    });

    function pickTile(headColor) {
      return function (x, y, r) {
        if (handle(x, y)) return [120, 90, 52];
        // 镐头：顶部弧形横梁 + 两侧下垂尖角
        var head = false;
        if (y >= 2 && y <= 4 && x >= 3 && x <= 12) head = true;
        if ((x === 2 || x === 3) && y >= 4 && y <= 7) head = true;
        if ((x === 12 || x === 13) && y >= 4 && y <= 7) head = true;
        if (head) {
          var c = headColor;
          var edge = (y === 2 || x === 2 || x === 13) ? 1.25 : 0.8;
          return [Math.min(255, c[0] * edge * 0.55 + c[0] * 0.45), Math.min(255, c[1] * edge), Math.min(255, c[2] * edge)];
        }
      };
    }
    drawTile(T.PICK_WOOD, pickTile([166, 134, 82]));
    drawTile(T.PICK_STONE, pickTile([140, 140, 144]));
    drawTile(T.PICK_IRON, pickTile([216, 175, 135]));

    function swordTile(bladeColor) {
      return function (x, y, r) {
        // 刃：右上对角线；护手与柄在左下
        var d = x - (15 - y);
        if (d >= -1 && d <= 0 && x >= 6 && x <= 14 && y >= 1 && y <= 9) {
          var c = bladeColor;
          return (d === 0) ? shade(c, 1.15) : shade(c, 0.85);
        }
        if (x + y === 7 && x >= 4 && x <= 7 && y >= 4 && y <= 7) return [110, 80, 46];   // 护手
        if (x - (6 - y) >= -1 && x - (6 - y) <= 0 && x >= 2 && x <= 5 && y >= 8 && y <= 12)
          return [96, 70, 40];                                                            // 柄
      };
    }
    drawTile(T.SWORD_WOOD, swordTile([166, 134, 82]));
    drawTile(T.SWORD_STONE, swordTile([150, 150, 155]));
    drawTile(T.SWORD_IRON, swordTile([220, 220, 226]));

    drawTile(T.TORCH, function (x, y, r) {
      // 木杆
      if ((x === 7 || x === 8) && y >= 5 && y <= 15)
        return (x === 7) ? [128 + r() * 12, 96 + r() * 10, 56] : [100, 74, 42];
      // 火焰
      if (x >= 6 && x <= 9 && y >= 1 && y <= 4) {
        if (y <= 2 || x === 6 || x === 9) return [255, 168 + r() * 30, 32];
        return [255, 232 + r() * 20, 120];
      }
      if ((x === 5 || x === 10) && y === 3) return [255, 140, 30, 180];
    });

    // ---- 食物 / 铁锭图标 ----

    drawTile(T.INGOT, function (x, y, r) {
      // 斜置金属条：平行四边形锭身 + 高光边
      var row = y - 4;
      if (row < 0 || row > 7) return;
      var x0 = 3 + ((7 - row) >> 1), x1 = x0 + 9;
      if (x < x0 || x > x1) return;
      if (row <= 1 || x === x1) return [240 + r() * 14, 214 + r() * 10, 176];   // 上/右高光
      if (row >= 7 || x === x0) return [158, 118, 84];                          // 下/左阴影
      var v = n(r, 0, 12);
      return [216 + v, 175 + v, 135 + v];
    });

    function meatTile(raw, cooked, bone) {
      return function (x, y, r) {
        // 带骨肉排：椭圆肉身（左上-右下走向）+ 左下骨头
        var dx = x - 9, dy = y - 7;
        var inMeat = (dx * dx) * 0.09 + (dy * dy) * 0.16 <= 1;
        if (bone && x >= 2 && x <= 4 && y >= 10 && y <= 13 && Math.abs((x - 3) + (y - 11.5)) < 2.6) {
          var bv = n(r, 0, 10);
          return [236 + bv, 228 + bv, 210];
        }
        if (!inMeat) return;
        var v = n(r, 0, 18);
        var c = cooked ? [181, 118, 74] : raw;
        if (((x + y) % 7 === 0 && r() < 0.6)) {
          // 熟肉深色烤痕 / 生肉浅色脂肪纹
          return cooked ? [140 + v * 0.5, 88 + v * 0.5, 52] : [244, 208 + r() * 20, 200];
        }
        return [c[0] + v, c[1] + v * 0.8, c[2] + v * 0.8];
      };
    }
    drawTile(T.MEAT_RAW, meatTile([226, 120, 120], false, false));
    drawTile(T.MEAT_COOKED, meatTile([181, 118, 74], true, true));
    drawTile(T.CHICKEN_RAW, function (x, y, r) {
      // 整鸡：梨形身体 + 两腿棍
      var dx = x - 8, dy = y - 6;
      if (dx * dx * 0.08 + dy * dy * 0.14 <= 1) {
        var v = n(r, 0, 14);
        if (r() < 0.06) return [236, 196, 160];
        return [230 + v, 196 + v, 164 + v];
      }
      if ((y >= 12 && y <= 15) && (x === 6 || x === 10)) return [232, 178, 106];   // 腿
      if (y === 15 && (x === 5 || x === 11)) return [240, 200, 130];
    });
    drawTile(T.CHICKEN_COOKED, function (x, y, r) {
      var dx = x - 8, dy = y - 6;
      if (dx * dx * 0.08 + dy * dy * 0.14 <= 1) {
        var v = n(r, 0, 14);
        if ((x + y) % 6 === 0 && r() < 0.55) return [150 + v * 0.5, 96 + v * 0.5, 50];
        return [198 + v, 138 + v, 78 + v];
      }
      if ((y >= 12 && y <= 15) && (x === 6 || x === 10)) return [220, 170, 100];
    });
    drawTile(T.RABBIT_RAW, meatTile([192, 110, 104], false, true));
    drawTile(T.RABBIT_COOKED, meatTile([168, 103, 63], true, true));

    // ---- 猫毛 / 猫毛毡 ----

    drawTile(T.CAT_FUR, function (x, y, r) {
      // 蓬松毛簇：中央绒球 + 四散毛尖
      var dx = x - 8, dy = y - 9;
      var inPuff = dx * dx * 0.075 + dy * dy * 0.10 <= 1;
      var strand = ((x * 3 + y * 5) % 11 === 0 && r() < 0.5);
      if (!inPuff && !strand) return;
      var v = n(r, 0, 20);
      if (((x + y) % 5 === 0) && r() < 0.6) return [198 + v, 140 + v, 82 + v];   // 深色绒纹
      if (r() < 0.08) return [246 + r() * 9, 224 + r() * 12, 186];               // 高光毛尖
      return [228 + v, 176 + v, 116 + v];
    });

    drawTile(T.FELT, function (x, y, r) {
      // 压制毡面：暖灰底 + 细密斜向压纹
      var v = n(r, 0, 14);
      if (((x + y * 2) % 6) === 0 && r() < 0.55) return [172 + v, 156 + v, 141 + v];
      return [196 + v, 180 + v, 166 + v];
    });

    // ---- 曲速电池（跨恒星系跃迁燃料） ----

    drawTile(T.WARP_CELL, function (x, y, r) {
      // 竖置能量电池：金属外壳 + 中央紫青色曲速窗口 + 顶部正极端子
      var dx = x - 8;
      if (y >= 1 && y <= 3 && Math.abs(dx) <= 2) {                 // 正极端子
        var tv = n(r, 0, 12);
        return [212 + tv, 216 + tv, 228 + tv];
      }
      var inShell = y >= 4 && y <= 14 && Math.abs(dx) <= 5;        // 外壳轮廓
      if (!inShell) {
        if ((y === 13 || y === 14) && Math.abs(dx) === 6) return [70, 74, 92]; // 底部圆角
        return;
      }
      if (Math.abs(dx) === 5 || y === 4 || y === 14) {             // 描边
        var sv = n(r, 0, 10);
        return [96 + sv, 102 + sv, 126 + sv];
      }
      var inWindow = y >= 6 && y <= 12 && Math.abs(dx) <= 3;       // 曲速窗口
      if (inWindow) {
        // 纵向流动能量纹：越靠中心越亮，随行扫描出流光
        var flow = (y * 2 + ((x + 8) % 4)) % 7 === 0;
        if (flow || (Math.abs(dx) <= 1 && y >= 8 && y <= 10))
          return [214, 178, 255];                                  // 高亮芯
        var wv = n(r, 0, 18);
        var edge = Math.abs(dx) === 3 ? -26 : 0;
        return [150 + wv + edge, 108 + wv + edge, 236 + wv];       // 紫青底
      }
      var mv = n(r, 0, 12);
      return [168 + mv, 176 + mv, 200 + mv];                       // 金属壳面
    });

    // ---- 功能方块（熔炉/箱子） ----

    function stoneBlock(x, y, r) {
      var v = n(r, 0, 20);
      if (r() < 0.06) v -= 20;
      return [126 + v, 126 + v, 128 + v];
    }
    drawTile(T.FURNACE_TOP, stoneBlock);
    drawTile(T.FURNACE_SIDE, function (x, y, r) { return stoneBlock(x, y, r); });
    drawTile(T.FURNACE_FRONT, function (x, y, r) {
      // 石面 + 下部炉口：燃烧口黑洞与格栅
      if (y >= 9 && y <= 13 && x >= 4 && x <= 11) {
        if (y === 9 || x === 4 || x === 11) return [70, 70, 74];           // 口沿
        if ((y === 12 || y === 13) && ((x % 2) === 0)) return [54, 54, 58]; // 格栅
        return [22, 20, 20];                                               // 黑洞
      }
      return stoneBlock(x, y, r);
    });

    drawTile(T.CHEST_TOP, function (x, y, r) {
      var v = n(r, 0, 14);
      if (x === 0 || y === 0 || x === 15 || y === 15) return [96 + v, 68 + v, 38];
      return [164 + v, 118 + v, 66 + v];
    });
    drawTile(T.CHEST_SIDE, function (x, y, r) {
      var v = n(r, 0, 14);
      if (x === 0 || x === 15) return [96 + v, 68 + v, 38];
      if (y === 5) return [88 + v * 0.5, 62 + v * 0.5, 34];                // 盖缝
      if (y < 5) return [176 + v, 128 + v, 72 + v];                        // 盖
      return [160 + v, 114 + v, 62 + v];                                   // 身
    });
    drawTile(T.CHEST_FRONT, function (x, y, r) {
      var v = n(r, 0, 14);
      if (x === 0 || x === 15) return [96 + v, 68 + v, 38];
      if (y === 5) return [88 + v * 0.5, 62 + v * 0.5, 34];
      if (y < 5) return [176 + v, 128 + v, 72 + v];
      // 锁扣
      if (x >= 7 && x <= 8 && y >= 7 && y <= 10) {
        if (x === 7 && y > 7) return [150, 150, 158];
        return [210, 210, 220];
      }
      return [160 + v, 114 + v, 62 + v];
    });

    // 行星专属晶矿：深色石质基底 + 种类固定的像素晶脉。
    function crystalResource(tile, dark, mid, bright, variant) {
      drawTile(tile, function (x, y, r) {
        var stone = 57 + (r() * 24 | 0);
        var a = (x * (5 + variant) + y * (9 - variant) + variant * 11) % 31;
        var b = ((x - 8) * (x - 8) + (y - (5 + variant)) * (y - (5 + variant))) | 0;
        var vein = a <= 2 || b <= 3 || ((x + y * 3 + variant * 7) % 37 === 0);
        if (!vein) return [stone, stone + 2, stone + 4];
        var edge = (x + y + variant) % 3;
        return edge === 0 ? bright : (edge === 1 ? mid : dark);
      });
    }
    crystalResource(T.ACTIVE_CRYSTAL, [34, 112, 68], [70, 198, 112], [144, 255, 184], 1);
    crystalResource(T.SILICA_CRYSTAL, [119, 83, 43], [215, 169, 92], [255, 231, 166], 2);
    crystalResource(T.ICE_CORE, [43, 103, 147], [103, 194, 226], [211, 248, 255], 3);
    crystalResource(T.SPORE_CRYSTAL, [70, 105, 31], [157, 211, 70], [218, 255, 130], 4);
    crystalResource(T.MAGMA_CORE, [119, 30, 24], [236, 68, 35], [255, 185, 62], 5);
    crystalResource(T.TIDAL_CRYSTAL, [26, 91, 133], [57, 183, 211], [166, 246, 255], 6);

    // ---- 外星巨型植物 / 遗迹方块纹理 ----

    // 外星茎干：紫灰木质条纹 + 荧光苔点
    drawTile(T.ALIEN_LOG_SIDE, function (x, y, r) {
      var stripe = (x % 5 < 2);
      var v = n(r, 0, 14);
      if (!stripe && r() < 0.12) return [126 + v, 214 + v * 0.6, 196 + v * 0.6]; // 荧光苔
      var c = stripe ? [96, 84, 118] : [128, 114, 148];
      return [c[0] + v, c[1] + v, c[2] + v];
    });
    drawTile(T.ALIEN_LOG_TOP, logTopTile([158, 142, 178], [110, 96, 132]));

    // 荧光菌伞：青绿发光底 + 亮斑，整体高亮度
    drawTile(T.GLOW_CAP, function (x, y, r) {
      var dx = x - 7.5, dy = y - 7.5;
      var v = n(r, 0, 16);
      var spot = ((x * 3 + y * 5) % 13 === 0 && r() < 0.8) || (dx * dx + dy * dy < 3);
      if (spot) return [206 + v, 255, 244];
      if (r() < 0.10) return [46 + v, 128 + v, 116 + v];                         // 深色气孔
      return [89 + v, 214 + v * 0.8, 196 + v * 0.8];
    });

    // 遗迹石砖：规整砖缝 + 风化裂纹
    function ruinBrickTile(mossChance) {
      return function (x, y, r) {
        var row = (y / 4) | 0;
        var seamY = (y % 4 === 0);
        var offset = (row % 2) * 4;
        var seamX = ((x + offset) % 8 === 0);
        var v = n(r, 0, 14);
        if (seamY || seamX) return [104 + v * 0.6, 102 + v * 0.6, 100 + v * 0.6]; // 砖缝
        if (r() < 0.05) return [78 + v, 76 + v, 74 + v];                          // 裂纹杂点
        if (r() < mossChance) return [96 + v, 124 + v, 78 + v];                   // 苔藓
        var base = 146 + v;
        return [base, base + 2, base + 4];
      };
    }
    drawTile(T.RUIN_BRICK, ruinBrickTile(0.04));
    drawTile(T.RUIN_BRICK_MOSSY, ruinBrickTile(0.34));

    // 玄武岩柱：深灰底 + 纵向柱状节理
    drawTile(T.BASALT, function (x, y, r) {
      var col = (x % 4 < 2);
      var v = n(r, 0, 10);
      var c = col ? [64, 62, 72] : [82, 80, 90];
      if (r() < 0.06) return [120 + v, 116 + v, 126 + v];                         // 晶面反光
      return [c[0] + v, c[1] + v, c[2] + v];
    });

    // 珊瑚块：暖橙红多孔构造
    drawTile(T.CORAL, function (x, y, r) {
      var v = n(r, 0, 18);
      if (r() < 0.14) return [168 + v, 74 + v * 0.6, 66 + v * 0.6];               // 孔洞
      if (r() < 0.08) return [255, 208 + r() * 30, 170];                          // 高光息肉
      return [217 + v, 122 + v * 0.7, 108 + v * 0.7];
    });

    // 枯巨木：焦褐深纹，无叶
    drawTile(T.DEAD_LOG_SIDE, logSideTile([58, 48, 40], [88, 74, 60]));
    drawTile(T.DEAD_LOG_TOP, logTopTile([112, 94, 74], [74, 60, 48]));

    // ---- 群系扩展新方块纹理 ----

    // 菌丝体顶面：紫灰底 + 浅紫菌丝簇
    drawTile(T.MYCELIUM_TOP, function (x, y, r) {
      var v = n(r, 0, 16);
      if (r() < 0.14) return [148 + v, 132 + v, 156 + v];
      return [118 + v, 100 + v * 0.9, 126 + v];
    });
    drawTile(T.MYCELIUM_SIDE, function (x, y, r) {
      var band = 3 + ((x * 5 + 4) % 3);
      if (y < band || (y === band && r() < 0.5)) {
        var vm = n(r, 0, 18);
        return [124 + vm, 104 + vm * 0.9, 132 + vm];
      }
      var v = n(r, 0, 24);
      return [134 + v, 96 + v, 67 + v * 0.8];                                   // 泥土
    });

    // 蘑菇柄：米白纵向纤维纹
    drawTile(T.MUSHROOM_STEM, function (x, y, r) {
      var stripe = (x % 4 < 2);
      var v = n(r, 0, 12);
      if (r() < 0.05) return [150 + v, 138 + v, 116 + v];                       // 纤维暗线
      var c = stripe ? [206, 194, 172] : [182, 170, 148];
      return [c[0] + v, c[1] + v, c[2] + v * 0.9];
    });

    // 红色菌盖：正红底 + 固定坐标白色斑点
    drawTile(T.MUSHROOM_CAP_RED, function (x, y, r) {
      var spots = [[3, 3], [11, 4], [6, 10], [13, 12]];
      for (var i = 0; i < spots.length; i++) {
        var ddx = x - spots[i][0], ddy = y - spots[i][1];
        if (ddx * ddx + ddy * ddy < 3.2) {
          var sv = n(r, 0, 10);
          return [236 + sv, 230 + sv, 220 + sv];
        }
      }
      var edge = (x === 0 || y === 0 || x === 15 || y === 15);
      var v = n(r, 0, 18);
      if (edge) return [142 + v * 0.5, 30 + v * 0.4, 26 + v * 0.4];             // 边缘深红
      return [188 + v, 46 + v * 0.5, 38 + v * 0.5];
    });

    // 棕色菌盖：深浅棕棋盘纹 + 气孔
    drawTile(T.MUSHROOM_CAP_BROWN, function (x, y, r) {
      var row = ((y / 3) | 0) % 2;
      var col = ((x / 4) | 0) % 2;
      var v = n(r, 0, 14);
      if (r() < 0.06) return [98 + v * 0.5, 68 + v * 0.5, 40 + v * 0.5];        // 气孔
      var base = (row ^ col) ? [154, 112, 72] : [128, 92, 56];
      return [base[0] + v, base[1] + v, base[2] + v];
    });

    // 樱花木：灰粉树皮纵纹 + 浅色皮孔
    drawTile(T.CHERRY_LOG_SIDE, function (x, y, r) {
      var stripe = (x % 5 < 2);
      var v = n(r, 0, 12);
      if (!stripe && r() < 0.1) return [176 + v, 130 + v, 138 + v];
      var c = stripe ? [88, 60, 70] : [126, 88, 98];
      return [c[0] + v, c[1] + v, c[2] + v];
    });
    drawTile(T.CHERRY_LOG_TOP, logTopTile([200, 150, 152], [150, 104, 110]));

    // 樱花树叶：亮粉花瓣簇 + 深粉缝隙
    drawTile(T.CHERRY_LEAVES, function (x, y, r) {
      if (r() < 0.16) return [178 + r() * 20, 84 + r() * 20, 120 + r() * 16];
      var v = n(r, 0, 32);
      return [232 + v, 144 + v * 0.7, 172 + v * 0.8];
    });

    // 暗色树叶：近黑绿密叶
    drawTile(T.DARK_LEAVES, function (x, y, r) {
      if (r() < 0.14) return [16 + r() * 10, 36 + r() * 12, 16 + r() * 8];
      var v = n(r, 0, 22);
      return [44 + v * 0.6, 78 + v, 42 + v * 0.6];
    });

    // ---- 阿特拉斯空间站舱段方块纹理 ----
    // 统一深空蓝灰合金基底：青色=功能发光，琥珀=警示，克制不撞色。

    // 舱壁板：浅灰蓝大面板 + 板缝 + 铆钉 + 细拉丝
    drawTile(T.STATION_HULL, function (x, y, r) {
      var lx = x % 8, ly = y % 8;
      if (lx === 0 || ly === 0) {                                   // 面板缝
        var sv = n(r, 0, 10);
        return [96 + sv, 106 + sv, 122 + sv];
      }
      if ((lx === 1 || lx === 6) && (ly === 1 || ly === 6))         // 角铆钉
        return [112, 120, 136];
      var v = n(r, 0, 18);
      var base = ((x * 3 + y) % 11 === 0) ? 138 : 150;              // 拉丝暗线
      return [base + v, base + 7 + v, base + 17 + v];
    });

    // 格栅甲板：暗色承重肋 + 方形漏空格
    drawTile(T.STATION_GRATE, function (x, y, r) {
      var v = n(r, 0, 12);
      if (x % 4 === 0 || y % 4 === 0)                               // 肋条
        return [84 + v * 0.5, 94 + v * 0.5, 114 + v * 0.5];
      var hole = [40 + v * 0.3, 47 + v * 0.3, 62 + v * 0.4];        // 格眼
      return hole;
    });

    // 光缝灯带：深色舱壳嵌中央十字发光缝，核心越靠中心越亮
    drawTile(T.STATION_SEAM, function (x, y, r) {
      var bandX = x >= 6 && x <= 9, bandY = y >= 6 && y <= 9;
      if (bandX && bandY) return [228, 255, 255];                   // 十字核心
      if (bandX || bandY) {
        var edge = bandX ? Math.abs(x - 7.5) : Math.abs(y - 7.5);   // 向缝缘衰减
        var glow = 1 - edge / 2.5;
        var v = n(r, 0, 8);
        return [90 + glow * 130 + v, 200 + glow * 55 + v, 235 + v];
      }
      var hv = n(r, 0, 8);
      return [30 + hv, 37 + hv, 52 + hv];                           // 舱壳
    });

    // 警示条纹：琥珀/炭黑 45° 斜纹 + 磨损斑点
    drawTile(T.STATION_HAZARD, function (x, y, r) {
      var stripe = (((x + y) % 8) + 8) % 8 < 4;
      var v = n(r, 0, 16);
      if (!stripe && r() < 0.08) return [92 + v, 78 + v, 48 + v];   // 掉漆
      return stripe ? [212 + v * 0.6, 148 + v * 0.6, 52 + v * 0.4]
                    : [42 + v * 0.3, 44 + v * 0.3, 50 + v * 0.3];
    });

    // 辉光饰条：深海军蓝护墙基座 + 上下青色霓虹压线
    drawTile(T.STATION_TRIM, function (x, y, r) {
      var v = n(r, 0, 10);
      if (y <= 1 || y >= 14) {
        var bright = (y === 0 || y === 15);
        return bright ? [128, 226, 246] : [70, 168, 196];           // 压线双行
      }
      if (x % 4 < 2) return [27 + v, 36 + v, 56 + v];               // 海军蓝细条纹
      return [34 + v, 45 + v, 68 + v];
    });

    // 舷窗玻璃：厚金属法兰圈 + 圆形观察窗，窗内青蓝渐变与斜高光
    drawTile(T.STATION_PORT, function (x, y, r) {
      var dx = x - 7.5, dy = y - 7.5;
      var d2 = dx * dx + dy * dy;
      if (d2 <= 29) {                                               // 窗内玻璃
        var depth = (dx * 0.55 - dy * 0.5) / 6;                     // 左上亮右下暗
        var v = n(r, 0, 10);
        var hi = (Math.abs(dx * 0.7 + dy * 0.7 + 3) < 1.2) ? 26 : 0; // 斜高光
        return [96 + depth * 40 + hi + v, 176 + depth * 26 + hi + v, 208 + depth * 20 + hi + v];
      }
      if (d2 <= 50) return [24, 28, 42];                            // 密封圈
      if (d2 <= 66) {                                               // 法兰环
        var fv = n(r, 0, 14);
        return [104 + fv, 116 + fv, 138 + fv];
      }
      if ((x === 1 || x === 14) && (y === 1 || y === 14))           // 角螺栓
        return [132, 142, 160];
      var bv = n(r, 0, 8);
      return [46 + bv, 54 + bv, 72 + bv];                           // 舱壳底
    });

    // 深空装甲：近黑装甲板 + 对角焊接纹 + 稀疏铆点
    drawTile(T.STATION_DARK, function (x, y, r) {
      var weld = (((x + y) % 16) + 16) % 16 < 2;
      var v = n(r, 0, 10);
      if (weld) return [58 + v, 70 + v, 94 + v];                    // 焊缝
      if ((x * 5 + y * 3) % 23 === 0) return [74, 86, 110];         // 铆点
      var band = (y % 8 === 3);
      if (band) return [30 + v * 0.4, 38 + v * 0.4, 56 + v * 0.4];  // 层间阴影
      return [39 + v, 48 + v, 66 + v];
    });

    ctx.putImageData(img, 0, 0);

    atlasTexture = new THREE.CanvasTexture(atlasCanvas);
    atlasTexture.magFilter = THREE.NearestFilter;
    atlasTexture.minFilter = THREE.NearestFilter;
    atlasTexture.generateMipmaps = false;
  }

  if (typeof document !== 'undefined' && typeof THREE !== 'undefined') buildAtlas();

  // 主动扫描只把自然地质/稀有资源写入档案；普通建筑方块不计数，避免玩家
  // 摆放同一方块刷发现奖励。World.isEdited 会再拒绝被玩家修改过的坐标。
  var SCANNABLE_RESOURCES = [8, 9, 14, 25, 27, 28, 29, 30, 31, 32, 33, 39, 40, 41, 42, 43, 44];
  var scannableResourceSet = Object.create(null);
  for (var sri = 0; sri < SCANNABLE_RESOURCES.length; sri++)
    scannableResourceSet[SCANNABLE_RESOURCES[sri]] = true;

  // 发光方块查找表（火把 14、荧光菌伞 13…）：光照热路径用数组下标替代逐个 defs 查询。
  var LIGHT = new Uint8Array(256);
  for (var li = 0; li < defs.length; li++) {
    var ld = defs[li];
    if (ld && typeof ld.light === 'number' && ld.light > 0 && ld.light <= 15) LIGHT[li] = ld.light;
  }

  return {
    defs: defs,
    T: T,
    MAX_STACK: 64,
    ITEM_BASE: 100,
    LIGHT: LIGHT,
    lightOf: function (id) {
      return (id >= 0 && id < 256) ? LIGHT[id] : 0;
    },
    SCANNABLE_RESOURCES: SCANNABLE_RESOURCES.slice(),
    isScannableResource: function (id) {
      return typeof id === 'number' && isFinite(id) && Math.floor(id) === id &&
        Object.prototype.hasOwnProperty.call(scannableResourceSet, id);
    },
    isSolid: function (id) { return id > 0 && !!defs[id] && !!defs[id].solid; },
    isOpaque: function (id) { return id > 0 && !!defs[id] && !!defs[id].opaque; },
    // 树叶（风摇 + 实时阴影投射体）
    isLeaves: function (id) { return id > 0 && !!defs[id] && !!defs[id].leaves; },
    // 床的任意半格（17=旧单格/床头 -x，67=床尾，68..71=床头四向）
    isBed: function (id) { return id === 17 || (id >= 67 && id <= 71); },
    // 床头方块选型：床的延伸方向 dx/dz（枕头朝延伸方向远端）
    bedHeadId: function (dx, dz) {
      if (dx < 0) return 68;
      if (dx > 0) return 69;
      if (dz < 0) return 70;
      return 71;
    },
    name: function (id) { return defs[id] ? defs[id].name : '?'; },
    tileForFace: function (id, face) {
      var d = defs[id];
      if (!d || !d.tiles) return -1;
      if (face === 2) return d.tiles[0]; // 上
      if (face === 3) return d.tiles[2]; // 下
      return d.tiles[1];                 // 侧
    },
    // 挖掘掉落物（煤矿掉煤炭而非矿石本身）
    dropOf: function (id) {
      var d = defs[id];
      return (d && d.drop) ? d.drop : id;
    },
    // 手持镐的等级（0=无镐，1木 2石 3铁）
    pickTier: function (heldId) {
      var d = defs[heldId];
      return (d && d.tool === 'pick') ? d.tier : 0;
    },
    // 手持武器伤害
    attackDmg: function (heldId) {
      var d = defs[heldId];
      return (d && d.dmg) ? d.dmg : 2;
    },
    // 工具耐久上限（非工具返回 0）
    maxDur: function (id) {
      var d = defs[id];
      return (d && d.maxDur) || 0;
    },
    // 镐对可加速方块的倍率
    PICK_MULT: [1, 4, 7, 10],
    iconTile: function (id) {
      var d = defs[id];
      if (!d || !d.tiles) return -1;
      if (d.icon !== undefined) return d.icon;
      if (id === 1) return T.GRASS_SIDE;
      if (id === 15) return T.TABLE_TOP;
      if (id === 17) return T.BED_TOP;
      return d.tiles[1];
    },
    getAtlas: function () { return atlasCanvas; },
    getTexture: function () { return atlasTexture; }
  };
})();
