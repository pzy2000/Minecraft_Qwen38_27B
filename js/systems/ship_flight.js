// 行星内飞船驾驶：纯固定步状态机，不依赖 DOM、THREE 或具体世界实现。
window.Voxel = window.Voxel || {};

Voxel.ShipFlight = (function () {
  'use strict';

  var VERSION = 1;
  var MAX_XZ = 30000000;
  var MAX_Y = 250;
  var MAX_SPEED = 64;
  var MAX_DT = 0.1;
  var DEFAULTS = {
    maxForward: 24, maxReverse: 6, maxVertical: 8,
    forwardAccel: 12, brakeDecel: 18,
    throttleUp: 0.75, throttleDown: 1.2,
    yawRate: 70 * Math.PI / 180,
    pitchRate: 50 * Math.PI / 180,
    pitchLimit: 50 * Math.PI / 180,
    rollMax: 18 * Math.PI / 180,
    rollResponse: 4,
    keyYawRate: 34 * Math.PI / 180
  };

  function finite(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function approach(v, target, amount) {
    if (v < target) return Math.min(target, v + amount);
    if (v > target) return Math.max(target, v - amount);
    return target;
  }
  function angle(v) {
    if (!finite(v)) return 0;
    v %= Math.PI * 2;
    if (v > Math.PI) v -= Math.PI * 2;
    if (v < -Math.PI) v += Math.PI * 2;
    return v;
  }
  function vec3(raw, fallback, velocity) {
    fallback = Array.isArray(fallback) ? fallback : [0, 0, 0];
    if (!Array.isArray(raw) || raw.length !== 3 || !raw.every(finite)) return fallback.slice();
    if (velocity) {
      var mag2 = raw[0] * raw[0] + raw[1] * raw[1] + raw[2] * raw[2];
      if (mag2 > MAX_SPEED * MAX_SPEED) return fallback.slice();
    } else if (Math.abs(raw[0]) > MAX_XZ || Math.abs(raw[2]) > MAX_XZ || raw[1] < 0 || raw[1] > MAX_Y)
      return fallback.slice();
    return [raw[0], raw[1], raw[2]];
  }
  function config(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var out = {};
    for (var key in DEFAULTS) {
      var v = raw[key];
      out[key] = finite(v) && v > 0 ? v : DEFAULTS[key];
    }
    return out;
  }
  function freezeState(state) {
    Object.freeze(state.position);
    Object.freeze(state.velocity);
    Object.freeze(state);
    return state;
  }
  function make(raw, fallback) {
    raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    fallback = fallback && typeof fallback === 'object' ? fallback : {};
    var fallbackPosition = vec3(fallback.position, [0, 2, 0], false);
    var position = vec3(raw.position, fallbackPosition, false);
    var velocity = vec3(raw.velocity, [0, 0, 0], true);
    var pitch = finite(raw.pitch) ? clamp(raw.pitch, -DEFAULTS.pitchLimit, DEFAULTS.pitchLimit) : 0;
    var roll = finite(raw.roll) ? clamp(raw.roll, -DEFAULTS.rollMax, DEFAULTS.rollMax) : 0;
    return freezeState({
      v: VERSION,
      position: position,
      velocity: velocity,
      yaw: angle(raw.yaw),
      pitch: pitch,
      roll: roll,
      throttle: finite(raw.throttle) ? clamp(raw.throttle, -0.25, 1) : 0,
      landed: raw.landed === true,
      collided: false
    });
  }
  function snapshot(state) {
    if (!state || typeof state !== 'object') return {
      v: VERSION, position: [0, 2, 0], velocity: [0, 0, 0],
      yaw: 0, pitch: 0, roll: 0, throttle: 0, landed: true
    };
    return {
      v: VERSION,
      position: vec3(state.position, [0, 2, 0], false),
      velocity: vec3(state.velocity, [0, 0, 0], true),
      yaw: angle(state.yaw),
      pitch: finite(state.pitch) ? clamp(state.pitch, -DEFAULTS.pitchLimit, DEFAULTS.pitchLimit) : 0,
      roll: finite(state.roll) ? clamp(state.roll, -DEFAULTS.rollMax, DEFAULTS.rollMax) : 0,
      throttle: finite(state.throttle) ? clamp(state.throttle, -0.25, 1) : 0,
      landed: state.landed === true
    };
  }
  function normalizeInput(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      steerYaw: finite(raw.steerYaw) ? clamp(raw.steerYaw, -1, 1) : 0,
      steerPitch: finite(raw.steerPitch) ? clamp(raw.steerPitch, -1, 1) : 0,
      bank: finite(raw.bank) ? clamp(raw.bank, -1, 1) : 0,
      lift: finite(raw.lift) ? clamp(raw.lift, -1, 1) : 0,
      thrust: raw.thrust === true || (finite(raw.thrust) && raw.thrust > 0),
      brake: raw.brake === true || (finite(raw.brake) && raw.brake > 0)
    };
  }
  function step(state, dt, input, options) {
    if (!state || typeof state !== 'object' || !finite(dt) || dt <= 0) return { state: state, events: [] };
    dt = Math.min(dt, MAX_DT);
    var cfg = config(options && options.config);
    var inp = normalizeInput(input);
    var throttle = finite(state.throttle) ? clamp(state.throttle, -0.25, 1) : 0;
    if (inp.thrust) throttle = Math.min(1, throttle + cfg.throttleUp * dt);
    if (inp.brake) throttle = Math.max(-0.25, throttle - cfg.throttleDown * dt);

    var yaw = angle(state.yaw + (inp.steerYaw * cfg.yawRate + inp.bank * cfg.keyYawRate) * dt);
    var pitch = clamp((finite(state.pitch) ? state.pitch : 0) + inp.steerPitch * cfg.pitchRate * dt,
      -cfg.pitchLimit, cfg.pitchLimit);
    var rollTarget = clamp(-(inp.bank + inp.steerYaw * 0.35), -1, 1) * cfg.rollMax;
    var roll = approach(finite(state.roll) ? state.roll : 0, rollTarget, cfg.rollResponse * dt);

    var targetSpeed = throttle >= 0 ? throttle * cfg.maxForward : throttle / 0.25 * cfg.maxReverse;
    var cp = Math.cos(pitch);
    var forward = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
    var velocity = vec3(state.velocity, [0, 0, 0], true);
    var currentForward = velocity[0] * forward[0] + velocity[2] * forward[2];
    var accel = inp.brake ? cfg.brakeDecel : cfg.forwardAccel;
    currentForward = approach(currentForward, targetSpeed, accel * dt);
    var targetVy = inp.lift * cfg.maxVertical + forward[1] * Math.max(0, currentForward) * 0.38;
    var vy = approach(velocity[1], targetVy, cfg.forwardAccel * dt);
    var nextVelocity = [forward[0] * currentForward, clamp(vy, -cfg.maxVertical, cfg.maxVertical),
      forward[2] * currentForward];
    var position = vec3(state.position, [0, 2, 0], false);
    var proposed = [position[0] + nextVelocity[0] * dt,
      position[1] + nextVelocity[1] * dt,
      position[2] + nextVelocity[2] * dt];
    var resolved = null;
    if (options && typeof options.resolve === 'function') {
      try { resolved = options.resolve(position.slice(), proposed.slice(), nextVelocity.slice(), {
        yaw: yaw, pitch: pitch, roll: roll, throttle: throttle, landed: state.landed === true
      }); } catch (e) { resolved = null; }
    }
    resolved = resolved && typeof resolved === 'object' ? resolved : {};
    var resolvedPosition = Array.isArray(resolved.position) && resolved.position.length === 3 &&
      resolved.position.every(finite) ? resolved.position : proposed;
    var nextPosition = [
      clamp(resolvedPosition[0], -MAX_XZ, MAX_XZ),
      clamp(resolvedPosition[1], 0, MAX_Y),
      clamp(resolvedPosition[2], -MAX_XZ, MAX_XZ)
    ];
    nextVelocity = vec3(resolved.velocity, nextVelocity, true);
    var landed = resolved.landed === true;
    if (landed) {
      nextVelocity = [0, 0, 0];
      pitch = approach(pitch, 0, cfg.rollResponse * dt);
      roll = approach(roll, 0, cfg.rollResponse * dt);
      if (Math.abs(pitch) < 1e-4) pitch = 0;
      if (Math.abs(roll) < 1e-4) roll = 0;
      if (!inp.thrust && !inp.brake) throttle = 0;
    }
    var events = [];
    if (resolved.collided) events.push('collision');
    if (!state.landed && landed) events.push('landed');
    if (state.landed && !landed) events.push('takeoff');
    return {
      state: freezeState({
        v: VERSION, position: nextPosition, velocity: nextVelocity,
        yaw: yaw, pitch: pitch, roll: roll, throttle: throttle,
        landed: landed, collided: resolved.collided === true
      }),
      events: events
    };
  }

  return {
    VERSION: VERSION,
    DEFAULTS: Object.freeze(Object.assign({}, DEFAULTS)),
    create: function (raw, fallback) { return make(raw, fallback); },
    restore: function (raw, fallback) {
      return raw && raw.v === VERSION ? make(raw, fallback) : make(fallback, fallback);
    },
    step: step,
    snapshot: snapshot,
    normalizeInput: normalizeInput
  };
})();
