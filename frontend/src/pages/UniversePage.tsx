import { Component, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Api, Graph } from '../types/api'
import { NodePanel } from '../components/NodePanel'
import { CollisionPanel } from '../components/CollisionPanel'

const GraphScene = lazy(() => import('../components/GraphScene').then(({ GraphScene }) => ({ default: GraphScene })))
class SceneBoundary extends Component<{ children: ReactNode; onUnavailable: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onUnavailable() }
  render() { return this.state.failed ? null : this.props.children }
}

type Props = { api: Api; graph?: Graph; error?: string; loading: boolean; onRetry: () => void; onImport: () => void; onChanged: () => Promise<void>; demo: boolean }
const motionQuery = '(prefers-reduced-motion: reduce)'
export function UniversePage({ api, graph, error, loading, onRetry, onImport, onChanged, demo }: Props) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [selection, setSelection] = useState<string | null>(null)
  const [collision, setCollision] = useState(false)
  const [picks, setPicks] = useState<string[]>([])
  const [listMode, setListMode] = useState(() => localStorage.getItem('neuroverse.lowPower') === 'true')
  const [unavailable, setUnavailable] = useState(false)
  const [reduce, setReduce] = useState(() => matchMedia(motionQuery).matches)
  const [reset, setReset] = useState(0)
  const [zoom, setZoom] = useState({ step: 0, factor: 1 })
  const [adding, setAdding] = useState(false)
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState('')
  useEffect(() => {
    const media = matchMedia(motionQuery)
    const update = (event: MediaQueryListEvent) => setReduce(event.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const categories = useMemo(() => [...new Set(graph?.nodes.map((node) => node.category))].sort(), [graph])
  const activeCategory = category || ((graph?.nodes.length ?? 0) > 250 && !query.trim() ? categories[0] : '')
  const visible = useMemo(() => {
    if (!graph) return undefined
    const search = query.trim().toLocaleLowerCase()
    const nodes = graph.nodes.filter((node) => (!activeCategory || node.category === activeCategory) && (!search || `${node.title}\n${node.summary}`.toLocaleLowerCase().includes(search)))
    const ids = new Set(nodes.map((node) => node.id))
    return { ...graph, nodes, edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) }
  }, [graph, query, activeCategory])
  const selected = graph?.nodes.find((node) => node.id === selection)
  const candidates = picks.flatMap((id) => graph?.nodes.find((node) => node.id === id) ?? [])
  useEffect(() => {
    if (!graph) return
    const ids = new Set(graph.nodes.map((node) => node.id))
    setSelection((id) => id && ids.has(id) ? id : null)
    setPicks((prior) => prior.every((id) => ids.has(id)) ? prior : prior.filter((id) => ids.has(id)))
  }, [graph])
  const useList = listMode || unavailable
  const choose = (id: string | null) => {
    setSelection(id)
    if (collision && id) setPicks((prior) => prior.includes(id) ? prior.filter((entry) => entry !== id) : [...prior.slice(-1), id])
  }
  const closeCollision = () => { setCollision(false); setPicks([]) }
  const changeView = () => { localStorage.setItem('neuroverse.lowPower', String(!listMode)); setListMode(!listMode) }
  async function addNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (addBusy) return
    const fields = new FormData(event.currentTarget)
    const title = String(fields.get('title')).trim(); const category = String(fields.get('category')).trim()
    if (!title || !category) { setAddError('请填写标题和分类。'); return }
    setAddBusy(true); setAddError('')
    try {
      const node = await api.createNode({ title, category, summary: String(fields.get('summary')).trim() })
      setQuery(''); setCategory(node.category); setSelection(node.id); setAdding(false)
      await onChanged()
    } catch (error) { setAddError(error instanceof Error ? error.message : '无法新增星球。') }
    finally { setAddBusy(false) }
  }
  return <div className="workspace-shell">
    <div className="workspace-header"><div><div className="eyebrow">02 / KNOWLEDGE UNIVERSE</div><h1>三维知识宇宙</h1></div><div className="flex flex-wrap gap-2"><button className="btn" disabled={!graph} onClick={() => { setAdding(!adding); setAddError('') }}>新增星球</button><button className="btn btn-primary" onClick={onImport}>导入知识 ＋</button></div></div>
    {error && <div className="inline-alert" role="alert">{error}<button className="btn" onClick={onRetry}>重试</button></div>}
    {adding && <form className="panel add-form" onSubmit={addNode}><h2>新增星球</h2><label>标题<input className="field" name="title" maxLength={120} required autoFocus/></label><label>分类<input className="field" name="category" maxLength={80} required/></label><label>摘要<textarea className="field" name="summary" maxLength={1000}/></label><div className="flex gap-2"><button className="btn btn-primary" disabled={addBusy}>创建星球</button><button type="button" className="btn" onClick={() => setAdding(false)}>取消</button></div>{addError && <p className="error" role="alert">{addError}</p>}</form>}
    <div className={`universe-grid${selected || collision ? ' has-detail' : ''}`}>
      <aside className="panel graph-index" aria-label="星球索引">
        <div className="eyebrow">SECTOR INDEX</div><h2>星球索引</h2>
        <label className="sr-only" htmlFor="graph-search">搜索星球</label><input id="graph-search" className="field" placeholder="搜索标题或摘要" value={query} onChange={(event) => setQuery(event.target.value)}/>
        <label className="sr-only" htmlFor="graph-category">知识分类</label><select id="graph-category" className="field" value={activeCategory} onChange={(event) => setCategory(event.target.value)}><option value="">全部分类</option>{categories.map((name) => <option key={name}>{name}</option>)}</select>
        <p className="eyebrow graph-count" aria-live="polite">{visible?.nodes.length ?? 0} 颗星球</p>
        <ul className="index-items">{visible?.nodes.map((node) => <li key={node.id}><button type="button" className="index-button" aria-pressed={collision ? picks.includes(node.id) : selected?.id === node.id} onClick={() => choose(node.id)}><i className={node.kind === 'idea' ? 'status-dot demo-dot' : 'status-dot'}/><span>{node.title}</span><small>{node.mastery}%</small></button></li>)}</ul>
        <button className="btn" aria-pressed={collision} disabled={!graph || graph.nodes.length < 2} onClick={() => collision ? closeCollision() : setCollision(true)}>✦ 思想碰撞</button>
      </aside>
      <section className="panel viewport" aria-label="宇宙视图">
        <div className="scene-overlay"><span className="eyebrow">{useList ? 'LIST VIEW' : 'ORBITAL VIEW'} / {demo ? '示例' : '实时'}</span><span className="eyebrow">{visible?.edges.length ?? 0} 条轨道</span></div>
        {loading && !graph ? <div className="scene-empty" role="status">正在连接宇宙…</div> : !visible?.nodes.length ? <div className="scene-empty"><span aria-hidden="true">✧</span><h2>{graph?.nodes.length ? '没有符合条件的星球' : '宇宙尚无星球'}</h2>{!graph?.nodes.length && <button className="btn" onClick={onImport}>导入第一份资料</button>}</div> : useList ? <div className="fallback-grid"><p className="muted col-span-full">{unavailable ? '当前环境无法启动 WebGL，已改用列表视图。' : '低性能列表视图'}</p>{visible.nodes.map((node) => <button className="card fallback-node" key={node.id} onClick={() => choose(node.id)} aria-pressed={collision ? picks.includes(node.id) : node.id === selection}><strong>{node.title}</strong><span>{node.summary}</span><small>掌握度 {node.mastery}%</small></button>)}</div> : <div className="scene-host"><SceneBoundary onUnavailable={() => setUnavailable(true)}><Suspense fallback={<div className="scene-empty" role="status">正在构建星图…</div>}><GraphScene graph={visible} selectedId={selected?.id ?? null} onSelect={choose} onUnavailable={() => setUnavailable(true)} resetSignal={reset} zoomSignal={zoom} reducedMotion={reduce}/></Suspense></SceneBoundary></div>}
        <div className="scene-controls"><button className="btn" disabled={useList || !visible?.nodes.length} onClick={() => setZoom((prior) => ({ step: prior.step + 1, factor: .75 }))} aria-label="放大">＋</button><button className="btn" disabled={useList || !visible?.nodes.length} onClick={() => setZoom((prior) => ({ step: prior.step + 1, factor: 1.3 }))} aria-label="缩小">−</button><button className="btn" disabled={useList || !visible?.nodes.length} onClick={() => { setSelection(null); setReset((value) => value + 1) }}>重置视图</button><button className="btn" disabled={unavailable} aria-pressed={useList} onClick={changeView}>{useList ? '返回 3D' : '低性能模式'}</button></div>
      </section>
      {(collision || selected) && graph && <div className="graph-detail">{collision ? <CollisionPanel demo={demo} nodes={candidates} api={api} onChanged={onChanged} onClose={closeCollision}/> : selected && <NodePanel key={selected.id} node={selected} graph={graph} api={api} onChanged={onChanged} onClose={() => setSelection(null)}/>}</div>}
    </div>
  </div>
}
