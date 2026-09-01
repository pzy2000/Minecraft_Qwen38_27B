// 生成地形黄金校验值：多种子 × 多行星类型外围区块的 heights/blocks 摘要。
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
  Uint8Array: Uint8Array, Uint16Array: Uint16Array, Uint32Array: Uint32Array,
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
load('js/world/sections.js');
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

function hashYBand(blocks, y0, y1, CS, H) {
  var n = CS * (y1 - y0) * CS;
  var buf = new Uint16Array(n);
  var p = 0;
  for (var lz = 0; lz < CS; lz++)
    for (var y = y0; y < y1; y++)
      for (var lx = 0; lx < CS; lx++)
        buf[p++] = V.Sections.read(blocks, lx, y, lz, CS, H);
  return fnv1a(new Uint8Array(buf.buffer));
}

var CS = V.Config.CHUNK;
var H = V.Config.WORLD_H;
var CASES = [
  { name: 'origin_v2', seed: '12345', profile: { typeKey: 'lush', terrainVersion: 2 }, cx: -1, cz: 0 },
  { name: 'origin_v2_b', seed: '12345', profile: { typeKey: 'lush', terrainVersion: 2 }, cx: -3, cz: -2 },
  { name: 'arid_v2', seed: '-999888777', profile: { typeKey: 'arid', terrainVersion: 2 }, cx: 2, cz: 1 },
  { name: 'frozen_v2', seed: '42', profile: { typeKey: 'frozen', terrainVersion: 2 }, cx: -2, cz: 3 },
  { name: 'volcanic_v2', seed: 'deadbeefcafe', profile: { typeKey: 'volcanic', terrainVersion: 2 }, cx: 1, cz: -4 },
  { name: 'toxic_v2', seed: 'toxic-seed-1', profile: { typeKey: 'toxic', terrainVersion: 2 }, cx: -4, cz: 2 },
  { name: 'oceanic_v2', seed: 'sea-42', profile: { typeKey: 'oceanic', terrainVersion: 2 }, cx: 3, cz: -1 },
  { name: 'nordic_v2', seed: 'fjord-7', profile: { typeKey: 'nordic', terrainVersion: 2 }, cx: 0, cz: 0 }
];

var out = [];
for (var ci = 0; ci < CASES.length; ci++) {
  var c = CASES[ci];
  var gen = V.GenCore.create({ seed: c.seed, profile: c.profile });
  var offs = [[0, 0], [1, 0], [0, 1]];
  for (var oi = 0; oi < offs.length; oi++) {
    var s = gen.ensureShell(c.cx + offs[oi][0], c.cz + offs[oi][1]);
    gen.decorate(s);
    var flat = V.Sections.asFlat(s.blocks, CS, H, CS);
    out.push({
      case: c.name,
      cx: c.cx + offs[oi][0], cz: c.cz + offs[oi][1],
      heightsH: fnv1a(new Uint8Array(s.heights.buffer.slice(0))),
      // 与历史协议相同：对 Uint16 线性前缀做 FNV（按元素而非按字节）
      blocksTop80H: fnv1a(flat.subarray(0, CS * CS * 80)),
      blocksY80H: hashYBand(s.blocks, 80, 140, CS, H),
      blocksAllH: fnv1a(flat)
    });
  }
}
process.stdout.write(JSON.stringify(out, null, 2));
