// Gemeinsame Hilfsfunktionen für Eltern- und Admin-Seite.

function storageGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* privater Modus o. ä. – dann eben ohne Merken */
  }
}

async function api(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('de-DE', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const STATUS_LABEL = {
  confirmed: 'Platz bestätigt',
  waitlist: 'Warteliste',
  home: 'bleibt zuhause',
};

// Lädt eine Datei (z. B. Excel) mit Zugangscode herunter.
async function downloadFile(url, headers, fallbackName) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Fehler ${res.status}`);
  }
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = m ? decodeURIComponent(m[1]) : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

const KIND_LABEL = { event: 'Anmeldung', helper: 'Helferliste' };

function listMeta(l) {
  return [l.date && formatDate(l.date), l.time, l.location].filter(Boolean).map(esc).join(' · ');
}
