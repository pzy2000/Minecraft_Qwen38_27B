// 精选世界：主菜单推荐世界网格
// 种子与 test/capture_biomes.js 一致（种子 12345 含全部 18 种群系），进入后自动传送到对应群系
// 本模块自成一体：弹窗开关不依赖 main.js，图片缺失时以群系色块兜底
window.Voxel = window.Voxel || {};

Voxel.Featured = (function () {
  var SEED = 12345;   // 与 test/capture_biomes.js 相同：含全部 18 种群系的种子

  var WORLDS = [
    { name: '全景俯瞰',   desc: '多种群系自然过渡交界',     img: 'screenshots/biomes/overview.png',        seed: SEED, overview: true,          color: '#5b7f6e' },
    { name: '平原',       desc: '草地丘陵、橡树与羊群',     img: 'screenshots/biomes/plains.png',          seed: SEED, biome: 'PLAINS',         color: '#6fa14e' },
    { name: '森林',       desc: '密集橡树林',               img: 'screenshots/biomes/forest.png',          seed: SEED, biome: 'FOREST',         color: '#4e7a34' },
    { name: '白桦森林',   desc: '银白树干的桦木林',         img: 'screenshots/biomes/birch-forest.png',    seed: SEED, biome: 'BIRCH_FOREST',   color: '#8fae62' },
    { name: '沙漠',       desc: '沙丘、仙人掌与砂岩层',     img: 'screenshots/biomes/desert.png',          seed: SEED, biome: 'DESERT',         color: '#d9c27e' },
    { name: '丛林',       desc: '高耸入云的巨型丛林树',     img: 'screenshots/biomes/jungle.png',          seed: SEED, biome: 'JUNGLE',         color: '#2f7a3d' },
    { name: '稀疏丛林',   desc: '疏林草地间的丛林木',       img: 'screenshots/biomes/sparse-jungle.png',   seed: SEED, biome: 'SPARSE_JUNGLE',  color: '#5c9440' },
    { name: '热带草原',   desc: '金合欢稀树草原',           img: 'screenshots/biomes/savanna.png',         seed: SEED, biome: 'SAVANNA',        color: '#b2a24a' },
    { name: '针叶林',     desc: '成片云杉林',               img: 'screenshots/biomes/taiga.png',           seed: SEED, biome: 'TAIGA',          color: '#3f6b52' },
    { name: '原始针叶林', desc: '灰化土与巨型云杉',         img: 'screenshots/biomes/mega-taiga.png',      seed: SEED, biome: 'MEGA_TAIGA',     color: '#6b543c' },
    { name: '雪原',       desc: '积雪地表与云杉',           img: 'screenshots/biomes/snowy.png',           seed: SEED, biome: 'SNOWY',          color: '#cfd8de' },
    { name: '风袭丘陵',   desc: '砾石斑驳的起伏山地',       img: 'screenshots/biomes/windswept-hills.png', seed: SEED, biome: 'WINDSWEPT_HILLS', color: '#7d8a6e' },
    { name: '尖峭山峰',   desc: '雪帽石峰与峭壁悬垂',       img: 'screenshots/biomes/peaks.png',           seed: SEED, biome: 'JAGGED_PEAKS',   color: '#9aa2ac' },
    { name: '冰封山峰',   desc: '浮冰与积雪的极寒之巅',     img: 'screenshots/biomes/frozen-peaks.png',    seed: SEED, biome: 'FROZEN_PEAKS',   color: '#bcd8ee' },
    { name: '石峰',       desc: '裸岩嶙峋的干旱高峰',       img: 'screenshots/biomes/stony-peaks.png',     seed: SEED, biome: 'STONY_PEAKS',    color: '#8d8578' },
    { name: '恶地',       desc: '红沙顶与陶瓦层理条纹',     img: 'screenshots/biomes/badlands.png',        seed: SEED, biome: 'BADLANDS',       color: '#c67f51' },
    { name: '海滩',       desc: '碧海金沙的水岸线',         img: 'screenshots/biomes/beach.png',           seed: SEED, biome: 'BEACH',          color: '#e0d6a8' },
    { name: '石岸',       desc: '乱石嶙峋的海岸',           img: 'screenshots/biomes/stony-shore.png',     seed: SEED, biome: 'STONY_SHORE',    color: '#8a8f93' },
    { name: '海洋',       desc: '广阔的蔚蓝水域与海床',     img: 'screenshots/biomes/ocean.png',           seed: SEED, biome: 'OCEAN',          color: '#3d6fb8' }
  ];

  function show() {
    var f = document.getElementById('overlay-featured');
    var s = document.getElementById('overlay-start');
    if (s) s.classList.add('hidden');
    if (f) f.classList.remove('hidden');
  }

  function hide() {
    var f = document.getElementById('overlay-featured');
    var s = document.getElementById('overlay-start');
    if (f) f.classList.add('hidden');
    if (s) s.classList.remove('hidden');
  }

  // 缩略图：加载失败时替换为群系色块，卡片仍可点击
  function makeThumb(w) {
    var wrap = document.createElement('div');
    wrap.className = 'featured-thumb';
    var img = document.createElement('img');
    img.src = w.img;
    img.alt = w.name;
    img.onerror = function () {
      wrap.removeChild(img);
      var ph = document.createElement('div');
      ph.className = 'featured-ph';
      ph.style.background = w.color;
      wrap.appendChild(ph);
    };
    wrap.appendChild(img);
    return wrap;
  }

  function build() {
    var grid = document.getElementById('featured-grid');
    if (grid && !grid.childNodes.length) {
      WORLDS.forEach(function (w, i) {
        var card = document.createElement('div');
        card.className = 'featured-card';
        card.appendChild(makeThumb(w));
        var name = document.createElement('div');
        name.className = 'featured-name';
        name.textContent = w.name;
        card.appendChild(name);
        var desc = document.createElement('div');
        desc.className = 'featured-desc';
        desc.textContent = w.desc;
        card.appendChild(desc);
        card.addEventListener('click', function () {
          if (Voxel.Game && Voxel.Game.startFeatured) Voxel.Game.startFeatured(i);
        });
        grid.appendChild(card);
      });
    }
    var btn = document.getElementById('btn-featured');
    if (btn) btn.addEventListener('click', show);
    var back = document.getElementById('btn-featured-back');
    if (back) back.addEventListener('click', hide);
  }

  build();

  return { WORLDS: WORLDS, show: show, hide: hide };
})();
