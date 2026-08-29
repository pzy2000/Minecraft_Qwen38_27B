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

  // 反查：给定坐标是否是某遗迹/乐园售票亭的箱子位；是则返回确定性战利品。
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
        controls: [
          [10, -30, 0], [14, -26, 1], [22, -33, 4], [30, -44, 8],
          [30, -56, 12], [20, -62, 16], [10, -58, 20], [6, -46, 23],
          [12, -40, 25], [16, -52, 28], [26, -56, 26], [36, -50, 20],
          [42, -40, 14], [44, -28, 8], [40, -14, 5], [30, -6, 3], [18, -14, 1],
          [10, -26, 0]
        ]
      },
      tron: { gx0: 42, gx1: 84, gz: 6, board: [46, 6], loopTopY: 22 }
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
    for (var i = 0; i < L.coaster.controls.length; i++)
      ctr.push(X([L.coaster.controls[i][0], L.coaster.controls[i][1]])
        .concat([ah + L.coaster.controls[i][2]]));
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

  function boardPositions(park) {
    var st = parkStations(park);
    return st.filter(function (s) { return s.board; })
      .map(function (s) { return { kind: s.kind, name: s.name, x: s.board.x, y: s.board.y, z: s.board.z }; });
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
      // A 字腿：沿局部 x 向展宽、向上收拢直达轮毂（前后双柱形成立体门架）
      var HUB_Y = 30;
      for (var legY = 1; legY <= HUB_Y - 2; legY++) {
        var spread = Math.max(1, Math.round((HUB_Y - 2 - legY) * 0.52));
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
      // 中轴轮毂
      var hp = S(fx, fz);
      box(writer, park, hp[0] - 1, hp[1] - 1, hp[0] + 1, hp[1] + 1, ah + 26, ah + 34, PK.STONE);
      writer(hp[0], ah + 30, hp[1], PK.GOLD, 'force');
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
          box(writer, park, S(dx2 - 2, dz2)[0], S(dx2, dz2 - 2)[1],
            S(dx2 + 2, dz2)[0], S(dx2, dz2 + 2)[1], ah + ty, ah + ty, PK.GOLD);
        }
      }
      // 塔冠 + 信标灯
      var dp = S(dx2, dz2);
      box(writer, park, dp[0] - 2, dp[1] - 2, dp[0] + 2, dp[1] + 2, ah + th + 1, ah + th + 1, PK.GOLD);
      writer(dp[0], ah + th + 2, dp[1], PK.LANTERN, 'air');
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
        // 山腰树带（松矮林点缀）
        if (li >= 1 && li <= 2) {
          for (var tX = ccst[0] - lyr.rx + 3; tX <= ccst[0] + lyr.rx - 3; tX += 7) {
            var tz1 = ccst[1] + (li % 2 ? 1 : -1) * (lyr.rz - 4);
            var tp = S(tX, tz1);
            var gsy = ctx ? ctx.surfaceAt(tp[0], tp[1]) : ah;
            if (Math.abs(gsy - (ah + lyr.dy)) > 4) continue;
            writer(tp[0], gsy + 1, tp[1], PK.LOG, 'air');
            writer(tp[0], gsy + 2, tp[1], PK.LEAVES, 'air');
            writer(tp[0], gsy + 3, tp[1], PK.LEAVES, 'air');
          }
        }
      });
      // 山峰旗杆
      var flag = S(ccst[0], ccst[1]);
      writer(flag[0], ah + 30, flag[1], PK.CANDY, 'force');
      writer(flag[0], ah + 31, flag[1], PK.BUNTING, 'air');
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
        // 入口门框强化
        if (gx === T2.gx0 || gx === T2.gx1) {
          for (var fr = T2.gz - 4; fr <= T2.gz + 4; fr++) {
            fCol(gx, fr, 0, PK.BLUE, true);
            for (var fy2 = 1; fy2 <= 7; fy2++) F(gx, fr, fy2, PK.BLUE);
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
      F(kcx, kcz + 6, 5, 0, 'force'); F(kcx, kcz + 6, 6, 0, 'force');
      F(kcx - 1, kcz + 6, 5, 0, 'force'); F(kcx + 1, kcz + 6, 5, 0, 'force');
      // 檐口
      for (var ex3 = kcx - 7; ex3 <= kcx + 7; ex3++)
        for (var ez3 = kcz - 7; ez3 <= kcz + 7; ez3++) {
          var ee = Math.abs(ex3 - kcx) === 7 || Math.abs(ez3 - kcz) === 7;
          if (!ee) continue;
          var inner = Math.abs(ex3 - kcx) <= 6 && Math.abs(ez3 - kcz) <= 6;
          if (inner) continue;
          F(ex3, ez3, 15, PK.GOLD);
        }
      // 四角塔 Ø5 高 26 + 蓝锥顶
      [[-6, -6], [6, -6], [-6, 6], [6, 6]].forEach(function (tpos) {
        var tx3 = kcx + tpos[0], tz3 = kcz + tpos[1];
        for (var ty2 = 1; ty2 <= 26; ty2++) {
          for (var ddx = -2; ddx <= 2; ddx++) for (var ddz = -2; ddz <= 2; ddz++) {
            var cd2 = ddx * ddx + ddz * ddz;
            if (cd2 > 5.2) continue;
            if (cd2 <= 2.2 && ty2 <= 24 && ty2 > 1) continue;       // 中空
            F(tx3 + ddx, tz3 + ddz, ty2, cd2 > 3 ? PK.BLUE : PK.PINK);
          }
        }
        roofPyramid(function (x, y, z, id) { writer(x, y, z, id, 'force'); },
          S(tx3, tz3)[0], S(tx3, tz3)[1], ah + 27, 3, 4, PK.ROOF);
        F(tx3, tz3, 31, PK.LANTERN);
      });
      // 中央尖塔信标：keep 上方 + 上升到 52
      for (var sy = 15; sy <= 52; sy++) {
        var rw = sy < 18 ? 3 : sy < 24 ? 2 : sy < 34 ? 1 : sy < 50 ? 1 : 1;
        if (sy === 18 || sy === 24 || sy === 34) {
          box(writer, park, S(kcx - rw, kcz)[0], S(kcx, kcz - rw)[1],
            S(kcx + rw, kcz)[0], S(kcx, kcz + rw)[1], ah + sy, ah + sy, PK.GOLD);
        } else {
          F(kcx, kcz, sy, sy % 10 === 9 ? PK.BLUE : PK.PINK);
        }
      }
      F(kcx, kcz, 53, PK.LANTERN);
      F(kcx, kcz, 54, PK.GOLD);
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

    // ---- 12. 统一放置乘坐台（最后写入：放射步道/站台铺装不得覆盖 PAD）----
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
    // 星海嘉年华
    PARK_CELL: PARK_CELL,
    PARK_EXTENT: PARK_EXTENT,
    cellPark: cellPark,
    parkLayout: parkLayout,
    parkStations: parkStations,
    boardPositions: boardPositions,
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
