// Normalize an author's display name before embedding.
//
// The classifier is trained on clean names ("Anna", "DIE ZEIT"), but live
// display names carry emoji, flags, pronoun tags and separator clutter
// ("Sarah 🌸 (she/her) | writer"). Stripping that noise brings the runtime
// input closer to the training distribution and makes the name signal cleaner.
//
// Applied in BOTH the feed handler and scripts/train-classifier.ts — keep the
// two call sites in sync by importing from here.
export function normalizeName(raw: string): string {
  let s = raw.normalize('NFC')
  // Strip emoji, pictographs, regional-indicator flags, arrows, symbols and the
  // zero-width joiner / variation selectors that glue emoji sequences together.
  s = s.replace(
    /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{2122}\u{2139}]/gu,
    ' ',
  )
  // Strip decorative separators commonly used between name and descriptors.
  s = s.replace(/[|•·⚡–—_*~^`"]+/g, ' ')
  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim()
  return s || raw.trim()
}

// Neutral leading titles to skip when picking the first name, so
// "Senator Sheldon Whitehouse" classifies on "Sheldon", not "Senator". Gendered
// honorifics (Herr/Frau/Mr/Mrs) are deliberately kept — they carry a signal.
const HONORIFICS = new Set([
  'dr', 'prof', 'sen', 'senator', 'rep', 'mx', 'sir', 'hon', 'rev', 'gov',
  'pres', 'president', 'minister', 'capt', 'lord', 'lady', 'mp', 'mdb',
])

// The gender classifier was trained predominantly on bare first names, so
// classifying the first-name token of a display name matches that distribution
// far better than the full "First Last" string (measured 95% vs 65% accuracy on
// a German probe set). Falls back gracefully for single-token / handle names.
export function firstName(raw: string): string {
  const normalized = normalizeName(raw)
  const tokens = normalized.split(/\s+/).filter(Boolean)
  for (const tok of tokens) {
    const bare = tok.replace(/[.]+$/, '').toLowerCase()
    if (!HONORIFICS.has(bare) && /\p{L}/u.test(tok)) return tok
  }
  return tokens[0] || normalized
}
