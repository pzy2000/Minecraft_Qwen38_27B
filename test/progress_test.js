// 成长系统（教程/成就/图鉴/进度持久化）测试：node test/progress_test.js
// 纯逻辑模块验证：计数器、首次获得、序列化往返、fail-closed 水合、
// 教程步进、成就触发与隐藏位、图鉴解锁判定。
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');

var sandbox = {
  window: {},
  console: console,
  Math: Math,
  Date: Date,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
};
sandbox.window = sandbox;
vm.createContext(sandbox);

function load(rel) {
  var code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

load('js/config.js');
load('js/world/biomes.js');
load('js/world/planet_rules.js');
load('js/blocks.js');
load('js/systems/discovery.js');   // 不被依赖，仅保证 Voxel 命名空间加载顺序贴近真实
load('js/systems/progress.js');
load('js/systems/tutorial.js');
load('js/systems/achievements.js');
load('js/ui/codex.js');

var P = sandbox.Voxel.Progress;
var Tutorial = sandbox.Voxel.Tutorial;
var Achievements = sandbox.Voxel.Achievements;
var Codex = sandbox.Voxel.Codex;

// 与 main.js 相同的接线：事件统一广播到教程与成就引擎
P.subscribe(function (t, d) {
  Tutorial.onEvent(t, d);
  Achievements.onEvent(t, d);
});

var failed = 0;
function check(name, cond) {
  if (cond) console.log('  ok  ' + name);
  else { console.log('  FAIL ' + name); failed++; }
}

// ---------- 计数器与首次获得 ----------
check('track mine 计入 dug', (function () {
  P.hydrate(null);
  P.track('mine', { id: 3 });
  P.track('mine', { id: 3 });
  return P.count('dug') === 2 && P.idCount('mine', 3) === 2;
})());

check('gain 记录 firsts 且 gain 幂等', (function () {
  P.hydrate(null);
  P.track('gain', { id: 107 });
  P.track('gain', { id: 107 });
  return P.first(107) === true && Object.keys(P.state().firsts).length === 1;
})());

check('craft/smelt 计数含数量', (function () {
  P.hydrate(null);
  P.track('craft', { id: 10, n: 4 });
  P.track('smelt', { id: 108, n: 1 });
  return P.idCount('craft', 10) === 4 && P.count('crafted') === 4 &&
    P.idCount('smelt', 108) === 1;
})());

check('kill/funa/biome/pet 计入', (function () {
  P.hydrate(null);
  P.track('kill', { type: 'zombie' });
  P.track('kill', { type: 'zombie' });
  P.track('fauna', { type: 'cat' });
  P.track('biome', { i: 4 });
  P.track('pet', { type: 'cat' });
  var s = P.state();
  return P.mobKills('zombie') === 2 && s.fauna.cat === true &&
    s.biomes['4'] === true && P.count('pets_cat') === 1;
})());

// ---------- 序列化与 fail-closed ----------
check('snapshot→hydrate 往返一致', (function () {
  P.hydrate(null);
  P.beginRun();
  P.track('mine', { id: 3 });
  P.track('craft', { id: 15, n: 1 });
  P.track('gain', { id: 17 });
  P.track('biome', { i: 7 });
  P.state().tut.step = 5;
  var snap = JSON.parse(JSON.stringify(P.snapshot()));
  var ok = P.hydrate(snap) === true;
  var s = P.state();
  return ok && s.tut.started === true && s.tut.step === 5 &&
    P.first(17) && P.idCount('craft', 15) === 1;
})());

check('损坏存档 fail-closed 回落空态', (function () {
  var bad = { v: 99, c: 'not-a-map', tut: { started: 'x' } };
  P.hydrate(bad);
  var s = P.state();
  var okEmpty = Object.keys(s.c).length === 0 && s.tut.started === false;
  var okMissing = P.hydrate(undefined) === false && Object.keys(P.state().firsts).length === 0;
  // 任意键注入不迁移
  var hostile = JSON.stringify({ v: 1, c: { __proto__: {} }, firsts: { '../../etc': true, ok1: true } });
  P.hydrate(JSON.parse(hostile));
  var leaked = !P.state().firsts['../../etc'] && P.state().firsts.ok1 === true;
  return okEmpty && okMissing && leaked;
})());

// ---------- 教程步进 ----------
check('beginRun 自动开启教程并按链推进', (function () {
  P.hydrate(null);
  P.beginRun();
  check('初始步为移动 (0)', Tutorial.currentStep() === 0);
  P.track('move', { meters: 6 });
  check('移动≥6m 完成 step0 → step1', Tutorial.currentStep() === 1);
  P.track('mine', { id: 4 });                       // 橡木
  check('采原木完成 → step2 木板', Tutorial.currentStep() === 2);
  P.track('craft', { id: 10, n: 2 });               // 数量不足
  P.track('craft', { id: 10, n: 2 });
  check('木板累计×4 完成 → step3 工作台', Tutorial.currentStep() === 3);
  P.track('craft', { id: 15, n: 1 });
  P.track('place', { placedId: 15 });
  P.track('use_block', { id: 15 });
  P.track('craft', { id: 101, n: 1 });
  P.track('mine', { id: 11 });
  P.track('mine', { id: 11 });
  P.track('mine', { id: 11 });
  P.track('place', { placedId: 37 });
  P.track('smelt', { id: 108, n: 1 });
  check('走到毕业步（登舰）前共完成 10 步', Tutorial.currentStep() === 10);
  P.track('board', {});
  check('登舰后 done=true', P.state().tut.done === true && Tutorial.currentStep() === -1);
  return true;
})());

check('未开启时不推进；skip 可跳过', (function () {
  P.hydrate(null);   // 未 beginRun（模拟老档）
  P.track('move', { meters: 20 });
  check('老档默认不开教程', Tutorial.currentStep() === -1 &&
    P.state().tut.started === false);
  Tutorial.restart();
  check('restart 后回到 step0', Tutorial.currentStep() === 0);
  Tutorial.skip();
  check('skip 后 done', P.state().tut.done === true);
  return true;
})());

// ---------- 成就 ----------
// v7 新增隐藏成就 h_park_all，总数 52→53
check('53 个成就定义且 id 唯一', (function () {
  var ids = {};
  var dup = false;
  for (var i = 0; i < Achievements.defs.length; i++) {
    var d = Achievements.defs[i];
    if (ids[d.id]) dup = true;
    ids[d.id] = 1;
  }
  return Achievements.defs.length === 53 && !dup;
})());

check('事件驱动成就即时解锁（煤矿大亨进度型）', (function () {
  P.hydrate(null);
  Achievements.onEvent('__reset__', {});
  P.state().ach = {};   // 清空已解锁位，重测
  for (var i = 0; i < 64; i++) P.track('mine', { id: 8 });
  var def = null;
  for (var k = 0; k < Achievements.defs.length; k++)
    if (Achievements.defs[k].id === 'coal64') def = Achievements.defs[k];
  return Achievements.isUnlocked(def);
})());

check('条件型成就：铁器时代', (function () {
  P.hydrate(null);
  P.state().ach = {};
  P.track('gain', { id: 108 });
  var found = false;
  for (var i = 0; i < Achievements.defs.length; i++)
    if (Achievements.defs[i].id === 'iron_ingot')
      found = Achievements.isUnlocked(Achievements.defs[i]);
  return found;
})());

check('隐藏成就在解锁前列表仍存在但标记 secret', (function () {
  P.hydrate(null);
  P.state().ach = {};
  var h = null;
  for (var i = 0; i < Achievements.defs.length; i++)
    if (Achievements.defs[i].id === 'h_env_death') h = Achievements.defs[i];
  return h && h.hidden === true && !Achievements.isUnlocked(h);
})());

check('环境死亡触发隐藏成就', (function () {
  P.hydrate(null);
  P.state().ach = {};
  P.track('death', { cause: 'toxic' });
  var h = null;
  for (var i = 0; i < Achievements.defs.length; i++)
    if (Achievements.defs[i].id === 'h_env_death') h = Achievements.defs[i];
  return Achievements.isUnlocked(h);
})());

check(' totalOf 分类统计与全量一致', (function () {
  var all = Achievements.totalOf(null);
  var sum = 0;
  for (var i = 0; i < Achievements.cats.length; i++)
    sum += Achievements.totalOf(Achievements.cats[i].key).all;
  return all.all === sum;
})());

// ---------- 图鉴逻辑 ----------
check('zoo 成就不再在第 6 种提前完成', (function () {
  P.hydrate(null);
  P.state().ach = {};
  Achievements.onEvent('__reset__', {});
  var kinds = ['sheep', 'pig', 'chicken', 'rabbit', 'cat', 'zombie'];
  for (var i = 0; i < kinds.length; i++) P.track('fauna', { type: kinds[i] });
  var zoo = null;
  for (var j = 0; j < Achievements.defs.length; j++)
    if (Achievements.defs[j].id === 'zoo') zoo = Achievements.defs[j];
  var n = sandbox.Voxel.PlanetRules.faunaCatalog().length;
  return zoo && !Achievements.isUnlocked(zoo) && P.faunaSet() === 6 && n > 6;
})());

check('图鉴生物档案与 PlanetRules 目录同源', (function () {
  var cat = sandbox.Voxel.PlanetRules.faunaCatalog();
  if (Codex.FAUNA.length !== cat.length || cat.length < 21) return false;
  for (var i = 0; i < cat.length; i++) {
    var hit = false;
    for (var j = 0; j < Codex.FAUNA.length; j++)
      if (Codex.FAUNA[j].type === cat[i].type) hit = true;
    if (!hit) return false;
  }
  return true;
})());

check('图鉴物品条目覆盖注册表并排除无效项', (function () {
  var defs = sandbox.Voxel.Blocks.defs;
  var ORE = { 8: 1, 9: 1, 39: 1, 40: 1, 41: 1, 42: 1, 43: 1, 44: 1,
    115: 1, 116: 1, 117: 1, 118: 1, 119: 1, 120: 1, 200: 1 };
  var FUNC = { 15: 1, 17: 1, 19: 1, 37: 1, 38: 1, 67: 1, 68: 1, 69: 1, 70: 1, 71: 1,
    141: 1, 149: 1, 157: 1, 165: 1, 173: 1, 181: 1, 189: 1,
    197: 1, 198: 1, 199: 1, 221: 1, 222: 1,
    201: 1, 202: 1, 203: 1, 204: 1, 205: 1, 206: 1, 207: 1, 208: 1,
    209: 1, 210: 1, 211: 1, 212: 1, 213: 1, 214: 1 };
  var MAT = [100, 107, 108, 121, 122, 123, 124, 125, 132, 133, 135,
    220, 239, 240];
  var LOGS = [4, 20, 22, 33, 35, 46, 52, 57];
  var LEAVES = [5, 21, 23, 34, 36, 58, 59];
  var PLANTS = [26, 47, 55, 56, 54, 223];
  var manualCount = 0;
  for (var i = 1; i < defs.length; i++) {
    var d = defs[i];
    if (!d) continue;
    // 与 Codex.classify 同口径（v8：锄头计工具、染料计材料、作物/花计植物、
    // 染色变体与建造方块计入自然方块组）
    var isMat = MAT.indexOf(i) >= 0 || (i >= 260 && i <= 275);
    var isPlant = LEAVES.indexOf(i) >= 0 || PLANTS.indexOf(i) >= 0 ||
      (i >= 224 && i <= 238) || (i >= 251 && i <= 258);
    var isBuild = (i >= 280 && i <= 295) || (i >= 300 && i <= 315) ||
      (i >= 320 && i <= 335) || (i >= 340 && i <= 363);
    if ((d.tool === 'pick' || d.tool === 'sword' || d.hoeTool) || d.food || ORE[i] ||
      isMat || FUNC[i] || LOGS.indexOf(i) >= 0 || isPlant ||
      isBuild || d.solid || i === 7) manualCount++;
  }
  return Codex.countItems() === manualCount && manualCount > 60;
})());

console.log(failed === 0
  ? '\n成长系统测试全部通过 ✓'
  : '\n' + failed + ' 项失败 ✗');
process.exit(failed === 0 ? 0 : 1);
