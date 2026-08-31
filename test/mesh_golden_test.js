// 网格几何黄金守护（plan 5.1 Step A 护栏）：
// MeshBuilder.buildArrays 输出与 test/mesh_golden.json 逐位一致。
// 覆盖三类地形各一个固定区块；摘要域为 float32 位型（与 GPU 上传一致）。
// 约束：
//   · Step B（typed 预分配）/ Step C（Worker 化）：全部哈希必须不变
//   · Step D（greedy meshing）：哈希有意改变 → 重建基线，但新顶点数必须
//     ≤ 基线记录的 preGreedyVtxO（几何合并只减不增，且不得丢失内容）
// 运行：node test/mesh_golden_test.js
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
load('js/world/gen_core.js');
load('js/blocks.js');
load('js/systems/discovery.js');
load('js/crafting.js');
load('js/world/world.js');
load('js/world/infinite.js');
load('js/world/mesh.js');

var V = sandbox.window.Voxel;
V.MeshBuilder._test.bindForTest();

var golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'mesh_golden.json'), 'utf8'));
var failures = 0;

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

// 用例表必须与 make_mesh_golden.js 完全一致
var CASES = [
  { name: 'plains', seed: '-999888777', profile: { typeKey: 'arid', terrainVersion: 2 }, cx: 2, cz: 1 },
  { name: 'mountain', seed: 'deadbeefcafe', profile: { typeKey: 'volcanic', terrainVersion: 2 }, cx: -5, cz: 6 },
  { name: 'forest', seed: '12345', profile: { typeKey: 'lush', terrainVersion: 2 }, cx: 15, cz: -11 }
];

function fail(msg) { console.error('FAIL: ' + msg); failures++; }

if (golden.length !== CASES.length) {
  fail('黄金条目数 ' + golden.length + ' 与用例数 ' + CASES.length + ' 不符');
} else {
  for (var ci = 0; ci < CASES.length; ci++) {
    var c = CASES[ci];
    var g = golden[ci];
    if (!g || g.name !== c.name || g.cx !== c.cx || g.cz !== c.cz) {
      fail('黄金序号错位 @' + c.name);
      continue;
    }
    V.World.init(c.seed, c.profile);
    for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++)
      V.World.ensureChunk(c.cx + dx, c.cz + dz);
    for (var s = 0; s < 30; s++) V.World.stream(16, null);
    var r = V.MeshBuilder._test.buildArrays(c.cx, c.cz);
    var groups = { o: hashGroup(r.o), w: hashGroup(r.w), fl: hashGroup(r.fl) };
    ['o', 'w', 'fl'].forEach(function (key) {
      var got = groups[key], want = g[key];
      if (got.vtx !== want.vtx)
        fail(c.name + '/' + key + ' 顶点数 ' + got.vtx + ' ≠ 基线 ' + want.vtx);
      else if (got.idxN !== want.idxN)
        fail(c.name + '/' + key + ' 索引数 ' + got.idxN + ' ≠ 基线 ' + want.idxN);
      else {
        ['posH', 'uvH', 'colH', 'lgtH', 'nrmH', 'flgH', 'idxH'].forEach(function (f) {
          if (got[f] !== want[f]) fail(c.name + '/' + key + '.' + f + ' 摘要不一致 (' + got[f] + ' ≠ ' + want[f] + ')');
        });
      }
    });
    // greedy 之后的基线重建仍受此约束：顶点数不得高于改造前旧值
    if (g.preGreedyVtxO !== undefined && groups.o.vtx > g.preGreedyVtxO)
      fail(c.name + ' opaque 顶点数 ' + groups.o.vtx + ' 高于改造前 ' + g.preGreedyVtxO);
  }
}

if (failures === 0) {
  console.log('mesh_golden_test OK: ' + golden.length + ' 个代表区块几何输出逐位一致');
} else {
  process.exit(1);
}
