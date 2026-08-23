// 存档：localStorage（种子 + 时间 + 玩家 + 背包 + 修改过的方块）
window.Voxel = window.Voxel || {};

Voxel.Save = (function () {
  var KEY = Voxel.Config.SAVE_KEY;
  // 独立于当前存档：clear() 只清当前档，新世界创建后仍可恢复旧档。
  var BACKUP_KEY = KEY + '_backup';
  // restoreBackup() 交换两个存档时的短暂中转副本。
  var SWAP_KEY = BACKUP_KEY + '_swap';
  // 历史存档键（载入时自动迁移到当前 KEY）
  var LEGACY_KEYS = ['voxelcraft_save_v4', 'voxelcraft_save_v3'];

  function validRaw(raw) {
    if (typeof raw !== 'string' || !raw) return false;
    try {
      var obj = JSON.parse(raw);
      return !!obj && typeof obj === 'object' && !Array.isArray(obj);
    } catch (e) {
      return false;
    }
  }

  // “能解析成对象”只足以做字节级备份，不代表它能启动一个世界。主菜单和
  // 恢复入口必须至少拿到一个可用种子；其余旧字段仍交给加载方按版本兜底。
  function loadableObject(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    var seed = obj.seed;
    var galaxySeed = obj.galaxy && typeof obj.galaxy === 'object' && !Array.isArray(obj.galaxy)
      ? obj.galaxy.rootSeed : undefined;
    function usableSeed(value) {
      return (typeof value === 'string' && value.trim() !== '') ||
        (typeof value === 'number' && isFinite(value));
    }
    return usableSeed(seed) || usableSeed(galaxySeed);
  }

  function loadableRaw(raw) {
    if (!validRaw(raw)) return false;
    try { return loadableObject(JSON.parse(raw)); } catch (e) { return false; }
  }

  // localStorage.setItem() 没有事务语义；精确回读后才允许下一步删除/覆盖。
  function writeVerified(key, raw) {
    if (!validRaw(raw)) return false;
    localStorage.setItem(key, raw);
    var written = localStorage.getItem(key);
    return written === raw && validRaw(written);
  }

  function removeQuietly(key) {
    try { localStorage.removeItem(key); } catch (e) { }
  }

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
        heldDur: extra.heldDur,
        craftGrid: extra.craftGrid,
        invCraftGrid: extra.invCraftGrid,
        bed: extra.bed,
        dur: extra.dur,
        drops: Array.isArray(extra.drops) ? extra.drops : [],
        meta: world.getAllMeta(),
        edits: world.getEdits(),
        galaxy: extra.galaxy || null
      };
      var raw = JSON.stringify(obj);
      if (!writeVerified(KEY, raw)) {
        console.warn('存档写入后校验失败');
        return false;
      }
      return true;
    } catch (e) {
      console.warn('存档失败', e);
      return false;
    }
  }

  function load() {
    try {
      var s = localStorage.getItem(KEY);
      if (s) {
        var current = JSON.parse(s);
        return loadableObject(current) ? current : null;
      }
      // 旧版本键迁移（v3 → 当前）：字段缺失处由加载方兜底
      for (var i = 0; i < LEGACY_KEYS.length; i++) {
        s = localStorage.getItem(LEGACY_KEYS[i]);
        if (s) {
          var obj = JSON.parse(s);
          if (!loadableObject(obj)) continue;
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

  // 与 has() 分开：损坏但语法有效的对象仍需在“新世界”前被原样归档，不能
  // 因为不可载入就静默覆盖。UI 只允许对 has() 为真的档执行“继续/恢复”。
  function hasRaw() {
    try { return localStorage.getItem(KEY) !== null; } catch (e) { return false; }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { }
  }

  // 将当前档移入可恢复备份。只有备份写入且回读校验成功后才删除当前档。
  function archiveCurrent() {
    try {
      var current = localStorage.getItem(KEY);
      if (!validRaw(current)) return false;

      var previousBackup = localStorage.getItem(BACKUP_KEY);
      if (!writeVerified(BACKUP_KEY, current)) {
        // 尽力保留上一次有效备份；无论回滚是否成功，当前 KEY 都不会被删除。
        if (validRaw(previousBackup)) {
          try { writeVerified(BACKUP_KEY, previousBackup); } catch (rollbackError) { }
        }
        return false;
      }

      localStorage.removeItem(KEY);
      if (localStorage.getItem(KEY) === null) return true;

      // 极少数存储实现可能静默拒绝 removeItem；归档未完成时恢复原备份槽，
      // 让整个操作尽量保持字节级原子，主档此时仍原封不动。
      if (validRaw(previousBackup)) writeVerified(BACKUP_KEY, previousBackup);
      else removeQuietly(BACKUP_KEY);
      return false;
    } catch (e) {
      console.warn('备份存档失败', e);
      return false;
    }
  }

  function hasBackup() {
    try { return loadableRaw(localStorage.getItem(BACKUP_KEY)); } catch (e) { return false; }
  }

  // 当前档和备份档互换，因此恢复后可再次调用来撤销恢复。
  function restoreBackup() {
    var backup;
    var current;
    try {
      backup = localStorage.getItem(BACKUP_KEY);
      if (!loadableRaw(backup)) return false;
      current = localStorage.getItem(KEY);
      if (current !== null && !validRaw(current)) return false;

      // 没有当前档时是安全移动：先完整恢复，再清理备份。
      if (current === null) {
        if (!writeVerified(KEY, backup)) return false;
        localStorage.removeItem(BACKUP_KEY);
        return localStorage.getItem(KEY) === backup && localStorage.getItem(BACKUP_KEY) === null;
      }

      // 先把待恢复档暂存，随后才允许覆盖 BACKUP_KEY / KEY。
      if (!writeVerified(SWAP_KEY, backup)) return false;
      if (!writeVerified(BACKUP_KEY, current)) {
        try { writeVerified(BACKUP_KEY, backup); } catch (rollbackBackupError) { }
        removeQuietly(SWAP_KEY);
        return false;
      }
      if (!writeVerified(KEY, backup)) {
        try { writeVerified(KEY, current); } catch (rollbackCurrentError) { }
        try { writeVerified(BACKUP_KEY, backup); } catch (rollbackBackupError) { }
        removeQuietly(SWAP_KEY);
        return false;
      }

      removeQuietly(SWAP_KEY);
      return localStorage.getItem(KEY) === backup && localStorage.getItem(BACKUP_KEY) === current;
    } catch (e) {
      // 任一步失败都尽力回到交换前状态；SWAP_KEY 保证原备份仍有副本。
      try {
        if (validRaw(current)) writeVerified(KEY, current);
        if (validRaw(backup)) writeVerified(BACKUP_KEY, backup);
      } catch (rollbackError) { }
      removeQuietly(SWAP_KEY);
      console.warn('恢复备份失败', e);
      return false;
    }
  }

  return {
    save: save,
    load: load,
    has: has,
    hasRaw: hasRaw,
    clear: clear,
    archiveCurrent: archiveCurrent,
    hasBackup: hasBackup,
    restoreBackup: restoreBackup,
    // 纯检查钩子：供回归验证损坏对象不会进入启动路径。
    isLoadable: loadableObject
  };
})();
