import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, bookingForm, announcements } from '../src/classify.js';
import { readConfig } from '../src/config.js';
import { planEvents, markDelivered, pruneDelivered } from '../src/state.js';

const config = {...await readConfig(), checkIn: '2027-07-21', checkOut: '2027-07-22', guests: 2, sameDorm: false};
const page = (extra = {}) => ({url: config.urls[0], text: 'Rifugio Nuvolau', forms: [], links: [], calendars: [], popups: [], countdowns: [], ...extra});
const form = (extra = {}) => ({visible: true, fields: [
  {name: 'checkindate', type: 'text', visible: true, disabled: false},
  {name: 'checkoutdate', type: 'text', visible: true, disabled: false},
  {name: 'search', type: 'submit', visible: true, disabled: false},
], ...extra});
const calendar = (units, date = '21/07/2027') => units.map((n, i) => ({roomId: String(i), name: `Dorm ${i}`, cells: [{date, units: n}]}));
const classify = (p, probe = null, conf = config) => assess([page(p)], probe, conf);
const waiting = () => classify({text: 'Prenotazioni 2027: a partire da gennaio 2027 sul sito web. Prenota ora!'});

test('annuncio corrente e CTA esistente non significano apertura', () => {
  assert.equal(waiting().status, 'WAITING');
});
test('chiusura camere ha priorità sulle legende disponibile', () => {
  assert.equal(classify({text: 'Camere chiuse, ci rivediamo a giugno 2027! Disponibile Prenota ora'}).status, 'WAITING');
});
test('un numero zero prima dell’apertura non significa sold out', () => {
  assert.equal(classify({text: 'Prenotazioni da gennaio 2027', calendars: calendar([0, 0])}).status, 'WAITING');
});
test('non usa celle del giorno o anno sbagliato', () => {
  assert.equal(classify({calendars: calendar([8], '21/07/2026')}).totalBeds, null);
});
test('posti in calendario non provano che si possa acquistare', () => {
  assert.equal(classify({text: 'Camere chiuse', calendars: calendar([2])}).status, 'CALENDAR_AVAILABLE');
});
test('due posti divisi sono segnalati senza promettere stessa camerata', () => {
  const a = classify({calendars: calendar([1, 1])});
  assert.equal(a.status, 'CALENDAR_AVAILABLE');
  assert.equal(a.sameDormPossible, false);
});
test('vincolo stessa camerata non somma camere differenti', () => {
  const a = classify({calendars: calendar([1, 1])}, null, {...config, sameDorm: true});
  assert.notEqual(a.status, 'CALENDAR_AVAILABLE');
});
test('una sola disponibilità non basta per due persone', () => {
  assert.notEqual(classify({calendars: calendar([1, 0])}).status, 'CALENDAR_AVAILABLE');
});
test('nessuna doppia somma per calendario ripetuto su più pagine', () => {
  const p = page({calendars: calendar([1])});
  assert.equal(assess([p, {...p, url: config.urls[2]}], null, config).totalBeds, 1);
});
test('moduli disabilitati, nascosti e newsletter non sono aperture', () => {
  assert.equal(bookingForm(form({visible: false})), false);
  const disabled = form(); disabled.fields[0].disabled = true;
  assert.equal(bookingForm(disabled), false);
  assert.equal(bookingForm(form({fields: [{name: 'email', type: 'email', visible: true}]})), false);
});
test('modulo nuovo dà un allarme anticipato ma non disponibilità', () => {
  assert.equal(classify({forms: [form()]}).status, 'FORM_READY');
});
test('risultati per la ricerca esatta superano un vecchio banner', () => {
  assert.equal(classify({text: 'Camere chiuse', calendars: calendar([2])}, {status: 'available'}).status, 'AVAILABLE');
});
test('risultati senza inventario coerente non confermano due letti', () => {
  assert.equal(classify({calendars: calendar([1])}, {status: 'available'}).status, 'FORM_READY');
});
test('nessun risultato resta distinto da prenotazioni chiuse', () => {
  assert.equal(classify({}, {status: 'no_availability'}).status, 'NO_AVAILABILITY');
});
test('nuovo provider richiede revisione, anche se vecchio testo resta', () => {
  const a = classify({text: 'Prenotazioni da gennaio 2027', links: [{text: 'Prenota', url: 'https://new-provider.example/nuvolau'}]});
  assert.equal(a.status, 'REVIEW');
});
test('popup nascosto preserva date di apertura a scaglioni', () => {
  const p = page({popups: ['Prenotazioni giugno dal 1 febbraio 2026. Prenotazioni luglio dal 3 febbraio 2026.']});
  assert.equal(announcements(p).length, 2);
});
test('fallimento di tutte le pagine non è una chiusura', () => {
  assert.equal(assess([{url: config.urls[0], error: 'HTTP 503'}], null, config).status, 'ERROR');
});
test('primo run invia baseline anche con risultato già positivo', () => {
  const state = planEvents(null, classify({calendars: calendar([2])}), config, 1000);
  assert.equal(state.pending.length, 1);
  assert.equal(state.pending[0].assessment.status, 'CALENDAR_AVAILABLE');
});
test('esiti invariati non generano notifiche ripetute', () => {
  const old = planEvents(null, waiting(), config, 1000); old.pending = [];
  assert.equal(planEvents(old, waiting(), config, 2000).pending.length, 0);
});
test('cambio della data annunciata avvisa pur restando WAITING', () => {
  const old = planEvents(null, waiting(), config, 1000); old.pending = [];
  const a = classify({text: 'Prenotazioni 2027: a partire dal 3 gennaio 2027'});
  assert.equal(planEvents(old, a, config, 2000).pending[0].kind, 'change');
});
test('un guasto parziale non avanza il controllo negativo', () => {
  const old = planEvents(null, waiting(), config, 1000); old.pending = [];
  const a = {...waiting(), problems: [{url: config.urls[1], error: 'HTTP 503'}]};
  const state = planEvents(old, a, config, 2000);
  assert.equal(state.lastNegativeAt, 1000);
  assert.equal(state.failures, 1);
  assert.equal(planEvents(state, a, config, 3000).pending[0].kind, 'failure');
});
test('outbox non consegnata sopravvive a controllo successivo invariato', () => {
  const old = planEvents(null, waiting(), config, 1000);
  const state = planEvents(old, waiting(), config, 2000);
  assert.equal(state.pending[0].id, old.pending[0].id);
});
test('successo di un canale non scarta gli altri destinatari', () => {
  const state = planEvents(null, waiting(), config, 1000);
  const id = state.pending[0].id;
  markDelivered(state, id, 'github');
  pruneDelivered(state, ['github', 'telegram']);
  assert.equal(state.pending.length, 1);
  markDelivered(state, id, 'telegram');
  pruneDelivered(state, ['github', 'telegram']);
  assert.equal(state.pending.length, 0);
});
test('promemoria dopo sei ore, senza bloccare riaperture future', () => {
  const a = classify({calendars: calendar([2])});
  const old = planEvents(null, a, config, 1000); old.pending = [];
  assert.equal(planEvents(old, a, config, 1000 + 6 * 3600000).pending[0].kind, 'reminder');
});
