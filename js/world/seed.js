// 64 位种子工具：解析 / 随机 / 加盐派生（对齐 Minecraft 种子规则）
// 纯逻辑无 DOM，可在 Node 冒烟测试中加载。
// 种子内部统一表示为无符号 64 位 BigInt；对外展示为带符号十进制串（MC 风格）。
window.Voxel = window.Voxel || {};

Voxel.SeedUtil = (function () {
  var GOLDEN = 0x9E3779B97F4A7C15n; // splitmix64 黄金常数

  // ---- 随机种子：优先 crypto，退化为 Math.random ----
  function random() {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      var a = new Uint32Array(2);
      crypto.getRandomValues(a);
      return (BigInt(a[0]) << 32n) | BigInt(a[1]);
    }
    return (BigInt((Math.random() * 4294967296) >>> 0) << 32n) |
      BigInt((Math.random() * 4294967296) >>> 0);
  }

  // Java String.hashCode：非数字种子的散列方式（MC 同款）
  function javaHashCode(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return h;
  }

  function int32ToBig(h) { return BigInt.asIntN(32, BigInt(h | 0)); }

  // MC 规则：纯数字串按 Java long 解析（超范围视为无效）；其他文本走 hashCode 符号扩展
  function parse(input) {
    if (input === null || input === undefined || input === '') return random();
    var s = String(input).trim();
    if (!s) return random();
    if (/^-?[0-9]{1,19}$/.test(s)) {
      var v = BigInt(s);
      if (v >= -9223372036854775808n && v <= 9223372036854775807n)
        return BigInt.asUintN(64, v);
      // 超出 long 范围：按 MC 行为退化为文本哈希
    }
    return BigInt.asUintN(64, int32ToBig(javaHashCode(s)));
  }

  // 宽容转换：number / 数字串 / BigInt / {hi,lo} / null -> 无符号 64 位
  function toBigInt(seed) {
    if (typeof seed === 'bigint') return BigInt.asUintN(64, seed);
    if (typeof seed === 'string' && seed.length) {
      try { return BigInt.asUintN(64, BigInt(seed)); } catch (e) { }
    }
    if (typeof seed === 'number' && isFinite(seed))
      return BigInt.asUintN(64, BigInt(seed >>> 0));
    if (seed && typeof seed === 'object')
      return BigInt.asUintN(64, (BigInt(seed.hi >>> 0) << 32n) | BigInt(seed.lo >>> 0));
    return random();
  }

  function toString(b) { return BigInt.asIntN(64, toBigInt(b)).toString(10); }

  // ---- splitmix64 混合：盐化派生互不相关的噪声流 ----
  function mix64(z) {
    z = BigInt.asUintN(64, z);
    z = (z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n;
    z = (z ^ (z >> 27n)) * 0x94D049BB133111EBn;
    return BigInt.asUintN(64, z ^ (z >> 31n));
  }

  // 由 (种子, 盐值) 派生单个 uint32（喂给 PRNG）
  function derive32(seedBig, salt) {
    var st = BigInt.asUintN(64, toBigInt(seedBig) ^ mix64(BigInt(salt >>> 0)));
    st = BigInt.asUintN(64, st + GOLDEN);
    return Number(mix64(st) & 0xFFFFFFFFn);
  }

  // 同一盐值流上连续取 count 个 uint32（多 octave 子种子用）
  function deriveStream(seedBig, salt, count) {
    var out = new Array(count);
    var st = BigInt.asUintN(64, toBigInt(seedBig) ^ mix64(BigInt(salt >>> 0)));
    for (var i = 0; i < count; i++) {
      st = BigInt.asUintN(64, st + GOLDEN);
      out[i] = Number(mix64(st) & 0xFFFFFFFFn);
    }
    return out;
  }

  return {
    parse: parse,
    random: random,
    toBigInt: toBigInt,
    toString: toString,
    mix64: mix64,
    derive32: derive32,
    deriveStream: deriveStream
  };
})();
