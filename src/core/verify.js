/**
 * Checking every invoice before it can be exported without a second look.
 *
 * Detection and grouping make a first guess. This step asks of each invoice:
 * is there any reason to doubt it? An invoice goes out without review only when
 * nothing here has a doubt about it. When something does, the invoice is
 * flagged with the reason, in plain words, and - where there is an obvious
 * right answer - offered as a one-click fix. Nothing here ever changes a
 * number on its own, with one exception: a number that does not look like the
 * client's other numbers, where swapping one look-alike character makes it fit
 * AND gives a number that is in the person's own invoice list. Two separate
 * pieces of evidence agree, and the change is shown.
 *
 * Plain JavaScript, like the rest of the engine.
 */

import { fitsShape, valueShape } from './detect.js';
import { checkNumber, normalizeKnown } from './knownList.js';
import { SURE_READING } from './scans.js';

/** Swaps text recognition makes, each way round. */
const SWAPS = {
  0: ['O'],
  O: ['0'],
  1: ['I', 'L'],
  I: ['1'],
  L: ['1'],
  5: ['S'],
  S: ['5'],
  8: ['B'],
  B: ['8'],
  2: ['Z'],
  Z: ['2'],
  6: ['G'],
  G: ['6'],
};

/** Every number one look-alike swap away from this one. */
export function lookAlikeSwaps(value) {
  const out = new Set();
  const text = String(value);
  for (let at = 0; at < text.length; at += 1) {
    for (const other of SWAPS[text[at]] ?? []) {
      out.add(`${text.slice(0, at)}${other}${text.slice(at + 1)}`);
    }
  }
  return [...out];
}

/** The letters-and-separator run a number starts with: "INV-" of "INV-30117". */
export function leadingPrefix(value) {
  return /^[A-Z]+[-_/ .]?/.exec(String(value))?.[0] ?? '';
}

/** The run of letters and separators all of these numbers start with, if any. */
function sharedPrefix(values) {
  if (values.length < 2) return '';
  const [first, ...rest] = values.map(leadingPrefix);
  return first && rest.every((prefix) => prefix === first) ? first : '';
}

/**
 * What a client's numbers look like, from numbers known to be right: the
 * shapes they come in, and the prefix they all share, if they share one.
 *
 * @param {string[]} confirmed - numbers known to be right.
 * @returns {{ shapes: string[], prefix: string }}
 */
export function learnShape(confirmed = []) {
  const values = confirmed.map(normalizeKnown).filter(Boolean);
  return { shapes: [...new Set(values.map(valueShape))], prefix: sharedPrefix(values) };
}

/** Does this number look like the client's other numbers? */
function fits(value, { shapes = [], prefix = '' }) {
  if (prefix && !String(value).startsWith(prefix)) return false;
  return shapes.length === 0 || shapes.some((shape) => fitsShape(value, shape));
}

/** A shape written for a person: "2 letters, a hyphen, then 5 digits". */
export function describeShape(shape) {
  const marks = { '-': 'a hyphen', _: 'an underscore', '/': 'a slash', '.': 'a full stop' };
  const parts = String(shape)
    .split(' ')
    .filter(Boolean)
    .map((part) => {
      const run = /^([AD])(\d+)$/.exec(part);
      if (!run) return marks[part] ?? `"${part}"`;
      const count = Number(run[2]);
      const kind = run[1] === 'A' ? 'letter' : 'digit';
      return `${count} ${kind}${count === 1 ? '' : 's'}`;
    });
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')}, then ${parts[parts.length - 1]}`;
}

/** The longest run of digits in a number, as a number, for putting numbers in order. */
function digitRun(value) {
  const runs = String(value).match(/\d+/g) ?? [];
  const longest = runs.reduce((best, run) => (run.length > best.length ? run : best), '');
  return longest.length >= 3 ? Number(longest) : null;
}

/** The client an invoice belongs to: their box, or failing that, the file it came in. */
function clientOf(group) {
  for (const page of group.pages) {
    const boxed = page.matchedProfiles?.find((profile) => profile.zone);
    if (boxed) return { key: boxed.id, name: boxed.name, profile: boxed };
  }
  const file = group.pages[0]?.fileName ?? '';
  return { key: `file:${file}`, name: file, profile: null };
}

/**
 * Is a page blank? One with no text that is not a picture - or a picture that
 * text recognition read and found nothing on.
 *
 * @param {object} page
 * @param {(page: object) => boolean|undefined} [isPicture] - undefined when not yet known.
 */
export function isBlankPage(page, isPicture) {
  if (String(page.text ?? '').trim()) return false;
  if (page.ocr) return true;
  return isPicture?.(page) === false;
}

/**
 * What follows a number on a page, when it looks like more of the same number.
 *
 * "2031 /HM/00217" read by a label as "2031", or "40017822 _2" as "40017822":
 * the part straight after - starting with a slash or an underscore, with at
 * most a space before or after it - is very likely the rest of the number. A
 * slash with spaces on both sides ("12345 / PO 678") is left alone.
 *
 * @param {string} text - the page's text.
 * @param {string} value - the number that was found.
 * @returns {string|null} the part that seems to carry on, or null.
 */
export function carriesOn(text, value) {
  if (!text || !value) return null;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?:^|[^A-Za-z0-9])${escaped}(?: ?([/_][A-Za-z0-9][^\\s]*)|(/) ([A-Za-z0-9][^\\s]*))`
  );
  const match = pattern.exec(text);
  if (!match) return null;
  return match[1] ?? `${match[2]}${match[3]}`;
}

/**
 * Check every invoice.
 *
 * @param {Array<object>} groups - from groupPages and assignFileNames.
 * @param {object} [context]
 * @param {ReturnType<import('./knownList.js').buildKnownList>|null} [context.knownList]
 * @param {boolean} [context.strict] - only invoices in the list go out without review.
 * @param {Record<string, { shapes: string[], prefix: string }>} [context.learned] - by box id.
 * @param {(page: object) => boolean|undefined} [context.isPicture] - for telling blank pages.
 * @param {Set<number>} [context.unreadScans] - pages that are scans not read yet.
 * @returns {{ groups: Array<object>, missing: Array<{ value: string, client: string }> }}
 */
export function verifyGroups(groups = [], context = {}) {
  const {
    knownList = null,
    strict = true,
    learned = {},
    isPicture,
    unreadScans = new Set(),
  } = context;
  const allPages = groups.flatMap((group) => group.pages);
  const copies = new Map();
  for (const page of allPages) copies.set(page.text, (copies.get(page.text) ?? 0) + 1);
  // A batch where somebody has drawn a box: there, every page ought to belong to
  // a client the app has been shown.
  const boxedBatch = allPages.some((page) => page.matchedProfiles?.some((profile) => profile.zone));

  // What each client's numbers look like, from what is known to be right.
  const confirmedByClient = new Map();
  for (const group of groups) {
    const { key } = clientOf(group);
    if (!confirmedByClient.has(key)) confirmedByClient.set(key, []);
    if (group.invoice && knownList?.byValue.has(normalizeKnown(group.invoice))) {
      confirmedByClient.get(key).push(group.invoice);
    }
  }
  const shapeOf = (client) => {
    // A file can hold more than one supplier, so one confirmed number in it says
    // too little; two or more say what that file's numbers look like.
    const confirmed = confirmedByClient.get(client.key) ?? [];
    const fromBatch = confirmed.length >= 2 ? learnShape(confirmed) : { shapes: [], prefix: '' };
    const remembered = client.profile ? learned[client.profile.id] : null;
    const boxShape = client.profile?.zoneShape ? [client.profile.zoneShape] : [];
    return {
      shapes: [...new Set([...boxShape, ...(remembered?.shapes ?? []), ...fromBatch.shapes])],
      prefix: remembered?.prefix || fromBatch.prefix,
    };
  };

  const checked = groups.map((original) => {
    const group = {
      ...original,
      flags: [...original.flags],
      notes: { ...(original.notes ?? {}) },
      verified: false,
      notInList: false,
      suggestion: null,
      correctedFrom: null,
    };
    const add = (flag, note) => {
      if (!group.flags.includes(flag)) group.flags.push(flag);
      if (note !== undefined) group.notes[flag] = note;
    };
    const drop = (flag) => {
      group.flags = group.flags.filter((entry) => entry !== flag);
    };
    const client = clientOf(group);
    group.clientKey = client.key;
    const typed = group.provenance?.source === 'manual';

    // Scanned pages not read yet: the number, and where this invoice ends, may
    // come from words typed on top of the picture rather than the paper itself.
    const notRead = group.pages.filter((page) => unreadScans.has(page.index));
    if (notRead.length) add('scan-not-read', { pages: notRead.map((page) => page.index) });

    // The number may be only the start of one: "2031" where the page goes on
    // "2031 /HM/00217". Unless typed in by hand, or confirmed by the list.
    if (group.invoice && !typed && !knownList?.byValue.has(normalizeKnown(group.invoice))) {
      for (const page of group.pages) {
        if (page.detection?.value !== group.invoice) continue;
        const rest = carriesOn(page.text, group.invoice);
        if (rest) {
          add('cut-short', { page: page.index, rest });
          break;
        }
      }
    }

    // A number that does not look like the client's own, put right only when a
    // single look-alike swap fits AND the list confirms the result. A number the
    // list already has is right whatever it looks like.
    const shape = shapeOf(client);
    const listed = Boolean(knownList?.byValue.has(normalizeKnown(group.invoice)));
    if (
      group.invoice &&
      !typed &&
      !listed &&
      shape.shapes.length > 0 &&
      !fits(group.invoice, shape)
    ) {
      const fitting = lookAlikeSwaps(group.invoice).filter((value) => fits(value, shape));
      const confirmed = fitting.filter((value) => knownList?.byValue.has(value));
      if (fitting.length === 1 && confirmed.length === 1) {
        group.correctedFrom = group.invoice;
        group.invoice = confirmed[0];
      } else {
        add('odd-shape', {
          looksLike: describeShape(shape.shapes[0]),
          suggestion: fitting.length === 1 ? fitting[0] : null,
        });
        if (fitting.length === 1) group.suggestion = { value: fitting[0], why: 'shape' };
      }
    }

    // Readings that disagree, one of which the person's own list confirms: the
    // list settles it. The table still says what the number was read as.
    if (knownList && group.flags.includes('conflict') && !typed) {
      const offered = group.pages.find((page) => page.conflict)?.candidates ?? [];
      const listed = [...new Set(offered.map((hit) => normalizeKnown(hit.value)))].filter((value) =>
        knownList.byValue.has(value)
      );
      if (listed.length === 1) {
        if (normalizeKnown(group.invoice) !== listed[0]) {
          group.correctedFrom = group.invoice;
          group.invoice = listed[0];
        }
        drop('conflict');
      }
    }

    // The person's own list of invoice numbers.
    if (knownList && group.invoice) {
      const result = checkNumber(group.invoice, knownList);
      if (result.status === 'verified') {
        group.verified = true;
      } else if (result.status === 'near') {
        add('near-list', { suggestion: result.suggestion, why: result.why });
        group.suggestion = { value: result.suggestion, why: result.why };
      } else if (strict) {
        add('not-in-list');
      } else {
        group.notInList = true;
      }
    }

    // Read from a scan: trusted only when something double-checks it. A blank
    // page read from a scan is flagged as blank, and needs nothing more.
    const blank = group.pages.filter((page) => isBlankPage(page, isPicture));
    const numberPage = group.pages.find((page) => page.index === group.provenance?.pageIndex);
    if (group.flags.includes('ocr')) {
      const confidence = numberPage?.detection?.confidence;
      const repeats = group.pages.filter((page) => page.detection?.value === group.invoice).length;
      const corroborated =
        Boolean(numberPage?.agreement) || Boolean(numberPage?.readingsAgree) || repeats >= 2;
      const sure = typeof confidence === 'number' && confidence >= SURE_READING;
      const fromText =
        numberPage &&
        !numberPage.ocr &&
        group.pages.every((page) => !page.ocr || blank.includes(page));
      if (typed || group.verified || fromText || (group.invoice && sure && corroborated)) {
        drop('ocr');
      } else {
        group.notes.ocr = {
          page: numberPage?.index ?? group.pages[0].index,
          confidence: typeof confidence === 'number' ? Math.round(confidence) : null,
        };
      }
    }
    // A number in the list needs nothing else to vouch for where it came from.
    if (group.verified) drop('fallback');

    // Two ways of reading a page that disagree: show both.
    if (group.flags.includes('conflict')) {
      const page = group.pages.find((entry) => entry.conflict);
      const seen = new Map();
      for (const hit of page?.candidates ?? []) if (!seen.has(hit.value)) seen.set(hit.value, hit);
      group.notes.conflict = { page: page?.index, readings: [...seen.values()] };
    }

    // "Page X of Y" against the pages this invoice actually has. Not every page
    // need be marked - a cover sheet or a page of terms often is not - but the
    // marks there are must run upwards, "Page 1 of" cannot turn up part way
    // through, and the pages cannot add up to fewer than the marks promise.
    const marked = group.pages.filter((page) => page.pageOf);
    if (marked.length > 0) {
      const restart = marked.findIndex((page, at) => at > 0 && page.pageOf.page === 1);
      const rising = marked.every(
        (page, at) => at === 0 || page.pageOf.page > marked[at - 1].pageOf.page
      );
      const total = marked[0].pageOf.of;
      const agreed = marked.every((page) => page.pageOf.of === total);
      const everyPage = marked.length === group.pages.length;
      if (restart > 0) {
        add('page-order', { page: marked[restart].index, kind: 'restart' });
      } else if (!rising) {
        add('page-order', { kind: 'order' });
      } else if (!agreed || total > group.pages.length || (everyPage && total !== marked.length)) {
        add('page-count', { says: total, has: group.pages.length });
      }
    }

    // A scanned page that seems to carry a number of its own, unread - kept with
    // this invoice, but it may be the start of another.
    const unread = group.pages.filter(
      (page) => page.unreadNumber && page.index !== group.pages[0].index
    );
    if (unread.length) add('unread-number', { pages: unread.map((page) => page.index) });

    // Blank pages, and pages no client the app has been shown claims.
    if (blank.length) add('blank-page', { pages: blank.map((page) => page.index) });
    if (boxedBatch) {
      // Not a page that names this invoice's own number - a running header on
      // a continuation page, say - since that says plainly where it belongs.
      const own = group.invoice ? group.invoice.toUpperCase() : null;
      const strays = group.pages.filter(
        (page) =>
          !page.matchedProfiles?.some((profile) => profile.zone) &&
          !page.detection &&
          copies.get(page.text) === 1 &&
          !blank.includes(page) &&
          !(own && String(page.text).toUpperCase().includes(own))
      );
      if (strays.length) add('no-client', { pages: strays.map((page) => page.index) });
    }
    return group;
  });

  // A number far from the client's other numbers in this batch.
  const byClient = new Map();
  for (const group of checked) {
    const value = group.invoice ? digitRun(group.invoice) : null;
    if (value === null) continue;
    const key = `${group.clientKey} ${valueShape(group.invoice)}`;
    byClient.set(key, [...(byClient.get(key) ?? []), { group, value }]);
  }
  for (const members of byClient.values()) {
    if (members.length < 3) continue;
    for (const member of members) {
      const others = members.filter((entry) => entry !== member).map((entry) => entry.value);
      const low = Math.min(...others);
      const high = Math.max(...others);
      const margin = Math.max(high - low, 500);
      if (member.value < low - margin || member.value > high + margin) {
        const group = member.group;
        if (!group.flags.includes('out-of-sequence')) group.flags.push('out-of-sequence');
        const first = others.length ? members.find((entry) => entry.value === low) : null;
        const last = members.find((entry) => entry.value === high);
        group.notes['out-of-sequence'] = { from: first?.group.invoice, to: last?.group.invoice };
      }
    }
  }

  // Invoices in the list that no invoice in the batch carries - leaving out any
  // already offered as the likely right number for one that is here.
  const found = new Set(
    checked
      .flatMap((group) => [group.invoice, group.suggestion?.value])
      .map(normalizeKnown)
      .filter(Boolean)
  );
  const missing = knownList ? knownList.entries.filter((entry) => !found.has(entry.value)) : [];

  return { groups: checked, missing };
}
