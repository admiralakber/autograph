import * as THREE from 'three';
import type { PointCloud } from './volume.ts';
import type { SubNode, SubConn } from '../substrate.ts';

// One rotating 3D view that shows the SAME individual two ways — the volumetric
// self-portrait (sunrise point cloud) and the phenotype network (greyscale
// nodes + connections). Toggling between them is the heart of the equivalence
// teaching: a render IS a network. Falls back (ok=false) if WebGL is missing.

const POINT_VERT = /* glsl */ `
  attribute float alpha;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uSize;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (1.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const POINT_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.06, r);
    gl_FragColor = vec4(vColor, vAlpha * soft);
  }
`;

export type SceneMode = 'cloud' | 'net';

export class CreatureScene {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private group: THREE.Group | null = null;
  private cloud: THREE.Points | null = null;
  private net: THREE.Group | null = null;
  private raf = 0;
  private mode: SceneMode = 'cloud';
  readonly ok: boolean;

  constructor(private readonly container: HTMLElement) {
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer = renderer;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
      camera.position.set(0, 0, 3.0);
      const group = new THREE.Group();
      scene.add(group);
      this.scene = scene;
      this.camera = camera;
      this.group = group;
      container.appendChild(renderer.domElement);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';
      this.resize();
      this.ok = true;
      this.loop();
    } catch {
      this.ok = false;
    }
  }

  private resize(): void {
    if (!this.renderer || !this.camera) return;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setMode(mode: SceneMode): void {
    this.mode = mode;
    if (this.cloud) this.cloud.visible = mode === 'cloud';
    if (this.net) this.net.visible = mode === 'net';
  }

  /** Show/hide the WebGL canvas (the DNA view sits over a hidden 3D stage). */
  setCanvasVisible(visible: boolean): void {
    if (this.renderer) this.renderer.domElement.style.display = visible ? 'block' : 'none';
  }

  setCloud(c: PointCloud): void {
    if (!this.group) return;
    if (this.cloud) {
      this.group.remove(this.cloud);
      this.cloud.geometry.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(c.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(c.colors, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(c.alphas, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: 26.0 } },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
      vertexColors: true,
    });
    this.cloud = new THREE.Points(geo, mat);
    this.cloud.visible = this.mode === 'cloud';
    this.group.add(this.cloud);
  }

  setNet(nodes: SubNode[], conns: SubConn[]): void {
    if (!this.group) return;
    if (this.net) {
      this.group.remove(this.net);
      this.net.traverse((o) => {
        if (o instanceof THREE.Points || o instanceof THREE.LineSegments) o.geometry.dispose();
      });
    }
    const net = new THREE.Group();

    // Connections: sign via light-vs-dark grey, magnitude via brightness/opacity.
    const segPos: number[] = [];
    const segCol: number[] = [];
    for (const c of conns) {
      const mag = Math.min(1, Math.abs(c.weight) / 3);
      const g = c.weight >= 0 ? 0.45 + 0.5 * mag : 0.34 - 0.22 * mag; // light = excite, dark = inhibit
      segPos.push(c.a.x, c.a.y, c.a.z, c.b.x, c.b.y, c.b.z);
      segCol.push(g, g, g, g, g, g);
    }
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segPos), 3));
    lgeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(segCol), 3));
    const lines = new THREE.LineSegments(
      lgeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    net.add(lines);

    // Nodes: role via greyscale value + size (in dim/small, hidden mid, out bright/large).
    const npos: number[] = [];
    const ncol: number[] = [];
    for (const n of nodes) {
      npos.push(n.x, n.y, n.z);
      const g = n.role === 'in' ? 0.5 : n.role === 'out' ? 1.0 : 0.78;
      ncol.push(g, g, g);
    }
    const ngeo = new THREE.BufferGeometry();
    ngeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(npos), 3));
    ngeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(ncol), 3));
    ngeo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(nodes.map(() => 1)), 1));
    const pts = new THREE.Points(
      ngeo,
      new THREE.ShaderMaterial({
        uniforms: { uSize: { value: 90.0 } },
        vertexShader: POINT_VERT,
        fragmentShader: POINT_FRAG,
        transparent: true,
        depthWrite: false,
        vertexColors: true,
      }),
    );
    net.add(pts);

    this.net = net;
    this.net.visible = this.mode === 'net';
    this.group.add(net);
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.renderer || !this.scene || !this.camera || !this.group) return;
    if (this.container.clientWidth !== this.renderer.domElement.width / (this.renderer.getPixelRatio())) this.resize();
    this.group.rotation.y += 0.0035;
    this.group.rotation.x = Math.sin(performance.now() * 0.0002) * 0.25;
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer?.dispose();
    if (this.renderer?.domElement.parentElement === this.container) this.container.removeChild(this.renderer.domElement);
  }
}
