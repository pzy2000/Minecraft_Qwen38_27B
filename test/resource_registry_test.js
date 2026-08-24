// 第15轮行星专属资源注册表/掉落/发现档案边界回归。
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
load('js/systems/discovery.js');

const V = sandbox.Voxel;
const Blocks = V.Blocks;
const PlanetRules = V.PlanetRules;
const Discovery = V.Discovery;
let failures = 0;

function check(name, condition, detail) {
  if (condition) console.log('  ok  ' + name);
  else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' :: ' + detail : ''));
  }
}

const OLD_RESOURCE_IDS = [8, 9, 14, 25, 27, 28, 29, 30, 31, 32, 33];
const NEW_RESOURCE_IDS = [39, 40, 41, 42, 43, 44];
const ALL_RESOURCE_IDS = OLD_RESOURCE_IDS.concat(NEW_RESOURCE_IDS);
const specs = [
  { type: 'lush', block: 39, item: 115, tileKey: 'ACTIVE_CRYSTAL', tile: 71,
    key: 'verdant_crystal', blockName: '活性晶簇', itemName: '活性晶体', tier: 1 },
  { type: 'arid', block: 40, item: 116, tileKey: 'SILICA_CRYSTAL', tile: 72,
    key: 'silica_crystal', blockName: '硅晶矿', itemName: '硅晶', tier: 1 },
  { type: 'frozen', block: 41, item: 117, tileKey: 'ICE_CORE', tile: 73,
    key: 'frost_core', blockName: '冰核矿', itemName: '冰核', tier: 2 },
  { type: 'toxic', block: 42, item: 118, tileKey: 'SPORE_CRYSTAL', tile: 74,
    key: 'spore_crystal', blockName: '孢子晶矿', itemName: '孢子晶', tier: 2 },
  { type: 'volcanic', block: 43, item: 119, tileKey: 'MAGMA_CORE', tile: 75,
    key: 'magma_core', blockName: '熔核矿', itemName: '熔核', tier: 3 },
  { type: 'oceanic', block: 44, item: 120, tileKey: 'TIDAL_CRYSTAL', tile: 76,
    key: 'tidal_crystal', blockName: '潮汐晶矿', itemName: '潮汐晶', tier: 2 }
];

console.log('稳定ID与新资源定义');
check('旧方块/物品ID仍保持原语义',
  Blocks.name(38) === '箱子' && Blocks.name(100) === '木棍' && Blocks.name(114) === '熟兔肉' &&
  Blocks.dropOf(8) === 107 && Blocks.dropOf(9) === 9);
check('专属资源块/物品ID连续且唯一',
  new Set(specs.map(s => s.block)).size === 6 && new Set(specs.map(s => s.item)).size === 6 &&
  specs.every((s, i) => s.block === 39 + i && s.item === 115 + i));

for (const spec of specs) {
  const block = Blocks.defs[spec.block];
  const item = Blocks.defs[spec.item];
  check(spec.type + '矿块定义/等级/掉落完整', !!block && block.name === spec.blockName &&
    block.solid === true && block.opaque === true && block.pick === true && block.tier === spec.tier &&
    Number.isFinite(block.hard) && block.hard > 0 && block.drop === spec.item &&
    block.resourceKey === spec.key && Blocks.dropOf(spec.block) === spec.item);
  check(spec.type + '物品定义/名称/键稳定', !!item && item.name === spec.itemName && item.item === true &&
    item.solid === false && item.opaque === false && item.resourceKey === spec.key &&
    !item.maxDur && (!item.maxStack || item.maxStack === 64));
  check(spec.type + '稳定tile 71..76与图标契约', Blocks.T[spec.tileKey] === spec.tile &&
    block.tiles.length === 3 && block.tiles.every(tile => tile === spec.tile) &&
    Blocks.iconTile(spec.block) === spec.tile && Blocks.iconTile(spec.item) === spec.tile);
  const jsonRoundTrip = JSON.parse(JSON.stringify({ block, item }));
  check(spec.type + '新定义可JSON往返', jsonRoundTrip.block.name === spec.blockName &&
    jsonRoundTrip.block.drop === spec.item && jsonRoundTrip.item.name === spec.itemName &&
    jsonRoundTrip.item.resourceKey === spec.key);
  const geology = PlanetRules.resourceProfile(spec.type);
  const generated = PlanetRules.oreAt(
    PlanetRules.V2, spec.type, geology.exclusive.minY, 0.5, 0.5, 0);
  check(spec.type + ' PlanetRules/Blocks 权威映射一致', geology.exclusive.key === spec.key &&
    geology.exclusive.blockId === spec.block && geology.exclusive.itemId === spec.item &&
    geology.exclusive.tier === spec.tier && generated.exclusive === true &&
    generated.blockId === spec.block && generated.itemId === spec.item && generated.key === spec.key);
}

console.log('单一扫描资源白名单');
check('旧11资源原顺序保留',
  JSON.stringify(Blocks.SCANNABLE_RESOURCES.slice(0, OLD_RESOURCE_IDS.length)) === JSON.stringify(OLD_RESOURCE_IDS));
check('新6资源追加且完整白名单=17', Blocks.SCANNABLE_RESOURCES.length === 17 &&
  JSON.stringify(Blocks.SCANNABLE_RESOURCES) === JSON.stringify(ALL_RESOURCE_IDS) &&
  new Set(Blocks.SCANNABLE_RESOURCES).size === Blocks.SCANNABLE_RESOURCES.length);
check('旧+新全17种均可扫描', ALL_RESOURCE_IDS.every(id => Blocks.isScannableResource(id)));
const invalidIds = [undefined, null, NaN, Infinity, -1, 0, 1, 38, 45, 114, 115, 120, 39.5, '39', {}, []];
check('物品/普通方块/坏ID不得伪造资源', invalidIds.every(id => !Blocks.isScannableResource(id)));

console.log('发现档案动态读取Blocks白名单');
const worldId = 'planet-resource-registry';
const catalog = [{ id: worldId, kind: 'planet', typeKey: 'lush' }];
let state = Discovery.empty();
let allAdded = true;
for (const id of ALL_RESOURCE_IDS) {
  const result = Discovery.record(state, {
    worldId, kind: 'resource', key: id, pos: [id, 12, -id]
  }, catalog);
  if (result.added !== 1 || result.entries.length !== 1 || result.entries[0].key !== String(id)) allAdded = false;
  state = result.state;
}
let summary = Discovery.worldSummary(state, worldId);
check('全17种旧+新资源均能建档且不被64条容量截断', allAdded &&
  summary.counts.resources === 17 && summary.resources.length === 17 && summary.total === 17);
check('资源档案标签统一来自Blocks名称', summary.resources.every(entry =>
  Discovery.label(entry) === Blocks.name(Number(entry.key))));

const duplicate = Discovery.record(state,
  { worldId, kind: 'resource', key: 39, pos: [1, 2, 3] }, catalog);
check('同世界同资源去重', duplicate.added === 0 &&
  Discovery.worldSummary(duplicate.state, worldId).counts.resources === 17);

let invalidRejected = true;
for (const bad of [1, 38, 45, 115, 120, 255, -1, NaN, Infinity, '039', 'bad']) {
  const result = Discovery.record(state,
    { worldId, kind: 'resource', key: bad, pos: [0, 10, 0] }, catalog);
  if (result.added !== 0 || Discovery.worldSummary(result.state, worldId).counts.resources !== 17)
    invalidRejected = false;
}
check('Discovery同样拒绝坏ID/掉落物品ID', invalidRejected);

// 导出的数组是防御性副本；即使外部尝试插入普通方块，
// Discovery 仍会与 Blocks 的私有 resource set 交叉校验。
Blocks.SCANNABLE_RESOURCES.push(1, 115, 39);
const forgedBlock = Discovery.record(state,
  { worldId, kind: 'resource', key: 1, pos: [0, 10, 0] }, catalog);
const forgedItem = Discovery.record(state,
  { worldId, kind: 'resource', key: 115, pos: [0, 10, 0] }, catalog);
check('外部篡改导出列表不能放宽Discovery白名单', forgedBlock.added === 0 && forgedItem.added === 0);
Blocks.SCANNABLE_RESOURCES.splice(-3, 3);

const serialized = JSON.stringify(state);
const restored = Discovery.hydrate(JSON.parse(serialized), catalog);
summary = Discovery.worldSummary(restored, worldId);
check('全17种资源档案JSON往返不丢失', summary.counts.resources === 17 &&
  summary.resources.every(entry => ALL_RESOURCE_IDS.indexOf(Number(entry.key)) >= 0));
check('全局汇总资源种类数=17', Discovery.summary(restored, catalog).resources === 17);

// 注入额外键后 hydrate 仅遍历 Blocks 允许键，不会因任意存档键扩容。
const hostile = JSON.parse(serialized);
hostile.worlds[worldId].resources['1'] = { worldId, kind: 'resource', key: '1', pos: [0, 0, 0] };
hostile.worlds[worldId].resources['115'] = { worldId, kind: 'resource', key: '115', pos: [0, 0, 0] };
hostile.worlds[worldId].resources['255'] = { worldId, kind: 'resource', key: '255', pos: [0, 0, 0] };
hostile.worlds[worldId].resources['not-a-resource'] = { worldId, kind: 'resource', key: 'bad', pos: [0, 0, 0] };
const sanitized = Discovery.hydrate(hostile, catalog);
check('恶意JSON额外键被丢弃，合法全资源上限仍为17',
  Discovery.worldSummary(sanitized, worldId).counts.resources === 17 &&
  Object.keys(sanitized.worlds[worldId].resources).every(key => ALL_RESOURCE_IDS.includes(Number(key))));

if (failures) {
  console.error('\nRESOURCE-REGISTRY-FAIL ' + failures);
  process.exit(1);
}
console.log('\nRESOURCE-REGISTRY-PASS');
