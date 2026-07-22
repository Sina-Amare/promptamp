import { storage } from '#imports';
import { PROVIDERS } from '../providers/registry';
import {
  type Connection,
  type ProviderCred,
  type ProviderId,
  connectionSchema,
  providerCredSchema,
} from './schemas';

// Re-exported so existing callers keep one import site; the implementation
// lives in a storage-free module so the error layer can use it anywhere.
export { redactKeys } from '../redact';

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
 *
 * The value is an **ordered list**. Order is the fallback order — first entry
 * is what runs, later entries take over when it cannot (see `lib/enhance/
 * chain.ts` for exactly which failures hand over and which do not).
 */

/**
 * v1 stored one credential per provider, keyed by provider id, with a separate
 * `settings.activeProviderId` naming the one in use. v2 is an ordered list, so
 * several credentials can coexist per provider and the order means something.
 *
 * Oldest-added first: it is the order the user built them in, and it puts
 * whichever key they set up first at the head of the chain.
 *
 * Exported for the test — a migration that silently returns `[]` would delete
 * every key the user has, which is not a thing to find out in production.
 */
export function migrateCredentialsV1toV2(old: unknown): Connection[] {
  if (!old || typeof old !== 'object' || Array.isArray(old)) return [];
  return Object.entries(old as Record<string, unknown>)
    .flatMap(([providerId, value]) => {
      const parsed = providerCredSchema.safeParse(value);
      if (!parsed.success) return [];
      return [{ providerId: providerId as ProviderId, ...parsed.data }];
    })
    .sort((a, b) => a.addedAt - b.addedAt)
    .map((entry) => ({
      ...entry,
      id: `${entry.providerId}-${String(entry.addedAt)}`,
      label: PROVIDERS[entry.providerId]?.label ?? entry.providerId,
    }));
}

const connectionsItem = storage.defineItem<Connection[]>('local:credentials', {
  fallback: [],
  version: 2,
  migrations: { 2: migrateCredentialsV1toV2 },
});

/** Drops anything that no longer parses rather than failing the whole read. */
export async function listConnections(): Promise<Connection[]> {
  const raw = await connectionsItem.getValue();
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = connectionSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function getConnection(id: string): Promise<Connection | null> {
  return (await listConnections()).find((c) => c.id === id) ?? null;
}

/**
 * Upsert by id. An omitted `apiKey` on an existing connection **keeps** the
 * stored one — the options page never receives a key back, so it cannot resend
 * one, and a blank field there must not silently wipe a working credential.
 */
export async function saveConnection(
  input: Omit<Connection, 'addedAt' | 'authMethod'> &
    Partial<Pick<Connection, 'addedAt' | 'authMethod'>>,
): Promise<Connection[]> {
  const all = await listConnections();
  const existing = all.find((c) => c.id === input.id);

  const merged = connectionSchema.parse({
    ...existing,
    ...input,
    apiKey: input.apiKey ?? existing?.apiKey,
    // A PKCE-connected credential must not silently become "manual" because a
    // later save omitted the field.
    authMethod: input.authMethod ?? existing?.authMethod ?? 'manual',
    addedAt: existing?.addedAt ?? input.addedAt ?? Date.now(),
  });

  const next = existing
    ? all.map((c) => (c.id === merged.id ? merged : c))
    : [...all, merged];

  await connectionsItem.setValue(next);
  return next;
}

export async function deleteConnection(id: string): Promise<Connection[]> {
  const next = (await listConnections()).filter((c) => c.id !== id);
  await connectionsItem.setValue(next);
  return next;
}

/**
 * Reorder by id — this is the fallback chain, so it is a first-class action
 * rather than a hidden consequence of when things were added. Ids the caller
 * omits keep their relative order at the end, so a stale list from a UI that
 * raced a save cannot delete a connection.
 */
export async function reorderConnections(ids: string[]): Promise<Connection[]> {
  const all = await listConnections();
  const ranked = new Map(ids.map((id, index) => [id, index]));
  const next = [...all].sort(
    (a, b) =>
      (ranked.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (ranked.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
  await connectionsItem.setValue(next);
  return next;
}

/**
 * Safe to send to a UI: everything about a connection except the key itself.
 * The options page renders entirely from this, which is what lets it show
 * "key saved" without the value ever leaving the worker.
 */
export async function publicConnections(): Promise<
  {
    id: string;
    providerId: ProviderId;
    label: string;
    model: string;
    authMethod: 'manual' | 'oauth';
    hasKey: boolean;
    baseUrl?: string;
  }[]
> {
  return (await listConnections()).map((c) => ({
    id: c.id,
    providerId: c.providerId,
    label: c.label,
    model: c.model,
    authMethod: c.authMethod,
    // The *fact* of a key, never the key.
    hasKey: c.apiKey !== undefined,
    ...(c.baseUrl === undefined ? {} : { baseUrl: c.baseUrl }),
  }));
}

/** The adapters take a `ProviderCred`; a `Connection` already is one. */
export function credOf(connection: Connection): ProviderCred {
  return connection;
}
