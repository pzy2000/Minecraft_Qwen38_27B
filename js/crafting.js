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
    { name: '火把', shapeless: true, alts: [{ 107: 1, 100: 1 }, { 125: 1, 100: 1 }], result: 19, count: 4 },
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
    ], result: 122, count: 1 },
    // ---- 物品/装备扩展配方（金/钻工具、功能性装备）----
    { name: '金镐', grid: [123, 123, 123, 0, 100, 0, 0, 100, 0], result: 126, count: 1 },
    { name: '金剑', grid: [0, 123, 0, 0, 123, 0, 0, 100, 0], result: 127, count: 1 },
    { name: '钻石镐', grid: [124, 124, 124, 0, 100, 0, 0, 100, 0], result: 128, count: 1 },
    { name: '钻石剑', grid: [0, 124, 0, 0, 124, 0, 0, 100, 0], result: 129, count: 1 },
    // 防毒面具：5 金锭面罩壳 + 1 木炭滤芯；抵御 toxic/volcanic 行星毒性暴露
    { name: '防毒面具', grid: [108, 108, 108, 108, 0, 108, 0, 125, 0], result: 130, count: 1 },
    // 防寒服：6 猫毛毡（保温材料）；抵御 frozen 行星低温暴露
    { name: '防寒服', grid: [45, 0, 45, 45, 45, 45, 0, 0, 0], result: 131, count: 1 },
    // ---- 战斗装备配方（弓/箭/毡质与铁质护甲）----
    // 弓：弓身三段木棍 + 右列羊毛作弦
    { name: '弓', grid: [0, 100, 16, 100, 0, 16, 0, 100, 16], result: 134, count: 1 },
    // 箭：石镞 + 木杆（1 石头 + 2 木棍 → 4 支）
    { name: '箭', shapeless: true, inputs: { 3: 1, 100: 2 }, result: 135, count: 4 },
    // 毡质护甲：猫毛毡制成，早期过渡物理减伤（帽形：檐行 + 帽体两行，与防寒服马甲形区分）
    { name: '毡帽', grid: [45, 45, 45, 0, 45, 0, 0, 45, 0], result: 136, count: 1 },
    { name: '毡衣', grid: [45, 0, 45, 45, 45, 45, 45, 45, 45], result: 137, count: 1 },
    // 铁质护甲：铁锭锻打，显著物理减伤
    { name: '铁盔', grid: [108, 0, 108, 108, 108, 108, 0, 0, 0], result: 138, count: 1 },
    { name: '铁胸甲', grid: [108, 0, 108, 108, 108, 108, 108, 108, 108], result: 139, count: 1 },
    // ---- v8：门与活板门 ----
    // 木门（对齐 wiki 2×3 木板）×3；底行为对应原木以区分木种
    { name: '橡木门', grid: [10, 10, 0, 10, 10, 0, 4, 4, 0], result: 141, count: 3 },
    { name: '云杉门', grid: [10, 10, 0, 10, 10, 0, 20, 20, 0], result: 149, count: 3 },
    { name: '白桦门', grid: [10, 10, 0, 10, 10, 0, 33, 33, 0], result: 157, count: 3 },
    { name: '丛林门', grid: [10, 10, 0, 10, 10, 0, 22, 22, 0], result: 165, count: 3 },
    { name: '金合欢门', grid: [10, 10, 0, 10, 10, 0, 35, 35, 0], result: 173, count: 3 },
    { name: '樱花门', grid: [10, 10, 0, 10, 10, 0, 57, 57, 0], result: 181, count: 3 },
    // 铁门：2×3 铁锭 ×3，只能由红石信号开启
    { name: '铁门', grid: [9, 9, 0, 9, 9, 0, 9, 9, 0], result: 189, count: 3 },
    // 橡木活板门：3×2 木板 ×2
    { name: '橡木活板门', grid: [10, 10, 10, 10, 10, 10, 0, 0, 0], result: 197, count: 2 },
    // ---- v8：红石基础电路 ----
    { name: '红石火把', shapeless: true, inputs: { 220: 1, 100: 1 }, result: 203, count: 1 },
    { name: '拉杆', shapeless: true, inputs: { 3: 1, 100: 1 }, result: 205, count: 1 },
    { name: '石质按钮', shapeless: true, inputs: { 3: 1 }, result: 207, count: 1 },
    { name: '木质压力板', shapeless: true, inputs: { 10: 2 }, result: 209, count: 1 },
    { name: '红石灯', grid: [0, 220, 0, 220, 14, 220, 0, 220, 0], result: 211, count: 1 },
    { name: '红石中继器', grid: [203, 220, 203, 3, 3, 3, 0, 0, 0], result: 213, count: 1 },
    // ---- v8：农耕 ----
    { name: '面包', shapeless: true, inputs: { 239: 3 }, result: 241, count: 1 },
    { name: '金苹果', grid: [123, 123, 123, 123, 242, 123, 123, 123, 123], result: 243, count: 1 },
    { name: '木锄', grid: [10, 10, 0, 0, 100, 0, 0, 100, 0], result: 248, count: 1 },
    { name: '石锄', grid: [3, 3, 0, 0, 100, 0, 0, 100, 0], result: 249, count: 1 },
    { name: '铁锄', grid: [9, 9, 0, 0, 100, 0, 0, 100, 0], result: 250, count: 1 }
  ];

  // ---- v8：染色配方（程序化生成）----
  // 主色来自花朵掉落 / 仙人掌烧炼(绿)；二次色两两调和；对羊毛/陶瓦/玻璃染色。
  (function buildDyeRecipes() {
    var pal = Voxel.Blocks && Voxel.Blocks.DYE_PALETTE;
    if (!pal || !pal.length || !Voxel.Blocks.glassOfDye) return;
    // 二次色混合表：[色A索引, 色B索引] -> 结果色索引
    var MIX = [
      [0, 2, 1],   // 白+灰 → 淡灰
      [0, 3, 2],   // 白+黑 → 灰
      [5, 0, 15],  // 红+白 → 粉
      [5, 7, 6],   // 红+黄 → 橙
      [9, 0, 8],   // 绿+白 → 黄绿
      [12, 0, 11], // 蓝+白 → 淡蓝
      [9, 12, 10], // 绿+蓝 → 青
      [12, 5, 13], // 蓝+红 → 紫
      [13, 15, 14] // 紫+粉 → 品红
    ];
    function dyeInputs(baseId, dyeIdx) {
      var o = {};
      o[baseId] = 1;
      o[260 + dyeIdx] = 1;
      return o;
    }
    for (var j = 1; j < pal.length; j++) {
      RECIPES.push({ name: '染' + pal[j][1] + '色羊毛', shapeless: true,
        inputs: dyeInputs(16, j), result: Voxel.Blocks.woolOfDye(j), count: 1 });
    }
    for (var t = 1; t < pal.length; t++) {
      RECIPES.push({ name: '染' + pal[t][1] + '色陶瓦', shapeless: true,
        inputs: dyeInputs(27, t), result: Voxel.Blocks.terraOfDye(t), count: 1 });
    }
    for (var g = 1; g < pal.length; g++) {
      var gid = Voxel.Blocks.glassOfDye(g);
      if (!gid) continue;
      RECIPES.push({ name: '染' + pal[g][1] + '彩玻璃', shapeless: true,
        inputs: dyeInputs(14, g), result: gid, count: 1 });
    }
    for (var m = 0; m < MIX.length; m++) {
      var mx = MIX[m];
      var inputs = {};
      inputs[260 + mx[0]] = 1;
      inputs[260 + mx[1]] = 1;
      RECIPES.push({ name: pal[mx[2]][1] + '色染料', shapeless: true, inputs: inputs, result: 260 + mx[2], count: 1 });
    }
    // ---- v8：建造全家桶 ----
    // 台阶 ×6（3 材料 → 单个下台阶）
    RECIPES.push({ name: '木板台阶', shapeless: true, inputs: { 10: 3 }, result: 340, count: 6 });
    RECIPES.push({ name: '石头台阶', shapeless: true, inputs: { 3: 3 }, result: 341, count: 6 });
    RECIPES.push({ name: '圆石台阶', shapeless: true, inputs: { 12: 3 }, result: 342, count: 6 });
    // 楼梯 ×4（角形阶梯摆放）
    function stairRecipe(matId, resultId, matName) {
      return { name: matName + '楼梯', grid: [matId, 0, 0, matId, matId, 0, matId, matId, matId], result: resultId, count: 4 };
    }
    RECIPES.push(stairRecipe(10, 350, '木板'));
    RECIPES.push(stairRecipe(3, 354, '石头'));
    RECIPES.push(stairRecipe(12, 358, '圆石'));
    // 栅栏（木板×4+木棍×2）/ 玻璃板（玻璃×6）
    RECIPES.push({ name: '木栅栏', shapeless: true, inputs: { 10: 4, 100: 2 }, result: 362, count: 3 });
    RECIPES.push({ name: '玻璃板', shapeless: true, inputs: { 14: 6 }, result: 363, count: 8 });
  })();

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
