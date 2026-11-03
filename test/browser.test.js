import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractPage } from '../src/extract.js';
import { assess, bookingForm, vikForm } from '../src/classify.js';
import { searchDates } from '../src/browser.js';
import { readConfig } from '../src/config.js';

let browser;
// Fixture dates must not depend on the traveller's editable production target.
const config = {...await readConfig(), checkIn: '2027-07-21', checkOut: '2027-07-22', guests: 2, sameDorm: false};
const directory = await mkdtemp(join(tmpdir(), 'nuvolau-tests-'));
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

test('estrazione da DOM: calendario esatto, hidden e disabled, popup e countdown', async () => {
  const p = await browser.newPage();
  await p.setContent(`
    <title>Rifugio Nuvolau</title><nav>PRENOTA ORA</nav><main>
    <p>Prenotazioni 2027: a partire da gennaio 2027 sul sito web</p>
    <form style="display:none"><input name="checkin"><input name="checkout"><button type="submit">Cerca</button></form>
    <form><fieldset disabled><input name="arrival"><input name="departure"><button type="submit">Cerca</button></fieldset></form>
    <div class="vbo-availability-room-container"><h4>Camera A</h4>
    <table data-room-table="4"><tr><td class="vbo-availability-month-name">Luglio 2027</td>
    <td data-cell-date="21/07/2027"><span data-units-left="1">1</span></td>
    <td data-cell-date="22/07/2027"><span data-units-left="3">3</span></td></tr></table></div>
    <div class="vbo-availability-room-container"><h4>Camera B</h4>
    <table data-room-table="5"><tr><td data-cell-date="21/07/2027"><span data-units-left="1">1</span></td></tr></table></div>
    <script>const fake = 'Prenotazioni aperte 20 posti';</script></main>
    <div style="opacity:0" class="sgpb-main-html-content-wrapper"><div class="hurrytimer-campaign"
    data-config='{"endDate":1798992000000}'><div class="hurrytimer-headline">Prenotazioni luglio dal 4 gennaio 2027</div>
    <div class="hurrytimer-timer">991 23 12</div></div></div>`);
  const result = await p.evaluate(extractPage);
  assert.equal(result.forms.filter(bookingForm).length, 0);
  assert.ok(!result.text.includes('fake'));
  assert.ok(!result.popups.join(' ').includes('991'));
  assert.equal(result.countdowns[0].endDate, 1798992000000);
  assert.equal(assess([result], null, config).totalBeds, 2);
  await p.close();
});

// A minimized version of the search form observed in Wayback, 2024-02-22.
// Uses real jQuery UI calendars; only the remote site responses are intercepted.
const html = `<title>Rifugio Nuvolau</title><main><p>Ricerca pernottamento Rifugio Nuvolau: scegli le date e i letti.</p>
<form action="https://rifugionuvolau.it/dormire/" method="post">
<input type="hidden" name="option" value="com_vikbooking"><input type="hidden" name="task" value="search">
<input name="checkindate" id="checkindate" readonly><input name="checkoutdate" id="checkoutdate" readonly>
<select name="roomsnum" onchange="updateAdults(this.value)"><option>1</option><option>2</option></select>
<div id="adults"><select name="adults[]"><option>1</option></select></div>
<button type="submit">Cerca</button></form></main>`;

async function searchFixture(body, disabled = false, target = config) {
  const p = await browser.newPage();
  const requests = [];
  await p.route('https://rifugionuvolau.it/**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') requests.push(new URLSearchParams(req.postData()));
    return route.fulfill({contentType: 'text/html; charset=utf-8', body: req.method() === 'POST'
      ? `<title>Rifugio Nuvolau</title><main><p>Risultati ricerca pernottamento Rifugio Nuvolau per le date scelte.</p>${body}</main>` : html});
  });
  await p.goto('https://rifugionuvolau.it/dormire/');
  await p.addScriptTag({content: await readFile('node_modules/jquery/dist/jquery.js', 'utf8')});
  await p.addScriptTag({content: await readFile('node_modules/jquery-ui-dist/jquery-ui.js', 'utf8')});
  await p.evaluate((disabled) => {
    window.updateAdults = (value) => { document.getElementById('adults').innerHTML = '<select name="adults[]"><option>1</option></select>'.repeat(Number(value)); };
    window.jQuery('#checkindate, #checkoutdate').datepicker({dateFormat: 'dd/mm/yy', minDate: new Date('2027-06-20T12:00:00'),
      maxDate: new Date('2027-09-20T12:00:00'), beforeShowDay: () => [!disabled, '']});
  }, disabled);
  assert.equal(vikForm((await p.evaluate(extractPage)).forms[0]), true);
  const result = await searchDates(p, {...target, settleMs: 1}, directory);
  await p.close();
  return {result, requests};
}

test('ricerca invia 2 letti con 1 adulto ciascuno e verifica risultati, senza prenotare', async () => {
  const {result, requests} = await searchFixture('<div class="vbo-results">2 letti — €80 <button>Seleziona</button></div>');
  assert.equal(result.status, 'available', JSON.stringify(result));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].get('checkindate'), '21/07/2027');
  assert.equal(requests[0].get('checkoutdate'), '22/07/2027');
  assert.deepEqual(requests[0].getAll('adults[]'), ['1', '1']);
  assert.equal(requests[0].get('task'), 'search');
});

test('giorno disabilitato non viene forzato o inviato al server', async () => {
  const {result, requests} = await searchFixture('Risultati', true);
  assert.equal(result.status, 'unverified');
  assert.match(result.reason, /disabilitato/);
  assert.equal(requests.length, 0);
});

test('cambio notte: invia 22-23 luglio senza riutilizzare il 21', async () => {
  const target = {...config, checkIn: '2027-07-22', checkOut: '2027-07-23'};
  const {result, requests} = await searchFixture('<div class="vbo-results">2 letti — €80 <button>Seleziona</button></div>', false, target);
  assert.equal(result.status, 'available');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].get('checkindate'), '22/07/2027');
  assert.equal(requests[0].get('checkoutdate'), '23/07/2027');
  assert.equal(requests[0].get('task'), 'search');
});

test('marketing con prezzo e pulsante non equivale a risultato della ricerca', async () => {
  const {result} = await searchFixture('<p>Prezzi da €80, 2 letti</p><a href="#">Prenota ora</a>');
  assert.equal(result.status, 'unverified');
});

test('risultato per un letto non viene presentato come disponibilità per due', async () => {
  const {result} = await searchFixture('<div class="vbo-results">1 letto — €80 <button>Seleziona</button></div>');
  assert.equal(result.status, 'unverified');
});

test('conteggio strutturato del template pubblico VikBooking', async () => {
  const {result} = await searchFixture('<div class="vbo-results-wrapper"><div class="vbo-results-numrooms"><span class="vbo-results-head-det-val">2</span></div> €80 <button>Seleziona</button></div>');
  assert.equal(result.status, 'available');
});

test('dodici letti non corrispondono al numero due nel testo', async () => {
  const {result} = await searchFixture('<div class="vbo-results">12 letti — €80 <button>Seleziona</button></div>');
  assert.equal(result.status, 'unverified');
});

test('tabella tariffaria asincrona non altera il contenuto monitorato', async () => {
  const p = await browser.newPage();
  await p.setContent('<main>Prenotazioni da gennaio 2027<table class="ninja_footable" data-ninja_table_instance="ninja_table_instance_0"><tbody></tbody></table></main>');
  const before = await p.evaluate(extractPage);
  await p.locator('tbody').evaluate((el) => { el.innerHTML = '<tr><td>Mezza pensione €73</td></tr>'; });
  const after = await p.evaluate(extractPage);
  assert.equal(before.text, after.text);
  await p.close();
});

test('messaggio negativo letto dopo ricerca esatta', async () => {
  const {result} = await searchFixture('<p>No room is available for booking for 1 Night, 2 Adults.</p>');
  assert.equal(result.status, 'no_availability');
});
