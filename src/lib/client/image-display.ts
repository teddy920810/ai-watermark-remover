const initialized = new WeakSet<HTMLElement>();

export function initializeImageDisplays(scope: ParentNode) {
  scope.querySelectorAll<HTMLElement>('[data-image-display]').forEach(root => {
    if (initialized.has(root)) return;
    initialized.add(root);
    const before = root.querySelector<HTMLImageElement>('[data-image-side="before"] img');
    const after = root.querySelector<HTMLImageElement>('[data-image-side="after"] img');
    const beforeLayer = root.querySelector<HTMLElement>('[data-image-side="before"]');
    const afterLayer = root.querySelector<HTMLElement>('[data-image-side="after"]');
    const controls = root.querySelector<HTMLElement>('.image-display-controls');
    const error = root.querySelector<HTMLElement>('.image-display-error');
    const range = root.querySelector<HTMLInputElement>('input[type="range"]');
    const loaded = (img: HTMLImageElement | null) => Boolean(img?.complete && img.naturalWidth && img.dataset.imageFallback !== 'true');
    const failed = (img: HTMLImageElement | null) => Boolean(img?.complete && (!img.naturalWidth || img.dataset.imageFallback === 'true'));
    function setPosition(value: number) {
      const position = Math.max(0, Math.min(100, value));
      root.style.setProperty('--image-position', `${position}%`);
      if (range) range.value = String(position);
    }
    function update() {
      const beforeLoaded = loaded(before), afterLoaded = loaded(after);
      const aligned = before && after && Math.abs(before.naturalWidth / before.naturalHeight - after.naturalWidth / after.naturalHeight) < 0.01;
      const ready = Boolean(beforeLoaded && afterLoaded && aligned);
      root.dataset.ready = String(ready);
      if (controls) controls.hidden = !ready;
      if (beforeLayer) beforeLayer.hidden = !beforeLoaded && afterLoaded;
      if (afterLayer) afterLayer.hidden = !afterLoaded || (!ready && beforeLoaded);
      if (error) error.hidden = beforeLoaded || afterLoaded || !(failed(before) && (!after || failed(after)));
    }
    for (const img of [before, after]) {
      img?.addEventListener('load', update);
      img?.addEventListener('error', update);
    }
    range?.addEventListener('input', () => setPosition(Number(range.value)));
    let pointer: number | null = null;
    function move(event: PointerEvent) {
      const box = root.getBoundingClientRect();
      if (box.width) setPosition((event.clientX - box.left) / box.width * 100);
    }
    controls?.addEventListener('pointerdown', event => {
      if (root.dataset.ready !== 'true') return;
      event.preventDefault(); range?.focus(); pointer = event.pointerId;
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
    root.addEventListener('image-display:reset', () => setPosition(50));
    update();
  });
}
