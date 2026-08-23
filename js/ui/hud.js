// HUD：准星、快捷栏、背包、工作台、合成手册、血量、调试、提示
window.Voxel = window.Voxel || {};

Voxel.HUD = (function () {
  var atlas = null;
  var slots = [], invSlots = [], craftSlots = [], craftInvSlots = [], invCraftSlots = [];
  var furInSlot = null, furFuelSlot = null, furOutSlot = null, furInvSlots = [];
  var chestSlots = [], chestInvSlots = [], chestHeldCanvas = null;
  var manualBtns = [];
  var healthCtx, debugEl, toastEl, heldCanvas, craftHeldCanvas, resultCanvas, invResultCanvas, furHeldCanvas;
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

  function makeSlot(cls, slotType, idx) {
    var d = document.createElement('div');
    d.className = 'slot' + (cls ? ' ' + cls : '');
    var c = document.createElement('canvas');
    c.width = 44; c.height = 44;
    d.appendChild(c);
    if (slotType) {
      d.setAttribute('data-slot', slotType + ':' + idx);
      d.addEventListener('mousedown', function (e) { Voxel.Game.onSlotDown(e, slotType, idx); });
    }
    return { el: d, canvas: c };
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
        var ic = document.createElement('canvas');
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
            var cv = document.createElement('canvas');
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
      var rc = document.createElement('canvas');
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
        btn.addEventListener('mousedown', function (e) { e.preventDefault(); Voxel.Game.manualCraftStart(idx); });
        btn.addEventListener('mouseup', function () { Voxel.Game.manualCraftStop(); });
        btn.addEventListener('mouseleave', function () { Voxel.Game.manualCraftStop(); });
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
      sh.innerHTML = '<b>烧炼（熔炉）</b><br>· 8 块<b>石头</b>合成熔炉，对准按 E 打开<br>· <b>燃料</b>：煤炭（可烧 8 件）/ 木板 / 木棍 / 原木';
      list.appendChild(sh);
      for (var sid in FS.SMELT_TABLE) {
        var srow = document.createElement('div');
        srow.className = 'recipe-row';
        var sl = document.createElement('div');
        sl.className = 'recipe-single';
        var sib = document.createElement('div');
        sib.className = 'icon-box';
        var sic = document.createElement('canvas');
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
        var src2 = document.createElement('canvas');
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
        var d = document.createElement('div');
        d.className = 'slot';
        d.setAttribute('data-slot', 'inv:' + idx); // 快捷栏可拖拽（映射背包前 9 格）
        d.addEventListener('mousedown', function (ev) { Voxel.Game.onSlotDown(ev, 'inv', idx); });
        var c = document.createElement('canvas');
        c.width = 44; c.height = 44;
        d.appendChild(c);
        hotbarEl.appendChild(d);
        slots.push({ el: d, canvas: c });
      })(i);
    }

    var grid = document.getElementById('inv-grid');
    for (var j = 0; j < 36; j++) {
      (function (idx) {
        var s = makeSlot('inv', 'inv', idx);
        grid.appendChild(s.el);
        invSlots.push(s);
      })(j);
    }

    // 背包 2x2 合成格
    var icgrid = document.getElementById('inv-craft-grid');
    for (var ic = 0; ic < 4; ic++) {
      (function (idx) {
        var s = makeSlot('craft', 'icraft', idx);
        icgrid.appendChild(s.el);
        invCraftSlots.push(s);
      })(ic);
    }
    var icros = document.getElementById('inv-craft-result');
    icros.setAttribute('data-slot', 'inv-result');
    invResultCanvas = document.createElement('canvas');
    invResultCanvas.width = 44; invResultCanvas.height = 44;
    icros.appendChild(invResultCanvas);
    icros.addEventListener('click', function () { Voxel.Game.onInvResultClick(); });

    var cgrid = document.getElementById('craft-grid');
    for (var c2 = 0; c2 < 9; c2++) {
      (function (idx) {
        var s = makeSlot('craft', 'craft', idx);
        cgrid.appendChild(s.el);
        craftSlots.push(s);
      })(c2);
    }

    var cres = document.getElementById('craft-result');
    cres.setAttribute('data-slot', 'result');
    resultCanvas = document.createElement('canvas');
    resultCanvas.width = 44; resultCanvas.height = 44;
    cres.appendChild(resultCanvas);
    cres.addEventListener('click', function () { Voxel.Game.onResultClick(); });

    var cinv = document.getElementById('craft-inv-grid');
    for (var j2 = 0; j2 < 36; j2++) {
      (function (idx) {
        var s = makeSlot('inv', 'inv', idx);
        cinv.appendChild(s.el);
        craftInvSlots.push(s);
      })(j2);
    }

    // 熔炉：原料 / 燃料 / 产物 + 背包镜像
    var fin = document.getElementById('fur-in');
    if (fin) {
      fin.setAttribute('data-slot', 'fin:0');
      fin.addEventListener('mousedown', function (e) { Voxel.Game.onSlotDown(e, 'fin', 0); });
      var fc = document.createElement('canvas');
      fc.width = 44; fc.height = 44;
      fin.appendChild(fc);
      furInSlot = fc;
    }
    var ffuel = document.getElementById('fur-fuel');
    if (ffuel) {
      ffuel.setAttribute('data-slot', 'ffuel:0');
      ffuel.addEventListener('mousedown', function (e) { Voxel.Game.onSlotDown(e, 'ffuel', 0); });
      var fc2 = document.createElement('canvas');
      fc2.width = 44; fc2.height = 44;
      ffuel.appendChild(fc2);
      furFuelSlot = fc2;
    }
    var fout = document.getElementById('fur-out');
    if (fout) {
      fout.setAttribute('data-slot', 'fout:0');
      fout.addEventListener('mousedown', function (e) { Voxel.Game.onSlotDown(e, 'fout', 0); });
      var fc3 = document.createElement('canvas');
      fc3.width = 44; fc3.height = 44;
      fout.appendChild(fc3);
      furOutSlot = fc3;
    }
    var fig = document.getElementById('fur-inv-grid');
    if (fig) {
      for (var j3 = 0; j3 < 36; j3++) {
        (function (idx) {
          var s = makeSlot('inv', 'inv', idx);
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
          var s = makeSlot('chest', 'chest', idx);
          cgrid2.appendChild(s.el);
          chestSlots.push(s);
        })(ci);
      }
      chestHeldCanvas = document.getElementById('chest-held');
    }
    var cig = document.getElementById('chest-inv-grid');
    if (cig) {
      for (var cj = 0; cj < 36; cj++) {
        (function (idx) {
          var s = makeSlot('inv', 'inv', idx);
          cig.appendChild(s.el);
          chestInvSlots.push(s);
        })(cj);
      }
    }

    heldCanvas = document.getElementById('inv-held');
    craftHeldCanvas = document.getElementById('craft-held');
    healthCtx = document.getElementById('health').getContext('2d');
    var hEl = document.getElementById('hunger');
    if (hEl) hungerCtx = hEl.getContext('2d');
    debugEl = document.getElementById('debug');
    toastEl = document.getElementById('toast');

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
    if (maxDur && dur !== undefined && dur !== null) {
      var frac = Math.max(0, Math.min(1, dur / maxDur));
      var bw = canvas.width - 6;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(3, canvas.height - 5, bw, 3);
      ctx.fillStyle = frac < 0.3 ? '#e03030' : (frac < 0.6 ? '#e0a030' : '#40c040');
      ctx.fillRect(4, canvas.height - 4, Math.max(1, Math.round((bw - 2) * frac)), 2);
    }
  }

  function setInv(inv, cnt, dur) {
    for (var i = 0; i < 9; i++) {
      drawIcon(slots[i].canvas, inv[i], cnt && cnt[i],
        dur && dur[i], dur && dur[i] ? Voxel.Blocks.maxDur(inv[i]) : 0);
    }
    for (var j = 0; j < 36; j++) {
      var dd = dur && dur[j], md = dd ? Voxel.Blocks.maxDur(inv[j]) : 0;
      drawIcon(invSlots[j].canvas, inv[j], cnt && cnt[j], dd, md);
      drawIcon(craftInvSlots[j].canvas, inv[j], cnt && cnt[j], dd, md);
      if (furInvSlots[j]) drawIcon(furInvSlots[j].canvas, inv[j], cnt && cnt[j], dd, md);
    }
  }

  function setCraftGrid(grid) {
    for (var i = 0; i < 9; i++) drawIcon(craftSlots[i].canvas, grid[i]);
  }

  function setInvCraftGrid(grid) {
    for (var i = 0; i < 4; i++) drawIcon(invCraftSlots[i].canvas, grid[i]);
  }

  function drawResult(id) { drawIcon(resultCanvas, id); }

  function drawInvResult(id) { drawIcon(invResultCanvas, id); }

  function drawHeld(id) {
    drawIcon(heldCanvas, id);
    drawIcon(craftHeldCanvas, id);
    if (furHeldCanvas === null) furHeldCanvas = document.getElementById('fur-held');
    if (furHeldCanvas) drawIcon(furHeldCanvas, id);
    if (chestHeldCanvas) drawIcon(chestHeldCanvas, id);
  }

  // 熔炉三格（f: {in,fuel,out} 各 {id,n}|null）
  function setFurnace(f) {
    if (!furInSlot) return;
    drawIcon(furInSlot, f.in ? f.in.id : 0, f.in ? f.in.n : 0);
    drawIcon(furFuelSlot, f.fuel ? f.fuel.id : 0, f.fuel ? f.fuel.n : 0);
    drawIcon(furOutSlot, f.out ? f.out.id : 0, f.out ? f.out.n : 0);
  }

  // 箱子 27 格（c.items[i] = {id,n,dur}|null）
  function setChest(c) {
    if (!chestSlots.length) return;
    for (var i = 0; i < chestSlots.length; i++) {
      var o = c && c.items ? c.items[i] : null;
      var cv = chestSlots[i].canvas;
      if (o) drawIcon(cv, o.id, o.n, o.dur, o.dur ? Voxel.Blocks.maxDur(o.id) : 0);
      else drawIcon(cv, 0);
    }
  }

  // 火焰余量 burn01 / 烧制进度 prog01（0~1）
  function setFurnaceGauges(burn01, prog01) {
    var flame = document.getElementById('fur-flame');
    var prog = document.getElementById('fur-prog');
    if (flame) flame.firstElementChild.style.height = Math.round(Math.max(0, Math.min(1, burn01)) * 100) + '%';
    if (prog) prog.style.width = Math.round(Math.max(0, Math.min(1, prog01)) * 100) + '%';
  }

  function setSelected(i) {
    for (var k = 0; k < 9; k++) slots[k].el.classList.toggle('selected', k === i);
  }

  function drawHealth(hp) {
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
      generic: '牺牲了'
    };
    el.textContent = '（' + (names[cause] || names.generic) + '）';
  }

  // ---------- 拖拽幽灵图标 + 悬停高亮 ----------
  var ghostEl = null, hoverEl = null;

  function startGhost(id) {
    if (!ghostEl) {
      ghostEl = document.createElement('canvas');
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
    setChest: setChest
  };
})();
