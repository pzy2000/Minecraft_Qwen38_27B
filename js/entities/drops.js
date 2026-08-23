// 掉落物实体：丢弃/掉落的物品以小立方体呈现，靠近自动拾取
window.Voxel = window.Voxel || {};

Voxel.Drops = (function () {
  var W = Voxel.Config.WORLD_W, H = Voxel.Config.WORLD_H, D = Voxel.Config.WORLD_D;
  var list = [];
  var group = null;
  var mat = null;
  var geoCache = {};     // id -> BufferGeometry（图集 UV 小立方体）
  var DESPAWN = 300;     // 秒后消失
  var PICKUP_DIST = 1.5, MAGNET_DIST = 2.2;

  // 物品小立方体：六面贴图标纹理
  function makeGeo(id) {
    var geo = new THREE.BoxGeometry(0.26, 0.26, 0.26);
    var uv = geo.attributes.uv;
    var t = Voxel.Blocks.iconTile(id);
    if (t < 0) t = Voxel.Blocks.tileForFace(id, 1);
    var c = t % 16, r = (t / 16) | 0;
    var cornerV = [[0, 1], [1, 1], [0, 0], [1, 0]];
    for (var f = 0; f < 6; f++)
      for (var k = 0; k < 4; k++)
        uv.setXY(f * 4 + k,
          (c * 16 + 0.5 + cornerV[k][0] * 15) / 256,
          1 - (r * 16 + 0.5 + (1 - cornerV[k][1]) * 15) / 256);
    uv.needsUpdate = true;
    return geo;
  }

  // 在 pos 处生成掉落物；vel 初速度可选；dur 工具耐久（可选）
  function spawn(id, n, pos, vel, dur) {
    if (!group || !id || !n) return null;
    if (!geoCache[id]) geoCache[id] = makeGeo(id);
    var mesh = new THREE.Mesh(geoCache[id], mat);
    group.add(mesh);
    var m = {
      id: id, n: n, dur: dur !== undefined ? dur : null,
      pos: pos.clone(),
      ent: { pos: pos.clone(), vel: (vel || new THREE.Vector3()).clone(), w: 0.25, h: 0.25, onGround: false },
      age: 0,
      spin: (Math.random() - 0.5) * 3,
      mesh: mesh,
      dead: false
    };
    list.push(m);
    return m;
  }

  function removeAt(i) {
    group.remove(list[i].mesh);
    list.splice(i, 1);
  }

  function update(dt) {
    var Pl = Voxel.Player;
    var alive = Pl.alive();
    for (var i = list.length - 1; i >= 0; i--) {
      var m = list[i];
      m.age += dt;

      // 物理：轻重力 + 地面摩擦
      m.ent.vel.y -= 22 * dt;
      if (m.ent.vel.y < -28) m.ent.vel.y = -28;
      if (m.ent.onGround) {
        var fr = Math.max(0, 1 - dt * 8);
        m.ent.vel.x *= fr;
        m.ent.vel.z *= fr;
      }
      Voxel.Physics.move(m.ent, dt);
      m.pos.copy(m.ent.pos);

      // 磁吸 + 拾取（出生 0.5s 后才生效，避免立刻飞回）
      if (alive && m.age > 0.5) {
        var p = Pl.pos();
        var dx = p.x - m.pos.x, dy = (p.y + 0.9) - m.pos.y, dz = p.z - m.pos.z;
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < MAGNET_DIST && dist > 0.001) {
          var pull = 9 * dt;
          m.ent.vel.x += dx / dist * pull * 60 * dt;
          m.ent.vel.y += dy / dist * pull * 40 * dt;
          m.ent.vel.z += dz / dist * pull * 60 * dt;
        }
        if (dist < PICKUP_DIST && Voxel.Game.pickupDrop) {
          var got = Voxel.Game.pickupDrop(m.id, m.n, m.dur);
          if (got >= m.n) { removeAt(i); continue; }
          if (got > 0) m.n -= got;
        }
      }

      // 出界 / 超时消失
      if (m.pos.y < -8 || m.age > DESPAWN ||
        m.pos.x < 0 || m.pos.x >= W || m.pos.z < 0 || m.pos.z >= D) {
        removeAt(i);
        continue;
      }

      // 渲染：悬浮微动 + 缓慢旋转
      m.mesh.position.set(
        m.pos.x,
        m.pos.y + 0.14 + Math.sin(m.age * 2.5) * 0.025,
        m.pos.z);
      m.mesh.rotation.y += m.spin * dt;
    }
  }

  function applyTint(tint) {
    if (mat) mat.color.copy(tint);
  }

  function clear() {
    for (var i = list.length - 1; i >= 0; i--) removeAt(i);
  }

  function init(scene) {
    group = new THREE.Group();
    scene.add(group);
    mat = new THREE.MeshBasicMaterial({ map: Voxel.Blocks.getTexture() });
  }

  return {
    init: init,
    update: update,
    spawn: spawn,
    clear: clear,
    applyTint: applyTint,
    list: list,
    count: function () { return list.length; }
  };
})();
