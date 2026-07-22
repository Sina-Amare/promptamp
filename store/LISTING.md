# Store listing copy

Every field for every store, in the exact text to paste. Nothing here is
aspirational — each claim maps to something in the source, because a listing
that overstates is a listing that gets pulled.

Two rules this copy follows deliberately, both drawn from what gets extensions
rejected in this category:

- **No "free unlimited" framing.** PromptAmp is free, but the *model* is paid
  for by the user's own key. Saying "unlimited AI" reads as circumventing a
  provider's limits and is a documented rejection trigger.
- **Nothing that reads as AI-guardrail bypass.** No "uncensored", no
  "jailbreak", no "no restrictions". PromptAmp rewrites prompts; it does not
  help anyone get around a model's policies, and the listing must not imply
  otherwise.

---

## Chrome Web Store

### Name (45 char max)

```
PromptAmp — AI Prompt Enhancer (BYOK)
```

### Short description (132 char max)

```
Turn rough drafts into engineered prompts in any text field. Uses your own API key. No backend, no telemetry, no account.
```

*(120 characters.)*

### Category

`Productivity` → Workflow & Planning

### Detailed description

```
PromptAmp rewrites your rough draft into a well-engineered prompt, right inside
the text field you are already typing in — on any website.

Type a rough idea. Press the button that appears in the corner of the field.
PromptAmp shows you a better version next to your original, and replaces your
text only when you accept it.


BRING YOUR OWN KEY

PromptAmp has no backend. Your draft goes directly from your browser to the AI
provider you chose, authenticated with the API key you supplied. There is no
PromptAmp server in between, because there is no PromptAmp server at all.

Works with OpenAI, Anthropic, Google Gemini, Groq, OpenRouter, local models via
Ollama or LM Studio, and any endpoint that speaks the OpenAI chat-completions
format — including your own self-hosted server or LiteLLM proxy.

Add several connections and order them: if the first is rate-limited or out of
credit, the next takes over automatically and tells you it switched.


YOUR DRAFT IS NEVER TOUCHED UNTIL YOU ACCEPT

Not on error, not on timeout, not if the model declines. If insertion fails
part-way through, the field is restored from a snapshot taken before anything
started. Undo works twice over — the browser's own Ctrl+Z, plus an Undo button
for ten seconds after.


WORKS IN REAL EDITORS

Not a whitelist of chat apps. Plain inputs, contenteditable, Monaco, CodeMirror,
ProseMirror, Quill, Slate, fields inside iframes, fields inside modal dialogs.
Five insertion strategies, each verified by reading the text back afterwards.


PROMPTS THAT FIT THE TASK

An image prompt is not a code prompt is not a study prompt. Seven built-in
profiles — general, chat, image, video, coding, learning, writing — chosen
automatically from the site you are on, or pinned by you. Fork any of them and
edit the system prompt yourself.

Write your draft in any language. Optionally have the enhanced prompt come back
in a different one, with your code, quoted strings, and generator parameters
left byte-exact.


PRIVATE BY CONSTRUCTION

• No servers, no telemetry, no analytics, no accounts — ever
• Your API key is stored on this device and readable only by the background
  worker, never by the script that runs on web pages
• Keys are never synced through your browser vendor
• History stays local and can be cleared or turned off
• Host permissions are a short, fixed list of provider API hosts

Open source under the MIT licence. Every claim above is checkable in the code:
github.com/Sina-Amare/promptamp


COSTS

PromptAmp is free. You pay your own provider for the tokens you use — usually a
fraction of a cent per enhancement. A daily cap is on by default so nothing can
run away with your credit.
```

### Privacy practices (the form that blocks most submissions)

| Question | Answer |
| --- | --- |
| Single purpose | Rewriting a user's draft text into an improved prompt, in place, in any text field. |
| `storage` justification | Stores the user's own API key, settings, and custom profiles locally on their device. |
| `activeTab` justification | Reads the draft from the field the user focused, and writes the rewritten text back when the user accepts. |
| `scripting` justification | Some editors (Monaco, CodeMirror) accept text only through their own JavaScript API, which requires executing a small insertion function in the page's main world. Used only on the user's explicit accept. |
| `contextMenus` justification | Adds a single "Enhance this draft with PromptAmp" item on editable fields. |
| `commands` justification | Provides the Alt+E keyboard shortcut for the same action as the button. |
| `identity` justification | Optional OpenRouter sign-in via PKCE OAuth, so a user can connect without pasting a key. No password is ever seen by the extension. |
| Host permission justification | Sends the user's draft to the AI provider they configured. The list is limited to those providers' API hosts. A user-supplied custom endpoint is requested as an optional permission, granted per host, at the moment they save it. |
| Remote code | **No.** All code is in the package. Nothing is fetched or evaluated at runtime. |
| Data collected | Personally identifiable information: **No**. Health: **No**. Financial: **No**. Authentication information: **Yes** — the user's own API key, stored locally, transmitted only to the provider it belongs to. Personal communications: **No**. Location: **No**. Web history: **No**. User activity: **No**. Website content: **Yes** — the draft text the user explicitly submits, transmitted only to the provider they chose. |
| Sold to third parties | No |
| Used for purposes unrelated to the single purpose | No |
| Used to determine creditworthiness / lending | No |
| Limited Use compliance | Certified |

Privacy policy URL: `https://sina-amare.github.io/promptamp/privacy.html`

---

## Firefox Add-ons (AMO)

### Name

```
PromptAmp — AI Prompt Enhancer
```

### Summary (250 char max)

```
Turn rough drafts into engineered prompts in any text field on any site, using your own API key. No backend, no telemetry, no account. Works with OpenAI, Anthropic, Gemini, Groq, OpenRouter, and local models.
```

### Description

Use the Chrome detailed description above; AMO accepts the same text.

### Data collection permissions

Declared in the manifest under `browser_specific_settings.gecko`, required by
AMO since 2025-11-03:

- `websiteContent` — the draft text the user submits, sent only to their chosen
  provider
- `authenticationInfo` — the user's own API key, stored locally and sent only to
  the provider it belongs to

### Notes for reviewers

```
PromptAmp is a BYOK (bring-your-own-key) prompt rewriter. There is no backend
service of any kind.

Build (Node 22, pnpm 9):
    pnpm install
    pnpm build:firefox
Output: .output/firefox-mv2

The source zip contains no minified or generated code. Everything under lib/
and entrypoints/ is the original TypeScript.

Points a reviewer may want to check directly:

1. No remote code. There is no eval, no new Function, and no script injection
   from a URL. The one use of chrome.scripting.executeScript injects a function
   defined in lib/insertion/main-world.ts, and only on an explicit user accept.

2. API keys never reach content scripts. lib/storage/credentials.ts is the only
   module that reads them, it runs in the background only, and eslint.config.js
   contains a no-restricted-imports rule that fails the build if a content
   script imports it.

3. Network requests only to configured provider hosts. See wxt.config.ts for
   the fixed host list. The optional_host_permissions entry exists solely for a
   user-supplied OpenAI-compatible endpoint and is requested per host, from a
   user gesture, in entrypoints/options/main.ts.

4. No requests without user action. Every provider call originates from a
   button press, the Alt+E command, or the context-menu item.

5. No innerHTML anywhere in the injected UI. All DOM is built with
   createElement/textContent via lib/ui/host.ts, so the content script is safe
   on pages enforcing Trusted Types.
```

---

## Microsoft Edge Add-ons

Same package and same copy as Chrome. Edge additionally asks:

| Question | Answer |
| --- | --- |
| Does your extension collect user data? | Yes — the user's own API key and the draft text they submit, both handled as described in the privacy policy. Neither is transmitted to the developer. |
| Is data shared with third parties? | Only the AI provider the user themselves configured, as the direct destination of their request. |

---

## Screenshots

Generated from the real build with `pnpm shots` → `store/screenshots/`, at
1280×800. Upload in this order:

1. `02-panel-diff.png` — the preview panel showing a word-level diff. Lead with
   this: it is the whole argument for the product.
2. `01-button.png` — the button resting in a composer
3. `03-connections.png` — several connections with the fallback order
4. `05-profiles.png` — the built-in profiles
5. `04-privacy.png` — the privacy claim as the product states it

## Pre-submission checklist

- [ ] `pnpm test` and `pnpm e2e` green
- [ ] `pnpm zip` produces artifacts for all three targets
- [ ] Each artifact installs from disk on a clean profile
- [ ] Privacy policy is live at the URL above
- [ ] Screenshots regenerated from the final build
- [ ] Version in `wxt.config.ts` matches the git tag
- [ ] CWS developer account paid ($5, one-off)
