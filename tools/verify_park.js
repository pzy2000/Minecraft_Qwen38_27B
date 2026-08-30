// 园区结构验证（node）：cellPark 命中率、buildPark 确定性、y 边界与 ID 合法性
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
}
var sandbox = { console: console, Math: Math, BigInt: BigInt, Uint8Array: Uint8Array,
  Uint32Array: Uint32Array, Int16Array: Int16Array, Float32Array: Float32Array };
sandbox.window = sandbox;
vm.createContext(sandbox);
['js/config.js', 'js/world/seed.js', 'js/world/noise.js', 'js/world/biomes.js',
 'js/world/planet_rules.js', 'js/world/shaper.js', 'js/world/structures.js',
 'js/blocks.js', 'js/world/gen_core.js'].forEach(load);
var V = sandbox.Voxel;

var SEED = '12345';
var CS = V.Config.CHUNK;

function makeGen(seed) {
  return V.GenCore.create({ seed: seed, profile: { typeKey: 'lush', terrainVersion: 2 } });
}
var gen = makeGen(SEED);

// 绑定结构上下文（与 gen_worker/infinite 一致的注入协议）
V.Structures.bind({
  hash2: function (x, z) {
    var h = (Math.imul(x | 0, 2654435761) ^ Math.imul(z | 0, 40503)) >>> 0;
    h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0; h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  },
  surfaceAt: gen.surfaceAt,
  biomeAt: gen.biomeAt,
  typeKey: 'lush',
  version: 2
});

// ---- 1. cellPark 扫描：记录命中与门控失败原因分布 ----
var PC = V.Structures.PARK_CELL;
var found = [];
for (var cxr = -40; cxr <= 40 && found.length < 6; cxr++) {
  for (var czr = -40; czr <= 40 && found.length < 6; czr++) {
    var p = V.Structures.cellPark(cxr, czr);
    if (p) found.push({ cx: cxr, cz: czr, ax: p.ax, az: p.az, ah: p.ah, rot: p.rot });
  }
}
console.log('命中园区数(48×48 cells):', found.length);
found.forEach(function (p) { console.log('  ', JSON.stringify(p)); });
if (!found.length) { console.error('FAIL: 未找到任何园区'); process.exit(1); }

// ---- 2. buildPark 全量枚举：确定性 / 合法性 / 高度 ----
function enumerate(park) {
  var ops = [];
  // 绑定到"全目标放行"的假 shell 世界，直接收集操作流
  V.Structures.buildPark(park, function (x, y, z, id, mode) {
    ops.push([x, y, z, id]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
      throw new Error('非有限坐标');
    if (!Number.isInteger(id) || id < 0 || id > 90 || !V.Blocks.defs[id])
      throw new Error('非法方块 ID ' + id);
    if (y <= 0 || y >= V.Config.WORLD_H) throw new Error('越界写入 y=' + y);
    if (y > V.Config.CONTENT_NATURAL_TOP)
      throw new Error('超过内容顶 y=' + y + ' > ' + V.Config.CONTENT_NATURAL_TOP);
  });
  var hash = ops.length + ':';
  for (var i = 0; i < ops.length; i++) {
    var o = ops[i];
    hash += ((o[0] * 73856093) ^ (o[1] * 19349663) ^ (o[2] * 83492791) ^ (o[3] * 2654435761)) +
      ',';
  }
  return { n: ops.length, hash: hash };
}

var f1 = enumerate(found[0] && V.Structures.cellPark(found[0].cx, found[0].cz));
var f2 = enumerate(V.Structures.cellPark(found[0].cx, found[0].cz));
if (f1.hash !== f2.hash) { console.error('FAIL: buildPark 非确定性'); process.exit(1); }
console.log('buildPark 确定 ✓ 操作数:', f1.n);

// 每个命中园区的站点参数合法性
found.forEach(function (p) {
  var park = V.Structures.cellPark(p.cx, p.cz);
  var st = V.Structures.parkStations(park);
  var boards = V.Structures.boardPositions(park);
  if (st.length !== 7 || boards.length !== 6)
    throw new Error('站点数量异常: stations=' + st.length + ' boards=' + boards.length);
  st.forEach(function (s) {
    if (s.kind !== 'castle') {
      if (!s.board) throw new Error(s.kind + ' 缺少乘坐台');
      var dx = s.board.x - s.cx, dz = s.board.z - s.cz;
      if (s.kind === 'ferris' && (dx * dx + dz * dz) > 400) throw new Error('摩天轮乘坐台离轴过远');
    }
  });
});
console.log('parkStations/boardPositions 合法 ✓');

// ---- 3. 落入真实区块裁剪后的完整性：用真实 GenCore store 执行 buildPark ----
(function () {
  var park = V.Structures.cellPark(found[0].cx, found[0].cz);
  var PE = V.Structures.PARK_EXTENT;
  var touched = 0;
  var chunkMinX = Math.floor((park.ax - PE) / CS), chunkMaxX = Math.floor((park.ax + PE) / CS);
  var chunkMinZ = Math.floor((park.az - PE) / CS), chunkMaxZ = Math.floor((park.az + PE) / CS);
  for (var ccx = chunkMinX; ccx <= chunkMaxX; ccx++)
    for (var ccz = chunkMinZ; ccz <= chunkMaxZ; ccz++) {
      var sh = gen.ensureShell(ccx, ccz);
      var before = sh.decorated;
      gen.decorate(sh);
      if (!before) touched++;
    }
  console.log('装饰完成, 新装饰区块数:', touched);
  // 校验某几个标志性方块真实落在 world 里：从 boardPositions 抽乘坐台
  var boards = V.Structures.boardPositions(park);
  boards.forEach(function (b) {
    var cid = gen.blockAt(b.x, b.y, b.z);
    if (cid !== 85)
      console.warn('WARN 乘坐台不是 PAD 实际=' + cid + ' @', b.kind, b.x, b.y, b.z);
  });
  var chest = V.Structures.parkChests(park)[0];
  var chestId = gen.blockAt(chest.x, chest.y, chest.z);
  console.log('售票亭宝箱方块:', chestId === 38 ? '箱子 ✓' : 'FAIL id=' + chestId);
  var loot = V.Structures.chestLootAt(chest.x, chest.y, chest.z);
  console.log('宝箱反查战利品:', loot ? loot.filter(Boolean).map(function (it) { return V.Blocks.name(it.id) + 'x' + it.n; }).join(', ') : 'FAIL null');

  // ---- 5. 城堡内装 + 套圈断言（首个园区） ----
  var park0 = V.Structures.cellPark(found[0].cx, found[0].cz);
  var L = V.Structures.parkLayout();
  var PXf = function (park, dx, dz) {
    switch (park.rot & 3) {
      case 1: return [park.ax + dz, park.az - dx];
      case 2: return [park.ax - dx, park.az - dz];
      case 3: return [park.ax - dz, park.az + dx];
      default: return [park.ax + dx, park.az + dz];
    }
  };
  var ah0 = park0.ah;
  var kc = PXf(park0, L.castle.c[0], L.castle.c[1]);
  var G = function (x, y, z) { return gen.blockAt(x, y, z); };
  // 正门 3 宽 4 高洞（dz+ 侧，考虑 rot：门开在局部 +z 面即世界面按 rot 旋转）
  var doorWorld = [
    PXf(park0, L.castle.c[0] - 1, L.castle.c[1] + 6),
    PXf(park0, L.castle.c[0], L.castle.c[1] + 6),
    PXf(park0, L.castle.c[0] + 1, L.castle.c[1] + 6)
  ];
  var doorOK = doorWorld.every(function (p) {
    return G(p[0], ah0 + 1, p[1]) === 0 && G(p[0], ah0 + 2, p[1]) === 0 &&
      G(p[0], ah0 + 3, p[1]) === 0 && G(p[0], ah0 + 4, p[1]) === 0;
  });
  console.log('城堡正门 3×4 洞:', doorOK ? '✓' : 'FAIL');
  // 彩玻存在（任一彩玻 ID 88/89/90 出现在城堡区）
  var stainedFound = 0;
  for (var sx4 = -7; sx4 <= 7; sx4++)
    for (var sz4 = -7; sz4 <= 7; sz4++)
      for (var sy4 = 1; sy4 <= 10; sy4++) {
        var cp = PXf(park0, L.castle.c[0] + sx4, L.castle.c[1] + sz4);
        var bid = G(cp[0], ah0 + sy4, cp[1]);
        if (bid === 88 || bid === 89 || bid === 90) stainedFound++;
      }
  console.log('彩玻窗块数(≥8):', stainedFound, stainedFound >= 8 ? '✓' : 'FAIL');
  // 王座金饰（局部 (0,-5) y2..5）
  var tw = PXf(park0, L.castle.c[0], L.castle.c[1] - 5);
  var throneOK = [2, 3, 4, 5].every(function (ty) { return G(tw[0], ah0 + ty, tw[1]) === 78; });
  console.log('王座金饰靠背:', throneOK ? '✓' : 'FAIL ' + G(tw[0], ah0 + 3, tw[1]));
  // 宽体楼梯可达性：从门内 y0 沿楼梯逐级扫描到观景台 y21
  var stairReach = (function () {
    // 简化 BFS：可站 = 目标格空气且脚下实体；起点门内 (0,+5)
    var start = PXf(park0, L.castle.c[0], L.castle.c[1] + 5);
    var seen = {};
    var q = [[start[0], ah0 + 1, start[1]]];
    var goalY = ah0 + 22, reached = false;   // 观景台地板 y21，站立位 y22
    var guard = 0;
    while (q.length && guard++ < 20000) {
      var cur = q.shift();
      var kx = cur[0] + ',' + cur[1] + ',' + cur[2];
      if (seen[kx]) continue;
      seen[kx] = 1;
      if (cur[1] >= goalY) { reached = true; break; }
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = cur[0] + d[0], nz = cur[2] + d[1];
        // 平走 / 上 1-2 级 / 下 1-3 级（楼梯语义）
        [0, 1, 2, -1, -2, -3].forEach(function (dy) {
          var ny = cur[1] + dy;
          if (ny > goalY + 2) return;
          if (G(nx, ny, nz) === 0 && G(nx, ny + 1, nz) === 0 &&
            G(nx, ny - 1, nz) !== 0) q.push([nx, ny, nz]);
        });
      });
    }
    return reached;
  })();
  console.log('楼梯可达观景台 y21:', stairReach ? '✓' : 'FAIL');
  // 套圈柱：3 根柱头金饰
  var toss = V.Structures.parkTossStall(park0);
  var pegsOK = toss.pegs.every(function (pg) {
    return G(pg.x, pg.topY, pg.z) === 78;
  });
  console.log('套圈 3 柱头金饰:', pegsOK ? '✓' : 'FAIL');
  if (!doorOK || stainedFound < 8 || !throneOK || !stairReach || !pegsOK) process.exit(1);
})();

console.log('PARK-VERIFY-PASS');
