import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Api, DocumentDetail, DocumentSummary, Graph } from '../types/api';

type Props = { api: Api; onImport: () => void; revision: number; graph?: Graph };
const statuses: Record<DocumentSummary['status'], string> = {
  pending: '等待处理', running: '正在分析', succeeded: '已归档', failed: '导入失败',
};
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN');

export function ArchivePage({ api, onImport, revision, graph }: Props) {
  const [params] = useSearchParams();
  const documentId = params.get('document');
  const chunkId = params.get('chunk');
  const [documents, setDocuments] = useState<DocumentSummary[]>();
  const [listError, setListError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setListError('');
    void api.documents().then(items => {
      if (!disposed) setDocuments(items);
    }).catch(cause => {
      if (!disposed) setListError(cause instanceof Error ? cause.message : '无法读取档案列表。');
    }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [api, revision, retry]);

  const sourceNodes = new Map<string, string[]>();
  for (const node of graph?.nodes ?? []) {
    for (const id of new Set(node.sourceRefs.map(ref => ref.documentId))) {
      const titles = sourceNodes.get(id) ?? [];
      titles.push(node.title);
      sourceNodes.set(id, titles);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">原文与出处</p><h1 className="text-3xl font-semibold">知识档案</h1><p className="muted mt-2">回到星球背后的资料，核对知识的出处。</p></div>
        <button className="btn btn-primary" type="button" onClick={onImport}>导入知识</button>
      </header>
      <div className="grid items-start gap-4 md:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]">
        <section className="panel min-w-0 space-y-4 p-4 sm:p-5" aria-label="资料列表" aria-busy={loading}>
          <h2 className="text-lg font-semibold">已导入资料</h2>
          {loading && <p className="muted text-sm" role="status">正在加载档案…</p>}
          {listError && <div className="space-y-2" role="alert">
            <p className="error text-sm">{listError}</p>
            <button className="btn" type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}>重试加载</button>
          </div>}
          {!loading && !listError && documents?.length === 0 && <p className="muted text-sm">还没有档案。导入资料后，可在这里查看原文和来源星球。</p>}
          {documents && documents.length > 0 && <ul className="space-y-2">{documents.map(doc => {
            const current = doc.documentId === documentId;
            const titles = sourceNodes.get(doc.documentId);
            return <li key={doc.documentId}>
              <Link className={`card block space-y-1 p-3 hover:border-sky-300/50 ${current ? 'border-sky-300/50 bg-sky-300/10' : ''}`}
                aria-current={current ? 'page' : undefined} to={`/archive?${new URLSearchParams({ document: doc.documentId })}`}>
                <span className="block break-words font-medium">{doc.title}</span>
                <span className="muted block text-sm">{statuses[doc.status]} · <time dateTime={doc.createdAt}>{formatTime(doc.createdAt)}</time></span>
                {graph && <span className="muted block break-words text-sm">关联星球：{titles?.join('、') ?? '暂无'}</span>}
              </Link>
            </li>;
          })}</ul>}
        </section>
        {documentId ? <DocumentReader key={documentId} api={api} revision={revision} documentId={documentId} chunkId={chunkId} />
          : <section className="panel p-5"><h2 className="text-lg font-semibold">资料原文</h2><p className="muted mt-2">选择一份资料查看原文切片。</p></section>}
      </div>
    </div>
  );
}

function DocumentReader({ api, revision, documentId, chunkId }: { api: Api; revision: number; documentId: string; chunkId: string | null }) {
  const [detail, setDetail] = useState<DocumentDetail>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const target = useRef<HTMLElement>(null);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError('');
    void api.document(documentId).then(item => {
      if (!disposed) setDetail(item);
    }).catch(cause => {
      if (!disposed) setError(cause instanceof Error ? cause.message : '无法读取资料原文。');
    }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [api, documentId, revision, retry]);

  const hasChunk = detail?.chunks.some(chunk => chunk.chunkId === chunkId);
  useEffect(() => {
    if (!chunkId || !hasChunk) return;
    target.current?.focus({ preventScroll: true });
    target.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [chunkId, hasChunk]);

  return <section className="panel min-w-0 space-y-4 p-4 sm:p-5" aria-label="资料原文" aria-busy={loading}>
    <header><p className="eyebrow">资料原文</p><h2 className="break-words text-xl font-semibold">{detail?.title ?? '查看资料'}</h2>
      {detail && <time className="muted text-sm" dateTime={detail.createdAt}>{formatTime(detail.createdAt)}</time>}
    </header>
    {loading && <p className="muted" role="status">正在读取原文…</p>}
    {error && <div className="space-y-2"><p className="error" role="alert">{error}</p><button type="button" className="btn" disabled={loading} onClick={() => setRetry(value => value + 1)}>重试读取</button></div>}
    {detail && <>
      {chunkId && !hasChunk && <p className="muted" role="status">未找到链接指定的切片，以下为当前资料的可用原文。</p>}
      {detail.chunks.length === 0 && <p className="muted">暂无可查看的原文切片。</p>}
      {detail.chunks.map((chunk, index) => {
        const selected = chunk.chunkId === chunkId;
        return <article key={chunk.chunkId} ref={selected ? target : undefined} tabIndex={selected ? -1 : undefined}
          className={`card scroll-mt-20 p-4 ${selected ? 'border-sky-300/60 bg-sky-300/10' : ''}`}>
          <h3 className="mb-2 text-sm font-medium">切片 {index + 1}{chunk.page === null ? '' : ` · 第 ${chunk.page} 页`}{selected ? ' · 当前来源' : ''}</h3>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{chunk.text}</p>
        </article>;
      })}
    </>}
  </section>;
}
