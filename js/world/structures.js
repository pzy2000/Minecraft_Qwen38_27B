// 外星巨型植物 + 废弃遗迹结构系统：纯逻辑、确定性、无 DOM / THREE / Math.random。
//
// 设计约束：
// 1. 只作用于 terrainVersion=2 行星的 legacy core 之外；旧存档地形逐位不变；
// 2. 结构描述符与方块集都是 (ctx, 全局坐标) 的纯函数，区块加载顺序不影响结果——
//    每个相交区块独立重算同一座遗迹，再由写入端按 inTarget 裁剪（与 decorate 的树一致）;
// 3. 遗迹箱子采用惰性战利品：生成时只放箱子方块不写容器元数据，首次开启时由
//    chestLootAt 反查锚点并按种子确定性生成内容，未互动的世界零存档开销。
window.Voxel = window.Voxel || {};

Voxel.Structures = (function () {
  var CFG = Voxel.Config;
  var W = CFG.WORLD_W, D = CFG.WORLD_D, H = CFG.WORLD_H;
  var WATER = CFG.WATER_LEVEL;

  // 稳定方块 ID（与 blocks.js 冻结契约一致）
  var BLK = {
    TORCH: 19, SNOW: 18, ICE: 32,
    STEM: 46, GLOW_CAP: 47, BASALT: 48, CORAL: 49,
    BRICK: 50, BRICK_MOSSY: 51, DEAD_WOOD: 52
  };
  // 行星专属晶矿方块/物品（planet_rules.js 冻结 ID）
  var CRYSTAL_BLOCK = { lush: 39, arid: 40, frozen: 41, toxic: 42, volcanic: 43, oceanic: 44 };
  var CRYSTAL_ITEM = { lush: 115, arid: 116, frozen: 117, toxic: 118, volcanic: 119, oceanic: 120 };
  var ITEM = {
    COAL: 107, IRON_PICK: 103, IRON_SWORD: 106,
    COOKED_PORK: 110, COOKED_CHICKEN: 112, COOKED_RABBIT: 114,
    WARP_CELL: 122
  };

  // ---- 巨型植物：每类行星一种招牌种，限定群系白名单 ----
  var B = Voxel.Biomes.B;
  var MEGA_FLORA = {
    toxic: { kind: 'shroom', chance: 0.0040, biomes: makeSet([B.JUNGLE, B.MEGA_TAIGA, B.SPARSE_JUNGLE]) },
    frozen: { kind: 'icespire', chance: 0.0035, biomes: makeSet([B.SNOWY, B.JAGGED_PEAKS]) },
    volcanic: { kind: 'basalt', chance: 0.0040, biomes: makeSet([B.BADLANDS, B.STONY_PEAKS, B.WINDSWEPT_HILLS]) },
    arid: { kind: 'deadtree', chance: 0.0032, biomes: makeSet([B.DESERT, B.SAVANNA, B.BADLANDS]) },
    oceanic: { kind: 'coral', chance: 0.0060, biomes: makeSet([B.SPARSE_JUNGLE]) }
  };

  // ---- 遗迹参数 ----
  var CELL = 96;              // 结构 cell 边长
  var EXTENT = 16;            // 结构最大半宽（含散石），用于扫描与核心禁区
  var RUIN_CELL_CHANCE = 1 / 3; // cell 命中概率；再经地形门控筛选后实际更稀
  var RUIN_BIOMES = makeSet([
    B.STONY_SHORE, B.PLAINS, B.FOREST, B.BIRCH_FOREST, B.DESERT, B.JUNGLE,
    B.SPARSE_JUNGLE, B.SAVANNA, B.TAIGA, B.MEGA_TAIGA, B.SNOWY,
    B.WINDSWEPT_HILLS, B.JAGGED_PEAKS, B.STONY_PEAKS, B.BADLANDS
  ]);
  var FOOTPRINT = 8;          // 围墙半宽（17×17）
  var FLAT_SAMPLES = [[0, 0], [FOOTPRINT, 0], [-FOOTPRINT, 0], [0, FOOTPRINT], [0, -FOOTPRINT]];

  function makeSet(ids) {
    var out = Object.create(null);
    for (var i = 0; i < ids.length; i++) out[ids[i]] = true;
    return out;
  }

  // ---- 世界上下文绑定（infinite.js init 时注入；Node 测试注入假查询） ----
  var ctx = null;
  function bind(c) {
    if (c && typeof c.hash2 === 'function' && typeof c.surfaceAt === 'function' &&
      typeof c.biomeAt === 'function') ctx = c;
    else ctx = null;
  }
  function enabled() { return !!(ctx && ctx.version === 2); }

  function h2(x, z) { return ctx ? ctx.hash2(x | 0, z | 0) : 0; }

  // ================= 巨型植物 =================

  function megaKind(typeKey, version, biomeId) {
    if (version !== 2 || !typeKey) return null;
    var m = MEGA_FLORA[typeKey];
    if (!m || !m.biomes[biomeId]) return null;
    return m;
  }

  // pen: { force(x,y,z,id), air(x,y,z,id) } —— 由调用方绑定写入语义。
  function buildMega(m, pen, x, h, z, r) {
    if (!m || !pen || r < 0 || r >= 1) return false;
    var rr = (r * 100000) | 0;
    if (m.kind === 'shroom') return buildShroom(pen, x, h, z, rr);
    if (m.kind === 'icespire') return buildIceSpire(pen, x, h, z, rr);
    if (m.kind === 'basalt') return buildBasaltCluster(pen, x, h, z, rr);
    if (m.kind === 'deadtree') return buildDeadTree(pen, x, h, z, rr);
    if (m.kind === 'coral') return buildCoralTower(pen, x, h, z, rr);
    return false;
  }

  // 巨型荧光菇：外星茎干主干 + 荧光菌伞穹顶（夜晚自发光地标）
  function buildShroom(pen, x, h, z, rr) {
    var th = 6 + rr % 5;
    if (h + th + 4 >= H) th = H - 5 - h;
    if (th < 5) return false;
    for (var y = 1; y <= th; y++) pen.force(x, h + y, z, BLK.STEM);
    disc(pen, x, h + th, z, 3, BLK.GLOW_CAP, true);
    disc(pen, x, h + th + 1, z, 2, BLK.GLOW_CAP, true, true);
    pen.air(x, h + th + 2, z, BLK.GLOW_CAP);
    return true;
  }

  // 冰晶尖塔：浮冰渐缩塔身 + 雪顶
  function buildIceSpire(pen, x, h, z, rr) {
    var th = 9 + rr % 6;
    if (h + th + 2 >= H) th = H - 3 - h;
    if (th < 6) return false;
    for (var y = 1; y <= th; y++) {
      var rem = th - y;
      var rad = rem <= 1 ? 0 : (rem < th * 0.45 ? 1 : 2);
      disc(pen, x, h + y, z, rad, BLK.ICE, false);
      if (rad > 0 && (y % 5 === 0)) pen.force(x, h + y, z, BLK.SNOW);
    }
    pen.force(x, h + th + 1, z, BLK.SNOW);
    return true;
  }

  // 玄武柱丛：2–4 根错落玄武岩柱
  function buildBasaltCluster(pen, x, h, z, rr) {
    var n = 2 + rr % 3;
    var ok = false;
    for (var i = 0; i < n; i++) {
      var ox = ((rr * (i * 7 + 13)) % 5) - 2;
      var oz = ((rr * (i * 11 + 29)) % 5) - 2;
      var hh = 4 + ((rr >> (i + 3)) % 7);
      if (h + hh + 1 >= H) continue;
      for (var y = 1; y <= hh; y++) {
        pen.force(x + ox, h + y, z + oz, BLK.BASALT);
        if (y > 1) pen.force(x + ox + (ox >= 0 ? -1 : 1), h + y, z + oz, BLK.BASALT);
      }
      ok = true;
    }
    return ok;
  }

  // 枯巨树：光秃主干 + 裸枝
  function buildDeadTree(pen, x, h, z, rr) {
    var th = 7 + rr % 6;
    if (h + th + 2 >= H) th = H - 3 - h;
    if (th < 6) return false;
    for (var y = 1; y <= th; y++) pen.force(x, h + y, z, BLK.DEAD_WOOD);
    var branches = 2 + rr % 2;
    for (var b = 0; b < branches; b++) {
      var by = th - 1 - (b % 3);
      var dir = (b + (rr & 3)) & 3;
      var dx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
      var dz = dir === 2 ? 1 : dir === 3 ? -1 : 0;
      pen.air(x + dx, h + by, z + dz, BLK.DEAD_WOOD);
      pen.air(x + dx * 2, h + by + (b & 1), z + dz * 2, BLK.DEAD_WOOD);
    }
    pen.air(x, h + th + 1, z, BLK.DEAD_WOOD);
    return true;
  }

  // 珊瑚塔：暖色珊瑚短塔 + 侧生息肉
  function buildCoralTower(pen, x, h, z, rr) {
    var th = 5 + rr % 5;
    if (h + th + 2 >= H) th = H - 3 - h;
    if (th < 4) return false;
    for (var y = 1; y <= th; y++) {
      pen.force(x, h + y, z, BLK.CORAL);
      if (y <= th - 2) pen.force(x + 1, h + y, z, BLK.CORAL);
    }
    var knobs = 2 + rr % 3;
    for (var k = 0; k < knobs; k++) {
      var ky = 2 + ((rr >> (k + 2)) % Math.max(1, th - 2));
      var kdir = (k + (rr & 3)) & 3;
      pen.air(x + (kdir === 0 ? 2 : kdir === 1 ? -1 : 0), h + ky,
        z + (kdir === 2 ? 2 : kdir === 3 ? -1 : 0), BLK.CORAL);
    }
    return true;
  }

  function disc(pen, cx, cy, cz, rad, id, airOnly, cutCorners) {
    for (var dx = -rad; dx <= rad; dx++) for (var dz = -rad; dz <= rad; dz++) {
      if (cutCorners && Math.abs(dx) === rad && Math.abs(dz) === rad) continue;
      var d2 = dx * dx + dz * dz;
      if (d2 > rad * rad + rad * 0.5) continue;
      if (airOnly) pen.air(cx + dx, cy, cz + dz, id);
      else pen.force(cx + dx, cy, cz + dz, id);
    }
  }

  // ================= 废弃遗迹 =================

  // 每个 cell 至多一座遗迹；描述符完全由 (cell 哈希, 地形查询) 决定。
  function cellRuin(cellX, cellZ) {
    if (!enabled()) return null;
    var roll = h2(cellX * 73 + 101, cellZ * 137 + 57);
    if (roll >= RUIN_CELL_CHANCE) return null;
    var ax = cellX * CELL + 20 + ((h2(cellX * 31 + 7, cellZ * 29 + 13) * 56) | 0);
    var az = cellZ * CELL + 20 + ((h2(cellX * 17 + 41, cellZ * 23 + 3) * 56) | 0);
    // legacy core 禁区：结构整体不得与核心矩形相交
    if (!(ax + EXTENT < 0 || ax - EXTENT >= W || az + EXTENT < 0 || az - EXTENT >= D)) return null;
    var ah = ctx.surfaceAt(ax, az);
    if (ah <= WATER + 1 || ah > Voxel.Biomes.SNOW_LEVEL - 4 || ah + VAULT_WALL + 2 >= H) return null;
    if (!RUIN_BIOMES[ctx.biomeAt(ax, az)]) return null;
    for (var i = 0; i < FLAT_SAMPLES.length; i++) {
      var hs = ctx.surfaceAt(ax + FLAT_SAMPLES[i][0], az + FLAT_SAMPLES[i][1]);
      if (hs <= WATER + 1 || Math.abs(hs - ah) > 2) return null;
    }
    return {
      ax: ax, az: az, ah: ah,
      variant: (h2(ax * 5 + 91, az * 7 + 17) * 1024) | 0
    };
  }

  var VAULT_HALF = 3;   // 宝库内室半宽（7×7 外墙）
  var VAULT_WALL = 4;   // 宝库墙高

  // 塔楼规格（builder 与箱子反查共用，保证一致）
  function towerSpec(ruin) {
    var has = (ruin.variant & 3) !== 0; // 75% 有塔楼
    if (!has) return null;
    return { tx: ruin.ax - FOOTPRINT + 1, tz: ruin.az - FOOTPRINT + 1, rad: 3 };
  }

  // 遗迹箱子列表：主宝库箱必出；塔楼底 50% 出副箱
  function ruinChests(ruin) {
    var out = [{ x: ruin.ax, y: ruin.ah + 1, z: ruin.az, index: 0 }];
    var t = towerSpec(ruin);
    if (t && (ruin.variant & 4) !== 0)
      out.push({ x: t.tx, y: ruin.ah + 1, z: t.tz, index: 1 });
    return out;
  }

  // 把整座遗迹枚举为方块操作流。writer(x,y,z,id,mode)：mode 'force'|'air'。
  // 必须只依赖 (ruin, 常量)；禁止读取任何"已写内容"，保证跨区块一致。
  function buildRuin(ruin, writer) {
    if (!ruin || typeof writer !== 'function') return;
    var ax = ruin.ax, az = ruin.az, ah = ruin.ah;
    var mossP = mossChance(ruin);
    var brick = pickBrick(ruin);

    // 地板：整个 footprint 一层石砖（含墙基）
    for (var fx = ax - FOOTPRINT; fx <= ax + FOOTPRINT; fx++)
      for (var fz = az - FOOTPRINT; fz <= az + FOOTPRINT; fz++)
        writer(fx, ah, fz, brick, 'force');

    // 外圈残墙：高度 2..4，15% 整段坍塌（宝库外墙除外）
    for (var wx = ax - FOOTPRINT; wx <= ax + FOOTPRINT; wx++) {
      for (var wz = az - FOOTPRINT; wz <= az + FOOTPRINT; wz++) {
        var onRing = Math.abs(wx - ax) === FOOTPRINT || Math.abs(wz - az) === FOOTPRINT;
        if (!onRing) continue;
        var inVault = Math.abs(wx - ax) <= VAULT_HALF && Math.abs(wz - az) <= VAULT_HALF &&
          (Math.abs(wx - ax) === VAULT_HALF || Math.abs(wz - az) === VAULT_HALF);
        if (inVault) continue; // 宝库墙稍后单独建
        var colHash = h2(wx * 41 + 3, wz * 43 + 77);
        if (colHash < 0.15) continue; // 坍塌缺口
        var wh = 2 + ((colHash * 1000) | 0) % 3;
        wallColumn(writer, wx, ah, wz, wh, brick, mossP, ruin);
      }
    }

    // 中央宝库：7×7 满高外墙 + 局部塌陷屋顶 + 室内清空 + 火把
    for (var vx = ax - VAULT_HALF; vx <= ax + VAULT_HALF; vx++) {
      for (var vz = az - VAULT_HALF; vz <= az + VAULT_HALF; vz++) {
        var perimeter = Math.abs(vx - ax) === VAULT_HALF || Math.abs(vz - az) === VAULT_HALF;
        if (perimeter) {
          wallColumn(writer, vx, ah, vz, VAULT_WALL, brick, mossP, ruin);
        } else {
          for (var iy = 1; iy <= VAULT_WALL; iy++) writer(vx, ah + iy, vz, 0, 'force');
        }
        // 屋顶：25% 破洞
        var roofHash = h2(vx * 97 + 19, vz * 89 + 53);
        if (roofHash >= 0.25) writer(vx, ah + VAULT_WALL + 1, vz, brick, 'force');
      }
    }
    // 宝库火把（室内照明）
    writer(ax - 2, ah + 1, az - 2, BLK.TORCH, 'air');
    writer(ax + 2, ah + 1, az + 2, BLK.TORCH, 'air');
    // 主箱：宝库正中
    writer(ax, ah + 1, az, 38, 'air');

    // 角塔：环形塔壁、高低错落的断裂塔缘、中空
    var t = towerSpec(ruin);
    if (t) {
      var thMax = 9 + (ruin.variant & 7);
      for (var ddx = -t.rad; ddx <= t.rad; ddx++) {
        for (var ddz = -t.rad; ddz <= t.rad; ddz++) {
          var dist2 = ddx * ddx + ddz * ddz;
          if (dist2 > t.rad * t.rad + 1) continue;
          var edge = dist2 >= (t.rad - 1) * (t.rad - 1) + 1;
          var twx = t.tx + ddx, twz = t.tz + ddz;
          if (edge) {
            var rimHash = h2(twx * 61 + 23, twz * 67 + 31);
            var th = 4 + ((rimHash * 1000) | 0) % (thMax - 3);
            wallColumn(writer, twx, ah, twz, th, brick, mossP, ruin);
          } else {
            for (var ty = 1; ty <= 3; ty++) writer(twx, ah + ty, twz, 0, 'force'); // 中空底座
          }
        }
      }
      // 塔楼副箱
      if ((ruin.variant & 4) !== 0) writer(t.tx, ah + 1, t.tz, 38, 'air');
    }

    // 外围散石：10–14 枚苔痕砖点缀
    var rubbleCount = 10 + (ruin.variant & 3);
    for (var ri = 0; ri < rubbleCount; ri++) {
      var ang = h2(ruin.ax * 211 + ri * 17, ruin.az * 223 + ri * 29) * Math.PI * 2;
      var dist = 9 + h2(ruin.ax * 307 + ri * 37, ruin.az * 311 + ri * 41) * 3;
      var rxp = ax + Math.round(Math.cos(ang) * dist);
      var rzp = az + Math.round(Math.sin(ang) * dist);
      var rhs = ctx ? ctx.surfaceAt(rxp, rzp) : ah;
      if (Math.abs(rhs - ah) <= 2) writer(rxp, rhs + 1, rzp, BLK.BRICK_MOSSY, 'air');
    }
  }

  function wallColumn(writer, x, groundY, z, height, brick, mossP, ruin) {
    for (var y = 1; y <= height; y++) {
      var id = brick;
      if (y === height && h2(x * 53 + y, z * 59 + y * 7) < mossP * 2) id = BLK.BRICK_MOSSY;
      else if (accentRoll(ruin, x, y, z)) id = crystalBlock(ruin);
      writer(x, groundY + y, z, id, 'force');
    }
  }

  function mossChance() { return 0.25; }
  function pickBrick(ruin) { return (ruin.variant & 64) !== 0 ? BLK.BRICK_MOSSY : BLK.BRICK; }
  function accentRoll(ruin, x, y, z) { return h2(x * 71 + y * 13, z * 79 + 5) < 0.05; }
  function crystalBlock(ruin) { return CRYSTAL_BLOCK[typeKeyOf()] || BLK.BRICK; }
  function typeKeyOf() { return ctx && ctx.typeKey ? ctx.typeKey : 'lush'; }

  // ================= 战利品 =================

  // 确定性加权掉落：主箱必出曲速电池；工具带随机剩余耐久。
  function lootFor(ruin, index) {
    if (!enabled() || !ruin) return null;
    var items = new Array(27).fill(null);
    var saltBase = ruin.ax * 7919 + ruin.az * 104729 + index * 131071;
    function roll(salt) { return h2(saltBase + salt * 6553, ruin.variant + salt * 3571); }

    var cursor = 4;
    function put(id, n, dur) {
      for (var guard = 0; guard < 27; guard++) {
        if (cursor >= 27) cursor = 0;
        if (!items[cursor]) break;
        cursor++;
      }
      if (!items[cursor]) items[cursor] = { id: id, n: n, dur: dur === undefined ? null : dur };
      cursor++;
    }

    // 主箱：电池必出 + 高阶装备
    put(ITEM.WARP_CELL, 1);
    if (index === 0) {
      var toolId = roll(1) < 0.55 ? ITEM.IRON_PICK : ITEM.IRON_SWORD;
      var maxDur = toolId === ITEM.IRON_PICK ? 251 : 251;
      var remain = Math.max(1, Math.round(maxDur * (0.72 + roll(2) * 0.28)));
      put(toolId, 1, remain);
      var crys = CRYSTAL_ITEM[typeKeyOf()] || CRYSTAL_ITEM.lush;
      put(crys, 3 + ((roll(3) * 6) | 0));
      put(ITEM.COAL, 5 + ((roll(4) * 8) | 0));
      var meats = [ITEM.COOKED_PORK, ITEM.COOKED_CHICKEN, ITEM.COOKED_RABBIT];
      put(meats[(roll(5) * 3) | 0], 2 + ((roll(6) * 3) | 0));
    } else {
      var crys2 = CRYSTAL_ITEM[typeKeyOf()] || CRYSTAL_ITEM.lush;
      put(crys2, 1 + ((roll(3) * 3) | 0));
      put(ITEM.COAL, 3 + ((roll(4) * 4) | 0));
      var meats2 = [ITEM.COOKED_PORK, ITEM.COOKED_CHICKEN, ITEM.COOKED_RABBIT];
      put(meats2[(roll(5) * 3) | 0], 1 + ((roll(6) * 2) | 0));
    }
    return items;
  }

  // 反查：给定坐标是否是某遗迹的箱子位；是则返回确定性战利品。
  function chestLootAt(x, y, z) {
    if (!enabled()) return null;
    var c0x = Math.floor((x - EXTENT) / CELL), c1x = Math.floor((x + EXTENT) / CELL);
    var c0z = Math.floor((z - EXTENT) / CELL), c1z = Math.floor((z + EXTENT) / CELL);
    for (var cx = c0x; cx <= c1x; cx++) {
      for (var cz = c0z; cz <= c1z; cz++) {
        var ruin = cellRuin(cx, cz);
        if (!ruin) continue;
        var chests = ruinChests(ruin);
        for (var i = 0; i < chests.length; i++) {
          if (chests[i].x === x && chests[i].y === y && chests[i].z === z)
            return lootFor(ruin, chests[i].index);
        }
      }
    }
    return null;
  }

  // 测试辅助：从某坐标附近向外搜索最近的有效遗迹（真实地形门控）。
  function findRuinNear(x, z, maxCells) {
    if (!enabled()) return null;
    var baseCx = Math.floor(x / CELL), baseCz = Math.floor(z / CELL);
    var limit = Math.max(1, maxCells | 0);
    for (var ring = 0; ring <= limit; ring++) {
      for (var dx = -ring; dx <= ring; dx++) {
        for (var dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          var ruin = cellRuin(baseCx + dx, baseCz + dz);
          if (ruin) return ruin;
        }
      }
    }
    return null;
  }

  return {
    CELL: CELL,
    EXTENT: EXTENT,
    bind: bind,
    enabled: enabled,
    megaKind: megaKind,
    buildMega: buildMega,
    cellRuin: cellRuin,
    ruinChests: ruinChests,
    buildRuin: buildRuin,
    lootFor: lootFor,
    chestLootAt: chestLootAt,
    findRuinNear: findRuinNear
  };
})();
