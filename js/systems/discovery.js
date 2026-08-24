// 探索发现档案：纯逻辑、可序列化、无 DOM / THREE 依赖。
//
// `discovered`（Galaxy 旧字段）仍只表示“抵达过”；本模块单独记录玩家通过
// 主动扫描取得的测绘、群系、自然资源、物种与地标档案。所有输入都视为不可信，
// hydrate 仅按 catalog 与固定注册表读取允许键，绝不遍历任意存档键空间。
window.Voxel = window.Voxel || {};

Voxel.Discovery = (function () {
  var VERSION = 1;
  var POSITION_LIMIT = 10000000;
  var MAX_POINTS = 1000000000;
  var MAX_WORLDS = 64;
  var MAX_CATALOG_SCAN = 256;
  var MAX_BIOME_TYPES = 256;
  var MAX_RESOURCE_TYPES = 64;
  var MAX_ENTRIES_PER_WORLD = 64;
  var ARCHIVE_POINTS = 2;
  var OBJECTIVE_POINTS = 10;
  var OBJECTIVE_FUEL = 5;

  var FAUNA = {
    sheep: '羊',
    pig: '猪',
    chicken: '鸡',
    rabbit: '兔子',
    zombie: '僵尸'
  };
  var LANDMARKS = {
    ship: '行星飞船',
    'station-terminal': '空间站航行终端',
    portal: '星际传送门'
  };
  var GLOBAL_CLAIMS = ['biomes:3', 'resources:3', 'fauna:2', 'survey-worlds:3'];

  function map() { return Object.create(null); }
  function own(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  // 资源注册表只由 Blocks 维护；Discovery 每次按当前白名单构造允许键，
  // 避免新矿种加入时出现两份常量漂移。仍交叉检查私有 set API，防止外部
  // 修改导出数组后把普通方块/物品伪造成可扫描资源。
  function resourceIds() {
    var raw = Voxel.Blocks && Array.isArray(Voxel.Blocks.SCANNABLE_RESOURCES)
      ? Voxel.Blocks.SCANNABLE_RESOURCES : [];
    var out = [], seen = map();
    var scan = Math.min(raw.length, MAX_RESOURCE_TYPES * 2);
    for (var i = 0; i < scan && out.length < MAX_RESOURCE_TYPES; i++) {
      var id = raw[i];
      if (typeof id !== 'number' || !isFinite(id) || Math.floor(id) !== id || id <= 0 || id > 255 ||
        own(seen, String(id)) || !Voxel.Blocks.defs[id] ||
        !Voxel.Blocks.isScannableResource || !Voxel.Blocks.isScannableResource(id)) continue;
      seen[String(id)] = true;
      out.push(id);
    }
    return out;
  }

  // 同时接受本 realm / VM realm 的普通对象与 Object.create(null)，拒绝数组、
  // Date、类实例以及带自定义原型的伪映射。
  function plainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
    var proto;
    try { proto = Object.getPrototypeOf(value); } catch (e) { return false; }
    if (proto === null) return true;
    if (!own(proto, 'constructor')) return false;
    var ctor = proto.constructor;
    return typeof ctor === 'function' && ctor.name === 'Object';
  }

  function safeId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 64 &&
      value !== '__proto__' && value !== 'prototype' && value !== 'constructor' &&
      /^[A-Za-z0-9._:-]+$/.test(value);
  }

  function catalogInfo(catalog) {
    var ids = [];
    var byId = map();
    if (!Array.isArray(catalog)) return { ids: ids, byId: byId };
    var scan = Math.min(catalog.length, MAX_CATALOG_SCAN);
    for (var i = 0; i < scan && ids.length < MAX_WORLDS; i++) {
      var world = catalog[i];
      if (!plainObject(world) || !safeId(world.id) || own(byId, world.id)) continue;
      ids.push(world.id);
      byId[world.id] = world;
    }
    return { ids: ids, byId: byId };
  }

  function biomeCount() {
    var n = Voxel.Biomes && Number(Voxel.Biomes.count);
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(MAX_BIOME_TYPES, Math.floor(n));
  }

  function finitePosition(raw) {
    if (!Array.isArray(raw) || raw.length !== 3) return null;
    var out = [];
    for (var i = 0; i < 3; i++) {
      if (typeof raw[i] !== 'number' || !isFinite(raw[i])) return null;
      var n = raw[i];
      n = Math.max(-POSITION_LIMIT, Math.min(POSITION_LIMIT, n));
      // JSON 可表示 -0，但发现坐标不需要保留它的符号。
      out.push(n === 0 ? 0 : n);
    }
    return out;
  }

  function newWorldState() {
    return {
      survey: map(),
      biomes: map(),
      resources: map(),
      fauna: map(),
      landmarks: map()
    };
  }

  function empty() {
    return { v: VERSION, points: 0, worlds: map(), claimed: map() };
  }

  function allowedKeys(kind) {
    var out = [];
    var i;
    if (kind === 'survey') return ['world'];
    if (kind === 'biome') {
      for (i = 0; i < biomeCount(); i++) out.push(String(i));
      return out;
    }
    if (kind === 'resource') {
      var resources = resourceIds();
      for (i = 0; i < resources.length; i++) out.push(String(resources[i]));
      return out;
    }
    if (kind === 'fauna') return Object.keys(FAUNA);
    if (kind === 'landmark') return Object.keys(LANDMARKS);
    return out;
  }

  function normalizeKey(kind, value) {
    if (kind === 'survey') return 'world';
    if (kind === 'biome') {
      if (typeof value !== 'number' &&
        !(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value))) return null;
      var n = Number(value);
      return isFinite(n) && Math.floor(n) === n && n >= 0 && n < biomeCount()
        ? String(n) : null;
    }
    if (kind === 'resource') {
      if (typeof value !== 'number' &&
        !(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value))) return null;
      var r = Number(value);
      return isFinite(r) && Math.floor(r) === r && resourceIds().indexOf(r) >= 0
        ? String(r) : null;
    }
    if (kind === 'fauna')
      return typeof value === 'string' && own(FAUNA, value) ? value : null;
    if (kind === 'landmark')
      return typeof value === 'string' && own(LANDMARKS, value) ? value : null;
    return null;
  }

  function canonicalEntry(worldId, kind, key, position) {
    return { worldId: worldId, kind: kind, key: key, pos: position };
  }

  function bucketFor(kind) {
    if (kind === 'biome') return 'biomes';
    if (kind === 'resource') return 'resources';
    if (kind === 'landmark') return 'landmarks';
    return kind;
  }

  function readEntry(raw, worldId, kind, key) {
    if (!plainObject(raw) || raw.worldId !== worldId || raw.kind !== kind ||
      normalizeKey(kind, raw.key) !== key) return null;
    var pos = finitePosition(raw.pos);
    return pos ? canonicalEntry(worldId, kind, key, pos) : null;
  }

  function entryCount(worldState) {
    if (!plainObject(worldState)) return 0;
    var total = 0;
    var kinds = ['survey', 'biomes', 'resources', 'fauna', 'landmarks'];
    for (var i = 0; i < kinds.length; i++) {
      var bucket = worldState[kinds[i]];
      if (!plainObject(bucket)) continue;
      var singular = kinds[i] === 'biomes' ? 'biome' :
        (kinds[i] === 'resources' ? 'resource' :
          (kinds[i] === 'landmarks' ? 'landmark' : kinds[i]));
      var keys = allowedKeys(singular);
      for (var j = 0; j < keys.length; j++) if (own(bucket, keys[j])) total++;
    }
    return total;
  }

  function hydrateWorld(raw, worldId) {
    if (!plainObject(raw)) return null;
    var out = newWorldState();
    var total = 0;
    var specs = [
      ['survey', 'survey'],
      ['biomes', 'biome'],
      ['resources', 'resource'],
      ['fauna', 'fauna'],
      ['landmarks', 'landmark']
    ];
    for (var i = 0; i < specs.length && total < MAX_ENTRIES_PER_WORLD; i++) {
      var bucketName = specs[i][0], kind = specs[i][1];
      var source = raw[bucketName];
      if (!plainObject(source)) continue;
      var keys = allowedKeys(kind);
      for (var j = 0; j < keys.length && total < MAX_ENTRIES_PER_WORLD; j++) {
        var key = keys[j];
        if (!own(source, key)) continue;
        var entry = readEntry(source[key], worldId, kind, key);
        if (!entry) continue;
        out[bucketName][key] = entry;
        total++;
      }
    }
    return total ? out : null;
  }

  function collectEntries(worldState, worldId, bucketName, kind) {
    var out = [];
    if (!plainObject(worldState) || !plainObject(worldState[bucketName])) return out;
    var bucket = worldState[bucketName];
    var keys = allowedKeys(kind);
    for (var i = 0; i < keys.length; i++) {
      if (!own(bucket, keys[i])) continue;
      var entry = readEntry(bucket[keys[i]], worldId, kind, keys[i]);
      if (entry) out.push(entry);
    }
    return out;
  }

  function worldSummaryTrusted(state, worldId) {
    var ws = plainObject(state) && plainObject(state.worlds) && own(state.worlds, worldId)
      ? state.worlds[worldId] : null;
    var surveyEntries = collectEntries(ws, worldId, 'survey', 'survey');
    var biomes = collectEntries(ws, worldId, 'biomes', 'biome');
    var resources = collectEntries(ws, worldId, 'resources', 'resource');
    var fauna = collectEntries(ws, worldId, 'fauna', 'fauna');
    var landmarks = collectEntries(ws, worldId, 'landmarks', 'landmark');
    return {
      worldId: worldId,
      surveyed: surveyEntries.length > 0,
      survey: surveyEntries.length ? surveyEntries[0] : null,
      biomes: biomes,
      resources: resources,
      fauna: fauna,
      landmarks: landmarks,
      counts: {
        survey: surveyEntries.length,
        biomes: biomes.length,
        resources: resources.length,
        fauna: fauna.length,
        landmarks: landmarks.length
      },
      total: surveyEntries.length + biomes.length + resources.length + fauna.length + landmarks.length
    };
  }

  function summaryTrusted(state, info) {
    var worlds = [];
    var biomeKeys = map(), resourceKeys = map(), faunaKeys = map(), landmarkKeys = map();
    var surveyedWorlds = 0, entries = 0;
    for (var i = 0; i < info.ids.length; i++) {
      var ws = worldSummaryTrusted(state, info.ids[i]);
      worlds.push(ws);
      entries += ws.total;
      if (ws.surveyed) surveyedWorlds++;
      var groups = [
        [ws.biomes, biomeKeys], [ws.resources, resourceKeys],
        [ws.fauna, faunaKeys], [ws.landmarks, landmarkKeys]
      ];
      for (var g = 0; g < groups.length; g++)
        for (var j = 0; j < groups[g][0].length; j++) groups[g][1][groups[g][0][j].key] = true;
    }
    return {
      points: state.points,
      totalWorlds: info.ids.length,
      surveyedWorlds: surveyedWorlds,
      biomes: Object.keys(biomeKeys).length,
      resources: Object.keys(resourceKeys).length,
      fauna: Object.keys(faunaKeys).length,
      landmarks: Object.keys(landmarkKeys).length,
      entries: entries,
      worlds: worlds
    };
  }

  function resolveWorldId(currentWorld, info) {
    var id = typeof currentWorld === 'string' ? currentWorld :
      (plainObject(currentWorld) ? currentWorld.id : null);
    return safeId(id) && own(info.byId, id) ? id : null;
  }

  function stageList(state, worldId, info) {
    var ws = worldSummaryTrusted(state, worldId);
    var all = summaryTrusted(state, info);
    return [
      { id: 'survey:' + worldId, kind: 'survey', label: '扫描当前天体', current: ws.surveyed ? 1 : 0, target: 1 },
      { id: 'biomes:3', kind: 'biomes', label: '编录 3 种群系', current: all.biomes, target: 3 },
      { id: 'resources:3', kind: 'resources', label: '编录 3 种自然资源', current: all.resources, target: 3 },
      { id: 'fauna:2', kind: 'fauna', label: '编录 2 种生命体', current: all.fauna, target: 2 },
      { id: 'survey-worlds:3', kind: 'worlds', label: '测绘 3 个天体', current: all.surveyedWorlds, target: 3 }
    ];
  }

  function objectiveTrusted(state, worldId, info) {
    if (!worldId) {
      return { id: 'offline', kind: 'offline', label: '探索链路离线', current: 0, target: 1, complete: false, pointsReward: 0, fuelReward: 0 };
    }
    var stages = stageList(state, worldId, info);
    for (var i = 0; i < stages.length; i++) {
      if (stages[i].current < stages[i].target) {
        stages[i].complete = false;
        stages[i].pointsReward = OBJECTIVE_POINTS;
        stages[i].fuelReward = OBJECTIVE_FUEL;
        return stages[i];
      }
    }
    return {
      id: 'complete', kind: 'complete', label: '星系初步勘探完成',
      current: 1, target: 1, complete: true, pointsReward: 0, fuelReward: 0
    };
  }

  function completedClaimIds(state, worldId, info) {
    var stages = stageList(state, worldId, info);
    var out = [];
    // 目标按固定顺序解锁；前一阶段未完成时，后续即使已有记录也不能提前领奖。
    for (var i = 0; i < stages.length; i++) {
      if (stages[i].current < stages[i].target) break;
      out.push(stages[i]);
    }
    return out;
  }

  function claimIsComplete(state, claimId, info) {
    if (claimId.indexOf('survey:') === 0) {
      var wid = claimId.slice(7);
      return own(info.byId, wid) && worldSummaryTrusted(state, wid).surveyed;
    }
    var all = summaryTrusted(state, info);
    if (claimId === 'biomes:3') return all.biomes >= 3;
    if (claimId === 'resources:3') return all.biomes >= 3 && all.resources >= 3;
    if (claimId === 'fauna:2') return all.biomes >= 3 && all.resources >= 3 && all.fauna >= 2;
    if (claimId === 'survey-worlds:3')
      return all.biomes >= 3 && all.resources >= 3 && all.fauna >= 2 && all.surveyedWorlds >= 3;
    return false;
  }

  function hydrate(raw, catalog) {
    var out = empty();
    var info = catalogInfo(catalog);
    // 缺版本的旧 v5 形态没有主动发现档案，必须迁移为空；不能把 visited 冒充 scanned。
    if (!plainObject(raw) || raw.v !== VERSION) return out;
    var points = raw.points;
    if (typeof points === 'number' && isFinite(points) && points >= 0)
      out.points = Math.min(MAX_POINTS, Math.floor(points));

    if (plainObject(raw.worlds)) {
      for (var i = 0; i < info.ids.length; i++) {
        var id = info.ids[i];
        if (!own(raw.worlds, id)) continue;
        var worldState = hydrateWorld(raw.worlds[id], id);
        if (worldState) out.worlds[id] = worldState;
      }
    }

    if (plainObject(raw.claimed)) {
      var claims = GLOBAL_CLAIMS.slice();
      for (var j = 0; j < info.ids.length; j++) claims.push('survey:' + info.ids[j]);
      for (var c = 0; c < claims.length; c++) {
        var claim = claims[c];
        if (own(raw.claimed, claim) && raw.claimed[claim] === true && claimIsComplete(out, claim, info))
          out.claimed[claim] = true;
      }
    }
    return out;
  }

  function worldSummary(state, worldId) {
    if (!safeId(worldId)) return worldSummaryTrusted(empty(), '');
    return worldSummaryTrusted(state, worldId);
  }

  function summary(state, catalog) {
    var info = catalogInfo(catalog);
    return summaryTrusted(hydrate(state, catalog), info);
  }

  function objective(state, currentWorld, catalog) {
    var info = catalogInfo(catalog);
    var clean = hydrate(state, catalog);
    return objectiveTrusted(clean, resolveWorldId(currentWorld, info), info);
  }

  function result(state, added, entries, pointsAwarded, before, after, rewards, fuelAwarded) {
    return {
      state: state,
      added: added,
      entries: entries,
      pointsAwarded: pointsAwarded,
      objectiveBefore: before,
      objectiveAfter: after,
      objectiveRewards: rewards,
      fuelAwarded: fuelAwarded
    };
  }

  function record(state, event, catalog) {
    var info = catalogInfo(catalog);
    var clean = hydrate(state, catalog); // 深拷贝并重新收紧边界；绝不修改调用方对象。
    var worldId = plainObject(event) && safeId(event.worldId) && own(info.byId, event.worldId)
      ? event.worldId : null;
    var before = objectiveTrusted(clean, worldId, info);
    if (!worldId || !plainObject(event) ||
      ['survey', 'biome', 'resource', 'fauna', 'landmark'].indexOf(event.kind) < 0) {
      return result(clean, 0, [], 0, before, before, [], 0);
    }
    var key = normalizeKey(event.kind, event.key);
    var pos = finitePosition(event.pos);
    if (key === null || !pos) return result(clean, 0, [], 0, before, before, [], 0);

    var bucketName = bucketFor(event.kind);
    var ws = own(clean.worlds, worldId) ? clean.worlds[worldId] : newWorldState();
    if (own(ws[bucketName], key) || entryCount(ws) >= MAX_ENTRIES_PER_WORLD)
      return result(clean, 0, [], 0, before, before, [], 0);

    if (!own(clean.worlds, worldId)) clean.worlds[worldId] = ws;
    var entry = canonicalEntry(worldId, event.kind, key, pos);
    ws[bucketName][key] = entry;

    var rewards = [];
    var stages = completedClaimIds(clean, worldId, info);
    for (var i = 0; i < stages.length; i++) {
      if (own(clean.claimed, stages[i].id)) continue;
      clean.claimed[stages[i].id] = true;
      rewards.push({
        id: stages[i].id,
        label: stages[i].label,
        points: OBJECTIVE_POINTS,
        fuel: OBJECTIVE_FUEL
      });
    }
    var nominalPoints = ARCHIVE_POINTS + rewards.length * OBJECTIVE_POINTS;
    var oldPoints = clean.points;
    clean.points = Math.min(MAX_POINTS, clean.points + nominalPoints);
    var awarded = clean.points - oldPoints;
    var fuel = rewards.length * OBJECTIVE_FUEL;
    var after = objectiveTrusted(clean, worldId, info);
    return result(clean, 1, [entry], awarded, before, after, rewards, fuel);
  }

  function label(entry) {
    if (!plainObject(entry)) return '未知档案';
    var key = normalizeKey(entry.kind, entry.key);
    if (key === null) return '未知档案';
    if (entry.kind === 'survey') return '天体测绘';
    if (entry.kind === 'biome') {
      try {
        return Voxel.Biomes && Voxel.Biomes.name ? Voxel.Biomes.name(Number(key)) : '群系 #' + key;
      } catch (e) { return '群系 #' + key; }
    }
    if (entry.kind === 'resource') {
      try {
        return Voxel.Blocks && Voxel.Blocks.name ? Voxel.Blocks.name(Number(key)) : '资源 #' + key;
      } catch (e2) { return '资源 #' + key; }
    }
    if (entry.kind === 'fauna') return FAUNA[key];
    if (entry.kind === 'landmark') return LANDMARKS[key];
    return '未知档案';
  }

  return {
    empty: empty,
    hydrate: hydrate,
    record: record,
    objective: objective,
    summary: summary,
    worldSummary: worldSummary,
    label: label
  };
})();
