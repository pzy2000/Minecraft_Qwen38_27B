// 方块定义 + 程序化 16x16 像素纹理图集
window.Voxel = window.Voxel || {};

Voxel.Blocks = (function () {
  var T = {
    GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, LOG_SIDE: 4, LOG_TOP: 5,
    LEAVES: 6, SAND: 7, WATER: 8, COAL: 9, IRON: 10, PLANKS: 11, COBBLE: 12,
    BEDROCK: 13, GLASS: 14, GRAVEL: 15,
    TABLE_TOP: 16, TABLE_SIDE: 17, WOOL: 18, BED_TOP: 19, BED_SIDE: 20,
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
    BIRCH_LOG_SIDE: 51, BIRCH_LOG_TOP: 52, BIRCH_LEAVES: 53
  };

  // hard: 徒手挖掘秒数（Infinity=不可破坏）；pick: 镐可加速；tier: 需要的最低镐等级(1木2石3铁)
  var defs = [
    { name: '空气', solid: false, opaque: false, tiles: null, sound: null, color: 0x000000 },
    { name: '草方块', solid: true, opaque: true, tiles: [T.GRASS_TOP, T.GRASS_SIDE, T.GRASS_SIDE], sound: 'dirt', color: 0x6fae4e, hard: 0.75 },
    { name: '泥土', solid: true, opaque: true, tiles: [T.DIRT, T.DIRT, T.DIRT], sound: 'dirt', color: 0x8a6043, hard: 0.65 },
    { name: '石头', solid: true, opaque: true, tiles: [T.STONE, T.STONE, T.STONE], sound: 'stone', color: 0x7f7f7f, hard: 4, pick: true },
    { name: '橡木', solid: true, opaque: true, tiles: [T.LOG_TOP, T.LOG_SIDE, T.LOG_TOP], sound: 'wood', color: 0x7a5c38, hard: 1.6 },
    { name: '树叶', solid: true, opaque: true, tiles: [T.LEAVES, T.LEAVES, T.LEAVES], sound: 'leaves', color: 0x3f8f2f, hard: 0.35 },
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
    { name: '床', solid: true, opaque: false, half: true, tiles: [T.BED_TOP, T.BED_SIDE, T.BED_SIDE], sound: 'wood', color: 0xc0504d, hard: 0.8 },
    { name: '雪块', solid: true, opaque: true, tiles: [T.SNOW, T.SNOW, T.SNOW], sound: 'snow', color: 0xeef4f8, hard: 0.35 },
    { name: '火把', solid: false, opaque: false, cross: true, light: 14,
      tiles: [T.TORCH, T.TORCH, T.TORCH], sound: 'wood', color: 0xffcc66, hard: 0.05, icon: T.TORCH },
    { name: '云杉木', solid: true, opaque: true, tiles: [T.SPRUCE_LOG_TOP, T.SPRUCE_LOG_SIDE, T.SPRUCE_LOG_TOP], sound: 'wood', color: 0x5a4428, hard: 1.6 },
    { name: '云杉树叶', solid: true, opaque: true, tiles: [T.SPRUCE_LEAVES, T.SPRUCE_LEAVES, T.SPRUCE_LEAVES], sound: 'leaves', color: 0x2e6154, hard: 0.35 },
    { name: '丛林木', solid: true, opaque: true, tiles: [T.JUNGLE_LOG_TOP, T.JUNGLE_LOG_SIDE, T.JUNGLE_LOG_TOP], sound: 'wood', color: 0x8a6b3c, hard: 1.6 },
    { name: '丛林树叶', solid: true, opaque: true, tiles: [T.JUNGLE_LEAVES, T.JUNGLE_LEAVES, T.JUNGLE_LEAVES], sound: 'leaves', color: 0x3da02f, hard: 0.35 },
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
    { name: '白桦树叶', solid: true, opaque: true, tiles: [T.BIRCH_LEAVES, T.BIRCH_LEAVES, T.BIRCH_LEAVES], sound: 'leaves', color: 0x74a644, hard: 0.35 },
    { name: '金合欢木', solid: true, opaque: true, tiles: [T.ACACIA_LOG_TOP, T.ACACIA_LOG_SIDE, T.ACACIA_LOG_TOP], sound: 'wood', color: 0x9a5b38, hard: 1.6 },
    { name: '金合欢树叶', solid: true, opaque: true, tiles: [T.ACACIA_LEAVES, T.ACACIA_LEAVES, T.ACACIA_LEAVES], sound: 'leaves', color: 0x5f9426, hard: 0.35 }
  ];

  // 物品（item:true 不可放置）：ID 固定 100+，工具/材料
  defs[100] = { name: '木棍', item: true, solid: false, opaque: false, tiles: [T.STICK, T.STICK, T.STICK], sound: 'wood', color: 0x9a764a, icon: T.STICK };
    defs[101] = { name: '木镐', item: true, solid: false, opaque: false, tiles: [T.PICK_WOOD, T.PICK_WOOD, T.PICK_WOOD], sound: 'wood', color: 0x9a764a, tool: 'pick', tier: 1, dmg: 2, icon: T.PICK_WOOD };
    defs[102] = { name: '石镐', item: true, solid: false, opaque: false, tiles: [T.PICK_STONE, T.PICK_STONE, T.PICK_STONE], sound: 'stone', color: 0x8f8f92, tool: 'pick', tier: 2, dmg: 3, icon: T.PICK_STONE };
    defs[103] = { name: '铁镐', item: true, solid: false, opaque: false, tiles: [T.PICK_IRON, T.PICK_IRON, T.PICK_IRON], sound: 'stone', color: 0xd8af87, tool: 'pick', tier: 3, dmg: 4, icon: T.PICK_IRON };
    defs[104] = { name: '木剑', item: true, solid: false, opaque: false, tiles: [T.SWORD_WOOD, T.SWORD_WOOD, T.SWORD_WOOD], sound: 'wood', color: 0x9a764a, tool: 'sword', dmg: 4, icon: T.SWORD_WOOD };
    defs[105] = { name: '石剑', item: true, solid: false, opaque: false, tiles: [T.SWORD_STONE, T.SWORD_STONE, T.SWORD_STONE], sound: 'stone', color: 0x8f8f92, tool: 'sword', dmg: 5, icon: T.SWORD_STONE };
    defs[106] = { name: '铁剑', item: true, solid: false, opaque: false, tiles: [T.SWORD_IRON, T.SWORD_IRON, T.SWORD_IRON], sound: 'stone', color: 0xd8af87, tool: 'sword', dmg: 6, icon: T.SWORD_IRON };
    defs[107] = { name: '煤炭', item: true, solid: false, opaque: false, tiles: [T.COAL, T.COAL, T.COAL], sound: 'stone', color: 0x3a3a3a, icon: T.COAL };

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

    ctx.putImageData(img, 0, 0);

    atlasTexture = new THREE.CanvasTexture(atlasCanvas);
    atlasTexture.magFilter = THREE.NearestFilter;
    atlasTexture.minFilter = THREE.NearestFilter;
    atlasTexture.generateMipmaps = false;
  }

  if (typeof document !== 'undefined' && typeof THREE !== 'undefined') buildAtlas();

  return {
    defs: defs,
    T: T,
    MAX_STACK: 64,
    ITEM_BASE: 100,
    isSolid: function (id) { return id > 0 && !!defs[id] && !!defs[id].solid; },
    isOpaque: function (id) { return id > 0 && !!defs[id] && !!defs[id].opaque; },
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
