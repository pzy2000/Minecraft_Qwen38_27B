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
    approachAltitude: 13,
    approachSpeed: 8,
    finalApproachDist: 1.5,
    hoverDist: 0.5,
    turnCapture: 1.5,
    descendHomeAltitude: 2.5,
    alignAngle: 0.9,
    yawGain: 2.6,
    pitchGain: 2.2,
    minHover: 2,
    driftDist: 3.5,
    stuckTime: 0.8,
    stuckVy: 0.05,
    maxRetargets: 12,
    maxDuration: 150,
    gearOffsets: [[-1.55, -2.15], [1.55, -2.15], [-1.55, 2.15], [1.55, 2.15]],
    waterId: 7,
    maxSlope: 1,
    baseClearance: 1.02,
    maxCandidates: 600,
    exclusionRadius: 6
  };

  var PHASE_IDLE = 'idle', PHASE_BRAKE = 'brake', PHASE_TRANSIT = 'transit', PHASE_DESCEND = 'descend';
  // 机身包络盘的整数采样列（共享）：着陆点验证与下降段净空哨兵必须使用
  // 完全相同的格子集合——任何采样偏差都会把圈缘地形误报成"新增障碍"。
  var HULL_RADIUS = 8.5, HULL_STEP = 1;
  var FOOTPRINT_OFFSETS = [];
  (function () {
    for (var dx = -HULL_RADIUS; dx <= HULL_RADIUS; dx += HULL_STEP)
      for (var dz = -HULL_RADIUS; dz <= HULL_RADIUS; dz += HULL_STEP)
        if (dx * dx + dz * dz <= HULL_RADIUS * HULL_RADIUS)
          FOOTPRINT_OFFSETS.push([dx, dz]);
  })();

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
    // 第一层：4 个起落架落点必须干燥、固体、相对基准高差 ≤1（与机身停驻判据一致）。
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
    // 改道排除圈：曾经失败的目标点附近直接跳过。
    if (excluded && excluded.length) {
      for (var e = 0; e < excluded.length; e++) {
        var exd = (cx - excluded[e].x) * (cx - excluded[e].x) + (cz - excluded[e].z) * (cz - excluded[e].z);
        if (exd < o.exclusionRadius * o.exclusionRadius) return null;
      }
    }
    // 第二层：全机身投影净空验证。投影覆盖范围内每列 surfaceAt 必须落在
    // 基准(最低起落架面)+maxSlope 之内——surfaceAt 返回最高固体，任何
    // 树冠/岩柱都会抬高该值被拒；通过则整条垂直通道物理上无遮挡，
    // "正上方悬停→纯垂直下降"保证可通，不再出现贴地点邻树撞机身。
    var baseY = Math.min.apply(Math, ys);
    for (var fi = 0; fi < FOOTPRINT_OFFSETS.length; fi++) {
      var colY = worldApi.surfaceAt(Math.floor(cx + FOOTPRINT_OFFSETS[fi][0]),
        Math.floor(cz + FOOTPRINT_OFFSETS[fi][1]));
      if (!finite(colY) || colY < 0 || colY - baseY > o.maxSlope) return null;
    }
    return { x: cx, z: cz, y: baseY + o.baseClearance };
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
    var elapsed = 0, stuckT = 0, retargets = 0, lastResult = null, lastDist = null;
    var lowMode = false, climbBoost = 0, entryAlt = null, dropBlocks = 0, lastDropY = null;

    function resetResult() { lastResult = null; }

    function cancel(reason) {
      if (!active) return false;
      active = false;
      phase = PHASE_IDLE;
      target = null;
      lastDist = null;
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
      elapsed = 0; stuckT = 0; retargets = 0; lastDist = null;
      lowMode = false; climbBoost = 0;
      // 入场高度下限：高空激活时保持当前相对高度先飞到目标上空，
      // 沿已验证净空的垂直通道最后下降；进场阶段绝不提前斜穿障碍层。
      entryAlt = clamp(state.position[1] - spot.y, 0, o.maxAltitude + o.baseClearance);
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
      input.steerPitch = clamp(-(finite(state.pitch) ? state.pitch : 0) * o.pitchGain, -1, 1);
      // 架构：进场段飞到目标点正上方并刹停，然后进入纯垂直下降——
      // 下降段零转向、零水平推力，从根源杜绝"落地前一瞬间打转"。
      // 进场段的转向在低速(≤1u/s)定点修正时保留一半舵效；移动中随水平
      // 距离淡出，防止贴近目标后 atan2 对浮点噪声过敏引发持续满舵翻转。
      if (phase !== PHASE_DESCEND) {
        var yawFactor = speed <= 1 ? 0.55 : clamp((dist - o.hoverDist) / 2, 0, 1);
        input.steerYaw = clamp(err * o.yawGain, -1, 1) * yawFactor;
      }

      // 目标点换址（贴地受阻时就近另找）；新目标仍在脚边时保持下降段，
      // 不切回进场段把贴地状态重新拉回巡航高度复飞。
      function retreatTo(spot) {
        retargets++;
        if (!spot || retargets > o.maxRetargets) {
          cancel('blocked');
          result.active = false;
          result.blocked = true;
          return false;
        }
        target = spot;
        phase = Math.sqrt((spot.x - px) * (spot.x - px) + (spot.z - pz) * (spot.z - pz)) <=
          o.finalApproachDist + 0.5 ? PHASE_DESCEND : PHASE_TRANSIT;
        stuckT = 0;
        lastDist = null;
        lowMode = true;
        // 改道后保持低空平移（retreatTo 置 lowMode）：贴着当前高度横移到
        // 下一个已验证净空的着陆点，比反复爬回虚高的巡航层省几十秒。
        climbBoost = Math.min(climbBoost + 3, 12);
        result.retargeted = true;
        return true;
      }

      if (phase === PHASE_DESCEND) {
        // 已达目标点正上方：只踩垂直下降，残速由刹车收敛，不再输出任何
        // 水平推进/航向指令；机头保持搜索验证着陆点时的朝向不变。
        // 净空哨兵：v2 世界的巨型植物按区块惰性生成——验证时净空的通道
        // 可能半途长出树冠。以目标点为中心复扫与验证期完全相同的整数
        // 格集合与同一阈值（勿用船心/浮点偏移：会探到圈外产生假阳性），
        // 发现新增障碍立即就地改点（低空平移，不爬高）。
        var sentinelHit = false;
        var baseRef = target.y - o.baseClearance;
        for (var ri = 0; ri < FOOTPRINT_OFFSETS.length && !sentinelHit; ri++) {
          var colY2 = worldApi.surfaceAt(Math.floor(target.x + FOOTPRINT_OFFSETS[ri][0]),
            Math.floor(target.z + FOOTPRINT_OFFSETS[ri][1]));
          if (finite(colY2) && colY2 - baseRef > o.maxSlope) sentinelHit = true;
        }
        if (sentinelHit) {
          stuckT = 0;
          lastDist = null;
          if (!retreatTo(searchSpot(state, worldApi))) return result;
        } else {
          input.lift = -1;
          if ((finite(state.throttle) ? state.throttle : 0) > 0.02 || speed > 0.3)
            input.brake = true;
          // 偏离正上方过远必须回到进场段重新对准：机身净空只验证了目标
          // 半径内，机身边缘随偏移伸入未验证区会被邻树卡住。
          if (dist > 1.0) {
            phase = PHASE_TRANSIT;
            stuckT = 0;
            lastDist = null;
            lowMode = true;
          } else if (py > target.y + 0.4 && vy > -o.stuckVy) {
            // 下降被顶住：优先爬回障碍上方重试同一目标（垂直通道在中心区已
            // 验证，偏移卡住多因机身边缘擦树冠）；连续两次受阻才换点。
            stuckT += dt;
            if (stuckT >= o.stuckTime) {
              stuckT = 0;
              var blockedDrop = lastDropY !== null && Math.abs(py - lastDropY) < 1.5;
              dropBlocks = blockedDrop ? dropBlocks + 1 : 1;
              lastDropY = py;
              phase = PHASE_TRANSIT;
              lowMode = false;
              climbBoost = Math.min(climbBoost + 5, 16);
              if (dropBlocks >= 2 || dist > o.hoverDist + 0.2) {
                lastDist = null;
                if (!retreatTo(searchSpot(state, worldApi))) return result;
              }
            }
          } else stuckT = 0;
        }
      } else {
        var aligned = Math.abs(err) <= o.alignAngle;
        // 减速剖面以正上方悬停点(hoverDist)为零速目标；若用 finalApproachDist
        // 会在 [hoverDist, finalApproachDist] 区间形成既不推进也不转降的死区。
        var stopDist = Math.max(dist - o.hoverDist, 0);
        // 接近速度三重约束：巡航上限、刹车距离曲线、转弯捕获半径。
        // 缺最后一条时，近距离高速下最小转弯半径 v/ω 可达 5m+，
        // 飞船会反复冲过目标点绕圈（转不过弯），永远无法定点悬停。
        var allowedV = Math.min(o.approachSpeed,
          Math.sqrt(2 * o.brakeDecel * stopDist),
          dist * o.turnCapture);
        if (phase === PHASE_BRAKE) {
          // 先收油刹到安全速度，再按剩余距离转入进场或直接进入垂直下降。
          if ((finite(state.throttle) ? state.throttle : 0) > 0.02 || speed > o.landSpeed)
            input.brake = true;
          if (speed <= o.landSpeed) phase = dist <= o.hoverDist ? PHASE_DESCEND : PHASE_TRANSIT;
        } else {
          // 贴近目标点后放弃朝向门槛：近旁只需沿距离-速度曲线收敛到点上空。
          if (!aligned && dist > o.finalApproachDist) {
            input.thrust = false;
            if (speed > 0.5 || (finite(state.throttle) ? state.throttle : 0) > 0.05) input.brake = true;
          } else {
            if (speed < allowedV - 0.3) input.thrust = true;
            else if (speed > allowedV + 0.3 &&
              ((finite(state.throttle) ? state.throttle : 0) > 0.02 || speed > o.landSpeed))
              input.brake = true;
          }
          if (dist <= o.hoverDist && speed <= o.landSpeed) phase = PHASE_DESCEND;
        }
        // 高度控制：低空模式（激活时就很低、贴地改道或下降段退回）保持当前
        // 相对高度滑行，禁止复飞；正常进场保持 max(巡航高度, 入场相对高度)
        // +爬升余量飞行，先到目标上空再垂直下降。中途停滞时先退出低空模式，
        // 借爬升越过树冠/矮丘再继续收敛。
        var hoverAlt = lowMode ? Math.max(py - target.y, 0)
          : Math.max(o.approachAltitude, entryAlt || 0) + climbBoost;
        var altErr = (target.y + hoverAlt) - py;
        if (altErr > 1) input.lift = 1;
        else if (altErr < -1 && py > target.y + o.minHover) input.lift = -1;
      }
      // 进场段停滞守卫：仅当本帧明确给了推进指令（机头可行动——已对准
      // 或已很近）且距离未见有效闭合时才计卡；慢速爬行是正常收敛不算卡。
      // 两段式脱困：先退出低空模式尝试爬升越过障碍（贴近地面的水平移动
      // 常被树冠/矮丘阻挡，而上升通道是开阔的），仍无效才就近改道。
      if (phase === PHASE_TRANSIT && dist > o.hoverDist + 0.3 &&
        (Math.abs(err) <= o.alignAngle || dist <= o.finalApproachDist)) {
        var powered = input.thrust === true;
        var stalled = powered && lastDist !== null &&
          lastDist - dist < Math.max(speed * dt * 0.35, 0.002);
        if (stalled) {
          stuckT += dt;
          if (stuckT >= o.stuckTime) {
            stuckT = 0;
            if (lowMode) { lowMode = false; climbBoost = Math.min(climbBoost + 4, 12); }
            else if (!retreatTo(searchSpot(state, worldApi))) return result;
          }
        } else if (!powered) stuckT = 0;
        lastDist = powered ? dist : null;
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
