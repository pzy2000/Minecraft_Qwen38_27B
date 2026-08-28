// 成长进度中枢：玩家行为事件统一入口 + 计数器/首次获得/图鉴解锁数据的唯一持久化点。
// 仅随当前存档保存（噩梦删档即清零，与存档生命周期一致）。
// 纯逻辑模块（无 DOM 依赖），教程/成就/图鉴通过 subscribe() 接收事件。
window.Voxel = window.Voxel || {};

Voxel.Progress = (function () {
  var VERSION = 1;

  var state = fresh();
  var listeners = [];

  function fresh() {
    return {
      v: VERSION,
      c: {},          // 行为计数器：dug/placed/crafted/smelted/eaten/kills/...
      m: { mine: {}, craft: {}, smelt: {} }, // 按物品 id 的计数
      firsts: {},     // 首次获得：物品id -> true
      mobs: {},       // 击杀：type -> n
      fauna: {},      // 图鉴生物记录：type -> true
      biomes: {},     // 图 biome idx -> true
      ach: {},        // 成就解锁：achId -> 时间戳
      tut: { started: false, step: 0, done: false }
    };
  }

  function isPlainObject(o) {
    return Object.prototype.toString.call(o) === '[object Object]';
  }

  // 数值净化：仅接受有限整数（布尔值由调用方单独处理）
  function num(v, fallback) {
    if (typeof v !== 'number') return fallback;
    v = Number(v);
    return isFinite(v) && Math.floor(v) === v && v >= 0 ? Math.floor(v) : fallback;
  }

  // 键净化：只保留数字键/短标识符键，深度恰好一层
  function cleanKeyedMap(raw) {
    var out = {};
    if (!isPlainObject(raw)) return out;
    for (var k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      if (k.length > 24 || !/^[A-Za-z0-9_-]+$/.test(k)) continue;
      if (raw[k] === true) { out[k] = true; continue; }
      var n = num(raw[k], -1);
      if (n >= 0) out[k] = n;
    }
    return out;
  }

  function cleanBoolMap(raw) {
    var out = {};
    if (!isPlainObject(raw)) return out;
    for (var k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      if (k.length > 24 || !/^[A-Za-z0-9_.-]+$/.test(k)) continue;
      if (raw[k]) out[k] = true;
    }
    return out;
  }

  function hydrate(raw) {
    if (!isPlainObject(raw) || num(raw.v, -1) !== VERSION) {
      state = fresh();
      return false;   // fail-closed：字段缺失/版本不符时整体回落空态
    }
    var s = fresh();
    s.c = cleanKeyedMap(raw.c);
    s.m.mine = cleanKeyedMap(raw.m && raw.m.mine);
    s.m.craft = cleanKeyedMap(raw.m && raw.m.craft);
    s.m.smelt = cleanKeyedMap(raw.m && raw.m.smelt);
    s.firsts = cleanKeyedMap(raw.firsts);
    s.mobs = cleanKeyedMap(raw.mobs);
    s.fauna = cleanBoolMap(raw.fauna);
    s.biomes = cleanBoolMap(raw.biomes);
    s.ach = cleanKeyedMap(raw.ach);
    var t = raw.tut;
    s.tut = {
      started: !!(t && t.started),
      step: Math.max(0, Math.min(999, num(t && t.step, 0))),
      done: !!(t && t.done)
    };
    state = s;
    return true;
  }

  function snapshot() {
    // 浅引用即可：state 本身就是 JSON 可序列化的平面对象，
    // Save.save 会在 stringify 时取同一时刻快照。
    return state;
  }

  function beginRun() {
    hydrate(null);
    state.tut.started = true;   // 新世界自动开启新手教程
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () { };
    listeners.push(fn);
    return function () {
      for (var i = listeners.length - 1; i >= 0; i--)
        if (listeners[i] === fn) listeners.splice(i, 1);
    };
  }

  function bump(map, key, n) {
    map[key] = (num(map[key], 0)) + n;
  }

  function track(type, data) {
    data = data || {};
    var s = state;
    switch (type) {
      case 'mine':
        bump(s.c, 'dug', 1);
        bump(s.m.mine, String(data.id | 0), 1);
        break;
      case 'place':
        bump(s.c, 'placed', 1);
        break;
      case 'craft':
        bump(s.c, 'crafted', Math.max(1, data.n | 0));
        bump(s.m.craft, String(data.id | 0), Math.max(1, data.n | 0));
        break;
      case 'smelt':
        bump(s.c, 'smelted', Math.max(1, data.n | 0));
        bump(s.m.smelt, String(data.id | 0), Math.max(1, data.n | 0));
        break;
      case 'gain':
        s.firsts[String(data.id | 0)] = true;
        break;
      case 'kill':
        bump(s.c, 'kills', 1);
        bump(s.mobs, String(data.type || ''), 1);
        break;
      case 'eat':
        bump(s.c, 'eaten', 1);
        break;
      case 'sleep':
        bump(s.c, 'sleeps', 1);
        break;
      case 'death':
        bump(s.c, 'deaths', 1);
        break;
      case 'respawn':
        bump(s.c, 'respawns', 1);
        break;
      case 'board':
        bump(s.c, 'boards', 1);
        break;
      case 'warp':      // 系内飞船跃迁抵达新天体
        bump(s.c, 'warps', 1);
        break;
      case 'jump':      // 跨恒星系曲速
        bump(s.c, 'jumps', 1);
        break;
      case 'portal':    // 传送门旅行
        bump(s.c, 'portals', 1);
        break;
      case 'scan':
        bump(s.c, 'scans', 1);
        bump(s.c, 'scanEntries', Math.max(0, data.added | 0));
        break;
      case 'ruin':
        bump(s.c, 'ruins', 1);
        break;
      case 'fauna':
        if (data.type) s.fauna[String(data.type)] = true;
        break;
      case 'biome':
        if (data.i !== undefined && data.i !== null)
          s.biomes[String(data.i | 0)] = true;
        break;
      case 'move':
        bump(s.c, 'movedMeters', Math.max(0, Math.round(data.meters || 0)));
        break;
      case 'depth':
        bump(s.c, 'deepDigs', 1);
        break;
      case 'wetdig':
        bump(s.c, 'wetDigs', 1);
        break;
      case 'pet':
        bump(s.c, 'pets_' + String(data.type || ''), 1);
        break;
      default:
        // 非计数事件（如 use_block）仍需广播给订阅者（教程判定用）
        if (type === 'use_block') break;
        return;
    }
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](type, data); } catch (e) { /* 单个订阅者异常不影响其他 */ }
    }
  }

  function count(name) { return num(state.c[name], 0); }
  function idCount(kind, id) { return num(state.m[kind] && state.m[kind][String(id)], 0); }
  function first(id) { return !!state.firsts[String(id)]; }
  function mobKills(type) { return num(state.mobs[type] || state.mobs[String(type)], 0); }
  function unlockedCount() {
    var n = 0;
    for (var k in state.ach) if (state.ach[k]) n++;
    return n;
  }
  function biomeSet() {
    return Object.keys(state.biomes).length;
  }
  function faunaSet() {
    return Object.keys(state.fauna).length;
  }

  return {
    version: VERSION,
    track: track,
    count: count,
    idCount: idCount,
    first: first,
    mobKills: mobKills,
    unlockedCount: unlockedCount,
    biomeSet: biomeSet,
    faunaSet: faunaSet,
    state: function () { return state; },
    subscribe: subscribe,
    hydrate: hydrate,
    snapshot: snapshot,
    beginRun: beginRun
  };
})();
