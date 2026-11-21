(() => {
  const avatar_url = 'https://i.pravatar.cc/64?img=12'; // Replace with the S3 URL.
  const params = new URLSearchParams(location.search);
  if (params.get('project') !== 'satops_project' || params.get('repository') !== 'holycrop') return;
  if (window.holy_crap_loaded) return;
  window.holy_crap_loaded = true;
  window.holy_crap_version = '4';
  document.documentElement.dataset.holyCrap = '1';

  function formatValue(value, unit = '', digits = 2) {
    if (value === '' || value === undefined || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString('pl-PL', {maximumFractionDigits:digits}) + unit;
  }
  function openDetails(row, field_id) {
    const dialog = document.createElement('dialog');
    dialog.className = 'hc-dialog';
    dialog.setAttribute('aria-label', `Pole ${field_id}, ${row[0]}`);
    const heading = document.createElement('h2');
    heading.textContent = `Pole ${field_id} · ${row[0]}`;
    const list = document.createElement('dl');
    for (const [label, index, unit] of [['NDVI',1,''],['NDMI',2,''],['pH gleby (H₂O)',3,''],['Temperatura',4,' °C'],['Opad',5,' mm']]) {
      const term = document.createElement('dt');
      const value = document.createElement('dd');
      term.textContent = label;
      value.textContent = formatValue(row[index],unit);
      list.append(term,value);
    }
    const close_button = document.createElement('button');
    close_button.textContent = 'Zamknij';
    close_button.onclick = () => dialog.close();
    dialog.append(heading,list,close_button);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), {once:true});
    dialog.showModal();
  }
  function mountCard(card) {
    if (card.dataset.hcReady) return;
    const data_table = card.querySelector('.hc-source');
    if (!data_table) return;
    const days = card.querySelector('.hc-days');
    if (!days) return;
    card.dataset.hcReady = '1';
    // Remove only padding/background of this popup's wrappers.
    const popup_root = card.closest('#popupcontent');
    let wrapper = popup_root ? card.parentElement : null;
    while (wrapper && wrapper !== popup_root) {
      if (wrapper.tagName === 'DIV') wrapper.classList.add('hc-popup-wrap');
      wrapper = wrapper.parentElement;
    }
    const title = card.querySelector('h2');
    if (title) {
      const id_node = title.querySelector('.hc-field-id');
      if (id_node) {
        const suffix = document.createTextNode(' (x ha)');
        title.replaceChildren(document.createTextNode('Pole '),id_node,suffix);
      }
    }
    const rows = [...data_table.querySelectorAll('tr')].map(row => [...row.cells].map(cell => cell.textContent.trim()))
      .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row[0])).sort((a,b) => a[0].localeCompare(b[0]));
    const field_id = card.querySelector('.hc-field-id')?.textContent.trim() || '';
    const weekday_names = ['ND','PON','WT','ŚR','CZW','PT','SOB'];
    for (const row of rows) {
      const day = new Date(row[0] + 'T12:00:00');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hc-day';
      button.innerHTML = '<span></span><span class="hc-weather"><i class="hc-dot" aria-hidden="true"></i><span></span></span><span></span>';
      button.children[0].textContent = `${weekday_names[day.getDay()]} ${row[0].slice(8)}.${row[0].slice(5,7)}`;
      button.querySelector('.hc-weather span').textContent = formatValue(row[4],'°C',1);
      button.querySelector('.hc-dot').classList.toggle('hc-missing',row[4] === '');
      button.lastElementChild.textContent = formatValue(row[5],' mm',1);
      button.title = `${row[0]} · dane demonstracyjne; kropka oznacza dostępność temperatury`;
      button.setAttribute('aria-label',`Pomiary z ${row[0]}`);
      button.onclick = () => openDetails(row,field_id);
      days.append(button);
    }
    if (!rows.length) days.textContent = 'Brak pomiarów';
    requestAnimationFrame(() => {days.scrollTop = days.scrollHeight;});
    const context = card.nextElementSibling;
    if (context?.classList.contains('hc-context')) {
      const latest = rows.at(-1);
      const ph_row = rows.filter(row => row[3] !== '').at(-1);
      context.querySelector('[data-metric="ndvi"]').textContent = `NDVI: ${formatValue(latest?.[1])}`;
      context.querySelector('[data-metric="ndmi"]').textContent = `NDMI: ${formatValue(latest?.[2])}`;
      const ph_tag = context.querySelector('[data-metric="ph"]');
      ph_tag.textContent = `pH: ${formatValue(ph_row?.[3])}`;
      ph_tag.title = ph_row ? `Ostatni pomiar H₂O: ${ph_row[0]}` : 'Brak pomiaru pH';
    }
  }
  const icon_paths = {
  "home": "M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9",
  "pan": "M8 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v8c0 5-3 7-7 7-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 2Z",
  "zoom": "M4 4h16v16H4ZM9 12h6m-3-3v6",
  "extent": "M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6",
  "plus": "M12 4v16M4 12h16",
  "minus": "M4 12h16",
  "layers": "m3 7 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 17l9 5 9-5",
  "info": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 10v7m0-11v1",
  "popup": "M3 3h18v14H9l-6 4V3Z",
  "print": "M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6Z",
  "link": "m10 14 4-4m-6 6-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  "close": "m5 5 14 14M5 19 19 5",
  "search": "M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm5 11 6 6",
  "filter": "M3 4h18l-7 8v7l-4 2v-9Z",
  "refresh": "M20 7V2m0 5h-5M4 17v5m0-5h5M20 7a9 9 0 0 0-15-3M4 17a9 9 0 0 0 15 3",
  "collapse": "M3 8h5V3m13 5h-5V3M3 16h5v5m13-5h-5v5M3 3l5 5m13-5-5 5M3 21l5-5m13 5-5-5",
  "target": "M12 2v5m0 10v5M2 12h5m10 0h5M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z"

};
  function addIcon(button, name) {
    if (button.querySelector(':scope > svg.hc-icon')) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('class','hc-icon');
    svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('aria-hidden','true');
    svg.setAttribute('focusable','false');
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',icon_paths[name]);
    svg.append(path);
    if (!button.hasAttribute('aria-label')) {
      const label = button.getAttribute('title') || button.textContent.trim();
      if (label) button.setAttribute('aria-label',label);
    }
    button.append(svg);
    button.classList.add('hc-icon-button');
  }
  function updateHeader() {
    const admin_label = document.querySelector('#headermenu .dashboard-item .text.hidden-phone');
    if (admin_label && admin_label.textContent !== 'Panel Admina') admin_label.textContent = 'Panel Admina';
    const account = document.querySelector('#info-user');
    if (!account || account.dataset.hcAvatar) return;
    account.dataset.hcAvatar = '1';
    const photo = document.createElement('img');
    photo.className = 'hc-avatar';
    photo.alt = '';
    photo.width = 26;
    photo.height = 26;
    photo.referrerPolicy = 'no-referrer';
    photo.addEventListener('load', () => account.classList.add('hc-has-avatar'), {once:true});
    photo.addEventListener('error', () => photo.remove(), {once:true});
    photo.src = avatar_url;
    account.prepend(photo);
  }
  function updateGlyphs() {
    const glyphs = {'.icon-resize-full':'extent', '.icon-resize-small':'collapse', '.icon-screenshot':'target', '.icon-refresh':'refresh'};
    for (const [selector, name] of Object.entries(glyphs)) {
      document.querySelectorAll('#dock ' + selector + ', #right-dock ' + selector + ', #mini-dock ' + selector).forEach(icon => {
        if (icon.closest('.hc-icon-button') || icon.dataset.hcGlyph) return;
        icon.dataset.hcGlyph = '1';
        const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('viewBox','0 0 24 24');
        svg.setAttribute('aria-hidden','true');
        svg.setAttribute('focusable','false');
        const path = document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d',icon_paths[name]);
        svg.append(path);
        icon.append(svg);
        icon.classList.add('hc-glyph');
      });
    }
  }
  function updateControls() {
    const controls = {
      '#navbar .pan':'pan', '#navbar .zoom':'zoom', '#navbar .zoom-extent':'extent',
      '#navbar .zoom-in':'plus', '#navbar .zoom-out':'minus',
      '#button-switcher':'layers', '#button-metadata':'info', '#button-popupcontent':'popup',
      '#button-print':'print', '#button-permaLink':'link', '#button-filter':'filter',
      '#dock-close':'close', '#right-dock-close':'close', '#header-clear':'close',
      '#nominatim-search .nav-search':'search',
      '#layers-unfold-all':'extent', '#layers-fold-all':'collapse',
      '#overview-box .mouse-position > button.btn':'refresh'
    };
    for (const [selector, icon] of Object.entries(controls)) {
      document.querySelectorAll(selector).forEach(button => addIcon(button,icon));
    }
    const home_link = document.querySelector('#mapmenu .nav-list > li:first-child > a');
    if (home_link && !home_link.id && home_link.hasAttribute('href')) addIcon(home_link,'home');
    document.querySelectorAll('#switcher-layers-container .node label').forEach(label => {
      if (label.dataset.hcArea || label.textContent.trim() !== 'fields') return;
      label.dataset.hcArea = '1';
      label.append(document.createTextNode(' (x ha)'));
    });
  }
  function mountAll() {
    updateControls();
    updateGlyphs();
    updateHeader();
    document.querySelectorAll('.hc-field-card').forEach(card => {
      try { mountCard(card); } catch (error) { console.error('Holy Crop: popup',error); }
    });
  }
  function startTheme() {
    mountAll();
    let frame_pending = false;
    new MutationObserver(() => {
      if (frame_pending) return;
      frame_pending = true;
      requestAnimationFrame(() => {frame_pending = false; mountAll();});
    }).observe(document.body,{childList:true,subtree:true});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',startTheme,{once:true});
  else startTheme();
})();
