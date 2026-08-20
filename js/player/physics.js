// AABB 与方块世界的碰撞
window.Voxel = window.Voxel || {};

Voxel.Physics = (function () {
  var CFG = Voxel.Config;
  var W = CFG.WORLD_W, H = CFG.WORLD_H, D = CFG.WORLD_D;
  var EPS = 0.001;

  function isSolidCell(x, y, z) {
    if (y < 0) return true;
    if (y >= H) return false;
    if (x < 0 || x >= W || z < 0 || z >= D) return true;
    return Voxel.Blocks.isSolid(Voxel.World.get(x, y, z));
  }

  function aabbCollides(px, py, pz, w, h) {
    var x0 = Math.floor(px - w / 2), x1 = Math.floor(px + w / 2);
    var y0 = Math.floor(py), y1 = Math.floor(py + h);
    var z0 = Math.floor(pz - w / 2), z1 = Math.floor(pz + w / 2);
    for (var x = x0; x <= x1; x++)
      for (var y = y0; y <= y1; y++)
        for (var z = z0; z <= z1; z++)
          if (isSolidCell(x, y, z)) return true;
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
      if (v.y < 0) { p.y = Math.floor(ny) + 1 + EPS; ent.onGround = true; }
      else if (v.y > 0) p.y = Math.floor(ny + ent.h) - ent.h - EPS;
      v.y = 0;
    } else p.y = ny;
  }

  function hasFloor(x, y, z, w) {
    var y2 = Math.floor(y) - 1;
    return isSolidCell(Math.floor(x - w / 2), y2, Math.floor(z - w / 2)) ||
      isSolidCell(Math.floor(x + w / 2), y2, Math.floor(z + w / 2)) ||
      isSolidCell(Math.floor(x), y2, Math.floor(z));
  }

  return { move: move, aabbCollides: aabbCollides, isSolidCell: isSolidCell, hasFloor: hasFloor };
})();
