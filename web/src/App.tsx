import { useEffect, useState, useRef, type CSSProperties } from 'react';
import {
  ArrowRight,
  ArrowUp,
  Box,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  FileCode2,
  FolderOpen,
  Github,
  HardDrive,
  Loader2,
  Menu,
  Play,
  Plus,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';

const repo = 'https://github.com/empfi/MineDock';
const releases = `${repo}/releases`;
const software = [
  ['Vanilla', '/software/vanilla.svg'],
  ['Paper', '/software/paper.svg'],
  ['Purpur', '/software/purpur.svg'],
  ['Velocity', '/software/velocity.svg'],
  ['Fabric', '/software/fabric.png'],
  ['Forge', '/software/forge.svg'],
  ['NeoForge', '/software/neoforge.png'],
];

function Brand() {
  return <a className="brand" href="#" aria-label="MineDock home"><img src="/logo.png" alt="MineDock" /></a>;
}

function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="header">
      <Brand />
      <nav className={open ? 'nav open' : 'nav'} aria-label="Primary navigation">
        <a href="#proof" onClick={() => setOpen(false)}>How it works</a>
        <a href="#workflows" onClick={() => setOpen(false)}>Features</a>
        <a href={repo} target="_blank" rel="noreferrer">GitHub</a>
        <a className="nav-mobile-cta" href={releases} target="_blank" rel="noreferrer">Download MineDock <ArrowRight size={16} /></a>
      </nav>
      <a className="header-cta" href={releases} target="_blank" rel="noreferrer">Download <ArrowRight size={15} /></a>
      <button className="menu-button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label={open ? 'Close navigation' : 'Open navigation'}>
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">Minecraft Java servers, managed locally.</p>
        <h1><span>Your world.</span><span>Your machine.</span><span className="accent">One clean dock.</span></h1>
        <p className="hero-description">Create, run, configure, and protect real Minecraft servers from a focused Windows desktop app. No cloud panel to rent or maintain.</p>
        <div className="hero-actions">
          <a className="button primary" href={releases} target="_blank" rel="noreferrer"><Download size={17} /> Download for Windows</a>
          <a className="text-link" href={repo} target="_blank" rel="noreferrer"><Github size={17} /> Explore the source <ArrowRight size={15} /></a>
        </div>
      </div>
      <div className="hero-object" aria-label="MineDock local server flow">
        <div className="brand-stage">
          <span className="color-plane cyan-plane" />
          <span className="color-plane yellow-plane" />
          <div className="logo-tile"><img src="/logo.png" alt="" /></div>
        </div>
        <div className="fact fact-a"><span>01</span><strong>Real Java process</strong></div>
        <div className="fact fact-b"><span>02</span><strong>Direct file access</strong></div>
        <div className="fact fact-c"><span>03</span><strong>Local backups</strong></div>
      </div>
      <div className="hero-foot">
        <span><Check size={14} /> Open source</span>
        <span><Check size={14} /> No subscription</span>
        <span><Check size={14} /> Windows desktop app</span>
      </div>
    </section>
  );
}

function ProductProof() {
  return (
    <section className="proof reveal" id="proof" data-reveal>
      <div className="section-intro">
        <p>Less infrastructure</p>
        <h2>The shortest path between you and your server.</h2>
      </div>
      <div className="comparison">
        <div className="old-way">
          <p className="comparison-label">Traditional panel</p>
          <div className="stack">
            <span>Browser</span><ChevronRight size={15} /><span>Panel</span><ChevronRight size={15} /><span>Daemon</span><ChevronRight size={15} /><span>Server</span>
          </div>
          <p>Extra services, credentials, updates, and failure points.</p>
        </div>
        <div className="mine-way">
          <p className="comparison-label">MineDock</p>
          <div className="direct">
            <div><img src="/logo.png" alt="" /><strong>MineDock</strong></div>
            <ArrowRight size={22} />
            <div><Server size={22} /><strong>Your server</strong></div>
          </div>
          <p>One local app controlling the process and files directly.</p>
        </div>
      </div>
      <div className="supported" aria-label="Supported server software">
        {software.map(([name, icon], index) => (
          <figure key={name} className="reveal" data-reveal style={{ '--index': index } as CSSProperties}>
            <img src={icon} alt="" />
            <figcaption>{name}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

const workflows = [
  {
    icon: Box,
    label: 'Launch',
    title: 'From empty folder to online server.',
    text: 'Pick server software and version, choose memory and port, accept the EULA, and let MineDock prepare the files.',
    points: ['Guided creation', 'Official downloads', 'Version selection'],
    tone: 'cyan',
  },
  {
    icon: Terminal,
    label: 'Operate',
    title: 'Daily control without context switching.',
    text: 'Read live output, issue commands, inspect health, manage players, and edit configuration from the same workspace.',
    points: ['Live console', 'Visual properties', 'Player management'],
    tone: 'neutral',
  },
  {
    icon: ShieldCheck,
    label: 'Protect',
    title: 'Change things without risking the world.',
    text: 'Create complete ZIP backups before updates or experiments, then restore the entire server when needed.',
    points: ['Full snapshots', 'Fast restore', 'Local archives'],
    tone: 'yellow',
  },
];

function Workflows() {
  return (
    <section className="workflows" id="workflows">
      <div className="workflows-heading reveal" data-reveal>
        <p>One application</p>
        <h2>The complete server lifecycle.</h2>
      </div>
      <div className="workflow-list">
        {workflows.map(({ icon: Icon, label, title, text, points, tone }, index) => (
          <article className={`workflow ${tone} reveal`} data-reveal key={label} style={{ '--index': index } as CSSProperties}>
            <div className="workflow-index">0{index + 1}</div>
            <div className="workflow-icon"><Icon size={24} /></div>
            <div className="workflow-copy">
              <p>{label}</p>
              <h3>{title}</h3>
              <span>{text}</span>
            </div>
            <ul>{points.map(point => <li key={point}><Check size={14} /> {point}</li>)}</ul>
          </article>
        ))}
      </div>
    </section>
  );
}

const chatScript = [
  { sender: 'user', content: 'Find performance plugins' },
  { sender: 'ai', isThinking: true, duration: 1200 },
  { 
    sender: 'ai', 
    showDisclosure: true,
    content: 'Here are some top-rated performance plugins compatible with your Paper server:',
    plugins: [
      { id: 'chunky', name: 'Chunky', description: 'Pre-generates chunks to eliminate exploration lag.', installed: false },
      { id: 'spark', name: 'Spark', description: 'A performance profiling tool for CPU/RAM usage.', installed: false },
    ]
  },
  { sender: 'action-install', target: 'chunky' },
  { sender: 'ai-installing', target: 'chunky', duration: 1600 },
  { sender: 'ai-installed', target: 'chunky', toast: 'Chunky installed. Restart the server to load it.' },
  { sender: 'user', content: 'Looks good, restart the server.' },
  { sender: 'system', isThinking: true, duration: 1200, activity: 'Restarting Paper server...' },
  { sender: 'ai', content: 'Paper server has restarted successfully! Chunky is now active and ready. 🚀' }
];

function DockAiChat() {
  const [messages, setMessages] = useState<any[]>([]);
  const [step, setStep] = useState(0);
  const [plugins, setPlugins] = useState<any[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: any;
    
    const runScript = () => {
      if (step >= chatScript.length) {
        timer = setTimeout(() => {
          setMessages([]);
          setPlugins([]);
          setToast(null);
          setStep(0);
        }, 6000);
        return;
      }

      const current = chatScript[step];

      if (current.sender === 'user') {
        setMessages(prev => [...prev, { role: 'user', content: current.content }]);
        timer = setTimeout(() => setStep(s => s + 1), 1600);
      } 
      else if (current.sender === 'ai' && current.isThinking) {
        setMessages(prev => [...prev, { role: 'assistant', isThinking: true }]);
        timer = setTimeout(() => {
          setMessages(prev => prev.filter(m => !m.isThinking));
          setStep(s => s + 1);
        }, current.duration);
      } 
      else if (current.sender === 'ai') {
        setMessages(prev => [
          ...prev, 
          { 
            role: 'assistant', 
            content: current.content, 
            showDisclosure: current.showDisclosure,
            plugins: current.plugins 
          }
        ]);
        if (current.plugins) {
          setPlugins(current.plugins);
        }
        timer = setTimeout(() => setStep(s => s + 1), 2200);
      } 
      else if (current.sender === 'action-install') {
        setPlugins(prev => 
          prev.map(p => p.id === current.target ? { ...p, isHovered: true } : p)
        );
        timer = setTimeout(() => {
          setStep(s => s + 1);
        }, 800);
      } 
      else if (current.sender === 'ai-installing') {
        setPlugins(prev => 
          prev.map(p => p.id === current.target ? { ...p, isHovered: false, installing: true } : p)
        );
        timer = setTimeout(() => setStep(s => s + 1), current.duration);
      } 
      else if (current.sender === 'ai-installed') {
        setPlugins(prev => 
          prev.map(p => p.id === current.target ? { ...p, installed: true, installing: false } : p)
        );
        if (current.toast) {
          setToast(current.toast);
          setTimeout(() => setToast(null), 3000);
        }
        timer = setTimeout(() => setStep(s => s + 1), 2000);
      }
      else if (current.sender === 'system' && current.isThinking) {
        setMessages(prev => [...prev, { role: 'assistant', isThinking: true, activity: current.activity }]);
        timer = setTimeout(() => {
          setMessages(prev => prev.filter(m => !m.isThinking));
          setStep(s => s + 1);
        }, current.duration);
      }
    };

    runScript();
    return () => clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, plugins]);

  return (
    <div className="chat-window">
      {toast && (
        <div className="chat-toast">
          <Check size={12} className="toast-icon" />
          <span>{toast}</span>
        </div>
      )}

      <div className="chat-header">
        <div className="chat-header-left">
          <img src="/logo.png" alt="" className="chat-header-logo" />
          <div className="chat-header-title-wrap">
            <span className="chat-header-title">DockAI</span>
            <span className="chat-header-subtitle">Server assistant</span>
          </div>
          <span className="mock-server-badge">Survival · paper</span>
        </div>
        <div className="chat-header-right">
          <button className="mock-header-btn"><Plus size={11} /> New chat</button>
          <span className="mock-model-select">openrouter/free</span>
        </div>
      </div>

      <div className="chat-messages" ref={containerRef}>
        {messages.map((msg, idx) => (
          <div key={idx} className={`chat-message ${msg.role === 'user' ? 'user' : 'assistant'}`}>
            {msg.role === 'assistant' && (
              <img src="/logo.png" alt="" className="chat-avatar" />
            )}
            
            <div className="chat-content-block">
              {msg.role === 'assistant' && msg.showDisclosure && (
                <div className="mock-details">
                  <CheckCircle2 size={12} className="mock-check-circle" />
                  <span>Completed in 1.4s</span>
                  <ChevronRight size={11} className="mock-chevron" />
                </div>
              )}

              {msg.isThinking ? (
                <div className="assistant-thinking-label">
                  {msg.activity || 'Reading your request...'}
                </div>
              ) : (
                <div className="chat-text-content">
                  {msg.content}
                </div>
              )}

              {msg.plugins && (
                <div className="mock-plugins-grid">
                  {plugins.map((plugin) => (
                    <div key={plugin.id} className="mock-plugin-card">
                      <div className="mock-plugin-icon">
                        <Search size={14} />
                      </div>
                      <div className="mock-plugin-info">
                        <div className="mock-plugin-title-row">
                          <span className="mock-plugin-name">{plugin.name}</span>
                        </div>
                        <p className="mock-plugin-desc">{plugin.description}</p>
                      </div>
                      <button 
                        disabled={plugin.installed || plugin.installing}
                        className={`mock-plugin-btn ${plugin.isHovered ? 'mock-hover' : ''} ${plugin.installed ? 'installed' : ''}`}
                      >
                        {plugin.installing ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : plugin.installed ? (
                          <Check size={12} />
                        ) : (
                          <Download size={12} />
                        )}
                        <span>
                          {plugin.installing ? 'Installing' : plugin.installed ? 'Installed' : 'Install'}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="chat-footer">
        <div className="mock-composer">
          <div className="mock-input-text">
            {step < chatScript.length && chatScript[step].sender === 'user' ? (
              <span className="typing-text">{chatScript[step].content}</span>
            ) : (
              <span className="mock-placeholder">Describe the server or addition you want…</span>
            )}
          </div>
          <button className={`mock-send-btn ${step < chatScript.length && chatScript[step].sender === 'user' ? 'active' : ''}`}>
            <ArrowUp size={14} strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </div>
  );
}

function LocalFirst() {
  return (
    <div className="local-first reveal" data-reveal style={{ '--index': 1 } as CSSProperties}>
      <div className="local-copy">
        <p>Local-first, not cloud-dependent</p>
        <h2>Everything important stays with you.</h2>
      </div>
      <div className="ownership">
        <div><FolderOpen size={20} /><span>Your worlds</span></div>
        <div><FileCode2 size={20} /><span>Your configs</span></div>
        <div><Database size={20} /><span>Your backups</span></div>
        <div><HardDrive size={20} /><span>Your machine</span></div>
      </div>
    </div>
  );
}

function AiAssistant() {
  return (
    <div className="ai-section reveal" data-reveal style={{ '--index': 0 } as CSSProperties}>
      <div className="ai-content-wrap">
        <div className="ai-header-block">
          <div className="ai-mark"><BrainCircuit size={24} /></div>
          <p className="ai-eyebrow">DockAI</p>
        </div>
        <div className="ai-copy">
          <h2>A server expert, built into the dock.</h2>
          <span>Bring logs, crashes, configuration questions, and plugin or mod decisions into one assistant that already understands your active server.</span>
        </div>
      </div>
      <div className="ai-capabilities">
        <DockAiChat />
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer>
      <div><Brand /><p>Local Minecraft server management.</p></div>
      <div className="footer-links">
        <a href={repo} target="_blank" rel="noreferrer">Repository</a>
        <a href={releases} target="_blank" rel="noreferrer">Releases</a>
        <a href={`${repo}#readme`} target="_blank" rel="noreferrer">README</a>
      </div>
      <span>© 2026 MineDock</span>
    </footer>
  );
}

function App() {
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.16 });
    document.querySelectorAll('[data-reveal]').forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <Header />
      <div className="glow-blob blob-1" />
      <div className="glow-blob blob-2" />
      <main>
        <Hero />
        <ProductProof />
        <Workflows />
        <section className="features-grid">
          <AiAssistant />
          <LocalFirst />
        </section>
      </main>
      <Footer />
    </>
  );
}

export default App;
