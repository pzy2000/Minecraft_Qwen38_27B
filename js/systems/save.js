// 存档：localStorage（种子 + 时间 + 玩家 + 背包 + 修改过的方块）
window.Voxel = window.Voxel || {};

Voxel.Save = (function () {
  var KEY = Voxel.Config.SAVE_KEY;
  // 独立于当前存档：clear() 只清当前档，新世界创建后仍可恢复旧档。
  var BACKUP_KEY = KEY + '_backup';
  // restoreBackup() 交换两个存档时的短暂中转副本。
  var SWAP_KEY = BACKUP_KEY + '_swap';
  // 语法损坏/不可启动的主档不能覆盖唯一有效 backup，单独按原字节隔离。
  var QUARANTINE_KEY = KEY + '_quarantine';
  // 历史存档键（载入时自动迁移到当前 KEY）。v5→v6：galaxy 内新增
  // curG/curS/archive/warpCells 字段，缺失时由 Galaxy.hydrate 回落起源系。
  var LEGACY_KEYS = ['starbound_voxel_save_v5', 'voxelcraft_save_v4', 'voxelcraft_save_v3'];
  var hasOwn = Object.prototype.hasOwnProperty;

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
    // 启动世界所需的种子必须来自存档自己的 JSON 字段，不能从被污染的
    // Object.prototype 或调用方手工构造的原型链继承。
    var seed = hasOwn.call(obj, 'seed') ? obj.seed : undefined;
    var galaxy = hasOwn.call(obj, 'galaxy') ? obj.galaxy : null;
    var galaxySeed = galaxy && typeof galaxy === 'object' && !Array.isArray(galaxy) &&
      hasOwn.call(galaxy, 'rootSeed') ? galaxy.rootSeed : undefined;
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
  // validator 为空时把值视作不透明原字节，用于保护即使语法损坏的旧主档。
  function writeExact(key, raw, validator) {
    if (typeof raw !== 'string') return false;
    if (validator && !validator(raw)) return false;
    localStorage.setItem(key, raw);
    var written = localStorage.getItem(key);
    return written === raw && (!validator || validator(written));
  }

  function writeVerified(key, raw, requireLoadable) {
    return writeExact(key, raw, requireLoadable ? loadableRaw : validRaw);
  }

  function restoreRaw(key, previous) {
    if (previous !== null && typeof previous !== 'string') return false;
    try {
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
      return localStorage.getItem(key) === previous;
    } catch (e) {
      return false;
    }
  }

  // 对现有键做可回滚替换。localStorage.setItem 按规范是原子的，但浏览器配额、
  // 隐私模式和测试替身仍可能抛错、静默拒写或返回异常值；这些情况都恢复调用前
  // 的原始字节。expectedPrevious 用于 legacy 迁移，避免覆盖同时出现的新主档。
  function replaceExact(key, raw, validator, expectedPrevious, checkExpected) {
    var previous;
    var captured = false;
    try {
      previous = localStorage.getItem(key);
      // 连续两次读取不一致时，不在不可靠快照上尝试覆盖。
      if (localStorage.getItem(key) !== previous) return false;
      if (checkExpected && previous !== expectedPrevious) return false;
      captured = true;
      if (writeExact(key, raw, validator)) return true;
    } catch (e) { }
    if (captured) restoreRaw(key, previous);
    return false;
  }

  function replaceVerified(key, raw, requireLoadable, expectedPrevious) {
    return replaceExact(key, raw, requireLoadable ? loadableRaw : validRaw,
      expectedPrevious, arguments.length >= 4);
  }

  function replaceOpaqueExpected(key, raw, expectedPrevious) {
    return replaceExact(key, raw, null, expectedPrevious, true);
  }

  function removeVerified(key) {
    try {
      localStorage.removeItem(key);
      return localStorage.getItem(key) === null;
    } catch (e) {
      return false;
    }
  }

  function finishSwapRecovery(expectedCurrent, expectedBackup, expectedJournal, outcome) {
    try {
      if (localStorage.getItem(KEY) !== expectedCurrent ||
        localStorage.getItem(BACKUP_KEY) !== expectedBackup ||
        localStorage.getItem(SWAP_KEY) !== expectedJournal) {
        return { ok: false, hadJournal: true, outcome: 'blocked' };
      }
      if (!removeVerified(SWAP_KEY)) {
        return { ok: false, hadJournal: true, outcome: 'blocked' };
      }
      return { ok: true, hadJournal: true, outcome: outcome };
    } catch (e) {
      return { ok: false, hadJournal: true, outcome: 'blocked' };
    }
  }

  // restoreBackup 的 journal 只保存交换前的 BACKUP 原字节。根据三个槽的
  // 精确相等关系可区分：S0 尚未覆盖、S1 仅 BACKUP 已覆盖、S2 已提交。
  // 只有完整 commit/rollback 得到确认后才清 journal；无法判定时原样保留。
  function recoverSwap() {
    var journal;
    var current;
    var backup;
    try {
      journal = localStorage.getItem(SWAP_KEY);
      if (journal === null) return { ok: true, hadJournal: false, outcome: 'none' };
      if (!loadableRaw(journal)) {
        return { ok: false, hadJournal: true, outcome: 'blocked' };
      }
      current = localStorage.getItem(KEY);
      backup = localStorage.getItem(BACKUP_KEY);
      if (localStorage.getItem(SWAP_KEY) !== journal ||
        localStorage.getItem(KEY) !== current ||
        localStorage.getItem(BACKUP_KEY) !== backup) {
        return { ok: false, hadJournal: true, outcome: 'blocked' };
      }
    } catch (e) {
      return { ok: false, hadJournal: true, outcome: 'blocked' };
    }

    // S2: KEY 已是原 backup，BACKUP 保存原 current，交换已经提交。
    if (current === journal && backup !== null) {
      return finishSwapRecovery(current, backup, journal, 'commit');
    }
    // S0: BACKUP 仍是 journal，两个正式槽尚未改变。
    if (backup === journal && current !== null) {
      return finishSwapRecovery(current, backup, journal, 'rollback');
    }
    // S1: BACKUP 已被原 current 覆盖；从 journal 恢复原 backup。
    if (current !== null && backup === current) {
      try {
        if (!writeVerified(BACKUP_KEY, journal, true)) {
          return { ok: false, hadJournal: true, outcome: 'blocked' };
        }
      } catch (e) {
        return { ok: false, hadJournal: true, outcome: 'blocked' };
      }
      return finishSwapRecovery(current, journal, journal, 'rollback');
    }

    // 非标准存储故障可能让一个正式槽消失。只要另一个槽仍保存原 current，
    // 就能用 journal 补回原 backup；任一步失败均保留 journal 供下次重试。
    if (current === null && backup !== null) {
      try {
        if (!writeExact(KEY, backup)) {
          return { ok: false, hadJournal: true, outcome: 'blocked' };
        }
        if (!writeVerified(BACKUP_KEY, journal, true)) {
          return { ok: false, hadJournal: true, outcome: 'blocked' };
        }
      } catch (e) {
        return { ok: false, hadJournal: true, outcome: 'blocked' };
      }
      return finishSwapRecovery(backup, journal, journal, 'rollback');
    }
    if (backup === null && current !== null) {
      try {
        if (!writeVerified(BACKUP_KEY, journal, true)) {
          return { ok: false, hadJournal: true, outcome: 'blocked' };
        }
      } catch (e) {
        return { ok: false, hadJournal: true, outcome: 'blocked' };
      }
      return finishSwapRecovery(current, journal, journal, 'rollback');
    }

    // 两个正式槽都消失时，journal 是唯一可确认的完整世界；先救回 KEY，
    // 精确验证后再清 journal，至少保证剩余可恢复数据不会永久卡死。
    if (current === null && backup === null) {
      try {
        if (!writeVerified(KEY, journal, true)) {
          return { ok: false, hadJournal: true, outcome: 'blocked' };
        }
      } catch (e) {
        return { ok: false, hadJournal: true, outcome: 'blocked' };
      }
      return finishSwapRecovery(journal, null, journal, 'commit');
    }

    return { ok: false, hadJournal: true, outcome: 'blocked' };
  }

  function save(world, extra) {
    try {
      if (!recoverSwap().ok) {
        console.warn('尚有未完成的存档恢复事务');
        return false;
      }
      var obj = {
        v: 6,
        seed: world.getSeed(),
        time: extra.time,
        weather: extra.weather,
        player: extra.player,
        shipFlight: extra.shipFlight || null,
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
        // 上层可一次性捕获一致快照后传入；仅兼容旧调用方时才现场读取 world。
        meta: hasOwn.call(extra, 'meta') ? extra.meta : world.getAllMeta(),
        edits: hasOwn.call(extra, 'edits') ? extra.edits : world.getEdits(),
        galaxy: extra.galaxy || null
      };
      // 无限宇宙瘦身：存档前丢弃可再生的世界快照并 LRU 裁剪其他恒星系档案。
      if (obj.galaxy && Voxel.Galaxy && Voxel.Galaxy.pruneForSave) {
        try { obj.galaxy = Voxel.Galaxy.pruneForSave(obj.galaxy); } catch (pruneError) { }
      }
      var raw = JSON.stringify(obj);
      if (!replaceVerified(KEY, raw, true)) {
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
    var s;
    var recovery = recoverSwap();
    // 无法识别/回滚的 journal 可能仍是唯一有效副本。此时即使 KEY 看似可载入
    // 也必须 fail-closed，避免玩家进入后所有保存都永久被阻塞。
    if (!recovery.ok) return null;
    try {
      s = localStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
    // 即使当前键为空字符串或损坏也不能覆盖；hasRaw() 会让新世界流程先归档它。
    if (s !== null) {
      try {
        var current = JSON.parse(s);
        return loadableObject(current) ? current : null;
      } catch (e) {
        return null;
      }
    }
    // 旧版本键迁移（v4/v3 → 当前）：字段缺失处由加载方兜底。迁移只是优化，
    // 任意存储故障都不能阻止本次直接从仍完整的 legacy 字节载入。
    for (var i = 0; i < LEGACY_KEYS.length; i++) {
      try {
        s = localStorage.getItem(LEGACY_KEYS[i]);
        if (s !== null) {
          var obj = JSON.parse(s);
          if (!loadableObject(obj)) continue;

          // 原样复制（不重新 stringify）可保持字节级可审计性。只有目标精确回读
          // 且确认可载入后才触碰旧键；删除失败时保留双份也是安全状态。
          if (replaceVerified(KEY, s, true, null)) {
            try {
              if (localStorage.getItem(KEY) === s && loadableRaw(s)) {
                localStorage.removeItem(LEGACY_KEYS[i]);
              }
            } catch (removeError) { }
          }
          return obj;
        }
      } catch (e) {
        // 一个损坏/不可读的较新 legacy 键不应遮蔽后面的可用旧版本。
      }
    }
    return null;
  }

  function has() { return !!load(); }

  // 与 has() 分开：任意非 null 原字节都需在“新世界”前被归档或隔离，不能
  // 因为不可载入就静默覆盖。UI 只允许对 has() 为真的档执行“继续/恢复”。
  function hasRaw() {
    var recovery = recoverSwap();
    try {
      return localStorage.getItem(KEY) !== null || (recovery.hadJournal && !recovery.ok);
    } catch (e) { return recovery.hadJournal; }
  }

  function clear() {
    if (!recoverSwap().ok) return;
    try { localStorage.removeItem(KEY); } catch (e) { }
  }

  function quarantineCurrent(current) {
    var previous;
    var captured = false;
    try {
      previous = localStorage.getItem(QUARANTINE_KEY);
      if (localStorage.getItem(QUARANTINE_KEY) !== previous) return false;
      captured = true;
      // 不覆盖另一份已经隔离的未知字节；相同字节则操作天然幂等。
      if (previous !== null && previous !== current) return false;
      if (previous === null && !replaceOpaqueExpected(QUARANTINE_KEY, current, null)) return false;
      if (localStorage.getItem(KEY) !== current) {
        if (previous === null) restoreRaw(QUARANTINE_KEY, null);
        return false;
      }
      localStorage.removeItem(KEY);
      if (localStorage.getItem(KEY) === null) return true;
    } catch (e) { }

    // 先恢复主档，确认成功后才移除本次新建的隔离副本。若恢复失败则保留
    // quarantine=current，至少还有一份原字节可供人工救援。
    if (restoreRaw(KEY, current) && captured && previous === null) {
      restoreRaw(QUARANTINE_KEY, null);
    }
    return false;
  }

  // 将当前档移入可恢复备份。只有备份写入且回读校验成功后才删除当前档。
  function archiveCurrent() {
    var current;
    var previousBackup;
    var backupCaptured = false;
    try {
      if (!recoverSwap().ok) return false;
      current = localStorage.getItem(KEY);
      if (current === null) return false;
      if (!loadableRaw(current)) return quarantineCurrent(current);

      previousBackup = localStorage.getItem(BACKUP_KEY);
      if (localStorage.getItem(BACKUP_KEY) !== previousBackup) return false;
      backupCaptured = true;
      if (!replaceVerified(BACKUP_KEY, current, true, previousBackup)) return false;

      // 覆盖 backup 后再次确认待归档主档没有被另一标签页替换。
      if (localStorage.getItem(KEY) !== current) {
        restoreRaw(BACKUP_KEY, previousBackup);
        return false;
      }

      localStorage.removeItem(KEY);
      if (localStorage.getItem(KEY) === null) return true;

      // 极少数存储实现可能静默拒绝 removeItem；归档未完成时恢复原备份槽，
      // 让整个操作尽量保持字节级原子，主档此时仍原封不动。
      if (restoreRaw(KEY, current) && backupCaptured) restoreRaw(BACKUP_KEY, previousBackup);
      return false;
    } catch (e) {
      // removeItem 抛错也可能发生在 BACKUP 已覆盖之后。先确认主档恢复，再回滚
      // 原 backup；若主档无法恢复则保留 BACKUP=current，至少不丢当前世界。
      if (typeof current === 'string' && restoreRaw(KEY, current) && backupCaptured) {
        restoreRaw(BACKUP_KEY, previousBackup);
      }
      console.warn('备份存档失败', e);
      return false;
    }
  }

  function hasBackup() {
    var recovery = recoverSwap();
    try {
      if (loadableRaw(localStorage.getItem(BACKUP_KEY))) return true;
      return !recovery.ok && loadableRaw(localStorage.getItem(SWAP_KEY));
    } catch (e) { return false; }
  }

  function hasQuarantine() {
    try { return localStorage.getItem(QUARANTINE_KEY) !== null; } catch (e) { return false; }
  }

  function rollbackSwap(current, backup) {
    try {
      // 顺序不可交换：先把原 current 精确放回 KEY，成功后才允许用 journal
      // 覆盖可能仍保存 current 的 BACKUP 槽。
      if (!writeExact(KEY, current)) return false;
      if (!writeVerified(BACKUP_KEY, backup, true)) return false;
      return finishSwapRecovery(current, backup, backup, 'rollback').ok;
    } catch (e) {
      return false;
    }
  }

  // 当前档和备份档互换，因此恢复后可再次调用来撤销恢复。
  function restoreBackup() {
    var backup;
    var current;
    var journalReady = false;
    try {
      var recovery = recoverSwap();
      if (!recovery.ok) return false;
      // 本次调用若首先收尾了上次崩溃，只报告上次事务的真实结果，不悄悄再
      // 发起第二次交换。正常页面启动会由 load()/hasBackup() 提前完成恢复。
      if (recovery.hadJournal) return recovery.outcome === 'commit';

      backup = localStorage.getItem(BACKUP_KEY);
      if (!loadableRaw(backup)) return false;
      current = localStorage.getItem(KEY);

      // 没有当前档时是安全移动：先完整恢复，再清理备份。
      if (current === null) {
        if (!replaceVerified(KEY, backup, true, null)) return false;
        if (removeVerified(BACKUP_KEY)) return true;
        // 删除备份失败时恢复到移动前状态；若备份槽本身无法恢复，保留 KEY
        // 中已验证的副本，不再继续删除。
        if (restoreRaw(BACKUP_KEY, backup)) restoreRaw(KEY, null);
        return false;
      }

      // 先把待恢复档暂存，随后才允许覆盖 BACKUP_KEY / KEY。
      if (!replaceVerified(SWAP_KEY, backup, true, null)) return false;
      journalReady = true;
      if (!writeExact(BACKUP_KEY, current)) {
        rollbackSwap(current, backup);
        return false;
      }
      if (!writeVerified(KEY, backup, true)) {
        rollbackSwap(current, backup);
        return false;
      }

      return finishSwapRecovery(backup, current, backup, 'commit').ok;
    } catch (e) {
      // 回滚未获精确确认时绝不清 journal，下次入口会继续 recoverSwap()。
      if (journalReady && typeof current === 'string' && loadableRaw(backup)) {
        rollbackSwap(current, backup);
      }
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
    hasQuarantine: hasQuarantine,
    restoreBackup: restoreBackup,
    // 纯检查钩子：供回归验证损坏对象不会进入启动路径。
    isLoadable: loadableObject
  };
})();
