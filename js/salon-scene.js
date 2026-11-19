// Diana's Salon — 大师级 3D 卡牌物理动效引擎
// 升级特性：二阶速度保持弹簧（Velocity-Preserving 3D Spring）、气动随速侧倾（Aerodynamic Banking）、
// 荷官级错峰瀑布展牌（Ribbon Spread Stagger）、单牌局部磁吸 3D 跟随倾斜、空中翻牌星尾 + 落桌金波涟漪、3D 近景把玩检视

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { DIANA_CRYSTAL_WHISPERS, LENORMAND_CARDS, SPREAD_CONFIGS } from './cards-data.js';
import {
  createCardBackTextures,
  createRosewoodTexture,
  createVelvetTableTextures,
  cardFaceUrl,
  loadDeckAtlas,
  enableCardTextures
} from './card-art.js';

const CARD_W = 1.00;
const CARD_H = 1.48;
const INSPECT_DISTANCE = 2.55;
const TOUCH_TAP_SLOP = 8;
const INSPECT_DRAG_RANGE = 104;

const FLAME_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  varying float vHeight;

  void main() {
    vec3 pos = position;
    float h = clamp((pos.y + 0.14) / 0.34, 0.0, 1.0);
    vHeight = h;
    float taper = sin(h * 3.1415926) * (1.0 - 0.52 * h);
    pos.x *= taper * 1.15;
    pos.z *= taper * 1.15;
    pos.x += sin(uTime * 4.8 + uSeed * 6.2 + h * 3.2) * 0.022 * h * h;
    pos.z += cos(uTime * 3.9 + uSeed) * 0.012 * h * h;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FLAME_FRAGMENT = /* glsl */ `
  varying float vHeight;
  void main() {
    vec3 blueBase = vec3(0.26, 0.42, 0.98);
    vec3 coreWhite = vec3(1.0, 0.98, 0.88);
    vec3 warmGold = vec3(1.0, 0.64, 0.24);
    vec3 tipRose = vec3(0.90, 0.30, 0.18);
    vec3 col = mix(blueBase, coreWhite, smoothstep(0.0, 0.28, vHeight));
    col = mix(col, warmGold, smoothstep(0.28, 0.72, vHeight));
    col = mix(col, tipRose, smoothstep(0.72, 1.0, vHeight));
    float alpha = smoothstep(0.0, 0.14, vHeight) * (1.0 - smoothstep(0.78, 1.0, vHeight));
    gl_FragColor = vec4(col * 1.68, alpha * 0.94);
  }
`;

const LASER_HOLO_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vUv = uv;
    mat4 world = modelMatrix;
    #ifdef USE_INSTANCING
      world = modelMatrix * instanceMatrix;
    #endif
    vec4 wp = world * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(world) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const LASER_HOLO_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uFoilMap;
  uniform vec4 uArtRect;
  uniform vec4 uFoilRect;
  uniform vec2 uPointer;
  uniform vec2 uCardTilt;
  uniform float uTime;
  uniform float uHoloBoost;
  uniform float uFlipV;
  uniform float uIsFront;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  vec3 laserSpectrum(float t) {
    vec3 a = vec3(0.68, 0.60, 0.70);
    vec3 b = vec3(0.38, 0.36, 0.42);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.02, 0.35, 0.68);
    return a + b * cos(6.28318 * (c * t + d));
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  vec3 colorDodge(vec3 base, vec3 blend) {
    return min(vec3(1.0), base / max(vec3(0.06), 1.0 - blend * 0.82));
  }

  float livingFireflies(vec2 uv, float t, float scale, float speed) {
    vec2 p = uv * vec2(scale, scale * 1.4);
    p.y += t * speed;
    vec2 cell = floor(p);
    vec2 gv = fract(p) - 0.5;
    float rnd = hash21(cell);
    if (rnd < 0.72) return 0.0;
    vec2 wobble = vec2(sin(t * 2.4 + rnd * 19.0) * 0.22, cos(t * 1.9 + rnd * 13.0) * 0.18);
    float d = length(gv - wobble);
    float pulse = 0.55 + 0.45 * sin(t * 3.8 + rnd * 25.0);
    return (1.0 - smoothstep(0.01, 0.16, d)) * pulse;
  }

  vec4 foilAt(vec2 uv) {
    return texture2D(uFoilMap, uFoilRect.xy + uv * uFoilRect.zw);
  }

  vec3 artAt(vec2 uv) {
    return texture2D(uMap, uArtRect.xy + uv * uArtRect.zw).rgb;
  }

  void main() {
    vec2 baseUv = vec2(vUv.x, uFlipV > 0.5 ? (1.0 - vUv.y) : vUv.y);
    vec4 maskSample = foilAt(baseUv);
    float frameMask = maskSample.g;

    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 N = normalize(vWorldNormal);
    float fresnel = pow(1.0 - abs(dot(V, N)), 1.5);

    // 融合真实单牌局部倾角 uCardTilt 与视角 V，使单张牌摆动时视差与镭射扫光精确跟随牌体本身！
    vec2 parallax = vec2(
      V.x * 0.42 + uPointer.x * 0.36 + uCardTilt.x * 1.35,
      -V.z * 0.34 + uPointer.y * 0.30 + uCardTilt.y * 1.35
    );

    vec3 artCol;
    float foilMask = maskSample.r;

    if (uIsFront > 0.5 && frameMask < 0.45) {
      float h0 = maskSample.b;
      vec2 offset1 = parallax * (h0 - 0.68) * 0.068;
      vec2 uv1 = clamp(baseUv + offset1, vec2(0.095, 0.065), vec2(0.905, 0.775));
      float h1 = foilAt(uv1).b;
      vec2 finalArtUv = clamp(baseUv + parallax * (h1 - 0.68) * 0.078, vec2(0.095, 0.065), vec2(0.905, 0.775));

      float hitFrame = foilAt(finalArtUv).g;
      finalArtUv = mix(finalArtUv, baseUv, step(0.45, hitFrame));

      artCol = artAt(finalArtUv);
      foilMask = foilAt(finalArtUv).r;

      vec2 shadowProbeUv = clamp(baseUv - parallax * 0.036, vec2(0.01), vec2(0.99));
      float castByFrame = foilAt(shadowProbeUv).g;
      artCol *= mix(1.0, 0.54, castByFrame * 0.86);

      float lum = dot(artCol, vec3(0.299, 0.587, 0.114));
      float breath = 0.5 + 0.5 * sin(uTime * 2.3 + baseUv.y * 4.0);
      artCol += artCol * smoothstep(0.48, 0.92, lum) * (0.10 + breath * 0.17);

      vec2 relC = (baseUv - vec2(0.5, 0.45)) * vec2(1.0, 1.5);
      float rad = length(relC);
      float ang = atan(relC.y, relC.x) + uTime * 0.24;
      float ringGlow = (1.0 - smoothstep(0.0, 0.021, abs(rad - 0.31))) * (0.5 + 0.5 * sin(ang * 12.0));
      artCol += vec3(1.0, 0.84, 0.55) * ringGlow * 0.24;

      float flyDeep = livingFireflies(baseUv - parallax * 0.028, uTime, 11.0, -0.11);
      float flyNear = livingFireflies(baseUv + parallax * 0.018 + 0.37, uTime, 7.5, -0.16);
      artCol += vec3(1.0, 0.88, 0.62) * flyDeep * 0.56;
      artCol += vec3(1.0, 0.95, 0.82) * flyNear * 0.80;
    } else {
      artCol = artAt(baseUv);
    }

    float angleShift = (V.x - V.z) * 2.2 + uPointer.x * 1.2 + uPointer.y * 1.0 + (uCardTilt.x - uCardTilt.y) * 3.8;
    float bandPhase = dot(baseUv, vec2(1.85, 1.35)) * 1.65 + angleShift + uTime * 0.15;
    vec3 rainbow1 = laserSpectrum(bandPhase);
    vec3 rainbow2 = laserSpectrum(bandPhase * 1.6 - baseUv.y * 1.8 + 0.28);
    float silkWave = 0.58 + 0.42 * sin((baseUv.x * 4.2 + baseUv.y * 3.1 + angleShift * 1.6) * 6.2831);
    float stripePhase = (baseUv.x + baseUv.y) * 180.0 + angleShift * 10.0;
    float stripeStrength = 1.0 - smoothstep(1.1, 3.0, fwidth(stripePhase));
    float fineLines = 0.90 + 0.10 * stripeStrength * sin(stripePhase);

    vec2 gridUv = baseUv * vec2(44.0, 66.0);
    vec2 cell = floor(gridUv);
    vec2 gv = fract(gridUv) - 0.5;
    float cellSeed = hash21(cell);
    float pinDot = (1.0 - smoothstep(0.02, 0.27, length(gv)));
    float twinkle = pow(max(0.0, sin(angleShift * 2.2 + cellSeed * 31.4 + uTime * 1.2)), 5.0);
    vec3 glitterCol = laserSpectrum(cellSeed + angleShift * 0.4) * pinDot * twinkle * (0.42 - frameMask * 0.25);

    float glareCoord = (baseUv.x * 0.80 + baseUv.y * 0.60) - (0.52 + uPointer.x * 0.32 + uCardTilt.x * 1.2 + V.x * 0.28);
    float glare = exp(-glareCoord * glareCoord * 16.0) * (0.42 + uHoloBoost * 0.28);

    float readability = uIsFront > 0.5 ? mix(0.82, 0.30, frameMask) : 0.85;
    float holoWeight = (0.20 + foilMask * 0.78) * (0.55 + fresnel * 0.62 + uHoloBoost * 0.34) * readability;
    vec3 holoLayer = mix(rainbow1, rainbow2, 0.42) * silkWave * fineLines * holoWeight * 0.58;

    vec3 baseLit = artCol * 1.06;
    vec3 dodged = colorDodge(baseLit, holoLayer);
    vec3 finalCol = mix(baseLit, dodged, clamp(holoWeight * 0.74, 0.0, 0.88));
    finalCol += glitterCol * (0.55 + uHoloBoost * 0.68);
    finalCol += vec3(1.0, 0.97, 0.92) * glare * (0.22 + foilMask * 0.28) * readability;

    gl_FragColor = vec4(finalCol, 1.0);
    #include <colorspace_fragment>
  }
`;

// 三阶段电影级抽牌曲线：迅速弹起蓄势 -> 空中丝滑巡航 -> 柔缓落定丝绒桌面
function cardFlightProgressCurve(t) {
  return t * t * t * (t * (6 * t - 15) + 10);
}

// 空中翻面 S 鞭甩曲线：在最高点附近干脆利落完成 180° 翻转，金边掠过聚光灯
function whipFlipCurve(t) {
  const x = THREE.MathUtils.clamp((t - 0.16) / 0.64, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

// 二阶阻尼弹簧单步积分（保留实时速度，随时打断零折角！）
function stepSpringScalar(current, target, velocity, dt, omega = 17.5, zeta = 0.84) {
  const disp = current - target;
  const accel = -omega * omega * disp - 2 * zeta * omega * velocity;
  const nextVel = velocity + accel * dt;
  const nextVal = current + nextVel * dt;
  return [nextVal, nextVel];
}

export class SalonScene {
  static loadDeck() {
    enableCardTextures(THREE);
    return loadDeckAtlas(new THREE.TextureLoader());
  }

  constructor(canvas, soundAtelier, callbacks = {}, deck) {
    this.canvas = canvas;
    this.sound = soundAtelier;
    this.callbacks = callbacks;
    this.deckTextures = deck;
    this.inspectionVersion = 0;
    this.textureLoader = new THREE.TextureLoader();
    this.coarsePointer = matchMedia('(pointer: coarse)').matches;
    this.modalOpen = false;
    this.frameWindow = null;
    this.lastResolutionDrop = 0;

    this.mode = 'onboarding';
    this.spreadId = 'line3';
    this.motionPaused = false;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.pointer = new THREE.Vector2(0, 0);
    this.smoothPointer = new THREE.Vector2(0, 0);
    this.touchTilt = new THREE.Vector2();
    this.touchGesture = null;
    this.isTouchInput = false;
    this.inspectWorldPos = new THREE.Vector3();
    this.worldCursorOnTable = new THREE.Vector3(0, 0, 0);
    this.tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.05);
    this.raycaster = new THREE.Raycaster();

    this.cards = [];
    this.deckOrder = [];
    this.drawnCards = [];
    this.hoveredCard = null;
    this.inspectedCard = null; // 3D 手持近景把玩检视中的卡牌
    this.focusedCardIndex = -1;
    this.activePairIndices = null;
    this.highlightedSingleSlot = -1;
    this.pendingTimers = [];
    this.round = 0;

    this.slotMeshes = [];
    this.pairThreads = [];
    this.landingRipples = [];
    this.trailSparks = [];
    this.flameUniforms = [];
    this.holoUniformsList = [];
    this.interactiveProps = [];

    this.candleLight = null;
    this.crystalOrb = null;
    this.crystalCore = null;
    this.crystalPulse = 0;
    this.whisperIdx = 0;
    this.dustPoints = null;

    this.clock = new THREE.Clock();
    this.renderFrame = () => this.animate();
    this.elapsed = 0;
    this.shuffleStart = 0;

    this.camTargetPos = new THREE.Vector3(0, 4.45, 4.2);
    this.camPosVel = new THREE.Vector3();
    this.camTargetLook = new THREE.Vector3(0, 0, 0.32);
    this.camCurrentLook = new THREE.Vector3(0, 0, 0.32);
    this.camLookVel = new THREE.Vector3();

    this.initRenderer();
    this.initSceneAndLights();
    this.buildEnvironment();
    this.buildDeckFallbackAndLoadGLB();
    this.cardHitBoxes = this.cards.map((card) => card.hitBox);
    this.updateSpreadSlots();
    this.arrangeOnboardingPair(25, false);
    this.bindEvents();
    this.onResize();

    enableCardTextures();
    this.syncRenderLoop();
  }

  queueTimer(fn, ms) {
    const round = this.round;
    const id = setTimeout(() => {
      if (this.round !== round) return;
      this.pendingTimers = this.pendingTimers.filter((t) => t !== id);
      fn();
    }, ms);
    this.pendingTimers.push(id);
    return id;
  }

  clearPendingTimers() {
    this.round++;
    this.cancelTouchGesture();
    this.pendingTimers.forEach((id) => clearTimeout(id));
    this.pendingTimers = [];
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    const maxPixelRatio = this.coarsePointer ? 1.25 : 1.5;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  initSceneAndLights() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0c0612');
    this.scene.fog = new THREE.FogExp2('#0c0612', 0.042);

    this.camera = new THREE.PerspectiveCamera(
      38,
      window.innerWidth / Math.max(window.innerHeight, 1),
      0.1,
      60
    );
    this.camera.position.copy(this.camTargetPos);

    this.rebuildEnvironmentLight();

    this.scene.add(new THREE.HemisphereLight('#c4ceff', '#2e1226', 0.68));

    this.candleLight = new THREE.PointLight('#ffb066', 10.5, 18, 1.5);
    this.candleLight.position.set(-3.1, 2.45, -1.55);
    this.scene.add(this.candleLight);

    const moonSpot = new THREE.SpotLight('#a8beff', 15, 25, Math.PI * 0.26, 0.65, 1.25);
    moonSpot.position.set(4.8, 7.8, -3.5);
    moonSpot.target.position.set(0, 0, 0.2);
    moonSpot.castShadow = true;
    const shadowSize = this.coarsePointer ? 512 : 768;
    moonSpot.shadow.mapSize.set(shadowSize, shadowSize);
    moonSpot.shadow.camera.near = 1;
    moonSpot.shadow.camera.far = 19;
    moonSpot.shadow.normalBias = 0.012;
    moonSpot.shadow.bias = -0.00025;
    this.scene.add(moonSpot, moonSpot.target);

    const fillLight = new THREE.DirectionalLight('#fff0e4', 0.95);
    fillLight.position.set(0.2, 6.5, 4.4);
    this.scene.add(fillLight);
  }

  rebuildEnvironmentLight() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color('#180c20');

    const addLightOrb = (col, mult, x, y, z, r) => {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(r, 16, 16),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(mult) })
      );
      orb.position.set(x, y, z);
      envScene.add(orb);
    };
    addLightOrb('#ffd296', 2.8, -6, 6, -3, 2.4);
    addLightOrb('#a8c2ff', 2.2, 6, 7, -3, 2.5);
    addLightOrb('#ff9ec4', 1.9, 0, 5, 6, 2.0);
    addLightOrb('#9ef5e8', 1.4, -4, 4, 5, 1.6);

    this.environmentMap?.dispose();
    this.environmentMap = pmrem.fromScene(envScene, 0.035);
    this.scene.environment = this.environmentMap.texture;
    pmrem.dispose();
    envScene.children.forEach((orb) => {
      orb.geometry.dispose();
      orb.material.dispose();
    });
  }

  buildEnvironment() {
    this.tableGroup = new THREE.Group();
    this.scene.add(this.tableGroup);

    const brassMat = new THREE.MeshStandardMaterial({
      color: '#dfc088',
      metalness: 0.92,
      roughness: 0.20
    });
    const rosewoodMat = new THREE.MeshStandardMaterial({
      map: createRosewoodTexture(),
      color: '#2c151b',
      roughness: 0.38,
      metalness: 0.08
    });

    const velvet = createVelvetTableTextures();
    const clothMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(5.1, 5.1, 0.12, 72),
      new THREE.MeshStandardMaterial({
        map: velvet.map,
        bumpMap: velvet.bumpMap,
        bumpScale: 0.014,
        roughness: 0.86,
        metalness: 0.05
      })
    );
    clothMesh.position.y = -0.06;
    clothMesh.receiveShadow = true;
    this.tableGroup.add(clothMesh);

    const rimMesh = new THREE.Mesh(new THREE.CylinderGeometry(5.7, 5.88, 0.26, 12), rosewoodMat);
    rimMesh.position.y = -0.15;
    rimMesh.receiveShadow = true;
    this.tableGroup.add(rimMesh);

    const innerBrassRing = new THREE.Mesh(new THREE.TorusGeometry(5.08, 0.026, 16, 96), brassMat);
    innerBrassRing.rotation.x = Math.PI / 2;
    innerBrassRing.position.y = 0.005;
    this.tableGroup.add(innerBrassRing);

    const candleFlameCoords = [
      { x: -3.38, y: 2.17, z: -1.82, seed: 1.1 },
      { x: -3.88, y: 1.77, z: -1.60, seed: 2.7 },
      { x: -2.88, y: 1.75, z: -2.00, seed: 4.3 }
    ];
    candleFlameCoords.forEach((fc) => {
      const uniforms = { uTime: { value: 0 }, uSeed: { value: fc.seed } };
      this.flameUniforms.push(uniforms);
      const flame = new THREE.Mesh(
        new THREE.SphereGeometry(0.095, 16, 20),
        new THREE.ShaderMaterial({
          uniforms,
          vertexShader: FLAME_VERTEX,
          fragmentShader: FLAME_FRAGMENT,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide
        })
      );
      flame.scale.set(0.76, 1.92, 0.76);
      flame.position.set(fc.x, fc.y + 0.14, fc.z);
      this.tableGroup.add(flame);
    });

    this.buildInteractiveCrystal(brassMat);
    this.buildFloatingDust();

    const loader = new GLTFLoader();
    loader.load('./assets/models/salon_sculptures.glb', (gltf) => {
      gltf.scene.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.name.includes('Cand')) {
            child.userData.propType = 'candelabra';
            this.interactiveProps.push(child);
          }
        }
      });
      this.tableGroup.add(gltf.scene);
    });

    this.slotsGroup = new THREE.Group();
    this.scene.add(this.slotsGroup);

    this.threadsGroup = new THREE.Group();
    this.scene.add(this.threadsGroup);

    // 抽牌飞行星尾与落桌金波涟漪容器
    this.fxGroup = new THREE.Group();
    this.scene.add(this.fxGroup);
  }

  createSoftStarSprite() {
    if (this._starSprite) return this._starSprite;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.28, 'rgba(255, 238, 200, 0.72)');
    g.addColorStop(1, 'rgba(255, 220, 170, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    this._starSprite = new THREE.CanvasTexture(c);
    return this._starSprite;
  }

  // 卡牌落定丝绒桌面时绽放一圈柔和金色星环涟漪
  spawnLandingRipple(x, z) {
    if (this.reducedMotion || this.motionPaused) return;
    const ringGeo = new THREE.RingGeometry(0.38, 0.44, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#ffe3a8',
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(ringGeo, ringMat);
    mesh.position.set(x, 0.012, z);
    this.fxGroup.add(mesh);
    this.landingRipples.push({ mesh, mat: ringMat, age: 0, duration: 0.54 });
  }

  // 抽牌腾空翻转时沿牌角洒出细碎流金彗尾微粒
  spawnFlightSpark(pos) {
    if (this.reducedMotion || this.motionPaused || this.trailSparks.length > 64) return;
    const spriteMat = new THREE.SpriteMaterial({
      map: this.createSoftStarSprite(),
      color: Math.random() > 0.35 ? '#ffe5ae' : '#ffc4dc',
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sp = new THREE.Sprite(spriteMat);
    sp.position.set(
      pos.x + (Math.random() - 0.5) * 0.42,
      pos.y + (Math.random() - 0.5) * 0.14,
      pos.z + (Math.random() - 0.5) * 0.42
    );
    const s = 0.06 + Math.random() * 0.07;
    sp.scale.set(s, s, s);
    this.fxGroup.add(sp);
    this.trailSparks.push({
      sprite: sp,
      mat: spriteMat,
      vy: 0.18 + Math.random() * 0.25,
      age: 0,
      life: 0.42 + Math.random() * 0.22
    });
  }

  buildInteractiveCrystal(brassMat) {
    const group = new THREE.Group();
    group.position.set(3.48, 0, -1.72);

    const crystalMat = new THREE.MeshPhysicalMaterial({
      color: '#fff4fa',
      transmission: 0.93,
      opacity: 1,
      metalness: 0,
      roughness: 0.04,
      ior: 1.56,
      thickness: 1.4,
      attenuationColor: new THREE.Color('#e89ec0'),
      attenuationDistance: 1.8,
      iridescence: 0.85,
      iridescenceIOR: 1.38,
      clearcoat: 1
    });
    this.crystalOrb = new THREE.Mesh(new THREE.SphereGeometry(0.54, 48, 48), crystalMat);
    this.crystalOrb.position.y = 0.74;
    this.crystalOrb.castShadow = true;
    this.crystalOrb.userData.propType = 'crystal';
    group.add(this.crystalOrb);
    this.interactiveProps.push(this.crystalOrb);

    this.crystalCore = new THREE.Group();
    this.crystalCore.position.y = 0.74;
    const starGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(64 * 3);
    for (let i = 0; i < 64; i++) {
      const r = Math.random() * 0.36;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      pos[i * 3 + 2] = r * Math.cos(ph);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.crystalStarsMat = new THREE.PointsMaterial({
      map: this.createSoftStarSprite(),
      color: '#ffe8b8',
      size: 0.068,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.crystalCore.add(new THREE.Points(starGeo, this.crystalStarsMat));
    group.add(this.crystalCore);

    const flacon = new THREE.Group();
    flacon.position.set(-0.78, 0, 0.58);
    flacon.rotation.y = 0.42;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.23, 0.46, 8), crystalMat);
    body.position.y = 0.23;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.13, 16), brassMat);
    neck.position.y = 0.52;
    const stopper = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), crystalMat);
    stopper.position.y = 0.67;
    stopper.scale.set(1, 0.72, 0.65);
    flacon.add(body, neck, stopper);
    group.add(flacon);

    this.tableGroup.add(group);
  }

  buildFloatingDust() {
    const count = 180;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 9.8;
      positions[i * 3 + 1] = 0.18 + Math.random() * 3.9;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 7.8;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dustPoints = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        map: this.createSoftStarSprite(),
        color: '#ffe6b8',
        size: 0.085,
        transparent: true,
        opacity: 0.78,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    this.scene.add(this.dustPoints);
  }

  createHoloShaderMaterial(albedoMap, foilMap, isFront = true) {
    const uniforms = {
      uMap: { value: albedoMap },
      uFoilMap: { value: foilMap },
      uArtRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uFoilRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uCardTilt: { value: new THREE.Vector2(0, 0) },
      uTime: { value: 0 },
      uHoloBoost: { value: 0 },
      uFlipV: { value: 0 },
      uIsFront: { value: isFront ? 1.0 : 0.0 }
    };
    this.holoUniformsList.push(uniforms);
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: LASER_HOLO_VERTEX,
      fragmentShader: LASER_HOLO_FRAGMENT
    });
  }

  createRoundedFallbackCard(frontHoloMat, backHoloMat, goldRimMat) {
    const group = new THREE.Group();
    if (!this.cardRimGeometry) {
      const shape = new THREE.Shape();
      const hw = CARD_W * 0.5;
      const hh = CARD_H * 0.5;
      const r = 0.105;
      shape.moveTo(-hw + r, -hh);
      shape.lineTo(hw - r, -hh);
      shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
      shape.lineTo(hw, hh - r);
      shape.quadraticCurveTo(hw, hh, hw - r, hh);
      shape.lineTo(-hw + r, hh);
      shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
      shape.lineTo(-hw, -hh + r);
      shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);

      this.cardRimGeometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.012,
        bevelEnabled: true,
        bevelThickness: 0.003,
        bevelSize: 0.003,
        bevelSegments: 1,
        curveSegments: 4
      });
      this.cardRimGeometry.rotateX(Math.PI / 2);
      this.cardRimGeometry.translate(0, 0.006, 0);
    }
    const rim = new THREE.Mesh(this.cardRimGeometry, goldRimMat);
    rim.castShadow = false;
    rim.receiveShadow = false;
    group.add(rim);

    const planeGeo = this.cardPlaneGeometry ??= new THREE.PlaneGeometry(CARD_W - 0.04, CARD_H - 0.04);
    const backPlane = new THREE.Mesh(planeGeo, backHoloMat);
    backPlane.rotation.x = -Math.PI / 2;
    backPlane.position.y = 0.0095;
    backPlane.castShadow = true;

    const frontPlane = new THREE.Mesh(planeGeo, frontHoloMat);
    frontPlane.rotation.x = Math.PI / 2;
    frontPlane.rotation.z = Math.PI;
    frontPlane.position.y = -0.0095;
    frontPlane.castShadow = true;

    group.add(backPlane, frontPlane);
    return group;
  }

  buildDeckFallbackAndLoadGLB() {
    this.deckGroup = new THREE.Group();
    this.scene.add(this.deckGroup);

    const backBundle = createCardBackTextures();
    this.sharedBackHoloMat = this.createHoloShaderMaterial(backBundle.map, backBundle.metalnessMap, false);

    this.sharedGoldMat = new THREE.MeshStandardMaterial({
      color: '#eed094',
      metalness: 0.96,
      roughness: 0.17
    });
    this.sharedGemMat = new THREE.MeshPhysicalMaterial({
      color: '#b81838',
      metalness: 0.1,
      roughness: 0.06,
      clearcoat: 1,
      iridescence: 0.6
    });
    this.sharedPearlMat = new THREE.MeshPhysicalMaterial({
      color: '#fff8ef',
      roughness: 0.14,
      clearcoat: 1,
      iridescence: 0.45
    });

    this.cards = LENORMAND_CARDS.map((cardData, idx) => {
      const { faces, foils } = this.deckTextures;
      const frontHoloMat = this.createHoloShaderMaterial(faces, foils, true);
      const col = idx % 8;
      const row = Math.floor(idx / 8);
      const left = col / 8;
      const bottom = (4 - row) / 5;
      frontHoloMat.uniforms.uArtRect.value.set(left + 0.5 / 1792, bottom + 0.5 / 1680, 1 / 8 - 1 / 1792, 1 / 5 - 1 / 1680);
      frontHoloMat.uniforms.uFoilRect.value.set(left + 0.5 / 896, bottom + 0.5 / 840, 1 / 8 - 1 / 896, 1 / 5 - 1 / 840);

      const root = new THREE.Group();
      root.rotation.order = 'YXZ';

      const fallbackVisual = this.createRoundedFallbackCard(
        frontHoloMat,
        this.sharedBackHoloMat,
        this.sharedGoldMat
      );
      root.add(fallbackVisual);

      const hitBox = new THREE.Mesh(
        this.hitGeometry ??= new THREE.BoxGeometry(CARD_W, 0.026, CARD_H),
        this.hitMaterial ??= new THREE.MeshBasicMaterial({ visible: false })
      );
      root.add(hitBox);

      const state = {
        data: cardData,
        index: idx,
        mesh: root,
        hitBox,
        visualNode: fallbackVisual,
        frontHoloMat,
        holoUniforms: frontHoloMat.uniforms,
        targetPos: new THREE.Vector3(-2.75, 0.018 + idx * 0.016, -1.35),
        posVel: new THREE.Vector3(0, 0, 0),
        targetYaw: 0,
        targetTiltX: 0,
        targetFlipZ: 0,
        rotVel: new THREE.Vector3(0, 0, 0),
        targetScale: 1,
        scaleVel: 0,
        dealFlash: 0,
        flight: {
          active: false,
          elapsed: 0,
          duration: 0.68,
          startPos: new THREE.Vector3(),
          endPos: new THREE.Vector3(),
          startYaw: 0,
          endYaw: 0,
          startFlip: 0,
          endFlip: Math.PI,
          peakY: 1.55,
          spawnRipple: false,
          lastSparkAt: 0
        },
        isDrawn: false,
        drawnOrder: -1
      };

      hitBox.userData.cardState = state;
      root.position.copy(state.targetPos);
      this.deckGroup.add(root);
      return state;
    });

    this.deckOrder = this.cards.map((_, i) => i);

    const loader = new GLTFLoader();
    loader.load('./assets/models/baroque_card.glb', (gltf) => {
      const template = gltf.scene;
      this.sharedBackHoloMat.uniforms.uFlipV.value = 1;
      this.cards.forEach((c) => {
        c.holoUniforms.uFlipV.value = 1;
        const clone = template.clone(true);
        clone.scale.set(1, 0.36, 1);
        c.trim = [];
        clone.traverse((node) => {
          if (!node.isMesh) return;
          node.castShadow = node.name === 'CardFrontCanvas' || node.name === 'CardBackCanvas';
          node.receiveShadow = false;
          if (!node.castShadow) c.trim.push(node);
          if (node.name === 'CardFrontCanvas') {
            node.material = c.frontHoloMat;
          } else if (node.name === 'CardBackCanvas') {
            node.material = this.sharedBackHoloMat;
          } else if (node.name.includes('Gem')) {
            node.material = this.sharedGemMat;
          } else if (node.name.includes('Pearl')) {
            node.material = this.sharedPearlMat;
          } else {
            node.material = this.sharedGoldMat;
          }
        });
        const simpleRim = c.visualNode.children[0];
        simpleRim.scale.y = 0.38;
        c.simpleRim = simpleRim;
        c.mesh.remove(c.visualNode);
        c.visualNode = clone;
        c.mesh.add(clone, simpleRim);
        this.updateCardDetail(c);
      });
      if (this.coarsePointer) this.buildBackBatches();
    });
  }

  buildBackBatches() {
    // Face-down cards share the same artwork and edge. Keep individual hit boxes and springs.
    const first = this.cards[0];
    const back = first.visualNode.getObjectByName('CardBackCanvas');
    if (!back?.isMesh) return;
    first.mesh.updateWorldMatrix(true, true);
    const inverseRoot = first.mesh.matrixWorld.clone().invert();
    this.batchTransform = new THREE.Matrix4();
    this.backBatches = [back, first.simpleRim].map(source => {
      const batch = new THREE.InstancedMesh(source.geometry, source.material, this.cards.length);
      batch.count = 0;
      batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      batch.frustumCulled = false;
      batch.castShadow = source.castShadow;
      this.deckGroup.add(batch);
      return { batch, local: inverseRoot.clone().multiply(source.matrixWorld) };
    });
  }

  writeBackBatches() {
    let count = 0;
    for (const card of this.cards) {
      const batched = !card.flight.active && !card.detailed &&
        Math.abs(card.mesh.rotation.x) < 0.5 && Math.abs(card.mesh.rotation.z) < 0.5;
      card.visualNode.visible = !batched;
      card.simpleRim.visible = !batched && !card.detailed;
      if (!batched || !card.mesh.visible) continue;
      card.mesh.updateMatrix();
      for (const { batch, local } of this.backBatches) {
        batch.setMatrixAt(count, this.batchTransform.multiplyMatrices(card.mesh.matrix, local));
      }
      count++;
    }
    for (const { batch } of this.backBatches) {
      batch.count = count;
      batch.instanceMatrix.needsUpdate = true;
    }
  }

  updateCardDetail(card) {
    if (!card.trim) return;
    const detailed = card.targetFlipZ > 1.5 || card.mesh.rotation.z > 1.5 || this.inspectedCard === card;
    if (card.detailed === detailed) return;
    card.detailed = detailed;
    card.simpleRim.visible = !detailed;
    for (const mesh of card.trim) mesh.visible = detailed;
  }

  releaseInspectTexture() {
    this.inspectionVersion++;
    const card = this.inspectedCard;
    if (!card?.inspectTexture) return;
    card.holoUniforms.uMap.value = this.deckTextures.faces;
    card.holoUniforms.uArtRect.value.copy(card.atlasArtRect);
    card.inspectTexture.dispose();
    card.inspectTexture = null;
  }

  async loadInspectTexture(card) {
    const version = this.inspectionVersion;
    try {
      const texture = await this.textureLoader.loadAsync(cardFaceUrl(card.data));
      if (version !== this.inspectionVersion || this.inspectedCard !== card) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      card.atlasArtRect = card.holoUniforms.uArtRect.value.clone();
      card.holoUniforms.uMap.value = texture;
      card.holoUniforms.uArtRect.value.set(0, 0, 1, 1);
      card.inspectTexture = texture;
    } catch (_) {
      // The shared illustrated atlas remains visible while a detailed image is unavailable.
    }
  }

  // 释放或切换 3D 手持近景把玩检视态
  dismissInspectCard() {
    if (!this.inspectedCard) return false;
    this.releaseInspectTexture();
    this.inspectedCard = null;
    this.cancelTouchGesture();
    this.sound?.playUiTap?.();
    this.callbacks.onInspect3DChange?.(null);
    return true;
  }

  toggleInspect3DCard(cardState) {
    if (!cardState) return;
    if (this.inspectedCard === cardState) {
      this.dismissInspectCard();
    } else {
      this.releaseInspectTexture();
      this.inspectedCard = cardState;
      this.loadInspectTexture(cardState);
      this.sound?.playCardFlip(3);
      this.callbacks.onInspect3DChange?.(cardState.data);
    }
  }

  launchCardFlight(
    cardState,
    endPos,
    endYaw,
    endFlip,
    { peakY = 1.48, duration = 0.68, scale = null, endTiltX = 0, spawnRipple = false } = {}
  ) {
    if (scale !== null) cardState.targetScale = scale;
    cardState.targetPos.copy(endPos);
    cardState.targetYaw = endYaw;
    cardState.targetFlipZ = endFlip;
    cardState.targetTiltX = endTiltX;
    cardState.posVel.set(0, 0, 0);
    cardState.rotVel.set(0, 0, 0);

    if (this.reducedMotion || this.motionPaused) {
      cardState.flight.active = false;
      cardState.mesh.position.copy(endPos);
      cardState.mesh.rotation.set(endTiltX, endYaw, endFlip);
      return;
    }

    const f = cardState.flight;
    f.active = true;
    f.elapsed = 0;
    f.duration = duration;
    f.startPos.copy(cardState.mesh.position);
    f.endPos.copy(endPos);
    f.startYaw = cardState.mesh.rotation.y;
    f.endYaw = endYaw;
    f.startFlip = cardState.mesh.rotation.z;
    f.endFlip = endFlip;
    const minPeakY = endFlip > 1.5 ? 1.55 : 0;
    f.peakY = Math.max(peakY, minPeakY, f.startPos.y + 0.68, endPos.y + 0.68);
    f.spawnRipple = spawnRipple;
    f.lastSparkAt = 0;
  }

  arrangeOnboardingPair(rightCardId = 25, playFlip = true) {
    this.clearPendingTimers();
    this.dismissInspectCard();
    this.mode = 'onboarding';
    this.drawnCards = [];
    this.hoveredCard = null;
    this.highlightedSingleSlot = -1;
    this.setSlotOpacity(0);
    this.updateCameraForViewport();

    let stackRank = 0;
    this.cards.forEach((c) => {
      c.isDrawn = false;
      c.drawnOrder = -1;

      if (c.data.id === 24) {
        c.targetScale = 1.05;
        const pos = new THREE.Vector3(-0.74, 0.14, -0.22);
        if (playFlip && c.targetFlipZ < 1.5) {
          this.launchCardFlight(c, pos, -0.05, Math.PI, {
            peakY: 1.5,
            duration: 0.66,
            scale: 1.05,
            endTiltX: 0.10,
            spawnRipple: true
          });
        } else {
          c.flight.active = false;
          c.targetPos.copy(pos);
          c.targetYaw = -0.05;
          c.targetTiltX = 0.10;
          c.targetFlipZ = Math.PI;
          if (!playFlip) {
            c.mesh.position.copy(pos);
            c.mesh.rotation.set(0.10, -0.05, Math.PI);
          }
        }
      } else if (c.data.id === rightCardId) {
        c.targetScale = 1.05;
        const pos = new THREE.Vector3(0.74, 0.14, -0.22);
        if (playFlip) {
          c.mesh.position.set(-2.65, 0.62, -1.25);
          c.mesh.rotation.set(0, 0.2, 0);
          this.launchCardFlight(c, pos, 0.05, Math.PI, {
            peakY: 1.62,
            duration: 0.68,
            scale: 1.05,
            endTiltX: 0.10,
            spawnRipple: true
          });
          this.sound?.playCardFlip(1);
        } else {
          c.flight.active = false;
          c.targetPos.copy(pos);
          c.targetYaw = 0.05;
          c.targetTiltX = 0.10;
          c.targetFlipZ = Math.PI;
          c.mesh.position.copy(pos);
          c.mesh.rotation.set(0.10, 0.05, Math.PI);
        }
      } else {
        c.targetScale = 0.88;
        const pos = new THREE.Vector3(-2.68, 0.018 + stackRank * 0.0165, -1.28);
        if (c.targetFlipZ > 1.5 && playFlip) {
          this.launchCardFlight(c, pos, 0.14, 0, { peakY: 1.25, duration: 0.54, scale: 0.88 });
        } else {
          c.flight.active = false;
          c.targetPos.copy(pos);
          c.targetYaw = 0.14;
          c.targetTiltX = 0;
          c.targetFlipZ = 0;
        }
        stackRank++;
      }
    });

    this.clearPairThreads();
    this.addGoldenArc(new THREE.Vector3(-0.74, 0.16, -0.22), new THREE.Vector3(0.74, 0.16, -0.22), 0, 1, 0.88);
  }

  arrangeTopicStage(emblemCardId = 24) {
    this.clearPendingTimers();
    this.dismissInspectCard();
    this.mode = 'topic';
    this.clearPairThreads();
    this.setSlotOpacity(0);
    this.updateCameraForViewport();

    let stackRank = 0;
    this.cards.forEach((c) => {
      c.isDrawn = false;
      c.drawnOrder = -1;
      if (c.data.id === emblemCardId) {
        const pos = new THREE.Vector3(0, 0.26, -0.24);
        if (c.targetFlipZ < 1.5) {
          this.launchCardFlight(c, pos, 0, Math.PI, {
            peakY: 1.52,
            duration: 0.64,
            scale: 1.14,
            endTiltX: 0.14,
            spawnRipple: true
          });
          this.sound?.playCardFlip(2);
        } else {
          c.targetScale = 1.14;
          c.targetPos.copy(pos);
          c.targetYaw = 0;
          c.targetTiltX = 0.14;
          c.targetFlipZ = Math.PI;
        }
      } else {
        const pos = new THREE.Vector3(-2.35, 0.018 + stackRank * 0.0165, -1.05);
        if (c.targetFlipZ > 1.5) {
          this.launchCardFlight(c, pos, 0.12, 0, { peakY: 1.2, duration: 0.52, scale: 0.88 });
        } else {
          c.flight.active = false;
          c.targetScale = 0.88;
          c.targetPos.copy(pos);
          c.targetYaw = 0.12;
          c.targetTiltX = 0;
          c.targetFlipZ = 0;
        }
        stackRank++;
      }
    });
  }

  previewSpreadOnTable(spreadId) {
    if (!SPREAD_CONFIGS[spreadId]) return;
    this.clearPendingTimers();
    this.dismissInspectCard();
    this.mode = 'spread_preview';
    this.spreadId = spreadId;
    this.clearPairThreads();
    this.updateSpreadSlots();
    this.setSlotOpacity(0.5);
    this.updateCameraForViewport();

    this.cards.forEach((c, i) => {
      const pos = new THREE.Vector3(-2.65, 0.018 + i * 0.0165, -1.35);
      if (c.targetFlipZ > 1.5) {
        this.launchCardFlight(c, pos, 0.14, 0, { peakY: 1.2, duration: 0.5, scale: 0.86 });
      } else {
        c.flight.active = false;
        c.targetScale = 0.86;
        c.targetPos.copy(pos);
        c.targetYaw = 0.14;
        c.targetTiltX = 0;
        c.targetFlipZ = 0;
      }
    });
  }

  updateSpreadSlots() {
    for (const frame of [...this.slotsGroup.children]) {
      for (const line of frame.children) {
        line.geometry.dispose();
        line.material.dispose();
      }
      this.slotsGroup.remove(frame);
    }
    this.slotMeshes = [];

    const config = SPREAD_CONFIGS[this.spreadId] || SPREAD_CONFIGS.line3;
    const s = config.scale || 0.88;

    config.positions.forEach((pos) => {
      const frame = new THREE.Group();
      frame.position.set(pos.x, 0.008, pos.z - 0.22);
      frame.rotation.y = pos.yaw || 0;

      const hw = CARD_W * 0.53 * s;
      const hh = CARD_H * 0.53 * s;
      const pts = [
        new THREE.Vector3(-hw, 0, -hh),
        new THREE.Vector3(hw, 0, -hh),
        new THREE.Vector3(hw, 0, hh),
        new THREE.Vector3(-hw, 0, hh),
        new THREE.Vector3(-hw, 0, -hh)
      ];
      const lineMat = new THREE.LineBasicMaterial({
        color: '#f0ce92',
        transparent: true,
        opacity: 0
      });
      frame.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
      this.slotsGroup.add(frame);
      this.slotMeshes.push({ lineMat });
    });
  }

  setSlotOpacity(opacity) {
    this.slotMeshes.forEach((s) => {
      s.lineMat.opacity = opacity;
    });
  }

  clearPairThreads() {
    while (this.threadsGroup.children.length) {
      const c = this.threadsGroup.children.at(-1);
      this.threadsGroup.remove(c);
      c.geometry?.dispose();
      c.material?.dispose();
    }
    this.pairThreads = [];
    this.activePairIndices = null;
  }

  addGoldenArc(vecA, vecB, aIdx, bIdx, initialOpacity = 0.25) {
    const mid = vecA.clone().add(vecB).multiplyScalar(0.5);
    const dist = vecA.distanceTo(vecB);
    mid.y += 0.22 + dist * 0.11;

    const curve = new THREE.QuadraticBezierCurve3(vecA, mid, vecB);
    const tubeGeo = new THREE.TubeGeometry(curve, 36, 0.011, 8, false);
    const tubeMat = new THREE.MeshBasicMaterial({
      color: '#ffe2a8',
      transparent: true,
      opacity: initialOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(tubeGeo, tubeMat);
    this.threadsGroup.add(mesh);

    const bead = new THREE.Mesh(
      new THREE.SphereGeometry(0.034, 12, 12),
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: initialOpacity,
        blending: THREE.AdditiveBlending
      })
    );
    this.threadsGroup.add(bead);

    this.pairThreads.push({ a: aIdx, b: bIdx, curve, mesh, mat: tubeMat, bead });
  }

  highlightPair(a, b) {
    this.highlightedSingleSlot = -1;
    if (a === null || b === null || a === undefined) {
      this.activePairIndices = null;
      this.pairThreads.forEach((t) => {
        t.mat.opacity = 0.24;
        t.bead.material.opacity = 0.3;
      });
      return;
    }
    this.activePairIndices = [a, b];
    this.pairThreads.forEach((t) => {
      const match = (t.a === a && t.b === b) || (t.a === b && t.b === a);
      t.mat.opacity = match ? 0.94 : 0.07;
      t.bead.material.opacity = match ? 1.0 : 0.0;
    });
  }

  highlightSingleSlot(slotIdx) {
    this.highlightedSingleSlot = slotIdx;
  }

  setSpread(spreadId) {
    if (!SPREAD_CONFIGS[spreadId]) return;
    this.spreadId = spreadId;
    this.updateSpreadSlots();
  }

  // 第一幕：星盘交错洗牌 -> 第二幕：荷官级从左至右丝滑瀑布铺扇（Ribbon Spread Cascade）
  startShuffleRitual() {
    this.clearPendingTimers();
    this.dismissInspectCard();
    this.mode = 'shuffling';
    this.drawnCards = [];
    this.hoveredCard = null;
    this.focusedCardIndex = -1;
    this.highlightedSingleSlot = -1;
    this.clearPairThreads();
    this.updateSpreadSlots();
    this.setSlotOpacity(0.38);
    this.updateCameraForViewport();

    const order = this.cards.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.deckOrder = order;
    this.shuffleStart = this.elapsed;
    this.sound?.playShuffleCascade();

    order.forEach((cardIdx) => {
      const c = this.cards[cardIdx];
      c.isDrawn = false;
      c.drawnOrder = -1;
      c.flight.active = false;
      c.targetScale = 0.80;
      c.targetFlipZ = 0;
      c.targetTiltX = 0;
    });

    const delay = this.reducedMotion || this.motionPaused ? 120 : 620;
    this.queueTimer(() => this.fanOutForPicking(true), delay);
  }

  fanOutForPicking(staggerCascade = false) {
    this.mode = 'picking';
    this.updateCameraForViewport();

    if (this.coarsePointer) {
      // The touch hand owns face-down cards while the table shows the open spread.
      this.deckOrder.forEach((index, rank) => {
        const card = this.cards[index];
        card.targetPos.set(0, 0.022 + rank * 0.0165, 1.65);
        card.targetYaw = 0;
      });
    } else if (staggerCascade && !this.reducedMotion && !this.motionPaused) {
      // 先迅速聚拢至左端发牌点，随后以 12ms 级联差依次铺开成完美弧扇，同时立即可交互！
      const isPortrait = window.innerWidth < 768;
      const startTheta = -(isPortrait ? 0.58 : 0.54);
      const arcRadius = isPortrait ? 3.15 : 4.55;
      const arcCenterZ = isPortrait ? 4.35 : 5.55;
      const originX = Math.sin(startTheta) * arcRadius;
      const originZ = arcCenterZ - Math.cos(startTheta) * arcRadius;

      this.deckOrder.forEach((cardIdx, i) => {
        const c = this.cards[cardIdx];
        c.targetPos.set(originX, 0.022 + i * 0.0165, originZ);
        c.targetYaw = -startTheta;
        c.targetScale = isPortrait ? 0.74 : 0.84;
      });

      this.deckOrder.forEach((cardIdx, rank) => {
        this.queueTimer(() => {
          if (this.mode !== 'picking' || this.hoveredCard || this.drawnCards.length) return;
          const c = this.cards[cardIdx];
          c.dealFlash = 1.0; // 铺牌波浪扫过时的流光脉冲
          this.layoutSingleFanCard(rank, this.deckOrder.length);
        }, rank * 12);
      });
    } else {
      this.layoutRemainingArc();
    }

    const needed = SPREAD_CONFIGS[this.spreadId].count;
    this.callbacks.onPickingReady?.(0, needed);
  }

  layoutSingleFanCard(i, total) {
    const remaining = this.deckOrder.filter((idx) => !this.cards[idx].isDrawn);
    const cardIdx = remaining[i];
    if (cardIdx === undefined) return;
    const c = this.cards[cardIdx];
    if (c.flight.active) return;

    const isPortrait = window.innerWidth < 768;
    const arcRadius = isPortrait ? 3.15 : 4.55;
    const arcCenterZ = isPortrait ? 4.35 : 5.55;
    const maxAngle = isPortrait ? 0.58 : 0.54;

    const baseT = total > 1 ? i / (total - 1) - 0.5 : 0;
    const theta = baseT * maxAngle * 2;
    c.targetPos.set(Math.sin(theta) * arcRadius, 0.022 + i * 0.0165, arcCenterZ - Math.cos(theta) * arcRadius);
    c.targetYaw = -theta;
    c.targetTiltX = 0;
    c.targetFlipZ = 0;
    c.targetScale = isPortrait ? 0.74 : 0.84;
  }

  // Balatro / Cover-Flow 级波浪抚牌扇弧（悬停牌高抬滑出 + 邻牌平滑高斯波浪退让，严格分层零穿模！）
  layoutRemainingArc() {
    if (this.coarsePointer) return;
    const isPortrait = window.innerWidth < 768;
    const arcRadius = isPortrait ? 3.15 : 4.55;
    const arcCenterZ = isPortrait ? 4.35 : 5.55;
    const maxAngle = isPortrait ? 0.58 : 0.54;

    const remaining = this.deckOrder.filter((idx) => !this.cards[idx].isDrawn);
    const total = remaining.length;

    const hoverRank =
      this.hoveredCard && !this.hoveredCard.isDrawn
        ? remaining.indexOf(this.hoveredCard.index)
        : -1;

    remaining.forEach((cardIdx, i) => {
      const c = this.cards[cardIdx];
      if (c.flight.active) return;

      const baseT = total > 1 ? i / (total - 1) - 0.5 : 0;
      let theta = baseT * maxAngle * 2;

      let neighborWavePull = 0;
      if (hoverRank >= 0 && i !== hoverRank) {
        const diff = i - hoverRank;
        const absDiff = Math.abs(diff);
        const sign = Math.sign(diff);
        const falloff = Math.exp(-absDiff * 0.48);
        theta += sign * 0.064 * falloff;
        // 邻近 1~2 张牌伴随轻微径向呼吸涟漪（保持严格单调层高 y 不变，0 穿模！）
        neighborWavePull = 0.14 * Math.exp(-absDiff * 0.9);
      }

      const isHovered = i === hoverRank;
      const r = isHovered ? arcRadius - 0.54 : arcRadius - neighborWavePull;
      const x = Math.sin(theta) * r;
      const z = arcCenterZ - Math.cos(theta) * r;
      const y = isHovered ? 0.78 : 0.022 + i * 0.0165;

      c.targetPos.set(x, y, z);
      c.targetYaw = -theta;
      c.targetTiltX = isHovered ? 0.16 : 0;
      c.targetFlipZ = 0;
      c.targetScale = isPortrait
        ? isHovered
          ? 0.86
          : 0.74
        : isHovered
          ? 0.96
          : 0.84 + neighborWavePull * 0.18;
    });
  }

  dealHand(choices) {
    choices.forEach(({rank, origin}, i) => {
      const card = this.cards[this.deckOrder[rank]];
      this.queueTimer(() => this.pickCardState(card, origin), this.motionPaused || this.reducedMotion ? 0 : i * 135);
    });
  }

  pickCardState(cardState, origin) {
    if (this.mode !== 'picking' || !cardState || cardState.isDrawn) return;
    const config = SPREAD_CONFIGS[this.spreadId];
    const slotIndex = this.drawnCards.length;
    if (slotIndex >= config.count) return;

    const slot = config.positions[slotIndex];
    cardState.isDrawn = true;
    cardState.drawnOrder = slotIndex;
    this.drawnCards.push(cardState);

    const isMobile = window.innerWidth < 768;
    const baseScale = config.scale || 0.88;
    const finalScale = isMobile ? baseScale * 0.88 : baseScale;

    const endPos = new THREE.Vector3(slot.x, 0.030 + slotIndex * 0.004, slot.z - 0.22);
    if (origin) {
      this.updatePointer(origin.left + origin.width / 2, origin.top + origin.height / 2);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const handPlane = this.tablePlane.clone();
      handPlane.constant = -0.78;
      this.raycaster.ray.intersectPlane(handPlane, cardState.mesh.position);
      cardState.mesh.rotation.set(0, 0, 0);
    }
    this.launchCardFlight(cardState, endPos, slot.yaw || 0, Math.PI, {
      peakY: 1.66,
      duration: 0.72,
      scale: finalScale,
      endTiltX: 0.04,
      spawnRipple: true
    });

    this.hoveredCard = null;
    this.sound?.playCardFlip(slotIndex);
    this.layoutRemainingArc();

    const drawnCount = this.drawnCards.length;
    this.callbacks.onCardPicked?.(drawnCount, config.count, cardState.data, this.deckOrder.indexOf(cardState.index));

    if (drawnCount >= config.count) {
      this.finishSpread();
    }
  }

  quickDrawRemaining(origin) {
    if (this.mode !== 'picking') return;
    const config = SPREAD_CONFIGS[this.spreadId];
    const needed = config.count - this.drawnCards.length;
    const remaining = this.deckOrder.filter((idx) => !this.cards[idx].isDrawn);

    for (let i = 0; i < needed; i++) {
      const pickRank = Math.floor((i + 0.5) * (remaining.length / needed));
      const state = this.cards[remaining[pickRank]];
      this.queueTimer(() => {
        this.pickCardState(state, origin);
      }, i * (this.reducedMotion ? 40 : 185));
    }
  }

  selectFanRank(rank) {
    const remaining = this.deckOrder.filter(index => !this.cards[index].isDrawn);
    this.focusedCardIndex = rank;
    this.setHoveredCard(this.cards[remaining[rank]] || null);
    return this.hoveredCard;
  }

  stepKeyboardFocus(delta) {
    if (this.mode !== 'picking') return null;
    const remaining = this.deckOrder.filter((idx) => !this.cards[idx].isDrawn);
    if (!remaining.length) return null;
    const rank = this.focusedCardIndex < 0 ? Math.floor(remaining.length / 2) :
      (Math.min(this.focusedCardIndex, remaining.length - 1) + delta + remaining.length) % remaining.length;
    return this.selectFanRank(rank);
  }

  confirmKeyboardPick() {
    if (this.mode !== 'picking') return;
    const remaining = this.deckOrder.filter((idx) => !this.cards[idx].isDrawn);
    if (!remaining.length) return;
    const target =
      this.hoveredCard && !this.hoveredCard.isDrawn
        ? this.hoveredCard
        : this.cards[remaining[Math.floor(remaining.length / 2)]];
    this.pickCardState(target);
  }

  finishSpread() {
    this.mode = 'reading';
    this.hoveredCard = null;
    this.setSlotOpacity(0);
    this.updateCameraForViewport();

    const unused = this.deckOrder.filter((idx) => !this.cards[idx].isDrawn);
    unused.forEach((cardIdx, i) => {
      const c = this.cards[cardIdx];
      c.flight.active = false;
      c.targetScale = 0.80;
      c.targetPos.set(-2.95, 0.018 + i * 0.0155, -1.65);
      c.targetYaw = 0.16;
      c.targetTiltX = 0;
      c.targetFlipZ = 0;
    });

    this.queueTimer(() => {
      if (this.mode !== 'reading') return;
      this.clearPairThreads();
      const config = SPREAD_CONFIGS[this.spreadId] || SPREAD_CONFIGS.line3;
      config.pairs.forEach((pair) => {
        const pA = config.positions[pair.a];
        const pB = config.positions[pair.b];
        if (!pA || !pB) return;
        this.addGoldenArc(
          new THREE.Vector3(pA.x, 0.06, pA.z - 0.22),
          new THREE.Vector3(pB.x, 0.06, pB.z - 0.22),
          pair.a,
          pair.b,
          0.26
        );
      });
      this.sound?.playCrystalChime([523.25, 659.25, 783.99, 1046.5], 0.036);
      this.callbacks.onSpreadComplete?.(this.drawnCards.map((c) => c.data));
    }, this.reducedMotion ? 110 : 700);
  }

  updateCameraForViewport() {
    const isPortrait = this.camera.aspect < 0.88;

    if (this.mode === 'onboarding' || this.mode === 'topic') {
      if (isPortrait) {
        this.camTargetPos.set(0, 6.0, 5.0);
        this.camTargetLook.set(0, 0, 0.42);
      } else {
        this.camTargetPos.set(0, 4.45, 4.2);
        this.camTargetLook.set(0, 0, 0.32);
      }
    } else if (this.mode === 'spread_preview') {
      const isGrid = this.spreadId === 'box9' || this.spreadId === 'cross5';
      this.camTargetPos.set(0, isPortrait ? 6.9 : isGrid ? 5.5 : 4.9, isPortrait ? 5.2 : 4.35);
      this.camTargetLook.set(0, 0, 0.32);
    } else if (this.mode === 'shuffling') {
      this.camTargetPos.set(0, isPortrait ? 6.8 : 5.4, isPortrait ? 5.0 : 4.1);
      this.camTargetLook.set(0, 0.35, 0);
    } else if (this.mode === 'picking') {
      const isGrid = this.spreadId === 'box9' || this.spreadId === 'cross5';
      if (isPortrait) {
        this.camTargetPos.set(0, isGrid ? 7.9 : 7.2, isGrid ? 5.2 : 4.8);
        this.camTargetLook.set(0, 0, 0.48);
        const fit = Math.max(1, 0.56 / this.camera.aspect);
        this.camTargetPos.sub(this.camTargetLook).multiplyScalar(fit).add(this.camTargetLook);
      } else {
        this.camTargetPos.set(0, isGrid ? 5.85 : 5.35, isGrid ? 4.25 : 4.0);
        this.camTargetLook.set(0, 0, 0.38);
      }
      if (this.coarsePointer && window.innerHeight <= 520 && !isPortrait) {
        const offset = this.camera.aspect * 0.87;
        this.camTargetPos.x += offset;
        this.camTargetLook.x += offset;
      }
    } else if (this.mode === 'reading') {
      const isGrid = this.spreadId === 'box9' || this.spreadId === 'cross5';
      if (window.matchMedia('(max-width: 1024px) and (orientation: portrait)').matches) {
        this.camTargetPos.set(0, isGrid ? 8.6 : 6.4, isGrid ? 4.7 : 3.9);
        this.camTargetLook.set(0, 0, isGrid ? 1.02 : 0.65);
      } else {
        this.camTargetPos.set(0.92, isGrid ? 5.55 : 5.0, isGrid ? 3.85 : 3.5);
        this.camTargetLook.set(0.92, 0, -0.18);
      }
    }
  }

  setMotionPaused(paused) {
    this.motionPaused = Boolean(paused);
  }

  bindEvents() {
    new ResizeObserver(() => this.onResize()).observe(this.canvas);
    const dialogs = document.querySelectorAll('dialog');
    const modalObserver = new MutationObserver(() => {
      this.modalOpen = Array.from(dialogs).some(dialog => dialog.open);
    });
    for (const dialog of dialogs) modalObserver.observe(dialog, {attributeFilter: ['open']});
    this.modalOpen = Array.from(dialogs).some(dialog => dialog.open);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.cancelTouchGesture();
      this.syncRenderLoop();
    });
    this.canvas.addEventListener('webglcontextlost', () => {
      this.cancelTouchGesture();
      this.syncRenderLoop();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      // Three.js 恢复 GPU 资源后，重新烘焙只有 GPU 副本的环境光贴图。
      this.rebuildEnvironmentLight();
      this.syncRenderLoop();
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        this.moveTouchGesture(e);
        return;
      }
      if (this.coarsePointer && this.mode === 'picking') return;
      this.isTouchInput = false;
      this.updatePointer(e.clientX, e.clientY);
      this.updateHoverRaycast();
    });

    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.renderer.getContext().isContextLost()) return;
      this.isTouchInput = e.pointerType === 'touch';
      if (this.isTouchInput) {
        if (this.coarsePointer && this.mode === 'picking') return;
        this.cancelTouchGesture();
        if (e.isPrimary) {
          this.touchGesture = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            mode: this.mode,
            inspectedCard: this.inspectedCard,
            moved: false
          };
        }
        return;
      }
      this.activateAtPoint(e.clientX, e.clientY);
    });

    this.canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch') {
        this.pointer.set(0, 0);
        this.setHoveredCard(null);
      }
    });

    this.canvas.addEventListener('pointerup', (e) => {
      const gesture = this.touchGesture;
      if (gesture?.id !== e.pointerId) return;
      const isTap =
        !gesture.moved &&
        gesture.mode === this.mode &&
        gesture.inspectedCard === this.inspectedCard &&
        Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) <= TOUCH_TAP_SLOP;
      this.cancelTouchGesture();
      if (isTap) {
        this.activateAtPoint(gesture.x, gesture.y);
        this.setHoveredCard(null);
      }
    });

    const cancelTouch = (e) => {
      if (this.touchGesture?.id === e.pointerId) this.cancelTouchGesture();
    };
    this.canvas.addEventListener('pointercancel', cancelTouch);
    this.canvas.addEventListener('lostpointercapture', cancelTouch);
  }

  moveTouchGesture(e) {
    const gesture = this.touchGesture;
    if (gesture?.id !== e.pointerId || gesture.mode !== this.mode) return;
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) <= TOUCH_TAP_SLOP) return;
    gesture.moved = true;

    if (this.inspectedCard && this.inspectedCard === gesture.inspectedCard) {
      this.touchTilt.set(
        THREE.MathUtils.clamp(dx / INSPECT_DRAG_RANGE, -1, 1),
        THREE.MathUtils.clamp(-dy / INSPECT_DRAG_RANGE, -1, 1)
      );
    } else if (this.mode === 'picking') {
      this.updatePointer(e.clientX, e.clientY);
      this.updateHoverRaycast(false);
    }
  }

  cancelTouchGesture() {
    if (!this.touchGesture) return;
    if (this.touchGesture.moved && this.touchGesture.mode === 'picking') {
      this.setHoveredCard(null);
    }
    this.touchGesture = null;
    this.touchTilt.set(0, 0);
  }

  updatePointer(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((x - rect.left) / rect.width) * 2 - 1,
      1 - ((y - rect.top) / rect.height) * 2
    );
  }

  activateAtPoint(x, y) {
    if (this.renderer.getContext().isContextLost() || (this.coarsePointer && this.mode === 'picking')) return;
    this.updatePointer(x, y);
    this.updateHoverRaycast(!this.isTouchInput);

    if (this.mode === 'picking' && this.hoveredCard && !this.hoveredCard.isDrawn) {
      this.pickCardState(this.hoveredCard);
      return;
    }

    if (this.hoveredCard?.targetFlipZ > 1.5) {
      this.toggleInspect3DCard(this.hoveredCard);
      return;
    }

    if (this.dismissInspectCard()) return;

    const prop = this.raycaster.intersectObjects(this.interactiveProps, false)[0]?.object.userData.propType;
    if (prop === 'crystal') {
      this.crystalPulse = 1.0;
      this.sound?.playCrystalChime([659.25, 987.77, 1318.5], 0.04);
      const msg = DIANA_CRYSTAL_WHISPERS[this.whisperIdx % DIANA_CRYSTAL_WHISPERS.length];
      this.whisperIdx++;
      this.callbacks.onCrystalWhisper?.(msg, x, y);
    } else if (prop === 'candelabra') {
      this.crystalPulse = 0.6;
      this.sound?.playCrystalChime([440, 659.25], 0.03);
      this.callbacks.onCrystalWhisper?.('烛火轻轻跃动了一下，Diana 替你把桌面照亮了一寸。', x, y);
    }
  }

  setHoveredCard(card) {
    if (card === this.hoveredCard) return;
    this.hoveredCard = card;
    if (this.mode === 'picking') this.layoutRemainingArc();
    if (card) this.sound?.playCardHover();
  }

  updateHoverRaycast(updateCursor = true) {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.ray.intersectPlane(this.tablePlane, this.worldCursorOnTable);

    if (this.mode === 'shuffling') {
      this.setHoveredCard(null);
      if (updateCursor) this.canvas.style.cursor = 'default';
      return;
    }

    const hit = this.raycaster.intersectObjects(this.cardHitBoxes, false)[0];
    const candidate = hit?.object.userData.cardState;
    let nextHover = null;
    if (candidate) {
      if (this.mode === 'picking' && !candidate.isDrawn && !candidate.flight.active) {
        nextHover = candidate;
      } else if (
        (this.mode === 'reading' || this.mode === 'onboarding' || this.mode === 'topic') &&
        candidate.targetFlipZ > 1.5 && !candidate.flight.active
      ) {
        nextHover = candidate;
      }
    }

    this.setHoveredCard(nextHover);
    if (!updateCursor) return;
    const overProp = !nextHover && this.raycaster.intersectObjects(this.interactiveProps, false).length > 0;
    const cursor = nextHover || overProp ? 'pointer' : 'default';
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  syncRenderLoop() {
    const paused = document.hidden || this.renderer.getContext().isContextLost();
    this.clock.getDelta();
    this.frameWindow = null;
    this.renderer.setAnimationLoop(paused ? null : this.renderFrame);
  }

  adjustTouchResolution(seconds) {
    // Ignore startup, interruptions and isolated stalls. Only resize after sustained pressure.
    if (seconds <= 0 || seconds > 1) { this.frameWindow = null; return; }
    const sample = this.frameWindow ??= { time: 0, frames: 0, slow: 0 };
    sample.time += seconds;
    sample.frames++;
    if (seconds > 0.026) sample.slow++;
    if (sample.time < 2) return;
    const fraction = sample.slow / sample.frames;
    this.frameWindow = null;
    const ratio = this.renderer.getPixelRatio();
    if (fraction > 0.7 && ratio > 0.8) {
      this.renderer.setPixelRatio(Math.max(0.8, ratio - 0.25));
      this.lastResolutionDrop = performance.now();
    } else if (fraction < 0.05 && performance.now() - this.lastResolutionDrop > 10000) {
      const ceiling = Math.min(this.pixelRatio, Math.sqrt(2200000 / (this.viewportWidth * this.viewportHeight)));
      if (ratio < ceiling) {
        this.renderer.setPixelRatio(Math.min(ceiling, ratio + 0.15));
        this.lastResolutionDrop = performance.now();
      }
    }
  }

  onResize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h || (w === this.viewportWidth && h === this.viewportHeight)) return;
    this.viewportWidth = w;
    this.viewportHeight = h;
    this.camera.aspect = w / h;
    this.camera.fov = w < 768 ? 44 : 38;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(this.pixelRatio, Math.sqrt(2200000 / (w * h))));
    this.renderer.setSize(w, h, false);
    // 近看的牌面留出顶栏和底部胶囊的空间，横屏时优先保证整张牌可见。
    const viewHeight = 2 * INSPECT_DISTANCE * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const availableHeight = Math.max(0.32, 1 - 200 / h);
    this.inspectScale = viewHeight * Math.min(0.72 * this.camera.aspect / CARD_W, 0.82 * availableHeight / CARD_H);
    this.updateCameraForViewport();
    if (this.mode === 'picking') this.layoutRemainingArc();
  }

  animate() {
    const elapsed = this.clock.getDelta();
    if (this.coarsePointer && !this.modalOpen && this.viewportWidth) this.adjustTouchResolution(elapsed);
    const frameDelta = Math.min(elapsed, 0.08);
    const dt = Math.min(frameDelta, 0.036);
    const motionActive = !this.motionPaused && !this.reducedMotion;
    if (motionActive) {
      this.elapsed += frameDelta;
    }
    const t = this.elapsed;

    this.smoothPointer.lerp(this.isTouchInput ? this.touchTilt : this.pointer, 0.11);

    for (const u of this.holoUniformsList) {
      u.uTime.value = t;
      u.uPointer.value.copy(this.smoothPointer);
    }

    for (const u of this.flameUniforms) {
      u.uTime.value = t;
    }
    if (this.candleLight && motionActive) {
      this.candleLight.intensity = 10.2 + Math.sin(t * 7.1) * 0.45 + this.crystalPulse * 3.5;
    }
    if (this.crystalPulse > 0.001) {
      this.crystalPulse *= Math.exp(-2.8 * dt);
      if (this.crystalStarsMat) {
        this.crystalStarsMat.size = 0.068 + this.crystalPulse * 0.055;
      }
    }
    if (this.crystalCore && motionActive) {
      this.crystalCore.rotation.y = t * (0.28 + this.crystalPulse * 2.2);
      this.crystalCore.rotation.z = Math.sin(t * 0.5) * 0.16;
    }

    if (motionActive) {
      this.pairThreads.forEach((pt, idx) => {
        if (pt.bead.material.opacity > 0.05) {
          const u = (t * 0.42 + idx * 0.31) % 1;
          pt.curve.getPoint(u, pt.bead.position);
        }
      });
    }

    if (this.dustPoints && motionActive) {
      this.dustPoints.rotation.y = t * 0.02;
    }

    // 更新落桌金色星环涟漪
    for (let i = this.landingRipples.length - 1; i >= 0; i--) {
      const rp = this.landingRipples[i];
      rp.age += dt;
      const p = rp.age / rp.duration;
      if (p >= 1) {
        this.fxGroup.remove(rp.mesh);
        rp.mesh.geometry.dispose();
        rp.mat.dispose();
        this.landingRipples.splice(i, 1);
      } else {
        const s = 1 + (1 - Math.pow(1 - p, 3)) * 1.45;
        rp.mesh.scale.set(s, 1, s);
        rp.mat.opacity = (1 - p) * (1 - p) * 0.72;
      }
    }

    // 更新抽牌腾空流金彗尾微粒
    for (let i = this.trailSparks.length - 1; i >= 0; i--) {
      const sp = this.trailSparks[i];
      sp.age += dt;
      const p = sp.age / sp.life;
      if (p >= 1) {
        this.fxGroup.remove(sp.sprite);
        sp.mat.dispose();
        this.trailSparks.splice(i, 1);
      } else {
        sp.sprite.position.y += sp.vy * dt;
        sp.mat.opacity = Math.sin(p * Math.PI) * 0.88;
      }
    }

    if (this.mode === 'shuffling' && motionActive) {
      const spin = (t - this.shuffleStart) * 3.8;
      this.deckOrder.forEach((cardIdx, rank) => {
        const c = this.cards[cardIdx];
        const isInner = rank < 18;
        const slotInRing = isInner ? rank : rank - 18;
        const angle = (slotInRing / 18) * Math.PI * 2 + spin * (isInner ? 1 : -0.85);
        const radius = isInner ? 1.45 : 2.42;
        const baseH = isInner ? 0.88 : 0.38;
        c.targetPos.set(
          Math.cos(angle) * radius,
          baseH + (slotInRing % 3) * 0.04,
          Math.sin(angle) * radius * 0.68
        );
        c.targetYaw = -angle;
        c.targetTiltX = 0.08;
        c.targetFlipZ = 0;
      });
    }

    // 计算 3D 近景把玩悬停位置（正对当前相机视线中央偏前！）
    if (this.inspectedCard) {
      this.camera.getWorldDirection(this.inspectWorldPos).multiplyScalar(INSPECT_DISTANCE).add(this.camera.position);
      this.inspectWorldPos.y = Math.max(1.25, this.inspectWorldPos.y - 0.06);
    }

    // 更新全部 36 张牌的二阶弹簧、气动侧倾与局部磁吸 3D 光标响应
    for (const c of this.cards) {
      c.mesh.visible = !this.coarsePointer || this.mode !== 'picking' || c.isDrawn;
      const isHovered = this.hoveredCard === c;
      const isInspected = this.inspectedCard === c;
      const isPaired =
        this.mode === 'reading' &&
        c.isDrawn &&
        ((this.activePairIndices && this.activePairIndices.includes(c.drawnOrder)) ||
          this.highlightedSingleSlot === c.drawnOrder);

      if (c.dealFlash > 0.001) {
        c.dealFlash *= Math.exp(-5.5 * dt);
      }

      // 计算光标相对于本张卡牌中心的局部偏移，赋予真实单牌磁吸 3D 侧倾！
      let localMagneticRx = 0;
      let localMagneticRz = 0;
      let cardTiltShaderX = 0;
      let cardTiltShaderY = 0;

      if (isInspected && motionActive) {
        // 手持近景把玩态：大幅度灵敏跟随鼠标旋转 ±22°，尽览红宝浮雕与裸眼 3D 景深！
        localMagneticRx = 0.42 - this.smoothPointer.y * 0.36;
        localMagneticRz = -this.smoothPointer.x * 0.38;
        cardTiltShaderX = this.smoothPointer.x * 0.45;
        cardTiltShaderY = this.smoothPointer.y * 0.45;
      } else if (motionActive && !c.flight.active && (isHovered || c.targetFlipZ > 1.5)) {
        const dx = THREE.MathUtils.clamp(this.worldCursorOnTable.x - c.mesh.position.x, -1.2, 1.2);
        const dz = THREE.MathUtils.clamp(this.worldCursorOnTable.z - c.mesh.position.z, -1.2, 1.2);
        const weight = isHovered ? 0.22 : 0.085;
        // 正面朝上时 Z 翻转了 π，符号自动匹配光标压下方向
        const flipSign = c.targetFlipZ > 1.5 ? -1 : 1;
        localMagneticRx = dz * weight;
        localMagneticRz = dx * weight * flipSign;
        cardTiltShaderX = (dx / 1.2) * (isHovered ? 0.38 : 0.16);
        cardTiltShaderY = -(dz / 1.2) * (isHovered ? 0.38 : 0.16);
      }

      c.holoUniforms.uCardTilt.value.set(cardTiltShaderX, cardTiltShaderY);

      if (c.flight.active) {
        c.flight.elapsed += frameDelta;
        const rawP = Math.min(c.flight.elapsed / c.flight.duration, 1);
        const ep = cardFlightProgressCurve(rawP);

        const prevX = c.mesh.position.x;
        const prevZ = c.mesh.position.z;

        const x = THREE.MathUtils.lerp(c.flight.startPos.x, c.flight.endPos.x, ep);
        const z = THREE.MathUtils.lerp(c.flight.startPos.z, c.flight.endPos.z, ep);
        const baseLinearY = THREE.MathUtils.lerp(c.flight.startPos.y, c.flight.endPos.y, ep);
        const archLift = Math.sin(rawP * Math.PI) * (c.flight.peakY - baseLinearY);
        const y = baseLinearY + archLift;

        // 随飞行切线速度产生自然气动俯仰侧倾
        const vx = (x - prevX) / Math.max(frameDelta, 0.008);
        const vz = (z - prevZ) / Math.max(frameDelta, 0.008);
        const aeroPitch = THREE.MathUtils.clamp(vz * 0.032, -0.22, 0.22) * Math.sin(rawP * Math.PI);

        const flipEase = whipFlipCurve(rawP);
        const rz = THREE.MathUtils.lerp(c.flight.startFlip, c.flight.endFlip, flipEase);
        const ry = THREE.MathUtils.lerp(c.flight.startYaw, c.flight.endYaw, ep);
        const rx = THREE.MathUtils.lerp(0, c.targetTiltX, ep) + aeroPitch;

        c.mesh.position.set(x, y, z);
        c.mesh.rotation.set(rx, ry, rz);

        // 翻转至 90° 迎光面瞬间迸发高定镭射棱镜闪光！
        const edgeGlint = Math.sin(flipEase * Math.PI);
        c.holoUniforms.uHoloBoost.value = 0.45 + edgeGlint * 1.35;

        // 洒出流金彗尾微粒
        if (rawP > 0.08 && rawP < 0.86 && c.flight.elapsed - c.flight.lastSparkAt > 0.036) {
          c.flight.lastSparkAt = c.flight.elapsed;
          this.spawnFlightSpark(c.mesh.position);
        }

        const [nextScale, nextScaleVel] = stepSpringScalar(
          c.mesh.scale.x,
          c.targetScale,
          c.scaleVel,
          dt,
          19,
          0.82
        );
        c.scaleVel = nextScaleVel;
        c.mesh.scale.setScalar(nextScale);

        if (rawP >= 1) {
          c.flight.active = false;
          c.posVel.set(vx * 0.12, -0.35, vz * 0.12); // 将余速平滑移交给落桌弹簧，产生真实丝绒缓冲感！
          if (c.flight.spawnRipple) {
            this.spawnLandingRipple(c.flight.endPos.x, c.flight.endPos.z);
          }
        }
      } else {
        const targetBoost =
          isInspected ? 1.25 : isHovered || isPaired ? 1.0 : c.dealFlash * 0.9 + (this.mode === 'topic' ? 0.65 : 0.22);
        c.holoUniforms.uHoloBoost.value += (targetBoost - c.holoUniforms.uHoloBoost.value) * 0.16;

        const isFloatingShowcase =
          c.targetFlipZ > 1.5 && (this.mode === 'onboarding' || this.mode === 'topic' || this.mode === 'reading');
        const floatWave = isFloatingShowcase && motionActive ? Math.sin(t * 2.0 + c.index * 0.9) * 0.022 : 0;
        const extraLift = (isPaired ? 0.15 : this.mode === 'reading' && isHovered ? 0.11 : 0) + floatWave;

        const goalX = isInspected ? this.inspectWorldPos.x : c.targetPos.x;
        const goalY = isInspected ? this.inspectWorldPos.y : c.targetPos.y + extraLift;
        const goalZ = isInspected ? this.inspectWorldPos.z : c.targetPos.z;
        const goalScale = isInspected ? this.inspectScale : c.targetScale;

        if (motionActive) {
          // 二阶速度保持弹簧（带柔和气动随速侧倾！）
          const [nx, vx] = stepSpringScalar(c.mesh.position.x, goalX, c.posVel.x, dt, 16.5, 0.82);
          const [ny, vy] = stepSpringScalar(c.mesh.position.y, goalY, c.posVel.y, dt, 17.5, 0.84);
          const [nz, vz] = stepSpringScalar(c.mesh.position.z, goalZ, c.posVel.z, dt, 16.5, 0.82);
          c.posVel.set(vx, vy, vz);
          c.mesh.position.set(nx, ny, nz);

          const [ns, vs] = stepSpringScalar(c.mesh.scale.x, goalScale, c.scaleVel, dt, 19.0, 0.82);
          c.scaleVel = vs;
          c.mesh.scale.setScalar(ns);

          // 气动侧倾：卡牌横向滑行时牌身随速度自然微倾，停稳后自动回正！
          const canBank = isHovered || isInspected || c.targetFlipZ > 1.5;
          const bankZ = canBank ? THREE.MathUtils.clamp(-vx * 0.055, -0.22, 0.22) : 0;
          const bankX = canBank ? THREE.MathUtils.clamp(vz * 0.048, -0.18, 0.18) : 0;

          const goalRx = (isInspected ? 0 : c.targetTiltX) + localMagneticRx + bankX;
          const goalRy = isInspected ? 0 : c.targetYaw;
          const goalRz = c.targetFlipZ + localMagneticRz + bankZ;

          const [nrx, vrx] = stepSpringScalar(c.mesh.rotation.x, goalRx, c.rotVel.x, dt, 18.0, 0.80);
          const [nry, vry] = stepSpringScalar(c.mesh.rotation.y, goalRy, c.rotVel.y, dt, 17.0, 0.84);
          const [nrz, vrz] = stepSpringScalar(c.mesh.rotation.z, goalRz, c.rotVel.z, dt, 18.0, 0.80);
          c.rotVel.set(vrx, vry, vrz);
          c.mesh.rotation.set(nrx, nry, nrz);
        } else {
          c.mesh.position.set(goalX, goalY, goalZ);
          c.mesh.scale.setScalar(goalScale);
          c.mesh.rotation.set(
            isInspected ? 0.38 : c.targetTiltX,
            isInspected ? 0 : c.targetYaw,
            c.targetFlipZ
          );
        }
      }

      this.updateCardDetail(c);

      // 数学级零穿模地面硬约束
      const curScale = c.mesh.scale.x;
      const minSafeY =
        Math.abs(Math.sin(c.mesh.rotation.z)) * (CARD_W * 0.52 * curScale) +
        Math.abs(Math.sin(c.mesh.rotation.x)) * (CARD_H * 0.52 * curScale) +
        0.016;
      if (c.mesh.position.y < minSafeY) {
        c.mesh.position.y = minSafeY;
        if (c.posVel.y < 0) c.posVel.y = 0;
      }
    }

    // 相机采用临界阻尼二阶弹簧运镜（丝滑跟手无眩晕）
    const parallax = motionActive && !this.isTouchInput
      ? (this.mode === 'onboarding' || this.mode === 'topic' ? 0.22 : 0.10)
      : 0;
    const camGoalX = this.camTargetPos.x + this.smoothPointer.x * parallax;
    const camGoalY = this.camTargetPos.y + this.smoothPointer.y * parallax * 0.5;
    const camGoalZ = this.camTargetPos.z;

    if (motionActive) {
      const [cx, cvx] = stepSpringScalar(this.camera.position.x, camGoalX, this.camPosVel.x, dt, 8.5, 1.0);
      const [cy, cvy] = stepSpringScalar(this.camera.position.y, camGoalY, this.camPosVel.y, dt, 8.5, 1.0);
      const [cz, cvz] = stepSpringScalar(this.camera.position.z, camGoalZ, this.camPosVel.z, dt, 8.5, 1.0);
      this.camPosVel.set(cvx, cvy, cvz);
      this.camera.position.set(cx, cy, cz);

      const [lx, lvx] = stepSpringScalar(this.camCurrentLook.x, this.camTargetLook.x, this.camLookVel.x, dt, 9.5, 1.0);
      const [ly, lvy] = stepSpringScalar(this.camCurrentLook.y, this.camTargetLook.y, this.camLookVel.y, dt, 9.5, 1.0);
      const [lz, lvz] = stepSpringScalar(this.camCurrentLook.z, this.camTargetLook.z, this.camLookVel.z, dt, 9.5, 1.0);
      this.camLookVel.set(lvx, lvy, lvz);
      this.camCurrentLook.set(lx, ly, lz);
    } else {
      this.camera.position.set(camGoalX, camGoalY, camGoalZ);
      this.camCurrentLook.copy(this.camTargetLook);
    }

    this.camera.lookAt(this.camCurrentLook);
    if (!this.modalOpen) {
      if (this.backBatches) this.writeBackBatches();
      this.renderer.render(this.scene, this.camera);
    }
  }
}
