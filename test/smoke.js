// 无浏览器冒烟测试：node test/smoke.js
// 验证：64位种子、Perlin 噪声、样条塑造、3D 密度场地形生成、确定性、
//       群系多样性与特征方块、修改还原、存档序列化往返（含堆叠/床/天气字段）、合成配方匹配、光照
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
function load(rel) {
  var code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

var sandbox = {
  window: {},
  console: console,
  Math: Math,
  BigInt: BigInt,
  Uint8Array: Uint8Array,
  Uint32Array: Uint32Array,
  Int16Array: Int16Array,
  Float32Array: Float32Array,
  THREE: {
    Vector3: function (x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; },
    Group: function () { this.children = []; this.parent = null; }
  }
};
sandbox.THREE.Group.prototype.add = function (o) { this.children.push(o); o.parent = this; };
sandbox.THREE.Group.prototype.remove = function (o) {
  var i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1);
  if (o) o.parent = null;
};
sandbox.window = sandbox;

// localStorage mock（供 systems/save.js 使用）
var _store = {};
sandbox.localStorage = {
  setItem: function (k, v) { _store[k] = String(v); },
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null; },
  removeItem: function (k) { delete _store[k]; }
};
vm.createContext(sandbox);

var failed = 0;
function check(name, cond) {
  if (cond) console.log('  ok  ' + name);
  else { console.log('  FAIL ' + name); failed++; }
}

load('js/config.js');
load('js/world/seed.js');
load('js/world/universe.js');
load('js/world/galaxy.js');
load('js/systems/atmosphere_profiles.js');
load('js/world/noise.js');
load('js/world/biomes.js');
load('js/world/planet_rules.js');
load('js/world/shaper.js');
load('js/world/gen_core.js');
load('js/blocks.js');
load('js/systems/discovery.js');
load('js/crafting.js');
load('js/world/world.js');
load('js/world/infinite.js');
load('js/systems/save.js');
load('js/systems/furnace.js');
load('js/systems/settings.js');
load('js/ui/hud.js');

var V = sandbox.window.Voxel;
var W = V.Config.WORLD_W, H = V.Config.WORLD_H, D = V.Config.WORLD_D;

console.log('种子工具测试');
var SU = V.SeedUtil;
check('数字种子解析', SU.toString(SU.parse('12345')) === '12345');
check('负数种子解析', SU.toString(SU.parse('-12345')) === '-12345');
check('long 最小值', SU.toString(SU.parse('-9223372036854775808')) === '-9223372036854775808');
check('long 最大值', SU.toString(SU.parse('9223372036854775807')) === '9223372036854775807');
// 超出 long 范围：按 MC 规则退化为文本哈希（Java String.hashCode）
(function () {
  var s = '9223372036854775808';
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  var expected = BigInt.asIntN(32, BigInt(h)).toString(); // 带符号十进制（toString 规范）
  check('超范围数字退化为文本哈希', SU.toString(SU.parse(s)) === expected);
})();
check('文本种子确定性', SU.toString(SU.parse('herobrine')) === SU.toString(SU.parse(' herobrine '.trim())));
check('文本种子=Java hashCode 符号扩展', (function () {
  var b = SU.toBigInt(SU.parse('abc'));
  var jh = 96354; // Java: "abc".hashCode() == 96354
  return b === BigInt.asUintN(64, BigInt.asIntN(32, BigInt(jh)));
})());
check('空输入产生随机种子', typeof SU.toString(SU.parse(null)) === 'string');
check('derive32 确定性', SU.derive32(12345n, 1) === SU.derive32(12345n, 1));
check('不同盐值流互异', SU.derive32(12345n, 1) !== SU.derive32(12345n, 2));
check('不同种子流互异', SU.derive32(1n, 1) !== SU.derive32(2n, 1));

console.log('星系生成与航行规则');
var GA = V.Galaxy;
var galA = GA.create('star-ocean-42');
var galB = GA.create('star-ocean-42');
var galC = GA.create('star-ocean-43');
check('同星系种子目录完全确定', JSON.stringify(galA.catalog) === JSON.stringify(galB.catalog));
check('不同星系种子目录不同', JSON.stringify(galA.catalog) !== JSON.stringify(galC.catalog));
check('目录含 6 颗行星和 1 座空间站', galA.catalog.filter(function (w) { return w.kind === 'planet'; }).length === 6 &&
  galA.catalog.filter(function (w) { return w.kind === 'station'; }).length === 1);
check('每个天体的独立种子唯一', new Set(galA.catalog.map(function (w) { return w.seed; })).size === 7);
check('首颗行星适合开局', galA.catalog[0].typeKey === 'lush');
check('单星系完整覆盖六类行星', new Set(galA.catalog.filter(function (w) { return w.kind === 'planet'; }).map(function (w) { return w.typeKey; })).size === 6);
var gatesA = GA.portalsFor(galA, galA.catalog[0]);
check('行星稳定生成4扇唯一双向传送门', gatesA.length === 4 &&
  new Set(gatesA.map(function (gate) { return gate.destinationId; })).size === 4 &&
  gatesA.every(function (gate) { return !!gate.pairId && !!gate.destinationGateId; }) &&
  JSON.stringify(gatesA) === JSON.stringify(GA.portalsFor(galA, galA.catalog[0])));
check('行星恰有一扇门通往空间站', gatesA.filter(function (p) { return p.destinationId === 'station-0'; }).length === 1);
check('跃迁成本有界且随距离计算', GA.fuelCost(galA.catalog[0], galA.catalog[5]) >= 8 &&
  GA.fuelCost(galA.catalog[0], galA.catalog[5]) <= 42);
var hydrated = GA.hydrate({ rootSeed: galA.rootSeed, currentId: 'planet-2', discovered: { 'planet-2': true }, ship: { fuel: 27, maxFuel: 100 }, worlds: { 'planet-0': { edits: { '1,2,3': 4 } } } }, galA.rootSeed);
check('星系状态可恢复', hydrated.currentId === 'planet-2' && hydrated.ship.fuel === 27 &&
  hydrated.ship.engine === galA.ship.engine &&
  hydrated.worlds['planet-0'].edits['1,2,3'] === 4);
var nonObjectShip = GA.hydrate({ rootSeed: galA.rootSeed, ship: '损坏字段' }, galA.rootSeed);
check('非对象飞船存档安全回退默认值', nonObjectShip.ship.engine === galA.ship.engine &&
  nonObjectShip.ship.fuel === galA.ship.fuel && nonObjectShip.ship.maxFuel === galA.ship.maxFuel);
var invalidShip = GA.hydrate({
  rootSeed: galA.rootSeed,
  ship: { engine: '   ', fuel: NaN, maxFuel: Infinity }
}, galA.rootSeed);
check('非有限飞船数值与空引擎名不泄漏', invalidShip.ship.engine === galA.ship.engine &&
  invalidShip.ship.fuel === galA.ship.fuel && invalidShip.ship.maxFuel === galA.ship.maxFuel);
var clampedShip = GA.hydrate({
  rootSeed: galA.rootSeed,
  ship: { engine: '  试验引擎  ', fuel: 99.8, maxFuel: 40.9 }
}, galA.rootSeed);
check('飞船字段独立合并并保持 fuel/maxFuel 关系', clampedShip.ship.engine === '试验引擎' &&
  clampedShip.ship.fuel === 40 && clampedShip.ship.maxFuel === 40);
var longEngine = new Array(81).join('X');
var boundedShip = GA.hydrate({ rootSeed: galA.rootSeed, ship: { engine: longEngine } }, galA.rootSeed);
check('引擎显示名有合理长度上限', boundedShip.ship.engine.length === 64);
var invalidCollections = GA.hydrate({
  rootSeed: galA.rootSeed,
  discovered: ['planet-4'],
  worlds: '损坏世界快照'
}, galA.rootSeed);
check('非对象 discovered/worlds 安全回退', invalidCollections.discovered['planet-0'] === true &&
  Object.keys(invalidCollections.worlds).length === 0);

console.log('主动扫描、发现档案与探索目标');
(function () {
  var D = V.Discovery;
  var catalog = galA.catalog;
  var p0 = catalog[0], p1 = catalog[1], p2 = catalog[2];

  function entry(worldId, kind, key, pos) {
    return { worldId: worldId, kind: kind, key: key, pos: pos.slice() };
  }
  function bucket() { return Object.create(null); }
  function rawWorld() {
    return { survey: bucket(), biomes: bucket(), resources: bucket(), fauna: bucket(), landmarks: bucket() };
  }
  function hasReward(result, id) {
    return result.objectiveRewards.some(function (reward) { return reward.id === id; });
  }

  var blank = D.empty();
  check('空发现档案使用 v1/零积分/无原型安全映射', blank.v === 1 && blank.points === 0 &&
    Object.getPrototypeOf(blank.worlds) === null && Object.getPrototypeOf(blank.claimed) === null &&
    Object.keys(blank.worlds).length === 0);
  check('旧 v5 缺失 discovery 时迁移为空，不把 visited 冒充 scanned',
    D.summary(D.hydrate(null, catalog), catalog).entries === 0 &&
    D.summary(D.hydrate({ points: 99, worlds: {} }, catalog), catalog).entries === 0 &&
    D.objective(blank, p0, catalog).id === 'survey:' + p0.id);

  // 测试不可信存档：大量未知键、原型键、非白名单类型、坏坐标与伪 plain object
  // 都不能进入标准化结果。hydrate 只读 catalog/注册表中已知键。
  var hugeWorlds = bucket();
  for (var junk = 0; junk < 5000; junk++) hugeWorlds['unknown-' + junk] = { junk: true };
  hugeWorlds.__proto__ = { polluted: true };
  var rw = rawWorld();
  rw.survey.world = entry(p0.id, 'survey', 'world', [20000000, -20000000, 1.5]);
  rw.biomes['0'] = entry(p0.id, 'biome', '0', [1, 2, 3]);
  rw.biomes[String(V.Biomes.count)] = entry(p0.id, 'biome', String(V.Biomes.count), [1, 2, 3]);
  rw.biomes.__proto__ = entry(p0.id, 'biome', '__proto__', [1, 2, 3]);
  rw.resources['8'] = entry(p0.id, 'resource', '8', [4, 5, 6]);
  rw.resources['1'] = entry(p0.id, 'resource', '1', [4, 5, 6]);
  rw.resources['9'] = Object.create({ worldId: p0.id, kind: 'resource', key: '9', pos: [4, 5, 6] });
  rw.fauna.chicken = entry(p0.id, 'fauna', 'chicken', [7, 8, 9]);
  rw.fauna.dragon = entry(p0.id, 'fauna', 'dragon', [7, 8, 9]);
  rw.landmarks.portal = entry(p0.id, 'landmark', 'portal', [10, 11, 12]);
  rw.landmarks.monolith = entry(p0.id, 'landmark', 'monolith', [10, 11, 12]);
  rw.landmarks.ship = entry(p0.id, 'landmark', 'ship', [NaN, 0, 0]);
  for (var bad = 0; bad < 5000; bad++) rw.resources['junk-' + bad] = entry(p0.id, 'resource', '8', [0, 0, 0]);
  hugeWorlds[p0.id] = rw;
  var rawClaimed = bucket();
  rawClaimed['survey:' + p0.id] = true;
  rawClaimed['biomes:3'] = true; // 只有 1 种群系，不得伪造领奖。
  rawClaimed.__proto__ = true;
  for (var cj = 0; cj < 5000; cj++) rawClaimed['junk-' + cj] = true;
  var clean = D.hydrate({ v: 1, points: '999', worlds: hugeWorlds, claimed: rawClaimed }, catalog);
  var cleanWorld = D.worldSummary(clean, p0.id);
  check('巨型/未知/原型键被忽略，结果仅保留五条白名单档案',
    Object.keys(clean.worlds).length === 1 && cleanWorld.total === 5 && cleanWorld.counts.survey === 1 &&
    cleanWorld.counts.biomes === 1 && cleanWorld.counts.resources === 1 && cleanWorld.counts.fauna === 1 &&
    cleanWorld.counts.landmarks === 1 && !Object.prototype.polluted);
  check('每层发现映射均无原型，且不信任字符串 points/未完成 claimed',
    Object.getPrototypeOf(clean.worlds) === null && Object.getPrototypeOf(clean.worlds[p0.id].survey) === null &&
    Object.getPrototypeOf(clean.worlds[p0.id].resources) === null && clean.points === 0 &&
    clean.claimed['survey:' + p0.id] === true && !clean.claimed['biomes:3']);
  check('有限坐标被夹紧到 ±1e7，NaN 条目被拒绝', cleanWorld.survey.pos[0] === 10000000 &&
    cleanWorld.survey.pos[1] === -10000000 && cleanWorld.counts.landmarks === 1);
  var inheritedRaw = Object.create({ v: 1, points: 77, worlds: hugeWorlds, claimed: rawClaimed });
  check('带自定义原型的伪 plain object 整体拒绝', D.summary(D.hydrate(inheritedRaw, catalog), catalog).entries === 0);
  check('发现标签只由受信注册表派生', D.label(cleanWorld.survey) === '天体测绘' &&
    D.label(cleanWorld.biomes[0]) === V.Biomes.name(0) && D.label(cleanWorld.resources[0]) === V.Blocks.name(8) &&
    D.label(cleanWorld.fauna[0]) === '鸡' && D.label(cleanWorld.landmarks[0]) === '星际传送门' &&
    D.label({ kind: 'fauna', key: 'dragon' }) === '未知档案');

  // copy-on-write + 每世界每分类唯一：重复扫描不覆盖首次位置，不给积分/燃料。
  var source = D.empty();
  var sourceBytes = JSON.stringify(source);
  var survey = D.record(source, { worldId: p0.id, kind: 'survey', pos: [1.25, 64, -2.5] }, catalog);
  check('首次天体测绘产生档案 +2 与阶段 +10，且返回燃料奖励数值',
    survey.added === 1 && survey.entries.length === 1 && survey.pointsAwarded === 12 && survey.state.points === 12 &&
    hasReward(survey, 'survey:' + p0.id) && survey.objectiveRewards[0].fuel === 5 && survey.fuelAwarded === 5 &&
    survey.objectiveBefore.id === 'survey:' + p0.id && survey.objectiveAfter.id === 'biomes:3');
  check('record 为 copy-on-write，输入对象字节不变', JSON.stringify(source) === sourceBytes &&
    source !== survey.state && Object.keys(source.worlds).length === 0);
  var repeated = D.record(survey.state, { worldId: p0.id, kind: 'survey', pos: [999, 999, 999] }, catalog);
  check('重复事件 added/reward 均为 0，且保留首次发现位置', repeated.added === 0 &&
    repeated.pointsAwarded === 0 && repeated.objectiveRewards.length === 0 && repeated.fuelAwarded === 0 &&
    repeated.state.points === survey.state.points && D.worldSummary(repeated.state, p0.id).survey.pos[0] === 1.25);

  var state = survey.state;
  var biomeResult;
  [0, 1, 2].forEach(function (id) {
    biomeResult = D.record(state, { worldId: p0.id, kind: 'biome', key: id, pos: [id, 60, id] }, catalog);
    state = biomeResult.state;
  });
  check('第 3 种全局唯一群系首次完成目标且只领奖一次', biomeResult.added === 1 &&
    biomeResult.pointsAwarded === 12 && hasReward(biomeResult, 'biomes:3') &&
    biomeResult.objectiveBefore.id === 'biomes:3' && biomeResult.objectiveAfter.id === 'resources:3');
  var biomeRepeat = D.record(state, { worldId: p1.id, kind: 'biome', key: 2, pos: [5, 5, 5] }, catalog);
  check('同类群系可按 world 隔离建档，但全局目标不重复领奖', biomeRepeat.added === 1 &&
    biomeRepeat.pointsAwarded === 2 && biomeRepeat.objectiveRewards.length === 0 &&
    D.worldSummary(biomeRepeat.state, p1.id).counts.biomes === 1);
  state = biomeRepeat.state;

  var resourceResult;
  [8, 9, 14].forEach(function (id) {
    resourceResult = D.record(state, { worldId: p0.id, kind: 'resource', key: id, pos: [id, 22, 0] }, catalog);
    state = resourceResult.state;
  });
  check('资源仅白名单 ID 可入档，第 3 种解锁单次目标奖励', resourceResult.added === 1 &&
    resourceResult.pointsAwarded === 12 && hasReward(resourceResult, 'resources:3') &&
    D.record(state, { worldId: p0.id, kind: 'resource', key: 1, pos: [0, 0, 0] }, catalog).added === 0);

  var faunaA = D.record(state, { worldId: p0.id, kind: 'fauna', key: 'sheep', pos: [3, 4, 5] }, catalog);
  var faunaB = D.record(faunaA.state, { worldId: p0.id, kind: 'fauna', key: 'pig', pos: [6, 7, 8] }, catalog);
  state = faunaB.state;
  check('固定物种注册表中第 2 种生命体解锁单次目标奖励', faunaB.added === 1 &&
    faunaB.pointsAwarded === 12 && hasReward(faunaB, 'fauna:2') &&
    D.record(state, { worldId: p0.id, kind: 'fauna', key: 'dragon', pos: [0, 0, 0] }, catalog).added === 0);

  var surveyP1 = D.record(state, { worldId: p1.id, kind: 'survey', pos: [10, 20, 30] }, catalog);
  var surveyP2 = D.record(surveyP1.state, { worldId: p2.id, kind: 'survey', pos: [40, 50, 60] }, catalog);
  state = surveyP2.state;
  check('每天体测绘各有一次阶段奖，第 3 个天体额外完成星系目标',
    hasReward(surveyP1, 'survey:' + p1.id) && hasReward(surveyP2, 'survey:' + p2.id) &&
    hasReward(surveyP2, 'survey-worlds:3') && surveyP2.objectiveAfter.complete === true &&
    surveyP2.objectiveAfter.id === 'complete');
  var summaries = D.summary(state, catalog);
  check('跨 world 档案隔离，全局 summary 按唯一 key 统计',
    D.worldSummary(state, p0.id).counts.biomes === 3 && D.worldSummary(state, p1.id).counts.biomes === 1 &&
    D.worldSummary(state, p2.id).counts.biomes === 0 && summaries.surveyedWorlds === 3 &&
    summaries.biomes === 3 && summaries.resources === 3 && summaries.fauna === 2);

  var landmark = D.record(state, {
    worldId: p0.id, kind: 'landmark', key: 'ship', pos: [20000000, -20000000, 0.5]
  }, catalog);
  check('目标全完成后新档案仅 +2，位置夹紧且不重复领阶段奖', landmark.added === 1 &&
    landmark.pointsAwarded === 2 && landmark.objectiveRewards.length === 0 &&
    landmark.entries[0].pos[0] === 10000000 && landmark.entries[0].pos[1] === -10000000);
  check('非有限位置/未知 world/坏 event 不计数不奖励',
    D.record(landmark.state, { worldId: p0.id, kind: 'landmark', key: 'portal', pos: [NaN, 0, 0] }, catalog).added === 0 &&
    D.record(landmark.state, { worldId: 'unknown', kind: 'survey', pos: [0, 0, 0] }, catalog).added === 0 &&
    D.record(landmark.state, [], catalog).pointsAwarded === 0);

  var serialized = JSON.stringify(landmark.state);
  var roundTrip = D.hydrate(JSON.parse(serialized), catalog);
  var roundSummary = D.summary(roundTrip, catalog);
  check('发现档案 JSON 序列化往返保留积分、位置、隔离记录与 claimed',
    roundTrip.points === landmark.state.points && roundSummary.entries === D.summary(landmark.state, catalog).entries &&
    D.worldSummary(roundTrip, p0.id).landmarks[0].pos[0] === 10000000 &&
    roundTrip.claimed['survey:' + p0.id] === true && roundTrip.claimed['biomes:3'] === true &&
    roundTrip.claimed['resources:3'] === true && roundTrip.claimed['fauna:2'] === true &&
    roundTrip.claimed['survey-worlds:3'] === true);

  // 填满所有白名单条目，验证理论上限与输出体积。每世界最多
  // 1 survey + 18 biomes + 11 resources + 6 fauna + 3 landmarks = 39 条。
  var fullRaw = { v: 1, points: 1234, worlds: bucket(), claimed: bucket() };
  var resources = [8, 9, 14, 25, 27, 28, 29, 30, 31, 32, 33];
  var fauna = ['sheep', 'pig', 'chicken', 'rabbit', 'cat', 'zombie'];
  var landmarks = ['ship', 'station-terminal', 'portal'];
  for (var wi = 0; wi < catalog.length; wi++) {
    var wid = catalog[wi].id;
    var fw = rawWorld();
    fw.survey.world = entry(wid, 'survey', 'world', [wi, 0, 0]);
    for (var bi = 0; bi < V.Biomes.count; bi++) fw.biomes[String(bi)] = entry(wid, 'biome', String(bi), [bi, 0, 0]);
    for (var ri = 0; ri < resources.length; ri++) fw.resources[String(resources[ri])] = entry(wid, 'resource', String(resources[ri]), [ri, 0, 0]);
    for (var fi = 0; fi < fauna.length; fi++) fw.fauna[fauna[fi]] = entry(wid, 'fauna', fauna[fi], [fi, 0, 0]);
    for (var li = 0; li < landmarks.length; li++) fw.landmarks[landmarks[li]] = entry(wid, 'landmark', landmarks[li], [li, 0, 0]);
    for (var extraKey = 0; extraKey < 1000; extraKey++) fw.landmarks['unknown-' + extraKey] = entry(wid, 'landmark', 'portal', [0, 0, 0]);
    fullRaw.worlds[wid] = fw;
    fullRaw.claimed['survey:' + wid] = true;
  }
  var GLOBAL_DISCOVERY_CLAIMS = ['biomes:3', 'resources:3', 'fauna:2', 'survey-worlds:3'];
  for (var gi = 0; gi < GLOBAL_DISCOVERY_CLAIMS.length; gi++) fullRaw.claimed[GLOBAL_DISCOVERY_CLAIMS[gi]] = true;
  for (var gunk = 0; gunk < 5000; gunk++) fullRaw.claimed['unknown-' + gunk] = true;
  var full = D.hydrate(fullRaw, catalog);
  var fullSummary = D.summary(full, catalog);
  check('全白名单填满时条目/领奖数仍严格有界', fullSummary.entries === catalog.length *
    (1 + V.Biomes.count + resources.length + fauna.length + landmarks.length) &&
    Object.keys(full.claimed).length === catalog.length + 4 && Object.keys(full.worlds).length === catalog.length);
  check('巨型输入净化后 JSON 体积受控且全部映射无原型', JSON.stringify(full).length < 100000 &&
    Object.getPrototypeOf(full.worlds) === null && Object.getPrototypeOf(full.claimed) === null &&
    catalog.every(function (world) { return Object.getPrototypeOf(full.worlds[world.id].fauna) === null; }));
  var hugeCatalog = [];
  for (var hci = 0; hci < 400; hci++) hugeCatalog.push({ id: 'world-' + hci });
  check('巨型 catalog 同样受硬上限约束', D.summary(D.empty(), hugeCatalog).totalWorlds === 64);
})();

console.log('七类大气与天体描述');
var AP = V.AtmosphereProfiles;
var atmosphereKeys = AP.keys();
var expectedAtmosphereKeys = ['lush', 'arid', 'frozen', 'toxic', 'volcanic', 'oceanic', 'station'];
var expectedSignatures = {
  lush: 'pollen', arid: 'dust', frozen: 'aurora', toxic: 'spores',
  volcanic: 'ash', oceanic: 'sea-mist', station: 'station-stars'
};
var expectedTopology = {
  lush: [1, 2], arid: [2, 2], frozen: [1, 3], toxic: [1, 1],
  volcanic: [2, 1], oceanic: [1, 2], station: [0, 0]
};

function atmosphereColor(v) {
  return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0 && v <= 0xffffff;
}

function atmospherePair(v) { return !!v && atmosphereColor(v.top) && atmosphereColor(v.horizon); }

function atmosphereBody(v, role) {
  return !!v && v.role === role && typeof v.style === 'string' && !!v.style &&
    typeof v.size === 'number' && isFinite(v.size) && v.size >= 4 && v.size <= 128 &&
    atmosphereColor(v.color) && typeof v.phase === 'number' && isFinite(v.phase) && v.phase >= 0 && v.phase < 1 &&
    typeof v.inclination === 'number' && isFinite(v.inclination) && Math.abs(v.inclination) <= 1.2 &&
    Number.isInteger(v.cyclesPerDay) && v.cyclesPerDay > 0;
}

function atmosphereProfileValid(p) {
  if (!p || p.role !== 'sky-dome' || typeof p.typeKey !== 'string' || typeof p.seed !== 'string') return false;
  if (!atmospherePair(p.day) || !atmospherePair(p.dusk) || !atmospherePair(p.night) ||
    !atmosphereColor(p.tintDay) || !atmosphereColor(p.tintNight)) return false;
  if (![p.ambientFloor, p.exponent, p.weatherMix].every(function (n) { return typeof n === 'number' && isFinite(n); }) ||
    p.ambientFloor < 0 || p.ambientFloor > 1 || p.exponent <= 0 || p.weatherMix < 0 || p.weatherMix > 1) return false;
  var w = p.weather;
  if (!w || !atmosphereColor(w.topDay) || !atmosphereColor(w.horizonDay) ||
    !atmosphereColor(w.topNight) || !atmosphereColor(w.horizonNight) || !atmosphereColor(w.tint) ||
    !atmosphereColor(w.cloud) || !atmosphereColor(w.precipitationColor) || typeof w.precipitation !== 'string') return false;
  if (!p.stars || p.stars.role !== 'stars' || !Number.isInteger(p.stars.count) || p.stars.count < 64 ||
    p.stars.count > 768 || !atmosphereColor(p.stars.color) || !atmosphereColor(p.stars.secondaryColor)) return false;
  if (!p.nebula || !atmosphereColor(p.nebula.colorA) || !atmosphereColor(p.nebula.colorB) ||
    typeof p.nebula.opacity !== 'number' || !isFinite(p.nebula.opacity) || p.nebula.opacity <= 0 || p.nebula.opacity > 1 ||
    typeof p.nebula.rotation !== 'number' || !isFinite(p.nebula.rotation) || p.nebula.rotation < 0 ||
    p.nebula.rotation >= Math.PI * 2 || !Number.isInteger(p.nebula.seed) || p.nebula.seed < 0) return false;
  if (!Array.isArray(p.suns) || !p.suns.every(function (b) { return atmosphereBody(b, 'sun'); }) ||
    !Array.isArray(p.moons) || !p.moons.every(function (b) { return atmosphereBody(b, 'moon'); })) return false;
  var l = p.landmark, ring = l && l.ring;
  if (!l || l.role !== 'ringed-landmark' || typeof l.style !== 'string' || !l.style ||
    typeof l.size !== 'number' || !isFinite(l.size) || l.size < 8 || l.size > 128 || !atmosphereColor(l.color) ||
    typeof l.phase !== 'number' || !isFinite(l.phase) || l.phase < 0 || l.phase >= 1 ||
    typeof l.inclination !== 'number' || !isFinite(l.inclination) || Math.abs(l.inclination) > 1.2 ||
    !ring || !atmosphereColor(ring.color) || typeof ring.inner !== 'number' || !isFinite(ring.inner) ||
    typeof ring.outer !== 'number' || !isFinite(ring.outer) || ring.inner <= 0 || ring.outer <= ring.inner ||
    typeof ring.opacity !== 'number' || !isFinite(ring.opacity) || ring.opacity <= 0 || ring.opacity > 1 ||
    typeof ring.tilt !== 'number' || !isFinite(ring.tilt) || Math.abs(ring.tilt) > 1.3) return false;
  return !!p.particles && p.particles.role === p.signatureRole && Number.isInteger(p.particles.count) &&
    p.particles.count >= 0 && atmosphereColor(p.particles.color) && Number.isInteger(p.variantHash) && p.variantHash >= 0;
}

check('大气描述键精确覆盖6行星+空间站', JSON.stringify(atmosphereKeys) === JSON.stringify(expectedAtmosphereKeys));
var atmosphereProfiles = {};
for (var api = 0; api < atmosphereKeys.length; api++) {
  var atmosphereKey = atmosphereKeys[api];
  var atmosphereWorld = {
    id: atmosphereKey === 'station' ? 'station-0' : 'planet-' + api,
    kind: atmosphereKey === 'station' ? 'station' : 'planet',
    typeKey: atmosphereKey,
    seed: 'atmosphere-seed-' + atmosphereKey
  };
  var atmosphereProfile = AP.create(atmosphereWorld);
  atmosphereProfiles[atmosphereKey] = atmosphereProfile;
  check(atmosphereKey + '大气/天体字段完整且数值有界', atmosphereProfileValid(atmosphereProfile) &&
    atmosphereProfile.typeKey === atmosphereKey && atmosphereProfile.worldId === atmosphereWorld.id &&
    atmosphereProfile.station === (atmosphereKey === 'station'));
  check(atmosphereKey + '拓扑与类型签名固定', atmosphereProfile.suns.length === expectedTopology[atmosphereKey][0] &&
    atmosphereProfile.moons.length === expectedTopology[atmosphereKey][1] &&
    atmosphereProfile.signatureRole === expectedSignatures[atmosphereKey] &&
    atmosphereProfile.particles.role === expectedSignatures[atmosphereKey]);
}

var planetAtmosphereKeys = atmosphereKeys.slice(0, 6);
check('所有行星均有星云/日月/多天体/星环', planetAtmosphereKeys.every(function (key) {
  var p = atmosphereProfiles[key];
  return p.nebula.opacity > 0 && p.suns.length >= 1 && p.moons.length >= 1 &&
    p.suns.length + p.moons.length + 1 >= 3 && p.landmark.ring.outer > p.landmark.ring.inner;
}));
check('空间站无日月且有星空/带环母星', atmosphereProfiles.station.suns.length === 0 &&
  atmosphereProfiles.station.moons.length === 0 && atmosphereProfiles.station.signatureRole === 'station-stars' &&
  atmosphereProfiles.station.landmark.style === 'station-parent-ringed');
check('六类行星的大气基色与签名均唯一',
  new Set(planetAtmosphereKeys.map(function (key) {
    var p = atmosphereProfiles[key]; return p.day.top + ':' + p.day.horizon + ':' + p.night.top;
  })).size === 6 && new Set(atmosphereKeys.map(function (key) { return atmosphereProfiles[key].signatureRole; })).size === 7);
check('类型标志特征与规格一致',
  atmosphereProfiles.frozen.signatureRole === 'aurora' &&
  atmosphereProfiles.toxic.landmark.style === 'banded-ringed' &&
  atmosphereProfiles.volcanic.moons[0].style === 'black-disc' &&
  atmosphereProfiles.oceanic.landmark.style === 'large-ringed-ocean' &&
  atmosphereProfiles.oceanic.landmark.ring.outer - atmosphereProfiles.oceanic.landmark.ring.inner > 0.8);

var deterministicAtmosphereA = AP.profileFor('arid', 'same-atmosphere-seed');
var deterministicAtmosphereB = AP.profileFor('arid', 'same-atmosphere-seed');
var variedAtmosphere = AP.profileFor('arid', 'different-atmosphere-seed');
check('同type+seed描述字节级确定', JSON.stringify(deterministicAtmosphereA) === JSON.stringify(deterministicAtmosphereB));
check('异seed改变参数签名但不改类型拓扑', deterministicAtmosphereA.variantHash !== variedAtmosphere.variantHash &&
  deterministicAtmosphereA.suns.length === variedAtmosphere.suns.length &&
  deterministicAtmosphereA.moons.length === variedAtmosphere.moons.length &&
  deterministicAtmosphereA.signatureRole === variedAtmosphere.signatureRole);
check('未知行星类型安全回退lush', AP.profileFor('unknown-type', 'fallback-seed').typeKey === 'lush');

var savedRandom = sandbox.Math.random;
var noGlobalRandomProfile = null;
try {
  sandbox.Math.random = function () { throw new Error('AtmosphereProfiles must not use global randomness'); };
  noGlobalRandomProfile = AP.create({ id: 'planet-deterministic', kind: 'planet', typeKey: 'frozen', seed: 'no-random-seed' });
} finally {
  sandbox.Math.random = savedRandom;
}
check('全局随机被禁用时仍可生成完整大气', atmosphereProfileValid(noGlobalRandomProfile) &&
  noGlobalRandomProfile.signatureRole === 'aurora');

console.log('HUD 数值防御');
var HT = V.HUD._test;
check('缺失/非有限耐久回退满值且范围夹取',
  HT.normalizeDur(undefined, 132) === 132 && HT.normalizeDur(NaN, 132) === 132 &&
  HT.normalizeDur(Infinity, 132) === 132 && HT.normalizeDur(-8, 132) === 0 &&
  HT.normalizeDur(999, 132) === 132 && HT.normalizeDur(31.6, 132) === 32);
var badDurLabel = HT.slotDescription('快捷栏第 1/9 格', 102, 1, 'bad', V.Blocks.maxDur(102));
check('损坏耐久的格子说明不输出 NaN/undefined/null',
  badDurLabel.indexOf('NaN') < 0 && badDurLabel.indexOf('undefined') < 0 &&
  badDurLabel.indexOf('null') < 0 && badDurLabel.indexOf('耐久 132/132') >= 0);
check('炉火表针对非有限值归零并夹取',
  HT.gaugePercent(undefined) === 0 && HT.gaugePercent(NaN) === 0 &&
  HT.gaugePercent(Infinity) === 0 && HT.gaugePercent(-0.5) === 0 &&
  HT.gaugePercent(1.5) === 100 && HT.gaugePercent(0.456) === 46);
(function () {
  // 模拟 v4 → 首次载入 v5：main 会把旧世界种子固化到起始行星和迁移标记。
  var legacySeed = '12345';
  var migrated = GA.create(legacySeed);
  migrated.legacyStartSeed = legacySeed;
  GA.find(migrated, 'planet-0').seed = legacySeed;
  var secondLoad = GA.hydrate(JSON.parse(JSON.stringify(migrated)), legacySeed);
  check('旧存档两跳迁移后仍使用原世界种子',
    secondLoad.legacyStartSeed === legacySeed && GA.find(secondLoad, 'planet-0').seed === legacySeed);

  // 兼容修复上线前已保存过一次的 v5：当时 catalog 有覆写种子但没有显式标记。
  var oldMigrated = GA.create(legacySeed);
  GA.find(oldMigrated, 'planet-0').seed = legacySeed;
  var recovered = GA.hydrate(JSON.parse(JSON.stringify(oldMigrated)), legacySeed);
  check('无迁移标记的既有 v5 存档可恢复旧底图',
    recovered.legacyStartSeed === legacySeed && GA.find(recovered, 'planet-0').seed === legacySeed);
})();

console.log('噪声测试');
var noise = V.Noise.create(42);
var a = noise.fbm2(10, 10, 3), b = noise.fbm2(10, 10, 3);
check('fbm2 确定性', a === b);
check('fbm2 范围 [0,1)', a >= 0 && a < 1);
check('n3 范围 [0,1)', noise.n3(3.3, 5.5, 7.7) >= 0 && noise.n3(3.3, 5.5, 7.7) < 1);
var chA = noise.channel(V.Noise.SALT.TERRAIN, 4);
check('通道输出 [-1,1]', chA.at2(12.3, 45.6) >= -1 && chA.at2(12.3, 45.6) <= 1);
check('通道确定性', chA.at2(1, 2) === chA.at2(1, 2));
check('hash2 范围', noise.hash2(3, 9) >= 0 && noise.hash2(3, 9) < 1);
check('hash3 确定性', noise.hash3(1, 2, 3) === noise.hash3(1, 2, 3));
// 文本种子必须确定性映射（Java hashCode），不能每次进程随机
var textNoiseA = V.Noise.create('ocean-spawn-7');
var textNoiseB = V.Noise.create('ocean-spawn-7');
check('文本种子噪声跨实例确定',
  textNoiseA.hash2(5, 8) === textNoiseB.hash2(5, 8) &&
  textNoiseA.channel(V.Noise.SALT.TERRAIN, 3).at2(9.9, 22.2) ===
  textNoiseB.channel(V.Noise.SALT.TERRAIN, 3).at2(9.9, 22.2));
check('toBigInt 文本种子与 parse 一致',
  V.SeedUtil.toBigInt('ocean-spawn-7') === V.SeedUtil.parse('ocean-spawn-7'));

console.log('样条塑造测试');
check('spline 控制点精确', V.Shaper.spline([[-1, -20], [1, 20]], -1) === -20 &&
  V.Shaper.spline([[-1, -20], [1, 20]], 1) === 20);
check('spline 中段单调', V.Shaper.spline([[-1, -20], [1, 20]], 0.5) > 0);

console.log('世界生成 (种子 12345)');
V.World.init(12345);
var t0 = Date.now();
while (!V.World.isReady()) V.World.generateNext(64);
console.log('  生成耗时 ' + (Date.now() - t0) + 'ms');
check('世界已就绪', V.World.isReady());
check('种子规范化为字符串', V.World.getSeed() === '12345');

var counts = {};
var water = 0, tree = 0, coal = 0, iron = 0, cave = 0;
var minH = 999, maxH = 0;
for (var x = 0; x < W; x += 4)
  for (var z = 0; z < D; z += 4) {
    for (var y = 0; y < H; y++) {
      var id = V.World.get(x, y, z);
      counts[id] = (counts[id] || 0) + 1;
      if (id === 7) water++;
      if (id === 4 || id === 20 || id === 22 || id === 33 || id === 35) tree++;
      if (id === 8) coal++;
      if (id === 9) iron++;
      if (id === 0 && y < 40 && y > 2) cave++;
    }
    var s = V.World.surfaceAt(x, z);
    if (s > 0) { if (s < minH) minH = s; if (s > maxH) maxH = s; }
  }
check('有基岩', (counts[12] || 0) > 0);
check('有石头', (counts[3] || 0) > 100);
check('有草方块', (counts[1] || 0) > 100);
check('有水面', water > 100);
check('有树木', tree > 20);
check('有煤矿', coal > 50);
check('有铁矿', iron > 20);
check('有洞穴', cave > 50);
check('高度范围合理', minH >= 2 && maxH <= H - 2);
console.log('  高度范围: ' + minH + ' ~ ' + maxH);
check('出生点在地表', V.World.surfaceAt(W >> 1, D >> 1) > 5);

console.log('无限世界区块与旧边界回归');
(function () {
  var CS = V.Config.CHUNK;
  var IT = V.World._test;
  check('无限世界测试接口齐全', !!IT && typeof IT.floorDiv === 'function' &&
    typeof IT.localCoord === 'function' && typeof IT.unloadOutside === 'function' &&
    typeof V.World.ensureChunk === 'function' && typeof V.World.isChunkLoaded === 'function' &&
    typeof V.World.streamStats === 'function');
  if (!IT || typeof V.World.ensureChunk !== 'function') return;

  // JS 的 |0 会向零截断，不能用来映射负坐标。特别覆盖两个负区块接缝。
  check('负坐标 floor chunk 映射(-1/-32/-33)',
    IT.floorDiv(-1) === -1 && IT.localCoord(-1) === CS - 1 &&
    IT.floorDiv(-32) === -1 && IT.localCoord(-32) === 0 &&
    IT.floorDiv(-33) === -2 && IT.localCoord(-33) === CS - 1 &&
    IT.floorDiv(0) === 0 && IT.localCoord(0) === 0 &&
    IT.floorDiv(32) === 1 && IT.localCoord(32) === 0);

  V.World.ensureChunk(8, 0);   // x=256..287：越过旧右边界
  V.World.ensureChunk(-1, 0);  // x=-32..-1
  V.World.ensureChunk(-2, 0);  // x=-64..-33
  check('旧 x=256 边界外区块已生成', V.World.isChunkLoaded(8, 0));
  check('负坐标区块 -1/-2 已生成', V.World.isChunkLoaded(-1, 0) && V.World.isChunkLoaded(-2, 0));

  function validSurface(x, z) {
    var y = V.World.surfaceAt(x, z);
    return y >= 2 && y < H && V.Blocks.isSolid(V.World.get(x, y, z));
  }
  function seamContinuous(a, b, z) {
    var ya = V.World.surfaceAt(a, z), yb = V.World.surfaceAt(b, z);
    // 程序化地形允许峭壁和树冠，但相邻列不应从真实地表跳到安全墙/虚空。
    return validSurface(a, z) && validSurface(b, z) && Math.abs(ya - yb) <= 20;
  }
  var seamZ = 10;
  check('越过 255→256 后仍是连续地形', seamContinuous(255, 256, seamZ) && validSurface(257, seamZ));
  check('负坐标 -1→0 接缝仍是连续地形', seamContinuous(-1, 0, seamZ));
  check('负区块 -33→-32 接缝仍是连续地形', seamContinuous(-33, -32, seamZ));

  function chunkFingerprint(cx, cz) {
    V.World.ensureChunk(cx, cz);
    var h = 2166136261 >>> 0;
    var x0 = cx * CS, z0 = cz * CS;
    for (var z = z0; z < z0 + CS; z++)
      for (var y = 0; y < H; y++)
        for (var x = x0; x < x0 + CS; x++)
          h = Math.imul((h ^ V.World.get(x, y, z)) >>> 0, 16777619) >>> 0;
    for (var z2 = z0; z2 < z0 + CS; z2++)
      for (var x2 = x0; x2 < x0 + CS; x2++)
        h = Math.imul((h ^ (V.World.biomeAt(x2, z2) + 1)) >>> 0, 16777619) >>> 0;
    return h.toString(16);
  }

  var order = [[8, 0], [-1, 0], [-2, 0]];
  var sigA = {};
  for (var oi = 0; oi < order.length; oi++)
    sigA[order[oi].join(',')] = chunkFingerprint(order[oi][0], order[oi][1]);

  // 同一种子以相反顺序请求外围区块，结果必须与请求/加载顺序无关。
  V.World.init(12345);
  while (!V.World.isReady()) V.World.generateNext(64);
  for (var ri = order.length - 1; ri >= 0; ri--) V.World.ensureChunk(order[ri][0], order[ri][1]);
  var deterministic = true;
  for (var di = 0; di < order.length; di++) {
    var dk = order[di].join(',');
    if (chunkFingerprint(order[di][0], order[di][1]) !== sigA[dk]) deterministic = false;
  }
  check('同 seed 外围区块与加载顺序无关', deterministic);

  // 火把放在两个外围区块的接缝：光必须跨 x=287/288 传播，移除后也必须跨界熄灭。
  // 使用世界顶层并先清空四格，排除天然洞穴、遮挡和其他光源造成的误判。
  V.World.ensureChunk(8, 0);
  V.World.ensureChunk(9, 0);
  var lightY = H - 1, lightZ = 10, lightRestore = [];
  for (var lightX = 286; lightX <= 289; lightX++) {
    lightRestore.push([lightX, V.World.get(lightX, lightY, lightZ)]);
    V.World.set(lightX, lightY, lightZ, 0);
  }
  V.World.set(287, lightY, lightZ, 19);
  check('区块接缝火把自身亮度=14', V.World.getBlk(287, lightY, lightZ) === 14);
  check('火把光跨 287→288 区块接缝传播', V.World.getBlk(288, lightY, lightZ) > 0);
  V.World.set(287, lightY, lightZ, 0);
  check('移除火把后跨区块邻格熄灭', V.World.getBlk(288, lightY, lightZ) === 0);
  for (var li = 0; li < lightRestore.length; li++)
    V.World.set(lightRestore[li][0], lightY, lightZ, lightRestore[li][1]);

  // legacy 256 核心与无限外围使用不同的数据/光照后端，接缝必须双向传播。
  // 核心沿用旧启动协议，必须先完成一次 initLight；外围区块则在 ensure 时已单独点亮。
  if (!V.World.lightReady()) {
    // 地形生成时已有一轮dirty；先用轻量MeshBuilder桩排空，再验证initLight会把64个
    // 核心区块全部重新标脏，因为顶点光是在建网格时烘焙的。
    var finiteForDirty = IT.finiteWorld;
    var oldMeshBuilder = V.MeshBuilder;
    var dirtyBuilds = 0;
    var fakeScene = {
      add: function (o) { o.parent = this; },
      remove: function (o) { if (o) o.parent = null; }
    };
    V.MeshBuilder = {
      build: function () { dirtyBuilds++; return {}; },
      opaqueMat: function () { return null; },
      waterMat: function () { return null; }
    };
    finiteForDirty.buildMeshes(256, fakeScene); // 排空生成期dirty
    dirtyBuilds = 0;
    V.World.initLight();
    finiteForDirty.buildMeshes(256, fakeScene);
    check('initLight 后64个核心网格全部重新dirty', dirtyBuilds === (W / CS) * (D / CS));
    V.MeshBuilder = oldMeshBuilder;
  }
  var coreRestore = [];
  for (var coreX = 254; coreX <= 257; coreX++) {
    coreRestore.push([coreX, V.World.get(coreX, lightY, lightZ)]);
    V.World.set(coreX, lightY, lightZ, 0);
  }
  V.World.set(256, lightY, lightZ, 19);
  check('外围火把光跨 256→255 进入 legacy 核心',
    V.World.getBlk(256, lightY, lightZ) === 14 && V.World.getBlk(255, lightY, lightZ) > 0);
  V.World.set(256, lightY, lightZ, 0);
  check('移除外围火把后 legacy 核心接缝熄灭', V.World.getBlk(255, lightY, lightZ) === 0);
  V.World.set(255, lightY, lightZ, 19);
  check('legacy 核心火把光跨 255→256 进入外围',
    V.World.getBlk(255, lightY, lightZ) === 14 && V.World.getBlk(256, lightY, lightZ) > 0);
  V.World.set(255, lightY, lightZ, 0);
  check('移除核心火把后外围接缝熄灭', V.World.getBlk(256, lightY, lightZ) === 0);
  for (var ci = 0; ci < coreRestore.length; ci++)
    V.World.set(coreRestore[ci][0], lightY, lightZ, coreRestore[ci][1]);

  // finite importBorder 的x/z范围必须独立：火把在重算区x负边界外一格，且中心x/z
  // 刻意取200/40（非对角）。无关set/applyEdits重算区域后，边界光不能被擦掉。
  var FW = IT.finiteWorld;
  var ibY = H - 1, ibZ = 40, ibTorchX = 184, ibProbeX = 185, ibCenterX = 200;
  var ibRestore = {};
  [ibTorchX, ibProbeX, ibCenterX].forEach(function (x) {
    ibRestore[x + ',' + ibY + ',' + ibZ] = FW.get(x, ibY, ibZ);
  });
  var ibClear = {};
  ibClear[ibTorchX + ',' + ibY + ',' + ibZ] = 0;
  ibClear[ibProbeX + ',' + ibY + ',' + ibZ] = 0;
  ibClear[ibCenterX + ',' + ibY + ',' + ibZ] = 0;
  FW.applyEdits(ibClear);
  FW.set(ibTorchX, ibY, ibZ, 19);
  check('finite非对角边界火把初始照亮重算区', FW.getBlk(ibTorchX, ibY, ibZ) === 14 &&
    FW.getBlk(ibProbeX, ibY, ibZ) === 13);
  FW.set(ibCenterX, ibY, ibZ, 0);
  check('finite非对角火把光经无关set重算后不熄', FW.getBlk(ibProbeX, ibY, ibZ) === 13);
  var ibReplay = {}; ibReplay[ibCenterX + ',' + ibY + ',' + ibZ] = 0;
  FW.applyEdits(ibReplay);
  check('finite非对角火把光经无关applyEdits后不熄', FW.getBlk(ibProbeX, ibY, ibZ) === 13);
  FW.applyEdits(ibRestore);

  // 核心右边界的真实光程控制：x243到首外围x256曼哈顿距13，应剩1级；
  // x242距离14及保守收集带边界x241/x240/x239均不得产生幽灵光，移除后也为0。
  V.World.ensureChunk(8, 3);
  var bandZ = 96, bandY = H - 1, bandProbeX = 256;
  var bandRestore = {}, bandClear = {};
  for (var bandX = 239; bandX <= 243; bandX++) {
    var bk = bandX + ',' + bandY + ',' + bandZ;
    bandRestore[bk] = V.World.get(bandX, bandY, bandZ); bandClear[bk] = 0;
  }
  var bpKey = bandProbeX + ',' + bandY + ',' + bandZ;
  bandRestore[bpKey] = V.World.get(bandProbeX, bandY, bandZ); bandClear[bpKey] = 0;
  V.World.applyEdits(bandClear);
  V.World.set(243, bandY, bandZ, 19);
  check('核心距首外围13格的火把跨缝剩1级光', V.World.getBlk(bandProbeX, bandY, bandZ) === 1);
  V.World.set(243, bandY, bandZ, 0);
  check('移除距缝13格火把后外围熄灭', V.World.getBlk(bandProbeX, bandY, bandZ) === 0);
  V.World.set(242, bandY, bandZ, 19);
  check('核心距首外围14格的火把不越过真实光程', V.World.getBlk(bandProbeX, bandY, bandZ) === 0);
  V.World.set(242, bandY, bandZ, 0);
  var bandThresholds = [241, 240, 239]; // 距核心最后格14/15/16
  var noGhost = true;
  for (var bt = 0; bt < bandThresholds.length; bt++) {
    V.World.set(bandThresholds[bt], bandY, bandZ, 19);
    if (V.World.getBlk(bandProbeX, bandY, bandZ) !== 0) noGhost = false;
    V.World.set(bandThresholds[bt], bandY, bandZ, 0);
    if (V.World.getBlk(bandProbeX, bandY, bandZ) !== 0) noGhost = false;
  }
  check('核心距边14/15/16放置和移除均无跨缝幽灵光', noGhost);
  V.World.applyEdits(bandRestore);

  // 四边与四角一次批量放置/移除，既覆盖union重光，也避免逐点全核心扫描拖慢CI。
  var seamCases = [
    { t: [250, 96], p: [256, 96], name: '右' },
    { t: [5, 96], p: [-1, 96], name: '左' },
    { t: [96, 250], p: [96, 256], name: '后' },
    { t: [96, 5], p: [96, -1], name: '前' },
    { t: [2, 2], p: [-1, -1], name: '左前角' },
    { t: [253, 2], p: [256, -1], name: '右前角' },
    { t: [2, 253], p: [-1, 256], name: '左后角' },
    { t: [253, 253], p: [256, 256], name: '右后角' }
  ];
  // 每条边只需对应外围块；角光额外加载两个side块。避免3×3泛加载拖慢CI。
  var ensuredSeamChunks = {};
  function ensureSeamChunk(cx, cz) {
    var ck = cx + ',' + cz;
    if (!ensuredSeamChunks[ck]) { V.World.ensureChunk(cx, cz); ensuredSeamChunks[ck] = true; }
  }
  for (var sc = 0; sc < seamCases.length; sc++) {
    var pcx = IT.floorDiv(seamCases[sc].p[0]), pcz = IT.floorDiv(seamCases[sc].p[1]);
    ensureSeamChunk(pcx, pcz);
    var xOutside = pcx < 0 || pcx >= W / CS;
    var zOutside = pcz < 0 || pcz >= D / CS;
    if (xOutside && zOutside) {
      ensureSeamChunk(pcx, pcz < 0 ? 0 : D / CS - 1);
      ensureSeamChunk(pcx < 0 ? 0 : W / CS - 1, pcz);
    }
  }
  var seamRestore = {}, seamClear = {}, seamPlace = {}, seamRemove = {};
  for (var sc2 = 0; sc2 < seamCases.length; sc2++) {
    var tc = seamCases[sc2].t, pc = seamCases[sc2].p;
    var tk = tc[0] + ',' + bandY + ',' + tc[1];
    var pk = pc[0] + ',' + bandY + ',' + pc[1];
    seamRestore[tk] = V.World.get(tc[0], bandY, tc[1]);
    seamRestore[pk] = V.World.get(pc[0], bandY, pc[1]);
    seamClear[tk] = 0; seamClear[pk] = 0;
    seamPlace[tk] = 19; seamRemove[tk] = 0;
  }
  V.World.applyEdits(seamClear);
  V.World.applyEdits(seamPlace);
  var allSeamsLit = true;
  for (var sc3 = 0; sc3 < seamCases.length; sc3++) {
    var probe = seamCases[sc3].p;
    if (V.World.getBlk(probe[0], bandY, probe[1]) !== 8) allSeamsLit = false;
  }
  check('核心火把批量跨四边/四角传播为8级光', allSeamsLit);
  V.World.applyEdits(seamRemove);
  var allSeamsDark = true;
  for (var sc4 = 0; sc4 < seamCases.length; sc4++) {
    var darkProbe = seamCases[sc4].p;
    if (V.World.getBlk(darkProbe[0], bandY, darkProbe[1]) !== 0) allSeamsDark = false;
  }
  check('批量移除四边/四角核心火把后跨缝光全熄', allSeamsDark);
  V.World.applyEdits(seamRestore);

  // 外围修改既要跨卸载/再加载保留，也要能通过 edits 在一次完整重载后恢复。
  var editX = 300, editZ = -17;
  var editCx = IT.floorDiv(editX), editCz = IT.floorDiv(editZ);
  V.World.ensureChunk(editCx, editCz);
  var editY = Math.max(3, Math.min(H - 2, V.World.surfaceAt(editX, editZ) + 1));
  var editId = V.World.get(editX, editY, editZ) === 10 ? 11 : 10;
  V.World.set(editX, editY, editZ, editId);
  var editKey = editX + ',' + editY + ',' + editZ;
  check('外围 set/get 与 edits 记账生效', V.World.get(editX, editY, editZ) === editId &&
    V.World.getEdits()[editKey] === editId);
  var savedOuterEdits = {};
  var allEdits = V.World.getEdits();
  for (var ek in allEdits)
    if (Object.prototype.hasOwnProperty.call(allEdits, ek)) savedOuterEdits[ek] = allEdits[ek];

  IT.unloadOutside(0, 0, 0);
  check('外围区块可卸载', !V.World.isChunkLoaded(editCx, editCz));
  V.World.ensureChunk(editCx, editCz);
  check('外围 edit 在卸载→重载后保留', V.World.get(editX, editY, editZ) === editId);

  V.World.init(12345);
  while (!V.World.isReady()) V.World.generateNext(64);
  V.World.applyEdits(savedOuterEdits);
  V.World.ensureChunk(editCx, editCz);
  check('外围 edit 在 init→applyEdits→按需生成后恢复', V.World.get(editX, editY, editZ) === editId &&
    V.World.getEdits()[editKey] === editId);

  function drainFocus(x, z) {
    V.World.setFocus(x, z);
    var guard = 0, st = V.World.streamStats();
    while (st.queued > 0 && guard++ < 100) {
      V.World.generateNext(64);
      st = V.World.streamStats();
    }
    return st;
  }
  // 单个焦点连同装饰 halo 会加载约 17×17 块；两次相隔很远的旅行若只加载不卸载，
  // 就会超过 19×19 的 keep 工作集上限，无需再生成第三套区块拖慢 CI。
  var far = CS * 128 + 0.5;
  var st1 = drainFocus(far, far);
  var st2 = drainFocus(-far, far);
  var cap = Math.pow(st2.keepRadius * 2 + 1, 2);
  check('远行流式队列可清空', st1.queued === 0 && st2.queued === 0);
  check('setFocus 远行后 loaded chunk 数量有界 (' + st2.loaded + '<=' + cap + ')',
    st2.loaded <= cap);
})();

console.log('确定性');
var same = true;
(function () {
  var first = [];
  for (var xx = 0; xx < W; xx += 5) first.push(V.World.surfaceAt(xx, 3) + ':' + V.World.get(xx, 20, 17));
  V.World.init(12345);
  while (!V.World.isReady()) V.World.generateNext(64);
  for (var x2 = 0; x2 < W; x2 += 5)
    if (first[x2 / 5] !== V.World.surfaceAt(x2, 3) + ':' + V.World.get(x2, 20, 17)) same = false;
})();
check('同种子两次生成完全一致', same);

(function () {
  V.World.init(777777);
  while (!V.World.isReady()) V.World.generateNext(64);
  var h1 = [];
  for (var x3 = 0; x3 < W; x3 += 5) h1.push(V.World.surfaceAt(x3, 3));
  V.World.init(12345);
  while (!V.World.isReady()) V.World.generateNext(64);
  var h2 = [];
  for (var x4 = 0; x4 < W; x4 += 5) h2.push(V.World.surfaceAt(x4, 3));
  check('不同种子地形不同', h1.join() !== h2.join());
})();

// 文本种子与等值数字种子一致性
(function () {
  V.World.init('2468');
  while (!V.World.isReady()) V.World.generateNext(64);
  var s1 = [];
  for (var xa = 0; xa < W; xa += 9) s1.push(V.World.surfaceAt(xa, 11));
  V.World.init(2468);
  while (!V.World.isReady()) V.World.generateNext(64);
  var okStr = true;
  for (var xb = 0; xb < W; xb += 9)
    if (s1[xb / 9] !== V.World.surfaceAt(xb, 11)) okStr = false;
  check('字符串/数字同值种子同一世界', okStr);
})();

console.log('群系多样性与特征方块扫描');
var featureFound = {
  sandCactus: false, jungleLog: false, giantJungle: false, podzol: false,
  mossy: false, spruceLog: false, sandstone: false, birchLog: false,
  acaciaLog: false, redSand: false, terracotta: false, ice: false,
  snowHigh: false, gravel: false
};
var biomeUniverse = {};
var seedsToScan = [12345, 42, 999, 7777, 31415, 271828];
for (var si = 0; si < seedsToScan.length; si++) {
  V.World.init(seedsToScan[si]);
  while (!V.World.isReady()) V.World.generateNext(64);
  for (var fx = 0; fx < W; fx += 3)
    for (var fz = 0; fz < D; fz += 3) {
      var bid = V.World.biomeAt(fx, fz);
      if (bid >= 0) biomeUniverse[bid] = true;
      for (var fy = 1; fy < H; fy++) {
        var fid = V.World.get(fx, fy, fz);
        if (fid === 26 && !featureFound.sandCactus) {
          if (V.World.get(fx, fy - 1, fz) === 6) featureFound.sandCactus = true;
        }
        else if (fid === 22) { featureFound.jungleLog = true; if (fy > 40) featureFound.giantJungle = true; }
        else if (fid === 24) featureFound.podzol = true;
        else if (fid === 25) featureFound.mossy = true;
        else if (fid === 20) featureFound.spruceLog = true;
        else if (fid === 27) featureFound.sandstone = true;
        else if (fid === 33) featureFound.birchLog = true;
        else if (fid === 35) featureFound.acaciaLog = true;
        else if (fid === 28) featureFound.redSand = true;
        else if (fid === 29 || fid === 30 || fid === 31) featureFound.terracotta = true;
        else if (fid === 32) featureFound.ice = true;
        else if (fid === 14) featureFound.gravel = true;
        else if (fid === 18 && fy >= 42) featureFound.snowHigh = true;
      }
    }
}
check('沙漠有仙人掌', featureFound.sandCactus);
check('有丛林木(含巨型)', featureFound.jungleLog);
check('有高耸巨型丛林树', featureFound.giantJungle);
check('原始针叶林有灰化土', featureFound.podzol);
check('原始针叶林有苔石巨砾', featureFound.mossy);
check('针叶林有云杉木', featureFound.spruceLog);
check('沙漠地下有砂岩层', featureFound.sandstone);
check('白桦森林有白桦木', featureFound.birchLog);
check('热带草原有金合欢木', featureFound.acaciaLog);
check('恶地有红沙', featureFound.redSand);
check('恶地有陶瓦层理', featureFound.terracotta);
check('冰封山峰有浮冰', featureFound.ice);
check('高山覆雪', featureFound.snowHigh);
check('海床/丘陵有砂砾', featureFound.gravel);

console.log('  扫描覆盖群系数: ' + Object.keys(biomeUniverse).length + '/' + V.Biomes.count);
check('多种子扫描覆盖大部分群系(>=13)', Object.keys(biomeUniverse).length >= 13);

console.log('单种子群系多样性 (种子 12345)');
V.World.init(12345);
while (!V.World.isReady()) V.World.generateNext(64);
var biomeSeen = {}, biomeCols = 0;
for (var bx2 = 0; bx2 < W; bx2 += 2)
  for (var bz2 = 0; bz2 < D; bz2 += 2) {
    var bid2 = V.World.biomeAt(bx2, bz2);
    if (bid2 >= 0) { biomeSeen[bid2] = (biomeSeen[bid2] || 0) + 1; biomeCols++; }
  }
check('biomeAt 覆盖所有采样列', biomeCols === (W / 2) * (D / 2));
var kinds = Object.keys(biomeSeen).length;
console.log('  出现群系数: ' + kinds + ' -> ' +
  Object.keys(biomeSeen).map(function (k) { return V.Biomes.name(+k) + '×' + biomeSeen[k]; }).join(', '));
check('至少出现 4 种群系', kinds >= 4);
check('群系 ID 均在注册表内', Object.keys(biomeSeen).every(function (k) { return +k >= 0 && +k < V.Biomes.count; }));

console.log('精选世界出生点（干地校验，复现蘑菇林沉海回归）');
(function () {
  // 精选卡片进入的是 lush v2 行星（与 startFeatured 钉种子后的目录一致）
  V.World.init(12345, { kind: 'planet', typeKey: 'lush', terrainVersion: 2 });
  var Bn = V.Biomes.B;
  function featuredApi() {
    return {
      climateAt: V.World.climateAt,
      pick: V.Biomes.pick,
      biomeAt: V.World.biomeAt,
      surfaceAt: V.World.surfaceAt,
      predictedHeightAt: V.World.predictedHeightAt
    };
  }
  function wideDry(wantId) {
    return V.Biomes.pickSpawnColumn(featuredApi(), wantId,
      { step: 4, x0: -520, x1: 519, dry: true });
  }
  var WATER = V.Config.WATER_LEVEL;
  var mushSpot = wideDry(Bn.MUSHROOM_FIELDS);
  check('蘑菇林在宽域内找到干地出生列', !!mushSpot);
  if (mushSpot) {
    console.log('  蘑菇林胜出列 ' + mushSpot.x + ',' + mushSpot.z);
    check('蘑菇林胜出列真实群系一致',
      V.World.biomeAt(mushSpot.x, mushSpot.z) === Bn.MUSHROOM_FIELDS);
    var mSy = V.World.surfaceAt(mushSpot.x, mushSpot.z);
    check('蘑菇林胜出列高于水位', mSy > WATER + 2);
    check('蘑菇林胜出列地表是菌丝体', V.World.get(mushSpot.x, mSy, mushSpot.z) === 53);
  }
  var darkSpot = wideDry(Bn.DARK_FOREST);
  if (darkSpot) {
    var dSy = V.World.surfaceAt(darkSpot.x, darkSpot.z);
    check('黑森林胜出列高于滩涂沙层线', dSy > WATER + 2 &&
      V.World.biomeAt(darkSpot.x, darkSpot.z) === Bn.DARK_FOREST);
  }
  // 海洋卡片：dry 关闭，本就应落在水面之下
  var oceanSpot = V.Biomes.pickSpawnColumn(featuredApi(), Bn.OCEAN,
    { step: 4, x0: -520, x1: 519, dry: false });
  check('海洋卡片仍落在水面以下', !!oceanSpot &&
    V.World.biomeAt(oceanSpot.x, oceanSpot.z) === Bn.OCEAN &&
    V.World.surfaceAt(oceanSpot.x, oceanSpot.z) <= WATER);
  // 确定性：两次调用逐位一致
  var again = wideDry(Bn.MUSHROOM_FIELDS);
  check('精选选点确定性复现', JSON.stringify(again) === JSON.stringify(mushSpot));
  // 降级契约：api 缺少 predictedHeightAt/surfaceAt 时退化为旧行为，仍能返回
  // 群系匹配的列（只按标签评分），而不是 null
  var legacyApi = {
    climateAt: V.World.climateAt,
    pick: V.Biomes.pick,
    biomeAt: V.World.biomeAt
  };
  var degraded = V.Biomes.pickSpawnColumn(legacyApi, Bn.MUSHROOM_FIELDS,
    { step: 4, x0: -520, x1: 519 });
  check('缺干地探针时退化为旧评分行为', !!degraded &&
    V.World.biomeAt(degraded.x, degraded.z) === Bn.MUSHROOM_FIELDS);
})();

console.log('修改与存档还原');
var sp = V.World.spawnPoint();
var bx = Math.floor(sp.x), by = Math.floor(sp.y), bz = Math.floor(sp.z);
var before = V.World.get(bx, by, bz);
V.World.set(bx, by, bz, 10);
check('set 生效', V.World.get(bx, by, bz) === 10);
var edits = V.World.getEdits();
check('edits 已记录', edits[bx + ',' + by + ',' + bz] === 10);
check('edits 数量少(仅增量)', Object.keys(edits).length <= 10);

V.World.init(12345);
while (!V.World.isReady()) V.World.generateNext(64);
check('还原前为原值', V.World.get(bx, by, bz) === before);
V.World.applyEdits(edits);
check('applyEdits 还原', V.World.get(bx, by, bz) === 10);
check('applyEdits 继承到增量账本', V.World.getEdits()[bx + ',' + by + ',' + bz] === 10);
var infraY = Math.min(V.Config.WORLD_H - 3, by + 3);
var infraCount = V.World.applyInfrastructure([
  { x: bx + 2, y: infraY, z: bz, id: 3 },
  { x: bx + 3, y: infraY, z: bz, id: 3 }
]);
check('系统基础设施批量写入共享edits账本', infraCount === 2 &&
  V.World.get(bx + 2, infraY, bz) === 3 && V.World.get(bx + 3, infraY, bz) === 3 &&
  V.World.getEdits()[[bx + 2, infraY, bz].join(',')] === 3);
var atomicBefore = V.World.get(bx + 4, infraY, bz);
check('损坏基础设施批次原子拒绝', V.World.applyInfrastructure([
  { x: bx + 4, y: infraY, z: bz, id: 3 },
  { x: Infinity, y: infraY, z: bz, id: 3 }
]) === 0 && V.World.get(bx + 4, infraY, bz) === atomicBefore);

console.log('存档序列化往返');
(function () {
  // 方块元数据随存档序列化（箱子示例）
  V.World.setMeta(7, 8, 9, { type: 'chest', items: [{ id: 10, n: 5, dur: null }, null] });
  var inv = []; var cnt = [];
  for (var i = 0; i < 36; i++) { inv.push(0); cnt.push(0); }
  inv[0] = 10; cnt[0] = 64;   // 一组 64 木板
  inv[5] = 19; cnt[5] = 3;    // 3 个火把
  var saveGalaxy = GA.create('star-ocean-42');
  saveGalaxy.worlds['planet-1'] = {
    time: 0.77,
    weather: 'thunder',
    player: { pos: [12, 34, 56], hp: 20, food: 20 }
  };
  var extra = {
    time: 0.42,
    weather: 'rain',
    player: { pos: [1.5, 2.5, 3.5], yaw: 1.25, pitch: -0.3, fly: true, hp: 17, aboard: true,
      environment: { v: 1, worlds: { 'planet-0': { exposure: 42.5, adapted: true } } } },
    shipFlight: { v: 1, position: [12.5, 44.02, -8.5], velocity: [1, 2, 3],
      yaw: 1.2, pitch: .1, roll: -.05, throttle: .6, landed: false },
    inv: inv,
    cnt: cnt,
    held: 102,
    heldCnt: 1,
    heldDur: 37,
    craftGrid: [10, 0, 100, 0, 16, 0, 0, 0, 0],
    invCraftGrid: [4, 0, 20, 0],
    bed: [12, 34, 56],
    dur: (function () { var d = []; for (var i = 0; i < 36; i++) d.push(null); d[1] = 55; return d; })(),
    drops: [
      { id: 102, n: 1, dur: 37, pos: [11.5, 40.25, -7.5], vel: [1.25, 2.5, -0.75], age: 12.5 },
      { id: 10, n: 4, dur: null, pos: [-3.5, 22, 8.5], vel: [0, 0, 0], age: 3 }
    ],
    galaxy: saveGalaxy
  };
  check('Save.save 成功', V.Save.save(V.World, extra));
  var loaded = V.Save.load();
  check('Save.save 裁剪序列化副本但不改运行时 galaxy',
    !!saveGalaxy.worlds['planet-1'].player && saveGalaxy.worlds['planet-1'].player.pos[0] === 12);
  check('非当前世界瘦身后仍保留时间天气', !!loaded && !!loaded.galaxy.worlds['planet-1'] &&
    loaded.galaxy.worlds['planet-1'].time === 0.77 &&
    loaded.galaxy.worlds['planet-1'].weather === 'thunder' &&
    loaded.galaxy.worlds['planet-1'].player === undefined);
  check('Save.load 返回数据', !!loaded);
  check('seed 往返', !!loaded && loaded.seed === V.World.getSeed());
  check('time 往返', !!loaded && loaded.time === 0.42);
  check('weather 往返', !!loaded && loaded.weather === 'rain');
  check('inv 往返', !!loaded && !!loaded.inv && loaded.inv[0] === 10 && loaded.inv[5] === 19);
  check('cnt 往返(堆叠数量不丢失)', !!loaded && !!loaded.cnt && loaded.cnt.length === 36 &&
    loaded.cnt[0] === 64 && loaded.cnt[5] === 3);
  check('held/heldCnt 往返', !!loaded && loaded.held === 102 && loaded.heldCnt === 1);
  check('heldDur 往返', !!loaded && loaded.heldDur === 37);
  check('3x3 craftGrid 往返', !!loaded && Array.isArray(loaded.craftGrid) && loaded.craftGrid.length === 9 &&
    loaded.craftGrid[0] === 10 && loaded.craftGrid[2] === 100 && loaded.craftGrid[4] === 16);
  check('2x2 invCraftGrid 往返', !!loaded && Array.isArray(loaded.invCraftGrid) && loaded.invCraftGrid.length === 4 &&
    loaded.invCraftGrid[0] === 4 && loaded.invCraftGrid[2] === 20);
  check('bed 往返', !!loaded && !!loaded.bed && loaded.bed[0] === 12 && loaded.bed[1] === 34 && loaded.bed[2] === 56);
  check('dur(工具耐久) 往返', !!loaded && !!loaded.dur && loaded.dur[1] === 55);
  check('drops 往返保留数量/工具耐久/位置/速度/年龄', !!loaded && Array.isArray(loaded.drops) &&
    loaded.drops.length === 2 && loaded.drops[0].id === 102 && loaded.drops[0].n === 1 &&
    loaded.drops[0].dur === 37 && loaded.drops[0].pos[0] === 11.5 && loaded.drops[0].pos[2] === -7.5 &&
    loaded.drops[0].vel[1] === 2.5 && loaded.drops[0].age === 12.5 &&
    loaded.drops[1].id === 10 && loaded.drops[1].n === 4 && loaded.drops[1].dur === null);
  check('meta(箱子) 往返', !!loaded && !!loaded.meta && !!loaded.meta['7,8,9'] &&
    loaded.meta['7,8,9'].items[0].n === 5);
  check('player 往返', !!loaded && !!loaded.player && loaded.player.hp === 17 &&
    loaded.player.fly === true && Math.abs(loaded.player.pos[0] - 1.5) < 1e-9 &&
    loaded.player.aboard === true && loaded.shipFlight && loaded.shipFlight.position[1] === 44.02 &&
    loaded.shipFlight.landed === false && loaded.shipFlight.throttle === .6 &&
    loaded.player.environment.v === 1 && loaded.player.environment.worlds['planet-0'].exposure === 42.5 &&
    loaded.player.environment.worlds['planet-0'].adapted === true);
  check('edits 随存档写入', !!loaded && !!loaded.edits && loaded.edits[bx + ',' + by + ',' + bz] === 10);
  check("v6 星系状态随存档写入", !!loaded && loaded.v === 6 && loaded.galaxy.rootSeed === galA.rootSeed &&
    loaded.galaxy.catalog.length === 7 && loaded.galaxy.terrainVersion === 2);

  // 旧 v5 存档没有临时格/手持耐久字段，读取层不得因此拒绝整个存档。
  var currentRaw = _store[V.Config.SAVE_KEY];
  var oldShape = JSON.parse(currentRaw);
  delete oldShape.heldDur;
  delete oldShape.craftGrid;
  delete oldShape.invCraftGrid;
  delete oldShape.drops;
  delete oldShape.player.environment;
  delete oldShape.player.aboard;
  delete oldShape.shipFlight;
  _store[V.Config.SAVE_KEY] = JSON.stringify(oldShape);
  var oldLoaded = V.Save.load();
  check('旧档缺失新增临时字段仍可载入', !!oldLoaded && oldLoaded.seed === loaded.seed &&
    oldLoaded.heldDur === undefined && oldLoaded.craftGrid === undefined && oldLoaded.invCraftGrid === undefined &&
    oldLoaded.drops === undefined && oldLoaded.player.environment === undefined &&
    oldLoaded.player.aboard === undefined && oldLoaded.shipFlight === undefined);
  _store[V.Config.SAVE_KEY] = currentRaw;

  // 第二次载入后立即再存档：旧修改必须继续留在账本，第三次载入仍可恢复。
  V.World.init(loaded.seed);
  while (!V.World.isReady()) V.World.generateNext(64);
  V.World.applyEdits(loaded.edits);
  check('二次载入后方块与账本一致', V.World.get(bx, by, bz) === 10 &&
    V.World.getEdits()[bx + ',' + by + ',' + bz] === 10);
  check('二次载入后可再次保存', V.Save.save(V.World, extra));
  var loadedAgain = V.Save.load();
  check('载入→再保存→第三次载入不丢 edits', !!loadedAgain && !!loadedAgain.edits &&
    loadedAgain.edits[bx + ',' + by + ',' + bz] === 10);
})();

console.log('存档事务写入故障保护');
(function () {
  var saveKey = V.Config.SAVE_KEY;
  var primaryRaw = _store[saveKey];
  var originalSetItem = sandbox.localStorage.setItem;
  var originalGetItem = sandbox.localStorage.getItem;
  var originalWarn = sandbox.console.warn;
  var saveWorld = {
    getSeed: function () { return 'transaction-candidate'; },
    getAllMeta: function () { return {}; },
    getEdits: function () { return { '1,2,3': 4 }; }
  };

  var snapshotGetterCalls = 0;
  var capturedWorld = {
    getSeed: function () { return 'captured-save-snapshot'; },
    getAllMeta: function () { snapshotGetterCalls++; throw new Error('meta getter must not run'); },
    getEdits: function () { snapshotGetterCalls++; throw new Error('edits getter must not run'); }
  };
  var capturedResult = V.Save.save(capturedWorld, {
    meta: { '4,5,6': { type: 'captured-meta' } },
    edits: { '7,8,9': 10 }
  });
  var capturedLoaded = V.Save.load();
  check('Save.save 优先使用同次捕获的 meta/edits 且不二次读取 world',
    capturedResult === true && snapshotGetterCalls === 0 && !!capturedLoaded &&
    capturedLoaded.meta['4,5,6'].type === 'captured-meta' && capturedLoaded.edits['7,8,9'] === 10);
  _store[saveKey] = primaryRaw;

  sandbox.console.warn = function () { };

  // 标准 QuotaExceededError 语义：抛错且不修改目标键。
  sandbox.localStorage.setItem = function (k, v) {
    if (k === saveKey) throw new Error('injected quota exceeded');
    return originalSetItem(k, v);
  };
  var quotaResult = V.Save.save(saveWorld, {});
  sandbox.localStorage.setItem = originalSetItem;
  check('Save.save 配额抛错返回 false 且主档字节不变',
    quotaResult === false && _store[saveKey] === primaryRaw);

  // 更恶劣的替身：先污染目标再抛错；回滚仍应恢复调用前字节。
  var threwAfterWrite = false;
  sandbox.localStorage.setItem = function (k, v) {
    if (k === saveKey && !threwAfterWrite) {
      threwAfterWrite = true;
      originalSetItem(k, v);
      throw new Error('injected post-write failure');
    }
    return originalSetItem(k, v);
  };
  var postWriteResult = V.Save.save(saveWorld, {});
  sandbox.localStorage.setItem = originalSetItem;
  check('Save.save 写后抛错可回滚原主档',
    postWriteResult === false && _store[saveKey] === primaryRaw);

  // 静默拒写不能被误报为成功。
  sandbox.localStorage.setItem = function (k, v) {
    if (k === saveKey) return;
    return originalSetItem(k, v);
  };
  var silentResult = V.Save.save(saveWorld, {});
  sandbox.localStorage.setItem = originalSetItem;
  check('Save.save 静默拒写返回 false 且主档字节不变',
    silentResult === false && _store[saveKey] === primaryRaw);

  // 写入本身成功但首次回读返回另一份合法 JSON，事务必须恢复旧主档。
  var wrongReadArmed = false;
  sandbox.localStorage.setItem = function (k, v) {
    var result = originalSetItem(k, v);
    if (k === saveKey && String(v) !== primaryRaw) wrongReadArmed = true;
    return result;
  };
  sandbox.localStorage.getItem = function (k) {
    if (k === saveKey && wrongReadArmed) {
      wrongReadArmed = false;
      return '{"seed":"wrong-readback"}';
    }
    return originalGetItem(k);
  };
  var wrongReadResult = V.Save.save(saveWorld, {});
  sandbox.localStorage.setItem = originalSetItem;
  sandbox.localStorage.getItem = originalGetItem;
  check('Save.save 精确回读不符返回 false 并回滚原主档',
    wrongReadResult === false && _store[saveKey] === primaryRaw);

  // 首次保存同样不能因回读异常留下未确认的新主档。
  delete _store[saveKey];
  wrongReadArmed = false;
  sandbox.localStorage.setItem = function (k, v) {
    var result = originalSetItem(k, v);
    if (k === saveKey) wrongReadArmed = true;
    return result;
  };
  sandbox.localStorage.getItem = function (k) {
    if (k === saveKey && wrongReadArmed) {
      wrongReadArmed = false;
      return '{"seed":"wrong-first-readback"}';
    }
    return originalGetItem(k);
  };
  var firstWriteResult = V.Save.save(saveWorld, {});
  sandbox.localStorage.setItem = originalSetItem;
  sandbox.localStorage.getItem = originalGetItem;
  sandbox.console.warn = originalWarn;
  check('首次 Save.save 回读异常不遗留未确认主档', firstWriteResult === false &&
    !Object.prototype.hasOwnProperty.call(_store, saveKey));

  _store[saveKey] = primaryRaw;
})();

console.log('legacy 存档安全迁移');
(function () {
  var saveKey = V.Config.SAVE_KEY;
  var legacy4Key = 'voxelcraft_save_v4';
  var legacy3Key = 'voxelcraft_save_v3';
  var primaryRaw = _store[saveKey];
  var hadLegacy4 = Object.prototype.hasOwnProperty.call(_store, legacy4Key);
  var previousLegacy4 = _store[legacy4Key];
  var hadLegacy3 = Object.prototype.hasOwnProperty.call(_store, legacy3Key);
  var previousLegacy3 = _store[legacy3Key];
  var originalSetItem = sandbox.localStorage.setItem;
  var originalGetItem = sandbox.localStorage.getItem;
  var originalRemoveItem = sandbox.localStorage.removeItem;
  var legacy4Raw = '{\n  "v": 4, "seed": "legacy-v4-exact", "time": 0.25\n}';
  var legacy3Raw = '{ "v": 3, "seed": "legacy-v3-exact", "edits": {} }';

  function resetLegacy(key, raw) {
    delete _store[saveKey];
    delete _store[legacy4Key];
    delete _store[legacy3Key];
    _store[key] = raw;
  }

  resetLegacy(legacy4Key, legacy4Raw);
  var loaded4 = V.Save.load();
  check('v4 legacy 成功迁移并保持目标字节精确', !!loaded4 &&
    loaded4.seed === 'legacy-v4-exact' && _store[saveKey] === legacy4Raw);
  check('v4 legacy 仅在目标验证后删除旧键',
    !Object.prototype.hasOwnProperty.call(_store, legacy4Key));

  resetLegacy(legacy3Key, legacy3Raw);
  var loaded3 = V.Save.load();
  check('v3 legacy 成功迁移并保持目标字节精确', !!loaded3 &&
    loaded3.seed === 'legacy-v3-exact' && _store[saveKey] === legacy3Raw);
  check('v3 legacy 仅在目标验证后删除旧键',
    !Object.prototype.hasOwnProperty.call(_store, legacy3Key));

  // 较新的损坏键不能遮蔽仍可载入的 v3。
  resetLegacy(legacy3Key, legacy3Raw);
  _store[legacy4Key] = '{broken-v4';
  var fallback3 = V.Save.load();
  check('损坏 v4 不遮蔽可用 v3 迁移', !!fallback3 &&
    fallback3.seed === 'legacy-v3-exact' && _store[saveKey] === legacy3Raw &&
    _store[legacy4Key] === '{broken-v4');

  // 目标写抛错：本次仍直接返回 legacy 内容，且旧字节必须原封不动。
  resetLegacy(legacy4Key, legacy4Raw);
  sandbox.localStorage.setItem = function (k, v) {
    if (k === saveKey) throw new Error('injected migration write failure');
    return originalSetItem(k, v);
  };
  var throwLoaded = V.Save.load();
  sandbox.localStorage.setItem = originalSetItem;
  check('legacy 目标写抛错仍可载入且保留 v4 原字节', !!throwLoaded &&
    throwLoaded.seed === 'legacy-v4-exact' && _store[legacy4Key] === legacy4Raw &&
    !Object.prototype.hasOwnProperty.call(_store, saveKey));

  // 目标静默拒写：不得删除 v3 或宣称完成迁移。
  resetLegacy(legacy3Key, legacy3Raw);
  sandbox.localStorage.setItem = function (k, v) {
    if (k === saveKey) return;
    return originalSetItem(k, v);
  };
  var silentLoaded = V.Save.load();
  sandbox.localStorage.setItem = originalSetItem;
  check('legacy 目标静默拒写仍可载入且保留 v3 原字节', !!silentLoaded &&
    silentLoaded.seed === 'legacy-v3-exact' && _store[legacy3Key] === legacy3Raw &&
    !Object.prototype.hasOwnProperty.call(_store, saveKey));

  // 写入后首次回读不符：回滚空目标，并禁止删除来源。
  resetLegacy(legacy4Key, legacy4Raw);
  var migrationWrongRead = false;
  sandbox.localStorage.setItem = function (k, v) {
    var result = originalSetItem(k, v);
    if (k === saveKey) migrationWrongRead = true;
    return result;
  };
  sandbox.localStorage.getItem = function (k) {
    if (k === saveKey && migrationWrongRead) {
      migrationWrongRead = false;
      return '{"seed":"wrong-migration-readback"}';
    }
    return originalGetItem(k);
  };
  var wrongLoaded = V.Save.load();
  sandbox.localStorage.setItem = originalSetItem;
  sandbox.localStorage.getItem = originalGetItem;
  check('legacy 目标精确回读不符时回滚且仍可载入', !!wrongLoaded &&
    wrongLoaded.seed === 'legacy-v4-exact' && _store[legacy4Key] === legacy4Raw &&
    !Object.prototype.hasOwnProperty.call(_store, saveKey));

  // 删除旧键失败是可恢复的双份状态，不应撤销已验证的新主档。
  resetLegacy(legacy3Key, legacy3Raw);
  sandbox.localStorage.removeItem = function (k) {
    if (k === legacy3Key) return;
    return originalRemoveItem(k);
  };
  var removeLoaded = V.Save.load();
  sandbox.localStorage.removeItem = originalRemoveItem;
  check('legacy 删除静默失败时保留两份精确可载入字节', !!removeLoaded &&
    _store[saveKey] === legacy3Raw && _store[legacy3Key] === legacy3Raw);

  // 已存在的损坏/空主键也属于用户数据，不能被 legacy 自动覆盖。
  _store[saveKey] = '';
  _store[legacy4Key] = legacy4Raw;
  check('空或损坏主键阻止 legacy 覆盖', V.Save.load() === null &&
    _store[saveKey] === '' && _store[legacy4Key] === legacy4Raw);

  _store[saveKey] = primaryRaw;
  if (hadLegacy4) _store[legacy4Key] = previousLegacy4;
  else delete _store[legacy4Key];
  if (hadLegacy3) _store[legacy3Key] = previousLegacy3;
  else delete _store[legacy3Key];
})();

console.log('存档可载入边界');
(function () {
  var saveKey = V.Config.SAVE_KEY;
  var backupKey = saveKey + '_backup';
  var swapKey = backupKey + '_swap';
  var primaryRaw = _store[saveKey];
  var hadBackup = Object.prototype.hasOwnProperty.call(_store, backupKey);
  var previousBackup = _store[backupKey];
  var hadSwap = Object.prototype.hasOwnProperty.call(_store, swapKey);
  var previousSwap = _store[swapKey];

  check('空对象/空星系种子不可载入', !V.Save.isLoadable({}) &&
    !V.Save.isLoadable({ galaxy: { rootSeed: null } }));
  check('NaN/空白种子不可载入', !V.Save.isLoadable({ seed: NaN }) &&
    !V.Save.isLoadable({ seed: '' }) && !V.Save.isLoadable({ seed: '   ' }));
  check('legacy 数字/字符串种子仍可载入', V.Save.isLoadable({ seed: 0 }) &&
    V.Save.isLoadable({ seed: 'legacy-world' }));
  var inheritedSeed = Object.create({ seed: 'prototype-pollution' });
  var inheritedGalaxy = Object.create({ galaxy: { rootSeed: 'prototype-galaxy' } });
  var ownSeedWithoutPrototype = Object.create(null);
  ownSeedWithoutPrototype.seed = 'own-null-prototype-seed';
  check('原型链继承种子不可伪造可载入存档', !V.Save.isLoadable(inheritedSeed) &&
    !V.Save.isLoadable(inheritedGalaxy));
  check('无原型对象的自有种子仍可载入', V.Save.isLoadable(ownSeedWithoutPrototype));

  var corruptRaw = '{}';
  _store[saveKey] = corruptRaw;
  check('损坏主档 load/has 拒绝但 hasRaw 保护原字节',
    V.Save.load() === null && V.Save.has() === false && V.Save.hasRaw() === true &&
    _store[saveKey] === corruptRaw);

  _store[saveKey] = primaryRaw;
  _store[backupKey] = corruptRaw;
  check('损坏备份不对外显示且不可恢复', V.Save.hasBackup() === false &&
    V.Save.restoreBackup() === false && _store[saveKey] === primaryRaw &&
    _store[backupKey] === corruptRaw);

  _store[saveKey] = primaryRaw;
  if (hadBackup) _store[backupKey] = previousBackup;
  else delete _store[backupKey];
  if (hadSwap) _store[swapKey] = previousSwap;
  else delete _store[swapKey];
})();

console.log('存档归档与恢复保护');
(function () {
  var saveKey = V.Config.SAVE_KEY;
  var backupKey = saveKey + '_backup';
  var swapKey = backupKey + '_swap';
  var primaryRaw = _store[saveKey];
  delete _store[backupKey];
  delete _store[swapKey];

  check('归档测试前主档存在', typeof primaryRaw === 'string' && primaryRaw.length > 0);
  check('无备份时 hasBackup=false', V.Save.hasBackup() === false);

  // 故障注入：备份键写入失败时，archiveCurrent 绝不得删除或重写主档。
  var originalSetItem = sandbox.localStorage.setItem;
  var originalWarn = sandbox.console.warn;
  sandbox.localStorage.setItem = function (k, v) {
    if (k === backupKey) throw new Error('injected backup write failure');
    return originalSetItem(k, v);
  };
  sandbox.console.warn = function () { };
  var archiveFailed = V.Save.archiveCurrent();
  sandbox.console.warn = originalWarn;
  sandbox.localStorage.setItem = originalSetItem;
  check('备份写入失败时 archiveCurrent=false', archiveFailed === false);
  check('归档失败不清主档且字节完全一致', _store[saveKey] === primaryRaw);
  check('归档失败不伪造可用备份', V.Save.hasBackup() === false && !Object.prototype.hasOwnProperty.call(_store, backupKey));

  // 故障注入：removeItem 静默失效时也必须回滚刚写入的备份，保持双槽原状。
  var originalRemoveItem = sandbox.localStorage.removeItem;
  sandbox.localStorage.removeItem = function (k) {
    if (k === saveKey) return;
    return originalRemoveItem(k);
  };
  var removeFailed = V.Save.archiveCurrent();
  sandbox.localStorage.removeItem = originalRemoveItem;
  check('主档删除静默失败时 archiveCurrent=false', removeFailed === false);
  check('主档删除失败后主档字节不变', _store[saveKey] === primaryRaw);
  check('主档删除失败后备份槽回滚', !Object.prototype.hasOwnProperty.call(_store, backupKey));

  // removeItem 已删除后才抛错，BACKUP 此时也已经被覆盖；catch 必须恢复两槽。
  var priorBackup = JSON.parse(primaryRaw);
  priorBackup.seed = 'archive-prior-backup';
  var priorBackupRaw = JSON.stringify(priorBackup);
  _store[backupKey] = priorBackupRaw;
  sandbox.localStorage.removeItem = function (k) {
    if (k === saveKey) {
      originalRemoveItem(k);
      throw new Error('injected post-remove failure');
    }
    return originalRemoveItem(k);
  };
  sandbox.console.warn = function () { };
  var throwRemoveFailed = V.Save.archiveCurrent();
  sandbox.console.warn = originalWarn;
  sandbox.localStorage.removeItem = originalRemoveItem;
  check('主档删除后抛错时 archiveCurrent=false', throwRemoveFailed === false);
  check('主档删除后抛错精确恢复主档与既有备份',
    _store[saveKey] === primaryRaw && _store[backupKey] === priorBackupRaw);
  delete _store[backupKey];

  check('成功归档当前存档', V.Save.archiveCurrent() === true);
  check('成功归档后主档已移除', !Object.prototype.hasOwnProperty.call(_store, saveKey));
  check('备份保留主档原始字节', _store[backupKey] === primaryRaw);
  check('成功归档后 hasBackup=true', V.Save.hasBackup() === true);

  // 模拟玩家已创建了另一个新档；恢复时旧档和当前档必须交换，以便再次恢复可撤销。
  var replacement = JSON.parse(primaryRaw);
  replacement.seed = '987654321';
  replacement.time = 0.77;
  var replacementRaw = JSON.stringify(replacement);
  _store[saveKey] = replacementRaw;
  check('恢复备份执行 swap', V.Save.restoreBackup() === true);
  check('restore 后主档精确等于旧备份', _store[saveKey] === primaryRaw);
  check('restore 后原当前档成为备份', _store[backupKey] === replacementRaw && V.Save.hasBackup() === true);
  check('restore swap 成功后清理中转键', !Object.prototype.hasOwnProperty.call(_store, swapKey));
  check('再次 restore 可撤销上一次恢复', V.Save.restoreBackup() === true &&
    _store[saveKey] === replacementRaw && _store[backupKey] === primaryRaw);

  // 不污染后续无关测试。
  _store[saveKey] = primaryRaw;
  delete _store[backupKey];
  delete _store[swapKey];
})();

console.log('损坏主档归档与有效备份救援');
(function () {
  var saveKey = V.Config.SAVE_KEY;
  var backupKey = saveKey + '_backup';
  var swapKey = backupKey + '_swap';
  var quarantineKey = saveKey + '_quarantine';
  var originalPrimary = _store[saveKey];
  var originalRemoveItem = sandbox.localStorage.removeItem;

  ['{', ''].forEach(function (corruptRaw, index) {
    _store[saveKey] = corruptRaw;
    delete _store[backupKey];
    delete _store[swapKey];
    delete _store[quarantineKey];
    check('任意非 null 损坏主档可字节归档 #' + index,
      V.Save.archiveCurrent() === true && !Object.prototype.hasOwnProperty.call(_store, saveKey) &&
      !Object.prototype.hasOwnProperty.call(_store, backupKey) &&
      _store[quarantineKey] === corruptRaw && V.Save.hasBackup() === false && V.Save.hasQuarantine() === true);
  });

  var validBackup = JSON.parse(originalPrimary);
  validBackup.seed = 'valid-rescue-backup';
  var validBackupRaw = JSON.stringify(validBackup);
  var corruptCurrentRaw = '{not-json-current';

  // 归档坏主档时，既有的唯一有效 backup 必须原封不动，坏字节进入隔离槽。
  _store[saveKey] = corruptCurrentRaw;
  _store[backupKey] = validBackupRaw;
  delete _store[swapKey];
  delete _store[quarantineKey];
  check('损坏主档归档不覆盖既有有效 backup', V.Save.archiveCurrent() === true &&
    !Object.prototype.hasOwnProperty.call(_store, saveKey) &&
    _store[backupKey] === validBackupRaw && _store[quarantineKey] === corruptCurrentRaw);

  var olderQuarantine = 'older-quarantine-bytes';
  _store[saveKey] = corruptCurrentRaw;
  _store[backupKey] = validBackupRaw;
  _store[quarantineKey] = olderQuarantine;
  check('不同的既有 quarantine 阻止覆盖并保留三槽', V.Save.archiveCurrent() === false &&
    _store[saveKey] === corruptCurrentRaw && _store[backupKey] === validBackupRaw &&
    _store[quarantineKey] === olderQuarantine);

  delete _store[quarantineKey];
  sandbox.localStorage.removeItem = function (k) {
    if (k === saveKey) {
      originalRemoveItem(k);
      throw new Error('injected quarantine post-remove failure');
    }
    return originalRemoveItem(k);
  };
  var quarantineRemoveFailed = V.Save.archiveCurrent();
  sandbox.localStorage.removeItem = originalRemoveItem;
  check('quarantine 后删除主档抛错可精确回滚', quarantineRemoveFailed === false &&
    _store[saveKey] === corruptCurrentRaw && _store[backupKey] === validBackupRaw &&
    !Object.prototype.hasOwnProperty.call(_store, quarantineKey));

  _store[saveKey] = corruptCurrentRaw;
  _store[backupKey] = validBackupRaw;
  delete _store[swapKey];
  check('有效备份可覆盖语法损坏 current', V.Save.restoreBackup() === true);
  check('救援后主档可载入且损坏 current 原字节被隔离到 backup',
    _store[saveKey] === validBackupRaw && _store[backupKey] === corruptCurrentRaw &&
    !Object.prototype.hasOwnProperty.call(_store, swapKey) &&
    V.Save.load().seed === 'valid-rescue-backup');
  check('损坏隔离副本不伪装成可恢复备份', V.Save.hasBackup() === false);

  _store[saveKey] = originalPrimary;
  delete _store[backupKey];
  delete _store[swapKey];
  delete _store[quarantineKey];
})();

console.log('restoreBackup 崩溃状态恢复');
(function () {
  var saveKey = V.Config.SAVE_KEY;
  var backupKey = saveKey + '_backup';
  var swapKey = backupKey + '_swap';
  var originalPrimary = _store[saveKey];
  var currentObj = JSON.parse(originalPrimary);
  currentObj.seed = 'swap-current-A';
  var currentA = JSON.stringify(currentObj);
  var backupObj = JSON.parse(originalPrimary);
  backupObj.seed = 'swap-backup-B';
  var backupB = JSON.stringify(backupObj);
  var originalSetItem = sandbox.localStorage.setItem;
  var originalRemoveItem = sandbox.localStorage.removeItem;
  var originalWarn = sandbox.console.warn;

  function setSwapState(current, backup, journal) {
    if (current === null) delete _store[saveKey];
    else _store[saveKey] = current;
    if (backup === null) delete _store[backupKey];
    else _store[backupKey] = backup;
    if (journal === null) delete _store[swapKey];
    else _store[swapKey] = journal;
  }

  // S0: journal 写完，正式槽尚未变化。
  setSwapState(currentA, backupB, backupB);
  var s0Loaded = V.Save.load();
  check('S0 崩溃恢复保持原 current/backup 并清 journal', !!s0Loaded &&
    s0Loaded.seed === 'swap-current-A' && _store[saveKey] === currentA &&
    _store[backupKey] === backupB && !Object.prototype.hasOwnProperty.call(_store, swapKey));

  // S1: BACKUP 已写入原 current，原 backup 仅存于 journal。
  setSwapState(currentA, currentA, backupB);
  var s1Loaded = V.Save.load();
  check('S1 崩溃恢复从 journal 找回原 backup', !!s1Loaded &&
    s1Loaded.seed === 'swap-current-A' && _store[saveKey] === currentA &&
    _store[backupKey] === backupB && !Object.prototype.hasOwnProperty.call(_store, swapKey));

  // S2: 两正式槽已完成交换，只剩 journal 未清理。
  setSwapState(backupB, currentA, backupB);
  var s2Loaded = V.Save.load();
  check('S2 崩溃恢复识别已提交交换且仅清 journal', !!s2Loaded &&
    s2Loaded.seed === 'swap-backup-B' && _store[saveKey] === backupB &&
    _store[backupKey] === currentA && !Object.prototype.hasOwnProperty.call(_store, swapKey));

  // S1 回滚槽写入失败时 journal 必须留下，下一入口可继续恢复。
  setSwapState(currentA, currentA, backupB);
  sandbox.localStorage.setItem = function (k, v) {
    if (k === backupKey) throw new Error('injected S1 rollback failure');
    return originalSetItem(k, v);
  };
  var blockedS1 = V.Save.load();
  sandbox.localStorage.setItem = originalSetItem;
  check('S1 回滚失败 fail-closed 并保留有效 journal 与两份原字节', blockedS1 === null &&
    _store[saveKey] === currentA &&
    _store[backupKey] === currentA && _store[swapKey] === backupB);
  V.Save.load();
  check('S1 临时故障解除后下次入口完成恢复', _store[saveKey] === currentA &&
    _store[backupKey] === backupB && !Object.prototype.hasOwnProperty.call(_store, swapKey));

  // S2 清 journal 失败也不能伪称已清；正式槽保持已提交方向。
  setSwapState(backupB, currentA, backupB);
  sandbox.localStorage.removeItem = function (k) {
    if (k === swapKey) throw new Error('injected journal cleanup failure');
    return originalRemoveItem(k);
  };
  var blockedS2 = V.Save.load();
  sandbox.localStorage.removeItem = originalRemoveItem;
  check('S2 journal 删除失败时 fail-closed 且不回滚已提交槽', blockedS2 === null &&
    _store[saveKey] === backupB &&
    _store[backupKey] === currentA && _store[swapKey] === backupB);
  V.Save.load();
  check('S2 临时故障解除后仅清 journal', _store[saveKey] === backupB &&
    _store[backupKey] === currentA && !Object.prototype.hasOwnProperty.call(_store, swapKey));

  // 运行时目标写与回滚都失败：不能清 journal；解除故障后按 S1 找回 B。
  setSwapState(currentA, backupB, null);
  sandbox.localStorage.setItem = function (k, v) {
    if (k === saveKey) throw new Error('injected target and rollback failure');
    return originalSetItem(k, v);
  };
  sandbox.console.warn = function () { };
  var failedRestore = V.Save.restoreBackup();
  sandbox.console.warn = originalWarn;
  sandbox.localStorage.setItem = originalSetItem;
  check('restore 回滚未确认时返回 false 并保留 journal', failedRestore === false &&
    _store[saveKey] === currentA && _store[backupKey] === currentA && _store[swapKey] === backupB);
  V.Save.load();
  check('restore 故障解除后 journal 可恢复原双槽', _store[saveKey] === currentA &&
    _store[backupKey] === backupB && !Object.prototype.hasOwnProperty.call(_store, swapKey));

  // journal 是仅存副本时必须救回 KEY，不能永久 blocked。
  setSwapState(null, null, backupB);
  var salvageLoaded = V.Save.load();
  check('KEY/BACKUP 全失时从有效 journal 救回主档', !!salvageLoaded &&
    salvageLoaded.seed === 'swap-backup-B' && _store[saveKey] === backupB &&
    !Object.prototype.hasOwnProperty.call(_store, backupKey) &&
    !Object.prototype.hasOwnProperty.call(_store, swapKey));

  // recover 期间 journal 被另一标签替换，不能清掉新 journal 或继续载入。
  var replacementJournalObj = JSON.parse(originalPrimary);
  replacementJournalObj.seed = 'replacement-journal-C';
  var replacementJournal = JSON.stringify(replacementJournalObj);
  setSwapState(currentA, currentA, backupB);
  sandbox.localStorage.setItem = function (k, v) {
    var result = originalSetItem(k, v);
    if (k === backupKey) _store[swapKey] = replacementJournal;
    return result;
  };
  var replacedJournalLoad = V.Save.load();
  sandbox.localStorage.setItem = originalSetItem;
  check('跨标签替换 journal 时精确校验失败并保留新 journal',
    replacedJournalLoad === null && _store[saveKey] === currentA &&
    _store[backupKey] === backupB && _store[swapKey] === replacementJournal);

  // 无 current 的恢复若 backup 删除抛错/静默拒绝，必须回滚 KEY=null。
  ['throw', 'silent'].forEach(function (mode) {
    setSwapState(null, backupB, null);
    sandbox.localStorage.removeItem = function (k) {
      if (k === backupKey) {
        if (mode === 'throw') throw new Error('injected backup removal failure');
        return;
      }
      return originalRemoveItem(k);
    };
    var moveResult = V.Save.restoreBackup();
    sandbox.localStorage.removeItem = originalRemoveItem;
    check('无 current 恢复遇到 backup 删除' + mode + '时回滚', moveResult === false &&
      !Object.prototype.hasOwnProperty.call(_store, saveKey) && _store[backupKey] === backupB);
  });

  _store[saveKey] = originalPrimary;
  delete _store[backupKey];
  delete _store[swapKey];
})();

console.log('熔炉烧炼');
var FS = V.FurnaceSys;
check('铁矿→铁锭', FS.resultId(9) === 108);
check('生猪排→熟猪排', FS.resultId(109) === 110);
check('生鸡肉→熟鸡肉', FS.resultId(111) === 112);
check('生兔肉→熟兔肉', FS.resultId(113) === 114);
check('沙子→玻璃', FS.resultId(6) === 13);
check('不可烧制返回 0', FS.resultId(3) === 0);
check('煤炭是燃料(40s)', FS.isFuel(107) && FS.fuelTime(107) === 40);
check('木板/木棍/原木是燃料', FS.isFuel(10) && FS.isFuel(100) && FS.isFuel(4));
check('石头不是燃料', !FS.isFuel(3));
(function () {
  // 完整烧制流程：2 铁矿 + 1 煤炭
  var fur = { type: 'furnace', in: { id: 9, n: 2 }, fuel: { id: 107, n: 1 }, out: null, burnT: 0, burnMax: 0, prog: 0 };
  FS.tickOne(fur, 1);
  check('点火消耗 1 煤炭且同刻开始烧制', fur.burnT > 38 && fur.burnMax === 40 && !fur.fuel && fur.prog === 1);
  FS.tickOne(fur, 4);   // 累计 t=5
  check('5 秒产出第 1 个铁锭', !!fur.out && fur.out.id === 108 && fur.out.n === 1 && fur.in.n === 1 && fur.prog === 0);
  FS.tickOne(fur, 4.9);
  check('未到时间不产出', fur.out.n === 1 && fur.prog > 4.5);
  FS.tickOne(fur, 0.2); // 累计 t=10.1
  check('产出第 2 个铁锭后原料耗尽', fur.out.n === 2 && !fur.in);
  var litAfter = FS.tickOne(fur, 30);
  check('无输入后燃尽（本 tick 耗尽余焰）', litAfter === true && fur.burnT === 0);
  check('下一 tick 已熄灭且进度回落', !FS.tickOne(fur, 1) && fur.burnT === 0 && fur.prog === 0);
  FS.tickOne(fur, 3);
  check('无输入不再点火', fur.burnT === 0 && !fur.fuel);
})();
(function () {
  var fur2 = { type: 'furnace', in: { id: 6, n: 1 }, fuel: { id: 107, n: 1 }, out: { id: 108, n: 64 }, burnT: 0, burnMax: 0, prog: 0 };
  FS.tickOne(fur2, 1);
  check('输出格被占用则不点火不推进', fur2.burnT === 0 && fur2.prog === 0 && !!fur2.fuel);
  var fur3 = { type: 'furnace', in: { id: 109, n: 3 }, fuel: { id: 100, n: 8 }, out: null, burnT: 0, burnMax: 0, prog: 0 };
  for (var i = 0; i < 16; i++) FS.tickOne(fur3, 0.5);   // 木棍燃料 2.5s：烧完 1 件后熄火
  check('木棍点燃可烧 1 件熟猪排', !!fur3.out && fur3.out.id === 110 && fur3.out.n >= 1);
})();
(function () {
  // 固定 60Hz 的 300 步在二进制浮点下会略小于 5；epsilon 必须让边界正常产出。
  var fixed = { type: 'furnace', in: { id: 9, n: 2 }, fuel: { id: 107, n: 1 }, out: null, burnT: 0, burnMax: 0, prog: 0 };
  for (var i = 0; i < 300; i++) FS.tickOne(fixed, 1 / 60);
  check('300×1/60 固定步恰好产出且浮点余量归零',
    !!fixed.out && fixed.out.id === 108 && fixed.out.n === 1 && fixed.in.n === 1 && fixed.prog === 0);

  var overshoot = { type: 'furnace', in: { id: 9, n: 2 }, fuel: null, out: null, burnT: 10, burnMax: 10, prog: 4.9 };
  FS.tickOne(overshoot, 0.2);
  check('烧制越界后保留合法进度余量且单 tick 只产一件',
    !!overshoot.out && overshoot.out.n === 1 && overshoot.in.n === 1 &&
    Math.abs(overshoot.prog - 0.1) < 1e-9);
})();

console.log('合成配方测试');
var Craft = V.Crafting;
function g9() { return [0, 0, 0, 0, 0, 0, 0, 0, 0]; }
check('配方数量=21', Craft.recipes.length === 21);

// 猫毛毡：无序配方 2×猫毛(121) → 猫毛毡方块(45)
g = g9(); g[0] = 121; g[4] = 121;
m = Craft.match(g);
check('2 猫毛 → 1 猫毛毡', !!m && m.result === 45 && m.count === 1 && m.shapeless);
g = g9(); g[0] = 121;
check('1 猫毛不可合成猫毛毡', Craft.match(g) === null);

g = g9(); g[0] = 4;
var m = Craft.match(g);
check('1 橡木 → 4 木板', !!m && m.result === 10 && m.count === 4);

g = g9(); g[3] = 20;
m = Craft.match(g);
check('1 云杉木 → 4 木板', !!m && m.result === 10 && m.count === 4);

g = g9(); g[8] = 22;
m = Craft.match(g);
check('1 丛林木 → 4 木板', !!m && m.result === 10 && m.count === 4);

g = g9(); g[0] = 33;
m = Craft.match(g);
check('1 白桦木 → 4 木板', !!m && m.result === 10 && m.count === 4);

g = g9(); g[0] = 35;
m = Craft.match(g);
check('1 金合欢木 → 4 木板', !!m && m.result === 10 && m.count === 4);

g = g9(); g[0] = 20; g[1] = 22;
check('2 不同原木不匹配', !Craft.match(g));

g = g9(); g[4] = 10; g[5] = 10; g[7] = 10; g[8] = 10; // 2x2 放右下角
m = Craft.match(g);
check('2x2 木板(右下角) → 工作台', !!m && m.result === 15 && m.count === 1);

g = g9(); g[1] = 10; g[2] = 10; g[4] = 10; g[5] = 10; // 2x2 放右上
check('2x2 木板(右上角) → 工作台', !!Craft.match(g) && Craft.match(g).result === 15);

g = g9(); g[0] = 16; g[1] = 16; g[2] = 16; g[3] = 10; g[4] = 10; g[5] = 10;
m = Craft.match(g);
check('3 羊毛+3 木板(上排/下排) → 床', !!m && m.result === 17 && m.count === 1);

g = g9(); g[0] = 10; g[1] = 10; g[2] = 10; g[3] = 16; g[4] = 16; g[5] = 16;
check('床配方颠倒不匹配', !Craft.match(g));

g = g9(); g[0] = 16; g[1] = 16; g[3] = 10; g[4] = 10; g[5] = 10;
check('2 羊毛不匹配', !Craft.match(g));

g = g9(); g[0] = 16; g[1] = 16; g[2] = 16; g[3] = 10; g[4] = 10; g[5] = 10; g[6] = 4;
check('格子有杂物不匹配', !Craft.match(g));

g = g9();
for (var gi = 0; gi < 9; gi++) if (gi !== 4) g[gi] = 3;
m = Craft.match(g);
check('8 石头环 → 熔炉', !!m && m.result === 37 && m.count === 1);

g = g9(); g[0] = 4;
m = Craft.match(g);
Craft.consume(g, m);
check('consume 清空无序配方', g.join() === '0,0,0,0,0,0,0,0,0');

g = g9(); g[0] = 16; g[1] = 16; g[2] = 16; g[3] = 10; g[4] = 10; g[5] = 10;
m = Craft.match(g);
Craft.consume(g, m);
check('consume 清空有方向配方', g.join() === '0,0,0,0,0,0,0,0,0');

g = g9(); g[4] = 10; g[5] = 10; g[7] = 10; g[8] = 10; // 2x2 在右下角
m = Craft.match(g);
check('偏移位置的配方返回 cells', !!m && m.cells.length === 4 && m.cells.join() === '4,5,7,8');
Craft.consume(g, m);
check('consume 清空偏移位置配方', g.join() === '0,0,0,0,0,0,0,0,0');

console.log('背包 2x2 合成测试');
var g4 = [4, 0, 0, 0];
m = Craft.matchIn(g4, 2);
check('2x2: 1 橡木 → 4 木板', !!m && m.result === 10 && m.count === 4 && m.cells.join() === '0');
Craft.consume(g4, m);
check('2x2: consume 清空', g4.join() === '0,0,0,0');

g4 = [10, 10, 10, 10];
m = Craft.matchIn(g4, 2);
check('2x2: 4 木板 → 工作台', !!m && m.result === 15 && m.count === 1);
Craft.consume(g4, m);
check('2x2: consume 清空(工作台)', g4.join() === '0,0,0,0');

g4 = [16, 16, 16, 10];
check('2x2: 床放不下(需 3 列)不匹配', !Craft.matchIn(g4, 2));

g4 = [4, 4, 0, 0];
check('2x2: 2 橡木不匹配', !Craft.matchIn(g4, 2));

console.log('一键合成(背包计数)测试');
var inv = new Array(36).fill(0);
inv[0] = 4; inv[1] = 4;
check('canCraftFromInv: 2 橡木可合成 2 次', Craft.canCraftFromInv(inv, Craft.recipes[0]) === 2);
check('consumeFromInv: 消耗 1 次', Craft.consumeFromInv(inv, Craft.recipes[0], 1) === true);
check('consumeFromInv: 剩 1 橡木', inv[0] === 0 && inv[1] === 4);
inv = new Array(36).fill(0);
inv[0] = 20; inv[1] = 22;
check('canCraftFromInv: 云杉/丛林木可合成 2 次', Craft.canCraftFromInv(inv, Craft.recipes[0]) === 2);
inv = new Array(36).fill(0);
inv[0] = 33; inv[1] = 35;
check('canCraftFromInv: 白桦/金合欢可合成 2 次', Craft.canCraftFromInv(inv, Craft.recipes[0]) === 2);
inv = new Array(36).fill(0);
inv[0] = 10; inv[1] = 10; inv[2] = 10;
check('canCraftFromInv: 3 木板不够工作台', Craft.canCraftFromInv(inv, Craft.recipes[1]) === 0);
inv[3] = 10;
check('canCraftFromInv: 4 木板可合成 1 次', Craft.canCraftFromInv(inv, Craft.recipes[1]) === 1);
inv = new Array(36).fill(0);
inv[0] = 16; inv[1] = 16; inv[2] = 16; inv[3] = 10; inv[4] = 10; inv[5] = 10;
check('canCraftFromInv: 床材料齐可合成 1 次', Craft.canCraftFromInv(inv, Craft.recipes[2]) === 1);
check('needed: 床 = 3 羊毛+3 木板', JSON.stringify(Craft.needed(Craft.recipes[2])) === JSON.stringify({ 16: 3, 10: 3 }));
check('needed: 工作台 = 4 木板', JSON.stringify(Craft.needed(Craft.recipes[1])) === JSON.stringify({ 10: 4 }));

console.log('工具与掉落');
check('煤矿掉落煤炭', V.Blocks.dropOf(8) === 107);
check('普通方块掉自身', V.Blocks.dropOf(1) === 1);
check('红沙掉自身', V.Blocks.dropOf(28) === 28);
check('浮冰掉自身', V.Blocks.dropOf(32) === 32);
check('木镐等级=1', V.Blocks.pickTier(101) === 1);
check('石镐等级=2', V.Blocks.pickTier(102) === 2);
check('徒手无镐', V.Blocks.pickTier(3) === 0);
check('铁剑伤害=6', V.Blocks.attackDmg(106) === 6);
check('徒手伤害=2', V.Blocks.attackDmg(3) === 2);
check('工具非固体(可放置性排除)', !V.Blocks.isSolid(101));
check('火把非固体但可挖', !V.Blocks.isSolid(19) && !!V.Blocks.defs[19].cross);
check('新方块定义完整(名称非?)',
  ['红沙', '陶瓦', '黄陶瓦', '棕陶瓦', '浮冰', '白桦木', '金合欢木'].every(function (nm) {
    for (var i = 1; i < 40; i++) if (V.Blocks.name(i) === nm) return true;
    return false;
  }));

g = g9(); g[0] = 10; g[1] = 10; g[2] = 10; g[4] = 100; g[7] = 100;
m = Craft.match(g);
check('木镐配方匹配', !!m && m.result === 101);
g = g9(); g[1] = 10; g[4] = 10; g[7] = 100;
m = Craft.match(g);
check('木剑配方匹配', !!m && m.result === 104);
g = g9(); g[0] = 3; g[1] = 3; g[2] = 3; g[4] = 100; g[7] = 100;
m = Craft.match(g);
check('石镐配方匹配', !!m && m.result === 102);
var invT = new Array(36).fill(0);
invT[0] = 107; invT[1] = 100;
check('火把=煤+木棍 可合成', Craft.canCraftFromInv(invT, Craft.recipes[4]) === 1);
Craft.consumeFromInv(invT, Craft.recipes[4], 1);
check('火把合成消耗后清空', invT.join() === new Array(36).fill(0).join());

console.log('触控摇杆数学');
load('js/ui/touch.js');
var TU = V.TouchUtil;
var a0 = TU.axes(0, 0, 66);
check('零输入归零', a0.x === 0 && a0.y === 0 && a0.mag === 0 && !a0.sprint);
var dzv = TU.axes(3, -4, 66);   // 长度 5 < 死区 7.92
check('死区内无输出', dzv.x === 0 && dzv.y === 0 && dzv.mag === 0 && !dzv.sprint);
var mid = TU.axes(0, -33, 66);  // 向前推半程
check('半程推动 mag=0.5 且不疾跑', Math.abs(mid.mag - 0.5) < 1e-9 &&
  Math.abs(mid.y - (-0.5)) < 1e-9 && Math.abs(mid.x) < 1e-9 && !mid.sprint);
var full = TU.axes(0, -200, 66); // 超出半径 → 限幅
check('超半径限幅为 1 并触发疾跑', full.y === -1 && full.mag === 1 && full.sprint);
var edge = TU.axes(66 * 0.93, 0, 66);
check('外圈阈值触发疾跑', edge.sprint && Math.abs(edge.x - 0.93) < 1e-9);
var justIn = TU.axes(66 * 0.90, 0, 66);
check('疾跑阈值内不误触', !justIn.sprint && Math.abs(justIn.x - 0.90) < 1e-9);
var diag = TU.axes(30, -40, 50); // 长度=半径：方向保持 (0.6,-0.8)
check('斜推方向保持', Math.abs(diag.x - 0.6) < 1e-9 &&
  Math.abs(diag.y + 0.8) < 1e-9 && diag.mag === 1 && diag.sprint);
var tiny = TU.axes(1, 1, 0);     // 半径非法防御
check('非法半径安全归零', tiny.mag === 0);

console.log('行星类型与空间站生成');
(function () {
  var arid = galA.catalog[1];
  V.World.init(arid.seed, arid);
  while (!V.World.isReady()) V.World.generateNext(64);
  var allowed = {};
  [V.Biomes.B.DESERT, V.Biomes.B.BADLANDS, V.Biomes.B.SAVANNA, V.Biomes.B.STONY_PEAKS].forEach(function (id) { allowed[id] = true; });
  var allArid = true;
  for (var x = 0; x < W; x += 7)
    for (var z = 0; z < D; z += 7)
      if (!allowed[V.World.biomeAt(x, z)]) allArid = false;
  check('荒漠星球实际约束为干旱群系集合', allArid && V.World.getProfile().typeKey === 'arid');
  var aridCoreExclusive = 0, aridWrongExclusive = 0;
  for (var ax = 0; ax < W; ax++) for (var az = 0; az < D; az++)
    for (var ay = 3; ay < H; ay++) {
      var aid = V.World.get(ax, ay, az);
      if (aid === 40) aridCoreExclusive++;
      else if (aid >= 39 && aid <= 44) aridWrongExclusive++;
    }
  check('v2有限核心生成且只生成荒漠专属硅晶矿',
    aridCoreExclusive > 0 && aridWrongExclusive === 0);
  var seamChanges = 0, aridOuterExclusive = 0, aridOuterWrong = 0;
  for (var az2 = 0; az2 < D; az2++) {
    if (V.World.biomeAt(W - 1, az2) !== V.World.biomeAt(W, az2)) seamChanges++;
    for (var ax2 = W; ax2 < W + V.Config.CHUNK; ax2++)
      for (var ay2 = 3; ay2 < H; ay2++) {
        var aid2 = V.World.get(ax2, ay2, az2);
        if (aid2 === 40) aridOuterExclusive++;
        else if (aid2 >= 39 && aid2 <= 44) aridOuterWrong++;
      }
  }
  check('v2无限外围共用规则且不泄漏其他行星矿',
    aridOuterExclusive > 0 && aridOuterWrong === 0);
  check('v2核心/255→256外围群系接缝跳变率<12%', seamChanges / D < 0.12);

  ['ocean-spawn-6', 'ocean-spawn-7'].forEach(function (spawnSeed) {
    var ocean = { id: 'spawn-' + spawnSeed, kind: 'planet', typeKey: 'oceanic', terrainVersion: 2 };
    V.World.init(spawnSeed, ocean);
    while (!V.World.isReady()) V.World.generateNext(64);
    var firstSpawn = V.World.spawnPoint(), secondSpawn = V.World.spawnPoint();
    var sx = Math.floor(firstSpawn.x), sy = Math.floor(firstSpawn.y), sz = Math.floor(firstSpawn.z);
    check(spawnSeed + '水下旧中心点改用确定性安全出生',
      V.World.get(sx, sy, sz) !== 7 && V.World.get(sx, sy + 1, sz) !== 7 &&
      !V.Blocks.isSolid(V.World.get(sx, sy, sz)) &&
      !V.Blocks.isSolid(V.World.get(sx, sy + 1, sz)) &&
      V.Blocks.isSolid(V.World.get(sx, sy - 1, sz)) &&
      firstSpawn.x === secondSpawn.x && firstSpawn.y === secondSpawn.y && firstSpawn.z === secondSpawn.z);
    if (spawnSeed === 'ocean-spawn-6') {
      V.World.set(sx, sy - 1, sz, 0);
      var relocated = V.World.spawnPoint();
      var rx = Math.floor(relocated.x), ry = Math.floor(relocated.y), rz = Math.floor(relocated.z);
      check('出生地板被挖后缓存失效并重新选择安全点',
        (relocated.x !== firstSpawn.x || relocated.y !== firstSpawn.y || relocated.z !== firstSpawn.z) &&
        V.World.get(rx, ry, rz) !== 7 && V.World.get(rx, ry + 1, rz) !== 7 &&
        V.Blocks.isSolid(V.World.get(rx, ry - 1, rz)));
    }
  });

  var stationWorld = galA.catalog[6];
  V.World.init(stationWorld.seed, stationWorld);
  while (!V.World.isReady()) V.World.generateNext(64);
  check('空间站中心生成可行走甲板', V.World.get(128, 23, 128) !== 0 && V.World.surfaceAt(128, 128) >= 23);
  check('空间站外围保持真空', V.World.get(20, 23, 20) === 0);
  check('空间站出生点位于甲板上方', V.World.spawnPoint().y > 24 && V.World.spawnPoint().y < 27);
  // 后续通用光照断言需要无其他人造光源的普通行星环境。
  V.World.init(12345);
  while (!V.World.isReady()) V.World.generateNext(64);
})();

console.log('性能预设');
var PP = V.Config.PERF_PRESETS;
check('预设三档齐全', !!PP.smooth && !!PP.balanced && !!PP.high);
check('流畅=30fps 低分辨率低密度', PP.smooth.fpsCap === 30 &&
  PP.smooth.res <= 0.6 && PP.smooth.particleDensity <= 0.5 && PP.smooth.mobDensity <= 0.5);
check('均衡=60fps 中配', PP.balanced.fpsCap === 60 && PP.balanced.res === 0.8 &&
  PP.balanced.rainDensity === 0.7);
check('高画质=原生满配', PP.high.fpsCap === 0 && PP.high.res === 1 &&
  PP.high.particleDensity === 1 && PP.high.mobDensity === 1);
(function () {
  var bad = [];
  ['smooth', 'balanced', 'high'].forEach(function (name) {
    for (var k in PP[name]) if (!(k in V.Settings.defaults)) bad.push(name + '.' + k);
  });
  check('预设键均在设置表内', bad.length === 0);
})();
check('桌面默认不限帧', V.Settings.defaults.fpsCap === 0);
check('触屏默认均衡档(60fps/降密度)', V.Settings.touchDefaults.fpsCap === 60 &&
  V.Settings.touchDefaults.res === 0.8);
check('渲染分辨率下限 0.35', V.Settings.limits.res[0] === 0.35);

console.log('光照系统');var tL0 = Date.now();
V.World.initLight();
console.log('  光照初始化耗时 ' + (Date.now() - tL0) + 'ms');
check('光照已就绪', V.World.lightReady());
var skyOK = false;
for (var lx = 8; lx < W - 8 && !skyOK; lx += 5)
  for (var lz = 8; lz < D - 8 && !skyOK; lz += 5) {
    var sy = V.World.surfaceAt(lx, lz);
    if (sy > 0 && V.World.get(lx, sy + 1, lz) === 0 && V.World.getSky(lx, sy + 1, lz) >= 14) skyOK = true;
  }
check('地表空气有天光', skyOK);
var spL = V.World.spawnPoint();
var bxL = Math.floor(spL.x), byL = Math.floor(spL.y + 1), bzL = Math.floor(spL.z);
V.World.set(bxL, byL, bzL, 19);
check('火把自身发光', V.World.getBlk(bxL, byL, bzL) >= 13);
check('火把照亮邻居', V.World.getBlk(bxL + 1, byL, bzL) >= 11);
check('火把光随距离衰减', V.World.getBlk(bxL + 5, byL, bzL) < V.World.getBlk(bxL + 1, byL, bzL));
check('移除火把后块光熄灭', (function () {
  V.World.set(bxL, byL, bzL, 0);
  return V.World.getBlk(bxL + 1, byL, bzL) === 0;
})());

console.log(failed === 0 ? '\n全部通过 ✓' : '\n' + failed + ' 项失败 ✗');
process.exit(failed === 0 ? 0 : 1);
