// Paint › Where it goes: which paint is used on each wall, door and room
// (started from the Facilities Notion page "Paint Colors | Locations").
// Shows the color, brand, base and sheen, and how much of that color is in
// stock when a paint color in Stock matches.

const SHEENS = ['Flat', 'Matte', 'Eggshell', 'Satin', 'Semi-Gloss', 'Gloss'];

// "7029 | Agreeable Gray" -> ['agreeable', 'gray']; "Black Magic SW 6991" -> ['black', 'magic']
const colorWords = (c) => String(c || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z\s]/g, ' ')
  .split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'sherwin', 'behr', 'custom', 'color', 'match', 'base'].includes(w));

export function paintSpotPages(ctx) {
  const { sb, q, esc, toast, askConfirm, errMsg, canEdit, stockTabs, gal, loadPaint } = ctx;
  const app = document.getElementById('app');
  let filter = { text: '', area: '' };

  // A stock color whose name has all of this color's words.
  function stockFor(color, items) {
    const w = colorWords(color);
    if (!w.length) return null;
    return items.find((i) => { const n = i.name.toLowerCase(); return w.every((x) => n.includes(x)); }) || null;
  }

  function spotForm(s, areas) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<form class="modal ps-form" role="dialog" aria-modal="true" aria-labelledby="ps-title">
        <h3 id="ps-title">${s.id ? 'Edit paint spot' : 'Add a paint spot'}</h3>
        <label>Area <input name="area" list="ps-areas" required value="${esc(s.area || '')}" placeholder="e.g. Sanctuary"></label>
        <datalist id="ps-areas">${areas.map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
        <label>Spot <input name="spot" required value="${esc(s.spot || '')}" placeholder="e.g. Black doors, Grey walls"></label>
        <label>Color <input name="color" value="${esc(s.color || '')}" placeholder="e.g. Snowbound SW 7004"></label>
        <div class="ps-two">
          <label>Brand <input name="brand" value="${esc(s.brand || '')}" placeholder="e.g. Behr Ultra"></label>
          <label>Base <input name="base" value="${esc(s.base || '')}" placeholder="e.g. Deep Base 7753"></label>
        </div>
        <label>Sheen <select name="sheen"><option value="">—</option>${SHEENS.map((x) => `<option ${s.sheen === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Notes <textarea name="notes" rows="2">${esc(s.notes || '')}</textarea></label>
        <div class="modal-actions">${s.id ? '<button type="button" class="btn bad" data-del>Delete</button>' : ''}
          <button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary">Save</button></div></form>`;
      const done = (v) => { back.remove(); resolve(v); };
      back.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      back.querySelector('[data-del]')?.addEventListener('click', () => done('delete'));
      back.addEventListener('click', (e) => { if (e.target === back) done(null); });
      back.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const v = (k) => String(f.get(k) || '').trim() || null;
        done({ area: v('area'), spot: v('spot'), color: v('color'), brand: v('brand'), base: v('base'), sheen: v('sheen'), notes: v('notes') });
      });
      document.body.appendChild(back);
      back.querySelector('input').focus();
    });
  }

  async function renderPaintSpots() {
    const [spots, { items, sum }] = await Promise.all([
      q(sb.from('paint_spots').select('*').order('area').order('sort').order('id')),
      loadPaint(),
    ]);
    const areas = [...new Set(spots.map((s) => s.area))].sort();
    const edit = canEdit();

    app.innerHTML = `
      ${stockTabs('paint')}
      <header class="page-head"><div class="eyebrow">Stock room</div><h1><span class="accent">Paint</span></h1>
        <p class="lede">Which paint goes on each wall, door and room. Search a room or a color.</p></header>
      <div class="seg ps-seg"><a href="#/items/paint">Cans on hand</a><a href="#/items/paint/where" class="on">Where it goes <b>${spots.length}</b></a></div>
      <div class="row ps-bar">
        <input id="ps-q" type="search" placeholder="Search room, wall or color…" value="${esc(filter.text)}" aria-label="Search">
        <select id="ps-area" aria-label="Area"><option value="">All areas</option>${areas.map((a) => `<option ${filter.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
        ${edit ? '<button class="btn primary" id="ps-add">+ Add a spot</button>' : ''}
      </div>
      <div id="ps-list"></div>`;

    const draw = () => {
      const t = filter.text.toLowerCase();
      const rows = spots.filter((s) => (!filter.area || s.area === filter.area)
        && (!t || [s.area, s.spot, s.color, s.brand, s.base, s.sheen, s.notes].join(' ').toLowerCase().includes(t)));
      const groups = {};
      rows.forEach((s) => { (groups[s.area] ||= []).push(s); });
      app.querySelector('#ps-list').innerHTML = Object.keys(groups).sort().map((a) => `
        <section class="card ps-area"><h2>${esc(a)} <span class="muted">${groups[a].length}</span></h2>
          ${groups[a].map((s) => {
            const st = stockFor(s.color, items);
            return `<div class="ps-row">
              <div class="ps-spot"><b>${esc(s.spot)}</b>${s.notes ? `<span class="muted">${esc(s.notes)}</span>` : ''}</div>
              <div class="ps-paint">${s.color ? `<b>${esc(s.color)}</b>` : '<span class="muted">No color saved yet</span>'}
                <span class="muted">${[s.brand, s.base, s.sheen].filter(Boolean).map(esc).join(' · ')}</span></div>
              <div class="ps-stock">${st ? ((sum[st.id]?.gallons || 0) > 0 ? `<a href="#/item/${st.id}" title="In stock: ${esc(st.name)}">${gal(sum[st.id].gallons)} in stock</a>` : `<a class="none" href="#/item/${st.id}" title="${esc(st.name)}">None in stock</a>`) : ''}</div>
              ${edit ? `<button class="btn ps-edit" data-edit="${s.id}">Edit</button>` : ''}</div>`;
          }).join('')}</section>`).join('') || '<p class="muted card">Nothing matches.</p>';
      app.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editSpot(spots.find((x) => String(x.id) === b.dataset.edit))));
    };

    async function editSpot(s) {
      const v = await spotForm(s || {}, areas);
      if (!v) return;
      try {
        if (v === 'delete') {
          if (!(await askConfirm(`Delete "${s.area} · ${s.spot}"?`, { ok: 'Delete', danger: true }))) return;
          await q(sb.from('paint_spots').delete().eq('id', s.id).select('id'));
          toast('Deleted');
        } else if (s) {
          await q(sb.from('paint_spots').update(v).eq('id', s.id).select('id'));
          toast('Saved');
        } else {
          await q(sb.from('paint_spots').insert({ ...v, sort: spots.length }).select('id'));
          toast(`Added ${v.spot}`);
        }
        renderPaintSpots();
      } catch (err) { toast(errMsg(err), true); }
    }

    app.querySelector('#ps-q').addEventListener('input', (e) => { filter.text = e.target.value; draw(); });
    app.querySelector('#ps-area').addEventListener('change', (e) => { filter.area = e.target.value; draw(); });
    app.querySelector('#ps-add')?.addEventListener('click', () => editSpot(null));
    draw();
  }

  return { renderPaintSpots };
}
