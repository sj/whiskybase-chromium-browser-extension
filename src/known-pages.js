/*
 * Page addresses of bottles matched before, as keys: the background stores the
 * match under the page's key (and its canonical address's), and looks up the
 * links on a list of bottles by theirs (see content.js). Nothing here talks to Whiskybase.
 *
 * No dependencies and no DOM, so the same file runs in the background service
 * worker (importScripts) and Node tests.
 */
(function (root) {
  'use strict';

  // Query parameters that only say where a click came from, not which page it is.
  const TRACKING_PARAM = /^(?:utm_\w+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl|srsltid)$/i;

  /**
   * The same key for the addresses of one page: without the scheme, "www.",
   * a trailing slash, the #fragment and tracking parameters, and with the other
   * parameters sorted. Null for anything but a web page.
   */
  function key(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const port = u.port ? `:${u.port}` : '';
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const params = [...u.searchParams].filter(([k]) => !TRACKING_PARAM.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const query = params.length ? `?${new URLSearchParams(params)}` : '';
    return `${host}${port}${path}${query}`;
  }

  // A match is also stored under the address the page gives as its canonical
  // one, marked with this: a list may link there instead of to the page itself
  // (an auction's list linking each photo to the bottle rather than the lot).
  const CANONICAL = '#canonical';

  /**
   * The keys to try for a link on a list, best first: the page it links to;
   * a page that named it as canonical; and, for a link with a query, a page
   * that named the address without the query as canonical (the same bottle
   * in another lot, say). Empty for anything but a web page.
   */
  function linkKeys(url) {
    const k = key(url);
    if (!k) return [];
    const keys = [k, k + CANONICAL];
    const q = k.indexOf('?');
    if (q > 0) keys.push(k.slice(0, q) + CANONICAL);
    return keys;
  }

  const api = { key, linkKeys, CANONICAL };
  root.KnownPages = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
