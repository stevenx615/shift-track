const tokenKey = 'shifttrack.localToken';

async function request(path, options = {}) {
  const token = localStorage.getItem(tokenKey);
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? (() => {
    try {
      return JSON.parse(text);
    } catch {
      return { error: text.includes('<!doctype html>') ? 'Local API is not running. Start the app with npm.cmd run dev.' : 'Local request failed.' };
    }
  })() : {};
  if (!response.ok) throw new Error(data.error || 'Local request failed.');
  return data;
}

export function localToken() {
  return localStorage.getItem(tokenKey);
}

export async function localSignup(payload) {
  const data = await request('/api/local/signup', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  localStorage.setItem(tokenKey, data.token);
  return data;
}

export async function localLogin(payload) {
  const data = await request('/api/local/login', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  localStorage.setItem(tokenKey, data.token);
  return data;
}

export async function localMe() {
  return request('/api/local/me');
}

export async function localLogout() {
  await request('/api/local/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem(tokenKey);
}

export async function saveLocalData(key, value) {
  return request(`/api/local/data/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value })
  });
}
