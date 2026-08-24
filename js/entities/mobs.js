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
  // 猫：纤细身形 + 立耳/圆眼/粉鼻/上翘双段尾；4 种花色（橘猫带背纹、玄猫白尾尖、白猫、重点色布偶）
  var CAT_VARIANTS = [
    { fur: 0xd98e4a, accent: 0xb96f2e, muzzle: 0xe8b87d, eye: 0x6fae4e, legs: 0xc9833f, tailTip: 0xb96f2e, striped: true },  // 橘猫
    { fur: 0x37322f, accent: 0x2a2523, muzzle: 0x45403c, eye: 0xd9a53a, legs: 0x2e2a28, tailTip: 0xe8e4dc, striped: false }, // 玄猫
    { fur: 0xf3efe7, accent: 0xe3cdc5, muzzle: 0xffffff, eye: 0x5a8fd0, legs: 0xeae5db, tailTip: 0xf3efe7, striped: false }, // 白猫
    { fur: 0xcfc4b6, accent: 0x6e5d4f, muzzle: 0xdfd6ca, eye: 0x4a9ad8, legs: 0x6e5d4f, tailTip: 0x6e5d4f, striped: false }  // 布偶猫
  ];
  function catBuild() {
    var vi = (Math.random() * CAT_VARIANTS.length) | 0;
    var v = CAT_VARIANTS[vi];
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
    ];
    if (v.striped) {
      parts.push([0.30, 0.05, 0.09, 0, 0.49, -0.18, v.accent]);  // 背纹 ×3
      parts.push([0.30, 0.05, 0.09, 0, 0.49, 0.00, v.accent]);
      parts.push([0.26, 0.05, 0.09, 0, 0.49, 0.18, v.accent]);
    }
    return { variant: String(vi), w: 0.5, h: 0.75, mainColor: v.fur, parts: parts };
  }

  var BUILDERS = {
    sheep:   { make: sheepBuild,   hp: function () { return C.HP_SHEEP; },   speedMul: 1 },
    pig:     { make: pigBuild,     hp: function () { return C.HP_PIG; },     speedMul: 0.95 },
    chicken: { make: chickenBuild, hp: function () { return C.HP_CHICKEN; }, speedMul: 0.75 },
    rabbit:  { make: rabbitBuild,  hp: function () { return C.HP_RABBIT; },  speedMul: 1.35 },
    cat:     { make: catBuild,     hp: function () { return C.HP_CAT; },     speedMul: 1.1 },
    zombie:  { make: zombieBuild,  hp: function () { return C.HP_ZOMBIE; },  speedMul: 1 }
  };

  // 行为表与渲染构建器分离：合批只改变 Mesh 结构，不改变逃跑、声音和掉落语义。
  var PASSIVE = { sheep: true, pig: true, chicken: true, rabbit: true, cat: true };
  var KILL_DROPS = {
    sheep: [16, C.WOOL_DROP],
    pig: [109, 1],        // 生猪排
    chicken: [111, 1],    // 生鸡肉
    rabbit: [113, 1],     // 生兔肉
    cat: [121, C.CAT_FUR_DROP] // 猫毛（2 猫毛 → 1 猫毛毡）
  };
  var VOICE = { sheep: 'sheep', pig: 'pig', chicken: 'chicken', rabbit: 'rabbit', cat: 'cat', zombie: 'zombie' };
  var VOICE_HURT = { sheep: 'sheepHurt', pig: 'pigHurt', chicken: 'chickenHurt', rabbit: 'rabbitHurt', cat: 'catHurt' };

  var mobDensityF = 1;
  var TARGET_KEYS = {
    sheep: 'SHEEP_TARGET',
    pig: 'PIG_TARGET',
    chicken: 'CHICKEN_TARGET',
    rabbit: 'RABBIT_TARGET',
    cat: 'CAT_TARGET',
    zombie: 'ZOMBIE_TARGET'
  };

  // 各被动生物可生成的地表方块 + 是否允许出现在该群系（biomes.js 的 mobs 表）
  var PASSIVE_SURFACES = {
    sheep: [1, 18, 24],
    pig: [1, 2, 24],
    chicken: [1, 2, 24],
    rabbit: [1, 2, 6, 18, 24],
    cat: [1]
  };

  function spawn(type, pos) {
    var b = BUILDERS[type].make();
    var key = type + (b.variant ? '_' + b.variant : '');
    ensureSharedMats();
    var mesh = new THREE.Mesh(getGeo(key, b.parts), sharedMat);
    var m = {
      type: type,
      pos: pos.clone(),
      vel: new THREE.Vector3(),
      w: b.w, h: b.h,
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
    // 被动生物受击逃跑：转身背向玩家，加速逃离
    if (PASSIVE[m.type]) {
      m.fleeT = C.FLEE_TIME;
      m.fleeRepath = 0;
      m.moveTime = Math.max(m.moveTime, m.fleeT);
    }
    if (m.hp <= 0) kill(m);
  }

  function kill(m) {
    m.dead = true;
    Voxel.Sound.pop();
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

  function trySpawn(type) {
    var Pp = Voxel.Player.pos();
    var surfaces = PASSIVE_SURFACES[type];
    for (var a = 0; a < 12; a++) {
      var ang = Math.random() * Math.PI * 2;
      var dist = C.SPAWN_MIN + Math.random() * (C.SPAWN_MAX - C.SPAWN_MIN);
      var x = Math.floor(Pp.x + Math.cos(ang) * dist);
      var z = Math.floor(Pp.z + Math.sin(ang) * dist);
      var y = Voxel.World.surfaceAt(x, z);
      if (y < 3 || y >= H - 4) continue;
      // 地表方块匹配 + 群系允许该生物
      if (surfaces && surfaces.indexOf(Voxel.World.get(x, y, z)) < 0) continue;
      if (type !== 'zombie') {
        var bd = Voxel.Biomes.def(Voxel.World.biomeAt(x, z));
        if (!bd.mobs || bd.mobs.indexOf(type) < 0) continue;
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
    if ((counts.sheep || 0) < densityTarget('sheep')) trySpawn('sheep');
    if ((counts.pig || 0) < densityTarget('pig')) trySpawn('pig');
    if ((counts.chicken || 0) < densityTarget('chicken')) trySpawn('chicken');
    if ((counts.rabbit || 0) < densityTarget('rabbit')) trySpawn('rabbit');
    if ((counts.cat || 0) < densityTarget('cat')) trySpawn('cat');
    if (night && (counts.zombie || 0) < densityTarget('zombie')) trySpawn('zombie');
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

    for (var i = list.length - 1; i >= 0; i--) {
      var m = list[i];
      if (m.dead) { removeAt(i); continue; }

      m.aiTimer -= dt;
      m.moveTime -= dt;
      m.attackCd -= dt;

      var speed = 0;
      if (m.type === 'zombie' && alive) {
        var px = Pl.pos().x - m.pos.x;
        var pz = Pl.pos().z - m.pos.z;
        var dist = Math.sqrt(px * px + pz * pz);
        if (dist < C.ZOMBIE_RANGE && losClear(m)) {
          m.dir = Math.atan2(-px, -pz);
          m.moveTime = 1;
          speed = dist < 8 ? C.ZOMBIE_SPEED * 1.35 : C.ZOMBIE_SPEED;
          // 攻击需近距离、高度接近且视线无遮挡；命中带方向指示与击退
          if (dist < 1.6 && Math.abs(Pl.pos().y - m.pos.y) < 2.4 && m.attackCd <= 0) {
            m.attackCd = 1.2;
            Pl.damage(C.ZOMBIE_DMG, 'zombie', m.pos.x, m.pos.z);
            if (Pl.knockback) {
              var klen = Math.sqrt(px * px + pz * pz) || 1;
              Pl.knockback(px / klen, pz / klen, 8);
            }
          }
        }
      }
      if (speed === 0) {
        if (m.aiTimer <= 0) {
          m.aiTimer = 2 + Math.random() * 3.5;
          if (Math.random() < 0.3) { m.moveTime = 0; }
          else { m.dir = Math.random() * Math.PI * 2; m.moveTime = 1.5 + Math.random() * 2; }
        }
        if (m.moveTime > 0) speed = (m.type === 'zombie' ? C.ZOMBIE_SPEED * 0.7 : C.SHEEP_SPEED) * m.speedMul;
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
          Voxel.Sound[VOICE[m.type]](sp.vol * 0.8, sp.pan);
        }
      }

      // 渲染
      m.group.rotation.y = m.dir + Math.PI;
      // 走路整体轻微浮动（合批后无法单独动某一部件）
      m.group.position.set(
        m.pos.x,
        m.pos.y + ((speed > 0 && m.onGround) ? Math.sin(t * 9 + i) * 0.03 : 0),
        m.pos.z);

      // 白天烧僵尸（需露天：天光 ≥ 12，洞穴里不烧）
      if (m.type === 'zombie' && Voxel.DayNight.sunlight() > 0.55 &&
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
    spawnTimer = 1;
  }

  function init(scene) {
    group = new THREE.Group();
    scene.add(group);
  }

  return {
    setDensity: setDensity,
    init: init,
    update: update,
    applyTint: applyTint,
    damage: damage,
    clear: clear,
    list: list,
    count: function () { return list.length; },
    spawn: spawn,
    _test: {
      densityTarget: densityTarget
    }
  };
})();
