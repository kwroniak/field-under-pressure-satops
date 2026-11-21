(() => {
  const avatar_url = 'https://i.pravatar.cc/64?img=12'; // Replace with the S3 URL.
  const params = new URLSearchParams(location.search);
  if (params.get('project') !== 'satops_project' || params.get('repository') !== 'holycrop') return;
  if (window.holy_crap_loaded) return;
  window.holy_crap_loaded = true;
  window.holy_crap_version = '6';
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
    document.querySelectorAll('#nav-tab-popupcontent a').forEach(link => {
      const text_nodes = [...link.childNodes].filter(node => node.nodeType === 3 && node.textContent.trim());
      for (const node of text_nodes) {
        if (node.textContent.trim() === 'Popup') node.textContent = 'Informacje o polu';
      }
      link.querySelectorAll('span').forEach(span => {
        if (!span.children.length && span.textContent.trim() === 'Popup') span.textContent = 'Informacje o polu';
      });
      if (link.title === 'Popup') link.title = 'Informacje o polu';
    });
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
      '#dock-close':'close', '#right-dock-close':'close', '#header-clear':'close',
      '#nominatim-search .nav-search':'search',
      '#layers-unfold-all':'extent', '#layers-fold-all':'collapse',
      '#overview-box .mouse-position > button.btn':'refresh'
    };
    for (const [selector, icon] of Object.entries(controls)) {
      document.querySelectorAll(selector).forEach(button => addIcon(button,icon));
    }
  }
  function mountAll() {
    updateControls();
    updateGlyphs();
    updateHeader();
    document.querySelectorAll('.hc-field-card').forEach(card => {
      if (!card.querySelector('.hc-source')) return;
      card.classList.remove('hc-field-card');
      card.classList.add('fc');
      card.querySelector('.hc-source').classList.replace('hc-source','fc-data');
      card.querySelector('.hc-field-id')?.classList.replace('hc-field-id','fc-field');
      card.querySelector('.hc-days')?.remove();
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

(() => {
  if (window.field_calendar_loaded) return;
  window.field_calendar_loaded = true;
  const style = document.createElement('style');
  style.textContent = `
  .fc,.fc-dialog{font:14px/1.5 system-ui,sans-serif;color:#e8edf5;background:#151c2a;box-sizing:border-box}
  .fc *,.fc-dialog *{box-sizing:border-box}
  .fc{padding:22px;border:1px solid #303b4e;border-radius:18px;width:100%;max-width:470px}
  .fc .fc-data{display:none!important}
  .fc small,.fc-dialog small{color:#9baac0;display:block;font-size:12px}
  .fc h2{font-size:24px;margin:4px 0 20px;color:inherit;line-height:1.3}
  .fc-top,.fc-nav{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .fc-badge{font-size:10px;color:#65dfae;border:1px solid #30634f;padding:4px 8px;border-radius:20px;white-space:nowrap}
  .fc-nav{margin:16px 0}.fc-nav strong{text-transform:capitalize;font-size:16px}
  .fc button,.fc-dialog button{font:inherit;cursor:pointer;color:inherit;background:#202b3c;border:1px solid #34435a;border-radius:9px;padding:6px 12px;box-shadow:none;text-shadow:none}
  .fc button:hover,.fc-dialog button:hover{border-color:#65dfae}
  .fc button:focus-visible,.fc-dialog button:focus-visible{outline:2px solid #65dfae;outline-offset:2px}
  .fc-week,.fc-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
  .fc-week{text-align:center;color:#9baac0;font-size:11px;margin-bottom:9px}
  .fc-grid button{position:relative;aspect-ratio:1;padding:0;min-width:0;border-color:transparent;background:#1b2433}
  .fc-grid button.fc-record{background:#203e36;border-color:#37634f;color:#b7f7d9;font-weight:650}
  .fc-grid button.fc-record:after{content:'';position:absolute;bottom:5px;left:calc(50% - 2px);width:4px;height:4px;border-radius:50%;background:#69e6ac}
  .fc-grid button.fc-today{outline:1px solid #9baac0;outline-offset:-3px}
  .fc-foot{border-top:1px solid #303b4e;margin-top:19px;padding-top:13px;font-size:11px;color:#9baac0;display:flex;justify-content:space-between;gap:8px}
  .fc-dot{color:#69e6ac}.fc-empty{margin:12px 0 0;color:#9baac0;font-size:12px}
  .fc-dialog{border:1px solid #40516a;border-radius:18px;width:min(440px,calc(100vw - 24px));padding:24px;max-height:85vh;overflow:auto;box-shadow:0 25px 100px #0008}
  .fc-dialog::backdrop{background:#070e1bc9;backdrop-filter:blur(4px)}
  .fc-dialog h3{font-size:24px;margin:5px 0 20px;color:inherit}
  .fc-metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .fc-metric{padding:16px;background:#202b3c;border-radius:12px}.fc-metric strong{font-size:26px;font-weight:600;display:block;margin-top:6px}
  .fc-dialog p{color:#9baac0;font-size:12px}.fc-dialog form{margin:18px 0 0;text-align:right}
  .fc-grid button.fc-s-ZIELONY,.fc-assess.fc-s-ZIELONY{background:#1f4a35;border-color:#3f8f62;color:#c9f7dd}
  .fc-grid button.fc-s-ZOLTY,.fc-assess.fc-s-ZOLTY{background:#4a4220;border-color:#a08a2e;color:#fbeaa6}
  .fc-grid button.fc-s-CZERWONY,.fc-assess.fc-s-CZERWONY{background:#4a2024;border-color:#a0434b;color:#ffc9cd}
  .fc-assess{padding:14px 16px;margin:0 0 10px;border:1px solid #34435a;border-radius:12px;background:#202b3c}
  .fc-assess strong{display:block;font-size:18px;margin:2px 0 6px}.fc-assess ul{margin:0;padding-left:18px;font-size:12px}
  .fc-legend span{margin-right:8px}.fc-legend .g{color:#69e6ac}.fc-legend .y{color:#e8c95a}.fc-legend .r{color:#ef7b85}
  @media(max-width:380px){.fc{padding:12px}.fc-grid{gap:3px}.fc-badge{font-size:9px}}
  `;
  document.head.append(style);

  const status_labels = {ZIELONY:'Korzystne warunki', ZOLTY:'Warunki warunkowe', CZERWONY:'Przeciwwskazane'};
  const irrigation_labels = {NISKIE:'niskie', UMIARKOWANE:'umiarkowane', WYSOKIE:'wysokie'};

  function assessmentBox(css_class, caption, title, reasons) {
    const box = document.createElement('div');
    box.className = 'fc-assess ' + css_class;
    box.innerHTML = '<small></small><strong></strong><ul></ul>';
    box.querySelector('small').textContent = caption;
    box.querySelector('strong').textContent = title;
    for (const reason of (reasons || '').split(' | ').filter(Boolean)) {
      const item = document.createElement('li');
      item.textContent = reason;
      box.querySelector('ul').append(item);
    }
    return box;
  }

  function openDetails(date_key, record, field_id, fertilizer_label) {
    const dialog = document.createElement('dialog');
    dialog.className = 'fc-dialog';
    const date_label = new Date(date_key + 'T12:00:00').toLocaleDateString('pl-PL', {day:'numeric',month:'long',year:'numeric'});
    dialog.innerHTML = `<small></small><h3></h3><div class="fc-assessments"></div><div class="fc-metrics"></div><p></p><form method="dialog"><button>Zamknij</button></form>`;
    dialog.querySelector('small').textContent = `POLE ${field_id} · OCENA DNIA`;
    dialog.querySelector('h3').textContent = date_label;
    dialog.setAttribute('aria-label', `Ocena: ${date_label}`);
    if (record?.[7]) {
      const assessments = dialog.querySelector('.fc-assessments');
      assessments.append(assessmentBox('fc-s-' + record[7], `Nawożenie · ${fertilizer_label || record[6]}`, status_labels[record[7]] || record[7], record[8]));
      if (record[9]) assessments.append(assessmentBox('', 'Nawadnianie', `Ryzyko niedoboru wody: ${irrigation_labels[record[9]] || record[9]}`, record[10]));
    }
    const metrics = [['NDVI',1,''],['NDMI',2,''],['pH gleby · H₂O',3,''],['Temperatura średnia',4,' °C'],['Suma opadu',5,' mm']];
    for (const [label, index, unit] of metrics) {
      const card = document.createElement('div');
      card.className = 'fc-metric';
      card.innerHTML = '<small></small><strong></strong>';
      card.querySelector('small').textContent = label;
      const value = record?.[index];
      card.querySelector('strong').textContent = value === undefined || value === '' ? '—' : Number(value).toLocaleString('pl-PL', {maximumFractionDigits:2}) + unit;
      dialog.querySelector('.fc-metrics').append(card);
    }
    dialog.querySelector('p').textContent = record ? '— oznacza brak danych. Kolor dnia ocenia warunki wykonania zabiegu (pogoda, gleba, uprawa), a nie potwierdza potrzeby nawożenia. pH pochodzi z modelu gleby (SoilGrids).' : 'Brak oceny dla tego dnia.';
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), {once:true});
    dialog.showModal();
  }

  function mountCalendar(root) {
    if (root.dataset.ready) return;
    const rows = [...root.querySelectorAll('.fc-data tr')].map(row => [...row.cells].map(cell => cell.textContent.trim()));
    // Kolumny: 0 data, 1 ndvi, 2 ndmi, 3 ph, 4 temp, 5 opad, 6 nawóz, 7 status, 8 uzasadnienie, 9 nawadnianie, 10 uzasadnienie nawadniania
    const records = new Map();
    rows.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row[0])).forEach(row => {
      if (!records.has(row[0])) records.set(row[0], {});
      records.get(row[0])[row[6] || ''] = row;
    });
    root.dataset.ready = '1';
    const field_id = root.querySelector('.fc-field').textContent.trim();
    const fertilizer_select = root.nextElementSibling?.querySelector('.fc-fertilizer');
    const pickRow = date_key => {
      const by_fertilizer = records.get(date_key);
      if (!by_fertilizer) return undefined;
      return by_fertilizer[fertilizer_select?.value] || Object.values(by_fertilizer)[0];
    };
    const latest_date = [...records.keys()].sort().pop();
    const month = latest_date ? new Date(latest_date + 'T12:00:00') : new Date();
    month.setDate(1);
    const view = document.createElement('div');
    root.append(view);
    function renderMonth() {
      view.innerHTML = `<div class="fc-nav"><button type="button" aria-label="Poprzedni miesiąc">‹</button><strong></strong><button type="button" aria-label="Następny miesiąc">›</button></div><div class="fc-week">${['Pon','Wt','Śr','Czw','Pt','Sob','Nd'].map(day => `<span>${day}</span>`).join('')}</div><div class="fc-grid"></div><div class="fc-foot"><span class="fc-legend"><span class="g">● korzystne</span><span class="y">● warunkowe</span><span class="r">● przeciwwskazane</span></span><span>Kliknij dzień</span></div>`;
      view.querySelector('strong').textContent = month.toLocaleDateString('pl-PL',{month:'long',year:'numeric'});
      const nav_buttons = view.querySelectorAll('.fc-nav button');
      nav_buttons.forEach((button,index) => button.onclick = () => {month.setMonth(month.getMonth() + (index ? 1 : -1)); renderMonth();});
      const grid = view.querySelector('.fc-grid');
      const offset = (month.getDay() + 6) % 7;
      for (let i = 0; i < offset; i++) grid.append(document.createElement('span'));
      const day_count = new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
      const today = new Date();
      for (let day = 1; day <= day_count; day++) {
        const date_key = `${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = day;
        const record = pickRow(date_key);
        button.classList.toggle('fc-record',records.has(date_key));
        if (record?.[7]) button.classList.add('fc-s-' + record[7]);
        button.classList.toggle('fc-today',today.getFullYear()===month.getFullYear() && today.getMonth()===month.getMonth() && today.getDate()===day);
        button.setAttribute('aria-label',`${date_key}: ${record?.[7] ? (status_labels[record[7]] || record[7]) : 'brak oceny'}`);
        button.onclick = () => openDetails(date_key,record,field_id,fertilizer_select?.selectedOptions[0]?.textContent);
        grid.append(button);
      }
    }
    if (fertilizer_select) fertilizer_select.onchange = renderMonth;
    renderMonth();
  }
  function mountAll() {document.querySelectorAll('.fc').forEach(mountCalendar);}
  new MutationObserver(mountAll).observe(document.body,{childList:true,subtree:true});
  if (window.lizMap?.events) {
    lizMap.events.on({lizmappopupdisplayed:mountAll, lizmappopupallchildrendisplayed:mountAll});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mountAll);
  else mountAll();
})();

(() => {
    function updateCalendarTitle() {
        document.querySelectorAll('#popupcontent .lizmapPopupTitle')
            .forEach(title => {
                if (title.textContent.trim() !== 'Kalendarz') {
                    title.textContent = 'Kalendarz';
                }
            });
    }

    updateCalendarTitle();
    new MutationObserver(updateCalendarTitle)
        .observe(document.body, { childList: true, subtree: true });
})();

(() => {
    // Większe ikony: lewe menu (30 -> 44 px) i przyciski mapy po prawej
    const style = document.createElement('style');
    style.textContent = `
    #mapmenu{width:44px!important}
    #docks-wrapper{left:44px!important}
    #mapmenu li > a{width:44px!important;height:44px!important;display:flex!important;align-items:center;justify-content:center}
    #mapmenu li > a > .icon{transform:scale(1.4);transform-origin:center}
    #navbar button,#navbar .btn{width:38px!important;height:38px!important;min-width:38px}
    #navbar button svg,#navbar .btn svg,#navbar .icon{width:22px!important;height:22px!important}
    #navbar .slider{height:140px}
    #dock .icon,#right-dock .icon,#mini-dock .icon{transform:scale(1.25)}
    `;
    document.head.append(style);
})();

(() => {
    // Podświetlenie klikniętego pola (zielone wypełnienie) + etykieta "Pole X (Y ha)" z pinezką
    if (window.hc_field_label_loaded) return;
    window.hc_field_label_loaded = true;
    const style = document.createElement('style');
    style.textContent = `
    .hc-pin{position:absolute;transform:translate(-50%,-100%);pointer-events:none;z-index:5;display:flex;flex-direction:column;align-items:center}
    .hc-pin-label{background:#1c2a1ee6;color:#fff;font:700 14px/1.2 system-ui,sans-serif;padding:7px 11px;border-radius:9px;border:1px solid #9be36a;white-space:nowrap;box-shadow:0 4px 14px #0007}
    .hc-pin-label span{font-weight:500;color:#cfe9c0}
    .hc-pin svg{width:22px;height:30px;margin-top:3px;filter:drop-shadow(0 2px 3px #0008)}
    `;
    document.head.append(style);

    let field_layer = null, pin = null, pin_coordinate = null;

    function getMap() { return window.lizMap?.mainLizmap?.map; }

    function ensureLayer(map) {
        if (field_layer) return field_layer;
        const highlight = map._highlightLayer;
        field_layer = new highlight.constructor({
            source: new (highlight.getSource().constructor)(),
            style: {'fill-color':'rgba(140,230,70,0.55)','stroke-color':'#c6ff7a','stroke-width':3},
        });
        field_layer.setZIndex(1000);
        map.addLayer(field_layer);
        map.on('postrender', placePin);
        return field_layer;
    }

    function placePin() {
        const map = getMap();
        if (!pin || !pin_coordinate || !map) return;
        const pixel = map.getPixelFromCoordinate(pin_coordinate);
        if (!pixel) return;
        pin.style.left = pixel[0] + 'px';
        pin.style.top = pixel[1] + 'px';
    }

    function clearField() {
        field_layer?.getSource().clear();
        pin?.remove();
        pin = null;
        pin_coordinate = null;
    }

    function showField() {
        const map = getMap();
        const feature_div = document.querySelector('#popupcontent .lizmapPopupSingleFeature[data-layer-id^="fields_"]');
        const wkt = feature_div?.querySelector('.lizmap-popup-layer-feature-geometry')?.value;
        if (!map || !wkt) return;
        const crs = feature_div.querySelector('.lizmap-popup-layer-feature-crs')?.value || 'EPSG:3857';
        const field_id = feature_div.dataset.featureId;
        if (pin && pin.dataset.fieldId === field_id) return;

        // Geometria przez mechanizm podświetlenia Lizmapa, potem przeniesiona do własnej warstwy
        map.setHighlightFeatures(wkt, 'wkt', crs);
        const features = map._highlightLayer.getSource().getFeatures().map(f => f.clone());
        map.clearHighlightFeatures();
        if (!features.length) return;
        clearField();
        ensureLayer(map).getSource().addFeatures(features);

        const geometry = features[0].getGeometry();
        const type = geometry.getType();
        pin_coordinate = type === 'Polygon' ? geometry.getInteriorPoint().getCoordinates()
            : type === 'MultiPolygon' ? geometry.getInteriorPoints().getCoordinateAt(0)
            : null;
        if (!pin_coordinate) {
            const e = geometry.getExtent();
            pin_coordinate = [(e[0] + e[2]) / 2, (e[1] + e[3]) / 2];
        }
        // Powierzchnia: planarna w 3857 przeskalowana cos^2(szer.) ~ powierzchnia rzeczywista
        const lat = Math.atan(Math.sinh(pin_coordinate[1] / 6378137));
        const area_ha = geometry.getArea() * Math.cos(lat) ** 2 / 10000;

        pin = document.createElement('div');
        pin.className = 'hc-pin';
        pin.dataset.fieldId = field_id;
        pin.innerHTML = '<div class="hc-pin-label"></div><svg viewBox="0 0 24 32"><path d="M12 31s10-11.2 10-19A10 10 0 0 0 2 12c0 7.8 10 19 10 19Z" fill="#8fe35a" stroke="#1c2a1e" stroke-width="1.5"/><circle cx="12" cy="12" r="4" fill="#1c2a1e"/></svg>';
        const label = pin.querySelector('.hc-pin-label');
        label.textContent = `Pole ${field_id} `;
        const area = document.createElement('span');
        area.textContent = `(${area_ha.toFixed(2)} ha)`;
        label.append(area);
        map.getViewport().append(pin);
        placePin();
    }

    function start() {
        if (!window.lizMap?.events || !getMap()) { setTimeout(start, 500); return; }
        lizMap.events.on({
            lizmappopupdisplayed: () => setTimeout(showField, 0),
            dockclosed: evt => { if (!evt?.id || evt.id === 'popupcontent') clearField(); },
            dockopened: evt => { if (evt?.id === 'popupcontent') setTimeout(showField, 0); },
        });
    }
    start();
})();

(() => {
    // Czytelność: większe napisy w dockach, popupie, kalendarzu i drzewie warstw
    const style = document.createElement('style');
    style.textContent = `
    #dock{width:min(640px,46vw)!important;font-size:15px}
    #dock .tab-content,#dock .tab-pane,#right-dock,#mini-dock{font-size:15px}
    #dock .nav-tabs > li > a,#nav-tab-popupcontent a{font-size:16px!important;padding:10px 14px}
    #popupcontent .lizmapPopupTitle{font-size:20px!important}
    #switcher-layers-container,#switcher-layers-container label,#switcher-baselayer{font-size:15px!important}
    .fc{max-width:none!important;font-size:15px}
    .fc .hc-heading,.fc .hc-heading span{font-size:13px!important;letter-spacing:.04em}
    .fc h2{font-size:26px!important}
    .fc p{font-size:15px}
    .fc-nav strong{font-size:18px!important}
    .fc-week{font-size:14px!important}
    .fc-grid button{font-size:16px!important}
    .fc-foot,.fc-empty{font-size:14px!important}
    .fc small,.fc-dialog small{font-size:13px!important}
    .fc-dialog{width:min(520px,calc(100vw - 24px))!important;font-size:15px}
    .fc-dialog h3{font-size:26px!important}
    .fc-assess strong{font-size:20px!important}.fc-assess ul{font-size:14px!important}
    .fc-metric strong{font-size:28px!important}
    .fc-dialog p{font-size:14px!important}
    .hc-context,.hc-context label,.hc-context select{font-size:15px!important}
    .hc-context select{height:38px;padding:6px 10px}
    .hc-tag{font-size:14px!important;padding:5px 9px!important}
    .hc-pin-label{font-size:16px!important}
    `;
    document.head.append(style);
})();

(() => {
    // Nagłówek: logo + napis "Holy Crop!", szeroki search, czytelne przyciski po prawej; większy pasek skali
    const style = document.createElement('style');
    style.textContent = `
    #title{display:none!important}
    #hc-brand{position:absolute;left:150px;top:0;height:75px;display:flex;align-items:center;font:800 34px/1 system-ui,sans-serif;color:#fff;letter-spacing:-.01em;z-index:1031;pointer-events:none;white-space:nowrap}
    #hc-brand b{color:#7fe3c4;font-weight:800;margin-left:10px}
    #nominatim-search{left:50%!important;right:auto!important;top:16px!important;transform:translateX(-50%);width:460px!important}
    #nominatim-search #search-query{width:460px!important;height:44px!important;font-size:15px!important;border-radius:22px!important;padding:0 48px 0 18px!important;background:#1b2436!important;border:1px solid #33415a!important;color:#e8edf5!important;box-shadow:none!important}
    #nominatim-search .search-icon{position:absolute!important;right:12px!important;top:9px!important}
    #nominatim-search .search-icon svg,#nominatim-search .search-icon .hc-icon{width:22px!important;height:22px!important}
    #headermenu ul.nav{align-items:center;gap:16px;margin-right:20px!important}
    #headermenu .dashboard-item a{display:flex!important;align-items:center;gap:8px;font-size:15px!important;color:#dfe6f0!important;padding:8px 6px!important}
    #headermenu .dashboard-item .dashboard-icon{display:none!important}
    #headermenu .dashboard-item .hc-folder{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8}
    #info-user{display:flex!important;align-items:center;gap:10px;font-size:15px!important;color:#e8edf5!important;background:#1b2436!important;border:1px solid #33415a!important;border-radius:24px!important;padding:5px 14px 5px 5px!important;height:auto!important}
    #info-user > .icon{display:none!important}
    #info-user .hc-avatar{width:34px!important;height:34px!important;border-radius:50%;object-fit:cover}
    #info-user .caret{margin-left:4px}
    #overview-box{transform:scale(1.35);transform-origin:bottom right}
    `;
    document.head.append(style);

    function updateBrand() {
        const header = document.querySelector('#header');
        if (header && !document.querySelector('#hc-brand')) {
            const brand = document.createElement('div');
            brand.id = 'hc-brand';
            brand.innerHTML = 'Holy<b>Crop!</b>';
            header.append(brand);
        }
        const dash = document.querySelector('#headermenu .dashboard-item a');
        if (dash && !dash.querySelector('.hc-folder')) {
            dash.insertAdjacentHTML('afterbegin', '<svg class="hc-folder" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z"/></svg>');
        }
        const login = document.querySelector('#info-user-login');
        if (login && !login.dataset.hcRole) {
            login.dataset.hcRole = '1';
            login.textContent = `Rolnik (${login.textContent.trim()})`;
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updateBrand, {once:true});
    else updateBrand();
    setTimeout(updateBrand, 1500);
})();


(() => {
    // Poprawki: wyższy nagłówek (88 px), większe logo i przyciski, search w jednej linii,
    // lewe menu bez paska przewijania, aktywny przycisk mapy w kolorze akcentu, działający suwak zoomu
    const style = document.createElement('style');
    style.textContent = `
    body{padding-top:88px!important}
    #header,#headermenu{height:88px!important}
    #logo{width:110px!important;height:86px!important;margin-top:1px!important;background-size:auto 140%!important;margin-left:18px!important;background-position:center!important}
    #hc-brand{left:136px!important;height:88px!important;font-size:38px!important}
    #nominatim-search{top:20px!important;height:48px!important;transform:translateX(-50%)!important}
    #nominatim-search #search-query{margin:0!important;top:0!important;height:48px!important;font-size:16px!important;border-radius:24px!important}
    #nominatim-search .search-icon{top:50%!important;transform:translateY(-50%)}
    #headermenu ul.nav{height:88px;gap:18px}
    #headermenu .dashboard-item a{font-size:16px!important;padding:11px 18px!important;border:1px solid #33415a;border-radius:24px;background:#1b2436}
    #headermenu .dashboard-item .hc-folder{width:22px;height:22px}
    #info-user{font-size:16px!important;padding:6px 18px 6px 6px!important;border-radius:28px!important}
    #info-user .hc-avatar{width:40px!important;height:40px!important}
    #headermenu .dashboard-item a:hover,#info-user:hover{border-color:#7fe3c4!important}
    #mapmenu,#mapmenu > div,#mapmenu ul.nav-list{width:44px!important;overflow:hidden!important}
    #mapmenu ul.nav-list > li{width:44px!important}
    #navbar button.btn{width:40px!important;height:40px!important;min-width:40px}
    #navbar button.btn svg{width:22px!important;height:22px!important}
    #navbar button.btn.active,#navbar button.btn:focus,#navbar button.btn:active{background:#1f4a3b!important;border-color:#7fe3c4!important;color:#e6fff5!important;box-shadow:none!important;outline:none!important}
    #navbar button.btn:hover{border-color:#7fe3c4!important}
    #navbar .slider{height:160px!important;width:40px!important;display:flex;justify-content:center}
    #navbar .ol-zoomslider{height:100%!important;width:6px!important;border-radius:3px;background:#33415a!important}
    #navbar .ol-zoomslider-thumb{width:26px!important;height:12px!important;min-width:0!important;left:-10px!important;border-radius:6px!important;background:#7fe3c4!important;border:0!important;padding:0!important}
    #popupcontent .feature-toolbar .btn,#popupcontent .feature-toolbar button{width:38px!important;height:34px!important;padding:6px!important}
    #popupcontent .feature-toolbar .icon,#popupcontent .feature-toolbar [class^='icon-']{transform:scale(1.4)}
    `;
    document.head.append(style);

    function fixZoomSlider() {
        const map = window.lizMap?.mainLizmap?.map;
        if (!map) { setTimeout(fixZoomSlider, 500); return; }
        // Suwak OpenLayers liczy zakres raz, przy pierwszym renderze: po zmianie wysokości liczymy go od nowa
        map.getControls().getArray().filter(c => 'sliderInitialized_' in c).forEach(c => { c.sliderInitialized_ = false; });
        map.updateSize();
        map.render();
    }
    window.addEventListener('load', () => { window.dispatchEvent(new Event('resize')); setTimeout(fixZoomSlider, 300); });
    setTimeout(fixZoomSlider, 1500);
})();

(() => {
    // Panel "Warstwy mapy": karty warstw z przełącznikiem i kryciem + kafelki map podkładowych
    if (window.hc_layers_loaded) return;
    window.hc_layers_loaded = true;
    const layer_names = {fields: 'Granice pól (≥ 3 ha analizowane)'};
    const style = document.createElement('style');
    style.textContent = `
    #switcher-layers-container.hc-hidden,#switcher-baselayer.hc-hidden{display:none!important}
    #nav-tab-switcher a{display:flex!important;align-items:center;gap:10px;font-size:18px!important;font-weight:700}
    #nav-tab-switcher a::before,#nav-tab-switcher a > .icon{display:none!important}
    #nav-tab-switcher a svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8}
    .hc-layers{padding:14px;color:#e8edf5;font:15px/1.4 system-ui,sans-serif}
    .hc-layer{background:#1b2436;border:1px solid #33415a;border-radius:14px;padding:14px 16px;margin-bottom:12px}
    .hc-layer-top{display:flex;align-items:center;gap:14px}
    .hc-layer-name{flex:1;font-size:16px;font-weight:600}
    .hc-switch{position:relative;width:46px;height:26px;flex:none}
    .hc-switch input{opacity:0;width:0;height:0;position:absolute}
    .hc-switch span{position:absolute;inset:0;border-radius:13px;background:#3a475c;cursor:pointer;transition:background .15s}
    .hc-switch span:before{content:'';position:absolute;width:20px;height:20px;left:3px;top:3px;border-radius:50%;background:#fff;transition:transform .15s}
    .hc-switch input:checked + span{background:#2fbf8f}
    .hc-switch input:checked + span:before{transform:translateX(20px)}
    .hc-switch input:focus-visible + span{outline:2px solid #7fe3c4;outline-offset:2px}
    .hc-swatch{width:30px;height:24px;flex:none}
    .hc-opacity{display:flex;align-items:center;gap:12px;margin-top:12px;font-size:14px;color:#b8c4d6}
    .hc-opacity span{min-width:92px}
    .hc-opacity input{flex:1;accent-color:#7fe3c4}
    .hc-layer.hc-off .hc-opacity{opacity:.45}
    .hc-section{display:flex;align-items:center;justify-content:space-between;margin:22px 2px 12px;font-size:15px;color:#b8c4d6}
    .hc-bases{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .hc-base{background:#1b2436;border:1px solid #33415a;border-radius:12px;padding:6px;cursor:pointer;text-align:left;color:#e8edf5;font:15px system-ui,sans-serif}
    .hc-base img,.hc-base .hc-thumb{display:block;width:100%;height:84px;object-fit:cover;border-radius:8px;background:linear-gradient(135deg,#2a3a52,#1c2a3e)}
    .hc-base div{padding:8px 4px 4px}
    .hc-base.hc-active{border:2px solid #7fe3c4;box-shadow:0 0 0 3px #7fe3c422}
    .hc-base.hc-active div{color:#7fe3c4}
    `;
    document.head.append(style);

    const layers_icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 7 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 17l9 5 9-5"/></svg>';
    const swatch = '<svg class="hc-swatch" viewBox="0 0 30 24" aria-hidden="true"><path d="M3 6 14 2l13 5-3 14-16 1Z" fill="#2fbf8f" fill-opacity=".85" stroke="#7fe3c4" stroke-width="1.5"/></svg>';

    function osmThumb() {
        // Kafel OSM z okolicy pól (z=14) jako miniatura
        const lat = 52.10, lon = 19.95, z = 14, n = 2 ** z;
        const x = Math.floor((lon + 180) / 360 * n);
        const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
        return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    }

    function layerCard(layer) {
        const card = document.createElement('div');
        card.className = 'hc-layer' + (layer.checked ? '' : ' hc-off');
        card.innerHTML = `<div class="hc-layer-top"><label class="hc-switch"><input type="checkbox"><span></span></label><div class="hc-layer-name"></div>${swatch}</div><div class="hc-opacity"><span></span><input type="range" min="0" max="100" step="5"></div>`;
        const name = layer_names[layer.name] || layer.wmsTitle || layer.name;
        card.querySelector('.hc-layer-name').textContent = name;
        const toggle = card.querySelector('.hc-switch input');
        toggle.checked = layer.checked;
        toggle.setAttribute('aria-label', name);
        toggle.onchange = () => { layer.checked = toggle.checked; card.classList.toggle('hc-off', !toggle.checked); };
        const range = card.querySelector('.hc-opacity input');
        const label = card.querySelector('.hc-opacity span');
        range.value = Math.round(layer.opacity * 100);
        label.textContent = `Krycie: ${range.value}%`;
        range.setAttribute('aria-label', `Krycie: ${name}`);
        range.oninput = () => { layer.opacity = range.value / 100; label.textContent = `Krycie: ${range.value}%`; };
        return card;
    }

    function tileXYZ(z) {
        // Kafel z widoku mapy (EPSG:3857), a gdy mapa jeszcze nie gotowa - okolica pól
        const center = window.lizMap?.mainLizmap?.map?.getView?.()?.getCenter?.();
        const n = 2 ** z, half = 20037508.342789244;
        if (center && Number.isFinite(center[0])) {
            return [z, Math.floor((center[0] + half) / (2 * half) * n), Math.floor((half - center[1]) / (2 * half) * n)];
        }
        const [, x, y] = osmThumb().match(/(\d+)\/(\d+)\/(\d+)\.png$/).slice(1).map(Number);
        return [14, x, y];
    }

    function thumbUrl(base) {
        const url = base?.url;
        if (!url || base.type !== 'xyz' || !/\{z\}/.test(url)) return null;
        const z = Math.min(14, Number.isFinite(base.zmax) ? base.zmax : 14);
        const [tz, x, y] = tileXYZ(z);
        return url.replace('{z}', tz).replace('{x}', x).replace('{-y}', 2 ** tz - 1 - y).replace('{y}', y).replace('{s}', 'a');
    }

    function baseTitle(base, base_name) {
        const url = base?.url || '';
        if (/World_Imagery/i.test(url)) return 'Satelita (Esri)';
        if (/opentopomap/i.test(url)) return 'Mapa topograficzna';
        if (/openstreetmap/i.test(url)) return 'Mapa OSM';
        return base?.title || base_name;
    }

    function baseCard(state, base_name, grid) {
        const base = state.baseLayers.getBaseLayerByName?.(base_name);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'hc-base' + (state.baseLayers.selectedBaseLayerName === base_name ? ' hc-active' : '');
        card.innerHTML = '<span class="hc-thumb"></span><div></div>';
        const src = thumbUrl(base);
        if (src) {
            const img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            img.onerror = () => img.replaceWith(Object.assign(document.createElement('span'), {className: 'hc-thumb'}));
            img.src = src;
            card.querySelector('.hc-thumb').replaceWith(img);
        }
        card.querySelector('div').textContent = baseTitle(base, base_name);
        card.onclick = () => {
            state.baseLayers.selectedBaseLayerName = base_name;
            grid.querySelectorAll('.hc-base').forEach(b => b.classList.toggle('hc-active', b === card));
        };
        return card;
    }

    function build() {
        const state = window.lizMap?.mainLizmap?.state;
        const switcher = document.querySelector('#switcher');
        if (!state?.rootMapGroup || !switcher) { setTimeout(build, 500); return; }
        if (switcher.querySelector('.hc-layers')) return;

        const tab = document.querySelector('#nav-tab-switcher a');
        if (tab && !tab.dataset.hcTab) {
            tab.dataset.hcTab = '1';
            tab.innerHTML = layers_icon + '<span>Warstwy mapy</span>';
        }

        const panel = document.createElement('div');
        panel.className = 'hc-layers';
        state.rootMapGroup.findMapLayers()
            .filter(layer => layer.displayInLayerTree !== false)
            .forEach(layer => panel.append(layerCard(layer)));

        const base_names = state.baseLayers?.baseLayerNames || [];
        if (base_names.length) {
            const head = document.createElement('div');
            head.className = 'hc-section';
            head.textContent = 'Mapa podkładowa';
            const grid = document.createElement('div');
            grid.className = 'hc-bases';
            base_names.forEach(base_name => grid.append(baseCard(state, base_name, grid)));
            panel.append(head, grid);
        }

        switcher.prepend(panel);
        document.querySelector('#switcher-layers-container')?.classList.add('hc-hidden');
        document.querySelector('#switcher-baselayer')?.classList.add('hc-hidden');
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(build, 500), {once:true});
    else setTimeout(build, 500);
})();

(() => {
    // Prawy panel mapy wyśrodkowany i szerszy, logo w całości, wąskie ekrany bez nachodzenia nagłówka
    const style = document.createElement('style');
    style.textContent = `
    #navbar{width:58px!important;padding:8px 0!important;box-sizing:border-box!important;display:flex!important;flex-direction:column!important;align-items:center!important;gap:6px!important;border-radius:14px!important;background:#1b2436!important;border:1px solid #33415a!important}
    #navbar button.btn{margin:0!important}
    #navbar .slider{width:40px!important;height:150px!important;margin:4px 0!important;display:flex!important;justify-content:center!important}
    #logo{background-size:contain!important;width:120px!important;height:80px!important;margin-top:4px!important}
    #hc-brand{left:146px!important}
    @media (max-width:1100px){
      #hc-brand{display:none!important}
      #nominatim-search,#nominatim-search #search-query{width:260px!important}
    }
    `;
    document.head.append(style);
})();
