// 纯逻辑飞行状态机：阶段表、计时确定性、copy-on-write、abort 与陈旧serial。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, console, Math, Number, Object, Array, isFinite };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/systems/flight_sequence.js'), 'utf8'),
  sandbox, { filename: 'js/systems/flight_sequence.js' });
const F = sandbox.Voxel.FlightSequence;

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name + (detail ? ' :: ' + detail : ''));
  else { failed++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}
function names(result) { return result.events.slice(); }
function accept(result, events) {
  if (events) Array.prototype.push.apply(events, result.events);
  return result.state;
}

console.log('API、时长与输入边界');
check('公开API完整', ['create', 'update', 'event', 'abort', 'snapshot', 'phases'].every(k => typeof F[k] === 'function'));
const ship = F.create({ serial: 1, mode: 'ship', reducedMotion: false });
const portal = F.create({ serial: 2, mode: 'portal', reducedMotion: false });
const reduced = F.create({ serial: 3, mode: 'ship', reducedMotion: true });
check('create返回冻结且可JSON序列化的ignition序列', Object.isFrozen(ship) && ship.phase === 'ignition' &&
  ship.serial === 1 && ship.mode === 'ship' && JSON.parse(JSON.stringify(ship)).phase === 'ignition' &&
  typeof ship.update === 'function' && typeof ship.event === 'function' && typeof ship.abort === 'function' &&
  typeof ship.snapshot === 'function');
check('普通ship时长精确 .55/1.15/.75', ship.snapshot().duration === 0.55 &&
  accept(ship.update(0.55)).snapshot().duration === 1.15);
check('普通portal时长精确 .2/.5/.35', portal.snapshot().duration === 0.2 &&
  accept(portal.update(0.2)).snapshot().duration === 0.5);
check('reduced时长精确 .08/.15/.1', reduced.snapshot().duration === 0.08 &&
  accept(reduced.update(0.08)).snapshot().duration === 0.15);
const badSerial = F.create({ serial: NaN, mode: 'ship' });
const badMode = F.create({ serial: 4, mode: 'teleport' });
check('非法serial/mode安全进入aborted而不猜测事务', badSerial.phase === 'aborted' &&
  badSerial.reason === 'invalid_serial' && badMode.phase === 'aborted' && badMode.reason === 'invalid_mode');
check('阶段注册表覆盖严格事务路径', [
  'ignition', 'warp', 'target_loading', 'target_ready', 'committing', 'committed',
  'arrival', 'cockpit_arrived', 'complete', 'aborted'
].every(p => F.phases().indexOf(p) >= 0));

console.log('ship合法阶段表');
let s = F.create({ serial: 10, mode: 'ship' });
const shipEvents = [];
let old = s;
s = accept(s.update(0.54), shipEvents);
check('ignition未满不越界且copy-on-write不改旧state', s.phase === 'ignition' &&
  Math.abs(s.elapsed - 0.54) < 1e-9 && old.elapsed === 0 && s !== old && shipEvents.length === 0);
s = accept(s.update(0.01), shipEvents);
check('ignition边界发begin_warp', s.phase === 'warp' && shipEvents.join(',') === 'begin_warp');
s = accept(s.update(1.15), shipEvents);
check('warp边界发load_target并停target_loading', s.phase === 'target_loading' &&
  shipEvents.join(',') === 'begin_warp,load_target');
let noOp = s.event('begin_commit');
check('target_loading非法/提前事件严格不变', noOp.state === s && !noOp.changed && noOp.events.length === 0);
s = accept(s.event('target_ready'), shipEvents);
check('外部target_ready确认进入同名稳定阶段', s.phase === 'target_ready');
s = accept(s.event('begin_commit'), shipEvents);
check('begin_commit仅从target_ready进入committing', s.phase === 'committing');
s = accept(s.event('commit_succeeded'), shipEvents);
check('commit_succeeded仅从committing进入committed', s.phase === 'committed');
s = accept(s.event('begin_arrival'), shipEvents);
check('已持久化后才进入arrival计时', s.phase === 'arrival' && s.snapshot().duration === 0.75);
s = accept(s.update(0.75), shipEvents);
check('ship抵达停cockpit_arrived等待下船', s.phase === 'cockpit_arrived' &&
  shipEvents.join(',') === 'begin_warp,load_target,arrival_ready');
noOp = s.event('auto_complete');
check('ship不能使用portal自动完成事件', noOp.state === s && noOp.events.length === 0);
s = accept(s.event('disembark'), shipEvents);
check('ship下船后complete且终态不可重复推进', s.phase === 'complete' && s.snapshot().terminal &&
  shipEvents.join(',') === 'begin_warp,load_target,arrival_ready,complete' &&
  s.update(99).state === s && s.event('disembark').state === s && s.abort('late').state === s);

console.log('portal自动完成契约');
let p = F.create({ serial: 11, mode: 'portal' });
const portalEvents = [];
p = accept(p.update(0.2), portalEvents);
p = accept(p.update(0.5), portalEvents);
p = accept(p.event('target_ready'), portalEvents);
p = accept(p.event('begin_commit'), portalEvents);
p = accept(p.event('commit_succeeded'), portalEvents);
p = accept(p.event('begin_arrival'), portalEvents);
p = accept(p.update(0.35), portalEvents);
check('portal抵达边界同时通知arrival_ready/auto_complete', p.phase === 'cockpit_arrived' &&
  portalEvents.join(',') === 'begin_warp,load_target,arrival_ready,auto_complete');
check('portal拒绝ship disembark事件', p.event('disembark').state === p);
p = accept(p.event('auto_complete'), portalEvents);
check('portal消费auto_complete后进入complete', p.phase === 'complete' &&
  portalEvents.join(',') === 'begin_warp,load_target,arrival_ready,auto_complete,complete');

console.log('大帧、finite与边界副作用');
const largeStart = F.create({ serial: 20, mode: 'ship' });
const largeOne = largeStart.update(999);
check('大帧dt夹紧且单次最多跨一个副作用边界', largeOne.state.phase === 'warp' &&
  names(largeOne).join(',') === 'begin_warp' && largeOne.state.elapsed <= 10 && largeOne.events.length === 1);
const largeTwo = largeOne.state.update(0);
check('carry在下一次update才触发load_target', largeTwo.state.phase === 'target_loading' &&
  names(largeTwo).join(',') === 'load_target');
for (const dt of [NaN, Infinity, -1, 0, '1', null]) {
  const base = F.create({ serial: 21, mode: 'ship' });
  const r = base.update(dt);
  check('非法/非正dt不推进 [' + String(dt) + ']', r.state === base && r.events.length === 0);
}
check('静态API对坏state不抛异常', F.update(null, 1).state === null &&
  F.event({}, 'target_ready').events.length === 0 && F.abort([], 'bad').events.length === 0 &&
  F.snapshot(null) === null);

console.log('陈旧serial、abort与理由边界');
const serialBase = F.create({ serial: 30, mode: 'ship' });
check('陈旧serial update/event/abort全部严格不变',
  serialBase.update(1, 29).state === serialBase &&
  serialBase.event('target_ready', 31).state === serialBase &&
  serialBase.abort('stale', 999).state === serialBase);
let reason = '  user\u0000 cancel   because route changed  ' + 'X'.repeat(200);
const aborted = serialBase.abort(reason, 30);
check('abort从未完成态进入有界aborted并发单次事件', aborted.state.phase === 'aborted' &&
  aborted.state.reason.length <= 120 && aborted.state.reason.indexOf('\u0000') < 0 &&
  aborted.events.join(',') === 'aborted' && aborted.state.snapshot().terminal);
check('重复abort和aborted阶段其他事件均不变', aborted.state.abort('again').state === aborted.state &&
  aborted.state.update(1).state === aborted.state && aborted.state.event('target_ready').state === aborted.state);

function statesOnShipPath() {
  const states = [];
  let q = F.create({ serial: 40, mode: 'ship' }); states.push(q);
  q = q.update(0.55).state; states.push(q);
  q = q.update(1.15).state; states.push(q);
  q = q.event('target_ready').state; states.push(q);
  q = q.event('begin_commit').state; states.push(q);
  q = q.event('commit_succeeded').state; states.push(q);
  q = q.event('begin_arrival').state; states.push(q);
  q = q.update(0.75).state; states.push(q);
  return states;
}
const abortable = statesOnShipPath();
check('任意未完成phase均可abort→aborted', abortable.every((state, i) => {
  const r = state.abort('phase-' + i);
  return r.state.phase === 'aborted' && r.events.length === 1;
}));

console.log('帧切分确定性');
function fullRun(mode, reducedMotion, pattern) {
  let seq = F.create({ serial: 50, mode, reducedMotion });
  const events = [];
  let pi = 0, guard = 0;
  while (seq.phase !== 'target_loading' && guard++ < 10000)
    seq = accept(seq.update(pattern[pi++ % pattern.length]), events);
  seq = accept(seq.event('target_ready'), events);
  seq = accept(seq.event('begin_commit'), events);
  seq = accept(seq.event('commit_succeeded'), events);
  seq = accept(seq.event('begin_arrival'), events);
  guard = 0;
  while (seq.phase !== 'cockpit_arrived' && guard++ < 10000)
    seq = accept(seq.update(pattern[pi++ % pattern.length]), events);
  seq = mode === 'portal'
    ? accept(seq.event('auto_complete'), events)
    : accept(seq.event('disembark'), events);
  return { phase: seq.phase, events, snapshot: seq.snapshot() };
}
const schedules = {
  hz60: [1 / 60], hz90: [1 / 90], hz120: [1 / 120], hz144: [1 / 144],
  mixed: [1 / 144, 1 / 30, 0.003, 1 / 90, 0.041, 1 / 120]
};
const normalShipRuns = Object.keys(schedules).map(k => fullRun('ship', false, schedules[k]));
const normalPortalRuns = Object.keys(schedules).map(k => fullRun('portal', false, schedules[k]));
check('ship在60/90/120/144/mixed下事件序列一致', normalShipRuns.every(r =>
  r.phase === 'complete' && r.events.join(',') === normalShipRuns[0].events.join(',')),
  normalShipRuns[0].events.join(','));
check('portal在60/90/120/144/mixed下事件序列一致', normalPortalRuns.every(r =>
  r.phase === 'complete' && r.events.join(',') === normalPortalRuns[0].events.join(',')),
  normalPortalRuns[0].events.join(','));
const reducedShip = fullRun('ship', true, schedules.mixed);
const reducedPortal = fullRun('portal', true, schedules.mixed);
check('reduced只缩短表现时长，不改变ship事务事件序列',
  reducedShip.events.join(',') === normalShipRuns[0].events.join(',') && reducedShip.phase === 'complete');
check('reduced只缩短表现时长，不改变portal事务事件序列',
  reducedPortal.events.join(',') === normalPortalRuns[0].events.join(',') && reducedPortal.phase === 'complete');

console.log('snapshot脱离与copy-on-write');
const snapState = F.create({ serial: Number.MAX_SAFE_INTEGER, mode: 'ship' });
const snap = snapState.snapshot();
snap.phase = 'complete'; snap.elapsed = 999; snap.reason = 'mutated';
check('snapshot为脱离状态的有限副本', snapState.phase === 'ignition' && snapState.elapsed === 0 &&
  snapState.reason === '' && snapState.snapshot().serial === Number.MAX_SAFE_INTEGER &&
  Number.isFinite(snapState.snapshot().duration));
const repeat = snapState.event('target_ready');
check('非法事件返回同一state引用，合法进度才复制', repeat.state === snapState &&
  snapState.update(0.1).state !== snapState);

if (failed) {
  console.error('\nFLIGHT-SEQUENCE-FAIL: ' + failed + ' 项失败');
  process.exit(1);
}
console.log('\nFLIGHT-SEQUENCE-PASS');
