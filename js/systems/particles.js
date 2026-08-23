// 方块破碎粒子
window.Voxel = window.Voxel || {};

Voxel.Particles = (function () {
  var items = [];
  var cache = {};
  var geo = null;

  function init() {
    geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  }

  function mat(color) {
    if (!cache[color]) {
      var base = new THREE.Color(color);
      cache[color] = { base: base, mat: new THREE.MeshBasicMaterial({ color: base.clone() }) };
    }
    return cache[color].mat;
  }

  function burst(pos, color, n) {
    var scene = Voxel.Game.scene;
    // 粒子密度（设置项）：按倍率缩减本次生成数，至少 1 个
    var dens = (Voxel.Settings && Voxel.Settings.get('particleDensity')) || 1;
    var total = Math.max(1, Math.round((n || 8) * Math.max(0.1, Math.min(1, dens))));
    for (var i = 0; i < total; i++) {
      var m = new THREE.Mesh(geo, mat(color));
      m.position.set(
        pos.x + (Math.random() - 0.5) * 0.7,
        pos.y + (Math.random() - 0.5) * 0.7,
        pos.z + (Math.random() - 0.5) * 0.7
      );
      scene.add(m);
      items.push({
        m: m,
        vx: (Math.random() - 0.5) * 4.2,
        vy: Math.random() * 4 + 1.5,
        vz: (Math.random() - 0.5) * 4.2,
        life: 0.45 + Math.random() * 0.3,
        max: 0.75
      });
    }
  }

  function update(dt) {
    var scene = Voxel.Game.scene;
    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i];
      it.life -= dt;
      if (it.life <= 0) {
        scene.remove(it.m);
        items.splice(i, 1);
        continue;
      }
      it.vy -= 18 * dt;
      it.m.position.x += it.vx * dt;
      it.m.position.y += it.vy * dt;
      it.m.position.z += it.vz * dt;
      var s = Math.max(0.05, it.life / it.max);
      it.m.scale.set(s, s, s);
    }
  }

  function applyTint(t) {
    for (var k in cache) cache[k].mat.color.copy(cache[k].base).multiply(t);
  }

  function clear() {
    var scene = Voxel.Game.scene;
    for (var i = items.length - 1; i >= 0; i--) {
      scene.remove(items[i].m);
      items.splice(i, 1);
    }
  }

  return { init: init, burst: burst, update: update, applyTint: applyTint, clear: clear };
})();
