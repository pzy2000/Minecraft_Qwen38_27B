// 验证 greedy 合面不再把每个方块描一圈黑框。
// 用法: node test/capture_outline_qa.js [/path/to/chrome]
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VIEW_W = 960;
const VIEW_H = 540;
const OUT = path.join(__dirname, '..', 'screenshots', 'outline_qa');

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) {
  for (const dir of ['/tmp/node_modules', path.join(__dirname, '..', 'node_modules')]) {
    try { puppeteer = require(path.join(dir, 'puppeteer-core')); break; } catch (e2) { }
  }
}
if (!puppeteer) throw new Error('未找到 puppeteer-core');

const candidates = [
  process.env.BROWSER_PATH,
  process.argv[2],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
].filter(Boolean);
function which(p) {
  if (/^[/A-Za-z:]/.test(p)) return fs.existsSync(p) ? p : null;
  try { return execSync('which ' + p).toString().trim(); } catch (e) { return null; }
}
const executablePath = candidates.map(which).find(Boolean);
if (!executablePath) throw new Error('未找到 Chromium 内核浏览器');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function pngDarkSeamScore(browser, pngPath) {
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');
  const buffer = fs.readFileSync(pngPath);
  const url = 'data:image/png;base64,' + buffer.toString('base64');
  const m = await page.evaluate(src => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.getElementById('c');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const w = c.width, h = c.height;
      const data = ctx.getImageData(0, 0, w, h).data;
      // 只看画面中下部中央的地表（避开天空）
      const x0 = Math.floor(w * 0.28), x1 = Math.floor(w * 0.72);
      const y0 = Math.floor(h * 0.28), y1 = Math.floor(h * 0.72);
      let n = 0, sum = 0;
      const lum = [];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          const L = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          lum.push(L);
          sum += L;
          n++;
        }
      }
      const mean = sum / n;
      let dark = 0, edge = 0;
      const rw = x1 - x0;
      for (let k = 0; k < lum.length; k++) {
        if (lum[k] < mean - 40) dark++;
        const x = k % rw, y = (k / rw) | 0;
        if (x > 0 && Math.abs(lum[k] - lum[k - 1]) > 50) edge++;
        if (y > 0 && Math.abs(lum[k] - lum[k - rw]) > 50) edge++;
      }
      resolve({
        width: w, height: h, mean: mean,
        darkFrac: dark / n, edgeFrac: edge / n
      });
    };
    img.onerror = () => reject(new Error('PNG解码失败'));
    img.src = src;
  }), url);
  await page.close();
  return m;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    protocolTimeout: 300000,
    args: [
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--use-angle=metal',
      '--window-size=' + VIEW_W + ',' + VIEW_H
    ]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));

  await page.evaluateOnNewDocument(() => {
    window.__CAPTURE__ = true;
    try { localStorage.clear(); } catch (e) { }
  });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html') + '?capture=1', {
    waitUntil: 'load'
  });
  await page.evaluate(() => {
    document.getElementById('seed-input').value = '12345';
    document.getElementById('btn-new').click();
  });
  await page.waitForFunction(() => window.Voxel && Voxel.Game && Voxel.Game.state === 'playing' &&
    Voxel.World && Voxel.World.isReady && Voxel.World.isReady(),
    { timeout: 180000, polling: 250 });
  await page.evaluate(() => {
    if (Voxel.Settings) Voxel.Settings.set('autoPerf', 0);
  });
  await sleep(3000);

  const tex = await page.evaluate(() => {
    const t = Voxel.Blocks.getTexture();
    return {
      minFilter: t.minFilter,
      magFilter: t.magFilter,
      anisotropy: t.anisotropy,
      generateMipmaps: t.generateMipmaps,
      nearest: THREE.NearestFilter
    };
  });
  console.log('图集过滤', JSON.stringify(tex));
  if (tex.minFilter !== tex.nearest || tex.generateMipmaps || tex.anisotropy > 1) {
    throw new Error('图集仍开着 mip/AF: ' + JSON.stringify(tex));
  }

  await page.addStyleTag({
    content: '#hud,.overlay,#minimap,#cockpit-hud,#lock-hint,#toast,#tutorial-card,#error-banner{display:none!important}'
  });
  await page.evaluate(() => {
    document.querySelectorAll('.overlay, #hud, .touch-btn, .touch-capture, .touch-stick')
      .forEach(el => { el.style.display = 'none'; });
  });

  const shots = [
    { name: 'flat-lookdown', height: 6, pitch: -1.2 },
    { name: 'terrain-oblique', height: 11, pitch: -0.32 }
  ];

  await page.evaluate(() => {
    window.__outlineShot = function (opts) {
      var best = null, bestFlat = -1;
      var sp = Voxel.Player.pos();
      var x0 = Math.floor(sp.x), z0 = Math.floor(sp.z);
      for (var x = x0 - 40; x <= x0 + 40; x++) {
        for (var z = z0 - 40; z <= z0 + 40; z++) {
          var y = Voxel.World.surfaceAt(x, z);
          if (y < 3) continue;
          var id = Voxel.World.get(x, y, z);
          if (id === 7 || id === 0) continue;
          var flat = 0;
          for (var dx = -2; dx <= 2; dx++)
            for (var dz = -2; dz <= 2; dz++) {
              var y2 = Voxel.World.surfaceAt(x + dx, z + dz);
              if (y2 === y && Voxel.World.get(x + dx, y2, z + dz) === id) flat++;
            }
          if (flat > bestFlat) { bestFlat = flat; best = { x: x, z: z, y: y, id: id, flat: flat }; }
        }
      }
      if (!best || best.flat < 16) return null;
      Voxel.DayNight.setTime(0.30);
      Voxel.DayNight.update(0);
      Voxel.Weather.set('clear');
      Voxel.Weather.update(8);
      Voxel.Player.init(
        new THREE.Vector3(best.x + 0.5, best.y + (opts.height || 6), best.z + 0.5),
        0.15, opts.pitch);
      Voxel.Player.setFlying(true);
      Voxel.World.setFocus(best.x, best.z);
      Voxel.World.buildMeshes(72, Voxel.Game.scene);
      return best;
    };
  });

  const results = [];
  for (const s of shots) {
    const info = await page.evaluate(o => window.__outlineShot(o), s);
    if (!info) {
      console.log('跳过 ' + s.name + '（未找到取景点）');
      continue;
    }
    await page.waitForFunction((pt) => {
      const CS = Voxel.Config.CHUNK;
      const cx = Math.floor(pt.x / CS), cz = Math.floor(pt.z / CS);
      for (let dx = -3; dx <= 3; dx++)
        for (let dz = -3; dz <= 3; dz++)
          if (!Voxel.World.isChunkLoaded(cx + dx, cz + dz)) return false;
      return true;
    }, { timeout: 180000, polling: 200 }, info);
    await sleep(2000);
    const dest = path.join(OUT, s.name + '.png');
    await page.screenshot({ path: dest, type: 'png', captureBeyondViewport: false });
    const m = await pngDarkSeamScore(browser, dest);
    console.log(s.name + ' @ ' + JSON.stringify(info) +
      ' mean=' + m.mean.toFixed(1) +
      ' darkFrac=' + m.darkFrac.toFixed(4) +
      ' edgeFrac=' + m.edgeFrac.toFixed(4));
    results.push({ name: s.name, path: dest, ...m });
  }

  await browser.close();

  // 黑框未修时：mip/AF 接缝把图集暗色抹进缝里，darkFrac 常 > 0.04，edgeFrac > 0.18。
  // 修完后俯视沙地/草地应是连续像素面，只剩真实台阶与贴图像素噪声。
  let failed = 0;
  for (const r of results) {
    // 俯视平坦顶面：接缝描边会抬高 darkFrac。斜视会看到真实台阶侧面，不按这个卡。
    const ok = r.name !== 'flat-lookdown' ||
      (r.darkFrac < 0.08 && r.edgeFrac < 0.12 && r.mean > 50);
    if (!ok) {
      failed++;
      console.log('FAIL ' + r.name + ' 仍像描边网格');
    } else console.log('ok  ' + r.name + ' 无明显方块描边');
  }
  if (!results.length) throw new Error('没有可用的描边验收截图');
  if (failed) {
    console.log('\n' + failed + ' 张截图未通过描边验收 ✗');
    process.exit(1);
  }
  console.log('\n描边验收通过 ✓  截图在 screenshots/outline_qa/');
})().catch(e => {
  console.error('OUTLINE-QA FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
