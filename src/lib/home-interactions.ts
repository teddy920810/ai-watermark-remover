/** Homepage illustrations never upload files or call processing providers. */
export function initializeHomeInteractions(root: HTMLElement) {
  const samples = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-hero-sample]'));
  const previews = Array.from(root.querySelectorAll<HTMLElement>('[data-hero-preview]'));
  samples.forEach((sample,index) => sample.addEventListener('click', () => {
    samples.forEach((button,i) => button.setAttribute('aria-pressed',String(index===i)));
    previews.forEach((preview,i) => { preview.hidden = index!==i; });
    previews[index]?.querySelector<HTMLElement>('[data-image-display]')?.dispatchEvent(new Event('image-display:reset'));
  }));

  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-scenario-tab]'));
  const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-scenario-panel]'));
  const select = (index: number, focus = false) => {
    const active = (index + tabs.length) % tabs.length;
    tabs.forEach((tab,i) => {tab.setAttribute('aria-selected',String(i===active));tab.tabIndex = i===active ? 0 : -1;});
    panels.forEach((panel,i) => {panel.hidden=i!==active;panel.classList.toggle('is-active',i===active);});
    panels[active]?.querySelector<HTMLElement>('[data-image-display]')?.dispatchEvent(new Event('image-display:reset'));
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
