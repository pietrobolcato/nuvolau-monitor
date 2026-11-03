import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readConfig } from './config.js';
import { collect } from './browser.js';
import { assess } from './classify.js';
import { stateStore, planEvents, markDelivered, pruneDelivered } from './state.js';
import { configuredChannels, deliver, eventText, healthPing } from './notify.js';

const dry = process.argv.includes('--dry-run');
const remote = !dry && process.env.STATE_BACKEND === 'github';
const dir = join('artifacts', new Date().toISOString().replaceAll(':', '-'));

async function main() {
  const config = await readConfig(process.env.MONITOR_CONFIG || 'config.json');
  const channels = dry ? [] : configuredChannels();
  if (!dry && !channels.length) throw new Error('Nessun canale di notifica configurato: usa --dry-run oppure configura Telegram/GitHub.');
  if (remote && (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY)) throw new Error('Stato GitHub: token e repository mancanti.');
  if (Date.now() >= Date.parse(`${config.checkOut}T12:00:00+02:00`)) throw new Error('Soggiorno passato: aggiornare config.json o disattivare il monitor.');
  await mkdir(dir, {recursive: true});
  const storage = stateStore(config, remote);
  const previous = dry ? null : await storage.load();
  const {pages, probe} = await collect(config, dir);
  const assessment = assess(pages, probe, config);
  const state = planEvents(previous, assessment, config, Date.now());
  await writeFile(join(dir, 'report.json'), JSON.stringify(state, null, 2));
  const summary = eventText({title: 'Esito controllo Nuvolau', assessment, at: state.observedAt, lastNegativeAt: previous?.lastNegativeAt}, config);
  await writeFile(join(dir, 'report.txt'), summary);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `archive=${state.pending.length > 0 || assessment.problems.length > 0}\n`);
  if (dry) {
    if (assessment.problems.length || assessment.status === 'ERROR') process.exitCode = 1;
    return;
  }
  // Persist the outbox first. Failed notification deliveries are retried on the
  // next run, including failures after the observation has already changed.
  await storage.save(state);
  const failures = [];
  const hadPending = state.pending.length > 0;
  for (const event of state.pending) for (const channel of channels) {
    if (state.receipts[`${event.id}:${channel}`]) continue;
    try {
      await deliver(channel, event, config);
      markDelivered(state, event.id, channel);
      await storage.save(state);
    } catch (error) { failures.push(`${channel}: ${error.message}`); }
  }
  pruneDelivered(state, channels);
  if (hadPending) await storage.save(state);
  const healthy = !assessment.problems.length && assessment.status !== 'ERROR' && !failures.length;
  await healthPing(healthy);
  if (failures.length) throw new Error(failures.join('\n'));
  if (!healthy) throw new Error('Controllo incompleto: dettagli nel report; il workflow segnala il guasto.');
}

main().catch(async (error) => {
  console.error(error.message);
  if (!dry) {
    try { await healthPing(false); } catch { console.error('Invio heartbeat di errore fallito.'); }
  }
  process.exitCode = 1;
});
