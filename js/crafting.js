// 合成系统：配方数据 + 3x3 匹配（纯逻辑，无 DOM，可在 Node 中测试）
window.Voxel = window.Voxel || {};

Voxel.Crafting = (function () {
  // 方块 ID：4=橡木, 20=云杉木, 22=丛林木, 10=木板, 15=工作台, 16=羊毛, 17=床, 3=石头/圆石
  // 物品 ID：100=木棍, 101-103=镐, 104-106=剑, 107=煤炭, 108=铁锭；19=火把(方块), 37=熔炉(方块)
  // grid 为 3x3（行优先，0=空）；shapeless=true 时 inputs 为 {id: 数量}
  // shapeless 配方可用 alts 提供多组可替代材料（如任意原木合成木板）
  var RECIPES = [
    { name: '木板', shapeless: true, alts: [{ 4: 1 }, { 20: 1 }, { 22: 1 }, { 33: 1 }, { 35: 1 }], result: 10, count: 4 },
    { name: '工作台', grid: [10, 10, 0, 10, 10, 0, 0, 0, 0], result: 15, count: 1 },
    { name: '床', grid: [16, 16, 16, 10, 10, 10, 0, 0, 0], result: 17, count: 1 },
    { name: '木棍', shapeless: true, inputs: { 10: 2 }, result: 100, count: 4 },
    { name: '火把', shapeless: true, inputs: { 107: 1, 100: 1 }, result: 19, count: 4 },
    { name: '熔炉', grid: [3, 3, 3, 3, 0, 3, 3, 3, 3], result: 37, count: 1 },
    { name: '箱子', grid: [10, 10, 10, 10, 0, 10, 10, 10, 10], result: 38, count: 1 },
    { name: '木镐', grid: [10, 10, 10, 0, 100, 0, 0, 100, 0], result: 101, count: 1 },
    { name: '石镐', grid: [3, 3, 3, 0, 100, 0, 0, 100, 0], result: 102, count: 1 },
    { name: '铁镐', grid: [9, 9, 9, 0, 100, 0, 0, 100, 0], result: 103, count: 1 },
    { name: '木剑', grid: [0, 10, 0, 0, 10, 0, 0, 100, 0], result: 104, count: 1 },
    { name: '石剑', grid: [0, 3, 0, 0, 3, 0, 0, 100, 0], result: 105, count: 1 },
    { name: '铁剑', grid: [0, 9, 0, 0, 9, 0, 0, 100, 0], result: 106, count: 1 },
    { name: '猫毛毡', shapeless: true, inputs: { 121: 2 }, result: 45, count: 1 },
    // 曲速电池：任意两枚 tier≥2 晶体（冰核/孢子晶/熔核/潮汐晶）+ 铁锭
    { name: '曲速电池', shapeless: true, alts: [
      { 117: 2, 108: 1 }, { 118: 2, 108: 1 },
      { 119: 2, 108: 1 }, { 120: 2, 108: 1 }
    ], result: 122, count: 1 }
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
            // 配方格 (pr,pc) 平移到网格格 (dr+pr, dc+pc)；仅包围盒内的格子参与比对
            var pr = r2 - dr, pc = c2 - dc;
            var inBox = pr >= minR && pr <= maxR && pc >= minC && pc <= maxC;
            var want = inBox ? pattern[pr * 3 + pc] : 0;
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

  // shapeless 配方的候选材料组（有 alts 用 alts，否则只有 inputs 一组）
  function inputMaps(r) {
    return r.alts || [r.inputs];
  }

  // 单组材料的 {id: 数量}
  function neededMap(inputs) {
    var m = {};
    for (var k in inputs) m[+k] = (m[+k] || 0) + inputs[k];
    return m;
  }

  // 在 size×size 网格中匹配，返回 {name, result, count, shapeless, cells(需消耗的格子下标)} 或 null
  function matchIn(grid, size) {
    for (var i = 0; i < RECIPES.length; i++) {
      var r = RECIPES[i];
      var ok = false;
      if (r.shapeless) {
        var maps = inputMaps(r);
        for (var v = 0; v < maps.length && !ok; v++) ok = shapelessMatch(grid, maps[v]);
      } else {
        ok = shapedMatch(grid, r.grid, size);
      }
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
  // 有 alts 的配方：传入 inv/cnt 时选可合成次数最多的一组，否则取第一组
  function needed(recipe, inv, cnt) {
    if (!recipe.shapeless) {
      var m = {};
      for (var i = 0; i < recipe.grid.length; i++)
        if (recipe.grid[i]) m[recipe.grid[i]] = (m[recipe.grid[i]] || 0) + 1;
      return m;
    }
    var maps = inputMaps(recipe);
    var best = neededMap(maps[0]), bestN = -1;
    for (var v = 0; v < maps.length; v++) {
      var need = neededMap(maps[v]);
      if (inv) {
        var n = canFromNeed(inv, need, cnt);
        if (n > bestN) { bestN = n; best = need; }
      }
    }
    return best;
  }

  // 背包材料够按 need 合成几次（按数量，不看摆放）
  // cnt: 与 inv 平行的数量数组（堆叠），缺省视为每格 1 个
  function canFromNeed(inv, need, cnt) {
    var n = Infinity;
    for (var k in need) {
      var have = 0;
      for (var i = 0; i < inv.length; i++)
        if (inv[i] === +k) have += (cnt && cnt[i]) ? cnt[i] : 1;
      var times = Math.floor(have / need[k]);
      if (times < n) n = times;
    }
    return n === Infinity ? 0 : n;
  }

  function canCraftFromInv(inv, recipe, cnt) {
    if (!recipe.shapeless) return canFromNeed(inv, needed(recipe), cnt);
    // 每次合成只消耗一组替代材料，总次数为各组可合成次数之和
    var maps = inputMaps(recipe), n = 0;
    for (var v = 0; v < maps.length; v++)
      n += canFromNeed(inv, neededMap(maps[v]), cnt);
    return n;
  }

  // 从背包消耗 times 次合成的材料（alts 配方自动选用可合成的那组），成功返回 true
  function consumeFromInv(inv, recipe, times, cnt) {
    return consumeMap(inv, needed(recipe, inv, cnt), times, cnt);
  }

  function consumeMap(inv, need, times, cnt) {
    for (var k in need) {
      var left = need[k] * times;
      for (var i = 0; i < inv.length && left > 0; i++) {
        if (inv[i] !== +k) continue;
        var q = (cnt && cnt[i]) ? cnt[i] : 1;
        var take = Math.min(q, left);
        left -= take;
        q -= take;
        if (cnt) cnt[i] = q;
        if (q <= 0) inv[i] = 0;
      }
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
