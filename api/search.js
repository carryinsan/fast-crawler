'use strict';

// OmniSearch: zero-key multi-engine search aggregator for Vercel Node.js.
const ENGINE_LIMIT_MS = 3200;
const MAX_QUERY = 300;
const DEFAULT_MAX = 100;
const HARD_MAX = 200;
const PER_ENGINE = 22;

const BAD_URL = [
  /\/login(?:[/?#]|$)/i,
  /\/signin(?:[/?#]|$)/i,
  /\/sign-in(?:[/?#]|$)/i,
  /\/signup(?:[/?#]|$)/i,
  /\/sign-up(?:[/?#]|$)/i,
  /\/register(?:[/?#]|$)/i,
  /\/create-account(?:[/?#]|$)/i,
  /\/account(?:[/?#]|$)/i,
  /\/auth(?:[/?#]|$)/i,
  /\/oauth(?:[/?#]|$)/i,
  /\/checkout(?:[/?#]|$)/i,
  /\/subscription(?:[/?#]|$)/i,
  /\/paywall(?:[/?#]|$)/i,
  /\/subscribe(?:[/?#]|$)/i,
  /\/captcha(?:[/?#]|$)/i,
  /\/consent(?:[/?#]|$)/i,
  /\/redirect(?:[/?#]|$)/i,
  /\/verify(?:[/?#]|$)/i,
  /\/tools\/feedback(?:[/?#]|$)/i,
  /\/feedback(?:[/?#]|$)/i,
  /\/preferences(?:[/?#]|$)/i,
  /\/advanced_search(?:[/?#]|$)/i,
  /\/websearch\/answer(?:[/?#]|$)/i,
  /\/support\/answer(?:[/?#]|$)/i
];

const BAD_HOST = [
  /(^|\.)accounts\.google\./i,
  /(^|\.)support\.google\./i,
  /(^|\.)policies\.google\./i,
  /(^|\.)news\.google\./i,
  /(^|\.)login\.microsoftonline\./i,
  /(^|\.)consent\./i,
  /(^|\.)feedback\./i
];

const STOP = new Set(
  'a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not of on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves'.split(' ')
);

const ENGINES = [
  {
    id: 'google',
    label: 'Google',
    kind: 'web',
    baseWeight: 1.18,
    url: q => `https://www.google.com/search?hl=en&num=${PER_ENGINE}&q=${encodeURIComponent(q)}`,
    referer: 'https://www.google.com/',
    parse: parseGoogle
  },
  {
    id: 'google-news',
    label: 'Google News',
    kind: 'news',
    baseWeight: 1.16,
    url: q => `https://www.google.com/search?hl=en&tbm=nws&num=${PER_ENGINE}&q=${encodeURIComponent(q)}`,
    referer: 'https://www.google.com/',
    parse: parseGoogle
  },
  {
    id: 'bing',
    label: 'Bing',
    kind: 'web',
    baseWeight: 1.13,
    url: q => `https://www.bing.com/search?setlang=en-US&count=${PER_ENGINE}&q=${encodeURIComponent(q)}`,
    referer: 'https://www.bing.com/',
    parse: parseBing
  },
  {
    id: 'bing-rss',
    label: 'Bing RSS',
    kind: 'news',
    baseWeight: 1.04,
    url: q => `https://www.bing.com/search?format=rss&count=${PER_ENGINE}&q=${encodeURIComponent(q)}`,
    referer: 'https://www.bing.com/',
    parse: parseBingRss
  },
  {
    id: 'brave',
    label: 'Brave',
    kind: 'web',
    baseWeight: 1.11,
    url: q => `https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`,
    referer: 'https://search.brave.com/',
    parse: parseBrave
  },
  {
    id: 'duck',
    label: 'Duck (Lite)',
    kind: 'web',
    baseWeight: 0.96,
    url: q => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
    referer: 'https://lite.duckduckgo.com/',
    parse: parseDuckLite
  },
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    kind: 'web',
    baseWeight: 1.04,
    url: q => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    referer: 'https://duckduckgo.com/',
    parse: parseDuckHtml
  },
  {
    id: 'mojeek',
    label: 'Mojeek',
    kind: 'web',
    baseWeight: 1.00,
    url: q => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}&clufmt=0`,
    referer: 'https://www.mojeek.com/',
    parse: parseMojeek
  },
  {
    id: 'youtube',
    label: 'YouTube',
    kind: 'video',
    baseWeight: 1.06,
    url: q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
    referer: 'https://www.youtube.com/',
    parse: parseYoutube
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    kind: 'web',
    baseWeight: 0.99,
    url: q => `https://search.yahoo.com/search?p=${encodeURIComponent(q)}&ei=UTF-8&nojs=1`,
    referer: 'https://search.yahoo.com/',
    parse: parseYahoo
  }
];

const now = () => Date.now();
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function stripTags(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '');
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .trim();
}

function textClean(s, max = 420) {
  const t = decodeEntities(stripTags(s));
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '...' : t;
}

function normalizeUrl(raw, base) {
  if (!raw) return null;
  let href = decodeEntities(raw.trim());
  if (!href || href.startsWith('#') || /^javascript:|^mailto:/i.test(href)) return null;

  try {
    const u = new URL(href, base);
    const p = u.searchParams;

    // 1. Bing /ck/a redirection unwrapping:
    if (u.hostname.includes('bing.com') && u.pathname.includes('/ck/a')) {
      let rawU = p.get('u');
      if (rawU) {
        try {
          rawU = rawU.replace(/^a[0-9]/, '');
          let b64 = rawU.replace(/-/g, '+').replace(/_/g, '/');
          while (b64.length % 4) b64 += '=';
          const decoded = Buffer.from(b64, 'base64').toString('utf-8');
          if (/^https?:\/\//i.test(decoded)) href = decoded;
        } catch (_) {}
      }
    }

    // 2. DuckDuckGo /l/?uddg=... and generic redirect parameters:
    for (const key of ['uddg', 'url', 'target', 'dest', 'destination', 'to']) {
      const v = p.get(key);
      if (v && /^https?:/i.test(v)) {
        href = v;
        break;
      }
    }

    // 3. Google /url?q=...:
    if (/\/url$/i.test(u.pathname) && p.get('q') && /^https?:/i.test(p.get('q'))) {
      href = p.get('q');
    }

    // 4. Yahoo /RU= redirect unwrapping:
    if (u.hostname.includes('yahoo.com') && u.pathname.includes('/RU=')) {
      const match = u.pathname.match(/\/RU=([^/]+)/i);
      if (match && match[1]) {
        try {
          const dec = decodeURIComponent(match[1]);
          if (/^https?:/i.test(dec)) href = dec;
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Strip trackers and finalize canonical structure
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    const drop = [
      /^utm_/i, /^fbclid$/i, /^gclid$/i, /^msclkid$/i, /^ref$/i, /^source$/i,
      /^fclid$/i, /^ptn$/i, /^ver$/i, /^hsh$/i, /^ved$/i, /^usg$/i
    ];
    [...u.searchParams.keys()].forEach(k => {
      if (drop.some(re => re.test(k))) u.searchParams.delete(k);
    });
    return u.toString();
  } catch (_) {
    return null;
  }
}

function isBadUrl(url) {
  if (!url) return true;
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return true;
    if (BAD_HOST.some(r => r.test(u.hostname))) return true;
    if (BAD_URL.some(r => r.test(u.pathname + u.search))) return true;

    const h = u.hostname.toLowerCase().replace(/^www\./, '');

    // Discard search engine homepages and internal navigational links
    if ((h === 'google.com' || h.endsWith('.google.com')) && (/^\/(?:search|url|tools|preferences|websearch|imghp)?$/i.test(u.pathname))) return true;
    if ((h === 'bing.com' || h.endsWith('.bing.com')) && (/^\/(?:search|ck|as)?$/i.test(u.pathname))) return true;
    if ((h === 'search.brave.com' || h === 'brave.com') && (/^\/search|^\/?$/i.test(u.pathname))) return true;
    if ((h === 'duckduckgo.com' || h === 'html.duckduckgo.com' || h === 'lite.duckduckgo.com') && (/^\/(?:html|lite|l)?$/i.test(u.pathname))) return true;
    if (h === 'mojeek.com' && (/^\/search|^\/?$/i.test(u.pathname))) return true;
    if ((h === 'search.yahoo.com' || h === 'yahoo.com') && (/^\/search|^\/?$/i.test(u.pathname))) return true;
    if (h === 'youtube.com' && (/^\/results|^\/?$/i.test(u.pathname))) return true;

    const low = (u.pathname + '+' + u.search).toLowerCase();
    if (['captcha', 'consent?continue', 'error_access', 'blocked=', 'unsupportedbrowser', 'feedback'].some(x => low.includes(x))) return true;
    return u.hostname.length > 253;
  } catch (_) {
    return true;
  }
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    return '';
  }
}

function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.protocol = 'https:';
    u.port = '';
    return u.toString().replace(/\/$/, '');
  } catch (_) {
    return url;
  }
}

function makeResult(engine, title, url, snippet = '', extra = {}) {
  let normalized = normalizeUrl(url, engine.url('x'));
  if (!normalized || isBadUrl(normalized)) return null;

  const cleanTitle = textClean(title, 240);
  if (!cleanTitle) return null;

  // Filter out search control / feedback labels
  if (/^(feedback|send feedback|give feedback|search help|help|privacy|terms|consumer information|sign in|google|bing)$/i.test(cleanTitle.trim())) {
    return null;
  }

  return {
    id: `${engine.id}:${canonicalUrl(normalized)}`,
    engine: engine.id,
    engineLabel: engine.label,
    kind: extra.kind || engine.kind,
    title: cleanTitle,
    url: normalized,
    domain: domainOf(normalized),
    snippet: textClean(snippet, 360),
    position: Number.isFinite(extra.position) ? extra.position : 999,
    published: extra.published || null
  };
}

function extractAnchors(html, base, limit = PER_ENGINE * 2) {
  const out = [], re = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    out.push({ href: m[2], text: textClean(m[3], 240) });
  }
  return out;
}

function parseGoogle(html, engine) {
  const out = [];
  const re = /<(?:div|article)\b[^>]*>[\s\S]{0,5000}?<h3\b[^>]*>([\s\S]*?)<\/h3>[\s\S]{0,5000}?<\/div>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < PER_ENGINE) {
    const block = m[0];
    const title = textClean(m[1], 240);
    const a = extractAnchors(block, 'https://www.google.com/', 12).find(x => x.href && !x.href.includes('/tools/feedback'));
    if (!title || !a) continue;
    const sn = textClean((block.match(/(?:VwiC3b|yXK71f|aCOpRe)[^>]*>([\s\S]{20,800}?)(?:<\/span><\/div>)/i) || [])[1] || '', 360);
    const r = makeResult(engine, title, a.href, sn, { position: out.length + 1 });
    if (r) out.push(r);
  }

  if (out.length < 6) {
    for (const a of extractAnchors(html, 'https://www.google.com/', 120)) {
      if (!a.text || a.text.length < 4) continue;
      if (/feedback|privacy|terms|settings|google/i.test(a.text)) continue;
      const r = makeResult(engine, a.text, a.href, '', { position: out.length + 1 });
      if (r && !out.some(x => x.url === r.url)) out.push(r);
      if (out.length >= PER_ENGINE) break;
    }
  }
  return out;
}

function parseBing(html, engine) {
  const out = [];
  const re = /<li\b[^>]*class=["'][^"']*b_algo[^]*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < PER_ENGINE) {
    const block = m[1];
    const h = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i);
    if (!h) continue;
    const sn = (block.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '';
    const r = makeResult(engine, h[3], h[2], sn, { position: out.length + 1 });
    if (r) out.push(r);
  }

  if (out.length < 6) {
    for (const a of extractAnchors(html, 'https://www.bing.com/', 100)) {
      if (!a.text || a.text.length < 4) continue;
      if (/feedback|privacy|terms|microsoft/i.test(a.text)) continue;
      const r = makeResult(engine, a.text, a.href, '', { position: out.length + 1 });
      if (r && !out.some(x => x.url === r.url)) out.push(r);
      if (out.length >= PER_ENGINE) break;
    }
  }
  return out;
}

function parseBingRss(xml, engine) {
  const out = [], items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  for (const item of items.slice(0, PER_ENGINE)) {
    const title = (item.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
    const link = (item.match(/<link>([\s\S]*?)<\/link>/i) || [])[1];
    const desc = (item.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '';
    const date = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || null;
    const r = makeResult(engine, title, link, desc, {
      position: out.length + 1,
      published: date,
      kind: 'news'
    });
    if (r) out.push(r);
  }
  return out;
}

function parseDuckHtml(html, engine) {
  const out = [], blocks = html.match(/<div\b[^>]*class=["'][^"']*result[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi) || [];
  for (const block of blocks) {
    const a = block.match(/<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const sn = (block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\//i) || [])[1] || '';
    const r = makeResult(engine, a[3], a[2], sn, { position: out.length + 1 });
    if (r) out.push(r);
    if (out.length >= PER_ENGINE) break;
  }

  if (!out.length) {
    for (const a of extractAnchors(html, 'https://html.duckduckgo.com/', 100)) {
      if (!a.text || a.text.length < 5) continue;
      const r = makeResult(engine, a.text, a.href, '', { position: out.length + 1 });
      if (r && !out.some(x => x.url === r.url)) out.push(r);
      if (out.length >= PER_ENGINE) break;
    }
  }
  return out;
}

function parseDuckLite(html, engine) {
  const out = [], re = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < PER_ENGINE) {
    const title = textClean(m[3], 240);
    if (!title || title.length < 5) continue;
    const r = makeResult(engine, title, m[2], '', { position: out.length + 1 });
    if (r) out.push(r);
  }
  return out;
}

function parseBrave(html, engine) {
  const out = [];
  const re = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>[\s\S]{0,500}?<h3\b[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < PER_ENGINE) {
    const r = makeResult(engine, m[3], m[2], '', { position: out.length + 1 });
    if (r) out.push(r);
  }

  if (!out.length) {
    for (const a of extractAnchors(html, 'https://search.brave.com/', 120)) {
      if (!a.text || a.text.length < 5) continue;
      const r = makeResult(engine, a.text, a.href, '', { position: out.length + 1 });
      if (r && !out.some(x => x.url === r.url)) out.push(r);
      if (out.length >= PER_ENGINE) break;
    }
  }
  return out;
}

function parseMojeek(html, engine) {
  const out = [], re = /<li\b[^>]*class=["'][^"']*result[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < PER_ENGINE) {
    const block = m[1];
    const a = block.match(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const sn = (block.match(/<(?:p|div)\b[^>]*(?:class=["'][^"']*(?:desc|snippet)[^"']*)[^>]*>([\s\S]*?)<\//i) || [])[1] || '';
    const r = makeResult(engine, a[3], a[2], sn, { position: out.length + 1 });
    if (r) out.push(r);
  }

  if (!out.length) {
    for (const a of extractAnchors(html, 'https://www.mojeek.com/', 120)) {
      if (!a.text || a.text.length < 5) continue;
      const r = makeResult(engine, a.text, a.href, '', { position: out.length + 1 });
      if (r && !out.some(x => x.url === r.url)) out.push(r);
      if (out.length >= PER_ENGINE) break;
    }
  }
  return out;
}

function parseYahoo(html, engine) {
  const out = [];
  const blocks = html.match(/<div\b[^>]*class=["'][^"']*(?:algo|searchCenterMiddle)[^"']*["][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi) || [];
  for (const block of blocks) {
    const a = block.match(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const title = textClean(a[3], 240);
    if (!title) continue;
    const sn = (block.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '';
    const r = makeResult(engine, title, a[2], sn, { position: out.length + 1 });
    if (r) out.push(r);
    if (out.length >= PER_ENGINE) break;
  }

  if (!out.length) {
    for (const a of extractAnchors(html, 'https://search.yahoo.com/', 120)) {
      if (!a.text || a.text.length < 5) continue;
      const r = makeResult(engine, a.text, a.href, '', { position: out.length + 1 });
      if (r && !out.some(x => x.url === r.url)) out.push(r);
      if (out.length >= PER_ENGINE) break;
    }
  }
  return out;
}

function parseYoutube(html, engine) {
  const out = [];
  const re = /"videoId":"([A-Za-z0-9_-]{6,})"[\s\S]{0,1800}?"title":\{"runs":\[\{"text":"((?:\\.\vert{}[^"\\])*)"/g;
  let m;
  while ((m = re.exec(html)) && out.length < PER_ENGINE) {
    const title = decodeEntities(m[2].replace(/\\u0026/g, '&').replace(/\\"/g, '"'));
    const r = makeResult(engine, title, `https://www.youtube.com/watch?v=${m[1]}`, '', {
      position: out.length + 1,
      kind: 'video'
    });
    if (r && !out.some(x => x.url === r.url)) out.push(r);
  }

  if (!out.length) {
    for (const a of extractAnchors(html, 'https://www.youtube.com/', 150)) {
      if (!/\/watch\?v=/.test(a.href) || !a.text) continue;
      const r = makeResult(engine, a.text, a.href, '', { position: out.length + 1, kind: 'video' });
      if (r && !out.some(x => x.url === r.url)) out.push(r);
      if (out.length >= PER_ENGINE) break;
    }
  }
  return out;
}

function cleanQuery(q) {
  return String(q || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_QUERY);
}

function tokens(s) {
  return [...new Set((String(s).toLowerCase().match(/[a-z0-9][a-z0-9-]{1,40}/g) || []).filter(x => !STOP.has(x)))];
}

function lexicalScore(query, r) {
  const qt = tokens(query);
  if (!qt.length) return 0.25;
  const title = tokens(r.title);
  const body = tokens(`${r.snippet} ${r.domain}`);
  const ts = new Set(title);
  const bs = new Set(body);
  let t = 0, b = 0;

  for (const x of qt) {
    if (ts.has(x)) t++;
    else if (bs.has(x)) b++;
    else {
      const stem = x.length > 5 ? x.slice(0, -1) : x;
      if (title.some(y => y.startsWith(stem))) t += 0.35;
      else if (body.some(y => y.startsWith(stem))) b += 0.15;
    }
  }

  const phrase = r.title.toLowerCase().includes(String(query).toLowerCase()) ? 0.20 : 0;
  return clamp(0.66 * (t / qt.length) + 0.24 * (b / qt.length) + phrase, 0, 1);
}

function urlQuality(r) {
  let s = 0.52;
  try {
    const u = new URL(r.url);
    if (u.protocol === 'https:') s += 0.16;
    if (u.pathname.length > 1) s += 0.05;
    if (/\.(?:pdf|docx?|pptx?|xlsx?)$/i.test(u.pathname)) s += 0.18;
    if (/\b(?:docs?|documentation|developer|api|reference|guide|learn|manual|wiki)\b/i.test(u.pathname)) s += 0.12;
    if (/\.(?:gov|edu)(?:\.|$)/i.test(u.hostname)) s += 0.15;
    if (/\.(?:org)(?:\.|$)/i.test(u.hostname)) s += 0.05;
  } catch (_) {}
  return clamp(s, 0, 1);
}

function intentWeight(r, priorities) {
  let w = 1;
  if (priorities.has('web')) w *= 1.02;
  if (priorities.has('news')) {
    if (r.kind === 'news') w *= 1.42;
    if (/news|today|latest|update|breaking|202[4-9]/i.test(`${r.title} ${r.snippet}`)) w *= 1.08;
  }
  if (priorities.has('videos') && (r.kind === 'video' || /youtube\.com/i.test(r.domain))) w *= 1.52;
  if (priorities.has('docs')) {
    if (/\.(?:pdf|docx?|pptx?|xlsx?)$/i.test(r.url) || /\b(?:docs?|documentation|developer|api|reference|manual|guide|spec|rfc)\b/i.test(`${r.title} ${r.url}`)) w *= 1.36;
    if (/\.(?:gov|edu|org)(?:\.|$)/i.test(r.domain)) w *= 1.10;
  }
  return w;
}

function priorityBase(engine, priorities) {
  let w = engine.baseWeight;
  if (priorities.has('news') && engine.kind === 'news') w *= 1.28;
  if (priorities.has('videos') && engine.kind === 'video') w *= 1.24;
  if (priorities.has('docs') && engine.kind === 'web' && /google|bing|brave|mojeek/.test(engine.id)) w *= 1.05;
  return w;
}

function rankEngineResults(query, engine, results, priorities) {
  return results.map(r => {
    const lexical = lexicalScore(query, r);
    const quality = urlQuality(r);
    const position = clamp(1 - ((r.position - 1) / Math.max(1, PER_ENGINE - 1)), 0, 1);
    const engineScore = clamp(priorityBase(engine, priorities) / 1.5, 0, 1);
    const intent = clamp(intentWeight(r, priorities) / 1.6, 0, 1);
    const score = clamp(100 * (0.45 * lexical + 0.20 * quality + 0.14 * position + 0.10 * engineScore + 0.11 * intent), 0, 100);
    return { ...r, score: Number(score.toFixed(2)), lexical: Number(lexical.toFixed(3)) };
  });
}

function mergeResults(query, packets, priorities, maxSources) {
  const map = new Map();
  let rawCount = 0;

  for (const packet of packets) {
    for (const r of packet.results || []) {
      rawCount++;
      const key = canonicalUrl(r.url);
      const scored = {
        ...r,
        score: lexicalScore(query, r) * 60 + urlQuality(r) * 25 + clamp((PER_ENGINE - r.position + 1) / PER_ENGINE, 0, 1) * 15
      };
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...scored, engines: [packet.id], engineLabels: [packet.label], seen: 1, score: scored.score });
      } else {
        if (!prev.engines.includes(packet.id)) prev.engines.push(packet.id);
        if (!prev.engineLabels.includes(packet.label)) prev.engineLabels.push(packet.label);
        prev.seen++;
        prev.score += 8 + priorityBase(ENGINES.find(e => e.id === packet.id) || ENGINES[0], priorities) * 4;
        if (r.position < prev.position) prev.position = r.position;
        if ((!prev.snippet || prev.snippet.length < 40) && r.snippet) prev.snippet = r.snippet;
      }
    }
  }

  const results = [...map.values()].map(r => {
    const agreementBonus = clamp((r.seen - 1) * 4.5, 0, 18);
    const engineBonus = clamp(r.engines.length * 1.7, 0, 12);
    const intent = intentWeight(r, priorities);
    const finalScore = clamp((0.78 * r.score + agreementBonus + engineBonus) * (0.88 + 0.12 * Math.min(intent, 1.6)), 0, 100);
    return { ...r, score: Number(finalScore.toFixed(2)) };
  }).sort((a, b) => b.score - a.score);

  return {
    rawCount,
    uniqueCount: results.length,
    results: results.slice(0, maxSources).map((r, i) => ({ ...r, rank: i + 1 }))
  };
}

async function fetchText(url, timeoutMs, referer = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = now();

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  };

  if (referer) headers['Referer'] = referer;

  try {
    const r = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers
    });
    const text = await r.text();
    return {
      ok: r.ok,
      status: r.status,
      text,
      ms: now() - started,
      contentType: r.headers.get('content-type') || ''
    };
  } finally {
    clearTimeout(timer);
  }
}

function classifyError(err) {
  if (!err) return 'unknown error';
  if (err.name === 'AbortError') return 'timeout';
  return String(err.message || err).slice(0, 180);
}

async function runEngine(engine, query, priorities) {
  const started = now();
  try {
    const response = await fetchText(engine.url(query), ENGINE_LIMIT_MS, engine.referer || '');
    if (!response.ok) {
      return {
        id: engine.id,
        label: engine.label,
        kind: engine.kind,
        ms: response.ms,
        status: `HTTP ${response.status}`,
        error: `HTTP ${response.status}`,
        results: []
      };
    }

    let results = [];
    try {
      results = engine.parse(response.text, engine) || [];
    } catch (e) {
      return {
        id: engine.id,
        label: engine.label,
        kind: engine.kind,
        ms: response.ms,
        status: 'parse-error',
        error: classifyError(e),
        results: []
      };
    }

    results = rankEngineResults(query, engine, results, priorities)
      .filter(r => r && !isBadUrl(r.url))
      .slice(0, PER_ENGINE);

    return {
      id: engine.id,
      label: engine.label,
      kind: engine.kind,
      ms: response.ms,
      status: results.length ? 'ok' : 'empty',
      error: results.length ? null : 'No parseable links returned',
      results
    };
  } catch (e) {
    return {
      id: engine.id,
      label: engine.label,
      kind: engine.kind,
      ms: now() - started,
      status: 'failed',
      error: classifyError(e),
      results: []
    };
  }
}

function parsePriorities(raw) {
  const allowed = new Set(['web', 'news', 'docs', 'videos']);
  const x = String(raw || 'web').split(',').map(s => s.trim().toLowerCase()).filter(s => allowed.has(s));
  if (!x.length) x.push('web');
  return new Set(x);
}

function isSse(req) {
  return String(req.headers.accept || '').includes('text/event-stream') || String(req.query.stream || '') === '1';
}

function sseWrite(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (_) {}
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, OPTIONS');
    res.end('Method Not Allowed');
    return;
  }

  const query = cleanQuery(req.query?.q);
  const maxSources = clamp(Number(req.query?.max || DEFAULT_MAX) || DEFAULT_MAX, 1, HARD_MAX);
  const priorities = parsePriorities(req.query?.priority || req.query?.priorities || 'web');
  const priorityList = [...priorities];
  const started = now();
  const stream = isSse(req);

  if (!query) {
    res.statusCode = 400;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'Missing q parameter', example: '/api/search?q=your+query&priority=web,news&max=200' }));
    return;
  }

  res.statusCode = 200;
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (stream) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
  } else {
    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }

  const packets = [];
  let closed = false;
  if (stream && req.on) req.on('close', () => { closed = true; });

  if (stream) {
    sseWrite(res, 'meta', {
      query,
      priorities: priorityList,
      maxSources,
      engines: ENGINES.map(e => ({ id: e.id, label: e.label, kind: e.kind }))
    });
  }

  const tasks = ENGINES.map(engine =>
    runEngine(engine, query, priorities).then(packet => {
      packets.push(packet);
      if (stream && !closed) sseWrite(res, 'engine', packet);
      return packet;
    })
  );

  const settled = await Promise.all(tasks);
  settled.sort((a, b) => ENGINES.findIndex(e => e.id === a.id) - ENGINES.findIndex(e => e.id === b.id));

  const merged = mergeResults(query, settled, priorities, maxSources);
  const totalMs = now() - started;
  const avgMs = settled.length ? Math.round(settled.reduce((s, x) => s + x.ms, 0) / settled.length) : 0;
  const fastest = [...settled].filter(x => x.status === 'ok').sort((a, b) => a.ms - b.ms)[0]?.ms || null;

  const output = {
    ok: true,
    query,
    priorities: priorityList,
    generatedAt: new Date().toISOString(),
    maxSources,
    timings: { totalMs, fastestEngineMs: fastest, meanEngineMs: avgMs },
    stats: {
      enginesAttempted: settled.length,
      enginesSucceeded: settled.filter(x => x.status === 'ok').length,
      enginesFailed: settled.filter(x => x.status === 'failed' || x.status.startsWith('HTTP') || x.status === 'parse-error').length,
      rawResults: merged.rawCount,
      uniqueLinks: merged.uniqueCount,
      returned: merged.results.length
    },
    engines: settled,
    results: merged.results
  };

  if (stream) {
    if (!closed) {
      sseWrite(res, 'done', output);
      res.end();
    }
  } else {
    res.end(JSON.stringify(output));
  }
};

module.exports.config = { runtime: 'nodejs24.x', maxDuration: 15 };
