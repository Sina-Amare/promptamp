<div align="center">

<img src="public/icon/icon-128.png" width="88" height="88" alt="">

# PromptAmp

**The prompt amplifier — your keys, any site.**

Turn a rough draft into an engineered prompt with one tap, in any text field on any website.

`🚧 Pre-release — v0.1.0, not yet in the stores`

[Install](#install) · [Providers](#providers) · [Privacy](#privacy) · [FAQ](#faq)

</div>

---

## What it does

You type a rough draft into ChatGPT, Midjourney, a code assistant, anywhere. A
small button appears in the corner of the field. Press it, and PromptAmp
rewrites your draft into a better prompt using **your own API key**, shows you
the result next to the original, and replaces your text only when you accept.

Nothing is sent anywhere except the provider you chose. There is no PromptAmp
server to send it to.

## Why it's different

- **BYOK — bring your own key.** Your key is stored in this browser's local
  extension storage and read only by the background worker. The script running
  on web pages can never see it; a lint rule fails the build if that ever
  changes.
- **Any field on any site**, not a whitelist of chat apps. Plain inputs, rich
  editors, Monaco, CodeMirror, ProseMirror, Quill, Slate — with a five-tier
  insertion ladder that verifies the text actually landed and rolls back if it
  did not.
- **Your draft is never touched until you accept.** Not on error, not on
  timeout, not if the model refuses. If insertion fails halfway, the field is
  restored from a snapshot.
- **Domain-aware profiles.** An image prompt is not a code prompt is not a study
  prompt. Seven built-in profiles, all forkable.
- **No servers, no telemetry, no accounts, no analytics.** Ever. The code is
  public precisely so you can check.

## Install

Not yet in the Chrome Web Store or on AMO. Until then, load it unpacked:

```bash
git clone https://github.com/Sina-Amare/promptamp
cd promptamp
pnpm install
pnpm build
```

**Chrome / Edge** — visit `chrome://extensions`, turn on Developer mode, choose
*Load unpacked*, and select `.output/chrome-mv3`.

**Firefox** — visit `about:debugging#/runtime/this-firefox`, choose *Load
Temporary Add-on*, and select any file inside `.output/firefox-mv3`.

Then open the extension's settings and add a connection.

## Providers

Any of these, and several at once — the list order is a fallback chain, so when
one is rate-limited or out of credit the next takes over automatically.

| Provider | Notes |
| --- | --- |
| OpenAI | Paste a key from the API dashboard |
| Anthropic | Paste a key from the console |
| Google Gemini | Free-tier content may be used to improve Google's models — the settings page says so before you paste a key |
| Groq | Fast and has a free tier; a good first choice |
| OpenRouter | One-click sign-in via PKCE — PromptAmp never sees your password |
| Ollama | Local. Needs `OLLAMA_ORIGINS="chrome-extension://*"` |
| LM Studio | Local. Enable its server and allow cross-origin requests |
| **Custom (OpenAI-compatible)** | Anything speaking the OpenAI chat-completions format: Together, Fireworks, DeepSeek, Mistral, xAI, Cerebras, Azure OpenAI, a self-hosted vLLM, or your own LiteLLM proxy |

The custom option is why there is no provider abstraction layer here — the
category converged on one wire format, so "support everything" is a base-URL
field rather than a dependency.

## Privacy

- **No backend.** There is no PromptAmp server. Requests go from your browser
  straight to your provider.
- **No telemetry, no analytics, no accounts.** Nothing is counted, sampled, or
  phoned home.
- **Keys live in `storage.local`**, never `storage.sync` — syncing would
  replicate them through your browser vendor's servers.
- **History is local** and can be cleared or disabled at any time.
- **Host permissions are narrow**: a fixed list of provider API hosts, and for a
  custom endpoint, permission for that one host requested on the click that
  saves it.

Full policy: [`site/privacy.html`](site/privacy.html).

## FAQ

**Does it work while I'm logged in to a site?**
Yes. PromptAmp only reads the field you focus and only writes to it when you
press Replace.

**What if the model returns something worse than my draft?**
Press Discard and nothing happens. You can also Retry, ask for a specific change
in plain words, or step between up to three versions.

**Can I undo?**
Yes, twice over: the insertion uses `execCommand` where possible so the browser's
own Ctrl+Z works, and an Undo pill appears for ten seconds afterwards.

**Does it cost anything?**
PromptAmp is free and MIT-licensed. You pay your provider for the tokens you use
— typically a fraction of a cent per enhancement. A daily cap is on by default so
a runaway loop cannot spend your money.

**Will it slow down my browsing?**
No network call happens unless you press the button. The button is positioned
with cached geometry and idles at effectively zero CPU.

**How do I turn it off on one site?**
The × on the button offers "hide until next visit", "hide on this site", and
"hide everywhere". All three are reversible from the toolbar popup. A site can
also opt out with `data-promptamp="false"` on a field.

## Development

```bash
pnpm dev          # WXT dev mode (Chrome)
pnpm build        # all targets → .output/
pnpm test         # vitest unit suites
pnpm e2e          # builds, then Playwright against the local playground
pnpm icons        # regenerate PNG icons from assets/icon.svg
pnpm zip          # store-ready artifacts
```

`playground/` is a local page of deliberately awkward fields — rich editors,
shadow DOM, iframes, a modal dialog — that the e2e suite drives. No network and
no API key: a mock provider serves every response deterministically.

## Tech

TypeScript (strict) · [WXT](https://wxt.dev) · Manifest V3 · vanilla DOM

No UI framework, on purpose. The content script has to be auditable and safe
under Trusted Types, which means zero `innerHTML` and zero string-HTML sinks.

## License

[MIT](LICENSE) © 2026 Sina Amareh
