// 终局任务链：教程毕业后的长期目标。与 Tutorial 同构的事件驱动任务卡，
// 但不跳过、可跨阶段常驻；进度存于 Voxel.Progress.state.end。
// 数据源全部复用已有 Progress 计数（place/kills/biome/smelt/scan/jump/warp），
// 不产生新的埋点需求，旧档升级自动可用（end 缺失时回落第 1 阶段）。
window.Voxel = window.Voxel || {};

Voxel.Endgame = (function () {
  // 每阶段 test(ctx) 返回 true 即完成；ctx 提供 Progress 的只读聚合接口。
  var STAGES = [
    {
      id: 'outpost', title: '前哨建设',
      desc: '在行星地表建造一片营地（累计放置 24 个方块）',
      hint: '围墙 / 屋顶 / 工作台都算 —— 让落脚点像个家',
      test: function (c) { return c.count('placed') >= 24; }
    },
    {
      id: 'hunter', title: '开拓者的獠牙',
      desc: '击退 8 只敌对生物，守住建起的前哨',
      hint: '夜晚出没的僵尸会直扑营地 · 火把能阻止它们在附近生成',
      test: function (c) { return c.count('kills') >= 8; }
    },
    {
      id: 'smelter', title: '炉火不熄',
      desc: '烧炼 10 件物品（铁锭 / 熟食均可）',
      hint: '熔炉 + 煤炭：铁矿烧成铁锭，猎物烤成熟肉',
      test: function (c) { return c.count('smelted') >= 10; }
    },
    {
      id: 'cartographer', title: '群系测绘',
      desc: '踏足 6 种不同群系',
      hint: '沙漠 / 雪原 / 黑森林…… 走得越远地貌越多变',
      test: function (c) { return c.biomeSet() >= 6; }
    },
    {
      id: 'surveyor', title: '深空扫描',
      desc: '完成 5 次主动扫描（G 键）',
      hint: '扫描记录地质与遗迹，点亮发现档案并获得积分',
      test: function (c) { return c.count('scans') >= 5; }
    },
    {
      id: 'warpwright', title: '曲远征途',
      desc: '跃迁抵达 5 个新天体',
      hint: '飞船舱内按 H 打开星图 · 传送门网络也可抵达远方行星',
      test: function (c) { return c.count('warps') >= 5; }
    },
    {
      id: 'starfarer', title: '星海船长',
      desc: '完成一次跨恒星系曲速',
      hint: '集齐曲速电池 —— 远古遗迹的宝箱里常有存货',
      test: function (c) { return c.count('jumps') >= 1; }
    },
    {
      id: 'apex', title: '宇宙拓荒者',
      desc: '发现 3 种外星生物 · 找到一处远古遗迹 · 抵达过 8 个天体',
      hint: '最后一程 —— 你的航线已是这片星海的路标',
      test: function (c) {
        return c.faunaSet() >= 3 && c.count('ruins') >= 1 && c.count('warps') >= 8;
      }
    }
  ];

  var cardEl = null, titleEl = null, descEl = null, hintEl = null, progEl = null;
  var toastFinalShown = false;

  function ensureDom() {
    if (cardEl || typeof document === 'undefined') return;
    cardEl = document.createElement('div');
    cardEl.id = 'endgame-card';
    cardEl.className = 'tutorial-card endgame-card';   // 复用教程卡样式族
    cardEl.setAttribute('role', 'region');
    cardEl.setAttribute('aria-label', '终局任务卡');
    cardEl.innerHTML =
      '<div class="tut-kicker" aria-hidden="true">MISSION</div>' +
      '<strong class="tut-title"></strong>' +
      '<span class="tut-desc"></span>' +
      '<small class="tut-hint"></small>' +
      '<div class="tut-foot"><span class="tut-step-label"></span></div>';
    document.body.appendChild(cardEl);
    titleEl = cardEl.querySelector('.tut-title');
    descEl = cardEl.querySelector('.tut-desc');
    hintEl = cardEl.querySelector('.tut-hint');
    progEl = cardEl.querySelector('.tut-step-label');
  }

  function st() { return Voxel.Progress.state().end; }

  function activeStageIndex() {
    var e = st();
    if (!e || e.done) return -1;
    if (e.i >= STAGES.length) { e.done = true; return -1; }
    return e.i;
  }

  // 教程毕业后才开始展示；同一时刻只亮一张卡（教程优先）。
  function refresh() {
    ensureDom();
    if (!cardEl) return;
    var tutDone = Voxel.Progress.state().tut.done;
    var idx = tutDone ? activeStageIndex() : -1;
    var bodyOk = ['playing', 'inventory', 'paused'].indexOf(document.body.getAttribute('data-game-state')) >= 0;
    if (idx < 0 || !bodyOk) {
      cardEl.classList.add('hidden');
      if (idx < 0) cardEl.setAttribute('aria-hidden', 'true');
      return;
    }
    cardEl.classList.remove('hidden');
    cardEl.removeAttribute('aria-hidden');
    var s = STAGES[idx];
    if (titleEl.textContent !== s.title) titleEl.textContent = s.title;
    if (descEl.textContent !== s.desc) descEl.textContent = s.desc;
    if (hintEl.textContent !== ('提示：' + s.hint)) hintEl.textContent = '提示：' + s.hint;
    var prog = (idx + 1) + ' / ' + STAGES.length;
    if (progEl.textContent !== prog) progEl.textContent = prog;
  }

  function advance(fromIdx) {
    var e = st();
    if (e.i !== fromIdx || e.done) return;
    e.i = fromIdx + 1;
    if (e.i >= STAGES.length) {
      e.done = true;
      if (!toastFinalShown && Voxel.HUD && Voxel.HUD.toast) {
        toastFinalShown = true;
        Voxel.HUD.toast('🏆 终局达成：你已成为真正的宇宙拓荒者！');
      }
    } else if (Voxel.HUD && Voxel.HUD.toast) {
      Voxel.HUD.toast('★ 终局目标达成：' + STAGES[fromIdx].title);
    }
    refresh();
  }

  function onEvent() {
    var idx = activeStageIndex();
    if (idx < 0) return;
    var P = Voxel.Progress;
    try {
      if (STAGES[idx].test(P)) advance(idx);
    } catch (e) { /* 判定异常不阻塞游戏 */ }
    refresh();
  }

  function restart() {
    var e = st();
    e.i = 0;
    e.done = false;
    toastFinalShown = false;
    refresh();
  }

  return {
    init: function () {
      if (Voxel.Progress) Voxel.Progress.subscribe(onEvent);
      refresh();
    },
    refresh: refresh,
    restart: restart,
    stages: STAGES.length,
    currentStage: function () { return activeStageIndex(); }
  };
})();
