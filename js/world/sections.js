// Y 分段体素存储（plan 5.2）：16 高 section，空段 null，均质段 {fill}。
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

  function decodeLinear(i, sx, sy) {
    var z = (i / (sx * sy)) | 0;
    var rem = i - z * sx * sy;
    var y = (rem / sx) | 0;
    return { x: rem - y * sx, y: y, z: z };
  }

  function isFill(s) {
    // TypedArray 也有 .fill 方法，必须用缺省 BYTES_PER_ELEMENT 区分均质段对象
    return !!s && s.BYTES_PER_ELEMENT === undefined && typeof s.fill === 'number';
  }

  function create(sx, sy, sz, bytes) {
    bytes = bytes || 2;
    var Ctor = ctorFor(bytes);
    var nSec = sectionCount(sy);
    var secLen = sx * SECTION_H * sz;
    var secs = new Array(nSec);
    var store = {
      __sections: true,
      sx: sx, sy: sy, sz: sz, bytes: bytes,
      nSec: nSec, secLen: secLen,
      secs: secs
    };

    function get(x, y, z) {
      if (y < 0 || y >= sy) return 0;
      var s = secs[secIndex(y)];
      if (!s) return 0;
      if (isFill(s)) return s.fill;
      return s[secOff(sx, x, y & 15, z)];
    }

    function explode(si, fill) {
      var arr = new Ctor(secLen);
      if (fill) arr.fill(fill);
      secs[si] = arr;
      return arr;
    }

    function set(x, y, z, v) {
      if (y < 0 || y >= sy) return;
      var si = secIndex(y);
      var s = secs[si];
      if (!s) {
        if (!v) return;
        s = explode(si, 0);
      } else if (isFill(s)) {
        if (s.fill === v) return;
        s = explode(si, s.fill);
      }
      s[secOff(sx, x, y & 15, z)] = v;
    }

    function getLinear(i) {
      var p = decodeLinear(i, sx, sy);
      return get(p.x, p.y, p.z);
    }

    function setLinear(i, v) {
      var p = decodeLinear(i, sx, sy);
      set(p.x, p.y, p.z, v);
    }

    function sectionEmpty(si) {
      var s = secs[si];
      return !s || (isFill(s) && s.fill === 0);
    }

    function sectionFill(si) {
      var s = secs[si];
      return isFill(s) ? s.fill : undefined;
    }

    function setSectionFill(si, v) {
      secs[si] = v ? { fill: v } : null;
    }

    function clear() {
      for (var i = 0; i < nSec; i++) secs[i] = null;
    }

    function compact() {
      var saved = 0;
      for (var si = 0; si < nSec; si++) {
        var s = secs[si];
        if (!s || isFill(s)) continue;
        var first = s[0], same = true;
        for (var j = 1; j < secLen; j++) {
          if (s[j] !== first) { same = false; break; }
        }
        if (same) {
          secs[si] = first ? { fill: first } : null;
          saved += secLen * bytes;
        }
      }
      return saved;
    }

    function flatten() {
      var out = new Ctor(sx * sy * sz);
      for (var si = 0; si < nSec; si++) {
        var s = secs[si];
        if (!s) continue;
        var y0 = si * SECTION_H;
        if (isFill(s)) {
          if (!s.fill) continue;
          for (var z = 0; z < sz; z++)
            for (var ly = 0; ly < SECTION_H; ly++) {
              var dest = sx * ((y0 + ly) + sy * z);
              for (var x = 0; x < sx; x++) out[dest + x] = s.fill;
            }
        } else {
          for (var z2 = 0; z2 < sz; z2++)
            for (var ly2 = 0; ly2 < SECTION_H; ly2++) {
              var dest2 = sx * ((y0 + ly2) + sy * z2);
              var src = sx * (ly2 + SECTION_H * z2);
              out.set(s.subarray(src, src + sx), dest2);
            }
        }
      }
      return out;
    }

    function copyColumn(lx, lz, dest, destBase, destStride, emptyVal) {
      if (emptyVal === undefined) emptyVal = 0;
      for (var si = 0; si < nSec; si++) {
        var s = secs[si];
        var y0 = si * SECTION_H;
        if (!s) {
          for (var ly0 = 0; ly0 < SECTION_H; ly0++)
            dest[destBase + (y0 + ly0) * destStride] = emptyVal;
          continue;
        }
        if (isFill(s)) {
          for (var ly = 0; ly < SECTION_H; ly++)
            dest[destBase + (y0 + ly) * destStride] = s.fill;
        } else {
          for (var ly2 = 0; ly2 < SECTION_H; ly2++)
            dest[destBase + (y0 + ly2) * destStride] = s[secOff(sx, lx, ly2, lz)];
        }
      }
    }

    function estimateBytes() {
      var n = 0;
      for (var i = 0; i < nSec; i++) {
        var s = secs[i];
        if (!s) continue;
        if (isFill(s)) n += 16;
        else n += s.byteLength;
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
        store.secs[si] = { fill: first };
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
