import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  BarChart3,
  Bell,
  Brain,
  Building2,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardList,
  FileSearch,
  FileText,
  Gauge,
  Gavel,
  Home,
  ImagePlus,
  Landmark,
  LockKeyhole,
  LogOut,
  Menu,
  Phone,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
  Upload,
  UserRound,
  Users,
  X
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import './styles.css';

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
const statusColors = { 'On Track': '#1f8f4d', 'At Risk': '#f59e0b', 'Off Track': '#df2c1d' };

function App() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('session') || 'null'));
  const [settings, setSettings] = useState(null);
  const [overview, setOverview] = useState(null);
  const [active, setActive] = useState('overview');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadPublic();
  }, []);

  useEffect(() => {
    if (session) {
      localStorage.setItem('session', JSON.stringify(session));
      loadOverview(session.token);
    } else {
      localStorage.removeItem('session');
      setOverview(null);
    }
  }, [session]);

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;
    if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API}${path}`, { ...options, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Request failed');
    return data;
  }

  async function loadPublic() {
    const res = await fetch(`${API}/api/public/settings`);
    setSettings(await res.json());
  }

  async function loadOverview(token = session?.token) {
    if (!token) return;
    setLoading(true);
    const res = await fetch(`${API}/api/overview`, { headers: { Authorization: `Bearer ${token}` } });
    setOverview(await res.json());
    setLoading(false);
  }

  if (!session) {
    return <Login settings={settings} onSession={setSession} />;
  }

  const projects = overview?.projects || [];
  const ministries = overview?.ministries || [];

  return (
    <div className="app-shell">
      <Sidebar active={active} setActive={setActive} settings={settings} session={session} onLogout={() => setSession(null)} />
      <main className="workspace">
        <TopBar settings={settings} session={session} refresh={() => loadOverview()} loading={loading} />
        {active === 'overview' && <Overview overview={overview} loading={loading} />}
        {active === 'ministries' && <Ministries ministries={ministries} projects={projects} />}
        {active === 'projects' && <Projects projects={projects} ministries={ministries} api={api} reload={loadOverview} />}
        {active === 'workflow' && <Workflow overview={overview} api={api} reload={loadOverview} />}
        {active === 'evidence' && <Evidence projects={projects} api={api} reload={loadOverview} />}
        {active === 'decisions' && <Decisions overview={overview} api={api} reload={loadOverview} />}
        {active === 'disciplines' && <Disciplines overview={overview} />}
        {active === 'admin' && session.user.role === 'admin' && <Admin settings={settings} setSettings={setSettings} api={api} reload={loadOverview} />}
      </main>
    </div>
  );
}

function Login({ settings, onSession }) {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('phone');
  const [demoOtp, setDemoOtp] = useState('');
  const [error, setError] = useState('');

  async function requestOtp(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`${API}/api/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Unable to send OTP');
      setDemoOtp(data.demo_otp);
      setStep('otp');
    } catch (err) {
      setError(err.message);
    }
  }

  async function verifyOtp(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`${API}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Invalid OTP');
      onSession(data);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="login-scene">
      <div className="login-vehicle">
        <div className="road-glow" />
        <div className="dash-cluster">
          <Gauge size={42} />
          <div>
            <span>4DX Control Center</span>
            <strong>{settings?.title || 'Government Execution Dashboard'}</strong>
          </div>
        </div>
      </div>
      <motion.form className="login-panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} onSubmit={step === 'phone' ? requestOtp : verifyOtp}>
        <div className="brand-mark">{settings?.logo_url ? <img src={settings.logo_url} alt="" /> : <Shield />}</div>
        <h1>{settings?.title || '4DX Mission Dashboard'}</h1>
        <p>Mobile OTP access for administrators and execution teams.</p>
        <label>
          <span>Mobile number</span>
          <div className="input-wrap"><Phone size={18} /><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" required /></div>
        </label>
        {step === 'otp' && (
          <label>
            <span>One-time password</span>
            <div className="input-wrap"><LockKeyhole size={18} /><input value={otp} onChange={e => setOtp(e.target.value)} placeholder="6 digit OTP" required /></div>
            <small>Demo OTP: {demoOtp}</small>
          </label>
        )}
        {error && <div className="error">{error}</div>}
        <button className="primary-btn" type="submit">{step === 'phone' ? 'Send OTP' : 'Enter Dashboard'}<ChevronRight size={18} /></button>
        <div className="demo-note">Admin demo: any number ending in 0000. Regular user: any other number.</div>
      </motion.form>
    </div>
  );
}

function Sidebar({ active, setActive, settings, session, onLogout }) {
  const items = [
    ['overview', Home, 'Overview'],
    ['ministries', Landmark, 'Ministries'],
    ['projects', ClipboardList, 'Projects'],
    ['workflow', Users, 'Workflow'],
    ['evidence', FileSearch, 'Evidence AI'],
    ['decisions', Gavel, 'Decisions'],
    ['disciplines', Target, '4 Disciplines']
  ];
  if (session.user.role === 'admin') items.push(['admin', Settings, 'Admin']);

  return (
    <aside className="sidebar">
      <div className="side-brand">
        {settings?.logo_url ? <img src={settings.logo_url} alt="" /> : <Building2 />}
        <div><strong>4DX</strong><span>{session.user.role}</span></div>
      </div>
      <nav>
        {items.map(([id, Icon, label]) => (
          <button key={id} className={active === id ? 'active' : ''} onClick={() => setActive(id)}>
            <Icon size={21} /> <span>{label}</span>
          </button>
        ))}
      </nav>
      <button className="logout" onClick={onLogout}><LogOut size={19} /> Sign out</button>
    </aside>
  );
}

function TopBar({ settings, session, refresh, loading }) {
  return (
    <header className="app-header">
      <img className="app-header-banner" src="/karnataka-ai-header-2026.png" alt="AI in Government of Karnataka" />
      <div className="topbar">
        <button className="icon-btn"><Menu size={20} /></button>
        <div>
          <h2>{settings?.title || 'Execution Command Center'}</h2>
          <p>{settings?.banner || 'High level view. Right insights. Timely interventions.'}</p>
        </div>
        <button className="refresh-btn" onClick={refresh}><RefreshCw size={17} className={loading ? 'spin' : ''} /> Refresh</button>
        <div className="user-pill"><UserRound size={18} /> {session.user.phone}</div>
      </div>
    </header>
  );
}

function Modal({ title, children, onClose, wide = false, className = '' }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <motion.div
        className={`modal-panel ${wide ? 'wide' : ''} ${className}`}
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className={`modal-head ${title ? '' : 'no-title'}`}>
          {title ? <h3>{title}</h3> : <span />}
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function Overview({ overview, loading }) {
  const stats = overview?.stats || { total: 0, on_track: 0, at_risk: 0, off_track: 0, health_score: 0 };
  const projects = overview?.projects || [];
  const trend = [
    { name: 'W1', value: Math.max(35, stats.health_score - 18) },
    { name: 'W2', value: Math.max(40, stats.health_score - 10) },
    { name: 'W3', value: Math.max(42, stats.health_score - 7) },
    { name: 'W4', value: Math.max(44, stats.health_score - 3) },
    { name: 'Now', value: stats.health_score }
  ];

  return (
    <section className="panel-stack">
      <div className="metric-grid">
        <Metric icon={ClipboardList} label="Major Projects" value={stats.total} />
        <Metric icon={Check} label="On Track" value={stats.on_track} tone="green" sub={`${percent(stats.on_track, stats.total)}%`} />
        <Metric icon={AlertTriangle} label="At Risk" value={stats.at_risk} tone="amber" sub={`${percent(stats.at_risk, stats.total)}%`} />
        <Metric icon={X} label="Off Track" value={stats.off_track} tone="red" sub={`${percent(stats.off_track, stats.total)}%`} />
        <div className="metric health-card">
          <span>Auto Health</span>
          <div className="health-ring" style={{ '--score': `${stats.health_score * 3.6}deg` }}><strong>{stats.health_score}%</strong></div>
          <small>Vector evidence scored</small>
        </div>
      </div>

      <div className="dashboard-grid">
        <InsightCard title="What Is Working" icon={TrendingUp} tone="green" items={overview?.what_is_working || []} />
        <InsightCard title="What Is Not Working" icon={TrendingDown} tone="red" items={overview?.what_is_not_working || []} />
        <Bottlenecks bottlenecks={overview?.bottlenecks || []} />
        <div className="card ask-card">
          <h3>What the CM Wants to Know</h3>
          {['Which project needs intervention today?', 'Which evidence changed health status?', 'Which ministry owns the blocker?', 'What action is assigned?', 'What decision is pending?'].map((q, i) => (
            <p key={q}><span>{i + 1}</span>{q}</p>
          ))}
        </div>
        <div className="card immediate-card">
          <h3><Bell size={20} /> Immediate Attention</h3>
          {projects.filter(p => p.status !== 'On Track').slice(0, 5).map(p => <p key={p._id}><span>{p.name}</span><b>{p.status}</b></p>)}
        </div>
        <div className="card chart-card">
          <h3>Portfolio Health Trend</h3>
          <ResponsiveContainer width="100%" height={155}>
            <AreaChart data={trend}>
              <defs><linearGradient id="health" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#1f8f4d" stopOpacity={0.35} /><stop offset="95%" stopColor="#1f8f4d" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="#e9edf4" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <YAxis hide domain={[0, 100]} />
              <Tooltip />
              <Area type="monotone" dataKey="value" stroke="#1f8f4d" fill="url(#health)" strokeWidth={3} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      {loading && <div className="loading">Refreshing decision intelligence...</div>}
    </section>
  );
}

function Metric({ icon: Icon, label, value, sub, tone = 'navy' }) {
  return <div className={`metric ${tone}`}><Icon size={34} /><span>{label}</span><strong>{value}</strong>{sub && <small>({sub})</small>}</div>;
}

function InsightCard({ title, icon: Icon, items, tone }) {
  return (
    <div className={`card insight ${tone}`}>
      <h3><Icon size={27} /> {title}</h3>
      {(items.length ? items : ['Evidence will appear after project documents are scored.']).map(item => <p key={item}><Check size={17} /> {item}</p>)}
    </div>
  );
}

function Bottlenecks({ bottlenecks }) {
  return (
    <div className="card bottleneck-card">
      <h3><Activity size={22} /> Top Bottlenecks</h3>
      {(bottlenecks.length ? bottlenecks : [{ name: 'No major blocker', count: 0 }]).map(b => (
        <div className="bar-row" key={b.name}>
          <span>{b.name}</span>
          <div><i style={{ width: `${Math.max(10, b.count * 20)}%` }} /></div>
          <b>{b.count}</b>
        </div>
      ))}
    </div>
  );
}

function Ministries({ ministries, projects }) {
  return (
    <section className="ministry-grid">
      {ministries.map(ministry => {
        const owned = projects.filter(p => p.ministry_id === ministry._id);
        return (
          <div className="card ministry-card" key={ministry._id}>
            <div className="ministry-head">
              <Landmark size={25} />
              <div><h3>{ministry.name}</h3><p>{ministry.mandate}</p></div>
            </div>
            <div className="mini-list">
              {owned.map(p => <p key={p._id}><span>{p.name}</span><b style={{ color: statusColors[p.status] }}>{p.status}</b></p>)}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Projects({ projects, ministries, api, reload }) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [detailProject, setDetailProject] = useState(null);
  const [query, setQuery] = useState('');
  const filteredProjects = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return projects;
    return projects.filter(project => {
      const wigText = (project.wigs || []).map(wig => `${wig.title} ${(wig.lead_measures || []).map(measure => measure.title).join(' ')}`).join(' ');
      return [
        project.name,
        project.ministry,
        project.owner,
        project.status,
        wigText
      ].join(' ').toLowerCase().includes(text);
    });
  }, [projects, query]);

  return (
    <section className="tesla-stage">
      <div className="stage-toolbar">
        <div>
          <h3>Projects</h3>
          <span>{filteredProjects.length} of {projects.length} active missions</span>
        </div>
        <div className="stage-actions">
          <label className="project-search">
            <Search size={16} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search projects, WIGs, owners" />
          </label>
          <button className="primary-btn" onClick={() => setWizardOpen(true)}>Create Project</button>
        </div>
      </div>
      <div className="project-list clean-list project-card-grid">
        {filteredProjects.map(project => <ProjectRow key={project._id} project={project} onOpen={() => setDetailProject(project)} />)}
        {filteredProjects.length === 0 && <p className="empty-state">No projects match this search.</p>}
      </div>

      {wizardOpen && <ProjectSetupWizard ministries={ministries} api={api} reload={reload} onClose={() => setWizardOpen(false)} />}

      {detailProject && <ProjectDetailModal project={detailProject} api={api} reload={reload} onClose={() => setDetailProject(null)} />}
    </section>
  );
}

function ProjectSetupWizard({ ministries, api, reload, onClose }) {
  const [step, setStep] = useState('project');
  const [project, setProject] = useState(null);
  const [activeWigId, setActiveWigId] = useState('');
  const [saving, setSaving] = useState(false);
  const [projectDraft, setProjectDraft] = useState({
    name: '',
    ministry_id: ministries[0]?._id || '',
    owner: '',
    current_state: '',
    target_state: '',
    due_date: '',
    budget_crore: 0
  });
  const [wigDraft, setWigDraft] = useState({
    title: '',
    current_state: '',
    target_state: '',
    from_value: 0,
    to_value: 100,
    unit: '% completion',
    deadline: '',
    owner: ''
  });
  const [measureDraft, setMeasureDraft] = useState({
    title: '',
    current_state: '',
    target_state: '',
    from_value: 0,
    to_value: 100,
    unit: '%',
    deadline: '',
    assigned_to: ''
  });

  useEffect(() => {
    if (!projectDraft.ministry_id && ministries[0]?._id) {
      setProjectDraft(prev => ({ ...prev, ministry_id: ministries[0]._id }));
    }
  }, [ministries, projectDraft.ministry_id]);

  const wigs = useMemo(() => (project?.wigs || []).filter(wig => !wig.archived_at), [project]);
  const activeWig = wigs.find(wig => wig.id === activeWigId) || wigs[0] || null;
  const stepIndex = step === 'project' ? 0 : step === 'wigs' ? 1 : 2;

  async function createProject(e) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget).entries());
    setSaving(true);
    try {
      const data = await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: String(values.name || '').trim(),
          ministry_id: values.ministry_id,
          owner: String(values.owner || '').trim(),
          current_state: String(values.current_state || '').trim(),
          target_state: String(values.target_state || '').trim(),
          due_date: values.due_date,
          budget_crore: Number(values.budget_crore) || 0
        })
      });
      setProject(data);
      setStep('wigs');
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function addWig(e) {
    e.preventDefault();
    if (!project?._id) return;
    const values = Object.fromEntries(new FormData(e.currentTarget).entries());
    setSaving(true);
    try {
      const data = await api(`/api/projects/${project._id}/wigs`, {
        method: 'POST',
        body: JSON.stringify({
          title: String(values.title || '').trim(),
          current_state: String(values.current_state || '').trim(),
          target_state: String(values.target_state || '').trim(),
          from_value: Number(values.from_value) || 0,
          to_value: Number(values.to_value) || 0,
          unit: String(values.unit || '').trim(),
          deadline: values.deadline,
          owner: String(values.owner || '').trim()
        })
      });
      const nextWigs = (data.wigs || []).filter(wig => !wig.archived_at);
      const newestWig = nextWigs[nextWigs.length - 1];
      setProject(data);
      setActiveWigId(newestWig?.id || '');
      setWigDraft({
        title: '',
        current_state: '',
        target_state: '',
        from_value: 0,
        to_value: 100,
        unit: '% completion',
        deadline: '',
        owner: String(values.owner || '').trim()
      });
      setStep('measures');
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function addMeasure(e) {
    e.preventDefault();
    if (!project?._id || !activeWig?.id) return;
    const values = Object.fromEntries(new FormData(e.currentTarget).entries());
    setSaving(true);
    try {
      const data = await api(`/api/projects/${project._id}/wigs/${activeWig.id}/lead-measures`, {
        method: 'POST',
        body: JSON.stringify({
          title: String(values.title || '').trim(),
          current_state: String(values.current_state || '').trim(),
          target_state: String(values.target_state || '').trim(),
          from_value: Number(values.from_value) || 0,
          to_value: Number(values.to_value) || 0,
          unit: String(values.unit || '').trim(),
          deadline: values.deadline,
          assigned_to: String(values.assigned_to || '').split(',').map(item => item.trim()).filter(Boolean)
        })
      });
      setProject(data);
      setMeasureDraft({
        title: '',
        current_state: '',
        target_state: '',
        from_value: 0,
        to_value: 100,
        unit: String(values.unit || measureDraft.unit || '%').trim(),
        deadline: '',
        assigned_to: String(values.assigned_to || '').trim()
      });
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function finishSetup() {
    await reload();
    onClose();
  }

  function projectSummary() {
    if (!project) return null;
    return (
      <div className="wizard-summary">
        <span>Project</span>
        <strong>{project.name}</strong>
        <small>{project.ministry} | {project.owner}</small>
      </div>
    );
  }

  return (
    <Modal title="Create 4DX Workflow" onClose={onClose} wide className="setup-wizard-modal">
      <div className="wizard-shell">
        <div className="wizard-steps">
          {['Project', 'WIGs / Milestones', 'Lead Measures'].map((label, index) => (
            <button
              key={label}
              type="button"
              className={`wizard-step ${stepIndex === index ? 'active' : ''} ${stepIndex > index ? 'done' : ''}`}
              onClick={() => {
                if (index === 0) setStep('project');
                if (index === 1 && project) setStep('wigs');
                if (index === 2 && wigs.length) setStep('measures');
              }}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <p>{label}</p>
            </button>
          ))}
        </div>

        {step === 'project' && (
          <div className="wizard-layout single">
            <form className="wizard-panel" onSubmit={createProject}>
              <div className="wizard-panel-head">
                <span>Project setup</span>
                <h4>Create one project first</h4>
              </div>
              <label className="field full-span">
                <span>Project Name</span>
                <input name="name" value={projectDraft.name} onChange={e => setProjectDraft({ ...projectDraft, name: e.target.value })} required />
              </label>
              <label className="field">
                <span>Ministry</span>
                <select name="ministry_id" value={projectDraft.ministry_id} onChange={e => setProjectDraft({ ...projectDraft, ministry_id: e.target.value })} required>
                  {ministries.map(ministry => <option key={ministry._id} value={ministry._id}>{ministry.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Owner</span>
                <input name="owner" value={projectDraft.owner} onChange={e => setProjectDraft({ ...projectDraft, owner: e.target.value })} required />
              </label>
              <label className="field full-span">
                <span>Current State</span>
                <textarea className="compact-textarea" name="current_state" value={projectDraft.current_state} onChange={e => setProjectDraft({ ...projectDraft, current_state: e.target.value })} placeholder="Where the project is today" required />
              </label>
              <label className="field full-span">
                <span>Target State</span>
                <textarea className="compact-textarea" name="target_state" value={projectDraft.target_state} onChange={e => setProjectDraft({ ...projectDraft, target_state: e.target.value })} placeholder="What success must look like" required />
              </label>
              <label className="field">
                <span>Target Date</span>
                <input name="due_date" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" value={projectDraft.due_date} onChange={e => setProjectDraft({ ...projectDraft, due_date: e.target.value })} required />
              </label>
              <label className="field">
                <span>Budget Crore</span>
                <input name="budget_crore" type="number" min="0" value={projectDraft.budget_crore} onChange={e => setProjectDraft({ ...projectDraft, budget_crore: e.target.value })} />
              </label>
              <div className="wizard-actions full-span">
                <button className="primary-btn" disabled={saving}>{saving ? 'Creating...' : 'Create Project'}</button>
              </div>
            </form>
          </div>
        )}

        {step === 'wigs' && project && (
          <div className="wizard-layout">
            <form className="wizard-panel" onSubmit={addWig}>
              <div className="wizard-panel-head">
                <span>WIGs / Milestones</span>
                <h4>Add measurable milestones</h4>
              </div>
              {projectSummary()}
              <label className="field full-span">
                <span>WIG / Milestone Title</span>
                <input name="title" value={wigDraft.title} onChange={e => setWigDraft({ ...wigDraft, title: e.target.value })} required />
              </label>
              <label className="field full-span">
                <span>Current State</span>
                <textarea className="compact-textarea" name="current_state" value={wigDraft.current_state} onChange={e => setWigDraft({ ...wigDraft, current_state: e.target.value })} placeholder="Current milestone condition" required />
              </label>
              <label className="field full-span">
                <span>Target State</span>
                <textarea className="compact-textarea" name="target_state" value={wigDraft.target_state} onChange={e => setWigDraft({ ...wigDraft, target_state: e.target.value })} placeholder="Target milestone outcome" required />
              </label>
              <label className="field">
                <span>From X</span>
                <input name="from_value" type="number" value={wigDraft.from_value} onChange={e => setWigDraft({ ...wigDraft, from_value: e.target.value })} />
              </label>
              <label className="field">
                <span>To Y</span>
                <input name="to_value" type="number" value={wigDraft.to_value} onChange={e => setWigDraft({ ...wigDraft, to_value: e.target.value })} required />
              </label>
              <label className="field">
                <span>Unit</span>
                <input name="unit" value={wigDraft.unit} onChange={e => setWigDraft({ ...wigDraft, unit: e.target.value })} required />
              </label>
              <label className="field">
                <span>Deadline</span>
                <input name="deadline" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" value={wigDraft.deadline} onChange={e => setWigDraft({ ...wigDraft, deadline: e.target.value })} required />
              </label>
              <label className="field full-span">
                <span>WIG Owner</span>
                <input name="owner" value={wigDraft.owner} onChange={e => setWigDraft({ ...wigDraft, owner: e.target.value })} required />
              </label>
              <div className="wizard-actions full-span">
                <button className="primary-btn" disabled={saving}>{saving ? 'Adding...' : 'Add WIG'}</button>
                <button className="ghost-btn" type="button" disabled={!wigs.length} onClick={() => setStep('measures')}>Lead Measures</button>
              </div>
            </form>

            <aside className="wizard-side">
              <div className="wizard-panel-head">
                <span>{wigs.length} added</span>
                <h4>Collapsed WIG list</h4>
              </div>
              <div className="wizard-list">
                {wigs.length === 0 && <p className="wizard-empty">Added WIGs will appear here.</p>}
                {wigs.map((wig, index) => (
                  <button
                    type="button"
                    className={`wizard-row ${wig.id === activeWigId ? 'active' : ''}`}
                    key={wig.id}
                    onClick={() => { setActiveWigId(wig.id); setStep('measures'); }}
                  >
                    <span className="wizard-row-count">{String(index + 1).padStart(2, '0')}</span>
                    <span className="wizard-row-main">
                      <strong>{wig.title}</strong>
                      <small>Current: {currentStateText(wig)} | Target: {targetStateText(wig)} | Deadline: {deadlineText(wig)}</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
            </aside>
          </div>
        )}

        {step === 'measures' && project && (
          <div className="wizard-layout">
            <section className="wizard-panel">
              <div className="wizard-panel-head">
                <span>Lead Measures</span>
                <h4>Add actions under the selected WIG</h4>
              </div>
              {projectSummary()}
              <div className="wizard-accordion">
                {wigs.length === 0 && <p className="wizard-empty">Add at least one WIG before assigning lead measures.</p>}
                {wigs.map((wig, index) => {
                  const expanded = (activeWig?.id || '') === wig.id;
                  const measures = (wig.lead_measures || []).filter(measure => !measure.archived_at);
                  return (
                    <article className={`wizard-accordion-item ${expanded ? 'active' : ''}`} key={wig.id}>
                      <button className="wizard-accordion-head" type="button" onClick={() => setActiveWigId(wig.id)}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <div>
                          <strong>{wig.title}</strong>
                          <small>{measures.length} lead measures | {wig.owner}</small>
                        </div>
                        <ChevronRight size={16} />
                      </button>
                      {expanded && (
                        <div className="wizard-accordion-body">
                          <form className="measure-entry-form" onSubmit={addMeasure}>
                            <label className="field full-span">
                              <span>Lead Measure Title</span>
                              <input name="title" value={measureDraft.title} onChange={e => setMeasureDraft({ ...measureDraft, title: e.target.value })} required />
                            </label>
                            <label className="field full-span">
                              <span>Current State</span>
                              <textarea className="compact-textarea" name="current_state" value={measureDraft.current_state} onChange={e => setMeasureDraft({ ...measureDraft, current_state: e.target.value })} placeholder="Current action baseline" required />
                            </label>
                            <label className="field full-span">
                              <span>Target State</span>
                              <textarea className="compact-textarea" name="target_state" value={measureDraft.target_state} onChange={e => setMeasureDraft({ ...measureDraft, target_state: e.target.value })} placeholder="Lead measure target outcome" required />
                            </label>
                            <label className="field">
                              <span>From X</span>
                              <input name="from_value" type="number" value={measureDraft.from_value} onChange={e => setMeasureDraft({ ...measureDraft, from_value: e.target.value })} />
                            </label>
                            <label className="field">
                              <span>To Y</span>
                              <input name="to_value" type="number" value={measureDraft.to_value} onChange={e => setMeasureDraft({ ...measureDraft, to_value: e.target.value })} required />
                            </label>
                            <label className="field">
                              <span>Unit</span>
                              <input name="unit" value={measureDraft.unit} onChange={e => setMeasureDraft({ ...measureDraft, unit: e.target.value })} required />
                            </label>
                            <label className="field">
                              <span>Deadline</span>
                              <input name="deadline" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" value={measureDraft.deadline} onChange={e => setMeasureDraft({ ...measureDraft, deadline: e.target.value })} required />
                            </label>
                            <label className="field full-span">
                              <span>Assigned To</span>
                              <input name="assigned_to" value={measureDraft.assigned_to} onChange={e => setMeasureDraft({ ...measureDraft, assigned_to: e.target.value })} placeholder="Names separated by comma" required />
                            </label>
                            <div className="wizard-actions full-span">
                              <button className="primary-btn" disabled={saving}>{saving ? 'Adding...' : 'Add Lead Measure'}</button>
                            </div>
                          </form>

                          <div className="measure-mini-list">
                            {measures.length === 0 && <p className="wizard-empty">Lead measures added here will stay attached to this WIG.</p>}
                            {measures.map(measure => (
                              <div className="measure-mini-row" key={measure.id}>
                                <Target size={15} />
                                <span>
                                  <strong>{measure.title}</strong>
                                  <small>Current: {currentStateText(measure)} | Target: {targetStateText(measure)} | Deadline: {deadlineText(measure)}</small>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
              <div className="wizard-actions">
                <button className="ghost-btn" type="button" onClick={() => setStep('wigs')}>Add Another WIG</button>
                <button className="primary-btn" type="button" onClick={finishSetup}>Finish Setup</button>
              </div>
            </section>

            <aside className="wizard-side">
              <div className="wizard-panel-head">
                <span>Workflow summary</span>
                <h4>{project.name}</h4>
              </div>
              <div className="wizard-list">
                {wigs.map(wig => (
                  <button
                    key={wig.id}
                    type="button"
                    className={`wizard-row ${activeWig?.id === wig.id ? 'active' : ''}`}
                    onClick={() => setActiveWigId(wig.id)}
                  >
                    <span className="wizard-row-count">{(wig.lead_measures || []).length}</span>
                    <span className="wizard-row-main">
                      <strong>{wig.title}</strong>
                      <small>lead measures</small>
                    </span>
                  </button>
                ))}
              </div>
            </aside>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ProjectRow({ project, onOpen }) {
  return (
    <article className="project-row compact-project" onClick={onOpen}>
      <div className="project-icon">{project.name.slice(0, 1)}</div>
      <div>
        <h4>{project.name}</h4>
        <p>{project.ministry} | {project.owner}</p>
        <div className="compact-meta">
          <span>{project.wigs?.length || 0} WIGs</span>
          <span>{countMeasures(project)} lead measures</span>
          <span>{project.evidence_count || 0} docs</span>
        </div>
        <div className="milestones">
          {project.milestones.map(m => <span key={m.name}><b>{m.name}</b><i><em style={{ width: `${m.progress}%`, background: statusColors[m.status] || '#8b95a5' }} /></i></span>)}
        </div>
      </div>
      <div className="status-stack">
        <strong style={{ color: statusColors[project.status] }}>{project.status}</strong>
        <span>{project.health_score}%</span>
        <button className="ghost-btn" type="button">Open</button>
      </div>
    </article>
  );
}

function ProjectDetailModal({ project, api, reload, onClose }) {
  const [bundle, setBundle] = useState(null);
  const [action, setAction] = useState(null);
  const [measureDraft, setMeasureDraft] = useState({});
  const [newWigDraft, setNewWigDraft] = useState({ title: '', current_state: '', target_state: '', from_value: 0, to_value: 100, unit: '% completion', deadline: '', owner: '' });
  const [newLeadDraft, setNewLeadDraft] = useState({ title: '', current_state: '', target_state: '', from_value: 0, to_value: 100, unit: '%', deadline: '', assigned_to: '' });
  const [evidenceDraft, setEvidenceDraft] = useState({ title: '', document_type: 'Progress Note', content: '' });
  const [progressDraft, setProgressDraft] = useState({ current_value: 0, note: '', health_state: 'green', author: '' });
  const [commentDraft, setCommentDraft] = useState({ comment: '', health_state: 'green', author: '' });
  const [approvalDraft, setApprovalDraft] = useState({ title: '', requested_by: '', summary: '', due_date: '' });
  const [meetingDraft, setMeetingDraft] = useState({ meeting_date: '', facilitator: '', notes: '', commitments: '' });
  const [selectedWigId, setSelectedWigId] = useState(null);
  const [selectedMeasureDetail, setSelectedMeasureDetail] = useState(null);
  const [timelineSort, setTimelineSort] = useState('latest');
  const [activitySort, setActivitySort] = useState('latest');
  const currentProject = bundle?.project || project;
  const currentWigs = useMemo(() => (currentProject.wigs || []).filter(wig => !wig.archived_at), [currentProject]);
  const selectedWig = currentWigs.find(wig => wig.id === selectedWigId) || null;
  const detailWig = selectedMeasureDetail ? currentWigs.find(wig => wig.id === selectedMeasureDetail.wigId) : null;
  const detailMeasure = detailWig?.lead_measures?.find(measure => measure.id === selectedMeasureDetail?.measureId) || null;
  const timelineMeasures = useMemo(() => {
    if (!selectedWig) return [];
    const direction = timelineSort === 'latest' ? -1 : 1;
    return [...(selectedWig.lead_measures || [])]
      .filter(measure => !measure.archived_at)
      .sort((a, b) => direction * (dateValue(a.deadline) - dateValue(b.deadline)));
  }, [selectedWig, timelineSort]);
  const measureActivity = useMemo(() => buildMeasureActivity(detailMeasure, bundle, activitySort), [detailMeasure, bundle, activitySort]);
  const measureEvidence = useMemo(() => {
    if (!detailMeasure) return [];
    return (bundle?.documents || []).filter(doc => doc.measure_id === detailMeasure.id);
  }, [bundle, detailMeasure]);

  useEffect(() => {
    setSelectedWigId(null);
    setSelectedMeasureDetail(null);
    loadBundle();
  }, [project._id]);

  async function loadBundle() {
    setBundle(await api(`/api/projects/${project._id}/evidence`));
  }

  function openAction(type, wig, measure) {
    setAction({ type, wig, measure });
    if (measure) {
      setMeasureDraft({
        title: measure.title,
        current_state: measure.current_state || '',
        target_state: measure.target_state || '',
        from_value: measure.from_value,
        to_value: measure.to_value,
        current_value: measure.current_value ?? measure.from_value,
        unit: measure.unit,
        deadline: measure.deadline,
        assigned_to: measure.assigned_to?.join(', ') || '',
        status: measure.status || 'Open'
      });
      setProgressDraft({ current_value: measure.current_value ?? measure.from_value, note: '', health_state: 'green', author: '' });
      setApprovalDraft({ title: `Approval required: ${measure.title}`, requested_by: '', summary: '', due_date: measure.deadline || '' });
    }
  }

  function openMeasureDetail(wig, measure) {
    setSelectedWigId(wig.id);
    setSelectedMeasureDetail({ wigId: wig.id, measureId: measure.id });
    setActivitySort('latest');
  }

  function openAddWig() {
    setNewWigDraft({ title: '', current_state: '', target_state: '', from_value: 0, to_value: 100, unit: '% completion', deadline: '', owner: currentProject.owner || '' });
    setAction({ type: 'add-wig' });
  }

  function openAddLeadMeasure(wig) {
    setNewLeadDraft({ title: '', current_state: '', target_state: '', from_value: 0, to_value: 100, unit: '%', deadline: '', assigned_to: wig.owner || '' });
    setAction({ type: 'add-measure', wig });
  }

  function openAttachEvidence(wig, measure) {
    setEvidenceDraft({ title: '', document_type: 'Progress Note', content: '' });
    setAction({ type: 'evidence', wig, measure });
  }

  async function submitNewWig(e) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget).entries());
    const data = await api(`/api/projects/${currentProject._id}/wigs`, {
      method: 'POST',
      body: JSON.stringify({
        title: String(values.title || '').trim(),
        current_state: String(values.current_state || '').trim(),
        target_state: String(values.target_state || '').trim(),
        from_value: Number(values.from_value) || 0,
        to_value: Number(values.to_value) || 0,
        unit: String(values.unit || '').trim(),
        deadline: values.deadline,
        owner: String(values.owner || '').trim()
      })
    });
    const nextWigs = (data.wigs || []).filter(wig => !wig.archived_at);
    const newestWig = nextWigs[nextWigs.length - 1];
    setBundle(prev => ({ ...(prev || {}), project: data }));
    setSelectedMeasureDetail(null);
    setSelectedWigId(newestWig?.id || null);
    setAction(null);
    await reload();
  }

  async function submitNewLeadMeasure(e) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget).entries());
    const data = await api(`/api/projects/${currentProject._id}/wigs/${action.wig.id}/lead-measures`, {
      method: 'POST',
      body: JSON.stringify({
        title: String(values.title || '').trim(),
        current_state: String(values.current_state || '').trim(),
        target_state: String(values.target_state || '').trim(),
        from_value: Number(values.from_value) || 0,
        to_value: Number(values.to_value) || 0,
        unit: String(values.unit || '').trim(),
        deadline: values.deadline,
        assigned_to: String(values.assigned_to || '').split(',').map(item => item.trim()).filter(Boolean)
      })
    });
    setBundle(prev => ({ ...(prev || {}), project: data }));
    setSelectedWigId(action.wig.id);
    setSelectedMeasureDetail(null);
    setAction(null);
    await reload();
  }

  async function submitMeasureEvidence(e) {
    e.preventDefault();
    const data = await api('/api/documents', {
      method: 'POST',
      body: JSON.stringify({
        ...evidenceDraft,
        project_id: currentProject._id,
        wig_id: action.wig.id,
        measure_id: action.measure.id
      })
    });
    setBundle(prev => ({
      ...(prev || {}),
      project: data.project,
      documents: [data.document, ...((prev?.documents || []).filter(doc => doc._id !== data.document._id))]
    }));
    setAction(null);
    await reload();
  }

  async function uploadMeasureEvidence(e) {
    const file = e.target.files?.[0];
    if (!file || action?.type !== 'evidence') return;
    const data = new FormData();
    data.append('project_id', currentProject._id);
    data.append('wig_id', action.wig.id);
    data.append('measure_id', action.measure.id);
    data.append('document_type', 'Uploaded File');
    data.append('file', file);
    const result = await api('/api/documents/upload', { method: 'POST', body: data });
    setBundle(prev => ({
      ...(prev || {}),
      project: result.project,
      documents: [result.document, ...((prev?.documents || []).filter(doc => doc._id !== result.document._id))]
    }));
    setAction(null);
    await reload();
  }

  async function submitMeasureUpdate(e) {
    e.preventDefault();
    const payload = {
      ...measureDraft,
      from_value: Number(measureDraft.from_value),
      to_value: Number(measureDraft.to_value),
      current_value: Number(measureDraft.current_value),
      assigned_to: String(measureDraft.assigned_to || '').split(',').map(v => v.trim()).filter(Boolean)
    };
    const data = await api(`/api/projects/${currentProject._id}/wigs/${action.wig.id}/lead-measures/${action.measure.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    setBundle(prev => ({ ...(prev || {}), project: data }));
    setAction(null);
    await reload();
  }

  async function submitProgress(e) {
    e.preventDefault();
    const data = await api(`/api/projects/${currentProject._id}/wigs/${action.wig.id}/lead-measures/${action.measure.id}/progress`, {
      method: 'POST',
      body: JSON.stringify({ ...progressDraft, current_value: Number(progressDraft.current_value) })
    });
    setBundle(prev => ({ ...(prev || {}), project: data }));
    setAction(null);
    await loadBundle();
    await reload();
  }

  async function submitComment(e) {
    e.preventDefault();
    const data = await api(`/api/projects/${currentProject._id}/wigs/${action.wig.id}/lead-measures/${action.measure.id}/comments`, {
      method: 'POST',
      body: JSON.stringify(commentDraft)
    });
    setBundle(prev => ({ ...(prev || {}), project: data }));
    setAction(null);
    await loadBundle();
    await reload();
  }

  async function submitApproval(e) {
    e.preventDefault();
    await api('/api/approvals', {
      method: 'POST',
      body: JSON.stringify({ ...approvalDraft, project_id: currentProject._id, wig_id: action.wig.id, measure_id: action.measure.id })
    });
    setAction(null);
    await loadBundle();
  }

  async function submitMeeting(e) {
    e.preventDefault();
    await api('/api/weekly-meetings', {
      method: 'POST',
      body: JSON.stringify({
        project_id: currentProject._id,
        meeting_date: meetingDraft.meeting_date,
        facilitator: meetingDraft.facilitator,
        notes: meetingDraft.notes,
        commitments: meetingDraft.commitments.split('\n').map(v => v.trim()).filter(Boolean)
      })
    });
    setMeetingDraft({ meeting_date: '', facilitator: '', notes: '', commitments: '' });
    setAction(null);
    await loadBundle();
  }

  const activeWig = detailWig || selectedWig;
  const focusEntity = detailMeasure || activeWig || currentProject;
  const focusLabel = detailMeasure ? 'Lead Measure' : activeWig ? 'WIG / Milestone' : 'Project';
  const draftProgress = progressPercent(measureDraft.from_value, measureDraft.to_value, measureDraft.current_value);

  return (
    <Modal title={null} onClose={onClose} wide>
      <section className="detail-header-card">
        <div className="detail-context-grid">
          <div>
            <span>Project Name</span>
            <strong>{currentProject.name}</strong>
            <small>{currentProject.ministry} | {currentProject.owner || 'Owner not assigned'}</small>
          </div>
          <div>
            <span>WIG / Milestone</span>
            <strong>{activeWig?.title || currentProject.wig}</strong>
            <small>{activeWig ? activeWig.owner || 'Owner not assigned' : `${currentWigs.length} WIGs / milestones`}</small>
          </div>
          <div>
            <span>Lead Measure Title</span>
            <strong>{detailMeasure?.title || (selectedWig ? 'Select a lead measure' : 'Lead measures summary')}</strong>
            <small>{detailMeasure ? detailMeasure.assigned_to?.join(', ') || 'Not assigned' : selectedWig ? `${timelineMeasures.length} lead measures in this WIG` : `${countMeasures(currentProject)} lead measures`}</small>
          </div>
        </div>

        <div className="detail-state-grid">
          <div>
            <span>Current</span>
            <strong>{currentStateText(focusEntity)}</strong>
            <small>{focusLabel}</small>
          </div>
          <div>
            <span>Target</span>
            <strong>{targetStateText(focusEntity)}</strong>
            <small>{focusLabel}</small>
          </div>
          <div>
            <span>Deadline</span>
            <strong>{deadlineText(focusEntity)}</strong>
            <small>{focusLabel}</small>
          </div>
          <div className="detail-health-compact">
            <span>Health</span>
            <strong>{currentProject.health_score}%</strong>
            <small style={{ color: statusColors[currentProject.status] || '#64748b' }}>{currentProject.status}</small>
          </div>
        </div>

        <div className="detail-signal-row">
          {(currentProject.bottlenecks || []).slice(0, 3).map(b => <span key={b}>{b}</span>)}
          {(currentProject.recommendations || []).slice(0, 1).map(r => <small key={r}>{r}</small>)}
        </div>

        <div className="detail-actions">
          <button className="ghost-btn" onClick={() => setAction({ type: 'meeting' })}>Weekly Meeting</button>
          <button className="ghost-btn" onClick={loadBundle}>Refresh Detail</button>
        </div>
      </section>

      <section className="enterprise-strip">
        <div><span>Approvals</span><b>{bundle?.approvals?.filter(a => a.status === 'Pending').length || 0}</b></div>
        <div><span>Alerts</span><b>{bundle?.notifications?.length || 0}</b></div>
        <div><span>Meetings</span><b>{bundle?.meetings?.length || 0}</b></div>
      </section>

      <div className="section-row">
        <div>
          <h4 className="section-title">{detailMeasure ? 'Lead Measure Detail' : selectedWig ? 'Milestone Drill Down' : 'WIGs / Milestones'}</h4>
          <span className="section-kicker">
            {detailMeasure ? `${measureActivity.length} timeline events` : selectedWig ? `${timelineMeasures.length} lead measures` : `${currentWigs.length} collapsed milestones`}
          </span>
        </div>
        <div className="drill-actions">
          {!detailMeasure && <button className="ghost-btn back-btn" onClick={openAddWig}>Add WIG</button>}
          {selectedWig && !detailMeasure && <button className="ghost-btn back-btn" onClick={() => openAddLeadMeasure(selectedWig)}>Add Lead Measure</button>}
          {detailMeasure && (
            <button className="ghost-btn back-btn" onClick={() => setSelectedMeasureDetail(null)}>
              <ArrowLeft size={16} /> Lead Measures
            </button>
          )}
          {(selectedWig || detailMeasure) && (
            <button className="ghost-btn back-btn" onClick={() => { setSelectedMeasureDetail(null); setSelectedWigId(null); }}>
              WIGs
            </button>
          )}
        </div>
      </div>

      {detailMeasure ? (
        <section className="lead-detail-view">
          <div className="lead-detail-head">
            <div>
              <span>Lead Measure</span>
              <h4>{detailMeasure.title}</h4>
              <p>{detailWig?.title}</p>
            </div>
            <div className="timeline-sort">
              <ArrowUpDown size={16} />
              <button className={activitySort === 'latest' ? 'active' : ''} onClick={() => setActivitySort('latest')}>Latest</button>
              <button className={activitySort === 'oldest' ? 'active' : ''} onClick={() => setActivitySort('oldest')}>Oldest</button>
            </div>
          </div>
          <div className="lead-detail-grid">
            <div>
              <span>Current</span>
              <strong>{currentStateText(detailMeasure)}</strong>
              <small>{progressPercent(detailMeasure.from_value, detailMeasure.to_value, detailMeasure.current_value ?? detailMeasure.from_value)}% progress</small>
            </div>
            <div>
              <span>Target</span>
              <strong>{targetStateText(detailMeasure)}</strong>
              <small>from {detailMeasure.from_value} to {detailMeasure.to_value} {detailMeasure.unit}</small>
            </div>
            <div>
              <span>Deadline</span>
              <strong>{deadlineText(detailMeasure)}</strong>
              <small>Status {detailMeasure.status || 'Open'}</small>
            </div>
            <div>
              <span>Owners</span>
              <strong>{detailMeasure.assigned_to?.join(', ') || 'Not assigned'}</strong>
              <small>{detailWig?.owner || 'WIG owner not assigned'}</small>
            </div>
          </div>
          <div className="measure-actions lead-detail-actions">
            <button className="ghost-btn" onClick={() => openAction('update', detailWig, detailMeasure)}>Update</button>
            <button className="ghost-btn" onClick={() => openAction('progress', detailWig, detailMeasure)}>Progress</button>
            <button className="ghost-btn" onClick={() => openAction('comment', detailWig, detailMeasure)}>Comment</button>
            <button className="ghost-btn" onClick={() => openAction('approval', detailWig, detailMeasure)}>Approval</button>
            <button className="ghost-btn" onClick={() => openAttachEvidence(detailWig, detailMeasure)}>Attach Evidence</button>
          </div>
          <section className="measure-evidence">
            <div className="measure-evidence-head">
              <div>
                <span>Evidence AI</span>
                <h4>{measureEvidence.length} attached documents</h4>
              </div>
              <button className="ghost-btn" onClick={() => openAttachEvidence(detailWig, detailMeasure)}>Attach Document</button>
            </div>
            {measureEvidence.length === 0 ? (
              <p className="empty-state">No evidence is attached to this lead measure yet.</p>
            ) : (
              <div className="measure-evidence-grid">
                {measureEvidence.map(doc => <EvidenceSummaryCard key={doc._id} doc={doc} />)}
              </div>
            )}
          </section>
          <div className="activity-timeline">
            {measureActivity.length === 0 && <p className="empty-state">No comments, progress updates, or approvals recorded yet.</p>}
            {measureActivity.map(event => (
              <article className="activity-event" key={event.id}>
                <span className={`activity-dot ${event.state || 'green'}`} />
                <div className="activity-date">{formatEventDate(event.created_at || event.due_date)}</div>
                <div className="activity-card">
                  <div>
                    <span>{event.type}</span>
                    <strong>{event.title}</strong>
                  </div>
                  {event.body && <p>{event.body}</p>}
                  <div className="activity-meta">
                    {event.owner && <small>Owner: {event.owner}</small>}
                    {event.actor && <small>By: {event.actor}</small>}
                    {event.status && <small>Status: {event.status}</small>}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : !selectedWig ? (
        <div className="wig-collapsed-list">
          {currentWigs.map((wig, index) => {
            const measures = (wig.lead_measures || []).filter(measure => !measure.archived_at);
            return (
              <button className="wig-list-row" key={wig.id} type="button" onClick={() => setSelectedWigId(wig.id)}>
                <span className="wig-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="wig-row-main">
                  <span>Milestone</span>
                  <strong>{wig.title}</strong>
                  <small>Current: {currentStateText(wig)} | Target: {targetStateText(wig)} | Deadline: {deadlineText(wig)}</small>
                </span>
                <span className="wig-row-stat">
                  <b>{measures.length}</b>
                  <small>Lead Measures</small>
                </span>
                <ChevronRight size={18} />
              </button>
            );
          })}
        </div>
      ) : (
        <section className="wig-drilldown">
          <div className="wig-drill-head">
            <div>
              <span>WIG / Milestone</span>
              <h4>{selectedWig.title}</h4>
              <p>Current: {currentStateText(selectedWig)} | Target: {targetStateText(selectedWig)} | Deadline: {deadlineText(selectedWig)}</p>
            </div>
            <div className="timeline-sort">
              <ArrowUpDown size={16} />
              <button className={timelineSort === 'latest' ? 'active' : ''} onClick={() => setTimelineSort('latest')}>Latest</button>
              <button className={timelineSort === 'oldest' ? 'active' : ''} onClick={() => setTimelineSort('oldest')}>Oldest</button>
            </div>
          </div>
          <div className="timeline-scroll">
            <div className="lead-timeline">
              {timelineMeasures.map(measure => {
                const measureProgress = progressPercent(measure.from_value, measure.to_value, measure.current_value ?? measure.from_value);
                const comments = latestMeasureComments(measure);
                return (
                  <article className="timeline-item" key={measure.id}>
                    <div className="timeline-date"><CalendarClock size={15} /> {measure.deadline}</div>
                    <span className={`timeline-dot ${measureState(measure)}`} />
                    <div className="timeline-card">
                      <strong>{measure.title}</strong>
                      <small>Target: {targetStateText(measure)}</small>
                      <div className="timeline-progress">
                        <i><em style={{ width: `${measureProgress}%` }} /></i>
                        <span>{measureProgress}%</span>
                      </div>
                      <small>Current: {currentStateText(measure)} | Deadline: {deadlineText(measure)}</small>
                      <div className="measure-actions timeline-actions">
                        <button className="ghost-btn" onClick={() => openAction('update', selectedWig, measure)}>Update</button>
                        <button className="ghost-btn" onClick={() => openAction('progress', selectedWig, measure)}>Progress</button>
                        <button className="ghost-btn" onClick={() => openAction('comment', selectedWig, measure)}>Comment</button>
                        <button className="ghost-btn" onClick={() => openAction('approval', selectedWig, measure)}>Approval</button>
                        <button className="ghost-btn" onClick={() => openMeasureDetail(selectedWig, measure)}>View</button>
                      </div>
                      <div className="timeline-comment-summary">
                        <span>{measure.comments?.length || 0} comments</span>
                        {comments[0] ? <small>Latest {comments[0].health_state} by {comments[0].author || comments[0].created_by || 'team'}</small> : <small>No comments yet</small>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <div className="enterprise-lists">
        <div>
          <h4 className="section-title">Approvals & Escalations</h4>
          {(bundle?.approvals || []).slice(0, 5).map(item => <p key={item._id}><span>{item.status}</span>{item.title}</p>)}
        </div>
        <div>
          <h4 className="section-title">Alerts / Reminders</h4>
          {(bundle?.notifications || []).slice(0, 5).map(item => <p key={item._id}><span>{item.severity}</span>{item.title}</p>)}
        </div>
        <div>
          <h4 className="section-title">Weekly Meetings</h4>
          {(bundle?.meetings || []).slice(0, 5).map(item => <p key={item._id}><span>{item.meeting_date}</span>{item.facilitator}</p>)}
        </div>
      </div>

      {action?.type === 'add-wig' && <Modal title="Add WIG / Milestone" onClose={() => setAction(null)}>
        <form className="project-form editable-form" onSubmit={submitNewWig}>
          <label className="field">
            <span>WIG / Milestone Title</span>
            <input name="title" value={newWigDraft.title} onChange={e => setNewWigDraft({ ...newWigDraft, title: e.target.value })} required />
          </label>
          <label className="field">
            <span>Current State</span>
            <textarea className="compact-textarea" name="current_state" value={newWigDraft.current_state} onChange={e => setNewWigDraft({ ...newWigDraft, current_state: e.target.value })} required />
          </label>
          <label className="field">
            <span>Target State</span>
            <textarea className="compact-textarea" name="target_state" value={newWigDraft.target_state} onChange={e => setNewWigDraft({ ...newWigDraft, target_state: e.target.value })} required />
          </label>
          <div className="two-col">
            <label className="field">
              <span>From X</span>
              <input name="from_value" type="number" value={newWigDraft.from_value} onChange={e => setNewWigDraft({ ...newWigDraft, from_value: e.target.value })} />
            </label>
            <label className="field">
              <span>To Y</span>
              <input name="to_value" type="number" value={newWigDraft.to_value} onChange={e => setNewWigDraft({ ...newWigDraft, to_value: e.target.value })} required />
            </label>
          </div>
          <label className="field">
            <span>Unit</span>
            <input name="unit" value={newWigDraft.unit} onChange={e => setNewWigDraft({ ...newWigDraft, unit: e.target.value })} required />
          </label>
          <label className="field">
            <span>Deadline</span>
            <input name="deadline" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" value={newWigDraft.deadline} onChange={e => setNewWigDraft({ ...newWigDraft, deadline: e.target.value })} required />
          </label>
          <label className="field">
            <span>Owner</span>
            <input name="owner" value={newWigDraft.owner} onChange={e => setNewWigDraft({ ...newWigDraft, owner: e.target.value })} required />
          </label>
          <button className="primary-btn">Add WIG</button>
        </form>
      </Modal>}

      {action?.type === 'add-measure' && <Modal title="Add Lead Measure" onClose={() => setAction(null)}>
        <form className="project-form editable-form" onSubmit={submitNewLeadMeasure}>
          <div className="wizard-summary">
            <span>WIG / Milestone</span>
            <strong>{action.wig.title}</strong>
            <small>Lead measures must follow X to Y by deadline.</small>
          </div>
          <label className="field">
            <span>Lead Measure Title</span>
            <input name="title" value={newLeadDraft.title} onChange={e => setNewLeadDraft({ ...newLeadDraft, title: e.target.value })} required />
          </label>
          <label className="field">
            <span>Current State</span>
            <textarea className="compact-textarea" name="current_state" value={newLeadDraft.current_state} onChange={e => setNewLeadDraft({ ...newLeadDraft, current_state: e.target.value })} required />
          </label>
          <label className="field">
            <span>Target State</span>
            <textarea className="compact-textarea" name="target_state" value={newLeadDraft.target_state} onChange={e => setNewLeadDraft({ ...newLeadDraft, target_state: e.target.value })} required />
          </label>
          <div className="two-col">
            <label className="field">
              <span>From X</span>
              <input name="from_value" type="number" value={newLeadDraft.from_value} onChange={e => setNewLeadDraft({ ...newLeadDraft, from_value: e.target.value })} />
            </label>
            <label className="field">
              <span>To Y</span>
              <input name="to_value" type="number" value={newLeadDraft.to_value} onChange={e => setNewLeadDraft({ ...newLeadDraft, to_value: e.target.value })} required />
            </label>
          </div>
          <label className="field">
            <span>Unit</span>
            <input name="unit" value={newLeadDraft.unit} onChange={e => setNewLeadDraft({ ...newLeadDraft, unit: e.target.value })} required />
          </label>
          <label className="field">
            <span>Deadline</span>
            <input name="deadline" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" value={newLeadDraft.deadline} onChange={e => setNewLeadDraft({ ...newLeadDraft, deadline: e.target.value })} required />
          </label>
          <label className="field">
            <span>Assigned To</span>
            <input name="assigned_to" value={newLeadDraft.assigned_to} onChange={e => setNewLeadDraft({ ...newLeadDraft, assigned_to: e.target.value })} required />
          </label>
          <button className="primary-btn">Add Lead Measure</button>
        </form>
      </Modal>}

      {action?.type === 'evidence' && <Modal title="Attach Evidence" onClose={() => setAction(null)} wide className="measure-update-modal">
        <form className="measure-update-form" onSubmit={submitMeasureEvidence}>
          <section className="measure-context">
            <div>
              <span>Project</span>
              <p>{currentProject.name}</p>
            </div>
            <div>
              <span>WIG / Milestone</span>
              <p>{action.wig.title}</p>
            </div>
            <div>
              <span>Lead Measure</span>
              <p>{action.measure.title}</p>
            </div>
          </section>
          <section className="measure-editor-section">
            <label className="upload-box evidence-upload-box full-span">
              <Upload size={22} />
              <span>
                <strong>Upload evidence file</strong>
                <small>Text files are read, vectorized, and summarised against this lead measure.</small>
              </span>
              <input type="file" onChange={uploadMeasureEvidence} />
            </label>
            <div className="evidence-divider full-span"><span>or paste evidence text</span></div>
            <label className="field">
              <span>Document Title</span>
              <input value={evidenceDraft.title} onChange={e => setEvidenceDraft({ ...evidenceDraft, title: e.target.value })} required />
            </label>
            <label className="field">
              <span>Document Type</span>
              <select value={evidenceDraft.document_type} onChange={e => setEvidenceDraft({ ...evidenceDraft, document_type: e.target.value })}>
                <option>Progress Note</option>
                <option>Review Minutes</option>
                <option>Finance Memo</option>
                <option>Clearance Note</option>
                <option>Citizen Impact</option>
              </select>
            </label>
            <label className="field full-span">
              <span>Document Content</span>
              <textarea value={evidenceDraft.content} onChange={e => setEvidenceDraft({ ...evidenceDraft, content: e.target.value })} required />
            </label>
          </section>
          <div className="measure-form-actions">
            <button className="ghost-btn" type="button" onClick={() => setAction(null)}>Cancel</button>
            <button className="primary-btn"><Brain size={17} /> Save & Summarise</button>
          </div>
        </form>
      </Modal>}

      {action?.type === 'update' && <Modal title="Update Lead Measure" onClose={() => setAction(null)} wide className="measure-update-modal">
        <form className="measure-update-form" onSubmit={submitMeasureUpdate}>
          <section className="measure-context">
            <div>
              <span>Project</span>
              <p>{currentProject.name}</p>
            </div>
            <div>
              <span>WIG / Milestone</span>
              <p>{action.wig.title}</p>
            </div>
            <div>
              <span>Current Status</span>
              <p>{measureDraft.status || 'Open'}</p>
            </div>
          </section>

          <section className="measure-editor-section">
            <label className="field full-span">
              <span>Lead Measure</span>
              <textarea
                className="compact-textarea"
                value={measureDraft.title || ''}
                onChange={e => setMeasureDraft({ ...measureDraft, title: e.target.value })}
                required
              />
            </label>
            <label className="field full-span">
              <span>Current State</span>
              <textarea
                className="compact-textarea"
                value={measureDraft.current_state || ''}
                onChange={e => setMeasureDraft({ ...measureDraft, current_state: e.target.value })}
                required
              />
            </label>
            <label className="field full-span">
              <span>Target State</span>
              <textarea
                className="compact-textarea"
                value={measureDraft.target_state || ''}
                onChange={e => setMeasureDraft({ ...measureDraft, target_state: e.target.value })}
                required
              />
            </label>
            <div className="target-preview full-span">
              <div>
                <Target size={18} />
                <span>Current: {measureDraft.current_state || `${measureDraft.current_value ?? measureDraft.from_value ?? 0} ${measureDraft.unit || 'units'}`} | Target: {measureDraft.target_state || `${measureDraft.to_value ?? 0} ${measureDraft.unit || 'units'}`} | Deadline: {measureDraft.deadline || 'deadline'}</span>
              </div>
              <i><em style={{ width: `${draftProgress}%` }} /></i>
              <small>{draftProgress}% current progress</small>
            </div>
          </section>

          <section className="measure-editor-section measure-grid">
            <label className="field">
              <span>From X</span>
              <input type="number" value={measureDraft.from_value ?? 0} onChange={e => setMeasureDraft({ ...measureDraft, from_value: e.target.value })} />
            </label>
            <label className="field">
              <span>To Y</span>
              <input type="number" value={measureDraft.to_value ?? 0} onChange={e => setMeasureDraft({ ...measureDraft, to_value: e.target.value })} />
            </label>
            <label className="field">
              <span>Current</span>
              <input type="number" value={measureDraft.current_value ?? 0} onChange={e => setMeasureDraft({ ...measureDraft, current_value: e.target.value })} />
            </label>
            <label className="field">
              <span>Unit</span>
              <input value={measureDraft.unit || ''} onChange={e => setMeasureDraft({ ...measureDraft, unit: e.target.value })} />
            </label>
            <label className="field">
              <span>Deadline</span>
              <input type="date" value={measureDraft.deadline || ''} onChange={e => setMeasureDraft({ ...measureDraft, deadline: e.target.value })} />
            </label>
            <label className="field">
              <span>Status</span>
              <select value={measureDraft.status || 'Open'} onChange={e => setMeasureDraft({ ...measureDraft, status: e.target.value })}>
                <option>Open</option>
                <option>Updated</option>
                <option>Done</option>
                <option>On Hold</option>
              </select>
            </label>
            <label className="field full-span">
              <span>Assigned To</span>
              <input value={measureDraft.assigned_to || ''} onChange={e => setMeasureDraft({ ...measureDraft, assigned_to: e.target.value })} />
            </label>
          </section>

          <div className="measure-form-actions">
            <button className="ghost-btn" type="button" onClick={() => setAction(null)}>Cancel</button>
            <button className="primary-btn"><Check size={17} /> Save Update</button>
          </div>
        </form>
      </Modal>}

      {action?.type === 'progress' && <Modal title="Update Progress" onClose={() => setAction(null)}>
        <form className="project-form" onSubmit={submitProgress}>
          <input type="number" placeholder="Current value" value={progressDraft.current_value} onChange={e => setProgressDraft({ ...progressDraft, current_value: e.target.value })} />
          <select value={progressDraft.health_state} onChange={e => setProgressDraft({ ...progressDraft, health_state: e.target.value })}><option>green</option><option>amber</option><option>red</option><option>blocker</option><option>approval</option><option>hold</option></select>
          <input placeholder="Author" value={progressDraft.author} onChange={e => setProgressDraft({ ...progressDraft, author: e.target.value })} required />
          <textarea placeholder="Progress note" value={progressDraft.note} onChange={e => setProgressDraft({ ...progressDraft, note: e.target.value })} />
          <button className="primary-btn">Save Progress</button>
        </form>
      </Modal>}

      {action?.type === 'comment' && <Modal title="Add Comment" onClose={() => setAction(null)}>
        <form className="project-form" onSubmit={submitComment}>
          <select value={commentDraft.health_state} onChange={e => setCommentDraft({ ...commentDraft, health_state: e.target.value })}><option>green</option><option>amber</option><option>red</option><option>blocker</option><option>approval</option><option>hold</option></select>
          <input placeholder="Author" value={commentDraft.author} onChange={e => setCommentDraft({ ...commentDraft, author: e.target.value })} required />
          <textarea placeholder="Comment" value={commentDraft.comment} onChange={e => setCommentDraft({ ...commentDraft, comment: e.target.value })} required />
          <button className="primary-btn">Save Comment</button>
        </form>
      </Modal>}

      {action?.type === 'approval' && <Modal title="Request Approval" onClose={() => setAction(null)}>
        <form className="project-form" onSubmit={submitApproval}>
          <input placeholder="Title" value={approvalDraft.title} onChange={e => setApprovalDraft({ ...approvalDraft, title: e.target.value })} required />
          <input placeholder="Requested by" value={approvalDraft.requested_by} onChange={e => setApprovalDraft({ ...approvalDraft, requested_by: e.target.value })} required />
          <input type="date" value={approvalDraft.due_date} onChange={e => setApprovalDraft({ ...approvalDraft, due_date: e.target.value })} required />
          <textarea placeholder="Summary" value={approvalDraft.summary} onChange={e => setApprovalDraft({ ...approvalDraft, summary: e.target.value })} required />
          <button className="primary-btn">Request Approval</button>
        </form>
      </Modal>}

      {action?.type === 'meeting' && <Modal title="Weekly WIG Meeting" onClose={() => setAction(null)}>
        <form className="project-form" onSubmit={submitMeeting}>
          <input type="date" value={meetingDraft.meeting_date} onChange={e => setMeetingDraft({ ...meetingDraft, meeting_date: e.target.value })} required />
          <input placeholder="Facilitator" value={meetingDraft.facilitator} onChange={e => setMeetingDraft({ ...meetingDraft, facilitator: e.target.value })} required />
          <textarea placeholder="Meeting notes" value={meetingDraft.notes} onChange={e => setMeetingDraft({ ...meetingDraft, notes: e.target.value })} required />
          <textarea placeholder="Commitments, one per line" value={meetingDraft.commitments} onChange={e => setMeetingDraft({ ...meetingDraft, commitments: e.target.value })} />
          <button className="primary-btn">Save Meeting</button>
        </form>
      </Modal>}
    </Modal>
  );
}

function countMeasures(project) {
  return (project.wigs || []).reduce((sum, wig) => sum + (wig.lead_measures?.length || 0), 0);
}

function currentStateText(entity = {}, fallback = 'Current state not captured') {
  if (entity.current_state) return entity.current_state;
  if (entity.current_value !== undefined || entity.from_value !== undefined) {
    const value = entity.current_value ?? entity.from_value;
    return `${value} ${entity.unit || ''}`.trim();
  }
  if (entity.health_score !== undefined) return `${entity.health_score}% health | ${entity.status || 'Status pending'}`;
  return fallback;
}

function targetStateText(entity = {}, fallback = 'Target state not defined') {
  if (entity.target_state) return entity.target_state;
  if (entity.to_value !== undefined) return `${entity.to_value} ${entity.unit || ''}`.trim();
  if (entity.wig) return entity.wig;
  return fallback;
}

function deadlineText(entity = {}, fallback = 'Deadline not set') {
  return entity.deadline || entity.due_date || fallback;
}

function progressPercent(fromValue, toValue, currentValue) {
  const from = Number(fromValue) || 0;
  const to = Number(toValue) || 0;
  const current = Number(currentValue) || 0;
  if (to === from) return current >= to ? 100 : 0;
  const value = ((current - from) / (to - from)) * 100;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function dateValue(value) {
  const time = Date.parse(value || '');
  return Number.isNaN(time) ? 0 : time;
}

function latestMeasureComments(measure) {
  return [...(measure.comments || [])]
    .sort((a, b) => dateValue(b.created_at) - dateValue(a.created_at))
    .slice(0, 2);
}

function measureState(measure) {
  const [latest] = latestMeasureComments(measure);
  const state = latest?.health_state || measure.status || 'green';
  const normalized = String(state).toLowerCase();
  return ['green', 'amber', 'red', 'blocker', 'approval', 'hold'].includes(normalized) ? normalized : 'green';
}

function buildMeasureActivity(measure, bundle, sort = 'latest') {
  if (!measure) return [];
  const progressKeys = new Set();
  const progressEvents = (measure.progress_history || []).map(item => {
    progressKeys.add(activityKey(item.note, item.health_state, item.author, item.created_by));
    return {
      id: `progress-${item.id}`,
      type: 'Progress Update',
      title: `Current value moved to ${item.current_value}`,
      body: item.note,
      state: item.health_state,
      owner: item.author,
      actor: item.created_by,
      created_at: item.created_at,
      status: item.health_state,
    };
  });
  const commentEvents = (measure.comments || [])
    .filter(item => !progressKeys.has(activityKey(item.comment, item.health_state, item.author, item.created_by)))
    .map(item => ({
      id: `comment-${item.id}`,
      type: 'Comment',
      title: `${item.health_state || 'green'} status comment`,
      body: item.comment,
      state: item.health_state,
      owner: item.author,
      actor: item.created_by,
      created_at: item.created_at,
      status: item.health_state,
    }));
  const approvalEvents = (bundle?.approvals || [])
    .filter(item => item.measure_id === measure.id)
    .map(item => ({
      id: `approval-${item._id}`,
      type: 'Approval',
      title: item.title,
      body: item.summary,
      state: item.status === 'Pending' ? 'approval' : 'green',
      owner: item.requested_by,
      actor: item.created_by,
      created_at: item.created_at,
      due_date: item.due_date,
      status: item.status,
    }));
  const direction = sort === 'latest' ? -1 : 1;
  return [...progressEvents, ...commentEvents, ...approvalEvents]
    .sort((a, b) => direction * (dateValue(a.created_at || a.due_date) - dateValue(b.created_at || b.due_date)));
}

function activityKey(text, state, author, actor) {
  return [text || '', state || '', author || '', actor || ''].join('|').toLowerCase();
}

function formatEventDate(value) {
  const time = Date.parse(value || '');
  if (Number.isNaN(time)) return 'No date';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(time));
}

function Workflow({ overview, api, reload }) {
  const projects = overview?.projects || [];
  const assignments = overview?.assignments || [];
  const [form, setForm] = useState({ project_id: projects[0]?._id || '', title: '', owner: '', role: 'Project Director', due_date: '', priority: 'High', discipline: 'Cadence', decision_needed: '' });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!form.project_id && projects[0]?._id) setForm(prev => ({ ...prev, project_id: projects[0]._id }));
  }, [projects]);

  async function addAssignment(e) {
    e.preventDefault();
    await api('/api/assignments', { method: 'POST', body: JSON.stringify(form) });
    setForm({ ...form, title: '', owner: '', decision_needed: '' });
    setOpen(false);
    reload();
  }

  async function closeAssignment(id) {
    await api(`/api/assignments/${id}/status?status=Done`, { method: 'PUT' });
    reload();
  }

  return (
    <section className="tesla-stage">
      <div className="stage-toolbar">
        <div><h3>Workflow</h3><span>{assignments.length} open actions</span></div>
        <button className="primary-btn" onClick={() => setOpen(true)}>Assign Action</button>
      </div>
      <div className="card glass-panel">
        <h3><CalendarClock size={22} /> Assigned Actions</h3>
        <div className="action-list">
          {assignments.map(a => <ActionRow key={a._id} item={a} projects={projects} onDone={() => closeAssignment(a._id)} />)}
        </div>
      </div>
      {open && <Modal title="Assign Workflow" onClose={() => setOpen(false)}>
      <form className="project-form" onSubmit={addAssignment}>
        <h3>Assign Workflow</h3>
        <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}>{projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select>
        <input placeholder="Action title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
        <input placeholder="Owner" value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })} required />
        <input placeholder="Role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} />
        <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} required />
        <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}><option>Critical</option><option>High</option><option>Medium</option></select>
        <select value={form.discipline} onChange={e => setForm({ ...form, discipline: e.target.value })}><option>WIG</option><option>Lead Measures</option><option>Scoreboard</option><option>Cadence</option></select>
        <input placeholder="Decision needed if blocked" value={form.decision_needed} onChange={e => setForm({ ...form, decision_needed: e.target.value })} />
        <button className="primary-btn">Assign Action</button>
      </form>
      </Modal>}
    </section>
  );
}

function ActionRow({ item, projects, onDone }) {
  const project = projects.find(p => p._id === item.project_id);
  return (
    <article className="action-row">
      <div>
        <h4>{item.title}</h4>
        <p>{project?.name || 'Project'} | {item.owner} | {item.discipline}</p>
        {item.decision_needed && <small>{item.decision_needed}</small>}
      </div>
      <span className={`priority ${item.priority?.toLowerCase()}`}>{item.priority}</span>
      <b>{item.due_date}</b>
      <button className="ghost-btn" onClick={onDone}>Done</button>
    </article>
  );
}

function Evidence({ projects, api, reload }) {
  const [projectId, setProjectId] = useState(projects[0]?._id || '');
  const [evidenceWigId, setEvidenceWigId] = useState('');
  const [evidenceMeasureId, setEvidenceMeasureId] = useState('');
  const [bundle, setBundle] = useState(null);
  const [doc, setDoc] = useState({ title: '', document_type: 'Progress Note', content: '' });
  const [query, setQuery] = useState('find top projects which are in blocker state');
  const [stateFilter, setStateFilter] = useState('blocker');
  const [results, setResults] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => {
    if (!projectId && projects[0]?._id) setProjectId(projects[0]._id);
  }, [projects]);

  useEffect(() => {
    if (projectId) loadEvidence(projectId);
  }, [projectId]);

  useEffect(() => {
    const wigs = (bundle?.project?.wigs || []).filter(wig => !wig.archived_at);
    if (!wigs.length) {
      setEvidenceWigId('');
      setEvidenceMeasureId('');
      return;
    }
    const currentWig = wigs.find(wig => wig.id === evidenceWigId);
    const nextWig = currentWig || wigs.find(wig => (wig.lead_measures || []).some(measure => !measure.archived_at)) || wigs[0];
    if (nextWig.id !== evidenceWigId) setEvidenceWigId(nextWig.id);
    const measures = (nextWig.lead_measures || []).filter(measure => !measure.archived_at);
    if (!measures.length) {
      setEvidenceMeasureId('');
      return;
    }
    if (!measures.some(measure => measure.id === evidenceMeasureId)) {
      setEvidenceMeasureId(measures[0].id);
    }
  }, [bundle, evidenceWigId, evidenceMeasureId]);

  async function loadEvidence(id = projectId) {
    setBundle(await api(`/api/projects/${id}/evidence`));
  }

  async function addDocument(e) {
    e.preventDefault();
    await api('/api/documents', { method: 'POST', body: JSON.stringify({ ...doc, project_id: projectId, wig_id: evidenceWigId, measure_id: evidenceMeasureId }) });
    setDoc({ title: '', document_type: 'Progress Note', content: '' });
    setUploadOpen(false);
    await loadEvidence();
    await reload();
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!evidenceMeasureId) return;
    const data = new FormData();
    data.append('project_id', projectId);
    if (evidenceWigId) data.append('wig_id', evidenceWigId);
    if (evidenceMeasureId) data.append('measure_id', evidenceMeasureId);
    data.append('document_type', 'Uploaded File');
    data.append('file', file);
    await api('/api/documents/upload', { method: 'POST', body: data });
    await loadEvidence();
    await reload();
  }

  async function searchEvidence(e) {
    e.preventDefault();
    const params = new URLSearchParams({ q: query, limit: 10 });
    if (stateFilter) params.set('state', stateFilter);
    setResults(await api(`/api/search?${params.toString()}`));
  }

  const project = bundle?.project;
  const evidenceWigs = (project?.wigs || []).filter(wig => !wig.archived_at);
  const evidenceWig = evidenceWigs.find(wig => wig.id === evidenceWigId) || null;
  const evidenceMeasures = (evidenceWig?.lead_measures || []).filter(measure => !measure.archived_at);

  return (
    <section className="tesla-stage">
      <div className="stage-toolbar">
        <div><h3>Evidence AI</h3><span>Vector search across projects, WIGs, comments, and documents</span></div>
        <button className="primary-btn" onClick={() => setUploadOpen(true)}>Upload Evidence</button>
      </div>
      <div className="card evidence-main glass-panel">
        <h3><Brain size={22} /> Evidence Intelligence</h3>
        <select value={projectId} onChange={e => setProjectId(e.target.value)}>{projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select>
        {project && (
          <div className="health-explain">
            <div><strong>{project.health_score}%</strong><span>{project.status}</span></div>
            <p>Evidence risk: {project.evidence_risk_score}. Documents: {project.evidence_count}. Bottlenecks: {(project.bottlenecks || []).join(', ') || 'none'}.</p>
            {(project.recommendations || []).map(r => <small key={r}>{r}</small>)}
          </div>
        )}
        <form className="search-row" onSubmit={searchEvidence}>
          <Search size={18} />
          <input value={query} onChange={e => setQuery(e.target.value)} />
          <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}><option value="">any state</option><option>green</option><option>amber</option><option>red</option><option>blocker</option><option>approval</option><option>hold</option></select>
          <button className="primary-btn">Vector Search</button>
        </form>
        {results && (
          <div className="search-results">
            <h4>{results.mode === 'mongodb_vector_search' ? 'MongoDB Vector Search' : 'Local Vector Fallback'}</h4>
            {(results.top_projects || []).map(item => <SearchProjectCard key={item.project._id} item={item} />)}
            {(results.results || []).map(r => <DocumentCard key={r._id} doc={r} />)}
          </div>
        )}
        <div className="document-grid">{(bundle?.documents || []).map(d => <DocumentCard key={d._id} doc={d} />)}</div>
      </div>
      {uploadOpen && <Modal title="Upload Evidence" onClose={() => setUploadOpen(false)}>
      <form className="project-form" onSubmit={addDocument}>
        <h3>Upload Evidence</h3>
        <select value={projectId} onChange={e => setProjectId(e.target.value)}>{projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select>
        <select value={evidenceWigId} onChange={e => { setEvidenceWigId(e.target.value); setEvidenceMeasureId(''); }} required>
          {evidenceWigs.length === 0 && <option value="">No WIGs available</option>}
          {evidenceWigs.map(wig => <option key={wig.id} value={wig.id}>{wig.title}</option>)}
        </select>
        <select value={evidenceMeasureId} onChange={e => setEvidenceMeasureId(e.target.value)} required disabled={!evidenceMeasures.length}>
          {evidenceMeasures.length === 0 && <option value="">No lead measures available</option>}
          {evidenceMeasures.map(measure => <option key={measure.id} value={measure.id}>{measure.title}</option>)}
        </select>
        <input placeholder="Document title" value={doc.title} onChange={e => setDoc({ ...doc, title: e.target.value })} required />
        <select value={doc.document_type} onChange={e => setDoc({ ...doc, document_type: e.target.value })}><option>Progress Note</option><option>Review Minutes</option><option>Finance Memo</option><option>Clearance Note</option><option>Citizen Impact</option></select>
        <textarea placeholder="Paste document text. It will be mapped to the selected lead measure and summarised automatically." value={doc.content} onChange={e => setDoc({ ...doc, content: e.target.value })} required />
        <button className="primary-btn" disabled={!evidenceMeasureId}><FileText size={18} /> Vectorize Text</button>
        <label className="upload-box"><Upload size={22} /> Upload text file<input type="file" onChange={uploadFile} /></label>
      </form>
      </Modal>}
    </section>
  );
}

function SearchProjectCard({ item }) {
  const project = item.project;
  return (
    <article className="doc-card top-project-card">
      <h4>{project.name}</h4>
      <p>{project.ministry} | {project.status} | health {project.health_score}%</p>
      <span>{project.recommendations?.[0] || 'Matched from vectorized 4DX workflow entities.'}</span>
      <div>{item.matches.slice(0, 3).map(match => <b key={match.entity_id || match._id}>{match.entity_type}: {match.state || 'match'}</b>)}</div>
    </article>
  );
}

function DocumentCard({ doc }) {
  return (
    <article className="doc-card">
      <h4>{doc.title}</h4>
      <p>{doc.document_type || doc.entity_type} | {doc.measure_title || doc.wig_title || (doc.state ? `state ${doc.state}` : `risk ${doc.risk_score || 0}`)}</p>
      <span>{doc.ai_summary?.headline || doc.content || doc.text}</span>
      <div>{(doc.risk_signals || []).map(s => <b key={s.name}>{s.name}</b>)}</div>
    </article>
  );
}

function EvidenceSummaryCard({ doc }) {
  const summary = doc.ai_summary || {};
  const signals = summary.risk_signals?.length ? summary.risk_signals : (doc.risk_signals || []).map(signal => signal.name);
  return (
    <article className="evidence-summary-card">
      <div className="evidence-summary-head">
        <FileText size={16} />
        <span>
          <strong>{doc.title}</strong>
          <small>{doc.document_type} | risk {summary.risk_score ?? doc.risk_score ?? 0}</small>
        </span>
      </div>
      <p>{summary.headline || doc.content || 'No summary available.'}</p>
      {summary.highlights?.length > 1 && (
        <ul>
          {summary.highlights.slice(1, 3).map(item => <li key={item}>{item}</li>)}
        </ul>
      )}
      <div className="evidence-summary-meta">
        {signals.slice(0, 3).map(signal => <small key={signal}>{signal}</small>)}
      </div>
      <em>{summary.decision_hint || 'Evidence has been vectorized for search and project health scoring.'}</em>
    </article>
  );
}

function Decisions({ overview, api, reload }) {
  const projects = overview?.projects || [];
  const decisions = overview?.decisions || [];
  const [form, setForm] = useState({ project_id: projects[0]?._id || '', title: '', decision_type: 'Intervention', requested_by: '', due_date: '', summary: '' });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!form.project_id && projects[0]?._id) setForm(prev => ({ ...prev, project_id: projects[0]._id }));
  }, [projects]);

  async function addDecision(e) {
    e.preventDefault();
    await api('/api/decisions', { method: 'POST', body: JSON.stringify(form) });
    setForm({ ...form, title: '', requested_by: '', summary: '' });
    setOpen(false);
    reload();
  }

  async function mark(id, status) {
    await api(`/api/decisions/${id}/status?status=${encodeURIComponent(status)}`, { method: 'PUT' });
    reload();
  }

  return (
    <section className="tesla-stage">
      <div className="stage-toolbar">
        <div><h3>Decisions</h3><span>{decisions.length} pending items</span></div>
        <button className="primary-btn" onClick={() => setOpen(true)}>Create Decision</button>
      </div>
      <div className="card glass-panel">
        <h3><Gavel size={22} /> Decision Queue</h3>
        <div className="action-list">
          {decisions.map(d => <DecisionRow key={d._id} item={d} projects={projects} onMark={status => mark(d._id, status)} />)}
        </div>
      </div>
      {open && <Modal title="Create Decision" onClose={() => setOpen(false)}>
      <form className="project-form" onSubmit={addDecision}>
        <h3>Create Decision</h3>
        <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}>{projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select>
        <input placeholder="Decision title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
        <select value={form.decision_type} onChange={e => setForm({ ...form, decision_type: e.target.value })}><option>Intervention</option><option>Approval</option><option>Funding</option><option>Policy</option></select>
        <input placeholder="Requested by" value={form.requested_by} onChange={e => setForm({ ...form, requested_by: e.target.value })} required />
        <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} required />
        <textarea placeholder="Decision summary" value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} required />
        <button className="primary-btn">Add to Queue</button>
      </form>
      </Modal>}
    </section>
  );
}

function DecisionRow({ item, projects, onMark }) {
  const project = projects.find(p => p._id === item.project_id);
  return (
    <article className="action-row decision-row">
      <div>
        <h4>{item.title}</h4>
        <p>{project?.name || 'Project'} | {item.decision_type} | {item.requested_by}</p>
        <small>{item.summary}</small>
      </div>
      <b>{item.due_date}</b>
      <button className="ghost-btn" onClick={() => onMark('Approved')}>Approve</button>
      <button className="ghost-btn danger" onClick={() => onMark('Deferred')}>Defer</button>
    </article>
  );
}

function Disciplines({ overview }) {
  const projects = overview?.projects || [];
  const avg = key => projects.length ? Math.round(projects.reduce((sum, p) => sum + (p.kpis?.[key] || 0), 0) / projects.length) : 0;
  const data = [
    { name: 'WIGs', value: avg('schedule') },
    { name: 'Lead Measures', value: avg('lead_measures') },
    { name: 'Scoreboards', value: avg('document_confidence') },
    { name: 'Cadence', value: avg('cadence') }
  ];
  return (
    <section className="disciplines">
      {[
        ['Focus on the Wildly Important', 'Every project has one WIG and a finish line visible in the CM review.'],
        ['Act on Lead Measures', 'Weekly actions are tracked before lag indicators show failure.'],
        ['Keep a Compelling Scoreboard', 'Documents and evidence update the scoreboard automatically.'],
        ['Create Cadence of Accountability', 'Assignments close the loop between meetings and field execution.']
      ].map(([title, body], idx) => <div className="card discipline" key={title}><span>{idx + 1}</span><h3>{title}</h3><p>{body}</p></div>)}
      <div className="card discipline-chart">
        <h3>Discipline Adoption From Project Data</h3>
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={data}>
            <CartesianGrid stroke="#e9edf4" vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis hide domain={[0, 100]} />
            <Tooltip />
            <Bar dataKey="value" radius={[7, 7, 0, 0]}>
              {data.map((entry, index) => <Cell key={entry.name} fill={['#0a2347', '#1f8f4d', '#f59e0b', '#df2c1d'][index]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function Admin({ settings, setSettings, api, reload }) {
  const [draft, setDraft] = useState(settings || {});
  const [saved, setSaved] = useState(false);
  const [vectorStatus, setVectorStatus] = useState('');
  const [vectorReadiness, setVectorReadiness] = useState(null);

  useEffect(() => setDraft(settings || {}), [settings]);
  useEffect(() => {
    loadVectorStatus();
  }, []);

  async function loadVectorStatus() {
    try {
      const data = await api('/api/vector-status');
      setVectorReadiness(data);
    } catch {
      setVectorReadiness({ mode: 'unavailable', native_ready: false, entity_vectors: 0, document_vectors: 0 });
    }
  }

  function uploadLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDraft({ ...draft, logo_url: reader.result });
    reader.readAsDataURL(file);
  }

  async function save(e) {
    e.preventDefault();
    const data = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(draft) });
    setSettings(data);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  async function vectorize() {
    setVectorStatus('Vectorizing documents and requesting MongoDB Atlas index...');
    const data = await api('/api/vectorize', { method: 'POST' });
    setVectorStatus(`${data.documents_vectorized} documents vectorized. ${data.index.message}`);
    await loadVectorStatus();
    reload();
  }

  async function reseed() {
    await api('/api/admin/reseed', { method: 'POST' });
    reload();
  }

  return (
    <section className="admin-layout">
      <form className="card admin-form" onSubmit={save}>
        <h3><Settings size={22} /> Admin Customization</h3>
        <label>Dashboard title<input value={draft.title || ''} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label>Government / department name<input value={draft.department || ''} onChange={e => setDraft({ ...draft, department: e.target.value })} /></label>
        <label>Banner message<input value={draft.banner || ''} onChange={e => setDraft({ ...draft, banner: e.target.value })} /></label>
        <label className="upload-box"><ImagePlus size={24} /> Upload logo placeholder<input type="file" accept="image/*" onChange={uploadLogo} /></label>
        <button className="primary-btn" type="submit"><Upload size={18} /> Save Branding</button>
        <button className="ghost-btn" type="button" onClick={vectorize}><Brain size={17} /> Vectorize Evidence</button>
        <button className="ghost-btn danger" type="button" onClick={reseed}>Reset Demo Data</button>
        <div className="vector-status">
          <span>Vector Search Readiness</span>
          <p>{vectorReadiness?.native_ready ? 'MongoDB Atlas native search active' : 'Local vector fallback active'}</p>
          <small>{vectorReadiness?.entity_vectors || 0} workflow vectors | {vectorReadiness?.document_vectors || 0} document vectors</small>
          <small>Entity index {vectorReadiness?.entity_index?.present ? 'ready' : 'not visible'} | Document index {vectorReadiness?.document_index?.present ? 'ready' : 'not visible'}</small>
        </div>
        {saved && <p className="saved">Saved</p>}
        {vectorStatus && <p className="saved">{vectorStatus}</p>}
      </form>
      <div className="card preview-card">
        <h3>Page Preview</h3>
        <div className="preview-hero">
          {draft.logo_url ? <img src={draft.logo_url} alt="" /> : <Shield size={42} />}
          <h2>{draft.title || 'Government Execution Dashboard'}</h2>
          <p>{draft.department || 'Department name'}</p>
          <span>{draft.banner || 'High level view. Right insights. Timely interventions.'}</span>
        </div>
      </div>
    </section>
  );
}

function percent(count, total) {
  return total ? Math.round((count / total) * 100) : 0;
}

createRoot(document.getElementById('root')).render(<App />);
