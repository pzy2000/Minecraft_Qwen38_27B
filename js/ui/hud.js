// HUD：准星、快捷栏、背包、血量、调试、提示
window.Voxel = window.Voxel || {};

Voxel.HUD = (function () {
  var atlas = null;
  var slots = [], invSlots = [];
  var healthCtx, debugEl, toastEl, heldCanvas;
  var HEART = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];

  function init() {
    atlas = Voxel.Blocks.getAtlas();

    var hotbarEl = document.getElementById('hotbar');
    for (var i = 0; i < 9; i++) {
      var d = document.createElement('div');
      d.className = 'slot';
      var c = document.createElement('canvas');
      c.width = 44; c.height = 44;
      d.appendChild(c);
      hotbarEl.appendChild(d);
      slots.push({ el: d, canvas: c });
    }

    var grid = document.getElementById('inv-grid');
    for (var j = 0; j < 36; j++) {
      (function (idx) {
        var d2 = document.createElement('div');
        d2.className = 'slot inv';
        var c2 = document.createElement('canvas');
        c2.width = 44; c2.height = 44;
        d2.appendChild(c2);
        d2.addEventListener('click', function () { Voxel.Game.onInvClick(idx); });
        grid.appendChild(d2);
        invSlots.push({ el: d2, canvas: c2 });
      })(j);
    }

    heldCanvas = document.getElementById('inv-held');
    healthCtx = document.getElementById('health').getContext('2d');
    debugEl = document.getElementById('debug');
    toastEl = document.getElementById('toast');
  }

  function drawIcon(canvas, id) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!id || !atlas) return;
    ctx.imageSmoothingEnabled = false;
    var t = Voxel.Blocks.iconTile(id);
    if (t < 0) return;
    var ox = (t % 16) * 16, oy = ((t / 16) | 0) * 16;
    var s = canvas.width - 8;
    ctx.drawImage(atlas, ox, oy, 16, 16, 4, 4, s, s);
  }

  function setInv(inv) {
    for (var i = 0; i < 9; i++) drawIcon(slots[i].canvas, inv[i]);
    for (var j = 0; j < 36; j++) drawIcon(invSlots[j].canvas, inv[j]);
  }

  function drawHeld(id) { drawIcon(heldCanvas, id); }

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

  return {
    init: init,
    setInv: setInv,
    drawHeld: drawHeld,
    setSelected: setSelected,
    drawHealth: drawHealth,
    showDebug: showDebug,
    toast: toast,
    damageFlash: damageFlash
  };
})();
