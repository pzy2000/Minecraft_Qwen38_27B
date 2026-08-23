// 主逻辑：状态机、主循环、挖掘/放置、存档调度
window.Voxel = window.Voxel || {};

Voxel.Game = (function () {
  var CFG = Voxel.Config;
  var C = CFG.PLAYER;

  var state = 'loading';
  var renderer, scene, camera, canvas, highlight;
  var MAX_STACK = Voxel.Blocks.MAX_STACK || 64;
  var inv = [], cnt = [];
  for (var i0 = 0; i0 < 36; i0++) { inv.push(0); cnt.push(0); }
  var dur = [];   // 与 inv 平行：工具耐久（非工具格为 null）
  for (var i0d = 0; i0d < 36; i0d++) dur.push(null);
  var sel = 0, heldItem = 0, heldCnt = 0, heldDur = null;
  var craftGrid = [0, 0, 0, 0, 0, 0, 0, 0, 0];   // 工作台 3x3（每格 1 个）
  var invCraftGrid = [0, 0, 0, 0];               // 背包 2x2（每格 1 个）
  var manualOpen = false;
  var saveData = null, pendingEdits = null, featuredPending = null;
  var worldReplacePending = null, worldReplaceReturnFocus = null, worldReplaceReturnState = null;
  var galaxyState = null, currentWorld = null, travelStats = null;
  var mouseDown = [false, false, false];
  var lastDig = 0, lastPlace = 0;
  var autosaveT = 0, regenT = 0, lastHp = C.HP, lastDmgT = -99;
  // 长按挖掘进度
  var digT = null, digProg = 0, digNeed = 0, digHintT = 0, digSndT = 0;
  var crackMesh = null, crackTex = [];
  // 重力方块（沙/砾下落）与水的简化流动
  var fallers = [], fallMat = null;
  var waterQ = [], waterT = 0;
  var fps = 0, frames = 0, fpsT = 0;
  var debug = false;
  var lastT = 0;
  var lastErrT = 0;
  var lastBlankCheck = 0;
  var uwFade = 0;   // 水下滤镜渐变系数 0~1
  var _uwColor = new THREE.Color(0x14507e);
  var _tint = new THREE.Color(), _sky = new THREE.Color(), _skyTop = new THREE.Color();

  function setState(s) { state = s; Game.state = s; }

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
    ['overlay-start', 'overlay-pause', 'overlay-dead', 'overlay-loading', 'overlay-featured', 'overlay-world-replace', 'overlay-starmap', 'overlay-warp', 'crafting', 'furnace', 'chest', 'manual'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
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
    if (sd.galaxy && sd.galaxy.rootSeed !== undefined) return String(sd.galaxy.rootSeed);
    return sd.seed === undefined || sd.seed === null ? '未知' : String(sd.seed);
  }

  // 所有可能改变主/备份槽的操作都通过这里刷新主菜单，避免按钮与提示显示旧状态。
  function syncMainMenu(message, isError) {
    saveData = Voxel.Save.load();
    var hasBackup = !!(Voxel.Save.hasBackup && Voxel.Save.hasBackup());
    var startBtn = document.getElementById('btn-start');
    var restoreBtn = document.getElementById('btn-restore-backup');
    var hint = document.getElementById('start-hint');
    if (startBtn) startBtn.textContent = saveData ? '继续游戏' : '开始游戏';
    if (restoreBtn) {
      restoreBtn.classList.toggle('hidden', !hasBackup);
      restoreBtn.setAttribute('aria-hidden', hasBackup ? 'false' : 'true');
    }
    if (!hint) return;
    hint.classList.toggle('is-error', !!isError);
    if (message) {
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
    if (dialog) dialog.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (confirmBtn) confirmBtn.disabled = !!busy;
    if (cancelBtn) cancelBtn.disabled = !!busy;
  }

  function closeWorldReplaceDialog(restoreFocus) {
    var overlay = document.getElementById('overlay-world-replace');
    if (overlay) overlay.classList.add('hidden');
    document.body.classList.remove('world-replace-open');
    setWorldReplaceBusy(false);
    var focusTarget = worldReplaceReturnFocus;
    var returnState = worldReplaceReturnState || 'menu';
    worldReplacePending = null;
    worldReplaceReturnFocus = null;
    worldReplaceReturnState = null;
    setState(returnState);
    if (restoreFocus && focusTarget && document.documentElement.contains(focusTarget)) {
      setTimeout(function () { focusTarget.focus(); }, 0);
    }
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
    overlay.classList.remove('hidden');
    document.body.classList.add('world-replace-open');
    setState('world-replace');
    // 将初始焦点放在安全操作上，避免按回车误触覆盖流程。
    setTimeout(function () {
      var cancelBtn = document.getElementById('btn-world-replace-cancel');
      if (cancelBtn) cancelBtn.focus();
    }, 0);
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
        error.textContent = '备份失败：当前存档未被清除。请检查浏览器存储空间后重试，或取消返回。';
        error.classList.remove('hidden');
      }
      setWorldReplaceBusy(false);
      var retryBtn = document.getElementById('btn-world-replace-confirm');
      if (retryBtn) retryBtn.focus();
      return;
    }

    // archiveCurrent 成功是清理主槽的硬前置；clear 在此后调用仅确保主槽为空。
    Voxel.Save.clear();
    var pending = worldReplacePending;
    closeWorldReplaceDialog(false);
    saveData = null;
    galaxyState = null;
    pending.start();
  }

  function restorePreviousSave() {
    var restored = false;
    try {
      restored = !!(Voxel.Save.restoreBackup && Voxel.Save.restoreBackup());
    } catch (e) {
      restored = false;
    }
    if (!restored) {
      syncMainMenu('恢复失败：上一存档不可用，当前存档未变更。', true);
      return;
    }
    syncMainMenu();
    var canSwapAgain = !!(Voxel.Save.hasBackup && Voxel.Save.hasBackup());
    syncMainMenu('已恢复上一存档' + (saveData ? ' · 星系种子 ' + savedSeedLabel(saveData) : '') +
      (canSwapAgain ? ' · 再次点击可切换回来' : ' · 可以继续游戏'), false);
    var restoreBtn = document.getElementById('btn-restore-backup');
    var startBtn = document.getElementById('btn-start');
    setTimeout(function () {
      if (restoreBtn && !restoreBtn.classList.contains('hidden')) restoreBtn.focus();
      else if (startBtn) startBtn.focus();
    }, 0);
  }

  function ensureGalaxy(rootSeed, savedGalaxy) {
    if (savedGalaxy) galaxyState = Voxel.Galaxy.hydrate(savedGalaxy, rootSeed);
    else if (!galaxyState) galaxyState = Voxel.Galaxy.create(rootSeed);
    currentWorld = Voxel.Galaxy.find(galaxyState, galaxyState.currentId) || galaxyState.catalog[0];
    galaxyState.currentId = currentWorld.id;
  }

  function startWorld(s, sd, featured, destinationId) {
    requestGameFullscreen(true);
    Voxel.Sound.unlock();
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
    rebuildActiveFurnaces();
    setState('loading');
    showOverlay('overlay-loading');
    tryLock();
  }

  // 精选世界：生成完成后把玩家放到目标群系（种子含全部 8 群系，按邻域同群系占比选点）
  function applyFeaturedSpawn(w) {
    var spot = null;
    if (w.overview || !w.biome || Voxel.Biomes.B[w.biome] === undefined) {
      spot = { x: 128, z: 128 };
    } else {
      var want = Voxel.Biomes.B[w.biome];
      var bestScore = -1;
      for (var x = 20; x < 236; x += 4) {
        for (var z = 20; z < 236; z += 4) {
          if (Voxel.World.biomeAt(x, z) !== want) continue;
          var same = 0, total = 0;
          for (var dx = -16; dx <= 16; dx += 8)
            for (var dz = -16; dz <= 16; dz += 8) {
              total++;
              if (Voxel.World.biomeAt(x + dx, z + dz) === want) same++;
            }
          if (same / total > bestScore) { bestScore = same / total; spot = { x: x, z: z }; }
        }
      }
    }
    if (!spot) spot = { x: 128, z: 128 };
    var sy = Voxel.World.surfaceAt(spot.x, spot.z);
    var pitch = w.overview ? -0.8 : -0.15;
    var py = w.overview ? Math.max(sy + 1.2, 90) : sy + 1.2;
    if (!(sy > 0) && !w.overview) py = 33.2;
    Voxel.Player.init(new THREE.Vector3(spot.x + 0.5, py, spot.z + 0.5), 0.75, pitch);
    if (w.overview) Voxel.Player.setFlying(true);
    Voxel.Controls.setYaw(0.75);
    Voxel.Controls.setPitch(pitch);
    Voxel.HUD.toast('已进入精选世界：' + w.name + ' · 种子 ' + w.seed);
  }

  function enterWorld() {
    hideOverlays();
    lastBlankCheck = performance.now(); // 进入后 3 秒内不做空白自检
    craftGrid = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    invCraftGrid = [0, 0, 0, 0];
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
      heldItem = saveData.held || 0;
      heldCnt = (saveData.heldCnt || 0) || (heldItem ? 1 : 0);
      Voxel.DayNight.setTime(saveData.time || 0.3);
      Voxel.Weather.restore(saveData.weather);
      var p = saveData.player;
      if (p && p.pos && p.pos.length === 3) {
        var vx = +p.pos[0], vy = +p.pos[1], vz = +p.pos[2];
        var vyaw = +p.yaw, vpitch = +p.pitch;
        if (!isFinite(vx) || !isFinite(vy) || !isFinite(vz) || vy < 2) {
          Voxel.Player.initAtSpawn();
        } else {
          if (!isFinite(vyaw)) vyaw = 0;
          if (!isFinite(vpitch)) vpitch = 0;
          Voxel.Player.init(new THREE.Vector3(vx, vy, vz), vyaw, vpitch);
          Voxel.Player.setFlying(!!p.fly);
          Voxel.Player.setHp(p.hp || C.HP);
          if (typeof p.food === 'number' && isFinite(p.food)) Voxel.Player.setFood(p.food);
        }
      } else Voxel.Player.initAtSpawn();
      Voxel.Player.setBed(saveData.bed ? new THREE.Vector3(saveData.bed[0], saveData.bed[1], saveData.bed[2]) : null);
      if (travelStats) {
        Voxel.Player.setHp(travelStats.hp);
        Voxel.Player.setFood(travelStats.food);
        travelStats = null;
      }
      Voxel.HUD.toast('已抵达 ' + currentWorld.name + ' · ' + currentWorld.typeName);
    } else {
      // 新世界：背包/手持/选中格/床重生点全部清空
      inv = []; cnt = [];
      for (var i1 = 0; i1 < 36; i1++) { inv.push(0); cnt.push(0); }
      heldItem = 0; heldCnt = 0; sel = 0;
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
    refreshInv();
    Voxel.HUD.drawHeld(heldItem);
    Voxel.HUD.setSelected(sel);
    Voxel.HUD.drawHealth(Voxel.Player.hp());
    lastHp = Voxel.Player.hp();
    autosaveT = 0;
    galaxyState.discovered[currentWorld.id] = true;
    if (currentWorld.kind === 'station') {
      galaxyState.ship.fuel = galaxyState.ship.maxFuel;
      Voxel.HUD.toast('空间站对接完成 · 跃迁能量已补满');
    }
    if (Voxel.SpaceTravel) Voxel.SpaceTravel.loadWorld(currentWorld, galaxyState);
    if (Voxel.SpaceTravel) Voxel.SpaceTravel.hideWarp();
    setState('playing');
  }

  function currentSnapshot() {
    var p = Voxel.Player.pos();
    var bed = Voxel.Player.getBed();
    return {
      edits: Voxel.World.getEdits(),
      meta: Voxel.World.getAllMeta(),
      time: Voxel.DayNight.time(),
      weather: Voxel.Weather.stateName(),
      player: {
        pos: [p.x, p.y, p.z], yaw: Voxel.Controls.yaw(), pitch: Voxel.Controls.pitch(),
        fly: Voxel.Player.flying(), hp: Voxel.Player.hp(), food: Voxel.Player.food()
      },
      bed: bed ? [bed.x, bed.y, bed.z] : null
    };
  }

  function storeCurrentWorld() {
    if (!galaxyState || !currentWorld || !Voxel.World.isReady()) return;
    galaxyState.worlds[currentWorld.id] = currentSnapshot();
  }

  function doSave(silent) {
    if (state !== 'playing' && state !== 'paused' && state !== 'inventory' && state !== 'crafting' && state !== 'dead') return false;
    var p = Voxel.Player.pos();
    var bed = Voxel.Player.getBed();
    storeCurrentWorld();
    var ok = Voxel.Save.save(Voxel.World, {
      time: Voxel.DayNight.time(),
      weather: Voxel.Weather.stateName(),
      player: {
        pos: [p.x, p.y, p.z],
        yaw: Voxel.Controls.yaw(),
        pitch: Voxel.Controls.pitch(),
        fly: Voxel.Player.flying(),
        hp: Voxel.Player.hp(),
        food: Voxel.Player.food ? Voxel.Player.food() : undefined
      },
      inv: inv,
      cnt: cnt,
      held: heldItem,
      heldCnt: heldCnt,
      bed: bed ? [bed.x, bed.y, bed.z] : null,
      dur: dur,
      meta: Voxel.World.getAllMeta(),
      galaxy: galaxyState
    });
    if (ok && !silent) Voxel.HUD.toast('游戏已存档');
    return ok;
  }

  // ---------- 背包堆叠辅助 ----------
  // inv[i]=物品ID，cnt[i]=数量（cnt=0 即空格）；dur[i]=工具耐久

  // 耐久归一化：非工具清空；新获得的工具补满耐久。在每次背包刷新前调用。
  function syncDur() {
    for (var i = 0; i < 36; i++) {
      var md = Voxel.Blocks.maxDur(inv[i]);
      if (!md) { dur[i] = null; continue; }
      if (dur[i] === undefined || dur[i] === null || dur[i] > md) dur[i] = md;
    }
  }

  // 统一背包刷新入口（替代直接调 HUD.setInv）
  function refreshInv() {
    syncDur();
    Voxel.HUD.setInv(inv, cnt, dur);
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
    if (added > 0) refreshInv();
    return added;
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
        moved += put;
      }
    }
    if (moved <= 0) return false;
    cnt[i] -= moved;
    if (cnt[i] <= 0) { inv[i] = 0; cnt[i] = 0; }
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
    if (added > 0) refreshInv();
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
    if (hit.id === 15) { openCrafting(); return true; }
    if (hit.id === 17) { useBed(hit); return true; }
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
      var tier = heldPickTier();
      if (tier > 0) t /= Voxel.Blocks.PICK_MULT[tier];
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
          Voxel.HUD.toast('需要' + ['', '木镐', '石镐', '铁镐'][def.tier] + '才能开采' + Voxel.Blocks.name(hit.id));
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
    if (id === 17 && cur !== 0) return; // 床只能放在空气格
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
    var overlap = x < p.x + hw && x + 1 > p.x - hw &&
      y < p.y + C.H + 0.01 && y + 1 > p.y &&
      z < p.z + hw && z + 1 > p.z - hw;
    if (overlap && Voxel.Blocks.isSolid(id)) return;
    Voxel.World.set(x, y, z, id);
    decSel();
    Voxel.Sound.place(def.sound);
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
  }

  function pickBlock() {
    if (state !== 'playing') return;
    var hit = Voxel.Raycaster.cast(Voxel.Player.eyePos(), Voxel.Player.lookDir(), C.REACH);
    if (!hit || hit.type !== 'block' || hit.id === 12) return;
    var id = hit.id;
    // 快捷栏里已有 → 直接选中该格
    for (var i = 0; i < 9; i++) {
      if (inv[i] === id) {
        sel = i;
        Voxel.HUD.setSelected(sel);
        Voxel.Sound.select();
        return;
      }
    }
    // 背包其他格有 → 与当前快捷栏格交换
    for (var j = 9; j < 36; j++) {
      if (inv[j] === id) {
        var ti = inv[j], tc = cnt[j];
        inv[j] = inv[sel]; cnt[j] = cnt[sel];
        inv[sel] = ti; cnt[sel] = tc;
        refreshInv();
        Voxel.Sound.select();
        return;
      }
    }
    // 都没有 → 放入当前空格；否则找第一个空快捷栏格（都不行才提示已满）
    if (!inv[sel]) { inv[sel] = id; cnt[sel] = 1; }
    else {
      var placed = false;
      for (var k2 = 0; k2 < 9; k2++) {
        if (!inv[k2]) { inv[k2] = id; cnt[k2] = 1; sel = k2; placed = true; break; }
      }
      if (!placed) { Voxel.HUD.toast('背包已满！'); return; }
    }
    refreshInv();
    Voxel.HUD.setSelected(sel);
    Voxel.Sound.select();
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
    setState('crafting');
    document.body.classList.add('panel-open');
    document.getElementById('crafting').classList.remove('hidden');
    refreshInv();
    Voxel.HUD.drawHeld(heldItem);
    refreshCraft();
    Voxel.Controls.exitLock();
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
    document.getElementById('crafting').classList.add('hidden');
    document.body.classList.remove('panel-open');
    setState('playing');
    tryLock();
    return true;
  }

  // 格子统一读写：inv 有堆叠数量；合成格每格固定 1 个；
  // 熔炉三格（fin 原料 / ffuel 燃料 / fout 产物）为对象槽，挂在 curFurnace 上
  function slotGet(loc, i) {
    if (loc === 'inv') return { id: inv[i], n: cnt[i], d: dur[i] };
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
    return loc === 'inv' || loc === 'fin' || loc === 'ffuel' || loc === 'chest';
  }

  // 手持 ↔ 格子交互（拾取/放置/合并/交换）。返回是否发生变化。
  // fout（熔炉产物格）只允许取出，不允许放入/并入。手持物经 heldDur 携带工具耐久。
  function handToSlot(loc, i) {
    var s = slotGet(loc, i);
    var changed = true;
    var stackable = isStackLoc(loc);
    if (loc === 'fout' && heldItem) return false;
    if (!heldItem) {
      if (!s.id) changed = false;
      else { // 拾取整格（合成格即 1 个）
        heldItem = s.id; heldCnt = s.n; heldDur = s.d || null;
        slotSet(loc, i, 0, 0);
      }
    } else if (!s.id) {
      if (stackable) {      // 放置整手
        slotSet(loc, i, heldItem, heldCnt, heldDur);
        heldItem = 0; heldCnt = 0; heldDur = null;
      } else {              // 合成格只收 1 个，余量留在手上
        slotSet(loc, i, heldItem, 1);
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
      if (stackable || heldCnt === 1) {
        // 不同物品：整手 ↔ 整格交换（合成格按 1 个计）
        slotSet(loc, i, heldItem, stackable ? heldCnt : 1, heldDur);
        heldItem = s.id; heldCnt = s.n; heldDur = s.d || null;
      } else changed = false;
    }
    if (changed) Voxel.Sound.select();
    return changed;
  }

  function decSlotBy(loc, i, n) {
    var s = slotGet(loc, i);
    var left = s.n - n;
    if (left <= 0) slotSet(loc, i, 0, 0);
    else slotSet(loc, i, s.id, left);
  }

  // 拖放：源格 → 目标格（不经过手持）。产物格 fout 只出不进。
  function transferSlots(fl, fi, tl, ti) {
    var src = slotGet(fl, fi);
    if (!src.id || (fl === tl && fi === ti)) return false;
    if (tl === 'fout') return false;
    var dst = slotGet(tl, ti);
    var srcSt = isStackLoc(fl), dstSt = isStackLoc(tl);
    if (!dst.id) {
      if (dstSt) { slotSet(tl, ti, src.id, src.n, src.d); slotSet(fl, fi, 0, 0); }
      else { slotSet(tl, ti, src.id, 1); decSlotBy(fl, fi, 1); }
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
    // 不同物：单物品格收不下超过 1 个的堆
    if (!dstSt && dst.n > 1) return false;
    // 整组交换（单物品格按 1 个计）
    slotSet(tl, ti, src.id, dstSt ? src.n : 1, src.d);
    slotSet(fl, fi, dst.id, srcSt ? dst.n : 1, dst.d);
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
    if (!canAddInv(r.result, r.count)) { Voxel.HUD.toast('背包空间不足！'); return; }
    Voxel.Crafting.consume(craftGrid, r);
    addInv(r.result, r.count);
    Voxel.Sound.pop();
    Voxel.HUD.toast('合成 ' + Voxel.Blocks.name(r.result) + (r.count > 1 ? ' ×' + r.count : ''));
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
    if (!canAddInv(r.result, r.count)) { Voxel.HUD.toast('背包空间不足！'); return; }
    Voxel.Crafting.consume(invCraftGrid, r);
    addInv(r.result, r.count);
    Voxel.Sound.pop();
    Voxel.HUD.toast('合成 ' + Voxel.Blocks.name(r.result) + (r.count > 1 ? ' ×' + r.count : ''));
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
    var got = addInv(s.id, s.n);
    if (got > 0) {
      if (got < s.n) slotSet(from, idx, s.id, s.n - got);
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
      var s = slotGet(from, idx);
      if (isStackLoc(from)) {
        if (!s.id) {
          slotSet(from, idx, heldItem, 1, heldDur);
        } else if (s.id === heldItem && s.n < stackMax(heldItem)) {
          slotSet(from, idx, heldItem, s.n + 1, s.d);
        } else return;
      } else {
        if (s.id) return;              // 合成格只收 1 个且须为空格
        slotSet(from, idx, heldItem, 1);
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
      heldDur = s2.d || null;
      var left = s2.n - take;
      slotSet(from, idx, left > 0 ? s2.id : 0, left > 0 ? left : 0, left > 0 ? s2.d : null);
    } else {
      handToSlot(from, idx);           // 单物品合成格：等同左键
    }
    Voxel.Sound.select();
    syncSlots(from);
    refreshExtra(from);
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
      to !== 'fin' && to !== 'ffuel' && to !== 'fout') return;
    if (d.fromHand) {
      // 手持物拖放
      handToSlot(to, tIdx);
      refreshInv();
      Voxel.HUD.drawHeld(heldItem);
      refreshPanel(to);
      return;
    }
    if (to === d.from && tIdx === d.idx) return; // 丢回原格：取消
    transferSlots(d.from, d.idx, to, tIdx);
    Voxel.Sound.select();
    refreshInv();
    refreshPanel(d.from);
    if (to !== d.from) refreshPanel(to);
  }

  // ---------- 合成手册 ----------

  function openManual() {
    if (manualOpen) return;
    manualOpen = true;
    document.getElementById('manual').classList.remove('hidden');
    Voxel.HUD.refreshManual();
  }

  function closeManual() {
    if (!manualOpen) return;
    manualOpen = false;
    document.getElementById('manual').classList.add('hidden');
    manualCraftStop();
  }

  // ---------- 手册一键合成（自动消耗背包材料，长按连续合成） ----------
  var manualCraftTimer = null;

  function manualCraftable(i) {
    return Voxel.Crafting.canCraftFromInv(inv, Voxel.Crafting.recipes[i], cnt);
  }

  function manualCraftOnce(i) {
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
    if (free + drained * MAX_STACK < r.count) { Voxel.HUD.toast('背包空间不足！'); return false; }
    Voxel.Crafting.consumeFromInv(inv, r, 1, cnt);
    addInv(r.result, r.count);
    Voxel.Sound.pop();
    Voxel.HUD.toast('合成 ' + Voxel.Blocks.name(r.result) + (r.count > 1 ? ' ×' + r.count : ''));
    refreshInv();
    Voxel.HUD.refreshManual();
    return true;
  }

  function manualCraftStart(i) {
    manualCraftStop();
    if (!manualCraftOnce(i)) return;
    manualCraftTimer = setInterval(function () {
      if (state !== 'playing' && state !== 'crafting' && state !== 'inventory' && state !== 'paused') {
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
  function tickFurnaces(dt) {
    for (var k in activeFurnaces) {
      var p = k.split(',');
      if (Voxel.World.get(+p[0], +p[1], +p[2]) !== 37) { delete activeFurnaces[k]; continue; }
      Voxel.FurnaceSys.tickOne(activeFurnaces[k], dt);
    }
    if (state === 'furnace' && curFurnace) {
      Voxel.HUD.setFurnace(curFurnace);
      Voxel.HUD.setFurnaceGauges(
        curFurnace.burnMax > 0 ? curFurnace.burnT / curFurnace.burnMax : 0,
        curFurnace.prog / Voxel.FurnaceSys.SMELT_TIME);
    }
  }

  function openFurnace(hit) {
    if (state !== 'playing') return;
    var f = furnaceAt(hit.x, hit.y, hit.z, true);
    if (!f) return;
    curFurnace = f;
    setState('furnace');
    document.body.classList.add('panel-open');
    document.getElementById('furnace').classList.remove('hidden');
    refreshInv();
    Voxel.HUD.drawHeld(heldItem);
    Voxel.HUD.setFurnace(f);
    Voxel.HUD.setFurnaceGauges(0, 0);
    Voxel.Controls.exitLock();
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
    document.getElementById('furnace').classList.add('hidden');
    document.body.classList.remove('panel-open');
    setState('playing');
    tryLock();
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

  function openChest(hit) {
    if (state !== 'playing') return;
    if (Voxel.World.get(hit.x, hit.y, hit.z) !== 38) return;
    var k = hit.x + ',' + hit.y + ',' + hit.z;
    var c = Voxel.World.getMeta(hit.x, hit.y, hit.z);
    if (!c || c.type !== 'chest') {
      c = { type: 'chest', items: new Array(27).fill(null) };
      Voxel.World.setMeta(hit.x, hit.y, hit.z, c);
    }
    curChest = c;
    setState('chest');
    document.body.classList.add('panel-open');
    document.getElementById('chest').classList.remove('hidden');
    Voxel.HUD.setInv(inv, cnt, dur);
    Voxel.HUD.drawHeld(heldItem);
    Voxel.HUD.setChest(c);
    Voxel.Controls.exitLock();
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
    document.getElementById('chest').classList.add('hidden');
    document.body.classList.remove('panel-open');
    setState('playing');
    tryLock();
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
    if (cnt[i] <= 0) { inv[i] = 0; cnt[i] = 0; }
    Voxel.Sound.select();
    return true;
  }

  function cycleSlot(d) {
    sel = (sel + d + 9) % 9;
    Voxel.HUD.setSelected(sel);
    Voxel.Sound.select();
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
      setState('inventory');
      document.body.classList.add('panel-open');
      document.getElementById('inventory').classList.remove('hidden');
      refreshInv();
      Voxel.HUD.drawHeld(heldItem);
      refreshInvCraft();
      Voxel.Controls.exitLock();
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
      document.getElementById('inventory').classList.add('hidden');
      document.body.classList.remove('panel-open');
      setState('playing');
      tryLock();
      return true;
    }
  }

  function pause() {
    if (state !== 'playing') return;
    setState('paused');
    document.getElementById('overlay-pause').classList.remove('hidden');
    doSave(true);
    Voxel.Controls.exitLock();
  }

  function resume() {
    if (state !== 'paused' && state !== 'dead') return;
    if (state === 'dead') Voxel.Player.respawn();
    document.getElementById('overlay-dead').classList.add('hidden');
    document.getElementById('overlay-pause').classList.add('hidden');
    setState('playing');
    tryLock();
  }

  // 存档并回到主菜单
  function gotoMenu() {
    if (state !== 'paused') return;
    doSave(true);
    stopDig();
    manualCraftStop();
    document.getElementById('overlay-pause').classList.add('hidden');
    syncMainMenu();
    showOverlay('overlay-start');
    setState('menu');
  }

  function openStarMap() {
    if (state !== 'playing') return;
    if (!Voxel.SpaceTravel || !Voxel.SpaceTravel.canOpenMap()) {
      Voxel.HUD.toast('需要靠近飞船，或在空间站航行终端内使用星图');
      return;
    }
    setState('starmap');
    Voxel.SpaceTravel.showMap();
    document.getElementById('overlay-starmap').classList.remove('hidden');
    Voxel.Controls.exitLock();
  }

  function closeStarMap() {
    if (state !== 'starmap') return;
    document.getElementById('overlay-starmap').classList.add('hidden');
    setState('playing');
    tryLock();
  }

  function requestTravel(destinationId, mode) {
    if (state !== 'playing' && state !== 'starmap') return false;
    var dest = Voxel.Galaxy.find(galaxyState, destinationId);
    if (!dest || !currentWorld || dest.id === currentWorld.id) return false;
    if (mode !== 'portal') {
      var cost = Voxel.Galaxy.fuelCost(currentWorld, dest);
      if (galaxyState.ship.fuel < cost) {
        Voxel.HUD.toast('跃迁能量不足：需要 ' + cost + '%，请先前往空间站补给');
        return false;
      }
      galaxyState.ship.fuel -= cost;
    }

    storeCurrentWorld();
    travelStats = { hp: Voxel.Player.hp(), food: Voxel.Player.food() };
    galaxyState.currentId = dest.id;
    galaxyState.discovered[dest.id] = true;
    var snap = galaxyState.worlds[dest.id] || {};
    var transit = {
      seed: dest.seed,
      time: typeof snap.time === 'number' ? snap.time : 0.3,
      weather: snap.weather || 'clear',
      player: snap.player || null,
      inv: inv.slice(), cnt: cnt.slice(), dur: dur.slice(),
      held: heldItem, heldCnt: heldCnt,
      bed: snap.bed || null,
      meta: snap.meta || {}, edits: snap.edits || {},
      galaxy: galaxyState
    };
    document.getElementById('overlay-starmap').classList.add('hidden');
    setState('warping');
    Voxel.Controls.exitLock();
    if (Voxel.SpaceTravel) Voxel.SpaceTravel.showWarp(currentWorld, dest, mode);
    var from = currentWorld;
    setTimeout(function () {
      startWorld(dest.seed, transit, null, dest.id);
      Voxel.HUD.toast((mode === 'portal' ? '传送完成：' : '跃迁完成：') + from.name + ' → ' + dest.name);
    }, 900);
    return true;
  }

  // 精选世界：已有存档时先确认并备份；无存档时直接创建。
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
    if (Voxel.Save.has()) {
      openWorldReplaceDialog({
        trigger: trigger,
        title: '进入精选世界？',
        message: '将创建精选世界“' + w.name + '”。当前世界会先存入“上一存档”备份槽。',
        confirmLabel: '备份并进入',
        start: beginFeatured
      });
    } else {
      Voxel.Save.clear();
      beginFeatured();
    }
  }

  function onPlayerDead() {
    setState('dead');
    if (Voxel.HUD.setDeathCause) Voxel.HUD.setDeathCause(Voxel.Player.lastDamageCause());
    document.getElementById('overlay-dead').classList.remove('hidden');
    Voxel.Controls.exitLock();
    doSave(true);
  }

  function onLockChange(locked) {
    if (!locked && state === 'playing') pause();
  }

  function onLockError() {
    if (state === 'playing') Voxel.HUD.toast('鼠标锁定失败，请点击画面重试');
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
        if (Voxel.SpaceTravel && Voxel.SpaceTravel.canOpenMap()) { openStarMap(); }
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
        Voxel.Weather.next();
        Voxel.HUD.toast('天气切换：' + Voxel.Weather.label());
      } else if (code === 'KeyQ') {
        throwSelected();
      } else if (code === 'KeyR') {
        tryEat();
      } else if (code === 'KeyH') openStarMap();
      else if (code === 'F3') debug = !debug;
      else if (code === 'KeyP') pause();
      else if (code === 'KeyM') openManual();
    } else if (state === 'paused') {
      if (code === 'KeyP' || code === 'Escape') resume();
      else if (code === 'KeyM') openManual();
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
    } else if (state === 'world-replace') {
      // 对话框拥有独立状态；尤其不能让 Enter 落入主菜单的直接载入快捷键。
      if (code === 'Escape') closeWorldReplaceDialog(true);
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
      return;
    }
    var hit = Voxel.Raycaster.cast(Voxel.Player.eyePos(), aimDir(), C.REACH);
    if (hit && hit.type === 'block') {
      highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      highlight.visible = true;
    } else highlight.visible = false;
    var isTouch = Voxel.Controls.touchMode();
    var spaceHint = Voxel.SpaceTravel && Voxel.SpaceTravel.actionHint ? Voxel.SpaceTravel.actionHint() : '';
    if (spaceHint) {
      hitEl.textContent = spaceHint;
      hitEl.style.display = 'block';
    } else if (hit && hit.type === 'block' && hit.id === 15) {
      hitEl.textContent = isTouch ? '轻点打开工作台' : '按 E 打开工作台';
      hitEl.style.display = 'block';
    } else if (hit && hit.type === 'block' && hit.id === 17) {
      hitEl.textContent = Voxel.DayNight.isNight()
        ? (isTouch ? '轻点睡觉（并设置重生点）' : '按 E 睡觉（并设置重生点）')
        : (isTouch ? '轻点设置重生点' : '按 E 设置重生点');
      hitEl.style.display = 'block';
    } else if (hit && hit.type === 'block' && hit.id === 37) {
      hitEl.textContent = isTouch ? '轻点打开熔炉' : '按 E 打开熔炉';
      hitEl.style.display = 'block';
    } else if (hit && hit.type === 'block' && hit.id === 38) {
      hitEl.textContent = isTouch ? '轻点打开箱子' : '按 E 打开箱子';
      hitEl.style.display = 'block';
    } else {
      hitEl.style.display = 'none';
    }
  }

  // ---------- 床：设置重生点 / 睡觉跳过夜晚 ----------

  var sleepTimer = null;

  function useBed(hit) {
    // 床占半格，重生点取床顶上方
    Voxel.Player.setBed(new THREE.Vector3(hit.x + 0.5, hit.y + 1, hit.z + 0.5));
    doSave(true);
    if (Voxel.DayNight.isNight()) sleep();
    else Voxel.HUD.toast('重生点已设置为这张床');
  }

  function sleep() {
    if (state !== 'playing' || sleepTimer) return;
    setState('sleeping');
    stopDig();
    var fade = document.getElementById('sleep-fade');
    if (fade) fade.classList.add('on');
    sleepTimer = setTimeout(function () {
      sleepTimer = null;
      // 跳到清晨（t≈0.27 为上午）
      Voxel.DayNight.setTime(0.27);
      Voxel.DayNight.update(0);
      if (fade) fade.classList.remove('on');
      setState('playing');
      tryLock();
      Voxel.HUD.toast('你睡了一觉，天亮了');
    }, 1100);
  }

  function loop(now) {
    requestAnimationFrame(loop);
    frame(now);
  }

  var lastFrameT = 0, framesExecuted = 0, lastLockHint = '';

  function frame(now) {
    // 帧率上限节流（设置：原生/30/60）；被跳过的帧间隔自然并入下次 dt
    var cap = (Voxel.Settings && Voxel.Settings.get('fpsCap')) || 0;
    if (cap > 0 && now - lastFrameT < 1000 / cap - 1) return;
    lastFrameT = now;
    framesExecuted++;

    if (!lastT) lastT = now;
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.1) dt = 0.1;
    try {
      frameBody(dt);
    } catch (e) {
      console.error(e);
      showError(String(e.message || e));
    }
    // 鼠标未锁定时常驻提示（值变化才写 DOM，避免每帧样式赋值）
    var hintShow = (state === 'playing' && !Voxel.Controls.isLocked()) ? 'block' : 'none';
    if (hintShow !== lastLockHint) {
      lastLockHint = hintShow;
      document.getElementById('lock-hint').style.display = hintShow;
    }
    checkBlankCanvas();
    updateErrorBanner();
  }

  function frameBody(dt) {
    frames++;
    fpsT += dt;
    if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }

    // 触控 UI 状态同步（显隐/复位）
    if (Voxel.Touch && Voxel.Touch.onFrame) Voxel.Touch.onFrame(state);

    if (state === 'loading') {
      var wasReady = Voxel.World.isReady();
      Voxel.World.generateNext(10);
      if (!wasReady && Voxel.World.isReady()) {
        // 生成完毕：以玩家落点（存档位置或出生点）为焦点优先建网格
        var fx, fz;
        if (saveData && saveData.player && saveData.player.pos &&
          isFinite(+saveData.player.pos[0]) && isFinite(+saveData.player.pos[2])) {
          fx = +saveData.player.pos[0];
          fz = +saveData.player.pos[2];
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
      if (Voxel.World.isReady() && !Voxel.World.lightReady()) Voxel.World.initLight();
      if (Voxel.World.isReady()) Voxel.World.buildMeshes(6, scene);
      var p = Voxel.World.progress();
      document.getElementById('loading-bar').style.width = (p * 100).toFixed(0) + '%';
      document.getElementById('loading-text').textContent =
        p < 1 ? '正在生成 ' + (currentWorld ? currentWorld.name : '未知天体') + ' ' + ((p * 100) | 0) + '%' : '正在同步地表与导航信标...';
      if (Voxel.World.isReady() && Voxel.World.focusMeshed()) enterWorld();
    }

    if (state === 'playing') {
      var acc = dt, step = 1 / 60, n = 0;
      while (acc >= step && n < 5) {
        var nowS = performance.now() / 1000;
        if (mouseDown[0] && nowS - lastPlace > 0.25) { lastPlace = nowS; doAct(0); }
        if (mouseDown[2]) tickDig(step);
        else if (digT || digProg) stopDig();
        Voxel.Player.update(step);
        if (!currentWorld || currentWorld.kind !== 'station') Voxel.Mobs.update(step);
        Voxel.Drops.update(step);
        updateFallers(step);
        acc -= step;
        n++;
      }
      if (n === 5) acc = 0;
      if (!mouseDown[2] && (digT || digProg)) stopDig();

      // 水的简化流动（节流处理）
      processWater(dt);

      // 熔炉烧制推进
      tickFurnaces(dt);

      Voxel.DayNight.update(dt);
      if (Voxel.DayNight.updateCamera) Voxel.DayNight.updateCamera(camera.position);
      Voxel.Sound.setMusic(Voxel.DayNight.isNight() ? 'night' : 'day');
      Voxel.Weather.update(dt);
      Voxel.Particles.update(dt);
      if (Voxel.SpaceTravel) Voxel.SpaceTravel.update(dt);
      updateHighlight();

      // 第一人称手持物
      if (Voxel.HandItem) {
        var pv = Voxel.Player.vel();
        Voxel.HandItem.setId(inv[sel]);
        Voxel.HandItem.update(dt, Math.abs(pv.x) + Math.abs(pv.z) > 0.5);
      }

      // 回血：受击 6 秒后开始，且饥饿 ≥ 阈值；回血额外消耗疲惫
      var hp = Voxel.Player.hp();
      if (hp < lastHp) lastDmgT = performance.now() / 1000;
      lastHp = hp;
      var canRegen = Voxel.Player.food !== undefined &&
        Voxel.Player.food() >= C.HEAL_FOOD_MIN;
      if (hp > 0 && hp < C.HP && canRegen && performance.now() / 1000 - lastDmgT > 6) {
        regenT += dt;
        if (regenT >= 4) {
          regenT = 0;
          Voxel.Player.heal(1);
          Voxel.Player.addExhaust(C.HEAL_EXHAUST);
        }
      } else regenT = 0;

      autosaveT += dt;
      if (autosaveT >= CFG.AUTOSAVE_INTERVAL) {
        autosaveT = 0;
        doSave(true);
        Voxel.HUD.toast('已自动存档');
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
    _skyTop.copy(Voxel.DayNight.topColor()).lerp(Voxel.Weather.getSkyTop(), wF * 0.85);
    _sky.copy(Voxel.DayNight.horizonColor()).lerp(Voxel.Weather.getSky(), wF * 0.85);
    var spaceEnv = Voxel.SpaceTravel && Voxel.SpaceTravel.environment ? Voxel.SpaceTravel.environment() : null;
    if (spaceEnv) {
      _skyTop.lerp(new THREE.Color(spaceEnv.top), currentWorld && currentWorld.kind === 'station' ? 0.92 : 0.42);
      _sky.lerp(new THREE.Color(spaceEnv.horizon), currentWorld && currentWorld.kind === 'station' ? 0.92 : 0.34);
    }
    if (wFlash > 0) {
      _skyTop.r += wFlash * 0.9; _skyTop.g += wFlash * 0.92; _skyTop.b += wFlash * 0.95;
      _sky.r += wFlash * 0.85; _sky.g += wFlash * 0.88; _sky.b += wFlash * 0.95;
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
      Voxel.MeshBuilder.setSun(Math.max(0.2, Voxel.DayNight.sunlight()));
      Voxel.MeshBuilder.setEnv(_sky, fogNear, fogFar);
    }

    if (state === 'playing') {
      Voxel.World.setFocus(Voxel.Player.pos().x, Voxel.Player.pos().z);
      // 初始 256×256 核心就绪后，generateNext 继续以小预算流式生成玩家周围区块。
      Voxel.World.generateNext(Math.max(1, CFG.STREAM_GENERATE_PER_FRAME || 1));
      Voxel.World.buildMeshes(2, scene);
    }

    if (debug && (state === 'playing' || state === 'paused' || state === 'inventory')) {
      var pp = Voxel.Player.pos();
      var gl = renderer.getContext();
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      var gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).slice(0, 40) : '?';
      Voxel.HUD.showDebug(
        'FPS ' + fps +
        '  状态 ' + state + (Voxel.Controls.isLocked() ? ' [鼠标已锁定]' : ' [鼠标未锁定]') +
        '  位置 ' + pp.x.toFixed(1) + ', ' + pp.y.toFixed(1) + ', ' + pp.z.toFixed(1) +
        '  视角 偏航' + (Voxel.Controls.yaw() * 57.2958).toFixed(0) + '° 俯仰' + (Voxel.Controls.pitch() * 57.2958).toFixed(0) + '°' +
        '  ' + (Voxel.DayNight.time() * 24).toFixed(1) + '时' + (Voxel.DayNight.isNight() ? ' 夜' : ' 昼') +
        '  天气 ' + Voxel.Weather.label() + (Voxel.Weather.rainbowVisible() ? ' 彩虹' : '') +
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

    renderer.render(scene, camera);
  }

  function onResize() {
    var size = syncViewportCss();
    if (!camera || !renderer) return;
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    renderer.setSize(size.width, size.height);
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
    onDrop: onDrop,
    pickupDrop: pickupDrop,
    requestTravel: requestTravel,
    openStarMap: openStarMap,
    closeStarMap: closeStarMap,
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
        heldItem = 0; heldCnt = 0;
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
      requestFullscreen: requestGameFullscreen,
      galaxy: function () { return galaxyState; },
      currentWorld: function () { return currentWorld; },
      requestTravel: requestTravel,
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
    }
    applyRes();

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x87ceeb, CFG.FOG_NEAR, CFG.FOG_FAR);
    camera = new THREE.PerspectiveCamera(75, initialViewport.width / initialViewport.height, 0.1, 1200);
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
    Voxel.Controls.init(canvas);
    if (Voxel.Touch && Voxel.Touch.init) Voxel.Touch.init();

    Game.scene = scene;
    Game.camera = camera;
    scene.add(camera); // 相机入场景：手持物等子对象才能渲染
    scene.add(highlight);
    scene.add(crackMesh);
    if (Voxel.HandItem) Voxel.HandItem.init(camera);
    fallMat = new THREE.MeshBasicMaterial({ map: Voxel.Blocks.getTexture() });

    canvas.addEventListener('pointerdown', function (e) {
      if (state !== 'playing') return;
      if (!Voxel.Controls.isLocked()) { tryLock(); return; }
      mouseDown[e.button] = true;
      var nowS = performance.now() / 1000;
      if (e.button === 0) { lastPlace = nowS - 0.3; doAct(0); }
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
    });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // 游戏中未锁定时，点击窗口任意位置都可请求锁定（触控模式恒锁定，自动跳过）
    document.addEventListener('pointerdown', function (e) {
      if (state === 'playing' && !Voxel.Controls.isLocked() && e.target !== canvas) tryLock();
    });
    canvas.addEventListener('click', function () {
      if (state === 'playing' && !Voxel.Controls.isLocked()) tryLock();
    });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    document.addEventListener('fullscreenchange', onResize);
    document.addEventListener('webkitfullscreenchange', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    window.addEventListener('beforeunload', function () { doSave(true); });
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      showError('图形上下文丢失，请刷新页面（F5）重试');
    });

    document.getElementById('btn-start').addEventListener('click', function () {
      startWorld(saveData ? saveData.seed : null, saveData);
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
      if (Voxel.Save.has()) {
        openWorldReplaceDialog({
          trigger: document.getElementById('btn-new'),
          title: '创建新世界？',
          message: '将创建' + (sv === '' ? '一个随机世界' : '种子为 ' + sv + ' 的世界') +
            '。当前世界会先存入“上一存档”备份槽。',
          confirmLabel: '备份并创建',
          start: beginNewWorld
        });
      } else {
        Voxel.Save.clear();
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
        if (Voxel.Featured && Voxel.Featured.show) Voxel.Featured.show();
        setTimeout(function () {
          var firstCard = document.querySelector('.featured-card');
          if (firstCard) firstCard.focus();
        }, 0);
      });
      document.getElementById('btn-featured-back').addEventListener('click', function () {
        if (Voxel.Featured && Voxel.Featured.hide) Voxel.Featured.hide();
        setTimeout(function () { featuredMenuBtn.focus(); }, 0);
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
    document.getElementById('btn-save').addEventListener('click', function () { doSave(false); });
    document.getElementById('btn-respawn').addEventListener('click', function () {
      requestGameFullscreen(true);
      resume();
    });
    document.getElementById('btn-menu').addEventListener('click', gotoMenu);
    var starmapBtn = document.getElementById('btn-starmap-hud');
    if (starmapBtn) starmapBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); openStarMap();
    });
    var starmapClose = document.getElementById('btn-starmap-close');
    if (starmapClose) starmapClose.addEventListener('click', closeStarMap);

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
      document.getElementById('overlay-start').classList.add('hidden');
      document.getElementById('overlay-pause').classList.add('hidden');
      document.getElementById('overlay-settings').classList.remove('hidden');
    }
    function closeSettings() {
      document.getElementById('overlay-settings').classList.add('hidden');
      if (setReturn === 'paused') document.getElementById('overlay-pause').classList.remove('hidden');
      else document.getElementById('overlay-start').classList.remove('hidden');
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
      });
    }
    bindSlider('sens'); bindSlider('volume'); bindSlider('fov'); bindSlider('fog');
    bindSlider('tsens'); bindSlider('res');
    bindSlider('particleDensity'); bindSlider('rainDensity'); bindSlider('mobDensity');

    // 帧率上限按钮组（原生/30/60）
    var fpsBtns = document.querySelectorAll('#fps-cap-row button');
    function syncFpsButtons() {
      var cur = (Voxel.Settings ? Voxel.Settings.get('fpsCap') : 0) || 0;
      for (var i = 0; i < fpsBtns.length; i++)
        fpsBtns[i].classList.toggle('active', +fpsBtns[i].dataset.fps === cur);
    }
    for (var fbi = 0; fbi < fpsBtns.length; fbi++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          Voxel.Settings.set('fpsCap', +btn.dataset.fps);
          syncFpsButtons();
        });
      })(fpsBtns[fbi]);
    }
    syncFpsButtons();

    // 性能预设一键应用
    var presetBtns = document.querySelectorAll('#perf-preset-row button');
    function applyPreset(name, label) {
      var p = CFG.PERF_PRESETS && CFG.PERF_PRESETS[name];
      if (!p) return;
      for (var k in p) Voxel.Settings.set(k, p[k]);
      sliderSyncs.forEach(function (fn) { fn(); });
      syncFpsButtons();
      if (Voxel.HUD && Voxel.HUD.toast) Voxel.HUD.toast('已应用性能预设：' + label);
    }
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
    if (Voxel.Settings) {
      Voxel.Settings.onChange(function (k, v) {
        if (k === 'sens' && Voxel.Controls.setSens) Voxel.Controls.setSens(v);
        else if (k === 'volume' && Voxel.Sound.setVolume) Voxel.Sound.setVolume(v);
        else if (k === 'res') applyRes();
        else if (k === 'rainDensity' && Voxel.Weather && Voxel.Weather.setRainDensity)
          Voxel.Weather.setRainDensity(v);
        else if (k === 'mobDensity' && Voxel.Mobs && Voxel.Mobs.setDensity)
          Voxel.Mobs.setDensity(v);
      });
      Voxel.Settings.applyAll();
    }

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
