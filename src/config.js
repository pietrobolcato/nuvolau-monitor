import { readFile } from 'node:fs/promises';

export async function readConfig(path = 'config.json') {
  const config = JSON.parse(await readFile(path, 'utf8'));
  for (const key of ['checkIn', 'checkOut']) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(config[key]) ||
        new Date(`${config[key]}T00:00:00Z`).toISOString().slice(0, 10) !== config[key]) {
      throw new Error(`Data non valida: ${key}`);
    }
  }
  const nights = (Date.parse(config.checkOut) - Date.parse(config.checkIn)) / 86400000;
  // The availability adapter deliberately covers one night; it must not sum
  // beds across dates or assume that the same bed is free for several nights.
  if (nights !== 1) throw new Error('Questo monitor verifica una notte: checkOut deve essere il giorno successivo.');
  if (!Number.isInteger(config.guests) || config.guests < 1 || config.guests > 8) throw new Error('Ospiti: da 1 a 8.');
  if (typeof config.sameDorm !== 'boolean') throw new Error('sameDorm deve essere booleano.');
  for (const key of ['timeoutMs', 'settleMs', 'failureAlertAfter', 'reminderHours', 'maxDiscoveredPages']) {
    if (!Number.isInteger(config[key]) || config[key] < 1) throw new Error(`Configurazione non valida: ${key}`);
  }
  for (const url of config.urls) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !config.allowedHosts.includes(parsed.hostname)) {
      throw new Error(`URL non autorizzato: ${url}`);
    }
  }
  return config;
}

export function italianDate(iso) { return iso.split('-').reverse().join('/'); }

export function targetKey(config) {
  return `${config.checkIn}/${config.checkOut}/${config.guests}/${config.sameDorm}`;
}
