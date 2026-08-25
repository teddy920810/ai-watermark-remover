import { IMAGE_PLACEHOLDER_SRC } from '../content/image-fallback-constants';

function usePlaceholder(image: HTMLImageElement): void {
  if (image.dataset.imageFallback === 'true' || image.getAttribute('src') === IMAGE_PLACEHOLDER_SRC) return;
  image.closest('picture')?.querySelectorAll('source').forEach((source) => {
    source.removeAttribute('srcset');
    source.removeAttribute('sizes');
  });
  image.removeAttribute('srcset');
  image.removeAttribute('sizes');
  image.dataset.imageFallback = 'true';
  image.src = IMAGE_PLACEHOLDER_SRC;
}

export function installImageFallbacks(documentRoot: Document = document): void {
  documentRoot.addEventListener('error', (event) => {
    if (event.target instanceof HTMLImageElement) usePlaceholder(event.target);
  }, true);

  documentRoot.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    if (image.complete && image.naturalWidth === 0) usePlaceholder(image);
  });
}
