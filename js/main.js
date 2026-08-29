// 主逻辑：状态机、主循环、挖掘/放置、存档调度
window.Voxel = window.Voxel || {};

Voxel.Game = (function () {
  var CFG = Voxel.Config;
  var C = CFG.PLAYER;

  var state = 'loading';
  var renderer, scene, camera, canvas, highlight;
  var MAX_STACK = Voxel.Blocks.MAX_STACK || 64;
  var WARP_CELL_ITEM_ID = 122;
  var MAX_WARP_CELLS = 1000000;
  var inv = [], cnt = [];
  for (var i0 = 0; i0 < 36; i0++) { inv.push(0); cnt.push(0); }
  var dur = [];   // 与 inv 平行：工具耐久（非工具格为 null）
  for (var i0d = 0; i0d < 36; i0d++) dur.push(null);
  var sel = 0, heldItem = 0, heldCnt = 0, heldDur = null;
  // 装备槽与充能槽（功能性装备系统）
  var gear = [0, 0];            // [0]=头部（防毒面具130）[1]=身体（防寒服131），0=空
  var gearDur = [null, null];   // 与 gear 平行的装备耐久
  var charge = { id: 0, n: 0 }; // 充能槽：单格可堆叠（面具吃木炭125，防寒服吃煤炭107）
  var GEAR_HEAD_ID = 130, GEAR_BODY_ID = 131, CHARCOAL_ID = 125, COAL_ID = 107;
  var gearChargeAccum = 0, gearDurAccum = 0, gearHintT = 0;
  var craftGrid = [0, 0, 0, 0, 0, 0, 0, 0, 0];   // 工作台 3x3（每格 1 个）
  var invCraftGrid = [0, 0, 0, 0];               // 背包 2x2（每格 1 个）
  var manualOpen = false, manualReturnState = 'menu';
  var saveData = null, pendingEdits = null, featuredPending = null;
  var pendingTravel = null, travelSerial = 0, selectedTravelId = null;
  var travelRecoveryNotice = '';
  var travelRollbackHealthPending = false;
  var worldReplacePending = null, worldReplaceReturnFocus = null, worldReplaceReturnState = null;
  var galaxyState = null, currentWorld = null, travelStats = null;
  var restoreBusy = false, restoreBusyTimer = null;
  var activeScan = null, scanCooldownT = 0, scanResultT = 0;
  var environmentUiSignature = '', environmentLastLevel = 'safe';
  var environmentLastProtected = true;
  var mouseDown = [false, false, false];
  var lastDig = 0, lastPlace = 0;
  var autosaveT = 0, regenT = 0, lastHp = C.HP, lastDmgT = -99;
  // 单一存档健康状态驱动 HUD、暂停面板和无障碍播报。只有 Save.save 返回 true
  // （底层已完成精确回读校验）才允许从 unsaved 转为 recovered/saved。
  var saveHealth = {
    state: 'idle', source: 'none', message: '本次会话尚未完成已验证写入。',
    failureClass: 'none', consecutiveFailures: 0, totalFailures: 0, assertiveAnnouncements: 0
  };
  var saveConflict = false;
  var pendingFailureAnnouncement = false;
  var pauseSaveFeedbackSerial = 0;
  // 长按挖掘进度
  var digT = null, digProg = 0, digNeed = 0, digHintT = 0, digSndT = 0;
  var crackMesh = null, crackTex = [];
  // 重力方块（沙/砾下落）与水的简化流动
  var fallers = [], fallMat = null;
  var waterQ = [], waterT = 0;
  var fps = 0, frames = 0, fpsT = 0;
  var debug = false;
  // 逻辑固定 60Hz；渲染可按显示器 90/120/144Hz 独立运行。
  var FIXED_DT = 1 / 60;
  var MAX_FIXED_STEPS = 5;
  var MAX_FRAME_DT = 0.1;
  var STEP_EPSILON = 1e-9;
  var CAP_EPSILON_MS = 0.001;
  var simAccumulator = 0, fixedStepsTotal = 0, droppedSimTime = 0;
  var lastT = null;
  var lastErrT = 0;
  var lastBlankCheck = 0;
  var uwFade = 0;   // 水下滤镜渐变系数 0~1
  var _uwColor = new THREE.Color(0x14507e);
  var _tint = new THREE.Color(), _sky = new THREE.Color(), _skyTop = new THREE.Color();
  var _sunDir = new THREE.Vector3();
  var _cockpitProxy = new THREE.Vector3(), _cockpitVelocity = new THREE.Vector3();

  function setState(s) {
    // playing/furnace 是活跃固定时钟；任一端跨状态都清余量，离开活跃态时
    // 使墙钟基线失效，避免 furnace→manual→furnace 等路径补算隐藏时间。
    var wasActive = state === 'playing' || state === 'furnace' || state === 'cockpit' || state === 'riding';
    var nextActive = s === 'playing' || s === 'furnace' || s === 'cockpit' || s === 'riding';
    if (state !== s && (wasActive || nextActive)) {
      simAccumulator = 0;
      // 离开活跃模拟态时先使墙钟基线失效；若面板期间仍有渲染帧，frame() 会自然
      // 建立最新基线。若后台完全无帧，恢复后的首帧只建基线而不会补算后台时间。
      if (wasActive) lastT = null;
    }
    if (state === 'playing' && s !== 'playing' && activeScan && typeof cancelActiveScan === 'function')
      cancelActiveScan(false);
    state = s;
    Game.state = s;
    if (document.body) document.body.setAttribute('data-game-state', s);
    var scanTerminal = document.getElementById('scan-terminal');
    if (scanTerminal) scanTerminal.setAttribute('aria-hidden', s === 'playing' ? 'false' : 'true');
    if (Voxel.Touch && Voxel.Touch.onFrame) Voxel.Touch.onFrame(s);
    // 无模态时也要随 menu/loading/playing 切换 HUD 与画布可达性。
    if (typeof syncModalAccessibility === 'function') syncModalAccessibility();
  }

  // ---------- 统一模态层：状态、焦点、Tab/Escape、背景 inert ----------
  var modalStack = [];
  var intentionalUnlockPending = false, intentionalUnlockTimer = null;
  var MODAL_LAYER_IDS = [
    'game', 'hud', 'cockpit-hud', 'btn-starmap-hud', 'btn-scan-hud', 'btn-discovery-log',
    'inventory', 'crafting', 'furnace', 'chest', 'manual',
    'overlay-start', 'overlay-pause', 'overlay-dead', 'overlay-featured',
    'overlay-world-replace', 'overlay-starmap', 'overlay-discovery', 'overlay-settings', 'rotate-hint',
    'overlay-achievements', 'overlay-codex', 'tutorial-card'
  ];

  // 成长系统事件分发：Progress 只负责计数与广播，Tutorial/Achievements 自行判定。
  if (Voxel.Progress && Voxel.Tutorial)
    Voxel.Progress.subscribe(function (t, d) { Voxel.Tutorial.onEvent(t, d); });
  if (Voxel.Progress && Voxel.Achievements)
    Voxel.Progress.subscribe(function (t, d) { Voxel.Achievements.onEvent(t, d); });

  function modalTop() { return modalStack.length ? modalStack[modalStack.length - 1] : null; }

  function menuOwnsCurrentModalFlow() {
    if (state === 'menu' || state === 'featured' || state === 'world-replace') return true;
    var root = modalStack.length ? modalStack[0] : null;
    return !!(root && root.returnState === 'menu');
  }

  function clearIntentionalUnlock() {
    intentionalUnlockPending = false;
    if (intentionalUnlockTimer) clearTimeout(intentionalUnlockTimer);
    intentionalUnlockTimer = null;
  }

  function exitLockForUI() {
    if (!Voxel.Controls) return;
    if (!Voxel.Controls.touchMode() && Voxel.Controls.isLocked()) {
      intentionalUnlockPending = true;
      if (intentionalUnlockTimer) clearTimeout(intentionalUnlockTimer);
      // 防御：浏览器若吞掉 pointerlockchange，不能永久吞掉未来真实的 Esc 解锁。
      intentionalUnlockTimer = setTimeout(clearIntentionalUnlock, 2000);
    }
    Voxel.Controls.exitLock();
  }

  function modalFocusables(root) {
    if (!root) return [];
    var all = root.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].tabIndex >= 0 && !all[i].classList.contains('hidden') &&
        all[i].getAttribute('aria-hidden') !== 'true') out.push(all[i]);
    }
    return out;
  }

  function syncModalAccessibility() {
    var top = modalTop();
    for (var i = 0; i < MODAL_LAYER_IDS.length; i++) {
      var el = document.getElementById(MODAL_LAYER_IDS[i]);
      if (!el) continue;
      var active = !!top && el === top.root;
      // 游戏容器面板复用 HUD hotbar 做拖拽；保留 HUD 容器可交互，但其唯一背景按钮
      // btn-starmap-hud 仍由下一项单独 inert。其他模态继续冻结整个 HUD。
      if (top && el.id === 'hud' && ['inventory', 'crafting', 'furnace', 'chest'].indexOf(top.state) >= 0)
        active = true;
      var idleGameLayer = !top && (el.id === 'game' || el.id === 'hud' || el.id === 'cockpit-hud' ||
        el.id === 'btn-starmap-hud' || el.id === 'btn-scan-hud' || el.id === 'btn-discovery-log');
      var idleActive = el.id === 'game' ? (state === 'playing' || state === 'cockpit') :
        (el.id === 'cockpit-hud' ? state === 'cockpit' : state === 'playing');
      el.inert = top ? !active : (idleGameLayer && !idleActive);
      if (top) el.setAttribute('aria-hidden', active ? 'false' : 'true');
      else if (idleGameLayer && !idleActive) el.setAttribute('aria-hidden', 'true');
      else if (el.classList && el.classList.contains('hidden')) el.setAttribute('aria-hidden', 'true');
      else el.removeAttribute('aria-hidden');
    }
  }

  function resolveModalFocus(entry) {
    var target = entry.initialFocus;
    if (typeof target === 'function') target = target();
    else if (typeof target === 'string') target = document.querySelector(target);
    if (!target) {
      var list = modalFocusables(entry.root);
      target = list.length ? list[0] : null;
    }
    return target;
  }

  function openModalLayer(options) {
    var root = document.getElementById(options.id);
    if (!root) return null;
    var top = modalTop();
    if (top && top.root === root) return top;
    var entry = {
      id: options.id,
      root: root,
      state: options.state,
      returnState: options.returnState || state,
      trigger: options.trigger || document.activeElement,
      initialFocus: options.initialFocus || null,
      closeKeys: options.closeKeys || [],
      manualKey: !!options.manualKey,
      onEscape: options.onEscape || null
    };
    modalStack.push(entry);
    root.classList.remove('hidden');
    setState(entry.state);
    exitLockForUI();
    syncModalAccessibility();
    setTimeout(function () {
      if (modalTop() !== entry) return;
      var focus = resolveModalFocus(entry);
      if (focus && focus.focus) focus.focus();
    }, 0);
    return entry;
  }

  function closeModalLayer(id, restoreFocus) {
    var entry = modalTop();
    if (!entry || entry.id !== id) return false;
    entry.root.classList.add('hidden');
    modalStack.pop();
    syncModalAccessibility();
    var lower = modalTop();
    var nextState = lower ? lower.state : entry.returnState;
    setState(nextState);
    if (!lower && nextState === 'playing') {
      if (canvas) {
        canvas.tabIndex = -1;
        if (canvas.focus) canvas.focus({ preventScroll: true });
      }
      tryLock();
    } else if (restoreFocus !== false && entry.trigger && document.documentElement.contains(entry.trigger)) {
      setTimeout(function () {
        if (entry.trigger && !entry.trigger.inert && entry.trigger.focus) entry.trigger.focus();
      }, 0);
    }
    return true;
  }

  // 星图选线确认后把模态所有权直接交给飞行过场：不恢复触发器、
  // 不请求鼠标锁定，也不留下隐藏star-card的Tab/Escape陷阱。
  function transferModalToState(id, nextState) {
    var entry = modalTop();
    var focusWasInside = false;
    if (entry && entry.id === id) {
      focusWasInside = !!(document.activeElement && entry.root.contains(document.activeElement));
      entry.root.classList.add('hidden');
      modalStack.pop();
    }
    setState(nextState);
    exitLockForUI();
    syncModalAccessibility();
    // 被隐藏的星图按钮不能继续拥有键盘焦点；把它交给当前可见且可跳过的
    // 飞行操作。缺少该按钮时至少 blur，避免 Enter/Space 再次命中隐藏点火键。
    if (focusWasInside) {
      var flightFocus = document.getElementById('btn-warp-skip');
      if (flightFocus && !flightFocus.disabled && flightFocus.focus)
        flightFocus.focus({ preventScroll: true });
      else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
    return true;
  }

  function clearModalLayers() {
    modalStack.length = 0;
    syncModalAccessibility();
  }

  function handleModalKeydown(e) {
    var top = modalTop();
    if (!top) {
      // 飞行操作按钮是原生 interactive target，Controls 会刻意忽略其键盘事件；
      // 因此在捕获阶段兑现 aria-keyshortcuts，避免焦点位于按钮时 Esc/E 失效。
      if (!e.repeat && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (state === 'warping' && e.key === 'Escape') {
          skipFlightPresentation();
          e.preventDefault();
          e.stopPropagation();
        } else if (state === 'arriving' && (e.key === 'Escape' || e.code === 'KeyE')) {
          disembark();
          e.preventDefault();
          e.stopPropagation();
        }
      }
      return;
    }
    var inside = top.root.contains(e.target);
    // 抵达等待离舰时，E 的优先级高于任何残留 modal 的关闭语义：
    // 一旦被 closeKey 吞掉，玩家将永久困在抵达画面（无其他可见出路）。
    if (state === 'arriving' && e.code === 'KeyE' && !e.repeat) {
      disembark();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Tab') {
      var list = modalFocusables(top.root);
      if (!list.length) { e.preventDefault(); e.stopPropagation(); return; }
      var first = list[0], last = list[list.length - 1];
      if (!inside) { (e.shiftKey ? last : first).focus(); e.preventDefault(); }
      else if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      if (e.defaultPrevented) e.stopPropagation();
      return;
    }
    if (e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    var closeKey = e.key === 'Escape' || top.closeKeys.indexOf(e.code) >= 0;
    var manualKey = top.manualKey && e.code === 'KeyM';
    if (!closeKey && !manualKey) return;
    if (manualKey) openManual();
    else if (top.onEscape) top.onEscape();
    e.preventDefault();
    e.stopPropagation();
  }

  // 移动浏览器同时存在 layout viewport 与 visual viewport；渲染、CSS 和触摸
  // 必须共用当前真正可见的尺寸，避免地址栏展开后画面仍按“大视口”计算。
  function viewportSize() {
    var vv = window.visualViewport;
    var w = vv && vv.width ? vv.width : window.innerWidth;
    var h = vv && vv.height ? vv.height : window.innerHeight;
    return {
      width: Math.max(1, Math.round(w || document.documentElement.clientWidth || 1)),
      height: Math.max(1, Math.round(h || document.documentElement.clientHeight || 1))
    };
  }

  function syncViewportCss(size) {
    size = size || viewportSize();
    document.documentElement.style.setProperty('--app-width', size.width + 'px');
    document.documentElement.style.setProperty('--app-height', size.height + 'px');
    return size;
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  // quiet=true 用于自动尝试：失败时继续按浏览器可视区游玩，不打断进程。
  function requestGameFullscreen(quiet) {
    if (!(Voxel.Controls && Voxel.Controls.touchMode && Voxel.Controls.touchMode()))
      return Promise.resolve(false);
    if (fullscreenElement()) return Promise.resolve(true);
    var root = document.documentElement;
    var fn = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!fn) {
      if (!quiet && Voxel.HUD) Voxel.HUD.toast('当前浏览器不支持网页全屏，已使用自适应画面');
      return Promise.resolve(false);
    }
    try {
      return Promise.resolve(fn.call(root)).then(function () {
        setTimeout(onResize, 0);
        return true;
      }, function () {
        if (!quiet && Voxel.HUD) Voxel.HUD.toast('浏览器未允许全屏，仍可继续游戏');
        setTimeout(onResize, 0);
        return false;
      });
    } catch (e) {
      if (!quiet && Voxel.HUD) Voxel.HUD.toast('浏览器未允许全屏，仍可继续游戏');
      setTimeout(onResize, 0);
      return Promise.resolve(false);
    }
  }

  function showError(msg) {
    lastErrT = performance.now();
    var el = document.getElementById('error-banner');
    el.textContent = '错误：' + msg;
    el.style.display = 'block';
  }

  function updateErrorBanner() {
    if (lastErrT && performance.now() - lastErrT > 4000) {
      lastErrT = 0;
      document.getElementById('error-banner').style.display = 'none';
    }
  }

  // 画面自检：采样全屏 9 点
  //  1) 全黑/透明 → 画布从未成功渲染（真渲染失败）
  //  2) 相机朝下看却整屏单一颜色 → 地形网格没被 GPU 画出来（Metal 驱动问题）
  function checkBlankCanvas() {
    if (Voxel.Controls.touchMode()) return;   // 触屏禁用（GPU 回读代价高，且该诊断面向桌面驱动）
    if (state !== 'playing') return;
    var now = performance.now();
    if (now - lastBlankCheck < 3000) return;
    lastBlankCheck = now;
    try {
      var t = document.createElement('canvas');
      t.width = 1; t.height = 1;
      var tc = t.getContext('2d');
      var sigs = [];
      for (var gy = 0; gy < 3; gy++)
        for (var gx = 0; gx < 3; gx++) {
          var sx = ((canvas.width * (gx + 0.5)) / 3) | 0;
          var sy = ((canvas.height * (gy + 0.5)) / 3) | 0;
          tc.drawImage(canvas, sx, sy, 1, 1, 0, 0, 1, 1);
          var d = tc.getImageData(0, 0, 1, 1).data;
          sigs.push(d[0] + ',' + d[1] + ',' + d[2] + ',' + d[3]);
        }
      var allBlank = true, allSame = true;
      for (var i = 0; i < sigs.length; i++) {
        var p = sigs[i].split(',');
        if (!(p[0] === '0' && p[1] === '0' && p[2] === '0')) allBlank = false;
        if (sigs[i] !== sigs[0]) allSame = false;
      }
      if (allBlank) {
        showError('画面空白 — 渲染可能失败。请依次尝试：1) 刷新页面 2) 浏览器设置中关闭"硬件加速"后重启 3) 换用 Chrome 打开');
      } else if (allSame && Voxel.Controls.pitch() < -0.3) {
        showError('朝下看却看不到地形 — 网格已生成但未被 GPU 渲染。请尝试：Edge 设置→系统和性能→关闭"使用硬件加速"后重启，或换 Chrome 打开');
      }
    } catch (e) { }
  }

  function hideOverlays() {
    manualOpen = false;
    manualCraftStop();
    clearModalLayers();
    ['overlay-start', 'overlay-pause', 'overlay-dead', 'overlay-loading', 'overlay-featured', 'overlay-world-replace', 'overlay-starmap', 'overlay-discovery', 'overlay-settings', 'overlay-warp', 'rotate-hint', 'inventory', 'crafting', 'furnace', 'chest', 'manual'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    document.body.classList.remove('panel-open', 'world-replace-open');
    syncModalAccessibility();
  }

  function showOverlay(id) {
    hideOverlays();
    document.getElementById(id).classList.remove('hidden');
  }

  function tryLock() {
    var ok = Voxel.Controls.requestLock();
    if (!ok) Voxel.HUD.toast('浏览器不支持鼠标锁定（视角无法转动），建议换 Chrome/Edge');
  }

  // ---------- 世界流程 ----------

  function savedSeedLabel(sd) {
    if (!sd) return '';
    var root = sd.galaxy && sd.galaxy.rootSeed;
    if ((typeof root === 'string' && root.trim()) || (typeof root === 'number' && isFinite(root)))
      return String(root);
    var seed = sd.seed;
    if ((typeof seed === 'string' && seed.trim()) || (typeof seed === 'number' && isFinite(seed)))
      return String(seed);
    return '无法识别';
  }

  // 所有可能改变主/备份槽的操作都通过这里刷新主菜单，避免按钮与提示显示旧状态。
  function syncMainMenu(message, isError) {
    saveData = Voxel.Save.load();
    var hasRawSave = !!(Voxel.Save.hasRaw && Voxel.Save.hasRaw());
    var corruptSave = hasRawSave && !saveData;
    var hasBackup = !!(Voxel.Save.hasBackup && Voxel.Save.hasBackup());
    var startBtn = document.getElementById('btn-start');
    var restoreBtn = document.getElementById('btn-restore-backup');
    var hint = document.getElementById('start-hint');
    if (startBtn) {
      startBtn.textContent = saveData ? '继续游戏' : (corruptSave ? '存档不可载入' : '开始游戏');
      startBtn.disabled = corruptSave;
      startBtn.setAttribute('aria-disabled', corruptSave ? 'true' : 'false');
    }
    if (restoreBtn) {
      restoreBtn.classList.toggle('hidden', !hasBackup);
      restoreBtn.setAttribute('aria-hidden', hasBackup ? 'false' : 'true');
      restoreBtn.disabled = restoreBusy || !hasBackup;
    }
    if (!hint) return;
    hint.classList.toggle('is-error', !!isError || corruptSave);
    if (corruptSave) {
      hint.textContent = '检测到不可载入的存档；原始数据仍保留。可恢复上一存档，或新建世界并先归档当前数据。';
    } else if (message) {
      hint.textContent = message;
    } else if (saveData) {
      hint.textContent = '检测到星际存档 · 星系种子 ' + savedSeedLabel(saveData) +
        (hasBackup ? ' · 可恢复上一存档' : ' · 新建前会自动保留备份');
    } else if (hasBackup) {
      hint.textContent = '当前没有主存档 · 可恢复上一存档，或直接创建新世界';
    } else {
      hint.textContent = '将生成一个全新的随机世界';
    }
  }

  function setWorldReplaceBusy(busy) {
    var dialog = document.getElementById('overlay-world-replace');
    var confirmBtn = document.getElementById('btn-world-replace-confirm');
    var cancelBtn = document.getElementById('btn-world-replace-cancel');
    var semanticPanel = dialog && dialog.querySelector('[role="alertdialog"], .world-replace-panel');
    if (semanticPanel) semanticPanel.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (confirmBtn) confirmBtn.disabled = !!busy;
    if (cancelBtn) cancelBtn.disabled = !!busy;
  }

  function closeWorldReplaceDialog(restoreFocus) {
    var overlay = document.getElementById('overlay-world-replace');
    document.body.classList.remove('world-replace-open');
    setWorldReplaceBusy(false);
    worldReplacePending = null;
    worldReplaceReturnFocus = null;
    worldReplaceReturnState = null;
    if (!closeModalLayer('overlay-world-replace', restoreFocus) && overlay) overlay.classList.add('hidden');
  }

  function openWorldReplaceDialog(options) {
    var overlay = document.getElementById('overlay-world-replace');
    if (!overlay || worldReplacePending || !options || typeof options.start !== 'function') return;
    worldReplacePending = options;
    worldReplaceReturnFocus = options.trigger || document.activeElement;
    worldReplaceReturnState = state;
    var title = document.getElementById('world-replace-title');
    var message = document.getElementById('world-replace-message');
    var error = document.getElementById('world-replace-error');
    var confirmBtn = document.getElementById('btn-world-replace-confirm');
    if (title) title.textContent = options.title || '创建新世界？';
    if (message) message.textContent = options.message || '当前世界会先存入“上一存档”备份槽。';
    if (confirmBtn) confirmBtn.textContent = options.confirmLabel || '备份并创建';
    if (error) { error.textContent = ''; error.classList.add('hidden'); }
    setWorldReplaceBusy(false);
    document.body.classList.add('world-replace-open');
    openModalLayer({
      id: 'overlay-world-replace', state: 'world-replace',
      returnState: worldReplaceReturnState, trigger: worldReplaceReturnFocus,
      initialFocus: '#btn-world-replace-cancel',
      onEscape: function () {
        var cancel = document.getElementById('btn-world-replace-cancel');
        if (cancel && !cancel.disabled) closeWorldReplaceDialog(true);
      }
    });
  }

  function confirmWorldReplacement() {
    if (!worldReplacePending) return;
    var error = document.getElementById('world-replace-error');
    setWorldReplaceBusy(true);
    var archived = false;
    try {
      archived = !!(Voxel.Save.archiveCurrent && Voxel.Save.archiveCurrent());
    } catch (e) {
      archived = false;
    }
    if (!archived) {
      if (error) {
        var quarantineOccupied = !!(Voxel.Save.hasQuarantine && Voxel.Save.hasQuarantine()) &&
          !!(Voxel.Save.hasRaw && Voxel.Save.hasRaw()) && !(Voxel.Save.has && Voxel.Save.has());
        error.textContent = quarantineOccupied
          ? '安全隔离已停止：隔离槽中已有另一份损坏存档。当前原始字节和既有隔离数据均未改动；请先备份此站点的浏览器存储后再处理。'
          : '备份失败：当前存档未被清除。请检查浏览器存储空间后重试，或取消返回。';
        error.classList.remove('hidden');
      }
      setWorldReplaceBusy(false);
      var retryBtn = document.getElementById('btn-world-replace-confirm');
      if (retryBtn) retryBtn.focus();
      return;
    }

    // archiveCurrent 已验证备份并删除调用时看到的主档。此处不能再次 clear：
    // 若另一标签页恰在归档完成后写入新主档，冗余删除会把并发更新抹掉。
    var pending = worldReplacePending;
    closeWorldReplaceDialog(false);
    saveData = null;
    galaxyState = null;
    pending.start();
  }

  function restorePreviousSave() {
    if (restoreBusy || state !== 'menu') return false;
    restoreBusy = true;
    var restoreBtn = document.getElementById('btn-restore-backup');
    if (restoreBtn) restoreBtn.disabled = true;
    var restored = false;
    try {
      restored = !!(Voxel.Save.restoreBackup && Voxel.Save.restoreBackup());
    } catch (e) {
      restored = false;
    }
    if (!restored) {
      syncMainMenu('恢复失败：上一存档不可用，当前存档未变更。', true);
      finishRestoreBusy();
      return false;
    }
    var restoredData = Voxel.Save.load();
    var canSwapAgain = !!(Voxel.Save.hasBackup && Voxel.Save.hasBackup());
    syncMainMenu('已恢复上一存档' + (restoredData ? ' · 星系种子 ' + savedSeedLabel(restoredData) : '') +
      (canSwapAgain ? ' · 再次点击可切换回来' : ' · 可以继续游戏'), false);
    var startBtn = document.getElementById('btn-start');
    setTimeout(function () {
      if (state !== 'menu' || modalTop()) return;
      if (restoreBtn && !restoreBtn.classList.contains('hidden')) restoreBtn.focus();
      else if (startBtn && !startBtn.disabled) startBtn.focus();
    }, 0);
    finishRestoreBusy();
    return true;
  }

  function finishRestoreBusy() {
    if (restoreBusyTimer) clearTimeout(restoreBusyTimer);
    restoreBusyTimer = setTimeout(function () {
      restoreBusy = false;
      restoreBusyTimer = null;
      var restoreBtn = document.getElementById('btn-restore-backup');
      if (restoreBtn) restoreBtn.disabled = state !== 'menu' ||
        !(Voxel.Save.hasBackup && Voxel.Save.hasBackup());
    }, 450);
  }

  function ensureGalaxy(rootSeed, savedGalaxy) {
    if (savedGalaxy) galaxyState = Voxel.Galaxy.hydrate(savedGalaxy, rootSeed);
    // 非跃迁入口且存档没有galaxy（v4及更早）时必须重建runtime。
    // 若复用同页前一个v2 galaxy，会把legacy seed/edits塞进错误root，并让
    // 其他v2世界被整体盖成v1后换底图。新世界同样不应继承菜单前的内存状态。
    else galaxyState = Voxel.Galaxy.create(rootSeed);
    if (Voxel.Discovery && Voxel.Discovery.hydrate)
      galaxyState.discovery = Voxel.Discovery.hydrate(galaxyState.discovery, galaxyState.catalog);
    currentWorld = Voxel.Galaxy.find(galaxyState, galaxyState.currentId) || galaxyState.catalog[0];
    galaxyState.currentId = currentWorld.id;
  }

  function startWorld(s, sd, featured, destinationId) {
    requestGameFullscreen(true);
    Voxel.Sound.unlock();
    activeScan = null;
    scanCooldownT = 0;
    scanResultT = 0;
    setActiveScanUI('idle', '主动扫描待机', '按 G 或触摸“扫描”发射探索脉冲', 0);
    // 页面内跃迁要保留 Environment 的多世界暴露表；从菜单新开/读档
    // 则先清空内存，稍后只从当前存档的严格快照恢复。
    if (!destinationId && Voxel.Environment && Voxel.Environment.clear) Voxel.Environment.clear();
    if (destinationId) {
      galaxyState.currentId = destinationId;
      currentWorld = Voxel.Galaxy.find(galaxyState, destinationId);
    } else {
      ensureGalaxy((sd && sd.galaxy && sd.galaxy.rootSeed) || s || Voxel.SeedUtil.random(), sd && sd.galaxy);
      // v4 及更早的单世界存档把原世界直接作为起始行星，避免迁移后地形/编辑错位。
      if (sd && !sd.galaxy && sd.seed !== undefined) {
        var legacyStartSeed = Voxel.SeedUtil.toString(Voxel.SeedUtil.toBigInt(sd.seed));
        currentWorld.seed = legacyStartSeed;
        // 随 galaxy 一起持久化；后续每次 hydrate 都据此恢复原底图种子。
        galaxyState.legacyStartSeed = legacyStartSeed;
        // 旧单世界只保存 edits，必须继续使用 v1 自然地形；否则
        // 新版 Galaxy.create() 的 v2 默认会把原建筑套到不同底图上。
        galaxyState.terrainVersion = 1;
        for (var tv = 0; tv < galaxyState.catalog.length; tv++)
          galaxyState.catalog[tv].terrainVersion = 1;
      }
      // 精选世界：目录 planet-0 的种子是 rootSeed 派生的（signedDerived），
      // 与卡片承诺的展示种子气候场完全不同——新群系可能整图缺失。
      // 把起始行星种子钉为承诺种子（与 v4 迁移同一 legacyStartSeed 通道），
      // 保证群系构成与缩略图一致，再次载档/跃迁往返后底图也不漂移。
      if (featured && !sd) {
        var featuredSeed = Voxel.SeedUtil.toString(Voxel.SeedUtil.toBigInt(featured.seed));
        currentWorld.seed = featuredSeed;
        galaxyState.legacyStartSeed = featuredSeed;
      }
    }
    featuredPending = featured || null;
    saveData = sd || null;
    pendingEdits = saveData ? saveData.edits : null;
    Voxel.World.clearMeshes(scene);
    if (Voxel.SpaceTravel) Voxel.SpaceTravel.clear();
    Voxel.Mobs.clear();
    Voxel.Drops.clear();
    Voxel.Particles.clear();
    var reducedAtmosphere = false;
    try { reducedAtmosphere = !!window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e0) { }
    if (Voxel.DayNight && Voxel.DayNight.loadWorld) {
      Voxel.DayNight.loadWorld(currentWorld, {
        density: Voxel.Settings ? Voxel.Settings.get('particleDensity') : 1,
        reducedMotion: reducedAtmosphere
      });
    }
    if (Voxel.Weather.setWorldProfile)
      Voxel.Weather.setWorldProfile(Voxel.DayNight.profile ? Voxel.DayNight.profile() : null);
    Voxel.Weather.reset();
    if (Voxel.Weather.setSpaceMode) Voxel.Weather.setSpaceMode(currentWorld.kind === 'station');
    for (var fi = 0; fi < fallers.length; fi++) {
      if (fallers[fi].mesh) { scene.remove(fallers[fi].mesh); fallers[fi].mesh.geometry.dispose(); }
    }
    fallers.length = 0;
    waterQ.length = 0;
    Voxel.World.init(currentWorld.seed, currentWorld);
    // 载入方块元数据（熔炉/箱子内容），并重建活跃炉表
    Voxel.World.applyMeta(saveData ? saveData.meta : null);
    if (Voxel.Drops && Voxel.Drops.restore) {
      var savedDrops = saveData && Array.isArray(saveData.drops) ? saveData.drops : null;
      // 兼容只在 galaxy 世界快照中保存掉落物的中间版本。
      if (!savedDrops && saveData && saveData.galaxy && saveData.galaxy.worlds && currentWorld)
        savedDrops = saveData.galaxy.worlds[currentWorld.id] && saveData.galaxy.worlds[currentWorld.id].drops;
      Voxel.Drops.restore(savedDrops || []);
    }
    rebuildActiveFurnaces();
    setState('loading');
    if (pendingTravel) {
      // 星际旅行沿用驾驶舱显示真实 World.progress；普通 loading 面板会遮住
      // 目标同步阶段并重新请求鼠标锁定，破坏“点火→抵达”的单一焦点所有权。
      var loadingOverlay = document.getElementById('overlay-loading');
      var warpOverlay = document.getElementById('overlay-warp');
      if (loadingOverlay) loadingOverlay.classList.add('hidden');
      if (warpOverlay) warpOverlay.classList.remove('hidden');
      exitLockForUI();
    } else {
      showOverlay('overlay-loading');
      tryLock();
    }
  }

  // 在限定范围内寻找目标群系的最佳出生列（核心算法在 Voxel.Biomes.pickSpawnColumn，
  // 纯逻辑可 Node 测试）。windowed=true 只扫 20..235 主活动窗；'wide' 扫 ±520
  // 流式范围（稀有群系可能整体落在旧核心之外）。dry=true 要求胜出列是干燥陆地
  // （纯气候定群系会把整片群系沉到水位下，不校验会出生在海里）。
  function findFeaturedSpot(want, step, windowed, dry) {
    var wide = windowed === 'wide';
    return Voxel.Biomes.pickSpawnColumn({
      climateAt: Voxel.World.climateAt,
      pick: Voxel.Biomes.pick,
      biomeAt: Voxel.World.biomeAt,
      surfaceAt: Voxel.World.surfaceAt,
      predictedHeightAt: Voxel.World.predictedHeightAt
    }, want, {
      step: step,
      x0: wide ? -520 : (windowed ? 20 : 0),
      x1: wide ? 519 : (windowed ? 235 : 255),
      dry: dry === true
    });
  }

  // 精选世界：生成完成后把玩家放到目标群系。宽域兜底可能落在旧核心
  // 之外——无限外围按全局坐标确定性生成，出生与取景同样有效。
  function applyFeaturedSpawn(w) {
    var spot = null;
    var yaw = 0.75;
    var pitch = w.overview ? -0.8 : -0.15;
    // 星海嘉年华卡：直接落位到最近乐园的大门口（确定性 cellPark 门控，
    // 与 terrain 生成同一事实源），面向园门——进门即是喷泉广场。
    if (w.parkSpawn && !w.overview && Voxel.Structures && Voxel.Structures.enabled()) {
      var park = Voxel.Structures.nearestParkTo(0, 0, 4);
      var gate = park ? Voxel.Structures.parkGateSpawn(park) : null;
      if (gate) {
        spot = { x: Math.floor(gate.x), z: Math.floor(gate.z) };
        yaw = gate.yaw;
        pitch = -0.1;
      }
    }
    if (!spot) {
      if (w.overview || !w.biome || Voxel.Biomes.B[w.biome] === undefined) {
        spot = { x: 128, z: 128 };
      } else {
        var want = Voxel.Biomes.B[w.biome];
        // 海洋卡片本来就该落在水面，关闭干地校验；其余群系必须踩得到陆地。
        var dryGround = w.biome !== 'OCEAN';
        spot = findFeaturedSpot(want, 4, true, dryGround) ||
          (!Voxel.World.climateAt ? findFeaturedSpot(want, 2, false, dryGround) : null) ||
          findFeaturedSpot(want, 4, 'wide', dryGround);
      }
    }
    if (!spot) spot = { x: 128, z: 128 };
    var sy = Voxel.World.surfaceAt(spot.x, spot.z);
    pitch = w.overview ? -0.8 : pitch;
    var py = w.overview ? Math.max(sy + 1.2, 90) : sy + 1.2;
    if (!(sy > 0) && !w.overview) py = 33.2;
    var landing = new THREE.Vector3(spot.x + 0.5, py, spot.z + 0.5);
    Voxel.Player.setSpawn(landing);
    Voxel.Player.init(landing, yaw, pitch);
    if (w.overview) Voxel.Player.setFlying(true);
    Voxel.Controls.setYaw(yaw);
    Voxel.Controls.setPitch(pitch);
    Voxel.HUD.toast('已进入精选世界：' + w.name + ' · 种子 ' + w.seed);
  }

  // 合成格不保存逐格耐久，只恢复已注册的非耐久物品；旧档/损坏字段保持空格。
  function restoreCraftGrid(raw, size) {
    var out = [];
    for (var i = 0; i < size; i++) out.push(0);
    if (!Array.isArray(raw) || raw.length !== size) return out;
    for (var j = 0; j < size; j++) {
      var id = raw[j];
      if (typeof id === 'number' && isFinite(id) && Math.floor(id) === id && id > 0 &&
        Voxel.Blocks.defs[id] && !Voxel.Blocks.maxDur(id)) out[j] = id;
    }
    return out;
  }

  function enterWorld() {
    hideOverlays();
    // 成长系统数据随当前存档载入；新存档自动开启新手教程
    var freshRun = !saveData;
    if (Voxel.Progress) {
      Voxel.Progress.hydrate(saveData ? saveData.progress : null);
      if (freshRun) Voxel.Progress.beginRun();
    }
    resetProgressObserver();
    lastBlankCheck = performance.now(); // 进入后 3 秒内不做空白自检
    var commitTx = pendingTravel && pendingTravel.toId === (currentWorld && currentWorld.id) &&
      pendingTravel.sequence && pendingTravel.sequence.phase === 'target_loading' ? pendingTravel : null;
    var preserveEnvironmentAcrossTravel = !!travelStats;
    var loadedDead = false;
    if (Voxel.Player.setSpawn) Voxel.Player.setSpawn(Voxel.World.spawnPoint());
    craftGrid = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    invCraftGrid = [0, 0, 0, 0];
    if (freshRun) { gear = [0, 0]; gearDur = [null, null]; charge = { id: 0, n: 0 }; }
    if (saveData) {
      if (saveData.inv && saveData.inv.length === 36) {
        inv = saveData.inv.slice();
        // 存档带堆叠数量；旧存档无 cnt 字段则每格视为 1 个
        if (saveData.cnt && saveData.cnt.length === 36) cnt = saveData.cnt.slice();
        else { cnt = []; for (var q = 0; q < 36; q++) cnt.push(inv[q] ? 1 : 0); }
        // 工具耐久（v4+；旧存档由 syncDur 补满）
        if (saveData.dur && saveData.dur.length === 36) dur = saveData.dur.slice();
        else { dur = []; for (var q2 = 0; q2 < 36; q2++) dur.push(null); }
      }
      var loadedHeld = Number(saveData.held);
      heldItem = isFinite(loadedHeld) && Math.floor(loadedHeld) === loadedHeld && loadedHeld > 0 &&
        Voxel.Blocks.defs[loadedHeld] ? loadedHeld : 0;
      var loadedHeldCount = Number(saveData.heldCnt);
      heldCnt = heldItem
        ? Math.max(1, Math.min(stackMax(heldItem), isFinite(loadedHeldCount) ? Math.floor(loadedHeldCount) : 1))
        : 0;
      var heldMaxDur = Voxel.Blocks.maxDur(heldItem);
      heldDur = heldMaxDur
        ? ((typeof saveData.heldDur === 'number' && saveData.heldDur > 0 && saveData.heldDur <= heldMaxDur)
          ? saveData.heldDur : heldMaxDur)
        : null;
      craftGrid = restoreCraftGrid(saveData.craftGrid, 9);
      invCraftGrid = restoreCraftGrid(saveData.invCraftGrid, 4);
      restoreGear(saveData.gear);
      var savedTime = Number(saveData.time);
      Voxel.DayNight.setTime(isFinite(savedTime) ? savedTime : 0.3);
      Voxel.DayNight.update(0);
      Voxel.Weather.restore(saveData.weather);
      if (Voxel.Weather.syncVisualState) Voxel.Weather.syncVisualState();
      var savedBed = Array.isArray(saveData.bed) && saveData.bed.length === 3
        ? [Number(saveData.bed[0]), Number(saveData.bed[1]), Number(saveData.bed[2])] : null;
      if (savedBed && savedBed.every(function (v) { return isFinite(v); }))
        Voxel.Player.setBed(new THREE.Vector3(savedBed[0], savedBed[1], savedBed[2]));
      else Voxel.Player.setBed(null);
      var p = saveData.player;
      loadedDead = !!(p && typeof p.hp === 'number' && isFinite(p.hp) && p.hp <= 0);
      if (p && p.pos && p.pos.length === 3) {
        var vx = +p.pos[0], vy = +p.pos[1], vz = +p.pos[2];
        var vyaw = +p.yaw, vpitch = +p.pitch;
        var savedAboard = p.aboard === true && currentWorld && currentWorld.kind === 'planet';
        var savedStand = new THREE.Vector3(vx, vy, vz);
        // legacy core 之外的存档位置：外围区块此刻尚未流式生成，World.get 的
        // "未加载=实心"语义会让 canStandAt 必然判负并把玩家错误送回核心出生点。
        // 外围坐标确定性可再生，直接信任存档（加载后由物理自然落地对齐）。
        var savedOutland = !savedAboard && currentWorld && currentWorld.kind === 'planet' &&
          (vx < 0 || vz < 0 || vx > 255 || vz > 255);
        if (!isFinite(vx) || !isFinite(vy) || !isFinite(vz) || vy < 2 ||
          (savedAboard && (Math.abs(vx) > 30000000 || vy > 252 || Math.abs(vz) > 30000000)) ||
          (!savedAboard && !savedOutland &&
            Voxel.Player.canStandAt && !Voxel.Player.canStandAt(savedStand, true))) {
          Voxel.Player.initAtSpawn();
        } else {
          if (!isFinite(vyaw)) vyaw = 0;
          if (!isFinite(vpitch)) vpitch = 0;
          Voxel.Player.init(savedStand, vyaw, vpitch);
          Voxel.Player.setFlying(!!p.fly);
        }
        Voxel.Player.setHp(typeof p.hp === 'number' && isFinite(p.hp) ? p.hp : C.HP);
        if (typeof p.food === 'number' && isFinite(p.food)) Voxel.Player.setFood(p.food);
      } else Voxel.Player.initAtSpawn();
      // 死亡画面无法跨页面恢复；重载死亡存档时按床/当前世界出生点安全重生。
      if (loadedDead) Voxel.Player.respawn();
      if (travelStats) {
        Voxel.Player.setHp(travelStats.hp);
        Voxel.Player.setFood(travelStats.food);
        travelStats = null;
      }
      if (!commitTx) Voxel.HUD.toast('已抵达 ' + currentWorld.name + ' · ' + currentWorld.typeName);
    } else {
      // 新世界：背包/手持/合成格/选中格/床重生点全部清空
      Voxel.DayNight.setTime(0.3);
      Voxel.DayNight.update(0);
      Voxel.Weather.reset();
      inv = []; cnt = [];
      for (var i1 = 0; i1 < 36; i1++) { inv.push(0); cnt.push(0); }
      dur = [];
      for (var i1d = 0; i1d < 36; i1d++) dur.push(null);
      craftGrid = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      invCraftGrid = [0, 0, 0, 0];
      heldItem = 0; heldCnt = 0; heldDur = null; sel = 0;
      Voxel.Player.initAtSpawn();
      Voxel.Player.setBed(null);
      // 新世界：显式重置视角（否则沿用上次残留的偏航/俯仰，可能正朝天看）
      Voxel.Controls.setYaw(0);
      Voxel.Controls.setPitch(-0.1);
      if (featuredPending) applyFeaturedSpawn(featuredPending);
      else Voxel.HUD.toast('已登陆 ' + currentWorld.name + ' · 星系种子 ' + galaxyState.rootSeed);
    }
    // 防止存档视角几乎垂直（看天/看地）导致进游戏看不见地形
    var _pitch = Voxel.Controls.pitch();
    if (Math.abs(_pitch) > 0.9) {
      Voxel.Controls.setPitch(-0.2);
      Voxel.HUD.toast('视角已复位（原视角几乎垂直朝上/下）');
    }
    if (Voxel.Environment && Voxel.Environment.loadWorld) {
      var savedEnvironment = preserveEnvironmentAcrossTravel ? undefined :
        (saveData && saveData.player ? saveData.player.environment : null);
      var loadedEnvironment = Voxel.Environment.loadWorld(currentWorld, savedEnvironment,
        preserveEnvironmentAcrossTravel ? { grantGrace: 'new' } : undefined);
      if (loadedDead && Voxel.Environment.onRespawn)
        loadedEnvironment = Voxel.Environment.onRespawn();
      syncEnvironmentHUD(loadedEnvironment, true);
    }
    refreshInv();
    Voxel.HUD.drawHeld(heldItem);
    Voxel.HUD.setSelected(sel);
    Voxel.HUD.drawHealth(Voxel.Player.hp());
    lastHp = Voxel.Player.hp();
    autosaveT = 0;
    galaxyState.discovered[currentWorld.id] = true;
    if (currentWorld.kind === 'station') {
      galaxyState.ship.fuel = galaxyState.ship.maxFuel;
      if (!commitTx) Voxel.HUD.toast('空间站对接完成 · 跃迁能量已补满');
    }
    if (Voxel.SpaceTravel && (!Voxel.SpaceTravel.currentWorld ||
      Voxel.SpaceTravel.currentWorld() !== currentWorld))
      Voxel.SpaceTravel.loadWorld(currentWorld, galaxyState,
        saveData && Object.prototype.hasOwnProperty.call(saveData, 'shipFlight') ? saveData.shipFlight : undefined);
    if (Voxel.SpaceTravel && Voxel.SpaceTravel.syncPortalOccupancy)
      Voxel.SpaceTravel.syncPortalOccupancy();
    if (Voxel.SpaceTravel) Voxel.SpaceTravel.hideWarp();
    if (Voxel.DayNight.updateCamera && camera) Voxel.DayNight.updateCamera(camera.position);
    refreshDiscoveryUI();
    setActiveScanUI('idle', '主动扫描就绪', '按 G 或触摸“扫描”发射探索脉冲', 0);
    if (commitTx) {
      setState('arriving');
      acceptFlightEvent(commitTx, 'target_ready');
      acceptFlightEvent(commitTx, 'begin_commit');
      // 目标世界必须先写入并回读成功，才能对玩家宣布抵达/允许下舰。
      if (!doSave(true, 'travel-arrival')) {
        abortTravel(commitTx, '目标停泊存档提交失败');
        return;
      }
      commitTx.committed = true;
      acceptFlightEvent(commitTx, 'commit_succeeded');
      var arrivalShown = false;
      if (Voxel.SpaceTravel && Voxel.SpaceTravel.showArrival)
        arrivalShown = Voxel.SpaceTravel.showArrival(commitTx.from, currentWorld,
          // 跨系跳跃沿用 ship 抵达表现：hideWarp 之后必须重新拉起带「下船」
          // 按钮的抵达层，否则玩家面对纯星空没有任何可见出路。
          commitTx.mode === 'jump' ? 'ship' : commitTx.mode, {
          firstVisit: commitTx.mode === 'jump'
            ? !!commitTx.jumpFirstVisit
            : !(commitTx.sourceSave.galaxy.discovered &&
              commitTx.sourceSave.galaxy.discovered[currentWorld.id]),
          refueled: currentWorld.kind === 'station'
        });
      if (!arrivalShown && Voxel.SpaceTravel && Voxel.SpaceTravel.announceTravel)
        Voxel.SpaceTravel.announceTravel('已抵达 ' + currentWorld.name + '，' + currentWorld.typeName + '。');
      if (Voxel.Sound && Voxel.Sound.warpPhase) Voxel.Sound.warpPhase(commitTx.mode, 'arrival');
      acceptFlightEvent(commitTx, 'begin_arrival');
      syncFlightVisual(commitTx);
      return;
    }
    var requestedAboardResume = !!(saveData && saveData.player && saveData.player.aboard === true &&
      currentWorld && currentWorld.kind === 'planet');
    var resumeAboard = !!(requestedAboardResume &&
      currentWorld && currentWorld.kind === 'planet' && Voxel.SpaceTravel &&
      Voxel.SpaceTravel.restoreBoarding && Voxel.SpaceTravel.restoreBoarding());
    if (resumeAboard) {
      Voxel.Controls.setYaw(0);
      Voxel.Controls.setPitch(0);
      if (Voxel.Player.setFlying) Voxel.Player.setFlying(false);
      if (Voxel.HandItem && Voxel.HandItem.setVisible) Voxel.HandItem.setVisible(false);
      setState('cockpit');
      if (Voxel.SpaceTravel.applyCockpitCamera) Voxel.SpaceTravel.applyCockpitCamera(camera);
      if (Voxel.SpaceTravel.syncCockpit) Voxel.SpaceTravel.syncCockpit(true);
      tryLock();
      Voxel.HUD.toast('已恢复飞船座舱与飞行姿态');
    } else {
      if (requestedAboardResume) {
        var fallbackHp = saveData.player && isFinite(saveData.player.hp) ? saveData.player.hp : C.HP;
        var fallbackFood = saveData.player && isFinite(saveData.player.food) ? saveData.player.food : C.FOOD_MAX;
        Voxel.Player.initAtSpawn();
        Voxel.Player.setHp(fallbackHp);
        Voxel.Player.setFood(fallbackFood);
        Voxel.HUD.toast('飞船姿态损坏 · 已安全回退到地表出生点');
      }
      setState('playing');
    }
    // 新世界/普通读档的首次提交；跃迁使用上方的强制verified commit。
    // 失败恢复必须让已验证的来源存档保持逐字节权威；重新载入来源时若立刻
    // 自动保存，会因昼夜时钟的细微规范化改写原始字节，削弱事务回滚保证。
    if (!travelRecoveryNotice) doSave(true, 'world-load');
    if (travelRecoveryNotice) {
      // abortTravel 仅在磁盘仍是已验证 sourceSave 时设置此标志；完整重建来源
      // 世界后，健康状态应反映“已安全回滚”，而不是继续误报目标未保存。
      if (travelRollbackHealthPending && !saveConflict) reportSaveResult(true, 'travel-rollback');
      travelRollbackHealthPending = false;
      Voxel.HUD.toast(travelRecoveryNotice);
      travelRecoveryNotice = '';
    } else if (!resumeAboard && Voxel.SpaceTravel && Voxel.SpaceTravel.showArrivalCard) {
      Voxel.SpaceTravel.showArrivalCard(null, currentWorld, saveData ? 'resume' : 'landing',
        { firstVisit: !saveData, silent: true });
    }
  }

  function captureCurrentSnapshot() {
    if (!galaxyState || !currentWorld || !Voxel.World.isReady())
      throw new Error('世界尚未就绪');
    var p = Voxel.Player.pos();
    var bed = Voxel.Player.getBed();
    var time = Voxel.DayNight.time();
    var weather = Voxel.Weather.stateName();
    var yaw = Voxel.Controls.yaw();
    var pitch = Voxel.Controls.pitch();
    var flying = Voxel.Player.flying();
    var hp = Voxel.Player.hp();
    var food = Voxel.Player.food();
    var environment = Voxel.Environment && Voxel.Environment.snapshot
      ? Voxel.Environment.snapshot() : null;
    var shipFlight = Voxel.SpaceTravel && Voxel.SpaceTravel.flightSnapshot
      ? Voxel.SpaceTravel.flightSnapshot() : null;
    var drops = Voxel.Drops && Voxel.Drops.snapshot ? Voxel.Drops.snapshot() : [];
    var meta = Voxel.World.getAllMeta();
    var edits = Voxel.World.getEdits();
    if (!p || !isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z) ||
      !isFinite(time) || !isFinite(yaw) || !isFinite(pitch) || !isFinite(hp) || !isFinite(food) ||
      !Array.isArray(drops) || !meta || typeof meta !== 'object' || Array.isArray(meta) ||
      !edits || typeof edits !== 'object' || Array.isArray(edits))
      throw new Error('存档子快照无效');
    if (bed && (!isFinite(bed.x) || !isFinite(bed.y) || !isFinite(bed.z)))
      throw new Error('床位快照无效');
    return {
      edits: edits,
      meta: meta,
      time: time,
      weather: weather,
      player: {
        pos: [p.x, p.y, p.z], yaw: yaw, pitch: pitch,
        fly: flying, hp: hp, food: food, environment: environment,
        aboard: !!(Voxel.SpaceTravel && Voxel.SpaceTravel.isAboard && Voxel.SpaceTravel.isAboard())
      },
      shipFlight: shipFlight,
      bed: bed ? [bed.x, bed.y, bed.z] : null,
      drops: drops
    };
  }

  function saveSourceLabel(source) {
    return {
      auto: '自动存档', manual: '手动存档', menu: '返回主菜单前存档',
      lifecycle: '页面离开前存档', pause: '暂停时存档', sleep: '睡眠完成存档',
      bed: '重生点存档', death: '死亡状态存档', respawn: '重生状态存档',
      discovery: '探索档案存档', 'travel-departure': '出发存档',
      'travel-arrival': '抵达存档', 'world-load': '世界载入存档', test: '立即存档',
      'external-conflict': '其他页面已更新存档', 'travel-rollback': '已回滚至验证来源'
    }[source] || '游戏存档';
  }

  function setTextIfChanged(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  function setAttributeIfChanged(el, name, value) {
    if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function failureAnnouncementText(source) {
    return source === 'external-conflict'
      ? '存档冲突。其他页面已更新存档，自动写入已暂停。请打开暂停菜单并手动确认存档。'
      : '存档失败。当前进度尚未安全写入，请立即重试。';
  }

  function emitFailureAnnouncement(source) {
    setTextIfChanged(document.getElementById('save-failure-announcer'), failureAnnouncementText(source));
    pendingFailureAnnouncement = false;
    saveHealth.assertiveAnnouncements++;
  }

  function flushPendingFailureAnnouncement() {
    if (!pendingFailureAnnouncement || saveHealth.state !== 'unsaved') return false;
    var pauseOverlay = document.getElementById('overlay-pause');
    if (saveHealth.source === 'external-conflict' && state === 'paused' && pauseOverlay &&
      !pauseOverlay.classList.contains('hidden')) {
      announcePauseSaveFeedback('存档冲突：其他页面已更新主档。自动写入已暂停，请手动确认覆盖。', true);
      pendingFailureAnnouncement = false;
      saveHealth.assertiveAnnouncements++;
    } else emitFailureAnnouncement(saveHealth.source);
    return true;
  }

  function announcePauseSaveFeedback(message, urgent) {
    var feedback = document.getElementById('pause-save-feedback');
    if (!feedback) return;
    setAttributeIfChanged(feedback, 'role', urgent ? 'alert' : 'status');
    setAttributeIfChanged(feedback, 'aria-live', urgent ? 'assertive' : 'polite');
    pauseSaveFeedbackSerial++;
    setTextIfChanged(feedback, '存档操作 ' + pauseSaveFeedbackSerial + '：' + message);
  }

  function syncSaveHealthUI() {
    var failed = saveHealth.state === 'unsaved';
    var recovered = saveHealth.state === 'recovered';
    var conflict = failed && saveHealth.source === 'external-conflict';
    var label = saveSourceLabel(saveHealth.source);
    setAttributeIfChanged(document.body, 'data-save-health', saveHealth.state);

    var banner = document.getElementById('save-health');
    if (banner) {
      setAttributeIfChanged(banner, 'data-state', saveHealth.state);
      var hideBanner = !failed && !recovered;
      if (banner.hidden !== hideBanner) banner.hidden = hideBanner;
      setTextIfChanged(banner, failed
        ? (conflict ? '存档冲突 · 其他页面已更新存档，自动写入已暂停'
          : '存档失败 · ' + label + '未写入，当前进度仍在内存中')
        : (recovered ? '存档已恢复 · 最新进度已通过写入校验' : ''));
    }

    var pauseStatus = document.getElementById('pause-save-status');
    if (pauseStatus) {
      setAttributeIfChanged(pauseStatus, 'data-state', saveHealth.state);
      // 摘要由 dialog 的 aria-describedby 提供静态语义；显式操作只经下方
      // pause-save-feedback 单一 polite 通道播报，避免一次点击双重朗读。
      setAttributeIfChanged(pauseStatus, 'aria-live', 'off');
      var title = pauseStatus.querySelector('strong');
      var detail = pauseStatus.querySelector('span');
      setTextIfChanged(title, failed ? (conflict ? '存档冲突 · 其他页面已更新' : '未保存 · ' + label + '失败')
        : (recovered ? '存档已恢复' : (saveHealth.state === 'saved' ? '存档安全' : '存档待验证')));
      setTextIfChanged(detail, failed
        ? (conflict
          ? '为避免覆盖另一页面，自动、旅行和返回菜单存档已暂停。请手动确认覆盖并存档。'
          : '当前进度仍保留在内存中。请立即重试；验证成功前不会返回主菜单。')
        : (recovered ? '最近一次重试已完成写入与回读校验。'
          : (saveHealth.state === 'saved' ? '最近一次写入与回读校验均已完成。' : saveHealth.message)));
    }

    var saveBtn = document.getElementById('btn-save');
    if (saveBtn) {
      setTextIfChanged(saveBtn, conflict ? '确认覆盖并存档' : (failed ? '重试存档' : '立即存档'));
      setAttributeIfChanged(saveBtn, 'data-retry', failed ? 'true' : 'false');
    }
  }

  function reportSaveResult(ok, source) {
    source = source || 'game';
    var wasFailed = saveHealth.state === 'unsaved';
    var nextFailureClass = source === 'external-conflict' ? 'external-conflict' : 'write';
    var failureClassChanged = saveHealth.failureClass !== nextFailureClass;
    saveHealth.source = source;
    if (!ok) {
      saveHealth.state = 'unsaved';
      saveHealth.failureClass = nextFailureClass;
      saveHealth.consecutiveFailures++;
      saveHealth.totalFailures++;
      saveHealth.message = saveSourceLabel(source) + '写入或回读校验失败。';
      // 同类连续故障只触发一次 assertive；外部覆盖冲突是新的处置类别，必须
      // 另播一次“确认覆盖”，但 auto/lifecycle 之间切换不会反复打断用户。
      if (!wasFailed || failureClassChanged) {
        var panelInitiated = (source === 'manual' || source === 'menu') && state === 'paused';
        var pauseOverlay = document.getElementById('overlay-pause');
        var conflictInPause = source === 'external-conflict' && state === 'paused' && pauseOverlay &&
          !pauseOverlay.classList.contains('hidden');
        if (document.visibilityState === 'hidden') {
          if (!panelInitiated) pendingFailureAnnouncement = true;
        } else if (conflictInPause) {
          announcePauseSaveFeedback('存档冲突：其他页面已更新主档。自动写入已暂停，请手动确认覆盖。', true);
          saveHealth.assertiveAnnouncements++;
        } else if (!panelInitiated) {
          emitFailureAnnouncement(source);
        }
      }
      var recoveryAnnouncer = document.getElementById('save-recovery-announcer');
      setTextIfChanged(recoveryAnnouncer, '');
      syncSaveHealthUI();
      return false;
    }

    saveHealth.state = wasFailed ? 'recovered' : 'saved';
    saveHealth.failureClass = 'none';
    pendingFailureAnnouncement = false;
    saveHealth.consecutiveFailures = 0;
    saveHealth.message = wasFailed
      ? '最近一次重试已完成写入与回读校验。'
      : '最近一次写入与回读校验均已完成。';
    var failedLive = document.getElementById('save-failure-announcer');
    setTextIfChanged(failedLive, '');
    var recoveredLive = document.getElementById('save-recovery-announcer');
    var pauseOverlay = document.getElementById('overlay-pause');
    var pauseWillAnnounce = state === 'paused' && pauseOverlay &&
      !pauseOverlay.classList.contains('hidden');
    setTextIfChanged(recoveredLive, wasFailed && !pauseWillAnnounce
      ? '存档已恢复，最新进度已安全写入。' : '');
    syncSaveHealthUI();
    return true;
  }

  function saveHealthSnapshot() {
    return {
      state: saveHealth.state,
      source: saveHealth.source,
      message: saveHealth.message,
      failureClass: saveHealth.failureClass,
      consecutiveFailures: saveHealth.consecutiveFailures,
      totalFailures: saveHealth.totalFailures,
      assertiveAnnouncements: saveHealth.assertiveAnnouncements,
      conflict: saveConflict,
      pendingAnnouncement: pendingFailureAnnouncement
    };
  }

  function finishSaveAttempt(ok, silent, source) {
    if (ok && saveConflict && source === 'manual') saveConflict = false;
    reportSaveResult(ok, !ok && saveConflict ? 'external-conflict' : source);
    if (!silent) Voxel.HUD.toast(ok
      ? '游戏已存档 · 写入校验完成'
      : '存档失败 · 当前进度仍在内存中，请立即重试');
    if (source === 'manual') announcePauseSaveFeedback(ok
      ? '已完成写入与回读校验。'
      : '仍未写入，请检查浏览器存储空间后再次重试。');
    return !!ok;
  }

  function doSave(silent, source) {
    source = source || (silent ? 'game' : 'manual');
    var manualSaveable = state === 'manual' &&
      ['playing', 'cockpit', 'paused', 'inventory', 'crafting', 'furnace', 'chest', 'dead'].indexOf(manualReturnState) >= 0;
    if (state !== 'playing' && state !== 'cockpit' && state !== 'paused' && state !== 'inventory' && state !== 'crafting' &&
      state !== 'furnace' && state !== 'chest' && state !== 'starmap' && state !== 'discovery' &&
      state !== 'arriving' && state !== 'sleeping' &&
      !manualSaveable && state !== 'dead') return false;
    // 外部标签页已改变主档时，任何后台/流程性写入都会造成静默覆盖。只有暂停
    // 面板中的显式手动操作可以解除冲突，并且仍必须通过底层写入回读校验。
    if (saveConflict && source !== 'manual') return false;
    var snapshot;
    try {
      snapshot = captureCurrentSnapshot();
    } catch (snapshotError) {
      console.warn('存档快照失败', snapshotError);
      return finishSaveAttempt(false, silent, source);
    }
    // 同一个不可分快照同时成为当前世界槽与顶层兼容字段；Save.save 不得再向
    // World/Drops/Environment 二次取样，否则一次 JSON 会混入不同逻辑时刻。
    galaxyState.worlds[currentWorld.id] = snapshot;
    var ok = false;
    try {
      ok = Voxel.Save.save(Voxel.World, {
        time: snapshot.time,
        weather: snapshot.weather,
        player: snapshot.player,
        shipFlight: snapshot.shipFlight,
        inv: inv,
        cnt: cnt,
        gear: gearSnapshot(),
        held: heldItem,
        heldCnt: heldCnt,
        heldDur: heldDur,
        craftGrid: craftGrid,
        invCraftGrid: invCraftGrid,
        bed: snapshot.bed,
        dur: dur,
        drops: snapshot.drops,
        meta: snapshot.meta,
        edits: snapshot.edits,
        galaxy: galaxyState,
        progress: Voxel.Progress ? Voxel.Progress.snapshot() : null
      });
    } catch (writeError) {
      console.warn('存档写入失败', writeError);
      ok = false;
    }
    return finishSaveAttempt(!!ok, silent, source);
  }

  function markExternalSaveConflict() {
    // 来源重建尚未完成时出现外部主档变化，旧 sourceSave 不再代表磁盘权威。
    travelRollbackHealthPending = false;
    saveConflict = true;
    reportSaveResult(false, 'external-conflict');
  }

  var lifecycleSaveBusy = false;
  function saveForLifecycle() {
    if (lifecycleSaveBusy) return false;
    lifecycleSaveBusy = true;
    try { return doSave(true, 'lifecycle'); }
    finally { lifecycleSaveBusy = false; }
  }

  function runAutosave() {
    // 自动保存不占用 polite toast 通道；首次失败由唯一 assertive 区域播报，
    // 连续失败保持 DOM 静默，成功状态可在暂停面板中核验。
    return doSave(true, 'auto');
  }

  // ---------- 背包堆叠辅助 ----------
  // inv[i]=物品ID，cnt[i]=数量（cnt=0 即空格）；dur[i]=工具耐久

  // 耐久归一化：非工具清空；新获得的工具补满耐久。在每次背包刷新前调用。
  function syncDur() {
    for (var i = 0; i < 36; i++) {
      var md = Voxel.Blocks.maxDur(inv[i]);
      if (!md) { dur[i] = null; continue; }
      var d = Number(dur[i]);
      dur[i] = isFinite(d) && d > 0 ? Math.max(1, Math.min(md, Math.floor(d))) : md;
    }
  }

  // 统一背包刷新入口（替代直接调 HUD.setInv）
  function refreshInv() {
    syncDur();
    Voxel.HUD.setInv(inv, cnt, dur);
    refreshGear();
  }

  // 装备耐久归一化（与 syncDur 同规则）
  function syncGearDur() {
    for (var i = 0; i < 2; i++) {
      if (!gear[i]) { gearDur[i] = null; continue; }
      var md = Voxel.Blocks.maxDur(gear[i]);
      if (!md) { gearDur[i] = null; continue; }
      var d = Number(gearDur[i]);
      gearDur[i] = isFinite(d) && d > 0 ? Math.max(1, Math.min(md, Math.floor(d))) : md;
    }
  }

  // 装备栏 HUD 刷新（三格：头部/身体/充能）
  function refreshGear() {
    syncGearDur();
    if (Voxel.HUD.setGear) Voxel.HUD.setGear(gear[0], gearDur[0], gear[1], gearDur[1], charge.id, charge.n);
  }

  // 装备/充能槽存档快照与恢复（v6 可选字段，旧档缺失时回落为空装备）
  function gearSnapshot() {
    return {
      head: gear[0] ? { id: gear[0], dur: gearDur[0] } : null,
      body: gear[1] ? { id: gear[1], dur: gearDur[1] } : null,
      charge: charge.id ? { id: charge.id, n: charge.n } : null
    };
  }

  function restoreGear(g) {
    gear = [0, 0]; gearDur = [null, null]; charge = { id: 0, n: 0 };
    if (!g || typeof g !== 'object') return;
    if (Number(g.head && g.head.id) === GEAR_HEAD_ID) {
      gear[0] = GEAR_HEAD_ID;
      var hd = Number(g.head.dur);
      gearDur[0] = isFinite(hd) && hd > 0 ? hd : Voxel.Blocks.maxDur(GEAR_HEAD_ID);
    }
    if (Number(g.body && g.body.id) === GEAR_BODY_ID) {
      gear[1] = GEAR_BODY_ID;
      var bd = Number(g.body.dur);
      gearDur[1] = isFinite(bd) && bd > 0 ? bd : Voxel.Blocks.maxDur(GEAR_BODY_ID);
    }
    var chId = Number(g.charge && g.charge.id);
    if (chId === CHARCOAL_ID || chId === COAL_ID) {
      var chN = Math.floor(Number(g.charge.n));
      if (isFinite(chN) && chN > 0) { charge.id = chId; charge.n = Math.min(MAX_STACK, chN); }
    }
  }

  // 手持工具损耗 n 点；归零则损坏消失
  function damageHeldTool(n) {
    var id = inv[sel];
    var md = Voxel.Blocks.maxDur(id);
    if (!md) return;
    if (dur[sel] === undefined || dur[sel] === null) dur[sel] = md;
    dur[sel] -= n;
    if (dur[sel] <= 0) {
      inv[sel] = 0; cnt[sel] = 0; dur[sel] = null;
      Voxel.Sound.pop();
      Voxel.HUD.toast(Voxel.Blocks.name(id) + ' 坏了！');
      var bp = Voxel.Player.pos().clone();
      bp.y += 1.2;
      Voxel.Particles.burst(bp, 0x9a764a, 8);
    }
    refreshInv();
  }

  function invTotal(id) {
    var n = 0;
    for (var i = 0; i < 36; i++) if (inv[i] === id) n += cnt[i];
    return n;
  }

  function freeFor(id) {
    var sm = stackMax(id);
    var room = 0;
    for (var i = 0; i < 36; i++) {
      if (!inv[i]) { room += sm; continue; }
      if (inv[i] === id) room += sm - cnt[i];
    }
    return room;
  }

  function canAddInv(id, n) { return freeFor(id) >= (n || 1); }

  // 加入 n 个，返回实际加入数（优先并入已有堆叠，快捷栏优先）
  function addInv(id, n) {
    n = n || 1;
    var sm = stackMax(id);
    var added = 0;
    for (var pass = 0; pass < 2 && added < n; pass++) {
      for (var i = 0; i < 36 && added < n; i++) {
        if (pass === 0 && (inv[i] !== id || !cnt[i] || cnt[i] >= sm)) continue;
        if (pass === 1 && inv[i]) continue;
        var base = (pass === 1) ? 0 : cnt[i];
        var take = Math.min(n - added, sm - base);
        if (take <= 0) continue;
        inv[i] = id;
        cnt[i] = base + take;
        added += take;
      }
    }
    if (added > 0) {
      refreshInv();
      // 首次获得记录（图鉴/成就数据源）——覆盖挖掘、拾取、容器与合成产出
      if (Voxel.Progress) Voxel.Progress.track('gain', { id: id });
    }
    return added;
  }

  // 曲速电池是飞船资源而不是普通随身耗材：任一合成入口产出后立即装填，
  // 使配方结果与 Galaxy.jumpPlan 读取的 ship.warpCells 保持同一权威状态。
  function canAcceptCraftResult(id, n) {
    if (id !== WARP_CELL_ITEM_ID) return canAddInv(id, n);
    if (!galaxyState || !galaxyState.ship) return false;
    var current = Number(galaxyState.ship.warpCells);
    if (!isFinite(current)) current = 0;
    return Math.max(0, Math.floor(current)) + Math.max(1, Math.floor(n || 1)) <= MAX_WARP_CELLS;
  }

  function acceptCraftResult(id, n) {
    n = Math.max(1, Math.floor(n || 1));
    if (id !== WARP_CELL_ITEM_ID) {
      var added = addInv(id, n);
      if (added > 0 && Voxel.Progress) Voxel.Progress.track('craft', { id: id, n: added });
      return added;
    }
    if (!canAcceptCraftResult(id, n)) return 0;
    var current = Number(galaxyState.ship.warpCells);
    galaxyState.ship.warpCells = Math.max(0, Math.floor(isFinite(current) ? current : 0)) + n;
    if (Voxel.SpaceTravel && Voxel.SpaceTravel.syncCockpit) Voxel.SpaceTravel.syncCockpit(true);
    if (Voxel.Progress) Voxel.Progress.track('craft', { id: id, n: n });
    return n;
  }

  function announceCraftResult(id, n) {
    if (id === WARP_CELL_ITEM_ID) {
      Voxel.HUD.toast('合成曲速电池' + (n > 1 ? ' ×' + n : '') + ' · 已自动装填飞船');
      return;
    }
    Voxel.HUD.toast('合成 ' + Voxel.Blocks.name(id) + (n > 1 ? ' ×' + n : ''));
  }

  function decSel() {
    cnt[sel]--;
    if (cnt[sel] <= 0) { cnt[sel] = 0; inv[sel] = 0; }
    refreshInv();
  }

  // 单物品最大堆叠数（工具类为 1，见耐久系统）
  function stackMax(id) {
    var d = Voxel.Blocks.defs[id];
    return (d && d.maxStack) || MAX_STACK;
  }

  // Shift+点击：快捷栏(0-8) ↔ 背包(9-35) 整堆快搬（先并入同类堆，再放空格）
  function quickMoveInv(i) {
    var id = inv[i];
    if (!id) return false;
    var n = cnt[i];
    var sourceDur = dur[i];
    var lo = i < 9 ? 9 : 0, hi = i < 9 ? 36 : 9;
    var sm = stackMax(id), moved = 0;
    for (var j = lo; j < hi && moved < n; j++) {
      if (inv[j] === id && cnt[j] > 0 && cnt[j] < sm) {
        var take = Math.min(sm - cnt[j], n - moved);
        cnt[j] += take;
        moved += take;
      }
    }
    for (var j2 = lo; j2 < hi && moved < n; j2++) {
      if (!inv[j2]) {
        var put = Math.min(sm, n - moved);
        inv[j2] = id; cnt[j2] = put;
        dur[j2] = Voxel.Blocks.maxDur(id) ? sourceDur : null;
        moved += put;
      }
    }
    if (moved <= 0) return false;
    cnt[i] -= moved;
    if (cnt[i] <= 0) { inv[i] = 0; cnt[i] = 0; dur[i] = null; }
    Voxel.Sound.select();
    return true;
  }

  // ---------- 掉落物实体（Q 丢弃） ----------

  // 把当前快捷栏格的 1 个物品朝视线方向丢出（工具保留剩余耐久）
  function throwSelected() {
    var id = inv[sel];
    if (!id) return;
    var eye = Voxel.Player.eyePos();
    var d = Voxel.Player.lookDir();
    var vel = new THREE.Vector3(d.x * 7, d.y * 7 + 2.5, d.z * 7);
    if (!Voxel.Drops.spawn(id, 1, eye, vel, dur[sel])) {
      Voxel.HUD.toast('暂时无法丢弃物品，请稍后重试');
      return false;
    }
    decSel();
    Voxel.Sound.select();
    return true;
  }

  // 掉落物磁吸拾取回调（Drops 实体调用），返回实际拾取数
  function pickupDrop(id, n, d) {
    var got = addToInvWithDur(id, n, d);
    if (got > 0) Voxel.Sound.pop();
    return got;
  }

  // 入包并尽量保留工具耐久（工具不可堆叠，占独立空格）
  function addToInvWithDur(id, n, d) {
    var md = Voxel.Blocks.maxDur(id);
    if (!md) return addInv(id, n);
    n = Math.max(0, Math.floor(Number(n) || 0));
    var added = 0;
    for (var i = 0; i < 36 && added < n; i++) {
      if (inv[i]) continue;
      inv[i] = id; cnt[i] = 1;
      dur[i] = (typeof d === 'number' && d > 0 && d <= md) ? d : md;
      added++;
    }
    if (added > 0) {
      refreshInv();
      if (Voxel.Progress) Voxel.Progress.track('gain', { id: id });
    }
    return added;
  }

  // 将背包装不下的余量实体化；统一保留数量、真实位置与工具耐久。
  function spawnRemainder(id, n, pos, d) {
    if (!id || !(n > 0) || !Voxel.Drops || !Voxel.Drops.spawn) return null;
    var origin = pos && typeof pos.clone === 'function' ? pos.clone() : null;
    if (!origin && Voxel.Player && Voxel.Player.pos) {
      origin = Voxel.Player.pos().clone();
      origin.y += 0.25;
    }
    if (!origin) return null;
    var vel = new THREE.Vector3((Math.random() - 0.5) * 2, 2.2, (Math.random() - 0.5) * 2);
    return Voxel.Drops.spawn(id, n, origin, vel, d);
  }

  // 把手持物安全退回背包（关闭面板时）
  function stowHeld() {
    if (!heldItem) return;
    var got = addToInvWithDur(heldItem, heldCnt, heldDur);
    var remaining = heldCnt - got;
    if (remaining > 0) {
      var feet = Voxel.Player.pos().clone();
      feet.y += 0.25;
      if (!spawnRemainder(heldItem, remaining, feet, heldDur)) {
        // 极端情况下掉落实体系统尚未初始化：余量继续留在手上，绝不静默清空。
        heldCnt = remaining;
        Voxel.HUD.toast('背包空间不足，余下物品仍保留在手中');
        return false;
      }
      Voxel.HUD.toast('背包空间不足，余下 ' + remaining + ' 件物品已掉落在脚边');
    }
    heldItem = 0; heldCnt = 0; heldDur = null;
    return true;
  }

  // ---------- 触控瞄准（MCPE 手势流）：射线来自屏幕触点或准星 ----------

  var touchAim = null;   // {nx,ny} 0~1 屏幕归一化坐标；null=准星

  function setTouchAim(nx, ny) {
    touchAim = nx === null ? null : { nx: nx, ny: ny };
  }

  function aimDir() {
    if (touchAim && camera) {
      var v = new THREE.Vector3(touchAim.nx * 2 - 1, -(touchAim.ny * 2 - 1), 0.5);
      v.unproject(camera);
      v.sub(camera.position).normalize();
      return v;
    }
    return Voxel.Player.lookDir();
  }

  // 对功能方块执行 E 类交互；命中返回 true
  function interactWith(hit) {
    if (!hit || hit.type !== 'block') return false;
    if (hit.id === 15) {
      openCrafting();
      if (Voxel.Progress) Voxel.Progress.track('use_block', { id: 15 });
      return true;
    }
    if (Voxel.Blocks.isBed(hit.id)) { useBed(hit); return true; }
    if (hit.id === 37) { openFurnace(hit); return true; }
    if (hit.id === 38) { openChest(hit); return true; }
    return false;
  }

  // 轻点（触屏）：攻击生物 / 打开功能方块 / 放置手持方块
  function touchTap(nx, ny) {
    if (state !== 'playing') return;
    setTouchAim(nx, ny);
    var o = Voxel.Player.eyePos();
    var d = aimDir();
    var hit = Voxel.Raycaster.cast(o, d, C.REACH);
    if (hit && hit.type === 'mob') attack(hit.mob, d);
    else if (hit && hit.type === 'block' && !interactWith(hit)) place(hit);
  }

  // 长按挖掘开关（触屏手势）
  function setDigHold(on) {
    mouseDown[2] = !!on;
    if (!on) stopDig();
  }

  // ---------- 交互 ----------

  function doAct(btn) {
    if (state !== 'playing') return;
    var o = Voxel.Player.eyePos();
    var d = Voxel.Player.lookDir();
    var hit = Voxel.Raycaster.cast(o, d, C.REACH);
    if (!hit) return;
    if (hit.type === 'mob') {
      if (btn === 2) attack(hit.mob, d);
      return;
    }
    if (btn === 0) place(hit);
    // 方块挖掘：由 tickDig 长按推进
  }

  function attack(mob, d) {
    var nowS = performance.now() / 1000;
    if (nowS - lastDig < 0.35) return;
    lastDig = nowS;
    Voxel.Mobs.damage(mob, Voxel.Blocks.attackDmg(inv[sel]), d);
    Voxel.Player.addExhaust(C.EXHAUST_ATTACK);
    damageHeldTool(1);   // 攻击损耗武器耐久
    if (Voxel.HandItem) Voxel.HandItem.swing();
  }

  // ---- 长按挖掘（工具加速 / 矿石等级门槛 / 裂纹动画） ----

  function heldPickTier() { return Voxel.Blocks.pickTier(inv[sel]); }

  function breakTime(id) {
    var def = Voxel.Blocks.defs[id];
    if (!def || def.hard === undefined) return 0.6;
    if (def.hard === Infinity) return Infinity;
    var t = def.hard;
    if (def.pick) {
      if (heldPickTier() > 0) t /= Voxel.Blocks.pickMultOf(inv[sel]);
    }
    return Math.max(0.05, t);
  }

  function stopDig() {
    digT = null;
    digProg = 0;
    digNeed = 0;
    if (crackMesh) crackMesh.visible = false;
  }

  function tickDig(dt) {
    if (state !== 'playing') { stopDig(); return; }
    var d = aimDir();
    var hit = Voxel.Raycaster.cast(Voxel.Player.eyePos(), d, C.REACH);
    if (hit && hit.type === 'mob') { stopDig(); attack(hit.mob, d); return; }
    if (!hit || hit.type !== 'block' || hit.id === 12) { stopDig(); return; }
    var def = Voxel.Blocks.defs[hit.id];

    if (!digT || digT.x !== hit.x || digT.y !== hit.y || digT.z !== hit.z) {
      // 矿石等级门槛
      if (def.tier && heldPickTier() < def.tier) {
        stopDig();
        var nowMs = performance.now();
        if (nowMs - digHintT > 1500) {
          digHintT = nowMs;
          Voxel.HUD.toast('需要' + ['', '木镐', '石镐', '铁镐', '钻石镐'][def.tier] + '才能开采' + Voxel.Blocks.name(hit.id));
          Voxel.Sound.hit();
        }
        return;
      }
      digT = { x: hit.x, y: hit.y, z: hit.z, id: hit.id };
      digNeed = breakTime(hit.id);
      digProg = 0;
      digSndT = 0;
    }
    if (digNeed === Infinity) { stopDig(); return; }

    digProg += dt;

    // 周期性敲击声 + 碎屑粒子 + 挥动（挖掘进行中）
    digSndT -= dt;
    if (digSndT <= 0) {
      digSndT = 0.22;
      Voxel.Sound.digTick(def.sound);
      if (Voxel.HandItem) Voxel.HandItem.swing();
      if (Math.random() < 0.6)
        Voxel.Particles.burst(new THREE.Vector3(
          digT.x + 0.5 + (Math.random() - 0.5) * 0.8,
          digT.y + 0.5 + (Math.random() - 0.5) * 0.8,
          digT.z + 0.5 + (Math.random() - 0.5) * 0.8), def.color, 1);
    }

    // 裂纹覆盖层（档位前移：早期就显示明显裂纹，快挖的方块也能看清）
    if (crackMesh && crackTex.length) {
      crackMesh.visible = true;
      crackMesh.position.set(digT.x + 0.5, digT.y + 0.5, digT.z + 0.5);
      var frac = Math.min(1, digProg / digNeed);
      var stage = Math.min(crackTex.length - 1, (Math.pow(frac, 0.55) * crackTex.length) | 0);
      crackMesh.material.map = crackTex[stage];
      crackMesh.material.needsUpdate = true;
    }

    if (digProg >= digNeed) finishDig(digT);
  }

  function finishDig(t) {
    stopDig();
    var dropId = Voxel.Blocks.dropOf(t.id);
    // P0：背包放不下则方块保留，不凭空消失
    if (!canAddInv(dropId, 1)) {
      Voxel.HUD.toast('背包已满！清理出空间再挖');
      return;
    }
    var def = Voxel.Blocks.defs[t.id];
    if (t.id === 37) dumpContainerContents(t.x, t.y, t.z, ['in', 'fuel', 'out']);
    if (t.id === 38) dumpChest(t.x, t.y, t.z);
    Voxel.World.set(t.x, t.y, t.z, 0);
    if (Voxel.Blocks.isBed(t.id)) {
      // 双格床：破坏任一半同时拆掉另一半，整张床只掉一张床物品
      var pb = bedPartner(t.x, t.y, t.z, t.id);
      if (pb) {
        Voxel.World.set(pb.x, pb.y, pb.z, 0);
        enqueueWaterAround(pb.x, pb.y, pb.z);
      }
    }
    var blockPos = new THREE.Vector3(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    var bodyGot = addInv(dropId, 1);
    if (bodyGot < 1) {
      if (spawnRemainder(dropId, 1, blockPos)) {
        Voxel.HUD.toast('背包空间不足，' + Voxel.Blocks.name(dropId) + '已掉落在方块位置');
      } else {
        // 正常游戏中 Drops 已初始化；若仍失败，恢复一个空容器本体，保证物品守恒。
        Voxel.World.set(t.x, t.y, t.z, t.id);
        Voxel.HUD.toast('方块掉落生成失败，容器本体已在原位恢复');
        return;
      }
    }
    Voxel.Sound.dig(def.sound);
    Voxel.Particles.burst(blockPos, def.color, 10);
    Voxel.Player.addExhaust(C.EXHAUST_DIG);
    damageHeldTool(1);   // 挖掘损耗工具耐久
    // 成长系统：挖掘事件（含深层/水下判定）
    if (Voxel.Progress) {
      Voxel.Progress.track('mine', { id: t.id });
      if (t.y < 20) Voxel.Progress.track('depth', {});
      if (Voxel.Player.headIn && Voxel.Player.headIn()) Voxel.Progress.track('wetdig', {});
    }
    spawnFallersAbove(t.x, t.y, t.z);   // 上方沙/砾失去支撑 → 下落
    enqueueWaterAround(t.x, t.y, t.z);  // 临水 → 水流入
    if (Voxel.HandItem) Voxel.HandItem.swing();
  }

  function place(hit) {
    var id = inv[sel];
    if (!id) return;
    var def = Voxel.Blocks.defs[id];
    if (def && def.item) return; // 工具/材料不可放置
    var x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
    var cur = Voxel.World.get(x, y, z);
    if (cur !== 0 && cur !== 7) return;
    if (id === 19) {
      // 火把需要依托：下方或任一水平邻为实体
      var supported = Voxel.Blocks.isSolid(Voxel.World.get(x, y - 1, z)) ||
        Voxel.Blocks.isSolid(Voxel.World.get(x + 1, y, z)) ||
        Voxel.Blocks.isSolid(Voxel.World.get(x - 1, y, z)) ||
        Voxel.Blocks.isSolid(Voxel.World.get(x, y, z + 1)) ||
        Voxel.Blocks.isSolid(Voxel.World.get(x, y, z - 1));
      if (!supported) return;
    }
    var p = Voxel.Player.pos();
    var hw = C.W / 2 + 0.01;
    // 床：与 Minecraft 一致占两格——床尾在近身格，床头沿视线主方向外推一格。
    // 任一格非空气或与玩家重叠都放不下，不消耗物品。
    if (id === 17) {
      if (cur !== 0) return;
      var fd = Voxel.Player.lookDir();
      var bdx = Math.abs(fd.x) >= Math.abs(fd.z) ? (fd.x >= 0 ? 1 : -1) : 0;
      var bdz = bdx !== 0 ? 0 : (fd.z >= 0 ? 1 : -1);
      var hbx = x + bdx, hbz = z + bdz;
      if (Voxel.World.get(hbx, y, hbz) !== 0) return;
      var bedOverlap = function (cx, cz) {
        return cx < p.x + hw && cx + 1 > p.x - hw &&
          y < p.y + C.H + 0.01 && y + 1 > p.y &&
          cz < p.z + hw && cz + 1 > p.z - hw;
      };
      if (bedOverlap(x, z) || bedOverlap(hbx, hbz)) return;
      Voxel.World.set(x, y, z, 67);                                   // 床尾
      Voxel.World.set(hbx, y, hbz, Voxel.Blocks.bedHeadId(bdx, bdz)); // 床头（按朝向选型）
      decSel();
      Voxel.Sound.place('wood');
      if (Voxel.Progress) Voxel.Progress.track('place', { placedId: 17 });
      if (Voxel.HandItem) Voxel.HandItem.swing();
      return;
    }
    var overlap = x < p.x + hw && x + 1 > p.x - hw &&
      y < p.y + C.H + 0.01 && y + 1 > p.y &&
      z < p.z + hw && z + 1 > p.z - hw;
    if (overlap && Voxel.Blocks.isSolid(id)) return;
    Voxel.World.set(x, y, z, id);
    decSel();
    Voxel.Sound.place(def.sound);
    if (Voxel.Progress) Voxel.Progress.track('place', { placedId: id });
    if (Voxel.HandItem) Voxel.HandItem.swing();
  }

  // 吃掉当前快捷栏格的食物（R 键）
  function tryEat() {
    if (state !== 'playing') return;
    var id = inv[sel];
    var def = Voxel.Blocks.defs[id];
    if (!def || !def.food) return;   // 手持非食物：静默忽略
    if (!Voxel.Player.alive()) return;
    if (Voxel.Player.food() >= C.FOOD_MAX) {
      Voxel.HUD.toast('现在很饱，吃不下');
      return;
    }
    var got = Voxel.Player.eat(def.food);
    decSel();
    Voxel.Sound.eat();
    Voxel.HUD.toast('吃了' + def.name + '（饥饿 +' + got + '）');
    if (Voxel.Progress) Voxel.Progress.track('eat', { id: id });
  }

  function pickBlockId(id) {
    if (!id || id === 12) return false;
    // 快捷栏里已有 → 直接选中该格
    for (var i = 0; i < 9; i++) {
      if (inv[i] === id) {
        sel = i;
        Voxel.HUD.setSelected(sel);
        Voxel.Sound.select();
        return true;
      }
    }
    // 背包其他格有 → 与当前快捷栏格交换
    for (var j = 9; j < 36; j++) {
      if (inv[j] === id) {
        var ti = inv[j], tc = cnt[j], td = dur[j];
        inv[j] = inv[sel]; cnt[j] = cnt[sel]; dur[j] = dur[sel];
        inv[sel] = ti; cnt[sel] = tc; dur[sel] = td;
        refreshInv();
        Voxel.Sound.select();
        return true;
      }
    }
    // 都没有 → 放入当前空格；否则找第一个空快捷栏格（都不行才提示已满）
    if (!inv[sel]) { inv[sel] = id; cnt[sel] = 1; dur[sel] = null; }
    else {
      var placed = false;
      for (var k2 = 0; k2 < 9; k2++) {
        if (!inv[k2]) { inv[k2] = id; cnt[k2] = 1; dur[k2] = null; sel = k2; placed = true; break; }
      }
      if (!placed) { Voxel.HUD.toast('背包已满！'); return false; }
    }
    refreshInv();
    Voxel.HUD.setSelected(sel);
    Voxel.Sound.select();
    return true;
  }

  function pickBlock() {
    if (state !== 'playing') return false;
    var hit = Voxel.Raycaster.cast(Voxel.Player.eyePos(), Voxel.Player.lookDir(), C.REACH);
    if (!hit || hit.type !== 'block') return false;
    return pickBlockId(hit.id);
  }

  // 生物掉落 → 背包；放不下的余量保留在真实死亡位置。
  function onDrop(id, n, pos, d) {
    n = n || 1;
    var got = addToInvWithDur(id, n, d);
    var remaining = n - got;
    if (got >= n) Voxel.HUD.toast('获得 ' + Voxel.Blocks.name(id) + (n > 1 ? ' ×' + n : ''));
    else if (spawnRemainder(id, remaining, pos, d)) {
      if (got > 0) Voxel.HUD.toast('获得 ' + Voxel.Blocks.name(id) + ' ×' + got + '，余下 ×' + remaining + ' 留在死亡位置');
      else Voxel.HUD.toast('背包已满，掉落物已留在死亡位置');
    } else {
      Voxel.HUD.toast('背包空间不足，掉落物仍留在死亡位置');
    }
    return got;
  }

  // ---------- 合成 ----------

  function refreshCraft() {
    Voxel.HUD.setCraftGrid(craftGrid);
    var r = Voxel.Crafting.match(craftGrid);
    Voxel.HUD.drawResult(r ? r.result : 0);
  }

  function openCrafting() {
    if (state !== 'playing') return;
    document.body.classList.add('panel-open');
    refreshInv();
    Voxel.HUD.drawHeld(heldItem);
    refreshCraft();
    openModalLayer({
      id: 'crafting', state: 'crafting', returnState: 'playing',
      initialFocus: '#btn-craft-close', closeKeys: ['KeyE'], manualKey: true, onEscape: closeCrafting
    });
  }

  function closeCrafting() {
    if (state !== 'crafting') return;
    if (heldItem && stowHeld() === false) {
      refreshInv();
      Voxel.HUD.drawHeld(heldItem);
      refreshCraft();
      return false;
    }
    if (!returnGridToInv(craftGrid)) {
      refreshInv();
      Voxel.HUD.drawHeld(heldItem);
      refreshCraft();
      return false;
    }
    refreshInv();
    Voxel.HUD.drawHeld(0);
    document.body.classList.remove('panel-open');
    closeModalLayer('crafting', false);
    return true;
  }

  // 格子统一读写：inv 有堆叠数量；合成格每格固定 1 个；
  // 熔炉三格（fin 原料 / ffuel 燃料 / fout 产物）为对象槽，挂在 curFurnace 上
  function slotGet(loc, i) {
    if (loc === 'inv') return { id: inv[i], n: cnt[i], d: dur[i] };
    if (loc === 'gear') return { id: gear[i], n: gear[i] ? 1 : 0, d: gearDur[i] };
    if (loc === 'charge') return { id: charge.id, n: charge.n };
    if (loc === 'icraft') return { id: invCraftGrid[i], n: invCraftGrid[i] ? 1 : 0 };
    if (loc === 'fin' || loc === 'ffuel' || loc === 'fout') {
      var o = curFurnace ? curFurnace[loc.slice(1)] : null;
      return { id: o ? o.id : 0, n: o ? o.n : 0 };
    }
    if (loc === 'chest') {
      var it = curChest && curChest.items[i];
      return it ? { id: it.id, n: it.n, d: it.dur } : { id: 0, n: 0 };
    }
    return { id: craftGrid[i], n: craftGrid[i] ? 1 : 0 };
  }

  // d: 耐久（仅工具格有意义）
  function slotSet(loc, i, id, n, d) {
    if (loc === 'inv') {
      inv[i] = id;
      cnt[i] = id ? n : 0;
      dur[i] = (id && typeof d === 'number' && d > 0) ? d : null;
    }
    else if (loc === 'gear') {
      gear[i] = id;
      gearDur[i] = id ? (typeof d === 'number' && d > 0 ? d : (Voxel.Blocks.maxDur(id) || null)) : null;
    }
    else if (loc === 'charge') {
      charge.id = id;
      charge.n = id ? n : 0;
    }
    else if (loc === 'icraft') invCraftGrid[i] = id;
    else if (loc === 'fin' || loc === 'ffuel' || loc === 'fout') {
      if (curFurnace) curFurnace[loc.slice(1)] = id ? { id: id, n: n } : null;
    }
    else if (loc === 'chest') {
      if (curChest) curChest.items[i] = id ? { id: id, n: n, dur: (typeof d === 'number' && d > 0) ? d : null } : null;
    }
    else craftGrid[i] = id;
  }

  // 可堆叠的格子位置（合成格每格只放 1 个）
  function isStackLoc(loc) {
    return loc === 'inv' || loc === 'fin' || loc === 'ffuel' || loc === 'chest' || loc === 'charge';
  }

  function storesDur(loc) {
    return loc === 'inv' || loc === 'chest' || loc === 'gear';
  }

  // 装备/充能槽的物品准入校验：头部槽只收防毒面具、身体槽只收防寒服，
  // 充能槽只收木炭/煤炭。
  function gearSlotOk(loc, i, id) {
    if (loc === 'gear')
      return !!id && !!Voxel.Blocks.defs[id] && Voxel.Blocks.defs[id].gearSlot === (i === 0 ? 'head' : 'body');
    if (loc === 'charge') return id === CHARCOAL_ID || id === COAL_ID;
    return true;
  }

  function isDurableItem(id) {
    return !!Voxel.Blocks.maxDur(id);
  }

  function normalizedItemDur(id, d) {
    var md = Voxel.Blocks.maxDur(id);
    if (!md) return null;
    var n = Number(d);
    return isFinite(n) && n > 0 ? Math.max(1, Math.min(md, Math.floor(n))) : md;
  }

  function rejectDurabilityLoss(loc, id) {
    if (!isDurableItem(id) || storesDur(loc)) return false;
    Voxel.HUD.toast('工具不能放入该槽位，以免丢失耐久');
    return true;
  }

  function slotCapacity(loc, id) {
    return isStackLoc(loc) ? stackMax(id) : 1;
  }

  // fout 永远只出不进；其余目标必须能完整保存数量与工具耐久。
  function canStoreWhole(loc, id, n) {
    if (!id) return true;
    if (loc === 'fout' || rejectDurabilityLoss(loc, id)) return false;
    return n > 0 && n <= slotCapacity(loc, id);
  }

  // 手持 ↔ 格子交互（拾取/放置/合并/交换）。返回是否发生变化。
  // fout（熔炉产物格）只允许取出，不允许放入/并入。手持物经 heldDur 携带工具耐久。
  function handToSlot(loc, i) {
    var s = slotGet(loc, i);
    var changed = true;
    var stackable = isStackLoc(loc);
    if (loc === 'fout' && heldItem) return false;
    if (heldItem && rejectDurabilityLoss(loc, heldItem)) return false;
    if (heldItem && (loc === 'gear' || loc === 'charge') && !gearSlotOk(loc, i, heldItem)) {
      Voxel.HUD.toast(loc === 'gear' ? '该装备槽不支持这件物品' : '充能槽只接受木炭或煤炭');
      return false;
    }
    if (!heldItem) {
      if (!s.id) changed = false;
      else { // 拾取整格（合成格即 1 个）
        heldItem = s.id; heldCnt = s.n; heldDur = normalizedItemDur(s.id, s.d);
        slotSet(loc, i, 0, 0);
      }
    } else if (!s.id) {
      if (stackable) {      // 放置整手
        var put = Math.min(slotCapacity(loc, heldItem), heldCnt);
        slotSet(loc, i, heldItem, put, heldDur);
        heldCnt -= put;
        if (heldCnt <= 0) { heldItem = 0; heldCnt = 0; heldDur = null; }
      } else {              // 合成格只收 1 个，余量留在手上（gear 槽同路径，携带耐久）
        slotSet(loc, i, heldItem, 1, heldDur);
        heldCnt--;
        if (heldCnt <= 0) { heldItem = 0; heldCnt = 0; heldDur = null; }
      }
    } else if (s.id === heldItem) {
      if (stackable && s.n < stackMax(heldItem) && heldCnt > 0 && heldCnt < MAX_STACK * 2) {
        // 同物并入格子
        var move = Math.min(stackMax(heldItem) - s.n, heldCnt);
        if (move > 0) {
          slotSet(loc, i, heldItem, s.n + move, s.d);
          heldCnt -= move;
          if (heldCnt <= 0) { heldItem = 0; heldCnt = 0; heldDur = null; }
        } else changed = false;
      } else if (!stackable) {
        // 合成格已有同物：拿回 1 个
        heldCnt++;
        slotSet(loc, i, 0, 0);
      } else changed = false;
    } else {
      if ((stackable && heldCnt <= slotCapacity(loc, heldItem)) || (!stackable && heldCnt === 1)) {
        // 不同物品：整手 ↔ 整格交换（合成格按 1 个计）
        slotSet(loc, i, heldItem, stackable ? heldCnt : 1, heldDur);
        heldItem = s.id; heldCnt = s.n; heldDur = normalizedItemDur(s.id, s.d);
      } else changed = false;
    }
    if (changed) Voxel.Sound.select();
    return changed;
  }

  function decSlotBy(loc, i, n) {
    var s = slotGet(loc, i);
    var left = s.n - n;
    if (left <= 0) slotSet(loc, i, 0, 0);
    else slotSet(loc, i, s.id, left, s.d);
  }

  // 拖放：源格 → 目标格（不经过手持）。产物格 fout 只出不进。
  function transferSlots(fl, fi, tl, ti) {
    var src = slotGet(fl, fi);
    if (!src.id || (fl === tl && fi === ti)) return false;
    if (tl === 'fout') return false;
    if ((tl === 'gear' || tl === 'charge') && !gearSlotOk(tl, ti, src.id)) return false;
    var dst = slotGet(tl, ti);
    var dstSt = isStackLoc(tl);
    if (rejectDurabilityLoss(tl, src.id)) return false;
    if (!dst.id) {
      var moveEmpty = Math.min(slotCapacity(tl, src.id), src.n);
      if (!(moveEmpty > 0)) return false;
      slotSet(tl, ti, src.id, moveEmpty, src.d);
      decSlotBy(fl, fi, moveEmpty);
      return true;
    }
    if (src.id === dst.id) {
      var sm = stackMax(src.id);
      if (dstSt && dst.n < sm) {
        var move = Math.min(sm - dst.n, src.n);
        slotSet(tl, ti, dst.id, dst.n + move);
        decSlotBy(fl, fi, move);
        return move > 0;
      }
      return false;
    }
    // 不同物品只能原子交换：两边都必须完整容纳对方，不能截断任何一堆。
    if (!canStoreWhole(tl, src.id, src.n) || !canStoreWhole(fl, dst.id, dst.n)) return false;
    slotSet(tl, ti, src.id, src.n, src.d);
    slotSet(fl, fi, dst.id, dst.n, dst.d);
    return true;
  }

  function onCraftClick(i) {
    if (state !== 'crafting') return;
    if (handToSlot('craft', i)) { Voxel.HUD.drawHeld(heldItem); refreshCraft(); }
  }

  function onResultClick() {
    if (state !== 'crafting') return;
    var r = Voxel.Crafting.match(craftGrid);
    if (!r) return;
    if (!canAcceptCraftResult(r.result, r.count)) {
      Voxel.HUD.toast(r.result === WARP_CELL_ITEM_ID ? '曲速电池仓已满！' : '背包空间不足！');
      return;
    }
    Voxel.Crafting.consume(craftGrid, r);
    acceptCraftResult(r.result, r.count);
    Voxel.Sound.pop();
    announceCraftResult(r.result, r.count);
    refreshInv();
    refreshCraft();
  }

  // ---------- 背包 2x2 合成 ----------

  function refreshInvCraft() {
    Voxel.HUD.setInvCraftGrid(invCraftGrid);
    var r = Voxel.Crafting.matchIn(invCraftGrid, 2);
    Voxel.HUD.drawInvResult(r ? r.result : 0);
  }

  function onInvCraftClick(i) {
    if (state !== 'inventory') return;
    if (handToSlot('icraft', i)) { Voxel.HUD.drawHeld(heldItem); refreshInvCraft(); }
  }

  function onInvResultClick() {
    if (state !== 'inventory') return;
    var r = Voxel.Crafting.matchIn(invCraftGrid, 2);
    if (!r) return;
    if (!canAcceptCraftResult(r.result, r.count)) {
      Voxel.HUD.toast(r.result === WARP_CELL_ITEM_ID ? '曲速电池仓已满！' : '背包空间不足！');
      return;
    }
    Voxel.Crafting.consume(invCraftGrid, r);
    acceptCraftResult(r.result, r.count);
    Voxel.Sound.pop();
    announceCraftResult(r.result, r.count);
    refreshInv();
    refreshInvCraft();
  }

  // 关闭面板时把合成格退回背包；余量落在脚边，生成失败则保留格子并拒绝关闭。
  function returnGridToInv(grid) {
    var complete = true;
    var dropped = 0;
    var feet = Voxel.Player.pos().clone();
    feet.y += 0.25;
    for (var g = 0; g < grid.length; g++) {
      if (!grid[g]) continue;
      var id = grid[g];
      if (addInv(id, 1) > 0) {
        grid[g] = 0;
      } else if (spawnRemainder(id, 1, feet)) {
        grid[g] = 0;
        dropped++;
      } else {
        complete = false;
      }
    }
    if (dropped > 0) Voxel.HUD.toast('背包空间不足，合成格余下物品已掉落在脚边');
    if (!complete) Voxel.HUD.toast('掉落物生成失败，合成格已保留，请重试关闭');
    return complete;
  }

  // ---------- 拖拽（点击拾取仍可用：按下未移动即拾取到手持） ----------
  var dragState = null;

  function refreshPanel(from) {
    if (from === 'inv') Voxel.HUD.setInv(inv, cnt, dur);
    else if (from === 'icraft') refreshInvCraft();
    else if (from === 'fin' || from === 'ffuel' || from === 'fout') {
      if (curFurnace) Voxel.HUD.setFurnace(curFurnace);
    }
    else if (from === 'chest') { if (curChest) Voxel.HUD.setChest(curChest); }
    else refreshCraft();
  }

  // 槽位 UI 同步（交互后统一刷新）
  function syncSlots(from) {
    refreshInv();
    Voxel.HUD.drawHeld(heldItem);
    refreshPanel(from);
  }

  // 槽位交互状态校验
  function slotStateOk(from) {
    if (from === 'inv') return state === 'inventory' || state === 'crafting' || state === 'furnace' || state === 'chest';
    if (from === 'fin' || from === 'ffuel' || from === 'fout') return state === 'furnace';
    if (from === 'chest') return state === 'chest';
    if (from === 'icraft') return state === 'inventory';
    if (from === 'craft') return state === 'crafting';
    if (from === 'gear' || from === 'charge') return state === 'inventory';
    return false;
  }

  // Shift+点击：容器/合成格物品退回背包；背包格在快捷栏/背包间快搬或存入箱子
  function onSlotShift(from, idx) {
    if (from === 'inv') {
      if (state === 'chest' && curChest) {
        if (quickMoveToChest(idx)) {
          Voxel.Sound.select();
          syncSlots('inv');
          if (curChest) Voxel.HUD.setChest(curChest);
        }
        return;
      }
      if (quickMoveInv(idx)) syncSlots('inv');
      return;
    }
    var s = slotGet(from, idx);
    if (!s.id) return;
    var got = addToInvWithDur(s.id, s.n, s.d);
    if (got > 0) {
      if (got < s.n) slotSet(from, idx, s.id, s.n - got, s.d);
      else slotSet(from, idx, 0, 0);
      Voxel.Sound.select();
      syncSlots(from);
      if (from === 'craft') refreshCraft();
      else if (from === 'icraft') refreshInvCraft();
      else if (curFurnace) Voxel.HUD.setFurnace(curFurnace);
    } else Voxel.HUD.toast('背包空间不足！');
  }

  // 右键：手上无物 → 拿取半堆（向上取整）；手上有物 → 放置 1 个（产物格只出不进）
  function onSlotRight(from, idx) {
    if (heldItem) {
      if (from === 'fout') return;
      if (rejectDurabilityLoss(from, heldItem)) return false;
      var s = slotGet(from, idx);
      if (isStackLoc(from)) {
        if (!s.id) {
          slotSet(from, idx, heldItem, 1, heldDur);
        } else if (s.id === heldItem && s.n < stackMax(heldItem)) {
          slotSet(from, idx, heldItem, s.n + 1, s.d);
        } else return;
      } else {
        if (s.id) return;              // 合成格只收 1 个且须为空格（gear 同路径）
        slotSet(from, idx, heldItem, 1, heldDur);
      }
      heldCnt--;
      if (heldCnt <= 0) { heldItem = 0; heldCnt = 0; heldDur = null; }
      Voxel.Sound.select();
      syncSlots(from);
      refreshExtra(from);
      return;
    }
    var s2 = slotGet(from, idx);
    if (!s2.id) return;
    if (isStackLoc(from)) {
      var take = Math.ceil(s2.n / 2);
      heldItem = s2.id;
      heldCnt = take;
      heldDur = normalizedItemDur(s2.id, s2.d);
      var left = s2.n - take;
      slotSet(from, idx, left > 0 ? s2.id : 0, left > 0 ? left : 0, left > 0 ? s2.d : null);
    } else {
      handToSlot(from, idx);           // 单物品合成格：等同左键
    }
    Voxel.Sound.select();
    syncSlots(from);
    refreshExtra(from);
  }

  function slotIndexValid(from, idx) {
    if (idx !== Math.floor(idx) || idx < 0) return false;
    if (from === 'inv') return idx < 36;
    if (from === 'gear') return idx < 2;
    if (from === 'charge') return idx === 0;
    if (from === 'craft') return idx < 9;
    if (from === 'icraft') return idx < 4;
    if (from === 'chest') return idx < 27;
    return (from === 'fin' || from === 'ffuel' || from === 'fout') && idx === 0;
  }

  // HUD 键盘槽位入口：Enter/Space 主操作、Shift+Enter 快搬、secondary 右键语义。
  function onSlotKeyboard(from, idx, options) {
    idx = Number(idx);
    options = options || {};
    if (!slotStateOk(from) || !slotIndexValid(from, idx)) return false;
    var beforeSlot = slotGet(from, idx);
    var before = [beforeSlot.id, beforeSlot.n, beforeSlot.d, heldItem, heldCnt, heldDur].join('|');
    if (options.shift) onSlotShift(from, idx);
    else if (options.secondary) onSlotRight(from, idx);
    else {
      if (!handToSlot(from, idx)) return false;
      syncSlots(from);
      refreshExtra(from);
      return true;
    }
    var afterSlot = slotGet(from, idx);
    var after = [afterSlot.id, afterSlot.n, afterSlot.d, heldItem, heldCnt, heldDur].join('|');
    return before !== after;
  }

  // 面板附属刷新（合成结果预览 / 熔炉槽位 / 箱子槽位）
  function refreshExtra(from) {
    if (from === 'craft') refreshCraft();
    else if (from === 'icraft') refreshInvCraft();
    else if (curFurnace && (from === 'fin' || from === 'ffuel' || from === 'fout'))
      Voxel.HUD.setFurnace(curFurnace);
    else if (curChest && from === 'chest')
      Voxel.HUD.setChest(curChest);
  }

  function onSlotDown(e, from, idx) {
    if (!slotStateOk(from)) return;
    if (e.button === 2) {
      e.preventDefault();
      onSlotRight(from, idx);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    if (e.shiftKey) { onSlotShift(from, idx); return; }
    if (heldItem) {
      // 手持有物品：开始拖拽手持物（松手在格子上=放置/交换，空白处=继续手持，未移动=点击放置）
      dragState = { from: from, idx: idx, id: heldItem, n: heldCnt, sx: e.clientX, sy: e.clientY, moved: false, fromHand: true };
      Voxel.HUD.startGhost(heldItem);
      Voxel.HUD.moveGhost(e.clientX, e.clientY);
      return;
    }
    var s = slotGet(from, idx);
    if (!s.id) return;
    dragState = { from: from, idx: idx, id: s.id, n: s.n, sx: e.clientX, sy: e.clientY, moved: false, fromHand: false };
    Voxel.HUD.startGhost(s.id);
    Voxel.HUD.moveGhost(e.clientX, e.clientY);
  }

  function onDragMove(e) {
    if (!dragState) return;
    if (!dragState.moved && Math.abs(e.clientX - dragState.sx) + Math.abs(e.clientY - dragState.sy) > 6)
      dragState.moved = true;
    if (dragState.moved) {
      Voxel.HUD.moveGhost(e.clientX, e.clientY);
      Voxel.HUD.slotHover(e);
    }
  }

  function onDragUp(e) {
    if (!dragState) return;
    var d = dragState;
    dragState = null;
    Voxel.HUD.endGhost();
    if (!d.moved) {
      // 纯点击：统一走手持 ↔ 格子交互
      handToSlot(d.from, d.idx);
      refreshInv();
      Voxel.HUD.drawHeld(heldItem);
      refreshPanel(d.from);
      return;
    }
    // 拖放：找落点
    var el = document.elementFromPoint(e.clientX, e.clientY);
    var slotEl = el && el.closest ? el.closest('[data-slot]') : null;
    if (!slotEl) return; // 丢在空白处：手持物继续手持，格子物品留在原格
    var spec = slotEl.getAttribute('data-slot');
    if (spec === 'result') { onResultClick(); return; }
    if (spec === 'inv-result') { onInvResultClick(); return; }
    var parts = spec.split(':');
    var to = parts[0], tIdx = +parts[1];
    if (to !== 'inv' && to !== 'craft' && to !== 'icraft' &&
      to !== 'fin' && to !== 'ffuel' && to !== 'fout' && to !== 'chest' &&
      to !== 'gear' && to !== 'charge') return;
    // pointerdown 后面板状态可能已变化；真正写槽前重新验证来源和目标。
    if (!slotStateOk(d.from) || !slotStateOk(to)) return;
    if (d.fromHand) {
      // 手持物拖放
      if (!handToSlot(to, tIdx)) return;
      refreshInv();
      Voxel.HUD.drawHeld(heldItem);
      refreshPanel(to);
      return;
    }
    if (to === d.from && tIdx === d.idx) return; // 丢回原格：取消
    if (!transferSlots(d.from, d.idx, to, tIdx)) return;
    Voxel.Sound.select();
    refreshInv();
    refreshPanel(d.from);
    if (to !== d.from) refreshPanel(to);
  }

  // ---------- 合成手册 ----------

  function openManual() {
    if (manualOpen) return;
    manualReturnState = state;
    manualOpen = true;
    Voxel.HUD.refreshManual();
    openModalLayer({
      id: 'manual', state: 'manual', returnState: manualReturnState,
      initialFocus: function () {
        return document.querySelector('#manual .craft-btn:not(:disabled)') || document.getElementById('btn-manual-close');
      },
      closeKeys: ['KeyM', 'KeyE'], onEscape: closeManual
    });
  }

  function closeManual() {
    if (!manualOpen) return;
    manualOpen = false;
    manualCraftStop();
    closeModalLayer('manual', true);
    manualReturnState = 'menu';
  }

  // ---------- 手册一键合成（自动消耗背包材料，长按连续合成） ----------
  var manualCraftTimer = null;

  function manualCraftContextAllowed() {
    return ['playing', 'paused', 'inventory', 'crafting', 'furnace', 'chest'].indexOf(manualReturnState) >= 0;
  }

  function manualCraftable(i) {
    if (!manualCraftContextAllowed()) return 0;
    return Voxel.Crafting.canCraftFromInv(inv, Voxel.Crafting.recipes[i], cnt);
  }

  function manualCraftOnce(i) {
    if (!manualCraftContextAllowed()) return false;
    var r = Voxel.Crafting.recipes[i];
    if (Voxel.Crafting.canCraftFromInv(inv, r, cnt) < 1) return false;
    // 空间检查：现有空间 + 整格被清空的材料格腾出的空间 ≥ 产物数量
    var free = freeFor(r.result);
    var need = Voxel.Crafting.needed(r, inv, cnt), drained = 0;
    for (var k in need) {
      var left = need[k];
      for (var s = 0; s < 36 && left > 0; s++) {
        if (inv[s] !== +k) continue;
        var take = Math.min(cnt[s], left);
        left -= take;
        if (take === cnt[s]) drained++;
      }
    }
    if (!canAcceptCraftResult(r.result, r.count) ||
      (r.result !== WARP_CELL_ITEM_ID && free + drained * MAX_STACK < r.count)) {
      Voxel.HUD.toast(r.result === WARP_CELL_ITEM_ID ? '曲速电池仓已满！' : '背包空间不足！');
      return false;
    }
    Voxel.Crafting.consumeFromInv(inv, r, 1, cnt);
    acceptCraftResult(r.result, r.count);
    Voxel.Sound.pop();
    announceCraftResult(r.result, r.count);
    refreshInv();
    Voxel.HUD.refreshManual();
    return true;
  }

  function manualCraftStart(i) {
    manualCraftStop();
    if (!manualCraftOnce(i)) return;
    manualCraftTimer = setInterval(function () {
      if (!manualOpen || state !== 'manual' || !manualCraftContextAllowed()) {
        manualCraftStop();
        return;
      }
      if (!manualCraftOnce(i)) manualCraftStop();
    }, 180);
  }

  function manualCraftStop() {
    if (manualCraftTimer) { clearInterval(manualCraftTimer); manualCraftTimer = null; }
  }

  // ---------- 熔炉 ----------
  var curFurnace = null;        // 当前打开的熔炉状态对象（世界元数据引用）
  var activeFurnaces = {};      // "x,y,z" -> 状态对象（需要 tick 的全部炉子）

  function rebuildActiveFurnaces() {
    activeFurnaces = {};
    var md = Voxel.World.getAllMeta();
    for (var k in md)
      if (md[k] && md[k].type === 'furnace') activeFurnaces[k] = md[k];
  }

  function furnaceAt(x, y, z, create) {
    var k = x + ',' + y + ',' + z;
    var f = Voxel.World.getMeta(x, y, z);
    if (!f && create && Voxel.World.get(x, y, z) === 37) {
      f = Voxel.FurnaceSys.fresh();
      Voxel.World.setMeta(x, y, z, f);
    }
    if (f) activeFurnaces[k] = f;
    return f;
  }

  // 推进所有炉子；面板打开时同步 UI 表针
  function refreshFurnacePanel(f) {
    if (!f) return;
    Voxel.HUD.setFurnace(f);
    Voxel.HUD.setFurnaceGauges(
      f.burnMax > 0 ? f.burnT / f.burnMax : 0,
      f.prog / Voxel.FurnaceSys.SMELT_TIME);
  }

  function tickFurnaces(dt) {
    for (var k in activeFurnaces) {
      var p = k.split(',');
      if (Voxel.World.get(+p[0], +p[1], +p[2]) !== 37) { delete activeFurnaces[k]; continue; }
      var f = activeFurnaces[k];
      var outBefore = f.out ? f.out.n : 0;
      Voxel.FurnaceSys.tickOne(f, dt);
      var produced = (f.out ? f.out.n : 0) - outBefore;
      if (produced > 0 && Voxel.Progress)
        Voxel.Progress.track('smelt', { id: f.out.id, n: produced });
    }
    if (state === 'furnace' && curFurnace) refreshFurnacePanel(curFurnace);
  }

  function openFurnace(hit) {
    if (state !== 'playing') return;
    var f = furnaceAt(hit.x, hit.y, hit.z, true);
    if (!f) return;
    curFurnace = f;
    document.body.classList.add('panel-open');
    refreshInv();
    Voxel.HUD.drawHeld(heldItem);
    refreshFurnacePanel(f);
    openModalLayer({
      id: 'furnace', state: 'furnace', returnState: 'playing',
      initialFocus: '#btn-furnace-close', closeKeys: ['KeyE'], manualKey: true, onEscape: closeFurnace
    });
  }

  function closeFurnace() {
    if (state !== 'furnace') return;
    if (heldItem && stowHeld() === false) {
      refreshInv();
      Voxel.HUD.drawHeld(heldItem);
      return false;
    }
    // 炉内物品保留在方块元数据中，继续烧制
    refreshInv();
    Voxel.HUD.drawHeld(0);
    document.body.classList.remove('panel-open');
    closeModalLayer('furnace', false);
    return true;
  }

  // 挖掉熔炉：内容退回背包，放不下的变成掉落物
  function dumpContainerContents(x, y, z, slots) {
    var f = Voxel.World.getMeta(x, y, z);
    if (!f) return;
    var c = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5);
    for (var si = 0; si < slots.length; si++) {
      var o = f[slots[si]];
      if (!o || !o.n) continue;
      var got = addInv(o.id, o.n);
      if (got < o.n) {
        Voxel.Drops.spawn(o.id, o.n - got, c,
          new THREE.Vector3((Math.random() - 0.5) * 3, 2.5, (Math.random() - 0.5) * 3));
      }
    }
    delete activeFurnaces[x + ',' + y + ',' + z];
  }

  // ---------- 箱子 ----------
  var curChest = null;

  // 首次开启遗迹宝箱：登记"远古遗迹"地标档案（带事务回滚，与扫描流程一致）。
  function recordRuinDiscovery(x, y, z) {
    if (!Voxel.Discovery || !galaxyState || !currentWorld) return;
    var ev = { worldId: currentWorld.id, kind: 'landmark', key: 'ruin', pos: [x, y, z] };
    var oldDiscovery = galaxyState.discovery;
    var recorded = Voxel.Discovery.record(oldDiscovery, ev, galaxyState.catalog);
    if (!recorded || !recorded.added) return;
    var oldFuel = galaxyState.ship.fuel;
    galaxyState.discovery = recorded.state;
    galaxyState.ship.fuel = Math.min(galaxyState.ship.maxFuel, oldFuel + recorded.fuelAwarded);
    if (!doSave(true, 'ruin-discovery')) {
      galaxyState.discovery = oldDiscovery;
      galaxyState.ship.fuel = oldFuel;
      return;
    }
    if (Voxel.Progress) Voxel.Progress.track('ruin', {});
  }

  function openChest(hit) {
    if (state !== 'playing') return;
    if (Voxel.World.get(hit.x, hit.y, hit.z) !== 38) return;
    var k = hit.x + ',' + hit.y + ',' + hit.z;
    var c = Voxel.World.getMeta(hit.x, hit.y, hit.z);
    if (!c || c.type !== 'chest') {
      // 惰性战利品：遗迹箱子生成时不写元数据，首开时按种子确定性填充。
      var loot = Voxel.Structures && Voxel.Structures.chestLootAt
        ? Voxel.Structures.chestLootAt(hit.x, hit.y, hit.z) : null;
      c = { type: 'chest', items: loot || new Array(27).fill(null) };
      Voxel.World.setMeta(hit.x, hit.y, hit.z, c);
      if (loot) recordRuinDiscovery(hit.x, hit.y, hit.z);
    }
    curChest = c;
    document.body.classList.add('panel-open');
    Voxel.HUD.setInv(inv, cnt, dur);
    Voxel.HUD.drawHeld(heldItem);
    Voxel.HUD.setChest(c);
    openModalLayer({
      id: 'chest', state: 'chest', returnState: 'playing',
      initialFocus: '#btn-chest-close', closeKeys: ['KeyE'], manualKey: true, onEscape: closeChest
    });
  }

  function closeChest() {
    if (state !== 'chest') return;
    if (heldItem && stowHeld() === false) {
      refreshInv();
      Voxel.HUD.drawHeld(heldItem);
      return false;
    }
    refreshInv();
    Voxel.HUD.drawHeld(0);
    curChest = null;   // 箱内物品保留在方块元数据中
    document.body.classList.remove('panel-open');
    closeModalLayer('chest', false);
    return true;
  }

  // 挖掉箱子：27 格内容退回背包（保留工具耐久），放不下变成掉落物
  function dumpChest(x, y, z) {
    var c = Voxel.World.getMeta(x, y, z);
    if (!c || !c.items) return;
    var pos = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5);
    for (var i = 0; i < c.items.length; i++) {
      var it = c.items[i];
      if (!it || !it.n) continue;
      var got = addToInvWithDur(it.id, it.n, it.dur);
      if (got < it.n) {
        Voxel.Drops.spawn(it.id, it.n - got, pos,
          new THREE.Vector3((Math.random() - 0.5) * 3, 2.5, (Math.random() - 0.5) * 3), it.dur);
      }
    }
  }

  // Shift+点击背包格 → 存入箱子（先并入同类堆，工具进空格并保留耐久）
  function quickMoveToChest(i) {
    var id = inv[i];
    if (!curChest || !id) return false;
    var sm = stackMax(id), moved = 0, need = cnt[i];
    var md = Voxel.Blocks.maxDur(id);
    if (!md) {
      for (var s = 0; s < 27 && moved < need; s++) {
        var o = curChest.items[s];
        if (o && o.id === id && o.n < sm) {
          var t1 = Math.min(sm - o.n, need - moved);
          o.n += t1;
          moved += t1;
        }
      }
    }
    for (var s2 = 0; s2 < 27 && moved < need; s2++) {
      if (!curChest.items[s2]) {
        var put = Math.min(sm, need - moved);
        curChest.items[s2] = { id: id, n: put,
          dur: md ? ((typeof dur[i] === 'number' && dur[i] > 0) ? dur[i] : md) : null };
        moved += put;
      }
    }
    if (moved <= 0) return false;
    cnt[i] -= moved;
    if (cnt[i] <= 0) { inv[i] = 0; cnt[i] = 0; dur[i] = null; }
    Voxel.Sound.select();
    return true;
  }

  function cycleSlot(d) {
    sel = (sel + d + 9) % 9;
    Voxel.HUD.setSelected(sel);
    Voxel.Sound.select();
  }

  function selectHotbar(index) {
    index = Number(index);
    if (index !== Math.floor(index) || index < 0 || index > 8) return false;
    if (['playing', 'inventory', 'crafting', 'furnace', 'chest'].indexOf(state) < 0) return false;
    sel = index;
    Voxel.HUD.setSelected(sel);
    Voxel.Sound.select();
    return true;
  }

  function onInvClick(idx) {
    if (state !== 'inventory' && state !== 'crafting') return;
    if (handToSlot('inv', idx)) {
      refreshInv();
      Voxel.HUD.drawHeld(heldItem);
    }
  }

  function toggleInv(open) {
    if (open && state === 'playing') {
      document.body.classList.add('panel-open');
      refreshInv();
      Voxel.HUD.drawHeld(heldItem);
      refreshInvCraft();
      openModalLayer({
        id: 'inventory', state: 'inventory', returnState: 'playing',
        initialFocus: '#btn-inv-close', closeKeys: ['KeyE'], manualKey: true, onEscape: function () { toggleInv(false); }
      });
    } else if (!open && state === 'inventory') {
      if (heldItem && stowHeld() === false) {
        refreshInv();
        Voxel.HUD.drawHeld(heldItem);
        refreshInvCraft();
        return false;
      }
      if (!returnGridToInv(invCraftGrid)) {
        refreshInv();
        Voxel.HUD.drawHeld(heldItem);
        refreshInvCraft();
        return false;
      }
      refreshInv();
      Voxel.HUD.drawHeld(0);
      document.body.classList.remove('panel-open');
      closeModalLayer('inventory', false);
      return true;
    }
  }

  function pause() {
    if (state !== 'playing' && state !== 'cockpit') return;
    var returnState = state;
    var pauseFeedback = document.getElementById('pause-save-feedback');
    setAttributeIfChanged(pauseFeedback, 'role', 'status');
    setAttributeIfChanged(pauseFeedback, 'aria-live', 'polite');
    setTextIfChanged(pauseFeedback, '');
    doSave(true, 'pause');
    openModalLayer({
      id: 'overlay-pause', state: 'paused', returnState: returnState,
      initialFocus: '#btn-resume', closeKeys: ['KeyP'], manualKey: true, onEscape: resume
    });
  }

  function resume() {
    if (state !== 'paused' && state !== 'dead') return;
    var wasDead = state === 'dead';
    if (wasDead) {
      Voxel.Player.respawn();
      if (Voxel.Progress) Voxel.Progress.track('respawn', {});
    }
    if (wasDead && Voxel.Environment && Voxel.Environment.status)
      syncEnvironmentHUD(Voxel.Environment.status(), true);
    closeModalLayer(wasDead ? 'overlay-dead' : 'overlay-pause', false);
    if (!wasDead && state === 'cockpit') {
      if (Voxel.HandItem && Voxel.HandItem.setVisible) Voxel.HandItem.setVisible(false);
      tryLock();
    }
    // 重生位置、已失效床位清理和恢复后的生命状态立即落盘。
    if (wasDead) doSave(true, 'respawn');
  }

  // 存档并回到主菜单
  function gotoMenu() {
    if (state !== 'paused') return false;
    // 返回菜单是破坏当前内存会话的边界：只有已验证写入成功才允许越过。
    if (!doSave(true, 'menu')) {
      Voxel.HUD.toast('无法返回主菜单 · 当前进度尚未安全存档');
      announcePauseSaveFeedback(saveConflict
        ? '检测到其他页面更新，必须先点击“确认覆盖并存档”。'
        : '返回主菜单前写入失败，已安全停留在当前会话。');
      var retry = document.getElementById('btn-save');
      if (retry && retry.focus) retry.focus({ preventScroll: true });
      return false;
    }
    stopDig();
    manualCraftStop();
    if (Voxel.Sound && Voxel.Sound.stopEnvironment) Voxel.Sound.stopEnvironment();
    document.getElementById('overlay-pause').classList.add('hidden');
    syncMainMenu();
    showOverlay('overlay-start');
    setState('menu');
    return true;
  }

  function openStarMap() {
    if (state !== 'playing' && state !== 'cockpit') return false;
    var returnState = state;
    if (!Voxel.SpaceTravel || !Voxel.SpaceTravel.canOpenMap()) {
      Voxel.HUD.toast('需要靠近飞船，或在空间站航行终端内使用星图');
      return false;
    }
    selectedTravelId = null;
    Voxel.SpaceTravel.refreshMap();
    if (Voxel.SpaceTravel.setSelectedDestination) Voxel.SpaceTravel.setSelectedDestination(null);
    var opened = openModalLayer({
      id: 'overlay-starmap', state: 'starmap', returnState: returnState,
      initialFocus: function () {
        return document.querySelector('#starmap-grid .star-card:not(:disabled)') || document.getElementById('btn-starmap-close');
      },
      closeKeys: ['KeyH', 'KeyE'], onEscape: closeStarMap
    });
    return !!opened;
  }

  function boardShip() {
    if (state !== 'playing' || !(Voxel.SpaceTravel && Voxel.SpaceTravel.boardShip && Voxel.SpaceTravel.boardShip())) {
      Voxel.HUD.toast('需要靠近飞船舱门才能登舰');
      return false;
    }
    stopDig();
    mouseDown[0] = mouseDown[1] = mouseDown[2] = false;
    Voxel.Controls.setYaw(0);
    Voxel.Controls.setPitch(0);
    if (Voxel.Player.setFlying) Voxel.Player.setFlying(false);
    if (Voxel.HandItem && Voxel.HandItem.setVisible) Voxel.HandItem.setVisible(false);
    setState('cockpit');
    if (Voxel.Progress) Voxel.Progress.track('board', {});
    // 物理键盘的登舰 keydown 会在状态切换后继续保持；先等这次按键释放，
    // 避免下一物理帧把同一次 E 当作座舱内离舰/长按手势。
    cockpitKeyE.t = 0;
    cockpitKeyE.fired = false;
    cockpitKeyE.waitRelease = !!Voxel.Controls.keys.KeyE;
    syncModalAccessibility();
    tryLock();
    Voxel.HUD.toast('座舱密封完成 · W/S推进制动 · 鼠标转向 · H星图 · 长按E自动着陆 · E离舰');
    return true;
  }

  function exitCockpit() {
    if (state !== 'cockpit' || !(Voxel.SpaceTravel && Voxel.SpaceTravel.isAboard && Voxel.SpaceTravel.isAboard()))
      return false;
    var exit = Voxel.SpaceTravel.safeExitPosition && Voxel.SpaceTravel.safeExitPosition();
    if (!exit) {
      Voxel.HUD.toast('无法离舰 · 请先在干燥平整地面安全着陆');
      return false;
    }
    var flight = Voxel.SpaceTravel.flightSnapshot ? Voxel.SpaceTravel.flightSnapshot() : null;
    ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'].forEach(function (code) {
      Voxel.Controls.keys[code] = false;
    });
    Voxel.SpaceTravel.disembarkShip();
    Voxel.Player.pos().copy(exit);
    Voxel.Player.vel().set(0, 0, 0);
    if (Voxel.Player.setFlying) Voxel.Player.setFlying(false);
    Voxel.Controls.setYaw(flight && isFinite(flight.yaw) ? flight.yaw : 0);
    Voxel.Controls.setPitch(-0.12);
    if (Voxel.HandItem && Voxel.HandItem.setVisible) Voxel.HandItem.setVisible(true);
    setState('playing');
    syncModalAccessibility();
    tryLock();
    Voxel.HUD.toast('已离舰 · 外界环境暴露重新启用');
    return true;
  }

  // ---------- 着陆辅助：长按 E 自动着陆，轻按 E 离舰 ----------

  var cockpitKeyE = { t: 0, fired: false, waitRelease: false };
  var assistWatch = { active: false };

  function landingAssistHoldSeconds() {
    var raw = Voxel.Config && Voxel.Config.SHIP_FLIGHT || {};
    var ms = +raw.LANDING_ASSIST_HOLD_MS;
    return isFinite(ms) && ms > 0 ? ms / 1000 : 0.6;
  }

  function attemptLandingAssist() {
    if (!(Voxel.SpaceTravel && Voxel.SpaceTravel.engageLandingAssist)) return;
    var res = Voxel.SpaceTravel.engageLandingAssist();
    if (res.ok) {
      Voxel.HUD.toast('着陆辅助启动 · 自动寻找合适着陆点');
      return;
    }
    if (res.reason === 'high') {
      var cap = Voxel.Config && Voxel.Config.SHIP_FLIGHT ? Voxel.Config.SHIP_FLIGHT.LANDING_ASSIST_MAX_ALT : 24;
      Voxel.HUD.toast('高度过高 · 相对地面低于 ' + Math.round(cap) + 'm 才能启动着陆辅助');
    } else if (res.reason === 'nospot') {
      Voxel.HUD.toast('附近没有合适着陆点 · 请移动后重试');
    }
  }

  function tickCockpitKeyE(step) {
    var held = !!(state === 'cockpit' && Voxel.Controls.keys.KeyE);
    if (cockpitKeyE.waitRelease) {
      if (!held) cockpitKeyE.waitRelease = false;
      cockpitKeyE.t = 0;
      cockpitKeyE.fired = false;
      return;
    }
    if (!held) {
      if (cockpitKeyE.t > 0 && !cockpitKeyE.fired) exitCockpit();
      cockpitKeyE.t = 0;
      cockpitKeyE.fired = false;
      return;
    }
    var pressEdge = cockpitKeyE.t <= 0;
    cockpitKeyE.t += step;
    if (pressEdge) {
      // 已着陆时保持旧语义：按下立即离舰。
      var snap = Voxel.SpaceTravel && Voxel.SpaceTravel.flightSnapshot
        ? Voxel.SpaceTravel.flightSnapshot() : null;
      if (snap && snap.landed) {
        cockpitKeyE.fired = true;
        exitCockpit();
        return;
      }
    }
    if (!cockpitKeyE.fired && cockpitKeyE.t >= landingAssistHoldSeconds()) {
      cockpitKeyE.fired = true;
      attemptLandingAssist();
    }
  }

  function pollLandingAssist() {
    if (!(Voxel.SpaceTravel && Voxel.SpaceTravel.landingAssistInfo)) return;
    var info = Voxel.SpaceTravel.landingAssistInfo();
    var wasActive = assistWatch.active;
    assistWatch.active = info.active;
    if (!wasActive || info.active) return;
    if (info.lastResult === 'completed') Voxel.HUD.toast('自动着陆完成 · 按 E 离舰');
    else if (info.lastResult === 'cancelled') Voxel.HUD.toast('着陆辅助已解除 · 手动控制');
    else if (info.lastResult === 'expired' || info.lastResult === 'blocked')
      Voxel.HUD.toast('着陆辅助中断 · 请手动着陆');
  }

  // ---------- 星海嘉年华 · 长按乘坐（对齐 cockpitKeyE 三件套语义） ----------

  var ride = {
    pending: false,        // KeyE 已按下但尚未判定（附近有乘坐台时抑制背包）
    holdT: 0, fired: false,
    prevHeld: false,
    waitRelease: false,    // 刚上车：先松开 E，之后轻按才下车
    board: null,           // 上车点（下车落回用）
    lookYaw: 0, lookPitch: 0
  };

  function rideHoldSeconds() {
    return ((CFG.RIDE && CFG.RIDE.HOLD_MS) || 600) / 1000;
  }
  function rideRadius() { return (CFG.RIDE && CFG.RIDE.RADIUS) || 5.5; }

  function nearRideBoard() {
    if (!Voxel.Amusement || !Voxel.Amusement.nearestBoard) return null;
    return Voxel.Amusement.nearestBoard(Voxel.Player.pos(), rideRadius());
  }

  function tickRideHold(step) {
    // 仅在 playing 态轮询（长按上车）；riding 态的轻按下车在 riderFixedUpdate 处理
    var held = !!Voxel.Controls.keys.KeyE;
    if (!ride.pending) { ride.prevHeld = held; return; }
    if (ride.prevHeld && !held) {
      // 提前松开（未达长按阈值）：只取消计时；站在台旁时不开背包
      ride.pending = false;
      ride.holdT = 0; ride.fired = false;
      return;
    }
    ride.prevHeld = held;
    if (!held) return;
    ride.holdT += step;
    if (!ride.fired && ride.holdT >= rideHoldSeconds()) {
      ride.fired = true;
      var nb = nearRideBoard();
      ride.pending = false; ride.holdT = 0;
      if (nb) boardRide(nb);
    }
  }

  function boardRide(nb) {
    if (!Voxel.Amusement || state !== 'playing') return;
    ride.board = nb;
    Voxel.Player.setFlying(false);
    stopDig();
    if (mouseDown[0] || mouseDown[2]) { mouseDown[0] = false; mouseDown[2] = false; }
    ride.lookYaw = 0; ride.lookPitch = 0;
    if (Voxel.HandItem && Voxel.HandItem.setVisible) Voxel.HandItem.setVisible(false);
    if (Voxel.Amusement.beginRide(nb.kind, performance.now() / 1000)) {
      setState('riding');
      ride.waitRelease = true;   // 先松开当前按住的 E，之后轻按才下车（对齐座舱语义）
      tryLock();
      Voxel.HUD.toast('长按 E 乘坐 · ' + nb.name + '（提示已上车，轻按 E 下车）');
      Voxel.Progress.track('ride', { kind: nb.kind });
      Voxel.Sound.select();
    } else {
      Voxel.HUD.toast('设施暂时无法乘坐');
    }
  }

  function exitRide() {
    if (state !== 'riding') return;
    var b = ride.board || nearRideBoard();
    if (b && Voxel.Player.canStandAt) {
      var cands = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
      for (var i = 0; i < cands.length; i++) {
        var sxp = b.x + 0.5 + cands[i][0], szp = b.z + 0.5 + cands[i][1];
        var stand = new THREE.Vector3(sxp, b.y + 1.05, szp);
        if (Voxel.Player.canStandAt(stand, true)) {
          Voxel.Player.init(stand, Voxel.Controls.yaw(), 0);
          break;
        }
      }
    }
    ride.board = null;
    ride.fired = false; ride.holdT = 0; ride.prevHeld = false;
    ride.waitRelease = false;
    if (Voxel.Amusement) Voxel.Amusement.endRide();
    setState('playing');
    Voxel.Sound.select();
  }

  // riding 态固定步：waitRelease 期间忽略按住；之后轻按（释放沿）=下车。
  var _rideProxy = new THREE.Vector3();
  function riderFixedUpdate(step) {
    var held = !!Voxel.Controls.keys.KeyE;
    if (ride.waitRelease) {
      if (!held) ride.waitRelease = false;
      ride.prevHeld = held;
    } else if (ride.prevHeld && !held) {
      exitRide();
      ride.prevHeld = held;
    } else ride.prevHeld = held;
    var nowS = performance.now() / 1000;
    var pose = Voxel.Amusement ? Voxel.Amusement.riderState(nowS) : null;
    if (pose) {
      _rideProxy.set(pose.pos.x, pose.pos.y - C.EYE, pose.pos.z);
      if (Voxel.Player.updateBoarded)
        Voxel.Player.updateBoarded(step, _rideProxy, null);
    }
    tickEnvironment(step);
    if (!currentWorld || currentWorld.kind !== 'station') Voxel.Mobs.update(step);
    Voxel.Drops.update(step, { allowPickup: false });
    updateFallers(step);
    Voxel.Controls.setYaw(Voxel.Controls.yaw() * 0.86);
    Voxel.Controls.setPitch(Voxel.Controls.pitch() * 0.86);
  }

  // riding 态每帧：相机接管（基向位姿 + ±60° 自由环视，缓回中）
  function applyRideCamera(dt) {
    if (!camera) return;
    var nowS = performance.now() / 1000;
    var pose = Voxel.Amusement ? Voxel.Amusement.riderState(nowS) : null;
    if (!pose) return;
    var sens = 0.0026;
    ride.lookYaw += (Voxel.Controls._rideMouseDX || 0) * sens;
    ride.lookPitch += (Voxel.Controls._rideMouseDY || 0) * sens;
    Voxel.Controls._rideMouseDX = 0; Voxel.Controls._rideMouseDY = 0;
    var LIM = Math.PI / 3;
    ride.lookYaw = Math.max(-LIM, Math.min(LIM, ride.lookYaw));
    ride.lookPitch = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, ride.lookPitch));
    ride.lookYaw *= 0.985; ride.lookPitch *= 0.985;
    camera.position.copy(pose.pos);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = pose.yaw + ride.lookYaw;
    camera.rotation.x = Math.max(-1.45, Math.min(1.45, pose.pitch + ride.lookPitch));
    camera.rotation.z = 0;
  }

  // 乘坐浮钮（触屏）：近台显示"乘坐"，乘车中变"下车"
  function ensureRideButton(isTouch) {
    var btn = document.getElementById('ride-btn');
    var nb = isTouch && state === 'playing' ? nearRideBoard() : null;
    var showBtn = isTouch && (nb || state === 'riding');
    if (!showBtn) {
      if (btn) btn.style.display = 'none';
      return;
    }
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'ride-btn';
      btn.setAttribute('aria-label', '乘坐设施');
      document.body.appendChild(btn);
      var _t0 = 0, firedLong = false;
      btn.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        _t0 = performance.now(); firedLong = false;
        if (state !== 'riding') {
          Voxel.Controls.keys.KeyE = true;
          ride.pending = true; ride.holdT = 0; ride.fired = false;
        }
      });
      var release = function (e) {
        e.preventDefault();
        Voxel.Controls.keys.KeyE = false;
        if (state === 'riding') exitRide();
        else if (performance.now() - _t0 < rideHoldSeconds() * 1000) {
          // 短点未达阈值：还原为无操作（避免误开背包）
          ride.pending = false; ride.holdT = 0;
        }
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('pointercancel', release);
    }
    btn.textContent = state === 'riding' ? '下车' : '乘坐';
    btn.style.display = 'flex';
  }

  function showRideHint(isTouch) {
    var hitEl = document.getElementById('use-hint');
    if (!hitEl) return;
    hitEl.textContent = isTouch ? '轻点「下车」离开设施' : '轻按 E 下车 · 环顾四周可自由观看';
    hitEl.dataset.kind = 'ride';
    hitEl.style.display = 'block';
  }


  function closeStarMap() {
    if (state !== 'starmap') return false;
    selectedTravelId = null;
    var closed = closeModalLayer('overlay-starmap', false);
    if (closed && state === 'cockpit') {
      if (Voxel.HandItem && Voxel.HandItem.setVisible) Voxel.HandItem.setVisible(false);
      tryLock();
    }
    return closed;
  }

  function selectTravelDestination(destinationId) {
    if (state !== 'starmap' || pendingTravel) return false;
    var dest = Voxel.Galaxy.find(galaxyState, destinationId);
    if (!dest || !currentWorld || dest.id === currentWorld.id) return false;
    selectedTravelId = dest.id;
    if (Voxel.SpaceTravel && Voxel.SpaceTravel.setSelectedDestination)
      Voxel.SpaceTravel.setSelectedDestination(dest.id);
    return true;
  }

  // 星图面板的「恒星系/银河」标签页与银河视窗平移按钮（DOM 在 index.html）。
  function bindStarmapTabs() {
    var tabs = document.querySelectorAll('.starmap-tab');
    for (var i = 0; i < tabs.length; i++) {
      (function (tab) {
        tab.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          var mode = tab.getAttribute('data-mode');
          if (state === 'starmap' && Voxel.SpaceTravel && Voxel.SpaceTravel.setMapMode)
            Voxel.SpaceTravel.setMapMode(mode);
        });
      })(tabs[i]);
    }
    function bindPan(id, dg, ds) {
      var btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (state === 'starmap' && Voxel.SpaceTravel && Voxel.SpaceTravel.panGalaxyView)
          Voxel.SpaceTravel.panGalaxyView(dg, ds);
      });
    }
    bindPan('galaxy-pan-up', -GALAXY_PAN, 0);
    bindPan('galaxy-pan-down', GALAXY_PAN, 0);
    bindPan('galaxy-pan-left', 0, -GALAXY_PAN);
    bindPan('galaxy-pan-right', 0, GALAXY_PAN);
    var home = document.getElementById('galaxy-home');
    if (home) home.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (state === 'starmap' && Voxel.SpaceTravel && Voxel.SpaceTravel.homeGalaxyView)
        Voxel.SpaceTravel.homeGalaxyView();
    });
  }
  var GALAXY_PAN = 4;

  function igniteSelectedTravel() {
    if (state !== 'starmap' || !selectedTravelId) return false;
    return requestTravel(selectedTravelId, 'ship');
  }

  // ---------- 主动扫描、发现档案与探索目标 ----------

  function setActiveScanUI(mode, statusText, resultText, percent) {
    var root = document.getElementById('scan-active-controls');
    var button = document.getElementById('btn-scan-hud');
    var statusEl = document.getElementById('scan-active-status');
    var resultEl = document.getElementById('scan-result');
    var progress = document.getElementById('scan-progress');
    percent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (root) root.setAttribute('data-state', mode || 'idle');
    if (button) {
      button.disabled = mode === 'sweeping' || mode === 'cooldown';
      button.setAttribute('aria-pressed', mode === 'sweeping' ? 'true' : 'false');
      button.classList.toggle('scanning', mode === 'sweeping');
    }
    document.body.classList.toggle('scan-scanning', mode === 'sweeping');
    if (statusEl && statusText !== undefined && statusEl.textContent !== statusText)
      statusEl.textContent = statusText;
    if (resultEl && resultText !== undefined && resultEl.textContent !== resultText)
      resultEl.textContent = resultText;
    if (progress) {
      progress.setAttribute('aria-valuenow', String(percent));
      var fill = progress.querySelector('i');
      if (fill) fill.style.width = percent + '%';
    }
  }

  function discoveryState() {
    if (!galaxyState || !Voxel.Discovery) return null;
    galaxyState.discovery = Voxel.Discovery.hydrate(galaxyState.discovery, galaxyState.catalog);
    return galaxyState.discovery;
  }

  function refreshDiscoveryUI() {
    var stateData = discoveryState();
    if (!stateData || !currentWorld) return;
    var summary = Voxel.Discovery.summary(stateData, galaxyState.catalog);
    var objective = Voxel.Discovery.objective(stateData, currentWorld, galaxyState.catalog);
    var values = {
      'discovery-points': summary.points,
      'discovery-worlds': summary.surveyedWorlds,
      'discovery-biomes': summary.biomes,
      'discovery-resources': summary.resources,
      'discovery-fauna': summary.fauna,
      'discovery-goal-title': objective.label,
      'discovery-goal-progress': objective.current + ' / ' + objective.target
    };
    for (var id in values) {
      var el = document.getElementById(id);
      if (el) el.textContent = String(values[id]);
    }
    var reward = document.getElementById('discovery-reward');
    if (reward) reward.textContent = objective.complete
      ? '本星系初步勘探已经完成；继续扫描仍会记录新的档案条目。'
      : '完成目标可获得 ' + objective.pointsReward + ' 探索点与 ' + objective.fuelReward + '% 跃迁能量。';

    var list = document.getElementById('discovery-world-list');
    if (!list) return;
    list.innerHTML = '';
    for (var i = 0; i < galaxyState.catalog.length; i++) {
      var world = galaxyState.catalog[i];
      var ws = Voxel.Discovery.worldSummary(stateData, world.id);
      var card = document.createElement('article');
      card.className = 'discovery-world-card' + (world.id === currentWorld.id ? ' current' : '') +
        (ws.surveyed ? ' surveyed' : '');
      card.setAttribute('data-world-id', world.id);
      var head = document.createElement('div');
      head.className = 'discovery-world-head';
      var name = document.createElement('strong');
      name.textContent = world.icon + ' ' + world.name;
      var stateLabel = document.createElement('span');
      stateLabel.textContent = ws.surveyed ? '已测绘' :
        (galaxyState.discovered[world.id] ? '已抵达 · 未测绘' : '尚未抵达');
      head.appendChild(name); head.appendChild(stateLabel);
      var detail = document.createElement('div');
      detail.className = 'discovery-world-detail';
      detail.textContent = '群系 ' + ws.counts.biomes + ' · 资源 ' + ws.counts.resources +
        ' · 生命 ' + ws.counts.fauna + ' · 地标 ' + ws.counts.landmarks;
      card.appendChild(head); card.appendChild(detail); list.appendChild(card);
    }
  }

  function cancelActiveScan(announce) {
    if (!activeScan) return false;
    activeScan = null;
    if (announce) setActiveScanUI('idle', '主动扫描已取消', '返回世界后可重新发射扫描脉冲', 0);
    else setActiveScanUI('idle', '主动扫描待机', '扫描已中断；返回世界后可重新发射', 0);
    return true;
  }

  function startActiveScan() {
    if (state !== 'playing' || !currentWorld || !galaxyState || !Voxel.Discovery) return false;
    if (activeScan) return false;
    if (scanCooldownT > 0) {
      setActiveScanUI('cooldown', '扫描阵列冷却中', '冷却完成后可再次扫描', 100);
      return false;
    }
    activeScan = { elapsed: 0, duration: 0.8 };
    setActiveScanUI('sweeping', '扫描脉冲扩展中', '正在重新采样当前视野与周边环境…', 0);
    if (Voxel.Sound && Voxel.Sound.select) Voxel.Sound.select();
    return true;
  }

  function scanPosition(v) {
    return [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0];
  }

  function completeActiveScan() {
    activeScan = null;
    if (state !== 'playing' || !currentWorld || !galaxyState || !Voxel.Discovery) {
      setActiveScanUI('idle', '扫描中断', '当前状态无法写入发现档案', 0);
      return false;
    }
    var playerPos = Voxel.Player.pos();
    var events = [{ worldId: currentWorld.id, kind: 'survey', key: 'world', pos: scanPosition(playerPos) }];
    var analysisNote = '';
    if (currentWorld.kind === 'planet') {
      var biome = Voxel.World.biomeAt(Math.floor(playerPos.x), Math.floor(playerPos.z));
      events.push({ worldId: currentWorld.id, kind: 'biome', key: biome, pos: scanPosition(playerPos) });
      var hit = Voxel.Raycaster.cast(Voxel.Player.eyePos(), aimDir(), C.REACH);
      if (hit && hit.type === 'mob') {
        events.push({ worldId: currentWorld.id, kind: 'fauna', key: hit.mob && hit.mob.type,
          pos: hit.mob && hit.mob.pos ? scanPosition(hit.mob.pos) : scanPosition(playerPos) });
      } else if (hit && hit.type === 'block') {
        if (Voxel.Blocks.isScannableResource(hit.id) &&
          !(Voxel.World.isEdited && Voxel.World.isEdited(hit.x, hit.y, hit.z))) {
          events.push({ worldId: currentWorld.id, kind: 'resource', key: hit.id,
            pos: [hit.x, hit.y, hit.z] });
        } else if (Voxel.Blocks.isScannableResource(hit.id)) {
          analysisNote = ' · 玩家改动方块不计入自然资源档案';
        } else {
          analysisNote = ' · ' + Voxel.Blocks.name(hit.id) + ' 已分析（非自然资源样本）';
        }
      }
    }
    var landmark = Voxel.SpaceTravel && Voxel.SpaceTravel.scanLandmark
      ? Voxel.SpaceTravel.scanLandmark() : null;
    if (landmark) events.push({ worldId: currentWorld.id, kind: 'landmark', key: landmark.kind,
      pos: scanPosition(playerPos) });

    var bearing = Voxel.SpaceTravel && Voxel.SpaceTravel.shipBearing
      ? Voxel.SpaceTravel.shipBearing() : null;
    var bearingNote = bearing ? ' · 飞船位于' + bearing.text : '';

    var oldDiscovery = galaxyState.discovery;
    var oldFuel = galaxyState.ship.fuel;
    var next = oldDiscovery;
    var addedEntries = [], pointsAwarded = 0, fuelAwarded = 0, rewards = [];
    for (var i = 0; i < events.length; i++) {
      var recorded = Voxel.Discovery.record(next, events[i], galaxyState.catalog);
      next = recorded.state;
      if (!recorded.added) continue;
      addedEntries = addedEntries.concat(recorded.entries);
      pointsAwarded += recorded.pointsAwarded;
      fuelAwarded += recorded.fuelAwarded;
      rewards = rewards.concat(recorded.objectiveRewards);
    }

    scanCooldownT = 1.2;
    scanResultT = 10;
    if (!addedEntries.length) {
      setActiveScanUI('cooldown', '扫描完成 · 无新档案', '当前环境与目标均已编录' + bearingNote + analysisNote, 100);
      return false;
    }

    galaxyState.discovery = next;
    galaxyState.ship.fuel = Math.min(galaxyState.ship.maxFuel, oldFuel + fuelAwarded);
    var actualFuelAwarded = galaxyState.ship.fuel - oldFuel;
    if (!doSave(true, 'discovery')) {
      galaxyState.discovery = oldDiscovery;
      galaxyState.ship.fuel = oldFuel;
      setActiveScanUI('cooldown', '扫描写入失败', '档案与奖励已回滚，请检查浏览器存储空间', 100);
      return false;
    }

    var labels = [];
    for (var j = 0; j < addedEntries.length; j++) labels.push(Voxel.Discovery.label(addedEntries[j]));
    var rewardText = '新增 ' + addedEntries.length + ' 项：' + labels.join('、') +
      ' · +' + pointsAwarded + ' 探索点' + (actualFuelAwarded > 0
        ? ' · +' + actualFuelAwarded + '% 跃迁能量'
        : (fuelAwarded > 0 ? ' · 跃迁能量已满' : ''));
    setActiveScanUI('cooldown', rewards.length ? '探索目标完成' : '扫描档案已写入', rewardText + bearingNote + analysisNote, 100);
    Voxel.HUD.toast(rewardText);
    if (Voxel.Progress) Voxel.Progress.track('scan', { added: addedEntries.length });
    refreshDiscoveryUI();
    return true;
  }

  function tickActiveScan(dt) {
    if (scanCooldownT > 0) {
      scanCooldownT = Math.max(0, scanCooldownT - dt);
      if (scanCooldownT === 0 && !activeScan)
        setActiveScanUI(scanResultT > 0 ? 'result' : 'idle', '主动扫描就绪', undefined, 0);
    }
    if (scanResultT > 0) {
      scanResultT = Math.max(0, scanResultT - dt);
      if (scanResultT === 0 && !activeScan && scanCooldownT === 0)
        setActiveScanUI('idle', '主动扫描待机', '按 G 或触摸“扫描”发射探索脉冲', 0);
    }
    if (!activeScan) return;
    activeScan.elapsed += dt;
    var progress = Math.min(100, activeScan.elapsed / activeScan.duration * 100);
    setActiveScanUI('sweeping', undefined, undefined, progress);
    if (activeScan.elapsed + 1e-9 >= activeScan.duration) completeActiveScan();
  }

  function openDiscoveryLog(trigger) {
    if (state !== 'playing') return false;
    refreshDiscoveryUI();
    return !!openModalLayer({
      id: 'overlay-discovery', state: 'discovery', returnState: 'playing', trigger: trigger,
      initialFocus: '#btn-discovery-close', closeKeys: ['KeyG'],
      onEscape: function () { closeDiscoveryLog(); }
    });
  }

  function closeDiscoveryLog() {
    if (state !== 'discovery') return false;
    return closeModalLayer('overlay-discovery', true);
  }

  // ---------- 成就 / 图鉴 / 教程面板 ----------
  function openAchievements() {
    if (state !== 'playing' && state !== 'paused' && state !== 'cockpit') return false;
    var returnState = state;
    var opened = openModalLayer({
      id: 'overlay-achievements', state: 'achievements', returnState: returnState,
      initialFocus: '#btn-ach-close', closeKeys: ['KeyJ', 'KeyE'],
      onEscape: closeAchievements
    });
    if (opened && Voxel.Achievements) Voxel.Achievements.refreshPanel();
    return !!opened;
  }

  function closeAchievements() {
    if (state !== 'achievements') return false;
    return closeModalLayer('overlay-achievements', true);
  }

  function openCodex() {
    if (state !== 'playing' && state !== 'paused' && state !== 'cockpit') return false;
    var returnState = state;
    var opened = openModalLayer({
      id: 'overlay-codex', state: 'codex', returnState: returnState,
      initialFocus: '#btn-codex-close', closeKeys: ['KeyB', 'KeyE'],
      onEscape: closeCodex
    });
    if (opened && Voxel.Codex) Voxel.Codex.refresh();
    return !!opened;
  }

  function closeCodex() {
    if (state !== 'codex') return false;
    return closeModalLayer('overlay-codex', true);
  }

  function restartTutorialFromUI() {
    if (!Voxel.Tutorial) return false;
    Voxel.Tutorial.restart();
    Voxel.HUD.toast('新手教程已重新开启，跟着左上角任务卡行动吧');
    return true;
  }

  function flightReducedMotion() {
    try { return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  function flightSequenceSnapshot(tx) {
    return tx && tx.sequence && tx.sequence.snapshot ? tx.sequence.snapshot() : null;
  }

  function syncFlightVisual(tx, loadingProgress) {
    if (!tx) return;
    var snap = flightSequenceSnapshot(tx);
    if (!snap) return;
    var p = 0;
    if (snap.phase === 'ignition') p = snap.duration ? snap.elapsed / snap.duration * 20 : 0;
    else if (snap.phase === 'warp') p = 20 + (snap.duration ? snap.elapsed / snap.duration * 50 : 0);
    else if (snap.phase === 'target_loading') p = 70 + Math.max(0, Math.min(1,
      typeof loadingProgress === 'number' ? loadingProgress : 0)) * 20;
    else if (snap.phase === 'target_ready' || snap.phase === 'committing') p = 91;
    else if (snap.phase === 'committed') p = 93;
    else if (snap.phase === 'arrival') p = 93 + (snap.duration ? snap.elapsed / snap.duration * 7 : 0);
    else if (snap.phase === 'cockpit_arrived' || snap.phase === 'complete') p = 100;
    if (Voxel.SpaceTravel && Voxel.SpaceTravel.setFlightPhase)
      Voxel.SpaceTravel.setFlightPhase(snap.phase, Math.max(0, Math.min(100, p)), tx);
  }

  function acceptFlightEvent(tx, name) {
    if (!tx || pendingTravel !== tx || !tx.sequence || !tx.sequence.event) return null;
    var result = tx.sequence.event(name, tx.serial);
    tx.sequence = result.state;
    tx.phase = tx.sequence.phase;
    syncFlightVisual(tx);
    return result;
  }

  function abortTravel(tx, reason, error) {
    if (!tx || pendingTravel !== tx) return false;
    var sourceSave = tx.sourceSave;
    try {
      if (tx.sequence && tx.sequence.abort) tx.sequence = tx.sequence.abort(reason, tx.serial).state;
    } catch (sequenceError) { console.error('飞行序列中止标记失败', sequenceError); }
    tx.phase = 'aborted';
    if (error) console.error('星际旅行失败', error);
    // 先撤销事务所有权，再做任何非关键表现清理；即使音频/DOM自身异常，
    // 已验证来源的恢复路径也不能被截断而把页面软锁在目标内存态。
    pendingTravel = null;
    travelStats = null;
    selectedTravelId = null;
    travelRecoveryNotice = '跃迁未提交：' + (reason || '未知错误') + ' · 已返回出发天体';
    travelRollbackHealthPending = !saveConflict;
    try { if (Voxel.Sound && Voxel.Sound.warpEnd) Voxel.Sound.warpEnd(false); }
    catch (soundError) { console.error('中止音频清理失败', soundError); }
    try { if (Voxel.SpaceTravel && Voxel.SpaceTravel.hideWarp) Voxel.SpaceTravel.hideWarp(); }
    catch (warpError) { console.error('中止驾驶舱清理失败', warpError); }
    try { if (Voxel.SpaceTravel && Voxel.SpaceTravel.hideArrival) Voxel.SpaceTravel.hideArrival(); }
    catch (arrivalError) { console.error('中止抵达卡清理失败', arrivalError); }
    try {
      ensureGalaxy(sourceSave && sourceSave.galaxy && sourceSave.galaxy.rootSeed ||
        (sourceSave && sourceSave.seed), sourceSave && sourceSave.galaxy);
      galaxyState.currentId = tx.fromId;
      currentWorld = Voxel.Galaxy.find(galaxyState, tx.fromId) || galaxyState.catalog[0];
      startWorld(sourceSave.seed, sourceSave, null, currentWorld.id);
    } catch (restoreError) {
      console.error('来源世界自动恢复失败', restoreError);
      // 该通知只属于本次自动恢复；若恢复本身未能启动，不能泄漏到随后
      // 玩家主动创建/选择的另一个世界并让其跳过首次提交。
      travelRecoveryNotice = '';
      travelRollbackHealthPending = false;
      syncMainMenu('跃迁失败；已验证的出发存档仍安全，请点“继续游戏”恢复。', true);
      showOverlay('overlay-start');
      setState('menu');
    }
    return true;
  }

  function beginTargetLoad(tx) {
    if (!tx || pendingTravel !== tx || tx.phase !== 'target_loading') return false;
    tx.phase = 'target_loading';
    if (Voxel.Sound && Voxel.Sound.warpPhase) Voxel.Sound.warpPhase(tx.mode, 'target_loading');
    if (Voxel.SpaceTravel && Voxel.SpaceTravel.announceTravel)
      Voxel.SpaceTravel.announceTravel('已进入目标星域，正在构建 ' + tx.to.name + '。');
    try {
      if (tx.mode === 'jump') {
        // 跨恒星系：先切换系统（目录/档案桶轮换），再消耗曲速电池。
        Voxel.Galaxy.switchSystem(galaxyState, tx.toG, tx.toS, tx.toId);
        galaxyState.ship.warpCells = Math.max(0,
          (galaxyState.ship.warpCells | 0) - (tx.cost | 0));
      } else {
        galaxyState.ship.fuel = Math.max(0, tx.fuelBefore - tx.cost);
        galaxyState.discovered[tx.toId] = true;
      }
      galaxyState.currentId = tx.toId;
      startWorld(tx.to.seed, tx.transit, null, tx.toId);
      return true;
    } catch (e) {
      return abortTravel(tx, '目标世界初始化失败', e);
    }
  }

  function processFlightEvents(tx, events) {
    if (!tx || pendingTravel !== tx || !Array.isArray(events)) return;
    for (var i = 0; i < events.length && pendingTravel === tx; i++) {
      if (events[i] === 'begin_warp') {
        tx.phase = 'warp';
        if (Voxel.Sound && Voxel.Sound.warpPhase) Voxel.Sound.warpPhase(tx.mode, 'warp');
      } else if (events[i] === 'load_target') {
        tx.phase = 'target_loading';
        beginTargetLoad(tx);
      } else if (events[i] === 'arrival_ready') {
        tx.phase = 'cockpit_arrived';
        if (Voxel.Sound && Voxel.Sound.warpArrive) Voxel.Sound.warpArrive(tx.mode);
        if (Voxel.SpaceTravel && Voxel.SpaceTravel.setDisembarkReady)
          Voxel.SpaceTravel.setDisembarkReady(tx.mode === 'ship' || tx.mode === 'jump');
        if (tx.mode === 'ship' || tx.mode === 'jump') {
          Voxel.HUD.toast('抵达 ' + tx.to.name + ' · 按 E 或点「下船」离舰');
          setTimeout(function () {
            if (pendingTravel !== tx || tx.sequence.phase !== 'cockpit_arrived') return;
            var disembarkBtn = document.getElementById('btn-disembark');
            if (disembarkBtn && !disembarkBtn.disabled && disembarkBtn.focus)
              disembarkBtn.focus({ preventScroll: true });
          }, 0);
        }
      } else if (events[i] === 'auto_complete') {
        var autoResult = acceptFlightEvent(tx, 'auto_complete');
        if (autoResult && autoResult.events.indexOf('complete') >= 0) finishTravel(tx);
      }
    }
    syncFlightVisual(tx);
  }

  function tickFlight(dt) {
    var tx = pendingTravel;
    if (!tx || !tx.sequence || !tx.sequence.update) return;
    // 跃迁/抵达期间主动隐藏地表交互提示：残留的「按 E 登舰避难」会误导
    // 玩家在离舰时刻按错预期（updateHighlight 只在 playing 帧运行）。
    var hintEl = document.getElementById('use-hint');
    if (hintEl && hintEl.style.display !== 'none') {
      hintEl.style.display = 'none';
      hintEl.removeAttribute('data-kind');
    }
    if (tx.sequence.phase === 'target_loading') {
      syncFlightVisual(tx, Voxel.World && Voxel.World.progress ? Voxel.World.progress() : 0);
      return;
    }
    if (state !== 'warping' && state !== 'arriving') return;
    var result = tx.sequence.update(dt, tx.serial);
    tx.sequence = result.state;
    tx.phase = tx.sequence.phase;
    processFlightEvents(tx, result.events);
    syncFlightVisual(tx);
  }

  function skipFlightPresentation() {
    var tx = pendingTravel;
    if (!tx || state !== 'warping' || !tx.sequence ||
      (tx.sequence.phase !== 'ignition' && tx.sequence.phase !== 'warp')) return false;
    if (Voxel.Sound && Voxel.Sound.warpSkip) Voxel.Sound.warpSkip();
    if (Voxel.SpaceTravel && Voxel.SpaceTravel.setFlightSkipping) Voxel.SpaceTravel.setFlightSkipping(true);
    for (var i = 0; i < 3 && pendingTravel === tx &&
      (tx.sequence.phase === 'ignition' || tx.sequence.phase === 'warp'); i++) {
      var result = tx.sequence.update(i === 0 ? 10 : 0, tx.serial);
      tx.sequence = result.state;
      tx.phase = tx.sequence.phase;
      processFlightEvents(tx, result.events);
    }
    return true;
  }

  function settleCommittedTravel(tx, presentationSkipped) {
    pendingTravel = null;
    selectedTravelId = null;
    try { if (Voxel.Sound && Voxel.Sound.warpEnd) Voxel.Sound.warpEnd(true); }
    catch (soundError) { console.error('抵达音频收尾失败', soundError); }
    try { if (Voxel.SpaceTravel && Voxel.SpaceTravel.hideWarp) Voxel.SpaceTravel.hideWarp(); }
    catch (warpError) { console.error('驾驶舱退场失败', warpError); }
    setState('playing');
    // 成长系统：一次完整跃迁事务（跨系 / 传送门 / 系内飞船）
    if (Voxel.Progress) {
      if (tx.mode === 'jump') Voxel.Progress.track('jump', {});
      else if (tx.mode === 'portal') Voxel.Progress.track('portal', {});
      else Voxel.Progress.track('warp', {});
    }
    // 驾驶舱退场后，把同一抵达信息短暂交给世界 HUD。presentationOnly
    // 防止复用 ship/portal 样式时重新打开全屏跃迁层，silent 防止重复播报。
    try {
      if (Voxel.SpaceTravel && Voxel.SpaceTravel.showArrivalCard) {
        var firstVisit = tx.mode === 'jump'
          ? !!tx.jumpFirstVisit
          : !(tx.sourceSave.galaxy.discovered &&
            tx.sourceSave.galaxy.discovered[currentWorld.id]);
        Voxel.SpaceTravel.showArrivalCard(tx.from, currentWorld,
          tx.mode === 'jump' ? 'ship' : tx.mode, {
          firstVisit: firstVisit,
          refueled: currentWorld.kind === 'station',
          presentationOnly: true,
          silent: true
        });
      } else if (Voxel.SpaceTravel && Voxel.SpaceTravel.hideArrival) Voxel.SpaceTravel.hideArrival();
    } catch (arrivalError) {
      console.error('抵达卡展示失败', arrivalError);
      try { if (Voxel.SpaceTravel && Voxel.SpaceTravel.hideArrival) Voxel.SpaceTravel.hideArrival(); }
      catch (hideArrivalError) { console.error('抵达卡清理失败', hideArrivalError); }
    }
    syncModalAccessibility();
    if (canvas && canvas.focus) canvas.focus({ preventScroll: true });
    tryLock();
    if (presentationSkipped) Voxel.HUD.toast('已抵达目标；演出已安全跳过');
    return true;
  }

  function finishTravel(tx) {
    if (!tx || pendingTravel !== tx || !tx.sequence || tx.sequence.phase !== 'complete') return false;
    return settleCommittedTravel(tx, false);
  }

  function disembark() {
    var tx = pendingTravel;
    if (!tx || state !== 'arriving' || !tx.sequence || tx.sequence.phase !== 'cockpit_arrived' ||
      (tx.mode !== 'ship' && tx.mode !== 'jump')) return false;
    var result = acceptFlightEvent(tx, 'disembark');
    if (result && result.events.indexOf('complete') >= 0) return finishTravel(tx);
    return false;
  }

  function requestTravel(destinationId, mode, portalProof) {
    if ((state !== 'playing' && state !== 'cockpit' && state !== 'starmap') || pendingTravel) return false;
    var travelOriginState = state;
    mode = mode === 'portal' ? 'portal' : 'ship';
    var dest = Voxel.Galaxy.find(galaxyState, destinationId);
    if (!dest || !currentWorld || dest.id === currentWorld.id) return false;
    if (mode === 'ship' && currentWorld.kind === 'planet' &&
      !(Voxel.SpaceTravel && Voxel.SpaceTravel.isAboard && Voxel.SpaceTravel.isAboard())) {
      Voxel.HUD.toast('需要先登舰，才能启动飞船跃迁');
      return false;
    }
    if (mode === 'portal' && !(Voxel.SpaceTravel && Voxel.SpaceTravel.authorizePortalTravel &&
      Voxel.SpaceTravel.authorizePortalTravel(portalProof, dest.id))) {
      Voxel.HUD.toast('传送门旅行必须从当前世界的真实门径进入');
      return false;
    }
    var route = Voxel.Galaxy.routePlan
      ? Voxel.Galaxy.routePlan(galaxyState, currentWorld, dest, galaxyState.ship)
      : null;
    if (!route || !route.valid) {
      Voxel.HUD.toast('航线数据不可用，已取消旅行');
      return false;
    }
    if (mode === 'portal' && !route.directPortal) {
      Voxel.HUD.toast('当前世界没有直达该天体的物理传送门');
      return false;
    }
    var cost = mode === 'portal' ? 0 : route.costUnits;
    if (mode === 'ship' && !route.reachable) {
      Voxel.HUD.toast('跃迁能量不足：需要 ' + route.costUnits + '，当前 ' + route.fuel +
        '，还缺 ' + route.shortfall + '；请先前往空间站补给');
      return false;
    }

    // 先提交完全一致的源世界。跃迁动画/目标加载期间页面退出时，可靠回到源世界，
    // 不会写出“源世界 meta/edits + 目标 currentId”的混合存档。
    if (!doSave(true, 'travel-departure')) {
      Voxel.HUD.toast('保存源世界失败，已取消跃迁；请检查浏览器存储空间');
      return false;
    }

    var sourceSave = Voxel.Save.load();
    if (!sourceSave || !sourceSave.galaxy || sourceSave.galaxy.currentId !== currentWorld.id) {
      Voxel.HUD.toast('出发存档回读不一致，已取消跃迁');
      return false;
    }

    travelStats = { hp: Voxel.Player.hp(), food: Voxel.Player.food() };
    var snap = galaxyState.worlds[dest.id] || {};
    var transit = {
      seed: dest.seed,
      time: typeof snap.time === 'number' ? snap.time : 0.3,
      weather: snap.weather || 'clear',
      // 跨世界旅行与菜单“继续游戏”是不同语义：目标世界的旧位置可能在
      // 传送门触发体、水下、封闭 edits 或空间站真空中。旅行一律从目标
      // World.spawnPoint 安全泊位进入；旧位置仍保存在 galaxy.worlds 中，
      // 但不会作为 transit 玩家坐标复用。
      player: null,
      shipFlight: null,
      inv: inv.slice(), cnt: cnt.slice(), dur: dur.slice(),
      held: heldItem, heldCnt: heldCnt, heldDur: heldDur,
      craftGrid: craftGrid.slice(), invCraftGrid: invCraftGrid.slice(),
      bed: snap.bed || null,
      meta: snap.meta || {}, edits: snap.edits || {}, drops: snap.drops || [],
      galaxy: galaxyState
    };
    var from = currentWorld;
    var sequence = Voxel.FlightSequence && Voxel.FlightSequence.create
      ? Voxel.FlightSequence.create({ serial: travelSerial + 1, mode: mode, reducedMotion: flightReducedMotion() }) : null;
    if (!sequence || sequence.phase === 'aborted') {
      travelStats = null;
      Voxel.HUD.toast('飞行序列不可用，已取消跃迁');
      return false;
    }
    var tx = {
      serial: ++travelSerial,
      phase: 'ignition',
      mode: mode,
      fromId: from.id,
      toId: dest.id,
      from: from,
      to: dest,
      cost: cost,
      route: route,
      fuelBefore: galaxyState.ship.fuel,
      sourceSave: sourceSave,
      sourceState: travelOriginState,
      transit: transit,
      sequence: sequence
    };
    pendingTravel = tx;
    try {
      if (Voxel.SpaceTravel) Voxel.SpaceTravel.showWarp(from, dest, mode, tx);
      if (Voxel.Sound && Voxel.Sound.warpStart) Voxel.Sound.warpStart(mode);
    } catch (e) {
      pendingTravel = null;
      travelStats = null;
      if (Voxel.SpaceTravel && Voxel.SpaceTravel.hideWarp) Voxel.SpaceTravel.hideWarp();
      if (Voxel.Sound && Voxel.Sound.warpEnd) Voxel.Sound.warpEnd(false);
      console.error('跃迁演出启动失败', e);
      Voxel.HUD.toast('跃迁启动失败，仍停留在当前世界');
      return false;
    }
    if (travelOriginState === 'starmap') transferModalToState('overlay-starmap', 'warping');
    else { setState('warping'); exitLockForUI(); }
    if (Voxel.SpaceTravel && Voxel.SpaceTravel.announceTravel)
      Voxel.SpaceTravel.announceTravel('跃迁已启动，目的地：' + dest.name + '。');
    syncFlightVisual(tx);
    return true;
  }

  // 跨恒星系跃迁（银河星图）：消耗曲速电池而非普通燃料；抵达目标系空间站。
  // 复用 requestTravel 的验证-存档-演出事务骨架；beginTargetLoad 内做系统切换。
  function requestSystemJump(g, s) {
    if ((state !== 'playing' && state !== 'cockpit' && state !== 'starmap') || pendingTravel) return false;
    var travelOriginState = state;
    var plan = Voxel.Galaxy.jumpPlan(galaxyState, g, s);
    if (!plan || !plan.valid) {
      Voxel.HUD.toast('星域坐标无效，已取消跳跃');
      return false;
    }
    if (currentWorld && currentWorld.kind === 'planet' &&
      !(Voxel.SpaceTravel && Voxel.SpaceTravel.isAboard && Voxel.SpaceTravel.isAboard())) {
      Voxel.HUD.toast('跨恒星系跃迁需要先登舰（或从空间站终端操作）');
      return false;
    }
    if (!plan.reachable) {
      Voxel.HUD.toast('曲速电池不足：需要 ' + plan.cost + ' · 当前 ' + plan.cells +
        ' · 还缺 ' + plan.shortfall + '（2 枚高阶晶体 + 铁锭可合成）');
      return false;
    }

    if (!doSave(true, 'travel-departure')) {
      Voxel.HUD.toast('保存源世界失败，已取消跳跃；请检查浏览器存储空间');
      return false;
    }
    var sourceSave = Voxel.Save.load();
    if (!sourceSave || !sourceSave.galaxy || sourceSave.galaxy.currentId !== currentWorld.id ||
      sourceSave.galaxy.curG !== galaxyState.curG || sourceSave.galaxy.curS !== galaxyState.curS) {
      Voxel.HUD.toast('出发存档回读不一致，已取消跳跃');
      return false;
    }

    travelStats = { hp: Voxel.Player.hp(), food: Voxel.Player.food() };
    var desc = Voxel.Universe.describe(galaxyState.rootSeed, g, s);
    var destCatalog = Voxel.Galaxy.catalogFor(galaxyState, g, s);
    var to = null;
    for (var ci = 0; ci < destCatalog.length; ci++)
      if (destCatalog[ci].id === 'station-0') { to = destCatalog[ci]; break; }
    if (!to) { travelStats = null; Voxel.HUD.toast('目标恒星系数据异常，已取消'); return false; }

    // 目标系档案桶中的空间站快照（床/掉落物），其余字段从安全泊位重建。
    var bucket = plainGet(galaxyState.archive, plan.toAddr);
    var snap = bucket && bucket.worlds ? bucket.worlds['station-0'] || {} : {};
    var transit = {
      seed: to.seed,
      time: typeof snap.time === 'number' ? snap.time : 0.3,
      weather: snap.weather || 'clear',
      player: null,
      shipFlight: null,
      inv: inv.slice(), cnt: cnt.slice(), dur: dur.slice(),
      held: heldItem, heldCnt: heldCnt, heldDur: heldDur,
      craftGrid: craftGrid.slice(), invCraftGrid: invCraftGrid.slice(),
      bed: snap.bed || null,
      meta: snap.meta || {}, edits: snap.edits || {}, drops: snap.drops || [],
      galaxy: galaxyState
    };
    var from = currentWorld;
    var sequence = Voxel.FlightSequence && Voxel.FlightSequence.create
      ? Voxel.FlightSequence.create({ serial: travelSerial + 1, mode: 'ship', reducedMotion: flightReducedMotion() }) : null;
    if (!sequence || sequence.phase === 'aborted') {
      travelStats = null;
      Voxel.HUD.toast('飞行序列不可用，已取消跳跃');
      return false;
    }
    var tx = {
      serial: ++travelSerial,
      phase: 'ignition',
      mode: 'jump',
      fromId: from.id,
      toId: to.id,
      from: from,
      to: to,
      toG: g,
      toS: s,
      cost: plan.cost,
      route: null,
      fuelBefore: galaxyState.ship.fuel,
      cellsBefore: galaxyState.ship.warpCells,
      jumpFirstVisit: !galaxyState.visitedSys || !galaxyState.visitedSys[plan.toAddr],
      sourceSave: sourceSave,
      sourceState: travelOriginState,
      transit: transit,
      sequence: sequence
    };
    pendingTravel = tx;
    try {
      if (Voxel.SpaceTravel) Voxel.SpaceTravel.showWarp(from, to, 'ship', tx);
      if (Voxel.Sound && Voxel.Sound.warpStart) Voxel.Sound.warpStart('ship');
    } catch (e) {
      pendingTravel = null;
      travelStats = null;
      if (Voxel.SpaceTravel && Voxel.SpaceTravel.hideWarp) Voxel.SpaceTravel.hideWarp();
      if (Voxel.Sound && Voxel.Sound.warpEnd) Voxel.Sound.warpEnd(false);
      console.error('跨系跳跃演出启动失败', e);
      Voxel.HUD.toast('曲速引擎启动失败，仍停留在当前恒星系');
      return false;
    }
    // 与 requestTravel 同规：从星图点火时必须把星图 modal 移出栈，
    // 否则 modal 分支会吞掉 Warp/Arrive 阶段的 E/Esc（离舰/跳过全部失效）。
    if (travelOriginState === 'starmap') transferModalToState('overlay-starmap', 'warping');
    else { setState('warping'); exitLockForUI(); }
    if (Voxel.SpaceTravel && Voxel.SpaceTravel.announceTravel)
      Voxel.SpaceTravel.announceTravel('跨恒星系曲速已启动，目的地：' + desc.name + '。');
    syncFlightVisual(tx);
    return true;
  }

  function plainGet(obj, key) {
    return obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : null;
  }

  // 点火入口：银河标签页下由星图选中态驱动（见 bindStarmapTabs/ignite 按钮绑定）。
  function igniteSystemJump() {
    var sel = Voxel.SpaceTravel && Voxel.SpaceTravel.selectedJump
      ? Voxel.SpaceTravel.selectedJump() : null;
    if (!sel) return false;
    return requestSystemJump(sel.g, sel.s);
  }

  // 精选世界：已有存档时先确认并备份；无存档时直接创建。
  function openFeatured(trigger) {
    if (state !== 'menu') return;
    if (Voxel.Featured && Voxel.Featured.show) Voxel.Featured.show();
    openModalLayer({
      id: 'overlay-featured', state: 'featured', returnState: 'menu', trigger: trigger,
      initialFocus: '.featured-card', onEscape: closeFeatured
    });
  }

  function closeFeatured() {
    if (state !== 'featured') return;
    if (Voxel.Featured && Voxel.Featured.hide) Voxel.Featured.hide();
    closeModalLayer('overlay-featured', true);
  }

  function openRotateHint(trigger) {
    var top = modalTop();
    if (top && top.id === 'rotate-hint') return true;
    return !!openModalLayer({
      id: 'rotate-hint', state: 'rotate', returnState: state, trigger: trigger,
      initialFocus: '#btn-rotate-ok', onEscape: function () { closeRotateHint(true); }
    });
  }

  function closeRotateHint(restoreFocus) {
    if (!modalTop() || modalTop().id !== 'rotate-hint') return false;
    return closeModalLayer('rotate-hint', restoreFocus !== false);
  }

  function startFeatured(idx) {
    var w = Voxel.Featured && Voxel.Featured.WORLDS[idx];
    if (!w) return;
    var cards = document.querySelectorAll('.featured-card');
    var trigger = cards && cards[idx] ? cards[idx] : document.activeElement;
    function beginFeatured() {
      galaxyState = null;
      saveData = null;
      startWorld(w.seed, null, w);
    }
    if (Voxel.Save.hasRaw ? Voxel.Save.hasRaw() : Voxel.Save.has()) {
      openWorldReplaceDialog({
        trigger: trigger,
        title: '进入精选世界？',
        message: '将创建精选世界“' + w.name + '”。当前世界会先存入“上一存档”备份槽。',
        confirmLabel: '备份并进入',
        start: beginFeatured
      });
    } else {
      // hasRaw 已确认空槽后直接开始；再次 clear 会误删检查后由另一标签页写入的档。
      beginFeatured();
    }
  }

  function difficultyLevel() {
    if (!Voxel.Settings) return 2;
    var d = Voxel.Settings.get('difficulty');
    return (typeof d === 'number' && isFinite(d)) ? Math.round(d) : 2;
  }

  function showDeathOverlay(nightmare) {
    var title = document.getElementById('dead-title');
    var respawnBtn = document.getElementById('btn-respawn');
    var menuBtn = document.getElementById('btn-dead-menu');
    if (title) title.textContent = nightmare ? '游戏结束' : '你死了！';
    if (respawnBtn) respawnBtn.classList.toggle('hidden', nightmare);
    if (menuBtn) menuBtn.classList.toggle('hidden', !nightmare);
    openModalLayer({
      id: 'overlay-dead', state: 'dead', returnState: 'playing',
      initialFocus: nightmare ? '#btn-dead-menu' : '#btn-respawn'
    });
  }

  function onPlayerDead() {
    if (Voxel.Progress) {
      Voxel.Progress.track('death', { cause: (Voxel.Player.lastDamageCause && Voxel.Player.lastDamageCause()) || 'generic' });
    }
    if (Voxel.SpaceTravel && Voxel.SpaceTravel.isAboard && Voxel.SpaceTravel.isAboard() &&
      Voxel.SpaceTravel.disembarkShip) Voxel.SpaceTravel.disembarkShip({ silent: true });
    if (Voxel.HandItem && Voxel.HandItem.setVisible) Voxel.HandItem.setVisible(true);
    var cause = Voxel.Player.lastDamageCause();
    if (Voxel.HUD.setDeathCause) Voxel.HUD.setDeathCause(cause);
    // 噩梦难度：死亡无法复活——不写死亡档，直接删除存档并只提供回到主菜单。
    if (difficultyLevel() >= 3) {
      try { Voxel.Save.clear(); } catch (e) { }
      saveData = null;
      galaxyState = null;
      var causeEl = document.getElementById('death-cause');
      if (causeEl) causeEl.textContent = '噩梦难度 · 死亡无法复活，该世界的存档已被删除';
      showDeathOverlay(true);
      return;
    }
    doSave(true, 'death');
    showDeathOverlay(false);
  }

  function exitToMenuFromDeath() {
    stopDig();
    manualCraftStop();
    clearModalLayers();
    document.body.classList.remove('panel-open');
    if (Voxel.Sound && Voxel.Sound.stopEnvironment) Voxel.Sound.stopEnvironment();
    syncMainMenu();
    showOverlay('overlay-start');
    setState('menu');
    return true;
  }

  function onLockChange(locked) {
    if (locked) {
      clearIntentionalUnlock();
      return;
    }
    if (intentionalUnlockPending) {
      clearIntentionalUnlock();
      return;
    }
    if (!locked && (state === 'playing' || state === 'cockpit')) pause();
  }

  function onLockError() {
    if (state === 'playing' || state === 'cockpit') Voxel.HUD.toast('鼠标锁定失败，请点击画面重试');
  }

  function onKey(code) {
    // 手册打开时优先：M/E/Esc 先关手册
    if (manualOpen) {
      if (code === 'KeyM' || code === 'Escape' || code === 'KeyE') {
        closeManual();
        Voxel.Sound.select();
      }
      return;
    }
    if (state === 'playing') {
      if (code >= 'Digit1' && code <= 'Digit9') {
        sel = +code.charAt(5) - 1;
        Voxel.HUD.setSelected(sel);
        Voxel.Sound.select();
      } else if (code === 'KeyE') {
        if (Voxel.SpaceTravel && Voxel.SpaceTravel.canBoardShip && Voxel.SpaceTravel.canBoardShip()) {
          boardShip();
        } else if (Voxel.SpaceTravel && Voxel.SpaceTravel.canOpenMap()) { openStarMap(); }
        // 星海嘉年华乘坐台附近：长按上车（由 tickRideHold 计时），松开未达阈值照旧开背包
        else if (nearRideBoard()) {
          ride.pending = true; ride.holdT = 0; ride.fired = false;
        }
        // 准星对准功能方块交互；否则开背包
        else {
          var hit = Voxel.Raycaster.cast(Voxel.Player.eyePos(), aimDir(), C.REACH);
          if (interactWith(hit)) { }
          else toggleInv(true);
        }
      } else if (code === 'KeyF') {
        Voxel.Player.setFlying(!Voxel.Player.flying());
        Voxel.HUD.toast(Voxel.Player.flying() ? '飞行模式：开（空格↑ Shift↓）' : '飞行模式：关');
      } else if (code === 'KeyG') {
        startActiveScan();
      } else if (code === 'KeyQ') {
        throwSelected();
      } else if (code === 'KeyR') {
        tryEat();
      } else if (code === 'KeyH') openStarMap();
      else if (code === 'KeyJ') openAchievements();
      else if (code === 'KeyB') openCodex();
      else if (code === 'KeyN') {
        if (currentWorld && currentWorld.kind === 'station') {
          Voxel.HUD.toast('空间站内没有天气');
        } else {
          Voxel.Weather.next();
          Voxel.HUD.toast('天气：' + Voxel.Weather.label());
          Voxel.Sound.select();
        }
      }
      else if (code === 'F3') debug = !debug;
      else if (code === 'KeyP') pause();
      else if (code === 'KeyM') openManual();
    } else if (state === 'cockpit') {
      // KeyE 不在这里处理：长按触发着陆辅助、轻按离舰，由 tickCockpitKeyE 按固定步计时。
      if (code === 'KeyH') openStarMap();
      else if (code === 'KeyJ') openAchievements();
      else if (code === 'KeyB') openCodex();
      else if (code === 'KeyP' || code === 'Escape') pause();
      else if (code === 'F3') debug = !debug;
    } else if (state === 'riding') {
      // KeyE 不在这里处理：轻按下车由 riderFixedUpdate 按固定步判定。
      if (code === 'Escape' || code === 'KeyP') exitRide();
      else if (code === 'F3') debug = !debug;
    } else if (state === 'paused') {
      if (code === 'KeyP' || code === 'Escape') resume();
      else if (code === 'KeyM') openManual();
      else if (code === 'KeyJ') openAchievements();
      else if (code === 'KeyB') openCodex();
    } else if (state === 'inventory') {
      if (code === 'KeyE' || code === 'Escape') toggleInv(false);
      else if (code === 'KeyM') openManual();
    } else if (state === 'crafting') {
      if (code === 'KeyE' || code === 'Escape') closeCrafting();
      else if (code === 'KeyM') openManual();
    } else if (state === 'furnace') {
      if (code === 'KeyE' || code === 'Escape') closeFurnace();
      else if (code === 'KeyM') openManual();
    } else if (state === 'chest') {
      if (code === 'KeyE' || code === 'Escape') closeChest();
      else if (code === 'KeyM') openManual();
    } else if (state === 'starmap') {
      if (code === 'Escape' || code === 'KeyH' || code === 'KeyE') closeStarMap();
    } else if (state === 'discovery') {
      if (code === 'Escape' || code === 'KeyG' || code === 'KeyE') closeDiscoveryLog();
    } else if (state === 'achievements') {
      if (code === 'Escape' || code === 'KeyJ' || code === 'KeyE') closeAchievements();
    } else if (state === 'codex') {
      if (code === 'Escape' || code === 'KeyB' || code === 'KeyE') closeCodex();
    } else if (state === 'settings') {
      if (code === 'Escape') {
        var settingsModal = modalTop();
        if (settingsModal && settingsModal.onEscape) settingsModal.onEscape();
      }
    } else if (state === 'featured') {
      if (code === 'Escape') closeFeatured();
    } else if (state === 'world-replace') {
      // 对话框拥有独立状态；尤其不能让 Enter 落入主菜单的直接载入快捷键。
      if (code === 'Escape') closeWorldReplaceDialog(true);
    } else if (state === 'warping') {
      if (code === 'Escape') skipFlightPresentation();
    } else if (state === 'arriving') {
      if (code === 'Escape' || code === 'KeyE') disembark();
    } else if (state === 'menu') {
      // 主菜单按钮保留浏览器原生 Enter/Space 语义；全局 Enter 会抢在按钮 click 前绕过确认。
      if (code === 'KeyM') openManual();
    }
  }

  // ---------- 重力方块（沙/砾）与水的简化流动 ----------

  function makeFallMesh(id, x, y, z) {
    var geo = new THREE.BoxGeometry(0.98, 0.98, 0.98);
    var uv = geo.attributes.uv;
    var cornerV = [[0, 1], [1, 1], [0, 0], [1, 0]];
    for (var f = 0; f < 6; f++) {
      var t = Voxel.Blocks.tileForFace(id, f);
      var c = t % 16, r = (t / 16) | 0;
      for (var k = 0; k < 4; k++) {
        uv.setXY(f * 4 + k,
          (c * 16 + 0.5 + cornerV[k][0] * 15) / 256,
          1 - (r * 16 + 0.5 + (1 - cornerV[k][1]) * 15) / 256);
      }
    }
    uv.needsUpdate = true;
    var m = new THREE.Mesh(geo, fallMat);
    m.position.set(x + 0.5, y + 0.5, z + 0.5);
    return m;
  }

  // 挖掉支撑后，让上方连续的沙/砾变成下落实体
  function spawnFallersAbove(x, y, z) {
    var yy = y + 1;
    while (yy < CFG.WORLD_H) {
      var id = Voxel.World.get(x, yy, z);
      if (id !== 6 && id !== 14 && id !== 28) break;
      Voxel.World.set(x, yy, z, 0);
      if (fallMat && scene) {
        var mesh = makeFallMesh(id, x, yy, z);
        scene.add(mesh);
        fallers.push({ x: x, y: yy, z: z, id: id, vy: -0.4, mesh: mesh });
      }
      yy++;
    }
  }

  function updateFallers(dt) {
    for (var i = fallers.length - 1; i >= 0; i--) {
      var fb = fallers[i];
      fb.vy -= 24 * dt;
      if (fb.vy < -28) fb.vy = -28;
      var ny = fb.y + fb.vy * dt;
      var cy = Math.floor(ny);
      if (cy < 0 || Voxel.Blocks.isSolid(Voxel.World.get(fb.x, cy, fb.z))) {
        // 落地：从落点向上找第一个可占用格（空气/水/火把）
        var landY = cy + 1;
        var cur = Voxel.World.get(fb.x, landY, fb.z);
        while (landY < CFG.WORLD_H - 1 &&
          !(cur === 0 || cur === 7 || cur === 19)) {
          landY++;
          cur = Voxel.World.get(fb.x, landY, fb.z);
        }
        if (!Voxel.Blocks.isSolid(cur)) Voxel.World.set(fb.x, landY, fb.z, fb.id);
        scene.remove(fb.mesh);
        fb.mesh.geometry.dispose();
        fallers.splice(i, 1);
        continue;
      }
      fb.y = ny;
      fb.mesh.position.set(fb.x + 0.5, fb.y + 0.5, fb.z + 0.5);
    }
  }

  // 水的简化流动：挖开临水的格子后，水逐渐填入（上方或水平相邻有水）
  function enqueueWaterAround(x, y, z) {
    var dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
    for (var d = 0; d < dirs.length; d++) {
      var nx = x + dirs[d][0], ny = y + dirs[d][1], nz = z + dirs[d][2];
      // 行星 X/Z 无边界；垂直高度仍是有限的。空间站/未加载区块由 World.get 安全拦截。
      if (ny < 0 || ny >= CFG.WORLD_H) continue;
      if (waterQ.length > 1500) return;
      waterQ.push([nx, ny, nz]);
    }
  }

  function processWater(dt) {
    waterT -= dt;
    if (waterT > 0 || !waterQ.length) return;
    waterT = 0.15;
    var budget = 2;
    while (budget-- > 0 && waterQ.length) {
      var p = waterQ.shift();
      if (Voxel.World.get(p[0], p[1], p[2]) !== 0) continue;
      // 上方或水平相邻有水 → 填充
      var filled = false;
      if (Voxel.World.get(p[0], p[1] + 1, p[2]) === 7 ||
        Voxel.World.get(p[0] + 1, p[1], p[2]) === 7 ||
        Voxel.World.get(p[0] - 1, p[1], p[2]) === 7 ||
        Voxel.World.get(p[0], p[1], p[2] + 1) === 7 ||
        Voxel.World.get(p[0], p[1], p[2] - 1) === 7) {
        Voxel.World.set(p[0], p[1], p[2], 7);
        filled = true;
      }
      if (filled) enqueueWaterAround(p[0], p[1], p[2]);
    }
  }

  // ---------- 主循环 ----------

  function updateHighlight() {
    var hitEl = document.getElementById('use-hint');
    if (state !== 'playing') {
      highlight.visible = false;
      hitEl.style.display = 'none';
      hitEl.removeAttribute('data-kind');
      if (Voxel.SpaceTravel && Voxel.SpaceTravel.setScanTarget)
        Voxel.SpaceTravel.setScanTarget('none', '无锁定目标', null);
      return;
    }
    var hit = Voxel.Raycaster.cast(Voxel.Player.eyePos(), aimDir(), C.REACH);
    if (hit && hit.type === 'block') {
      highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      highlight.visible = true;
    } else highlight.visible = false;
    if (Voxel.SpaceTravel && Voxel.SpaceTravel.setScanTarget) {
      if (hit && hit.type === 'block') {
        Voxel.SpaceTravel.setScanTarget('block', Voxel.Blocks.name(hit.id), hit.dist);
      } else if (hit && hit.type === 'mob') {
        var mobNames = { sheep: '羊', pig: '猪', rabbit: '兔子', zombie: '僵尸' };
        var mobType = hit.mob && typeof hit.mob.type === 'string' ? hit.mob.type : '';
        Voxel.SpaceTravel.setScanTarget('mob', mobNames[mobType] || '生命信号', hit.dist);
      } else {
        Voxel.SpaceTravel.setScanTarget('none', '无锁定目标', null);
      }
    }
    var isTouch = Voxel.Controls.touchMode();
    var spaceHint = Voxel.SpaceTravel && Voxel.SpaceTravel.actionHint ? Voxel.SpaceTravel.actionHint() : '';
    var spaceHintKind = Voxel.SpaceTravel && Voxel.SpaceTravel.actionHintKind
      ? Voxel.SpaceTravel.actionHintKind() : '';
    if (spaceHintKind === 'portal' && Voxel.SpaceTravel.nearPortalInfo) {
      var portalInfo = Voxel.SpaceTravel.nearPortalInfo();
      if (portalInfo) Voxel.SpaceTravel.setScanTarget('portal', portalInfo.label, portalInfo.distance);
    }
    if (spaceHint) {
      if (hitEl.textContent !== spaceHint) hitEl.textContent = spaceHint;
      hitEl.dataset.kind = spaceHintKind ||
        (currentWorld && currentWorld.kind === 'station' ? 'terminal' : 'ship');
      hitEl.style.display = 'block';
    } else if (hit && hit.type === 'block' && hit.id === 15) {
      hitEl.textContent = isTouch ? '轻点打开工作台' : '按 E 打开工作台';
      hitEl.dataset.kind = 'craft';
      hitEl.style.display = 'block';
    } else if (hit && hit.type === 'block' && Voxel.Blocks.isBed(hit.id)) {
      hitEl.textContent = Voxel.DayNight.isNight()
        ? (isTouch ? '轻点睡觉（并设置重生点）' : '按 E 睡觉（并设置重生点）')
        : (isTouch ? '轻点设置重生点' : '按 E 设置重生点');
      hitEl.dataset.kind = 'bed';
      hitEl.style.display = 'block';
    } else if (hit && hit.type === 'block' && hit.id === 37) {
      hitEl.textContent = isTouch ? '轻点打开熔炉' : '按 E 打开熔炉';
      hitEl.dataset.kind = 'furnace';
      hitEl.style.display = 'block';
    } else if (hit && hit.type === 'block' && hit.id === 38) {
      hitEl.textContent = isTouch ? '轻点打开箱子' : '按 E 打开箱子';
      hitEl.dataset.kind = 'chest';
      hitEl.style.display = 'block';
    } else {
      hitEl.style.display = 'none';
      hitEl.removeAttribute('data-kind');
    }
  }

  // ---------- 床：设置重生点 / 睡觉跳过夜晚 ----------

  var sleepTimer = null;
  var sleepPose = null;   // 睡觉期间的躺卧视角（枕头上方），null=正常跟随玩家

  // 床头定位：点在床头直接返回；点在床尾则找"枕头方向指向本格"的床头
  // （床头 ID 编码了枕头朝向，可排除相邻的另一张床）
  function bedHeadOf(x, y, z) {
    var selfId = Voxel.World.get(x, y, z);
    if (selfId === 17 || (selfId >= 68 && selfId <= 71))
      return { x: x, y: y, z: z, id: selfId };
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var fallback = null;
    for (var i = 0; i < 4; i++) {
      var px = x + dirs[i][0], pz = z + dirs[i][1];
      var id = Voxel.World.get(px, y, pz);
      if (id >= 68 && id <= 71) {
        var d = bedPillowDir(id);
        if (px - d.x === x && pz - d.z === z) return { x: px, y: y, z: pz, id: id };
        if (!fallback) fallback = { x: px, y: y, z: pz, id: id };
      } else if (id === 17 && !fallback) {
        fallback = { x: px, y: y, z: pz, id: id };   // 旧单格床按床头兼容
      }
    }
    return fallback;
  }

  // 床头方块对应的枕头朝向（= 床尾→床头的延伸方向）
  function bedPillowDir(headId) {
    if (headId === 69) return { x: 1, z: 0 };
    if (headId === 70) return { x: 0, z: -1 };
    if (headId === 71) return { x: 0, z: 1 };
    return { x: -1, z: 0 };   // 17/68：枕头朝 -x
  }

  // 找床的另一半：床头按枕头方向直接定位床尾；床尾则匹配"枕头指向本格"
  // 的床头，避免把相邻另一张床的半格误当成自己的另一半
  function bedPartner(x, y, z, id) {
    if (id === 67) {
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < 4; i++) {
        var px = x + dirs[i][0], pz = z + dirs[i][1];
        var nid = Voxel.World.get(px, y, pz);
        if (nid >= 68 && nid <= 71) {
          var d = bedPillowDir(nid);
          if (px - d.x === x && pz - d.z === z) return { x: px, y: y, z: pz };
        } else if (nid === 17) {
          return { x: px, y: y, z: pz };   // 旧单格床兼容
        }
      }
      return null;
    }
    var hd = bedPillowDir(id);             // 床头（17/68..71）：枕头朝向即床尾反方向
    var fx = x - hd.x, fz = z - hd.z;
    if (Voxel.World.get(fx, y, fz) === 67) return { x: fx, y: y, z: fz };
    var dirs2 = [[1, 0], [-1, 0], [0, 1], [0, -1]];   // 旧单格床兜底
    for (var j = 0; j < 4; j++) {
      var qx = x + dirs2[j][0], qz = z + dirs2[j][1];
      if (Voxel.Blocks.isBed(Voxel.World.get(qx, y, qz))) return { x: qx, y: y, z: qz };
    }
    return null;
  }

  function useBed(hit) {
    // 床占两格半高；重生点取床头正上方（靠近枕头一侧，与 MC 一致）
    var head = bedHeadOf(hit.x, hit.y, hit.z) || hit;
    Voxel.Player.setBed(new THREE.Vector3(head.x + 0.5, head.y + 1, head.z + 0.5));
    var bedSaved = doSave(true, 'bed');
    if (Voxel.DayNight.isNight()) sleep(head);
    else Voxel.HUD.toast(bedSaved
      ? '重生点已设置为这张床 · 存档校验完成'
      : '重生点仅保留在当前会话 · 存档失败，请立即重试');
    return bedSaved;
  }

  function sleep(head) {
    if (state !== 'playing' || sleepTimer) return;
    setState('sleeping');
    stopDig();
    // 视角滑到枕头上方的躺卧位（约床面高度），仍可转动鼠标环顾，与 MC 睡觉观感一致
    var d = bedPillowDir(head.id);
    sleepPose = {
      t: 0,
      from: camera.position.clone(),
      to: new THREE.Vector3(head.x + 0.5 + d.x * 0.32, head.y + 0.62, head.z + 0.5 + d.z * 0.32)
    };
    var fade = document.getElementById('sleep-fade');
    if (fade) fade.classList.add('on');
    sleepTimer = setTimeout(finishSleep, 2400);
    return true;
  }

  function finishSleep() {
    if (state !== 'sleeping') return false;
    if (sleepTimer) clearTimeout(sleepTimer);
    sleepTimer = null;
    sleepPose = null;
    // 跳到清晨（t≈0.27 为上午），完成后立即保存，避免刷新又回到夜晚。
    Voxel.DayNight.setTime(0.27);
    Voxel.DayNight.update(0);
    if (Voxel.Progress) Voxel.Progress.track('sleep', {});
    var fade = document.getElementById('sleep-fade');
    if (fade) fade.classList.remove('on');
    setState('playing');
    var saved = doSave(true, 'sleep');
    tryLock();
    Voxel.HUD.toast(saved ? '你睡了一觉，天亮了' : '天亮了，但自动存档失败，请手动保存');
    return saved;
  }

  function loop(now) {
    requestAnimationFrame(loop);
    frame(now);
  }

  var lastFrameT = null, framesExecuted = 0, lastLockHint = '';

  function frame(now) {
    if (typeof now !== 'number' || !isFinite(now)) return;
    // 时间戳倒退（测试重置/浏览器异常）时丢弃旧累计，绝不向系统传负 dt。
    if ((lastFrameT !== null && now < lastFrameT) || (lastT !== null && now < lastT)) {
      lastFrameT = now;
      lastT = now;
      simAccumulator = 0;
    }

    // 帧率上限节流（设置：原生/30/60）。保留 interval 相位余数，避免 144Hz 下
    // 每三次 rAF 才画一帧而把“60fps”实际降成约 48fps。
    var cap = (Voxel.Settings && Voxel.Settings.get('fpsCap')) || 0;
    if (cap > 0) {
      var interval = 1000 / cap;
      if (lastFrameT !== null) {
        var elapsed = now - lastFrameT;
        if (elapsed + CAP_EPSILON_MS < interval) return;
        var intervals = Math.max(1, Math.floor((elapsed + CAP_EPSILON_MS) / interval));
        lastFrameT += intervals * interval;
      } else lastFrameT = now;
    } else lastFrameT = now;
    framesExecuted++;

    if (lastT === null) lastT = now;
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
    try {
      frameBody(dt);
    } catch (e) {
      var failedTx = pendingTravel;
      if (failedTx && !failedTx.committed) abortTravel(failedTx, '目标世界构建异常', e);
      else if (failedTx && failedTx.committed) {
        console.error('抵达演出异常，目标存档已提交', e);
        settleCommittedTravel(failedTx, true);
      } else {
        console.error(e);
        showError(String(e.message || e));
      }
    }
    // 鼠标未锁定时常驻提示（值变化才写 DOM，避免每帧样式赋值）
    var hintShow = ((state === 'playing' || state === 'cockpit') && !Voxel.Controls.isLocked()) ? 'block' : 'none';
    if (hintShow !== lastLockHint) {
      lastLockHint = hintShow;
      document.getElementById('lock-hint').style.display = hintShow;
    }
    checkBlankCanvas();
    updateErrorBanner();
  }

  function environmentContext() {
    var p = Voxel.Player.pos();
    var x = Math.floor(p.x), z = Math.floor(p.z);
    var headY = Math.floor(p.y + C.EYE);
    var sky = Voxel.World.getSky ? Voxel.World.getSky(x, headY, z) : 15;
    var blockLight = Voxel.World.getBlk ? Voxel.World.getBlk(x, headY, z) : 0;
    var headInWater = !!(Voxel.Player.headIn && Voxel.Player.headIn());
    var spawn = Voxel.Player.getSpawn ? Voxel.Player.getSpawn() : null;
    var spawnDistance = null;
    if (spawn && isFinite(spawn.x) && isFinite(spawn.z)) {
      var sdx = p.x - spawn.x, sdz = p.z - spawn.z;
      spawnDistance = Math.sqrt(sdx * sdx + sdz * sdz);
    }
    var waterDepth = headInWater ? Math.max(0, CFG.WATER_LEVEL - (p.y + C.EYE)) : 0;
    var sealedShelter = !!(Voxel.SpaceTravel && Voxel.SpaceTravel.isAboard && Voxel.SpaceTravel.isAboard());
    // 功能装备信号：只有正确佩戴且充能槽有对应消耗品时才视作防护生效
    var gearHeadId = gear[0] === GEAR_HEAD_ID ? gear[0] : 0;
    var gearBodyId = gear[1] === GEAR_BODY_ID ? gear[1] : 0;
    return {
      isNight: !!(Voxel.DayNight && Voxel.DayNight.isNight && Voxel.DayNight.isNight()),
      sunlight: Voxel.DayNight && Voxel.DayNight.sunlight ? Voxel.DayNight.sunlight() : 0,
      rain: Voxel.Weather && Voxel.Weather.intensity ? Voxel.Weather.intensity() : 0,
      sky: sky,
      sheltered: sealedShelter || sky < 14,
      outdoors: !sealedShelter && sky >= 14,
      skyExposed: !sealedShelter && sky >= 14,
      sealedShelter: sealedShelter,
      inShip: sealedShelter,
      inWater: headInWater,
      headInWater: headInWater,
      waterDepth: waterDepth,
      blockLight: blockLight,
      spawnDistance: spawnDistance,
      inSpawnSafeZone: spawnDistance !== null && spawnDistance <= 12,
      gearHead: gearHeadId,
      gearBody: gearBodyId,
      chargeHead: gearHeadId && charge.id === CHARCOAL_ID ? charge.n : 0,
      chargeBody: gearBodyId && charge.id === COAL_ID ? charge.n : 0
    };
  }

  function syncEnvironmentHUD(status, force) {
    if (!status || !Voxel.HUD || !Voxel.HUD.setEnvironment) return;
    var signature = [status.hazard, status.percent, status.level, Math.ceil(status.graceRemaining || 0),
      status.active ? 1 : 0, status.protected ? 1 : 0, status.reason,
      status.intensityText || ''].join('|');
    if (force || signature !== environmentUiSignature) {
      environmentUiSignature = signature;
      Voxel.HUD.setEnvironment(status);
    }
    var newlyUnprotected = environmentLastProtected && !status.protected && status.active;
    var enteredRiskLevel = status.level !== environmentLastLevel &&
      (status.level === 'warning' || status.level === 'danger' || status.level === 'critical');
    if (!force && status.hazard !== 'none' && (enteredRiskLevel || newlyUnprotected)) {
      Voxel.HUD.toast(status.label + '：' + status.reason + ' · 暴露 ' + status.percent + '%');
    }
    environmentLastLevel = status.level || 'safe';
    environmentLastProtected = status.protected !== false;
  }

  // 装备消耗计费：防护生效期间（status.gearCost 非 null）
  //   · 每 4s 扣 1 个充能物品（面具吃木炭 / 防寒服吃煤炭）
  //   · 每 8s 扣 1 点装备耐久，归零装备损坏
  // 离开防护（受遮蔽/水体接管、摘装备、耗尽）时时钟清零。
  function tickGearCost(step, status) {
    var slot = status && status.gearCost;
    if (slot !== 'head' && slot !== 'body') { gearChargeAccum = 0; gearDurAccum = 0; return; }
    var gi = slot === 'head' ? 0 : 1;
    var gearId = gear[gi];
    if (!gearId) { gearChargeAccum = 0; gearDurAccum = 0; return; }
    var needId = gearId === GEAR_HEAD_ID ? CHARCOAL_ID : COAL_ID;
    gearChargeAccum += step;
    if (gearChargeAccum >= 4) {
      gearChargeAccum -= 4;
      if (charge.id === needId && charge.n > 0) {
        charge.n--;
        if (charge.n <= 0) charge.id = 0;
      }
    }
    gearDurAccum += step;
    if (gearDurAccum >= 8) {
      gearDurAccum -= 8;
      var md = Voxel.Blocks.maxDur(gearId);
      if (md) {
        gearDur[gi] = (typeof gearDur[gi] === 'number' && gearDur[gi] > 0 ? gearDur[gi] : md) - 1;
        if (gearDur[gi] <= 0) {
          gear[gi] = 0; gearDur[gi] = null;
          gearChargeAccum = 0; gearDurAccum = 0;
          Voxel.Sound.pop();
          Voxel.HUD.toast(Voxel.Blocks.name(gearId) + ' 坏了！');
          var bp2 = Voxel.Player.pos().clone();
          bp2.y += 1.4;
          Voxel.Particles.burst(bp2, 0x8a8a7c, 8);
        }
      }
    }
    refreshGear();
  }

  // 装备在但充能耗尽时给节流提示（避免每步刷屏）
  function gearProtectionHint(status) {
    if (!status || !status.active || status.protected) return;
    var gi = -1, label = '';
    if ((status.hazard === 'toxic' || status.hazard === 'ash') && gear[0] === GEAR_HEAD_ID) { gi = 0; label = '滤芯耗尽'; }
    else if (status.hazard === 'cold' && gear[1] === GEAR_BODY_ID) { gi = 1; label = '燃料耗尽'; }
    if (gi < 0) return;
    var nowMs = performance.now();
    if (nowMs - gearHintT > 3000) {
      gearHintT = nowMs;
      Voxel.HUD.toast(label + '，' + Voxel.Blocks.name(gear[gi]) + '失去防护！');
    }
  }

  function tickEnvironment(step) {
    if (!Voxel.Environment || !Voxel.Environment.update) return null;
    var result = Voxel.Environment.update(step, environmentContext());
    if (!result || !result.status) return null;
    syncEnvironmentHUD(result.status, false);
    if (state === 'playing') {
      tickGearCost(step, result.status);
      gearProtectionHint(result.status);
    }
    if (Voxel.SpaceTravel && Voxel.SpaceTravel.isAboard && Voxel.SpaceTravel.isAboard() &&
      Voxel.SpaceTravel.syncCockpit) Voxel.SpaceTravel.syncCockpit(false);
    if (result.damageDue > 0 && Voxel.Player.alive())
      Voxel.Player.damage(result.damageDue, result.status.damageCause || result.status.hazard || 'generic');
    return result;
  }

  function fixedUpdate(step) {
    // ESC 菜单期间世界照常运转，但玩家操作（挖/放）被冻结
    var frozen = state === 'paused';
    var nowS = performance.now() / 1000;
    if (mouseDown[0] && !frozen && nowS - lastPlace > 0.25) { lastPlace = nowS; doAct(0); }
    if (!frozen && mouseDown[2]) tickDig(step);
    else if (digT || digProg) stopDig();
    if (!frozen && state === 'playing') tickRideHold(step);   // 长按 E 上车计时
    Voxel.Player.update(step);
    if (state === 'playing' || state === 'paused') tickEnvironment(step);
    if (!currentWorld || currentWorld.kind !== 'station') Voxel.Mobs.update(step);
    Voxel.Drops.update(step, { allowPickup: !frozen });
    updateFallers(step);
    tickActiveScan(step);
  }

  function cockpitInput() {
    // ESC 菜单期间世界继续运转，但飞船操控冻结为零输入
    if (state === 'paused') {
      return { steerYaw: 0, steerPitch: 0, bank: 0, lift: 0, thrust: false, brake: false };
    }
    var K = Voxel.Controls.keys;
    var yawDeflect = Math.max(-1, Math.min(1, Voxel.Controls.yaw() / 0.35));
    var pitchDeflect = Math.max(-1, Math.min(1, Voxel.Controls.pitch() / 0.28));
    var bank = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0);
    var lift = (K.Space ? 1 : 0) - (K.ShiftLeft || K.ShiftRight ? 1 : 0);
    return {
      steerYaw: yawDeflect,
      steerPitch: pitchDeflect,
      bank: bank,
      lift: lift,
      thrust: !!(K.KeyW || K.ArrowUp),
      brake: !!(K.KeyS || K.ArrowDown)
    };
  }

  function cockpitFixedUpdate(step) {
    // 暂停期间不推进离舰键计时，避免菜单内误触 E 离舰
    if (state !== 'paused') tickCockpitKeyE(step);
    var result = Voxel.SpaceTravel && Voxel.SpaceTravel.updateFlight
      ? Voxel.SpaceTravel.updateFlight(step, cockpitInput()) : null;
    pollLandingAssist();
    Voxel.Controls.setYaw(Voxel.Controls.yaw() * 0.86);
    Voxel.Controls.setPitch(Voxel.Controls.pitch() * 0.86);
    var point = Voxel.SpaceTravel && Voxel.SpaceTravel.cockpitWorldPosition
      ? Voxel.SpaceTravel.cockpitWorldPosition() : null;
    var flight = Voxel.SpaceTravel && Voxel.SpaceTravel.flightSnapshot
      ? Voxel.SpaceTravel.flightSnapshot() : null;
    if (point) {
      _cockpitProxy.set(point.x, point.y - C.EYE, point.z);
      if (flight) _cockpitVelocity.set(flight.velocity[0], flight.velocity[1], flight.velocity[2]);
      else _cockpitVelocity.set(0, 0, 0);
      if (Voxel.Player.updateBoarded) Voxel.Player.updateBoarded(step, _cockpitProxy, _cockpitVelocity);
    }
    tickEnvironment(step);
    if (!currentWorld || currentWorld.kind !== 'station') Voxel.Mobs.update(step);
    Voxel.Drops.update(step, { allowPickup: false });
    updateFallers(step);
    return result;
  }

  function tickRegeneration(simulationDt) {
    var hp = Voxel.Player.hp();
    if (hp < lastHp) lastDmgT = performance.now() / 1000;
    lastHp = hp;
    var canRegen = Voxel.Player.food !== undefined && Voxel.Player.food() >= C.HEAL_FOOD_MIN;
    if (hp > 0 && hp < C.HP && canRegen && performance.now() / 1000 - lastDmgT > 6) {
      regenT += simulationDt;
      if (regenT >= 4) {
        regenT = 0;
        Voxel.Player.heal(1);
        Voxel.Player.addExhaust(C.HEAL_EXHAUST);
      }
    } else regenT = 0;
  }

  function tickAutosave(dt) {
    autosaveT += dt;
    if (autosaveT >= CFG.AUTOSAVE_INTERVAL) {
      autosaveT = 0;
      runAutosave();
    }
  }

  // ---------- 成长系统环境观察 ----------
  // 低频采样（0.5s）：群系踏入记录、生物近距离编录、撸猫计数、移动里程。
  var obsT = 0, obsLastBiome = -2, obsPrevX = null, obsPrevZ = null,
    moveAccum = 0, petCooldown = 0;

  function resetProgressObserver() {
    obsT = 0; obsLastBiome = -2; obsPrevX = null; obsPrevZ = null;
    moveAccum = 0; petCooldown = 0;
  }

  function tickProgressObserver(dt) {
    if (state !== 'playing' || !currentWorld || !Voxel.World.isReady()) return;
    if (!Voxel.Progress || !Voxel.Progress.track) return;
    var p = Voxel.Player.pos();

    // 移动里程：0.5s 采样一次水平位移
    if (obsPrevX !== null) {
      var dxm = p.x - obsPrevX, dzm = p.z - obsPrevZ;
      moveAccum += Math.sqrt(dxm * dxm + dzm * dzm);
      if (moveAccum >= 1) {
        var wholeMeters = Math.floor(moveAccum);
        Voxel.Progress.track('move', { meters: wholeMeters });
        moveAccum -= wholeMeters;
      }
    }
    obsPrevX = p.x; obsPrevZ = p.z;

    obsT -= dt;
    if (obsT > 0) return;
    obsT = 0.5;

    if (currentWorld.kind === 'planet') {
      // 群系踏入（变化时才记录，Progress 内部为幂等集合）
      try {
        var bi = Voxel.World.biomeAt(Math.floor(p.x), Math.floor(p.z));
        if (typeof bi === 'number' && bi >= 0 && bi !== obsLastBiome) {
          obsLastBiome = bi;
          Voxel.Progress.track('biome', { i: bi });
        }
      } catch (e) { }

      // 生物接近编录（12 格内最近者）
      var mobsList = Voxel.Mobs && Voxel.Mobs.list ? Voxel.Mobs.list : null;
      if (mobsList && mobsList.length) {
        var nearest = null, nearestD2 = 12 * 12;
        for (var mi = 0; mi < mobsList.length; mi++) {
          var m = mobsList[mi];
          if (!m || m.dead || !m.pos) continue;
          var ddx = m.pos.x - p.x, ddz = m.pos.z - p.z, ddy = m.pos.y - p.y;
          var d2 = ddx * ddx + ddz * ddz + ddy * ddy;
          if (d2 < nearestD2) { nearestD2 = d2; nearest = m; }
        }
        if (nearest) {
          Voxel.Progress.track('fauna', { type: nearest.type });
          if (nearest.type === 'cat' && petCooldown <= 0 && nearestD2 <= 3.5 * 3.5) {
            Voxel.Progress.track('pet', { type: 'cat' });
            petCooldown = 6;
            Voxel.HUD.toast('猫在你身边蹭了蹭…（好感度+1）');
          }
        }
      }
    }
    if (petCooldown > 0) petCooldown -= 0.5;
  }

  // r128 的 THREE.Color 没有 clamp/clampScalar，这里手动把三分量压回 [0,1]。
  function clampColorUnit(c) {
    if (!c) return c;
    c.r = c.r < 0 ? 0 : (c.r > 1 ? 1 : c.r);
    c.g = c.g < 0 ? 0 : (c.g > 1 ? 1 : c.g);
    c.b = c.b < 0 ? 0 : (c.b > 1 ? 1 : c.b);
    return c;
  }

  function frameBody(dt) {
    var startedState = state;
    frames++;
    fpsT += dt;
    if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }

    // 触控 UI 状态同步（显隐/复位）
    if (Voxel.Touch && Voxel.Touch.onFrame) Voxel.Touch.onFrame(state);
    // 教程任务卡可见性（内部带变更检测，避免每帧写 DOM）
    if (Voxel.Tutorial && Voxel.Tutorial.refresh) Voxel.Tutorial.refresh();

    tickFlight(dt);

    if (state === 'loading') {
      var wasReady = Voxel.World.isReady();
      // 时间预算流式加载（P1）：以毫秒预算取代固定步数，保证加载页帧间响应
      var loadBudget = 14;
      Voxel.World.stream(loadBudget, scene);
      if (!wasReady && Voxel.World.isReady()) {
        // 生成完毕：以玩家落点（存档位置或出生点）为焦点优先建网格
        var fx, fz;
        var savedFx = saveData && saveData.player && saveData.player.pos
          ? +saveData.player.pos[0] : NaN;
        var savedFz = saveData && saveData.player && saveData.player.pos
          ? +saveData.player.pos[2] : NaN;
        var savedFocusValid = isFinite(savedFx) && isFinite(savedFz);
        // 有限空间站只有中心半径32的甲板；先拒绝明显真空坐标，不能先在
        // 污染位置建完网格、进入世界后才把玩家回退到中心安全泊位。
        if (savedFocusValid && currentWorld && currentWorld.kind === 'station') {
          var stationDx = savedFx - 128.5, stationDz = savedFz - 128.5;
          savedFocusValid = stationDx * stationDx + stationDz * stationDz <= 32 * 32;
        }
        if (savedFocusValid) {
          fx = savedFx;
          fz = savedFz;
        } else {
          var sp0 = Voxel.World.spawnPoint();
          fx = sp0.x; fz = sp0.z;
        }
        Voxel.World.setFocus(fx, fz);
        if (pendingEdits) {
          Voxel.World.applyEdits(pendingEdits);
          pendingEdits = null;
        }
      }
      // 世界完全生成后先算光照（一次性），再开始渐进建网格
      // （不能边生成边建：placeTrees 在全部地形生成完后才种树，提前建网格会导致树丢失）
      if (Voxel.World.isReady() && !Voxel.World.lightReady()) {
        // 在首次全量光照之前解析传送门基础设施；海上7×7平台因此只进入
        // edits/dirty账本，不会先执行数十次局部重光再紧接一次initLight。
        if (Voxel.SpaceTravel && (!Voxel.SpaceTravel.currentWorld ||
          Voxel.SpaceTravel.currentWorld() !== currentWorld))
          Voxel.SpaceTravel.loadWorld(currentWorld, galaxyState,
            saveData && Object.prototype.hasOwnProperty.call(saveData, 'shipFlight') ? saveData.shipFlight : undefined);
        Voxel.World.initLight();
      }
      if (Voxel.World.isReady()) Voxel.World.stream(loadBudget, scene);
      var p = Voxel.World.progress();
      var loadingBar = document.getElementById('loading-bar');
      var loadingPct = Math.max(0, Math.min(100, Math.round(p * 100)));
      loadingBar.style.width = loadingPct + '%';
      loadingBar.setAttribute('aria-valuenow', String(loadingPct));
      document.getElementById('loading-text').textContent =
        p < 1 ? '正在生成 ' + (currentWorld ? currentWorld.name : '未知天体') + ' ' + ((p * 100) | 0) + '%' : '正在同步地表与导航信标...';
      if (Voxel.World.isReady() && Voxel.World.focusMeshed()) enterWorld();
    }

    // ESC 菜单不暂停世界：paused 与 playing/furnace 共用同一 60Hz 累计器，
    // 昼夜、天气、Mob、掉落物与熔炉照常推进；玩家操控输入被冻结。
    var boardedShelterState = startedState === 'cockpit' &&
      Voxel.SpaceTravel && Voxel.SpaceTravel.isAboard && Voxel.SpaceTravel.isAboard();
    var pausedState = startedState === 'paused';
    var rideStarted = startedState === 'riding';
    var pausedAboard = pausedState &&
      !!(Voxel.SpaceTravel && Voxel.SpaceTravel.isAboard && Voxel.SpaceTravel.isAboard());
    if ((startedState === 'playing' || startedState === 'furnace' ||
      startedState === 'riding' ||
      boardedShelterState || pausedState) &&
      state === startedState) {
      simAccumulator += dt;
      var fixedStepsThisFrame = 0;
      while (state === startedState && simAccumulator + STEP_EPSILON >= FIXED_DT &&
        fixedStepsThisFrame < MAX_FIXED_STEPS) {
        simAccumulator -= FIXED_DT;
        if (simAccumulator < 0 && simAccumulator > -STEP_EPSILON) simAccumulator = 0;
        if (rideStarted && !pausedState) riderFixedUpdate(FIXED_DT);
        else if (startedState === 'playing' || (pausedState && !pausedAboard)) fixedUpdate(FIXED_DT);
        else if (boardedShelterState || pausedAboard) cockpitFixedUpdate(FIXED_DT);
        fixedStepsThisFrame++;
        fixedStepsTotal++;
      }

      // 卡顿后只补有限步；丢掉剩余完整步，保留不足一物理步的相位，防止死亡螺旋。
      if (fixedStepsThisFrame === MAX_FIXED_STEPS && simAccumulator + STEP_EPSILON >= FIXED_DT) {
        var overflowSteps = Math.floor((simAccumulator + STEP_EPSILON) / FIXED_DT);
        var dropped = overflowSteps * FIXED_DT;
        simAccumulator -= dropped;
        if (simAccumulator < 0 && simAccumulator > -STEP_EPSILON) simAccumulator = 0;
        droppedSimTime += dropped;
      }
      var simulationDt = fixedStepsThisFrame * FIXED_DT;

      if (startedState === 'furnace') {
        if (simulationDt > 0) tickFurnaces(simulationDt);
      } else if (boardedShelterState || pausedAboard) {
        if (simulationDt > 0) {
          processWater(simulationDt);
          tickFurnaces(simulationDt);
          Voxel.DayNight.update(simulationDt);
          Voxel.Weather.update(simulationDt);
        }
        if (Voxel.SpaceTravel && Voxel.SpaceTravel.applyCockpitCamera)
          Voxel.SpaceTravel.applyCockpitCamera(camera);
        if (Voxel.DayNight.updateCamera) Voxel.DayNight.updateCamera(camera.position);
        Voxel.Sound.setMusic(Voxel.DayNight.isNight() ? 'night' : 'day');
        Voxel.Particles.update(dt);
        if (Voxel.SpaceTravel) Voxel.SpaceTravel.update(simulationDt, dt);
        tickRegeneration(simulationDt);
        tickAutosave(dt);
        tickProgressObserver(dt);
      } else if (startedState === 'playing' || pausedState || rideStarted) {
        if (!mouseDown[2] && (digT || digProg)) stopDig();

        // 玩法时钟与物理使用同一实际模拟时长；纯视觉动画仍使用渲染 dt。
        if (simulationDt > 0) {
          processWater(simulationDt);
          tickFurnaces(simulationDt);
          Voxel.DayNight.update(simulationDt);
          Voxel.Weather.update(simulationDt);
        }
        if (Voxel.DayNight.updateCamera) Voxel.DayNight.updateCamera(camera.position);
        Voxel.Sound.setMusic(Voxel.DayNight.isNight() ? 'night' : 'day');
        Voxel.Particles.update(dt);
        if (Voxel.SpaceTravel) Voxel.SpaceTravel.update(simulationDt, dt);
        // 星海嘉年华：动态设施与乘坐状态（渲染帧驱动）
        if (Voxel.Amusement) {
          Voxel.Amusement.setReducedMotion(flightReducedMotion());
          Voxel.Amusement.update(dt, performance.now() / 1000,
            Voxel.Player.pos(), currentWorld ? currentWorld.id : null);
        }
        ensureRideButton(Voxel.Controls.touchMode && Voxel.Controls.touchMode());
        if (rideStarted) showRideHint(Voxel.Controls.touchMode && Voxel.Controls.touchMode());
        else updateHighlight();

        // 第一人称手持物是纯视觉反馈，按渲染帧平滑推进。
        if (Voxel.HandItem) {
          var pv = Voxel.Player.vel();
          Voxel.HandItem.setId(inv[sel]);
          Voxel.HandItem.update(dt, Math.abs(pv.x) + Math.abs(pv.z) > 0.5);
        }

        // 回血属于玩法计时，使用 simulationDt；6 秒受击宽限仍由单调墙钟判定。
        tickRegeneration(simulationDt);
        // 自动保存是基础设施墙钟，不因过载时主动丢弃模拟步而停止。
        tickAutosave(dt);
        // 移动里程/群系踏入等环境观察在正常游玩时同样需要采样。
        tickProgressObserver(dt);
      }
    }

    // 视觉色调（暂停时也保持）：昼夜 × 天气（穹顶/背景/雾/地形同步）
    // 水下滤镜：头部浸水时蓝绿覆盖 + 雾距骤减
    var uw = Voxel.Player.headIn && Voxel.Player.headIn();
    uwFade += ((uw ? 1 : 0) - uwFade) * Math.min(1, dt * 6);
    if (Math.abs(uwFade) < 0.004) uwFade = uw ? 1 : 0;
    var uwEl = document.getElementById('uw-overlay');
    if (uwEl) uwEl.classList.toggle('on', uwFade > 0.5);
    var wF = Voxel.Weather.rainFactor();
    var wFlash = Voxel.Weather.flash();
    _tint.copy(Voxel.DayNight.getTint()).multiply(Voxel.Weather.getTint());
    Voxel.MeshBuilder.applyTint(_tint);
    Voxel.Particles.applyTint(_tint);
    Voxel.Mobs.applyTint(_tint);
    Voxel.Drops.applyTint(_tint);
    if (Voxel.HandItem) Voxel.HandItem.applyTint(_tint);
    if (fallMat) fallMat.color.copy(_tint);
    var weatherMix = Voxel.DayNight.weatherMix ? Voxel.DayNight.weatherMix() : 0.75;
    _skyTop.copy(Voxel.DayNight.topColor()).lerp(Voxel.Weather.getSkyTop(), wF * weatherMix);
    _sky.copy(Voxel.DayNight.horizonColor()).lerp(Voxel.Weather.getSky(), wF * weatherMix);
    if (wFlash > 0) {
      _skyTop.r += wFlash * 0.9; _skyTop.g += wFlash * 0.92; _skyTop.b += wFlash * 0.95;
      _sky.r += wFlash * 0.85; _sky.g += wFlash * 0.88; _sky.b += wFlash * 0.95;
    }
    // 闪电白屏会把天空色推到约 1.9。8bit 帧缓冲本来就会截到 1，但 Bloom 用的是
    // 半浮点缓冲，超亮的天空会整片泛光——所以只在辉光激活时把天空压回 1 以内。
    if (Voxel.Bloom && Voxel.Bloom.active()) {
      clampColorUnit(_skyTop);
      clampColorUnit(_sky);
    }
    Voxel.DayNight.applySky(_skyTop, _sky);
    renderer.setClearColor(_sky);
    scene.fog.color.copy(_sky).lerp(_uwColor, uwFade * 0.85);
    var fogScale = Voxel.Settings ? Voxel.Settings.get('fog') : 1;
    var fogNear = (CFG.FOG_NEAR + (CFG.WEATHER.FOG_NEAR_WET - CFG.FOG_NEAR) * wF) * fogScale;
    var fogFar = (CFG.FOG_FAR + (CFG.WEATHER.FOG_FAR_WET - CFG.FOG_FAR) * wF) * fogScale;
    // 无限行星只渲染玩家周围的流式工作集：雾尾留出一整个区块的安全边距，
    // 避免高雾距设置透出尚未加载的边缘。有限空间站保留原视距。
    if (currentWorld && currentWorld.kind === 'planet') {
      var streamFogFar = Math.max(CFG.CHUNK * 2,
        (Math.max(2, CFG.STREAM_RENDER_RADIUS || 6) - 1) * CFG.CHUNK);
      fogFar = Math.min(fogFar, streamFogFar);
      fogNear = Math.min(fogNear, fogFar * 0.6);
    }
    // 水下雾：贴脸浓雾（与天气雾取更近者，按渐变系数插值）
    fogNear = fogNear + (2.5 - fogNear) * uwFade;
    fogFar = fogFar + (26 - fogFar) * uwFade;
    scene.fog.near = fogNear;
    scene.fog.far = fogFar;

    // 双通道光照：天光随昼夜（保留月光下限），块光（火把）恒定
    if (Voxel.MeshBuilder.setSun) {
      Voxel.MeshBuilder.setSun(Math.max(
        Voxel.DayNight.ambientFloor ? Voxel.DayNight.ambientFloor() : 0.2,
        Voxel.DayNight.sunlight()));
      Voxel.MeshBuilder.setEnv(_sky, fogNear, fogFar);
    }

    // 实时光影：树叶风摇 + 太阳方向侧光 + 程序化云影 + 树叶实时投影
    var nowSec = performance.now() / 1000;
    var wRain = Voxel.Weather.rainFactor();
    var swaySet = Voxel.Settings ? Voxel.Settings.get('sway') : 1;
    if (swaySet > 0 && flightReducedMotion()) swaySet = 0;
    if (Voxel.MeshBuilder.setWind) {
      var wind = Voxel.Weather.getWind();
      // 雷暴风力增强摆动，平时微风
      var amp = CFG.SHADOW.SWAY_AMP * swaySet * (0.55 + 0.45 * Math.min(1, 1 + wRain));
      Voxel.MeshBuilder.setWind(nowSec, wind.x, wind.z, amp);
      if (Voxel.Shadow) Voxel.Shadow.syncWind(nowSec, wind.x, wind.z, amp);
    }
    if (Voxel.MeshBuilder.setSunDirection) {
      var dayLight = Voxel.DayNight.sunlight();
      if (Voxel.Atmosphere.sunDirection && Voxel.Atmosphere.sunDirection(_sunDir, Voxel.DayNight.time())) {
        Voxel.MeshBuilder.setSunDirection(_sunDir.x, _sunDir.y, _sunDir.z, Math.pow(dayLight, 0.75));
      } else {
        // 无恒星世界/空间站：固定柔和方向且压平方向光对比
        Voxel.MeshBuilder.setSunDirection(0.45, 0.78, 0.44, 0.12);
      }
      var drift = Voxel.Weather.getCloudDrift();
      // 晴天云影斑驳；雨天整体阴沉 → 减弱噪声对比
      Voxel.MeshBuilder.setCloudShadow(drift.x, drift.z, CFG.SHADOW.CLOUD_SHADOW * (1 - 0.5 * wRain));
    }

    if (state === 'playing' || state === 'cockpit' || state === 'paused') {
      var focusPos = state === 'cockpit' && Voxel.SpaceTravel && Voxel.SpaceTravel.flightSnapshot
        ? Voxel.SpaceTravel.flightSnapshot().position : [Voxel.Player.pos().x, Voxel.Player.pos().y, Voxel.Player.pos().z];
      Voxel.World.setFocus(focusPos[0], focusPos[2]);
      // 时间预算流式管线（P1/P2）：生成在 Worker、网格构建走填充缓冲，
      // 每帧只投入用户设定的毫秒预算，队列排空前 FPS 保持平稳。
      var streamBudget = Voxel.Settings ? Voxel.Settings.get('stream') : 6;
      Voxel.World.stream(streamBudget, scene);
      // 阴影深度 pass 跟随玩家/飞船焦点（须在 renderer.render 前执行）
      if (Voxel.Shadow) Voxel.Shadow.update(renderer, focusPos[0], focusPos[1], focusPos[2]);
    }

    if (debug && (state === 'playing' || state === 'cockpit' || state === 'paused' || state === 'inventory')) {
      var pp = Voxel.Player.pos();
      var gl = renderer.getContext();
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      var gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).slice(0, 40) : '?';
      var envDebug = Voxel.Environment && Voxel.Environment.status ? Voxel.Environment.status() : null;
      Voxel.HUD.showDebug(
        'FPS ' + fps +
        '  状态 ' + state + (Voxel.Controls.isLocked() ? ' [鼠标已锁定]' : ' [鼠标未锁定]') +
        '  位置 ' + pp.x.toFixed(1) + ', ' + pp.y.toFixed(1) + ', ' + pp.z.toFixed(1) +
        '  视角 偏航' + (Voxel.Controls.yaw() * 57.2958).toFixed(0) + '° 俯仰' + (Voxel.Controls.pitch() * 57.2958).toFixed(0) + '°' +
        '  ' + (Voxel.DayNight.time() * 24).toFixed(1) + '时' + (Voxel.DayNight.isNight() ? ' 夜' : ' 昼') +
        '  天气 ' + Voxel.Weather.label() + (Voxel.Weather.rainbowVisible() ? ' 彩虹' : '') +
        (envDebug && envDebug.hazard !== 'none'
          ? '  环境 ' + envDebug.label + ' ' + envDebug.percent + '%' +
            (envDebug.intensityText ? ' [' + envDebug.intensityText + ']' : '') +
            (envDebug.protected ? ' [防护]' : '') : '') +
        '  天体 ' + (currentWorld ? currentWorld.name + '/' + currentWorld.typeName : '?') +
        '  跃迁 ' + (galaxyState ? Math.round(galaxyState.ship.fuel) : 0) + '%'+
        '  生物 ' + Voxel.Mobs.count() +
        '  网格 ' + Voxel.World.meshCount() +
        (gl.isContextLost() ? '  [上下文丢失!]' : '') +
        '  ' + (Voxel.Player.flying() ? '[飞行] ' : '') +
        Voxel.Blocks.name(inv[sel]) +
        '  GPU:' + gpu
      );
    } else Voxel.HUD.showDebug('');

    // 睡觉躺卧视角：相机滑向枕头上方约床面高度，旋转仍跟随鼠标（与 MC 一致）。
    // 每帧在玩家相机更新之后覆盖，起床（sleepPose 置空）即自动回到玩家眼睛。
    if (state === 'sleeping' && sleepPose) {
      sleepPose.t += dt;
      var lieK = Math.min(1, sleepPose.t / 0.8);
      var lieE = lieK * lieK * (3 - 2 * lieK);
      camera.position.lerpVectors(sleepPose.from, sleepPose.to, lieE);
      camera.rotation.x = Voxel.Controls.pitch();
      camera.rotation.y = Voxel.Controls.yaw();
    }

    // 星海嘉年华乘坐视角：设施运动位姿 + 有限的鼠标自由环视（缓回中）。
    if (state === 'riding') applyRideCamera(dt);

    // Bloom 激活时由 composer 接管渲染（它最后一趟会画到屏幕）；否则走原路径。
    if (!Voxel.Bloom || !Voxel.Bloom.render(dt)) renderer.render(scene, camera);
  }

  function onResize() {
    var size = syncViewportCss();
    if (!camera || !renderer) return;
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    renderer.setSize(size.width, size.height);
    if (Voxel.Bloom) Voxel.Bloom.setSize(size.width, size.height, renderer.getPixelRatio());
  }

  var Game = {
    state: 'loading',
    scene: null,
    camera: null,
    onKey: onKey,
    onLockChange: onLockChange,
    onLockError: onLockError,
    onPlayerDead: onPlayerDead,
    onInvClick: onInvClick,
    onCraftClick: onCraftClick,
    onResultClick: onResultClick,
    onInvCraftClick: onInvCraftClick,
    onInvResultClick: onInvResultClick,
    onSlotDown: onSlotDown,
    onSlotKeyboard: onSlotKeyboard,
    selectHotbar: selectHotbar,
    onDrop: onDrop,
    pickupDrop: pickupDrop,
    requestTravel: requestTravel,
    requestSystemJump: requestSystemJump,
    selectTravelDestination: selectTravelDestination,
    igniteSelectedTravel: igniteSelectedTravel,
    igniteSystemJump: igniteSystemJump,
    selectJumpTarget: function (addrStr) {
      if (state !== 'starmap' || pendingTravel) return false;
      return Voxel.SpaceTravel.selectJumpTarget(addrStr);
    },
    setMapMode: function (mode) {
      if (state !== 'starmap') return false;
      return Voxel.SpaceTravel.setMapMode(mode);
    },
    panGalaxyView: function (dg, ds) {
      if (state !== 'starmap') return false;
      return Voxel.SpaceTravel.panGalaxyView(dg, ds);
    },
    homeGalaxyView: function () {
      if (state !== 'starmap') return false;
      return Voxel.SpaceTravel.homeGalaxyView();
    },
    skipFlightPresentation: skipFlightPresentation,
    disembark: disembark,
    boardShip: boardShip,
    exitCockpit: exitCockpit,
    openStarMap: openStarMap,
    closeStarMap: closeStarMap,
    startActiveScan: startActiveScan,
    openDiscoveryLog: openDiscoveryLog,
    closeDiscoveryLog: closeDiscoveryLog,
    openAchievements: openAchievements,
    closeAchievements: closeAchievements,
    openCodex: openCodex,
    closeCodex: closeCodex,
    restartTutorialFromUI: restartTutorialFromUI,
    openRotateHint: openRotateHint,
    closeRotateHint: closeRotateHint,
    // 触控接口（ui/touch.js 调用）
    setTouchAim: setTouchAim,
    setDigHold: setDigHold,
    touchTap: touchTap,
    viewportSize: viewportSize,
    startFeatured: startFeatured,
    openManual: openManual,
    closeManual: closeManual,
    manualCraftable: manualCraftable,
    manualCraftStart: manualCraftStart,
    manualCraftStop: manualCraftStop,
    cycleSlot: cycleSlot,
    // 测试钩子
    _test: {
      inv: function () { return inv; },
      cnt: function () { return cnt; },
      setInv: function (i, id) { inv[i] = id; cnt[i] = id ? 1 : 0; refreshInv(); },
      clearInv: function () {
        for (var i = 0; i < 36; i++) { inv[i] = 0; cnt[i] = 0; }
        heldItem = 0; heldCnt = 0; heldDur = null;
        refreshInv();
      },
      // 按数量求和（堆叠后一格可能含多个）
      countInv: function (id) { return invTotal(id); },
      addInv: addInv,
      craft: function () { return craftGrid; },
      setCraft: function (i, id) { craftGrid[i] = id; refreshCraft(); },
      clearCraft: function () { for (var k = 0; k < 9; k++) craftGrid[k] = 0; refreshCraft(); },
      matchResult: function () { return Voxel.Crafting.match(craftGrid); },
      clickResult: onResultClick,
      openCrafting: openCrafting,
      closeCrafting: closeCrafting,
      invCraft: function () { return invCraftGrid; },
      setInvCraft: function (i, id) { invCraftGrid[i] = id; refreshInvCraft(); },
      clearInvCraft: function () { for (var k2 = 0; k2 < 4; k2++) invCraftGrid[k2] = 0; refreshInvCraft(); },
      matchInvResult: function () { return Voxel.Crafting.matchIn(invCraftGrid, 2); },
      clickInvResult: onInvResultClick,
      held: function () { return heldItem; },
      heldCount: function () { return heldCnt; },
      heldDur: function () { return heldDur; },
      gear: function () { return gear.slice(); },
      gearDur: function () { return gearDur.slice(); },
      chargeSlot: function () { return { id: charge.id, n: charge.n }; },
      setGearSlot: function (i, id) {
        gear[i] = id || 0;
        gearDur[i] = id ? Voxel.Blocks.maxDur(id) : null;
        refreshGear();
      },
      setCharge: function (id, n) {
        charge.id = id || 0;
        charge.n = id ? Math.max(0, Math.floor(Number(n) || 0)) : 0;
        refreshGear();
      },
      setHeld: function (id, n, d) {
        heldItem = id || 0;
        heldCnt = heldItem ? Math.max(1, Math.floor(Number(n) || 1)) : 0;
        heldDur = heldItem ? normalizedItemDur(heldItem, d) : null;
        Voxel.HUD.drawHeld(heldItem);
      },
      transferSlots: transferSlots,
      slotShift: onSlotShift,
      pickBlockId: pickBlockId,
      setSelected: function (i) {
        sel = Math.max(0, Math.min(8, Math.floor(Number(i) || 0)));
        Voxel.HUD.setSelected(sel);
      },
      saveNow: function () { return doSave(true, 'test'); },
      lifecycleSave: saveForLifecycle,
      runAutosave: runAutosave,
      saveHealth: saveHealthSnapshot,
      useBedAt: function (x, y, z) { return useBed({ x: x, y: y, z: z, id: 17 }); },
      sleepNow: sleep,
      finishSleep: finishSleep,
      travelPending: function () {
        return pendingTravel ? {
          serial: pendingTravel.serial,
          mode: pendingTravel.mode,
          fromId: pendingTravel.fromId,
          toId: pendingTravel.toId,
          phase: pendingTravel.phase,
          committed: !!pendingTravel.committed,
          sequence: flightSequenceSnapshot(pendingTravel)
        } : null;
      },
      flightState: function () {
        if (!pendingTravel) return null;
        return {
          serial: pendingTravel.serial,
          fromId: pendingTravel.fromId,
          toId: pendingTravel.toId,
          mode: pendingTravel.mode,
          cost: pendingTravel.cost,
          fuelBefore: pendingTravel.fuelBefore,
          committed: !!pendingTravel.committed,
          sequence: flightSequenceSnapshot(pendingTravel)
        };
      },
      tickFlight: tickFlight,
      skipFlight: skipFlightPresentation,
      abortTravel: function (reason) { return pendingTravel ? abortTravel(pendingTravel, reason || 'test_abort') : false; },
      selectedTravelId: function () { return selectedTravelId; },
      // 挖掘测试钩子
      beginDig: function () { mouseDown[2] = true; },
      endDig: function () { mouseDown[2] = false; stopDig(); },
      digHeld: function () { return !!mouseDown[2]; },
      crackVisible: function () { return !!(crackMesh && crackMesh.visible); },
      digProgress: function () { return { t: digT, p: digProg, need: digNeed }; },
      finishDig: finishDig,
      // 掉落物 / 背包交互测试钩子
      dropCount: function () { return Voxel.Drops.count(); },
      quickMoveInv: function (i) { var r = quickMoveInv(i); if (r) syncSlots('inv'); return r; },
      slotRight: onSlotRight,
      throwSelected: throwSelected,
      toggleInv: toggleInv,
      durAt: function (i) { syncDur(); return dur[i]; },
      setDur: function (i, v) { dur[i] = v; refreshInv(); },
      damageHeld: function () { damageHeldTool(1); },
      frameCount: function () { return framesExecuted; },
      resetFrameClock: function (nowMs) {
        var t = Number(nowMs);
        if (!isFinite(t)) t = 0;
        lastT = t;
        lastFrameT = t;
        simAccumulator = 0;
        fixedStepsTotal = 0;
        droppedSimTime = 0;
      },
      fixedStepCount: function () { return fixedStepsTotal; },
      simAccumulator: function () { return simAccumulator; },
      droppedSimTime: function () { return droppedSimTime; },
      requestFullscreen: requestGameFullscreen,
      galaxy: function () { return galaxyState; },
      currentWorld: function () { return currentWorld; },
      discovery: function () { return discoveryState(); },
      activeScan: function () {
        return activeScan ? { elapsed: activeScan.elapsed, duration: activeScan.duration } : null;
      },
      scanCooldown: function () { return scanCooldownT; },
      tickActiveScan: tickActiveScan,
      completeActiveScan: completeActiveScan,
      refreshDiscoveryUI: refreshDiscoveryUI,
      environmentContext: environmentContext,
      tickEnvironment: tickEnvironment,
      environmentStatus: function () {
        return Voxel.Environment && Voxel.Environment.status ? Voxel.Environment.status() : null;
      },
      requestTravel: requestTravel,
      syncMainMenu: syncMainMenu,
      restorePreviousSave: restorePreviousSave,
      savedSeedLabel: savedSeedLabel,
      updateHighlight: updateHighlight,
      // 熔炉测试钩子
      openFurnaceAt: function (x, y, z) { openFurnace({ x: x, y: y, z: z }); },
      closeFurnace: closeFurnace,
      furnaceState: function () { return curFurnace; },
      activeFurnaceCount: function () { return Object.keys(activeFurnaces).length; },
      dumpFurnace: function (x, y, z) { dumpContainerContents(x, y, z, ['in', 'fuel', 'out']); },
      // 箱子测试钩子
      openChestAt: function (x, y, z) { openChest({ x: x, y: y, z: z }); },
      closeChest: closeChest,
      curChest: function () { return curChest; },
      dumpChest: dumpChest,
      quickMoveToChest: function (i) {
        var r = quickMoveToChest(i);
        if (r) { refreshInv(); Voxel.HUD.setChest(curChest); }
        return r;
      }
    }
  };

  // 裂纹纹理：从中心向外放射的黑色裂纹，密度与深度随 stage 递增
  function makeCrackCanvas(stage) {
    var cv = document.createElement('canvas');
    cv.width = 16; cv.height = 16;
    var c2 = cv.getContext('2d');
    var lines = 5 + stage * 3;
    for (var li = 0; li < lines; li++) {
      var ang = (li / lines) * Math.PI * 2 + stage * 0.7;
      var dx = Math.cos(ang), dy = Math.sin(ang);
      var px = 8, py = 8;
      var len = 4 + ((li * 5 + stage * 2) % 6);
      for (var s = 0; s < len; s++) {
        c2.fillStyle = 'rgba(12,12,12,' + Math.min(0.85, 0.7 + stage * 0.05) + ')';
        var ix = Math.round(px), iy = Math.round(py);
        c2.fillRect(ix, iy, 1, 1);
        // 加粗：随机补一个邻接像素
        if ((li + s) % 2 === 0) c2.fillRect(ix + ((li % 2) ? 1 : -1), iy, 1, 1);
        px += dx + (((li + s) % 3) - 1) * 0.5;
        py += dy + (((li * 2 + s) % 3) - 1) * 0.5;
      }
    }
    // 后期碎裂点
    for (var d = 0; d < stage * 6; d++) {
      c2.fillStyle = 'rgba(10,10,10,' + (0.45 + stage * 0.07) + ')';
      c2.fillRect((d * 7 + 3) % 16, (d * 11 + 6) % 16, 1, 1);
    }
    return cv;
  }

  function init() {
    canvas = document.getElementById('game');
    var initialViewport = syncViewportCss();
    setAttributeIfChanged(document.body, 'data-touch-mode',
      Voxel.Controls && Voxel.Controls.touchMode && Voxel.Controls.touchMode() ? 'true' : 'false');
    Voxel.HUD.init();
    Voxel.MeshBuilder.init();

    // preserveDrawingBuffer 仅捕获模式开启（测试像素采样）；常驻开启会拖慢移动端合成
    var CAPTURE = !!(window.__CAPTURE__ || /[?&]capture=1/.test(location.search));
    renderer = new THREE.WebGLRenderer({
      canvas: canvas, antialias: false, preserveDrawingBuffer: CAPTURE
    });
    // 渲染分辨率：基础 DPR（桌面≤2 / 触屏≤1.5）× 用户缩放（设置滑条）
    var baseDPR = Math.min(window.devicePixelRatio || 1,
      (Voxel.Touch && Voxel.Touch.enabled) ? 1.5 : 2);
    function applyRes() {
      var r = Voxel.Settings ? Voxel.Settings.get('res') : 1;
      var size = syncViewportCss();
      renderer.setPixelRatio(baseDPR * (r || 1));
      renderer.setSize(size.width, size.height);
      if (Voxel.Bloom) Voxel.Bloom.setSize(size.width, size.height, renderer.getPixelRatio());
    }
    applyRes();

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x87ceeb, CFG.FOG_NEAR, CFG.FOG_FAR);
    camera = new THREE.PerspectiveCamera(75, initialViewport.width / initialViewport.height, 0.1, 1200);
    Game.scene = scene;
    // 星海嘉年华动态设施挂载到主场景
    if (Voxel.Amusement) Voxel.Amusement.bind({ scene: scene });
    // 乘坐中的自由环视：指针锁定时的鼠标增量（不回写玩家朝向）
    document.addEventListener('mousemove', function (e) {
      if (state === 'riding' && Voxel.Controls.isLocked()) {
        Voxel.Controls._rideMouseDX = (Voxel.Controls._rideMouseDX || 0) + (e.movementX || 0);
        Voxel.Controls._rideMouseDY = (Voxel.Controls._rideMouseDY || 0) + (e.movementY || 0);
      }
    }, { passive: true });
    // 能量辉光后期。软件渲染器（如 CI 的 SwiftShader）与初始化失败都会自动退回
    // 原来的 renderer.render；?bloom=1 可强制在软件渲染器上开，便于手动验收。
    // ?bloom=0/1 是会话级的验收开关，故意不写进存档。
    // 注意：Settings.applyAll()（见 booted 前）会把存档里的 bloom 值重放一遍 onChange，
    // 把这里设的状态冲掉 —— 触屏默认 bloom=0 时最明显：明明带了 ?bloom=1，最后仍被重放成关
    //（桌面端只是因为默认值恰好是 1 才没暴露）。所以记下 override，
    // 在 applyAll() 之后再应用一次；只应用那一次，之后用户在面板里的操作照常生效。
    var bloomUrlOverride = /[?&]bloom=0/.test(location.search) ? false
      : (/[?&]bloom=1/.test(location.search) ? true : null);
    if (Voxel.Bloom) {
      Voxel.Bloom.init(renderer, scene, camera, { force: bloomUrlOverride === true });
      Voxel.Bloom.setEnabled(bloomUrlOverride === null
        ? (Voxel.Settings ? Voxel.Settings.get('bloom') > 0 : true)
        : bloomUrlOverride);
    }
    camera.rotation.order = 'YXZ';

    highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.65 })
    );
    highlight.visible = false;

    // 挖掘裂纹覆盖层（5 档程序化纹理）
    for (var ct = 0; ct < 5; ct++) {
      var ctx = new THREE.CanvasTexture(makeCrackCanvas(ct));
      ctx.magFilter = THREE.NearestFilter;
      ctx.minFilter = THREE.NearestFilter;
      crackTex.push(ctx);
    }
    crackMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.005, 1.005, 1.005),
      new THREE.MeshBasicMaterial({
        map: crackTex[0], transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
      })
    );
    crackMesh.visible = false;

    Voxel.DayNight.init(scene);
    Voxel.Weather.init(scene);
    Voxel.Particles.init();
    Voxel.Mobs.init(scene);
    Voxel.Drops.init(scene);
    if (Voxel.SpaceTravel) Voxel.SpaceTravel.init(scene);
    document.addEventListener('keydown', handleModalKeydown, true);
    Voxel.Controls.init(canvas);
    if (Voxel.Touch && Voxel.Touch.init) Voxel.Touch.init();
    try {
      var atmosphereMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      var syncAtmosphereMotion = function () {
        if (Voxel.DayNight && Voxel.DayNight.setReducedMotion)
          Voxel.DayNight.setReducedMotion(!!atmosphereMotionQuery.matches);
        if (Voxel.SpaceTravel && Voxel.SpaceTravel.setReducedMotion)
          Voxel.SpaceTravel.setReducedMotion(!!atmosphereMotionQuery.matches);
      };
      syncAtmosphereMotion();
      if (atmosphereMotionQuery.addEventListener)
        atmosphereMotionQuery.addEventListener('change', syncAtmosphereMotion);
      else if (atmosphereMotionQuery.addListener)
        atmosphereMotionQuery.addListener(syncAtmosphereMotion);
    } catch (atmosphereMotionError) { }

    Game.scene = scene;
    Game.camera = camera;
    scene.add(camera); // 相机入场景：手持物等子对象才能渲染
    scene.add(highlight);
    scene.add(crackMesh);
    if (Voxel.HandItem) Voxel.HandItem.init(camera);
    fallMat = new THREE.MeshBasicMaterial({ map: Voxel.Blocks.getTexture() });

    canvas.addEventListener('pointerdown', function (e) {
      if (state !== 'playing' && state !== 'cockpit') return;
      if (!Voxel.Controls.isLocked()) { tryLock(); return; }
      if (state === 'cockpit') { e.preventDefault(); return; }
      mouseDown[e.button] = true;
      var nowS = performance.now() / 1000;
      if (e.button === 0) { lastPlace = nowS; doAct(0); }
      else if (e.button === 2) { lastDig = 0; doAct(2); } // 攻击冷却在 attack() 内判定
      else if (e.button === 1) pickBlock();
      e.preventDefault();
    });
    document.addEventListener('pointerup', function (e) {
      mouseDown[e.button] = false;
    });
    document.addEventListener('pointercancel', function () {
      mouseDown[0] = mouseDown[1] = mouseDown[2] = false;
    });
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragUp);
    document.addEventListener('pointercancel', function () {
      if (dragState) { dragState = null; Voxel.HUD.endGhost(); }
    });
    window.addEventListener('blur', function () {
      if (dragState) { dragState = null; Voxel.HUD.endGhost(); } // 窗口外松开：取消拖拽
      // 失焦时 keys 被清空；重置 E 计时避免误触发轻按离舰。
      cockpitKeyE.t = 0;
      cockpitKeyE.fired = false;
      cockpitKeyE.waitRelease = false;
      ride.pending = false; ride.holdT = 0; ride.fired = false; ride.prevHeld = false;
    });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // 游戏中未锁定时，点击窗口任意位置都可请求锁定（触控模式恒锁定，自动跳过）
    document.addEventListener('pointerdown', function (e) {
      if ((state === 'playing' || state === 'cockpit') && !Voxel.Controls.isLocked() && e.target !== canvas) tryLock();
    });
    canvas.addEventListener('click', function () {
      if ((state === 'playing' || state === 'cockpit') && !Voxel.Controls.isLocked()) tryLock();
    });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    document.addEventListener('fullscreenchange', onResize);
    document.addEventListener('webkitfullscreenchange', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    // 移动端常不触发 beforeunload；hidden/pagehide 是主要持久化时机。
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        // 后台暂停 rAF 时不能在回到熔炉面板后补算隐藏期间的墙钟时间。
        if (state === 'furnace') { simAccumulator = 0; lastT = null; }
        saveForLifecycle();
      } else {
        flushPendingFailureAnnouncement();
        syncSaveHealthUI();
      }
    });
    window.addEventListener('pagehide', saveForLifecycle);
    window.addEventListener('beforeunload', saveForLifecycle);
    window.addEventListener('storage', function (e) {
      if (!e) return;
      // 同名 sessionStorage 与游戏存档无关；普通合成 Event 没有 storageArea，
      // 保留按 key 注入回归的兼容路径。
      if (e.storageArea && e.storageArea !== localStorage) return;
      var saveKey = CFG.SAVE_KEY;
      var allSlotsChanged = e.key === null;
      if (!allSlotsChanged && e.key !== saveKey && e.key !== saveKey + '_backup' &&
        e.key !== saveKey + '_backup_swap') return;
      if (menuOwnsCurrentModalFlow()) {
        // 确认层所基于的“将被归档主档”已经过期，必须取消，不能让旧确认
        // 继续归档另一标签页刚写入的新主档。
        var canceledReplacement = state === 'world-replace';
        if (canceledReplacement) closeWorldReplaceDialog(true);
        syncMainMenu(canceledReplacement
          ? '另一页面已更新存档，本次创建确认已取消；请检查后重新确认。'
          : '检测到另一个页面更新了存档，菜单状态已刷新。', false);
        return;
      }
      // backup/swap 不改变当前运行世界的权威主槽；主档变化才需要阻断本页写入。
      if (allSlotsChanged || e.key === saveKey) markExternalSaveConflict();
    });
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      showError('图形上下文丢失，请刷新页面（F5）重试');
    });

    document.getElementById('btn-start').addEventListener('click', function () {
      // 另一标签页可能在菜单停留期间替换了存档；启动前必须重新读取，不能使用
      // syncMainMenu() 留下的陈旧对象覆盖更新后的世界。
      var latestSave = Voxel.Save.load();
      saveData = latestSave;
      if (!latestSave && Voxel.Save.hasRaw && Voxel.Save.hasRaw()) {
        syncMainMenu('当前存档不可载入；原始数据仍保留，请恢复上一存档或新建世界。', true);
        return;
      }
      startWorld(latestSave ? latestSave.seed : null, latestSave);
    });
    // Controls 会为游戏跳跃全局拦截 Space；菜单按钮需截断冒泡以保留原生键盘激活。
    function preserveMenuButtonSpace(button) {
      if (!button) return;
      button.addEventListener('keydown', function (e) {
        if (e.key === ' ') e.stopPropagation();
      });
    }
    preserveMenuButtonSpace(document.getElementById('btn-start'));
    preserveMenuButtonSpace(document.getElementById('btn-new'));
    preserveMenuButtonSpace(document.getElementById('btn-featured'));
    preserveMenuButtonSpace(document.getElementById('btn-restore-backup'));
    preserveMenuButtonSpace(document.getElementById('btn-seed-random'));
    preserveMenuButtonSpace(document.getElementById('btn-settings-menu'));
    var seedInput = document.getElementById('seed-input');
    if (document.getElementById('btn-seed-random') && seedInput) {
      document.getElementById('btn-seed-random').addEventListener('click', function () {
        seedInput.value = Voxel.SeedUtil.toString(Voxel.SeedUtil.random());
      });
    }
    document.getElementById('btn-new').addEventListener('click', function () {
      var sv = seedInput ? seedInput.value.trim() : '';
      var parsedSeed = sv === '' ? null : Voxel.SeedUtil.parse(sv);
      function beginNewWorld() {
        galaxyState = null;
        saveData = null;
        startWorld(parsedSeed, null);
      }
      if (Voxel.Save.hasRaw ? Voxel.Save.hasRaw() : Voxel.Save.has()) {
        openWorldReplaceDialog({
          trigger: document.getElementById('btn-new'),
          title: '创建新世界？',
          message: '将创建' + (sv === '' ? '一个随机世界' : '种子为 ' + sv + ' 的世界') +
            '。当前世界会先存入“上一存档”备份槽。',
          confirmLabel: '备份并创建',
          start: beginNewWorld
        });
      } else {
        // 空槽路径不执行冗余删除，避免 hasRaw→clear 间的跨标签写入竞态。
        beginNewWorld();
      }
    });
    var restoreBackupBtn = document.getElementById('btn-restore-backup');
    if (restoreBackupBtn) restoreBackupBtn.addEventListener('click', restorePreviousSave);

    var replaceOverlay = document.getElementById('overlay-world-replace');
    var replaceCancel = document.getElementById('btn-world-replace-cancel');
    var replaceConfirm = document.getElementById('btn-world-replace-confirm');
    if (replaceCancel) replaceCancel.addEventListener('click', function () {
      if (!replaceCancel.disabled) closeWorldReplaceDialog(true);
    });
    if (replaceConfirm) replaceConfirm.addEventListener('click', confirmWorldReplacement);
    if (replaceOverlay) {
      replaceOverlay.addEventListener('click', function (e) {
        if (e.target === replaceOverlay && replaceCancel && !replaceCancel.disabled)
          closeWorldReplaceDialog(true);
      });
      replaceOverlay.addEventListener('keydown', function (e) {
        // Controls 的全局 keydown 监听位于 document；在对话框边界截断，避免任何菜单热键穿透。
        e.stopPropagation();
        if (e.key === 'Escape') {
          if (replaceCancel && !replaceCancel.disabled) closeWorldReplaceDialog(true);
          e.preventDefault();
          return;
        }
        if (e.key !== 'Tab') return;
        var focusable = replaceOverlay.querySelectorAll('button:not(:disabled)');
        if (!focusable.length) { e.preventDefault(); return; }
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus(); e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus(); e.preventDefault();
        }
      });
    }
    if (document.getElementById('btn-featured')) {
      var featuredMenuBtn = document.getElementById('btn-featured');
      featuredMenuBtn.addEventListener('click', function () {
        openFeatured(featuredMenuBtn);
      });
      document.getElementById('btn-featured-back').addEventListener('click', function () {
        closeFeatured();
      });
      preserveMenuButtonSpace(document.getElementById('btn-featured-back'));

      // featured.js 负责内容；这里补齐键盘语义，并让取消确认时能回到原卡片。
      var featuredCards = document.querySelectorAll('.featured-card');
      for (var fci = 0; fci < featuredCards.length; fci++) {
        var featuredCard = featuredCards[fci];
        featuredCard.setAttribute('role', 'button');
        featuredCard.setAttribute('aria-haspopup', 'dialog');
        featuredCard.tabIndex = 0;
        if (Voxel.Featured && Voxel.Featured.WORLDS && Voxel.Featured.WORLDS[fci]) {
          var featuredWorld = Voxel.Featured.WORLDS[fci];
          featuredCard.setAttribute('aria-label', '创建精选世界：' + featuredWorld.name + '，' + featuredWorld.desc);
        }
        featuredCard.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            this.click();
          }
        });
      }
    }
    document.getElementById('btn-resume').addEventListener('click', function () {
      requestGameFullscreen(true);
      resume();
    });
    var fullscreenBtn = document.getElementById('btn-fullscreen');
    if (fullscreenBtn) {
      fullscreenBtn.style.display = Voxel.Controls.touchMode() ? 'block' : 'none';
      fullscreenBtn.addEventListener('click', function () { requestGameFullscreen(false); });
    }
    document.getElementById('btn-save').addEventListener('click', function () {
      doSave(false, 'manual');
    });
    document.getElementById('btn-respawn').addEventListener('click', function () {
      requestGameFullscreen(true);
      resume();
    });
    var deadMenuBtn = document.getElementById('btn-dead-menu');
    if (deadMenuBtn) deadMenuBtn.addEventListener('click', exitToMenuFromDeath);
    document.getElementById('btn-menu').addEventListener('click', gotoMenu);
    var starmapBtn = document.getElementById('btn-starmap-hud');
    if (starmapBtn) starmapBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (Voxel.SpaceTravel && Voxel.SpaceTravel.canBoardShip && Voxel.SpaceTravel.canBoardShip())
        boardShip();
      else openStarMap();
    });
    var starmapClose = document.getElementById('btn-starmap-close');
    if (starmapClose) starmapClose.addEventListener('click', closeStarMap);
    bindStarmapTabs();
    var cockpitExit = document.getElementById('btn-cockpit-exit');
    if (cockpitExit) cockpitExit.addEventListener('click', exitCockpit);
    var cockpitMap = document.getElementById('btn-cockpit-map');
    if (cockpitMap) cockpitMap.addEventListener('click', openStarMap);
    function bindCockpitHold(id, code) {
      var button = document.getElementById(id);
      if (!button) return;
      var release = function (e) {
        Voxel.Controls.keys[code] = false;
        button.classList.remove('pressing');
        if (e && e.cancelable) e.preventDefault();
      };
      button.addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation();
        Voxel.Controls.keys[code] = true;
        button.classList.add('pressing');
        try { button.setPointerCapture(e.pointerId); } catch (captureError) { }
      });
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
    }
    bindCockpitHold('btn-cockpit-thrust', 'KeyW');
    bindCockpitHold('btn-cockpit-brake', 'KeyS');
    bindCockpitHold('btn-cockpit-up', 'Space');
    bindCockpitHold('btn-cockpit-down', 'ShiftLeft');
    var igniteBtn = document.getElementById('btn-travel-ignite');
    if (igniteBtn) igniteBtn.addEventListener('click', function () {
      // 银河标签页下点火 = 跨恒星系曲速跳跃；恒星系标签页 = 系内跃迁。
      if (Voxel.SpaceTravel && Voxel.SpaceTravel.mapMode &&
        Voxel.SpaceTravel.mapMode() === 'galaxy') igniteSystemJump();
      else igniteSelectedTravel();
    });
    var warpSkipBtn = document.getElementById('btn-warp-skip');
    if (warpSkipBtn) warpSkipBtn.addEventListener('click', skipFlightPresentation);
    var disembarkBtn = document.getElementById('btn-disembark');
    if (disembarkBtn) disembarkBtn.addEventListener('click', disembark);
    var scanBtn = document.getElementById('btn-scan-hud');
    if (scanBtn) scanBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); startActiveScan();
    });
    var discoveryBtn = document.getElementById('btn-discovery-log');
    if (discoveryBtn) discoveryBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); openDiscoveryLog(discoveryBtn);
    });
    var discoveryClose = document.getElementById('btn-discovery-close');
    if (discoveryClose) discoveryClose.addEventListener('click', closeDiscoveryLog);
    var achClose = document.getElementById('btn-ach-close');
    if (achClose) achClose.addEventListener('click', closeAchievements);
    var codexClose = document.getElementById('btn-codex-close');
    if (codexClose) codexClose.addEventListener('click', closeCodex);
    var pauseAchBtn = document.getElementById('btn-pause-achievements');
    if (pauseAchBtn) pauseAchBtn.addEventListener('click', function () { openAchievements(); });
    var pauseCodexBtn = document.getElementById('btn-pause-codex');
    if (pauseCodexBtn) pauseCodexBtn.addEventListener('click', function () { openCodex(); });
    var pauseTutBtn = document.getElementById('btn-pause-tutorial');
    if (pauseTutBtn) pauseTutBtn.addEventListener('click', function () { restartTutorialFromUI(); });

    // 所有可由触屏打开的面板都提供可见关闭入口，并复用原有状态机收尾逻辑。
    var closeBindings = [
      ['btn-inv-close', function () { toggleInv(false); }],
      ['btn-craft-close', closeCrafting],
      ['btn-furnace-close', closeFurnace],
      ['btn-chest-close', closeChest],
      ['btn-manual-close', closeManual]
    ];
    for (var cbi = 0; cbi < closeBindings.length; cbi++) {
      var closeEl = document.getElementById(closeBindings[cbi][0]);
      if (closeEl) closeEl.addEventListener('click', closeBindings[cbi][1]);
    }

    // ---- 设置面板 ----
    var setReturn = 'menu';
    function openSettings(from) {
      setReturn = from;
      openModalLayer({
        id: 'overlay-settings', state: 'settings', returnState: from,
        initialFocus: '#btn-settings-close', onEscape: closeSettings
      });
    }
    function closeSettings() {
      if (state !== 'settings') return;
      closeModalLayer('overlay-settings', true);
      setReturn = 'menu';
    }
    var sliderSyncs = [];
    function bindSlider(key) {
      var input = document.getElementById('set-' + key);
      var label = document.getElementById('set-' + key + '-v');
      if (!input || !Voxel.Settings) return;
      function sync() {
        var v = Voxel.Settings.get(key);
        input.value = v;
        if (label) label.textContent = (key === 'fov' ? Math.round(v) : v.toFixed(2));
      }
      sync();
      sliderSyncs.push(sync);
      input.addEventListener('input', function () {
        Voxel.Settings.set(key, +input.value);
        if (label) label.textContent = (key === 'fov' ? input.value : (+input.value).toFixed(2));
        if (typeof syncPresetButtons === 'function') syncPresetButtons();
      });
    }
    bindSlider('sens'); bindSlider('volume'); bindSlider('fov'); bindSlider('fog');
    bindSlider('tsens'); bindSlider('res');
    bindSlider('particleDensity'); bindSlider('rainDensity'); bindSlider('mobDensity');
    bindSlider('sway');
    bindSlider('stream');

    // 实时树叶阴影按钮组（关/中/高）
    var shadowBtns = document.querySelectorAll('#shadows-row button');
    function syncShadowButtons() {
      var cur = (Voxel.Settings ? Voxel.Settings.get('shadows') : 0) || 0;
      for (var i = 0; i < shadowBtns.length; i++) {
        shadowBtns[i].classList.toggle('active', +shadowBtns[i].dataset.shadow === cur);
        shadowBtns[i].setAttribute('aria-pressed', +shadowBtns[i].dataset.shadow === cur ? 'true' : 'false');
      }
    }
    for (var shbi = 0; shbi < shadowBtns.length; shbi++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          Voxel.Settings.set('shadows', +btn.dataset.shadow);
          syncShadowButtons();
          syncPresetButtons();
        });
      })(shadowBtns[shbi]);
    }
    syncShadowButtons();

    // 能量辉光按钮组（关/开）。测试面板副本里没有这一行，用长度守卫。
    var bloomBtns = document.querySelectorAll('#bloom-row button');
    function syncBloomButtons() {
      var cur = (Voxel.Settings ? Voxel.Settings.get('bloom') : 1) > 0 ? 1 : 0;
      for (var i = 0; i < bloomBtns.length; i++) {
        var on = +bloomBtns[i].dataset.bloom === cur;
        bloomBtns[i].classList.toggle('active', on);
        bloomBtns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    for (var bbi = 0; bbi < bloomBtns.length; bbi++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          Voxel.Settings.set('bloom', +btn.dataset.bloom);
          syncBloomButtons();
          syncPresetButtons();
        });
      })(bloomBtns[bbi]);
    }
    if (bloomBtns.length) syncBloomButtons();

    // 分音效开关（羊叫/猪叫/僵尸等逐项开关）
    var sndToggles = document.querySelectorAll('#snd-toggles input[data-snd]');
    function buildSndToggles() {
      var box = document.getElementById('snd-toggles');
      if (!box) return;
      var labels = (Voxel.Settings && Voxel.Settings.sndLabels) || {};
      var html = '';
      for (var key in labels) {
        html += '<label><input type="checkbox" data-snd="' + key + '">' + labels[key] + '</label>';
      }
      box.innerHTML = html;
    }
    function syncSndToggles() {
      for (var i = 0; i < sndToggles.length; i++) {
        var key = sndToggles[i].dataset.snd;
        sndToggles[i].checked = Voxel.Settings.get(key) !== 0;
      }
    }
    if (document.getElementById('snd-toggles')) {
      buildSndToggles();
      sndToggles = document.querySelectorAll('#snd-toggles input[data-snd]');
      for (var sti = 0; sti < sndToggles.length; sti++) {
        (function (box) {
          box.addEventListener('change', function () {
            Voxel.Settings.set(box.dataset.snd, box.checked ? 1 : 0);
          });
        })(sndToggles[sti]);
      }
      syncSndToggles();
    }

    // 帧率上限按钮组（原生/30/60）
    var fpsBtns = document.querySelectorAll('#fps-cap-row button');
    function syncFpsButtons() {
      var cur = (Voxel.Settings ? Voxel.Settings.get('fpsCap') : 0) || 0;
      for (var i = 0; i < fpsBtns.length; i++) {
        fpsBtns[i].classList.toggle('active', +fpsBtns[i].dataset.fps === cur);
        fpsBtns[i].setAttribute('aria-pressed', +fpsBtns[i].dataset.fps === cur ? 'true' : 'false');
      }
    }
    for (var fbi = 0; fbi < fpsBtns.length; fbi++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          Voxel.Settings.set('fpsCap', +btn.dataset.fps);
          syncFpsButtons();
          syncPresetButtons();
        });
      })(fpsBtns[fbi]);
    }
    syncFpsButtons();

    // 游戏难度按钮组（和平/简单/困难/噩梦）
    var diffBtns = document.querySelectorAll('#difficulty-row button');
    function syncDifficultyButtons() {
      var cur = difficultyLevel();
      for (var i = 0; i < diffBtns.length; i++) {
        var active = +diffBtns[i].dataset.diff === cur;
        diffBtns[i].classList.toggle('active', active);
        diffBtns[i].setAttribute('aria-pressed', active ? 'true' : 'false');
      }
    }
    for (var dbi = 0; dbi < diffBtns.length; dbi++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          Voxel.Settings.set('difficulty', +btn.dataset.diff);
          syncDifficultyButtons();
        });
      })(diffBtns[dbi]);
    }
    syncDifficultyButtons();

    // 性能预设一键应用
    var presetBtns = document.querySelectorAll('#perf-preset-row button');
    function syncPresetButtons() {
      for (var i = 0; i < presetBtns.length; i++) {
        var preset = CFG.PERF_PRESETS && CFG.PERF_PRESETS[presetBtns[i].dataset.preset];
        var match = !!preset;
        if (preset) for (var key in preset) {
          if (Math.abs(Voxel.Settings.get(key) - preset[key]) > 1e-9) { match = false; break; }
        }
        presetBtns[i].setAttribute('aria-pressed', match ? 'true' : 'false');
      }
    }
    function applyPreset(name, label) {
      var p = CFG.PERF_PRESETS && CFG.PERF_PRESETS[name];
      if (!p) return;
      for (var k in p) Voxel.Settings.set(k, p[k]);
      sliderSyncs.forEach(function (fn) { fn(); });
      syncFpsButtons();
      syncPresetButtons();
      // 预设里含 bloom（"流畅"关、"均衡/高"开），不刷新的话「能量辉光」按钮会停在旧状态：
      // 实测点"流畅"后 setting 已经是 0、Bloom.active() 已经是 false，但按钮仍显示"开"选中。
      syncBloomButtons();
      if (Voxel.HUD && Voxel.HUD.toast) Voxel.HUD.toast('已应用性能预设：' + label);
    }
    syncPresetButtons();
    for (var pbi = 0; pbi < presetBtns.length; pbi++) {
      (function (btn) {
        btn.addEventListener('click', function () { applyPreset(btn.dataset.preset, btn.textContent); });
      })(presetBtns[pbi]);
    }

    // 触摸灵敏度滑条仅触控设备显示
    if (!Voxel.Controls.touchMode()) {
      var tr = document.getElementById('set-tsens-row');
      if (tr) tr.style.display = 'none';
    }
    document.getElementById('btn-set-close').addEventListener('click', closeSettings);
    var settingsClose = document.getElementById('btn-settings-close');
    if (settingsClose) settingsClose.addEventListener('click', closeSettings);
    document.getElementById('btn-settings').addEventListener('click', function () { openSettings('paused'); });
    document.getElementById('btn-settings-menu').addEventListener('click', function () { openSettings('menu'); });

    // 设置应用：灵敏度/音量即时生效；FOV 与雾距在主循环中读取
    var booted = false;
    if (Voxel.Settings) {
      Voxel.Settings.onChange(function (k, v) {
        if (k === 'sens' && Voxel.Controls.setSens) Voxel.Controls.setSens(v);
        else if (k === 'volume' && Voxel.Sound.setVolume) Voxel.Sound.setVolume(v);
        else if (k === 'res') applyRes();
        else if (k === 'particleDensity' && Voxel.DayNight && Voxel.DayNight.setDensity)
          Voxel.DayNight.setDensity(v);
        else if (k === 'rainDensity' && Voxel.Weather && Voxel.Weather.setRainDensity)
          Voxel.Weather.setRainDensity(v);
        else if (k === 'mobDensity' && Voxel.Mobs && Voxel.Mobs.setDensity)
          Voxel.Mobs.setDensity(v);
        else if (k === 'shadows' && Voxel.Shadow && Voxel.Shadow.setLevel)
          Voxel.Shadow.setLevel(v);
        // ?bloom=0/1 的覆盖只在 applyAll() 之后应用一次（见下方 booted 前），
        // 这里保持纯设置驱动，用户在面板里的手动操作要能正常生效
        else if (k === 'bloom' && Voxel.Bloom) Voxel.Bloom.setEnabled(v > 0);
        else if (k === 'difficulty') {
          // 和平：立即清怪并回满饱食度；噩梦提示不可复活
          if (Voxel.Mobs && Voxel.Mobs.setDifficulty) Voxel.Mobs.setDifficulty(v);
          if (v === 0 && Voxel.Player && Voxel.Player.setFood)
            Voxel.Player.setFood(CFG.PLAYER.FOOD_MAX);
          syncDifficultyButtons();
          if (booted && Voxel.HUD && Voxel.HUD.toast) {
            var labels = (Voxel.Settings.difficultyLabels || ['和平', '简单', '困难', '噩梦']);
            Voxel.HUD.toast('游戏难度已切换：' + (labels[v] || v) +
              (v === 3 ? '（死亡无法复活！）' : v === 0 ? '（不刷怪 · 饱食度不下降）' : ''));
          }
        }
        else if (/^snd[A-Z]/.test(k)) {
          if (k === 'sndMusic' && Voxel.Sound.setMusic)
            Voxel.Sound.setMusic(Voxel.DayNight && Voxel.DayNight.isNight() ? 'night' : 'day', true);
          for (var sbi = 0; sbi < sndToggles.length; sbi++) {
            if (sndToggles[sbi].dataset.snd === k)
              sndToggles[sbi].checked = v !== 0;
          }
        }
      });
      Voxel.Settings.applyAll();
      // applyAll() 会把存档里的 bloom 值重放一遍 onChange，把 ?bloom=0/1 的会话级覆盖冲掉。
      // 所以覆盖要在重放之后再应用一次；只在这时应用，之后用户在面板里的操作照常生效。
      if (bloomUrlOverride !== null && Voxel.Bloom) Voxel.Bloom.setEnabled(bloomUrlOverride);
      booted = true;
    }

    syncSaveHealthUI();
    syncMainMenu();

    setState('menu');
    requestAnimationFrame(loop);
  }

  Game.init = init;
  Game._frame = frame; // 测试钩子：手动驱动一帧
  return Game;
})();

// 启动
Voxel.Game.init();
