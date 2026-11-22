import fixture from '../../../fixtures/graph.json';
import type {
  AnswerResult, Api, Chunk, CollisionResult, DocumentDetail, DocumentSummary, Graph,
  ImportJob, Node, NodeCreate, Question, SourceRef,
} from '../types/api';
import { ApiError } from './errors';

const storageKey = 'neuroverse:demo:v1';
const seedDate = '2026-01-01T00:00:00Z';
const clusters: { category: string; nodes: [id: string, title: string, summary: string, mastery: number][] }[] = [
  { category: '计算机网络', nodes: [
    ['net0', '互联网协议栈', '以分层协议把应用数据送到远端。', 82],
    ['net1', '拥塞控制', '根据拥塞信号调整发送速率，避免网络过载。', 34],
    ['net2', 'QUIC', '基于 UDP 的安全多路传输协议。', 22],
  ] },
  { category: '人工智能', nodes: [
    ['ai0', '机器学习', '从样本中学习规律，用于预测或决策。', 72],
    ['ai1', '注意力机制', '按相关性为输入分配权重。', 54],
    ['ai2', '向量嵌入', '以向量表示概念，使相似语义在空间中相邻。', 64],
    ['ai3', '检索增强生成', '先检索相关资料，再用它们辅助生成答案。', 36],
  ] },
  { category: '认知科学', nodes: [
    ['cog0', '记忆系统', '编码、储存与提取信息的认知过程。', 65],
    ['cog1', '工作记忆', '短时间保持并处理少量信息的系统。', 58],
    ['cog2', '间隔重复', '拉开复习间隔来增强长期记忆。', 83],
    ['cog3', '主动回忆', '不看答案，尝试从记忆中提取信息。', 77],
  ] },
  { category: '数学', nodes: [
    ['math0', '图论', '研究节点与它们之间的连接。', 62],
    ['math1', '最短路径', '寻找总成本最小的连接序列。', 44],
    ['math2', '线性代数', '研究向量空间与其中的线性变换。', 51],
    ['math3', '贝叶斯推断', '利用观测证据更新先验概率。', 26],
  ] },
  { category: '设计', nodes: [
    ['design0', '信息可视化', '通过空间、颜色和形状呈现信息结构。', 79],
    ['design1', '视觉层次', '用差异化的视觉线索引导阅读顺序。', 67],
    ['design2', '渐进披露', '先呈现关键信息，再按需展示细节。', 48],
    ['design3', '交互原型', '用低成本的交互模型验证设计假设。', 38],
  ] },
];

const crossLinks: [source: string, target: string, relation: string][] = [
  ['n1', 'net1', '使用'], ['net2', 'n2', '属于'], ['n2', 'net0', '属于'],
  ['ai3', 'ai2', '应用'], ['ai2', 'math2', '依赖'], ['ai0', 'math3', '相关'],
  ['cog2', 'cog3', '互补'], ['cog1', 'ai1', '类比'], ['cog1', 'design2', '启发'],
  ['net0', 'math1', '应用'], ['math0', 'design0', '支持'], ['design1', 'design2', '互补'],
  ['seed-idea', 'cog2', '源自'], ['seed-idea', 'math0', '源自'],
];

type DemoImport = {
  job: ImportJob;
  document: DocumentDetail;
  fingerprint: string;
  startedAt: number;
};
type DemoQuestion = { question: Question; correctAnswer: string; result?: AnswerResult };
type DemoState = {
  graph: Graph;
  archive: DocumentDetail[];
  imports: DemoImport[];
  ideas: CollisionResult[];
  questions: DemoQuestion[];
  nextId: number;
};

function seed(): DemoState {
  const fixtureGraph = structuredClone(fixture) as Graph;
  const origin = fixtureGraph.nodes[0]!;
  const source = origin.sourceRefs[0]!;
  const nodes: Node[] = [...fixtureGraph.nodes];
  const links = [...crossLinks];
  for (const { category, nodes: group } of clusters) {
    for (const [id, title, summary, mastery] of group) {
      nodes.push({ id, title, summary, category, mastery, kind: 'knowledge', sourceRefs: [], createdAt: seedDate });
      if (id !== group[0]![0]) links.push([id, group[0]![0], '相关']);
    }
  }
  nodes.push({
    id: 'seed-idea', title: '知识星图复习法', summary: '沿知识图谱的连接规划间隔复习，在每一站进行主动回忆。',
    category: '创意', kind: 'idea', mastery: 0, sourceRefs: [], createdAt: seedDate,
  });
  const edges = links.map(([source, target, relation], index) => ({
    id: `seed-edge-${index + 1}`, source, target, relation,
  }));
  return {
    graph: { ...fixtureGraph, nodes, edges: [...fixtureGraph.edges, ...edges] },
    archive: [{
      documentId: source.documentId, title: '计算机网络 · 传输层讲义（示例）', createdAt: origin.createdAt,
      chunks: [{ chunkId: source.chunkId, page: source.page, text: `${source.snippet} 它使用序号、确认和超时重传来处理数据丢失，并按序交付数据。` }],
    }],
    imports: [], ideas: [], questions: [], nextId: 1,
  };
}

function invalid(message: string): never {
  throw new ApiError(400, 'INVALID_INPUT', message);
}

function missing(resource: string): never {
  throw new ApiError(404, 'NOT_FOUND', `找不到${resource}。`);
}

function limited(message: string): never {
  throw new ApiError(413, 'LIMIT_EXCEEDED', message);
}

const take = (text: string, max: number) => Array.from(text).slice(0, max).join('');
const length = (text: string) => Array.from(text).length;
const timestamp = () => new Date().toISOString();

function fields(data: NodeCreate): NodeCreate {
  const { title, summary, category } = data;
  if (!title.trim() || length(title) > 120) invalid('标题需包含 1–120 个字符。');
  if (!category.trim() || length(category) > 80) invalid('分类需包含 1–80 个字符。');
  if (length(summary) > 1000) invalid('摘要不能超过 1,000 个字符。');
  return { title, summary, category };
}

// Local demo deduplication only, not a security or integrity check.
function fingerprint(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return `${bytes.length}:${hash >>> 0}`;
}

async function readImport(data: FormData): Promise<{ title: string; text: string; page: number | null; fingerprint: string }> {
  const files = data.getAll('file');
  const texts = data.getAll('text');
  if (files.length + texts.length !== 1) invalid('请选择一个文件或粘贴一段文本。');

  const file = files[0];
  if (file !== undefined) {
    if (typeof file === 'string' || !/\.(txt|pdf)$/i.test(file.name)) invalid('仅支持 TXT 或文本型 PDF。');
    if (file.size > 10 * 1024 * 1024) limited('文件不能超过 10 MB。');
    if (file.size === 0) invalid('文件为空。');
    if (/\.pdf$/i.test(file.name)) {
      return {
        title: `${file.name}（示例）`,
        text: 'PDF 示例占位内容：示例模式不会解析 PDF，也不会发送文件或调用模型。这里显示的是模拟切片，并非上传文件的原文。',
        page: 1, fingerprint: `pdf:${fingerprint(new Uint8Array(await file.arrayBuffer()))}`,
      };
    }
  }
  const text = typeof file === 'object' ? await file.text() : texts[0];
  if (typeof text !== 'string' || !text.trim()) invalid('请输入非空文本。');
  if (length(text) > 50_000) limited('文本不能超过 50,000 个字符。');
  return {
    title: typeof file === 'object' ? file.name : take(text.trim().split(/\r?\n/, 1)[0]!, 48),
    text, page: null, fingerprint: `text:${fingerprint(new TextEncoder().encode(text))}`,
  };
}

function chunksFor(documentId: string, text: string, page: number | null): Chunk[] {
  return (text.match(/[\s\S]{1,800}/gu) ?? []).map((text, index) => ({
    chunkId: `${documentId}-c${index + 1}`, page, text,
  }));
}

function importedTopics(document: DocumentDetail): { title: string; chunk: Chunk }[] {
  const known = ['TCP', '确认', '重传', '滑动窗口', '传输层', '拥塞控制', 'UDP', '机器学习', '注意力机制', '图论'];
  const topics = known.flatMap((title) => {
    const chunk = document.chunks.find((part) => part.text.toLowerCase().includes(title.toLowerCase()));
    return chunk ? [{ title, chunk }] : [];
  }).slice(0, 5);
  if (topics.length) return topics;
  const first = document.chunks[0]!;
  const excerpts = document.chunks.filter((chunk) => chunk.text.trim()).slice(0, 3);
  return (excerpts.length ? excerpts : [first]).map((chunk, index) => ({
    title: index === 0 ? take(document.title, 120) : `摘录：${take(chunk.text.trim(), 24)}`, chunk,
  }));
}

export function createDemoApi(): Api {
  let state = seed();
  let storageAvailable = true;

  function load(): void {
    if (!storageAvailable) return;
    try {
      const raw = globalThis.localStorage.getItem(storageKey);
      if (raw) state = JSON.parse(raw) as DemoState;
    } catch { /* Missing, restricted or damaged storage: use in-memory state. */ }
  }

  function persist(): void {
    if (!storageAvailable) return;
    try { globalThis.localStorage.setItem(storageKey, JSON.stringify(state)); }
    catch { storageAvailable = false; }
  }

  const id = (prefix: string) => `demo-${prefix}-${state.nextId++}`;
  const bump = () => { state.graph.graphVersion++; };
  const findNode = (nodeId: string) => state.graph.nodes.find((node) => node.id === nodeId) ?? missing('节点');
  const addEdge = (source: string, target: string, relation: string) => {
    if (source !== target && !state.graph.edges.some((edge) => edge.source === source && edge.target === target && edge.relation === relation)) {
      state.graph.edges.push({ id: id('edge'), source, target, relation });
    }
  };

  function completeImport(entry: DemoImport): void {
    const document = entry.document;
    state.archive.push(document);
    const nodes = importedTopics(document).map(({ title, chunk }) => {
      const source: SourceRef = {
        documentId: document.documentId, chunkId: chunk.chunkId, page: chunk.page,
        snippet: take(chunk.text.trim(), 160),
      };
      const known = state.graph.nodes.find((node) => node.kind === 'knowledge' && node.title.toLowerCase() === title.toLowerCase());
      if (known) {
        known.sourceRefs.push(source);
        return known;
      }
      const node: Node = {
        id: id('node'), title, summary: take(chunk.text.trim(), 240), category: '导入知识',
        kind: 'knowledge', mastery: 0, sourceRefs: [source], createdAt: document.createdAt,
      };
      state.graph.nodes.push(node);
      return node;
    });
    const anchor = nodes[0]!;
    for (const node of nodes.slice(1)) addEdge(node.id, anchor.id, '见于同一资料');
    bump();
    entry.job = { jobId: entry.job.jobId, status: 'succeeded', graphVersion: state.graph.graphVersion };
  }

  // Use wall time rather than timers so an in-flight job can resume after reload.
  function sync(): void {
    load();
    let changed = false;
    for (const entry of state.imports) {
      if (entry.job.status === 'succeeded' || entry.job.status === 'failed') continue;
      const elapsed = Date.now() - entry.startedAt;
      if (elapsed >= 2_200) {
        completeImport(entry);
        changed = true;
      } else if (elapsed >= 500 && entry.job.status === 'pending') {
        entry.job.status = 'running';
        changed = true;
      }
    }
    if (changed) persist();
  }

  return {
    async graph() {
      sync();
      return structuredClone(state.graph);
    },
    async documents() {
      sync();
      const summary = ({ documentId, title, createdAt }: DocumentDetail, status: ImportJob['status']): DocumentSummary => (
        { documentId, title, createdAt, status }
      );
      return [
        ...state.archive.map((document) => summary(document, 'succeeded')),
        ...state.imports.filter(({ job }) => job.status !== 'succeeded').map(({ document, job }) => summary(document, job.status)),
      ].reverse();
    },
    async document(documentId) {
      sync();
      const document = state.archive.find((entry) => entry.documentId === documentId)
        ?? state.imports.find((entry) => entry.document.documentId === documentId)?.document;
      return structuredClone(document ?? missing('资料'));
    },
    async importData(data) {
      const input = await readImport(data);
      sync();
      const existing = state.imports.find((entry) => entry.fingerprint === input.fingerprint && entry.job.status !== 'failed'
        && (input.page !== null || entry.document.chunks.map((chunk) => chunk.text).join('') === input.text));
      if (existing) return structuredClone(existing.job);
      const documentId = id('doc');
      const job: ImportJob = { jobId: id('job'), status: 'pending' };
      state.imports.push({
        job, startedAt: Date.now(), fingerprint: input.fingerprint,
        document: { documentId, title: input.title, createdAt: timestamp(), chunks: chunksFor(documentId, input.text, input.page) },
      });
      persist();
      return structuredClone(job);
    },
    async job(jobId) {
      sync();
      return structuredClone(state.imports.find((entry) => entry.job.jobId === jobId)?.job ?? missing('任务'));
    },
    async createNode(data) {
      sync();
      const node: Node = {
        ...fields(data), id: id('node'), kind: 'knowledge', mastery: 0, sourceRefs: [], createdAt: timestamp(),
      };
      state.graph.nodes.push(node);
      bump();
      persist();
      return structuredClone(node);
    },
    async updateNode(nodeId, data) {
      sync();
      const node = findNode(nodeId);
      const { title, summary, category } = data;
      if (title === undefined && summary === undefined && category === undefined) invalid('至少修改一个字段。');
      Object.assign(node, fields({ title: title ?? node.title, summary: summary ?? node.summary, category: category ?? node.category }));
      bump();
      persist();
      return structuredClone(node);
    },
    async deleteNode(nodeId) {
      sync();
      findNode(nodeId);
      state.graph.nodes = state.graph.nodes.filter((node) => node.id !== nodeId);
      state.graph.edges = state.graph.edges.filter(({ source, target }) => source !== nodeId && target !== nodeId);
      // Remove a deleted saved idea so a stale save button cannot recreate it.
      state.ideas = state.ideas.filter((idea) => idea.ideaId !== nodeId);
      bump();
      persist();
    },
    async collide([leftId, rightId]) {
      sync();
      if (leftId === rightId) invalid('请选择两个不同的节点。');
      const left = findNode(leftId);
      const right = findNode(rightId);
      const idea: CollisionResult = {
        ideaId: id('idea'), sourceNodeIds: [left.id, right.id],
        commonGround: left.category === right.category
          ? `两者都属于「${left.category}」，可从同一问题的不同侧面入手。`
          : `用「${left.title}」的方法重新理解「${right.title}」，比较两者的结构与限制。`,
        title: take(`${left.title} × ${right.title}：跨主题实验`, 120),
        description: `示例创意：把「${left.title}」和「${right.title}」放进同一个小实验，观察二者如何互相启发。`,
        action: '各列出一个关键概念，设计一项 15 分钟内可完成的验证，再记录差异。',
      };
      state.ideas.push(idea);
      persist();
      return structuredClone(idea);
    },
    async saveIdea(ideaId) {
      sync();
      const idea = state.ideas.find((entry) => entry.ideaId === ideaId) ?? missing('创意');
      const saved = state.graph.nodes.find((node) => node.id === ideaId);
      if (saved) return structuredClone(saved);
      idea.sourceNodeIds.forEach(findNode);
      const node: Node = {
        id: ideaId, title: idea.title, summary: idea.description, category: '创意', kind: 'idea',
        mastery: 0, sourceRefs: [], createdAt: timestamp(),
      };
      state.graph.nodes.push(node);
      for (const sourceId of idea.sourceNodeIds) addEdge(node.id, sourceId, '源自');
      bump();
      persist();
      return structuredClone(node);
    },
    async question(nodeId) {
      sync();
      const node = findNode(nodeId);
      const tcp = node.id === 'n1' && node.title === 'TCP';
      const question: Question = {
        questionId: id('question'), nodeId,
        question: tcp ? 'TCP 用什么机制告知发送方数据已经收到？'
          : node.summary ? `根据这条线索，写出对应的知识点名称：${take(node.summary, 160)}`
          : `写出「${node.title}」的完整名称，巩固这一知识点。`,
      };
      state.questions.push({ question, correctAnswer: tcp ? 'ACK 确认已收到数据' : node.title });
      persist();
      return structuredClone(question);
    },
    async answer(questionId, answer) {
      sync();
      const entry = state.questions.find(({ question }) => question.questionId === questionId) ?? missing('问题');
      if (!answer.trim() || length(answer) > 2_000) invalid('答案需包含 1–2,000 个字符。');
      if (entry.result) return structuredClone(entry.result);
      const node = findNode(entry.question.nodeId);
      const normalized = (value: string) => value.trim().normalize('NFKC').toLowerCase().replace(/[\s\p{P}]+/gu, '');
      const guess = normalized(answer);
      const correct = entry.question.question === 'TCP 用什么机制告知发送方数据已经收到？'
        ? /\back\b/i.test(answer) || guess.includes('确认')
        : guess !== '' && guess === normalized(entry.correctAnswer);
      const mastery = Math.max(0, Math.min(100, node.mastery + (correct ? 10 : -5)));
      const related = state.graph.edges.flatMap(({ source, target }) => (
        source === node.id ? [target] : target === node.id ? [source] : []
      ));
      const recommended = [...new Set([...related, ...state.graph.nodes.filter((item) => (
        item.category === node.category && item.id !== node.id
      )).map(({ id }) => id)])].slice(0, 3);
      entry.result = {
        correct, mastery, correctAnswer: entry.correctAnswer, reviewNodeIds: recommended,
        feedback: correct ? '示例判定：理解正确。可继续复习关联知识。' : '示例判定：未匹配参考答案。建议查看节点摘要再试。',
      };
      if (mastery !== node.mastery) {
        node.mastery = mastery;
        bump();
      }
      persist();
      return structuredClone(entry.result);
    },
  };
}
