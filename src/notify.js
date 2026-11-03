import { githubRequest } from './state.js';

const labels = {
  WAITING: 'Prenotazioni non ancora aperte / apertura futura annunciata',
    AVAILABLE: 'Ricerca esatta e calendario indicano posti disponibili: verifica e prenota sul sito',
  CALENDAR_AVAILABLE: 'Il calendario mostra abbastanza letti; acquisto ancora da verificare',
  FORM_READY: 'Modulo di ricerca attivo; disponibilità per le tue date non confermata',
  OPEN_ANNOUNCED: 'Il sito annuncia prenotazioni aperte; disponibilità non confermata',
  NO_AVAILABILITY: 'La ricerca esatta non restituisce posti (può essere troppo presto o esaurito)',
  REVIEW: 'Pagina non riconosciuta o nuovo sistema: serve controllo manuale',
  ERROR: 'Impossibile controllare il sito',
};

export function eventText(event, config) {
  const a = event.assessment;
  const time = (value) => new Date(value).toLocaleString('it-IT', {timeZone: 'Europe/Rome'});
  const run = process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
  return [
    event.title, `${config.guests} persone · ${config.checkIn} → ${config.checkOut}`,
    `${a.status}: ${labels[a.status]}`, `Rilevato: ${time(event.at)} (Europe/Rome)`,
    event.lastNegativeAt ? `Ultimo controllo negativo completo: ${time(event.lastNegativeAt)}. L'eventuale cambiamento è avvenuto nell'intervallo, non necessariamente ora.` : '',
    a.totalBeds !== null ? `Letti nel calendario: ${a.totalBeds}; ${config.guests} nella stessa camerata: ${a.sameDormPossible ? 'sì' : 'non rilevati'}.` : '',
    a.probe?.reason || '',
    ...a.announcements.slice(0, 6).map((v) => `Annuncio: ${v.text}`),
    ...a.countdowns.map((v) => `Countdown: ${v.label} · termine configurato ${v.endDate ? time(v.endDate) : 'sconosciuto'} (indizio, non garanzia)`),
    ...a.problems.map((p) => `Errore: ${p.url} — ${p.error.slice(0, 250)}`),
    'https://rifugionuvolau.it/modulo-di-prenotazione/',
    run ? `Screenshot, HTML e report: ${run}` : 'Screenshot, HTML e report nella cartella artifacts/.',
  ].filter(Boolean).join('\n');
}

export function configuredChannels() {
  const channels = [];
  if (Boolean(process.env.TELEGRAM_BOT_TOKEN) !== Boolean(process.env.TELEGRAM_CHAT_ID)) throw new Error('Servono entrambi TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID.');
  if (process.env.TELEGRAM_BOT_TOKEN) channels.push('telegram');
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY && process.env.GITHUB_ALERTS !== 'false') channels.push('github');
  return channels;
}

export async function deliver(channel, event, config) {
  const message = eventText(event, config);
  if (channel === 'telegram') {
    // Never log the endpoint: Telegram embeds the secret in its URL.
    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({chat_id: process.env.TELEGRAM_CHAT_ID, text: message.slice(0, 4000), link_preview_options: {is_disabled: true}}),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok || !(await response.json()).ok) throw new Error(`Invio Telegram fallito (HTTP ${response.status})`);
    return;
  }
  const base = `/repos/${process.env.GITHUB_REPOSITORY}`;
  const marker = `<!-- nuvolau-event:${event.id} -->`;
  // A unique issue per event survives state loss/transport uncertainty. Reads
  // make a retry idempotent when GitHub accepted a previous request.
  const issues = await githubRequest(`${base}/issues?state=all&per_page=100&sort=created&direction=desc`);
  if (issues.some((issue) => issue.body?.includes(marker))) return;
  await githubRequest(`${base}/issues`, {method: 'POST', body: {
    title: `[Nuvolau] ${event.assessment.status}: ${event.title}`,
    body: `${marker}\n\n${message}\n\nMonitor automatico: verifica sul sito prima di procedere.`,
  }});
}

export async function healthPing(success) {
  if (!process.env.HEALTHCHECKS_URL) return;
  const url = new URL(process.env.HEALTHCHECKS_URL);
  if (url.protocol !== 'https:') throw new Error('HEALTHCHECKS_URL deve usare HTTPS');
  if (!success) url.pathname = `${url.pathname.replace(/\/$/, '')}/fail`;
  const response = await fetch(url, {signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(`Heartbeat fallito: HTTP ${response.status}`);
}
