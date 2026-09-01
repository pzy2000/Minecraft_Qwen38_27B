// Chunk LOD 回归（plan 5.4）：中/远景顶点数低于全精度，雾距视界 ≥ 512。
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
  'js/systems/discovery.js', 'js/crafting.js', 'js/world/world.js', 'js/world/infinite.js',
  'js/world/mesh.js'].forEach(load);

var V = sandbox.window.Voxel;
var failed = 0;
function check(name, cond) {
  if (cond) console.log('  ok  ' + name);
  else { console.log('  FAIL ' + name); failed++; }
}

console.log('LOD 半径与雾距');
check('LOD_FAR_RADIUS ≥ 16', (V.Config.LOD_FAR_RADIUS || 0) >= 16);
check('MESH_WORKER_POOL 在 2–4', V.Config.MESH_WORKER_POOL >= 2 && V.Config.MESH_WORKER_POOL <= 4);
V.World.init(12345);
while (!V.World.isReady()) V.World.generateNext(64);
check('fogHorizon ≥ 512', V.World.fogHorizon() >= 512);
check('lodFarRadius ≥ 16', V.World.lodFarRadius() >= 16);

console.log('LOD 几何降采样');
V.MeshBuilder._test.bindForTest();
var cx = 12, cz = 4;
for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++)
  V.World.ensureChunk(cx + dx, cz + dz);
if (V.World._test.flushLight) V.World._test.flushLight();
var full = V.MeshBuilder._test.buildArrays(cx, cz);
var mid = V.MeshBuilder._test.buildLodArrays(cx, cz, 1);
var far = V.MeshBuilder._test.buildLodArrays(cx, cz, 2);
var fullN = full.o.pos.length / 3;
var midN = mid.o.pos.length / 3;
var farN = far.o.pos.length / 3;
check('全精度有顶点 (' + fullN + ')', fullN > 0);
check('中景顶点数 < 全精度 (' + midN + ' < ' + fullN + ')', midN > 0 && midN < fullN);
check('远景顶点数 ≤ 中景 (' + farN + ' ≤ ' + midN + ')', farN > 0 && farN <= midN);
check('中景无水面组', mid.w.pos.length === 0);
check('远景无树叶组', far.fl.pos.length === 0);

console.log(failed ? ('LOD-FAIL (' + failed + ')') : 'LOD-PASS');
process.exit(failed ? 1 : 0);
