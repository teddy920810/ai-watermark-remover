/** Homepage illustrations never upload files or call processing providers. */
export function initializeHomeInteractions(root: HTMLElement) {
  const applyPosition = (compare: HTMLElement | undefined, value: string) => {
    const range = compare?.querySelector<HTMLInputElement>('input[type="range"]');
    if (!compare || !range) return;
    range.value = value;
    compare.style.setProperty('--compare-position', `${value}%`);
  };
  root.querySelectorAll<HTMLElement>('[data-home-compare]').forEach(compare => {
    const range = compare.querySelector<HTMLInputElement>('input[type="range"]')!;
    const update = (value: number) => {
      range.value = String(Math.max(0, Math.min(100, value)));
      compare.style.setProperty('--compare-position', `${range.value}%`);
    };
    range.addEventListener('input', () => update(Number(range.value)));
    const fromPointer = (event: PointerEvent) => {
      const bounds = compare.getBoundingClientRect();
      update(Math.round(100 * (event.clientX - bounds.left) / bounds.width));
    };
    range.addEventListener('pointerdown', event => { range.setPointerCapture(event.pointerId); fromPointer(event); });
    range.addEventListener('pointermove', event => { if (range.hasPointerCapture(event.pointerId)) fromPointer(event); });
    range.addEventListener('pointerup', event => { if (range.hasPointerCapture(event.pointerId)) range.releasePointerCapture(event.pointerId); });
  });

  const samples = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-hero-sample]'));
  const previews = Array.from(root.querySelectorAll<HTMLElement>('[data-hero-preview]'));
  samples.forEach((sample,index) => sample.addEventListener('click', () => {
    const previous = previews.find(preview => !preview.hidden);
    const position = previous?.querySelector<HTMLInputElement>('input[type="range"]')?.value ?? '50';
    samples.forEach((button,i) => button.setAttribute('aria-pressed',String(index===i)));
    previews.forEach((preview,i) => { preview.hidden = index!==i; });
    applyPosition(previews[index]?.querySelector<HTMLElement>('[data-home-compare]') ?? undefined, position);
  }));

  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-scenario-tab]'));
  const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-scenario-panel]'));
  const select = (index: number, focus = false) => {
    const previous = panels.find(panel => !panel.hidden);
    const position = previous?.querySelector<HTMLInputElement>('input[type="range"]')?.value ?? '50';
    const active = (index + tabs.length) % tabs.length;
    tabs.forEach((tab,i) => {tab.setAttribute('aria-selected',String(i===active));tab.tabIndex = i===active ? 0 : -1;});
    panels.forEach((panel,i) => {panel.hidden=i!==active;panel.classList.toggle('is-active',i===active);});
    applyPosition(panels[active]?.querySelector<HTMLElement>('[data-home-compare]') ?? undefined, position);
    if(focus) tabs[active].focus();
    const tablist = tabs[active].parentElement;
    if (tablist && tablist.scrollWidth > tablist.clientWidth) {
      tablist.scrollTo({ left:Math.max(0,tabs[active].offsetLeft-(tablist.clientWidth-tabs[active].offsetWidth)/2), behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth' });
    }
  };
  tabs.forEach((tab,index) => {
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown',event => {
      const next = event.key==='ArrowRight'?index+1:event.key==='ArrowLeft'?index-1:event.key==='Home'?0:event.key==='End'?tabs.length-1:undefined;
      if(next!==undefined){event.preventDefault();select(next,true);}
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-scenario-direction]').forEach(button => button.addEventListener('click', () => {
    const index = tabs.findIndex(tab=>tab.getAttribute('aria-selected')==='true');
    select(index+(button.dataset.scenarioDirection==='next'?1:-1));
  }));
  const toggle = root.querySelector<HTMLButtonElement>('[data-reviews-toggle]');
  const marquee = root.querySelector<HTMLElement>('[data-reviews-marquee]');
  toggle?.addEventListener('click',()=>{
    const paused=toggle.getAttribute('aria-pressed')!=='true';
    toggle.setAttribute('aria-pressed',String(paused));
    toggle.textContent=(paused?toggle.dataset.playLabel:toggle.dataset.pauseLabel)??'';
    marquee?.classList.toggle('is-paused',paused);
  });
}
