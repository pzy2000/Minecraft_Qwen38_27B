// 行星无限 X/Z facade：保留 256×64×256 legacy core，核心外按区块稀疏生成与流式卸载。
//
// 设计约束：
// 1. 旧存档只保存 edits、没有保存自然地形，因此 0..255 核心必须继续由旧 World 原样生成；
// 2. 空间站的外围本来就是真空，不套用行星的无限地表；
// 3. 核心外的自然地形只由 (seed, profile, 全局坐标) 决定，区块加载顺序不影响结果；
// 4. 未加载区块暂按不可穿越方块读取，生成队列会在玩家抵达前铺好 data halo，避免再掉进虚空。
window.Voxel = window.Voxel || {};

(function () {
  'use strict';

  var FiniteWorld = Voxel.World;
  if (!FiniteWorld || FiniteWorld.__infiniteFacade) return;

  var CFG = Voxel.Config;
  var W = CFG.WORLD_W, H = CFG.WORLD_H, D = CFG.WORLD_D, CS = CFG.CHUNK;
  var WATER = CFG.WATER_LEVEL, SNOW_LEVEL = CFG.SNOW_LEVEL;
  var CORE_CX = W / CS, CORE_CZ = D / CS;
  var RENDER_RADIUS = Math.max(2, (CFG.STREAM_RENDER_RADIUS || 6) | 0);
  var DATA_RADIUS = Math.max(RENDER_RADIUS + 1, (CFG.STREAM_DATA_RADIUS || (RENDER_RADIUS + 1)) | 0);
  var KEEP_RADIUS = Math.max(DATA_RADIUS + 1, (CFG.STREAM_KEEP_RADIUS || (DATA_RADIUS + 2)) | 0);
  var FEATURE_RADIUS = 4;
  var BLOCK_LIGHT_RANGE = 15;

  var planetMode = true;
  var profile = null;
  var terrainVersion = 1, planetTypeKey = 'lush';
  var seed = '0';
  var noise = null, climateAt = null, shaper = null;
  var extra = Object.create(null);       // "cx,cz" -> sparse Chunk（核心 8×8 不在此表）
  var extraEdits = Object.create(null);  // 旧格式兼容："x,y,z" -> id
  var editsByChunk = Object.create(null);
  var coreBlkOverlay = null;             // 外围火把跨入 legacy core 的附加块光
  var genQueue = [], genQueued = Object.create(null);
  var meshQueue = [], meshQueued = Object.create(null);
  var extraGroup = null, extraScene = null;
  var focus = { x: W / 2, z: D / 2, cx: null, cz: null };

  function key(cx, cz) { return cx + ',' + cz; }
  function posKey(x, y, z) { return x + ',' + y + ',' + z; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function floorDiv(n, d) { return Math.floor(n / d); }
  function localCoord(n, d) {
    var q = floorDiv(n, d);
    return n - q * d;
  }
  function inCore(x, z) { return x >= 0 && x < W && z >= 0 && z < D; }
  function coreChunk(cx, cz) { return cx >= 0 && cx < CORE_CX && cz >= 0 && cz < CORE_CZ; }
  function chunkIndex(lx, y, lz) { return lx + CS * (y + H * lz); }
  function columnIndex(lx, lz) { return lx + CS * lz; }
  function coreLightIndex(x, y, z) { return x + W * (y + H * z); }
  function validXYZ(x, y, z) {
    return Number.isSafeInteger(x) && Number.isSafeInteger(y) && Number.isSafeInteger(z) &&
      y >= 0 && y < H;
  }

  function chunkAtBlock(x, z) {
    return extra[key(floorDiv(x, CS), floorDiv(z, CS))] || null;
  }

  function getFromChunk(ch, x, y, z) {
    return ch.blocks[chunkIndex(localCoord(x, CS), y, localCoord(z, CS))];
  }

  function setInChunk(ch, x, y, z, id) {
    ch.blocks[chunkIndex(localCoord(x, CS), y, localCoord(z, CS))] = id;
  }

  function profileBiome(base, climate, x, z) {
    if (Voxel.PlanetRules && Voxel.PlanetRules.biomeFor)
      return Voxel.PlanetRules.biomeFor(
        terrainVersion, planetTypeKey, base, climate, x, z, noise);
    if (!profile || !profile.typeKey || profile.typeKey === 'lush') return base;
    var B = Voxel.Biomes.B;
    var sets = {
      arid: [B.DESERT, B.BADLANDS, B.SAVANNA, B.STONY_PEAKS],
      frozen: [B.SNOWY, B.FROZEN_PEAKS, B.TAIGA, B.JAGGED_PEAKS],
      toxic: [B.JUNGLE, B.MEGA_TAIGA, B.FOREST, B.SPARSE_JUNGLE],
      volcanic: [B.BADLANDS, B.STONY_PEAKS, B.JAGGED_PEAKS, B.WINDSWEPT_HILLS],
      oceanic: [B.OCEAN, B.BEACH, B.OCEAN, B.SPARSE_JUNGLE]
    };
    var set = sets[profile.typeKey];
    if (!set) return base;
    var r = (noise.hash2(x * 5 + 173, z * 7 + 251) * set.length) | 0;
    return set[Math.min(set.length - 1, r)];
  }

  function setIfStone(ch, lx, y, lz, id) {
    if (y < 0 || y >= H) return;
    var i = chunkIndex(lx, y, lz);
    var old = ch.blocks[i];
    if (old === 3 || old === 8 || old === 9 || (old >= 39 && old <= 44)) ch.blocks[i] = id;
  }

  function applySurface(ch, lx, lz, x, z, top, biome, bd) {
    var BL = Voxel.Biomes.BLK;
    var BI = Voxel.Biomes.B;
    if (top < 3) return;
    var patch = noise.hash2((x >> 3) * 31 + 7, (z >> 3) * 17 + 5);
    var surf = bd.surface, fill = bd.filler;
    if (top <= WATER) {
      surf = patch < 0.45 ? BL.SAND : (patch < 0.75 ? BL.GRAVEL : BL.DIRT);
      ch.blocks[chunkIndex(lx, top, lz)] = surf;
      for (var d0 = 1; d0 <= 3 && top - d0 > 1; d0++)
        setIfStone(ch, lx, top - d0, lz, surf === BL.DIRT ? BL.DIRT : BL.SAND);
      return;
    }
    if (top <= WATER + 2 && biome !== BI.STONY_SHORE &&
      biome !== BI.JAGGED_PEAKS && biome !== BI.FROZEN_PEAKS && biome !== BI.STONY_PEAKS &&
      !bd.badlandsBands) {
      surf = BL.SAND; fill = BL.SAND;
    }
    if (bd.gravelPatches && patch < 0.22) { surf = BL.GRAVEL; fill = BL.STONE; }
    ch.blocks[chunkIndex(lx, top, lz)] = surf;
    for (var d = 1; d <= 3 && top - d > 1; d++) setIfStone(ch, lx, top - d, lz, fill);
    if (biome === BI.DESERT)
      for (var yd = Math.max(2, top - 8); yd <= top - 4; yd++) setIfStone(ch, lx, yd, lz, 27);
    if (bd.badlandsBands) {
      var dith = (noise.hash2(x * 13 + 1, z * 7 + 9) * 3) | 0;
      var bands = [BL.TERRACOTTA, BL.TERRACOTTA, 30, BL.TERRACOTTA, 31, 30];
      for (var yb = Math.max(2, top - 16); yb <= top - 4; yb++) {
        var band = (((yb + dith) / 3) | 0) % bands.length;
        if (band < 0) band += bands.length;
        setIfStone(ch, lx, yb, lz, bands[band]);
      }
    }
    var snowLine = (biome === BI.JAGGED_PEAKS || biome === BI.FROZEN_PEAKS) ? 40 : SNOW_LEVEL;
    if (biome !== BI.DESERT && biome !== BI.BADLANDS && top >= snowLine)
      ch.blocks[chunkIndex(lx, top, lz)] = 18;
  }

  function generateBase(ch) {
    var lat = shaper.computeChunkLattice(ch.cx, ch.cz, climateAt);
    var x0 = ch.cx * CS, z0 = ch.cz * CS;
    for (var lx = 0; lx < CS; lx++) {
      for (var lz = 0; lz < CS; lz++) {
        var x = x0 + lx, z = z0 + lz;
        var cl = shaper.sampleClim(lat, lx, lz);
        var biome = terrainVersion === 2 && Voxel.PlanetRules && Voxel.PlanetRules.pickAllowed
          ? Voxel.PlanetRules.pickAllowed(planetTypeKey, cl, Voxel.Biomes.B.PLAINS)
          : profileBiome(Voxel.Biomes.pick(cl), cl, x, z);
        var ci = columnIndex(lx, lz);
        ch.biomes[ci] = biome;
        var bd = Voxel.Biomes.def(biome);
        var th = shaper.sampleTh(lat, lx, lz);
        var top = -1;
        for (var y = 0; y < H; y++) {
          var i = chunkIndex(lx, y, lz);
          if (y === 0 || (y === 1 && noise.hash3(x, y, z) < 0.55) ||
            (y === 2 && noise.hash3(x + 31, y, z) < 0.25)) {
            ch.blocks[i] = 12; top = y; continue;
          }
          var density = shaper.sampleLat(lat.dens, lat, lx, y, lz);
          var solid = density > 0;
          if (solid && th > WATER + 1 && y > 2 && shaper.isCave(
            shaper.sampleLat(lat.cavA, lat, lx, y, lz),
            shaper.sampleLat(lat.cavB, lat, lx, y, lz),
            shaper.sampleLat(lat.chee, lat, lx, y, lz), y, th)) solid = false;
          if (solid) {
            ch.blocks[i] = 3;
            if (Voxel.PlanetRules && Voxel.PlanetRules.oreBlockForPosition) {
              var oreId = Voxel.PlanetRules.oreBlockForPosition(
                terrainVersion, planetTypeKey, x, y, z, noise);
              if (oreId) ch.blocks[i] = oreId;
            } else {
              var r = noise.hash3(x, y, z);
              if (y < 50 && r < 0.007) ch.blocks[i] = 8;
              else if (y < 34 && r > 0.994) ch.blocks[i] = 9;
            }
            top = y;
          } else ch.blocks[i] = y <= WATER ? 7 : 0;
        }
        ch.heights[ci] = top < 0 ? WATER : top;
        applySurface(ch, lx, lz, x, z, top, biome, bd);
      }
    }
    ch.baseReady = true;
  }

  function newChunk(cx, cz) {
    return {
      cx: cx, cz: cz,
      blocks: new Uint8Array(CS * H * CS),
      heights: new Int16Array(CS * CS),
      biomes: new Uint8Array(CS * CS),
      sky: new Uint8Array(CS * H * CS),
      blk: new Uint8Array(CS * H * CS),
      baseReady: false, ready: false, lit: false, dirty: true, meshed: false,
      mesh: null, wmesh: null
    };
  }

  // 只生成基础地形；装饰阶段可安全查询相邻基础列，且不会递归装饰。
  function ensureBaseChunk(cx, cz) {
    if (coreChunk(cx, cz)) return null;
    var k = key(cx, cz), ch = extra[k];
    if (!ch) { ch = newChunk(cx, cz); extra[k] = ch; }
    if (!ch.baseReady) generateBase(ch);
    return ch;
  }

  function baseSurfaceAt(x, z) {
    if (inCore(x, z)) return FiniteWorld.surfaceAt(x, z);
    var ch = ensureBaseChunk(floorDiv(x, CS), floorDiv(z, CS));
    return ch.heights[columnIndex(localCoord(x, CS), localCoord(z, CS))];
  }

  function baseBiomeAt(x, z) {
    if (inCore(x, z)) return FiniteWorld.biomeAt(x, z);
    var ch = ensureBaseChunk(floorDiv(x, CS), floorDiv(z, CS));
    return ch.biomes[columnIndex(localCoord(x, CS), localCoord(z, CS))];
  }

  function baseBlockAt(x, y, z) {
    if (y < 0) return 12;
    if (y >= H) return 0;
    if (inCore(x, z)) return FiniteWorld.get(x, y, z);
    var ch = ensureBaseChunk(floorDiv(x, CS), floorDiv(z, CS));
    return getFromChunk(ch, x, y, z);
  }

  function inTarget(ch, x, z) {
    return floorDiv(x, CS) === ch.cx && floorDiv(z, CS) === ch.cz;
  }

  function decorSet(ch, x, y, z, id, airOnly) {
    if (y <= 0 || y >= H || !inTarget(ch, x, z)) return;
    var i = chunkIndex(localCoord(x, CS), y, localCoord(z, CS));
    if (!airOnly || ch.blocks[i] === 0) ch.blocks[i] = id;
  }

  function ring(ch, x, y, z, radius, id) {
    for (var dx = -radius; dx <= radius; dx++)
      for (var dz = -radius; dz <= radius; dz++) {
        if (radius > 1 && Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
        decorSet(ch, x + dx, y, z + dz, id, true);
      }
  }

  function oak(ch, x, h, z, r, log, leaves) {
    var th = 4 + ((r * 100000) | 0) % 3;
    for (var y = 1; y <= th; y++) decorSet(ch, x, h + y, z, log, false);
    for (var ly = th - 2; ly <= th + 1; ly++) {
      var rad = ly === th + 1 ? 1 : 2;
      for (var dx = -rad; dx <= rad; dx++) for (var dz = -rad; dz <= rad; dz++) {
        if (dx === 0 && dz === 0 && ly <= th) continue;
        if (rad === 2 && ly >= th && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        decorSet(ch, x + dx, h + ly, z + dz, leaves, true);
      }
    }
    decorSet(ch, x, h + th + 2, z, leaves, true);
  }

  function spruce(ch, x, h, z, r) {
    var th = 6 + ((r * 100000) | 0) % 4;
    for (var y = 1; y <= th; y++) decorSet(ch, x, h + y, z, 20, false);
    for (var ly = 2; ly <= th + 1; ly++) {
      var rad = ly > th ? 0 : (ly === th ? 1 : (((th - ly) % 2 === 0) ? 1 : 2));
      if (!rad) decorSet(ch, x, h + ly, z, 21, true);
      else {
        ring(ch, x, h + ly, z, rad, 21);
        if (rad === 2) decorSet(ch, x, h + ly, z, 20, true);
      }
    }
  }

  function megaSpruce(ch, x, h, z, r) {
    if (baseSurfaceAt(x + 1, z) !== h || baseSurfaceAt(x, z + 1) !== h || baseSurfaceAt(x + 1, z + 1) !== h)
      return false;
    var th = 12 + ((r * 100000) | 0) % 6;
    if (h + th + 3 >= H) th = H - 4 - h;
    if (th < 10) return false;
    for (var y = 1; y <= th; y++) for (var dx = 0; dx <= 1; dx++) for (var dz = 0; dz <= 1; dz++)
      decorSet(ch, x + dx, h + y, z + dz, 20, false);
    for (var ly = 5; ly <= th + 2; ly++) {
      var rem = th + 2 - ly;
      var rad = rem <= 0 ? 1 : (rem % 2 === 0 ? 2 : 3);
      ring(ch, x, h + ly, z, rad, 21);
      if (rad >= 2) for (var bx = 0; bx <= 1; bx++) for (var bz = 0; bz <= 1; bz++)
        decorSet(ch, x + bx, h + ly, z + bz, 20, false);
    }
    decorSet(ch, x, h + th + 3, z, 21, true);
    return true;
  }

  function jungle(ch, x, h, z, r) {
    var th = 6 + ((r * 100000) | 0) % 6;
    for (var y = 1; y <= th; y++) decorSet(ch, x, h + y, z, 22, false);
    ring(ch, x, h + th - 1, z, 2, 23); decorSet(ch, x, h + th - 1, z, 22, false);
    ring(ch, x, h + th, z, 2, 23); decorSet(ch, x, h + th, z, 22, false);
    ring(ch, x, h + th + 1, z, 1, 23);
    decorSet(ch, x, h + th + 2, z, 23, true);
  }

  function giantJungle(ch, x, h, z, r) {
    if (baseSurfaceAt(x + 1, z) !== h || baseSurfaceAt(x, z + 1) !== h || baseSurfaceAt(x + 1, z + 1) !== h)
      return false;
    var th = 24 + ((r * 100000) | 0) % 8;
    if (h + th + 4 >= H) th = H - 5 - h;
    if (th < 14) return false;
    for (var y = 1; y <= th; y++) for (var dx = 0; dx <= 1; dx++) for (var dz = 0; dz <= 1; dz++)
      decorSet(ch, x + dx, h + y, z + dz, 22, false);
    ring(ch, x, h + th - 1, z, 3, 23);
    ring(ch, x, h + th, z, 3, 23);
    ring(ch, x, h + th + 1, z, 2, 23);
    ring(ch, x, h + th + 2, z, 1, 23);
    decorSet(ch, x, h + th + 3, z, 23, true);
    for (var ty = th - 1; ty <= th; ty++) for (var tx = 0; tx <= 1; tx++) for (var tz = 0; tz <= 1; tz++)
      decorSet(ch, x + tx, h + ty, z + tz, 22, false);
    return true;
  }

  function cactus(ch, x, h, z, r) {
    var n = 1 + ((r * 100000) | 0) % 3;
    for (var y = 1; y <= n; y++) decorSet(ch, x, h + y, z, 26, true);
  }

  function acacia(ch, x, h, z, r) {
    var th = 4 + ((r * 100000) | 0) % 2;
    for (var y = 1; y <= th; y++) decorSet(ch, x, h + y, z, 35, false);
    ring(ch, x, h + th, z, 2, 36); decorSet(ch, x, h + th, z, 35, false);
    ring(ch, x, h + th + 1, z, 1, 36);
    decorSet(ch, x, h + th + 2, z, 36, true);
  }

  function boulder(ch, x, h, z) {
    for (var dy = -1; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) for (var dz = -2; dz <= 2; dz++) {
      if (dx * dx + dz * dz + dy * dy * 1.6 > 3.4) continue;
      var xx = x + dx, yy = h + dy, zz = z + dz;
      if (!inTarget(ch, xx, zz) || yy <= 0 || yy >= H) continue;
      var old = getFromChunk(ch, xx, yy, zz);
      if (old !== 12 && old !== 7) setInChunk(ch, xx, yy, zz, 25);
    }
  }

  function decorate(ch) {
    var defs = Voxel.Biomes.defs;
    var x0 = ch.cx * CS, z0 = ch.cz * CS;
    // 每个目标区块独立枚举所有可能与它相交的根，并按全局 x/z 固定顺序写入。
    // 因此跨区块树冠连续，结果也不依赖区块加载顺序。
    for (var x = x0 - FEATURE_RADIUS; x < x0 + CS + FEATURE_RADIUS; x++) {
      for (var z = z0 - FEATURE_RADIUS; z < z0 + CS + FEATURE_RADIUS; z++) {
        // legacy core 的装饰完全交给旧生成器，且禁止外围 anchor 的树冠跨进核心。
        // 这样既不会改写旧档自然地形，也不会在 0/255 接缝留下被裁掉的半棵树。
        if (x >= -FEATURE_RADIUS && x <= W - 1 + FEATURE_RADIUS &&
          z >= -FEATURE_RADIUS && z <= D - 1 + FEATURE_RADIUS) continue;
        var h = baseSurfaceAt(x, z);
        if (h <= WATER + 1 || h > SNOW_LEVEL - 2) continue;
        var bd = defs[baseBiomeAt(x, z)];
        if (!bd || !bd.treeType) continue;
        var surface = baseBlockAt(x, h, z);
        if (!bd.plantOn || bd.plantOn.indexOf(surface) < 0) continue;
        if (bd.boulders && noise.hash2(x * 7 + 61, z * 7 + 83) < 0.0025) {
          boulder(ch, x, h, z); continue;
        }
        var r = noise.hash2(x * 3 + 11, z * 5 + 29);
        if (r >= bd.treeChance) continue;
        if (bd.treeType === 'oak') oak(ch, x, h, z, r, 4, 5);
        else if (bd.treeType === 'spruce') spruce(ch, x, h, z, r);
        else if (bd.treeType === 'cactus') cactus(ch, x, h, z, r);
        else if (bd.treeType === 'birch') oak(ch, x, h, z, r, 33, 34);
        else if (bd.treeType === 'acacia') acacia(ch, x, h, z, r);
        else if (bd.treeType === 'jungle') {
          var rg = noise.hash2(x * 5 + 3, z * 7 + 97);
          if (!(rg < bd.giantChance && giantJungle(ch, x, h, z, rg))) jungle(ch, x, h, z, r);
        } else if (bd.treeType === 'mega_spruce' && !megaSpruce(ch, x, h, z, r)) spruce(ch, x, h, z, r);
      }
    }
  }

  function lightCost(id) {
    if (Voxel.Blocks.isOpaque(id)) return -1;
    return id === 7 ? 2 : 1;
  }

  function spreadLight(ch, arr, buckets, lx, y, lz, level) {
    if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 0 || y >= H || level <= 0) return;
    var i = chunkIndex(lx, y, lz);
    var cost = lightCost(ch.blocks[i]);
    if (cost < 0) return;
    var next = level - (cost - 1);
    if (next <= arr[i]) return;
    arr[i] = next;
    if (!buckets[next]) buckets[next] = [];
    buckets[next].push(i);
  }

  function flood(ch, arr, buckets) {
    for (var level = 15; level >= 1; level--) {
      var q = buckets[level];
      if (!q) continue;
      for (var qi = 0; qi < q.length; qi++) {
        var i = q[qi];
        if (arr[i] !== level) continue;
        var lz = (i / (CS * H)) | 0;
        var rem = i - lz * CS * H;
        var y = (rem / CS) | 0;
        var lx = rem - y * CS;
        var next = level - 1;
        spreadLight(ch, arr, buckets, lx + 1, y, lz, next);
        spreadLight(ch, arr, buckets, lx - 1, y, lz, next);
        spreadLight(ch, arr, buckets, lx, y + 1, lz, next);
        spreadLight(ch, arr, buckets, lx, y - 1, lz, next);
        spreadLight(ch, arr, buckets, lx, y, lz + 1, next);
        spreadLight(ch, arr, buckets, lx, y, lz - 1, next);
      }
    }
  }

  function relight(ch) {
    ch.sky.fill(0); ch.blk.fill(0);
    var blkQ = [];
    for (var lx = 0; lx < CS; lx++) for (var lz = 0; lz < CS; lz++) {
      var light = 15;
      for (var y = H - 1; y >= 0; y--) {
        var i = chunkIndex(lx, y, lz), id = ch.blocks[i];
        if (Voxel.Blocks.isOpaque(id)) light = 0;
        else if (id === 7 && light > 0) light = Math.max(0, light - 2);
        ch.sky[i] = light;
        if (id === 19 && Voxel.Blocks.defs[19] && Voxel.Blocks.defs[19].light) {
          var bl = Voxel.Blocks.defs[19].light;
          ch.blk[i] = bl;
          if (!blkQ[bl]) blkQ[bl] = [];
          blkQ[bl].push(i);
        }
      }
    }
    // 流式区块采用列天光：露天/水下保持正确，洞穴仍为黑暗。避免把每个露天空气格
    // 都塞进 BFS（外围生成发生在游玩帧内）；火把仍走完整的 15 格泛光。
    flood(ch, ch.blk, blkQ);
    ch.lit = true;
  }

  // 块光需要跨区块连续。LIGHT_RANGE(15) < CS(32)，一次方块变化只可能影响
  // 所在区块及其八邻域；清空这 3×3 个 ready 外围区块后统一做全局坐标 BFS。
  // 区域外一圈的既有边界光作为种子导入，避免重算时擦掉其他未变化火把的贡献。
  function crossSpread(region, buckets, ch, lx, y, lz, level) {
    if (y < 0 || y >= H || level <= 0) return;
    var cx = ch.cx, cz = ch.cz;
    if (lx < 0) { cx--; lx += CS; }
    else if (lx >= CS) { cx++; lx -= CS; }
    if (lz < 0) { cz--; lz += CS; }
    else if (lz >= CS) { cz++; lz -= CS; }
    var dest = region[key(cx, cz)];
    if (!dest) return;
    var i = chunkIndex(lx, y, lz);
    var cost = lightCost(dest.blocks[i]);
    if (cost < 0) return;
    var value = level - (cost - 1);
    if (value <= dest.blk[i]) return;
    dest.blk[i] = value;
    if (!buckets[value]) buckets[value] = [];
    buckets[value].push({ ch: dest, i: i });
  }

  function importBlockBorder(region, buckets, ch, dx, dz) {
    var outsideCx = ch.cx + dx, outsideCz = ch.cz + dz;
    var fromCore = coreChunk(outsideCx, outsideCz);
    var outside = fromCore ? null : extra[key(outsideCx, outsideCz)];
    if (!fromCore && (!outside || !outside.ready)) return;
    if (outside && region[key(outside.cx, outside.cz)]) return;
    for (var a = 0; a < CS; a++) for (var y = 0; y < H; y++) {
      var inLx = dx < 0 ? 0 : (dx > 0 ? CS - 1 : a);
      var inLz = dz < 0 ? 0 : (dz > 0 ? CS - 1 : a);
      var outLx = dx < 0 ? CS - 1 : (dx > 0 ? 0 : a);
      var outLz = dz < 0 ? CS - 1 : (dz > 0 ? 0 : a);
      var outsideLevel = fromCore
        ? FiniteWorld.getBlk(outsideCx * CS + outLx, y, outsideCz * CS + outLz)
        : outside.blk[chunkIndex(outLx, y, outLz)];
      if (outsideLevel > 1) crossSpread(region, buckets, ch, inLx, y, inLz, outsideLevel - 1);
    }
  }

  function adjacentToCore(cx, cz) {
    return ((cx === -1 || cx === CORE_CX) && cz >= 0 && cz < CORE_CZ) ||
      ((cz === -1 || cz === CORE_CZ) && cx >= 0 && cx < CORE_CX);
  }

  function coreSpread(buckets, x, y, z, level) {
    if (x < 0 || x >= W || z < 0 || z >= D || y < 0 || y >= H || level <= 0) return;
    var id = FiniteWorld.get(x, y, z), cost = lightCost(id);
    if (cost < 0) return;
    var value = level - (cost - 1), i = coreLightIndex(x, y, z);
    if (value <= coreBlkOverlay[i]) return;
    coreBlkOverlay[i] = value;
    if (!buckets[value]) buckets[value] = [];
    buckets[value].push(i);
  }

  function seedCoreFromExtra(buckets, ch, side) {
    if (!ch || !ch.ready) return;
    for (var a = 0; a < CS; a++) for (var y = 0; y < H; y++) {
      var outsideLevel, x, z;
      if (side === 'left') {
        outsideLevel = ch.blk[chunkIndex(CS - 1, y, a)]; x = 0; z = ch.cz * CS + a;
      } else if (side === 'right') {
        outsideLevel = ch.blk[chunkIndex(0, y, a)]; x = W - 1; z = ch.cz * CS + a;
      } else if (side === 'front') {
        outsideLevel = ch.blk[chunkIndex(a, y, CS - 1)]; x = ch.cx * CS + a; z = 0;
      } else {
        outsideLevel = ch.blk[chunkIndex(a, y, 0)]; x = ch.cx * CS + a; z = D - 1;
      }
      if (outsideLevel > 1) coreSpread(buckets, x, y, z, outsideLevel - 1);
    }
  }

  function coreFacingLight(ch, side) {
    if (!ch || !ch.ready) return false;
    for (var a = 0; a < CS; a++) for (var y = 0; y < H; y++) {
      var i = side === 'left' ? chunkIndex(CS - 1, y, a) :
        side === 'right' ? chunkIndex(0, y, a) :
          side === 'front' ? chunkIndex(a, y, CS - 1) : chunkIndex(a, y, 0);
      if (ch.blk[i] > 1) return true;
    }
    return false;
  }

  function markCoreEdgeMeshes() {
    for (var ex = 0; ex < CORE_CX; ex++) {
      if (FiniteWorld.markChunkDirty) {
        FiniteWorld.markChunkDirty(ex, 0);
        FiniteWorld.markChunkDirty(ex, CORE_CZ - 1);
      }
    }
    for (var ez = 1; ez < CORE_CZ - 1; ez++) {
      if (FiniteWorld.markChunkDirty) {
        FiniteWorld.markChunkDirty(0, ez);
        FiniteWorld.markChunkDirty(CORE_CX - 1, ez);
      }
    }
  }

  // 有限后端的光数组保持完全不变；外围火把进入核心的贡献单独叠加，
  // 从而既保留旧档核心光照，又让 x=255/256 接缝没有单向暗缝。
  function recomputeCoreOverlay() {
    if (!planetMode || !FiniteWorld.lightReady()) return;
    var anySource = false;
    for (var scz = 0; scz < CORE_CZ && !anySource; scz++)
      anySource = coreFacingLight(extra[key(-1, scz)], 'left') ||
        coreFacingLight(extra[key(CORE_CX, scz)], 'right');
    for (var scx = 0; scx < CORE_CX && !anySource; scx++)
      anySource = coreFacingLight(extra[key(scx, -1)], 'front') ||
        coreFacingLight(extra[key(scx, CORE_CZ)], 'back');
    if (!anySource) {
      if (coreBlkOverlay) { coreBlkOverlay = null; markCoreEdgeMeshes(); }
      return;
    }
    if (!coreBlkOverlay) coreBlkOverlay = new Uint8Array(W * H * D);
    else coreBlkOverlay.fill(0);
    var buckets = [];
    for (var cz = 0; cz < CORE_CZ; cz++) {
      seedCoreFromExtra(buckets, extra[key(-1, cz)], 'left');
      seedCoreFromExtra(buckets, extra[key(CORE_CX, cz)], 'right');
    }
    for (var cx = 0; cx < CORE_CX; cx++) {
      seedCoreFromExtra(buckets, extra[key(cx, -1)], 'front');
      seedCoreFromExtra(buckets, extra[key(cx, CORE_CZ)], 'back');
    }
    for (var level = 15; level >= 1; level--) {
      var q = buckets[level];
      if (!q) continue;
      for (var qi = 0; qi < q.length; qi++) {
        var i = q[qi];
        if (coreBlkOverlay[i] !== level) continue;
        var z = (i / (W * H)) | 0;
        var rem = i - z * W * H;
        var y = (rem / W) | 0;
        var x = rem - y * W;
        var next = level - 1;
        coreSpread(buckets, x + 1, y, z, next);
        coreSpread(buckets, x - 1, y, z, next);
        coreSpread(buckets, x, y + 1, z, next);
        coreSpread(buckets, x, y - 1, z, next);
        coreSpread(buckets, x, y, z + 1, next);
        coreSpread(buckets, x, y, z - 1, next);
      }
    }
    // 光程小于一个区块，只需让核心外圈区块重建顶点光。
    markCoreEdgeMeshes();
  }

  function addLightTarget(targets, cx, cz) {
    if (coreChunk(cx, cz)) return;
    var k = key(cx, cz);
    if (!targets[k]) targets[k] = [cx, cz];
  }

  // 多个 edit/核心边带变化共用一次 union BFS，避免逐 edit 重复清空、扫描同一 3×3 区域。
  function recomputeBlockLightBatch(targets, forceCoreOverlay) {
    var region = Object.create(null), chunks = [];
    var touchesCore = !!forceCoreOverlay;
    for (var tk in targets) {
      if (!own(targets, tk)) continue;
      var center = targets[tk], cx0 = center[0], cz0 = center[1];
      if (adjacentToCore(cx0, cz0)) touchesCore = true;
      for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
        var ch = extra[key(cx0 + dx, cz0 + dz)];
        if (!ch || !ch.ready) continue;
        var ck = key(ch.cx, ch.cz);
        if (!region[ck]) { region[ck] = ch; chunks.push(ch); }
        if (adjacentToCore(ch.cx, ch.cz)) touchesCore = true;
      }
    }
    if (!chunks.length) {
      if (touchesCore) recomputeCoreOverlay();
      return;
    }
    var buckets = [];
    for (var c = 0; c < chunks.length; c++) chunks[c].blk.fill(0);

    // 区域内所有火把都是本轮的权威光源。
    for (var c2 = 0; c2 < chunks.length; c2++) {
      var src = chunks[c2];
      for (var i = 0; i < src.blocks.length; i++) {
        if (src.blocks[i] !== 19 || !Voxel.Blocks.defs[19] || !Voxel.Blocks.defs[19].light) continue;
        var level = Voxel.Blocks.defs[19].light;
        src.blk[i] = level;
        if (!buckets[level]) buckets[level] = [];
        buckets[level].push({ ch: src, i: i });
      }
    }

    // 只导入不属于本次 3×3 重算集的四边邻块；集内传播由统一 BFS 完成。
    for (var c3 = 0; c3 < chunks.length; c3++) {
      var bch = chunks[c3];
      importBlockBorder(region, buckets, bch, -1, 0);
      importBlockBorder(region, buckets, bch, 1, 0);
      importBlockBorder(region, buckets, bch, 0, -1);
      importBlockBorder(region, buckets, bch, 0, 1);
    }

    for (var l = 15; l >= 1; l--) {
      var q = buckets[l];
      if (!q) continue;
      for (var qi = 0; qi < q.length; qi++) {
        var node = q[qi], ch2 = node.ch, ii = node.i;
        if (ch2.blk[ii] !== l) continue;
        var lz = (ii / (CS * H)) | 0;
        var rem = ii - lz * CS * H;
        var y2 = (rem / CS) | 0;
        var lx = rem - y2 * CS;
        var next = l - 1;
        crossSpread(region, buckets, ch2, lx + 1, y2, lz, next);
        crossSpread(region, buckets, ch2, lx - 1, y2, lz, next);
        crossSpread(region, buckets, ch2, lx, y2 + 1, lz, next);
        crossSpread(region, buckets, ch2, lx, y2 - 1, lz, next);
        crossSpread(region, buckets, ch2, lx, y2, lz + 1, next);
        crossSpread(region, buckets, ch2, lx, y2, lz - 1, next);
      }
    }
    for (var c4 = 0; c4 < chunks.length; c4++) queueMesh(chunks[c4].cx, chunks[c4].cz);
    if (touchesCore) recomputeCoreOverlay();
  }

  function recomputeBlockLightAround(cx0, cz0) {
    var targets = Object.create(null);
    addLightTarget(targets, cx0, cz0);
    recomputeBlockLightBatch(targets, adjacentToCore(cx0, cz0));
  }

  function applyChunkEdits(ch) {
    var list = editsByChunk[key(ch.cx, ch.cz)];
    if (!list) return;
    for (var k in list) {
      if (!own(list, k)) continue;
      var p = k.split(',');
      setInChunk(ch, +p[0], +p[1], +p[2], +list[k]);
    }
  }

  function queueMesh(cx, cz) {
    var k = key(cx, cz), ch = extra[k];
    if (!ch || !ch.ready || meshQueued[k]) return;
    ch.dirty = true;
    meshQueued[k] = true;
    meshQueue.push(k);
  }

  function markChunkDirty(cx, cz) {
    if (coreChunk(cx, cz)) {
      if (FiniteWorld.markChunkDirty) FiniteWorld.markChunkDirty(cx, cz);
      return;
    }
    queueMesh(cx, cz);
  }

  function markNeighborhood(cx, cz) {
    for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++)
      markChunkDirty(cx + dx, cz + dz);
  }

  function ensureChunk(cx, cz) {
    cx = Math.floor(+cx); cz = Math.floor(+cz);
    if (!isFinite(cx) || !isFinite(cz) || coreChunk(cx, cz) || !planetMode) return null;
    var ch = ensureBaseChunk(cx, cz);
    if (!ch.ready) {
      decorate(ch);
      applyChunkEdits(ch);
      relight(ch);
      ch.ready = true;
      recomputeBlockLightAround(cx, cz);
      ch.dirty = true;
      markNeighborhood(cx, cz);
    }
    return ch;
  }

  function enqueueChunk(cx, cz, dist) {
    var k = key(cx, cz);
    var ch = extra[k];
    // 装饰会预先创建相邻的 base-only halo；存在于 extra 不等于可游玩的 ready。
    if (coreChunk(cx, cz) || (ch && ch.ready) || genQueued[k]) return;
    genQueued[k] = true;
    genQueue.push({ key: k, cx: cx, cz: cz, d: dist });
  }

  function refreshStreaming() {
    if (!planetMode || !FiniteWorld.isReady()) return;
    var cx0 = focus.cx === null ? floorDiv(focus.x, CS) : focus.cx;
    var cz0 = focus.cz === null ? floorDiv(focus.z, CS) : focus.cz;
    var wanted = Object.create(null);
    for (var dx = -DATA_RADIUS; dx <= DATA_RADIUS; dx++) for (var dz = -DATA_RADIUS; dz <= DATA_RADIUS; dz++) {
      var cx = cx0 + dx, cz = cz0 + dz;
      wanted[key(cx, cz)] = true;
      enqueueChunk(cx, cz, dx * dx + dz * dz);
    }
    var filtered = [];
    genQueued = Object.create(null);
    for (var i = 0; i < genQueue.length; i++) {
      var job = genQueue[i];
      if (!wanted[job.key] || (extra[job.key] && extra[job.key].ready)) continue;
      genQueued[job.key] = true;
      filtered.push(job);
    }
    filtered.sort(function (a, b) { return a.d - b.d; });
    genQueue = filtered;
    for (var k in extra) {
      var ch = extra[k];
      if (Math.abs(ch.cx - cx0) <= RENDER_RADIUS && Math.abs(ch.cz - cz0) <= RENDER_RADIUS)
        queueMesh(ch.cx, ch.cz);
    }
    unloadOutside(cx0, cz0, KEEP_RADIUS);
  }

  function pumpGeneration(n) {
    if (!planetMode || !FiniteWorld.isReady()) return 0;
    var built = 0;
    while (n-- > 0 && genQueue.length) {
      var job = genQueue.shift();
      delete genQueued[job.key];
      var ch = extra[job.key];
      // 游玩帧内把“基础密度生成”和“确定性装饰/光照”拆成小步；否则首次装饰一个
      // 区块会同步生成整个 halo，单帧可能出现明显长停顿。
      if (!ch || !ch.baseReady) {
        ensureBaseChunk(job.cx, job.cz);
        genQueued[job.key] = true;
        genQueue.push(job);
        built++;
        continue;
      }
      var missing = null;
      for (var dx = -1; dx <= 1 && !missing; dx++) for (var dz = -1; dz <= 1; dz++) {
        var ncx = job.cx + dx, ncz = job.cz + dz;
        if (coreChunk(ncx, ncz)) continue;
        var neighbor = extra[key(ncx, ncz)];
        if (!neighbor || !neighbor.baseReady) { missing = [ncx, ncz]; break; }
      }
      if (missing) {
        ensureBaseChunk(missing[0], missing[1]);
        genQueued[job.key] = true;
        genQueue.push(job);
        built++;
        continue;
      }
      if (!ch.ready) ensureChunk(job.cx, job.cz);
      built++;
    }
    if (genQueue.length > 1) genQueue.sort(function (a, b) { return a.d - b.d; });
    return built;
  }

  function disposeChunkMesh(ch) {
    if (ch.mesh) {
      if (extraGroup) extraGroup.remove(ch.mesh);
      if (ch.mesh.geometry) ch.mesh.geometry.dispose();
      ch.mesh = null;
    }
    if (ch.wmesh) {
      if (extraGroup) extraGroup.remove(ch.wmesh);
      if (ch.wmesh.geometry) ch.wmesh.geometry.dispose();
      ch.wmesh = null;
    }
    ch.meshed = false;
  }

  function hasBoundaryBlockLight(ch) {
    for (var a = 0; a < CS; a++) for (var y = 0; y < H; y++) {
      if (ch.blk[chunkIndex(0, y, a)] > 1 || ch.blk[chunkIndex(CS - 1, y, a)] > 1 ||
        ch.blk[chunkIndex(a, y, 0)] > 1 || ch.blk[chunkIndex(a, y, CS - 1)] > 1) return true;
    }
    return false;
  }

  function unloadChunk(k) {
    var ch = extra[k];
    if (!ch) return;
    var sharedLight = hasBoundaryBlockLight(ch);
    disposeChunkMesh(ch);
    delete extra[k];
    delete meshQueued[k];
    if (sharedLight) recomputeBlockLightAround(ch.cx, ch.cz);
    markNeighborhood(ch.cx, ch.cz);
  }

  function unloadOutside(cx0, cz0, radius) {
    cx0 = Math.floor(+cx0); cz0 = Math.floor(+cz0); radius = Math.max(0, Math.floor(+radius));
    for (var k in extra) {
      var ch = extra[k];
      if (Math.abs(ch.cx - cx0) > radius || Math.abs(ch.cz - cz0) > radius) unloadChunk(k);
    }
    var mq = [], nextQueued = Object.create(null);
    for (var i = 0; i < meshQueue.length; i++) {
      if (!extra[meshQueue[i]] || nextQueued[meshQueue[i]]) continue;
      nextQueued[meshQueue[i]] = true; mq.push(meshQueue[i]);
    }
    meshQueue = mq; meshQueued = nextQueued;
  }

  function ensureMeshGroup(scene) {
    if (!extraGroup) extraGroup = new THREE.Group();
    if (extraGroup.parent !== scene) scene.add(extraGroup);
    extraScene = scene;
  }

  function buildExtraMeshes(n, scene) {
    if (!planetMode || !Voxel.MeshBuilder || !scene) return 0;
    ensureMeshGroup(scene);
    var built = 0, cx0 = floorDiv(focus.x, CS), cz0 = floorDiv(focus.z, CS);
    while (n-- > 0 && meshQueue.length) {
      var best = -1, bestD = Infinity;
      for (var i = 0; i < meshQueue.length; i++) {
        var c = extra[meshQueue[i]];
        if (!c || Math.abs(c.cx - cx0) > RENDER_RADIUS || Math.abs(c.cz - cz0) > RENDER_RADIUS) continue;
        var d = (c.cx - cx0) * (c.cx - cx0) + (c.cz - cz0) * (c.cz - cz0);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) break;
      var k = meshQueue.splice(best, 1)[0];
      delete meshQueued[k];
      var ch = extra[k];
      if (!ch || !ch.ready) continue;
      disposeChunkMesh(ch);
      var res = Voxel.MeshBuilder.build(ch.cx, ch.cz);
      if (res.opaque) {
        ch.mesh = new THREE.Mesh(res.opaque, Voxel.MeshBuilder.opaqueMat());
        extraGroup.add(ch.mesh);
      }
      if (res.water) {
        ch.wmesh = new THREE.Mesh(res.water, Voxel.MeshBuilder.waterMat());
        ch.wmesh.renderOrder = 2;
        extraGroup.add(ch.wmesh);
      }
      ch.meshed = true; ch.dirty = false; built++;
    }
    return built;
  }

  function indexExtraEdit(x, y, z, id) {
    var pk = posKey(x, y, z), ck = key(floorDiv(x, CS), floorDiv(z, CS));
    extraEdits[pk] = id;
    if (!editsByChunk[ck]) editsByChunk[ck] = Object.create(null);
    editsByChunk[ck][pk] = id;
  }

  function init(s, worldProfile) {
    FiniteWorld.init(s, worldProfile);
    // null/undefined 会由有限后端随机化；必须复用其规范化结果，不能再随机一次。
    seed = FiniteWorld.getSeed();
    profile = worldProfile || null;
    terrainVersion = Voxel.PlanetRules && Voxel.PlanetRules.normalizeVersion
      ? Voxel.PlanetRules.normalizeVersion(profile && profile.terrainVersion, 1)
      : ((profile && profile.terrainVersion === 2) ? 2 : 1);
    planetTypeKey = profile && typeof profile.typeKey === 'string' ? profile.typeKey : 'lush';
    planetMode = !profile || profile.kind !== 'station';
    noise = Voxel.Noise.create(seed);
    climateAt = Voxel.Biomes.makeClimate(noise);
    shaper = Voxel.Shaper.create(noise);
    if (extraGroup && extraGroup.parent) extraGroup.parent.remove(extraGroup);
    for (var k in extra) disposeChunkMesh(extra[k]);
    extra = Object.create(null);
    extraEdits = Object.create(null);
    editsByChunk = Object.create(null);
    coreBlkOverlay = null;
    genQueue = []; genQueued = Object.create(null);
    meshQueue = []; meshQueued = Object.create(null);
    extraGroup = null; extraScene = null;
    focus.x = W / 2; focus.z = D / 2; focus.cx = null; focus.cz = null;
  }

  function generateNext(n) {
    if (!FiniteWorld.isReady()) {
      FiniteWorld.generateNext(n);
      if (FiniteWorld.isReady()) {
        focus.cx = floorDiv(focus.x, CS); focus.cz = floorDiv(focus.z, CS);
        refreshStreaming();
      }
      return;
    }
    pumpGeneration(Math.max(0, n | 0));
  }

  function setFocus(x, z) {
    FiniteWorld.setFocus(x, z);
    if (isFinite(x)) focus.x = x;
    if (isFinite(z)) focus.z = z;
    var cx = floorDiv(focus.x, CS), cz = floorDiv(focus.z, CS);
    if (cx !== focus.cx || cz !== focus.cz) {
      focus.cx = cx; focus.cz = cz;
      refreshStreaming();
    }
  }

  function get(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0) return 12;
    if (y >= H) return 0;
    if (!planetMode || inCore(x, z)) return FiniteWorld.get(x, y, z);
    var pk = posKey(x, y, z);
    if (own(extraEdits, pk)) return extraEdits[pk];
    var ch = chunkAtBlock(x, z);
    return ch && ch.ready ? getFromChunk(ch, x, y, z) : 12;
  }

  // 收集一个核心格在 15 格块光程内可能影响的所有外围区块；四边与四角统一处理。
  function collectCoreLightTargets(targets, x, z) {
    var touched = false;
    var minCx = floorDiv(x - BLOCK_LIGHT_RANGE, CS);
    var maxCx = floorDiv(x + BLOCK_LIGHT_RANGE, CS);
    var minCz = floorDiv(z - BLOCK_LIGHT_RANGE, CS);
    var maxCz = floorDiv(z + BLOCK_LIGHT_RANGE, CS);
    for (var cx = minCx; cx <= maxCx; cx++) for (var cz = minCz; cz <= maxCz; cz++) {
      if (coreChunk(cx, cz)) continue;
      touched = true;
      addLightTarget(targets, cx, cz);
    }
    return touched;
  }

  function refreshCoreLightBandAt(x, z) {
    var targets = Object.create(null);
    var touchesCoreSeam = collectCoreLightTargets(targets, x, z);
    if (touchesCoreSeam) recomputeBlockLightBatch(targets, true);
  }

  function set(x, y, z, id) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); id = Math.floor(id);
    if (!validXYZ(x, y, z) || id < 0 || id > 255 || (id !== 0 && !Voxel.Blocks.defs[id])) return;
    if (!planetMode || inCore(x, z)) {
      FiniteWorld.set(x, y, z, id);
      if (planetMode) {
        if (FiniteWorld.lightReady()) refreshCoreLightBandAt(x, z);
        // 方块面剔除只在几何边界需要跨核心/外围失效；光照的 15 格带由上方批量处理。
        if (x === 0 || x === W - 1 || z === 0 || z === D - 1)
          markNeighborhood(floorDiv(x, CS), floorDiv(z, CS));
      }
      return;
    }
    var ch = ensureChunk(floorDiv(x, CS), floorDiv(z, CS));
    setInChunk(ch, x, y, z, id);
    indexExtraEdit(x, y, z, id);
    if (id === 0) FiniteWorld.setMeta(x, y, z, null);
    relight(ch);
    recomputeBlockLightAround(ch.cx, ch.cz);
    markNeighborhood(ch.cx, ch.cz);
  }

  function surfaceAt(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (!planetMode || inCore(x, z)) return FiniteWorld.surfaceAt(x, z);
    var ch = chunkAtBlock(x, z);
    if (!ch || !ch.ready) ch = ensureChunk(floorDiv(x, CS), floorDiv(z, CS));
    for (var y = H - 1; y >= 0; y--)
      if (Voxel.Blocks.isSolid(getFromChunk(ch, x, y, z))) return y;
    return -1;
  }

  function biomeAt(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (!planetMode || inCore(x, z)) return FiniteWorld.biomeAt(x, z);
    var ch = chunkAtBlock(x, z);
    if (!ch || !ch.ready) ch = ensureChunk(floorDiv(x, CS), floorDiv(z, CS));
    return ch.biomes[columnIndex(localCoord(x, CS), localCoord(z, CS))];
  }

  function getSky(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y >= H) return 15;
    if (y < 0) return 0;
    if (!planetMode || inCore(x, z)) return FiniteWorld.getSky(x, y, z);
    var ch = chunkAtBlock(x, z);
    return ch && ch.ready ? ch.sky[chunkIndex(localCoord(x, CS), y, localCoord(z, CS))] : 15;
  }

  function getBlk(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= H) return 0;
    if (!planetMode || inCore(x, z)) {
      var base = FiniteWorld.getBlk(x, y, z);
      if (planetMode && coreBlkOverlay && inCore(x, z))
        base = Math.max(base, coreBlkOverlay[coreLightIndex(x, y, z)]);
      return base;
    }
    var ch = chunkAtBlock(x, z);
    return ch && ch.ready ? ch.blk[chunkIndex(localCoord(x, CS), y, localCoord(z, CS))] : 0;
  }

  function applyEdits(ed) {
    if (!ed) return;
    var core = Object.create(null), touched = Object.create(null);
    var lightTargets = Object.create(null), coreLightTouched = false;
    var coreBoundaryChunks = Object.create(null);
    for (var k in ed) {
      if (!own(ed, k)) continue;
      var p = k.split(',');
      if (p.length !== 3) continue;
      var x = +p[0], y = +p[1], z = +p[2], id = +ed[k];
      if (!validXYZ(x, y, z) || !Number.isInteger(id) || id < 0 || id > 255 ||
        (id !== 0 && !Voxel.Blocks.defs[id])) continue;
      if (!planetMode || inCore(x, z)) {
        core[k] = id;
        if (planetMode) {
          if (FiniteWorld.lightReady() && collectCoreLightTargets(lightTargets, x, z)) coreLightTouched = true;
          if (x === 0 || x === W - 1 || z === 0 || z === D - 1) {
            var bcx = floorDiv(x, CS), bcz = floorDiv(z, CS);
            coreBoundaryChunks[key(bcx, bcz)] = [bcx, bcz];
          }
        }
      }
      else {
        indexExtraEdit(x, y, z, id);
        var ck = key(floorDiv(x, CS), floorDiv(z, CS));
        touched[ck] = true;
        var ch = extra[ck];
        if (ch && ch.ready) setInChunk(ch, x, y, z, id);
      }
    }
    FiniteWorld.applyEdits(core);
    for (var bk in coreBoundaryChunks) {
      if (!own(coreBoundaryChunks, bk)) continue;
      var bp = coreBoundaryChunks[bk];
      markNeighborhood(bp[0], bp[1]);
    }
    for (var ck2 in touched) {
      var ch2 = extra[ck2];
      if (ch2 && ch2.ready) {
        relight(ch2);
        addLightTarget(lightTargets, ch2.cx, ch2.cz);
        markNeighborhood(ch2.cx, ch2.cz);
      }
    }
    recomputeBlockLightBatch(lightTargets, coreLightTouched);
  }

  function getEdits() {
    var out = {}, core = FiniteWorld.getEdits();
    for (var k in core) if (own(core, k)) out[k] = core[k];
    for (var k2 in extraEdits) if (own(extraEdits, k2)) out[k2] = extraEdits[k2];
    return out;
  }

  function isEdited(x, y, z) {
    if (!validXYZ(x, y, z)) return false;
    if (!planetMode || inCore(x, z))
      return FiniteWorld.isEdited ? FiniteWorld.isEdited(x, y, z) : own(FiniteWorld.getEdits(), posKey(x, y, z));
    return own(extraEdits, posKey(x, y, z));
  }

  function buildMeshes(n, scene) {
    FiniteWorld.buildMeshes(n, scene);
    if (!planetMode || !FiniteWorld.isReady()) return 0;
    return buildExtraMeshes(Math.max(0, n | 0), scene);
  }

  function clearMeshes(scene) {
    FiniteWorld.clearMeshes(scene);
    for (var k in extra) disposeChunkMesh(extra[k]);
    if (extraGroup && extraGroup.parent) extraGroup.parent.remove(extraGroup);
    extraGroup = null; extraScene = null;
  }

  function isChunkLoaded(cx, cz) {
    cx = Math.floor(+cx); cz = Math.floor(+cz);
    if (coreChunk(cx, cz)) return FiniteWorld.isReady();
    return !!(planetMode && extra[key(cx, cz)] && extra[key(cx, cz)].ready);
  }

  function focusMeshed() {
    if (!planetMode || inCore(Math.floor(focus.x), Math.floor(focus.z))) return FiniteWorld.focusMeshed();
    var cx = floorDiv(focus.x, CS), cz = floorDiv(focus.z, CS);
    for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
      if (coreChunk(cx + dx, cz + dz)) continue;
      var ch = extra[key(cx + dx, cz + dz)];
      if (!ch || !ch.ready || !ch.meshed) return false;
    }
    return true;
  }

  function streamStats() {
    var loaded = 0, meshed = 0;
    for (var k in extra) { loaded++; if (extra[k].meshed) meshed++; }
    return {
      loaded: loaded, queued: genQueue.length, meshed: meshed,
      renderRadius: RENDER_RADIUS, dataRadius: DATA_RADIUS, keepRadius: KEEP_RADIUS,
      // loaded/meshed 只统计外围稀疏区块；legacy core 的 64 个固定区块不计入。
      coreChunks: CORE_CX * CORE_CZ, planet: planetMode
    };
  }

  function initLight() {
    FiniteWorld.initLight();
    if (!planetMode) return;
    // 极少数调用顺序可能先生成外围、后初始化核心光照；补做接缝导入。
    var targets = Object.create(null);
    for (var k in extra) {
      var ch = extra[k];
      if (ch.ready && adjacentToCore(ch.cx, ch.cz)) addLightTarget(targets, ch.cx, ch.cz);
    }
    recomputeBlockLightBatch(targets, true);
  }

  var InfiniteWorld = {
    __infiniteFacade: true,
    init: init,
    generateNext: generateNext,
    progress: function () { return FiniteWorld.progress(); },
    isReady: function () { return FiniteWorld.isReady(); },
    centerMeshed: function () { return FiniteWorld.centerMeshed(); },
    setFocus: setFocus,
    focusMeshed: focusMeshed,
    meshCount: function () { return FiniteWorld.meshCount() + (extraGroup ? extraGroup.children.length : 0); },
    buildMeshes: buildMeshes,
    clearMeshes: clearMeshes,
    markChunkDirty: markChunkDirty,
    get: get,
    set: set,
    surfaceAt: surfaceAt,
    biomeAt: biomeAt,
    spawnPoint: function () { return FiniteWorld.spawnPoint(); },
    applyEdits: applyEdits,
    initLight: initLight,
    lightReady: function () { return FiniteWorld.lightReady(); },
    getSky: getSky,
    getBlk: getBlk,
    getEdits: getEdits,
    isEdited: isEdited,
    getMeta: function (x, y, z) { return FiniteWorld.getMeta(x, y, z); },
    setMeta: function (x, y, z, m) { FiniteWorld.setMeta(x, y, z, m); },
    getAllMeta: function () { return FiniteWorld.getAllMeta(); },
    applyMeta: function (md) { FiniteWorld.applyMeta(md); },
    getSeed: function () { return FiniteWorld.getSeed(); },
    getProfile: function () { return FiniteWorld.getProfile(); },
    size: function () {
      var s = FiniteWorld.size();
      s.infiniteXZ = planetMode;
      s.chunk = CS;
      return s;
    },
    ensureChunk: ensureChunk,
    isChunkLoaded: isChunkLoaded,
    streamStats: streamStats,
    _test: {
      floorDiv: function (n) { return floorDiv(n, CS); },
      localCoord: function (n) { return localCoord(n, CS); },
      unloadOutside: unloadOutside,
      finiteWorld: FiniteWorld,
      chunk: function (cx, cz) { return extra[key(cx, cz)] || null; }
    }
  };

  Voxel.FiniteWorld = FiniteWorld;
  Voxel.InfiniteWorld = InfiniteWorld;
  Voxel.World = InfiniteWorld;
})();
