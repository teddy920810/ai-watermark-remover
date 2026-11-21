const startComparisons = new WeakMap<Element, () => void>();
let comparisonObserver: IntersectionObserver | undefined;
const loadingNoticeDelay = 300;
const comparisonDemos = new WeakMap<Element, (entry: IntersectionObserverEntry) => void>();
let demoObserver: IntersectionObserver | undefined;
const demoVisibility = 0.35;
const demoDuration = 2800;

function deferComparison(root: HTMLElement) {
  if (typeof IntersectionObserver === 'undefined') {
    startComparisons.get(root)?.();
    return;
  }
  comparisonObserver ??= new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) if (isIntersecting) startComparisons.get(target)?.();
  }, { rootMargin: '240px' });
  comparisonObserver.observe(root);
}

function observeComparisonDemo(root: HTMLElement, initialPosition: number, setPosition: (value: number) => void) {
  if (typeof IntersectionObserver === 'undefined') return;

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  const positions = [initialPosition, 98, 20, initialPosition];
  let frame: number | undefined;
  let startTime: number | undefined;
  let playedInView = false;

  function stop() {
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    frame = undefined;
    startTime = undefined;
  }

  function finish() {
    if (frame === undefined) return;
    stop();
    setPosition(initialPosition);
  }

  function dispose() {
    stop();
    listeners.abort();
    demoObserver?.unobserve(root);
    comparisonDemos.delete(root);
  }

  function animate(time: number) {
    if (!root.isConnected) {
      dispose();
      return;
    }
    if (root.dataset.ready !== 'true') {
      stop();
      return;
    }
    startTime ??= time;
    const progress = Math.min(1, (time - startTime) / demoDuration);
    if (progress === 1) {
      finish();
      return;
    }
    const stepProgress = progress * (positions.length - 1);
    const step = Math.floor(stepProgress);
    const ease = (1 - Math.cos(Math.PI * (stepProgress - step))) / 2;
    setPosition(Math.round(positions[step] + (positions[step + 1] - positions[step]) * ease));
    frame = window.requestAnimationFrame(animate);
  }

  comparisonDemos.set(root, ({ isIntersecting, intersectionRatio }) => {
    if (!root.isConnected) {
      dispose();
      return;
    }
    if (!isIntersecting) {
      finish();
      playedInView = false;
      return;
    }
    if (playedInView || intersectionRatio < demoVisibility || root.dataset.ready !== 'true') return;
    playedInView = true;
    if (motion.matches || document.hidden || root.matches(':hover, :not([data-pointer-focus]):has(input:focus-visible)')) return;
    setPosition(initialPosition);
    frame = window.requestAnimationFrame(animate);
  });
  root.addEventListener('pointerenter', stop, options);
  root.addEventListener('pointerdown', stop, options);
  root.addEventListener('focusin', stop, options);
  motion.addEventListener('change', finish, options);
  document.addEventListener('visibilitychange', finish, options);
  demoObserver ??= new IntersectionObserver(entries => {
    for (const entry of entries) comparisonDemos.get(entry.target)?.(entry);
  }, { threshold: [0, demoVisibility] });
  demoObserver.observe(root);
  return stop;
}

export function initializeImageDisplays(scope: ParentNode) {
  scope.querySelectorAll<HTMLElement>('[data-image-display]').forEach(root => {
    if (startComparisons.has(root)) return;
    const before = root.querySelector<HTMLImageElement>('[data-image-side="before"] img');
    const after = root.querySelector<HTMLImageElement>('[data-image-side="after"] img');
    const beforeLayer = root.querySelector<HTMLElement>('[data-image-side="before"]');
    const afterLayer = root.querySelector<HTMLElement>('[data-image-side="after"]');
    const controls = root.querySelector<HTMLElement>('.image-display-controls');
    const loading = root.querySelector<HTMLElement>('.image-display-loading');
    const error = root.querySelector<HTMLElement>('.image-display-error');
    const range = root.querySelector<HTMLInputElement>('input[type="range"]');
    const initialPosition = Number(range?.defaultValue ?? 50);
    let demoRegistered = false;
    let stopDemo: (() => void) | undefined;
    const loaded = (img: HTMLImageElement | null) => Boolean(img?.complete && img.naturalWidth && img.dataset.imageFallback !== 'true');
    const failed = (img: HTMLImageElement | null) => Boolean(img?.complete && (!img.naturalWidth || img.dataset.imageFallback === 'true'));
    let loadingTimer: number | undefined;
    function setPosition(value: number) {
      const position = Math.max(0, Math.min(100, value));
      root.style.setProperty('--image-position', `${position}%`);
      if (range) range.value = String(position);
    }
    function update() {
      const beforeLoaded = loaded(before), afterLoaded = loaded(after);
      const beforeFailed = failed(before), afterFailed = failed(after);
      const aligned = before && after && Math.abs(before.naturalWidth / before.naturalHeight - after.naturalWidth / after.naturalHeight) < 0.01;
      const ready = Boolean(beforeLoaded && afterLoaded && aligned);
      root.dataset.ready = String(ready);
      if (controls) controls.hidden = !ready;
      if (beforeLayer) beforeLayer.hidden = !beforeLoaded && afterLoaded;
      if (afterLayer) afterLayer.hidden = !afterLoaded || (!ready && beforeLoaded);
      if (error) error.hidden = beforeLoaded || afterLoaded || !(beforeFailed && (!after || afterFailed));
      if (ready && !demoRegistered) {
        demoRegistered = true;
        stopDemo = observeComparisonDemo(root, initialPosition, setPosition);
      }
      if (loading) {
        const waiting = after?.loading === 'eager' && !(beforeLoaded && afterLoaded) && !beforeFailed && !afterFailed;
        if (waiting) {
          loadingTimer ??= window.setTimeout(() => { loading.hidden = false; }, loadingNoticeDelay);
        } else {
          window.clearTimeout(loadingTimer);
          loadingTimer = undefined;
          loading.hidden = true;
        }
      }
    }
    function startComparison() {
      comparisonObserver?.unobserve(root);
      // The hidden After layer cannot rely on native lazy loading.
      for (const image of [before, after]) if (image?.loading === 'lazy') image.loading = 'eager';
      update();
    }
    startComparisons.set(root, startComparison);
    for (const img of [before, after]) {
      img?.addEventListener('load', update);
      img?.addEventListener('error', update);
    }
    range?.addEventListener('input', () => setPosition(Number(range.value)));
    range?.addEventListener('keydown', () => {
      root.removeAttribute('data-pointer-focus');
      stopDemo?.();
    });
    range?.addEventListener('blur', () => root.removeAttribute('data-pointer-focus'));
    let pointer: number | null = null;
    function move(event: PointerEvent) {
      const box = controls?.getBoundingClientRect();
      if (box?.width) setPosition((event.clientX - box.left) / box.width * 100);
    }
    controls?.addEventListener('pointerdown', event => {
      if (root.dataset.ready !== 'true') return;
      event.preventDefault();
      root.dataset.pointerFocus = 'true';
      range?.focus({ preventScroll: true });
      pointer = event.pointerId;
      controls.setPointerCapture(pointer); move(event);
    });
    controls?.addEventListener('pointermove', event => { if (event.pointerId === pointer) move(event); });
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      if (controls?.hasPointerCapture(event.pointerId)) controls.releasePointerCapture(event.pointerId);
      pointer = null;
    };
    controls?.addEventListener('pointerup', finish);
    controls?.addEventListener('pointercancel', finish);
    root.addEventListener('image-display:reset', () => {
      stopDemo?.();
      setPosition(initialPosition);
      if (after?.loading === 'lazy') startComparison();
    });
    if (after?.loading === 'lazy') deferComparison(root);
    update();
  });
}
