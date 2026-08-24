// 星际闭环端到端：真实页面中验证飞船、星图、跃迁、空间站补给、传送门与多世界存档。
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

(async () => {
  const browser = await puppeteer.launch({
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
    // SpaceTravel 的遥测模型必须在 DOM 缺失时安全降级；本 E2E 若 UI 代理尚未落盘，
    // 注入同名稳定契约以独立验证生产数据/清理/安全格式化。
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
    document.getElementById('seed-input').value = 'STARBOUND-E2E';
    document.getElementById('btn-new').click();
  });

  async function waitWorld(id) {
    await page.waitForFunction((want) => window.Voxel && Voxel.Game && Voxel.Game.state === 'playing' &&
      Voxel.Game._test.currentWorld() && Voxel.Game._test.currentWorld().id === want,
      { timeout: 180000, polling: 250 }, id);
  }
  async function waitShipCockpit(id) {
    await page.waitForFunction((want) => {
      if (!(window.Voxel && Voxel.Game && Voxel.Game._test)) return false;
      const pending = Voxel.Game._test.travelPending();
      const world = Voxel.Game._test.currentWorld();
      return Voxel.Game.state === 'arriving' && world && world.id === want && pending &&
        pending.toId === want && pending.committed === true && pending.sequence &&
        pending.sequence.phase === 'cockpit_arrived';
    }, { timeout: 180000, polling: 100 }, id);
  }
  function check(name, ok) {
    if (!ok) throw new Error('FAIL ' + name);
    console.log('  ok  ' + name);
  }
  function noLeak(values) {
    const s = (Array.isArray(values) ? values : [values]).map(v => String(v)).join(' ');
    return !/undefined|null|NaN|Infinity|\[object Object\]|坐标\s*--\s*\/\s*--/i.test(s);
  }

  await waitWorld('planet-0');
  let first = await page.evaluate(() => ({
    count: Voxel.Game._test.galaxy().catalog.length,
    kind: Voxel.World.getProfile().kind,
    portals: Voxel.SpaceTravel.portals().length,
    ship: !!Voxel.SpaceTravel.ship(),
    hud: document.getElementById('world-name').textContent,
    coord: document.getElementById('world-coord').textContent,
    fuelText: document.getElementById('warp-fuel').textContent,
    fuel: Voxel.Game._test.galaxy().ship.fuel,
    terrainVersion: Voxel.Game._test.galaxy().terrainVersion,
    worldTerrainVersion: Voxel.Game._test.currentWorld().terrainVersion,
    environment: Voxel.Game._test.environmentStatus(),
    environmentSaved: ((Voxel.Save.load().player || {}).environment || null),
    player: [Voxel.Player.pos().x, Voxel.Player.pos().y, Voxel.Player.pos().z],
    spawnCells: [
      Voxel.World.get(Math.floor(Voxel.Player.pos().x), Math.floor(Voxel.Player.pos().y), Math.floor(Voxel.Player.pos().z)),
      Voxel.World.get(Math.floor(Voxel.Player.pos().x), Math.floor(Voxel.Player.pos().y) + 1, Math.floor(Voxel.Player.pos().z)),
      Voxel.World.get(Math.floor(Voxel.Player.pos().x), Math.floor(Voxel.Player.pos().y) - 1, Math.floor(Voxel.Player.pos().z))
    ],
    spawnFloorSolid: Voxel.Blocks.isSolid(Voxel.World.get(
      Math.floor(Voxel.Player.pos().x), Math.floor(Voxel.Player.pos().y) - 1, Math.floor(Voxel.Player.pos().z))),
    scan: {
      status: document.getElementById('scan-terminal').dataset.status,
      kind: document.getElementById('scan-terminal').dataset.targetKind,
      world: document.getElementById('scan-world').textContent,
      position: document.getElementById('scan-position').textContent,
      biome: document.getElementById('scan-biome').textContent,
      environment: document.getElementById('scan-environment').textContent,
      target: document.getElementById('scan-target').textContent,
      distance: document.getElementById('scan-distance').textContent,
      expectedWorld: Voxel.Game._test.currentWorld().name,
      expectedBiome: Voxel.Biomes.name(Voxel.World.biomeAt(
        Math.floor(Voxel.Player.pos().x), Math.floor(Voxel.Player.pos().z)))
    },
    atmosphere: Voxel.Atmosphere.snapshot(),
    atmosphereStats: Voxel.Atmosphere.resourceStats()
  }));
  check('起始星系包含 7 个天体', first.count === 7);
  check('起始世界是行星且生成飞船', first.kind === 'planet' && first.ship);
  check('新星系/行星使用terrainVersion=2且出生点安全',
    first.terrainVersion === 2 && first.worldTerrainVersion === 2 &&
    first.spawnCells[0] !== 7 && first.spawnCells[1] !== 7 && first.spawnFloorSolid);
  check('起始繁茂行星无危害且环境快照已落盘', first.environment &&
    first.environment.hazard === 'none' && first.environment.exposure === 0 &&
    first.environmentSaved && first.environmentSaved.v === 1 && first.environmentSaved.worlds['planet-0']);
  check('行星生成 3-4 扇种子传送门', first.portals >= 3 && first.portals <= 4);
  check('HUD 显示当前天体', first.hud && first.hud.indexOf('未知') < 0);
  check('行星遥测首帧立即online且无残留目标', first.scan.status === 'online' &&
    first.scan.kind === 'none' && first.scan.target === '无锁定目标' && first.scan.distance === '—');
  check('行星遥测世界/群系/环境来自真实状态', first.scan.world.includes(first.scan.expectedWorld) &&
    first.scan.biome === first.scan.expectedBiome && /^(日间|夜间) · (晴|雨|雷雨)$/.test(first.scan.environment));
  check('行星遥测XYZ与玩家有限坐标一致', first.player.every(Number.isFinite) &&
    first.scan.position.includes(first.player[0].toFixed(1)) &&
    first.scan.position.includes(first.player[1].toFixed(1)) &&
    first.scan.position.includes(first.player[2].toFixed(1)));
  check('初始HUD/遥测无禁止泄漏字符串', noLeak([
    first.hud, first.coord, first.fuelText, first.scan.world, first.scan.position,
    first.scan.biome, first.scan.environment, first.scan.target, first.scan.distance
  ]));
  check('起始行星加载唯一类型天空与星云/日月/星环', first.atmosphere.typeKey === 'lush' &&
    ['sky-dome', 'stars', 'sun', 'moon', 'ringed-landmark', 'pollen'].every(role =>
      first.atmosphere.roles.includes(role)) && first.atmosphere.counts.celestial <= 4);
  check('起始Atmosphere资源账本守恒且live有界',
    ['geometries', 'materials', 'textures'].every(key =>
      first.atmosphereStats.created[key] - first.atmosphereStats.disposed[key] === first.atmosphereStats.live[key] &&
      first.atmosphereStats.live[key] >= 0 && first.atmosphereStats.live[key] <= 64));

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.waitForFunction(() => Voxel.SpaceTravel.visualSnapshot().animation.reducedMotion === true,
    { timeout: 5000, polling: 50 });
  const runtimeReducedOn = await page.evaluate(() => Voxel.SpaceTravel.visualSnapshot().animation.reducedMotion);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.waitForFunction(() => Voxel.SpaceTravel.visualSnapshot().animation.reducedMotion === false,
    { timeout: 5000, polling: 50 });
  const runtimeReducedOff = await page.evaluate(() => Voxel.SpaceTravel.visualSnapshot().animation.reducedMotion);
  check('运行时reduced-motion变更同步SpaceTravel且可恢复', runtimeReducedOn && !runtimeReducedOff);

  const initialDiscovery = await page.evaluate(() => {
    const T = Voxel.Game._test;
    const galaxy = T.galaxy();
    const world = T.currentWorld();
    const before = Voxel.Discovery.worldSummary(galaxy.discovery, world.id);
    Voxel.SpaceTravel.showMap();
    const beforeMap = (document.querySelector('#starmap-grid .star-card.current') || {}).textContent || '';
    const unvisitedMap = Array.from(document.querySelectorAll('#starmap-grid .star-card:not(.current)'))
      .map(card => card.textContent).find(text => text.indexOf('未抵达') >= 0) || '';

    // 靠近真实飞船，一次主动扫描同时归档当前群系和行星地标。
    const ship = Voxel.SpaceTravel.ship();
    Voxel.Player.pos().copy(ship.position).add(new THREE.Vector3(0, 1.5, 0));
    Voxel.SpaceTravel.update(0, 0);
    const biomeId = Voxel.World.biomeAt(Math.floor(Voxel.Player.pos().x), Math.floor(Voxel.Player.pos().z));
    const started = Voxel.Game.startActiveScan();
    T.tickActiveScan(0.81);
    const after = Voxel.Discovery.worldSummary(galaxy.discovery, world.id);
    const saved = Voxel.Save.load();
    const savedSummary = Voxel.Discovery.worldSummary(saved.galaxy.discovery, world.id);
    Voxel.SpaceTravel.showMap();
    const afterMap = (document.querySelector('#starmap-grid .star-card.current') || {}).textContent || '';
    return {
      worldId: world.id,
      visited: !!galaxy.discovered[world.id],
      before,
      beforeMap,
      unvisitedMap,
      started,
      biomeId,
      after,
      savedSummary,
      afterMap,
      scanResult: document.getElementById('scan-result').textContent,
      fuel: galaxy.ship.fuel,
      uiState: document.getElementById('scan-active-controls').dataset.state
    };
  });
  check('起始行星只表示已抵达，不将visited冒充surveyed', initialDiscovery.visited &&
    initialDiscovery.before.surveyed === false && initialDiscovery.before.total === 0);
  check('星图在扫描前区分已抵达未测绘/未抵达',
    initialDiscovery.beforeMap.includes('当前位置') && initialDiscovery.beforeMap.includes('尚未主动测绘') &&
    initialDiscovery.unvisitedMap.includes('未抵达'));
  check('主动扫描完成起始行星survey/群系/飞船地标归档', initialDiscovery.started === true &&
    initialDiscovery.after.surveyed && initialDiscovery.after.counts.survey === 1 &&
    initialDiscovery.after.counts.biomes === 1 &&
    initialDiscovery.after.biomes.some(entry => entry.key === String(initialDiscovery.biomeId)) &&
    initialDiscovery.after.landmarks.some(entry => entry.key === 'ship') &&
    initialDiscovery.uiState === 'cooldown');
  check('行星扫描档案立即写入Save且星图改为已测绘进度',
    initialDiscovery.savedSummary.surveyed && initialDiscovery.savedSummary.counts.biomes === 1 &&
    initialDiscovery.savedSummary.counts.landmarks === 1 &&
    initialDiscovery.afterMap.includes('已测绘') && initialDiscovery.afterMap.includes('群系 1'));
  check('满能量时扫描反馈不虚报+5%', initialDiscovery.fuel === 100 &&
    initialDiscovery.scanResult.includes('跃迁能量已满') && !initialDiscovery.scanResult.includes('+5% 跃迁能量'));

  const targetTelemetry = await page.evaluate(async () => {
    const root = document.getElementById('scan-terminal');
    Voxel.SpaceTravel.setScanTarget('block', '石头', 3.456);
    Voxel.SpaceTravel.update(0, 0.016);
    const normal = {
      kind: root.dataset.targetKind,
      target: document.getElementById('scan-target').textContent,
      distance: document.getElementById('scan-distance').textContent
    };
    let mutations = 0;
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
    for (let i = 0; i < 80; i++) Voxel.SpaceTravel.update(0, 0);
    await Promise.resolve();
    observer.disconnect();
    Voxel.SpaceTravel.setScanTarget('mob', 'undefined', Infinity);
    Voxel.SpaceTravel.update(0, 0);
    const unsafe = {
      kind: root.dataset.targetKind,
      target: document.getElementById('scan-target').textContent,
      distance: document.getElementById('scan-distance').textContent
    };
    Voxel.SpaceTravel.setScanTarget('none', 'null', NaN);
    Voxel.SpaceTravel.update(0, 0);
    const cleared = {
      kind: root.dataset.targetKind,
      target: document.getElementById('scan-target').textContent,
      distance: document.getElementById('scan-distance').textContent
    };
    return { normal, mutations, unsafe, cleared };
  });
  check('setScanTarget方块名称/距离安全量化', targetTelemetry.normal.kind === 'block' &&
    targetTelemetry.normal.target === '石头' && targetTelemetry.normal.distance === '3.5 m');
  check('相同遥测高频update不重复写DOM', targetTelemetry.mutations === 0);
  check('坏目标字段被替换并夹紧为有限距离', targetTelemetry.unsafe.kind === 'mob' &&
    targetTelemetry.unsafe.target === '未命名目标' && targetTelemetry.unsafe.distance === '0.0 m' &&
    noLeak(Object.values(targetTelemetry.unsafe)));
  check('清除目标不残留旧名称/距离', targetTelemetry.cleared.kind === 'none' &&
    targetTelemetry.cleared.target === '无锁定目标' && targetTelemetry.cleared.distance === '—');

  const badTelemetry = await page.evaluate(() => {
    const w = Voxel.Game._test.currentWorld();
    const ship = Voxel.Game._test.galaxy().ship;
    const wb = { icon: w.icon, name: w.name, typeName: w.typeName, desc: w.desc, x: w.x, y: w.y };
    const sb = { engine: ship.engine, fuel: ship.fuel, maxFuel: ship.maxFuel };
    w.icon = undefined; w.name = '--'; w.typeName = NaN; w.desc = '[object Object]';
    w.x = Infinity; w.y = -Infinity;
    ship.engine = undefined; ship.fuel = NaN; ship.maxFuel = Infinity;
    Voxel.SpaceTravel.setScanTarget('block', '[object Object]', Infinity);
    Voxel.SpaceTravel.update(0, 0);
    Voxel.SpaceTravel.showMap();
    Voxel.SpaceTravel.showWarp({ name: null }, { name: undefined }, 'ship');
    const ids = ['world-name', 'world-coord', 'warp-fuel', 'starmap-status', 'warp-sub',
      'scan-world', 'scan-position', 'scan-biome', 'scan-environment', 'scan-target', 'scan-distance'];
    const values = ids.map(id => (document.getElementById(id) || {}).textContent || '');
    values.push(document.getElementById('starmap-grid').textContent);
    const injectedMarkup = document.querySelector('#starmap-grid img, #starmap-grid script');
    const placeholderLeak = values.some(value => /(^|\s)--(?:\s|$)|\?\?/.test(value));
    Object.assign(w, wb); Object.assign(ship, sb);
    Voxel.SpaceTravel.setScanTarget('none');
    Voxel.SpaceTravel.update(0, 0);
    Voxel.SpaceTravel.hideWarp();
    return { values, injectedMarkup: !!injectedMarkup, placeholderLeak };
  });
  check('坏world/ship/目标字段不会泄漏程序字符串', noLeak(badTelemetry.values) && !badTelemetry.placeholderLeak);
  check('星图字段只按文本写入且不会注入标记', badTelemetry.injectedMarkup === false);

  const map = await page.evaluate(async () => {
    const ship = Voxel.SpaceTravel.ship();
    Voxel.Player.pos().copy(ship.position).add(new THREE.Vector3(0, 1, 1));
    Voxel.SpaceTravel.update(0.016);
    Voxel.Game.openStarMap();
    await new Promise(resolve => setTimeout(resolve, 0));
    const overlay = document.getElementById('overlay-starmap');
    return {
      state: Voxel.Game.state,
      cards: document.querySelectorAll('#starmap-grid .star-card').length,
      visible: !overlay.classList.contains('hidden'),
      focusInside: overlay.contains(document.activeElement)
    };
  });
  check('靠近飞船可打开 7 天体星图并把焦点置入对话框', map.state === 'starmap' &&
    map.cards === 7 && map.visible && map.focusInside);

  // 星图卡只锁定航线；点火才启动一次事务。第一次目标初始化故障必须自动回到来源，
  // 且不得扣能量或把磁盘 currentId 提前推进到目标。
  const initFaultStart = await page.evaluate(() => {
    const targetId = 'station-0';
    const sourceId = Voxel.Game._test.currentWorld().id;
    const fuelBefore = Voxel.Game._test.galaxy().ship.fuel;
    const card = document.querySelector('#starmap-grid .star-card[data-destination-id="' + targetId + '"]');
    const ignite = document.getElementById('btn-travel-ignite');
    const overlay = document.getElementById('overlay-starmap');
    const before = {
      state: Voxel.Game.state,
      pending: Voxel.Game._test.travelPending(),
      currentId: sourceId
    };
    card.focus();
    card.click();
    const selected = {
      state: Voxel.Game.state,
      pending: Voxel.Game._test.travelPending(),
      currentId: Voxel.Game._test.currentWorld().id,
      selectedId: Voxel.Game._test.selectedTravelId(),
      pressed: card.getAttribute('aria-pressed'),
      cardSelected: card.classList.contains('selected'),
      igniteDisabled: ignite.disabled,
      fuel: Voxel.Game._test.galaxy().ship.fuel
    };

    const realInit = Voxel.World.init;
    const realWarpEnd = Voxel.Sound.warpEnd;
    window.__spaceTravelInitFault = {
      realInit,
      realWarpEnd,
      failures: 0,
      cleanupFailures: 0,
      sourceId,
      fuelBefore,
      sourceRaw: null
    };
    Voxel.World.init = function (seed, profile) {
      if (window.__spaceTravelInitFault && window.__spaceTravelInitFault.failures === 0 &&
        profile && profile.id === targetId) {
        window.__spaceTravelInitFault.failures++;
        Voxel.World.init = realInit;
        throw new Error('E2E_TARGET_WORLD_INIT_FAILURE');
      }
      return realInit.apply(this, arguments);
    };
    Voxel.Sound.warpEnd = function (arrived) {
      if (window.__spaceTravelInitFault && !arrived &&
        window.__spaceTravelInitFault.cleanupFailures === 0) {
        window.__spaceTravelInitFault.cleanupFailures++;
        Voxel.Sound.warpEnd = realWarpEnd;
        throw new Error('E2E_ABORT_AUDIO_CLEANUP_FAILURE');
      }
      return realWarpEnd.apply(this, arguments);
    };

    ignite.focus();
    ignite.click();
    const first = Voxel.Game._test.travelPending();
    window.__spaceTravelInitFault.sourceRaw = localStorage.getItem(Voxel.Config.SAVE_KEY);
    ignite.click();
    const second = Voxel.Game._test.travelPending();
    return {
      before,
      selected,
      first,
      second,
      state: Voxel.Game.state,
      mapHidden: overlay.classList.contains('hidden'),
      mapAriaHidden: overlay.getAttribute('aria-hidden') === 'true',
      focusEscapedMap: !overlay.contains(document.activeElement),
      sourceRawCurrent: JSON.parse(window.__spaceTravelInitFault.sourceRaw).galaxy.currentId
    };
  });
  check('星图卡选择只锁定航线且不立即旅行/扣能量', initFaultStart.before.state === 'starmap' &&
    !initFaultStart.before.pending && initFaultStart.selected.state === 'starmap' &&
    !initFaultStart.selected.pending && initFaultStart.selected.currentId === initFaultStart.before.currentId &&
    initFaultStart.selected.selectedId === 'station-0' && initFaultStart.selected.pressed === 'true' &&
    initFaultStart.selected.cardSelected && !initFaultStart.selected.igniteDisabled &&
    initFaultStart.selected.fuel === 100);
  check('点火按钮只启动一个同serial旅行事务', initFaultStart.first && initFaultStart.second &&
    initFaultStart.state === 'warping' && initFaultStart.first.serial === initFaultStart.second.serial &&
    initFaultStart.first.fromId === 'planet-0' && initFaultStart.first.toId === 'station-0');
  check('点火后星图隐藏且不残留隐藏焦点/模态语义', initFaultStart.mapHidden &&
    initFaultStart.mapAriaHidden && initFaultStart.focusEscapedMap);
  check('点火只提交来源currentId，尚未把磁盘推进到目标',
    initFaultStart.sourceRawCurrent === 'planet-0');

  const initFaultSkip = await page.evaluate(() => {
    const before = Voxel.Game._test.travelPending();
    const focusedBefore = document.activeElement && document.activeElement.id;
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
    });
    const dispatched = document.activeElement.dispatchEvent(escape);
    const afterFirst = Voxel.Game._test.travelPending();
    const second = Voxel.Game.skipFlightPresentation();
    return {
      focusedBefore,
      escapePrevented: !dispatched && escape.defaultPrevented,
      second,
      before,
      afterFirst,
      afterSecond: Voxel.Game._test.travelPending()
    };
  });
  check('焦点位于跳过按钮时Escape仍可触发且故障后不保留pending事务', initFaultSkip.before &&
    initFaultSkip.focusedBefore === 'btn-warp-skip' && initFaultSkip.escapePrevented &&
    initFaultSkip.second === false &&
    initFaultSkip.afterFirst === null && initFaultSkip.afterSecond === null);
  await waitWorld('planet-0');
  const initRecovery = await page.evaluate(() => {
    const fault = window.__spaceTravelInitFault;
    if (fault && fault.realInit) Voxel.World.init = fault.realInit;
    if (fault && fault.realWarpEnd) {
      Voxel.Sound.warpEnd = fault.realWarpEnd;
      fault.realWarpEnd(false);
    }
    const raw = localStorage.getItem(Voxel.Config.SAVE_KEY);
    const saved = Voxel.Save.load();
    const result = {
      failures: fault ? fault.failures : -1,
      cleanupFailures: fault ? fault.cleanupFailures : -1,
      rawSame: !!fault && raw === fault.sourceRaw,
      fuelBefore: fault && fault.fuelBefore,
      fuelAfter: Voxel.Game._test.galaxy().ship.fuel,
      currentId: Voxel.Game._test.currentWorld().id,
      savedCurrentId: saved && saved.galaxy && saved.galaxy.currentId,
      pending: Voxel.Game._test.travelPending(),
      state: Voxel.Game.state
    };
    delete window.__spaceTravelInitFault;
    return result;
  });
  check('目标初始化与中止音频清理同时抛错仍自动恢复来源', initRecovery.failures === 1 &&
    initRecovery.cleanupFailures === 1 &&
    initRecovery.state === 'playing' && initRecovery.currentId === 'planet-0' &&
    initRecovery.savedCurrentId === 'planet-0' && initRecovery.pending === null);
  check('目标初始化失败保持磁盘来源原字节且不扣燃料', initRecovery.rawSame &&
    initRecovery.fuelAfter === initRecovery.fuelBefore);

  // 目标生成成功但 verified commit 返回 false 时，也必须丢弃内存目标并恢复来源快照。
  const commitFaultStart = await page.evaluate(() => {
    const targetId = 'station-0';
    const realSave = Voxel.Save.save;
    window.__spaceTravelCommitFault = {
      realSave,
      failures: 0,
      sourceRaw: null,
      sourceId: Voxel.Game._test.currentWorld().id,
      fuelBefore: Voxel.Game._test.galaxy().ship.fuel
    };
    Voxel.Save.save = function (world, extra) {
      if (window.__spaceTravelCommitFault && window.__spaceTravelCommitFault.failures === 0 &&
        extra && extra.galaxy && extra.galaxy.currentId === targetId) {
        window.__spaceTravelCommitFault.failures++;
        Voxel.Save.save = realSave;
        return false;
      }
      return realSave.apply(this, arguments);
    };
    const ok = Voxel.Game.requestTravel(targetId, 'ship');
    const pending = Voxel.Game._test.travelPending();
    window.__spaceTravelCommitFault.sourceRaw = localStorage.getItem(Voxel.Config.SAVE_KEY);
    const skipFirst = Voxel.Game.skipFlightPresentation();
    const skipSecond = Voxel.Game.skipFlightPresentation();
    return {
      ok,
      pending,
      skipFirst,
      skipSecond,
      sourceRawCurrent: JSON.parse(window.__spaceTravelCommitFault.sourceRaw).galaxy.currentId
    };
  });
  check('目标commit故障旅行已启动且磁盘仍指向来源', commitFaultStart.ok &&
    commitFaultStart.pending && commitFaultStart.pending.toId === 'station-0' &&
    commitFaultStart.sourceRawCurrent === 'planet-0');
  check('成功进入目标加载后再次skip为无副作用false',
    commitFaultStart.skipFirst === true && commitFaultStart.skipSecond === false);
  await waitWorld('planet-0');
  const commitRecovery = await page.evaluate(() => {
    const fault = window.__spaceTravelCommitFault;
    if (fault && fault.realSave) Voxel.Save.save = fault.realSave;
    const raw = localStorage.getItem(Voxel.Config.SAVE_KEY);
    const saved = Voxel.Save.load();
    const result = {
      failures: fault ? fault.failures : -1,
      rawSame: !!fault && raw === fault.sourceRaw,
      fuelBefore: fault && fault.fuelBefore,
      fuelAfter: Voxel.Game._test.galaxy().ship.fuel,
      currentId: Voxel.Game._test.currentWorld().id,
      savedCurrentId: saved && saved.galaxy && saved.galaxy.currentId,
      pending: Voxel.Game._test.travelPending(),
      state: Voxel.Game.state
    };
    delete window.__spaceTravelCommitFault;
    return result;
  });
  check('目标Save.save=false后自动恢复来源且失败恰好一次', commitRecovery.failures === 1 &&
    commitRecovery.state === 'playing' && commitRecovery.currentId === 'planet-0' &&
    commitRecovery.savedCurrentId === 'planet-0' && commitRecovery.pending === null);
  check('目标commit失败保持磁盘来源原字节且不扣燃料', commitRecovery.rawSame &&
    commitRecovery.fuelAfter === commitRecovery.fuelBefore);

  // 在源行星留下带耐久/年龄/速度的工具掉落，并在跃迁动画尚未完成时检查一致源存档。
  const firstDeparture = await page.evaluate(() => {
    const sourceId = Voxel.Game._test.currentWorld().id;
    const p = Voxel.Player.pos().clone().add(new THREE.Vector3(8, 3, 0));
    const d = Voxel.Drops.spawn(102, 1, p, new THREE.Vector3(1.25, 2.5, -0.75), 37);
    if (d) d.age = 12.5;
    Voxel.SpaceTravel.setScanTarget('block', '跨世界残留测试', 8.8);
    Voxel.SpaceTravel.update(0, 0);
    // 从真实雨天离场，验证空间站第一帧不会继承来源世界的灰色天气 tint。
    Voxel.Weather.set('rain');
    Voxel.Weather.update(Voxel.Config.WEATHER.TRANSITION + 0.1);
    const sourceWeatherTint = Voxel.Weather.getTint().getHex();
    const ok = Voxel.Game.requestTravel('station-0', 'ship');
    const beforePagehide = Voxel.Save.load();
    window.dispatchEvent(typeof PageTransitionEvent === 'function'
      ? new PageTransitionEvent('pagehide', { persisted: false }) : new Event('pagehide'));
    const afterPagehide = Voxel.Save.load();
    return {
      ok,
      sourceId,
      state: Voxel.Game.state,
      pending: Voxel.Game._test.travelPending(),
      sourceWeatherTint,
      sourceDiscovery: Voxel.Discovery.worldSummary(beforePagehide.galaxy.discovery, sourceId),
      pagehideDiscoverySame: JSON.stringify(beforePagehide.galaxy.discovery) === JSON.stringify(afterPagehide.galaxy.discovery),
      beforePagehide,
      afterPagehide
    };
  });
  check('飞船接受空间站跃迁请求', firstDeparture.ok === true);
  check('离场前雨天确实产生非中性天气tint', firstDeparture.sourceWeatherTint !== 0xffffff);
  check('跃迁动画期间保持明确 pending 事务', firstDeparture.state === 'warping' &&
    firstDeparture.pending && firstDeparture.pending.fromId === 'planet-0' &&
    firstDeparture.pending.toId === 'station-0');
  check('跃迁前先保存一致源世界与工具掉落', firstDeparture.beforePagehide &&
    firstDeparture.beforePagehide.galaxy.currentId === firstDeparture.sourceId &&
    firstDeparture.beforePagehide.galaxy.worlds[firstDeparture.sourceId] &&
    firstDeparture.beforePagehide.galaxy.worlds[firstDeparture.sourceId].drops.some(d =>
      d.id === 102 && d.n === 1 && d.dur === 37 && Math.abs(d.age - 12.5) < 0.001 &&
      d.vel[0] === 1.25 && d.vel[1] === 2.5 && d.vel[2] === -0.75));
  check('warping 中 pagehide 不写出源数据与目标 currentId 混合档', firstDeparture.afterPagehide &&
    firstDeparture.afterPagehide.galaxy.currentId === firstDeparture.sourceId &&
    JSON.stringify(firstDeparture.afterPagehide) === JSON.stringify(firstDeparture.beforePagehide));
  check('起始行星发现档案穿过离场保存/pagehide链路', firstDeparture.sourceDiscovery.surveyed &&
    firstDeparture.sourceDiscovery.counts.biomes === 1 && firstDeparture.pagehideDiscoverySame);
  const firstDepartureSkip = await page.evaluate(() => {
    const before = Voxel.Game._test.travelPending();
    const first = Voxel.Game.skipFlightPresentation();
    const after = Voxel.Game._test.travelPending();
    const second = Voxel.Game.skipFlightPresentation();
    return { before, first, after, second, finalPending: Voxel.Game._test.travelPending() };
  });
  check('正常飞船旅行skip只推进一次到目标加载', firstDepartureSkip.before &&
    firstDepartureSkip.first === true && firstDepartureSkip.second === false &&
    firstDepartureSkip.after && firstDepartureSkip.finalPending &&
    firstDepartureSkip.after.serial === firstDepartureSkip.finalPending.serial);
  await waitShipCockpit('station-0');
  const stationCockpit = await page.evaluate(() => {
    const pending = Voxel.Game._test.travelPending();
    const saved = Voxel.Save.load();
    const overlay = document.getElementById('overlay-warp');
    const button = document.getElementById('btn-disembark');
    return {
      state: Voxel.Game.state,
      currentId: Voxel.Game._test.currentWorld().id,
      savedCurrentId: saved && saved.galaxy && saved.galaxy.currentId,
      pending,
      overlayVisible: !overlay.classList.contains('hidden'),
      phase: overlay.getAttribute('data-phase'),
      buttonReady: !button.hidden && !button.disabled && button.getAttribute('aria-disabled') === 'false'
    };
  });
  check('飞船先在cockpit_arrived停泊且目标存档已提交回读', stationCockpit.state === 'arriving' &&
    stationCockpit.currentId === 'station-0' && stationCockpit.savedCurrentId === 'station-0' &&
    stationCockpit.pending && stationCockpit.pending.committed === true &&
    stationCockpit.pending.sequence.phase === 'cockpit_arrived');
  check('驾驶舱抵达阶段保持可见并启用显式下船入口', stationCockpit.overlayVisible &&
    stationCockpit.phase === 'cockpit_arrived' && stationCockpit.buttonReady);
  const stationDisembark = await page.evaluate(() => {
    const button = document.getElementById('btn-disembark');
    button.focus();
    const keyE = new KeyboardEvent('keydown', {
      key: 'e', code: 'KeyE', bubbles: true, cancelable: true
    });
    const dispatched = button.dispatchEvent(keyE);
    const afterFirst = {
      state: Voxel.Game.state,
      pending: Voxel.Game._test.travelPending(),
      overlayHidden: document.getElementById('overlay-warp').classList.contains('hidden'),
      arrivalVisible: !document.getElementById('arrival-card').classList.contains('hidden'),
      scanView: document.getElementById('scan-terminal').dataset.view
    };
    const second = Voxel.Game.disembark();
    return {
      keyPrevented: !dispatched && keyE.defaultPrevented,
      second,
      afterFirst,
      afterSecond: Voxel.Game._test.travelPending()
    };
  });
  check('下船按钮聚焦时E可完成旅行且重复disembark幂等', stationDisembark.keyPrevented &&
    stationDisembark.second === false && stationDisembark.afterFirst.state === 'playing' &&
    stationDisembark.afterFirst.pending === null && stationDisembark.afterFirst.overlayHidden &&
    stationDisembark.afterFirst.arrivalVisible && stationDisembark.afterFirst.scanView === 'arrival' &&
    stationDisembark.afterSecond === null);
  await waitWorld('station-0');
  const station = await page.evaluate(() => {
    const galaxy = Voxel.Game._test.galaxy();
    const world = Voxel.Game._test.currentWorld();
    Voxel.SpaceTravel.showMap();
    return {
      kind: Voxel.World.getProfile().kind,
      fuel: galaxy.ship.fuel,
      max: galaxy.ship.maxFuel,
      deck: Voxel.World.get(128, 23, 128),
      portals: Voxel.SpaceTravel.portals().length,
      drops: Voxel.Drops.snapshot(),
      savedCurrent: (Voxel.Save.load().galaxy || {}).currentId,
      actionHint: Voxel.SpaceTravel.actionHint(),
      atmosphere: Voxel.Atmosphere.snapshot(),
      atmosphereStats: Voxel.Atmosphere.resourceStats(),
      weatherTint: [Voxel.Weather.getTint().r, Voxel.Weather.getTint().g, Voxel.Weather.getTint().b],
      weatherIntensity: Voxel.Weather.intensity(),
      environment: Voxel.Game._test.environmentStatus(),
      environmentSaved: (Voxel.Save.load().player || {}).environment || null,
      discovery: Voxel.Discovery.worldSummary(galaxy.discovery, world.id),
      planetDiscovery: Voxel.Discovery.worldSummary(galaxy.discovery, 'planet-0'),
      mapCurrent: (document.querySelector('#starmap-grid .star-card.current') || {}).textContent || '',
      scan: {
        status: document.getElementById('scan-terminal').dataset.status,
        kind: document.getElementById('scan-terminal').dataset.targetKind,
        world: document.getElementById('scan-world').textContent,
        biome: document.getElementById('scan-biome').textContent,
        environment: document.getElementById('scan-environment').textContent,
        target: document.getElementById('scan-target').textContent,
        distance: document.getElementById('scan-distance').textContent,
        expectedWorld: world.name
      }
    };
  });
  check('抵达独立空间站体素世界', station.kind === 'station' && station.deck !== 0);
  check('空间站自动补满跃迁能量', station.fuel === station.max);
  check('空间站危害为none且保留行星环境分世界快照', station.environment &&
    station.environment.hazard === 'none' && station.environment.exposure === 0 &&
    station.environmentSaved && station.environmentSaved.worlds['planet-0'] &&
    station.environmentSaved.worlds['station-0']);
  check('空间站拥有返回用传送门', station.portals === 3);
  check('抵达后提交目标世界存档', station.savedCurrent === 'station-0');
  check('源行星掉落未泄漏到空间站', station.drops.length === 0);
  check('空间站遥测首帧切换世界且清除行星目标', station.scan.status === 'online' &&
    station.scan.kind === 'none' && station.scan.world.includes(station.scan.expectedWorld) &&
    station.scan.target === '无锁定目标' && station.scan.distance === '—' &&
    station.scan.world.indexOf('跨世界残留测试') < 0);
  check('空间站遥测使用平台/真空环境而非行星群系', station.scan.biome === '空间站平台' &&
    station.scan.environment === '真空 · 人工重力' && noLeak(Object.values(station.scan)));
  check('空间站航行终端提示与只读遥测终端保持独立', /航行终端/.test(station.actionHint) &&
    /打开星图/.test(station.actionHint) && station.scan.target === '无锁定目标');
  check('空间站切换为唯一deep-space天空且无行星日月/重复星场',
    station.atmosphere.typeKey === 'station' && station.atmosphere.roles.includes('deep-space-dome') &&
    station.atmosphere.roles.includes('station-stars') && station.atmosphere.roles.includes('ringed-landmark') &&
    !['sky-dome', 'stars', 'sun', 'moon'].some(role => station.atmosphere.roles.includes(role)));
  check('雨天跃迁空间站后天气tint立即中性且资源仍守恒',
    station.weatherIntensity === 0 && station.weatherTint.every(v => Math.abs(v - 1) < 1e-9) &&
    ['geometries', 'materials', 'textures'].every(key =>
      station.atmosphereStats.created[key] - station.atmosphereStats.disposed[key] === station.atmosphereStats.live[key]));
  check('刚抵达空间站仍是visited但未测绘，源行星档案保留',
    station.discovery.surveyed === false && station.mapCurrent.includes('尚未主动测绘') &&
    station.planetDiscovery.surveyed && station.planetDiscovery.counts.biomes === 1);

  const stationDiscovery = await page.evaluate(() => {
    const T = Voxel.Game._test;
    const galaxy = T.galaxy();
    const world = T.currentWorld();
    // 航行终端地标只在中央平台10格内记录。
    Voxel.Player.pos().set(128.5, 27.5, 128.5);
    const started = Voxel.Game.startActiveScan();
    T.tickActiveScan(0.81);
    const after = Voxel.Discovery.worldSummary(galaxy.discovery, world.id);
    const planet = Voxel.Discovery.worldSummary(galaxy.discovery, 'planet-0');
    const saved = Voxel.Save.load();
    const savedAfter = Voxel.Discovery.worldSummary(saved.galaxy.discovery, world.id);
    const savedPlanet = Voxel.Discovery.worldSummary(saved.galaxy.discovery, 'planet-0');
    Voxel.SpaceTravel.showMap();
    return {
      started,
      after,
      planet,
      savedAfter,
      savedPlanet,
      mapCurrent: (document.querySelector('#starmap-grid .star-card.current') || {}).textContent || ''
    };
  });
  check('空间站主动扫描写入survey和航行终端地标', stationDiscovery.started &&
    stationDiscovery.after.surveyed && stationDiscovery.after.counts.survey === 1 &&
    stationDiscovery.after.counts.biomes === 0 &&
    stationDiscovery.after.landmarks.some(entry => entry.key === 'station-terminal'));
  check('空间站扫描立即持久化且星图显示已测绘', stationDiscovery.savedAfter.surveyed &&
    stationDiscovery.savedAfter.counts.landmarks === 1 && stationDiscovery.mapCurrent.includes('已测绘'));
  check('扫描空间站不会覆盖起始行星发现档案', stationDiscovery.planet.surveyed &&
    stationDiscovery.savedPlanet.surveyed && stationDiscovery.savedPlanet.counts.biomes === 1);

  await page.evaluate(() => Voxel.World.set(130, 24, 130, 13));
  const returnDeparture = await page.evaluate(() => {
    const p = Voxel.Player.pos().clone().add(new THREE.Vector3(7, 2, 0));
    const d = Voxel.Drops.spawn(10, 3, p, new THREE.Vector3(-1, 1.5, 0.5), null);
    if (d) d.age = 8;
    const ok = Voxel.Game.requestTravel('planet-0', 'ship');
    const saved = Voxel.Save.load();
    return {
      ok,
      saved,
      planetDiscovery: Voxel.Discovery.worldSummary(saved.galaxy.discovery, 'planet-0'),
      stationDiscovery: Voxel.Discovery.worldSummary(saved.galaxy.discovery, 'station-0')
    };
  });
  check('空间站航行终端可返回行星', returnDeparture.ok === true);
  check('空间站离场前保存自己的掉落快照', returnDeparture.saved &&
    returnDeparture.saved.galaxy.currentId === 'station-0' &&
    returnDeparture.saved.galaxy.worlds['station-0'].drops.some(d =>
      d.id === 10 && d.n === 3 && d.dur === null && Math.abs(d.age - 8) < 0.001));
  check('双世界发现档案随空间站离场存档保留', returnDeparture.planetDiscovery.surveyed &&
    returnDeparture.planetDiscovery.counts.biomes === 1 && returnDeparture.stationDiscovery.surveyed &&
    returnDeparture.stationDiscovery.landmarks.some(entry => entry.key === 'station-terminal'));
  check('返航飞船可跳过点火/跃迁表现进入目标加载',
    await page.evaluate(() => Voxel.Game.skipFlightPresentation()) === true);
  await waitShipCockpit('planet-0');
  const planetCockpit = await page.evaluate(() => {
    const pending = Voxel.Game._test.travelPending();
    const saved = Voxel.Save.load();
    const first = Voxel.Game.disembark();
    const second = Voxel.Game.disembark();
    return {
      committedBeforeExit: !!pending && pending.committed === true && pending.sequence &&
        pending.sequence.phase === 'cockpit_arrived',
      savedCurrentBeforeExit: saved && saved.galaxy && saved.galaxy.currentId,
      first,
      second,
      stateAfterExit: Voxel.Game.state,
      pendingAfterExit: Voxel.Game._test.travelPending()
    };
  });
  check('返航目标提交后才允许下船且重复调用不改变完成态', planetCockpit.committedBeforeExit &&
    planetCockpit.savedCurrentBeforeExit === 'planet-0' && planetCockpit.first === true &&
    planetCockpit.second === false && planetCockpit.stateAfterExit === 'playing' &&
    planetCockpit.pendingAfterExit === null);
  await waitWorld('planet-0');
  const backOnPlanet = await page.evaluate(() => {
    const galaxy = Voxel.Game._test.galaxy();
    return {
      fuel: galaxy.ship.fuel,
      drops: Voxel.Drops.snapshot(),
      atmosphere: Voxel.Atmosphere.snapshot(),
      planetDiscovery: Voxel.Discovery.worldSummary(galaxy.discovery, 'planet-0'),
      stationDiscovery: Voxel.Discovery.worldSummary(galaxy.discovery, 'station-0'),
      savedDiscovery: Voxel.Save.load().galaxy.discovery,
      savedPlanetDiscovery: Voxel.Discovery.worldSummary(Voxel.Save.load().galaxy.discovery, 'planet-0'),
      savedStationDiscovery: Voxel.Discovery.worldSummary(Voxel.Save.load().galaxy.discovery, 'station-0'),
      environment: Voxel.Game._test.environmentStatus(),
      scan: {
        kind: document.getElementById('scan-terminal').dataset.targetKind,
        world: document.getElementById('scan-world').textContent,
        biome: document.getElementById('scan-biome').textContent,
        environment: document.getElementById('scan-environment').textContent,
        target: document.getElementById('scan-target').textContent,
        expectedWorld: Voxel.Game._test.currentWorld().name,
        expectedBiome: Voxel.Biomes.name(Voxel.World.biomeAt(
          Math.floor(Voxel.Player.pos().x), Math.floor(Voxel.Player.pos().z)))
      }
    };
  });
  const afterShipFuel = backOnPlanet.fuel;
  check('飞船跃迁实际消耗能量', afterShipFuel < station.max);
  check('返航行星恢复原工具掉落及耐久且隔离空间站掉落',
    backOnPlanet.drops.some(d => d.id === 102 && d.n === 1 && d.dur === 37 && d.age >= 12.5) &&
    !backOnPlanet.drops.some(d => d.id === 10 && d.n === 3));
  check('返航行星遥测清除空间站环境与目标', backOnPlanet.scan.kind === 'none' &&
    backOnPlanet.scan.world.includes(backOnPlanet.scan.expectedWorld) &&
    backOnPlanet.scan.biome === backOnPlanet.scan.expectedBiome &&
    backOnPlanet.scan.biome !== '空间站平台' && backOnPlanet.scan.environment !== '真空 · 人工重力' &&
    backOnPlanet.scan.target === '无锁定目标' && noLeak(Object.values(backOnPlanet.scan)));
  check('返航行星第一帧恢复lush天空且不残留station roles', backOnPlanet.atmosphere.typeKey === 'lush' &&
    backOnPlanet.atmosphere.roles.includes('sky-dome') && backOnPlanet.atmosphere.roles.includes('pollen') &&
    !backOnPlanet.atmosphere.roles.includes('station-stars'));
  check('双世界survey/群系/地标档案穿过返航和目标世界提交', backOnPlanet.planetDiscovery.surveyed &&
    backOnPlanet.planetDiscovery.counts.biomes === 1 && backOnPlanet.stationDiscovery.surveyed &&
    backOnPlanet.stationDiscovery.landmarks.some(entry => entry.key === 'station-terminal') &&
    backOnPlanet.savedPlanetDiscovery.surveyed && backOnPlanet.savedStationDiscovery.surveyed);
  check('页面内返回已访天体不可重复刷新30s环境grace',
    backOnPlanet.environment && backOnPlanet.environment.worldId === 'planet-0' &&
    backOnPlanet.environment.graceRemaining === 0);

  const portalJump = await page.evaluate(() => {
    const realWarpPhase = Voxel.Sound.warpPhase;
    window.__committedPresentationFault = { realWarpPhase, failures: 0 };
    Voxel.Sound.warpPhase = function (mode, phase) {
      if (window.__committedPresentationFault && phase === 'arrival' &&
        window.__committedPresentationFault.failures === 0) {
        window.__committedPresentationFault.failures++;
        Voxel.Sound.warpPhase = realWarpPhase;
        throw new Error('E2E_COMMITTED_ARRIVAL_PRESENTATION_FAILURE');
      }
      return realWarpPhase.apply(this, arguments);
    };
    return {
      ok: Voxel.Game.requestTravel('station-0', 'portal'),
      fuel: Voxel.Game._test.galaxy().ship.fuel
    };
  });
  check('传送门接受免费旅行请求', portalJump.ok === true);
  check('传送门离场时不扣跃迁能量', portalJump.fuel === afterShipFuel);
  await waitWorld('station-0');
  const roundTrip = await page.evaluate(() => {
    const fault = window.__committedPresentationFault;
    if (fault && fault.realWarpPhase) Voxel.Sound.warpPhase = fault.realWarpPhase;
    const warp = document.getElementById('overlay-warp');
    const arrival = document.getElementById('arrival-card');
    const result = {
      presentationFailures: fault ? fault.failures : -1,
      state: Voxel.Game.state,
      pending: Voxel.Game._test.travelPending(),
      selected: Voxel.Game._test.selectedTravelId(),
      disembark: Voxel.Game.disembark(),
      warpHidden: warp.classList.contains('hidden'),
      hiddenFocus: warp.contains(document.activeElement),
      arrivalVisible: !arrival.classList.contains('hidden'),
      audio: Voxel.Sound.flightAudioSnapshot(),
      fuel: Voxel.Game._test.galaxy().ship.fuel,
      edit: Voxel.World.get(130, 24, 130),
      discovered: Object.keys(Voxel.Game._test.galaxy().discovered).length,
      drops: Voxel.Drops.snapshot(),
      planetDiscovery: Voxel.Discovery.worldSummary(Voxel.Game._test.galaxy().discovery, 'planet-0'),
      stationDiscovery: Voxel.Discovery.worldSummary(Voxel.Game._test.galaxy().discovery, 'station-0')
    };
    delete window.__committedPresentationFault;
    return result;
  });
  check('目标已提交后抵达演出异常仍完整退场且不要求下船',
    roundTrip.presentationFailures === 1 && roundTrip.state === 'playing' &&
    roundTrip.pending === null && roundTrip.selected === null && roundTrip.disembark === false &&
    roundTrip.warpHidden && !roundTrip.hiddenFocus && roundTrip.arrivalVisible &&
    !roundTrip.audio.active && roundTrip.audio.phase === 'complete');
  check('重返空间站后再次完成补能', roundTrip.fuel === station.max);
  check('空间站修改在跨世界往返后恢复', roundTrip.edit === 13);
  check('发现记录随旅行更新', roundTrip.discovered >= 2);
  check('重返空间站只恢复空间站掉落', roundTrip.drops.some(d => d.id === 10 && d.n === 3) &&
    !roundTrip.drops.some(d => d.id === 102));
  check('多次跃迁后两个主动测绘档案仍完整', roundTrip.planetDiscovery.surveyed &&
    roundTrip.planetDiscovery.counts.biomes === 1 && roundTrip.stationDiscovery.surveyed &&
    roundTrip.stationDiscovery.counts.landmarks === 1);

  // 再离场并第三次进入空间站：applyEdits 回放后的修改仍须进入下一份世界快照。
  check('二次离开空间站请求成功',
    await page.evaluate(() => Voxel.Game.requestTravel('planet-0', 'portal')) === true);
  await waitWorld('planet-0');
  check('正常传送门抵达自动完成且不要求下船', await page.evaluate(() =>
    Voxel.Game._test.travelPending() === null && Voxel.Game.disembark() === false));
  check('第三次进入空间站请求成功',
    await page.evaluate(() => Voxel.Game.requestTravel('station-0', 'portal')) === true);
  await waitWorld('station-0');
  check('多次离场后空间站修改仍保留',
    await page.evaluate(() => Voxel.World.get(130, 24, 130)) === 13);
  const finalAtmosphere = await page.evaluate(() => ({
    roots: Voxel.Game.scene.children.filter(o => o.userData && o.userData.system === 'atmosphere').length,
    snap: Voxel.Atmosphere.snapshot(),
    stats: Voxel.Atmosphere.resourceStats()
  }));
  check('多次往返后天空仍单root且live资源有界', finalAtmosphere.roots === 1 &&
    finalAtmosphere.snap.typeKey === 'station' &&
    ['geometries', 'materials', 'textures'].every(key =>
      finalAtmosphere.stats.created[key] - finalAtmosphere.stats.disposed[key] === finalAtmosphere.stats.live[key] &&
      finalAtmosphere.stats.live[key] <= 64));

  await page.evaluate(() => {
    Voxel.Game.onKey('KeyP');
    document.getElementById('btn-save').click();
  });
  const saved = await page.evaluate(() => Voxel.Save.load());
  check('v5 存档保留当前天体', saved.v === 5 && saved.galaxy.currentId === 'station-0');
  check('v5 存档隔离多个世界快照', saved.galaxy.worlds['planet-0'] && saved.galaxy.worlds['station-0']);
  check('存档按世界隔离行星/空间站掉落',
    saved.galaxy.worlds['planet-0'].drops.some(d => d.id === 102 && d.dur === 37) &&
    saved.galaxy.worlds['station-0'].drops.some(d => d.id === 10 && d.n === 3) &&
    saved.drops.some(d => d.id === 10 && d.n === 3));
  const savedDiscoverySummaries = await page.evaluate(() => {
    const data = Voxel.Save.load();
    return {
      planet: Voxel.Discovery.worldSummary(data.galaxy.discovery, 'planet-0'),
      station: Voxel.Discovery.worldSummary(data.galaxy.discovery, 'station-0')
    };
  });
  const savedPlanetDiscovery = savedDiscoverySummaries.planet;
  const savedStationDiscovery = savedDiscoverySummaries.station;
  check('最终手动保存保留行星群系与空间站终端档案', savedPlanetDiscovery.surveyed &&
    savedPlanetDiscovery.counts.biomes === 1 && savedStationDiscovery.surveyed &&
    savedStationDiscovery.landmarks.some(entry => entry.key === 'station-terminal'));
  const offline = await page.evaluate(() => {
    Voxel.SpaceTravel.clear();
    return {
      status: document.getElementById('scan-terminal').dataset.status,
      kind: document.getElementById('scan-terminal').dataset.targetKind,
      values: ['scan-world', 'scan-position', 'scan-biome', 'scan-environment', 'scan-target', 'scan-distance']
        .map(id => document.getElementById(id).textContent),
      hud: ['world-name', 'world-coord', 'warp-fuel'].map(id => document.getElementById(id).textContent)
    };
  });
  check('clear后遥测明确offline且不保留跨世界目标', offline.status === 'offline' &&
    offline.kind === 'none' && offline.values[4] === '无锁定目标' && offline.values[5] === '—' &&
    offline.hud[0].includes('导航链路离线') && offline.hud[1] === '星图坐标离线' &&
    offline.hud[2] === '跃迁待机' && noLeak(offline.values.concat(offline.hud)));
  check('页面运行无未捕获异常', errors.length === 0);

  await browser.close();
  console.log('\nSPACE-TRAVEL-PASS');
})().catch(async e => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
