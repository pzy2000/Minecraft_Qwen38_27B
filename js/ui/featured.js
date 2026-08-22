// 精选世界：主菜单九宫格推荐世界
// 种子与 README 生物群系截图一致（含全部 8 种群系），进入后自动传送到对应群系
window.Voxel = window.Voxel || {};

Voxel.Featured = (function () {
  var SEED = 3585153365;   // 与 test/capture_biomes.js 相同：含全部 8 种群系的种子

  var WORLDS = [
    { name: '平原',       desc: '草地丘陵、橡树与羊群',         img: 'screenshots/biomes/plains.png',     seed: SEED, biome: 'PLAINS' },
    { name: '森林',       desc: '密集橡树林',                   img: 'screenshots/biomes/forest.png',     seed: SEED, biome: 'FOREST' },
    { name: '沙漠',       desc: '沙丘、仙人掌与砂岩层',         img: 'screenshots/biomes/desert.png',     seed: SEED, biome: 'DESERT' },
    { name: '雪原',       desc: '积雪地表与云杉',               img: 'screenshots/biomes/snowy.png',      seed: SEED, biome: 'SNOWY' },
    { name: '针叶林',     desc: '成片云杉林',                   img: 'screenshots/biomes/taiga.png',      seed: SEED, biome: 'TAIGA' },
    { name: '原始针叶林', desc: '灰化土与巨型云杉',             img: 'screenshots/biomes/mega-taiga.png', seed: SEED, biome: 'MEGA_TAIGA' },
    { name: '丛林',       desc: '高耸入云的巨型丛林树',         img: 'screenshots/biomes/jungle.png',     seed: SEED, biome: 'JUNGLE' },
    { name: '山地',       desc: '石质山峰与裸露岩壁',           img: 'screenshots/biomes/mountains.png',  seed: SEED, biome: 'MOUNTAINS' },
    { name: '全景俯瞰',   desc: '多种群系自然过渡交界',         img: 'screenshots/biomes/overview.png',   seed: SEED, overview: true }
  ];

  function build() {
    var grid = document.getElementById('featured-grid');
    if (!grid) return;
    WORLDS.forEach(function (w, i) {
      var card = document.createElement('div');
      card.className = 'featured-card';
      var img = document.createElement('img');
      img.src = w.img;
      img.alt = w.name;
      var name = document.createElement('div');
      name.className = 'featured-name';
      name.textContent = w.name;
      var desc = document.createElement('div');
      desc.className = 'featured-desc';
      desc.textContent = w.desc;
      card.appendChild(img);
      card.appendChild(name);
      card.appendChild(desc);
      card.addEventListener('click', function () {
        if (Voxel.Game && Voxel.Game.startFeatured) Voxel.Game.startFeatured(i);
      });
      grid.appendChild(card);
    });
    var back = document.getElementById('btn-featured-back');
    if (back) back.addEventListener('click', function () {
      document.getElementById('overlay-featured').classList.add('hidden');
      document.getElementById('overlay-start').classList.remove('hidden');
    });
  }

  build();

  return { WORLDS: WORLDS };
})();
