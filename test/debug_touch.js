// 探针：长按挖掘链路（按下目标点 → 推帧 → 检查 digProgress/方块/射线）
const path = require('path');
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (e) {
  for (const dir of ['/tmp/node_modules', path.join(__dirname, '..', 'node_modules')]) {
    try { puppeteer = require(dir + '/puppeteer-core'); break; } catch (e2) { }
  }
}
(async () => {
  const root = path.join(__dirname, '..');
  const exe = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  const browser = await puppeteer.launch({
    executablePath: exe, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 600 });
  page.on('pageerror', e => console.log('PAGE_ERROR:', e.message));
  await page.evaluateOnNewDocument(() => { window.__FORCE_TOUCH__ = true; });
  await page.goto('file://' + path.join(root, 'test/touch_test.html'), { waitUntil: 'load' });

  // 等进入 playing
  await page.waitForFunction(() => window.Voxel && Voxel.Game && Voxel.Game.state === 'playing', { timeout: 120000, polling: 200 });
  await new Promise(r => setTimeout(r, 400));

  const out = await page.evaluate(async () => {
    let dbg = '';
    try {
      function pev2(type, id, x, y) {
        const el = document.elementFromPoint(x, y) || document.body;
        el.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
          isPrimary: true, clientX: x, clientY: y, button: 0
        }));
      }
      const sp2 = Voxel.World.spawnPoint();
      const gx2 = Math.floor(sp2.x), gz2 = Math.floor(sp2.z), gy2 = Voxel.World.surfaceAt(gx2, gz2);
      const fx2 = gx2, fz2 = gz2 - 2, fy2 = Voxel.World.surfaceAt(fx2, fz2);
      Voxel.World.set(fx2, fy2, fz2, 2);
      Voxel.Player.init(new THREE.Vector3(gx2 + 0.5, gy2 + 1.02, gz2 + 0.5), 0, -0.35);
      const ex2 = gx2 + 0.5, ey2 = gy2 + 1.02 + 1.62, ez2 = gz2 + 0.5;
      const tx2 = fx2 + 0.5 - ex2, ty2 = fy2 + 0.5 - ey2, tz2 = fz2 + 0.5 - ez2;
      const hd2 = Math.sqrt(tx2 * tx2 + tz2 * tz2);
      Voxel.Controls.setYaw(Math.atan2(-tx2, -tz2));
      Voxel.Controls.setPitch(Math.atan2(ty2, hd2));
      for (let i = 0; i < 10; i++) Voxel.Game._frame(performance.now());

      // 先长按挖掉目标
      let v0 = new THREE.Vector3(fx2 + 0.5, fy2 + 0.6, fz2 + 0.5).project(Voxel.Game.camera);
      let px = ((v0.x + 1) / 2) * innerWidth, py = ((1 - v0.y) / 2) * innerHeight;
      pev2('pointerdown', 99, px, py);
      for (let i = 0; i < 60; i++) { Voxel.Game._frame(performance.now() + i * 20); await new Promise(r => setTimeout(r, 8)); }
      pev2('pointerup', 99, px, py);
      dbg = 'dug=' + (Voxel.World.get(fx2, fy2, fz2) === 0);

      // 复刻 stepE：对准洞底面中点轻点
      Voxel.Game._test.inv()[0] = 10; Voxel.Game._test.cnt()[0] = 5;
      const p3 = Voxel.Player.pos();
      const tx3 = fx2 + 0.5 - p3.x, ty3 = (fy2 + 0.02) - (p3.y + 1.62), tz3 = fz2 + 0.5 - p3.z;
      const hd3 = Math.sqrt(tx3 * tx3 + tz3 * tz3);
      Voxel.Controls.setYaw(Math.atan2(-tx3, -tz3));
      Voxel.Controls.setPitch(Math.atan2(ty3, hd3));
      for (let i = 0; i < 4; i++) Voxel.Game._frame(performance.now() + 100 + i * 20);
      v0 = new THREE.Vector3(fx2 + 0.5, fy2 + 0.02, fz2 + 0.5).project(Voxel.Game.camera);
      px = ((v0.x + 1) / 2) * innerWidth; py = ((1 - v0.y) / 2) * innerHeight;
      dbg += ' tap@' + px.toFixed(0) + ',' + py.toFixed(0);
      const vv = new THREE.Vector3((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1, 0.5).unproject(Voxel.Game.camera);
      vv.sub(Voxel.Game.camera.position).normalize();
      const hit = Voxel.Raycaster.cast(Voxel.Player.eyePos(), vv, 6);
      dbg += ' rayHit=' + (hit ? (hit.type + (hit.type === 'block' ? ' id' + hit.id + ' @' + hit.x + ',' + hit.y + ',' + hit.z + ' n=' + hit.nx + ',' + hit.ny + ',' + hit.nz : '')) : 'none');
      pev2('pointerdown', 98, px, py);
      pev2('pointerup', 98, px, py);
      for (let i = 0; i < 6; i++) Voxel.Game._frame(performance.now() + 200 + i * 20);
      dbg += ' after: hole=' + Voxel.World.get(fx2, fy2, fz2) + ' inv0=' + Voxel.Game._test.cnt()[0];
    } catch (e) { dbg = 'DBGERR ' + e.message; }
    return dbg;
  });
  console.log('PROBE:', out);
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
