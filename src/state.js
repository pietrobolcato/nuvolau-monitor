import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hash, meaningfulChange } from './classify.js';
import { targetKey } from './config.js';

export async function githubRequest(path, {method = 'GET', body, allow404 = false} = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub API: HTTP ${response.status} (${method} ${path.split('?')[0]})`);
  return response.status === 204 ? null : response.json();
}

export function stateStore(config, remote = false) {
  const localPath = '.state/state.json';
  let sha;
  return {
    async load() {
      if (!remote) {
        try { return JSON.parse(await readFile(localPath, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      }
      const data = await githubRequest(`/repos/${process.env.GITHUB_REPOSITORY}/contents/state.json?ref=${config.stateBranch}`, {allow404: true});
      if (!data) return null;
      sha = data.sha;
      return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
    },
    async save(state) {
      if (!remote) {
        await mkdir(dirname(localPath), {recursive: true});
        await writeFile(`${localPath}.tmp`, JSON.stringify(state, null, 2));
        await rename(`${localPath}.tmp`, localPath);
        return;
      }
      const base = `/repos/${process.env.GITHUB_REPOSITORY}`;
      const branch = await githubRequest(`${base}/git/ref/heads/${config.stateBranch}`, {allow404: true});
      if (!branch) {
        const repo = await githubRequest(base);
        const head = await githubRequest(`${base}/git/ref/heads/${repo.default_branch}`);
        await githubRequest(`${base}/git/refs`, {method: 'POST', body: {ref: `refs/heads/${config.stateBranch}`, sha: head.object.sha}});
      }
      const result = await githubRequest(`${base}/contents/state.json`, {method: 'PUT', body: {
        message: `Monitor Nuvolau: ${state.observedAt}`, branch: config.stateBranch,
        content: Buffer.from(JSON.stringify(state, null, 2)).toString('base64'), ...(sha ? {sha} : {}),
      }});
      sha = result.content.sha;
    },
  };
}

export const urgentStates = new Set(['AVAILABLE', 'CALENDAR_AVAILABLE', 'FORM_READY', 'OPEN_ANNOUNCED', 'REVIEW']);

export function planEvents(previous, assessment, config, now) {
  const sameTarget = previous?.target === targetKey(config);
  const old = sameTarget ? previous : null;
  const state = {
    version: 1, target: targetKey(config), observedAt: now, assessment,
    failures: assessment.problems.length || assessment.status === 'ERROR' ? (old?.failures || 0) + 1 : 0,
    lastHealthyAt: old?.lastHealthyAt || null,
    lastNegativeAt: old?.lastNegativeAt || null,
    lastUrgentAt: old?.lastUrgentAt || null,
    // Pending deliveries survive failed transports and process restarts.
    pending: old?.pending || [], receipts: old?.receipts || {},
  };
  const events = [];
  const add = (kind, title) => events.push({
    id: hash({kind, now, target: state.target, status: assessment.status, fingerprint: assessment.fingerprint}),
    kind, title, at: now, assessment, lastNegativeAt: old?.lastNegativeAt || null,
  });
  if (!old) add('baseline', 'Monitor attivo: primo controllo');
  else {
    if (old.assessment.status !== assessment.status) add('status', 'Stato prenotazioni cambiato');
    else if (!assessment.problems.length && !old.assessment.problems.length && meaningfulChange(old.assessment, assessment)) {
      add('change', old.assessment.announcementFingerprint !== assessment.announcementFingerprint ? 'Nuovo annuncio / calendario di apertura' : 'Pagina o disponibilità cambiata: controllare');
    }
    if (state.failures >= config.failureAlertAfter && old.failures < config.failureAlertAfter) add('failure', 'Monitor degradato: verificare gli errori');
    if (!state.failures && old.failures) add('recovery', 'Monitor tornato operativo');
  }
  if (!events.length && (urgentStates.has(assessment.status) || state.failures >= config.failureAlertAfter) &&
      now - (old?.lastUrgentAt || 0) >= config.reminderHours * 3600000) add('reminder', 'Promemoria Nuvolau: serve attenzione');
  if (!state.failures) state.lastHealthyAt = now;
  // This bounds when the *observed condition* appeared, never the exact server
  // opening time. Missing/error runs must not advance the negative timestamp.
  if (!state.failures && ['WAITING', 'NO_AVAILABILITY'].includes(assessment.status)) state.lastNegativeAt = now;
  if (events.length) state.lastUrgentAt = now;
  state.pending = [...state.pending, ...events];
  if (state.pending.length > 100) throw new Error('Troppe notifiche non consegnate: riparare il canale prima di continuare.');
  return state;
}

export function markDelivered(state, eventId, channel) {
  state.receipts[`${eventId}:${channel}`] = true;
}

export function pruneDelivered(state, channels) {
  if (!channels.length) return;
  state.pending = state.pending.filter((e) => !channels.every((c) => state.receipts[`${e.id}:${c}`]));
  const pendingIds = new Set(state.pending.map((e) => e.id));
  state.receipts = Object.fromEntries(Object.entries(state.receipts).filter(([key]) => pendingIds.has(key.split(':')[0])));
}
