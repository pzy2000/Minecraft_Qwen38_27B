// 外星巨树 / 遗迹结构系统测试（纯 Node，无需浏览器）：
// 确定性、cell 稀有度、核心禁区、惰性战利品契约、发光方块光照表、版本门控。
// 运行：node test/structures_test.js
'use strict';

global.window = global;
global.Voxel = {};

require('../js/config.js');
require('../js/world/seed.js');
require('../js/world/noise.js');
require('../js/world/biomes.js');
require('../js/blocks.js');
require('../js/world/structures.js');

var assert = require('assert');
var Voxel = window.Voxel;

var WATER = Voxel.Config.WATER_LEVEL;

function makeCtx(opts) {
  opts = opts || {};
  var noise = Voxel.Noise.create(opts.seed !== undefined ? opts.seed : '987654321');
  return {
    hash2: noise.hash2,
    surfaceAt: opts.surfaceAt || function () { return 34; },
    biomeAt: opts.biomeAt || function () { return Voxel.Biomes.B.PLAINS; },
    typeKey: opts.typeKey || 'toxic',
    version: opts.version === undefined ? 2 : opts.version
  };
}

function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

var passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ok ' + name); }
  else { failed++; console.log('  FAIL ' + name); }
}

console.log('绑定与版本门控');
Voxel.Structures.bind(makeCtx({ version: 2 }));
ok(Voxel.Structures.enabled(), 'version=2 时启用');
Voxel.Structures.bind(makeCtx({ version: 1 }));
ok(!Voxel.Structures.enabled(), 'version=1 时禁用');
Voxel.Structures.bind(null);
ok(!Voxel.Structures.enabled(), '未绑定时禁用');

Voxel.Structures.bind(makeCtx({}));

console.log('确定性');
var r1 = Voxel.Structures.cellRuin(3, 5);
var r2 = Voxel.Structures.cellRuin(3, 5);
ok(deepEq(r1, r2), '同一 cell 描述符逐位一致');
if (r1) {
  var l1 = Voxel.Structures.lootFor(r1, 0);
  var l2 = Voxel.Structures.lootFor(r1, 0);
  ok(deepEq(l1, l2), '战利品按种子稳定');
}

console.log('cell 命中率（平地门控全通过时约 1/3）');
var hit = 0, total = 0;
for (var cx = -25; cx <= 25; cx++) {
  for (var cz = -25; cz <= 25; cz++) {
    total++;
    if (Voxel.Structures.cellRuin(cx, cz)) hit++;
  }
}
var frac = hit / total;
ok(frac > 0.22 && frac < 0.45, '命中率 ' + frac.toFixed(3) + ' 在预期区间');

console.log('legacy core 禁区');
var W = Voxel.Config.WORLD_W, D = Voxel.Config.WORLD_D;
var EXT = Voxel.Structures.EXTENT;
var CELL = Voxel.Structures.CELL;
var violated = false;
for (var cx2 = -10; cx2 <= Math.ceil((W + EXT * 2) / CELL) + 10 && !violated; cx2++) {
  for (var cz2 = -10; cz2 <= Math.ceil((D + EXT * 2) / CELL) + 10 && !violated; cz2++) {
    var r = Voxel.Structures.cellRuin(cx2, cz2);
    if (!r) continue;
    // 结构包围盒不得与核心矩形相交
    var sep = r.ax + EXT < 0 || r.ax - EXT >= W || r.az + EXT < 0 || r.az - EXT >= D;
    if (!sep) violated = true;
  }
}
ok(!violated, '所有遗迹锚点均在核心禁区之外');

console.log('地形/群系门控');
Voxel.Structures.bind(makeCtx({ surfaceAt: function () { return WATER - 2; } }));
var underwaterHit = false;
for (var ux = -15; ux <= 15 && !underwaterHit; ux++)
  for (var uz = -15; uz <= 15 && !underwaterHit; uz++)
    if (Voxel.Structures.cellRuin(ux, uz)) underwaterHit = true;
ok(!underwaterHit, '水下不出遗迹');
Voxel.Structures.bind(makeCtx({
  biomeAt: function () { return Voxel.Biomes.B.OCEAN; }
}));
var oceanHit = false;
for (var ox = -15; ox <= 15 && !oceanHit; ox++)
  for (var oz = -15; oz <= 15 && !oceanHit; oz++)
    if (Voxel.Structures.cellRuin(ox, oz)) oceanHit = true;
ok(!oceanHit, '海洋群系不出遗迹');
Voxel.Structures.bind(makeCtx({
  // 周期 11、高低差 6 的锯齿：任意锚点与 ±8 采样点必有 >2 高差
  surfaceAt: function (x) {
    var m = ((x % 11) + 11) % 11;
    return 30 + (m <= 5 ? 0 : 6);
  }
}));
var roughHit = false;
for (var rx = -15; rx <= 15 && !roughHit; rx++)
  for (var rz = -15; rz <= 15 && !roughHit; rz++)
    if (Voxel.Structures.cellRuin(rx, rz)) roughHit = true;
ok(!roughHit, '不平整地形拒绝遗迹');

Voxel.Structures.bind(makeCtx({}));

console.log('惰性战利品反查');
var ruin = null;
for (var fx = -40; fx <= 40 && !ruin; fx++)
  for (var fz = -40; fz <= 40 && !ruin; fz++)
    ruin = Voxel.Structures.cellRuin(fx, fz) || null;
ok(!!ruin, '搜索范围内能找到遗迹');
var chests = Voxel.Structures.ruinChests(ruin);
ok(chests.length >= 1, '至少一个宝箱位');
var loot = Voxel.Structures.chestLootAt(chests[0].x, chests[0].y, chests[0].z);
ok(Array.isArray(loot) && loot.length === 27, '宝箱位返回 27 格战利品');
var batterySlots = [];
for (var i = 0; i < loot.length; i++) if (loot[i] && loot[i].id === 122) batterySlots.push(i);
ok(batterySlots.length === 1, '主箱必出且仅出一枚曲速电池(id122)');
ok(chests[0].index === 0 ? !!loot[batterySlots[0]] : true, '电池格有效');
var crystalCounts = {}, coalCount = 0, meatCount = 0, toolFound = null;
for (var j = 0; j < loot.length; j++) {
  var it = loot[j];
  if (!it) continue;
  ok2Item(it);
  if (it.id >= 115 && it.id <= 120) crystalCounts[it.n] = true;
  if (it.id === 107) coalCount = it.n;
  if (it.id === 110 || it.id === 112 || it.id === 114) meatCount = it.n;
  if (it.id === 103 || it.id === 106) toolFound = it;
}
function ok2Item() {}
ok(Object.keys(crystalCounts).length === 1 &&
  Number(Object.keys(crystalCounts)[0]) >= 3 && Number(Object.keys(crystalCounts)[0]) <= 8,
  '星球专属晶体 ×3–8');
ok(coalCount >= 5 && coalCount <= 12, '煤炭 ×5–12');
ok(meatCount >= 2 && meatCount <= 4, '熟肉 ×2–4');
ok(toolFound && toolFound.dur >= 1 && toolFound.dur <= 251, '铁质工具带有效剩余耐久');
ok(Voxel.Structures.chestLootAt(ruin.ax + 50, ruin.ah + 3, ruin.az + 50) === null,
  '非宝箱位返回 null');

if (chests.length > 1) {
  var lootB = Voxel.Structures.lootFor(ruin, 1);
  var hasBattery = false;
  for (var b = 0; b < lootB.length; b++) if (lootB[b] && lootB[b].id === 122) hasBattery = true;
  ok(hasBattery, '副箱同样必出曲速电池');
}

console.log('buildRuin 输出流确定性');
var opsA = [], opsB = [];
function rec(list) {
  return function (x, y, z, id, mode) { list.push(x, y, z, id, mode); };
}
Voxel.Structures.buildRuin(ruin, rec(opsA));
Voxel.Structures.buildRuin(ruin, rec(opsB));
ok(deepEq(opsA, opsB), '两次构建操作流完全一致');
var hasChestWrite = false, badY = false;
for (var o = 0; o < opsA.length; o += 5) {
  if (opsA[o + 3] === 38) hasChestWrite = true;
  if (opsA[o + 1] <= 0 || opsA[o + 1] >= Voxel.Config.WORLD_H) badY = true;
}
ok(hasChestWrite, '构建流包含箱子方块');
ok(!badY, '无越界写入');

console.log('巨型植物 builder');
function megaOps(kind, seedNum) {
  var list = [];
  var pen = {
    force: function (x, y, z, id) { list.push([x, y, z, id, 'force']); },
    air: function (x, y, z, id) { list.push([x, y, z, id, 'air']); }
  };
  var m = Voxel.Structures.megaKind(seedToType(kind), 2, seedToBiome(kind));
  ok(!!m, kind + ' 在对应行星类型+群系下可用');
  var built = Voxel.Structures.buildMega(m, pen, 100, 30, 200, 0.37);
  return { built: built, list: list, m: m };
}
function seedToType(kind) {
  return { shroom: 'toxic', icespire: 'frozen', basalt: 'volcanic', deadtree: 'arid', coral: 'oceanic' }[kind];
}
function seedToBiome(kind) {
  var B = Voxel.Biomes.B;
  return { shroom: B.JUNGLE, icespire: B.SNOWY, basalt: B.BADLANDS, deadtree: B.DESERT, coral: B.SPARSE_JUNGLE }[kind];
}
var kinds = ['shroom', 'icespire', 'basalt', 'deadtree', 'coral'];
for (var ki = 0; ki < kinds.length; ki++) {
  var resA = megaOps(kinds[ki]);
  var penB = { force: function () {}, air: function () {} };
  var builtB = Voxel.Structures.buildMega(resA.m, penB, 100, 30, 200, 0.37);
  ok(resA.built === builtB && resA.built === true, kinds[ki] + ' 构建成功且幂等');
  var inBounds = true;
  for (var mi = 0; mi < resA.list.length; mi++) {
    var op = resA.list[mi];
    if (Math.abs(op[0] - 100) > 6 || Math.abs(op[2] - 200) > 6 || op[1] <= 30 || op[1] >= Voxel.Config.WORLD_H)
      inBounds = false;
  }
  ok(inBounds, kinds[ki] + ' 写入范围受控');
  ok(Voxel.Structures.megaKind(seedToType(kinds[ki]), 1, seedToBiome(kinds[ki])) === null,
    kinds[ki] + ' 在 v1 世界被门控');
}

console.log('发光方块光照表');
ok(Voxel.Blocks.lightOf(19) === 14, '火把亮度 14');
ok(Voxel.Blocks.lightOf(47) === 13, '荧光菌伞亮度 13');
ok(Voxel.Blocks.lightOf(3) === 0, '石头不发光');
ok(Voxel.Blocks.LIGHT.length === 256, 'LIGHT 表覆盖全部 ID');

console.log('新方块冻结契约（46..52）');
var expectedNames = {
  46: '外星茎干', 47: '荧光菌伞', 48: '玄武岩柱', 49: '珊瑚块',
  50: '遗迹石砖', 51: '苔痕遗迹石砖', 52: '枯巨木'
};
Object.keys(expectedNames).forEach(function (idKey) {
  var d = Voxel.Blocks.defs[idKey];
  ok(d && d.name === expectedNames[idKey], 'defs[' + idKey + ']=' + expectedNames[idKey]);
});
ok(Voxel.Blocks.defs[53] && Voxel.Blocks.defs[53].name === '菌丝体', 'defs[53]=菌丝体（群系扩展新尾）');
ok(Voxel.Blocks.defs[59] && Voxel.Blocks.defs[59].name === '暗色树叶', 'defs[59]=暗色树叶');
ok(Voxel.Blocks.defs[60] === undefined, 'ID 60 未占用（尾部追加纪律）');

console.log('');
if (failed) { console.log('失败 ' + failed + ' 项'); process.exit(1); }
console.log('STRUCTURES-PASS');
