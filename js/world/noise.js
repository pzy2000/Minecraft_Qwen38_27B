// 值噪声（value noise）+ fBm，带种子
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

  function makePerm(seed) {
    var rnd = mulberry32(seed);
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

  // 2D 哈希 -> [0,1)
  function hash2(p, x, y) {
    var h = (x & 255) + (y & 255) * 256;
    h = p[h & 511] + ((x * 7 + y * 13) & 255);
    return p[h & 511] / 255;
  }

  // 3D 哈希 -> [0,1)
  function hash3(p, x, y, z) {
    var h = (x & 255) + (y & 255) * 256;
    h = p[h & 511] + (z & 255) * 256;
    h = p[h & 511] + ((x * 7 + y * 13 + z * 19) & 255);
    return p[h & 511] / 255;
  }

  function vnoise2(p, x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = fade(xf), v = fade(yf);
    var a = hash2(p, xi, yi), b = hash2(p, xi + 1, yi);
    var c = hash2(p, xi, yi + 1), d = hash2(p, xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  function vnoise3(p, x, y, z) {
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    var xf = x - xi, yf = y - yi, zf = z - zi;
    var u = fade(xf), v = fade(yf), w = fade(zf);
    function h(xx, yy, zz) { return hash3(p, xx, yy, zz); }
    var c000 = h(xi, yi, zi), c100 = h(xi + 1, yi, zi);
    var c010 = h(xi, yi + 1, zi), c110 = h(xi + 1, yi + 1, zi);
    var c001 = h(xi, yi, zi + 1), c101 = h(xi + 1, yi, zi + 1);
    var c011 = h(xi, yi + 1, zi + 1), c111 = h(xi + 1, yi + 1, zi + 1);
    return lerp(
      lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
      lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
      w
    );
  }

  // 分形噪声 [0,1)
  function fbm2(p, x, y, octaves) {
    var sum = 0, amp = 1, freq = 1, norm = 0;
    for (var i = 0; i < octaves; i++) {
      sum += vnoise2(p, x * freq, y * freq) * amp;
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }

  function create(seed) {
    var p = makePerm(seed);
    var p2 = makePerm((seed * 7 + 12345) >>> 0);
    var p3 = makePerm((seed * 13 + 47531) >>> 0);
    var p4 = makePerm((seed * 17 + 81943) >>> 0);
    return {
      n2: function (x, y) { return vnoise2(p, x, y); },
      fbm2: function (x, y, o) { return fbm2(p, x, y, o); },
      fbm2b: function (x, y, o) { return fbm2(p2, x, y, o); },
      // 气候通道：温度 / 湿度（生物群系选择用）
      tempAt: function (x, y, o) { return fbm2(p3, x, y, o || 3); },
      moistAt: function (x, y, o) { return fbm2(p4, x, y, o || 3); },
      n3: function (x, y, z) { return vnoise3(p, x, y, z); },
      hash2: function (x, y) { return hash2(p, x * 7 + 31, y * 13 + 17); },
      hash3: function (x, y, z) { return hash3(p2, x * 7, y * 13, z * 19); }
    };
  }

  return { create: create };
})();
