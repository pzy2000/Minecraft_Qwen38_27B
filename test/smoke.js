// 无浏览器冒烟测试：node test/smoke.js
// 验证：噪声、地形生成、确定性、树/水/矿、修改与存档还原
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
  Uint8Array: Uint8Array,
  Int16Array: Int16Array,
  THREE: {
    Vector3: function (x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

var failed = 0;
function check(name, cond) {
  if (cond) console.log('  ok  ' + name);
  else { console.log('  FAIL ' + name); failed++; }
}

load('js/config.js');
load('js/world/noise.js');
load('js/blocks.js');
load('js/world/world.js');

var V = sandbox.window.Voxel;
var W = V.Config.WORLD_W, H = V.Config.WORLD_H, D = V.Config.WORLD_D;

console.log('噪声测试');
var noise = V.Noise.create(42);
var a = noise.fbm2(10, 10, 3), b = noise.fbm2(10, 10, 3);
check('fbm2 确定性', a === b);
check('fbm2 范围 [0,1)', a >= 0 && a < 1);
check('n3 范围 [0,1)', noise.n3(3.3, 5.5, 7.7) >= 0 && noise.n3(3.3, 5.5, 7.7) < 1);

console.log('世界生成 (种子 12345)');
V.World.init(12345);
var t0 = Date.now();
while (!V.World.isReady()) V.World.generateNext(64);
console.log('  生成耗时 ' + (Date.now() - t0) + 'ms');
check('世界已就绪', V.World.isReady());

var counts = {};
var water = 0, tree = 0, coal = 0, iron = 0, cave = 0;
var minH = 999, maxH = 0;
for (var x = 0; x < W; x += 4)
  for (var z = 0; z < D; z += 4) {
    for (var y = 0; y < H; y++) {
      var id = V.World.get(x, y, z);
      counts[id] = (counts[id] || 0) + 1;
      if (id === 7) water++;
      if (id === 4) tree++;
      if (id === 8) coal++;
      if (id === 9) iron++;
      if (id === 0 && y < 40 && y > 2) cave++;
    }
    var s = V.World.surfaceAt(x, z);
    if (s > 0) { if (s < minH) minH = s; if (s > maxH) maxH = s; }
  }
check('有基岩', (counts[12] || 0) > 0);
check('有石头', (counts[3] || 0) > 100);
check('有草方块', (counts[1] || 0) > 100);
check('有水面', water > 100);
check('有树木', tree > 20);
check('有洞穴', cave > 50);
check('高度范围合理', minH >= 4 && maxH <= H - 8);
check('出生点在地表', V.World.surfaceAt(W >> 1, D >> 1) > 5);
check('边界外为实体(防跌落)', V.World.get(-1, 30, 10) === 12 && V.World.get(W, 30, 10) === 12);

console.log('确定性');
V.World.init(12345);
while (!V.World.isReady()) V.World.generateNext(64);
var same = true;
for (var x2 = 0; x2 < W; x2 += 7)
  for (var z2 = 0; z2 < D; z2 += 7)
    if (V.World.surfaceAt(x2, z2) !== V.World.surfaceAt(x2, z2)) same = false;
// 与第一次比较：重新生成两次比较
var h1 = [];
V.World.init(999);
while (!V.World.isReady()) V.World.generateNext(64);
for (var x3 = 0; x3 < W; x3 += 5) h1.push(V.World.surfaceAt(x3, 3));
V.World.init(999);
while (!V.World.isReady()) V.World.generateNext(64);
var h2 = [];
for (var x4 = 0; x4 < W; x4 += 5) h2.push(V.World.surfaceAt(x4, 3));
check('同种子地形一致', same && h1.join() === h2.join());

console.log('修改与存档还原');
V.World.init(12345);
while (!V.World.isReady()) V.World.generateNext(64);
var sp = V.World.spawnPoint();
var bx = Math.floor(sp.x), by = Math.floor(sp.y), bz = Math.floor(sp.z);
var before = V.World.get(bx, by, bz);
V.World.set(bx, by, bz, 10);
check('set 生效', V.World.get(bx, by, bz) === 10);
var edits = V.World.getEdits();
check('edits 已记录', edits[bx + ',' + by + ',' + bz] === 10);
check('edits 数量少(仅增量)', Object.keys(edits).length <= 10);

V.World.init(12345);
while (!V.World.isReady()) V.World.generateNext(64);
check('还原前为原值', V.World.get(bx, by, bz) === before);
V.World.applyEdits(edits);
check('applyEdits 还原', V.World.get(bx, by, bz) === 10);

console.log(failed === 0 ? '\n全部通过 ✓' : '\n' + failed + ' 项失败 ✗');
process.exit(failed === 0 ? 0 : 1);
