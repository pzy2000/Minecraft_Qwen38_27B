// 世界：数据、地形生成、区块网格重建管理
window.Voxel = window.Voxel || {};

Voxel.World = (function () {
  var CFG = Voxel.Config;
  var W = CFG.WORLD_W, H = CFG.WORLD_H, D = CFG.WORLD_D, CS = CFG.CHUNK;
  var WATER = CFG.WATER_LEVEL;
  var SNOW_LEVEL = CFG.SNOW_LEVEL;

  var data, seed, noise, heights;
  var biomes;            // Uint8Array(W*D) 每列群系 ID
  var shaper = null;     // 地形塑造器（样条 + 密度场）
  var climateAt = null;  // 气候采样器（MultiNoise 五维参数）
  var edits = {};        // "x,y,z" -> id（存档用）
  var dirty = {};        // "cx,cz" -> true
  var dirtyQueue = [];
  var chunks = {};       // "cx,cz" -> {mesh, wmesh}
  var meshGroup = null;  // THREE.Group
  var genOrder = [], genCount = 0, genPhase = 1;

  // ---- 光照：skyL 天光 / blkL 块光（火把），0-15 ----
  var skyL = null, blkL = null, lightReady = false;
  var LIGHT_RANGE = 15;  // 光最大传播距离（衰减 1/格）

  function opq(id) { return Voxel.Blocks.isOpaque(id); }

  // 进入该格子的光衰减代价（不透明=阻断；水衰减更快）
  function lightCost(id) {
    if (id === 7) return 2;
    return opq(id) ? -1 : 1;
  }

  // 单通道泛光填充：queues[l] 存待处理下标（arr[idx]==l）
  function bfsFill(arr, queues, x0, x1, z0, z1) {
    for (var l = 15; l >= 1; l--) {
      var q = queues[l];
      if (!q) continue;
      for (var qi = 0; qi < q.length; qi++) {
        var i = q[qi];
        if (arr[i] !== l) continue;
        // idx(x,y,z)=x+W*y+W*H*z：z 步长 W*H，y 步长 W
        var z = (i / (W * H)) | 0;
        var rem = i - z * W * H;
        var y = (rem / W) | 0;
        var x = rem - y * W;
        var nl = l - 1;
        if (nl <= 0) continue;
        // 六邻域
        spread(arr, queues, x + 1, y, z, nl, x0, x1, z0, z1);
        spread(arr, queues, x - 1, y, z, nl, x0, x1, z0, z1);
        spread(arr, queues, x, y + 1, z, nl, x0, x1, z0, z1);
        spread(arr, queues, x, y - 1, z, nl, x0, x1, z0, z1);
        spread(arr, queues, x, y, z + 1, nl, x0, x1, z0, z1);
        spread(arr, queues, x, y, z - 1, nl, x0, x1, z0, z1);
      }
    }
  }

  function spread(arr, queues, x, y, z, nl, x0, x1, z0, z1) {
    if (x < x0 || x > x1 || z < z0 || z > z1 || y < 0 || y >= H) return;
    var cost = lightCost(data[idx(x, y, z)]);
    if (cost < 0) return;
    var v = nl - (cost - 1);
    if (v <= 0) return;
    var i = idx(x, y, z);
    if (arr[i] >= v) return;
    arr[i] = v;
    if (!queues[v]) queues[v] = [];
    queues[v].push(i);
  }

  // 区域内重算光照（全高）。全图初始化时传整个世界。
  function relightRegion(rx0, rx1, rz0, rz1) {
    rx0 = Math.max(0, rx0); rx1 = Math.min(W - 1, rx1);
    rz0 = Math.max(0, rz0); rz1 = Math.min(D - 1, rz1);
    var skyQ = [], blkQ = [];

    // 清空区域（idx(x,y,z)=x+W*y+W*H*z：固定 x,z 后 y 步长为 W）
    for (var x = rx0; x <= rx1; x++)
      for (var z = rz0; z <= rz1; z++) {
        var base = idx(x, 0, z);
        for (var y = 0; y < H; y++) {
          var i = base + y * W;
          skyL[i] = 0;
          blkL[i] = 0;
        }
      }

    // 天光：列扫描自顶向下
    for (var x2 = rx0; x2 <= rx1; x2++)
      for (var z2 = rz0; z2 <= rz1; z2++) {
        var l = 15;
        for (var y2 = H - 1; y2 >= 0; y2--) {
          var id = data[idx(x2, y2, z2)];
          if (opq(id)) l = 0;
          else if (id === 7 && l > 0) l = Math.max(0, l - 2);
          skyL[idx(x2, y2, z2)] = l;
        }
      }
    // 天光种子：区域内所有"还能向外传播光"的亮格
    // （直接照亮由列扫描写入；此处只挑出邻居更暗的可传播格，避免塞入全部亮格）
    seedSky(skyQ, rx0, rx1, rz0, rz1);

    // 块光种子：区域内火把 + 边界导入
    for (var x3 = rx0; x3 <= rx1; x3++)
      for (var z3 = rz0; z3 <= rz1; z3++)
        for (var y3 = 0; y3 < H; y3++) {
          var i3 = idx(x3, y3, z3);
          if (data[i3] === 19 && Voxel.Blocks.defs[19].light) {
            blkL[i3] = Voxel.Blocks.defs[19].light;
            blkQ.push(i3);
          }
        }
    seedBlk(blkQ, rx0, rx1, rz0, rz1);

    bfsFill(skyL, bucket(skyQ, skyL), rx0, rx1, rz0, rz1);
    bfsFill(blkL, bucket(blkQ, blkL), rx0, rx1, rz0, rz1);
  }

  // 把种子数组转成按亮度分桶的结构
  function bucket(seeds, arr) {
    var q = [];
    for (var i = 0; i < seeds.length; i++) {
      var l = arr[seeds[i]];
      if (l > 0) { if (!q[l]) q[l] = []; q[l].push(seeds[i]); }
    }
    return q;
  }

  function pushSeed(q, arr, x, y, z) {
    if (y < 0 || y >= H) return;
    var i = idx(x, y, z);
    if (arr[i] > 1) q.push(i);
  }

  // 挑出区域内所有可传播的天光亮格：自身 skyL>1 且存在更暗的可通行邻居
  function seedSky(q, rx0, rx1, rz0, rz1) {
    for (var x = rx0; x <= rx1; x++)
      for (var z = rz0; z <= rz1; z++)
        for (var y = 0; y < H; y++) {
          var i = idx(x, y, z);
          var v = skyL[i];
          if (v <= 1) continue;
          if (canSpread(skyL, x, y, z, v, rx0, rx1, rz0, rz1)) q.push(i);
        }
    // 区域外边界一格的光照导入
    importBorder(q, skyL, rx0, rx1, rz0, rz1);
  }

  function canSpread(arr, x, y, z, v, x0, x1, z0, z1) {
    return darkerNeighbor(arr, x + 1, y, z, v, x0, x1, z0, z1) ||
      darkerNeighbor(arr, x - 1, y, z, v, x0, x1, z0, z1) ||
      darkerNeighbor(arr, x, y + 1, z, v, x0, x1, z0, z1) ||
      darkerNeighbor(arr, x, y - 1, z, v, x0, x1, z0, z1) ||
      darkerNeighbor(arr, x, y, z + 1, v, x0, x1, z0, z1) ||
      darkerNeighbor(arr, x, y, z - 1, v, x0, x1, z0, z1);
  }

  function darkerNeighbor(arr, x, y, z, v, x0, x1, z0, z1) {
    if (x < x0 || x > x1 || z < z0 || z > z1 || y < 0 || y >= H) return false;
    if (lightCost(data[idx(x, y, z)]) < 0) return false;
    return arr[idx(x, y, z)] < v - 1;
  }

  function seedBlk(q, rx0, rx1, rz0, rz1) {
    importBorder(q, blkL, rx0, rx1, rz0, rz1);
  }

  function importBorder(q, arr, rx0, rx1, rz0, rz1) {
    if (rx0 === 0 && rx1 === W - 1 && rz0 === 0 && rz1 === D - 1) return;
    for (var x = rx0 - 1; x <= rx1 + 1; x++) {
      if (x < 0 || x >= W) continue;
      for (var zz = rx0 - 1; zz <= rz1 + 1; zz++) {
        if (zz < 0 || zz >= D) continue;
        if (x >= rx0 && x <= rx1 && zz >= rz0 && zz <= rz1) continue;
        for (var y = 0; y < H; y++) {
          var i = idx(x, y, zz);
          if (arr[i] > 1) q.push(i);
        }
      }
    }
  }

  function initLight() {
    if (!skyL) { skyL = new Uint8Array(W * H * D); blkL = new Uint8Array(W * H * D); }
    lightReady = true;
    relightRegion(0, W - 1, 0, D - 1);
  }

  function idx(x, y, z) { return x + W * (y + H * z); }

  // ---- 地形生成：3D 密度场（样条塑造 + 插值单元） ----

  // 仅当目标格为石/矿时覆写，避免填掉洞穴空气
  function setIfStoneW(x, y, z, id) {
    var i = idx(x, y, z);
    var c = data[i];
    if (c === 3 || c === 8 || c === 9) data[i] = id;
  }

  // 表层规则：按群系与地形上下文决定表层/填充层
  function applySurface(x, z, ts, b, bd) {
    var BI = Voxel.Biomes.B, BL = Voxel.Biomes.BLK;
    if (ts < 3) return;
    var patch = noise.hash2((x >> 3) * 31 + 7, (z >> 3) * 17 + 5);   // 粗粒度斑块
    var surf = bd.surface, fill = bd.filler;

    // 水下海床：沙/砂砾/泥土混合
    if (ts <= WATER) {
      surf = patch < 0.45 ? BL.SAND : (patch < 0.75 ? BL.GRAVEL : BL.DIRT);
      data[idx(x, ts, z)] = surf;
      for (var d0 = 1; d0 <= 3 && ts - d0 > 1; d0++)
        setIfStoneW(x, ts - d0, z, surf === BL.DIRT ? BL.DIRT : BL.SAND);
      return;
    }

    // 沙滩化：近水位的普通群系表层铺沙
    if (ts <= WATER + 2 && b !== BI.STONY_SHORE &&
        b !== BI.JAGGED_PEAKS && b !== BI.FROZEN_PEAKS && b !== BI.STONY_PEAKS &&
        !bd.badlandsBands) {
      surf = BL.SAND; fill = BL.SAND;
    }
    // 风袭丘陵：砾石斑块
    if (bd.gravelPatches && patch < 0.22) { surf = BL.GRAVEL; fill = BL.STONE; }

    data[idx(x, ts, z)] = surf;
    for (var d = 1; d <= 3; d++) {
      if (ts - d <= 1) break;
      setIfStoneW(x, ts - d, z, fill);
    }
    // 沙漠：砂岩垫层
    if (b === BI.DESERT)
      for (var yd = Math.max(2, ts - 8); yd <= ts - 4; yd++) setIfStoneW(x, yd, z, 27);
    // 恶地：陶瓦层理（绝对 y 分层 + 列间抖动）
    if (bd.badlandsBands) {
      var dith = (noise.hash2(x * 13 + 1, z * 7 + 9) * 3) | 0;
      var bands = [BL.TERRACOTTA, BL.TERRACOTTA, 30, BL.TERRACOTTA, 31, 30];
      for (var yb = Math.max(2, ts - 16); yb <= ts - 4; yb++) {
        var bandIdx = (((yb + dith) / 3) | 0) % bands.length;
        if (bandIdx < 0) bandIdx += bands.length;
        setIfStoneW(x, yb, z, bands[bandIdx]);
      }
    }
    // 雪帽（山峰雪线更低；恶地/沙漠除外）
    var snowLine = (b === BI.JAGGED_PEAKS || b === BI.FROZEN_PEAKS) ? 40 : SNOW_LEVEL;
    if (b !== BI.DESERT && b !== BI.BADLANDS && ts >= snowLine)
      data[idx(x, ts, z)] = 18;
  }

  function generateColumn(x, z, lx, lz, lat) {
    var ci = x + W * z;
    var cl = shaper.sampleClim(lat, lx, lz);
    var b = Voxel.Biomes.pick(cl);
    biomes[ci] = b;
    var bd = Voxel.Biomes.def(b);
    var th = shaper.sampleTh(lat, lx, lz);

    var topSolid = -1, i;
    for (var y = 0; y < H; y++) {
      i = idx(x, y, z);
      // 基岩层（带随机起伏）
      if (y === 0 || (y === 1 && noise.hash3(x, y, z) < 0.55) ||
          (y === 2 && noise.hash3(x + 31, y, z) < 0.25)) {
        data[i] = 12; topSolid = y; continue;
      }
      var d = shaper.sampleLat(lat.dens, lat, lx, y, lz);
      var solid = d > 0;
      // 洞穴挖掘（水下柱体不挖，防海床塌陷成水洞）
      if (solid && th > WATER + 1 && y > 2 &&
          shaper.isCave(
            shaper.sampleLat(lat.cavA, lat, lx, y, lz),
            shaper.sampleLat(lat.cavB, lat, lx, y, lz),
            shaper.sampleLat(lat.chee, lat, lx, y, lz),
            y, th)) solid = false;
      if (solid) {
        data[i] = 3;                                   // 石身
        var r = noise.hash3(x, y, z);
        if (y < 50 && r < 0.007) data[i] = 8;          // 煤
        else if (y < 34 && r > 0.994) data[i] = 9;     // 铁
        topSolid = y;
      } else {
        data[i] = y <= WATER ? 7 : 0;
      }
    }
    heights[ci] = topSolid < 0 ? WATER : topSolid;
    applySurface(x, z, topSolid, b, bd);
  }

  // ---- 树木/植被放置 ----

  function setIfAir(x, y, z, id) {
    if (y <= 0 || y >= H) return;
    var i = idx(x, y, z);
    if (data[i] === 0) data[i] = id;
  }

  // 圆形树叶环（半径>1 时削角）
  function ring(cx, cy, cz, rad, id) {
    for (var dx = -rad; dx <= rad; dx++)
      for (var dz = -rad; dz <= rad; dz++) {
        if (rad > 1 && Math.abs(dx) === rad && Math.abs(dz) === rad) continue;
        setIfAir(cx + dx, cy, cz + dz, id);
      }
  }

  function oakTree(x, h, z, r) {
    var th = 4 + ((r * 100000) | 0) % 3;
    for (var y = 1; y <= th; y++) data[idx(x, h + y, z)] = 4;
    for (var ly = th - 2; ly <= th + 1; ly++) {
      var rad = ly === th + 1 ? 1 : 2;
      for (var dx = -rad; dx <= rad; dx++)
        for (var dz = -rad; dz <= rad; dz++) {
          if (dx === 0 && dz === 0 && ly <= th) continue;
          if (rad === 2 && ly >= th && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          setIfAir(x + dx, h + ly, z + dz, 5);
        }
    }
    setIfAir(x, h + th + 2, z, 5);
  }

  function spruceTree(x, h, z, r) {
    var th = 6 + ((r * 100000) | 0) % 4;
    for (var y = 1; y <= th; y++) data[idx(x, h + y, z)] = 20;
    for (var ly = 2; ly <= th + 1; ly++) {
      var rad = ly > th ? 0 : (ly === th ? 1 : (((th - ly) % 2 === 0) ? 1 : 2));
      if (rad === 0) { setIfAir(x, h + ly, z, 21); continue; }
      ring(x, h + ly, z, rad, 21);
      if (rad === 2) setIfAir(x, h + ly, z, 20);
    }
  }

  // 原始针叶林：2x2 粗壮巨型云杉
  function megaSpruce(x, h, z, r) {
    // 需要四列地基同高且可种植，避免悬空粗树干
    var ci = x + W * z;
    if (heights[ci + 1] !== h || heights[ci + W] !== h || heights[ci + W + 1] !== h) return false;
    var th = 12 + ((r * 100000) | 0) % 6;
    if (h + th + 3 >= H) th = H - 4 - h;
    if (th < 10) return false;
    for (var y = 1; y <= th; y++)
      for (var dx = 0; dx <= 1; dx++)
        for (var dz = 0; dz <= 1; dz++)
          data[idx(x + dx, h + y, z + dz)] = 20;
    for (var ly = 5; ly <= th + 2; ly++) {
      var rem = th + 2 - ly;
      var rad = rem <= 0 ? 1 : (rem % 2 === 0 ? 2 : 3);
      ring(x, h + ly, z, rad, 21);
      if (rad >= 2)
        for (var bx = 0; bx <= 1; bx++)
          for (var bz = 0; bz <= 1; bz++) {
            var ii = idx(x + bx, h + ly, z + bz);
            if (data[ii] === 21) data[ii] = 20;
          }
    }
    setIfAir(x, h + th + 3, z, 21);
    return true;
  }

  function jungleTree(x, h, z, r) {
    var th = 6 + ((r * 100000) | 0) % 6;
    for (var y = 1; y <= th; y++) data[idx(x, h + y, z)] = 22;
    ring(x, h + th - 1, z, 2, 23);
    data[idx(x, h + th - 1, z)] = 22;
    ring(x, h + th, z, 2, 23);
    data[idx(x, h + th, z)] = 22;
    ring(x, h + th + 1, z, 1, 23);
    setIfAir(x, h + th + 2, z, 23);
  }

  // 丛林：2x2 高耸巨型丛林树（30+ 格，受世界高度截断）
  function giantJungle(x, h, z, r) {
    var ci = x + W * z;
    if (heights[ci + 1] !== h || heights[ci + W] !== h || heights[ci + W + 1] !== h) return false;
    var th = 24 + ((r * 100000) | 0) % 8;
    if (h + th + 4 >= H) th = H - 5 - h;
    if (th < 14) return false;
    for (var y = 1; y <= th; y++)
      for (var dx = 0; dx <= 1; dx++)
        for (var dz = 0; dz <= 1; dz++)
          data[idx(x + dx, h + y, z + dz)] = 22;
    ring(x, h + th - 1, z, 3, 23);
    ring(x, h + th, z, 3, 23);
    ring(x, h + th + 1, z, 2, 23);
    ring(x, h + th + 2, z, 1, 23);
    setIfAir(x, h + th + 3, z, 23);
    // 树冠内树干保留
    for (var ty = th - 1; ty <= th; ty++)
      for (var tx = 0; tx <= 1; tx++)
        for (var tz = 0; tz <= 1; tz++) data[idx(x + tx, h + ty, z + tz)] = 22;
    return true;
  }

  function cactus(x, h, z, r) {
    var ch = 1 + ((r * 100000) | 0) % 3;
    for (var y = 1; y <= ch; y++) setIfAir(x, h + y, z, 26);
  }

  // 白桦树：细高树干 + 圆柱树冠
  function birchTree(x, h, z, r) {
    var th = 5 + ((r * 100000) | 0) % 3;
    for (var y = 1; y <= th; y++) data[idx(x, h + y, z)] = 33;
    for (var ly = th - 2; ly <= th + 1; ly++) {
      var rad = ly === th + 1 ? 1 : 2;
      for (var dx = -rad; dx <= rad; dx++)
        for (var dz = -rad; dz <= rad; dz++) {
          if (dx === 0 && dz === 0 && ly <= th) continue;
          if (rad === 2 && ly >= th && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          setIfAir(x + dx, h + ly, z + dz, 34);
        }
    }
    setIfAir(x, h + th + 2, z, 34);
  }

  // 金合欢树：斜干简化为直干 + 扁平伞状树冠
  function acaciaTree(x, h, z, r) {
    var th = 4 + ((r * 100000) | 0) % 2;
    for (var y = 1; y <= th; y++) data[idx(x, h + y, z)] = 35;
    ring(x, h + th, z, 2, 36);
    data[idx(x, h + th, z)] = 35;
    ring(x, h + th + 1, z, 1, 36);
    setIfAir(x, h + th + 2, z, 36);
  }

  // 原始针叶林：苔石巨砾
  function boulder(x, h, z) {
    for (var dy = -1; dy <= 2; dy++)
      for (var dx = -2; dx <= 2; dx++)
        for (var dz = -2; dz <= 2; dz++) {
          if (dx * dx + dz * dz + dy * dy * 1.6 > 3.4) continue;
          var i = idx(x + dx, h + dy, z + dz);
          if (data[i] !== 12 && data[i] !== 7) data[i] = 25;
        }
  }

  function placeTrees() {
    var defs = Voxel.Biomes.defs;
    for (var x = 2; x < W - 3; x++)
      for (var z = 2; z < D - 3; z++) {
        var ci = x + W * z;
        var h = heights[ci];
        if (h <= WATER + 1 || h > SNOW_LEVEL - 2) continue;
        var bd = defs[biomes[ci]];
        if (!bd || !bd.treeType) continue;
        var surfId = data[idx(x, h, z)];
        if (bd.plantOn.indexOf(surfId) < 0) continue;
        if (bd.boulders && noise.hash2(x * 7 + 61, z * 7 + 83) < 0.0025) { boulder(x, h, z); continue; }
        var r = noise.hash2(x * 3 + 11, z * 5 + 29);
        if (r >= bd.treeChance) continue;
        switch (bd.treeType) {
          case 'oak': oakTree(x, h, z, r); break;
          case 'spruce': spruceTree(x, h, z, r); break;
          case 'cactus': cactus(x, h, z, r); break;
          case 'birch': birchTree(x, h, z, r); break;
          case 'acacia': acaciaTree(x, h, z, r); break;
          case 'jungle':
            var rg = noise.hash2(x * 5 + 3, z * 7 + 97);
            if (!(rg < bd.giantChance && giantJungle(x, h, z, rg))) jungleTree(x, h, z, r);
            break;
          case 'mega_spruce':
            if (!megaSpruce(x, h, z, r)) spruceTree(x, h, z, r);
            break;
        }
      }
  }

  function markDirty(x, z) {
    if (x < 0 || z < 0 || x >= W || z >= D) return;
    markChunkDirty(x / CS | 0, z / CS | 0);
  }

  function markChunkDirty(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= W / CS || cz >= D / CS) return;
    var key = cx + ',' + cz;
    if (!dirty[key]) { dirty[key] = true; dirtyQueue.push(key); }
  }

  function get(x, y, z) {
    if (y < 0) return 12;
    if (y >= H) return 0;
    if (x < 0 || x >= W || z < 0 || z >= D) return 12;
    return data[idx(x, y, z)];
  }

  function set(x, y, z, id) {
    if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= D) return;
    data[idx(x, y, z)] = id;
    edits[x + ',' + y + ',' + z] = id;
    if (lightReady) {
      var R = LIGHT_RANGE;
      relightRegion(x - R, x + R, z - R, z + R);
      // 光照影响可达 15格外：把重算区域内所有区块都标脏
      for (var cx = (x - R) / CS | 0; cx <= (x + R) / CS | 0; cx++)
        for (var cz = (z - R) / CS | 0; cz <= (z + R) / CS | 0; cz++)
          markChunkDirty(cx, cz);
    } else {
      markDirty(x, z);
    }
    if (x % CS === 0) markDirty(x - 1, z);
    if (x % CS === CS - 1) markDirty(x + 1, z);
    if (z % CS === 0) markDirty(x, z - 1);
    if (z % CS === CS - 1) markDirty(x, z + 1);
  }

  function generateChunkData(cx, cz) {
    var lat = shaper.computeChunkLattice(cx, cz, climateAt);
    var x0 = cx * CS, z0 = cz * CS;
    for (var lx = 0; lx < CS; lx++)
      for (var lz = 0; lz < CS; lz++)
        generateColumn(x0 + lx, z0 + lz, lx, lz, lat);
    markChunkDirty(cx, cz);
  }

  function init(s) {
    seed = Voxel.SeedUtil.toString(Voxel.SeedUtil.toBigInt(s)); // 规范化为带符号十进制串
    noise = Voxel.Noise.create(seed);
    climateAt = Voxel.Biomes.makeClimate(noise);
    shaper = Voxel.Shaper.create(noise);
    data = new Uint8Array(W * H * D);
    heights = new Int16Array(W * D);
    biomes = new Uint8Array(W * D);
    edits = {};
    dirty = {};
    dirtyQueue = [];
    chunks = {};
    lightReady = false;
    genCount = 0;
    genPhase = 1;
    genOrder = [];
    var nCx = W / CS, nCz = D / CS;
    var ccx = (nCx - 1) / 2, ccz = (nCz - 1) / 2;
    for (var cx = 0; cx < nCx; cx++)
      for (var cz = 0; cz < nCz; cz++)
        genOrder.push([cx, cz, (cx - ccx) * (cx - ccx) + (cz - ccz) * (cz - ccz)]);
    genOrder.sort(function (a, b) { return a[2] - b[2]; });
  }

  function generateNext(n) {
    while (n-- > 0 && genPhase > 0 && genCount < genOrder.length) {
      var c = genOrder[genCount++];
      generateChunkData(c[0], c[1]);
    }
    if (genPhase === 1 && genCount >= genOrder.length) {
      genPhase = 2;
      placeTrees();
      genPhase = 0;
    }
  }

  function progress() {
    if (genPhase === 0) return 1;
    return genCount / genOrder.length;
  }

  function isReady() { return genPhase === 0; }

  function centerMeshed() {
    var n = W / CS, c = (n / 2) | 0;
    for (var dx = -1; dx <= 1; dx++)
      for (var dz = -1; dz <= 1; dz++) {
        var cx = c + dx, cz = c + dz;
        if (cx < 0 || cz < 0 || cx >= n || cz >= n) continue;
        if (!chunks[cx + ',' + cz]) return false;
      }
    return true;
  }

  // 建网格焦点（优先构建焦点周围的区块）
  var focus = { x: W / 2, z: D / 2 };
  function setFocus(x, z) {
    if (isFinite(x)) focus.x = x;
    if (isFinite(z)) focus.z = z;
  }
  function focusDist(cx, cz) {
    var dx = cx * CS + CS / 2 - focus.x;
    var dz = cz * CS + CS / 2 - focus.z;
    return dx * dx + dz * dz;
  }
  function focusMeshed() {
    var n = W / CS;
    var c = (focus.x / CS) | 0, r = (focus.z / CS) | 0;
    if (c < 0 || c >= n || r < 0 || r >= n) return true;
    for (var dx = -1; dx <= 1; dx++)
      for (var dz = -1; dz <= 1; dz++) {
        var cx = c + dx, cz = r + dz;
        if (cx < 0 || cz < 0 || cx >= n || cz >= n) continue;
        if (!chunks[cx + ',' + cz]) return false;
      }
    return true;
  }

  function surfaceAt(x, z) {
    if (x < 0 || x >= W || z < 0 || z >= D) return -1;
    for (var y = H - 1; y >= 0; y--)
      if (Voxel.Blocks.isSolid(get(x, y, z))) return y;
    return -1;
  }

  function spawnPoint() {
    var x = W >> 1, z = D >> 1;
    var y = surfaceAt(x, z);
    if (y < 1) y = H - 2;
    return new THREE.Vector3(x + 0.5, y + 1.01, z + 0.5);
  }

  function applyEdits(ed) {
    if (!ed) return;
    var bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity, any = false;
    for (var k in ed) {
      var p = k.split(',');
      var x = +p[0], y = +p[1], z = +p[2];
      if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D) {
        data[idx(x, y, z)] = ed[k];
        any = true;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (z < bz0) bz0 = z;
        if (z > bz1) bz1 = z;
      }
    }
    if (!any) return;
    if (lightReady) {
      var R = LIGHT_RANGE;
      relightRegion(bx0 - R, bx1 + R, bz0 - R, bz1 + R);
      for (var cx = Math.max(0, (bx0 - R) / CS | 0); cx <= Math.min(W / CS - 1, (bx1 + R) / CS | 0); cx++)
        for (var cz = Math.max(0, (bz0 - R) / CS | 0); cz <= Math.min(D / CS - 1, (bz1 + R) / CS | 0); cz++)
          markChunkDirty(cx, cz);
    } else {
      for (var k2 in ed) {
        var p2 = k2.split(',');
        markDirty(+p2[0], +p2[2]);
      }
    }
  }

  function buildMeshes(n, scene) {
    if (!meshGroup) meshGroup = new THREE.Group();
    if (meshGroup.parent !== scene) scene.add(meshGroup);
    var built = 0;
    while (dirtyQueue.length && built < n) {
      // 优先构建离焦点最近的区块
      var bi = 0, bd = Infinity;
      for (var i = 0; i < dirtyQueue.length; i++) {
        var qp = dirtyQueue[i].split(',');
        var qd = focusDist(+qp[0], +qp[1]);
        if (qd < bd) { bd = qd; bi = i; }
      }
      var key = dirtyQueue.splice(bi, 1)[0];
      delete dirty[key];
      var parts = key.split(',');
      var cx = +parts[0], cz = +parts[1];
      var old = chunks[key];
      if (old) {
        if (old.mesh) { meshGroup.remove(old.mesh); old.mesh.geometry.dispose(); }
        if (old.wmesh) { meshGroup.remove(old.wmesh); old.wmesh.geometry.dispose(); }
      }
      var res = Voxel.MeshBuilder.build(cx, cz);
      var ch = {};
      if (res.opaque) {
        ch.mesh = new THREE.Mesh(res.opaque, Voxel.MeshBuilder.opaqueMat());
        meshGroup.add(ch.mesh);
      }
      if (res.water) {
        ch.wmesh = new THREE.Mesh(res.water, Voxel.MeshBuilder.waterMat());
        ch.wmesh.renderOrder = 2;
        meshGroup.add(ch.wmesh);
      }
      chunks[key] = ch;
      built++;
    }
  }

  function clearMeshes(scene) {
    if (meshGroup && meshGroup.parent === scene) {
      var i;
      for (i = meshGroup.children.length - 1; i >= 0; i--) {
        var m = meshGroup.children[i];
        if (m.geometry) m.geometry.dispose();
      }
      scene.remove(meshGroup);
    }
    meshGroup = null;
    chunks = {};
  }

  return {
    init: init,
    generateNext: generateNext,
    progress: progress,
    isReady: isReady,
    centerMeshed: centerMeshed,
    setFocus: setFocus,
    focusMeshed: focusMeshed,
    meshCount: function () { return meshGroup ? meshGroup.children.length : 0; },
    buildMeshes: buildMeshes,
    clearMeshes: clearMeshes,
    get: get,
    set: set,
    surfaceAt: surfaceAt,
    biomeAt: function (x, z) {
      if (x < 0 || x >= W || z < 0 || z >= D) return -1;
      return biomes ? biomes[x + W * z] : 0;
    },
    spawnPoint: spawnPoint,
    applyEdits: applyEdits,
    // 光照接口
    initLight: initLight,
    lightReady: function () { return lightReady; },
    getSky: function (x, y, z) {
      if (y >= H) return 15;
      if (y < 0) return 0;
      if (!lightReady || x < 0 || x >= W || z < 0 || z >= D) return 15;
      return skyL[idx(x, y, z)];
    },
    getBlk: function (x, y, z) {
      if (!lightReady || y < 0 || y >= H || x < 0 || x >= W || z < 0 || z >= D) return 0;
      return blkL[idx(x, y, z)];
    },
    getEdits: function () { return edits; },
    getSeed: function () { return seed; },
    size: function () { return { w: W, h: H, d: D }; }
  };
})();
