import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer as createViteServer } from 'vite';

const root = process.cwd();
const dataDir = path.join(root, 'data');
const dbPath = path.join(dataDir, 'shifttrack.sqlite');
const port = Number(process.env.PORT || 5173);

fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  pragma foreign_keys = on;

  create table if not exists users (
    id text primary key,
    email text not null unique,
    name text not null,
    password_hash text not null,
    salt text not null,
    created_at text not null default current_timestamp
  );

  create table if not exists sessions (
    token text primary key,
    user_id text not null references users(id) on delete cascade,
    created_at text not null default current_timestamp
  );

  create table if not exists jobs (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    name text not null,
    employer text,
    type text,
    rate real not null default 0,
    pay_type text not null default 'Hourly',
    color text not null default '#2563eb',
    bg text not null default '#dbeafe',
    active integer not null default 1,
    created_at text not null default current_timestamp,
    updated_at text not null default current_timestamp
  );

  create table if not exists shifts (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    job_id text not null references jobs(id) on delete cascade,
    title text,
    date text not null,
    start_time text,
    end_time text,
    break_mins integer not null default 0,
    paid_break integer not null default 0,
    notes text,
    status text not null default 'Recorded',
    location text,
    currency text not null default 'USD',
    created_at text not null default current_timestamp,
    updated_at text not null default current_timestamp
  );

  create table if not exists shift_templates (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    name text not null,
    description text,
    job_id text not null references jobs(id) on delete cascade,
    title text,
    start_time text,
    end_time text,
    break_mins integer not null default 0,
    paid_break integer not null default 0,
    location text,
    notes text,
    tags text not null default '[]',
    display_time text,
    created_at text not null default current_timestamp,
    updated_at text not null default current_timestamp
  );

  create table if not exists app_settings (
    user_id text primary key references users(id) on delete cascade,
    app_settings text not null default '{}',
    currency_settings text not null default '{}',
    created_at text not null default current_timestamp,
    updated_at text not null default current_timestamp
  );

  create index if not exists jobs_user_id_idx on jobs(user_id);
  create index if not exists shifts_user_id_date_idx on shifts(user_id, date);
  create index if not exists shifts_job_id_idx on shifts(job_id);
  create index if not exists shift_templates_user_id_idx on shift_templates(user_id);
`);

const shiftColumns = db.prepare('pragma table_info(shifts)').all().map((column) => column.name);
if (!shiftColumns.includes('currency')) {
  db.exec("alter table shifts add column currency text not null default 'USD'");
}

const vite = await createViteServer({
  root,
  server: { middlewareMode: true },
  appType: 'spa'
});

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  return crypto.timingSafeEqual(
    Buffer.from(hashPassword(password, salt).hash, 'hex'),
    Buffer.from(hash, 'hex')
  );
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('insert into sessions (token, user_id) values (?, ?)').run(token, userId);
  return token;
}

function authUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  return db.prepare(`
    select users.id, users.email, users.name
    from sessions
    join users on users.id = sessions.user_id
    where sessions.token = ?
  `).get(token);
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function boolInt(value, fallback = true) {
  if (value === undefined || value === null) return fallback ? 1 : 0;
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

function cleanTime(value) {
  return value ? String(value).slice(0, 5) : null;
}

function cleanId(value) {
  return value === undefined || value === null ? '' : String(value);
}

function jobFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    employer: row.employer || '',
    type: row.type || '',
    rate: Number(row.rate) || 0,
    payType: row.pay_type || 'Hourly',
    color: row.color || '#2563eb',
    bg: row.bg || '#dbeafe',
    active: Boolean(row.active)
  };
}

function shiftFromRow(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    title: row.title || '',
    date: row.date,
    start: cleanTime(row.start_time) || '',
    end: cleanTime(row.end_time) || '',
    breakMins: Number(row.break_mins) || 0,
    paidBreak: Number(row.paid_break) || 0,
    notes: row.notes || '',
    status: row.status || 'Recorded',
    location: row.location || '',
    currency: row.currency || 'USD'
  };
}

function templateFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    jobId: row.job_id,
    title: row.title || '',
    start: cleanTime(row.start_time) || '',
    end: cleanTime(row.end_time) || '',
    breakMins: Number(row.break_mins) || 0,
    paidBreak: Number(row.paid_break) || 0,
    location: row.location || '',
    notes: row.notes || '',
    tags: parseJson(row.tags, []),
    displayTime: row.display_time || undefined
  };
}

const upsertJobStatement = db.prepare(`
  insert into jobs (id, user_id, name, employer, type, rate, pay_type, color, bg, active, updated_at)
  values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)
  on conflict(id) do update set
    name = excluded.name,
    employer = excluded.employer,
    type = excluded.type,
    rate = excluded.rate,
    pay_type = excluded.pay_type,
    color = excluded.color,
    bg = excluded.bg,
    active = excluded.active,
    updated_at = current_timestamp
  where jobs.user_id = excluded.user_id
`);

const upsertShiftStatement = db.prepare(`
  insert into shifts (id, user_id, job_id, title, date, start_time, end_time, break_mins, paid_break, notes, status, location, currency, updated_at)
  values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)
  on conflict(id) do update set
    job_id = excluded.job_id,
    title = excluded.title,
    date = excluded.date,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    break_mins = excluded.break_mins,
    paid_break = excluded.paid_break,
    notes = excluded.notes,
    status = excluded.status,
    location = excluded.location,
    currency = excluded.currency,
    updated_at = current_timestamp
  where shifts.user_id = excluded.user_id
`);

const upsertTemplateStatement = db.prepare(`
  insert into shift_templates (id, user_id, name, description, job_id, title, start_time, end_time, break_mins, paid_break, location, notes, tags, display_time, updated_at)
  values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)
  on conflict(id) do update set
    name = excluded.name,
    description = excluded.description,
    job_id = excluded.job_id,
    title = excluded.title,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    break_mins = excluded.break_mins,
    paid_break = excluded.paid_break,
    location = excluded.location,
    notes = excluded.notes,
    tags = excluded.tags,
    display_time = excluded.display_time,
    updated_at = current_timestamp
  where shift_templates.user_id = excluded.user_id
`);

function deleteMissing(table, userId, ids) {
  if (!ids.length) {
    db.prepare(`delete from ${table} where user_id = ?`).run(userId);
    return;
  }
  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(`delete from ${table} where user_id = ? and id not in (${placeholders})`).run(userId, ...ids);
}

function replaceJobs(userId, jobs) {
  const rows = Array.isArray(jobs) ? jobs : [];
  deleteMissing('jobs', userId, rows.map((job) => cleanId(job.id)));
  rows.forEach((job) => {
    const id = cleanId(job.id);
    if (!id || !job.name) return;
    upsertJobStatement.run(
      id,
      userId,
      String(job.name),
      job.employer || '',
      job.type || '',
      Number(job.rate) || 0,
      job.payType || 'Hourly',
      job.color || '#2563eb',
      job.bg || '#dbeafe',
      boolInt(job.active)
    );
  });
}

function replaceShifts(userId, shifts) {
  const rows = Array.isArray(shifts) ? shifts : [];
  deleteMissing('shifts', userId, rows.map((shift) => cleanId(shift.id)));
  rows.forEach((shift) => {
    const id = cleanId(shift.id);
    const jobId = cleanId(shift.jobId);
    if (!id || !jobId || !shift.date) return;
    upsertShiftStatement.run(
      id,
      userId,
      jobId,
      shift.title || '',
      shift.date,
      cleanTime(shift.start),
      cleanTime(shift.end),
      Number(shift.breakMins) || 0,
      Number(shift.paidBreak) || 0,
      shift.notes || '',
      shift.status || 'Recorded',
      shift.location || '',
      shift.currency || 'USD'
    );
  });
}

function replaceTemplates(userId, templates) {
  const rows = Array.isArray(templates) ? templates : [];
  deleteMissing('shift_templates', userId, rows.map((template) => cleanId(template.id)));
  rows.forEach((template) => {
    const id = cleanId(template.id);
    const jobId = cleanId(template.jobId);
    if (!id || !jobId || !template.name) return;
    upsertTemplateStatement.run(
      id,
      userId,
      template.name,
      template.description || '',
      jobId,
      template.title || '',
      cleanTime(template.start),
      cleanTime(template.end),
      Number(template.breakMins) || 0,
      Number(template.paidBreak) || 0,
      template.location || '',
      template.notes || '',
      JSON.stringify(Array.isArray(template.tags) ? template.tags : []),
      template.displayTime || null
    );
  });
}

function currentSettings(userId) {
  const row = db.prepare('select app_settings, currency_settings from app_settings where user_id = ?').get(userId);
  return {
    appSettings: parseJson(row?.app_settings, undefined),
    currencySettings: parseJson(row?.currency_settings, undefined)
  };
}

function saveSettings(userId, next) {
  const existing = currentSettings(userId);
  const appSettings = next.appSettings ?? existing.appSettings ?? {};
  const currencySettings = next.currencySettings ?? existing.currencySettings ?? {};
  db.prepare(`
    insert into app_settings (user_id, app_settings, currency_settings, updated_at)
    values (?, ?, ?, current_timestamp)
    on conflict(user_id) do update set
      app_settings = excluded.app_settings,
      currency_settings = excluded.currency_settings,
      updated_at = current_timestamp
  `).run(userId, JSON.stringify(appSettings), JSON.stringify(currencySettings));
}

function getData(userId) {
  const settings = currentSettings(userId);
  return {
    jobs: db.prepare('select * from jobs where user_id = ? order by created_at, name').all(userId).map(jobFromRow),
    shifts: db.prepare('select * from shifts where user_id = ? order by date desc, start_time desc').all(userId).map(shiftFromRow),
    templates: db.prepare('select * from shift_templates where user_id = ? order by created_at, name').all(userId).map(templateFromRow),
    ...(settings.currencySettings ? { currencySettings: settings.currencySettings } : {}),
    ...(settings.appSettings ? { appSettings: settings.appSettings } : {})
  };
}

function saveData(userId, key, value) {
  db.exec('begin immediate');
  try {
    if (key === 'jobs') replaceJobs(userId, value);
    else if (key === 'shifts') replaceShifts(userId, value);
    else if (key === 'templates') replaceTemplates(userId, value);
    else if (key === 'appSettings') saveSettings(userId, { appSettings: value });
    else if (key === 'currencySettings') saveSettings(userId, { currencySettings: value });
    else throw new Error(`Unsupported local data key: ${key}`);
    db.exec('commit');
  } catch (error) {
    db.exec('rollback');
    throw error;
  }
}

function saveInitialData(userId, data = {}) {
  ['jobs', 'shifts', 'templates', 'appSettings', 'currencySettings'].forEach((key) => {
    if (data[key] !== undefined) saveData(userId, key, data[key]);
  });
}

async function handleApi(req, res) {
  try {
    if (req.method === 'POST' && req.url === '/api/local/signup') {
      const { name, email, password, initialData } = await readJson(req);
      const cleanName = String(name || '').trim();
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanName || !cleanEmail || !password) return json(res, 400, { error: 'Name, email, and password are required.' });
      const { salt, hash } = hashPassword(password);
      const id = crypto.randomUUID();
      try {
        db.prepare('insert into users (id, email, name, password_hash, salt) values (?, ?, ?, ?, ?)').run(id, cleanEmail, cleanName, hash, salt);
      } catch {
        return json(res, 409, { error: 'An account with this email already exists.' });
      }
      saveInitialData(id, initialData);
      const token = createSession(id);
      return json(res, 200, { token, user: { id, email: cleanEmail, name: cleanName }, data: getData(id) });
    }

    if (req.method === 'POST' && req.url === '/api/local/login') {
      const { email, identifier, password } = await readJson(req);
      const account = String(identifier || email || '').trim().toLowerCase();
      const user = db.prepare('select * from users where lower(email) = ? or lower(name) = ? order by created_at limit 1').get(account, account);
      if (!user || !verifyPassword(password || '', user.salt, user.password_hash)) return json(res, 401, { error: 'Invalid email or password.' });
      const token = createSession(user.id);
      return json(res, 200, { token, user: { id: user.id, email: user.email, name: user.name }, data: getData(user.id) });
    }

    if (req.method === 'GET' && req.url === '/api/local/me') {
      const user = authUser(req);
      if (!user) return json(res, 401, { error: 'Not signed in.' });
      return json(res, 200, { user, data: getData(user.id) });
    }

    if (req.method === 'POST' && req.url === '/api/local/logout') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      if (token) db.prepare('delete from sessions where token = ?').run(token);
      return json(res, 200, { ok: true });
    }

    const dataMatch = req.url.match(/^\/api\/local\/data\/([a-zA-Z0-9_-]+)$/);
    if (req.method === 'PUT' && dataMatch) {
      const user = authUser(req);
      if (!user) return json(res, 401, { error: 'Not signed in.' });
      const { value } = await readJson(req);
      saveData(user.id, dataMatch[1], value);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Not found.' });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/local/')) {
    handleApi(req, res);
    return;
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`ShiftTrack local server running at http://localhost:${port}`);
  console.log(`SQLite database: ${dbPath}`);
});
