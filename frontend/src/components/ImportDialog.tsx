import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Api, DocumentSummary, Graph, ImportJob } from '../types/api';

type Props = { api: Api; onClose: () => void; onChanged: () => Promise<void>; demo: boolean };
type Mode = 'file' | 'text';
type Baseline = { graph?: Graph; documents?: DocumentSummary[]; fileName?: string };
type Report = { documents: DocumentSummary[]; added?: number; total?: number };

export function importJobStorageKey(demo: boolean) {
  return `neuroverse.importJob.${demo ? 'demo' : 'real'}`;
}

function readTask(key: string) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function writeTask(key: string, id: string | null) {
  try {
    if (id) sessionStorage.setItem(key, id);
    else sessionStorage.removeItem(key);
  } catch { /* The current dialog still tracks the job if storage is unavailable. */ }
}

function failureStatus(cause: unknown) {
  return typeof cause === 'object' && cause && 'status' in cause ? cause.status : undefined;
}

const statuses: Record<ImportJob['status'], string> = {
  pending: '已排队，等待处理', running: '正在提取并分析资料', succeeded: '导入完成', failed: '导入失败',
};

export function ImportDialog(props: Props) {
  return <ImportWorkflow key={importJobStorageKey(props.demo)} {...props} />;
}

function ImportWorkflow({ api, onClose, onChanged, demo }: Props) {
  const key = importJobStorageKey(demo);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const changed = useRef(onChanged);
  useLayoutEffect(() => { changed.current = onChanged; }, [onChanged]);
  const baseline = useRef<Baseline>({});
  const [mode, setMode] = useState<Mode>('file');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [consent, setConsent] = useState(false);
  const [posting, setPosting] = useState(false);
  const [job, setJob] = useState<ImportJob | null>(() => {
    const jobId = readTask(key);
    return jobId ? { jobId, status: 'pending' } : null;
  });
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState(false);
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [refreshError, setRefreshError] = useState('');
  const [report, setReport] = useState<Report>();
  const active = job?.status === 'pending' || job?.status === 'running';
  const succeeded = job?.status === 'succeeded';
  const jobId = job?.jobId;

  useLayoutEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (!jobId || !active || pollError) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll(id: string) {
      try {
        const next = await api.job(id);
        if (disposed) return;
        setJob(next);
        if (next.status === 'pending' || next.status === 'running') schedule(id);
        else writeTask(key, null);
      } catch (cause) {
        const status = failureStatus(cause);
        if ((status === 401 || status === 404) && readTask(key) === id) writeTask(key, null);
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : '无法获取导入进度，请检查连接后重试。');
        if (status === 401 || status === 404) {
          setJob(null);
        } else setPollError(true);
      }
    }
    function schedule(id: string) { timer = setTimeout(() => { void poll(id); }, 1800); }
    schedule(jobId);
    return () => { disposed = true; clearTimeout(timer); };
  }, [api, active, jobId, key, pollError]);

  useEffect(() => {
    if (!succeeded) return;
    let disposed = false;
    const before = baseline.current;
    setRefreshError('');
    void Promise.allSettled([changed.current(), api.graph(), api.documents()]).then(([updated, graph, documents]) => {
      if (disposed) return;
      const previousNodes = before.graph && new Set(before.graph.nodes.map(node => node.id));
      const previousDocs = before.documents && new Set(before.documents.map(doc => doc.documentId));
      const newDocuments = documents.status === 'fulfilled' ? documents.value.filter(doc =>
        doc.status === 'succeeded' && (previousDocs ? !previousDocs.has(doc.documentId) : doc.title === before.fileName),
      ) : [];
      setReport({
        documents: newDocuments,
        added: graph.status === 'fulfilled' && previousNodes
          ? graph.value.nodes.filter(node => !previousNodes.has(node.id)).length : undefined,
        total: graph.status === 'fulfilled' ? graph.value.nodes.length : undefined,
      });
      if ([updated, graph, documents].some(result => result.status === 'rejected')) {
        setRefreshError('导入已完成，但未能刷新全部数据。请重试刷新，无需重新导入。');
      }
    });
    return () => { disposed = true; };
  }, [api, succeeded, refreshAttempt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (posting || active || succeeded) return;
    setError('');
    const value = text.trim();
    if (!consent) { setError('请先确认资料分析说明。'); return; }
    if (mode === 'file') {
      if (!file || !/\.(txt|pdf)$/i.test(file.name)) { setError('请选择 TXT 或文本型 PDF 文件。'); return; }
      if (demo && /\.pdf$/i.test(file.name)) { setError('示例模式无法解析 PDF，请上传 TXT 或粘贴文本。'); return; }
      if (file.size === 0 || file.size > 10 * 1024 * 1024) { setError('文件不能为空，且不得超过 10 MB。'); return; }
    } else if (!value || [...value].length > 50_000) {
      setError('请输入 1 至 50,000 个字符。');
      return;
    }
    setPosting(true);
    try {
      const form = new FormData();
      if (mode === 'file' && file) {
        if (/\.txt$/i.test(file.name) && !(await file.text()).trim()) {
          setError('TXT 文件没有可导入的文本。');
          return;
        }
        form.append('file', file);
      } else form.append('text', value);
      const [graph, docs] = await Promise.allSettled([api.graph(), api.documents()]);
      for (const result of [graph, docs]) {
        if (result.status === 'rejected' && failureStatus(result.reason) === 401) throw result.reason;
      }
      baseline.current = {
        graph: graph.status === 'fulfilled' ? graph.value : undefined,
        documents: docs.status === 'fulfilled' ? docs.value : undefined,
        fileName: mode === 'file' ? file?.name : undefined,
      };
      const task = await api.importData(form);
      writeTask(key, task.status === 'pending' || task.status === 'running' ? task.jobId : null);
      setJob(task);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法提交导入，请重试。');
    } finally { setPosting(false); }
  }

  return (
    <dialog ref={dialog} aria-labelledby={heading} className="panel fixed inset-0 m-auto max-h-[90dvh] w-[min(92vw,36rem)] overflow-y-auto p-6 text-inherit backdrop:bg-black/70"
      onCancel={event => { event.preventDefault(); if (!posting) onClose(); }}>
      <header className="mb-5 flex items-start justify-between gap-4">
        <div><p className="eyebrow">知识采集</p><h2 id={heading} className="text-2xl font-semibold">导入知识</h2></div>
        <button className="btn" type="button" onClick={onClose} disabled={posting}>关闭</button>
      </header>
      {demo && <p className="muted mb-4 text-sm">示例模式仅支持 TXT 和粘贴文本，不解析 PDF。</p>}
      {job && <p role="status" className="card mb-4 p-3">{statuses[job.status]}{active && !pollError && '。可关闭窗口，稍后回来查看。'}</p>}
      {job?.status === 'failed' && <p className="error mb-4" role="alert">{job.error?.message ?? '无法分析资料，请检查内容后重试。'}</p>}
      {error && <p className="error mb-4" role="alert">{error}</p>}
      {active && pollError && <button className="btn" type="button" onClick={() => { setError(''); setPollError(false); }}>重试查询进度</button>}
      {succeeded && (
        <div className="space-y-3">
          {!report && <p className="muted" role="status">正在刷新图谱和档案…</p>}
          {report && <>
            {report.documents.length > 0 ? <ul className="space-y-2">{report.documents.map(doc => (
              <li key={doc.documentId}><Link className="underline" onClick={onClose} to={`/archive?${new URLSearchParams({ document: doc.documentId })}`}>{doc.title}</Link></li>
            ))}</ul> : <p className="muted">{baseline.current.fileName ? `提交文件：${baseline.current.fileName}` : '可在档案中查看已导入资料。'}</p>}
            {report.total !== undefined && <p>图谱现有 {report.total} 个星球{report.added !== undefined ? `，比提交前新增 ${report.added} 个` : ''}。</p>}
          </>}
          {refreshError && <div><p className="error" role="alert">{refreshError}</p><button className="btn mt-2" type="button" onClick={() => setRefreshAttempt(value => value + 1)}>重试刷新</button></div>}
          <div className="flex flex-wrap gap-2">
            <Link className="btn btn-primary" onClick={onClose} to="/universe">进入宇宙</Link>
            <Link className="btn" onClick={onClose} to="/archive">查看档案</Link>
          </div>
        </div>
      )}
      {!active && !succeeded && (
        <form onSubmit={submit}>
          <fieldset disabled={posting} className="space-y-4">
            <legend className="sr-only">导入方式</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="import-mode" checked={mode === 'file'} onChange={() => { setMode('file'); setError(''); }} />上传文件</label>
              <label className="flex items-center gap-2"><input type="radio" name="import-mode" checked={mode === 'text'} onChange={() => { setMode('text'); setError(''); }} />粘贴文本</label>
            </div>
            {mode === 'file' ? <label className="block space-y-2"><span>选择文件（最多 10 MB）</span>
              <input className="field w-full" type="file" accept={demo ? '.txt' : '.txt,.pdf'} onChange={event => setFile(event.currentTarget.files?.[0] ?? null)} />
              {file && <span className="muted block break-words text-sm">已选：{file.name}</span>}
              {!demo && <span className="muted block text-sm">支持 TXT 和可选中文字的 PDF。</span>}
            </label> : <label className="block space-y-2"><span>资料文本（最多 50,000 字符）</span>
              <textarea className="field w-full resize-y" rows={7} value={text} onChange={event => setText(event.target.value)} />
            </label>}
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={event => setConsent(event.target.checked)} />
              <span>{demo ? '我同意在本地示例中处理此资料；不会发送至 AI 服务。' : '我确认拥有资料的使用权限，并同意将资料发送至 AI 服务进行分析。'}</span>
            </label>
            <button className="btn btn-primary" disabled={posting || !consent} type="submit">{posting ? '正在提交…' : job?.status === 'failed' ? '重新导入' : '开始导入'}</button>
          </fieldset>
        </form>
      )}
    </dialog>
  );
}
