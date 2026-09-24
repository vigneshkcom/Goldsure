export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 9) return '';
  return digits.slice(-9);
}

export function isCompletedAppointment(appointment) {
  const code = String(appointment?.completionStatusCode || '').trim().toLowerCase();
  const description = String(appointment?.completionStatusDescription || '').trim().toLowerCase();
  if (['c', 'complete', 'completed'].includes(code)) return true;
  return /^(appointment )?completed?$/.test(description);
}

export function classifyDataforceProduct({ workType = '', state = '' } = {}) {
  const text = String(workType || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const region = String(state || '').trim().toUpperCase();
  if (/\bsmoke\b/.test(text)) return 'smoke';
  if (/\b(hot water|hws|water heater|heat pump water)\b/.test(text)) {
    if (region === 'NSW') return 'hws-nsw';
    if (region === 'VIC') return 'hws-vic';
    return 'hws';
  }
  if (/\b(air con|aircon|air conditioning|split system|ducted)\b/.test(text)) return 'aircon';
  return 'unknown';
}

export function pipelineMatchesProduct(pipelineName, product) {
  const name = String(pipelineName || '').toLowerCase();
  if (product === 'smoke') return name.includes('smoke');
  if (product === 'aircon') {
    return !name.includes('hot water')
      && ['air con', 'aircon', 'air-con', 'air conditioning', 'hvac'].some(hint => name.includes(hint));
  }
  if (product === 'hws-nsw') {
    return name.includes('nsw') && ['hws', 'hot water', 'heat pump'].some(hint => name.includes(hint));
  }
  if (product === 'hws-vic' || product === 'hws') {
    return !name.includes('nsw') && ['hws', 'hot water', 'heat pump'].some(hint => name.includes(hint));
  }
  return false;
}

export function findInstalledStage(pipeline) {
  const stages = Array.isArray(pipeline?.stages) ? pipeline.stages : [];
  const normal = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return stages.find(stage => normal(stage.name) === 'installed')
    || stages.find(stage => normal(stage.name) === 'won installed')
    || stages.find(stage => normal(stage.name).includes('installed'))
    || null;
}

export function isOpportunityAlreadyWon(opportunity, stageName = '') {
  if (String(opportunity?.status || '').trim().toLowerCase() === 'won') return true;
  const stage = String(stageName || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return /\bwon\b/.test(stage) || /\binstalled\b/.test(stage);
}

export function directCallOpportunityName(customerName) {
  const name = String(customerName || '').trim() || 'Customer';
  return `${name} - Direct Call`;
}

export function chooseOpportunity(opportunities, pipelineIds) {
  const allowed = new Set(pipelineIds || []);
  const relevant = (opportunities || []).filter(opportunity => allowed.has(opportunity.pipelineId));
  if (!relevant.length) return null;
  const updatedAt = opportunity => new Date(
    opportunity.updatedAt || opportunity.dateUpdated || opportunity.lastStageChangeAt || opportunity.lastStatusChangeAt || 0,
  ).getTime() || 0;
  return relevant
    .slice()
    .sort((a, b) => {
      const aOpen = String(a.status || '').toLowerCase() === 'open' ? 1 : 0;
      const bOpen = String(b.status || '').toLowerCase() === 'open' ? 1 : 0;
      return bOpen - aOpen || updatedAt(b) - updatedAt(a);
    })[0];
}

function lineTotal(line) {
  const qty = Number(line?.lineQty);
  const rate = Number(line?.lineRateIncTax);
  if (!Number.isFinite(rate)) return 0;
  return (Number.isFinite(qty) && qty !== 0 ? qty : 1) * rate;
}

function groupTotal(lines) {
  return (Array.isArray(lines) ? lines : []).reduce((sum, line) => sum + lineTotal(line), 0);
}

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function calculateDataforceRevenue(document, source = '') {
  if (!document || typeof document !== 'object') {
    return { confident: false, source, revenue: null, productTotal: 0, discountTotal: 0, rebateTotal: 0 };
  }
  const productTotal = groupTotal(document.productLines);
  const rawDiscountTotal = groupTotal(document.discountLines);
  const discountTotal = rawDiscountTotal > 0 ? -rawDiscountTotal : rawDiscountTotal;
  const rebateTotal = Math.abs(groupTotal(document.rebatePOSLine || document.rebatePOSLines))
    + Math.abs(groupTotal(document.rebateDelayedLines));
  const revenue = money(productTotal + discountTotal);
  return {
    confident: Array.isArray(document.productLines) && document.productLines.length > 0 && revenue > 0,
    source,
    revenue: revenue > 0 ? revenue : null,
    productTotal: money(productTotal),
    discountTotal: money(discountTotal),
    rebateTotal: money(rebateTotal),
    customerAmountAfterRebates: revenue > 0 ? money(Math.max(0, revenue - rebateTotal)) : null,
  };
}

export function groupAppointmentsByJob(appointments) {
  const grouped = new Map();
  for (const appointment of appointments || []) {
    if (!appointment?.jobId) continue;
    const key = String(appointment.jobId);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(appointment);
  }
  return [...grouped.entries()].map(([jobId, jobAppointments]) => {
    const byLatest = jobAppointments.slice().sort((a, b) => new Date(
      b.actualCompletedDate || b.completedDate || b.modifiedDate || b.scheduledDate || 0,
    ) - new Date(
      a.actualCompletedDate || a.completedDate || a.modifiedDate || a.scheduledDate || 0,
    ));
    return {
      jobId,
      appointments: byLatest,
      representative: byLatest.find(isCompletedAppointment) || byLatest[0],
      completed: byLatest.some(isCompletedAppointment),
    };
  });
}
