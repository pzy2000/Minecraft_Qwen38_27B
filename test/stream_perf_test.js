// 流式加载性能改造回归测试：node test/stream_perf_test.js
//
// 覆盖：
// 1. 外围区块生成指纹与历史基线一致（GenCore 抽取/Worker 化不改变世界）；
// 2. MeshBuilder 填充式采样（pad）与全局门面 get/getSky/getBlk 语义逐位等价；
// 3. stream() 时间预算调度器能排空队列，且单帧消耗受预算约束；
// 4. 卸载触发的延迟重光最终收敛（火把光跨缝正确点亮/熄灭）。
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
function load(rel) {
  var code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

var sandbox = {
  window: {},
  console: console,
  Math: Math,
  BigInt: BigInt,
  Uint8Array: Uint8Array,
  Uint16Array: Uint16Array,
  Uint32Array: Uint32Array,
  Int16Array: Int16Array,
  Float32Array: Float32Array,
  performance: { now: function () { return Date.now(); } },
  THREE: {
    Vector3: function (x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; },
    Group: function () { this.children = []; this.parent = null; }
  }
};
sandbox.THREE.Group.prototype.add = function (o) { this.children.push(o); o.parent = this; };
sandbox.THREE.Group.prototype.remove = function (o) {
  var i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1);
  if (o) o.parent = null;
};
sandbox.window = sandbox;
var _store = {};
sandbox.localStorage = {
  setItem: function (k, v) { _store[k] = String(v); },
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null; },
  removeItem: function (k) { delete _store[k]; }
};
vm.createContext(sandbox);

load('js/config.js');
load('js/world/seed.js');
load('js/world/universe.js');
load('js/world/galaxy.js');
load('js/systems/atmosphere_profiles.js');
load('js/world/noise.js');
load('js/world/biomes.js');
load('js/world/planet_rules.js');
load('js/world/shaper.js');
load('js/world/structures.js');
load('js/world/sections.js');
load('js/world/gen_core.js');
load('js/blocks.js');
load('js/systems/discovery.js');
load('js/crafting.js');
load('js/world/world.js');
load('js/world/light.js');
load('js/world/infinite.js');
load('js/world/mesh.js');

var V = sandbox.window.Voxel;
var failed = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  ' + name);
  else { console.log('  FAIL ' + name + (detail !== undefined ? ' :: ' + detail : '')); failed++; }
}

// 历史指纹基线（种子 12345）：blocks+biome FNV-1a
// 第 22 轮群系扩展与第 23 轮气候降频（群系面积 ~9x）+ 树形加高均会
// 移动自然地形，指纹随接受的变化整体刷新。
var FP_BASELINE = {
  '8,0': 'd333ca51',     // 核心右邻接缝
  '30,30': '42ff9e2f',    // 远外围
  '60,-25': 'd15af3fd',  // 远外围负坐标
  '-2,5': 'dd806251'     // 核心左侧负坐标
};

console.log('流式加载回归');
V.World.init(12345);
while (!V.World.isReady()) V.World.generateNext(64);

function fingerprint(cx, cz) {
  V.World.ensureChunk(cx, cz);
  var CS = V.Config.CHUNK, H = V.Config.WORLD_H;
  // 地形一致性契约：FP_BASELINE 生成于旧限高 H=64，哈希域钉住旧内容域
  // （限高提升新增的空气行不得参与摘要）。
  var FP_DOMAIN_H = Math.min(64, H);
  var h = 2166136261 >>> 0;
  var x0 = cx * CS, z0 = cz * CS;
  for (var z = z0; z < z0 + CS; z++)
    for (var y = 0; y < FP_DOMAIN_H; y++)
      for (var x = x0; x < x0 + CS; x++)
        h = Math.imul((h ^ V.World.get(x, y, z)) >>> 0, 16777619) >>> 0;
  for (var z2 = z0; z2 < z0 + CS; z2++)
    for (var x2 = x0; x2 < x0 + CS; x2++)
      h = Math.imul((h ^ (V.World.biomeAt(x2, z2) + 1)) >>> 0, 16777619) >>> 0;
  return h.toString(16);
}
for (var fk in FP_BASELINE) {
  if (!Object.prototype.hasOwnProperty.call(FP_BASELINE, fk)) continue;
  var fp = fk.split(',');
  var actual = fingerprint(+fp[0], +fp[1]);
  check('区块 (' + fk + ') 指纹与基线一致', actual === FP_BASELINE[fk], actual);
}

console.log('填充式采样与门面语义等价');
(function () {
  var MB = V.MeshBuilder;
  if (!MB || !MB._test || !V.World.buildChunkArrays) { check('MeshBuilder 测试钩子可用', false); return; }
  var CS = V.Config.CHUNK, H = V.Config.WORLD_H;

  function verifyRegion(label, cx, cz, ensureNeighbors) {
    if (ensureNeighbors) {
      for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
        try { V.World.ensureChunk(cx + dx, cz + dz); } catch (e) { }
      }
    }
    MB._test.fillPad(cx, cz);
    var x0 = cx * CS, z0 = cz * CS;
    var bad = 0, n = 0;
    for (var lx = -1; lx <= CS; lx += 3) for (var lz = -1; lz <= CS; lz += 3) {
      var wx = x0 + lx, wz = z0 + lz;
      // wy 覆盖 -1/H 两个哨兵行（游戏内采样的真实边界），不越界到 H+1
      for (var wy = -1; wy <= H; wy += 7) {
        var got = MB._test.sample(wx, wy, wz);
        if (got.b !== V.World.get(wx, wy, wz)) bad++;
        if (got.s !== V.World.getSky(wx, wy, wz)) bad++;
        if (got.p !== V.World.getBlk(wx, wy, wz)) bad++;
        n += 3;
      }
    }
    check(label + ' 采样等价 (' + n + ' 点, mismatch=' + bad + ')', bad === 0);
  }

  verifyRegion('外围区块', 30, 30, true);
  verifyRegion('legacy 核心', 3, 5, false);
  verifyRegion('核心/外围接缝', 7, 4, true);
})();

console.log('stream() 预算调度');
(function () {
  function CS0() { return V.Config.CHUNK; }
  var onCI = !!(process.env.CI || process.env.GITHUB_ACTIONS);

  // 同步回退：decorate 仍在主线程，最坏步是结构装饰而非光照。
  // 5.3 把 relight/3×3 移出此步后仍受 decorate 约束，只防无界回归。
  V.World.init(12345);
  while (!V.World.isReady()) V.World.generateNext(64);
  V.World.setFocus(40 * CS0() + 16, -25 * CS0() + 16);
  var guard = 0, st = V.World.streamStats();
  var worstSync = 0;
  while (st.queued > 0 && guard++ < 400) {
    var t0 = Date.now();
    V.World.stream(12, null);
    var dt = Date.now() - t0;
    if (dt > worstSync) worstSync = dt;
    st = V.World.streamStats();
  }
  check('同步路径可排空生成队列 (queued=' + st.queued + ')', st.queued === 0);
  // decorate 仍在主线程，单步可达百毫秒级；此处只防无界（卡死/分钟级）。
  // 5.3 的 20ms 门禁在下方 Worker 路径：主线程不再做 decorate/列天光。
  check('同步路径 stream 非无界 (worst=' + worstSync + 'ms <= 800ms)', worstSync <= 800);
})();

async function main() {
  function CS0() { return V.Config.CHUNK; }
  var onCI = !!(process.env.CI || process.env.GITHUB_ACTIONS);
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  console.log('Worker 路径主线程预算（plan 5.3）');
  var fakeGen = null;
  function FakeWorker() {
    var self2 = this;
    this.onmessage = null;
    this.onerror = null;
    this.postMessage = function (m) {
      setTimeout(function () {
        try {
          if (m.type === 'init') {
            fakeGen = V.GenCore.create({ seed: m.seed, profile: m.profile });
            var pm = !m.profile || m.profile.kind !== 'station';
            if (V.Structures) V.Structures.bind(pm && fakeGen.terrainVersion === 2 ? {
              hash2: fakeGen.noise.hash2, surfaceAt: fakeGen.surfaceAt,
              biomeAt: fakeGen.biomeAt, typeKey: fakeGen.planetTypeKey,
              version: fakeGen.terrainVersion
            } : null);
            deliver({ type: 'ready', epoch: m.epoch });
          } else if (m.type === 'job') {
            var sh = fakeGen.ensureShell(m.cx, m.cz);
            fakeGen.decorate(sh);
            var CS = V.Config.CHUNK, H = V.Config.WORLD_H;
            var flat = V.Sections.asFlat(sh.blocks, CS, H, CS);
            var top = Math.min(H - 1, V.Config.CONTENT_NATURAL_TOP || H - 1);
            var skyStore = V.Sections.create(CS, H, CS, 1);
            var blkStore = V.Sections.create(CS, H, CS, 1);
            var lit = V.Light.scanColumnSky(sh.blocks, skyStore, blkStore, top);
            V.Light.floodIntra(sh.blocks, blkStore, lit.buckets);
            if (skyStore.compact) skyStore.compact();
            if (blkStore.compact) blkStore.compact();
            deliver({
              type: 'chunk', epoch: m.epoch, jobId: m.jobId, cx: m.cx, cz: m.cz,
              blocks: flat.slice().buffer,
              heights: sh.heights.slice().buffer,
              biomes: sh.biomes.slice().buffer,
              sky: V.Sections.asFlat(skyStore, CS, H, CS).slice().buffer,
              blk: V.Sections.asFlat(blkStore, CS, H, CS).slice().buffer,
              emit: new Int32Array(lit.emit).buffer
            });
          }
        } catch (e) { if (self2.onerror) self2.onerror({ message: String(e) }); }
      }, 0);
    };
    function deliver(msg) {
      setTimeout(function () { if (self2.onmessage) self2.onmessage({ data: msg }); }, 0);
    }
    this.terminate = function () {};
  }
  sandbox.Worker = FakeWorker;
  V.World.init(12345);
  while (!V.World.isReady()) V.World.generateNext(64);
  V.World.setFocus(40 * CS0() + 16, -25 * CS0() + 16);
  var g2 = 0, st2 = V.World.streamStats(), worstW = 0;
  while ((st2.queued > 0 || V.World._test.workerStats().inflight > 0 ||
    V.World._test.workerStats().queued > 0) && g2++ < 800) {
    var t1 = Date.now();
    V.World.stream(12, null);
    var d1 = Date.now() - t1;
    if (d1 > worstW) worstW = d1;
    await sleep(0);
    st2 = V.World.streamStats();
  }
  check('Worker 路径可排空 (queued=' + st2.queued + ')', st2.queued === 0);
  var W_LIMIT = onCI ? 60 : 20;
  check('Worker 路径主线程 stream ≤ ' + W_LIMIT + 'ms (worst=' + worstW + 'ms)', worstW <= W_LIMIT);

  console.log('卸载→重载与延迟重光收敛');
  var IT = V.World._test;
  var lx = 380, lz = -250, ly = 40;
  V.World.ensureChunk(11, -8);
  if (IT.flushLight) IT.flushLight();
  V.World.set(lx, ly, lz, 19);
  var litBefore = V.World.getBlk(lx + 1, ly, lz);
  IT.unloadOutside(0, 0, 0);
  check('区块已卸载', !V.World.isChunkLoaded(11, -8));
  V.World.ensureChunk(11, -8);
  if (IT.flushLight) IT.flushLight();
  check('edit 在卸载→重载后保留', V.World.get(lx, ly, lz) === 19);
  for (var i = 0; i < 40; i++) { V.World.stream(50, null); await sleep(0); }
  if (IT.flushLight) IT.flushLight();
  check('延迟重光后跨格光照恢复 (before=' + litBefore + ')',
    litBefore > 0 && V.World.getBlk(lx + 1, ly, lz) === litBefore);
  V.World.set(lx, ly, lz, 0);
  for (var j = 0; j < 40; j++) { V.World.stream(50, null); await sleep(0); }
  if (IT.flushLight) IT.flushLight();
  check('移除火把并排空后光熄灭', V.World.getBlk(lx + 1, ly, lz) === 0);

  console.log(failed ? ('STREAM-PERF-FAIL (' + failed + ')') : 'STREAM-PERF-PASS');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
