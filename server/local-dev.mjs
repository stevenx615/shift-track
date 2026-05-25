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

  create table if not exists app_data (
    user_id text not null references users(id) on delete cascade,
    key text not null,
    value text not null,
    updated_at text not null default current_timestamp,
    primary key (user_id, key)
  );
`);

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

function getData(userId) {
  const rows = db.prepare('select key, value from app_data where user_id = ?').all(userId);
  return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]));
}

function setData(userId, key, value) {
  db.prepare(`
    insert into app_data (user_id, key, value, updated_at)
    values (?, ?, ?, current_timestamp)
    on conflict(user_id, key) do update set value = excluded.value, updated_at = current_timestamp
  `).run(userId, key, JSON.stringify(value));
}

async function handleApi(req, res) {
  try {
    if (req.method === 'POST' && req.url === '/api/local/signup') {
      const { name, email, password, initialData } = await readJson(req);
      if (!name || !email || !password) return json(res, 400, { error: 'Name, email, and password are required.' });
      const { salt, hash } = hashPassword(password);
      const id = crypto.randomUUID();
      try {
        db.prepare('insert into users (id, email, name, password_hash, salt) values (?, ?, ?, ?, ?)').run(id, email.toLowerCase(), name, hash, salt);
      } catch {
        return json(res, 409, { error: 'An account with this email already exists.' });
      }
      Object.entries(initialData || {}).forEach(([key, value]) => setData(id, key, value));
      const token = createSession(id);
      return json(res, 200, { token, user: { id, email: email.toLowerCase(), name }, data: getData(id) });
    }

    if (req.method === 'POST' && req.url === '/api/local/login') {
      const { email, identifier, password } = await readJson(req);
      const account = String(identifier || email || '').toLowerCase();
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
      setData(user.id, dataMatch[1], value);
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
