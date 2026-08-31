// 本地帧时遥测：零后端、零网络请求、零持久化（离线/file:// 硬约束不变）。
// 目的（plan 8.5 · 阶段 0 可观测性）：真实设备上回答"p95 帧时是多少、
// 哪些设备最差"，让第一梯队的性能改造有可验证的基线，而不是盲目优化。
// 设计：
//   · 环形缓冲只存最近 ~2400 个渲染帧间隔（ms），常数内存，页面关闭即消失
//   · 计数器：JS 异常 / Promise 拒绝 / WebGL 上下文丢失（仅计数，不上报）
//   · 不采集任何个人信息；GPU 型号用于分设备聚合性能数据
// 用法：
//   · Voxel.Telemetry.snapshot()      → 返回 JSON 快照（含 p50/p95/p99）
//   · Voxel.Telemetry.dump()          → 快照打印到控制台
//   · URL 带 ?telemetry=1             → 启动后每 30 秒自动 dump 一次
window.Voxel = window.Voxel || {};

Voxel.Telemetry = (function () {
  'use strict';

  var CAP = 2400;
  var buf = new Float32Array(CAP);
  var head = 0, n = 0;
  var errors = 0, rejections = 0, ctxLost = 0;
  var _gpu;

  // 主循环按实际渲染帧间隔调用；非有限/负值/超长（标签页挂起恢复）丢弃
  function noteFrame(deltaMs) {
    if (typeof deltaMs !== 'number' || !isFinite(deltaMs) ||
      deltaMs < 0 || deltaMs > 5000) return;
    buf[head] = Math.round(deltaMs * 100) / 100;
    head = (head + 1) % CAP;
    if (n < CAP) n++;
  }

  function gpuInfo() {
    if (_gpu !== undefined) return _gpu;
    _gpu = '';
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl2') || c.getContext('webgl');
      if (gl) {
        var ext = gl.getExtension('WEBGL_debug_renderer_info');
        _gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER));
      }
    } catch (e) { _gpu = ''; }
    return _gpu;
  }

  function percentile(sorted, p) {
    if (!sorted.length) return null;
    var i = Math.min(sorted.length - 1, Math.floor((sorted.length - 1 + 1e-9) * p));
    return sorted[i];
  }

  // 快照：排序副本开销 O(n log n)，仅在显式调用时发生，不在热路径
  function snapshot() {
    var a = Array.prototype.slice.call(buf.subarray(0, n))
      .sort(function (x, y) { return x - y; });
    var mean = null;
    if (a.length) {
      var s = 0;
      for (var i = 0; i < a.length; i++) s += a[i];
      mean = Math.round(s / a.length * 100) / 100;
    }
    return {
      t: new Date().toISOString(),
      device: {
        ua: navigator.userAgent,
        cores: navigator.hardwareConcurrency || null,
        dpr: window.devicePixelRatio || 1,
        gpu: gpuInfo(),
        viewport: { w: window.innerWidth, h: window.innerHeight },
        touch: ('ontouchstart' in window)
      },
      frames: n,
      coverageSec: Math.round(a.length ? s / 1000 : 0),
      fpsMean: mean ? Math.round(1000 / mean * 10) / 10 : null,
      ftMs: { p50: percentile(a, 0.5), p95: percentile(a, 0.95), p99: percentile(a, 0.99), worst: percentile(a, 1), mean: mean },
      errors: errors,
      rejections: rejections,
      ctxLost: ctxLost
    };
  }

  function dump() {
    console.log('[Telemetry]', JSON.stringify(snapshot(), null, 2));
  }

  // 导出为可下载的 JSON 文件（玩家手动分享给开发者；零网络上传）
  function exportReport() {
    var json = JSON.stringify(snapshot(), null, 2);
    try {
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'perf-report-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (e) {
      // Blob/下载不可用（老 WebView 等）：退回复制到剪贴板，再不行只有控制台
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(json);
          return true;
        }
      } catch (e2) { }
      dump();
      return false;
    }
  }

  function countContextLost() { ctxLost++; }

  function init() {
    if (window.addEventListener) {
      window.addEventListener('error', function () { errors++; }, false);
      window.addEventListener('unhandledrejection', function () { rejections++; }, false);
    }
    if (typeof location !== 'undefined' && /[?&]telemetry=1/.test(location.search)) {
      setInterval(dump, 30000);
    }
  }

  var api = {
    noteFrame: noteFrame,
    snapshot: snapshot,
    dump: dump,
    exportReport: exportReport,
    countContextLost: countContextLost
  };
  init();
  return api;
})();
