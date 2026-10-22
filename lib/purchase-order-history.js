// Purchase order history in Supabase (tables: smoke-alarms/purchase-order-history-schema.sql).
// A PO number is "PO for <electrician> - Week ending <date>", so regenerating
// the same week updates its record instead of creating a duplicate.

const EVENT_COLUMNS = {
  exported: 'exported_at',
  emailed: 'emailed_at',
  'summary-emailed': 'summary_emailed_at',
  'xero-bill': 'xero_bill_at',
};

const isoDate = value => (/^\d{4}-\d{2}-\d{2}/.test(String(value || '')) ? String(value).slice(0, 10) : null);
const quantity = (job, key) => job.items.filter(item => item.key === key).reduce((sum, item) => sum + Number(item.quantity || 0), 0);

function connection(env, fetchImpl) {
  const origin = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key) throw new Error('Purchase order history needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  return async (path, init = {}) => {
    const response = await fetchImpl(`${origin}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(response.status === 404 || /relation .* does not exist|PGRST205/.test(detail)
        ? 'Run smoke-alarms/purchase-order-history-schema.sql in Supabase first.'
        : `Supabase ${response.status}: ${detail.slice(0, 200)}`);
    }
    return response;
  };
}

export function purchaseOrderRows(po) {
  const order = {
    po_number: po.poNumber,
    fieldworker_id: Number.isFinite(Number(po.electrician.id)) ? Number(po.electrician.id) : null,
    electrician_name: po.electrician.name,
    company_name: po.electrician.companyName || null,
    period: po.period || null,
    week_ending: isoDate(po.weekEnding),
    payable_date: po.payableDate || null,
    jobs_count: po.totals.jobs,
    subtotal_ex_gst: po.totals.subtotalExGst,
    gst: po.totals.gst,
    cash_offset: po.totals.cashOffset,
    total_inc_gst: po.totals.totalIncGst,
    additional_lines: po.additionalLines,
    updated_at: new Date().toISOString(),
  };
  const jobs = po.jobs.map(job => ({
    po_number: po.poNumber,
    job_id: job.jobId,
    installed_date: isoDate(job.installedDate),
    address: job.address || null,
    booking: quantity(job, 'booking'),
    hardwired: quantity(job, 'hardwired'),
    battery: quantity(job, 'battery'),
    remote: quantity(job, 'remote'),
    subtotal_ex_gst: job.subtotalExGst,
    gross_inc_gst: job.grossIncGst,
    cash_offset: job.cashOffset,
    payable_inc_gst: job.payableIncGst,
    payment_flag: job.paymentFlag?.type || null,
    items: job.items,
  }));
  return { order, jobs };
}

// `po` must already be validated (validatedPurchaseOrder). `event` is one of
// EVENT_COLUMNS or 'saved'; `ref` is stored for Xero bills. Sent dates go on
// the jobs in this PO only, and jobs from earlier POs with the same number
// (a second PO in the same week) are left untouched.
export async function recordPurchaseOrder(po, event = 'saved', { ref = '', env = process.env, fetchImpl = fetch } = {}) {
  const call = connection(env, fetchImpl);
  const { order, jobs } = purchaseOrderRows(po);
  const stamp = {};
  if (EVENT_COLUMNS[event]) stamp[EVENT_COLUMNS[event]] = new Date().toISOString();
  if (event === 'xero-bill' && ref) stamp.xero_bill_ref = String(ref).slice(0, 80);
  // merge-duplicates only touches the columns sent, so earlier events survive.
  const upsert = { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } };
  await call('purchase_orders?on_conflict=po_number', { ...upsert, body: JSON.stringify(order) });
  await call('purchase_order_jobs?on_conflict=po_number,job_id', { ...upsert, body: JSON.stringify(jobs.map(job => ({ ...job, ...stamp }))) });
}

const SENT_FILTER = 'or=(emailed_at.not.is.null,summary_emailed_at.not.is.null,xero_bill_at.not.is.null)';
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// Jobs already emailed (PO or summary) or billed in Xero, for the dates being
// loaded. An Excel export alone does not count as sent. The window is a week
// wider each side so the PO numbers of the same week are found too.
export async function previousSends(startDate, endDate, { env = process.env, fetchImpl = fetch } = {}) {
  const from = isoDate(startDate), to = isoDate(endDate);
  if (!from || !to) return { sentJobs: {}, sentPoNumbers: [] };
  const call = connection(env, fetchImpl);
  const response = await call(`purchase_order_jobs?select=job_id,po_number,installed_date,emailed_at,summary_emailed_at,xero_bill_at&installed_date=gte.${addDays(from, -7)}&installed_date=lte.${addDays(to, 7)}&${SENT_FILTER}`);
  const rows = await response.json();
  const sentJobs = {};
  for (const row of rows) {
    const at = [row.emailed_at, row.summary_emailed_at, row.xero_bill_at].filter(Boolean).sort().pop();
    if (!sentJobs[row.job_id] || at > sentJobs[row.job_id].sentAt) sentJobs[row.job_id] = { poNumber: row.po_number, sentAt: at };
  }
  return { sentJobs, sentPoNumbers: [...new Set(rows.map(row => row.po_number))] };
}

// Filters: from / to (installed date), electrician (exact name), search (job id or address).
export async function listPurchaseOrderJobs(filters = {}, { env = process.env, fetchImpl = fetch } = {}) {
  const call = connection(env, fetchImpl);
  const query = [
    'select=*,purchase_orders(electrician_name,period,week_ending,payable_date)',
    'order=installed_date.desc.nullslast,job_id.desc',
    'limit=1000',
  ];
  if (isoDate(filters.from)) query.push(`installed_date=gte.${isoDate(filters.from)}`);
  if (isoDate(filters.to)) query.push(`installed_date=lte.${isoDate(filters.to)}`);
  const response = await call(`purchase_order_jobs?${query.join('&')}`);
  const electrician = String(filters.electrician || '').trim();
  const search = String(filters.search || '').trim().toLowerCase();
  return (await response.json()).filter(job => {
    if (electrician && job.purchase_orders?.electrician_name !== electrician) return false;
    return !search || `${job.job_id} ${job.address || ''} ${job.po_number}`.toLowerCase().includes(search);
  });
}
