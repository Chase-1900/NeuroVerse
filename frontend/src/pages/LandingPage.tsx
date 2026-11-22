import { Link } from 'react-router-dom'
import type { Graph } from '../types/api'

const stars = Array.from({ length: 150 }, (_, index) => ({ x: (index * 587.17) % 680, y: (index * index * 100.73) % 590, r: index % 13 === 0 ? 1.6 : .65 }))
const points = Array.from({ length: 540 }, (_, index) => {
  const y = 1 - (index + .5) / 270
  const radius = Math.sqrt(1 - y * y)
  const angle = index * 2.39996323
  const x = radius * Math.cos(angle)
  const depth = radius * Math.sin(angle)
  return { x: 350 + x * 167, y: 290 + y * 167, r: depth > .65 ? 1.7 : .85, opacity: .17 + (depth + 1) * .38 }
})

function AstralCore() {
  return <figure className="astral-core" aria-hidden="true">
    <svg viewBox="0 0 680 590" fill="none">
      <defs>
        <radialGradient id="core-halo"><stop stopColor="#477cbd" stopOpacity=".36"/><stop offset=".52" stopColor="#214579" stopOpacity=".19"/><stop offset="1" stopColor="#0b1021" stopOpacity="0"/></radialGradient>
        <radialGradient id="core-shade" cx="33%" cy="23%" r="80%"><stop stopColor="#38647c" stopOpacity=".65"/><stop offset=".7" stopColor="#152841" stopOpacity=".82"/><stop offset="1" stopColor="#070d19"/></radialGradient>
        <linearGradient id="orbit-line"><stop stopColor="#8fdfee" stopOpacity=".01"/><stop offset=".58" stopColor="#8fdfee" stopOpacity=".66"/><stop offset="1" stopColor="#a18ce1" stopOpacity=".07"/></linearGradient>
      </defs>
      <circle cx="348" cy="287" r="285" fill="url(#core-halo)"/>
      {stars.map((star, index) => <circle key={index} cx={star.x} cy={star.y} r={star.r} fill="#b2dcef" opacity={.18 + (index % 7) * .073}/>)}
      <g stroke="#8faac8" strokeOpacity=".18"><circle cx="350" cy="290" r="208" strokeDasharray="1 7"/><circle cx="350" cy="290" r="244" strokeDasharray="65 42 7 24"/><path d="M350 15v550M66 290h568" strokeDasharray="3 10"/></g>
      <ellipse cx="350" cy="290" rx="276" ry="95" transform="rotate(-23 350 290)" stroke="url(#orbit-line)"/>
      <circle cx="350" cy="290" r="167" fill="url(#core-shade)" stroke="#87dbea" strokeOpacity=".58"/>
      <g stroke="#82b8d6" strokeOpacity=".28"><ellipse cx="350" cy="290" rx="70" ry="167" transform="rotate(32 350 290)"/><ellipse cx="350" cy="290" rx="125" ry="167" transform="rotate(32 350 290)"/><ellipse cx="350" cy="290" rx="167" ry="66" transform="rotate(32 350 290)"/><path d="M196 249 Q350 425 502 330 M226 179 Q373 341 517 275 M191 313 Q302 472 459 418"/></g>
      <g fill="#a9eaf8">{points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={point.r} opacity={point.opacity}/>)}</g>
      <ellipse cx="350" cy="290" rx="268" ry="78" transform="rotate(22 350 290)" stroke="url(#orbit-line)"/>
      <g fill="#dfbc83"><circle cx="582" cy="331" r="5"/><circle cx="172" cy="407" r="3"/></g><g fill="#b7edff"><circle cx="453" cy="145" r="5"/><circle cx="225" cy="212" r="4"/><circle cx="497" cy="367" r="4"/></g>
      <g fill="#9bb5ce" fontSize="10" letterSpacing="3" fontFamily="monospace"><text x="477" y="124">NEURAL CORE</text><text x="76" y="445">FIG. 01 / CORE FIELD</text><text x="513" y="473">NV–01</text></g>
    </svg>
  </figure>
}

type Props = { graph?: Graph; onImport: () => void; onDemo: () => void; demo: boolean }
export function LandingPage({ graph, onImport, onDemo, demo }: Props) {
  const metrics = [
    { label: '知识星球', description: 'KNOWLEDGE', count: graph?.nodes.filter((node) => node.kind === 'knowledge').length },
    { label: '思想火花', description: 'IDEAS', count: graph?.nodes.filter((node) => node.kind === 'idea').length },
    { label: '待复习节点', description: 'TO REVIEW', count: graph?.nodes.filter((node) => node.kind === 'knowledge' && node.mastery < 40).length },
  ]
  return <div className="landing-shell">
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><i className="status-dot"/> COGNITIVE OBSERVATORY <span className="hero-index">/ 01</span></div>
        <h1>你的思想，<br/>你的<span>宇宙</span><b>。</b></h1>
        <p>把零散的知识化为星球，把意想不到的关联化为轨道。<br className="hidden sm:block"/> 在三维思维宫殿里，探索、碰撞、重新理解。</p>
        <div className="hero-actions"><Link to="/universe" className="btn btn-primary">进入宇宙 <span aria-hidden="true">↗</span></Link><button className="btn" onClick={onImport}>导入知识 <span aria-hidden="true">＋</span></button></div>
        {!demo && <Link className="demo-link" to="/universe" onClick={onDemo}>浏览离线示例 <span aria-hidden="true">→</span></Link>}
      </div>
      <AstralCore />
    </section>
    <section className="metric-grid" aria-label="宇宙概况">{metrics.map((metric, index) => <div className="metric-card" key={metric.label}><div className="eyebrow">0{index + 1} / {metric.description}</div><strong>{metric.count ?? '—'}</strong><span>{metric.label}</span></div>)}</section>
    <footer className="landing-footer"><span>NEUROVERSE / FIELD NOTES</span><span>阿里天池 · 参赛原型</span></footer>
  </div>
}
