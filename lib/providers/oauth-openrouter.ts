import { browser } from '#imports';
import { errorFor, ProviderError } from './errors';

/**
 * OpenRouter's PKCE flow — the one provider that lets a user connect without
 * pasting a key at all.
 *
 * PKCE with S256 specifically: the code verifier never leaves this extension,
 * and the authorization server only ever sees its SHA-256 hash. There is no
 * client secret to embed, which matters because anything shipped in an
 * extension bundle is public by definition.
 *
 * The manual key path always remains available — if this page ever changes
 * shape, the user is not locked out.
 */

const AUTH_URL = 'https://openrouter.ai/auth';
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';

/** URL-safe base64 without padding, per RFC 7636. */
function base64UrlEncode(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function createVerifier(): string {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes.buffer);
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return base64UrlEncode(digest);
}

/**
 * Runs the full flow and returns the issued key.
 *
 * `launchWebAuthFlow` opens the consent page in a browser-controlled window
 * and hands back the redirect — the extension never sees the user's OpenRouter
 * password, and no content script is involved at any point.
 */
export async function connectOpenRouter(): Promise<string> {
  const verifier = createVerifier();
  const challenge = await challengeFor(verifier);
  const redirectUri = browser.identity.getRedirectURL();

  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set('callback_url', redirectUri);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  let redirect: string | undefined;
  try {
    redirect = await browser.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true,
    });
  } catch {
    // The user closed the window, or the browser blocked it.
    throw errorFor('bad-key', 'The OpenRouter connection was cancelled.');
  }

  if (!redirect) throw errorFor('bad-key', 'No response from OpenRouter.');

  const code = new URL(redirect).searchParams.get('code');
  if (!code) throw errorFor('bad-key', 'OpenRouter did not return a code.');

  const response = await fetch(EXCHANGE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      code_challenge_method: 'S256',
    }),
  });

  if (!response.ok) {
    throw new ProviderError(
      'bad-key',
      `OpenRouter rejected the exchange (HTTP ${String(response.status)}).`,
    );
  }

  const body = (await response.json()) as { key?: string };
  if (!body.key) throw errorFor('bad-key', 'OpenRouter returned no key.');

  return body.key;
}
