// 诊断：长按挖掘泥土时裂纹覆盖层是否真的渲染出来
const path = require('path');
const { execSync } = require('child_process');

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) {
  for (const dir of ['/tmp/node_modules', path.join(__dirname, '..', 'node_modules')]) {
    try { puppeteer = require(dir + '/puppeteer-core'); break; } catch (e2) { }
  }
}
if (!puppeteer) { console.error('no puppeteer-core'); process.exit(1); }

const candidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
].filter(p => { try { return require('fs').existsSync(p); } catch (e) { return false; } });
const execPath = candidates[0];
if (!execPath) { console.error('no chrome'); process.exit(1); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const root = path.join(__dirname, '..');
  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: 'new',
    defaultViewport: { width: 960, height: 600 },
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage();
  await page.goto('file://' + path.join(root, 'index.html'), { waitUntil: 'load' });
  // 固定种子存档，出生在开阔处
  await page.evaluate(() => {
    var inv = [];
    for (var i = 0; i < 36; i++) inv.push(0);
    localStorage.setItem('voxelcraft_save_v1', JSON.stringify({
      v: 1, seed: 3, time: 0.3,
      player: { pos: [128.5, 40, 128.5], yaw: 0, pitch: -0.2, fly: true, hp: 20 },
      inv: inv, held: 0, edits: {}
    }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.click('#btn-start');
  await page.waitForFunction(() => window.Voxel && Voxel.Game.state === 'playing', { timeout: 120000, polling: 250 });
  await sleep(2000);

  const info = await page.evaluate(() => {
    // 找脚下是泥/草的开阔点，站上去往下看
    var found = null;
    for (var x = 100; x < 160 && !found; x++)
      for (var z = 100; z < 160 && !found; z++) {
        var y = Voxel.World.surfaceAt(x, z);
        var id = Voxel.World.get(x, y, z);
        if ((id === 1 || id === 2) && Voxel.World.get(x, y + 1, z) === 0 && Voxel.World.get(x, y + 2, z) === 0)
          found = { x: x + 0.5, y: y + 1.02, z: z + 0.5 };
      }
    if (!found) return { err: 'no dirt spot' };
    Voxel.Player.init(new THREE.Vector3(found.x, found.y, found.z), 0, -1.55);
    Voxel.World.buildMeshes(32, Voxel.Game.scene);
    return found;
  });
  console.log('spot:', JSON.stringify(info));
  await sleep(800);

  // 开始长按挖掘
  await page.evaluate(() => { Voxel.Game._test.beginDig(); });
  await sleep(350); // 泥土 hard=0.45s，挖到一半截图

  const mid = await page.evaluate(() => {
    var dp = Voxel.Game._test.digProgress();
    return {
      visible: Voxel.Game._test.crackVisible(),
      prog: dp.p, need: dp.need,
      stage: dp.t ? Math.min(4, (dp.p / dp.need * 5) | 0) : -1
    };
  });
  console.log('mid-dig:', JSON.stringify(mid));
  await page.screenshot({ path: path.join(root, 'screenshots', '_dig_debug.png') });

  await page.evaluate(() => { Voxel.Game._test.endDig(); });
  await browser.close();
  console.log('done');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
