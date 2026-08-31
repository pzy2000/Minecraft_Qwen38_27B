// 成就系统：52 个成就，六大分类 + 隐藏位。
// 解锁数据持久化在 Voxel.Progress.state.ach（仅随当前存档）。
// 图标优先复用方块图鉴 atlas 物品 tile；特殊成就用几何像素画。
window.Voxel = window.Voxel || {};

Voxel.Achievements = (function () {
  var CATS = [
    { key: 'survival', name: '生存' },
    { key: 'build', name: '建造' },
    { key: 'explore', name: '探索' },
    { key: 'collect', name: '收集' },
    { key: 'challenge', name: '挑战' },
    { key: 'hidden', name: '隐藏' }
  ];

  // prog: 返回 [当前值, 目标值]；null 表示单次达成
  // icon: 方块/物品 id；hidden: 未解锁前显示 ???
  var DEFS = [
    // ---- 生存 (10) ----
    { id: 'sleep1', cat: 'survival', name: '睡个好觉', desc: '第一次在床上度过夜晚', icon: 17,
      prog: function () { return [Math.min(1, P().count('sleeps')), 1]; } },
    { id: 'eater', cat: 'survival', name: '美食家', desc: '累计进食 10 次', icon: 110,
      prog: function () { return [Math.min(10, P().count('eaten')), 10]; } },
    { id: 'cooked_meal', cat: 'survival', name: '热菜上桌', desc: '吃一次熟食（熟猪排/熟鸡肉/熟兔肉）',
      icon: 112, test: function (t, d) { return t === 'eat' && [110, 112, 114].indexOf(d.id | 0) >= 0; } },
    { id: 'iron_ingot', cat: 'survival', name: '铁器时代', desc: '获得第一块铁锭', icon: 108,
      test: function (t, d) { return t === 'gain' && (d.id | 0) === 108; } },
    { id: 'iron_pick', cat: 'survival', name: '工具大师', desc: '合成一把铁镐', icon: 103,
      test: function (t, d) { return t === 'craft' && (d.id | 0) === 103; } },
    { id: 'first_zombie', cat: 'survival', name: '守夜人', desc: '击退一只僵尸', icon: null, glyph: '☠',
      test: function (t, d) { return t === 'kill' && d.type === 'zombie'; } },
    { id: 'zombie_5', cat: 'survival', name: '亡者猎手', desc: '累计击杀 5 只僵尸', glyph: '⚔',
      prog: function () { return [Math.min(5, P().mobKills('zombie')), 5]; } },
    { id: 'torch', cat: 'survival', name: '点亮黑暗', desc: '放置第一支火把', icon: 19,
      test: function (t, d) { return t === 'place' && d.placedId === 19; } },
    { id: 'deep_miner', cat: 'survival', name: '深入地心', desc: '挖掘深度低于 y=20 的方块', icon: 3,
      prog: function () { return [Math.min(20, P().count('deepDigs')), 20]; } },
    { id: 'back_alive', cat: 'survival', name: '东山再起', desc: '死亡后成功重生', icon: null, glyph: '✚',
      test: function (t) { return t === 'respawn'; } },

    // ---- 建造 (8) ----
    { id: 'planks', cat: 'build', name: '木材加工', desc: '合成第一组木板', icon: 10,
      test: function (t, d) { return t === 'craft' && (d.id | 0) === 10; } },
    { id: 'craft_table', cat: 'build', name: '工匠之心', desc: '合成工作台', icon: 15,
      test: function (t, d) { return t === 'craft' && (d.id | 0) === 15; } },
    { id: 'place_table', cat: 'build', name: '安家落户', desc: '放置一台工作台', icon: 15,
      test: function (t, d) { return t === 'place' && d.placedId === 15; } },
    { id: 'furnace', cat: 'build', name: '炉火纯青', desc: '合成熔炉', icon: 37,
      test: function (t, d) { return t === 'craft' && (d.id | 0) === 37; } },
    { id: 'chest', cat: 'build', name: '储物管家', desc: '合成箱子', icon: 38,
      test: function (t, d) { return t === 'craft' && (d.id | 0) === 38; } },
    { id: 'bed', cat: 'build', name: '筑巢引梦', desc: '合成一张床', icon: 17,
      test: function (t, d) { return t === 'craft' && (d.id | 0) === 17; } },
    { id: 'builder100', cat: 'build', name: '建造学徒', desc: '累计放置 100 个方块', icon: 11,
      prog: function () { return [Math.min(100, P().count('placed')), 100]; } },
    { id: 'builder500', cat: 'build', name: '建筑大师', desc: '累计放置 500 个方块', icon: 29,
      prog: function () { return [Math.min(500, P().count('placed')), 500]; } },

    // ---- 探索 (12) ----
    { id: 'scan1', cat: 'explore', name: '初探脉冲', desc: '完成首次主动扫描（G 键）', glyph: '◎',
      test: function (t) { return t === 'scan'; } },
    { id: 'scan25', cat: 'explore', name: '行星测绘员', desc: '扫描编录累计 25 条新档案', glyph: '◈',
      prog: function () { return [Math.min(25, P().count('scanEntries')), 25]; } },
    { id: 'ruin', cat: 'explore', name: '遗迹寻宝', desc: '打开一个远古遗迹宝箱', icon: 50,
      test: function (t) { return t === 'ruin'; } },
    { id: 'portal', cat: 'explore', name: '门径行者', desc: '通过传送门前往另一天体', glyph: '◉',
      test: function (t) { return t === 'portal'; } },
    { id: 'board', cat: 'explore', name: '登舰！', desc: '第一次进入飞船座舱', icon: null, glyph: '▲',
      test: function (t) { return t === 'board'; } },
    { id: 'warp1', cat: 'explore', name: '点火升空', desc: '首次使用跃迁引擎抵达新天体', glyph: '➤',
      test: function (t) { return t === 'warp'; } },
    { id: 'planets3', cat: 'explore', name: '星际访客', desc: '抵达 3 个不同天体', glyph: '◆',
      prog: planetsVisitedProg },
    { id: 'planets_all', cat: 'explore', name: '系内全览', desc: '抵达本恒星系的全部天体', glyph: '❋',
      test: planetsAllTest },
    { id: 'jump1', cat: 'explore', name: '跨越星海', desc: '完成首次跨恒星系曲速跳跃', icon: 122,
      test: function (t) { return t === 'jump'; } },
    { id: 'sys3', cat: 'explore', name: '银河游侠', desc: '探索 3 个恒星系', glyph: '✦',
      prog: systemsVisitedProg },
    { id: 'biomes5', cat: 'explore', name: '地貌观察者', desc: '亲身踏足 5 种不同群系', icon: 1,
      prog: biomesProg(5) },
    { id: 'biomes12', cat: 'explore', name: '生态学者', desc: '亲身踏足 12 种不同群系', icon: 58,
      prog: biomesProg(12) },

    // ---- 收集 (12) ----
    { id: 'wood', cat: 'collect', name: '伐木工', desc: '获得任意一种原木', icon: 4,
      test: gainIn(LOG_IDS_ALL) },
    { id: 'coal', cat: 'collect', name: '矿脉初现', desc: '获得煤炭', icon: 107,
      test: gainId(107) },
    { id: 'wool', cat: 'collect', name: '剪羊毛', desc: '获得羊毛', icon: 16,
      test: gainId(16) },
    { id: 'cat_fur', cat: 'collect', name: '猫的报答', desc: '获得猫毛', icon: 121,
      test: gainId(121) },
    { id: 'crystal_any', cat: 'collect', name: '异星结晶', desc: '获得任意一颗行星专属晶体', icon: 115,
      test: gainAny([115, 116, 117, 118, 119, 120]) },
    { id: 'crystal_all', cat: 'collect', name: '晶体收藏家', desc: '集齐全部 6 种行星晶体', glyph: '❖',
      test: crystalAllTest },
    { id: 'meats', cat: 'collect', name: '荤素不忌', desc: '集齐三种熟食：熟猪排 · 熟鸡肉 · 熟兔肉', icon: 114,
      test: meatsTest },
    { id: 'warp_cell', cat: 'collect', name: '曲速引擎燃料', desc: '合成一枚曲速电池', icon: 122,
      test: gainId(122) },
    { id: 'coal64', cat: 'collect', name: '煤矿大亨', desc: '累计开采 64 块煤矿石', icon: 107,
      prog: function () { return [Math.min(64, P().idCount('mine', 8)), 64]; } },
    { id: 'codex20', cat: 'collect', name: '图鉴·二十格', desc: '图鉴中解锁 20 种物品条目', glyph: '▤',
      prog: codexItemsProg(20) },
    { id: 'codex40', cat: 'collect', name: '图鉴·半程', desc: '图鉴中解锁 40 种物品条目', glyph: '▥',
      prog: codexItemsProg(40) },
    { id: 'zoo', cat: 'collect', name: '动物朋友圈', desc: '近距离记录全部 6 种生物', icon: 78,
      test: zooTest },

    // ---- 挑战 (7) ----
    { id: 'dig250', cat: 'challenge', name: '开采专家', desc: '累计挖掘 250 个方块', icon: 2,
      prog: function () { return [Math.min(250, P().count('dug')), 250]; } },
    { id: 'dig1000', cat: 'challenge', name: '掘地三千尺', desc: '累计挖掘 1000 个方块', icon: 14,
      prog: function () { return [Math.min(1000, P().count('dug')), 1000]; } },
    { id: 'craft50', cat: 'challenge', name: '量产车间', desc: '累计合成 50 件物品', icon: 101,
      prog: function () { return [Math.min(50, P().count('crafted')), 50]; } },
    { id: 'smelt25', cat: 'challenge', name: '锻造烈焰', desc: '累计烧炼 25 件物品', glyph: '🔥',
      prog: function () { return [Math.min(25, P().count('smelted')), 25]; } },
    { id: 'kills25', cat: 'challenge', name: '身经百战', desc: '累计击杀 25 只生物', glyph: '⚔',
      prog: function () { return [Math.min(25, P().count('kills')), 25]; } },
    { id: 'iron_kit', cat: 'challenge', name: '铁装列队', desc: '同时拥有铁镐与铁剑', icon: 106,
      test: ironKitTest },
    { id: 'warps5', cat: 'challenge', name: '老飞行员', desc: '完成 5 次飞船跃迁旅行', icon: 102,
      prog: function () { return [Math.min(5, P().count('warps')), 5]; } },

    // ---- 隐藏 (3) ----
    { id: 'h_env_death', cat: 'hidden', name: '???', desc: '死于星球环境的怀抱', hidden: true, glyph: '☣',
      test: envDeathTest },
    { id: 'h_cat_pets', cat: 'hidden', name: '???', desc: '反复靠近同一只猫的朋友', hidden: true, glyph: '🐱',
      prog: function () { return [Math.min(10, P().count('pets_cat')), 10]; } },
    { id: 'h_wet_dig', cat: 'hidden', name: '???', desc: '在水下坚持工作', hidden: true, icon: 13,
      prog: function () { return [Math.min(10, P().count('wetDigs')), 10]; } },
    { id: 'h_park_all', cat: 'hidden', name: '???', desc: '在星海嘉年华乘遍所有设施', hidden: true, icon: 79,
      prog: function () {
        var set = P().rideSet ? P().rideSet() : {};
        var n = 0;
        ['ferris', 'carousel', 'drop', 'pirate', 'coaster', 'tron'].forEach(function (k) { if (set[k]) n++; });
        return [n, 6];
      } }
  ];

  function LOG_IDS_ALL() { return { 4: 1, 20: 1, 22: 1, 33: 1, 35: 1, 46: 1, 52: 1, 57: 1 }; }

  function P() { return Voxel.Progress; }

  function gainId(id) {
    return function (t, d) { return t === 'gain' && (d.id | 0) === id; };
  }
  function gainAny(ids) {
    return function (t, d) { return t === 'gain' && ids.indexOf(d.id | 0) >= 0; };
  }
  function gainIn(listFn) {
    return function (t, d) { return t === 'gain' && !!listFn()[d.id | 0]; };
  }

  function planetsVisitedCount() {
    var g = galaxy();
    if (!g || !g.discovered) return 0;
    var n = 0;
    for (var k in g.discovered) if (g.discovered[k]) n++;
    return n;
  }
  function planetsVisitedProg() {
    return [Math.min(3, planetsVisitedCount()), 3];
  }
  function planetsAllTest() {
    var g = galaxy();
    if (!g || !g.catalog) return false;
    for (var i = 0; i < g.catalog.length; i++)
      if (!g.discovered[g.catalog[i].id]) return false;
    return true;
  }
  function systemsVisitedProg() {
    var g = galaxy();
    if (!g || !g.visitedSys) return [0, 3];
    var n = 0;
    for (var k in g.visitedSys) if (g.visitedSys[k]) n++;
    return [Math.min(3, n), 3];
  }
  function galaxy() {
    return Voxel.Game ? Voxel.Game.getGalaxy() : null;
  }
  function biomesProg(target) {
    return function () { return [Math.min(target, P().biomeSet()), target]; };
  }
  function crystalAllTest(t, d) {
    if (t !== 'gain') return false;
    var ids = [115, 116, 117, 118, 119, 120];
    for (var i = 0; i < ids.length; i++)
      if (!P().first(ids[i])) return false;
    return true;
  }
  function meatsTest(t, d) {
    if (t !== 'gain' && t !== 'eat') return false;
    return P().first(110) && P().first(112) && P().first(114);
  }
  function zooTest(t, d) {
    if (t !== 'fauna') return false;
    return P().faunaSet() >= 6;
  }
  function ironKitTest() {
    return Voxel.Game &&
      ((Voxel.Game.countInventory(103) || 0) > 0 && (Voxel.Game.countInventory(106) || 0) > 0);
  }
  var ENV_CAUSES = ['drown', 'toxic', 'pressure', 'heat', 'cold', 'ash'];
  function envDeathTest(t, d) {
    return t === 'death' && ENV_CAUSES.indexOf(String((d && d.cause) || '')) >= 0;
  }
  function codexItemsProg(target) {
    return function () {
      var s = P().state();
      var n = 0;
      for (var k in s.firsts) if (s.firsts[k]) n++;
      return [Math.min(target, n), target];
    };
  }

  // ---------- 解锁引擎 ----------
  var unlockedListeners = [];

  function onUnlock(fn) { unlockedListeners.push(fn); }

  function isUnlocked(def) {
    return !!P().state().ach[def.id];
  }

  function unlock(def) {
    if (isUnlocked(def)) return;
    P().state().ach[def.id] = Date.now();
    if (Voxel.HUD && Voxel.HUD.toast)
      Voxel.HUD.toast('🏆 成就解锁：' + def.name);
    showAchToast(def);
    try { if (Voxel.Sound && Voxel.Sound.pop) Voxel.Sound.pop(); } catch (e) { }
    for (var i = 0; i < unlockedListeners.length; i++) {
      try { unlockedListeners[i](def); } catch (e) { }
    }
    refreshPanelIfOpen();
  }

  // 每次 track 后增量评估。进度型仅在计数变化时可能达标，
  // 全量检查成本低（52 条），直接顺序评估。
  function onEvent(type, data) {
    for (var i = 0; i < DEFS.length; i++) {
      var def = DEFS[i];
      if (isUnlocked(def)) continue;
      try {
        if (def.test && def.test(type, data)) { unlock(def); continue; }
        if (def.prog) {
          var pr = def.prog();
          if (pr && pr[0] >= pr[1] && pr[1] > 0) unlock(def);
        }
      } catch (e) { /* 单条判定异常不影响其他 */ }
    }
  }

  // 成绩还依赖非事件状态（背包内容/星系发现数）——在面板打开与存档时补评
  function sweep() {
    onEvent('__sweep__', {});
  }

  function totalOf(catKey) {
    var all = 0, got = 0;
    for (var i = 0; i < DEFS.length; i++) {
      if (catKey && DEFS[i].cat !== catKey) continue;
      all++;
      if (isUnlocked(DEFS[i])) got++;
    }
    return { all: all, got: got };
  }

  // ---------- ach-toast 弹窗 ----------
  var toastEl = null, toastTimer = null;
  function showAchToast(def) {
    if (typeof document === 'undefined') return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'ach-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.innerHTML =
        '<span class="ach-toast-icon" aria-hidden="true"></span>' +
        '<span class="ach-toast-copy"><small>ACHIEVEMENT UNLOCKED</small><strong></strong></span>';
      document.body.appendChild(toastEl);
    }
    var iconWrap = toastEl.querySelector('.ach-toast-icon');
    renderIconInto(iconWrap, def, true);
    toastEl.querySelector('strong').textContent = def.name;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3200);
  }

  // ---------- 面板 ----------
  var panelGrid = null, panelTabs = null, panelSummary = null, curCat = null;

  function renderIconInto(el, def, forceShow) {
    el.innerHTML = '';
    if (def.icon && Voxel.Blocks && Voxel.Blocks.defs[def.icon]) {
      var cv = document.createElement('canvas');
      cv.width = 44; cv.height = 44;
      cv.className = 'px-icon';
      el.appendChild(cv);
      try { Voxel.HUD.drawIcon(cv, def.icon); } catch (e) { cv.getContext('2d'); }
      if (def.hidden && !forceShow) cv.style.filter = 'brightness(0.05)';
    } else {
      var sp = document.createElement('span');
      sp.className = 'ach-glyph';
      sp.textContent = (def.hidden && !forceShow) ? '？' : (def.glyph || '★');
      el.appendChild(sp);
    }
  }

  function buildPanel() {
    var overlay = document.getElementById('overlay-achievements');
    if (!overlay || typeof document === 'undefined') return;
    panelSummary = overlay.querySelector('.ach-summary');
    panelTabs = overlay.querySelector('.ach-tabs');
    panelGrid = overlay.querySelector('#ach-grid');
    if (!panelTabs || panelTabs.childElementCount) return;

    var tabs = [{ key: null, name: '全部' }].concat(CATS);
    for (var i = 0; i < tabs.length; i++) {
      (function (tab) {
        var b = document.createElement('button');
        b.className = 'btn small ach-tab';
        b.type = 'button';
        b.setAttribute('data-cat', tab.key || '');
        b.addEventListener('click', function () { curCat = tab.key; refreshPanel(); });
        b.textContent = tab.name;
        panelTabs.appendChild(b);
      })(tabs[i]);
    }
  }

  function cardFor(def) {
    var unlocked = isUnlocked(def);
    var card = document.createElement('article');
    card.className = 'ach-card' + (unlocked ? ' unlocked' : '') +
      (def.hidden && !unlocked ? ' secret' : '');
    var ic = document.createElement('div');
    ic.className = 'ach-card-icon';
    renderIconInto(ic, def, unlocked);
    card.appendChild(ic);
    var body = document.createElement('div');
    body.className = 'ach-card-body';
    var nm = document.createElement('strong');
    nm.textContent = (def.hidden && !unlocked) ? '隐藏成就' : def.name;
    var ds = document.createElement('span');
    ds.textContent = (def.hidden && !unlocked) ? '继续探索以揭开它的面纱…' : def.desc;
    body.appendChild(nm); body.appendChild(ds);
    if (def.prog && !unlocked && !(def.hidden)) {
      var pr = def.prog();
      if (pr && pr[1] > 0) {
        var bar = document.createElement('div');
        bar.className = 'ach-bar';
        bar.innerHTML = '<i style="width:' +
          Math.round(Math.max(0, Math.min(1, pr[0] / pr[1])) * 100) + '%"></i>';
        var prText = document.createElement('small');
        prText.className = 'ach-prog-text';
        prText.textContent = pr[0] + ' / ' + pr[1];
        body.appendChild(bar); body.appendChild(prText);
      }
    }
    card.appendChild(body);
    return card;
  }

  function refreshPanel() {
    buildPanel();
    if (!panelGrid) return;
    sweepIfNeeded();
    var totals = totalOf(curCat);
    if (panelSummary) {
      var pct = totals.all ? Math.round(totals.got / totals.all * 100) : 0;
      panelSummary.querySelector('b').textContent = totals.got + ' / ' + totals.all;
      var fill = panelSummary.querySelector('.ach-progress-fill');
      if (fill) fill.style.width = pct + '%';
      var label = panelSummary.querySelector('span');
      if (label) label.textContent = pct + '%';
    }
    var tabs = panelTabs ? panelTabs.children : [];
    for (var ti = 0; ti < tabs.length; ti++) {
      var key = tabs[ti].getAttribute('data-cat') || null;
      tabs[ti].setAttribute('aria-pressed', (key === curCat) ? 'true' : 'false');
    }
    panelGrid.innerHTML = '';
    for (var i = 0; i < DEFS.length; i++) {
      if (curCat && DEFS[i].cat !== curCat) continue;
      panelGrid.appendChild(cardFor(DEFS[i]));
    }
  }

  var lastSweepT = 0;
  function sweepIfNeeded() {
    var now = Date.now();
    if (now - lastSweepT < 800) return;
    lastSweepT = now;
    sweep();
  }

  function refreshPanelIfOpen() {
    if (typeof document === 'undefined') return;
    if (document.body.getAttribute('data-game-state') === 'achievements') refreshPanel();
  }

  return {
    defs: DEFS,
    cats: CATS,
    onEvent: onEvent,
    onUnlock: onUnlock,
    refreshPanel: refreshPanel,
    isUnlocked: isUnlocked,
    totalOf: totalOf,
    sweep: sweep
  };
})();
