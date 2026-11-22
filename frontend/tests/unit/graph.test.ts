import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/graph.json';
import type { Graph } from '../../src/types/api';
import { toSceneData } from '../../src/types/graph';

const example = fixture as Graph;

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
