// 无浏览器冒烟测试：node test/smoke.js
// 验证：64位种子、Perlin 噪声、样条塑造、3D 密度场地形生成、确定性、
//       群系多样性与特征方块、修改还原、存档序列化往返（含堆叠/床/天气字段）、合成配方匹配、光照
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
  Uint32Array: Uint32Array,
  Int16Array: Int16Array,
  Float32Array: Float32Array,
  THREE: {
    Vector3: function (x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  }
};
sandbox.window = sandbox;

// localStorage mock（供 systems/save.js 使用）
var _store = {};
sandbox.localStorage = {
  setItem: function (k, v) { _store[k] = String(v); },
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null; },
  removeItem: function (k) { delete _store[k]; }
};
vm.createContext(sandbox);

var failed = 0;
function check(name, cond) {
  if (cond) console.log('  ok  ' + name);
  else { console.log('  FAIL ' + name); failed++; }
}

load('js/config.js');
load('js/world/seed.js');
load('js/world/galaxy.js');
load('js/world/noise.js');
load('js/world/biomes.js');
load('js/world/shaper.js');
load('js/blocks.js');
load('js/crafting.js');
load('js/world/world.js');
load('js/world/infinite.js');
load('js/systems/save.js');
load('js/systems/furnace.js');
load('js/systems/settings.js');

var V = sandbox.window.Voxel;
var W = V.Config.WORLD_W, H = V.Config.WORLD_H, D = V.Config.WORLD_D;

console.log('种子工具测试');
var SU = V.SeedUtil;
check('数字种子解析', SU.toString(SU.parse('12345')) === '12345');
check('负数种子解析', SU.toString(SU.parse('-12345')) === '-12345');
check('long 最小值', SU.toString(SU.parse('-9223372036854775808')) === '-9223372036854775808');
check('long 最大值', SU.toString(SU.parse('9223372036854775807')) === '9223372036854775807');
// 超出 long 范围：按 MC 规则退化为文本哈希（Java String.hashCode）
(function () {
  var s = '9223372036854775808';
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  var expected = BigInt.asIntN(32, BigInt(h)).toString(); // 带符号十进制（toString 规范）
  check('超范围数字退化为文本哈希', SU.toString(SU.parse(s)) === expected);
})();
check('文本种子确定性', SU.toString(SU.parse('herobrine')) === SU.toString(SU.parse(' herobrine '.trim())));
check('文本种子=Java hashCode 符号扩展', (function () {
  var b = SU.toBigInt(SU.parse('abc'));
  var jh = 96354; // Java: "abc".hashCode() == 96354
  return b === BigInt.asUintN(64, BigInt.asIntN(32, BigInt(jh)));
})());
check('空输入产生随机种子', typeof SU.toString(SU.parse(null)) === 'string');
check('derive32 确定性', SU.derive32(12345n, 1) === SU.derive32(12345n, 1));
check('不同盐值流互异', SU.derive32(12345n, 1) !== SU.derive32(12345n, 2));
check('不同种子流互异', SU.derive32(1n, 1) !== SU.derive32(2n, 1));

console.log('星系生成与航行规则');
var GA = V.Galaxy;
var galA = GA.create('star-ocean-42');
var galB = GA.create('star-ocean-42');
var galC = GA.create('star-ocean-43');
check('同星系种子目录完全确定', JSON.stringify(galA.catalog) === JSON.stringify(galB.catalog));
check('不同星系种子目录不同', JSON.stringify(galA.catalog) !== JSON.stringify(galC.catalog));
check('目录含 6 颗行星和 1 座空间站', galA.catalog.filter(function (w) { return w.kind === 'planet'; }).length === 6 &&
  galA.catalog.filter(function (w) { return w.kind === 'station'; }).length === 1);
check('每个天体的独立种子唯一', new Set(galA.catalog.map(function (w) { return w.seed; })).size === 7);
check('首颗行星适合开局', galA.catalog[0].typeKey === 'lush');
check('单星系完整覆盖六类行星', new Set(galA.catalog.filter(function (w) { return w.kind === 'planet'; }).map(function (w) { return w.typeKey; })).size === 6);
var gatesA = GA.portalsFor(galA, galA.catalog[0]);
check('行星稳定生成 3-4 扇传送门', gatesA.length >= 3 && gatesA.length <= 4 &&
  JSON.stringify(gatesA) === JSON.stringify(GA.portalsFor(galA, galA.catalog[0])));
check('行星至少一扇门通往空间站', gatesA.some(function (p) { return p.destinationId === 'station-0'; }));
check('跃迁成本有界且随距离计算', GA.fuelCost(galA.catalog[0], galA.catalog[5]) >= 8 &&
  GA.fuelCost(galA.catalog[0], galA.catalog[5]) <= 42);
var hydrated = GA.hydrate({ rootSeed: galA.rootSeed, currentId: 'planet-2', discovered: { 'planet-2': true }, ship: { fuel: 27, maxFuel: 100 }, worlds: { 'planet-0': { edits: { '1,2,3': 4 } } } }, galA.rootSeed);
check('星系状态可恢复', hydrated.currentId === 'planet-2' && hydrated.ship.fuel === 27 &&
  hydrated.worlds['planet-0'].edits['1,2,3'] === 4);
(function () {
  // 模拟 v4 → 首次载入 v5：main 会把旧世界种子固化到起始行星和迁移标记。
  var legacySeed = '12345';
  var migrated = GA.create(legacySeed);
  migrated.legacyStartSeed = legacySeed;
  GA.find(migrated, 'planet-0').seed = legacySeed;
  var secondLoad = GA.hydrate(JSON.parse(JSON.stringify(migrated)), legacySeed);
  check('旧存档两跳迁移后仍使用原世界种子',
    secondLoad.legacyStartSeed === legacySeed && GA.find(secondLoad, 'planet-0').seed === legacySeed);

  // 兼容修复上线前已保存过一次的 v5：当时 catalog 有覆写种子但没有显式标记。
  var oldMigrated = GA.create(legacySeed);
  GA.find(oldMigrated, 'planet-0').seed = legacySeed;
  var recovered = GA.hydrate(JSON.parse(JSON.stringify(oldMigrated)), legacySeed);
  check('无迁移标记的既有 v5 存档可恢复旧底图',
    recovered.legacyStartSeed === legacySeed && GA.find(recovered, 'planet-0').seed === legacySeed);
})();

console.log('噪声测试');
var noise = V.Noise.create(42);
var a = noise.fbm2(10, 10, 3), b = noise.fbm2(10, 10, 3);
check('fbm2 确定性', a === b);
check('fbm2 范围 [0,1)', a >= 0 && a < 1);
check('n3 范围 [0,1)', noise.n3(3.3, 5.5, 7.7) >= 0 && noise.n3(3.3, 5.5, 7.7) < 1);
var chA = noise.channel(V.Noise.SALT.TERRAIN, 4);
check('通道输出 [-1,1]', chA.at2(12.3, 45.6) >= -1 && chA.at2(12.3, 45.6) <= 1);
check('通道确定性', chA.at2(1, 2) === chA.at2(1, 2));
check('hash2 范围', noise.hash2(3, 9) >= 0 && noise.hash2(3, 9) < 1);
check('hash3 确定性', noise.hash3(1, 2, 3) === noise.hash3(1, 2, 3));

console.log('样条塑造测试');
check('spline 控制点精确', V.Shaper.spline([[-1, -20], [1, 20]], -1) === -20 &&
  V.Shaper.spline([[-1, -20], [1, 20]], 1) === 20);
check('spline 中段单调', V.Shaper.spline([[-1, -20], [1, 20]], 0.5) > 0);

console.log('世界生成 (种子 12345)');
V.World.init(12345);
var t0 = Date.now();
while (!V.World.isReady()) V.World.generateNext(64);
console.log('  生成耗时 ' + (Date.now() - t0) + 'ms');
check('世界已就绪', V.World.isReady());
check('种子规范化为字符串', V.World.getSeed() === '12345');

var counts = {};
var water = 0, tree = 0, coal = 0, iron = 0, cave = 0;
var minH = 999, maxH = 0;
for (var x = 0; x < W; x += 4)
  for (var z = 0; z < D; z += 4) {
    for (var y = 0; y < H; y++) {
      var id = V.World.get(x, y, z);
      counts[id] = (counts[id] || 0) + 1;
      if (id === 7) water++;
      if (id === 4 || id === 20 || id === 22 || id === 33 || id === 35) tree++;
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
check('有煤矿', coal > 50);
check('有铁矿', iron > 20);
check('有洞穴', cave > 50);
check('高度范围合理', minH >= 2 && maxH <= H - 2);
console.log('  高度范围: ' + minH + ' ~ ' + maxH);
check('出生点在地表', V.World.surfaceAt(W >> 1, D >> 1) > 5);

console.log('无限世界区块与旧边界回归');
(function () {
  var CS = V.Config.CHUNK;
  var IT = V.World._test;
  check('无限世界测试接口齐全', !!IT && typeof IT.floorDiv === 'function' &&
    typeof IT.localCoord === 'function' && typeof IT.unloadOutside === 'function' &&
    typeof V.World.ensureChunk === 'function' && typeof V.World.isChunkLoaded === 'function' &&
    typeof V.World.streamStats === 'function');
  if (!IT || typeof V.World.ensureChunk !== 'function') return;

  // JS 的 |0 会向零截断，不能用来映射负坐标。特别覆盖两个负区块接缝。
  check('负坐标 floor chunk 映射(-1/-32/-33)',
    IT.floorDiv(-1) === -1 && IT.localCoord(-1) === CS - 1 &&
    IT.floorDiv(-32) === -1 && IT.localCoord(-32) === 0 &&
    IT.floorDiv(-33) === -2 && IT.localCoord(-33) === CS - 1 &&
    IT.floorDiv(0) === 0 && IT.localCoord(0) === 0 &&
    IT.floorDiv(32) === 1 && IT.localCoord(32) === 0);

  V.World.ensureChunk(8, 0);   // x=256..287：越过旧右边界
  V.World.ensureChunk(-1, 0);  // x=-32..-1
  V.World.ensureChunk(-2, 0);  // x=-64..-33
  check('旧 x=256 边界外区块已生成', V.World.isChunkLoaded(8, 0));
  check('负坐标区块 -1/-2 已生成', V.World.isChunkLoaded(-1, 0) && V.World.isChunkLoaded(-2, 0));

  function validSurface(x, z) {
    var y = V.World.surfaceAt(x, z);
    return y >= 2 && y < H && V.Blocks.isSolid(V.World.get(x, y, z));
  }
  function seamContinuous(a, b, z) {
    var ya = V.World.surfaceAt(a, z), yb = V.World.surfaceAt(b, z);
    // 程序化地形允许峭壁和树冠，但相邻列不应从真实地表跳到安全墙/虚空。
    return validSurface(a, z) && validSurface(b, z) && Math.abs(ya - yb) <= 20;
  }
  var seamZ = 10;
  check('越过 255→256 后仍是连续地形', seamContinuous(255, 256, seamZ) && validSurface(257, seamZ));
  check('负坐标 -1→0 接缝仍是连续地形', seamContinuous(-1, 0, seamZ));
  check('负区块 -33→-32 接缝仍是连续地形', seamContinuous(-33, -32, seamZ));

  function chunkFingerprint(cx, cz) {
    V.World.ensureChunk(cx, cz);
    var h = 2166136261 >>> 0;
    var x0 = cx * CS, z0 = cz * CS;
    for (var z = z0; z < z0 + CS; z++)
      for (var y = 0; y < H; y++)
        for (var x = x0; x < x0 + CS; x++)
          h = Math.imul((h ^ V.World.get(x, y, z)) >>> 0, 16777619) >>> 0;
    for (var z2 = z0; z2 < z0 + CS; z2++)
      for (var x2 = x0; x2 < x0 + CS; x2++)
        h = Math.imul((h ^ (V.World.biomeAt(x2, z2) + 1)) >>> 0, 16777619) >>> 0;
    return h.toString(16);
  }

  var order = [[8, 0], [-1, 0], [-2, 0]];
  var sigA = {};
  for (var oi = 0; oi < order.length; oi++)
    sigA[order[oi].join(',')] = chunkFingerprint(order[oi][0], order[oi][1]);

  // 同一种子以相反顺序请求外围区块，结果必须与请求/加载顺序无关。
  V.World.init(12345);
  while (!V.World.isReady()) V.World.generateNext(64);
  for (var ri = order.length - 1; ri >= 0; ri--) V.World.ensureChunk(order[ri][0], order[ri][1]);
  var deterministic = true;
  for (var di = 0; di < order.length; di++) {
    var dk = order[di].join(',');
    if (chunkFingerprint(order[di][0], order[di][1]) !== sigA[dk]) deterministic = false;
  }
  check('同 seed 外围区块与加载顺序无关', deterministic);

  // 火把放在两个外围区块的接缝：光必须跨 x=287/288 传播，移除后也必须跨界熄灭。
  // 使用世界顶层并先清空四格，排除天然洞穴、遮挡和其他光源造成的误判。
  V.World.ensureChunk(8, 0);
  V.World.ensureChunk(9, 0);
  var lightY = H - 1, lightZ = 10, lightRestore = [];
  for (var lightX = 286; lightX <= 289; lightX++) {
    lightRestore.push([lightX, V.World.get(lightX, lightY, lightZ)]);
    V.World.set(lightX, lightY, lightZ, 0);
  }
  V.World.set(287, lightY, lightZ, 19);
  check('区块接缝火把自身亮度=14', V.World.getBlk(287, lightY, lightZ) === 14);
  check('火把光跨 287→288 区块接缝传播', V.World.getBlk(288, lightY, lightZ) > 0);
  V.World.set(287, lightY, lightZ, 0);
  check('移除火把后跨区块邻格熄灭', V.World.getBlk(288, lightY, lightZ) === 0);
  for (var li = 0; li < lightRestore.length; li++)
    V.World.set(lightRestore[li][0], lightY, lightZ, lightRestore[li][1]);

  // legacy 256 核心与无限外围使用不同的数据/光照后端，接缝必须双向传播。
  // 核心沿用旧启动协议，必须先完成一次 initLight；外围区块则在 ensure 时已单独点亮。
  if (!V.World.lightReady()) V.World.initLight();
  var coreRestore = [];
  for (var coreX = 254; coreX <= 257; coreX++) {
    coreRestore.push([coreX, V.World.get(coreX, lightY, lightZ)]);
    V.World.set(coreX, lightY, lightZ, 0);
  }
  V.World.set(256, lightY, lightZ, 19);
  check('外围火把光跨 256→255 进入 legacy 核心',
    V.World.getBlk(256, lightY, lightZ) === 14 && V.World.getBlk(255, lightY, lightZ) > 0);
  V.World.set(256, lightY, lightZ, 0);
  check('移除外围火把后 legacy 核心接缝熄灭', V.World.getBlk(255, lightY, lightZ) === 0);
  V.World.set(255, lightY, lightZ, 19);
  check('legacy 核心火把光跨 255→256 进入外围',
    V.World.getBlk(255, lightY, lightZ) === 14 && V.World.getBlk(256, lightY, lightZ) > 0);
  V.World.set(255, lightY, lightZ, 0);
  check('移除核心火把后外围接缝熄灭', V.World.getBlk(256, lightY, lightZ) === 0);
  for (var ci = 0; ci < coreRestore.length; ci++)
    V.World.set(coreRestore[ci][0], lightY, lightZ, coreRestore[ci][1]);

  // 外围修改既要跨卸载/再加载保留，也要能通过 edits 在一次完整重载后恢复。
  var editX = 300, editZ = -17;
  var editCx = IT.floorDiv(editX), editCz = IT.floorDiv(editZ);
  V.World.ensureChunk(editCx, editCz);
  var editY = Math.max(3, Math.min(H - 2, V.World.surfaceAt(editX, editZ) + 1));
  var editId = V.World.get(editX, editY, editZ) === 10 ? 11 : 10;
  V.World.set(editX, editY, editZ, editId);
  var editKey = editX + ',' + editY + ',' + editZ;
  check('外围 set/get 与 edits 记账生效', V.World.get(editX, editY, editZ) === editId &&
    V.World.getEdits()[editKey] === editId);
  var savedOuterEdits = {};
  var allEdits = V.World.getEdits();
  for (var ek in allEdits)
    if (Object.prototype.hasOwnProperty.call(allEdits, ek)) savedOuterEdits[ek] = allEdits[ek];

  IT.unloadOutside(0, 0, 0);
  check('外围区块可卸载', !V.World.isChunkLoaded(editCx, editCz));
  V.World.ensureChunk(editCx, editCz);
  check('外围 edit 在卸载→重载后保留', V.World.get(editX, editY, editZ) === editId);

  V.World.init(12345);
  while (!V.World.isReady()) V.World.generateNext(64);
  V.World.applyEdits(savedOuterEdits);
  V.World.ensureChunk(editCx, editCz);
  check('外围 edit 在 init→applyEdits→按需生成后恢复', V.World.get(editX, editY, editZ) === editId &&
    V.World.getEdits()[editKey] === editId);

  function drainFocus(x, z) {
    V.World.setFocus(x, z);
    var guard = 0, st = V.World.streamStats();
    while (st.queued > 0 && guard++ < 100) {
      V.World.generateNext(64);
      st = V.World.streamStats();
    }
    return st;
  }
  // 单个焦点连同装饰 halo 会加载约 17×17 块；两次相隔很远的旅行若只加载不卸载，
  // 就会超过 19×19 的 keep 工作集上限，无需再生成第三套区块拖慢 CI。
  var far = CS * 128 + 0.5;
  var st1 = drainFocus(far, far);
  var st2 = drainFocus(-far, far);
  var cap = Math.pow(st2.keepRadius * 2 + 1, 2);
  check('远行流式队列可清空', st1.queued === 0 && st2.queued === 0);
  check('setFocus 远行后 loaded chunk 数量有界 (' + st2.loaded + '<=' + cap + ')',
    st2.loaded <= cap);
})();

console.log('确定性');
var same = true;
(function () {
  var first = [];
  for (var xx = 0; xx < W; xx += 5) first.push(V.World.surfaceAt(xx, 3) + ':' + V.World.get(xx, 20, 17));
  V.World.init(12345);
  while (!V.World.isReady()) V.World.generateNext(64);
  for (var x2 = 0; x2 < W; x2 += 5)
    if (first[x2 / 5] !== V.World.surfaceAt(x2, 3) + ':' + V.World.get(x2, 20, 17)) same = false;
})();
check('同种子两次生成完全一致', same);

(function () {
  V.World.init(777777);
  while (!V.World.isReady()) V.World.generateNext(64);
  var h1 = [];
  for (var x3 = 0; x3 < W; x3 += 5) h1.push(V.World.surfaceAt(x3, 3));
  V.World.init(12345);
  while (!V.World.isReady()) V.World.generateNext(64);
  var h2 = [];
  for (var x4 = 0; x4 < W; x4 += 5) h2.push(V.World.surfaceAt(x4, 3));
  check('不同种子地形不同', h1.join() !== h2.join());
})();

// 文本种子与等值数字种子一致性
(function () {
  V.World.init('2468');
  while (!V.World.isReady()) V.World.generateNext(64);
  var s1 = [];
  for (var xa = 0; xa < W; xa += 9) s1.push(V.World.surfaceAt(xa, 11));
  V.World.init(2468);
  while (!V.World.isReady()) V.World.generateNext(64);
  var okStr = true;
  for (var xb = 0; xb < W; xb += 9)
    if (s1[xb / 9] !== V.World.surfaceAt(xb, 11)) okStr = false;
  check('字符串/数字同值种子同一世界', okStr);
})();

console.log('群系多样性与特征方块扫描');
var featureFound = {
  sandCactus: false, jungleLog: false, giantJungle: false, podzol: false,
  mossy: false, spruceLog: false, sandstone: false, birchLog: false,
  acaciaLog: false, redSand: false, terracotta: false, ice: false,
  snowHigh: false, gravel: false
};
var biomeUniverse = {};
var seedsToScan = [12345, 42, 999, 7777, 31415, 271828];
for (var si = 0; si < seedsToScan.length; si++) {
  V.World.init(seedsToScan[si]);
  while (!V.World.isReady()) V.World.generateNext(64);
  for (var fx = 0; fx < W; fx += 3)
    for (var fz = 0; fz < D; fz += 3) {
      var bid = V.World.biomeAt(fx, fz);
      if (bid >= 0) biomeUniverse[bid] = true;
      for (var fy = 1; fy < H; fy++) {
        var fid = V.World.get(fx, fy, fz);
        if (fid === 26 && !featureFound.sandCactus) {
          if (V.World.get(fx, fy - 1, fz) === 6) featureFound.sandCactus = true;
        }
        else if (fid === 22) { featureFound.jungleLog = true; if (fy > 40) featureFound.giantJungle = true; }
        else if (fid === 24) featureFound.podzol = true;
        else if (fid === 25) featureFound.mossy = true;
        else if (fid === 20) featureFound.spruceLog = true;
        else if (fid === 27) featureFound.sandstone = true;
        else if (fid === 33) featureFound.birchLog = true;
        else if (fid === 35) featureFound.acaciaLog = true;
        else if (fid === 28) featureFound.redSand = true;
        else if (fid === 29 || fid === 30 || fid === 31) featureFound.terracotta = true;
        else if (fid === 32) featureFound.ice = true;
        else if (fid === 14) featureFound.gravel = true;
        else if (fid === 18 && fy >= 42) featureFound.snowHigh = true;
      }
    }
}
check('沙漠有仙人掌', featureFound.sandCactus);
check('有丛林木(含巨型)', featureFound.jungleLog);
check('有高耸巨型丛林树', featureFound.giantJungle);
check('原始针叶林有灰化土', featureFound.podzol);
check('原始针叶林有苔石巨砾', featureFound.mossy);
check('针叶林有云杉木', featureFound.spruceLog);
check('沙漠地下有砂岩层', featureFound.sandstone);
check('白桦森林有白桦木', featureFound.birchLog);
check('热带草原有金合欢木', featureFound.acaciaLog);
check('恶地有红沙', featureFound.redSand);
check('恶地有陶瓦层理', featureFound.terracotta);
check('冰封山峰有浮冰', featureFound.ice);
check('高山覆雪', featureFound.snowHigh);
check('海床/丘陵有砂砾', featureFound.gravel);

console.log('  扫描覆盖群系数: ' + Object.keys(biomeUniverse).length + '/' + V.Biomes.count);
check('多种子扫描覆盖大部分群系(>=13)', Object.keys(biomeUniverse).length >= 13);

console.log('单种子群系多样性 (种子 12345)');
V.World.init(12345);
while (!V.World.isReady()) V.World.generateNext(64);
var biomeSeen = {}, biomeCols = 0;
for (var bx2 = 0; bx2 < W; bx2 += 2)
  for (var bz2 = 0; bz2 < D; bz2 += 2) {
    var bid2 = V.World.biomeAt(bx2, bz2);
    if (bid2 >= 0) { biomeSeen[bid2] = (biomeSeen[bid2] || 0) + 1; biomeCols++; }
  }
check('biomeAt 覆盖所有采样列', biomeCols === (W / 2) * (D / 2));
var kinds = Object.keys(biomeSeen).length;
console.log('  出现群系数: ' + kinds + ' -> ' +
  Object.keys(biomeSeen).map(function (k) { return V.Biomes.name(+k) + '×' + biomeSeen[k]; }).join(', '));
check('至少出现 4 种群系', kinds >= 4);
check('群系 ID 均在注册表内', Object.keys(biomeSeen).every(function (k) { return +k >= 0 && +k < V.Biomes.count; }));

console.log('修改与存档还原');
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
check('applyEdits 继承到增量账本', V.World.getEdits()[bx + ',' + by + ',' + bz] === 10);

console.log('存档序列化往返');
(function () {
  // 方块元数据随存档序列化（箱子示例）
  V.World.setMeta(7, 8, 9, { type: 'chest', items: [{ id: 10, n: 5, dur: null }, null] });
  var inv = []; var cnt = [];
  for (var i = 0; i < 36; i++) { inv.push(0); cnt.push(0); }
  inv[0] = 10; cnt[0] = 64;   // 一组 64 木板
  inv[5] = 19; cnt[5] = 3;    // 3 个火把
  var extra = {
    time: 0.42,
    weather: 'rain',
    player: { pos: [1.5, 2.5, 3.5], yaw: 1.25, pitch: -0.3, fly: true, hp: 17 },
    inv: inv,
    cnt: cnt,
    held: 102,
    heldCnt: 1,
    heldDur: 37,
    craftGrid: [10, 0, 100, 0, 16, 0, 0, 0, 0],
    invCraftGrid: [4, 0, 20, 0],
    bed: [12, 34, 56],
    dur: (function () { var d = []; for (var i = 0; i < 36; i++) d.push(null); d[1] = 55; return d; })(),
    galaxy: galA
  };
  check('Save.save 成功', V.Save.save(V.World, extra));
  var loaded = V.Save.load();
  check('Save.load 返回数据', !!loaded);
  check('seed 往返', !!loaded && loaded.seed === V.World.getSeed());
  check('time 往返', !!loaded && loaded.time === 0.42);
  check('weather 往返', !!loaded && loaded.weather === 'rain');
  check('inv 往返', !!loaded && !!loaded.inv && loaded.inv[0] === 10 && loaded.inv[5] === 19);
  check('cnt 往返(堆叠数量不丢失)', !!loaded && !!loaded.cnt && loaded.cnt.length === 36 &&
    loaded.cnt[0] === 64 && loaded.cnt[5] === 3);
  check('held/heldCnt 往返', !!loaded && loaded.held === 102 && loaded.heldCnt === 1);
  check('heldDur 往返', !!loaded && loaded.heldDur === 37);
  check('3x3 craftGrid 往返', !!loaded && Array.isArray(loaded.craftGrid) && loaded.craftGrid.length === 9 &&
    loaded.craftGrid[0] === 10 && loaded.craftGrid[2] === 100 && loaded.craftGrid[4] === 16);
  check('2x2 invCraftGrid 往返', !!loaded && Array.isArray(loaded.invCraftGrid) && loaded.invCraftGrid.length === 4 &&
    loaded.invCraftGrid[0] === 4 && loaded.invCraftGrid[2] === 20);
  check('bed 往返', !!loaded && !!loaded.bed && loaded.bed[0] === 12 && loaded.bed[1] === 34 && loaded.bed[2] === 56);
  check('dur(工具耐久) 往返', !!loaded && !!loaded.dur && loaded.dur[1] === 55);
  check('meta(箱子) 往返', !!loaded && !!loaded.meta && !!loaded.meta['7,8,9'] &&
    loaded.meta['7,8,9'].items[0].n === 5);
  check('player 往返', !!loaded && !!loaded.player && loaded.player.hp === 17 &&
    loaded.player.fly === true && Math.abs(loaded.player.pos[0] - 1.5) < 1e-9);
  check('edits 随存档写入', !!loaded && !!loaded.edits && loaded.edits[bx + ',' + by + ',' + bz] === 10);
  check('v5 星系状态随存档写入', !!loaded && loaded.v === 5 && loaded.galaxy.rootSeed === galA.rootSeed && loaded.galaxy.catalog.length === 7);

  // 旧 v5 存档没有临时格/手持耐久字段，读取层不得因此拒绝整个存档。
  var currentRaw = _store[V.Config.SAVE_KEY];
  var oldShape = JSON.parse(currentRaw);
  delete oldShape.heldDur;
  delete oldShape.craftGrid;
  delete oldShape.invCraftGrid;
  _store[V.Config.SAVE_KEY] = JSON.stringify(oldShape);
  var oldLoaded = V.Save.load();
  check('旧档缺失新增临时字段仍可载入', !!oldLoaded && oldLoaded.seed === loaded.seed &&
    oldLoaded.heldDur === undefined && oldLoaded.craftGrid === undefined && oldLoaded.invCraftGrid === undefined);
  _store[V.Config.SAVE_KEY] = currentRaw;

  // 第二次载入后立即再存档：旧修改必须继续留在账本，第三次载入仍可恢复。
  V.World.init(loaded.seed);
  while (!V.World.isReady()) V.World.generateNext(64);
  V.World.applyEdits(loaded.edits);
  check('二次载入后方块与账本一致', V.World.get(bx, by, bz) === 10 &&
    V.World.getEdits()[bx + ',' + by + ',' + bz] === 10);
  check('二次载入后可再次保存', V.Save.save(V.World, extra));
  var loadedAgain = V.Save.load();
  check('载入→再保存→第三次载入不丢 edits', !!loadedAgain && !!loadedAgain.edits &&
    loadedAgain.edits[bx + ',' + by + ',' + bz] === 10);
})();

console.log('存档归档与恢复保护');
(function () {
  var saveKey = V.Config.SAVE_KEY;
  var backupKey = saveKey + '_backup';
  var swapKey = backupKey + '_swap';
  var primaryRaw = _store[saveKey];
  delete _store[backupKey];
  delete _store[swapKey];

  check('归档测试前主档存在', typeof primaryRaw === 'string' && primaryRaw.length > 0);
  check('无备份时 hasBackup=false', V.Save.hasBackup() === false);

  // 故障注入：备份键写入失败时，archiveCurrent 绝不得删除或重写主档。
  var originalSetItem = sandbox.localStorage.setItem;
  var originalWarn = sandbox.console.warn;
  sandbox.localStorage.setItem = function (k, v) {
    if (k === backupKey) throw new Error('injected backup write failure');
    return originalSetItem(k, v);
  };
  sandbox.console.warn = function () { };
  var archiveFailed = V.Save.archiveCurrent();
  sandbox.console.warn = originalWarn;
  sandbox.localStorage.setItem = originalSetItem;
  check('备份写入失败时 archiveCurrent=false', archiveFailed === false);
  check('归档失败不清主档且字节完全一致', _store[saveKey] === primaryRaw);
  check('归档失败不伪造可用备份', V.Save.hasBackup() === false && !Object.prototype.hasOwnProperty.call(_store, backupKey));

  // 故障注入：removeItem 静默失效时也必须回滚刚写入的备份，保持双槽原状。
  var originalRemoveItem = sandbox.localStorage.removeItem;
  sandbox.localStorage.removeItem = function (k) {
    if (k === saveKey) return;
    return originalRemoveItem(k);
  };
  var removeFailed = V.Save.archiveCurrent();
  sandbox.localStorage.removeItem = originalRemoveItem;
  check('主档删除静默失败时 archiveCurrent=false', removeFailed === false);
  check('主档删除失败后主档字节不变', _store[saveKey] === primaryRaw);
  check('主档删除失败后备份槽回滚', !Object.prototype.hasOwnProperty.call(_store, backupKey));

  check('成功归档当前存档', V.Save.archiveCurrent() === true);
  check('成功归档后主档已移除', !Object.prototype.hasOwnProperty.call(_store, saveKey));
  check('备份保留主档原始字节', _store[backupKey] === primaryRaw);
  check('成功归档后 hasBackup=true', V.Save.hasBackup() === true);

  // 模拟玩家已创建了另一个新档；恢复时旧档和当前档必须交换，以便再次恢复可撤销。
  var replacement = JSON.parse(primaryRaw);
  replacement.seed = '987654321';
  replacement.time = 0.77;
  var replacementRaw = JSON.stringify(replacement);
  _store[saveKey] = replacementRaw;
  check('恢复备份执行 swap', V.Save.restoreBackup() === true);
  check('restore 后主档精确等于旧备份', _store[saveKey] === primaryRaw);
  check('restore 后原当前档成为备份', _store[backupKey] === replacementRaw && V.Save.hasBackup() === true);
  check('restore swap 成功后清理中转键', !Object.prototype.hasOwnProperty.call(_store, swapKey));
  check('再次 restore 可撤销上一次恢复', V.Save.restoreBackup() === true &&
    _store[saveKey] === replacementRaw && _store[backupKey] === primaryRaw);

  // 不污染后续无关测试。
  _store[saveKey] = primaryRaw;
  delete _store[backupKey];
  delete _store[swapKey];
})();

console.log('熔炉烧炼');
var FS = V.FurnaceSys;
check('铁矿→铁锭', FS.resultId(9) === 108);
check('生猪排→熟猪排', FS.resultId(109) === 110);
check('生鸡肉→熟鸡肉', FS.resultId(111) === 112);
check('生兔肉→熟兔肉', FS.resultId(113) === 114);
check('沙子→玻璃', FS.resultId(6) === 13);
check('不可烧制返回 0', FS.resultId(3) === 0);
check('煤炭是燃料(40s)', FS.isFuel(107) && FS.fuelTime(107) === 40);
check('木板/木棍/原木是燃料', FS.isFuel(10) && FS.isFuel(100) && FS.isFuel(4));
check('石头不是燃料', !FS.isFuel(3));
(function () {
  // 完整烧制流程：2 铁矿 + 1 煤炭
  var fur = { type: 'furnace', in: { id: 9, n: 2 }, fuel: { id: 107, n: 1 }, out: null, burnT: 0, burnMax: 0, prog: 0 };
  FS.tickOne(fur, 1);
  check('点火消耗 1 煤炭且同刻开始烧制', fur.burnT > 38 && fur.burnMax === 40 && !fur.fuel && fur.prog === 1);
  FS.tickOne(fur, 4);   // 累计 t=5
  check('5 秒产出第 1 个铁锭', !!fur.out && fur.out.id === 108 && fur.out.n === 1 && fur.in.n === 1 && fur.prog === 0);
  FS.tickOne(fur, 4.9);
  check('未到时间不产出', fur.out.n === 1 && fur.prog > 4.5);
  FS.tickOne(fur, 0.2); // 累计 t=10.1
  check('产出第 2 个铁锭后原料耗尽', fur.out.n === 2 && !fur.in);
  var litAfter = FS.tickOne(fur, 30);
  check('无输入后燃尽（本 tick 耗尽余焰）', litAfter === true && fur.burnT === 0);
  check('下一 tick 已熄灭且进度回落', !FS.tickOne(fur, 1) && fur.burnT === 0 && fur.prog === 0);
  FS.tickOne(fur, 3);
  check('无输入不再点火', fur.burnT === 0 && !fur.fuel);
})();
(function () {
  var fur2 = { type: 'furnace', in: { id: 6, n: 1 }, fuel: { id: 107, n: 1 }, out: { id: 108, n: 64 }, burnT: 0, burnMax: 0, prog: 0 };
  FS.tickOne(fur2, 1);
  check('输出格被占用则不点火不推进', fur2.burnT === 0 && fur2.prog === 0 && !!fur2.fuel);
  var fur3 = { type: 'furnace', in: { id: 109, n: 3 }, fuel: { id: 100, n: 8 }, out: null, burnT: 0, burnMax: 0, prog: 0 };
  for (var i = 0; i < 16; i++) FS.tickOne(fur3, 0.5);   // 木棍燃料 2.5s：烧完 1 件后熄火
  check('木棍点燃可烧 1 件熟猪排', !!fur3.out && fur3.out.id === 110 && fur3.out.n >= 1);
})();

console.log('合成配方测试');
var Craft = V.Crafting;
function g9() { return [0, 0, 0, 0, 0, 0, 0, 0, 0]; }
check('配方数量=13', Craft.recipes.length === 13);

g = g9(); g[0] = 4;
var m = Craft.match(g);
check('1 橡木 → 4 木板', !!m && m.result === 10 && m.count === 4);

g = g9(); g[3] = 20;
m = Craft.match(g);
check('1 云杉木 → 4 木板', !!m && m.result === 10 && m.count === 4);

g = g9(); g[8] = 22;
m = Craft.match(g);
check('1 丛林木 → 4 木板', !!m && m.result === 10 && m.count === 4);

g = g9(); g[0] = 33;
m = Craft.match(g);
check('1 白桦木 → 4 木板', !!m && m.result === 10 && m.count === 4);

g = g9(); g[0] = 35;
m = Craft.match(g);
check('1 金合欢木 → 4 木板', !!m && m.result === 10 && m.count === 4);

g = g9(); g[0] = 20; g[1] = 22;
check('2 不同原木不匹配', !Craft.match(g));

g = g9(); g[4] = 10; g[5] = 10; g[7] = 10; g[8] = 10; // 2x2 放右下角
m = Craft.match(g);
check('2x2 木板(右下角) → 工作台', !!m && m.result === 15 && m.count === 1);

g = g9(); g[1] = 10; g[2] = 10; g[4] = 10; g[5] = 10; // 2x2 放右上
check('2x2 木板(右上角) → 工作台', !!Craft.match(g) && Craft.match(g).result === 15);

g = g9(); g[0] = 16; g[1] = 16; g[2] = 16; g[3] = 10; g[4] = 10; g[5] = 10;
m = Craft.match(g);
check('3 羊毛+3 木板(上排/下排) → 床', !!m && m.result === 17 && m.count === 1);

g = g9(); g[0] = 10; g[1] = 10; g[2] = 10; g[3] = 16; g[4] = 16; g[5] = 16;
check('床配方颠倒不匹配', !Craft.match(g));

g = g9(); g[0] = 16; g[1] = 16; g[3] = 10; g[4] = 10; g[5] = 10;
check('2 羊毛不匹配', !Craft.match(g));

g = g9(); g[0] = 16; g[1] = 16; g[2] = 16; g[3] = 10; g[4] = 10; g[5] = 10; g[6] = 4;
check('格子有杂物不匹配', !Craft.match(g));

g = g9();
for (var gi = 0; gi < 9; gi++) if (gi !== 4) g[gi] = 3;
m = Craft.match(g);
check('8 石头环 → 熔炉', !!m && m.result === 37 && m.count === 1);

g = g9(); g[0] = 4;
m = Craft.match(g);
Craft.consume(g, m);
check('consume 清空无序配方', g.join() === '0,0,0,0,0,0,0,0,0');

g = g9(); g[0] = 16; g[1] = 16; g[2] = 16; g[3] = 10; g[4] = 10; g[5] = 10;
m = Craft.match(g);
Craft.consume(g, m);
check('consume 清空有方向配方', g.join() === '0,0,0,0,0,0,0,0,0');

g = g9(); g[4] = 10; g[5] = 10; g[7] = 10; g[8] = 10; // 2x2 在右下角
m = Craft.match(g);
check('偏移位置的配方返回 cells', !!m && m.cells.length === 4 && m.cells.join() === '4,5,7,8');
Craft.consume(g, m);
check('consume 清空偏移位置配方', g.join() === '0,0,0,0,0,0,0,0,0');

console.log('背包 2x2 合成测试');
var g4 = [4, 0, 0, 0];
m = Craft.matchIn(g4, 2);
check('2x2: 1 橡木 → 4 木板', !!m && m.result === 10 && m.count === 4 && m.cells.join() === '0');
Craft.consume(g4, m);
check('2x2: consume 清空', g4.join() === '0,0,0,0');

g4 = [10, 10, 10, 10];
m = Craft.matchIn(g4, 2);
check('2x2: 4 木板 → 工作台', !!m && m.result === 15 && m.count === 1);
Craft.consume(g4, m);
check('2x2: consume 清空(工作台)', g4.join() === '0,0,0,0');

g4 = [16, 16, 16, 10];
check('2x2: 床放不下(需 3 列)不匹配', !Craft.matchIn(g4, 2));

g4 = [4, 4, 0, 0];
check('2x2: 2 橡木不匹配', !Craft.matchIn(g4, 2));

console.log('一键合成(背包计数)测试');
var inv = new Array(36).fill(0);
inv[0] = 4; inv[1] = 4;
check('canCraftFromInv: 2 橡木可合成 2 次', Craft.canCraftFromInv(inv, Craft.recipes[0]) === 2);
check('consumeFromInv: 消耗 1 次', Craft.consumeFromInv(inv, Craft.recipes[0], 1) === true);
check('consumeFromInv: 剩 1 橡木', inv[0] === 0 && inv[1] === 4);
inv = new Array(36).fill(0);
inv[0] = 20; inv[1] = 22;
check('canCraftFromInv: 云杉/丛林木可合成 2 次', Craft.canCraftFromInv(inv, Craft.recipes[0]) === 2);
inv = new Array(36).fill(0);
inv[0] = 33; inv[1] = 35;
check('canCraftFromInv: 白桦/金合欢可合成 2 次', Craft.canCraftFromInv(inv, Craft.recipes[0]) === 2);
inv = new Array(36).fill(0);
inv[0] = 10; inv[1] = 10; inv[2] = 10;
check('canCraftFromInv: 3 木板不够工作台', Craft.canCraftFromInv(inv, Craft.recipes[1]) === 0);
inv[3] = 10;
check('canCraftFromInv: 4 木板可合成 1 次', Craft.canCraftFromInv(inv, Craft.recipes[1]) === 1);
inv = new Array(36).fill(0);
inv[0] = 16; inv[1] = 16; inv[2] = 16; inv[3] = 10; inv[4] = 10; inv[5] = 10;
check('canCraftFromInv: 床材料齐可合成 1 次', Craft.canCraftFromInv(inv, Craft.recipes[2]) === 1);
check('needed: 床 = 3 羊毛+3 木板', JSON.stringify(Craft.needed(Craft.recipes[2])) === JSON.stringify({ 16: 3, 10: 3 }));
check('needed: 工作台 = 4 木板', JSON.stringify(Craft.needed(Craft.recipes[1])) === JSON.stringify({ 10: 4 }));

console.log('工具与掉落');
check('煤矿掉落煤炭', V.Blocks.dropOf(8) === 107);
check('普通方块掉自身', V.Blocks.dropOf(1) === 1);
check('红沙掉自身', V.Blocks.dropOf(28) === 28);
check('浮冰掉自身', V.Blocks.dropOf(32) === 32);
check('木镐等级=1', V.Blocks.pickTier(101) === 1);
check('石镐等级=2', V.Blocks.pickTier(102) === 2);
check('徒手无镐', V.Blocks.pickTier(3) === 0);
check('铁剑伤害=6', V.Blocks.attackDmg(106) === 6);
check('徒手伤害=2', V.Blocks.attackDmg(3) === 2);
check('工具非固体(可放置性排除)', !V.Blocks.isSolid(101));
check('火把非固体但可挖', !V.Blocks.isSolid(19) && !!V.Blocks.defs[19].cross);
check('新方块定义完整(名称非?)',
  ['红沙', '陶瓦', '黄陶瓦', '棕陶瓦', '浮冰', '白桦木', '金合欢木'].every(function (nm) {
    for (var i = 1; i < 40; i++) if (V.Blocks.name(i) === nm) return true;
    return false;
  }));

g = g9(); g[0] = 10; g[1] = 10; g[2] = 10; g[4] = 100; g[7] = 100;
m = Craft.match(g);
check('木镐配方匹配', !!m && m.result === 101);
g = g9(); g[1] = 10; g[4] = 10; g[7] = 100;
m = Craft.match(g);
check('木剑配方匹配', !!m && m.result === 104);
g = g9(); g[0] = 3; g[1] = 3; g[2] = 3; g[4] = 100; g[7] = 100;
m = Craft.match(g);
check('石镐配方匹配', !!m && m.result === 102);
var invT = new Array(36).fill(0);
invT[0] = 107; invT[1] = 100;
check('火把=煤+木棍 可合成', Craft.canCraftFromInv(invT, Craft.recipes[4]) === 1);
Craft.consumeFromInv(invT, Craft.recipes[4], 1);
check('火把合成消耗后清空', invT.join() === new Array(36).fill(0).join());

console.log('触控摇杆数学');
load('js/ui/touch.js');
var TU = V.TouchUtil;
var a0 = TU.axes(0, 0, 66);
check('零输入归零', a0.x === 0 && a0.y === 0 && a0.mag === 0 && !a0.sprint);
var dzv = TU.axes(3, -4, 66);   // 长度 5 < 死区 7.92
check('死区内无输出', dzv.x === 0 && dzv.y === 0 && dzv.mag === 0 && !dzv.sprint);
var mid = TU.axes(0, -33, 66);  // 向前推半程
check('半程推动 mag=0.5 且不疾跑', Math.abs(mid.mag - 0.5) < 1e-9 &&
  Math.abs(mid.y - (-0.5)) < 1e-9 && Math.abs(mid.x) < 1e-9 && !mid.sprint);
var full = TU.axes(0, -200, 66); // 超出半径 → 限幅
check('超半径限幅为 1 并触发疾跑', full.y === -1 && full.mag === 1 && full.sprint);
var edge = TU.axes(66 * 0.93, 0, 66);
check('外圈阈值触发疾跑', edge.sprint && Math.abs(edge.x - 0.93) < 1e-9);
var justIn = TU.axes(66 * 0.90, 0, 66);
check('疾跑阈值内不误触', !justIn.sprint && Math.abs(justIn.x - 0.90) < 1e-9);
var diag = TU.axes(30, -40, 50); // 长度=半径：方向保持 (0.6,-0.8)
check('斜推方向保持', Math.abs(diag.x - 0.6) < 1e-9 &&
  Math.abs(diag.y + 0.8) < 1e-9 && diag.mag === 1 && diag.sprint);
var tiny = TU.axes(1, 1, 0);     // 半径非法防御
check('非法半径安全归零', tiny.mag === 0);

console.log('行星类型与空间站生成');
(function () {
  var arid = galA.catalog[1];
  V.World.init(arid.seed, arid);
  while (!V.World.isReady()) V.World.generateNext(64);
  var allowed = {};
  [V.Biomes.B.DESERT, V.Biomes.B.BADLANDS, V.Biomes.B.SAVANNA, V.Biomes.B.STONY_PEAKS].forEach(function (id) { allowed[id] = true; });
  var allArid = true;
  for (var x = 0; x < W; x += 7)
    for (var z = 0; z < D; z += 7)
      if (!allowed[V.World.biomeAt(x, z)]) allArid = false;
  check('荒漠星球实际约束为干旱群系集合', allArid && V.World.getProfile().typeKey === 'arid');

  var stationWorld = galA.catalog[6];
  V.World.init(stationWorld.seed, stationWorld);
  while (!V.World.isReady()) V.World.generateNext(64);
  check('空间站中心生成可行走甲板', V.World.get(128, 23, 128) !== 0 && V.World.surfaceAt(128, 128) >= 23);
  check('空间站外围保持真空', V.World.get(20, 23, 20) === 0);
  check('空间站出生点位于甲板上方', V.World.spawnPoint().y > 24 && V.World.spawnPoint().y < 27);
  // 后续通用光照断言需要无其他人造光源的普通行星环境。
  V.World.init(12345);
  while (!V.World.isReady()) V.World.generateNext(64);
})();

console.log('性能预设');
var PP = V.Config.PERF_PRESETS;
check('预设三档齐全', !!PP.smooth && !!PP.balanced && !!PP.high);
check('流畅=30fps 低分辨率低密度', PP.smooth.fpsCap === 30 &&
  PP.smooth.res <= 0.6 && PP.smooth.particleDensity <= 0.5 && PP.smooth.mobDensity <= 0.5);
check('均衡=60fps 中配', PP.balanced.fpsCap === 60 && PP.balanced.res === 0.8 &&
  PP.balanced.rainDensity === 0.7);
check('高画质=原生满配', PP.high.fpsCap === 0 && PP.high.res === 1 &&
  PP.high.particleDensity === 1 && PP.high.mobDensity === 1);
(function () {
  var bad = [];
  ['smooth', 'balanced', 'high'].forEach(function (name) {
    for (var k in PP[name]) if (!(k in V.Settings.defaults)) bad.push(name + '.' + k);
  });
  check('预设键均在设置表内', bad.length === 0);
})();
check('桌面默认不限帧', V.Settings.defaults.fpsCap === 0);
check('触屏默认均衡档(60fps/降密度)', V.Settings.touchDefaults.fpsCap === 60 &&
  V.Settings.touchDefaults.res === 0.8);
check('渲染分辨率下限 0.35', V.Settings.limits.res[0] === 0.35);

console.log('光照系统');var tL0 = Date.now();
V.World.initLight();
console.log('  光照初始化耗时 ' + (Date.now() - tL0) + 'ms');
check('光照已就绪', V.World.lightReady());
var skyOK = false;
for (var lx = 8; lx < W - 8 && !skyOK; lx += 5)
  for (var lz = 8; lz < D - 8 && !skyOK; lz += 5) {
    var sy = V.World.surfaceAt(lx, lz);
    if (sy > 0 && V.World.get(lx, sy + 1, lz) === 0 && V.World.getSky(lx, sy + 1, lz) >= 14) skyOK = true;
  }
check('地表空气有天光', skyOK);
var spL = V.World.spawnPoint();
var bxL = Math.floor(spL.x), byL = Math.floor(spL.y + 1), bzL = Math.floor(spL.z);
V.World.set(bxL, byL, bzL, 19);
check('火把自身发光', V.World.getBlk(bxL, byL, bzL) >= 13);
check('火把照亮邻居', V.World.getBlk(bxL + 1, byL, bzL) >= 11);
check('火把光随距离衰减', V.World.getBlk(bxL + 5, byL, bzL) < V.World.getBlk(bxL + 1, byL, bzL));
check('移除火把后块光熄灭', (function () {
  V.World.set(bxL, byL, bzL, 0);
  return V.World.getBlk(bxL + 1, byL, bzL) === 0;
})());

console.log(failed === 0 ? '\n全部通过 ✓' : '\n' + failed + ' 项失败 ✗');
process.exit(failed === 0 ? 0 : 1);
