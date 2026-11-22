import { useId, useState } from 'react';
import type { Api, CollisionResult, Node } from '../types/api';

type Props = { nodes: Node[]; api: Api; onChanged: () => Promise<void>; onClose: () => void; demo: boolean };

export function CollisionPanel(props: Props) {
  return <CollisionWorkflow key={JSON.stringify(props.nodes.map(node => node.id))} {...props} />;
}

function CollisionWorkflow({ nodes, api, onChanged, onClose, demo }: Props) {
  const heading = useId();
  const [result, setResult] = useState<CollisionResult>();
  const [saved, setSaved] = useState<Node>();
  const [busy, setBusy] = useState<'generate' | 'save' | 'refresh'>();
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState(false);
  const ready = nodes.length === 2 && nodes[0]?.id !== nodes[1]?.id;

  async function collide() {
    const [first, second] = nodes;
    if (!ready || !first || !second || busy) return;
    setBusy('generate');
    setError('');
    setResult(undefined);
    setSaved(undefined);
    setRefreshError(false);
    try { setResult(await api.collide([first.id, second.id])); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法生成创意，请重试。'); }
    finally { setBusy(undefined); }
  }

  async function refresh() {
    setRefreshError(false);
    try { await onChanged(); }
    catch { setRefreshError(true); }
  }

  async function save() {
    if (!result || saved || busy) return;
    setBusy('save');
    setError('');
    try {
      setSaved(await api.saveIdea(result.ideaId));
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存创意，请重试。'); }
    finally { setBusy(undefined); }
  }

  return (
    <section className="panel min-w-0 space-y-4 overflow-y-auto p-5" aria-labelledby={heading}>
      <header className="flex items-start justify-between gap-3">
        <div><p className="eyebrow">创意实验</p><h2 id={heading} className="text-xl font-semibold">思想碰撞</h2></div>
        <button className="btn shrink-0" type="button" onClick={onClose}>结束碰撞</button>
      </header>
      <p className="muted text-sm">在宇宙中选择两个不同的星球。可通过星球选择控件取消或替换。</p>
      <ol className="grid grid-cols-2 gap-2" aria-label="碰撞候选">
        {[0, 1].map(index => <li key={index} className="card min-w-0 p-3 text-sm">
          <span className="muted block">星球 {index + 1}</span><strong className="break-words">{nodes[index]?.title ?? '等待选择'}</strong>
        </li>)}
      </ol>
      {!ready && nodes.length >= 2 && <p role="status" className="muted text-sm">必须恰好选择两个不同的星球。</p>}
      {busy === 'generate' && <div role="status" className="flex flex-wrap items-center gap-3 text-sm text-amber-200">
        <span aria-hidden="true" className="flex w-10 justify-between"><span className="h-2 w-2 rounded-full bg-sky-300 motion-safe:animate-[pulse_650ms_ease-out_1]" /><span className="h-2 w-2 rounded-full bg-amber-300 motion-safe:animate-[pulse_650ms_ease-out_1]" /></span>
        正在寻找知识交集并生成创意…
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
      {!result && <button className="btn btn-primary" type="button" disabled={!ready || Boolean(busy)} onClick={() => { void collide(); }}>
        {busy === 'generate' ? '正在碰撞…' : error ? '重试碰撞' : '开始碰撞'}
      </button>}
      {result && <article className="card space-y-3 border-amber-400/30 p-4">
        <p className="text-sm text-amber-200">{demo ? '本地模拟创意' : 'AI 生成的创意'}</p>
        <h3 className="break-words text-lg font-semibold">{result.title}</h3>
        <dl className="space-y-3 text-sm">
          <div><dt className="muted">共同点</dt><dd className="whitespace-pre-wrap break-words">{result.commonGround}</dd></div>
          <div><dt className="muted">创意描述</dt><dd className="whitespace-pre-wrap break-words">{result.description}</dd></div>
          <div><dt className="muted">行动建议</dt><dd className="whitespace-pre-wrap break-words">{result.action}</dd></div>
          <div><dt className="muted">来源星球</dt><dd className="break-words">{result.sourceNodeIds.map(id => nodes.find(node => node.id === id)?.title ?? id).join('、')}</dd></div>
        </dl>
        {!saved ? <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => { void save(); }}>
          {busy === 'save' ? '正在保存…' : error ? '重试保存' : '保存为创意星球'}
        </button> : <p role="status" className="break-words text-amber-200">已保存创意星球「{saved.title}」。</p>}
        {refreshError && <div><p className="error" role="alert">创意已保存，但图谱未能刷新。</p>
          <button className="btn mt-2" type="button" disabled={Boolean(busy)} onClick={async () => {
            setBusy('refresh'); await refresh(); setBusy(undefined);
          }}>重试刷新</button>
        </div>}
      </article>}
    </section>
  );
}
