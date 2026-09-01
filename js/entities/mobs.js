// 生物：羊（游走）+ 僵尸（夜晚追击）
window.Voxel = window.Voxel || {};

Voxel.Mobs = (function () {
  var C = Voxel.Config.MOB;
  var P = Voxel.Config.PLAYER;
  var H = Voxel.Config.WORLD_H;
  var list = [];
  var group = null;
  var spawnTimer = 1;

  // ---- 合批：合并几何缓存 + 共享材质 ----
  // 每只生物 = 1 个 Mesh（逐顶点色）→ 1 次绘制；几何按「类型×配色变体」全局缓存。
  var sharedMat = null;   // 常态：顶点色 × 昼夜 tint（每帧一次 uniform 更新）
  var flashMat = null;    // 受击闪白：纯白
  var geoCache = {};      // "type_variant" -> BufferGeometry

  function ensureSharedMats() {
    if (sharedMat) return;
    sharedMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  }

  function partGeo(w, h, d, x, y, z, colorHex) {
    var g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    var c = new THREE.Color(colorHex);
    var n = g.attributes.position.count;
    var arr = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  }

  function mergeGeos(geos) {
    var vTotal = 0, iTotal = 0, j, k;
    for (j = 0; j < geos.length; j++) {
      vTotal += geos[j].attributes.position.count;
      iTotal += geos[j].index.count;
    }
    var pos = new Float32Array(vTotal * 3);
    var col = new Float32Array(vTotal * 3);
    var idx = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);
    var vo = 0, io = 0;
    for (j = 0; j < geos.length; j++) {
      var g = geos[j];
      pos.set(g.attributes.position.array, vo * 3);
      col.set(g.attributes.color.array, vo * 3);
      var gi = g.index.array;
      for (k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
      io += gi.length;
      vo += g.attributes.position.count;
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }

  function getGeo(key, parts) {
    ensureSharedMats();
    if (!geoCache[key]) {
      var gs = [];
      for (var i = 0; i < parts.length; i++)
        gs.push(partGeo(parts[i][0], parts[i][1], parts[i][2],
          parts[i][3], parts[i][4], parts[i][5], parts[i][6]));
      geoCache[key] = mergeGeos(gs);
    }
    return geoCache[key];
  }

  // 各类型部件定义：[w,h,d,x,y,z,color]；variant 用于几何缓存键（羊 4 色毛/兔 3 色）
  function sheepBuild() {
    var vi = (Math.random() * 4) | 0;
    var wool = [0xffffff, 0xb0b0b0, 0x5a5a5a, 0x9a7248][vi];
    var skin = 0xe8c8a8;
    return { variant: String(vi), w: 0.8, h: 1.15, mainColor: wool, parts: [
      [0.80, 0.55, 1.10, 0, 0.62, -0.05, wool],
      [0.45, 0.42, 0.45, 0, 0.95, 0.62, skin],
      [0.14, 0.16, 0.10, 0, 0.88, 0.86, skin],
      [0.16, 0.38, 0.16, -0.25, 0.19, 0.38, wool],
      [0.16, 0.38, 0.16, 0.25, 0.19, 0.38, wool],
      [0.16, 0.38, 0.16, -0.25, 0.19, -0.42, wool],
      [0.16, 0.38, 0.16, 0.25, 0.19, -0.42, wool]
    ] };
  }
  function pigBuild() {
    var body = 0xf0a0a0, skin = 0xe08888;
    return { variant: '', w: 0.8, h: 1.0, mainColor: body, parts: [
      [0.85, 0.55, 1.15, 0, 0.58, -0.05, body],
      [0.55, 0.50, 0.45, 0, 0.72, 0.68, skin],
      [0.24, 0.16, 0.08, 0, 0.66, 0.94, skin],
      [0.18, 0.32, 0.18, -0.26, 0.16, 0.38, skin],
      [0.18, 0.32, 0.18, 0.26, 0.16, 0.38, skin],
      [0.18, 0.32, 0.18, -0.26, 0.16, -0.44, skin],
      [0.18, 0.32, 0.18, 0.26, 0.16, -0.44, skin]
    ] };
  }
  function chickenBuild() {
    var body = 0xf2f2f2, beak = 0xe8b23a, wattle = 0xc03a3a;
    return { variant: '', w: 0.45, h: 1.05, mainColor: body, parts: [
      [0.45, 0.45, 0.62, 0, 0.52, -0.05, body],
      [0.28, 0.36, 0.26, 0, 0.92, 0.28, body],
      [0.14, 0.09, 0.12, 0, 0.90, 0.46, beak],
      [0.10, 0.12, 0.06, 0, 0.76, 0.42, wattle],
      [0.08, 0.30, 0.40, -0.27, 0.56, 0, body],
      [0.08, 0.30, 0.40, 0.27, 0.56, 0, body],
      [0.07, 0.30, 0.07, -0.10, 0.15, 0, beak],
      [0.07, 0.30, 0.07, 0.10, 0.15, 0, beak]
    ] };
  }
  function rabbitBuild() {
    var fi = (Math.random() * 3) | 0;
    var fur = [0x9a7a52, 0xbfa07a, 0xd8d2c8][fi];
    var dark = 0x6e563a;
    return { variant: String(fi), w: 0.4, h: 0.95, mainColor: fur, parts: [
      [0.38, 0.34, 0.58, 0, 0.30, -0.05, fur],
      [0.28, 0.28, 0.28, 0, 0.52, 0.32, fur],
      [0.08, 0.30, 0.06, -0.09, 0.82, 0.30, dark],
      [0.08, 0.30, 0.06, 0.09, 0.82, 0.30, dark],
      [0.12, 0.12, 0.08, 0, 0.34, -0.36, 0xffffff],
      [0.10, 0.16, 0.10, -0.13, 0.08, 0.22, fur],
      [0.10, 0.16, 0.10, 0.13, 0.08, 0.22, fur]
    ] };
  }
  function zombieBuild() {
    var skin = 0x5a9a50, shirt = 0x3f6e8c, pants = 0x4a4a6e;
    return { variant: '', w: 0.6, h: 1.8, mainColor: skin, parts: [
      [0.42, 0.42, 0.42, 0, 1.55, 0, skin],
      [0.44, 0.62, 0.26, 0, 1.02, 0, shirt],
      [0.14, 0.55, 0.14, -0.32, 1.05, 0.30, skin],
      [0.14, 0.55, 0.14, 0.32, 1.05, 0.30, skin],
      [0.16, 0.55, 0.16, -0.11, 0.28, 0, pants],
      [0.16, 0.55, 0.16, 0.11, 0.28, 0, pants]
    ] };
  }
  // 骷髅弓手：骨白细长身形 + 弓臂前伸；保持中距离射箭，白天曝晒燃烧
  function archerBuild() {
    var bone = 0xd8d4c4, rib = 0xbdb8a5;
    return { variant: '', w: 0.55, h: 1.75, mainColor: bone, parts: [
      [0.40, 0.40, 0.40, 0, 1.52, 0, bone],          // 头
      [0.34, 0.58, 0.22, 0, 1.02, 0, rib],           // 肋骨架（细于僵尸躯干）
      [0.12, 0.52, 0.12, -0.30, 1.05, 0.24, bone],   // 左臂
      [0.12, 0.10, 0.72, 0.30, 1.16, 0.36, 0x6e5636],// 右臂横托弓
      [0.07, 0.62, 0.07, 0.30, 1.18, 0.72, 0xe8dcc0],// 竖弦
      [0.15, 0.52, 0.15, -0.10, 0.27, 0, bone],      // 腿 ×2
      [0.15, 0.52, 0.15, 0.10, 0.27, 0, bone]
    ] };
  }
  // 自爆虫：圆润深绿节肢体 + 苦绿色警示斑；贴近点燃引信后膨胀自爆
  function boomerBuild() {
    var body = 0x63a83c, blotch = 0x3f7d2a, belly = 0x8cc763;
    return { variant: '', w: 0.7, h: 1.0, mainColor: body, parts: [
      [0.66, 0.60, 0.78, 0, 0.48, -0.02, body],
      [0.20, 0.16, 0.12, -0.14, 0.62, 0.36, 0x101010], // 双眼
      [0.20, 0.16, 0.12, 0.14, 0.62, 0.36, 0x101010],
      [0.30, 0.18, 0.16, 0, 0.38, 0.38, belly],        // 嘴部浅色
      [0.46, 0.10, 0.10, 0, 0.74, -0.06, blotch],      // 背部警示斑 ×2
      [0.10, 0.10, 0.10, 0, 0.78, -0.14, blotch],
      [0.14, 0.34, 0.14, -0.22, 0.17, 0.24, blotch],   // 四短足
      [0.14, 0.34, 0.14, 0.22, 0.17, 0.24, blotch],
      [0.14, 0.34, 0.14, -0.22, 0.17, -0.28, blotch],
      [0.14, 0.34, 0.14, 0.22, 0.17, -0.28, blotch]
    ] };
  }
  // 狼：灰褐捕食者，立耳粗尾；驯服后系红色项圈（variant 'collar' 复用几何缓存）
  function wolfBuild(collar) {
    var fur = 0x8a8074, dark = 0x6b625a;
    var parts = [
      [0.44, 0.42, 0.72, 0, 0.52, -0.02, fur],        // 躯干
      [0.32, 0.30, 0.30, 0, 0.62, 0.46, fur],         // 头
      [0.26, 0.20, 0.18, 0, 0.54, 0.64, 0x9a9288],    // 口鼻
      [0.07, 0.08, 0.04, 0, 0.56, 0.78, 0x181818],    // 鼻
      [0.09, 0.11, 0.05, -0.10, 0.82, 0.44, dark],    // 立耳
      [0.09, 0.11, 0.05, 0.10, 0.82, 0.44, dark],
      [0.10, 0.10, 0.06, -0.11, 0.66, 0.55, 0xf2d84e],// 黄眼
      [0.10, 0.10, 0.06, 0.11, 0.66, 0.55, 0xf2d84e],
      [0.12, 0.34, 0.12, -0.15, 0.15, 0.22, dark],    // 四腿
      [0.12, 0.34, 0.12, 0.15, 0.15, 0.22, dark],
      [0.12, 0.34, 0.12, -0.15, 0.15, -0.24, dark],
      [0.12, 0.34, 0.12, 0.15, 0.15, -0.24, dark],
      [0.10, 0.10, 0.30, 0, 0.58, -0.40, fur],        // 尾根
      [0.08, 0.08, 0.24, 0, 0.66, -0.60, dark]        // 尾梢上翘
    ];
    var key = collar ? '_c' : '';
    if (collar) parts.push([0.36, 0.09, 0.36, 0, 0.48, 0.38, 0xc03a3a]); // 红项圈
    return { variant: key, w: 0.55, h: 0.95, mainColor: fur, parts: parts };
  }
  // 村民：长袍商队旅人，头部尖鼻、双臂拢袖；袍色按变体轮换
  function villagerBuild(vi) {
    var robes = [
      { r: 0x7a5c38, trim: 0xa8865a },   // 驼色商队
      { r: 0x4a6e5c, trim: 0x86b89a }    // 苔绿药草师
    ];
    var v = robes[Math.abs((vi | 0) % robes.length)];
    return { variant: String(Math.abs((vi | 0) % robes.length)), w: 0.55, h: 1.85,
      mainColor: v.r, parts: [
      [0.46, 0.46, 0.46, 0, 1.58, 0, 0xd8b088],          // 头
      [0.10, 0.10, 0.14, 0, 1.50, 0.24, 0xb08858],       // 尖鼻
      [0.50, 0.70, 0.30, 0, 1.02, 0, v.r],               // 上袍身
      [0.60, 0.62, 0.42, 0, 0.45, 0, v.r],               // 下摆
      [0.06, 0.05, 0.05, -0.12, 1.63, 0.235, 0x30302c],  // 双眼
      [0.06, 0.05, 0.05, 0.12, 1.63, 0.235, 0x30302c],
      [0.56, 0.10, 0.34, 0, 1.35, 0.02, v.trim],         // 腰带/领饰
      [0.14, 0.52, 0.16, -0.33, 1.00, 0.02, v.r],        // 拢袖双臂
      [0.14, 0.52, 0.16, 0.33, 1.00, 0.02, v.r]
    ] };
  }
  // 猫：纤细身形 + 立耳/圆眼/粉鼻/上翘双段尾；4 种花色（橘猫带背纹、玄猫白尾尖、白猫、重点色布偶）
  // voice 为各品种专属叫声（cat_0~3），size 控制品种体型缩放
  var CAT_VARIANTS = [
    { fur: 0xd98e4a, accent: 0xb96f2e, muzzle: 0xe8b87d, eye: 0x6fae4e, legs: 0xc9833f, tailTip: 0xb96f2e, striped: true,  voice: 0, size: 1.10 }, // 橘猫
    { fur: 0x37322f, accent: 0x2a2523, muzzle: 0x45403c, eye: 0xd9a53a, legs: 0x2e2a28, tailTip: 0xe8e4dc, striped: false, voice: 1, size: 0.95 }, // 玄猫
    { fur: 0xf3efe7, accent: 0xe3cdc5, muzzle: 0xffffff, eye: 0x5a8fd0, legs: 0xeae5db, tailTip: 0xf3efe7, striped: false, voice: 2, size: 0.85 }, // 白猫
    { fur: 0xcfc4b6, accent: 0x6e5d4f, muzzle: 0xdfd6ca, eye: 0x4a9ad8, legs: 0x6e5d4f, tailTip: 0x6e5d4f, striped: false, voice: 3, size: 1.15 }  // 布偶猫
  ];
  function catBuild() {
    var vi = (Math.random() * CAT_VARIANTS.length) | 0;
    var v = CAT_VARIANTS[vi];
    var s = v.size;
    var parts = [
      [0.40, 0.32, 0.68, 0, 0.34, -0.04, v.fur],        // 躯干
      [0.30, 0.26, 0.26, 0, 0.56, 0.38, v.fur],         // 头
      [0.14, 0.10, 0.07, 0, 0.50, 0.525, v.muzzle],     // 吻部
      [0.06, 0.045, 0.03, 0, 0.535, 0.565, 0xd98a8a],   // 鼻
      [0.08, 0.09, 0.05, -0.10, 0.72, 0.36, v.accent],  // 左耳
      [0.08, 0.09, 0.05, 0.10, 0.72, 0.36, v.accent],   // 右耳
      [0.05, 0.06, 0.02, -0.085, 0.585, 0.512, v.eye],  // 左眼
      [0.05, 0.06, 0.02, 0.085, 0.585, 0.512, v.eye],   // 右眼
      [0.09, 0.24, 0.09, -0.13, 0.12, 0.20, v.legs],    // 前左腿
      [0.09, 0.24, 0.09, 0.13, 0.12, 0.20, v.legs],     // 前右腿
      [0.09, 0.24, 0.09, -0.13, 0.12, -0.28, v.legs],   // 后左腿
      [0.09, 0.24, 0.09, 0.13, 0.12, -0.28, v.legs],    // 后右腿
      [0.09, 0.09, 0.22, 0, 0.40, -0.42, v.fur],        // 尾根（上翘）
      [0.08, 0.18, 0.08, 0, 0.55, -0.47, v.tailTip]     // 尾尖
    ].map(function (p) {
      return [p[0] * s, p[1] * s, p[2] * s, p[3] * s, p[4] * s, p[5] * s, p[6]];
    });
    if (v.striped) {
      parts.push([0.30 * s, 0.05 * s, 0.09 * s, 0, 0.49 * s, -0.18 * s, v.accent]);  // 背纹 ×3
      parts.push([0.30 * s, 0.05 * s, 0.09 * s, 0, 0.49 * s, 0.00 * s, v.accent]);
      parts.push([0.26 * s, 0.05 * s, 0.09 * s, 0, 0.49 * s, 0.18 * s, v.accent]);
    }
    return { variant: String(vi), voice: v.voice, w: 0.5 * s, h: 0.75 * s, mainColor: v.fur, parts: parts };
  }

  function sandStalkerBuild() {
    var bone = 0xc9b48a, wrap = 0x8a6a3c;
    return { variant: '', w: 0.5, h: 1.7, mainColor: bone, parts: [
      [0.36, 0.38, 0.36, 0, 1.48, 0, bone],
      [0.30, 0.56, 0.20, 0, 1.00, 0, wrap],
      [0.10, 0.50, 0.10, -0.28, 1.02, 0.20, bone],
      [0.10, 0.08, 0.68, 0.28, 1.12, 0.34, 0x6e5636],
      [0.13, 0.50, 0.13, -0.09, 0.26, 0, wrap],
      [0.13, 0.50, 0.13, 0.09, 0.26, 0, wrap]
    ] };
  }
  function duneScorpionBuild() {
    var car = 0xb86a2a, claw = 0x8a4a18, stinger = 0x3a2010;
    return { variant: '', w: 0.85, h: 0.85, mainColor: car, parts: [
      [0.70, 0.28, 0.90, 0, 0.38, -0.04, car],
      [0.28, 0.22, 0.28, 0, 0.42, 0.52, car],
      [0.22, 0.10, 0.34, -0.42, 0.36, 0.40, claw],
      [0.22, 0.10, 0.34, 0.42, 0.36, 0.40, claw],
      [0.10, 0.10, 0.36, 0, 0.52, -0.52, stinger],
      [0.12, 0.22, 0.12, -0.22, 0.12, 0.22, claw],
      [0.12, 0.22, 0.12, 0.22, 0.12, 0.22, claw],
      [0.12, 0.22, 0.12, -0.22, 0.12, -0.28, claw],
      [0.12, 0.22, 0.12, 0.22, 0.12, -0.28, claw]
    ] };
  }
  function tintedWolfBuild(collar, fur, dark, eye, collarHex, variant) {
    var parts = [
      [0.44, 0.42, 0.72, 0, 0.52, -0.02, fur],
      [0.32, 0.30, 0.30, 0, 0.62, 0.46, fur],
      [0.26, 0.20, 0.18, 0, 0.54, 0.64, dark],
      [0.07, 0.08, 0.04, 0, 0.56, 0.78, 0x181818],
      [0.09, 0.11, 0.05, -0.10, 0.82, 0.44, dark],
      [0.09, 0.11, 0.05, 0.10, 0.82, 0.44, dark],
      [0.10, 0.10, 0.06, -0.11, 0.66, 0.55, eye],
      [0.10, 0.10, 0.06, 0.11, 0.66, 0.55, eye],
      [0.12, 0.34, 0.12, -0.15, 0.15, 0.22, dark],
      [0.12, 0.34, 0.12, 0.15, 0.15, 0.22, dark],
      [0.12, 0.34, 0.12, -0.15, 0.15, -0.24, dark],
      [0.12, 0.34, 0.12, 0.15, 0.15, -0.24, dark],
      [0.10, 0.10, 0.30, 0, 0.58, -0.40, fur],
      [0.08, 0.08, 0.24, 0, 0.66, -0.60, dark]
    ];
    if (collar) parts.push([0.36, 0.09, 0.36, 0, 0.48, 0.38, collarHex]);
    return { variant: collar ? (variant + '_c') : variant, w: 0.55, h: 0.95, mainColor: fur, parts: parts };
  }
  function frostWolfBuild(collar) {
    return tintedWolfBuild(collar, 0xd8e4ee, 0x8aa0b0, 0x7ec8ff, 0x3a6ea8, '');
  }
  function fjordWolfBuild(collar) {
    return tintedWolfBuild(collar, 0x4a4e52, 0x2e3236, 0xe8c84a, 0xc03a3a, '');
  }
  function yetiBuild() {
    var fur = 0xe8eef4, skin = 0xc8d0d8;
    return { variant: '', w: 0.9, h: 2.15, mainColor: fur, parts: [
      [0.70, 0.55, 0.55, 0, 1.72, 0, fur],
      [0.72, 0.80, 0.42, 0, 1.10, 0, fur],
      [0.22, 0.70, 0.22, -0.48, 1.15, 0.18, skin],
      [0.22, 0.70, 0.22, 0.48, 1.15, 0.18, skin],
      [0.22, 0.62, 0.22, -0.16, 0.32, 0, fur],
      [0.22, 0.62, 0.22, 0.16, 0.32, 0, fur]
    ] };
  }
  function sporeBeastBuild() {
    var body = 0x6b8f3a, cap = 0xa85cb0, spot = 0x3d5a22;
    return { variant: '', w: 0.75, h: 1.35, mainColor: body, parts: [
      [0.62, 0.48, 0.70, 0, 0.55, 0, body],
      [0.50, 0.36, 0.50, 0, 1.05, 0.08, cap],
      [0.16, 0.12, 0.16, -0.16, 0.62, 0.32, spot],
      [0.16, 0.12, 0.16, 0.16, 0.62, 0.32, spot],
      [0.14, 0.36, 0.14, -0.20, 0.18, 0.18, body],
      [0.14, 0.36, 0.14, 0.20, 0.18, 0.18, body],
      [0.14, 0.36, 0.14, -0.18, 0.18, -0.22, body],
      [0.14, 0.36, 0.14, 0.18, 0.18, -0.22, body]
    ] };
  }
  function acidMiteBuild() {
    var body = 0x8ccf3a, blotch = 0x4a7a18, belly = 0xd4f07a;
    return { variant: '', w: 0.65, h: 0.9, mainColor: body, parts: [
      [0.60, 0.48, 0.70, 0, 0.42, -0.02, body],
      [0.18, 0.14, 0.10, -0.12, 0.56, 0.32, 0x101010],
      [0.18, 0.14, 0.10, 0.12, 0.56, 0.32, 0x101010],
      [0.28, 0.16, 0.14, 0, 0.34, 0.34, belly],
      [0.40, 0.08, 0.10, 0, 0.66, -0.04, blotch],
      [0.12, 0.28, 0.12, -0.20, 0.14, 0.20, blotch],
      [0.12, 0.28, 0.12, 0.20, 0.14, 0.20, blotch],
      [0.12, 0.28, 0.12, -0.20, 0.14, -0.24, blotch],
      [0.12, 0.28, 0.12, 0.20, 0.14, -0.24, blotch]
    ] };
  }
  function magmaCrawlerBuild() {
    var rock = 0x4a2a22, glow = 0xff6a20;
    return { variant: '', w: 0.8, h: 0.7, mainColor: rock, parts: [
      [0.72, 0.28, 0.86, 0, 0.32, 0, rock],
      [0.20, 0.10, 0.40, 0, 0.42, 0.10, glow],
      [0.14, 0.22, 0.14, -0.24, 0.12, 0.24, rock],
      [0.14, 0.22, 0.14, 0.24, 0.12, 0.24, rock],
      [0.14, 0.22, 0.14, -0.24, 0.12, -0.26, rock],
      [0.14, 0.22, 0.14, 0.24, 0.12, -0.26, rock]
    ] };
  }
  function ashMiteBuild() {
    var ash = 0x6a6460, ember = 0xe07030;
    return { variant: '', w: 0.5, h: 1.15, mainColor: ash, parts: [
      [0.28, 0.28, 0.28, 0, 0.95, 0, ash],
      [0.24, 0.40, 0.18, 0, 0.60, 0, ash],
      [0.08, 0.06, 0.50, 0.18, 0.68, 0.22, ember],
      [0.10, 0.36, 0.10, -0.08, 0.18, 0, ash],
      [0.10, 0.36, 0.10, 0.08, 0.18, 0, ash]
    ] };
  }
  function glowJellyBuild() {
    var bell = 0x7ad8e8, glow = 0xd8fff4;
    return { variant: '', w: 0.7, h: 0.85, mainColor: bell, parts: [
      [0.62, 0.28, 0.62, 0, 0.58, 0, bell],
      [0.36, 0.16, 0.36, 0, 0.42, 0, glow],
      [0.06, 0.32, 0.06, -0.16, 0.18, 0.10, bell],
      [0.06, 0.32, 0.06, 0.16, 0.18, 0.10, bell],
      [0.06, 0.28, 0.06, -0.06, 0.16, -0.12, glow],
      [0.06, 0.28, 0.06, 0.08, 0.16, 0.14, glow]
    ] };
  }
  function drownedBuild() {
    var skin = 0x3a7a72, weed = 0x2a5a40, cloth = 0x2a4a58;
    return { variant: '', w: 0.6, h: 1.8, mainColor: skin, parts: [
      [0.42, 0.42, 0.42, 0, 1.55, 0, skin],
      [0.44, 0.62, 0.26, 0, 1.02, 0, cloth],
      [0.18, 0.10, 0.18, 0, 1.78, 0.08, weed],
      [0.14, 0.55, 0.14, -0.32, 1.05, 0.30, skin],
      [0.14, 0.55, 0.14, 0.32, 1.05, 0.30, skin],
      [0.16, 0.55, 0.16, -0.11, 0.28, 0, cloth],
      [0.16, 0.55, 0.16, 0.11, 0.28, 0, cloth]
    ] };
  }

  var BUILDERS = {
    sheep:   { make: sheepBuild,   hp: function () { return C.HP_SHEEP; },   speedMul: 1 },
    pig:     { make: pigBuild,     hp: function () { return C.HP_PIG; },     speedMul: 0.95 },
    chicken: { make: chickenBuild, hp: function () { return C.HP_CHICKEN; }, speedMul: 0.75 },
    rabbit:  { make: rabbitBuild,  hp: function () { return C.HP_RABBIT; },  speedMul: 1.35 },
    cat:     { make: catBuild,     hp: function () { return C.HP_CAT; },     speedMul: 1.1 },
    zombie:  { make: zombieBuild,  hp: function () { return C.HP_ZOMBIE; },  speedMul: 1 },
    archer:  { make: archerBuild,  hp: function () { return C.HP_ARCHER; },  speedMul: 1 },
    boomer:  { make: boomerBuild,  hp: function () { return C.HP_BOOMER; },  speedMul: 1 },
    wolf:    { make: function () { return wolfBuild(false); }, hp: function () { return C.HP_WOLF; }, speedMul: 1.15 },
    villager:{ make: function () { return villagerBuild((Math.random() * 2) | 0); }, hp: function () { return C.HP_VILLAGER; }, speedMul: 0.85 },
    sand_stalker:  { make: sandStalkerBuild,  hp: function () { return C.HP_SAND_STALKER; },  speedMul: 1.05 },
    dune_scorpion: { make: duneScorpionBuild, hp: function () { return C.HP_DUNE_SCORPION; }, speedMul: 1.2 },
    frost_wolf:    { make: function () { return frostWolfBuild(false); }, hp: function () { return C.HP_FROST_WOLF; }, speedMul: 1.15 },
    yeti:          { make: yetiBuild,         hp: function () { return C.HP_YETI; },         speedMul: 0.65, meleeMul: 1.6 },
    spore_beast:   { make: sporeBeastBuild,   hp: function () { return C.HP_SPORE_BEAST; },  speedMul: 1.05 },
    acid_mite:     { make: acidMiteBuild,     hp: function () { return C.HP_ACID_MITE; },    speedMul: 1.1 },
    magma_crawler: { make: magmaCrawlerBuild, hp: function () { return C.HP_MAGMA_CRAWLER; }, speedMul: 1.15 },
    ash_mite:      { make: ashMiteBuild,      hp: function () { return C.HP_ASH_MITE; },     speedMul: 1.1 },
    glow_jelly:    { make: glowJellyBuild,    hp: function () { return C.HP_GLOW_JELLY; },   speedMul: 0.7 },
    drowned:       { make: drownedBuild,      hp: function () { return C.HP_DROWNED; },      speedMul: 1 },
    fjord_wolf:    { make: function () { return fjordWolfBuild(false); }, hp: function () { return C.HP_FJORD_WOLF; }, speedMul: 1.15 }
  };

  // 行为表与渲染构建器分离：合批只改变 Mesh 结构，不改变逃跑、声音和掉落语义。
  var ROLE = {
    sheep: 'wander', pig: 'wander', chicken: 'wander', rabbit: 'wander', cat: 'wander',
    glow_jelly: 'wander',
    zombie: 'chase', dune_scorpion: 'chase', yeti: 'chase', spore_beast: 'chase',
    magma_crawler: 'chase', drowned: 'chase',
    archer: 'kite', sand_stalker: 'kite', ash_mite: 'kite',
    boomer: 'explode', acid_mite: 'explode',
    wolf: 'pack', frost_wolf: 'pack', fjord_wolf: 'pack',
    villager: 'npc'
  };
  var PASSIVE = { sheep: true, pig: true, chicken: true, rabbit: true, cat: true, glow_jelly: true };
  var HOSTILE = {
    zombie: true, archer: true, boomer: true,
    sand_stalker: true, dune_scorpion: true, yeti: true,
    spore_beast: true, acid_mite: true, magma_crawler: true,
    ash_mite: true, drowned: true
  };
  // 狼族：中立捕食者（可驯服），村民：服务型 NPC（不可喂食/攻击无掉落）
  var NEUTRAL = { wolf: true, frost_wolf: true, fjord_wolf: true };
  var BURNS_SUN = { zombie: true, archer: true, drowned: true };
  var PACK_COLLAR = { wolf: wolfBuild, frost_wolf: frostWolfBuild, fjord_wolf: fjordWolfBuild };
  // 捕食链：狼猎食的物种（排除猫——它可能是玩家的伙伴）
  var PREY_TYPES = ['sheep', 'pig', 'chicken', 'rabbit'];
  // 喂养食物偏好：命中即可进入求爱状态；wolf 为驯服通道
  var FEED_FOOD = {
    sheep: [5],              // 树叶
    pig: [109], chicken: [111], rabbit: [113],
    cat: [110, 112],         // 熟肉
    wolf: [109, 111, 113],    // 生肉 ×2 次驯服
    frost_wolf: [109, 111, 113],
    fjord_wolf: [109, 111, 113]
  };
  var KILL_DROPS = {
    sheep: [16, C.WOOL_DROP],
    pig: [109, 1],        // 生猪排
    chicken: [111, 1],    // 生鸡肉
    rabbit: [113, 1],     // 生兔肉
    cat: [121, C.CAT_FUR_DROP], // 猫毛（2 猫毛 → 1 猫毛毡）
    archer: [107, 1],     // 煤炭（白骨燃料，产量与骨架同源）
    wolf: [135, 1],        // 狼牙可削箭杆 → 掉落箭 ×1
    sand_stalker: [135, 1],
    dune_scorpion: [107, 1],
    frost_wolf: [135, 1],
    yeti: [16, 2],
    spore_beast: [5, 1],
    magma_crawler: [107, 1],
    ash_mite: [135, 1],
    glow_jelly: [113, 1],
    drowned: [107, 1],
    fjord_wolf: [135, 1]
  };
  var VOICE = { sheep: 'sheep', pig: 'pig', chicken: 'chicken', rabbit: 'rabbit', cat: 'cat', zombie: 'zombie' };
  var VOICE_HURT = { sheep: 'sheepHurt', pig: 'pigHurt', chicken: 'chickenHurt', rabbit: 'rabbitHurt', cat: 'catHurt' };

  var mobDensityF = 1;

  // 游戏难度：0=和平 1=简单 2=困难 3=噩梦（未加载设置时按困难处理）
  function diffLevel() {
    if (!Voxel.Settings) return 2;
    var d = Voxel.Settings.get('difficulty');
    return (typeof d === 'number' && isFinite(d)) ? Math.round(d) : 2;
  }

  var TARGET_KEYS = {
    sheep: 'SHEEP_TARGET',
    pig: 'PIG_TARGET',
    chicken: 'CHICKEN_TARGET',
    rabbit: 'RABBIT_TARGET',
    cat: 'CAT_TARGET',
    zombie: 'ZOMBIE_TARGET',
    archer: 'ARCHER_TARGET',
    boomer: 'BOOMER_TARGET',
    wolf: 'WOLF_TARGET',
    villager: 'VILLAGER_TARGET',
    sand_stalker: 'SAND_STALKER_TARGET',
    dune_scorpion: 'DUNE_SCORPION_TARGET',
    frost_wolf: 'FROST_WOLF_TARGET',
    yeti: 'YETI_TARGET',
    spore_beast: 'SPORE_BEAST_TARGET',
    acid_mite: 'ACID_MITE_TARGET',
    magma_crawler: 'MAGMA_CRAWLER_TARGET',
    ash_mite: 'ASH_MITE_TARGET',
    glow_jelly: 'GLOW_JELLY_TARGET',
    drowned: 'DROWNED_TARGET',
    fjord_wolf: 'FJORD_WOLF_TARGET'
  };

  // 各被动生物可生成的地表方块 + 是否允许出现在该群系（biomes.js 的 mobs 表）
  var PASSIVE_SURFACES = {
    sheep: [1, 18, 24, 215],
    pig: [1, 2, 24],
    chicken: [1, 2, 24],
    rabbit: [1, 2, 6, 18, 24, 28, 215],
    cat: [1],
    wolf: [1],
    frost_wolf: [1, 18, 32],
    fjord_wolf: [1, 215, 18],
    glow_jelly: [6, 28, 3],
    sand_stalker: [6, 28],
    dune_scorpion: [6, 28, 29],
    yeti: [18, 32, 3],
    spore_beast: [1, 2, 53],
    acid_mite: [1, 2, 53],
    magma_crawler: [3, 28, 29],
    ash_mite: [3, 14, 28],
    drowned: [6, 3, 1]
  };
  // 群系门控类型（trySpawn 检查 biome mobs 表）之外的独立白名单
  var EXTRA_BIOME_GATE = {
    wolf: null   // 延迟初始化：Voxel.Biomes.B 引用时机问题
  };
  function wolfBiomeSet() {
    if (!EXTRA_BIOME_GATE.wolf) {
      var B = Voxel.Biomes.B;
      EXTRA_BIOME_GATE.wolf = makeLocSet([
        B.FOREST, B.BIRCH_FOREST, B.TAIGA, B.MEGA_TAIGA, B.SNOWY, B.DARK_FOREST
      ]);
    }
    return EXTRA_BIOME_GATE.wolf;
  }
  function makeLocSet(ids) {
    var out = Object.create(null);
    for (var i = 0; i < ids.length; i++) out[ids[i]] = true;
    return out;
  }

  function spawn(type, pos) {
    var b = BUILDERS[type].make();
    var key = type + (b.variant ? '_' + b.variant : '');
    ensureSharedMats();
    var mesh = new THREE.Mesh(getGeo(key, b.parts), sharedMat);
    var m = {
      type: type,
      pos: pos.clone(),
      // 渲染插值（plan 5.6）：prev/curr 快照槽，仅显示侧 lerp，模拟不读。
      // 出生即 curr=prev=pos，避免首帧从原点飞入
      ipx: pos.x, ipy: pos.y, ipz: pos.z,
      icx: pos.x, icy: pos.y, icz: pos.z,
      bobY: 0,
      vel: new THREE.Vector3(),
      w: b.w, h: b.h,
      voiceVariant: b.voice,                 // 猫品种专属叫声索引（其他生物为 undefined）
      speedMul: BUILDERS[type].speedMul,
      group: mesh,
      baseColors: [b.mainColor],
      hp: BUILDERS[type].hp(),
      onGround: false,
      dir: Math.random() * Math.PI * 2,
      aiTimer: 0.5,
      moveTime: 0,
      attackCd: 0,
      flash: 0,
      fleeT: 0,                              // 受击逃跑剩余时间
      fleeRepath: 0,                         // 逃跑方向刷新计时
      voiceTimer: 4 + Math.random() * 10,    // 叫声计时
      // 敌对生物寻路：BFS 航点队列 + 重算计时
      path: null, pathTimer: 0, pathAge: 0,
      arrowCd: 1.5,                          // 弓手射击冷却
      fuse: -1,                              // 自爆引信：<0 未点燃
      // 喂养繁殖 / 狼驯服 / 幼崽
      loveT: -1, breedCd: 0,                 // 求爱剩余时间；繁殖冷却
      baby: false, babyT: 0,                 // 幼崽标志与成长倒计时
      trust: 0, tamed: false,                // 狼驯服进度（2 次喂食）
      agroT: 0,                              // 狼被激怒扑咬玩家的剩余时间
      dead: false
    };
    group.add(mesh);
    list.push(m);
    return m;
  }

  function removeAt(i) {
    var m = list[i];
    group.remove(m.group);   // 几何与材质为共享缓存，不释放
    list.splice(i, 1);
  }

  function densityTarget(type) {
    var base = C[TARGET_KEYS[type]];
    if (!(base > 0)) return 0;   // 测试/调试可把目标设为 0 来禁用该类型
    return Math.max(1, Math.round(base * mobDensityF));
  }

  // 设置降低时立即清掉各类型的超额个体；提高时仍交给原有生成节奏逐步补齐。
  function trimToDensity() {
    var counts = {};
    for (var i = 0; i < list.length; i++)
      counts[list[i].type] = (counts[list[i].type] || 0) + 1;
    for (var j = list.length - 1; j >= 0; j--) {
      var type = list[j].type;
      if ((counts[type] || 0) > densityTarget(type)) {
        counts[type]--;
        removeAt(j);
      }
    }
  }

  function setDensity(f) {
    var next = (typeof f === 'number' && isFinite(f)) ? f : 1;
    next = Math.max(0.25, Math.min(1, next));
    if (next === mobDensityF) return;
    mobDensityF = next;
    trimToDensity();
  }

  // 难度切换钩子：切到和平时立即清空所有敌对生物
  function setDifficulty(v) {
    if (v !== 0) return;
    for (var i = list.length - 1; i >= 0; i--) {
      if (!PASSIVE[list[i].type]) removeAt(i);
    }
  }

  function setFlash(m, on) {
    m.group.material = on ? flashMat : sharedMat;
  }

  function damage(m, n, dir) {
    if (m.dead) return;
    m.hp -= n;
    m.flash = 0.15;
    setFlash(m, true);
    m.vel.x += dir.x * 5;
    m.vel.z += dir.z * 5;
    m.vel.y += 3;
    Voxel.Sound.hit();
    var sp = Voxel.Sound.spatial ? Voxel.Sound.spatial(m.pos.x, m.pos.z) : { vol: 1, pan: 0 };
    if (VOICE_HURT[m.type]) {
      Voxel.Sound[VOICE_HURT[m.type]](sp.vol, sp.pan);
    }
    // 被动生物与村民受击逃跑：转身背向玩家，加速逃离
    if (PASSIVE[m.type] || m.type === 'villager') {
      m.fleeT = C.FLEE_TIME;
      m.fleeRepath = 0;
      m.moveTime = Math.max(m.moveTime, m.fleeT);
    }
    // 狼族被激怒：追咬攻击者（驯服个体不受此项影响）
    if (ROLE[m.type] === 'pack' && !m.tamed) {
      m.agroT = C.WOLF_AGGRO_TIME;
      m.path = null;
      var wsp = Voxel.Sound.spatial ? Voxel.Sound.spatial(m.pos.x, m.pos.z) : { vol: 1, pan: 0 };
      Voxel.Sound.wolf(wsp.vol, wsp.pan);
    }
    if (m.hp <= 0) kill(m);
  }

  function kill(m) {
    m.dead = true;
    Voxel.Sound.pop();
    if (Voxel.Progress && Voxel.Progress.track)
      Voxel.Progress.track('kill', { type: m.type });
    var p = m.pos.clone();
    p.y += m.h * 0.5;
    Voxel.Particles.burst(p, m.baseColors[0], 14);
    var drop = KILL_DROPS[m.type];
    if (drop && Voxel.Game && Voxel.Game.onDrop) {
      Voxel.Game.onDrop(drop[0], drop[1], p);
    }
    var i = list.indexOf(m);
    if (i >= 0) removeAt(i);
  }

  function currentPlanetKey() {
    if (Voxel.World && typeof Voxel.World.planetTypeKey === 'function')
      return Voxel.World.planetTypeKey() || 'lush';
    var p = Voxel.World && Voxel.World.getProfile && Voxel.World.getProfile();
    if (p && typeof p.typeKey === 'string') return p.typeKey;
    return 'lush';
  }

  function trySpawn(type) {
    if (!BUILDERS[type]) return null;
    var planet = currentPlanetKey();
    if (Voxel.PlanetRules && Voxel.PlanetRules.faunaAllows &&
      !Voxel.PlanetRules.faunaAllows(planet, type)) return null;
    var Pp = Voxel.Player.pos();
    var surfaces = PASSIVE_SURFACES[type];
    var lushVanilla = planet === 'lush';
    var preferWater = type === 'glow_jelly';
    for (var a = 0; a < 12; a++) {
      var ang = Math.random() * Math.PI * 2;
      var dist = C.SPAWN_MIN + Math.random() * (C.SPAWN_MAX - C.SPAWN_MIN);
      var x = Math.floor(Pp.x + Math.cos(ang) * dist);
      var z = Math.floor(Pp.z + Math.sin(ang) * dist);
      var y = Voxel.World.surfaceAt(x, z);
      if (y < 3 || y >= H - 4) continue;
      if (surfaces && surfaces.indexOf(Voxel.World.get(x, y, z)) < 0) continue;
      // lush 保留原群系门控；其它行星以 PlanetRules 表为准
      if (lushVanilla && PASSIVE[type]) {
        var bd = Voxel.Biomes.def(Voxel.World.biomeAt(x, z));
        if (!bd.mobs || bd.mobs.indexOf(type) < 0) continue;
      } else if (lushVanilla && type === 'wolf') {
        if (!wolfBiomeSet()[Voxel.World.biomeAt(x, z)]) continue;
      }
      if (preferWater && Voxel.World.get(x, y + 1, z) === 7) {
        var wy = y + 1;
        while (wy < H - 4 && Voxel.World.get(x, wy + 1, z) === 7) wy++;
        return spawn(type, new THREE.Vector3(x + 0.5, wy + 0.25, z + 0.5));
      }
      if (Voxel.World.get(x, y + 1, z) !== 0 || Voxel.World.get(x, y + 2, z) !== 0) continue;
      return spawn(type, new THREE.Vector3(x + 0.5, y + 1.02, z + 0.5));
    }
    return null;
  }

  function manage(night) {
    var counts = {};
    for (var i = 0; i < list.length; i++) {
      counts[list[i].type] = (counts[list[i].type] || 0) + 1;
    }
    var diff = diffLevel();
    var nightmareMul = diff >= 3 ? 1.5 : 1;
    var plan = Voxel.PlanetRules && Voxel.PlanetRules.faunaSpawnPlan
      ? Voxel.PlanetRules.faunaSpawnPlan(currentPlanetKey(), night, diff)
      : [];
    for (var p = 0; p < plan.length; p++) {
      var e = plan[p];
      var want = densityTarget(e.type);
      if (e.hostile || e.role === 'pack') want = Math.round(want * nightmareMul);
      if ((counts[e.type] || 0) < want) trySpawn(e.type);
    }
  }

  // ================= 轻量寻路（网格 A*）=================
  // 视线被遮挡时给敌对生物铺一条绕行航点路。搜索窗口 21×21 列、展开上限
  // 280 格，每次重算在单帧内完成（~µs 级）；高度查 surfaceAt 局部缓存。
  var NAV_R = 10, NAV_CAP = 280;

  function navWalkable(mx, mz) {
    var y = Voxel.World.surfaceAt(mx, mz);
    if (y < 2 || y >= H - 3) return -1;
    // 顶部实心且上方两格净空才可通行；水柱顶除外（避免扎进湖心）
    if (Voxel.World.get(mx, y + 1, mz) !== 0 || Voxel.World.get(mx, y + 2, mz) !== 0) return -1;
    return y;
  }

  function planPath(m, tx, tz) {
    var sx = Math.floor(m.pos.x), sz = Math.floor(m.pos.z);
    if (Math.abs(tx - sx) > NAV_R * 2 || Math.abs(tz - sz) > NAV_R * 2) return null;
    var open = [], seen = {}, heights = {};
    var key = function (x, z) { return x + ',' + z; };
    var hx = function (x, z) {
      var k = key(x, z);
      if (!(k in heights)) heights[k] = navWalkable(x, z);
      return heights[k];
    };
    var sh = hx(sx, sz);
    if (sh < 0) return null;
    seen[key(sx, sz)] = true;
    open.push({ x: sx, z: sz, g: 0, parent: null });
    var best = null, bestH = Infinity;
    var tX = Math.floor(tx), tZ = Math.floor(tz);
    var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (open.length) {
      // 线性取最小 f（g + 曼哈顿启发）——节点数 ≤280 时比二叉堆更快
      var bi = 0, bf = Infinity;
      for (var i = 0; i < open.length; i++) {
        var f = open[i].g + Math.abs(open[i].x - tX) + Math.abs(open[i].z - tZ);
        if (f < bf) { bf = f; bi = i; }
      }
      var cur = open.splice(bi, 1)[0];
      var ch = hx(cur.x, cur.z);
      if (ch >= 0) {
        var dh = Math.abs(cur.x - tX) + Math.abs(cur.z - tZ);
        if (dh < bestH) { bestH = dh; best = cur; }
        if (dh === 0) break;
      }
      if (cur.g >= NAV_CAP / 28) continue;   // 深度剪枝：半径内最多走 ~10 步
      for (var d = 0; d < 4; d++) {
        var nx = cur.x + DIRS[d][0], nz = cur.z + DIRS[d][1];
        var k2 = key(nx, nz);
        if (seen[k2]) continue;
        seen[k2] = true;
        var nh = hx(nx, nz);
        if (nh < 0 || Math.abs(nh - (ch >= 0 ? ch : sh)) > 1) continue;  // 只跨 ≤1 格台阶
        open.push({ x: nx, z: nz, g: cur.g + 1, parent: cur });
      }
    }
    if (!best) return null;
    var out = [];
    for (var p = best; p.parent; p = p.parent) out.unshift({ x: p.x + 0.5, z: p.z + 0.5, y: hx(p.x, p.z) });
    return out.length ? out : null;
  }

  function followPath(m, speed) {
    if (!m.path || !m.path.length) return 0;
    var wp = m.path[0];
    var dx = wp.x - m.pos.x, dz = wp.z - m.pos.z;
    if (dx * dx + dz * dz < 0.30) {
      m.path.shift();
      if (!m.path.length) return 0;
      wp = m.path[0];
      dx = wp.x - m.pos.x; dz = wp.z - m.pos.z;
    }
    m.dir = Math.atan2(-dx, -dz);
    return speed;
  }

  // ================= 弓手箭矢 =================
  var arrows = [];
  var arrowGeo = null, arrowMat = null;

  function shootArrow(m, Pp) {
    if (!arrowGeo) arrowGeo = new THREE.BoxGeometry(0.07, 0.07, 0.42);
    if (!arrowMat) arrowMat = new THREE.MeshBasicMaterial({ color: 0xe8dcc0 });
    var oy = m.pos.y + m.h * 0.72;
    var txp = Pp.x, typ = Pp.y + P.EYE * 0.85, tzp = Pp.z;
    // 预判目标半程位移（0.35 权重足够打中移动中的玩家又不至于无解）
    var pv = Pl_velSafe();
    var flyT = Math.sqrt((txp - m.pos.x) * (txp - m.pos.x) + (tzp - m.pos.z) * (tzp - m.pos.z)) / C.ARROW_SPEED;
    txp += pv.x * flyT * 0.35; tzp += pv.z * flyT * 0.35;
    var d = new THREE.Vector3(txp - m.pos.x, typ - oy, tzp - m.pos.z);
    if (d.lengthSq() < 0.01) return;
    d.normalize();
    // 小散布，避免每箭必中
    d.x += (Math.random() - 0.5) * 0.04;
    d.y += (Math.random() - 0.5) * 0.03 + 0.02;   // 抬一点补偿重力
    d.z += (Math.random() - 0.5) * 0.04;
    d.normalize().multiplyScalar(C.ARROW_SPEED);
    var mesh = new THREE.Mesh(arrowGeo, arrowMat);
    mesh.position.set(m.pos.x, oy, m.pos.z);
    mesh.lookAt(mesh.position.x + d.x, oy + d.y, mesh.position.z + d.z);
    group.add(mesh);
    arrows.push({
      pos: mesh.position, vel: d, life: C.ARROW_LIFE,
      mesh: mesh, stuckT: -1
    });
  }

  function Pl_velSafe() {
    var v = Voxel.Player.vel ? Voxel.Player.vel() : null;
    return (v && isFinite(v.x)) ? v : { x: 0, y: 0, z: 0 };
  }

  function updateArrows(dt) {
    var alive = Voxel.Player.alive();
    var Pv = Voxel.Player.pos();
    for (var i = arrows.length - 1; i >= 0; i--) {
      var a = arrows[i];
      a.life -= dt;
      if (a.life <= 0) { group.remove(a.mesh); arrows.splice(i, 1); continue; }
      if (a.stuckT >= 0) {
        a.stuckT -= dt;
        if (a.stuckT <= 0) { group.remove(a.mesh); arrows.splice(i, 1); }
        continue;
      }
      a.vel.y -= 7 * dt;   // 箭矢重力约为方块重力的 1/4
      var steps = Math.max(1, Math.ceil(a.vel.length() * dt / 0.7));
      var hitSomething = false;
      for (var s = 0; s < steps; s++) {
        var sdt = dt / steps;
        a.pos.x += a.vel.x * sdt;
        a.pos.y += a.vel.y * sdt;
        a.pos.z += a.vel.z * sdt;
        if (Voxel.Physics.isSolidCell(Math.floor(a.pos.x), Math.floor(a.pos.y), Math.floor(a.pos.z))) {
          a.stuckT = 0.5; hitSomething = true; break;
        }
        if (alive) {
          var px = Pv.x - a.pos.x, py = (Pv.y + P.EYE * 0.5) - a.pos.y, pz = Pv.z - a.pos.z;
          if (px * px + pz * pz < 0.36 && Math.abs(py) < 1.1) {
            Voxel.Player.damage(C.ARCHER_DMG, 'archer', a.pos.x, a.pos.z);
            if (Voxel.Player.knockback) {
              var kl = Math.sqrt(px * px + pz * pz) || 1;
              Voxel.Player.knockback(-px / kl, -pz / kl, 5);
            }
            a.stuckT = 0; hitSomething = true; break;
          }
        }
      }
      if (hitSomething && a.stuckT <= 0) {
        group.remove(a.mesh); arrows.splice(i, 1); continue;
      }
      if (a.stuckT >= 0) a.vel.set(0, 0, 0);
    }
  }

  // ================= 自爆虫引爆 =================
  // 保护基岩与功能方块（契约同 gen_core 的 STRUCT_KEEP）
  var EXPLODE_GUARD = {
    12: true, 15: true, 17: true, 37: true, 38: true,
    67: true, 68: true, 69: true, 70: true, 71: true
  };

  function detonate(m) {
    var r = C.EXPLODE_R;
    var cx = Math.floor(m.pos.x), cy = Math.floor(m.pos.y + m.h * 0.5), cz = Math.floor(m.pos.z);
    var removed = 0;
    for (var dx = -Math.ceil(r); dx <= r && removed < 90; dx++)
      for (var dy = -Math.ceil(r); dy <= r && removed < 90; dy++)
        for (var dz = -Math.ceil(r); dz <= r && removed < 90; dz++) {
          if (dx * dx + dy * dy + dz * dz > r * r) continue;
          var x = cx + dx, y = cy + dy, z = cz + dz;
          if (y <= 1 || y >= H - 1) continue;
          var id = Voxel.World.get(x, y, z);
          if (id === 0 || EXPLODE_GUARD[id]) continue;
          Voxel.World.set(x, y, z, 0);
          removed++;
        }
    var boomP = m.pos.clone(); boomP.y += m.h * 0.5;
    Voxel.Particles.burst(boomP, 0x8cc763, 16);
    Voxel.Particles.burst(boomP, 0x50503c, 14);
    Voxel.Sound.hit();
    Voxel.Sound.pop();
    if (Voxel.Sound.thunder) Voxel.Sound.thunder();
    var Pv = Voxel.Player.pos();
    var pdx = Pv.x - m.pos.x, pdz = Pv.z - m.pos.z;
    var pd = Math.sqrt(pdx * pdx + pdz * pdz + (Pv.y - boomP.y) * (Pv.y - boomP.y));
    if (pd < r * 2.2 && Voxel.Player.alive() && diffLevel() > 0) {
      var fall = Math.max(0.25, 1 - pd / (r * 2.2));
      Voxel.Player.damage(Math.max(1, Math.round(C.BOOMER_DMG * fall)), 'boomer', m.pos.x, m.pos.z);
      if (Voxel.Player.knockback) {
        var kl = Math.sqrt(pdx * pdx + pdz * pdz) || 1;
        Voxel.Player.knockback(pdx / kl, pdz / kl, 11 * fall + 3);
      }
    }
    m.dead = true;
    var idx = list.indexOf(m);
    if (idx >= 0) removeAt(idx);   // 不记击杀：自爆属于环境死亡
  }

  // ================= 狼 AI / 喂养繁殖 =================

  // 驯服换项圈几何（variant '_c' 命中同一缓存族）
  function applyCollarMesh(m) {
    var make = PACK_COLLAR[m.type] || wolfBuild;
    var b = make(true);
    m.group.geometry = getGeo(m.type + b.variant, b.parts);
  }

  // 就近找同类求爱对象
  function findLovePartner(m) {
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o !== m && !o.dead && !o.baby && o.type === m.type && o.loveT > 0) {
        var dx = o.pos.x - m.pos.x, dz = o.pos.z - m.pos.z;
        if (dx * dx + dz * dz < 49) return o;
      }
    }
    return null;
  }

  function spawnHeartBurst(pos, headH) {
    var p = pos.clone();
    p.y += (headH || 1) + 0.4;
    Voxel.Particles.burst(p, 0xff7fa0, 5);
  }

  // 喂养入口（main.js 在攻击判定前调用）。返回 'feed'|'tame'|false。
  function feed(m, itemId) {
    if (!m || m.dead || m.baby) return false;
    var foods = FEED_FOOD[m.type];
    if (!foods || foods.indexOf(itemId | 0) < 0) return false;
    if (m.loveT > 0 || m.breedCd > 0) return false;   // 吃撑了 / 冷却中不接受
    spawnHeartBurst(m.pos, m.h);
    Voxel.Sound.heart();
    if (ROLE[m.type] === 'pack' && !m.tamed) {
      m.trust++;
      if (m.trust >= 2) {
        m.tamed = true;
        applyCollarMesh(m);
        Voxel.Sound.wolf(1, 0);
        if (Voxel.HUD && Voxel.HUD.toast) Voxel.HUD.toast('🐺 狼戴上了红项圈 —— 它会跟随并保护你');
      }
      return 'tame';
    }
    m.loveT = C.LOVE_TIME;
    return 'feed';
  }

  function makeBaby(a, b) {
    var mid = new THREE.Vector3(
      (a.pos.x + b.pos.x) / 2,
      Math.max(a.pos.y, b.pos.y),
      (a.pos.z + b.pos.z) / 2);
    var y = Voxel.World.surfaceAt(Math.floor(mid.x), Math.floor(mid.z));
    if (y >= 3) mid.y = y + 1.02;
    var c = spawn(a.type, mid);
    c.baby = true;
    c.babyT = C.BABY_GROW;
    c.hp = Math.max(1, Math.ceil(BUILDERS[a.type].hp() * 0.5));
    c.group.scale.setScalar(C.BABY_SCALE);
    // 幼崽继承双亲的猫叫声品种，避免变声突兀
    if (a.voiceVariant !== undefined) c.voiceVariant = a.voiceVariant;
    return c;
  }

  // 狼行为主循环（驯服跟随/扑咬/狩猎），返回本帧移动速度
  function wolfAI(m, dt, Pv, mul) {
    var spd = C.ZOMBIE_SPEED * mul;
    if (m.tamed) {
      var pdx = Pv.x - m.pos.x, pdz = Pv.z - m.pos.z;
      var pd = Math.sqrt(pdx * pdx + pdz * pdz);
      // 卫士职责：撕咬靠近玩家的敌对生物
      if (m.attackCd <= 0) {
        for (var i = 0; i < list.length; i++) {
          var h = list[i];
          if (h.dead || !HOSTILE[h.type]) continue;
          var hx = h.pos.x - Pv.x, hz = h.pos.z - Pv.z;
          if (hx * hx + hz * hz < 100 && Math.abs(h.pos.y - Pv.y) < 4) {
            var wdx = h.pos.x - m.pos.x, wdz = h.pos.z - m.pos.z;
            var wd = Math.sqrt(wdx * wdx + wdz * wdz);
            if (wd < 1.8) {
              m.attackCd = 1.0;
              var kn = Math.sqrt(wdx * wdx + wdz * wdz) || 1;
              damage(h, C.WOLF_DMG, { x: wdx / kn, z: wdz / kn });
              break;
            } else if (wd < 9) {
              // 追向威胁目标
              m.dir = Math.atan2(-wdx, -wdz);
              m.moveTime = Math.max(m.moveTime, 0.5);
              return spd * 1.15;
            }
          }
        }
      }
      // 跟随：远距瞬移保活，中距寻路走位，近距趴窝
      if (pd > 22) {
        m.path = null;
        var sxp = Pv.x - Math.sin(Voxel.Controls.yaw()) * 2;
        var szp = Pv.z - Math.cos(Voxel.Controls.yaw()) * 2;
        var sy = Voxel.World.surfaceAt(Math.floor(sxp), Math.floor(szp));
        if (sy > 3) { m.pos.set(sxp, sy + 1.02, szp); }
        return 0;
      }
      if (pd > 3.5) {
        m.dir = Math.atan2(-pdx, -pdz);
        m.moveTime = Math.max(m.moveTime, 0.4);
        return spd * (pd > 12 ? 1.35 : 1);
      }
      m.path = null;
      return 0;
    }
    // 激怒状态：扑咬玩家（近战规则与僵尸一致）
    if (m.agroT > 0) {
      m.agroT -= dt;
      var px = Pv.x - m.pos.x, pz = Pv.z - m.pos.z;
      var dist = Math.sqrt(px * px + pz * pz);
      if (dist < C.ZOMBIE_RANGE && losClear(m)) {
        m.dir = Math.atan2(-px, -pz);
        m.moveTime = 1;
        if (dist < 1.6 && Math.abs(Pv.y - m.pos.y) < 2.2 && m.attackCd <= 0) {
          m.attackCd = 1.1;
          Voxel.Player.damage(C.WOLF_DMG, 'wolf', m.pos.x, m.pos.z);
          if (Voxel.Player.knockback)
            Voxel.Player.knockback(px / (Math.sqrt(px * px + pz * pz) || 1), pz / (Math.sqrt(px * px + pz * pz) || 1), 6);
        }
        return spd * 1.2;
      }
      m.agroT = Math.min(m.agroT, 0.5);   // 视线丢失后短暂维持再放弃
      return 0;
    }
    // 狩猎：锁定最近的可捕食生物
    if (m.aiTimer <= 0 || !m.preyRef || m.preyRef.dead ||
      list.indexOf(m.preyRef) < 0) {
      m.aiTimer = 1 + Math.random();
      m.preyRef = null;
      var bestD = C.WOLF_HUNT_RANGE * C.WOLF_HUNT_RANGE, bestM = null;
      for (var j = 0; j < list.length; j++) {
        var q = list[j];
        if (q.dead || q.baby || PREY_TYPES.indexOf(q.type) < 0) continue;
        var qx = q.pos.x - m.pos.x, qz = q.pos.z - m.pos.z;
        var qd = qx * qx + qz * qz;
        if (qd < bestD) { bestD = qd; bestM = q; }
      }
      m.preyRef = bestM;
      // 空闲时偶尔嚎叫宣示领地
      if (!bestM && Math.random() < 0.25) {
        var sp2 = Voxel.Sound.spatial ? Voxel.Sound.spatial(m.pos.x, m.pos.z) : { vol: 1, pan: 0 };
        Voxel.Sound.wolf(sp2.vol, sp2.pan);
      }
    }
    if (m.preyRef && !m.preyRef.dead) {
      var pr = m.preyRef;
      var rpx = pr.pos.x - m.pos.x, rpz = pr.pos.z - m.pos.z;
      var rd = Math.sqrt(rpx * rpx + rpz * rpz);
      if (rd < 1.5 && Math.abs(pr.pos.y - m.pos.y) < 2) {
        kill(pr);                    // 捕食链一环：狼吃掉猎物（掉落照常发生）
        m.preyRef = null;
        m.fleeT = 0;
        return 0;
      }
      m.dir = Math.atan2(-rpx, -rpz);
      m.moveTime = Math.max(m.moveTime, 0.5);
      return spd;
    }
    return 0;
  }

  // 僵尸眼 → 玩家眼 的视线是否无遮挡
  function losClear(m) {
    var p = Voxel.Player.pos();
    var ax = m.pos.x, ay = m.pos.y + m.h * 0.85, az = m.pos.z;
    var bx = p.x, by = p.y + P.EYE, bz = p.z;
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var steps = Math.ceil(dist / 0.4);
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      if (Voxel.Blocks.isOpaque(Voxel.World.get(
        Math.floor(ax + dx * t), Math.floor(ay + dy * t), Math.floor(az + dz * t)))) return false;
    }
    return true;
  }

  function update(dt) {
    var night = Voxel.DayNight.isNight();
    var Pl = Voxel.Player;
    var alive = Pl.alive();
    var t = performance.now() / 1000;

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = 2;
      manage(night);
    }

    updateArrows(dt);

    for (var i = list.length - 1; i >= 0; i--) {
      var m = list[i];
      if (m.dead) { removeAt(i); continue; }

      // 渲染插值（plan 5.6）：本步积分前把 curr 推给 prev
      m.ipx = m.icx; m.ipy = m.icy; m.ipz = m.icz;

      m.aiTimer -= dt;
      m.moveTime -= dt;
      m.attackCd -= dt;
      m.arrowCd -= dt;

      var speed = 0;
      var Pv = Pl.pos();
      var pvV = Pl_velSafe();
      var isWolfHandled = false;
      var role = ROLE[m.type] || 'wander';
      if (role === 'pack' && alive && diffLevel() > 0) {
        // ---- 狼族：驯服跟随 / 激怒扑咬 / 狩猎被动生物 ----
        speed = wolfAI(m, dt, Pv, m.speedMul);
        isWolfHandled = true;
      }
      if (!isWolfHandled && HOSTILE[m.type] && alive && diffLevel() > 0) {
        var px = Pv.x - m.pos.x;
        var pz = Pv.z - m.pos.z;
        var dist = Math.sqrt(px * px + pz * pz);
        // 难度修正：简单 ×0.9，困难 ×1，噩梦速度 +18%
        var diff = diffLevel();
        var spdMul = (diff <= 1 ? 0.9 : (diff >= 3 ? 1.18 : 1)) * m.speedMul;
        var seesYou = dist < C.ZOMBIE_RANGE && losClear(m);

        // ---- 自爆引信：点燃后不因视线中断熄灭；拉开 FUSE_CANCEL 距离则拆除
        if (role === 'explode') {
          if (m.fuse < 0 && dist < 2.6 && seesYou) { m.fuse = C.FUSE_TIME; m.path = null; }
          if (m.fuse >= 0) {
            m.fuse -= dt;
            setFlash(m, ((m.fuse * 8) | 0) % 2 === 0);   // 引信闪烁预警
            if (dist > C.FUSE_CANCEL) { m.fuse = -1; setFlash(m, false); }
            else if (m.fuse <= 0) { detonate(m); continue; }
          }
        }

        // ---- 风筝：中距离射击
        if (role === 'kite' && seesYou && dist <= C.ARCHER_RANGE_MAX &&
          dist >= C.ARCHER_RANGE_MIN * 0.6) {
          if (dist < C.ARCHER_RANGE_MIN) {
            // 贴脸就退（背向玩家走位）
            m.dir = Math.atan2(-(-px), -(-pz));
            m.moveTime = Math.max(m.moveTime, 0.4);
            speed = C.ARCHER_SPEED * spdMul;
          } else if (m.aiTimer <= 0) {
            m.aiTimer = 0.8 + Math.random() * 0.9;   // 站桩 + 轻微横移抖动
            m.dir = Math.atan2(-px, -pz) + (Math.random() - 0.5) * 1.2;
            m.moveTime = 0.25;
          } else if (m.moveTime > 0) {
            speed = C.ARCHER_SPEED * spdMul * 0.5;
          }
          if (m.arrowCd <= 0 && losClear(m)) {
            m.arrowCd = C.ARROW_CD * (diff >= 3 ? 0.72 : 1);
            shootArrow(m, Pv);
          }
        }
        // ---- 僧尸/未进入射程的弓手/未点燃的自爆虫：追击
        else if (seesYou || HOSTILE[m.type]) {
          var chaseSpeed = role === 'kite' ? C.ARCHER_SPEED
            : (role === 'explode' ? C.BOOMER_SPEED : C.ZOMBIE_SPEED);
          if (seesYou && dist < 10) {
            // 近距直扑：视线通畅且够近时不绕路
            m.dir = Math.atan2(-px, -pz);
            m.moveTime = 1;
            m.path = null;
            speed = chaseSpeed * spdMul * (dist < 8 ? 1.35 : 1);
            // 近身攻击（命中带方向指示与击退）
            if (role === 'chase' && dist < 1.6 && Math.abs(Pv.y - m.pos.y) < 2.4 && m.attackCd <= 0) {
              m.attackCd = 1.2;
              var dmgMul = diff <= 1 ? 0.7 : (diff >= 3 ? 2 : 1);
              var melee = (BUILDERS[m.type] && BUILDERS[m.type].meleeMul) || 1;
              Pl.damage(Math.max(1, Math.round(C.ZOMBIE_DMG * dmgMul * melee)), m.type, m.pos.x, m.pos.z);
              if (Pl.knockback) {
                var klen = Math.sqrt(px * px + pz * pz) || 1;
                Pl.knockback(px / klen, pz / klen, 8);
              }
            }
          } else if (dist < C.BOOMER_RANGE + 4) {
            // 视线受阻或远距离：网格寻路绕行，周期性重算
            m.pathTimer -= dt;
            if (!m.path || !m.path.length || m.pathTimer <= 0) {
              m.path = planPath(m, Pv.x, Pv.z);
              m.pathTimer = 0.9 + Math.random() * 0.5;
            }
            speed = followPath(m, chaseSpeed * spdMul * 1.05);
            if (speed === 0 && m.moveTime > 0) { /* 航点耗尽，等待下次重算 */ }
          } else {
            // 完全跟丢：回退随机游走
            m.path = null;
          }
        }
      }
      if (speed === 0) {
        if (m.aiTimer <= 0) {
          m.aiTimer = 2 + Math.random() * 3.5;
          if (Math.random() < 0.3) { m.moveTime = 0; }
          else { m.dir = Math.random() * Math.PI * 2; m.moveTime = 1.5 + Math.random() * 2; }
        }
        if (m.moveTime > 0) speed = (HOSTILE[m.type] ? C.ZOMBIE_SPEED : C.SHEEP_SPEED) *
          m.speedMul * (HOSTILE[m.type] ? 0.7 : 1);
      }

      // ---- 喂养繁殖 / 幼崽成长（村民除外；狼只在未进入其它行为时参与求爱）----
      m.breedCd -= dt;
      if (m.baby) {
        m.babyT -= dt;
        if (m.babyT <= 0) {
          m.baby = false;
          m.hp = BUILDERS[m.type].hp();
          m.group.scale.setScalar(1);   // 长成成年体型
        }
      } else if (m.loveT > 0 && !isWolfHandled && m.type !== 'villager') {
        m.loveT -= dt;
        if (Math.random() < dt * 2.5) spawnHeartBurst(m.pos, m.h);   // 心跳粒子限频
        var partner = findLovePartner(m);
        if (partner && m.breedCd <= 0 && partner.breedCd <= 0) {
          m.loveT = -1; partner.loveT = -1;
          m.breedCd = C.BREED_CD; partner.breedCd = C.BREED_CD;
          makeBaby(m, partner);
          Voxel.Sound.heart();
        }
      }

      // 受击逃跑：背向玩家直线狂奔，周期性刷新方向（玩家移动时仍保持远离）
      if (m.fleeT > 0) {
        m.fleeT -= dt;
        m.fleeRepath -= dt;
        var Pl2 = Voxel.Player.pos();
        var awayX = m.pos.x - Pl2.x, awayZ = m.pos.z - Pl2.z;
        if (m.fleeRepath <= 0 || (awayX * awayX + awayZ * awayZ) < 0.01) {
          m.fleeRepath = 0.25;
          if ((awayX * awayX + awayZ * awayZ) < 0.01) { awayX = Math.cos(m.dir); awayZ = Math.sin(m.dir); }
          // 移动方向 (-sin,-cos)；要朝 away 走 → dir = atan2(-ax, -az)，加随机扰动防卡墙死板
          m.dir = Math.atan2(-awayX, -awayZ) + (Math.random() - 0.5) * 0.6;
          m.moveTime = Math.max(m.moveTime, Math.min(m.fleeT, 1.2));
        }
        speed = C.SHEEP_SPEED * m.speedMul * C.FLEE_MULT;
      }

      var sin = Math.sin(m.dir), cos = Math.cos(m.dir);
      m.vel.x = -sin * speed;
      m.vel.z = -cos * speed;
      // 水中漂浮：浮力把生物顶向水面，不再沉底
      var inWater = Voxel.World.get(Math.floor(m.pos.x), Math.floor(m.pos.y + 0.3), Math.floor(m.pos.z)) === 7;
      if (inWater) {
        m.vel.y += (2.6 - m.vel.y) * Math.min(1, dt * 4);
      } else {
        m.vel.y -= P.GRAVITY * dt;
        if (m.vel.y < -40) m.vel.y = -40;
      }

      // 障碍处理：撞墙跳，悬崖转弯
      if (speed > 0 && m.onGround) {
        var aheadX = Math.floor(m.pos.x - sin * 0.9);
        var aheadZ = Math.floor(m.pos.z - cos * 0.9);
        var bodyY = Math.floor(m.pos.y + m.h * 0.55);
        var blocked = Voxel.Physics.isSolidCell(aheadX, bodyY, aheadZ);
        var floorAhead = Voxel.Physics.isSolidCell(aheadX, Math.floor(m.pos.y) - 1, aheadZ);
        if (blocked) m.vel.y = 7.5;
        else if (!floorAhead) m.dir += Math.PI * (0.5 + Math.random());
      }

      Voxel.Physics.move(m, dt);

      // 生物叫声（距离衰减 + 立体声定位，超 34 块静默）
      var sp = Voxel.Sound.spatial ? Voxel.Sound.spatial(m.pos.x, m.pos.z)
        : { vol: Voxel.Sound.volAt(m.pos.x, m.pos.z), pan: 0 };
      if (alive && sp.vol > 0 && VOICE[m.type]) {
        m.voiceTimer -= dt;
        if (m.voiceTimer <= 0) {
          // 逃跑时叫得更急
          var panic = m.fleeT > 0;
          m.voiceTimer = (panic ? 1.2 : 8) + Math.random() * (panic ? 2 : 14);
          Voxel.Sound[VOICE[m.type]](sp.vol * 0.8, sp.pan, m.voiceVariant);
        }
      }

      // 渲染（位置部分移至 renderPose 逐帧插值；plan 5.6）
      m.icx = m.pos.x; m.icy = m.pos.y; m.icz = m.pos.z;
      // 走路整体轻微浮动（合批后无法单独动某一部件）
      m.bobY = (speed > 0 && m.onGround) ? Math.sin(t * 9 + i) * 0.03 : 0;
      m.group.rotation.y = m.dir + Math.PI;

      // 白天烧亡灵（需露天：天光 ≥ 12，洞穴里不烧）
      if (BURNS_SUN[m.type] &&
        Voxel.DayNight.sunlight() > 0.55 &&
        Voxel.World.getSky(Math.floor(m.pos.x), Math.floor(m.pos.y + 1.5), Math.floor(m.pos.z)) >= 12) {
        m.hp -= dt * 4;
        if (Math.random() < 0.25) {
          var bp = m.pos.clone();
          bp.y += 1 + Math.random();
          Voxel.Particles.burst(bp, 0xffaa33, 1);
        }
        if (m.hp <= 0) { kill(m); continue; }
      }

      // 过远消失
      if (alive && m.pos.distanceTo(Pl.pos()) > C.DESPAWN) { removeAt(i); continue; }

      // 受击闪白
      if (m.flash > 0) {
        m.flash -= dt;
        if (m.flash <= 0) setFlash(m, false);
      }
    }
  }

  function applyTint(tint) {
    // 合批后所有常态生物共享一个材质：整帧只需一次颜色更新（闪白中的自动覆盖为白）
    if (sharedMat) sharedMat.color.copy(tint);
  }

  function clear() {
    for (var i = list.length - 1; i >= 0; i--) removeAt(i);
    for (var j = arrows.length - 1; j >= 0; j--) { group.remove(arrows[j].mesh); }
    arrows.length = 0;
    spawnTimer = 1;
  }

  function init(scene) {
    group = new THREE.Group();
    scene.add(group);
  }

  // 渲染位姿：每个渲染帧由主循环调用（plan 5.6）。生物网格位置 = prev/curr
  // 按 alpha 插值 + 步内算好的浮动偏移。单步位移超 8 格（传送类事件）直接吸附。
  function renderPose(alpha) {
    if (!group) return;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m.group || m.dead) continue;
      var dx = m.icx - m.ipx, dy = m.icy - m.ipy, dz = m.icz - m.ipz;
      if (dx * dx + dy * dy + dz * dz > 64) {
        m.ipx = m.icx; m.ipy = m.icy; m.ipz = m.icz;
        m.group.position.set(m.icx, m.icy, m.icz);
        continue;
      }
      m.group.position.set(
        m.ipx + dx * alpha,
        m.ipy + dy * alpha + (m.bobY || 0),
        m.ipz + dz * alpha);
    }
  }

  return {
    setDensity: setDensity,
    setDifficulty: setDifficulty,
    init: init,
    update: update,
    renderPose: renderPose,
    applyTint: applyTint,
    damage: damage,
    clear: clear,
    list: list,
    count: function () { return list.length; },
    spawn: spawn,
    // 喂养入口：返回 'feed'|'tame'|false，调用方决定是否扣物品
    feed: feed,
    threatLevel: function () {
      var Pv = Voxel.Player.pos();
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.dead || !HOSTILE[m.type]) continue;
        var dx = m.pos.x - Pv.x, dz = m.pos.z - Pv.z;
        if (dx * dx + dz * dz < 196 && losClear(m)) return 1;   // 14 格内正被盯上
      }
      return 0;
    },
    _test: {
      densityTarget: densityTarget,
      diffLevel: diffLevel,
      currentPlanetKey: currentPlanetKey,
      trySpawn: trySpawn,
      ROLE: ROLE
    }
  };
})();
