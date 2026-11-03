(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const CALL = '<a href="tel:0721461500">(07) 2146 1500</a>';
  const ZERO = '<a href="tel:000">000</a>';
  let safe = false, token = '', files = [], busy = false, submitted = false;

  // Every instruction below is taken from the Raptor RH638-AC-RF / RH638-B-RF user manual
  // (sections 1, 6, 7, 8, 10 and 11). Keep it in line with /beachcomber/raptor-manual.pdf.
  // Visual LED indicator: colour g/r/y (+ "steady"), number of flashes, label, meaning.
  const sig = (colour, count, label, meaning) => `<div class="signal"><span class="leds" aria-hidden="true">${('<i class="led led-' + colour.split(' ').join(' led-') + '"></i>').repeat(count)}</span><span><strong>${label}</strong><small>${meaning}</small></span></div>`;
  const guidance = {
    loud: `<h3>Treat it as a possible fire until you’ve checked</h3>
      <ol class="tight">
        <li>Check for smoke, fire or a burning smell. The alarm may have started in a connected room or the hallway, not the room you’re in.</li>
        <li><strong>If you see any sign of fire, or you’re not sure, leave and call ${ZERO}.</strong></li>
        <li>Only if you’re sure it is cooking fumes, steam or dust: <strong>quickly press and release</strong> the Test/Hush button. It goes quiet for up to 10 minutes and the red light flashes once every 10 seconds. Open a window or fan the air to clear it.</li>
        <li><strong>If it won’t go quiet, or starts again after hushing,</strong> it’s often because <strong>the alarm that set it off is somewhere else</strong>. The alarms are connected, so the source could be the hallway or the adjoining room or unit, for example a neighbour cooking or showering. Hushing your alarm may not stop it while that alarm still senses smoke or steam.</li>
      </ol>
      <h3>Find the alarm that set it off</h3>
      <ol class="tight">
        <li>Check the hallway. If you see or smell no smoke there, knock on the adjoining unit and ask if they’re cooking or showering.</li>
        <li>That alarm needs a quick press of its Test/Hush button, and the air near it needs clearing (open a window or fan the air).</li>
        <li>Once the alarms stop, the one that started it flashes red <strong>once every 20 seconds</strong>. Note which one it is for your report.</li>
      </ol>
      <p><strong>Leave and call ${ZERO} if</strong> you see or smell smoke, you can’t find a harmless cause, or the source alarm still won’t go quiet. The manual says that can mean the smoke is too heavy and it could be dangerous.</p>
      <p class="note">Don’t remove the alarm, cover it, or switch off the power. You would lose your protection.</p>`,
    chirp: `<h3>This is a warning that the alarm needs replacing, not a fire alarm</h3>
      <p><strong>Count the chirps.</strong> They repeat about once a minute (every 54 seconds).</p>
      <div class="signal-list">
        ${sig('y', 1, '1 chirp', 'Low battery')}
        ${sig('y', 2, '2 chirps', 'Fault')}
        ${sig('y', 3, '3 chirps', 'End of life')}
      </div>
      <p class="note">The light flashes the same number of times. The manual’s indicator table says the light is <strong>yellow</strong>, but its troubleshooting page says <strong>red</strong> for low battery and fault. Go by the number of chirps, not the colour.</p>
      <p>The battery is sealed inside, so the whole alarm must be replaced. Don’t open it or try to change the battery. <strong>Report it on the next steps.</strong></p>
      <p class="note">To quieten it for now, quickly press Test/Hush once. The chirp stops for 12 hours (low battery or fault), or for about 24 hours for end of life. That only works in the first 30 days. Hushing doesn’t fix the alarm.</p>`,
    silent: `<h3>What the light means</h3>
      <div class="signal-list">
        ${sig('g steady', 1, 'Steady green light', 'Normal. Running on mains power.')}
        ${sig('g', 1, 'Green flash every 54 seconds', 'Normal. Running on battery power.')}
        ${sig('r', 1, 'Red flash every 10 seconds', 'Hushed. It checks again after about 10 minutes.')}
        ${sig('r', 1, 'Red flash every 20 seconds', '<strong>Alarm memory.</strong> <em>This</em> alarm detected smoke earlier and has stopped. Only the alarm that started it shows this. Note which room it’s in, or photograph it, before pressing anything.')}
        ${sig('y', 1, '1, 2 or 3 flashes every 54 seconds, with chirps', 'The alarm needs replacing. Report it. The manual shows this light as yellow in one place and red in another, so count the chirps.')}
      </div>
      <p class="note">A normal light doesn’t prove an alarm is working properly.</p>`,
    other: `<h3>You don’t need to work it out yourself</h3>
      <p>Describe what you heard or saw in your report. If the alarm keeps going or you’re unsure, contact resort management or call Goldsure on ${CALL}. If danger is possible, leave and call ${ZERO}.</p>
      <p class="note">Never disable a smoke alarm.</p>`,
  };

  const labels = ['Safety first', 'What’s it doing?', 'Details', 'Send report'];
  function show(step) {
    $$('.panel').forEach(p => p.hidden = p.id !== `step-${step}`);
    $('#progress-label').textContent = `Step ${step + 1} of 4 · ${labels[step]}`;
    $$('.progress li').forEach((li, i) => { li.classList.toggle('active', i === step); li.classList.toggle('done', i < step); });
    $('.progress').hidden = false;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('.progress').scrollIntoView({ behavior: reduce ? 'instant' : 'smooth', block: 'start' });
    $(`#heading-${step}`).focus({ preventScroll: true });
  }

  async function session() {
    const r = await fetch('/api/beachcomber/report', { cache: 'no-store' });
    const data = await r.json().catch(() => ({ error: 'Online reporting is temporarily unavailable. Please call Goldsure on (07) 2146 1500.' }));
    if (!r.ok) throw new Error(data.error || 'Reporting is unavailable. Please call Goldsure.');
    token = data.token;
  }

  $('#danger').onclick = () => {
    safe = false;
    const box = $('#emergency-message');
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    box.focus({ preventScroll: true });
  };
  $('#safe').onclick = () => { safe = true; show(1); };
  $('#after-emergency').onclick = () => { safe = true; show(1); };

  $$('[data-back]').forEach(b => b.onclick = () => show(Number(b.dataset.back)));
  $('[data-next="2"]').onclick = () => {
    if (!$('input[name=sound]:checked')) { $('#sound-error').textContent = 'Please choose what the alarm is doing.'; return; }
    $('#sound-error').textContent = '';
    show(2);
  };

  $$('input[name=sound]').forEach(r => r.onchange = () => {
    const g = $('#sound-guidance');
    g.innerHTML = guidance[r.value];
    g.className = `guidance guidance-${r.value}`;
    g.hidden = false;
    $('#sound-error').textContent = '';
    setTimeout(() => g.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  });

  function followUp() {
    const outcome = $('input[name=outcome]:checked')?.value;
    const sound = $('input[name=sound]:checked')?.value;
    const box = $('#follow-up');
    if (outcome === 'ongoing' && (sound === 'loud' || sound === 'other')) {
      box.innerHTML = `<strong>Still going, or came back?</strong><p>The alarm that set it off may be in the hallway or the adjoining unit. Check there, ask your neighbour if they’re cooking or showering, and contact resort management for help on site.</p><p><strong>If you see or smell smoke, can’t find a harmless cause, or the source alarm won’t go quiet, leave and call ${ZERO}.</strong> Don’t wait for a reply to this report.</p>`;
      box.hidden = false;
    } else if (outcome === 'ongoing' || outcome === 'fault') {
      box.innerHTML = `<strong>Please get help.</strong><p>Contact resort management or call Goldsure on ${CALL}. If danger is possible, leave and call ${ZERO}. Don’t wait for a reply to this report.</p>`;
      box.hidden = false;
    } else box.hidden = true;
  }
  $$('input[name=outcome]').forEach(r => r.onchange = () => { followUp(); $('#check-error').textContent = ''; });

  $('#to-report').onclick = () => {
    if (!$('input[name=trigger]:checked') || !$('input[name=outcome]:checked')) {
      $('#check-error').textContent = 'Please answer both questions.';
      return;
    }
    $('#check-error').textContent = '';
    show(3);
    if (!token) session().catch(e => { $('#submit-error').textContent = e.message; });
  };

  async function compress(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Please choose JPG, PNG or WebP photos.');
    if (file.size > 12 * 1024 * 1024) throw new Error('Each photo must be under 12 MB.');
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    return { type: 'image/jpeg', data: canvas.toDataURL('image/jpeg', .72).split(',')[1] };
  }

  $('#photos').onchange = async () => {
    files = []; $('#submit-error').textContent = ''; $('#submit-report').disabled = true;
    try {
      const selected = [...$('#photos').files];
      if (selected.length > 3) throw new Error('Please choose up to 3 photos.');
      $('#photo-status').textContent = selected.length ? 'Preparing photos…' : '';
      const ready = await Promise.all(selected.map(compress));
      if (ready.reduce((n, f) => n + f.data.length * .75, 0) > 2 * 1024 * 1024) throw new Error('Those photos are too large together. Please choose fewer photos.');
      files = ready;
      $('#photo-status').textContent = ready.length ? `✓ ${ready.length} photo${ready.length > 1 ? 's' : ''} ready to send` : '';
    } catch (e) { $('#photos').value = ''; $('#photo-status').textContent = ''; $('#submit-error').textContent = e.message; }
    finally { $('#submit-report').disabled = false; }
  };

  $('#report-form').onsubmit = async e => {
    e.preventDefault(); if (busy || submitted) return;
    const form = new FormData(e.target);
    const unit = String(form.get('unit') || '').replace(/\s/g, '');
    if (!/^\d{1,4}(?:\/\d{1,4})?$/.test(unit)) { $('#submit-error').textContent = 'Please enter your unit number, for example 1005.'; e.target.unit.focus(); return; }
    if (!String(form.get('name') || '').trim()) { $('#submit-error').textContent = 'Please enter your name.'; e.target.name.focus(); return; }
    if (!String(form.get('phone') || '').trim() && !String(form.get('email') || '').trim()) { $('#submit-error').textContent = 'Please enter a phone number or email so we can contact you.'; e.target.phone.focus(); return; }
    busy = true; $('#submit-report').disabled = true; $('#submit-report').textContent = 'Sending…'; $('#submit-error').textContent = '';
    try {
      if (!token) await session();
      const body = { ...Object.fromEntries(form), token, safe, sound: $('input[name=sound]:checked').value, trigger: $('input[name=trigger]:checked').value, outcome: $('input[name=outcome]:checked').value, files };
      const r = await fetch('/api/beachcomber/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({ error: 'We could not confirm delivery. Please try again or call Goldsure on (07) 2146 1500.' }));
      if (!r.ok || !data.ok) { if (data.saved) $('#submit-report').dataset.retry = '1'; throw new Error(data.error || 'We could not confirm delivery. Please try again or call Goldsure.'); }
      submitted = true;
      $$('.panel').forEach(p => p.hidden = p.id !== 'success');
      $('.progress').hidden = true;
      $('#reference').textContent = `Your reference: ${data.reference}`;
      $('#success').scrollIntoView({ block: 'start' });
      $('#success-title').focus({ preventScroll: true });
    } catch (err) { $('#submit-error').textContent = err.message; }
    finally { busy = false; $('#submit-report').disabled = false; $('#submit-report').textContent = $('#submit-report').dataset.retry ? 'Retry sending' : 'Send report'; }
  };

  $('#start-again').onclick = () => location.reload();
})();
