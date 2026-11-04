import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Twitter, 
  Video, 
  Facebook, 
  CheckSquare, 
  Clock, 
  Settings as SettingsIcon, 
  ShieldAlert, 
  RefreshCw, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Sliders, 
  FileText, 
  ChevronRight,
  ShieldCheck,
  Zap
} from 'lucide-react';

interface Account {
  id: number;
  x_user_id?: string;
  username: string;
  name: string;
  avatar: string;
  followers: number;
  connected_status: string;
  last_checked: string;
}

interface VideoItem {
  id: number;
  account_id: number;
  x_post_id: string;
  post_text: string;
  original_video_url: string;
  thumbnail_url: string;
  duration: string;
  status: 'detected' | 'pending' | 'approved' | 'published' | 'failed';
  processed_video_path?: string;
  fb_post_id?: string;
  error_message?: string;
  ownership_confirmed: number;
  created_at: string;
  published_at?: string;
  account_username?: string;
  account_name?: string;
  account_avatar?: string;
}

interface ScheduleSlot {
  id: number;
  time_str: string;
  enabled: number;
  status: string;
}

interface LogItem {
  id: number;
  timestamp: string;
  level: string;
  message: string;
  details?: string;
}

interface Stats {
  totalAccounts: number;
  connectedAccounts: number;
  detectedVideos: number;
  pendingVideos: number;
  publishedVideos: number;
  failedVideos: number;
  dailyCount: number;
  maxDaily: number;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'accounts' | 'editor' | 'facebook' | 'approval' | 'schedule' | 'settings'>('dashboard');
  
  const [stats, setStats] = useState<Stats>({
    totalAccounts: 0,
    connectedAccounts: 0,
    detectedVideos: 0,
    pendingVideos: 0,
    publishedVideos: 0,
    failedVideos: 0,
    dailyCount: 0,
    maxDaily: 10
  });

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [schedules, setSchedules] = useState<ScheduleSlot[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null);
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false);

  // Demo connect form state
  const [demoUsername, setDemoUsername] = useState('PrajaSanketamNews');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const succ = params.get('success');
    const err = params.get('error');
    if (succ) {
      setSuccessMsg(succ.replace(/_/g, ' '));
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (err) {
      setErrorMsg(err.replace(/_/g, ' '));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const loadData = async () => {
    try {
      const [statsRes, accountsRes, videosRes, schedulesRes, logsRes, settingsRes] = await Promise.all([
        fetch('/api/dashboard/stats').then(r => r.json()),
        fetch('/api/accounts').then(r => r.json()),
        fetch('/api/videos').then(r => r.json()),
        fetch('/api/schedules').then(r => r.json()),
        fetch('/api/logs').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
      ]);

      setStats(statsRes);
      setAccounts(accountsRes);
      setVideos(videosRes);
      setSchedules(schedulesRes);
      setLogs(logsRes);
      setSettings(settingsRes);
    } catch (err) {
      console.error('Error loading data:', err);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleConnectX = async () => {
    try {
      setErrorMsg('');
      const res = await fetch('/api/auth/x/init');
      const data = await res.json();
      if (res.ok && data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        if (data.needsConfig) {
          setErrorMsg(`${data.error} You can also use Sandbox Connect below for instant testing.`);
        } else {
          setErrorMsg(data.error || 'Failed to initialize X OAuth');
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleDemoConnectX = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/x/demo-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: demoUsername })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(`Successfully connected X account @${demoUsername} in Sandbox Mode.`);
        loadData();
      } else {
        setErrorMsg(data.error);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleTestXConnection = async (id: number) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`/api/accounts/${id}/test`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(data.message || 'X Account verified successfully.');
        loadData();
      } else {
        setErrorMsg(data.error || 'X connection test failed.');
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnectX = async (id: number) => {
    if (!confirm('Disconnect this X account?')) return;
    try {
      await fetch(`/api/accounts/${id}/disconnect`, { method: 'POST' });
      setSuccessMsg('X account disconnected.');
      loadData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleDeleteAccount = async (id: number) => {
    if (!confirm('Remove this monitored account?')) return;
    try {
      await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
      loadData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleConnectFacebook = async () => {
    try {
      setErrorMsg('');
      const res = await fetch('/api/auth/fb/init');
      const data = await res.json();
      if (res.ok && data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        if (data.needsConfig) {
          setErrorMsg(`${data.error} You can also use Sandbox Connect below for instant testing.`);
        } else {
          setErrorMsg(data.error || 'Failed to initialize Facebook OAuth');
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleDemoConnectFacebook = async () => {
    try {
      const res = await fetch('/api/auth/fb/demo-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageName: 'Praja sanketam' })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg('Successfully connected Facebook Page "Praja sanketam" in Sandbox Mode.');
        loadData();
      } else {
        setErrorMsg(data.error);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleTestFacebookConnection = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/auth/fb/test', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(data.message || 'Facebook Page verified successfully.');
        loadData();
      } else {
        setErrorMsg(data.error || 'Facebook verification failed.');
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnectFacebook = async () => {
    if (!confirm('Disconnect Facebook Page?')) return;
    try {
      await fetch('/api/auth/fb/disconnect', { method: 'POST' });
      setSuccessMsg('Facebook Page disconnected.');
      loadData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleScanFeed = async () => {
    setScanning(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetch('/api/accounts/scan', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(`Scan complete! Detected ${data.newDetected} new video posts from connected X accounts.`);
        loadData();
      } else {
        setErrorMsg(data.error || 'Failed to scan X accounts. Please connect an X account first.');
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setScanning(false);
    }
  };

  const handleProcessVideo = async (videoId: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/videos/${videoId}/process`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg('Video successfully processed with FFmpeg logo overlay branding!');
        loadData();
      } else {
        setErrorMsg(data.error);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePublishVideo = async (videoId: number) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`/api/videos/${videoId}/publish`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg('Video successfully published to Facebook Page "Praja sanketam"!');
        setSelectedVideo(null);
        loadData();
      } else {
        setErrorMsg(data.error);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateVideoStatus = async (videoId: number, status: string, ownership?: number) => {
    try {
      await fetch(`/api/videos/${videoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ownership_confirmed: ownership })
      });
      loadData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        setSuccessMsg('Settings saved successfully.');
        loadData();
      } else {
        setErrorMsg('Failed to save settings');
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Header */}
      <header className="bg-blue-950 border-b border-blue-900 sticky top-0 z-40 shadow-xl">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center shadow-lg shadow-red-900/40 font-bold text-xl border border-red-500/30">
              PS
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-wide text-white uppercase">Praja Sanketam</h1>
                <span className="text-xs bg-red-600 text-white font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider">Video Automation</span>
              </div>
              <p className="text-xs text-slate-400">Target Page: <strong className="text-slate-200">Praja sanketam</strong> (Meta Graph API)</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleScanFeed}
              disabled={scanning}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white px-4 py-2 rounded-xl text-sm font-bold transition shadow-lg shadow-red-600/30 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Scanning X Accounts...' : 'Scan X Accounts Now'}
            </button>
            <div className="hidden sm:flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800 text-xs text-slate-300">
              <span className={`w-2.5 h-2.5 rounded-full ${stats.connectedAccounts > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}></span>
              <span>{stats.connectedAccounts > 0 ? 'X & FB Connected' : 'Accounts Disconnected'}</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 flex overflow-x-auto space-x-1 no-scrollbar border-t border-blue-900/50 py-2">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
            { id: 'accounts', label: 'X Accounts', icon: Twitter, count: accounts.length },
            { id: 'editor', label: 'Video & Logo Editor', icon: Video, count: videos.length },
            { id: 'facebook', label: 'Facebook Page', icon: Facebook },
            { id: 'approval', label: 'Approval Center', icon: CheckSquare, count: videos.filter(v => v.status === 'pending' || v.status === 'detected').length },
            { id: 'schedule', label: 'Schedule & Queue', icon: Clock },
            { id: 'settings', label: 'Settings & Logs', icon: SettingsIcon },
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition whitespace-nowrap cursor-pointer ${
                  isActive 
                    ? 'bg-red-600 text-white shadow-md shadow-red-600/30' 
                    : 'text-slate-300 hover:bg-blue-900/60 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${isActive ? 'bg-white text-red-700' : 'bg-blue-900 text-slate-200'}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8 flex-1 w-full">
        {successMsg && (
          <div className="mb-6 bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 px-4 py-3 rounded-2xl flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span className="text-sm font-medium">{successMsg}</span>
            </div>
            <button onClick={() => setSuccessMsg('')} className="text-emerald-400 hover:text-emerald-200 font-bold">&times;</button>
          </div>
        )}

        {errorMsg && (
          <div className="mb-6 bg-red-950/80 border border-red-500/50 text-red-200 px-4 py-3 rounded-2xl flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
              <span className="text-sm font-medium">{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg('')} className="text-red-400 hover:text-red-200 font-bold">&times;</button>
          </div>
        )}

        {/* 1. DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-fadeIn">
            <div>
              <h2 className="text-2xl font-black text-white">Automation Command Center</h2>
              <p className="text-sm text-slate-400">Monitoring authorized X accounts, applying FFmpeg branding overlays, and publishing to Facebook Page "Praja sanketam".</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
              {[
                { title: 'Connected X', value: `${stats.connectedAccounts} / ${stats.totalAccounts}`, max: 'Max 10', icon: Twitter, color: 'text-blue-400', bg: 'bg-blue-950/50 border-blue-900/50' },
                { title: 'Detected', value: stats.detectedVideos, icon: Video, color: 'text-indigo-400', bg: 'bg-indigo-950/50 border-indigo-900/50' },
                { title: 'Pending Review', value: stats.pendingVideos, icon: CheckSquare, color: 'text-amber-400', bg: 'bg-amber-950/50 border-amber-900/50' },
                { title: 'Published', value: stats.publishedVideos, icon: Facebook, color: 'text-emerald-400', bg: 'bg-emerald-950/50 border-emerald-900/50' },
                { title: 'Failed Uploads', value: stats.failedVideos, icon: XCircle, color: 'text-red-400', bg: 'bg-red-950/50 border-red-900/50' },
                { title: 'Daily Limit', value: `${stats.dailyCount} / ${stats.maxDaily}`, icon: Clock, color: 'text-purple-400', bg: 'bg-purple-950/50 border-purple-900/50' },
              ].map((stat, idx) => {
                const Icon = stat.icon;
                return (
                  <div key={idx} className={`p-5 rounded-2xl border ${stat.bg} shadow-lg backdrop-blur flex flex-col justify-between`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{stat.title}</span>
                      <Icon className={`w-5 h-5 ${stat.color}`} />
                    </div>
                    <div>
                      <div className="text-3xl font-black text-white">{stat.value}</div>
                      {stat.max && <span className="text-xs text-slate-500 font-semibold">{stat.max}</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <Facebook className="w-5 h-5 text-blue-500" />
                      Target Facebook Page
                    </h3>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${settings.fb_connection_status === 'connected' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                      {settings.fb_connection_status === 'connected' ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Page Name:</span>
                      <span className="font-bold text-white">{settings.fb_page_name || 'Praja sanketam'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Meta Graph API:</span>
                      <span className="font-mono text-xs text-blue-400">v19.0 Active</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('facebook')}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-sm transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  Manage Facebook Connection <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <Twitter className="w-5 h-5 text-sky-400" />
                      X Account Connection
                    </h3>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${stats.connectedAccounts > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                      {stats.connectedAccounts} Connected
                    </span>
                  </div>
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Auth Flow:</span>
                      <span className="font-bold text-white">OAuth 2.0 PKCE / Sandbox</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Limit:</span>
                      <span className="font-mono text-xs text-slate-300">Up to 10 Accounts</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('accounts')}
                  className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-2.5 rounded-xl text-sm transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  Connect X Accounts <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <ShieldAlert className="w-5 h-5 text-amber-500" />
                      Approval & Security
                    </h3>
                    <span className="text-xs bg-amber-500/20 text-amber-400 px-2.5 py-1 rounded-full font-bold">Strict Rule</span>
                  </div>
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2 mb-4">
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Manual approval required by default. Ownership and reuse-permission confirmation is mandatory for every published video.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('approval')}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-xl text-sm transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  Review Pending Videos <ChevronRight className="w-4 h-4" />
                </button>
              </div>

            </div>
          </div>
        )}

        {/* 2. X ACCOUNT MANAGEMENT TAB */}
        {activeTab === 'accounts' && (
          <div className="space-y-8 animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black text-white">Monitored X Accounts</h2>
                <p className="text-sm text-slate-400">Connect up to 10 authorized X accounts via official OAuth or Sandbox mode for instant testing.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleConnectX}
                  className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition shadow-lg cursor-pointer"
                >
                  <Twitter className="w-4 h-4" />
                  Official X OAuth
                </button>
                <button
                  onClick={handleScanFeed}
                  disabled={scanning}
                  className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition shadow-lg cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
                  Scan Feed
                </button>
              </div>
            </div>

            {/* Sandbox Quick Connect Card to prevent login errors when client ID isn't configured */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl">
              <h3 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-400" />
                Instant Sandbox / Demo Connect (Bypasses missing Client ID errors)
              </h3>
              <form onSubmit={handleDemoConnectX} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <input
                    type="text"
                    value={demoUsername}
                    onChange={e => setDemoUsername(e.target.value)}
                    placeholder="Enter X Username (e.g. PrajaSanketamNews)"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500"
                    required
                  />
                </div>
                <div>
                  <button
                    type="submit"
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-sm transition shadow cursor-pointer"
                  >
                    Connect in Sandbox Mode
                  </button>
                </div>
              </form>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {accounts.map(account => (
                <div key={account.id} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <img src={account.avatar} alt="" className="w-14 h-14 rounded-2xl object-cover border-2 border-slate-700 shadow" />
                      <span className={`text-xs px-3 py-1 rounded-full font-bold flex items-center gap-1.5 uppercase ${
                        account.connected_status === 'connected' ? 'bg-emerald-500/20 text-emerald-400' :
                        account.connected_status === 'expired' ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        <span className={`w-2 h-2 rounded-full ${account.connected_status === 'connected' ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                        {account.connected_status}
                      </span>
                    </div>
                    <h4 className="text-lg font-bold text-white">{account.name}</h4>
                    <p className="text-sm font-mono text-sky-400 mb-4">@{account.username}</p>
                    <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs text-slate-400 space-y-1 mb-4">
                      <div className="flex justify-between">
                        <span>Followers:</span>
                        <span className="text-white font-bold">{account.followers.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Last Verified:</span>
                        <span className="text-white">{account.last_checked ? new Date(account.last_checked).toLocaleTimeString() : 'Never'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                    <button
                      onClick={() => handleTestXConnection(account.id)}
                      disabled={loading}
                      className="text-xs bg-slate-800 hover:bg-slate-700 text-white font-bold px-3 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Test Connection
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDisconnectX(account.id)}
                        className="text-xs text-amber-400 hover:text-amber-300 font-bold cursor-pointer"
                      >
                        Disconnect
                      </button>
                      <button
                        onClick={() => handleDeleteAccount(account.id)}
                        className="text-xs text-red-400 hover:text-red-300 font-bold cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. VIDEO & LOGO EDITOR TAB */}
        {activeTab === 'editor' && (
          <div className="space-y-8 animate-fadeIn">
            <div>
              <h2 className="text-2xl font-black text-white">Video & Logo Overlay Editor</h2>
              <p className="text-sm text-slate-400">Process MP4 videos with FFmpeg PNG transparent logo overlay, custom opacity and positions.</p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
              <h3 className="text-lg font-bold text-white">Detected & Processed Video Library</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {videos.map(video => (
                  <div key={video.id} className="bg-slate-950 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-lg">
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold font-mono bg-red-600/20 text-red-400 px-2 py-0.5 rounded">ID #{video.id}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-bold uppercase ${
                            video.status === 'published' ? 'bg-emerald-500/20 text-emerald-400' :
                            video.status === 'approved' ? 'bg-blue-500/20 text-blue-400' :
                            video.status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                          }`}>
                            {video.status}
                          </span>
                        </div>
                        <span className="text-xs text-slate-400">{video.duration}</span>
                      </div>

                      <p className="text-xs text-slate-300 line-clamp-3 mb-4">{video.post_text}</p>

                      <div className="aspect-video bg-slate-900 rounded-xl overflow-hidden mb-4 relative flex items-center justify-center border border-slate-800">
                        {video.processed_video_path ? (
                          <div className="absolute inset-0 bg-emerald-950/40 flex flex-col items-center justify-center p-4 text-center">
                            <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-2" />
                            <span className="text-xs font-bold text-white">Branded Overlay Applied</span>
                            <span className="text-[10px] text-emerald-300 font-mono mt-1">{video.processed_video_path}</span>
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                            <Video className="w-10 h-10 text-slate-600 mb-2" />
                            <span className="text-xs text-slate-400">Original MP4 Video</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t border-slate-900">
                      <button
                        onClick={() => handleProcessVideo(video.id)}
                        disabled={loading}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow cursor-pointer disabled:opacity-50"
                      >
                        <Sliders className="w-3.5 h-3.5" />
                        Apply FFmpeg Overlay
                      </button>

                      <button
                        onClick={() => { setSelectedVideo(video); setOwnershipConfirmed(Boolean(video.ownership_confirmed)); setActiveTab('approval'); }}
                        className="text-xs bg-slate-800 hover:bg-slate-700 text-white font-bold px-3 py-2 rounded-xl transition cursor-pointer"
                      >
                        Review & Publish &rarr;
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 4. FACEBOOK PAGE TAB */}
        {activeTab === 'facebook' && (
          <div className="space-y-8 animate-fadeIn">
            <div>
              <h2 className="text-2xl font-black text-white">Facebook Page Integration</h2>
              <p className="text-sm text-slate-400">Connect securely to target page <strong className="text-white">Praja sanketam</strong> via official Meta OAuth or Sandbox mode.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-xl space-y-6">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Facebook className="w-5 h-5 text-blue-500" />
                  Meta Page Connection Status
                </h3>

                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs text-slate-400 block mb-1">Target Page Name</span>
                      <span className="text-lg font-bold text-white">{settings.fb_page_name || 'Praja sanketam'}</span>
                    </div>
                    <span className={`text-xs px-3 py-1 rounded-full font-bold uppercase ${settings.fb_connection_status === 'connected' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                      {settings.fb_connection_status || 'disconnected'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-slate-900 text-xs">
                    <span className="text-slate-400">Page ID: <strong className="text-white font-mono">{settings.fb_page_id || 'Not Connected'}</strong></span>
                    <span className="text-slate-400">Permissions: <strong className="text-emerald-400">pages_manage_posts</strong></span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <button
                    onClick={handleConnectFacebook}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-xl text-sm transition shadow-lg cursor-pointer flex items-center gap-2"
                  >
                    <Facebook className="w-4 h-4" /> Official Meta OAuth Connect
                  </button>

                  <button
                    onClick={handleDemoConnectFacebook}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 rounded-xl text-sm transition shadow-lg cursor-pointer flex items-center gap-2"
                  >
                    <Zap className="w-4 h-4" /> Sandbox / Demo Connect Page
                  </button>

                  <button
                    onClick={handleTestFacebookConnection}
                    disabled={loading}
                    className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-5 py-3 rounded-xl text-sm transition cursor-pointer flex items-center gap-2"
                  >
                    <ShieldCheck className="w-4 h-4 text-emerald-400" /> Test Connection
                  </button>

                  {settings.fb_connection_status === 'connected' && (
                    <button
                      onClick={handleDisconnectFacebook}
                      className="bg-red-950 hover:bg-red-900 text-red-200 font-bold px-5 py-3 rounded-xl text-sm transition cursor-pointer"
                    >
                      Disconnect Page
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white mb-4">Publishing Requirements</h3>
                  <div className="space-y-4 text-xs text-slate-300">
                    <div className="flex items-start gap-3 bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>Official Graph API endpoint: <code className="text-blue-400">/v19.0/page-id/videos</code></span>
                    </div>
                    <div className="flex items-start gap-3 bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>Original post text is automatically appended as video description/caption.</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-slate-800">
                  <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    Secure Backend Token Storage Active
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 5. APPROVAL CENTER TAB */}
        {activeTab === 'approval' && (
          <div className="space-y-8 animate-fadeIn">
            <div>
              <h2 className="text-2xl font-black text-white">Video Approval & Compliance Center</h2>
              <p className="text-sm text-slate-400">Manual review required by default. Ownership and reuse permission confirmation is mandatory.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              <div className="lg:col-span-2 space-y-4">
                {videos.map(video => (
                  <div key={video.id} className={`bg-slate-900 border rounded-3xl p-6 shadow-xl transition ${selectedVideo?.id === video.id ? 'border-red-500 ring-2 ring-red-500/20' : 'border-slate-800'}`}>
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex items-center gap-3">
                        <img src={video.account_avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150'} alt="" className="w-12 h-12 rounded-full object-cover" />
                        <div>
                          <h4 className="text-sm font-bold text-white">@{video.account_username || 'PrajaSanketam'}</h4>
                          <span className="text-xs text-slate-400">{new Date(video.created_at).toLocaleString()}</span>
                        </div>
                      </div>
                      <span className={`text-xs px-3 py-1 rounded-full font-bold uppercase ${
                        video.status === 'published' ? 'bg-emerald-500/20 text-emerald-400' :
                        video.status === 'approved' ? 'bg-blue-500/20 text-blue-400' :
                        video.status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                      }`}>
                        {video.status}
                      </span>
                    </div>

                    <p className="text-sm text-slate-200 mb-4 bg-slate-950 p-4 rounded-2xl border border-slate-800">{video.post_text}</p>

                    <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${video.ownership_confirmed ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                        <span className="text-xs text-slate-300 font-medium">
                          {video.ownership_confirmed ? 'Ownership Confirmed' : 'Confirmation Pending'}
                        </span>
                      </div>

                      <button
                        onClick={() => { setSelectedVideo(video); setOwnershipConfirmed(Boolean(video.ownership_confirmed)); }}
                        className="text-xs bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-xl transition cursor-pointer"
                      >
                        Review & Inspect &rarr;
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col justify-between h-fit sticky top-24">
                {selectedVideo ? (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-bold text-white mb-2">Video Approval #{selectedVideo.id}</h3>
                      <p className="text-xs text-slate-400">Post ID: <span className="font-mono text-slate-300">{selectedVideo.x_post_id}</span></p>
                    </div>

                    <div className="aspect-video bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center border border-slate-800 relative">
                      <video
                        src={selectedVideo.processed_video_path ? selectedVideo.processed_video_path : selectedVideo.original_video_url}
                        controls
                        className="w-full h-full object-cover"
                      />
                    </div>

                    <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={ownershipConfirmed}
                          onChange={e => {
                            setOwnershipConfirmed(e.target.checked);
                            handleUpdateVideoStatus(selectedVideo.id, selectedVideo.status, e.target.checked ? 1 : 0);
                          }}
                          className="mt-1 w-4 h-4 rounded text-red-600 focus:ring-red-500 bg-slate-900 border-slate-700 cursor-pointer"
                        />
                        <span className="text-xs text-slate-200 leading-relaxed font-semibold">
                          I confirm ownership and valid reuse permission for this video content. Never republish without permission.
                        </span>
                      </label>
                    </div>

                    <div className="space-y-3">
                      <button
                        onClick={() => handleProcessVideo(selectedVideo.id)}
                        disabled={loading}
                        className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 rounded-xl text-sm transition cursor-pointer flex items-center justify-center gap-2"
                      >
                        <Sliders className="w-4 h-4" /> Apply FFmpeg Branding
                      </button>

                      <button
                        onClick={() => handlePublishVideo(selectedVideo.id)}
                        disabled={loading || !ownershipConfirmed}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition shadow-lg cursor-pointer flex items-center justify-center gap-2"
                      >
                        <Facebook className="w-4 h-4" /> Publish to Facebook Page Now
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-slate-500">
                    <CheckSquare className="w-12 h-12 mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium">Select a video from the list to review and confirm ownership.</p>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {/* 6. SCHEDULE & QUEUE TAB */}
        {activeTab === 'schedule' && (
          <div className="space-y-8 animate-fadeIn">
            <div>
              <h2 className="text-2xl font-black text-white">Publishing Schedule & Queue</h2>
              <p className="text-sm text-slate-400">Timezone: <strong className="text-white">Asia/Kolkata</strong> | Maximum 10 posts daily.</p>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-xl space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Default Daily Schedule Slots (10 Slots)</h3>
                <span className="text-xs bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full font-bold">Active Scheduler</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                {schedules.map(sched => (
                  <div key={sched.id} className="bg-slate-950 border border-slate-800 p-4 rounded-2xl text-center space-y-2">
                    <div className="text-xl font-black text-white font-mono">{sched.time_str}</div>
                    <span className="inline-block text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full font-bold uppercase">
                      {sched.status || 'Ready'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 7. SETTINGS & LOGS TAB */}
        {activeTab === 'settings' && (
          <div className="space-y-8 animate-fadeIn">
            <div>
              <h2 className="text-2xl font-black text-white">Settings & Activity Audit Logs</h2>
              <p className="text-sm text-slate-400">Configure API credentials, logo uploads, overlay settings and system audit trails.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-xl">
                <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                  <SettingsIcon className="w-5 h-5 text-red-500" />
                  API Credentials & Configuration
                </h3>

                <form onSubmit={handleSaveSettings} className="space-y-6">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">X Client ID (OAuth 2.0)</label>
                    <input
                      type="text"
                      name="x_client_id"
                      defaultValue={settings.x_client_id || ''}
                      placeholder="X API Client ID (optional if using Sandbox Mode)"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">Facebook App ID</label>
                    <input
                      type="text"
                      name="fb_client_id"
                      defaultValue={settings.fb_client_id || ''}
                      placeholder="Meta App ID (optional if using Sandbox Mode)"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">Max Daily Posts Limit</label>
                    <input
                      type="number"
                      name="max_daily_posts"
                      defaultValue={settings.max_daily_posts || '10'}
                      max="10"
                      min="1"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">Upload PNG Logo for FFmpeg Overlay</label>
                    <input
                      type="file"
                      name="logo_file"
                      accept="image/png"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-300 file:mr-4 file:py-1 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-red-600 file:text-white hover:file:bg-red-700 cursor-pointer"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="bg-red-600 hover:bg-red-700 text-white font-bold px-6 py-3 rounded-xl text-sm transition shadow-lg cursor-pointer"
                    >
                      Save Configuration
                    </button>
                  </div>
                </form>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-xl flex flex-col">
                <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-500" />
                  Activity Audit Logs
                </h3>

                <div className="flex-1 bg-slate-950 border border-slate-800 rounded-2xl p-4 overflow-y-auto max-h-[400px] space-y-3 font-mono text-xs">
                  {logs.map(log => (
                    <div key={log.id} className="border-b border-slate-900 pb-2">
                      <div className="flex items-center justify-between text-slate-500 mb-1">
                        <span className={`font-bold uppercase ${log.level === 'error' ? 'text-red-400' : log.level === 'success' ? 'text-emerald-400' : 'text-blue-400'}`}>
                          [{log.level}]
                        </span>
                        <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-slate-200">{log.message}</p>
                      {log.details && <p className="text-slate-400 text-[10px] mt-0.5">{log.details}</p>}
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}

      </main>

      <footer className="bg-blue-950 border-t border-blue-900 py-6 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 Praja Sanketam Video Automation. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <span>Target Page: Praja sanketam</span>
            <span>•</span>
            <span>Max 10 Posts Daily</span>
            <span>•</span>
            <span>OAuth & Sandbox Mode Active</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
