import { defineBackground } from '#imports';

export default defineBackground(() => {
  // Message router lands in Phase 1 (lib/messaging/protocol.ts).
  // Everything here must stay stateless: MV3 kills this worker at will, so
  // every event handler reloads what it needs from storage.
});
