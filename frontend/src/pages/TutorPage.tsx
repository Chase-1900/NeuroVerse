import { useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AnswerResult, Api, Graph, Node, Question } from '../types/api';

type Props = { api: Api; graph: Graph | undefined; onChanged: () => Promise<void>; demo: boolean };
type Attempt = { question: Question; node: Node };

export function TutorPage(props: Props) {
  const [params] = useSearchParams();
  const requested = params.get('node') ?? '';
  return <TutorWorkflow key={JSON.stringify([props.demo, requested])} requested={requested} {...props} />;
}

function TutorWorkflow({ api, graph, onChanged, demo, requested }: Props & { requested: string }) {
  const [selection, setSelection] = useState(requested);
  const [attempt, setAttempt] = useState<Attempt>();
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<AnswerResult>();
  const [lastMastery, setLastMastery] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<'question' | 'answer' | 'refresh'>();
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState(false);
  const feedbackHeading = useRef<HTMLHeadingElement>(null);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useLayoutEffect(() => { if (result) feedbackHeading.current?.focus(); }, [result]);
  useLayoutEffect(() => { if (attempt) questionHeading.current?.focus(); }, [attempt]);

  const nodes = graph?.nodes ?? [];
  const selected = nodes.find(node => node.id === selection);
  const recommendations = (result?.reviewNodeIds ?? []).flatMap(id => {
    const node = nodes.find(candidate => candidate.id === id);
    return node ? [node] : [];
  });

  async function start(node: Node) {
    if (busy) return;
    setBusy('question');
    setError('');
    try {
      const question = await api.question(node.id);
      if (!active.current) return;
      setAttempt({ question, node: { ...node, mastery: lastMastery[node.id] ?? node.mastery } });
      setSelection(node.id);
      setDraft('');
      setResult(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法出题，请重试。');
    } finally { setBusy(undefined); }
  }

  async function refresh() {
    setRefreshError(false);
    try { await onChanged(); }
    catch { setRefreshError(true); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!attempt || result || busy) return;
    const answer = draft.trim();
    if (!answer || [...answer].length > 2000) {
      setError('请输入 1 至 2,000 个字符的答案。');
      return;
    }
    setBusy('answer');
    setError('');
    try {
      const evaluation = await api.answer(attempt.question.questionId, answer);
      if (active.current) {
        setResult(evaluation);
        setLastMastery(previous => ({ ...previous, [attempt.node.id]: evaluation.mastery }));
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法提交答案，请重试。');
    } finally { setBusy(undefined); }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 lg:px-8">
      <header>
        <p className="eyebrow">主动回忆</p><h1 className="text-3xl font-semibold">AI 导师</h1>
        <p className="muted mt-2">选择星球开始复习，通过回答问题检查理解。</p>
        {demo && <p className="mt-2 text-sm text-amber-200">示例模式 · 出题和反馈仅用于体验。</p>}
      </header>
      <div className="grid items-start gap-4 md:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]">
        <section className="panel min-w-0 space-y-4 p-5" aria-label="复习主题">
          <h2 className="text-lg font-semibold">复习主题</h2>
          {!graph && <p className="muted text-sm" role="status">图谱尚未就绪。请查看当前连接状态，或返回宇宙查看图谱。</p>}
          {graph && nodes.length === 0 && <p className="muted text-sm">暂无星球。先前往宇宙导入资料或创建星球。</p>}
          {graph && selection && !selected && <p className="muted text-sm" role="status">指定星球不在当前图谱中，请选择其他主题。</p>}
          {nodes.length > 0 && <label className="block space-y-2 text-sm"><span>选择星球</span>
            <select className="field w-full" disabled={Boolean(busy)} value={selected?.id ?? ''} onChange={event => {
              setSelection(event.target.value); setError('');
            }}>
              <option value="">请选择主题</option>
              {nodes.map(node => <option key={node.id} value={node.id}>{node.title} · {node.category}</option>)}
            </select>
          </label>}
          {selected && <>
            <p className="muted break-words text-sm">{selected.summary || '暂无摘要。'}</p>
            <p className="text-sm">掌握度 <strong>{lastMastery[selected.id] ?? selected.mastery}%</strong></p>
            <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => { void start(selected); }}>
              {busy === 'question' ? '正在出题…' : attempt ? '生成新问题' : '开始复习'}
            </button>
          </>}
          <div><Link className="btn" to="/universe">返回宇宙</Link></div>
        </section>
        <section className="panel min-w-0 space-y-4 p-5" aria-label="问答练习">
          {busy === 'question' && <p className="muted" role="status">正在为选中的主题生成问题…</p>}
          {error && <p className="error" role="alert">{error}</p>}
          {!attempt ? <div><h2 className="text-lg font-semibold">问答练习</h2><p className="muted mt-2">选择主题并开始复习，问题会显示在这里。</p></div> : <>
            <header>
              <p className="eyebrow break-words">当前主题：{attempt.node.title}</p>
              <h2 ref={questionHeading} tabIndex={-1} className="mt-1 whitespace-pre-wrap break-words text-lg font-semibold">{attempt.question.question}</h2>
            </header>
            {!result ? <form onSubmit={submit} className="space-y-3">
              <label className="block space-y-2 text-sm"><span>你的答案（最多 2,000 字）</span>
                <textarea className="field w-full resize-y" rows={6} required maxLength={2000} value={draft} disabled={Boolean(busy)} onChange={event => setDraft(event.target.value)} />
              </label>
              <button className="btn btn-primary" type="submit" disabled={Boolean(busy) || !draft.trim()}>{busy === 'answer' ? '正在评估…' : '提交答案'}</button>
            </form> : <div className="card space-y-4 p-4">
              <h3 ref={feedbackHeading} tabIndex={-1} className={`text-lg font-semibold ${result.correct ? 'text-emerald-300' : 'text-amber-200'}`}>
                {result.correct ? '回答正确' : '回答不正确'}
              </h3>
              <dl className="space-y-3 text-sm">
                <div><dt className="muted">你的答案</dt><dd className="whitespace-pre-wrap break-words">{draft}</dd></div>
                <div><dt className="muted">导师反馈</dt><dd className="whitespace-pre-wrap break-words">{result.feedback}</dd></div>
                <div><dt className="muted">正确答案</dt><dd className="whitespace-pre-wrap break-words">{result.correctAnswer}</dd></div>
                <div><dt className="muted">本次掌握度变化</dt><dd>{attempt.node.mastery}% → <strong>{result.mastery}%</strong></dd></div>
              </dl>
              {recommendations.length > 0 && <div>
                <h4 className="mb-2 text-sm font-medium">推荐星球 · 开始下一题</h4>
                <ul className="flex flex-wrap gap-2">{recommendations.map(node => <li key={node.id} className="min-w-0">
                  <button type="button" className="btn max-w-full whitespace-normal break-words" disabled={Boolean(busy)} onClick={() => { void start(node); }}>{node.title}</button>
                </li>)}</ul>
              </div>}
            </div>}
            {refreshError && <div><p className="error" role="alert">评估已记录，但图谱未能刷新，无需重复作答。</p>
              <button type="button" className="btn mt-2" disabled={Boolean(busy)} onClick={async () => {
                setBusy('refresh'); await refresh(); setBusy(undefined);
              }}>重试刷新</button>
            </div>}
          </>}
        </section>
      </div>
    </div>
  );
}
