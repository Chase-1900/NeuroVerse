import * as THREE from 'three';
import type { Node } from '../types/api';
import { categoryColor, type SceneNode } from '../types/graph';
import basaltUrl from '../assets/planet-basalt.png';
import stormUrl from '../assets/planet-storm.png';

export type PlanetState = 'selected' | 'neighbor' | 'dim' | 'normal';

// three-forcegraph recursively disposes each removed mesh. Geometry is borrowed;
// only the studio can release its buffers. Material uniforms (unlike .map) are
// not claimed by the engine's mesh cleanup.
class StudioSphere extends THREE.SphereGeometry {
  override dispose() { /* borrowed */ }
  release() { super.dispose(); }
}

function seed(key: string) {
  let n = 2166136261;
  for (let i = 0; i < key.length; i++) n = Math.imul(n ^ key.charCodeAt(i), 16777619);
  return n >>> 0;
}

const vertexShader = `
  varying vec2 st;
  varying vec3 N, V;
  void main() {
    st = uv;
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    N = normalMatrix * normal;
    V = -p.xyz;
    gl_Position = projectionMatrix * p;
  }`;

// One distant key in view space: every planet keeps the same sun direction
// without adding a light (or a shadow pass) per graph node.
const lighting = `
  varying vec2 st;
  varying vec3 N, V;
  uniform vec3 tint;
  uniform float exposure;
  const vec3 sun = vec3(-0.80, 0.54, 0.26);
`;
const surface = lighting + `
  uniform sampler2D terrain;
  uniform vec2 texel;
  void main() {
    vec3 n = normalize(N);
    float h = texture2D(terrain, st).r;
    vec2 grad = vec2(texture2D(terrain, st + vec2(texel.x,0.)).r-h,
                     texture2D(terrain, st + vec2(0.,texel.y)).r-h);
    float lambert = dot(n,sun);
    float day = smoothstep(-0.10,0.20,lambert);
    float relief = clamp(1.0 + dot(grad,vec2(0.9,-0.7)),0.78,1.22);
    vec3 minerals = mix(tint*0.24, mix(tint,vec3(1.),0.55),smoothstep(0.17,0.86,h));
    gl_FragColor = vec4(minerals * (0.047 + day*(0.12 + max(lambert,0.)*1.24)*relief)*exposure,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const atmosphere = lighting + `
  void main() {
    vec3 n = normalize(N);
    float rim = pow(1.0-clamp(abs(dot(n,normalize(V))),0.,1.),4.0);
    float lit = smoothstep(-0.35,0.8,dot(n,sun));
    gl_FragColor = vec4(mix(tint,vec3(1.),0.3),rim*(0.06+0.67*lit)*exposure);
    #include <colorspace_fragment>
  }`;

const CAPTION_SCREEN_FRACTION = 0.025;

// Pill label sized in world units; the planet group scales it, so the caller divides that back out.
function createCaption() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 72;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.raycast = () => {};
  let previous: string | undefined;
  return { sprite, setTitle(title: string) {
    if (title === previous) return;
    previous = title;
    ctx.clearRect(0, 0, 512, 72);
    ctx.font = '500 34px system-ui, "PingFang SC", sans-serif';
    const chars = Array.from(title);
    let text = chars.slice(0, 18).join('');
    let truncated = chars.length > 18;
    while (text && ctx.measureText(text + '…').width > 440) {
      text = Array.from(text).slice(0, -1).join(''); truncated = true;
    }
    text += truncated ? '…' : '';
    const width = Math.min(500, ctx.measureText(text).width + 52);
    const x = (512 - width) / 2;
    ctx.beginPath();
    ctx.roundRect(x, 6, width, 60, 30);
    ctx.fillStyle = 'rgba(8, 13, 26, 0.78)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(155, 215, 237, 0.42)'; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#eaf4ff'; ctx.fillText(text, 256, 37);
    map.needsUpdate = true;
  }, dispose() { sprite.removeFromParent(); map.dispose(); material.dispose(); } };
}

function createRingTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(139, 131, 200, 0.5)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(128, 128, 112, 0, Math.PI * 2); ctx.stroke();
  const sweep = ctx.createConicGradient(-1.2, 128, 128);
  sweep.addColorStop(0, 'rgba(206, 224, 255, 0)');
  sweep.addColorStop(0.2, 'rgba(206, 224, 255, 0.95)');
  sweep.addColorStop(0.3, 'rgba(206, 224, 255, 0)');
  ctx.strokeStyle = sweep; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(128, 128, 112, 0, Math.PI * 2); ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface PlanetParts {
  radius: number;
  mesh: THREE.Mesh;
  body: THREE.ShaderMaterial;
  rim?: THREE.ShaderMaterial;
  spin: number;
  speed: number;
  ring?: THREE.Sprite;
  caption?: ReturnType<typeof createCaption>;
}

export function createPlanetStudio() {
  const full = new StudioSphere(1, 48, 32), low = new StudioSphere(1, 20, 14);
  const loader = new THREE.TextureLoader();
  const maps = new Map<string, THREE.Texture>();
  const live = new Set<THREE.ShaderMaterial>();
  const parts = new Map<THREE.Group, PlanetParts>();
  let ringTexture: THREE.Texture | undefined;
  let stopped = false;

  function terrain(node: Pick<Node, 'category' | 'kind'>) {
    const url = node.kind === 'idea' || (seed(node.category) & 1) ? stormUrl : basaltUrl;
    let texture = maps.get(url);
    if (!texture) {
      texture = loader.load(url); texture.wrapS = THREE.RepeatWrapping;
      maps.set(url, texture);
    }
    return texture;
  }

  function material(node: SceneNode, shell: boolean) {
    const mat = new THREE.ShaderMaterial({ vertexShader, fragmentShader: shell ? atmosphere : surface,
      uniforms: { tint: { value: new THREE.Color(categoryColor(node)) }, exposure: { value: 1 },
        ...(!shell && { terrain: { value: terrain(node) }, texel: { value: new THREE.Vector2(1/768, 1/384) } }) },
      transparent: shell, depthWrite: !shell, blending: shell ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    live.add(mat);
    mat.addEventListener('dispose', () => live.delete(mat));
    return mat;
  }

  function make(node: SceneNode, radius: number, dense: boolean): THREE.Group {
    if (stopped) throw new Error('Planet studio has been disposed');
    const planet = new THREE.Group();
    const body = material(node, false);
    const mesh = new THREE.Mesh(dense ? low : full, body);
    mesh.rotation.order = 'ZYX';
    mesh.rotation.set(0, seed(node.id) * (2*Math.PI/0x100000000), ((seed(node.id+'tilt')%61)-30)*Math.PI/180);
    const spin = mesh.rotation.y;
    planet.add(mesh); planet.scale.setScalar(radius);
    const rim = dense ? undefined : material(node, true);
    if (rim) {
      const shell = new THREE.Mesh(full, rim); shell.scale.setScalar(1.026);
      shell.raycast = () => {}; planet.add(shell);
    }
    const entry: PlanetParts = { radius, mesh, body, rim, spin, speed: 0.025 + (seed(node.id + 'spin') % 40) / 1000 };
    parts.set(planet, entry);
    body.addEventListener('dispose', () => {
      parts.delete(planet);
      entry.caption?.dispose();
      entry.ring?.material.dispose();
    });
    return planet;
  }

  function style(planet: THREE.Group, node: SceneNode, state: PlanetState, labelled = false): void {
    const p = parts.get(planet);
    if (!p || stopped) return;
    const selected = state === 'selected';
    const scale = p.radius * (selected ? 1.12 : state === 'neighbor' ? 1.04 : 1);
    planet.scale.setScalar(scale);
    const exposure = selected ? 1.25 : state === 'dim' ? 0.34 : state === 'neighbor' ? 1.12 : 1;
    p.body.uniforms.exposure.value = exposure;
    p.body.uniforms.tint.value.set(categoryColor(node));
    p.body.uniforms.terrain.value = terrain(node);
    if (p.rim) { p.rim.uniforms.exposure.value = exposure; p.rim.uniforms.tint.value.copy(p.body.uniforms.tint.value); }

    if (selected) {
      ringTexture ??= createRingTexture();
      if (ringTexture && !p.ring) {
        p.ring = new THREE.Sprite(new THREE.SpriteMaterial({
          map: ringTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        p.ring.scale.setScalar(2.9);
        p.ring.raycast = () => {};
        planet.add(p.ring);
      }
    }
    if (p.ring) p.ring.visible = selected;

    const show = selected || (labelled && state !== 'dim');
    if (show && !p.caption) {
      p.caption = createCaption();
      if (p.caption) planet.add(p.caption.sprite);
    }
    if (p.caption) {
      p.caption.sprite.visible = show;
      if (show) p.caption.setTitle(node.title);
    }
  }

  // Labels hold a near-constant on-screen size, so they read in the overview and don't balloon on focus.
  function layoutLabels(camera: THREE.Vector3): void {
    if (stopped) return;
    for (const [planet, entry] of parts) {
      const sprite = entry.caption?.sprite;
      if (!sprite?.visible) continue;
      const scale = planet.scale.x;
      const pill = Math.min(60, Math.max(2, planet.position.distanceTo(camera) * CAPTION_SCREEN_FRACTION));
      const height = (pill * 72) / 60 / scale;
      sprite.scale.set((height * 512) / 72, height, 1);
      sprite.position.y = -(1 + (pill * 0.95) / scale);
    }
  }

  function tick(seconds: number): void {
    if (stopped) return;
    for (const entry of parts.values()) entry.mesh.rotation.y = entry.spin + seconds * entry.speed;
  }

  function dispose(): void {
    if (stopped) return;
    stopped = true;
    for (const entry of parts.values()) entry.caption?.dispose();
    parts.clear();
    for (const mat of live) mat.dispose();
    full.release(); low.release();
    for (const map of maps.values()) map.dispose();
    maps.clear();
    ringTexture?.dispose();
  }
  return { make, style, tick, layoutLabels, dispose };
}
