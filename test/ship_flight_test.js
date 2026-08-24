// 行星飞船纯逻辑：输入防御、固定步、速度/姿态边界、碰撞与着陆事件。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, console, Math, Number, Object, Array, isFinite };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/systems/ship_flight.js'), 'utf8'),
  sandbox, { filename: 'js/systems/ship_flight.js' });
const F = sandbox.Voxel.ShipFlight;

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name + (detail ? ' :: ' + detail : ''));
  else { failed++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}
function stepMany(state, seconds, input, options) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) state = F.step(state, 1 / 60, input, options).state;
  return state;
}
function finiteState(s) {
  return s && [s.yaw, s.pitch, s.roll, s.throttle].concat(s.position, s.velocity).every(Number.isFinite);
}

console.log('API与恢复边界');
check('公开API完整', ['create', 'restore', 'step', 'snapshot', 'normalizeInput'].every(k => typeof F[k] === 'function'));
const base = F.create({ position: [10, 20, -30], yaw: 7, landed: true });
check('create返回冻结有限v1状态', Object.isFrozen(base) && Object.isFrozen(base.position) &&
  base.v === 1 && finiteState(base) && base.yaw <= Math.PI && base.yaw >= -Math.PI && base.landed);
const bad = F.restore({ v: 1, position: [Infinity, -99, NaN], velocity: [999, 0, 0],
  yaw: NaN, pitch: Infinity, roll: -Infinity, throttle: 99 },
{ position: [4, 5, 6], landed: true });
check('损坏姿态整组安全回退且夹紧控制量', bad.position.join(',') === '4,5,6' &&
  bad.velocity.join(',') === '0,0,0' && bad.throttle === 1 && finiteState(bad));
check('非法输入归零', JSON.stringify(F.normalizeInput({ steerYaw: NaN, steerPitch: Infinity,
  bank: '1', lift: null })) === JSON.stringify({ steerYaw: 0, steerPitch: 0, bank: 0, lift: 0,
  thrust: false, brake: false }));

console.log('推进、制动与姿态');
let s = F.create({ position: [0, 20, 0], landed: false });
s = stepMany(s, 1, { thrust: true });
const speed1 = Math.hypot(s.velocity[0], s.velocity[2]);
check('W一秒提高油门并产生有限前进速度', Math.abs(s.throttle - 0.75) < 0.001 &&
  speed1 > 8 && speed1 <= 12.01, speed1.toFixed(3));
s = stepMany(s, 3, { thrust: true });
check('前进速度严格不超过24u/s', Math.hypot(s.velocity[0], s.velocity[2]) <= 24.001 && s.throttle === 1);
const beforeBrake = Math.hypot(s.velocity[0], s.velocity[2]);
s = stepMany(s, 1, { brake: true });
check('S先制动并降低油门/速度', s.throttle < 0 && Math.hypot(s.velocity[0], s.velocity[2]) < beforeBrake);
s = stepMany(s, 2, { brake: true });
check('持续S进入有限倒车且不超过6u/s', s.throttle === -0.25 && Math.hypot(s.velocity[0], s.velocity[2]) <= 6.001);
const lifted = stepMany(F.create({ position: [0, 20, 0] }), 1, { lift: 1 });
check('Space垂直速度不超过8u/s且真实升高', lifted.velocity[1] > 0 && lifted.velocity[1] <= 8 && lifted.position[1] > 20);
const turned = stepMany(F.create({ position: [0, 20, 0] }), 0.5,
  { steerYaw: 1, steerPitch: 1, bank: 1, thrust: true });
check('鼠标转向与A/D侧滚均有界', turned.yaw > 0 && turned.pitch > 0 &&
  Math.abs(turned.roll) <= F.DEFAULTS.rollMax + 1e-9 && finiteState(turned));
const leveled = stepMany(turned, 1, {});
check('松开输入后侧滚自动回正', Math.abs(leveled.roll) < Math.abs(turned.roll));

console.log('碰撞、着陆与copy-on-write');
const moving = F.create({ position: [0, 10, 0], velocity: [0, -2, -5], throttle: 0.5 });
const oldMoving = moving;
const collision = F.step(moving, 1 / 60, { thrust: true }, { resolve(pos) {
  return { position: pos, velocity: [0, 0, 0], landed: false, collided: true };
} });
check('碰撞解析器可取消移动并发单次collision事件', collision.state.position.join(',') === '0,10,0' &&
  collision.state.velocity.join(',') === '0,0,0' && collision.events.join(',') === 'collision');
check('step为copy-on-write且不改旧状态', collision.state !== oldMoving && oldMoving.velocity.join(',') === '0,-2,-5');
const landed = F.step(F.create({ position: [0, 3.1, 0], velocity: [0, -2, 0], landed: false }),
  1 / 60, { lift: -1 }, { resolve() {
    return { position: [0, 3.02, 0], velocity: [0, 0, 0], landed: true };
  } });
check('软着陆清速度并只发landed事件', landed.state.landed && landed.state.velocity.join(',') === '0,0,0' &&
  landed.events.join(',') === 'landed');
const takeoff = F.step(landed.state, 1 / 60, { lift: 1 }, { resolve(pos, proposed, velocity) {
  return { position: proposed, velocity, landed: false };
} });
check('从着陆态升空只发takeoff事件', !takeoff.state.landed && takeoff.events.join(',') === 'takeoff');

console.log('固定步确定性与快照');
function runSchedule(hz) {
  let state = F.create({ position: [0, 20, 0] });
  let accumulator = 0;
  for (let i = 0; i < hz * 3; i++) {
    accumulator += 1 / hz;
    while (accumulator + 1e-12 >= 1 / 60) {
      accumulator -= 1 / 60;
      state = F.step(state, 1 / 60, { thrust: true, steerYaw: 0.25, lift: 0.1 }).state;
    }
  }
  return F.snapshot(state);
}
const schedules = [60, 90, 120, 144].map(runSchedule);
check('60/90/120/144Hz经固定步后姿态字节一致', schedules.every(v => JSON.stringify(v) === JSON.stringify(schedules[0])));
const snap = F.snapshot(schedules[0]);
const restored = F.restore(JSON.parse(JSON.stringify(snap)), { position: [9, 9, 9] });
snap.position[0] = 999;
check('snapshot脱离内部状态且JSON往返', restored.position[0] !== 999 && finiteState(restored) && restored.v === 1);
check('非法dt不推进且返回同一引用', F.step(restored, NaN, {}).state === restored &&
  F.step(restored, -1, {}).state === restored && F.step(restored, 0, {}).state === restored);

console.log(failed ? `\n${failed} SHIP-FLIGHT-FAIL` : '\nSHIP-FLIGHT-PASS');
process.exit(failed ? 1 : 0);
