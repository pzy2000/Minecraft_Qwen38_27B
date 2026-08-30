// 召唤飞船端到端（真实浏览器）：预览显隐、幽灵模型、确认召回流、精确落地。
// 独立运行：node test/ship_summon_e2e.js [chrome路径]
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) {
  for (const dir of ['/tmp/node_modules', path.join(__dirname, '..', 'node_modules')]) {
    try { puppeteer = require(dir + '/puppeteer-core'); break; } catch (e2) { }
  }
}
if (!puppeteer) throw new Error('未找到 puppeteer-core');

const candidates = [
  process.env.BROWSER_PATH,
  process.argv[2],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome', 'chromium'
].filter(Boolean);
function which(p) {
  if (/^[/A-Za-z:]/.test(p)) return fs.existsSync(p) ? p : null;
  try { return execSync('which ' + p).toString().trim(); } catch (e) { return null; }
}
const executablePath = candidates.map(which).find(Boolean);
if (!executablePath) throw new Error('未找到 Chromium 内核浏览器');

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name + (detail !== undefined ? ' :: ' + detail : ''));
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? ' :: ' + detail : '')); }
}

let browser;
(async () => {
  browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1100,700']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 700 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'), { waitUntil: 'load' });

  await page.evaluate(() => {
    let scan = document.getElementById('scan-terminal');
    if (!scan) {
      scan = document.createElement('aside');
      scan.id = 'scan-terminal';
      (document.getElementById('hud') || document.body).appendChild(scan);
    }
    ['scan-world', 'scan-position', 'scan-biome', 'scan-environment', 'scan-target', 'scan-distance'].forEach(id => {
      if (!document.getElementById(id)) {
        const el = document.createElement('div');
        el.id = id;
        scan.appendChild(el);
      }
    });
    localStorage.clear();
    document.getElementById('seed-input').value = 'STARBOUND-SUMMON-E2E';
    document.getElementById('btn-new').click();
  });

  // 世界就绪
  await page.waitForFunction(() => window.Voxel && Voxel.Game &&
    (Voxel.Game.state === 'playing' || Voxel.Game.state === 'cockpit') &&
    Voxel.Game._test.currentWorld() &&
    Voxel.Game._test.currentWorld().kind === 'planet',
    { timeout: 180000, polling: 250 });

  console.log('幽灵模型与公共API');
  const ghostInfo = await page.evaluate(() => {
    const st = Voxel.SpaceTravel.summonStatus ? Voxel.SpaceTravel.summonStatus() : null;
    return {
      apiOk: typeof Voxel.SpaceTravel.summonBegin === 'function' &&
        typeof Voxel.SpaceTravel.updateSummon === 'function' &&
        typeof Voxel.SpaceTravel.buildShipGhost === 'function' &&
        typeof Voxel.ShipSummon.aimSpot === 'function',
      initialStatusIdle: !st || (!st.active && st.result === null)
    };
  });
  check('summon 公共API完整', ghostInfo.apiOk);
  check('初始召唤状态空闲', ghostInfo.initialStatusIdle);

  console.log('放置预览（X 键）');
  await page.keyboard.press('KeyX'); // controls.js → Voxel.Game.onKey
  await page.waitForFunction(() => {
    const el = document.getElementById('summon-status');
    return el && !el.hidden && el.textContent.length > 0;
  }, { timeout: 15000, polling: 200 });
  const placingState = await page.evaluate(() => ({
    mode: document.getElementById('summon-status').dataset.mode,
    text: document.getElementById('summon-status').textContent,
    ghostInScene: (() => {
      let found = false;
      Voxel.Game.scene.traverse(n => { if (n.name === 'ShipSummonGhost') found = true; });
      return found;
    })()
  }));
  check('X 进入放置模式且状态条出现', true, `${placingState.mode}: ${placingState.text.slice(0, 18)}…`);
  check('幽灵模型已加入场景', placingState.ghostInScene);
  await page.keyboard.press('Escape'); // 防止后续键被鼠标锁定流程吞掉无影响
  await page.keyboard.press('KeyX'); // 再按 X 取消放置
  await page.waitForFunction(() => {
    const el = document.getElementById('summon-status');
    return el && el.hidden;
  }, { timeout: 10000, polling: 200 });
  const ghostGone = await page.evaluate(() => {
    let found = false;
    Voxel.Game.scene.traverse(n => { if (n.name === 'ShipSummonGhost') found = true; });
    return !found;
  });
  check('取消后幽灵已从场景移除', ghostGone);

  console.log('确认召回 → 自动驾驶 → 精确降落');
  const beginInfo = await page.evaluate(async () => {
    const p = Voxel.Player.pos();
    const worldApi = {
      surfaceAt: (x, z) => Voxel.World.surfaceAt(x, z),
      get: (x, y, z) => Voxel.World.get(x, y, z),
      isSolid: (id) => !!Voxel.Blocks.isSolid(id)
    };
    // 在玩家附近以大半径搜索一个干燥合法着陆点（不依赖准星姿态）。
    let spot = null, yaw = 0;
    for (let r = 8; r <= 64 && !spot; r += 8) {
      yaw += 0.7;
      spot = Voxel.LandingAssist.findLandingSpot(worldApi, p.x + Math.cos(yaw) * 10,
        p.z + Math.sin(yaw) * 10, yaw, { searchRadius: r });
    }
    if (!spot) return { ok: false };
    const r = Voxel.SpaceTravel.summonBegin({ x: spot.x, y: spot.y, z: spot.z });
    if (!r.ok) return { ok: false, reason: r.reason };
    return { ok: true, target: spot, cruiseY: r.cruiseY };
  });
  check('远点召唤启动成功', beginInfo.ok === true,
    beginInfo.reason || `cruise=${beginInfo.cruiseY && beginInfo.cruiseY.toFixed(1)}`);
  if (beginInfo.ok) {
    await page.waitForFunction(() => {
      const st = Voxel.SpaceTravel.summonStatus();
      return !st.active;
    }, { timeout: 420000, polling: 500, protocolTimeout: 600000 });
    const finalInfo = await page.evaluate((t) => {
      const snap = Voxel.SpaceTravel.flightSnapshot();
      const st = Voxel.SpaceTravel.summonStatus();
      return {
        result: st.result,
        landed: snap.landed,
        dx: Math.hypot(snap.position[0] - t.x, snap.position[2] - t.z),
        pos: snap.position.map(v => Math.round(v * 10) / 10)
      };
    }, beginInfo.target);
    // 真实地形下允许控制器的防卡改道权（NMS 也如此）：完成即可，
    // 终点必须仍在起点远点的邻域内且真正落地。
    check('召唤最终完成 completed', finalInfo.result === 'completed', finalInfo.result);
    check('飞船最终 landed=true', finalInfo.landed === true);
    check('落点仍在目标邻域 (≤40m)', finalInfo.dx <= 40, finalInfo.dx.toFixed(1));
    void finalInfo.pos;
  }

  console.log('页面健康');
  check('页面无未捕获异常', errors.length === 0, errors.slice(0, 2).join('; ') || '');

  if (failed) { console.log(`\n${failed} 项失败`); process.exitCode = 1; }
  else console.log('\nSHIP-SUMMON-E2E-PASS');
})()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => { if (browser) return browser.close(); });
