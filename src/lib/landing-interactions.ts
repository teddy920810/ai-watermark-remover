/** Marketing previews only switch examples; the shared image controller owns comparisons. */
export function initializeLandingInteractions(root: HTMLElement) {
  if (root.dataset.landingInitialized) return;
  root.dataset.landingInitialized = 'true';

  const samples = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-landing-sample]'));
  const previews = Array.from(root.querySelectorAll<HTMLElement>('[data-landing-preview]'));
  samples.forEach((sample, index) => sample.addEventListener('click', () => {
    samples.forEach((button, position) => button.setAttribute('aria-pressed', String(index === position)));
    previews.forEach((preview, position) => { preview.hidden = index !== position; });
    previews[index]?.querySelector<HTMLElement>('[data-image-display]')?.dispatchEvent(new Event('image-display:reset'));
  }));
}
