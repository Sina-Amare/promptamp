// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createCallout } from '../lib/ui/callout';

describe('first-run callout', () => {
  it('renders the intro and exactly two actions', () => {
    const callout = createCallout({
      onGotIt: () => undefined,
      onHideSite: () => undefined,
    });
    expect(
      callout.element.querySelector('.pa-callout-body')?.textContent,
    ).toContain('sharpen');
    expect(callout.element.querySelectorAll('button')).toHaveLength(2);
    // No string-HTML sinks: everything is real elements built with textContent.
    expect(callout.element.querySelector('.pa-callout-primary')).not.toBeNull();
    expect(
      callout.element.querySelector('.pa-callout-secondary'),
    ).not.toBeNull();
  });

  it('fires onGotIt from the primary button and from Escape', () => {
    let gotIt = 0;
    const callout = createCallout({
      onGotIt: () => (gotIt += 1),
      onHideSite: () => undefined,
    });
    document.body.append(callout.element);

    callout.element
      .querySelector<HTMLButtonElement>('.pa-callout-primary')!
      .click();
    expect(gotIt).toBe(1);

    callout.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(gotIt).toBe(2);
  });

  it('fires onHideSite from the secondary button (the in-intro opt-out)', () => {
    let hide = 0;
    const callout = createCallout({
      onGotIt: () => undefined,
      onHideSite: () => (hide += 1),
    });
    callout.element
      .querySelector<HTMLButtonElement>('.pa-callout-secondary')!
      .click();
    expect(hide).toBe(1);
  });

  it('destroy() removes it from the DOM', () => {
    const callout = createCallout({
      onGotIt: () => undefined,
      onHideSite: () => undefined,
    });
    document.body.append(callout.element);
    expect(callout.element.isConnected).toBe(true);
    callout.destroy();
    expect(callout.element.isConnected).toBe(false);
  });
});
