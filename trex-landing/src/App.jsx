import React, { useEffect, useState } from "react";

const sections = [
  { id: "home", label: "START" },
  { id: "problem", label: "PROBLEM" },
  { id: "approach", label: "APPROACH" },
  { id: "market", label: "MARKET" },
  { id: "about", label: "ABOUT" },
];

function Arrow({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 10h13M10.5 4.5 16 10l-5.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function NetworkGraphic() {
  return (
    <div className="network-card">
      <div className="network-top">
        <span>LIVE TRANSACTION MAP</span>
        <span className="status"><i /> VERIFIED</span>
      </div>
      <svg className="network-svg" viewBox="0 0 650 430" fill="none">
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7C9774" stopOpacity=".12"/>
            <stop offset="100%" stopColor="#7C9774" stopOpacity=".9"/>
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <g opacity=".28" stroke="#F1F0E8">
          <path d="M0 86H650M0 172H650M0 258H650M0 344H650"/>
          <path d="M81 0V430M162 0V430M243 0V430M324 0V430M405 0V430M486 0V430M567 0V430"/>
        </g>
        <g stroke="url(#lineGrad)" strokeWidth="2">
          <path d="M92 325 C170 275, 185 115, 285 150 S405 292, 476 205 S560 115, 610 82"/>
          <path d="M92 325 C190 380, 220 285, 325 270 S455 230, 610 82"/>
          <path d="M92 325 C185 315, 235 90, 380 95 S490 180, 610 82"/>
        </g>
        {[
          [92,325,"WALLET"],[285,150,"BINANCE"],[476,205,"COINDCX"],
          [325,270,"TRANSFER"],[380,95,"TDS"],[610,82,"T-REX"]
        ].map(([x,y,label],i)=>(
          <g key={label}>
            <circle cx={x} cy={y} r={i===5 ? 11 : 7} fill="#0B0D0C" stroke="#7C9774" strokeWidth="2" filter="url(#glow)"/>
            <circle cx={x} cy={y} r="2.5" fill="#F1F0E8"/>
            <text x={x+14} y={y-10} fill="#F1F0E8" opacity=".75" fontSize="10" letterSpacing="1.4">{label}</text>
          </g>
        ))}
      </svg>
      <div className="network-bottom">
        <span>TRANSACTIONS <b>1,284</b></span>
        <span>RECONCILED <b>98.7%</b></span>
        <span>ALERTS <b className="alert">03</b></span>
      </div>
    </div>
  );
}

function SectionTag({ number, children }) {
  return (
    <div className="section-tag">
      <span>{number}</span>
      <span>{children}</span>
    </div>
  );
}

function App() {
  const [active, setActive] = useState("home");
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a,b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { threshold: [0.2, 0.45, 0.7], rootMargin: "-12% 0px -55% 0px" }
    );

    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const go = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMenu(false);
  };

  return (
    <div className="site">
      <div className="grain" />

      <header className="nav-wrap">
        <nav className="nav">
          <button className="brand" onClick={() => go("home")} aria-label="T-REX home">
            <span className="brand-mark">T</span>
            <span>T-REX</span>
          </button>

          <div className={`nav-links ${menu ? "open" : ""}`}>
            {sections.slice(1).map((item, i) => (
              <button
                key={item.id}
                className={active === item.id ? "active" : ""}
                onClick={() => go(item.id)}
              >
                <span>0{i + 2}</span>{item.label}
              </button>
            ))}
          </div>

          <button className="nav-cta" onClick={() => go("about")}>
            GET STARTED <Arrow />
          </button>

          <button className="menu-btn" onClick={() => setMenu(!menu)} aria-label="Toggle navigation">
            <span /><span />
          </button>
        </nav>
      </header>

      <main>
        <section id="home" className="hero section">
          <div className="hero-grid">
            <div className="hero-copy">
              <SectionTag number="00">CRYPTO COMPLIANCE INFRASTRUCTURE</SectionTag>
              <h1>
                CRYPTO TAX.
                <br />
                <em>VERIFIED.</em>
                <br />
                SIMPLIFIED.
              </h1>
              <p className="hero-lead">
                T-REX brings fragmented crypto transactions together,
                reconciles TDS across exchanges, and creates a
                verifiable compliance trail.
              </p>
              <div className="hero-actions">
                <button className="primary-btn" onClick={() => go("problem")}>
                  EXPLORE T-REX <Arrow />
                </button>
                <span className="micro-copy">BUILT FOR INDIA'S DIGITAL ASSET ECONOMY</span>
              </div>
            </div>

            <div className="hero-visual">
              <div className="orbit-label label-a">194S / TDS</div>
              <div className="orbit-label label-b">AUDIT TRAIL</div>
              <div className="orbit-label label-c">SHA-256</div>
              <NetworkGraphic />
              <div className="hero-stamp">
                <span>T-REX</span>
                <strong>01</strong>
                <small>TRANSACTION<br/>RECONCILIATION<br/>ENGINE</small>
              </div>
            </div>
          </div>
          <div className="scroll-cue"><span>SCROLL TO INVESTIGATE</span><i /></div>
        </section>

        <section id="problem" className="section problem">
          <div className="section-inner">
            <SectionTag number="01">THE PROBLEM</SectionTag>
            <div className="problem-head">
              <h2>CRYPTO IS<br/><em>FRAGMENTED.</em></h2>
              <p>
                Digital assets move across exchanges, wallets and transfers.
                Tax records don't always move with them.
              </p>
            </div>

            <div className="problem-visual">
              <div className="flow-node node-1"><span>01</span><b>COINDCX</b><small>TRADES + TDS</small></div>
              <div className="flow-node node-2"><span>02</span><b>BINANCE</b><small>TRADES + TDS</small></div>
              <div className="flow-node node-3"><span>03</span><b>WALLET</b><small>TRANSFERS</small></div>
              <div className="flow-center"><span>?</span><b>WHERE DID<br/>THE TDS GO?</b></div>
              <div className="flow-line l1" /><div className="flow-line l2" /><div className="flow-line l3" />
            </div>

            <div className="big-stats">
              <div><strong>01</strong><span>MULTIPLE<br/>EXCHANGES</span></div>
              <div><strong>02</strong><span>FRAGMENTED<br/>RECORDS</span></div>
              <div><strong>03</strong><span>MANUAL<br/>RECONCILIATION</span></div>
            </div>
          </div>
        </section>

        <section id="approach" className="section approach">
          <div className="section-inner">
            <SectionTag number="02">THE APPROACH</SectionTag>
            <div className="approach-head">
              <h2>ONE SYSTEM.<br/><em>EVERY TRANSACTION.</em></h2>
              <p>From raw exchange files to a cryptographically verifiable compliance report.</p>
            </div>

            <div className="pipeline">
              {[
                ["01","UPLOAD","Import records from multiple exchanges."],
                ["02","NORMALIZE","Convert different formats into one model."],
                ["03","RECONCILE","Match trades, transfers and TDS deductions."],
                ["04","ANALYZE","AI identifies discrepancies and explains them."],
                ["05","VERIFY","Fingerprint and anchor the final report."]
              ].map(([n,t,d],i)=>(
                <div className="step" key={n}>
                  <div className="step-number">{n}</div>
                  <div className="step-line"><i /></div>
                  <h3>{t}</h3>
                  <p>{d}</p>
                  {i < 4 && <Arrow className="step-arrow" />}
                </div>
              ))}
            </div>

            <div className="architecture">
              <div className="arch-title"><span>SYSTEM ARCHITECTURE</span><span>END-TO-END VERIFICATION</span></div>
              <div className="arch-grid">
                <div className="arch-col">
                  <small>DATA SOURCES</small>
                  <b>EXCHANGES</b><b>WALLETS</b><b>CSV / API</b>
                </div>
                <div className="arch-arrow">→</div>
                <div className="arch-col accent-col">
                  <small>T-REX CORE</small>
                  <b>RECONCILIATION</b><b>AI INSIGHTS</b><b>TDS ENGINE</b>
                </div>
                <div className="arch-arrow">→</div>
                <div className="arch-col">
                  <small>VERIFICATION</small>
                  <b>SHA-256</b><b>BLOCKCHAIN</b><b>AUDIT REPORT</b>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="market" className="section market">
          <div className="section-inner">
            <SectionTag number="03">THE MARKET</SectionTag>
            <div className="market-head">
              <h2>A NEW ASSET CLASS<br/>NEEDS A NEW<br/><em>COMPLIANCE LAYER.</em></h2>
              <p>
                India's Section 194S framework creates a clear need for
                reliable transaction-level TDS tracking across a fragmented
                digital asset ecosystem.
              </p>
            </div>

            <div className="market-numbers">
              <article><strong>1<span>%</span></strong><label>SECTION 194S<br/>CRYPTO TDS</label></article>
              <article><strong>₹10<span>K</span></strong><label>THRESHOLD<br/>NON-SPECIFIED PAYERS</label></article>
              <article><strong>₹50<span>K</span></strong><label>THRESHOLD<br/>SPECIFIED PAYERS</label></article>
            </div>

            <div className="market-grid">
              <div className="market-map">
                <div className="map-center">DIGITAL<br/>ASSETS</div>
                <div className="map-node m1">TRADING</div>
                <div className="map-node m2">P2P</div>
                <div className="map-node m3">TRANSFERS</div>
                <div className="map-node m4">TDS</div>
                <i className="map-line ml1"/><i className="map-line ml2"/><i className="map-line ml3"/><i className="map-line ml4"/>
              </div>
              <div className="market-copy">
                <div><span>01</span><b>TAXPAYERS</b><p>One place to understand crypto TDS obligations and discrepancies.</p></div>
                <div><span>02</span><b>AUDITORS</b><p>Less manual reconciliation. More traceable evidence.</p></div>
                <div><span>03</span><b>REGULATORS</b><p>A clearer path from transaction data to verified reporting.</p></div>
              </div>
            </div>
          </div>
        </section>

        <section id="about" className="section about">
          <div className="section-inner">
            <SectionTag number="04">ABOUT T-REX</SectionTag>
            <div className="about-grid">
              <div>
                <h2>BUILT FOR A<br/><em>MORE VERIFIABLE</em><br/>CRYPTO ECONOMY.</h2>
              </div>
              <div className="about-copy">
                <p className="about-large">
                  T-REX is a compliance infrastructure concept at the intersection
                  of fintech, AI and blockchain.
                </p>
                <p>
                  We connect fragmented crypto transaction data, automate
                  reconciliation, surface compliance gaps and create an
                  auditable trail that can be independently verified.
                </p>
                <button className="outline-btn" onClick={() => window.scrollTo({top:0, behavior:"smooth"})}>
                  BACK TO TOP <Arrow />
                </button>
              </div>
            </div>

            <div className="team-strip">
              <div className="team-label">THE BUILD</div>
              <div className="team-item"><strong>PRODUCT</strong><span>FINTECH × COMPLIANCE</span></div>
              <div className="team-item"><strong>ENGINEERING</strong><span>AI × API × BLOCKCHAIN</span></div>
              <div className="team-item"><strong>DESIGN</strong><span>DATA × EDITORIAL UI</span></div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-top">
          <div>
            <div className="footer-brand">T-REX</div>
            <p>CRYPTO TAX.<br/>VERIFIED.<br/>SIMPLIFIED.</p>
          </div>
          <button className="footer-cta" onClick={() => go("home")}>
            <span>EXPLORE T-REX</span><Arrow />
          </button>
        </div>
        <div className="footer-bottom">
          <span>© 2026 T-REX</span>
          <span>CRYPTO COMPLIANCE INFRASTRUCTURE</span>
          <span>BUILT FOR A MORE VERIFIABLE DIGITAL ECONOMY.</span>
        </div>
      </footer>
    </div>
  );
}

export default App;