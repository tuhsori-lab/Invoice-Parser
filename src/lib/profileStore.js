/**
 * Keeping client profiles between visits.
 *
 * Profiles live in this browser's own storage and nowhere else. They hold only
 * what a client's invoices look like - labels, a company name to recognise them
 * by - never anything from an invoice itself.
 *
 * Storage can fail: a private window, a browser set to block site data, a full
 * disk. None of that should stop someone splitting a batch, so every call here
 * fails quietly and the app carries on with whatever it has in memory.
 */

import { createProfile } from '../core/profiles.js';

const KEY = 'invoice-splitter.profiles.v1';

/**
 * The profiles saved on this computer.
 *
 * @returns {{ profiles: Array<object>, active: string[] }}
 */
export function loadProfiles() {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (!stored) return { profiles: [], active: [] };
    const data = JSON.parse(stored);
    const profiles = (data.profiles ?? []).map((profile) => createProfile(profile));
    const known = new Set(profiles.map((profile) => profile.id));
    const active = (data.active ?? []).filter((id) => known.has(id));
    return { profiles, active };
  } catch {
    return { profiles: [], active: [] };
  }
}

/**
 * Remember these profiles for next time.
 *
 * @param {Array<object>} profiles
 * @param {string[]} active - the ids currently switched on.
 * @returns {boolean} whether they could be saved.
 */
export function saveProfiles(profiles, active) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ profiles, active }));
    return true;
  } catch {
    return false;
  }
}

/** Forget every saved profile. */
export function clearProfiles() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing saved is nothing to clear.
  }
}
