// The player's own climber outfit. Guests keep it in this browser; logged-in players will also get it saved
// in their profile (stage 2). Anything read back is checked against the editor's options.
import { sanitizeOutfit, type Outfit } from './game/render';

const KEY = 'cd.outfit';

let cache: Outfit | null | undefined;

/** my outfit, or null = the lane's built-in look (nothing chosen yet) */
export function getMyOutfit(): Outfit | null {
  if (cache !== undefined) return cache;
  try {
    cache = sanitizeOutfit(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    cache = null;
  }
  return cache;
}

export function saveMyOutfit(o: Outfit) {
  const clean = sanitizeOutfit(o);
  if (!clean) return;
  cache = clean;
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* no storage: kept for this session only */
  }
}

/** names shown in the editor, in the order of OUTFIT_OPTIONS */
export const OPTION_NAMES = {
  skin: ['Light', 'Medium', 'Tan', 'Dark'],
  hairStyle: ['Short', 'Ponytail', 'Curly', 'Long'],
  hair: ['Black', 'Brown', 'Blonde', 'Auburn'],
  band: ['None', 'Red', 'Blue', 'Yellow'],
  shirt: ['Blue', 'Orange', 'Green', 'Purple'],
  pants: ['Navy', 'Graphite', 'Denim', 'Khaki'],
  shoes: ['Yellow', 'Red', 'Blue', 'White'],
} as const;

export const PART_LABELS: [keyof typeof OPTION_NAMES, string][] = [
  ['skin', 'SKIN'],
  ['hairStyle', 'HAIRSTYLE'],
  ['hair', 'HAIR'],
  ['band', 'HEADBAND'],
  ['shirt', 'SHIRT'],
  ['pants', 'PANTS'],
  ['shoes', 'SHOES'],
];
