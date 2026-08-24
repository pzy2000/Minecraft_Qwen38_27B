// 飞行表现状态机：只负责阶段/计时/事件，不读写 DOM、世界、存档、音频或 THREE。
// 所有操作均 copy-on-write：返回 { state, events }，调用方显式接纳新 state。
window.Voxel = window.Voxel || {};

Voxel.FlightSequence = (function () {
  'use strict';

  var VERSION = 1;
  var MAX_DT = 10;
  var MAX_ELAPSED = 60;
  var MAX_REASON = 120;
  var TERMINAL = { complete: true, aborted: true };
  var PHASES = {
    ignition: true,
    warp: true,
    target_loading: true,
    target_ready: true,
    committing: true,
    committed: true,
    arrival: true,
    cockpit_arrived: true,
    complete: true,
    aborted: true
  };
  var NORMAL = {
    ship: { ignition: 0.55, warp: 1.15, arrival: 0.75 },
    portal: { ignition: 0.20, warp: 0.50, arrival: 0.35 }
  };
  var REDUCED = { ignition: 0.08, warp: 0.15, arrival: 0.10 };

  function finite(value) { return typeof value === 'number' && isFinite(value); }
  function validSerial(value) {
    return finite(value) && Math.floor(value) === value && value > 0 && value <= Number.MAX_SAFE_INTEGER;
  }
  function validMode(value) { return value === 'ship' || value === 'portal'; }

  function safeReason(value, fallback) {
    var text = typeof value === 'string'
      ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (!text) text = fallback || 'aborted';
    return text.slice(0, MAX_REASON);
  }

  function durationFor(mode, reducedMotion, phase) {
    if (phase !== 'ignition' && phase !== 'warp' && phase !== 'arrival') return 0;
    return reducedMotion ? REDUCED[phase] : NORMAL[mode][phase];
  }

  function rawState(data) {
    return {
      v: VERSION,
      serial: data.serial,
      mode: data.mode,
      reducedMotion: data.reducedMotion === true,
      phase: data.phase,
      elapsed: data.elapsed,
      reason: data.reason || ''
    };
  }

  function attachMethods(state) {
    Object.defineProperties(state, {
      update: { enumerable: false, value: function (dt, serial) { return update(state, dt, serial); } },
      event: { enumerable: false, value: function (name, serial) { return event(state, name, serial); } },
      abort: { enumerable: false, value: function (reason, serial) { return abort(state, reason, serial); } },
      snapshot: { enumerable: false, value: function () { return snapshot(state); } }
    });
    return Object.freeze(state);
  }

  function make(data) {
    var phase = PHASES[data.phase] ? data.phase : 'aborted';
    var mode = validMode(data.mode) ? data.mode : 'ship';
    var elapsed = finite(data.elapsed) && data.elapsed >= 0
      ? Math.min(MAX_ELAPSED, data.elapsed) : 0;
    return attachMethods(rawState({
      serial: validSerial(data.serial) ? data.serial : 0,
      mode: mode,
      reducedMotion: data.reducedMotion === true,
      phase: phase,
      elapsed: elapsed,
      reason: phase === 'aborted' ? safeReason(data.reason, 'invalid_sequence') : ''
    }));
  }

  function create(options) {
    options = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    if (!validSerial(options.serial)) return make({
      serial: 0, mode: validMode(options.mode) ? options.mode : 'ship',
      reducedMotion: options.reducedMotion === true, phase: 'aborted', elapsed: 0,
      reason: 'invalid_serial'
    });
    if (!validMode(options.mode)) return make({
      serial: options.serial, mode: 'ship', reducedMotion: options.reducedMotion === true,
      phase: 'aborted', elapsed: 0, reason: 'invalid_mode'
    });
    return make({
      serial: options.serial,
      mode: options.mode,
      reducedMotion: options.reducedMotion === true,
      phase: 'ignition',
      elapsed: 0,
      reason: ''
    });
  }

  function stale(state, serial) {
    return serial !== undefined && serial !== null && serial !== state.serial;
  }

  function validState(state) {
    return !!state && typeof state === 'object' && validSerial(state.serial) && validMode(state.mode) &&
      PHASES[state.phase] === true && finite(state.elapsed) && state.elapsed >= 0 && state.elapsed <= MAX_ELAPSED;
  }

  function result(previous, next, events) {
    return {
      state: next,
      events: events || [],
      changed: next !== previous,
      serial: next && validSerial(next.serial) ? next.serial : 0
    };
  }

  function transitionTimed(state, nextPhase, eventNames, carry) {
    return make({
      serial: state.serial,
      mode: state.mode,
      reducedMotion: state.reducedMotion,
      phase: nextPhase,
      elapsed: Math.max(0, Math.min(MAX_ELAPSED, carry || 0)),
      reason: ''
    });
  }

  function update(state, dt, serial) {
    if (!validState(state) || stale(state, serial) || TERMINAL[state.phase])
      return result(state, state, []);
    var safeDt = finite(dt) && dt > 0 ? Math.min(MAX_DT, dt) : 0;
    if (state.phase !== 'ignition' && state.phase !== 'warp' && state.phase !== 'arrival')
      return result(state, state, []);

    var elapsed = Math.min(MAX_ELAPSED, state.elapsed + safeDt);
    var duration = durationFor(state.mode, state.reducedMotion, state.phase);
    if (elapsed + 1e-9 < duration) {
      if (safeDt === 0) return result(state, state, []);
      var progressed = make({
        serial: state.serial, mode: state.mode, reducedMotion: state.reducedMotion,
        phase: state.phase, elapsed: elapsed, reason: ''
      });
      return result(state, progressed, []);
    }

    // 单次 update 最多跨一个阶段边界。多余时间作为下一计时阶段 carry，
    // 调用方可在下一帧（甚至 dt=0）继续排空，不会一次触发多个外部副作用。
    var carry = Math.max(0, elapsed - duration);
    if (state.phase === 'ignition') {
      var warp = transitionTimed(state, 'warp', ['begin_warp'], carry);
      return result(state, warp, ['begin_warp']);
    }
    if (state.phase === 'warp') {
      var loading = transitionTimed(state, 'target_loading', ['load_target'], 0);
      return result(state, loading, ['load_target']);
    }
    var arrived = transitionTimed(state, 'cockpit_arrived', ['arrival_ready'], 0);
    var arrivalEvents = ['arrival_ready'];
    if (state.mode === 'portal') arrivalEvents.push('auto_complete');
    return result(state, arrived, arrivalEvents);
  }

  function move(state, phase) {
    return make({
      serial: state.serial, mode: state.mode, reducedMotion: state.reducedMotion,
      phase: phase, elapsed: 0, reason: ''
    });
  }

  function event(state, name, serial) {
    if (!validState(state) || stale(state, serial) || TERMINAL[state.phase] ||
      typeof name !== 'string') return result(state, state, []);
    var next = null, events = [];
    if (state.phase === 'target_loading' && name === 'target_ready') next = move(state, 'target_ready');
    else if (state.phase === 'target_ready' && name === 'begin_commit') next = move(state, 'committing');
    else if (state.phase === 'committing' && name === 'commit_succeeded') next = move(state, 'committed');
    else if (state.phase === 'committed' && name === 'begin_arrival') next = move(state, 'arrival');
    else if (state.phase === 'cockpit_arrived' && state.mode === 'ship' && name === 'disembark') {
      next = move(state, 'complete');
      events.push('complete');
    } else if (state.phase === 'cockpit_arrived' && state.mode === 'portal' && name === 'auto_complete') {
      next = move(state, 'complete');
      events.push('complete');
    }
    return next ? result(state, next, events) : result(state, state, []);
  }

  function abort(state, reason, serial) {
    if (!validState(state) || stale(state, serial) || TERMINAL[state.phase])
      return result(state, state, []);
    var aborted = make({
      serial: state.serial,
      mode: state.mode,
      reducedMotion: state.reducedMotion,
      phase: 'aborted',
      elapsed: 0,
      reason: safeReason(reason, 'aborted')
    });
    return result(state, aborted, ['aborted']);
  }

  function snapshot(state) {
    if (!state || typeof state !== 'object') return null;
    return {
      v: VERSION,
      serial: validSerial(state.serial) ? state.serial : 0,
      mode: validMode(state.mode) ? state.mode : 'ship',
      reducedMotion: state.reducedMotion === true,
      phase: PHASES[state.phase] ? state.phase : 'aborted',
      elapsed: finite(state.elapsed) && state.elapsed >= 0 ? Math.min(MAX_ELAPSED, state.elapsed) : 0,
      duration: durationFor(validMode(state.mode) ? state.mode : 'ship', state.reducedMotion === true,
        PHASES[state.phase] ? state.phase : 'aborted'),
      terminal: !!TERMINAL[state.phase],
      reason: state.phase === 'aborted' ? safeReason(state.reason, 'aborted') : ''
    };
  }

  return {
    create: create,
    update: update,
    event: event,
    abort: abort,
    snapshot: snapshot,
    phases: function () { return Object.keys(PHASES); }
  };
})();
