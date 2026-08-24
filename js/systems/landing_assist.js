// 着陆辅助：螺旋搜索平整干燥着陆点 + 三阶段自动驾驶（刹车/进场/垂直下降）。
// 纯逻辑模块，世界查询通过 worldApi 注入，不依赖 DOM、THREE 或具体世界实现。
window.Voxel = window.Voxel || {};

Voxel.LandingAssist = (function () {
  'use strict';

  var VERSION = 1;
  var MAX_DT = 0.1;
  var TWO_PI = Math.PI * 2;

  var DEFAULTS = {
    searchRadius: 32,
    maxAltitude: 24,
    holdMs: 600,
    landSpeed: 3,
    brakeDecel: 18,
    approachAltitude: 10,
    approachSpeed: 8,
    finalApproachDist: 1.5,
    descendHomeAltitude: 2.5,
    alignAngle: 0.9,
    yawGain: 2.6,
    pitchGain: 2.2,
    minHover: 2,
    driftDist: 3.5,
    stuckTime: 0.8,
    stuckVy: 0.05,
    maxRetargets: 4,
    maxDuration: 90,
    gearOffsets: [[-1.55, -2.15], [1.55, -2.15], [-1.55, 2.15], [1.55, 2.15]],
    waterId: 7,
    maxSlope: 1,
    baseClearance: 1.02,
    maxCandidates: 600,
    exclusionRadius: 2.5
  };

  var PHASE_IDLE = 'idle', PHASE_BRAKE = 'brake', PHASE_TRANSIT = 'transit', PHASE_DESCEND = 'descend';

  function finite(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function config(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var out = {};
    for (var key in DEFAULTS) {
      var v = raw[key];
      if (key === 'gearOffsets') {
        out[key] = Array.isArray(v) && v.length > 0 &&
          v.every(function (g) { return Array.isArray(g) && g.length >= 2 && finite(g[0]) && finite(g[1]); })
            ? v.map(function (g) { return [g[0], g[1]]; }) : DEFAULTS[key].map(function (g) { return g.slice(); });
      } else if (typeof DEFAULTS[key] === 'number') {
        out[key] = finite(v) && v > 0 ? v : DEFAULTS[key];
      } else out[key] = DEFAULTS[key];
    }
    return out;
  }

  function validState(state) {
    return !!(state && typeof state === 'object' && Array.isArray(state.position) &&
      Array.isArray(state.velocity) && state.position.concat(state.velocity).every(finite));
  }

  function wrapAngle(v) {
    v %= TWO_PI;
    if (v > Math.PI) v -= TWO_PI;
    if (v < -Math.PI) v += TWO_PI;
    return v;
  }

  function zeroInput() {
    return { steerYaw: 0, steerPitch: 0, bank: 0, lift: 0, thrust: false, brake: false };
  }

  function validWorldApi(api) {
    return !!(api && typeof api.surfaceAt === 'function' && typeof api.get === 'function' &&
      typeof api.isSolid === 'function');
  }

  function evaluateSpot(worldApi, o, cx, cz, yaw, excluded) {
    var c = Math.cos(yaw), s = Math.sin(yaw);
    var ys = [], dry = true;
    for (var i = 0; i < o.gearOffsets.length; i++) {
      var g = o.gearOffsets[i];
      var wx = cx + g[0] * c + g[1] * s;
      var wz = cz - g[0] * s + g[1] * c;
      var gx = Math.floor(wx), gz = Math.floor(wz);
      var gy = worldApi.surfaceAt(gx, gz);
      if (!finite(gy) || gy < 0 || gy > 255) return null;
      var ground = worldApi.get(gx, Math.floor(gy), gz);
      if (!worldApi.isSolid(ground) || ground === o.waterId) dry = false;
      ys.push(gy);
    }
    if (!dry) return null;
    var minY = Math.min.apply(Math, ys), maxY = Math.max.apply(Math, ys);
    // 与原版 landingSurface 判据一致：只要求起落架落点干燥、固体、高差≤1；
    // 不再扫描整个机身投影，否则森林地形几乎无可着陆点。
    if (maxY - minY > o.maxSlope) return null;
    var centerY = worldApi.surfaceAt(Math.floor(cx), Math.floor(cz));
    if (!finite(centerY) || centerY > maxY) return null;
    if (excluded && excluded.length) {
      for (var e = 0; e < excluded.length; e++) {
        var exd = (cx - excluded[e].x) * (cx - excluded[e].x) + (cz - excluded[e].z) * (cz - excluded[e].z);
        if (exd < o.exclusionRadius * o.exclusionRadius) return null;
      }
    }
    return { x: cx, z: cz, y: maxY + o.baseClearance };
  }

  function findLandingSpot(worldApi, x, z, yaw, options) {
    if (!validWorldApi(worldApi)) return null;
    var o = config(options);
    if (!finite(x) || !finite(z) || !finite(yaw)) return null;
    var excluded = Array.isArray(options && options.excluded) ? options.excluded.filter(function (p) {
      return p && finite(p.x) && finite(p.z);
    }) : [];
    var originX = Math.round(x / 2) * 2, originZ = Math.round(z / 2) * 2;
    var rings = Math.floor(o.searchRadius / 2);
    // 半径 r 的步长2方形螺旋共有 1 + 8 * (1 + ... + floor(r/2)) 个点。
    // maxCandidates 仍可扩大预算，但不能截断调用方明确要求的搜索半径。
    var candidateLimit = Math.max(o.maxCandidates, 1 + 4 * rings * (rings + 1));
    var seen = {}, evaluated = 0;
    for (var r = 0; r <= o.searchRadius; r += 2) {
      var cells = [];
      if (r === 0) cells.push([originX, originZ]);
      else for (var i = -r; i <= r; i += 2) {
        cells.push([originX + i, originZ - r], [originX + i, originZ + r],
          [originX - r, originZ + i], [originX + r, originZ + i]);
      }
      for (var k = 0; k < cells.length; k++) {
        var cx = cells[k][0], cz = cells[k][1];
        var key = cx + '_' + cz;
        if (seen[key]) continue;
        seen[key] = true;
        if (++evaluated > candidateLimit) return null;
        var spot = evaluateSpot(worldApi, o, cx, cz, yaw, excluded);
        if (spot) return spot;
      }
    }
    return null;
  }

  function create(raw) {
    var o = config(raw);
    var active = false, phase = PHASE_IDLE, target = null;
    var elapsed = 0, stuckT = 0, retargets = 0, lastResult = null;

    function resetResult() { lastResult = null; }

    function cancel(reason) {
      if (!active) return false;
      active = false;
      phase = PHASE_IDLE;
      target = null;
      lastResult = String(reason || 'cancelled');
      return true;
    }

    function searchSpot(state, worldApi, extraExcluded) {
      var excluded = [];
      if (target) excluded.push({ x: target.x, z: target.z });
      if (Array.isArray(extraExcluded)) excluded = excluded.concat(extraExcluded);
      return findLandingSpot(worldApi, state.position[0], state.position[2],
        state.yaw, Object.assign({}, o, { excluded: excluded }));
    }

    function begin(state, worldApi) {
      resetResult();
      if (!validState(state)) return { ok: false, reason: 'state' };
      if (!validWorldApi(worldApi)) return { ok: false, reason: 'world' };
      if (state.landed) return { ok: false, reason: 'landed' };
      var surface = worldApi.surfaceAt(Math.floor(state.position[0]), Math.floor(state.position[2]));
      var altitude = finite(surface) ? state.position[1] - surface - o.baseClearance : Infinity;
      if (altitude > o.maxAltitude) return { ok: false, reason: 'high', altitude: altitude };
      var spot = searchSpot(state, worldApi);
      if (!spot) return { ok: false, reason: 'nospot' };
      active = true;
      phase = PHASE_BRAKE;
      target = spot;
      elapsed = 0; stuckT = 0; retargets = 0;
      return { ok: true, spot: { x: spot.x, y: spot.y, z: spot.z } };
    }

    function tick(state, dt, worldApi) {
      var result = { input: zeroInput(), active: active, phase: phase, distance: null,
        expired: false, blocked: false, retargeted: false };
      if (!active) return result;
      if (!validState(state) || !finite(dt) || dt <= 0 || !validWorldApi(worldApi)) {
        cancel('invalid');
        result.active = false;
        result.blocked = true;
        return result;
      }
      dt = Math.min(dt, MAX_DT);
      elapsed += dt;
      if (elapsed > o.maxDuration) {
        cancel('expired');
        result.active = false;
        result.expired = true;
        return result;
      }
      var px = state.position[0], py = state.position[1], pz = state.position[2];
      var vx = state.velocity[0], vy = state.velocity[1], vz = state.velocity[2];
      var speed = Math.sqrt(vx * vx + vz * vz);
      var dx = target.x - px, dz = target.z - pz;
      var dist = Math.sqrt(dx * dx + dz * dz);
      result.distance = dist;

      var input = result.input;
      var err = wrapAngle(Math.atan2(-dx, -dz) - state.yaw);
      input.steerYaw = clamp(err * o.yawGain, -1, 1);
      input.steerPitch = clamp(-(finite(state.pitch) ? state.pitch : 0) * o.pitchGain, -1, 1);

      if (phase === PHASE_DESCEND) {
        input.lift = -1;
        if (state.throttle > 0.02 || speed > o.landSpeed) input.brake = true;
        // 尚有高度时继续水平归位，避免偏离验证过的着陆点。
        if (dist > 0.75 && py > target.y + o.descendHomeAltitude &&
          Math.abs(err) <= o.alignAngle && speed < o.approachSpeed)
          input.thrust = true;
        if (dist > o.driftDist) {
          phase = PHASE_TRANSIT;
          stuckT = 0;
        } else if (py > target.y + 0.4 && vy > -o.stuckVy) {
          stuckT += dt;
          if (stuckT >= o.stuckTime) {
            stuckT = 0;
            retargets++;
            var spot = searchSpot(state, worldApi);
            if (!spot || retargets > o.maxRetargets) {
              cancel('blocked');
              result.active = false;
              result.blocked = true;
              return result;
            }
            target = spot;
            phase = PHASE_TRANSIT;
            result.retargeted = true;
          }
        } else stuckT = 0;
      } else {
        var aligned = Math.abs(err) <= o.alignAngle;
        var stopDist = Math.max(dist - o.finalApproachDist, 0);
        var allowedV = Math.min(o.approachSpeed, Math.sqrt(2 * o.brakeDecel * stopDist));
        if (phase === PHASE_BRAKE) {
          if (state.throttle > 0.02 || speed > o.landSpeed) input.brake = true;
          if (speed <= o.landSpeed) phase = dist <= o.finalApproachDist + 1 ? PHASE_DESCEND : PHASE_TRANSIT;
        } else if (phase === PHASE_TRANSIT) {
          if (!aligned) {
            input.thrust = false;
            if (speed > 0.5 || state.throttle > 0.05) input.brake = true;
          } else if (speed < allowedV - 0.3) input.thrust = true;
          else if (speed > allowedV + 0.3 && (state.throttle > 0.02 || speed > o.landSpeed)) input.brake = true;
          if (dist <= o.finalApproachDist && speed <= o.landSpeed) phase = PHASE_DESCEND;
        }
        var altErr = (target.y + o.approachAltitude) - py;
        if (altErr > 1) input.lift = 1;
        else if (altErr < -1 && py > target.y + o.minHover) input.lift = -1;
      }
      result.phase = phase;
      return result;
    }

    function notifyLanded() {
      if (!active) return false;
      active = false;
      phase = PHASE_IDLE;
      target = null;
      lastResult = 'completed';
      return true;
    }

    function status() {
      return {
        active: active,
        phase: phase,
        target: target ? { x: target.x, y: target.y, z: target.z } : null,
        elapsed: elapsed,
        retargets: retargets,
        lastResult: lastResult
      };
    }

    return {
      begin: begin,
      tick: tick,
      cancel: cancel,
      notifyLanded: notifyLanded,
      isActive: function () { return active; },
      getPhase: function () { return phase; },
      getTarget: function () { return target ? { x: target.x, y: target.y, z: target.z } : null; },
      status: status
    };
  }

  return {
    VERSION: VERSION,
    PHASES: Object.freeze({ IDLE: PHASE_IDLE, BRAKE: PHASE_BRAKE, TRANSIT: PHASE_TRANSIT, DESCEND: PHASE_DESCEND }),
    DEFAULTS: Object.freeze(Object.assign({}, DEFAULTS)),
    create: create,
    findLandingSpot: findLandingSpot,
    config: config
  };
})();
