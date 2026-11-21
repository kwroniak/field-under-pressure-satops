(() => {
  'use strict';
  const labels = {ndvi:'NDVI',ndmi:'NDMI',soil_ph_h2o:'pH H₂O',temperature_mean_c:'Temperatura [°C]',precipitation_mm:'Opad [mm]',soil_moisture_0_7:'Wilgotność 0–7 cm',soil_moisture_7_28:'Wilgotność 7–28 cm',soil_moisture_27_81:'Wilgotność 27–81 cm',risk_probability:'Prawdopodobieństwo ryzyka'};
  const kinds = {observed:'obserwacja',modelled:'dane modelowe',forecast:'prognoza',soil:'model gleby'};
  const style = document.createElement('style');
  style.textContent = `.hc-live-calendar{padding:12px;background:#121b29;color:#f4fbff}.hc-live-calendar h3{color:inherit}.hc-live-nav{display:flex;align-items:center;justify-content:space-between;margin:16px 0}.hc-live-week,.hc-live-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;text-align:center}.hc-live-calendar button{background:#202c3c;color:#f4fbff;border:1px solid #354355;border-radius:4px;padding:8px 2px;min-width:0}.hc-live-calendar button[data-record]{border-color:#417963}.hc-live-calendar button[aria-pressed=true]{outline:2px solid #b9decf}.hc-live-calendar dl{margin:12px 0}.hc-live-calendar dt{margin-top:10px}.hc-live-calendar dd{margin:3px 0}.hc-live-calendar small{display:block;color:#c4ced8}.hc-live-calendar textarea[hidden]{display:none}`;
  document.head.append(style);
  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function mountCalendar(root) {
    if (root.dataset.hcReady) return;
    root.dataset.hcReady = '1';
    let records, soil;
    try {
      records = JSON.parse(root.querySelector('.hc-calendar-source').value);
      soil = JSON.parse(root.querySelector('.hc-soil-source').value);
      if (!Array.isArray(records) || !Array.isArray(soil)) throw new Error('schema');
    } catch (_) {
      root.append(element('p','Niepoprawne dane kalendarza. Sprawdź źródło hc.v_popup i Map Tip.'));
      return;
    }
    const by_date = new Map(records.map(row => [row.date,row.values]));
    const latest_date = [...by_date.keys()].sort().pop();
    const month = latest_date ? new Date(latest_date+'T12:00:00') : new Date();
    month.setDate(1);
    const calendar = element('div'), details = element('div');
    root.append(calendar,details);
    function showDay(date_key) {
      details.replaceChildren(element('h4',date_key));
      const daily_values = by_date.get(date_key) || [];
      if (!daily_values.length) details.append(element('p','Brak danych dziennych.'));
      const list = element('dl');
      for (const row of [...daily_values,...soil.filter(row => row.valid_date<=date_key)]) {
        list.append(element('dt',labels[row.metric] || row.metric));
        const value = Number(row.value);
        const item = element('dd',Number.isFinite(value)?value.toLocaleString('pl-PL',{maximumFractionDigits:3}):'Brak danych');
        item.append(element('small',`${kinds[row.kind || 'soil']} · ${row.source} · pokrycie ${Math.round(row.coverage*100)}%`));
        if (row.issued_at) item.append(element('small',`Wersja: ${row.issued_at}`));
        if (row.valid_date) item.append(element('small',`Data źródła gleby: ${row.valid_date}`));
        list.append(item);
      }
      details.append(list);
    }
    function renderMonth() {
      calendar.replaceChildren();
      const nav = element('div'); nav.className='hc-live-nav';
      const previous = element('button','‹'), next = element('button','›');
      previous.type=next.type='button';
      previous.setAttribute('aria-label','Poprzedni miesiąc');
      next.setAttribute('aria-label','Następny miesiąc');
      previous.onclick=()=>{month.setMonth(month.getMonth()-1);renderMonth();};
      next.onclick=()=>{month.setMonth(month.getMonth()+1);renderMonth();};
      nav.append(previous,element('strong',month.toLocaleDateString('pl-PL',{month:'long',year:'numeric'})),next);
      const week = element('div'); week.className='hc-live-week';
      ['Pon','Wt','Śr','Czw','Pt','Sob','Nd'].forEach(day=>week.append(element('span',day)));
      const grid = element('div'); grid.className='hc-live-grid';
      for(let i=0;i<(month.getDay()+6)%7;i++) grid.append(element('span'));
      for(let day=1;day<=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();day++) {
        const date_key=`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const button=element('button',day); button.type='button';
        button.setAttribute('aria-label',date_key); button.setAttribute('aria-pressed','false');
        if(by_date.has(date_key)) button.dataset.record='1';
        button.onclick=()=>{grid.querySelectorAll('button').forEach(node=>node.setAttribute('aria-pressed','false'));button.setAttribute('aria-pressed','true');showDay(date_key);};
        grid.append(button);
      }
      calendar.append(nav,week,grid);
    }
    renderMonth();
    if(latest_date) showDay(latest_date);
    else details.append(element('p','Brak danych dziennych. Zaimportuj meteo lub wyniki satelitarne.'));
  }
  let queued=false;
  function mountAll() {
    queued=false;
    document.querySelectorAll('.hc-live-calendar').forEach(mountCalendar);
  }
  const observer=new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(mountAll);}});
  function start() {mountAll();observer.observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
  window.hc_calendar_loaded=true;
})();
