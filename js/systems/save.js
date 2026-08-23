// 存档：localStorage（种子 + 时间 + 玩家 + 背包 + 修改过的方块）
window.Voxel = window.Voxel || {};

Voxel.Save = (function () {
  var KEY = Voxel.Config.SAVE_KEY;
  // 历史存档键（载入时自动迁移到当前 KEY）
  var LEGACY_KEYS = ['voxelcraft_save_v4', 'voxelcraft_save_v3'];

  function save(world, extra) {
    try {
      var obj = {
        v: 5,
        seed: world.getSeed(),
        time: extra.time,
        weather: extra.weather,
        player: extra.player,
        inv: extra.inv,
        cnt: extra.cnt,
        held: extra.held,
        heldCnt: extra.heldCnt,
        bed: extra.bed,
        dur: extra.dur,
        meta: world.getAllMeta(),
        edits: world.getEdits(),
        galaxy: extra.galaxy || null
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
      if (s) return JSON.parse(s);
      // 旧版本键迁移（v3 → 当前）：字段缺失处由加载方兜底
      for (var i = 0; i < LEGACY_KEYS.length; i++) {
        s = localStorage.getItem(LEGACY_KEYS[i]);
        if (s) {
          var obj = JSON.parse(s);
          localStorage.setItem(KEY, JSON.stringify(obj));
          localStorage.removeItem(LEGACY_KEYS[i]);
          return obj;
        }
      }
      return null;
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
