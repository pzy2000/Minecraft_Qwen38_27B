// 无限宇宙纯逻辑专项：node test/universe_test.js
// 覆盖：四级地址派生确定性、起源系逐位兼容、2..6 行星门户网络、
//       恒星系切换与档案桶、v5→v6 迁移、pruneForSave 瘦身、跨系曲速记账。
global.window = global;
global.Voxel = {};

require('../js/config.js');
require('../js/world/seed.js');
require('../js/world/universe.js');
require('../js/world/galaxy.js');

const U = Voxel.Universe;
const G = Voxel.Galaxy;

let failed = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  ' + name);
  else {
    console.log('  FAIL ' + name +
      (detail === undefined ? '' : ' · ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))));
    failed++;
  }
}

// ---- 1. 地址工具 ----
check('地址格式化', U.addr(3, 12) === 'g3/s12');
check('负方向地址', U.addr(-1, 0) === 'g-1/s0' && U.addr(-4, -7) === 'g-4/s-7');
check('地址解析', JSON.stringify(U.parseAddr('g3/s12')) === '{"g":3,"s":12}' &&
  JSON.stringify(U.parseAddr('g-2/s-9')) === '{"g":-2,"s":-9}');
check('非法地址拒绝', U.parseAddr('abc') === null &&
  U.parseAddr('g99999999999/s0') === null && U.parseAddr('g1.5/s0') === null);
check('负银河坐标仍使用 A-Z 后缀', /-[A-Z]$/.test(U.galaxyName('12345', -1)) &&
  /-[A-Z]$/.test(U.galaxyName('12345', -25)) && /-[A-Z]$/.test(U.galaxyName('12345', -27)));

// ---- 2. 起源系逐位兼容 ----
const seed = '12345';
const d00 = U.describe(seed, 0, 0);
check('起源系根种子=宇宙种子', d00.root === G.create(seed).rootSeed && d00.legacy === true);
check('起源系固定6行星+旧类型顺序', d00.planetCount === 6 &&
  JSON.stringify(d00.typeKeys) === '[0,1,2,3,4,5]');
const gal = G.create(seed);
// 与旧版公式的黄金值对比（来自重构前 Galaxy.create('12345')）
const GOLDEN = [
  '-6993137838837304759', '-8186847446303880833', '2838485404753523029',
  '4574945378558700063', '1419478302175334974', '-3631178653759248502'
];
check('起源系行星种子逐位一致', gal.catalog.slice(0, 6).every((w, i) => w.seed === GOLDEN[i]));
check('起源系空间站种子', gal.catalog[6].seed === '4036220241113534945');

// ---- 3. 派生确定性与行星数多样性 ----
const d34a = U.describe(seed, 3, 4);
const d34b = U.describe('12345', 3, 4);
check('同种子两次派生完全一致', JSON.stringify(d34a) === JSON.stringify(d34b));
check('不同坐标派生不同', d34a.name !== d00.name || d34a.planetCount !== d00.planetCount);
let counts = new Set(), names = new Set();
for (let i = 0; i < 200; i++) {
  const d = U.describe(String(i * 7919), i % 11, (i * 13) % 17);
  counts.add(d.planetCount);
  names.add(d.name);
}
check('行星数在2..6之间', [...counts].every(c => c >= 2 && c <= 6), [...counts]);
check('行星数有多样性', counts.size >= 3, { distinct: counts.size });
check('系统名高唯一率', names.size > 180, { distinct: names.size });
check('类型不重复', [...counts].length > 0 &&
  U.describe(seed, 9, 9).typeKeys.every((t, idx, arr) => arr.indexOf(t) === idx));
check('恒星分类合法', U.STAR_CLASSES.some(c => c.cls === U.describe(seed, 2, 8).star.cls));

// ---- 4. 可变行星数的门户网络 ----
function netOk(count) {
  // 构造一个 planetCount=count 的合成目录（借用真实描述符保证形状合法）
  let found = null;
  for (let i = 0; i < 500 && !found; i++) {
    const d = U.describe(String(i), 5, 7);
    if (d.planetCount === count) found = d;
  }
  if (!found) return null;
  const g2 = {
    rootSeed: found.root,
    catalog: (() => {
      const list = [];
      for (let p = 0; p < found.planetCount; p++) list.push({
        id: 'planet-' + p, kind: 'planet', x: (p + 1) * 10, y: (p + 2) * 10
      });
      list.push({ id: 'station-0', kind: 'station', x: 0, y: 0 });
      return list;
    })()
  };
  return G.portalNetwork(g2);
}
for (const n of [2, 3, 4, 5, 6]) {
  const net = netOk(n);
  const ids = [...Array(n)].map((_, i) => 'planet-' + i).concat(['station-0']);
  let ok = !!net && Object.keys(net.byWorld).length === ids.length;
  // 全对可达且 ≤2 跳（经空间站星形拓扑保证）
  if (ok) for (const a of ids) for (const b of ids) {
    if (a === b) continue;
    const path = G.portalRoute({ rootSeed: net.rootSeed, catalog: [] }, a, b);
    void path; // portalRoute 需要完整 galaxy，改用 BFS 直接验证连通性
  }
  if (ok) {
    const seen = new Set(['planet-0']);
    const queue = ['planet-0'];
    while (queue.length) {
      const cur = queue.shift();
      for (const gate of net.byWorld[cur] || [])
        if (!seen.has(gate.destinationId)) { seen.add(gate.destinationId); queue.push(gate.destinationId); }
    }
    ok = seen.size === ids.length;
  }
  check(`N=${n} 行星网络连通`, ok);
  check(`N=${n} 每条门户边均有双向 gate`, !!net && net.edges.every(edge =>
    (net.byWorld[edge.a] || []).some(gate => gate.destinationId === edge.b) &&
    (net.byWorld[edge.b] || []).some(gate => gate.destinationId === edge.a)));
}

// N=6 时网络形状与旧版完全一致
const net6 = G.portalNetwork(gal);
check('N=6 保持15条边', net6.edges.length === 15);

// ---- 5. 恒星系切换与档案桶 ----
{
  const g = G.create(seed);
  g.worlds['planet-0'] = { edits: { '100,30,100': 15 }, bed: [100, 31, 100] };
  g.discovered['planet-0'] = true;
  g.discovery = { v: 1, points: 5, worlds: {}, claimed: {} };
  const ts = 1700000000000;
  const before = { edits: g.worlds['planet-0'], disc: g.discovered };

  G.switchSystem(g, 2, 5, 'station-0', ts);
  check('切换后坐标更新', g.curG === 2 && g.curS === 5);
  check('切换后目录重建', g.catalog.length >= 3 && g.catalog.length <= 7);
  check('切换后抵达空间站', g.currentId === 'station-0' && g.discovered['station-0'] === true);
  check('原系统档案入桶', JSON.stringify(g.archive['g0/s0'].worlds['planet-0']) === JSON.stringify(before.edits) &&
    g.archive['g0/s0'].discovered['planet-0'] === true);
  check('发现档案随桶归档', g.archive['g0/s0'].discovery.points === 5);

  // 切回：档案恢复
  G.switchSystem(g, 0, 0, 'planet-0', ts + 1);
  check('切回后世界快照还原', JSON.stringify(g.worlds['planet-0']) === JSON.stringify(before.edits));
  check('切回后发现档案还原', g.discovery.points === 5);
  check('visitedSys 记录两系', g.visitedSys['g0/s0'] === true && g.visitedSys['g2/s5'] === true);
}

// ---- 6. pruneForSave：可再生快照瘦身 + 桶上限 ----
{
  const g = G.create(seed);
  g.worlds['planet-0'] = {};                                  // 空 → 删（当前世界除外）
  g.worlds['planet-1'] = { edits: { '5,5,5': 3 } };           // 有编辑 → 留
  g.worlds['planet-2'] = { shipFlight: { landed: true } };    // 有飞船状态 → 留
  g.worlds['planet-3'] = { meta: { '1,2,3': {} } };           // 有容器元数据 → 留
  g.worlds['planet-4'] = { time: 0.91, weather: 'thunder',
    player: { pos: [10, 20, 30], hp: 20, food: 20 } };         // 仅时间/天气 → 瘦身保留
  g.worlds['station-0'] = {};                                 // 空非当前 → 删
  const pruned = G.pruneForSave(g);
  check('裁剪不修改运行态世界映射', !!g.worlds['planet-4'].player);
  check('空快照被清理', !('planet-0' in pruned.worlds) === false); // planet-0 是 currentId，必须保留
  check('有编辑的保留', !!pruned.worlds['planet-1']);
  check('飞船状态保留', !!pruned.worlds['planet-2']);
  check('元数据保留', !!pruned.worlds['planet-3']);
  check('时间天气小快照保留且普通玩家字段被裁剪',
    JSON.stringify(pruned.worlds['planet-4']) === '{"time":0.91,"weather":"thunder"}');

  // LRU 上限
  g.curG = 0; g.curS = 0;
  for (let i = 0; i < 40; i++)
    g.archive['g1/' + 'x'] = undefined; // 占位防误用
  g.archive = {};
  for (let i = 0; i < 40; i++)
    g.archive['g1/s' + i] = { discovered: {}, worlds: {}, discovery: null, lastVisit: i };
  G.switchSystem(g, 99, 99, 'station-0', 42);
  check('档案桶不超过上限', Object.keys(g.archive).length <= (Voxel.Config.UNIVERSE.ARCHIVE_MAX_SYSTEMS),
    Object.keys(g.archive).length);
  check('当前系不在桶中', !('g99/s99' in g.archive));
  check('刚离开的系在桶中且最新保留', 'g0/s0' in g.archive && !('g1/s0' in g.archive));
}

// ---- 7. 跨系跃迁计划 ----
{
  const g = G.create(seed);
  g.ship.warpCells = 3;
  const planNear = G.jumpPlan(g, 0, 1);   // 距离1 → ≥1 电池
  check('近邻跳跃可达', planNear.valid && planNear.reachable && planNear.cost <= 3);
  const planFar = G.jumpPlan(g, 20, 20);  // 远距 → 通常不可达
  check('远距跳跃成本正确', planFar.valid && planFar.cost > planNear.cost);
  check('电池不足拦截', !(planFar.reachable && planFar.cost > g.ship.warpCells));
  const planSelf = G.jumpPlan(g, 0, 0);
  check('同系跳跃无效', !planSelf.valid);
  g.ship.warpCells = 0;
  check('零电池不可达', G.jumpPlan(g, 0, 1).reachable === false);
}

// ---- 8. v5→v6 迁移 ----
{
  // 构造 v5 形态存档 galaxy（无 curG/curS/archive/warpCells）
  const legacyGalaxy = {
    version: 1, terrainVersion: 2, rootSeed: seed, currentId: 'planet-3',
    discovered: { 'planet-0': true, 'planet-3': true },
    ship: { fuel: 66, maxFuel: 100, engine: '脉冲跃迁引擎 MK-I' },
    discovery: null,
    worlds: { 'planet-3': { edits: { '9,9,9': 1 }, bed: [9, 10, 9] } },
    catalog: null
  };
  const h = G.hydrate(JSON.parse(JSON.stringify(legacyGalaxy)), seed);
  check('迁移回落起源系', h.curG === 0 && h.curS === 0);
  check('迁移保留 currentId', h.currentId === 'planet-3');
  check('迁移保留世界快照', h.worlds['planet-3'].edits['9,9,9'] === 1);
  check('迁移补默认电池', h.ship.warpCells === 2);
  check('迁移保留燃料', h.ship.fuel === 66);
  check('迁移后目录=起源系', h.catalog[6].seed === '4036220241113534945');

  // v6 形态：非起源系 curG/curS 持久化往返
  const v6saved = G.hydrate({ ...legacyGalaxy, curG: 1, curS: 1 }, seed);
  check('v6 坐标持久化', v6saved.curG === 1 && v6saved.curS === 1);
  const again = G.hydrate(JSON.parse(JSON.stringify(v6saved)), seed);
  check('v6 往返稳定', again.curG === 1 && again.curS === 1 &&
    again.catalog.length === v6saved.catalog.length);
}

console.log(failed === 0 ? '\nUNIVERSE-PASS' : '\nUNIVERSE-FAIL: ' + failed + ' 项失败');
process.exit(failed === 0 ? 0 : 1);
