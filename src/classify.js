import { createHash } from 'node:crypto';
import { italianDate } from './config.js';

export const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = (text) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const closedWords = /camere chiuse|rooms closed|prenotazioni.{0,45}(?:chiuse|non.{0,15}(?:aperte|disponibili))|(?:bookings?|reservations?).{0,45}(?:closed|not.{0,15}(?:open|available))|booking.{0,20}disabled/i;
const futureWords = /(?:prenotazion|reservations?|bookings?).{0,100}(?:a partire|dal\b|da gennaio|starting|from january|apriranno|will open)/i;
const openWords = /(?:prenotazioni|bookings?|reservations?).{0,25}(?:(?:sono|are|now)\s+)?(?:aperte|open)(?:\b|!)/i;
const dateField = /check.?in|check.?out|arrival|departure|arrivo|partenza|date|data/i;
const excludedLinks = /tariff|price|faq|termini|terms|privacy|cookie|legalblink|facebook|instagram|youtube|cdn-cgi/i;

export function bookingForm(form) {
  const fields = form.fields.filter((f) => f.visible && !f.disabled);
  const dates = fields.filter((f) => dateField.test(`${f.name} ${f.id} ${f.label}`));
  const submit = fields.some((f) => f.type === 'submit');
  return form.visible && dates.length >= 2 && submit;
}

export function vikForm(form) {
  return bookingForm(form) && form.fields.some((f) => f.name === 'option' && f.value === 'com_vikbooking') &&
    form.fields.some((f) => f.name === 'task' && f.value === 'search') &&
    ['checkindate', 'checkoutdate', 'roomsnum', 'adults[]'].every((name) => form.fields.some((f) => f.name === name));
}

export function relevantLink(link) {
  return !link.disabled && !excludedLinks.test(link.url) &&
    /prenot|book|reserv|disponibil|availability/i.test(`${link.text} ${link.url}`);
}

export function announcements(page) {
  const text = normalize(`${page.text} ${(page.popups || []).join(' ')}`);
  // Windows around booking-related date announcements preserve split <b>/<br>
  // wording while avoiding the ordinary booking conditions and menu labels.
  const fragments = [...text.matchAll(/(?:prenotazioni|reservations?|bookings?)[^.!?]{0,170}/g)]
    .map((m) => m[0].trim()).filter((s) => /20\d\d|gennaio|febbraio|january|february|aprir|starting/i.test(s));
  return [...new Set(fragments)].sort();
}

export function assess(pages, probe, config) {
  const good = pages.filter((p) => !p.error);
  const allText = normalize(good.map((p) => `${p.text} ${(p.popups || []).join(' ')}`).join('\n'));
  const forms = good.flatMap((p) => p.forms.filter(bookingForm).map((f) => ({url: p.url, form: f})));
  const announcementsFound = good.flatMap((p) => announcements(p).map((text) => ({url: p.url, text})));
  const countdowns = good.flatMap((p) => (p.countdowns || []).map((c) => ({url: p.url, ...c})));
  const closed = closedWords.test(allText);
  const future = futureWords.test(allText);
  const explicitOpen = openWords.test(allText) && !closed && !future;
  const rooms = new Map();
  for (const page of good) for (const room of page.calendars || []) {
    const cell = room.cells.find((cell) => cell.date === italianDate(config.checkIn));
    if (cell?.units !== null && cell?.units !== undefined) rooms.set(room.roomId, {roomId: room.roomId, name: room.name, units: cell.units});
  }
  const inventory = [...rooms.values()];
  const total = inventory.length ? inventory.reduce((sum, r) => sum + r.units, 0) : null;
  const together = inventory.some((r) => r.units >= config.guests);
  const enough = total !== null && (config.sameDorm ? together : total >= config.guests);
  const problems = pages.filter((p) => p.error).map((p) => ({url: p.url, error: p.error}));
  if (probe?.status === 'error') problems.push({url: probe.url, error: probe.reason});
  let status;
  // Result of an actual search has priority over a stale site-wide announcement.
  // Empty results only refer to these dates; they never prove a season sold out.
  if (probe?.status === 'available' && enough) status = 'AVAILABLE';
  else if (enough) status = 'CALENDAR_AVAILABLE';
  else if (probe?.status === 'no_availability') status = 'NO_AVAILABILITY';
  else if (probe?.status === 'available') status = 'FORM_READY';
  else if (forms.length) status = 'FORM_READY';
  else if (explicitOpen) status = 'OPEN_ANNOUNCED';
  else if (closed || future) status = 'WAITING';
  else status = 'REVIEW';
  if (!good.length) status = 'ERROR';
  const external = good.flatMap((p) => [...p.links.filter(relevantLink), ...(p.iframes || [])])
    .filter((link) => { try { return !config.allowedHosts.includes(new URL(link.url).hostname); } catch { return false; } });
  if (status === 'WAITING' && external.length) status = 'REVIEW';
  return {
    status, totalBeds: total, sameDormPossible: together, inventory, closed, future,
    forms: forms.map((f) => ({url: f.url, adapter: vikForm(f.form) ? 'vikbooking' : 'unknown'})),
    announcements: announcementsFound, countdowns, external, problems, probe,
    // No page-wide metadata, nonces, clocks, analytics or copyright years.
    fingerprint: hash(good.map((p) => ({
      url: p.url, text: p.text, popups: p.popups, countdowns: p.countdowns,
      links: [...new Set(p.links.filter(relevantLink).map((l) => l.url))].sort(),
      forms: p.forms.filter(bookingForm).map((f) => ({action: f.action, fields: f.fields.map((v) => ({name: v.name, type: v.type, disabled: v.disabled}))})),
      images: p.images, iframes: p.iframes,
    }))),
    announcementFingerprint: hash({announcementsFound, countdowns}),
  };
}

export function meaningfulChange(previous, current) {
  return previous.fingerprint !== current.fingerprint || previous.status !== current.status ||
    previous.totalBeds !== current.totalBeds || previous.sameDormPossible !== current.sameDormPossible;
}
