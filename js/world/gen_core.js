// 地形生成核心（P2）：base 密度生成 + 确定性装饰的纯逻辑模块。
//
// 设计约束：
// 1. 无 DOM / THREE / Worker API 依赖，主线程同步回退路径与 Web Worker 共用
//    同一份实现——从根源上杜绝"两套生成器漂移"导致的接缝与存档不一致；
// 2. 输出只由 (seed, profile, 全局坐标) 决定，区块加载顺序不影响结果；
// 3. 光照、编辑、网格构建不在此模块：它们需要跨区块就绪状态，仍由主线程
//    的无限世界 facade 统一处理。
//
// 从 infinite.js 原样移植（ch -> shell），保证与历史版本逐位一致的指纹。
window.Voxel = window.Voxel || {};

Voxel.GenCore = (function () {
  function create(opts) {
    var CFG = Voxel.Config;
    var W = CFG.WORLD_W, H = CFG.WORLD_H, D = CFG.WORLD_D, CS = CFG.CHUNK;
    var WATER = CFG.WATER_LEVEL, SNOW_LEVEL = CFG.SNOW_LEVEL;
    // 生成包络：base 密度/水填充只扫到此处；上方零初始化即空气，与旧实现
    // 对 y>WATER 显式写 0 的结果逐位一致。限高 256 后靠它抵消生成成本增量。
    var ENVELOPE = Math.min(H, CFG.GEN_ENVELOPE_TOP || H);
    // 地形一致性契约：装饰器的世界顶判定曾为旧限高 H=64。世界抬升后必须
    // 钉住字面量，保证所有种子的地形与树冠外观逐位不变（test/terrain_parity_test.js）。
    var GEN_TOP = 64;
    var FEATURE_RADIUS = 6;

    var seed = String(opts.seed);
    var profile = opts.profile || null;
    var terrainVersion = Voxel.PlanetRules && Voxel.PlanetRules.normalizeVersion
      ? Voxel.PlanetRules.normalizeVersion(profile && profile.terrainVersion, 1)
      : ((profile && profile.terrainVersion === 2) ? 2 : 1);
    var planetTypeKey = profile && typeof profile.typeKey === 'string' ? profile.typeKey : 'lush';

    var noise = Voxel.Noise.create(seed);
    var climateAt = Voxel.Biomes.makeClimate(noise);
    var shaper = Voxel.Shaper.create(noise);

    // 稀疏 shell 存储："cx,cz" -> {blocks,heights,biomes,baseReady,decorated}
    // 装饰锚点会按需预生成相邻 shell 的基础地形（halo），结果与加载顺序无关。
    var store = Object.create(null);

    function key(cx, cz) { return cx + ',' + cz; }
    function floorDiv(n, d) { return Math.floor(n / d); }
    function localCoord(n, d) {
      var q = floorDiv(n, d);
      return n - q * d;
    }
    function chunkIndex(lx, y, lz) { return lx + CS * (y + H * lz); }
    function columnIndex(lx, lz) { return lx + CS * lz; }

    function newShell(cx, cz) {
      return {
        cx: cx, cz: cz,
        blocks: new Uint8Array(CS * H * CS),
        heights: new Int16Array(CS * CS),
        biomes: new Uint8Array(CS * CS),
        baseReady: false, decorated: false
      };
    }

    function shellOf(cx, cz) {
      return store[key(cx, cz)] || null;
    }

    // 外部（Worker 回传）安装已装饰数组：主线程侧保留同一份数据供 halo 查询。
    function absorbShell(cx, cz, blocks, heights, biomes) {
      var s = store[key(cx, cz)];
      if (s && s.baseReady) return s;
      s = {
        cx: cx, cz: cz,
        blocks: blocks, heights: heights, biomes: biomes,
        baseReady: true, decorated: true
      };
      store[key(cx, cz)] = s;
      return s;
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

    function setIfStone(s, lx, y, lz, id) {
      if (y < 0 || y >= H) return;
      var i = chunkIndex(lx, y, lz);
      var old = s.blocks[i];
      if (old === 3 || old === 8 || old === 9 || (old >= 39 && old <= 44)) s.blocks[i] = id;
    }

    function applySurface(s, lx, lz, x, z, top, biome, bd) {
      var BL = Voxel.Biomes.BLK;
      var BI = Voxel.Biomes.B;
      if (top < 3) return;
      var patch = noise.hash2((x >> 3) * 31 + 7, (z >> 3) * 17 + 5);
      var surf = bd.surface, fill = bd.filler;
      if (top <= WATER) {
        surf = patch < 0.45 ? BL.SAND : (patch < 0.75 ? BL.GRAVEL : BL.DIRT);
        s.blocks[chunkIndex(lx, top, lz)] = surf;
        for (var d0 = 1; d0 <= 3 && top - d0 > 1; d0++)
          setIfStone(s, lx, top - d0, lz, surf === BL.DIRT ? BL.DIRT : BL.SAND);
        return;
      }
      if (top <= WATER + 2 && biome !== BI.STONY_SHORE &&
        biome !== BI.JAGGED_PEAKS && biome !== BI.FROZEN_PEAKS && biome !== BI.STONY_PEAKS &&
        !bd.badlandsBands && biome !== BI.PLAYGROUND) {
        surf = BL.SAND; fill = BL.SAND;
      }
      if (bd.gravelPatches && patch < 0.22) { surf = BL.GRAVEL; fill = BL.STONE; }
      s.blocks[chunkIndex(lx, top, lz)] = surf;
      for (var d = 1; d <= 3 && top - d > 1; d++) setIfStone(s, lx, top - d, lz, fill);
      if (biome === BI.DESERT)
        for (var yd = Math.max(2, top - 8); yd <= top - 4; yd++) setIfStone(s, lx, yd, lz, 27);
      if (bd.badlandsBands) {
        var dith = (noise.hash2(x * 13 + 1, z * 7 + 9) * 3) | 0;
        var bands = [BL.TERRACOTTA, BL.TERRACOTTA, 30, BL.TERRACOTTA, 31, 30];
        for (var yb = Math.max(2, top - 16); yb <= top - 4; yb++) {
          var band = (((yb + dith) / 3) | 0) % bands.length;
          if (band < 0) band += bands.length;
          setIfStone(s, lx, yb, lz, bands[band]);
        }
      }
      var snowLine = (biome === BI.JAGGED_PEAKS || biome === BI.FROZEN_PEAKS) ? 40 : SNOW_LEVEL;
      if (biome !== BI.DESERT && biome !== BI.BADLANDS && top >= snowLine)
        s.blocks[chunkIndex(lx, top, lz)] = 18;
    }

    function generateBase(s) {
      var lat = shaper.computeChunkLattice(s.cx, s.cz, climateAt);
      var x0 = s.cx * CS, z0 = s.cz * CS;
      for (var lx = 0; lx < CS; lx++) {
        for (var lz = 0; lz < CS; lz++) {
          var x = x0 + lx, z = z0 + lz;
          var cl = shaper.sampleClim(lat, lx, lz);
          var biome = terrainVersion === 2 && Voxel.PlanetRules && Voxel.PlanetRules.pickAllowed
            ? Voxel.PlanetRules.pickAllowed(planetTypeKey, cl, Voxel.Biomes.B.PLAINS)
            : profileBiome(Voxel.Biomes.pick(cl), cl, x, z);
          var ci = columnIndex(lx, lz);
          s.biomes[ci] = biome;
          var bd = Voxel.Biomes.def(biome);
          var th = shaper.sampleTh(lat, lx, lz);
          var top = -1;
          for (var y = 0; y < ENVELOPE; y++) {
            var i = chunkIndex(lx, y, lz);
            if (y === 0 || (y === 1 && noise.hash3(x, y, z) < 0.55) ||
              (y === 2 && noise.hash3(x + 31, y, z) < 0.25)) {
              s.blocks[i] = 12; top = y; continue;
            }
            var density = shaper.sampleLat(lat.dens, lat, lx, y, lz);
            var solid = density > 0;
            if (solid && th > WATER + 1 && y > 2 && shaper.isCave(
              shaper.sampleLat(lat.cavA, lat, lx, y, lz),
              shaper.sampleLat(lat.cavB, lat, lx, y, lz),
              shaper.sampleLat(lat.chee, lat, lx, y, lz), y, th)) solid = false;
            if (solid) {
              s.blocks[i] = 3;
              if (Voxel.PlanetRules && Voxel.PlanetRules.oreBlockForPosition) {
                var oreId = Voxel.PlanetRules.oreBlockForPosition(
                  terrainVersion, planetTypeKey, x, y, z, noise);
                if (oreId) s.blocks[i] = oreId;
              } else {
                var r = noise.hash3(x, y, z);
                if (y < 50 && r < 0.007) s.blocks[i] = 8;
                else if (y < 34 && r > 0.994) s.blocks[i] = 9;
              }
              top = y;
            } else s.blocks[i] = y <= WATER ? 7 : 0;
          }
          s.heights[ci] = top < 0 ? WATER : top;
          applySurface(s, lx, lz, x, z, top, biome, bd);
        }
      }
      s.baseReady = true;
    }

    function ensureShell(cx, cz) {
      var k = key(cx, cz), s = store[k];
      if (!s) { s = newShell(cx, cz); store[k] = s; }
      if (!s.baseReady) generateBase(s);
      return s;
    }

    // ---- 装饰期跨 shell 采样（只读，必要时补建 base）----
    // 注意：装饰锚点被限制在 legacy core 扩展盒之外（见 decorate），
    // 因此这里无需也不应回退到有限核心数据——Worker 环境没有该后端。
    function baseSurfaceAt(x, z) {
      var s = ensureShell(floorDiv(x, CS), floorDiv(z, CS));
      return s.heights[columnIndex(localCoord(x, CS), localCoord(z, CS))];
    }

    function baseBiomeAt(x, z) {
      var s = ensureShell(floorDiv(x, CS), floorDiv(z, CS));
      return s.biomes[columnIndex(localCoord(x, CS), localCoord(z, CS))];
    }

    function baseBlockAt(x, y, z) {
      if (y < 0) return 12;
      if (y >= H) return 0;
      var s = ensureShell(floorDiv(x, CS), floorDiv(z, CS));
      return s.blocks[chunkIndex(localCoord(x, CS), y, localCoord(z, CS))];
    }

    function inTarget(s, x, z) {
      return floorDiv(x, CS) === s.cx && floorDiv(z, CS) === s.cz;
    }

    function decorSet(s, x, y, z, id, airOnly) {
      if (y <= 0 || y >= H || !inTarget(s, x, z)) return;
      var i = chunkIndex(localCoord(x, CS), y, localCoord(z, CS));
      if (!airOnly || s.blocks[i] === 0) s.blocks[i] = id;
    }

    function ring(s, x, y, z, radius, id) {
      for (var dx = -radius; dx <= radius; dx++)
        for (var dz = -radius; dz <= radius; dz++) {
          if (radius > 1 && Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
          decorSet(s, x + dx, y, z + dz, id, true);
        }
    }

    function oak(s, x, h, z, r, log, leaves, thMin, thSpan) {
      var th = (thMin || 6) + ((r * 100000) | 0) % (thSpan || 5);
      for (var y = 1; y <= th; y++) decorSet(s, x, h + y, z, log, false);
      for (var ly = th - 2; ly <= th + 1; ly++) {
        var rad = ly === th + 1 ? 1 : (ly === th ? 2 : (th > 8 ? 3 : 2));
        for (var dx = -rad; dx <= rad; dx++) for (var dz = -rad; dz <= rad; dz++) {
          if (dx === 0 && dz === 0 && ly <= th) continue;
          if (rad === 2 && ly >= th && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          if (rad === 3 && Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
          decorSet(s, x + dx, h + ly, z + dz, leaves, true);
        }
      }
      decorSet(s, x, h + th + 2, z, leaves, true);
    }

    function spruce(s, x, h, z, r) {
      var th = 9 + ((r * 100000) | 0) % 6;
      for (var y = 1; y <= th; y++) decorSet(s, x, h + y, z, 20, false);
      for (var ly = 2; ly <= th + 1; ly++) {
        var rad = ly > th ? 0 : (ly === th ? 1 : (((th - ly) % 2 === 0) ? 1 : 2));
        if (!rad) decorSet(s, x, h + ly, z, 21, true);
        else {
          ring(s, x, h + ly, z, rad, 21);
          if (rad === 2) decorSet(s, x, h + ly, z, 20, true);
        }
      }
    }

    function megaSpruce(s, x, h, z, r) {
      if (baseSurfaceAt(x + 1, z) !== h || baseSurfaceAt(x, z + 1) !== h || baseSurfaceAt(x + 1, z + 1) !== h)
        return false;
      var th = 16 + ((r * 100000) | 0) % 9;
      if (h + th + 3 >= GEN_TOP) th = GEN_TOP - 4 - h;
      if (th < 10) return false;
      for (var y = 1; y <= th; y++) for (var dx = 0; dx <= 1; dx++) for (var dz = 0; dz <= 1; dz++)
        decorSet(s, x + dx, h + y, z + dz, 20, false);
      for (var ly = 5; ly <= th + 2; ly++) {
        var rem = th + 2 - ly;
        var rad = rem <= 0 ? 1 : (rem % 2 === 0 ? 2 : 3);
        ring(s, x, h + ly, z, rad, 21);
        if (rad >= 2) for (var bx = 0; bx <= 1; bx++) for (var bz = 0; bz <= 1; bz++)
          decorSet(s, x + bx, h + ly, z + bz, 20, false);
      }
      decorSet(s, x, h + th + 3, z, 21, true);
      return true;
    }

    function jungle(s, x, h, z, r) {
      var th = 9 + ((r * 100000) | 0) % 7;
      for (var y = 1; y <= th; y++) decorSet(s, x, h + y, z, 22, false);
      ring(s, x, h + th - 1, z, 2, 23); decorSet(s, x, h + th - 1, z, 22, false);
      ring(s, x, h + th, z, 2, 23); decorSet(s, x, h + th, z, 22, false);
      ring(s, x, h + th + 1, z, 1, 23);
      decorSet(s, x, h + th + 2, z, 23, true);
    }

    function giantJungle(s, x, h, z, r) {
      if (baseSurfaceAt(x + 1, z) !== h || baseSurfaceAt(x, z + 1) !== h || baseSurfaceAt(x + 1, z + 1) !== h)
        return false;
      var th = 24 + ((r * 100000) | 0) % 8;
      if (h + th + 4 >= GEN_TOP) th = GEN_TOP - 5 - h;
      if (th < 14) return false;
      for (var y = 1; y <= th; y++) for (var dx = 0; dx <= 1; dx++) for (var dz = 0; dz <= 1; dz++)
        decorSet(s, x + dx, h + y, z + dz, 22, false);
      ring(s, x, h + th - 1, z, 3, 23);
      ring(s, x, h + th, z, 3, 23);
      ring(s, x, h + th + 1, z, 2, 23);
      ring(s, x, h + th + 2, z, 1, 23);
      decorSet(s, x, h + th + 3, z, 23, true);
      for (var ty = th - 1; ty <= th; ty++) for (var tx = 0; tx <= 1; tx++) for (var tz = 0; tz <= 1; tz++)
        decorSet(s, x + tx, h + ty, z + tz, 22, false);
      return true;
    }

    function cactus(s, x, h, z, r) {
      var n = 2 + (((r * 100000) >> 3) | 0) % 3;
      for (var y = 1; y <= n; y++) decorSet(s, x, h + y, z, 26, true);
    }

    function acacia(s, x, h, z, r) {
      var th = 7 + ((r * 100000) | 0) % 3;
      for (var y = 1; y <= th; y++) decorSet(s, x, h + y, z, 35, false);
      ring(s, x, h + th, z, 2, 36); decorSet(s, x, h + th, z, 35, false);
      ring(s, x, h + th + 1, z, 1, 36);
      decorSet(s, x, h + th + 2, z, 36, true);
    }

    // 沼泽橡树：粗壮矮干 + 宽扁双层湿原树冠（复用橡木 ID，冠幅 7 格）
    function swampOak(s, x, h, z, r) {
      var rr = (r * 100000) | 0;
      var th = 5 + (rr >> 3) % 4;
      if (h + th + 3 >= GEN_TOP) return;
      for (var y = 1; y <= th; y++) decorSet(s, x, h + y, z, 4, false);
      ring(s, x, h + th - 1, z, 3, 5);
      decorSet(s, x, h + th - 1, z, 4, false);
      ring(s, x, h + th, z, 3, 5);
      decorSet(s, x, h + th, z, 4, false);
      ring(s, x, h + th + 1, z, 2, 5);
      decorSet(s, x, h + th + 2, z, 5, true);
    }

    // 巨型蘑菇（蘑菇林）：菌柄 + 两层收拢穹顶，20% 棕色。
    // 第 23 轮加高：菌柄 9/12/15 格（旧值 3/4/5 的 3 倍），伞盖加宽到 r5/r3。
    // 与 world.js 的 giantMushroomTree 逐位一致（跨核心/外围接缝的确定性契约）。
    function giantMushroom(s, x, h, z, r) {
      var rr = (r * 100000) | 0;
      var cap = (rr % 5 === 0) ? 56 : 55;
      var th = 9 + rr % 3 * 3;
      if (h + th + 4 >= GEN_TOP) th = GEN_TOP - 7 - h;
      if (th < 6) return;
      for (var y = 1; y <= th; y++) decorSet(s, x, h + y, z, 54, false);
      for (var dx = -5; dx <= 5; dx++) for (var dz = -5; dz <= 5; dz++) {
        var d2 = dx * dx + dz * dz;
        if (d2 > 27) continue;
        decorSet(s, x + dx, h + th, z + dz, cap, true);
      }
      for (var dx2 = -3; dx2 <= 3; dx2++) for (var dz2 = -3; dz2 <= 3; dz2++) {
        var dd2 = dx2 * dx2 + dz2 * dz2;
        if (dd2 > 10) continue;
        decorSet(s, x + dx2, h + th + 1, z + dz2, cap, true);
      }
      decorSet(s, x, h + th + 2, z, cap, true);
    }

    // 樱花树：斜出主干的粉团树冠
    function cherry(s, x, h, z, r) {
      var rr = (r * 100000) | 0;
      var th = 8 + ((r * 100000) | 0) % 5;
      var sx = ((rr >> 2) & 1) ? 1 : -1;
      if (h + th + 3 >= GEN_TOP) return;
      for (var y = 1; y <= th; y++)
        decorSet(s, x + (y > th - 3 ? sx : 0), h + y, z, 57, false);
      var tx = x + sx;
      for (var dx = -3; dx <= 3; dx++) for (var dz = -3; dz <= 3; dz++) {
        if (dx * dx + dz * dz > 11.5) continue;
        decorSet(s, tx + dx, h + th, z + dz, 58, true);
      }
      for (var ax = -2; ax <= 2; ax++) for (var az = -2; az <= 2; az++) {
        if (ax * ax + az * az > 2.5) continue;
        if (Math.abs(ax) === 1 && Math.abs(az) === 1 && ((rr >> (Math.abs(ax) + Math.abs(az))) & 1)) continue;
        decorSet(s, tx + ax, h + th + 1, z + az, 58, true);
      }
      decorSet(s, tx, h + th + 2, z, 58, true);
    }

    // 黑森林橡树：更高树干 + 密集暗叶方冠
    function darkOak(s, x, h, z, r) {
      var rr = (r * 100000) | 0;
      var th = 9 + ((rr >> 1) % 6);
      if (h + th + 3 >= GEN_TOP) return;
      for (var y = 1; y <= th; y++) decorSet(s, x, h + y, z, 4, false);
      for (var ly = th - 3; ly <= th + 1; ly++) {
        var rad = ly >= th ? 1 : (ly === th - 1 ? 2 : 3);
        for (var dx = -rad; dx <= rad; dx++) for (var dz = -rad; dz <= rad; dz++) {
          if (dx === 0 && dz === 0 && ly <= th) continue;
          if (rad > 1 && Math.abs(dx) === rad && Math.abs(dz) === rad) continue;
          decorSet(s, x + dx, h + ly, z + dz, 59, true);
        }
      }
      decorSet(s, x, h + th + 2, z, 59, true);
    }

    function boulder(s, x, h, z) {
      for (var dy = -1; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) for (var dz = -2; dz <= 2; dz++) {
        if (dx * dx + dz * dz + dy * dy * 1.6 > 3.4) continue;
        var xx = x + dx, yy = h + dy, zz = z + dz;
        if (!inTarget(s, xx, zz) || yy <= 0 || yy >= H) continue;
        var old = s.blocks[chunkIndex(localCoord(xx, CS), yy, localCoord(zz, CS))];
        if (old !== 12 && old !== 7) s.blocks[chunkIndex(localCoord(xx, CS), yy, localCoord(zz, CS))] = 25;
      }
    }

    // 遗迹写入器：覆写石土等自然方块，但不吃基岩/水/功能方块（工作台/床/熔炉/箱子）。
    var STRUCT_KEEP = { 12: true, 7: true, 15: true, 17: true, 37: true, 38: true,
      67: true, 68: true, 69: true, 70: true, 71: true };
    function structSet(s, x, y, z, id, mode) {
      if (y <= 0 || y >= H || !inTarget(s, x, z)) return;
      var i = chunkIndex(localCoord(x, CS), y, localCoord(z, CS));
      var old = s.blocks[i];
      if (old === 12) return;                                  // 基岩永远不覆写
      if (STRUCT_KEEP[old] && mode !== 'overwrite') return;
      if (mode === 'air') { if (old !== 0) return; }
      else if (mode === 'overwrite') { /* 仅基岩豁免 */ }
      else if (STRUCT_KEEP[old]) return;
      s.blocks[i] = id;
    }

    // 遗迹/地窖/村落：以 cell 为单位稀疏放置。每个相交区块独立重算同一座结构并按
    // inTarget 裁剪，结果与区块加载顺序无关；cell 哈希未命中的区块只有常数开销。
    function decorateStructures(s) {
      var S = Voxel.Structures;
      if (!S || !S.enabled()) return;
      var x0 = s.cx * CS, z0 = s.cz * CS;
      var E = S.EXTENT, CELL = S.CELL;
      var c0x = floorDiv(x0 - E, CELL), c1x = floorDiv(x0 + CS + E, CELL);
      var c0z = floorDiv(z0 - E, CELL), c1z = floorDiv(z0 + CS + E, CELL);
      for (var cx = c0x; cx <= c1x; cx++) {
        for (var cz = c0z; cz <= c1z; cz++) {
          var ruin = S.cellRuin(cx, cz);
          if (!ruin) continue;
          if (ruin.ax + E <= x0 || ruin.ax - E >= x0 + CS ||
            ruin.az + E <= z0 || ruin.az - E >= z0 + CS) continue;
          S.buildRuin(ruin, function (x, y, z, id, mode) {
            structSet(s, x, y, z, id, mode);
          });
        }
      }
      // 地下地窖：与遗迹同网格、不同盐
      for (var cx2 = c0x; cx2 <= c1x; cx2++) {
        for (var cz2 = c0z; cz2 <= c1z; cz2++) {
          var dg = S.cellDungeon && S.cellDungeon(cx2, cz2);
          if (!dg) continue;
          if (dg.ax + E <= x0 || dg.ax - E >= x0 + CS ||
            dg.az + E <= z0 || dg.az - E >= z0 + CS) continue;
          S.buildDungeon(dg, function (x, y, z, id, mode) {
            structSet(s, x, y, z, id, mode);
          });
        }
      }
      // 村落：cell 尺寸更大，扫描窗口独立
      var VE = S.VILLAGE_EXTENT, VC = S.VILLAGE_CELL;
      if (VE && VC) {
        var v0x = floorDiv(x0 - VE, VC), v1x = floorDiv(x0 + CS + VE, VC);
        var v0z = floorDiv(z0 - VE, VC), v1z = floorDiv(z0 + CS + VE, VC);
        for (var vx = v0x; vx <= v1x; vx++) {
          for (var vz = v0z; vz <= v1z; vz++) {
            var vil = S.cellVillage(vx, vz);
            if (!vil) continue;
            if (vil.ax + VE <= x0 || vil.ax - VE >= x0 + CS ||
              vil.az + VE <= z0 || vil.az - VE >= z0 + CS) continue;
            S.buildVillage(vil, function (x, y, z, id, mode) {
              structSet(s, x, y, z, id, mode);
            });
          }
        }
      }
    }

    // 星海嘉年华园区：同一套 cell 重算裁剪模式；EXTENT 更大（100），写侧走
    // structSet（保护区沿用），'overwrite' 仅允许越过自然方块不改基岩。
    // 返回本区块 ±FEATURE_RADIUS 内所有园区的锚点（植被 pass 跳过占地用）。
    function collectParkFootprints(s) {
      var S = Voxel.Structures;
      var out = [];
      if (!S || !S.enabled() || !S.cellPark) return out;
      var x0 = s.cx * CS, z0 = s.cz * CS;
      var PE = S.PARK_EXTENT, PC = S.PARK_CELL;
      var p0x = floorDiv(x0 - PE - FEATURE_RADIUS, PC), p1x = floorDiv(x0 + CS + PE + FEATURE_RADIUS, PC);
      var p0z = floorDiv(z0 - PE - FEATURE_RADIUS, PC), p1z = floorDiv(z0 + CS + PE + FEATURE_RADIUS, PC);
      for (var pcx = p0x; pcx <= p1x; pcx++)
        for (var pcz = p0z; pcz <= p1z; pcz++) {
          var park = S.cellPark(pcx, pcz);
          if (park) out.push({ ax: park.ax, az: park.az });
        }
      return out;
    }

    function decorateParks(s) {
      var S = Voxel.Structures;
      if (!S || !S.enabled() || !S.cellPark) return;
      var x0 = s.cx * CS, z0 = s.cz * CS;
      var PE = S.PARK_EXTENT, PC = S.PARK_CELL;
      var p0x = floorDiv(x0 - PE, PC), p1x = floorDiv(x0 + CS + PE, PC);
      var p0z = floorDiv(z0 - PE, PC), p1z = floorDiv(z0 + CS + PE, PC);
      for (var pcx = p0x; pcx <= p1x; pcx++) {
        for (var pcz = p0z; pcz <= p1z; pcz++) {
          var park = S.cellPark(pcx, pcz);
          if (!park) continue;
          if (park.ax + PE <= x0 || park.ax - PE >= x0 + CS ||
            park.az + PE <= z0 || park.az - PE >= z0 + CS) continue;
          S.buildPark(park, function (x, y, z, id, mode) {
            structSet(s, x, y, z, id, mode);
          });
        }
      }
    }

    function decorate(s) {
      if (s.decorated) return;
      var defs = Voxel.Biomes.defs;
      var x0 = s.cx * CS, z0 = s.cz * CS;
      decorateStructures(s);
      var parkFootprints = collectParkFootprints(s);
      // 村落找平圈（与 Structures.buildVillage 铺装范围一致）：植被锚点同样跳过
      function collectVillageFootprints() {
        var S = Voxel.Structures;
        var out = [];
        if (!S || !S.enabled() || !S.cellVillage) return out;
        var VE = S.VILLAGE_EXTENT + 10, VC = S.VILLAGE_CELL;
        for (var pcx = floorDiv(x0 - VE - FEATURE_RADIUS, VC); pcx <= floorDiv(x0 + CS + VE + FEATURE_RADIUS, VC); pcx++)
          for (var pcz = floorDiv(z0 - VE - FEATURE_RADIUS, VC); pcz <= floorDiv(z0 + CS + VE + FEATURE_RADIUS, VC); pcz++) {
            var vil = S.cellVillage(pcx, pcz);
            if (vil) out.push({ ax: vil.ax, az: vil.az });
          }
        return out;
      }
      var villageFootprints = collectVillageFootprints();
      // 园区找平椭圆（与 Structures.buildPark 的铺装范围一致）：植被锚点在园内
      // 必须跳过——植被 pass 读的是 base 自然地形，找平后树会穿透铺装长进园里。
      // 纯函数判定（锚点全局坐标 vs 结构锚点），跨区块结果一致。
      function inStructClearing(x, z) {
        for (var i = 0; i < parkFootprints.length; i++) {
          var dx = x - parkFootprints[i].ax, dz = z - parkFootprints[i].az;
          if (dx * dx * 0.85 + dz * dz <= 8464) return true; // 92² 椭圆
        }
        for (var j = 0; j < villageFootprints.length; j++) {
          var vx2 = x - villageFootprints[j].ax, vz2 = z - villageFootprints[j].az;
          if (vx2 * vx2 + vz2 * vz2 <= 48 * 48) return true;   // 村庄清景半径
        }
        return false;
      }
      decorateParks(s);
      // 外星巨树的写入语义与普通树一致（force 主干 / airOnly 树冠）。
      var megaPen = Voxel.Structures ? {
        force: function (px, py, pz, pid) { decorSet(s, px, py, pz, pid, false); },
        air: function (px, py, pz, pid) { decorSet(s, px, py, pz, pid, true); }
      } : null;
      // 每个目标区块独立枚举所有可能与它相交的根，并按全局 x/z 固定顺序写入。
      // 因此跨区块树冠连续，结果也不依赖区块加载顺序。
      for (var x = x0 - FEATURE_RADIUS; x < x0 + CS + FEATURE_RADIUS; x++) {
        for (var z = z0 - FEATURE_RADIUS; z < z0 + CS + FEATURE_RADIUS; z++) {
          // legacy core 的装饰完全交给旧生成器，且禁止外围 anchor 的树冠跨进核心。
          // 这样既不会改写旧档自然地形，也不会在 0/255 接缝留下被裁掉的半棵树。
          if (x >= -FEATURE_RADIUS && x <= W - 1 + FEATURE_RADIUS &&
            z >= -FEATURE_RADIUS && z <= D - 1 + FEATURE_RADIUS) continue;
          if (inStructClearing(x, z)) continue;
          var h = baseSurfaceAt(x, z);
          if (h <= WATER + 1 || h > SNOW_LEVEL - 2) continue;
          var biomeId = baseBiomeAt(x, z);
          var bd = defs[biomeId];
          if (!bd) continue;
          var surface = baseBlockAt(x, h, z);
          if (!bd.plantOn || bd.plantOn.indexOf(surface) < 0) {
            // 外星巨树（仅 terrainVersion=2）：不依赖群系 treeType 字段，
            // 命中时取代该锚点的普通植被——恶地/石峰也能长出玄武柱丛。
            if (megaPen && terrainVersion === 2 && Voxel.Blocks.isSolid(surface)) {
              var mg0 = Voxel.Structures.megaKind(planetTypeKey, terrainVersion, biomeId);
              if (mg0) {
                var rm0 = noise.hash2(x * 11 + 71, z * 13 + 33);
                if (rm0 < mg0.chance && Voxel.Structures.buildMega(mg0, megaPen, x, h, z, rm0)) continue;
              }
            }
            continue;
          }
          // 外星巨树（可种植地表）：独立哈希判定，命中时取代普通树。
          if (megaPen && terrainVersion === 2) {
            var mg = Voxel.Structures.megaKind(planetTypeKey, terrainVersion, biomeId);
            if (mg) {
              var rm = noise.hash2(x * 11 + 71, z * 13 + 33);
              if (rm < mg.chance && Voxel.Structures.buildMega(mg, megaPen, x, h, z, rm)) continue;
            }
          }
          if (bd.boulders && noise.hash2(x * 7 + 61, z * 7 + 83) < 0.0025) {
            boulder(s, x, h, z); continue;
          }
          var r = noise.hash2(x * 3 + 11, z * 5 + 29);
          if (r >= bd.treeChance) continue;
          if (bd.treeType === 'oak') oak(s, x, h, z, r, 4, 5);
          else if (bd.treeType === 'spruce') spruce(s, x, h, z, r);
          else if (bd.treeType === 'cactus') cactus(s, x, h, z, r);
          else if (bd.treeType === 'birch') oak(s, x, h, z, r, 33, 34, 8, 5);
          else if (bd.treeType === 'acacia') acacia(s, x, h, z, r);
          else if (bd.treeType === 'swamp_oak') swampOak(s, x, h, z, r);
          else if (bd.treeType === 'jungle') {
            var rg = noise.hash2(x * 5 + 3, z * 7 + 97);
            if (!(rg < bd.giantChance && giantJungle(s, x, h, z, rg))) jungle(s, x, h, z, r);
          } else if (bd.treeType === 'mega_spruce' && !megaSpruce(s, x, h, z, r)) spruce(s, x, h, z, r);
          else if (bd.treeType === 'giant_mushroom') giantMushroom(s, x, h, z, r);
          else if (bd.treeType === 'cherry') cherry(s, x, h, z, r);
          else if (bd.treeType === 'dark_oak') darkOak(s, x, h, z, r);
        }
      }
      s.decorated = true;
    }

    return {
      seed: seed,
      profile: profile,
      noise: noise,
      climateAt: climateAt,
      shaper: shaper,
      terrainVersion: terrainVersion,
      planetTypeKey: planetTypeKey,
      ensureShell: ensureShell,
      shellOf: shellOf,
      absorbShell: absorbShell,
      decorate: decorate,
      surfaceAt: baseSurfaceAt,
      biomeAt: baseBiomeAt,
      blockAt: baseBlockAt,
      _test: { store: store }
    };
  }

  return { create: create };
})();
