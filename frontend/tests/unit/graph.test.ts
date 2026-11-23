import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/graph.json';
import type { Graph } from '../../src/types/api';
import { categoryCenters, orbitDistance, orbitFrame, orbitPoint, toSceneData } from '../../src/types/graph';

const example = fixture as Graph;

describe('orbital layout', () => {
  const categories = ['网络', '数学', '设计'];
  const nodes = Array.from({ length: 30 }, (_, index) => ({
    ...example.nodes[0], id: `m${index}`, title: `点 ${index}`, category: categories[index % 3],
  }));
  const edges = nodes.slice(1).map((node, index) => ({ id: `e${index}`, source: 'm0', target: node.id, relation: '相关' }));
  const data = toSceneData({ ...example, nodes, edges }, new Map());

  it('makes the best connected node each system hub, sized by importance', () => {
    const hub = data.nodes.find((node) => node.id === 'm0')!;
    expect(hub.orbit).toBe(0);
    expect(hub.anchor).toEqual(categoryCenters(nodes).get('网络'));
    const sameSystem = data.nodes.filter((node) => node.category === '网络' && node !== hub);
    expect(sameSystem.every((node) => node.radius < hub.radius)).toBe(true);
    expect(data.nodes.every((node) => [node.x, node.y, node.z, node.radius].every(Number.isFinite))).toBe(true);
  });

  it('places satellites on shared orbit rings and keeps systems apart', () => {
    const satellites = data.nodes.filter((node) => node.orbit > 0);
    expect(satellites.every((node) => node.orbit >= orbitDistance(0))).toBe(true);
    expect(new Set(satellites.map((node) => node.orbit)).size).toBeLessThan(satellites.length);
    const centers = [...categoryCenters(nodes).values()];
    for (const [i, a] of centers.entries()) for (const b of centers.slice(i + 1)) {
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(150);
    }
  });

  it('traces each orbit symmetrically around its system centre', () => {
    const center = { x: 10, y: -4, z: 7 };
    const frame = orbitFrame('网络');
    const start = orbitPoint(center, frame, 60, 0);
    const half = orbitPoint(center, frame, 60, Math.PI);
    expect((start.x + half.x) / 2).toBeCloseTo(center.x);
    expect((start.y + half.y) / 2).toBeCloseTo(center.y);
    expect((start.z + half.z) / 2).toBeCloseTo(center.z);
  });
});

describe('toSceneData', () => {
  it('isolates renderer mutations and keeps original endpoints as IDs', () => {
    const data = toSceneData(example, new Map());
    const first = data.nodes[0];
    first.sourceRefs[0].snippet = 'renderer-local';
    first.x = 25;
    const link = data.links[0];
    link.source = first;

    expect(link.sourceId).toBe('n1');
    expect(link.targetId).toBe('n2');
    expect(example.edges[0].source).toBe('n1');
    expect(example.nodes[0].sourceRefs[0].snippet).not.toBe('renderer-local');
    expect(example.nodes[0]).not.toHaveProperty('x');
  });

  it('carries positions by ID across reorder and edits, and drops hidden links', () => {
    const prior = toSceneData(example, new Map());
    Object.assign(prior.nodes[0], { x: 12, y: 0, z: -7, fx: 12 });
    const previous = new Map(prior.nodes.map((node) => [node.id, node]));
    const edited = { ...example.nodes[0], title: 'Updated' };
    const reordered = toSceneData({ ...example, nodes: [example.nodes[1], edited] }, previous);
    expect(reordered.nodes[1]).toMatchObject({ title: 'Updated', x: 12, y: 0, z: -7, fx: 12 });
    expect(reordered.links[0].source).toBe('n1');
    expect(toSceneData({ ...example, nodes: [edited] }, previous).links).toEqual([]);
  });
});
