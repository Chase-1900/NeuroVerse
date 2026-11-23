import { Link, NavLink } from 'react-router-dom'
import type { Graph } from '../types/api'
import { NeuralHero } from '../components/NeuralHero'
import knowledgeArt from '../assets/home-knowledge.webp'
import collisionArt from '../assets/home-collision.webp'
import reviewArt from '../assets/home-review.webp'
import '../styles/landing.css'

type Props = { graph?: Graph; onImport: () => void; onDemo: () => void; onToggleMode: () => void; demo: boolean }

export function LandingPage({ graph, onImport, onDemo, onToggleMode, demo }: Props) {
  const knowledge = graph?.nodes.filter((node) => node.kind === 'knowledge')
  const review = knowledge?.filter((node) => node.mastery < 40).length
  const mastery = knowledge?.length ? Math.round(knowledge.reduce((sum, node) => sum + node.mastery, 0) / knowledge.length) : undefined
  const cards = [
    { title: 'Knowledge nodes', description: 'Your connected understanding', art: knowledgeArt, to: '/universe', label: '探索知识宇宙', values: [[knowledge?.length, 'Nodes'], [graph?.edges.length, 'Connections']] },
    { title: 'Idea collision', description: 'Find unexpected connections', art: collisionArt, to: '/universe', label: '进入宇宙进行思想碰撞', values: [[graph?.nodes.filter((node) => node.kind === 'idea').length, 'Saved ideas']] },
    { title: 'Review path', description: 'Reinforce. Revisit. Go deeper.', art: reviewArt, to: '/tutor', label: '前往导师复习', values: [[review, 'Due reviews'], [knowledge && review !== undefined ? knowledge.length - review : undefined, 'Other nodes']] },
  ]
  return <div className="landing-shell">
    <header className="home-header">
      <Link className="home-brand" to="/" aria-label="NeuroVerse 首页"><svg viewBox="0 0 140 80" fill="none" aria-hidden="true"><ellipse cx="70" cy="40" rx="68" ry="19" transform="rotate(-27 70 40)"/><circle cx="121" cy="10" r="3.5"/></svg><span>NeuroVerse</span></Link>
      <nav className="home-nav" aria-label="主导航" lang="en"><NavLink to="/" end>Home</NavLink><NavLink to="/universe">Universe</NavLink><NavLink to="/archive">Archive</NavLink><NavLink to="/tutor">Tutor</NavLink></nav>
      <div className="home-tools">
        <Link to="/universe" className="home-tool" title="搜索知识" aria-label="在宇宙中搜索知识"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.2"/><path d="m15 15 4.5 4.5"/></svg></Link>
        <Link to="/tutor" className="home-tool home-reminder" title="复习提醒" aria-label={review ? `${review} 个待复习节点` : '查看复习'} data-pending={Boolean(review)}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 10a6 6 0 0 1 12 0v3.5l2 3H4l2-3zM10 20h4"/></svg></Link>
        <button type="button" className="home-mode" title="切换数据模式" onClick={onToggleMode}><span aria-hidden="true" className="home-mode-planet" /><span>{demo ? '示例模式' : '真实模式'}</span></button>
      </div>
    </header>
    <section className="hero">
      <NeuralHero />
      <div className="hero-copy">
        <div className="landing-kicker" aria-hidden="true" />
        <h1 aria-label="你的思想，你的宇宙。" lang="en">Your mind.<br/><span>Your universe.</span></h1>
        <p lang="en">Explore what you know. Discover what connects.</p>
        <div className="hero-actions" lang="en">
          <Link to="/universe" className="btn btn-primary" aria-label="进入宇宙">Enter universe <span aria-hidden="true">→</span></Link>
          <button type="button" className="btn" onClick={onImport} aria-label="导入知识"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V4m-4 4 4-4 4 4M4 14v5h16v-5"/></svg>Import knowledge</button>
        </div>
        {!demo && <Link className="demo-link" to="/universe" onClick={onDemo}>浏览离线示例 <span aria-hidden="true">→</span></Link>}
      </div>
    </section>
    <section className="metric-grid" aria-label="宇宙概况" lang="en">
      {cards.map((card, index) => <article className={`home-card home-card-${index}`} key={card.title}>
        <img src={card.art} alt="" draggable="false" />
        <div className="home-card-content">
          <h2>{card.title}</h2><p>{card.description}</p>
          <dl>{card.values.map(([value, label]) => <div key={label}><dt>{label}</dt><dd>{typeof value === 'number' ? value.toLocaleString() : '—'}</dd></div>)}</dl>
          {index === 0 && <div className="home-progress">{mastery === undefined ? <span className="home-progress-track" aria-hidden="true" /> : <progress value={mastery} max={100} aria-label="平均掌握度" />}<span>{mastery === undefined ? '—' : `${mastery}%`}</span></div>}
        </div>
        <Link className="home-card-link" to={card.to} aria-label={card.label}>→</Link>
      </article>)}
    </section>
  </div>
}
