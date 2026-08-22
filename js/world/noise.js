// Improved Perlin 梯度噪声 + Octave 叠加，经 SeedUtil 盐化播种（对齐 Minecraft PerlinNoiseSampler）
// 纯逻辑无 DOM，可在 Node 冒烟测试中加载
window.Voxel = window.Voxel || {};

Voxel.Noise = (function () {
  function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makePerm(rnd) {
    var p = new Uint8Array(512);
    var base = new Uint8Array(256);
    for (var i = 0; i < 256; i++) base[i] = i;
    for (var i2 = 255; i2 > 0; i2--) {
      var j = (rnd() * (i2 + 1)) | 0;
      var t = base[i2]; base[i2] = base[j]; base[j] = t;
    }
    for (var k = 0; k < 512; k++) p[k] = base[k & 255];
    return p;
  }

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // 12 向梯度集（Perlin 参考实现的位运算选择）
  function grad(h, x, y, z) {
    h &= 15;
    var u = h < 8 ? x : y;
    var v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  // 单层 Improved Perlin，输出约 [-1,1]
  function perlin3(p, x, y, z) {
    var fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    var X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    var u = fade(x), v = fade(y), w = fade(z);
    var A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    var Bk = p[X + 1] + Y, BA = p[Bk] + Z, BB = p[Bk + 1] + Z;
    return lerp(
      lerp(lerp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u),
        lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w);
  }

  // OctavePerlin：每层独立置换表与偏移（去相关，对应 MC OctavePerlinNoiseSampler）
  function makeOctaves(streamVals, n) {
    var layers = [], norm = 0, amp = 1;
    for (var i = 0; i < n; i++) {
      var r = mulberry32(streamVals[i]);
      layers.push({
        p: makePerm(r),
        ox: r() * 1024, oy: r() * 1024, oz: r() * 1024,
        freq: Math.pow(2, i), amp: amp
      });
      norm += amp; amp *= 0.5;
    }
    return {
      at3: function (x, y, z) {
        var s = 0;
        for (var i = 0; i < layers.length; i++) {
          var L = layers[i];
          s += perlin3(L.p, (x + L.ox) * L.freq, (y + L.oy) * L.freq, (z + L.oz) * L.freq) * L.amp;
        }
        return s / norm;
      },
      at2: function (x, z) {
        var s = 0;
        for (var i = 0; i < layers.length; i++) {
          var L = layers[i];
          s += perlin3(L.p, (x + L.ox) * L.freq, L.oy * 0.618 + 37.7, (z + L.oz) * L.freq) * L.amp;
        }
        return s / norm;
      }
    };
  }

  // 盐值常量表：各噪声实例专属（模仿 MC noise router 的独立 salt）
  var SALT = {
    TEMP: 0x51ED, HUMID: 0x270B, CONT: 0x1B31, EROSION: 0x7A11, WEIRD: 0x3C4F,
    TERRAIN: 0xA11CE, TERRAIN3D: 0xB0B57, JAGGED: 0xC0FFEE,
    CAVE_A: 0xD00DAD, CAVE_B: 0xE66E55, CHEESE: 0xF00D5,
    ORE: 0x0DD5A, TREE: 0x7EE5, LEGACY: 0x1999
  };

  function create(seed) {
    var S = Voxel.SeedUtil;
    var big = S.toBigInt(seed);
    var cache = {};

    // 取盐化噪声通道（[-1,1]），按 (盐值, octave 数) 缓存
    function channel(salt, oct) {
      var key = salt + ':' + oct;
      if (!cache[key]) cache[key] = makeOctaves(S.deriveStream(big, salt, oct), oct);
      return cache[key];
    }

    // 整数坐标哈希 [0,1)：盐化常量混入，矿石/植被放置用
    var hk = S.deriveStream(big, SALT.ORE, 3);
    function hash2(x, y) {
      var h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ hk[0]) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    function hash3(x, y, z) {
      var h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 2246822519) ^
        Math.imul(z | 0, 3266489917) ^ hk[1]) | 0;
      h = Math.imul(h ^ (h >>> 15), 2654435761);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    // 兼容旧 API：值噪声风格输出 [0,1)
    var legacy = channel(SALT.LEGACY, 3);
    function clamp01(v) { return v < 0 ? 0 : (v >= 1 ? 0.999999 : v); }

    return {
      channel: channel,
      hash2: hash2,
      hash3: hash3,
      fbm2: function (x, y, o) { return clamp01((legacy.at2(x, y) + 1) / 2); },
      n3: function (x, y, z) { return clamp01((legacy.at3(x, y, z) + 1) / 2); },
      tempAt: function (x, y) { return clamp01((channel(SALT.TEMP, 3).at2(x, y) + 1) / 2); },
      moistAt: function (x, y) { return clamp01((channel(SALT.HUMID, 3).at2(x, y) + 1) / 2); }
    };
  }

  return { create: create, SALT: SALT, perlin3: perlin3, makePerm: makePerm, mulberry32: mulberry32 };
})();
