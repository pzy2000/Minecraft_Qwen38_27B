// 主逻辑：状态机、主循环、挖掘/放置、存档调度
window.Voxel = window.Voxel || {};

Voxel.Game = (function () {
  var CFG = Voxel.Config;
  var C = CFG.PLAYER;

  var state = 'loading';
  var renderer, scene, camera, canvas, highlight;
  var inv = [];
  for (var i0 = 0; i0 < 36; i0++) inv.push(0);
  var sel = 0, heldItem = 0;
  var saveData = null, pendingEdits = null;
  var mouseDown = [false, false, false];
  var lastDig = 0, lastPlace = 0;
  var autosaveT = 0, regenT = 0, lastHp = C.HP, lastDmgT = -99;
  var fps = 0, frames = 0, fpsT = 0;
  var debug = false;
  var lastT = 0;
  var lastErrT = 0;
  var lastBlankCheck = 0;

  function setState(s) { state = s; Game.state = s; }

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
    ['overlay-start', 'overlay-pause', 'overlay-dead', 'overlay-loading'].forEach(function (id) {
      document.getElementById(id).classList.add('hidden');
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

  function startWorld(s, sd) {
    Voxel.Sound.unlock();
    saveData = sd || null;
    pendingEdits = saveData ? saveData.edits : null;
    Voxel.World.clearMeshes(scene);
    Voxel.Mobs.clear();
    Voxel.Particles.clear();
    Voxel.World.init(s !== null && s !== undefined ? s : ((Math.random() * 0xFFFFFFFF) >>> 0));
    setState('loading');
    showOverlay('overlay-loading');
    tryLock();
  }

  function enterWorld() {
    hideOverlays();
    lastBlankCheck = performance.now(); // 进入后 3 秒内不做空白自检
    if (saveData) {
      if (saveData.inv && saveData.inv.length === 36) inv = saveData.inv.slice();
      heldItem = saveData.held || 0;
      Voxel.DayNight.setTime(saveData.time || 0.3);
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
        }
      } else Voxel.Player.initAtSpawn();
      Voxel.HUD.toast('存档已加载 · 种子 ' + saveData.seed);
    } else {
      Voxel.Player.initAtSpawn();
      // 新世界：显式重置视角（否则沿用上次残留的偏航/俯仰，可能正朝天看）
      Voxel.Controls.setYaw(0);
      Voxel.Controls.setPitch(-0.1);
      Voxel.HUD.toast('欢迎来到方块世界！');
    }
    // 防止存档视角几乎垂直（看天/看地）导致进游戏看不见地形
    var _pitch = Voxel.Controls.pitch();
    if (Math.abs(_pitch) > 0.9) {
      Voxel.Controls.setPitch(-0.2);
      Voxel.HUD.toast('视角已复位（原视角几乎垂直朝上/下）');
    }
    Voxel.HUD.setInv(inv);
    Voxel.HUD.drawHeld(heldItem);
    Voxel.HUD.setSelected(sel);
    Voxel.HUD.drawHealth(Voxel.Player.hp());
    lastHp = Voxel.Player.hp();
    autosaveT = 0;
    setState('playing');
  }

  function doSave(silent) {
    if (state !== 'playing' && state !== 'paused' && state !== 'inventory' && state !== 'dead') return false;
    var p = Voxel.Player.pos();
    var ok = Voxel.Save.save(Voxel.World, {
      time: Voxel.DayNight.time(),
      player: {
        pos: [p.x, p.y, p.z],
        yaw: Voxel.Controls.yaw(),
        pitch: Voxel.Controls.pitch(),
        fly: Voxel.Player.flying(),
        hp: Voxel.Player.hp()
      },
      inv: inv,
      held: heldItem
    });
    if (ok && !silent) Voxel.HUD.toast('游戏已存档');
    return ok;
  }

  // ---------- 交互 ----------

  function doAct(btn) {
    if (state !== 'playing') return;
    var o = Voxel.Player.eyePos();
    var d = Voxel.Player.lookDir();
    var hit = Voxel.Raycaster.cast(o, d, C.REACH);
    if (!hit) return;

    if (hit.type === 'mob') {
      if (btn === 0) Voxel.Mobs.damage(hit.mob, 2, d);
      return;
    }
    if (btn === 0) dig(hit);
    else if (btn === 2) place(hit);
  }

  function dig(hit) {
    if (hit.id === 12) return; // 基岩不可破坏
    var def = Voxel.Blocks.defs[hit.id];
    Voxel.World.set(hit.x, hit.y, hit.z, 0);
    addInv(hit.id);
    Voxel.Sound.dig(def.sound);
    Voxel.Particles.burst(new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5), def.color, 10);
  }

  function place(hit) {
    var id = inv[sel];
    if (!id) return;
    var x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
    var cur = Voxel.World.get(x, y, z);
    if (cur !== 0 && cur !== 7) return;
    var p = Voxel.Player.pos();
    var hw = C.W / 2 + 0.01;
    var overlap = x < p.x + hw && x + 1 > p.x - hw &&
      y < p.y + C.H + 0.01 && y + 1 > p.y &&
      z < p.z + hw && z + 1 > p.z - hw;
    if (overlap && Voxel.Blocks.isSolid(id)) return;
    Voxel.World.set(x, y, z, id);
    inv[sel] = 0;
    Voxel.HUD.setInv(inv);
    Voxel.Sound.place(Voxel.Blocks.defs[id].sound);
  }

  function pickBlock() {
    if (state !== 'playing') return;
    var hit = Voxel.Raycaster.cast(Voxel.Player.eyePos(), Voxel.Player.lookDir(), C.REACH);
    if (hit && hit.type === 'block' && hit.id !== 12) {
      inv[sel] = hit.id;
      Voxel.HUD.setInv(inv);
      Voxel.Sound.select();
    }
  }

  function addInv(id) {
    for (var i = 0; i < 9; i++) if (!inv[i]) { inv[i] = id; Voxel.HUD.setInv(inv); return; }
    for (var j = 9; j < 36; j++) if (!inv[j]) { inv[j] = id; Voxel.HUD.setInv(inv); return; }
    Voxel.HUD.toast('背包已满！');
  }

  function cycleSlot(d) {
    sel = (sel + d + 9) % 9;
    Voxel.HUD.setSelected(sel);
    Voxel.Sound.select();
  }

  function onInvClick(idx) {
    if (heldItem) {
      var cur = inv[idx];
      inv[idx] = heldItem;
      heldItem = cur;
    } else if (inv[idx]) {
      heldItem = inv[idx];
      inv[idx] = 0;
    } else return;
    Voxel.Sound.select();
    Voxel.HUD.setInv(inv);
    Voxel.HUD.drawHeld(heldItem);
  }

  function toggleInv(open) {
    if (open && state === 'playing') {
      setState('inventory');
      document.getElementById('inventory').classList.remove('hidden');
      Voxel.HUD.setInv(inv);
      Voxel.HUD.drawHeld(heldItem);
      Voxel.Controls.exitLock();
    } else if (!open && state === 'inventory') {
      if (heldItem) {
        var put = false;
        for (var i = 0; i < 9; i++) if (!inv[i]) { inv[i] = heldItem; put = true; break; }
        if (!put) for (var j = 9; j < 36; j++) if (!inv[j]) { inv[j] = heldItem; put = true; break; }
        if (!put) Voxel.HUD.toast('背包已满，物品丢失了！');
        heldItem = 0;
      }
      Voxel.HUD.setInv(inv);
      Voxel.HUD.drawHeld(0);
      document.getElementById('inventory').classList.add('hidden');
      setState('playing');
      tryLock();
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

  function onPlayerDead() {
    setState('dead');
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
    if (state === 'playing') {
      if (code >= 'Digit1' && code <= 'Digit9') {
        sel = +code.charAt(5) - 1;
        Voxel.HUD.setSelected(sel);
        Voxel.Sound.select();
      } else if (code === 'KeyE') toggleInv(true);
      else if (code === 'KeyF') {
        Voxel.Player.setFlying(!Voxel.Player.flying());
        Voxel.HUD.toast(Voxel.Player.flying() ? '飞行模式：开（空格↑ Shift↓）' : '飞行模式：关');
      } else if (code === 'F3') debug = !debug;
      else if (code === 'KeyP') pause();
    } else if (state === 'paused') {
      if (code === 'KeyP' || code === 'Escape') resume();
    } else if (state === 'inventory') {
      if (code === 'KeyE' || code === 'Escape') toggleInv(false);
    } else if (state === 'menu') {
      if (code === 'Enter') startWorld(saveData ? saveData.seed : null, saveData);
    }
  }

  // ---------- 主循环 ----------

  function updateHighlight() {
    if (state !== 'playing') { highlight.visible = false; return; }
    var hit = Voxel.Raycaster.cast(Voxel.Player.eyePos(), Voxel.Player.lookDir(), C.REACH);
    if (hit && hit.type === 'block') {
      highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      highlight.visible = true;
    } else highlight.visible = false;
  }

  function loop(now) {
    requestAnimationFrame(loop);
    frame(now);
  }

  function frame(now) {
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
    // 鼠标未锁定时常驻提示
    document.getElementById('lock-hint').style.display =
      (state === 'playing' && !Voxel.Controls.isLocked()) ? 'block' : 'none';
    checkBlankCanvas();
    updateErrorBanner();
  }

  function frameBody(dt) {
    frames++;
    fpsT += dt;
    if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }

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
      Voxel.World.buildMeshes(6, scene);
      var p = Voxel.World.progress();
      document.getElementById('loading-bar').style.width = (p * 100).toFixed(0) + '%';
      document.getElementById('loading-text').textContent =
        p < 1 ? '正在生成世界 ' + ((p * 100) | 0) + '%' : '正在构建地形...';
      if (Voxel.World.isReady() && Voxel.World.focusMeshed()) enterWorld();
    }

    if (state === 'playing') {
      var acc = dt, step = 1 / 60, n = 0;
      while (acc >= step && n < 5) {
        var nowS = performance.now() / 1000;
        if (mouseDown[0] && nowS - lastDig > C.DIG_CD) { lastDig = nowS; doAct(0); }
        if (mouseDown[2] && nowS - lastPlace > 0.25) { lastPlace = nowS; doAct(2); }
        Voxel.Player.update(step);
        Voxel.Mobs.update(step);
        acc -= step;
        n++;
      }
      if (n === 5) acc = 0;

      Voxel.DayNight.update(dt);
      Voxel.Particles.update(dt);
      updateHighlight();

      // 受伤检测（回血计时）
      var hp = Voxel.Player.hp();
      if (hp < lastHp) lastDmgT = performance.now() / 1000;
      lastHp = hp;
      if (hp > 0 && hp < C.HP && performance.now() / 1000 - lastDmgT > 6) {
        regenT += dt;
        if (regenT >= 4) { regenT = 0; Voxel.Player.heal(1); }
      } else regenT = 0;

      autosaveT += dt;
      if (autosaveT >= CFG.AUTOSAVE_INTERVAL) {
        autosaveT = 0;
        doSave(true);
        Voxel.HUD.toast('已自动存档');
      }
    }

    // 视觉色调（暂停时也保持）
    var tint = Voxel.DayNight.getTint();
    Voxel.MeshBuilder.applyTint(tint);
    Voxel.Particles.applyTint(tint);
    Voxel.Mobs.applyTint(tint);
    var sky = Voxel.DayNight.getSky();
    renderer.setClearColor(sky);
    scene.fog.color.copy(sky);

    if (state === 'playing') {
      Voxel.World.setFocus(Voxel.Player.pos().x, Voxel.Player.pos().z);
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
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
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
    cycleSlot: cycleSlot
  };

  function init() {
    canvas = document.getElementById('game');
    Voxel.HUD.init();
    Voxel.MeshBuilder.init();

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x87ceeb, CFG.FOG_NEAR, CFG.FOG_FAR);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1200);
    camera.rotation.order = 'YXZ';

    highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.65 })
    );
    highlight.visible = false;

    Voxel.DayNight.init(scene);
    Voxel.Particles.init();
    Voxel.Mobs.init(scene);
    Voxel.Controls.init(canvas);

    Game.scene = scene;
    Game.camera = camera;
    scene.add(highlight);

    canvas.addEventListener('mousedown', function (e) {
      if (state !== 'playing') return;
      if (!Voxel.Controls.isLocked()) { tryLock(); return; }
      mouseDown[e.button] = true;
      var nowS = performance.now() / 1000;
      if (e.button === 0) { lastDig = nowS - C.DIG_CD; doAct(0); }
      else if (e.button === 2) { lastPlace = nowS - 0.3; doAct(2); }
      else if (e.button === 1) pickBlock();
      e.preventDefault();
    });
    document.addEventListener('mouseup', function (e) { mouseDown[e.button] = false; });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // 游戏中未锁定时，点击窗口任意位置都可请求锁定
    document.addEventListener('mousedown', function (e) {
      if (state === 'playing' && !Voxel.Controls.isLocked() && e.target !== canvas) tryLock();
    });
    canvas.addEventListener('click', function () {
      if (state === 'playing' && !Voxel.Controls.isLocked()) tryLock();
    });
    window.addEventListener('resize', onResize);
    window.addEventListener('beforeunload', function () { doSave(true); });
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      showError('图形上下文丢失，请刷新页面（F5）重试');
    });

    document.getElementById('btn-start').addEventListener('click', function () {
      startWorld(saveData ? saveData.seed : null, saveData);
    });
    document.getElementById('btn-new').addEventListener('click', function () {
      Voxel.Save.clear();
      startWorld(null, null);
    });
    document.getElementById('btn-new2').addEventListener('click', function () {
      Voxel.Save.clear();
      startWorld(null, null);
    });
    document.getElementById('btn-resume').addEventListener('click', resume);
    document.getElementById('btn-save').addEventListener('click', function () { doSave(false); });
    document.getElementById('btn-respawn').addEventListener('click', resume);

    var sd = Voxel.Save.load();
    if (sd) {
      saveData = sd;
      document.getElementById('start-hint').textContent = '检测到存档 · 种子 ' + sd.seed;
    } else {
      document.getElementById('btn-start').textContent = '开始游戏';
      document.getElementById('start-hint').textContent = '将生成一个全新的随机世界';
    }

    setState('menu');
    requestAnimationFrame(loop);
  }

  Game.init = init;
  Game._frame = frame; // 测试钩子：手动驱动一帧
  return Game;
})();

// 启动
Voxel.Game.init();
