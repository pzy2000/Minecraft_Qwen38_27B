// 5.2 section 存储单元测试：get/set 与扁数组逐位一致，空段/均质段压缩。
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
}
var sandbox = {
  window: {}, console: console, Math: Math,
  Uint8Array: Uint8Array, Uint16Array: Uint16Array, Uint32Array: Uint32Array
};
sandbox.window = sandbox;
vm.createContext(sandbox);
load('js/config.js');
load('js/world/sections.js');

var S = sandbox.Voxel.Sections;
var failed = 0;
function check(name, cond) {
  if (cond) console.log('  ok  ' + name);
  else { console.log('  FAIL ' + name); failed++; }
}

var SX = 32, SY = 256, SZ = 32;
var flat = new Uint16Array(SX * SY * SZ);
function idx(x, y, z) { return x + SX * (y + SY * z); }

// 石柱 + 空中平台 + 均质石层
for (var z = 0; z < SZ; z++)
  for (var x = 0; x < SX; x++) {
    for (var y = 0; y < 16; y++) flat[idx(x, y, z)] = 3;
    if (x === 4 && z === 5) flat[idx(x, 40, z)] = 12;
    flat[idx(x, 100, z)] = 1;
  }
flat[idx(8, 130, 9)] = 19;

var store = S.fromFlat(flat, SX, SY, SZ);
var round = store.flatten();
var same = true;
for (var i = 0; i < flat.length; i++) if (round[i] !== flat[i]) { same = false; break; }
check('fromFlat→flatten 逐位一致', same);

check('空段 y=200 读 0', store.get(1, 200, 1) === 0);
check('均质石段 y=3 读 3', store.get(10, 3, 10) === 3);
check('孤立方块', store.get(4, 40, 5) === 12);
check('高处平台', store.get(0, 100, 0) === 1);
check('更高孤立', store.get(8, 130, 9) === 19);

store.set(4, 40, 5, 0);
check('set 0 后读回', store.get(4, 40, 5) === 0);
store.set(1, 200, 1, 7);
check('空段写入后可读', store.get(1, 200, 1) === 7);
store.compact();
check('compact 后仍可读', store.get(1, 200, 1) === 7 && store.get(10, 3, 10) === 3);

var packed = store.estimateBytes();
var dense = S.denseBytes(SX, SY, SZ, 2, 1);
check('打包小于扁数组 50% (packed=' + packed + ' dense=' + dense + ')', packed <= dense * 0.5);

var lin = S.create(SX, SY, SZ, 2);
lin.setLinear(idx(2, 17, 3), 44);
check('getLinear/setLinear', lin.getLinear(idx(2, 17, 3)) === 44 && lin.get(2, 17, 3) === 44);

// 均质段 palette：写入异值炸开，写回后 compact 再压成 fill
var pal = S.create(SX, SY, SZ, 2);
pal.setSectionFill(0, 3);
check('palette 均质读', pal.get(31, 15, 31) === 3 && pal.sectionFill(0) === 3);
pal.set(0, 0, 0, 5);
check('palette 炸开后异值可读', pal.get(0, 0, 0) === 5 && pal.get(1, 1, 1) === 3);
check('palette 炸开后不再是 fill', pal.sectionFill(0) === undefined);
pal.set(0, 0, 0, 3);
pal.compact();
check('compact 收回均质 fill', pal.sectionFill(0) === 3 && pal.get(0, 0, 0) === 3);
pal.setSectionFill(2, 0);
check('fill=0 存成空段', pal.sectionEmpty(2) && pal.get(0, 32, 0) === 0);

// 256³ 核心尺寸：底 32 高均质石 + 一孤立方块，打包 ≤ 扁数组 50%
var CW = 256, CH = 256, CD = 256;
var core = new Uint16Array(CW * CH * CD);
function cidx(x, y, z) { return x + CW * (y + CH * z); }
for (var cz = 0; cz < CD; cz++)
  for (var cx = 0; cx < CW; cx++)
    for (var cy = 0; cy < 32; cy++) core[cidx(cx, cy, cz)] = 3;
core[cidx(10, 80, 10)] = 1;
var coreStore = S.fromFlat(core, CW, CH, CD);
var coreBack = coreStore.flatten();
var coreSame = coreBack[cidx(0, 0, 0)] === 3 && coreBack[cidx(10, 80, 10)] === 1 &&
  coreBack[cidx(255, 200, 255)] === 0;
check('256³ fromFlat 抽样一致', coreSame);
check('256³ get 语义', coreStore.get(10, 80, 10) === 1 && coreStore.get(0, 3, 0) === 3);
var corePacked = coreStore.estimateBytes();
var coreDense = S.denseBytes(CW, CH, CD, 2, 1);
check('256³ 核心打包 ≤50% (packed=' + corePacked + ' dense=' + coreDense + ')',
  corePacked <= coreDense * 0.5);

if (failed) process.exit(1);
console.log('sections_test OK');
