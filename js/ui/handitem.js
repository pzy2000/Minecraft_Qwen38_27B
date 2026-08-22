// 第一人称手持方块/物品：挂在相机右下，带挥动与走路摆动
window.Voxel = window.Voxel || {};

Voxel.HandItem = (function () {
  var group = null, mesh = null, curId = -1;
  var swingT = 0;      // 挥动倒计时
  var bobT = 0;        // 走路摆动相位
  var matBlock = null, matItem = null;
  var BX = 0.46, BY = -0.42, BZ = -0.72;

  function tileUV(t, u, v) { // u,v ∈ {0,1}
    var c = t % 16, r = (t / 16) | 0;
    return [(c * 16 + 0.5 + u * 15) / 256, 1 - (r * 16 + 0.5 + (1 - v) * 15) / 256];
  }

  function buildCube(id) {
    var geo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
    // BoxGeometry 面序：+x,-x,+y,-y,+z,-z；每面 4 顶点 uv：(0,1)(1,1)(0,0)(1,0)
    var uv = geo.attributes.uv;
    var cornerV = [[0, 1], [1, 1], [0, 0], [1, 0]];
    for (var f = 0; f < 6; f++) {
      var t = Voxel.Blocks.tileForFace(id, f);
      for (var k = 0; k < 4; k++) {
        var m = tileUV(t, cornerV[k][0], cornerV[k][1]);
        uv.setXY(f * 4 + k, m[0], m[1]);
      }
    }
    uv.needsUpdate = true;
    geo.rotateY(0.6);
    geo.rotateX(0.15);
    return new THREE.Mesh(geo, matBlock);
  }

  function buildPlane(id) {
    var t = Voxel.Blocks.iconTile(id);
    if (t < 0) t = Voxel.Blocks.T.STICK;
    var geo = new THREE.PlaneGeometry(0.5, 0.5);
    var uv = geo.attributes.uv;
    var cornerV = [[0, 1], [1, 1], [0, 0], [1, 0]];
    for (var k = 0; k < 4; k++) {
      var m = tileUV(t, cornerV[k][0], cornerV[k][1]);
      uv.setXY(k, m[0], m[1]);
    }
    uv.needsUpdate = true;
    geo.rotateZ(-0.7);
    return new THREE.Mesh(geo, matItem);
  }

  function init(camera) {
    group = new THREE.Group();
    matBlock = new THREE.MeshBasicMaterial({ map: Voxel.Blocks.getTexture() });
    matItem = new THREE.MeshBasicMaterial({
      map: Voxel.Blocks.getTexture(), transparent: true,
      alphaTest: 0.5, side: THREE.DoubleSide
    });
    group.position.set(BX, BY, BZ);
    camera.add(group);
  }

  function setId(id) {
    id = id || 0;
    if (!group) return;
    if (id === curId) return;
    curId = id;
    if (mesh) { group.remove(mesh); mesh.geometry.dispose(); mesh = null; }
    if (!id) { group.visible = false; return; }
    var def = Voxel.Blocks.defs[id];
    mesh = (def && def.item) ? buildPlane(id) : buildCube(id);
    group.add(mesh);
    group.visible = true;
  }

  function swing() { swingT = 0.28; }

  // moving: 是否在走（用于走路摆动）
  function update(dt, moving) {
    if (!group) return;
    if (swingT > 0) {
      swingT -= dt;
      var k = Math.sin((1 - Math.max(0, swingT) / 0.28) * Math.PI);
      group.rotation.x = -k * 0.9;
      group.position.y = BY - k * 0.16;
      group.position.z = BZ - k * 0.1;
    } else {
      group.rotation.x = 0;
      group.rotation.z = 0;
      if (moving) bobT += dt * 7.5;
      var bob = Math.sin(bobT) * 0.02;
      group.position.set(BX, BY + bob, BZ);
    }
  }

  function applyTint(t) {
    if (matBlock) matBlock.color.copy(t);
    if (matItem) matItem.color.copy(t);
  }

  return {
    init: init,
    setId: setId,
    swing: swing,
    update: update,
    applyTint: applyTint
  };
})();
