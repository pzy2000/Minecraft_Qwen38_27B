// 北欧城堡峡湾全景的构图体检（Node，无浏览器）：
// 打印站点、关键构图距离、雪脊高度包络与几条竖向剖面，用于对齐参考照片。
//   node tools/check_nordic.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'js/config.js', 'js/world/seed.js', 'js/world/universe.js',
  'js/systems/atmosphere_profiles.js', 'js/world/noise.js', 'js/world/biomes.js',
  'js/world/planet_rules.js', 'js/world/shaper.js', 'js/world/structures.js',
  'js/world/gen_core.js', 'js/blocks.js', 'js/world/world.js', 'js/world/infinite.js'
];

// 与 test/smoke.js 一致：sandbox 自身即 window，脚本里的裸 Voxel 才能解析
const sandbox = {
  window: null, console: console, Math: Math, BigInt: BigInt,
  Uint8Array: Uint8Array, Uint16Array: Uint16Array, Uint32Array: Uint32Array,
  Int16Array: Int16Array, Float32Array: Float32Array,
  performance: { now: () => Date.now() }
};
sandbox.window = sandbox;
sandbox.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const V = sandbox.window.Voxel;

V.World.init('24601', { id: 'planet-0', kind: 'planet', typeKey: 'nordic', terrainVersion: 2 });
const vista = V.Structures.nearestVistaTo(0, 0, 6);
if (!vista) { console.log('未找到 vista 站点'); process.exit(1); }
const L = V.Structures.vistaLayout();
const CS = V.Config.CHUNK;

console.log('站点  ax=%d az=%d ah=%d score=%s', vista.ax, vista.az, vista.ah, vista.score.toFixed(2));
console.log('内容封顶 CONTENT_NATURAL_TOP=%d', V.Config.CONTENT_NATURAL_TOP);

// 预生成整个圆盘 + 余量
const r = L.diskR + 24;
for (let cx = Math.floor((vista.ax - r) / CS); cx <= Math.floor((vista.ax + r) / CS); cx++)
  for (let cz = Math.floor((vista.az - r) / CS); cz <= Math.floor((vista.az + r) / CS); cz++)
    V.World.ensureChunk(cx, cz);

function topAt(lx, lz) {
  for (let y = V.Config.WORLD_H - 1; y > 0; y--) {
    const id = V.World.get(vista.ax + lx, y, vista.az + lz);
    if (id !== 0) return { y, id };
  }
  return { y: 0, id: 0 };
}

const spawnZ = L.spawn.dz;
console.log('\n-- 构图距离（自出生点 z=%d 向北）--', spawnZ);
console.log('岸线   z=%d  距离 %d', L.lake.cz + L.lake.rz, spawnZ - (L.lake.cz + L.lake.rz));
console.log('岛心   z=%d  距离 %d', L.island.cz, spawnZ - L.island.cz);
// 与 structures.js 的 VISTA_RIDGE_FRONT 保持一致
const RIDGE_FRONT = L.diskCz - 30;
console.log('脊前缘 z=%d  距离 %d', RIDGE_FRONT, spawnZ - RIDGE_FRONT);
console.log('盘北缘 z=%d  距离 %d', L.diskCz - L.diskR, spawnZ - (L.diskCz - L.diskR));

console.log('\n-- 雪脊高度包络 --');
let peakTop = 0, peakAt = null, snowCount = 0;
for (let lx = -150; lx <= 150; lx += 2)
  for (let lz = L.diskCz - L.diskR + 4; lz <= L.diskCz - 50; lz += 2) {
    const t = topAt(lx, lz);
    if (t.y > peakTop) { peakTop = t.y; peakAt = [lx, lz]; }
    if (t.id === 18) snowCount++;
  }
console.log('最高点 y=%d (相对 ah +%d) 位于 [%d, %d]', peakTop, peakTop - vista.ah,
  peakAt ? peakAt[0] : 0, peakAt ? peakAt[1] : 0);
console.log('脊带雪顶采样命中 %d', snowCount);
console.log('是否越过内容封顶：%s', peakTop > V.Config.CONTENT_NATURAL_TOP ? '是（越界！）' : '否');

console.log('\n-- 出生点向北的地表剖面（每 12 格）--');
for (let lz = spawnZ; lz >= L.diskCz - L.diskR + 6; lz -= 12) {
  const t = topAt(L.spawn.dx, lz);
  console.log('  z=%s 距离=%s 顶y=%s 顶方块=%s(%s)',
    String(lz).padStart(5), String(spawnZ - lz).padStart(4), String(t.y).padStart(3),
    String(t.id).padStart(3), V.Blocks.name(t.id));
}

// 从出生眼位向北做逐列光栖：每个水平方位取"最高仰角"的地表点，
// 这就是画面里山脊剪影的实际来源（能分辨看到的是前缘还是远峰）。
console.log('\n-- 剪影来源（沿几条方位射线取最大仰角）--');
const EYE = { x: L.spawn.dx, y: vista.ah + 1.25 + 1.4 + 9, z: spawnZ };
for (const bearing of [-0.45, -0.25, 0, 0.25, 0.45]) {
  let bestAng = -9, bestD = 0, bestY = 0, bestId = 0;
  for (let d = 20; d <= 300; d += 2) {
    const lx = Math.round(EYE.x + Math.sin(bearing) * d);
    const lz = Math.round(EYE.z - Math.cos(bearing) * d);
    const t = topAt(lx, lz);
    if (!t.y) continue;
    const ang = Math.atan2(t.y - EYE.y, d);
    if (ang > bestAng) { bestAng = ang; bestD = d; bestY = t.y; bestId = t.id; }
  }
  console.log('  方位 %s rad → 最高仰角 %s° 距离 %d 顶y %d 方块 %s',
    bearing.toFixed(2), (bestAng * 57.2958).toFixed(1), bestD, bestY, V.Blocks.name(bestId));
}

console.log('\n-- 湖面注水校验 --');
for (const [lx, lz] of [[60, L.lake.cz], [-60, L.lake.cz], [0, 40], [110, 0], [0, -50]]) {
  let n = 0, surf = -1;
  for (let y = 1; y < 60; y++)
    if (V.World.get(vista.ax + lx, y, vista.az + lz) === 7) { n++; surf = y; }
  console.log('  [%s,%s] 水厚=%d 水面y=%d', lx, lz, n, surf);
}

console.log('\n-- 关键构件计数（圆盘内采样）--');
const tally = {};
for (let lx = -150; lx <= 150; lx += 3)
  for (let lz = L.diskCz - 150; lz <= L.diskCz + 150; lz += 3)
    for (let y = vista.ah - 8; y <= Math.min(V.Config.CONTENT_NATURAL_TOP, vista.ah + 60); y += 1) {
      const id = V.World.get(vista.ax + lx, y, vista.az + lz);
      if (id === 217 || id === 218 || id === 219 || id === 79 || id === 21 || id === 32)
        tally[id] = (tally[id] || 0) + 1;
    }
for (const k of Object.keys(tally).sort((a, b) => a - b))
  console.log('  %s %s = %d', k, V.Blocks.name(+k), tally[k]);
