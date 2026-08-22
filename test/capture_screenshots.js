// 为 README 四宫格生成游戏截图
// 用法: node test/capture_screenshots.js [/path/to/chrome]
// 需要: npm i puppeteer-core（查找路径与 run_browser_tests.js 相同）
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SEED = 3;
const VIEW_W = 1280;
const VIEW_H = 720;

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) {
  for (const dir of ['/tmp/node_modules', path.join(__dirname, '..', 'node_modules')]) {
    try { puppeteer = require(dir + '/puppeteer-core'); break; } catch (e2) { }
  }
}
if (!puppeteer) {
  console.error('未找到 puppeteer-core，请先: npm i puppeteer-core');
  process.exit(1);
}

const candidates = [
  process.argv[2],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome',
  'chromium'
].filter(Boolean);

function which(p) {
  if (/^[/A-Za-z:]/.test(p)) return require('fs').existsSync(p) ? p : null;
  try { return execSync(`which ${p}`).toString().trim(); } catch (e) { return null; }
}
const execPath = candidates.map(which).find(Boolean);
if (!execPath) { console.error('未找到 Chromium 内核浏览器，请传入可执行文件路径'); process.exit(1); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitPlaying(page) {
  await page.waitForFunction(
    () => window.Voxel && Voxel.Game && Voxel.Game.state === 'playing',
    { timeout: 180000, polling: 250 }
  );
}

(async () => {
  const root = path.join(__dirname, '..');
  const outDir = path.join(root, 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: 'new',
    defaultViewport: { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1 },
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=' + VIEW_W + ',' + VIEW_H
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1 });

  const url = 'file://' + path.join(root, 'index.html');
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate((seed) => {
    var inv = [];
    for (var i = 0; i < 36; i++) inv.push(0);
    localStorage.setItem(window.Voxel.Config.SAVE_KEY, JSON.stringify({
      v: 1,
      seed: seed,
      time: 0.25,
      player: { pos: [128.5, 1, 128.5], yaw: 0.75, pitch: -0.2, fly: true, hp: 20 },
      inv: inv,
      held: 0,
      edits: {}
    }));
  }, SEED);
  await page.reload({ waitUntil: 'load' });

  await page.addStyleTag({
    content: '#lock-hint,#toast,#error-banner,#use-hint{display:none!important}'
  });

  await page.click('#btn-start');
  console.log('等待世界生成（种子 ' + SEED + '）…');
  await waitPlaying(page);
  await sleep(2500);

  await page.evaluate(() => {
    function groundAt(x, z) {
      var y = Voxel.World.surfaceAt(x, z);
      if (y < 0) return { y: -1, id: 0 };
      var id = Voxel.World.get(x, y, z);
      while (y > 0 && (id === 4 || id === 5 || id === 0)) {
        y--;
        id = Voxel.World.get(x, y, z);
      }
      return { y: y, id: id };
    }
    function setEnv(time, weather) {
      Voxel.DayNight.setTime(time);
      Voxel.DayNight.update(0);
      Voxel.Weather.set(weather);
      Voxel.Weather.update(12);
    }
    function place(x, y, z, yaw, pitch, focusX, focusZ, meshes) {
      Voxel.Player.init(new THREE.Vector3(x, y, z), yaw, pitch);
      Voxel.Player.setFlying(true);
      Voxel.World.setFocus(focusX, focusZ);
      Voxel.World.buildMeshes(meshes || 32, Voxel.Game.scene);
    }
    window.__shot = {
      beach: function (time, weather) {
        setEnv(time, weather);
        var WATER = Voxel.Config.WATER_LEVEL;
        var best = null, bestScore = -1;
        for (var x = 24; x < 232; x += 8) {
          for (var z = 24; z < 232; z += 8) {
            var g = groundAt(x, z);
            if (g.id !== 6) continue;
            var grass = 0, trees = 0, water = 0;
            for (var dx = -16; dx <= 16; dx += 8)
              for (var dz = -16; dz <= 16; dz += 8) {
                var n = groundAt(x + dx, z + dz);
                if (n.id === 1) grass++;
                if (n.id === 4 || n.id === 5) trees++;
                if (n.id === 7 || Voxel.World.get(x + dx, WATER, z + dz) === 7) water++;
              }
            var score = grass + trees * 2 + water;
            if (score > bestScore) { bestScore = score; best = { x: x, z: z, y: g.y }; }
          }
        }
        if (!best) {
          var sp = Voxel.World.spawnPoint();
          best = { x: sp.x, z: sp.z, y: sp.y };
        }
        var yaw = Math.atan2(-(128 - best.x), -(128 - best.z));
        place(best.x + 0.5, best.y + 8, best.z + 0.5, yaw, -0.18, best.x, best.z, 36);
        return best;
      },
      snow: function () {
        setEnv(0.28, 'clear');
        var best = { x: 128, z: 128, y: -1 };
        for (var x = 16; x < 240; x += 2) {
          for (var z = 16; z < 240; z += 2) {
            var g = groundAt(x, z);
            if (g.id === 18 && g.y > best.y) best = { x: x, z: z, y: g.y };
          }
        }
        var dx = 128 - best.x, dz = 128 - best.z;
        var len = Math.sqrt(dx * dx + dz * dz) || 1;
        var ux = dx / len, uz = dz / len;
        var camX = best.x - ux * 22;
        var camZ = best.z - uz * 22;
        if (camX < 12) camX = 12;
        if (camX > 243) camX = 243;
        if (camZ < 12) camZ = 12;
        if (camZ > 243) camZ = 243;
        var g = groundAt(camX | 0, camZ | 0);
        var camY = Math.max((g.y > 0 ? g.y : best.y) + 5, best.y - 2);
        var horiz = Math.sqrt((best.x - camX) * (best.x - camX) + (best.z - camZ) * (best.z - camZ)) || 1;
        var pitch = Math.atan2((best.y + 1) - camY, horiz);
        var yaw = Math.atan2(-(best.x - camX), -(best.z - camZ));
        place(camX + 0.5, camY, camZ + 0.5, yaw, pitch, best.x, best.z, 56);
        return best;
      }
    };
  });

  async function shot(name, setup) {
    const info = await page.evaluate(setup);
    await sleep(name === 'snow' ? 1400 : 900);
    const dest = path.join(outDir, name + '.png');
    await page.screenshot({ path: dest, type: 'png' });
    console.log('已写入 ' + path.relative(root, dest) + (info ? '  @ ' + JSON.stringify(info) : ''));
  }

  await shot('day', () => window.__shot.beach(0.25, 'clear'));
  await shot('dusk', () => window.__shot.beach(0.50, 'clear'));
  await shot('rain', () => window.__shot.beach(0.25, 'rain'));
  await shot('snow', () => window.__shot.snow());

  await browser.close();
  console.log('完成：screenshots/{day,dusk,rain,snow}.png');
})().catch(e => {
  console.error('CAPTURE FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
