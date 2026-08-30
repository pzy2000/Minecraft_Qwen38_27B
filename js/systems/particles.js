// 方块破碎粒子：InstancedMesh 单绘制调用实例池。
// 每个 slot 绑定一条 {pos,vel,life} 数据；死亡的实例写零缩放矩阵隐藏，
// burst 复用死槽，不再逐粒 new Mesh/remove（原实现每次破碎 8-14 次
// drawcall + GC，僵尸群战时是肉眼可见的尖峰）。
window.Voxel = window.Voxel || {};

Voxel.Particles = (function () {
  var MAX = 512;
  var mesh = null, geo = null, dummy = null;
  var slots = [], free = [];
  var colors = [];        // 每 slot 的基色（含明度抖动），tint 时重算
  var spawnDirty = false, colorDirty = false;
  var tint = new THREE.Color(1, 1, 1);

  function ensureMesh() {
    if (mesh) return true;
    var scene = Voxel.Game && Voxel.Game.scene;
    if (!scene || !THREE.InstancedMesh) return false;
    geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    dummy = new THREE.Object3D();
    var mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    mesh = new THREE.InstancedMesh(geo, mat, MAX);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;   // 粒子散布在玩家周围，整包剔除会整体消失
    var white = new THREE.Color(1, 1, 1);
    for (var i = 0; i < MAX; i++) {
      slots[i] = null;
      free.push(i);
      colors[i] = white.clone();
      writeMatrix(i, 0);
      mesh.setColorAt(i, colors[i]);
    }
    mesh.count = 0;
    scene.add(mesh);
    return true;
  }

  function writeMatrix(i, s) {
    if (s > 0) {
      var it = slots[i];
      dummy.position.set(it.x, it.y, it.z);
      dummy.rotation.set(it.rx, it.ry, it.rz);
      dummy.scale.set(s, s, s);
    } else {
      dummy.position.set(0, -9999, 0);
      dummy.scale.set(0, 0, 0);
    }
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }

  function matColor(color) {
    var c = new THREE.Color(color);
    c.r *= 0.85 + Math.random() * 0.15;
    c.g *= 0.85 + Math.random() * 0.15;
    c.b *= 0.85 + Math.random() * 0.15;
    return c;
  }

  function burst(pos, color, n) {
    if (!ensureMesh()) return;
    // 粒子密度（设置项）：按倍率缩减本次生成数，至少 1 个
    var dens = (Voxel.Settings && Voxel.Settings.get('particleDensity')) || 1;
    var total = Math.max(1, Math.round((n || 8) * Math.max(0.1, Math.min(1, dens))));
    for (var k = 0; k < total; k++) {
      if (!free.length) break;   // 池满丢新粒，最旧的还在演完，视觉上无损
      var i = free.pop();
      var life = 0.45 + Math.random() * 0.3;
      slots[i] = {
        x: pos.x + (Math.random() - 0.5) * 0.7,
        y: pos.y + (Math.random() - 0.5) * 0.7,
        z: pos.z + (Math.random() - 0.5) * 0.7,
        vx: (Math.random() - 0.5) * 4.2,
        vy: Math.random() * 4 + 1.5,
        vz: (Math.random() - 0.5) * 4.2,
        rx: Math.random() * Math.PI,
        ry: Math.random() * Math.PI,
        rz: Math.random() * Math.PI,
        life: life,
        max: 0.75
      };
      colors[i] = matColor(color);
      mesh.setColorAt(i, _tinted(i));
      writeMatrix(i, life / 0.75);
    }
    spawnDirty = true;
    colorDirty = true;
  }

  function update(dt) {
    if (!mesh) return;
    var maxLive = -1;
    for (var i = 0; i < MAX; i++) {
      var it = slots[i];
      if (!it) continue;
      it.life -= dt;
      if (it.life <= 0) {
        slots[i] = null;
        free.push(i);
        writeMatrix(i, 0);
        spawnDirty = true;
        continue;
      }
      it.vy -= 18 * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.z += it.vz * dt;
      writeMatrix(i, Math.max(0.05, it.life / it.max));
      if (i > maxLive) maxLive = i;
    }
    if (spawnDirty) {
      mesh.instanceMatrix.needsUpdate = true;
      // count 取最高存活槽位 +1，未用到的尾部不进顶点循环
      mesh.count = maxLive + 1;
      if (maxLive < 0) mesh.count = 0;
      spawnDirty = false;
    }
    if (colorDirty) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      colorDirty = false;
    }
  }

  function applyTint(t) {
    if (!mesh) { tint.copy(t); return; }
    tint.copy(t);
    for (var i = 0; i < MAX; i++) {
      if (!slots[i]) continue;
      mesh.setColorAt(i, _tinted(i));
    }
    colorDirty = true;
  }

  var _tmpColor = new THREE.Color();
  function _tinted(i) {
    return _tmpColor.copy(colors[i]).multiply(tint);
  }

  function clear() {
    if (!mesh) return;
    for (var i = 0; i < MAX; i++) {
      if (!slots[i]) continue;
      slots[i] = null;
      free.push(i);
      writeMatrix(i, 0);
    }
    free.sort(function (a, b) { return b - a; });   // 升序出栈：低位槽先用，count 尽快收缩
    mesh.count = 0;
    spawnDirty = false;
  }

  return { init: function () {}, burst: burst, update: update, applyTint: applyTint, clear: clear };
})();
