// 方块定义 + 程序化 16x16 像素纹理图集
window.Voxel = window.Voxel || {};

Voxel.Blocks = (function () {
  var T = {
    GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, LOG_SIDE: 4, LOG_TOP: 5,
    LEAVES: 6, SAND: 7, WATER: 8, COAL: 9, IRON: 10, PLANKS: 11, COBBLE: 12,
    BEDROCK: 13, GLASS: 14, GRAVEL: 15,
    TABLE_TOP: 16, TABLE_SIDE: 17, WOOL: 18, BED_TOP: 19, BED_SIDE: 20,
    SNOW: 21
  };

  var defs = [
    { name: '空气', solid: false, opaque: false, tiles: null, sound: null, color: 0x000000 },
    { name: '草方块', solid: true, opaque: true, tiles: [T.GRASS_TOP, T.GRASS_SIDE, T.GRASS_SIDE], sound: 'dirt', color: 0x6fae4e },
    { name: '泥土', solid: true, opaque: true, tiles: [T.DIRT, T.DIRT, T.DIRT], sound: 'dirt', color: 0x8a6043 },
    { name: '石头', solid: true, opaque: true, tiles: [T.STONE, T.STONE, T.STONE], sound: 'stone', color: 0x7f7f7f },
    { name: '橡木', solid: true, opaque: true, tiles: [T.LOG_TOP, T.LOG_SIDE, T.LOG_TOP], sound: 'wood', color: 0x7a5c38 },
    { name: '树叶', solid: true, opaque: true, tiles: [T.LEAVES, T.LEAVES, T.LEAVES], sound: 'leaves', color: 0x3f8f2f },
    { name: '沙子', solid: true, opaque: true, tiles: [T.SAND, T.SAND, T.SAND], sound: 'sand', color: 0xdacfa3 },
    { name: '水', solid: false, opaque: false, tiles: [T.WATER, T.WATER, T.WATER], sound: 'water', color: 0x3d7dd8 },
    { name: '煤矿石', solid: true, opaque: true, tiles: [T.COAL, T.COAL, T.COAL], sound: 'stone', color: 0x3a3a3a },
    { name: '铁矿石', solid: true, opaque: true, tiles: [T.IRON, T.IRON, T.IRON], sound: 'stone', color: 0xd8af87 },
    { name: '木板', solid: true, opaque: true, tiles: [T.PLANKS, T.PLANKS, T.PLANKS], sound: 'wood', color: 0xa2824e },
    { name: '圆石', solid: true, opaque: true, tiles: [T.COBBLE, T.COBBLE, T.COBBLE], sound: 'stone', color: 0x6f6f6f },
    { name: '基岩', solid: true, opaque: true, tiles: [T.BEDROCK, T.BEDROCK, T.BEDROCK], sound: 'stone', color: 0x3c3c3c },
    { name: '玻璃', solid: true, opaque: false, tiles: [T.GLASS, T.GLASS, T.GLASS], sound: 'glass', color: 0xbfe3ee },
    { name: '沙砾', solid: true, opaque: true, tiles: [T.GRAVEL, T.GRAVEL, T.GRAVEL], sound: 'dirt', color: 0x857f77 },
    { name: '工作台', solid: true, opaque: true, tiles: [T.TABLE_TOP, T.TABLE_SIDE, T.TABLE_SIDE], sound: 'wood', color: 0xb08d57 },
    { name: '羊毛', solid: true, opaque: true, tiles: [T.WOOL, T.WOOL, T.WOOL], sound: 'wool', color: 0xf0f0f0 },
    { name: '床', solid: true, opaque: false, half: true, tiles: [T.BED_TOP, T.BED_SIDE, T.BED_SIDE], sound: 'wood', color: 0xc0504d },
    { name: '雪块', solid: true, opaque: true, tiles: [T.SNOW, T.SNOW, T.SNOW], sound: 'snow', color: 0xeef4f8 }
  ];

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
    isSolid: function (id) { return id > 0 && defs[id].solid; },
    isOpaque: function (id) { return id > 0 && defs[id].opaque; },
    name: function (id) { return defs[id] ? defs[id].name : '?'; },
    tileForFace: function (id, face) {
      var t = defs[id].tiles;
      if (!t) return -1;
      if (face === 2) return t[0]; // 上
      if (face === 3) return t[2]; // 下
      return t[1];                  // 侧
    },
    iconTile: function (id) {
      var d = defs[id];
      if (!d || !d.tiles) return -1;
      if (id === 1) return T.GRASS_SIDE;
      if (id === 15) return T.TABLE_TOP;
      if (id === 17) return T.BED_TOP;
      return d.tiles[1];
    },
    getAtlas: function () { return atlasCanvas; },
    getTexture: function () { return atlasTexture; }
  };
})();
