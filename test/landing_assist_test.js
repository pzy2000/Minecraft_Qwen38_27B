// 着陆辅助纯逻辑：着陆点搜索、激活门槛、自动驾驶三阶段、取消/超时与参数防御。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, console, Math, Number, Object, Array, isFinite };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/systems/ship_flight.js', 'js/systems/landing_assist.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
const F = sandbox.Voxel.ShipFlight;
const LA = sandbox.Voxel.LandingAssist;

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name + (detail !== undefined ? ' :: ' + detail : ''));
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? ' :: ' + detail : '')); }
}

const AIR = 0, GROUND = 1, WOOD = 9, WATER = 7;
const GEAR = LA.DEFAULTS.gearOffsets;

// 简化世界：高度图 + 可选树冠；surfaceAt 返回最高固体方块 y。
function makeWorld(cells) {
  const height = (x, z) => cells.height(Math.round(x), Math.round(z));
  const tree = (x, z) => cells.tree ? cells.tree(Math.round(x), Math.round(z)) : false;
  const water = (x, z) => cells.water ? cells.water(Math.round(x), Math.round(z)) : false;
  return {
    surfaceAt(x, z) {
      let h = height(x, z);
      if (tree(x, z)) h += 4;
      return h;
    },
    get(x, y, z) {
      const h = height(x, z);
      if (tree(x, z) && y > h && y <= h + 4) return WOOD;
      if (y <= h) return water(x, z) && y === h ? WATER : GROUND;
      return AIR;
    },
    isSolid(id) { return id !== AIR && id !== WATER; }
  };
}

function gearWorldPos(x, z, yaw, gear) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return gear.map(g => [x + g[0] * c + g[1] * s, z - g[0] * s + g[1] * c]);
}

console.log('API与配置');
check('公开API完整', ['create', 'findLandingSpot', 'config'].every(k => typeof LA[k] === 'function') &&
  typeof LA.create().begin === 'function');
check('默认配置关键项', LA.DEFAULTS.maxAltitude === 24 && LA.DEFAULTS.searchRadius === 32 &&
  LA.DEFAULTS.holdMs === 600 && LA.DEFAULTS.landSpeed === 3);
check('非法配置回退默认', LA.config({ searchRadius: NaN, maxAltitude: -5 }).searchRadius === 32 &&
  LA.config({}).maxAltitude === 24);
check('损坏gearOffsets回退', Array.isArray(LA.config({ gearOffsets: 'bad' }).gearOffsets) &&
  LA.config({ gearOffsets: [[NaN, 1]] }).gearOffsets.length === 4);

console.log('着陆点搜索');
const FLAT_Y = 10;
const flatPlain = makeWorld({
  height: (x) => (x >= 20 ? FLAT_Y + 3 : FLAT_Y), // x>=20 是高台斜坡
  water: (x, z) => Math.abs(x) <= 3 && Math.abs(z) <= 3 // 原点附近是湖
});
let spot = LA.findLandingSpot(flatPlain, 0, 0, 0, {});
check('跳过水面找到最近干燥平整点', !!spot && spot.x <= -4.5 && spot.y === FLAT_Y + LA.DEFAULTS.baseClearance,
  spot && ('x=' + spot.x + ',y=' + spot.y));
spot = LA.findLandingSpot(flatPlain, 30, 0, 0, { searchRadius: 4 });
check('高台内可正常着陆(平台本身平整)', !!spot && spot.x >= 26 && spot.y === FLAT_Y + 3 + LA.DEFAULTS.baseClearance,
  spot && ('x=' + spot.x + ',y=' + spot.y));
check('半径内全是水面返回null', LA.findLandingSpot(
  makeWorld({ height: () => FLAT_Y, water: (x) => Math.abs(x - 30) <= 3 }), 30, 0, 0,
  { searchRadius: 3 }) === null);
const outerDryCells = new Set(['28,-3', '31,-3', '28,2', '31,2']);
const outerOnly = {
  surfaceAt() { return FLAT_Y; },
  get(x, y, z) { return outerDryCells.has(x + ',' + z) ? GROUND : WATER; },
  isSolid(id) { return id === GROUND; }
};
spot = LA.findLandingSpot(outerOnly, 0, 0, 0, { searchRadius: 32 });
check('默认候选预算完整覆盖32格搜索外圈', !!spot && spot.x === 30 && spot.z === 0,
  spot && ('x=' + spot.x + ',z=' + spot.z));
const forest = makeWorld({
  height: () => FLAT_Y,
  tree: (x, z) => x % 17 === 0 && z % 17 === 0
});
spot = LA.findLandingSpot(forest, 0, 0, 0, { searchRadius: 24 });
check('跳过树干占据的中心/起落架格位', (() => {
  if (!spot) return false;
  const cols = [[Math.floor(spot.x), Math.floor(spot.z)]]
    .concat(gearWorldPos(spot.x, spot.z, 0, GEAR).map(p => [Math.floor(p[0]), Math.floor(p[1])]));
  return cols.every(c => forest.surfaceAt(c[0], c[1]) === FLAT_Y);
})(), spot && ('x=' + spot.x + ',z=' + spot.z));
check('排除列表生效', LA.findLandingSpot(flatPlain, -10, 0, 0,
  { excluded: [{ x: -10000, z: 0 }] }) !== null);
check('非法worldApi拒绝', LA.findLandingSpot(null, 0, 0, 0, {}) === null &&
  LA.findLandingSpot({}, 0, 0, 0, {}) === null);

console.log('激活门槛');
const api = flatPlain;
const controller = LA.create({});
check('未登舰/坏状态拒绝', controller.begin(null, api).reason === 'state' &&
  controller.begin({ position: [NaN, 5, 0], velocity: [0, 0, 0] }, api).reason === 'state');
check('已着陆拒绝', controller.begin({
  position: [0, FLAT_Y + 1.02, -20], velocity: [0, 0, 0], yaw: 0, throttle: 0, landed: true
}, api).reason === 'landed');
check('高度超限拒绝', controller.begin({
  position: [0, FLAT_Y + 1.02 + 30, -20], velocity: [0, 0, 0], yaw: 0, throttle: 0, landed: false
}, api).reason === 'high');
check('无合适点拒绝', (() => {
  const c2 = LA.create({ searchRadius: 2 });
  return c2.begin({ position: [0, FLAT_Y + 12, 0], velocity: [0, 0, 0], yaw: 0, landed: false },
    makeWorld({ height: () => FLAT_Y, water: () => true })).reason === 'nospot';
})());
const engageState = {
  position: [0, FLAT_Y + 1.02 + 16, 0], velocity: [0, 0, 0], yaw: 0.7, throttle: 0, landed: false
};
const engaged = controller.begin(engageState, api);
check('正常激活并给出目标点', engaged.ok && typeof engaged.spot.x === 'number' && controller.isActive(),
  engaged.ok ? 'target=(' + engaged.spot.x + ',' + engaged.spot.z + ')' : engaged.reason);

console.log('全流程仿真：刹车→进场→下降→落地');
const CFG = {
  maxForward: 24, maxReverse: 6, maxVertical: 8, forwardAccel: 12, brakeDecel: 18,
  throttleUp: 0.75, throttleDown: 1.2, yawRate: 70 * Math.PI / 180,
  pitchRate: 50 * Math.PI / 180, pitchLimit: 50 * Math.PI / 180,
  rollMax: 18 * Math.PI / 180, rollResponse: 4, keyYawRate: 34 * Math.PI / 180
};
function landingSurfaceMock(pos, yaw) {
  const pts = gearWorldPos(pos[0], pos[2], yaw, GEAR);
  const ys = pts.map(p => flatPlain.surfaceAt(Math.floor(p[0]), Math.floor(p[1])));
  const dry = !pts.some((p, i) => !flatPlain.isSolid(flatPlain.get(Math.floor(p[0]), ys[i], Math.floor(p[1]))) ||
    flatPlain.get(Math.floor(p[0]), ys[i], Math.floor(p[1])) === WATER);
  const min = Math.min(...ys), max = Math.max(...ys);
  return { stable: dry && max - min <= 1, y: max + 1.02 };
}
function resolveMove(from, proposed, velocity, attitude) {
  const pos = [proposed[0], proposed[1], proposed[2]];
  const vel = velocity.slice();
  const landing = landingSurfaceMock(pos, attitude.yaw || 0);
  const minY = landing.y - 1.02 + 1.02;
  if (pos[1] < minY) { pos[1] = minY; vel[1] = Math.max(0, vel[1]); }
  const speed = Math.hypot(vel[0], vel[1], vel[2]);
  const canLand = landing.stable && vel[1] <= 0.05 && speed <= 3 &&
    Math.abs(attitude.pitch || 0) <= 0.17 && Math.abs(attitude.roll || 0) <= 0.17 &&
    pos[1] <= landing.y + 0.28;
  if (canLand) { pos[1] = landing.y; vel[0] = vel[1] = vel[2] = 0; }
  return { position: pos, velocity: vel, landed: canLand, collided: false };
}
let st = F.create({ position: engageState.position, velocity: [0, 0, 0], yaw: 0.7, landed: false });
const seenPhases = new Set();
let landedEvent = false, steps = 0;
const dt = 1 / 60;
while (steps < 60 * 40 && !landedEvent) {
  const assist = controller.tick(st, dt, api);
  seenPhases.add(assist.phase);
  const r = F.step(st, dt, assist.input, { config: CFG, resolve: resolveMove });
  st = r.state;
  if (r.events.indexOf('landed') >= 0) { landedEvent = true; controller.notifyLanded(); }
  steps++;
}
check('有限步内自动落地', landedEvent, steps + '步');
check('经历进场与下降阶段', seenPhases.has('transit') && seenPhases.has('descend'),
  [...seenPhases].join(','));
check('落在目标点附近', landedEvent && Math.abs(st.position[0] - engaged.spot.x) <= 2.5 &&
  Math.abs(st.position[2] - engaged.spot.z) <= 2.5,
  'dx=' + (st.position[0] - engaged.spot.x).toFixed(2) + ',dz=' + (st.position[2] - engaged.spot.z).toFixed(2));
check('落地后辅助完成', !controller.isActive() && controller.status().lastResult === 'completed');

console.log('取消、超时与防御');
const c3 = LA.create({});
c3.begin({ position: [-14, FLAT_Y + 17, -26], velocity: [0, 0, 0], yaw: 0, landed: false }, api);
check('手动取消', c3.cancel('cancelled') && !c3.isActive() && c3.status().lastResult === 'cancelled');
const idleTick = c3.tick(F.create({ position: [0, 30, 0] }), dt, api);
check('非活动tick输出零输入', JSON.stringify(idleTick.input) ===
  JSON.stringify({ steerYaw: 0, steerPitch: 0, bank: 0, lift: 0, thrust: false, brake: false }));
const c4 = LA.create({ maxDuration: 0.25 });
c4.begin({ position: [-14, FLAT_Y + 17, -26], velocity: [0, 0, 0], yaw: 0, landed: false }, api);
let expiredResult = null;
for (let i = 0; i < 30 && !(expiredResult && expiredResult.expired); i++)
  expiredResult = c4.tick(F.create({ position: [0, 30, 0] }), dt, api);
check('超时自动结束', !c4.isActive() && expiredResult.expired && c4.status().lastResult === 'expired');
check('坏dt/坏状态安全', (() => {
  const c5 = LA.create({});
  c5.begin({ position: [-14, FLAT_Y + 17, -26], velocity: [0, 0, 0], yaw: 0, landed: false }, api);
  const bad = c5.tick(null, NaN, api);
  return !c5.isActive() && bad.blocked;
})());
check('notifyLanded仅在活动时消费', (() => {
  const c6 = LA.create({});
  return c6.notifyLanded() === false;
})());

console.log('正上方垂直降落与贴地重试');
// 回归A：目标点正上方低速悬停时必须转入 descend，且下降段零转向、
// 零水平推力、只踩垂直下降——这是"落地前一瞬间打转复飞"的根治断言。
{
  const c7 = LA.create({});
  const b7 = c7.begin({ position: [4, FLAT_Y + 6, 3], velocity: [0, 0, 0],
    yaw: 2.5, throttle: 0.4, landed: false }, api);
  const t7 = c7.getTarget();
  // 先一拍刹停进入进场段，再贴近正上方验证相位切换与输出约束。
  c7.tick({ position: [t7.x + 0.8, t7.y + 5, t7.z], velocity: [0.05, 0, 0],
    yaw: 2.5, pitch: 0, roll: 0, throttle: 0.1 }, dt, api);
  const above = { position: [t7.x + 0.1, t7.y + 5, t7.z - 0.1],
    velocity: [0.05, 0, 0], yaw: 2.5, pitch: 0, roll: 0, throttle: 0.1 };
  c7.tick(above, dt, api);
  const r8 = c7.tick(above, dt, api);
  check('正上方低速状态转入纯垂直下降', b7.ok && r8.phase === 'descend',
    'b7=' + b7.ok + ',phase=' + r8.phase);
  check('下降段无任何转向与水平推进', r8.input.steerYaw === 0 && r8.input.thrust === false &&
    r8.input.lift === -1, JSON.stringify(r8.input));
}
// 回归：下降段贴地受阻(玻璃地板模拟)触发卡住改道时，飞船必须保持低空滑行，
// 不允许复飞爬回巡航高度；最终以完成或受控取消结束。
{
  const c8 = LA.create({});
  const startY = FLAT_Y + 1.02 + 0.8;
  let st8 = F.create({ position: [-14, startY, -26], velocity: [0, 0, 0], yaw: 0, landed: false });
  const b8 = c8.begin(st8, api);
  let peak = startY;
  // 窗口需覆盖最多5轮"贴地卡住→转向新目标→滑行"周期(每轮可达数秒)。
  for (let i = 0; i < 60 * 45 && c8.isActive(); i++) {
    const a8 = c8.tick(st8, dt, api);
    const rr = F.step(st8, dt, a8.input, { config: CFG, resolve(from, proposed, vel, att) {
      const out = resolveMove(from, proposed, vel, att);
      // 玻璃地板：垂直方向钉死在起始高度（模拟凹槽/树冠下净空受限），
      // 水平运动不受影响——与真实碰撞解析的分轴语义一致。
      if (!out.landed) {
        out.position = [out.position[0], startY, out.position[2]];
        out.velocity = [out.velocity[0], 0, out.velocity[2]];
      }
      return out;
    } });
    st8 = rr.state;
    if (rr.events.indexOf('landed') >= 0) { c8.notifyLanded(); }
    peak = Math.max(peak, st8.position[1]);
  }
  check('贴地受阻重试期间不复飞爬升且受控结束',
    b8.ok && !c8.isActive() && peak <= startY + 1.3,
    'peak+=' + (peak - startY).toFixed(2) + ',result=' + c8.status().lastResult);
}

process.exit(failed ? 1 : 0);
