// 北欧城堡观感契约（Node，无浏览器）：
//   1. 大气 profile 的新字段（极光取色 / 谷雾 / 分级 / 曝光 / 视距）确定性且在合理量程内；
//   2. 老主题不受影响 —— 未声明这些字段的世界必须保持中性，金标截图观感不变；
//   3. 峡湾全景的竖向包络：雪脊按 ah 缩放后不得越过内容封顶（光照快路径的前提）；
//   4. 构图距离：出生眼位到雪脊前缘必须落在雾尾之内，否则整片山体会被雾吃掉；
//   5. 自发光门槛只挑真正的灯具，不会让整座城堡泛光。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = {
  window: {}, console, Math, BigInt, Uint8Array, Uint16Array, Uint32Array,
  Int16Array, Float32Array, Set,
  THREE: {
    Vector3: function (x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; },
    Group: function () { this.children = []; this.parent = null; }
  }
};
sandbox.window = sandbox;
sandbox.THREE.Group.prototype.add = function (o) { this.children.push(o); o.parent = this; };
sandbox.THREE.Group.prototype.remove = function (o) {
  const i = this.children.indexOf(o);
  if (i >= 0) this.children.splice(i, 1);
  if (o) o.parent = null;
};
vm.createContext(sandbox);
function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
}

load('js/config.js');
load('js/world/seed.js');
load('js/world/universe.js');
load('js/world/galaxy.js');
load('js/systems/atmosphere_profiles.js');
load('js/world/noise.js');
load('js/world/biomes.js');
load('js/world/planet_rules.js');
load('js/world/shaper.js');
load('js/world/structures.js');
load('js/world/gen_core.js');
load('js/blocks.js');
load('js/world/world.js');
load('js/world/infinite.js');
load('js/systems/settings.js');

const V = sandbox.Voxel;
const CFG = V.Config;
let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name + (detail ? ' :: ' + detail : ''));
  else { failed++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}

console.log('北欧主题大气 profile 新字段');
const AP = V.AtmosphereProfiles;
const nordic = AP.profileFor('nordic', '24601');

check('极光三段取色齐全且非零', !!nordic.aurora &&
  nordic.aurora.low > 0 && nordic.aurora.mid > 0 && nordic.aurora.high > 0);
check('极光底段偏绿（G 分量为最大）',
  ((nordic.aurora.low >> 8) & 255) > ((nordic.aurora.low >> 16) & 255) &&
  ((nordic.aurora.low >> 8) & 255) > (nordic.aurora.low & 255));
check('谷雾启用且雾基线高于湖面', nordic.heightFog.falloff > 0 &&
  nordic.heightFog.strength > 0 && nordic.heightFog.base > CFG.WATER_LEVEL,
  'base=' + nordic.heightFog.base);
check('分级覆盖齐全且在量程内', !!nordic.grade &&
  nordic.grade.contrast > 0 && nordic.grade.contrast <= 1 &&
  nordic.grade.saturation >= 0.5 && nordic.grade.saturation <= 2 &&
  nordic.grade.vignette >= 0 && nordic.grade.vignette <= 0.8);
check('地表曝光大于 1（长曝光式极夜）', nordic.exposure > 1 && nordic.exposure <= 4,
  'exposure=' + nordic.exposure);
check('声明远景视距与深水色', nordic.viewBoost === true && nordic.deepWater > 0);
check('ambientFloor 不再被静默截断到 0.5', nordic.ambientFloor > 0.5,
  'ambientFloor=' + nordic.ambientFloor.toFixed(3));
check('profile 确定性复现',
  JSON.stringify(nordic) === JSON.stringify(AP.profileFor('nordic', '24601')));

console.log('老主题保持中性（金标观感不变）');
AP.keys().filter(k => k !== 'nordic').forEach(function (key) {
  const p = AP.profileFor(key, '12345');
  check(key + ' 无谷雾/无分级覆盖/无视距抬升/中性曝光与块光',
    p.heightFog.falloff === 0 && p.heightFog.strength === 0 &&
    p.grade === null && p.viewBoost === false &&
    p.exposure === 1 && p.blockLightTint === 0xffffff && p.deepWater === 0);
});

console.log('自发光门槛');
const LIGHT = V.Blocks.LIGHT;
// mesh.js 的 EMIT_MIN_LIGHT=12：只有火把级以上参与 Bloom，
// 金饰块(2)/辉光饰条(7) 这类弱发光装饰必须排除，否则整座城堡泛光。
const EMIT_MIN_LIGHT = 12;
check('灯笼/火把在自发光集合内',
  LIGHT[79] >= EMIT_MIN_LIGHT && LIGHT[19] >= EMIT_MIN_LIGHT);
check('金饰块与白漆栏杆不参与自发光',
  LIGHT[78] < EMIT_MIN_LIGHT && LIGHT[80] < EMIT_MIN_LIGHT);
check('白灰泥墙/绯红瓦/黑沙/片麻岩均不发光',
  !LIGHT[218] && !LIGHT[217] && !LIGHT[215] && !LIGHT[216]);

console.log('画质档位与降质链');
const presets = CFG.PERF_PRESETS;
['smooth', 'balanced', 'high'].forEach(function (k) {
  const p = presets[k];
  check(k + ' 含 waterReflect/heightFog/viewBoost 三键',
    typeof p.waterReflect === 'number' && typeof p.heightFog === 'number' &&
    typeof p.viewBoost === 'number');
});
check('流畅档关闭全部新特效',
  presets.smooth.waterReflect === 0 && presets.smooth.heightFog === 0 &&
  presets.smooth.viewBoost === 0);
check('仅高画质档开启远景视距',
  presets.balanced.viewBoost === 0 && presets.high.viewBoost === 1);
check('新键均在 Settings 表与限幅表内', ['waterReflect', 'heightFog', 'viewBoost']
  .every(k => k in V.Settings.defaults && k in V.Settings.limits));
check('触屏首启不抬远景视距', V.Settings.touchDefaults.viewBoost === 0);
check('远景视距半径大于基础流式半径',
  CFG.VIEW_BOOST_RADIUS > CFG.STREAM_RENDER_RADIUS,
  CFG.VIEW_BOOST_RADIUS + ' > ' + CFG.STREAM_RENDER_RADIUS);

console.log('峡湾全景的竖向包络与构图距离');
V.World.init('24601', { id: 'planet-0', kind: 'planet', typeKey: 'nordic', terrainVersion: 2 });
const vista = V.Structures.nearestVistaTo(0, 0, 6);
check('产出峡湾全景站点', !!vista);
if (vista) {
  const L = V.Structures.vistaLayout();
  const CS = CFG.CHUNK;
  const R = L.diskR + 24;
  for (let cx = Math.floor((vista.ax - R) / CS); cx <= Math.floor((vista.ax + R) / CS); cx++)
    for (let cz = Math.floor((vista.az - R) / CS); cz <= Math.floor((vista.az + R) / CS); cz++)
      V.World.ensureChunk(cx, cz);

  function topAt(lx, lz) {
    for (let y = CFG.WORLD_H - 1; y > 0; y--)
      if (V.World.get(vista.ax + lx, y, vista.az + lz) !== 0) return y;
    return 0;
  }

  let ridgeTop = 0;
  for (let lx = -150; lx <= 150; lx += 3)
    for (let lz = L.diskCz - L.diskR + 4; lz <= L.diskCz - 40; lz += 3)
      ridgeTop = Math.max(ridgeTop, topAt(lx, lz));
  check('雪脊峰顶不越过内容封顶', ridgeTop <= CFG.CONTENT_NATURAL_TOP,
    ridgeTop + ' <= ' + CFG.CONTENT_NATURAL_TOP);
  check('雪脊足够高（相对锚点）', ridgeTop - vista.ah >= 50,
    '+' + (ridgeTop - vista.ah));

  // 剪影来源：沿出生眼位向正北取"最高仰角"的地表点，它就是画面里山脊的来源。
  // 这个距离必须落在雾尾之内（远景视距档位下 fogFar = (半径-1)×区块），
  // 否则山体会被雾整片抹平 —— 这正是改造前最大的观感缺陷。
  const eyeY = vista.ah + 1.25 + 1.4 + 9;
  function silhouette(offsetX) {
    let bestAng = -9, bestDist = 0, bestId = 0;
    for (let d = 20; d <= 300; d += 2) {
      const lx = L.spawn.dx + offsetX, lz = L.spawn.dz - d;
      const y = topAt(lx, lz);
      if (!y) continue;
      const ang = Math.atan2(y - eyeY, d);
      if (ang > bestAng) {
        bestAng = ang; bestDist = d;
        bestId = V.World.get(vista.ax + lx, y, vista.az + lz);
      }
    }
    return { ang: bestAng, dist: bestDist, id: bestId };
  }
  const fogFar = (CFG.VIEW_BOOST_RADIUS - 1) * CFG.CHUNK;
  // 偏 70 格避开城堡本体，取到的就是雪脊
  const ridge = silhouette(70);
  check('雪脊剪影落在远景雾尾之内且是雪面', ridge.dist < fogFar && ridge.id === 18,
    ridge.dist + ' < ' + fogFar + '，顶块 ' + V.Blocks.name(ridge.id));
  check('雪脊剪影仰角足够（山体占画面）', ridge.ang > 0.13,
    (ridge.ang * 57.2958).toFixed(1) + '°');
  // 正前方是城堡：必须比雪脊更高才能成为构图主体
  const keep = silhouette(0);
  check('城堡在正前方压过雪脊成为主体', keep.ang > ridge.ang && keep.dist < ridge.dist,
    (keep.ang * 57.2958).toFixed(1) + '° @ ' + keep.dist + ' 格');

  // 出生点前方必须能看见湖面：眼位与岸线之间不得被草丘挡死
  const shoreZ = L.lake.cz + L.lake.rz;
  check('出生点与岸线之间留出前景沙滩',
    L.spawn.dz - shoreZ >= 20 && L.spawn.dz - shoreZ <= 60,
    (L.spawn.dz - shoreZ) + ' 格');
  let clearApron = true;
  for (let d = 1; d <= 10; d++)
    if (topAt(L.spawn.dx, L.spawn.dz - d) > vista.ah + 1) clearApron = false;
  check('出生眼位前 10 格无草丘遮挡', clearApron);
}

console.log(failed ? '\n' + failed + ' 项失败 ✗' : '\n全部通过 ✓');
process.exit(failed ? 1 : 0);
