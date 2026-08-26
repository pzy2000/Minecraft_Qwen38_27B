// Worker 流水线活锁回归测试：node test/stream_worker_test.js
//
// 背景：Worker 路径曾带“就绪前等待邻居装饰”的门控。配合生成队列的
// 最近优先排序，队头区块会以其最小 d 值反复重排，把它等待的（更远的）
// 邻居永久压在身后——真实浏览器的 Worker 高响应延迟下 100% 复现的活锁。
// 修复后：Worker 产物已含装饰，就绪阶段不再等待邻居。
//
// 本测试用带固定延迟的 FakeWorker（模拟真实浏览器低配环境的高延迟），
// 断言队列最终排空、所有 wanted 区块安装并进入就绪状态。
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
}

var sandbox = {
  window: {}, console, Math, BigInt,
  Uint8Array, Uint32Array, Int16Array, Float32Array,
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

['js/config.js', 'js/world/seed.js', 'js/world/universe.js', 'js/world/galaxy.js',
 'js/systems/atmosphere_profiles.js', 'js/world/noise.js', 'js/world/biomes.js',
 'js/world/planet_rules.js', 'js/world/shaper.js', 'js/world/structures.js',
 'js/world/gen_core.js', 'js/blocks.js', 'js/systems/discovery.js', 'js/crafting.js',
 'js/world/world.js', 'js/world/infinite.js'].forEach(load);

var V = sandbox.window.Voxel;

// ---- FakeWorker：与 js/world/gen_worker.js 相同的协议与实现，
//      但注入 30ms 计算 + 50ms 传输延迟模拟低配环境高响应延迟 ----
var fakeGen = null;
function FakeWorker(url) {
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
          deliver({
            type: 'chunk', epoch: m.epoch, jobId: m.jobId, cx: m.cx, cz: m.cz,
            blocks: sh.blocks.slice().buffer,
            heights: sh.heights.slice().buffer,
            biomes: sh.biomes.slice().buffer
          });
        }
      } catch (e) { if (self2.onerror) self2.onerror({ message: String(e) }); }
    }, 30);
  };
  function deliver(msg) {
    setTimeout(function () { if (self2.onmessage) self2.onmessage({ data: msg }); }, 50);
  }
}
sandbox.Worker = FakeWorker;

var failed = 0;
function check(name, cond) {
  if (cond) console.log('  ok  ' + name);
  else { console.log('  FAIL ' + name); failed++; }
}

async function main() {
  console.log('Worker 流水线（慢速响应）');
  V.World.init(12345);
  while (!V.World.isReady()) V.World.generateNext(64);
  var sp = V.World.spawnPoint();
  V.World.setFocus(sp.x, sp.z);

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  // 以游戏帧拍子驱动 15 秒量级的流式加载
  for (var f = 0; f < 400; f++) { V.World.stream(6, null); await sleep(16); }
  var st = V.World.streamStats();
  var ws = V.World._test.workerStats();
  check('中期检查：worker 在途/排队有界 (wq=' + ws.queued + ', wi=' + ws.inflight + ')',
    ws.inflight >= 0 && ws.inflight <= 4);
  for (var f2 = 0; f2 < 900; f2++) { V.World.stream(6, null); await sleep(8); }
  st = V.World.streamStats();
  ws = V.World._test.workerStats();

  check('生成队列排空 (genQ=' + st.queued + ')', st.queued === 0);
  check('worker 队列清空 (wq=' + ws.queued + ')', ws.queued === 0);
  check('worker 在途清空 (wi=' + ws.inflight + ')', ws.inflight === 0);
  // DATA 半径 6 的 13×13 盒子去核心后的外圈总量正好是 105
  check('wanted 外圈全部装载 (loaded=' + st.loaded + ' == 105)', st.loaded === 105);
  // 就绪数量：DATA 盒 13×13=169 格，核心 [0,7]² 的 64 格不属 extra；
  // 外圈 105 个 extra 区块应全部进入 ready
  var boxReady = 0, boxExtra = 0;
  (function () {
    var IT = V.World._test;
    var ccx = Math.floor(sp.x / 32), ccz = Math.floor(sp.z / 32);
    for (var dx = -6; dx <= 6; dx++) for (var dz = -6; dz <= 6; dz++) {
      var ch = IT.chunk(ccx + dx, ccz + dz);
      if (!ch) continue;   // 核心区块不在 extra 中
      boxExtra++;
      if (ch.ready) boxReady++;
    }
  })();
  check('wanted 外圈全部装载并就绪 (ready=' + boxReady + '/' + boxExtra + ')',
    boxExtra === 105 && boxReady === 105);

  console.log(failed ? 'STREAM-WORKER-FAIL (' + failed + ')' : 'STREAM-WORKER-PASS');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
