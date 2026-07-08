/**
 * AiClient — Unified multi-provider AI client for the Yaksha FAQ Portal.
 *
 * Architecture:
 *  - AiConfig model stores per-feature model selection + settings (admin-configurable)
 *  - AiClient resolves the active provider from AiConfig, falls back to env vars for keys
 *  - aiChat() is the low-level HTTP call — handles Anthropic / OpenAI-compatible / xAI / MiniMax
 *  - Per-feature helpers (summarize, extract, generate) build prompts and parse responses
 *
 * Usage:
 *   const client = new AiClient();
 *   const result = await client.summarize(query, faqResults);
 *   const answer  = await client.answerQuestion(question);
 */

import AiConfig from './ai-config.model.js';
import { generateQueryEmbedding } from '../../utils/ai/embeddings.js';
import { logAiApiSuccess, logAiApiFailure } from '../../utils/ai/apiUsageLog.js';
import { logger } from '../../utils/http/logger.js';

// ─── Provider definitions ───────────────────────────────────────────────────

type AIProvider = 'anthropic' | 'openai' | 'xai' | 'minimax' | 'gemini' | 'custom';

interface ProviderDef {
  label: string;
  baseURL: string;           // base endpoint (without /chat/completions)
  authHeader: string;        // 'Authorization' or 'x-api-key'
  needsAnthropicVersion: boolean;
  modelEnvVar: string;       // env var that overrides the configured model
  keyEnvVar: string;
}

const PROVIDERS: Record<AIProvider, ProviderDef> = {
  anthropic: {
    label: 'Anthropic Claude',
    baseURL: 'https://api.anthropic.com/v1',
    authHeader: 'x-api-key',
    needsAnthropicVersion: true,
    modelEnvVar: 'ANTHROPIC_MODEL',
    keyEnvVar: 'ANTHROPIC_API_KEY',
  },
  openai: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    authHeader: 'Authorization',
    needsAnthropicVersion: false,
    modelEnvVar: 'OPENAI_MODEL',
    keyEnvVar: 'OPENAI_API_KEY',
  },
  xai: {
    label: 'xAI Grok',
    baseURL: 'https://api.x.ai/v1',
    authHeader: 'Authorization',
    needsAnthropicVersion: false,
    modelEnvVar: 'XAI_MODEL',
    keyEnvVar: 'XAI_API_KEY',
  },
  minimax: {
    label: 'MiniMax',
    baseURL: (process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/v1').replace(/\/$/, ''),
    authHeader: 'Authorization',
    needsAnthropicVersion: false,
    modelEnvVar: 'MINIMAX_MODEL',
    keyEnvVar: 'MINIMAX_API_KEY',
  },
  gemini: {
    label: 'Google Gemini',
    baseURL: (process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/$/, ''),
    authHeader: 'Authorization',
    needsAnthropicVersion: false,
    modelEnvVar: 'GEMINI_MODEL',
    keyEnvVar: 'GEMINI_API_KEY',
  },
  custom: {
    label: 'Custom Provider',
    baseURL: (process.env.CUSTOM_BASE_URL ?? 'http://localhost:11434/v1').replace(/\/$/, ''),
    authHeader: 'Authorization',
    needsAnthropicVersion: false,
    modelEnvVar: 'CUSTOM_MODEL',
    keyEnvVar: 'CUSTOM_API_KEY',
  },
};

const PROVIDER_LABELS: Record<AIProvider, string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
  xai: 'xAI Grok',
  minimax: 'MiniMax',
  gemini: 'Google Gemini',
  custom: 'Custom Provider',
};

// ─── Feature types ─────────────────────────────────────────────────────────

export type AIFeature =
  | 'duplicateDetection'
  | 'knowledgeExtraction'
  | 'searchSummarization'
<<<<<<< Updated upstream
  | 'faqGeneration';
=======
  | 'faqGeneration'
  | 'pathwayGeneration'
  | 'gapAnalysis';
>>>>>>> Stashed changes

export interface AIResult {
  content: string;
  provider: AIProvider;
  modelName: string;
  tokensUsed: number;
  estimatedCost: number; // USD
  rawResponse?: unknown;
}

export interface SummarizeOptions {
  query: string;
  faqs: Array<{ question: string; answer: string; _id?: string }>;
  communityPosts?: Array<{ title: string; body?: string; _id?: string }>;
  maxLength?: number;
}

export interface ExtractKnowledgeOptions {
  source: 'transcript' | 'community_post';
  rawText: string;
  context?: string; // e.g. meeting title, post title
}

export interface DetectDuplicatesOptions {
  userQuestion: string;
  candidates: Array<{ _id: string; title: string; source: 'faq' | 'community'; answer?: string }>;
}

export interface DuplicateMatch {
  _id: string;
  score: number;
  reason: string;
}

// ─── Cost constants (approximate per-provider pricing per 1M tokens) ──────────

const COST_PER_MILLION_TOKENS: Record<AIProvider, number> = {
  anthropic: 3.00,    // Claude Sonnet 4
  openai: 0.15,       // GPT-4o Mini
  xai: 5.00,          // Grok 3 (estimate)
  minimax: 0.10,      // MiniMax Text-01
  gemini: 0.075,      // Gemini 1.5 Flash (estimate)
  custom: 0.00,       // Custom (usually self-hosted / free)
};

// ─── AiClient ──────────────────────────────────────────────────────────────

export class AiClient {
  private apiKey: string;
  private provider: AIProvider;
  private modelOverrides: Partial<Record<AIProvider, string>> = {};

  constructor() {
    try {
      this.apiKey = this.loadApiKey();
      this.provider = this.detectProvider();
    } catch (err) {
      this.apiKey = '';
      this.provider = 'minimax';
      logger.warn(`[aiClient] Constructor failed to load API key/detect provider: ${(err as Error).message}. Falling back to minimax.`);
    }
  }

  private loadApiKey(): string {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
    if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY;
    if (process.env.MINIMAX_API_KEY) return process.env.MINIMAX_API_KEY;
    throw new Error(
      'No AI API key configured. Set one of:\n' +
      '  ANTHROPIC_API_KEY — https://console.anthropic.com/settings/keys\n' +
      '  OPENAI_API_KEY   — https://platform.openai.com/api-keys\n' +
      '  XAI_API_KEY      — https://console.x.ai/\n' +
      '  MINIMAX_API_KEY  — https://platform.minimax.io'
    );
  }

  private detectProvider(): AIProvider {
    if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
    if (process.env.OPENAI_API_KEY) return 'openai';
    if (process.env.XAI_API_KEY) return 'xai';
    return 'minimax';
  }

  /**
   * Override the model for a specific provider (from AiConfig settings).
   * Call this after loading AiConfig in the request path.
   */
  setModelOverride(provider: AIProvider, model: string): void {
    this.modelOverrides[provider] = model;
  }

  private getModel(feature: AIFeature, configuredModel?: string): string {
    if (configuredModel) return configuredModel;
    const providerOverride = this.modelOverrides[this.provider];
    if (providerOverride) return providerOverride;
    // Defaults per provider
    const defaults: Record<AIProvider, string> = {
      anthropic: 'claude-sonnet-4-20250514',
      openai: 'gpt-4o-mini',
      xai: 'grok-3',
      minimax: 'MiniMax-Text-01',
      gemini: 'gemini-1.5-flash',
      custom: '',
    };
    return defaults[this.provider];
  }

  private getBaseURL(): string {
    return PROVIDERS[this.provider].baseURL;
  }

  // ─── Low-level chat ────────────────────────────────────────────────────────

  async chat(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    feature: AIFeature,
    overrides?: {
      temperature?: number;
      maxTokens?: number;
      model?: string;
      batchId?: string;
    }
  ): Promise<AIResult> {
    if (process.env.NODE_ENV === 'test') {
      if (feature === 'knowledgeExtraction') {
        return {
          content: JSON.stringify({
            insights: [
              {
                question: 'How do I request an NOC?',
                answer: 'You can request an NOC by submitting the NOC form on the student dashboard.',
                category: 'Administrative',
                tags: ['NOC', 'docs'],
                confidenceScore: 0.9,
                hallucinationFlags: [],
                grammarIssues: [],
              }
            ]
          }),
          provider: 'openai',
          modelName: 'gpt-4o',
          tokensUsed: 100,
          estimatedCost: 0,
        };
      }
      if (feature === 'duplicateDetection') {
        return {
          content: JSON.stringify({ isDuplicate: false, matches: [] }),
          provider: 'openai',
          modelName: 'gpt-4o',
          tokensUsed: 50,
          estimatedCost: 0,
        };
      }
      if (feature === 'faqGeneration') {
        return {
          content: JSON.stringify({
            question: 'Mock Question?',
            answer: 'Mock Answer.',
            category: 'Mock Category',
            tags: ['mock'],
            confidenceScore: 0.95,
            hallucinationFlags: [],
            grammarIssues: [],
          }),
          provider: 'openai',
          modelName: 'gpt-4o',
          tokensUsed: 100,
          estimatedCost: 0,
        };
      }
<<<<<<< Updated upstream
=======
      if (feature === 'pathwayGeneration') {
        return {
          content: JSON.stringify(["mock-id-1", "mock-id-2"]),
          provider: 'openai',
          modelName: 'gpt-4o',
          tokensUsed: 150,
          estimatedCost: 0,
        };
      }
      if (feature === 'gapAnalysis') {
        return {
          content: JSON.stringify({
            gaps: [
              {
                topic: "Mock Gap Topic",
                summary: "Users are asking about mock gaps.",
                frequency: 5,
                suggestedActions: ["Create mock FAQ"]
              }
            ],
            trendingTopics: ["Mocking", "Testing"]
          }),
          provider: 'openai',
          modelName: 'gpt-4o',
          tokensUsed: 250,
          estimatedCost: 0,
        };
      }
>>>>>>> Stashed changes
      return {
        content: 'This is a mock AI response for testing.',
        provider: 'openai',
        modelName: 'gpt-4o',
        tokensUsed: 50,
        estimatedCost: 0,
      };
    }

    const { resolveProviderAsync, getModelForProvider, resolveActiveAiConfig } = await import('../../utils/ai/aiProvider.js');
    const { default: AiConfig } = await import('./ai-config.model.js');

    const batchId = overrides?.batchId ?? null;
    const resolvedOverrides = await resolveActiveAiConfig(batchId);
    let dbConfig = await AiConfig.findOne({ batchId: batchId || null, isActive: true });
    // Fallback to global config if the batch-specific one is not found or is inactive
    if (!dbConfig && batchId) {
      dbConfig = await AiConfig.findOne({ batchId: null, isActive: true });
    }

    const requestedProvider = dbConfig?.activeProvider ?? this.provider;
    const config = await resolveProviderAsync(requestedProvider);

    if (!config.apiKey) {
      throw new Error(`No AI API key configured for provider '${config.provider}'.`);
    }

    const featureConfig = dbConfig?.features?.[feature];
    const rawModel = overrides?.model || featureConfig?.model || config.modelName;
    const model = getModelForProvider(rawModel, config.provider, config.modelName);

    if (!model) {
      throw new Error(`No AI model configured for provider '${config.provider}'. Please configure a model in Admin Settings.`);
    }

    const temperature = overrides?.temperature ?? featureConfig?.temperature ?? 0.3;
    const maxTokens = overrides?.maxTokens ?? featureConfig?.maxTokens ?? 1024;

    const authValue = config.provider === 'anthropic' ? config.apiKey : `Bearer ${config.apiKey}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [config.authHeader]: authValue,
    };
    if (config.needsAnthropicVersion) {
      headers['anthropic-version'] = '2023-06-01';
    }

    // v1.79 — replaced the previous ad-hoc `console.log('--- AI
    // Request Configuration ---')` block (and its companion
    // `logger.warn` on failure) with a single structured audit
    // log via `logAiApiSuccess` / `logAiApiFailure`. Captures
    // provider, model, feature, duration, tokens, and HTTP
    // status uniformly across all three call sites.
    const requestStartedAt = Date.now();

    // v1.80 — per-provider request-body shape. The 5 OpenAI-
    // compatible providers all use `{ model, messages, temperature,
    // max_tokens }`, but the field names and edge cases have
    // diverged across vendors as their APIs evolved. This block
    // constructs the body each provider actually wants, instead
    // of sending the same blob to all of them.
    //
    // Reference: research July 2026.
    //   - OpenAI:     `max_tokens` is DEPRECATED in favour of
    //                 `max_completion_tokens` (o1, o3, GPT-5 ignore
    //                 `max_tokens`). Older models still accept
    //                 `max_tokens`. Send BOTH — `max_completion_tokens`
    //                 is ignored by legacy models, and `max_tokens`
    //                 is still accepted by everything pre-2025.
    //   - MiniMax:    OpenAI-compat shim. Canonical field is
    //                 `max_completion_tokens`; `max_tokens` is
    //                 deprecated for M2/M1/M3.
    //   - Gemini:     OpenAI-compat shim silently DROPS `max_tokens`
    //                 (see router-for-me/CLIProxyAPI#4108). Must
    //                 send `max_completion_tokens`.
    //   - xAI Grok:   Full OpenAI-compat. `max_tokens` is the
    //                 supported field name; no `max_completion_tokens`
    //                 documented. Use the legacy name.
    //   - Anthropic:  Different schema entirely — `system` is a
    //                 TOP-LEVEL field, not a `role:'system'` message.
    //                 (Claude Sonnet 4.8+ accepts mid-conversation
    //                 system messages, but the canonical first-turn
    //                 shape is top-level. Extract and send as `system`.)
    //   - Custom:     Best-effort OpenAI-compat — send `max_tokens`
    //                 (most third-party servers understand it; the
    //                 OpenAI client SDK still emits it by default).
    let body: Record<string, unknown>;
    if (config.provider === 'anthropic') {
      // Extract leading system message(s) into a top-level `system`
      // field. All four current call sites pass exactly one
      // `role:'system'` message as element 0, so a single extract
      // is the common case — but we handle the multi-system case
      // for forward-compat.
      const systemParts: string[] = [];
      const remaining: typeof messages = [];
      for (const m of messages) {
        if (m.role === 'system') systemParts.push(m.content);
        else remaining.push(m);
      }
      body = {
        model,
        max_tokens: maxTokens,
        temperature,
        messages: remaining,
        ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
      };
    } else if (config.provider === 'openai') {
      // Send both — `max_completion_tokens` is the new canonical,
      // `max_tokens` keeps backward compat with pre-2025 models
      // that don't yet understand the new name.
      body = {
        model,
        max_tokens: maxTokens,
        max_completion_tokens: maxTokens,
        temperature,
        messages,
      };
    } else if (config.provider === 'minimax' || config.provider === 'gemini') {
      // Canonical field for both: `max_completion_tokens`.
      body = {
        model,
        max_completion_tokens: maxTokens,
        temperature,
        messages,
      };
    } else {
      // xai + custom — classic OpenAI shape, `max_tokens` is the
      // widely understood name on third-party servers.
      //
      // v1.82 — custom-provider field-name compatibility. Some
      // admins route their `custom` provider through an in-house
      // proxy or third-party gateway that translates OpenAI fields
      // (e.g. snake_case `model`) into that tool's native schema
      // (e.g. camelCase `modelName`), but the upstream (Groq-style)
      // then rejects the non-OpenAI field with `400 property
      // 'modelName' is unsupported`. The field name is resolved
      // from the resolved provider config (`config.customModelField`)
      // — see `resolveCustomModelField()` in aiProvider.ts for the
      // DB → env → default chain. xAI (and the rest) always use
      // the standard `'model'` field.
      const modelField = (
        config.provider === 'custom'
          ? (config.customModelField ?? 'model')
          : 'model'
      );
      body = {
        [modelField]: model,
        max_tokens: maxTokens,
        temperature,
        messages,
      };
    }

    let url: string;
    if (config.provider === 'anthropic') {
      url = `${config.baseURL}/messages`;
    } else {
      url = `${config.baseURL}/chat/completions`;
    }

    // v1.80 — custom-provider baseURL normalisation. Admins
    // often paste a host root like `http://localhost:11434`
    // (Ollama) without the trailing `/v1`, which would make the
    // chat call hit `http://localhost:11434/chat/completions`
    // and 404. If the segment immediately before `/chat/completions`
    // is not literally `v1`, auto-insert. Existing `/v1` is left
    // alone; deeper paths (e.g. `/api/v1/chat/completions`) are
    // also left alone because the segment before `chat` would
    // already be `v1`.
    if (config.provider === 'custom') {
      try {
        const u = new URL(url);
        // For `/chat/completions`, parts is ['chat','completions']
        // and idx === 0. For `/v1/chat/completions`, parts is
        // ['v1','chat','completions'] and idx === 1 with
        // parts[0] === 'v1' (skip). For `/foo/chat/completions`,
        // idx === 1 and parts[0] !== 'v1' (insert).
        const parts = u.pathname.split('/').filter(Boolean);
        const idx = parts.indexOf('chat');
        if (idx >= 0) {
          if (idx === 0) {
            // No segment before `chat` — prepend `v1`.
            parts.unshift('v1');
            u.pathname = '/' + parts.join('/');
            url = u.toString();
          } else if (parts[idx - 1] !== 'v1') {
            // Segment before `chat` exists but isn't `v1` —
            // splice `v1` in front of `chat`.
            parts.splice(idx, 0, 'v1');
            u.pathname = '/' + parts.join('/');
            url = u.toString();
          }
          // else: segment before `chat` IS `v1` — leave it alone.
        }
      } catch {
        // Malformed URL — let the fetch fail naturally with a
        // clear network error rather than masking it.
      }
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network-level failure (DNS, TLS, abort, etc.) — no HTTP status.
      logAiApiFailure({
        kind: 'inference',
        provider: config.provider,
        modelName: model,
        feature,
        durationMs: Date.now() - requestStartedAt,
        batchId,
        error: (err as Error).message,
      });
      throw err;
    }

    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`${config.provider} API error (${res.status}): ${text.slice(0, 300)}`);
      logAiApiFailure({
        kind: 'inference',
        provider: config.provider,
        modelName: model,
        feature,
        durationMs: Date.now() - requestStartedAt,
        batchId,
        error: err.message,
        status: res.status,
        // Persist the outgoing body so admins can debug schema mismatches
        // with custom / proxied providers (e.g. relays that rename `model`
        // → `modelName` and forward to Groq). Cap at 2KB to keep docs small.
        requestBody: body,
      });
      throw err;
    }

    const data = (await res.json()) as Record<string, unknown>;

    // Extract content
    let content = '';
    let tokensUsed = 0;

    if (config.provider === 'anthropic') {
      const usage = (data as any).usage ?? {};
      tokensUsed = ((usage as any).input_tokens ?? 0) + ((usage as any).output_tokens ?? 0);
      content = ((data as any).content ?? [])[0]?.text ?? '';
    } else {
      tokensUsed = (data as any).usage?.total_tokens ?? 0;
      content = (data as any).choices?.[0]?.message?.content ?? '';
    }

    const estimatedCost = (tokensUsed / 1_000_000) * COST_PER_MILLION_TOKENS[config.provider];

    logAiApiSuccess({
      kind: 'inference',
      provider: config.provider,
      modelName: model,
      feature,
      durationMs: Date.now() - requestStartedAt,
      tokensUsed,
      estimatedCostUsd: estimatedCost,
      batchId,
    });

    // Track usage in DB (best effort — don't block on this)
    this.trackUsage(tokensUsed, estimatedCost).catch((err) => {
      logger.warn(`[aiClient] Failed to track usage asynchronously: ${(err as Error).message}`);
    });

    return { content, provider: config.provider, modelName: model, tokensUsed, estimatedCost, rawResponse: data };
  }

  // ─── Usage tracking ───────────────────────────────────────────────────────

  private async trackUsage(tokens: number, cost: number): Promise<void> {
    try {
      const { default: AiConfig } = await import('./ai-config.model.js');
      await AiConfig.findOneAndUpdate(
        { isActive: true },
        {
          $inc: {
            'usage.totalRequests': 1,
            'usage.totalEstimatedCost': cost,
          },
        }
      );
    } catch (err) {
      logger.warn(`[aiClient] trackUsage failed to update AiConfig: ${(err as Error).message}`);
    }
  }

  // ─── Feature: Duplicate detection ─────────────────────────────────────────

  async detectDuplicates(options: DetectDuplicatesOptions): Promise<DuplicateMatch[]> {
    const systemPrompt = `You are an expert at detecting duplicate questions in an internal Q&A system.
Given a user's question and a list of existing questions, determine which (if any) are TRUE duplicates.
Answer ONLY with a valid JSON array. No preamble, no markdown.
Each item must have: "id" (string), "score" (0.0–1.0), "reason" (string, 1 sentence max).
Score guide: 1.0 = identical intent, 0.8-0.99 = same topic, 0.5-0.79 = likely related, <0.5 = not a duplicate.
Output: [{"id": "...", "score": 0.92, "reason": "Both ask about..."}]`;

    const candidateList = options.candidates
      .map((c, i) => `  [${i}] id="${c._id}", source="${c.source}", question="${c.title.replace(/"/g, "'")}"`)
      .join('\n');

    const userContent =
      `User question: "${options.userQuestion.replace(/"/g, "'")}"\n\n` +
      `Candidate questions:\n${candidateList}\n\n` +
      `Respond with a JSON array only.`;

    const result = await this.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      'duplicateDetection',
      { temperature: 0.1, maxTokens: 1024 }
    );

    return parseDuplicateResponse(result.content, options.candidates);
  }

  // ─── Feature: Search summarization ───────────────────────────────────────

  async summarize(options: SummarizeOptions): Promise<string> {
    if (!options.faqs.length && !options.communityPosts?.length) {
      return 'No relevant results found.';
    }

    const faqText = options.faqs
      .map((f, i) => `[${i + 1}] Q: ${f.question}\n   A: ${(f.answer ?? '').slice(0, 300)}`)
      .join('\n\n');

    const postText = (options.communityPosts ?? [])
      .map((p, i) => `[${i + 1}] "${p.title}" — ${(p.body ?? '').slice(0, 200)}`)
      .join('\n');

    const maxLen = options.maxLength ?? 200;
    const truncationNote = maxLen < 300 ? ' (answers truncated for brevity)' : '';

    const systemPrompt = `You are a helpful assistant that summarizes Q&A search results for an internal FAQ portal.
Keep answers concise and direct. If the answer is incomplete, say so.
Summaries should be no longer than ${maxLen} words.`;

    const userContent =
      `User asked: "${options.query.replace(/"/g, "'")}"\n\n` +
      (faqText ? `Relevant FAQs:\n${faqText}\n\n` : '') +
      (postText ? `Relevant community discussions:\n${postText}` : '') +
      `\n\nProvide a concise summary${truncationNote}. If nothing matches, say "No relevant results found."`;

    const result = await this.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      'searchSummarization',
      { temperature: 0.3, maxTokens: 512 }
    );

    return result.content;
  }

  // ─── Feature: Knowledge extraction ───────────────────────────────────────

  /**
   * Extract structured Q&A pairs from raw text (Zoom transcript or community post).
   * Returns an array of { question, answer, confidence } objects.
   */
  async extractKnowledge(options: ExtractKnowledgeOptions): Promise<
    Array<{ question: string; answer: string; confidence: number; source: string }>
  > {
    const sourceLabel = options.source === 'transcript' ? 'Zoom transcript' : 'community post';

    const systemPrompt = `You are an expert at extracting question-and-answer pairs from raw text.
Given a ${sourceLabel}, extract all distinct Q&A pairs that are generally applicable (not overly specific to one person).
Each pair must have: question (what a student would ask), answer (clear and concise).
Return ONLY a valid JSON array of objects with: "question", "answer", "confidence" (0-1).
Do NOT include pairs that are: greetings, jokes, personal anecdotes, or too specific to be useful to others.
Output format: [{"question": "...", "answer": "...", "confidence": 0.9}]`;

    const userContent =
      `Extract Q&A pairs from this ${sourceLabel}${options.context ? ` (context: "${options.context}")` : ''}:\n\n` +
      options.rawText.slice(0, 8000); // token budget safety

    const result = await this.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      'knowledgeExtraction',
      { temperature: 0.2, maxTokens: 2048 }
    );

    return parseKnowledgeResponse(result.content);
  }

  // ─── Feature: FAQ generation ───────────────────────────────────────────────

  /**
   * Generate a draft FAQ from a community post or question.
   * Returns { question, answer, category, confidence }.
   */
  async generateFAQ(
    question: string,
    contextText?: string,
    targetCategory?: string
  ): Promise<{ question: string; answer: string; category: string; confidence: number }> {
    const systemPrompt = `You are an expert FAQ writer for an internship Q&A portal.
Given a question (and optionally a discussion/context), generate a clear, accurate FAQ entry.
Output ONLY a valid JSON object with: "question" (refined), "answer" (clear and complete), "category" (one of: General, Internship, Offer Letter, NOC, Project, Certificate, Team, HR, IT, Other), "confidence" (0-1).
The answer should be direct and actionable. Do not add disclaimers.`;

    const userContent =
      `Question: "${question}"\n` +
      (contextText ? `Context / discussion:\n${contextText.slice(0, 4000)}\n\n` : '') +
      (targetCategory ? `Target category: ${targetCategory}` : '');

    const result = await this.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      'faqGeneration',
      { temperature: 0.4, maxTokens: 1024 }
    );

    return parseFAQResponse(result.content);
  }

<<<<<<< Updated upstream
=======
  // ─── Feature: Pathway generation ─────────────────────────────────────────

  /**
   * Generates a learning pathway (ordered sequence of follow-up FAQs) for a given FAQ.
   * Takes the current FAQ question and a list of candidates.
   * Returns an array of candidate IDs in the suggested logical order.
   */
  async generatePathway(
    currentFaq: { _id: string; question: string; answer?: string },
    candidates: Array<{ _id: string; question: string; answer?: string }>
  ): Promise<string[]> {
    const systemPrompt = `You are an expert curriculum designer for an onboarding and FAQ portal.
Given a current FAQ that a user is reading, and a list of candidate related FAQs, create a logical "Learning Pathway" (a sequence of 2 to 4 follow-up FAQs that the user should read next to deepen their understanding).
The pathway should flow logically (e.g., from basic concepts to advanced configuration to troubleshooting).
Return ONLY a valid JSON array of the recommended FAQ IDs in the correct order.
Output format: ["id1", "id2", "id3"]`;

    const candidateList = candidates
      .filter(c => String(c._id) !== String(currentFaq._id))
      .map((c) => `  - id="${c._id}", question="${c.question.replace(/"/g, "'")}"`)
      .join('\n');

    if (!candidateList) return [];

    const userContent =
      `Current FAQ:\nQuestion: "${currentFaq.question.replace(/"/g, "'")}"\n` +
      (currentFaq.answer ? `Answer snippet: "${currentFaq.answer.slice(0, 200).replace(/"/g, "'")}"\n\n` : '\n') +
      `Candidate FAQs:\n${candidateList}\n\n` +
      `Respond with a JSON array of up to 4 FAQ IDs that form the best logical follow-up sequence.`;

    const result = await this.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      'pathwayGeneration',
      { temperature: 0.2, maxTokens: 256 }
    );

    return parsePathwayResponse(result.content, candidates.map(c => String(c._id)));
  }

  // ─── Feature: Knowledge Gap Analysis ─────────────────────────────────────

  /**
   * Generates a knowledge gap report from a list of unresolved posts and questions.
   */
  async generateKnowledgeGapReport(
    escalatedPosts: Array<{ title: string; body?: string }>,
    aiQuestions: Array<{ question: string }>
  ): Promise<{
    gaps: Array<{ topic: string; summary: string; frequency: number; suggestedActions: string[] }>;
    trendingTopics: string[];
  }> {
    const systemPrompt = `You are a knowledge base analytics engine.
Given a list of community posts that the AI could not confidently answer, and a list of questions recently asked to the AI, identify recurring "knowledge gaps" and "trending topics".
A knowledge gap is a specific topic where users are confused and lack documentation.
Output MUST be a valid JSON object with this exact structure:
{
  "gaps": [
    {
      "topic": "string",
      "summary": "string",
      "frequency": number,
      "suggestedActions": ["string"]
    }
  ],
  "trendingTopics": ["string"]
}`;

    const postsContext = escalatedPosts
      .map((p, i) => `[Escalated Post ${i + 1}] Title: ${p.title}\nBody: ${p.body?.slice(0, 200) || ''}`)
      .join('\n\n');
      
    const qsContext = aiQuestions
      .map((q, i) => `[AI Question ${i + 1}] ${q.question}`)
      .join('\n');

    const userContent = `Analyze the following data from the past week.\n\nEscalated Posts:\n${postsContext || 'None'}\n\nAI Questions:\n${qsContext || 'None'}\n\nIdentify the top knowledge gaps. Return only JSON.`;

    const result = await this.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      'gapAnalysis',
      { temperature: 0.2, maxTokens: 1000 }
    );

    return parseGapAnalysisResponse(result.content);
  }

>>>>>>> Stashed changes
  // ─── Vector pre-filter ─────────────────────────────────────────────────────

  /**
   * Pre-filter candidates by vector similarity, returning topK results.
   * Used to reduce token cost — AI only sees the most relevant candidates.
   */
  async vectorFilter(
    query: string,
    candidates: Array<{ _id: string; text: string; source: 'faq' | 'community' }>,
    topK = 15
  ): Promise<typeof candidates> {
    if (!candidates.length) return candidates;

    try {
      const queryEmb = await generateQueryEmbedding(query);

      if (candidates[0]?.source === 'faq') {
        const { default: FAQ } = await import('../faq/faq.model.js');

        const faqs = await FAQ.find({
          _id: { $in: candidates.filter((c) => c.source === 'faq').map((c) => c._id) },
          embedding: { $exists: true, $ne: null },
        }).select('_id embedding').lean();

        const embMap = new Map(faqs.map((f) => [f._id.toString(), f.embedding as number[]]));

        return candidates
          .map((c) => {
            const emb = embMap.get(c._id);
            if (!emb) return { candidate: c, score: -1 };
            const dot = emb.reduce((s: number, v: number, i: number) => s + v * queryEmb[i], 0);
            return { candidate: c, score: dot };
          })
          .filter((x) => x.score > 0.5)
          .sort((a, b) => b.score - a.score)
          .slice(0, topK)
          .map((x) => x.candidate);
      }

      return candidates.slice(0, topK);
    } catch (err) {
      logger.warn(`[aiClient] Embedding fallback calculation in findDuplicatesByVector failed: ${(err as Error).message}`);
      return candidates.slice(0, topK);
    }
  }
}

// ─── Response parsers ───────────────────────────────────────────────────────

function parseDuplicateResponse(
  raw: string,
  candidates: Array<{ _id: string; title: string; source: 'faq' | 'community' }>
): DuplicateMatch[] {
  const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\[[\s\S]*?\]/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[0]) as unknown[];
    if (!Array.isArray(parsed)) return [];

    const results: DuplicateMatch[] = [];
    for (const item of parsed) {
      const i = item as Record<string, unknown>;
      const id = String(i.id ?? '');
      const score = Math.max(0, Math.min(1, Number(i.score) || 0));
      const reason = String(i.reason ?? '').slice(0, 200);
      if (score < 0.50) continue;
      if (!candidates.find((c) => c._id === id)) continue;
      results.push({ _id: id, score, reason });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 5);
  } catch (err) {
    logger.warn(`[aiClient] Failed to parse duplicate response JSON: ${(err as Error).message}. Raw response: ${raw.slice(0, 300)}`);
    return [];
  }
}

function parseKnowledgeResponse(
  raw: string
): Array<{ question: string; answer: string; confidence: number; source: string }> {
  const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\[[\s\S]*?\]/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[0]) as unknown[];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        const i = item as Record<string, unknown>;
        return {
          question: String(i.question ?? '').trim(),
          answer: String(i.answer ?? '').trim(),
          confidence: Math.max(0, Math.min(1, Number(i.confidence ?? 0))),
          source: 'ai_extracted',
        };
      })
      .filter((x) => x.question.length > 10 && x.answer.length > 10);
  } catch (err) {
    logger.warn(`[aiClient] Failed to parse knowledge extraction response JSON: ${(err as Error).message}. Raw response: ${raw.slice(0, 300)}`);
    return [];
  }
}

function parseFAQResponse(
  raw: string
): { question: string; answer: string; category: string; confidence: number } {
  const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return { question: '', answer: '', category: 'General', confidence: 0 };

  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      question: String(parsed.question ?? '').trim(),
      answer: String(parsed.answer ?? '').trim(),
      category: String(parsed.category ?? 'General').trim(),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
    };
  } catch (err) {
    logger.warn(`[aiClient] Failed to parse FAQ generation response JSON: ${(err as Error).message}. Raw response: ${raw.slice(0, 300)}`);
    return { question: '', answer: '', category: 'General', confidence: 0 };
  }
}

<<<<<<< Updated upstream
=======
function parsePathwayResponse(raw: string, validIds: string[]): string[] {
  const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(id => String(id))
      .filter(id => validIds.includes(id))
      .slice(0, 4);
  } catch (err) {
    logger.warn(`[aiClient] Failed to parse pathway JSON: ${(err as Error).message}`);
    return [];
  }
}

function parseGapAnalysisResponse(raw: string): {
  gaps: Array<{ topic: string; summary: string; frequency: number; suggestedActions: string[] }>;
  trendingTopics: string[];
} {
  const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  const defaultResult = { gaps: [], trendingTopics: [] };
  if (!match) return defaultResult;
  try {
    const parsed = JSON.parse(match[0]) as any;
    return {
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps.map((g: any) => ({
        topic: String(g.topic || 'Unknown'),
        summary: String(g.summary || ''),
        frequency: Number(g.frequency || 1),
        suggestedActions: Array.isArray(g.suggestedActions) ? g.suggestedActions.map(String) : [],
      })) : [],
      trendingTopics: Array.isArray(parsed.trendingTopics) ? parsed.trendingTopics.map(String) : [],
    };
  } catch (err) {
    logger.warn(`[aiClient] Failed to parse gap analysis JSON: ${(err as Error).message}`);
    return defaultResult;
  }
}

>>>>>>> Stashed changes
// ─── Default export ─────────────────────────────────────────────────────────

export default AiClient;