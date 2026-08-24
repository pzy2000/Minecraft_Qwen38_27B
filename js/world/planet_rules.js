// 行星规则版本层：旧地形的精确兼容 + v2 连续群系、差异资源与环境危害配置。
// 纯逻辑模块；不依赖 DOM、THREE、Math.random。调用方必须显式提供气候与哈希样本。
window.Voxel = window.Voxel || {};

Voxel.PlanetRules = (function () {
  var B = Voxel.Biomes.B;
  var V1 = 1, V2 = 2;
  var PLANET_TYPES = ['lush', 'arid', 'frozen', 'toxic', 'volcanic', 'oceanic'];

  // v1 必须逐字保持 world.js / infinite.js 的旧映射，包括 oceanic 中 OCEAN
  // 重复两次所形成的 50% 海洋权重。不要“去重优化”这个表。
  var LEGACY_SETS = {
    arid: [B.DESERT, B.BADLANDS, B.SAVANNA, B.STONY_PEAKS],
    frozen: [B.SNOWY, B.FROZEN_PEAKS, B.TAIGA, B.JAGGED_PEAKS],
    toxic: [B.JUNGLE, B.MEGA_TAIGA, B.FOREST, B.SPARSE_JUNGLE],
    volcanic: [B.BADLANDS, B.STONY_PEAKS, B.JAGGED_PEAKS, B.WINDSWEPT_HILLS],
    oceanic: [B.OCEAN, B.BEACH, B.OCEAN, B.SPARSE_JUNGLE]
  };

  // v2 只限制候选集合；实际选择由连续五维气候最近邻决定，不再逐格哈希跳变。
  var ALLOWED = {
    lush: (function () { var out = []; for (var i = 0; i < Voxel.Biomes.count; i++) out.push(i); return out; })(),
    arid: [B.DESERT, B.BADLANDS, B.SAVANNA, B.STONY_PEAKS],
    frozen: [B.SNOWY, B.FROZEN_PEAKS, B.TAIGA, B.JAGGED_PEAKS],
    toxic: [B.JUNGLE, B.MEGA_TAIGA, B.FOREST, B.SPARSE_JUNGLE],
    volcanic: [B.BADLANDS, B.STONY_PEAKS, B.JAGGED_PEAKS, B.WINDSWEPT_HILLS],
    oceanic: [B.OCEAN, B.BEACH, B.SPARSE_JUNGLE],
    station: [B.STONY_PEAKS]
  };

  // blockId 39..44 / itemId 115..120 是本轮冻结的稳定存档 ID。
  var RESOURCE = {
    lush: {
      coalMultiplier: 1.00, ironMultiplier: 1.00,
      exclusive: { key: 'verdant_crystal', blockId: 39, itemId: 115, minY: 8, maxY: 42, chance: 0.0024, tier: 1 }
    },
    arid: {
      coalMultiplier: 1.35, ironMultiplier: 1.60,
      exclusive: { key: 'silica_crystal', blockId: 40, itemId: 116, minY: 4, maxY: 30, chance: 0.0032, tier: 1 }
    },
    frozen: {
      coalMultiplier: 0.85, ironMultiplier: 1.15,
      exclusive: { key: 'frost_core', blockId: 41, itemId: 117, minY: 10, maxY: 48, chance: 0.0028, tier: 2 }
    },
    toxic: {
      coalMultiplier: 1.10, ironMultiplier: 0.80,
      exclusive: { key: 'spore_crystal', blockId: 42, itemId: 118, minY: 6, maxY: 38, chance: 0.0030, tier: 2 }
    },
    volcanic: {
      coalMultiplier: 1.50, ironMultiplier: 1.40,
      exclusive: { key: 'magma_core', blockId: 43, itemId: 119, minY: 3, maxY: 28, chance: 0.0035, tier: 3 }
    },
    oceanic: {
      coalMultiplier: 0.75, ironMultiplier: 0.90,
      exclusive: { key: 'tidal_crystal', blockId: 44, itemId: 120, minY: 4, maxY: 24, chance: 0.0026, tier: 2 }
    },
    station: { coalMultiplier: 0, ironMultiplier: 0, exclusive: null }
  };

  // 与 Environment 的 0..100 稳定契约一致。accumulation/recovery 是每秒风险
  // 变化量；达到90后每2秒结算伤害。foodDrain 预留但本轮不启用。
  var HAZARDS = {
    lush:      { key: 'none',     damageCause: 'none',     label: '环境稳定',   accumulation: 0,   recovery: 12, threshold: 90, interval: 2, damage: 0, foodDrain: 0 },
    station:   { key: 'none',     damageCause: 'none',     label: '环境稳定',   accumulation: 0,   recovery: 12, threshold: 90, interval: 2, damage: 0, foodDrain: 0 },
    arid:      { key: 'heat',     damageCause: 'heat',     label: '日照热负荷', accumulation: 4,   recovery: 8,  threshold: 90, interval: 2, damage: 1, foodDrain: 0 },
    frozen:    { key: 'cold',     damageCause: 'cold',     label: '低温暴露',   accumulation: 3.5, recovery: 7,  threshold: 90, interval: 2, damage: 1, foodDrain: 0 },
    toxic:     { key: 'toxic',    damageCause: 'toxic',    label: '毒性暴露',   accumulation: 4.5, recovery: 8,  threshold: 90, interval: 2, damage: 1, foodDrain: 0 },
    volcanic:  { key: 'ash',      damageCause: 'ash',      label: '火山灰暴露', accumulation: 5,   recovery: 8,  threshold: 90, interval: 2, damage: 1, foodDrain: 0 },
    oceanic:   { key: 'pressure', damageCause: 'pressure', label: '深水压力',   accumulation: 6,   recovery: 10, threshold: 90, interval: 2, damage: 1, foodDrain: 0 }
  };

  function normalizeVersion(value, fallback) {
    if (value === V1 || value === V2) return value;
    return fallback === V2 ? V2 : V1;
  }

  function knownType(typeKey) {
    return typeof typeKey === 'string' && Object.prototype.hasOwnProperty.call(ALLOWED, typeKey);
  }

  function allowedBiomes(typeKey) {
    var key = knownType(typeKey) ? typeKey : 'lush';
    return ALLOWED[key].slice();
  }

  function allowedBiomeRef(typeKey) {
    var key = knownType(typeKey) ? typeKey : 'lush';
    return ALLOWED[key];
  }

  function hashSample(hash2, x, z) {
    var value;
    try {
      if (typeof hash2 === 'function') value = hash2(x, z);
      else if (hash2 && typeof hash2.hash2 === 'function') value = hash2.hash2(x, z);
    } catch (e) { value = NaN; }
    if (typeof value !== 'number' || !isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1 - Number.EPSILON;
    return value;
  }

  function legacyProfileBiome(typeKey, base, x, z, hash2) {
    if (!typeKey || typeKey === 'lush') return base;
    var set = LEGACY_SETS[typeKey];
    if (!set) return base;
    var sample = hashSample(hash2, x * 5 + 173, z * 7 + 251);
    var index = (sample * set.length) | 0;
    return set[Math.min(set.length - 1, index)];
  }

  function pickAllowed(typeKey, climate, fallback) {
    // 生成热路径直接读冻结的内部白名单；这些 ID 已受信，不得
    // 每列再走公开 pickAllowed 的类型校验/O(k²)去重。公开 API 仍保留完整防御。
    var allowed = allowedBiomeRef(typeKey);
    var best = allowed[0], bestD = Infinity, fallbackAllowed = false;
    for (var i = 0; i < allowed.length; i++) {
      var id = allowed[i];
      if (id === fallback) fallbackAllowed = true;
      var d = Voxel.Biomes.distanceSq(climate, id);
      if (d < bestD) { bestD = d; best = id; }
    }
    if (bestD < Infinity) return best;
    return fallbackAllowed ? fallback : allowed[0];
  }

  function biomeFor(version, typeKey, base, climate, x, z, hash2) {
    return normalizeVersion(version, V1) === V1
      ? legacyProfileBiome(typeKey, base, x, z, hash2)
      : pickAllowed(typeKey, climate, base);
  }

  function validRoll(value) {
    return typeof value === 'number' && isFinite(value) && value >= 0 && value < 1;
  }

  function validY(y) {
    return typeof y === 'number' && isFinite(y) && Math.floor(y) === y;
  }

  // 精确旧顺序/阈值：coal 优先，y<50 && r<.007；否则 iron，y<34 && r>.994。
  function legacyOre(y, roll) {
    if (!validY(y) || !validRoll(roll)) return 0;
    if (y < 50 && roll < 0.007) return 8;
    if (y < 34 && roll > 0.994) return 9;
    return 0;
  }

  function cloneExclusive(exclusive) {
    if (!exclusive) return null;
    return {
      key: exclusive.key, blockId: exclusive.blockId, itemId: exclusive.itemId,
      minY: exclusive.minY, maxY: exclusive.maxY, chance: exclusive.chance, tier: exclusive.tier
    };
  }

  function resourceProfile(typeKey) {
    var key = knownType(typeKey) ? typeKey : 'lush';
    var source = RESOURCE[key] || RESOURCE.lush;
    return {
      typeKey: key,
      coalMultiplier: source.coalMultiplier,
      ironMultiplier: source.ironMultiplier,
      coalChance: 0.007 * source.coalMultiplier,
      ironChance: 0.006 * source.ironMultiplier,
      exclusive: cloneExclusive(source.exclusive)
    };
  }

  function noneOre() { return { blockId: 0, itemId: 0, key: null, exclusive: false }; }

  function exclusiveOre(typeKey, y, roll) {
    var profile = resourceProfile(typeKey);
    var rule = profile.exclusive;
    if (!rule || !validY(y) || !validRoll(roll) || y < rule.minY || y > rule.maxY ||
      roll >= rule.chance) return noneOre();
    return { blockId: rule.blockId, itemId: rule.itemId, key: rule.key, exclusive: true };
  }

  // 数值核心：生成热路径调用，绝不构造对象/数组，也不调用会克隆配置的公开 API。
  function oreBlockAt(version, typeKey, y, coalRoll, ironRoll, exclusiveRoll) {
    if (normalizeVersion(version, V1) === V1) {
      // v1 只有一个旧hash样本；额外roll必须完全忽略，才能保持旧世界字节一致。
      return legacyOre(y, coalRoll);
    }
    if (!validY(y)) return 0;
    var key = knownType(typeKey) ? typeKey : 'lush';
    var source = RESOURCE[key] || RESOURCE.lush;
    var special = source.exclusive;
    if (special && validRoll(exclusiveRoll) && y >= special.minY && y <= special.maxY &&
      exclusiveRoll < special.chance) return special.blockId;
    if (validRoll(coalRoll) && y < 50 && coalRoll < 0.007 * source.coalMultiplier) return 8;
    if (validRoll(ironRoll) && y < 34 && ironRoll < 0.006 * source.ironMultiplier) return 9;
    return 0;
  }

  function oreDescriptor(blockId, typeKey) {
    if (blockId === 8) return { blockId: 8, itemId: 107, key: 'coal', exclusive: false };
    if (blockId === 9) return { blockId: 9, itemId: 9, key: 'iron', exclusive: false };
    var key = knownType(typeKey) ? typeKey : 'lush';
    var special = (RESOURCE[key] || RESOURCE.lush).exclusive;
    if (special && blockId === special.blockId)
      return { blockId: blockId, itemId: special.itemId, key: special.key, exclusive: true };
    return noneOre();
  }

  function oreAt(version, typeKey, y, coalRoll, ironRoll, exclusiveRoll) {
    return oreDescriptor(oreBlockAt(version, typeKey, y, coalRoll, ironRoll, exclusiveRoll), typeKey);
  }

  function safeHash3(noise, x, y, z) {
    if (!noise || typeof noise.hash3 !== 'function') return NaN;
    try {
      var value = noise.hash3(x, y, z);
      return validRoll(value) ? value : NaN;
    } catch (e) { return NaN; }
  }

  // 固定坐标盐：hash3 自身最终按 int32 混合；三组偏移保证煤/铁/专属矿不共享roll。
  var COAL_SALT_X = 0x13579b, COAL_SALT_Y = 0x02468a, COAL_SALT_Z = 0x1b8735;
  var IRON_SALT_X = 0x51f15e, IRON_SALT_Y = 0x2c1b3c, IRON_SALT_Z = 0x7f4a7c;
  var SPECIAL_SALT_X = 0x6d2b79, SPECIAL_SALT_Y = 0x4cf5ad, SPECIAL_SALT_Z = 0x3c6ef3;

  function oreBlockTrusted(version, typeKey, x, y, z, noise) {
    var coalRoll, ironRoll, exclusiveRoll;
    if (version !== V2) {
      coalRoll = noise.hash3(x, y, z);
      if (typeof coalRoll !== 'number' || coalRoll < 0 || coalRoll >= 1) return 0;
      if (y < 50 && coalRoll < 0.007) return 8;
      if (y < 34 && coalRoll > 0.994) return 9;
      return 0;
    }
    var source = RESOURCE[typeKey] || RESOURCE.lush;
    var special = source.exclusive;
    // 先按高度裁掉不可能的通道；原实现对每个实心体素无条件做3次hash，
    // 使完整v2核心生成超过v1的1.5倍。三种资源仍使用独立salt。
    if (special && y >= special.minY && y <= special.maxY) {
      exclusiveRoll = noise.hash3(x + SPECIAL_SALT_X, y + SPECIAL_SALT_Y, z + SPECIAL_SALT_Z);
      if (typeof exclusiveRoll === 'number' && exclusiveRoll >= 0 && exclusiveRoll < special.chance)
        return special.blockId;
    }
    if (y >= 50) return 0;
    coalRoll = noise.hash3(x + COAL_SALT_X, y + COAL_SALT_Y, z + COAL_SALT_Z);
    if (typeof coalRoll === 'number' && coalRoll >= 0 &&
      coalRoll < 0.007 * source.coalMultiplier && y < 50) return 8;
    if (y >= 34) return 0;
    ironRoll = noise.hash3(x + IRON_SALT_X, y + IRON_SALT_Y, z + IRON_SALT_Z);
    if (typeof ironRoll === 'number' && ironRoll >= 0 &&
      ironRoll < 0.006 * source.ironMultiplier && y < 34) return 9;
    return 0;
  }

  function oreBlockForPosition(version, typeKey, x, y, z, noise) {
    // 这是每个实心体素都会进入的最热路径：可信生成器直接进入可优化的数值核心；
    // 外层仅保留一次坏依赖保护，不创建结果对象。
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' ||
      !isFinite(x) || !isFinite(y) || !isFinite(z) || Math.floor(y) !== y ||
      !noise || typeof noise.hash3 !== 'function') return 0;
    try { return oreBlockTrusted(version === V2 ? V2 : V1, typeKey, x, y, z, noise); }
    catch (e) { return 0; }
  }

  function oreForPosition(version, typeKey, x, y, z, noise) {
    return oreDescriptor(oreBlockForPosition(version, typeKey, x, y, z, noise), typeKey);
  }

  function hazard(typeKey) {
    // 未知/损坏类型必须回退无伤害，而不能凭错误字段伤害旧存档玩家。
    var source = Object.prototype.hasOwnProperty.call(HAZARDS, typeKey) ? HAZARDS[typeKey] : HAZARDS.lush;
    return {
      key: source.key,
      damageCause: source.damageCause,
      label: source.label,
      accumulation: source.accumulation,
      recovery: source.recovery,
      threshold: source.threshold,
      interval: source.interval,
      damage: source.damage,
      foodDrain: source.foodDrain
    };
  }

  return {
    V1: V1,
    V2: V2,
    PLANET_TYPES: PLANET_TYPES.slice(),
    normalizeVersion: normalizeVersion,
    allowedBiomes: allowedBiomes,
    legacyProfileBiome: legacyProfileBiome,
    pickAllowed: pickAllowed,
    biomeFor: biomeFor,
    legacyOre: legacyOre,
    resourceProfile: resourceProfile,
    exclusiveOre: exclusiveOre,
    oreAt: oreAt,
    oreBlockForPosition: oreBlockForPosition,
    oreForPosition: oreForPosition,
    hazard: hazard
  };
})();
