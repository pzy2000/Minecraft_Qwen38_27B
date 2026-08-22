// 诊断：第一人称手持物（方块立方体/工具精灵）与挖掘裂纹的真实渲染验证
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
if (!puppeteer) { console.error('no puppeteer-core'); process.exit(1); }

const candidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
].filter(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
if (!candidates.length) { console.error('no chrome'); process.exit(1); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const root = path.join(__dirname, '..');
  const browser = await puppeteer.launch({
    executablePath: candidates[0],
    headless: 'new',
    defaultViewport: { width: 960, height: 600 },
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGE_ERROR:', e.message));
  await page.goto('file://' + path.join(root, 'index.html'), { waitUntil: 'load' });
  await page.evaluate(() => {
    var inv = []; for (var i = 0; i < 36; i++) inv.push(0);
    localStorage.setItem('voxelcraft_save_v1', JSON.stringify({
      v: 1, seed: 3, time: 0.3,
      player: { pos: [128.5, 40, 128.5], yaw: 0, pitch: -0.25, fly: true, hp: 20 },
      inv: inv, held: 0, edits: {}
    }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.click('#btn-start');
  await page.waitForFunction(() => window.Voxel && Voxel.Game.state === 'playing', { timeout: 120000, polling: 250 });
  await sleep(2000);

  // 站到开阔草地，俯视 30°
  await page.evaluate(() => {
    var found = null;
    for (var x = 100; x < 160 && !found; x++)
      for (var z = 100; z < 160 && !found; z++) {
        var y = Voxel.World.surfaceAt(x, z);
        if ((Voxel.World.get(x, y, z) === 1 || Voxel.World.get(x, y, z) === 2) &&
          Voxel.World.get(x, y + 1, z) === 0 && Voxel.World.get(x, y + 2, z) === 0 &&
          Voxel.World.surfaceAt(x + 2, z + 2) >= y - 1)
          found = { x: x + 0.5, y: y + 1.02, z: z + 0.5 };
      }
    Voxel.Player.init(new THREE.Vector3(found.x, found.y, found.z), 0, -0.5);
    Voxel.World.buildMeshes(32, Voxel.Game.scene);
  });
  await sleep(800);

  async function shot(name) {
    await page.screenshot({ path: path.join(root, 'screenshots', name) });
    console.log('已写入 screenshots/' + name);
  }

  // 1) 手持木板方块（立方体）
  await page.evaluate(() => {
    Voxel.Game._test.clearInv();
    Voxel.Game._test.addInv(10, 12); // 一叠木板
  });
  await sleep(600);
  await shot('_hand_block.png');

  // 2) 手持石镐（工具精灵）
  await page.evaluate(() => {
    Voxel.Game._test.clearInv();
    Voxel.Game._test.addInv(102, 1); // 石镐
  });
  await sleep(600);
  await shot('_hand_tool.png');

  // 3) 空手（应隐藏）
  await page.evaluate(() => { Voxel.Game._test.clearInv(); });
  await sleep(400);
  await shot('_hand_empty.png');

  // 4) 挥动中（挖木头）
  await page.evaluate(() => {
    Voxel.Game._test.addInv(101, 1); // 木镐
    Voxel.Controls.setPitch(-1.55);
  });
  await sleep(300);
  await page.evaluate(() => { Voxel.Game._test.beginDig(); });
  await sleep(260);
  await shot('_hand_swing.png');
  await page.evaluate(() => { Voxel.Game._test.endDig(); });

  await browser.close();
  console.log('done');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
