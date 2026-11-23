import brain from '../assets/neural-brain.webp'
import moon from '../assets/orbital-moon.webp'

const pulses = [
  'M 266 215 Q 330 106 432 143 T 562 212',
  'M 385 214 Q 475 180 541 281 T 619 300',
  'M 324 328 Q 418 264 512 326 T 570 397',
  'M 540 285 Q 462 337 508 465',
]

export function NeuralHero() {
  return <figure className="neural-hero" aria-hidden="true">
    <div className="neural-atmosphere" />
    <svg className="neural-orbits neural-orbits-back" viewBox="0 0 800 600" fill="none">
      <defs>
        <linearGradient id="orbit-back"><stop stopColor="#9bd7ed" stopOpacity=".05"/><stop offset=".56" stopColor="#9bd7ed" stopOpacity=".65"/><stop offset="1" stopColor="#8b83c8" stopOpacity=".14"/></linearGradient>
        <radialGradient id="neural-moon" cx="30%" cy="22%" r="78%"><stop stopColor="#aec6d7"/><stop offset=".31" stopColor="#45596c"/><stop offset=".71" stopColor="#172231"/><stop offset="1" stopColor="#0a111a"/></radialGradient>
      </defs>
      <ellipse cx="426" cy="300" rx="354" ry="113" transform="rotate(-24 426 300)" stroke="url(#orbit-back)"/>
      <ellipse cx="426" cy="300" rx="324" ry="104" transform="rotate(17 426 300)" stroke="url(#orbit-back)" opacity=".44"/>
      <circle cx="127" cy="190" r="14" fill="url(#neural-moon)" stroke="#aec6d7" strokeOpacity=".45"/>
      <circle cx="691" cy="165" r="2" fill="#d8e8ff"/><circle cx="104" cy="340" r="1.5" fill="#b7dbe9"/>
    </svg>
    <div className="neural-body">
      <img src={brain} alt="" width="673" height="551" fetchPriority="high" draggable="false" />
      <svg className="neural-signals" viewBox="0 0 800 600" fill="none">
        {pulses.map((path, index) => <path className="neural-pulse" key={path} d={path} pathLength="100" style={{ animationDelay: `${index * -2.4}s` }}/>) }
      </svg>
    </div>
    <svg className="neural-orbits neural-orbits-front" viewBox="0 0 800 600" fill="none">
      <defs><linearGradient id="orbit-front"><stop stopColor="#a8e3f7" stopOpacity=".04"/><stop offset=".29" stopColor="#b6eaff" stopOpacity=".76"/><stop offset=".68" stopColor="#e5cfaa" stopOpacity=".51"/><stop offset="1" stopColor="#9bd7ed" stopOpacity=".04"/></linearGradient></defs>
      <path d="M103 420 C 129 467 341 462 578 349 C 680 300 743 244 749 207" stroke="url(#orbit-front)"/>
      <path d="M111 313 C 187 437 526 482 709 412" stroke="url(#orbit-front)" opacity=".34"/>
      <circle className="neural-orbit-light" cx="256" cy="448" r="2.7" fill="#e6f7ff"/><circle className="neural-orbit-light warm" cx="495" cy="386" r="2.4" fill="#f3dbb4"/>
      <image href={moon} x="117" y="362" width="80" height="80"/>
    </svg>
    <div className="neural-foreground" />
  </figure>
}
