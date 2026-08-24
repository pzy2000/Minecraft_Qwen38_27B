// 掉落物实体：丢弃/掉落的物品以小立方体呈现，靠近自动拾取
window.Voxel = window.Voxel || {};

Voxel.Drops = (function () {
  var list = [];
  var group = null;
  var mat = null;
  var geoCache = {};     // id -> BufferGeometry（图集 UV 小立方体）
  var DESPAWN = 300;     // 秒后消失
  var PICKUP_DIST = 1.5, MAGNET_DIST = 2.2;
  // 存档是不可信输入：同一世界最多恢复 256 个实体，且最多检查 1024 条，
  // 避免损坏/恶意 JSON 在载入时制造无界循环、内存占用或海量 Mesh。
  var MAX_SAVED_DROPS = 256;
  var MAX_RESTORE_SCAN = 1024;
  var MAX_WORLD_XZ = 30000000; // Minecraft-like 实用坐标上限
  var MAX_SAVED_SPEED = 64;
  var MIN_SAVED_Y = -8;
  var MAX_SAVED_Y = Voxel.Config.WORLD_H + 512;

  function finiteNumber(v) { return typeof v === 'number' && isFinite(v); }
  function integer(v) { return finiteNumber(v) && Math.floor(v) === v; }

  function validVec3(v, isVelocity) {
    if (!Array.isArray(v) || v.length !== 3 || !finiteNumber(v[0]) || !finiteNumber(v[1]) || !finiteNumber(v[2]))
      return false;
    if (isVelocity) {
      return v[0] * v[0] + v[1] * v[1] + v[2] * v[2] <= MAX_SAVED_SPEED * MAX_SAVED_SPEED;
    }
    return Math.abs(v[0]) <= MAX_WORLD_XZ && v[1] >= MIN_SAVED_Y && v[1] <= MAX_SAVED_Y &&
      Math.abs(v[2]) <= MAX_WORLD_XZ;
  }

  // 验证并转成唯一的内部存档形式；任一关键字段非法即丢弃整条，绝不猜测或补造物品。
  function normalizeSavedDrop(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var id = raw.id, n = raw.n;
    if (!integer(id) || id <= 0 || !Voxel.Blocks.defs[id] || !integer(n) || n <= 0) return null;
    var def = Voxel.Blocks.defs[id];
    var maxStack = (def && def.maxStack) || 64;
    if (n > maxStack) return null;

    var maxDur = Voxel.Blocks.maxDur(id);
    var dur = null;
    if (maxDur) {
      // 工具不可堆叠，耐久必须是真实的 1..maxDur 整数。
      if (n !== 1 || !integer(raw.dur) || raw.dur <= 0 || raw.dur > maxDur) return null;
      dur = raw.dur;
    } else if (raw.dur !== undefined && raw.dur !== null) {
      return null;
    }

    if (!validVec3(raw.pos, false) || !validVec3(raw.vel, true) ||
      !finiteNumber(raw.age) || raw.age < 0 || raw.age >= DESPAWN) return null;
    return {
      id: id,
      n: n,
      dur: dur,
      pos: [raw.pos[0], raw.pos[1], raw.pos[2]],
      vel: [raw.vel[0], raw.vel[1], raw.vel[2]],
      age: raw.age
    };
  }

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
    if (group && list[i].mesh) group.remove(list[i].mesh);
    list.splice(i, 1);
  }

  function update(dt, options) {
    options = options && typeof options === 'object' ? options : {};
    var allowPickup = options.allowPickup !== false;
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
      if (allowPickup && alive && m.age > 0.5) {
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

      // 掉入世界底部 / 超时消失。行星 X/Z 无边界，不再因穿过旧 256×256 边界删除。
      if (m.pos.y < -8 || m.age > DESPAWN) {
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

  // 只序列化可重建的逻辑数据；Mesh/ent/onGround/dead 都是运行时状态。
  // 年龄越小剩余寿命越长；超限时优先保留较新的有效实体。
  function snapshot() {
    var candidates = [];
    var checked = 0;
    for (var i = list.length - 1; i >= 0 && checked < MAX_RESTORE_SCAN; i--, checked++) {
      var m = list[i];
      if (!m || m.dead || !m.pos || !m.ent || !m.ent.vel) continue;
      var normalized = normalizeSavedDrop({
        id: m.id,
        n: m.n,
        dur: m.dur,
        pos: [m.pos.x, m.pos.y, m.pos.z],
        vel: [m.ent.vel.x, m.ent.vel.y, m.ent.vel.z],
        age: m.age
      });
      if (normalized) candidates.push({ value: normalized, order: i });
    }
    candidates.sort(function (a, b) {
      return a.value.age === b.value.age ? a.order - b.order : a.value.age - b.value.age;
    });
    if (candidates.length > MAX_SAVED_DROPS) candidates.length = MAX_SAVED_DROPS;
    var out = [];
    for (var c = 0; c < candidates.length; c++) out.push(candidates[c].value);
    return out;
  }

  // 用存档完整替换当前世界的掉落物。返回实际恢复数，便于调试/验收。
  function restore(raw) {
    clear();
    if (!Array.isArray(raw) || !group) return 0;
    var valid = [];
    var scan = Math.min(raw.length, MAX_RESTORE_SCAN);
    for (var i = 0; i < scan; i++) {
      var normalized = normalizeSavedDrop(raw[i]);
      if (normalized) valid.push({ value: normalized, order: i });
    }
    valid.sort(function (a, b) {
      return a.value.age === b.value.age ? a.order - b.order : a.value.age - b.value.age;
    });
    if (valid.length > MAX_SAVED_DROPS) valid.length = MAX_SAVED_DROPS;

    var restored = 0;
    for (var v = 0; v < valid.length; v++) {
      var e = valid[v].value;
      var m = spawn(e.id, e.n,
        new THREE.Vector3(e.pos[0], e.pos[1], e.pos[2]),
        new THREE.Vector3(e.vel[0], e.vel[1], e.vel[2]), e.dur);
      if (!m) continue;
      m.age = e.age;
      restored++;
    }
    return restored;
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
    snapshot: snapshot,
    restore: restore,
    clear: clear,
    applyTint: applyTint,
    list: list,
    MAX_SAVED: MAX_SAVED_DROPS,
    DESPAWN: DESPAWN,
    count: function () { return list.length; }
  };
})();
