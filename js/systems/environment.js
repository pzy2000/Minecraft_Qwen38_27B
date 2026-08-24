// 行星环境危害：纯状态机，不直接读写 Player，也不依赖 DOM/THREE。
// 主循环以固定步调用 update(dt, context)，再自行应用返回的 damageDue。
// context: isNight/sunlight、sheltered|underCover、outdoors|skyExposed、
// inWater|headInWater、waterDepth|depth、blockLight、spawnDistance|inSpawnSafeZone，
// sealedShelter（飞船密封舱；完全隔绝危害并加速把累计暴露净化到 0）。
window.Voxel = window.Voxel || {};

Voxel.Environment = (function () {
  'use strict';

  var VERSION = 1;
  var FIXED_STEP = 0.25;
  var MAX_DT = 10;
  var LOAD_GRACE = 30;
  var RESPAWN_GRACE = 20;
  var SPAWN_SAFE_RADIUS = 12;
  var DAMAGE_THRESHOLD = 90;
  var DAMAGE_INTERVAL = 2;
  var SEALED_SHELTER_RECOVERY = 24;
  var MAX_WORLDS = 64;
  var MAX_SAVED_SCAN = 256;
  var MAX_ID_LENGTH = 64;

  // 各危害的实时环境强度指标：unit 为显示单位，critical 是暴露开始积累的
  // 临界强度。direction 表示越界方向——'above' 强度升破临界才危险（炎热/浓
  // 度/压强），'below' 强度跌破临界才危险（严寒）。intensityFor 与
  // conditionFor 共用同一套数字，保证 over ⟺ 暴露激活在显示上严格成立。
  var METRICS = {
    lush:     { unit: '',      critical: 0,     direction: 'above' },
    station:  { unit: '',      critical: 0,     direction: 'above' },
    arid:     { unit: 'lux',   critical: 45000, direction: 'above' },  // 0.45 × 100000，与旧 sunlight 激活线一致
    frozen:   { unit: '°C',    critical: 0,     direction: 'below' },
    toxic:    { unit: 'ppm',   critical: 500,   direction: 'above' },
    volcanic: { unit: 'mg/m³', critical: 130,   direction: 'above' },
    oceanic:  { unit: 'kPa',   critical: 162.08, direction: 'above' }  // 101.3 × (1 + 6/10)，对应 6 格水深
  };
  var HEAT_MAX_LUX = 100000;
  var HEAT_RAIN_ATTENUATION = 0.55;

  var PROFILES = {
    lush:     { hazard: 'none',     label: '环境稳定',   gain: 0,   recover: 12, threshold: 90, interval: 2, damage: 0 },
    station:  { hazard: 'none',     label: '环境稳定',   gain: 0,   recover: 12, threshold: 90, interval: 2, damage: 0 },
    arid:     { hazard: 'heat',     label: '日照热负荷', gain: 4,   recover: 8,  threshold: 90, interval: 2, damage: 1 },
    frozen:   { hazard: 'cold',     label: '低温暴露',   gain: 3.5, recover: 7,  threshold: 90, interval: 2, damage: 1 },
    toxic:    { hazard: 'toxic',    label: '毒性暴露',   gain: 4.5, recover: 8,  threshold: 90, interval: 2, damage: 1 },
    volcanic: { hazard: 'ash',      label: '火山灰暴露', gain: 5,   recover: 8,  threshold: 90, interval: 2, damage: 1 },
    oceanic:  { hazard: 'pressure', label: '深水压力',   gain: 6,   recover: 10, threshold: 90, interval: 2, damage: 1 }
  };

  var worlds = Object.create(null);
  var worldCount = 0;
  var current = null;
  var accumulator = 0;
  var graceRemaining = 0;
  var damageClock = 0;
  var lastContext = null;
  var lastCondition = { active: false, protected: true, reason: '环境系统离线' };

  function finiteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function plainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function safeId(value) {
    var text = (typeof value === 'string' || typeof value === 'number') ? String(value).trim() : '';
    if (!text || text.length > MAX_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(text) ||
      text === '__proto__' || text === 'prototype' || text === 'constructor') return '';
    return text;
  }

  function safeType(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROFILES, value)
      ? value : '';
  }

  function safeExposure(value) {
    return finiteNumber(value) ? clamp(value, 0, 100) : 0;
  }

  function safeLabel(value, fallback) {
    var text = typeof value === 'string'
      ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (!text || text.length > 32 || /\b(?:undefined|null|nan|infinity)\b|\[object object\]/i.test(text))
      return fallback;
    return text;
  }

  function cloneProfile(source) {
    return {
      hazard: source.hazard, label: source.label, gain: source.gain, recover: source.recover,
      threshold: source.threshold, interval: source.interval, damage: source.damage
    };
  }

  // PlanetRules 是数值真相源；本地表只负责模块可独立运行和依赖损坏时的无崩溃 fallback。
  function profileFor(typeKey) {
    var fallback = PROFILES[typeKey] || PROFILES.lush;
    var api = Voxel.PlanetRules && Voxel.PlanetRules.hazard;
    if (typeof api !== 'function') return cloneProfile(fallback);
    var raw;
    try { raw = api(typeKey); } catch (e) { return cloneProfile(fallback); }
    if (!plainObject(raw) || raw.key !== fallback.hazard || raw.damageCause !== fallback.hazard)
      return cloneProfile(fallback);
    if (fallback.hazard === 'none') {
      if (!finiteNumber(raw.accumulation) || raw.accumulation !== 0 ||
        !finiteNumber(raw.recovery) || raw.recovery < 0 ||
        !finiteNumber(raw.threshold) || raw.threshold <= 0 ||
        !finiteNumber(raw.interval) || raw.interval < 0 ||
        !finiteNumber(raw.damage) || raw.damage !== 0) return cloneProfile(fallback);
      return {
        hazard: 'none', label: safeLabel(raw.label, fallback.label), gain: 0,
        recover: clamp(raw.recovery, 0, 100), threshold: clamp(raw.threshold, 1, 100),
        interval: clamp(raw.interval, 0, 60), damage: 0
      };
    }
    if (!finiteNumber(raw.accumulation) || raw.accumulation <= 0 ||
      !finiteNumber(raw.recovery) || raw.recovery < 0 ||
      !finiteNumber(raw.threshold) || raw.threshold <= 0 ||
      !finiteNumber(raw.interval) || raw.interval < FIXED_STEP ||
      !finiteNumber(raw.damage) || raw.damage <= 0) return cloneProfile(fallback);
    return {
      hazard: fallback.hazard,
      label: safeLabel(raw.label, fallback.label),
      gain: clamp(raw.accumulation, 0.01, 100),
      recover: clamp(raw.recovery, 0, 100),
      threshold: clamp(raw.threshold, 1, 100),
      interval: clamp(raw.interval, FIXED_STEP, 60),
      damage: Math.max(1, Math.min(20, Math.round(raw.damage)))
    };
  }

  function hydrate(raw) {
    var result = Object.create(null);
    var count = 0, scanned = 0;
    if (!plainObject(raw) || raw.v !== VERSION || !plainObject(raw.worlds))
      return { worlds: result, count: 0 };
    for (var key in raw.worlds) {
      if (++scanned > MAX_SAVED_SCAN || count >= MAX_WORLDS) break;
      if (!Object.prototype.hasOwnProperty.call(raw.worlds, key)) continue;
      var id = safeId(key), entry = raw.worlds[key];
      if (!id || !plainObject(entry) || !finiteNumber(entry.exposure)) continue;
      result[id] = { exposure: safeExposure(entry.exposure), adapted: entry.adapted === true };
      count++;
    }
    return { worlds: result, count: count };
  }

  function ensureWorld(id) {
    if (!id) return null;
    if (!worlds[id]) {
      if (worldCount >= MAX_WORLDS) return null;
      worlds[id] = { exposure: 0, adapted: false };
      worldCount++;
    }
    return worlds[id];
  }

  function normalizeContext(raw) {
    raw = plainObject(raw) ? raw : {};
    var sheltered = raw.sheltered === true || raw.underCover === true;
    var outdoorSignal = raw.outdoors === true || raw.skyExposed === true ||
      raw.sheltered === false || raw.underCover === false;
    var inWater = raw.inWater === true || raw.headInWater === true;
    var sealedShelter = raw.sealedShelter === true || raw.inShip === true;
    var spawnDistance = finiteNumber(raw.spawnDistance) && raw.spawnDistance >= 0
      ? clamp(raw.spawnDistance, 0, 10000000) : null;
    var outdoors = outdoorSignal && !sheltered && !sealedShelter;
    return {
      isNight: raw.isNight === true,
      sunlight: finiteNumber(raw.sunlight) ? clamp(raw.sunlight, 0, 1) : 0,
      rain: finiteNumber(raw.rain) ? clamp(raw.rain, 0, 1) : 0,
      sky: finiteNumber(raw.sky) ? clamp(raw.sky, 0, 15) : (outdoors ? 15 : 0),
      sheltered: sheltered || sealedShelter,
      outdoors: outdoors,
      sealedShelter: sealedShelter,
      inWater: inWater,
      waterDepth: finiteNumber(raw.waterDepth) ? clamp(raw.waterDepth, 0, 10000) :
        (finiteNumber(raw.depth) ? clamp(raw.depth, 0, 10000) : 0),
      blockLight: finiteNumber(raw.blockLight) ? clamp(raw.blockLight, 0, 15) : 0,
      spawnSafe: raw.inSpawnSafeZone === true || (spawnDistance !== null && spawnDistance <= SPAWN_SAFE_RADIUS),
      spawnDistance: spawnDistance
    };
  }

  function groupedNumber(value) {
    return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatIntensity(value, unit) {
    return unit ? groupedNumber(value) + ' ' + unit : groupedNumber(value);
  }

  // 实时环境强度：与 conditionFor 同源的连续量。arid 的 lux 与激活条件共用
  // 公式（含降雨衰减），其余类型在临界值处与既有二元激活条件精确重合。
  // over 按 direction 判定越界，供 HUD 高亮当前强度是否已越过临界值。
  function intensityFor(typeKey, context) {
    var metric = METRICS[typeKey];
    if (!metric || !metric.unit) return { value: 0, unit: '', critical: 0, over: false, text: '' };
    var ctx = normalizeContext(context);
    var value = 0;
    if (typeKey === 'arid') {
      value = ctx.sunlight * HEAT_MAX_LUX * (1 - HEAT_RAIN_ATTENUATION * ctx.rain) * (ctx.sky / 15);
    } else if (typeKey === 'frozen') {
      value = -18 + 14 * ctx.sunlight + (ctx.outdoors ? 0 : 20) + (ctx.blockLight >= 10 ? 30 : 0);
    } else if (typeKey === 'toxic') {
      value = ctx.inWater ? 40 : (ctx.outdoors ? 900 : 120);
    } else if (typeKey === 'volcanic') {
      value = ctx.inWater ? 15 : (ctx.outdoors ? 260 : 25);
    } else if (typeKey === 'oceanic') {
      value = 101.3 * (1 + ctx.waterDepth / 10);
    }
    value = Math.round(value * 10) / 10;
    var over = metric.direction === 'below' ? value <= metric.critical : value >= metric.critical;
    return {
      value: value,
      unit: metric.unit,
      critical: metric.critical,
      over: over,
      text: formatIntensity(value, metric.unit) + ' · 临界 ' + formatIntensity(metric.critical, metric.unit)
    };
  }

  function conditionFor(typeKey, context) {
    var profile = profileFor(typeKey);
    if (context.sealedShelter)
      return { active: false, protected: true, reason: '飞船密封舱净化', sealedShelter: true, profile: profile };
    if (context.spawnSafe)
      return { active: false, protected: true, reason: '出生安全区', profile: profile };
    if (profile.hazard === 'none')
      return { active: false, protected: true, reason: '环境稳定', profile: profile };
    if (typeKey === 'arid') {
      var heat = intensityFor('arid', context);
      if (context.inWater) return { active: false, protected: true, reason: '水体降温', profile: profile };
      // 降雨会衰减到达地面的日照强度；lux 跌破临界值即不再积累热负荷。
      if (heat.value < heat.critical)
        return { active: false, protected: true, reason: '光照不足', profile: profile };
      if (!context.outdoors) return { active: false, protected: true, reason: '遮阴降温', profile: profile };
      return { active: true, protected: false, reason: '烈日暴晒', profile: profile };
    }
    if (typeKey === 'frozen') {
      if (context.blockLight >= 10)
        return { active: false, protected: true, reason: '高亮热源', profile: profile };
      if (!context.outdoors) return { active: false, protected: true, reason: '遮蔽保温', profile: profile };
      return { active: true, protected: false, reason: '露天低温', profile: profile };
    }
    if (typeKey === 'toxic' || typeKey === 'volcanic') {
      if (context.inWater)
        return { active: false, protected: true, reason: typeKey === 'toxic' ? '水体隔绝毒气' : '水体隔绝火山灰', profile: profile };
      if (!context.outdoors)
        return { active: false, protected: true, reason: typeKey === 'toxic' ? '遮蔽隔绝毒气' : '遮蔽隔绝火山灰', profile: profile };
      return { active: true, protected: false, reason: typeKey === 'toxic' ? '露天毒气' : '露天火山灰', profile: profile };
    }
    if (typeKey === 'oceanic') {
      if (!context.inWater || context.waterDepth < 6)
        return { active: false, protected: true, reason: context.inWater ? '浅水压力安全' : '离开深水', profile: profile };
      return { active: true, protected: false, reason: '深水高压', profile: profile };
    }
    return { active: false, protected: true, reason: '环境稳定', profile: profile };
  }

  function levelFor(exposure, threshold) {
    threshold = finiteNumber(threshold) ? clamp(threshold, 1, 100) : DAMAGE_THRESHOLD;
    if (exposure >= threshold) return 'critical';
    if (exposure >= Math.max(0, threshold - 20)) return 'danger';
    if (exposure >= Math.max(0, threshold - 55)) return 'warning';
    return 'safe';
  }

  function rounded(value) {
    return Math.round(value * 1000) / 1000;
  }

  function makeStatus() {
    if (!current) return {
      worldId: '', typeKey: '', hazard: 'none', damageCause: 'none', label: '环境系统离线',
      exposure: 0, percent: 0, threshold: 100, level: 'safe', graceRemaining: 0,
      intensity: 0, intensityUnit: '', criticalIntensity: 0, intensityText: '', overCritical: false,
      active: false, protected: true, reason: '环境系统离线'
    };
    var record = worlds[current.id] || { exposure: 0 };
    var profile = profileFor(current.typeKey);
    var condition = lastCondition || { active: false, protected: true, reason: '等待环境数据' };
    var metric = intensityFor(current.typeKey, lastContext);
    return {
      worldId: current.id,
      typeKey: current.typeKey,
      hazard: profile.hazard,
      damageCause: profile.hazard,
      label: profile.label,
      exposure: rounded(safeExposure(record.exposure)),
      percent: Math.round(safeExposure(record.exposure)),
      threshold: rounded(profile.threshold),
      level: levelFor(record.exposure, profile.threshold),
      graceRemaining: rounded(clamp(graceRemaining, 0, LOAD_GRACE)),
      intensity: metric.value,
      intensityUnit: metric.unit,
      criticalIntensity: metric.critical,
      intensityText: metric.text,
      overCritical: metric.over === true && profile.hazard !== 'none',
      active: !!condition.active,
      protected: !!condition.protected || graceRemaining > 0,
      sealedShelter: !!(lastContext && lastContext.sealedShelter),
      reason: graceRemaining > 0 && condition.active ? '环境适应期' : condition.reason
    };
  }

  function loadWorld(world, savedState, options) {
    if (savedState !== undefined) {
      var restored = hydrate(savedState);
      worlds = restored.worlds;
      worldCount = restored.count;
    }
    var id = safeId(world && world.id);
    var typeKey = safeType(world && world.typeKey);
    if (!id || !typeKey) {
      current = null;
      accumulator = 0;
      graceRemaining = 0;
      damageClock = 0;
      lastContext = null;
      lastCondition = { active: false, protected: true, reason: '环境系统离线' };
      return makeStatus();
    }
    current = { id: id, typeKey: typeKey };
    // 恶意存档不能用 64 个无关世界挤掉当前世界的环境状态；有界地淘汰一项再接纳当前项。
    if (!worlds[id] && worldCount >= MAX_WORLDS) {
      for (var oldId in worlds) {
        if (!Object.prototype.hasOwnProperty.call(worlds, oldId)) continue;
        delete worlds[oldId];
        worldCount--;
        break;
      }
    }
    var record = ensureWorld(id);
    if (!record) {
      current = null;
      return makeStatus();
    }
    if (profileFor(typeKey).hazard === 'none') record.exposure = 0;
    accumulator = 0;
    // 页面首次读档默认给30s保护；页面内跃迁使用"new"语义，
    // 只在首次抵达该天体时给予。否则往返免费传送门可无限刷新宽限期。
    var graceMode = plainObject(options) ? options.grantGrace : undefined;
    var alreadyAdapted = record.adapted === true;
    // adapted=false 也包含从旧v1快照迁移来的“已有条目但从未领取”天体；
    // 首次返航同样应获得一次保护，不能再以条目是否存在额外拦截。
    var grantGrace = graceMode === true || !alreadyAdapted;
    graceRemaining = graceMode === false ? 0 : (grantGrace ? LOAD_GRACE : 0);
    // 首次读档/抵达就立即记为已领取；enterWorld 结尾的一致存档会落盘。
    // 因此 F5 不能每30秒无限重置适应期，而旧档仍安全获得一次。
    record.adapted = true;
    damageClock = 0;
    lastContext = normalizeContext(null);
    lastCondition = conditionFor(typeKey, lastContext);
    return makeStatus();
  }

  function processStep(context) {
    if (!current) return 0;
    var record = worlds[current.id];
    var condition = conditionFor(current.typeKey, context);
    var profile = condition.profile;
    lastCondition = condition;
    if (profile.hazard === 'none') {
      record.exposure = 0;
      graceRemaining = Math.max(0, graceRemaining - FIXED_STEP);
      damageClock = 0;
      return 0;
    }

    var inGrace = graceRemaining > 0;
    graceRemaining = Math.max(0, graceRemaining - FIXED_STEP);
    if (condition.active && !inGrace) record.exposure += profile.gain * FIXED_STEP;
    else if (!condition.active) {
      var recovery = condition.sealedShelter
        ? Math.max(profile.recover, SEALED_SHELTER_RECOVERY) : profile.recover;
      record.exposure -= recovery * FIXED_STEP;
    }
    record.exposure = safeExposure(record.exposure);

    if (inGrace || !condition.active || record.exposure < profile.threshold || profile.interval <= 0 || profile.damage <= 0) {
      damageClock = 0;
      return 0;
    }
    damageClock += FIXED_STEP;
    var due = 0;
    while (damageClock + 1e-9 >= profile.interval) {
      damageClock -= profile.interval;
      due += profile.damage;
    }
    return due;
  }

  function update(dt, context) {
    var safeDt = finiteNumber(dt) && dt > 0 ? Math.min(dt, MAX_DT) : 0;
    lastContext = normalizeContext(context);
    lastCondition = current ? conditionFor(current.typeKey, lastContext) :
      { active: false, protected: true, reason: '环境系统离线' };
    accumulator += safeDt;
    var damageDue = 0;
    var steps = Math.min(Math.floor((accumulator + 1e-9) / FIXED_STEP), Math.ceil(MAX_DT / FIXED_STEP));
    if (steps > 0) accumulator -= steps * FIXED_STEP;
    if (accumulator < 1e-9) accumulator = 0;
    for (var i = 0; i < steps; i++) damageDue += processStep(lastContext);
    return { damageDue: damageDue, status: makeStatus() };
  }

  function snapshot() {
    var out = { v: VERSION, worlds: {} };
    var count = 0;
    for (var key in worlds) {
      if (count >= MAX_WORLDS || !Object.prototype.hasOwnProperty.call(worlds, key)) break;
      var id = safeId(key), record = worlds[key];
      if (!id || !record) continue;
      out.worlds[id] = { exposure: rounded(safeExposure(record.exposure)), adapted: record.adapted === true };
      count++;
    }
    return out;
  }

  function onRespawn() {
    if (current && worlds[current.id]) worlds[current.id].exposure = 0;
    accumulator = 0;
    graceRemaining = current ? RESPAWN_GRACE : 0;
    damageClock = 0;
    lastCondition = current ? conditionFor(current.typeKey, lastContext || normalizeContext(null)) :
      { active: false, protected: true, reason: '环境系统离线' };
    return makeStatus();
  }

  function clear() {
    worlds = Object.create(null);
    worldCount = 0;
    current = null;
    accumulator = 0;
    graceRemaining = 0;
    damageClock = 0;
    lastContext = null;
    lastCondition = { active: false, protected: true, reason: '环境系统离线' };
    return makeStatus();
  }

  return {
    loadWorld: loadWorld,
    update: update,
    snapshot: snapshot,
    onRespawn: onRespawn,
    clear: clear,
    status: makeStatus,
    _test: {
      VERSION: VERSION,
      FIXED_STEP: FIXED_STEP,
      LOAD_GRACE: LOAD_GRACE,
      RESPAWN_GRACE: RESPAWN_GRACE,
      SPAWN_SAFE_RADIUS: SPAWN_SAFE_RADIUS,
      DAMAGE_THRESHOLD: DAMAGE_THRESHOLD,
      DAMAGE_INTERVAL: DAMAGE_INTERVAL,
      SEALED_SHELTER_RECOVERY: SEALED_SHELTER_RECOVERY,
    profileFor: profileFor,
    hydrate: hydrate,
    normalizeContext: normalizeContext,
    conditionFor: conditionFor,
    intensityFor: intensityFor,
    METRICS: METRICS
    }
  };
})();
