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
// EVENT_COLUMNS or 'saved'; `ref` is stored for Xero bills.
export async function recordPurchaseOrder(po, event = 'saved', { ref = '', env = process.env, fetchImpl = fetch } = {}) {
  const call = connection(env, fetchImpl);
  const { order, jobs } = purchaseOrderRows(po);
  if (EVENT_COLUMNS[event]) order[EVENT_COLUMNS[event]] = new Date().toISOString();
  if (event === 'xero-bill' && ref) order.xero_bill_ref = String(ref).slice(0, 80);
  // merge-duplicates only touches the columns sent, so earlier events survive.
  await call('purchase_orders?on_conflict=po_number', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(order) });
  await call(`purchase_order_jobs?po_number=eq.${encodeURIComponent(po.poNumber)}`, { method: 'DELETE' });
  await call('purchase_order_jobs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(jobs) });
}

// Filters: from / to (installed date), electrician (exact name), search (job id or address).
export async function listPurchaseOrderJobs(filters = {}, { env = process.env, fetchImpl = fetch } = {}) {
  const call = connection(env, fetchImpl);
  const query = [
    'select=*,purchase_orders(electrician_name,period,week_ending,payable_date,exported_at,emailed_at,summary_emailed_at,xero_bill_at,xero_bill_ref)',
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
