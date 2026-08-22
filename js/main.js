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
  var sel = 0, heldItem = 0, heldCnt = 0;
  var craftGrid = [0, 0, 0, 0, 0, 0, 0, 0, 0];   // 工作台 3x3（每格 1 个）
  var invCraftGrid = [0, 0, 0, 0];               // 背包 2x2（每格 1 个）
  var manualOpen = false;
  var saveData = null, pendingEdits = null;
  var mouseDown = [false, false, false];
  var lastDig = 0, lastPlace = 0;
  var autosaveT = 0, regenT = 0, lastHp = C.HP, lastDmgT = -99;
  // 长按挖掘进度
  var digT = null, digProg = 0, digNeed = 0, digHintT = 0, digSndT = 0;
  var crackMesh = null, crackTex = [];
  var fps = 0, frames = 0, fpsT = 0;
  var debug = false;
  var lastT = 0;
  var lastErrT = 0;
  var lastBlankCheck = 0;
  var _tint = new THREE.Color(), _sky = new THREE.Color(), _skyTop = new THREE.Color();

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
    ['overlay-start', 'overlay-pause', 'overlay-dead', 'overlay-loading', 'crafting', 'manual'].forEach(function (id) {
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
    Voxel.Weather.reset();
    Voxel.World.init(s !== null && s !== undefined ? s : ((Math.random() * 0xFFFFFFFF) >>> 0));
    setState('loading');
    showOverlay('overlay-loading');
    tryLock();
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
        }
      } else Voxel.Player.initAtSpawn();
      Voxel.Player.setBed(saveData.bed ? new THREE.Vector3(saveData.bed[0], saveData.bed[1], saveData.bed[2]) : null);
      Voxel.HUD.toast('存档已加载 · 种子 ' + saveData.seed);
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
      Voxel.HUD.toast('欢迎来到方块世界！');
    }
    // 防止存档视角几乎垂直（看天/看地）导致进游戏看不见地形
    var _pitch = Voxel.Controls.pitch();
    if (Math.abs(_pitch) > 0.9) {
      Voxel.Controls.setPitch(-0.2);
      Voxel.HUD.toast('视角已复位（原视角几乎垂直朝上/下）');
    }
    Voxel.HUD.setInv(inv, cnt);
    Voxel.HUD.drawHeld(heldItem);
    Voxel.HUD.setSelected(sel);
    Voxel.HUD.drawHealth(Voxel.Player.hp());
    lastHp = Voxel.Player.hp();
    autosaveT = 0;
    setState('playing');
  }

  function doSave(silent) {
    if (state !== 'playing' && state !== 'paused' && state !== 'inventory' && state !== 'crafting' && state !== 'dead') return false;
    var p = Voxel.Player.pos();
    var bed = Voxel.Player.getBed();
    var ok = Voxel.Save.save(Voxel.World, {
      time: Voxel.DayNight.time(),
      weather: Voxel.Weather.stateName(),
      player: {
        pos: [p.x, p.y, p.z],
        yaw: Voxel.Controls.yaw(),
        pitch: Voxel.Controls.pitch(),
        fly: Voxel.Player.flying(),
        hp: Voxel.Player.hp()
      },
      inv: inv,
      cnt: cnt,
      held: heldItem,
      heldCnt: heldCnt,
      bed: bed ? [bed.x, bed.y, bed.z] : null
    });
    if (ok && !silent) Voxel.HUD.toast('游戏已存档');
    return ok;
  }

  // ---------- 背包堆叠辅助 ----------
  // inv[i]=物品ID，cnt[i]=数量（cnt=0 即空格）

  function invTotal(id) {
    var n = 0;
    for (var i = 0; i < 36; i++) if (inv[i] === id) n += cnt[i];
    return n;
  }

  function freeFor(id) {
    var room = 0;
    for (var i = 0; i < 36; i++) {
      if (!inv[i]) { room += MAX_STACK; continue; }
      if (inv[i] === id) room += MAX_STACK - cnt[i];
    }
    return room;
  }

  function canAddInv(id, n) { return freeFor(id) >= (n || 1); }

  // 加入 n 个，返回实际加入数（优先并入已有堆叠，快捷栏优先）
  function addInv(id, n) {
    n = n || 1;
    var added = 0;
    for (var pass = 0; pass < 2 && added < n; pass++) {
      for (var i = 0; i < 36 && added < n; i++) {
        if (pass === 0 && (inv[i] !== id || !cnt[i] || cnt[i] >= MAX_STACK)) continue;
        if (pass === 1 && inv[i]) continue;
        var base = (pass === 1) ? 0 : cnt[i];
        var take = Math.min(n - added, MAX_STACK - base);
        if (take <= 0) continue;
        inv[i] = id;
        cnt[i] = base + take;
        added += take;
      }
    }
    if (added > 0) Voxel.HUD.setInv(inv, cnt);
    return added;
  }

  function decSel() {
    cnt[sel]--;
    if (cnt[sel] <= 0) { cnt[sel] = 0; inv[sel] = 0; }
    Voxel.HUD.setInv(inv, cnt);
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
    var d = Voxel.Player.lookDir();
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

    // 周期性敲击声 + 碎屑粒子（挖掘进行中）
    digSndT -= dt;
    if (digSndT <= 0) {
      digSndT = 0.22;
      Voxel.Sound.digTick(def.sound);
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
    Voxel.World.set(t.x, t.y, t.z, 0);
    addInv(dropId, 1);
    Voxel.Sound.dig(def.sound);
    Voxel.Particles.burst(new THREE.Vector3(t.x + 0.5, t.y + 0.5, t.z + 0.5), def.color, 10);
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
        Voxel.HUD.setInv(inv, cnt);
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
    Voxel.HUD.setInv(inv, cnt);
    Voxel.HUD.setSelected(sel);
    Voxel.Sound.select();
  }

  // 生物掉落 → 背包
  function onDrop(id, n) {
    n = n || 1;
    var got = addInv(id, n);
    if (got >= n) Voxel.HUD.toast('获得 ' + Voxel.Blocks.name(id) + (n > 1 ? ' ×' + n : ''));
    else if (got > 0) Voxel.HUD.toast('获得 ' + Voxel.Blocks.name(id) + ' ×' + got + '（背包空间不足）');
    else Voxel.HUD.toast('背包已满！掉落物丢失了');
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
    Voxel.HUD.setInv(inv, cnt);
    Voxel.HUD.drawHeld(heldItem);
    refreshCraft();
    Voxel.Controls.exitLock();
  }

  function closeCrafting() {
    if (state !== 'crafting') return;
    if (heldItem) {
      var got = addInv(heldItem, heldCnt);
      if (got < heldCnt) Voxel.HUD.toast('背包已满，部分物品丢失了！');
      heldItem = 0; heldCnt = 0;
    }
    returnGridToInv(craftGrid);
    Voxel.HUD.setInv(inv, cnt);
    Voxel.HUD.drawHeld(0);
      document.getElementById('crafting').classList.add('hidden');
      document.body.classList.remove('panel-open');
      setState('playing');
    tryLock();
  }

  // 格子统一读写：inv 有堆叠数量；合成格每格固定 1 个
  function slotGet(loc, i) {
    if (loc === 'inv') return { id: inv[i], n: cnt[i] };
    if (loc === 'icraft') return { id: invCraftGrid[i], n: invCraftGrid[i] ? 1 : 0 };
    return { id: craftGrid[i], n: craftGrid[i] ? 1 : 0 };
  }

  function slotSet(loc, i, id, n) {
    if (loc === 'inv') { inv[i] = id; cnt[i] = id ? n : 0; }
    else if (loc === 'icraft') invCraftGrid[i] = id;
    else craftGrid[i] = id;
  }

  // 手持 ↔ 格子交互（拾取/放置/合并/交换）。返回是否发生变化。
  function handToSlot(loc, i) {
    var s = slotGet(loc, i);
    var changed = true;
    if (!heldItem) {
      if (!s.id) changed = false;
      else { // 拾取整格（合成格即 1 个）
        heldItem = s.id; heldCnt = s.n;
        slotSet(loc, i, 0, 0);
      }
    } else if (!s.id) {
      if (loc === 'inv') { // 放置整手
        slotSet(loc, i, heldItem, heldCnt);
        heldItem = 0; heldCnt = 0;
      } else {             // 合成格只收 1 个，余量留在手上
        slotSet(loc, i, heldItem, 1);
        heldCnt--;
        if (heldCnt <= 0) { heldItem = 0; heldCnt = 0; }
      }
    } else if (s.id === heldItem) {
      if (loc === 'inv' && s.n < MAX_STACK && heldCnt > 0 && heldCnt < MAX_STACK * 2) {
        // 同物并入格子
        var move = Math.min(MAX_STACK - s.n, heldCnt);
        if (move > 0) {
          slotSet(loc, i, heldItem, s.n + move);
          heldCnt -= move;
          if (heldCnt <= 0) { heldItem = 0; heldCnt = 0; }
        } else changed = false;
      } else if (loc !== 'inv') {
        // 合成格已有同物：拿回 1 个
        heldCnt++;
        slotSet(loc, i, 0, 0);
      } else changed = false;
    } else {
      if (loc === 'inv' || heldCnt === 1) {
        // 不同物品：整手 ↔ 整格交换（合成格按 1 个计）
        slotSet(loc, i, heldItem, loc === 'inv' ? heldCnt : 1);
        heldItem = s.id; heldCnt = s.n;
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

  // 拖放：源格 → 目标格（不经过手持）
  function transferSlots(fl, fi, tl, ti) {
    var src = slotGet(fl, fi);
    if (!src.id || (fl === tl && fi === ti)) return false;
    var dst = slotGet(tl, ti);
    if (!dst.id) {
      if (tl === 'inv') { slotSet(tl, ti, src.id, src.n); slotSet(fl, fi, 0, 0); }
      else { slotSet(tl, ti, src.id, 1); decSlotBy(fl, fi, 1); }
      return true;
    }
    if (src.id === dst.id) {
      if (tl === 'inv' && dst.n < MAX_STACK) {
        var move = Math.min(MAX_STACK - dst.n, src.n);
        slotSet(tl, ti, dst.id, dst.n + move);
        decSlotBy(fl, fi, move);
        return true;
      }
      return false;
    }
    // 不同物：整格交换
    slotSet(tl, ti, src.id, tl === 'inv' ? src.n : 1);
    slotSet(fl, fi, dst.id, fl === 'inv' ? dst.n : (dst.id ? 1 : 0));
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
    Voxel.HUD.setInv(inv, cnt);
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
    Voxel.HUD.setInv(inv, cnt);
    refreshInvCraft();
  }

  // 关闭面板时把合成格里的物品退回背包（堆叠收纳，空间足够）
  function returnGridToInv(grid) {
    var changed = false;
    for (var g = 0; g < grid.length; g++) {
      if (!grid[g]) continue;
      if (addInv(grid[g], 1) > 0) { grid[g] = 0; changed = true; }
    }
    return changed;
  }

  // ---------- 拖拽（点击拾取仍可用：按下未移动即拾取到手持） ----------
  var dragState = null;

  function refreshPanel(from) {
    if (from === 'inv') Voxel.HUD.setInv(inv, cnt);
    else if (from === 'icraft') refreshInvCraft();
    else refreshCraft();
  }

  function onSlotDown(e, from, idx) {
    if (e.button !== 0) return;
    if (from === 'icraft' && state !== 'inventory') return;
    if (from === 'craft' && state !== 'crafting') return;
    if (from === 'inv' && state !== 'inventory' && state !== 'crafting') return;
    e.preventDefault();
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
      Voxel.HUD.setInv(inv, cnt);
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
    if (to !== 'inv' && to !== 'craft' && to !== 'icraft') return;
    if (d.fromHand) {
      // 手持物拖放
      handToSlot(to, tIdx);
      Voxel.HUD.setInv(inv, cnt);
      Voxel.HUD.drawHeld(heldItem);
      refreshPanel(to);
      return;
    }
    if (to === d.from && tIdx === d.idx) return; // 丢回原格：取消
    transferSlots(d.from, d.idx, to, tIdx);
    Voxel.Sound.select();
    Voxel.HUD.setInv(inv, cnt);
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
    var need = Voxel.Crafting.needed(r), drained = 0;
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
    Voxel.HUD.setInv(inv, cnt);
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

  function cycleSlot(d) {
    sel = (sel + d + 9) % 9;
    Voxel.HUD.setSelected(sel);
    Voxel.Sound.select();
  }

  function onInvClick(idx) {
    if (state !== 'inventory' && state !== 'crafting') return;
    if (handToSlot('inv', idx)) {
      Voxel.HUD.setInv(inv, cnt);
      Voxel.HUD.drawHeld(heldItem);
    }
  }

  function toggleInv(open) {
    if (open && state === 'playing') {
      setState('inventory');
      document.body.classList.add('panel-open');
      document.getElementById('inventory').classList.remove('hidden');
      Voxel.HUD.setInv(inv, cnt);
      Voxel.HUD.drawHeld(heldItem);
      refreshInvCraft();
      Voxel.Controls.exitLock();
    } else if (!open && state === 'inventory') {
      if (heldItem) {
        var got = addInv(heldItem, heldCnt);
        if (got < heldCnt) Voxel.HUD.toast('背包已满，部分物品丢失了！');
        heldItem = 0; heldCnt = 0;
      }
      returnGridToInv(invCraftGrid);
      Voxel.HUD.setInv(inv, cnt);
      Voxel.HUD.drawHeld(0);
      document.getElementById('inventory').classList.add('hidden');
      document.body.classList.remove('panel-open');
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
        // 准星对准工作台 → 打开合成；对准床 → 睡觉/设置重生点；否则开背包
        var hit = Voxel.Raycaster.cast(Voxel.Player.eyePos(), Voxel.Player.lookDir(), C.REACH);
        if (hit && hit.type === 'block' && hit.id === 15) openCrafting();
        else if (hit && hit.type === 'block' && hit.id === 17) useBed(hit);
        else toggleInv(true);
      } else if (code === 'KeyF') {
        Voxel.Player.setFlying(!Voxel.Player.flying());
        Voxel.HUD.toast(Voxel.Player.flying() ? '飞行模式：开（空格↑ Shift↓）' : '飞行模式：关');
      } else if (code === 'KeyG') {
        Voxel.Weather.next();
        Voxel.HUD.toast('天气切换：' + Voxel.Weather.label());
      } else if (code === 'F3') debug = !debug;
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
    } else if (state === 'menu') {
      if (code === 'Enter') startWorld(saveData ? saveData.seed : null, saveData);
      else if (code === 'KeyM') openManual();
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
    var hit = Voxel.Raycaster.cast(Voxel.Player.eyePos(), Voxel.Player.lookDir(), C.REACH);
    if (hit && hit.type === 'block') {
      highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      highlight.visible = true;
    } else highlight.visible = false;
    if (hit && hit.type === 'block' && hit.id === 15) {
      hitEl.textContent = '按 E 打开工作台';
      hitEl.style.display = 'block';
    } else if (hit && hit.type === 'block' && hit.id === 17) {
      hitEl.textContent = Voxel.DayNight.isNight() ? '按 E 睡觉（并设置重生点）' : '按 E 设置重生点';
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
      // 地形就绪后先算光照（一次性），再渐进建网格
      if (Voxel.World.isReady() && !Voxel.World.lightReady()) Voxel.World.initLight();
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
        if (mouseDown[0] && nowS - lastPlace > 0.25) { lastPlace = nowS; doAct(0); }
        if (mouseDown[2]) tickDig(step);
        else if (digT || digProg) stopDig();
        Voxel.Player.update(step);
        Voxel.Mobs.update(step);
        acc -= step;
        n++;
      }
      if (n === 5) acc = 0;
      if (!mouseDown[2] && (digT || digProg)) stopDig();

      Voxel.DayNight.update(dt);
      Voxel.Weather.update(dt);
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

    // 视觉色调（暂停时也保持）：昼夜 × 天气（穹顶/背景/雾/地形同步）
    var wF = Voxel.Weather.rainFactor();
    var wFlash = Voxel.Weather.flash();
    _tint.copy(Voxel.DayNight.getTint()).multiply(Voxel.Weather.getTint());
    Voxel.MeshBuilder.applyTint(_tint);
    Voxel.Particles.applyTint(_tint);
    Voxel.Mobs.applyTint(_tint);
    _skyTop.copy(Voxel.DayNight.topColor()).lerp(Voxel.Weather.getSkyTop(), wF * 0.85);
    _sky.copy(Voxel.DayNight.horizonColor()).lerp(Voxel.Weather.getSky(), wF * 0.85);
    if (wFlash > 0) {
      _skyTop.r += wFlash * 0.9; _skyTop.g += wFlash * 0.92; _skyTop.b += wFlash * 0.95;
      _sky.r += wFlash * 0.85; _sky.g += wFlash * 0.88; _sky.b += wFlash * 0.95;
    }
    Voxel.DayNight.applySky(_skyTop, _sky);
    renderer.setClearColor(_sky);
    scene.fog.color.copy(_sky);
    var fogNear = CFG.FOG_NEAR + (CFG.WEATHER.FOG_NEAR_WET - CFG.FOG_NEAR) * wF;
    var fogFar = CFG.FOG_FAR + (CFG.WEATHER.FOG_FAR_WET - CFG.FOG_FAR) * wF;
    scene.fog.near = fogNear;
    scene.fog.far = fogFar;

    // 双通道光照：天光随昼夜（保留月光下限），块光（火把）恒定
    if (Voxel.MeshBuilder.setSun) {
      Voxel.MeshBuilder.setSun(Math.max(0.2, Voxel.DayNight.sunlight()));
      Voxel.MeshBuilder.setEnv(_sky, fogNear, fogFar);
    }

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
        '  天气 ' + Voxel.Weather.label() + (Voxel.Weather.rainbowVisible() ? ' 彩虹' : '') +
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
    onCraftClick: onCraftClick,
    onResultClick: onResultClick,
    onInvCraftClick: onInvCraftClick,
    onInvResultClick: onInvResultClick,
    onSlotDown: onSlotDown,
    onDrop: onDrop,
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
      setInv: function (i, id) { inv[i] = id; cnt[i] = id ? 1 : 0; Voxel.HUD.setInv(inv, cnt); },
      clearInv: function () {
        for (var i = 0; i < 36; i++) { inv[i] = 0; cnt[i] = 0; }
        heldItem = 0; heldCnt = 0;
        Voxel.HUD.setInv(inv, cnt);
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
      crackVisible: function () { return !!(crackMesh && crackMesh.visible); },
      digProgress: function () { return { t: digT, p: digProg, need: digNeed }; }
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
    Voxel.Controls.init(canvas);

    Game.scene = scene;
    Game.camera = camera;
    scene.add(highlight);
    scene.add(crackMesh);

    canvas.addEventListener('mousedown', function (e) {
      if (state !== 'playing') return;
      if (!Voxel.Controls.isLocked()) { tryLock(); return; }
      mouseDown[e.button] = true;
      var nowS = performance.now() / 1000;
      if (e.button === 0) { lastPlace = nowS - 0.3; doAct(0); }
      else if (e.button === 2) { lastDig = 0; doAct(2); } // 攻击冷却在 attack() 内判定
      else if (e.button === 1) pickBlock();
      e.preventDefault();
    });
    document.addEventListener('mouseup', function (e) { mouseDown[e.button] = false; });
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragUp);
    window.addEventListener('blur', function () {
      if (dragState) { dragState = null; Voxel.HUD.endGhost(); } // 窗口外松开：取消拖拽
    });
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
