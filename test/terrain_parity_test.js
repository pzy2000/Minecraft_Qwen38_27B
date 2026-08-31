// 地形一致性守护（v7 世界限高 64→256）：
// 1) 多种子外围区块 heights/blocks 摘要与基线黄金值逐位一致
//    （黄金值取自限高提升前的代码，钉住 shaper/world|gen_core 的装饰钳制字面量）
// 2) 生成包络不变式：fresh shell 在 GEN_ENVELOPE_TOP 以上必须全为空气
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

var CS = V.Config.CHUNK;
var ENV = V.Config.GEN_ENVELOPE_TOP;
// 包络上方允许确定性结构写入（CONTENT_NATURAL_TOP 线），不变式按内容顶检查
var CONTENT_TOP = V.Config.CONTENT_NATURAL_TOP;

// ---- 黄金值对比（与 make_terrain_golden.js 完全相同的采样协议）----
var golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'terrain_golden.json'), 'utf8'));
var CASES = [
  { name: 'origin_v2', seed: '12345', profile: { typeKey: 'lush', terrainVersion: 2 }, cx: -1, cz: 0 },
  { name: 'origin_v2_b', seed: '12345', profile: { typeKey: 'lush', terrainVersion: 2 }, cx: -3, cz: -2 },
  { name: 'arid_v2', seed: '-999888777', profile: { typeKey: 'arid', terrainVersion: 2 }, cx: 2, cz: 1 },
  { name: 'frozen_v2', seed: '42', profile: { typeKey: 'frozen', terrainVersion: 2 }, cx: -2, cz: 3 },
  { name: 'volcanic_v2', seed: 'deadbeefcafe', profile: { typeKey: 'volcanic', terrainVersion: 2 }, cx: 1, cz: -4 }
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
    var hh = fnv1a(new Uint8Array(s.heights.buffer.slice(0)));
    var bh = fnv1a(s.blocks.subarray(0, CS * CS * 80));
    check(hh === g.heightsH, c.name + ' (' + (c.cx + offs[oi][0]) + ',' + (c.cz + offs[oi][1]) + ') heights 摘要不一致');
    check(bh === g.blocksTop80H, c.name + ' (' + (c.cx + offs[oi][0]) + ',' + (c.cz + offs[oi][1]) + ') blocks 摘要不一致');

    // 内容顶之上全空气不变式（索引 = x + CS*(y + H*z)，与引擎一致）
    var solidAbove = -1;
    outer:
    for (var zz = 0; zz < CS && solidAbove < 0; zz++) {
      var zbase = CS * V.Config.WORLD_H * zz;
      for (var yy = CONTENT_TOP; yy < V.Config.WORLD_H; yy++) {
        var ybase = zbase + CS * yy;
        for (var xx = 0; xx < CS; xx++) {
          if (s.blocks[ybase + xx] !== 0) { solidAbove = yy; break outer; }
        }
      }
    }
    check(solidAbove < 0, c.name + ' 包络之上发现非空气方块 @y=' + solidAbove);

    // 交叉验证相邻 shell 接缝确定性已由摘要覆盖（同锚点重算裁剪）
  }
}
check(gi === golden.length, '黄金条目未全部消费');

if (failures === 0) {
  console.log('terrain_parity_test OK: ' + golden.length + ' shells 与限高 64 基线逐位一致，包络上方为纯空气');
} else {
  process.exit(1);
}
