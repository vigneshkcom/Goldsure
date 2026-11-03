function connection(env, fetchImpl) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Report numbering is not configured.');
  return async (path, init = {}) => {
    const r = await fetchImpl(`${url}/rest/v1/${path}`, { ...init,
      headers: { apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json', ...init.headers },
      signal:AbortSignal.timeout(12000),
    });
    if (!r.ok) {
      const detail = await r.text().catch(()=> '');
      if (detail.includes('This report was already submitted')) throw new Error('This report was already submitted. Start a new report for a different incident.');
      throw new Error('Could not confirm the report number. Please retry.');
    }
    return r;
  };
}
export async function reserveReport(session, unit, digest, {env=process.env, fetchImpl=fetch}={}) {
  const call=connection(env,fetchImpl);
  const r=await call('rpc/reserve_beachcomber_report',{method:'POST',body:JSON.stringify({p_session_id:session.id,p_unit:unit,p_payload_hash:digest})});
  const rows=await r.json();const row=Array.isArray(rows)?rows[0]:null;
  if (!row || row.unit!==unit || row.payload_hash!==digest || row.session_id!==session.id || !Number.isSafeInteger(row.report_number) || row.report_number<1 || row.reference!==`${unit}-${row.report_number}`) throw new Error('Could not confirm the report number. Please retry.');
  return row;
}
export async function updateReport(session, values, {env=process.env,fetchImpl=fetch}={}) {
  const call=connection(env,fetchImpl);
  const allowed=Object.fromEntries(Object.entries(values).filter(([k])=>['workdrive_folder_id','emailed_at'].includes(k)));
  const r=await call(`beachcomber_reports?session_id=eq.${encodeURIComponent(session.id)}&select=session_id`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(allowed)});
  const rows=await r.json();
  if (!Array.isArray(rows) || rows.length!==1 || rows[0].session_id!==session.id) throw new Error('Could not record report delivery.');
}
