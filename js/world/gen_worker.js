// 地形生成 Worker（P2）：base 密度生成 + 确定性装饰在后台线程执行。
//
// 与主线程共用 js/world/gen_core.js 的同一实现，保证逐位一致的世界；
// 传输采用结构化克隆副本（不 transfer 原缓冲，Worker 内 shell 仍被后续
// halo 查询复用）。光照/编辑/网格仍由主线程统一处理。
// Worker 全局没有 window：游戏脚本以 `window.Voxel = ...` 挂载，
// 先把 window 指向 WorkerGlobalScope（self），后续 importScripts 即可照常工作。
var window = self;

importScripts(
  '../config.js',
  'seed.js',
  'noise.js',
  'biomes.js',
  'planet_rules.js',
  'shaper.js',
  '../blocks.js',
  'structures.js',
  'gen_core.js'
);

var gen = null;

self.onmessage = function (e) {
  var m = e.data;
  if (!m) return;
  if (m.type === 'init') {
    try {
      gen = Voxel.GenCore.create({ seed: m.seed, profile: m.profile });
      // 外星巨树/遗迹只绑定行星模式 + terrainVersion=2（与主线程 init 一致）
      var planetMode = !m.profile || m.profile.kind !== 'station';
      if (Voxel.Structures) {
        Voxel.Structures.bind(planetMode && gen.terrainVersion === 2 ? {
          hash2: gen.noise.hash2,
          surfaceAt: gen.surfaceAt,
          biomeAt: gen.biomeAt,
          typeKey: gen.planetTypeKey,
          version: gen.terrainVersion
        } : null);
      }
      self.postMessage({ type: 'ready', epoch: m.epoch });
    } catch (err) {
      // 初始化失败：让主线程经 onerror/超时回退同步路径
      self.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
    return;
  }
  if (m.type === 'job' && gen) {
    var shell = gen.ensureShell(m.cx, m.cz);
    gen.decorate(shell);
    // 拷贝后传输（transfer 零拷贝移交）：Worker 内的 shell 数组还要服务后续任务的 halo 查询
    var blocks = shell.blocks.slice();
    var heights = shell.heights.slice();
    var biomes = shell.biomes.slice();
    self.postMessage({
      type: 'chunk', epoch: m.epoch, jobId: m.jobId,
      cx: m.cx, cz: m.cz,
      blocks: blocks.buffer,
      heights: heights.buffer,
      biomes: biomes.buffer
    }, [blocks.buffer, heights.buffer, biomes.buffer]);
  }
};
