import { useCallback, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createApi } from './api/client'
import { LandingPage } from './pages/LandingPage'
import { UniversePage } from './pages/UniversePage'
import { ArchivePage } from './pages/ArchivePage'
import { TutorPage } from './pages/TutorPage'
import { ImportDialog, importJobStorageKey } from './components/ImportDialog'

const modeKey = 'neuroverse.view.demo'

export function App() {
  const [demo, setDemo] = useState(() => localStorage.getItem(modeKey) === 'true' || (localStorage.getItem(modeKey) === null && import.meta.env.VITE_DEMO_MODE === 'true'))
  const [connection, setConnection] = useState({ expired: false, revision: 0 })
  const [importOpen, setImportOpen] = useState(() => Boolean(sessionStorage.getItem(importJobStorageKey(demo))))
  const [revision, setRevision] = useState(0)
  const cache = useQueryClient()
  const onUnauthorized = useCallback(() => {
    sessionStorage.removeItem(importJobStorageKey(false))
    setImportOpen(false)
    setConnection((previous) => ({ ...previous, expired: true }))
    cache.removeQueries({ queryKey: ['graph', false] })
  }, [cache])
  const api = useMemo(() => createApi(demo, onUnauthorized), [demo, onUnauthorized])
  const queryKey = useMemo(() => ['graph', demo, demo ? 0 : connection.revision] as const, [demo, connection.revision])
  const graph = useQuery({ queryKey, queryFn: async () => {
    const result = await api.graph()
    const prior = cache.getQueryData<typeof result>(queryKey)
    return prior && prior.graphVersion > result.graphVersion ? prior : result
  }, enabled: demo || !connection.expired })
  const onChanged = useCallback(async () => {
    setRevision((value) => value + 1)
    await cache.invalidateQueries({ queryKey }, { throwOnError: true })
  }, [cache, queryKey])

  function switchMode(next: boolean) {
    localStorage.setItem(modeKey, String(next))
    setImportOpen(false)
    setDemo(next)
  }
  const blocked = !demo && connection.expired
  const error = blocked ? '会话已失效，请重新连接。' : graph.error?.message
  const retry = () => {
    if (blocked) setConnection((previous) => ({ expired: false, revision: previous.revision + 1 }))
    else void graph.refetch()
  }
  const openImport = () => setImportOpen(true)
  const scope = demo ? 'demo' : `live-${connection.revision}`
  const home = useLocation().pathname === '/'
  return <>
    <a href="#main" className="skip-link">跳到主要内容</a>
    {!home && <header className="topbar">
      <NavLink className="brand" to="/" aria-label="NeuroVerse 首页"><span className="brand-mark" aria-hidden="true">✦</span><span>NEURO<span>VERSE</span><small>赛博思维宫殿</small></span></NavLink>
      <nav className="nav-links" aria-label="主导航">
        <NavLink to="/" end>首页</NavLink><NavLink to="/universe">宇宙</NavLink><NavLink to="/archive">档案</NavLink><NavLink to="/tutor">导师</NavLink>
      </nav>
      <button className="mode-switch" type="button" title="切换数据模式" onClick={() => switchMode(!demo)}><span className={demo ? 'status-dot demo-dot' : 'status-dot'} />{demo ? '示例模式' : '真实模式'}</button>
    </header>}
    <main id="main" key={scope}>
      {blocked && <div className="connection-banner" role="alert">{error} <button className="btn" onClick={retry}>重新连接</button></div>}
      <Routes>
        <Route path="/" element={<LandingPage graph={blocked ? undefined : graph.data} onImport={openImport} onDemo={() => switchMode(true)} onToggleMode={() => switchMode(!demo)} demo={demo} />} />
        <Route path="/universe" element={<UniversePage api={api} graph={blocked ? undefined : graph.data} error={error} loading={!blocked && graph.isPending} onRetry={retry} onImport={openImport} onChanged={onChanged} demo={demo} />} />
        <Route path="/archive" element={blocked ? null : <ArchivePage api={api} onImport={openImport} revision={revision} graph={graph.data} />} />
        <Route path="/tutor" element={blocked ? null : <TutorPage api={api} graph={graph.data} onChanged={onChanged} demo={demo} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {importOpen && !blocked && <ImportDialog api={api} onClose={() => setImportOpen(false)} onChanged={onChanged} demo={demo} />}
    </main>
  </>
}
