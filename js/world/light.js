// 列天光 + 块光泛光（plan 5.3）：供 gen_worker 与主线程 relight 共用。
//
// 外围区块天光是纯列扫描（不水平传播），因此生成时即可算完。
// 块光 intra-chunk flood 也在此；跨区块 3×3 BFS 仍由 infinite.js 调度。
window.Voxel = window.Voxel || {};

Voxel.Light = (function () {
  'use strict';

  var CFG = Voxel.Config;
  var CS = CFG.CHUNK, H = CFG.WORLD_H;
  var SEC_H = (Voxel.Sections && Voxel.Sections.HEIGHT) || 16;

  function chunkIndex(lx, y, lz) { return lx + CS * (y + H * lz); }

  function lightCost(id) {
    if (Voxel.Blocks.isOpaque(id)) return -1;
    return id === 7 ? 2 : 1;
  }

  // 直调分段存储闭包，绕开 Sections.read/write 转发层（见 world.js 同名说明）
  function volGet(arr, lx, y, lz) {
    return arr.__sections ? arr.get(lx, y, lz) : arr[chunkIndex(lx, y, lz)];
  }

  function volSet(arr, lx, y, lz, v) {
    if (arr.__sections) arr.set(lx, y, lz, v);
    else arr[chunkIndex(lx, y, lz)] = v;
  }

  function volGetI(arr, i) {
    return arr && arr.__sections ? arr.getLinear(i) : arr[i];
  }

  function volSetI(arr, i, v) {
    if (arr && arr.__sections) arr.setLinear(i, v);
    else arr[i] = v;
  }

  // 列天光 + 收集发光方块。写入 sky；blk 只在发射格写入等级（不 flood）。
  // contentTop 以上不落盘（读取侧回 15）。
  function scanColumnSky(blocks, sky, blk, contentTop) {
    var LIGHT = Voxel.Blocks.LIGHT;
    var top = contentTop | 0;
    if (top < 0) top = 0;
    if (top >= H) top = H - 1;
    var topSec = (top / SEC_H) | 0;
    var emit = [];
    var buckets = [];
    for (var lx = 0; lx < CS; lx++) for (var lz = 0; lz < CS; lz++) {
      var light = 15;
      for (var si = topSec; si >= 0; si--) {
        var yHi = Math.min(top, si * SEC_H + SEC_H - 1);
        var yLo = si * SEC_H;
        var empty = blocks.sectionEmpty && blocks.sectionEmpty(si);
        if (empty) {
          if (light) {
            for (var ye = yHi; ye >= yLo; ye--) volSet(sky, lx, ye, lz, light);
          }
          continue;
        }
        for (var y = yHi; y >= yLo; y--) {
          var id = volGet(blocks, lx, y, lz);
          if (Voxel.Blocks.isOpaque(id)) light = 0;
          else if (id === 7 && light > 0) light = Math.max(0, light - 2);
          volSet(sky, lx, y, lz, light);
          var em = LIGHT[id];
          if (em) {
            volSet(blk, lx, y, lz, em);
            var i = chunkIndex(lx, y, lz);
            emit.push(i);
            if (!buckets[em]) buckets[em] = [];
            buckets[em].push(i);
          }
        }
      }
    }
    return { emit: emit, buckets: buckets };
  }

  function spreadIntra(blocks, arr, buckets, lx, y, lz, level) {
    if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 0 || y >= H || level <= 0) return;
    var i = chunkIndex(lx, y, lz);
    var cost = lightCost(volGet(blocks, lx, y, lz));
    if (cost < 0) return;
    var next = level - (cost - 1);
    if (next <= volGetI(arr, i)) return;
    volSetI(arr, i, next);
    if (!buckets[next]) buckets[next] = [];
    buckets[next].push(i);
  }

  function floodIntra(blocks, arr, buckets) {
    for (var level = 15; level >= 1; level--) {
      var q = buckets[level];
      if (!q) continue;
      for (var qi = 0; qi < q.length; qi++) {
        var i = q[qi];
        if (volGetI(arr, i) !== level) continue;
        var lz = (i / (CS * H)) | 0;
        var rem = i - lz * CS * H;
        var y = (rem / CS) | 0;
        var lx = rem - y * CS;
        var next = level - 1;
        spreadIntra(blocks, arr, buckets, lx + 1, y, lz, next);
        spreadIntra(blocks, arr, buckets, lx - 1, y, lz, next);
        spreadIntra(blocks, arr, buckets, lx, y + 1, lz, next);
        spreadIntra(blocks, arr, buckets, lx, y - 1, lz, next);
        spreadIntra(blocks, arr, buckets, lx, y, lz + 1, next);
        spreadIntra(blocks, arr, buckets, lx, y, lz - 1, next);
      }
    }
  }

  // 可中断 intra flood：state = { level, qi }，返回 true 表示完成。
  function floodIntraSlice(blocks, arr, buckets, state, maxOps) {
    var ops = 0;
    var level = state.level | 0;
    if (!level) { state.level = 15; state.qi = 0; level = 15; }
    while (level >= 1) {
      var q = buckets[level];
      var qi = state.qi | 0;
      if (q) {
        for (; qi < q.length; qi++) {
          var i = q[qi];
          if (volGetI(arr, i) !== level) continue;
          var lz = (i / (CS * H)) | 0;
          var rem = i - lz * CS * H;
          var y = (rem / CS) | 0;
          var lx = rem - y * CS;
          var next = level - 1;
          spreadIntra(blocks, arr, buckets, lx + 1, y, lz, next);
          spreadIntra(blocks, arr, buckets, lx - 1, y, lz, next);
          spreadIntra(blocks, arr, buckets, lx, y + 1, lz, next);
          spreadIntra(blocks, arr, buckets, lx, y - 1, lz, next);
          spreadIntra(blocks, arr, buckets, lx, y, lz + 1, next);
          spreadIntra(blocks, arr, buckets, lx, y, lz - 1, next);
          if (++ops >= maxOps) {
            state.level = level;
            state.qi = qi + 1;
            return false;
          }
        }
      }
      level--;
      state.level = level;
      state.qi = 0;
    }
    return true;
  }

  function hashVolume(arr, contentTop) {
    var h = 0x811c9dc5;
    var top = Math.min(H - 1, contentTop | 0);
    for (var lz = 0; lz < CS; lz++) for (var lx = 0; lx < CS; lx++) {
      for (var y = 0; y <= top; y++) {
        h ^= volGet(arr, lx, y, lz) & 0xff;
        h = Math.imul(h, 16777619) >>> 0;
      }
    }
    return h >>> 0;
  }

  return {
    lightCost: lightCost,
    chunkIndex: chunkIndex,
    scanColumnSky: scanColumnSky,
    floodIntra: floodIntra,
    floodIntraSlice: floodIntraSlice,
    hashVolume: hashVolume
  };
})();
