// 网格构建 Worker（plan 5.1 · Step C）：发射循环整体移出主线程。
//
// 无状态设计：输入为 3×3 邻域的 pad 体素/光照快照（主线程 fillPad 的副本），
// 输出只由输入决定 —— 与主线程同步路径逐位一致（mesh_golden_test 守护），
// 因此无需世界/种子/编辑等任何运行态。
// 响应携带精确尺寸的 Transferable 缓冲；三组材质各自缺席时传 null。
//
// 与 gen_worker 同样的约定：Worker 全局没有 window，游戏脚本以
// `window.Voxel = ...` 挂载，先把 window 指向 self，importScripts 即可工作。
var window = self;

importScripts(
  '../config.js',
  '../blocks.js?v=' + (self.Voxel.Config.MESH_WORKER_V || 1),
  'mesh.js?v=' + (self.Voxel.Config.MESH_WORKER_V || 1)
);

Voxel.MeshBuilder._test.bindInline({
  get: function () { return 0; },
  getSky: function () { return 15; },
  getBlk: function () { return 0; }
});

function packGroup(v) {
  if (!v || !v.pos.length) return null;
  // slice 成精确尺寸缓冲，配合 Transferable 零拷贝移交主线程
  return {
    pos: v.pos.slice(), uv: v.uv.slice(), col: v.col.slice(),
    lgt: v.lgt.slice(), nrm: v.nrm.slice(), flg: v.flg.slice(), idx: v.idx.slice()
  };
}

self.onmessage = function (e) {
  var m = e.data;
  if (!m || m.type !== 'build') return;
  try {
    Voxel.MeshBuilder._test.installPad(m.snap);
    var r = Voxel.MeshBuilder._test.buildFromPad(m.cx, m.cz, m.yTop);
    var out = { type: 'mesh', jobId: m.jobId, o: packGroup(r.o), w: packGroup(r.w), fl: packGroup(r.fl) };
    var transfers = [];
    ['o', 'w', 'fl'].forEach(function (k2) {
      var g = out[k2];
      if (!g) return;
      for (var p in g) if (Object.prototype.hasOwnProperty.call(g, p)) transfers.push(g[p].buffer);
    });
    self.postMessage(out, transfers);
  } catch (err) {
    self.postMessage({ type: 'error', jobId: m.jobId, message: String(err && err.message || err) });
  }
};
