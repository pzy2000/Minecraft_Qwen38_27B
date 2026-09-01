// 星海图鉴：四页签收集册（物品&方块 / 生物 / 群系 / 星域）。
// 数据源：Voxel.Progress.firsts（物品）、fauna（生物）、biomes（群系）
// 与 galaxy.discovered/catalog/visitedSys（天体，零额外存储）。
// 图标复用 HUD.drawIcon 的像素 atlas；未解锁显示剪影 + "?"。
window.Voxel = window.Voxel || {};

Voxel.Codex = (function () {
  var TABS = [
    { key: 'items', name: '物品图鉴' },
    { key: 'fauna', name: '生物' },
    { key: 'biomes', name: '群系' },
    { key: 'cosmos', name: '星域档案' }
  ];

  var curTab = 'items';
  var bodyEl = null, tabsEl = null, summaryEl = null;

  // ---------- 物品分组 ----------
  var LOG_SET = { 4: 1, 20: 1, 22: 1, 33: 1, 35: 1, 46: 1, 52: 1, 57: 1 };
  var LEAF_SET = { 5: 1, 21: 1, 23: 1, 34: 1, 36: 1, 58: 1, 59: 1 };
  var PLANT_SET = { 26: 1, 47: 1, 55: 1, 56: 1, 54: 1 };
  var ORE_SET = { 8: 1, 9: 1, 39: 1, 40: 1, 41: 1, 42: 1, 43: 1, 44: 1,
    115: 1, 116: 1, 117: 1, 118: 1, 119: 1, 120: 1,
    // v8：红石矿石
    200: 1 };
  var FUNC_SET = { 15: 1, 17: 1, 19: 1, 37: 1, 38: 1, 67: 1, 68: 1, 69: 1, 70: 1, 71: 1,
    // v8：门/活板门/红石元件/耕地
    141: 1, 149: 1, 157: 1, 165: 1, 173: 1, 181: 1, 189: 1,
    197: 1, 198: 1, 199: 1, 221: 1, 222: 1,
    201: 1, 202: 1, 203: 1, 204: 1, 205: 1, 206: 1, 207: 1, 208: 1,
    209: 1, 210: 1, 211: 1, 212: 1, 213: 1, 214: 1 };

  var GROUPS = [
    { key: 'tools', name: '工具与武器', obtain: '工作台合成 · 有耐久不堆叠', tip: '工具等级越高开采越快；武器决定攻击伤害。' },
    { key: 'food', name: '食物', obtain: '狩猎 / 熔炉烧炼', tip: '选中后按 R 进食，恢复饥饿值。' },
    { key: 'materials', name: '材料', obtain: '采集 / 合成 / 烧炼', tip: '合成装备、火把与曲速电池的核心耗材。' },
    { key: 'functional', name: '功能方块', obtain: '工作台合成后放置', tip: '对准放置好的方块按 E 使用。' },
    { key: 'ores', name: '矿石与晶体', obtain: '矿脉开采 · 主动扫描编录', tip: '行星专属晶体会被扫描终端自动登记。' },
    { key: 'plants', name: '植物', obtain: '直接采集', tip: '砍伐树木获取原木与木板的第一来源。' },
    { key: 'terrain', name: '自然方块', obtain: '地表采集', tip: '用于建造庇护所的基础建材。' }
  ];

  function classify(id, d) {
    if (!d || !id) return null;
    if (d.tool === 'pick' || d.tool === 'sword' || d.hoeTool) return 'tools';
    if (d.food) return 'food';
    if (ORE_SET[id]) return 'ores';
    if (id === 100 || id === 107 || id === 108 || id === 121 || id === 122 ||
      id === 123 || id === 124 || id === 125 || id === 132 || id === 133 ||
      id === 135 || id === 220 || id === 239 || id === 240 ||
      (id >= 260 && id <= 275)) return 'materials';
    if (d.item) return null;   // 其余物品无语义归属，暂不展示
    if (FUNC_SET[id]) return 'functional';
    if (LOG_SET[id] || LEAF_SET[id] || PLANT_SET[id]) return 'plants';
    // v8：作物与花草
    if (id === 223 || (id >= 224 && id <= 238) || (id >= 251 && id <= 258)) return 'plants';
    // v8：染色变体与建造方块
    if ((id >= 280 && id <= 295) || (id >= 300 && id <= 315) ||
      (id >= 320 && id <= 335) || (id >= 340 && id <= 363)) return 'terrain';
    if (d.solid || id === 7) return 'terrain';
    return null;
  }

  function countItems() {
    var n = 0;
    for (var i = 1; i < Voxel.Blocks.defs.length; i++) {
      if (classify(i, Voxel.Blocks.defs[i])) n++;
    }
    return n;
  }

  // ---------- 生物档案（种类与文案同源 PlanetRules.faunaCatalog）----------
  var PORTRAIT = {
    sheep: { body: '#e8e4dc', belly: '#d9cfc2', head: '#e8b8a6', eye: '#3a3a44', extra: '#c98a76', pose: 'quad' },
    pig: { body: '#eda0a0', belly: '#f0b5ae', head: '#ef9f9f', eye: '#33333b', extra: '#d97d80', pose: 'quad' },
    chicken: { body: '#f2efe6', belly: '#faf8f0', head: '#f2efe6', eye: '#2d2d33', extra: '#d84f40', pose: 'quad' },
    rabbit: { body: '#c49a72', belly: '#dcc7ad', head: '#caa079', eye: '#2e2a26', extra: '#8f6d4e', pose: 'quad' },
    cat: { body: '#e0aa6e', belly: '#eec79a', head: '#e0aa6e', eye: '#4a7d3a', extra: '#b57f43', pose: 'quad' },
    zombie: { body: '#5f8f52', belly: '#4c7042', head: '#74a862', eye: '#1e2a1c', extra: '#37502f', pose: 'upright' },
    archer: { body: '#d8d4c4', belly: '#bdb8a5', head: '#d8d4c4', eye: '#2a2a28', extra: '#6e5636', pose: 'upright' },
    boomer: { body: '#63a83c', belly: '#8cc763', head: '#63a83c', eye: '#101010', extra: '#3f7d2a', pose: 'blob' },
    wolf: { body: '#8a8074', belly: '#9a9288', head: '#8a8074', eye: '#f2d84e', extra: '#6b625a', pose: 'quad' },
    villager: { body: '#7a5c38', belly: '#a8865a', head: '#d8b088', eye: '#30302c', extra: '#4a6e5c', pose: 'upright' },
    sand_stalker: { body: '#c9b48a', belly: '#8a6a3c', head: '#c9b48a', eye: '#2a2218', extra: '#6e5636', pose: 'upright' },
    dune_scorpion: { body: '#b86a2a', belly: '#8a4a18', head: '#b86a2a', eye: '#1a1008', extra: '#3a2010', pose: 'blob' },
    frost_wolf: { body: '#d8e4ee', belly: '#8aa0b0', head: '#d8e4ee', eye: '#7ec8ff', extra: '#8aa0b0', pose: 'quad' },
    yeti: { body: '#e8eef4', belly: '#c8d0d8', head: '#e8eef4', eye: '#2a3038', extra: '#c8d0d8', pose: 'upright' },
    spore_beast: { body: '#6b8f3a', belly: '#3d5a22', head: '#a85cb0', eye: '#1a2010', extra: '#a85cb0', pose: 'blob' },
    acid_mite: { body: '#8ccf3a', belly: '#d4f07a', head: '#8ccf3a', eye: '#101010', extra: '#4a7a18', pose: 'blob' },
    magma_crawler: { body: '#4a2a22', belly: '#ff6a20', head: '#4a2a22', eye: '#ffaa44', extra: '#ff6a20', pose: 'blob' },
    ash_mite: { body: '#6a6460', belly: '#e07030', head: '#6a6460', eye: '#e8a050', extra: '#e07030', pose: 'upright' },
    glow_jelly: { body: '#7ad8e8', belly: '#d8fff4', head: '#7ad8e8', eye: '#e8ffff', extra: '#d8fff4', pose: 'blob' },
    drowned: { body: '#3a7a72', belly: '#2a4a58', head: '#3a7a72', eye: '#1e2a1c', extra: '#2a5a40', pose: 'upright' },
    fjord_wolf: { body: '#4a4e52', belly: '#2e3236', head: '#4a4e52', eye: '#e8c84a', extra: '#2e3236', pose: 'quad' }
  };

  function faunaList() {
    if (!Voxel.PlanetRules || !Voxel.PlanetRules.faunaCatalog) return [];
    var cat = Voxel.PlanetRules.faunaCatalog();
    var out = [];
    for (var i = 0; i < cat.length; i++) {
      var e = cat[i];
      var p = PORTRAIT[e.type] || { body: '#888', belly: '#666', head: '#888', eye: '#111', extra: '#444', pose: 'quad' };
      out.push({
        type: e.type, name: e.name, habitat: e.habitat, drops: e.drops, behavior: e.behavior,
        body: p.body, belly: p.belly, head: p.head, eye: p.eye, extra: p.extra, pose: p.pose
      });
    }
    return out;
  }
  var FAUNA = faunaList();

  // ---------- 生物像素像 ----------
  function drawMobPortrait(canvas, spec, locked) {
    var ctx = canvas.getContext('2d');
    var S = canvas.width;
    var px = Math.floor(S / 16);
    ctx.clearRect(0, 0, S, S);
    // 环境底色：黄昏渐变草地
    var grad = ctx.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, locked ? 'rgba(20,24,32,.55)' : 'rgba(58,96,60,.35)');
    grad.addColorStop(1, locked ? 'rgba(12,14,20,.75)' : 'rgba(24,38,28,.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);

    function r(x, y, w, h, c) {
      ctx.fillStyle = c;
      ctx.fillRect(x * px, y * px, w * px, h * px);
    }
    if (locked) {
      ctx.fillStyle = 'rgba(8,10,14,0.65)';
      ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = 'rgba(220,228,255,0.25)';
      ctx.font = Math.floor(S * 0.42) + 'px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', S / 2, S / 2);
      return;
    }
    // 身体 / 头 / 四肢 —— 统一小兽比例；直立种走人形剪影
    if (spec.pose === 'upright' || spec.type === 'zombie') {
      r(6, 5, 4, 6, spec.body);        // 躯干
      r(6, 11, 1, 3, spec.extra);      // 左腿
      r(9, 11, 1, 3, spec.extra);      // 右腿
      r(5, 6, 1, 4, spec.body);        // 左臂前伸
      r(5.9 | 0, 5, 1, 1, spec.body);
      r(6, 2, 4, 3, spec.head);        // 头
      r(7, 3, 1, 1, spec.eye);         // 眼
      r(9, 3, 1, 1, spec.eye);
      r(6, 5, 4, 1, spec.belly);       // 衣领阴影
    } else {
      r(4, 7, 7, 4, spec.body);        // 躯干
      r(4, 10, 7, 1, spec.belly);      // 腹部
      r(4, 11, 1, 2, spec.extra);      // 四肢
      r(6, 11, 1, 2, spec.extra);
      r(8, 11, 1, 2, spec.extra);
      r(10, 11, 1, 2, spec.extra);
      r(10, 4, 3, 3, spec.head);       // 头（右上）
      r(13, 6, 1, 2, spec.extra);      // 吻部
      r(12, 5, 1, 1, spec.eye);        // 眼
      if (spec.type === 'chicken') {   // 鸡冠与喙
        r(11, 3, 1, 1, spec.extra);
        r(13, 7, 1, 1, '#e8a23c');
      }
      if (spec.type === 'rabbit') {    // 耳朵
        r(11, 2, 1, 2, spec.head);
        r(12, 2, 1, 2, spec.extra);
      }
      if (spec.type === 'cat') {       // 猫耳与尾巴
        r(10, 3, 1, 1, spec.head);
        r(12, 3, 1, 1, spec.head);
        r(2, 6, 2, 1, spec.extra);
        r(3, 7, 1, 1, spec.extra);
      }
    }
  }

  // ---------- 群系 ----------
  function biomeAccent(i) {
    try {
      var def = Voxel.Biomes.def(i);
      var b = Voxel.Blocks.defs[def.surface];
      var hex = (b && b.color ? b.color : 0x6fae4e).toString(16).padStart(6, '0');
      return '#' + hex;
    } catch (e) { return '#6fae4e'; }
  }

  function darken(hex, amt) {
    var v = parseInt(hex.slice(1), 16);
    var r = Math.max(0, ((v >> 16) & 255) - amt);
    var g = Math.max(0, ((v >> 8) & 255) - amt);
    var b = Math.max(0, (v & 255) - amt);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // ---------- 天体 ----------
  function galaxyState() {
    return Voxel.Game ? Voxel.Game.getGalaxy() : null;
  }

  // ---------- 渲染 ----------
  function ensureDom() {
    if (bodyEl || typeof document === 'undefined') return;
    bodyEl = document.getElementById('codex-body');
    tabsEl = document.getElementById('codex-tabs');
    summaryEl = document.getElementById('codex-summary');
    if (!tabsEl || tabsEl.childElementCount) { tabsEl = document.getElementById('codex-tabs'); }
    buildTabs();
  }

  function buildTabs() {
    if (!tabsEl || tabsEl.childElementCount) return;
    for (var i = 0; i < TABS.length; i++) {
      (function (tab) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn small codex-tab';
        b.setAttribute('data-tab', tab.key);
        b.addEventListener('click', function () { curTab = tab.key; refresh(); });
        b.textContent = tab.name;
        tabsEl.appendChild(b);
      })(TABS[i]);
    }
  }

  function setSummary(pct, text) {
    if (!summaryEl) return;
    var fill = summaryEl.querySelector('.ach-progress-fill');
    if (fill) fill.style.width = pct + '%';
    var b = summaryEl.querySelector('b');
    if (b) b.textContent = text;
    var span = summaryEl.querySelector('span');
    if (span) span.textContent = pct + '%';
  }

  function iconCanvas(id, locked) {
    var wrap = document.createElement('div');
    wrap.className = 'codex-icon' + (locked ? ' locked' : '');
    var cv = document.createElement('canvas');
    cv.width = 44; cv.height = 44;
    wrap.appendChild(cv);
    try { Voxel.HUD.drawIcon(cv, id); } catch (e) { }
    if (locked) {
      cv.style.filter = 'brightness(0.06)';
      var q = document.createElement('i');
      q.textContent = '?';
      wrap.appendChild(q);
    }
    return wrap;
  }

  // ---- 页签 1：物品 ----
  function renderItems(root) {
    var s = Voxel.Progress.state();
    var total = 0, got = 0;
    for (var i = 1; i < Voxel.Blocks.defs.length; i++) {
      var grp = classify(i, Voxel.Blocks.defs[i]);
      if (!grp) continue;
      total++;
      if (s.firsts[String(i)]) got++;
    }
    for (var gi = 0; gi < GROUPS.length; gi++) {
      var g = GROUPS[gi];
      var sec = document.createElement('section');
      sec.className = 'codex-section';
      var h = document.createElement('h3');
      h.innerHTML = '<span>' + g.name + '</span><small>' + g.obtain + '</small>';
      sec.appendChild(h);
      var grid = document.createElement('div');
      grid.className = 'codex-grid';
      var anyInGroup = false;
      for (var id = 1; id < Voxel.Blocks.defs.length; id++) {
        var d = Voxel.Blocks.defs[id];
        if (classify(id, d) !== g.key) continue;
        anyInGroup = true;
        var unlocked = !!s.firsts[String(id)];
        var card = document.createElement('article');
        card.className = 'codex-card' + (unlocked ? '' : ' secret');
        card.title = unlocked ? (d.name + ' · ' + g.tip) : '尚未发现的条目';
        card.appendChild(iconCanvas(id, !unlocked));
        var nm = document.createElement('strong');
        nm.textContent = unlocked ? d.name : '？？？';
        card.appendChild(nm);
        var sm = document.createElement('small');
        sm.textContent = unlocked
          ? ((d.item ? '物品' : '方块') + (d.maxDur ? ' · 耐久 ' + d.maxDur : '') +
            (d.food ? ' · 食物+' + d.food : '')) : '继续探索以解锁';
        card.appendChild(sm);
        grid.appendChild(card);
      }
      if (!anyInGroup) continue;
      sec.appendChild(grid);
      root.appendChild(sec);
    }
    return total > 0 ? got / total : 0;
  }

  // ---- 页签 2：生物 ----
  function renderFauna(root) {
    var s = Voxel.Progress.state();
    var got = 0;
    for (var i = 0; i < FAUNA.length; i++)
      if (s.fauna[FAUNA[i].type]) got++;
    for (var j = 0; j < FAUNA.length; j++) {
      var f = FAUNA[j];
      var unlocked = !!s.fauna[f.type];
      var card = document.createElement('article');
      card.className = 'codex-fauna-card' + (unlocked ? '' : ' secret');
      var picWrap = document.createElement('div');
      picWrap.className = 'codex-fauna-portrait';
      var cv = document.createElement('canvas');
      cv.width = 96; cv.height = 96;
      drawMobPortrait(cv, f, !unlocked);
      picWrap.appendChild(cv);
      card.appendChild(picWrap);
      var info = document.createElement('div');
      info.className = 'codex-fauna-info';
      var nm = document.createElement('strong');
      nm.textContent = unlocked ? f.name : '未知生物';
      info.appendChild(nm);
      var hab = document.createElement('small');
      hab.innerHTML = unlocked
        ? ('栖息：' + f.habitat + '<br>掉落：' + f.drops)
        : '使用 G 键扫描或近距离观察后收录';
      info.appendChild(hab);
      var be = document.createElement('p');
      be.textContent = unlocked ? f.behavior : '尚无观察记录 —— 它可能正躲在某个群系里看着你。';
      info.appendChild(be);
      card.appendChild(info);
      root.appendChild(card);
    }
    return got / FAUNA.length;
  }

  // ---- 页签 3：群系 ----
  function renderBiomes(root) {
    var s = Voxel.Progress.state();
    var count = Voxel.Biomes.count;
    var got = Object.keys(s.biomes).length;
    var grid = document.createElement('div');
    grid.className = 'codex-grid biomes-grid';
    for (var i = 0; i < count; i++) {
      var def = Voxel.Biomes.def(i);
      var unlocked = !!s.biomes[String(i)];
      var accent = biomeAccent(i);
      var card = document.createElement('article');
      card.className = 'codex-biome-card' + (unlocked ? '' : ' secret');
      card.style.background = unlocked
        ? 'linear-gradient(160deg,' + accent + 'cc,' + darken(accent, 70) + 'dd)'
        : '';
      var ic = iconCanvas(def.surface, !unlocked);
      ic.classList.add('codex-biome-icon');
      card.appendChild(ic);
      var nm = document.createElement('strong');
      nm.textContent = unlocked ? def.name : '未知群系';
      card.appendChild(nm);
      var sm = document.createElement('small');
      sm.textContent = unlocked
        ? (def.mobs && def.mobs.length ? '常见生命：' + mobNames(def.mobs) : '荒芜之地 · 无常态生命')
        : '踏上这片土地即可点亮';
      card.appendChild(sm);
      grid.appendChild(card);
    }
    root.appendChild(grid);
    return got / Math.max(1, count);
  }

  function mobNames(types) {
    var names = [];
    for (var i = 0; i < types.length; i++) {
      for (var j = 0; j < FAUNA.length; j++)
        if (FAUNA[j].type === types[i]) { names.push(FAUNA[j].name); break; }
    }
    return names.join(' · ') || '—';
  }

  // ---- 页签 4：星域 ----
  function renderCosmos(root) {
    var g = galaxyState();
    var wrap = document.createElement('div');
    if (!g) {
      wrap.innerHTML = '<p class="hint">进入世界后记录你的星际足迹。</p>';
      root.appendChild(wrap);
      return 0;
    }
    var visitN = 0;
    for (var vk in g.visitedSys) if (g.visitedSys[vk]) visitN++;
    var discN = 0;
    for (var dk in g.discovered) if (g.discovered[dk]) discN++;

    var stats = document.createElement('div');
    stats.className = 'codex-stats-row';
    stats.innerHTML =
      '<div class="codex-stat"><b>' + visitN + '</b><span>探索恒星系</span></div>' +
      '<div class="codex-stat"><b>' + discN + '</b><span>已抵达天体</span></div>' +
      '<div class="codex-stat"><b>' + Voxel.Progress.count('jumps') + '</b><span>跨系曲速</span></div>' +
      '<div class="codex-stat"><b>' + Voxel.Progress.count('portals') + '</b><span>传送门旅行</span></div>';
    wrap.appendChild(stats);

    var sub = document.createElement('h3');
    sub.innerHTML = '<span>当前恒星系 · ' + systemLabel(g) + '</span><small>抵达即录入档案</small>';
    wrap.appendChild(sub);
    var grid = document.createElement('div');
    grid.className = 'codex-grid cosmos-grid';
    var catalog = g.catalog || [];
    var hit = 0;
    for (var i = 0; i < catalog.length; i++) {
      var w = catalog[i];
      var found = !!g.discovered[w.id];
      if (found) hit++;
      var card = document.createElement('article');
      card.className = 'codex-cosmos-card' + (found ? '' : ' secret');
      var orby = document.createElement('div');
      orby.className = 'codex-orbit';
      var ball = document.createElement('i');
      if (found) {
        var topHex = '#' + (w.skyTop >>> 0).toString(16).padStart(6, '0');
        var horHex = '#' + (w.horizon >>> 0).toString(16).padStart(6, '0');
        ball.style.background =
          'radial-gradient(circle at 34% 30%,' + w.accent + ' 0%,' + horHex + ' 42%,' + topHex + ' 100%)';
      }
      orby.appendChild(ball);
      card.appendChild(orby);
      var nm = document.createElement('strong');
      nm.textContent = (found ? (w.icon + ' ') : '') + (found ? w.name : '未命名天体');
      card.appendChild(nm);
      var tp = document.createElement('small');
      tp.innerHTML = found
        ? (w.typeName + '<br>' + (w.desc || ''))
        : '导航链路待建立 · 前往即可解锁完整档案';
      card.appendChild(tp);
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
    root.appendChild(wrap);
    return catalog.length ? hit / catalog.length : 0;
  }

  function systemLabel(g) {
    var addr = 'g' + (g.curG | 0) + '/s' + (g.curS | 0);
    return (g.curG === 0 && g.curS === 0 ? '起源星系 ' : '') + addr;
  }

  function refresh() {
    ensureDom();
    if (!bodyEl || typeof document === 'undefined') return;
    buildTabs();
    var open = ['achievements', 'codex', 'paused'].indexOf(
      document.body.getAttribute('data-game-state')) >= 0;
    if (!open) return;
    bodyEl.innerHTML = '';
    var ratio = 0;
    if (curTab === 'items') ratio = renderItems(bodyEl);
    else if (curTab === 'fauna') ratio = renderFauna(bodyEl);
    else if (curTab === 'biomes') ratio = renderBiomes(bodyEl);
    else ratio = renderCosmos(bodyEl);
    setSummary(Math.round(ratio * 100),
      curTab + ' · 本页收集进度');
    var tabs = tabsEl.children;
    for (var i = 0; i < tabs.length; i++)
      tabs[i].setAttribute('aria-pressed', tabs[i].getAttribute('data-tab') === curTab ? 'true' : 'false');
  }

  return {
    refresh: refresh,
    FAUNA: FAUNA,
    countItems: countItems,
    tabKeys: function () { return TABS.map(function (t) { return t.key; }); }
  };
})();
