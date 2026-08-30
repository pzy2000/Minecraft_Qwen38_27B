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
