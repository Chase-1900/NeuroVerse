import type { Edge, Graph, Node } from './api';

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface SceneNode extends Node, Position {
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

export function categoryCenters(nodes: readonly Node[]): Map<string, Position> {
  const categories = [...new Set(nodes.map(({ category }) => category))].sort();
  const radius = categories.length > 1 ? 36 + Math.cbrt(nodes.length) * 8 : 0;
  return new Map(categories.map((category, index) => {
    const y = 1 - 2 * (index + 0.5) / categories.length;
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const ring = radius * Math.sqrt(1 - y * y);
    return [category, { x: ring * Math.cos(angle), y: radius * y, z: ring * Math.sin(angle) }];
  }));
}

export function toSceneData(
  graph: Graph,
  previous: ReadonlyMap<string, SceneNode>,
  centers = categoryCenters(graph.nodes),
): SceneData {
  const nodes = graph.nodes.map((node): SceneNode => {
    const old = previous.get(node.id);
    const center = centers.get(node.category) ?? { x: 0, y: 0, z: 0 };
    const seed = (axis: string) => (hash(`${axis}:${node.id}`) / 0xffffffff - 0.5) * 30;
    const hasPosition = old && [old.x, old.y, old.z].every(Number.isFinite);
    return {
      ...node,
      sourceRefs: node.sourceRefs.map((source) => ({ ...source })),
      ...(hasPosition
        ? { x: old.x, y: old.y, z: old.z, fx: old.fx, fy: old.fy, fz: old.fz }
        : { x: center.x + seed('x'), y: center.y + seed('y'), z: center.z + seed('z') }),
    };
  });
  const ids = new Set(nodes.map(({ id }) => id));
  const links = graph.edges
    .filter(({ source, target }) => ids.has(source) && ids.has(target))
    .map((edge) => ({ ...edge, sourceId: edge.source, targetId: edge.target }));
  return { nodes, links };
}

export function categoryColor(node: Pick<Node, 'category' | 'kind'>): string {
  if (node.kind === 'idea') return '#e9be78';
  const palette = ['#81c5ea', '#8d9ce4', '#9e8bce', '#7ac8c2', '#90b5ed', '#a4b9dc'];
  return palette[hash(node.category) % palette.length];
}
