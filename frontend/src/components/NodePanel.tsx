import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Api, Graph, Node, NodeCreate } from '../types/api';

type Props = { node: Node; graph: Graph; api: Api; onChanged: () => Promise<void>; onClose: () => void };

export function NodePanel(props: Props) {
  return <NodeDetails key={props.node.id} {...props} />;
}

function NodeDetails({ node, graph, api, onChanged, onClose }: Props) {
  const heading = useId();
  const confirmHeading = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<{ title: string; summary: string; category: string }>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [saved, setSaved] = useState<Node>();
  const selected = needsRefresh && saved ? saved : node;
  const neighbors = graph.edges.filter(edge => edge.source === node.id || edge.target === node.id);
  const nodeById = new Map(graph.nodes.map(item => [item.id, item]));

  useLayoutEffect(() => {
    if (!confirming) return;
    const element = dialog.current;
    const previous = deleteButton.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [confirming]);

  async function refresh() {
    try {
      await onChanged();
      setNeedsRefresh(false);
    } catch {
      setNeedsRefresh(true);
      setError('更改已保存，但图谱刷新失败。请重试刷新，无需重复操作。');
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy || needsRefresh) return;
    setError('');
    setNotice('');
    const title = draft.title.trim();
    const category = draft.category.trim();
    const summary = draft.summary.trim();
    if (!title || !category || [...title].length > 120 || [...category].length > 80 || [...summary].length > 1000) {
      setError('请输入标题和分类，并检查各字段的字数限制。');
      return;
    }
    const patch: Partial<NodeCreate> = {};
    if (title !== node.title) patch.title = title;
    if (category !== node.category) patch.category = category;
    if (summary !== node.summary) patch.summary = summary;
    if (!Object.keys(patch).length) { setDraft(undefined); return; }
    setBusy(true);
    try {
      setSaved(await api.updateNode(node.id, patch));
      setDraft(undefined);
      setNotice('星球已更新。');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存星球，请重试。');
    } finally { setBusy(false); }
  }

  async function remove() {
    if (busy || deleted || needsRefresh) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.deleteNode(node.id);
      setConfirming(false);
      setDeleted(true);
      setNotice('星球及其关联关系已删除。');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法删除星球，请重试。');
    } finally { setBusy(false); }
  }

  return (
    <aside className="panel min-w-0 space-y-4 overflow-y-auto p-5" aria-labelledby={heading}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`eyebrow ${selected.kind === 'idea' ? 'text-amber-300' : ''}`}>{selected.kind === 'idea' ? '原创创意' : '知识星球'}</p>
          <h2 id={heading} className="break-words text-xl font-semibold">{selected.title}</h2>
        </div>
        <button className="btn shrink-0" type="button" onClick={onClose} disabled={busy}>关闭</button>
      </header>
      {notice && <p role="status" className="muted text-sm">{notice}</p>}
      {error && !confirming && <p className="error" role="alert">{error}</p>}
      {needsRefresh && <button className="btn" type="button" disabled={busy} onClick={async () => {
        setBusy(true); setError(''); await refresh(); setBusy(false);
      }}>重试刷新</button>}
      {!deleted && (draft ? (
        <form onSubmit={save}>
          <fieldset className="space-y-3" disabled={busy}>
            <legend className="sr-only">编辑星球</legend>
            <label className="block space-y-1"><span>标题（最多 120 字）</span><input className="field w-full" value={draft.title} required maxLength={120} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
            <label className="block space-y-1"><span>分类（最多 80 字）</span><input className="field w-full" value={draft.category} required maxLength={80} onChange={event => setDraft({ ...draft, category: event.target.value })} /></label>
            <label className="block space-y-1"><span>摘要（最多 1,000 字）</span><textarea className="field w-full resize-y" value={draft.summary} maxLength={1000} rows={5} onChange={event => setDraft({ ...draft, summary: event.target.value })} /></label>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" type="submit">{busy ? '正在保存…' : '保存更改'}</button>
              <button className="btn" type="button" onClick={() => { setDraft(undefined); setError(''); }}>取消编辑</button>
            </div>
          </fieldset>
        </form>
      ) : <>
        <p className="muted break-words text-sm">{selected.category} · 创建于 {new Date(selected.createdAt).toLocaleString('zh-CN')}</p>
        <p className="whitespace-pre-wrap break-words">{selected.summary || '暂无摘要。'}</p>
        <div>
          <p className="mb-1 text-sm">掌握度 <strong>{selected.mastery}%</strong></p>
          <progress className="h-2 w-full accent-sky-300" aria-label="掌握度" max={100} value={selected.mastery} />
        </div>
        <section>
          <h3 className="mb-2 text-sm font-semibold">关联星球</h3>
          {neighbors.length === 0 ? <p className="muted text-sm">暂无关系。</p> : <ul className="space-y-1 text-sm">{neighbors.map(edge => (
            <li key={edge.id} className="break-words"><span className="muted">{edge.source === node.id ? '指向' : '来自'} · {edge.relation}：</span>{nodeById.get(edge.source === node.id ? edge.target : edge.source)?.title ?? '未知星球'}</li>
          ))}</ul>}
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">资料来源</h3>
          {selected.sourceRefs.length === 0 ? <p className="muted text-sm">暂无原文来源。</p> : <ul className="space-y-2">{selected.sourceRefs.map((ref, index) => (
            <li className="card p-3 text-sm" key={`${ref.documentId}:${ref.chunkId}:${index}`}>
              <Link className="underline" to={`/archive?${new URLSearchParams({ document: ref.documentId, chunk: ref.chunkId })}`}>
                查看原文{ref.page === null ? '' : ` · 第 ${ref.page} 页`}
              </Link>
              <p className="muted mt-1 whitespace-pre-wrap break-words">{ref.snippet}</p>
            </li>
          ))}</ul>}
        </section>
        <div className="flex flex-wrap gap-2">
          <Link className="btn btn-primary" to={`/tutor?${new URLSearchParams({ node: node.id })}`}>复习</Link>
          <button className="btn" type="button" disabled={busy || needsRefresh} onClick={() => {
            setError(''); setNotice(''); setDraft({ title: node.title, category: node.category, summary: node.summary });
          }}>编辑</button>
          <button ref={deleteButton} className="btn" type="button" disabled={busy || needsRefresh} onClick={() => { setError(''); setConfirming(true); }}>删除</button>
        </div>
      </>)}
      {confirming && <dialog ref={dialog} aria-labelledby={confirmHeading} className="panel fixed inset-0 m-auto w-[min(92vw,28rem)] space-y-4 p-5 text-inherit backdrop:bg-black/70"
        onCancel={event => { event.preventDefault(); if (!busy) { setConfirming(false); setError(''); } }}>
        <h3 id={confirmHeading} className="text-lg font-semibold">确认删除星球？</h3>
        <p className="break-words">删除「{node.title}」后，与它关联的关系边也会移除。此操作无法撤销。</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn" type="button" disabled={busy} onClick={() => { setConfirming(false); setError(''); }}>取消</button>
          <button className="btn border-red-400/40 text-red-300" type="button" disabled={busy} onClick={() => { void remove(); }}>{busy ? '正在删除…' : '确认删除'}</button>
        </div>
      </dialog>}
    </aside>
  );
}
