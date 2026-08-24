// 星际门户网络纯逻辑专项：node test/portal_network_test.js
global.window = global;
global.Voxel = {};

require('../js/config.js');
require('../js/world/seed.js');
require('../js/world/galaxy.js');

const G = Voxel.Galaxy;
const WORLD_IDS = ['planet-0', 'planet-1', 'planet-2', 'planet-3', 'planet-4', 'planet-5', 'station-0'];

function fail(name, detail) {
  throw new Error('FAIL ' + name + (detail === undefined ? '' : ' · ' +
    (typeof detail === 'string' ? detail : JSON.stringify(detail))));
}

function check(name, condition, detail) {
  if (!condition) fail(name, detail);
}

function minDistance(gates) {
  let min = Infinity;
  for (let i = 0; i < gates.length; i++) {
    for (let j = i + 1; j < gates.length; j++) {
      min = Math.min(min, Math.hypot(gates[i].x - gates[j].x, gates[i].z - gates[j].z));
    }
  }
  return min;
}

function reachable(network, start) {
  const seen = new Set([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const gates = network.byWorld[queue[head]] || [];
    for (const gate of gates) {
      if (!seen.has(gate.destinationId)) {
        seen.add(gate.destinationId);
        queue.push(gate.destinationId);
      }
    }
  }
  return seen;
}

function assertNetwork(seed, galaxy, network) {
  const prefix = 'seed=' + seed;
  check('网络版本/根种子', network.version === G.PORTAL_NETWORK_VERSION &&
    network.version === 2 && network.rootSeed === galaxy.rootSeed, prefix);
  check('seeded cycle覆盖六颗行星', network.cycle.length === 6 &&
    new Set(network.cycle).size === 6 && network.cycle.every(id => /^planet-[0-5]$/.test(id)),
  { seed, cycle: network.cycle });
  check('网络固定15条无向边', network.edges.length === 15, { seed, edges: network.edges.length });

  const gateIds = new Set();
  const pairCounts = new Map();
  for (const id of WORLD_IDS) {
    const gates = network.byWorld[id];
    const expected = id === 'station-0' ? 6 : 4;
    check('每世界门户数量', Array.isArray(gates) && gates.length === expected,
      { seed, id, count: gates && gates.length });
    check('同世界destination唯一', new Set(gates.map(g => g.destinationId)).size === gates.length,
      { seed, id, destinations: gates.map(g => g.destinationId) });

    for (const gate of gates) {
      check('gate字段有界完整', gate && typeof gate.id === 'string' && gate.id.length <= 96 &&
        typeof gate.pairId === 'string' && gate.pairId.length <= 96 &&
        typeof gate.destinationId === 'string' && typeof gate.destinationGateId === 'string' &&
        typeof gate.slot === 'string' && typeof gate.kind === 'string' &&
        Number.isFinite(gate.x) && Number.isFinite(gate.z), { seed, id, gate });
      check('禁止self-loop', gate.destinationId !== id, { seed, id, gate });
      check('全局gate ID唯一', !gateIds.has(gate.id), { seed, gateId: gate.id });
      gateIds.add(gate.id);
      pairCounts.set(gate.pairId, (pairCounts.get(gate.pairId) || 0) + 1);

      const reciprocal = (network.byWorld[gate.destinationId] || [])
        .find(other => other.id === gate.destinationGateId);
      check('每扇门拥有精确reciprocal gate', reciprocal && reciprocal.destinationId === id &&
        reciprocal.destinationGateId === gate.id && reciprocal.pairId === gate.pairId,
      { seed, id, gate, reciprocal });
    }

    if (id !== 'station-0') {
      const kinds = gates.reduce((out, gate) => {
        out[gate.kind] = (out[gate.kind] || 0) + 1;
        return out;
      }, {});
      check('行星固定station+cycle×2+opposite', kinds.station === 1 && kinds.cycle === 2 &&
        kinds.opposite === 1, { seed, id, kinds });
      check('行星计划中心距>=24', minDistance(gates) >= 24, { seed, id, min: minDistance(gates) });
      check('行星门户避开中心与北侧飞船预留区', gates.every(gate =>
        Math.hypot(gate.x - 128, gate.z - 128) >= 44 &&
        Math.hypot(gate.x - 128, gate.z - 110) >= 48), { seed, id, gates });
    }
  }

  check('全网30扇有向门', gateIds.size === 30, { seed, count: gateIds.size });
  check('每个pairId恰好两扇门', pairCounts.size === 15 &&
    Array.from(pairCounts.values()).every(count => count === 2),
  { seed, pairs: Array.from(pairCounts.entries()) });
  check('所有世界从任意起点强连通', WORLD_IDS.every(id => reachable(network, id).size === 7), seed);

  const stationGates = network.byWorld['station-0'];
  check('station六门逐一通往planet-0..5', JSON.stringify(stationGates.map(g => g.destinationId)) ===
    JSON.stringify(WORLD_IDS.slice(0, 6)), { seed, gates: stationGates });
  check('station pads位于安全甲板南侧且避开dock/北终端', stationGates.every(gate =>
    Math.hypot(gate.x - 128, gate.z - 128) >= 20 &&
    Math.hypot(gate.x - 128, gate.z - 128) <= 28 && gate.z >= 128),
  { seed, gates: stationGates });
  check('station pads中心距>=8', minDistance(stationGates) >= 8,
    { seed, min: minDistance(stationGates) });
}

console.log('门户网络20k种子属性枚举');
const cycles = new Set();
for (let seed = 0; seed < 20000; seed++) {
  const galaxy = G.create(String(seed));
  const network = G.portalNetwork(galaxy);
  assertNetwork(seed, galaxy, network);
  cycles.add(network.cycle.join(','));
  if (seed % 257 === 0) {
    check('同seed网络确定', JSON.stringify(network) === JSON.stringify(G.portalNetwork(galaxy)), seed);
  }
}
check('seeded cycle确有多样性', cycles.size > 600, { cycles: cycles.size });

console.log('固定旧失败种子与布局回归');
const fixed = ['0', '227', '783'].map(seed => ({ seed, galaxy: G.create(seed) }));
for (const item of fixed) {
  const network = G.portalNetwork(item.galaxy);
  assertNetwork(item.seed, item.galaxy, network);
  for (const id of WORLD_IDS) {
    const gates = G.portalsFor(item.galaxy, G.find(item.galaxy, id));
    check('portalsFor与版本网络一致', JSON.stringify(gates) === JSON.stringify(network.byWorld[id]),
      { seed: item.seed, id });
    check('旧重叠种子不再出现同坐标', minDistance(gates) >= (id === 'station-0' ? 8 : 24),
      { seed: item.seed, id, gates });
  }
}
check('不同seed通常产生不同cycle', new Set(fixed.map(item =>
  G.portalNetwork(item.galaxy).cycle.join(','))).size > 1);

console.log('输出副本不可污染后续调用');
const copyGalaxy = G.create('copy-isolation');
const original = G.portalNetwork(copyGalaxy);
const expectedFirst = original.byWorld['planet-0'][0].destinationId;
original.cycle[0] = 'corrupt';
original.edges[0].pairId = 'corrupt';
original.byWorld['planet-0'][0].destinationId = '__proto__';
delete original.byWorld['station-0'];
const clean = G.portalNetwork(copyGalaxy);
check('portalNetwork每次返回干净副本', clean.cycle[0] !== 'corrupt' &&
  clean.edges[0].pairId !== 'corrupt' && clean.byWorld['planet-0'][0].destinationId === expectedFirst &&
  clean.byWorld['station-0'].length === 6);
const portalCopy = G.portalsFor(copyGalaxy, copyGalaxy.catalog[0]);
portalCopy[0].x = -999;
portalCopy.push({ id: 'bad' });
check('portalsFor返回数组/条目副本', G.portalsFor(copyGalaxy, copyGalaxy.catalog[0]).length === 4 &&
  G.portalsFor(copyGalaxy, copyGalaxy.catalog[0])[0].x !== -999);

console.log('BFS门户路由');
const routeGalaxy = G.create('route-contract');
const routeNetwork = G.portalNetwork(routeGalaxy);
for (const from of WORLD_IDS) {
  for (const to of WORLD_IDS) {
    const path = G.portalRoute(routeGalaxy, from, to);
    check('portalPath首尾包含from/to', path.length >= 1 && path[0] === from &&
      path[path.length - 1] === to, { from, to, path });
    check('BFS路径有界', path.length <= 3, { from, to, path });
    for (let i = 0; i + 1 < path.length; i++) {
      check('BFS每一跳都有真实gate', routeNetwork.byWorld[path[i]]
        .some(gate => gate.destinationId === path[i + 1]), { from, to, path });
    }
    if (from === to) check('from===to严格0 hop', path.length === 1, { from, to, path });
  }
}
const detachedPath = G.portalRoute(routeGalaxy, 'planet-0', 'station-0');
detachedPath[0] = 'corrupt';
check('portalRoute返回新数组', G.portalRoute(routeGalaxy, 'planet-0', 'station-0')[0] === 'planet-0');
check('坏/未知路由返回空数组', G.portalRoute(null, 'planet-0', 'station-0').length === 0 &&
  G.portalRoute(routeGalaxy, '__proto__', 'station-0').length === 0 &&
  G.portalRoute(routeGalaxy, null, null).length === 0);

console.log('权威routePlan与50/100/200燃料单位');
const from = G.find(routeGalaxy, 'planet-0');
const to = G.find(routeGalaxy, 'planet-5');
const cost = G.fuelCost(from, to);
for (const units of [50, 100, 200]) {
  const plan = G.routePlan(routeGalaxy, from, to, { fuel: units, maxFuel: units });
  check('routePlan单位/扣费/路径字段', plan.valid && plan.distanceLy === G.distance(from, to) &&
    plan.costUnits === cost && plan.fuel === units && plan.maxFuel === units &&
    plan.remainingFuel === units - cost && plan.shortfall === 0 && plan.reachable &&
    plan.portalPath[0] === from.id && plan.portalPath[plan.portalPath.length - 1] === to.id &&
    plan.portalHops === plan.portalPath.length - 1 &&
    plan.directPortal === (plan.portalHops === 1), { units, plan });
}
const insufficient = G.routePlan(routeGalaxy, from.id, to.id, { fuel: cost - 1, maxFuel: 50 });
check('燃料不足精确shortfall且remaining归零', !insufficient.reachable &&
  insufficient.shortfall === 1 && insufficient.remainingFuel === 0 && insufficient.fuel === cost - 1,
insufficient);
const same = G.routePlan(routeGalaxy, from, from, { fuel: 0, maxFuel: 50 });
check('from===to为0距离/0费用/0hop', same.valid && same.distanceLy === 0 &&
  same.costUnits === 0 && same.remainingFuel === 0 && same.shortfall === 0 && same.reachable &&
  same.portalHops === 0 && same.portalPath.length === 1 && same.portalPath[0] === from.id &&
  !same.directPortal, same);
const direct = G.routePlan(routeGalaxy, 'planet-0', 'station-0', { fuel: 50, maxFuel: 50 });
check('station星形边被识别为directPortal', direct.directPortal && direct.portalHops === 1,
  direct);
const nonNeighbor = WORLD_IDS.slice(0, 6).find(id => id !== 'planet-0' &&
  !routeNetwork.byWorld['planet-0'].some(gate => gate.destinationId === id));
const indirect = G.routePlan(routeGalaxy, 'planet-0', nonNeighbor, { fuel: 50, maxFuel: 50 });
check('非邻接行星使用2-hop portalPath', indirect.valid && !indirect.directPortal &&
  indirect.portalHops === 2 && indirect.portalPath.length === 3, { nonNeighbor, indirect });
const planPath = indirect.portalPath;
planPath[0] = 'corrupt';
check('routePlan.portalPath为新数组', G.routePlan(
  routeGalaxy, 'planet-0', nonNeighbor, { fuel: 50, maxFuel: 50 }).portalPath[0] === 'planet-0');

console.log('输入防御');
const badShip = G.routePlan(routeGalaxy, from, to, { fuel: NaN, maxFuel: Infinity });
check('坏ship不泄漏NaN/Infinity', Object.values(badShip).filter(value => typeof value === 'number')
  .every(Number.isFinite) && badShip.fuel === 0 && badShip.maxFuel === 100, badShip);
const clampedShip = G.routePlan(routeGalaxy, from, to, { fuel: 999, maxFuel: 50 });
check('fuel严格夹紧到maxFuel', clampedShip.fuel === 50 && clampedShip.maxFuel === 50,
  clampedShip);
const badPlan = G.routePlan(null, '__proto__', {}, { fuel: '50', maxFuel: '100' });
check('坏route输入返回有限不可达模型', !badPlan.valid && !badPlan.reachable &&
  badPlan.fromId === '' && badPlan.toId === '' && badPlan.portalPath.length === 0 &&
  badPlan.portalHops === -1 && badPlan.distanceLy === 0 && badPlan.costUnits === 0 &&
  Object.values(badPlan).filter(value => typeof value === 'number').every(Number.isFinite), badPlan);
check('坏portal输入安全空结果', G.portalsFor(null, from).length === 0 &&
  G.portalsFor(routeGalaxy, { id: '__proto__' }).length === 0 &&
  G.portalsFor(routeGalaxy, Object.create({ id: 'planet-0' })).length === 0);
const giant = { rootSeed: '0', catalog: new Array(65).fill({}) };
check('巨型/缺world catalog拒绝', Object.keys(G.portalNetwork(giant).byWorld).length === 0 &&
  Object.keys(G.portalNetwork({ rootSeed: '0', catalog: [] }).byWorld).length === 0);
const inherited = Object.create({ rootSeed: routeGalaxy.rootSeed, catalog: routeGalaxy.catalog });
check('继承root/catalog拒绝', Object.keys(G.portalNetwork(inherited).byWorld).length === 0);
const poisoned = G.create('poisoned-coordinates');
poisoned.catalog[0].x = Infinity;
check('坏世界坐标拒绝且route不泄漏NaN', Object.keys(G.portalNetwork(poisoned).byWorld).length === 0 &&
  Object.values(G.routePlan(poisoned, 'planet-0', 'station-0', poisoned.ship))
    .filter(value => typeof value === 'number').every(Number.isFinite));
const overflow = G.create('finite-overflow-coordinates');
overflow.catalog[0].x = Number.MAX_VALUE;
overflow.catalog[0].y = Number.MAX_VALUE;
overflow.catalog[6].x = -Number.MAX_VALUE;
overflow.catalog[6].y = -Number.MAX_VALUE;
const overflowPlan = G.routePlan(overflow, 'planet-0', 'station-0', overflow.ship);
check('有限但运算溢出的轨道坐标同样拒绝', Object.keys(G.portalNetwork(overflow).byWorld).length === 0 &&
  !overflowPlan.valid && !overflowPlan.reachable && overflowPlan.distanceLy === 0 &&
  Object.values(overflowPlan).filter(value => typeof value === 'number').every(Number.isFinite));

const savedRandom = Math.random;
Math.random = function () { throw new Error('portalNetwork不得调用Math.random'); };
try {
  check('portalNetwork仅使用seed派生', G.portalNetwork(routeGalaxy).edges.length === 15);
} finally {
  Math.random = savedRandom;
}

console.log('\nPORTAL-NETWORK-PASS');
