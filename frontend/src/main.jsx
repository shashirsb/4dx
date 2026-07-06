import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowUpDown,
  Bell,
  Brain,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  Command,
  ClipboardList,
  FileSearch,
  FileText,
  Globe,
  Download,
  Gauge,
  Gavel,
  Home,
  ImagePlus,
  Landmark,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquare,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  Sparkles,
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
import { LOCALES, deptLabel, formatDate, pageMeta, t } from './i18n';
import { REGIONS, regionById } from './regions';
import './styles.css';

const API = import.meta.env.VITE_API_URL || '';
const statusColors = { 'On Track': '#0a8754', 'At Risk': '#b25e09', 'Off Track': '#d92d20' };
const healthStateColors = {
  green: '#0a8754',
  amber: '#d97706',
  red: '#d92d20',
  blocker: '#991b1b',
  approval: '#7c3aed',
  hold: '#64748b',
};

function priorityTone(value) {
  const p = Number(value) || 5;
  if (p >= 8) return 'critical';
  if (p >= 6) return 'high';
  if (p >= 4) return 'medium';
  return 'low';
}

function PriorityChip({ value }) {
  const p = Number(value) || 5;
  return <span className={`prio-chip ${priorityTone(p)}`} title={`Priority ${p} of 10`}>P{p}</span>;
}

const PRIORITY_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

const UPDATE_FREQUENCY_OPTIONS = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'bi-weekly', label: 'Bi-weekly' },
  { id: 'monthly', label: 'Monthly' },
];

const GLOBAL_ADMIN_ROLES = new Set(['executive_assistant', 'admin']);

function isGlobalAdminUser(user) {
  return GLOBAL_ADMIN_ROLES.has(user?.role);
}

function canOpenAdmin(user) {
  return isGlobalAdminUser(user);
}

function roleLabel(role) {
  const labels = {
    chief_minister: 'Chief Minister',
    minister: 'Minister',
    executive_assistant: 'Executive Assistant',
    ministry_admin: 'Ministry Admin',
    admin: 'Global Admin',
    user: 'General User',
  };
  return labels[role] || 'General User';
}

function formatFreqLabel(freq) {
  return UPDATE_FREQUENCY_OPTIONS.find(o => o.id === freq)?.label || freq || 'Weekly';
}

function formatBudgetCr(value) {
  const n = Number(value) || 0;
  return `₹${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} Cr`;
}

function tightestDeadline(...values) {
  const dates = values.filter(Boolean);
  if (!dates.length) return '';
  return dates.reduce((min, value) => (!min || value < min) ? value : min);
}

function deadlineExceedsCap(deadline, cap) {
  if (!deadline || !cap) return false;
  return deadline > cap;
}

function isEntityComplete(entity) {
  if (entity?.archived_at) return true;
  const pct = progressPercent(entity?.from_value, entity?.to_value, entity?.current_value ?? entity?.from_value);
  if (pct >= 100) return true;
  const status = String(entity?.status || '').toLowerCase();
  return ['done', 'closed', 'complete', 'completed'].includes(status);
}

function isEntityOverdue(entity) {
  if (isEntityComplete(entity)) return false;
  const deadline = entity?.deadline || entity?.due_date;
  if (!deadline) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${deadline}T00:00:00`);
  return due < today;
}

function OverdueBadge({ entity }) {
  if (!isEntityOverdue(entity)) return null;
  return <span className="status-badge overdue">Overdue</span>;
}

function projectBudgetSummary(project) {
  const total = Number(project?.budget_crore) || 0;
  const spent = Number(project?.spent_crore) || 0;
  const wigs = (project?.wigs || []).filter(w => !w.archived_at);
  const allocated = wigs.reduce((sum, w) => sum + (Number(w.budget_allocated) || 0), 0);
  return { total, spent, allocated, remaining: Math.max(0, total - allocated), overAllocated: total > 0 && allocated > total };
}

function wigBudgetSummary(wig) {
  const total = Number(wig?.budget_allocated) || 0;
  const measures = (wig?.lead_measures || []).filter(m => !m.archived_at);
  const allocated = measures.reduce((sum, m) => sum + (Number(m.budget_allocated) || 0), 0);
  return { total, allocated, remaining: Math.max(0, total - allocated), overAllocated: total > 0 && allocated > total };
}

function scoreColor(value) {
  if (value >= 75) return '#0a8754';
  if (value >= 55) return '#d97706';
  return '#d92d20';
}

/* Count-up animation for headline numbers. */
function AnimatedNumber({ value, suffix = '' }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const target = Number(value) || 0;
    if (target === 0) { setDisplay(0); return; }
    let frame;
    const start = performance.now();
    const duration = 650;
    const tick = now => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(target * eased));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{display}{suffix}</>;
}

/* Inline sparkbar built from WIG progress (falls back to KPI profile). */
function SparkBars({ project }) {
  const wigs = (project.wigs || []).filter(w => !w.archived_at);
  let values = wigs.map(w => Number(w.progress) || 0);
  if (!values.length) {
    const kpis = project.kpis || {};
    values = ['schedule', 'quality', 'cadence', 'lead_measures'].map(k => Number(kpis[k]) || 0);
  }
  values = values.slice(0, 8);
  const barW = 8;
  const gap = 3;
  const width = values.length * (barW + gap) - gap;
  return (
    <svg width={width} height={26} aria-hidden="true">
      {values.map((v, i) => {
        const h = Math.max(2, (v / 100) * 26);
        return <rect key={i} x={i * (barW + gap)} y={26 - h} width={barW} height={h} rx={2} fill={scoreColor(v)} opacity={0.85} />;
      })}
    </svg>
  );
}

function CommandPalette({ open, onClose, projects, locale, onNavigate, onExport, session }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  const views = [
    ['overview', Home, t('overview', locale)],
    ['projects', ClipboardList, t('projects', locale)],
    ['scoreboard', Gauge, t('scoreboard', locale)],
    ['decisions', Gavel, t('decisions', locale)],
    ['evidence', Brain, t('evidence', locale)],
  ];
  if (canOpenAdmin(session?.user)) views.push(['admin', Settings, t('admin', locale)]);

  const items = useMemo(() => {
    const text = query.trim().toLowerCase();
    const nav = views
      .filter(([, , label]) => !text || label.toLowerCase().includes(text))
      .map(([id, icon, label]) => ({ kind: 'nav', id, icon, label }));
    const acts = (!text || t('exportPortfolio', locale).toLowerCase().includes(text))
      ? [{ kind: 'export', id: 'export', icon: Download, label: t('exportPortfolio', locale) }]
      : [];
    const projs = projects
      .filter(p => !text || [p.name, p.ministry, p.owner].join(' ').toLowerCase().includes(text))
      .slice(0, text ? 8 : 4)
      .map(p => ({ kind: 'project', id: p._id, icon: Target, label: p.name, meta: `${p.health_score}% · ${p.status}` }));
    return [...nav, ...acts, ...projs];
  }, [query, projects, locale, session?.user?.role]);

  useEffect(() => { setSelected(0); }, [query, open]);
  useEffect(() => { if (open) setQuery(''); }, [open]);

  function run(item) {
    onClose();
    if (item.kind === 'export') onExport();
    else if (item.kind === 'project') onNavigate('projects', item.id);
    else onNavigate(item.id);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter' && items[selected]) { e.preventDefault(); run(items[selected]); }
    else if (e.key === 'Escape') onClose();
  }

  if (!open) return null;

  let lastKind = null;
  const groupLabels = { nav: 'Navigate', export: 'Actions', project: t('projects', locale) };

  return (
    <div className="cmdk-backdrop" onMouseDown={onClose}>
      <div className="cmdk-panel" onMouseDown={e => e.stopPropagation()}>
        <div className="cmdk-input">
          <Search size={17} />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`${t('projects', locale)}, ${t('scoreboard', locale)}…`}
          />
          <kbd>esc</kbd>
        </div>
        <div className="cmdk-list">
          {items.map((item, index) => {
            const Icon = item.icon;
            const header = item.kind !== lastKind ? <div className="cmdk-group" key={`g-${item.kind}`}>{groupLabels[item.kind]}</div> : null;
            lastKind = item.kind;
            return (
              <React.Fragment key={`${item.kind}-${item.id}`}>
                {header}
                <button
                  className={`cmdk-item ${index === selected ? 'selected' : ''}`}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => run(item)}
                >
                  <Icon size={16} /> {item.label}
                  {item.meta && <small>{item.meta}</small>}
                </button>
              </React.Fragment>
            );
          })}
          {items.length === 0 && <div className="cmdk-empty">No results for “{query}”</div>}
        </div>
      </div>
    </div>
  );
}

function ToastStack({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast ${toast.type}`}>
          {toast.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          {toast.message}
        </div>
      ))}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <section aria-hidden="true">
      <div className="discipline-strip">
        {[0, 1, 2, 3].map(i => <div className="skeleton" style={{ height: 68 }} key={i} />)}
      </div>
      <div className="cc-hero">
        <div className="skeleton" style={{ height: 150, borderRadius: 18 }} />
        {[0, 1, 2, 3].map(i => <div className="skeleton" style={{ height: 150, borderRadius: 18 }} key={i} />)}
      </div>
      <div className="dashboard-grid" style={{ marginTop: 14 }}>
        {[0, 1, 2].map(i => <div className="skeleton" style={{ height: 220, borderRadius: 14 }} key={i} />)}
      </div>
    </section>
  );
}

function App() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('session') || 'null'));
  const [settings, setSettings] = useState(null);
  const [locale, setLocale] = useState(() => localStorage.getItem('locale') || 'en');
  const [overview, setOverview] = useState(null);
  const [active, setActive] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [openProjectId, setOpenProjectId] = useState(null);
  const [openWigId, setOpenWigId] = useState(null);
  const [openMeasureId, setOpenMeasureId] = useState(null);
  const [meetingToAction, setMeetingToAction] = useState({ open: false, projectId: null });
  const [mtaRefreshKey, setMtaRefreshKey] = useState(0);

  function pushToast(message, type = 'success') {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(item => item.id !== id)), 3200);
  }

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(v => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    loadPublic();
  }, []);

  useEffect(() => {
    if (settings?.locale && LOCALES.some(item => item.id === settings.locale)) {
      setLocale(settings.locale);
    }
  }, [settings?.locale]);

  useEffect(() => {
    localStorage.setItem('locale', locale);
    document.documentElement.lang = locale === 'sg' ? 'en-SG' : locale === 'zh' ? 'zh-CN' : locale;
  }, [locale]);

  useEffect(() => {
    if (session) {
      localStorage.setItem('session', JSON.stringify(session));
      loadOverview(session.token);
    } else {
      localStorage.removeItem('session');
      setOverview(null);
    }
  }, [session]);

  useEffect(() => {
    if (!session?.token) return;
    refreshSession(session.token);
    // Refresh role from backend once on load (handles stale localStorage sessions).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const projects = overview?.projects || [];
  const ministries = overview?.ministries || [];
  const [filters, setFilters] = useState({ ministryId: '', projectId: '', wigId: '', health: '' });
  const filteredProjects = useMemo(() => filterProjects(projects, filters), [projects, filters]);
  const filteredOverview = useMemo(() => buildFilteredOverview(overview, filteredProjects), [overview, filteredProjects]);
  const filteredMinistries = useMemo(() => {
    if (!filters.ministryId) return ministries;
    return ministries.filter(ministry => ministry._id === filters.ministryId);
  }, [ministries, filters.ministryId]);

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;
    if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API}${path}`, { ...options, headers });
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!res.ok) {
      const message = data.detail || 'Request failed';
      if (res.status === 401) {
        setSession(null);
        throw new Error('Session expired. Please sign in again.');
      }
      throw new Error(typeof message === 'string' ? message : 'Request failed');
    }
    return data;
  }

  async function loadPublic() {
    try {
      const res = await fetch(`${API}/api/public/settings`);
      setSettings(await res.json());
    } catch {
      setSettings({
        title: '4DX Execution Platform',
        department: 'Strategic Delivery Office',
        banner: '',
        logo_url: '',
        locale: 'en',
        region: 'global',
        currency: 'USD',
        timezone: 'UTC',
        org_type: 'enterprise',
      });
    }
  }

  async function refreshSession(token = session?.token) {
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        setSession(null);
        return;
      }
      const data = await res.json();
      if (data.user) {
        setSession(prev => (prev?.token === token ? { ...prev, user: data.user } : prev));
      }
    } catch {
      /* keep cached session on transient network errors */
    }
  }

  async function loadOverview(token = session?.token) {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/overview`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        setSession(null);
        return;
      }
      setOverview(await res.json());
    } catch (err) {
      setError(err.message || 'Failed to load portfolio data');
    } finally {
      setLoading(false);
    }
  }

  function navigate(view, projectId, drill = {}) {
    setOpenProjectId(projectId || null);
    setOpenWigId(drill.wigId || null);
    setOpenMeasureId(drill.measureId || null);
    setActive(view);
    setSidebarOpen(false);
  }

  function openWorkspace({ projectId, wigId = null, measureId = null }) {
    navigate('projects', projectId, { wigId, measureId });
  }

  function closeWorkspace() {
    setOpenProjectId(null);
    setOpenWigId(null);
    setOpenMeasureId(null);
  }

  async function exportPortfolio() {
    if (!session?.token) return;
    try {
      const res = await fetch(`${API}/api/portfolio/export`, { headers: { Authorization: `Bearer ${session.token}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = '4dx-portfolio.csv';
      link.click();
      URL.revokeObjectURL(url);
      pushToast(`${t('exportPortfolio', locale)} — 4dx-portfolio.csv`);
    } catch (err) {
      pushToast(err.message || 'Export failed', 'error');
    }
  }

  const orgType = settings?.org_type || 'enterprise';

  if (!session) {
    return <Login settings={settings} locale={locale} setLocale={setLocale} onSession={setSession} />;
  }

  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="workspace">
        <TopBar
          active={active}
          settings={settings}
          session={session}
          locale={locale}
          setLocale={setLocale}
          refresh={() => loadOverview()}
          loading={loading}
          onMenu={() => setSidebarOpen(v => !v)}
          stats={overview?.stats}
          onExport={exportPortfolio}
          onOpenPalette={() => setPaletteOpen(true)}
          onNavigate={navigate}
          onLogout={() => setSession(null)}
        />
        {error && (
          <div className="error-banner">
            <AlertTriangle size={16} /> {error}
            <button className="ghost-btn" onClick={() => setError('')}>Dismiss</button>
          </div>
        )}
        <div className="page-content">
          {active !== 'projects' && (
            <GlobalFilters projects={projects} ministries={ministries} filters={filters} setFilters={setFilters} resultCount={filteredProjects.length} locale={locale} orgType={orgType} />
          )}
          {active === 'overview' && <CommandCenter overview={filteredOverview} loading={loading} locale={locale} onNavigate={navigate} onExport={exportPortfolio} />}
          {active === 'projects' && (openProjectId ? (
            <ProjectWorkspace
              projectId={openProjectId}
              initialWigId={openWigId}
              initialMeasureId={openMeasureId}
              projects={projects}
              api={api}
              reload={loadOverview}
              session={session}
              notify={pushToast}
              onExit={closeWorkspace}
              locale={locale}
              onOpenMeetingToAction={() => setMeetingToAction({ open: true, projectId: openProjectId })}
              mtaRefreshKey={mtaRefreshKey}
            />
          ) : (
            <Projects
              projects={filteredProjects}
              allProjects={projects}
              ministries={ministries}
              permissions={overview?.permissions}
              session={session}
              api={api}
              reload={loadOverview}
              onOpen={id => openWorkspace({ projectId: id })}
              onOpenMeetingToAction={() => setMeetingToAction({ open: true, projectId: null })}
              locale={locale}
            />
          ))}
          {active === 'ministries' && <Ministries ministries={filteredMinistries} projects={filteredProjects} />}
          {active === 'scoreboard' && (
            <Scoreboard
              api={api}
              projects={filteredProjects}
              ministries={ministries}
              filters={filters}
              setFilters={setFilters}
              onOpenProject={row => openWorkspace({ projectId: row.project_id })}
              onOpenWig={row => openWorkspace({ projectId: row.project_id, wigId: row.wig_id })}
              onOpenMeasure={row => openWorkspace({ projectId: row.project_id, wigId: row.wig_id, measureId: row.measure_id })}
            />
          )}
          {active === 'workflow' && <Workflow overview={filteredOverview} api={api} reload={loadOverview} />}
          {active === 'evidence' && <AIInsight projects={filteredProjects} api={api} reload={loadOverview} notify={pushToast} onOpenProject={id => navigate('projects', id)} />}
          {active === 'decisions' && <Decisions overview={filteredOverview} api={api} reload={loadOverview} />}
          {active === 'admin' && canOpenAdmin(session.user) && <Admin settings={settings} setSettings={setSettings} api={api} reload={loadOverview} locale={locale} setLocale={setLocale} />}
        </div>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        projects={projects}
        locale={locale}
        onNavigate={navigate}
        onExport={exportPortfolio}
        session={session}
      />
      <ToastStack toasts={toasts} />
      <MeetingToActionModal
        open={meetingToAction.open}
        onClose={() => setMeetingToAction({ open: false, projectId: null })}
        initialProjectId={meetingToAction.projectId}
        projects={projects}
        ministries={ministries}
        api={api}
        locale={locale}
        notify={pushToast}
        onApplied={(project, appliedProjectId) => {
          loadOverview();
          setMtaRefreshKey(key => key + 1);
          if (appliedProjectId && appliedProjectId === openProjectId && project) {
            /* workspace reloads via mtaRefreshKey */
          }
        }}
      />
    </div>
  );
}

function LocaleSwitcher({ locale, setLocale, compact = false }) {
  return (
    <label className={`locale-switcher ${compact ? 'compact' : ''}`}>
      {!compact && <Globe size={15} />}
      <span className="sr-only">{t('language', locale)}</span>
      <select value={locale} onChange={e => setLocale(e.target.value)} aria-label={t('language', locale)}>
        {LOCALES.map(item => (
          <option key={item.id} value={item.id}>{item.flag} {item.label}</option>
        ))}
      </select>
    </label>
  );
}

function Login({ settings, locale, setLocale, onSession }) {
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
    <div className="login-page gov-login">
      <header className="gov-login-banner">
        <img src="/karnataka-ai-header-compact.png" alt="Government of Karnataka AI in Government" />
      </header>
      <main className="gov-login-main">
        <section className="gov-login-left">
          <h1><span>4DX</span> Government Execution Platform</h1>
          <p>Decision with help of AI</p>
          <div className="login-disciplines gov-disciplines">
            <div className="login-discipline"><Target size={30} /><strong>WIGs</strong><small>Focus on what matters most</small></div>
            <div className="login-discipline"><TrendingUp size={30} /><strong>Lead Measures</strong><small>Track the right drivers</small></div>
            <div className="login-discipline"><Gauge size={30} /><strong>Scoreboard</strong><small>Make progress transparent</small></div>
            <div className="login-discipline"><CalendarClock size={30} /><strong>Cadence</strong><small>Run effective weekly rhythms</small></div>
          </div>
        </section>
        <motion.form className="login-panel gov-login-panel" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} onSubmit={step === 'phone' ? requestOtp : verifyOtp}>
          <Shield className="login-shield" size={42} />
          <h2>Sign in with mobile OTP</h2>
          <label>
            <span>Mobile number</span>
            <div className="input-wrap"><Phone size={18} /><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Enter 10 digit mobile number" required /></div>
            <small>We will send a one-time password (OTP) to this number.</small>
          </label>
          <label>
            <span>OTP</span>
            <div className="input-wrap">
              <LockKeyhole size={18} />
              <input value={otp} onChange={e => setOtp(e.target.value)} placeholder="Enter 6 digit OTP" disabled={step === 'phone'} required={step === 'otp'} />
              {step === 'otp' && <button className="link-btn" type="button" onClick={requestOtp}>Resend OTP</button>}
            </div>
            {demoOtp && <small>Demo OTP: {demoOtp}</small>}
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary-btn" type="submit">
            {step === 'phone' ? 'Continue' : 'Continue'}
          </button>
          <div className="access-note"><LockKeyhole size={14} /> Access is role based:</div>
          <div className="role-login-grid">
            <span><UserRound size={22} />CM Office</span>
            <span><Landmark size={22} />Minister</span>
            <span><Users size={22} />Executive Assistant</span>
            <span><Landmark size={22} />Ministry Admin</span>
            <span><UserRound size={22} />General User</span>
          </div>
        </motion.form>
      </main>
      <footer className="gov-login-footer">
        <span><Shield size={28} /><b>Trusted. Secure. Government.</b><small>Built for Karnataka.</small></span>
        <span><LockKeyhole size={26} /><b>Secure by Design</b><small>Data is encrypted and role based.</small></span>
        <span><Landmark size={28} /><b>Government of Karnataka</b><small>Official execution platform.</small></span>
        <span><Shield size={26} /><b>CERT-In Compliant</b><small>Aligned with cyber standards.</small></span>
      </footer>
    </div>
  );
}

function Sidebar({ active, setActive, settings, session, locale, orgType, onLogout }) {
  const deptNav = deptLabel(orgType, locale);
  const items = [
    ['overview', Home, t('overview', locale)],
    ['projects', ClipboardList, t('projects', locale)],
    ['ministries', Landmark, deptNav],
    ['scoreboard', Gauge, t('scoreboard', locale)],
    ['workflow', Users, t('workflow', locale)],
    ['evidence', Brain, t('evidence', locale)],
    ['decisions', Gavel, t('decisions', locale)],
  ];
  if (canOpenAdmin(session.user)) items.push(['admin', Settings, t('admin', locale)]);

  return (
    <aside className="sidebar">
      <div className="side-brand">
        {settings?.logo_url ? <img src={settings.logo_url} alt="" /> : <Building2 />}
        <div><strong>4DX</strong><span>{settings?.region?.toUpperCase() || session.user.role}</span></div>
      </div>
      <nav>
        {items.map(([id, Icon, label]) => (
          <button key={id} className={active === id ? 'active' : ''} onClick={() => setActive(id)}>
            <Icon size={18} /> <span>{label}</span>
          </button>
        ))}
      </nav>
      <button className="logout" onClick={onLogout}><LogOut size={18} /> {t('signOut', locale)}</button>
    </aside>
  );
}

function TopBar({ active, settings, session, locale, setLocale, refresh, loading, stats, onExport, onOpenPalette, onNavigate, onLogout }) {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const navItems = [
    ['overview', Home, 'Overview'],
    ['ministries', Landmark, 'Ministries'],
    ['projects', ClipboardList, 'Projects'],
    ['workflow', Users, 'Workflow'],
    ['evidence', Brain, 'Evidence AI'],
    ['decisions', Gavel, 'Decisions'],
    ['scoreboard', Gauge, 'Reports'],
  ];
  if (canOpenAdmin(session.user)) navItems.push(['admin', Settings, 'Admin']);
  return (
    <header className="app-header">
      <div className="top-brand">
        <img src="/karnataka-header-left.png" alt="Government of Karnataka" />
        <div>
          <strong>AI in Government of Karnataka</strong>
          <span>Decision with help of AI</span>
        </div>
      </div>
      <nav className="top-nav" aria-label="Primary navigation">
        {navItems.map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            className={active === id ? 'active' : ''}
            onClick={() => onNavigate(id)}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="header-actions">
        <button className="cmdk-trigger compact" onClick={onOpenPalette}>
          <Search size={14} />
          <span className="cmdk-trigger-label">Search anything...</span>
        </button>
        <button className="icon-btn alert-icon" title="Alerts"><Bell size={15} />{overviewAlertDot(stats)}</button>
        <div className="top-user">
          <span className="avatar">{(session.user.display_name || session.user.phone || 'U').slice(0, 2).toUpperCase()}</span>
          <div>
            <strong>{session.user.display_name || session.user.phone}</strong>
            <small>{roleLabel(session.user.role)}</small>
          </div>
        </div>
        <button className="icon-btn" onClick={refresh} title="Refresh"><RefreshCw size={15} className={loading ? 'spin' : ''} /></button>
        <button className="icon-btn danger" onClick={onLogout} title={t('signOut', locale)}><LogOut size={15} /></button>
      </div>
    </header>
  );
}

function overviewAlertDot(stats) {
  if (!stats?.off_track && !stats?.at_risk) return null;
  return <span className="alert-dot">{Number(stats.off_track || 0) + Number(stats.at_risk || 0)}</span>;
}

function GlobalFilters({ projects, ministries, filters, setFilters, resultCount, locale, orgType }) {
  const ministryProjects = useMemo(() => {
    if (!filters.ministryId) return projects;
    return projects.filter(project => project.ministry_id === filters.ministryId);
  }, [projects, filters.ministryId]);
  const wigOptions = useMemo(() => {
    const scoped = filters.projectId ? projects.filter(project => project._id === filters.projectId) : ministryProjects;
    return scoped.flatMap(project => (project.wigs || [])
      .filter(wig => !wig.archived_at)
      .map(wig => ({ id: wig.id, title: wig.title, project: project.name })));
  }, [projects, ministryProjects, filters.projectId]);
  const hasFilters = filters.ministryId || filters.projectId || filters.wigId || filters.health;

  function updateFilter(key, value) {
    setFilters(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'ministryId') { next.projectId = ''; next.wigId = ''; }
      if (key === 'projectId') next.wigId = '';
      return next;
    });
  }

  return (
    <section className="global-filter-bar" aria-label="Portfolio filters">
      <label><span>{deptLabel(orgType, locale)}</span>
        <select value={filters.ministryId} onChange={e => updateFilter('ministryId', e.target.value)}>
          <option value="">{t('allMinistries', locale)}</option>
          {ministries.map(m => <option key={m._id} value={m._id}>{m.name}</option>)}
        </select>
      </label>
      <label><span>{t('filterProject', locale)}</span>
        <select value={filters.projectId} onChange={e => updateFilter('projectId', e.target.value)}>
          <option value="">{t('allProjects', locale)}</option>
          {ministryProjects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
        </select>
      </label>
      <label><span>{t('filterWig', locale)}</span>
        <select value={filters.wigId} onChange={e => updateFilter('wigId', e.target.value)}>
          <option value="">{t('allWigs', locale)}</option>
          {wigOptions.map(wig => <option key={`${wig.project}-${wig.id}`} value={wig.id}>{wig.title}</option>)}
        </select>
      </label>
      <label><span>{t('filterHealth', locale)}</span>
        <select value={filters.health} onChange={e => updateFilter('health', e.target.value)}>
          <option value="">{t('anyHealth', locale)}</option>
          <option value="On Track">{t('onTrack', locale)}</option>
          <option value="At Risk">{t('atRisk', locale)}</option>
          <option value="Off Track">{t('offTrack', locale)}</option>
          <option value="green">Green</option>
          <option value="amber">Amber</option>
          <option value="red">Red</option>
          <option value="blocker">Blocker</option>
          <option value="approval">Approval</option>
          <option value="hold">Hold</option>
        </select>
      </label>
      <div className="filter-result-pill"><FileSearch size={15} /><span>{resultCount} {t('projectsCount', locale)}</span></div>
      {hasFilters && <button className="ghost-btn" onClick={() => setFilters({ ministryId: '', projectId: '', wigId: '', health: '' })}>{t('clear', locale)}</button>}
    </section>
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

function contextualInsightSeverityTone(severity) {
  const s = (severity || 'medium').toLowerCase();
  if (s === 'high') return 'red';
  if (s === 'low') return 'green';
  return 'amber';
}

function riskSourceMeta(source) {
  if (!source) return { label: '', navigable: false };
  if (typeof source === 'string') return { label: source, navigable: false };
  return {
    label: source.label || source.type || 'Source',
    navigable: Boolean(source.project_id),
  };
}

function AIInsightModal({ open, onClose, scope, projectId, wigId, measureId, entityTitle, api, locale, onNavigateToRisk }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [qaThread, setQaThread] = useState([]);
  const [askQuestion, setAskQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');

  useEffect(() => {
    if (!open) {
      setResult(null);
      setError('');
      setLoading(false);
      setQaThread([]);
      setAskQuestion('');
      setAsking(false);
      setAskError('');
      return undefined;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        let path = `/api/ai/insight/project/${projectId}`;
        if (scope === 'wig') path = `/api/ai/insight/wig/${projectId}/${wigId}`;
        if (scope === 'measure') path = `/api/ai/insight/measure/${projectId}/${wigId}/${measureId}`;
        const data = await api(path, { method: 'POST', body: JSON.stringify({}) });
        if (!cancelled) setResult(data);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Insight failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [open, scope, projectId, wigId, measureId, api]);

  function insightAskPath() {
    let path = `/api/ai/insight/project/${projectId}/ask`;
    if (scope === 'wig') path = `/api/ai/insight/wig/${projectId}/${wigId}/ask`;
    if (scope === 'measure') path = `/api/ai/insight/measure/${projectId}/${wigId}/${measureId}/ask`;
    return path;
  }

  async function submitFollowUp(e) {
    e.preventDefault();
    const question = askQuestion.trim();
    if (!question || asking || loading) return;
    setAsking(true);
    setAskError('');
    try {
      const data = await api(insightAskPath(), {
        method: 'POST',
        body: JSON.stringify({ question }),
      });
      setQaThread(prev => [...prev, {
        question,
        answer: (data.answer || '').trim() || t('aiInsightAskEmpty', locale),
        llm_status: data.llm_status,
      }]);
      setAskQuestion('');
    } catch (err) {
      setAskError(err.message || t('aiInsightAskEmpty', locale));
    } finally {
      setAsking(false);
    }
  }

  if (!open) return null;

  const scopeLabel = scope === 'measure'
    ? t('aiInsightScopeMeasure', locale)
    : scope === 'wig'
      ? t('aiInsightScopeWig', locale)
      : t('aiInsightScopeProject', locale);

  const summary = (result?.summary || '').trim();
  const risks = result?.risks || [];
  const highlights = result?.highlights || [];
  const hasContent = Boolean(summary || risks.length || highlights.length);
  const askPlaceholder = scope === 'measure'
    ? t('aiInsightAskPlaceholderMeasure', locale)
    : scope === 'wig'
      ? t('aiInsightAskPlaceholderWig', locale)
      : t('aiInsightAskPlaceholderProject', locale);

  return (
    <div className="modal-backdrop ai-insight-modal-backdrop" onMouseDown={onClose}>
      <motion.div
        className="modal-panel ai-insight-modal"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="ai-insight-modal-head">
          <div>
            <span className="pw-kicker"><Brain size={14} /> {scopeLabel}</span>
            <h2>{entityTitle}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="ai-insight-modal-body">
          {loading && (
            <div className="ai-insight-loading">
              <Loader2 size={24} className="spin" />
              <p>{t('aiInsightGenerating', locale)}</p>
            </div>
          )}
          {error && <p className="ai-error">{error}</p>}
          {!loading && result && !hasContent && (
            <p className="ai-error">{t('aiInsightEmpty', locale)}</p>
          )}
          {!loading && result && hasContent && (
            <>
              <div className="ai-insight-summary card">
                <h3>{t('aiInsightSummary', locale)}</h3>
                {summary ? <p>{summary}</p> : <p className="ai-error">{t('aiInsightEmpty', locale)}</p>}
                {result.llm_status && <LlmStatusBadge status={result.llm_status} locale={locale} feature="insight" />}
              </div>
              {risks.length > 0 && (
                <section className="ai-insight-risks">
                  <h3>{t('aiInsightRisks', locale)}</h3>
                  <div className="ai-insight-risk-grid">
                    {risks.map((risk, index) => {
                      const sourceMeta = riskSourceMeta(risk.source);
                      return (
                      <article className={`ai-insight-risk-card ${contextualInsightSeverityTone(risk.severity)}`} key={`${risk.title}-${index}`}>
                        <div className="ai-insight-risk-head">
                          <span className={`severity-badge ${contextualInsightSeverityTone(risk.severity)}`}>{risk.severity}</span>
                          {sourceMeta.label && <span className="ai-source-chip">{sourceMeta.label}</span>}
                        </div>
                        {sourceMeta.navigable ? (
                          <button type="button" className="ai-risk-title-link" onClick={() => onNavigateToRisk?.(risk.source)}>
                            <strong>{risk.title}</strong>
                          </button>
                        ) : (
                          <strong>{risk.title}</strong>
                        )}
                        <p>{risk.reason}</p>
                        {sourceMeta.navigable && (
                          <button type="button" className="ai-risk-link" onClick={() => onNavigateToRisk?.(risk.source)}>
                            {t('aiInsightViewSource', locale)}
                          </button>
                        )}
                      </article>
                    );})}
                  </div>
                </section>
              )}
              {highlights.length > 0 && (
                <section className="ai-insight-highlights">
                  <h3>{t('aiInsightHighlights', locale)}</h3>
                  {highlights.map((item, index) => (
                    <div className="ai-insight-highlight" key={`${item.title}-${index}`}>
                      <CheckCircle2 size={15} />
                      <div>
                        <strong>{item.title}</strong>
                        {item.detail && <p>{item.detail}</p>}
                      </div>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          {!loading && result && (
            <section className="ai-insight-qa">
              <h3>{t('aiInsightFollowUp', locale)}</h3>
              {qaThread.length > 0 && (
                <div className="ai-insight-qa-thread">
                  {qaThread.map((turn, index) => (
                    <article className="ai-insight-qa-turn" key={`${turn.question}-${index}`}>
                      <div className="ai-insight-qa-q">
                        <Search size={14} />
                        <p>{turn.question}</p>
                      </div>
                      <div className="ai-insight-qa-a">
                        <p>{turn.answer}</p>
                        {turn.llm_status && <LlmStatusBadge status={turn.llm_status} locale={locale} feature="insight" />}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {asking && (
                <div className="ai-insight-qa-loading">
                  <Loader2 size={18} className="spin" />
                  <span>{t('aiInsightAnswering', locale)}</span>
                </div>
              )}
              {askError && <p className="ai-error">{askError}</p>}
              <form className="ai-insight-qa-form" onSubmit={submitFollowUp}>
                <Search size={16} />
                <input
                  type="text"
                  value={askQuestion}
                  onChange={e => setAskQuestion(e.target.value)}
                  placeholder={askPlaceholder}
                  disabled={asking}
                  aria-label={t('aiInsightFollowUp', locale)}
                />
                <button
                  type="submit"
                  className="primary-btn"
                  disabled={asking || !askQuestion.trim()}
                >
                  <Send size={14} /> {t('aiInsightAsk', locale)}
                </button>
              </form>
            </section>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function formatConfidence(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function formatLlmStatus(status, locale, feature = 'insight') {
  const text = (status || '').trim();
  if (!text) return null;
  const dirtyMarkers = [
    'Error code:',
    'insufficient_quota',
    'credit balance is too low',
    'Local fallback ·',
    'OpenAI:',
    'Claude:',
    'Google:',
    'Local LLM:',
    'timed out',
    '429',
    '400',
  ];
  const isLocalFallback = dirtyMarkers.some(marker => text.includes(marker))
    || ['Local fallback', 'Local heuristic parser', 'Local analysis (cloud unavailable)', 'Local insight engine (cloud unavailable)'].includes(text);
  if (isLocalFallback) {
    return {
      label: feature === 'meeting' ? t('llmStatusLocalAnalysis', locale) : t('llmStatusLocalInsight', locale),
      tone: 'local',
    };
  }
  if (/^(OpenAI|Claude|Google|Local) ·/.test(text)) {
    return { label: text, tone: 'cloud' };
  }
  return { label: text, tone: 'neutral' };
}

function LlmStatusBadge({ status, locale, feature = 'insight' }) {
  const formatted = formatLlmStatus(status, locale, feature);
  if (!formatted) return null;
  return (
    <small className={`ai-mode llm-status-badge ${formatted.tone}`}>
      <Brain size={13} /> {formatted.label}
    </small>
  );
}

const MTA_NEW_WIG = '__new_wig__';
const MTA_NEW_MEASURE = '__new_measure__';
const MTA_WIG_ONLY = '__wig_only__';

const MTA_ACTION_WIG_FIELDS = {
  title: 'new_wig_title',
  current_state: 'new_wig_current_state',
  target_state: 'new_wig_target_state',
  from_value: 'new_wig_from_value',
  to_value: 'new_wig_to_value',
  unit: 'new_wig_unit',
  deadline: 'new_wig_deadline',
  owner: 'new_wig_owner',
  update_frequency: 'new_wig_update_frequency',
  priority: 'new_wig_priority',
  budget_allocated: 'new_wig_budget_allocated',
};

const MTA_ACTION_MEASURE_FIELDS = {
  title: 'new_measure_title',
  current_state: 'new_measure_current_state',
  target_state: 'new_measure_target_state',
  from_value: 'new_measure_from_value',
  to_value: 'new_measure_to_value',
  unit: 'new_measure_unit',
  deadline: 'new_measure_deadline',
  assigned_to: 'new_measure_assigned_to',
  priority: 'new_measure_priority',
  budget_allocated: 'new_measure_budget_allocated',
};

function mtaWigDraftFromItem(item) {
  return {
    title: item.title || '',
    current_state: item.current_state || '',
    target_state: item.target_state || '',
    from_value: item.from_value ?? 0,
    to_value: item.to_value ?? 100,
    unit: item.unit || '%',
    deadline: item.deadline || '',
    owner: item.owner || '',
    priority: item.priority ?? '',
    update_frequency: item.update_frequency || 'weekly',
    budget_allocated: item.budget_allocated ?? '',
  };
}

function mtaMeasureDraftFromItem(item) {
  return {
    title: item.title || '',
    current_state: item.current_state || '',
    target_state: item.target_state || '',
    from_value: item.from_value ?? 0,
    to_value: item.to_value ?? 100,
    unit: item.unit || '%',
    deadline: item.deadline || '',
    assigned_to: Array.isArray(item.assigned_to) ? item.assigned_to.join(', ') : (item.assigned_to || ''),
    priority: item.priority ?? '',
    budget_allocated: item.budget_allocated ?? '',
  };
}

function mtaActionWigDraftFromItem(item) {
  return {
    title: item.new_wig_title || '',
    current_state: item.new_wig_current_state || '',
    target_state: item.new_wig_target_state || '',
    from_value: item.new_wig_from_value ?? 0,
    to_value: item.new_wig_to_value ?? 100,
    unit: item.new_wig_unit || '%',
    deadline: item.new_wig_deadline || '',
    owner: item.new_wig_owner || item.owner || '',
    priority: item.new_wig_priority ?? '',
    update_frequency: item.new_wig_update_frequency || 'weekly',
    budget_allocated: item.new_wig_budget_allocated ?? '',
  };
}

function mtaActionMeasureDraftFromItem(item) {
  const assigned = item.new_measure_assigned_to;
  return {
    title: item.new_measure_title || '',
    current_state: item.new_measure_current_state || '',
    target_state: item.new_measure_target_state || '',
    from_value: item.new_measure_from_value ?? 0,
    to_value: item.new_measure_to_value ?? 100,
    unit: item.new_measure_unit || '%',
    deadline: item.new_measure_deadline || item.due_date || '',
    assigned_to: Array.isArray(assigned) ? assigned.join(', ') : (assigned || item.owner || ''),
    priority: item.new_measure_priority ?? '',
    budget_allocated: item.new_measure_budget_allocated ?? '',
  };
}

function mtaPatchFromDraft(fieldMap, draftPatch) {
  const patch = {};
  Object.entries(draftPatch).forEach(([key, value]) => {
    patch[fieldMap[key] || key] = value;
  });
  return patch;
}

function normalizeMeetingPreview(data) {
  const proposed_wigs = (data?.proposed_wigs || []).map((item, index) => ({
    ...item,
    proposed_ref: item.proposed_ref || `new_wig_${index}`,
  }));
  const proposed_measures = (data?.proposed_measures || []).map((item, index) => ({
    ...item,
    proposed_ref: item.proposed_ref || `new_measure_${index}`,
  }));
  const proposed_actions = (data?.proposed_actions || []).map(item => ({
    ...item,
    wig_only: !!item.wig_only,
    create_new_wig: !!item.create_new_wig,
    create_new_measure: !!item.create_new_measure,
  }));
  return { ...data, proposed_wigs, proposed_measures, proposed_actions };
}

function actionWigSelectValue(item) {
  if (item.create_new_wig) return MTA_NEW_WIG;
  if (item.proposed_wig_ref) return `p:${item.proposed_wig_ref}`;
  if (item.target_wig_id) return `e:${item.target_wig_id}`;
  return '';
}

function actionMeasureSelectValue(item) {
  if (item.wig_only) return MTA_WIG_ONLY;
  if (item.create_new_measure) return MTA_NEW_MEASURE;
  if (item.proposed_measure_ref) return `p:${item.proposed_measure_ref}`;
  if (item.target_measure_id) return `e:${item.target_measure_id}`;
  return '';
}

function measureParentWigValue(item) {
  if (item.proposed_wig_ref) return `p:${item.proposed_wig_ref}`;
  if (item.wig_id) return `e:${item.wig_id}`;
  return '';
}

function buildWigOptions(catalog, proposedWigs, locale, projectId = null) {
  const options = [];
  let wigs = catalog?.wigs || [];
  if (projectId) {
    wigs = wigs.filter(wig => !wig.project_id || wig.project_id === projectId);
  }
  wigs.forEach(wig => {
    const prefix = wig.project_name && !projectId ? `${wig.project_name} · ` : '';
    options.push({ value: `e:${wig.id}`, label: `${prefix}${wig.title}` });
  });
  (proposedWigs || []).forEach(wig => {
    if (wig.proposed_ref && !wig.match_existing_wig_id) {
      if (projectId && wig.project_id && wig.project_id !== projectId) return;
      options.push({ value: `p:${wig.proposed_ref}`, label: `(New) ${wig.title || wig.proposed_ref}` });
    }
  });
  options.push({ value: MTA_NEW_WIG, label: t('meetingToActionCreateNewWig', locale) });
  return options;
}

function buildMeasureOptions(wigKey, catalog, proposedMeasures, locale, projectId = null) {
  const options = [{ value: MTA_WIG_ONLY, label: t('meetingToActionWigOnly', locale) }];
  if (wigKey === MTA_NEW_WIG) {
    options.push({ value: MTA_NEW_MEASURE, label: t('meetingToActionCreateNewMeasure', locale) });
    return options;
  }
  if (wigKey?.startsWith('e:')) {
    const wigId = wigKey.slice(2);
    let wigs = catalog?.wigs || [];
    if (projectId) {
      wigs = wigs.filter(wig => !wig.project_id || wig.project_id === projectId);
    }
    const wig = wigs.find(w => w.id === wigId);
    (wig?.lead_measures || []).forEach(measure => {
      options.push({ value: `e:${measure.id}`, label: measure.title });
    });
  }
  (proposedMeasures || []).forEach(measure => {
    if (measure.proposed_ref && !measure.match_existing_measure_id) {
      if (projectId && measure.project_id && measure.project_id !== projectId) return;
      options.push({ value: `p:${measure.proposed_ref}`, label: `(New) ${measure.title || measure.proposed_ref}` });
    }
  });
  options.push({ value: MTA_NEW_MEASURE, label: t('meetingToActionCreateNewMeasure', locale) });
  return options;
}

function mtaProjectCatalog(catalog, projectId) {
  if (!projectId) return { wigs: catalog?.wigs || [] };
  if (catalog?.projects) {
    const project = catalog.projects.find(entry => entry.project_id === projectId);
    return { wigs: project?.wigs || [] };
  }
  return {
    wigs: (catalog?.wigs || []).filter(wig => !wig.project_id || wig.project_id === projectId),
  };
}

function mtaProjectFromList(projects, projectId) {
  return projects.find(project => project._id === projectId) || null;
}

function patchActionWigAssociation(value) {
  const patch = {
    target_wig_id: null,
    proposed_wig_ref: null,
    create_new_wig: false,
    target_measure_id: null,
    proposed_measure_ref: null,
    create_new_measure: false,
    wig_only: false,
  };
  if (value === MTA_NEW_WIG) {
    patch.create_new_wig = true;
  } else if (value.startsWith('p:')) {
    patch.proposed_wig_ref = value.slice(2);
  } else if (value.startsWith('e:')) {
    patch.target_wig_id = value.slice(2);
  }
  return patch;
}

function patchActionMeasureAssociation(value) {
  const patch = {
    target_measure_id: null,
    proposed_measure_ref: null,
    create_new_measure: false,
    wig_only: false,
  };
  if (value === MTA_WIG_ONLY) {
    patch.wig_only = true;
  } else if (value === MTA_NEW_MEASURE) {
    patch.create_new_measure = true;
  } else if (value.startsWith('p:')) {
    patch.proposed_measure_ref = value.slice(2);
  } else if (value.startsWith('e:')) {
    patch.target_measure_id = value.slice(2);
  }
  return patch;
}

function patchMeasureParentWig(value) {
  const patch = { wig_id: null, proposed_wig_ref: null };
  if (value.startsWith('p:')) patch.proposed_wig_ref = value.slice(2);
  else if (value.startsWith('e:')) patch.wig_id = value.slice(2);
  return patch;
}

function MeetingToActionModal({ open, onClose, initialProjectId = null, projects = [], ministries = [], api, locale, onApplied, notify }) {
  const fromProjectWorkspace = !!initialProjectId;
  const [ministryId, setMinistryId] = useState('');
  const [targetProjectId, setTargetProjectId] = useState('');
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState('');

  const targetProject = useMemo(
    () => projects.find(p => p._id === targetProjectId) || null,
    [projects, targetProjectId],
  );
  const ministryProjects = useMemo(
    () => (ministryId ? projects.filter(p => p.ministry_id === ministryId) : []),
    [projects, ministryId],
  );
  const ministryName = useMemo(
    () => ministries.find(ministry => ministry._id === ministryId)?.name || '',
    [ministries, ministryId],
  );
  const budget = useMemo(() => projectBudgetSummary(targetProject), [targetProject]);
  const scopeReady = fromProjectWorkspace
    ? !!targetProjectId && !!ministryId && !!targetProject
    : !!ministryId;

  useEffect(() => {
    if (!open) {
      setNotes('');
      setPreview(null);
      setError('');
      setLoading(false);
      setApplying(false);
      setReviewOpen(false);
      setMinistryId('');
      setTargetProjectId('');
      return;
    }
    if (initialProjectId) {
      const seed = projects.find(p => p._id === initialProjectId) || null;
      setMinistryId(seed?.ministry_id || '');
      setTargetProjectId(initialProjectId);
      return;
    }
    setMinistryId('');
    setTargetProjectId('');
  }, [open, initialProjectId, projects]);

  if (!open) return null;

  const matchWigs = (preview?.proposed_wigs || []).filter(item => item.match_existing_wig_id);
  const newWigs = (preview?.proposed_wigs || []).filter(item => !item.match_existing_wig_id);
  const matchMeasures = (preview?.proposed_measures || []).filter(item => item.match_existing_measure_id);
  const newMeasures = (preview?.proposed_measures || []).filter(item => !item.match_existing_measure_id);
  const actions = preview?.proposed_actions || [];
  const catalog = preview?.catalog || { wigs: [] };
  const hasPreview = matchWigs.length + newWigs.length + matchMeasures.length + newMeasures.length + actions.length > 0;
  const selectedCount = [
    ...(preview?.proposed_wigs || []),
    ...(preview?.proposed_measures || []),
    ...(preview?.proposed_actions || []),
  ].filter(item => item.selected !== false).length;

  function resolveItemProject(item, fallbackProjectId = fromProjectWorkspace ? targetProjectId : '') {
    return item?.project_id || fallbackProjectId || '';
  }

  function selectedItemsMissingProject() {
    if (fromProjectWorkspace) return false;
    const items = [
      ...(preview?.proposed_wigs || []),
      ...(preview?.proposed_measures || []),
      ...(preview?.proposed_actions || []),
    ].filter(item => item.selected !== false);
    return items.some(item => !resolveItemProject(item));
  }

  function itemProjectBudget(projectId) {
    return projectBudgetSummary(mtaProjectFromList(projects, projectId));
  }

  function patchActionProjectAssociation(projectId) {
    return {
      project_id: projectId || null,
      target_wig_id: null,
      proposed_wig_ref: null,
      create_new_wig: false,
      target_measure_id: null,
      proposed_measure_ref: null,
      create_new_measure: false,
      wig_only: false,
    };
  }

  function otherProposedWigBudget(excludeItem) {
    return (preview?.proposed_wigs || [])
      .filter(w => w !== excludeItem && !w.match_existing_wig_id)
      .reduce((sum, w) => sum + (Number(w.budget_allocated) || 0), 0);
  }

  function otherProposedMeasureBudget(excludeItem, parentWigBudget = 0) {
    return (preview?.proposed_measures || [])
      .filter(m => m !== excludeItem && !m.match_existing_measure_id)
      .reduce((sum, m) => sum + (Number(m.budget_allocated) || 0), 0);
  }

  function patchPreview(kind, index, patch) {
    setPreview(prev => {
      const key = kind === 'wig' ? 'proposed_wigs' : kind === 'measure' ? 'proposed_measures' : 'proposed_actions';
      const list = [...(prev?.[key] || [])];
      list[index] = { ...list[index], ...patch };
      return { ...prev, [key]: list };
    });
  }

  function removePreviewItem(kind, index) {
    setPreview(prev => {
      const key = kind === 'wig' ? 'proposed_wigs' : kind === 'measure' ? 'proposed_measures' : 'proposed_actions';
      const list = [...(prev?.[key] || [])];
      list.splice(index, 1);
      return { ...prev, [key]: list };
    });
  }

  function findIndex(kind, item) {
    const key = kind === 'wig' ? 'proposed_wigs' : kind === 'measure' ? 'proposed_measures' : 'proposed_actions';
    return (preview?.[key] || []).indexOf(item);
  }

  async function analyzeNotes() {
    const text = notes.trim();
    if (!scopeReady) {
      setError(t('meetingToActionScopeRequired', locale));
      return;
    }
    if (!text) {
      setError(t('meetingToActionNotesRequired', locale));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = fromProjectWorkspace
        ? await api(`/api/projects/${targetProjectId}/meeting-to-action/parse`, {
          method: 'POST',
          body: JSON.stringify({ notes: text, ministry_id: ministryId }),
        })
        : await api(`/api/ministries/${ministryId}/meeting-to-action/parse`, {
          method: 'POST',
          body: JSON.stringify({ notes: text, ministry_id: ministryId }),
        });
      const normalized = normalizeMeetingPreview(data);
      if (fromProjectWorkspace) {
        normalized.proposed_wigs = (normalized.proposed_wigs || []).map(item => ({ ...item, project_id: targetProjectId }));
        normalized.proposed_measures = (normalized.proposed_measures || []).map(item => ({ ...item, project_id: targetProjectId }));
        normalized.proposed_actions = (normalized.proposed_actions || []).map(item => ({ ...item, project_id: targetProjectId }));
      }
      setPreview(normalized);
    } catch (err) {
      setError(err.message || 'Failed to analyze notes');
    } finally {
      setLoading(false);
    }
  }

  function openReview() {
    if (!preview || selectedCount === 0 || !scopeReady) return;
    if (selectedItemsMissingProject()) {
      setError(t('meetingToActionProjectRequired', locale));
      return;
    }
    setError('');
    setReviewOpen(true);
  }

  function backToEditing() {
    setReviewOpen(false);
    setError('');
  }

  async function approveAndApply() {
    if (!preview || selectedCount === 0 || !scopeReady) return;
    if (selectedItemsMissingProject()) {
      setError(t('meetingToActionProjectRequired', locale));
      setReviewOpen(false);
      return;
    }
    setApplying(true);
    setError('');
    try {
      const payload = {
        ministry_id: ministryId,
        proposed_wigs: preview.proposed_wigs || [],
        proposed_measures: preview.proposed_measures || [],
        proposed_actions: preview.proposed_actions || [],
      };
      const result = fromProjectWorkspace
        ? await api(`/api/projects/${targetProjectId}/meeting-to-action/apply`, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        : await api(`/api/ministries/${ministryId}/meeting-to-action/apply`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      notify(t('meetingToActionSuccess', locale), 'success');
      const appliedProjectId = fromProjectWorkspace
        ? targetProjectId
        : (preview.proposed_wigs || []).find(item => item.selected !== false && item.project_id)?.project_id
          || (preview.proposed_measures || []).find(item => item.selected !== false && item.project_id)?.project_id
          || (preview.proposed_actions || []).find(item => item.selected !== false && item.project_id)?.project_id
          || null;
      onApplied?.(result.project, appliedProjectId);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to apply meeting actions');
    } finally {
      setApplying(false);
    }
  }

  function renderWigCard(item, index, matched = false) {
    const itemProjectId = resolveItemProject(item);
    const itemProject = mtaProjectFromList(projects, itemProjectId) || targetProject;
    const itemCatalog = mtaProjectCatalog(catalog, itemProjectId);
    const existingWigBudget = (itemCatalog?.wigs || []).reduce((sum, w) => sum + (Number(w.budget_allocated) || 0), 0);
    const otherWigBudget = existingWigBudget + otherProposedWigBudget(item);
    const itemBudget = itemProjectBudget(itemProjectId);
    return (
      <article className="mta-card card" key={`wig-${index}-${item.title}`}>
        <div className="mta-card-head">
          <span className={`mta-type-badge ${matched ? 'match' : 'new'}`}>{matched ? t('meetingToActionMatch', locale) : t('meetingToActionGroupNewWig', locale)}</span>
          <span className="mta-confidence">{t('meetingToActionConfidence', locale)} {formatConfidence(item.confidence)}</span>
          <label className="mta-select">
            <input type="checkbox" checked={item.selected !== false} onChange={e => patchPreview('wig', index, { selected: e.target.checked })} />
          </label>
          <button type="button" className="icon-btn danger" title={t('meetingToActionRemove', locale)} onClick={() => removePreviewItem('wig', index)}><X size={14} /></button>
        </div>
        {!fromProjectWorkspace && (
          <label className="field">
            <span>{t('meetingToActionAssociateProject', locale)}</span>
            <select
              data-testid="mta-action-project-select"
              value={itemProjectId}
              onChange={e => patchPreview('wig', index, { project_id: e.target.value || null })}
            >
              <option value="">{t('meetingToActionSelectProject', locale)}</option>
              {ministryProjects.map(project => <option key={project._id} value={project._id}>{project.name}</option>)}
            </select>
          </label>
        )}
        {matched ? (
          <>
            <label className="field"><span>Title</span><input value={item.title || ''} onChange={e => patchPreview('wig', index, { title: e.target.value })} /></label>
            <div className="mta-grid">
              <label className="field"><span>Current state</span><input value={item.current_state || ''} onChange={e => patchPreview('wig', index, { current_state: e.target.value })} /></label>
              <label className="field"><span>Target state</span><input value={item.target_state || ''} onChange={e => patchPreview('wig', index, { target_state: e.target.value })} /></label>
              <label className="field"><span>Deadline</span><input type="date" value={item.deadline || ''} onChange={e => patchPreview('wig', index, { deadline: e.target.value })} /></label>
              <label className="field"><span>Owner</span><input value={item.owner || ''} onChange={e => patchPreview('wig', index, { owner: e.target.value })} /></label>
            </div>
          </>
        ) : (
          <WigFormFields
            draft={mtaWigDraftFromItem(item)}
            setDraft={patch => patchPreview('wig', index, patch)}
            inheritPriority={itemProject?.priority ?? 5}
            projectBudget={itemBudget.total}
            otherWigBudget={otherWigBudget}
            projectDeadline={itemProject?.due_date || ''}
          />
        )}
        {item.reasoning && <p className="mta-reasoning">{item.reasoning}</p>}
      </article>
    );
  }

  function renderMeasureCard(item, index, matched = false) {
    const itemProjectId = resolveItemProject(item);
    const itemProject = mtaProjectFromList(projects, itemProjectId) || targetProject;
    const itemCatalog = mtaProjectCatalog(catalog, itemProjectId);
    const parentWigOptions = buildWigOptions(itemCatalog, preview?.proposed_wigs || [], locale, itemProjectId);
    const parentWig = item.wig_id
      ? (itemCatalog?.wigs || []).find(w => w.id === item.wig_id)
      : (item.proposed_wig_ref
        ? (preview?.proposed_wigs || []).find(w => w.proposed_ref === item.proposed_wig_ref)
        : null);
    const wigBudgetTotal = Number(parentWig?.budget_allocated) || 0;
    const otherMeasureBudget = otherProposedMeasureBudget(item);
    const itemBudget = itemProjectBudget(itemProjectId);
    return (
      <article className="mta-card card" key={`measure-${index}-${item.title}`}>
        <div className="mta-card-head">
          <span className={`mta-type-badge ${matched ? 'match' : 'new'}`}>{matched ? t('meetingToActionMatch', locale) : t('meetingToActionGroupNewMeasure', locale)}</span>
          <span className="mta-confidence">{t('meetingToActionConfidence', locale)} {formatConfidence(item.confidence)}</span>
          <label className="mta-select">
            <input type="checkbox" checked={item.selected !== false} onChange={e => patchPreview('measure', index, { selected: e.target.checked })} />
          </label>
          <button type="button" className="icon-btn danger" title={t('meetingToActionRemove', locale)} onClick={() => removePreviewItem('measure', index)}><X size={14} /></button>
        </div>
        {!fromProjectWorkspace && (
          <label className="field">
            <span>{t('meetingToActionAssociateProject', locale)}</span>
            <select
              data-testid="mta-action-project-select"
              value={itemProjectId}
              onChange={e => patchPreview('measure', index, { project_id: e.target.value || null })}
            >
              <option value="">{t('meetingToActionSelectProject', locale)}</option>
              {ministryProjects.map(project => <option key={project._id} value={project._id}>{project.name}</option>)}
            </select>
          </label>
        )}
        {!matched && (
          <label className="field">
            <span>{t('meetingToActionParentWig', locale)}</span>
            <select
              value={measureParentWigValue(item)}
              onChange={e => patchPreview('measure', index, patchMeasureParentWig(e.target.value))}
            >
              <option value="">Select WIG…</option>
              {parentWigOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </label>
        )}
        {matched ? (
          <>
            <label className="field"><span>Title</span><input value={item.title || ''} onChange={e => patchPreview('measure', index, { title: e.target.value })} /></label>
            <div className="mta-grid">
              <label className="field"><span>Current state</span><input value={item.current_state || ''} onChange={e => patchPreview('measure', index, { current_state: e.target.value })} /></label>
              <label className="field"><span>Target state</span><input value={item.target_state || ''} onChange={e => patchPreview('measure', index, { target_state: e.target.value })} /></label>
              <label className="field"><span>Deadline</span><input type="date" value={item.deadline || ''} onChange={e => patchPreview('measure', index, { deadline: e.target.value })} /></label>
              <label className="field"><span>Assigned to</span><input value={(item.assigned_to || []).join(', ')} onChange={e => patchPreview('measure', index, { assigned_to: e.target.value.split(',').map(v => v.trim()).filter(Boolean) })} /></label>
            </div>
          </>
        ) : (
          <MeasureFormFields
            draft={mtaMeasureDraftFromItem(item)}
            setDraft={patch => {
              const next = { ...patch };
              if (Object.prototype.hasOwnProperty.call(next, 'assigned_to')) {
                next.assigned_to = String(next.assigned_to || '').split(',').map(v => v.trim()).filter(Boolean);
              }
              patchPreview('measure', index, next);
            }}
            inheritPriority={parentWig?.priority ?? itemProject?.priority ?? 5}
            wigBudget={wigBudgetTotal}
            otherMeasureBudget={otherMeasureBudget}
            projectDeadline={itemProject?.due_date || ''}
            wigDeadline={parentWig?.deadline || ''}
          />
        )}
        {item.reasoning && <p className="mta-reasoning">{item.reasoning}</p>}
      </article>
    );
  }

  function renderActionCard(item, index) {
    const itemProjectId = resolveItemProject(item);
    const itemProject = mtaProjectFromList(projects, itemProjectId) || targetProject;
    const itemCatalog = mtaProjectCatalog(catalog, itemProjectId);
    const itemBudget = itemProjectBudget(itemProjectId);
    const wigKey = actionWigSelectValue(item);
    const wigOptions = buildWigOptions(itemCatalog, preview?.proposed_wigs || [], locale, itemProjectId);
    const measureOptions = buildMeasureOptions(wigKey, itemCatalog, preview?.proposed_measures || [], locale, itemProjectId);
    const inlineWigBudget = Number(item.new_wig_budget_allocated) || 0;
    return (
      <article className="mta-card card" key={`action-${index}-${item.comment?.slice(0, 24)}`}>
        <div className="mta-card-head">
          <span className="mta-type-badge action">{t('meetingToActionGroupActions', locale)}</span>
          <span className="mta-confidence">{t('meetingToActionConfidence', locale)} {formatConfidence(item.confidence)}</span>
          <label className="mta-select">
            <input type="checkbox" checked={item.selected !== false} onChange={e => patchPreview('action', index, { selected: e.target.checked })} />
          </label>
          <button type="button" className="icon-btn danger" title={t('meetingToActionRemove', locale)} onClick={() => removePreviewItem('action', index)}><X size={14} /></button>
        </div>
        <div className="mta-grid mta-assoc-grid">
          {!fromProjectWorkspace && (
            <label className="field">
              <span>{t('meetingToActionAssociateProject', locale)}</span>
              <select
                data-testid="mta-action-project-select"
                value={itemProjectId}
                onChange={e => patchPreview('action', index, patchActionProjectAssociation(e.target.value))}
              >
                <option value="">{t('meetingToActionSelectProject', locale)}</option>
                {ministryProjects.map(project => <option key={project._id} value={project._id}>{project.name}</option>)}
              </select>
            </label>
          )}
          <label className="field">
            <span>{t('meetingToActionAssociateWig', locale)}</span>
            <select
              value={wigKey}
              disabled={!fromProjectWorkspace && !itemProjectId}
              onChange={e => {
                const patch = patchActionWigAssociation(e.target.value);
                if (e.target.value === MTA_NEW_WIG) {
                  patch.proposed_wig_ref = item.proposed_wig_ref || `inline_wig_${index}`;
                }
                patchPreview('action', index, patch);
              }}
            >
              <option value="">Select WIG…</option>
              {wigOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t('meetingToActionAssociateMeasure', locale)}</span>
            <select
              value={actionMeasureSelectValue(item)}
              disabled={!wigKey}
              onChange={e => {
                const patch = patchActionMeasureAssociation(e.target.value);
                if (e.target.value === MTA_NEW_MEASURE) {
                  patch.proposed_measure_ref = item.proposed_measure_ref || `inline_measure_${index}`;
                  if (item.create_new_wig && !item.proposed_wig_ref) {
                    patch.proposed_wig_ref = `inline_wig_${index}`;
                  }
                }
                patchPreview('action', index, patch);
              }}
            >
              <option value="">Select target…</option>
              {measureOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </label>
        </div>
        {item.create_new_wig && (
          <div className="mta-inline-entity">
            <h4>{t('meetingToActionGroupNewWig', locale)}</h4>
            <WigFormFields
              draft={mtaActionWigDraftFromItem(item)}
              setDraft={patch => patchPreview('action', index, mtaPatchFromDraft(MTA_ACTION_WIG_FIELDS, patch))}
              inheritPriority={itemProject?.priority ?? 5}
              projectBudget={itemBudget.total}
              otherWigBudget={(itemCatalog?.wigs || []).reduce((sum, w) => sum + (Number(w.budget_allocated) || 0), 0)}
              projectDeadline={itemProject?.due_date || ''}
            />
          </div>
        )}
        {item.create_new_measure && (
          <div className="mta-inline-entity">
            <h4>{t('meetingToActionGroupNewMeasure', locale)}</h4>
            <MeasureFormFields
              draft={mtaActionMeasureDraftFromItem(item)}
              setDraft={patch => {
                const mapped = mtaPatchFromDraft(MTA_ACTION_MEASURE_FIELDS, patch);
                if (Object.prototype.hasOwnProperty.call(mapped, 'new_measure_assigned_to')) {
                  mapped.new_measure_assigned_to = String(mapped.new_measure_assigned_to || '').split(',').map(v => v.trim()).filter(Boolean);
                }
                patchPreview('action', index, mapped);
              }}
              inheritPriority={itemProject?.priority ?? 5}
              wigBudget={item.create_new_wig ? inlineWigBudget : 0}
              otherMeasureBudget={0}
              projectDeadline={itemProject?.due_date || ''}
              wigDeadline={item.new_wig_deadline || ''}
            />
          </div>
        )}
        <label className="field"><span>Comment / activity</span><textarea rows={3} value={item.comment || ''} onChange={e => patchPreview('action', index, { comment: e.target.value })} /></label>
        <div className="mta-grid">
          <label className="field"><span>Owner</span><input value={item.owner || ''} onChange={e => patchPreview('action', index, { owner: e.target.value })} /></label>
          <label className="field"><span>Due date</span><input type="date" value={item.due_date || ''} onChange={e => patchPreview('action', index, { due_date: e.target.value })} /></label>
        </div>
        <label className="mta-check field">
          <input type="checkbox" checked={!!item.create_assignment} onChange={e => patchPreview('action', index, { create_assignment: e.target.checked })} />
          <span>{t('meetingToActionAssignment', locale)}</span>
        </label>
      </article>
    );
  }

  function renderReviewPanel() {
    const selectedWigs = (preview?.proposed_wigs || []).filter(item => item.selected !== false);
    const selectedMeasures = (preview?.proposed_measures || []).filter(item => item.selected !== false);
    const selectedActions = (preview?.proposed_actions || []).filter(item => item.selected !== false);

    function reviewProjectLabel(item) {
      if (fromProjectWorkspace) return targetProject?.name || '';
      const projectId = resolveItemProject(item);
      return mtaProjectFromList(projects, projectId)?.name || '';
    }

    function renderReviewList(items, kind) {
      if (!items.length) return null;
      const heading = kind === 'wig'
        ? t('meetingToActionReviewWigs', locale)
        : kind === 'measure'
          ? t('meetingToActionReviewMeasures', locale)
          : t('meetingToActionReviewActions', locale);
      return (
        <section className="mta-review-section">
          <h3>{heading}</h3>
          <ul className="mta-review-list">
            {items.map((item, index) => {
              const matched = kind === 'wig'
                ? !!item.match_existing_wig_id
                : kind === 'measure'
                  ? !!item.match_existing_measure_id
                  : false;
              const badgeLabel = kind === 'action'
                ? t('meetingToActionGroupActions', locale)
                : matched
                  ? t('meetingToActionMatch', locale)
                  : kind === 'wig'
                    ? t('meetingToActionGroupNewWig', locale)
                    : t('meetingToActionGroupNewMeasure', locale);
              const badgeClass = kind === 'action' ? 'action' : matched ? 'match' : 'new';
              const title = kind === 'action' ? (item.comment || '—') : (item.title || '—');
              const metaParts = [];
              const projectLabel = reviewProjectLabel(item);
              if (projectLabel) metaParts.push(projectLabel);
              if (item.owner) metaParts.push(item.owner);
              if (item.due_date) metaParts.push(formatDate(item.due_date, locale));
              if (kind === 'action' && item.create_assignment) metaParts.push(t('meetingToActionAssignment', locale));
              return (
                <li className="mta-review-item" key={`${kind}-${index}-${title.slice(0, 24)}`}>
                  <span className={`mta-type-badge ${badgeClass}`}>{badgeLabel}</span>
                  <div className="mta-review-item-body">
                    <p className="mta-review-item-title">{title}</p>
                    {metaParts.length > 0 && <p className="mta-review-item-meta">{metaParts.join(' · ')}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      );
    }

    return (
      <div className="mta-review" data-testid="mta-review">
        <p className="mta-review-lead">{t('meetingToActionReviewLead', locale)}</p>
        <div className="mta-review-summary">
          {selectedWigs.length > 0 && (
            <div className="mta-review-stat">
              <strong>{selectedWigs.length}</strong>
              <span>{t('meetingToActionReviewWigs', locale)}</span>
            </div>
          )}
          {selectedMeasures.length > 0 && (
            <div className="mta-review-stat">
              <strong>{selectedMeasures.length}</strong>
              <span>{t('meetingToActionReviewMeasures', locale)}</span>
            </div>
          )}
          {selectedActions.length > 0 && (
            <div className="mta-review-stat">
              <strong>{selectedActions.length}</strong>
              <span>{t('meetingToActionReviewActions', locale)}</span>
            </div>
          )}
        </div>
        {renderReviewList(selectedWigs, 'wig')}
        {renderReviewList(selectedMeasures, 'measure')}
        {renderReviewList(selectedActions, 'action')}
        {error && <p className="ai-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="modal-backdrop mta-modal-backdrop" onMouseDown={onClose}>
      <motion.div
        className="modal-panel mta-modal"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="mta-modal-head">
          <div>
            <span className="pw-kicker"><ClipboardList size={14} /> {t('meetingToActionTitle', locale)}</span>
            <h2>
              {reviewOpen
                ? t('meetingToActionReviewTitle', locale)
                : fromProjectWorkspace
                  ? (targetProject?.name || t('meetingToActionTitle', locale))
                  : (ministryName || t('meetingToActionTitle', locale))}
            </h2>
            <p>
              {reviewOpen
                ? t('meetingToActionReviewSubtitle', locale)
                : t('meetingToActionSubtitle', locale)}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mta-modal-body">
          {reviewOpen ? renderReviewPanel() : (
            <>
          {fromProjectWorkspace ? (
            targetProject ? (
              <div className="mta-scope-context" data-testid="mta-scope-context">
                <span className="mta-scope-context-label">{targetProject.name}</span>
                {ministryName && (
                  <>
                    <span className="mta-scope-context-sep" aria-hidden="true">·</span>
                    <span className="mta-scope-context-ministry">{ministryName}</span>
                  </>
                )}
              </div>
            ) : (
              <p className="mta-scope-hint">{t('meetingToActionScopeRequired', locale)}</p>
            )
          ) : (
            <>
              <label className="field">
                <span>{t('meetingToActionMinistry', locale)}</span>
                <select
                  data-testid="mta-ministry-select"
                  value={ministryId}
                  onChange={e => {
                    setMinistryId(e.target.value);
                    setTargetProjectId('');
                    setPreview(null);
                  }}
                  required
                >
                  <option value="">{t('meetingToActionSelectMinistry', locale)}</option>
                  {ministries.map(ministry => <option key={ministry._id} value={ministry._id}>{ministry.name}</option>)}
                </select>
              </label>
              {!scopeReady && <p className="mta-scope-hint">{t('meetingToActionScopeHint', locale)}</p>}
            </>
          )}
          <label className="field mta-notes">
            <span>{t('meetingToActionNotes', locale)}</span>
            <textarea
              rows={8}
              value={notes}
              disabled={!scopeReady}
              placeholder={t('meetingToActionNotesPlaceholder', locale)}
              onChange={e => setNotes(e.target.value)}
            />
          </label>
          <div className="mta-toolbar">
            <button type="button" className="primary-btn" disabled={loading || applying || !scopeReady || !notes.trim()} onClick={analyzeNotes}>
              {loading ? <><Loader2 size={15} className="spin" /> {t('aiInsightGenerating', locale)}</> : <><Sparkles size={15} /> {t('meetingToActionAnalyze', locale)}</>}
            </button>
            {preview?.llm_status && <LlmStatusBadge status={preview.llm_status} locale={locale} feature="meeting" />}
          </div>
          {error && <p className="ai-error">{error}</p>}
          {preview && !hasPreview && !loading && <p className="empty-state">{t('meetingToActionEmpty', locale)}</p>}
          {hasPreview && (
            <div className="mta-preview">
              {matchWigs.length > 0 && (
                <section>
                  <h3>{t('meetingToActionGroupMatch', locale)} · WIGs</h3>
                  {matchWigs.map(item => renderWigCard(item, findIndex('wig', item), true))}
                </section>
              )}
              {newWigs.length > 0 && (
                <section>
                  <h3>{t('meetingToActionGroupNewWig', locale)}</h3>
                  {newWigs.map(item => renderWigCard(item, findIndex('wig', item), false))}
                </section>
              )}
              {matchMeasures.length > 0 && (
                <section>
                  <h3>{t('meetingToActionGroupMatch', locale)} · Measures</h3>
                  {matchMeasures.map(item => renderMeasureCard(item, findIndex('measure', item), true))}
                </section>
              )}
              {newMeasures.length > 0 && (
                <section>
                  <h3>{t('meetingToActionGroupNewMeasure', locale)}</h3>
                  {newMeasures.map(item => renderMeasureCard(item, findIndex('measure', item), false))}
                </section>
              )}
              {actions.length > 0 && (
                <section>
                  <h3>{t('meetingToActionGroupActions', locale)}</h3>
                  {actions.map(item => renderActionCard(item, findIndex('action', item)))}
                </section>
              )}
            </div>
          )}
            </>
          )}
        </div>
        {hasPreview && (
          <div className="mta-modal-foot">
            {reviewOpen ? (
              <>
                <button type="button" className="ghost-btn" data-testid="mta-review-back" disabled={applying} onClick={backToEditing}>
                  <ArrowLeft size={15} /> {t('meetingToActionReviewBack', locale)}
                </button>
                <button type="button" className="primary-btn" data-testid="mta-review-approve" disabled={applying} onClick={approveAndApply}>
                  {applying ? <><Loader2 size={15} className="spin" /> {t('meetingToActionApplying', locale)}</> : <><CheckCircle2 size={15} /> {t('meetingToActionReviewApprove', locale)}</>}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="ghost-btn" onClick={onClose}>Cancel</button>
                <button type="button" className="primary-btn" data-testid="mta-apply-btn" disabled={selectedCount === 0 || selectedItemsMissingProject()} onClick={openReview}>
                  <Check size={15} /> {t('meetingToActionApply', locale)} ({selectedCount})
                </button>
              </>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

function EntityModal({ title, subtitle, onClose, onSubmit, submitLabel, busy = false, children }) {
  return (
    <div className="modal-backdrop entity-modal-backdrop" onMouseDown={onClose}>
      <motion.div
        className="modal-panel entity-modal"
        initial={{ opacity: 0, y: 28, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="entity-modal-head">
          <div>
            <span className="pw-kicker">{subtitle}</span>
            <h2>{title}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <form className="entity-modal-form" onSubmit={onSubmit}>
          <div className="entity-modal-body">{children}</div>
          <div className="entity-modal-foot">
            <button type="button" className="ghost-btn" onClick={onClose}>Cancel</button>
            <button className="primary-btn" disabled={busy}>{submitLabel}</button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function FormSection({ title, hint, children }) {
  return (
    <section className="form-section">
      <div className="form-section-head">
        <h3>{title}</h3>
        {hint && <p>{hint}</p>}
      </div>
      <div className="form-section-body">{children}</div>
    </section>
  );
}

function BudgetBar({ label, allocated, total, spent, warn }) {
  const pct = total > 0 ? Math.min(100, Math.round((allocated / total) * 100)) : 0;
  const tone = warn ? 'warn' : pct >= 90 ? 'amber' : 'ok';
  return (
    <div className={`budget-bar ${tone}`}>
      <div className="budget-bar-head">
        <span>{label}</span>
        <strong>{formatBudgetCr(allocated)} of {formatBudgetCr(total)} allocated</strong>
      </div>
      <div className="budget-bar-track"><em style={{ width: `${pct}%` }} /></div>
      <div className="budget-bar-meta">
        {spent != null && <small>Spent {formatBudgetCr(spent)}</small>}
        {warn && <small className="budget-warn">Over budget — adjust allocations</small>}
        {!warn && total > 0 && <small>{formatBudgetCr(Math.max(0, total - allocated))} remaining</small>}
      </div>
    </div>
  );
}

function FieldHint({ error }) {
  if (!error) return null;
  return <small className="field-error">{error}</small>;
}

const HEATMAP_KPIS = [
  ['schedule', 'Sched'],
  ['budget', 'Budget'],
  ['quality', 'Quality'],
  ['cadence', 'Cadence'],
  ['lead_measures', 'Lead'],
  ['compliance', 'Compl'],
];

function heatColor(value) {
  if (value == null) return { background: 'var(--surface-sunken)', color: 'var(--text-muted)' };
  if (value >= 80) return { background: '#d3f3e2', color: '#067647' };
  if (value >= 65) return { background: '#e8f8f0', color: '#0a8754' };
  if (value >= 50) return { background: '#fdf3e2', color: '#93500b' };
  return { background: '#fdeeec', color: '#b42318' };
}

function CommandCenter({ overview, loading, locale, onNavigate, onExport }) {
  if (loading && !overview) return <OverviewSkeleton />;
  const stats = overview?.stats || { total: 0, on_track: 0, at_risk: 0, off_track: 0, health_score: 0 };
  const projects = overview?.projects || [];
  const attention = projects.filter(p => p.status !== 'On Track');
  const evidenceGaps = projects.reduce((sum, project) => sum + Math.max(0, countMeasures(project) - (project.evidence_count || 0)), 0);
  const trend = overview?.health_trend?.length ? overview.health_trend : [
    { name: 'W2', on_track: Math.max(0, stats.on_track - 3), at_risk: Math.max(0, stats.at_risk - 1), off_track: Math.max(0, stats.off_track - 1) },
    { name: 'W3', on_track: Math.max(0, stats.on_track - 2), at_risk: stats.at_risk, off_track: stats.off_track },
    { name: 'W4', on_track: Math.max(0, stats.on_track - 1), at_risk: stats.at_risk, off_track: stats.off_track },
    { name: 'Now', on_track: stats.on_track, at_risk: stats.at_risk, off_track: stats.off_track },
  ];

  return (
    <section className="gov-overview">
      <div className="gov-kpi-grid">
        <OverviewKpi icon={ClipboardList} label="Total Projects" value={stats.total} sub="Across all ministries" action="View all projects" onClick={() => onNavigate('projects')} />
        <OverviewKpi icon={CheckCircle2} label="On Track" value={stats.on_track} sub={`${percent(stats.on_track, stats.total)}% of total`} tone="green" />
        <OverviewKpi icon={AlertTriangle} label="At Risk" value={stats.at_risk} sub={`${percent(stats.at_risk, stats.total)}% of total`} tone="amber" />
        <OverviewKpi icon={X} label="Off Track" value={stats.off_track} sub={`${percent(stats.off_track, stats.total)}% of total`} tone="red" />
        <OverviewKpi icon={FileText} label="Pending Approvals" value={overview?.pending_approvals || 0} sub="Need action" tone="violet" />
        <OverviewKpi icon={Archive} label="Evidence Gaps" value={evidenceGaps} sub="Require uploads" tone="blue" />
      </div>

      <div className="gov-overview-main">
        <div className="card gov-attention">
          <h3><Bell size={17} /> Immediate Attention</h3>
          <div className="attention-table">
            {attention.slice(0, 5).map((p, index) => (
              <button key={p._id} type="button" onClick={() => onNavigate('projects', p._id)}>
                <span><strong>{p.name}</strong><small>{p.ministry}</small></span>
                <em className={`status-badge ${p.status === 'At Risk' ? 'at-risk' : 'off-track'}`}>{p.status}</em>
                <small>{index + 1} day{index ? 's' : ''}</small>
              </button>
            ))}
            {attention.length === 0 && <p className="ops-empty">All tracked projects are on track.</p>}
          </div>
        </div>

        <div className="card gov-trend">
          <h3><ClipboardList size={17} /> Portfolio Health Trend</h3>
          <div className="trend-wrap">
            <ResponsiveContainer width="100%" height={185}>
              <AreaChart data={trend}>
                <CartesianGrid stroke="#edf2fb" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #dbe5f3', fontSize: 12 }} />
                <Area type="monotone" dataKey="on_track" stroke="#2563eb" fill="#dbeafe" strokeWidth={2.5} />
                <Area type="monotone" dataKey="at_risk" stroke="#f97316" fill="#ffedd5" strokeWidth={2.5} />
                <Area type="monotone" dataKey="off_track" stroke="#ef4444" fill="#fee2e2" strokeWidth={2.5} />
              </AreaChart>
            </ResponsiveContainer>
            <aside>
              <h4>Current (this week)</h4>
              <p><span className="legend-dot blue" /> On Track <b>{stats.on_track} ({percent(stats.on_track, stats.total)}%)</b></p>
              <p><span className="legend-dot orange" /> At Risk <b>{stats.at_risk} ({percent(stats.at_risk, stats.total)}%)</b></p>
              <p><span className="legend-dot red" /> Off Track <b>{stats.off_track} ({percent(stats.off_track, stats.total)}%)</b></p>
              <hr />
              <p>Total Projects <b>{stats.total}</b></p>
            </aside>
          </div>
        </div>
      </div>

      <div className="gov-insight-grid">
        <InsightCard title="What Is Working" icon={TrendingUp} tone="blue" items={overview?.what_is_working || []} />
        <InsightCard title="What Is Not Working" icon={TrendingDown} tone="red" items={overview?.what_is_not_working || []} />
        <Bottlenecks bottlenecks={overview?.bottlenecks || []} title="Top Bottlenecks" />
      </div>

      <div className="card ai-decision-strip">
        <div>
          <Brain size={30} />
          <div>
            <h3>AI Decision Recommendation <span>Beta</span></h3>
            <p>Intervene in the highest-risk approvals, evidence gaps, and blocked lead measures.</p>
          </div>
        </div>
        <button className="primary-btn" onClick={() => onNavigate('decisions')}>Open Decision Brief <ChevronRight size={15} /></button>
      </div>
      {loading && <div className="loading">{t('refreshing', locale)}</div>}
    </section>
  );
}

function OverviewKpi({ icon: Icon, label, value, sub, tone = 'blue', action, onClick }) {
  return (
    <div className={`card overview-kpi ${tone}`}>
      <div className="overview-kpi-icon"><Icon size={25} /></div>
      <div>
        <span>{label}</span>
        <strong><AnimatedNumber value={value} /></strong>
        <small>{sub}</small>
        {action && <button type="button" onClick={onClick}>{action} <ChevronRight size={13} /></button>}
      </div>
      <MiniSpark tone={tone} />
    </div>
  );
}

function MiniSpark({ tone = 'blue' }) {
  const stroke = tone === 'red' ? '#ef4444' : tone === 'amber' ? '#f97316' : tone === 'green' ? '#16a34a' : '#2563eb';
  return (
    <svg className="mini-spark" viewBox="0 0 76 28" aria-hidden="true">
      <polyline fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points="2,20 14,15 24,18 34,10 45,17 58,12 72,15" />
    </svg>
  );
}

function Metric({ icon: Icon, label, value, sub, tone = 'navy' }) {
  return (
    <div className={`metric ${tone}`}>
      <Icon size={26} />
      <span>{label}</span>
      <strong><AnimatedNumber value={value} /></strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function InsightCard({ title, icon: Icon, items, tone }) {
  return (
    <div className={`card insight ${tone}`}>
      <h3><Icon size={18} /> {title}</h3>
      {(items.length ? items : ['Data will appear as projects are tracked.']).map(item => <p key={item}><Check size={15} /> {item}</p>)}
    </div>
  );
}

function Bottlenecks({ bottlenecks, title = 'Top Bottlenecks' }) {
  return (
    <div className="card">
      <h3><Activity size={18} /> {title}</h3>
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

function Projects({ projects, allProjects = projects, ministries, permissions, session, api, reload, onOpen, onOpenMeetingToAction, locale }) {
  const [workflowBuilderOpen, setWorkflowBuilderOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [ministryFilter, setMinistryFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [healthFilter, setHealthFilter] = useState('');
  const canCreateProject = permissions?.can_create_project || isGlobalAdminUser(session?.user) || session?.user?.role === 'ministry_admin' || allProjects.some(project => project.permissions?.can_create_project);
  const filteredProjects = useMemo(() => {
    const text = query.trim().toLowerCase();
    return allProjects.filter(project => {
      if (ministryFilter && project.ministry_id !== ministryFilter) return false;
      if (projectFilter && project._id !== projectFilter) return false;
      if (healthFilter && project.status !== healthFilter) return false;
      const wigText = (project.wigs || []).map(wig => `${wig.title} ${(wig.lead_measures || []).map(measure => measure.title).join(' ')}`).join(' ');
      if (!text) return true;
      return [
        project.name,
        project.ministry,
        project.owner,
        project.status,
        wigText
      ].join(' ').toLowerCase().includes(text);
    });
  }, [allProjects, ministryFilter, projectFilter, healthFilter, query]);

  const sortedProjects = useMemo(() => {
    const list = [...filteredProjects];
    list.sort((a, b) => ((b.priority ?? 5) - (a.priority ?? 5)) || ((a.health_score ?? 0) - (b.health_score ?? 0)));
    return list;
  }, [filteredProjects]);

  if (workflowBuilderOpen) {
    return (
      <ProjectSetupWizard
        ministries={ministries}
        api={api}
        reload={reload}
        onClose={() => setWorkflowBuilderOpen(false)}
      />
    );
  }

  return (
    <section className="projects-page">
      <div className="page-breadcrumbs">
        <button type="button">Home</button>
        <ChevronRight size={13} />
        <span>Projects</span>
      </div>
      <div className="projects-page-head">
        <div>
          <h2>Projects</h2>
          <span>Portfolio view of all projects and their execution health.</span>
        </div>
        {canCreateProject ? (
          <button className="primary-btn" onClick={() => setWorkflowBuilderOpen(true)}><Plus size={15} /> Create 4DX Workflow</button>
        ) : (
          <span className="read-only-note"><LockKeyhole size={14} /> Read-only portfolio view</span>
        )}
      </div>

      <div className="projects-filter-card card">
        <label>
          <span>Ministry</span>
          <select value={ministryFilter} onChange={e => { setMinistryFilter(e.target.value); setProjectFilter(''); }}>
            <option value="">All Ministries</option>
            {ministries.map(ministry => <option key={ministry._id} value={ministry._id}>{ministry.name}</option>)}
          </select>
        </label>
        <label>
          <span>Project</span>
          <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
            <option value="">All Projects</option>
            {allProjects.filter(project => !ministryFilter || project.ministry_id === ministryFilter).map(project => <option key={project._id} value={project._id}>{project.name}</option>)}
          </select>
        </label>
        <label>
          <span>WIG Health</span>
          <select value={healthFilter} onChange={e => setHealthFilter(e.target.value)}>
            <option value="">All</option>
            <option>On Track</option>
            <option>At Risk</option>
            <option>Off Track</option>
          </select>
        </label>
        <label className="projects-search">
          <Search size={16} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search projects..." />
        </label>
      </div>

      <div className="projects-table-card card">
        <table className="projects-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Execution</th>
              <th>Owner</th>
              <th>Current State</th>
              <th>Target State</th>
              <th>Deadline</th>
              <th>Health</th>
              <th>WIGs</th>
              <th>Lead Measures</th>
              <th>Evidence</th>
              <th>Access</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sortedProjects.slice(0, 10).map(project => <PortfolioCard key={project._id} project={project} onOpen={() => onOpen(project._id)} />)}
          </tbody>
        </table>
        {sortedProjects.length === 0 && <p className="empty-state">No projects match this search.</p>}
        <div className="projects-table-footer">
          <span>Showing 1 to {Math.min(10, sortedProjects.length)} of {sortedProjects.length} projects</span>
          <div><button className="icon-btn"><ArrowLeft size={14} /></button><button className="active-page">1</button><button>2</button><button>3</button><button className="icon-btn"><ChevronRight size={14} /></button></div>
          <span>Show <b>10</b> per page</span>
        </div>
      </div>
    </section>
  );
}

function PortfolioCard({ project, onOpen }) {
  const health = project.health_score ?? 0;
  const wigs = (project.wigs || []).filter(wig => !wig.archived_at);
  const measures = countMeasures(project);
  const statusClass = project.status === 'On Track' ? 'on-track' : project.status === 'At Risk' ? 'at-risk' : 'off-track';
  const milestones = project.milestones?.length ? project.milestones : [
    { name: 'WIG', progress: project.kpis?.schedule || health },
    { name: 'Lead Measures', progress: project.kpis?.lead_measures || health },
    { name: 'Scoreboard', progress: project.kpis?.document_confidence || health },
    { name: 'Cadence', progress: project.kpis?.cadence || health },
    { name: 'Outcome', progress: project.kpis?.citizen_impact || health },
  ];
  const canEdit = project.permissions?.can_edit;
  return (
    <tr>
      <td>
        <button className="project-cell" onClick={onOpen}>
          <div className="project-avatar">{(project.name || 'P').slice(0, 1)}</div>
          <span><strong>{project.name}</strong><small>{project.ministry}</small></span>
        </button>
      </td>
      <td>
        <div className="project-row-progress compact">
        {milestones.slice(0, 5).map(item => (
          <div className="project-progress-line" key={item.name}>
            <span>{item.name}</span>
            <div><em style={{ width: `${Math.max(0, Math.min(100, Number(item.progress) || 0))}%`, background: scoreColor(item.progress || 0) }} /></div>
          </div>
        ))}
      </div>
      </td>
      <td><strong>{project.owner || 'Mission Director'}</strong><small>{project.ministry}</small></td>
      <td><strong>{health}%</strong><small>{currentStateText(project)}</small></td>
      <td><strong>{targetStateText(project)}</strong><small>by {deadlineText(project)}</small></td>
      <td><strong>{deadlineText(project)}</strong><small>{daysUntil(project.due_date || project.deadline)}</small></td>
      <td><span className={`status-badge ${statusClass}`}>{project.status}</span><strong>{health}%</strong></td>
      <td>{wigs.length}</td>
      <td>{measures}</td>
      <td>{project.evidence_count || 0}</td>
      <td><span className={`access-pill ${canEdit ? 'edit' : 'read'}`}>{canEdit ? 'Editable' : 'Read Only'}</span><small>{canEdit ? project.ministry : 'All Ministries'}</small></td>
      <td><button className="ghost-btn" onClick={onOpen}>Open</button></td>
    </tr>
  );
}

function WizardHierarchyStepper({ step, hasProject, wigsCount, onStep }) {
  const stepIndex = step === 'project' ? 0 : step === 'wigs' ? 1 : 2;
  const segments = [
    { key: 'project', label: 'Project', icon: ClipboardList, target: 'project', enabled: true },
    { key: 'wigs', label: 'WIGs', icon: Target, target: 'wigs', enabled: hasProject },
    { key: 'measures', label: 'Lead Measures', icon: Gauge, target: 'measures', enabled: wigsCount > 0 },
  ];

  return (
    <nav className="pw-hier wizard-hier" aria-label="Setup progress">
      {segments.map((seg, index) => {
        const active = stepIndex === index;
        const done = stepIndex > index;
        const future = !active && !done;
        const clickable = !active && seg.enabled;
        const state = active ? 'active' : done ? 'done' : 'future';
        const Icon = done ? CheckCircle2 : seg.icon;
        const Tag = clickable ? 'button' : 'span';
        return (
          <React.Fragment key={seg.key}>
            {index > 0 && <ChevronRight size={12} className="pw-hier-sep" aria-hidden />}
            <Tag
              className={`pw-hier-seg ${state}${clickable ? ' clickable' : ''}`}
              {...(clickable ? { type: 'button', onClick: () => onStep(seg.target) } : {})}
              aria-current={active ? 'step' : undefined}
            >
              <Icon size={14} className="pw-hier-icon" aria-hidden />
              <span className="pw-hier-label">{seg.label}</span>
            </Tag>
          </React.Fragment>
        );
      })}
    </nav>
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
    budget_crore: 0,
    priority: 5
  });
  const [wigDraft, setWigDraft] = useState({
    title: '',
    current_state: '',
    target_state: '',
    from_value: 0,
    to_value: 100,
    unit: 'milestone score',
    deadline: '',
    owner: '',
    priority: '',
    update_frequency: 'weekly',
    budget_allocated: ''
  });
  const [measureDraft, setMeasureDraft] = useState({
    title: '',
    current_state: '',
    target_state: '',
    from_value: 0,
    to_value: 100,
    unit: 'tracking score',
    deadline: '',
    assigned_to: '',
    priority: '',
    budget_allocated: ''
  });

  useEffect(() => {
    if (!projectDraft.ministry_id && ministries[0]?._id) {
      setProjectDraft(prev => ({ ...prev, ministry_id: ministries[0]._id }));
    }
  }, [ministries, projectDraft.ministry_id]);

  const wigs = useMemo(() => (project?.wigs || []).filter(wig => !wig.archived_at), [project]);
  const activeWig = wigs.find(wig => wig.id === activeWigId) || wigs[0] || null;
  const activeMeasures = useMemo(() => (activeWig?.lead_measures || []).filter(measure => !measure.archived_at), [activeWig]);
  const selectedMinistry = ministries.find(ministry => ministry._id === projectDraft.ministry_id);
  const builderStep = !project ? 'project' : activeWig ? 'measures' : 'wigs';

  async function createProject(e) {
    e?.preventDefault?.();
    setSaving(true);
    try {
      const data = await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: String(projectDraft.name || '').trim(),
          ministry_id: projectDraft.ministry_id,
          owner: String(projectDraft.owner || '').trim(),
          current_state: String(projectDraft.current_state || '').trim(),
          target_state: String(projectDraft.target_state || '').trim(),
          due_date: projectDraft.due_date,
          budget_crore: Number(projectDraft.budget_crore) || 0,
          priority: Number(projectDraft.priority) || 5
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
    e?.preventDefault?.();
    if (!project?._id) return;
    if (project.due_date && deadlineExceedsCap(wigDraft.deadline, project.due_date)) {
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: String(wigDraft.title || '').trim(),
        current_state: String(wigDraft.current_state || '').trim(),
        target_state: String(wigDraft.target_state || '').trim(),
        from_value: Number(wigDraft.from_value) || 0,
        to_value: Number(wigDraft.to_value) || 0,
        unit: String(wigDraft.unit || '').trim(),
        deadline: wigDraft.deadline,
        owner: String(wigDraft.owner || '').trim(),
        update_frequency: wigDraft.update_frequency || 'weekly',
        budget_allocated: Number(wigDraft.budget_allocated) || 0,
      };
      if (wigDraft.priority !== '' && wigDraft.priority != null) body.priority = Number(wigDraft.priority);
      const data = await api(`/api/projects/${project._id}/wigs`, { method: 'POST', body: JSON.stringify(body) });
      const nextWigs = (data.wigs || []).filter(wig => !wig.archived_at);
      const newestWig = nextWigs[nextWigs.length - 1];
      setProject(data);
      setActiveWigId(newestWig?.id || '');
      setWigDraft({ ...WIG_BLANK, owner: String(wigDraft.owner || '').trim() });
      setStep('measures');
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function addMeasure(e) {
    e?.preventDefault?.();
    if (!project?._id || !activeWig?.id) return;
    const maxDeadline = tightestDeadline(project.due_date, activeWig.deadline);
    if (maxDeadline && deadlineExceedsCap(measureDraft.deadline, maxDeadline)) {
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: String(measureDraft.title || '').trim(),
        current_state: String(measureDraft.current_state || '').trim(),
        target_state: String(measureDraft.target_state || '').trim(),
        from_value: Number(measureDraft.from_value) || 0,
        to_value: Number(measureDraft.to_value) || 0,
        unit: String(measureDraft.unit || '').trim(),
        deadline: measureDraft.deadline,
        assigned_to: String(measureDraft.assigned_to || '').split(',').map(item => item.trim()).filter(Boolean),
        budget_allocated: Number(measureDraft.budget_allocated) || 0,
      };
      if (measureDraft.priority !== '' && measureDraft.priority != null) body.priority = Number(measureDraft.priority);
      const data = await api(`/api/projects/${project._id}/wigs/${activeWig.id}/lead-measures`, { method: 'POST', body: JSON.stringify(body) });
      setProject(data);
      setMeasureDraft({ ...MEASURE_BLANK, assigned_to: String(measureDraft.assigned_to || '').trim(), unit: String(measureDraft.unit || '%').trim() });
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

  const wizardBudget = useMemo(() => projectBudgetSummary(project), [project]);
  const wizardOtherWigBudget = useMemo(() => wigs.reduce((sum, item) => sum + (Number(item.budget_allocated) || 0), 0), [wigs]);
  const wizardWigBudget = useMemo(() => wigBudgetSummary(activeWig), [activeWig]);
  const wizardOtherMeasureBudget = useMemo(
    () => (activeWig?.lead_measures || []).filter(item => !item.archived_at).reduce((sum, item) => sum + (Number(item.budget_allocated) || 0), 0),
    [activeWig],
  );

  function handleWizardSubmit(e) {
    if (step === 'project') createProject(e);
    else if (step === 'wigs') addWig(e);
    else addMeasure(e);
  }

  const wizardSubmitLabel = step === 'project' ? (saving ? 'Creating…' : 'Create project') : step === 'wigs' ? (saving ? 'Adding…' : 'Add WIG') : (saving ? 'Adding…' : 'Add lead measure');

  return (
    <section className="workflow-builder-page">
      <div className="page-breadcrumbs">
        <button type="button" onClick={onClose}><ArrowLeft size={14} /> Projects</button>
        <ChevronRight size={13} />
        <span>Create 4DX Workflow</span>
      </div>

      <div className="workflow-stepper card">
        {[
          ['project', 'Project', 'Define project basics'],
          ['wigs', 'WIG / Milestone', 'Define WIGs and milestones'],
          ['measures', 'Lead Measures', 'Define lead measures'],
          ['review', 'Review', 'Review and confirm'],
        ].map(([key, title, copy], index) => {
          const active = key === builderStep || (key === 'review' && project && wigs.length && activeMeasures.length);
          const complete = (key === 'project' && project) || (key === 'wigs' && wigs.length) || (key === 'measures' && activeMeasures.length);
          return (
            <React.Fragment key={key}>
              {index > 0 && <div className={`workflow-step-line ${complete || active ? 'active' : ''}`} />}
              <div className={`workflow-step ${active ? 'active' : ''} ${complete ? 'complete' : ''}`}>
                <span>{complete ? <Check size={17} /> : index + 1}</span>
                <div>
                  <strong>{title}</strong>
                  <small>{copy}</small>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      <div className="workflow-builder-grid">
        <form className="workflow-panel card" onSubmit={createProject}>
          <div className="workflow-panel-title">
            <span><ClipboardList size={18} /> 1. Project Details</span>
            {project && <em>Saved</em>}
          </div>
          <label className="workflow-field">
            <span>Project Name <b>*</b></span>
            <input value={projectDraft.name} onChange={e => setProjectDraft({ ...projectDraft, name: e.target.value })} required placeholder="Rural Housing Mission" />
          </label>
          <label className="workflow-field">
            <span>Ministry <b>*</b></span>
            <select value={projectDraft.ministry_id} onChange={e => setProjectDraft({ ...projectDraft, ministry_id: e.target.value })} required>
              {ministries.map(ministry => <option key={ministry._id} value={ministry._id}>{ministry.name}</option>)}
            </select>
          </label>
          <label className="workflow-field">
            <span>Department / Agency</span>
            <input value={selectedMinistry?.name || ''} readOnly placeholder="Selected ministry" />
          </label>
          <label className="workflow-field">
            <span>Owner <b>*</b></span>
            <input value={projectDraft.owner} onChange={e => setProjectDraft({ ...projectDraft, owner: e.target.value })} required placeholder="Mission Director" />
          </label>
          <div className="workflow-two">
            <label className="workflow-field">
              <span>Start Date</span>
              <input type="date" />
            </label>
            <label className="workflow-field">
              <span>Target Completion Date <b>*</b></span>
              <input type="date" value={projectDraft.due_date} onChange={e => setProjectDraft({ ...projectDraft, due_date: e.target.value })} required />
            </label>
          </div>
          <label className="workflow-field">
            <span>Current State <b>*</b></span>
            <textarea value={projectDraft.current_state} onChange={e => setProjectDraft({ ...projectDraft, current_state: e.target.value })} required placeholder="Example: 10 houses constructed, water saving 10%, employment 250" />
          </label>
          <label className="workflow-field">
            <span>Target State <b>*</b></span>
            <textarea value={projectDraft.target_state} onChange={e => setProjectDraft({ ...projectDraft, target_state: e.target.value })} required placeholder="Example: 25 houses completed, water saving 45%, employment 1000" />
          </label>
          <div className="workflow-info"><Shield size={16} /> All projects are visible to all users. Edit access is role-based.</div>
          <button className="sr-only-submit" type="submit">Save project</button>
        </form>

        <section className={`workflow-panel card workflow-wide-panel ${!project ? 'disabled' : ''}`}>
          <div className="workflow-panel-title">
            <span><Target size={18} /> 2. WIGs / Milestones ({wigs.length})</span>
            <button type="button" className="ghost-btn" onClick={addWig} disabled={!project || saving}><Plus size={14} /> Add WIG</button>
          </div>
          <div className="workflow-split">
            <div className="workflow-item-list">
              {wigs.length === 0 && <p className="workflow-empty">Create the project, then add WIGs here.</p>}
              {wigs.map((wig, index) => (
                <button key={wig.id} type="button" className={`workflow-item ${activeWig?.id === wig.id ? 'active' : ''}`} onClick={() => { setActiveWigId(wig.id); setStep('measures'); }}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{wig.title}</strong>
                    <small>{currentStateText(wig)} → {targetStateText(wig)} by {deadlineText(wig)}</small>
                  </div>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
            <form className="workflow-active-form" onSubmit={addWig}>
              <div className="workflow-active-head">
                <strong>Active WIG / Milestone</strong>
                <button type="button" className="icon-btn" disabled><Archive size={14} /></button>
              </div>
              <label className="workflow-field">
                <span>WIG / Milestone Title <b>*</b></span>
                <input value={wigDraft.title} onChange={e => setWigDraft({ ...wigDraft, title: e.target.value })} required disabled={!project} maxLength={120} placeholder="Complete construction of 25 rural housing units" />
              </label>
              <label className="workflow-field">
                <span>Current State <b>*</b></span>
                <textarea value={wigDraft.current_state} onChange={e => setWigDraft({ ...wigDraft, current_state: e.target.value })} required disabled={!project} maxLength={250} placeholder="10 houses constructed" />
                <small>What is the real current situation today? Use numbers and facts.</small>
              </label>
              <label className="workflow-field">
                <span>Target State <b>*</b></span>
                <textarea value={wigDraft.target_state} onChange={e => setWigDraft({ ...wigDraft, target_state: e.target.value })} required disabled={!project} maxLength={250} placeholder="25 houses completed" />
              </label>
              <div className="workflow-two">
                <label className="workflow-field">
                  <span>Deadline <b>*</b></span>
                  <input type="date" value={wigDraft.deadline} max={project?.due_date || undefined} onChange={e => setWigDraft({ ...wigDraft, deadline: e.target.value })} required disabled={!project} />
                </label>
                <label className="workflow-field">
                  <span>Owner <b>*</b></span>
                  <input value={wigDraft.owner} onChange={e => setWigDraft({ ...wigDraft, owner: e.target.value })} required disabled={!project} placeholder="Vikram S." />
                </label>
              </div>
              <label className="workflow-field">
                <span>Update Frequency</span>
                <select value={wigDraft.update_frequency} onChange={e => setWigDraft({ ...wigDraft, update_frequency: e.target.value })} disabled={!project}>
                  {UPDATE_FREQUENCY_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              <div className="workflow-score-grid">
                <label className="workflow-field"><span>Score starts at</span><input type="number" value={wigDraft.from_value} onChange={e => setWigDraft({ ...wigDraft, from_value: e.target.value })} disabled={!project} /></label>
                <label className="workflow-field"><span>Score target</span><input type="number" value={wigDraft.to_value} onChange={e => setWigDraft({ ...wigDraft, to_value: e.target.value })} disabled={!project} /></label>
                <label className="workflow-field"><span>Score label</span><input value={wigDraft.unit} onChange={e => setWigDraft({ ...wigDraft, unit: e.target.value })} disabled={!project} /></label>
              </div>
            </form>
          </div>
        </section>

        <section className={`workflow-panel card workflow-wide-panel ${!activeWig ? 'disabled' : ''}`}>
          <div className="workflow-panel-title">
            <span><Gauge size={18} /> 3. Lead Measures ({activeMeasures.length})</span>
            <button type="button" className="ghost-btn" onClick={addMeasure} disabled={!activeWig || saving}><Plus size={14} /> Add Lead Measure</button>
          </div>
          <div className="workflow-split">
            <div className="workflow-item-list">
              {!activeWig && <p className="workflow-empty">Select or add a WIG before adding lead measures.</p>}
              {activeMeasures.map((measure, index) => (
                <button key={measure.id} type="button" className="workflow-item">
                  <span>{index + 1}</span>
                  <div>
                    <strong>{measure.title}</strong>
                    <small>{currentStateText(measure)} → {targetStateText(measure)} by {deadlineText(measure)}</small>
                  </div>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
            <form className="workflow-active-form" onSubmit={addMeasure}>
              <div className="workflow-active-head">
                <strong>Active Lead Measure</strong>
                <button type="button" className="icon-btn" disabled><Archive size={14} /></button>
              </div>
              <label className="workflow-field">
                <span>Lead Measure Title <b>*</b></span>
                <input value={measureDraft.title} onChange={e => setMeasureDraft({ ...measureDraft, title: e.target.value })} required disabled={!activeWig} maxLength={120} placeholder="Move weekly verified progress" />
              </label>
              <label className="workflow-field">
                <span>Current State <b>*</b></span>
                <textarea value={measureDraft.current_state} onChange={e => setMeasureDraft({ ...measureDraft, current_state: e.target.value })} required disabled={!activeWig} maxLength={200} placeholder="29% verified" />
                <small>What is the real current situation today? Use numbers and facts.</small>
              </label>
              <label className="workflow-field">
                <span>Target State <b>*</b></span>
                <textarea value={measureDraft.target_state} onChange={e => setMeasureDraft({ ...measureDraft, target_state: e.target.value })} required disabled={!activeWig} maxLength={200} placeholder="57% verified" />
              </label>
              <div className="workflow-two">
                <label className="workflow-field">
                  <span>Deadline <b>*</b></span>
                  <input type="date" value={measureDraft.deadline} max={tightestDeadline(project?.due_date, activeWig?.deadline) || undefined} onChange={e => setMeasureDraft({ ...measureDraft, deadline: e.target.value })} required disabled={!activeWig} />
                </label>
                <label className="workflow-field">
                  <span>Owner <b>*</b></span>
                  <input value={measureDraft.assigned_to} onChange={e => setMeasureDraft({ ...measureDraft, assigned_to: e.target.value })} required disabled={!activeWig} placeholder="Ramesh M." />
                </label>
              </div>
              <label className="workflow-field">
                <span>Update Frequency</span>
                <select value={measureDraft.update_frequency || 'weekly'} onChange={e => setMeasureDraft({ ...measureDraft, update_frequency: e.target.value })} disabled={!activeWig}>
                  {UPDATE_FREQUENCY_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              <div className="workflow-score-grid">
                <label className="workflow-field"><span>Score starts at</span><input type="number" value={measureDraft.from_value} onChange={e => setMeasureDraft({ ...measureDraft, from_value: e.target.value })} disabled={!activeWig} /></label>
                <label className="workflow-field"><span>Score target</span><input type="number" value={measureDraft.to_value} onChange={e => setMeasureDraft({ ...measureDraft, to_value: e.target.value })} disabled={!activeWig} /></label>
                <label className="workflow-field"><span>Score label</span><input value={measureDraft.unit} onChange={e => setMeasureDraft({ ...measureDraft, unit: e.target.value })} disabled={!activeWig} /></label>
              </div>
            </form>
          </div>
        </section>
      </div>

      <div className="workflow-builder-footer card">
        <button type="button" className="ghost-btn" onClick={onClose}>Cancel</button>
        <div>
          <button type="button" className="ghost-btn" onClick={createProject} disabled={Boolean(project) || saving}><ClipboardList size={15} /> Save Draft</button>
          <button type="button" className="ghost-btn" onClick={addWig} disabled={!project || saving}><Plus size={15} /> Add WIG</button>
          <button type="button" className="ghost-btn" onClick={addMeasure} disabled={!activeWig || saving}><Plus size={15} /> Add Lead Measure</button>
          <button type="button" className="primary-btn" onClick={finishSetup} disabled={!project || saving}>Review Workflow <ChevronRight size={16} /></button>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Project Workspace — single full-page drill-down surface:
   Portfolio → Project → WIG → Lead Measure
   ───────────────────────────────────────────────────────────── */

const WIG_BLANK = { title: '', current_state: '', target_state: '', from_value: 0, to_value: 100, unit: 'milestone score', deadline: '', owner: '', priority: '', update_frequency: 'weekly', budget_allocated: '' };
const MEASURE_BLANK = { title: '', current_state: '', target_state: '', from_value: 0, to_value: 100, unit: 'tracking score', deadline: '', assigned_to: '', priority: '', budget_allocated: '' };

function truncateNavLabel(text, maxLen = 28) {
  const s = (text || '').trim();
  if (s.length <= maxLen) return s;
  const keep = maxLen - 1;
  const head = Math.ceil(keep * 0.55);
  const tail = keep - head;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function WorkspaceHierarchyNav({ level, project, wig, measure, onExit, onProjectHome, onWigHome }) {
  const segments = [
    {
      key: 'portfolio',
      displayLabel: 'Projects',
      icon: Home,
      state: 'past',
      onClick: onExit,
      title: 'Back to portfolio',
    },
    {
      key: 'project',
      displayLabel: level === 'project' ? 'Project' : truncateNavLabel(project?.name),
      icon: Building2,
      state: level === 'project' ? 'active' : 'past',
      onClick: level !== 'project' ? onProjectHome : undefined,
      title: project?.name,
    },
    {
      key: 'wig',
      displayLabel: level === 'wig' ? 'WIG' : level === 'measure' ? truncateNavLabel(wig?.title) : 'WIG',
      icon: Target,
      state: level === 'wig' ? 'active' : level === 'measure' ? 'past' : 'future',
      onClick: level === 'measure' ? onWigHome : undefined,
      title: wig?.title,
    },
    {
      key: 'measure',
      displayLabel: 'Lead Measure',
      icon: Gauge,
      state: level === 'measure' ? 'active' : 'future',
      title: measure?.title,
    },
  ];

  return (
    <nav className="pw-hier" aria-label="Workspace hierarchy">
      {segments.map((seg, index) => {
        const Icon = seg.icon;
        const clickable = Boolean(seg.onClick);
        const Tag = clickable ? 'button' : 'span';
        return (
          <React.Fragment key={seg.key}>
            {index > 0 && <ChevronRight size={12} className="pw-hier-sep" aria-hidden />}
            <Tag
              className={`pw-hier-seg ${seg.state}${clickable ? ' clickable' : ''}`}
              {...(clickable ? { type: 'button', onClick: seg.onClick } : {})}
              aria-current={seg.state === 'active' ? 'page' : undefined}
              title={seg.state === 'past' && seg.key !== 'portfolio' ? seg.title : seg.title || undefined}
            >
              <Icon size={14} className="pw-hier-icon" aria-hidden />
              <span className="pw-hier-label">{seg.displayLabel}</span>
            </Tag>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

function ProgressMeter({ from, to, current, unit, large = false }) {
  const pct = progressPercent(from, to, current ?? from);
  return (
    <div className={`pw-meter ${large ? 'large' : ''}`}>
      <div className="pw-meter-track"><em style={{ width: `${pct}%`, background: scoreColor(pct) }} /></div>
      <div className="pw-meter-meta">
        <span>{current ?? from} → {to} {unit}</span>
        <strong style={{ color: scoreColor(pct) }}>{pct}%</strong>
      </div>
    </div>
  );
}

function ProgressSlider({ from = 0, to = 100, value, onChange, unit = '', disabled = false, compact = false, showNumberInput = true }) {
  const fromNum = Number(from) || 0;
  const toNum = Number(to) || 100;
  const raw = value === '' || value === null || value === undefined ? fromNum : Number(value);
  const safeVal = Number.isFinite(raw) ? raw : fromNum;
  const pct = progressPercent(fromNum, toNum, safeVal);

  function emit(next) {
    onChange(typeof next === 'number' ? next : Number(next));
  }

  function handleRange(e) {
    const pctVal = Number(e.target.value);
    const scaled = fromNum + ((toNum - fromNum) * pctVal) / 100;
    emit(Math.round(scaled * 100) / 100);
  }

  return (
    <div className={`progress-slider ${compact ? 'compact' : ''}`}>
      <div className="progress-slider-label">
        <strong style={{ color: scoreColor(pct) }}>{pct}%</strong>
        {unit && <small>{unit}</small>}
      </div>
      <div className="progress-slider-track-wrap">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          disabled={disabled}
          onChange={handleRange}
          className="progress-slider-range"
          style={{ '--pct': `${pct}%`, '--track-color': scoreColor(pct) }}
        />
        {showNumberInput && (
          <input
            type="number"
            className="progress-slider-number"
            min={fromNum}
            max={toNum}
            step="any"
            value={safeVal}
            disabled={disabled}
            onChange={e => emit(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}

function StatePair({ entity }) {
  return (
    <div className="pw-states">
      <div>
        <span>Now</span>
        <p>{currentStateText(entity)}</p>
      </div>
      <div className="pw-states-arrow"><ChevronRight size={18} /></div>
      <div>
        <span>Target</span>
        <p>{targetStateText(entity)}</p>
      </div>
    </div>
  );
}

function WigFormFields({ draft, setDraft, inheritPriority, projectBudget, otherWigBudget = 0, editMode = false, projectDeadline = '' }) {
  const draftBudget = Number(draft.budget_allocated) || 0;
  const budgetWarn = projectBudget > 0 && (otherWigBudget + draftBudget) > projectBudget;
  const deadlineError = projectDeadline && deadlineExceedsCap(draft.deadline, projectDeadline);
  return (
    <div className="entity-form">
      <FormSection title="Goal definition" hint="Use plain language for the real-world change. Numbers are optional here.">
        <label className="field">
          <span>Title</span>
          <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} required autoFocus placeholder="Wildly Important Goal title" />
        </label>
        <div className="two-col">
          <label className="field">
            <span>Current state</span>
            <textarea className="compact-textarea" value={draft.current_state} onChange={e => setDraft({ ...draft, current_state: e.target.value })} required placeholder="Example: 10 houses constructed, water saving at 10%, 250 people employed" />
          </label>
          <label className="field">
            <span>Target state</span>
            <textarea className="compact-textarea" value={draft.target_state} onChange={e => setDraft({ ...draft, target_state: e.target.value })} required placeholder="Example: 25 houses completed, water saving at 45%, employment for 1,000 people" />
          </label>
        </div>
      </FormSection>
      <FormSection title="Tracking score & timeline" hint="Optional scoring scale for charts and health. The real current/target state is above.">
        <div className="pw-form-grid">
          <label className="field"><span>Score starts at</span><input type="number" value={draft.from_value} onChange={e => setDraft({ ...draft, from_value: e.target.value })} /></label>
          <label className="field"><span>Score target</span><input type="number" value={draft.to_value} onChange={e => setDraft({ ...draft, to_value: e.target.value })} required /></label>
          <label className="field"><span>Score label</span><input value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value })} required placeholder="milestone score, houses, %, jobs" /></label>
          <label className="field"><span>Deadline</span><input type="date" value={draft.deadline} max={projectDeadline || undefined} onChange={e => setDraft({ ...draft, deadline: e.target.value })} required /><FieldHint hint={projectDeadline ? `Must be on or before project deadline: ${projectDeadline}` : null} error={deadlineError ? `Cannot exceed project deadline (${projectDeadline})` : null} /></label>
        </div>
      </FormSection>
      <FormSection title="Ownership & cadence" hint="Who owns this WIG and how often progress must be posted.">
        <div className="two-col">
          <label className="field">
            <span>Owner</span>
            <input value={draft.owner} onChange={e => setDraft({ ...draft, owner: e.target.value })} required placeholder="Mission director or WIG owner" />
          </label>
          <label className="field">
            <span>Update frequency</span>
            <select value={draft.update_frequency || 'weekly'} onChange={e => setDraft({ ...draft, update_frequency: e.target.value })}>
              {UPDATE_FREQUENCY_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
        </div>
        <div className="two-col">
          <label className="field">
            <span>Priority</span>
            <select value={draft.priority ?? ''} onChange={e => setDraft({ ...draft, priority: e.target.value })}>
              {!editMode && inheritPriority != null && <option value="">Inherit (P{inheritPriority})</option>}
              {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>P{p}{p >= 8 ? ' — Urgent' : p >= 6 ? ' — High' : p >= 4 ? ' — Medium' : ' — Low'}</option>)}
            </select>
          </label>
          <label className="field">
            <span>WIG budget (Cr)</span>
            <input type="number" min="0" step="0.1" value={draft.budget_allocated} onChange={e => setDraft({ ...draft, budget_allocated: e.target.value })} placeholder="Sub-budget from project total" />
            <FieldHint error={budgetWarn ? `Exceeds project budget (${formatBudgetCr(projectBudget)})` : null} />
          </label>
        </div>
        {projectBudget > 0 && (
          <BudgetBar label="Project allocation" allocated={otherWigBudget + draftBudget} total={projectBudget} warn={budgetWarn} />
        )}
      </FormSection>
    </div>
  );
}

function MeasureFormFields({ draft, setDraft, inheritPriority, wigBudget, otherMeasureBudget = 0, editMode = false, showStatus = false, projectDeadline = '', wigDeadline = '' }) {
  const draftBudget = Number(draft.budget_allocated) || 0;
  const budgetWarn = wigBudget > 0 && (otherMeasureBudget + draftBudget) > wigBudget;
  const maxDeadline = tightestDeadline(projectDeadline, wigDeadline);
  const deadlineError = maxDeadline && deadlineExceedsCap(draft.deadline, maxDeadline);
  const deadlineHint = maxDeadline
    ? `Must be on or before ${projectDeadline && wigDeadline && projectDeadline !== wigDeadline ? `project (${projectDeadline}) or WIG (${wigDeadline})` : projectDeadline ? `project deadline: ${projectDeadline}` : `WIG deadline: ${wigDeadline}`}`
    : null;
  return (
    <div className="entity-form">
      <FormSection title="Lead measure" hint="Describe the action in real-world terms first, then add a tracking score below.">
        <label className="field">
          <span>Title</span>
          <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} required autoFocus placeholder="Weekly field verification, approvals cleared…" />
        </label>
        <div className="two-col">
          <label className="field">
            <span>Current state</span>
            <textarea className="compact-textarea" value={draft.current_state} onChange={e => setDraft({ ...draft, current_state: e.target.value })} required placeholder="Example: 10 houses verified, 250 jobs created, 4 approvals cleared" />
          </label>
          <label className="field">
            <span>Target state</span>
            <textarea className="compact-textarea" value={draft.target_state} onChange={e => setDraft({ ...draft, target_state: e.target.value })} required placeholder="Example: 25 houses verified, 1,000 jobs created, all 9 approvals cleared" />
          </label>
        </div>
      </FormSection>
      <FormSection title="Tracking score & timeline" hint="Used for progress bars and health scoring. Current/target text above can be any format.">
        <div className="pw-form-grid">
          <label className="field"><span>Score starts at</span><input type="number" value={draft.from_value} onChange={e => setDraft({ ...draft, from_value: e.target.value })} /></label>
          <label className="field"><span>Score target</span><input type="number" value={draft.to_value} onChange={e => setDraft({ ...draft, to_value: e.target.value })} required /></label>
          <label className="field"><span>Score label</span><input value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value })} required placeholder="tracking score, houses, %, jobs" /></label>
          <label className="field"><span>Deadline</span><input type="date" value={draft.deadline} max={maxDeadline || undefined} onChange={e => setDraft({ ...draft, deadline: e.target.value })} required /><FieldHint hint={deadlineHint} error={deadlineError ? `Cannot exceed ${maxDeadline}` : null} /></label>
        </div>
      </FormSection>
      <FormSection title="Ownership & budget">
        <div className="two-col">
          <label className="field">
            <span>Assigned to</span>
            <input value={draft.assigned_to} onChange={e => setDraft({ ...draft, assigned_to: e.target.value })} required placeholder="Comma-separated names" />
          </label>
          <label className="field">
            <span>Priority</span>
            <select value={draft.priority ?? ''} onChange={e => setDraft({ ...draft, priority: e.target.value })}>
              {!editMode && inheritPriority != null && <option value="">Inherit (P{inheritPriority})</option>}
              {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>P{p}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Measure budget (Cr)</span>
          <input type="number" min="0" step="0.1" value={draft.budget_allocated} onChange={e => setDraft({ ...draft, budget_allocated: e.target.value })} placeholder="Sub-budget from WIG allocation" />
          <FieldHint error={budgetWarn ? `Exceeds WIG budget (${formatBudgetCr(wigBudget)})` : null} />
        </label>
        {showStatus && (
          <label className="field">
            <span>Status</span>
            <select value={draft.status || 'Open'} onChange={e => setDraft({ ...draft, status: e.target.value })}>
              <option>Open</option><option>Updated</option><option>Done</option><option>On Hold</option>
            </select>
          </label>
        )}
        {wigBudget > 0 && (
          <BudgetBar label="WIG allocation" allocated={otherMeasureBudget + draftBudget} total={wigBudget} warn={budgetWarn} />
        )}
      </FormSection>
    </div>
  );
}

function ProjectFormFields({ draft, setDraft, ministries }) {
  return (
    <div className="entity-form">
      <FormSection title="Project identity" hint="Name the mission and assign ownership.">
        <label className="field">
          <span>Project name</span>
          <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} required autoFocus placeholder="e.g. Bangalore Metro Phase 2" />
        </label>
        <div className="two-col">
          <label className="field">
            <span>Department</span>
            <select value={draft.ministry_id} onChange={e => setDraft({ ...draft, ministry_id: e.target.value })} required>
              {ministries.map(ministry => <option key={ministry._id} value={ministry._id}>{ministry.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Owner</span>
            <input value={draft.owner} onChange={e => setDraft({ ...draft, owner: e.target.value })} required placeholder="Mission director" />
          </label>
        </div>
      </FormSection>
      <FormSection title="Execution scope" hint="Current and target can be descriptive, numeric, percentage-based, or outcome-based.">
        <div className="two-col">
          <label className="field">
            <span>Current state</span>
            <textarea className="compact-textarea" value={draft.current_state} onChange={e => setDraft({ ...draft, current_state: e.target.value })} required placeholder="Example: 10 houses constructed, water saving at 10%, employment at 250 people" />
          </label>
          <label className="field">
            <span>Target state</span>
            <textarea className="compact-textarea" value={draft.target_state} onChange={e => setDraft({ ...draft, target_state: e.target.value })} required placeholder="Example: 25 houses completed, water saving at 45%, employment for 1,000 people" />
          </label>
        </div>
      </FormSection>
      <FormSection title="Budget & timeline">
        <div className="pw-form-grid">
          <label className="field"><span>Due date</span><input type="date" value={draft.due_date} onChange={e => setDraft({ ...draft, due_date: e.target.value })} required /></label>
          <label className="field"><span>Total budget (Cr)</span><input type="number" min="0" step="0.1" value={draft.budget_crore} onChange={e => setDraft({ ...draft, budget_crore: e.target.value })} required /></label>
          <label className="field">
            <span>Priority</span>
            <select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })}>
              {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>P{p}{p >= 8 ? ' — Urgent' : p >= 6 ? ' — High' : p >= 4 ? ' — Medium' : ' — Low'}</option>)}
            </select>
          </label>
        </div>
      </FormSection>
    </div>
  );
}

function AutoInsightCard({ insight, scope, onOpen, onRefresh }) {
  const label = scope === 'measure' ? 'Lead Measure AI Insight' : scope === 'wig' ? 'WIG AI Insight' : 'Project AI Insight';
  const summary = insight?.result?.summary || '';
  const risks = insight?.result?.risks || [];
  const highlights = insight?.result?.highlights || [];
  const firstRisk = risks[0];
  return (
    <section className="auto-insight card">
      <div className="auto-insight-head">
        <span><Brain size={15} /> {label}</span>
        <div>
          <button className="icon-btn" type="button" onClick={onRefresh} title="Refresh AI insight"><RefreshCw size={14} className={insight?.loading ? 'spin' : ''} /></button>
          <button className="ghost-btn" type="button" onClick={onOpen}>Ask AI</button>
        </div>
      </div>
      {insight?.loading && <p className="auto-insight-muted"><Loader2 size={15} className="spin" /> Analyzing execution context…</p>}
      {!insight?.loading && insight?.error && <p className="ai-error">{insight.error}</p>}
      {!insight?.loading && !insight?.error && (
        <div className="auto-insight-grid">
          <div>
            <b>Summary</b>
            <p>{summary || 'AI insight will appear after this workspace finishes loading.'}</p>
          </div>
          <div>
            <b>Recommended next action</b>
            <p>{firstRisk?.reason || highlights[0] || 'Continue weekly cadence and keep evidence current.'}</p>
          </div>
          <div>
            <b>Risk signal</b>
            <p>{firstRisk?.title || 'No major risk signal detected yet.'}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function ProjectWorkspace({ projectId, initialWigId = null, initialMeasureId = null, projects, api, reload, session, notify, onExit, locale = 'en', onOpenMeetingToAction, mtaRefreshKey = 0 }) {
  const [bundle, setBundle] = useState(null);
  const [wigId, setWigId] = useState(initialWigId);
  const [measureId, setMeasureId] = useState(initialMeasureId);
  const [tab, setTab] = useState('activity');
  const [activitySort, setActivitySort] = useState('latest');
  const [modal, setModal] = useState(null);
  const [insightModal, setInsightModal] = useState(null);
  const [autoInsight, setAutoInsight] = useState({ key: '', loading: false, result: null, error: '' });
  const [busy, setBusy] = useState(false);
  const [quickEdit, setQuickEdit] = useState(null);
  const [wigDraft, setWigDraft] = useState(WIG_BLANK);
  const [measureDraft, setMeasureDraft] = useState(MEASURE_BLANK);
  const [composer, setComposer] = useState({ mode: 'progress', value: '', health_state: 'green', text: '', author: session?.user?.phone || '' });
  const [evidenceDraft, setEvidenceDraft] = useState({ title: '', document_type: 'Progress Note', content: '' });
  const [approvalDraft, setApprovalDraft] = useState({ title: '', requested_by: '', summary: '', due_date: '' });
  const [meetingDraft, setMeetingDraft] = useState({ meeting_date: '', facilitator: '', notes: '', commitments: '' });

  const fallback = projects.find(p => p._id === projectId) || null;
  const project = bundle?.project || fallback;
  const canEdit = (bundle?.permissions || project?.permissions)?.can_edit === true;
  const wigs = useMemo(
    () => (project?.wigs || []).filter(w => !w.archived_at).sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5)),
    [project],
  );
  const wig = wigs.find(w => w.id === wigId) || null;
  const measures = useMemo(
    () => (wig?.lead_measures || []).filter(m => !m.archived_at).sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5)),
    [wig],
  );
  const measure = measures.find(m => m.id === measureId) || null;
  const level = measure ? 'measure' : wig ? 'wig' : 'project';

  function openContextualInsight(scope) {
    setInsightModal({ scope });
  }

  function insightPath(scope = level) {
    if (scope === 'measure' && wig?.id && measure?.id) return `/api/ai/insight/measure/${projectId}/${wig.id}/${measure.id}`;
    if (scope === 'wig' && wig?.id) return `/api/ai/insight/wig/${projectId}/${wig.id}`;
    return `/api/ai/insight/project/${projectId}`;
  }

  async function loadAutoInsight(scope = level) {
    const key = `${scope}:${projectId}:${wig?.id || ''}:${measure?.id || ''}`;
    setAutoInsight({ key, loading: true, result: null, error: '' });
    try {
      const result = await api(insightPath(scope), { method: 'POST', body: JSON.stringify({}) });
      setAutoInsight({ key, loading: false, result, error: '' });
    } catch (err) {
      setAutoInsight({ key, loading: false, result: null, error: err.message || 'AI insight unavailable' });
    }
  }

  function navigateToRiskSource(source) {
    if (!source || typeof source !== 'object') return;
    setInsightModal(null);
    if (source.wig_id) setWigId(source.wig_id);
    setMeasureId(source.measure_id || null);
    if (source.tab) setTab(source.tab);
    else if (source.measure_id) setTab('activity');
    window.setTimeout(() => {
      if (source.entity_id && source.type === 'approval') {
        document.getElementById(`approval-${source.entity_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (source.type === 'approval') {
        document.getElementById('pw-approvals-rail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (source.type === 'document' && source.entity_id) {
        document.getElementById(`doc-${source.entity_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
  }

  const activity = useMemo(() => buildMeasureActivity(measure, bundle, activitySort), [measure, bundle, activitySort]);
  const measureDocs = useMemo(() => (bundle?.documents || []).filter(doc => doc.measure_id === measure?.id), [bundle, measure]);
  const measureApprovals = useMemo(() => (bundle?.approvals || []).filter(item => item.measure_id === measure?.id), [bundle, measure]);
  const pendingApprovals = (bundle?.approvals || []).filter(item => item.status === 'Pending');
  const budget = useMemo(() => projectBudgetSummary(project), [project]);
  const wigBudget = useMemo(() => wigBudgetSummary(wig), [wig]);
  const otherWigBudget = useMemo(() => wigs.filter(w => w.id !== wig?.id).reduce((s, w) => s + (Number(w.budget_allocated) || 0), 0), [wigs, wig]);
  const otherMeasureBudget = useMemo(() => measures.filter(m => m.id !== measure?.id).reduce((s, m) => s + (Number(m.budget_allocated) || 0), 0), [measures, measure]);

  useEffect(() => {
    setWigId(initialWigId || null);
    setMeasureId(initialMeasureId || null);
    loadBundle();
  }, [projectId, initialWigId, initialMeasureId]);

  useEffect(() => {
    if (mtaRefreshKey > 0) loadBundle();
  }, [mtaRefreshKey]);

  useEffect(() => {
    if (measure) {
      setComposer(prev => ({ ...prev, value: measure.current_value ?? measure.from_value, text: '' }));
      setTab('activity');
    }
  }, [measureId]);

  useEffect(() => {
    if (!project) return;
    loadAutoInsight(level);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, wig?.id, measure?.id, level]);

  async function loadBundle() {
    try {
      setBundle(await api(`/api/projects/${projectId}/evidence`));
    } catch (err) {
      notify(err.message || 'Failed to load project', 'error');
    }
  }

  async function run(fn, successMessage) {
    setBusy(true);
    try {
      await fn();
      if (successMessage) notify(successMessage);
    } catch (err) {
      notify(err.message || 'Something went wrong', 'error');
    } finally {
      setBusy(false);
    }
  }

  function applyProject(data) {
    setBundle(prev => ({ ...(prev || {}), project: data }));
  }

  /* ── WIG actions ── */
  function openAddWig() {
    setWigDraft({ ...WIG_BLANK, owner: project?.owner || '' });
    setModal('wig-add');
  }

  function openEditWig() {
    setWigDraft({
      title: wig.title || '',
      current_state: wig.current_state || '',
      target_state: wig.target_state || '',
      from_value: wig.from_value ?? 0,
      to_value: wig.to_value ?? 100,
      unit: wig.unit || '',
      deadline: wig.deadline || '',
      owner: wig.owner || '',
      priority: wig.priority ?? 5,
      update_frequency: wig.update_frequency || 'weekly',
      budget_allocated: wig.budget_allocated ?? '',
    });
    setModal('wig-edit');
  }

  function submitWig(e) {
    e.preventDefault();
    if (project?.due_date && deadlineExceedsCap(wigDraft.deadline, project.due_date)) {
      notify(`WIG deadline cannot exceed project deadline (${project.due_date})`, 'error');
      return;
    }
    const body = {
      title: wigDraft.title.trim(),
      current_state: wigDraft.current_state.trim(),
      target_state: wigDraft.target_state.trim(),
      from_value: Number(wigDraft.from_value) || 0,
      to_value: Number(wigDraft.to_value) || 0,
      unit: wigDraft.unit.trim(),
      deadline: wigDraft.deadline,
      owner: wigDraft.owner.trim(),
      update_frequency: wigDraft.update_frequency || 'weekly',
      budget_allocated: Number(wigDraft.budget_allocated) || 0,
    };
    if (wigDraft.priority !== '' && wigDraft.priority != null) body.priority = Number(wigDraft.priority);
    run(async () => {
      if (modal === 'wig-edit') {
        const data = await api(`/api/projects/${projectId}/wigs/${wig.id}`, { method: 'PUT', body: JSON.stringify(body) });
        applyProject(data);
      } else {
        const data = await api(`/api/projects/${projectId}/wigs`, { method: 'POST', body: JSON.stringify(body) });
        applyProject(data);
        const next = (data.wigs || []).filter(w => !w.archived_at);
        setWigId(next[next.length - 1]?.id || null);
      }
      setModal(null);
      await reload();
    }, modal === 'wig-edit' ? 'WIG updated' : 'WIG added');
  }

  function changeProjectPriority(value) {
    run(async () => {
      const data = await api(`/api/projects/${projectId}`, { method: 'PUT', body: JSON.stringify({ priority: Number(value) }) });
      applyProject(data);
      await reload();
    }, `Project priority set to P${value}`);
  }

  function archiveWig(target) {
    if (!window.confirm(`Archive WIG "${target.title}" and its lead measures?`)) return;
    run(async () => {
      const data = await api(`/api/projects/${projectId}/wigs/${target.id}`, { method: 'DELETE' });
      applyProject(data);
      setMeasureId(null);
      setWigId(null);
      await reload();
    }, 'WIG archived');
  }

  /* ── Measure actions ── */
  function openAddMeasure() {
    setMeasureDraft({ ...MEASURE_BLANK, assigned_to: wig?.owner || '' });
    setModal('measure-add');
  }

  function openEditMeasure() {
    setMeasureDraft({
      title: measure.title || '',
      current_state: measure.current_state || '',
      target_state: measure.target_state || '',
      from_value: measure.from_value ?? 0,
      to_value: measure.to_value ?? 100,
      unit: measure.unit || '',
      deadline: measure.deadline || '',
      assigned_to: measure.assigned_to?.join(', ') || '',
      status: measure.status || 'Open',
      priority: measure.priority ?? 5,
      budget_allocated: measure.budget_allocated ?? '',
    });
    setModal('measure-edit');
  }

  function submitMeasure(e) {
    e.preventDefault();
    const maxDeadline = tightestDeadline(project?.due_date, wig?.deadline);
    if (maxDeadline && deadlineExceedsCap(measureDraft.deadline, maxDeadline)) {
      notify(`Lead measure deadline cannot exceed ${maxDeadline}`, 'error');
      return;
    }
    const body = {
      title: measureDraft.title.trim(),
      current_state: measureDraft.current_state.trim(),
      target_state: measureDraft.target_state.trim(),
      from_value: Number(measureDraft.from_value) || 0,
      to_value: Number(measureDraft.to_value) || 0,
      unit: measureDraft.unit.trim(),
      deadline: measureDraft.deadline,
      assigned_to: String(measureDraft.assigned_to || '').split(',').map(v => v.trim()).filter(Boolean),
      budget_allocated: Number(measureDraft.budget_allocated) || 0,
    };
    if (measureDraft.priority !== '' && measureDraft.priority != null) body.priority = Number(measureDraft.priority);
    run(async () => {
      if (modal === 'measure-edit') {
        const data = await api(`/api/projects/${projectId}/wigs/${wig.id}/lead-measures/${measure.id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...body, current_value: measure.current_value ?? body.from_value, status: measureDraft.status || 'Open' }),
        });
        applyProject(data);
      } else {
        const data = await api(`/api/projects/${projectId}/wigs/${wig.id}/lead-measures`, { method: 'POST', body: JSON.stringify(body) });
        applyProject(data);
      }
      setModal(null);
      await reload();
    }, modal === 'measure-edit' ? 'Lead measure updated' : 'Lead measure added');
  }

  function archiveMeasure(target) {
    if (!window.confirm(`Archive lead measure "${target.title}"?`)) return;
    run(async () => {
      const data = await api(`/api/projects/${projectId}/wigs/${wig.id}/lead-measures/${target.id}`, { method: 'DELETE' });
      applyProject(data);
      setMeasureId(null);
      await reload();
    }, 'Lead measure archived');
  }

  function submitQuickUpdate(targetWig, targetMeasure) {
    const value = Number(quickEdit?.value);
    if (Number.isNaN(value)) return;
    run(async () => {
      const data = await api(`/api/projects/${projectId}/wigs/${targetWig.id}/lead-measures/${targetMeasure.id}/progress`, {
        method: 'POST',
        body: JSON.stringify({ current_value: value, note: 'Quick progress update', health_state: 'green', author: session?.user?.phone || 'team' }),
      });
      applyProject(data);
      setQuickEdit(null);
      await loadBundle();
      await reload();
    }, 'Progress saved');
  }

  function submitQuickWigUpdate(targetWig) {
    const value = Number(quickEdit?.value);
    if (Number.isNaN(value)) return;
    run(async () => {
      const data = await api(`/api/projects/${projectId}/wigs/${targetWig.id}`, {
        method: 'PUT',
        body: JSON.stringify({ current_value: value }),
      });
      applyProject(data);
      setQuickEdit(null);
      await loadBundle();
      await reload();
    }, 'WIG progress saved');
  }

  /* ── Composer (progress / comment) ── */
  function submitComposer(e) {
    e.preventDefault();
    run(async () => {
      if (composer.mode === 'progress') {
        const data = await api(`/api/projects/${projectId}/wigs/${wig.id}/lead-measures/${measure.id}/progress`, {
          method: 'POST',
          body: JSON.stringify({
            current_value: Number(composer.value),
            note: composer.text,
            health_state: composer.health_state,
            author: composer.author || session?.user?.phone || 'team',
          }),
        });
        applyProject(data);
      } else {
        const data = await api(`/api/projects/${projectId}/wigs/${wig.id}/lead-measures/${measure.id}/comments`, {
          method: 'POST',
          body: JSON.stringify({
            comment: composer.text,
            health_state: composer.health_state,
            author: composer.author || session?.user?.phone || 'team',
          }),
        });
        applyProject(data);
      }
      setComposer(prev => ({ ...prev, text: '' }));
      await loadBundle();
      await reload();
    }, composer.mode === 'progress' ? 'Progress posted' : 'Comment posted');
  }

  /* ── Evidence / approvals / meetings ── */
  function submitEvidence(e) {
    e.preventDefault();
    run(async () => {
      const data = await api('/api/documents', {
        method: 'POST',
        body: JSON.stringify({ ...evidenceDraft, project_id: projectId, wig_id: wig.id, measure_id: measure.id }),
      });
      setBundle(prev => ({
        ...(prev || {}),
        project: data.project,
        documents: [data.document, ...((prev?.documents || []).filter(doc => doc._id !== data.document._id))],
      }));
      setModal(null);
      await reload();
    }, 'Evidence attached');
  }

  function uploadEvidence(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    run(async () => {
      const data = new FormData();
      data.append('project_id', projectId);
      data.append('wig_id', wig.id);
      data.append('measure_id', measure.id);
      data.append('document_type', 'Uploaded File');
      data.append('file', file);
      const result = await api('/api/documents/upload', { method: 'POST', body: data });
      setBundle(prev => ({
        ...(prev || {}),
        project: result.project,
        documents: [result.document, ...((prev?.documents || []).filter(doc => doc._id !== result.document._id))],
      }));
      setModal(null);
      await reload();
    }, 'File uploaded & summarised');
  }

  function openApproval() {
    setApprovalDraft({ title: `Approval required: ${measure.title}`, requested_by: session?.user?.phone || '', summary: '', due_date: measure.deadline || '' });
    setModal('approval');
  }

  function submitApproval(e) {
    e.preventDefault();
    run(async () => {
      await api('/api/approvals', {
        method: 'POST',
        body: JSON.stringify({ ...approvalDraft, project_id: projectId, wig_id: wig.id, measure_id: measure.id }),
      });
      setModal(null);
      await loadBundle();
      await reload();
    }, 'Approval requested');
  }

  function updateApprovalStatus(approvalId, status) {
    run(async () => {
      await api(`/api/approvals/${approvalId}/status?status=${encodeURIComponent(status)}`, { method: 'PUT' });
      await loadBundle();
      await reload();
    }, `Approval ${status.toLowerCase()}`);
  }

  function submitMeeting(e) {
    e.preventDefault();
    run(async () => {
      await api('/api/weekly-meetings', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          meeting_date: meetingDraft.meeting_date,
          facilitator: meetingDraft.facilitator,
          notes: meetingDraft.notes,
          commitments: meetingDraft.commitments.split('\n').map(v => v.trim()).filter(Boolean),
        }),
      });
      setMeetingDraft({ meeting_date: '', facilitator: '', notes: '', commitments: '' });
      setModal(null);
      await loadBundle();
    }, 'Meeting logged');
  }

  if (!project) {
    return (
      <section className="pw">
        <div className="skeleton" style={{ height: 44, marginBottom: 14 }} />
        <div className="skeleton" style={{ height: 180, borderRadius: 18, marginBottom: 14 }} />
        <div className="skeleton" style={{ height: 320, borderRadius: 18 }} />
      </section>
    );
  }

  const goProjectHome = () => { setMeasureId(null); setWigId(null); };
  const goWigHome = () => setMeasureId(null);
  const goBackOneLevel = () => {
    if (measure) setMeasureId(null);
    else if (wig) setWigId(null);
    else onExit();
  };

  const slide = {
    initial: { opacity: 0, x: 26 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -26 },
    transition: { duration: 0.22, ease: [0.32, 0.72, 0, 1] },
  };
  const activeWigForPanel = wig || wigs[0] || null;
  const activePanelMeasures = (activeWigForPanel?.lead_measures || []).filter(item => !item.archived_at);
  const allMeasures = wigs.flatMap(item => (item.lead_measures || []).filter(measureItem => !measureItem.archived_at).map(measureItem => ({ ...measureItem, wig_id: item.id, wig_title: item.title })));
  const docsByMeasure = new Set((bundle?.documents || []).map(doc => doc.measure_id).filter(Boolean));
  const missingEvidence = allMeasures.filter(item => !docsByMeasure.has(item.id));
  const overdueMeasures = allMeasures.filter(item => isEntityOverdue(item));
  const measurePct = measure ? progressPercent(measure.from_value, measure.to_value, measure.current_value ?? measure.from_value) : 0;
  const measurePendingApprovals = measureApprovals.filter(item => item.status === 'Pending');
  const measureApprovedApprovals = measureApprovals.filter(item => item.status !== 'Pending');
  const nextMeasureAction = measurePendingApprovals.length
    ? 'Approve pending authority action or request additional evidence.'
    : missingEvidence.some(item => item.id === measure?.id)
      ? 'Attach evidence before the next review cycle.'
      : measurePct < 70
        ? 'Update progress and capture the blocker owner.'
        : 'Keep cadence active and prepare closure evidence.';

  return (
    <section className="pw">
      <div className="pw-topbar">
        <div className="pw-topbar-nav">
          <button className="icon-btn pw-back-btn" onClick={goBackOneLevel} aria-label="Back one level"><ArrowLeft size={17} /></button>
          <WorkspaceHierarchyNav
            level={level}
            project={project}
            wig={wig}
            measure={measure}
            onExit={onExit}
            onProjectHome={goProjectHome}
            onWigHome={goWigHome}
          />
        </div>
        <div className="pw-topbar-right">
          <button className="ghost-btn" onClick={loadBundle}><RefreshCw size={14} /> Refresh</button>
          {canEdit && level === 'project' && <button className="ghost-btn" onClick={() => setModal('meeting')}><CalendarClock size={14} /> Log WIG session</button>}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {level !== 'measure' && (
          <motion.div key={`operations-${level}-${activeWigForPanel?.id || 'project'}`} {...slide}>
            <div className="workspace-title-row">
              <div className="page-breadcrumbs">
                <button type="button" onClick={goProjectHome}>Projects</button>
                <ChevronRight size={13} />
                <button type="button">{project.ministry}</button>
                <ChevronRight size={13} />
                <span>{project.name}</span>
              </div>
              <h1>Project Workspace</h1>
              <p>Real-time execution view for project, WIGs, lead measures and decisions.</p>
            </div>
            <section className="ops-hero card">
              <div className="ops-project-icon">
                <Building2 size={24} />
              </div>
              <div className="ops-project-title">
                <span>{level === 'wig' ? 'Selected WIG' : 'Project'}</span>
                <h1>{project.name}</h1>
                <p>{project.ministry} Department · {project.owner || 'Mission Director'}</p>
              </div>
              <div className="ops-metric">
                <span>Current</span>
                <strong>{currentStateText(level === 'wig' ? activeWigForPanel : project)}</strong>
              </div>
              <div className="ops-metric">
                <span>Target</span>
                <strong>{targetStateText(level === 'wig' ? activeWigForPanel : project)}</strong>
              </div>
              <div className="ops-metric">
                <span>Deadline</span>
                <strong>{deadlineText(level === 'wig' ? activeWigForPanel : project)}</strong>
              </div>
              <div className="ops-health">
                <span>Health</span>
                <strong>{level === 'wig' ? progressPercent(activeWigForPanel?.from_value, activeWigForPanel?.to_value, activeWigForPanel?.current_value ?? activeWigForPanel?.from_value) : project.health_score}%</strong>
                <small>{level === 'wig' ? 'WIG execution' : project.status}</small>
              </div>
              <button className="ops-next-action" type="button" onClick={() => openContextualInsight(level === 'wig' ? 'wig' : 'project')}>
                <Sparkles size={16} />
                <span>Recommended Next Action</span>
                <strong>{autoInsight?.result?.recommendations?.[0] || autoInsight?.result?.summary || 'Review blocked lead measures and evidence gaps.'}</strong>
                <ChevronRight size={18} />
              </button>
            </section>

            <section className="ops-grid">
              <aside className="ops-card card">
                <div className="ops-card-head">
                  <div>
                    <h2>WIGs / Milestones</h2>
                    <p>{wigs.length} active milestones</p>
                  </div>
                  {canEdit && <button className="ghost-btn" onClick={openAddWig}><Plus size={14} /> Add WIG</button>}
                </div>
                <div className="ops-wig-list">
                  {wigs.map((item, index) => {
                    const selected = activeWigForPanel?.id === item.id;
                    const itemMeasures = (item.lead_measures || []).filter(measureItem => !measureItem.archived_at);
                    return (
                      <button className={`ops-wig-item ${selected ? 'active' : ''}`} type="button" key={item.id} onClick={() => setWigId(item.id)}>
                        <span className={`ops-status-dot ${measureState(item)}`} />
                        <div>
                          <strong>{item.title}</strong>
                          <small>{currentStateText(item)} → {targetStateText(item)} by {deadlineText(item)}</small>
                        </div>
                        <em>{itemMeasures.length}<small>Lead Measures</small></em>
                        <ChevronRight size={16} />
                      </button>
                    );
                  })}
                  {wigs.length === 0 && <p className="ops-empty">No WIGs yet.</p>}
                </div>
                <button className="ops-link" type="button" onClick={goProjectHome}>View all WIGs</button>
              </aside>

              <main className="ops-card card">
                <div className="ops-card-head">
                  <div>
                    <span>Selected WIG</span>
                    <h2>{activeWigForPanel?.title || 'Select a WIG'}</h2>
                    <p>{activeWigForPanel ? `${currentStateText(activeWigForPanel)} → ${targetStateText(activeWigForPanel)} by ${deadlineText(activeWigForPanel)}` : 'Choose a milestone from the left.'}</p>
                  </div>
                  {canEdit && activeWigForPanel && (
                    <div className="ops-actions">
                      <button className="ghost-btn" onClick={() => { setWigId(activeWigForPanel.id); openEditWig(); }}><Pencil size={14} /> WIG Details</button>
                      <button className="primary-btn" onClick={() => { setWigId(activeWigForPanel.id); openAddMeasure(); }}><Plus size={14} /> Add Lead Measure</button>
                    </div>
                  )}
                </div>
                {activeWigForPanel && (
                  <div className="wig-state-pair">
                    <div>
                      <span>Current State (Real World)</span>
                      <strong>{currentStateText(activeWigForPanel)}</strong>
                    </div>
                    <div>
                      <span>Target State (Real World)</span>
                      <strong>{targetStateText(activeWigForPanel)}</strong>
                    </div>
                  </div>
                )}
                <div className="ops-lead-timeline">
                  {activePanelMeasures.map((item, index) => {
                    const pct = progressPercent(item.from_value, item.to_value, item.current_value ?? item.from_value);
                    const missingDoc = !docsByMeasure.has(item.id);
                    return (
                      <article className="ops-lead-row" key={item.id}>
                        <span className="ops-step">{index + 1}</span>
                        <button type="button" className="ops-lead-main" onClick={() => { setWigId(activeWigForPanel.id); setMeasureId(item.id); }}>
                          <div>
                            <strong>{item.title}</strong>
                            <small>{item.assigned_to?.join(', ') || 'Owner pending'}</small>
                          </div>
                          <HealthBadge state={measureState(item)} />
                          <span><b>Current</b>{currentStateText(item)}</span>
                          <span><b>Target</b>{targetStateText(item)}</span>
                          <span><b>Deadline</b>{deadlineText(item)}</span>
                        </button>
                        <div className="ops-progress">
                          <div><em style={{ width: `${pct}%`, background: scoreColor(pct) }} /></div>
                          <small>{pct}%</small>
                        </div>
                        <div className="ops-row-actions">
                          {missingDoc && <button className="ghost-btn" type="button" onClick={() => { setWigId(activeWigForPanel.id); setMeasureId(item.id); setModal('evidence'); }}><Paperclip size={13} /> Evidence</button>}
                          {canEdit && <button className="ghost-btn" type="button" onClick={() => { setWigId(activeWigForPanel.id); setMeasureId(item.id); openApproval(); }}><Send size={13} /> Approval</button>}
                          <button className="primary-btn compact" type="button" onClick={() => { setWigId(activeWigForPanel.id); setMeasureId(item.id); }}>Open</button>
                        </div>
                      </article>
                    );
                  })}
                  {activePanelMeasures.length === 0 && <p className="ops-empty">No lead measures under this WIG yet.</p>}
                </div>
              </main>

              <aside className="ops-card card">
                <div className="ops-card-head compact">
                  <div>
                    <h2>Open Items</h2>
                    <p>Actionable blockers</p>
                  </div>
                </div>
                <div className="ops-open-stack">
                  <div className="ops-open-item approval">
                    <span><FileText size={18} /> Pending Approvals</span>
                    <strong>{pendingApprovals.length}</strong>
                    {(pendingApprovals || []).slice(0, 2).map(item => <small key={item._id}>{item.title}</small>)}
                  </div>
                  <div className="ops-open-item evidence">
                    <span><Paperclip size={18} /> Missing Evidence</span>
                    <strong>{missingEvidence.length}</strong>
                    {missingEvidence.slice(0, 3).map(item => <small key={item.id}>{item.title}</small>)}
                  </div>
                  <div className="ops-open-item overdue">
                    <span><AlertTriangle size={18} /> Overdue Updates</span>
                    <strong>{overdueMeasures.length}</strong>
                    {overdueMeasures.slice(0, 3).map(item => <small key={item.id}>{item.title}</small>)}
                  </div>
                  <button className="ops-view-all" type="button" onClick={() => openContextualInsight('project')}>View AI Recommendation <ChevronRight size={15} /></button>
                </div>
              </aside>
            </section>
            <section className="workspace-bottom card">
              <div className="workspace-tabs">
                <button className="active">Timeline</button>
                <button>Evidence ({bundle?.documents?.length || 0})</button>
                <button>Approvals ({bundle?.approvals?.length || 0})</button>
                <button>Decisions ({bundle?.decisions?.length || 0})</button>
              </div>
              <div className="workspace-bottom-grid">
                <div className="workspace-timeline-list">
                  {(bundle?.activity || []).slice(0, 3).map((item, index) => (
                    <div key={`${item.type}-${index}`}>
                      <span className={`timeline-dot ${index === 0 ? 'red' : index === 1 ? 'orange' : 'blue'}`} />
                      <small>{item.created_at ? formatDate(item.created_at, locale) : 'Recent'}</small>
                      <strong>{item.title || item.action || item.type}</strong>
                      <p>{item.comment || item.summary || item.description || 'Execution update recorded.'}</p>
                    </div>
                  ))}
                  {!(bundle?.activity || []).length && <p className="ops-empty">Timeline events will appear as updates are posted.</p>}
                </div>
                <AutoInsightCard
                  insight={autoInsight}
                  scope={level === 'wig' ? 'wig' : 'project'}
                  onOpen={() => openContextualInsight(level === 'wig' ? 'wig' : 'project')}
                  onRefresh={() => loadAutoInsight(level === 'wig' ? 'wig' : 'project')}
                  locale={locale}
                />
              </div>
            </section>
          </motion.div>
        )}

        {level === 'measure' && (
          <motion.div key={`measure-cockpit-${measure.id}`} {...slide}>
            <section className="lm-header card">
              <div className="lm-title-block">
                <div className="lm-breadcrumb">Projects <ChevronRight size={12} /> {project.name} <ChevronRight size={12} /> Lead Measure</div>
                <h1>{measure.title}</h1>
                <div className="lm-tags">
                  <span>Lead Measure</span>
                  <span>ID: {measure.id?.slice(0, 8) || 'LM'}</span>
                  <span>Owner: {measure.assigned_to?.join(', ') || 'Owner pending'}</span>
                </div>
              </div>
              <div className="lm-actions">
                {canEdit && <button className="ghost-btn" onClick={() => { setEvidenceDraft({ title: '', document_type: 'Progress Note', content: '' }); setModal('evidence'); }}><Paperclip size={15} /> Add Evidence</button>}
                {canEdit && <button className="primary-btn" onClick={openApproval}><Send size={15} /> Request New Approval</button>}
                {canEdit && <button className="icon-btn" onClick={openEditMeasure}><Pencil size={15} /></button>}
              </div>
            </section>

            <section className="lm-summary-grid">
              <div className="lm-summary-card card"><span>Project Name</span><strong>{project.name}</strong><small>{project.ministry} Department</small></div>
              <div className="lm-summary-card card"><span>WIG / Milestone</span><strong>{wig.title}</strong><small>{currentStateText(wig)} → {targetStateText(wig)}</small></div>
              <div className="lm-summary-card card blue"><span>Current</span><strong>{currentStateText(measure)}</strong><small>{measure.current_value ?? measure.from_value} / {measure.to_value} {measure.unit}</small></div>
              <div className="lm-summary-card card"><span>Target</span><strong>{targetStateText(measure)}</strong><small>By {deadlineText(measure)}</small></div>
              <div className="lm-summary-card card"><span>Deadline</span><strong>{deadlineText(measure)}</strong><small>{isEntityOverdue(measure) ? 'Overdue' : 'Active timeline'}</small></div>
              <div className="lm-summary-card card"><span>Health</span><strong><HealthBadge state={measureState(measure)} /></strong><small>{measurePct}% complete</small></div>
            </section>

            <AutoInsightCard
              insight={autoInsight}
              scope="measure"
              onOpen={() => openContextualInsight('measure')}
              onRefresh={() => loadAutoInsight('measure')}
              locale={locale}
            />

            <section className="lm-main-grid">
              <div className="card approval-pipeline">
                <div className="ops-card-head">
                  <div>
                    <h2>Approval Pipeline</h2>
                    <p>Track and act on approvals required to reach the target.</p>
                  </div>
                  {canEdit && <button className="ghost-btn" onClick={openApproval}>Request Approval</button>}
                </div>
                <div className="pipeline-stage requested">
                  <span><Send size={17} /></span>
                  <div>
                    <h3>Requested</h3>
                    <small>{measurePendingApprovals.length} pending</small>
                  </div>
                  <div className="pipeline-list">
                    {measurePendingApprovals.map(item => (
                      <article key={item._id} className="pipeline-item pending" id={`approval-${item._id}`}>
                        <div>
                          <strong>{item.title}</strong>
                          <p>{item.summary || 'Approval note pending.'}</p>
                          <small>Requested by {item.requested_by} · Due {item.due_date || 'not set'}</small>
                        </div>
                        {canEdit && (
                          <div className="pipeline-actions">
                            <button className="ghost-btn" onClick={() => updateApprovalStatus(item._id, 'Approved')}><Check size={14} /> Approve</button>
                            <button className="ghost-btn danger" onClick={() => updateApprovalStatus(item._id, 'Rejected')}><ArrowLeft size={14} /> Return</button>
                          </div>
                        )}
                      </article>
                    ))}
                    {measurePendingApprovals.length === 0 && <p className="ops-empty">No approval is pending for this lead measure.</p>}
                  </div>
                </div>
                <div className="pipeline-stage approved">
                  <span><Check size={17} /></span>
                  <div>
                    <h3>Approved / Closed</h3>
                    <small>{measureApprovedApprovals.length} completed</small>
                  </div>
                  <div className="pipeline-list">
                    {measureApprovedApprovals.slice(0, 3).map(item => (
                      <article key={item._id} className="pipeline-item approved">
                        <strong>{item.title}</strong>
                        <small>{item.status} · {item.updated_at ? formatEventDate(item.updated_at) : 'updated'}</small>
                      </article>
                    ))}
                  </div>
                </div>
              </div>

              <aside className="lm-side-stack">
                <div className="card impact-card">
                  <h2>What this approval affects</h2>
                  <div className="impact-meter"><div><em style={{ width: `${measurePct}%` }} /></div><strong>{measurePct}%</strong></div>
                  <p>{nextMeasureAction}</p>
                </div>
                <div className="card evidence-side">
                  <div className="ops-card-head compact">
                    <div>
                      <h2>Linked Evidence ({measureDocs.length})</h2>
                      <p>AI summaries from attached documents.</p>
                    </div>
                  </div>
                  {measureDocs.slice(0, 3).map(doc => <EvidenceSummaryCard key={doc._id} doc={doc} />)}
                  {measureDocs.length === 0 && <p className="ops-empty">No evidence attached yet.</p>}
                  {canEdit && <button className="ghost-btn full" onClick={() => { setEvidenceDraft({ title: '', document_type: 'Progress Note', content: '' }); setModal('evidence'); }}>Attach Evidence</button>}
                </div>
              </aside>
            </section>

            {canEdit && (
              <form className="pw-composer card" onSubmit={submitComposer}>
                <div className="pw-segment">
                  <button type="button" className={composer.mode === 'progress' ? 'active' : ''} onClick={() => setComposer({ ...composer, mode: 'progress' })}><TrendingUp size={14} /> Progress</button>
                  <button type="button" className={composer.mode === 'comment' ? 'active' : ''} onClick={() => setComposer({ ...composer, mode: 'comment' })}><MessageSquare size={14} /> Comment</button>
                </div>
                <div className="pw-composer-fields">
                  <div className="pw-composer-row">
                    {composer.mode === 'progress' && (
                      <label className="field pw-composer-value">
                        <span>New value ({measure.unit})</span>
                        <ProgressSlider from={measure.from_value} to={measure.to_value} unit={measure.unit} value={composer.value} onChange={v => setComposer({ ...composer, value: v })} />
                      </label>
                    )}
                    <label className="field"><span>Health</span><select value={composer.health_state} onChange={e => setComposer({ ...composer, health_state: e.target.value })}><option>green</option><option>amber</option><option>red</option><option>blocker</option><option>approval</option><option>hold</option></select></label>
                    <label className="field"><span>Author</span><input value={composer.author} onChange={e => setComposer({ ...composer, author: e.target.value })} required /></label>
                  </div>
                  <label className="field pw-composer-text"><span>{composer.mode === 'progress' ? 'Action taken / note' : 'Comment'}</span><textarea className="pw-composer-textarea" value={composer.text} onChange={e => setComposer({ ...composer, text: e.target.value })} required={composer.mode === 'comment'} rows={3} /></label>
                  <div className="pw-composer-actions"><button className="primary-btn" disabled={busy}>{composer.mode === 'progress' ? 'Post progress' : 'Post comment'}</button></div>
                </div>
              </form>
            )}

            <section className="card execution-timeline">
              <div className="ops-card-head">
                <div>
                  <h2>Execution Timeline</h2>
                  <p>Key activities and updates for this lead measure.</p>
                </div>
                <button className="ghost-btn" onClick={() => setActivitySort(s => s === 'latest' ? 'oldest' : 'latest')}><ArrowUpDown size={14} /> {activitySort === 'latest' ? 'Latest' : 'Oldest'}</button>
              </div>
              <div className="timeline-strip">
                {activity.map(event => (
                  <article className="timeline-card" key={event.id}>
                    <span className={`activity-dot ${event.state || 'green'}`} />
                    <time>{formatEventDate(event.created_at || event.due_date)}</time>
                    <strong>{event.title}</strong>
                    {event.body && <p className="formatted-text">{event.body}</p>}
                    {event.actor && <small>by {event.actor}</small>}
                  </article>
                ))}
                {activity.length === 0 && <p className="ops-empty">No activity has been captured yet.</p>}
              </div>
            </section>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="legacy-workspace">
      <AnimatePresence mode="wait">
        {level === 'project' && (
          <motion.div key="project" {...slide}>
            <header className="pw-hero card">
              <div className="pw-hero-main">
                <span className="pw-kicker">{project.ministry} · {project.owner || 'Owner not assigned'}</span>
                <h1>{project.name}</h1>
                <div className="pw-hero-meta">
                  {canEdit ? (
                    <label className="prio-edit" title="Project priority">
                      <PriorityChip value={project.priority} />
                      <select value={project.priority ?? 5} onChange={e => changeProjectPriority(e.target.value)} aria-label="Project priority">
                        {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>P{p}</option>)}
                      </select>
                    </label>
                  ) : (
                    <PriorityChip value={project.priority} />
                  )}
                  <span className={`status-badge ${project.status === 'On Track' ? 'on-track' : project.status === 'At Risk' ? 'at-risk' : 'off-track'}`}>{project.status}</span>
                  <span>Due {deadlineText(project)}</span>
                  <span>{project.phase || 'Execution'}</span>
                </div>
                <StatePair entity={project} />
              </div>
              <div className="pw-hero-side">
                <div className="health-ring small" style={{ '--score': `${(project.health_score || 0) * 3.6}deg`, '--ring-color': scoreColor(project.health_score || 0) }}>
                  <strong>{project.health_score}%</strong>
                </div>
                <small>Health</small>
                <div className="pw-hero-actions">
                  <button className="ghost-btn ai-insight-btn" type="button" onClick={() => openContextualInsight('project')}>
                    <Brain size={14} /> {t('aiInsight', locale)}
                  </button>
                  {canEdit && (
                    <button className="ghost-btn mta-btn" type="button" onClick={onOpenMeetingToAction}>
                      <ClipboardList size={14} /> {t('meetingToAction', locale)}
                    </button>
                  )}
                </div>
              </div>
            </header>
            <AutoInsightCard
              insight={autoInsight}
              scope="project"
              onOpen={() => openContextualInsight('project')}
              onRefresh={() => loadAutoInsight('project')}
              locale={locale}
            />

            <div className="pw-chips">
              <span><b>{wigs.length}</b> WIGs</span>
              <span><b>{countMeasures(project)}</b> Lead measures</span>
              <span><b>{pendingApprovals.length}</b> Pending approvals</span>
              <span><b>{formatBudgetCr(budget.spent)}</b> spent</span>
              <span><b>{formatBudgetCr(budget.allocated)}</b> WIG budget</span>
            </div>
            {budget.total > 0 && (
              <BudgetBar label="Project budget" allocated={budget.allocated} total={budget.total} spent={budget.spent} warn={budget.overAllocated} />
            )}

            <div className="pw-columns">
              <div className="pw-main">
                <div className="pw-section-head">
                  <h2>Wildly Important Goals</h2>
                  {canEdit && <button className="primary-btn" onClick={openAddWig}><Plus size={15} /> Add WIG</button>}
                </div>
                <div className="pw-wig-list">
                  {wigs.map((item, index) => {
                    const wigMeasures = (item.lead_measures || []).filter(m => !m.archived_at);
                    const pct = progressPercent(item.from_value, item.to_value, item.current_value ?? item.from_value);
                    const editing = quickEdit?.kind === 'wig' && quickEdit?.id === item.id;
                    return (
                      <div className={`pw-wig-card card ${editing ? 'editing' : ''}`} key={item.id}>
                        <button className="pw-wig-open" type="button" onClick={() => setWigId(item.id)}>
                          <span className="pw-wig-index">{String(index + 1).padStart(2, '0')}</span>
                          <div className="pw-wig-body">
                            <strong><PriorityChip value={item.priority} /> {item.title}</strong>
                            <small>{item.owner || 'Owner not assigned'} · {formatFreqLabel(item.update_frequency)} updates · Due {deadlineText(item)} · {formatBudgetCr(item.budget_allocated)} · {wigMeasures.length} measures</small>
                            <OverdueBadge entity={item} />
                            <div className="pw-meter">
                              <div className="pw-meter-track"><em style={{ width: `${pct}%`, background: scoreColor(pct) }} /></div>
                            </div>
                          </div>
                        </button>
                        <div className="pw-wig-pct">
                          {editing ? (
                            <div className="pw-quick-edit" onClick={e => e.stopPropagation()}>
                              <ProgressSlider
                                compact
                                from={item.from_value}
                                to={item.to_value}
                                unit={item.unit}
                                value={quickEdit.value}
                                onChange={v => setQuickEdit({ id: item.id, value: v, kind: 'wig' })}
                              />
                              <button className="icon-btn ok" disabled={busy} onClick={() => submitQuickWigUpdate(item)} title="Save"><Check size={14} /></button>
                              <button className="icon-btn" onClick={() => setQuickEdit(null)} title="Cancel"><X size={14} /></button>
                            </div>
                          ) : (
                            <>
                              <span style={{ color: scoreColor(pct) }}>{pct}%</span>
                              {canEdit && (
                                <button className="icon-btn pw-quick-btn" title="Quick WIG progress update" onClick={e => { e.stopPropagation(); setQuickEdit({ id: item.id, value: item.current_value ?? item.from_value, kind: 'wig' }); }}>
                                  <Pencil size={13} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                        <ChevronRight size={18} className="pw-wig-chevron" onClick={() => setWigId(item.id)} />
                      </div>
                    );
                  })}
                  {wigs.length === 0 && <p className="empty-state card">No WIGs yet. {canEdit ? 'Add the first Wildly Important Goal.' : ''}</p>}
                </div>
              </div>

              <aside className="pw-rail">
                <div className="card pw-rail-card" id="pw-approvals-rail">
                  <h3><Gavel size={15} /> Approvals</h3>
                  {(bundle?.approvals || []).slice(0, 5).map(item => (
                    <div className="pw-rail-row" key={item._id} id={`approval-${item._id}`}>
                      <div>
                        <strong>{item.title}</strong>
                        <small>{item.status}{item.due_date ? ` · due ${item.due_date}` : ''}</small>
                      </div>
                      {canEdit && item.status === 'Pending' && (
                        <div className="pw-rail-actions">
                          <button className="icon-btn ok" title="Approve" onClick={() => updateApprovalStatus(item._id, 'Approved')}><Check size={14} /></button>
                          <button className="icon-btn danger" title="Reject" onClick={() => updateApprovalStatus(item._id, 'Rejected')}><X size={14} /></button>
                        </div>
                      )}
                    </div>
                  ))}
                  {(bundle?.approvals || []).length === 0 && <p className="pw-rail-empty">Nothing awaiting approval.</p>}
                </div>
                <div className="card pw-rail-card">
                  <h3><CalendarClock size={15} /> WIG sessions</h3>
                  {(bundle?.meetings || []).slice(0, 4).map(item => (
                    <div className="pw-rail-row" key={item._id}>
                      <div>
                        <strong>{item.meeting_date}</strong>
                        <small>{item.facilitator}</small>
                      </div>
                    </div>
                  ))}
                  {(bundle?.meetings || []).length === 0 && <p className="pw-rail-empty">No sessions logged yet.</p>}
                </div>
                <div className="card pw-rail-card">
                  <h3><Bell size={15} /> Alerts</h3>
                  {(bundle?.notifications || []).slice(0, 4).map(item => (
                    <div className="pw-rail-row" key={item._id}>
                      <div>
                        <strong>{item.title}</strong>
                        <small>{item.severity}</small>
                      </div>
                    </div>
                  ))}
                  {(bundle?.notifications || []).length === 0 && <p className="pw-rail-empty">No alerts right now.</p>}
                </div>
              </aside>
            </div>
          </motion.div>
        )}

        {level === 'wig' && (
          <motion.div key={`wig-${wig.id}`} {...slide}>
            <header className="pw-hero card">
              <div className="pw-hero-main">
                <span className="pw-kicker">WIG · {project.name}</span>
                <h1>{wig.title}</h1>
                <div className="pw-hero-meta">
                  <PriorityChip value={wig.priority} />
                  <OverdueBadge entity={wig} />
                  <span>{wig.owner || 'Owner not assigned'}</span>
                  <span>{formatFreqLabel(wig.update_frequency)} updates</span>
                  <span>Due {deadlineText(wig)}</span>
                  <span>{formatBudgetCr(wig.budget_allocated)} budget</span>
                </div>
                <StatePair entity={wig} />
              </div>
              <div className="pw-hero-side wide">
                <ProgressMeter from={wig.from_value} to={wig.to_value} current={wig.current_value} unit={wig.unit} large />
                <div className="pw-hero-actions">
                  <button className="ghost-btn ai-insight-btn" type="button" onClick={() => openContextualInsight('wig')}>
                    <Brain size={14} /> {t('aiInsight', locale)}
                  </button>
                  {canEdit && (
                    <>
                      <button className="ghost-btn" onClick={openEditWig}><Pencil size={14} /> Edit</button>
                      <button className="ghost-btn danger" onClick={() => archiveWig(wig)}><Archive size={14} /> Archive</button>
                    </>
                  )}
                </div>
              </div>
            </header>
            <AutoInsightCard
              insight={autoInsight}
              scope="wig"
              onOpen={() => openContextualInsight('wig')}
              onRefresh={() => loadAutoInsight('wig')}
              locale={locale}
            />
            {wigBudget.total > 0 && (
              <BudgetBar label="WIG budget" allocated={wigBudget.allocated} total={wigBudget.total} warn={wigBudget.overAllocated} />
            )}

            <div className="pw-section-head">
              <h2>Lead measures</h2>
              {canEdit && <button className="primary-btn" onClick={openAddMeasure}><Plus size={15} /> Add lead measure</button>}
            </div>

            <div className="pw-measure-list">
              {measures.map(item => {
                const pct = progressPercent(item.from_value, item.to_value, item.current_value ?? item.from_value);
                const editing = quickEdit?.kind !== 'wig' && quickEdit?.id === item.id;
                return (
                  <div className={`pw-measure-row card ${editing ? 'editing' : ''}`} key={item.id}>
                    <span className={`timeline-dot ${measureState(item)}`} />
                    <button className="pw-measure-main" onClick={() => setMeasureId(item.id)}>
                      <strong><PriorityChip value={item.priority} /> {item.title}</strong>
                      <small>{item.assigned_to?.join(', ') || 'Unassigned'} · Due {deadlineText(item)} · {formatBudgetCr(item.budget_allocated)} · {item.comments?.length || 0} comments</small>
                      <OverdueBadge entity={item} />
                      <div className="pw-meter">
                        <div className="pw-meter-track"><em style={{ width: `${pct}%`, background: scoreColor(pct) }} /></div>
                      </div>
                    </button>
                    <div className="pw-measure-value">
                      {editing ? (
                        <div className="pw-quick-edit">
                          <ProgressSlider
                            compact
                            from={item.from_value}
                            to={item.to_value}
                            unit={item.unit}
                            value={quickEdit.value}
                            onChange={v => setQuickEdit({ id: item.id, value: v, kind: 'measure' })}
                          />
                          <button className="icon-btn ok" disabled={busy} onClick={() => submitQuickUpdate(wig, item)} title="Save"><Check size={14} /></button>
                          <button className="icon-btn" onClick={() => setQuickEdit(null)} title="Cancel"><X size={14} /></button>
                        </div>
                      ) : (
                        <>
                          <strong style={{ color: scoreColor(pct) }}>{item.current_value ?? item.from_value}</strong>
                          <small>of {item.to_value} {item.unit}</small>
                          {canEdit && (
                            <button className="icon-btn pw-quick-btn" title="Quick progress update" onClick={() => setQuickEdit({ id: item.id, value: item.current_value ?? item.from_value, kind: 'measure' })}>
                              <Pencil size={13} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    <ChevronRight size={17} className="pw-wig-chevron" onClick={() => setMeasureId(item.id)} />
                  </div>
                );
              })}
              {measures.length === 0 && <p className="empty-state card">No lead measures yet for this WIG.</p>}
            </div>
          </motion.div>
        )}

        {level === 'measure' && (
          <motion.div key={`measure-${measure.id}`} {...slide}>
            <header className="pw-hero card">
              <div className="pw-hero-main">
                <span className="pw-kicker">Lead measure · {wig.title}</span>
                <h1>{measure.title}</h1>
                <div className="pw-hero-meta">
                  <PriorityChip value={measure.priority} />
                  <OverdueBadge entity={measure} />
                  <HealthBadge state={measureState(measure)} />
                  <span>{measure.assigned_to?.join(', ') || 'Unassigned'}</span>
                  <span>Due {deadlineText(measure)}</span>
                  <span>Status {measure.status || 'Open'}</span>
                </div>
                <StatePair entity={measure} />
              </div>
              <div className="pw-hero-side wide">
                <ProgressMeter from={measure.from_value} to={measure.to_value} current={measure.current_value} unit={measure.unit} large />
                <div className="pw-hero-actions">
                  <button className="ghost-btn ai-insight-btn" type="button" onClick={() => openContextualInsight('measure')}>
                    <Brain size={14} /> {t('aiInsight', locale)}
                  </button>
                  {canEdit && (
                    <>
                      <button className="ghost-btn" onClick={openEditMeasure}><Pencil size={14} /> Edit</button>
                      <button className="ghost-btn" onClick={openApproval}><Gavel size={14} /> Approval</button>
                      <button className="ghost-btn" onClick={() => { setEvidenceDraft({ title: '', document_type: 'Progress Note', content: '' }); setModal('evidence'); }}><Paperclip size={14} /> Evidence</button>
                      <button className="ghost-btn danger" onClick={() => archiveMeasure(measure)}><Archive size={14} /> Archive</button>
                    </>
                  )}
                </div>
              </div>
            </header>
            <AutoInsightCard
              insight={autoInsight}
              scope="measure"
              onOpen={() => openContextualInsight('measure')}
              onRefresh={() => loadAutoInsight('measure')}
              locale={locale}
            />

            {canEdit && (
              <form className="pw-composer card" onSubmit={submitComposer}>
                <div className="pw-segment">
                  <button type="button" className={composer.mode === 'progress' ? 'active' : ''} onClick={() => setComposer({ ...composer, mode: 'progress' })}><TrendingUp size={14} /> Progress</button>
                  <button type="button" className={composer.mode === 'comment' ? 'active' : ''} onClick={() => setComposer({ ...composer, mode: 'comment' })}><MessageSquare size={14} /> Comment</button>
                </div>
                <div className="pw-composer-fields">
                  <div className="pw-composer-row">
                    {composer.mode === 'progress' && (
                      <label className="field pw-composer-value">
                        <span>New value ({measure.unit})</span>
                        <ProgressSlider
                          from={measure.from_value}
                          to={measure.to_value}
                          unit={measure.unit}
                          value={composer.value}
                          onChange={v => setComposer({ ...composer, value: v })}
                        />
                      </label>
                    )}
                    <label className="field">
                      <span>Health</span>
                      <select value={composer.health_state} onChange={e => setComposer({ ...composer, health_state: e.target.value })}>
                        <option>green</option><option>amber</option><option>red</option><option>blocker</option><option>approval</option><option>hold</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Author</span>
                      <input value={composer.author} onChange={e => setComposer({ ...composer, author: e.target.value })} required />
                    </label>
                  </div>
                  <label className="field pw-composer-text">
                    <span>{composer.mode === 'progress' ? 'Note (optional)' : 'Comment'}</span>
                    <textarea
                      className="pw-composer-textarea"
                      value={composer.text}
                      onChange={e => setComposer({ ...composer, text: e.target.value })}
                      placeholder={composer.mode === 'progress' ? 'What moved? Line breaks and lists are preserved.' : 'Share an update with the team — formatting is preserved.'}
                      required={composer.mode === 'comment'}
                      rows={4}
                    />
                  </label>
                  <div className="pw-composer-actions">
                    <button className="primary-btn" disabled={busy}>{composer.mode === 'progress' ? 'Post progress' : 'Post comment'}</button>
                  </div>
                </div>
              </form>
            )}

            <div className="pw-tabs">
              <div className="pw-segment large">
                <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}><Activity size={14} /> Activity ({activity.length})</button>
                <button className={tab === 'evidence' ? 'active' : ''} onClick={() => setTab('evidence')}><Paperclip size={14} /> Evidence ({measureDocs.length})</button>
                <button className={tab === 'approvals' ? 'active' : ''} onClick={() => setTab('approvals')}><Gavel size={14} /> Approvals ({measureApprovals.length})</button>
              </div>
              {tab === 'activity' && (
                <button className="ghost-btn" onClick={() => setActivitySort(s => s === 'latest' ? 'oldest' : 'latest')}>
                  <ArrowUpDown size={14} /> {activitySort === 'latest' ? 'Latest first' : 'Oldest first'}
                </button>
              )}
            </div>

            {tab === 'activity' && (
              <div className="pw-timeline">
                {activity.length === 0 && <p className="empty-state card">No progress updates, comments, or approvals yet.</p>}
                {activity.map(event => (
                  <article className="pw-event" key={event.id}>
                    <span className={`activity-dot ${event.state || 'green'}`} />
                    <div className="pw-event-card card">
                      <div className="pw-event-head">
                        <span className="pw-event-type">{event.type}</span>
                        <time>{formatEventDate(event.created_at || event.due_date)}</time>
                      </div>
                      <strong>{event.title}</strong>
                      {event.body && <p className="formatted-text">{event.body}</p>}
                      <div className="pw-event-meta">
                        {event.actor && <small>{event.actor}</small>}
                        {event.owner && <small>{event.owner}</small>}
                        {event.status && <small>{event.status}</small>}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {tab === 'evidence' && (
              <div className="pw-evidence">
                {measureDocs.length === 0 && <p className="empty-state card">No evidence attached to this lead measure yet.</p>}
                <div className="measure-evidence-grid">
                  {measureDocs.map(doc => <EvidenceSummaryCard key={doc._id} doc={doc} />)}
                </div>
              </div>
            )}

            {tab === 'approvals' && (
              <div className="pw-approvals">
                {measureApprovals.length === 0 && <p className="empty-state card">No approvals for this lead measure.</p>}
                {measureApprovals.map(item => (
                  <div className="pw-rail-row card pw-approval-row" key={item._id} id={`approval-${item._id}`}>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.requested_by} · {item.status}{item.due_date ? ` · due ${item.due_date}` : ''}</small>
                      {item.summary && <p className="formatted-text">{item.summary}</p>}
                    </div>
                    {canEdit && item.status === 'Pending' && (
                      <div className="pw-rail-actions">
                        <button className="ghost-btn" onClick={() => updateApprovalStatus(item._id, 'Approved')}><Check size={14} /> Approve</button>
                        <button className="ghost-btn danger" onClick={() => updateApprovalStatus(item._id, 'Rejected')}><X size={14} /> Reject</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      {(modal === 'wig-add' || modal === 'wig-edit') && (
        <EntityModal
          title={modal === 'wig-edit' ? 'Edit WIG' : 'Add Wildly Important Goal'}
          subtitle={project.name}
          onClose={() => setModal(null)}
          onSubmit={submitWig}
          submitLabel={modal === 'wig-edit' ? 'Save changes' : 'Add WIG'}
          busy={busy}
        >
          <WigFormFields
            draft={wigDraft}
            setDraft={setWigDraft}
            inheritPriority={modal === 'wig-add' ? (project.priority ?? 5) : null}
            projectBudget={budget.total}
            otherWigBudget={otherWigBudget}
            editMode={modal === 'wig-edit'}
            projectDeadline={project.due_date || ''}
          />
        </EntityModal>
      )}

      {(modal === 'measure-add' || modal === 'measure-edit') && (
        <EntityModal
          title={modal === 'measure-edit' ? 'Edit lead measure' : 'Add lead measure'}
          subtitle={wig?.title || project.name}
          onClose={() => setModal(null)}
          onSubmit={submitMeasure}
          submitLabel={modal === 'measure-edit' ? 'Save changes' : 'Add lead measure'}
          busy={busy}
        >
          <MeasureFormFields
            draft={measureDraft}
            setDraft={setMeasureDraft}
            inheritPriority={modal === 'measure-add' ? (wig?.priority ?? project.priority ?? 5) : null}
            wigBudget={wigBudget.total}
            otherMeasureBudget={otherMeasureBudget}
            editMode={modal === 'measure-edit'}
            showStatus={modal === 'measure-edit'}
            projectDeadline={project.due_date || ''}
            wigDeadline={wig?.deadline || ''}
          />
        </EntityModal>
      )}

      {modal === 'evidence' && (
        <Modal title="Attach evidence" onClose={() => setModal(null)}>
          <form className="project-form" onSubmit={submitEvidence}>
            <label className="upload-box">
              <Upload size={20} />
              <span>Upload a file — it will be read, vectorized, and summarised</span>
              <input type="file" onChange={uploadEvidence} />
            </label>
            <div className="pw-divider"><span>or paste evidence text</span></div>
            <label className="field"><span>Title</span><input value={evidenceDraft.title} onChange={e => setEvidenceDraft({ ...evidenceDraft, title: e.target.value })} required /></label>
            <label className="field">
              <span>Type</span>
              <select value={evidenceDraft.document_type} onChange={e => setEvidenceDraft({ ...evidenceDraft, document_type: e.target.value })}>
                <option>Progress Note</option><option>Review Minutes</option><option>Finance Memo</option><option>Clearance Note</option><option>Citizen Impact</option>
              </select>
            </label>
            <label className="field"><span>Content</span><textarea value={evidenceDraft.content} onChange={e => setEvidenceDraft({ ...evidenceDraft, content: e.target.value })} required /></label>
            <button className="primary-btn" disabled={busy}><Brain size={15} /> Save & summarise</button>
          </form>
        </Modal>
      )}

      {modal === 'approval' && (
        <Modal title="Request approval" onClose={() => setModal(null)}>
          <form className="project-form" onSubmit={submitApproval}>
            <label className="field"><span>Title</span><input value={approvalDraft.title} onChange={e => setApprovalDraft({ ...approvalDraft, title: e.target.value })} required /></label>
            <label className="field"><span>Requested by</span><input value={approvalDraft.requested_by} onChange={e => setApprovalDraft({ ...approvalDraft, requested_by: e.target.value })} required /></label>
            <label className="field"><span>Due date</span><input type="date" value={approvalDraft.due_date} onChange={e => setApprovalDraft({ ...approvalDraft, due_date: e.target.value })} required /></label>
            <label className="field"><span>Summary</span><textarea value={approvalDraft.summary} onChange={e => setApprovalDraft({ ...approvalDraft, summary: e.target.value })} required /></label>
            <button className="primary-btn" disabled={busy}>Request approval</button>
          </form>
        </Modal>
      )}

      {modal === 'meeting' && (
        <Modal title="Log WIG session" onClose={() => setModal(null)}>
          <form className="project-form" onSubmit={submitMeeting}>
            <label className="field"><span>Date</span><input type="date" value={meetingDraft.meeting_date} onChange={e => setMeetingDraft({ ...meetingDraft, meeting_date: e.target.value })} required /></label>
            <label className="field"><span>Facilitator</span><input value={meetingDraft.facilitator} onChange={e => setMeetingDraft({ ...meetingDraft, facilitator: e.target.value })} required /></label>
            <label className="field"><span>Notes</span><textarea value={meetingDraft.notes} onChange={e => setMeetingDraft({ ...meetingDraft, notes: e.target.value })} required /></label>
            <label className="field"><span>Commitments (one per line)</span><textarea value={meetingDraft.commitments} onChange={e => setMeetingDraft({ ...meetingDraft, commitments: e.target.value })} /></label>
            <button className="primary-btn" disabled={busy}>Save session</button>
          </form>
        </Modal>
      )}

      <AIInsightModal
        open={!!insightModal}
        onClose={() => setInsightModal(null)}
        scope={insightModal?.scope}
        projectId={projectId}
        wigId={wig?.id}
        measureId={measure?.id}
        entityTitle={insightModal?.scope === 'measure' ? measure?.title : insightModal?.scope === 'wig' ? wig?.title : project?.name}
        api={api}
        locale={locale}
        onNavigateToRisk={navigateToRiskSource}
      />
    </section>
  );
}

function countMeasures(project) {
  return (project.wigs || []).reduce((sum, wig) => sum + (wig.lead_measures?.length || 0), 0);
}

function filterProjects(projects, filters = {}) {
  return projects.filter(project => {
    if (filters.ministryId && project.ministry_id !== filters.ministryId) return false;
    if (filters.projectId && project._id !== filters.projectId) return false;
    if (filters.wigId && !(project.wigs || []).some(wig => !wig.archived_at && wig.id === filters.wigId)) return false;
    if (filters.health && !projectMatchesHealth(project, filters.health)) return false;
    return true;
  });
}

function projectMatchesHealth(project, health) {
  const target = normalizeHealth(health);
  if (!target) return true;
  const statuses = new Set();
  statuses.add(normalizeHealth(project.status));
  (project.milestones || []).forEach(item => statuses.add(normalizeHealth(item.status)));
  (project.wigs || []).forEach(wig => {
    statuses.add(normalizeHealth(wig.status));
    (wig.lead_measures || []).forEach(measure => {
      statuses.add(normalizeHealth(measure.status));
      (measure.comments || []).forEach(comment => statuses.add(normalizeHealth(comment.health_state)));
    });
  });
  return statuses.has(target);
}

function normalizeHealth(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[_\s-]+/g, '-');
}

function buildFilteredOverview(overview, projects) {
  if (!overview) return overview;
  const projectIds = new Set(projects.map(project => project._id));
  const stats = {
    total: projects.length,
    on_track: projects.filter(project => project.status === 'On Track').length,
    at_risk: projects.filter(project => project.status === 'At Risk').length,
    off_track: projects.filter(project => project.status === 'Off Track').length,
    health_score: projects.length ? Math.round(projects.reduce((sum, project) => sum + (project.health_score || 0), 0) / projects.length) : 0
  };
  const bottleneckCounts = {};
  projects.forEach(project => (project.bottlenecks || []).forEach(name => {
    bottleneckCounts[name] = (bottleneckCounts[name] || 0) + 1;
  }));
  const bottlenecks = Object.entries(bottleneckCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return {
    ...overview,
    projects,
    stats,
    bottlenecks,
    assignments: (overview.assignments || []).filter(item => projectIds.has(item.project_id)),
    decisions: (overview.decisions || []).filter(item => projectIds.has(item.project_id))
  };
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

function daysUntil(value) {
  if (!value) return 'No date';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${value}T00:00:00`);
  if (Number.isNaN(target.getTime())) return 'No date';
  const days = Math.ceil((target - today) / 86400000);
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return 'Due today';
  return `${days} days left`;
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
  if (isEntityOverdue(measure)) {
    const pct = progressPercent(measure.from_value, measure.to_value, measure.current_value ?? measure.from_value);
    return pct < 30 ? 'blocker' : 'red';
  }
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

function HealthBadge({ state }) {
  const normalized = String(state || 'green').toLowerCase();
  return <span className={`health-badge ${normalized}`}>{normalized}</span>;
}

function Scoreboard({ api, projects, ministries, filters, setFilters, onOpenProject, onOpenWig, onOpenMeasure }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api('/api/scoreboard')
      .then(result => { if (active) setData(result); })
      .catch(() => { if (active) setData({ rows: [], counts: {}, total: 0 }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projects.length]);

  const rows = (data?.rows || []).filter(row => {
    if (stateFilter && row.health_state !== stateFilter) return false;
    if (projects.length && !projects.some(p => p._id === row.project_id)) return false;
    return true;
  });
  const counts = data?.counts || {};

  return (
    <section>
      <div className="panel-header">
        <div><h2>Team Scoreboard</h2><p>Discipline 3 — every lead measure at a glance</p></div>
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}>
          <option value="">All health states</option>
          {['green','amber','red','blocker','approval','hold'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="scoreboard-summary">
        {Object.entries(counts).map(([state, count]) => (
          <div key={state} className="summary-pill"><HealthBadge state={state} /><strong>{count}</strong></div>
        ))}
        <div className="summary-pill"><span>Total</span><strong>{data?.total || 0}</strong></div>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {loading && <p className="loading">Loading scoreboard...</p>}
        {!loading && rows.length === 0 && <p className="empty-state">No lead measures match filters.</p>}
        {!loading && rows.length > 0 && (
          <table className="scoreboard-table">
            <thead><tr><th>Status</th><th>Lead Measure</th><th>Project / WIG</th><th>Owner</th><th>Progress</th><th>Due</th></tr></thead>
            <tbody>
              {rows.map(row => (
                <tr
                  key={`${row.project_id}-${row.measure_id}`}
                  className="scoreboard-row"
                  onClick={() => onOpenMeasure?.(row)}
                  tabIndex={0}
                  role="link"
                  onKeyDown={e => { if (e.key === 'Enter') onOpenMeasure?.(row); }}
                >
                  <td><HealthBadge state={row.health_state} /></td>
                  <td>
                    <button type="button" className="sb-link sb-measure" onClick={e => { e.stopPropagation(); onOpenMeasure?.(row); }}>
                      {row.measure_title}
                    </button>
                  </td>
                  <td className="sb-context">
                    <button type="button" className="sb-link sb-project" onClick={e => { e.stopPropagation(); onOpenProject?.(row); }}>
                      {row.project_name}
                    </button>
                    <button type="button" className="sb-link sb-wig" onClick={e => { e.stopPropagation(); onOpenWig?.(row); }}>
                      {row.wig_title}
                    </button>
                  </td>
                  <td>{row.owner || '—'}</td>
                  <td><div className="progress-bar"><em style={{ width: `${row.progress}%`, background: 'var(--primary)' }} /></div> {row.progress}%</td>
                  <td>{row.deadline || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function Workflow({ overview, api, reload }) {
  const projects = overview?.projects || [];
  const assignments = overview?.assignments || [];
  const [form, setForm] = useState({ project_id: projects[0]?._id || '', title: '', owner: '', role: 'Project Director', due_date: '', priority: 'High', discipline: 'Cadence', decision_needed: '' });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!projects.some(project => project._id === form.project_id)) {
      setForm(prev => ({ ...prev, project_id: projects[0]?._id || '' }));
    }
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
        <button className="primary-btn" disabled={!projects.length} onClick={() => setOpen(true)}>Assign Action</button>
      </div>
      <div className="card glass-panel">
        <h3><CalendarClock size={22} /> Assigned Actions</h3>
        <div className="action-list">
          {assignments.map(a => <ActionRow key={a._id} item={a} projects={projects} onDone={() => closeAssignment(a._id)} />)}
          {assignments.length === 0 && <p className="empty-state">No workflow actions match the current filters.</p>}
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

const INSIGHT_PRESET_BUTTONS = [
  { id: 'not_working', icon: AlertTriangle, label: 'What is not working?' },
  { id: 'not_updating', icon: Users, label: 'Who is not updating their work?' },
  { id: 'at_risk', icon: TrendingDown, label: 'Which projects are at risk?' },
  { id: 'budget', icon: Gauge, label: 'Who is over or under budget?' },
];

function severityTone(severity = '') {
  const s = severity.toLowerCase();
  if (s === 'critical') return 'blocker';
  if (s === 'high') return 'red';
  if (s === 'medium') return 'amber';
  return 'green';
}

function AIInsight({ projects, api, reload, notify, onOpenProject }) {
  const [question, setQuestion] = useState('');
  const [activePreset, setActivePreset] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [doc, setDoc] = useState({ title: '', document_type: 'Progress Note', content: '' });
  const [docProjectId, setDocProjectId] = useState(projects[0]?._id || '');
  const [docWigId, setDocWigId] = useState('');
  const [docMeasureId, setDocMeasureId] = useState('');

  const docProject = projects.find(p => p._id === docProjectId) || projects[0] || null;
  const docWigs = (docProject?.wigs || []).filter(w => !w.archived_at);
  const docWig = docWigs.find(w => w.id === docWigId) || docWigs[0] || null;
  const docMeasures = (docWig?.lead_measures || []).filter(m => !m.archived_at);
  const docMeasure = docMeasures.find(m => m.id === docMeasureId) || docMeasures[0] || null;

  async function ask(preset, text) {
    setLoading(true);
    setActivePreset(preset || null);
    try {
      const data = await api('/api/ai/insight', {
        method: 'POST',
        body: JSON.stringify({ preset: preset || undefined, question: text || undefined }),
      });
      setResult(data);
    } catch (err) {
      notify(err.message || 'Insight generation failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  function submitQuestion(e) {
    e.preventDefault();
    if (!question.trim()) return;
    ask(null, question.trim());
  }

  function openUpload() {
    setDoc({ title: '', document_type: 'Progress Note', content: '' });
    setDocProjectId(projects[0]?._id || '');
    setDocWigId('');
    setDocMeasureId('');
    setUploadOpen(true);
  }

  async function submitDocument(e) {
    e.preventDefault();
    try {
      await api('/api/documents', {
        method: 'POST',
        body: JSON.stringify({ ...doc, project_id: docProject._id, wig_id: docWig?.id, measure_id: docMeasure?.id }),
      });
      setUploadOpen(false);
      notify('Evidence vectorized — it now feeds AI insights');
      await reload();
    } catch (err) {
      notify(err.message || 'Upload failed', 'error');
    }
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file || !docMeasure) return;
    try {
      const data = new FormData();
      data.append('project_id', docProject._id);
      if (docWig) data.append('wig_id', docWig.id);
      data.append('measure_id', docMeasure.id);
      data.append('document_type', 'Uploaded File');
      data.append('file', file);
      await api('/api/documents/upload', { method: 'POST', body: data });
      setUploadOpen(false);
      notify('File vectorized — it now feeds AI insights');
      await reload();
    } catch (err) {
      notify(err.message || 'Upload failed', 'error');
    }
  }

  function citationChip(name) {
    const target = projects.find(p => p.name === name);
    return (
      <button
        key={name}
        className={`ai-citation ${target ? '' : 'static'}`}
        onClick={() => target && onOpenProject(target._id)}
        type="button"
      >
        {name}
      </button>
    );
  }

  const insight = result?.insight;
  const data = result?.data;

  return (
    <section className="ai">
      <div className="ai-hero card">
        <div className="ai-hero-head">
          <div>
            <span className="pw-kicker"><Sparkles size={13} /> AI Insight</span>
            <h1>Ask your portfolio</h1>
            <p>Executive answers grounded in live project health, lead-measure updates, and vectorized evidence.</p>
          </div>
          <button className="ghost-btn" onClick={openUpload}><Upload size={14} /> Upload evidence</button>
        </div>
        <div className="ai-presets">
          {INSIGHT_PRESET_BUTTONS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              className={`ai-preset ${activePreset === id ? 'active' : ''}`}
              disabled={loading}
              onClick={() => ask(id)}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        <form className="ai-ask" onSubmit={submitQuestion}>
          <Search size={16} />
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Ask anything — e.g. Where should I intervene this week?"
          />
          <button className="primary-btn" disabled={loading || !question.trim()}><Send size={14} /> Ask</button>
        </form>
      </div>

      {loading && (
        <div className="card ai-loading">
          <div className="skeleton" style={{ height: 22, width: '55%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 13, marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 13, width: '85%', marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 13, width: '70%' }} />
        </div>
      )}

      {!loading && insight && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <div className="card ai-answer">
            <div className="ai-answer-head">
              <span className="ai-mode">
                <Brain size={13} />
                {insight.mode === 'openai_llm' ? `OpenAI · ${insight.model}` : 'Local insight engine'}
              </span>
              <small>“{result.question}”</small>
            </div>
            <h2>{insight.headline}</h2>
            {insight.summary && <p className="ai-summary">{insight.summary}</p>}

            {(insight.findings || []).length > 0 && (
              <div className="ai-findings">
                {insight.findings.map((finding, index) => (
                  <article className="ai-finding" key={index}>
                    <span className={`activity-dot ${severityTone(finding.severity)}`} />
                    <div>
                      <strong>{finding.title}</strong>
                      {finding.detail && <p>{finding.detail}</p>}
                      {(finding.projects || []).length > 0 && (
                        <div className="ai-citations">{finding.projects.map(citationChip)}</div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}

            {(insight.actions || []).length > 0 && (
              <div className="ai-actions">
                <h3>Recommended actions</h3>
                {insight.actions.map((action, index) => (
                  <div className="ai-action" key={index}>
                    <CheckCircle2 size={15} />
                    <span><b>{action.owner}</b> — {action.action}</span>
                    {action.deadline && <small>{action.deadline}</small>}
                  </div>
                ))}
              </div>
            )}

            {(insight.citations || []).length > 0 && (
              <div className="ai-footer">
                <span>Sources</span>
                <div className="ai-citations">{insight.citations.map(citationChip)}</div>
              </div>
            )}
            {insight.llm_status && (
              <p className="ai-status">
                <LlmStatusBadge status={insight.llm_status} locale={locale} feature="insight" />
              </p>
            )}
          </div>

          {data && (
            <div className="ai-data-grid">
              <div className="card pw-rail-card">
                <h3><Users size={15} /> Owners missing WIG cadence updates</h3>
                {(data.stale_owners || []).slice(0, 6).map(gap => (
                  <div className="pw-rail-row" key={gap.owner}>
                    <div>
                      <strong>{gap.owner}</strong>
                      <small>
                        {gap.count} silent {gap.count === 1 ? 'measure' : 'measures'}
                        {gap.items?.[0] && ` · ${gap.items[0].project}${gap.items[0].update_frequency ? ` (${formatFreqLabel(gap.items[0].update_frequency)} cadence)` : ''}`}
                      </small>
                    </div>
                    <span className="ai-count">{gap.count}</span>
                  </div>
                ))}
                {(data.stale_owners || []).length === 0 && <p className="pw-rail-empty">Everyone has updated recently. Excellent cadence.</p>}
              </div>
              <div className="card pw-rail-card">
                <h3><TrendingDown size={15} /> At-risk projects</h3>
                {(data.at_risk_projects || []).slice(0, 6).map(item => {
                  const target = projects.find(p => p.name === item.name);
                  return (
                    <button className="pw-rail-row ai-risk-row" key={item.name} onClick={() => target && onOpenProject(target._id)}>
                      <div>
                        <strong>{item.name}</strong>
                        <small>{item.ministry} · {item.top_bottleneck || 'No bottleneck recorded'}</small>
                      </div>
                      <span style={{ color: scoreColor(item.health_score) }}>{item.health_score}%</span>
                    </button>
                  );
                })}
                {(data.at_risk_projects || []).length === 0 && <p className="pw-rail-empty">No projects at risk right now.</p>}
              </div>
              <div className="card pw-rail-card">
                <h3><Gauge size={15} /> Budget status</h3>
                {(data.budget?.over_spent_projects || []).slice(0, 3).map(item => (
                  <div className="pw-rail-row" key={`spent-${item.project}`}>
                    <div>
                      <strong>{item.project}</strong>
                      <small>Spent {formatBudgetCr(item.spent_crore)} vs {formatBudgetCr(item.budget_crore)} budget</small>
                    </div>
                    <span className="ai-count">+{formatBudgetCr(item.variance_crore)}</span>
                  </div>
                ))}
                {(data.budget?.over_allocated_projects || []).slice(0, 3).map(item => (
                  <div className="pw-rail-row" key={`alloc-${item.project}`}>
                    <div>
                      <strong>{item.project}</strong>
                      <small>WIGs allocated {formatBudgetCr(item.wig_allocated_crore)} vs {formatBudgetCr(item.budget_crore)}</small>
                    </div>
                    <span className="ai-count">+{formatBudgetCr(item.variance_crore)}</span>
                  </div>
                ))}
                {!(data.budget?.over_spent_projects || []).length && !(data.budget?.over_allocated_projects || []).length && (
                  <p className="pw-rail-empty">No budget overruns detected in portfolio allocations.</p>
                )}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {!loading && !insight && (
        <div className="card ai-empty">
          <Sparkles size={28} />
          <h3>Start with a question</h3>
          <p>Pick a preset above or type your own. Answers cite live projects, silent owners, and evidence documents.</p>
        </div>
      )}

      {uploadOpen && (
        <Modal title="Upload evidence" onClose={() => setUploadOpen(false)}>
          <form className="project-form" onSubmit={submitDocument}>
            <label className="field">
              <span>Project</span>
              <select value={docProject?._id || ''} onChange={e => { setDocProjectId(e.target.value); setDocWigId(''); setDocMeasureId(''); }}>
                {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
              </select>
            </label>
            <div className="two-col">
              <label className="field">
                <span>WIG</span>
                <select value={docWig?.id || ''} onChange={e => { setDocWigId(e.target.value); setDocMeasureId(''); }}>
                  {docWigs.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
                  {docWigs.length === 0 && <option value="">No WIGs</option>}
                </select>
              </label>
              <label className="field">
                <span>Lead measure</span>
                <select value={docMeasure?.id || ''} onChange={e => setDocMeasureId(e.target.value)}>
                  {docMeasures.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                  {docMeasures.length === 0 && <option value="">No lead measures</option>}
                </select>
              </label>
            </div>
            <label className="upload-box">
              <Upload size={20} />
              <span>Upload a text file — vectorized and summarised automatically</span>
              <input type="file" onChange={uploadFile} disabled={!docMeasure} />
            </label>
            <div className="pw-divider"><span>or paste evidence text</span></div>
            <label className="field"><span>Title</span><input value={doc.title} onChange={e => setDoc({ ...doc, title: e.target.value })} required /></label>
            <label className="field">
              <span>Type</span>
              <select value={doc.document_type} onChange={e => setDoc({ ...doc, document_type: e.target.value })}>
                <option>Progress Note</option><option>Review Minutes</option><option>Finance Memo</option><option>Clearance Note</option><option>Citizen Impact</option>
              </select>
            </label>
            <label className="field"><span>Content</span><textarea value={doc.content} onChange={e => setDoc({ ...doc, content: e.target.value })} required /></label>
            <button className="primary-btn" disabled={!docMeasure}><Brain size={15} /> Vectorize evidence</button>
          </form>
        </Modal>
      )}
    </section>
  );
}

function looksLikeRawPdf(text = '') {
  const sample = String(text).slice(0, 1200);
  return sample.startsWith('%PDF') || (sample.includes('/Type /') && sample.includes('endobj')) || sample.includes('/FlateDecode');
}

function readableDocumentText(doc) {
  const headline = doc.ai_summary?.headline;
  const content = doc.content || doc.text || '';
  if (looksLikeRawPdf(headline) || looksLikeRawPdf(content)) {
    return 'PDF evidence uploaded. The document is stored for evidence review; readable text extraction will be used for summaries on new uploads.';
  }
  return headline || content || 'No readable summary available.';
}

function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function riskLine(item) {
  if (typeof item === 'string') return item;
  return `${item.severity || 'Risk'} ${item.risk || item.title || 'Execution risk'} - ${item.mitigation || 'Assign mitigation owner.'}`;
}

function actionLine(item) {
  if (typeof item === 'string') return item;
  return `${item.owner || 'Owner'}: ${item.action || item.title || 'Take action'} ${item.deadline ? `(${item.deadline})` : ''}`;
}

function EvidenceSummaryCard({ doc }) {
  const summary = doc.ai_summary || {};
  const signals = summary.risk_signals?.length ? summary.risk_signals : (doc.risk_signals || []).map(signal => signal.name);
  const displayText = readableDocumentText(doc);
  const highlights = (summary.highlights || []).filter(item => !looksLikeRawPdf(item));
  return (
    <article className="evidence-summary-card" id={doc._id ? `doc-${doc._id}` : undefined}>
      <div className="evidence-summary-head">
        <FileText size={16} />
        <span>
          <strong>{doc.title}</strong>
          <small>{doc.document_type} | risk {summary.risk_score ?? doc.risk_score ?? 0}</small>
        </span>
      </div>
      <p>{displayText}</p>
      {highlights.length > 1 && (
        <ul>
          {highlights.slice(1, 3).map(item => <li key={item}>{item}</li>)}
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
  const [aiProjectId, setAiProjectId] = useState(projects[0]?._id || '');
  const [aiQuestion, setAiQuestion] = useState('What decision should leadership take now?');
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    if (!projects.some(project => project._id === form.project_id)) {
      setForm(prev => ({ ...prev, project_id: projects[0]?._id || '' }));
    }
    if (!projects.some(project => project._id === aiProjectId)) {
      setAiProjectId(projects[0]?._id || '');
    }
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

  async function generateAIBrief(e) {
    e.preventDefault();
    if (!aiProjectId) return;
    setAiLoading(true);
    setAiError('');
    try {
      const result = await api('/api/ai/decision-brief', {
        method: 'POST',
        body: JSON.stringify({ project_id: aiProjectId, question: aiQuestion })
      });
      setAiResult(result);
    } catch (err) {
      setAiError(err.message || 'AI decision generation failed');
    } finally {
      setAiLoading(false);
    }
  }

  async function addAIBriefToQueue() {
    if (!aiResult?.brief || !aiProjectId) return;
    const brief = aiResult.brief;
    const project = projects.find(item => item._id === aiProjectId);
    const summary = [
      brief.executive_position,
      ...(brief.why_now || []).map(item => `Why now: ${item}`),
      ...(brief.actions || []).map(item => `Action: ${actionLine(item)}`)
    ].filter(Boolean).join('\n');
    await api('/api/decisions', {
      method: 'POST',
      body: JSON.stringify({
        project_id: aiProjectId,
        title: `${brief.recommended_decision || 'AI Recommendation'}: ${project?.name || 'Project'}`,
        decision_type: brief.decision_type || 'Intervention',
        requested_by: 'AI Decision Engine',
        due_date: daysFromNow(7),
        summary
      })
    });
    reload();
  }

  return (
    <section className="tesla-stage">
      <div className="stage-toolbar">
        <div><h3>Decisions</h3><span>{decisions.length} pending items</span></div>
        <button className="primary-btn" disabled={!projects.length} onClick={() => setOpen(true)}>Create Decision</button>
      </div>
      <div className="ai-decision-panel">
        <div className="ai-decision-copy">
          <span><Brain size={17} /> AI Decision Engine</span>
          <h3>Evidence-backed 4DX recommendation</h3>
          <p>Uses project health, WIGs, lead measures, evidence documents, MongoDB vector matches, approvals and alerts to draft a leadership decision.</p>
        </div>
        <form className="ai-decision-controls" onSubmit={generateAIBrief}>
          <select value={aiProjectId} onChange={e => setAiProjectId(e.target.value)} required>
            {projects.map(project => <option key={project._id} value={project._id}>{project.name}</option>)}
          </select>
          <input value={aiQuestion} onChange={e => setAiQuestion(e.target.value)} placeholder="Ask a leadership decision question" />
          <button className="primary-btn" disabled={aiLoading || !projects.length}>{aiLoading ? 'Analyzing...' : 'Generate Brief'}</button>
        </form>
        {aiError && <p className="ai-error">{aiError}</p>}
        {aiResult?.brief && (
          <div className="ai-brief-card">
            <div className="ai-brief-head">
              <div>
                <small>Recommended decision</small>
                <h3>{aiResult.brief.recommended_decision || 'Review'}</h3>
                <p>{aiResult.brief.executive_position}</p>
              </div>
              <div>
                <small>Confidence</small>
                <strong>{Math.round((aiResult.brief.confidence || 0) * 100)}%</strong>
                <span>{aiResult.brief.mode === 'openai_llm' ? aiResult.brief.model : 'Local fallback'}</span>
              </div>
            </div>
            <div className="ai-brief-grid">
              <div>
                <h4>Why now</h4>
                {(aiResult.brief.why_now || []).slice(0, 4).map(item => <p key={item}>{item}</p>)}
              </div>
              <div>
                <h4>Risks</h4>
                {(aiResult.brief.risk_register || []).slice(0, 4).map((item, index) => <p key={`${riskLine(item)}-${index}`}>{riskLine(item)}</p>)}
              </div>
              <div>
                <h4>Actions</h4>
                {(aiResult.brief.actions || []).slice(0, 4).map((item, index) => <p key={`${actionLine(item)}-${index}`}>{actionLine(item)}</p>)}
              </div>
              <div>
                <h4>CM questions</h4>
                {(aiResult.brief.questions_for_cm || []).slice(0, 4).map(item => <p key={item}>{item}</p>)}
              </div>
            </div>
            <div className="ai-status-strip">
              <span>{aiResult.evidence_count} evidence docs</span>
              <span>{aiResult.vector_match_count} vector matches</span>
              <span>{aiResult.embedding_provider?.provider || 'embedding'} | {aiResult.embedding_provider?.model || 'model pending'}</span>
              <button className="ghost-btn" type="button" onClick={addAIBriefToQueue}>Add to Decision Queue</button>
            </div>
            {aiResult.brief.llm_status && (
              <p className="ai-note">
                <LlmStatusBadge status={aiResult.brief.llm_status} locale={locale} feature="insight" />
              </p>
            )}
          </div>
        )}
      </div>
      <div className="card glass-panel">
        <h3><Gavel size={22} /> Decision Queue</h3>
        <div className="action-list">
          {decisions.map(d => <DecisionRow key={d._id} item={d} projects={projects} onMark={status => mark(d._id, status)} />)}
          {decisions.length === 0 && <p className="empty-state">No decisions match the current filters.</p>}
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

function Admin({ settings, setSettings, api, reload, locale, setLocale }) {
  const [draft, setDraft] = useState(settings || {});
  const [saved, setSaved] = useState(false);
  const [vectorStatus, setVectorStatus] = useState('');
  const [vectorReadiness, setVectorReadiness] = useState(null);
  const [accessData, setAccessData] = useState({ users: [], ministries: [], roles: [] });
  const [accessDraft, setAccessDraft] = useState({ phone: '', display_name: '', role: 'user', ministry_ids: [] });
  const [accessStatus, setAccessStatus] = useState('');
  const [appModeDraft, setAppModeDraft] = useState({ mode: settings?.app_mode || 'prod', auto_load_demo: !!settings?.auto_load_demo });
  const [devStatus, setDevStatus] = useState('');
  const [cleanupPreview, setCleanupPreview] = useState(null);
  const [jsonFile, setJsonFile] = useState(null);
  const [confirmReseed, setConfirmReseed] = useState(false);

  useEffect(() => setDraft(settings || {}), [settings]);
  useEffect(() => {
    setAppModeDraft({ mode: settings?.app_mode || 'prod', auto_load_demo: !!settings?.auto_load_demo });
  }, [settings?.app_mode, settings?.auto_load_demo]);
  useEffect(() => {
    loadVectorStatus();
    loadAccessData();
  }, []);

  async function loadAccessData() {
    try {
      const data = await api('/api/admin/users');
      setAccessData({
        users: data.users || [],
        ministries: data.ministries || [],
        roles: data.roles || [],
      });
    } catch (err) {
      setAccessStatus(err.message || 'Unable to load user access');
    }
  }

  function editAccess(user) {
    setAccessDraft({
      phone: user.phone || '',
      display_name: user.display_name || '',
      role: user.role || 'user',
      ministry_ids: (user.ministry_ids || []).map(String),
    });
    setAccessStatus('');
  }

  function updateAccessMinistries(e) {
    const values = Array.from(e.target.selectedOptions).map(option => option.value);
    setAccessDraft(prev => ({ ...prev, ministry_ids: values }));
  }

  async function saveAccess(e) {
    e.preventDefault();
    setAccessStatus('Saving access...');
    try {
      const savedUser = await api(`/api/admin/users/${encodeURIComponent(accessDraft.phone)}/role`, {
        method: 'PUT',
        body: JSON.stringify({
          role: accessDraft.role,
          ministry_ids: accessDraft.role === 'ministry_admin' ? accessDraft.ministry_ids : [],
          display_name: accessDraft.display_name,
        }),
      });
      setAccessStatus(`${savedUser.display_name || savedUser.phone} is now ${roleLabel(savedUser.role)}.`);
      setAccessDraft({ phone: '', display_name: '', role: 'user', ministry_ids: [] });
      await loadAccessData();
      await reload();
    } catch (err) {
      setAccessStatus(err.message || 'Unable to save access');
    }
  }

  function applyRegion(regionId) {
    const preset = regionById(regionId);
    setDraft(prev => ({
      ...prev,
      region: preset.id,
      currency: preset.currency,
      timezone: preset.timezone,
      org_type: preset.orgType,
      locale: preset.id === 'cn' ? 'zh' : preset.id === 'in' ? 'hi' : preset.id === 'jp' ? 'ja' : preset.id === 'de' ? 'de' : preset.id === 'fr' ? 'fr' : preset.id === 'sg' ? 'sg' : prev.locale || 'en',
    }));
  }

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
    if (data.locale) setLocale(data.locale);
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
    const data = await api('/api/admin/reseed', { method: 'POST' });
    setDevStatus(`Demo reset complete — ${data.projects || 0} projects loaded.`);
    reload();
  }

  async function saveAppMode() {
    const payload = {
      mode: appModeDraft.mode,
      auto_load_demo: appModeDraft.auto_load_demo,
      confirm_reseed: appModeDraft.mode === 'dev' && appModeDraft.auto_load_demo,
    };
    const data = await api('/api/admin/app-mode', { method: 'PUT', body: JSON.stringify(payload) });
    if (data.settings) setSettings(data.settings);
    setDevStatus(data.reseeded ? 'Dev mode saved — demo data loaded.' : 'App mode saved.');
    reload();
  }

  async function reseedDemo() {
    if (appModeDraft.mode === 'prod' && !confirmReseed) {
      setDevStatus('Check the confirmation box before reseeding in production mode.');
      return;
    }
    const formData = new FormData();
    formData.append('confirm', String(confirmReseed || appModeDraft.mode === 'dev'));
    if (jsonFile) formData.append('file', jsonFile);
    const data = await api('/api/admin/reseed-demo', { method: 'POST', body: formData });
    setDevStatus(`Demo reseed complete — ${data.projects || 0} projects loaded.`);
    setJsonFile(null);
    setConfirmReseed(false);
    reload();
  }

  async function loadCleanupPreview() {
    const data = await api('/api/admin/cleanup-db');
    setCleanupPreview(data);
  }

  async function runCleanup() {
    const data = await api('/api/admin/cleanup-db', { method: 'POST' });
    setDevStatus(`Dropped ${data.dropped?.length || 0} empty orphan collection(s).`);
    await loadCleanupPreview();
  }

  return (
    <section className="admin-layout">
      <div className="admin-main-col">
      <section className="admin-rbac-page">
        <div className="page-breadcrumbs">
          <button type="button">Admin</button>
          <ChevronRight size={13} />
          <span>Access Control</span>
        </div>
        <div className="rbac-title-row">
          <div>
            <h2>Government RBAC</h2>
            <p>Everyone can view all projects. Edit access is role and ministry based.</p>
          </div>
          <button className="ghost-btn" type="button" onClick={loadAccessData}><RefreshCw size={14} /> Refresh Users</button>
        </div>

        <section className="card rbac-role-panel">
          <div className="rbac-section-head">
            <h3>Role Hierarchy</h3>
            <p>Roles define level of access and scope</p>
          </div>
          <div className="rbac-role-flow">
            {[
              { role: 'Chief Minister', tag: 'Read Only', icon: Shield, copy: 'Read-only oversight across all ministries and projects. Can view dashboards, reports and decisions.' },
              { role: 'Minister', tag: 'Read Only', icon: Landmark, copy: 'Read-only oversight across assigned government portfolio and all project dashboards.' },
              { role: 'Executive Assistant', tag: 'Write Access', icon: UserRound, copy: 'Full write access across ministries and projects. Supports decision making and execution follow-up.' },
              { role: 'Ministry Admin', tag: 'Write Access', icon: Building2, copy: 'Full write access within assigned ministry. Can manage ministry projects, WIGs and lead measures.' },
              { role: 'General User', tag: 'Read Only', icon: Users, copy: 'Read-only access across the portfolio. Can view dashboards and reports only.' },
            ].map((item, index, list) => (
              <React.Fragment key={item.role}>
                <article className="rbac-role-card">
                  <div className="rbac-role-icon"><item.icon size={28} /></div>
                  <div>
                    <strong>{item.role}</strong>
                    <span>{item.tag}</span>
                    <p>{item.copy}</p>
                  </div>
                </article>
                {index < list.length - 1 && <ChevronRight className="rbac-flow-arrow" size={18} />}
              </React.Fragment>
            ))}
          </div>
        </section>

        <div className="rbac-work-grid">
          <section className="card rbac-users-card">
            <div className="rbac-users-head">
              <div><h3>Users</h3><span>{accessData.users.length} users</span></div>
              <label className="rbac-table-search"><Search size={15} /><input placeholder="Search by name, mobile or role..." /></label>
              <select><option>All Roles</option></select>
              <select><option>All Ministries</option></select>
              <button className="ghost-btn" type="button"><ArrowUpDown size={14} /> Filters</button>
            </div>
            <div className="rbac-user-table-wrap">
              <table className="rbac-user-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Mobile</th>
                    <th>Role</th>
                    <th>Ministry Scope</th>
                    <th>View Access</th>
                    <th>Edit Access</th>
                    <th>Last Login</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(accessData.users || []).map((user, index) => {
                    const scope = user.role === 'ministry_admin' ? (user.ministry_names || []).join(', ') || 'No ministry selected' : 'All Ministries';
                    const editScope = ['chief_minister', 'minister', 'user'].includes(user.role) ? 'None' : scope === 'All Ministries' ? 'All Projects' : scope;
                    return (
                      <tr key={user.phone}>
                        <td><span className="rbac-avatar">{(user.display_name || user.phone || 'U').slice(0, 2).toUpperCase()}</span><strong>{user.display_name || roleLabel(user.role)}</strong></td>
                        <td>{user.phone}</td>
                        <td><span className={`role-pill ${user.role}`}>{roleLabel(user.role)}</span></td>
                        <td>{scope}</td>
                        <td>All Projects</td>
                        <td>{editScope}</td>
                        <td>{index < 2 ? `Today, 0${index + 8}:4${index} AM` : '02 Jul 2026, 11:05 AM'}</td>
                        <td><button className="icon-btn" type="button" onClick={() => editAccess(user)}><Pencil size={13} /></button><button className="icon-btn" type="button"><Menu size={13} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {accessData.users.length === 0 && <p className="empty-state">No signed-in users yet.</p>}
            </div>
            <div className="rbac-table-foot">
              <span>Showing 1 to {Math.min(8, accessData.users.length)} of {accessData.users.length} users</span>
              <div><button className="icon-btn"><ArrowLeft size={13} /></button><button className="active-page">1</button><button>2</button><button className="icon-btn"><ChevronRight size={13} /></button></div>
            </div>
          </section>

          <form className="card rbac-assign-card" onSubmit={saveAccess}>
            <h3>Assign Role</h3>
            <p>Create or update user access</p>
            <label>
              Mobile Number <b>*</b>
              <div className="rbac-input"><Phone size={15} /><input value={accessDraft.phone} onChange={e => setAccessDraft({ ...accessDraft, phone: e.target.value })} placeholder="Enter 10-digit mobile number" required /></div>
            </label>
            <label>
              Display Name
              <input value={accessDraft.display_name} onChange={e => setAccessDraft({ ...accessDraft, display_name: e.target.value })} placeholder="Officer name" />
            </label>
            <label>
              Role <b>*</b>
              <select value={accessDraft.role} onChange={e => setAccessDraft({ ...accessDraft, role: e.target.value, ministry_ids: e.target.value === 'ministry_admin' ? accessDraft.ministry_ids : [] })}>
                {(accessData.roles.length ? accessData.roles : [
                  { id: 'chief_minister', label: 'Chief Minister' },
                  { id: 'minister', label: 'Minister' },
                  { id: 'executive_assistant', label: 'Executive Assistant' },
                  { id: 'ministry_admin', label: 'Ministry Admin' },
                  { id: 'user', label: 'General User' },
                ]).map(role => <option key={role.id} value={role.id}>{role.label}</option>)}
              </select>
            </label>
            <label className={accessDraft.role === 'ministry_admin' ? '' : 'muted-control'}>
              Ministry Scope <b>*</b>
              <select value={accessDraft.ministry_ids[0] || ''} onChange={e => setAccessDraft(prev => ({ ...prev, ministry_ids: e.target.value ? [e.target.value] : [] }))} disabled={accessDraft.role !== 'ministry_admin'}>
                <option value="">Select ministry scope</option>
                {accessData.ministries.map(ministry => <option key={ministry._id} value={ministry._id}>{ministry.name}</option>)}
              </select>
            </label>
            <button className="primary-btn" type="submit">Save Access</button>
            <button className="link-btn" type="button" onClick={() => setAccessDraft({ phone: '', display_name: '', role: 'user', ministry_ids: [] })}>Reset</button>
            {accessStatus && <p className="saved">{accessStatus}</p>}
          </form>
        </div>

        <section className="card permission-matrix-card">
          <div className="rbac-section-head">
            <h3>Permission Matrix</h3>
            <p>Access capabilities by role</p>
          </div>
          <table className="permission-matrix">
            <thead>
              <tr>
                <th>Permission</th>
                <th>Chief Minister <span>Read Only</span></th>
                <th>Minister <span>Read Only</span></th>
                <th>Executive Assistant <span>Write Access</span></th>
                <th>Ministry Admin <span>Write Access</span></th>
                <th>General User <span>Read Only</span></th>
              </tr>
            </thead>
            <tbody>
              {[
                ['View all projects', 'Yes (All)', 'Yes (All)', 'Yes (All)', 'Yes (All)', 'Yes (All)'],
                ['Create project', 'No', 'No', 'Yes (All)', 'Yes (Within Ministry)', 'No'],
                ['Edit ministry projects', 'No', 'No', 'Yes (All)', 'Yes (Within Ministry)', 'No'],
                ['Approve ministry items', 'No', 'No', 'Yes (All)', 'Yes (Within Ministry)', 'No'],
                ['Manage branding', 'No', 'No', 'Yes', 'No', 'No'],
                ['Manage users', 'No', 'No', 'Yes', 'No', 'No'],
              ].map(row => (
                <tr key={row[0]}>
                  <td>{row[0]}</td>
                  {row.slice(1).map(value => <td key={value}><span className={value === 'No' ? 'deny-dot' : 'allow-dot'}>{value}</span></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="rbac-help-strip card">
          <span><Shield size={18} /> Role changes are logged and take effect immediately.</span>
          <button className="ghost-btn" type="button">View RBAC Guide</button>
        </div>
      </section>
      <form className="card admin-form" onSubmit={save}>
        <h3><Settings size={22} /> {t('admin', locale)}</h3>
        <label>{t('selectRegion', locale)}
          <select value={draft.region || 'global'} onChange={e => applyRegion(e.target.value)}>
            {REGIONS.map(region => <option key={region.id} value={region.id}>{region.flag} {region.label}</option>)}
          </select>
        </label>
        <label>{t('language', locale)}
          <select value={draft.locale || locale} onChange={e => setDraft({ ...draft, locale: e.target.value })}>
            {LOCALES.map(item => <option key={item.id} value={item.id}>{item.flag} {item.label}</option>)}
          </select>
        </label>
        <label>{t('organisationType', locale)}
          <select value={draft.org_type || 'enterprise'} onChange={e => setDraft({ ...draft, org_type: e.target.value })}>
            <option value="enterprise">{t('enterprise', locale)}</option>
            <option value="public_sector">{t('publicSector', locale)}</option>
            <option value="government">{t('government', locale)}</option>
          </select>
        </label>
        <label>{t('currency', locale)}<input value={draft.currency || 'USD'} onChange={e => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} /></label>
        <label>{t('timezone', locale)}<input value={draft.timezone || 'UTC'} onChange={e => setDraft({ ...draft, timezone: e.target.value })} /></label>
        <label>{t('dashboardTitle', locale)}<input value={draft.title || ''} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label>{t('orgNameLabel', locale)}<input value={draft.department || ''} onChange={e => setDraft({ ...draft, department: e.target.value })} /></label>
        <label>{t('bannerMessage', locale)}<input value={draft.banner || ''} onChange={e => setDraft({ ...draft, banner: e.target.value })} /></label>
        <label className="upload-box"><ImagePlus size={24} /> Upload logo<input type="file" accept="image/*" onChange={uploadLogo} /></label>
        <button className="primary-btn" type="submit"><Upload size={18} /> {t('saveBranding', locale)}</button>
        <button className="ghost-btn" type="button" onClick={vectorize}><Brain size={17} /> {t('vectorize', locale)}</button>
        <button className="ghost-btn danger" type="button" onClick={reseed}>{t('resetDemo', locale)}</button>
        <div className="vector-status">
          <span>Vector Search Readiness</span>
          <p>{vectorReadiness?.native_ready ? 'MongoDB Atlas native search active' : 'Local vector fallback active'}</p>
          <small>{vectorReadiness?.entity_vectors || 0} workflow vectors | {vectorReadiness?.document_vectors || 0} document vectors</small>
          <small>{vectorReadiness?.embedding_provider?.provider || 'embedding'} | {vectorReadiness?.embedding_provider?.model || 'model not loaded'}</small>
          <small>Entity index {vectorReadiness?.entity_index?.present ? 'ready' : 'not visible'} | Document index {vectorReadiness?.document_index?.present ? 'ready' : 'not visible'}</small>
        </div>
        {saved && <p className="saved">Saved</p>}
        {vectorStatus && <p className="saved">{vectorStatus}</p>}
      </form>
      <form className="card admin-form admin-dev-panel" onSubmit={e => { e.preventDefault(); saveAppMode(); }}>
        <h3>Demo / Dev Mode</h3>
        <div className="admin-mode-row">
          <span>Current mode</span>
          <span className={`mode-badge ${appModeDraft.mode}`}>{appModeDraft.mode === 'dev' ? 'Development' : 'Production'}</span>
        </div>
        <label>
          Application mode
          <select value={appModeDraft.mode} onChange={e => setAppModeDraft(prev => ({ ...prev, mode: e.target.value }))}>
            <option value="dev">Development</option>
            <option value="prod">Production</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={appModeDraft.auto_load_demo}
            onChange={e => setAppModeDraft(prev => ({ ...prev, auto_load_demo: e.target.checked }))}
          />
          Auto-load bundled demo data when enabling dev mode
        </label>
        <button className="primary-btn" type="submit">Save mode</button>

        <div className="admin-dev-divider" />
        <h4>Reseed demo data</h4>
        <p className="admin-dev-hint">Loads bundled <code>demo_data.json</code> or an uploaded JSON file. Admin users and branding settings are preserved.</p>
        {appModeDraft.mode === 'prod' && (
          <label className="checkbox-row confirm-row">
            <input type="checkbox" checked={confirmReseed} onChange={e => setConfirmReseed(e.target.checked)} />
            I confirm reseed in production mode
          </label>
        )}
        <label className="upload-box">
          Custom JSON (optional)
          <input type="file" accept="application/json,.json" onChange={e => setJsonFile(e.target.files?.[0] || null)} />
        </label>
        {jsonFile && <small className="admin-dev-file">Selected: {jsonFile.name}</small>}
        <button className="ghost-btn" type="button" onClick={reseedDemo}>Reseed from demo JSON</button>

        <div className="admin-dev-divider" />
        <h4>Database cleanup</h4>
        <p className="admin-dev-hint">Safely drops only empty collections not in the allowlist.</p>
        <button className="ghost-btn" type="button" onClick={loadCleanupPreview}>Preview cleanup</button>
        {cleanupPreview && (
          <div className="cleanup-preview">
            {cleanupPreview.will_drop?.length ? (
              <>
                <p>Will drop: {cleanupPreview.will_drop.join(', ')}</p>
                <button className="ghost-btn danger" type="button" onClick={runCleanup}>Run cleanup</button>
              </>
            ) : (
              <p>No empty orphan collections to drop.</p>
            )}
            {cleanupPreview.orphans?.filter(o => !o.safe_to_drop).length > 0 && (
              <small>Skipped (non-empty): {cleanupPreview.orphans.filter(o => !o.safe_to_drop).map(o => o.name).join(', ')}</small>
            )}
          </div>
        )}
        {devStatus && <p className="saved">{devStatus}</p>}
      </form>
      </div>
      <div className="card preview-card">
        <h3>{t('pagePreview', locale)}</h3>
        <div className="preview-hero">
          {draft.logo_url ? <img src={draft.logo_url} alt="" /> : <Shield size={42} />}
          <h2>{draft.title || t('appName', locale)}</h2>
          <p>{draft.department || deptLabel(draft.org_type || 'enterprise', locale)}</p>
          <span>{draft.banner || t('tagline', locale)}</span>
          <div className="preview-meta">
            <span>{regionById(draft.region || 'global').flag} {regionById(draft.region || 'global').label}</span>
            <span>{draft.currency || 'USD'}</span>
            <span>{draft.timezone || 'UTC'}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function percent(count, total) {
  return total ? Math.round((count / total) * 100) : 0;
}

createRoot(document.getElementById('root')).render(<App />);
