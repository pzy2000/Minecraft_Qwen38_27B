// 调试掉落物磁吸：独立 puppeteer 脚本
const path = require('path');
const { execSync } = require('child_process');
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) {
  for (const dir of ['/tmp/node_modules', path.join(__dirname, '..', 'node_modules')]) {
    try { puppeteer = require(dir + '/puppeteer-core'); break; } catch (e2) { }
  }
}

const candidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
].filter(p => { try { return require('fs').existsSync(p); } catch (e) { return false; } });

(async () => {
  const root = path.join(__dirname, '..');
  console.log('chrome:', candidates[0]);
  const browser = await puppeteer.launch({
    executablePath: candidates[0],
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 600 });
  page.on('pageerror', e => console.log('PAGE_ERROR:', e.message));
  page.on('console', m => console.log('PAGE:', m.text()));
  await page.goto('file://' + path.join(root, 'index.html'), { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'load' });
  await page.click('#btn-new');
  await page.waitForFunction(() => window.Voxel && Voxel.Game.state === 'playing', { timeout: 120000, polling: 250 });
  await page.evaluate(() => {
    window.__timer = setInterval(() => { try { Voxel.Game._frame(performance.now()); } catch (e) { console.log('FRAME_ERR', e.message); } }, 16);
    const T = Voxel.Game._test;
    window.__frames = 0;
    const origFrame = Voxel.Game._frame;
    Voxel.Game._frame = function (now) { window.__frames++; return origFrame(now); };
    // —— 复刻 browser_test stepE 的前置操作 ——
    T.clearInv();
    var mp = Voxel.Player.pos().clone(); mp.x += 3;
    var pig = Voxel.Mobs.spawn('pig', mp);
    Voxel.Mobs.damage(pig, 99, new THREE.Vector3(1, 0, 0));
    // 挖掘测试留下的视角
    Voxel.Controls.setPitch(-1.55); Voxel.Controls.setYaw(0);

    T.clearInv();
    T.inv()[0] = 3; T.cnt()[0] = 5;
    T.throwSelected();
    console.log('DBG after throw: drops=' + Voxel.Drops.count());
    Voxel.Drops.clear();
    Voxel.Drops.spawn(3, 2, Voxel.Player.pos().clone());
    console.log('DBG after clear+spawn: drops=' + Voxel.Drops.count() +
      ' dropY=' + (Voxel.Drops.list[0] ? Voxel.Drops.list[0].pos.y.toFixed(2) : '?') +
      ' playerY=' + Voxel.Player.pos().y.toFixed(2) +
      ' alive=' + Voxel.Player.alive() + ' state=' + Voxel.Game.state);
  });
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate((k) => {
      var dl = Voxel.Drops.list[0];
      console.log('DBG t+' + (k * 0.3).toFixed(1) + 's frames=' + window.__frames +
        ' drops=' + Voxel.Drops.count() +
        ' invStone=' + Voxel.Game._test.countInv(3) +
        ' dropPos=' + (dl ? dl.pos.x.toFixed(1) + ',' + dl.pos.y.toFixed(2) + ',' + dl.pos.z.toFixed(1) + ' age=' + dl.age.toFixed(2) : '-') +
        ' player=' + Voxel.Player.pos().x.toFixed(1) + ',' + Voxel.Player.pos().y.toFixed(2) + ',' + Voxel.Player.pos().z.toFixed(1));
    }, i);
  }
  await page.evaluate(() => clearInterval(window.__timer));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
