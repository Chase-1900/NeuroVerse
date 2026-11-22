import { createDemoApi } from './demo';
import { ApiError } from './errors';
import type {
  AnswerResult, Api, CollisionResult, DocumentDetail, DocumentSummary, Edge, ErrorDetail,
  Graph, ImportJob, Node, NodeCreate, Question,
} from '../types/api';

export { ApiError } from './errors';

const env = (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env;
const base = (env?.VITE_API_BASE_URL?.trim() || 'http://localhost:8000').replace(/\/+$/, '');
const sessionKey = `neuroverse:session:${base}`;
const timeoutMs = 30_000;

async function request<T>(path: string, init: RequestInit, token?: string, on401?: () => void): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/api/v1${path}`, {
      ...init, headers, signal: controller.signal, cache: 'no-store',
    });
    if (response.status === 401) on401?.();
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined) as { error?: Partial<ErrorDetail> } | undefined;
      throw new ApiError(response.status, payload?.error?.code ?? `HTTP_${response.status}`,
        payload?.error?.message ?? (response.status === 401 ? '会话已失效，请重新连接。' : `服务请求失败（${response.status}）。`));
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError(0, 'TIMEOUT', '请求超时，请稍后重试。');
    if (error instanceof ApiError) throw error;
    if (error instanceof SyntaxError) throw new ApiError(0, 'INVALID_RESPONSE', '服务响应不是有效的 JSON。');
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务，请检查网络或服务地址。');
  } finally {
    clearTimeout(timeout);
  }
}

function storedToken(): string | null {
  try { return globalThis.localStorage.getItem(sessionKey); } catch { return null; }
}

function persistToken(token: string | null): void {
  try {
    if (token === null) globalThis.localStorage.removeItem(sessionKey);
    else globalThis.localStorage.setItem(sessionKey, token);
  } catch { /* Restricted storage: keep the session in memory. */ }
}

const json = (method: 'POST' | 'PATCH', data: object): RequestInit => ({ method, body: JSON.stringify(data) });
const resource = (path: string, id: string) => `/${path}/${encodeURIComponent(id)}`;
const nodeFields = ({ title, summary, category }: Partial<NodeCreate>) => ({ title, summary, category });

type Session = { sessionToken: string };

export function createApi(demo: boolean, onUnauthorized: () => void): Api {
  if (demo) return createDemoApi();

  let session: Session | undefined;
  let connecting: Promise<Session> | undefined;
  let latestGraph: Graph | undefined;

  async function connect(): Promise<Session> {
    if (session) return session;
    if (!connecting) {
      const remembered = storedToken();
      if (remembered) return (session = { sessionToken: remembered });
      connecting = request<Session>('/sessions', json('POST', {}), undefined, onUnauthorized)
        .then((created) => {
          if (typeof created?.sessionToken !== 'string' || !created.sessionToken) {
            throw new ApiError(0, 'INVALID_RESPONSE', '服务未返回有效的会话。');
          }
          persistToken(created.sessionToken);
          return (session = created);
        }).finally(() => { connecting = undefined; });
    }
    return connecting;
  }

  function assertActive(active: Session): void {
    if (session !== active) throw new ApiError(401, 'STALE_SESSION', '会话已失效，请重新连接。');
  }

  async function call<T>(path: string, init: RequestInit = {}, accept?: (value: T) => T): Promise<T> {
    const active = await connect();
    assertActive(active);
    const result = await request<T>(path, init, active.sessionToken, () => {
      if (session !== active) return;
      session = undefined;
      latestGraph = undefined;
      if (storedToken() === active.sessionToken) persistToken(null);
      onUnauthorized();
    });
    assertActive(active);
    return accept ? accept(result) : result;
  }

  return {
    graph: () => call<Graph>('/graph', {}, (graph) => {
      if (latestGraph && graph.graphVersion < latestGraph.graphVersion) return structuredClone(latestGraph);
      latestGraph = structuredClone(graph);
      return graph;
    }),
    async documents() {
      return (await call<{ documents: DocumentSummary[] }>('/documents')).documents;
    },
    document: (id) => call<DocumentDetail>(resource('documents', id)),
    importData: (data) => call<ImportJob>('/imports', { method: 'POST', body: data }),
    job: (id) => call<ImportJob>(resource('jobs', id)),
    async createNode(data) {
      return (await call<{ node: Node }>('/nodes', json('POST', nodeFields(data)))).node;
    },
    async updateNode(id, data) {
      return (await call<{ node: Node }>(resource('nodes', id), json('PATCH', nodeFields(data)))).node;
    },
    deleteNode: (id) => call<void>(resource('nodes', id), { method: 'DELETE' }),
    collide: (nodeIds) => call<CollisionResult>('/collisions', json('POST', { nodeIds })),
    async saveIdea(id) {
      return (await call<{ node: Node; edges: Edge[] }>(`${resource('ideas', id)}/save`, json('POST', {}))).node;
    },
    question: (nodeId) => call<Question>('/tutor/questions', json('POST', { nodeId })),
    answer: (questionId, answer) => call<AnswerResult>('/tutor/answers', json('POST', { questionId, answer })),
  };
}
