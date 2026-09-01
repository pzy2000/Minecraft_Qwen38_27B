// 生成网格几何黄金校验值：固定种子×三种地形（平原/山地/森林）各一个区块，
// 对 MeshBuilder 纯数组输出（pos/uv/col/lgt/nrm/flg/idx）做逐位摘要。
// 用途：plan 5.1——typed 预分配（Step B）与 Worker 化（Step C）必须保持
// 输出逐位一致；greedy（Step D）会有意改变布局，届时重建基线并以
// preGreedyVtx 字段钉住下降幅度上限（新顶点数不得高于旧值）。
// 用法：node test/make_mesh_golden.js > test/mesh_golden.json
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
load('js/systems/discovery.js');
load('js/crafting.js');
load('js/world/world.js');
load('js/world/infinite.js');
load('js/world/mesh.js');

var V = sandbox.window.Voxel;
V.MeshBuilder._test.bindForTest();

// 与 make_terrain_golden 同源的种子集；区块坐标取三类地形的代表点
// （探针实测：平原含少量水、山地陡峭、森林树冠密集）
var CASES = [
  { name: 'plains', seed: '-999888777', profile: { typeKey: 'arid', terrainVersion: 2 }, cx: 2, cz: 1 },
  { name: 'mountain', seed: 'deadbeefcafe', profile: { typeKey: 'volcanic', terrainVersion: 2 }, cx: -5, cz: 6 },
  { name: 'forest', seed: '12345', profile: { typeKey: 'lush', terrainVersion: 2 }, cx: 15, cz: -11 }
];

var CS = V.Config.CHUNK;

function loadChunkNeighborhood(cx, cz) {
  for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++)
    V.World.ensureChunk(cx + dx, cz + dz);
  // 排空延迟重光与生成队列（MeshBuilder 未 init ⇒ canMesh=false，纯数据路径）
  for (var s = 0; s < 30; s++) V.World.stream(16, null);
}

// 摘要域：所有浮点先经 fround 落到 float32 位型 —— 顶点上 GPU 本来就是
// Float32，这一步保证「JS 增长数组」与后续 typed staging/Worker 传输的
// 摘要完全同域。
var _f32 = new Float32Array(1);
var _u32 = new Uint32Array(_f32.buffer);
function f32bits(x) { _f32[0] = x; return _u32[0]; }

function fnv1a(h, words) {
  for (var i = 0; i < words.length; i++) {
    var w = words[i] >>> 0;
    h ^= w & 0xff; h = Math.imul(h, 16777619) >>> 0;
    h ^= (w >>> 8) & 0xff; h = Math.imul(h, 16777619) >>> 0;
    h ^= (w >>> 16) & 0xff; h = Math.imul(h, 16777619) >>> 0;
    h ^= (w >>> 24) & 0xff; h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function hashGroup(a) {
  return {
    vtx: a.pos.length / 3,
    idxN: a.idx.length,
    posH: fnv1a(0x811c9dc5, Array.prototype.map.call(a.pos, f32bits)),
    uvH: fnv1a(0x811c9dc5, Array.prototype.map.call(a.uv, f32bits)),
    colH: fnv1a(0x811c9dc5, Array.prototype.map.call(a.col, f32bits)),
    lgtH: fnv1a(0x811c9dc5, Array.prototype.map.call(a.lgt, f32bits)),
    nrmH: fnv1a(0x811c9dc5, Array.prototype.map.call(a.nrm, f32bits)),
    flgH: fnv1a(0x811c9dc5, Array.prototype.map.call(a.flg, f32bits)),
    idxH: fnv1a(0x811c9dc5, a.idx)
  };
}

var out = [];
for (var ci = 0; ci < CASES.length; ci++) {
  var c = CASES[ci];
  V.World.init(c.seed, c.profile);
  loadChunkNeighborhood(c.cx, c.cz);
  var r = V.MeshBuilder._test.buildArrays(c.cx, c.cz);
  out.push({
    name: c.name, cx: c.cx, cz: c.cz,
    // Step D 回填：greedy 完成前的旧基线顶点数，供降幅验收
    preGreedyVtxO: r.o.pos.length / 3,
    o: hashGroup(r.o),
    w: hashGroup(r.w),
    fl: hashGroup(r.fl)
  });
}
process.stdout.write(JSON.stringify(out, null, 2));
