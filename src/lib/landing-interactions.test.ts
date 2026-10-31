import { describe, expect, it, vi } from 'vitest';
import { initializeLandingInteractions } from './landing-interactions';

class PreviewElement extends EventTarget {
  value = '50';
  hidden = false;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  selectors = new Map<string, PreviewElement[]>();
  position = { left: 100, width: 400 };
  captures = new Set<number>();
  style = { setProperty: vi.fn() };
  querySelector(selector: string) { return this.selectors.get(selector)?.[0] ?? null; }
  querySelectorAll(selector: string) { return this.selectors.get(selector) ?? []; }
  getBoundingClientRect() { return this.position; }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  emit(type: string, properties: Record<string, number> = {}) {
    this.dispatchEvent(Object.assign(new Event(type), properties));
  }
}

function previewFixture() {
  const root = new PreviewElement();
  const compare = new PreviewElement();
  const range = new PreviewElement();
  compare.selectors.set('input[type="range"]', [range]);
  const panels = [new PreviewElement(), new PreviewElement()];
  panels[1].hidden = true;
  panels[0].selectors.set('[data-landing-compare]', [compare]);
  const buttons = [new PreviewElement(), new PreviewElement()];
  root.selectors.set('[data-landing-compare]', [compare]);
  root.selectors.set('[data-landing-preview]', panels);
  root.selectors.set('[data-landing-sample]', buttons);
  initializeLandingInteractions(root as unknown as HTMLElement);
  return { root, compare, range, panels, buttons };
}

describe('landing preview state transitions', () => {
  it('stops a cancelled drag and ignores later pointer movement without capture', () => {
    const { compare, range } = previewFixture();
    range.emit('pointerdown', { pointerId: 7, clientX: 0 });
    expect(range.value).toBe('0');
    range.emit('pointermove', { pointerId: 7, clientX: 900 });
    expect(range.value).toBe('100');
    range.emit('pointercancel', { pointerId: 7 });
    expect(range.hasPointerCapture(7)).toBe(false);
    range.emit('pointermove', { pointerId: 7, clientX: 100 });
    expect(range.value).toBe('100');
    range.emit('pointerup', { pointerId: 7 });
    expect(compare.style.setProperty).toHaveBeenLastCalledWith('--compare-position', '100%');
  });

  it('allows a static sample then restores a comparison at the design midpoint', () => {
    const { compare, range, panels, buttons } = previewFixture();
    range.value = '82';
    range.emit('input');
    buttons[1].emit('click');
    expect(panels.map(panel => panel.hidden)).toEqual([true, false]);
    expect(buttons.map(button => button.attributes.get('aria-pressed'))).toEqual(['false', 'true']);
    buttons[0].emit('click');
    expect(panels.map(panel => panel.hidden)).toEqual([false, true]);
    expect(range.value).toBe('50');
    expect(compare.style.setProperty).toHaveBeenLastCalledWith('--compare-position', '50%');
  });

  it('initializes once and ignores zero-width hidden comparisons without corrupting their value', () => {
    const { root, compare, range } = previewFixture();
    initializeLandingInteractions(root as unknown as HTMLElement);
    range.value = '67.4';
    range.emit('input');
    expect(range.value).toBe('67');
    expect(compare.style.setProperty).toHaveBeenCalledTimes(1);
    compare.position.width = 0;
    range.emit('pointerdown', { pointerId: 2, clientX: 1000 });
    expect(range.value).toBe('67');
    range.emit('pointerup', { pointerId: 2 });
    expect(range.hasPointerCapture(2)).toBe(false);
  });

  it('accepts a partially configured static section without attaching a broken range handler', () => {
    const root = new PreviewElement();
    root.selectors.set('[data-landing-compare]', [new PreviewElement()]);
    expect(() => initializeLandingInteractions(root as unknown as HTMLElement)).not.toThrow();
  });
});
