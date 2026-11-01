import { describe, expect, it, vi } from 'vitest';
import { initializeLandingInteractions } from './landing-interactions';
class PreviewElement extends EventTarget {
  hidden = false;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  selectors = new Map<string, PreviewElement[]>();
  querySelector(selector: string) { return this.selectors.get(selector)?.[0] ?? null; }
  querySelectorAll(selector: string) { return this.selectors.get(selector) ?? []; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
}
function fixture() {
  const root = new PreviewElement(); const panels = [new PreviewElement(), new PreviewElement()];
  const images = [new PreviewElement(), new PreviewElement()]; const buttons = [new PreviewElement(), new PreviewElement()];
  const resets = images.map(image => { const reset = vi.fn(); image.addEventListener('image-display:reset', reset); return reset; });
  panels.forEach((panel, index) => { panel.hidden = index !== 0; panel.selectors.set('[data-image-display]', [images[index]]); });
  root.selectors.set('[data-landing-preview]', panels); root.selectors.set('[data-landing-sample]', buttons);
  initializeLandingInteractions(root as unknown as HTMLElement);
  return { root, panels, buttons, resets };
}
describe('landing sample selection delegates to the shared image controller', () => {
  it('switches one visible example and requests a midpoint reset on each selection', () => {
    const { panels, buttons, resets } = fixture();
    buttons[1].dispatchEvent(new Event('click'));
    expect(panels.map(panel => panel.hidden)).toEqual([true, false]);
    expect(buttons.map(button => button.attributes.get('aria-pressed'))).toEqual(['false', 'true']);
    expect(resets[1]).toHaveBeenCalledTimes(1);
    buttons[0].dispatchEvent(new Event('click'));
    expect(panels.map(panel => panel.hidden)).toEqual([false, true]);
    expect(resets[0]).toHaveBeenCalledTimes(1);
  });
  it('initializes once so one click cannot attach duplicate reset actions', () => {
    const { root, buttons, resets } = fixture();
    initializeLandingInteractions(root as unknown as HTMLElement);
    buttons[0].dispatchEvent(new Event('click'));
    expect(resets[0]).toHaveBeenCalledTimes(1);
  });
  it('accepts a static or empty section without a comparison or broken handler', () => {
    const root = new PreviewElement();
    root.selectors.set('[data-landing-sample]', [new PreviewElement()]);
    expect(() => initializeLandingInteractions(root as unknown as HTMLElement)).not.toThrow();
    root.querySelector('[data-landing-sample]')!.dispatchEvent(new Event('click'));
  });
});
