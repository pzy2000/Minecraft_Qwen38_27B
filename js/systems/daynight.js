// 昼夜循环：天空颜色、光照色调、太阳/月亮/星星
window.Voxel = window.Voxel || {};

Voxel.DayNight = (function () {
  var time = 0.3;
  var sun, moon, stars;
  var skyColor = new THREE.Color(0x87ceeb);
  var tint = new THREE.Color(1, 1, 1);
  var sunlight = 1;
  var C_DAY = new THREE.Color(0x87ceeb);
  var C_NIGHT = new THREE.Color(0x0b1026);
  var C_DUSK = new THREE.Color(0xff9a5a);

  function smoothstep(a, b, x) {
    var t = (x - a) / (b - a);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }

  function init(scene) {
    sun = new THREE.Mesh(
      new THREE.PlaneGeometry(54, 54),
      new THREE.MeshBasicMaterial({ color: 0xffdd77, fog: false, transparent: true })
    );
    moon = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 34),
      new THREE.MeshBasicMaterial({ color: 0xdde4ff, fog: false, transparent: true })
    );
    var starPos = [];
    for (var i = 0; i < 380; i++) {
      var a = Math.random() * Math.PI * 2;
      var e = 0.05 + Math.random() * Math.PI * 0.45;
      starPos.push(
        Math.cos(a) * Math.cos(e) * 470,
        Math.sin(e) * 470,
        Math.sin(a) * Math.cos(e) * 470
      );
    }
    var sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    stars = new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xffffff, size: 1.7, transparent: true, opacity: 0, fog: false
    }));
    scene.add(sun);
    scene.add(moon);
    scene.add(stars);
    update(0);
  }

  function update(dt) {
    time = (time + dt / Voxel.Config.DAY_LENGTH) % 1;
    var el = Math.sin(time * Math.PI * 2); // t=0 日出 .25 正午 .5 日落 .75 午夜
    sunlight = smoothstep(-0.12, 0.25, el);

    skyColor.copy(C_NIGHT).lerp(C_DAY, sunlight);
    var dusk = Math.max(0, 1 - Math.abs(el) / 0.35);
    skyColor.lerp(C_DUSK, dusk * 0.45 * (0.25 + 0.75 * sunlight));

    tint.setRGB(
      0.30 + 0.70 * sunlight,
      0.34 + 0.66 * sunlight,
      0.48 + 0.52 * sunlight
    );

    var ang = time * Math.PI * 2;
    sun.position.set(Math.cos(ang) * 480, Math.sin(ang) * 480, 140);
    moon.position.set(-Math.cos(ang) * 480, -Math.sin(ang) * 480, -140);
    sun.lookAt(0, 0, 0);
    moon.lookAt(0, 0, 0);
    sun.visible = el > -0.12;
    moon.visible = el < 0.12;
    stars.material.opacity = Math.pow(1 - sunlight, 2) * 0.9;
  }

  return {
    init: init,
    update: update,
    time: function () { return time; },
    setTime: function (t) { time = ((t % 1) + 1) % 1; },
    isNight: function () { return sunlight < 0.4; },
    sunlight: function () { return sunlight; },
    getTint: function () { return tint; },
    getSky: function () { return skyColor; }
  };
})();
