// HUD：准星、快捷栏、背包、工作台、合成手册、血量、调试、提示
window.Voxel = window.Voxel || {};

Voxel.HUD = (function () {
  var atlas = null;
  var slots = [], invSlots = [], craftSlots = [], craftInvSlots = [], invCraftSlots = [];
  var furInSlot = null, furFuelSlot = null, furOutSlot = null, furInvSlots = [];
  var chestSlots = [], chestInvSlots = [], chestHeldCanvas = null;
  var gearHeadSlot = null, gearBodySlot = null, gearChargeSlot = null;
  var manualBtns = [];
  var healthCtx, debugEl, toastEl, heldCanvas, craftHeldCanvas, furHeldCanvas;
  var environmentEl = null, environmentFillEl = null, environmentLabelEl = null;
  var environmentDetailEl = null, environmentValueEl = null, environmentIntensityEl = null;
  var resultSlot = null, invResultSlot = null;
  var lastCraftGrid = [], lastInvCraftGrid = [];
  var selectedHotbar = 0;
  var hungerCtx = null;
  var HEART = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
  // 鸡腿：右上肉块 + 左下腿骨
  var DRUMSTICK = [
    '0001111',
    '0011111',
    '0111110',
    '0111100',
    '1100000',
    '1100000'
  ];

  function decorateCanvas(canvas) {
    if (!canvas) return canvas;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('focusable', 'false');
    return canvas;
  }

  function slotName(prefix, idx, total) {
    return prefix + '第 ' + (idx + 1) + '/' + total + ' 格';
  }

  // HUD 是存档损坏的最后一道边界：工具耐久只接受有限数，并统一取整/夹取。
  // 旧档缺失耐久时与背包 syncDur 语义一致，按满耐久恢复。
  function normalizeMaxDur(maxDur) {
    if (typeof maxDur !== 'number' || !isFinite(maxDur) || maxDur <= 0) return null;
    return Math.max(1, Math.floor(maxDur));
  }

  function normalizeDur(dur, maxDur) {
    var max = normalizeMaxDur(maxDur);
    if (max === null) return null;
    if (typeof dur !== 'number' || !isFinite(dur)) return max;
    return Math.max(0, Math.min(max, Math.round(dur)));
  }

  function slotDescription(label, id, count, dur, maxDur) {
    var text = (typeof label === 'string' && label ? label : '物品格') + '，';
    if (!id) return text + '空';
    var amount = Number(count);
    if (!isFinite(amount) || amount < 1) amount = 1;
    text += Voxel.Blocks.name(id) + '，数量 ' + Math.floor(amount);
    var safeDur = normalizeDur(dur, maxDur);
    if (safeDur !== null) text += '，耐久 ' + safeDur + '/' + normalizeMaxDur(maxDur);
    return text;
  }

  function describeSlot(slot, id, count, dur, maxDur) {
    if (!slot || !slot.el) return;
    slot.el.setAttribute('aria-label', slotDescription(slot.label, id, count, dur, maxDur));
  }

  function renderSlot(slot, id, count, dur, maxDur) {
    if (!slot) return;
    drawIcon(slot.canvas, id, count, dur, maxDur);
    describeSlot(slot, id, count, dur, maxDur);
  }

  function setRovingIndex(group, index, focusIt) {
    if (!group || !group.items.length) return;
    index = Math.max(0, Math.min(group.items.length - 1, index | 0));
    group.index = index;
    for (var i = 0; i < group.items.length; i++)
      group.items[i].el.tabIndex = i === index ? 0 : -1;
    var target = group.items[index].el;
    if (focusIt) {
      target.focus({ preventScroll: true });
      if (target.scrollIntoView) {
        try { target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        catch (e) { target.scrollIntoView(); }
      }
    }
  }

  function moveRoving(slot, key) {
    var group = slot && slot.roving;
    if (!group) return false;
    var index = group.items.indexOf(slot);
    if (index < 0) return false;
    var columns = group.columns;
    var next = index;
    if (key === 'ArrowLeft' && index % columns > 0) next--;
    else if (key === 'ArrowRight' && index % columns < columns - 1 && index + 1 < group.items.length) next++;
    else if (key === 'ArrowUp' && index - columns >= 0) next -= columns;
    else if (key === 'ArrowDown' && index + columns < group.items.length) next += columns;
    else return false;
    setRovingIndex(group, next, true);
    return true;
  }

  function slotKeydown(e, slot, action) {
    if (e.isComposing || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    if (/^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
      if (moveRoving(slot, e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    var secondary = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
    var activate = e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';
    if (!activate && !secondary) return;
    e.preventDefault();
    e.stopPropagation();
    var quickMove = e.key === 'Enter' && e.shiftKey;
    if (action) action();
    else if (slot.hotbar && activate && !quickMove && Voxel.Game && Voxel.Game.selectHotbar)
      Voxel.Game.selectHotbar(slot.index);
    else if (Voxel.Game && Voxel.Game.onSlotKeyboard)
      Voxel.Game.onSlotKeyboard(slot.type, slot.index, {
        shift: quickMove,
        secondary: secondary
      });
  }

  function bindSlot(el, canvas, slotType, idx, label) {
    if (el.tagName !== 'BUTTON') {
      el.setAttribute('role', 'button');
      el.tabIndex = -1;
    } else {
      el.type = 'button';
      el.tabIndex = -1;
    }
    decorateCanvas(canvas);
    var slot = { el: el, canvas: canvas, type: slotType || '', index: idx || 0, label: label };
    describeSlot(slot, 0);
    if (slotType) {
      el.setAttribute('data-slot', slotType + ':' + idx);
      el.addEventListener('pointerdown', function (e) { Voxel.Game.onSlotDown(e, slotType, idx); });
      el.addEventListener('keydown', function (e) { slotKeydown(e, slot); });
    }
    return slot;
  }

  function setupRoving(container, items, columns, label, initialIndex) {
    if (!container || !items.length) return null;
    container.setAttribute('role', container.id === 'hotbar' ? 'toolbar' : 'group');
    if (label) container.setAttribute('aria-label', label);
    var group = { items: items, columns: Math.max(1, columns | 0), index: 0 };
    for (var i = 0; i < items.length; i++) {
      items[i].roving = group;
      (function (slot, index) {
        slot.el.addEventListener('focus', function () { setRovingIndex(group, index, false); });
      })(items[i], i);
    }
    setRovingIndex(group, initialIndex || 0, false);
    return group;
  }

  function bindActionSlot(el, canvas, label, action) {
    var slot = bindSlot(el, canvas, '', 0, label);
    el.addEventListener('keydown', function (e) { slotKeydown(e, slot, action); });
    el.tabIndex = 0;
    return slot;
  }

  function makeSlot(cls, slotType, idx, label) {
    var d = document.createElement('button');
    d.type = 'button';
    d.className = 'slot' + (cls ? ' ' + cls : '');
    var c = document.createElement('canvas');
    c.width = 44; c.height = 44;
    d.appendChild(c);
    return bindSlot(d, c, slotType, idx, label);
  }

  function buildManual() {
    var list = document.getElementById('manual-list');
    // 材料获取说明
    var ob = document.createElement('div');
    ob.className = 'manual-obtain';
    ob.innerHTML = '<b>材料获取</b><br>· 砍伐树干获得 <b>任意原木</b>（橡木/云杉木/丛林木均可合成木板）<br>· 攻击并击杀 <b>羊</b> 掉落 <b>羊毛</b><br>· 下方每条配方可 <b>一键合成</b>（自动消耗背包材料，<b>长按连续合成</b>）';
    list.appendChild(ob);

    for (var i = 0; i < Voxel.Crafting.recipes.length; i++) {
      var r = Voxel.Crafting.recipes[i];
      var row = document.createElement('div');
      row.className = 'recipe-row';

      var left = document.createElement('div');
      if (r.shapeless) {
        left.className = 'recipe-single';
        var ib = document.createElement('div');
        ib.className = 'icon-box';
        var ic = decorateCanvas(document.createElement('canvas'));
        ic.width = 44; ic.height = 44;
        ib.appendChild(ic);
        left.appendChild(ib);
        var note = document.createElement('div');
        note.className = 'recipe-note';
        note.textContent = '任意位置';
        left.appendChild(note);
        (function (cv, id) { drawIcon(cv, id); })(ic, firstInput(r.alts ? r.alts[0] : r.inputs));
      } else {
        left.className = 'recipe-grid';
        for (var k = 0; k < 9; k++) {
          var cell = document.createElement('div');
          cell.className = 'recipe-cell';
          if (r.grid[k]) {
            var cv = decorateCanvas(document.createElement('canvas'));
            cv.width = 44; cv.height = 44;
            cell.appendChild(cv);
            (function (c2, id) { drawIcon(c2, id); })(cv, r.grid[k]);
          }
          left.appendChild(cell);
        }
      }
      row.appendChild(left);

      var arrow = document.createElement('div');
      arrow.className = 'recipe-arrow';
      arrow.textContent = '→';
      row.appendChild(arrow);

      var res = document.createElement('div');
      res.className = 'recipe-result';
      var rb = document.createElement('div');
      rb.className = 'icon-box';
      var rc = decorateCanvas(document.createElement('canvas'));
      rc.width = 44; rc.height = 44;
      rb.appendChild(rc);
      res.appendChild(rb);
      var rn = document.createElement('div');
      rn.className = 'recipe-name';
      rn.textContent = Voxel.Blocks.name(r.result) + (r.count > 1 ? ' ×' + r.count : '');
      res.appendChild(rn);
      row.appendChild(res);
      drawIcon(rc, r.result);

      var btn = document.createElement('button');
      btn.className = 'btn craft-btn';
      btn.setAttribute('data-recipe', i);
      (function (idx) {
        btn.addEventListener('pointerdown', function (e) { e.preventDefault(); Voxel.Game.manualCraftStart(idx); });
        btn.addEventListener('pointerup', function () { Voxel.Game.manualCraftStop(); });
        btn.addEventListener('pointercancel', function () { Voxel.Game.manualCraftStop(); });
        btn.addEventListener('mouseleave', function () { Voxel.Game.manualCraftStop(); });
        // 键盘激活只合成一次：同步 start/stop 会执行首件但不会留下长按 interval。
        // 截断冒泡，避免 Space/Enter 同时触发游戏全局快捷键；重复键与IME组合态忽略。
        btn.addEventListener('keydown', function (e) {
          if (e.isComposing || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          e.stopPropagation();
          Voxel.Game.manualCraftStart(idx);
          Voxel.Game.manualCraftStop();
        });
      })(i);
      row.appendChild(btn);
      manualBtns.push(btn);

      list.appendChild(row);
    }

    // 烧炼章节（熔炉，信息展示，无一键按钮）
    var FS = Voxel.FurnaceSys;
    if (FS && FS.SMELT_TABLE) {
      var sh = document.createElement('div');
      sh.className = 'manual-obtain';
      sh.innerHTML = '<b>烧炼（熔炉）</b><br>· 8 块<b>石头</b>合成熔炉，对准按 E 打开<br>· <b>燃料</b>：煤炭/木炭（各可烧 8 件）/ 木板 / 木棍 / 原木<br>· <b>木炭</b>：任意原木烧制而成，也是防毒面具的滤芯材料';
      list.appendChild(sh);
      for (var sid in FS.SMELT_TABLE) {
        var srow = document.createElement('div');
        srow.className = 'recipe-row';
        var sl = document.createElement('div');
        sl.className = 'recipe-single';
        var sib = document.createElement('div');
        sib.className = 'icon-box';
        var sic = decorateCanvas(document.createElement('canvas'));
        sic.width = 44; sic.height = 44;
        sib.appendChild(sic);
        sl.appendChild(sib);
        drawIcon(sic, +sid);
        srow.appendChild(sl);
        var sar = document.createElement('div');
        sar.className = 'recipe-arrow';
        sar.textContent = '🔥→';
        srow.appendChild(sar);
        var sres = document.createElement('div');
        sres.className = 'recipe-result';
        var srb = document.createElement('div');
        srb.className = 'icon-box';
        var src2 = decorateCanvas(document.createElement('canvas'));
        src2.width = 44; src2.height = 44;
        srb.appendChild(src2);
        sres.appendChild(srb);
        var srn = document.createElement('div');
        srn.className = 'recipe-name';
        srn.textContent = Voxel.Blocks.name(FS.SMELT_TABLE[sid]);
        sres.appendChild(srn);
        srow.appendChild(sres);
        drawIcon(src2, FS.SMELT_TABLE[sid]);
        list.appendChild(srow);
      }
    }
  }

  // 刷新手册合成按钮（可合成次数 / 材料不足）
  function refreshManual() {
    for (var i = 0; i < manualBtns.length; i++) {
      var n = Voxel.Game ? Voxel.Game.manualCraftable(i) : 0;
      manualBtns[i].textContent = n > 0 ? '合成 ×' + n : '材料不足';
      manualBtns[i].disabled = n <= 0;
    }
  }

  function firstInput(inputs) {
    for (var k in inputs) return +k;
    return 0;
  }

  function init() {
    atlas = Voxel.Blocks.getAtlas();

    var hotbarEl = document.getElementById('hotbar');
    for (var i = 0; i < 9; i++) {
      (function (idx) {
        var s = makeSlot('', 'inv', idx, slotName('快捷栏', idx, 9));
        s.hotbar = true;
        s.el.setAttribute('aria-keyshortcuts', String(idx + 1));
        hotbarEl.appendChild(s.el);
        slots.push(s);
      })(i);
    }

    var grid = document.getElementById('inv-grid');
    for (var j = 0; j < 36; j++) {
      (function (idx) {
        var s = makeSlot('inv', 'inv', idx, slotName('背包', idx, 36));
        grid.appendChild(s.el);
        invSlots.push(s);
      })(j);
    }

    // 背包 2x2 合成格
    var icgrid = document.getElementById('inv-craft-grid');
    for (var ic = 0; ic < 4; ic++) {
      (function (idx) {
        var s = makeSlot('craft', 'icraft', idx, slotName('随身合成区', idx, 4));
        icgrid.appendChild(s.el);
        invCraftSlots.push(s);
      })(ic);
    }
    var icros = document.getElementById('inv-craft-result');
    icros.setAttribute('data-slot', 'inv-result');
    var invResultCanvas = decorateCanvas(document.createElement('canvas'));
    invResultCanvas.width = 44; invResultCanvas.height = 44;
    icros.appendChild(invResultCanvas);
    var takeInvResult = function () { Voxel.Game.onInvResultClick(); };
    icros.addEventListener('click', takeInvResult);
    invResultSlot = bindActionSlot(icros, invResultCanvas, '随身合成结果', takeInvResult);

    var cgrid = document.getElementById('craft-grid');
    for (var c2 = 0; c2 < 9; c2++) {
      (function (idx) {
        var s = makeSlot('craft', 'craft', idx, slotName('工作台合成区', idx, 9));
        cgrid.appendChild(s.el);
        craftSlots.push(s);
      })(c2);
    }

    var cres = document.getElementById('craft-result');
    cres.setAttribute('data-slot', 'result');
    var resultCanvas = decorateCanvas(document.createElement('canvas'));
    resultCanvas.width = 44; resultCanvas.height = 44;
    cres.appendChild(resultCanvas);
    var takeResult = function () { Voxel.Game.onResultClick(); };
    cres.addEventListener('click', takeResult);
    resultSlot = bindActionSlot(cres, resultCanvas, '工作台合成结果', takeResult);

    var cinv = document.getElementById('craft-inv-grid');
    for (var j2 = 0; j2 < 36; j2++) {
      (function (idx) {
        var s = makeSlot('inv', 'inv', idx, slotName('工作台背包', idx, 36));
        cinv.appendChild(s.el);
        craftInvSlots.push(s);
      })(j2);
    }

    // 熔炉：原料 / 燃料 / 产物 + 背包镜像
    var fin = document.getElementById('fur-in');
    if (fin) {
      fin.setAttribute('data-slot', 'fin:0');
      var fc = decorateCanvas(document.createElement('canvas'));
      fc.width = 44; fc.height = 44;
      fin.appendChild(fc);
      furInSlot = bindSlot(fin, fc, 'fin', 0, '熔炉原料格');
    }
    var ffuel = document.getElementById('fur-fuel');
    if (ffuel) {
      ffuel.setAttribute('data-slot', 'ffuel:0');
      var fc2 = decorateCanvas(document.createElement('canvas'));
      fc2.width = 44; fc2.height = 44;
      ffuel.appendChild(fc2);
      furFuelSlot = bindSlot(ffuel, fc2, 'ffuel', 0, '熔炉燃料格');
    }
    var fout = document.getElementById('fur-out');
    if (fout) {
      fout.setAttribute('data-slot', 'fout:0');
      var fc3 = decorateCanvas(document.createElement('canvas'));
      fc3.width = 44; fc3.height = 44;
      fout.appendChild(fc3);
      furOutSlot = bindSlot(fout, fc3, 'fout', 0, '熔炉产物格');
    }
    var fig = document.getElementById('fur-inv-grid');
    if (fig) {
      for (var j3 = 0; j3 < 36; j3++) {
        (function (idx) {
          var s = makeSlot('inv', 'inv', idx, slotName('熔炉背包', idx, 36));
          fig.appendChild(s.el);
          furInvSlots.push(s);
        })(j3);
      }
    }

    // 箱子：27 容器格 + 背包镜像
    var cgrid2 = document.getElementById('chest-grid');
    if (cgrid2) {
      for (var ci = 0; ci < 27; ci++) {
        (function (idx) {
          var s = makeSlot('chest', 'chest', idx, slotName('箱子', idx, 27));
          cgrid2.appendChild(s.el);
          chestSlots.push(s);
        })(ci);
      }
      chestHeldCanvas = decorateCanvas(document.getElementById('chest-held'));
    }
    var cig = document.getElementById('chest-inv-grid');
    if (cig) {
      for (var cj = 0; cj < 36; cj++) {
        (function (idx) {
          var s = makeSlot('inv', 'inv', idx, slotName('箱子背包', idx, 36));
          cig.appendChild(s.el);
          chestInvSlots.push(s);
        })(cj);
      }
    }

    // 装备栏：头部（防毒面具）/ 身体（防寒服）/ 充能槽（木炭/煤炭）
    var gbar = document.getElementById('gear-bar');
    if (gbar) {
      gearHeadSlot = makeSlot('', 'gear', 0, '头部装备槽（防毒面具）');
      gbar.appendChild(gearHeadSlot.el);
      gearBodySlot = makeSlot('', 'gear', 1, '身体装备槽（防寒服）');
      gbar.appendChild(gearBodySlot.el);
      gearChargeSlot = makeSlot('', 'charge', 0, '充能槽（放入木炭或煤炭为装备充能）');
      gbar.appendChild(gearChargeSlot.el);
      setupRoving(gbar, [gearHeadSlot, gearBodySlot, gearChargeSlot], 1, '装备栏', 0);
    }

    setupRoving(hotbarEl, slots, 9, '快捷栏', selectedHotbar);
    setupRoving(grid, invSlots, 9, '背包物品格', 0);
    setupRoving(icgrid, invCraftSlots, 2, '随身合成格', 0);
    setupRoving(cgrid, craftSlots, 3, '工作台合成格', 0);
    setupRoving(cinv, craftInvSlots, 9, '工作台背包格', 0);
    if (furInSlot && furFuelSlot && furOutSlot)
      setupRoving(document.querySelector('#furnace .furnace-row'),
        [furInSlot, furFuelSlot, furOutSlot], 1, '熔炉操作格', 0);
    setupRoving(fig, furInvSlots, 9, '熔炉背包格', 0);
    setupRoving(cgrid2, chestSlots, 9, '箱子物品格', 0);
    setupRoving(cig, chestInvSlots, 9, '箱子背包格', 0);

    heldCanvas = decorateCanvas(document.getElementById('inv-held'));
    craftHeldCanvas = decorateCanvas(document.getElementById('craft-held'));
    setSelected(selectedHotbar);
    healthCtx = document.getElementById('health').getContext('2d');
    var hEl = document.getElementById('hunger');
    if (hEl) hungerCtx = hEl.getContext('2d');
    debugEl = document.getElementById('debug');
    toastEl = document.getElementById('toast');
    environmentEl = document.getElementById('environment-meter');
    environmentFillEl = document.getElementById('environment-fill');
    environmentLabelEl = document.getElementById('environment-label');
    environmentDetailEl = document.getElementById('environment-detail');
    environmentValueEl = document.getElementById('environment-value');
    environmentIntensityEl = document.getElementById('environment-intensity');

    document.getElementById('btn-manual').addEventListener('click', function () {
      Voxel.Game.openManual();
    });

    buildManual();
  }

  function drawIcon(canvas, id, count, dur, maxDur) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!id || !atlas) return;
    ctx.imageSmoothingEnabled = false;
    var t = Voxel.Blocks.iconTile(id);
    if (t < 0) return;
    var ox = (t % 16) * 16, oy = ((t / 16) | 0) * 16;
    var s = canvas.width - 8;
    ctx.drawImage(atlas, ox, oy, 16, 16, 4, 4, s, s);
    if (count > 1) {
      ctx.font = 'bold 15px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#1a1a1a';
      ctx.strokeText(count, canvas.width - 3, canvas.height - 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(count, canvas.width - 3, canvas.height - 2);
    }
    // 工具耐久条（底部，绿→红）
    var safeDur = normalizeDur(dur, maxDur);
    if (safeDur !== null) {
      var frac = safeDur / normalizeMaxDur(maxDur);
      var bw = canvas.width - 6;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(3, canvas.height - 5, bw, 3);
      ctx.fillStyle = frac < 0.3 ? '#e03030' : (frac < 0.6 ? '#e0a030' : '#40c040');
      ctx.fillRect(4, canvas.height - 4, Math.max(1, Math.round((bw - 2) * frac)), 2);
    }
  }

  function setInv(inv, cnt, dur) {
    for (var i = 0; i < 9; i++) {
      var hd = dur && dur[i];
      renderSlot(slots[i], inv[i], cnt && cnt[i], hd, Voxel.Blocks.maxDur(inv[i]));
    }
    for (var j = 0; j < 36; j++) {
      var dd = dur && dur[j], md = Voxel.Blocks.maxDur(inv[j]);
      renderSlot(invSlots[j], inv[j], cnt && cnt[j], dd, md);
      renderSlot(craftInvSlots[j], inv[j], cnt && cnt[j], dd, md);
      if (furInvSlots[j]) renderSlot(furInvSlots[j], inv[j], cnt && cnt[j], dd, md);
      if (chestInvSlots[j]) renderSlot(chestInvSlots[j], inv[j], cnt && cnt[j], dd, md);
    }
  }

  function setCraftGrid(grid) {
    lastCraftGrid = grid ? grid.slice(0, 9) : [];
    for (var i = 0; i < 9; i++) renderSlot(craftSlots[i], grid[i], grid[i] ? 1 : 0);
  }

  function setInvCraftGrid(grid) {
    lastInvCraftGrid = grid ? grid.slice(0, 4) : [];
    for (var i = 0; i < 4; i++) renderSlot(invCraftSlots[i], grid[i], grid[i] ? 1 : 0);
  }

  function drawResult(id) {
    var matched = id && Voxel.Crafting ? Voxel.Crafting.match(lastCraftGrid) : null;
    renderSlot(resultSlot, id, matched && matched.result === id ? matched.count : (id ? 1 : 0));
  }

  function drawInvResult(id) {
    var matched = id && Voxel.Crafting ? Voxel.Crafting.matchIn(lastInvCraftGrid, 2) : null;
    renderSlot(invResultSlot, id, matched && matched.result === id ? matched.count : (id ? 1 : 0));
  }

  function drawHeld(id) {
    drawIcon(heldCanvas, id);
    drawIcon(craftHeldCanvas, id);
    if (furHeldCanvas === null) furHeldCanvas = decorateCanvas(document.getElementById('fur-held'));
    if (furHeldCanvas) drawIcon(furHeldCanvas, id);
    if (chestHeldCanvas) drawIcon(chestHeldCanvas, id);
  }

  // 熔炉三格（f: {in,fuel,out} 各 {id,n}|null）
  function setFurnace(f) {
    if (!furInSlot) return;
    renderSlot(furInSlot, f.in ? f.in.id : 0, f.in ? f.in.n : 0,
      f.in ? f.in.dur : null, f.in ? Voxel.Blocks.maxDur(f.in.id) : 0);
    renderSlot(furFuelSlot, f.fuel ? f.fuel.id : 0, f.fuel ? f.fuel.n : 0,
      f.fuel ? f.fuel.dur : null, f.fuel ? Voxel.Blocks.maxDur(f.fuel.id) : 0);
    renderSlot(furOutSlot, f.out ? f.out.id : 0, f.out ? f.out.n : 0,
      f.out ? f.out.dur : null, f.out ? Voxel.Blocks.maxDur(f.out.id) : 0);
  }

  // 箱子 27 格（c.items[i] = {id,n,dur}|null）
  function setChest(c) {
    if (!chestSlots.length) return;
    for (var i = 0; i < chestSlots.length; i++) {
      var o = c && c.items ? c.items[i] : null;
      if (o) renderSlot(chestSlots[i], o.id, o.n, o.dur, Voxel.Blocks.maxDur(o.id));
      else renderSlot(chestSlots[i], 0);
    }
  }

  // 装备栏三格（headId/headDur/bodyId/bodyDur + 充能格 chId/chN）
  function setGear(headId, headDur, bodyId, bodyDur, chId, chN) {
    if (gearHeadSlot)
      renderSlot(gearHeadSlot, headId, headId ? 1 : 0, headDur, Voxel.Blocks.maxDur(headId));
    if (gearBodySlot)
      renderSlot(gearBodySlot, bodyId, bodyId ? 1 : 0, bodyDur, Voxel.Blocks.maxDur(bodyId));
    if (gearChargeSlot)
      renderSlot(gearChargeSlot, chId, chN || 0);
  }

  // 火焰余量 burn01 / 烧制进度 prog01（0~1）
  function gaugePercent(value) {
    if (typeof value !== 'number' || !isFinite(value)) return 0;
    return Math.round(Math.max(0, Math.min(1, value)) * 100);
  }

  function setFurnaceGauges(burn01, prog01) {
    var flame = document.getElementById('fur-flame');
    var prog = document.getElementById('fur-prog');
    var burn = gaugePercent(burn01);
    var progress = gaugePercent(prog01);
    if (flame) {
      flame.firstElementChild.style.height = burn + '%';
      flame.setAttribute('aria-valuenow', String(burn));
    }
    if (prog) {
      prog.style.width = progress + '%';
      if (prog.parentElement) prog.parentElement.setAttribute('aria-valuenow', String(progress));
    }
  }

  var ENVIRONMENT_LABELS = {
    none: '环境稳定', heat: '日照热负荷', cold: '低温暴露',
    toxic: '毒性暴露', ash: '火山灰暴露', pressure: '深水压力'
  };

  function safeEnvironmentText(value, fallback, maxLen) {
    var text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (!text || /\b(?:undefined|null|nan|infinity)\b|\[object object\]/i.test(text)) text = fallback;
    return text.slice(0, maxLen || 48);
  }

  function environmentModel(raw) {
    raw = raw && raw.status && typeof raw.status === 'object' ? raw.status : raw;
    raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    var hazard = Object.prototype.hasOwnProperty.call(ENVIRONMENT_LABELS, raw.hazard) ? raw.hazard : 'none';
    var label = safeEnvironmentText(raw.label, ENVIRONMENT_LABELS[hazard], 32).replace(/[<>]/g, '');
    if (!label) label = ENVIRONMENT_LABELS[hazard];
    var exposure = typeof raw.exposure === 'number' && isFinite(raw.exposure)
      ? Math.max(0, Math.min(100, raw.exposure)) : 0;
    var percent = Math.round(exposure);
    var threshold = typeof raw.threshold === 'number' && isFinite(raw.threshold)
      ? Math.max(1, Math.min(100, raw.threshold)) : 90;
    var level = percent >= threshold ? 'critical' :
      (percent >= Math.max(0, threshold - 20) ? 'danger' :
        (percent >= Math.max(0, threshold - 55) ? 'warning' : 'safe'));
    var grace = typeof raw.graceRemaining === 'number' && isFinite(raw.graceRemaining)
      ? Math.max(0, Math.min(30, raw.graceRemaining)) : 0;
    var activeNow = raw.active === true;
    var protectedNow = hazard === 'none' || raw.protected === true || !activeNow;
    var reason = safeEnvironmentText(raw.reason, protectedNow ? '防护有效' : '环境暴露中', 48);
    var detail = grace > 0
      ? '适应期 ' + Math.ceil(grace) + ' 秒 · ' + reason
      : (protectedNow ? '防护 · ' : '暴露 · ') + reason;
    var intensity = typeof raw.intensity === 'number' && isFinite(raw.intensity)
      ? Math.max(0, raw.intensity) : 0;
    var criticalIntensity = typeof raw.criticalIntensity === 'number' && isFinite(raw.criticalIntensity)
      ? Math.max(0, raw.criticalIntensity) : 0;
    var intensityText = hazard === 'none' ? '' :
      safeEnvironmentText(raw.intensityText, '', 64);
    // 越界方向由 Environment 按 hazard 的 direction 判定（低温为跌破临界）。
    var overCritical = hazard !== 'none' && raw.overCritical === true;
    return {
      hazard: hazard,
      label: label,
      exposure: exposure,
      percent: percent,
      level: level,
      protected: protectedNow,
      active: activeNow,
      detail: detail,
      intensity: intensity,
      criticalIntensity: criticalIntensity,
      intensityText: intensityText,
      overCritical: overCritical,
      ariaText: label + ' ' + percent + '%，' + detail +
        (intensityText ? '，' + intensityText : '')
    };
  }

  function setEnvironment(raw) {
    if (!environmentEl) environmentEl = document.getElementById('environment-meter');
    if (!environmentEl) return environmentModel(raw);
    if (!environmentFillEl) environmentFillEl = document.getElementById('environment-fill');
    if (!environmentLabelEl) environmentLabelEl = document.getElementById('environment-label');
    if (!environmentDetailEl) environmentDetailEl = document.getElementById('environment-detail');
    if (!environmentValueEl) environmentValueEl = document.getElementById('environment-value');
    if (!environmentIntensityEl) environmentIntensityEl = document.getElementById('environment-intensity');
    var model = environmentModel(raw);
    environmentEl.setAttribute('data-hazard', model.hazard);
    environmentEl.setAttribute('data-level', model.level);
    environmentEl.setAttribute('data-active', model.active ? 'true' : 'false');
    environmentEl.setAttribute('data-protected', model.protected ? 'true' : 'false');
    environmentEl.setAttribute('data-over', model.overCritical ? 'true' : 'false');
    environmentEl.setAttribute('aria-valuenow', String(model.percent));
    environmentEl.setAttribute('aria-valuetext', model.ariaText);
    if (environmentFillEl) environmentFillEl.style.width = model.percent + '%';
    if (environmentLabelEl && environmentLabelEl.textContent !== model.label)
      environmentLabelEl.textContent = model.label;
    if (environmentDetailEl && environmentDetailEl.textContent !== model.detail)
      environmentDetailEl.textContent = model.detail;
    if (environmentValueEl && environmentValueEl.textContent !== model.percent + '%')
      environmentValueEl.textContent = model.percent + '%';
    if (environmentIntensityEl && environmentIntensityEl.textContent !== model.intensityText)
      environmentIntensityEl.textContent = model.intensityText;
    return model;
  }

  function setSelected(i) {
    selectedHotbar = Math.max(0, Math.min(8, i | 0));
    for (var k = 0; k < 9; k++) {
      var selected = k === selectedHotbar;
      slots[k].el.classList.toggle('selected', selected);
      slots[k].el.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
    if (slots.length && slots[0].roving) setRovingIndex(slots[0].roving, selectedHotbar, false);
    var current = slots[selectedHotbar] && slots[selectedHotbar].el;
    if (current && current.scrollIntoView) {
      try { current.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      catch (e) { current.scrollIntoView(); }
    }
  }

  function drawHealth(hp) {
    var health = Math.max(0, Math.min(20, Number(hp) || 0));
    healthCtx.canvas.setAttribute('aria-valuenow', String(health));
    healthCtx.canvas.setAttribute('aria-valuetext', health + '/20');
    healthCtx.clearRect(0, 0, 212, 20);
    for (var i = 0; i < 10; i++) {
      var full = hp >= (10 - i) * 2;
      var half = !full && hp >= (10 - i) * 2 - 1;
      var ox = i * 21 + 2, oy = 4;
      for (var r = 0; r < 6; r++)
        for (var c = 0; c < 7; c++) {
          if (HEART[r][c] !== '1') continue;
          healthCtx.fillStyle = full ? '#e33030' : (half && c < 3 ? '#e33030' : '#40242a');
          healthCtx.fillRect(ox + c * 3, oy + r * 3, 3, 3);
        }
    }
  }

  // 饥饿条：鸡腿从右往左排（镜像血量布局）
  function drawFood(f) {
    if (!hungerCtx) return;
    var food = Math.max(0, Math.min(20, Number(f) || 0));
    hungerCtx.canvas.setAttribute('aria-valuenow', String(food));
    hungerCtx.canvas.setAttribute('aria-valuetext', food + '/20');
    hungerCtx.clearRect(0, 0, 212, 20);
    for (var i = 0; i < 10; i++) {
      var full = f >= (i + 1) * 2;
      var half = !full && f >= i * 2 + 1;
      var ox = 212 - (i + 1) * 21 + 2, oy = 4;
      for (var r = 0; r < DRUMSTICK.length; r++)
        for (var c = 0; c < 7; c++) {
          if (DRUMSTICK[r][c] !== '1') continue;
          // 肉块（右上区域）/ 骨（左下）
          var meat = (c >= 3 && r <= 3);
          hungerCtx.fillStyle = full
            ? (meat ? '#c8722f' : '#e8dcc8')
            : (half && c >= 4 ? (meat ? '#c8722f' : '#e8dcc8') : '#3a2a20');
          hungerCtx.fillRect(ox + c * 3, oy + r * 3, 3, 3);
        }
    }
  }

  function showDebug(txt) { debugEl.textContent = txt; }

  // 氧气气泡：frac 0~1，满且不缺氧时隐藏
  var airCtx = null;
  function drawAir(frac) {
    if (!airCtx) {
      var el = document.getElementById('oxygen');
      if (!el) return;
      airCtx = el.getContext('2d');
    }
    var cv = airCtx.canvas;
    var air = Math.max(0, Math.min(10, Math.round((Number(frac) || 0) * 10)));
    cv.setAttribute('aria-valuenow', String(air));
    cv.setAttribute('aria-valuetext', air + '/10');
    if (frac >= 1) { airCtx.clearRect(0, 0, cv.width, cv.height); return; }
    airCtx.clearRect(0, 0, cv.width, cv.height);
    var full = Math.ceil(frac * 10);
    for (var i = 0; i < 10; i++) {
      var cx = i * 21 + 8, cy = 12;
      airCtx.beginPath();
      airCtx.arc(cx, cy, 5, 0, Math.PI * 2);
      if (i < full) {
        airCtx.fillStyle = '#bfe6ff';
        airCtx.fill();
        airCtx.lineWidth = 2;
        airCtx.strokeStyle = '#2a5a7f';
        airCtx.stroke();
      } else {
        airCtx.lineWidth = 1.5;
        airCtx.strokeStyle = 'rgba(30,50,70,0.55)';
        airCtx.stroke();
      }
    }
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  function damageFlash() {
    var el = document.getElementById('dmg-flash');
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  // 受击方向指示：箭头绕屏幕中心指向伤害来源（rel 为相对玩家朝向的弧度）
  var dirTimer = null;
  function damageDir(rel) {
    var el = document.getElementById('dmg-dir');
    if (!el) return;
    var arrow = el.firstElementChild;
    arrow.style.transform = 'translate(-50%,-50%) rotate(' + (rel * 57.2958) + 'deg) translateY(-130px)';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(dirTimer);
    dirTimer = setTimeout(function () { el.classList.remove('show'); }, 700);
  }

  function setDeathCause(cause) {
    var el = document.getElementById('death-cause');
    if (!el) return;
    var names = {
      zombie: '被僵尸抓住了',
      lightning: '被雷劈死了',
      drown: '溺水窒息了',
      fall: '摔死了',
      heat: '因过热而倒下了',
      cold: '因低温暴露而倒下了',
      toxic: '因毒性暴露而倒下了',
      ash: '被火山灰吞没了',
      pressure: '因深水高压而倒下了',
      generic: '牺牲了'
    };
    el.textContent = '（' + (names[cause] || names.generic) + '）';
  }

  // ---------- 拖拽幽灵图标 + 悬停高亮 ----------
  var ghostEl = null, hoverEl = null;

  function startGhost(id) {
    if (!ghostEl) {
      ghostEl = decorateCanvas(document.createElement('canvas'));
      ghostEl.width = 44; ghostEl.height = 44;
      ghostEl.style.cssText = 'position:fixed;left:0;top:0;z-index:999;pointer-events:none;display:none;image-rendering:pixelated;';
      document.body.appendChild(ghostEl);
    }
    ghostEl.style.display = 'block';
    drawIcon(ghostEl, id);
  }

  function moveGhost(x, y) {
    if (!ghostEl) return;
    ghostEl.style.left = (x - 22) + 'px';
    ghostEl.style.top = (y - 22) + 'px';
  }

  function endGhost() {
    if (ghostEl) ghostEl.style.display = 'none';
    clearSlotHover();
  }

  function slotHover(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    var s = el && el.closest ? el.closest('[data-slot]') : null;
    if (hoverEl && hoverEl !== s) hoverEl.classList.remove('drag-hover');
    if (s && s !== hoverEl) s.classList.add('drag-hover');
    hoverEl = s;
  }

  function clearSlotHover() {
    if (hoverEl) { hoverEl.classList.remove('drag-hover'); hoverEl = null; }
  }

  return {
    init: init,
    setInv: setInv,
    setCraftGrid: setCraftGrid,
    setInvCraftGrid: setInvCraftGrid,
    drawResult: drawResult,
    drawInvResult: drawInvResult,
    drawHeld: drawHeld,
    setSelected: setSelected,
    drawHealth: drawHealth,
    drawFood: drawFood,
    drawAir: drawAir,
    showDebug: showDebug,
    toast: toast,
    damageFlash: damageFlash,
    damageDir: damageDir,
    setDeathCause: setDeathCause,
    startGhost: startGhost,
    moveGhost: moveGhost,
    endGhost: endGhost,
    slotHover: slotHover,
    clearSlotHover: clearSlotHover,
    refreshManual: refreshManual,
    setFurnace: setFurnace,
    setFurnaceGauges: setFurnaceGauges,
    setGear: setGear,
    setEnvironment: setEnvironment,
    setChest: setChest,
    _test: {
      normalizeDur: normalizeDur,
      slotDescription: slotDescription,
      gaugePercent: gaugePercent,
      environmentModel: environmentModel
    }
  };
})();
