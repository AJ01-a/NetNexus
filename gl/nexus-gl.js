/* ============================================================================
   NEXUS-GL  ·  STARK-CORE WebGL layer for NetNexus
   Consolidates the old #L1 (grid) + #L2 (node lattice) + #warpfx canvases and
   augments the DOM NEXUS core with a volumetric reactor. Purely additive: if
   WebGL or this module is unavailable, the page keeps its original 2D canvases.

   Bridge contract (populated by the classic inline script after DOMContentLoaded):
     window.__NN        → the live NN state object (mx,my,pmx,pmy,t,speed,mode,low…)
     window.NEXUSGL     → API this module exposes back to the page:
                            .active, .ripple(x,y), .burst(strength), .dispose()
   ==========================================================================*/
import * as THREE from 'three';

(function () {
  'use strict';
  const canvas = document.getElementById('gl');
  if (!canvas) return;

  /* ---- feature-detect + safe renderer construction (fallback on any failure) ---- */
  let renderer;
  try {
    /* require WebGL2 — the grid shader relies on fwidth() (core in WebGL2). Anything
       older cleanly falls through to the original 2D canvases. */
    if (!document.createElement('canvas').getContext('webgl2')) return;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) { return; }
  if (!renderer) return;

  const log = (m, l) => { try { (window.__nnlog && window.__nnlog.push) ? window.__nnlog.push([m, l || 'info']) : 0; } catch (_) {} };

  /* ---- quality tier ---- */
  const coarse = matchMedia('(max-width:860px)').matches || (navigator.maxTouchPoints || 0) > 1;
  const Q = coarse
    ? { stars: 340, nodes: 34, links: false, dpr: 1.25 }
    : { stars: 1000, nodes: 64, links: true, dpr: 1.5 };

  let W = innerWidth, H = innerHeight;
  const DPR = Math.min(devicePixelRatio || 1, Q.dpr);
  renderer.setPixelRatio(DPR);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;

  const scene = new THREE.Scene();
  const FOV = 45;
  const camera = new THREE.PerspectiveCamera(FOV, W / H, 1, 8000);
  const camZ = () => (H / 2) / Math.tan((FOV / 2) * Math.PI / 180); /* z=0 plane maps 1:1 to px */
  camera.position.z = camZ();

  /* screen(px)→world helpers (z=0 plane) */
  const wx = sx => sx - W / 2;
  const wy = sy => -(sy - H / 2);

  /* accent colour per galaxy, read live from <html data-galaxy> */
  const ACC = { it: new THREE.Color(0x00e5ff), gen: new THREE.Color(0xff9d33) };
  const ACC2 = { it: new THREE.Color(0x9df4ff), gen: new THREE.Color(0xffc46b) };
  const accColor = () => ACC[document.documentElement.dataset.galaxy === 'gen' ? 'gen' : 'it'];
  const acc2Color = () => ACC2[document.documentElement.dataset.galaxy === 'gen' ? 'gen' : 'it'];

  /* ---------------------------------------------------------------- groups */
  const bgGroup = new THREE.Group();   /* parallax-drifting background */
  const fgGroup = new THREE.Group();   /* lattice + (later) core        */
  scene.add(bgGroup, fgGroup);

  /* =============================== GRID ================================== */
  const gridUniforms = {
    uTime: { value: 0 }, uAcc: { value: accColor().clone() },
    uRes: { value: new THREE.Vector2(W, H) }, uCell: { value: 92 },
    uOff: { value: new THREE.Vector2(0, 0) }
  };
  const gridMat = new THREE.ShaderMaterial({
    uniforms: gridUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vP; void main(){ vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      precision highp float; varying vec2 vP;
      uniform float uTime, uCell; uniform vec2 uRes, uOff; uniform vec3 uAcc;
      void main(){
        vec2 px = vP + uRes*0.5;                       /* 0..res */
        vec2 uv = (px + uOff) / uCell;
        vec2 g = abs(fract(uv - 0.5) - 0.5) / fwidth(uv);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        /* brighter minor pulse travelling outward */
        float d = length((px - uRes*0.5) / uRes.y);
        float vig = smoothstep(0.95, 0.15, d);
        float pulse = 0.6 + 0.4*sin(uTime*0.8 - d*6.0);
        float a = line * (0.05 + 0.05*pulse) * vig;
        gl_FragColor = vec4(uAcc, a);
      }`
  });
  let gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), gridMat);
  gridMesh.position.z = -1;
  bgGroup.add(gridMesh);

  /* =============================== STARS ================================= */
  function sprite() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.7)');
    g.addColorStop(.6, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const dot = sprite();
  const starGeo = new THREE.BufferGeometry();
  {
    const p = new Float32Array(Q.stars * 3), ph = new Float32Array(Q.stars);
    for (let i = 0; i < Q.stars; i++) {
      p[i * 3] = (Math.random() - .5) * W * 2.4;
      p[i * 3 + 1] = (Math.random() - .5) * H * 2.4;
      p[i * 3 + 2] = -200 - Math.random() * 1500;
      ph[i] = Math.random() * 6.28;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    starGeo.setAttribute('ph', new THREE.BufferAttribute(ph, 1));
  }
  const starMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uMap: { value: dot }, uAcc: { value: acc2Color().clone() }, uDpr: { value: DPR } },
    vertexShader: `
      attribute float ph; uniform float uTime, uDpr; varying float vTw;
      void main(){
        vTw = 0.5 + 0.5*sin(uTime*1.6 + ph);
        vec4 mv = modelViewMatrix*vec4(position,1.0);
        gl_PointSize = (1.4 + 2.6*vTw) * uDpr * (300.0/-mv.z);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec3 uAcc; varying float vTw;
      void main(){ vec4 t=texture2D(uMap, gl_PointCoord);
        vec3 col = mix(uAcc, vec3(1.0), 0.55);
        gl_FragColor = vec4(col, t.a*(0.25+0.75*vTw)); }`
  });
  const stars = new THREE.Points(starGeo, starMat);
  bgGroup.add(stars);

  /* ============================ NODE LATTICE ============================= */
  const N = Q.nodes;
  const nodes = Array.from({ length: N }, () => ({
    x: (Math.random() - .5) * W, y: (Math.random() - .5) * H,
    vx: (Math.random() - .5) * 22, vy: (Math.random() - .5) * 22
  }));
  const nodePos = new Float32Array(N * 3);
  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
  const nodeMat = new THREE.PointsMaterial({
    size: 3.4 * DPR, map: dot, transparent: true, depthWrite: false, opacity: .8,
    blending: THREE.AdditiveBlending, color: accColor().clone(), sizeAttenuation: false
  });
  const nodePoints = new THREE.Points(nodeGeo, nodeMat);
  nodePoints.position.z = 6; fgGroup.add(nodePoints);

  let lineGeo, lineMat, lines, linePos;
  if (Q.links) {
    const maxSeg = N * 6;
    linePos = new Float32Array(maxSeg * 2 * 3);
    lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    lineMat = new THREE.LineBasicMaterial({ color: accColor().clone(), transparent: true, opacity: .22, depthWrite: false, blending: THREE.AdditiveBlending });
    lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.position.z = 5; fgGroup.add(lines);
  }

  /* ====================== VOLUMETRIC NEXUS REACTOR ======================
     Augments (never replaces) the DOM core. Rendered behind the DOM eye at the
     core's live screen position; reacts to speaking / LISTENING state.
     Desktop-only — mobile keeps the lightweight background. */
  const coreEl = document.getElementById('corewrap');
  const micEl = document.getElementById('micbtn');
  let coreCX = W / 2, coreCY = H * .52, coreR = Math.min(W, H) * .23, hasCore = false;
  function measureCore() {
    if (!coreEl) { hasCore = false; return; }
    const r = coreEl.getBoundingClientRect();
    if (r.width < 12) { hasCore = false; return; }
    coreCX = r.left + r.width / 2; coreCY = r.top + r.height / 2; coreR = r.width / 2; hasCore = true;
  }
  measureCore();

  let reactor = null, heat = .15;
  if (!coarse) {
    reactor = new THREE.Group(); reactor.position.z = 12; scene.add(reactor);

    /* inner plasma orb (back-side Fresnel → volumetric glow around the eye) */
    const orbMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
      uniforms: { uC: { value: accColor().clone() }, uC2: { value: acc2Color().clone() }, uHeat: { value: heat }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vN,vV; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `precision highp float; varying vec3 vN,vV; uniform vec3 uC,uC2; uniform float uHeat,uTime;
        void main(){ float f=pow(1.0-max(dot(vN,vV),0.0),2.5); float p=0.65+0.35*sin(uTime*3.0);
          vec3 col=mix(uC,uC2,f*(0.5+0.5*uHeat)); float a=f*(0.32+0.5*uHeat)*(0.82+0.18*p); gl_FragColor=vec4(col,a);} `
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 40, 40), orbMat);
    reactor.add(orb);

    /* two counter-rotating icosahedral energy shells */
    const shellMat = () => new THREE.LineBasicMaterial({ color: accColor().clone(), transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending });
    const shellA = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(0.98, 1)), shellMat());
    const shellB = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.28, 1)), shellMat());
    shellB.material.opacity = .28;
    reactor.add(shellA, shellB);

    /* three thin 3D energy rings (true-3D echo of the DOM SVG rings) */
    const rings = [];
    const ringMat = new THREE.MeshBasicMaterial({ color: accColor().clone(), transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending });
    [[1.14, 0, 0], [1.36, Math.PI / 2.4, .3], [1.02, 1.1, -.5]].forEach(([rad, rx, ry]) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.008, 6, 120), ringMat.clone());
      ring.rotation.set(rx, ry, 0); rings.push(ring); reactor.add(ring);
    });

    /* orbiting particle cluster (tilted rings → swirling nucleus) */
    const PC = 320;
    const parts = new Array(PC);
    for (let i = 0; i < PC; i++) parts[i] = { r: .72 + Math.random() * .78, inc: (Math.random() - .5) * .95, ph: Math.random() * 6.28, sp: .25 + Math.random() * .6 };
    const pPos = new Float32Array(PC * 3);
    const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({ size: 2.6 * DPR, map: dot, transparent: true, depthWrite: false, opacity: .9, blending: THREE.AdditiveBlending, color: acc2Color().clone(), sizeAttenuation: false });
    const cluster = new THREE.Points(pGeo, pMat); reactor.add(cluster);

    reactor.userData = { orb, orbMat, shellA, shellB, rings, parts, pPos, pGeo, pMat, cluster, ringMat };
  }
  function updateReactor(now, dt, NN) {
    if (!reactor) return;
    if (!hasCore) measureCore();
    reactor.visible = hasCore;
    if (!hasCore) return;
    const speaking = coreEl.classList.contains('speaking');
    const listening = !!(micEl && micEl.classList.contains('live'));
    const target = listening ? 1.0 : speaking ? 0.72 : 0.15;
    heat += (target - heat) * Math.min(1, dt * 4);
    const t = now / 1000;
    const acc = accColor(), acc2 = acc2Color();
    const u = reactor.userData;

    reactor.position.set(wx(coreCX), wy(coreCY), 12);
    const breathe = 1 + Math.sin(t * (speaking ? 7 : 1.6)) * (0.015 + 0.05 * heat);
    reactor.scale.setScalar(coreR * breathe);
    /* subtle tilt echoing the DOM core's mouse tilt */
    reactor.rotation.x = (NN.pmy - .5) * -0.5;
    reactor.rotation.y = (NN.pmx - .5) * 0.5 + t * (0.05 + 0.22 * heat);

    u.orbMat.uniforms.uHeat.value = heat; u.orbMat.uniforms.uTime.value = t;
    u.orbMat.uniforms.uC.value.copy(acc); u.orbMat.uniforms.uC2.value.copy(acc2);
    u.shellA.rotation.y = t * (0.35 + 0.7 * heat); u.shellA.rotation.x = t * 0.22;
    u.shellB.rotation.y = -t * (0.28 + 0.5 * heat); u.shellB.rotation.z = t * 0.18;
    u.shellA.material.color.copy(acc); u.shellB.material.color.copy(acc);
    u.shellA.material.opacity = 0.4 + 0.4 * heat;
    u.rings.forEach((r, i) => { r.material.color.copy(acc); r.material.opacity = 0.32 + 0.4 * heat; r.rotation.z = t * (0.3 + i * 0.12) * (i % 2 ? -1 : 1); });
    u.pMat.color.copy(acc2); u.pMat.size = (2.2 + 1.4 * heat) * DPR;

    const pull = 1 - 0.22 * heat, spin = 0.5 + 2.2 * heat;
    for (let i = 0; i < u.parts.length; i++) {
      const p = u.parts[i], a = p.ph + t * p.sp * spin, rr = p.r * pull;
      u.pPos[i * 3] = Math.cos(a) * rr; u.pPos[i * 3 + 1] = p.inc * rr; u.pPos[i * 3 + 2] = Math.sin(a) * rr;
    }
    u.pGeo.attributes.position.needsUpdate = true;
  }

  /* ======================= WARP BURST (replaces #warpfx) =======================
     Radial streaks + a shock ring firing out of the core on navigation / galaxy jumps. */
  const WSTREAK = coarse ? 80 : 160;
  const warp = { active: false, t0: 0, dur: 900, parts: new Array(WSTREAK) };
  for (let i = 0; i < WSTREAK; i++) warp.parts[i] = { a: 0, r0: 0, sp: 0, len: 0 };
  const warpPos = new Float32Array(WSTREAK * 2 * 3);
  const warpGeo = new THREE.BufferGeometry(); warpGeo.setAttribute('position', new THREE.BufferAttribute(warpPos, 3));
  const warpMat = new THREE.LineBasicMaterial({ color: accColor().clone(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const warpLines = new THREE.LineSegments(warpGeo, warpMat); warpLines.visible = false; warpLines.frustumCulled = false; scene.add(warpLines);
  const ringGeo = new THREE.RingGeometry(0.92, 1.0, 96);
  const ringMatW = new THREE.MeshBasicMaterial({ color: acc2Color().clone(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const shockRing = new THREE.Mesh(ringGeo, ringMatW); shockRing.visible = false; scene.add(shockRing);
  function fireWarp(dur) {
    warp.active = true; warp.t0 = performance.now(); warp.dur = Math.max(400, dur || 900);
    for (const p of warp.parts) { p.a = Math.random() * 6.283; p.r0 = 24 + Math.random() * 90; p.sp = 700 + Math.random() * 1500; p.len = 24 + Math.random() * 120; }
    warpLines.visible = true; shockRing.visible = true;
  }
  function updateWarp(now) {
    if (!warp.active) return;
    const el = now - warp.t0, p = el / warp.dur;
    if (p >= 1) { warp.active = false; warpLines.visible = false; shockRing.visible = false; warpMat.opacity = 0; ringMatW.opacity = 0; return; }
    const cx = wx(coreCX), cy = wy(coreCY), fade = 1 - p, sec = el / 1000;
    warpMat.color.copy(accColor()); warpMat.opacity = fade * 0.9;
    for (let i = 0; i < warp.parts.length; i++) {
      const q = warp.parts[i], r = q.r0 + q.sp * sec, r2 = r + q.len * (0.4 + fade), ca = Math.cos(q.a), sa = Math.sin(q.a);
      warpPos[i * 6] = cx + ca * r; warpPos[i * 6 + 1] = cy + sa * r; warpPos[i * 6 + 2] = 16;
      warpPos[i * 6 + 3] = cx + ca * r2; warpPos[i * 6 + 4] = cy + sa * r2; warpPos[i * 6 + 5] = 16;
    }
    warpGeo.attributes.position.needsUpdate = true;
    shockRing.position.set(cx, cy, 15);
    shockRing.scale.setScalar(coreR * (0.4 + p * 4.2));
    ringMatW.color.copy(acc2Color()); ringMatW.opacity = fade * fade * 0.8;
  }

  /* ======================= POST-PROCESSING (desktop) =======================
     Compact custom composer: bright-pass → separable blur → composite with
     bloom + radial chromatic aberration + scanline + vignette + grain.
     Self-vendored (no examples/jsm tree). Disabled on mobile / under governor;
     any pass failure trips postBroken and we render straight to screen. */
  let postOn = !coarse, postBroken = false;
  const rtType = (() => { try { return renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType; } catch (e) { return THREE.UnsignedByteType; } })();
  const mkRT = (w, h, depth) => new THREE.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0),
    { type: rtType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, depthBuffer: !!depth, stencilBuffer: false });
  let bw = Math.floor(W * DPR), bh = Math.floor(H * DPR);
  let rtScene = mkRT(bw, bh, true), rtA = mkRT(bw / 2, bh / 2, false), rtB = mkRT(bw / 2, bh / 2, false);

  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsScene = new THREE.Scene();
  const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  fsQuad.frustumCulled = false; fsScene.add(fsQuad);
  const VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0);}`;
  const brightMat = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, uThresh: { value: .58 }, uKnee: { value: .38 } }, vertexShader: VS,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uThresh,uKnee;
      void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb; float l=dot(c,vec3(0.2126,0.7152,0.0722));
        gl_FragColor=vec4(c*smoothstep(uThresh,uThresh+uKnee,l),1.0);} ` });
  const blurMat = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() }, uTexel: { value: new THREE.Vector2() } }, vertexShader: VS,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uDir,uTexel;
      void main(){ float w0=0.227,w1=0.194,w2=0.121,w3=0.054,w4=0.016; vec3 s=texture2D(tDiffuse,vUv).rgb*w0;
        vec2 o1=uDir*uTexel,o2=o1*2.0,o3=o1*3.0,o4=o1*4.0;
        s+=(texture2D(tDiffuse,vUv+o1).rgb+texture2D(tDiffuse,vUv-o1).rgb)*w1;
        s+=(texture2D(tDiffuse,vUv+o2).rgb+texture2D(tDiffuse,vUv-o2).rgb)*w2;
        s+=(texture2D(tDiffuse,vUv+o3).rgb+texture2D(tDiffuse,vUv-o3).rgb)*w3;
        s+=(texture2D(tDiffuse,vUv+o4).rgb+texture2D(tDiffuse,vUv-o4).rgb)*w4;
        gl_FragColor=vec4(s,1.0);} ` });
  const compMat = new THREE.ShaderMaterial({ uniforms: {
      tScene: { value: null }, tBloom: { value: null }, uRes: { value: new THREE.Vector2(bw, bh) }, uTime: { value: 0 },
      uCA: { value: .006 }, uBloom: { value: .85 }, uScan: { value: .028 }, uVig: { value: .34 }, uGrain: { value: .025 } }, vertexShader: VS,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tScene,tBloom; uniform vec2 uRes;
      uniform float uTime,uCA,uBloom,uScan,uVig,uGrain;
      float hash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453);}
      void main(){ vec2 uv=vUv; vec2 dir=uv-0.5; float d=length(dir);
        float ca=uCA*d;
        float r=texture2D(tScene,uv-dir*ca).r;
        float g=texture2D(tScene,uv).g;
        float b=texture2D(tScene,uv+dir*ca).b;
        vec3 col=vec3(r,g,b);
        col+=texture2D(tBloom,uv).rgb*uBloom;
        col+=vec3(0.015,0.05,0.08)*smoothstep(0.85,0.0,length(uv-vec2(0.5,0.10)));
        col*=1.0-uScan*(0.5+0.5*sin((uv.y*uRes.y)*1.6));
        col*=1.0-uVig*d*d;
        col+=(hash(uv*uRes+uTime)-0.5)*uGrain;
        gl_FragColor=vec4(col,1.0);} ` });

  function blit(mat, target) { fsQuad.material = mat; renderer.setRenderTarget(target || null); renderer.render(fsScene, fsCam); }
  function present(now) {
    const usePost = postOn && !postBroken && !(window.__NN && window.__NN.low);
    if (!usePost) { renderer.setClearColor(0x000000, 0); renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
    try {
      renderer.setClearColor(0x02050a, 1);
      renderer.setRenderTarget(rtScene); renderer.clear(); renderer.render(scene, camera);
      brightMat.uniforms.tDiffuse.value = rtScene.texture; blit(brightMat, rtA);
      blurMat.uniforms.uTexel.value.set(1 / (bw / 2), 1 / (bh / 2));
      blurMat.uniforms.tDiffuse.value = rtA.texture; blurMat.uniforms.uDir.value.set(1, 0); blit(blurMat, rtB);
      blurMat.uniforms.tDiffuse.value = rtB.texture; blurMat.uniforms.uDir.value.set(0, 1); blit(blurMat, rtA);
      blurMat.uniforms.tDiffuse.value = rtA.texture; blurMat.uniforms.uDir.value.set(1.6, 0); blit(blurMat, rtB);
      blurMat.uniforms.tDiffuse.value = rtB.texture; blurMat.uniforms.uDir.value.set(0, 1.6); blit(blurMat, rtA);
      compMat.uniforms.tScene.value = rtScene.texture; compMat.uniforms.tBloom.value = rtA.texture;
      compMat.uniforms.uTime.value = now / 1000; compMat.uniforms.uRes.value.set(bw, bh);
      compMat.uniforms.uCA.value = document.documentElement.dataset.galaxy === 'gen' ? .009 : .006;
      blit(compMat, null);
    } catch (e) {
      postBroken = true; renderer.setRenderTarget(null);
      log('NEXUS-GL :: POST-FX DISABLED (' + (e && e.message || 'error') + ')', 'warn');
      renderer.setClearColor(0x000000, 0); renderer.render(scene, camera);
    }
  }

  /* ripples (kinetic shockwaves), fed from the page via API.ripple() */
  const ripples = [];

  /* =============================== API ================================== */
  const API = {
    active: true,
    ripple(sx, sy) { if (ripples.length < 24) ripples.push({ x: wx(sx), y: wy(sy), r: 6, a: 1 }); },
    burst(dur) { measureCore(); fireWarp(dur); },
    dispose() { cleanup(); }
  };
  /* guarded first render — if a shader fails to compile/link, abort to the 2D fallback
     rather than leaving an empty canvas with the old layers hidden. */
  try {
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    if (gl.getError() !== gl.NO_ERROR) throw new Error('GL error on first frame');
  } catch (e) {
    try { renderer.dispose(); } catch (_) {}
    log('NEXUS-GL :: FIRST RENDER FAILED — REVERTING TO 2D CANVASES', 'warn');
    return;
  }

  window.NEXUSGL = API;
  document.body.classList.add('gl-active');
  log('NEXUS-GL :: WEBGL LAYER ONLINE (' + (coarse ? 'LITE' : 'FULL') + ')', 'ok');

  /* =============================== RESIZE =============================== */
  function resize() {
    W = innerWidth; H = innerHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.position.z = camZ(); camera.updateProjectionMatrix();
    gridUniforms.uRes.value.set(W, H);
    gridMesh.geometry.dispose(); gridMesh.geometry = new THREE.PlaneGeometry(W, H);
    bw = Math.floor(W * DPR); bh = Math.floor(H * DPR);
    rtScene.setSize(bw, bh); rtA.setSize(Math.floor(bw / 2), Math.floor(bh / 2)); rtB.setSize(Math.floor(bw / 2), Math.floor(bh / 2));
    compMat.uniforms.uRes.value.set(bw, bh);
    measureCore();
  }
  addEventListener('resize', resize, { passive: true });

  /* =============================== LOOP ================================= */
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  let raf = 0, last = performance.now(), idle = 0, lastMx = 0, lastMy = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = clamp((now - last) / 1000, 0, .05); last = now;
    const NN = window.__NN || { mx: W / 2, my: H / 2, pmx: .5, pmy: .5, t: now / 1000, speed: 1, low: false };

    /* idle throttle: if the pointer is still and nothing is animating, halve the cadence */
    const moved = Math.abs(NN.mx - lastMx) + Math.abs(NN.my - lastMy) > 1.5;
    lastMx = NN.mx; lastMy = NN.my;
    idle = moved || ripples.length ? 0 : idle + dt;
    if (idle > 1.2 && (now & 1)) return; /* skip ~half the frames when truly idle */

    const acc = accColor(), acc2 = acc2Color();
    gridUniforms.uTime.value = now / 1000;
    gridUniforms.uAcc.value.copy(acc);
    gridUniforms.uCell.value = 92;
    const par = 26;
    gridUniforms.uOff.value.set((NN.pmx - .5) * par, (NN.pmy - .5) * par);
    starMat.uniforms.uTime.value = now / 1000;
    starMat.uniforms.uAcc.value.copy(acc2);
    nodeMat.color.copy(acc);
    if (lineMat) lineMat.color.copy(acc);

    /* parallax on the background + a whisper on the foreground */
    const gx = (NN.gx || 0), gy = (NN.gy || 0);
    bgGroup.position.set(-(NN.pmx - .5 + gx * .4) * 60, (NN.pmy - .5 + gy * .4) * 60, 0);
    fgGroup.position.set(-(NN.pmx - .5) * 18, (NN.pmy - .5) * 18, 0);

    /* advance ripples */
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]; r.r += 260 * dt; r.a -= dt * 1.05;
      if (r.a <= 0) ripples.splice(i, 1);
    }

    /* node physics — mirrors the original L2 behaviour */
    const mworldX = wx(NN.mx), mworldY = wy(NN.my);
    let seg = 0;
    for (let i = 0; i < N; i++) {
      const n = nodes[i];
      const dxm = mworldX - n.x, dym = mworldY - n.y, dm = Math.hypot(dxm, dym);
      if (dm < 190 && dm > 4) { const f = (1 - dm / 190) * 34; n.vx += dxm / dm * f * dt * 9.6; n.vy += dym / dm * f * dt * 9.6; }
      for (const rp of ripples) {
        const dxw = n.x - rp.x, dyw = n.y - rp.y, dw = Math.hypot(dxw, dyw) || 1;
        if (Math.abs(dw - rp.r) < 70) { const im = 240 * rp.a; n.vx += dxw / dw * im * dt; n.vy += dyw / dw * im * dt; }
      }
      n.vx *= .96; n.vy *= .96;
      n.x += n.vx * dt; n.y += n.vy * dt;
      const hw = W / 2 + 40, hh = H / 2 + 40;
      if (n.x < -hw) n.x = hw; if (n.x > hw) n.x = -hw;
      if (n.y < -hh) n.y = hh; if (n.y > hh) n.y = -hh;
      nodePos[i * 3] = n.x; nodePos[i * 3 + 1] = n.y; nodePos[i * 3 + 2] = 0;
    }
    nodeGeo.attributes.position.needsUpdate = true;

    if (Q.links && !NN.low) {
      const maxD = 124, max2 = maxD * maxD, cap = linePos.length / 6;
      const clear = Math.min(W, H) * 0.24, clear2 = clear * clear; /* keep the core zone clean */
      for (let i = 0; i < N && seg < cap; i++)
        for (let j = i + 1; j < N && seg < cap; j++) {
          const a = nodes[i], b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < max2) {
            const mx = (a.x + b.x) * .5, my = (a.y + b.y) * .5;
            if (mx * mx + my * my < clear2) continue; /* skip links crossing the reactor */
            linePos[seg * 6] = a.x; linePos[seg * 6 + 1] = a.y; linePos[seg * 6 + 2] = 0;
            linePos[seg * 6 + 3] = b.x; linePos[seg * 6 + 4] = b.y; linePos[seg * 6 + 5] = 0;
            seg++;
          }
        }
      lineGeo.setDrawRange(0, seg * 2);
      lineGeo.attributes.position.needsUpdate = true;
      lines.visible = true;
    } else if (lines) lines.visible = false;

    updateReactor(now, dt, NN);
    updateWarp(now);
    present(now);
  }
  raf = requestAnimationFrame(frame);

  /* =============================== CLEANUP ============================== */
  function cleanup() {
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const m = o.material; (Array.isArray(m) ? m : [m]).forEach(x => { for (const k in x) { const v = x[k]; if (v && v.isTexture) v.dispose(); } x.dispose(); }); } });
    renderer.dispose();
    document.body.classList.remove('gl-active');
    API.active = false;
  }
  addEventListener('pagehide', cleanup, { once: true });
})();
