import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractPage } from './extract.js';
import { relevantLink, vikForm } from './classify.js';
import { italianDate } from './config.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const allowed = (url, config) => {
  try { const u = new URL(url); return u.protocol === 'https:' && config.allowedHosts.includes(u.hostname); }
  catch { return false; }
};
const pathKey = (url) => { const u = new URL(url); return `${u.origin}${u.pathname.replace(/\/$/, '')}`; };

async function capture(page, dir, name) {
  await writeFile(join(dir, `${name}.html`), await page.content());
  await writeFile(join(dir, `${name}.txt`), await page.locator('body').innerText());
  await page.screenshot({path: join(dir, `${name}.png`), fullPage: true, timeout: 15000});
}

async function settle(page, config) {
  await delay(config.settleMs);
  // The site's cookie banner documents that X rejects optional cookies.
  const cookieClose = page.locator('#cm_close_btn');
  if (await cookieClose.isVisible()) await cookieClose.click();
  // Elementor/ScrollReveal content and links can remain invisible until they
  // enter the viewport. Trigger bounded scrolling before extracting them.
  const height = await page.evaluate(() => document.body.scrollHeight);
  const steps = Math.min(8, Math.ceil(height / 900));
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * height / steps);
    await delay(100);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await delay(400);
}

function verifyPage(data, response) {
  if (response && !response.ok()) throw new Error(`HTTP ${response.status()}`);
  if (/just a moment|attention required|access denied|verify you are human|verifica.{0,15}uman/i.test(`${data.title} ${data.visibleText.slice(0,1200)}`)) {
    throw new Error('Pagina di blocco / CAPTCHA: serve verifica manuale');
  }
  if (!/nuvolau/i.test(`${data.title} ${data.text}`) || data.text.length < 80) throw new Error('Contenuto mancante o pagina inattesa');
}

async function load(page, url, config, dir, name) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await page.goto(url, {waitUntil: 'domcontentloaded'});
      await settle(page, config);
      if (!allowed(page.url(), config)) throw new Error('Redirect a un dominio nuovo: controllare manualmente');
      const data = await page.evaluate(extractPage);
      verifyPage(data, response);
      await capture(page, dir, name);
      return data;
    } catch (error) {
      last = error;
      if (!attempt) await delay(1500);
    }
  }
  try { await capture(page, dir, `${name}-error`); } catch { /* Navigation can fail before a document exists. */ }
  return {url, error: last.message};
}

async function selectTargetMonth(page, data, config, dir, name) {
  const calendar = data.forms.find((form) => form.fields.some((field) => field.name === 'month'));
  if (!calendar || !data.calendars.length) return data;
  const month = config.checkIn.slice(0, 7);
  const monthNames = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const englishMonths = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const index = Number(config.checkIn.slice(5, 7)) - 1;
  const option = calendar.fields.find((field) => field.name === 'month').options.find((o) => {
    if (o.text.includes(config.checkIn.slice(0, 4)) && [monthNames[index], englishMonths[index]].some((name) => o.text.toLowerCase().includes(name))) return true;
    const stamp = Number(o.value);
    return stamp > 0 && new Date(stamp * 1000).toISOString().slice(0, 7) === month;
  });
  if (!option) return {...data, calendarWarning: 'Mese richiesto non presente nel calendario'};
  // Use the site's month selector, including its POST and hidden room IDs.
  // This only changes the public availability view.
  const [response] = await Promise.all([
    page.waitForNavigation({waitUntil: 'domcontentloaded'}),
    page.locator('select[name="month"]').first().selectOption(option.value),
  ]);
  await settle(page, config);
  const result = await page.evaluate(extractPage);
  verifyPage(result, response);
  if (!result.calendars.some((c) => c.cells.some((cell) => cell.date === italianDate(config.checkIn)))) {
    throw new Error('Il calendario non ha restituito il mese richiesto');
  }
  await capture(page, dir, name);
  return result;
}

export async function searchDates(page, config, dir) {
  // Mutate only the recognized VikBooking SEARCH form. No personal details,
  // room selection, reservation submission, deposit or payment is attempted.
  const prepared = await page.evaluate(({checkIn, checkOut, guests}) => {
    const form = [...document.forms].find((f) => f.querySelector('[name="option"]')?.value === 'com_vikbooking' &&
      f.querySelector('[name="task"]')?.value === 'search' && f.querySelector('[name="checkindate"]'));
    if (!form) return {ok: false, reason: 'Modulo VikBooking cambiato'};
    const dates = [['checkindate', checkIn], ['checkoutdate', checkOut]];
    const jq = window.jQuery;
    // Read calendar constraints before setting dates; do not force a disabled
    // day or turn off min/max constraints to manufacture an availability hit.
    for (const [name, iso] of dates) {
      const input = form.querySelector(`[name="${name}"]`);
      const date = new Date(`${iso}T12:00:00`);
      if (!jq?.datepicker || !jq(input).hasClass('hasDatepicker')) return {ok: false, reason: 'Calendario sconosciuto: controllo manuale'};
      const inst = jq.datepicker._getInst(input);
      for (const type of ['min', 'max']) {
        const bound = jq.datepicker._getMinMaxDate(inst, type);
        if (bound) {
          bound.setHours(12, 0, 0, 0);
          if ((type === 'min' && date < bound) || (type === 'max' && date > bound)) return {ok: false, reason: `${name}: data fuori intervallo prenotabile`};
        }
      }
      const before = jq(input).datepicker('option', 'beforeShowDay');
      if (before && before(date)[0] === false) return {ok: false, reason: `${name}: giorno disabilitato`};
      jq(input).datepicker('setDate', date);
      if (typeof window.vbSetGlobalMinCheckoutDate === 'function' && name === 'checkindate') window.vbSetGlobalMinCheckoutDate();
    }
    const rooms = form.querySelector('[name="roomsnum"]');
    if (![...rooms.options].some((o) => Number(o.value) === guests)) return {ok: false, reason: 'Numero di letti non selezionabile'};
    rooms.value = String(guests);
    rooms.dispatchEvent(new Event('change', {bubbles: true}));
    const adults = [...form.querySelectorAll('[name="adults[]"]')];
    if (adults.length !== guests) return {ok: false, reason: 'La selezione letti/ospiti ha cambiato struttura'};
    for (const adult of adults) {
      adult.value = '1';
      adult.dispatchEvent(new Event('change', {bubbles: true}));
    }
    for (const child of form.querySelectorAll('[name="children[]"]')) child.value = '0';
    const entries = [...new FormData(form).entries()];
    form.dataset.nuvolauSearch = 'true';
    return {ok: true, entries};
  }, config);
  if (!prepared.ok) return {status: 'unverified', reason: prepared.reason, url: page.url()};
  const sent = [];
  const listener = (request) => {
    if (request.isNavigationRequest()) sent.push({url: request.url(), body: request.postData()});
  };
  page.on('request', listener);
  try {
    const [response] = await Promise.all([
      page.waitForNavigation({waitUntil: 'domcontentloaded'}),
      page.locator('form[data-nuvolau-search] [type="submit"]').first().click(),
    ]);
    await settle(page, config);
    const result = await page.evaluate(extractPage);
    verifyPage(result, response);
    await capture(page, dir, 'search-result');
    const matching = sent.some((request) => {
      const params = request.body ? new URLSearchParams(request.body) : new URL(request.url).searchParams;
      return params.get('task') === 'search' && params.get('checkindate') === italianDate(config.checkIn) &&
        params.get('checkoutdate') === italianDate(config.checkOut) && Number(params.get('roomsnum')) === config.guests &&
        params.getAll('adults[]').length === config.guests && params.getAll('adults[]').every((v) => v === '1');
    });
    if (!matching) return {status: 'unverified', reason: 'Richiesta inviata non verificabile per date e ospiti esatti', url: page.url()};
    const noRooms = /nessun[ao]?\s+(?:camera|letto|stanza)|(?:non (?:ci )?sono|non abbiamo).{0,35}(?:letti|camere).{0,25}disponib|no (?:room|bed)s? (?:is |are )?available/i.test(result.visibleText);
    const offer = result.results.some((r) => r.priced && r.selectable);
    // The classic multi-room UI may show partial combinations. Without an
    // explicit results heading for the requested beds, keep the result at
    // FORM_READY and let calendar inventory provide the early warning.
    const exactParty = result.resultRooms === config.guests || new RegExp(`(?:\\b${config.guests}\\s*(?:letti|beds|camere|rooms)\\b|(?:letti|beds|camere|rooms)\\s*:?\\s*${config.guests}\\b)`, 'i')
      .test(result.results.map((r) => r.text).join(' '));
    return {
      status: offer && exactParty && !noRooms ? 'available' : noRooms ? 'no_availability' : 'unverified',
      reason: offer && exactParty && !noRooms ? 'Ricerca esatta: risultati con prezzo e selezione per i letti richiesti' : noRooms ? 'Nessun posto per questa ricerca; non prova che la stagione sia aperta o esaurita' : 'Risposta non riconosciuta o numero letti non confermato: vedere screenshot',
      url: page.url(), request: prepared.entries,
    };
  } finally { page.off('request', listener); }
}

export async function collect(config, dir) {
  await mkdir(dir, {recursive: true});
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext({locale: 'it-IT', timezoneId: 'Europe/Rome', viewport: {width: 1440, height: 1000}});
  context.setDefaultTimeout(config.timeoutMs);
  context.setDefaultNavigationTimeout(config.timeoutMs);
  // Bound document navigation to explicitly configured domains. New booking
  // providers still appear as links/iframes and trigger a review alert.
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (request.isNavigationRequest() && !allowed(request.url(), config)) return route.abort();
    if (request.resourceType() === 'media') return route.abort();
    return route.continue();
  });
  const pages = [];
  const queue = [...config.urls];
  const visited = new Set();
  let discovered = 0;
  let probe = null;
  try {
    for (let i = 0; i < queue.length; i++) {
      const url = queue[i];
      if (visited.has(pathKey(url))) continue;
      visited.add(pathKey(url));
      console.log(`Controllo ${url}`);
      const page = await context.newPage();
      try {
        let data = await load(page, url, config, dir, `page-${i}`);
        if (!data.error) {
          try { data = await selectTargetMonth(page, data, config, dir, `page-${i}`); }
          catch (error) { data.calendarWarning = error.message; pages.push({url: `${url}#calendar`, error: error.message}); }
          if (data.calendarWarning && !pages.some((p) => p.url === `${url}#calendar`)) pages.push({url: `${url}#calendar`, error: data.calendarWarning});
          for (const link of data.links.filter(relevantLink)) {
            if (discovered >= config.maxDiscoveredPages || !allowed(link.url, config)) continue;
            const candidate = new URL(link.url);
            // Discover actual new pages only, not arbitrary plugin tasks or
            // thousands of calendar/search query combinations.
            if (candidate.search || visited.has(pathKey(candidate)) || queue.some((q) => pathKey(q) === pathKey(candidate))) continue;
            candidate.hash = '';
            queue.push(candidate.href); discovered++;
          }
          for (const frame of page.frames().filter((f) => f !== page.mainFrame() && allowed(f.url(), config))) {
            try { const embedded = await frame.evaluate(extractPage); if (embedded.text.length > 80) pages.push(embedded); }
            catch (error) { pages.push({url: frame.url(), error: `Iframe: ${error.message}`}); }
          }
          if (!probe && data.forms.some(vikForm)) {
            try { probe = await searchDates(page, config, dir); }
            catch (error) { probe = {status: 'error', url, reason: error.message}; }
          }
        }
        pages.push(data);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
  await writeFile(join(dir, 'observations.json'), JSON.stringify({pages, probe}, null, 2));
  return {pages, probe};
}
