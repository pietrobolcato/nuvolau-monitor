// This function runs inside a Playwright page/frame. Keep it self-contained.
export function extractPage() {
  const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    for (let node = el; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || node.hidden) return false;
    }
    return el.getClientRects().length > 0;
  };
  const root = document.querySelector('main, #content, .site-main, article') || document.body;
  const clone = root.cloneNode(true);
  clone.querySelectorAll('script, style, noscript, nav, footer, header, #sbi_images, .hurrytimer-timer, .vbo-availability-wrapper, table[data-ninja_table_instance], table.ninja_footable, table.ninja_table_pro, table.ninja_table, [role="navigation"]')
    .forEach((el) => el.remove());
  const text = clean(clone.textContent);
  const forms = [...document.forms].map((form) => ({
    action: form.action, method: form.method.toLowerCase(), visible: visible(form),
    fields: [...form.elements].map((el) => ({
      name: el.name || '', id: el.id || '', type: el.type || '',
      value: el.value || '', disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true',
      visible: visible(el), label: clean([...el.labels || []].map((label) => label.textContent).join(' ')),
      options: el.options ? [...el.options].map((o) => ({value: o.value, text: clean(o.textContent)})) : [],
    })),
    text: clean(form.innerText),
  }));
  const links = [...document.querySelectorAll('a[href]')].filter(visible)
    .map((el) => ({url: el.href, text: clean(el.innerText), disabled: el.getAttribute('aria-disabled') === 'true'}));
  const calendars = [...document.querySelectorAll('table[data-room-table]')].map((table) => ({
    roomId: table.dataset.roomTable,
    name: clean(table.closest('.vbo-availability-room-container')?.querySelector('h4')?.textContent),
    month: clean(table.querySelector('.vbo-availability-month-name')?.textContent),
    cells: [...table.querySelectorAll('[data-cell-date]')].map((cell) => {
      const raw = cell.querySelector('[data-units-left]')?.getAttribute('data-units-left');
      return {date: cell.dataset.cellDate, units: raw !== null && raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null};
    }),
  }));
  // Include dormant popup text and stable countdown end timestamps, never the
  // ticking digits. A scheduled popup can precede the opening of the engine.
  const countdowns = [...document.querySelectorAll('.hurrytimer-campaign[data-config]')].flatMap((el) => {
    try {
      const data = JSON.parse(el.dataset.config);
      return [{label: clean(el.querySelector('.hurrytimer-headline')?.textContent), endDate: data.endDate || null}];
    } catch { return []; }
  });
  const popups = [...document.querySelectorAll('.sgpb-main-html-content-wrapper, [role="dialog"]')].map((el) => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('script, style, .hurrytimer-timer').forEach((node) => node.remove());
    return clean(copy.textContent);
  });
  const images = [...root.querySelectorAll('img')].map((el) => ({
    src: el.getAttribute('data-src') || el.getAttribute('src') || '', alt: el.alt,
  })).filter((el) => /prenot|book|reserv|apertura|opening|2027/i.test(`${el.src} ${el.alt}`));
  return {
    url: location.href, title: document.title, text, visibleText: clean(document.body.innerText),
    forms, links, calendars, countdowns, popups, images,
    resultRooms: Number(document.querySelector('.vbo-results-numrooms .vbo-results-head-det-val')?.textContent) || null,
    iframes: [...document.querySelectorAll('iframe[src]')].filter(visible).map((el) => ({url: el.src, title: el.title})),
    // Restrict positive search evidence to actual result containers. Marketing
    // copy, navigation, calendar legends and embedded scripts cannot qualify.
    results: [...document.querySelectorAll('.vbo-results, .vbo-searchresults, .vbo-search-results, .vbsearchresults, .vbo-results-wrapper')]
      .filter(visible).map((el) => ({
        text: clean(el.innerText),
        priced: /(?:€|EUR)\s*\d|\d[\d.,]*\s*(?:€|EUR)/i.test(el.innerText),
        selectable: [...el.querySelectorAll('button, input[type="submit"], a')]
          .some((node) => visible(node) && !node.matches(':disabled') && /prenota|book|seleziona|select|scegli|choose|continua|continue/i.test(node.innerText || node.value)),
      })),
  };
}
