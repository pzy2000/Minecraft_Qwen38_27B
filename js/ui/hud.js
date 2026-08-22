// HUD：准星、快捷栏、背包、工作台、合成手册、血量、调试、提示
window.Voxel = window.Voxel || {};

Voxel.HUD = (function () {
  var atlas = null;
  var slots = [], invSlots = [], craftSlots = [], craftInvSlots = [], invCraftSlots = [];
  var manualBtns = [];
  var healthCtx, debugEl, toastEl, heldCanvas, craftHeldCanvas, resultCanvas, invResultCanvas;
  var HEART = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];

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
    ob.innerHTML = '<b>材料获取</b><br>· 砍伐树干获得 <b>橡木</b><br>· 攻击并击杀 <b>羊</b> 掉落 <b>羊毛</b><br>· 下方每条配方可 <b>一键合成</b>（自动消耗背包材料，<b>长按连续合成</b>）';
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
        (function (cv, id) { drawIcon(cv, id); })(ic, firstInput(r.inputs));
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

    heldCanvas = document.getElementById('inv-held');
    craftHeldCanvas = document.getElementById('craft-held');
    healthCtx = document.getElementById('health').getContext('2d');
    debugEl = document.getElementById('debug');
    toastEl = document.getElementById('toast');

    document.getElementById('btn-manual').addEventListener('click', function () {
      Voxel.Game.openManual();
    });

    buildManual();
  }

  function drawIcon(canvas, id, count) {
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
  }

  function setInv(inv, cnt) {
    for (var i = 0; i < 9; i++) drawIcon(slots[i].canvas, inv[i], cnt && cnt[i]);
    for (var j = 0; j < 36; j++) {
      drawIcon(invSlots[j].canvas, inv[j], cnt && cnt[j]);
      drawIcon(craftInvSlots[j].canvas, inv[j], cnt && cnt[j]);
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
    drawAir: drawAir,
    showDebug: showDebug,
    toast: toast,
    damageFlash: damageFlash,
    startGhost: startGhost,
    moveGhost: moveGhost,
    endGhost: endGhost,
    slotHover: slotHover,
    clearSlotHover: clearSlotHover,
    refreshManual: refreshManual
  };
})();
