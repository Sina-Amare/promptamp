import { describe, expect, it } from 'vitest';
import {
  parseGeminiModels,
  parseModels,
  type RawModel,
} from '../lib/providers';

/**
 * The model list is filtered to text models (it is a prompt editor) and split
 * free/paid where the provider reports pricing. The fetch itself is network, so
 * only the pure parse is unit-tested.
 */

describe('parseModels', () => {
  it('keeps text models and drops image/audio/embedding/moderation', () => {
    // No modality info → the id heuristic decides (OpenAI/Groq/Gemini shape).
    const raw: RawModel[] = [
      { id: 'gpt-4o-mini' },
      { id: 'o3' },
      { id: 'text-embedding-3-large' },
      { id: 'whisper-1' },
      { id: 'tts-1' },
      { id: 'dall-e-3' },
      { id: 'gpt-image-1' },
      { id: 'omni-moderation-latest' },
      { id: 'llama-guard-4-12b' },
      { id: 'text-embedding-004' },
      { id: 'imagen-3.0' },
    ];
    expect(parseModels(raw).map((m) => m.id)).toEqual(['gpt-4o-mini', 'o3']);
  });

  it('trusts reported output modalities over the id heuristic', () => {
    // A model whose id contains "image" but which outputs text is kept; one
    // that only outputs images is dropped.
    const raw: RawModel[] = [
      {
        id: 'vendor/sees-images',
        architecture: { output_modalities: ['text'] },
      },
      {
        id: 'vendor/makes-pictures',
        architecture: { output_modalities: ['image'] },
      },
    ];
    expect(parseModels(raw).map((m) => m.id)).toEqual(['vendor/sees-images']);
  });

  it('marks a model free only when both prompt and completion are zero', () => {
    const raw: RawModel[] = [
      { id: 'a/free', pricing: { prompt: '0', completion: '0' } },
      {
        id: 'b/paid',
        pricing: { prompt: '0.0000012', completion: '0.000002' },
      },
      { id: 'c/half', pricing: { prompt: '0', completion: '0.000001' } },
    ];
    const byId = Object.fromEntries(
      parseModels(raw).map((m) => [m.id, m.free]),
    );
    expect(byId['a/free']).toBe(true);
    expect(byId['b/paid']).toBe(false);
    expect(byId['c/half']).toBe(false);
  });

  it('leaves free undefined when no pricing is reported', () => {
    expect(parseModels([{ id: 'anthropic/claude' }])[0]?.free).toBeUndefined();
  });

  it('sorts by id and ignores entries without a string id', () => {
    const raw: RawModel[] = [{ id: 'zeta' }, { id: 42 }, { id: 'alpha' }];
    expect(parseModels(raw).map((m) => m.id)).toEqual(['alpha', 'zeta']);
  });
});

describe('parseGeminiModels', () => {
  it('keeps chat models, strips the models/ prefix, drops the rest', () => {
    // Gemini's native shape: only generateContent models are chat models;
    // embeddings, imagen, and veo are not, and are filtered out.
    const body = {
      models: [
        {
          name: 'models/gemini-2.0-flash',
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
        {
          name: 'models/text-embedding-004',
          supportedGenerationMethods: ['embedContent'],
        },
        {
          name: 'models/imagen-3.0-generate-002',
          supportedGenerationMethods: ['predict'],
        },
        {
          name: 'models/gemini-1.5-pro',
          supportedGenerationMethods: ['generateContent'],
        },
      ],
    };
    expect(parseGeminiModels(body).map((m) => m.id)).toEqual([
      'gemini-1.5-pro',
      'gemini-2.0-flash',
    ]);
  });

  it('is empty for a missing or empty list', () => {
    expect(parseGeminiModels({})).toEqual([]);
    expect(parseGeminiModels({ models: [] })).toEqual([]);
  });
});
