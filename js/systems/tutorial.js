// 新手引导：分步任务卡。跟随 README「新手流程」链条：
// 移动 → 采原木 → 木板 → 工作台 → 放置并使用工作台 → 木镐 → 挖石 → 熔炉 → 烧铁 → 火把 → 毕业(登舰)。
// 进度存于 Voxel.Progress.state.tut；DOM 卡片由本模块自建，可随时跳过。
window.Voxel = window.Voxel || {};

Voxel.Tutorial = (function () {
  var LOG_IDS = { 4: 1, 20: 1, 22: 1, 33: 1, 35: 1, 46: 1, 52: 1, 57: 1 };

  // step: 完成条件判定函数(type,data,ctx)，返回 true 即完成
  var STEPS = [
    {
      id: 'move', title: '迈出第一步', desc: '按 WASD 移动 · 鼠标环视四周',
      hint: '空格跳跃 · Shift 疾跑',
      test: function () { return Voxel.Progress.count('movedMeters') >= 6; }
    },
    {
      id: 'log', title: '采集原木', desc: '对准树干按住右键长按挖掘',
      hint: '橡木/云杉/丛林木等任意原木都可以',
      test: function (type, data) {
        return type === 'mine' && LOG_IDS[data.id | 0] ? true : false;
      }
    },
    {
      id: 'planks', title: '合成木板', desc: '按 E 打开背包，在 2×2 合成格放入原木',
      hint: '点击右侧结果格取出木板（需 ×4）',
      test: function (type, data) {
        return type === 'craft' && (data.id | 0) === 10 &&
          Voxel.Progress.idCount('craft', 10) >= 4;
      }
    },
    {
      id: 'table', title: '制作工作台', desc: '用 4 块木板填满背包 2×2 合成格',
      hint: '点结果格取出',
      test: function (type, data) {
        return type === 'craft' && (data.id | 0) === 15;
      }
    },
    {
      id: 'place_table', title: '放置工作台', desc: '选中快捷栏中的工作台，左键放置在地面上',
      hint: '按 1-9 或滚轮选择快捷栏格',
      test: function (type, data) {
        return type === 'place' && data.placedId === 15;
      }
    },
    {
      id: 'use_table', title: '使用工作台', desc: '准星对准工作台按 E，打开 3×3 合成界面',
      hint: '3×3 可以合成全部工具与功能方块',
      test: function (type) {
        return type === 'use_block' && dataOfUse === 15;
      }
    },
    {
      id: 'wood_pick', title: '第一把木镐', desc: '在工作台中用木板+木棍合成木镐',
      hint: '木棍 = 2 木板竖放',
      test: function (type, data) {
        return type === 'craft' && (data.id | 0) === 101;
      }
    },
    {
      id: 'stone', title: '开采石头', desc: '找到地表岩石或裸露矿脉，挖取 3 块石头',
      hint: '圆石也可以用于建造',
      test: function () { return stoneMined() >= 3; }
    },
    {
      id: 'furnace', title: '搭建熔炉', desc: '用 8 块圆石/石头在工作台合成熔炉并放置',
      hint: '熔炉可以烧炼矿石与食物',
      test: function (type, data) {
        if (type === 'place' && data.placedId === 37) return true;
        return false;
      }
    },
    {
      id: 'iron', title: '烧炼铁锭', desc: '熔炉上层放铁矿、下层放燃料（煤炭/木板）',
      hint: '铁矿石需要石镐开采 · 按 E 打开熔炉',
      test: function (type, data) {
        return type === 'smelt' && (data.id | 0) === 108 ||
          type === 'gain' && (data.id | 0) === 108;
      }
    },
    {
      id: 'graduate', title: '启程深空', desc: '靠近飞船按 E 登舰避难 · 舱内按 H 打开星图跃迁',
      hint: 'G 扫描 · B 图鉴 · J 成就 · 祝旅途平安！',
      test: function (type) {
        return type === 'board' || type === 'warp' || type === 'jump';
      }
    }
  ];

  var cardEl = null, titleEl = null, descEl = null, hintEl = null, progEl = null;

  function stoneMined() {
    return (Voxel.Progress.idCount('mine', 3) + Voxel.Progress.idCount('mine', 11));
  }

  // 'use_block' 事件在 openCrafting 时触发，此时携带方块 id 需要闭包外转交
  var dataOfUse = 0;

  function ensureDom() {
    if (cardEl || typeof document === 'undefined') return;
    cardEl = document.createElement('div');
    cardEl.id = 'tutorial-card';
    cardEl.className = 'tutorial-card';
    cardEl.setAttribute('role', 'region');
    cardEl.setAttribute('aria-label', '新手教程任务卡');
    cardEl.innerHTML =
      '<div class="tut-kicker" aria-hidden="true">TUTORIAL</div>' +
      '<strong class="tut-title"></strong>' +
      '<span class="tut-desc"></span>' +
      '<small class="tut-hint"></small>' +
      '<div class="tut-foot"><span class="tut-step-label"></span>' +
      '<button class="tut-skip" type="button">跳过教程</button></div>';
    document.body.appendChild(cardEl);
    titleEl = cardEl.querySelector('.tut-title');
    descEl = cardEl.querySelector('.tut-desc');
    hintEl = cardEl.querySelector('.tut-hint');
    progEl = cardEl.querySelector('.tut-step-label');
    cardEl.querySelector('.tut-skip').addEventListener('click', skip);
  }

  function activeStepIndex() {
    var t = Voxel.Progress.state().tut;
    if (!t.started || t.done) return -1;
    if (t.step >= STEPS.length) { t.done = true; return -1; }
    return t.step;
  }

  function refresh() {
    ensureDom();
    if (!cardEl) return;
    var idx = activeStepIndex();
    var bodyOk = ['playing', 'inventory', 'paused'].indexOf(document.body.getAttribute('data-game-state')) >= 0;
    if (idx < 0 || !bodyOk) {
      cardEl.classList.add('hidden');
      if (idx < 0) cardEl.setAttribute('aria-hidden', 'true');
      return;
    }
    cardEl.classList.remove('hidden');
    cardEl.removeAttribute('aria-hidden');
    var st = STEPS[idx];
    if (titleEl.textContent !== st.title) titleEl.textContent = st.title;
    if (descEl.textContent !== st.desc) descEl.textContent = st.desc;
    if (hintEl.textContent !== st.hint) hintEl.textContent = '提示：' + st.hint;
    if (progEl.textContent !== (idx + 1 + ' / ' + STEPS.length))
      progEl.textContent = idx + 1 + ' / ' + STEPS.length;
    cardEl.setAttribute('data-stage', String(idx));
  }

  function onEvent(type, data) {
    var t = Voxel.Progress.state().tut;
    if (!t.started || t.done) return;
    if (type === 'use_block') dataOfUse = (data && data.id) || 0;
    var idx = activeStepIndex();
    if (idx < 0) return;
    try {
      if (STEPS[idx].test(type, data)) advance(idx);
    } catch (e) { /* 判定异常不阻塞游戏 */ }
    refresh();
  }

  function advance(fromIdx) {
    var t = Voxel.Progress.state().tut;
    if (fromIdx !== t.step) return;
    t.step = fromIdx + 1;
    if (t.step >= STEPS.length) {
      t.done = true;
      if (Voxel.HUD && Voxel.HUD.toast)
        Voxel.HUD.toast('🎉 教程完成！你已掌握所有生存基础 — 愿星辰为你引路');
    } else {
      if (Voxel.HUD && Voxel.HUD.toast)
        Voxel.HUD.toast('✓ 任务完成：' + STEPS[fromIdx].title);
    }
    refresh();
  }

  function skip() {
    var t = Voxel.Progress.state().tut;
    t.step = STEPS.length;
    t.done = true;
    refresh();
  }

  function restart() {
    var t = Voxel.Progress.state().tut;
    t.started = true;
    t.step = 0;
    t.done = false;
    refresh();
  }

  return {
    onEvent: onEvent,
    refresh: refresh,
    restart: restart,
    skip: skip,
    steps: STEPS.length,
    currentStep: function () { return activeStepIndex(); }
  };
})();
