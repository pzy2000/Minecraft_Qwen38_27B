// 生成星际改造的桌面/移动视觉验收截图，并验证尺寸、可见状态与基础像素健康度。
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
  '/Applications/Chromium.app/Contents/MacOS/Chromium', 'google-chrome', 'chromium'
].filter(Boolean);
function which(p) {
  if (p[0] === '/') return fs.existsSync(p) ? p : null;
  try { return execSync('which ' + p).toString().trim(); } catch (e) { return null; }
}
const executablePath = candidates.map(which).find(Boolean);
if (!executablePath) throw new Error('未找到 Chromium 内核浏览器');

const root = path.join(__dirname, '..');
const out = path.join(root, 'screenshots', 'space');
fs.mkdirSync(out, { recursive: true });
const captures = [];

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function newQaPage(browser, viewport, forceTouch) {
  const page = await browser.newPage();
  const errors = [];
  page.__qaErrors = errors;
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument((touch) => {
    if (touch) window.__FORCE_TOUCH__ = true;
    try {
      localStorage.clear();
      sessionStorage.setItem('rh_dismissed', '1');
    } catch (e) { }
  }, !!forceTouch);
  await page.goto('file://' + path.join(root, 'index.html'), { waitUntil: 'load' });
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  });
  return page;
}

async function assertCaptureState(page, label, options) {
  options = options || {};
  if (page.__qaErrors.length) throw new Error(label + ' 页面异常: ' + page.__qaErrors.join(' | '));
  const result = await page.evaluate((opts) => {
    const vv = window.visualViewport;
    const W = (vv && vv.width) || innerWidth;
    const H = (vv && vv.height) || innerHeight;
    function visible(el) {
      if (!el) return false;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.01 &&
        r.width > 0 && r.height > 0 && !el.closest('.hidden,[aria-hidden="true"]');
    }
    function inside(el) {
      const r = el.getBoundingClientRect();
      return r.left >= -1 && r.top >= -1 && r.right <= W + 1 && r.bottom <= H + 1;
    }
    function visibleStrings(rootEl) {
      const values = [];
      const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        const text = node.nodeValue.trim();
        if (text && visible(parent)) values.push(text);
      }
      rootEl.querySelectorAll('[aria-label],[aria-valuetext],[title]').forEach(el => {
        if (!visible(el)) return;
        ['aria-label', 'aria-valuetext', 'title'].forEach(name => {
          const value = el.getAttribute(name);
          if (value) values.push(value);
        });
      });
      return values;
    }
    const rootEl = document.querySelector(opts.rootSelector);
    const containEl = document.querySelector(opts.containSelector || opts.rootSelector);
    const scan = document.getElementById('scan-terminal');
    const strings = rootEl ? visibleStrings(rootEl) : [];
    const forbidden = /\b(?:undefined|null|NaN|Infinity)\b|\[object Object\]|待同步|未知星域/i;
    const leaked = strings.filter(value => forbidden.test(value));
    const fields = ['scan-world', 'scan-position', 'scan-biome', 'scan-environment', 'scan-target', 'scan-distance']
      .map(id => ({ id, text: (document.getElementById(id) || {}).textContent || '' }));
    return {
      state: window.Voxel && Voxel.Game ? Voxel.Game.state : '',
      rootVisible: visible(rootEl),
      rootInside: !!rootEl && inside(rootEl),
      containInside: !!containEl && inside(containEl),
      leaked,
      rotateHidden: document.getElementById('rotate-hint').classList.contains('hidden'),
      scanVisible: visible(scan),
      scanInside: !!scan && inside(scan),
      scanStatus: scan ? scan.dataset.status : '',
      scanKind: scan ? scan.dataset.targetKind : '',
      fields,
      target: (document.getElementById('scan-target') || {}).textContent || '',
      distance: (document.getElementById('scan-distance') || {}).textContent || ''
    };
  }, options);

  if (!result.rootVisible || !result.rootInside || !result.containInside)
    throw new Error(label + ' 可见根节点越界或隐藏: ' + JSON.stringify(result));
  if (!result.rotateHidden) throw new Error(label + ' 被竖屏提示遮挡');
  if (result.leaked.length) throw new Error(label + ' 泄漏未初始化字符串: ' + result.leaked.join(' | '));
  if (options.state && result.state !== options.state)
    throw new Error(label + ' 状态错误: ' + result.state + ' != ' + options.state);
  if (options.scan) {
    if (!result.scanVisible || !result.scanInside || result.scanStatus !== 'online')
      throw new Error(label + ' 扫描终端未在线/越界: ' + JSON.stringify(result));
    if (result.fields.some(field => !field.text.trim()))
      throw new Error(label + ' 扫描字段为空: ' + JSON.stringify(result.fields));
    if (options.stableTarget && (result.scanKind !== 'block' || result.target.indexOf('石头') < 0 || !/3\.3\s*m/.test(result.distance)))
      throw new Error(label + ' 稳定扫描目标错误: ' + result.target + ' / ' + result.distance);
  } else if (options.scanHidden && result.scanVisible) {
    throw new Error(label + ' 非playing状态泄漏扫描终端');
  }
  return result;
}

async function capture(page, name, expectedW, expectedH, options) {
  await assertCaptureState(page, name, options);
  const dest = path.join(out, name + '.png');
  await page.screenshot({ path: dest, type: 'png', captureBeyondViewport: false });
  captures.push({ name, path: dest, width: expectedW, height: expectedH });
  console.log('已写入 ' + path.relative(root, dest));
}

async function startWorld(page, seed) {
  await page.evaluate((fixedSeed) => {
    document.getElementById('seed-input').value = fixedSeed;
    document.getElementById('btn-new').click();
  }, seed);
  await page.waitForFunction(() => Voxel.Game.state === 'playing', { timeout: 180000, polling: 200 });
  await page.evaluate(() => {
    Voxel.DayNight.setTime(0.25);
    Voxel.DayNight.update(0);
    Voxel.Weather.set('clear');
    Voxel.Weather.update(0);
  });
}

async function placeByShip(page) {
  await page.evaluate(() => {
    const s = Voxel.SpaceTravel.ship();
    if (!s) throw new Error('固定截图缺少飞船');
    const p = Voxel.Player.pos();
    p.set(s.position.x + 13, s.position.y + 6, s.position.z + 13);
    const dx = s.position.x - p.x, dz = s.position.z - p.z;
    Voxel.Controls.setYaw(Math.atan2(-dx, -dz));
    Voxel.Controls.setPitch(-0.22);
    Voxel.Player.setFlying(true);
    Voxel.DayNight.setTime(0.25);
    Voxel.DayNight.update(0);
    Voxel.Weather.set('clear');
    Voxel.Weather.update(0);
  });
  await sleep(800);
}

async function setStableScanTarget(page) {
  await page.evaluate(() => {
    if (!window.__qaOriginalRaycast) window.__qaOriginalRaycast = Voxel.Raycaster.cast;
    const eye = Voxel.Player.eyePos();
    const dir = Voxel.Player.lookDir();
    const point = eye.clone().add(dir.clone().multiplyScalar(3.25));
    const hit = {
      type: 'block', x: Math.floor(point.x), y: Math.max(1, Math.floor(point.y)), z: Math.floor(point.z),
      nx: 0, ny: 1, nz: 0, id: 3, dist: 3.25
    };
    Voxel.Raycaster.cast = function () { return hit; };
    Voxel.Game._test.updateHighlight();
    Voxel.SpaceTravel.update(0, 0);
    document.getElementById('toast').classList.remove('show');
    document.getElementById('lock-hint').style.display = 'none';
    document.getElementById('use-hint').style.display = 'none';
    document.getElementById('error-banner').style.display = 'none';
  });
  await sleep(180);
  await page.evaluate(() => {
    Voxel.Game._test.updateHighlight();
    Voxel.SpaceTravel.update(0, 0);
  });
}

async function restoreRaycast(page) {
  await page.evaluate(() => {
    if (window.__qaOriginalRaycast) {
      Voxel.Raycaster.cast = window.__qaOriginalRaycast;
      delete window.__qaOriginalRaycast;
    }
    Voxel.SpaceTravel.setScanTarget('none', '无锁定目标', null);
    Voxel.SpaceTravel.update(0, 0);
  });
}

async function validatePngs(browser) {
  const page = await browser.newPage();
  await page.setContent('<canvas id="c" width="128" height="72"></canvas>');
  for (const item of captures) {
    const buffer = fs.readFileSync(item.path);
    if (buffer.length < 10000) throw new Error(item.name + ' PNG过小: ' + buffer.length);
    const dataUrl = 'data:image/png;base64,' + buffer.toString('base64');
    const metrics = await page.evaluate((url) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.getElementById('c');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0, sum2 = 0, count = 0;
        const buckets = new Set();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          sum += l; sum2 += l * l; count++;
          buckets.add((r >> 5) + ',' + (g >> 5) + ',' + (b >> 5));
        }
        const mean = sum / count;
        resolve({ width: image.naturalWidth, height: image.naturalHeight, mean,
          variance: sum2 / count - mean * mean, buckets: buckets.size });
      };
      image.onerror = () => reject(new Error('PNG解码失败'));
      image.src = url;
    }), dataUrl);
    if (metrics.width !== item.width || metrics.height !== item.height)
      throw new Error(item.name + ' 尺寸错误: ' + metrics.width + 'x' + metrics.height +
        ' != ' + item.width + 'x' + item.height);
    if (!(metrics.mean > 2 && metrics.mean < 253 && metrics.variance > 20 && metrics.buckets >= 12))
      throw new Error(item.name + ' 像素健康检查失败: ' + JSON.stringify(metrics));
    console.log('验证通过 ' + item.name + '.png ' + metrics.width + 'x' + metrics.height +
      ' bytes=' + buffer.length + ' mean=' + metrics.mean.toFixed(1) +
      ' variance=' + metrics.variance.toFixed(1) + ' colors=' + metrics.buckets);
  }
  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
  });

  // 两张主菜单截图先完成，避免之后的游戏存档改变“开始游戏”菜单状态。
  const desktop = await newQaPage(browser, { width: 1280, height: 720, deviceScaleFactor: 1 }, false);
  await capture(desktop, 'menu-desktop', 1280, 720, {
    rootSelector: '#overlay-start', containSelector: '#overlay-start .panel', state: 'menu', scanHidden: true
  });

  const menuMobile = await newQaPage(browser,
    { width: 320, height: 568, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, true);
  await capture(menuMobile, 'menu-mobile', 640, 1136, {
    rootSelector: '#overlay-start', containSelector: '#overlay-start .panel', state: 'menu', scanHidden: true
  });
  await menuMobile.close();

  await startWorld(desktop, 'STARBOUND-VISUAL-QA');
  await placeByShip(desktop);
  await capture(desktop, 'planet-ship', 1280, 720, { rootSelector: '#hud', state: 'playing', scan: true });
  await setStableScanTarget(desktop);
  await capture(desktop, 'hud-scan-desktop', 1280, 720, {
    rootSelector: '#hud', state: 'playing', scan: true, stableTarget: true
  });
  await restoreRaycast(desktop);

  await desktop.evaluate(() => {
    const s = Voxel.SpaceTravel.ship();
    Voxel.Player.pos().copy(s.position).add(new THREE.Vector3(0, 1, 1));
    Voxel.SpaceTravel.update(0.016);
    Voxel.Game.openStarMap();
  });
  await sleep(100);
  await capture(desktop, 'desktop-starmap', 1280, 720, {
    rootSelector: '#overlay-starmap', containSelector: '#overlay-starmap .starmap-panel', state: 'starmap', scanHidden: true
  });
  await desktop.evaluate(() => Voxel.Game.requestTravel('station-0', 'ship'));
  await desktop.waitForFunction(() => Voxel.Game.state === 'playing' &&
    Voxel.Game._test.currentWorld().id === 'station-0', { timeout: 180000, polling: 200 });
  await desktop.evaluate(() => {
    Voxel.Player.pos().set(128.5, 27, 143.5);
    Voxel.Controls.setYaw(0);
    Voxel.Controls.setPitch(0.08);
    Voxel.Player.setFlying(true);
  });
  await sleep(700);
  await capture(desktop, 'space-station', 1280, 720, { rootSelector: '#hud', state: 'playing', scan: true });
  await desktop.close();

  // 移动端先以第11轮精确横屏尺寸捕获HUD，再扩展到既有844x390星图证据。
  const mobile = await newQaPage(browser,
    { width: 568, height: 320, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, true);
  await startWorld(mobile, 'STARBOUND-MOBILE-QA');
  await placeByShip(mobile);
  await setStableScanTarget(mobile);
  await capture(mobile, 'hud-scan-mobile', 1136, 640, {
    rootSelector: '#hud', state: 'playing', scan: true, stableTarget: true
  });
  await restoreRaycast(mobile);
  await mobile.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(120);
  await mobile.evaluate(() => {
    const s = Voxel.SpaceTravel.ship();
    Voxel.Player.pos().copy(s.position).add(new THREE.Vector3(0, 1, 1));
    Voxel.SpaceTravel.update(0.016);
    Voxel.Game.openStarMap();
  });
  await sleep(100);
  await capture(mobile, 'mobile-starmap', 1688, 780, {
    rootSelector: '#overlay-starmap', containSelector: '#overlay-starmap .starmap-panel', state: 'starmap', scanHidden: true
  });
  await mobile.close();

  await validatePngs(browser);
  await browser.close();
  console.log('\nSPACE-VISUAL-QA-PASS ' + out);
})().catch(e => { console.error('CAPTURE FAIL', e.stack || e); process.exit(1); });
