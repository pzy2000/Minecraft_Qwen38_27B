// DDA 体素射线 + 生物 AABB 命中
window.Voxel = window.Voxel || {};

Voxel.Raycaster = (function () {
  function castBlock(o, d, maxDist) {
    var x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    var stepX = d.x >= 0 ? 1 : -1;
    var stepY = d.y >= 0 ? 1 : -1;
    var stepZ = d.z >= 0 ? 1 : -1;
    var tdx = Math.abs(1 / (d.x || 1e-9));
    var tdy = Math.abs(1 / (d.y || 1e-9));
    var tdz = Math.abs(1 / (d.z || 1e-9));
    var tmx = (stepX > 0 ? (x + 1 - o.x) : (o.x - x)) * tdx;
    var tmy = (stepY > 0 ? (y + 1 - o.y) : (o.y - y)) * tdy;
    var tmz = (stepZ > 0 ? (z + 1 - o.z) : (o.z - z)) * tdz;
    var t = 0;
    var nx = 0, ny = 0, nz = 0;

    while (t <= maxDist) {
      var id = Voxel.World.get(x, y, z);
      if (id !== 0 && Voxel.Blocks.isSolid(id))
        return { type: 'block', x: x, y: y, z: z, nx: nx, ny: ny, nz: nz, id: id, dist: t };
      if (tmx < tmy && tmx < tmz) {
        x += stepX; t = tmx; tmx += tdx; nx = -stepX; ny = 0; nz = 0;
      } else if (tmy < tmz) {
        y += stepY; t = tmy; tmy += tdy; nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -stepZ;
      }
    }
    return null;
  }

  function rayAABB(o, d, mn, mx, maxDist) {
    var tmin = 0, tmax = maxDist;
    for (var i = 0; i < 3; i++) {
      var oi = [o.x, o.y, o.z][i];
      var di = [d.x, d.y, d.z][i];
      if (Math.abs(di) < 1e-8) {
        if (oi < mn[i] || oi > mx[i]) return -1;
      } else {
        var t1 = (mn[i] - oi) / di;
        var t2 = (mx[i] - oi) / di;
        if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      }
    }
    return tmin;
  }

  function cast(o, d, maxDist) {
    var b = castBlock(o, d, maxDist);
    var bestT = b ? b.dist : maxDist;
    var bestMob = null;
    var mobs = Voxel.Mobs.list;
    for (var i = 0; i < mobs.length; i++) {
      var m = mobs[i];
      if (m.dead) continue;
      var t = rayAABB(
        o, d,
        [m.pos.x - m.w / 2, m.pos.y, m.pos.z - m.w / 2],
        [m.pos.x + m.w / 2, m.pos.y + m.h, m.pos.z + m.w / 2],
        maxDist
      );
      if (t > 0.15 && t < bestT) { bestT = t; bestMob = m; }
    }
    if (bestMob && (!b || bestT < b.dist)) return { type: 'mob', mob: bestMob, dist: bestT };
    return b;
  }

  return { cast: cast };
})();
