import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeHomeInteractions } from './home-interactions';

class ElementStub extends EventTarget {
  value = '50';
  hidden = false;
  tabIndex = 0;
  textContent = '';
  offsetLeft = 0;
  offsetWidth = 100;
  clientWidth = 200;
  scrollWidth = 600;
  parentElement?: ElementStub;
  dataset: Record<string, string> = {};
  attrs = new Map<string, string>();
  selectors = new Map<string, ElementStub[]>();
  classes = new Set<string>();
  style = { setProperty: vi.fn() };
  classList = { toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name) };
  focus = vi.fn();
  scrollTo = vi.fn();
  captured = new Set<number>();
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
  getBoundingClientRect() { return { left: 20, width: 200 }; }
  querySelector(selector: string) { return this.selectors.get(selector)?.[0]; }
  querySelectorAll(selector: string) { return this.selectors.get(selector) ?? []; }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  event(type: string, properties: Record<string, unknown> = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, properties);
    this.dispatchEvent(event);
    return event;
  }
}

function fixture(reducedMotion = false) {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reducedMotion }) });
  const root = new ElementStub();
  const compares = Array.from({ length: 5 }, () => {
    const compare = new ElementStub();
    compare.selectors.set('input[type="range"]', [new ElementStub()]);
    return compare;
  });
  const containers = compares.map((compare, i) => {
    const el = new ElementStub();
    el.hidden = i !== 0 && i !== 2;
    el.selectors.set('[data-image-display]', [compare]);
    el.selectors.set('input[type="range"]', compare.selectors.get('input[type="range"]')!);
    return el;
  });
  const samples = [new ElementStub(), new ElementStub()];
  const tablist = new ElementStub();
  const tabs = Array.from({ length: 3 }, (_, i) => {
    const tab = new ElementStub();
    tab.parentElement = tablist;
    tab.offsetLeft = i * 100;
    tab.setAttribute('aria-selected', String(i === 0));
    return tab;
  });
  const directions = ['previous', 'next'].map(direction => {
    const el = new ElementStub(); el.dataset.scenarioDirection = direction; return el;
  });
  const toggle = new ElementStub();
  toggle.dataset = { playLabel: 'Play', pauseLabel: 'Pause' };
  const marquee = new ElementStub();
  root.selectors = new Map([
    ['[data-image-display]', compares], ['[data-hero-sample]', samples],
    ['[data-hero-preview]', containers.slice(0, 2)], ['[data-scenario-tab]', tabs],
    ['[data-scenario-panel]', containers.slice(2)], ['[data-scenario-direction]', directions],
    ['[data-reviews-toggle]', [toggle]], ['[data-reviews-marquee]', [marquee]],
  ]);
  initializeHomeInteractions(root as unknown as HTMLElement);
  return { compares, containers, samples, tabs, tablist, directions, toggle, marquee };
}

afterEach(() => vi.unstubAllGlobals());

describe('homepage interaction state transitions', () => {
  it('leaves pointer and range ownership with the shared image controller', () => {
    const { compares } = fixture();
    const range = compares[0].querySelector('input[type="range"]')!;
    range.value = '73'; range.event('input');
    range.event('pointerdown', { pointerId: 1, clientX: -30 });
    expect(range.value).toBe('73');
    expect(range.hasPointerCapture(1)).toBe(false);
    expect(compares[0].style.setProperty).not.toHaveBeenCalled();
  });

  it('resets the shared image display when selecting another hero sample', () => {
    const { compares, samples, containers } = fixture();
    const reset = vi.fn(); compares[1].addEventListener('image-display:reset', reset);
    samples[1].event('click');
    expect(samples.map(x => x.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    expect(containers.slice(0, 2).map(x => x.hidden)).toEqual([true, false]);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('wraps scenarios and supports tab selection, keyboard focus and mobile visibility', () => {
    const { compares, tabs, containers, directions, tablist } = fixture();
    const reset = vi.fn(); compares[4].addEventListener('image-display:reset', reset);
    directions[0].event('click');
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(reset).toHaveBeenCalledTimes(1);
    directions[1].event('click');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    tabs[1].event('click');
    expect(containers.slice(2).map(x => x.hidden)).toEqual([true, false, true]);
    expect(tabs.map(x => x.tabIndex)).toEqual([-1, 0, -1]);
    expect(tabs[1].event('keydown', { key: 'ArrowRight' }).defaultPrevented).toBe(true);
    expect(tabs[2].focus).toHaveBeenCalled();
    tabs[2].event('keydown', { key: 'ArrowLeft' });
    tabs[1].event('keydown', { key: 'Home' });
    tabs[0].event('keydown', { key: 'End' });
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(tablist.scrollTo).toHaveBeenLastCalledWith({ left: 150, behavior: 'smooth' });
    expect(tabs[2].event('keydown', { key: 'Enter' }).defaultPrevented).toBe(false);
  });

  it('respects reduced motion and toggles review playback with matching accessible state', () => {
    const { tabs, tablist, toggle, marquee } = fixture(true);
    tabs[2].event('click');
    expect(tablist.scrollTo).toHaveBeenLastCalledWith({ left: 150, behavior: 'instant' });
    toggle.event('click');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).toBe('Play');
    expect(marquee.classes.has('is-paused')).toBe(true);
    toggle.event('click');
    expect(toggle.textContent).toBe('Pause');
    expect(marquee.classes.has('is-paused')).toBe(false);
  });
});
