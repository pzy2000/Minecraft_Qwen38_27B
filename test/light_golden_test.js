// 光照黄金守护（plan 5.3 Step A）：
// ensureChunk + flushLight 后 sky/blk 体积哈希与 test/light_golden.json 逐位一致。
// 另：Voxel.Light.scanColumnSky 对同一 blocks 复算必须与区块 sky 一致。
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
}

var sandbox = {
  window: {},
  console: console,
  Math: Math, BigInt: BigInt,
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
var _store = {};
sandbox.localStorage = {
  setItem: function (k, v) { _store[k] = String(v); },
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null; },
  removeItem: function (k) { delete _store[k]; }
};
vm.createContext(sandbox);

load('js/config.js');
load('js/world/seed.js');
load('js/world/universe.js');
load('js/world/galaxy.js');
load('js/systems/atmosphere_profiles.js');
load('js/world/noise.js');
load('js/world/biomes.js');
load('js/world/planet_rules.js');
load('js/world/shaper.js');
load('js/world/structures.js');
load('js/world/sections.js');
load('js/world/gen_core.js');
load('js/blocks.js');
load('js/world/light.js');
load('js/systems/discovery.js');
load('js/crafting.js');
load('js/world/world.js');
load('js/world/infinite.js');

var V = sandbox.window.Voxel;
var golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'light_golden.json'), 'utf8'));
var failures = 0;

var CASES = [
  { name: 'plains', seed: '-999888777', profile: { typeKey: 'arid', terrainVersion: 2 }, cx: 9, cz: 2 },
  { name: 'mountain', seed: 'deadbeefcafe', profile: { typeKey: 'volcanic', terrainVersion: 2 }, cx: -5, cz: 6 },
  { name: 'forest', seed: '12345', profile: { typeKey: 'lush', terrainVersion: 2 }, cx: 15, cz: -11 },
  { name: 'torch-seam', seed: '12345', profile: { typeKey: 'lush', terrainVersion: 2 }, cx: 12, cz: 4, torch: true }
];

function fail(msg) { console.error('FAIL: ' + msg); failures++; }

if (golden.length !== CASES.length) {
  fail('黄金条目数 ' + golden.length + ' 与用例数 ' + CASES.length + ' 不符');
} else {
  for (var ci = 0; ci < CASES.length; ci++) {
    var c = CASES[ci];
    var g = golden[ci];
    if (!g || g.name !== c.name) { fail('黄金序号错位 @' + c.name); continue; }
    V.World.init(c.seed, c.profile);
    while (!V.World.isReady()) V.World.generateNext(64);
    for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++)
      V.World.ensureChunk(c.cx + dx, c.cz + dz);
    if (c.torch) {
      var wx = c.cx * V.Config.CHUNK + 16;
      var wz = c.cz * V.Config.CHUNK + 16;
      var y = V.World.surfaceAt(wx, wz) + 1;
      V.World.set(wx, y, wz, 19);
    }
    if (V.World._test.flushLight) V.World._test.flushLight();
    var ch = V.World._test.chunk(c.cx, c.cz);
    if (!ch || !ch.ready) { fail(c.name + ' 区块未就绪'); continue; }
    var skyH = V.Light.hashVolume(ch.sky, ch.contentTop);
    var blkH = V.Light.hashVolume(ch.blk, ch.contentTop);
    if (skyH !== g.skyH) fail(c.name + ' skyH ' + skyH + ' ≠ ' + g.skyH);
    if (blkH !== g.blkH) fail(c.name + ' blkH ' + blkH + ' ≠ ' + g.blkH);
    if (ch.emit.length !== g.emitN) fail(c.name + ' emitN ' + ch.emit.length + ' ≠ ' + g.emitN);

    var sky2 = V.Sections.create(V.Config.CHUNK, V.Config.WORLD_H, V.Config.CHUNK, 1);
    var blk2 = V.Sections.create(V.Config.CHUNK, V.Config.WORLD_H, V.Config.CHUNK, 1);
    V.Light.scanColumnSky(ch.blocks, sky2, blk2, ch.contentTop);
    var skyH2 = V.Light.hashVolume(sky2, ch.contentTop);
    if (skyH2 !== skyH && !c.torch)
      fail(c.name + ' 复算列天光与区块 sky 不一致 (' + skyH2 + ' ≠ ' + skyH + ')');
  }
}

if (failures === 0) {
  console.log('light_golden_test OK: ' + golden.length + ' 个代表区块 sky/blk 哈希一致');
} else {
  process.exit(1);
}
