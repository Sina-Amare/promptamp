# Testing PromptAmp

A guided pass, about 20 minutes. It is ordered so that anything broken shows up
early, and so you never have to guess whether something is a bug or the design.

Automated tests already cover the pipeline, the insertion ladder, the fallback
chain, and accessibility — 270 unit tests and 79 end-to-end tests against a real
loaded extension. What they *cannot* cover is a real logged-in site with a real
model behind a real key. That is what this pass is for.

Please note anything that surprises you, even if it is not obviously wrong.
"It felt slow here" and "I didn't expect that" are the most useful reports.

---

## 0 · Install (2 min)

```bash
pnpm install
pnpm build
```

**Chrome or Edge**

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select `.output/chrome-mv3`
4. Pin PromptAmp to the toolbar

**Firefox**

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on** → select any file inside `.output/firefox-mv3`
3. Firefox will ask for host permission the first time a request is made — that
   is expected and is the point of the permission card in settings

✅ You should see the dial icon in the toolbar.

---

## 1 · Add a connection (3 min)

Open the extension's settings (toolbar icon → Settings…).

1. Under **Add a connection**, choose a provider and press **Add connection**.
   Groq or OpenRouter are the easiest to start with — both have free tiers.
2. Paste your API key into the new card and press **Save**.
3. Press **Load models**, pick one from the list, and press **Save** again.
4. Press **Test**.

✅ Expected: `Working — <model name>`.

**Check the security claim while you are here.** Reload the settings page. The
key field shows `•••••••• saved`, never the key. View source or search the page
for your key — it must not appear anywhere. It never leaves the background
worker.

### Then add a second connection

Add another one — a different provider, or a second key. Use the ↑ ↓ buttons to
order them.

✅ Expected: the first card is badged **Primary**, the rest **Fallback 1**,
**Fallback 2**… and the order survives a reload.

---

## 2 · The core loop, on a real site (5 min)

Go to a site you actually use — ChatGPT, Claude, Gemini, Perplexity, DeepSeek,
Midjourney, Reddit, Gmail.

1. Click into the message box and type a rough draft, e.g.
   `tips for a job interview`
2. A small dial button appears in the corner of the field.

   ✅ It should sit inside the field, not cover the send button, and not fight
   with the site's own icons.

3. Press it.

   ✅ Under ~300 ms: no loading state at all, the panel just opens with text.
   ✅ Slower: text streams in smoothly rather than appearing in bursts.

4. Press **Show changes** — a word-level diff.
5. Press **Original** — your untouched draft.
6. Press **Replace draft**.

   ✅ Your draft is replaced in the real field.
   ✅ **Ctrl+Z once should undo it**, using the site's own undo stack.
   ✅ An **Undo** pill also appears for ten seconds.

Repeat on **at least five different sites**. The insertion ladder has five tiers
and different sites take different ones — this is the single most valuable part
of the whole pass.

| Site | Button placed sensibly? | Insert worked? | Ctrl+Z worked? | Notes |
| --- | --- | --- | --- | --- |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |

---

## 3 · Things that should *not* break your draft (3 min)

The promise is: **on any failure, your draft is provably untouched.**

1. Type a draft. Press Enhance, then immediately press the button again to
   **Stop**.
   ✅ Draft unchanged, no charge for a completed request.
2. Turn off your network. Press Enhance.
   ✅ A named error ("Connection problem"), a concrete fix underneath it, and
   "Your draft is unchanged."
3. Turn the network back on. Break a key deliberately (edit a connection, paste
   nonsense, save) and enhance again.
   ✅ If you have a second connection, it should take over automatically and the
   panel should tell you it switched.
   ✅ If it was your only one: "API key problem", plus a remedy telling you to
   re-paste it.

---

## 4 · Profiles (3 min)

1. On an image site (Midjourney, or any field), type `a cat in space` and
   enhance.
   ✅ You should get an English prose caption with a medium, lighting, and a
   composition cue — even if you wrote the draft in Persian.
2. On a chat site, type the same words.
   ✅ You should get a chat-shaped prompt instead. The profile chip in the panel
   header names which one ran.
3. In Settings → Profiles, **Fork** a built-in, edit its system prompt, save.
   ✅ The built-in is untouched; your fork appears under "Your profiles".

### Output language

Settings → Behavior → **Enhanced prompt language**. Type `English`, save, then
write a draft in Persian and enhance.

✅ The rewrite comes back in English, with code, quoted strings, and any
`--ar 16:9`-style parameters left byte-exact.

---

## 5 · Getting rid of it (2 min)

Every one of these must work, and must be reversible.

1. Hover the button, press the **×** → **Hide until next visit**. Reload; it
   comes back.
2. **×** → **Hide on this site**. Reload; still gone. Toolbar popup → **Show on
   this site**; it comes back.
3. Toolbar popup → **Pause on all sites for 1 hour**, then resume.
4. **×** → **Hide everywhere**. Toolbar popup → **Turn PromptAmp back on**.

---

## 6 · Keyboard and screen reader (2 min)

1. Focus a text field, press **Tab** once.
   ✅ Focus lands on the PromptAmp button, not somewhere else on the page.
2. Press **Enter** to enhance, then **Ctrl+Enter** to accept without a mouse.
3. Press **Escape** in the panel.
   ✅ It closes and focus returns to your field with the cursor where it was.
4. Press **Alt+E** in a focused field.

---

## What to send back

- The site table from §2, filled in
- Any screenshot where the button sits badly
- Anything that felt slow, surprising, or ugly
- Any error message that told you what was wrong but not what to do about it

Wording, spacing, colour, and animation are all still open — this is the point
where that feedback is cheapest to act on.

## Known limitations in 0.1.0

- The profile chip in the panel header is not clickable yet; switch profiles
  from the toolbar popup or settings
- The icon is a hand-drawn placeholder — final artwork is still to come
- No demo GIF yet
- Not yet submitted to any store, so installs are unpacked/temporary — Firefox
  in particular discards a temporary add-on when it restarts
