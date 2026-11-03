// Local setup diagnostics only: no website visits, messages or remote writes.
import { access } from 'node:fs/promises';
import { chromium } from 'playwright';
import { readConfig } from './config.js';
import { configuredChannels } from './notify.js';

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22+ required.');
  const config = await readConfig(process.env.MONITOR_CONFIG || 'config.json');
  console.log(`Target: ${config.checkIn} -> ${config.checkOut}, ${config.guests} guests`);
  console.log(`Same dorm required: ${config.sameDorm ? 'yes' : 'no (separate dorms allowed)'}`);
  try { await access(chromium.executablePath()); }
  catch { throw new Error('Chromium missing: run npm run install-browser'); }
  console.log('Node and Chromium installation: OK');
  const channels = configuredChannels();
  console.log(`Configured notification channels: ${channels.join(', ') || 'NONE'}`);
  console.log(`External heartbeat configured: ${process.env.HEALTHCHECKS_URL ? 'yes' : 'no'}`);
  console.log(`State backend: ${process.env.STATE_BACKEND === 'github' ? 'GitHub' : 'local'}`);
  if (process.env.STATE_BACKEND === 'github' && (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY)) {
    throw new Error('GitHub state backend requires GITHUB_TOKEN and GITHUB_REPOSITORY.');
  }
  if (!channels.length) console.log('NOT ACTIVATED: configure and test a notification channel before enabling a schedule.');
  console.log('This command does not start a scheduler or verify delivery. No credentials printed.');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
