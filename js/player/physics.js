// AABB 与方块世界的碰撞（支持半高方块，如床）
window.Voxel = window.Voxel || {};

Voxel.Physics = (function () {
  var CFG = Voxel.Config;
  var H = CFG.WORLD_H;
  var EPS = 0.001;

  // 格子内固体高度：0=无实体，0.5=半高（床），1=整块。
  // 行星 X/Z 无边界；未加载区块和有限空间站的安全边界由 World.get 统一处理。
  function cellTop(x, y, z) {
    if (y < 0) return 1;
    if (y >= H) return 0;
    var id = Voxel.World.get(x, y, z);
    if (!Voxel.Blocks.isSolid(id)) return 0;
    return Voxel.Blocks.defs[id].half ? 0.5 : 1;
  }

  function isSolidCell(x, y, z) { return cellTop(x, y, z) > 0; }

  function aabbCollides(px, py, pz, w, h) {
    var x0 = Math.floor(px - w / 2), x1 = Math.floor(px + w / 2);
    var y0 = Math.floor(py), y1 = Math.floor(py + h);
    var z0 = Math.floor(pz - w / 2), z1 = Math.floor(pz + w / 2);
    for (var x = x0; x <= x1; x++)
      for (var y = y0; y <= y1; y++)
        for (var z = z0; z <= z1; z++) {
          var top = cellTop(x, y, z);
          if (top <= 0) continue;
          // 实体 [py, py+h) 与格子内固体 [y, y+top) 的垂直重叠
          if (py < y + top && py + h > y) return true;
        }
    return false;
  }

  // ent: {pos: Vector3(脚底中心), vel: Vector3, w, h, onGround}
  function move(ent, dt) {
    var p = ent.pos, v = ent.vel;
    ent.onGround = false;

    var nx = p.x + v.x * dt;
    if (aabbCollides(nx, p.y, p.z, ent.w, ent.h)) {
      if (v.x > 0) p.x = Math.floor(nx + ent.w / 2) - ent.w / 2 - EPS;
      else if (v.x < 0) p.x = Math.floor(nx - ent.w / 2) + 1 + ent.w / 2 + EPS;
      v.x = 0;
    } else p.x = nx;

    var nz = p.z + v.z * dt;
    if (aabbCollides(p.x, p.y, nz, ent.w, ent.h)) {
      if (v.z > 0) p.z = Math.floor(nz + ent.w / 2) - ent.w / 2 - EPS;
      else if (v.z < 0) p.z = Math.floor(nz - ent.w / 2) + 1 + ent.w / 2 + EPS;
      v.z = 0;
    } else p.z = nz;

    var ny = p.y + v.y * dt;
    if (aabbCollides(p.x, ny, p.z, ent.w, ent.h)) {
      if (v.y < 0) {
        // 落在脚底所在行的最高固体面（整块=1，床=0.5）
        var cy = Math.floor(ny);
        var x0 = Math.floor(p.x - ent.w / 2), x1 = Math.floor(p.x + ent.w / 2);
        var z0 = Math.floor(p.z - ent.w / 2), z1 = Math.floor(p.z + ent.w / 2);
        var top = 0;
        for (var x = x0; x <= x1; x++)
          for (var z = z0; z <= z1; z++) {
            var t = cellTop(x, cy, z);
            if (t > top) top = t;
          }
        if (top <= 0) top = 1; // 防御：脚底行无实体则按整块落地
        p.y = cy + top + EPS;
        ent.onGround = true;
      } else if (v.y > 0) p.y = Math.floor(ny + ent.h) - ent.h - EPS;
      v.y = 0;
    } else p.y = ny;
  }

  function hasFloor(x, y, z, w) {
    var y2 = Math.floor(y) - 1;
    return isSolidCell(Math.floor(x - w / 2), y2, Math.floor(z - w / 2)) ||
      isSolidCell(Math.floor(x + w / 2), y2, Math.floor(z + w / 2)) ||
      isSolidCell(Math.floor(x), y2, Math.floor(z));
  }

  return { move: move, aabbCollides: aabbCollides, isSolidCell: isSolidCell, cellTop: cellTop, hasFloor: hasFloor };
})();
