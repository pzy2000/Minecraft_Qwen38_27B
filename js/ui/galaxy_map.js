// 银河星图（跨恒星系导航）：两级星图的「银河」层。
// 纯 DOM 渲染模块：依赖 seed/universe/galaxy 的纯逻辑，不依赖 THREE，
// 可在浏览器与测试页面中直接驱动。space_travel.js 委托本模块实现标签切换。
window.Voxel = window.Voxel || {};

Voxel.GalaxyMap = (function () {
  var WINDOW_RADIUS = 2;   // 5×5 视窗
  var PAN_STEP = 4;

  var mode = 'system';                 // 'system' | 'galaxy'
  var origin = { g: 0, s: 0 };         // 视窗左上附近的锚点（当前中心系）
  var selectedAddr = null;

  function doc(ctx) { return ctx && ctx.doc ? ctx.doc : document; }

  function setText(el, value) { if (el && el.textContent !== value) el.textContent = value; }

  function starAccent(color) {
    return typeof color === 'number'
      ? '#' + ('000000' + color.toString(16)).slice(-6) : '#8190a8';
  }

  function cellsOf(galaxy) {
    return galaxy && galaxy.ship && typeof galaxy.ship.warpCells === 'number'
      ? galaxy.ship.warpCells : 0;
  }

  // ---- 选择状态 ----

  function setSelected(addrStr, ctx) {
    selectedAddr = typeof addrStr === 'string' &&
      Voxel.Universe.parseAddr(addrStr) ? addrStr : null;
    var d = doc(ctx);
    var grid = ctx && ctx.grid ? ctx.grid : d.getElementById('starmap-grid');
    if (grid) {
      var cards = grid.querySelectorAll('.galaxy-card');
      for (var i = 0; i < cards.length; i++) {
        var sel = cards[i].getAttribute('data-addr') === selectedAddr;
        cards[i].classList.toggle('selected', !!sel);
        cards[i].setAttribute('aria-pressed', sel ? 'true' : 'false');
      }
    }
    syncSelection(ctx);
    return !!selectedAddr;
  }

  function selectionPlan(galaxy) {
    if (!selectedAddr || !galaxy || !Voxel.Galaxy.jumpPlan) return null;
    var parsed = Voxel.Universe.parseAddr(selectedAddr);
    if (!parsed) return null;
    var plan = Voxel.Galaxy.jumpPlan(galaxy, parsed.g, parsed.s);
    return plan && plan.valid
      ? { g: parsed.g, s: parsed.s, cost: plan.cost, reachable: plan.reachable,
          cells: plan.cells, shortfall: plan.shortfall, addr: selectedAddr }
      : null;
  }

  function syncSelection(ctx) {
    if (mode !== 'galaxy') return false;
    var d = doc(ctx);
    var galaxy = ctx ? ctx.galaxy : null;
    var selection = d.getElementById('cockpit-selection');
    var ignite = d.getElementById('btn-travel-ignite');
    var cockpit = d.getElementById('starmap-cockpit');
    var plan = selectionPlan(galaxy);
    if (!plan) {
      setText(selection, '请选择目标恒星系以锁定曲速航线');
      if (cockpit) cockpit.setAttribute('data-state', 'idle');
      if (ignite) {
        ignite.disabled = true;
        ignite.setAttribute('aria-disabled', 'true');
      }
      return false;
    }
    var desc = Voxel.Universe.describe(galaxy.rootSeed, plan.g, plan.s);
    var visited = !!(galaxy.visitedSys && galaxy.visitedSys[plan.addr]);
    var label = (visited ? desc.name : '未探索恒星') + ' · ' + desc.star.label;
    if (!plan.reachable) {
      setText(selection, '曲速航线不可用 · ' + label +
        ' · 需要 ' + plan.cost + ' 电池 · 当前 ' + plan.cells + ' · 缺少 ' + plan.shortfall);
      if (cockpit) cockpit.setAttribute('data-state', 'insufficient');
    } else {
      var dist = Math.hypot(plan.g - galaxy.curG, plan.s - galaxy.curS);
      setText(selection, '曲速航线已锁定：' + label +
        ' · 距离 ' + dist.toFixed(1) +
        ' · 消耗 ' + plan.cost + ' 曲速电池 · 到达后 ' + (plan.cells - plan.cost));
      if (cockpit) cockpit.setAttribute('data-state', 'locked');
    }
    if (ignite) {
      ignite.disabled = !plan.reachable;
      ignite.setAttribute('aria-disabled', plan.reachable ? 'false' : 'true');
    }
    return true;
  }

  // ---- 渲染 ----

  function render(ctx) {
    var d = doc(ctx);
    var galaxy = ctx.galaxy;
    var grid = ctx.grid || d.getElementById('starmap-grid');
    if (!grid || !galaxy || !Voxel.Universe || !Voxel.Galaxy) return false;
    grid.innerHTML = '';
    grid.setAttribute('data-mode', 'galaxy');

    var originLabel = d.getElementById('galaxy-origin-label');
    setText(originLabel, '视窗 g' + (origin.g | 0) + '/s' + (origin.s | 0));

    var curG = galaxy.curG | 0, curS = galaxy.curS | 0;
    var cellsText = cellsOf(galaxy);
    var status = d.getElementById('starmap-status');
    var descCur = Voxel.Universe.describe(galaxy.rootSeed, curG, curS);

    for (var dg = -WINDOW_RADIUS; dg <= WINDOW_RADIUS; dg++) {
      for (var ds = -WINDOW_RADIUS; ds <= WINDOW_RADIUS; ds++) {
        var gPos = (origin.g | 0) + dg, sPos = (origin.s | 0) + ds;
        var addrStr = Voxel.Universe.addr(gPos, sPos);
        if (!addrStr) continue;
        var isCurrent = gPos === curG && sPos === curS;
        var visited = !!(galaxy.visitedSys && galaxy.visitedSys[addrStr]);
        var desc = Voxel.Universe.describe(galaxy.rootSeed, gPos, sPos);
        var cost = Voxel.Universe.jumpCells({ g: curG, s: curS }, { g: gPos, s: sPos });
        var dist = Math.hypot(gPos - curG, sPos - curS);
        var reachable = !isCurrent && cellsText >= cost;

        (function (addrStr, desc, isCurrent, visited, cost, dist, reachable) {
          var card = d.createElement('button');
          card.type = 'button';
          card.className = 'star-card galaxy-card' +
            (isCurrent ? ' current' : '') + (visited ? ' discovered' : '') +
            (!visited && !isCurrent ? ' unknown' : '') +
            (!reachable && !isCurrent ? ' insufficient' : '');
          card.disabled = isCurrent;
          card.setAttribute('data-addr', addrStr);
          card.setAttribute('aria-pressed', 'false');
          if (isCurrent) card.setAttribute('aria-current', 'location');
          card.style.setProperty('--accent',
            visited || isCurrent ? starAccent(desc.star.color) : '#8190a8');
          var icon = d.createElement('span');
          icon.className = 'star-icon';
          icon.textContent = visited || isCurrent ? '✶' : '·';
          var main = d.createElement('span');
          main.className = 'star-main';
          var name = d.createElement('b');
          name.textContent = visited || isCurrent ? desc.name : '未探索恒星';
          var detail = d.createElement('small');
          detail.textContent = visited || isCurrent
            ? desc.star.label + ' · 行星 ' + desc.planetCount
            : desc.galaxyName + ' · 光谱未确认';
          main.appendChild(name); main.appendChild(detail);
          var meta = d.createElement('span');
          meta.className = 'star-meta';
          meta.appendChild(d.createTextNode(isCurrent
            ? '当前位置 · ' + addrStr
            : addrStr + ' · 距离 ' + dist.toFixed(1)));
          if (!isCurrent) {
            meta.appendChild(d.createElement('br'));
            meta.appendChild(d.createTextNode(reachable
              ? '曲速 ' + cost + ' 电池'
              : '需要 ' + cost + ' 电池 · 不足'));
          }
          var routeInfo = isCurrent ? '当前位置' :
            (visited ? '已探索恒星系，消耗 ' + cost + ' 枚曲速电池'
              : '未探索恒星系，跃迁消耗 ' + cost + ' 枚曲速电池');
          card.setAttribute('aria-label',
            (visited || isCurrent ? desc.name : '未探索恒星') + '，' + addrStr + '，' + routeInfo);
          card.appendChild(icon); card.appendChild(main); meta && card.appendChild(meta);
          if (ctx && typeof ctx.onSelect === 'function')
            card.addEventListener('click', function () { ctx.onSelect(addrStr); });
          else card.addEventListener('click', function () { setSelected(addrStr, ctx); });
          grid.appendChild(card);
        })(addrStr, desc, isCurrent, visited, cost, dist, reachable);
      }
    }

    setText(status, descCur.galaxyName + ' · 当前 g' + curG + '/s' + curS +
      ' · 曲速电池 ' + cellsText);
    if (selectedAddr) setSelected(selectedAddr, ctx);
    else syncSelection(ctx);
    return true;
  }

  // ---- 模式切换 / 平移 ----

  function setMode(next, ctx) {
    mode = next === 'galaxy' ? 'galaxy' : 'system';
    var d = doc(ctx);
    var panel = d.getElementById('overlay-starmap');
    if (panel) panel.setAttribute('data-map-mode', mode);
    var tabs = d.querySelectorAll('.starmap-tab');
    for (var i = 0; i < tabs.length; i++)
      tabs[i].setAttribute('aria-pressed',
        tabs[i].getAttribute('data-mode') === mode ? 'true' : 'false');
    if (!ctx || !ctx.galaxy) return mode;
    if (mode === 'galaxy') {
      origin.g = ctx.galaxy.curG | 0;
      origin.s = ctx.galaxy.curS | 0;
      selectedAddr = null;
      render(ctx);
      if (typeof ctx.onShowGalaxy === 'function') ctx.onShowGalaxy();
    } else if (typeof ctx.onShowSystem === 'function') ctx.onShowSystem();
    return mode;
  }

  function pan(dg, ds, ctx) {
    // 无限宇宙：视窗可向任意方向无限平移（坐标允许负值）。
    origin.g = (origin.g | 0) + dg;
    origin.s = (origin.s | 0) + ds;
    render(ctx);
    return true;
  }

  function home(ctx) {
    if (!ctx || !ctx.galaxy) return false;
    origin.g = ctx.galaxy.curG | 0;
    origin.s = ctx.galaxy.curS | 0;
    render(ctx);
    return true;
  }

  function getMode() { return mode; }
  function getOrigin() { return { g: origin.g, s: origin.s }; }
  function getSelectedAddr() { return selectedAddr; }
  function clearSelection() { selectedAddr = null; }

  return {
    PAN_STEP: PAN_STEP,
    WINDOW_RADIUS: WINDOW_RADIUS,
    getMode: getMode,
    setMode: setMode,
    pan: pan,
    home: home,
    select: function (addrStr, ctx) { return setSelected(addrStr, ctx); },
    getSelection: selectionPlan,
    getSelectedAddr: getSelectedAddr,
    clearSelection: clearSelection,
    render: render,
    syncSelection: syncSelection
  };
})();
