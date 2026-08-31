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
    WARP_CELL: 122, PARK_TOKEN: 132
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

  // 反查：给定坐标是否是某遗迹/村落/地窖/乐园售票亭的箱子位；是则返回确定性战利品。
  function chestLootAt(x, y, z) {
    if (!enabled()) return null;
    var c0x = Math.floor((x - EXTENT) / CELL), c1x = Math.floor((x + EXTENT) / CELL);
    var c0z = Math.floor((z - EXTENT) / CELL), c1z = Math.floor((z + EXTENT) / CELL);
    for (var cx = c0x; cx <= c1x; cx++) {
      for (var cz = c0z; cz <= c1z; cz++) {
        // 地窖：与遗迹共用 CELL 网格（先于遗迹的 !ruin 早退检查）
        var dg = cellDungeon(cx, cz);
        if (dg) {
          var dchest = dungeonChest(dg);
          if (dchest.x === x && dchest.y === y && dchest.z === z)
            return dungeonLootFor(dg);
        }
        var ruin = cellRuin(cx, cz);
        if (!ruin) continue;
        var chests = ruinChests(ruin);
        for (var i = 0; i < chests.length; i++) {
          if (chests[i].x === x && chests[i].y === y && chests[i].z === z)
            return lootFor(ruin, chests[i].index);
        }
      }
    }
    // 村落宝箱（cell 更大，扫描窗口独立）
    var vc0x = Math.floor((x - VILLAGE_EXTENT) / VILLAGE_CELL), vc1x = Math.floor((x + VILLAGE_EXTENT) / VILLAGE_CELL);
    var vc0z = Math.floor((z - VILLAGE_EXTENT) / VILLAGE_CELL), vc1z = Math.floor((z + VILLAGE_EXTENT) / VILLAGE_CELL);
    for (var vx2 = vc0x; vx2 <= vc1x; vx2++) {
      for (var vz2 = vc0z; vz2 <= vc1z; vz2++) {
        var vil = cellVillage(vx2, vz2);
        if (!vil) continue;
        var vchests = villageChests(vil);
        for (var vi = 0; vi < vchests.length; vi++) {
          if (vchests[vi].x === x && vchests[vi].y === y && vchests[vi].z === z)
            return villageLootFor(vil, vchests[vi].index);
        }
      }
    }
    // 星海嘉年华售票亭宝箱反查
    var p0x = Math.floor((x - PARK_EXTENT) / PARK_CELL), p1x = Math.floor((x + PARK_EXTENT) / PARK_CELL);
    var p0z = Math.floor((z - PARK_EXTENT) / PARK_CELL), p1z = Math.floor((z + PARK_EXTENT) / PARK_CELL);
    for (var px3 = p0x; px3 <= p1x; px3++) {
      for (var pz3 = p0z; pz3 <= p1z; pz3++) {
        var park = cellPark(px3, pz3);
        if (!park) continue;
        var pchests = parkChests(park);
        for (var pi = 0; pi < pchests.length; pi++) {
          if (pchests[pi].x === x && pchests[pi].y === y && pchests[pi].z === z)
            return parkLootFor(park, pchests[pi].index);
        }
      }
    }
    // 北欧城堡主厅宝箱反查
    var vx0 = Math.floor((x - VISTA_EXTENT) / VISTA_CELL), vx1 = Math.floor((x + VISTA_EXTENT) / VISTA_CELL);
    var vz0 = Math.floor((z - VISTA_EXTENT) / VISTA_CELL), vz1 = Math.floor((z + VISTA_EXTENT) / VISTA_CELL);
    for (var vcx = vx0; vcx <= vx1; vcx++) {
      for (var vcz = vz0; vcz <= vz1; vcz++) {
        var vista = cellVista(vcx, vcz);
        if (!vista) continue;
        var vchests2 = vistaChests(vista);
        for (var vi2 = 0; vi2 < vchests2.length; vi2++) {
          if (vchests2[vi2].x === x && vchests2[vi2].y === y && vchests2[vi2].z === z)
            return vistaLootFor(vista, vchests2[vi2].index);
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

  // ================= 星海嘉年华（乐园园区，v7） =================

  // 园区 cell：单个园区极大（半径 ~90），cell 取大保证相邻园区永不接壤。
  // 描述符同样为纯函数；六个设施的静态体素与运行时动画共用 parkStations()
  // 这一份参数事实源，保证轨道样条/轮心与静态支柱永远一致。
  var PARK_CELL = 320;
  var PARK_EXTENT = 100;      // 园区最大半宽（含城堡尖塔基座散景），扫描与禁区用
  // 园区密度完全由群系斑块决定：cell 内只要有合格点位就落园（roll 门控会
  // 把大量嘉年华群系斑块滤成"有地貌无园区"，体验割裂，已移除）。
  var PARK_CELL_CHANCE = 1;
  // 锚点高度带：园内最高点 = ah + CASTLE_SPIRE(52) ≈ 108 < CONTENT_NATURAL_TOP(116)
  var PARK_AH_MAX = 46;
  var PARK_BIOME = B.PLAYGROUND;
  var PARK_FLAT_SAMPLES = [[0, 0], [-70, 0], [70, 0], [0, -74], [0, 70]];
  var PARK_CORE_SAMPLES = [[-40, 0], [40, 0], [0, -44], [0, 42]];

  var PK = {
    LAWN: 74, CREAM: 75, PASTEL: 76, CANDY: 77, GOLD: 78, LANTERN: 79,
    RAIL: 80, ROOF: 81, NEON_P: 82, NEON_C: 83, BUNTING: 84, PAD: 85,
    PINK: 86, BLUE: 87,
    STONE: 3, DIRT: 2, GRASS: 1, PLANKS: 10, GLASS: 13, CHEST: 38,
    LOG: 4, LEAVES: 5, SANDSTONE: 27
  };

  function parkSiteAt(ax, az) {
    var ah = ctx.surfaceAt(ax, az);
    if (ah <= WATER + 2 || ah > PARK_AH_MAX) return false;
    // 锚点必须落在嘉年华群系（作为"园区种子"）；周围地形允许是任何干地邻域
    // —— 园区自带找平地基，铺满游乐草坪后自成一体。
    if (ctx.biomeAt(ax, az) !== PARK_BIOME) return false;
    // 地形平坦校验：远圈（含门外散景）±4，近圈（设施基座带）±3
    for (var i = 0; i < PARK_FLAT_SAMPLES.length; i++) {
      var hs = ctx.surfaceAt(ax + PARK_FLAT_SAMPLES[i][0], az + PARK_FLAT_SAMPLES[i][1]);
      if (hs <= WATER + 1 || Math.abs(hs - ah) > 4) return false;
    }
    for (var k = 0; k < PARK_CORE_SAMPLES.length; k++) {
      var ks = ctx.surfaceAt(ax + PARK_CORE_SAMPLES[k][0], az + PARK_CORE_SAMPLES[k][1]);
      if (ks <= WATER + 2 || Math.abs(ks - ah) > 3) return false;
    }
    return true;
  }

  // 园区锚点：cell 命中后在其内做确定性网格扫描（步长 14、固定顺序），
  // 取第一个通过完整门控的点位。群系域狭长时也能稳定落园；
  // 扫描顺序完全由 cell 哈希决定，与区块加载顺序无关。
  function cellPark(cellX, cellZ) {
    if (!enabled()) return null;
    var roll = h2(cellX * 179 + 43, cellZ * 211 + 91);
    if (roll >= PARK_CELL_CHANCE) return null;
    var PROBE_STEP = 12;
    // 探针铺满整个 cell 的"内接缓冲区"，保证相邻园区的占地范围永不交叠；
    // 首个命中即返回。
    var x0p = cellX * PARK_CELL + PARK_EXTENT;
    var z0p = cellZ * PARK_CELL + PARK_EXTENT;
    var spanP = PARK_CELL - 2 * PARK_EXTENT;
    if (spanP < PROBE_STEP) return null;
    var cols = Math.floor(spanP / PROBE_STEP);
    for (var pi2 = 0; pi2 <= cols; pi2++) {
      for (var pj2 = 0; pj2 <= cols; pj2++) {
        var sx = x0p + pi2 * PROBE_STEP;
        var sz = z0p + pj2 * PROBE_STEP;
        // legacy core 禁区：整体不得与核心矩形相交（其余外围区域全合法）
        if (!(sx + PARK_EXTENT < 0 || sx - PARK_EXTENT >= W ||
          sz + PARK_EXTENT < 0 || sz - PARK_EXTENT >= D)) continue;
        if (!parkSiteAt(sx, sz)) continue;
        var ah = ctx.surfaceAt(sx, sz);
        return {
          ax: sx, az: sz, ah: ah,
          rot: (h2(sx * 137 + 5, sz * 149 + 41) * 4) | 0,
          variant: (h2(sx * 257 + 17, sz * 263 + 63) * 4096) | 0
        };
      }
    }
    return null;
  }

  // 局部坐标 -> 全局坐标（绕锚点 0/90/180/270° 旋转换向，保持体素网格对齐）
  function PX(park, dx, dz) {
    switch (park.rot & 3) {
      case 1: return [park.ax + dz, park.az - dx];
      case 2: return [park.ax - dx, park.az - dz];
      case 3: return [park.ax - dz, park.az + dx];
      default: return [park.ax + dx, park.az + dz];
    }
  }

  // 六设施 + 大门 + 售票亭的单一事实源：builder 与运行时动画共同消费。
  // 坐标语义：局部 (dx,dz)，y 一律相对锚点地表 ah。
  function parkLayout() {
    return {
      gateDx: 0, gateDz: 64,
      boothL: [-9, 57], boothR: [9, 57],
      fountain: [0, 0],
      ferris: { c: [-46, 12], board: [-45, 21], R: 24, hubY: 30, cabins: 18 },
      carousel: { c: [14, -10], board: [14, -2], R: 5 },
      drop: { c: [34, 26], board: [27, 26], towerH: 54 },
      castle: { c: [-46, -44] },
      pirate: { c: [-28, 34], board: [-21, 34], R: 13, axleY: 15 },
      coaster: {
        c: [16, -52],
        board: [10, -30],
        peakY: 30,
        // 螺旋爬升贴台地：各环表面 dy=0/7/14/21/27，轨道控制 y 须保持
        // 环上 ≥ dy+1、翻墙段中点曲线高 ≥ 上层 dy（否则列车埋进山体）
        controls: [
          [10, -30, 0], [14, -26, 1], [22, -32, 7],    // 草坪爬升（c2 外移抬高：出发段即越环1界时保持 eye≥ah+9）
          [33, -43, 12], [34, -52, 12],                // 环1（表面 ah+7，翻墙段抬高防 Catmull 下沉切 riser）
          [30, -58, 17], [20, -62, 17], [12, -60, 22], // 环2（表面 ah+14）→ 翻环3墙
          [8, -52, 24], [10, -44, 24],                 // 环3（表面 ah+21）
          [16, -52, 28],                               // 峰顶（台面 ah+27）
          [26, -56, 23], [36, -50, 12], [42, -40, 8],  // 外侧俯冲（c8 抬高跨环3台面）
          [44, -28, 6], [40, -14, 4], [30, -6, 3],
          [18, -14, 3], [7, -24, 3], [10, -26, 1], [10, -30, 0] // 回站：西绕跨灯柱（顶ah+3）→ 雨棚北沿已降至 eye<ah+4，沿 x=10 中线低穿（立柱在 x8/x14）
        ]
      },
      tron: { gx0: 42, gx1: 84, gz: 6, board: [46, 6], loopTopY: 22 },
      // 套圈游戏：中轴大门正前（10,42）——进门南行即达，路标塔正对大门
      toss: { cx: 10, cz: 42 }
    };
  }

  function parkStations(park) {
    if (!park) return null;
    var L = parkLayout();
    var ah = park.ah;
    function X(d) { return PX(park, d[0], d[1]); }
    var ferris = X(L.ferris.c);
    var fBoard = X(L.ferris.board);
    var carousel = X(L.carousel.c);
    var carBoard = X(L.carousel.board);
    var drop = X(L.drop.c);
    var drBoard = X(L.drop.board);
    var cBoard = X(L.coaster.board);
    var tBoard = X(L.tron.board);
    var ctr = [];
    for (var i = 0; i < L.coaster.controls.length; i++) {
      var cp = X(L.coaster.controls[i]);
      ctr.push([cp[0], ah + L.coaster.controls[i][2], cp[1]]); // [x, y, z]
    }
    var pirC = X(L.pirate.c);
    var pirB = X(L.pirate.board);
    return [
      {
        kind: 'ferris', name: '摩天轮',
        cx: ferris[0], cz: ferris[1], hubY: ah + L.ferris.hubY,
        R: L.ferris.R, cabins: L.ferris.cabins, periodS: 42,
        board: { x: fBoard[0], y: ah + 1, z: fBoard[1] }
      },
      {
        kind: 'carousel', name: '旋转木马',
        cx: carousel[0], cz: carousel[1], baseY: ah + 1,
        R: L.carousel.R, periodS: 18,
        board: { x: carBoard[0], y: ah + 1, z: carBoard[1] }
      },
      {
        kind: 'drop', name: '跳楼机',
        cx: drop[0], cz: drop[1], baseY: ah, towerH: L.drop.towerH, periodS: 22,
        board: { x: drBoard[0], y: ah + 1, z: drBoard[1] }
      },
      {
        kind: 'pirate', name: '海盗船',
        cx: pirC[0], cz: pirC[1], baseY: ah,
        R: L.pirate.R, axleY: L.pirate.axleY, periodS: 14,
        board: { x: pirB[0], y: ah + 1, z: pirB[1] }
      },
      {
        kind: 'coaster', name: '矿山过山车',
        path: ctr, periodS: 52,
        board: { x: cBoard[0], y: ah + 1, z: cBoard[1] }
      },
      {
        kind: 'tron', name: '创极速光轮',
        g0: PX(park, L.tron.gx0, L.tron.gz),
        g1: PX(park, L.tron.gx1, L.tron.gz),
        baseY: ah, loopTopY: ah + L.tron.loopTopY, periodS: 16,
        board: { x: tBoard[0], y: ah + 1, z: tBoard[1] }
      },
      {
        kind: 'castle', name: '童话城堡',
        c: PX(park, L.castle.c[0], L.castle.c[1]), baseY: ah
      }
    ];
  }

  // 套圈游戏站点：投掷点 + 3 目标柱世界坐标（运行时命中判定/verify 断言共用）
  // 柱在 dz 正方向（园心侧），玩家在投掷线朝 -dz 投
  function parkTossStall(park) {
    if (!park) return null;
    var L = parkLayout();
    var ah = park.ah;
    var origin = PX(park, L.toss.cx, L.toss.cz);
    var pegs = [
      { dx: 0, dz: 8, h: 2, score: 2 },
      { dx: -6, dz: 11, h: 3, score: 3 },
      { dx: 6, dz: 14, h: 4, score: 5 }
    ].map(function (pg) {
      var p = PX(park, L.toss.cx + pg.dx, L.toss.cz + pg.dz);
      return { x: p[0], z: p[1], baseY: ah + 1, topY: ah + 1 + pg.h, score: pg.score };
    });
    return { x: origin[0], z: origin[1], y: ah, pegs: pegs };
  }

  function boardPositions(park) {
    var st = parkStations(park);
    return st.filter(function (s) { return s.board; })
      .map(function (s) { return { kind: s.kind, name: s.name, x: s.board.x, y: s.board.y, z: s.board.z }; });
  }

  // 售票亭交互点（左右亭门前各一）：票券经济兑换面板的接近判定源
  function parkBooths(park) {
    if (!park) return [];
    var L = parkLayout();
    return [L.boothL, L.boothR].map(function (b) {
      var p = PX(park, b[0], b[1]);
      return { x: p[0], y: park.ah + 1, z: p[1] };
    });
  }

  // 精选世界出生点：大门外 5 格的干燥安全列，面向园内（穿过拱廊即见喷泉广场）。
  function parkGateSpawn(park) {
    if (!park || !ctx) return null;
    var L = parkLayout();
    var gz = L.gateDz + 5;
    var p = PX(park, 0, gz);
    var gy = ctx.surfaceAt(p[0], p[1]);
    if (gy <= WATER + 1 || Math.abs(gy - park.ah) > 6) gy = park.ah;
    var inP = PX(park, 0, L.gateDz - 3);
    var dx = inP[0] - p[0], dz = inP[1] - p[1];
    return { x: p[0] + 0.5, y: gy + 1.2, z: p[1] + 0.5, yaw: Math.atan2(-dx, -dz) };
  }

  // 从某点向外扩环枚举 cell，返回距该点最近的园区（main.js 精选出生用）。
  function nearestParkTo(x, z, maxCells) {
    if (!enabled()) return null;
    var baseCx = Math.floor(x / PARK_CELL), baseCz = Math.floor(z / PARK_CELL);
    var limit = Math.max(0, maxCells | 0);
    var best = null, bestD = Infinity;
    for (var ring = 0; ring <= limit && !best; ring++)
      for (var dx = -ring; dx <= ring; dx++)
        for (var dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          var park = cellPark(baseCx + dx, baseCz + dz);
          if (!park) continue;
          var d = Math.abs(park.ax - x) + Math.abs(park.az - z);
          if (d < bestD) { bestD = d; best = park; }
        }
    return best;
  }

  // 售票亭宝箱（左亭一枚；首开惰性发奖）
  function parkChests(park) {
    var L = parkLayout();
    var p = PX(park, L.boothL[0], L.boothL[1]);
    return [{ x: p[0], y: park.ah + 1, z: p[1], index: 0 }];
  }

  function parkLootFor(park, index) {
    if (!enabled() || !park) return null;
    var items = new Array(27).fill(null);
    var saltBase = park.ax * 6271 + park.az * 94793 + index * 7607;
    var cursor = 3;
    function roll(salt) { return h2(saltBase + salt * 6971, park.variant + salt * 4099); }
    function put(id, n, dur) {
      for (var guard = 0; guard < 27 && items[cursor]; guard++) cursor = (cursor + 1) % 27;
      if (!items[cursor]) items[cursor] = { id: id, n: n, dur: dur === undefined ? null : dur };
      cursor++;
    }
    put(ITEM.COOKED_PORK, 3 + ((roll(1) * 3) | 0));
    put(ITEM.COAL, 4 + ((roll(2) * 6) | 0));
    var crys = CRYSTAL_ITEM[typeKeyOf()] || CRYSTAL_ITEM.lush;
    put(crys, 2 + ((roll(3) * 4) | 0));
    put(ITEM.PARK_TOKEN, 3 + ((roll(6) * 4) | 0));   // 乐园代币 3–6 枚
    if (roll(4) < 0.4) put(ITEM.IRON_PICK, 1, Math.max(1, Math.round(251 * (0.55 + roll(5) * 0.45))));
    else put(ITEM.WARP_CELL, 1);
    return items;
  }

  // ---------- 园区构件（全部只依赖 park / L / 常量） ----------

  // 找平地基：低于找平面逐列垫实到平台高；高于找平面的天然土柱整段削除
  // （'overwrite' 仅豁免基岩），保证行走面完全平坦、无棋盘坑与绊脚凸起。
  function foundation(writer, park, x, z, topY, baseId) {
    var base = baseId === undefined ? PK.LAWN : baseId;
    var gs = ctx ? ctx.surfaceAt(x, z) : park.ah;
    var y;
    for (y = gs + 1; y <= topY; y++) writer(x, y, z, base, 'force');
    writer(x, topY, z, base, 'force');
    for (y = topY + 1; y <= gs; y++) writer(x, y, z, 0, 'overwrite');
  }

  function box(writer, park, x0, z0, x1, z1, y0, y1, id, mode) {
    for (var x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (var z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (var y = y0; y <= y1; y++)
          writer(x, y, z, id, mode || 'force');
  }

  function roofPyramid(writer, cx, cz, cy, rad0, hgt, id, ridgeAxis) {
    for (var ly = 0; ly <= hgt; ly++) {
      var rad = rad0 - ly * (rad0 / (hgt + 1));
      if (rad < 0.5) { writer(cx, cy + ly, cz, id, 'force'); continue; }
      var ri = Math.round(rad);
      for (var dx = -ri; dx <= ri; dx++)
        for (var dz = -ri; dz <= ri; dz++) {
          var rr = Math.sqrt(dx * dx + dz * dz);
          if (rr > rad + 0.35) continue;
          // 山脊方向压扁成菱形屋顶
          if (ridgeAxis !== undefined) {
            var u = ridgeAxis === 0 ? dx : dz;
            var v = ridgeAxis === 0 ? dz : dx;
            if (Math.abs(u) > rad + 0.05) continue;
          }
          writer(cx + dx, cy + ly, cz + dz, id, 'force');
        }
    }
  }

  function buildPark(park, writer) {
    if (!park || typeof writer !== 'function') return;
    var ah = park.ah;
    var L = parkLayout();
    var v = park.variant;

    function S(dx, dz) { return PX(park, dx, dz); }         // -> [gx,gz]
    function F(dx, dz, y, id, mode) {                        // 局部写方块
      var p = S(dx, dz);
      writer(p[0], ah + y, p[1], id, mode || 'force');
    }
    function fCol(dx, dz, top, id, deep) {                   // 找平柱
      var p = S(dx, dz);
      foundation(writer, park, p[0], p[1], ah + top, id);
      if (deep) writer(p[0], ah + top, p[1], id, 'force');
    }

    // ---- 1. 全园找平（逐格无洞）：整个椭圆统一垫到锚点地表高 ----
    // 此前按 2 格步进跳列铺装，露出的原始地形形成"隔块下陷"的棋盘坑，
    // 玩家行走绊倒摔伤——必须逐格覆盖，保证整园通行面完全平坦。
    for (var px = -70; px <= 74; px++) {
      for (var pz = -74; pz <= 74; pz++) {
        var d2 = px * px * 0.85 + pz * pz;
        if (d2 > 92 * 92) continue;
        var gp = S(px, pz);
        foundation(writer, park, gp[0], gp[1], ah, PK.LAWN);
      }
    }

    // ---- 2. 大门拱廊（南入口）----
    (function () {
      var gz = L.gateDz;
      // 双塔：糖果条纹
      [[-5, 0], [5, 0]].forEach(function (tx) {
        for (var y = 1; y <= 9; y++) {
          F(tx[0] - 0, gz + tx[1], y, PK.CANDY);
          F(tx[0] + 1, gz + tx[1], y, PK.CANDY);
        }
        // 塔顶金冠 + 灯球
        F(tx[0], gz + tx[1], 10, PK.GOLD);
        F(tx[0] + 1, gz + tx[1], 10, PK.GOLD);
        F(tx[0], gz + tx[1], 11, PK.LANTERN);
        F(tx[0] + 1, gz + tx[1], 11, PK.LANTERN);
        F(tx[0] + 0, gz + tx[1], 12, PK.GOLD);
      });
      // 拱梁三层 + 彩旗
      for (var bx = -4; bx <= 4; bx++) {
        if (Math.abs(bx) === 5) continue;
        F(bx, gz, 8, PK.PASTEL);
        F(bx, gz, 9, PK.PASTEL);
        F(bx, gz, 10, PK.GOLD);
        if (bx % 2 === 0) F(bx, gz, 7, PK.BUNTING, 'air');
      }
      // 门匾
      F(-1, gz, 11, PK.GOLD); F(0, gz, 11, PK.GOLD); F(1, gz, 11, PK.GOLD);
      // 门前大道
      for (var rz = gz - 4; rz <= gz + 4; rz++)
        for (var rx = -2; rx <= 2; rx++) fCol(rx, rz, 0, PK.CREAM);
      // 售票亭 ×2：粉墙蓝瓦 + 内置空箱位
      [[L.boothL, true], [L.boothR, false]].forEach(function (bt) {
        var ox = bt[0][0], oz = bt[0][1];
        fCol(ox, oz, 0, PK.CREAM, true);
        for (var wy = 1; wy <= 3; wy++)
          for (var wx2 = -2; wx2 <= 2; wx2++)
            for (var wz2 = -1; wz2 <= 1; wz2++) {
              if (wy < 3 && Math.abs(wx2) < 2 && wz2 === 0) { F(ox + wx2, oz + wz2, wy, 0, 'force'); continue; }
              F(ox + wx2, oz + wz2, wy, PK.PASTEL);
            }
        // 售票窗玻璃
        F(ox, oz + 1, 2, PK.GLASS);
        // 柜台宝箱（惰性战利品，chestLootAt 反查）
        var cbp = S(ox, oz);
        writer(cbp[0], ah + 1, cbp[1], PK.CHEST, 'air');
        roofPyramid(function (x, y, z, id) { writer(x, y, z, id, 'force'); },
          S(ox, oz)[0], S(ox, oz)[1], ah + 4, 3, 2, PK.ROOF);
        F(ox - 1, oz - 1, 1, PK.GOLD); F(ox + 1, oz - 1, 1, PK.GOLD);
      });
    })();

    // ---- 3. 中央喷泉广场 ----
    (function () {
      for (var dx = -8; dx <= 8; dx++) for (var dz = -8; dz <= 8; dz++) {
        var dd = dx * dx + dz * dz;
        if (dd <= 66) {
          fCol(dx, dz, 0, dd <= 30 ? PK.CREAM : PK.PASTEL, true);
          if (dd <= 25) F(dx, dz, 1, PK.CREAM);
          if (dd <= 12) F(dx, dz, 2, PK.CREAM);                    // 二级台
          if (dd <= 5 && dd >= 1) F(dx, dz, 3, 7, 'force');         // 水池（越过 KEEP 表）
          if (dd === 0) { F(dx, dz, 1, PK.STONE); F(dx, dz, 2, PK.STONE); F(dx, dz, 3, PK.CANDY); F(dx, dz, 4, PK.LANTERN); }
          if (dd >= 24 && dd <= 25 && (dx + dz) % 2 === 0) F(dx, dz, 3, PK.GOLD); // 金环饰
        }
        // 广场放射步道在下方花园路径统一铺
      }
    })();

    // ---- 4. 放射步道（奶油石板 3 宽）----
    (function () {
      function walk(x0, z0, x1, z1) {
        var steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
        for (var sIdx = 0; sIdx <= steps; sIdx++) {
          var t = steps ? sIdx / steps : 0;
          var wx = Math.round(x0 + (x1 - x0) * t);
          var wz = Math.round(z0 + (z1 - z0) * t);
          var nx = x1 - x0 ? (x1 - x0) / steps : 0;
          var nz = z1 - z0 ? (z1 - z0) / steps : 0;
          for (var w = -1; w <= 1; w++) {
            fCol(Math.round(wx - nz * w * 1.4), Math.round(wz + nx * w * 1.4), 0, PK.CREAM);
          }
          // 大道双侧交错路灯（糖果杆托暖黄灯球，左右每 5 步错开一根）
          if (sIdx % 5 === 0 || sIdx % 5 === 3) {
            var side = (sIdx % 5 === 0) ? -1 : 1;
            var lx = Math.round(wx + nz * side * 3);
            var lz = Math.round(wz - nx * side * 3);
            var le2 = lx * lx * 0.85 + lz * lz;
            if (le2 <= 88 * 88) {
              var lp = S(lx, lz);
              fCol(lx, lz, 0, PK.LAWN, true);
              F(lx, lz, 1, PK.CANDY); F(lx, lz, 2, PK.CANDY); F(lx, lz, 3, PK.LANTERN);
            }
          }
        }
      }
      walk(0, -8, L.ferris.c[0] + 12, L.ferris.c[1]);               // -> 摩天轮
      walk(0, -8, L.carousel.c[0], L.carousel.c[1] + 8);            // -> 木马
      walk(0, -8, L.drop.c[0] - 9, L.drop.c[1]);                    // -> 跳楼机
      walk(0, -8, L.coaster.board[0] + 2, L.coaster.board[1] + 3);  // -> 过山车站台
      walk(0, -8, L.tron.board[0] - 4, L.tron.board[1]);            // -> 光轮
      walk(0, -8, L.castle.c[0] + 10, L.castle.c[1] + 14);          // -> 城堡
    })();

    // ---- 5. 摩天轮（体素部分：A 架/座舱臂站台/围栏；轮体运行时网格）----
    (function () {
      var fc = L.ferris.c, fx = fc[0], fz = fc[1];
      // A 字腿：沿局部 x 向展宽、向上收拢至 2/3 轮高（不顶满轮毂），避免
      // 座舱/乘客视线在高位时贴上门柱石头；顶端以金饰压顶 + 灯球收束
      var HUB_Y = 30;
      var LEG_TOP = 20;
      for (var legY = 1; legY <= LEG_TOP; legY++) {
        var spread = Math.max(2, Math.round((LEG_TOP - legY) * 0.65));
        [[fx - spread, fz], [fx + spread, fz]].forEach(function (lg) {
          var p = S(lg[0], lg[1]);
          foundation(writer, park, p[0], p[1], ah, PK.LAWN);
          writer(p[0], ah + legY, p[1], PK.STONE, 'force');
          writer(p[0], ah + legY, p[1] + 1, PK.STONE, 'force');
          writer(p[0], ah + legY, p[1] - 1, PK.STONE, 'force');
        });
        // 阶梯横撑（每 7 层一道金箍）
        if (legY % 7 === 0) {
          for (var brx = fx - spread + 1; brx < fx + spread; brx++) {
            var bp2 = S(brx, fz);
            writer(bp2[0], ah + legY, bp2[1], PK.GOLD, 'force');
            writer(bp2[0], ah + legY, bp2[1] + 1, PK.GOLD, 'force');
          }
        }
      }
      // 双柱头金饰 + 灯球
      [[-12, fz], [12, fz]].forEach(function (cap) {
        var cp = S(fx + cap[0], cap[1]);
        foundation(writer, park, cp[0], cp[1], ah + LEG_TOP + 1, PK.STONE);
        writer(cp[0], ah + LEG_TOP + 2, cp[1], PK.GOLD, 'force');
        writer(cp[0], ah + LEG_TOP + 3, cp[1], PK.LANTERN, 'air');
      });
      // 中轴轮毂（十字环）：中心留空，避免乘员视线左右掠过时贴上实心石芯
      var hp = S(fx, fz);
      for (var hx = -1; hx <= 1; hx++)
        for (var hz2 = -1; hz2 <= 1; hz2++) {
          if (Math.abs(hx) !== 1 && Math.abs(hz2) !== 1) continue;
          writer(hp[0] + hx, ah + 27, hp[1] + hz2, PK.STONE, 'force');
          writer(hp[0] + hx, ah + 33, hp[1] + hz2, PK.STONE, 'force');
        }
      for (var hy = 28; hy <= 32; hy++) {
        [[-1, 0], [1, 0]].forEach(function (o) {
          var p2 = S(fx + o[0], fz);
          writer(p2[0], ah + hy, p2[1], PK.STONE, 'force');
        });
        [[0, -1], [0, 1]].forEach(function (o) {
          var p3 = S(fx, fz + o[1]);
          foundation(writer, park, p3[0], p3[1], ah, PK.LAWN);
          writer(p3[0], ah + hy, p3[1], PK.STONE, 'force');
        });
      }
      writer(S(fx, fz)[0], ah + 30, S(fx, fz)[1], PK.GOLD, 'force');
      // 顶部检修灯球（体素发光，运行时灯圈另建）
      writer(hp[0], ah + 35, hp[1], PK.LANTERN, 'air');
      // 底座装饰环 + 轮轴基台
      for (var ex = fx - 14; ex <= fx + 14; ex++)
        for (var ez2 = fz - 14; ez2 <= fz + 14; ez2++) {
          var ed2 = (ex - fx) * (ex - fx) + (ez2 - fz) * (ez2 - fz);
          if (ed2 <= 196 && ed2 > 180) fCol(ex, ez2, 0, PK.CANDY, true);
          else if (ed2 <= 40) fCol(ex, ez2, 0, PK.CREAM, true);
        }
      // 排队围栏 + 乘坐台
      (function () {
        var bp = L.ferris.board;
        for (var qx = bp[0] - 3; qx <= bp[0] + 3; qx++) fCol(qx, bp[1] - 3, 0, PK.CREAM, true);
        for (var qz = bp[1] - 3; qz <= bp[1] + 3; qz++) fCol(bp[0] + 3, qz, 0, PK.CREAM, true);
        for (var fy = 1; fy <= 1; fy++) {
          F(bp[0] - 3, bp[1] - 3, fy, PK.RAIL, 'air');
          F(bp[0] + 3, bp[1] + 3, fy, PK.RAIL, 'air');
        }
        var padp = S(bp[0], bp[1]);
        fCol(bp[0], bp[1], 0, PK.CREAM, true);
        writer(padp[0], ah + 1, padp[1], PK.PAD, 'force');
      })();
    })();

    // ---- 6. 旋转木马 ----
    (function () {
      var cc = L.carousel.c, cx2 = cc[0], cz2 = cc[1];
      for (var dx = -7; dx <= 7; dx++) for (var dz = -7; dz <= 7; dz++) {
        var d2c = dx * dx + dz * dz;
        if (d2c <= 46) fCol(cx2 + dx, cz2 + dz, 0, d2c <= 30 ? PK.CREAM : PK.PASTEL, true);
        if (d2c <= 27) F(cx2 + dx, cz2 + dz, 1, PK.CREAM);          // 转盘体素底盘
        if (d2c <= 27 && d2c > 22) F(cx2 + dx, cz2 + dz, 1, PK.GOLD);
      }
      // 中柱 + 穹顶（金字塔收分）
      for (var py = 2; py <= 8; py++) F(cx2, cz2, py, PK.CANDY);
      roofPyramid(function (x, y, z, id) { writer(x, y, z, id, 'force'); },
        S(cx2, cz2)[0], S(cx2, cz2)[1], ah + 9, 6, 5, PK.ROOF);
      F(cx2, cz2, 15, PK.LANTERN);
      var cpad = S(L.carousel.board[0], L.carousel.board[1]);
      fCol(L.carousel.board[0], L.carousel.board[1], 0, PK.CREAM, true);
      writer(cpad[0], ah + 1, cpad[1], PK.PAD, 'force');
    })();

    // ---- 7. 跳楼机 ----
    (function () {
      var dc = L.drop.c, dx2 = dc[0], dz2 = dc[1];
      // 底座圆盘
      for (var bx = -5; bx <= 5; bx++) for (var bz = -5; bz <= 5; bz++) {
        var bd2 = bx * bx + bz * bz;
        if (bd2 <= 28) fCol(dx2 + bx, dz2 + bz, 0, bd2 <= 10 ? PK.STONE : PK.CREAM, true);
        if (bd2 > 10 && bd2 <= 14) F(dx2 + bx, dz2 + bz, 1, PK.RAIL, 'air');
      }
      // 格构塔身：4 柱 + 每 6 层横箍，向上略收窄
      var th = L.drop.towerH;
      for (var ty = 1; ty <= th; ty++) {
        var inset = ty > th * 0.6 ? 0 : 1;
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (o) {
          if (inset === 0 && (Math.abs(o[0]) + Math.abs(o[1])) !== 2) return;
          var shrunken = inset === 0;
          F(dx2 + o[0] * (shrunken ? 1 : 2), dz2 + o[1] * (shrunken ? 1 : 2), ty, PK.STONE);
        });
        if (ty % 6 === 0) {
          // 横箍只铺外环（中空留出轿厢升降的十字通道）
          var bx0 = S(dx2 - 2, dz2)[0], bz0 = S(dx2, dz2 - 2)[1];
          var bx1 = S(dx2 + 2, dz2)[0], bz1 = S(dx2, dz2 + 2)[1];
          var cxg = S(dx2, dz2);
          for (var hx = bx0; hx <= bx1; hx++)
            for (var hz = bz0; hz <= bz1; hz++) {
              var edgeX = Math.abs(hx - cxg[0]) === 2;
              var edgeZ = Math.abs(hz - cxg[1]) === 2;
              if (!edgeX && !edgeZ) continue;   // 中线 3×3 保持通透
              writer(hx, ah + ty, hz, PK.GOLD, 'force');
            }
        }
      }
      // 塔冠（外环）+ 信标灯：中央留孔让轿厢最高点穿过
      var dp = S(dx2, dz2);
      for (var cxr = -2; cxr <= 2; cxr++)
        for (var czr = -2; czr <= 2; czr++) {
          if (Math.abs(cxr) !== 2 && Math.abs(czr) !== 2) continue;
          writer(dp[0] + cxr, ah + th + 1, dp[1] + czr, PK.GOLD, 'force');
        }
      // 冠檐四角立柱撑起信标
      [[-2, -2], [2, -2], [-2, 2], [2, 2]].forEach(function (c) {
        writer(dp[0] + c[0], ah + th + 2, dp[1] + c[1], PK.GOLD, 'force');
      });
      writer(dp[0], ah + th + 3, dp[1], PK.LANTERN, 'air');
      // 乘坐台
      var drpad = S(L.drop.board[0], L.drop.board[1]);
      fCol(L.drop.board[0], L.drop.board[1], 0, PK.CREAM, true);
      writer(drpad[0], ah + 1, drpad[1], PK.PAD, 'force');
    })();

    // ---- 8. 矿山过山车（石山体 + 螺旋提升坑道 + 站台）----
    (function () {
      var ccst = L.coaster.c;
      // 台阶式山体：四层同心圆角矩形，各层高度渐升；层间 = 环形提升坡道面
      var layers = [
        { rx: 26, rz: 22, dy: 0 }, { rx: 20, rz: 17, dy: 7 },
        { rx: 14, rz: 12, dy: 14 }, { rx: 8, rz: 7, dy: 21 }, { rx: 3, rz: 3, dy: 27 }
      ];
      layers.forEach(function (lyr, li) {
        for (var mx = ccst[0] - lyr.rx; mx <= ccst[0] + lyr.rx; mx++)
          for (var mz = ccst[1] - lyr.rz; mz <= ccst[1] + lyr.rz; mz++) {
            // 圆角矩形含入判定
            var exx = Math.max(0, Math.abs(mx - ccst[0]) - (lyr.rx - 3));
            var ezz = Math.max(0, Math.abs(mz - ccst[1]) - (lyr.rz - 3));
            if (exx * exx + ezz * ezz > 9) continue;
            var outer = layers[Math.min(li + 1, layers.length - 1)];
            if (li < layers.length - 1) {
              var exo = Math.max(0, Math.abs(mx - ccst[0]) - (outer.rx - 3));
              var ezo = Math.max(0, Math.abs(mz - ccst[1]) - (outer.rz - 3));
              if (exo * exo + ezo * ezo <= 9) continue;             // 被上一层覆盖
            }
            var gp2 = S(mx, mz);
            foundation(writer, park, gp2[0], gp2[1], ah + lyr.dy, li % 2 === 0 ? PK.STONE : PK.SANDSTONE);
            if (li > 0 && lyr.dy > 0) writer(gp2[0], ah + lyr.dy, gp2[1], PK.GRASS, 'force');
          }
        // 山腰树带（松矮林点缀）：只植南侧（z < ccst），北侧是轨道爬升走廊，
        // 且轨道俯冲段掠过南侧外缘——树顶 ah+dy+3 与轨面保持 ≥2 格净空
        if (li >= 1 && li <= 2) {
          for (var tX = ccst[0] - lyr.rx + 3; tX <= ccst[0] + lyr.rx - 3; tX += 7) {
            var tz1 = ccst[1] - (lyr.rz - 4);
            var tp = S(tX, tz1);
            var gsy = ctx ? ctx.surfaceAt(tp[0], tp[1]) : ah;
            if (Math.abs(gsy - (ah + lyr.dy)) > 4) continue;
            writer(tp[0], gsy + 1, tp[1], PK.LOG, 'air');
            writer(tp[0], gsy + 2, tp[1], PK.LEAVES, 'air');
            writer(tp[0], gsy + 3, tp[1], PK.LEAVES, 'air');
          }
        }
      });
      // 山峰旗杆：立在西北肩 (8,-56)（环3 台面），峰顶正中是轨道最高点
      var flag = S(8, -56);
      writer(flag[0], ah + 22, flag[1], PK.CANDY, 'force');
      writer(flag[0], ah + 23, flag[1], PK.BUNTING, 'air');
      // ---- 过山车站台（平台与雨棚）----
      var sbx = L.coaster.board;
      for (var sx2 = sbx[0] - 2; sx2 <= sbx[0] + 4; sx2++)
        for (var sz2 = sbx[1] - 2; sz2 <= sbx[1] + 2; sz2++) {
          fCol(sx2, sz2, 0, PK.PLANKS, true);
          F(sx2, sz2, 4, PK.ROOF);
        }
      // 雨棚四角立柱
      [[sbx[0] - 2, sbx[1] - 2], [sbx[0] - 2, sbx[1] + 2],
       [sbx[0] + 4, sbx[1] - 2], [sbx[0] + 4, sbx[1] + 2]].forEach(function (pt) {
        for (var py2 = 1; py2 <= 3; py2++) F(pt[0], pt[1], py2, PK.LOG);
      });
      F(sbx[0] + 3, sbx[1] + 2, 3, PK.RAIL, 'air');
      F(sbx[0] + 3, sbx[1] - 2, 3, PK.RAIL, 'air');
    })();

    // ---- 9. 创极速光轮拱廊 ----
    (function () {
      var T2 = L.tron;
      for (var gx = T2.gx0; gx <= T2.gx1; gx++) {
        for (var gz2 = T2.gz - 3; gz2 <= T2.gz + 3; gz2++) {
          fCol(gx, gz2, 0, (gx % 8 < 4) ? PK.BLUE : PK.NEON_C, true);
          var w = Math.abs(gz2 - T2.gz);
          // 拱形截面：两侧墙 + 弧顶
          if (w === 3) {
            for (var hy = 1; hy <= 4; hy++) F(gx, gz2, hy, PK.BLUE);
            F(gx, gz2, 5, PK.NEON_P);
          } else if (w === 2) {
            for (var hy2 = 1; hy2 <= 5; hy2++) F(gx, gz2, hy2, PK.BLUE);
            F(gx, gz2, 6, PK.NEON_P);
          } else if (w === 1) {
            for (var hy3 = 1; hy3 <= 6; hy3++) F(gx, gz2, hy3, PK.BLUE);
          } else {
            for (var hy4 = 1; hy4 <= 6; hy4++) F(gx, gz2, hy4, 0, 'force'); // 净空
            F(gx, gz2, 0, PK.NEON_C);                                      // 发光地轨
          }
          // 弧顶盖板
          if (w <= 2) F(gx, gz2, 7 - (w === 1 ? 1 : 0), PK.BLUE);
        }
        // 入口门框强化（中线 ±1 留作进出通道：只挂顶部霓虹饰带，不落墙体，
        // 否则会把通道口和下面的 PAD 乘坐台一起封死）
        if (gx === T2.gx0 || gx === T2.gx1) {
          for (var fr = T2.gz - 4; fr <= T2.gz + 4; fr++) {
            var lane = Math.abs(fr - T2.gz) <= 1;
            fCol(gx, fr, 0, PK.BLUE, true);
            if (!lane) {
              for (var fy2 = 1; fy2 <= 7; fy2++) F(gx, fr, fy2, PK.BLUE);
            }
            F(gx, fr, 8, PK.NEON_P);
          }
        }
      }
      var tpad = S(T2.board[0], T2.board[1]);
      writer(tpad[0], ah + 1, tpad[1], PK.PAD, 'force');
    })();

    // ---- 10. 童话城堡 ----
    (function () {
      var kcx = L.castle.c[0], kcz = L.castle.c[1];
      // 平台基座 21×21 找平
      for (var px2 = kcx - 10; px2 <= kcx + 10; px2++)
        for (var pz2 = kcz - 10; pz2 <= kcz + 10; pz2++)
          fCol(px2, pz2, 0, PK.CREAM, true);
      // 主堡外墙 13×13 高 14（粉墙 + 蓝色隅石）
      for (var wy2 = 1; wy2 <= 14; wy2++)
        for (var wx3 = kcx - 6; wx3 <= kcx + 6; wx3++)
          for (var wz3 = kcz - 6; wz3 <= kcz + 6; wz3++) {
            var edge = Math.abs(wx3 - kcx) === 6 || Math.abs(wz3 - kcz) === 6;
            if (!edge) continue;
            var quoin = (Math.abs(wx3 - kcx) === 6 && Math.abs(wx3 - kcx) % 6 === 0 &&
              Math.abs(wz3 - kcz) >= 4) ||
              (Math.abs(wz3 - kcz) === 6 && Math.abs(wz3 - kcz) % 6 === 0 && Math.abs(wx3 - kcx) >= 4);
            F(wx3, wz3, wy2, quoin ? PK.BLUE : PK.PINK);
          }
      // 室内清空 + 正门开洞（朝广场）
      for (var iy2 = 1; iy2 <= 13; iy2++)
        for (var ix2 = kcx - 5; ix2 <= kcx + 5; ix2++)
          for (var iz2 = kcz - 5; iz2 <= kcz + 5; iz2++)
            writer(S(ix2, iz2)[0], ah + iy2, S(ix2, iz2)[1], 0, 'force');
      // 正门：3 宽×4 高拱门（朝广场 dz+ 侧）+ 两侧彩玻窄窗
      for (var gdx = -1; gdx <= 1; gdx++) {
        F(kcx + gdx, kcz + 6, 1, 0, 'force');
        F(kcx + gdx, kcz + 6, 2, 0, 'force');
        F(kcx + gdx, kcz + 6, 3, 0, 'force');
        F(kcx + gdx, kcz + 6, 4, 0, 'force');
      }
      F(kcx - 1, kcz + 6, 5, PK.PINK, 'force');       // 拱肩收头
      F(kcx, kcz + 6, 5, PK.GOLD, 'force');
      F(kcx + 1, kcz + 6, 5, PK.PINK, 'force');
      // 大门两侧各 2 扇高窗（红/青/金彩玻，y5-6）
      [[-6, 88], [-6, 89], [6, 89], [6, 88]].forEach(function (wg, wi) {
        var wxs = kcx + wg[0];
        var wzs = kcz - 2 + (wi % 2) * 4;
        F(wxs, wzs, 5, wg[1], 'force');
        F(wxs, wzs, 6, wg[1], 'force');
      });
      // 北墙（dz-）玫瑰窗：3×3 金彩玻璃拼心
      for (var rd = -1; rd <= 1; rd++)
        for (var rz = 0; rz <= 1; rz++) {
          if (Math.abs(rd) === 1 && rz === 0) continue;   // 十字形
          F(kcx + rd, kcz - 6, 7 - rz, 90, 'force');
        }
      // 顶带（y14 宝蓝收头，迪士尼式粉墙上缘蓝饰）+ 檐口
      for (var wy4 = 1; wy4 <= 14; wy4++)
        for (var fx3 = kcx - 6; fx3 <= kcx + 6; fx3++)
          for (var fz3 = kcz - 6; fz3 <= kcz + 6; fz3++) {
            var fe = Math.abs(fx3 - kcx) === 6 || Math.abs(fz3 - kcz) === 6;
            if (!fe) continue;
            F(fx3, fz3, 14, PK.BLUE, 'force');
          }
      for (var ex3 = kcx - 7; ex3 <= kcx + 7; ex3++)
        for (var ez3 = kcz - 7; ez3 <= kcz + 7; ez3++) {
          var ee = Math.abs(ex3 - kcx) === 7 || Math.abs(ez3 - kcz) === 7;
          if (!ee) continue;
          var inner = Math.abs(ex3 - kcx) <= 6 && Math.abs(ez3 - kcz) <= 6;
          if (inner) continue;
          F(ex3, ez3, 15, PK.GOLD);
        }
      // 四角塔 Ø5 高 26：粉墙主体 + 宝蓝竖棱 + 金腰线（上海迪士尼配比）
      [[-6, -6], [6, -6], [-6, 6], [6, 6]].forEach(function (tpos) {
        var tx3 = kcx + tpos[0], tz3 = kcz + tpos[1];
        for (var ty2 = 1; ty2 <= 26; ty2++) {
          for (var ddx = -2; ddx <= 2; ddx++) for (var ddz = -2; ddz <= 2; ddz++) {
            var cd2 = ddx * ddx + ddz * ddz;
            if (cd2 > 5.2) continue;
            if (cd2 <= 2.2 && ty2 <= 24 && ty2 > 1) continue;       // 中空
            // 外壳圈（cd2>3）：默认粉墙；仅 (±2,0)/(0,±2) 四向中线 1 格作宝蓝竖棱；
            // y=20 一道宝蓝环带；y=26 顶圈收金腰线接锥顶
            var id = PK.PINK;
            if (cd2 > 3) {
              if (ty2 === 26) id = PK.GOLD;
              else if (ty2 === 20) id = PK.BLUE;
              else if ((ddx === 0 && Math.abs(ddz) === 2) ||
                (ddz === 0 && Math.abs(ddx) === 2)) id = PK.BLUE;
            }
            F(tx3 + ddx, tz3 + ddz, ty2, id);
          }
        }
        roofPyramid(function (x, y, z, id) { writer(x, y, z, id, 'force'); },
          S(tx3, tz3)[0], S(tx3, tz3)[1], ah + 27, 3, 4, PK.ROOF);
        F(tx3, tz3, 31, PK.LANTERN);
      });
      // 中央尖塔信标：keep 上方 + 上升到 52
      // 基座不再用实心 box（会埋掉室内回程大楼梯）——改为檐口单环圈边 +
      // 中央柱本体只占 (0,0)±1，回程梯从其两侧绕行（梯占 x∈[-1,1]，
      // 与尖塔柱 (0,0) 在 z=+3 级交叠 → 回程梯末段改绕东侧 x=+2 单列）
      for (var sy = 15; sy <= 52; sy++) {
        var rw = sy < 18 ? 1 : sy < 24 ? 1 : 1;
        if (sy === 18 || sy === 24 || sy === 34) {
          box(writer, park, S(kcx - rw, kcz)[0], S(kcx, kcz - rw)[1],
            S(kcx + rw, kcz)[0], S(kcx, kcz + rw)[1], ah + sy, ah + sy, PK.GOLD);
        } else {
          F(kcx, kcz, sy, sy % 10 === 9 ? PK.BLUE : PK.PINK);
        }
      }
      F(kcx, kcz, 53, PK.LANTERN);
      F(kcx, kcz, 54, PK.GOLD);

      // ---- 城堡内部装修 ----
      // 红毯走廊：正门 → 王座（暖黄灯球镶边红毯，PASTEL 作红毯面色）
      for (var rz2 = 1; rz2 <= 5; rz2++) {
        F(kcx - 1, kcz + rz2, 0, PK.PASTEL, 'force');
        F(kcx, kcz + rz2, 0, PK.PASTEL, 'force');
        F(kcx + 1, kcz + rz2, 0, PK.PASTEL, 'force');
      }
      [[-3, 1], [3, 1], [-3, 5], [3, 5]].forEach(function (lp) {
        F(kcx + lp[0], kcz + lp[1], 1, PK.LANTERN, 'air');
        F(kcx + lp[0], kcz + lp[1], 2, 0, 'force');        // 廊柱灯座
      });
      // 王座：北端高台（2 级台阶）+ 金饰靠背 + 臂灯
      for (var thx = -2; thx <= 2; thx++) for (var thz = -5; thz <= -4; thz++)
        F(thx + kcx, thz + kcz, 0, PK.BLUE, 'force');
      for (var thx2 = -2; thx2 <= 2; thx2++) for (var thz2 = -5; thz2 <= -4; thz2++)
        F(thx2 + kcx, thz2 + kcz, 1, PK.CREAM, 'force');   // 台面抬 1
      F(kcx, kcz - 5, 1, 0, 'force');
      F(kcx, kcz - 5, 2, PK.GOLD, 'force');                // 王座坐面（金）
      for (var bk = 3; bk <= 5; bk++) F(kcx, kcz - 5, bk, PK.GOLD, 'force'); // 靠背
      F(kcx - 1, kcz - 5, 3, PK.LANTERN, 'air');           // 臂灯 ×2
      F(kcx + 1, kcz - 5, 3, PK.LANTERN, 'air');
      // 大厅吊灯：中轴 3 盏灯球链（从 y8 垂下）
      for (var cl = 2; cl >= 6; cl++) F(kcx, kcz + 2, cl, 0, 'force'); // 净空
      F(kcx, kcz + 2, 7, PK.GOLD, 'force');
      F(kcx, kcz + 2, 6, PK.LANTERN, 'air');
      // 宽体大楼梯（3 宽直跑）：大厅中央 → 屋顶观景台
      // 台阶从 (0,-2) 起沿 +z? 不——直跑沿 -z→中央塔基。梯宽 3，每级升 1：
      // 14 级到檐口层 y15 平台。位置：x∈[-1,1]，z 从 +3 退到 -3 每级进 0.5 不行——
      // 13×13 内直跑 11 级到 y12，剩余高度走角塔螺旋段。方案：中央大楼梯
      // 沿 z 轴 11 级（每级 z-1, y+1），到 y12 后接东北角塔内螺旋 12 级到 y24
      // 观景平台，再经塔顶出屋顶垛口环。
      (function () {
        // 大楼梯：z 从 +4 到 -1 共 6 级（y1→y6），止于大厅中段（北端留给王座）
        for (var stp = 0; stp < 6; stp++) {
          var sy2 = 1 + stp, sz2 = 4 - stp;
          for (var sxp = -1; sxp <= 1; sxp++) {
            F(kcx + sxp, kcz + sz2, sy2, PK.CREAM, 'force');
            for (var fill = 1; fill < sy2; fill++) F(kcx + sxp, kcz + sz2, fill, PK.BLUE, 'force');
          }
        }
        // 一层衔接：大楼梯末级 y6(z=-1) → 折返梯首级 y7(z=-2) 平走一级，无桥接需求
        // 二层折返楼梯：z 从 -2 到 +3 共 6 级（y7→y12），3 宽——首级紧邻大楼楼梯
        // z≥-1 段避开中央尖塔柱：中列 x=0 跳过
        for (var stp2 = 0; stp2 < 6; stp2++) {
          var sy3 = 7 + stp2, sz3 = -2 + stp2;
          for (var sxp2 = -1; sxp2 <= 1; sxp2++) {
            if (sz3 >= -1 && sxp2 === 0) continue;   // 中央柱让位
            F(kcx + sxp2, kcz + sz3, sy3, PK.CREAM, 'force');
            for (var fill2 = 1; fill2 < sy3; fill2++) F(kcx + sxp2, kcz + sz3, fill2, PK.BLUE, 'force');
          }
        }
        // 中段平台（y13）：横贯全厅（z=-5..+3），折返梯末级 y12(z=+3) 接平台
        for (var lx2 = -5; lx2 <= 5; lx2++) for (var lz2 = -5; lz2 <= 5; lz2++)
          F(lx2 + kcx, lz2 + kcz, 13, PK.PLANKS, 'force');
        // 平台净空（y14..16 清空，头顶通行）
        for (var lx3 = -4; lx3 <= 4; lx3++) for (var lz3 = -4; lz3 <= 4; lz3++)
          for (var cy9 = 14; cy9 <= 16; cy9++) F(lx3 + kcx, lz3 + kcz, cy9, 0, 'force');
        // 三层回折梯：z 从 +2 到 -5 共 8 级（y14→y21，末级与观景台面平齐）
        // （首级从 z=+2 起：折返梯末级 z=+3 → 平台开洞 → 平走上一级；
        //   末段（z≤-1）避开中央尖塔柱）
        for (var stp3 = 0; stp3 < 8; stp3++) {
          var sy4 = 14 + stp3, sz4 = 2 - stp3;
          for (var sxp3 = -1; sxp3 <= 1; sxp3++) {
            if (sz4 <= -1 && sxp3 === 0) continue;
            F(kcx + sxp3, kcz + sz4, sy4, PK.CREAM, 'force');
          }
        }
        // 观景台（y21）：全厅 11×11 木板 + 外缘垛口 + 四角灯
        for (var vx = -5; vx <= 5; vx++) for (var vz = -5; vz <= 5; vz++) {
          var rim = Math.abs(vx) === 5 || Math.abs(vz) === 5;
          if (rim) {
            F(vx + kcx, vz + kcz, 21, PK.BLUE, 'force');
            if ((Math.abs(vx) + Math.abs(vz)) % 2 === 0)
              F(vx + kcx, vz + kcz, 22, PK.PINK, 'force');           // 垛口
          } else {
            F(vx + kcx, vz + kcz, 21, PK.PLANKS, 'force');
          }
        }
        [[-4, -4], [4, -4], [-4, 4], [4, 4]].forEach(function (vp) {
          F(vp[0] + kcx, vp[1] + kcz, 22, PK.LANTERN, 'air');
        });
        // 三层梯穿观景台处：末级 y21 与台面平齐（z=-5），前一级 y20(z=-4) 玩家
        // 跨上台面需台面开洞——在 z=-4..-3、x∈[-1,1] 台面开洞作梯口
        for (var hw = -4; hw <= -3; hw++)
          for (var sxp4 = -1; sxp4 <= 1; sxp4++)
            F(kcx + sxp4, kcz + hw, 21, 0, 'force');
        // 楼梯全程净空
        // 折返梯（z=-2..+3）上方：每级清 3 格；z=+3 列只清到平台 y13 上沿，
        // z=+2 列只清到 y13（三层首级 y14 不得吞）
        for (var stp5 = 0; stp5 < 6; stp5++) {
          var sz5 = -2 + stp5;
          var clearTop = 7 + stp5 + 3;
          if (sz5 === 3) clearTop = 12;           // 平台之下
          if (sz5 === 2) clearTop = 13;           // 保留三层首级 y14
          for (var sxp5 = -1; sxp5 <= 1; sxp5++)
            for (var cy5 = 7 + stp5 + 1; cy5 <= clearTop; cy5++)
              F(kcx + sxp5, kcz + sz5, cy5, 0, 'force');
        }
        // 三层梯（z=+2..-5）上方：每级清 3 格
        for (var stp6 = 0; stp6 < 8; stp6++) {
          var sz6 = 2 - stp6;
          for (var sxp6 = -1; sxp6 <= 1; sxp6++)
            for (var cy6 = 14 + stp6 + 1; cy6 <= 14 + stp6 + 3 && cy6 <= 26; cy6++)
              F(kcx + sxp6, kcz + sz6, cy6, 0, 'force');
        }
        // 楼板开洞：折返梯末级（z=+3）穿平台 y13（含头顶 y14 让位三层梯东列）
        for (var sxp7 = -1; sxp7 <= 1; sxp7++) {
          F(kcx + sxp7, kcz + 3, 13, 0, 'force');
        }
        // 屋顶以上净空（观景台 y22 上清到 y24，中央尖塔柱保留）
        for (var cx3 = -4; cx3 <= 4; cx3++) for (var cz4 = -4; cz4 <= 4; cz4++)
          for (var cy7 = 23; cy7 <= 24; cy7++)
            if (!(cx3 === 0 && cz4 === 0)) F(cx3 + kcx, cz4 + kcz, cy7, 0, 'force');
      })();

      // 前庭台阶
      for (var st2 = 0; st2 <= 2; st2++)
        for (var sw = -(3 - st2); sw <= (3 - st2); sw++)
          fCol(kcx + sw, kcz + 7 + st2, 0, PK.PINK, true);
      // 侧翼花园矮树 + 白栏杆带
      [[-8, 0], [8, 0]].forEach(function (gp3) {
        for (var gr = 0; gr < 4; gr++) {
          var gxp = kcx + gp3[0] * 2, gzp = kcz + gp3[1] * (gr * 2 - 3);
          fCol(gxp, gzp, 0, PK.LAWN, true);
          F(gxp, gzp, 1, PK.LEAVES, 'air');
        }
      });
    })();

    // ---- 10b. 海盗船基座（A 架/吊臂为运行时组件；体素部分做底座装饰）----
    (function () {
      var pc2 = L.pirate.c;
      // 底座圆角矩形垫层 + 糖果描边
      for (var qx2 = pc2[0] - 9; qx2 <= pc2[0] + 9; qx2++)
        for (var qz2 = pc2[1] - 4; qz2 <= pc2[1] + 4; qz2++) {
          var inside = Math.abs(qx2 - pc2[0]) <= 8 && Math.abs(qz2 - pc2[1]) <= 3;
          if (!inside) continue;
          var ringEdge = Math.abs(qx2 - pc2[0]) === 8 || Math.abs(qz2 - pc2[1]) === 3;
          fCol(qx2, qz2, 0, ringEdge ? PK.CANDY : PK.CREAM, true);
        }
      // 两侧配重块（金饰顶）
      [[-8, 0], [8, 0]].forEach(function (cw) {
        var cxp = S(pc2[0] + cw[0], pc2[1]);
        foundation(writer, park, cxp[0], cxp[1], ah, PK.LAWN);
        writer(cxp[0], ah + 1, cxp[1], PK.STONE, 'force');
        writer(cxp[0], ah + 2, cxp[1], PK.GOLD, 'force');
      });
      // 挂旗彩旗串（横跨 A 架顶）
      var flagP = S(pc2[0], pc2[1] - 3);
      foundation(writer, park, flagP[0], flagP[1], ah, PK.LAWN);
      writer(flagP[0], ah + 17, flagP[1], PK.BUNTING, 'air');
    })();

    // ---- 11. 外围白栏杆 + 彩旗串边界（缝隙入口已由大门方向留出）----
    (function () {
      for (var ang = 0; ang < 128; ang++) {
        var theta = ang / 128 * Math.PI * 2;
        var ox = Math.round(Math.cos(theta) * 88);
        var oz = Math.round(Math.sin(theta) * 86);
        if (ox * ox + oz * oz < 40) continue;
        // 南侧大门通道豁口
        if (oz > 60 && Math.abs(ox) < 6) continue;
        var pp = S(ox, oz);
        var gy = ctx ? ctx.surfaceAt(pp[0], pp[1]) : ah;
        if (gy <= WATER || Math.abs(gy - ah) > 8) continue;
        foundation(writer, park, pp[0], pp[1], gy, PK.LAWN);
        writer(pp[0], gy + 1, pp[1], PK.RAIL, 'force');
        if (ang % 12 === 0) {
          writer(pp[0], gy + 2, pp[1], PK.CANDY, 'force');
          writer(pp[0], gy + 3, pp[1], PK.LANTERN, 'force');
        }
      }
      // 栏杆间彩旗
      for (var bAng = 6; bAng < 128; bAng += 12) {
        var th2 = bAng / 128 * Math.PI * 2;
        var bxo = Math.round(Math.cos(th2) * 88);
        var bzo = Math.round(Math.sin(th2) * 86);
        if (bzo > 60 && Math.abs(bxo) < 6) continue;
        var bpp = S(bxo, bzo);
        var bgy = ctx ? ctx.surfaceAt(bpp[0], bpp[1]) : ah;
        if (bgy <= WATER || Math.abs(bgy - ah) > 8) continue;
        writer(bpp[0], bgy + 2, bpp[1], PK.BUNTING, 'air');
      }
    })();

    // ---- 12. 套圈游戏（toss：投掷线 + 3 根分值目标柱，柱体纯体素可断言）----
    // 目标柱在 dz 正方向（园心侧），玩家站投掷线（dz+3 排）朝 -dz 投——
    // 任意 rot 下 PX 旋转对称，柱总落在玩家面朝的园内方向。
    (function () {
      var T3 = L.toss;
      // 投掷区：奶油石板 5×4（玩家站南侧后排朝北投）
      for (var tx = T3.cx - 2; tx <= T3.cx + 2; tx++)
        for (var tz = T3.cz; tz <= T3.cz + 3; tz++)
          fCol(tx, tz, 0, PK.CREAM);
      // 3 根目标柱：距投掷线 8/11/14，糖果柱塔身 + 金饰顶环
      // 分值 2/3/5：柱高 2/3/4（越远越高越难）
      var pegs = [
        { dx: 0, dz: 8, h: 2, score: 2 },
        { dx: -6, dz: 11, h: 3, score: 3 },
        { dx: 6, dz: 14, h: 4, score: 5 }
      ];
      pegs.forEach(function (pg) {
        var px2 = T3.cx + pg.dx, pz2 = T3.cz + pg.dz;
        fCol(px2, pz2, 0, PK.LAWN);
        for (var hy = 1; hy <= pg.h; hy++) F(px2, pz2, hy, PK.CANDY);
        F(px2, pz2, pg.h + 1, PK.GOLD);            // 金饰柱头（命中判定块）
        F(px2 + 1, pz2, 1, PK.LANTERN, 'air');      // 侧灯柱照明
      });
      // 投掷线（南缘金饰一行，提示站位）
      for (var lx = T3.cx - 2; lx <= T3.cx + 2; lx++) F(lx, T3.cz + 3, 0, PK.GOLD);
      // 路标塔：投掷线两角的糖果条纹高柱（6 格）+ 金冠 + 灯球 + 彩旗——
      // 园内远处可见，指引玩家找到套圈场
      [[T3.cx - 3, T3.cz + 4], [T3.cx + 3, T3.cz + 4]].forEach(function (tw) {
        fCol(tw[0], tw[1], 0, PK.CREAM, true);
        for (var ty = 1; ty <= 6; ty++) F(tw[0], tw[1], ty, (ty % 2) ? PK.CANDY : PK.PINK);
        F(tw[0], tw[1], 7, PK.GOLD);
        F(tw[0], tw[1], 8, PK.LANTERN, 'air');
        F(tw[0], tw[1], 9, PK.BUNTING, 'air');
      });
      // 记分牌：两柱之间横幅（金饰梁 + 彩旗）
      for (var sx8 = T3.cx - 2; sx8 <= T3.cx + 2; sx8++) {
        F(sx8, T3.cz + 4, 6, PK.GOLD, 'force');
        if (sx8 % 2 === 0) F(sx8, T3.cz + 4, 5, PK.BUNTING, 'air');
      }
    })();

    // ---- 13. 统一放置乘坐台（最后写入：放射步道/站台铺装不得覆盖 PAD）----
    (function () {
      var padSpots = [L.ferris.board, L.carousel.board, L.drop.board,
        L.pirate.board, L.coaster.board, L.tron.board];
      padSpots.forEach(function (bpos) {
        var pb = S(bpos[0], bpos[1]);
        foundation(writer, park, pb[0], pb[1], ah, PK.LAWN);
        writer(pb[0], ah + 1, pb[1], PK.PAD, 'overwrite');
      });
    })();
  }

  // ================= 北欧城堡 · 峡湾全景（nordic 主题精选世界）=================
  //
  // 与星海嘉年华同一套「cell 重算裁剪」模式：描述符为纯函数，builder 只依赖
  // (vista, 常量)；每区块按 clip 裁剪只计算与自己相交的列。构图固定不旋转，
  // 保证任何 vista 的取景都一一对应两张参考照片：
  //   南岸黑沙丘地(出生点) → 冰湖 → 湖心岛上的红顶白墙城堡 → 石拱桥连东岸
  //   → 北岸雪帽锯齿山脊；夜空由 nordic 大气提供绿帘极光。
  var VISTA_CELL = 384;
  var VISTA_EXTENT = 175;     // 圆盘半径 158 + 桥墩/码头余量
  // 锚点高度带：站点搜索已要求 ah > WATER+2(=29)，上界压到 34 是为了给雪脊
  // 留出足够竖向空间（见 RIDGE_TOP_MAX / ridgeScale）
  var VISTA_AH_MAX = 34;
  // 雪脊顶不得越过内容封顶（光照快路径假设其上恒为空气）；
  // 剖面按 ah 实际可用空间整体缩放，而不是硬截成平台。
  var RIDGE_TOP_MAX = Math.min(H - 2, (CFG.CONTENT_NATURAL_TOP || H - 1) - 2);

  var NK = {
    BLACK_SAND: 215, GNEISS: 216, SHINGLE: 217, PLASTER: 218, TUSSOCK: 219,
    SNOW: 18, ICE: 32, WATER: 7, GRASS: 1, DIRT: 2, STONE: 3,
    PLANKS: 10, GLASS: 13, CHEST: 38, TORCH: 19,
    SPRUCE_LOG: 20, SPRUCE_LEAVES: 21,
    GOLD: 78, LANTERN: 79, RAIL: 80,
    GLASS_GOLD: 90, GLASS_CYAN: 89
  };

  // ---- 布局事实源（builder 与宝箱反查/出生点共用）----
  // 构图取自两张参考照片的合成（南岸眼位 → 湖 → 岛心城堡 → 雪脊）：
  //   出生点 z=+95 → 岸线 z=+62（前景沙丘 33 格）→ 岛心 z=-10（约 105 格）
  //   → 雪脊前缘 z=-61（约 156 格）→ 主峰 z=-90..-120（约 185..215 格）
  // 主峰距离必须落在雾尾内（viewBoost 半径 8 → 雾尾 224 格），否则整片山体
  // 会被雾吃掉——这是旧构图（出生点 z=+112、雾尾 128）最大的问题。
  function vistaLayout() {
    return {
      diskCx: 0, diskCz: -15, diskR: 158,
      lake: { cx: 0, cz: 8, rx: 132, rz: 52 },
      island: { cx: 0, cz: -10, rx: 34, rz: 27 },
      plaza: { cx: -2, cz: -12, rx: 27, rz: 21, top: 5 },      // 相对 ah 的台面高
      hall: { x0: -22, x1: -2, z0: -9, z1: 7, wallTop: 18 },   // 主厅（plaza 局部）
      spire: { cx: 8, cz: -1, r: 3, shaftTop: 36 },            // 中央尖塔
      wing: { x0: 2, x1: 18, z0: -5, z1: 9, wallTop: 13 },     // 东翼楼
      turretA: [-22, 11], turretB: [-2, 11], turretNW: [-22, -11],
      bridge: { z0: 4, z1: 8, x0: 22, x1: 138, rise: 5 },
      dock: { x0: -40, x1: -27, z0: -3, z1: 1 },
      spawn: { dx: 8, dz: 95 },
      // 雾中礁岛群（参考照片 002 上三分之一的群岛剪影）：[x, z, 半径]
      islets: [[-96, -34, 9], [86, -38, 11], [-72, 30, 7],
        [104, 18, 8], [-112, -6, 6], [34, -36, 10]],
      // 宝箱（plaza 局部）：主厅王座旁
      chests: [{ dx: -20, dz: -6, dy: 8, index: 0 }]
    };
  }

  // ---- 站点搜索：确定性最小方差探针。锚点必须是北欧峡湾群系——既把全景
  // 结构限定在 nordic 主题世界，也保证 lush 等其他世界的逐区块扫描廉价早退。
  function vistaSiteScore(ax, az) {
    var h0 = ctx.surfaceAt(ax, az);
    if (h0 <= WATER + 2 || h0 > VISTA_AH_MAX) return Infinity;
    if (ctx.biomeAt(ax, az) !== B.NORDIC_FJORD) return Infinity;
    var hs = [h0], sum = h0, n = 1, min = h0, max = h0;
    var RING = [[120, 0], [-120, 0], [0, -130], [0, 118],
      [96, -84], [-96, -84], [96, 70], [-96, 70]];
    for (var i = 0; i < RING.length; i++) {
      var h = ctx.surfaceAt(ax + RING[i][0], az + RING[i][1]);
      if (h <= WATER + 2) return Infinity;          // 设计区整体必须站得住陆地
      hs.push(h); sum += h; n++;
      if (h < min) min = h; if (h > max) max = h;
    }
    var mean = sum / n;
    if (max > mean + 14 || min < mean - 12) return Infinity;  // 悬崖落差过大
    var dev = 0;
    for (var j = 0; j < hs.length; j++) dev += Math.abs(hs[j] - mean);
    return dev / n;
  }

  function cellVista(cellX, cellZ) {
    if (!enabled()) return null;
    var PROBE_STEP = 14;
    var x0p = cellX * VISTA_CELL + VISTA_EXTENT;
    var z0p = cellZ * VISTA_CELL + VISTA_EXTENT;
    var spanP = VISTA_CELL - 2 * VISTA_EXTENT;
    if (spanP < PROBE_STEP) return null;
    var cols = Math.floor(spanP / PROBE_STEP);
    var best = null, bestScore = Infinity;
    for (var pi = 0; pi <= cols; pi++) {
      for (var pj = 0; pj <= cols; pj++) {
        var sx = x0p + pi * PROBE_STEP, sz = z0p + pj * PROBE_STEP;
        // legacy core 禁区与园区一致
        if (!(sx + VISTA_EXTENT < 0 || sx - VISTA_EXTENT >= W ||
          sz + VISTA_EXTENT < 0 || sz - VISTA_EXTENT >= D)) continue;
        var sc = vistaSiteScore(sx, sz);
        if (sc === Infinity) continue;
        if (sc < bestScore) { bestScore = sc; best = { ax: sx, az: sz }; }
      }
    }
    if (!best) return null;
    var ah = Math.round((ctx.surfaceAt(best.ax, best.az)));
    // 邻域众数回正：锚点列取环均值更接近整体台面
    var nbSum = 0;
    [[0, 0], [40, 0], [0, 40], [-40, 0], [0, -40]].forEach(function (q) {
      nbSum += ctx.surfaceAt(best.ax + q[0], best.az + q[1]);
    });
    ah = Math.round(nbSum / 5);
    return { ax: best.ax, az: best.az, ah: ah, score: bestScore };
  }

  function nearestVistaTo(x, z, maxCells) {
    if (!enabled()) return null;
    var baseCx = Math.floor(x / VISTA_CELL), baseCz = Math.floor(z / VISTA_CELL);
    var limit = Math.max(0, maxCells | 0);
    var best = null, bestD = Infinity;
    for (var ring = 0; ring <= limit && !best; ring++)
      for (var dx = -ring; dx <= ring; dx++)
        for (var dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          var v = cellVista(baseCx + dx, baseCz + dz);
          if (!v) continue;
          var d = Math.abs(v.ax - x) + Math.abs(v.az - z);
          if (d < bestD) { bestD = d; best = v; }
        }
    return best;
  }

  // 精选出生点：南岸丘顶面向城堡大门（同 parkGateSpawn 的换算约定）
  function vistaGateSpawn(vista) {
    if (!vista || !ctx) return null;
    var L = vistaLayout();
    var px = vista.ax + L.spawn.dx, pz = vista.az + L.spawn.dz;
    var gy = ctx.surfaceAt(px, pz);
    if (gy <= WATER || Math.abs(gy - vista.ah) > 6) gy = vista.ah;
    var tgt = PXv(vista, -2, -12);
    var dx = tgt[0] - px, dz = tgt[1] - pz;
    return { x: px + 0.5, y: gy + 1.25, z: pz + 0.5, yaw: Math.atan2(-dx, -dz) };
  }

  function PXv(vista, dx, dz) { return [vista.ax + dx, vista.az + dz]; } // 固定朝向

  function vistaChests(vista) {
    if (!vista) return [];
    var L = vistaLayout();
    return L.chests.map(function (c) {
      var p = PXv(vista, L.plaza.cx + c.dx, L.plaza.cz + c.dz);
      return { x: p[0], y: vista.ah + c.dy, z: p[1], index: c.index };
    });
  }

  function vistaLootFor(vista, index) {
    if (!enabled() || !vista) return null;
    var items = new Array(27).fill(null);
    var saltBase = vista.ax * 7517 + vista.az * 39301 + index * 1543;
    var cursor = 3;
    function roll(salt) { return h2(saltBase + salt * 5231, (vista.score * 100000 | 0) + salt * 4001); }
    function put(id, n, dur) {
      for (var guard = 0; guard < 27 && items[cursor]; guard++) cursor = (cursor + 1) % 27;
      if (!items[cursor]) items[cursor] = { id: id, n: n, dur: dur === undefined ? null : dur };
      cursor++;
    }
    put(ITEM.WARP_CELL, 1);
    var toolId = roll(1) < 0.55 ? ITEM.IRON_PICK : ITEM.IRON_SWORD;
    put(toolId, 1, Math.max(1, Math.round(251 * (0.7 + roll(2) * 0.3))));
    put(ITEM.COAL, 5 + ((roll(3) * 7) | 0));
    var meats = [ITEM.COOKED_PORK, ITEM.COOKED_CHICKEN, ITEM.COOKED_RABBIT];
    put(meats[(roll(4) * 3) | 0], 2 + ((roll(5) * 3) | 0));
    var crys = CRYSTAL_ITEM[typeKeyOf()] || CRYSTAL_ITEM.lush;
    put(crys, 1 + ((roll(6) * 3) | 0));
    return items;
  }

  // ---------- 几何助手 ----------
  // 山脊剖面参数：峰顶抬高、锥面用 1.7 次幂收尖（参考照片 001 的刀刃状雪峰），
  // 锥半径仍留 30 以保证相邻峰重叠、山墙不出现缺口。剖面本体见 buildVista 的
  // ridgeAt（唯一实现，避免两份会漂移的山形）。
  var VISTA_PEAK_STEP = 28;
  // 峰高是"山体占多少画面"与"极光有多少天空"的直接权衡：前缘峰在 144 格外，
  // 峰高 60 → 仰角约 19°，占 75° 竖直视场的四分之一，正好给绿帘留出上方天空。
  // 再高（原来 95）会把天空挤到只剩 15%，极光就成了顶部一条边。
  var VISTA_PEAK_H = [38, 47, 42, 50, 40, 48, 44, 51, 39, 46, 43];
  // 峰位与锥半径都逐峰错开：等距同径的锥列从空中看是一排一模一样的三角鳍，
  // 像梳子而不是山脉。
  var VISTA_PEAK_DX = [0, 7, -5, 10, -8, 4, -3, 8, -6, 3, -4];
  var VISTA_PEAK_R = [26, 34, 29, 37, 24, 32, 27, 35, 25, 31, 28];
  var VISTA_PEAK_POW = 1.7;
  // 山脊前缘（相对盘心 z）：越靠南越近、看起来越高，也越不容易被雾吃掉。
  var VISTA_RIDGE_FRONT = -30;
  // 剖面理论上限（base 最大 14 + 最高峰 × 起伏上限 1.06），用于按 ah 缩放
  var VISTA_RIDGE_SPAN = 14 + Math.round(51 * 1.06);

  // ah 越高，留给雪脊的竖向空间越少；整体缩放而不是截顶，山形不会被削平。
  function vRidgeScale(ah) {
    return Math.min(1, Math.max(20, RIDGE_TOP_MAX - ah) / VISTA_RIDGE_SPAN);
  }

  // 山体起伏：两级粗格（7 / 23 格）的连续抖动。逐列白噪会把高峰打成一排
  // 方柱（棋盘噪声在 80 格高度上就是 ±8 格的乱跳），粗格才形成岩脊与冲沟。
  function vRidgeRough(v, lx, lz) {
    function lattice(cell, salt) {
      return h2(v.ax + Math.floor(lx / cell) * 137 + salt,
        v.az + Math.floor(lz / cell) * 149 + salt);
    }
    return 0.90 + lattice(23, 11) * 0.11 + lattice(7, 37) * 0.05;
  }

  // 草丘：11 格网格内抖动的簇心。抖动被限制在格心 ±2，于是任何一列只需查
  // 自己所在的格（邻格簇心至少 8 格远 > 最大丘半径 4），成本恒为常数。
  var MOUND_CELL = 11;
  function vMoundAt(v, lx, lz) {
    var gx = Math.floor(lx / MOUND_CELL), gz = Math.floor(lz / MOUND_CELL);
    var sx = v.ax + gx * 131, sz = v.az + gz * 149;
    if (h2(sx + 7, sz + 19) > 0.42) return 0;               // 稀疏：约四成格有丘
    var cx = gx * MOUND_CELL + 3 + Math.floor(h2(sx + 3, sz + 41) * 5);
    var cz = gz * MOUND_CELL + 3 + Math.floor(h2(sx + 11, sz + 7) * 5);
    var r = 2 + Math.floor(h2(sx + 13, sz + 5) * 3);        // 2..4
    var dx = lx - cx, dz = lz - cz;
    var d2 = dx * dx + dz * dz;
    if (d2 > r * r) return 0;
    return Math.max(1, Math.round((1 - Math.sqrt(d2) / (r + 0.5)) * 3));
  }

  // ---- 全景构建入口。clip = [cx0, cx1, cz0, cz1]（含端点），把成本压到相交列。----
  function buildVista(v, writer, clip) {
    if (!v || typeof writer !== 'function') return;
    var L = vistaLayout();
    var ah = v.ah;
    // 统一坐标系：以下所有 dlx/dlz 都是「锚点局部」；写入一律经 WL()。
    // 布局表中的城堡件以 plaza 局部存储，这里一次性换算成锚点局部。
    var PLX = L.plaza.cx, PLZ = L.plaza.cz;
    function LJ(dx) { return PLX + dx; }        // plaza 局部 x -> 锚点局部
    function LJz(dz) { return PLZ + dz; }
    var x0c = clip ? clip[0] - v.ax : -L.diskR - 2;   // clip 转局部
    var x1c = clip ? clip[1] - v.ax : L.diskR + 2;
    var z0c = clip ? clip[2] - v.az : L.diskCz - L.diskR - 2;
    var z1c = clip ? clip[3] - v.az : L.diskCz + L.diskR + 2;
    var gsLo = ah - 12;

    function WL(lx, y, lz, id, mode) { writer(v.ax + lx, y, v.az + lz, id, mode || 'force'); }
    function inClipL(lx, lz) { return lx >= x0c && lx <= x1c && lz >= z0c && lz <= z1c; }
    function gsAt(lx, lz) { return ctx.surfaceAt(v.ax + lx, v.az + lz); }
    function inDisk(lx, lz) {
      var ex = (lx - L.diskCx) / L.diskR, ez = (lz - L.diskCz) / L.diskR;
      return ex * ex + ez * ez <= 1;
    }
    function inEll(lx, lz, e) {
      var ex = (lx - e.cx) / e.rx, ez = (lz - e.cz) / e.rz;
      return ex * ex + ez * ez <= 1;
    }

    // 找平柱：垫到 topY（低处回填），高于 topY 且在盘内的天然土柱整段削除
    function colFound(lx, lz, topY, topId, bodyId) {
      if (!inClipL(lx, lz)) return;
      var gs = gsAt(lx, lz);
      if (gs < gsLo) gs = gsLo;
      var y;
      for (y = Math.min(gs + 1, topY); y <= topY; y++) WL(lx, y, lz, bodyId);
      WL(lx, topY, lz, topId);
      for (y = topY + 1; y <= gs; y++) WL(lx, y, lz, 0, 'air');
    }
    function boxWalls(lx0, lz0, lx1, lz1, by0, by1, fn) {
      for (var lx = Math.max(lx0, x0c); lx <= Math.min(lx1, x1c); lx++)
        for (var lz = Math.max(lz0, z0c); lz <= Math.min(lz1, z1c); lz++)
          for (var by = by0; by <= by1; by++) fn(lx, by, lz);
    }

    // 山脊剖面：北带锯齿峰列，返回该列相对 ah 的目标高度。
    // ridgeScale 把整条剖面压进内容封顶（ah 越高压得越多），保持山形比例。
    var ridgeScale = vRidgeScale(ah);
    var ridgeFront = L.diskCz + VISTA_RIDGE_FRONT;
    function ridgeAt(lx, lz) {
      if (lz > ridgeFront) return null;
      var t = (ridgeFront - lz) / (L.diskR - 24);   // 0..1 向盘缘抬升
      var base = 6 + Math.round(Math.max(0, t) * 8);
      // 两层锥叠加：窄锥（半径 30、1.7 次幂）给刀刃状峰顶，宽缓的山体基座
      // （半径 64、线性、0.62 权重）把峰连成连续山墙。只有窄锥时峰间会塌到
      // 峰高的 35%，从南岸看过去就是一排孤立的三角尖而不是山脉。
      var bestH = 0, wall = 0;
      for (var k = 0; k < VISTA_PEAK_H.length; k++) {
        var d = Math.abs(lx - (L.diskCx - 140 + k * VISTA_PEAK_STEP + VISTA_PEAK_DX[k]));
        var dh = VISTA_PEAK_H[k] * Math.pow(Math.max(0, 1 - d / VISTA_PEAK_R[k]), VISTA_PEAK_POW);
        if (dh > bestH) bestH = dh;
        var dw = VISTA_PEAK_H[k] * Math.max(0, 1 - d / 64) * 0.62;
        if (dw > wall) wall = dw;
      }
      if (wall > bestH) bestH = wall;
      if (bestH <= 0) return null;
      return Math.round((base + bestH * vRidgeRough(v, lx, lz)) * ridgeScale);
    }

    // 礁岛：湖中的岩锥（雾中群岛剪影）。返回该列相对 ah 的目标高度，
    // 不命中返回 null。半径外的边缘用平方根收边，读起来像被水啃过的岩石。
    function isletAt(lx, lz) {
      for (var i = 0; i < L.islets.length; i++) {
        var it = L.islets[i];
        var dx = lx - it[0], dz = lz - it[1];
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d > it[2]) continue;
        var jit = h2((v.ax + lx) * 19 + 3, (v.az + lz) * 23 + 61);
        return Math.max(1, Math.round((1 - d / it[2]) * (5 + jit * 4)) + 1);
      }
      return null;
    }

    var islandTop = ah + 3, plazaTop = ah + L.plaza.top;

    // ==== 1. 地形底景：黑沙盘 / 湖盆 / 岛体 / 雪脊 ====
    for (var lx = Math.max(L.diskCx - L.diskR, x0c); lx <= Math.min(L.diskCx + L.diskR, x1c); lx++) {
      for (var lz = Math.max(L.diskCz - L.diskR, z0c); lz <= Math.min(L.diskCz + L.diskR, z1c); lz++) {
        if (!inDisk(lx, lz)) continue;
        var dcx = lx - L.diskCx, dcz = lz - L.diskCz;
        var rr = Math.sqrt(dcx * dcx + dcz * dcz);
        var surfId, bodyId, dst;
        var isIsland = inEll(lx, lz, L.island);
        var ridge = ridgeAt(lx, lz);
        var inLake = inEll(lx, lz, L.lake) && !isIsland && !ridge;
        var islet = inLake ? isletAt(lx, lz) : null;
        if (isIsland && !ridge) {
          surfId = inEll(lx, lz, L.plaza) ? NK.GNEISS :
            (h2((v.ax + lx) * 41 + 7, (v.az + lz) * 43 + 11) < 0.5 ? NK.BLACK_SAND : NK.GNEISS);
          bodyId = NK.GNEISS;
          dst = inEll(lx, lz, L.plaza) ? plazaTop : islandTop;
        } else if (islet !== null) {
          surfId = NK.GNEISS; bodyId = NK.GNEISS; dst = ah + islet;
        } else if (inLake) {
          surfId = NK.GNEISS; bodyId = NK.GNEISS; dst = ah - 7;
        } else if (ridge !== null) {
          // 雪沟：条纹只由 x 决定，于是沿坡面连成竖向的雪槽/岩脊
          //（参考照片 001 里山体上一道道白色雪沟），而不是横向色带。
          // 雪沟：条纹取 5 格粗格且只由 x 决定，于是沿坡面连成宽度合适的
          // 竖向雪槽。逐列白噪会变成 1 格宽的黑白交替，远看像瓦楞铁皮。
          var gully = h2((v.ax + Math.floor(lx / 5) * 5) * 11 + 37, 0);
          var snowy = ridge > 26 || h2((v.ax + lx) * 7 + 91, (v.az + lz) * 5 + 53) < ridge / 44;
          colFound(lx, lz, ah + ridge, snowy ? NK.SNOW : NK.GNEISS, NK.GNEISS);
          // 雪帽：峰体越高积雪越厚，雪沟处露岩、其余整面覆雪
          if (ridge > 12) {
            var cap = Math.min(22, Math.round((ridge - 12) * 0.55) + 4);
            if (gully >= 0.70) cap = Math.max(2, Math.round(cap * 0.45));
            for (var syd = 1; syd <= cap; syd++) WL(lx, ah + ridge - syd, lz, NK.SNOW);
          }
          continue;
        } else {
          var dune = h2((v.ax + lx) * 31 + 3, (v.az + lz) * 37 + 61);
          dst = ah + (dune < 0.14 ? 1 : 0);
          surfId = NK.BLACK_SAND; bodyId = NK.DIRT;
        }
        // 盘缘向自然地形过渡（半宽 14）
        if (!isIsland && !inEll(lx, lz, L.lake) && rr > L.diskR - 14) {
          var tt = Math.min(1, (rr - (L.diskR - 14)) / 14);
          var natTop = gsAt(lx, lz);
          if (natTop > WATER + 2) dst = Math.round(dst * (1 - tt) +
            Math.max(gsLo, Math.min(natTop, ah + 26)) * tt);
        }
        colFound(lx, lz, dst, surfId, bodyId);
      }
    }

    // ==== 2. 注水冰湖（水位 ah-1）====
    // 雪脊与礁岛都可能伸进湖椭圆，注水必须跳过它们，否则会往山体里灌水。
    for (var wx = Math.max(L.lake.cx - L.lake.rx, x0c); wx <= Math.min(L.lake.cx + L.lake.rx, x1c); wx++)
      for (var wz = Math.max(L.lake.cz - L.lake.rz, z0c); wz <= Math.min(L.lake.cz + L.lake.rz, z1c); wz++) {
        if (!inEll(wx, wz, L.lake) || inEll(wx, wz, L.island)) continue;
        if (ridgeAt(wx, wz) !== null || isletAt(wx, wz) !== null) continue;
        for (var wy = ah - 6; wy <= ah - 1; wy++) WL(wx, wy, wz, NK.WATER);
        if (h2((v.ax + wx) * 23 + 5, (v.az + wz) * 29 + 97) < 0.06 &&
          !inEll(wx, wz, { cx: L.lake.cx, cz: L.lake.cz, rx: L.lake.rx - 26, rz: L.lake.rz - 16 }))
          WL(wx, ah - 1, wz, NK.ICE, 'overwrite');
      }

    // ==== 2b. 礁岛植被：岩锥顶上的矮云杉丛（雾中群岛的深色剪影）====
    L.islets.forEach(function (it, ii) {
      for (var ti = 0; ti < 3; ti++) {
        var gx = it[0] + ((ii * 5 + ti * 7) % 9) - 4;
        var gz = it[1] + ((ii * 7 + ti * 3) % 9) - 4;
        if (!inClipL(gx, gz)) continue;
        var top = isletAt(gx, gz);
        if (top === null || top < 3) continue;
        var th = 4 + ((ii + ti) % 3);
        for (var ly = 1; ly <= th; ly++) WL(gx, ah + top + ly, gz, NK.SPRUCE_LOG);
        for (var cy = th - 2; cy <= th + 1; cy++) {
          var rad = cy > th ? 0 : (cy === th ? 1 : 2);
          for (var ldx = -rad; ldx <= rad; ldx++)
            for (var ldz = -rad; ldz <= rad; ldz++) {
              if (ldx === 0 && ldz === 0 && cy <= th) continue;
              if (Math.abs(ldx) === 2 && Math.abs(ldz) === 2) continue;
              WL(gx + ldx, ah + top + cy, gz + ldz, NK.SPRUCE_LEAVES, 'air');
            }
        }
      }
    });

    // ==== 3. 广场白灰泥台面 + 金饰镶边 + 白栏杆 ====
    boxWalls(PLX - L.plaza.rx - 1, PLZ - L.plaza.rz - 1, PLX + L.plaza.rx + 1, PLZ + L.plaza.rz + 1,
      plazaTop, plazaTop + 2, function () { });
    for (var qx = Math.max(PLX - L.plaza.rx - 1, x0c); qx <= Math.min(PLX + L.plaza.rx + 1, x1c); qx++)
      for (var qz = Math.max(PLZ - L.plaza.rz - 1, z0c); qz <= Math.min(PLZ + L.plaza.rz + 1, z1c); qz++) {
        if (!inClipL(qx, qz)) continue;
        var exq = (qx - PLX) / (L.plaza.rx - 0.6), ezq = (qz - PLZ) / (L.plaza.rz - 0.6);
        var rimQ = exq * exq + ezq * ezq;
        if (rimQ > 1.05) continue;
        colFound(qx, qz, plazaTop, NK.PLASTER, NK.GNEISS);
        if (rimQ >= 0.94) {
          WL(qx, plazaTop, qz, NK.GOLD);
          // 南侧主入口豁口
          var gap = (qz > PLZ + 6) && (qx >= PLX - 8) && (qx <= PLX - 2);
          if (!gap) {
            WL(qx, plazaTop + 1, qz, NK.RAIL, 'air');
            // 灯柱：金柱两格 + 顶灯，俯瞰时勾出台面轮廓（参考照片 002 的
            // 环台暖光带）。间距 4 比原来的 5 更密，航拍才连成一圈。
            if (((qx % 4) + 4) % 4 === 0) {
              WL(qx, plazaTop + 1, qz, NK.GOLD);
              WL(qx, plazaTop + 2, qz, NK.GOLD);
              WL(qx, plazaTop + 3, qz, NK.LANTERN, 'air');
            }
          } else {
            WL(qx, plazaTop, qz, NK.PLASTER);   // 门前步道不铺金
          }
        }
      }

    // ---- 主厅：白墙红顶、可进入（正门朝南广场）----
    var HL = { x0: LJ(L.hall.x0), x1: LJ(L.hall.x1), z0: LJz(L.hall.z0), z1: LJz(L.hall.z1),
      wallTop: L.hall.wallTop };
    var base = plazaTop + 1, hallTop = plazaTop + HL.wallTop;
    boxWalls(HL.x0, HL.z0, HL.x1, HL.z1, base, hallTop, function (lx, by, lz) {
      var edge = lx === HL.x0 || lx === HL.x1 || lz === HL.z0 || lz === HL.z1;
      if (!edge) { WL(lx, by, lz, 0); return; }                       // 室内清空
      var corner = (lx === HL.x0 || lx === HL.x1) && (lz === HL.z0 || lz === HL.z1);
      var quoin = corner ||
        ((lx === HL.x0 || lx === HL.x1) && ((lz + 100) % 4 === 0)) ||
        ((lz === HL.z0 || lz === HL.z1) && ((lx + 100) % 5 === 0));
      var id = quoin ? NK.GNEISS : NK.PLASTER;
      if (by === hallTop) id = NK.GOLD;                               // 檐口金带
      WL(lx, by, lz, id);
    });
    // 正门拱门（南面中央 3 宽×4 高）
    boxWalls(HL.x0 + 8, HL.z1, HL.x0 + 10, HL.z1, base, base + 4, function (lx, by, lz) {
      WL(lx, by, lz, 0);
    });
    [HL.x0 + 7, HL.x0 + 11].forEach(function (gdxx) {
      WL(gdxx, HL.z1, base + 5, NK.PLASTER);
      WL(gdxx, HL.z1, base + 6, NK.GOLD);
    });
    for (var gdx = HL.x0 + 8; gdx <= HL.x0 + 10; gdx++) WL(gdx, HL.z1, base + 5, NK.GOLD);
    // 高窗列（南北两面两排：彩玻与灯球相间）
    [HL.z0, HL.z1].forEach(function (wzl) {
      for (var wy = base + 3; wy <= base + 10; wy += 3)
        for (var wxi = HL.x0 + 2; wxi <= HL.x1 - 2; wxi += 3) {
          var lit = (((wxi - HL.x0) / 3 | 0) % 2 === 0);
          WL(wxi, wzl, wy, lit ? NK.LANTERN : NK.GLASS_GOLD);
          WL(wxi, wzl, wy + 1, lit ? NK.LANTERN : NK.GLASS_GOLD);
        }
    });
    [HL.x0, HL.x1].forEach(function (wxl) {
      for (var wzi = HL.z0 + 3; wzi <= HL.z1 - 3; wzi += 3)
        WL(wxl, wzi, base + 5, NK.GLASS_CYAN);
    });
    // 人字坡屋顶（屋脊沿 x）。参考照片 002 的红瓦坡度接近 60°，
    // 所以脊高抬到 14、每远离屋脊一格降 1.75 格（旧版 9/1.0 太扁）。
    var roofMid = (HL.z0 + HL.z1) / 2;
    var HALL_ROOF_H = 14;
    boxWalls(HL.x0 - 1, HL.z0 - 1, HL.x1 + 1, HL.z1 + 1, hallTop + 1, hallTop + HALL_ROOF_H,
      function (lx, by, lz) {
        var rise = Math.round(HALL_ROOF_H - Math.abs(lz - roofMid) * 1.75);
        if (rise < 0 || by > hallTop + rise) return;
        WL(lx, by, lz, NK.SHINGLE);
      });
    // 屋脊金饰
    for (var rxg = HL.x0 - 1; rxg <= HL.x1 + 1; rxg++)
      WL(rxg, hallTop + HALL_ROOF_H, roofMid, NK.GOLD);
    // 室内：王座高台 + 壁灯
    boxWalls(HL.x0 + 1, HL.z0 + 1, HL.x1 - 1, HL.z0 + 3, base, base,
      function (lx, by, lz) { WL(lx, by, lz, NK.GNEISS); });
    WL(HL.x0 + 9, HL.z0 + 1, base + 1, NK.GOLD);
    WL(HL.x0 + 9, HL.z0 + 1, base + 2, NK.GOLD);
    for (var lamz = HL.z0 + 4; lamz <= HL.z1 - 1; lamz += 3) {
      WL(HL.x0 + 1, lamz, base + 2, NK.TORCH, 'air');
      WL(HL.x1 - 1, lamz, base + 2, NK.TORCH, 'air');
    }
    // 西墙内直跑梯上檐口走台（每级升 1，沿北墙爬）
    for (var stp = 0; stp < HL.wallTop; stp++) {
      var sy = base + stp;
      WL(HL.x0 + 1, sy, HL.z1 - 2 - stp, NK.GNEISS);
      WL(HL.x0 + 1, sy, HL.z1 - 1 - stp, NK.GNEISS);
      WL(HL.x0 + 1, sy, HL.z1 - 3 - stp, 0);
      WL(HL.x0 + 2, sy, HL.z1 - 2 - stp, 0);
      WL(HL.x0 + 2, sy, HL.z1 - 1 - stp, 0);
    }

    // ---- 中央尖塔：细身高耸、塔冠红灯 ----
    var SP = { cx: LJ(L.spire.cx), cz: LJz(L.spire.cz), r: L.spire.r, shaftTop: L.spire.shaftTop };
    var spBase = plazaTop + 1, spTop = plazaTop + SP.shaftTop;
    for (var sx2 = SP.cx - SP.r; sx2 <= SP.cx + SP.r; sx2++)
      for (var sz2 = SP.cz - SP.r; sz2 <= SP.cz + SP.r; sz2++) {
        if (!inClipL(sx2, sz2)) continue;
        var ddx = sx2 - SP.cx, ddz = sz2 - SP.cz;
        var d2s = ddx * ddx + ddz * ddz;
        if (d2s > SP.r * SP.r + 1) continue;
        var shell = d2s >= (SP.r - 1) * (SP.r - 1) + 1;
        for (var ty = spBase; ty <= spTop; ty++) {
          if (!shell) { WL(sx2, ty, sz2, 0); continue; }
          var id = NK.PLASTER;
          if (ty === spTop) id = NK.GOLD;
          else if ((ty - spBase) % 12 === 0) id = NK.GOLD;
          else if ((Math.abs(ddx) === SP.r && ddz % 2 === 0) ||
            (Math.abs(ddz) === SP.r && ddx % 2 === 0)) id = NK.GNEISS;
          else if ((ty - spBase) % 4 === 2 && ddx !== 0) id =
            ((ty - spBase) % 8 === 2) ? NK.LANTERN : NK.GLASS_GOLD;
          WL(sx2, ty, sz2, id);
        }
      }
    for (var cy = 1; cy <= 12; cy++) {
      var rad = Math.max(0, Math.round(SP.r * (1 - cy / 13)));
      for (var cxx = -rad; cxx <= rad; cxx++)
        for (var czz = -rad; czz <= rad; czz++) {
          if (cxx * cxx + czz * czz > rad * rad + 0.4) continue;
          var px3 = SP.cx + cxx, pz3 = SP.cz + czz;
          if (!inClipL(px3, pz3)) continue;
          WL(px3, spTop + cy, pz3, cy === 12 ? NK.GOLD : NK.SHINGLE);
        }
    }
    WL(SP.cx, spTop + 13, SP.cz, NK.LANTERN, 'air');
    WL(SP.cx, spTop + 14, SP.cz, NK.GOLD);

    // ---- 东翼楼：矮层四坡顶、亮灯长窗 ----
    var WG = { x0: LJ(L.wing.x0), x1: LJ(L.wing.x1), z0: LJz(L.wing.z0), z1: LJz(L.wing.z1),
      wallTop: L.wing.wallTop };
    var wgBase = plazaTop + 1, wgTop = plazaTop + WG.wallTop;
    boxWalls(WG.x0, WG.z0, WG.x1, WG.z1, wgBase, wgTop, function (lx, by, lz) {
      var edge = lx === WG.x0 || lx === WG.x1 || lz === WG.z0 || lz === WG.z1;
      if (!edge) { WL(lx, by, lz, 0); return; }
      var id = ((lx === WG.x1 && (lz % 4 === 0)) || (lz === WG.z1 && (lx % 4 === 2))) ?
        NK.GNEISS : NK.PLASTER;
      if (by === wgTop) id = NK.GOLD;
      WL(lx, by, lz, id);
    });
    for (var wi = WG.x0 + 2; wi <= WG.x1 - 2; wi += 2) {
      WL(wi, WG.z1, wgBase + 2, (wi % 4 === 0) ? NK.LANTERN : NK.GLASS_GOLD);
      WL(wi, WG.z1, wgBase + 3, (wi % 4 === 0) ? NK.LANTERN : NK.GLASS_GOLD);
      WL(wi, WG.x1 !== wi ? WG.z1 : WG.z1, wgBase + 7, NK.GLASS_GOLD);
    }
    // 连通门（大厅东墙 <-> 翼楼）
    WL(WG.x0, WG.z0 + 2, wgBase, 0); WL(WG.x0, WG.z0 + 2, wgBase + 1, 0);
    WL(WG.x0, WG.z0 + 3, wgBase, 0); WL(WG.x0, WG.z0 + 3, wgBase + 1, 0);
    var wgMx = (WG.x0 + WG.x1) / 2, wgMz = (WG.z0 + WG.z1) / 2;
    var WING_ROOF_H = 9;
    boxWalls(WG.x0 - 1, WG.z0 - 1, WG.x1 + 1, WG.z1 + 1, wgTop + 1, wgTop + WING_ROOF_H,
      function (lx, by, lz) {
        var rise = Math.round(WING_ROOF_H - Math.max(
          Math.abs(lx - wgMx) * 0.62, Math.abs(lz - wgMz) * 1.3));
        if (rise < 0 || by > wgTop + rise) return;
        WL(lx, by, lz, NK.SHINGLE);
      });

    // ---- 角塔 ×3（前双塔 + 西北塔）：白身石裙红锥 ----
    [L.turretA, L.turretB, L.turretNW].forEach(function (tp, ti) {
      var TX = LJ(tp[0]), TZ = LJz(tp[1]), TR = 2;
      var thMax = ti === 2 ? 22 : 12;
      var twBase = plazaTop + 1, twTop = plazaTop + thMax;
      for (var ddx = -TR - 1; ddx <= TR + 1; ddx++)
        for (var ddz = -TR - 1; ddz <= TR + 1; ddz++) {
          var lx3 = TX + ddx, lz3 = TZ + ddz;
          if (!inClipL(lx3, lz3)) continue;
          var dsk2 = ddx * ddx + ddz * ddz;
          if (dsk2 <= (TR + 1) * (TR + 1))
            WL(lx3, plazaTop, lz3, dsk2 > TR * TR ? NK.GNEISS : NK.PLASTER);
          if (dsk2 > TR * TR + 1) continue;
          var shell = dsk2 >= (TR - 1) * (TR - 1) + 1;
          for (var ty = twBase; ty <= twTop; ty++) {
            if (!shell) { WL(lx3, ty, lz3, 0); continue; }
            var id = ty === twTop ? NK.GOLD :
              ((ddx === 0 || ddz === 0) && (ty % 5 === 0)) ? NK.GNEISS : NK.PLASTER;
            WL(lx3, ty, lz3, id);
          }
        }
      // 锥顶抬到 8 格（半径 2）：与主厅一起把屋面坡度推到参考照片的陡度
      for (var cy2 = 1; cy2 <= 8; cy2++) {
        var rad2 = Math.max(0, Math.round(TR * (1 - cy2 / 9)));
        for (var ex = -rad2; ex <= rad2; ex++)
          for (var ez = -rad2; ez <= rad2; ez++) {
            if (ex * ex + ez * ez > rad2 * rad2 + 0.4) continue;
            if (!inClipL(TX + ex, TZ + ez)) continue;
            WL(TX + ex, twTop + cy2, TZ + ez, NK.SHINGLE);
          }
      }
      WL(TX, twTop + 9, TZ, NK.LANTERN, 'air');
    });

    // ---- 岛缘：岩崖 + 深色云杉环 ----
    // 参考照片 002 的岛不是裸沙滩，而是一圈灰岩崖挂着深绿针叶林，
    // 城堡台面像被托在树冠之上。云杉只种在广场椭圆之外的环带里。
    for (var cxg = Math.max(L.island.cx - L.island.rx, x0c); cxg <= Math.min(L.island.cx + L.island.rx, x1c); cxg++)
      for (var czg = Math.max(L.island.cz - L.island.rz, z0c); czg <= Math.min(L.island.cz + L.island.rz, z1c); czg++) {
        if (!inEll(cxg, czg, L.island) || inEll(cxg, czg, L.plaza)) continue;
        if (!inClipL(cxg, czg)) continue;
        var rimR = h2((v.ax + cxg) * 53 + 29, (v.az + czg) * 59 + 7);
        // 崖面：靠岛缘的一圈抬 1~2 格灰岩，形成从水面直起的岩壁
        var eIx = (cxg - L.island.cx) / L.island.rx, eIz = (czg - L.island.cz) / L.island.rz;
        var rim = eIx * eIx + eIz * eIz;
        if (rim > 0.72 && rimR < 0.55) {
          WL(cxg, islandTop + 1, czg, NK.GNEISS);
          if (rimR < 0.22) WL(cxg, islandTop + 2, czg, NK.GNEISS);
          continue;
        }
        if (rimR < 0.70 || rimR > 0.745) continue;   // 约 4.5% 的列种树
        var ith = 5 + Math.floor(h2((v.ax + cxg) * 3 + 5, (v.az + czg) * 11 + 3) * 4);
        for (var ily = 1; ily <= ith; ily++) WL(cxg, islandTop + ily, czg, NK.SPRUCE_LOG);
        for (var icy = ith - 3; icy <= ith + 1; icy++) {
          var irad = icy > ith ? 0 : (icy === ith ? 1 : 2);
          for (var idx = -irad; idx <= irad; idx++)
            for (var idz = -irad; idz <= irad; idz++) {
              if (idx === 0 && idz === 0 && icy <= ith) continue;
              if (Math.abs(idx) === 2 && Math.abs(idz) === 2) continue;
              WL(cxg + idx, islandTop + icy, czg + idz, NK.SPRUCE_LEAVES, 'air');
            }
        }
      }

    // ---- 南侧下行石阶 + 低岩台：广场正门 → 伸进湖里的岩石平台 ----
    // 参考照片 002 里这道石梯与岩台是识别度很高的一处细节：它把城堡台面
    // 和水面连起来，俯瞰时正好指向画面下缘。
    var stairX = PLX - 5;
    var shelfZ0 = PLZ + L.plaza.rz + 1;
    for (var ss = 0; ss <= 5; ss++) {
      var stz = shelfZ0 + ss;
      var sty = plazaTop - ss;
      for (var sw = -1; sw <= 1; sw++) {
        if (!inClipL(stairX + sw, stz)) continue;
        colFound(stairX + sw, stz, sty, NK.GNEISS, NK.GNEISS);
      }
      if (ss % 3 === 0) {
        WL(stairX + 2, stz, sty + 1, NK.GOLD, 'air');
        WL(stairX + 2, stz, sty + 2, NK.LANTERN, 'air');
      }
    }
    for (var shz = shelfZ0 + 6; shz <= shelfZ0 + 9; shz++)
      for (var shx = stairX - 3; shx <= stairX + 3; shx++) {
        if (!inClipL(shx, shz)) continue;
        colFound(shx, shz, ah, NK.GNEISS, NK.GNEISS);
      }

    // ---- 石拱桥（东南跨湖连东岸）----
    var BR = L.bridge;
    var deckBase = plazaTop;
    for (var bx = BR.x0; bx <= BR.x1; bx++) {
      if (bx < x0c - 2 || bx > x1c + 2) continue;
      var t = (bx - BR.x0) / (BR.x1 - BR.x0);
      var rise = Math.round(Math.sin(t * Math.PI) * BR.rise);
      var deckY = deckBase + rise;
      for (var bz = BR.z0; bz <= BR.z1; bz++) {
        if (bz < z0c - 2 || bz > z1c + 2) continue;
        var archEdge = (bz === BR.z0 || bz === BR.z1);
        // 桥面全用石材：早先两侧铺金饰块，航拍时整座桥读成一条纯金带子，
        // 参考照片里桥体是灰石、只有灯是暖的。
        WL(bx, deckY, bz, NK.GNEISS);
        for (var uy = Math.max(ah - 8, deckY - 3); uy < deckY; uy++)
          WL(bx, uy, bz, NK.GNEISS);
        if (archEdge) {
          WL(bx, deckY + 1, bz, NK.RAIL, 'air');
          // 灯距 7：更密的话灯光在泛光下糊成一条连续金带，桥体就消失了
          if (((bx % 7) + 7) % 7 === 0) {
            WL(bx, deckY + 1, bz, NK.GOLD);
            WL(bx, deckY + 2, bz, NK.LANTERN, 'air');
          }
        }
      }
      // 桥墩扎进湖床
      if (rise >= 2 && ((bx - BR.x0) % 11 + 11) % 11 === 0) {
        for (var py = ah - 7; py <= deckY - 3; py++)
          WL(bx, py, BR.z0 + 2, NK.GNEISS);
      }
    }
    // 东岸引道找平
    for (var axb = Math.max(BR.x1 + 1, x0c); axb <= Math.min(BR.x1 + 9, x1c); axb++)
      for (var azb = Math.max(BR.z0 - 2, z0c); azb <= Math.min(BR.z1 + 2, z1c); azb++)
        colFound(axb, azb, ah, NK.BLACK_SAND, NK.DIRT);

    // ---- 西侧石阶码头 + 木栈桥 ----
    var DK = L.dock;
    var stepN = 6;
    for (var si = 0; si <= stepN; si++) {
      var sxl = DK.x1 - Math.round(si * (DK.x1 - DK.x0) / stepN);
      var syl = plazaTop - Math.round((si / stepN) * (plazaTop - ah));
      for (var syy = syl; syy <= plazaTop; syy++)
        WL(sxl, syy, DK.z0, NK.GNEISS);
      if (si < stepN) {
        WL(sxl, syl, DK.z0 + 1, NK.GNEISS);
        WL(sxl, syl, DK.z0 + 2, NK.GNEISS);
      }
    }
    for (var jx = DK.x0 - 14; jx <= DK.x0; jx++) {
      if (!inClipL(jx, DK.z0)) continue;
      for (var jz = DK.z0 + 1; jz <= DK.z1 - 1; jz++) {
        for (var fy = ah - 7; fy < ah - 1; fy++)
          WL(jx, fy, jz, ((jz === DK.z0 + 1 || jz === DK.z1 - 1) && (jx % 4 === 0)) ?
            NK.SPRUCE_LOG : NK.WATER);
        WL(jx, ah - 1, jz, NK.PLANKS);
      }
      if (((jx % 6) + 6) % 6 === 0) WL(jx, ah, DK.z0 + 1, NK.TORCH, 'air');
    }

    // ---- 南岸草丘 + 潮池 ----
    // 旧版是按白噪声逐列撒草，密铺出来像噪点地毯；参考照片 001 的前景是
    // 稀疏的隆起草丘（抬高的黑沙包，顶上一簇枯草）加成片的湿沙反光带。
    for (var tx = Math.max(-140, x0c); tx <= Math.min(140, x1c); tx++)
      for (var tz = Math.max(L.lake.cz + 2, z0c); tz <= Math.min(L.diskCz + L.diskR - 8, z1c); tz++) {
        if (!inClipL(tx, tz)) continue;
        if (!inDisk(tx, tz) || inEll(tx, tz, L.lake)) continue;
        // 出生点前方留一片空旷沙地：草丘挡在眼位前 12 格内会把整片湖面遮死
        var sdx = tx - L.spawn.dx, sdz = tz - L.spawn.dz;
        var nearSpawn = sdx * sdx + sdz * sdz < 12 * 12;
        var mh = nearSpawn ? 0 : vMoundAt(v, tx, tz);
        if (mh > 0) {
          for (var my = 1; my <= mh; my++) WL(tx, ah + my, tz, NK.BLACK_SAND);
          WL(tx, ah + mh + 1, tz, NK.TUSSOCK, 'air');
          continue;
        }
        // 潮池：7×5 的粗格决定成片区域，再用逐列噪声打散边缘。
        // 下切一格注水，水面比周围沙面低半格，掠射角下连成镜面反光带。
        // 只出现在岸线往内 26 格：再往南就是内陆沙丘，不该有潮水。
        var pool = (tz - (L.lake.cz + L.lake.rz)) < 26 &&
          h2(Math.floor(tx / 7) * 71 + 3, Math.floor(tz / 5) * 83 + 29) < 0.16 &&
          h2((v.ax + tx) * 5 + 1, (v.az + tz) * 7 + 3) > 0.24;
        if (pool) {
          colFound(tx, tz, ah - 1, NK.GNEISS, NK.GNEISS);
          WL(tx, ah, tz, NK.WATER);
        }
      }

    // ---- 侧翼云杉树丛（湖面放大后一并外移到新岸线上）----
    [[-140, 46], [136, 52], [-118, 86], [142, 8]].forEach(function (grove, gi) {
      for (var ti = 0; ti < 5; ti++) {
        var gx3 = grove[0] + ((gi * 7 + ti * 3) % 9) - 4;
        var gz3 = grove[1] + ((gi * 11 + ti * 5) % 11) - 5;
        if (!inClipL(gx3, gz3) || !inDisk(gx3, gz3)) continue;
        var th = 5 + (ti % 3);
        for (var ly = 1; ly <= th; ly++) WL(gx3, ah + ly, gz3, NK.SPRUCE_LOG);
        for (var cyl = th - 2; cyl <= th + 1; cyl++) {
          var rad3 = cyl > th ? 0 : (cyl === th ? 1 : 2);
          for (var ldx = -rad3; ldx <= rad3; ldx++)
            for (var ldz = -rad3; ldz <= rad3; ldz++) {
              if (ldx === 0 && ldz === 0 && cyl <= th) continue;
              if (Math.abs(ldx) === 2 && Math.abs(ldz) === 2) continue;
              WL(gx3 + ldx, ah + cyl, gz3 + ldz, NK.SPRUCE_LEAVES, 'air');
            }
        }
      }
    });

    // ---- 宝箱位（与 vistaChests 严格一致：anchor+plaza+chest 局部）----
    L.chests.forEach(function (ch) {
      WL(LJ(ch.dx), ah + ch.dy, LJz(ch.dz), NK.CHEST, 'air');
    });

    // ---- 出生安全岛保证：出生列 ±2 强制平坦黑沙无草 ----
    var SPC = L.spawn;
    for (var fx = SPC.dx - 2; fx <= SPC.dx + 2; fx++)
      for (var fz = SPC.dz - 2; fz <= SPC.dz + 2; fz++) {
        if (!inDisk(fx, fz)) continue;
        colFound(fx, fz, ah, NK.BLACK_SAND, NK.DIRT);
      }
  }

  // ================= 村落聚居地（v2 行星地表，密度介于遗迹与园区之间） =================

  var VILLAGE_CELL = 224;     // cell 边长：相邻村落最小间距保证
  var VILLAGE_EXTENT = 38;    // 村落最大半宽（散布小屋 + 水井 + 农田）
  var VILLAGE_CELL_CHANCE = 0.35;
  var VILLAGE_BIOMES = makeSet([
    B.PLAINS, B.FOREST, B.BIRCH_FOREST, B.SAVANNA, B.TAIGA, B.SNOWY, B.CHERRY_GROVE
  ]);
  var VILLAGE_FLAT_SAMPLES = [[0, 0], [26, 0], [-26, 0], [0, 26], [0, -26], [18, 18], [-18, -18]];
  // 村庄建筑方块（stable ids）：木板10 原木4 石头3 玻璃13 火把19 树叶5 草1 泥土2 水7 箱38
  var VK = { LOG: 4, PLANKS: 10, STONE: 3, COBBLE: 11, GLASS: 13, TORCH: 19,
    DIRT: 2, GRASS: 1, WATER: 7, CHEST: 38, LEAVES: 5 };

  function cellVillage(cellX, cellZ) {
    if (!enabled()) return null;
    var roll = h2(cellX * 233 + 17, cellZ * 241 + 71);
    if (roll >= VILLAGE_CELL_CHANCE) return null;
    var ax = cellX * VILLAGE_CELL + 42 + ((h2(cellX * 37 + 5, cellZ * 43 + 9) * 140) | 0);
    var az = cellZ * VILLAGE_CELL + 42 + ((h2(cellX * 47 + 3, cellZ * 53 + 27) * 140) | 0);
    if (!(ax + VILLAGE_EXTENT < 0 || ax - VILLAGE_EXTENT >= W ||
      az + VILLAGE_EXTENT < 0 || az - VILLAGE_EXTENT >= D)) return null;
    var ah = ctx.surfaceAt(ax, az);
    if (ah <= WATER + 2 || ah > PARK_AH_MAX) return null;
    if (!VILLAGE_BIOMES[ctx.biomeAt(ax, az)]) return null;
    for (var i = 0; i < VILLAGE_FLAT_SAMPLES.length; i++) {
      var hs = ctx.surfaceAt(ax + VILLAGE_FLAT_SAMPLES[i][0], az + VILLAGE_FLAT_SAMPLES[i][1]);
      if (hs <= WATER + 1 || Math.abs(hs - ah) > 4) return null;
    }
    return {
      ax: ax, az: az, ah: ah,
      variant: (h2(ax * 89 + 41, az * 97 + 23) * 4096) | 0
    };
  }

  // 小屋清单（builder 与宝箱反查共用同一份布局事实源）。
  // 小屋不做随机旋转：门窗/宝箱使用统一朝向的局部坐标映射，
  // 保证 buildVillage 写入的位置与 villageChests 反查严格一致。
  var VH = { hw: 2, hd: 2, wallH: 3 };   // 内半宽2（5×5 外圈）、墙高3

  function villageHouseList(v) {
    var n = 4 + ((v.variant & 3) !== 0 ? 1 : 0) + ((v.variant & 12) !== 0 ? 1 : 0); // 4–6 座
    var out = [];
    for (var k = 0; k < n; k++) {
      var ang = (k / n) * Math.PI * 2 + h2(v.ax * 31 + k * 7, v.az * 37 + k * 11) * 1.1;
      var dist = 14 + h2(v.ax * 41 + k * 13, v.az * 47 + k * 17) * 12;
      out.push({
        x: v.ax + Math.round(Math.cos(ang) * dist),
        z: v.az + Math.round(Math.sin(ang) * dist),
        hasChest: (h2(v.ax * 59 + k * 19, v.az * 61 + k * 23) < 0.65)
      });
    }
    return out;
  }

  // 宝箱固定在屋内东南墙角（局部 (+1,+1)），与 buildVillage 写入一致
  function villageChests(v) {
    var houses = villageHouseList(v);
    var out = [], idx = 0;
    for (var i = 0; i < houses.length; i++) {
      if (!houses[i].hasChest) continue;
      out.push({ x: houses[i].x + 1, y: v.ah + 1, z: houses[i].z + 1, index: idx++ });
    }
    return out;
  }

  // 门前台阶 / 宝箱等邻位换算（dir: 1=朝村心一侧, -1=背离）
  function villageFront(v, house, dist) {
    var ang = Math.atan2(v.az - house.z, v.ax - house.x);
    return {
      x: house.x + Math.round(Math.cos(ang)) * dist,
      z: house.z + Math.round(Math.sin(ang)) * dist
    };
  }

  function buildVillage(v, writer) {
    if (!v || typeof writer !== 'function') return;
    var ah = v.ah;
    var settleCorner = (v.variant & 8) !== 0;

    function flattenColumn(x, z, topId) {
      // 找平到锚点高：矮处垫泥土、高处削平；基岩/水/功能方块由写入端护栏兜底
      var gs = ctx.surfaceAt(x, z);
      for (var y = gs + 1; y <= ah; y++) writer(x, y, z, VK.DIRT, 'force');
      writer(x, ah, z, topId, 'force');
      for (var y2 = ah + 1; y2 <= gs; y2++) writer(x, y2, z, 0, 'overwrite');
    }

    // 中央水井：石圈托水面，中心火把立柱
    flattenColumn(v.ax, v.az, VK.WATER);
    for (var wx = -1; wx <= 1; wx++)
      for (var wz = -1; wz <= 1; wz++) {
        if (wx === 0 && wz === 0) continue;
        flattenColumn(v.ax + wx, v.az + wz, VK.COBBLE);
      }
    writer(v.ax, ah + 1, v.az, VK.TORCH, 'force');

    var houses = villageHouseList(v);

    // ---- 标准小屋（轴对齐）：木板墙 + 原木角柱 + 门朝村心 + 板砖四棱顶 ----
    function buildHouse(house, index) {
      var hw = VH.hw, hd = VH.hd, wallH = VH.wallH;
      for (var fx = -hw - 1; fx <= hw + 1; fx++)
        for (var fz = -hd - 1; fz <= hd + 1; fz++) {
          var gpx = house.x + fx, gpz = house.z + fz;
          if (Math.abs(fx) === hw + 1 && Math.abs(fz) === hd + 1 &&
            h2(gpx * 131 + index, gpz * 137 + index * 5) < 0.35) continue;   // 地基缺角
          flattenColumn(gpx, gpz,
            Math.abs(fx) <= hw && Math.abs(fz) <= hd ?
              (index % 2 === 0 ? VK.PLANKS : VK.STONE) : VK.DIRT);
        }
      // 墙体：y1..wallH。门在南边 (+z) 中央 1×2；两侧墙面 y2 嵌玻璃窗
      for (var wy = 1; wy <= wallH; wy++) {
        for (var px = -hw - 1; px <= hw + 1; px++) {
          buildWallCell(px, hd + 1, wy, true);
          buildWallCell(px, -(hd + 1), wy, false);
        }
        for (var pz2 = -hd; pz2 <= hd; pz2++) {
          buildWallCell(hw + 1, pz2, wy, false);
          buildWallCell(-(hw + 1), pz2, wy, false);
        }
      }
      function buildWallCell(px, pz, wy, southEdge) {
        var corner = Math.abs(px) === hw + 1 && Math.abs(pz) === hd + 1;
        var isDoor = southEdge && px === 0 && wy <= 2;
        var isWindow = !corner && !isDoor && wy === 2 &&
          ((Math.abs(px) === hw + 1 && Math.abs(pz) === hd) ||
            (Math.abs(pz) === hd + 1 && Math.abs(px) === hw));
        var id = corner ? VK.LOG : (isWindow ? VK.GLASS : VK.PLANKS);
        if (corner && settleCorner && wy === 1) id = BLK.BRICK_MOSSY;
        writer(house.x + px, ah + wy, house.z + pz, isDoor ? 0 : id, 'force');
      }
      // 四棱锥屋顶（板砖/苔砖交替）
      roofPyramid(function (x, y, z, rid) { writer(x, y, z, rid, 'force'); },
        house.x, house.z, ah + wallH + 1, hw + 1, 2,
        index % 2 === 0 ? BLK.BRICK : BLK.BRICK_MOSSY);
      // 屋内灯：北角柱旁挂火把（中心留给通行）
      writer(house.x - 1, ah + 1, house.z - 1, VK.TORCH, 'air');
      // 宝箱与 villageChests 同一坐标
      if (house.hasChest) writer(house.x + 1, ah + 1, house.z + 1, VK.CHEST, 'air');
      // 门前踏步找平
      var front = villageFront(v, house, hd + 2);
      flattenColumn(front.x, front.z, VK.DIRT);
      // 屋旁点景树（15%）
      if (h2(house.x * 67 + index, house.z * 71 + index * 3) < 0.15) {
        var txp = house.x + (index % 2 === 0 ? 4 : -4), tzp = house.z + 3;
        var ty = ctx.surfaceAt(txp, tzp);
        if (ty > WATER && ty <= ah + 4) {
          for (var lvy = 1; lvy <= 3; lvy++) writer(txp, ty + lvy, tzp, VK.LOG, 'air');
          writer(txp, ty + 4, tzp, VK.LEAVES, 'air');
          writer(txp + 1, ty + 3, tzp, VK.LEAVES, 'air');
        }
      }
    }

    for (var hi = 0; hi < houses.length; hi++) buildHouse(houses[hi], hi);

    // 农田：贴第一座屋东侧的 7×3 木框耕地（中线引水）
    (function () {
      var f = houses[0];
      for (var fx2 = 4; fx2 <= 10; fx2++)
        for (var fz2 = -1; fz2 <= 1; fz2++) {
          var gx = f.x + fx2, gz = f.z + fz2;
          var border = fx2 === 4 || fx2 === 10 || fz2 === -1 || fz2 === 1;
          flattenColumn(gx, gz, border ? VK.LOG : (fx2 === 7 ? VK.WATER : VK.DIRT));
        }
    })();

    // 环村路灯光（对角四向）
    for (var li = 0; li < 4; li++) {
      var lang = li * Math.PI / 2 + Math.PI / 4;
      var lx = v.ax + Math.round(Math.cos(lang) * 24);
      var lz = v.az + Math.round(Math.sin(lang) * 24);
      var ly = ctx.surfaceAt(lx, lz);
      if (ly > WATER && Math.abs(ly - ah) <= 4) writer(lx, ly + 1, lz, VK.TORCH, 'air');
    }
  }

  // 村庄战利品：口粮为主 + 工具/燃料，稀有度低于遗迹但高于野外
  function villageLootFor(v, index) {
    if (!enabled() || !v) return null;
    var items = new Array(27).fill(null);
    var saltBase = v.ax * 7841 + v.az * 65537 + index * 40961;
    var cursor = 2;
    function roll(salt) { return h2(saltBase + salt * 7517, v.variant + salt * 20483); }
    function put(id, n, dur) {
      for (var guard = 0; guard < 27 && items[cursor]; guard++) cursor = (cursor + 1) % 27;
      if (!items[cursor]) items[cursor] = { id: id, n: n, dur: dur === undefined ? null : dur };
      cursor++;
    }
    var meats = [ITEM.COOKED_PORK, ITEM.COOKED_CHICKEN, ITEM.COOKED_RABBIT];
    put(meats[(roll(1) * 3) | 0], 2 + ((roll(2) * 3) | 0));
    put(ITEM.COAL, 3 + ((roll(3) * 5) | 0));
    if (roll(4) < 0.30) {
      var toolId = roll(5) < 0.5 ? ITEM.IRON_PICK : ITEM.IRON_SWORD;
      var remain = Math.max(1, Math.round(251 * (0.45 + roll(6) * 0.45)));
      put(toolId, 1, remain);
    } else if (roll(4) < 0.55) {
      put(ITEM.WARP_CELL, 1);
    } else {
      var crys = CRYSTAL_ITEM[typeKeyOf()] || CRYSTAL_ITEM.lush;
      put(crys, 1 + ((roll(6) * 3) | 0));
    }
    return items;
  }

  // ================= 地下遗迹地窖（埋藏型，需向下开挖发现） =================

  var DUNGEON_HALF = 4;       // 内室半宽（9×9 含墙）
  var DUNGEON_H = 4;          // 内室净高

  function cellDungeon(cellX, cellZ) {
    if (!enabled()) return null;
    var roll = h2(cellX * 307 + 91, cellZ * 311 + 43);
    if (roll >= 0.25) return null;
    var ax = cellX * CELL + 20 + ((h2(cellX * 29 + 61, cellZ * 31 + 7) * 56) | 0);
    var az = cellZ * CELL + 20 + ((h2(cellX * 7 + 83, cellZ * 11 + 19) * 56) | 0);
    if (!(ax + EXTENT < 0 || ax - EXTENT >= W || az + EXTENT < 0 || az - EXTENT >= D)) return null;
    var ah = ctx.surfaceAt(ax, az);
    if (ah <= WATER + 12) return null;   // 必须有足够厚的地下覆层
    var ry = Math.max(8, ah - 16);
    if (ry + DUNGEON_H + 3 >= H) return null;
    return {
      ax: ax, az: az, ry: ry,
      brick: (h2(ax * 101 + 13, az * 103 + 31) < 0.5) ? BLK.BRICK : BLK.BRICK_MOSSY,
      variant: (h2(ax * 107 + 57, az * 109 + 71) * 1024) | 0
    };
  }

  function dungeonChest(dg) {
    return { x: dg.ax, y: dg.ry + 1, z: dg.az };
  }

  function buildDungeon(dg, writer) {
    if (!dg || typeof writer !== 'function') return;
    var ry = dg.ry;
    var brick = dg.brick;
    var H2 = DUNGEON_HALF;
    // 围壳：全封箱体 + 内部清空（晶簇点缀稀有嵌入墙面）
    for (var dx = -H2 - 1; dx <= H2 + 1; dx++)
      for (var dz = -H2 - 1; dz <= H2 + 1; dz++)
        for (var dy = 0; dy <= DUNGEON_H + 1; dy++) {
          var shell = Math.abs(dx) === H2 + 1 || Math.abs(dz) === H2 + 1 ||
            dy === 0 || dy === DUNGEON_H + 1;
          var x = dg.ax + dx, z = dg.az + dz;
          var id = shell ? (accentRoll({ variant: dg.variant }, x, ry + dy, z) ?
            CRYSTAL_BLOCK[typeKeyOf()] : brick) : 0;
          writer(x, ry + dy, z, id, 'force');
        }
    // 集气角落火把 ×2 + 中央战利品箱
    writer(dg.ax - H2 + 1, ry + 1, dg.az - H2 + 1, BLK.TORCH, 'force');
    writer(dg.ax + H2 - 1, ry + 1, dg.az + H2 - 1, BLK.TORCH, 'force');
    var chest = dungeonChest(dg);
    writer(chest.x, chest.y, chest.z, 38, 'force');
    // 地表线索：一根 1×3 苔痕砖柱（好奇的玩家会往下挖）
    var gy = ctx.surfaceAt(dg.ax, dg.az);
    writer(dg.ax, gy + 1, dg.az, BLK.BRICK_MOSSY, 'air');
    writer(dg.ax, gy + 2, dg.az, BLK.BRICK_MOSSY, 'air');
  }

  function dungeonLootFor(dg) {
    if (!enabled() || !dg) return null;
    var items = new Array(27).fill(null);
    var saltBase = dg.ax * 16807 + dg.az * 132721;
    var cursor = 2;
    function roll(salt) { return h2(saltBase + salt * 8059, dg.variant + salt * 49999); }
    function put(id, n, dur) {
      for (var guard = 0; guard < 27 && items[cursor]; guard++) cursor = (cursor + 1) % 27;
      if (!items[cursor]) items[cursor] = { id: id, n: n, dur: dur === undefined ? null : dur };
      cursor++;
    }
    put(ITEM.WARP_CELL, 1 + ((roll(1) * 2) | 0));   // 地窖主奖励：电池 ×1-2
    var crys = CRYSTAL_ITEM[typeKeyOf()] || CRYSTAL_ITEM.lush;
    put(crys, 3 + ((roll(2) * 5) | 0));
    var toolId = roll(3) < 0.5 ? ITEM.IRON_PICK : ITEM.IRON_SWORD;
    put(toolId, 1, Math.max(1, Math.round(251 * (0.62 + roll(4) * 0.34))));
    put(ITEM.COAL, 6 + ((roll(5) * 6) | 0));
    var meats = [ITEM.COOKED_PORK, ITEM.COOKED_CHICKEN, ITEM.COOKED_RABBIT];
    put(meats[(roll(6) * 3) | 0], 2 + ((roll(7) * 2) | 0));
    return items;
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
    findRuinNear: findRuinNear,
    // 村落聚居地
    VILLAGE_CELL: VILLAGE_CELL,
    VILLAGE_EXTENT: VILLAGE_EXTENT,
    cellVillage: cellVillage,
    buildVillage: buildVillage,
    villageChests: villageChests,
    villageHouseList: villageHouseList,
    // 地下遗迹地窖
    cellDungeon: cellDungeon,
    buildDungeon: buildDungeon,
    // 北欧城堡 · 峡湾全景
    VISTA_CELL: VISTA_CELL,
    VISTA_EXTENT: VISTA_EXTENT,
    cellVista: cellVista,
    vistaLayout: vistaLayout,
    buildVista: buildVista,
    vistaChests: vistaChests,
    vistaLootFor: vistaLootFor,
    nearestVistaTo: nearestVistaTo,
    vistaGateSpawn: vistaGateSpawn,
    // 星海嘉年华
    PARK_CELL: PARK_CELL,
    PARK_EXTENT: PARK_EXTENT,
    cellPark: cellPark,
    parkLayout: parkLayout,
    parkStations: parkStations,
    boardPositions: boardPositions,
    parkBooths: parkBooths,
    parkTossStall: parkTossStall,
    parkGateSpawn: parkGateSpawn,
    nearestParkTo: nearestParkTo,
    parkChests: parkChests,
    parkLootFor: parkLootFor,
    buildPark: buildPark,
    findParkNear: function (x, z, maxCells) {
      if (!enabled()) return null;
      var baseCx = Math.floor(x / PARK_CELL), baseCz = Math.floor(z / PARK_CELL);
      var limit = Math.max(1, maxCells | 0);
      for (var ring = 0; ring <= limit; ring++)
        for (var dx = -ring; dx <= ring; dx++)
          for (var dz = -ring; dz <= ring; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
            var park = cellPark(baseCx + dx, baseCz + dz);
            if (park) return park;
          }
      return null;
    }
  };
})();
