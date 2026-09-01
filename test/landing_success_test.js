// 自动着陆成功率回归（高保真仿真，独立运行：node test/landing_success_test.js）
// - 真实世界生成（Galaxy 目录行星条目 + World.init/generateNext 全量生成）
// - 移植生产解析器语义（AABB 包络、半砖、扫掠步进、地板钳制、贴地沉降辅助）
// - 场景矩阵：地形类别 × 激活高度 × 激活速度 × 航向误差 × 垂直速度
// 判据：完成软着陆且落点距目标点 ≤3m。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
}
const sandbox = { window: {}, console, Math, BigInt, Uint8Array, Uint16Array, Uint32Array, Int16Array, Float32Array };
sandbox.window = sandbox;
vm.createContext(sandbox);
['js/config.js', 'js/world/seed.js', 'js/world/universe.js', 'js/world/galaxy.js',
  'js/systems/atmosphere_profiles.js', 'js/world/noise.js', 'js/world/biomes.js',
  'js/world/planet_rules.js', 'js/world/shaper.js', 'js/world/sections.js', 'js/world/gen_core.js', 'js/blocks.js',
  'js/world/world.js', 'js/world/light.js', 'js/world/infinite.js',
  'js/systems/ship_flight.js', 'js/systems/landing_assist.js'
].forEach(load);

const V = sandbox.window.Voxel;
const F = V.ShipFlight, LA = V.LandingAssist, CFG = V.Config.SHIP_FLIGHT;

// ---------- 生产解析器移植 ----------
const SHIP_LOCAL_MIN = [-5.8, 0, -6.2];
const SHIP_LOCAL_MAX = [5.8, 3.15, 5.05];
const GEAR_LOCAL = [[-1.55, 0, -2.15], [1.55, 0, -2.15], [-1.55, 0, 2.15], [1.55, 0, 2.15]];

function rotPoint(lx, ly, lz, pos, pitch, yaw, roll) {
  let x = lx, y = ly, z = lz;
  let c = Math.cos(roll), s = Math.sin(roll);
  let t = x * c - y * s; y = x * s + y * c; x = t;
  c = Math.cos(pitch); s = Math.sin(pitch);
  t = y * c - z * s; z = y * s + z * c; y = t;
  c = Math.cos(yaw); s = Math.sin(yaw);
  t = x * c + z * s; z = -x * s + z * c; x = t;
  return [pos[0] + x, pos[1] + y, pos[2] + z];
}
function bounds(pos, att) {
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  const p = att.pitch || 0, w = att.yaw || 0, r = att.roll || 0;
  for (let xi = 0; xi < 2; xi++) for (let yi = 0; yi < 2; yi++) for (let zi = 0; zi < 2; zi++) {
    const q = rotPoint(xi ? SHIP_LOCAL_MAX[0] : SHIP_LOCAL_MIN[0],
      yi ? SHIP_LOCAL_MAX[1] : SHIP_LOCAL_MIN[1],
      zi ? SHIP_LOCAL_MAX[2] : SHIP_LOCAL_MIN[2], pos, p, w, r);
    if (q[0] < mnx) mnx = q[0]; if (q[0] > mxx) mxx = q[0];
    if (q[1] < mny) mny = q[1]; if (q[1] > mxy) mxy = q[1];
    if (q[2] < mnz) mnz = q[2]; if (q[2] > mxz) mxz = q[2];
  }
  return { mnx, mny, mnz, mxx, mxy, mxz };
}
function collisionCount(pos, att) {
  const b = bounds(pos, att);
  const x0 = Math.floor(b.mnx + 0.01), x1 = Math.floor(b.mxx - 0.01);
  const y0 = Math.max(0, Math.floor(b.mny + 0.01));
  const y1 = Math.min((V.Config.WORLD_H || 64) - 1, Math.floor(b.mxy - 0.01));
  const z0 = Math.floor(b.mnz + 0.01), z1 = Math.floor(b.mxz - 0.01);
  let checked = 0, col = 0;
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) {
    if (++checked > 8192) return 8192;
    const id = V.World.get(x, y, z);
    if (!V.Blocks.isSolid(id)) continue;
    const top = y + (V.Blocks.defs[id] && V.Blocks.defs[id].half ? 0.5 : 1);
    if (b.mny < top - 0.01 && b.mxy > y + 0.01) col++;
  }
  return col;
}
function landingSurface(pos, att) {
  const ys = []; let dry = true;
  const c = Math.cos(att.yaw || 0), s = Math.sin(att.yaw || 0);
  for (let i = 0; i < GEAR_LOCAL.length; i++) {
    const gx = Math.floor(pos[0] + GEAR_LOCAL[i][0] * c + GEAR_LOCAL[i][2] * s);
    const gz = Math.floor(pos[2] - GEAR_LOCAL[i][0] * s + GEAR_LOCAL[i][2] * c);
    const gy = V.World.surfaceAt(gx, gz);
    const ground = V.World.get(gx, gy, gz);
    if (!V.Blocks.isSolid(ground) || ground === 7) dry = false;
    ys.push(gy);
  }
  const mn = Math.min.apply(Math, ys), mx = Math.max.apply(Math, ys);
  return { stable: dry && mx - mn <= 1, y: mx + CFG.SHIP_BASE_CLEARANCE };
}
let lastLandingPose = null;
function resolveFlightMove(from, proposed, velocity, attitude) {
  const fromC = from.slice(), prop = proposed.slice(), vel = velocity.slice();
  let surface = V.World.surfaceAt(Math.floor(prop[0]), Math.floor(prop[2]));
  let minY = surface + CFG.SHIP_BASE_CLEARANCE;
  const maxY = Math.min(CFG.MAX_ABSOLUTE_Y, minY + CFG.MAX_ALTITUDE);
  const floorContact = prop[1] <= minY + 0.001 && vel[1] < 0;
  prop[1] = Math.max(minY, Math.min(maxY, prop[1]));
  const dx = prop[0] - fromC[0], dy = prop[1] - fromC[1], dz = prop[2] - fromC[2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (attitude.landed && distance < 1e-7)
    return { position: fromC.slice(), velocity: [0, 0, 0], landed: true, collided: false };
  const steps = Math.max(1, Math.ceil(distance / CFG.SWEEP_STEP));
  const cur = fromC.slice(); let collided = false;
  let cc = collisionCount(cur, attitude);
  const sx = dx / steps, sy = dy / steps, sz = dz / steps;
  const takeoffAssist = sy > 0 && fromC[1] - minY < 4;
  for (let ss = 0; ss < steps; ss++) {
    if (Math.abs(sx) > 1e-9) {
      const nx = [cur[0] + sx, cur[1], cur[2]];
      const xc = collisionCount(nx, attitude);
      if (xc === 0 || xc < cc) { cur[0] = nx[0]; cc = xc; } else { vel[0] = 0; collided = true; }
    }
    if (Math.abs(sz) > 1e-9) {
      const nz = [cur[0], cur[1], cur[2] + sz];
      const zc = collisionCount(nz, attitude);
      if (zc === 0 || zc < cc) { cur[2] = nz[2]; cc = zc; } else { vel[2] = 0; collided = true; }
    }
    if (Math.abs(sy) > 1e-9) {
      const ny = [cur[0], cur[1] + sy, cur[2]];
      const yc = collisionCount(ny, attitude);
      const hs = Math.sqrt(vel[0] * vel[0] + vel[2] * vel[2]);
      // 与生产 resolveFlightMove 一致的贴地沉降辅助
      const settleAssist = sy < 0 && hs <= 0.6 && yc <= Math.max(cc, 1);
      if (takeoffAssist || yc === 0 || yc < cc ||
        (sy > 0 && yc <= cc) || settleAssist) { cur[1] = ny[1]; cc = yc; }
      else { vel[1] = 0; collided = true; }
    }
  }
  surface = V.World.surfaceAt(Math.floor(cur[0]), Math.floor(cur[2]));
  minY = surface + CFG.SHIP_BASE_CLEARANCE;
  if (cur[1] < minY) { cur[1] = minY; vel[1] = Math.max(0, vel[1]); collided = true; }
  if (floorContact && cur[1] <= minY + 0.03) vel[1] = 0;
  const speed = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2]);
  const landing = landingSurface(cur, attitude);
  if (!landing.stable && lastLandingPose) {
    const ldx = cur[0] - lastLandingPose[0], ldz = cur[2] - lastLandingPose[2];
    if (ldx * ldx + ldz * ldz <= 4) landing = { stable: true, y: lastLandingPose[1] };
  }
  const canLand = landing.stable && vel[1] <= 0.05 && speed <= CFG.LAND_SPEED &&
    Math.abs(attitude.pitch || 0) <= 0.17 && Math.abs(attitude.roll || 0) <= 0.17 &&
    cur[1] <= landing.y + 0.28;
  if (canLand) { cur[1] = landing.y; vel[0] = vel[1] = vel[2] = 0; }
  return { position: cur, velocity: vel, landed: canLand, collided };
}

// ---------- 场景矩阵 ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function classifySite(cx, cz) {
  let water = 0; const hs = [];
  for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
    const h = V.World.surfaceAt(cx + dx, cz + dz);
    const id = V.World.get(cx + dx, h, cz + dz);
    hs.push(h);
    if (id === 7 || !V.Blocks.isSolid(id)) water++;
  }
  const sorted = hs.slice().sort((a, b) => a - b);
  const median = sorted[(sorted.length / 2) | 0];
  let canopy = 0;
  for (const h of hs) if (h - median >= 3) canopy++;
  const slope = Math.max.apply(Math, hs) - Math.min.apply(Math, hs);
  if (water >= 20) return 'water';
  if (canopy >= 8) return 'forest';
  if (slope >= 6) return 'mountain';
  if (slope >= 2) return 'rough';
  return 'flat';
}
const worldApi = {
  surfaceAt(x, z) { return V.World.surfaceAt(x, z); },
  get(x, y, z) { return V.World.get(x, y, z); },
  isSolid(id) { return !!V.Blocks.isSolid(id); }
};
const FLIGHT_CFG = {
  maxForward: 24, maxReverse: 6, maxVertical: 8, forwardAccel: CFG.FORWARD_ACCEL,
  brakeDecel: CFG.BRAKE_DECEL, throttleUp: CFG.THROTTLE_UP, throttleDown: CFG.THROTTLE_DOWN,
  yawRate: CFG.YAW_RATE, pitchRate: CFG.PITCH_RATE, pitchLimit: CFG.PITCH_LIMIT,
  rollMax: CFG.ROLL_MAX, rollResponse: CFG.ROLL_RESPONSE, keyYawRate: CFG.KEY_YAW_RATE
};

function runScenario(scen) {
  const gY = V.World.surfaceAt(Math.floor(scen.x), Math.floor(scen.z));
  const state = F.create({
    position: [scen.x, Math.min(gY + CFG.SHIP_BASE_CLEARANCE + scen.altRel, CFG.MAX_ABSOLUTE_Y - 4), scen.z],
    velocity: [-Math.sin(scen.moveDir) * scen.speed, scen.vy, -Math.cos(scen.moveDir) * scen.speed],
    yaw: scen.yaw, pitch: 0, roll: 0, throttle: Math.min(1, scen.speed / 24), landed: false
  });
  const ctrl = LA.create({});
  const eng = ctrl.begin(state, worldApi);
  if (!eng.ok) return { ok: false, why: eng.reason };
  let st = state, landedEvent = false;
  const dt = 1 / 60, maxS = Math.ceil((LA.DEFAULTS.maxDuration + 2) * 60);
  for (let i = 0; i < maxS; i++) {
    if (!ctrl.status().active) break;
    const a = ctrl.tick(st, dt, worldApi);
    const r = F.step(st, dt, a.input, { config: FLIGHT_CFG, resolve: resolveFlightMove });
    st = r.state;
    if (r.events.indexOf('landed') >= 0) { landedEvent = true; ctrl.notifyLanded(); break; }
  }
  if (!landedEvent) return { ok: false, why: 'result=' + ctrl.status().lastResult };
  const tgt = ctrl.status().target;
  const off = tgt ? Math.hypot(st.position[0] - tgt.x, st.position[2] - tgt.z) : 0;
  return { ok: off <= 3, why: off <= 3 ? 'landed' : 'drifted:' + off.toFixed(1) };
}

console.log('着陆成功率回归（高保真仿真）');
let failed = 0;
let total = 0, wins = 0;
const terrainAgg = {};
for (const seedStr of ['12345', '777777']) {
  const planets = V.Galaxy.create(seedStr).catalog.filter(w => w.kind === 'planet').slice(0, 2);
  for (const planet of planets) {
    V.World.init(planet.seed, planet);
    while (!V.World.isReady()) V.World.generateNext(64);
    lastLandingPose = null;
    const rng = mulberry32(V.SeedUtil.derive32(V.SeedUtil.parse(seedStr + ':' + planet.id), 99));
    for (let site = 0; site < 8; site++) {
      const cx = 40 + Math.floor(rng() * 176), cz = 40 + Math.floor(rng() * 176);
      if (V.World.surfaceAt(cx, cz) < 0) continue;
      const kind = classifySite(cx, cz);
      if (kind === 'water') continue;
      const altRel = [2, 5, 10, 16][site % 4];
      const speed = [0, 8, 14, 20][(site >> 2) % 4];
      const yawErrDeg = [0, 45, 130, 200][site % 4];
      const moveDirRaw = rng() * Math.PI * 2;
      const vy = [0, -2, 2, 0][site % 4];
      try {
        const r = runScenario({
          x: cx + (rng() * 6 - 3), z: cz + (rng() * 6 - 3),
          altRel, speed, moveDir: moveDirRaw,
          yaw: moveDirRaw + yawErrDeg * Math.PI / 180, vy
        });
        total++; if (r.ok) wins++;
        const b = (terrainAgg[kind] = terrainAgg[kind] || { n: 0, win: 0 });
        b.n++; if (r.ok) b.win++;
      } catch (e) {
        failed++;
        console.log('  FAIL 异常 ' + seedStr + '/' + planet.id + ': ' + e.message);
      }
    }
  }
}
for (const k of Object.keys(terrainAgg).sort()) {
  const b = terrainAgg[k];
  console.log('  ' + k.padEnd(9) + ' ' + b.win + '/' + b.n +
    ' (' + Math.round(100 * b.win / b.n) + '%)');
}
const pct = wins / Math.max(total, 1);
console.log('  总体 ' + wins + '/' + total + ' (' + Math.round(100 * pct) + '%)');
// 阈值说明：对抗性矩阵（随机航向误差至200°、激活时树冠内、高速）历史基线：
//   修复前 ~25%，当前 ~85%。取 60% 容忍未来群系参数微调的波动，
//   同时能拦住任何方向性的倒退。
if (!(pct >= 0.6)) { console.log('  FAIL 总体成功率低于 60% 阈值'); failed++; }
if (!(total >= 30)) { console.log('  FAIL 样本量不足: ' + total); failed++; }

process.exit(failed ? 1 : 0);
