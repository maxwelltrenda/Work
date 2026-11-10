// Contractors: outside companies we hire, with contacts ready to go.
// Facilities admins add and edit; maintenance managers can look and call.
// Maintenance tasks can name one (pm.js), and its contact shows on the task.

export const telHref = (p) => `tel:${String(p || '').replace(/[^\d+]/g, '')}`;
// 8175588181 / 817.558.8181 -> (817) 558-8181; anything else stays as typed.
export const fmtPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p || '');
};
const webHref = (w) => (/^https?:/i.test(w) ? w : `https://${w}`);
const webText = (w) => String(w).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');

// Contact line used on the list and on maintenance tasks.
export function contractorContact(c, esc) {
  if (!c) return '';
  return [c.contact ? esc(c.contact) : '',
    c.phone ? `<a href="${telHref(c.phone)}">${esc(fmtPhone(c.phone))}</a>` : '',
    c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''].filter(Boolean).join(' · ');
}

export function contractorPages(ctx) {
  const { sb, q, esc, toast, askConfirm, errMsg, pageHead, canEdit } = ctx;
  const app = document.getElementById('app');
  let search = '';

  async function renderContractors() {
    const [list, tasks] = await Promise.all([
      q(sb.from('contractors').select('*').order('name')),
      q(sb.from('pm_tasks').select('id, name, contractor_id, active').not('contractor_id', 'is', null)).catch(() => []),
    ]);
    const edit = canEdit();
    const active = list.filter((c) => c.active);
    const old = list.filter((c) => !c.active);
    const jobs = (c) => tasks.filter((t) => t.contractor_id === c.id && t.active).map((t) => t.name);
    const match = (c) => !search || [c.name, c.trade, c.contact, c.notes].join(' ').toLowerCase().includes(search.toLowerCase());
    const row = (label, html) => `<div class="ct-row"><span class="ct-label">${label}</span><span class="ct-val">${html || '<span class="ct-none">Not added</span>'}</span></div>`;
    const card = (c) => `<article class="ct-card${c.active ? '' : ' off'}">
        <header class="ct-head">
          <div class="ct-title"><h3>${esc(c.name)}</h3>${c.trade ? `<span class="ct-trade">${esc(c.trade)}</span>` : ''}</div>
          <div class="ct-actions">${c.phone ? `<a class="btn small" href="${telHref(c.phone)}">Call</a>` : '<span class="btn small ct-off" aria-disabled="true">Call</span>'}${c.email ? `<a class="btn small" href="mailto:${esc(c.email)}">Email</a>` : '<span class="btn small ct-off" aria-disabled="true">Email</span>'}${edit ? `<button class="btn small" data-ct-edit="${c.id}">Edit</button>` : ''}</div>
        </header>
        <div class="ct-rows">
          ${row('Phone', c.phone ? `<a href="${telHref(c.phone)}">${esc(fmtPhone(c.phone))}</a>` : '')}
          ${row('Contact', c.contact ? esc(c.contact) : '')}
          ${row('Email', c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '')}
          ${row('Website', c.website ? `<a href="${esc(webHref(c.website))}" target="_blank" rel="noopener">${esc(webText(c.website))}</a>` : '')}
        </div>
        <div class="ct-notes"><span class="ct-label">Notes</span>${c.notes ? esc(c.notes) : '<span class="ct-none">No notes</span>'}</div>
        <footer class="ct-jobs"><span class="ct-label">Handles</span>${jobs(c).length ? jobs(c).map((j) => `<span class="ct-job">${esc(j)}</span>`).join('') : '<span class="ct-none">No maintenance tasks yet</span>'}</footer>
      </article>`;
    app.innerHTML = `
      ${pageHead('Facilities', 'Contractors', 'Outside companies we hire for jobs our team doesn\'t do, with who to call. Pick one on a maintenance task and the contact shows up there.')}
      <div class="ct-bar"><input type="search" id="ct-search" placeholder="Search by name or trade…" value="${esc(search)}">${edit ? '<button class="btn primary" data-ct-new>+ Add contractor</button>' : ''}</div>
      <div class="ct-list">${active.filter(match).map(card).join('') || `<div class="card pm-empty"><b>${search ? 'No match.' : 'No contractors yet.'}</b>${search || !edit ? '' : '<p class="muted">Add the companies you call: grease trap cleaning, fire extinguisher inspection, elevator service, pest control, HVAC…</p>'}</div>`}</div>
      ${old.length && edit ? `<details class="ct-old"><summary>Not used anymore <span class="muted">${old.length}</span></summary><div class="ct-list">${old.map(card).join('')}</div></details>` : ''}`;
    const s = app.querySelector('#ct-search');
    s.addEventListener('input', () => { search = s.value; const pos = s.selectionStart; renderContractors().then(() => { const n = app.querySelector('#ct-search'); n.focus(); n.setSelectionRange(pos, pos); }); });
    app.querySelector('[data-ct-new]')?.addEventListener('click', async () => { if (await editContractor({})) renderContractors(); });
    app.querySelectorAll('[data-ct-edit]').forEach((b) => b.addEventListener('click', async () => {
      if (await editContractor(list.find((c) => c.id === Number(b.dataset.ctEdit)))) renderContractors();
    }));
  }

  // Add / edit pop-up. Resolves to the saved row (or null).
  function editContractor(c = {}) {
    const editing = !!c.id;
    const TRADES = ['Grease trap', 'Plumbing', 'Electrical', 'HVAC', 'Fire & safety', 'Elevator', 'Pest control', 'Roofing', 'Landscaping', 'Cleaning', 'Locksmith', 'Paving & parking lot'];
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<form class="modal sheet ct-form" role="dialog" aria-modal="true" aria-labelledby="ct-title">
        <h3 id="ct-title">${editing ? 'Edit contractor' : 'New contractor'}</h3>
        <label><span>Company or person</span><input name="name" required value="${esc(c.name || '')}" placeholder="e.g. DFW Grease Trap Services" class="modal-input"></label>
        <label><span>What they do</span><input name="trade" value="${esc(c.trade || '')}" placeholder="e.g. Grease trap"></label>
        <div class="wk-chips ct-trades">${TRADES.map((t) => `<button type="button" class="chip-btn" data-trade="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <div class="ct-grid">
          <label><span>Contact person</span><input name="contact" value="${esc(c.contact || '')}" placeholder="Who to ask for"></label>
          <label><span>Phone</span><input name="phone" type="tel" value="${esc(c.phone || '')}" placeholder="(817) 555-0123"></label>
          <label><span>Email</span><input name="email" type="email" value="${esc(c.email || '')}" placeholder="name@company.com"></label>
          <label><span>Website</span><input name="website" value="${esc(c.website || '')}" placeholder="company.com"></label>
        </div>
        <label><span>Notes <span class="muted">(account #, pricing, how to book, after-hours line)</span></span><textarea name="notes" rows="3">${esc(c.notes || '')}</textarea></label>
        <div class="modal-actions">${editing ? `<button type="button" class="btn ${c.active ? 'bad' : ''} pm-left" data-ct-toggle>${c.active ? 'Not using them anymore' : 'Use them again'}</button>` : ''}
          <button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary">${editing ? 'Save' : 'Add contractor'}</button></div>
      </form>`;
      const form = back.querySelector('form');
      const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.dd-menu')) { e.preventDefault(); done(null); } };
      document.addEventListener('keydown', onKey, true);
      back.addEventListener('mousedown', (e) => { if (e.target === back) done(null); });
      form.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      form.querySelectorAll('[data-trade]').forEach((b) => b.addEventListener('click', () => { form.querySelector('[name=trade]').value = b.dataset.trade; }));
      form.querySelector('[data-ct-toggle]')?.addEventListener('click', async () => {
        const on = !c.active;
        if (!on && !(await askConfirm(`Stop using ${c.name}?`, { message: 'They move to "Not used anymore". Tasks that name them keep the name.', ok: 'Move', danger: true }))) return;
        try { const [row] = await q(sb.from('contractors').update({ active: on }).eq('id', c.id).select()); toast(on ? 'Back on the list' : 'Moved off the list'); done(row); } catch (err) { toast(errMsg(err), true); }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const v = (k) => String(f.get(k) || '').trim() || null;
        const row = { name: v('name'), trade: v('trade'), contact: v('contact'), phone: v('phone'), email: v('email'), website: v('website'), notes: v('notes') };
        if (!row.name) return form.querySelector('[name=name]').focus();
        try {
          const [saved] = await q(editing ? sb.from('contractors').update(row).eq('id', c.id).select() : sb.from('contractors').insert(row).select());
          toast(editing ? 'Saved' : `Added ${row.name}`);
          done(saved);
        } catch (err) { toast(errMsg(err), true); }
      });
      document.body.appendChild(back);
      form.querySelector('[name=name]').focus();
    });
  }

  return { renderContractors, editContractor };
}
