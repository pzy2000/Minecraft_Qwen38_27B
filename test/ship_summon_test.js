// 召唤飞船纯逻辑：预览选址、巡航高度规划、驾驶脑三阶段闭环与取消/超时防御。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, console, Math, Number, Object, Array, isFinite };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/systems/ship_flight.js', 'js/systems/landing_assist.js', 'js/systems/ship_summon.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
const LA = sandbox.Voxel.LandingAssist;
const SS = sandbox.Voxel.ShipSummon;

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name + (detail !== undefined ? ' :: ' + detail : ''));
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? ' :: ' + detail : '')); }
}

const AIR = 0, GROUND = 1, WOOD = 9, WATER = 7;

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

// 与 space_travel.resolveFlightMove 相同判据的简化物理求解器（供 ShipFlight.step 注入）。
function makeResolve(world, poseRef) {
  return function resolve(from, proposed, velocity, attitude) {
    const surf = world.surfaceAt(Math.floor(proposed[0]), Math.floor(proposed[2]));
    const minY = surf + 1.02;
    proposed[1] = Math.max(minY, Math.min(230, proposed[1]));
    const dryGear = (x, z, yaw) => true; // 简化：平地世界干湿判据略
    const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
    // 简化落地判据：低速垂降且贴近地面即落地（等效 resolveFlightMove 的稳定面判定）。
    const canLand = !attitude.landed && velocity[1] <= 0.05 && speed <= 3 &&
      proposed[1] <= minY + 0.28 && Math.abs(attitude.pitch || 0) <= 0.17;
    if (canLand) {
      proposed[1] = minY; velocity = [0, 0, 0];
    }
    void dryGear;
    return { position: proposed.map(v => v), velocity, landed: canLand, collided: false };
  };
}

console.log('配置与API');
check('公开API完整',
  ['config', 'aimSpot', 'planCruiseY', 'yawFacing', 'createPilot'].every(k => typeof SS[k] === 'function'));
check('非法配置回退默认', SS.config({ aimRange: -3 }).aimRange === SS.DEFAULTS.aimRange &&
  SS.config({}).searchRadius === SS.DEFAULTS.searchRadius);
function angDist(a, b) {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}
check('yawFacing 指向玩家', angDist(SS.yawFacing(10, 10, 10, 100), Math.PI) < 1e-6 &&
  angDist(SS.yawFacing(10, 10, 100, 10), -Math.PI / 2) < 1e-6);

console.log('巡航高度规划');
{
  const flatY = 12;
  const cruiseFlat = SS.planCruiseY(() => flatY, { x: 0, z: 0 }, { x: 400, z: 0, y: flatY }, {});
  check('平地巡航 = 地表+余量', cruiseFlat === flatY + SS.DEFAULTS.cruiseMargin, cruiseFlat);
  const peak = 90;
  const cruiseHill = SS.planCruiseY((x, z) => (Math.abs(x - 200) < 30 ? peak : flatY),
    { x: 0, z: 0 }, { x: 400, z: 0, y: flatY }, {});
  check('途中高山抬升巡航高度', cruiseHill === peak + SS.DEFAULTS.cruiseMargin, cruiseHill);
  const cruiseLow = SS.planCruiseY(() => flatY, { x: 0, z: 0 }, { x: 20, z: 0, y: 5 }, {});
  check('短途不低于目标进场余量', cruiseLow >= 5 + SS.DEFAULTS.targetApproach, cruiseLow);
  const cruiseUnknown = SS.planCruiseY(() => -1, { x: 0, z: 0 }, { x: 100, z: 0, y: 40 }, {});
  check('地表未知退回目标相对高度', cruiseUnknown === 40 + SS.DEFAULTS.targetApproach, cruiseUnknown);
}

console.log('预览选址');
{
  const w = makeWorld({ height: () => 10 });
  // 玩家在 (50,,50)，命中点在 (56, 56)：yaw 应背向玩家（机鼻朝玩家）。
  const spot = SS.aimSpot(w, { x: 56.4, y: 11, z: 56.4 }, { x: 50, y: 12, z: 50 },
    { searchRadius: 8 });
  check('命中点吸附成功 valid=true', spot && spot.valid === true, spot && `(${spot.x},${spot.z})`);
  check('机鼻朝向玩家', !!spot && Math.abs(
    ((SS.yawFacing(spot.x, spot.z, 50, 50) - spot.yaw) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI
  ) < 1e-6);
  // 环水世界：全部列湿润 → 无合法点，valid=false 且仍给出展示坐标。
  const wl = makeWorld({ height: () => 8, water: () => true });
  const bad = SS.aimSpot(wl, { x: 60, y: 9, z: 60 }, { x: 50, y: 12, z: 50 }, { searchRadius: 6 });
  check('水面无合法点 valid=false', !!bad && bad.valid === false);
  check('无效时仍有坐标可展示红色幽灵', typeof bad.x === 'number' && typeof bad.y === 'number');
  // 未命中射线：回退到玩家前方默认点。
  const miss = SS.aimSpot(w, null,
    { x: 50, y: 12, z: 50, yaw: Math.PI / 2 }, { searchRadius: 8 });
  check('未命中回退前方点并尝试吸附', !!miss && miss.valid === true &&
    Math.abs(miss.x - 50) < 20 && Math.abs(miss.z - 50) < 20, miss && `${miss.x.toFixed(1)},${miss.z.toFixed(1)}`);
}

// ---- 驾驶脑全流程仿真 ----------------------------------------------------
function makeHarness(cells, opts) {
  const world = makeWorld(cells);
  const cfg = Object.assign({}, sandbox.Voxel.ShipFlight.DEFAULTS);
  let state = sandbox.Voxel.ShipFlight.create({
    position: [opts.sx, opts.sy, opts.sz], velocity: [0, 0, 0],
    yaw: 0, pitch: 0, roll: 0, throttle: 0, landed: true
  });
  const ctrlConf = Object.assign({}, LA.DEFAULTS, {
    approachSpeed: 24, maxDuration: 420, maxAltitude: 400
  });
  const ctrl = LA.create(ctrlConf);
  const eventsLog = [];
  // 与生产集成一致的移交技巧：begin() 用「目标点替换 position」的只读视图，
  // 使控制器螺旋搜索圆心恰为已验证着陆点；tick() 始终传真实状态。
  const beginView = () => Object.assign({}, state, {
    position: [opts.tx, state.position[1], opts.tz], velocity: [0, 0, 0], landed: false
  });
  const pilot = SS.createPilot({
    step(input, dt) {
      const r = sandbox.Voxel.ShipFlight.step(state, dt, input, {
        config: cfg, resolve: makeResolve(world)
      });
      state = r.state;
      for (const e of r.events) eventsLog.push(e);
      return r.events;
    },
    getPos() { return [state.position[0], state.position[1], state.position[2]]; },
    getVel() { return state.velocity.slice(); },
    getYaw() { return state.yaw; },
    ctrl: {
      begin() { return ctrl.begin(beginView(), world).ok; },
      tick(dt) { return ctrl.tick(state, dt, world); },
      cancel(reason) { ctrl.cancel(reason); }
    },
    target: { x: opts.tx, z: opts.tz },
    cruiseY: opts.cruiseY !== undefined ? opts.cruiseY :
      SS.planCruiseY((x, z) => world.surfaceAt(x, z),
        { x: opts.sx, z: opts.sz }, { x: opts.tx, z: opts.tz, y: opts.sy }, {}),
    conf: opts.conf || {}
  });
  return { world, stateRef: () => state, pilot, eventsLog };
}

function runSimulation(h, opts) {
  const dt = 1 / 30;
  const maxTicks = Math.ceil((opts.maxSeconds || 300) * 30);
  for (let i = 0; i < maxTicks; i++) {
    h.pilot.tick(dt);
    if (!h.pilot.active()) break;
  }
  return h.pilot.result();
}

console.log('召唤自动驾驶全流程');
{
  // 平地远距召唤：起飞→爬升→移交→进场→垂直下降→落地。
  const h = makeHarness({ height: () => 10 }, { sx: 0, sy: 11.02, sz: 0, tx: 400, tz: 120 });
  const result = runSimulation(h, { maxSeconds: 240 });
  const s = h.stateRef();
  const p = s.position;
  check('最终完成 completed', result === 'completed', result);
  check('经历 takeoff 与 landed 事件', h.eventsLog.includes('takeoff') && h.eventsLog.includes('landed'),
    JSON.stringify({ takeoff: h.eventsLog.includes('takeoff'), landed: h.eventsLog.includes('landed') }));
  check('落点误差 <0.75m', Math.abs(p[0] - 400) < 0.75 && Math.abs(p[2] - 120) < 0.75,
    `dx=${Math.abs(p[0] - 400).toFixed(2)} dz=${Math.abs(p[2] - 120).toFixed(2)}`);
  check('最终 landed=true', s.landed === true);
}

{
  // 中途长出树冠：验证改道/哨兵后仍能完成，终点仍在目标附近。
  let grown = false;
  const h = makeHarness(
    { height: () => 10, tree: (x, z) => grown && Math.abs(x - 398) < 6 && Math.abs(z - 118) < 6 },
    { sx: 0, sy: 11.02, sz: 0, tx: 400, tz: 120 });
  let ticks = 0;
  const dt = 1 / 30;
  let result = null;
  for (; ticks < 240 * 30; ticks++) {
    if (ticks === 45 * 30) grown = true; // 下降/进场半途树冠长出
    h.pilot.tick(dt);
    if (!h.pilot.active()) break;
  }
  result = h.pilot.result();
  const p = h.stateRef().position;
  check('障碍出现仍完成或受阻都不悬死', result === 'completed' || result === 'blocked', result);
  if (result === 'completed') {
    check('改道落点仍在目标邻域(≤18m)', Math.hypot(p[0] - 400, p[2] - 120) <= 18,
      Math.hypot(p[0] - 400, p[2] - 120).toFixed(1));
    check('终局 landed=true', h.stateRef().landed === true);
  }
}

{
  // 中途取消：立即完成态 cancelled，飞船保持悬停不判落地。
  const h = makeHarness({ height: () => 10 }, { sx: 0, sy: 11.02, sz: 0, tx: 400, tz: 120 });
  const dt = 1 / 30;
  for (let i = 0; i < 10 * 30; i++) {
    h.pilot.tick(dt);
    if (!h.pilot.active()) break;
  }
  check('取消前处于活动状态', h.pilot.active() === true);
  h.pilot.cancel();
  const st = h.pilot.tick(dt);
  check('取消后 done=cancelled', st.done === 'cancelled' && st.active === false, st.done);
  check('取消时非落地状态', h.stateRef().landed === false);
}

{
  // 起飞被物理卡死 → 超时 abort stuck。
  const stuckResolve = () => ({ position: [0, 11.02, 0].map(v => v), velocity: [0, 0, 0], landed: true, collided: true });
  const world = makeWorld({ height: () => 10 });
  let state = sandbox.Voxel.ShipFlight.create({
    position: [0, 11.02, 0], velocity: [0, 0, 0], yaw: 0, pitch: 0, roll: 0,
    throttle: 0, landed: true
  });
  const pilot = SS.createPilot({
    step(input, dt) {
      const r = sandbox.Voxel.ShipFlight.step(state, dt, input, { config: {}, resolve: stuckResolve });
      state = r.state; return r.events;
    },
    getPos() { return state.position.slice(); },
    ctrl: { begin() { return false; }, tick() { return { input: {} , active: false }; }, cancel() {} },
    target: { x: 30, z: 30 },
    cruiseY: 26,
    conf: { takeoffTimeout: 3 }
  });
  let out = null;
  for (let i = 0; i < 600; i++) { out = pilot.tick(1 / 30); if (!pilot.active()) break; }
  check('起飞卡死超时 abort stuck', out.done === 'stuck', out.done);
  void stuckResolve; void world;
}

if (failed) { console.log(`\n${failed} 项失败`); process.exit(1); }
console.log('\nship_summon_test 全部通过');
