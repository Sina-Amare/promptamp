/**
 * Counts Trusted-Types violations caused by the *extension*.
 *
 * A violation from our code means the injected UI just died: under an
 * enforcing policy the assignment throws, so whatever was being built stops
 * half-constructed. Counting them turns "PromptAmp is broken on Google" into a
 * failing assertion.
 */

declare global {
  interface Window {
    ttViolations: string[];
  }
}

window.ttViolations = [];

/** The page's own probe, below — deliberately illegal, and not under test. */
const PROBE_SAMPLE = '<b>probe</b>';

document.addEventListener('securitypolicyviolation', (event) => {
  // Only the Trusted-Types directives matter here; an unrelated CSP report
  // from the page itself is not our problem.
  if (!event.violatedDirective.includes('trusted-types')) return;
  // Violation events are delivered asynchronously, so the probe's own report
  // can arrive well after it ran — it has to be excluded by identity, not by
  // resetting a counter and hoping the ordering works out.
  if (event.sample?.includes(PROBE_SAMPLE)) return;

  window.ttViolations.push(
    `${event.violatedDirective} @ ${event.sourceFile ?? 'unknown'}:${String(event.lineNumber)} — ${event.sample ?? ''}`,
  );
  const counter = document.getElementById('violations');
  if (counter) counter.textContent = String(window.ttViolations.length);
});

// Prove the policy is actually enforcing — if this does *not* throw, the page
// is misconfigured and every other assertion here would be worthless.
try {
  // The one deliberate string-HTML sink in the codebase. It exists precisely
  // to prove the policy rejects it — if this line ever stopped throwing, every
  // Trusted-Types assertion in the suite would be meaningless.
  // eslint-disable-next-line no-restricted-syntax
  document.createElement('div').innerHTML = PROBE_SAMPLE;
  console.error('Trusted Types is NOT enforcing on this page');
} catch {
  console.info('Trusted Types enforcing: confirmed');
}

export {};
