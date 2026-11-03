(() => {
  const $ = s => document.querySelector(s);
  let safe = false, token = '', files = [], busy = false, submitted = false;
  const guidance = {
    loud: '<strong>Check for danger first.</strong><p>A loud repeating alarm can indicate smoke. If there is smoke, fire, a burning smell, or any uncertainty, leave safely, follow the building emergency procedures and call 000 from a safe place.</p><p>Only for a clearly unwanted activation: press and release Test/Hush and, where safe, ventilate to clear fumes or steam. Hush lasts up to 10 minutes. If the loud alarm persists or returns, get assistance; don’t assume it is harmless.</p>',
    chirp: '<strong>Short chirps are different from a smoke alarm.</strong><p>They may indicate a low battery, malfunction or end-of-life warning. Contact management or Goldsure for assessment. These are sealed-battery alarms: do not open them, remove the battery, or disable them.</p>',
    silent: '<strong>A silent indicator may be normal or a memory of an earlier alarm.</strong><p>The manual describes a green flash every 54 seconds for normal battery operation, and a red flash every 20 seconds for alarm memory, retained for 12 hours. An indicator alone cannot confirm that an alarm is fault-free. Contact management if you are unsure.</p>',
    other: '<strong>You don’t need to diagnose it yourself.</strong><p>Tell us what you noticed in your report. Contact management for assistance if the alarm continues or you are unsure. Never disable an alarm.</p>',
  };
  function show(step) {
    document.querySelectorAll('.panel').forEach(p => p.hidden = p.id !== `step-${step}`);
    document.querySelectorAll('.steps li').forEach((li,i)=>{li.classList.toggle('active',i===step);li.classList.toggle('done',i<step);if(i===step)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
    $(`#heading-${step}`).focus({preventScroll:true});
    $('.workspace').scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  }
  async function session() {
    const r=await fetch('/api/beachcomber/report',{cache:'no-store'}), data=await r.json().catch(()=>({error:'Online reporting is temporarily unavailable. Please call Goldsure on (07) 2146 1500.'}));
    if(!r.ok) throw new Error(data.error || 'Reporting is unavailable. Please call Goldsure.');
    token=data.token;
  }
  $('#danger').onclick=()=>{$('#emergency-message').hidden=false;safe=false;$('#emergency-message').scrollIntoView({behavior:'smooth',block:'nearest'});};
  $('#safe').onclick=()=>{safe=true;show(1);};
  document.querySelectorAll('[data-next]').forEach(b=>b.onclick=()=>show(Number(b.dataset.next)));
  document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>show(Number(b.dataset.back)));
  document.querySelectorAll('input[name=sound]').forEach(r=>r.onchange=()=>{$('#sound-guidance').innerHTML=guidance[r.value];$('#sound-guidance').hidden=false;});
  $('#outcome').onchange=()=>{$('#follow-up').hidden=!['ongoing','fault'].includes($('#outcome').value);};
  $('#to-report').onclick=()=>{
    if(!$('input[name=sound]:checked') || !$('input[name=trigger]:checked') || !$('#outcome').value){$('#check-error').textContent='Please choose a sound, possible trigger and outcome.';return;}
    $('#check-error').textContent='';show(3);
    if(!token)session().catch(e=>{$('#submit-error').textContent=e.message;});
  };
  async function compress(file) {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Please choose JPG, PNG or WebP photos.');
    if(file.size>12*1024*1024)throw new Error('Each original photo must be under 12 MB.');
    const bitmap=await createImageBitmap(file);
    const ratio=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    return {type:'image/jpeg',data:canvas.toDataURL('image/jpeg',.72).split(',')[1]};
  }
  $('#photos').onchange=async()=>{
    files=[];$('#submit-error').textContent='';$('#submit-report').disabled=true;
    try{
      const selected=[...$('#photos').files];if(selected.length>3)throw new Error('Please choose up to 3 photos.');
      $('#photo-status').textContent=selected.length?'Preparing photos…':'';
      const ready=await Promise.all(selected.map(compress));
      if(ready.reduce((n,f)=>n+f.data.length*.75,0)>2*1024*1024)throw new Error('Photos are over 2 MB in total. Please select fewer photos.');
      files=ready;$('#photo-status').textContent=ready.length?`${ready.length} photo${ready.length>1?'s':''} ready to send.`:'';
    }catch(e){$('#photos').value='';$('#photo-status').textContent='';$('#submit-error').textContent=e.message;}
    finally{$('#submit-report').disabled=false;}
  };
  $('#report-form').onsubmit=async e=>{
    e.preventDefault();if(busy||submitted)return;
    const form=new FormData(e.target);if(!form.get('phone').trim()&&!form.get('email').trim()){$('#submit-error').textContent='Please provide a phone number or email.';return;}
    busy=true;$('#submit-report').disabled=true;$('#submit-report').textContent='Sending your report…';$('#submit-error').textContent='';
    try{
      if(!token)await session();
      const body={...Object.fromEntries(form),token,safe,sound:$('input[name=sound]:checked').value,trigger:$('input[name=trigger]:checked').value,outcome:$('#outcome').value,files};
      const r=await fetch('/api/beachcomber/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=await r.json().catch(()=>({error:'We could not confirm delivery. Please try again or call Goldsure on (07) 2146 1500.'}));
      if(!r.ok || !data.ok){if(data.saved)$('#submit-report').dataset.retry='1';throw new Error(data.error || 'We could not confirm delivery. Please retry or call Goldsure.');}
      submitted=true;document.querySelectorAll('.panel').forEach(p=>p.hidden=p.id!=='success');$('#reference').textContent=`Your reference: ${data.reference}`;$('#success-title').focus();
    }catch(err){$('#submit-error').textContent=err.message;}
    finally{busy=false;$('#submit-report').disabled=false;$('#submit-report').textContent=$('#submit-report').dataset.retry?'Retry notification →':'Send report to Goldsure ↗';}
  };
  $('#start-again').onclick=()=>location.reload();
})();
