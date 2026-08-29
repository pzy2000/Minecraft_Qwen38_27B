// 生成地形黄金校验值：在当前代码基线下对多颗种子的外围区块
// heights/blocks 计算 FNV 摘要，输出 JSON 供 terrain_parity_test.js 守护。
// 用法：node test/make_terrain_golden.js > test/terrain_golden.json
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
function load(rel) {
  var code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

var sandbox = {
  console: console, Math: Math, BigInt: BigInt,
  Uint8Array: Uint8Array, Uint32Array: Uint32Array,
  Int16Array: Int16Array, Float32Array: Float32Array
};
sandbox.window = sandbox;
vm.createContext(sandbox);

load('js/config.js');
load('js/world/seed.js');
load('js/world/noise.js');
load('js/world/biomes.js');
load('js/world/planet_rules.js');
load('js/world/shaper.js');
load('js/world/structures.js');
load('js/blocks.js');
load('js/world/gen_core.js');

var V = sandbox.Voxel;
function fnv1a(bytes) {
  var h = 0x811c9dc5;
  for (var i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

var CS = V.Config.CHUNK;
// 注意：blocksTopN 必须覆盖所有自然生成内容（含巨树树冠），同时不含 H 以上区域
var CASES = [
  { name: 'origin_v2', seed: '12345', profile: { typeKey: 'lush', terrainVersion: 2 }, cx: -1, cz: 0 },
  { name: 'origin_v2_b', seed: '12345', profile: { typeKey: 'lush', terrainVersion: 2 }, cx: -3, cz: -2 },
  { name: 'arid_v2', seed: '-999888777', profile: { typeKey: 'arid', terrainVersion: 2 }, cx: 2, cz: 1 },
  { name: 'frozen_v2', seed: '42', profile: { typeKey: 'frozen', terrainVersion: 2 }, cx: -2, cz: 3 },
  { name: 'volcanic_v2', seed: 'deadbeefcafe', profile: { typeKey: 'volcanic', terrainVersion: 2 }, cx: 1, cz: -4 }
];

var out = [];
for (var ci = 0; ci < CASES.length; ci++) {
  var c = CASES[ci];
  var gen = V.GenCore.create({ seed: c.seed, profile: c.profile });
  // 采样 2×2 相邻 shell 覆盖跨区块接缝的树冠一致性
  var offs = [[0, 0], [1, 0], [0, 1]];
  for (var oi = 0; oi < offs.length; oi++) {
    var s = gen.ensureShell(c.cx + offs[oi][0], c.cz + offs[oi][1]);
    gen.decorate(s);
    out.push({
      case: c.name,
      cx: c.cx + offs[oi][0], cz: c.cz + offs[oi][1],
      heightsH: fnv1a(new Uint8Array(s.heights.buffer.slice(0))),
      blocksTop80H: fnv1a(s.blocks.subarray(0, CS * CS * 80))
    });
  }
}
process.stdout.write(JSON.stringify(out, null, 2));
