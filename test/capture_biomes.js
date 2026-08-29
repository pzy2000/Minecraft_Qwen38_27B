// 为 README 九宫格生成各生物群系截图
// 用法: node test/capture_biomes.js [/path/to/chrome]
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SEED = 12345;   // 含全部 22 种群系的种子
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
    var TREE_BLOCKS = [4, 5, 20, 21, 22, 23, 26, 33, 34, 35, 36, 54, 55, 56, 57, 58, 59];
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
    // 第 23 轮气候降频后稀有群系可能整体落在旧核心之外：核心扫描失败时
    // 用零成本气候探针在 ±520 宽域兜底，终验仍走真实 biomeAt。
    function probePick(x, z, biomeId) {
      if (!Voxel.World.climateAt || !Voxel.Biomes.pick) return null;
      var cl = Voxel.World.climateAt(x, z);
      return cl ? (Voxel.Biomes.pick(cl) === biomeId) : null;
    }
    function findSpotWide(biomeId, opts) {
      // 宽域扫描：气候探针初筛 -> 邻域纯度打分收集候选 -> 按分排序逐个
      // 终验（真实 biomeAt；strict 还要求气候预测地表高于海面且实际地表
      // 非水/非裸石）。同一片失效区域按间距去重，12 次尝试内取首个通过者。
      var strict = !!(opts && opts.wideStrict);
      var minScore = strict ? 0.96 : 0.34;
      var box = strict ? 18 : 21, stepN = strict ? 6 : 7;
      var cands = [];
      for (var x = -520; x < 520; x += 6) {
        for (var z = -520; z < 520; z += 6) {
          var hit = probePick(x, z, biomeId);
          if (hit === null ? Voxel.World.biomeAt(x, z) !== biomeId : !hit) continue;
          var same = 0, total = 0;
          for (var dx = -box; dx <= box; dx += stepN)
            for (var dz = -box; dz <= box; dz += stepN) {
              total++;
              var nb = probePick(x + dx, z + dz, biomeId);
              if (nb === null ? Voxel.World.biomeAt(x + dx, z + dz) === biomeId : nb) same++;
            }
          if (same / total >= minScore) cands.push({ x: x, z: z, score: same / total });
        }
      }
      if (!cands.length) return null;
      cands.sort(function (a, b) { return b.score - a.score; });
      var gen0 = Voxel.World._test && Voxel.World._test.gen ? Voxel.World._test.gen() : null;
      var tried = [], attempts = 0;
      for (var ci = 0; ci < cands.length && attempts < 12; ci++) {
        var cand = cands[ci];
        var nearTried = false;
        for (var ti = 0; ti < tried.length; ti++) {
          var ddx = cand.x - tried[ti][0], ddz = cand.z - tried[ti][1];
          if (ddx * ddx + ddz * ddz < 3600) { nearTried = true; break; }
        }
        if (nearTried) continue;
        attempts++;
        tried.push([cand.x, cand.z]);
        if (Voxel.World.biomeAt(cand.x, cand.z) !== biomeId) continue;
        if (strict) {
          var cl = Voxel.World.climateAt ? Voxel.World.climateAt(cand.x, cand.z) : null;
          if (gen0 && gen0.shaper && cl && gen0.shaper.targetHeight(cand.x + 0.5, cand.z + 0.5, cl) < 28)
            continue;
          var g = groundAt(cand.x, cand.z);
          if (g.id === 7 || g.id === 12 || g.y < 28) continue;
        }
        return { x: cand.x, z: cand.z };
      }
      return null;
    }
    function findSpot(biomeId, preferSurf, openSurf, purity) {
      var best = null, bestScore = -1, pureBest = null, pureScore = -1;
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
          // 纯净度门槛：邻域同群系占比达标才参与优先评选，
          // 避免气候点相邻的群系（黑森林/樱花）在边界互相入镜。
          if (purity && same / total >= purity && score > pureScore) {
            pureScore = score; pureBest = { x: x, z: z };
          }
        }
      }
      var picked = pureBest || best;
      return picked || findSpotWide(biomeId);
    }
    window.__biomeShot = function (opts) {
      var b = opts.biome;
      var spot = opts.fixed ? { x: opts.fixed.x, z: opts.fixed.z }
        : opts.overview
          ? { x: 128, z: 128 }
          : opts.wide
            ? findSpotWide(Voxel.Biomes.B[b], opts)
            : findSpot(Voxel.Biomes.B[b], opts.preferSurf, opts.openSurf, opts.purity);
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

  // 拍摄清单：README 九宫格（8 群系 + 全景俯瞰）+ 精选世界所需其余群系
  const shots = [
    { name: 'plains',          opts: { biome: 'PLAINS', height: 11 } },
    { name: 'forest',          opts: { biome: 'FOREST', height: 13 } },
    { name: 'desert',          opts: { biome: 'DESERT', preferSurf: 6, height: 12 } },
    { name: 'jungle',          opts: { biome: 'JUNGLE', height: 20, pitch: -0.2 } },
    { name: 'savanna',         opts: { biome: 'SAVANNA', height: 13 } },
    { name: 'mega-taiga',      opts: { biome: 'MEGA_TAIGA', preferSurf: 24, height: 26, pitch: -0.35 } },
    { name: 'badlands',        opts: { biome: 'BADLANDS', preferSurf: 28, height: 14, pitch: -0.22, wide: true } },
    { name: 'peaks',           opts: { biome: 'JAGGED_PEAKS', height: 16, pitch: -0.15 } },
    { name: 'overview',        opts: { overview: true, fixed: { x: 192, z: 62 } } },
    // ---- 其余群系（精选世界缩略图用） ----
    { name: 'birch-forest',    opts: { biome: 'BIRCH_FOREST', height: 13 } },
    { name: 'sparse-jungle',   opts: { biome: 'SPARSE_JUNGLE', height: 16, pitch: -0.2 } },
    { name: 'taiga',           opts: { biome: 'TAIGA', height: 14 } },
    { name: 'snowy',           opts: { biome: 'SNOWY', height: 11 } },
    { name: 'windswept-hills', opts: { biome: 'WINDSWEPT_HILLS', height: 15 } },
    { name: 'frozen-peaks',    opts: { biome: 'FROZEN_PEAKS', height: 16, pitch: -0.15 } },
    { name: 'stony-peaks',     opts: { biome: 'STONY_PEAKS', height: 15, wide: true } },
    { name: 'beach',           opts: { biome: 'BEACH', preferSurf: 6, height: 12, pitch: -0.3, wide: true } },
    { name: 'stony-shore',     opts: { biome: 'STONY_SHORE', height: 13, pitch: -0.28 } },
    { name: 'ocean',           opts: { biome: 'OCEAN', height: 26, pitch: -0.4, wide: true } },
    // ---- 群系扩展（2026-08）----
    // 第 23 轮降频后沼泽/黑森林/蘑菇林不再落在 0..255 核心内：走宽域
    // 纯区搜索（findSpotWide，含真实 biomeAt 终验与地表检查）。
    { name: 'mushroom-fields', opts: { biome: 'MUSHROOM_FIELDS', preferSurf: 53, height: 12, wide: true, wideStrict: true } },
    { name: 'swamp',           opts: { biome: 'SWAMP', height: 14, wide: true, wideStrict: true } },
    { name: 'cherry-grove',    opts: { biome: 'CHERRY_GROVE', height: 13, purity: 0.95 } },
    { name: 'dark-forest',     opts: { biome: 'DARK_FOREST', height: 12, wide: true, wideStrict: true } },
    // v7 星海嘉年华（新增群系，取景点常在核心窗外，走宽域搜索）
    { name: 'playground',      opts: { biome: 'PLAYGROUND', height: 14, wide: true, wideStrict: true } }
  ];

  // 可传名称过滤：node test/capture_biomes.js [chrome路径] [shot名...]
  const onlyNames = process.argv.slice(3);
  const filtered = onlyNames.length
    ? shots.filter(s => onlyNames.indexOf(s.name) >= 0)
    : shots;

  for (const s of filtered) {
    const info = await page.evaluate((o) => window.__biomeShot(o), s.opts);
    if (!info) { console.log('跳过 ' + s.name + '（未找到合适位置）'); continue; }
    // 等待取景点周围 7×7 区块全部生成完毕（宽域点离核心远，流式生成
    // 每帧只推进少量区块），再留出网格构建缓冲，避免拍到大片未加载石料。
    await page.waitForFunction((spt) => {
      const CS = window.Voxel.Config.CHUNK, R = 3;
      const cx = Math.floor(spt.x / CS), cz = Math.floor(spt.z / CS);
      for (let dx = -R; dx <= R; dx++)
        for (let dz = -R; dz <= R; dz++)
          if (!Voxel.World.isChunkLoaded(cx + dx, cz + dz)) return false;
      return true;
    }, { timeout: 300000, polling: 200 }, info);
    await sleep(3500);
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
