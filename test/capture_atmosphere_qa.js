// 固定同一真实地表，逐类切换生产大气 profile，生成可复现的日夜视觉矩阵。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) { puppeteer = require(path.join(__dirname, '..', 'node_modules', 'puppeteer-core')); }

const candidates = [
  process.argv[2],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome', 'chromium'
].filter(Boolean);
function which(p) {
  if (p[0] === '/') return fs.existsSync(p) ? p : null;
  try { return execSync('which ' + p).toString().trim(); } catch (e) { return null; }
}
const executablePath = candidates.map(which).find(Boolean);
if (!executablePath) throw new Error('未找到 Chromium 内核浏览器');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'screenshots', 'atmosphere');
fs.mkdirSync(outDir, { recursive: true });
const TYPES = ['lush', 'arid', 'frozen', 'toxic', 'volcanic', 'oceanic'];
const SIGNATURE = {
  lush: 'pollen', arid: 'dust', frozen: 'aurora', toxic: 'spores',
  volcanic: 'ash', oceanic: 'sea-mist', station: 'station-stars'
};
const captures = [];

async function stableFrames(page, count) {
  await page.evaluate(async n => {
    for (let i = 0; i < n; i++) await new Promise(resolve => requestAnimationFrame(resolve));
  }, count || 2);
}

async function configure(page, typeKey, phase, density, reducedMotion, focusRole) {
  const result = await page.evaluate(({ typeKey, phase, density, reducedMotion, focusRole, signatureRole }) => {
    const catalog = Voxel.Game._test.galaxy().catalog;
    const world = catalog.find(w => w.typeKey === typeKey) ||
      (typeKey === 'station' ? catalog.find(w => w.kind === 'station') : null);
    if (!world) throw new Error('缺少世界描述: ' + typeKey);

    Voxel.DayNight.loadWorld(world, { density, reducedMotion });
    Voxel.Weather.setWorldProfile(Voxel.DayNight.profile());
    Voxel.Weather.reset();
    Voxel.Weather.setSpaceMode(world.kind === 'station');
    Voxel.DayNight.setTime(phase);
    Voxel.DayNight.update(0);

    const camera = Voxel.Game.camera;
    camera.position.set(128.5, 92, 128.5);
    camera.fov = 82;
    camera.updateProjectionMatrix();
    Voxel.DayNight.updateCamera(camera.position);

    const atmoRoot = Voxel.Game.scene.children.find(o =>
      o.userData && o.userData.system === 'atmosphere');
    if (!atmoRoot) throw new Error('AtmosphereRoot缺失');
    let target = atmoRoot.children.find(o => o.userData && o.userData.role === focusRole && o.visible !== false);
    if (!target) target = atmoRoot.children.find(o =>
      o.userData && o.userData.role === 'ringed-landmark');
    if (!target) throw new Error('没有可对准的天空体: ' + focusRole);
    const p = target.position;
    const horizontal = Math.max(0.0001, Math.sqrt(p.x * p.x + p.z * p.z));
    const yaw = Math.atan2(-p.x, -p.z);
    const pitch = Math.atan2(p.y, horizontal);
    Voxel.Controls.setYaw(yaw);
    Voxel.Controls.setPitch(pitch);
    camera.rotation.order = 'YXZ';
    camera.rotation.x = pitch;
    camera.rotation.y = yaw;
    camera.rotation.z = 0;
    Voxel.DayNight.updateCamera(camera.position);

    const snap = Voxel.Atmosphere.snapshot();
    const stats = Voxel.Atmosphere.resourceStats();
    const roots = Voxel.Game.scene.children.filter(o =>
      o.userData && o.userData.system === 'atmosphere').length;
    const required = typeKey === 'station'
      ? ['deep-space-dome', 'station-stars', 'ringed-landmark']
      : ['sky-dome', 'stars', 'sun', 'moon', 'ringed-landmark', signatureRole];
    const resourcesOK = ['geometries', 'materials', 'textures'].every(key =>
      stats.created[key] - stats.disposed[key] === stats.live[key] &&
      stats.live[key] >= 0 && stats.live[key] <= 64);
    return {
      typeKey: snap.typeKey,
      roles: snap.roles,
      roots,
      celestial: snap.counts.celestial,
      resourcesOK,
      requiredOK: required.every(role => snap.roles.includes(role)),
      stationClean: typeKey !== 'station' || !['sky-dome', 'stars', 'sun', 'moon'].some(role => snap.roles.includes(role)),
      geometryHash: snap.geometryHash,
      focusRole: target.userData.role,
      cameraAnchor: snap.cameraAnchor
    };
  }, { typeKey, phase, density, reducedMotion, focusRole, signatureRole: SIGNATURE[typeKey] });

  if (result.typeKey !== typeKey || result.roots !== 1 || result.celestial > 4 ||
      !result.resourcesOK || !result.requiredOK || !result.stationClean || !result.geometryHash)
    throw new Error('大气截图前状态门禁失败: ' + JSON.stringify(result));
  await stableFrames(page, 3);
  return result;
}

async function shot(page, name, width, height, meta) {
  if (page.__qaErrors.length) throw new Error(name + ' 页面异常: ' + page.__qaErrors.join(' | '));
  const dest = path.join(outDir, name + '.png');
  await page.screenshot({ path: dest, type: 'png', captureBeyondViewport: false });
  captures.push({ name, path: dest, width, height, ...meta });
  console.log('已写入 ' + path.relative(root, dest));
}

async function pngMetrics(browser) {
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');
  const metrics = {};
  for (const item of captures) {
    const buffer = fs.readFileSync(item.path);
    if (buffer.length < 10000) throw new Error(item.name + ' PNG过小: ' + buffer.length);
    const url = 'data:image/png;base64,' + buffer.toString('base64');
    const m = await page.evaluate(url => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.getElementById('c');
        c.width = 160; c.height = 90;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        let sum = 0, sum2 = 0, n = 0, sr = 0, sg = 0, sb = 0, sn = 0;
        const buckets = new Set();
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          sum += l; sum2 += l * l; n++;
          buckets.add((r >> 5) + ',' + (g >> 5) + ',' + (b >> 5));
          if (y < Math.floor(c.height * 0.45)) { sr += r; sg += g; sb += b; sn++; }
        }
        const mean = sum / n;
        resolve({ width: img.naturalWidth, height: img.naturalHeight, mean,
          variance: sum2 / n - mean * mean, buckets: buckets.size,
          sky: [sr / sn, sg / sn, sb / sn],
          skyLum: (0.2126 * sr + 0.7152 * sg + 0.0722 * sb) / sn });
      };
      img.onerror = () => reject(new Error('PNG解码失败'));
      img.src = url;
    }), url);
    if (m.width !== item.width || m.height !== item.height)
      throw new Error(item.name + ' 尺寸错误: ' + m.width + 'x' + m.height);
    if (!(m.variance > 20 && m.buckets >= 8 && m.mean > 2 && m.mean < 253))
      throw new Error(item.name + ' 像素健康失败: ' + JSON.stringify(m));
    metrics[item.name] = m;
    console.log('验证 ' + item.name + ' ' + m.width + 'x' + m.height +
      ' mean=' + m.mean.toFixed(1) + ' variance=' + m.variance.toFixed(1) + ' colors=' + m.buckets);
  }
  await page.close();

  for (const type of TYPES) {
    const day = metrics[type + '-day'], night = metrics[type + '-night'];
    if (!(day.skyLum > night.skyLum + 5))
      throw new Error(type + ' 日夜天空亮度差不足: ' + day.skyLum + ' / ' + night.skyLum);
  }
  let minDistance = Infinity;
  for (let i = 0; i < TYPES.length; i++) for (let j = i + 1; j < TYPES.length; j++) {
    const a = metrics[TYPES[i] + '-day'].sky, b = metrics[TYPES[j] + '-day'].sky;
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    minDistance = Math.min(minDistance, d);
  }
  if (minDistance < 8) throw new Error('六类白天天空ROI区分度不足: ' + minDistance);
  console.log('六类白天天空最小RGB距离=' + minDistance.toFixed(1));
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage();
  page.__qaErrors = [];
  page.on('pageerror', e => page.__qaErrors.push(e.message));
  await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    window.__CAPTURE__ = true;
    try { localStorage.clear(); sessionStorage.setItem('rh_dismissed', '1'); } catch (e) { }
  });
  await page.goto('file://' + path.join(root, 'index.html'), { waitUntil: 'load' });
  await page.evaluate(() => {
    document.getElementById('seed-input').value = 'ATMOSPHERE-VISUAL-QA';
    document.getElementById('btn-new').click();
  });
  await page.waitForFunction(() => Voxel.Game.state === 'playing', { timeout: 180000, polling: 200 });
  await page.evaluate(() => {
    Voxel.Game.onKey('KeyP');
    document.querySelectorAll('.overlay, #hud, .touch-btn, .touch-capture, .touch-stick').forEach(el => {
      el.style.display = 'none';
    });
  });

  for (const type of TYPES) {
    const dayState = await configure(page, type, 0.12, 1, false, 'sun');
    await shot(page, type + '-day', 960, 540, { type, phase: 'day', state: dayState });
    const nightFocus = type === 'frozen' || type === 'volcanic' ? 'moon' : 'ringed-landmark';
    const nightState = await configure(page, type, 0.62, 1, false, nightFocus);
    await shot(page, type + '-night', 960, 540, { type, phase: 'night', state: nightState });
  }
  const stationState = await configure(page, 'station', 0.75, 1, false, 'ringed-landmark');
  await shot(page, 'station', 960, 540, { type: 'station', phase: 'station', state: stationState });

  await page.setViewport({ width: 568, height: 320, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await stableFrames(page, 2);
  for (const type of ['toxic', 'volcanic']) {
    const state = await configure(page, type, 0.62, 0.4, true, type === 'volcanic' ? 'moon' : 'ringed-landmark');
    await shot(page, type + '-mobile-reduced', 1136, 640,
      { type, phase: 'mobile-reduced', state });
  }

  await pngMetrics(browser);
  await browser.close();
  console.log('\nATMOSPHERE-VISUAL-QA-PASS ' + outDir);
})().catch(e => { console.error('ATMOSPHERE CAPTURE FAIL', e.stack || e); process.exit(1); });
