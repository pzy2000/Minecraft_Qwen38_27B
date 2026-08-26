// 实时树叶阴影系统：
//   · 正交深度 pre-pass —— 只渲染「树叶」几何组（与主视图共享 BufferGeometry，
//     且引用同一份风摇位移 GLSL），所以影子天然跟着叶子一起晃、跟着太阳全天扫动；
//   · 深度以 RGBA 三通道打包写入普通渲染目标（WebGL1 兼容，不依赖 depth texture 扩展）；
//   · 强度随昼夜曲线淡入淡出，雨天大幅衰减，空间站/无恒星世界自动关闭；
//   · 纹素网格对齐消除移动时的阴影闪烁。
window.Voxel = window.Voxel || {};

Voxel.Shadow = (function () {
  var scene = null, cam = null, mat = null;
  var rt = null;
  var casters = [];        // 主场景中的树叶 Mesh 列表
  var level = 0;           // 0=关 1=中 2=高（对应设置项 shadows）
  var RT_SIZE = [0, 768, 1536];
  var RANGE = 46;          // 阴影盒半径（格）
  var DIST = 110;          // 相机沿太阳反方向后撤距离
  var NEAR = 30, FAR = 210;

  var shadowMat4 = new THREE.Matrix4();
  var lightM = new THREE.Matrix4(), lightInv = new THREE.Matrix4();
  var BIAS = new THREE.Matrix4().set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1
  );
  var IDENTITY = new THREE.Matrix4();
  var sunDir = new THREE.Vector3(0.4, 0.85, 0.3);
  var centerV = new THREE.Vector3();
  var clipV = new THREE.Vector3();
  var prevClearC = new THREE.Color();

  // 深度 pass 材质：顶点位移必须与主视图完全一致
  var DEPTH_VERT = [
    'attribute vec3 anrm;',
    'uniform float uTime;',
    'uniform vec2 uWind;',
    'uniform float uSwayAmp;',
    '__SWAY__',
    'void main(){',
    '  vec3 p = position;',
    '  p += voxelSway(p, uTime, uWind, uSwayAmp);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '}'
  ].join('\n');

  var DEPTH_FRAG = [
    'vec4 packDepth(float v){',
    '  vec4 enc = vec4(1.0, 255.0, 65025.0, 16581375.0) * v;',
    '  enc = fract(enc);',
    '  enc -= enc.yzww * vec4(1.0/255.0, 1.0/255.0, 1.0/255.0, 0.0);',
    '  return enc;',
    '}',
    'void main(){',
    '  gl_FragColor = packDepth(gl_FragCoord.z);',
    '}'
  ].join('\n');

  function ensureScene() {
    if (scene) return;
    scene = new THREE.Scene();
    cam = new THREE.OrthographicCamera(-RANGE, RANGE, RANGE, -RANGE, NEAR, FAR);
    mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2(1, 0) },
        uSwayAmp: { value: 0.03 }
      },
      vertexShader: DEPTH_VERT.replace('__SWAY__', Voxel.MeshBuilder.swayGLSL),
      fragmentShader: DEPTH_FRAG,
      side: THREE.FrontSide
    });
  }

  function ensureRT(size) {
    if (rt && rt.width === size) return true;
    if (rt) { rt.dispose(); rt = null; }
    try {
      rt = new THREE.WebGLRenderTarget(size, size, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        format: THREE.RGBAFormat,
        depthBuffer: true,
        stencilBuffer: false
      });
    } catch (e) { rt = null; return false; }
    return true;
  }

  function setLevel(lv) {
    lv = Math.max(0, Math.min(2, Math.floor(lv || 0)));
    level = lv;
    if (lv <= 0) {
      Voxel.MeshBuilder.setLeafShadow(null, IDENTITY, 0, 1024);
      return;
    }
    ensureScene();
    ensureRT(RT_SIZE[lv]);
  }

  function addCaster(mesh) {
    if (!mesh || !mesh.geometry || mesh.__shadowGhost) return;
    ensureScene();
    var ghost = new THREE.Mesh(mesh.geometry, mat);
    ghost.frustumCulled = true; // 共享几何的包围球 + 阴影视锥剔除，控制深度 pass 开销
    scene.add(ghost);
    mesh.__shadowGhost = ghost;
    casters.push(mesh);
  }

  function removeCaster(mesh) {
    var i = casters.indexOf(mesh);
    if (i < 0) return;
    casters.splice(i, 1);
    if (mesh.__shadowGhost) {
      scene.remove(mesh.__shadowGhost);
      mesh.__shadowGhost = null;
    }
  }

  function clearCasters() {
    for (var i = 0; i < casters.length; i++) {
      var m = casters[i];
      if (m.__shadowGhost) scene.remove(m.__shadowGhost);
      m.__shadowGhost = null;
    }
    casters.length = 0;
  }

  function casterCount() { return casters.length; }

  // 每帧调用：计算太阳方向/强度 → 深度 pass → 把参数写回地形材质
  var lastRenderer = null;
  function update(renderer, px, py, pz) {
    lastRenderer = renderer;
    var MB = Voxel.MeshBuilder;
    var size = RT_SIZE[level] || 0;
    var str = 0;

    if (level > 0 && rt && casterCount() > 0 &&
        Voxel.Atmosphere && Voxel.DayNight && Voxel.Atmosphere.sunDirection &&
        Voxel.Atmosphere.sunDirection(sunDir, Voxel.DayNight.time())) {
      var daylight = Voxel.DayNight.sunlight();
      var rain = (Voxel.Weather && Voxel.Weather.rainFactor) ? Voxel.Weather.rainFactor() : 0;
      str = Math.pow(daylight, 0.75) * (1 - rain * 0.88) * (level === 1 ? 0.92 : 1);
    }

    if (str < 0.02) {
      MB.setLeafShadow(rt ? rt.texture : null, shadowMat4.identity(), 0, size || 1024);
      return;
    }

    // 太阳过低时阴影拉出阴影盒，效果变差且易出伪影——按仰角平滑衰减
    var elevK = Math.min(1, Math.max(0, (sunDir.y - 0.08) / 0.22));
    str *= elevK;
    if (str < 0.02) {
      MB.setLeafShadow(rt.texture, shadowMat4.identity(), 0, size);
      return;
    }

    centerV.set(px, py, pz);
    // 相机放在「太阳侧」沿光路看向玩家：深度随远离太阳递增，
    // 树冠（离光近）才会正确遮挡其下方地面（离光远）
    cam.position.copy(centerV).addScaledVector(sunDir, DIST);
    cam.up.set(0, 1, 0);
    if (Math.abs(sunDir.y) > 0.985) cam.up.set(1, 0, 0); // 接近天顶时避免退化
    cam.lookAt(centerV);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();

    // 纹素对齐：把中心点在光空间坐标吸附到纹素网格，消除相机平移引起的边缘闪烁
    lightM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    clipV.copy(centerV).applyMatrix4(lightM);
    var texel = (2 * RANGE) / size;
    clipV.x = Math.round(clipV.x / texel) * texel;
    clipV.y = Math.round(clipV.y / texel) * texel;
    if (lightInv.copy(lightM).invert()) {
      centerV.copy(clipV.applyMatrix4(lightInv));
      cam.position.copy(centerV).addScaledVector(sunDir, DIST);
      cam.up.set(0, 1, 0);
      if (Math.abs(sunDir.y) > 0.985) cam.up.set(1, 0, 0);
      cam.lookAt(centerV);
      cam.updateMatrixWorld(true);
      lightM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    }

    // 深度 pass
    var prevRT = renderer.getRenderTarget();
    renderer.getClearColor(prevClearC);
    var prevClearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0xffffff, 1); // 打包深度 1.0 ≈ 全通亮（无遮挡）
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevClearC, prevClearAlpha);

    shadowMat4.copy(BIAS).multiply(lightM);
    MB.setLeafShadow(rt.texture, shadowMat4, str, size);
  }

  // 与主视图同步的风摇参数（main.js 在调 MeshBuilder.setWind 后转调此函数）
  function syncWind(time, wx, wz, amp) {
    if (!mat) return;
    mat.uniforms.uTime.value = time;
    mat.uniforms.uWind.value.set(wx, wz);
    mat.uniforms.uSwayAmp.value = amp;
  }

  function dispose() {
    clearCasters();
    if (rt) { rt.dispose(); rt = null; }
    scene = null; cam = null; mat = null;
    Voxel.MeshBuilder.setLeafShadow(null, IDENTITY, 0, 1024);
  }

  return {
    setLevel: setLevel,
    level: function () { return level; },
    addCaster: addCaster,
    removeCaster: removeCaster,
    clearCasters: clearCasters,
    casterCount: casterCount,
    update: update,
    syncWind: syncWind,
    dispose: dispose,
    // 调试：读取深度图统计（非白像素 = 遮挡物轮廓）
    _debugRead: function () {
      if (!rt || !lastRenderer) return null;
      var size = rt.width;
      var buf = new Uint8Array(size * size * 4);
      lastRenderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
      var occ = 0;
      for (var i = 0; i < buf.length; i += 4) {
        if (buf[i] < 250 || buf[i + 1] < 250) occ++;
      }
      return { size: size, occluderPixels: occ, total: size * size };
    },
    _debugRT: function () { return rt; }
  };
})();
