// 存档：localStorage（种子 + 时间 + 玩家 + 背包 + 修改过的方块）
window.Voxel = window.Voxel || {};

Voxel.Save = (function () {
  var KEY = Voxel.Config.SAVE_KEY;

  function save(world, extra) {
    try {
      var obj = {
        v: 1,
        seed: world.getSeed(),
        time: extra.time,
        weather: extra.weather,
        player: extra.player,
        inv: extra.inv,
        cnt: extra.cnt,
        held: extra.held,
        heldCnt: extra.heldCnt,
        bed: extra.bed,
        edits: world.getEdits()
      };
      localStorage.setItem(KEY, JSON.stringify(obj));
      return true;
    } catch (e) {
      console.warn('存档失败', e);
      return false;
    }
  }

  function load() {
    try {
      var s = localStorage.getItem(KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }

  function has() { return !!load(); }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { }
  }

  return { save: save, load: load, has: has, clear: clear };
})();
