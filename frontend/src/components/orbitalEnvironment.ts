import type { ForceGraph3DInstance } from '3d-force-graph';
import {
  BackSide, BufferAttribute, BufferGeometry, DirectionalLight, Group, HemisphereLight,
  LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Points, ShaderMaterial,
  SphereGeometry, SRGBColorSpace, TextureLoader, Vector2,
} from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import nebulaUrl from '../assets/universe-sky.webp';
import { DENSE_GRAPH_THRESHOLD, orbitFrame, orbitPoint, type Position, type SceneLink, type SceneNode } from '../types/graph';

const STAR_COUNT = 2200;
const RING_LIMIT = 80;
const RING_STEPS = 84;

function makeStars() {
  let seed = 7169;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const positions = new Float32Array(STAR_COUNT * 3);
  const magnitudes = new Float32Array(STAR_COUNT);
  for (let i = 0; i < STAR_COUNT; i++) {
    const y = 2 * random() - 1;
    const theta = random() * Math.PI * 2;
    const radius = 340 + random() ** 1.4 * 5100;
    const ring = Math.sqrt(1 - y * y) * radius;
    positions.set([ring * Math.cos(theta), y * radius, ring * Math.sin(theta)], i * 3);
    magnitudes[i] = random();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('magnitude', new BufferAttribute(magnitudes, 1));
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { dpr: { value: 1 } },
    vertexShader: `attribute float magnitude; uniform float dpr; varying float m;
      void main() {
        m = magnitude;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = dpr * clamp((1.1 + m * 1.8) * 1600.0 / max(1.0, -view.z), 1.2, 3.6);
      }`,
    fragmentShader: `varying float m;
      void main() {
        float glow = 1.0 - smoothstep(0.08, 0.5, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(mix(vec3(0.39,0.55,0.82), vec3(1.0,0.88,0.72), m*m), glow*(0.35+0.48*m));
        #include <colorspace_fragment>
      }`,
  });
  return new Points(geometry, material);
}

// One five-tap highlight gather, no blur pyramid or extra render targets. The
// stock composer has only a RenderPass; its new terminal pass must encode output.
function makeGlow() {
  return new ShaderPass(new ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { tDiffuse: { value: null }, stride: { value: new Vector2() } },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 stride; varying vec2 vUv;
      vec3 bright(vec2 offset) {
        vec4 c = texture2D(tDiffuse, vUv + offset * stride);
        return c.rgb * smoothstep(0.4, 1.2, max(c.r,max(c.g,c.b))) * c.a;
      }
      void main() {
        vec4 base = texture2D(tDiffuse, vUv);
        vec3 halo = bright(vec2(1,1)) + bright(vec2(-1,1)) + bright(vec2(1,-1)) + bright(vec2(-1,-1));
        gl_FragColor = vec4(base.rgb + 0.042 * halo * base.a, base.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
}

export function createOrbitalEnvironment(engine: ForceGraph3DInstance<SceneNode, SceneLink>) {
  const renderer = engine.renderer();
  const composer = engine.postProcessingComposer();
  const gl = renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const device = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  const software = /swiftshader|llvmpipe|softpipe|software|lavapipe|basic render/i.test(device);
  const glow = !software && composer.passes.length === 1 && gl.getExtension('EXT_color_buffer_float')
    ? makeGlow() : null;
  if (glow) { glow.enabled = false; composer.addPass(glow); }

  let disposed = false;
  const root = new Group();
  const stars = makeStars();
  const skyMaterial = new MeshBasicMaterial({
    side: BackSide, transparent: true, opacity: 0.3, color: 0xd5deee, depthWrite: false,
  });
  const sky = new Mesh(new SphereGeometry(49000, 40, 24), skyMaterial);
  sky.visible = false;
  const texture = new TextureLoader().load(nebulaUrl, () => { if (!disposed) sky.visible = true; });
  texture.colorSpace = SRGBColorSpace;
  skyMaterial.map = texture;
  sky.rotation.y = 0.72;
  sky.renderOrder = -100;
  stars.renderOrder = -99;

  const arcGeometry = new BufferGeometry();
  const vertices = new BufferAttribute(new Float32Array(RING_LIMIT * RING_STEPS * 6), 3);
  arcGeometry.setAttribute('position', vertices);
  arcGeometry.setDrawRange(0, 0);
  const arcs = new LineSegments(arcGeometry, new LineBasicMaterial({
    color: 0x9bd7ed, transparent: true, opacity: 0.22, depthWrite: false,
  }));
  arcs.frustumCulled = false;
  // Decorations never participate in graph hover, drag or selection.
  sky.raycast = stars.raycast = arcs.raycast = () => {};
  root.add(sky, stars, arcs);
  engine.scene().add(root);

  const previousLights = engine.lights();
  const key = new DirectionalLight(0xffead0, 2.15);
  key.position.set(-4, 6, 5);
  const rim = new DirectionalLight(0x8fbaff, 1.05);
  rim.position.set(5, 2, -4);
  const fill = new HemisphereLight(0xd5e4ff, 0x37304f, 0.95);
  const rig = [key, rim, fill];
  engine.lights(rig);

  let dense = false;
  let pixels = 0;
  function updateBudget() {
    if (glow) glow.enabled = !dense && pixels > 0 && pixels <= 2_600_000;
    stars.geometry.setDrawRange(0, dense || software ? 900 : STAR_COUNT);
  }
  function resize(width: number, height: number) {
    if (disposed) return;
    const dpr = renderer.getPixelRatio();
    stars.material.uniforms.dpr.value = dpr;
    pixels = Math.max(0, width) * Math.max(0, height) * dpr ** 2;
    glow?.uniforms.stride.value.set(2 / Math.max(width, 1), 2 / Math.max(height, 1));
    updateBudget();
  }
  resize(engine.width(), engine.height());
  return {
    resize,
    setDensity(count: number) {
      if (disposed) return;
      dense = count > DENSE_GRAPH_THRESHOLD;
      updateBudget();
    },
    setClusters(centers: ReadonlyMap<string, Position>, nodes: readonly SceneNode[]) {
      if (disposed) return;
      const rings = new Map<string, { center: Position; category: string; orbit: number }>();
      for (const { category, orbit } of nodes) {
        const center = centers.get(category);
        if (!orbit || !center || ![center.x, center.y, center.z].every(Number.isFinite)) continue;
        rings.set(`${category}\0${orbit}`, { center, category, orbit });
      }
      let index = 0;
      let used = 0;
      for (const { center, category, orbit } of rings.values()) {
        if (used++ === RING_LIMIT) break;
        const frame = orbitFrame(category);
        let previous = orbitPoint(center, frame, orbit, 0);
        for (let step = 1; step <= RING_STEPS; step++) {
          const next = orbitPoint(center, frame, orbit, (step * 2 * Math.PI) / RING_STEPS);
          // Leave a short gap per ring so orbits read as traced paths, not wireframes.
          if (step % 21 !== 0) {
            vertices.setXYZ(index++, previous.x, previous.y, previous.z);
            vertices.setXYZ(index++, next.x, next.y, next.z);
          }
          previous = next;
        }
      }
      vertices.needsUpdate = true;
      arcGeometry.setDrawRange(0, index);
    },
    tick(seconds: number) {
      if (disposed) return;
      sky.rotation.y = 0.72 + seconds * 0.0035;
      stars.rotation.y = seconds * 0.006;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      if (engine.lights() === rig) engine.lights(previousLights);
      if (glow) { composer.removePass(glow); glow.dispose(); }
      stars.geometry.dispose(); stars.material.dispose();
      arcGeometry.dispose(); arcs.material.dispose();
      sky.geometry.dispose(); skyMaterial.dispose(); texture.dispose();
      for (const light of rig) light.dispose();
    },
  };
}
