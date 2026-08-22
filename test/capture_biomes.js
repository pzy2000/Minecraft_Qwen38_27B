// 为 README 九宫格生成各生物群系截图
// 用法: node test/capture_biomes.js [/path/to/chrome]
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SEED = 12345;   // 含全部 18 种群系的种子
const VIEW_W = 960;
const VIEW_H = 540;

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
  const outDir = path.join(root, 'screenshots', 'biomes');
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
  // 写入当前版本存档键（config.SAVE_KEY），固定种子与空白背包
  await page.evaluate((seed) => {
    var inv = [];
    for (var i = 0; i < 36; i++) inv.push(0);
    localStorage.setItem(window.Voxel.Config.SAVE_KEY, JSON.stringify({
      v: 1,
      seed: String(seed),
      time: 0.27,
      player: { pos: [128.5, 40, 128.5], yaw: 0.75, pitch: -0.22, fly: true, hp: 20 },
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
    var TREE_BLOCKS = [4, 5, 20, 21, 22, 23, 26];
    function groundAt(x, z) {
      var y = Voxel.World.surfaceAt(x, z);
      if (y < 0) return { y: -1, id: 0 };
      var id = Voxel.World.get(x, y, z);
      while (y > 0 && TREE_BLOCKS.indexOf(id) >= 0) {
        y--;
        id = Voxel.World.get(x, y, z);
      }
      return { y: y, id: id };
    }
    // 在目标群系中找一片连续区域（邻域同群系占比最高者优先；openSurf 时偏好开阔地表）
    function findSpot(biomeId, preferSurf, openSurf) {
      var best = null, bestScore = -1;
      for (var x = 20; x < 236; x += 3) {
        for (var z = 20; z < 236; z += 3) {
          if (Voxel.World.biomeAt(x, z) !== biomeId) continue;
          var same = 0, total = 0, open = 0;
          for (var dx = -21; dx <= 21; dx += 7)
            for (var dz = -21; dz <= 21; dz += 7) {
              var nx = x + dx, nz = z + dz;
              if (nx < 0 || nz < 0 || nx > 255 || nz > 255) continue;
              total++;
              if (Voxel.World.biomeAt(nx, nz) === biomeId) same++;
              if (openSurf && groundAt(nx, nz).id === openSurf) open++;
            }
          var score = same / total;
          if (openSurf) score += (open / total) * 0.5;
          else if (preferSurf && groundAt(x, z).id === preferSurf) score += 0.15;
          if (score > bestScore) { bestScore = score; best = { x: x, z: z }; }
        }
      }
      return best;
    }
    window.__biomeShot = function (opts) {
      var b = opts.biome;
      var spot = opts.fixed ? { x: opts.fixed.x, z: opts.fixed.z }
        : opts.overview
          ? { x: 128, z: 128 }
          : findSpot(Voxel.Biomes.B[b], opts.preferSurf, opts.openSurf);
      if (!spot) return null;
      var g = groundAt(spot.x, spot.z);
      var baseY = g.y > 0 ? g.y : 30;
      var camY = baseY + (opts.height || 12);
      var pitch = opts.pitch !== undefined ? opts.pitch : -0.26;
      var yaw;
      if (opts.overview) {
        camY = 92; pitch = -1.15; yaw = 0.75;
      } else if (opts.fixed && opts.fixed.yaw !== undefined) {
        yaw = opts.fixed.yaw;
      } else {
        var dx = 128 - spot.x, dz = 128 - spot.z;
        yaw = (Math.abs(dx) + Math.abs(dz) < 24) ? 0.75 : Math.atan2(-dx, -dz);
      }
      Voxel.DayNight.setTime(opts.time || 0.27);
      Voxel.DayNight.update(0);
      Voxel.Weather.set('clear');
      Voxel.Weather.update(12);
      Voxel.Player.init(new THREE.Vector3(spot.x + 0.5, camY, spot.z + 0.5), yaw, pitch);
      Voxel.Player.setFlying(true);
      Voxel.World.setFocus(spot.x, spot.z);
      Voxel.World.buildMeshes(64, Voxel.Game.scene);
      return spot;
    };
  });

  // 九宫格拍摄清单（8 群系 + 1 全景俯瞰）
  const shots = [
    { name: 'plains',     opts: { biome: 'PLAINS', height: 11 } },
    { name: 'forest',     opts: { biome: 'FOREST', height: 13 } },
    { name: 'desert',     opts: { biome: 'DESERT', preferSurf: 6, height: 12 } },
    { name: 'jungle',     opts: { biome: 'JUNGLE', height: 20, pitch: -0.2 } },
    { name: 'savanna',    opts: { biome: 'SAVANNA', height: 13 } },
    { name: 'mega-taiga', opts: { biome: 'MEGA_TAIGA', preferSurf: 24, height: 17 } },
    { name: 'badlands',   opts: { biome: 'BADLANDS', preferSurf: 28, height: 14, pitch: -0.22 } },
    { name: 'peaks',      opts: { biome: 'JAGGED_PEAKS', height: 16, pitch: -0.15 } },
    { name: 'overview',   opts: { overview: true, fixed: { x: 192, z: 62 } } }
  ];

  // 可传名称过滤：node test/capture_biomes.js [chrome路径] [shot名...]
  const onlyNames = process.argv.slice(3);
  const filtered = onlyNames.length
    ? shots.filter(s => onlyNames.indexOf(s.name) >= 0)
    : shots;

  for (const s of filtered) {
    const info = await page.evaluate((o) => window.__biomeShot(o), s.opts);
    if (!info) { console.log('跳过 ' + s.name + '（未找到合适位置）'); continue; }
    await sleep(1600);
    const dest = path.join(outDir, s.name + '.png');
    await page.screenshot({ path: dest, type: 'png' });
    console.log('已写入 screenshots/biomes/' + s.name + '.png  @ ' + JSON.stringify(info));
  }

  await browser.close();
  console.log('完成：screenshots/biomes/*.png');
})().catch(e => {
  console.error('CAPTURE FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
