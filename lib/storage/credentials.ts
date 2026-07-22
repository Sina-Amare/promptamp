import { storage } from '#imports';
import {
  type ProviderCred,
  type ProviderId,
  providerCredSchema,
} from './schemas';

/**
 * API keys. **Background worker only.**
 *
 * Nothing in `entrypoints/content*` may import this module — ESLint enforces
 * that with a `no-restricted-imports` rule, because "we'll remember" is not a
 * security control. A content script runs in a page the user did not write; if
 * a key is never in its heap it cannot be exfiltrated from there, no matter
 * what the page does.
 *
 * `storage.local`, never `storage.sync`: sync replicates through the browser
 * vendor's servers, which would silently break the "your key never leaves your
 * machine except to reach your provider" promise.
 */

const credentialsItem = storage.defineItem<Record<string, ProviderCred>>(
  'local:credentials',
  { fallback: {}, version: 1 },
);

export async function getCredential(
  providerId: ProviderId,
): Promise<ProviderCred | null> {
  const all = await credentialsItem.getValue();
  const parsed = providerCredSchema.safeParse(all?.[providerId]);
  return parsed.success ? parsed.data : null;
}

export async function setCredential(
  providerId: ProviderId,
  cred: ProviderCred,
): Promise<void> {
  const all = (await credentialsItem.getValue()) ?? {};
  await credentialsItem.setValue({
    ...all,
    [providerId]: providerCredSchema.parse(cred),
  });
}

export async function deleteCredential(providerId: ProviderId): Promise<void> {
  const all = (await credentialsItem.getValue()) ?? {};
  if (!(providerId in all)) return;
  const { [providerId]: _removed, ...rest } = all;
  await credentialsItem.setValue(rest);
}

/**
 * Which providers are configured — safe to send to the UI, since it carries no
 * key material. The options page renders its cards from this.
 */
export async function listConfiguredProviders(): Promise<
  { providerId: ProviderId; model: string; authMethod: 'manual' | 'oauth' }[]
> {
  const all = (await credentialsItem.getValue()) ?? {};
  return Object.entries(all).flatMap(([id, cred]) => {
    const parsed = providerCredSchema.safeParse(cred);
    if (!parsed.success) return [];
    return [
      {
        providerId: id as ProviderId,
        model: parsed.data.model,
        authMethod: parsed.data.authMethod,
      },
    ];
  });
}

/**
 * Redact anything key-shaped before it reaches a log, an error message, or the
 * UI. Provider keys are long, high-entropy, and often prefixed (`sk-`, `gsk_`,
 * `sk-or-v1-`); a stack trace that echoes a request header would otherwise leak
 * one into a bug report the user pastes in public.
 */
export function redactKeys(text: string): string {
  return text
    .replace(
      /\b(sk-or-v1-|sk-ant-|sk-|gsk_|AIza)[A-Za-z0-9_-]{8,}/g,
      '$1[redacted]',
    )
    .replace(/\b[Bb]earer\s+[A-Za-z0-9._-]{16,}/g, 'Bearer [redacted]');
}
