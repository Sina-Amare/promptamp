import { z } from 'zod';

/**
 * Every shape that touches storage is defined here, once, as a zod schema.
 *
 * Two things read from outside our control — `chrome.storage` (which a previous
 * version, a sync conflict, or a corrupted profile can leave in any state) and
 * user-supplied profile-import JSON. Both go through `.safeParse` before use, so
 * a bad value degrades to the default instead of throwing somewhere deep in the
 * worker.
 */

/** Providers the worker knows how to talk to. `mock` never leaves the machine. */
export const providerIdSchema = z.enum([
  'openai',
  'anthropic',
  'groq',
  'openrouter',
  'gemini',
  'ollama',
  'lmstudio',
  /**
   * Any OpenAI-compatible endpoint the user points us at: Together,
   * Fireworks, DeepSeek, Mistral, xAI, Cerebras, Azure OpenAI, a self-hosted
   * vLLM, or a LiteLLM proxy they run themselves.
   *
   * This is why there is no abstraction layer here. The category converged on
   * one wire format, so "support everything" is a base-URL field rather than a
   * dependency.
   */
  'custom',
  'mock',
]);
export type ProviderId = z.infer<typeof providerIdSchema>;

/** Drives the 6 px dot on the button (UX-SPEC §1.6) and the auto-profile map. */
export const profileCategorySchema = z.enum([
  'chat',
  'image',
  'video',
  'coding',
  'learning',
  'writing',
]);
export type ProfileCategory = z.infer<typeof profileCategorySchema>;

/**
 * Image and video generators are trained overwhelmingly on English captions, so
 * those two profiles translate; everything else answers in the draft's language.
 */
export const outputLanguageRuleSchema = z.enum([
  'same-language',
  'english-default',
]);
export type OutputLanguageRule = z.infer<typeof outputLanguageRuleSchema>;

/** The corner ladder from UX-SPEC §1.2, plus the outside-the-field fallback. */
export const buttonCornerSchema = z.enum([
  'bottom-end',
  'bottom-start',
  'top-end',
  'top-start',
  'outside-below',
]);
export type ButtonCorner = z.infer<typeof buttonCornerSchema>;

export const providerCredSchema = z.object({
  /**
   * Absent for local runners (Ollama / LM Studio), which have no auth. Never
   * logged, never sent anywhere but the provider's own host.
   */
  apiKey: z.string().min(1).optional(),
  /**
   * May be empty. A user-supplied endpoint has no default worth guessing, so
   * "added but not yet configured" is a real state the UI has to be able to
   * hold — the request path rejects it with a `bad-model` error that says
   * exactly what to do.
   */
  model: z.string().max(200).default(''),
  /** Only local runners may override this; remote hosts come from the registry. */
  baseUrl: z.url().optional(),
  /** OpenRouter can be connected via PKCE instead of a pasted key. */
  authMethod: z.enum(['manual', 'oauth']).default('manual'),
  addedAt: z.number().int().nonnegative(),
});
export type ProviderCred = z.infer<typeof providerCredSchema>;

/**
 * One saved credential: a provider, a key, and a model.
 *
 * A *list* of these rather than one-per-provider, because "which model" is as
 * much a choice as "which provider" — a user may want Groq's 70B for speed and
 * a Claude key for hard drafts, or a free key and a paid key at the same
 * provider. The list order is the fallback order, so the model is one concept,
 * not two.
 *
 * Structurally a superset of `ProviderCred`, so it passes straight to an
 * adapter with no mapping layer.
 */
export const connectionSchema = providerCredSchema.extend({
  id: z.string().min(1).max(64),
  providerId: providerIdSchema,
  /** What distinguishes two connections to the same provider, in the user's words. */
  label: z.string().min(1).max(48),
});
export type Connection = z.infer<typeof connectionSchema>;

export const profileSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  description: z.string().max(200),
  category: profileCategorySchema,
  /** Cap exists so an imported profile cannot blow up the request body. */
  systemPrompt: z.string().min(1).max(20_000),
  outputLanguage: outputLanguageRuleSchema,
  /** Built-ins live in code and are never persisted; a fork is a new profile. */
  builtIn: z.boolean().default(false),
});
export type Profile = z.infer<typeof profileSchema>;

export const siteRuleSchema = z.object({
  /** "Hide on this site" (UX-SPEC §1.5). Checked *before* any DOM injection. */
  hidden: z.boolean().default(false),
  /** Set by "On this site, use…" — drops the `auto` suffix on the chip. */
  pinnedProfileId: z.string().max(64).nullable().default(null),
  /** Where the user dragged the button. Only snapped corners persist. */
  buttonCorner: buttonCornerSchema.nullable().default(null),
});
export type SiteRule = z.infer<typeof siteRuleSchema>;

export const settingsSchema = z.object({
  defaultProfileId: z.string().min(1).max(64).default('general'),
  /** When false the user always gets `defaultProfileId`, never the site map. */
  autoProfile: z.boolean().default(true),
  /** "Hide everywhere" — the global off switch, re-enabled from the popup. */
  globallyHidden: z.boolean().default(false),
  /** Epoch ms. The popup's "Pause on all sites for 1 hour" for screen shares. */
  pausedUntil: z.number().int().nonnegative().nullable().default(null),
  /** Gates the one-time first-run callout (UX-SPEC §4) — global, not per-site. */
  firstRunDone: z.boolean().default(false),
  /** Requests per day before we ask for confirmation. 0 disables the cap. */
  softCapPerDay: z.number().int().min(0).max(10_000).default(100),
  historyEnabled: z.boolean().default(true),
  historyLimit: z.number().int().min(0).max(1000).default(200),
  /**
   * Language the *rewrite* is written in, independent of the draft's language —
   * so a Persian draft can produce an English prompt. Empty means each profile
   * keeps its own rule (`outputLanguage` above: mirror the draft, or English
   * for image/video). Free text, because "Brazilian Portuguese" and "formal
   * Japanese" are things people legitimately want and a fixed list is not.
   */
  outputLanguageOverride: z.string().max(40).default(''),
});
export type Settings = z.infer<typeof settingsSchema>;

export const historyEntrySchema = z.object({
  id: z.string().min(1),
  at: z.number().int().nonnegative(),
  origin: z.string(),
  profileId: z.string(),
  providerId: providerIdSchema,
  model: z.string(),
  original: z.string(),
  enhanced: z.string(),
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const softCapCounterSchema = z.object({
  /** Local calendar day, `YYYY-MM-DD`. Rolls over by string comparison. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.number().int().nonnegative(),
});
export type SoftCapCounter = z.infer<typeof softCapCounterSchema>;

/** Shape accepted by the options page's profile import (Phase 7). */
export const profileImportSchema = z.object({
  version: z.literal(1),
  profiles: z.array(profileSchema).max(100),
});
export type ProfileImport = z.infer<typeof profileImportSchema>;

/**
 * Parse a stored value, falling back to the schema's own defaults when storage
 * holds something unusable. Corrupted storage must never take the worker down —
 * principle 8 says the user's draft survives any failure, and that starts with
 * not throwing here.
 */
export function parseOrDefault<T>(
  schema: z.ZodType<T>,
  value: unknown,
  fallback: T,
): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}
