// 无限宇宙：宇宙种子 → 银河(g) → 恒星系(s) → 行星 的四级确定性派生。
// 纯逻辑模块，无 DOM/THREE 依赖，可直接在 Node 测试中加载。
//
// 地址形如 'g3/s12'；(g=0,s=0) 是「起源恒星系」，其根种子就是宇宙种子本身，
// 逐位复现旧版单星系派生公式，保证既有存档的行星/门户/建筑完全不变。
window.Voxel = window.Voxel || {};

Voxel.Universe = (function () {
  var MAX_INDEX = 1000000000; // g/s 各自的上界（10 亿），防注入与精度问题

  // 银河与恒星系命名音节表（与 Galaxy 的行星音节表相互独立）
  var GAL_A = ['仙女', '车轮', '风车', '涡状', '雪茄', '草帽', '黑眼', '针轮',
    '旋镖', '天琴', '凤凰', '麒麟'];
  var GAL_B = ['银河', '星环', '星海', '星域'];
  var SYS_A = ['阿尔', '泽塔', '奈', '奥尔', '伊克', '卡利', '维斯', '泰拉',
    '诺瓦', '赫利', '塞壬', '奥伯'];
  var SYS_B = ['忒亚', '索恩', '米尔', '珀斯', '瑞斯', '塔恩', '欧拉', '希亚',
    '安', '洛斯', '德里', '翁法'];
  // 恒星光谱分类（近似真实序列的像素化演绎）
  var STAR_CLASSES = [
    { cls: 'O', label: '蓝巨星', color: 0x9db4ff },
    { cls: 'B', label: '蓝白主序星', color: 0xaabfff },
    { cls: 'A', label: '白主序星', color: 0xcad7ff },
    { cls: 'F', label: '黄白矮星', color: 0xf8f7ff },
    { cls: 'G', label: '黄矮星', color: 0xfff4ea },
    { cls: 'K', label: '橙矮星', color: 0xffd2a1 },
    { cls: 'M', label: '红矮星', color: 0xffb28a }
  ];

  function rootString(seed) {
    return Voxel.SeedUtil.toString(Voxel.SeedUtil.parse(seed));
  }

  function plainInt(value) {
    // 无限宇宙：银河/恒星系坐标允许任意方向（±10 亿）。
    return typeof value === 'number' && isFinite(value) &&
      Math.floor(value) === value && Math.abs(value) <= MAX_INDEX
      ? Math.floor(value) : null;
  }

  function addr(g, s) {
    var gi = plainInt(g), si = plainInt(s);
    if (gi === null || si === null) return null;
    return 'g' + gi + '/s' + si;
  }

  function parseAddr(value) {
    if (typeof value !== 'string') return null;
    var m = /^g(-?[0-9]{1,11})\/s(-?[0-9]{1,11})$/.exec(value);
    if (!m) return null;
    var g = Number(m[1]), s = Number(m[2]);
    if (Math.abs(g) > MAX_INDEX || Math.abs(s) > MAX_INDEX) return null;
    return { g: g, s: s };
  }

  function isLegacy(g, s) { return plainInt(g) === 0 && plainInt(s) === 0; }

  // 恒星系专属 64 位根种子（带符号十进制串，与 Galaxy.rootSeed 同构）。
  // 起源系直接返回宇宙根种子 → 旧档行星/门户逐位兼容。
  function systemRoot(universeSeed, g, s) {
    var root = rootString(universeSeed);
    if (isLegacy(g, s)) return root;
    var hi = BigInt(Voxel.SeedUtil.derive32(root, 0xC0DE + (plainInt(g) >>> 0)));
    var lo = BigInt(Voxel.SeedUtil.derive32(root, 0x5EED ^ (plainInt(s) | 1)));
    return Voxel.SeedUtil.toString(BigInt.asIntN(64, (hi << 32n) | lo));
  }

  function galaxyName(universeSeed, g) {
    var root = rootString(universeSeed);
    var gi = plainInt(g); if (gi === null) gi = 0;
    var a = Voxel.SeedUtil.derive32(root, 0xA11 + gi * 3) % GAL_A.length;
    var b = Voxel.SeedUtil.derive32(root, 0xB22 + gi * 7) % GAL_B.length;
    var suffix = ((gi % 26) + 26) % 26;
    return GAL_A[a] + GAL_B[b] + '-' + String.fromCharCode(65 + suffix);
  }

  function starOf(universeSeed, g, s) {
    var root = systemRoot(universeSeed, g, s);
    var idx = Voxel.SeedUtil.derive32(root, 0x57A1) % STAR_CLASSES.length;
    return STAR_CLASSES[idx];
  }

  function systemName(universeSeed, g, s) {
    var root = systemRoot(universeSeed, g, s);
    var a = Voxel.SeedUtil.derive32(root, 0x3301) % SYS_A.length;
    var b = Voxel.SeedUtil.derive32(root, 0x4402) % SYS_B.length;
    var num = 100 + Voxel.SeedUtil.derive32(root, 0x5503) % 900;
    return SYS_A[a] + SYS_B[b] + '-' + num;
  }

  // 恒星系描述符。起源系 (0,0) 固定 6 颗行星、类型顺序与旧版一致，
  // 其余系统行星数 2..6、类型为六类的种子洗牌前缀。
  function describe(universeSeed, g, s) {
    var gi = plainInt(g); if (gi === null) gi = 0;
    var si = plainInt(s); if (si === null) si = 0;
    var legacy = gi === 0 && si === 0;
    var root = systemRoot(universeSeed, gi, si);
    var typeKeys;
    if (legacy) {
      typeKeys = [0, 1, 2, 3, 4, 5];
    } else {
      typeKeys = [0, 1, 2, 3, 4, 5];
      for (var i = typeKeys.length - 1; i > 0; i--) {
        var j = Voxel.SeedUtil.derive32(root, (0xD170 + i * 11) >>> 0) % (i + 1);
        var tmp = typeKeys[i]; typeKeys[i] = typeKeys[j]; typeKeys[j] = tmp;
      }
      var count = 2 + Voxel.SeedUtil.derive32(root, 0xC0A7) % 5;
      typeKeys = typeKeys.slice(0, count);
    }
    return {
      addr: addr(gi, si),
      g: gi,
      s: si,
      legacy: legacy,
      root: root,
      name: legacy ? '阿特拉斯之环' : systemName(universeSeed, gi, si),
      galaxyName: galaxyName(universeSeed, gi),
      star: starOf(universeSeed, gi, si),
      planetCount: typeKeys.length,
      typeKeys: typeKeys
    };
  }

  // 跨恒星系跃迁的曲速电池成本：按 (g,s) 平面距离计算。
  function jumpCells(a, b) {
    if (!a || !b || plainInt(a.g) === null || plainInt(a.s) === null ||
      plainInt(b.g) === null || plainInt(b.s) === null) return Infinity;
    var dist = Math.sqrt((a.g - b.g) * (a.g - b.g) + (a.s - b.s) * (a.s - b.s));
    var cfg = Voxel.Config && Voxel.Config.UNIVERSE ? Voxel.Config.UNIVERSE : {};
    var per = typeof cfg.JUMP_CELLS_PER_DIST === 'number' ? cfg.JUMP_CELLS_PER_DIST : 0.5;
    var min = cfg.JUMP_CELLS_MIN || 1;
    var max = cfg.JUMP_CELLS_MAX || 24;
    var cells = Math.ceil(dist * per);
    if (!isFinite(cells)) return Infinity;
    return Math.max(min, Math.min(max, cells));
  }

  return {
    MAX_INDEX: MAX_INDEX,
    STAR_CLASSES: STAR_CLASSES,
    addr: addr,
    parseAddr: parseAddr,
    isLegacy: isLegacy,
    rootString: rootString,
    systemRoot: systemRoot,
    galaxyName: galaxyName,
    starOf: starOf,
    systemName: systemName,
    describe: describe,
    jumpCells: jumpCells
  };
})();
