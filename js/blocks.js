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
    STATION_TRIM: 98, STATION_PORT: 99, STATION_DARK: 100,
    // 物品/矿物扩展瓦片（稳定序号 106..116，只追加不移动）
    GOLD_ORE: 106, DIAMOND_ORE: 107, INGOT_GOLD: 108, GEM_DIAMOND: 109,
    CHARCOAL: 110, PICK_GOLD: 111, PICK_DIAMOND: 112,
    SWORD_GOLD: 113, SWORD_DIAMOND: 114, MASK_GAS: 115, SUIT_COLD: 116,
    // 星海嘉年华瓦片（稳定序号 117..131，只追加不移动）
    PARK_LAWN_TOP: 117, PARK_LAWN_SIDE: 118, CREAM_PAVE: 119, PASTEL_BRICK: 120,
    CANDY_STRIPE: 121, GOLD_TRIM: 122, LANTERN: 123, RAIL_WHITE: 124,
    ROOF_BLUE: 125, NEON_PURPLE: 126, NEON_CYAN: 127, BUNTING: 128,
    RIDE_PAD: 129, CASTLE_PINK: 130, CASTLE_BLUE: 131,
    TOKEN: 132, FW_ROD: 133,
    GLASS_RED: 134, GLASS_CYAN: 135, GLASS_GOLD: 136,
    // 战斗装备瓦片（稳定序号 137..142，只追加不移动）
    BOW: 137, ARROW: 138, CAP_FELT: 139, TUNIC_FELT: 140,
    HELM_IRON: 141, CHESTPLATE_IRON: 142,
    // v8 扩容瓦片（稳定序号 143..，只追加不移动）
    DOOR_OAK: 143, DOOR_SPRUCE: 144, DOOR_BIRCH: 145, DOOR_JUNGLE: 146,
    DOOR_ACACIA: 147, DOOR_CHERRY: 148, DOOR_IRON: 149, TRAPDOOR_TOP: 150,
    RS_WIRE_OFF: 151, RS_WIRE_ON: 152, RS_TORCH: 153, RS_LEVER_BASE: 154,
    RS_BTN: 155, RS_PLATE_WOOD: 156, RS_PLATE_STONE: 157,
    RS_LAMP_OFF: 158, RS_LAMP_ON: 159, RS_REPEATER: 160, RS_ORE: 161, RS_DUST: 162,
    // 农耕瓦片
    FARM_TOP: 163, FARM_WET_TOP: 164,
    TUFT: 165, WHEAT0: 166, WHEAT1: 167, WHEAT2: 168, WHEAT_MATURE: 169,
    CARROT0: 170, CARROT2: 171, CARROT_MATURE: 172,
    POTATO0: 173, POTATO2: 174, POTATO_MATURE: 175,
    // 农耕物品图标
    I_WHEAT: 176, I_SEEDS: 177, I_BREAD: 178, I_APPLE: 179, I_GAPPLE: 180,
    I_CARROT: 181, I_POTATO: 182, I_POTATO_BAKED: 183,
    HOE_WOOD: 184, HOE_STONE: 185, HOE_IRON: 186,
    // 染色体系瓦片
    FLOWER0: 187,   // 花×8 连续
    WOOL_C0: 195,   // 彩色羊毛×15 连续（白色用原羊毛）
    TERRA_C0: 210,  // 彩色陶瓦×16 连续
    GLASS_C0: 225,  // 彩色玻璃×13 连续
    I_DYE0: 238,    // 染料图标×16 连续
    // 北欧城堡瓦片（稳定序号 254..，只追加不移动）
    BLACK_SAND: 254, GNEISS: 255, SHINGLE_RED: 256,
    PLASTER_WHITE: 257, TUSSOCK_DRY: 258
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

  // ---- 扩展矿物（稳定方块 ID 72..73）----
  // 只在注册表尾部追加，不得复用/移动旧 ID。金矿石掉自身（同铁矿 9 模式，熔炼得金锭）；
  // 钻石矿石直接掉钻石 124（同煤矿 8 模式）。自然生成由 PlanetRules v2 通道按行星稀有度决定。
  defs[72] = { name: '金矿石', solid: true, opaque: true,
    tiles: [T.GOLD_ORE, T.GOLD_ORE, T.GOLD_ORE], sound: 'stone', color: 0xf5d442,
    hard: 6, pick: true, tier: 3 };
  defs[73] = { name: '钻石矿石', solid: true, opaque: true,
    tiles: [T.DIAMOND_ORE, T.DIAMOND_ORE, T.DIAMOND_ORE], sound: 'stone', color: 0x5ce2da,
    hard: 6.5, pick: true, tier: 3, drop: 124 };

  // ---- 星海嘉年华方块（稳定方块 ID 74..87）----
  // 只在旧注册表尾部追加，不得复用/移动旧 ID。自然生成仅出现在乐园群系的
  // 园区结构里（structures.js parkAt），其余世界地形逐位不变。
  // 经典嘉年华暖色系：奶油白铺装、糖果条纹、金饰描边、暖黄灯球；
  // 创极速光轮区使用霓虹紫/青两色作主题点缀。
  defs[74] = { name: '游乐草坪', solid: true, opaque: true,
    tiles: [T.PARK_LAWN_TOP, T.PARK_LAWN_SIDE, T.PARK_LAWN_SIDE], sound: 'dirt',
    color: 0x63ab4e, hard: 0.65 };
  defs[75] = { name: '奶油石板', solid: true, opaque: true,
    tiles: [T.CREAM_PAVE, T.CREAM_PAVE, T.CREAM_PAVE], sound: 'stone',
    color: 0xe9ddc4, hard: 1.8, pick: true };
  defs[76] = { name: '粉彩砖', solid: true, opaque: true,
    tiles: [T.PASTEL_BRICK, T.PASTEL_BRICK, T.PASTEL_BRICK], sound: 'stone',
    color: 0xdfaab4, hard: 1.8, pick: true };
  defs[77] = { name: '糖果柱', solid: true, opaque: true,
    tiles: [T.CANDY_STRIPE, T.CANDY_STRIPE, T.CANDY_STRIPE], sound: 'wool',
    color: 0xd8574f, hard: 0.9 };
  defs[78] = { name: '金饰块', solid: true, opaque: true,
    tiles: [T.GOLD_TRIM, T.GOLD_TRIM, T.GOLD_TRIM], sound: 'stone', light: 2,
    color: 0xdca843, hard: 2.2, pick: true };
  defs[79] = { name: '暖黄灯球', solid: true, opaque: true,
    tiles: [T.LANTERN, T.LANTERN, T.LANTERN], sound: 'glass', light: 15,
    color: 0xffd27a, hard: 0.6 };
  defs[80] = { name: '白漆栏杆', solid: true, opaque: false, half: true,
    tiles: [T.RAIL_WHITE, T.RAIL_WHITE, T.RAIL_WHITE], sound: 'wood',
    color: 0xf2ede2, hard: 0.7 };
  defs[81] = { name: '蓝瓦块', solid: true, opaque: true,
    tiles: [T.ROOF_BLUE, T.ROOF_BLUE, T.ROOF_BLUE], sound: 'stone', light: 10,
    color: 0x9ec6f6, hard: 2.5, pick: true };
  defs[82] = { name: '霓虹紫灯带', solid: true, opaque: true,
    tiles: [T.NEON_PURPLE, T.NEON_PURPLE, T.NEON_PURPLE], sound: 'glass', light: 15,
    color: 0xc06bf5, hard: 0.8 };
  defs[83] = { name: '霓虹青灯带', solid: true, opaque: true,
    tiles: [T.NEON_CYAN, T.NEON_CYAN, T.NEON_CYAN], sound: 'glass', light: 15,
    color: 0x53e6ef, hard: 0.8 };
  defs[84] = { name: '彩旗串', solid: false, opaque: false, cross: true,
    tiles: [T.BUNTING, T.BUNTING, T.BUNTING], sound: 'wool',
    color: 0xef8080, hard: 0.05 };
  defs[85] = { name: '乘坐台', solid: true, opaque: true,
    tiles: [T.RIDE_PAD, T.RIDE_PAD, T.RIDE_PAD], sound: 'stone',
    color: 0xd7dee8, hard: 2.5, pick: true };
  defs[86] = { name: '童话粉墙', solid: true, opaque: true,
    tiles: [T.CASTLE_PINK, T.CASTLE_PINK, T.CASTLE_PINK], sound: 'stone', light: 12,
    color: 0xfdf5ee, hard: 2, pick: true };
  defs[87] = { name: '城堡宝蓝墙', solid: true, opaque: true,
    tiles: [T.CASTLE_BLUE, T.CASTLE_BLUE, T.CASTLE_BLUE], sound: 'stone', light: 15,
    color: 0xb2d0fa, hard: 2.5, pick: true };
  // ---- 城堡彩色玻璃（稳定 ID 88..90）----
  // stained 标记 → mesher 路由进半透明水材质组（alpha 来自贴图像素），
  // depthWrite:false 与水面同批次渲染；非透明剔除规则与普通玻璃(id 13)一致
  defs[88] = { name: '红彩玻璃', solid: true, opaque: false, stained: true,
    tiles: [T.GLASS_RED, T.GLASS_RED, T.GLASS_RED], sound: 'glass',
    color: 0xd8574f, hard: 0.4, drop: 0 };
  defs[89] = { name: '青彩玻璃', solid: true, opaque: false, stained: true,
    tiles: [T.GLASS_CYAN, T.GLASS_CYAN, T.GLASS_CYAN], sound: 'glass',
    color: 0x5cc8e0, hard: 0.4, drop: 0 };
  defs[90] = { name: '金彩玻璃', solid: true, opaque: false, stained: true,
    tiles: [T.GLASS_GOLD, T.GLASS_GOLD, T.GLASS_GOLD], sound: 'glass',
    color: 0xf3b13e, hard: 0.4, drop: 0 };

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

    // ---- 物品/装备扩展（稳定物品 ID 123..131）----
    // 只在尾部追加，不得复用/移动旧 ID。
    defs[123] = { name: '金锭', item: true, solid: false, opaque: false,
      tiles: [T.INGOT_GOLD, T.INGOT_GOLD, T.INGOT_GOLD], sound: 'stone', color: 0xf5d442,
      icon: T.INGOT_GOLD };
    defs[124] = { name: '钻石', item: true, solid: false, opaque: false,
      tiles: [T.GEM_DIAMOND, T.GEM_DIAMOND, T.GEM_DIAMOND], sound: 'glass', color: 0x5ce2da,
      icon: T.GEM_DIAMOND };
    // 木炭：原木熔炉烧制产物，燃料热值与煤炭等效；也是防毒面具滤芯材料。
    defs[125] = { name: '木炭', item: true, solid: false, opaque: false,
      tiles: [T.CHARCOAL, T.CHARCOAL, T.CHARCOAL], sound: 'stone', color: 0x2e2c2b,
      icon: T.CHARCOAL };
    // 金质工具：MC 风格——挖掘最快（pickMult 覆盖 PICK_MULT）但极不耐久。
    defs[126] = { name: '金镐', item: true, solid: false, opaque: false,
      tiles: [T.PICK_GOLD, T.PICK_GOLD, T.PICK_GOLD], sound: 'stone', color: 0xf5d442,
      tool: 'pick', tier: 2, pickMult: 12, dmg: 2, maxDur: 33, maxStack: 1, icon: T.PICK_GOLD };
    defs[127] = { name: '金剑', item: true, solid: false, opaque: false,
      tiles: [T.SWORD_GOLD, T.SWORD_GOLD, T.SWORD_GOLD], sound: 'stone', color: 0xf5d442,
      tool: 'sword', dmg: 4, maxDur: 33, maxStack: 1, icon: T.SWORD_GOLD };
    // 钻石工具：tier 4 终极档。
    defs[128] = { name: '钻石镐', item: true, solid: false, opaque: false,
      tiles: [T.PICK_DIAMOND, T.PICK_DIAMOND, T.PICK_DIAMOND], sound: 'stone', color: 0x5ce2da,
      tool: 'pick', tier: 4, dmg: 5, maxDur: 1561, maxStack: 1, icon: T.PICK_DIAMOND };
    defs[129] = { name: '钻石剑', item: true, solid: false, opaque: false,
      tiles: [T.SWORD_DIAMOND, T.SWORD_DIAMOND, T.SWORD_DIAMOND], sound: 'stone', color: 0x5ce2da,
      tool: 'sword', dmg: 7, maxDur: 1561, maxStack: 1, icon: T.SWORD_DIAMOND };
    // 功能性装备：gearSlot 指定装备槽（'head' 头部 / 'body' 身体），穿戴后由
    // Environment 按 context 里的 gear/charge 字段阻断对应环境危害暴露。
    defs[130] = { name: '防毒面具', item: true, solid: false, opaque: false,
      tiles: [T.MASK_GAS, T.MASK_GAS, T.MASK_GAS], sound: 'wool', color: 0x8a8a7c,
      gearSlot: 'head', maxDur: 240, maxStack: 1, icon: T.MASK_GAS };
    defs[131] = { name: '防寒服', item: true, solid: false, opaque: false,
      tiles: [T.SUIT_COLD, T.SUIT_COLD, T.SUIT_COLD], sound: 'wool', color: 0x2e4460,
      gearSlot: 'body', maxDur: 320, maxStack: 1, icon: T.SUIT_COLD };
    // ---- 星海嘉年华经济物品（稳定 ID 132..133）----
    // 乐园代币：宝箱/套圈产出，售票亭兑换加速模式与烟花棒
    defs[132] = { name: '乐园代币', item: true, solid: false, opaque: false,
      tiles: [T.TOKEN, T.TOKEN, T.TOKEN], sound: 'stone', color: 0xf5d442,
      maxStack: 99, icon: T.TOKEN };
    // 烟花棒：手持右键放单发烟花（消耗品）
    defs[133] = { name: '烟花棒', item: true, solid: false, opaque: false,
      tiles: [T.FW_ROD, T.FW_ROD, T.FW_ROD], sound: 'wood', color: 0xd8574f,
      maxStack: 16, icon: T.FW_ROD };

    // ---- 战斗装备（稳定物品 ID 134..139）----
    // 只在尾部追加，不得复用/移动旧 ID。
    // 弓：手持右键发射背包中的箭；远程伤害 6，攻速受独立冷却约束。
    defs[134] = { name: '弓', item: true, solid: false, opaque: false,
      tiles: [T.BOW, T.BOW, T.BOW], sound: 'wood', color: 0x8a6a42,
      tool: 'bow', maxDur: 385, maxStack: 1, icon: T.BOW };
    // 箭：弓的弹药（石头镞 + 木杆），可堆叠
    defs[135] = { name: '箭', item: true, solid: false, opaque: false,
      tiles: [T.ARROW, T.ARROW, T.ARROW], sound: 'wood', color: 0xbdb8a5,
      maxStack: 64, icon: T.ARROW };
    // 护甲：gearSlot 接入现有装备槽系统。armor 为物理减伤系数（近战/箭矢/爆炸），
    // 与环境防护装备（防毒面具/防寒服）互不冲突——同一槽位装哪个由玩家取舍。
    defs[136] = { name: '毡帽', item: true, solid: false, opaque: false,
      tiles: [T.CAP_FELT, T.CAP_FELT, T.CAP_FELT], sound: 'wool', color: 0xc4b8a6,
      gearSlot: 'head', armor: 0.10, maxDur: 160, maxStack: 1, icon: T.CAP_FELT };
    defs[137] = { name: '毡衣', item: true, solid: false, opaque: false,
      tiles: [T.TUNIC_FELT, T.TUNIC_FELT, T.TUNIC_FELT], sound: 'wool', color: 0xc4b8a6,
      gearSlot: 'body', armor: 0.12, maxDur: 220, maxStack: 1, icon: T.TUNIC_FELT };
    defs[138] = { name: '铁盔', item: true, solid: false, opaque: false,
      tiles: [T.HELM_IRON, T.HELM_IRON, T.HELM_IRON], sound: 'stone', color: 0xd8d8d8,
      gearSlot: 'head', armor: 0.22, maxDur: 400, maxStack: 1, icon: T.HELM_IRON };
    defs[139] = { name: '铁胸甲', item: true, solid: false, opaque: false,
      tiles: [T.CHESTPLATE_IRON, T.CHESTPLATE_IRON, T.CHESTPLATE_IRON], sound: 'stone',
      color: 0xd8d8d8, gearSlot: 'body', armor: 0.26, maxDur: 520, maxStack: 1, icon: T.CHESTPLATE_IRON };

  // ============ v8 扩容：门与活板门（方块 ID 141.. 起追加，仅追加不移动）============
  // 编码（每木种 8 个连续 ID）：idx = base + (upper?4:0) + (axis?2:0) + (open?1:0)
  //   axis 0=门板沿 Z 展开（沿 X 方向进出），axis 1=门板沿 X 展开
  // 关闭态整格固体（拦人），开启态非固体（薄板只贴边）。上半/下半各自占一格。
  var DOOR_KINDS = [
    { key: 'oak',    name: '橡木',   tile: T.DOOR_OAK,    color: 0xa2824e, dropSound: 'wood' },
    { key: 'spruce', name: '云杉',   tile: T.DOOR_SPRUCE, color: 0x6b5230, dropSound: 'wood' },
    { key: 'birch',  name: '白桦',   tile: T.DOOR_BIRCH,  color: 0xcfc39b, dropSound: 'wood' },
    { key: 'jungle', name: '丛林',   tile: T.DOOR_JUNGLE, color: 0x9a7448, dropSound: 'wood' },
    { key: 'acacia', name: '金合欢', tile: T.DOOR_ACACIA, color: 0xa85c34, dropSound: 'wood' },
    { key: 'cherry', name: '樱花',   tile: T.DOOR_CHERRY, color: 0xd8a8b0, dropSound: 'wood' },
    { key: 'iron',   name: '铁',     tile: T.DOOR_IRON,   color: 0xc8c8cc, dropSound: 'stone' }
  ];
  var DOOR_BASE = 141;          // 每种 8 ID：141..196
  var TRAPDOOR_BASE = DOOR_BASE + DOOR_KINDS.length * 8; // 197..199 橡木活板门

  function doorBox(upper, open, axis) {
    if (!open) {
      // 关闭：中央薄板横跨门洞；axis0 → 板沿 Z 跨全宽薄在 X；axis1 → 反之
      return axis === 0 ? [0.40625, 0, 0, 0.59375, 1, 1] : [0, 0, 0.40625, 1, 1, 0.59375];
    }
    // 开启：转 90° 贴边（铰链取负端）
    return axis === 0 ? [0, 0, 0, 1, 1, 0.1875] : [0, 0, 0, 0.1875, 1, 1];
  }

  for (var dk = 0; dk < DOOR_KINDS.length; dk++) {
    (function (kindIdx) {
      var kind = DOOR_KINDS[kindIdx];
      var base = DOOR_BASE + kindIdx * 8;
      for (var st = 0; st < 8; st++) {
        var upper = (st & 4) !== 0;
        var open = (st & 1) !== 0;
        var axis = ((st & 3) >> 1);
        defs[base + st] = {
          name: kind.name + '门',
          solid: !open,
          opaque: false,
          tiles: [kind.tile, kind.tile, kind.tile],
          sound: kind.key === 'iron' ? 'stone' : 'wood',
          color: kind.color,
          icon: kind.tile,
          hard: kind.key === 'iron' ? 9 : 1.5,
          pick: kind.key === 'iron' ? true : undefined,
          box: doorBox(upper, open, axis),
          door: { kind: kindIdx, upper: upper, open: open, axis: axis },
          drop: DOOR_BASE + kindIdx * 8  // 破坏任意半块掉「下半关闭」可重放
        };
      }
    })(dk);
  }

  // 橡木活板门：197 关（平铺底面）/ 198 开·X / 199 开·Z；关=半高固体、开=非固体
  defs[TRAPDOOR_BASE + 0] = {
    name: '橡木活板门', solid: true, opaque: false, half: true,
    tiles: [T.TRAPDOOR_TOP, T.TRAPDOOR_TOP, T.TRAPDOOR_TOP], sound: 'wood',
    color: 0xa2824e, icon: T.TRAPDOOR_TOP, box: [0, 0, 0, 1, 0.1875, 1],
    trapdoor: { open: false }, drop: TRAPDOOR_BASE
  };
  defs[TRAPDOOR_BASE + 1] = {
    name: '橡木活板门', solid: false, opaque: false,
    tiles: [T.TRAPDOOR_TOP, T.TRAPDOOR_TOP, T.TRAPDOOR_TOP], sound: 'wood',
    color: 0xa2824e, icon: T.TRAPDOOR_TOP, box: [0, 0, 0, 0.1875, 1, 1],
    trapdoor: { open: true }, drop: TRAPDOOR_BASE
  };
  defs[TRAPDOOR_BASE + 2] = {
    name: '橡木活板门', solid: false, opaque: false,
    tiles: [T.TRAPDOOR_TOP, T.TRAPDOOR_TOP, T.TRAPDOOR_TOP], sound: 'wood',
    color: 0xa2824e, icon: T.TRAPDOOR_TOP, box: [0, 0, 0, 1, 1, 0.1875],
    trapdoor: { open: true }, drop: TRAPDOOR_BASE
  };

  // ============ v8 扩容：红石基础电路（方块 ID 200..214，物品 220）============
  // 信号模型：二值（点亮/熄灭）。电源=拉杆开/按钮按下/压力板压下/红石火把亮。
  // 导线相邻连通传播；中继器=延时二极管；受体=红石灯/铁门/木门。
  var RS = {
    ORE: 200,
    WIRE_OFF: 201, WIRE_ON: 202,
    TORCH_ON: 203, TORCH_OFF: 204,
    LEVER_OFF: 205, LEVER_ON: 206,
    BTN_UP: 207, BTN_DOWN: 208,
    PLATE_UP: 209, PLATE_DOWN: 210,
    LAMP_OFF: 211, LAMP_ON: 212,
    REP_OFF: 213, REP_ON: 214
  };

  defs[RS.ORE] = { name: '红石矿石', solid: true, opaque: true,
    tiles: [T.RS_ORE, T.RS_ORE, T.RS_ORE], sound: 'stone',
    color: 0x9a2020, hard: 5, pick: true, tier: 2, drop: 220 }; // 石镐可挖 → 红石粉

  // 导线：贴地薄条，非固体，可穿行
  defs[RS.WIRE_OFF] = { name: '红石导线', solid: false, opaque: false, rs: 'wire', powered: false,
    tiles: [T.RS_WIRE_OFF, T.RS_WIRE_OFF, T.RS_WIRE_OFF], sound: 'wool',
    color: 0x6e1414, hard: 0.05, box: [0, 0, 0, 1, 0.0625, 1], drop: 220 };
  defs[RS.WIRE_ON] = { name: '红石导线', solid: false, opaque: false, rs: 'wire', powered: true,
    tiles: [T.RS_WIRE_ON, T.RS_WIRE_ON, T.RS_WIRE_ON], sound: 'wool',
    color: 0xe23c1c, hard: 0.05, box: [0, 0, 0, 1, 0.0625, 1], drop: 220 };

  // 红石火把：十字面片（同火把），常亮态发光 14；反相电源
  defs[RS.TORCH_ON] = { name: '红石火把', solid: false, opaque: false, cross: true, light: 14, rs: 'rtorch', powered: true,
    tiles: [T.RS_TORCH, T.RS_TORCH, T.RS_TORCH], sound: 'wood',
    color: 0xff4a24, hard: 0.05, drop: RS.TORCH_ON };
  defs[RS.TORCH_OFF] = { name: '红石火把', solid: false, opaque: false, cross: true, rs: 'rtorch', powered: false,
    tiles: [T.RS_TORCH, T.RS_TORCH, T.RS_TORCH], sound: 'wood',
    color: 0x7a2013, hard: 0.05, drop: RS.TORCH_ON };

  // 拉杆 / 按钮 / 压力板：小盒非固体
  defs[RS.LEVER_OFF] = { name: '拉杆', solid: false, opaque: false, rs: 'lever', powered: false,
    tiles: [T.RS_LEVER_BASE, T.RS_LEVER_BASE, T.RS_LEVER_BASE], sound: 'stone',
    color: 0x8a8a8c, hard: 0.6, box: [0.3125, 0, 0.3125, 0.6875, 0.375, 0.6875],
    icon: T.RS_LEVER_BASE, drop: RS.LEVER_OFF };
  defs[RS.LEVER_ON] = { name: '拉杆', solid: false, opaque: false, rs: 'lever', powered: true,
    tiles: [T.RS_LEVER_BASE, T.RS_LEVER_BASE, T.RS_LEVER_BASE], sound: 'stone',
    color: 0xc86a2a, hard: 0.6, box: [0.3125, 0, 0.3125, 0.6875, 0.375, 0.6875],
    icon: T.RS_LEVER_BASE, drop: RS.LEVER_OFF };
  defs[RS.BTN_UP] = { name: '石质按钮', solid: false, opaque: false, rs: 'button', powered: false,
    tiles: [T.RS_BTN, T.RS_BTN, T.RS_BTN], sound: 'stone',
    color: 0x7f7f7f, hard: 0.6, box: [0.3125, 0, 0.3125, 0.6875, 0.125, 0.6875],
    icon: T.RS_BTN, drop: RS.BTN_UP };
  defs[RS.BTN_DOWN] = { name: '石质按钮', solid: false, opaque: false, rs: 'button', powered: true,
    tiles: [T.RS_BTN, T.RS_BTN, T.RS_BTN], sound: 'stone',
    color: 0x7f7f7f, hard: 0.6, box: [0.3125, 0, 0.3125, 0.6875, 0.0625, 0.6875],
    icon: T.RS_BTN, drop: RS.BTN_UP };
  defs[RS.PLATE_UP] = { name: '木质压力板', solid: false, opaque: false, rs: 'plate', powered: false,
    tiles: [T.PLANKS, T.PLANKS, T.PLANKS], sound: 'wood',
    color: 0xa2824e, hard: 0.5, box: [0, 0, 0, 1, 0.09375, 1],
    icon: T.PLANKS, drop: RS.PLATE_UP };
  defs[RS.PLATE_DOWN] = { name: '木质压力板', solid: false, opaque: false, rs: 'plate', powered: true,
    tiles: [T.PLANKS, T.PLANKS, T.PLANKS], sound: 'wood',
    color: 0xb89258, hard: 0.5, box: [0, 0, 0, 1, 0.03125, 1],
    icon: T.PLANKS, drop: RS.PLATE_UP };

  // 红石灯：整块固体；亮态发光 15（World.set 自动重光照）
  defs[RS.LAMP_OFF] = { name: '红石灯', solid: true, opaque: true, rs: 'lamp', powered: false,
    tiles: [T.RS_LAMP_OFF, T.RS_LAMP_OFF, T.RS_LAMP_OFF], sound: 'glass',
    color: 0x6b4326, hard: 1.2, drop: RS.LAMP_OFF };
  defs[RS.LAMP_ON] = { name: '红石灯', solid: true, opaque: true, rs: 'lamp', powered: true, light: 15,
    tiles: [T.RS_LAMP_ON, T.RS_LAMP_ON, T.RS_LAMP_ON], sound: 'glass',
    color: 0xf0b45c, hard: 1.2, drop: RS.LAMP_OFF };

  // 中继器：延时二极管薄台（输出到除输入侧外的邻居）
  defs[RS.REP_OFF] = { name: '红石中继器', solid: false, opaque: false, rs: 'repeater', powered: false,
    tiles: [T.RS_REPEATER, T.RS_REPEATER, T.RS_REPEATER], sound: 'stone',
    color: 0x8d8d90, hard: 0.8, box: [0, 0, 0, 1, 0.1875, 1],
    icon: T.RS_REPEATER, drop: RS.REP_OFF };
  defs[RS.REP_ON] = { name: '红石中继器', solid: false, opaque: false, rs: 'repeater', powered: true,
    tiles: [T.RS_REPEATER, T.RS_REPEATER, T.RS_REPEATER], sound: 'stone',
    color: 0xd07138, hard: 0.8, box: [0, 0, 0, 1, 0.1875, 1],
    icon: T.RS_REPEATER, drop: RS.REP_OFF };

  // 红石粉物品：矿石直掉，是所有红石元件的合成基底
  defs[220] = { name: '红石粉', item: true, solid: false, opaque: false,
    tiles: [T.RS_DUST, T.RS_DUST, T.RS_DUST], sound: 'wool',
    color: 0xd8331e, icon: T.RS_DUST };

  // ============ 北欧城堡扩展（稳定方块 ID 215..219）============
  // 只在注册表尾部追加，不得复用/移动旧 ID；仅 nordic 主题世界自然/结构生成。
  // 黑沙：火山质感的深色沙滩（北欧峡湾群系地表）
  defs[215] = { name: '黑沙', solid: true, opaque: true,
    tiles: [T.BLACK_SAND, T.BLACK_SAND, T.BLACK_SAND], sound: 'sand',
    color: 0x5c6168, hard: 0.6 };
  // 暗色片麻岩：峡湾基岩山体的片理纹理
  defs[216] = { name: '暗色片麻岩', solid: true, opaque: true,
    tiles: [T.GNEISS, T.GNEISS, T.GNEISS], sound: 'stone',
    color: 0x4a4e58, hard: 4, pick: true };
  // 绯红瓦：城堡锥顶与坡屋顶的红陶鳞瓦
  defs[217] = { name: '绯红瓦', solid: true, opaque: true,
    tiles: [T.SHINGLE_RED, T.SHINGLE_RED, T.SHINGLE_RED], sound: 'stone',
    color: 0x9c3a30, hard: 2.5, pick: true };
  // 白灰泥墙：城堡主体亮白墙面
  defs[218] = { name: '白灰泥墙', solid: true, opaque: true,
    tiles: [T.PLASTER_WHITE, T.PLASTER_WHITE, T.PLASTER_WHITE], sound: 'stone',
    color: 0xe8e4d8, hard: 1.8 };
  // 枯草丛：黑沙丘上的北欧草簇（十字面片装饰）
  defs[219] = { name: '枯草丛', solid: false, opaque: false, cross: true, crossHeight: 0.7,
    tiles: [T.TUSSOCK_DRY, T.TUSSOCK_DRY, T.TUSSOCK_DRY], sound: 'leaves',
    color: 0xb08a4a, hard: 0.05 };

  // ============ v8 扩容：农耕系统（方块 ID 221..238，物品 239..247）============
  var FARM = {
    FARMLAND_DRY: 221, FARMLAND_WET: 222, TUFT: 223,
    WHEAT_A: 224, WHEAT_MATURE: 228,
    CARROT_A: 229, CARROT_MATURE: 233,
    POTATO_A: 234, POTATO_MATURE: 238
  };
  // 耕地：整格固体，顶面纹理区分干/湿
  defs[FARM.FARMLAND_DRY] = { name: '耕地', solid: true, opaque: true, farmland: 'dry',
    tiles: [T.FARM_TOP, T.DIRT, T.DIRT], sound: 'dirt', color: 0x7d5a3c, hard: 0.6, drop: 2 };
  defs[FARM.FARMLAND_WET] = { name: '耕地', solid: true, opaque: true, farmland: 'wet',
    tiles: [T.FARM_WET_TOP, T.DIRT, T.DIRT], sound: 'dirt', color: 0x5f452c, hard: 0.6, drop: 2 };
  // 草丛：十字矮草，破坏掉小麦种子
  defs[FARM.TUFT] = { name: '草丛', solid: false, opaque: false, cross: true, crossHeight: 0.55,
    tiles: [T.TUFT, T.TUFT, T.TUFT], sound: 'leaves', color: 0x6fa844, hard: 0.05,
    drop: 240 };

  function cropDef(name, tile, mature, seedDrop) {
    return { name: name, solid: false, opaque: false, cross: true, crossHeight: 0.65,
      tiles: [tile, tile, tile], sound: 'leaves', color: 0x86b049, hard: 0.02,
      crop: { kind: name }, drop: seedDrop };
  }
  // 小麦：4 阶段生长；未成熟掉种子，成熟特殊收割（麦子+种子）
  defs[224] = cropDef('小麦作物', T.WHEAT0, false, 240);
  defs[225] = cropDef('小麦作物', T.WHEAT0, false, 240);
  defs[226] = cropDef('小麦作物', T.WHEAT1, false, 240);
  defs[227] = cropDef('小麦作物', T.WHEAT2, false, 240);
  defs[228] = cropDef('小麦作物', T.WHEAT_MATURE, true, 240);
  // 胡萝卜/马铃薯：块茎即种即食
  for (var ci2 = 229; ci2 <= 232; ci2++) defs[ci2] = cropDef('胡萝卜作物', T.CARROT0, false, 245);
  defs[233] = cropDef('胡萝卜作物', T.CARROT_MATURE, true, 245);
  for (var pi2 = 234; pi2 <= 237; pi2++) defs[pi2] = cropDef('马铃薯作物', T.POTATO0, false, 246);
  defs[238] = cropDef('马铃薯作物', T.POTATO_MATURE, true, 246);

  // ---- 农耕物品 ----
  function foodItem(id, name, tile, color, foodVal) {
    defs[id] = { name: name, item: true, solid: false, opaque: false,
      tiles: [tile, tile, tile], sound: 'wool', color: color,
      icon: tile, food: foodVal };
  }
  defs[239] = { name: '小麦', item: true, solid: false, opaque: false,
    tiles: [T.I_WHEAT, T.I_WHEAT, T.I_WHEAT], sound: 'wool',
    color: 0xd9b13b, icon: T.I_WHEAT };
  defs[240] = { name: '小麦种子', item: true, solid: false, opaque: false, plantable: true,
    tiles: [T.I_SEEDS, T.I_SEEDS, T.I_SEEDS], sound: 'wool',
    color: 0x9db054, icon: T.I_SEEDS };
  foodItem(241, '面包', T.I_BREAD, 0xc08b46, 5);
  foodItem(242, '苹果', T.I_APPLE, 0xd83a30, 4);
  foodItem(243, '金苹果', T.I_GAPPLE, 0xf3c860, 12);
  foodItem(245, '生胡萝卜', T.I_CARROT, 0xe07828, 3); defs[245].plantable = true;
  foodItem(246, '生马铃薯', T.I_POTATO, 0xc9a86a, 1); defs[246].plantable = true;
  foodItem(247, '烤马铃薯', T.I_POTATO_BAKED, 0xd09248, 5);

  // 锄头：翻土成耕地（工具，不堆叠带耐久）
  defs[248] = { name: '木锄', item: true, solid: false, opaque: false,
    tiles: [T.HOE_WOOD, T.HOE_WOOD, T.HOE_WOOD], sound: 'wood',
    color: 0xa2824e, icon: T.HOE_WOOD, hoeTool: true, maxDur: 60, maxStack: 1 };
  defs[249] = { name: '石锄', item: true, solid: false, opaque: false,
    tiles: [T.HOE_STONE, T.HOE_STONE, T.HOE_STONE], sound: 'stone',
    color: 0x8a8a8a, icon: T.HOE_STONE, hoeTool: true, maxDur: 132, maxStack: 1 };
  defs[250] = { name: '铁锄', item: true, solid: false, opaque: false,
    tiles: [T.HOE_IRON, T.HOE_IRON, T.HOE_IRON], sound: 'stone',
    color: 0xd8d8d8, icon: T.HOE_IRON, hoeTool: true, maxDur: 251, maxStack: 1 };

  // ============ v8 扩容：染色体系（花 251..258，染料物品 260..275，变体方块 281+）============
  // 16 色调色板（对齐 wiki 染料顺序；白色复用原羊毛/陶瓦/玻璃）
  var DYE_PALETTE = [
    ['white', '白', [244, 244, 240], [236, 240, 241], [219, 235, 240]],
    ['light_gray', '淡灰', [157, 157, 161], [142, 142, 145], [166, 175, 176]],
    ['gray', '灰', [66, 67, 69], [62, 63, 64], [140, 141, 142]],
    ['black', '黑', [30, 27, 33], [21, 22, 25], [96, 98, 102]],
    ['brown', '棕', [131, 84, 50], [114, 71, 40], [132, 91, 43]],
    ['red', '红', [176, 46, 38], [160, 42, 36], [196, 60, 54]],
    ['orange', '橙', [240, 118, 19], [216, 106, 22], [232, 104, 22]],
    ['yellow', '黄', [248, 198, 39], [222, 178, 34], [240, 192, 42]],
    ['lime', '黄绿', [112, 185, 25], [100, 168, 26], [128, 199, 39]],
    ['green', '绿', [84, 109, 27], [76, 99, 24], [116, 167, 87]],
    ['cyan', '青', [21, 137, 145], [20, 125, 133], [79, 163, 168]],
    ['light_blue', '淡蓝', [58, 179, 218], [52, 165, 202], [180, 214, 225]],
    ['blue', '蓝', [53, 57, 157], [48, 51, 143], [105, 117, 195]],
    ['purple', '紫', [121, 42, 172], [110, 38, 158], [154, 92, 198]],
    ['magenta', '品红', [189, 68, 179], [173, 62, 164], [213, 123, 208]],
    ['pink', '粉', [237, 141, 172], [219, 129, 159], [243, 171, 190]]
  ];

  // 花：十字面片小植物，天然生成于草地
  var FLOWER_KINDS = [
    { dye: 5 /*red*/,   name: '玫瑰' },
    { dye: 7 /*yellow*/, name: '蒲公英' },
    { dye: 12 /*blue*/, name: '矢车菊' },
    { dye: 0 /*white*/, name: '滨菊' },
    { dye: 15 /*pink*/, name: '粉郁金香' },
    { dye: 6 /*orange*/, name: '橙郁金香' },
    { dye: 11 /*lt_blue*/, name: '蓝铃花' },
    { dye: 13 /*purple*/, name: '绒球葱' }
  ];
  for (var fk = 0; fk < FLOWER_KINDS.length; fk++) {
    (function (i) {
      var fl = FLOWER_KINDS[i];
      defs[251 + i] = {
        name: fl.name, solid: false, opaque: false, cross: true, crossHeight: 0.65,
        flower: { dyeIndex: fl.dye },
        tiles: [T.FLOWER0 + i, T.FLOWER0 + i, T.FLOWER0 + i],
        sound: 'leaves', color: 0x88b04a, hard: 0.03, drop: 260 + fl.dye
      };
    })(fk);
  }

  // 染料物品 ×16
  for (var di = 0; di < DYE_PALETTE.length; di++) {
    (function (i) {
      var pal = DYE_PALETTE[i];
      defs[260 + i] = {
        name: pal[1] + '色染料', item: true, solid: false, opaque: false,
        tiles: [T.I_DYE0 + i, T.I_DYE0 + i, T.I_DYE0 + i],
        sound: 'wool', color: (pal[2][0] << 16) | (pal[2][1] << 8) | pal[2][2],
        icon: T.I_DYE0 + i, dyeIndex: i
      };
    })(di);
  }
  // 反查：染料物品 ID → 色号
  function dyeIndexOf(id) {
    var d = id >= 260 && id <= 275 ? defs[id] : null;
    return d ? d.dyeIndex : -1;
  }

  // ============ v8 扩容：建造全家桶（台阶 340，楼梯 350..361，栅栏 362，玻璃板 363）============
  // 台阶：下半薄块（half 物理语义）
  var SLAB_DEFS = [
    { name: '木板台阶', tile: T.PLANKS, sound: 'wood', color: 0xa2824e },
    { name: '石头台阶', tile: T.STONE, sound: 'stone', color: 0x7f7f7f },
    { name: '圆石台阶', tile: T.COBBLE, sound: 'stone', color: 0x6f6f6f }
  ];
  for (var sdi = 0; sdi < SLAB_DEFS.length; sdi++) {
    defs[340 + sdi] = {
      name: SLAB_DEFS[sdi].name, solid: true, opaque: false, half: true,
      tiles: [SLAB_DEFS[sdi].tile, SLAB_DEFS[sdi].tile, SLAB_DEFS[sdi].tile],
      sound: SLAB_DEFS[sdi].sound, color: SLAB_DEFS[sdi].color,
      hard: 2, pick: SLAB_DEFS[sdi].sound === 'stone', drop: 340 + sdi,
      boxes: [[0, 0, 0, 1, 0.5, 1]]
    };
  }
  // 楼梯：底部整层 + 后半高台；dir 编码上楼方向（0:+x 1:-x 2:+z 3:-z）
  var STAIR_MATS = [
    { name: '木板楼梯', tile: T.PLANKS, sound: 'wood', color: 0xa2824e, pick: false },
    { name: '石头楼梯', tile: T.STONE, sound: 'stone', color: 0x7f7f7f, pick: true },
    { name: '圆石楼梯', tile: T.COBBLE, sound: 'stone', color: 0x6f6f6f, pick: true }
  ];
  function stairBoxes(dir) {
    var back;   // 高台位于背对行进方向的一侧
    if (dir === 0) back = [0, 0.5, 0, 0.5, 1, 1];
    else if (dir === 1) back = [0.5, 0.5, 0, 1, 1, 1];
    else if (dir === 2) back = [0, 0.5, 0, 1, 1, 0.5];
    else back = [0, 0.5, 0, 1, 1, 1];
    return [[0, 0, 0, 1, 0.5, 1], back];
  }
  for (var smi = 0; smi < STAIR_MATS.length; smi++) {
    for (var sd = 0; sd < 4; sd++) {
      defs[350 + smi * 4 + sd] = {
        name: STAIR_MATS[smi].name, solid: true, opaque: false, stairDir: sd,
        tiles: [STAIR_MATS[smi].tile, STAIR_MATS[smi].tile, STAIR_MATS[smi].tile],
        sound: STAIR_MATS[smi].sound, color: STAIR_MATS[smi].color,
        hard: 2, pick: STAIR_MATS[smi].pick,
        drop: 350 + smi * 4,        // 四个方向统一掉基础朝向
        icon: undefined,
        boxes: stairBoxes(sd)
      };
    }
  }
  defs[362] = {
    name: '木栅栏', solid: true, opaque: false,
    tiles: [T.PLANKS, T.PLANKS, T.PLANKS], sound: 'wood',
    color: 0xa2824e, hard: 1.5, drop: 362,
    connector: { kind: 'fence' }
  };
  defs[363] = {
    name: '玻璃板', solid: false, opaque: false,
    tiles: [T.GLASS, T.GLASS, T.GLASS], sound: 'glass',
    color: 0xbfe3ee, hard: 0.45, drop: 363,
    connector: { kind: 'pane' }
  };

  // 彩色羊毛 ×15（跳过白色，白色即原羊毛 id16）
  for (var wvi = 0; wvi < DYE_PALETTE.length; wvi++) {
    if (wvi === 0) continue;
    (function (i) {
      var pal = DYE_PALETTE[i];
      defs[280 + i] = {
        name: pal[1] + '色羊毛', solid: true, opaque: true,
        tiles: [T.WOOL_C0 + i - 1, T.WOOL_C0 + i - 1, T.WOOL_C0 + i - 1],
        sound: 'wool', color: (pal[3][0] << 16) | (pal[3][1] << 8) | pal[3][2],
        hard: 0.7, drop: 280 + i
      };
    })(wvi);
  }
  // 彩色陶瓦 ×16（除 27 号素陶瓦外的全部颜色）
  for (var tvi = 0; tvi < DYE_PALETTE.length; tvi++) {
    if (tvi === 0) continue;
    (function (i) {
      var pal = DYE_PALETTE[i];
      defs[300 + i] = {
        name: pal[1] + '色陶瓦', solid: true, opaque: true,
        tiles: [T.TERRA_C0 + i - 1, T.TERRA_C0 + i - 1, T.TERRA_C0 + i - 1],
        sound: 'stone', color: (pal[4][0] << 16) | (pal[4][1] << 8) | pal[4][2],
        hard: 3, pick: true, drop: 300 + i
      };
    })(tvi);
  }
  // 彩色玻璃 ×16 中未存在的 13 色（红88/青89/金90 已存在 → 跳过其 palette 索引近似值）
  var EXISTING_GLASS = { 5: 88, 10: 89, 7: 90 }; // 近似映射：red→GLASS_RED, cyan→GLASS_CYAN, yellow→GLASS_GOLD
  for (var gvi = 0; gvi < DYE_PALETTE.length; gvi++) {
    // 跳过白色（=原玻璃）以及与旧三彩玻璃近似的 红/黄/青 和 黑/棕/绿/紫/品红
    if ({0:1,3:1,4:1,9:1,13:1,14:1,5:1,10:1,7:1}[gvi]) continue;
    (function (i) {
      var pal = DYE_PALETTE[i];
      defs[320 + i] = {
        name: pal[1] + '彩玻璃', solid: true, opaque: false, stained: true,
        tiles: [T.GLASS_C0 + i - 1, T.GLASS_C0 + i - 1, T.GLASS_C0 + i - 1],
        sound: 'glass',
        color: (pal[3][0] << 16) | (pal[3][1] << 8) | pal[3][2],
        hard: 0.45, drop: 320 + i
      };
    })(gvi);
  }

  var atlasCanvas = null, atlasTexture = null;
  // v8 图集升格：512×512（32×32=1024 个 16px tile），彩色变体批量绘制需要余量
  var ATLAS_SIZE = 512;
  var TILES_PER_ROW = 32;
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
    atlasCanvas.width = ATLAS_SIZE;
    atlasCanvas.height = ATLAS_SIZE;
    var ctx = atlasCanvas.getContext('2d');
    var img = ctx.createImageData(ATLAS_SIZE, ATLAS_SIZE);
    var d = img.data;

    function px(x, y, r, g, b, a) {
      var i = (y * ATLAS_SIZE + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = (a === undefined ? 255 : a);
    }

    function drawTile(idx, fn) {
      var ox = (idx % TILES_PER_ROW) * 16, oy = ((idx / TILES_PER_ROW) | 0) * 16;
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
    drawTile(T.GOLD_ORE, oreTile([244, 206, 82]));
    drawTile(T.DIAMOND_ORE, oreTile([96, 224, 214]));

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
    drawTile(T.PICK_GOLD, pickTile([244, 206, 82]));
    drawTile(T.PICK_DIAMOND, pickTile([96, 224, 214]));

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
    drawTile(T.SWORD_GOLD, swordTile([250, 224, 108]));
    drawTile(T.SWORD_DIAMOND, swordTile([140, 240, 230]));

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

    // 斜置金属锭：平行四边形锭身 + 高光边（参数化，铁锭/金锭共用画法）
    function ingotTile(base, hi, lo) {
      return function (x, y, r) {
        var row = y - 4;
        if (row < 0 || row > 7) return;
        var x0 = 3 + ((7 - row) >> 1), x1 = x0 + 9;
        if (x < x0 || x > x1) return;
        if (row <= 1 || x === x1) return [hi[0] + r() * 14, hi[1] + r() * 10, hi[2]];   // 上/右高光
        if (row >= 7 || x === x0) return lo;                                            // 下/左阴影
        var v = n(r, 0, 12);
        return [base[0] + v, base[1] + v, base[2] + v];
      };
    }

    drawTile(T.INGOT, ingotTile([216, 175, 135], [240, 214, 176], [158, 118, 84]));
    drawTile(T.INGOT_GOLD, ingotTile([244, 206, 82], [255, 238, 150], [172, 128, 38]));

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

    // ---- 钻石 / 木炭 / 功能装备图标 ----

    drawTile(T.GEM_DIAMOND, function (x, y, r) {
      // 菱形宝石：上宽冠部 + 下尖亭部，青白渐变 + 描边 + 斜高光
      if (y < 2 || y > 14) return;
      var half = (y <= 6) ? (y - 1) * 0.9 + 1 : (14 - y) * 1.05 + 0.6;
      var dx = Math.abs(x - 7.5);
      if (dx > half) return;
      var v = n(r, 0, 14);
      if (dx > half - 1.1) return [110 + v, 200 + v, 202 + v];            // 描边
      if (Math.abs((x + y) - 14) < 1.6 && y <= 8) return [228 + v, 252, 252]; // 冠部斜高光
      if (y <= 6) return [186 + v, 244 + v, 242 + v];                     // 亮冠部
      return [140 + v, 222 + v, 220 + v];                                 // 亭部
    });

    drawTile(T.CHARCOAL, function (x, y, r) {
      // 炭块团：不规则深灰黑块 + 焦褐边缘 + 灰白灰烬点，透明底
      var dx = x - 8, dy = y - 8;
      var wob = 1 + 0.06 * Math.sin(x * 2.3 + 1) * Math.cos(y * 1.9);
      if (dx * dx * 0.11 + dy * dy * 0.13 > wob) return;
      var v = n(r, 0, 16);
      if (r() < 0.10) return [98 + v, 90 + v, 80 + v];                    // 灰烬斑
      if (r() < 0.12) return [66 + v, 46 + v, 34 + v];                    // 焦褐边
      return [30 + v, 28 + v, 27 + v];                                    // 炭体
    });

    drawTile(T.MASK_GAS, function (x, y, r) {
      // 防毒面具：灰绿橡胶罩体 + 双圆目镜 + 下部圆形滤毒罐 + 两侧绑带
      var dx = x - 8, dy = y - 7.5;
      if (dx * dx * 0.16 + dy * dy * 0.14 <= 1) {
        var v = n(r, 0, 12);
        var e1 = (x - 5) * (x - 5) + (y - 5.5) * (y - 5.5);
        var e2 = (x - 11) * (x - 11) + (y - 5.5) * (y - 5.5);
        if (e1 <= 1.2 || e2 <= 1.2) return [152, 222, 232];               // 镜片反光
        if (e1 <= 2.6 || e2 <= 2.6) return [40, 44, 48];                  // 镜框
        if (y >= 10 && y <= 14) {                                          // 滤毒罐
          var fd = (x - 8) * (x - 8) + (y - 11.5) * (y - 11.5);
          if (fd <= 1.6) return [70, 76, 68];
          if (fd <= 3.6) return [96, 104, 92];
        }
        return [128 + v, 138 + v, 122 + v];                               // 罩体
      }
      if ((y === 6 || y === 9) && (x <= 2 || x >= 13)) return [92, 98, 88]; // 绑带
    });

    drawTile(T.SUIT_COLD, function (x, y, r) {
      // 防寒服：深蓝躯干 + 白色毛领 + 中央拉链 + 橙色袖标
      if (x < 2 || x > 13 || y < 2 || y > 14) return;
      var v = n(r, 0, 12);
      if (y <= 3) {                                                        // 白色毛领
        if (r() < 0.3) return [218 + v, 222 + v, 228];
        return [240, 244, 248];
      }
      if (x === 7 || x === 8) return [186 + v, 194 + v, 204 + v];          // 拉链
      if ((x >= 3 && x <= 4 || x >= 11 && x <= 12) && y >= 6 && y <= 8)
        return [236, 152, 48];                                             // 橙色缀条
      if (x === 2 || x === 13 || y === 14) return [28 + v, 44 + v, 66 + v]; // 描边阴影
      return [46 + v, 68 + v, 96 + v];                                     // 深蓝布面
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

    // ---- 星海嘉年华瓦片（经典嘉年华暖色系）----

    // 游乐草坪：修剪过的翠绿草皮 + 稀疏彩纸屑点缀
    drawTile(T.PARK_LAWN_TOP, function (x, y, r) {
      var v = n(r, 0, 14);
      var confetti = r() < 0.045;
      if (confetti) {
        var pick = (x + y * 3) % 4;
        if (pick === 0) return [246 + v, 242 + v, 236];   // 白
        if (pick === 1) return [240 + v, 150 + v, 168];   // 粉
        if (pick === 2) return [250 + v, 214 + v, 110];   // 黄
        return [132 + v, 214 + v, 226];                   // 青
      }
      return [88 + v, 158 + v, 70 + v];
    });
    // 草坪侧：泥土底 + 厚草皮压边
    drawTile(T.PARK_LAWN_SIDE, function (x, y, r) {
      var v = n(r, 0, 12);
      if (y <= 3) return [92 - y * 3 + v, 162 - y * 4 + v, 72 + v];
      if (y === 4 && r() < 0.5) return [86 + v, 146 + v, 66 + v];
      var speck = r() < 0.06;
      return speck ? [128 + v, 96 + v, 64] : [124 + v, 88 + v, 58 + v];
    });

    // 奶油石板：暖象牙色大板 + 浅焦糖勾缝与细斑点
    drawTile(T.CREAM_PAVE, function (x, y, r) {
      var v = n(r, 0, 8);
      var seam = (x % 8 === 7) || (y % 8 === 7);
      if (seam) return [206 + v, 186 + v, 152];
      var dot = ((x * 5 + y * 11) % 29) === 0;
      return dot ? [222 + v, 200 + v, 164] : [235 + v, 224 + v, 200 + v];
    });

    // 粉彩砖：奶粉色错缝砖 + 奶白灰浆
    drawTile(T.PASTEL_BRICK, function (x, y, r) {
      var v = n(r, 0, 9);
      var row = (y / 4) | 0;
      var off = row % 2 ? 4 : 0;
      var mortar = (y % 4 === 3) || ((x + off) % 8 === 7);
      if (mortar) return [240 + v, 230 + v, 220];
      return [226 + v, 165 + v, 176 + v];
    });

    // 糖果柱：红白糖果 45° 宽条纹，亮带高光
    drawTile(T.CANDY_STRIPE, function (x, y, r) {
      var s = (((x + y) % 10) + 10) % 10;
      var v = n(r, 0, 10);
      if (s < 5) return (s === 1 || s === 2) ? [246 + v, 118 + v, 108] : [232 + v, 96 + v, 88];
      return (s === 7) ? [252, 248, 244] : [244 + v, 238 + v, 232];
    });

    // 金饰块：缎金浮雕回纹 + 顶部抛光高光
    drawTile(T.GOLD_TRIM, function (x, y, r) {
      var v = n(r, 0, 8);
      var groove = (y % 4 === 2) && ((x + ((y / 4) % 2) * 2) % 4 !== 0);
      if (groove) return [148 + v, 100 + v, 40];                  // 回纹凹槽
      if (y === 0) return [252, 226, 148];                        // 抛光棱线
      if (y === 15) return [172 + v, 120 + v, 46];                // 底部收影
      var sheen = ((x * 7 + y * 13) % 31) === 0;
      return sheen ? [250, 218, 130] : [222 + v, 174 + v, 78 + v];
    });

    // 暖黄灯球：磨砂暖光球心 + 深色金属抱箍
    drawTile(T.LANTERN, function (x, y, r) {
      var dx = x - 7.5, dy = y - 7.5;
      var d = Math.sqrt(dx * dx + dy * dy);
      var hoop = Math.abs(dy) > 4.4 && Math.abs(dy) < 6.2 && d > 4.5; // 上下钢箍
      if (hoop) return [82, 72, 62];
      if (d > 7.6) {
        var hv = n(r, 0, 8);
        return [84 + hv, 76 + hv, 66 + hv];                       // 边角舱壳
      }
      var glow = Math.max(0, 1 - d / 7.6);                        // 径向暖光
      return [255, 208 + glow * 38, 128 + glow * 74];
    });

    // 白漆栏杆：奶白烤漆面 + 铆点与漆面阴影
    drawTile(T.RAIL_WHITE, function (x, y, r) {
      var v = n(r, 0, 7);
      if (y <= 1) return [252, 250, 244];
      if (y >= 14) return [212 + v, 204 + v, 188];                 // 底部落影
      if ((x * 3 + y * 5) % 37 === 0) return [198, 192, 178];      // 铆点
      var grain = ((x * 13 + y * 3) % 47) === 0;
      return grain ? [228 + v, 222 + v, 206] : [242 + v, 237 + v, 226];
    });

    // 蓝瓦块：亮粉彩宝蓝鱼鳞瓦（着色器 br^1.35 压暗中间调，贴图需给足亮度）
    drawTile(T.ROOF_BLUE, function (x, y, r) {
      var v = n(r, 0, 10);
      var row = (y / 4) | 0;
      var off = row % 2 ? 4 : 0;
      var scaleDip = ((x + off) % 8 === 0) || (y % 4 === 0);
      if (scaleDip) return [130 + v, 164 + v, 228];
      var scaleHi = ((x + off) % 8 === 1);
      return scaleHi ? [216 + v, 236 + v, 254] : [180 + v, 208 + v, 250];
    });

    // 霓虹紫灯带：哑黑槽壳内嵌亮紫光管
    drawTile(T.NEON_PURPLE, function (x, y, r) {
      var v = n(r, 0, 6);
      if (y >= 5 && y <= 10) {
        var core = y >= 7 && y <= 8;
        return core ? [238, 170, 255] : [172 + v, 90 + v, 216 + v];
      }
      var bolt = ((x * 7 + y * 5) % 53) === 0;
      return bolt ? [64, 44, 78] : [36 + v, 30 + v, 44 + v];
    });

    // 霓虹青灯带：同构青色版
    drawTile(T.NEON_CYAN, function (x, y, r) {
      var v = n(r, 0, 6);
      if (y >= 5 && y <= 10) {
        var core = y >= 7 && y <= 8;
        return core ? [214, 255, 255] : [70 + v, 196 + v, 210 + v];
      }
      var bolt = ((x * 7 + y * 5) % 53) === 0;
      return bolt ? [40, 66, 72] : [26 + v, 38 + v, 44 + v];
    });

    // 彩旗串：透明底挂绳 + 红黄蓝三角旗
    drawTile(T.BUNTING, function (x, y, r) {
      if (y > 9) return undefined;                                  // 下半悬空
      if (y === 1 && (x % 16) >= 0) return [124, 106, 88];          // 挂绳
      if (y < 2) return undefined;
      var cell = (x / 4) | 0;
      var inTri = x % 4 < 3 && y - 2 < 5 - (Math.abs((x % 4) - 1)) * 1.6;
      if (!inTri) return undefined;
      var v = n(r, 0, 8);
      var tri = cell % 3;
      if (tri === 0) return [235 + v, 92 + v, 84];                  // 红
      if (tri === 1) return [248 + v, 206 + v, 98];                 // 黄
      return [96 + v, 156 + v, 232];                                // 蓝
    });

    // 乘坐台：安全黄圆盘 + 钢圈描边 + 中央箭头
    drawTile(T.RIDE_PAD, function (x, y, r) {
      var dx = x - 7.5, dy = y - 7.5;
      var d2 = dx * dx + dy * dy;
      var v = n(r, 0, 8);
      if (d2 > 56) {
        var steel = ((x + y) % 15 === 0);
        return steel ? [148 + v, 154 + v, 166] : [122 + v, 130 + v, 142 + v]; // 包边钢板
      }
      if (d2 > 45) return [60, 63, 70];                             // 钢圈内衬
      if (d2 <= 18 && Math.abs(dx * 0.7 - dy * 0.7) < 3.2 && dx + dy > 2)
        return [54, 58, 66];                                        // 前进箭头
      var wear = ((x * 5 + y * 9) % 41) === 0;
      return wear ? [222 + v, 168 + v, 52] : [246 + v, 194 + v, 62]; // 安全黄
    });

    // 童话粉墙：近白暖墙（照片实测阳光面 #f6f3f1）+ 浅玫瑰砖缝点缀 + 金线
    drawTile(T.CASTLE_PINK, function (x, y, r) {
      var v = n(r, 0, 8);
      if (y === 0) return [252, 232, 184];                          // 金线
      var row = (y / 4) | 0;
      var off = row % 2 ? 5 : 0;
      var joint = (y % 4 === 3) || ((x + off) % 10 === 9);
      if (joint) return [240 + v, 212 + v, 208];                    // 浅玫瑰砖缝
      var hi = ((x * 3 + y * 7) % 37) === 0;
      return hi ? [255, 255, 254] : [253 + v, 247 + v, 243];
    });

    // 城堡宝蓝墙：高亮粉彩宝蓝（照片实测 #6191cc 经 br^1.35 补偿提亮）
    drawTile(T.CASTLE_BLUE, function (x, y, r) {
      var v = n(r, 0, 9);
      var row = (y / 4) | 0;
      var off = row % 2 ? 5 : 0;
      var joint = (y % 4 === 3) || ((x + off) % 10 === 9);
      if (joint) return [128 + v, 162 + v, 228];
      var hi = ((x * 3 + y * 7) % 37) === 0;
      return hi ? [226 + v, 240 + v, 255] : [182 + v, 208 + v, 248];
    });
    // 彩色玻璃：圣像窗格图案，整体半透明（alpha 入画布 → 透明水材质组混合）
    function stainedTile(base, light) {
      return function (x, y, r) {
        // 铅条骨架：菱形网格 + 边框
        var edge = x === 0 || y === 0 || x === 15 || y === 15;
        var dia = Math.abs((x % 8) - 4) + Math.abs((y % 8) - 4);
        if (edge || dia === 4) return [52, 50, 58, 255];         // 深铅条（不透明）
        var v = n(r, 0, 14);
        var glow = dia <= 1 ? light : base;                       // 菱心高光
        return [glow[0] + v, glow[1] + v, glow[2] + v, 150];      // 半透玻璃体
      };
    }
    drawTile(T.GLASS_RED, stainedTile([216, 87, 79], [248, 168, 150]));
    drawTile(T.GLASS_CYAN, stainedTile([92, 200, 224], [178, 240, 248]));
    drawTile(T.GLASS_GOLD, stainedTile([243, 177, 62], [252, 226, 156]));
    drawTile(T.TOKEN, function (x, y, r) {
      // 乐园代币：金色圆币 + 摩天轮压印 + 高光弧，透明底
      var dx = x - 7.5, dy = y - 7.5;
      var d2 = dx * dx + dy * dy;
      if (d2 > 30) return;
      var v = n(r, 0, 10);
      if (d2 > 24) return [172 + v, 128 + v, 38];               // 币缘
      if (d2 < 3) return [255, 244, 190];                        // 中心高光
      // 摩天轮压印：圆环 + 四根辐条 + 中点
      var ring = Math.abs(Math.sqrt(d2) - 4.6) < 0.9;
      var spoke = (Math.abs(dx) < 0.9 || Math.abs(dy) < 0.9 ||
        Math.abs(Math.abs(dx) - Math.abs(dy)) < 1.1) && Math.sqrt(d2) < 4.2;
      if (ring || spoke) return [196 + v, 148 + v, 46];
      return [238 + v, 196 + v, 74];                             // 币面
    });
    drawTile(T.FW_ROD, function (x, y, r) {
      // 烟花棒：斜握纸棒 + 顶端星形药花 + 火花点，透明底
      // 棒体：左下→右上对角带
      var d = Math.abs((x - 3) * 0.72 - (12.2 - y));
      if (d < 1.35 && x >= 2 && x <= 12 && y >= 4 && y <= 13) {
        var v = n(r, 0, 8);
        var stripe = ((x + y) % 5 < 2);
        return stripe ? [238 + v, 238 + v, 232] : [216 + v, 87 + v, 79];
      }
      // 顶端药花：右上角星形 + 火花
      var dx = x - 11.5, dy = y - 3.5;
      var dd = Math.sqrt(dx * dx + dy * dy);
      if (dd < 1.2) return [255, 240, 170];
      var star = Math.abs(dx) < 0.8 || Math.abs(dy) < 0.8 ||
        (Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.7 && dd < 3.4);
      if (star && dd < 3.4) return [255, 196 + n(r, 0, 30), 96];
      if (dd < 4.6 && r() < 0.10) return [255, 170 + n(r, 0, 40), 80]; // 火花点
      return;
    });

    // ---- 战斗装备瓦片（透明底物品画）----
    drawTile(T.BOW, function (x, y, r) {
      // 弓：右侧竖弦 + 弓身弧线 + 握把缠带
      var dx = x - 4.5, dy = y - 7.5;
      var arc = Math.abs(Math.sqrt(dx * dx + dy * dy) - 6.2) < 1.5 &&
        dx >= -1 && x <= 9 && Math.abs(dy) < 7.5;
      if (arc) {
        var v = n(r, 0, 12);
        var grip = y >= 6 && y <= 9 && x >= 3 && x <= 6;
        if (grip) return [142 + v, 102 + v, 60];                 // 缠带段
        return [128 + v, 90 + v, 48];                             // 弓身
      }
      if (x === 11 || x === 12) {
        var sv = n(r, 0, 8);
        if (y >= 2 && y <= 13) return [232 + sv, 226 + sv, 210]; // 弦
      }
      return;
    });
    drawTile(T.ARROW, function (x, y, r) {
      // 箭：石镞头 + 直杆 + 尾羽两撇
      var d = Math.abs((x - 4) - (y - 3));   // 左上→右下主轴
      var v = n(r, 0, 8);
      if (d < 0.9 && x >= 2 && x <= 12) return [150 + v, 146 + v, 132]; // 杆
      var tipD = Math.abs((x - 9.5) - (y - 3));
      if ((tipD < 1.6 && x >= 9 && x <= 12 && y >= 2 && y <= 6)) {
        return [190 + v, 188 + v, 176];                          // 石镞
      }
      var fD = Math.abs((x - 2.5) - (y - 9));
      if (Math.abs(fD - 1.4) < 1.1 && x <= 5 && y >= 7)
        return [216 + v, 87 + v, 79];                            // 红羽
      return;
    });
    function armorTilePaint(baseRGB, trimRGB, hoodless) {
      return function (x, y, r) {
        var v = n(r, 0, 10);
        var edge = x === 0 || x === 15;
        var body = y >= (hoodless ? 5 : 3);
        if (!body) {
          // 头盔顶弧 / 面甲开口
          var opening = !hoodless && x >= 5 && x <= 10 && y >= 1;
          if (opening) return [40 + v, 38 + v, 36];
          return baseRGB;
        }
        if (edge) return trimRGB;                                 // 肩缘强化条
        if (!hoodless && y <= 5) return baseRGB;                  // 护颈过渡
        // 身体段：胸口横扣 + 竖缝
        var buckle = Math.abs(y - 8) < 1 && Math.abs(x - 8) < 2;
        var seam = x === 8;
        if (buckle) return trimRGB;
        if (seam) return [baseRGB[0] - 26 + v, baseRGB[1] - 26 + v, baseRGB[2] - 26 + v];
        return [baseRGB[0] + v, baseRGB[1] + v, baseRGB[2] + v];
      };
    }
    drawTile(T.CAP_FELT, armorTilePaint([196, 184, 166], [150, 138, 120]));
    drawTile(T.TUNIC_FELT, armorTilePaint([186, 172, 152], [140, 126, 106]));
    drawTile(T.HELM_IRON, armorTilePaint([208, 208, 212], [148, 148, 154]));
    drawTile(T.CHESTPLATE_IRON, armorTilePaint([200, 200, 206], [142, 142, 150]));

    // ---- v8：门 / 活板门瓦片 ----
    // 门板：竖条镶板 + 四角金属扣 + 右上把手（axis 无关，正反同贴图）
    function doorTilePaint(base, dark, rail, iron) {
      return function (x, y, r) {
        if (x === 0 || x === 15 || y === 0 || y === 15) return rail;
        // 竖向分栏：中缝 x=7..8
        var seam = (x === 7 || x === 8);
        // 上半窗格（木门挖空浅色玻璃感；铁门为实心铆面）
        var paneTop = (y >= 2 && y <= 6 && (x >= 2 && x <= 6));
        var paneTopR = (y >= 2 && y <= 6 && (x >= 9 && x <= 13));
        if ((paneTop || paneTopR) && !iron) {
          var pv = n(r, 0, 14);
          return [176 + pv * 0.4, 214 + pv, 226 + pv, 150];
        }
        // 镶板凹槽边线
        var inPanel = !seam && ((x >= 2 && x <= 13) && !(y < 8 ? (y < 1) : false));
        var edge = seam || x === 1 || x === 14 ||
          (y === 7 && x > 1 && x < 14) ||
          ((y === 1 || y === 6 || y === 9 || y === 14) && x > 1 && x < 14);
        if (edge && !iron) {
          var ev = n(r, 0, 10);
          return [dark[0] + ev, dark[1] + ev, dark[2] + ev];
        }
        if (edge && iron) return [rail[0] - 18, rail[1] - 18, rail[2] - 18];
        // 把手：右上凸点（x=11,y=5）
        if (x === 11 && y === 5) return iron ? [230, 232, 238] : [250, 214, 96];
        // 铁门铆钉
        if (iron && (x % 5 === 1) && (y % 5 === 3)) return [235, 238, 244];
        var v = n(r, iron ? 0 : 12, iron ? 10 : 14);
        return [base[0] + v, base[1] + v, base[2] + v];
      };
    }
    drawTile(T.DOOR_OAK, doorTilePaint([168, 136, 84], [128, 102, 60], [104, 82, 48], false));
    drawTile(T.DOOR_SPRUCE, doorTilePaint([112, 86, 52], [80, 60, 36], [62, 46, 28], false));
    drawTile(T.DOOR_BIRCH, doorTilePaint([204, 190, 150], [160, 146, 108], [120, 106, 76], false));
    drawTile(T.DOOR_JUNGLE, doorTilePaint([148, 112, 70], [108, 80, 50], [86, 64, 40], false));
    drawTile(T.DOOR_ACACIA, doorTilePaint([164, 92, 54], [122, 66, 38], [98, 52, 30], false));
    drawTile(T.DOOR_CHERRY, doorTilePaint([206, 158, 166], [162, 116, 126], [130, 90, 100], false));
    drawTile(T.DOOR_IRON, doorTilePaint([188, 192, 200], [150, 154, 162], [226, 229, 235], true));
    // 活板门：横条格栅（顶视/侧视通用）
    drawTile(T.TRAPDOOR_TOP, function (x, y, r) {
      if (y % 4 === 0) return [110, 88, 52];
      if (x === 0 || x === 15) return [118, 94, 56];
      if ((y % 8 === 2 && x > 2 && x < 13) || (Math.abs(x - y) % 7 === 0 && y > 1)) return [132, 105, 63];
      var v = n(r, 0, 16);
      return [166 + v, 134 + v, 82 + v * 0.8];
    });

    // ---- v8：红石瓦片 ----
    function rsWirePaint(lit) {
      return function (x, y, r) {
        // 深色石板底 + 十字导线（中心线亮红）
        var onLine = (y >= 6 && y <= 9) || (x >= 6 && x <= 9);
        if (!onLine) {
          var g0 = n(r, 0, 18);
          return [96 + g0 * 0.6, 88 + g0 * 0.5, 84 + g0 * 0.5];
        }
        var dot = ((x + y) % 3 === 0);
        if (lit) {
          var hv = dot ? 30 : 0;
          return [236 + hv, 66 + (dot ? 40 : 0), 24];
        }
        var dv = n(r, 0, 10);
        return [104 + dv * 0.4, 22, 18];
      };
    }
    drawTile(T.RS_WIRE_OFF, rsWirePaint(false));
    drawTile(T.RS_WIRE_ON, rsWirePaint(true));
    // 红石火把：木杆 + 顶端发光头（icon 与 cross 渲染共用）
    drawTile(T.RS_TORCH, function (x, y, r) {
      if (x >= 6 && x <= 9 && y >= 1 && y <= 5) {
        var core = (x >= 7 && x <= 8 && y >= 2 && y <= 4);
        return core ? [255, 120, 60] : [216, 54, 26];
      }
      if (x >= 7 && x <= 8 && y >= 5) {
        var wv = n(r, 0, 12);
        return [104 + wv, 82 + wv, 50 + wv];
      }
      return null;
    });
    // 拉杆基座：圆石窝 + 斜杆
    drawTile(T.RS_LEVER_BASE, function (x, y, r) {
      var dx = x - 8, dy = y - 11;
      if (dx * dx + dy * dy < 14) return [70 + r() * 12, 68 + r() * 12, 66 + r() * 12];
      if (Math.abs((x - 3) - (y - 15) * 0.82) < 1.4 && y > 3 && y < 13)
        return Math.abs(x - 7.4) < 0.9 ? [188, 108, 48] : [142, 80, 36];
      var cv = n(r, 0, 26);
      return [126 + cv, 124 + cv, 122 + cv];
    });
    // 按钮 / 压力板顶面（石头/木头）
    drawTile(T.RS_BTN, function (x, y, r) {
      if (x < 3 || x > 12 || y < 3 || y > 12) {
        var bv0 = n(r, 0, 20); return [100 + bv0, 98 + bv0, 100 + bv0];
      }
      var bv = n(r, 0, 18);
      var rim = (x === 3 || x === 12 || y === 3 || y === 12);
      return rim ? [112 + bv, 110 + bv, 114 + bv] : [138 + bv, 136 + bv, 140 + bv];
    });
    drawTile(T.RS_LAMP_OFF, function (x, y, r) {
      var cx2 = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (cx2 > 6) { var rv = n(r, 0, 14); return [92 + rv, 62 + rv, 38 + rv]; }
      var gv = n(r, 0, 10);
      return [58 + gv, 38 + gv, 26 + gv];
    });
    drawTile(T.RS_LAMP_ON, function (x, y, r) {
      var cxx = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (cxx > 6) { var rv2 = n(r, 0, 14); return [132 + rv2, 86 + rv2, 44 + rv2]; }
      var lv = n(r, 0, 24);
      return [252 - lv * 0.2, 208 + lv * 0.6, 116 + lv * 0.9];
    });
    drawTile(T.RS_REPEATER, function (x, y, r) {
      if (y < 3 || y > 12) { var sv0 = n(r, 0, 18); return [122 + sv0, 120 + sv0, 124 + sv0]; }
      // 两枚火把点 + 滑轨
      var tick = (x >= 3 && x <= 4) || (x >= 11 && x <= 12);
      if (tick && y >= 5 && y <= 8) return [222, 70, 30];
      if (x >= 6 && x <= 9) { var mv = n(r, 0, 10); return [86 + mv, 84 + mv, 88 + mv]; }
      var sv = n(r, 0, 14);
      return [150 + sv, 148 + sv, 152 + sv];
    });
    drawTile(T.RS_ORE, oreTile([228, 60, 46]));
    // 红石粉（物品图标）：小堆粉末
    drawTile(T.RS_DUST, function (x, y, r) {
      var dx = x - 8, dy = y - 10;
      var d2 = dx * dx * 0.5 + dy * dy;
      if (d2 < 34 && y > 4) {
        var hv = n(r, 0, 30);
        return ((x + y) % 2 ? [214 + hv, 52 + hv * 0.4, 28] : [176 + hv, 38 + hv * 0.3, 20]);
      }
      return null;
    });

    // ---- v8：农耕瓦片 ----
    drawTile(T.FARM_TOP, function (x, y, r) {
      if ((x % 4 === 0) && r() < 0.85) { var dv0 = n(r, 0, 12); return [64 + dv0, 48 + dv0, 30 + dv0]; }
      var dv1 = n(r, 0, 20); return [128 + dv1, 92 + dv1, 60 + dv1];
    });
    drawTile(T.FARM_WET_TOP, function (x, y, r) {
      if ((x % 4 === 0) && r() < 0.85) { var wv0 = n(r, 0, 10); return [42 + wv0, 32 + wv0, 22 + wv0]; }
      var wv1 = n(r, 0, 18); return [88 + wv1, 62 + wv1, 38 + wv1];
    });
    drawTile(T.TUFT, function (x, y, r) {
      // 竖直细草叶（cross 渲染透明底）
      var blade = (x % 3 === (y < 8 ? 0 : 1));
      if (!blade || y > 13) return null;
      var gv = n(r, 0, 26);
      return [96 + gv, 158 + gv, 58 + gv];
    });
    function cropPaint(stage, kindCol, withGrain) {
      return function (x, y, r) {
        var h = 4 + stage * 3;         // 生长越高越密
        if (y > 15 - h && x % 2 === (withGrain ? (y % 4 < 2 ? 0 : 1) : 0)) {
          var cv = n(r, 0, 18);
          var matureTip = withGrain && stage >= 3 && y <= 15 - h + 4;
          return matureTip ? kindCol :
            [104 + cv, 150 + cv, 56 + cv];
        }
        return null;
      };
    }
    drawTile(T.WHEAT0, cropPaint(0, null, false));
    drawTile(T.WHEAT1, cropPaint(1, null, false));
    drawTile(T.WHEAT2, cropPaint(2, null, false));
    drawTile(T.WHEAT_MATURE, function (x, y, r) {
      if (x % 2 === 0 && y > 5) {
        return y < 9 ? [222, 178, 84] : [176 + n(r, 0, 16), 148, 70];
      }
      return null;
    });
    drawTile(T.CARROT0, cropPaint(0, null, false));
    drawTile(T.CARROT2, cropPaint(2, null, false));
    drawTile(T.CARROT_MATURE, function (x, y, r) {
      if (x % 2 === 0 && y > 6) return (y < 9) ? [96, 150, 66] : [212 + n(r, 0, 14), 120, 40];
      return null;
    });
    drawTile(T.POTATO0, cropPaint(0, null, false));
    drawTile(T.POTATO2, cropPaint(2, null, false));
    drawTile(T.POTATO_MATURE, function (x, y, r) {
      if (x % 2 === 0 && y > 7) return y < 9 ? [110, 160, 80] : [130 + n(r, 0, 14), 168, 78];
      return null;
    });
    // 食物图标（小物件 painter）
    drawTile(T.I_WHEAT, function (x, y, r) {
      if (Math.abs((x - 8) * 0.35 - (y - 3)) < 1.6 && y > 2)
        return y < 6 ? [232, 196, 100] : [204, 164, 76];
      return null;
    });
    drawTile(T.I_SEEDS, function (x, y, r) {
      var pts = [[5, 8], [9, 6], [11, 11], [7, 12], [10, 9], [6, 10]];
      for (var i = 0; i < pts.length; i++) {
        if (x === pts[i][0] && y === pts[i][1]) return [150 + r() * 24, 140 + r() * 20, 70];
      }
      return null;
    });
    drawTile(T.I_BREAD, function (x, y, r) {
      var dx = x - 8, dy = (y - 9) * 1.7;
      var d2 = dx * dx + dy * dy;
      if (d2 < 40) {
        var crust = d2 > 28;
        var bv = n(r, 0, 14);
        return crust ? [166 + bv, 112 + bv, 54 + bv] : [214 + bv, 168 + bv, 98 + bv];
      }
      return null;
    });
    drawTile(T.I_APPLE, function (x, y, r) {
      var dx = x - 8, dy = y - 9;
      if (dx * dx + dy * dy < 34) return [(206 + n(r, 0, 16)) | 0, 44, 36];
      if (dx * dx + (dy + 1) * (dy + 1) < 34 && x >= 8 && x <= 9 && y >= 3) return [104, 72, 40];
      if (x >= 9 && x <= 11 && y === 4) return [96, 148, 60];
      return null;
    });
    drawTile(T.I_GAPPLE, function (x, y, r) {
      var dx = x - 8, dy = y - 9;
      if (dx * dx + dy * dy < 34) {
        var shine = ((x + y) % 4 === 0);
        return shine ? [255, 238, 170] : [236, 182, 62];
      }
      if (dx * dx + (dy + 1) * (dy + 1) < 34 && x >= 8 && x <= 9 && y >= 3) return [104, 72, 40];
      return null;
    });
    drawTile(T.I_CARROT, function (x, y, r) {
      var vx = (x - 8), vy = (y - 8) * 0.55;
      var along = Math.abs(vx - vy * 0.6) < 2.2 && y > 5 && y < 14;
      if (along) return [224 + n(r, 0, 12), 132, 44];
      if (y >= 3 && y <= 5 && ((x >= 6 && x <= 9))) return [90, 152, 62];
      return null;
    });
    drawTile(T.I_POTATO, function (x, y, r) {
      var dx = x - 8, dy = y - 9;
      if (dx * dx * 0.8 + dy * dy < 26) {
        var pv = n(r, 0, 14);
        return ((x * 7 + y * 3) % 11 === 0) ? [122, 92, 52] : [198 + pv, 172 + pv, 118 + pv];
      }
      return null;
    });
    drawTile(T.I_POTATO_BAKED, function (x, y, r) {
      var dx = x - 8, dy = y - 9;
      if (dx * dx * 0.8 + dy * dy < 26) {
        var pv2 = n(r, 0, 14);
        return ((x * 7 + y * 3) % 9 === 0) ? [156, 96, 44] : [222 + pv2, 162 + pv2, 96 + pv2];
      }
      return null;
    });
    // 锄头图标：柄斜置 + 横刃
    function hoePaint(headCol) {
      return function (x, y, r) {
        var onHandle = Math.abs(x - (y - 2)) < 1.3 && y > 3;
        if (onHandle) return [138 + n(r, 0, 10), 108, 62];
        var headX = x >= 8 && x <= 14, headY = y >= 3 && y <= 4;
        if (headX && headY && !(x > 12 && y > 3)) return headCol;
        return null;
      };
    }
    drawTile(T.HOE_WOOD, hoePaint([166, 134, 82]));
    drawTile(T.HOE_STONE, hoePaint([142, 142, 146]));
    drawTile(T.HOE_IRON, hoePaint([216, 216, 220]));

    // ---- v8：染色体系瓦片（调色板循环批量绘制）----
    // 花×8：茎 + 双瓣花头（色调随 palette）
    var FLOWER_HUES = [5, 7, 12, 0, 15, 6, 11, 13];
    for (var fpi = 0; fpi < 8; fpi++) {
      (function (fi) {
        var pal = DYE_PALETTE[FLOWER_HUES[fi]];
        var c = pal[3];
        drawTile(T.FLOWER0 + fi, function (x, y, r) {
          if (x === 8 && y >= 8 && y <= 14) return [86 + n(r, 0, 10), 140, 54];
          if (x >= 6 && x <= 10 && y <= 9 && ((x - 8) * (x - 8) + (y - 5) * (y - 5)) < 13)
            return fi === 1 || fi === 4 ? [c[0] + n(r, 0, 20), c[1], Math.min(255, c[2] + n(r, 0, 20))]
              : [Math.min(255, c[0] + n(r, 0, 24)), c[1] + n(r, 0, 10), c[2] + n(r, 0, 10)];
          return null;
        });
      })(fpi);
    }
    // 羊毛×15：微噪纤维
    function woolC(pal) {
      var base = pal[3];
      return function (x, y, r) {
        var v = n(r, 0, 14);
        var tuft = ((x * 5 + y * 3) % 7 === 0);
        return [base[0] * 0.92 + v + (tuft ? 10 : 0), base[1] * 0.92 + v + (tuft ? 8 : 0), base[2] * 0.92 + v];
      };
    }
    for (var wti = 1; wti < DYE_PALETTE.length; wti++) drawTile(T.WOOL_C0 + wti - 1, woolC(DYE_PALETTE[wti]));
    // 陶瓦×15：细砂纹
    function terraC(pal) {
      var base = pal[4];
      return function (x, y, r) {
        var v = n(r, 0, 12);
        var grit = r() < 0.06 ? -10 : 0;
        return [base[0] + v + grit, base[1] + v + grit, base[2] + v + grit];
      };
    }
    for (var tti = 1; tti < DYE_PALETTE.length; tti++) drawTile(T.TERRA_C0 + tti - 1, terraC(DYE_PALETTE[tti]));
    // 彩玻璃×13：玻璃质感（高透）
    function glassC(pal) {
      var tint = pal[3];
      return function (x, y, r) {
        if (x === 0 || y === 0 || x === 15 || y === 15) return [tint[0], tint[1], tint[2], 255];
        if (((x - y) % 8 + 8) % 8 < 2) return [255, 255, 255, 110];
        return [tint[0], tint[1], tint[2], 36];
      };
    }
    for (var gti = 1; gti < DYE_PALETTE.length; gti++) {
      if ({0:1,3:1,4:1,9:1,13:1,14:1,5:1,10:1,7:1}[gti]) continue;
      drawTile(T.GLASS_C0 + gti - 1, glassC(DYE_PALETTE[gti]));
    }
    // 染料袋图标 ×16
    for (var ddi = 0; ddi < DYE_PALETTE.length; ddi++) {
      (function (i) {
        var c = DYE_PALETTE[i][2];
        drawTile(T.I_DYE0 + i, function (x, y, r) {
          var dx = x - 8, dy = y - 9;
          if (dx * dx * 0.85 + dy * dy < 30 && y > 5) return [c[0] + n(r, 0, 18), c[1] + n(r, 0, 18), c[2] + n(r, 0, 18)];
          if (y >= 4 && y <= 6 && x >= 6 && x <= 10) return [196, 186, 160];  // 袋口
          return null;
        });
      })(ddi);
    }

    // ---- 北欧城堡瓦片 ----
    // 黑沙：湿润火山沙面 + 云母反光点（青绿环境下呈亮炭色）
    drawTile(T.BLACK_SAND, function (x, y, r) {
      var v = n(r, 0, 14);
      var sheen = r() < 0.06 ? 34 : 0;
      return [86 + v + sheen, 92 + v * 0.95 + sheen, 98 + v * 0.8 + sheen * 1.2];
    });
    // 暗色片麻岩：斜向片理条带
    drawTile(T.GNEISS, function (x, y, r) {
      var band = ((x + y * 2) % 7 < 2);
      var v = band ? n(r, 4, 16) : n(r, 0, 12);
      var light = ((x + y) % 11 === 0) ? 18 : 0;   // 亮矿线
      return [66 + v + light, 70 + v + light, 80 + v];
    });
    // 绯红瓦：叠瓦鳞纹（行错位半片）
    drawTile(T.SHINGLE_RED, function (x, y, r) {
      var row = Math.floor((y + (Math.floor(x / 4) % 2) * 2) / 4);
      var edge = ((y + (Math.floor(x / 4) % 2) * 2) % 4 === 3);
      var v = n(r, 0, 12);
      if (edge) return [96 + v, 40 + v, 34 + v];
      var hi = ((x % 4) === 0 || row % 3 === 0) ? 22 : 0;
      return [156 + v + hi, 62 + v * 0.5 + hi * 0.4, 48 + v * 0.4];
    });
    // 白灰泥墙：暖白抹灰 + 细颗粒
    drawTile(T.PLASTER_WHITE, function (x, y, r) {
      var v = n(r, 0, 10);
      var shade = (y % 8 === 0 || x % 9 === 0) ? 5 : 0;
      return [243 + v - shade, 240 + v - shade, 231 + v - shade];
    });
    // 枯草丛：北欧草簇（十字渲染透明底，枯黄细叶）
    drawTile(T.TUSSOCK_DRY, function (x, y, r) {
      var blade = (x % 4 === 0 && y > 5) || (x % 4 === 2 && y > 8);
      if (!blade || y > 13) return null;
      var tip = y < 8;
      var v = n(r, 0, 22);
      return tip ? [232 + v, 196 + v, 110 + v] : [198 + v, 156 + v, 78 + v];
    });

    ctx.putImageData(img, 0, 0);

    atlasTexture = new THREE.CanvasTexture(atlasCanvas);
    atlasTexture.magFilter = THREE.NearestFilter;
    // 近处保持 Nearest 的像素锐度；mipmap 链在斜视/远距时平滑掉摩尔纹闪烁。
    // 图集是 16px tile × UV 半像素内缩，前几级 mip 不越界；更深的 mip 有轻微
    // 跨 tile 混色，但相比高光噪声可以忽略。anisotropy=8 由 three 在首次上传
    // 时钳制到设备 getMaxAnisotropy()，低端设备自动降级。
    atlasTexture.minFilter = THREE.NearestMipmapLinearFilter;
    atlasTexture.generateMipmaps = true;
    atlasTexture.anisotropy = 8;
  }

  if (typeof document !== 'undefined' && typeof THREE !== 'undefined') buildAtlas();

  // 主动扫描只把自然地质/稀有资源写入档案；普通建筑方块不计数，避免玩家
  // 摆放同一方块刷发现奖励。World.isEdited 会再拒绝被玩家修改过的坐标。
  var SCANNABLE_RESOURCES = [8, 9, 14, 25, 27, 28, 29, 30, 31, 32, 33, 39, 40, 41, 42, 43, 44, 72, 73];
  var scannableResourceSet = Object.create(null);
  for (var sri = 0; sri < SCANNABLE_RESOURCES.length; sri++)
    scannableResourceSet[SCANNABLE_RESOURCES[sri]] = true;

  // 发光方块查找表（火把 14、荧光菌伞 13…）：光照热路径用数组下标替代逐个 defs 查询。
  var LIGHT = new Uint8Array(1024);
  for (var li = 0; li < defs.length; li++) {
    var ld = defs[li];
    if (ld && typeof ld.light === 'number' && ld.light > 0 && ld.light <= 15) LIGHT[li] = ld.light;
  }

  // 镐对可加速方块的倍率（下标=镐等级；金镐用 def.pickMult 单独覆盖）
  var PICK_MULT = [1, 4, 7, 10, 13];

  return {
    defs: defs,
    T: T,
    ATLAS_SIZE: ATLAS_SIZE,
    TILES_PER_ROW: TILES_PER_ROW,
    MAX_STACK: 64,
    ITEM_BASE: 100,
    LIGHT: LIGHT,
    lightOf: function (id) {
      return (id >= 0 && id < 1024) ? LIGHT[id] : 0;
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
    // ---- 门与活板门（v8）----
    DOOR_BASE: DOOR_BASE,
    TRAPDOOR_BASE: TRAPDOOR_BASE,
    DOOR_KIND_COUNT: DOOR_KINDS.length,
    isDoor: function (id) {
      return id >= DOOR_BASE && id < DOOR_BASE + DOOR_KINDS.length * 8 && !!defs[id];
    },
    isTrapdoor: function (id) {
      return id >= TRAPDOOR_BASE && id <= TRAPDOOR_BASE + 2;
    },
    // 某木种的「下半·关闭·axis」基准 ID（物品/掉落形态）
    doorItemId: function (kindIdx) { return DOOR_BASE + kindIdx * 8; },
    doorKindOf: function (id) {
      if (!this.isDoor(id)) return -1;
      return (id - DOOR_BASE >> 3);
    },
    // 配对的另一半：同木种/轴/开合，上下互换；无配对返回 0
    doorPartnerId: function (id) {
      var d = defs[id];
      if (!d || !d.door) return 0;
      var st = (id - DOOR_BASE) & 7;
      var other = d.door.upper ? (st & ~4) : (st | 4);
      return DOOR_BASE + ((id - DOOR_BASE) & ~7) + other;
    },
    // 同一半块的开/关翻转 ID
    doorToggleId: function (id) {
      var d = defs[id];
      if (!d || !d.door) return 0;
      return d.door.open ? (id - 1) : (id + 1);   // bit0=open
    },
    trapdoorToggleId: function (id) {
      var d = defs[id];
      if (!d || !d.trapdoor) return 0;
      if (!d.trapdoor.open) return TRAPDOOR_BASE + 1; // 关→开默认贴 X 边
      var st = id - TRAPDOOR_BASE;
      return st === 1 ? TRAPDOOR_BASE + 2 : TRAPDOOR_BASE + 1; // 开态 X↔Z 往复
    },
    // ---- 红石基础电路（v8）----
    RS: RS,
    isRedstone: function (id) {
      var d = id > 0 && defs[id];
      return !!(d && d.rs);
    },
    rsKindOf: function (id) {
      var d = id > 0 && defs[id];
      return (d && d.rs) || null;
    },
    rsPowered: function (id) {
      var d = id > 0 && defs[id];
      return !!(d && d.powered);
    },
    // 组件通/断两个形态的 ID（导线/火把/拉杆/按钮/压力板/灯/中继器）
    rsSwapId: function (id) {
      if (id >= RS.WIRE_OFF && id <= RS.REP_ON && ((id - RS.WIRE_OFF) & 1) === 0) return id + 1;
      if (id >= RS.WIRE_ON && id <= RS.REP_ON) return id - 1;
      return 0;
    },
    // ---- 染色体系（v8）----
    DYE_PALETTE: DYE_PALETTE,
    dyeIndexOf: function (id) { return (typeof id === 'number' && id >= 260 && id <= 275 && defs[id]) ? defs[id].dyeIndex : -1; },
    // 色号 → 对应变体方块（白色走原版本体；玻璃无对应色返回 0）
    woolOfDye: function (i) { return i === 0 ? 16 : (i > 0 && i < 16 ? 280 + i : 0); },
    terraOfDye: function (i) { return i === 0 ? 27 : (i > 0 && i < 16 ? 300 + i : 0); },
    glassOfDye: function (i) {
      if (i === 5) return 88;
      if (i === 10) return 89;
      if (i === 7) return 90;
      return ({1:321,2:322,6:326,8:328,11:331,12:332,15:335})[i] || 0;
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
    // 镐对可加速方块的倍率（闭包内 PICK_MULT，见上方定义；金镐用 def.pickMult 覆盖）
    PICK_MULT: PICK_MULT,
    pickMultOf: function (heldId) {
      var d = defs[heldId];
      if (!d || d.tool !== 'pick') return PICK_MULT[0];
      if (d.pickMult) return d.pickMult;
      return PICK_MULT[d.tier] || PICK_MULT[0];
    },
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
