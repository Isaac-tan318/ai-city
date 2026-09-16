// Is the quote a judge offered as evidence actually in the transcript, and did
// the right person say it?
//
// Every verdict in this program is supposed to be traceable to an utterance.
// That guarantee is only worth something if the utterance is checked: a judge
// asked for a supporting quote will occasionally produce a paraphrase, a line
// somebody else said, or — the failure that matters most here — nothing at all,
// while still returning a confident verdict. An unquoted verdict is not a
// finding, it is the model's prior.
//
// The matching is deliberately forgiving about form and strict about substance.
// Judges normalise curly quotes, drop a trailing clause, and splice two
// sentences with an ellipsis; none of that means the words were invented. So
// punctuation and case are stripped before comparing, an ellipsis splits the
// quote into fragments that must each appear, and a long quote may match on a
// run of consecutive words rather than in full.

// A quote longer than this many words may match on a run of consecutive words
// rather than whole, which is what lets a lightly trimmed quote still count.
// At or below it the fragment must appear in full — five words is short enough
// that a partial match would prove very little.
export const MIN_WINDOW_WORDS = 5;

// And the run has to be most of the quote. A fixed five-word floor would let a
// long invented sentence pass on one real-sounding phrase inside it.
const WINDOW_SHARE = 0.6;

export function normalizeForMatch(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Split on ellipsis: a judge writing "we could get grilled meat … and soto"
// is citing two places in one line, and both halves have to be real.
function fragmentsOf(quote: string): string[] {
  return quote
    .split(/…|\.\.\./)
    .map(normalizeForMatch)
    .filter((f) => f.length > 0);
}

function fragmentAppears(fragment: string, haystack: string): boolean {
  if (haystack.includes(fragment)) return true;
  const words = fragment.split(' ');
  if (words.length <= MIN_WINDOW_WORDS) return false;
  const window = Math.max(MIN_WINDOW_WORDS, Math.ceil(words.length * WINDOW_SHARE));
  for (let i = 0; i + window <= words.length; i++) {
    if (haystack.includes(words.slice(i, i + window).join(' '))) return true;
  }
  return false;
}

// True when every fragment of `quote` appears somewhere in `texts`. An empty
// quote is never grounded — that is the whole point of the check.
export function quoteAppearsIn(quote: string, texts: string[]): boolean {
  const fragments = fragmentsOf(quote ?? '');
  if (fragments.length === 0) return false;
  const haystack = texts.map(normalizeForMatch).join(' ␟ ');
  if (!haystack.trim()) return false;
  return fragments.every((f) => fragmentAppears(f, haystack));
}
