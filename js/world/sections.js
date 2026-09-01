// Y 分段体素存储（plan 5.2）：16 高 section。
//
// 表示法：secs[si] 为 TypedArray（稠密段）或 null（均质段，值放在 fills[si]，0 即空段）。
// 均质段不能用 {fill} 对象承载——那样 get() 每格都要做属性探测来区分对象与 TypedArray，
// 而 get 是全局最热的函数（重光一次要跑上千万次）。分开存让 get 退化成两次数组读取。
//
// 线性布局与历史契约一致：idx = x + SX*(y + SY*z)。
// 段内布局：off = x + SX*(ly + SECTION_H*z)，ly = y & 15。
// get/set 对外语义与扁 TypedArray 逐位相同；flatten() 用于 Worker / 黄金哈希。
window.Voxel = window.Voxel || {};

Voxel.Sections = (function () {
  var SECTION_H = 16;

  function ctorFor(bytes) {
    return bytes === 1 ? Uint8Array : Uint16Array;
  }

  function sectionCount(sy) {
    return (sy / SECTION_H) | 0;
  }

  function secIndex(y) { return (y / SECTION_H) | 0; }

  function secOff(sx, x, ly, z) {
    return x + sx * (ly + SECTION_H * z);
  }

  function create(sx, sy, sz, bytes) {
    bytes = bytes || 2;
    var Ctor = ctorFor(bytes);
    var nSec = sectionCount(sy);
    var secLen = sx * SECTION_H * sz;
    var secs = new Array(nSec);
    var fills = new Int32Array(nSec);
    // 显式填 null：留空会是 holey 数组，读取要走原型链，get 退化成多态
    for (var ii = 0; ii < nSec; ii++) secs[ii] = null;
    var store = {
      __sections: true,
      sx: sx, sy: sy, sz: sz, bytes: bytes,
      nSec: nSec, secLen: secLen,
      secs: secs, fills: fills
    };

    function get(x, y, z) {
      if (y < 0 || y >= sy) return 0;
      var si = (y / SECTION_H) | 0;
      var s = secs[si];
      if (s === null) return fills[si];
      return s[x + sx * ((y & 15) + SECTION_H * z)];
    }

    function explode(si, fill) {
      var arr = new Ctor(secLen);
      if (fill) arr.fill(fill);
      secs[si] = arr;
      fills[si] = 0;
      return arr;
    }

    function set(x, y, z, v) {
      if (y < 0 || y >= sy) return;
      var si = (y / SECTION_H) | 0;
      var s = secs[si];
      if (s === null) {
        if (fills[si] === v) return;
        s = explode(si, fills[si]);
      }
      s[x + sx * ((y & 15) + SECTION_H * z)] = v;
    }

    // 线性下标热路径（光照 BFS 每格一次）：内联解码，不分配中间对象。
    function getLinear(i) {
      var z = (i / (sx * sy)) | 0;
      var rem = i - z * sx * sy;
      var y = (rem / sx) | 0;
      return get(rem - y * sx, y, z);
    }

    function setLinear(i, v) {
      var z = (i / (sx * sy)) | 0;
      var rem = i - z * sx * sy;
      var y = (rem / sx) | 0;
      set(rem - y * sx, y, z, v);
    }

    // 盒状批量写。段内 x 连续，可整行 TypedArray.fill；整段被覆盖时直接落成
    // 均质段/空段，免去分配。语义与逐格 set 一致，用于重光清零这类体积级写入。
    function fillBox(x0, x1, y0, y1, z0, z1, v) {
      if (x0 < 0) x0 = 0;
      if (z0 < 0) z0 = 0;
      if (y0 < 0) y0 = 0;
      if (x1 >= sx) x1 = sx - 1;
      if (z1 >= sz) z1 = sz - 1;
      if (y1 >= sy) y1 = sy - 1;
      if (x1 < x0 || y1 < y0 || z1 < z0) return;
      var spanXZ = (x0 === 0 && x1 === sx - 1 && z0 === 0 && z1 === sz - 1);
      for (var si = 0; si < nSec; si++) {
        var secY0 = si * SECTION_H, secY1 = secY0 + SECTION_H - 1;
        if (secY1 < y0 || secY0 > y1) continue;
        var lo = y0 > secY0 ? y0 : secY0;
        var hi = y1 < secY1 ? y1 : secY1;
        if (spanXZ && lo === secY0 && hi === secY1) {
          secs[si] = null;
          fills[si] = v;
          continue;
        }
        var s = secs[si];
        if (s === null) {
          if (fills[si] === v) continue;
          s = explode(si, fills[si]);
        }
        for (var z = z0; z <= z1; z++)
          for (var y = lo; y <= hi; y++) {
            var base = sx * ((y & 15) + SECTION_H * z);
            s.fill(v, base + x0, base + x1 + 1);
          }
      }
    }

    function sectionEmpty(si) {
      return secs[si] === null && fills[si] === 0;
    }

    // 空段（fill=0）对外仍报 undefined，与历史契约一致
    function sectionFill(si) {
      return secs[si] === null && fills[si] ? fills[si] : undefined;
    }

    function setSectionFill(si, v) {
      secs[si] = null;
      fills[si] = v || 0;
    }

    function clear() {
      for (var i = 0; i < nSec; i++) { secs[i] = null; fills[i] = 0; }
    }

    function compact() {
      var saved = 0;
      for (var si = 0; si < nSec; si++) {
        var s = secs[si];
        if (s === null) continue;
        var first = s[0], same = true;
        for (var j = 1; j < secLen; j++) {
          if (s[j] !== first) { same = false; break; }
        }
        if (same) {
          secs[si] = null;
          fills[si] = first;
          saved += secLen * bytes;
        }
      }
      return saved;
    }

    function flatten() {
      var out = new Ctor(sx * sy * sz);
      for (var si = 0; si < nSec; si++) {
        var s = secs[si];
        var y0 = si * SECTION_H;
        if (s === null) {
          var fv = fills[si];
          if (!fv) continue;
          for (var z = 0; z < sz; z++)
            for (var ly = 0; ly < SECTION_H; ly++) {
              var dest = sx * ((y0 + ly) + sy * z);
              for (var x = 0; x < sx; x++) out[dest + x] = fv;
            }
          continue;
        }
        for (var z2 = 0; z2 < sz; z2++)
          for (var ly2 = 0; ly2 < SECTION_H; ly2++) {
            var dest2 = sx * ((y0 + ly2) + sy * z2);
            var src = sx * (ly2 + SECTION_H * z2);
            out.set(s.subarray(src, src + sx), dest2);
          }
      }
      return out;
    }

    function copyColumn(lx, lz, dest, destBase, destStride, emptyVal) {
      if (emptyVal === undefined) emptyVal = 0;
      for (var si = 0; si < nSec; si++) {
        var s = secs[si];
        var y0 = si * SECTION_H;
        if (s === null) {
          var fv = fills[si] || emptyVal;
          for (var ly0 = 0; ly0 < SECTION_H; ly0++)
            dest[destBase + (y0 + ly0) * destStride] = fv;
          continue;
        }
        for (var ly2 = 0; ly2 < SECTION_H; ly2++)
          dest[destBase + (y0 + ly2) * destStride] = s[secOff(sx, lx, ly2, lz)];
      }
    }

    function estimateBytes() {
      var n = 0;
      for (var i = 0; i < nSec; i++) {
        var s = secs[i];
        if (s === null) { if (fills[i]) n += 16; continue; }
        n += s.byteLength;
      }
      return n;
    }

    function subarray(start, end) {
      return flatten().subarray(start, end);
    }

    store.get = get;
    store.set = set;
    store.getLinear = getLinear;
    store.setLinear = setLinear;
    store.fillBox = fillBox;
    store.sectionEmpty = sectionEmpty;
    store.sectionFill = sectionFill;
    store.setSectionFill = setSectionFill;
    store.clear = clear;
    store.compact = compact;
    store.flatten = flatten;
    store.copyColumn = copyColumn;
    store.estimateBytes = estimateBytes;
    store.subarray = subarray;
    store.length = sx * sy * sz;
    return store;
  }

  function fromFlat(arr, sx, sy, sz) {
    var bytes = arr.BYTES_PER_ELEMENT || 2;
    var Ctor = ctorFor(bytes);
    var store = create(sx, sy, sz, bytes);
    var nSec = store.nSec;
    var secLen = store.secLen;
    for (var si = 0; si < nSec; si++) {
      var y0 = si * SECTION_H;
      var first = arr[sx * (y0 + sy * 0)] || 0;
      var same = true;
      var any = false;
      var raw = null;
      for (var z = 0; z < sz && (same || !any); z++) {
        for (var ly = 0; ly < SECTION_H; ly++) {
          var src = sx * ((y0 + ly) + sy * z);
          for (var x = 0; x < sx; x++) {
            var v = arr[src + x];
            if (v) any = true;
            if (same && v !== first) {
              same = false;
              if (any) break;
            }
          }
          if (!same && any) break;
        }
      }
      if (!any) continue;
      if (same) {
        store.setSectionFill(si, first);
        continue;
      }
      raw = new Ctor(secLen);
      for (var z2 = 0; z2 < sz; z2++)
        for (var ly2 = 0; ly2 < SECTION_H; ly2++) {
          var dest = sx * (ly2 + SECTION_H * z2);
          var src2 = sx * ((y0 + ly2) + sy * z2);
          raw.set(arr.subarray(src2, src2 + sx), dest);
        }
      store.secs[si] = raw;
    }
    return store;
  }

  function wrapOrFlat(blocks, sx, sy, sz) {
    if (blocks && blocks.__sections) return blocks;
    return fromFlat(blocks, sx, sy, sz);
  }

  function read(blocks, x, y, z, sx, sy) {
    if (!blocks) return 0;
    if (blocks.__sections) return blocks.get(x, y, z);
    return blocks[x + sx * (y + sy * z)] || 0;
  }

  function write(blocks, x, y, z, v, sx, sy) {
    if (!blocks) return;
    if (blocks.__sections) { blocks.set(x, y, z, v); return; }
    blocks[x + sx * (y + sy * z)] = v;
  }

  function asFlat(blocks, sx, sy, sz) {
    if (!blocks) return null;
    if (blocks.__sections) return blocks.flatten();
    return blocks;
  }

  function estimateBytes(blocks, sx, sy, sz, bytes) {
    if (!blocks) return 0;
    if (blocks.__sections) return blocks.estimateBytes();
    return (sx * sy * sz) * (bytes || blocks.BYTES_PER_ELEMENT || 2);
  }

  function denseBytes(sx, sy, sz, bytesPerChannel, channels) {
    return sx * sy * sz * (bytesPerChannel || 2) * (channels || 1);
  }

  return {
    HEIGHT: SECTION_H,
    create: create,
    fromFlat: fromFlat,
    wrapOrFlat: wrapOrFlat,
    read: read,
    write: write,
    asFlat: asFlat,
    estimateBytes: estimateBytes,
    denseBytes: denseBytes,
    sectionCount: sectionCount
  };
})();
