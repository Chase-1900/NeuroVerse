export interface SourceRef {
  documentId: string;
  chunkId: string;
  page: number | null;
  snippet: string;
}

export interface NodeCreate {
  title: string;
  summary: string;
  category: string;
}

export interface Node extends NodeCreate {
  id: string;
  kind: 'knowledge' | 'idea';
  mastery: number;
  sourceRefs: SourceRef[];
  createdAt: string;
}

export interface Edge {
  id: string;
  source: string;
  target: string;
  relation: string;
}

export interface Graph {
  nodes: Node[];
  edges: Edge[];
  graphVersion: number;
}

export interface ErrorDetail {
  code: string;
  message: string;
}

export type ImportStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface ImportJob {
  jobId: string;
  status: ImportStatus;
  error?: ErrorDetail;
  graphVersion?: number;
}

export interface DocumentSummary {
  documentId: string;
  title: string;
  createdAt: string;
  status: ImportStatus;
}

export interface Chunk {
  chunkId: string;
  page: number | null;
  text: string;
}

export interface DocumentDetail {
  documentId: string;
  title: string;
  createdAt: string;
  chunks: Chunk[];
}

export interface CollisionResult {
  ideaId: string;
  commonGround: string;
  title: string;
  description: string;
  action: string;
  sourceNodeIds: [string, string];
}

export interface Question {
  questionId: string;
  nodeId: string;
  question: string;
}

export interface AnswerResult {
  correct: boolean;
  feedback: string;
  correctAnswer: string;
  mastery: number;
  reviewNodeIds: string[];
}

export interface Api {
  graph(): Promise<Graph>;
  documents(): Promise<DocumentSummary[]>;
  document(id: string): Promise<DocumentDetail>;
  importData(data: FormData): Promise<ImportJob>;
  job(id: string): Promise<ImportJob>;
  createNode(data: NodeCreate): Promise<Node>;
  updateNode(id: string, data: Partial<NodeCreate>): Promise<Node>;
  deleteNode(id: string): Promise<void>;
  collide(nodeIds: [string, string]): Promise<CollisionResult>;
  saveIdea(id: string): Promise<Node>;
  question(nodeId: string): Promise<Question>;
  answer(questionId: string, answer: string): Promise<AnswerResult>;
}
