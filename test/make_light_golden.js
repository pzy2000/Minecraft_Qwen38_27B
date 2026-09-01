// 重建 test/light_golden.json。运行：node test/make_light_golden.js
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

['js/config.js', 'js/world/seed.js', 'js/world/universe.js', 'js/world/galaxy.js',
  'js/systems/atmosphere_profiles.js', 'js/world/noise.js', 'js/world/biomes.js',
  'js/world/planet_rules.js', 'js/world/shaper.js', 'js/world/structures.js',
  'js/world/sections.js', 'js/world/gen_core.js', 'js/blocks.js', 'js/world/light.js',
  'js/systems/discovery.js', 'js/crafting.js', 'js/world/world.js', 'js/world/infinite.js'
].forEach(load);

var V = sandbox.window.Voxel;
var CASES = [
  { name: 'plains', seed: '-999888777', profile: { typeKey: 'arid', terrainVersion: 2 }, cx: 9, cz: 2 },
  { name: 'mountain', seed: 'deadbeefcafe', profile: { typeKey: 'volcanic', terrainVersion: 2 }, cx: -5, cz: 6 },
  { name: 'forest', seed: '12345', profile: { typeKey: 'lush', terrainVersion: 2 }, cx: 15, cz: -11 },
  { name: 'torch-seam', seed: '12345', profile: { typeKey: 'lush', terrainVersion: 2 }, cx: 12, cz: 4, torch: true }
];

var out = [];
for (var i = 0; i < CASES.length; i++) {
  var c = CASES[i];
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
  out.push({
    name: c.name, cx: c.cx, cz: c.cz,
    skyH: V.Light.hashVolume(ch.sky, ch.contentTop),
    blkH: V.Light.hashVolume(ch.blk, ch.contentTop),
    emitN: ch.emit.length
  });
  console.log(c.name, out[out.length - 1]);
}

fs.writeFileSync(path.join(__dirname, 'light_golden.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote test/light_golden.json');
