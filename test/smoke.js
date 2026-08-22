// 无浏览器冒烟测试：node test/smoke.js
// 验证：噪声、地形生成、确定性、树/水/矿、修改与存档还原、合成配方匹配
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
load('js/crafting.js');
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

console.log('雪地生物群系 (种子 42)');
V.World.init(42);
while (!V.World.isReady()) V.World.generateNext(64);
var snow = 0;
for (var sx = 0; sx < W; sx += 4)
  for (var sz = 0; sz < D; sz += 4)
    for (var sy = 40; sy < H; sy++)
      if (V.World.get(sx, sy, sz) === 18) snow++;
check('高山覆雪(雪块存在)', snow > 10);

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

console.log('合成配方测试');
var Craft = V.Crafting;
function g9() { return [0, 0, 0, 0, 0, 0, 0, 0, 0]; }
check('配方数量=11', Craft.recipes.length === 11);

var g = g9(); g[0] = 4;
var m = Craft.match(g);
check('1 橡木 → 4 木板', !!m && m.result === 10 && m.count === 4);

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
// 木板配方：1 橡木 → 4 木板
inv[0] = 4; inv[1] = 4;
check('canCraftFromInv: 2 橡木可合成 2 次', Craft.canCraftFromInv(inv, Craft.recipes[0]) === 2);
check('consumeFromInv: 消耗 1 次', Craft.consumeFromInv(inv, Craft.recipes[0], 1) === true);
check('consumeFromInv: 剩 1 橡木', inv[0] === 0 && inv[1] === 4);
// 工作台配方：4 木板
inv = new Array(36).fill(0);
inv[0] = 10; inv[1] = 10; inv[2] = 10;
check('canCraftFromInv: 3 木板不够工作台', Craft.canCraftFromInv(inv, Craft.recipes[1]) === 0);
inv[3] = 10;
check('canCraftFromInv: 4 木板可合成 1 次', Craft.canCraftFromInv(inv, Craft.recipes[1]) === 1);
check('consumeFromInv: 工作台消耗 4 木板', Craft.consumeFromInv(inv, Craft.recipes[1], 1) === true);
check('consumeFromInv: 木板清空', inv.join() === new Array(36).fill(0).join());
// 床配方：3 羊毛 + 3 木板
inv = new Array(36).fill(0);
inv[0] = 16; inv[1] = 16; inv[2] = 16; inv[3] = 10; inv[4] = 10; inv[5] = 10;
check('canCraftFromInv: 床材料齐可合成 1 次', Craft.canCraftFromInv(inv, Craft.recipes[2]) === 1);
check('consumeFromInv: 床消耗 3 羊毛+3 木板', Craft.consumeFromInv(inv, Craft.recipes[2], 1) === true);
check('consumeFromInv: 床材料清空', inv.join() === new Array(36).fill(0).join());
// needed 计数
check('needed: 床 = 3 羊毛+3 木板', JSON.stringify(Craft.needed(Craft.recipes[2])) === JSON.stringify({ 16: 3, 10: 3 }));
check('needed: 工作台 = 4 木板', JSON.stringify(Craft.needed(Craft.recipes[1])) === JSON.stringify({ 10: 4 }));

console.log('工具与掉落');
check('煤矿掉落煤炭', V.Blocks.dropOf(8) === 107);
check('普通方块掉自身', V.Blocks.dropOf(1) === 1);
check('木镐等级=1', V.Blocks.pickTier(101) === 1);
check('石镐等级=2', V.Blocks.pickTier(102) === 2);
check('徒手无镐', V.Blocks.pickTier(3) === 0);
check('铁剑伤害=6', V.Blocks.attackDmg(106) === 6);
check('徒手伤害=2', V.Blocks.attackDmg(3) === 2);
check('工具非固体(可放置性排除)', !V.Blocks.isSolid(101));
check('火把非固体但可挖', !V.Blocks.isSolid(19) && !!V.Blocks.defs[19].cross);

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

console.log('光照系统');
V.World.init(12345);
while (!V.World.isReady()) V.World.generateNext(64);
var tL = Date.now();
V.World.initLight();
console.log('  光照初始化耗时 ' + (Date.now() - tL) + 'ms');
check('光照已就绪', V.World.lightReady());
// 地表空气应有天光
var skyOK = false;
for (var lx = 8; lx < W - 8 && !skyOK; lx += 5)
  for (var lz = 8; lz < D - 8 && !skyOK; lz += 5) {
    var sy = V.World.surfaceAt(lx, lz);
    if (sy > 0 && V.World.get(lx, sy + 1, lz) === 0 && V.World.getSky(lx, sy + 1, lz) >= 14) skyOK = true;
  }
check('地表空气有天光', skyOK);
// 火把：放置 → 发光并衰减传播；移除 → 熄灭
var spL = V.World.spawnPoint();
var bxL = Math.floor(spL.x), byL = Math.floor(spL.y + 1), bzL = Math.floor(spL.z);
V.World.set(bxL, byL, bzL, 19);
check('火把自身发光', V.World.getBlk(bxL, byL, bzL) >= 13);
check('火把照亮邻居', V.World.getBlk(bxL + 1, byL, bzL) >= 11);
check('火把光随距离衰减', V.World.getBlk(bxL + 5, byL, bzL) < V.World.getBlk(bxL + 1, byL, bzL));
check('火把光不透过实体', V.Blocks.isOpaque(V.World.get(bxL, byL - 1, bzL)) ?
  V.World.getBlk(bxL, byL - 2, bzL) <= 12 : true);
V.World.set(bxL, byL, bzL, 0);
check('移除火把后块光熄灭', V.World.getBlk(bxL + 1, byL, bzL) === 0);

console.log(failed === 0 ? '\n全部通过 ✓' : '\n' + failed + ' 项失败 ✗');
process.exit(failed === 0 ? 0 : 1);
