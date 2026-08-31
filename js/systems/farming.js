// 农耕系统（v8）：作物生长调度 + 湿度判定（纯逻辑，无 DOM，可 Node 测试）
//
// 设计：
// 1. 生长状态全部编码进方块 ID（每作物 4 阶段 + 成熟），存档零成本；
// 2. 种植/收获时由主线程调用 onPlanted 登记生长任务；tick 推进到期任务；
// 3. 目标格当前 ID 与登记时不一致（被挖/区块未驻留）→ 丢弃任务，零漂移；
// 4. 湿度只在种植/翻土瞬间判定一次（4 格内有水 → 湿耕地，生长快一倍）。
window.Voxel = window.Voxel || {};

Voxel.Farming = (function () {
  var B = null, W = null;
  var FARM = null;

  var BASE_GROW = 24;      // 基础生长间隔（秒）
  var tasks = [];          // {t, x, y, z, from}
  var clock = 0;

  function init(worldFacade) {
    B = Voxel.Blocks;
    W = worldFacade;
    FARM = B.FARM;
    tasks.length = 0;
    clock = 0;
  }

  // 扫描耕地附近是否有水（曼哈顿距离 ≤4）
  function nearWater(x, y, z) {
    for (var dy = -1; dy <= 1; dy++)
      for (var dz = -4; dz <= 4; dz++)
        for (var dx = -4; dx <= 4; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > 4) continue;
          if (W.get(x + dx, y - 1 + dy, z + dz) === 7) return true;
        }
    return false;
  }

  function isFarmland(id) {
    return id === FARM.FARMLAND_DRY || id === FARM.FARMLAND_WET;
  }

  // 主线程放置作物种子后调用：登记生长任务
  function onPlanted(x, y, z, stageFrom) {
    if (!B || !W) return;
    var wet = nearWater(x, y, z);
    var delay = BASE_GROW * (wet ? 0.5 : 1) * (0.85 + Math.random() * 0.5);
    tasks.push({ t: clock + delay, x: x, y: y, z: z, from: stageFrom });
    // 立即写湿/干耕地形态
    var fid = W.get(x, y - 1, z);
    if (isFarmland(fid) && fid !== (wet ? FARM.FARMLAND_WET : FARM.FARMLAND_DRY))
      W.set(x, y - 1, z, wet ? FARM.FARMLAND_WET : FARM.FARMLAND_DRY);
  }

  // 翻土（锄头）：干→湿也走这里刷新
  function hoeConvert(x, y, z, hitId) {
    if (!B || !W) return false;
    if (hitId !== 1 && hitId !== 2 && hitId !== B.FARM.FARMLAND_DRY &&
      hitId !== B.FARM.FARMLAND_WET && hitId !== 56 /*菌丝体除外不翻*/) {
      return false;
    }
    if (hitId === 1 || hitId === 2) {
      var wet = nearWater(x, y, z);
      W.set(x, y, z, wet ? FARM.FARMLAND_WET : FARM.FARMLAND_DRY);
      return true;
    }
    return false;
  }

  // tick：推进到期任务。当前格与登记的作物阶段不一致 → 弃单
  function tick(dt) {
    if (!B || !W) return;
    clock += dt;
    var due = [];
    for (var i = tasks.length - 1; i >= 0; i--) {
      if (tasks[i].t <= clock) { due.push(tasks[i]); tasks.splice(i, 1); }
    }
    for (var k = 0; k < due.length; k++) {
      var g = due[k];
      var cur = W.get(g.x, g.y, g.z);
      if (cur === 0) continue;                    // 已被破坏/区块不可用
      var def = B.defs[cur];
      if (!def || !def.crop) continue;
      if (cur !== g.from && !stageMatches(g.from, cur)) continue;
      advance(g.x, g.y, g.z, cur);
    }
  }

  function stageRangeOf(curId) {
    var f = FARM;
    if (curId >= f.WHEAT_A && curId < f.WHEAT_MATURE) return [f.WHEAT_A, f.WHEAT_MATURE];
    if (curId >= f.CARROT_A && curId < f.CARROT_MATURE) return [f.CARROT_A, f.CARROT_MATURE];
    if (curId >= f.POTATO_A && curId < f.POTATO_MATURE) return [f.POTATO_A, f.POTATO_MATURE];
    return null;
  }

  function stageMatches(fromId, curId) {
    var ra = stageRangeOf(fromId), rb = stageRangeOf(curId);
    return !!(ra && rb && ra[0] === rb[0]);
  }

  function advance(x, y, z, curId) {
    var next = curId + 1;
    var r = stageRangeOf(curId);
    if (!r) return;
    // 成熟判定：下一格超出该作物的生长段即封顶于成熟格
    var mature = r[1];
    var nid = next >= mature ? mature : next;
    if (nid === curId) return;
    W.set(x, y, z, nid);
    // 未到成熟继续排队
    if (nid !== mature) onPlanted(x, y, z, nid);
  }

  function _testState() { return { pending: tasks.length, clock: clock }; }

  return {
    init: init,
    onPlanted: onPlanted,
    hoeConvert: hoeConvert,
    nearWater: nearWater,
    tick: tick,
    _testState: _testState,
    _testAdvance: advance
  };
})();
