// 行星无限 X/Z facade：保留 256×64×256 legacy core，核心外按区块稀疏生成与流式卸载。
//
// 设计约束：
// 1. 旧存档只保存 edits、没有保存自然地形，因此 0..255 核心必须继续由旧 World 原样生成；
// 2. 空间站的外围本来就是真空，不套用行星的无限地表；
// 3. 核心外的自然地形只由 (seed, profile, 全局坐标) 决定，区块加载顺序不影响结果；
// 4. 未加载区块暂按不可穿越方块读取，生成队列会在玩家抵达前铺好 data halo，避免再掉进虚空。
window.Voxel = window.Voxel || {};

(function () {
  'use strict';

  var FiniteWorld = Voxel.World;
  if (!FiniteWorld || FiniteWorld.__infiniteFacade) return;

  var CFG = Voxel.Config;
  var W = CFG.WORLD_W, H = CFG.WORLD_H, D = CFG.WORLD_D, CS = CFG.CHUNK;
  var WATER = CFG.WATER_LEVEL, SNOW_LEVEL = CFG.SNOW_LEVEL;
  var CORE_CX = W / CS, CORE_CZ = D / CS;
  // 自然与结构内容封顶；玩家建造经 setInChunk 抬升。与 world.js FiniteWorld colTop 同一契约。
  var NATURAL_TOP = Math.min(H - 1, CFG.CONTENT_NATURAL_TOP || H - 1);
  var BASE_RENDER_RADIUS = Math.max(2, (CFG.STREAM_RENDER_RADIUS || 6) | 0);
  var RENDER_RADIUS = BASE_RENDER_RADIUS;
  var DATA_RADIUS = Math.max(RENDER_RADIUS + 1, (CFG.STREAM_DATA_RADIUS || (RENDER_RADIUS + 1)) | 0);
  var KEEP_RADIUS = Math.max(DATA_RADIUS + 1, (CFG.STREAM_KEEP_RADIUS || (DATA_RADIUS + 2)) | 0);
  var LOD_MID_RADIUS = Math.max(DATA_RADIUS, (CFG.LOD_MID_RADIUS || 12) | 0);
  var LOD_FAR_RADIUS = Math.max(LOD_MID_RADIUS, (CFG.LOD_FAR_RADIUS || 16) | 0);

  // 远景主题（北欧峡湾的雾中礁岛群在 140+ 格外）需要更大的工作集，否则远景
  // 永远落在雾尾之外。半径是运行时可调的：切换天体/画质档位时重新下发，
  // 不改变任何生成结果——区块内容只由 (seed, profile, 全局坐标) 决定。
  function setRenderRadius(r) {
    var next = (r | 0) > 0 ? Math.max(2, Math.min(12, r | 0)) : BASE_RENDER_RADIUS;
    if (next === RENDER_RADIUS) return RENDER_RADIUS;
    RENDER_RADIUS = next;
    DATA_RADIUS = RENDER_RADIUS + 1;
    KEEP_RADIUS = DATA_RADIUS + 2;
    focus.cx = null; focus.cz = null;   // 强制下一次 setFocus 重算工作集
    return RENDER_RADIUS;
  }
  var FEATURE_RADIUS = 4;
  var BLOCK_LIGHT_RANGE = 15;

  var planetMode = true;
  var profile = null;
  var terrainVersion = 1, planetTypeKey = 'lush';
  var seed = '0';
  var gen = null;                          // Voxel.GenCore 实例（同步/Worker 共用同一实现）
  var extra = Object.create(null);       // "cx,cz" -> sparse Chunk（核心 8×8 不在此表）
  var extraEdits = Object.create(null);  // 旧格式兼容："x,y,z" -> id
  var editsByChunk = Object.create(null);
  var coreBlkOverlay = null;             // 外围火把跨入 legacy core 的附加块光
  var genQueue = [], genQueued = Object.create(null);
  var meshQueue = [], meshQueued = Object.create(null);
  // 网格 Worker 池（plan 5.4）：2–4 个无状态实例，失败整体回退同步路径。
  var MW_POOL = Math.max(1, Math.min(4, (CFG.MESH_WORKER_POOL || 3) | 0));
  var MW_MAX_INFLIGHT = MW_POOL * 3;
  var mwPool = [], mwCursor = 0, mwFailed = false, mwNextId = 1, mwInflight = 0;
  var mwPending = Object.create(null);   // jobId -> job

  function ensureMeshWorker() {
    if (mwFailed || !planetMode || typeof Worker === 'undefined') return;
    while (mwPool.length < MW_POOL) {
      try {
        var w = new Worker('js/world/mesh_worker.js?v=' +
          (Voxel.Config.MESH_WORKER_V || Voxel.Config.GEN_WORKER_V || 1));
        w.onmessage = function (e) {
          var m = e.data;
          if (!m) return;
          if (m.type === 'error') { failMeshWorker(m.message || '未知'); return; }
          if (m.type !== 'mesh') return;
          var job = mwPending[m.jobId];
          delete mwPending[m.jobId];
          if (mwInflight > 0) mwInflight--;
          finishMeshJob(job, m);
        };
        w.onerror = function () { failMeshWorker('运行异常'); };
        mwPool.push(w);
      } catch (e) {
        failMeshWorker('创建失败');
        break;
      }
    }
  }

  function pickMeshWorker() {
    if (!mwPool.length) return null;
    var w = mwPool[mwCursor % mwPool.length];
    mwCursor++;
    return w;
  }

  function failMeshWorker(why) {
    if (mwFailed && !mwPool.length) return;
    mwFailed = true;
    if (why && window.console && console.warn) console.warn('[World] 网格线程停用：' + why);
    for (var id in mwPending) if (Object.prototype.hasOwnProperty.call(mwPending, id)) {
      var job = mwPending[id];
      delete mwPending[id];
      // 已派发且未再变脏的区块重新走同步队列
      queueMesh(job.cx, job.cz);
    }
    mwPending = Object.create(null);
    mwInflight = 0;
    for (var ti = 0; ti < mwPool.length; ti++) {
      try { mwPool[ti].terminate(); } catch (e2) { }
    }
    mwPool = [];
  }

  function dispatchMeshJob(ch) {
    ensureMeshWorker();
    var worker = pickMeshWorker();
    if (!worker) return false;
    // fillPad 后立即拷贝三组 pad 快照（约 1.3MB/chunk，Transferable 移交）
    try {
      var snap = Voxel.MeshBuilder._test.snapshotPadForWorker(ch.cx, ch.cz);
      var job = { key: key(ch.cx, ch.cz), cx: ch.cx, cz: ch.cz, rev: ch.meshRev };
      snap.jobId = mwNextId++;
      mwPending[snap.jobId] = job;
      mwInflight++;
      worker.postMessage({
        type: 'build', cx: snap.cx, cz: snap.cz, yTop: snap.yTop, snap: snap,
        jobId: snap.jobId, lod: ch.lod || 0
      }, [snap.b.buffer, snap.s.buffer, snap.p.buffer]);
      return true;
    } catch (e) {
      failMeshWorker('派发失败');
      return false;
    }
  }

  // 结果落地：竞态校验（卸载 → extra 无条目；重脏 → rev 不匹配）后
  // 用与同步路径完全相同的包装/挂载逻辑装配网格。
  function finishMeshJob(job, msg) {
    if (!job || mwInflight < 0) return;
    var ch = extra[job.key];
    // 场景已拆除（clearMeshes/世界切换）或区块过期：产物作废
    if (!ch || !ch.ready || !extraGroup || ch.meshRev !== job.rev || ch.meshed) return;
    var r = packGeoFromBuffers(msg);
    applyChunkGeometry(ch, r);
  }

  // Transferable 缓冲 → BufferGeometry（零额外拷贝：缓冲已是精确尺寸）
  function geoFromGroup(gb) {
    if (!gb || !gb.pos) return null;
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gb.pos), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(gb.uv), 2));
    g.setAttribute('alocal', new THREE.BufferAttribute(new Float32Array(gb.lcl), 2));
    g.setAttribute('auvo', new THREE.BufferAttribute(new Float32Array(gb.uvo), 2));
    g.setAttribute('acolor', new THREE.BufferAttribute(new Float32Array(gb.col), 3));
    g.setAttribute('alight', new THREE.BufferAttribute(new Float32Array(gb.lgt), 2));
    g.setAttribute('anrm', new THREE.BufferAttribute(new Float32Array(gb.nrm), 3));
    g.setAttribute('aflag', new THREE.BufferAttribute(new Float32Array(gb.flg), 2));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(gb.idx), 1));
    g.computeBoundingSphere();
    return g;
  }

  function packGeoFromBuffers(msg) {
    return { opaque: geoFromGroup(msg.o), water: geoFromGroup(msg.w), foliage: geoFromGroup(msg.fl) };
  }

  // 同步/异步两条路径共用的网格装配终态
  function applyChunkGeometry(ch, res) {
    disposeChunkMesh(ch);
    if (res.opaque) {
      ch.mesh = new THREE.Mesh(res.opaque, Voxel.MeshBuilder.opaqueMat());
      extraGroup.add(ch.mesh);
    }
    if (res.water && !ch.lod) {
      ch.wmesh = new THREE.Mesh(res.water, Voxel.MeshBuilder.waterMat());
      ch.wmesh.renderOrder = 2;
      extraGroup.add(ch.wmesh);
    }
    if (res.foliage && !ch.lod) {
      ch.fmesh = new THREE.Mesh(res.foliage, Voxel.MeshBuilder.foliageMat());
      extraGroup.add(ch.fmesh);
      if (Voxel.Shadow) Voxel.Shadow.addCaster(ch.fmesh);
    }
    ch.meshed = true;
    ch.dirty = false;
  }

  var pendingRelight = [];               // 卸载/生成触发的跨区块重光，延迟到 stream() 预算内消化
  var pendingRelightSet = Object.create(null);
  var extraGroup = null, extraScene = null;
  var farGroup = null, farMeshes = Object.create(null), farQueue = [];
  var focus = { x: W / 2, z: D / 2, cx: null, cz: null };

  function perfNow() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function key(cx, cz) { return cx + ',' + cz; }
  function posKey(x, y, z) { return x + ',' + y + ',' + z; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function floorDiv(n, d) { return Math.floor(n / d); }
  function localCoord(n, d) {
    var q = floorDiv(n, d);
    return n - q * d;
  }
  function inCore(x, z) { return x >= 0 && x < W && z >= 0 && z < D; }
  function coreChunk(cx, cz) { return cx >= 0 && cx < CORE_CX && cz >= 0 && cz < CORE_CZ; }
  function chunkIndex(lx, y, lz) { return lx + CS * (y + H * lz); }
  function columnIndex(lx, lz) { return lx + CS * lz; }
  var SEC_H = (Voxel.Sections && Voxel.Sections.HEIGHT) || 16;
  function volGet(arr, lx, y, lz) {
    return Voxel.Sections ? Voxel.Sections.read(arr, lx, y, lz, CS, H) : arr[chunkIndex(lx, y, lz)];
  }
  function volSet(arr, lx, y, lz, v) {
    if (Voxel.Sections) Voxel.Sections.write(arr, lx, y, lz, v, CS, H);
    else arr[chunkIndex(lx, y, lz)] = v;
  }
  function volGetI(arr, i) {
    return arr && arr.__sections ? arr.getLinear(i) : arr[i];
  }
  function volSetI(arr, i, v) {
    if (arr && arr.__sections) arr.setLinear(i, v);
    else arr[i] = v;
  }
  function packBlocks(arr) {
    if (!Voxel.Sections || !arr || arr.__sections) return arr;
    return Voxel.Sections.fromFlat(arr, CS, H, CS);
  }
  function emptyLight() {
    return Voxel.Sections ? Voxel.Sections.create(CS, H, CS, 1) : new Uint8Array(CS * H * CS);
  }
  function coreLightIndex(x, y, z) { return x + W * (y + H * z); }
  function validXYZ(x, y, z) {
    return Number.isSafeInteger(x) && Number.isSafeInteger(y) && Number.isSafeInteger(z) &&
      y >= 0 && y < H;
  }

  function chunkAtBlock(x, z) {
    return extra[key(floorDiv(x, CS), floorDiv(z, CS))] || null;
  }

  function getFromChunk(ch, x, y, z) {
    return volGet(ch.blocks, localCoord(x, CS), y, localCoord(z, CS));
  }

  function setInChunk(ch, x, y, z, id) {
    volSet(ch.blocks, localCoord(x, CS), y, localCoord(z, CS), id);
    // 内容顶只升不降：光照快路径假设其上为纯空气（自然生成封顶以下）
    if (id !== 0 && y > ch.contentTop) ch.contentTop = Math.min(H - 1, y);
  }

  function newChunk(cx, cz) {
    return {
      cx: cx, cz: cz,
      blocks: Voxel.Sections ? Voxel.Sections.create(CS, H, CS, 2) : new Uint16Array(CS * H * CS),
      heights: new Int16Array(CS * CS),
      biomes: new Uint8Array(CS * CS),
      sky: emptyLight(),
      blk: emptyLight(),
      baseReady: false, ready: false, lit: false, dirty: true, meshed: false,
      // 自然内容封顶：含巨树树冠峰值 ~92 与余量；玩家建造经 setInChunk 抬升。
      // 与 world.js 的 FiniteWorld colTop 同一契约值。
      contentTop: NATURAL_TOP,
      emit: null,
      skyReady: false,
      shell: null, decorated: false,
      mesh: null, wmesh: null, fmesh: null,
      lod: 0
    };
  }

  // 只生成基础地形；装饰阶段可安全查询相邻基础列，且不会递归装饰。
  // shell 与区块共享同一份 TypedArray 引用，GenCore 的跨区块 halo 写入对主线程直接可见。
  function ensureBaseChunk(cx, cz) {
    if (coreChunk(cx, cz)) return null;
    var k = key(cx, cz), ch = extra[k];
    if (!ch) { ch = newChunk(cx, cz); extra[k] = ch; }
    if (!ch.baseReady) {
      var shell = gen.ensureShell(cx, cz);
      ch.blocks = shell.blocks; ch.heights = shell.heights; ch.biomes = shell.biomes;
      ch.shell = shell;
      ch.baseReady = true;
      ch.decorated = shell.decorated;
    } else if (!ch.shell) {
      var s2 = gen.shellOf(cx, cz);
      ch.shell = (s2 && s2.baseReady) ? s2 : gen.absorbShell(cx, cz, packBlocks(ch.blocks), ch.heights, ch.biomes);
    }
    return ch;
  }

  function lightCost(id) {
    return Voxel.Light ? Voxel.Light.lightCost(id)
      : (Voxel.Blocks.isOpaque(id) ? -1 : (id === 7 ? 2 : 1));
  }

  function clearLightVol(arr) {
    if (!arr) return;
    if (arr.clear) arr.clear();
    else arr.fill(0);
  }

  function compactChunkLight(ch) {
    if (ch.sky.compact) ch.sky.compact();
    if (ch.blk.compact) ch.blk.compact();
    if (ch.blocks.compact) ch.blocks.compact();
  }

  // 只扫列天光 + 收集 emit，不跑块光 BFS。生成路径用这个，3×3 跨区块
  // flood 推迟到 drainPendingRelight，避免 ensureChunk 独占几十毫秒。
  function relightSky(ch) {
    clearLightVol(ch.sky);
    clearLightVol(ch.blk);
    var r = Voxel.Light.scanColumnSky(ch.blocks, ch.sky, ch.blk, ch.contentTop);
    ch.emit = r.emit;
    if (ch.sky.compact) ch.sky.compact();
    if (ch.blocks.compact) ch.blocks.compact();
    ch.skyReady = true;
    ch.lit = true;
  }

  function relight(ch) {
    clearLightVol(ch.sky);
    clearLightVol(ch.blk);
    var r = Voxel.Light.scanColumnSky(ch.blocks, ch.sky, ch.blk, ch.contentTop);
    ch.emit = r.emit;
    Voxel.Light.floodIntra(ch.blocks, ch.blk, r.buckets);
    compactChunkLight(ch);
    ch.skyReady = true;
    ch.lit = true;
  }

  // 块光需要跨区块连续。LIGHT_RANGE(15) < CS(32)，一次方块变化只可能影响
  // 所在区块及其八邻域；清空这 3×3 个 ready 外围区块后统一做全局坐标 BFS。
  // 区域外一圈的既有边界光作为种子导入，避免重算时擦掉其他未变化火把的贡献。
  function crossSpread(region, buckets, ch, lx, y, lz, level) {
    if (y < 0 || y >= H || level <= 0) return;
    var cx = ch.cx, cz = ch.cz;
    if (lx < 0) { cx--; lx += CS; }
    else if (lx >= CS) { cx++; lx -= CS; }
    if (lz < 0) { cz--; lz += CS; }
    else if (lz >= CS) { cz++; lz -= CS; }
    var dest = region[key(cx, cz)];
    if (!dest) return;
    var i = chunkIndex(lx, y, lz);
    var cost = lightCost(volGet(dest.blocks, lx, y, lz));
    if (cost < 0) return;
    var value = level - (cost - 1);
    if (value <= volGetI(dest.blk, i)) return;
    volSetI(dest.blk, i, value);
    if (!buckets[value]) buckets[value] = [];
    buckets[value].push({ ch: dest, i: i });
  }

  function lightYMax(ch, other) {
    var top = ch && ch.contentTop != null ? ch.contentTop : 0;
    if (other && other.contentTop != null && other.contentTop > top) top = other.contentTop;
    return Math.min(H - 1, top + BLOCK_LIGHT_RANGE);
  }

  // 核心→外围导光不能只用 NATURAL_TOP：玩家在接缝带加高（含测试把火把放在 H-1）
  // 会抬升 colTop，面光可能出现在该高度。只扫接缝内 15 格带的列顶，自然地形仍走快路径。
  function coreImportYMax(outsideCx, outsideCz, dx, dz) {
    var maxT = NATURAL_TOP;
    var ca = FiniteWorld.coreArrays && FiniteWorld.coreArrays();
    var tops = ca && ca.colTop;
    if (tops) {
      var x0, x1, z0, z1;
      if (dx !== 0) {
        var fx = dx < 0 ? W - 1 : 0;
        x0 = Math.max(0, dx < 0 ? fx - BLOCK_LIGHT_RANGE : fx);
        x1 = Math.min(W - 1, dx < 0 ? fx : fx + BLOCK_LIGHT_RANGE);
        z0 = Math.max(0, outsideCz * CS);
        z1 = Math.min(D - 1, outsideCz * CS + CS - 1);
      } else {
        var fz = dz < 0 ? D - 1 : 0;
        z0 = Math.max(0, dz < 0 ? fz - BLOCK_LIGHT_RANGE : fz);
        z1 = Math.min(D - 1, dz < 0 ? fz : fz + BLOCK_LIGHT_RANGE);
        x0 = Math.max(0, outsideCx * CS);
        x1 = Math.min(W - 1, outsideCx * CS + CS - 1);
      }
      for (var z = z0; z <= z1; z++) for (var x = x0; x <= x1; x++) {
        var t = tops[x + W * z];
        if (t > maxT) maxT = t;
      }
    }
    return Math.min(H - 1, maxT + BLOCK_LIGHT_RANGE);
  }

  function importBlockBorder(region, buckets, ch, dx, dz) {
    var outsideCx = ch.cx + dx, outsideCz = ch.cz + dz;
    var fromCore = coreChunk(outsideCx, outsideCz);
    var outside = fromCore ? null : extra[key(outsideCx, outsideCz)];
    if (!fromCore && (!outside || !outside.ready)) return;
    if (outside && region[key(outside.cx, outside.cz)]) return;
    var yHi = fromCore ? coreImportYMax(outsideCx, outsideCz, dx, dz) : lightYMax(ch, outside);
    for (var a = 0; a < CS; a++) for (var y = 0; y <= yHi; y++) {
      var inLx = dx < 0 ? 0 : (dx > 0 ? CS - 1 : a);
      var inLz = dz < 0 ? 0 : (dz > 0 ? CS - 1 : a);
      var outLx = dx < 0 ? CS - 1 : (dx > 0 ? 0 : a);
      var outLz = dz < 0 ? CS - 1 : (dz > 0 ? 0 : a);
      var outsideLevel = fromCore
        ? FiniteWorld.getBlk(outsideCx * CS + outLx, y, outsideCz * CS + outLz)
        : volGet(outside.blk, outLx, y, outLz);
      if (outsideLevel > 1) crossSpread(region, buckets, ch, inLx, y, inLz, outsideLevel - 1);
    }
  }

  function adjacentToCore(cx, cz) {
    return ((cx === -1 || cx === CORE_CX) && cz >= 0 && cz < CORE_CZ) ||
      ((cz === -1 || cz === CORE_CZ) && cx >= 0 && cx < CORE_CX);
  }

  function coreSpread(buckets, x, y, z, level) {
    if (x < 0 || x >= W || z < 0 || z >= D || y < 0 || y >= H || level <= 0) return;
    var id = FiniteWorld.get(x, y, z), cost = lightCost(id);
    if (cost < 0) return;
    var value = level - (cost - 1), i = coreLightIndex(x, y, z);
    if (value <= volGetI(coreBlkOverlay, i)) return;
    volSetI(coreBlkOverlay, i, value);
    if (!buckets[value]) buckets[value] = [];
    buckets[value].push(i);
  }

  function seedCoreFromExtra(buckets, ch, side) {
    if (!ch || !ch.ready) return;
    var yHi = lightYMax(ch, null);
    for (var a = 0; a < CS; a++) for (var y = 0; y <= yHi; y++) {
      var outsideLevel, x, z;
      if (side === 'left') {
        outsideLevel = volGet(ch.blk, CS - 1, y, a); x = 0; z = ch.cz * CS + a;
      } else if (side === 'right') {
        outsideLevel = volGet(ch.blk, 0, y, a); x = W - 1; z = ch.cz * CS + a;
      } else if (side === 'front') {
        outsideLevel = volGet(ch.blk, a, y, CS - 1); x = ch.cx * CS + a; z = 0;
      } else {
        outsideLevel = volGet(ch.blk, a, y, 0); x = ch.cx * CS + a; z = D - 1;
      }
      if (outsideLevel > 1) coreSpread(buckets, x, y, z, outsideLevel - 1);
    }
  }

  function coreFacingLight(ch, side) {
    if (!ch || !ch.ready) return false;
    var yHi = lightYMax(ch, null);
    for (var a = 0; a < CS; a++) for (var y = 0; y <= yHi; y++) {
      var lv = side === 'left' ? volGet(ch.blk, CS - 1, y, a) :
        side === 'right' ? volGet(ch.blk, 0, y, a) :
          side === 'front' ? volGet(ch.blk, a, y, CS - 1) : volGet(ch.blk, a, y, 0);
      if (lv > 1) return true;
    }
    return false;
  }

  function markCoreEdgeMeshes() {
    for (var ex = 0; ex < CORE_CX; ex++) {
      if (FiniteWorld.markChunkDirty) {
        FiniteWorld.markChunkDirty(ex, 0);
        FiniteWorld.markChunkDirty(ex, CORE_CZ - 1);
      }
    }
    for (var ez = 1; ez < CORE_CZ - 1; ez++) {
      if (FiniteWorld.markChunkDirty) {
        FiniteWorld.markChunkDirty(0, ez);
        FiniteWorld.markChunkDirty(CORE_CX - 1, ez);
      }
    }
  }

  // 有限后端的光数组保持完全不变；外围火把进入核心的贡献单独叠加，
  // 从而既保留旧档核心光照，又让 x=255/256 接缝没有单向暗缝。
  function recomputeCoreOverlay() {
    if (!planetMode || !FiniteWorld.lightReady()) return;
    var anySource = false;
    for (var scz = 0; scz < CORE_CZ && !anySource; scz++)
      anySource = coreFacingLight(extra[key(-1, scz)], 'left') ||
        coreFacingLight(extra[key(CORE_CX, scz)], 'right');
    for (var scx = 0; scx < CORE_CX && !anySource; scx++)
      anySource = coreFacingLight(extra[key(scx, -1)], 'front') ||
        coreFacingLight(extra[key(scx, CORE_CZ)], 'back');
    if (!anySource) {
      if (coreBlkOverlay) { coreBlkOverlay = null; markCoreEdgeMeshes(); }
      return;
    }
    if (!coreBlkOverlay) {
      coreBlkOverlay = Voxel.Sections ? Voxel.Sections.create(W, H, D, 2)
        : new Uint16Array(W * H * D);
    } else if (coreBlkOverlay.clear) coreBlkOverlay.clear();
    else coreBlkOverlay.fill(0);
    var buckets = [];
    for (var cz = 0; cz < CORE_CZ; cz++) {
      seedCoreFromExtra(buckets, extra[key(-1, cz)], 'left');
      seedCoreFromExtra(buckets, extra[key(CORE_CX, cz)], 'right');
    }
    for (var cx = 0; cx < CORE_CX; cx++) {
      seedCoreFromExtra(buckets, extra[key(cx, -1)], 'front');
      seedCoreFromExtra(buckets, extra[key(cx, CORE_CZ)], 'back');
    }
    for (var level = 15; level >= 1; level--) {
      var q = buckets[level];
      if (!q) continue;
      for (var qi = 0; qi < q.length; qi++) {
        var i = q[qi];
        if (volGetI(coreBlkOverlay, i) !== level) continue;
        var z = (i / (W * H)) | 0;
        var rem = i - z * W * H;
        var y = (rem / W) | 0;
        var x = rem - y * W;
        var next = level - 1;
        coreSpread(buckets, x + 1, y, z, next);
        coreSpread(buckets, x - 1, y, z, next);
        coreSpread(buckets, x, y + 1, z, next);
        coreSpread(buckets, x, y - 1, z, next);
        coreSpread(buckets, x, y, z + 1, next);
        coreSpread(buckets, x, y, z - 1, next);
      }
    }
    // 光程小于一个区块，只需让核心外圈区块重建顶点光。
    markCoreEdgeMeshes();
  }

  function addLightTarget(targets, cx, cz) {
    if (coreChunk(cx, cz)) return;
    var k = key(cx, cz);
    if (!targets[k]) targets[k] = [cx, cz];
  }

  function chunkHasEmit(ch) {
    return !!(ch && ch.emit && ch.emit.length);
  }

  function needsCrossLight(cx, cz) {
    var self = extra[key(cx, cz)];
    if (chunkHasEmit(self)) return true;
    if (adjacentToCore(cx, cz)) return true;
    for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      var n = extra[key(cx + dx, cz + dz)];
      if (chunkHasEmit(n)) return true;
    }
    return false;
  }

  // 多个 edit/核心边带变化共用一次 union BFS，避免逐 edit 重复清空、扫描同一 3×3 区域。
  function recomputeBlockLightBatch(targets, forceCoreOverlay) {
    var region = Object.create(null), chunks = [];
    var touchesCore = !!forceCoreOverlay;
    for (var tk in targets) {
      if (!own(targets, tk)) continue;
      var center = targets[tk], cx0 = center[0], cz0 = center[1];
      if (adjacentToCore(cx0, cz0)) touchesCore = true;
      for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
        var ch = extra[key(cx0 + dx, cz0 + dz)];
        if (!ch || !ch.ready) continue;
        var ck = key(ch.cx, ch.cz);
        if (!region[ck]) { region[ck] = ch; chunks.push(ch); }
        if (adjacentToCore(ch.cx, ch.cz)) touchesCore = true;
      }
    }
    if (!chunks.length) {
      if (touchesCore) recomputeCoreOverlay();
      return;
    }
    var anyEmit = false;
    for (var ce = 0; ce < chunks.length; ce++) {
      if (chunkHasEmit(chunks[ce])) { anyEmit = true; break; }
    }
    if (!anyEmit && !touchesCore) return;
    var buckets = [];
    for (var c = 0; c < chunks.length; c++) {
      if (chunks[c].blk.clear) chunks[c].blk.clear();
      else chunks[c].blk.fill(0);
    }

    // 区域内所有发光方块都是本轮的权威光源（火把/荧光菌伞等）。
    // 优先取 relight 维护的 emit 索引；绝大多数区块没有光源，
    // 直接跳过旧实现里对每个区块 32×64×32 的全量扫描。
    var LIGHT2 = Voxel.Blocks.LIGHT;
    for (var c2 = 0; c2 < chunks.length; c2++) {
      var src = chunks[c2];
      var em = src.emit;
      if (em) {
        for (var q = 0; q < em.length; q++) {
          var ii2 = em[q];
          var level2 = LIGHT2[volGetI(src.blocks, ii2)];
          if (!level2) continue;
          volSetI(src.blk, ii2, level2);
          if (!buckets[level2]) buckets[level2] = [];
          buckets[level2].push({ ch: src, i: ii2 });
        }
        continue;
      }
      // 兼容回退：无索引的区块（理论上不应出现）按旧逻辑全扫
      var nBlk = src.blocks.length || (CS * H * CS);
      for (var i = 0; i < nBlk; i++) {
        var level = LIGHT2[volGetI(src.blocks, i)];
        if (!level) continue;
        volSetI(src.blk, i, level);
        if (!buckets[level]) buckets[level] = [];
        buckets[level].push({ ch: src, i: i });
      }
    }

    // 只导入不属于本次 3×3 重算集的四边邻块；集内传播由统一 BFS 完成。
    for (var c3 = 0; c3 < chunks.length; c3++) {
      var bch = chunks[c3];
      importBlockBorder(region, buckets, bch, -1, 0);
      importBlockBorder(region, buckets, bch, 1, 0);
      importBlockBorder(region, buckets, bch, 0, -1);
      importBlockBorder(region, buckets, bch, 0, 1);
    }

    for (var l = 15; l >= 1; l--) {
      var q = buckets[l];
      if (!q) continue;
      for (var qi = 0; qi < q.length; qi++) {
        var node = q[qi], ch2 = node.ch, ii = node.i;
        if (volGetI(ch2.blk, ii) !== l) continue;
        var lz = (ii / (CS * H)) | 0;
        var rem = ii - lz * CS * H;
        var y2 = (rem / CS) | 0;
        var lx = rem - y2 * CS;
        var next = l - 1;
        crossSpread(region, buckets, ch2, lx + 1, y2, lz, next);
        crossSpread(region, buckets, ch2, lx - 1, y2, lz, next);
        crossSpread(region, buckets, ch2, lx, y2 + 1, lz, next);
        crossSpread(region, buckets, ch2, lx, y2 - 1, lz, next);
        crossSpread(region, buckets, ch2, lx, y2, lz + 1, next);
        crossSpread(region, buckets, ch2, lx, y2, lz - 1, next);
      }
    }
    for (var c4 = 0; c4 < chunks.length; c4++) queueMesh(chunks[c4].cx, chunks[c4].cz);
    if (touchesCore) recomputeCoreOverlay();
  }

  function recomputeBlockLightAround(cx0, cz0) {
    var targets = Object.create(null);
    addLightTarget(targets, cx0, cz0);
    recomputeBlockLightBatch(targets, adjacentToCore(cx0, cz0));
  }

  function queueCrossLight(cx, cz) {
    var k = key(cx, cz);
    if (pendingRelightSet[k]) return;
    pendingRelightSet[k] = true;
    pendingRelight.push([cx, cz]);
  }

  // 卸载/生成触发的 3×3 块光不急于一帧内全部完成。
  // 单次 BFS 仍可能数毫秒，但不再卡在 ensureChunk 同步路径上。
  function drainPendingRelight(maxMs) {
    if (!pendingRelight.length) return 0;
    var t0 = perfNow(), n = 0;
    while (pendingRelight.length) {
      var it = pendingRelight.shift();
      delete pendingRelightSet[key(it[0], it[1])];
      // 目标区块可能已被再次卸载/重载覆盖，重光以当前 3×3 就绪集为准，幂等安全。
      recomputeBlockLightAround(it[0], it[1]);
      n++;
      if (perfNow() - t0 >= maxMs) break;
    }
    return n;
  }

  function flushPendingLight() {
    while (pendingRelight.length) drainPendingRelight(1e9);
  }

  // ---- 地形生成 Worker 客户端（P2）----
  // base 地形 + 装饰在 Worker 内执行（GenCore 与主线程共用同一实现），
  // 主线程只负责安装数组、应用编辑、光照与网格。Worker 失败自动回退同步路径。
  var wc = null, wcFailed = false, wcEpoch = 0, wcInflight = 0, wcNextId = 1;
  var wcPending = Object.create(null);   // jobId -> job
  var wcQueue = [];                      // 待派发任务（受在途上限约束）
  var WC_MAX_INFLIGHT = 4;
  // 在途任务失联看门狗：worker 侧 GenCore.create 抛错会主动上报 {type:'error'}，
  // 但若 worker 卡死/静默吞掉 job，槽位永远不会释放且泵不再派发新任务 → 流式停滞。
  // 超过阈值仍未收到任何结果即整体回退同步生成路径。
  var WC_JOB_TIMEOUT_MS = 30000;
  var wcOldestAt = 0;   // 当前在途批次的最早派发时刻（0=无在途）

  function wcActive() { return !wcFailed && !!wc && planetMode; }

  function failWorker(why) {
    // Worker 不可用（file:// / CSP / 加载失败 / init 抛错 / 超时失联）：整体回退同步生成。
    wcFailed = true;
    if (why && window.console && console.warn) console.warn('[World] 地形生成线程停用：' + why);
    var retry = [];
    for (var id in wcPending) if (own(wcPending, id)) retry.push(wcPending[id]);
    retry = retry.concat(wcQueue);
    wcQueue = [];
    wcPending = Object.create(null);
    try { wc.terminate(); } catch (e) { }
    wc = null; wcInflight = 0; wcOldestAt = 0;
    for (var i = 0; i < retry.length; i++) {
      var j = retry[i];
      var k2 = key(j.cx, j.cz);
      var c2 = extra[k2];
      if (c2 && c2.baseReady && c2.decorated) continue;
      genQueued[k2] = true;
      genQueue.push({ key: k2, cx: j.cx, cz: j.cz, d: j.d || 0 });
    }
  }

  function ensureWorker() {
    if (wc || wcFailed || !planetMode || typeof Worker === 'undefined') return;
    try {
      wc = new Worker('js/world/gen_worker.js?v=' + (Voxel.Config.GEN_WORKER_V || 1));
      wc.onmessage = function (e) {
        var m = e.data;
        if (!m) return;
        // worker 侧 init 失败会主动上报 {type:'error'}；此前该消息被静默丢弃，
        // inflight 槽被占满后泵永远不再派发 → 区块生成停滞。必须走回退。
        if (m.type === 'error') { failWorker('初始化失败：' + (m.message || '未知')); return; }
        if (m.type !== 'chunk') return;
        var job = wcPending[m.jobId];
        if (m.epoch !== wcEpoch || !job) {
          if (job) { delete wcPending[m.jobId]; wcInflight--; }
          if (wcInflight <= 0) { wcInflight = 0; wcOldestAt = 0; }
          return;
        }
        delete wcPending[m.jobId];
        wcInflight--;
        if (wcInflight <= 0) wcOldestAt = 0;
        installWorkerChunk(job.cx, job.cz, m.blocks, m.heights, m.biomes, m.sky, m.blk, m.emit);
      };
      wc.onerror = function () {
        failWorker('加载失败');
      };
      wc.postMessage({ type: 'init', epoch: wcEpoch, seed: seed, profile: profile });
    } catch (e) {
      wcFailed = true;
      wc = null;
    }
  }

  function pumpWorkerResults() {
    if (!wcActive()) return;
    // 看门狗：有在途任务且长时间零回报 → 判定 worker 失联，回退同步路径
    if (wcInflight > 0) {
      var nowMs = perfNow();
      if (!wcOldestAt) wcOldestAt = nowMs;
      else if (nowMs - wcOldestAt > WC_JOB_TIMEOUT_MS) { failWorker('在途任务超时'); return; }
    } else if (wcOldestAt) {
      wcOldestAt = 0;
    }
    while (wcInflight < WC_MAX_INFLIGHT && wcQueue.length) {
      var job = wcQueue.shift();
      var k = key(job.cx, job.cz);
      var ch = extra[k];
      if (ch && ch.baseReady && ch.decorated) { delete genQueued[k]; continue; }   // 已被同步路径完成
      if (!wcOldestAt) wcOldestAt = perfNow();
      var id = wcNextId++;
      wcPending[id] = job;
      wcInflight++;
      wc.postMessage({ type: 'job', epoch: wcEpoch, jobId: id, cx: job.cx, cz: job.cz });
    }
  }

  function packLight(arr) {
    if (!Voxel.Sections || !arr || arr.__sections) return arr;
    return Voxel.Sections.fromFlat(arr, CS, H, CS);
  }

  // Worker 产出安装：blocks/heights/biomes 已含装饰；天光/块光/emit 若随包到达则跳过主线程列扫。
  function installWorkerChunk(cx, cz, blocksBuf, heightsBuf, biomesBuf, skyBuf, blkBuf, emitBuf) {
    var k = key(cx, cz);
    var ch = extra[k];
    if (!ch) { ch = newChunk(cx, cz); extra[k] = ch; }
    ch.blocks = packBlocks(new Uint16Array(blocksBuf));
    ch.heights = new Int16Array(heightsBuf);
    ch.biomes = new Uint8Array(biomesBuf);
    if (skyBuf) {
      ch.sky = packLight(new Uint8Array(skyBuf));
      ch.skyReady = true;
      ch.lit = true;
    }
    if (blkBuf) ch.blk = packLight(new Uint8Array(blkBuf));
    if (emitBuf) ch.emit = Array.prototype.slice.call(new Int32Array(emitBuf));
    ch.baseReady = true;
    ch.decorated = true;
    if (gen) gen.absorbShell(cx, cz, ch.blocks, ch.heights, ch.biomes);
    // 只对焦点附近区块继续就绪阶段；远处产物仅保留数据供 halo/光照采样。
    var dx = cx - floorDiv(focus.x, CS), dz = cz - floorDiv(focus.z, CS);
    if (!ch.ready && Math.abs(dx) <= DATA_RADIUS && Math.abs(dz) <= DATA_RADIUS) {
      genQueued[k] = true;
      genQueue.push({ key: k, cx: cx, cz: cz, d: dx * dx + dz * dz });
    } else {
      delete genQueued[k];
    }
  }

  function dispatchWorkerJob(job) {
    wcQueue.push(job);
  }


  function applyChunkEdits(ch) {
    var list = editsByChunk[key(ch.cx, ch.cz)];
    if (!list) return 0;
    var n = 0;
    for (var k in list) {
      if (!own(list, k)) continue;
      var p = k.split(',');
      setInChunk(ch, +p[0], +p[1], +p[2], +list[k]);
      n++;
    }
    return n;
  }

  function chunkLod(cx, cz) {
    var d = Math.max(Math.abs(cx - floorDiv(focus.x, CS)), Math.abs(cz - floorDiv(focus.z, CS)));
    if (d <= RENDER_RADIUS) return 0;
    return 1;
  }

  function queueMesh(cx, cz) {
    var k = key(cx, cz), ch = extra[k];
    if (!ch || !ch.ready || meshQueued[k]) return;
    var nextLod = chunkLod(cx, cz);
    if (ch.lod !== nextLod) { ch.lod = nextLod; ch.meshed = false; }
    ch.dirty = true;
    // 版本号随每次入队递增：在途的旧网格产物落地时据此丢弃
    ch.meshRev = (ch.meshRev || 0) + 1;
    meshQueued[k] = true;
    meshQueue.push(k);
  }

  function markChunkDirty(cx, cz) {
    if (coreChunk(cx, cz)) {
      if (FiniteWorld.markChunkDirty) FiniteWorld.markChunkDirty(cx, cz);
      return;
    }
    queueMesh(cx, cz);
  }

  function markNeighborhood(cx, cz) {
    for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++)
      markChunkDirty(cx + dx, cz + dz);
  }

  function ensureChunk(cx, cz) {
    cx = Math.floor(+cx); cz = Math.floor(+cz);
    if (!isFinite(cx) || !isFinite(cz) || coreChunk(cx, cz) || !planetMode) return null;
    var ch = ensureBaseChunk(cx, cz);
    if (!ch.ready) {
      // Worker 产出的区块已完成装饰；同步路径在此处装饰。
      if (!ch.decorated) {
        gen.decorate(ch.shell);
        ch.blocks = ch.shell.blocks;
        ch.decorated = true;
      }
      var nEdits = applyChunkEdits(ch);
      if (!ch.skyReady || nEdits) relightSky(ch);
      else compactChunkLight(ch);
      ch.ready = true;
      ch.lit = true;
      // 跨区块块光推迟到 stream() 切片。无光源且不靠核心时完全跳过 BFS。
      if (needsCrossLight(cx, cz)) queueCrossLight(cx, cz);
      ch.dirty = true;
      markNeighborhood(cx, cz);
    }
    return ch;
  }

  function enqueueChunk(cx, cz, dist) {
    var k = key(cx, cz);
    var ch = extra[k];
    // 装饰会预先创建相邻的 base-only halo；存在于 extra 不等于可游玩的 ready。
    if (coreChunk(cx, cz) || (ch && ch.ready) || genQueued[k]) return;
    genQueued[k] = true;
    genQueue.push({ key: k, cx: cx, cz: cz, d: dist });
  }

  function refreshStreaming() {
    if (!planetMode || !FiniteWorld.isReady()) return;
    var cx0 = focus.cx === null ? floorDiv(focus.x, CS) : focus.cx;
    var cz0 = focus.cz === null ? floorDiv(focus.z, CS) : focus.cz;
    var wanted = Object.create(null);
    for (var dx = -DATA_RADIUS; dx <= DATA_RADIUS; dx++) for (var dz = -DATA_RADIUS; dz <= DATA_RADIUS; dz++) {
      var cx = cx0 + dx, cz = cz0 + dz;
      wanted[key(cx, cz)] = true;
      enqueueChunk(cx, cz, dx * dx + dz * dz);
    }
    var filtered = [];
    genQueued = Object.create(null);
    for (var i = 0; i < genQueue.length; i++) {
      var job = genQueue[i];
      if (!wanted[job.key] || (extra[job.key] && extra[job.key].ready)) continue;
      genQueued[job.key] = true;
      filtered.push(job);
    }
    filtered.sort(function (a, b) { return a.d - b.d; });
    genQueue = filtered;
    // Worker 队列同样按新焦点过滤：不再需要的任务释放 genQueued 占位
    var wq = [];
    for (var wi = 0; wi < wcQueue.length; wi++) {
      var wj = wcQueue[wi];
      var wch = extra[wj.key];
      if (!wanted[wj.key] || (wch && wch.baseReady && wch.decorated)) {
        delete genQueued[wj.key];
        continue;
      }
      genQueued[wj.key] = true;
      wq.push(wj);
    }
    wcQueue = wq;
    for (var k in extra) {
      var ch = extra[k];
      if (Math.abs(ch.cx - cx0) <= DATA_RADIUS && Math.abs(ch.cz - cz0) <= DATA_RADIUS)
        queueMesh(ch.cx, ch.cz);
    }
    enqueueFarRing(cx0, cz0);
    unloadOutside(cx0, cz0, KEEP_RADIUS);
  }

  function pumpGeneration(n) {
    if (!planetMode || !FiniteWorld.isReady()) return 0;
    var built = 0;
    while (n-- > 0 && genQueue.length) {
      var job = genQueue.shift();
      delete genQueued[job.key];
      var ch = extra[job.key];
      // Worker 路径：base+装饰整体在 Worker 内完成，主线程只派发/安装，
      // 单帧只消耗一次循环配额，不产生同步生成停顿。
      // 注意：Worker 产物已含装饰，就绪阶段无需等待邻居——跨区块接缝
      // 由 ensureChunk 的 markNeighborhood/重光批量处理（邻居抵达时会
      // 触发本区块重建）。这里绝不能按“最近优先 + 等待更远邻居”门控，
      // 否则队头区块会以最小 d 反复重排，把它等待的邻居永久压在身后形成活锁。
      if (wcActive()) {
        if (!ch || !ch.baseReady || !ch.decorated) {
          dispatchWorkerJob(job);
          built++;
          continue;
        }
        if (!ch.ready) ensureChunk(job.cx, job.cz);
        built++;
        continue;
      }
      // 同步回退路径：游玩帧内把“基础密度生成”和“确定性装饰/光照”拆成小步；
      // 否则首次装饰一个区块会同步生成整个 halo，单帧可能出现明显长停顿。
      if (!ch || !ch.baseReady) {
        ensureBaseChunk(job.cx, job.cz);
        genQueued[job.key] = true;
        genQueue.push(job);
        built++;
        continue;
      }
      var missing = null;
      for (var dx = -1; dx <= 1 && !missing; dx++) for (var dz = -1; dz <= 1; dz++) {
        var ncx = job.cx + dx, ncz = job.cz + dz;
        if (coreChunk(ncx, ncz)) continue;
        var neighbor = extra[key(ncx, ncz)];
        if (!neighbor || !neighbor.baseReady) { missing = [ncx, ncz]; break; }
      }
      if (missing) {
        ensureBaseChunk(missing[0], missing[1]);
        genQueued[job.key] = true;
        genQueue.push(job);
        built++;
        continue;
      }
      if (!ch.ready) ensureChunk(job.cx, job.cz);
      built++;
    }
    if (genQueue.length > 1) genQueue.sort(function (a, b) { return a.d - b.d; });
    return built;
  }

  function disposeChunkMesh(ch) {
    if (ch.mesh) {
      if (extraGroup) extraGroup.remove(ch.mesh);
      if (ch.mesh.geometry) ch.mesh.geometry.dispose();
      ch.mesh = null;
    }
    if (ch.wmesh) {
      if (extraGroup) extraGroup.remove(ch.wmesh);
      if (ch.wmesh.geometry) ch.wmesh.geometry.dispose();
      ch.wmesh = null;
    }
    if (ch.fmesh) {
      if (extraGroup) extraGroup.remove(ch.fmesh);
      if (ch.fmesh.geometry) ch.fmesh.geometry.dispose();
      if (Voxel.Shadow) Voxel.Shadow.removeCaster(ch.fmesh);
      ch.fmesh = null;
    }
    ch.meshed = false;
  }

  function hasBoundaryBlockLight(ch) {
    var yHi = lightYMax(ch, null);
    for (var a = 0; a < CS; a++) for (var y = 0; y <= yHi; y++) {
      if (volGet(ch.blk, 0, y, a) > 1 || volGet(ch.blk, CS - 1, y, a) > 1 ||
        volGet(ch.blk, a, y, 0) > 1 || volGet(ch.blk, a, y, CS - 1) > 1) return true;
    }
    return false;
  }

  function unloadChunk(k) {
    var ch = extra[k];
    if (!ch) return;
    var sharedLight = hasBoundaryBlockLight(ch);
    disposeChunkMesh(ch);
    delete extra[k];
    delete meshQueued[k];
    // 必须同步清掉生成占位：否则该区块的 Worker 任务若已被消费/丢弃，
    // 残留的 genQueued 会永久阻止重新入队，造成等待其 halo 的邻块死锁。
    delete genQueued[k];
    if (memoCh === ch || (ch.cx === memoCx && ch.cz === memoCz)) invalidateChunkMemo();
    if (sharedLight) queueCrossLight(ch.cx, ch.cz);
    markNeighborhood(ch.cx, ch.cz);
  }

  function unloadOutside(cx0, cz0, radius) {
    cx0 = Math.floor(+cx0); cz0 = Math.floor(+cz0); radius = Math.max(0, Math.floor(+radius));
    for (var k in extra) {
      var ch = extra[k];
      if (Math.abs(ch.cx - cx0) > radius || Math.abs(ch.cz - cz0) > radius) unloadChunk(k);
    }
    var mq = [], nextQueued = Object.create(null);
    for (var i = 0; i < meshQueue.length; i++) {
      if (!extra[meshQueue[i]] || nextQueued[meshQueue[i]]) continue;
      nextQueued[meshQueue[i]] = true; mq.push(meshQueue[i]);
    }
    meshQueue = mq; meshQueued = nextQueued;
  }

  function ensureMeshGroup(scene) {
    if (!extraGroup) extraGroup = new THREE.Group();
    if (extraGroup.parent !== scene) scene.add(extraGroup);
    if (!farGroup) farGroup = new THREE.Group();
    if (farGroup.parent !== scene) scene.add(farGroup);
    extraScene = scene;
  }

  function disposeFarMesh(k) {
    var m = farMeshes[k];
    if (!m) return;
    if (farGroup) farGroup.remove(m);
    if (m.geometry) m.geometry.dispose();
    delete farMeshes[k];
  }

  function enqueueFarRing(cx0, cz0) {
    var wanted = Object.create(null);
    var nq = [];
    for (var dx = -LOD_FAR_RADIUS; dx <= LOD_FAR_RADIUS; dx++)
      for (var dz = -LOD_FAR_RADIUS; dz <= LOD_FAR_RADIUS; dz++) {
        var d = Math.max(Math.abs(dx), Math.abs(dz));
        if (d <= DATA_RADIUS || d > LOD_FAR_RADIUS) continue;
        var cx = cx0 + dx, cz = cz0 + dz;
        if (coreChunk(cx, cz)) continue;
        var k = key(cx, cz);
        wanted[k] = true;
        if (!farMeshes[k]) nq.push({ k: k, cx: cx, cz: cz, d: d });
      }
    for (var fk in farMeshes) if (!wanted[fk]) disposeFarMesh(fk);
    nq.sort(function (a, b) { return a.d - b.d; });
    farQueue = nq;
  }

  function farHeightAt(wx, wz) {
    if (FiniteWorld.predictedHeightAt) return FiniteWorld.predictedHeightAt(wx, wz);
    return WATER;
  }

  function farIdAt(wx, wz) {
    var y = farHeightAt(wx, wz);
    if (y < WATER) return 7;
    if (y >= SNOW_LEVEL) return 13;
    return 2;
  }

  function buildFarMeshes(n, scene) {
    if (!planetMode || !Voxel.MeshBuilder || !Voxel.MeshBuilder.buildFarHeightmap || !scene) return 0;
    if (typeof THREE === 'undefined') return 0;
    ensureMeshGroup(scene);
    var built = 0;
    n = Math.max(1, n | 0) * 4;
    while (n-- > 0 && farQueue.length) {
      var job = farQueue.shift();
      if (farMeshes[job.k] || extra[job.k]) continue;
      var res = Voxel.MeshBuilder.buildFarHeightmap(job.cx, job.cz, farHeightAt, farIdAt);
      if (res && res.opaque) {
        var mesh = new THREE.Mesh(res.opaque, Voxel.MeshBuilder.opaqueMat());
        farGroup.add(mesh);
        farMeshes[job.k] = mesh;
        built++;
      }
    }
    return built;
  }

  function buildExtraMeshes(n, scene) {
    if (!planetMode || !Voxel.MeshBuilder || !scene) return 0;
    ensureMeshGroup(scene);
    var built = 0, cx0 = floorDiv(focus.x, CS), cz0 = floorDiv(focus.z, CS);
    while (n-- > 0 && meshQueue.length) {
      var best = -1, bestD = Infinity;
      for (var i = 0; i < meshQueue.length; i++) {
        var c = extra[meshQueue[i]];
        if (!c || Math.abs(c.cx - cx0) > DATA_RADIUS || Math.abs(c.cz - cz0) > DATA_RADIUS) continue;
        var d = (c.cx - cx0) * (c.cx - cx0) + (c.cz - cz0) * (c.cz - cz0);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) break;
      var k = meshQueue.splice(best, 1)[0];
      delete meshQueued[k];
      var ch = extra[k];
      if (!ch || !ch.ready) continue;
      built++;
      // 路由：Worker 有余量 → 派发异步构建（发射循环 ~10ms 移出主线程）；
      // 其余情形走原同步路径（file:// / CSP / 失败回退共用）
      if (!mwFailed && mwInflight < MW_MAX_INFLIGHT && dispatchMeshJob(ch)) continue;
      // 派发失败若已由 failMeshWorker 把该区块重新入队，跳过同步双建，
      // 留给下一轮队列自然消化（此时 rev 已被 bump，旧产物不会被误装）
      if (meshQueued[k]) { built--; continue; }
      disposeChunkMesh(ch);
      applyChunkGeometry(ch, Voxel.MeshBuilder.build(ch.cx, ch.cz, ch.lod || 0));
    }
    return built;
  }

  function indexExtraEdit(x, y, z, id) {
    var pk = posKey(x, y, z), ck = key(floorDiv(x, CS), floorDiv(z, CS));
    extraEdits[pk] = id;
    if (!editsByChunk[ck]) editsByChunk[ck] = Object.create(null);
    editsByChunk[ck][pk] = id;
  }

  function init(s, worldProfile) {
    FiniteWorld.init(s, worldProfile);
    // null/undefined 会由有限后端随机化；必须复用其规范化结果，不能再随机一次。
    seed = FiniteWorld.getSeed();
    profile = worldProfile || null;
    terrainVersion = Voxel.PlanetRules && Voxel.PlanetRules.normalizeVersion
      ? Voxel.PlanetRules.normalizeVersion(profile && profile.terrainVersion, 1)
      : ((profile && profile.terrainVersion === 2) ? 2 : 1);
    planetTypeKey = profile && typeof profile.typeKey === 'string' ? profile.typeKey : 'lush';
    planetMode = !profile || profile.kind !== 'station';
    // 生成核心（base+装饰）：主线程同步回退与 Worker 共用同一实现。
    gen = Voxel.GenCore.create({ seed: seed, profile: worldProfile });
    // 外星巨树/遗迹只绑定在行星模式 + terrainVersion=2 的世界上；空间站与旧档不受影响。
    if (Voxel.Structures) {
      Voxel.Structures.bind(planetMode && gen.terrainVersion === 2 ? {
        hash2: gen.noise.hash2,
        surfaceAt: gen.surfaceAt,
        biomeAt: gen.biomeAt,
        typeKey: gen.planetTypeKey,
        version: gen.terrainVersion
      } : null);
    }
    if (extraGroup && extraGroup.parent) extraGroup.parent.remove(extraGroup);
    for (var k in extra) disposeChunkMesh(extra[k]);
    extra = Object.create(null);
    invalidateChunkMemo();
    pendingRelight.length = 0;
    pendingRelightSet = Object.create(null);
    // Worker 会话重置：新世界 → 新纪元，旧纪元的在途产物一律丢弃
    wcFailed = false;
    wcEpoch++;
    wcQueue.length = 0;
    wcPending = Object.create(null);
    wcInflight = 0;
    // 网格 Worker 无状态可跨世界复用，但换世界的在途产物必须作废：
    // extra 表已重建，迟到回包会因 key 不存在被丢弃，这里清空计数即可
    mwPending = Object.create(null);
    mwInflight = 0;
    wcOldestAt = 0;
    if (wc) {
      try { wc.postMessage({ type: 'init', epoch: wcEpoch, seed: seed, profile: worldProfile }); }
      catch (e) { wcFailed = true; wc = null; }
    } else {
      ensureWorker();
    }
    extraEdits = Object.create(null);
    editsByChunk = Object.create(null);
    coreBlkOverlay = null;
    genQueue = []; genQueued = Object.create(null);
    meshQueue = []; meshQueued = Object.create(null);
    extraGroup = null; farGroup = null; extraScene = null;
    farQueue = []; farMeshes = Object.create(null);
    focus.x = W / 2; focus.z = D / 2; focus.cx = null; focus.cz = null;
  }

  function generateNext(n) {
    if (!FiniteWorld.isReady()) {
      FiniteWorld.generateNext(n);
      if (FiniteWorld.isReady()) {
        focus.cx = floorDiv(focus.x, CS); focus.cz = floorDiv(focus.z, CS);
        refreshStreaming();
      }
      return;
    }
    pumpGeneration(Math.max(0, n | 0));
  }

  function setFocus(x, z) {
    FiniteWorld.setFocus(x, z);
    if (isFinite(x)) focus.x = x;
    if (isFinite(z)) focus.z = z;
    var cx = floorDiv(focus.x, CS), cz = floorDiv(focus.z, CS);
    if (cx !== focus.cx || cz !== focus.cz) {
      focus.cx = cx; focus.cz = cz;
      refreshStreaming();
    }
  }

  // 热路径（网格填充回退/物理/射线/生物）每帧调用数十万次：
  // 1. ready 区块的数据已含全部编辑（applyChunkEdits/set 均直写 blocks），
  //    因此无需再查字符串键的 extraEdits 覆盖层；
  // 2. 最近访问的区块做记忆化，把"两次字符串拼接+哈希"降为一次整数比较。
  var memoCx = 0x7fffffff, memoCz = 0x7fffffff, memoCh = null;
  function invalidateChunkMemo() { memoCx = 0x7fffffff; memoCz = 0x7fffffff; memoCh = null; }
  function chunkFor(x, z) {
    var cx = floorDiv(x, CS), cz = floorDiv(z, CS);
    if (cx === memoCx && cz === memoCz) return memoCh;
    memoCx = cx; memoCz = cz;
    memoCh = extra[key(cx, cz)] || null;
    return memoCh;
  }

  function get(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0) return 12;
    if (y >= H) return 0;
    if (!planetMode || inCore(x, z)) return FiniteWorld.get(x, y, z);
    var ch = chunkFor(x, z);
    if (ch && ch.ready) return volGet(ch.blocks, x - ch.cx * CS, y, z - ch.cz * CS);
    return 12;
  }

  // 收集一个核心格在 15 格块光程内可能影响的所有外围区块；四边与四角统一处理。
  function collectCoreLightTargets(targets, x, z) {
    var touched = false;
    var minCx = floorDiv(x - BLOCK_LIGHT_RANGE, CS);
    var maxCx = floorDiv(x + BLOCK_LIGHT_RANGE, CS);
    var minCz = floorDiv(z - BLOCK_LIGHT_RANGE, CS);
    var maxCz = floorDiv(z + BLOCK_LIGHT_RANGE, CS);
    for (var cx = minCx; cx <= maxCx; cx++) for (var cz = minCz; cz <= maxCz; cz++) {
      if (coreChunk(cx, cz)) continue;
      touched = true;
      addLightTarget(targets, cx, cz);
    }
    return touched;
  }

  function refreshCoreLightBandAt(x, z) {
    var targets = Object.create(null);
    var touchesCoreSeam = collectCoreLightTargets(targets, x, z);
    if (touchesCoreSeam) recomputeBlockLightBatch(targets, true);
  }

  function set(x, y, z, id) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); id = Math.floor(id);
    if (!validXYZ(x, y, z) || id < 0 || id > 255 || (id !== 0 && !Voxel.Blocks.defs[id])) return;
    if (!planetMode || inCore(x, z)) {
      FiniteWorld.set(x, y, z, id);
      if (planetMode) {
        if (FiniteWorld.lightReady()) refreshCoreLightBandAt(x, z);
        // 方块面剔除只在几何边界需要跨核心/外围失效；光照的 15 格带由上方批量处理。
        if (x === 0 || x === W - 1 || z === 0 || z === D - 1)
          markNeighborhood(floorDiv(x, CS), floorDiv(z, CS));
      }
      return;
    }
    var ch = ensureChunk(floorDiv(x, CS), floorDiv(z, CS));
    setInChunk(ch, x, y, z, id);
    indexExtraEdit(x, y, z, id);
    if (id === 0) FiniteWorld.setMeta(x, y, z, null);
    relight(ch);
    recomputeBlockLightAround(ch.cx, ch.cz);
    markNeighborhood(ch.cx, ch.cz);
  }

  function applyInfrastructure(changes) {
    if (!Array.isArray(changes) || !changes.length || changes.length > 2048) return 0;
    var normalized = [], allCore = true;
    for (var i = 0; i < changes.length; i++) {
      var c = changes[i] || {};
      var x = Math.floor(Number(c.x)), y = Math.floor(Number(c.y));
      var z = Math.floor(Number(c.z)), id = Math.floor(Number(c.id));
      if (!validXYZ(x, y, z) || !Number.isFinite(id) || id < 0 || id > 255 ||
        (id !== 0 && !Voxel.Blocks.defs[id])) return 0;
      normalized.push({ x: x, y: y, z: z, id: id });
      if (!inCore(x, z)) allCore = false;
    }
    if (!planetMode || allCore) {
      var count = FiniteWorld.applyInfrastructure ? FiniteWorld.applyInfrastructure(normalized) : 0;
      if (planetMode && count && FiniteWorld.lightReady()) {
        for (var j = 0; j < normalized.length; j++) {
          var nx = normalized[j].x, nz = normalized[j].z;
          if (nx <= BLOCK_LIGHT_RANGE || nx >= W - 1 - BLOCK_LIGHT_RANGE ||
            nz <= BLOCK_LIGHT_RANGE || nz >= D - 1 - BLOCK_LIGHT_RANGE)
            refreshCoreLightBandAt(nx, nz);
        }
      }
      return count;
    }
    for (var k = 0; k < normalized.length; k++)
      set(normalized[k].x, normalized[k].y, normalized[k].z, normalized[k].id);
    return normalized.length;
  }

  function surfaceAt(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (!planetMode || inCore(x, z)) return FiniteWorld.surfaceAt(x, z);
    var ch = chunkAtBlock(x, z);
    if (!ch || !ch.ready) ch = ensureChunk(floorDiv(x, CS), floorDiv(z, CS));
    for (var y = H - 1; y >= 0; y--)
      if (Voxel.Blocks.isSolid(getFromChunk(ch, x, y, z))) return y;
    return -1;
  }

  function biomeAt(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (!planetMode || inCore(x, z)) return FiniteWorld.biomeAt(x, z);
    var ch = chunkAtBlock(x, z);
    if (!ch || !ch.ready) ch = ensureChunk(floorDiv(x, CS), floorDiv(z, CS));
    return ch.biomes[columnIndex(localCoord(x, CS), localCoord(z, CS))];
  }

  function getSky(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y >= H) return 15;
    if (y < 0) return 0;
    if (!planetMode || inCore(x, z)) return FiniteWorld.getSky(x, y, z);
    var ch = chunkAtBlock(x, z);
    if (!ch || !ch.ready) return 15;
    if (y > ch.contentTop) return 15;
    return volGet(ch.sky, localCoord(x, CS), y, localCoord(z, CS));
  }

  function getBlk(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= H) return 0;
    if (!planetMode || inCore(x, z)) {
      var base = FiniteWorld.getBlk(x, y, z);
      if (planetMode && coreBlkOverlay && inCore(x, z))
        base = Math.max(base, volGetI(coreBlkOverlay, coreLightIndex(x, y, z)));
      return base;
    }
    var ch = chunkAtBlock(x, z);
    return ch && ch.ready ? volGet(ch.blk, localCoord(x, CS), y, localCoord(z, CS)) : 0;
  }

  function applyEdits(ed) {
    if (!ed) return;
    var core = Object.create(null), touched = Object.create(null);
    var lightTargets = Object.create(null), coreLightTouched = false;
    var coreBoundaryChunks = Object.create(null);
    for (var k in ed) {
      if (!own(ed, k)) continue;
      var p = k.split(',');
      if (p.length !== 3) continue;
      var x = +p[0], y = +p[1], z = +p[2], id = +ed[k];
      if (!validXYZ(x, y, z) || !Number.isInteger(id) || id < 0 || id > 255 ||
        (id !== 0 && !Voxel.Blocks.defs[id])) continue;
      if (!planetMode || inCore(x, z)) {
        core[k] = id;
        if (planetMode) {
          if (FiniteWorld.lightReady() && collectCoreLightTargets(lightTargets, x, z)) coreLightTouched = true;
          if (x === 0 || x === W - 1 || z === 0 || z === D - 1) {
            var bcx = floorDiv(x, CS), bcz = floorDiv(z, CS);
            coreBoundaryChunks[key(bcx, bcz)] = [bcx, bcz];
          }
        }
      }
      else {
        indexExtraEdit(x, y, z, id);
        var ck = key(floorDiv(x, CS), floorDiv(z, CS));
        touched[ck] = true;
        var ch = extra[ck];
        if (ch && ch.ready) setInChunk(ch, x, y, z, id);
      }
    }
    FiniteWorld.applyEdits(core);
    for (var bk in coreBoundaryChunks) {
      if (!own(coreBoundaryChunks, bk)) continue;
      var bp = coreBoundaryChunks[bk];
      markNeighborhood(bp[0], bp[1]);
    }
    for (var ck2 in touched) {
      var ch2 = extra[ck2];
      if (ch2 && ch2.ready) {
        relight(ch2);
        addLightTarget(lightTargets, ch2.cx, ch2.cz);
        markNeighborhood(ch2.cx, ch2.cz);
      }
    }
    recomputeBlockLightBatch(lightTargets, coreLightTouched);
  }

  function getEdits() {
    var out = {}, core = FiniteWorld.getEdits();
    for (var k in core) if (own(core, k)) out[k] = core[k];
    for (var k2 in extraEdits) if (own(extraEdits, k2)) out[k2] = extraEdits[k2];
    return out;
  }

  function isEdited(x, y, z) {
    if (!validXYZ(x, y, z)) return false;
    if (!planetMode || inCore(x, z))
      return FiniteWorld.isEdited ? FiniteWorld.isEdited(x, y, z) : own(FiniteWorld.getEdits(), posKey(x, y, z));
    return own(extraEdits, posKey(x, y, z));
  }

  function buildMeshes(n, scene) {
    FiniteWorld.buildMeshes(n, scene);
    if (!planetMode || !FiniteWorld.isReady()) return 0;
    return buildExtraMeshes(Math.max(0, n | 0), scene);
  }

  // ---- MeshBuilder 填充式采样支持（P0）----
  // 返回就绪区块的 TypedArray 引用（不复制）；null 表示该区块无直接数组，
  // 由调用方回退到全局门面语义（未加载=石/15/0）。
  function buildChunkArrays(cx, cz) {
    if (!planetMode || coreChunk(cx, cz)) return null;
    var ch = extra[key(cx, cz)];
    return ch && ch.ready ? {
      blocks: ch.blocks, sky: ch.sky, blk: ch.blk,
      sectioned: true, contentTop: ch.contentTop
    } : null;
  }

  function buildCoreArrays() {
    if (!FiniteWorld.coreArrays) return null;
    var ca = FiniteWorld.coreArrays();
    if (ca) ca.overlay = coreBlkOverlay;   // 外围火把跨入核心的附加块光
    return ca;
  }

  // ---- 时间预算流式调度器（P1）----
  // 以毫秒预算取代旧的固定每帧步数：在预算内交替做"核心重网格 / 外围网格 /
  // 外围生成"各一步，全部队列排空即提前返回。单步成本超支时最坏帧
  // = 预算 + 单个最大步骤，不再出现固定 2~6 步叠加的长尾卡顿。
  function stream(budgetMs, scene) {
    budgetMs = Math.max(1, +budgetMs || 4);
    drainPendingRelight(Math.min(4, Math.max(1, budgetMs * 0.35)));
    pumpWorkerResults();
    if (!FiniteWorld.isReady()) {
      var t00 = perfNow();
      do { FiniteWorld.generateNext(2); }
      while (!FiniteWorld.isReady() && perfNow() - t00 < budgetMs);
      if (FiniteWorld.isReady()) {
        focus.cx = floorDiv(focus.x, CS); focus.cz = floorDiv(focus.z, CS);
        refreshStreaming();
      }
      return 0;
    }
    var t0 = perfNow(), built = 0;
    var canMesh = !!Voxel.MeshBuilder &&
      (!Voxel.MeshBuilder._test || Voxel.MeshBuilder._test.ready === undefined || Voxel.MeshBuilder._test.ready());
    // 轮转调度：生成 / 核心网格 / 外围网格交替执行。若固定先做某类步骤，
    // 当其开销吃满预算时其余管线会被无限饿死（如核心重网格积压时永不生成）。
    var phase = 0, m1 = 0, m2 = 0, g1 = 0, l1 = 0, emptyRounds = 0;
    for (;;) {
      var elapsed = perfNow() - t0;
      if (elapsed >= budgetMs) break;
      var step = 0;
      switch (phase % 4) {
        case 0: g1 = pumpGeneration(1) || 0; step = g1; break;
        case 1: l1 = drainPendingRelight(Math.min(2, budgetMs - elapsed)) || 0; step = l1; break;
        case 2: m1 = canMesh ? (FiniteWorld.buildMeshes(1, scene) || 0) : 0; step = m1; break;
        default:
          m2 = canMesh ? (buildExtraMeshes(1, scene) || 0) : 0;
          if (!m2 && canMesh) m2 = buildFarMeshes(1, scene) || 0;
          step = m2;
          break;
      }
      phase++;
      if (!step) {   // 该类队列为空：立即轮转到下一类；四类全空则结束
        if (++emptyRounds >= 4) break;
        continue;
      }
      emptyRounds = 0;
      built += step;
    }
    return built;
  }

  function clearMeshes(scene) {
    FiniteWorld.clearMeshes(scene);
    for (var k in extra) disposeChunkMesh(extra[k]);
    for (var fk in farMeshes) disposeFarMesh(fk);
    if (extraGroup && extraGroup.parent) extraGroup.parent.remove(extraGroup);
    if (farGroup && farGroup.parent) farGroup.parent.remove(farGroup);
    extraGroup = null; farGroup = null; extraScene = null;
    farQueue = []; farMeshes = Object.create(null);
  }

  function isChunkLoaded(cx, cz) {
    cx = Math.floor(+cx); cz = Math.floor(+cz);
    if (coreChunk(cx, cz)) return FiniteWorld.isReady();
    return !!(planetMode && extra[key(cx, cz)] && extra[key(cx, cz)].ready);
  }

  function focusMeshed() {
    if (!planetMode || inCore(Math.floor(focus.x), Math.floor(focus.z))) return FiniteWorld.focusMeshed();
    var cx = floorDiv(focus.x, CS), cz = floorDiv(focus.z, CS);
    for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
      if (coreChunk(cx + dx, cz + dz)) continue;
      var ch = extra[key(cx + dx, cz + dz)];
      if (!ch || !ch.ready || !ch.meshed) return false;
    }
    return true;
  }

  function streamStats() {
    var loaded = 0, meshed = 0;
    for (var k in extra) { loaded++; if (extra[k].meshed) meshed++; }
    return {
      loaded: loaded, queued: genQueue.length, meshed: meshed,
      renderRadius: RENDER_RADIUS, dataRadius: DATA_RADIUS, keepRadius: KEEP_RADIUS,
      lodFarRadius: LOD_FAR_RADIUS, farQueued: farQueue.length, farMeshed: Object.keys(farMeshes).length,
      // loaded/meshed 只统计外围稀疏区块；legacy core 的 64 个固定区块不计入。
      coreChunks: CORE_CX * CORE_CZ, planet: planetMode
    };
  }

  function initLight() {
    FiniteWorld.initLight();
    if (!planetMode) return;
    // 极少数调用顺序可能先生成外围、后初始化核心光照；补做接缝导入。
    var targets = Object.create(null);
    for (var k in extra) {
      var ch = extra[k];
      if (ch.ready && adjacentToCore(ch.cx, ch.cz)) addLightTarget(targets, ch.cx, ch.cz);
    }
    recomputeBlockLightBatch(targets, true);
  }

  var InfiniteWorld = {
    __infiniteFacade: true,
    init: init,
    generateNext: generateNext,
    progress: function () { return FiniteWorld.progress(); },
    isReady: function () { return FiniteWorld.isReady(); },
    centerMeshed: function () { return FiniteWorld.centerMeshed(); },
    setFocus: setFocus,
    setRenderRadius: setRenderRadius,
    renderRadius: function () { return RENDER_RADIUS; },
    lodFarRadius: function () { return LOD_FAR_RADIUS; },
    fogHorizon: function () { return LOD_FAR_RADIUS * CS; },
    focusMeshed: focusMeshed,
    meshCount: function () { return FiniteWorld.meshCount() + (extraGroup ? extraGroup.children.length : 0); },
    buildMeshes: buildMeshes,
    stream: stream,
    buildChunkArrays: buildChunkArrays,
    buildCoreArrays: buildCoreArrays,
    clearMeshes: clearMeshes,
    markChunkDirty: markChunkDirty,
    get: get,
    set: set,
    applyInfrastructure: applyInfrastructure,
    surfaceAt: surfaceAt,
    biomeAt: biomeAt,
    // 纯气候最近邻探针（不触发任何区块生成）；空间站/未就绪时回退有限核心。
    climateAt: function (x, z) {
      x = Math.floor(x); z = Math.floor(z);
      if (gen && gen.climateAt) return gen.climateAt(x + 0.5, z + 0.5);
      return FiniteWorld.climateAt ? FiniteWorld.climateAt(x, z) : null;
    },
    // 零成本地表预测：外围与核心共用同一噪声流，直接委托有限核心。
    predictedHeightAt: function (x, z) {
      x = Math.floor(x); z = Math.floor(z);
      return FiniteWorld.predictedHeightAt ? FiniteWorld.predictedHeightAt(x, z) : -1;
    },
    spawnPoint: function () { return FiniteWorld.spawnPoint(); },
    applyEdits: applyEdits,
    initLight: initLight,
    lightReady: function () { return FiniteWorld.lightReady(); },
    getSky: getSky,
    getBlk: getBlk,
    getEdits: getEdits,
    isEdited: isEdited,
    getMeta: function (x, y, z) { return FiniteWorld.getMeta(x, y, z); },
    setMeta: function (x, y, z, m) { FiniteWorld.setMeta(x, y, z, m); },
    getAllMeta: function () { return FiniteWorld.getAllMeta(); },
    applyMeta: function (md) { FiniteWorld.applyMeta(md); },
    getSeed: function () { return FiniteWorld.getSeed(); },
    getProfile: function () { return FiniteWorld.getProfile(); },
    size: function () {
      var s = FiniteWorld.size();
      s.infiniteXZ = planetMode;
      s.chunk = CS;
      return s;
    },
    ensureChunk: ensureChunk,
    isChunkLoaded: isChunkLoaded,
    streamStats: streamStats,
    _test: {
      floorDiv: function (n) { return floorDiv(n, CS); },
      localCoord: function (n) { return localCoord(n, CS); },
      unloadOutside: unloadOutside,
      finiteWorld: FiniteWorld,
      chunk: function (cx, cz) { return extra[key(cx, cz)] || null; },
      gen: function () { return gen; },
      voxelBytes: function () {
        var extraB = 0, n = 0;
        for (var k in extra) {
          var ch = extra[k];
          extraB += Voxel.Sections.estimateBytes(ch.blocks, CS, H, CS, 2);
          extraB += Voxel.Sections.estimateBytes(ch.sky, CS, H, CS, 1);
          extraB += Voxel.Sections.estimateBytes(ch.blk, CS, H, CS, 1);
          n++;
        }
        var core = FiniteWorld.voxelBytes ? FiniteWorld.voxelBytes() : { total: 0 };
        return { extraChunks: n, extraBytes: extraB, core: core, total: extraB + (core.total || 0) };
      },
      workerStats: function () {
        return {
          active: wcActive(), failed: wcFailed,
          inflight: wcInflight, queued: wcQueue.length,
          epoch: wcEpoch
        };
      },
      flushLight: flushPendingLight,
      pendingRelight: function () { return pendingRelight.length; }
    }
  };

  Voxel.FiniteWorld = FiniteWorld;
  Voxel.InfiniteWorld = InfiniteWorld;
  Voxel.World = InfiniteWorld;
})();
