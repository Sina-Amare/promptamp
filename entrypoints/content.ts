import { defineContentScript } from '#imports';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // Field tracker + shadow-DOM UI host land in Phase 5.
    // This script never sees an API key and never makes a network call.
  },
});
