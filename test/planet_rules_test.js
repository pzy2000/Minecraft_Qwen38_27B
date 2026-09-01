// 行星规则版本回归：v1 地形黄金指纹、v2 连续群系、差异资源与危害纯配置。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = {
  window: {}, console, Math, BigInt, Uint8Array, Uint16Array, Uint32Array, Int16Array, Float32Array, Set,
  THREE: {
    Vector3: function (x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; },
    Group: function () { this.children = []; this.parent = null; }
  }
};
sandbox.window = sandbox;
sandbox.THREE.Group.prototype.add = function (o) { this.children.push(o); o.parent = this; };
sandbox.THREE.Group.prototype.remove = function (o) {
  const i = this.children.indexOf(o);
  if (i >= 0) this.children.splice(i, 1);
  if (o) o.parent = null;
};
vm.createContext(sandbox);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
}

load('js/config.js');
load('js/world/seed.js');
load('js/world/universe.js');
load('js/world/galaxy.js');
load('js/world/noise.js');
load('js/world/biomes.js');
load('js/world/planet_rules.js');
load('js/world/shaper.js');
load('js/world/sections.js');
load('js/world/gen_core.js');
load('js/blocks.js');
load('js/world/world.js');
load('js/world/light.js');
load('js/world/infinite.js');

const V = sandbox.Voxel;
const P = V.PlanetRules;
let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name + (detail ? ' :: ' + detail : ''));
  else { failed++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}

console.log('terrainVersion 创建、迁移与净化');
const fresh = V.Galaxy.create('PLANET-RULES-VERSION');
check('新建星系固定使用 terrainVersion=2', fresh.terrainVersion === 2 &&
  fresh.catalog.every(w => w.terrainVersion === 2));
check('Galaxy/PlanetRules版本净化只接受数字1/2',
  V.Galaxy.normalizeTerrainVersion(1, 2) === 1 && V.Galaxy.normalizeTerrainVersion(2, 1) === 2 &&
  V.Galaxy.normalizeTerrainVersion('2', 2) === 2 && V.Galaxy.normalizeTerrainVersion(3, 2) === 2 &&
  P.normalizeVersion(1, 2) === 1 && P.normalizeVersion(2, 1) === 2 &&
  P.normalizeVersion('2', 2) === 2 && P.normalizeVersion(NaN, 1) === 1);

const oldMissing = V.Galaxy.hydrate({ rootSeed: fresh.rootSeed, catalog: fresh.catalog }, fresh.rootSeed);
check('任何缺 terrainVersion 的既有存档按v1加载并统一盖章', oldMissing.terrainVersion === 1 &&
  oldMissing.catalog.every(w => w.terrainVersion === 1));
const oldV1 = V.Galaxy.hydrate({ rootSeed: fresh.rootSeed, terrainVersion: 1 }, fresh.rootSeed);
check('显式v1存档保持v1', oldV1.terrainVersion === 1 && oldV1.catalog.every(w => w.terrainVersion === 1));
const savedV2 = V.Galaxy.hydrate({ rootSeed: fresh.rootSeed, terrainVersion: 2,
  catalog: fresh.catalog.map((w, i) => Object.assign({}, w, { terrainVersion: i % 2 ? 1 : 99 })) }, fresh.rootSeed);
check('显式v2顶层版本覆盖混乱catalog并保持v2', savedV2.terrainVersion === 2 &&
  savedV2.catalog.every(w => w.terrainVersion === 2));
for (const bad of [0, 3, -1, 1.5, '1', '2', NaN, Infinity, null, {}, []]) {
  const hydrated = V.Galaxy.hydrate({ rootSeed: fresh.rootSeed, terrainVersion: bad }, fresh.rootSeed);
  check('坏terrainVersion安全回退v1 [' + String(bad) + ']', hydrated.terrainVersion === 1 &&
    hydrated.catalog.every(w => w.terrainVersion === 1));
}
check('无saved对象仍等价新建而非旧档迁移', V.Galaxy.hydrate(null, 'PLANET-RULES-VERSION').terrainVersion === 2);

console.log('v1 精确旧规则');
const B = V.Biomes.B;
const legacySets = {
  arid: [B.DESERT, B.BADLANDS, B.SAVANNA, B.STONY_PEAKS],
  frozen: [B.SNOWY, B.FROZEN_PEAKS, B.TAIGA, B.JAGGED_PEAKS],
  toxic: [B.JUNGLE, B.MEGA_TAIGA, B.FOREST, B.SPARSE_JUNGLE],
  volcanic: [B.BADLANDS, B.STONY_PEAKS, B.JAGGED_PEAKS, B.WINDSWEPT_HILLS],
  oceanic: [B.OCEAN, B.BEACH, B.OCEAN, B.SPARSE_JUNGLE]
};
function oldProfileBiome(typeKey, base, x, z, noise) {
  if (!typeKey || typeKey === 'lush') return base;
  const set = legacySets[typeKey];
  if (!set) return base;
  const r = (noise.hash2(x * 5 + 173, z * 7 + 251) * set.length) | 0;
  return set[Math.min(set.length - 1, r)];
}
const legacyNoise = V.Noise.create('PLANET-RULES-LEGACY');
let legacyExact = true;
for (const typeKey of P.PLANET_TYPES) {
  for (const base of [B.OCEAN, B.PLAINS, B.BADLANDS]) {
    for (const [x, z] of [[0, 0], [1, -1], [255, 128], [256, 128], [-1, -33], [9999, -7777]]) {
      const expected = oldProfileBiome(typeKey, base, x, z, legacyNoise);
      const actual = P.legacyProfileBiome(typeKey, base, x, z, legacyNoise);
      if (actual !== expected || P.biomeFor(1, typeKey, base, null, x, z, legacyNoise) !== expected)
        legacyExact = false;
    }
  }
}
check('v1 profileBiome逐样本精确等于旧实现', legacyExact);
const oceanWeights = [0, 0.249999, 0.25, 0.499999, 0.5, 0.749999, 0.75, 0.999999]
  .map(r => P.legacyProfileBiome('oceanic', B.PLAINS, 0, 0, () => r));
check('v1 oceanic保留重复OCEAN形成的旧权重', JSON.stringify(oceanWeights) === JSON.stringify([
  B.OCEAN, B.OCEAN, B.BEACH, B.BEACH, B.OCEAN, B.OCEAN, B.SPARSE_JUNGLE, B.SPARSE_JUNGLE
]));
check('v1 coal/iron阈值与高度边界逐点精确',
  P.legacyOre(49, 0.006999) === 8 && P.legacyOre(49, 0.007) === 0 &&
  P.legacyOre(33, 0.994) === 0 && P.legacyOre(33, 0.994001) === 9 &&
  P.legacyOre(34, 0.999999) === 0 && P.legacyOre(50, 0) === 0 &&
  P.oreAt(1, 'volcanic', 20, 0.006, 0.5, 0).blockId === 8 &&
  P.oreAt(1, 'volcanic', 20, 0.999, 0, 0).blockId === 9 &&
  P.oreAt(1, 'volcanic', 20, 0.5, 0, 0).blockId === 0 &&
  // v1 只能读取第一个旧roll；新增独立salt不得改变任何旧列。
  P.oreAt(1, 'volcanic', 20, 0.999, NaN, NaN).blockId === 9);

console.log('v1 世界黄金指纹（legacy core / 正负外围 / 255-256接缝）');
const GOLDEN = {
  // lush 覆盖整个群系注册表：第 22 轮群系扩展（+蘑菇林/沼泽/樱花树林/黑森林）
  // 与第 23 轮气候降频（群系面积 ~9x）都移动了 MultiNoise 最近邻边界，
  // 自然地形随之重排（edits/建筑逐位保留，用户已确认接受）；
  // 北欧城堡轮新增 NORDIC_FJORD 气候点同样只挪动 lush 边界区域；
  // 其余五类 v1 行星走 LEGACY_SETS 逐格哈希，但 base pick 的输入气候场
  // 同样随频率变化，指纹一并刷新。
  lush: 'cc9aa958',
  arid: '20a55869',
  frozen: '4a03dfd3',
  toxic: '5d8b1ba7',
  volcanic: 'fe69d5fc',
  oceanic: 'db44b8ee'
};
function fingerprintWorld(profile) {
  V.World.init(profile.seed, profile);
  while (!V.World.isReady()) V.World.generateNext(64);
  const points = [];
  // legacy core
  for (let x = 8; x < 256; x += 16) for (let z = 8; z < 256; z += 16) points.push([x, z]);
  // 正外围 / 负外围
  for (let x = 288; x < 320; x += 4) for (let z = 288; z < 320; z += 4) points.push([x, z]);
  for (let x = -32; x < 0; x += 4) for (let z = -32; z < 0; z += 4) points.push([x, z]);
  // 旧核心与无限外围的 255/256 接缝
  for (let x = 252; x <= 259; x++) for (let z = 16; z < 256; z += 16) points.push([x, z]);

  const loaded = new Set();
  for (const [x, z] of points) {
    const cx = Math.floor(x / V.Config.CHUNK), cz = Math.floor(z / V.Config.CHUNK);
    const key = cx + ',' + cz;
    if (!loaded.has(key)) { V.World.ensureChunk(cx, cz); loaded.add(key); }
  }
  let hash = 2166136261 >>> 0;
  function mix(value) {
    value |= 0;
    for (let i = 0; i < 4; i++)
      hash = Math.imul((hash ^ ((value >>> (i * 8)) & 255)) >>> 0, 16777619) >>> 0;
  }
  for (const [x, z] of points) {
    mix(x); mix(z); mix(V.World.biomeAt(x, z)); mix(V.World.surfaceAt(x, z));
    // 地形一致性契约：黄金值生成于旧限高 H=64，采样域必须钉住旧内容域，
    // 否则限高提升后新增的纯空气行会改变摘要（内容本身仍逐位一致）。
    const LEGACY_DOMAIN_H = 64;
    for (let y = 0; y < Math.min(LEGACY_DOMAIN_H, V.Config.WORLD_H); y++) mix(V.World.get(x, y, z));
  }
  return hash.toString(16).padStart(8, '0');
}
const goldenGalaxy = V.Galaxy.create('PLANET-RULES-GOLDEN');
for (const world of goldenGalaxy.catalog.filter(w => w.kind === 'planet')) {
  const legacyProfile = Object.assign({}, world, { terrainVersion: 1 });
  const actual = fingerprintWorld(legacyProfile);
  check('v1黄金指纹 ' + world.typeKey, actual === GOLDEN[world.typeKey], actual);
}

// 真实完整核心性能路径：v2不得先做一次全18群系base pick再丢弃。
const originalBasePick = V.Biomes.pick;
let v2BasePickCalls = 0;
V.Biomes.pick = function (climate) { v2BasePickCalls++; return originalBasePick(climate); };
const v2HotWorld = Object.assign({}, goldenGalaxy.catalog.find(w => w.typeKey === 'toxic'),
  { terrainVersion: 2, seed: 'PLANET-RULES-V2-HOT-PATH' });
V.World.init(v2HotWorld.seed, v2HotWorld);
while (!V.World.isReady()) V.World.generateNext(64);
V.Biomes.pick = originalBasePick;
check('v2完整256²核心直接类型白名单，不重复调用全群系base pick', v2BasePickCalls === 0,
  String(v2BasePickCalls));

console.log('v2 连续群系白名单、确定性与多样性');
// 种子必须是数字串：SeedUtil.toBigInt 对文本种子回退 crypto 随机，
// 文本种子会让本节跨进程不可复现（生产主流程总是先规范化为数字串）。
const continuityClimate = V.Biomes.makeClimate(V.Noise.create('7251399515439241446'));
for (const typeKey of P.PLANET_TYPES) {
  const allowed = P.allowedBiomes(typeKey);
  const allowedSet = new Set(allowed);
  let changes = 0, edges = 0;
  let previous = null;
  const seen = new Set();
  let deterministic = true, whitelist = true;
  // 采样窗随第 23 轮气候降频同比扩大（×3）：更低的群系频率下
  // 等面积窗口容纳的群系更少，用更大的窗口维持同等多样性压力。
  for (let z = -192; z < 192; z++) {
    const row = [];
    for (let x = -192; x < 192; x++) {
      const climate = continuityClimate(x, z);
      const picked = P.pickAllowed(typeKey, climate, B.PLAINS);
      const again = P.biomeFor(2, typeKey, B.PLAINS, climate, x + 999, z - 999,
        () => { throw new Error('v2不得读取离散hash2'); });
      if (picked !== again) deterministic = false;
      if (!allowedSet.has(picked)) whitelist = false;
      row.push(picked); seen.add(picked);
      if (x > -192) { edges++; if (picked !== row[row.length - 2]) changes++; }
      if (previous) { edges++; if (picked !== previous[x + 192]) changes++; }
    }
    previous = row;
  }
  const ratio = changes / edges;
  check(typeKey + ' v2结果只来自白名单且不依赖坐标hash', whitelist && deterministic);
  check(typeKey + ' 相邻群系跳变率<12%', ratio < 0.12, (ratio * 100).toFixed(2) + '%');
  check(typeKey + ' 连续气候仍保留多样性', seen.size >= (typeKey === 'lush' ? 8 : 2),
    Array.from(seen).map(id => V.Biomes.name(id)).join(','));
  let allAnchorsReachable = true;
  for (const id of allowed) {
    const p = V.Biomes.points[id];
    const anchor = { t: p[0], h: p[1], c: p[2], e: p[3], w: p[4] };
    if (P.pickAllowed(typeKey, anchor, allowed[0]) !== id) allAnchorsReachable = false;
  }
  check(typeKey + ' 白名单各气候锚点均可达', allAnchorsReachable);
}
check('pickAllowed坏气候/坏白名单安全回退',
  P.pickAllowed('arid', { t: NaN, h: 0, c: 0, e: 0, w: 0 }, B.DESERT) === B.DESERT &&
  V.Biomes.pickAllowed(null, [999, 'bad'], B.FOREST) === B.FOREST &&
  P.allowedBiomes('unknown').length === V.Biomes.count);

const hotAllowed = P.allowedBiomes('lush');
const hotAllowedBytes = JSON.stringify(hotAllowed);
Object.freeze(hotAllowed);
const hotClimate = continuityClimate(17, -29);
const hotExpected = V.Biomes.pickAllowed(hotClimate, hotAllowed, B.PLAINS);
const hotStart = Date.now();
let hotStable = true;
for (let i = 0; i < 65536; i++)
  if (V.Biomes.pickAllowed(hotClimate, hotAllowed, B.PLAINS) !== hotExpected) hotStable = false;
const hotElapsed = Date.now() - hotStart;
const pickSource = String(V.Biomes.pickAllowed);
const rulePickSource = String(P.pickAllowed);
check('pickAllowed整世界热路径零临时数组且不改写输入白名单', hotStable &&
  JSON.stringify(hotAllowed) === hotAllowedBytes &&
  !/valid\s*=\s*\[\]|vals\s*=\s*\[\]|\.slice\(|\.push\(|\.indexOf\(/.test(pickSource) &&
  rulePickSource.indexOf('allowedBiomeRef') >= 0 && rulePickSource.indexOf('allowedBiomes(') < 0,
  hotElapsed + 'ms/65536列');
const publicAllowed = P.allowedBiomes('arid');
publicAllowed[0] = 999;
check('公开allowedBiomes返回副本，外部改写不污染内部热路径',
  P.allowedBiomes('arid')[0] === B.DESERT);

console.log('v2 资源倍率、范围与六类专属矿');
const expectedExclusive = [
  ['lush', 'verdant_crystal', 39, 115],
  ['arid', 'silica_crystal', 40, 116],
  ['frozen', 'frost_core', 41, 117],
  ['toxic', 'spore_crystal', 42, 118],
  ['volcanic', 'magma_core', 43, 119],
  ['oceanic', 'tidal_crystal', 44, 120]
];
const exclusiveIds = new Set(), exclusiveKeys = new Set();
for (const [typeKey, key, blockId, itemId] of expectedExclusive) {
  const profile = P.resourceProfile(typeKey);
  const rule = profile.exclusive;
  exclusiveIds.add(rule.blockId); exclusiveKeys.add(rule.key);
  check(typeKey + '资源倍率/概率有限有界',
    profile.coalMultiplier >= 0.5 && profile.coalMultiplier <= 2 &&
    profile.ironMultiplier >= 0.5 && profile.ironMultiplier <= 2 &&
    profile.coalChance > 0 && profile.coalChance < 0.02 &&
    profile.ironChance > 0 && profile.ironChance < 0.02);
  check(typeKey + '专属矿稳定ID/key/range', rule.key === key && rule.blockId === blockId &&
    rule.itemId === itemId && rule.minY >= 0 && rule.maxY < V.Config.WORLD_H &&
    rule.minY <= rule.maxY && rule.chance > 0 && rule.chance < 0.01);
  const middleY = Math.floor((rule.minY + rule.maxY) / 2);
  const special = P.oreAt(2, typeKey, middleY, 0.5, 0.5, 0);
  check(typeKey + '专属矿仅在自身规则内生成', special.exclusive && special.key === key &&
    special.blockId === blockId && special.itemId === itemId &&
    P.exclusiveOre(typeKey, rule.minY - 1, 0).blockId === 0 &&
    P.exclusiveOre(typeKey, rule.maxY + 1, 0).blockId === 0 &&
    P.exclusiveOre(typeKey, middleY, rule.chance).blockId === 0);
  check(typeKey + 'coal/iron倍率阈值按profile生效',
    P.oreAt(2, typeKey, 20, profile.coalChance / 2, 0.5, 0.5).blockId === 8 &&
    P.oreAt(2, typeKey, 20, 0.5, profile.ironChance / 2, 0.5).blockId === 9 &&
    P.oreAt(2, typeKey, 50, 0, 0, 0.5).blockId === 0 &&
    P.oreAt(2, typeKey, 34, 0.5, 0, 0.5).blockId === 0);
  check(typeKey + 'coal/iron使用独立salt互不挤占',
    P.oreAt(2, typeKey, 20, 0.5, profile.ironChance / 2, 0.5).blockId === 9 &&
    P.oreAt(2, typeKey, 20, 0.9, profile.ironChance / 2, 0.5).blockId === 9 &&
    P.oreAt(2, typeKey, 20, profile.coalChance / 2, 0.5, 0.5).blockId === 8 &&
    P.oreAt(2, typeKey, 20, profile.coalChance / 2, 0.9, 0.5).blockId === 8);
}
check('六类专属矿blockId/key完全独占', exclusiveIds.size === 6 && exclusiveKeys.size === 6);
check('荒漠/熔火富矿且海洋煤铁倍率更低',
  P.resourceProfile('arid').ironChance > P.resourceProfile('lush').ironChance &&
  P.resourceProfile('volcanic').coalChance > P.resourceProfile('lush').coalChance &&
  P.resourceProfile('oceanic').coalChance < P.resourceProfile('lush').coalChance);
check('空间站不生成矿物，未知类型资源安全回退lush',
  P.oreAt(2, 'station', 20, 0, 0, 0).blockId === 0 &&
  P.resourceProfile('unknown').exclusive.key === 'verdant_crystal');

const v1HashCalls = [];
const v1HashNoise = { hash3: function (x, y, z) { v1HashCalls.push([x, y, z]); return 0.006; } };
check('oreBlockForPosition v1只调用一次原坐标旧hash3',
  P.oreBlockForPosition(1, 'arid', -33, 20, 256, v1HashNoise) === 8 &&
  JSON.stringify(v1HashCalls) === JSON.stringify([[-33, 20, 256]]));
const v2HashCalls = [];
const v2HashNoise = { hash3: function (x, y, z) {
  v2HashCalls.push([x, y, z]);
  return 0.5;
} };
const positionalNone = P.oreBlockForPosition(2, 'volcanic', 12, 12, -7, v2HashNoise);
const specialCalls = [];
const positionalSpecial = P.oreBlockForPosition(2, 'volcanic', 12, 12, -7, {
  hash3: function (x, y, z) { specialCalls.push([x, y, z]); return 0; }
});
check('oreBlockForPosition v2适用的六组salt互异且专属矿优先短路',
  positionalNone === 0 && typeof positionalNone === 'number' && v2HashCalls.length === 6 &&
  positionalSpecial === 43 && specialCalls.length === 1 &&
  new Set(v2HashCalls.map(call => call.join(','))).size === 6);
let highCalls = 0, midCalls = 0, coalHitCalls = 0;
P.oreBlockForPosition(2, 'volcanic', 1, 50, 2, { hash3: function () { highCalls++; return .5; } });
P.oreBlockForPosition(2, 'volcanic', 1, 40, 2, { hash3: function () { midCalls++; return .5; } });
P.oreBlockForPosition(2, 'lush', 1, 45, 2, { hash3: function () { coalHitCalls++; return 0; } });
check('v2矿物hash按高度/命中短路，不对每个实心格无条3次采样',
  highCalls === 0 && midCalls === 1 && coalHitCalls === 1);
const positionNoise = V.Noise.create('PLANET-RULES-POSITION-ORE');
const positionOreA = P.oreBlockForPosition(2, 'frozen', 123, 17, -456, positionNoise);
const positionOreB = P.oreBlockForPosition(2, 'frozen', 123, 17, -456, positionNoise);
check('位置矿物API同seed/坐标字节确定且坏noise安全none', positionOreA === positionOreB &&
  P.oreBlockForPosition(2, 'frozen', 123, 17, -456, null) === 0 &&
  P.oreBlockForPosition(2, 'frozen', 123, 17, -456, { hash3: function () { throw new Error('bad'); } }) === 0);
check('生成热API不调用对象描述API且结果始终numeric',
  String(P.oreBlockForPosition).indexOf('oreAt(') < 0 &&
  String(P.oreBlockForPosition).indexOf('resourceProfile(') < 0 &&
  typeof P.oreBlockForPosition(1, 'lush', 0, 20, 0, positionNoise) === 'number' &&
  P.oreForPosition(2, 'volcanic', 12, 12, -7, v2HashNoise).blockId >= 0);

// 与等量原始hash工作比较热API开销；取五轮最小值降低CI调度噪声。
function benchMin(fn) {
  let best = Infinity;
  for (let round = 0; round < 5; round++) {
    const start = process.hrtime.bigint();
    let sink = 0;
    for (let i = 0; i < 100000; i++) sink ^= fn(i);
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    if (elapsed < best) best = elapsed;
    if (sink === 0x7fffffff) console.log('unreachable sink', sink);
  }
  return best;
}
for (let warm = 0; warm < 20000; warm++)
  P.oreBlockForPosition(2, 'arid', warm & 1023, warm % 63, -(warm & 2047), positionNoise);
const terrainChannel = positionNoise.channel(V.Noise.SALT.TERRAIN3D, 3);
const baselineV1 = benchMin(i => {
  const x = i & 1023, y = i % 63, z = -(i & 2047);
  // 一次连续密度采样只是实际列生成成本的保守下界；真实生成还包含插值与洞穴通道。
  const density = terrainChannel.at3(x * 0.02, y * 0.03, z * 0.02);
  const r = positionNoise.hash3(i & 1023, y, -(i & 2047));
  return ((y < 50 && r < 0.007) ? 8 : ((y < 34 && r > 0.994) ? 9 : 0)) ^ ((density * 31) | 0);
});
const hotV1 = benchMin(i => {
  const x = i & 1023, y = i % 63, z = -(i & 2047);
  const density = terrainChannel.at3(x * 0.02, y * 0.03, z * 0.02);
  return P.oreBlockForPosition(1, 'lush', x, y, z, positionNoise) ^ ((density * 31) | 0);
});
const baselineV2 = benchMin(i => {
  const x = i & 1023, y = i % 63, z = -(i & 2047);
  const density = terrainChannel.at3(x * 0.02, y * 0.03, z * 0.02);
  return ((positionNoise.hash3(x + 1, y + 2, z + 3) * 31) | 0) ^
    ((positionNoise.hash3(x + 4, y + 5, z + 6) * 31) | 0) ^
    ((positionNoise.hash3(x + 7, y + 8, z + 9) * 31) | 0) ^ ((density * 31) | 0);
});
const hotV2 = benchMin(i => {
  const x = i & 1023, y = i % 63, z = -(i & 2047);
  const density = terrainChannel.at3(x * 0.02, y * 0.03, z * 0.02);
  return P.oreBlockForPosition(2, 'arid', x, y, z, positionNoise) ^ ((density * 31) | 0);
});
check('numeric矿物热路径相对等量hash基准<=1.6x',
  hotV1 <= baselineV1 * 1.6 && hotV2 <= baselineV2 * 1.6,
  'v1 ' + hotV1.toFixed(1) + '/' + baselineV1.toFixed(1) + 'ms, v2 ' + hotV2.toFixed(1) + '/' + baselineV2.toFixed(1) + 'ms');

console.log('环境危害安全配置');
const expectedHazards = {
  lush: 'none', arid: 'heat', frozen: 'cold', toxic: 'toxic',
  volcanic: 'ash', oceanic: 'pressure', station: 'none'
};
for (const typeKey of Object.keys(expectedHazards)) {
  const h = P.hazard(typeKey);
  const finite = ['accumulation', 'recovery', 'threshold', 'interval', 'damage', 'foodDrain']
    .every(key => typeof h[key] === 'number' && Number.isFinite(h[key]) && h[key] >= 0);
  const activeOK = h.key === 'none'
    ? h.accumulation === 0 && h.damage === 0 && h.recovery === 12
    : h.accumulation > 0 && h.damage > 0 && h.interval > 0;
  check(typeKey + '危害字段匹配稳定Environment契约', h.key === expectedHazards[typeKey] &&
    h.damageCause === h.key && finite && h.threshold === 90 && h.interval === 2 && activeOK);
}
const badHazard = P.hazard('__corrupt__');
check('未知/损坏危害类型安全回退无伤害', badHazard.key === 'none' &&
  badHazard.damageCause === 'none' && badHazard.damage === 0 && badHazard.accumulation === 0);
const mutableHazard = P.hazard('toxic');
mutableHazard.damage = 999;
check('hazard/resourceProfile返回副本而非可污染全局配置', P.hazard('toxic').damage === 1 &&
  P.resourceProfile('arid').exclusive !== P.resourceProfile('arid').exclusive);

let noGlobalRandom = true;
const oldRandom = Math.random;
try {
  Math.random = function () { throw new Error('PlanetRules不得依赖Math.random'); };
  const climate = continuityClimate(12, -34);
  P.biomeFor(2, 'toxic', B.PLAINS, climate, 12, -34, null);
  P.biomeFor(1, 'arid', B.PLAINS, null, 12, -34, legacyNoise);
  P.oreAt(2, 'volcanic', 12, 0.5, 0.5, 0.5);
  P.hazard('frozen');
  P.fauna('toxic');
  P.faunaSpawnPlan('arid', true, 2);
  P.faunaCatalog();
} catch (e) { noGlobalRandom = false; }
finally { Math.random = oldRandom; }
check('PlanetRules全部路径不依赖Math.random', noGlobalRandom);

// ---------- 7.1 行星生物表 ----------
const LUSH_10 = ['sheep', 'pig', 'chicken', 'rabbit', 'cat', 'zombie', 'archer', 'boomer', 'wolf', 'villager'];
function typeSet(list) {
  const s = {};
  for (let i = 0; i < list.length; i++) s[list[i]] = true;
  return s;
}
const lushTypes = P.faunaTypes('lush');
check('lush 含现有 10 种', LUSH_10.every(t => lushTypes.indexOf(t) >= 0) && lushTypes.length === 10);
check('station 生成表为空', P.fauna('station').length === 0 && P.faunaSpawnPlan('station', true, 2).length === 0);
check('未知类型回退 lush', P.faunaTypes('__nope__').join(',') === lushTypes.join(','));
check('fauna 返回副本', (function () {
  const a = P.fauna('toxic');
  a.push({ type: 'zombie' });
  return P.faunaTypes('toxic').indexOf('zombie') < 0;
})());

const toxicNight = P.faunaSpawnPlan('toxic', true, 2).map(e => e.type);
const toxicDay = P.faunaSpawnPlan('toxic', false, 2).map(e => e.type);
check('toxic 夜间不含 lush 僵尸组', toxicNight.indexOf('zombie') < 0 &&
  toxicNight.indexOf('archer') < 0 && toxicNight.indexOf('boomer') < 0);
check('toxic 夜间含孢子兽与酸液虫', toxicNight.indexOf('spore_beast') >= 0 &&
  toxicNight.indexOf('acid_mite') >= 0);
check('toxic 白昼不刷敌对专属种', toxicDay.indexOf('spore_beast') < 0 && toxicDay.indexOf('acid_mite') < 0);

const exclusive = {
  arid: ['sand_stalker', 'dune_scorpion'],
  frozen: ['frost_wolf', 'yeti'],
  volcanic: ['magma_crawler', 'ash_mite'],
  oceanic: ['glow_jelly', 'drowned'],
  nordic: ['fjord_wolf']
};
let exclusiveOk = true;
for (const key in exclusive) {
  const types = typeSet(P.faunaTypes(key));
  for (let i = 0; i < exclusive[key].length; i++)
    if (!types[exclusive[key][i]]) exclusiveOk = false;
  if (types.zombie) exclusiveOk = false;
}
check('非 lush 行星含专属种且不含僵尸', exclusiveOk);

const planets = ['lush', 'arid', 'frozen', 'toxic', 'volcanic', 'oceanic', 'nordic', 'station'];
let planSubset = true;
for (let i = 0; i < planets.length; i++) {
  const allowed = typeSet(P.faunaTypes(planets[i]));
  const plan = P.faunaSpawnPlan(planets[i], true, 2);
  for (let j = 0; j < plan.length; j++)
    if (!allowed[plan[j].type]) planSubset = false;
}
check('faunaSpawnPlan 不得请求表外种类', planSubset);
check('和平难度不刷敌对与狼族', P.faunaSpawnPlan('lush', true, 0).every(e =>
  e.role === 'wander' && !e.hostile));
check('lush 白昼计划含被动与狼、不含夜间敌对', (function () {
  const day = P.faunaSpawnPlan('lush', false, 2).map(e => e.type);
  return day.indexOf('sheep') >= 0 && day.indexOf('wolf') >= 0 &&
    day.indexOf('zombie') < 0 && day.indexOf('villager') < 0;
})());

const catalog = P.faunaCatalog();
const catalogTypes = catalog.map(e => e.type);
check('图鉴目录覆盖 lush 10 种与全部专属种', LUSH_10.every(t => catalogTypes.indexOf(t) >= 0) &&
  ['sand_stalker', 'dune_scorpion', 'frost_wolf', 'yeti', 'spore_beast', 'acid_mite',
    'magma_crawler', 'ash_mite', 'glow_jelly', 'drowned', 'fjord_wolf']
    .every(t => catalogTypes.indexOf(t) >= 0));
check('图鉴目录无重复且不含 station 空槽', catalogTypes.length === new Set(catalogTypes).size);

check('faunaAllows 门控', P.faunaAllows('toxic', 'spore_beast') &&
  !P.faunaAllows('toxic', 'zombie') && P.faunaAllows('lush', 'zombie') &&
  !P.faunaAllows('station', 'sheep'));

if (failed) {
  console.error('\nPLANET-RULES-FAIL: ' + failed + ' 项失败');
  process.exit(1);
}
console.log('\nPLANET-RULES-PASS');
