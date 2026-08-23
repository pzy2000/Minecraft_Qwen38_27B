// 熔炉烧炼逻辑：配方/燃料表 + 单炉 tick（纯逻辑，无 DOM，可在 Node 中测试）
// 炉子状态对象（存于世界方块元数据）：
//   { type:'furnace', in:{id,n}|null, fuel:{id,n}|null, out:{id,n}|null,
//     burnT:剩余燃烧秒, burnMax:本次燃料总秒, prog:当前物品烧制进度秒 }
window.Voxel = window.Voxel || {};

Voxel.FurnaceSys = (function () {
  // 输入 -> 产物
  var SMELT = {
    9: 108,     // 铁矿石 -> 铁锭
    6: 13,      // 沙子   -> 玻璃
    109: 110,   // 生猪排 -> 熟猪排
    111: 112,   // 生鸡肉 -> 熟鸡肉
    113: 114    // 生兔肉 -> 熟兔肉
  };
  var FUEL = {
    107: 40,    // 煤炭（可烧 8 件）
    10: 7.5,    // 木板
    100: 2.5,   // 木棍
    4: 15, 20: 15, 22: 15, 33: 15, 35: 15   // 各类原木
  };
  var SMELT_TIME = 5;          // 每件烧制秒数
  var MAX_STACK = Voxel.Blocks.MAX_STACK || 64;

  function resultId(id) { return SMELT[id] || 0; }
  function fuelTime(id) { return FUEL[id] || 0; }
  function isFuel(id) { return !!FUEL[id]; }

  function fresh() {
    return { type: 'furnace', in: null, fuel: null, out: null, burnT: 0, burnMax: 0, prog: 0 };
  }

  // 当前输入能否烧制（产物与输出格兼容）
  function canSmelt(f) {
    if (!f.in || !f.in.n) return false;
    var rid = resultId(f.in.id);
    if (!rid) return false;
    if (!f.out || !f.out.n) return true;
    return f.out.id === rid && f.out.n < MAX_STACK;
  }

  // 推进一炉 dt 秒。返回是否在燃烧（用于 UI/贴图）。
  // 语义：点火瞬间完成（消耗 1 燃料），同一 tick 内即开始烧制推进（与 MC 一致）
  function tickOne(f, dt) {
    var wasLit = f.burnT > 0;
    if (!wasLit && canSmelt(f)) {
      var ft = (f.fuel && f.fuel.n > 0) ? fuelTime(f.fuel.id) : 0;
      if (ft > 0) {
        f.burnMax = ft;
        f.burnT = ft;
        f.fuel.n--;
        if (f.fuel.n <= 0) f.fuel = null;
      }
    }
    var burning = f.burnT > 0;
    if (burning) {
      f.burnT = Math.max(0, f.burnT - dt);
      if (canSmelt(f)) {
        f.prog += dt;
        if (f.prog >= SMELT_TIME) {
          f.prog = 0;
          var rid = resultId(f.in.id);
          if (!f.out || !f.out.n) f.out = { id: rid, n: 1 };
          else f.out.n++;
          f.in.n--;
          if (f.in.n <= 0) f.in = null;
        }
      } else {
        f.prog = Math.max(0, f.prog - dt * 2);
      }
    } else {
      f.prog = Math.max(0, f.prog - dt * 2);
    }
    return burning;
  }

  return {
    tickOne: tickOne,
    canSmelt: canSmelt,
    resultId: resultId,
    fuelTime: fuelTime,
    isFuel: isFuel,
    fresh: fresh,
    SMELT_TIME: SMELT_TIME,
    SMELT_TABLE: SMELT,
    FUEL_TABLE: FUEL
  };
})();
