// 世界：数据、地形生成、区块网格重建管理
window.Voxel = window.Voxel || {};

Voxel.World = (function () {
  var CFG = Voxel.Config;
  var W = CFG.WORLD_W, H = CFG.WORLD_H, D = CFG.WORLD_D, CS = CFG.CHUNK;
  var WATER = CFG.WATER_LEVEL;
  var SNOW_LEVEL = CFG.SNOW_LEVEL;

  var data, seed, noise, heights;
  var edits = {};        // "x,y,z" -> id（存档用）
  var dirty = {};        // "cx,cz" -> true
  var dirtyQueue = [];
  var chunks = {};       // "cx,cz" -> {mesh, wmesh}
  var meshGroup = null;  // THREE.Group
  var genOrder = [], genCount = 0, genPhase = 1;

  function idx(x, y, z) { return x + W * (y + H * z); }

  function heightAt(x, z) {
    var c = noise.fbm2(x * 0.0045, z * 0.0045, 3);
    var d = noise.fbm2b(x * 0.021 + 57.3, z * 0.021 + 91.7, 3);
    var h = Math.floor(15 + c * 32 + d * 11);
    if (h < 4) h = 4;
    if (h > H - 8) h = H - 8;
    return h;
  }

  function generateColumn(x, z) {
    var h = heightAt(x, z);
    heights[x + W * z] = h;
    var beach = h <= WATER + 2;
    var snowy = h >= SNOW_LEVEL;
    var i;
    for (var y = 0; y < H; y++) {
      i = idx(x, y, z);
      if (y === 0) data[i] = 12;                                   // 基岩
      else if (y <= h) {
        if (y === h) data[i] = beach ? 6 : (snowy ? 18 : (h >= 46 ? 3 : 1));      // 表层
        else if (y >= h - 3) data[i] = beach ? 6 : 2;              // 泥土/沙
        else {
          data[i] = 3;
          var r = noise.hash3(x, y, z);
          if (y < 50 && r < 0.007) data[i] = 8;                    // 煤
          else if (y < 34 && r > 0.994) data[i] = 9;               // 铁
        }
      } else if (y <= WATER) data[i] = 7;                          // 水
      else data[i] = 0;
    }
    // 洞穴
    for (var y2 = 1; y2 < h - 1; y2++) {
      if (noise.n3(x * 0.075, y2 * 0.09, z * 0.075) > 0.72) {
        i = idx(x, y2, z);
        if (data[i] !== 12) data[i] = (y2 <= WATER ? 7 : 0);
      }
    }
  }

  function placeTrees() {
    for (var x = 2; x < W - 2; x++)
      for (var z = 2; z < D - 2; z++) {
        var h = heights[x + W * z];
        if (data[idx(x, h, z)] !== 1) continue;
        if (h <= WATER + 1 || h >= 44) continue;
        var r = noise.hash2(x * 3 + 11, z * 5 + 29);
        if (r < 0.997) continue;
        var th = 4 + ((r * 100000) | 0) % 3;
        for (var y = 1; y <= th; y++) data[idx(x, h + y, z)] = 4;
        for (var ly = th - 2; ly <= th + 1; ly++) {
          var rad = ly === th + 1 ? 1 : 2;
          for (var dx = -rad; dx <= rad; dx++)
            for (var dz = -rad; dz <= rad; dz++) {
              if (dx === 0 && dz === 0 && ly <= th) continue;
              if (rad === 2 && ly >= th && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
              var i = idx(x + dx, h + ly, z + dz);
              if (data[i] === 0) data[i] = 5;
            }
        }
        var it = idx(x, h + th + 2, z);
        if (it < data.length && data[it] === 0) data[it] = 5;
      }
  }

  function markDirty(x, z) {
    if (x < 0 || z < 0 || x >= W || z >= D) return;
    markChunkDirty(x / CS | 0, z / CS | 0);
  }

  function markChunkDirty(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= W / CS || cz >= D / CS) return;
    var key = cx + ',' + cz;
    if (!dirty[key]) { dirty[key] = true; dirtyQueue.push(key); }
  }

  function get(x, y, z) {
    if (y < 0) return 12;
    if (y >= H) return 0;
    if (x < 0 || x >= W || z < 0 || z >= D) return 12;
    return data[idx(x, y, z)];
  }

  function set(x, y, z, id) {
    if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= D) return;
    data[idx(x, y, z)] = id;
    edits[x + ',' + y + ',' + z] = id;
    markDirty(x, z);
    if (x % CS === 0) markDirty(x - 1, z);
    if (x % CS === CS - 1) markDirty(x + 1, z);
    if (z % CS === 0) markDirty(x, z - 1);
    if (z % CS === CS - 1) markDirty(x, z + 1);
  }

  function generateChunkData(cx, cz) {
    for (var lx = 0; lx < CS; lx++)
      for (var lz = 0; lz < CS; lz++)
        generateColumn(cx * CS + lx, cz * CS + lz);
    markChunkDirty(cx, cz);
  }

  function init(s) {
    seed = s >>> 0;
    noise = Voxel.Noise.create(seed);
    data = new Uint8Array(W * H * D);
    heights = new Int16Array(W * D);
    edits = {};
    dirty = {};
    dirtyQueue = [];
    chunks = {};
    genCount = 0;
    genPhase = 1;
    genOrder = [];
    var nCx = W / CS, nCz = D / CS;
    var ccx = (nCx - 1) / 2, ccz = (nCz - 1) / 2;
    for (var cx = 0; cx < nCx; cx++)
      for (var cz = 0; cz < nCz; cz++)
        genOrder.push([cx, cz, (cx - ccx) * (cx - ccx) + (cz - ccz) * (cz - ccz)]);
    genOrder.sort(function (a, b) { return a[2] - b[2]; });
  }

  function generateNext(n) {
    while (n-- > 0 && genPhase > 0 && genCount < genOrder.length) {
      var c = genOrder[genCount++];
      generateChunkData(c[0], c[1]);
    }
    if (genPhase === 1 && genCount >= genOrder.length) {
      genPhase = 2;
      placeTrees();
      genPhase = 0;
    }
  }

  function progress() {
    if (genPhase === 0) return 1;
    return genCount / genOrder.length;
  }

  function isReady() { return genPhase === 0; }

  function centerMeshed() {
    var n = W / CS, c = (n / 2) | 0;
    for (var dx = -1; dx <= 1; dx++)
      for (var dz = -1; dz <= 1; dz++) {
        var cx = c + dx, cz = c + dz;
        if (cx < 0 || cz < 0 || cx >= n || cz >= n) continue;
        if (!chunks[cx + ',' + cz]) return false;
      }
    return true;
  }

  // 建网格焦点（优先构建焦点周围的区块）
  var focus = { x: W / 2, z: D / 2 };
  function setFocus(x, z) {
    if (isFinite(x)) focus.x = x;
    if (isFinite(z)) focus.z = z;
  }
  function focusDist(cx, cz) {
    var dx = cx * CS + CS / 2 - focus.x;
    var dz = cz * CS + CS / 2 - focus.z;
    return dx * dx + dz * dz;
  }
  function focusMeshed() {
    var n = W / CS;
    var c = (focus.x / CS) | 0, r = (focus.z / CS) | 0;
    if (c < 0 || c >= n || r < 0 || r >= n) return true;
    for (var dx = -1; dx <= 1; dx++)
      for (var dz = -1; dz <= 1; dz++) {
        var cx = c + dx, cz = r + dz;
        if (cx < 0 || cz < 0 || cx >= n || cz >= n) continue;
        if (!chunks[cx + ',' + cz]) return false;
      }
    return true;
  }

  function surfaceAt(x, z) {
    if (x < 0 || x >= W || z < 0 || z >= D) return -1;
    for (var y = H - 1; y >= 0; y--)
      if (Voxel.Blocks.isSolid(get(x, y, z))) return y;
    return -1;
  }

  function spawnPoint() {
    var x = W >> 1, z = D >> 1;
    var y = surfaceAt(x, z);
    if (y < 1) y = H - 2;
    return new THREE.Vector3(x + 0.5, y + 1.01, z + 0.5);
  }

  function applyEdits(ed) {
    if (!ed) return;
    for (var k in ed) {
      var p = k.split(',');
      var x = +p[0], y = +p[1], z = +p[2];
      if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D) {
        data[idx(x, y, z)] = ed[k];
        markDirty(x, z);
      }
    }
  }

  function buildMeshes(n, scene) {
    if (!meshGroup) meshGroup = new THREE.Group();
    if (meshGroup.parent !== scene) scene.add(meshGroup);
    var built = 0;
    while (dirtyQueue.length && built < n) {
      // 优先构建离焦点最近的区块
      var bi = 0, bd = Infinity;
      for (var i = 0; i < dirtyQueue.length; i++) {
        var qp = dirtyQueue[i].split(',');
        var qd = focusDist(+qp[0], +qp[1]);
        if (qd < bd) { bd = qd; bi = i; }
      }
      var key = dirtyQueue.splice(bi, 1)[0];
      delete dirty[key];
      var parts = key.split(',');
      var cx = +parts[0], cz = +parts[1];
      var old = chunks[key];
      if (old) {
        if (old.mesh) { meshGroup.remove(old.mesh); old.mesh.geometry.dispose(); }
        if (old.wmesh) { meshGroup.remove(old.wmesh); old.wmesh.geometry.dispose(); }
      }
      var res = Voxel.MeshBuilder.build(cx, cz);
      var ch = {};
      if (res.opaque) {
        ch.mesh = new THREE.Mesh(res.opaque, Voxel.MeshBuilder.opaqueMat());
        meshGroup.add(ch.mesh);
      }
      if (res.water) {
        ch.wmesh = new THREE.Mesh(res.water, Voxel.MeshBuilder.waterMat());
        ch.wmesh.renderOrder = 2;
        meshGroup.add(ch.wmesh);
      }
      chunks[key] = ch;
      built++;
    }
  }

  function clearMeshes(scene) {
    if (meshGroup && meshGroup.parent === scene) {
      var i;
      for (i = meshGroup.children.length - 1; i >= 0; i--) {
        var m = meshGroup.children[i];
        if (m.geometry) m.geometry.dispose();
      }
      scene.remove(meshGroup);
    }
    meshGroup = null;
    chunks = {};
  }

  return {
    init: init,
    generateNext: generateNext,
    progress: progress,
    isReady: isReady,
    centerMeshed: centerMeshed,
    setFocus: setFocus,
    focusMeshed: focusMeshed,
    meshCount: function () { return meshGroup ? meshGroup.children.length : 0; },
    buildMeshes: buildMeshes,
    clearMeshes: clearMeshes,
    get: get,
    set: set,
    surfaceAt: surfaceAt,
    spawnPoint: spawnPoint,
    applyEdits: applyEdits,
    getEdits: function () { return edits; },
    getSeed: function () { return seed; },
    size: function () { return { w: W, h: H, d: D }; }
  };
})();
