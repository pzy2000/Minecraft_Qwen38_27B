// 地形一致性守护（v7 世界限高 64→256 + 5.2 Y 分段）：
// 1) 多种子/行星类型外围区块 heights/blocks 摘要与黄金值逐位一致
// 2) 生成包络不变式：内容顶以上必须全为空气
// 3) 高 Y 带（80–140）与全柱摘要：防止分段存储只覆盖低层
// 运行：node test/terrain_parity_test.js
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
var failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('FAIL: ' + msg); }
}

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
var CONTENT_TOP = V.Config.CONTENT_NATURAL_TOP;

var golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'terrain_golden.json'), 'utf8'));
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

var gi = 0;
for (var ci = 0; ci < CASES.length; ci++) {
  var c = CASES[ci];
  var gen = V.GenCore.create({ seed: c.seed, profile: c.profile });
  var offs = [[0, 0], [1, 0], [0, 1]];
  for (var oi = 0; oi < offs.length; oi++) {
    var s = gen.ensureShell(c.cx + offs[oi][0], c.cz + offs[oi][1]);
    gen.decorate(s);
    var g = golden[gi++];
    check(g && g.case === c.name && g.cx === c.cx + offs[oi][0] && g.cz === c.cz + offs[oi][1],
      'golden 序号错位 @' + c.name);
    var flat = V.Sections.asFlat(s.blocks, CS, H, CS);
    var hh = fnv1a(new Uint8Array(s.heights.buffer.slice(0)));
    var bh = fnv1a(flat.subarray(0, CS * CS * 80));
    var y80 = hashYBand(s.blocks, 80, 140, CS, H);
    var allH = fnv1a(flat);
    check(hh === g.heightsH, c.name + ' (' + (c.cx + offs[oi][0]) + ',' + (c.cz + offs[oi][1]) + ') heights 摘要不一致');
    check(bh === g.blocksTop80H, c.name + ' (' + (c.cx + offs[oi][0]) + ',' + (c.cz + offs[oi][1]) + ') blocks 摘要不一致');
    check(y80 === g.blocksY80H, c.name + ' (' + (c.cx + offs[oi][0]) + ',' + (c.cz + offs[oi][1]) + ') y80–140 摘要不一致');
    check(allH === g.blocksAllH, c.name + ' (' + (c.cx + offs[oi][0]) + ',' + (c.cz + offs[oi][1]) + ') 全柱摘要不一致');

    var solidAbove = -1;
    outer:
    for (var zz = 0; zz < CS && solidAbove < 0; zz++) {
      for (var yy = CONTENT_TOP; yy < H; yy++) {
        for (var xx = 0; xx < CS; xx++) {
          if (V.Sections.read(s.blocks, xx, yy, zz, CS, H) !== 0) { solidAbove = yy; break outer; }
        }
      }
    }
    check(solidAbove < 0, c.name + ' 包络之上发现非空气方块 @y=' + solidAbove);
  }
}
check(gi === golden.length, '黄金条目未全部消费');

if (failures === 0) {
  console.log('terrain_parity_test OK: ' + golden.length + ' shells 与黄金逐位一致（含高 Y / 全柱），包络上方为纯空气');
} else {
  process.exit(1);
}
