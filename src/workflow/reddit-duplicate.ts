export interface RedditOverlapScore {
  title: string;
  score: number;
}

const REDDIT_DUPLICATE_IGNORED_LABELS = new Set([
  'comment',
  'comments',
  'share',
  'vote',
  'promoted',
  'advertisement',
]);

export const REDDIT_DUPLICATE_TITLE_SELECTORS = [
  'a[id^="post-title-"]',
  'shreddit-post a[id^="post-title-"]',
  'article a[id^="post-title-"]',
  '[data-testid="post-title"]',
  'h1, h2, h3',
];

export function collectUsableRedditTitles(rawTitles: string[]): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];

  for (const rawTitle of rawTitles) {
    const title = rawTitle.trim();
    if (!title) continue;

    const dedupeKey = title.toLowerCase();
    if (REDDIT_DUPLICATE_IGNORED_LABELS.has(dedupeKey)) continue;
    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    titles.push(title);

    if (titles.length >= 50) break;
  }

  return titles;
}

export function normalizeRedditTitle(title: string): string[] {
  const normalized = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return [];

  return Array.from(new Set(normalized.split(' ').map(token => token.trim()).filter(Boolean)));
}

export function scoreRedditTitleJaccard(candidateTitle: string, observedTitle: string): number {
  const candidateTokens = new Set(normalizeRedditTitle(candidateTitle));
  const observedTokens = new Set(normalizeRedditTitle(observedTitle));

  if (candidateTokens.size === 0 && observedTokens.size === 0) {
    return 0;
  }

  let intersectionSize = 0;
  for (const token of candidateTokens) {
    if (observedTokens.has(token)) {
      intersectionSize += 1;
    }
  }

  const unionSize = new Set([...candidateTokens, ...observedTokens]).size;
  if (unionSize === 0) return 0;

  return intersectionSize / unionSize;
}

export function buildRedditOverlapScores(
  candidateTitle: string,
  observedTitles: string[],
): RedditOverlapScore[] {
  return observedTitles.map(title => ({
    title,
    score: Number(scoreRedditTitleJaccard(candidateTitle, title).toFixed(4)),
  }));
}

export function renderRedditDuplicateEvidence(input: {
  extractedTitles: string[];
  overlapScores: RedditOverlapScore[];
}): string {
  const matching = input.overlapScores
    .filter(score => score.score >= 0.7)
    .sort((left, right) => right.score - left.score)[0];
  const result = matching ? 'DUPLICATE_RISK' : 'NO_DUPLICATE_FOUND';

  const lines = [
    `EXTRACTED_TITLES: ${JSON.stringify(input.extractedTitles)}`,
    `OVERLAP_SCORES: ${JSON.stringify(input.overlapScores)}`,
    `DUPLICATE_CHECK_RESULT: ${result}`,
  ];

  if (matching) {
    lines.push(`MATCHING_TITLE: ${matching.title}`);
  }

  return lines.join('\n');
}