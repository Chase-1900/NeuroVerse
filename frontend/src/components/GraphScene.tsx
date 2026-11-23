import { useEffect, useRef } from 'react';
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
import { Group, type PerspectiveCamera, Vector3 } from 'three';
import { createPlanetStudio, type PlanetState } from './planetVisuals';
import { createOrbitalEnvironment } from './orbitalEnvironment';
import type { Graph } from '../types/api';
import {
  categoryCenters,
  DENSE_GRAPH_THRESHOLD,
  GROUPED_GRAPH_THRESHOLD,
  toSceneData,
  type Position,
  type SceneLink,
  type SceneNode,
} from '../types/graph';

interface GraphSceneProps {
  graph: Graph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUnavailable: () => void;
  resetSignal: number;
  zoomSignal: { step: number; factor: number };
  reducedMotion: boolean;
}

type Engine = ForceGraph3DInstance<SceneNode, SceneLink>;
type Planet = Group;
interface OrbitControlsLike {
  target: Vector3;
  enableDamping: boolean;
  dampingFactor: number;
  rotateSpeed: number;
  zoomSpeed: number;
  minDistance: number;
  maxDistance: number;
}
// The package exposes the generic instance but types its default constructor with default data types.
const SceneEngine = ForceGraph3D as unknown as new (
  host: HTMLElement,
  options: import('3d-force-graph').ConfigOptions,
) => Engine;

const LABEL_ALL_LIMIT = 8;
const MAX_PIXEL_RATIO = 1.5;

function createScene(host: HTMLDivElement, initial: GraphSceneProps, callbacks: () => GraphSceneProps) {
  const canvas = document.createElement('canvas');
  const rendererConfig = { canvas, alpha: true, antialias: false, powerPreference: 'high-performance' as const };
  const origin = new Vector3();
  // three-render-objects currently publishes its scene on window during initialization.
  const debugWindow = window as Window & { scene?: unknown };
  const previousDebugScene = debugWindow.scene;
  let engine: Engine | undefined;
  let studio: ReturnType<typeof createPlanetStudio> | undefined;
  let environment: ReturnType<typeof createOrbitalEnvironment> | undefined;
  let observer: ResizeObserver | undefined;
  let frame = 0;
  let stopped = false;
  let nodes = new Map<string, SceneNode>();
  let linkCount = 0;
  let centers = new Map<string, Position>();
  let neighbors = new Map<string, Set<string>>();
  const planets = new Map<string, Planet>();
  let selectedId: string | null = null;
  let reducedMotion = initial.reducedMotion;
  let shownGraph: Graph | undefined;
  let resetSignal = initial.resetSignal;
  let zoomStep = initial.zoomSignal.step;
  let width = 0;
  let height = 0;

  function dispose() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    canvas.removeEventListener('webglcontextlost', contextLost);
    canvas.removeEventListener('webglcontextcreationerror', creationError);
    try {
      const renderer = engine?.renderer();
      try {
        environment?.dispose();
        studio?.dispose();
        engine?.enableNodeDrag(false)._destructor();
      } finally {
        renderer?.forceContextLoss();
      }
    } finally {
      planets.clear();
      nodes.clear();
      host.replaceChildren();
    }
  }

  function unavailable() {
    if (stopped) return;
    try {
      dispose();
    } finally {
      callbacks().onUnavailable();
    }
  }

  function contextLost(event: Event) {
    event.preventDefault();
    unavailable();
  }

  function resize() {
    if (!engine || stopped) return;
    const nextWidth = host.clientWidth;
    const nextHeight = host.clientHeight;
    if (!nextWidth || !nextHeight || (width === nextWidth && height === nextHeight)) return;
    const firstSize = width === 0;
    width = nextWidth;
    height = nextHeight;
    engine.width(width).height(height);
    environment?.resize(width, height);
    if (firstSize && nodes.size) {
      if (selectedId) focus(selectedId);
      else overview(0);
    }
  }

  function planetState(id: string): PlanetState {
    if (!selectedId || !nodes.has(selectedId)) return 'normal';
    if (id === selectedId) return 'selected';
    return neighbors.get(selectedId)?.has(id) ? 'neighbor' : 'dim';
  }

  function stylePlanet(node: SceneNode, planet: Planet) {
    const state = planetState(node.id);
    const dense = nodes.size > DENSE_GRAPH_THRESHOLD;
    const labelled = !dense && (nodes.size <= LABEL_ALL_LIMIT || node.orbit === 0 || state === 'neighbor');
    studio?.style(planet, node, state, labelled);
  }

  function styleAll() {
    for (const [id, planet] of planets) {
      const node = nodes.get(id);
      if (node) stylePlanet(node, planet);
    }
  }

  function linkTouchesSelection(link: SceneLink) {
    return selectedId !== null && (link.sourceId === selectedId || link.targetId === selectedId);
  }

  function styleLinks() {
    if (!engine) return;
    const hasSelection = selectedId !== null && nodes.has(selectedId);
    // Thin the web as graphs grow so relationships stay legible.
    const alpha = linkCount <= 40 ? 0.36 : linkCount <= 100 ? 0.24 : 0.14;
    engine
      .linkColor((link) => {
        if (linkTouchesSelection(link)) return 'rgba(196, 234, 250, 0.9)';
        const crossing = nodes.get(link.sourceId)?.category !== nodes.get(link.targetId)?.category;
        if (hasSelection) return 'rgba(126, 157, 195, 0.06)';
        return crossing ? `rgba(139, 131, 200, ${alpha})` : `rgba(155, 215, 237, ${alpha})`;
      })
      .linkDirectionalParticles((link) => (!reducedMotion && hasSelection && linkTouchesSelection(link) ? 2 : 0));
  }

  function cameraOffset() {
    const target = (engine!.controls() as OrbitControlsLike).target;
    const offset = new Vector3().copy(engine!.cameraPosition()).sub(target);
    if (offset.lengthSq() < 0.01) offset.set(0, 0, 1);
    return { target, offset };
  }

  function focus(id: string) {
    const node = nodes.get(id);
    if (!engine || !node) return;
    const target = new Vector3(node.x, node.y, node.z);
    const { offset } = cameraOffset();
    // Frame the planet with its neighbours in view, whatever its size.
    const distance = Math.max(70, node.radius * 6.5 + 46) * Math.max(1, height / Math.max(1, width));
    offset.y = Math.max(offset.y, offset.length() * 0.18);
    const lookAt = target.clone();
    lookAt.x -= distance * 0.12;
    engine.cameraPosition(offset.setLength(distance).add(lookAt), lookAt, reducedMotion ? 0 : 1100);
  }

  function overview(duration: number) {
    if (!engine) return;
    if (!nodes.size) {
      engine.cameraPosition({ x: 0, y: 0, z: 100 }, origin, duration);
      return;
    }
    // Fit from simulation coordinates, including before the first engine frame.
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const { x, y, z, radius } of nodes.values()) {
      min.set(Math.min(min.x, x - radius), Math.min(min.y, y - radius), Math.min(min.z, z - radius));
      max.set(Math.max(max.x, x + radius), Math.max(max.y, y + radius), Math.max(max.z, z + radius));
    }
    const center = min.clone().lerp(max, 0.5);
    const size = max.clone().sub(min);
    // The floating panels hide the outer strips; fit the systems into the open middle.
    const openWidth = Math.max(320, width - 330);
    const tan = Math.tan((engine.camera() as PerspectiveCamera).fov * Math.PI / 360);
    const fitHeight = size.y / 2 / tan;
    const fitWidth = size.x / 2 / (tan * (openWidth / Math.max(1, height)));
    const distance = Math.max(110, Math.max(fitHeight, fitWidth) * 1.08 + size.z * 0.35);
    center.x -= (distance * tan * (width / Math.max(1, height))) * 0.12;
    engine.cameraPosition(center.clone().add(new Vector3(0, distance * 0.2, distance)), center, duration);
  }

  function apply(props: GraphSceneProps) {
    if (!engine || stopped) return;
    const nextSelection = props.selectedId;
    const selectionChanged = selectedId !== nextSelection;
    const selectionWasVisible = selectedId !== null && nodes.has(selectedId);
    const motionChanged = reducedMotion !== props.reducedMotion;
    const dataChanged = shownGraph !== props.graph;
    const wasEmpty = !nodes.size;
    selectedId = nextSelection;
    reducedMotion = props.reducedMotion;

    if (motionChanged) {
      (engine.controls() as OrbitControlsLike).enableDamping = !reducedMotion;
    }
    if (dataChanged || motionChanged) {
      const dense = props.graph.nodes.length > DENSE_GRAPH_THRESHOLD;
      engine.warmupTicks(reducedMotion ? (dense ? 20 : 35) : 0)
        .cooldownTicks(reducedMotion ? 0 : dense ? 65 : 110);
    }
    if (dataChanged) {
      shownGraph = props.graph;
      centers = categoryCenters(props.graph.nodes);
      const data = toSceneData(props.graph, nodes, centers);
      nodes = new Map(data.nodes.map((node) => [node.id, node]));
      linkCount = data.links.length;
      neighbors = new Map();
      for (const link of data.links) {
        for (const [from, to] of [[link.sourceId, link.targetId], [link.targetId, link.sourceId]]) {
          const set = neighbors.get(from) ?? new Set<string>();
          set.add(to);
          neighbors.set(from, set);
        }
      }
      planets.clear();
      environment?.setDensity(nodes.size);
      environment?.setClusters(centers, data.nodes);
      engine.graphData(data);
    }
    if (selectionChanged || dataChanged || motionChanged) {
      styleAll();
      styleLinks();
    }

    const reset = props.resetSignal !== resetSignal;
    const zoom = props.zoomSignal.step !== zoomStep;
    resetSignal = props.resetSignal;
    zoomStep = props.zoomSignal.step;
    const selectionIsVisible = selectedId !== null && nodes.has(selectedId);
    if (reset || (wasEmpty && nodes.size && !selectionIsVisible)) {
      overview(reset && !reducedMotion ? 900 : 0);
    } else if (zoom && Number.isFinite(props.zoomSignal.factor) && props.zoomSignal.factor > 0) {
      const { target, offset } = cameraOffset();
      const distance = Math.max(14, Math.min(5000, offset.length() * props.zoomSignal.factor));
      engine.cameraPosition(offset.setLength(distance).add(target), target, reducedMotion ? 0 : 320);
    } else if (selectedId && selectionIsVisible && (selectionChanged || !selectionWasVisible)) {
      focus(selectedId);
    } else if (motionChanged && reducedMotion) {
      const { target } = cameraOffset();
      engine.cameraPosition(engine.cameraPosition(), target, 0);
    }
  }

  function safely(action: () => void) {
    try {
      action();
    } catch {
      unavailable();
    }
  }

  function loop(now: number) {
    if (stopped) return;
    frame = requestAnimationFrame(loop);
    studio?.layoutLabels(engine!.camera().position);
    if (reducedMotion) return;
    const seconds = now / 1000;
    studio?.tick(seconds);
    environment?.tick(seconds);
  }

  canvas.addEventListener('webglcontextlost', contextLost);
  // A failed WebGL constructor throws synchronously; don't dispose mid-constructor.
  const creationError = () => queueMicrotask(unavailable);
  canvas.addEventListener('webglcontextcreationerror', creationError, { once: true });
  safely(() => {
    engine = new SceneEngine(host, { controlType: 'orbit', rendererConfig });
    if (debugWindow.scene === engine.scene()) {
      if (previousDebugScene === undefined) delete debugWindow.scene;
      else debugWindow.scene = previousDebugScene;
    }
    engine.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    const controls = engine.controls() as OrbitControlsLike;
    Object.assign(controls, {
      enableDamping: !reducedMotion, dampingFactor: 0.07, rotateSpeed: 0.55, zoomSpeed: 0.8,
      minDistance: 14, maxDistance: 4000,
    });
    studio = createPlanetStudio();
    environment = createOrbitalEnvironment(engine);
    engine.backgroundColor('rgba(5, 8, 16, 0)').showNavInfo(false)
      .linkOpacity(1).linkWidth(0)
      .linkCurvature((link) => (nodes.get(link.sourceId)?.category === nodes.get(link.targetId)?.category ? 0 : 0.17))
      .linkDirectionalParticles(0).linkDirectionalParticleSpeed(0.0055)
      .linkDirectionalParticleWidth(0.9).linkDirectionalParticleColor(() => '#d5f0fb')
      .nodeThreeObject((node) => {
        const planet = studio!.make(node, node.radius, nodes.size > DENSE_GRAPH_THRESHOLD);
        planets.set(node.id, planet);
        stylePlanet(node, planet);
        return planet;
      })
      .nodeLabel((node) => {
        // The engine throttles hover raycasts; only show selected labels in dense graphs.
        if (nodes.size > DENSE_GRAPH_THRESHOLD && node.id !== selectedId) return '';
        const label = document.createElement('span');
        label.textContent = node.title;
        return label;
      })
      .linkLabel('')
      .showPointerCursor((item) => item != null && 'title' in item)
      .onNodeClick((node) => {
        if (stopped || !nodes.has(node.id)) return;
        if (node.id === selectedId) safely(() => focus(node.id));
        callbacks().onSelect(node.id);
      })
      .onBackgroundClick(() => {
        if (!stopped) callbacks().onSelect(null);
      })
      .onNodeDragEnd((node) => {
        node.fx = node.x;
        node.fy = node.y;
        node.fz = node.z;
      })
      .d3Force('anchor', (alpha: number) => {
        // Pull each planet toward its orbital slot; links only draw, they no longer drag systems together.
        const strength = Math.min(1, alpha * (nodes.size > GROUPED_GRAPH_THRESHOLD ? 0.5 : 0.32));
        for (const node of nodes.values()) {
          if (node.fx !== undefined) continue;
          node.x += (node.anchor.x - node.x) * strength;
          node.y += (node.anchor.y - node.y) * strength;
          node.z += (node.anchor.z - node.z) * strength;
        }
      });
    // The default centering force would shift every planet off the orbit rings drawn at their anchors.
    engine.d3Force('center', null);
    engine.d3Force('charge')?.strength(-10);
    engine.d3Force('link')?.strength(0);
    resize();
    apply(initial);
    observer = new ResizeObserver(() => safely(resize));
    observer.observe(host);
    frame = requestAnimationFrame(loop);
  });

  return {
    update: (props: GraphSceneProps) => safely(() => apply(props)),
    dispose,
  };
}

export function GraphScene({ graph, selectedId, onSelect, onUnavailable, resetSignal, zoomSignal, reducedMotion }: GraphSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createScene> | null>(null);
  const latest = useRef<GraphSceneProps>({ graph, selectedId, onSelect, onUnavailable, resetSignal, zoomSignal, reducedMotion });

  useEffect(() => {
    latest.current = { graph, selectedId, onSelect, onUnavailable, resetSignal, zoomSignal, reducedMotion };
    scene.current?.update(latest.current);
  }, [graph, selectedId, onSelect, onUnavailable, resetSignal, zoomSignal, reducedMotion]);

  useEffect(() => {
    if (!host.current) return;
    const instance = createScene(host.current, latest.current, () => latest.current);
    scene.current = instance;
    return () => {
      scene.current = null;
      instance.dispose();
    };
  }, []);

  return <div ref={host} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />;
}
