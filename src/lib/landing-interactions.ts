/** Marketing previews stay local: only the existing uploader can create processing jobs. */
export function initializeLandingInteractions(root: HTMLElement) {
  if (root.dataset.landingInitialized) return;
  root.dataset.landingInitialized = 'true';

  root.querySelectorAll<HTMLElement>('[data-landing-compare]').forEach(compare => {
    const range = compare.querySelector<HTMLInputElement>('input[type="range"]');
    if (!range) return;
    const update = (value: number) => {
      const position = Math.max(0, Math.min(100, Math.round(value)));
      range.value = String(position);
      compare.style.setProperty('--compare-position', `${position}%`);
    };
    const fromPointer = (event: PointerEvent) => {
      const bounds = compare.getBoundingClientRect();
      if (bounds.width) update(100 * (event.clientX - bounds.left) / bounds.width);
    };
    range.addEventListener('input', () => update(Number(range.value)));
    range.addEventListener('pointerdown', event => {
      range.setPointerCapture(event.pointerId);
      fromPointer(event);
    });
    range.addEventListener('pointermove', event => {
      if (range.hasPointerCapture(event.pointerId)) fromPointer(event);
    });
    const release = (event: PointerEvent) => {
      if (range.hasPointerCapture(event.pointerId)) range.releasePointerCapture(event.pointerId);
    };
    range.addEventListener('pointerup', release);
    range.addEventListener('pointercancel', release);
  });

  const samples = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-landing-sample]'));
  const previews = Array.from(root.querySelectorAll<HTMLElement>('[data-landing-preview]'));
  samples.forEach((sample, index) => sample.addEventListener('click', () => {
    samples.forEach((button, position) => button.setAttribute('aria-pressed', String(index === position)));
    previews.forEach((preview, position) => { preview.hidden = index !== position; });
    const compare = previews[index]?.querySelector<HTMLElement>('[data-landing-compare]');
    const range = compare?.querySelector<HTMLInputElement>('input[type="range"]');
    if (compare && range) {
      range.value = '50';
      compare.style.setProperty('--compare-position', '50%');
    }
  }));
}
