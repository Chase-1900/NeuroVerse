import { useEffect, useRef } from 'react';
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
import { Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
import type { Graph } from '../types/api';
import {
  categoryCenters,
  categoryColor,
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
type Planet = Mesh<SphereGeometry, MeshStandardMaterial>;
// The package exposes the generic instance but types its default constructor with default data types.
const SceneEngine = ForceGraph3D as unknown as new (
  host: HTMLElement,
  options: import('3d-force-graph').ConfigOptions,
) => Engine;

function createScene(host: HTMLDivElement, initial: GraphSceneProps, callbacks: () => GraphSceneProps) {
  const canvas = document.createElement('canvas');
  const rendererConfig = { canvas, alpha: true, antialias: false };
  const origin = new Vector3();
  // three-render-objects currently publishes its scene on window during initialization.
  const debugWindow = window as Window & { scene?: unknown };
  const previousDebugScene = debugWindow.scene;
  let engine: Engine | undefined;
  let observer: ResizeObserver | undefined;
  let stopped = false;
  let nodes = new Map<string, SceneNode>();
  let centers = new Map<string, Position>();
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
    observer?.disconnect();
    canvas.removeEventListener('webglcontextlost', contextLost);
    canvas.removeEventListener('webglcontextcreationerror', creationError);
    try {
      const renderer = engine?.renderer();
      try {
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
    if (firstSize && nodes.size) {
      if (selectedId) focus(selectedId);
      else overview(0);
    }
  }

  function stylePlanet(node: SceneNode, planet: Planet) {
    const selected = node.id === selectedId;
    planet.scale.setScalar(selected ? 1.3 : 1);
    planet.material.emissiveIntensity = 0.10 + node.mastery * 0.005 + (selected ? 0.55 : 0);
  }

  function cameraOffset() {
    const target = (engine!.controls() as { target: Vector3 }).target;
    const offset = new Vector3().copy(engine!.cameraPosition()).sub(target);
    if (offset.lengthSq() < 0.01) offset.set(0, 0, 1);
    return { target, offset };
  }

  function focus(id: string) {
    const node = nodes.get(id);
    if (!engine || !node) return;
    const target = new Vector3(node.x, node.y, node.z);
    const { offset } = cameraOffset();
    const distance = 46 * Math.max(1, height / Math.max(1, width));
    engine.cameraPosition(offset.setLength(distance).add(target), target, reducedMotion ? 0 : 440);
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
    for (const { x, y, z } of nodes.values()) {
      min.set(Math.min(min.x, x), Math.min(min.y, y), Math.min(min.z, z));
      max.set(Math.max(max.x, x), Math.max(max.y, y), Math.max(max.z, z));
    }
    const center = min.clone().lerp(max, 0.5);
    const radius = min.distanceTo(max) / 2 + 12;
    const distance = Math.max(60, radius * 3 * Math.max(1, height / Math.max(1, width)));
    engine.cameraPosition(center.clone().add(new Vector3(0, 0, distance)), center, duration);
  }

  function apply(props: GraphSceneProps) {
    if (!engine || stopped) return;
    const nextSelection = props.selectedId;
    const selectionChanged = selectedId !== nextSelection;
    const previousSelection = selectedId;
    const selectionWasVisible = selectedId !== null && nodes.has(selectedId);
    const motionChanged = reducedMotion !== props.reducedMotion;
    const dataChanged = shownGraph !== props.graph;
    const wasEmpty = !nodes.size;
    selectedId = nextSelection;
    reducedMotion = props.reducedMotion;

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
      planets.clear();
      engine.graphData(data);
    }
    if (selectionChanged || dataChanged) {
      for (const id of [previousSelection, selectedId]) {
        if (id === null) continue;
        const node = nodes.get(id);
        const planet = planets.get(id);
        if (node && planet) stylePlanet(node, planet);
      }
      // Change only link styling; refresh() would recreate every mesh.
      engine.linkColor((link) => {
        if (link.sourceId === selectedId || link.targetId === selectedId) return '#a9e5fa';
        return selectedId && nodes.has(selectedId) ? 'rgba(126, 157, 195, 0.26)' : 'rgba(126, 157, 195, 0.62)';
      });
    }

    const reset = props.resetSignal !== resetSignal;
    const zoom = props.zoomSignal.step !== zoomStep;
    resetSignal = props.resetSignal;
    zoomStep = props.zoomSignal.step;
    const selectionIsVisible = selectedId !== null && nodes.has(selectedId);
    if (reset || (wasEmpty && nodes.size && !selectionIsVisible)) {
      overview(reset && !reducedMotion ? 380 : 0);
    } else if (zoom && Number.isFinite(props.zoomSignal.factor) && props.zoomSignal.factor > 0) {
      const { target, offset } = cameraOffset();
      const distance = Math.max(14, Math.min(5000, offset.length() * props.zoomSignal.factor));
      engine.cameraPosition(offset.setLength(distance).add(target), target, reducedMotion ? 0 : 160);
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
    engine.backgroundColor('rgba(5, 8, 16, 0)').showNavInfo(false)
      .linkOpacity(0.7).linkDirectionalParticles(0)
      .nodeThreeObject((node) => {
        const dense = nodes.size > DENSE_GRAPH_THRESHOLD;
        const color = categoryColor(node);
        const planet = new Mesh(
          new SphereGeometry(node.kind === 'idea' ? 5 : 4, dense ? 10 : 16, dense ? 7 : 12),
          new MeshStandardMaterial({ color, emissive: color, roughness: 0.76 }),
        );
        stylePlanet(node, planet);
        planets.set(node.id, planet);
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
      .d3Force('category', (alpha) => {
        // Stronger grouping past 250 nodes keeps categories together without hiding data.
        const strength = alpha * (nodes.size > GROUPED_GRAPH_THRESHOLD ? 0.12 : 0.055);
        for (const node of nodes.values()) {
          const center = centers.get(node.category);
          if (!center || node.fx !== undefined) continue;
          node.x += (center.x - node.x) * strength;
          node.y += (center.y - node.y) * strength;
          node.z += (center.z - node.z) * strength;
        }
      });
    resize();
    apply(initial);
    observer = new ResizeObserver(() => safely(resize));
    observer.observe(host);
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
