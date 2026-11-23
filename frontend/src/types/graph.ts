import type { Edge, Graph, Node } from './api';

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface SceneNode extends Node, Position {
  radius: number;
  anchor: Position;
  orbit: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface SceneLink extends Omit<Edge, 'source' | 'target'> {
  sourceId: string;
  targetId: string;
  source: string | SceneNode;
  target: string | SceneNode;
}

export interface SceneData {
  nodes: SceneNode[];
  links: SceneLink[];
}

export const DENSE_GRAPH_THRESHOLD = 100;
export const GROUPED_GRAPH_THRESHOLD = 250;

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  }
  return result >>> 0;
}

const RING_BASE = 48;
const RING_STEP = 27;

// Satellites fill concentric rings around their system's hub: 3, 5, 7… per ring.
function ringOf(rank: number) {
  let ring = 0;
  let start = 1;
  let capacity = 3;
  while (rank >= start + capacity) {
    start += capacity;
    ring++;
    capacity = 3 + 2 * ring;
  }
  return { ring, slot: rank - start, capacity };
}

export interface OrbitFrame {
  turn: number;
  tilt: number;
  phase: number;
}

// Every knowledge system gets its own gently tilted orbital plane.
export function orbitFrame(category: string): OrbitFrame {
  const value = hash(category);
  return {
    turn: ((value % 61) - 30) / 110,
    tilt: 0.3 + ((value >>> 8) % 38) / 100,
    phase: ((value >>> 16) % 628) / 100,
  };
}

export function orbitDistance(ring: number): number {
  return RING_BASE + RING_STEP * ring;
}

export function orbitPoint(center: Position, frame: OrbitFrame, distance: number, angle: number): Position {
  const u = distance * Math.cos(angle);
  const v = distance * 0.8 * Math.sin(angle);
  const px = u;
  const py = v * Math.cos(frame.tilt);
  const pz = v * Math.sin(frame.tilt);
  const c = Math.cos(frame.turn);
  const s = Math.sin(frame.turn);
  return { x: center.x + c * px - s * py, y: center.y + s * px + c * py, z: center.z + pz };
}

function systemExtent(count: number): number {
  return count <= 1 ? 34 : orbitDistance(ringOf(count - 1).ring) + 26;
}

export function categoryCenters(nodes: readonly Node[]): Map<string, Position> {
  const occupancy = new Map<string, number>();
  for (const node of nodes) occupancy.set(node.category, (occupancy.get(node.category) ?? 0) + 1);
  const categories = [...occupancy.keys()].sort((a, b) => occupancy.get(b)! - occupancy.get(a)! || a.localeCompare(b));
  const widest = Math.max(0, ...occupancy.values());
  const spacing = systemExtent(widest) * 1.5 + 30;
  return new Map(categories.map((category, index) => {
    if (!index) return [category, { x: 0, y: 0, z: 0 }];
    const angle = (index - 1) * 2.39996 + 0.44;
    const distance = spacing * Math.sqrt(index);
    return [category, {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance * 0.66,
      z: Math.sin(angle * 1.7 + index) * spacing * 0.42,
    }];
  }));
}

export function toSceneData(
  graph: Graph,
  previous: ReadonlyMap<string, SceneNode>,
  centers = categoryCenters(graph.nodes),
): SceneData {
  const ids = new Set(graph.nodes.map(({ id }) => id));
  const degree = new Map<string, number>();
  const groups = new Map<string, Node[]>();
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    for (const id of [edge.source, edge.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
  }
  for (const node of graph.nodes) {
    const group = groups.get(node.category) ?? [];
    group.push(node);
    groups.set(node.category, group);
  }
  const ranks = new Map<string, number>();
  for (const group of groups.values()) {
    group.sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id));
    group.forEach((node, index) => ranks.set(node.id, index));
  }
  const nodes = graph.nodes.map((node): SceneNode => {
    const old = previous.get(node.id);
    const center = centers.get(node.category) ?? { x: 0, y: 0, z: 0 };
    const rank = ranks.get(node.id)!;
    const frame = orbitFrame(node.category);
    const slot = rank ? ringOf(rank) : undefined;
    const orbit = slot ? orbitDistance(slot.ring) : 0;
    const angle = slot ? frame.phase + slot.ring * 0.83 + (slot.slot * Math.PI * 2) / slot.capacity : 0;
    const radius = 6.5 + Math.min(15, 2.8 * Math.sqrt(degree.get(node.id) ?? 0)) + (rank === 0 ? 4 : 0);
    const anchor = orbit ? orbitPoint(center, frame, orbit, angle) : { ...center };
    const hasPosition = old && [old.x, old.y, old.z].every(Number.isFinite);
    return {
      ...node, radius, anchor, orbit,
      sourceRefs: node.sourceRefs.map((source) => ({ ...source })),
      ...(hasPosition
        ? { x: old.x, y: old.y, z: old.z, fx: old.fx, fy: old.fy, fz: old.fz }
        : anchor),
    };
  });
  const links = graph.edges
    .filter(({ source, target }) => ids.has(source) && ids.has(target))
    .map((edge) => ({ ...edge, sourceId: edge.source, targetId: edge.target }));
  return { nodes, links };
}

export function categoryColor(node: Pick<Node, 'category' | 'kind'>): string {
  if (node.kind === 'idea') return '#e9be78';
  const palette = ['#9bd7ed', '#8b83c8', '#78c6bd', '#7f9ff0', '#c192bd', '#a7c7a2'];
  return palette[hash(node.category) % palette.length];
}
