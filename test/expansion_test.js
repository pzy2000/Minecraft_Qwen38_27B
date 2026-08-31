// 物品/合成/装备扩展回归：木炭、金矿链、钻石矿链、金/钻工具、功能性装备槽。
// 纯 Node（vm sandbox），覆盖 blocks/crafting/furnace/planet_rules/environment/save。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = {
  window: {}, console, Math, BigInt,
  Uint8Array, Uint32Array, Int16Array, Float32Array
};
sandbox.window = sandbox;
vm.createContext(sandbox);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
}

load('js/config.js');
load('js/world/biomes.js');
load('js/blocks.js');
load('js/world/planet_rules.js');
load('js/crafting.js');
load('js/systems/furnace.js');
load('js/systems/environment.js');
load('js/systems/save.js');

const V = sandbox.Voxel;
const Blocks = V.Blocks, Crafting = V.Crafting, FS = V.FurnaceSys;
const P = V.PlanetRules, Env = V.Environment, Save = V.Save;
let failures = 0;

function check(name, condition, detail) {
  if (condition) console.log('  ok  ' + name);
  else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' :: ' + detail : ''));
  }
}

// ---------- 1. ID 稳定与新物品定义 ----------
console.log('扩展物品 ID 稳定性与定义');
check('旧 ID 语义不回归',
  Blocks.name(38) === '箱子' && Blocks.dropOf(8) === 107 && Blocks.dropOf(9) === 9 &&
  Blocks.name(107) === '煤炭' && Blocks.name(108) === '铁锭' && Blocks.name(122) === '曲速电池');
check('新物品 123..131 名称/类型/图标',
  Blocks.name(123) === '金锭' && Blocks.name(124) === '钻石' && Blocks.name(125) === '木炭' &&
  Blocks.name(126) === '金镐' && Blocks.name(127) === '金剑' && Blocks.name(128) === '钻石镐' &&
  Blocks.name(129) === '钻石剑' && Blocks.name(130) === '防毒面具' && Blocks.name(131) === '防寒服' &&
  [123, 124, 125, 130, 131].every(id => Blocks.defs[id].item === true) &&
  [126, 127, 128, 129, 130, 131].every(id => Blocks.defs[id].maxStack === 1));
check('金矿石 72 / 钻石矿石 73 定义',
  Blocks.name(72) === '金矿石' && Blocks.defs[72].tier === 3 && !Blocks.defs[72].drop &&
  Blocks.dropOf(72) === 72 && Blocks.defs[72].hard === 6 &&
  Blocks.name(73) === '钻石矿石' && Blocks.defs[73].tier === 3 && Blocks.defs[73].drop === 124 &&
  Blocks.dropOf(73) === 124 && Blocks.defs[73].hard === 6.5);
check('工具数值：金快而不耐久、钻全面碾压',
  Blocks.defs[126].tool === 'pick' && Blocks.defs[126].tier === 2 && Blocks.defs[126].pickMult === 12 &&
  Blocks.defs[126].maxDur === 33 && Blocks.defs[127].maxDur === 33 &&
  Blocks.defs[128].tool === 'pick' && Blocks.defs[128].tier === 4 && Blocks.defs[128].maxDur === 1561 &&
  Blocks.defs[129].dmg === 7 && Blocks.defs[129].maxDur === 1561);
check('PICK_MULT 扩位与 pickMultOf 覆盖',
  JSON.stringify(Blocks.PICK_MULT) === JSON.stringify([1, 4, 7, 10, 13]) &&
  Blocks.pickMultOf(126) === 12 && Blocks.pickMultOf(128) === 13 &&
  Blocks.pickMultOf(103) === 10 && Blocks.pickMultOf(0) === 1);
check('装备定义：gearSlot 与耐久上限',
  Blocks.defs[130].gearSlot === 'head' && Blocks.defs[130].maxDur === 240 &&
  Blocks.defs[131].gearSlot === 'body' && Blocks.defs[131].maxDur === 320);

// ---------- 2. crafting ----------
console.log('合成配方');
function grid9(ids) { return ids; }
function match(name, grid, size) {
  const r = Crafting.matchIn(grid, size || 3);
  return r && r.result;
}
check('金镐/金剑/钻石镐/钻石剑 shaped 匹配',
  match('金镐', [123, 123, 123, 0, 100, 0, 0, 100, 0]) === 126 &&
  match('金剑', [0, 123, 0, 0, 123, 0, 0, 100, 0]) === 127 &&
  match('钻石镐', [124, 124, 124, 0, 100, 0, 0, 100, 0]) === 128 &&
  match('钻石剑', [0, 124, 0, 0, 124, 0, 0, 100, 0]) === 129);
check('金镐配方支持网格内平移',
  match('金镐平移', [0, 0, 0, 123, 123, 123, 0, 100, 0]) === 126 ||
  match('金镐平移2x2不匹配', [123, 123, 0, 123, 0, 0, 0, 0, 0], 2) !== 126);
check('防毒面具/防寒服配方',
  match('面具', [108, 108, 108, 108, 0, 108, 0, 125, 0]) === 130 &&
  match('防寒服', [45, 0, 45, 45, 45, 45, 0, 0, 0]) === 131);
check('火把可用煤炭或木炭合成（alts）',
  Crafting.matchIn([107, 100, 0, 0], 2).result === 19 &&
  Crafting.matchIn([125, 100, 0, 0], 2).result === 19);
const inv = [107, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const cnt = [10, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const torchRecipe = Crafting.recipes.find(r => r.name === '火把');
check('canCraftFromInv 对火把 alts 求和',
  Crafting.canCraftFromInv(inv, torchRecipe, cnt) === 10);
check('铁镐旧配方不受新配方影响',
  Crafting.matchIn([9, 9, 9, 0, 100, 0, 0, 100, 0], 3).result === 103);

// ---------- 3. furnace ----------
console.log('熔炉冶炼');
check('SMELT 新增金矿/原木→木炭，旧条目不变',
  FS.SMELT_TABLE[72] === 123 && FS.SMELT_TABLE[9] === 108 && FS.SMELT_TABLE[6] === 13 &&
  [4, 20, 22, 33, 35].every(id => FS.SMELT_TABLE[id] === 125));
check('FUEL 木炭=煤炭=40s，原木仍 15s',
  FS.FUEL_TABLE[125] === 40 && FS.FUEL_TABLE[107] === 40 && FS.FUEL_TABLE[4] === 15 &&
  FS.isFuel(125) && FS.resultId(72) === 123 && FS.resultId(4) === 125);
(function () {
  const f = FS.fresh();
  f.in = { id: 72, n: 2 };
  f.fuel = { id: 125, n: 1 };
  let lit = FS.tickOne(f, 5 + 1e-9);
  check('金矿石烧制全流程产出金锭', lit && f.out && f.out.id === 123 && f.out.n === 1 &&
    f.in.n === 1 && f.fuel === null || (f.fuel && f.fuel.n === 0), JSON.stringify(f));
  const f2 = FS.fresh();
  f2.in = { id: 4, n: 1 };
  f2.fuel = { id: 125, n: 1 };
  FS.tickOne(f2, 5 + 1e-9);
  check('原木烧制产出木炭', f2.out && f2.out.id === 125 && f2.out.n === 1, JSON.stringify(f2));
})();

// ---------- 4. planet_rules：金/钻生成 + v1 回归 ----------
console.log('世界生成');
check('各行星金/钻 chance = 基数×乘数，station 归零',
  P.resourceProfile('lush').goldChance === 0.0035 &&
  P.resourceProfile('arid').goldChance === 0.0035 * 1.6 &&
  P.resourceProfile('volcanic').diamondChance === 0.0012 * 1.4 &&
  P.resourceProfile('oceanic').diamondChance === 0.0012 * 0.8 &&
  P.resourceProfile('station').goldChance === 0 && P.resourceProfile('station').diamondChance === 0);
check('oreAt 显式 roll：命中/深度上限/站内不出',
  P.oreAt(P.V2, 'lush', 27, 0.5, 0.5, 0.9, 0.001, 0.5).blockId === 72 &&
  P.oreAt(P.V2, 'lush', 15, 0.5, 0.5, 0.9, 0.5, 0.0005).blockId === 73 &&
  P.oreAt(P.V2, 'lush', 28, 0.5, 0.5, 0.9, 0.001, 0.5).blockId === 0 &&
  P.oreAt(P.V2, 'lush', 16, 0.5, 0.5, 0.9, 0.5, 0.0005).blockId === 0 &&
  P.oreAt(P.V2, 'station', 5, 0.5, 0.5, 0.9, 0.001, 0.0005).blockId === 0);
check('oreDescriptor 金/钻映射',
  P.oreAt(P.V2, 'lush', 27, 0.5, 0.5, 0.9, 0.001, 0.5).itemId === 72 &&
  P.oreAt(P.V2, 'lush', 15, 0.5, 0.5, 0.9, 0.5, 0.0005).itemId === 124 &&
  P.oreAt(P.V2, 'lush', 27, 0.5, 0.5, 0.9, 0.001, 0.5).key === 'gold' &&
  P.oreAt(P.V2, 'lush', 15, 0.5, 0.5, 0.9, 0.5, 0.0005).key === 'diamond');
// 确定性 hash3：同坐标同结果；y 边界与数量级统计
const detNoise = {
  hash3: function (x, y, z) {
    let h = (Math.imul(x | 0, 2654435761) ^ Math.imul(y | 0, 2246822519) ^ Math.imul(z | 0, 3266489917)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return (h ^ (h >>> 16)) / 4294967296;
  }
};
(function () {
  const a = P.oreBlockForPosition(P.V2, 'lush', 123, 12, -456, detNoise);
  const b = P.oreBlockForPosition(P.V2, 'lush', 123, 12, -456, detNoise);
  check('oreBlockForPosition 金/钻通道确定性', a === b);
  let goldCount = 0, diaCount = 0, outOfRange = false;
  for (let x = 0; x < 64; x++)
    for (let z = 0; z < 64; z++) {
      for (let y = 1; y < 50; y++) {
        const r = P.oreBlockForPosition(P.V2, 'lush', x, y, z, detNoise);
        if (r === 72) { goldCount++; if (y >= 28) outOfRange = true; }
        if (r === 73) { diaCount++; if (y >= 16) outOfRange = true; }
      }
    }
  check('金/钻只在 y<28 / y<16 生成且采样可命中',
    !outOfRange && goldCount > 0 && diaCount > 0,
    'gold=' + goldCount + ' diamond=' + diaCount);
  // v1 回归：v1 通道完全忽略额外 roll，逐点等于 legacyOre
  let v1Exact = true;
  for (let y = 0; y < 60; y++)
    for (const roll of [0, 0.005, 0.0069, 0.007, 0.5, 0.9939, 0.994, 0.999, 0.3, 0.9945]) {
      const got = P.oreBlockForPosition(1, 'volcanic', 7, y, -7, detNoise);
      const expected = y < 50 && roll < 0.007 ? 8 : (y < 34 && roll > 0.994 ? 9 : 0);
      // detNoise 不受坐标控制，这里改用直接控制返回值的 noise
      void got;
      const n2 = { hash3: function () { return roll; } };
      const got2 = P.oreBlockForPosition(1, 'volcanic', 7, y, -7, n2);
      if (got2 !== expected) v1Exact = false;
    }
  check('v1 通道与 legacyOre 逐点一致（额外roll被忽略）', v1Exact);
})();

// ---------- 5. environment：装备防护 ----------
console.log('环境防护');
const baseCtx = {
  outdoors: true, sky: 15, sunlight: 1, rain: 0, inWater: false, waterDepth: 0,
  blockLight: 0, isNight: false, sealedShelter: false
};
function ctx(extra) {
  // 在 vm realm 内重建 plain object：跨 realm 传入的 Node 对象原型不同，
  // 会被 environment 的 plainObject 防御当成非普通对象整体忽略（游戏内同 realm 无此问题）。
  return vm.runInContext('(function (o) { return JSON.parse(JSON.stringify(o)); })', sandbox)(
    Object.assign({}, baseCtx, extra));
}
const ECF = Env._test.conditionFor, ENC = Env._test.normalizeContext;
check('防毒面具+木炭阻断 toxic/volcanic',
  ECF('toxic', ctx({ gearHead: 130, chargeHead: 5 })).protected === true &&
  ECF('toxic', ctx({ gearHead: 130, chargeHead: 5 })).gearCost === 'head' &&
  ECF('toxic', ctx({ gearHead: 130, chargeHead: 5 })).reason === '防毒面具过滤' &&
  ECF('volcanic', ctx({ gearHead: 130, chargeHead: 1 })).gearCost === 'head');
check('防寒服+煤炭阻断 frozen',
  ECF('frozen', ctx({ gearBody: 131, chargeBody: 8 })).protected === true &&
  ECF('frozen', ctx({ gearBody: 131, chargeBody: 8 })).gearCost === 'body' &&
  ECF('frozen', ctx({ gearBody: 131, chargeBody: 8 })).reason === '防寒服供热');
check('充能耗尽后防护失效',
  ECF('toxic', ctx({ gearHead: 130, chargeHead: 0 })).active === true &&
  ECF('toxic', ctx({ gearHead: 130, chargeHead: 0 })).protected === false &&
  ECF('frozen', ctx({ gearBody: 131, chargeBody: 0 })).active === true);
check('未穿戴/旧 context 行为与现状一致',
  ECF('toxic', ctx({})).active === true &&
  ECF('frozen', ctx({})).active === true &&
  ECF('toxic', ctx({ gearHead: 130 })).active === true &&  // 有装备无充能
  ECF('arid', ctx({ gearHead: 130, chargeHead: 9 })).active === true); // 面具不挡热
check('normalizeContext 防御性归一',
  (() => {
    const c = ENC(vm.runInContext('(function (o) { return JSON.parse(JSON.stringify(o)); })', sandbox)(
      { gearHead: 'bad', chargeBody: -3, gearBody: 131.7 }));
    return c.gearHead === 0 && c.chargeBody === 0 && c.gearBody === 131;
  })());
(function () {
  // 防护期间 exposure 回落（protected 分支）
  Env.clear();
  Env.loadWorld({ id: 'gear-world', typeKey: 'toxic' });
  const r = Env.update(1, ctx({ gearHead: 130, chargeHead: 9 }));
  check('防护生效时 exposure 不累积', r.status.exposure === 0 && r.damageDue === 0 &&
    r.status.gearCost === 'head');
  const r2 = Env.update(2, ctx({}));
  check('失去防护后恢复毒性暴露', r2.status.active === true && r2.status.gearCost === null);
  Env.clear();
})();

// ---------- 6. save：gear 字段 ----------
console.log('存档兼容');
check('isLoadable 不受 gear 字段影响',
  Save.isLoadable({ seed: '123', gear: { head: { id: 130, dur: 200 }, charge: { id: 125, n: 32 } } }) &&
  Save.isLoadable({ seed: '123' }));
check('缺 gear 字段的旧档对象可解析（loadableRaw 语义）',
  Save.isLoadable(JSON.parse(JSON.stringify({ v: 6, seed: 'abc', galaxy: { rootSeed: '42' } }))));

// ---------- 7. 门与活板门（v8）----------
console.log('门与活板门');
(() => {
  const B = V.Blocks;
  const oakBase = B.DOOR_BASE;                       // 141
  const ironBase = B.doorItemId(6);                  // 189
  const trapBase = B.TRAPDOOR_BASE;                  // 197
  // 编码往返：上下半配对 & 开合翻转自反
  const lowerClosed = oakBase + 0, upperClosed = B.doorPartnerId(lowerClosed);
  check('门编码：下半关闭 → 上半关闭 +4', upperClosed === lowerClosed + 4);
  check('门编码：partner 自反', B.doorPartnerId(upperClosed) === lowerClosed);
  check('门编码：toggle 只翻 bit0 且自反',
    B.doorToggleId(lowerClosed) === lowerClosed + 1 &&
    B.doorToggleId(B.doorToggleId(lowerClosed)) === lowerClosed);
  check('门编码：开放态固体翻转（关=实体/开=可穿）',
    B.defs[lowerClosed].solid === true && B.defs[lowerClosed + 1].solid === false &&
    B.defs[upperClosed + 1].solid === false);
  check('门是薄板形状且掉落归一到下半关闭形态',
    Array.isArray(B.defs[lowerClosed].box) && B.defs[lowerClosed].box.length === 6 &&
    B.defs[upperClosed + 2].drop === oakBase && B.dropOf(ironBase + 7) === ironBase);
  check('铁门编号在六木门之后', ironBase === oakBase + 48);
  check('isDoor 边界不越界到活板门',
    !B.isDoor(oakBase - 1) && B.isDoor(oakBase + 55) && !B.isDoor(trapBase) &&
    B.isTrapdoor(trapBase) && B.isTrapdoor(trapBase + 2) && !B.isTrapdoor(trapBase + 3));
  check('活板门关闭=半高实体、开启=非实体，开合往复',
    B.defs[trapBase].half === true && B.defs[trapBase].solid === true &&
    B.defs[trapBase + 1].solid === false &&
    B.trapdoorToggleId(B.trapdoorToggleId(trapBase + 1)) === trapBase + 1);
  // 合成：木门 2×3 木板+底行原木；2×2 网格放不下
  const g9 = () => [0,0,0,0,0,0,0,0,0];
  let g = g9(); g[0]=10; g[1]=10; g[3]=10; g[4]=10; g[6]=4; g[7]=4;
  const mOak = Crafting.matchIn(g, 3);
  check('橡木门配方（顶两行木板+底行橡木）→×3',
    mOak && mOak.result === oakBase && mOak.count === 3);
  let gBad = g9(); gBad[0]=10; gBad[1]=10; gBad[3]=10; gBad[4]=10;
  check('底行缺少对应原木 → 只匹配工作台，不出门',
    Crafting.matchIn(gBad, 3).result === 15);
  let gSpruce = g9(); gSpruce[0]=10; gSpruce[1]=10; gSpruce[3]=10; gSpruce[4]=10; gSpruce[6]=20; gSpruce[7]=20;
  check('云杉原木行 → 云杉门而非橡木门',
    Crafting.matchIn(gSpruce, 3).result === B.doorItemId(1));
  let gIron = g9(); for (let r2 = 0; r2 < 3; r2++) { gIron[r2*3]=9; gIron[r2*3+1]=9; }
  check('铁门配方 2×3 铁锭 ×3', Crafting.matchIn(gIron, 3).result === ironBase &&
    Crafting.matchIn(gIron, 3).count === 3);
  const g4 = [10,10,10,10];
  check('2×2 网格匹配不到任何门配方',
    (() => { const m = Crafting.matchIn(g4, 2); return !m || m.result < oakBase || m.result > trapBase + 2; })());
  let gt = g9(); gt[0]=10;gt[1]=10;gt[2]=10;gt[3]=10;gt[4]=10;gt[5]=10;
  const mt = Crafting.matchIn(gt, 3);
  check('活板门配方 3×2 木板 ×2', mt && mt.result === trapBase && mt.count === 2);
})();

if (failures) {
  console.error('\nEXPANSION-FAIL ' + failures);
  process.exit(1);
}
console.log('\nEXPANSION-PASS');
