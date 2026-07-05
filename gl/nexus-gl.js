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

  /* ripples (kinetic shockwaves), fed from the page via API.ripple() */
  const ripples = [];

  /* =============================== API ================================== */
  const API = {
    active: true,
    ripple(sx, sy) { if (ripples.length < 24) ripples.push({ x: wx(sx), y: wy(sy), r: 6, a: 1 }); },
    burst() {/* warp burst — implemented in a later step */},
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

    renderer.render(scene, camera);
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
