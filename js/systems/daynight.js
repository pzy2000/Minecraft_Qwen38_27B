// 昼夜循环：渐变天空穹顶、光照色调、太阳/月亮/星星
window.Voxel = window.Voxel || {};

Voxel.DayNight = (function () {
  var time = 0.3;
  var sun, moon, stars, domeMat, dome;
  var camY = 0;
  var skyColor = new THREE.Color(0xbfe3f2);
  var tint = new THREE.Color(1, 1, 1);
  var sunlight = 1;
  var DOME_R = 700;
  // 天空关键色：白天 / 黄昏 / 夜晚（穹顶顶部与地平线）
  var C_TOP_DAY = new THREE.Color(0x5aa0e0);
  var C_TOP_DUSK = new THREE.Color(0x53386e);
  var C_TOP_NIGHT = new THREE.Color(0x04060f);
  var C_HOR_DAY = new THREE.Color(0xbfe3f2);
  var C_HOR_DUSK = new THREE.Color(0xff7a3c);
  var C_HOR_NIGHT = new THREE.Color(0x0b1026);
  var C_SUN_DAY = new THREE.Color(0xffdd77);
  var C_SUN_DUSK = new THREE.Color(0xff4e1f);
  var topC = new THREE.Color(), horC = new THREE.Color();

  function smoothstep(a, b, x) {
    var t = (x - a) / (b - a);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }

  function init(scene) {
    // 渐变天空穹顶：顶部色→地平线色，随时间切换（雾色与背景色取地平线色）
    domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x5aa0e0) },
        horizonColor: { value: new THREE.Color(0xbfe3f2) },
        exponent: { value: 0.72 },
        radius: { value: DOME_R },
        uCamY: { value: 0 }
      },
      vertexShader:
        'uniform float radius;' +
        'uniform float uCamY;' +
        'varying float vH;' +
        'void main() {' +
        '  vec4 wp = modelMatrix * vec4(position, 1.0);' +
        '  vH = wp.y - uCamY;' +
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);' +
        '}',
      fragmentShader:
        'uniform vec3 topColor;' +
        'uniform vec3 horizonColor;' +
        'uniform float exponent;' +
        'uniform float radius;' +
        'varying float vH;' +
        'void main() {' +
        '  float h = clamp(vH / radius, 0.0, 1.0);' +
        '  gl_FragColor = vec4(mix(horizonColor, topColor, pow(h, exponent)), 1.0);' +
        '}'
    });
    dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 24, 14), domeMat);
    dome.renderOrder = -10;
    scene.add(dome);
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
    var dusk = Math.max(0, 1 - Math.abs(el) / 0.5); // 日出/日落窗口

    // 穹顶配色：昼/夜基底，黄昏叠加深橙地平线 + 紫色天顶
    topC.copy(C_TOP_NIGHT).lerp(C_TOP_DAY, sunlight);
    horC.copy(C_HOR_NIGHT).lerp(C_HOR_DAY, sunlight);
    topC.lerp(C_TOP_DUSK, dusk * 0.75);
    horC.lerp(C_HOR_DUSK, dusk * 0.9 * (0.25 + 0.75 * sunlight));
    domeMat.uniforms.topColor.value.copy(topC);
    domeMat.uniforms.horizonColor.value.copy(horC);
    skyColor.copy(horC);

    tint.setRGB(
      0.30 + 0.70 * sunlight,
      0.34 + 0.66 * sunlight,
      0.48 + 0.52 * sunlight
    );
    if (dusk > 0) { tint.r += dusk * 0.10; tint.g += dusk * 0.03; } // 黄昏暖光

    var ang = time * Math.PI * 2;
    sun.visible = el > -0.12;
    moon.visible = el < 0.12;
    // 太阳接近地平线时染成红橙色
    var sd = Math.max(0, 1 - Math.abs(el - 0.1) / 0.35);
    sun.material.color.copy(C_SUN_DAY).lerp(C_SUN_DUSK, sd * 0.85);
    stars.material.opacity = Math.pow(1 - sunlight, 2) * 0.9;
    updateCamera(lastCam);
  }

  // 天空体每帧跟随相机（否则地图边缘玩时天空明显偏移）
  var lastCam = { x: 128, y: 30, z: 128 };
  function updateCamera(p) {
    if (!p || !dome) return;
    lastCam.x = p.x; lastCam.y = p.y; lastCam.z = p.z;
    dome.position.set(p.x, p.y, p.z);
    stars.position.set(p.x, p.y, p.z);
    domeMat.uniforms.uCamY.value = p.y;
    var ang = time * Math.PI * 2;
    sun.position.set(p.x + Math.cos(ang) * 480, Math.sin(ang) * 480, p.z + 140);
    moon.position.set(p.x - Math.cos(ang) * 480, -Math.sin(ang) * 480, p.z - 140);
    sun.lookAt(p.x, p.y, p.z);
    moon.lookAt(p.x, p.y, p.z);
  }

  return {
    init: init,
    update: update,
    updateCamera: updateCamera,
    time: function () { return time; },
    setTime: function (t) { time = ((t % 1) + 1) % 1; },
    isNight: function () { return sunlight < 0.4; },
    sunlight: function () { return sunlight; },
    getTint: function () { return tint; },
    getSky: function () { return skyColor; },
    // 穹顶当前配色（供天气系统混合后写回）
    topColor: function () { return topC; },
    horizonColor: function () { return horC; },
    applySky: function (top, hor) {
      domeMat.uniforms.topColor.value.copy(top);
      domeMat.uniforms.horizonColor.value.copy(hor);
      skyColor.copy(hor);
    }
  };
})();
