import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Edit3,
  Eye,
  FileText,
  Home,
  Laptop,
  LayoutGrid,
  List,
  Menu,
  MoreVertical,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Truck,
  X
} from 'lucide-react';
import { appUrl, supabase, syncEnabled } from './supabaseClient';
import { localLogin, localLogout, localMe, localSignup, localToken, saveLocalData } from './localApi';
import './styles.css';

const jobsSeed = [];
const shiftsSeed = [];
const shiftTemplates = [];
const defaultCurrencySettings = { defaultCurrency: 'USD', enabledCurrencies: ['USD', 'CAD', 'INR'] };
const defaultAppSettings = {
  preferences: {
    language: 'English',
    timezone: 'UTC-05:00',
    weekStart: 'Monday',
    defaultBreak: '0',
    dateFormat: 'MMM d, yyyy',
    timeFormat: '12-hour',
    defaultDuration: '8',
    overtimeThreshold: '8',
    rounding: '15',
    currency: 'USD',
    defaultRate: '20.00',
    overtimeMultiplier: '1.50',
    doubleTimeMultiplier: '2.00'
  },
  toggles: {
    autoEndBreak: true,
    addRateToJobs: true,
    'Shift reminders': true,
    'Overtime alerts': true,
    'Daily summary': false,
    'Weekly summary': true,
    'System updates': true,
    darkMode: false
  }
};

const jobTypeOptions = ['Retail', 'Food Service', 'Delivery', 'Healthcare', 'Office', 'Freelance', 'Education', 'Hospitality', 'Other'];

const nav = [
  ['dashboard', 'Dashboard', Home],
  ['shifts', 'Shifts', CalendarDays],
  ['jobs', 'Jobs', BriefcaseBusiness],
  ['templates', 'Templates', FileText],
  ['calendar', 'Calendar', CalendarDays],
  ['reports', 'Reports', BarChart3],
  ['settings', 'Settings', Settings]
];

const mobileNavItems = nav.filter(([id]) => ['dashboard', 'shifts', 'calendar', 'reports', 'settings'].includes(id));

let runtimePreferences = defaultAppSettings.preferences;

const createId = (prefix = 'id') => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
};

const localeFor = (language = runtimePreferences.language) => ({
  English: 'en-US',
  French: 'fr-FR',
  Spanish: 'es-ES',
  Chinese: 'zh-CN',
  Hindi: 'hi-IN'
}[language] || 'en-US');

const offsetMinutesFor = (timezone = runtimePreferences.timezone) => {
  const match = timezone.match(/^UTC([+-])(\d{2}):(\d{2})$/);
  if (!match) return -300;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '+' ? minutes : -minutes;
};

const getTodayIso = (preferences = runtimePreferences) => {
  preferences = preferences || runtimePreferences;
  const now = new Date();
  const local = new Date(now.getTime() + offsetMinutesFor(preferences.timezone) * 60000);
  return local.toISOString().slice(0, 10);
};

const fmtDate = (iso, compact = false, preferences = runtimePreferences) => {
  if (!iso) return '-';
  const date = new Date(`${iso}T12:00:00`);
  const locale = localeFor(preferences.language);
  if (compact) return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  if (preferences.dateFormat === 'yyyy-MM-dd') return iso;
  if (preferences.dateFormat === 'MM/dd/yyyy') {
    return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
  }
  if (preferences.dateFormat === 'dd/MM/yyyy') {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  }
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', weekday: 'short' });
};

const fmtTime = (time, preferences = runtimePreferences) => {
  if (!time) return '-';
  const [h, m] = time.split(':').map(Number);
  if (preferences.timeFormat === '24-hour') return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
};

const minutesFromTime = (time) => {
  if (!time) return 0;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const timeFromMinutes = (minutes) => {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
};

const parseTimeInput = (value) => {
  const text = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return '';
  const match = text.match(/^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm)?$/);
  if (!match) return '';
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = match[3];
  if (minutes > 59) return '';
  if (meridiem) {
    if (hours < 1 || hours > 12) return '';
    if (meridiem.startsWith('p') && hours < 12) hours += 12;
    if (meridiem.startsWith('a') && hours === 12) hours = 0;
  } else if (hours > 23) {
    return '';
  }
  return timeFromMinutes(hours * 60 + minutes);
};

const durationMinutesFor = (hours = runtimePreferences.defaultDuration) => Math.max(0, Math.round((Number(hours) || 0) * 60));

const roundingMinutesFor = (value = runtimePreferences.rounding) => Math.max(0, Number(value) || 0);

const roundedMinutes = (minutes, interval = roundingMinutesFor()) => interval > 0 ? Math.round(minutes / interval) * interval : minutes;

const shiftHours = (shift) => {
  if (!shift.start || !shift.end) return 0;
  let mins = minutesFromTime(shift.end) - minutesFromTime(shift.start);
  if (mins < 0) mins += 24 * 60;
  const payable = Math.max(0, mins - Number(shift.breakMins || 0));
  return roundedMinutes(payable) / 60;
};

const payBreakdown = (job, shift, preferences = runtimePreferences) => {
  const rate = Number(job?.rate) || 0;
  const hours = shiftHours(shift);
  const overtimeThreshold = Number(preferences.overtimeThreshold) || 8;
  const doubleTimeThreshold = overtimeThreshold + 4;
  const overtimeMultiplier = Number(preferences.overtimeMultiplier) || 1.5;
  const doubleTimeMultiplier = Number(preferences.doubleTimeMultiplier) || 2;
  const regularHours = Math.min(hours, overtimeThreshold);
  const overtimeHours = Math.max(0, Math.min(hours, doubleTimeThreshold) - overtimeThreshold);
  const doubleTimeHours = Math.max(0, hours - doubleTimeThreshold);
  const earnings = (regularHours * rate) + (overtimeHours * rate * overtimeMultiplier) + (doubleTimeHours * rate * doubleTimeMultiplier);
  return { hours, regularHours, overtimeHours, doubleTimeHours, earnings };
};

const fmtHours = (hours) => {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
};

const currencyOptions = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'PHP', name: 'Philippine Peso' },
  { code: 'MYR', name: 'Malaysian Ringgit' },
  { code: 'IDR', name: 'Indonesian Rupiah' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'SAR', name: 'Saudi Riyal' }
];

const money = (value, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);

const userDisplayName = (user, fallback = 'User') =>
  user?.user_metadata?.full_name ||
  user?.user_metadata?.name ||
  user?.identities?.[0]?.identity_data?.full_name ||
  user?.identities?.[0]?.identity_data?.name ||
  user?.name ||
  user?.email?.split('@')[0] ||
  fallback;

const toDate = (iso) => new Date(`${iso}T12:00:00`);
const isoDate = (date) => date.toISOString().slice(0, 10);
const startOfWeek = (date) => {
  const next = new Date(date);
  const firstDay = { Sunday: 0, Monday: 1, Saturday: 6 }[runtimePreferences.weekStart] ?? 1;
  const day = (next.getDay() - firstDay + 7) % 7;
  next.setDate(next.getDate() - day);
  return next;
};
const endOfWeek = (date) => {
  const next = startOfWeek(date);
  next.setDate(next.getDate() + 6);
  return next;
};
const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1, 12);
const endOfMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
const inRange = (shift, start, end) => {
  const date = toDate(shift.date);
  return date >= start && date <= end;
};
const rangeLabel = (start, end) => `${fmtDate(isoDate(start), true)} - ${fmtDate(isoDate(end), true)}, ${end.getFullYear()}`;
const dateRangeFor = (range, anchorIso = getTodayIso()) => {
  const anchor = toDate(anchorIso);
  if (range === 'week') return [startOfWeek(anchor), endOfWeek(anchor)];
  if (range === 'month') return [startOfMonth(anchor), endOfMonth(anchor)];
  if (range === 'year') return [new Date(anchor.getFullYear(), 0, 1, 12), new Date(anchor.getFullYear(), 11, 31, 12)];
  return [new Date(2000, 0, 1, 12), new Date(2100, 0, 1, 12)];
};
const filterByDateSpan = (shifts, start, end) => shifts.filter((shift) => inRange(shift, start, end));
const filterByRange = (shifts, range, anchorIso = getTodayIso()) => {
  const [start, end] = dateRangeFor(range, anchorIso);
  return filterByDateSpan(shifts, start, end);
};
const previousDateSpan = (start, end) => {
  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - days + 1);
  return [previousStart, previousEnd];
};
const previousRange = (range, anchorIso = getTodayIso()) => {
  const anchor = toDate(anchorIso);
  if (range === 'week') anchor.setDate(anchor.getDate() - 7);
  if (range === 'month') anchor.setMonth(anchor.getMonth() - 1);
  if (range === 'year') anchor.setFullYear(anchor.getFullYear() - 1);
  return filterByRange(shiftsSeed, range, isoDate(anchor));
};
const percentTrend = (current, previous) => previous ? Math.round(((current - previous) / previous) * 100) : Math.round(current ? 100 : 0);
const hoursFor = (shifts) => shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
const earningsFor = (jobs, shifts) => shifts.reduce((sum, shift) => sum + payBreakdown(jobs.find((job) => job.id === shift.jobId), shift).earnings, 0);
const matchesText = (text, query) => text.toLowerCase().includes(query.trim().toLowerCase());
const normalizeTime = (value) => value ? value.slice(0, 5) : '';
const upcomingShifts = (shifts, limit = 5) =>
  shifts
    .filter((shift) => toDate(shift.date) >= toDate(getTodayIso()))
    .sort((a, b) => a.date.localeCompare(b.date) || normalizeTime(a.start).localeCompare(normalizeTime(b.start)))
    .slice(0, limit);

const timePickerOptions = Array.from({ length: 96 }, (_, index) => timeFromMinutes(index * 15));

const toJobRow = (job, userId) => ({
  id: job.id,
  user_id: userId,
  name: job.name,
  employer: job.employer,
  type: job.type,
  rate: Number(job.rate) || 0,
  pay_type: job.payType,
  color: job.color,
  bg: job.bg,
  active: job.active
});

const fromJobRow = (row) => ({
  id: row.id,
  name: row.name,
  employer: row.employer || '',
  type: row.type || '',
  rate: Number(row.rate) || 0,
  payType: row.pay_type || 'Hourly',
  color: row.color || '#2563eb',
  bg: row.bg || '#dbeafe',
  active: row.active
});

const toShiftRow = (shift, userId) => ({
  id: String(shift.id),
  user_id: userId,
  job_id: shift.jobId,
  title: shift.title,
  date: shift.date,
  start_time: shift.start || null,
  end_time: shift.end || null,
  break_mins: Number(shift.breakMins) || 0,
  paid_break: Number(shift.paidBreak) || 0,
  notes: shift.notes,
  status: shift.status || 'Recorded',
  location: shift.location,
  currency: shift.currency || runtimePreferences.currency || defaultCurrencySettings.defaultCurrency
});

const fallbackJob = {
  id: '',
  name: 'No Job Selected',
  employer: '',
  type: 'Create a job first',
  rate: 0,
  payType: 'Hourly',
  color: '#64748b',
  bg: '#f1f5f9',
  active: false
};

const toTemplateRow = (template, userId) => ({
  id: template.id,
  user_id: userId,
  name: template.name,
  description: template.description,
  job_id: template.jobId,
  title: template.title,
  start_time: template.start || null,
  end_time: template.end || null,
  break_mins: Number(template.breakMins) || 0,
  paid_break: Number(template.paidBreak) || 0,
  location: template.location,
  notes: template.notes,
  tags: template.tags || [],
  display_time: template.displayTime || null
});

const fromShiftRow = (row) => ({
  id: row.id,
  jobId: row.job_id,
  title: row.title || '',
  date: row.date,
  start: row.start_time?.slice(0, 5) || '',
  end: row.end_time?.slice(0, 5) || '',
  breakMins: row.break_mins || 0,
  paidBreak: row.paid_break || 0,
  notes: row.notes || '',
  status: row.status || 'Recorded',
  location: row.location || '',
  currency: row.currency || runtimePreferences.currency || defaultCurrencySettings.defaultCurrency
});

const fromTemplateRow = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description || '',
  jobId: row.job_id,
  title: row.title || '',
  start: row.start_time?.slice(0, 5) || '',
  end: row.end_time?.slice(0, 5) || '',
  breakMins: row.break_mins || 0,
  paidBreak: row.paid_break || 0,
  location: row.location || '',
  notes: row.notes || '',
  tags: row.tags || [],
  displayTime: row.display_time || undefined
});

const mergeAppSettings = (settings = {}, currency = defaultCurrencySettings) => ({
  preferences: {
    ...defaultAppSettings.preferences,
    ...(settings.preferences || {}),
    currency: currency.defaultCurrency
  },
  toggles: {
    ...defaultAppSettings.toggles,
    ...(settings.toggles || {})
  }
});

async function loadCloudData(userId) {
  const [{ data: jobsData, error: jobsError }, { data: shiftsData, error: shiftsError }, { data: templatesData, error: templatesError }, { data: settingsData, error: settingsError }] = await Promise.all([
    supabase.from('jobs').select('*').eq('user_id', userId).order('created_at'),
    supabase.from('shifts').select('*').eq('user_id', userId).order('date', { ascending: false }),
    supabase.from('shift_templates').select('*').eq('user_id', userId).order('created_at'),
    supabase.from('app_settings').select('app_settings,currency_settings').eq('user_id', userId).maybeSingle()
  ]);
  if (jobsError) throw jobsError;
  if (shiftsError) throw shiftsError;
  if (templatesError) throw templatesError;
  if (settingsError) throw settingsError;
  const currencySettings = settingsData?.currency_settings || defaultCurrencySettings;
  return {
    jobs: jobsData.map(fromJobRow),
    shifts: shiftsData.map(fromShiftRow),
    templates: templatesData.map(fromTemplateRow),
    currencySettings,
    appSettings: mergeAppSettings(settingsData?.app_settings, currencySettings)
  };
}

async function ensureCloudProfile(user) {
  await supabase.from('profiles').upsert({
    id: user.id,
    full_name: userDisplayName(user, 'User'),
    email: user.email
  });
}

function App() {
  const [page, setPage] = useState('dashboard');
  const [jobs, setJobs] = useState(jobsSeed);
  const [shifts, setShifts] = useState(shiftsSeed);
  const [templates, setTemplates] = useState(shiftTemplates);
  const [currencySettings, setCurrencySettings] = useState(defaultCurrencySettings);
  const [appSettings, setAppSettings] = useState(() => mergeAppSettings(defaultAppSettings, defaultCurrencySettings));
  const [session, setSession] = useState(null);
  const [localUser, setLocalUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState(syncEnabled ? 'Checking account...' : 'Local');
  const [loadingCloud, setLoadingCloud] = useState(true);
  const [selectedJob, setSelectedJob] = useState(null);
  const [editingShift, setEditingShift] = useState(null);
  const [editingJob, setEditingJob] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);

  runtimePreferences = appSettings.preferences;
  const stats = useMemo(() => buildStats(jobs, shifts), [jobs, shifts, appSettings.preferences]);
  const user = session?.user;
  const activeUser = user || localUser;

  useEffect(() => {
    document.documentElement.dataset.theme = appSettings.toggles.darkMode ? 'dark' : 'light';
  }, [appSettings.toggles.darkMode]);

  useEffect(() => {
    document.body.classList.toggle('nav-lock', mobileNav);
    return () => document.body.classList.remove('nav-lock');
  }, [mobileNav]);

  const applyStoredData = (data = {}) => {
    const nextCurrencySettings = data.currencySettings || defaultCurrencySettings;
    setJobs(data.jobs || jobsSeed);
    setShifts(data.shifts || shiftsSeed);
    setTemplates(data.templates || shiftTemplates);
    setCurrencySettings(nextCurrencySettings);
    setAppSettings(mergeAppSettings(data.appSettings, nextCurrencySettings));
  };

  useEffect(() => {
    if (!syncEnabled) {
      if (!localToken()) {
        setLoadingCloud(false);
        return;
      }
      localMe()
        .then(({ user: nextUser, data }) => {
          setLocalUser(nextUser);
          applyStoredData(data);
          setSyncStatus('Local SQLite');
        })
        .catch(() => {
          setLocalUser(null);
          setSyncStatus('Local SQLite');
        })
        .finally(() => setLoadingCloud(false));
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingCloud(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setPage('dashboard');
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!syncEnabled || !user) return;

    let cancelled = false;
    setLoadingCloud(true);
    setSyncStatus('Syncing...');

    loadCloudData(user.id)
      .then(async (cloud) => {
        if (cancelled) return;
        await ensureCloudProfile(user);
        if (cancelled) return;
        setJobs(cloud.jobs);
        setShifts(cloud.shifts);
        setTemplates(cloud.templates);
        setCurrencySettings(cloud.currencySettings);
        setAppSettings(cloud.appSettings);
        setSyncStatus('Synced');
      })
      .catch((error) => setSyncStatus(error.message))
      .finally(() => {
        if (!cancelled) setLoadingCloud(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const navigate = (next) => {
    setPage(next);
    setSelectedJob(null);
    setEditingShift(null);
    setEditingJob(null);
    setMobileNav(false);
  };

  const saveShift = async (shift) => {
    const normalizedShift = { ...shift, title: String(shift.title || '').trim(), currency: shift.currency || currencySettings.defaultCurrency };
    if (!normalizedShift.jobId || !jobs.some((job) => job.id === normalizedShift.jobId)) {
      throw new Error('Please select a saved job before saving this shift.');
    }
    const savedShift = shift.id
      ? normalizedShift
      : { ...normalizedShift, id: createId('shift'), status: 'Recorded' };
    const nextShifts = shift.id
      ? shifts.map((item) => item.id === shift.id ? savedShift : item)
      : [savedShift, ...shifts];
    setShifts(nextShifts);
    if (syncEnabled && user) {
      setSyncStatus('Saving...');
      const { error } = await supabase.from('shifts').upsert(toShiftRow(savedShift, user.id));
      setSyncStatus(error ? error.message : 'Synced');
      if (error) throw new Error(error.message);
    }
    if (!syncEnabled && localUser) {
      await saveLocalData('jobs', jobs);
      await saveLocalData('shifts', nextShifts);
    }
    setPage('shifts');
    setEditingShift(null);
  };

  const deleteShift = async (id) => {
    const nextShifts = shifts.filter((item) => item.id !== id);
    setShifts(nextShifts);
    if (syncEnabled && user) {
      setSyncStatus('Saving...');
      const { error } = await supabase.from('shifts').delete().eq('id', String(id)).eq('user_id', user.id);
      setSyncStatus(error ? error.message : 'Synced');
    }
    if (!syncEnabled && localUser) await saveLocalData('shifts', nextShifts);
    setEditingShift(null);
    setPage('shifts');
  };

  const saveJob = async (job) => {
    const savedJob = job.id
      ? job
      : { ...job, id: job.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `job-${Date.now()}`, active: true };
    const nextJobs = job.id
      ? jobs.map((item) => item.id === job.id ? savedJob : item)
      : [...jobs, savedJob];
    setJobs(nextJobs);
    if (syncEnabled && user) {
      setSyncStatus('Saving...');
      const { error } = await supabase.from('jobs').upsert(toJobRow(savedJob, user.id));
      setSyncStatus(error ? error.message : 'Synced');
    }
    if (!syncEnabled && localUser) await saveLocalData('jobs', nextJobs);
    setEditingJob(null);
    setPage('jobs');
  };

  const saveTemplate = async (template) => {
    if (!template.jobId || !jobs.some((job) => job.id === template.jobId)) {
      throw new Error('Please select a saved job before saving this template.');
    }
    const savedTemplate = template.id
      ? template
      : { ...template, id: template.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `template-${Date.now()}` };
    const nextTemplates = template.id
      ? templates.map((item) => item.id === template.id ? savedTemplate : item)
      : [...templates, savedTemplate];
    setTemplates(nextTemplates);
    if (syncEnabled && user) {
      setSyncStatus('Saving...');
      const { error } = await supabase.from('shift_templates').upsert(toTemplateRow(savedTemplate, user.id));
      setSyncStatus(error ? error.message : 'Synced');
      if (error) throw new Error(error.message);
    }
    if (!syncEnabled && localUser) {
      await saveLocalData('jobs', jobs);
      await saveLocalData('templates', nextTemplates);
    }
  };

  const deleteTemplate = async (id) => {
    const nextTemplates = templates.filter((item) => item.id !== id);
    setTemplates(nextTemplates);
    if (syncEnabled && user) {
      setSyncStatus('Saving...');
      const { error } = await supabase.from('shift_templates').delete().eq('id', id).eq('user_id', user.id);
      setSyncStatus(error ? error.message : 'Synced');
    }
    if (!syncEnabled && localUser) await saveLocalData('templates', nextTemplates);
  };

  const persistSettings = async (nextAppSettings, nextCurrencySettings) => {
    if (syncEnabled && user) {
      setSyncStatus('Saving...');
      const { error } = await supabase.from('app_settings').upsert({
        user_id: user.id,
        app_settings: nextAppSettings,
        currency_settings: nextCurrencySettings
      });
      setSyncStatus(error ? error.message : 'Synced');
      return;
    }
    if (!syncEnabled && localUser) {
      await Promise.all([
        saveLocalData('appSettings', nextAppSettings),
        saveLocalData('currencySettings', nextCurrencySettings)
      ]);
    }
  };

  const updateCurrencySettings = (updater) => {
    setCurrencySettings((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      setAppSettings((currentSettings) => {
        const nextSettings = mergeAppSettings({
          ...currentSettings,
          preferences: { ...currentSettings.preferences, currency: next.defaultCurrency }
        }, next);
        persistSettings(nextSettings, next);
        return nextSettings;
      });
      return next;
    });
  };

  const updateAppSettings = (updater) => {
    setAppSettings((current) => {
      const next = mergeAppSettings(typeof updater === 'function' ? updater(current) : updater, currencySettings);
      persistSettings(next, currencySettings);
      return next;
    });
  };

  const handleLocalAuth = ({ user: nextUser, data }) => {
    setLocalUser(nextUser);
    applyStoredData(data);
    setSyncStatus('Local SQLite');
  };

  if (syncEnabled && !loadingCloud && !session) {
    return <AuthScreen />;
  }

  if (!syncEnabled && !loadingCloud && !localUser) {
    return <LocalAuthScreen onAuth={handleLocalAuth} />;
  }

  return (
    <div className="app">
      <Sidebar page={page} navigate={navigate} stats={stats} open={mobileNav} close={() => setMobileNav(false)} user={activeUser} syncStatus={syncStatus} localMode={!syncEnabled} onLocalLogout={() => { localLogout(); setLocalUser(null); }} />
      <main className="main">
        <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20} /></button>
        {page === 'dashboard' && <Dashboard jobs={jobs} shifts={shifts} stats={stats} navigate={navigate} editShift={(shift) => { setEditingShift(shift); setPage('addShift'); }} currency={currencySettings.defaultCurrency} user={user} />}
        {page === 'shifts' && <Shifts jobs={jobs} shifts={shifts} stats={stats} add={() => { setEditingShift(null); setPage('addShift'); }} edit={(shift) => { setEditingShift(shift); setPage('addShift'); }} remove={deleteShift} currency={currencySettings.defaultCurrency} />}
        {page === 'jobs' && !selectedJob && <Jobs jobs={jobs} shifts={shifts} stats={stats} select={setSelectedJob} addJob={() => { setEditingJob(null); setPage('addJob'); }} editJob={(job) => { setEditingJob(job); setPage('addJob'); }} currency={currencySettings.defaultCurrency} />}
        {page === 'jobs' && selectedJob && <JobDetail job={selectedJob} jobs={jobs} shifts={shifts} back={() => setSelectedJob(null)} addShift={() => setPage('addShift')} editJob={() => { setEditingJob(selectedJob); setSelectedJob(null); setPage('addJob'); }} currency={currencySettings.defaultCurrency} />}
        {page === 'templates' && <TemplatesPage jobs={jobs} templates={templates} saveTemplate={saveTemplate} deleteTemplate={deleteTemplate} addJob={() => { setEditingJob(null); setPage('addJob'); }} />}
        {page === 'calendar' && <CalendarView jobs={jobs} shifts={shifts} addShift={() => { setEditingShift(null); setPage('addShift'); }} editShift={(shift) => { setEditingShift(shift); setPage('addShift'); }} />}
        {page === 'reports' && <Reports jobs={jobs} shifts={shifts} stats={stats} currency={currencySettings.defaultCurrency} />}
        {page === 'settings' && <SettingsView stats={stats} user={activeUser} syncStatus={syncStatus} currencySettings={currencySettings} setCurrencySettings={updateCurrencySettings} appSettings={appSettings} setAppSettings={updateAppSettings} />}
        {page === 'addShift' && <AddShift jobs={jobs} templates={templates} shift={editingShift} save={saveShift} cancel={() => setPage('shifts')} remove={deleteShift} addJob={() => { setEditingJob(null); setPage('addJob'); }} currencySettings={currencySettings} preferences={appSettings.preferences} toggles={appSettings.toggles} />}
        {page === 'addJob' && <AddJob job={editingJob} save={saveJob} cancel={() => setPage('jobs')} currency={currencySettings.defaultCurrency} preferences={appSettings.preferences} toggles={appSettings.toggles} />}
      </main>
      <MobileBottomNav page={page} navigate={navigate} />
    </div>
  );
}

function buildStats(jobs, shifts) {
  const weekShifts = filterByRange(shifts, 'week');
  const monthShifts = filterByRange(shifts, 'month');
  const previousWeekAnchor = toDate(getTodayIso());
  previousWeekAnchor.setDate(previousWeekAnchor.getDate() - 7);
  const previousMonthAnchor = toDate(getTodayIso());
  previousMonthAnchor.setMonth(previousMonthAnchor.getMonth() - 1);
  const previousWeekShifts = filterByRange(shifts, 'week', isoDate(previousWeekAnchor));
  const previousMonthShifts = filterByRange(shifts, 'month', isoDate(previousMonthAnchor));
  const weekHours = hoursFor(weekShifts);
  const monthHours = hoursFor(monthShifts);
  const previousWeekHours = hoursFor(previousWeekShifts);
  const previousMonthHours = hoursFor(previousMonthShifts);
  const monthEarnings = earningsFor(jobs, monthShifts);
  return {
    weekHours,
    monthHours,
    totalShifts: monthShifts.length,
    allShifts: shifts.length,
    avgShift: monthHours / Math.max(1, monthShifts.length),
    earnings: monthEarnings,
    approvedHours: hoursFor(monthShifts.filter((shift) => shift.status === 'Approved')),
    recordedShifts: monthShifts.filter((shift) => shift.status === 'Recorded').length,
    openEdits: monthShifts.filter((shift) => shift.status === 'Pending').length,
    attendanceRate: monthShifts.length ? (monthShifts.filter((shift) => shift.status !== 'Day Off').length / monthShifts.length) * 100 : 100,
    trends: {
      weekHours: percentTrend(weekHours, previousWeekHours),
      monthHours: percentTrend(monthHours, previousMonthHours),
      shifts: monthShifts.length - previousMonthShifts.length,
      earnings: percentTrend(monthEarnings, earningsFor(jobs, previousMonthShifts))
    }
  };
}

function weekdayLabels(anchorIso = getTodayIso()) {
  const start = startOfWeek(toDate(anchorIso));
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day.toLocaleDateString(localeFor(), { weekday: 'short' });
  });
}

function dailyHours(shifts, anchorIso = getTodayIso()) {
  const start = startOfWeek(toDate(anchorIso));
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return hoursFor(shifts.filter((shift) => shift.date === isoDate(day)));
  });
}

function weeklyBuckets(shifts, anchorIso = getTodayIso()) {
  const anchor = startOfWeek(toDate(anchorIso));
  return Array.from({ length: 5 }, (_, index) => {
    const start = new Date(anchor);
    start.setDate(anchor.getDate() - (4 - index) * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      label: `${fmtDate(isoDate(start), true)} - ${fmtDate(isoDate(end), true)}`,
      hours: hoursFor(shifts.filter((shift) => inRange(shift, start, end)))
    };
  });
}

function monthTrend(shifts, anchorIso = getTodayIso()) {
  const anchor = toDate(anchorIso);
  return Array.from({ length: 6 }, (_, index) => {
    const month = new Date(anchor.getFullYear(), anchor.getMonth() - (5 - index), 1, 12);
    return {
      label: month.toLocaleDateString(localeFor(), { month: 'short' }),
      hours: hoursFor(shifts.filter((shift) => {
        const date = toDate(shift.date);
        return date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear();
      }))
    };
  });
}

function yearBuckets(shifts, anchorIso = getTodayIso()) {
  const anchor = toDate(anchorIso);
  return Array.from({ length: 12 }, (_, index) => {
    const month = new Date(anchor.getFullYear(), index, 1, 12);
    return {
      label: month.toLocaleDateString(localeFor(), { month: 'short' }),
      hours: hoursFor(shifts.filter((shift) => {
        const date = toDate(shift.date);
        return date.getMonth() === index && date.getFullYear() === anchor.getFullYear();
      }))
    };
  });
}

function hoursOverviewBuckets(shifts, period) {
  if (period === 'week') {
    return {
      values: dailyHours(shifts),
      labels: weekdayLabels()
    };
  }
  if (period === 'month') {
    const buckets = weeklyBuckets(filterByRange(shifts, 'month'));
    return {
      values: buckets.map((item) => item.hours),
      labels: buckets.map((item) => item.label)
    };
  }
  const buckets = yearBuckets(shifts);
  return {
    values: buckets.map((item) => item.hours),
    labels: buckets.map((item) => item.label)
  };
}

function reportHoursBreakdown(shifts, range) {
  if (range === 'week') {
    return {
      unit: 'Day',
      values: dailyHours(shifts),
      labels: weekdayLabels()
    };
  }
  if (range === 'year') {
    const buckets = yearBuckets(shifts);
    return {
      unit: 'Month',
      values: buckets.map((item) => item.hours),
      labels: buckets.map((item) => item.label)
    };
  }
  const buckets = weeklyBuckets(shifts);
  return {
    unit: 'Week',
    values: buckets.map((item) => item.hours),
    labels: buckets.map((item) => item.label)
  };
}

function reportTrendData(shifts, range) {
  if (range === 'week') {
    const buckets = dailyHours(shifts);
    return { unit: 'Daily', values: buckets, labels: weekdayLabels() };
  }
  if (range === 'year') {
    const buckets = yearBuckets(shifts);
    return { unit: 'Monthly', values: buckets.map((item) => item.hours), labels: buckets.map((item) => item.label) };
  }
  const buckets = weeklyBuckets(shifts);
  return { unit: 'Weekly', values: buckets.map((item) => item.hours), labels: buckets.map((item) => item.label) };
}

function busiestDay(shifts) {
  if (!shifts.length) return 'No shifts';
  const totals = shifts.reduce((map, shift) => {
    const day = toDate(shift.date).toLocaleDateString(localeFor(), { weekday: 'long' });
    map[day] = (map[day] || 0) + shiftHours(shift);
    return map;
  }, {});
  return Object.entries(totals).sort((a, b) => b[1] - a[1])[0][0];
}

function highestEarningJob(jobs, shifts) {
  if (!shifts.length) return 'No shifts';
  const totals = jobs.map((job) => ({
    name: job.name,
    earnings: earningsFor([job], shifts.filter((shift) => shift.jobId === job.id))
  }));
  return totals.sort((a, b) => b.earnings - a.earnings)[0]?.name || 'No shifts';
}

function AuthScreen() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const signInWithGoogle = async () => {
    setBusy(true);
    setMessage('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: appUrl }
    });
    if (error) {
      setMessage(error.message);
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand auth-brand">
          <div className="brand-mark"><Clock3 size={28} /></div>
          <div><strong>ShiftTrack</strong><span>Personal</span></div>
        </div>
        <h1>Sign in with Google</h1>
        <p>ShiftTrack uses your Google account for authentication and sync across devices.</p>
        {message && <div className="auth-message">{message}</div>}
        <button className="google-auth" onClick={signInWithGoogle} disabled={busy}><ShieldCheck size={18} /> {busy ? 'Opening Google...' : 'Continue with Google'}</button>
      </section>
    </main>
  );
}

function LocalAuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const account = mode === 'signup' ? signupEmail : loginIdentifier;

  const toggleMode = () => {
    setMode((current) => {
      const next = current === 'signup' ? 'login' : 'signup';
      if (next === 'signup') setPassword('');
      return next;
    });
    setMessage('');
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const payload = mode === 'signup' ? { email: signupEmail, password } : { identifier: loginIdentifier, password };
      const data = mode === 'signup'
        ? await localSignup({ ...payload, name, initialData: { jobs: jobsSeed, shifts: shiftsSeed, templates: shiftTemplates, currencySettings: defaultCurrencySettings, appSettings: mergeAppSettings(defaultAppSettings, defaultCurrencySettings) } })
        : await localLogin(payload);
      onAuth(data);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand auth-brand">
          <div className="brand-mark"><Clock3 size={28} /></div>
          <div><strong>ShiftTrack</strong><span>Personal</span></div>
        </div>
        <h1 key={`title-${mode}`} className="auth-title">{mode === 'signup' ? 'Create account' : 'Welcome back'}</h1>
        <p key={`copy-${mode}`} className="auth-copy">You are using ShiftTrack in a local environment. Your data stays on this device.</p>
        <form key={`form-${mode}`} className="auth-form" onSubmit={submit}>
          {mode === 'signup' && <Field label="Name"><input value={name} onChange={(event) => setName(event.target.value)} required placeholder="Your name" /></Field>}
          <Field label={mode === 'signup' ? 'Email' : 'Email or Username'}><input type={mode === 'signup' ? 'email' : 'text'} value={account} onChange={(event) => mode === 'signup' ? setSignupEmail(event.target.value) : setLoginIdentifier(event.target.value)} required placeholder={mode === 'signup' ? 'you@example.com' : 'you@example.com or your name'} /></Field>
          <Field label="Password"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} placeholder="At least 6 characters" /></Field>
          {message && <div className="auth-message">{message}</div>}
          <button className="primary full" disabled={busy}>{busy ? 'Working...' : mode === 'signup' ? 'Sign Up' : 'Log In'}</button>
        </form>
        <button className="bare auth-toggle" onClick={toggleMode}>
          {mode === 'signup' ? 'Already have a local account? Log in' : 'Need a local account? Sign up'}
        </button>
      </section>
    </main>
  );
}

function Sidebar({ page, navigate, stats, open, close, user, syncStatus, localMode, onLocalLogout }) {
  const name = userDisplayName(user);
  const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);

  useEffect(() => {
    if (!accountOpen) return undefined;
    const closeAccountMenu = (event) => {
      if (!accountRef.current?.contains(event.target)) setAccountOpen(false);
    };
    document.addEventListener('pointerdown', closeAccountMenu);
    return () => document.removeEventListener('pointerdown', closeAccountMenu);
  }, [accountOpen]);

  const signOut = async () => {
    if (localMode) {
      onLocalLogout?.();
      return;
    }
    if (syncEnabled) await supabase.auth.signOut();
  };

  return (
    <>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Clock3 size={28} /></div>
          <div><strong>ShiftTrack</strong><span>Personal</span></div>
        </div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}>
              <Icon size={20} /> {label}
            </button>
          ))}
        </nav>
        <div className="side-summary">
          <span>Summary</span>
          <small>Total Hours (This Week)</small><strong>{fmtHours(stats.weekHours)}</strong>
          <small>Total Hours (This Month)</small><strong>{fmtHours(stats.monthHours)}</strong>
          <small>Total Shifts</small><strong>{stats.totalShifts}</strong>
        </div>
        <div className="account-area" ref={accountRef}>
          {accountOpen && <div className="account-menu"><button onClick={signOut}>Log out</button></div>}
          <button className="profile" onClick={() => setAccountOpen((value) => !value)}>
            <div className="avatar">{initials}</div>
            <div><strong>{name}</strong><span>{user?.email || 'Local account'}</span></div>
            <ChevronDown size={16} />
          </button>
        </div>
      </aside>
      {open && <button className="scrim" onClick={close} aria-label="Close menu" />}
    </>
  );
}

function MobileBottomNav({ page, navigate }) {
  return (
    <nav className="bottom-nav" aria-label="Mobile primary navigation">
      {mobileNavItems.map(([id, label, Icon]) => (
        <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}>
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function Header({ title, subtitle, children }) {
  return <header className="page-head"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="head-actions">{children}</div></header>;
}

function StatCard({ label, value, trend, icon: Icon, tone = 'blue' }) {
  return <section className="stat-card"><div><p>{label}</p><h2>{value}</h2>{trend && <span className="trend">{trend}</span>}</div><div className={`icon-tile ${tone}`}><Icon size={25} /></div></section>;
}

function Dashboard({ jobs, shifts, stats, navigate, editShift, currency, user }) {
  const todayIso = getTodayIso();
  const [dashboardRange, setDashboardRange] = useState('week');
  const [customStart, setCustomStart] = useState(() => isoDate(startOfWeek(toDate(todayIso))));
  const [customEnd, setCustomEnd] = useState(todayIso);
  const [hoursPeriod, setHoursPeriod] = useState('week');
  const [jobsPeriod, setJobsPeriod] = useState('month');
  const [rangeStart, rangeEnd] = dashboardRange === 'custom'
    ? [toDate(customStart <= customEnd ? customStart : customEnd), toDate(customStart <= customEnd ? customEnd : customStart)]
    : dateRangeFor(dashboardRange);
  const [previousStart, previousEnd] = previousDateSpan(rangeStart, rangeEnd);
  const rangedShifts = filterByDateSpan(shifts, rangeStart, rangeEnd);
  const previousShifts = filterByDateSpan(shifts, previousStart, previousEnd);
  const rangeHours = hoursFor(rangedShifts);
  const previousHours = hoursFor(previousShifts);
  const rangeEarnings = earningsFor(jobs, rangedShifts);
  const previousEarnings = earningsFor(jobs, previousShifts);
  const recent = [...rangedShifts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const upcoming = upcomingShifts(rangedShifts, 5);
  const rangeName = { week: 'This Week', month: 'This Month', year: 'This Year', custom: 'Custom' }[dashboardRange];
  const previousName = dashboardRange === 'custom' ? 'previous range' : `last ${dashboardRange}`;
  const hoursOverview = hoursOverviewBuckets(shifts, hoursPeriod);
  const jobsOverviewShifts = jobsPeriod === 'all' ? shifts : filterByRange(shifts, jobsPeriod);
  return (
    <>
      <Header title="Dashboard" subtitle="Here's an overview of your shifts across all jobs.">
        <div className="date-filter">
          <CalendarDays size={18} />
          <select value={dashboardRange} onChange={(event) => setDashboardRange(event.target.value)} aria-label="Dashboard date range">
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="year">This Year</option>
            <option value="custom">Custom</option>
          </select>
          {dashboardRange === 'custom' ? (
            <>
              <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} aria-label="Custom start date" />
              <span>to</span>
              <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} aria-label="Custom end date" />
            </>
          ) : (
            <span>{rangeLabel(rangeStart, rangeEnd)}</span>
          )}
        </div>
        <button className="primary mobile-head-action" onClick={() => navigate('addShift')}><Plus size={18} /> Add Shift</button>
      </Header>
      <div className="stats-grid four">
        <StatCard label={`Total Hours (${rangeName})`} value={fmtHours(rangeHours)} trend={`${percentTrend(rangeHours, previousHours) >= 0 ? '↑' : '↓'} ${Math.abs(percentTrend(rangeHours, previousHours))}% from ${previousName}`} icon={Clock3} />
        <StatCard label={`Earnings (${rangeName})`} value={money(rangeEarnings, currency)} trend={`${percentTrend(rangeEarnings, previousEarnings) >= 0 ? '↑' : '↓'} ${Math.abs(percentTrend(rangeEarnings, previousEarnings))}% from ${previousName}`} icon={CircleDollarSign} tone="green" />
        <StatCard label={`Total Shifts (${rangeName})`} value={rangedShifts.length} trend={`${rangedShifts.length - previousShifts.length >= 0 ? '↑' : '↓'} ${Math.abs(rangedShifts.length - previousShifts.length)} from ${previousName}`} icon={CalendarDays} tone="purple" />
        <StatCard label="Average Shift Length" value={fmtHours(rangeHours / Math.max(1, rangedShifts.length))} trend={`${rangedShifts.length} shifts counted`} icon={Clock3} tone="amber" />
      </div>
      <div className="grid two">
        <Panel title="Hours Overview" action={<select className="control-select small-select" value={hoursPeriod} onChange={(event) => setHoursPeriod(event.target.value)}><option value="week">This Week</option><option value="month">This Month</option><option value="year">This Year</option></select>}>
          <BarChart values={hoursOverview.values} labels={hoursOverview.labels} />
        </Panel>
        <Panel title="Jobs Overview" action={<select className="control-select small-select" value={jobsPeriod} onChange={(event) => setJobsPeriod(event.target.value)}><option value="week">This Week</option><option value="month">This Month</option><option value="year">This Year</option><option value="all">All Time</option></select>}>
          <JobBars jobs={jobs} shifts={jobsOverviewShifts} />
        </Panel>
      </div>
      <div className="grid two">
        <Panel title="Recent Shifts" link="View all" onLinkClick={() => navigate('shifts')}>
          <ShiftTable jobs={jobs} shifts={recent} compact edit={editShift} />
        </Panel>
        <Panel title="Upcoming Shifts" link="View calendar" onLinkClick={() => navigate('calendar')}>
          <Upcoming jobs={jobs} shifts={upcoming} compact />
        </Panel>
      </div>
      <Footer />
    </>
  );
}

function Shifts({ jobs, shifts, stats, add, edit, remove, currency }) {
  const todayIso = getTodayIso();
  const [query, setQuery] = useState('');
  const [jobFilter, setJobFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [rangeFilter, setRangeFilter] = useState('month');
  const [customStart, setCustomStart] = useState(() => isoDate(startOfWeek(toDate(todayIso))));
  const [customEnd, setCustomEnd] = useState(todayIso);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [rangeStart, rangeEnd] = rangeFilter === 'custom'
    ? [toDate(customStart <= customEnd ? customStart : customEnd), toDate(customStart <= customEnd ? customEnd : customStart)]
    : dateRangeFor(rangeFilter);
  const filtered = shifts
    .filter((shift) => inRange(shift, rangeStart, rangeEnd))
    .filter((shift) => jobFilter === 'all' || shift.jobId === jobFilter)
    .filter((shift) => statusFilter === 'all' || shift.status === statusFilter)
    .filter((shift) => {
      const job = jobs.find((item) => item.id === shift.jobId);
      return !query || [shift.title, shift.notes, shift.location, shift.date, job?.name, job?.type].some((value) => matchesText(String(value || ''), query));
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const filteredHours = hoursFor(filtered);
  const approvedHours = hoursFor(filtered.filter((shift) => shift.status === 'Approved'));
  const recordedShifts = filtered.filter((shift) => shift.status === 'Recorded').length;
  const openEdits = filtered.filter((shift) => shift.status === 'Pending').length;
  const rangeName = { week: 'This Week', month: 'This Month', year: 'This Year', custom: 'Custom' }[rangeFilter];
  const shiftListTitle = rangeFilter === 'custom' ? rangeLabel(rangeStart, rangeEnd) : rangeName;
  return (
    <>
      <Header title="Shifts" subtitle="Manage and review your shift records across all jobs.">
        <button className="primary shifts-add-action" onClick={add}><Plus size={18} /> Add Shift</button>
        <label className="search shifts-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search shifts, jobs, or notes..." /></label>
        <div className="shifts-filter-row">
          <div className="date-filter compact-date-filter">
            <CalendarDays size={18} />
            <select value={rangeFilter} onChange={(event) => setRangeFilter(event.target.value)} aria-label="Shifts date range">
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="year">This Year</option>
              <option value="custom">Custom</option>
            </select>
            {rangeFilter === 'custom' && (
              <>
                <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} aria-label="Shifts custom start date" />
                <span>to</span>
                <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} aria-label="Shifts custom end date" />
              </>
            )}
          </div>
          <select className="control-select" value={jobFilter} onChange={(event) => setJobFilter(event.target.value)}><option value="all">All Jobs</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.name}</option>)}</select>
          <select className="control-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All Status</option><option>Approved</option><option>Recorded</option><option>Pending</option><option>Day Off</option></select>
        </div>
      </Header>
      <div className="stats-grid shifts-stats">
        <StatCard label="Total Hours" value={fmtHours(filteredHours)} trend={`${filtered.length} shifts in ${rangeName}`} icon={Clock3} />
        <StatCard label="Total Shifts" value={filtered.length} trend={`${shifts.length} total records`} icon={CalendarDays} tone="purple" />
        <StatCard label="Approved Hours" value={fmtHours(approvedHours)} trend={`${Math.round((approvedHours / Math.max(1, filteredHours)) * 100)}% of filtered hours`} icon={Check} tone="green" />
        <StatCard label="Recorded Shifts" value={recordedShifts} trend={`${Math.round((recordedShifts / Math.max(1, filtered.length)) * 100)}% of filtered shifts`} icon={FileText} tone="purple" />
        <StatCard label="Open Edits" value={openEdits} trend="Pending review" icon={Edit3} tone="amber" />
      </div>
      <Panel title={shiftListTitle}>
        <ShiftTable jobs={jobs} shifts={filtered} edit={edit} requestDelete={setDeleteTarget} currency={currency} />
      </Panel>
      {deleteTarget && <ConfirmDeleteModal shift={deleteTarget} job={jobs.find((job) => job.id === deleteTarget.jobId)} cancel={() => setDeleteTarget(null)} confirm={() => { remove(deleteTarget.id); setDeleteTarget(null); }} />}
    </>
  );
}

function Jobs({ jobs, shifts, stats, select, addJob, editJob, currency }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('name');
  const filteredJobs = jobs
    .filter((job) => status === 'all' || (status === 'active' ? job.active : !job.active))
    .filter((job) => !query || [job.name, job.employer, job.type, job.payType].some((value) => matchesText(String(value || ''), query)))
    .sort((a, b) => {
      if (sort === 'hours') return jobHours(b.id, shifts) - jobHours(a.id, shifts);
      if (sort === 'earnings') return jobHours(b.id, shifts) * b.rate - jobHours(a.id, shifts) * a.rate;
      return a.name.localeCompare(b.name);
    });
  return (
    <>
      <Header title="Jobs" subtitle="Manage your jobs and track earnings across all your roles.">
        <button className="primary mobile-head-action" onClick={addJob}><Plus size={18} /> Add Job</button>
      </Header>
      <div className="stats-grid four jobs-stats">
        <StatCard label="Active Jobs" value={jobs.length} trend="● All jobs are active" icon={CalendarDays} tone="purple" />
        <StatCard label="Total Earnings (This Month)" value={money(stats.earnings, currency)} trend="↑ 8% from last month" icon={CircleDollarSign} tone="green" />
        <StatCard label="Total Hours (This Week)" value={fmtHours(stats.weekHours)} trend="↑ 12% from last week" icon={Clock3} />
        <StatCard label="Total Hours (This Month)" value={fmtHours(stats.monthHours)} trend="↑ 8% from last month" icon={CalendarDays} tone="amber" />
      </div>
      <div className="job-card-grid">
        {filteredJobs.map((job) => <JobCard key={job.id} job={job} shifts={shifts} select={() => select(job)} currency={currency} />)}
      </div>
      <Panel title="All Jobs" className="jobs-table-panel">
        <div className="table-tools">
          <label className="search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search jobs..." /></label>
          <select className="control-select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
          <select className="control-select" value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">Sort: Name</option><option value="hours">Sort: Hours</option><option value="earnings">Sort: Earnings</option></select>
          <button className="icon-button"><List size={18} /></button>
          <button className="icon-button"><LayoutGrid size={18} /></button>
        </div>
        <table className="data-table">
          <thead><tr><th>Job</th><th>Employer</th><th>Hourly Rate</th><th>Pay Type</th><th>This Week</th><th>This Month</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{filteredJobs.map((job) => <tr key={job.id}><td><JobName job={job} /></td><td>{job.employer}</td><td>{money(job.rate, currency)}</td><td><Badge tone={job.color}>{job.payType}</Badge></td><td>{fmtHours(jobHours(job.id, filterByRange(shifts, 'week')))}</td><td>{fmtHours(jobHours(job.id, filterByRange(shifts, 'month')))}</td><td><Badge green={job.active}>{job.active ? 'Active' : 'Inactive'}</Badge></td><td className="row-actions"><button onClick={() => select(job)}><Eye size={16} /></button><button onClick={() => editJob(job)}><Edit3 size={16} /></button><button><MoreVertical size={16} /></button></td></tr>)}</tbody>
        </table>
      </Panel>
      <Footer />
    </>
  );
}

function JobDetail({ job, shifts, back, addShift, editJob, currency }) {
  const todayIso = getTodayIso();
  const [range, setRange] = useState('month');
  const [customStart, setCustomStart] = useState(() => isoDate(startOfMonth(toDate(todayIso))));
  const [customEnd, setCustomEnd] = useState(todayIso);
  const [rangeStart, rangeEnd] = range === 'custom'
    ? [toDate(customStart <= customEnd ? customStart : customEnd), toDate(customStart <= customEnd ? customEnd : customStart)]
    : dateRangeFor(range);
  const [previousStart, previousEnd] = previousDateSpan(rangeStart, rangeEnd);
  const allJobShifts = shifts.filter((shift) => shift.jobId === job.id).sort((a, b) => a.date.localeCompare(b.date));
  const filtered = filterByDateSpan(allJobShifts, rangeStart, rangeEnd);
  const previous = filterByDateSpan(allJobShifts, previousStart, previousEnd);
  const hours = hoursFor(filtered);
  const previousHours = hoursFor(previous);
  const earnings = earningsFor([job], filtered);
  const previousEarnings = earningsFor([job], previous);
  const avgShift = hours / Math.max(1, filtered.length);
  const trend = range === 'custom' ? reportTrendData(filtered, 'month') : reportTrendData(filtered, range);
  const rangeName = { week: 'This Week', month: 'This Month', year: 'This Year', custom: 'Custom' }[range];
  const previousName = range === 'custom' ? 'previous range' : `last ${range}`;
  return (
    <>
      <button className="back-link" onClick={back}><ArrowLeft size={17} /> Back to Jobs</button>
      <Header title={job.name} subtitle={`${job.type}  •  ${money(job.rate, currency)} / hour`}>
        <div className="date-filter">
          <CalendarDays size={18} />
          <select value={range} onChange={(event) => setRange(event.target.value)} aria-label="Job detail date range">
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="year">This Year</option>
            <option value="custom">Custom</option>
          </select>
          {range === 'custom' ? (
            <>
              <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} aria-label="Job custom start date" />
              <span>to</span>
              <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} aria-label="Job custom end date" />
            </>
          ) : (
            <span>{rangeLabel(rangeStart, rangeEnd)}</span>
          )}
        </div>
        <Badge green={job.active}>{job.active ? 'Active' : 'Inactive'}</Badge>
        <button className="ghost" onClick={editJob}><Edit3 size={18} /> Edit Job</button>
        <button className="primary" onClick={addShift}><Plus size={18} /> Add Shift</button>
      </Header>
      <div className="stats-grid four">
        <StatCard label={`Hours (${rangeName})`} value={fmtHours(hours)} trend={`${percentTrend(hours, previousHours) >= 0 ? '↑' : '↓'} ${Math.abs(percentTrend(hours, previousHours))}% from ${previousName}`} icon={Clock3} />
        <StatCard label={`Earnings (${rangeName})`} value={money(earnings, currency)} trend={`${percentTrend(earnings, previousEarnings) >= 0 ? '↑' : '↓'} ${Math.abs(percentTrend(earnings, previousEarnings))}% from ${previousName}`} icon={CircleDollarSign} tone="green" />
        <StatCard label={`Shifts (${rangeName})`} value={filtered.length} trend={`${filtered.length - previous.length >= 0 ? '↑' : '↓'} ${Math.abs(filtered.length - previous.length)} from ${previousName}`} icon={CalendarDays} tone="purple" />
        <StatCard label="Average Shift Length" value={fmtHours(avgShift)} trend={`${filtered.length} shifts counted`} icon={Clock3} tone="amber" />
      </div>
      <div className="grid job-detail-grid">
        <Panel title={`Hours Trend (${rangeName})`}><LineChart values={trend.values} labels={trend.labels} /></Panel>
        <Panel title="Hours Breakdown" action="By Day of Week"><JobBreakdown color={job.color} shifts={filtered} /></Panel>
        <Panel title="Job Information"><InfoRows rows={[['Job Title', job.name], ['Employer', job.employer || '-'], ['Hourly Rate', money(job.rate, currency)], ['Pay Type', job.payType], ['Job Type', job.type || '-'], ['Status', job.active ? 'Active' : 'Inactive']]} /></Panel>
        <Panel title="Quick Stats"><InfoRows rows={[['Total Hours', fmtHours(hours)], ['Total Earnings', money(earnings, currency)], ['Total Shifts', filtered.length], ['Average Shift', fmtHours(avgShift)], ['Busiest Day', busiestDay(filtered)], ['First Shift', filtered[0]?.date ? fmtDate(filtered[0].date) : 'No shifts'], ['Last Shift', filtered.at(-1)?.date ? fmtDate(filtered.at(-1).date) : 'No shifts']]} /></Panel>
      </div>
      <Footer />
    </>
  );
}

function CalendarView({ jobs, shifts, addShift, editShift }) {
  const [viewMode, setViewMode] = useState('month');
  const [viewDate, setViewDate] = useState(() => toDate(getTodayIso()));
  const [detailDate, setDetailDate] = useState(null);
  const [visibleJobs, setVisibleJobs] = useState(() => Object.fromEntries(jobs.map((job) => [job.id, true])));
  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const firstGridDay = startOfWeek(monthStart);
  const weekStart = startOfWeek(viewDate);
  const weekEnd = endOfWeek(viewDate);
  const rangeStart = viewMode === 'month' ? monthStart : viewMode === 'week' ? weekStart : viewDate;
  const rangeEnd = viewMode === 'month' ? monthEnd : viewMode === 'week' ? weekEnd : viewDate;
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstGridDay);
    date.setDate(firstGridDay.getDate() + index);
    return date;
  });
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });
  const visibleShifts = shifts.filter((shift) => visibleJobs[shift.jobId] !== false);
  const rangeShifts = visibleShifts.filter((shift) => inRange(shift, rangeStart, rangeEnd));
  const allJobsVisible = jobs.every((job) => visibleJobs[job.id] !== false);
  const changePeriod = (offset) => {
    setViewDate((current) => {
      const next = new Date(current);
      if (viewMode === 'month') return new Date(current.getFullYear(), current.getMonth() + offset, 1, 12);
      if (viewMode === 'week') next.setDate(current.getDate() + offset * 7);
      if (viewMode === 'day') next.setDate(current.getDate() + offset);
      return next;
    });
  };
  const goToday = () => {
    setViewDate(toDate(getTodayIso()));
  };
  const selectCalendarDate = (date) => {
    setViewDate(date);
    const iso = isoDate(date);
    if (visibleShifts.some((shift) => shift.date === iso)) setDetailDate(date);
  };
  const calendarLabel = viewMode === 'month'
    ? viewDate.toLocaleDateString(localeFor(), { month: 'long', year: 'numeric' })
    : viewMode === 'week'
      ? rangeLabel(weekStart, weekEnd)
      : viewDate.toLocaleDateString(localeFor(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <>
      <Header title="Calendar" subtitle="View and manage your shifts. Stay organized and plan ahead.">
        <div className="segmented"><button className={viewMode === 'month' ? 'selected' : ''} onClick={() => setViewMode('month')}>Month</button><button className={viewMode === 'week' ? 'selected' : ''} onClick={() => setViewMode('week')}>Week</button><button className={viewMode === 'day' ? 'selected' : ''} onClick={() => setViewMode('day')}>Day</button></div>
        <button className="primary mobile-head-action" onClick={addShift}><Plus size={18} /> Add Shift</button>
      </Header>
      <div className="calendar-layout">
        <aside className="filters panel">
          <h3>Filters</h3><button className="ghost full" onClick={() => setVisibleJobs(Object.fromEntries(jobs.map((job) => [job.id, !allJobsVisible])))}>{allJobsVisible ? 'Hide all jobs' : 'Show all jobs'} <ChevronDown size={16} /></button>
          {jobs.map((job) => <label key={job.id} className={`check-row ${visibleJobs[job.id] === false ? 'empty' : ''}`}><button type="button" style={{ background: visibleJobs[job.id] === false ? 'white' : job.color }} onClick={() => setVisibleJobs((current) => ({ ...current, [job.id]: current[job.id] === false }))}>{visibleJobs[job.id] !== false && <Check size={13} />}</button>{job.name}</label>)}
        </aside>
        <section className="calendar-main panel">
          <div className="calendar-toolbar"><button className="ghost" onClick={goToday}>Today</button><button className="icon-button" onClick={() => changePeriod(-1)}><ChevronLeft size={18} /></button><button className="icon-button" onClick={() => changePeriod(1)}><ChevronRight size={18} /></button><h2>{calendarLabel}</h2></div>
          {viewMode === 'month' && <div className="month-grid">
            {weekdayLabels(isoDate(viewDate)).map((d) => <b key={d}>{d}</b>)}
            {days.map((date) => <DayCell key={isoDate(date)} date={date} viewDate={viewDate} jobs={jobs} shifts={visibleShifts} selected={isoDate(date) === isoDate(viewDate)} onSelect={() => selectCalendarDate(date)} />)}
          </div>}
          {viewMode === 'week' && <WeekCalendar days={weekDays} jobs={jobs} shifts={visibleShifts} selectedDate={viewDate} selectDate={selectCalendarDate} />}
          {viewMode === 'day' && <DayAgenda date={viewDate} jobs={jobs} shifts={visibleShifts} />}
        </section>
        <aside className="calendar-side">
          <MiniCalendar viewDate={viewDate} setViewDate={setViewDate} />
          <Panel title="Total Scheduled Hours"><h2>{fmtHours(hoursFor(rangeShifts))}</h2><p className="panel-note">{rangeLabel(rangeStart, rangeEnd)}</p></Panel>
        </aside>
      </div>
      {detailDate && (
        <CalendarShiftModal
          date={detailDate}
          jobs={jobs}
          shifts={visibleShifts.filter((shift) => shift.date === isoDate(detailDate)).sort((a, b) => normalizeTime(a.start).localeCompare(normalizeTime(b.start)))}
          cancel={() => setDetailDate(null)}
          selectShift={(shift) => {
            setDetailDate(null);
            editShift(shift);
          }}
        />
      )}
      <Footer />
    </>
  );
}

function Reports({ jobs, shifts, stats, currency }) {
  const [range, setRange] = useState('month');
  const [jobId, setJobId] = useState('all');
  const rangedShifts = filterByRange(shifts, range).filter((shift) => jobId === 'all' || shift.jobId === jobId);
  const reportHours = hoursFor(rangedShifts);
  const reportEarnings = earningsFor(jobs, rangedShifts);
  const reportAvg = reportHours / Math.max(1, rangedShifts.length);
  const attendance = rangedShifts.length ? (rangedShifts.filter((shift) => shift.status !== 'Day Off').length / rangedShifts.length) * 100 : 100;
  const hoursBreakdown = reportHoursBreakdown(rangedShifts, range);
  const trendData = reportTrendData(shifts.filter((shift) => jobId === 'all' || shift.jobId === jobId), range);
  return (
    <>
      <Header title="Reports & Statistics" subtitle="Analyze your shift performance and earnings across all jobs." />
      <div className="filter-band"><span>Time Range</span><select className="control-select" value={range} onChange={(event) => setRange(event.target.value)}><option value="week">This Week</option><option value="month">This Month</option><option value="year">This Year</option></select><span>Job</span><select className="control-select" value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="all">All Jobs</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.name}</option>)}</select></div>
      <div className="stats-grid five">
        <StatCard label="Total Hours" value={fmtHours(reportHours)} trend={`${rangedShifts.length} shifts`} icon={Clock3} />
        <StatCard label="Total Earnings" value={money(reportEarnings, currency)} trend={`${jobId === 'all' ? jobs.length : 1} job${jobId === 'all' ? 's' : ''}`} icon={CircleDollarSign} tone="green" />
        <StatCard label="Total Shifts" value={rangedShifts.length} trend={`${rangedShifts.filter((shift) => shift.status === 'Approved').length} approved`} icon={CalendarDays} tone="purple" />
        <StatCard label="Avg. Shift Length" value={fmtHours(reportAvg)} trend="Calculated from filter" icon={Clock3} tone="amber" />
        <StatCard label="Attendance Rate" value={`${attendance.toFixed(1)}%`} trend={`${rangedShifts.filter((shift) => shift.status === 'Pending').length} pending`} icon={ShieldCheck} />
      </div>
      <div className="grid two"><Panel title={`Hours by ${hoursBreakdown.unit}`}><BarChart values={hoursBreakdown.values} labels={hoursBreakdown.labels} /></Panel><Panel title={`${trendData.unit} Trend`}><LineChart values={trendData.values} labels={trendData.labels} /></Panel></div>
      <div className="grid three"><Panel title="Hours by Job"><Donut jobs={jobs} shifts={rangedShifts} /></Panel><Panel title="Earnings by Job"><Donut jobs={jobs} shifts={rangedShifts} earnings currency={currency} /></Panel><Panel title="Average Shift Length by Job"><AverageShiftBars jobs={jobs} shifts={rangedShifts} /></Panel></div>
      <Footer />
    </>
  );
}

function SettingsView({ stats, user, syncStatus, currencySettings, setCurrencySettings, appSettings, setAppSettings }) {
  const preferences = appSettings.preferences;
  const toggles = appSettings.toggles;
  const updatePreference = (key, value) => setAppSettings((current) => ({ ...current, preferences: { ...current.preferences, [key]: value } }));
  const toggle = (key) => setAppSettings((current) => ({ ...current, toggles: { ...current.toggles, [key]: !current.toggles[key] } }));
  const updateDefaultCurrency = (code) => {
    setCurrencySettings((current) => ({
      defaultCurrency: code,
      enabledCurrencies: current.enabledCurrencies.includes(code) ? current.enabledCurrencies : [...current.enabledCurrencies, code]
    }));
  };
  const toggleCurrency = (code) => {
    setCurrencySettings((current) => {
      const enabled = current.enabledCurrencies.includes(code)
        ? current.enabledCurrencies.filter((item) => item !== code)
        : [...current.enabledCurrencies, code];
      const safeEnabled = enabled.length ? enabled : [current.defaultCurrency];
      return {
        defaultCurrency: safeEnabled.includes(current.defaultCurrency) ? current.defaultCurrency : safeEnabled[0],
        enabledCurrencies: safeEnabled
      };
    });
  };
  return (
    <>
      <Header title="Settings" subtitle="Manage your account, preferences, and app configuration." />
      <div className="settings-grid">
        <Panel title="Preferences"><ThemeMode value={toggles.darkMode ? 'dark' : 'light'} onChange={(mode) => setAppSettings((current) => ({ ...current, toggles: { ...current.toggles, darkMode: mode === 'dark' } }))} /><PreferenceRows values={preferences} update={updatePreference} rows={[['language', 'Language'], ['timezone', 'Timezone'], ['weekStart', 'Week starts on'], ['dateFormat', 'Date format'], ['timeFormat', 'Time format']]} /></Panel>
        <Panel title="Currency Settings"><CurrencySettings settings={currencySettings} setDefaultCurrency={updateDefaultCurrency} toggleCurrency={toggleCurrency} /></Panel>
        <Panel title="Default Shift Settings"><SettingsRows values={preferences} update={updatePreference} rows={[['defaultDuration', 'Default shift duration'], ['defaultBreak', 'Default break'], ['overtimeThreshold', 'Overtime threshold'], ['rounding', 'Rounding']]} /><Toggle label="Auto end break" on={toggles.autoEndBreak} onClick={() => toggle('autoEndBreak')} /></Panel>
        <Panel title="Jobs & Rates"><SettingsRows values={preferences} update={updatePreference} rows={[['defaultRate', 'Default hourly rate'], ['overtimeMultiplier', 'Overtime multiplier'], ['doubleTimeMultiplier', 'Double time multiplier']]} /><Toggle label="Add rate to new jobs" on={toggles.addRateToJobs} onClick={() => toggle('addRateToJobs')} /></Panel>
      </div>
      <Footer />
    </>
  );
}

function TemplatesPage({ jobs, templates, saveTemplate, deleteTemplate, addJob }) {
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showJobRequiredModal, setShowJobRequiredModal] = useState(false);

  const startNew = () => {
    if (jobs.length === 0) {
      setShowJobRequiredModal(true);
      return;
    }
    setEditing(null);
    setShowForm(true);
  };

  const startEdit = (template) => {
    setEditing(template);
    setShowForm(true);
  };

  const handleSave = async (template) => {
    await saveTemplate(template);
    setEditing(null);
    setShowForm(false);
  };

  return (
    <>
      <Header title="Templates" subtitle="Manage presets for common shifts and fill the Add Shift form faster.">
        <button className="primary" onClick={startNew}><Plus size={18} /> Add Template</button>
      </Header>
      <div className="grid two template-management">
        <Panel title="Shift Templates">
          <div className="managed-template-list">
            {templates.map((template) => {
              const job = jobs.find((item) => item.id === template.jobId) || fallbackJob;
              const Icon = template.jobId === 'delivery' ? Truck : template.jobId === 'freelance' ? Laptop : template.jobId === 'cashier' ? BriefcaseBusiness : BriefcaseBusiness;
              return (
                <section key={template.id} className="managed-template-card">
                  <div className="managed-template-main">
                    <span className="template-icon" style={{ color: job.color, background: job.bg }}><Icon size={22} /></span>
                    <div>
                      <h3>{template.name}</h3>
                      <p>{template.displayTime || `${fmtTime(template.start)} - ${fmtTime(template.end)}`}</p>
                      <small>{template.description}</small>
                    </div>
                  </div>
                  <div className="managed-template-meta">
                    <Badge tone={job.color}>{job.name}</Badge>
                    <span>{fmtHours(shiftHours(template))}</span>
                  </div>
                  <div className="row-actions">
                    <button onClick={() => startEdit(template)}><Edit3 size={16} /></button>
                    <button onClick={() => deleteTemplate(template.id)}><Trash2 size={16} /></button>
                  </div>
                </section>
              );
            })}
          </div>
        </Panel>
        <TemplateEditor
          jobs={jobs}
          template={editing}
          open={showForm}
          save={handleSave}
          cancel={() => {
            setEditing(null);
            setShowForm(false);
          }}
        />
      </div>
      {showJobRequiredModal && (
        <JobRequiredModal
          cancel={() => setShowJobRequiredModal(false)}
          addJob={() => {
            setShowJobRequiredModal(false);
            addJob();
          }}
        />
      )}
    </>
  );
}

function TimePicker({ value, onChange, startTime, breakMins = 0, showDuration = false }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => fmtTime(value));
  const [searching, setSearching] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    setDraft(fmtTime(value));
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const commit = (nextValue) => {
    onChange(nextValue);
    setDraft(fmtTime(nextValue));
    setSearching(false);
    setOpen(false);
  };

  const commitDraft = () => {
    const parsed = parseTimeInput(draft);
    if (parsed) commit(parsed);
    else setDraft(fmtTime(value));
  };

  const quickAdjust = (minutes) => {
    const base = value ? minutesFromTime(value) : minutesFromTime(timeFromMinutes(roundedMinutes(new Date().getHours() * 60 + new Date().getMinutes(), 15)));
    commit(timeFromMinutes(base + minutes));
  };

  const durationHint = (option) => {
    if (!showDuration || !startTime) return '';
    let minutes = minutesFromTime(option) - minutesFromTime(startTime);
    if (minutes < 0) minutes += 1440;
    const payable = Math.max(0, minutes - (Number(breakMins) || 0));
    return fmtHours(payable / 60);
  };

  const query = searching ? draft.trim().toLowerCase() : '';
  const options = timePickerOptions.filter((option) => {
    if (!query) return true;
    return option.includes(query) || fmtTime(option).toLowerCase().includes(query);
  });

  return (
    <div className="time-picker" ref={wrapperRef}>
      <input
        className="time-native"
        type="time"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="time-combo">
        <Clock3 size={17} />
        <input
          type="text"
          value={draft}
          inputMode="numeric"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setDraft(event.target.value);
            setSearching(true);
            setOpen(true);
          }}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitDraft();
            }
            if (event.key === 'Escape') setOpen(false);
          }}
          aria-label="Time"
        />
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setSearching(false); setOpen((current) => !current); }} aria-label="Choose time">
          <ChevronDown size={16} />
        </button>
      </div>
      {open && (
        <div className="time-menu">
          <div className="time-shortcuts">
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => commit(timeFromMinutes(roundedMinutes(new Date().getHours() * 60 + new Date().getMinutes(), 15)))}>Now</button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => quickAdjust(15)}>+15m</button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => quickAdjust(30)}>+30m</button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => quickAdjust(60)}>+1h</button>
          </div>
          <div className="time-options">
            {(options.length ? options : timePickerOptions).map((option) => (
              <button
                type="button"
                key={option}
                className={option === value ? 'selected' : ''}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(option)}
              >
                <span>{fmtTime(option)}</span>
                {showDuration && <small>{durationHint(option)}</small>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateEditor({ jobs, template, open, save, cancel }) {
  const [form, setForm] = useState(template || {
    name: 'New Template',
    description: 'Reusable shift preset',
    jobId: jobs[0]?.id || '',
    title: 'New Shift',
    start: '09:00',
    end: '17:00',
    breakMins: 0,
    paidBreak: 0,
    location: '',
    notes: '',
    tags: [],
    displayTime: ''
  });
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    setForm(template || {
      name: 'New Template',
      description: 'Reusable shift preset',
      jobId: jobs[0]?.id || '',
      title: 'New Shift',
      start: '09:00',
      end: '17:00',
      breakMins: 0,
      paidBreak: 0,
      location: '',
      notes: '',
      tags: [],
      displayTime: ''
    });
  }, [template, open, jobs]);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const tagsValue = (form.tags || []).join(', ');
  const job = jobs.find((item) => item.id === form.jobId) || fallbackJob;
  const submitTemplate = async () => {
    try {
      await save({ ...form, displayTime: form.displayTime || undefined });
    } catch (error) {
      setSaveError(error?.message || 'The template could not be saved. Please try again.');
    }
  };

  if (!open) {
    return (
      <Panel title="Template Details">
        <div className="empty-state">
          <FileText size={34} />
          <h2>Select a template to edit</h2>
          <p>Create a new preset or edit an existing one. Templates fill every Add Shift field in one click.</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={template ? 'Edit Template' : 'Add Template'}>
      <div className="form-panel">
        <Field label="Template Name"><input value={form.name} onChange={(event) => update('name', event.target.value)} /></Field>
        <Field label="Description"><input value={form.description} onChange={(event) => update('description', event.target.value)} /></Field>
        <Field label="Job"><select value={form.jobId} onChange={(event) => update('jobId', event.target.value)} disabled={jobs.length === 0}>{jobs.length === 0 && <option value="">No jobs available</option>}{jobs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Shift Title"><input value={form.title} onChange={(event) => update('title', event.target.value)} /></Field>
        <div className="form-row">
          <Field label="Start Time"><TimePicker value={form.start} onChange={(value) => update('start', value)} /></Field>
          <Field label="End Time"><TimePicker value={form.end} onChange={(value) => update('end', value)} startTime={form.start} breakMins={form.breakMins} showDuration /></Field>
          <Field label="Display Text"><input value={form.displayTime || ''} placeholder="Optional, e.g. Custom" onChange={(event) => update('displayTime', event.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Unpaid Break"><input type="number" value={form.breakMins} onChange={(event) => update('breakMins', Number(event.target.value))} /></Field>
          <Field label="Paid Break"><input type="number" value={form.paidBreak} onChange={(event) => update('paidBreak', Number(event.target.value))} /></Field>
          <Field label="Tags"><input value={tagsValue} placeholder="Evening, Tips" onChange={(event) => update('tags', event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))} /></Field>
        </div>
        <Field label="Location"><input value={form.location} onChange={(event) => update('location', event.target.value)} /></Field>
        <Field label="Notes"><textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} /></Field>
        <div className="template-editor-preview">
          <span>Preview</span>
          <div className="template-grid">
            <button className="selected" type="button">
              <span className="template-icon" style={{ color: job.color, background: job.bg }}><BriefcaseBusiness size={22} /></span>
              <span className="template-copy"><strong>{form.name}</strong><small>{form.displayTime || `${fmtTime(form.start)} - ${fmtTime(form.end)}`}</small></span>
              <span className="template-check"><Check size={14} /></span>
            </button>
          </div>
        </div>
        <div className="form-actions">
          <button className="ghost" onClick={cancel}>Cancel</button>
          <button className="primary" disabled={jobs.length === 0} onClick={submitTemplate}><Check size={18} /> Save Template</button>
        </div>
        {saveError && (
          <NoticeModal
            title="Could not save template"
            message={saveError}
            cancel={() => setSaveError('')}
          />
        )}
      </div>
    </Panel>
  );
}

function AddShift({ jobs, templates, shift, save, cancel, remove, addJob, currencySettings, preferences, toggles }) {
  const defaultBreak = Number(preferences?.defaultBreak ?? runtimePreferences.defaultBreak ?? 0);
  const defaultCurrency = currencySettings.defaultCurrency || defaultCurrencySettings.defaultCurrency;
  const defaultStart = '09:00';
  const defaultEnd = timeFromMinutes(minutesFromTime(defaultStart) + durationMinutesFor(preferences?.defaultDuration));
  const [form, setForm] = useState(shift ? { ...shift, currency: shift.currency || defaultCurrency } : { jobId: jobs[0]?.id || '', title: '', date: getTodayIso(preferences), start: defaultStart, end: defaultEnd, breakMins: defaultBreak, paidBreak: 0, currency: defaultCurrency, location: '', notes: '', tags: [] });
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [showJobRequiredModal, setShowJobRequiredModal] = useState(() => jobs.length === 0 && !shift);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saveError, setSaveError] = useState('');
  const job = jobs.find((item) => item.id === form.jobId) || fallbackJob;
  const breakdown = payBreakdown(job, form, preferences);
  const hours = breakdown.hours;

  useEffect(() => {
    if (jobs.length === 0) return;
    setShowJobRequiredModal(false);
    setForm((current) => jobs.some((item) => item.id === current.jobId) ? current : { ...current, jobId: jobs[0].id });
  }, [jobs]);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const updateStart = (value) => {
    setForm((current) => ({
      ...current,
      start: value,
      end: !shift && toggles?.autoEndBreak ? timeFromMinutes(minutesFromTime(value) + durationMinutesFor(preferences?.defaultDuration)) : current.end
    }));
  };
  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag) return;
    setForm((current) => current.tags?.includes(tag) ? current : { ...current, tags: [...(current.tags || []), tag] });
    setTagInput('');
    setAddingTag(false);
  };
  const removeTag = (tag) => {
    setForm((current) => ({ ...current, tags: (current.tags || []).filter((item) => item !== tag) }));
  };
  const applyTemplate = (templateId) => {
    const template = templates.find((item) => item.id === templateId);
    setSelectedTemplate(templateId);
    if (!template) return;
    setForm((current) => ({
      ...current,
      jobId: jobs.some((item) => item.id === template.jobId) ? template.jobId : (jobs[0]?.id || ''),
      title: template.title,
      start: template.start,
      end: template.end,
      breakMins: template.breakMins,
      paidBreak: template.paidBreak,
      currency: current.currency || defaultCurrency,
      location: template.location,
      notes: template.notes,
      tags: template.tags
    }));
  };
  const friendlySaveError = (error) => {
    const message = error?.message || 'The shift could not be saved. Please try again.';
    if (message.toLowerCase().includes('foreign key')) {
      return 'This shift needs a saved job. Please save or select a job, then try again.';
    }
    return message;
  };
  const submitShift = async (nextForm) => {
    if (!nextForm.jobId) {
      setShowJobRequiredModal(true);
      return;
    }
    try {
      await save(nextForm);
    } catch (error) {
      setSaveError(friendlySaveError(error));
    }
  };
  return (
    <>
      <Header title={shift ? 'Edit Shift' : 'Add Shift'} subtitle="Enter the job, date, and time. Add details only when you need them.">
        <button className="ghost" onClick={cancel}><ArrowLeft size={18} /> Back to Shifts</button>
      </Header>
      <div className="form-layout">
        <section className="panel form-panel">
          {!shift && (
            <div className="template-grid">
              {templates.map((template) => {
                const selected = selectedTemplate === template.id;
                const templateTone = jobs.find((item) => item.id === template.jobId) || fallbackJob;
                const Icon = template.jobId === 'delivery' ? Truck : template.jobId === 'freelance' ? Laptop : template.jobId === 'cashier' ? BriefcaseBusiness : BriefcaseBusiness;
                return (
                  <button key={template.id} className={selected ? 'selected' : ''} onClick={() => applyTemplate(template.id)}>
                    <span className="template-icon" style={{ color: templateTone.color, background: templateTone.bg }}><Icon size={22} /></span>
                    <span className="template-copy">
                      <strong>{template.name}</strong>
                      <small>{template.displayTime || `${fmtTime(template.start)} - ${fmtTime(template.end)}`}</small>
                    </span>
                    {selected && <span className="template-check"><Check size={14} /></span>}
                  </button>
                );
              })}
            </div>
          )}
          <Field label="Job *"><select value={form.jobId} onChange={(e) => update('jobId', e.target.value)} disabled={jobs.length === 0}>{jobs.length === 0 && <option value="">No jobs available</option>}{jobs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
          <div className="form-row"><Field label="Date *"><input type="date" value={form.date} onChange={(e) => update('date', e.target.value)} /></Field><Field label="Start Time *"><TimePicker value={form.start} onChange={updateStart} /></Field><Field label="End Time *"><TimePicker value={form.end} onChange={(value) => update('end', value)} startTime={form.start} breakMins={form.breakMins} showDuration /></Field></div>
          <div className="form-row"><Field label="Unpaid Break"><select value={form.breakMins} onChange={(e) => update('breakMins', Number(e.target.value))}><option value="0">0 min</option><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">1h 00m</option></select></Field><Field label="Paid Break"><select value={form.paidBreak} onChange={(e) => update('paidBreak', Number(e.target.value))}><option value="0">0 min</option><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option></select></Field></div>
          <Field label="Location"><input value={form.location} onChange={(e) => update('location', e.target.value)} /></Field>
          <div className="form-row"><Field label="Hourly Rate"><input type="number" value={job.rate} readOnly /></Field><Field label="Currency"><select value={form.currency || defaultCurrency} onChange={(e) => update('currency', e.target.value)}>{currencySettings.enabledCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}</select></Field></div>
          <Field label="Label (Optional)"><input value={form.title} placeholder="Closing, training, inventory..." onChange={(e) => update('title', e.target.value)} /></Field>
          <Field label="Notes"><textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} /></Field>
          <div className="field">
            <span>Tags (Optional)</span>
            <div className="tag-editor">
              <div className="tags">
                {(form.tags || []).map((tag, index) => (
                  <span key={tag} className={`badge tag-badge ${index === 1 ? 'green' : ''} ${index === 2 ? 'amber' : ''}`}>
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove ${tag}`}><X size={13} /></button>
                  </span>
                ))}
                {(!form.tags || form.tags.length === 0) && <span className="badge empty-tag">No tags</span>}
                {addingTag ? (
                  <span className="inline-tag-input">
                    <input
                      autoFocus
                      value={tagInput}
                      onChange={(event) => setTagInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addTag();
                        }
                        if (event.key === 'Escape') {
                          setTagInput('');
                          setAddingTag(false);
                        }
                      }}
                      placeholder="Tag..."
                    />
                    <button type="button" onClick={addTag} aria-label="Save tag"><Check size={14} /></button>
                    <button type="button" onClick={() => { setTagInput(''); setAddingTag(false); }} aria-label="Cancel tag"><X size={14} /></button>
                  </span>
                ) : (
                  <button type="button" className="add-tag-icon" onClick={() => setAddingTag(true)} aria-label="Add tag"><Plus size={16} /></button>
                )}
              </div>
            </div>
          </div>
          <div className="form-actions"><button className="ghost" onClick={cancel}>Cancel</button><button className="ghost" disabled={jobs.length === 0 || !form.jobId} onClick={() => submitShift({ ...form, id: null })}>Save & Add Another</button><button className="primary" disabled={jobs.length === 0 || !form.jobId} onClick={() => submitShift(form)}><Check size={18} /> Save Shift</button></div>
        </section>
        <aside className="panel summary-panel">
          <h2>Shift Summary</h2><JobName job={job} />
          <InfoRows rows={[['Template', templates.find((item) => item.id === selectedTemplate)?.name || 'Custom'], ['Start Time', fmtTime(form.start)], ['End Time', fmtTime(form.end)], ['Total Time', fmtHours(hours + (Number(form.breakMins) || 0) / 60)], ['Unpaid Break', `- ${fmtHours((Number(form.breakMins) || 0) / 60)}`], ['Paid Break', `- ${fmtHours((Number(form.paidBreak) || 0) / 60)}`], ['Total Hours', fmtHours(hours)], ['Regular Hours', fmtHours(breakdown.regularHours)], ['Overtime Hours', fmtHours(breakdown.overtimeHours)], ['Double Time Hours', fmtHours(breakdown.doubleTimeHours)], ['Hourly Rate', money(job.rate, form.currency || defaultCurrency)], ['Estimated Earnings', money(breakdown.earnings, form.currency || defaultCurrency)], ['Date', fmtDate(form.date)], ['Location', form.location]]} />
          {shift && <button className="danger" onClick={() => setShowDeleteConfirm(true)}><Trash2 size={18} /> Delete Shift</button>}
        </aside>
      </div>
      {showDeleteConfirm && shift && (
        <ConfirmDeleteModal
          shift={form}
          job={job}
          cancel={() => setShowDeleteConfirm(false)}
          confirm={() => {
            setShowDeleteConfirm(false);
            remove(shift.id);
          }}
        />
      )}
      {showJobRequiredModal && (
        <JobRequiredModal
          cancel={() => setShowJobRequiredModal(false)}
          addJob={() => {
            setShowJobRequiredModal(false);
            addJob();
          }}
          message="Shifts need a job before they can be saved. Add your first job now, then you can record shifts, hours, and earnings against it."
        />
      )}
      {saveError && (
        <NoticeModal
          title="Could not save shift"
          message={saveError}
          cancel={() => setSaveError('')}
        />
      )}
    </>
  );
}

function ConfirmDeleteModal({ shift, job, cancel, confirm }) {
  const modalRef = useRef(null);

  useEffect(() => {
    const closeFromOutside = (event) => {
      if (!modalRef.current?.contains(event.target)) cancel();
    };
    document.addEventListener('pointerdown', closeFromOutside, true);
    return () => document.removeEventListener('pointerdown', closeFromOutside, true);
  }, [cancel]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={modalRef} className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-shift-title">
        <div className="icon-tile danger-tile"><Trash2 size={24} /></div>
        <h2 id="delete-shift-title">Delete shift?</h2>
        <p>This will permanently remove the {job?.name || 'selected'} shift on {fmtDate(shift.date)} from your records.</p>
        <div className="confirm-details">
          <span>{fmtTime(shift.start)} - {fmtTime(shift.end)}</span>
          <strong>{fmtHours(shiftHours(shift))}</strong>
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={cancel}>Cancel</button>
          <button className="danger solid-danger" onClick={confirm}><Trash2 size={18} /> Delete Shift</button>
        </div>
      </section>
    </div>
  );
}

function CalendarShiftModal({ date, jobs, shifts, cancel, selectShift }) {
  const modalRef = useRef(null);

  useEffect(() => {
    const closeFromOutside = (event) => {
      if (!modalRef.current?.contains(event.target)) cancel();
    };
    document.addEventListener('pointerdown', closeFromOutside, true);
    return () => document.removeEventListener('pointerdown', closeFromOutside, true);
  }, [cancel]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={modalRef} className="confirm-modal calendar-shift-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-shift-title">
        <div className="icon-tile"><CalendarDays size={24} /></div>
        <h2 id="calendar-shift-title">{fmtDate(isoDate(date))}</h2>
        <p>{shifts.length} shift{shifts.length === 1 ? '' : 's'} scheduled</p>
        <div className="calendar-shift-list">
          {shifts.map((shift) => {
            const job = jobs.find((item) => item.id === shift.jobId) || fallbackJob;
            const company = job.employer || shift.location || job.name || 'No company';
            return (
              <button key={shift.id} type="button" className="calendar-shift-row" style={{ borderLeftColor: job.color }} onClick={() => selectShift(shift)}>
                <div className="calendar-shift-job">
                  <strong>{company}</strong>
                  <span>{fmtTime(shift.start)} - {fmtTime(shift.end)}</span>
                </div>
                <Badge tone={job.color}>{fmtHours(shiftHours(shift))}</Badge>
              </button>
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={cancel}>Done</button>
        </div>
      </section>
    </div>
  );
}

function JobRequiredModal({ cancel, addJob, message = 'Templates need a job before they can be created. Add your first job now, then you can build reusable shift presets for it.' }) {
  const modalRef = useRef(null);

  useEffect(() => {
    const closeFromOutside = (event) => {
      if (!modalRef.current?.contains(event.target)) cancel();
    };
    document.addEventListener('pointerdown', closeFromOutside, true);
    return () => document.removeEventListener('pointerdown', closeFromOutside, true);
  }, [cancel]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={modalRef} className="confirm-modal setup-modal" role="dialog" aria-modal="true" aria-labelledby="template-job-required-title">
        <div className="icon-tile"><BriefcaseBusiness size={24} /></div>
        <h2 id="template-job-required-title">Create a job first</h2>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="ghost" onClick={cancel}>Cancel</button>
          <button className="primary" onClick={addJob}><Plus size={18} /> Add Job</button>
        </div>
      </section>
    </div>
  );
}

function NoticeModal({ title, message, cancel }) {
  const modalRef = useRef(null);

  useEffect(() => {
    const closeFromOutside = (event) => {
      if (!modalRef.current?.contains(event.target)) cancel();
    };
    document.addEventListener('pointerdown', closeFromOutside, true);
    return () => document.removeEventListener('pointerdown', closeFromOutside, true);
  }, [cancel]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={modalRef} className="confirm-modal setup-modal" role="dialog" aria-modal="true" aria-labelledby="notice-title">
        <div className="icon-tile"><AlertTriangle size={24} /></div>
        <h2 id="notice-title">{title}</h2>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="primary" onClick={cancel}>OK</button>
        </div>
      </section>
    </div>
  );
}

function AddJob({ job, save, cancel, currency, preferences, toggles }) {
  const [form, setForm] = useState(job || {
    name: '',
    employer: '',
    type: '',
    rate: toggles?.addRateToJobs ? Number(preferences?.defaultRate || 0) : 0,
    payType: 'Hourly',
    color: '#0ea5e9',
    bg: '#e0f2fe',
    active: true
  });
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const colors = [
    ['#2563eb', '#dbeafe'],
    ['#16a34a', '#dcfce7'],
    ['#7c3aed', '#ede9fe'],
    ['#f59e0b', '#fef3c7'],
    ['#0ea5e9', '#e0f2fe'],
    ['#e11d48', '#ffe4e6']
  ];
  const jobTypes = form.type && !jobTypeOptions.includes(form.type)
    ? [form.type, ...jobTypeOptions]
    : jobTypeOptions;

  return (
    <>
      <Header title={job ? 'Edit Job' : 'Add Job'} subtitle="Create a role with its pay rate, category, and tracking color.">
        <button className="ghost" onClick={cancel}><ArrowLeft size={18} /> Back to Jobs</button>
      </Header>
      <div className="form-layout">
        <section className="panel form-panel">
          <div className="form-row">
            <Field label="Job Title *"><input value={form.name} onChange={(e) => update('name', e.target.value)} /></Field>
            <Field label="Employer"><input value={form.employer} onChange={(e) => update('employer', e.target.value)} /></Field>
            <Field label="Job Type">
              <select value={form.type} onChange={(e) => update('type', e.target.value)}>
                <option value="">Select type</option>
                {jobTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </Field>
          </div>
          <div className="form-row">
            <Field label="Hourly Rate"><input type="number" value={form.rate} onChange={(e) => update('rate', Number(e.target.value))} /></Field>
            <Field label="Pay Type"><select value={form.payType} onChange={(e) => update('payType', e.target.value)}><option>Hourly</option><option>Contract</option><option>Salary</option></select></Field>
            <Field label="Status"><select value={form.active ? 'Active' : 'Inactive'} onChange={(e) => update('active', e.target.value === 'Active')}><option>Active</option><option>Inactive</option></select></Field>
          </div>
          <div className="field">
            <span>Job Color</span>
            <div className="swatches">
              {colors.map(([color, bg]) => (
                <button
                  key={color}
                  className={form.color === color ? 'selected' : ''}
                  style={{ background: color }}
                  onClick={() => setForm((current) => ({ ...current, color, bg }))}
                  aria-label={`Use ${color}`}
                />
              ))}
            </div>
          </div>
          <div className="form-actions">
            <button className="ghost" onClick={cancel}>Cancel</button>
            <button className="primary" disabled={!form.name.trim()} onClick={() => save(form)}><Check size={18} /> Save Job</button>
          </div>
        </section>
        <aside className="panel summary-panel">
          <h2>Job Preview</h2>
          <JobName job={form} />
          <InfoRows rows={[['Employer', form.employer], ['Hourly Rate', money(Number(form.rate) || 0, currency)], ['Pay Type', form.payType], ['Job Type', form.type], ['Overtime Rate', money((Number(form.rate) || 0) * (Number(preferences?.overtimeMultiplier) || 1.5), currency)], ['Double Time Rate', money((Number(form.rate) || 0) * (Number(preferences?.doubleTimeMultiplier) || 2), currency)], ['Status', form.active ? 'Active' : 'Inactive']]} />
        </aside>
      </div>
    </>
  );
}

function Panel({ title, action, link, onLinkClick, className = '', children }) {
  return <section className={`panel ${className}`.trim()}><div className="panel-head"><h2>{title}</h2>{action && (React.isValidElement(action) ? action : <button className="ghost small">{action} <ChevronDown size={14} /></button>)}{link && <button className="panel-link" onClick={onLinkClick}>{link} <ArrowRight size={15} /></button>}</div>{children}</section>;
}

function ShiftTable({ jobs, shifts, compact, edit, requestDelete, currency = 'USD' }) {
  const shiftDateParts = (iso) => {
    const date = toDate(iso);
    return {
      month: date.toLocaleDateString(localeFor(), { month: 'short' }).toUpperCase(),
      day: String(date.getDate()).padStart(2, '0'),
      weekday: date.toLocaleDateString(localeFor(), { weekday: 'short' })
    };
  };

  return (
    <>
      <table className={`data-table shift-table-grid ${compact ? 'compact-table' : ''} ${edit ? 'clickable-rows' : ''}`}>
        <thead><tr><th>Date</th><th>Company</th><th>Job</th><th>Start Time</th><th>End Time</th><th>Duration</th>{!compact && <th>Pay Estimate</th>}<th>Status</th>{!compact && <th>Actions</th>}</tr></thead>
        <tbody>{shifts.map((shift) => { const job = jobs.find((item) => item.id === shift.jobId) || fallbackJob; const pay = payBreakdown(job, shift); const rowCurrency = shift.currency || currency; const company = job.employer || shift.location || '-'; return <tr key={shift.id} onClick={() => edit?.(shift)} tabIndex={edit ? 0 : undefined} onKeyDown={(event) => { if (edit && (event.key === 'Enter' || event.key === ' ')) edit(shift); }}><td>{fmtDate(shift.date)}</td><td>{company}</td><td><JobName job={job} minimal /></td><td>{fmtTime(shift.start)}</td><td>{fmtTime(shift.end)}</td><td>{fmtHours(pay.hours)}</td>{!compact && <td>{money(pay.earnings, rowCurrency)}</td>}<td><Status status={shift.status} /></td>{!compact && <td className="row-actions"><button onClick={(event) => { event.stopPropagation(); edit?.(shift); }} aria-label="Edit shift"><Edit3 size={16} /></button><button className="delete-action" onClick={(event) => { event.stopPropagation(); requestDelete?.(shift); }} aria-label="Delete shift"><Trash2 size={16} /></button></td>}</tr>; })}</tbody>
      </table>
      <div className="shift-card-list">
        {shifts.map((shift) => {
          const job = jobs.find((item) => item.id === shift.jobId) || fallbackJob;
          const pay = payBreakdown(job, shift);
          const date = shiftDateParts(shift.date);
          const company = job.employer || shift.location || job.name || 'No company';
          const rowCurrency = shift.currency || currency;
          const location = shift.location && shift.location !== company ? shift.location : '';
          return (
            <button
              key={shift.id}
              className="shift-list-card"
              type="button"
              onClick={() => edit?.(shift)}
              disabled={!edit}
            >
              <span className="shift-date-tile">
                <small>{date.month}</small>
                <strong>{date.day}</strong>
                <em>{date.weekday}</em>
              </span>
              <span className="shift-card-main">
                <span className="shift-card-title"><i style={{ background: job.color }} />{company}</span>
                <span className="shift-card-time">{fmtTime(shift.start)} - {fmtTime(shift.end)}</span>
                {(location || shift.notes) && <span className="shift-card-meta">{[location, shift.notes].filter(Boolean).join('  •  ')}</span>}
              </span>
              <span className="shift-card-totals">
                <strong>{fmtHours(pay.hours)}</strong>
                <small>{money(pay.earnings, rowCurrency)}</small>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function JobName({ job = fallbackJob, minimal }) {
  const Icon = job.id === 'delivery' ? BriefcaseBusiness : job.id === 'freelance' ? LayoutGrid : job.id === 'cashier' ? BriefcaseBusiness : CalendarDays;
  return <div className="job-name"><span className="job-icon" style={{ color: job.color, background: job.bg }}><Icon size={18} /></span><div><strong>{job.name || 'Untitled Job'}</strong>{!minimal && <small>{job.type}</small>}</div></div>;
}

function Badge({ children, green, amber, tone }) {
  const style = tone ? { color: tone, background: `${tone}16` } : undefined;
  return <span className={`badge ${green ? 'green' : ''} ${amber ? 'amber' : ''}`} style={style}>{children}</span>;
}

function Status({ status }) {
  return <Badge green={status === 'Approved'} amber={status === 'Pending'}>{status}</Badge>;
}

function BarChart({ values, labels }) {
  const max = Math.max(...values, 1);
  return <div className="bar-chart">{values.map((value, i) => <div className="bar-col" key={labels[i]}><span>{value ? fmtHours(value) : '0h'}</span><div style={{ height: `${(value / max) * 88 + 8}%` }} /><small>{labels[i]}</small></div>)}</div>;
}

function LineChart({ values = [0], labels = [] }) {
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 300 : 20 + (index * (560 / (values.length - 1)));
    const y = 190 - ((value / max) * 150);
    return `${x},${y}`;
  });
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point}`).join(' ');
  const area = `${path} L580,190 L20,190 Z`;
  return <div className="line-chart"><svg viewBox="0 0 600 210" preserveAspectRatio="none"><path d={path} fill="none" stroke="#3563f4" strokeWidth="4" /><path d={area} fill="rgba(53,99,244,.1)" /></svg><div className="line-labels">{labels.map((label) => <small key={label}>{label}</small>)}</div></div>;
}

function JobBars({ jobs, shifts, compact }) {
  const total = Math.max(1, shifts.reduce((sum, shift) => sum + shiftHours(shift), 0));
  return <div className="job-bars">{jobs.map((job) => { const hours = jobHours(job.id, shifts); return <div key={job.id} className="job-bar-row"><JobName job={job} minimal={compact} /><strong>{fmtHours(hours)}</strong><span>{Math.round(hours / total * 100)}%</span><div><i style={{ width: `${Math.max(4, hours / total * 100)}%`, background: job.color }} /></div></div>; })}</div>;
}

function Donut({ jobs, shifts, earnings, currency = 'USD' }) {
  const totals = jobs.map((job) => {
    const jobShifts = shifts.filter((shift) => shift.jobId === job.id);
    return earnings ? earningsFor([job], jobShifts) : hoursFor(jobShifts);
  });
  const sum = totals.reduce((total, value) => total + value, 0) || 1;
  let cursor = 0;
  const stops = jobs.map((job, index) => {
    const start = cursor;
    cursor += (totals[index] / sum) * 100;
    return `${job.color} ${start}% ${cursor}%`;
  }).join(', ');
  return <div className="donut-report"><div className="donut" style={{ background: `conic-gradient(${stops || '#e5e7eb 0 100%'})` }} /><DonutLegend jobs={jobs} totals={totals} total={sum} earnings={earnings} currency={currency} /></div>;
}

function DonutLegend({ jobs, totals, total, earnings, currency }) {
  return (
    <div className="donut-legend">
      {jobs.map((job, index) => {
        const value = totals[index] || 0;
        return (
          <div key={job.id} className="donut-legend-row">
            <span className="legend-dot" style={{ background: job.color }} />
            <strong>{job.name}</strong>
            <span>{earnings ? money(value, currency) : fmtHours(value)}</span>
            <small>{((value / total) * 100).toFixed(1)}%</small>
          </div>
        );
      })}
      <div className="donut-total"><span>Total</span><strong>{earnings ? money(totals.reduce((sum, value) => sum + value, 0), currency) : fmtHours(totals.reduce((sum, value) => sum + value, 0))}</strong></div>
    </div>
  );
}

function AverageShiftBars({ jobs, shifts }) {
  const values = jobs.map((job) => {
    const jobShifts = shifts.filter((shift) => shift.jobId === job.id);
    return {
      job,
      value: hoursFor(jobShifts) / Math.max(1, jobShifts.length)
    };
  });
  const max = Math.max(10, ...values.map((item) => item.value));
  return (
    <div className="average-bars">
      {values.map(({ job, value }) => (
        <div key={job.id} className="average-bar-row">
          <strong>{job.name}</strong>
          <div><i style={{ width: `${Math.max(3, (value / max) * 100)}%`, background: job.color }} /></div>
          <span>{fmtHours(value)}</span>
        </div>
      ))}
      <div className="average-axis"><span>0h</span><span>2h</span><span>4h</span><span>6h</span><span>8h</span><span>10h</span></div>
    </div>
  );
}

function Ring({ value, label }) {
  return <div className="ring"><div>{value}<small>{label}</small></div></div>;
}

function Upcoming({ jobs, shifts, compact, detail = 'type' }) {
  return <div className={`upcoming ${compact ? 'compact-upcoming' : ''}`}>{shifts.map((shift) => { const job = jobs.find((item) => item.id === shift.jobId) || fallbackJob; return <div key={shift.id} className={`upcoming-row ${detail === 'time' ? 'time-detail' : ''}`}><div className="date-pill">{fmtDate(shift.date, true)}</div>{detail === 'time' ? <div className="job-name"><span className="job-icon" style={{ color: job.color, background: job.bg }}><CalendarDays size={18} /></span><div><strong>{job.name}</strong><small>{fmtTime(shift.start)} - {fmtTime(shift.end)}</small></div></div> : <JobName job={job} />}{detail !== 'time' && <span>{fmtTime(shift.start)} - {fmtTime(shift.end)}</span>}<Badge tone={job.color}>{fmtHours(shiftHours(shift))}</Badge></div>; })}</div>;
}

function JobCard({ job, shifts, select, currency = 'USD' }) {
  const hours = jobHours(job.id, shifts);
  return <section className="job-card" style={{ borderTopColor: job.color }}><div className="job-card-head"><JobName job={job} /><Badge green>Active</Badge></div><div className="metric-pair"><div><strong>{money(job.rate, currency)}</strong><span>Hourly Rate</span></div><div><strong>{job.payType}</strong><span>Pay Type</span></div><div><strong>{fmtHours(hours / 8)}</strong><span>This Week</span></div><div><strong>{fmtHours(hours)}</strong><span>This Month</span></div></div><button className="outline-action" style={{ color: job.color }} onClick={select}>View Details <ArrowRight size={17} /></button></section>;
}

function DayCell({ date, viewDate, jobs, shifts, selected, onSelect }) {
  const iso = isoDate(date);
  const isCurrentMonth = date.getMonth() === viewDate.getMonth();
  const dayShifts = shifts.filter((shift) => shift.date === iso).slice(0, 3);
  return <button className={`day-cell ${!isCurrentMonth ? 'muted' : ''} ${selected ? 'selected' : ''}`} onClick={onSelect}><strong>{date.getDate()}</strong>{dayShifts.map((shift) => { const job = jobs.find((item) => item.id === shift.jobId); return <span key={shift.id} style={{ background: job?.bg, color: job?.color }}>{fmtTime(shift.start).replace(':00 ', '')} - {fmtTime(shift.end).replace(':00 ', '')}<small>{job?.name}</small></span>; })}</button>;
}

function WeekCalendar({ days, jobs, shifts, selectedDate, selectDate }) {
  return (
    <div className="week-grid">
      {days.map((date) => {
        const iso = isoDate(date);
        const dayShifts = shifts.filter((shift) => shift.date === iso).sort((a, b) => normalizeTime(a.start).localeCompare(normalizeTime(b.start)));
        return (
          <section key={iso} className={`week-day ${iso === isoDate(selectedDate) ? 'selected' : ''}`} onClick={() => selectDate(date)}>
            <header><span>{date.toLocaleDateString(localeFor(), { weekday: 'short' })}</span><strong>{date.getDate()}</strong></header>
            <div className="week-events">
              {dayShifts.length === 0 && <p>No shifts</p>}
              {dayShifts.map((shift) => {
                const job = jobs.find((item) => item.id === shift.jobId);
                return <div key={shift.id} className="week-event" style={{ borderColor: job?.color, background: job?.bg, color: job?.color }}><strong>{job?.name}</strong><span>{fmtTime(shift.start)} - {fmtTime(shift.end)}</span></div>;
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DayAgenda({ date, jobs, shifts }) {
  const dayShifts = shifts.filter((shift) => shift.date === isoDate(date)).sort((a, b) => normalizeTime(a.start).localeCompare(normalizeTime(b.start)));
  return (
    <div className="day-agenda">
      {dayShifts.length === 0 && <div className="empty-state"><CalendarDays size={34} /><h2>No shifts scheduled</h2><p>This day has no visible shifts. Use Add Shift to schedule one.</p></div>}
      {dayShifts.map((shift) => {
        const job = jobs.find((item) => item.id === shift.jobId);
        return (
          <section key={shift.id} className="agenda-item" style={{ borderLeftColor: job?.color }}>
            <div className="agenda-time"><strong>{fmtTime(shift.start)}</strong><span>{fmtTime(shift.end)}</span></div>
            <div><JobName job={job} /><small>{shift.location}</small></div>
            <Badge tone={job?.color}>{fmtHours(shiftHours(shift))}</Badge>
          </section>
        );
      })}
    </div>
  );
}

function MiniCalendar({ viewDate, setViewDate }) {
  const monthStart = startOfMonth(viewDate);
  const firstGridDay = startOfWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstGridDay);
    date.setDate(firstGridDay.getDate() + index);
    return date;
  });
  const changeMonth = (offset) => setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1, 12));
  return (
    <section className="panel mini-calendar">
      <div className="mini-calendar-head"><button className="icon-button" onClick={() => changeMonth(-1)}><ChevronLeft size={16} /></button><h2>{viewDate.toLocaleDateString(localeFor(), { month: 'long', year: 'numeric' })}</h2><button className="icon-button" onClick={() => changeMonth(1)}><ChevronRight size={16} /></button></div>
      <div className="mini-calendar-grid">
        {weekdayLabels(isoDate(viewDate)).map((day, index) => <b key={`${day}-${index}`}>{day.slice(0, 1)}</b>)}
        {days.map((date) => <button key={isoDate(date)} className={`${date.getMonth() !== viewDate.getMonth() ? 'muted' : ''} ${isoDate(date) === isoDate(viewDate) ? 'selected' : ''}`} onClick={() => setViewDate(date)}>{date.getDate()}</button>)}
      </div>
    </section>
  );
}

function JobBreakdown({ color, shifts = [] }) {
  const labels = weekdayLabels();
  const totals = labels.map((day) => hoursFor(shifts.filter((shift) => toDate(shift.date).toLocaleDateString(localeFor(), { weekday: 'short' }) === day)));
  const max = Math.max(...totals, 1);
  return (
    <div className="breakdown">
      {labels.map((day, index) => (
        <div key={day}>
          <span>{day}</span>
          <div><i style={{ width: `${Math.max(4, (totals[index] / max) * 100)}%`, background: color }} /></div>
          <b>{fmtHours(totals[index])}</b>
        </div>
      ))}
    </div>
  );
}

function InfoRows({ rows }) {
  return <div className="info-rows">{rows.map(([a, b]) => <div key={a}><span>{a}</span><strong>{b}</strong></div>)}</div>;
}

const preferenceOptions = {
  language: ['English', 'French', 'Spanish', 'Chinese', 'Hindi'],
  timezone: ['UTC-05:00', 'UTC-06:00', 'UTC+00:00', 'UTC+05:30', 'UTC+08:00'],
  weekStart: ['Monday', 'Sunday', 'Saturday'],
  defaultBreak: ['0', '15', '30', '45', '60'],
  dateFormat: ['MMM d, yyyy', 'yyyy-MM-dd', 'MM/dd/yyyy', 'dd/MM/yyyy'],
  timeFormat: ['12-hour', '24-hour'],
  defaultDuration: ['4', '6', '8', '10', '12'],
  overtimeThreshold: ['8', '10', '12'],
  rounding: ['0', '5', '10', '15', '30'],
  defaultRate: ['0', '15', '18', '20', '25', '30', '35', '40', '50'],
  overtimeMultiplier: ['1', '1.25', '1.50', '1.75', '2.00'],
  doubleTimeMultiplier: ['1.50', '2.00', '2.50', '3.00']
};

function SettingsRows({ rows, values, update }) {
  return (
    <div className="settings-rows">
      {rows.map(([key, label]) => (
        <label key={key}>
          <span>{label}</span>
          {preferenceOptions[key] ? (
            <select value={values[key]} onChange={(event) => update(key, event.target.value)}>
              {preferenceOptions[key].map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          ) : (
            <input value={values[key]} onChange={(event) => update(key, event.target.value)} />
          )}
        </label>
      ))}
    </div>
  );
}

function ThemeMode({ value, onChange }) {
  return (
    <div className="theme-mode">
      <button className={value === 'light' ? 'selected' : ''} onClick={() => onChange('light')}>
        <span><Settings size={19} /></span>
        <strong>Light</strong>
        {value === 'light' && <Check size={15} />}
      </button>
      <button className={value === 'dark' ? 'selected' : ''} onClick={() => onChange('dark')}>
        <span><Clock3 size={19} /></span>
        <strong>Dark</strong>
        {value === 'dark' && <Check size={15} />}
      </button>
    </div>
  );
}

function PreferenceRows({ rows, values, update }) {
  return (
    <div className="settings-rows">
      {rows.map(([key, label]) => (
        <label key={key}>
          <span>{label}</span>
          <select value={values[key]} onChange={(event) => update(key, event.target.value)}>
            {(preferenceOptions[key] || []).map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}

function CurrencySettings({ settings, setDefaultCurrency, toggleCurrency }) {
  const [currencyQuery, setCurrencyQuery] = useState('');
  const selectedCurrencies = currencyOptions.filter((currency) => settings.enabledCurrencies.includes(currency.code));
  const defaultCurrency = currencyOptions.find((currency) => currency.code === settings.defaultCurrency);
  const visibleCurrencies = currencyOptions.filter((currency) => !currencyQuery || matchesText(`${currency.code} ${currency.name}`, currencyQuery));
  return (
    <div className="currency-settings">
      <div className="currency-default">
        <div>
          <span>Default currency</span>
          <strong>{settings.defaultCurrency}</strong>
          <small>{defaultCurrency?.name}</small>
        </div>
        <select value={settings.defaultCurrency} onChange={(event) => setDefaultCurrency(event.target.value)}>
          {settings.enabledCurrencies.map((code) => {
            const currency = currencyOptions.find((item) => item.code === code);
            return <option key={code} value={code}>{code} - {currency?.name}</option>;
          })}
        </select>
      </div>
      <div className="selected-currencies">
        {selectedCurrencies.map((currency) => <span key={currency.code}>{currency.code}</span>)}
      </div>
      <label className="currency-search"><Search size={16} /><input value={currencyQuery} onChange={(event) => setCurrencyQuery(event.target.value)} placeholder="Search currencies..." /></label>
      <div className="currency-list">
        {visibleCurrencies.map((currency) => (
          <button
            key={currency.code}
            className={settings.enabledCurrencies.includes(currency.code) ? 'selected' : ''}
            onClick={() => toggleCurrency(currency.code)}
          >
            <span>{currency.code}</span>
            <small>{currency.name}</small>
            {settings.enabledCurrencies.includes(currency.code) && <Check size={15} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, on, onClick }) {
  return <div className="toggle-row"><span>{label}</span><button className={`toggle ${on ? 'on' : ''}`} onClick={onClick}><i /></button></div>;
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Footer() {
  return <footer>© 2026 ShiftTrack. All rights reserved.</footer>;
}

function jobHours(jobId, shifts) {
  return shifts.filter((shift) => shift.jobId === jobId).reduce((sum, shift) => sum + shiftHours(shift), 0);
}

createRoot(document.getElementById('root')).render(<App />);
