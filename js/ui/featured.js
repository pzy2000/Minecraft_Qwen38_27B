// 精选世界：主菜单九宫格推荐世界
// 种子与 README 生物群系截图一致（含全部 8 种群系），进入后自动传送到对应群系
// 本模块自成一体：弹窗开关不依赖 main.js，图片缺失时以群系色块兜底
window.Voxel = window.Voxel || {};

Voxel.Featured = (function () {
  var SEED = 3585153365;   // 与 test/capture_biomes.js 相同：含全部 8 种群系的种子

  var WORLDS = [
    { name: '平原',       desc: '草地丘陵、橡树与羊群',   img: 'screenshots/biomes/plains.png',     seed: SEED, biome: 'PLAINS',      color: '#6fa14e' },
    { name: '森林',       desc: '密集橡树林',             img: 'screenshots/biomes/forest.png',     seed: SEED, biome: 'FOREST',      color: '#4e7a34' },
    { name: '沙漠',       desc: '沙丘、仙人掌与砂岩层',   img: 'screenshots/biomes/desert.png',     seed: SEED, biome: 'DESERT',      color: '#d9c27e' },
    { name: '雪原',       desc: '积雪地表与云杉',         img: 'screenshots/biomes/snowy.png',      seed: SEED, biome: 'SNOWY',       color: '#cfd8de' },
    { name: '针叶林',     desc: '成片云杉林',             img: 'screenshots/biomes/taiga.png',      seed: SEED, biome: 'TAIGA',       color: '#3f6b52' },
    { name: '原始针叶林', desc: '灰化土与巨型云杉',       img: 'screenshots/biomes/mega-taiga.png', seed: SEED, biome: 'MEGA_TAIGA',  color: '#6b543c' },
    { name: '丛林',       desc: '高耸入云的巨型丛林树',   img: 'screenshots/biomes/jungle.png',     seed: SEED, biome: 'JUNGLE',      color: '#2f7a3d' },
    { name: '山地',       desc: '石质山峰与裸露岩壁',     img: 'screenshots/biomes/mountains.png',  seed: SEED, biome: 'MOUNTAINS',   color: '#8d8d95' },
    { name: '全景俯瞰',   desc: '多种群系自然过渡交界',   img: 'screenshots/biomes/overview.png',   seed: SEED, overview: true,       color: '#5b7f6e' }
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
