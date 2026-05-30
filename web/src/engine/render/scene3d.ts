import * as THREE from 'three';
import type { PointCloud } from './volume.ts';

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

export class CreatureScene {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private group: THREE.Group | null = null;
  private cloud: THREE.Points | null = null;
  private raf = 0;
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

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.renderer || !this.scene || !this.camera || !this.group) return;
    if (this.container.clientWidth !== this.renderer.domElement.width / this.renderer.getPixelRatio()) this.resize();
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
