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

  // ---- 光照：skyL 天光 / blkL 块光（火把），0-15 ----
  var skyL = null, blkL = null, lightReady = false;
  var LIGHT_RANGE = 15;  // 光最大传播距离（衰减 1/格）

  function opq(id) { return Voxel.Blocks.isOpaque(id); }

  // 进入该格子的光衰减代价（不透明=阻断；水衰减更快）
  function lightCost(id) {
    if (id === 7) return 2;
    return opq(id) ? -1 : 1;
  }

  // 单通道泛光填充：queues[l] 存待处理下标（arr[idx]==l）
  function bfsFill(arr, queues, x0, x1, z0, z1) {
    for (var l = 15; l >= 1; l--) {
      var q = queues[l];
      if (!q) continue;
      for (var qi = 0; qi < q.length; qi++) {
        var i = q[qi];
        if (arr[i] !== l) continue;
        // idx(x,y,z)=x+W*y+W*H*z：z 步长 W*H，y 步长 W
        var z = (i / (W * H)) | 0;
        var rem = i - z * W * H;
        var y = (rem / W) | 0;
        var x = rem - y * W;
        var nl = l - 1;
        if (nl <= 0) continue;
        // 六邻域
        spread(arr, queues, x + 1, y, z, nl, x0, x1, z0, z1);
        spread(arr, queues, x - 1, y, z, nl, x0, x1, z0, z1);
        spread(arr, queues, x, y + 1, z, nl, x0, x1, z0, z1);
        spread(arr, queues, x, y - 1, z, nl, x0, x1, z0, z1);
        spread(arr, queues, x, y, z + 1, nl, x0, x1, z0, z1);
        spread(arr, queues, x, y, z - 1, nl, x0, x1, z0, z1);
      }
    }
  }

  function spread(arr, queues, x, y, z, nl, x0, x1, z0, z1) {
    if (x < x0 || x > x1 || z < z0 || z > z1 || y < 0 || y >= H) return;
    var cost = lightCost(data[idx(x, y, z)]);
    if (cost < 0) return;
    var v = nl - (cost - 1);
    if (v <= 0) return;
    var i = idx(x, y, z);
    if (arr[i] >= v) return;
    arr[i] = v;
    if (!queues[v]) queues[v] = [];
    queues[v].push(i);
  }

  // 区域内重算光照（全高）。全图初始化时传整个世界。
  function relightRegion(rx0, rx1, rz0, rz1) {
    rx0 = Math.max(0, rx0); rx1 = Math.min(W - 1, rx1);
    rz0 = Math.max(0, rz0); rz1 = Math.min(D - 1, rz1);
    var skyQ = [], blkQ = [];

    // 清空区域（idx(x,y,z)=x+W*y+W*H*z：固定 x,z 后 y 步长为 W）
    for (var x = rx0; x <= rx1; x++)
      for (var z = rz0; z <= rz1; z++) {
        var base = idx(x, 0, z);
        for (var y = 0; y < H; y++) {
          var i = base + y * W;
          skyL[i] = 0;
          blkL[i] = 0;
        }
      }

    // 天光：列扫描自顶向下
    for (var x2 = rx0; x2 <= rx1; x2++)
      for (var z2 = rz0; z2 <= rz1; z2++) {
        var l = 15;
        for (var y2 = H - 1; y2 >= 0; y2--) {
          var id = data[idx(x2, y2, z2)];
          if (opq(id)) l = 0;
          else if (id === 7 && l > 0) l = Math.max(0, l - 2);
          skyL[idx(x2, y2, z2)] = l;
        }
      }
    // 天光种子：区域内所有"还能向外传播光"的亮格
    // （直接照亮由列扫描写入；此处只挑出邻居更暗的可传播格，避免塞入全部亮格）
    seedSky(skyQ, rx0, rx1, rz0, rz1);

    // 块光种子：区域内火把 + 边界导入
    for (var x3 = rx0; x3 <= rx1; x3++)
      for (var z3 = rz0; z3 <= rz1; z3++)
        for (var y3 = 0; y3 < H; y3++) {
          var i3 = idx(x3, y3, z3);
          if (data[i3] === 19 && Voxel.Blocks.defs[19].light) {
            blkL[i3] = Voxel.Blocks.defs[19].light;
            blkQ.push(i3);
          }
        }
    seedBlk(blkQ, rx0, rx1, rz0, rz1);

    bfsFill(skyL, bucket(skyQ, skyL), rx0, rx1, rz0, rz1);
    bfsFill(blkL, bucket(blkQ, blkL), rx0, rx1, rz0, rz1);
  }

  // 把种子数组转成按亮度分桶的结构
  function bucket(seeds, arr) {
    var q = [];
    for (var i = 0; i < seeds.length; i++) {
      var l = arr[seeds[i]];
      if (l > 0) { if (!q[l]) q[l] = []; q[l].push(seeds[i]); }
    }
    return q;
  }

  function pushSeed(q, arr, x, y, z) {
    if (y < 0 || y >= H) return;
    var i = idx(x, y, z);
    if (arr[i] > 1) q.push(i);
  }

  // 挑出区域内所有可传播的天光亮格：自身 skyL>1 且存在更暗的可通行邻居
  function seedSky(q, rx0, rx1, rz0, rz1) {
    for (var x = rx0; x <= rx1; x++)
      for (var z = rz0; z <= rz1; z++)
        for (var y = 0; y < H; y++) {
          var i = idx(x, y, z);
          var v = skyL[i];
          if (v <= 1) continue;
          if (canSpread(skyL, x, y, z, v, rx0, rx1, rz0, rz1)) q.push(i);
        }
    // 区域外边界一格的光照导入
    importBorder(q, skyL, rx0, rx1, rz0, rz1);
  }

  function canSpread(arr, x, y, z, v, x0, x1, z0, z1) {
    return darkerNeighbor(arr, x + 1, y, z, v, x0, x1, z0, z1) ||
      darkerNeighbor(arr, x - 1, y, z, v, x0, x1, z0, z1) ||
      darkerNeighbor(arr, x, y + 1, z, v, x0, x1, z0, z1) ||
      darkerNeighbor(arr, x, y - 1, z, v, x0, x1, z0, z1) ||
      darkerNeighbor(arr, x, y, z + 1, v, x0, x1, z0, z1) ||
      darkerNeighbor(arr, x, y, z - 1, v, x0, x1, z0, z1);
  }

  function darkerNeighbor(arr, x, y, z, v, x0, x1, z0, z1) {
    if (x < x0 || x > x1 || z < z0 || z > z1 || y < 0 || y >= H) return false;
    if (lightCost(data[idx(x, y, z)]) < 0) return false;
    return arr[idx(x, y, z)] < v - 1;
  }

  function seedBlk(q, rx0, rx1, rz0, rz1) {
    importBorder(q, blkL, rx0, rx1, rz0, rz1);
  }

  function importBorder(q, arr, rx0, rx1, rz0, rz1) {
    if (rx0 === 0 && rx1 === W - 1 && rz0 === 0 && rz1 === D - 1) return;
    for (var x = rx0 - 1; x <= rx1 + 1; x++) {
      if (x < 0 || x >= W) continue;
      for (var zz = rx0 - 1; zz <= rz1 + 1; zz++) {
        if (zz < 0 || zz >= D) continue;
        if (x >= rx0 && x <= rx1 && zz >= rz0 && zz <= rz1) continue;
        for (var y = 0; y < H; y++) {
          var i = idx(x, y, zz);
          if (arr[i] > 1) q.push(i);
        }
      }
    }
  }

  function initLight() {
    if (!skyL) { skyL = new Uint8Array(W * H * D); blkL = new Uint8Array(W * H * D); }
    lightReady = true;
    relightRegion(0, W - 1, 0, D - 1);
  }

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
    if (lightReady) {
      var R = LIGHT_RANGE;
      relightRegion(x - R, x + R, z - R, z + R);
      // 光照影响可达 15格外：把重算区域内所有区块都标脏
      for (var cx = (x - R) / CS | 0; cx <= (x + R) / CS | 0; cx++)
        for (var cz = (z - R) / CS | 0; cz <= (z + R) / CS | 0; cz++)
          markChunkDirty(cx, cz);
    } else {
      markDirty(x, z);
    }
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
    lightReady = false;
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
    var bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity, any = false;
    for (var k in ed) {
      var p = k.split(',');
      var x = +p[0], y = +p[1], z = +p[2];
      if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D) {
        data[idx(x, y, z)] = ed[k];
        any = true;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (z < bz0) bz0 = z;
        if (z > bz1) bz1 = z;
      }
    }
    if (!any) return;
    if (lightReady) {
      var R = LIGHT_RANGE;
      relightRegion(bx0 - R, bx1 + R, bz0 - R, bz1 + R);
      for (var cx = Math.max(0, (bx0 - R) / CS | 0); cx <= Math.min(W / CS - 1, (bx1 + R) / CS | 0); cx++)
        for (var cz = Math.max(0, (bz0 - R) / CS | 0); cz <= Math.min(D / CS - 1, (bz1 + R) / CS | 0); cz++)
          markChunkDirty(cx, cz);
    } else {
      for (var k2 in ed) {
        var p2 = k2.split(',');
        markDirty(+p2[0], +p2[2]);
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
    // 光照接口
    initLight: initLight,
    lightReady: function () { return lightReady; },
    getSky: function (x, y, z) {
      if (y >= H) return 15;
      if (y < 0) return 0;
      if (!lightReady || x < 0 || x >= W || z < 0 || z >= D) return 15;
      return skyL[idx(x, y, z)];
    },
    getBlk: function (x, y, z) {
      if (!lightReady || y < 0 || y >= H || x < 0 || x >= W || z < 0 || z >= D) return 0;
      return blkL[idx(x, y, z)];
    },
    getEdits: function () { return edits; },
    getSeed: function () { return seed; },
    size: function () { return { w: W, h: H, d: D }; }
  };
})();
