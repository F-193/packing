// Depth-buffered 3D view of unit cubes (or rounded cubes / balls while morphing), using three.js.
// One shared WebGL renderer draws every view and copies the image into each 2D canvas,
// so a page can show many figures without running out of WebGL contexts.
//
// Needs an import map that maps "three" and "three/addons/" (see the pages that use it).
// World coordinates are z-up; three.js is y-up, so (x, y, z) -> (x, z, -y).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

let shared = null;
function renderer() {
  if (!shared) {
    shared = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    shared.setClearColor(0x000000, 0);
  }
  return shared;
}

const geoCache = new Map();
function bodyGeometry(r) {
  const k = Math.max(0, Math.min(20, Math.round(r * 40)));          // r in steps of 0.025
  if (!geoCache.has(k)) {
    const rr = k / 40;
    let g;
    if (rr <= 0) g = new THREE.BoxGeometry(1, 1, 1);
    else if (rr >= 0.5) g = new THREE.SphereGeometry(0.5, 32, 18);
    else g = new RoundedBoxGeometry(1, 1, 1, 4, rr);
    geoCache.set(k, { mesh: g, edges: rr <= 0 ? new THREE.EdgesGeometry(g) : null });
  }
  return geoCache.get(k);
}
const unitEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));

export function cssv(name, fallback = '#888888') {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function axisAligned(q) {
  const [w, x, y, z] = q;
  const m = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z),
             2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
  return m.every(v => Math.abs(v) < 1e-3 || Math.abs(Math.abs(v) - 1) < 1e-3);
}

export class CubeView {
  /** canvas: a 2D <canvas>. opts: {interactive, spin, yaw, pitch, colors: () => ({axis, tilt, soft, line, prev})} */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.yaw = opts.yaw ?? 0.7;
    this.pitch = opts.pitch ?? 0.42;
    this.spin = !!opts.spin;
    this.colors = opts.colors || (() => ({ axis: cssv('--axis'), tilt: cssv('--tilt'), soft: cssv('--soft', '#d98b3a'),
                                           line: cssv('--ink', '#222'), prev: cssv('--muted', cssv('--soft', '#999')) }));
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x7f8894, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 3, 4);
    this.camera.add(key);                       // light follows the camera: consistent shading while rotating
    this.box = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85 }));
    this.prevBox = new THREE.LineSegments(unitEdges, new THREE.LineDashedMaterial({ dashSize: 0.06, gapSize: 0.06, transparent: true, opacity: 0.8 }));
    this.scene.add(this.box, this.prevBox);
    this.meshes = [];
    this.data = null;
    if (opts.interactive) this._interact();
    if (this.spin) {
      const loop = () => { if (this.spin && this.data) { this.yaw += 0.003; this.draw(); } requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
    addEventListener('resize', () => this.draw());
  }

  _interact() {
    let drag = null;
    const c = this.canvas;
    c.style.cursor = 'grab';
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY, this.yaw, this.pitch]; this.spin = false; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', e => {
      if (!drag) return;
      this.yaw = drag[2] + (e.clientX - drag[0]) * 0.01;
      this.pitch = Math.max(-1.45, Math.min(1.45, drag[3] + (e.clientY - drag[1]) * 0.01));
      this.draw();
    });
    c.addEventListener('pointerup', () => drag = null);
  }

  /** data: {centers: [[x,y,z]] relative to the container center, quats: [[w,x,y,z]], L, prev?, r?} */
  set(data) {
    this.data = data;
    const n = data.centers.length;
    while (this.meshes.length < n) {
      const m = new THREE.Mesh(bodyGeometry(0).mesh, new THREE.MeshLambertMaterial());
      const e = new THREE.LineSegments(bodyGeometry(0).edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
      m.add(e);
      this.scene.add(m);
      this.meshes.push(m);
    }
    this.meshes.forEach((m, i) => { m.visible = i < n; });
    this.draw();
  }

  draw() {
    const d = this.data;
    if (!d) return;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight || W;
    if (!W) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }

    const col = this.colors();
    const r = d.r || 0, g = bodyGeometry(r);
    d.centers.forEach((c, i) => {
      const m = this.meshes[i], q = d.quats[i];
      m.geometry = g.mesh;
      m.children[0].visible = !!g.edges;
      if (g.edges) m.children[0].geometry = g.edges;
      m.position.set(c[0], c[2], -c[1]);
      m.quaternion.set(q[1], q[3], -q[2], q[0]).normalize();
      m.material.color.set(r > 1e-3 ? col.soft : axisAligned(q) ? col.axis : col.tilt);
    });
    this.box.scale.setScalar(d.L);
    this.box.material.color.set(col.line);
    this.prevBox.visible = !!d.prev && Math.abs(d.prev - d.L) > 1e-6;
    if (this.prevBox.visible) {
      this.prevBox.scale.setScalar(d.prev);
      this.prevBox.computeLineDistances();
      this.prevBox.material.color.set(col.prev);
    }

    const span = Math.max(d.L, d.prev || 0) * 0.93;   // half-diagonal of the box, with margin
    const aspect = W / H;
    this.camera.left = -span * aspect; this.camera.right = span * aspect;
    this.camera.top = span; this.camera.bottom = -span;
    this.camera.updateProjectionMatrix();
    const R = 20, cp = Math.cos(this.pitch);
    this.camera.position.set(R * cp * Math.sin(this.yaw), R * Math.sin(this.pitch), R * cp * Math.cos(this.yaw));
    this.camera.lookAt(0, 0, 0);

    const gl = renderer();
    gl.setPixelRatio(1);
    gl.setSize(pw, ph, false);
    gl.render(this.scene, this.camera);
    this.ctx.clearRect(0, 0, pw, ph);
    this.ctx.drawImage(gl.domElement, 0, 0, pw, ph);
  }
}
