// 合成系统：配方数据 + 3x3 匹配（纯逻辑，无 DOM，可在 Node 中测试）
window.Voxel = window.Voxel || {};

Voxel.Crafting = (function () {
  // 方块 ID：4=橡木, 10=木板, 15=工作台, 16=羊毛, 17=床
  // grid 为 3x3（行优先，0=空）；shapeless=true 时 inputs 为 {id: 数量}
  var RECIPES = [
    { name: '木板', shapeless: true, inputs: { 4: 1 }, result: 10, count: 4 },
    { name: '工作台', grid: [10, 10, 0, 10, 10, 0, 0, 0, 0], result: 15, count: 1 },
    { name: '床', grid: [16, 16, 16, 10, 10, 10, 0, 0, 0], result: 17, count: 1 }
  ];

  // 有方向配方：把配方最小包围盒平移到 size×size 内，其余格子必须为空
  function shapedMatch(grid, pattern, size) {
    var minR = 9, maxR = -1, minC = 9, maxC = -1;
    for (var r = 0; r < 3; r++)
      for (var c = 0; c < 3; c++)
        if (pattern[r * 3 + c]) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
        }
    var ph = maxR - minR + 1, pw = maxC - minC + 1;
    if (ph > size || pw > size) return false; // 配方比格子大（如 3 行宽的床放不下 2x2）
    for (var dr = 0; dr <= size - ph; dr++) {
      for (var dc = 0; dc <= size - pw; dc++) {
        var ok = true;
        for (var r2 = 0; r2 < size && ok; r2++)
          for (var c2 = 0; c2 < size && ok; c2++) {
            var inBox = r2 >= dr + minR && r2 <= dr + maxR && c2 >= dc + minC && c2 <= dc + maxC;
            var want = inBox ? pattern[(r2 - dr + minR) * 3 + (c2 - dc + minC)] : 0;
            if (grid[r2 * size + c2] !== want) ok = false;
          }
        if (ok) return true;
      }
    }
    return false;
  }

  // 无序配方：格内物品与 inputs 多重集相等
  function shapelessMatch(grid, inputs) {
    var have = {};
    for (var i = 0; i < grid.length; i++) {
      var id = grid[i];
      if (id) have[id] = (have[id] || 0) + 1;
    }
    for (var k in inputs) {
      if ((have[+k] || 0) !== inputs[k]) return false;
      delete have[+k];
    }
    for (var k2 in have) return false;
    return true;
  }

  // 在 size×size 网格中匹配，返回 {name, result, count, shapeless, cells(需消耗的格子下标)} 或 null
  function matchIn(grid, size) {
    for (var i = 0; i < RECIPES.length; i++) {
      var r = RECIPES[i];
      var ok = r.shapeless ? shapelessMatch(grid, r.inputs) : shapedMatch(grid, r.grid, size);
      if (!ok) continue;
      // 匹配成功时，格内所有非空格恰好就是配方的物品
      var cells = [];
      for (var k = 0; k < grid.length; k++) if (grid[k]) cells.push(k);
      return { name: r.name, result: r.result, count: r.count, shapeless: !!r.shapeless, cells: cells };
    }
    return null;
  }

  // 3x3（工作台）匹配
  function match(grid) { return matchIn(grid, 3); }

  // 从格子中消耗 match() 返回的配方物品
  function consume(grid, matched) {
    for (var i = 0; i < matched.cells.length; i++) grid[matched.cells[i]] = 0;
  }

  // 单次合成所需材料 {id: 数量}（忽略摆放形状，用于一键合成）
  function needed(recipe) {
    var m = {};
    if (recipe.shapeless) {
      for (var k in recipe.inputs) m[+k] = (m[+k] || 0) + recipe.inputs[k];
    } else {
      for (var i = 0; i < recipe.grid.length; i++)
        if (recipe.grid[i]) m[recipe.grid[i]] = (m[recipe.grid[i]] || 0) + 1;
    }
    return m;
  }

  // 背包材料够合成几次（按数量，不看摆放）
  function canCraftFromInv(inv, recipe) {
    var need = needed(recipe), n = Infinity;
    for (var k in need) {
      var have = 0;
      for (var i = 0; i < inv.length; i++) if (inv[i] === +k) have++;
      var times = Math.floor(have / need[k]);
      if (times < n) n = times;
    }
    return n === Infinity ? 0 : n;
  }

  // 从背包消耗 times 次合成的材料，成功返回 true
  function consumeFromInv(inv, recipe, times) {
    var need = needed(recipe);
    for (var k in need) {
      var left = need[k] * times;
      for (var i = 0; i < inv.length && left > 0; i++)
        if (inv[i] === +k) { inv[i] = 0; left--; }
      if (left > 0) return false;
    }
    return true;
  }

  return {
    recipes: RECIPES,
    match: match,
    matchIn: matchIn,
    consume: consume,
    needed: needed,
    canCraftFromInv: canCraftFromInv,
    consumeFromInv: consumeFromInv,
    name: function (id) { return Voxel.Blocks ? Voxel.Blocks.name(id) : '?'; }
  };
})();
