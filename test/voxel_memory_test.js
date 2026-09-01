// 5.2 体素内存基线：固定 keep 半径下打包字节 ≤ 扁柱 50%。
// 先对 GenCore 装饰后的 shell 做 fromFlat+compact，再（若已接线）量外围区块实存。
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
}
var sandbox = {
  window: {}, console: console, Math: Math, BigInt: BigInt,
  Uint8Array: Uint8Array, Uint16Array: Uint16Array, Uint32Array: Uint32Array,
  Int16Array: Int16Array, Float32Array: Float32Array,
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
var S = V.Sections;
var CFG = V.Config;
var CS = CFG.CHUNK, H = CFG.WORLD_H;
var failed = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  ' + name);
  else { console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); failed++; }
}

var CASES = [
  { seed: '12345', profile: { typeKey: 'lush', terrainVersion: 2 }, cx: -1, cz: 0 },
  { seed: '-999888777', profile: { typeKey: 'arid', terrainVersion: 2 }, cx: 2, cz: 1 },
  { seed: '42', profile: { typeKey: 'frozen', terrainVersion: 2 }, cx: -2, cz: 3 },
  { seed: 'deadbeefcafe', profile: { typeKey: 'volcanic', terrainVersion: 2 }, cx: 1, cz: -4 },
  { seed: 'toxic-seed-1', profile: { typeKey: 'toxic', terrainVersion: 2 }, cx: -4, cz: 2 },
  { seed: 'sea-42', profile: { typeKey: 'oceanic', terrainVersion: 2 }, cx: 3, cz: -1 },
  { seed: 'fjord-7', profile: { typeKey: 'nordic', terrainVersion: 2 }, cx: 0, cz: 0 }
];

var keep = CFG.STREAM_KEEP_RADIUS;
var nExtra = (2 * keep + 1) * (2 * keep + 1);
var denseBlocks = S.denseBytes(CS, H, CS, 2, 1);
var denseChunk = S.denseBytes(CS, H, CS, 1, 4); // u16 blocks + 2×u8 light ≈ 4 bytes/voxel
var packedSum = 0, flatSum = 0, n = 0;

for (var ci = 0; ci < CASES.length; ci++) {
  var c = CASES[ci];
  var gen = V.GenCore.create({ seed: c.seed, profile: c.profile });
  var shell = gen.ensureShell(c.cx, c.cz);
  gen.decorate(shell);
  var flat = S.asFlat(shell.blocks, CS, H, CS);
  var store = S.fromFlat(flat, CS, H, CS);
  var back = store.flatten();
  var ident = true;
  for (var i = 0; i < flat.length; i++) if (back[i] !== flat[i]) { ident = false; break; }
  check(c.profile.typeKey + ' pack 往返一致', ident);
  var pb = store.estimateBytes();
  packedSum += pb;
  flatSum += denseBlocks;
  n++;
  check(c.profile.typeKey + ' 单壳 blocks ≤50% 扁柱', pb <= denseBlocks * 0.5,
    'packed=' + pb + ' dense=' + denseBlocks);
}

var avgPacked = packedSum / n;
var keepPacked = avgPacked * nExtra;
var keepDense = denseChunk * nExtra;
check('keep=' + keep + ' 下 blocks 打包均值 ≤ 扁柱 50%', avgPacked <= denseBlocks * 0.5,
  'avgPacked=' + (avgPacked | 0) + ' keepPacked≈' + (keepPacked | 0) +
  ' keepDense=' + keepDense);

if (failed) process.exit(1);
console.log('voxel_memory_test OK: ' + n + ' shells, avg packed ' +
  (avgPacked | 0) + ' / dense ' + denseBlocks);
