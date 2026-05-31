import * as THREE from 'three';
import type { PointCloud } from './volume.ts';

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);

// The 3-D self-portrait: the substrate's density/hue field as a slowly-rotating
// sunrise point cloud. (The phenotype and DNA are drawn as legible 2-D SVG
// networks; this view is the volumetric "what the brain draws".) ok=false if
// WebGL is unavailable, in which case the dashboard uses the 2-D slice instead.

// Denser points, sized by density, with a soft gaussian falloff and ADDITIVE
// blending: overlapping samples accumulate into a cohesive, glowing volume (a
// luminous form), not order-dependent confetti. No depth sorting needed.
const POINT_VERT = /* glsl */ `
  attribute float alpha;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uSize;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (0.55 + vAlpha) * (1.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const POINT_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uIntensity;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r2 = dot(d, d) * 4.0;
    if (r2 > 1.0) discard;
    float fall = exp(-r2 * 3.2);          // soft gaussian core
    gl_FragColor = vec4(vColor, vAlpha * fall * uIntensity);
  }
`;

// Substrate NEURON markers overlaid on the volume: crisp white dots with a dark
// rim so they read over the bright sunrise cloud (greyscale chrome over life).
const NODE_VERT = /* glsl */ `
  attribute float nsize;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = nsize * (1.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const NODE_FRAG = /* glsl */ `
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float core = smoothstep(0.62, 0.5, r);   // white fill
    float rim = smoothstep(1.0, 0.72, r);    // dark legibility ring outside the fill
    vec3 col = mix(vec3(0.04), vec3(0.97), core);
    gl_FragColor = vec4(col, max(core, rim * 0.85));
  }
`;

export class CreatureScene {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private group: THREE.Group | null = null;
  private cloud: THREE.Points | null = null;
  private nodes: THREE.Points | null = null;
  private raf = 0;
  readonly ok: boolean;

  // interaction (mouse + touch): drag to rotate, pinch / wheel to zoom
  private yaw = 0;
  private pitch = 0;
  private userPitched = false;
  private dragging = false;
  private targetDist = 3.0;
  private lastX = 0;
  private lastY = 0;
  private pinchDist = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();

  constructor(
    private readonly container: HTMLElement,
    lite = false,
  ) {
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: !lite, alpha: true, powerPreference: lite ? 'low-power' : 'high-performance' });
      renderer.setPixelRatio(Math.min(lite ? 1.5 : 2, window.devicePixelRatio || 1));
      this.renderer = renderer;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
      camera.position.set(0, 0, this.targetDist);
      const group = new THREE.Group();
      scene.add(group);
      this.scene = scene;
      this.camera = camera;
      this.group = group;
      container.appendChild(renderer.domElement);
      renderer.domElement.classList.add('ag-3dcanvas');
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';
      this.bindInput(renderer.domElement);
      this.resize();
      this.ok = true;
      this.loop();
    } catch {
      this.ok = false;
    }
  }

  /** Drag to rotate (mouse or one finger); pinch (two fingers) or wheel to zoom. */
  private bindInput(el: HTMLElement): void {
    const dist2 = (): number => {
      const p = [...this.pointers.values()];
      return p.length < 2 ? 0 : Math.hypot(p[0]!.x - p[1]!.x, p[0]!.y - p[1]!.y);
    };
    el.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      } else if (this.pointers.size === 2) {
        this.pinchDist = dist2();
      }
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size >= 2) {
        const d = dist2();
        if (this.pinchDist > 0 && d > 0) this.targetDist = clamp(this.targetDist * (this.pinchDist / d), 1.5, 6.5);
        this.pinchDist = d;
        return;
      }
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.lastX) * 0.01;
      this.pitch = clamp(this.pitch + (e.clientY - this.lastY) * 0.01, -1.3, 1.3);
      this.userPitched = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const end = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      if (this.pointers.size === 0) this.dragging = false;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.targetDist = clamp(this.targetDist + e.deltaY * 0.0016, 1.5, 6.5);
      },
      { passive: false },
    );
  }

  private resize(): void {
    if (!this.renderer || !this.camera) return;
    // size to the canvas's OWN box, so it renders correctly whether it fills the
    // whole stage (SELF-PORTRAIT) or just the top third (STACKED).
    const el = this.renderer.domElement;
    const w = el.clientWidth || this.container.clientWidth || 1;
    const h = el.clientHeight || this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Show/hide the WebGL canvas (the 2-D views sit over a hidden 3-D stage). */
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
      uniforms: { uSize: { value: 34.0 }, uIntensity: { value: 0.5 } },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });
    this.cloud = new THREE.Points(geo, mat);
    this.group.add(this.cloud);
  }

  /** Overlay the substrate's NEURONS at their real 3-D positions (inputs on the
   *  z=−1 sensor ring, hidden on the z=0 placement sheet, outputs at z=+1), so the
   *  glowing volume visibly IS a network. They rotate with the cloud, staying
   *  registered to the picture. Edges are left to the 2-D view to avoid depth
   *  clutter. `pos` = n*3 coords, `sizes` = per-node screen size. */
  setNodes(pos: Float32Array, sizes: Float32Array): void {
    if (!this.group) return;
    if (this.nodes) {
      this.group.remove(this.nodes);
      this.nodes.geometry.dispose();
      this.nodes = null;
    }
    if (pos.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('nsize', new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: NODE_VERT,
      fragmentShader: NODE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.nodes = new THREE.Points(geo, mat);
    this.group.add(this.nodes);
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.renderer || !this.scene || !this.camera || !this.group) return;
    if (this.renderer.domElement.clientWidth !== this.renderer.domElement.width / this.renderer.getPixelRatio()) this.resize();
    if (!this.dragging) this.yaw += 0.0035; // gentle auto-rotation when idle
    this.group.rotation.y = this.yaw;
    this.group.rotation.x = this.userPitched ? this.pitch : Math.sin(performance.now() * 0.0002) * 0.25;
    this.camera.position.z += (this.targetDist - this.camera.position.z) * 0.12; // smooth zoom
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer?.dispose();
    if (this.renderer?.domElement.parentElement === this.container) this.container.removeChild(this.renderer.domElement);
  }
}
