// 地形塑造：样条曲线（大陆性/侵蚀度/奇异性 → 高度）+ 3D 密度场插值 + 洞穴
// 对齐 MC 1.18 的 terrain shaping / density function / 插值单元思路的简化版。
// 无 DOM/THREE 依赖，可在 Node 冒烟测试中加载。
window.Voxel = window.Voxel || {};

Voxel.Shaper = (function () {
  var CFG = Voxel.Config;
  var H = CFG.WORLD_H, CS = CFG.CHUNK, WATER = CFG.WATER_LEVEL;
  var CELL = 4; // 密度插值单元边长（角采样，体素三线性插值）

  // ---- 分段平滑样条（smoothstep 插值，C1 连续） ----
  function spline(pts, x) {
    if (x <= pts[0][0]) return pts[0][1];
    for (var i = 0; i < pts.length - 1; i++) {
      if (x <= pts[i + 1][0]) {
        var t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
        t = t * t * (3 - 2 * t);
        return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      }
    }
    return pts[pts.length - 1][1];
  }

  function smoothstep(a, b, x) {
    var t = (x - a) / (b - a);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }

  // 大陆性偏移样条：深海 -> 海岸 -> 内陆隆起
  var OFFSET_PTS = [[-1, -22], [-0.62, -14], [-0.38, -3], [-0.18, 3], [0.05, 7], [0.3, 12], [0.6, 17], [1, 24]];
  // 侵蚀度起伏系数：侵蚀越低起伏越大
  var FACTOR_PTS = [[-1, 1.55], [-0.5, 1.25], [0, 0.9], [0.5, 0.65], [1, 0.5]];

  function create(noise) {
    var N = Voxel.Noise.SALT;
    var detailCh = noise.channel(N.TERRAIN, 4);   // 地表细节（2D）
    var var3dCh = noise.channel(N.TERRAIN3D, 3);  // 3D 变形（峭壁/悬垂）
    var jaggedCh = noise.channel(N.JAGGED, 3);    // 山脊锯齿
    var caveA = noise.channel(N.CAVE_A, 2);       // 意面洞穴 A
    var caveB = noise.channel(N.CAVE_B, 2);       // 意面洞穴 B
    var cheeseCh = noise.channel(N.CHEESE, 2);    // 奶酪洞穴

    // 峰值遮罩：大陆性高 且 侵蚀度低
    function peakMaskOf(cl) {
      return smoothstep(0.25, 0.5, cl.c) * smoothstep(-0.45, -0.75, cl.e);
    }

    // 目标高度：水位基线 + 大陆偏移 + 细节×起伏系数 + 山脊锯齿
    function targetHeight(x, z, cl) {
      var off = spline(OFFSET_PTS, cl.c);
      var v = spline(FACTOR_PTS, cl.e);
      var det = detailCh.at2(x * 0.011, z * 0.011);
      var h = WATER + 2 + off + det * (3.5 + 6.5 * v);
      var pm = peakMaskOf(cl);
      if (pm > 0) {
        var jag = 1 - Math.abs(jaggedCh.at2(x * 0.03, z * 0.03));
        h += jag * jag * 17 * v;
      }
      if (h < 4) h = 4;
      if (h > H - 6) h = H - 6;
      return h;
    }

    // 角点基础密度：>0 实心。垂直梯度为主，3D 变形在山区制造悬垂
    function baseDensity(th, pm, x, y, z) {
      var d = (th - y) / 12;
      var amp = 0.3 + pm * 0.6;
      d += var3dCh.at3(x * 0.02, y * 0.04, z * 0.02) * amp;
      return d;
    }

    // ---- 区块密度格网：全局网格对齐，跨区块结果天然一致 ----
    // 角点数 (CS/CELL+1)^2 × (H/CELL+1)
    var NX = CS / CELL + 1, NY = H / CELL + 1;

    function computeChunkLattice(cx, cz, climateAt) {
      var nxy = NX * NY;
      var dens = new Float32Array(nxy * NX);
      var cavA = new Float32Array(nxy * NX);
      var cavB = new Float32Array(nxy * NX);
      var chee = new Float32Array(nxy * NX);
      var th = new Float32Array(NX * NX);
      var pk = new Float32Array(NX * NX);
      var clim = new Float32Array(NX * NX * 5); // t/h/c/e/w 逐角点存储
      for (var ix = 0; ix < NX; ix++) {
        for (var iz = 0; iz < NX; iz++) {
          var wx = cx * CS + ix * CELL + 0.5;
          var wz = cz * CS + iz * CELL + 0.5;
          var cl = climateAt(wx, wz);
          var t = targetHeight(wx, wz, cl);
          var m = peakMaskOf(cl);
          var ci = ix + NX * iz;
          th[ci] = t;
          pk[ci] = m;
          clim[ci * 5] = cl.t; clim[ci * 5 + 1] = cl.h; clim[ci * 5 + 2] = cl.c;
          clim[ci * 5 + 3] = cl.e; clim[ci * 5 + 4] = cl.w;
          for (var iy = 0; iy < NY; iy++) {
            var wy = iy * CELL + 0.5;
            var k = ix + NX * (iy + NY * iz);
            dens[k] = baseDensity(t, m, wx, wy, wz);
            cavA[k] = caveA.at3(wx * 0.03, wy * 0.045, wz * 0.03);
            cavB[k] = caveB.at3(wx * 0.03 + 137.1, wy * 0.045 + 53.7, wz * 0.03 + 89.3);
            chee[k] = cheeseCh.at3(wx * 0.014, wy * 0.02, wz * 0.014);
          }
        }
      }
      return { dens: dens, cavA: cavA, cavB: cavB, chee: chee, th: th, pk: pk, clim: clim };
    }

    // 双线性插值角点气候（与地形塑造同一数据源，保证群系/地形一致）
    function sampleClim(lat, lx, lz) {
      var fx = lx / CELL, fz = lz / CELL;
      var x0 = fx | 0, z0 = fz | 0;
      var tx, tz;
      if (x0 >= NX - 1) { x0 = NX - 2; tx = 1; } else tx = fx - x0;
      if (z0 >= NX - 1) { z0 = NX - 2; tz = 1; } else tz = fz - z0;
      var out = {};
      for (var c = 0; c < 5; c++) {
        var i = (x0 + NX * z0) * 5 + c;
        var c0 = lat.clim[i] + (lat.clim[i + 5] - lat.clim[i]) * tx;
        var c1 = lat.clim[i + NX * 5] + (lat.clim[i + (NX + 1) * 5] - lat.clim[i + NX * 5]) * tx;
        out[c === 0 ? 't' : c === 1 ? 'h' : c === 2 ? 'c' : c === 3 ? 'e' : 'w'] =
          c0 + (c1 - c0) * tz;
      }
      return out;
    }

    // 三线性插值采样（lx/lz 为区块内局部坐标 0..CS-1，y 全高）
    function sampleLat(arr, lat, lx, y, lz) {
      var fx = lx / CELL, fy = y / CELL, fz = lz / CELL;
      var x0 = fx | 0, y0 = fy | 0, z0 = fz | 0;
      if (x0 >= NX - 1) { x0 = NX - 2; fx = x0 + 1; } else fx -= x0;
      if (z0 >= NX - 1) { z0 = NX - 2; fz = z0 + 1; } else fz -= z0;
      if (y0 >= NY - 1) { y0 = NY - 2; fy = y0 + 1; } else fy -= y0;
      var nxny = NX * NY;
      var i000 = x0 + NX * (y0 + NY * z0);
      var dx = fx, dy = fy, dz = fz;
      var c00 = arr[i000] + (arr[i000 + 1] - arr[i000]) * dx;
      var c10 = arr[i000 + NX] + (arr[i000 + NX + 1] - arr[i000 + NX]) * dx;
      var c01 = arr[i000 + nxny] + (arr[i000 + nxny + 1] - arr[i000 + nxny]) * dx;
      var c11 = arr[i000 + NX + nxny] + (arr[i000 + NX + nxny + 1] - arr[i000 + NX + nxny]) * dx;
      var c0 = c00 + (c01 - c00) * dz;
      var c1 = c10 + (c11 - c10) * dz;
      return c0 + (c1 - c0) * dy;
    }

    function sampleTh(lat, lx, lz) {
      var fx = lx / CELL, fz = lz / CELL;
      var x0 = fx | 0, z0 = fz | 0;
      if (x0 >= NX - 1) { x0 = NX - 2; fx = 1; } else fx -= x0;
      if (z0 >= NX - 1) { z0 = NX - 2; fz = 1; } else fz -= z0;
      var i = x0 + NX * z0;
      var c0 = lat.th[i] + (lat.th[i + 1] - lat.th[i]) * fx;
      var c1 = lat.th[i + NX] + (lat.th[i + NX + 1] - lat.th[i + NX]) * fx;
      return c0 + (c1 - c0) * fz;
    }

    function samplePk(lat, lx, lz) {
      var fx = lx / CELL, fz = lz / CELL;
      var x0 = fx | 0, z0 = fz | 0;
      if (x0 >= NX - 1) { x0 = NX - 2; fx = 1; } else fx -= x0;
      if (z0 >= NX - 1) { z0 = NX - 2; fz = 1; } else fz -= z0;
      var i = x0 + NX * z0;
      var c0 = lat.pk[i] + (lat.pk[i + 1] - lat.pk[i]) * fx;
      var c1 = lat.pk[i + NX] + (lat.pk[i + NX + 1] - lat.pk[i + NX]) * fx;
      return c0 + (c1 - c0) * fz;
    }

    // 洞穴判定：意面隧道（双脊线交集）+ 奶酪空腔。接近地表收敛保护表层。
    function isCave(av, bv, cv, y, th) {
      var fade = (th - 3 - y) / 6;
      if (fade > 1) fade = 1;
      if (fade > 0) {
        var eps = 0.085 * fade;
        if (av > -eps && av < eps && bv > -eps && bv < eps) return true;
      }
      if (y <= 34 && cv > 0.58) return true;
      return false;
    }

    return {
      CELL: CELL,
      NX: NX,
      NY: NY,
      targetHeight: targetHeight,
      peakMaskOf: peakMaskOf,
      computeChunkLattice: computeChunkLattice,
      sampleClim: sampleClim,
      sampleLat: sampleLat,
      sampleTh: sampleTh,
      samplePk: samplePk,
      isCave: isCave
    };
  }

  return {
    create: create,
    spline: spline,
    smoothstep: smoothstep
  };
})();
