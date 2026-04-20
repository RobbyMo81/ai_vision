/**
 * Gemini-powered social content writer.
 *
 * Uses Google Gemini to draft platform-appropriate post content so that
 * Claude tokens are reserved exclusively for browser automation work.
 * Gemini's distinct generation style also reduces AI-pattern tells that
 * Claude-authored copy tends to produce.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

export type Platform = 'x' | 'reddit' | 'linkedin';
export type Tone = 'factual' | 'conversational' | 'professional' | 'direct';

export interface WritePostOptions {
  platform: Platform;
  topic: string;
  context?: string;
  tone?: Tone;
  /** Reddit only — also generate a post title */
  includeTitle?: boolean;
}

export interface GeneratedPost {
  text: string;
  /** Populated when includeTitle is true (Reddit) */
  title?: string;
  platform: Platform;
  model: string;
}

// ---------------------------------------------------------------------------
// Platform-specific system prompts
// ---------------------------------------------------------------------------

const SYSTEM_BASE = `You write social media posts for a human author.
Your job is to produce copy that reads like a person wrote it — not an AI assistant.

Avoid:
- Corporate buzzwords ("leverage", "synergy", "cutting-edge", "game-changer")
- AI assistant tells ("delve into", "it's worth noting", "I'd be happy to", "certainly", "fascinating")
- Filler phrases ("In today's world", "In conclusion", "As an AI")
- Excessive exclamation points or emoji
- Rhetorical questions as openers
- Passive voice where active is natural
- Vague summaries — use specific details, numbers, or observations instead

Write in first person, past or present tense. Sound like someone who actually did the thing.`;

const PLATFORM_RULES: Record<Platform, string> = {
  x: `Platform: X (formerly Twitter)
Hard limit: 280 characters. Every word must earn its place.
Style: punchy, specific, direct. One clear idea per post.
No hashtag spam — zero or one hashtag max, only if it genuinely fits.
Do not start with "I just" or "Just".
Return ONLY the post text. No labels, no quotes around it.`,

  reddit: `Platform: Reddit
Style: conversational, informative, first-person. Sounds like a forum post from someone who built something and wants to share it honestly.
Lead with what you made or did — not why it matters.
Include specific technical details. Invite questions naturally at the end.
Use markdown sparingly (bold for key terms, bullet lists for features).
Return the body text only. No title. No markdown code fences around the response.`,

  linkedin: `Platform: LinkedIn
Style: professional but human. Not a press release.
No engagement bait ("What do you think? Drop a comment!").
Specific details over vague claims.
Three to five short paragraphs max.
Return ONLY the post text.`,
};

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/** Ordered list of models to try — first available wins. */
const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-001',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
];

export class GeminiWriter {
  private client: GoogleGenerativeAI;
  private preferredModel: string;

  constructor(apiKey?: string, model?: string) {
    const key = apiKey ?? process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        'Gemini API key required. Set GEMINI_API_KEY in .env or pass it explicitly.',
      );
    }
    this.client = new GoogleGenerativeAI(key);
    this.preferredModel = model ?? process.env.GEMINI_MODEL ?? FALLBACK_MODELS[0];
  }

  async writePost(opts: WritePostOptions): Promise<GeneratedPost> {
    const { platform, topic, context, tone = 'conversational', includeTitle = false } = opts;

    const systemPrompt = [SYSTEM_BASE, PLATFORM_RULES[platform]].join('\n\n');
    const userPrompt = buildUserPrompt({ platform, topic, context, tone, includeTitle });

    // Try preferred model first, then work through fallbacks on quota errors
    const modelsToTry = [
      this.preferredModel,
      ...FALLBACK_MODELS.filter(m => m !== this.preferredModel),
    ];

    let lastError: Error | null = null;
    for (const modelName of modelsToTry) {
      try {
        const model = this.client.getGenerativeModel({
          model: modelName,
          systemInstruction: systemPrompt,
        });
        const result = await model.generateContent(userPrompt);
        const raw = result.response.text().trim();

        if (includeTitle && platform === 'reddit') {
          return parseRedditResponse(raw, modelName);
        }
        return { text: raw, platform, model: modelName };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isQuota = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
        const isDeprecated = msg.includes('404') || msg.includes('no longer available') || msg.includes('not found');
        if (!isQuota && !isDeprecated) throw e; // only retry on quota/availability errors
        lastError = e instanceof Error ? e : new Error(msg);
        console.error(`[gemini-writer] Quota exhausted for ${modelName}, trying next model...`);
      }
    }

    throw new Error(
      `All Gemini models exhausted quota. Enable billing at https://aistudio.google.com to increase limits.\n` +
      `Last error: ${lastError?.message ?? 'unknown'}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUserPrompt(opts: WritePostOptions & { includeTitle: boolean }): string {
  const { platform, topic, context, tone, includeTitle } = opts;

  const toneNote: Record<Tone, string> = {
    factual: 'Tone: stick to documented facts. No opinions or predictions.',
    conversational: 'Tone: casual and direct, like talking to a peer.',
    professional: 'Tone: professional but approachable. Not stiff.',
    direct: 'Tone: short, blunt, zero fluff.',
  };

  const lines = [
    `Write a ${platform} post about: ${topic}`,
    context ? `Background context: ${context}` : '',
    toneNote[tone ?? 'conversational'],
  ];

  if (includeTitle && platform === 'reddit') {
    lines.push(
      'Also write a Reddit post title (one sentence, under 200 characters, no clickbait).',
      'Format your response as:',
      'TITLE: <title here>',
      'BODY: <body text here>',
    );
  }

  return lines.filter(Boolean).join('\n');
}

function parseRedditResponse(raw: string, model: string): GeneratedPost {
  const titleMatch = raw.match(/^TITLE:\s*(.+?)(?:\n|$)/im);
  const bodyMatch = raw.match(/^BODY:\s*([\s\S]+)/im);

  if (titleMatch && bodyMatch) {
    return {
      title: titleMatch[1].trim(),
      text: bodyMatch[1].trim(),
      platform: 'reddit',
      model,
    };
  }

  // Fallback: treat entire response as body text
  return { text: raw, platform: 'reddit', model };
}

/** Singleton — lazy-initialized on first use. */
let _writer: GeminiWriter | null = null;
export function getGeminiWriter(): GeminiWriter {
  if (!_writer) _writer = new GeminiWriter();
  return _writer;
}
