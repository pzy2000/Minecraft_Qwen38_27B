// 气候点搜索实验（node，临时工具）：为星海嘉年华寻找五维空隙点，
// 要求种子 12345 主活动窗内出现连片干地。用法：node tools/find_biome_point.js
'use strict';
global.window = global;
global.Voxel = {};
require('../js/config.js');
require('../js/world/seed.js');
require('../js/world/noise.js');
require('../js/world/biomes.js');
require('../js/world/shaper.js');

var V = Voxel;
var noise = V.Noise.create('12345');
var climate = V.Biomes.makeClimate(noise);
var shaper = V.Shaper.create(noise);
var WATER = V.Config.WATER_LEVEL;

// 目标高度近似（与 shaper.targetHeight 相同管线）
function heightAt(x, z) {
  var cl = climate(x, z);
  return { h: shaper.targetHeight(x, z, cl), cl: cl };
}

var cands = [
  [0.4, -0.62, 0.02, 0.82, 0.68],
  [0.42, -0.55, 0.06, 0.85, 0.72],
  [0.36, -0.48, 0.1, 0.88, 0.78],
  [0.3, -0.4, 0.12, 0.9, 0.82],
  [0.5, -0.5, 0.0, 0.8, 0.6],
  [0.25, -0.6, 0.08, 0.86, 0.66],
  [0.18, -0.52, 0.15, 0.84, 0.74]
];

var STEP = 3;
for (var ci = 0; ci < cands.length; ci++) {
  var P = cands[ci];
  var total = 0, land = 0, dryLand = 0;
  var minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (var x = -30; x < 286; x += STEP) {
    for (var z = -30; z < 286; z += STEP) {
      // 只统计气候点胜出的格
      var s = heightAt(x, z);
      if (s.h <= WATER) continue;                  // 快速剪枝：水域跳过
      // 最近邻判定（复刻 pick）+ 候选是否获胜
      var bestD = Infinity, win = true, dCand = 0;
      // 直接用 Biomes.pick 得出当前赢家，再比较它与候选的距离
      var winner = V.Biomes.pick(s.cl);
      var wp = null;
      // 通过 distanceSq 获取两者距离比较
      dCand = (s.cl.t - P[0]) ** 2 + (s.cl.h - P[1]) ** 2 + (s.cl.c - P[2]) ** 2 +
        (s.cl.e - P[3]) ** 2 + (s.cl.w - P[4]) ** 2;
      var dWin = V.Biomes.distanceSq(s.cl, winner);
      win = dCand < dWin;
      if (!win) continue;
      land++;
      if (s.h > WATER + 3) {
        dryLand++;
        total++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }
  }
  console.log(P.join(','), '=> 干地胜出格:', total,
    '范围 x[' + minX + ',' + maxX + '] z[' + minZ + ',' + maxZ + ']');
}
