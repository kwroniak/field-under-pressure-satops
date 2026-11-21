(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('project') !== 'satops_project' || params.get('repository') !== 'holycrop') return;
  if (window.holy_crap_loaded) return;
  window.holy_crap_loaded = true;
  document.documentElement.dataset.holyCrap = '1';

  function formatValue(value, unit = '') {
    if (value === '' || value === undefined || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString('pl-PL', {maximumFractionDigits:2}) + unit;
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
    card.dataset.hcReady = '1';
    const rows = [...data_table.querySelectorAll('tr')].map(row => [...row.cells].map(cell => cell.textContent.trim()))
      .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row[0])).sort((a,b) => a[0].localeCompare(b[0]));
    const field_id = card.querySelector('.hc-field-id')?.textContent.trim() || '';
    const days = card.querySelector('.hc-days');
    const weekday_names = ['ND','PON','WT','ŚR','CZW','PT','SOB'];
    for (const row of rows) {
      const day = new Date(row[0] + 'T12:00:00');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hc-day';
      button.innerHTML = '<span></span><span class="hc-weather"><i class="hc-dot" aria-hidden="true"></i><span></span></span><span></span>';
      button.children[0].textContent = `${weekday_names[day.getDay()]} ${row[0].slice(8)}.${row[0].slice(5,7)}`;
      button.querySelector('.hc-weather span').textContent = formatValue(row[4],'°C');
      button.querySelector('.hc-dot').classList.toggle('hc-missing',row[4] === '');
      button.lastElementChild.textContent = formatValue(row[5],' mm');
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
  function mountAll() {document.querySelectorAll('.hc-field-card').forEach(mountCard);}
  function startTheme() {
    mountAll();
    new MutationObserver(mountAll).observe(document.body,{childList:true,subtree:true});
    // Let Lizmap recompute map dimensions after changing header height.
    window.dispatchEvent(new Event('resize'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',startTheme,{once:true});
  else startTheme();
})();
