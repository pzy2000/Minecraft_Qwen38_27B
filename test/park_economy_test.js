// 票券经济纯逻辑测试：代币产出/兑换扣减/加速 buff 语义（Node 环境无 DOM/GL）
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = global;
global.performance = { now: () => Date.now() };
const THREE = require(path.join(ROOT, 'vendor/three.min.js'));
global.THREE = THREE;

require(path.join(ROOT, 'js/config.js'));
require(path.join(ROOT, 'js/world/seed.js'));
require(path.join(ROOT, 'js/world/universe.js'));
require(path.join(ROOT, 'js/world/galaxy.js'));
require(path.join(ROOT, 'js/systems/atmosphere_profiles.js'));
require(path.join(ROOT, 'js/world/noise.js'));
require(path.join(ROOT, 'js/world/biomes.js'));
require(path.join(ROOT, 'js/world/planet_rules.js'));
require(path.join(ROOT, 'js/world/shaper.js'));
require(path.join(ROOT, 'js/world/gen_core.js'));
require(path.join(ROOT, 'js/world/structures.js'));
require(path.join(ROOT, 'js/blocks.js'));
require(path.join(ROOT, 'js/systems/amusement.js'));

const S = Voxel.Structures;
const B = Voxel.Blocks;

// ---- 1. 物品注册：132 代币 / 133 烟花棒 ----
const tok = B.defs[132], rod = B.defs[133];
assert.ok(tok && tok.item && !tok.solid, '132 是非方块物品');
assert.strictEqual(tok.name, '乐园代币');
assert.strictEqual(tok.maxStack, 99, '代币可堆叠 99');
assert.ok(rod && rod.item, '133 是物品');
assert.strictEqual(rod.name, '烟花棒');
assert.strictEqual(rod.maxStack, 16, '烟花棒堆叠 16');
assert.ok(tok.icon !== undefined && rod.icon !== undefined, '两物品都有图标贴片');

// ---- 2. 园区宝箱必出代币 3-6 枚 ----
// 与 structures_test 相同的纯 Node ctx（hash2/surfaceAt/biomeAt/typeKey）
const noise = Voxel.Noise.create('987654321');
Voxel.Structures.bind({
  hash2: noise.hash2,
  surfaceAt: function () { return 34; },
  biomeAt: function () { return Voxel.Biomes.B.PLAYGROUND; },  // 锚点必须是嘉年华群系
  typeKey: 'toxic',
  version: 2
});
let park = null;
for (let cx = 0; cx < 4 && !park; cx++)
  for (let cz = 0; cz < 4 && !park; cz++) park = S.cellPark(cx, cz);
assert.ok(park, '确定性网格扫描命中园区');
const items = S.parkLootFor(park, 0);
assert.ok(items, '园区宝箱战利品生成');
const tokenStacks = items.filter(s => s && s.id === 132);
assert.strictEqual(tokenStacks.length, 1, '恰好一组代币');
assert.ok(tokenStacks[0].n >= 3 && tokenStacks[0].n <= 6, '代币数量 3-6（实际 ' + tokenStacks[0].n + '）');

// ---- 3. 售票亭交互点暴露 + 确定性 ----
const booths = S.parkBooths(park);
assert.strictEqual(booths.length, 2, '左右两个售票亭');
booths.forEach(b => {
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.z), '售票亭坐标有限');
  assert.ok(Math.abs(b.y - park.ah) <= 3, '售票亭在园区地表面');
});
const booths2 = S.parkBooths(park);
assert.deepStrictEqual(booths, booths2, '售票亭坐标确定性');

// ---- 4. 加速模式：Amusement 时钟语义（速度倍率钳制） ----
// 无 GL/DOM 环境下 Amusement 的 setSpeedMul 钳制与 speedMul 读回
const A = Voxel.Amusement;
assert.ok(A && A.setSpeedMul && A.speedMul, 'Amusement 暴露速度倍率 API');
assert.strictEqual(A.speedMul(), 1, '默认常速');
A.setSpeedMul(1.6);
assert.strictEqual(A.speedMul(), 1.6, '可设 1.6 倍速');
A.setSpeedMul(99);
assert.ok(A.speedMul() <= 4, '倍率上限钳制 4');
A.setSpeedMul(0.01);
assert.ok(A.speedMul() >= 0.25, '倍率下限钳制 0.25');
A.setSpeedMul(1);
assert.strictEqual(A.speedMul(), 1, '恢复常速');

// ---- 5. 兑换价格常量一致性（面板文案与扣减同源） ----
// 直接读 main.js 源码中的常量声明，防两边漂移
const mainSrc = require('fs').readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
assert.ok(/var COST_SPEED = 5, COST_ROD = 3, BUFF_S = 90, SPEED_MUL = 1\.6;/.test(mainSrc),
  '兑换常量：加速5/烟花棒3/90s/1.6x');
assert.ok(mainSrc.indexOf('invDec(TOKEN_ID, COST_SPEED)') > 0, '加速购买走代币扣减');
assert.ok(mainSrc.indexOf('invDec(TOKEN_ID, COST_ROD)') > 0, '烟花棒购买走代币扣减');
assert.ok(mainSrc.indexOf('inv[sel] === FW_ROD_ID') > 0, '右键使用校验手持烟花棒');
assert.ok(mainSrc.indexOf("id: 'overlay-booth'") > 0, '面板走统一模态栈');
const idxHtml = require('fs').readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const boothIdx = idxHtml.indexOf('id="overlay-booth"');
assert.ok(boothIdx > 0, 'index.html 有售票亭面板');
assert.ok(idxHtml.indexOf('id="booth-buff"') > 0, 'index.html 有加速 buff 角标');
assert.ok(/role="dialog"/.test(idxHtml.slice(boothIdx - 100, boothIdx + 400)),
  '售票亭面板具备 dialog 语义');

console.log('PARK-ECONOMY-PASS');
