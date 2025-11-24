const WEBHOOK_URL = "https://n8n.smartclic.pe/webhook/0d8b7514-cfbc-4b0f-8d30-466d734fa16a";
const ANALYSIS_WEBHOOK_URL = "https://n8n.smartclic.pe/webhook/analisis";
const SAVE_WEBHOOK_URL = "https://n8n.smartclic.pe/webhook/data"; 
const FALTANTES_FETCH_URL = "https://n8n.smartclic.pe/webhook/Faltantes";

const FALTANTES_SAVE_URL = "";
const FALTANTE_FETCH_URL = "https://n8n.smartclic.pe/webhook/Faltante";

// Enviar una sola fecha al webhook principal
async function sendDate() {
  const dateEl = document.getElementById('filterDate');
  if (!dateEl) { alert('No se ha encontrado el campo de fecha.'); return; }
  const date = dateEl.value;
  if (!date) { alert('Selecciona una fecha.'); return; }

  const payload = { date };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store'
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error('sendDate: server error', res.status, t);
      alert('El servidor devolvió un error al enviar la fecha. Revisa la consola.');
      return;
    }

    const text = await res.text();
    if (!text) {
      alert('Respuesta vacía del servidor. Revisa la consola si necesitas más detalles.');
      return;
    }

    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { parsed = null; }

    // Normalizar respuestas con mensajes y renderizar
    if (Array.isArray(parsed)) {
      const isWrapper = parsed.every(it => it && (Array.isArray(it.messages) || (it.conversation_id && !it.message_id)));
      if (isWrapper) {
        const flattened = [];
        parsed.forEach(wrapper => {
          if (Array.isArray(wrapper.messages)) {
            const convId = wrapper.conversation_id || null;
            wrapper.messages.forEach(m => flattened.push({ ...(m || {}), conversation_id: m.conversation_id || convId }));
          }
        });
        renderGroupedConversations(flattened);
        return;
      }

      const looksLikeMessages = parsed.every(p => p && (p.message_id || p.text || p.conversation_id));
      if (looksLikeMessages) {
        renderGroupedConversations(parsed);
        return;
      }
    }

    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.messages)) {
      const mapped = parsed.messages.map(m => ({ ...(m || {}), conversation_id: m.conversation_id || parsed.conversation_id }));
      renderGroupedConversations(mapped);
      return;
    }

    // Mostrar respuesta cruda si no es lista de mensajes
    const analysisContainer = document.getElementById('analysis-container');
    if (analysisContainer) {
      analysisContainer.innerHTML = '<pre style="white-space:pre-wrap;">' + escapeHtml(text) + '</pre>';
    } else {
      alert('Respuesta recibida:\n' + text);
    }

  } catch (err) {
    console.error('sendDate error', err);
    alert('Error enviando la fecha. Revisa la consola para más detalles.');
  }
}

async function parseResponseToData(res) {
  const ct = (res.headers.get('content-type') || '').toLowerCase();

  const raw = await res.text();
  const cleaned = raw.replace(/^\uFEFF/, '').trim();
  if (!cleaned) return [];

  let parsed = null;
  try { parsed = JSON.parse(cleaned); } catch (e) { parsed = null; }

  if (parsed) {
    if (Array.isArray(parsed)) {
      const isArrayOfWrappers = parsed.every(it => it && (Array.isArray(it.messages) || (it.conversation_id && !it.message_id)));
      if (isArrayOfWrappers) {
        const flattened = [];
        parsed.forEach(wrapper => {
          if (Array.isArray(wrapper.messages)) {
            const convId = wrapper.conversation_id || null;
            wrapper.messages.forEach(m => flattened.push({ ...(m || {}), conversation_id: m.conversation_id || convId }));
          }
        });
        console.log('[parseResponseToData] aplanado array de wrappers, mensajes totales:', flattened.length);
        return flattened;
      }

      return parsed;
    }

    if (parsed && typeof parsed === 'object') {

      if (Array.isArray(parsed.messages)) {
        const convId = parsed.conversation_id || null;
        const mapped = parsed.messages.map(m => ({ ...(m || {}), conversation_id: m.conversation_id || convId }));
        console.log('[parseResponseToData] wrapper único, mensajes:', mapped.length);
        return mapped;
      }

      const maybeMessagesKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]) && parsed[k].every(it => it && it.message_id));
      if (maybeMessagesKey) return parsed[maybeMessagesKey];
    }
  }

  try {
    const maybeArray = '[' + cleaned.replace(/}\s*,?\s*\{/g, '},{') + ']';
    const arr = JSON.parse(maybeArray);
    if (Array.isArray(arr)) return arr;
  } catch (e) {}

  const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const tsvLike = lines.length > 0 && lines.every(l => /^\d+\t/.test(l));
  if (tsvLike) {
    return lines.map(line => {
      const parts = line.split(/\t/);
      return {
        message_id: parts[0] || '',
        conversation_id: parts[1] || '',
        sender: parts[2] || '',
        text: parts[3] || '',
        answer: parts[4] || '',
        created_at: parts[5] || '',
        razon_social: parts[6] || '',
        ruc: parts[7] ? parts[7].replace(/\r$/, '') : ''
      };
    });
  }

  throw new Error('No se pudo convertir la respuesta a JSON');
}

async function loadMessages() {
  const res = await fetch(WEBHOOK_URL);
  const data = await parseResponseToData(res);
  renderGroupedConversations(data);
}

async function uploadFile() {
  const input = document.getElementById('fileInput');
  if (!input.files || input.files.length === 0) {
    alert('Selecciona un archivo .txt antes de procesar.');
    return;
  }

  const file = input.files[0];

  // Enviar como multipart/form-data (campo 'file') para que n8n lo reciba como archivo
  const form = new FormData();
  form.append('file', file, file.name);

  let res;
  try {
    res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'X-Filename': file.name },
      body: form
    });
  } catch (err) {
    console.error('Error enviando el archivo al webhook:', err);
    alert('Error al enviar el archivo al webhook. Revisa la consola.');
    return;
  }

  if (!res.ok) {
    console.error('Webhook devolvió error HTTP:', res.status, res.statusText);
    alert('El webhook devolvió un error HTTP. Revisa la consola.');
    return;
  }

  let data;
  try {
    data = await parseResponseToData(res);
  } catch (err) {
    console.error('No se pudo parsear la respuesta del webhook:', err);
    alert('No se pudo parsear la respuesta del webhook. Revisa la consola.');
    return;
  }

  renderGroupedConversations(data);
}

let CHAT_GROUPS = {};
let SELECTED_CONV = null;

function renderGroupedConversations(data) {
  if (!Array.isArray(data)) {
    const container = document.getElementById('chat-container');
    container.innerHTML = 'Respuesta inesperada del webhook (no es una lista).';
    console.warn('Respuesta del webhook:', data);
    return;
  }

  CHAT_GROUPS = groupBy(data, m => (m.conversation_id || 'sin_id'));

  renderConversationList(CHAT_GROUPS);

  // seleccionar la primera conversación si no hay selección
  const firstConv = Object.keys(CHAT_GROUPS).sort((a,b)=> a.localeCompare(b))[0];
  if (firstConv) showConversation(firstConv);
}

function renderConversationList(groups) {
  const list = document.getElementById('conversations-list');
  if (!list) return;
  list.innerHTML = '';

  const ids = Object.keys(groups).sort((a,b)=> a.localeCompare(b));
  if (ids.length === 0) {
    list.textContent = 'No hay conversaciones.';
    return;
  }

  ids.forEach(id => {
    const msgs = groups[id] || [];
    const first = msgs.find(m => m.razon_social) || msgs[0] || {};

    const item = document.createElement('div');
    item.className = 'conversation-item';
    item.dataset.conv = id;

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = `Chat ${id}`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const company = first.razon_social ? ` — ${first.razon_social}` : '';
    meta.textContent = `${msgs.length} mensaje${msgs.length>1?'s':''}${company}`;

    item.appendChild(title);
    item.appendChild(meta);

    item.addEventListener('click', () => showConversation(id));

    list.appendChild(item);
  });
}

function showConversation(convId) {
  SELECTED_CONV = convId;

  // actualizar estado activo en la lista
  const items = document.querySelectorAll('.conversation-item');
  items.forEach(it => it.classList.toggle('active', it.dataset.conv === String(convId)));

  const msgs = (CHAT_GROUPS[convId] || []).slice().sort((a,b)=> parseDate(a.created_at) - parseDate(b.created_at));
  const container = document.getElementById('chat-container');
  container.innerHTML = '';

  const convDiv = document.createElement('div');
  convDiv.className = 'conversation';

  const first = msgs.find(m => m.razon_social) || msgs[0] || {};
  const header = document.createElement('h3');
  const rucClean = first.ruc ? String(first.ruc).trim() : '';
  header.textContent = `Chat ${convId} ${first.razon_social ? '— ' + first.razon_social : ''} ${rucClean ? '(' + rucClean + ')' : ''} — ${msgs.length} mensaje${msgs.length>1?'s':''}`;
  convDiv.appendChild(header);

    msgs.forEach((m, idx) => {
    const div = document.createElement('div');
    div.className = 'msg ' + (m.sender === 'user' ? 'user' : 'bot');

    const textHtml = renderMarkdown(String(m.text || ''));
    const idLabel = m.message_id ? m.message_id : `(sin id #${idx+1})`;
    const meta = `ID: ${idLabel} — ${m.created_at || ''}`;

    div.innerHTML = `<div class="text">${textHtml}</div><div class="meta">${meta}</div>`;
    convDiv.appendChild(div);
  });

  container.appendChild(convDiv);
}

function groupBy(array, keyFn) {
  return array.reduce((acc, item) => {
    const key = keyFn(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function escapeHtml(str) {
  return str.replace(/[&<>"'`]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;', '`':'&#96;'})[s]);
}

function sanitizeUrl(url) {
  if (!url) return '#';
  const u = String(url).trim();
  // permitir solo http, https y mailto
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return u;
  return '#';
}

function renderMarkdown(md) {
  if (!md) return '';
  let s = String(md);
  // escape HTML first
  s = escapeHtml(s);

  // code spans: `code`
  s = s.replace(/`([^`]+)`/g, (m, p1) => `<code>${p1}</code>`);

  // links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
    const safe = sanitizeUrl(url);
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // bold **text** or __text__
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // italic *text* or _text_
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/_([^_]+)_/g, '<em>$1</em>');

  // convert two or more newlines into paragraph breaks
  s = s.replace(/\n{2,}/g, '</p><p>');
  // single newline to <br>
  s = s.replace(/\n/g, '<br>');

  // wrap in paragraph if not already
  if (!s.startsWith('<p>')) s = '<p>' + s + '</p>';
  return s;
}

// Enviar el archivo a un webhook que devuelve el análisis de la conversación
async function sendForAnalysis() {
  const input = document.getElementById('fileInput');
  if (!input || !input.files || input.files.length === 0) {
    alert('Selecciona un archivo .txt antes de enviar para análisis.');
    return;
  }

  const file = input.files[0];
  const form = new FormData();
  form.append('file', file, file.name);

  let res;
  try {
    res = await fetch(ANALYSIS_WEBHOOK_URL, { method: 'POST', body: form });
  } catch (err) {
    console.error('Error enviando al webhook de análisis:', err);
    alert('Error al enviar al webhook de análisis. Revisa la consola.');
    return;
  }

  if (!res.ok) {
    console.error('Análisis: error HTTP', res.status, res.statusText);
    alert('El webhook de análisis devolvió un error HTTP. Revisa la consola.');
    return;
  }

  let text;
  try {
    text = await res.text();
  } catch (err) {
    console.error('Error leyendo respuesta del análisis:', err);
    alert('Error leyendo respuesta del análisis. Revisa la consola.');
    return;
  }

  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (!cleaned) {
    alert('El webhook de análisis devolvió respuesta vacía.');
    return;
  }

  let obj;
  try { obj = JSON.parse(cleaned); } catch (err) {
    console.error('La respuesta del análisis no es JSON válido:', err, cleaned);
    alert('La respuesta del análisis no es JSON válido. Revisa la consola.');
    return;
  }

  renderAnalysis(obj);
}

function renderAnalysis(obj) {
  const container = document.getElementById('analysis-container');
  if (!container) return;
  container.innerHTML = '';

  // store last analysis object globally so it can be sent to persistence endpoint
  window.LAST_ANALYSIS = obj;

  if (!obj || typeof obj !== 'object') {
    container.textContent = 'Respuesta de análisis no válida.';
    return;
  }

  const title = document.createElement('h4');
  title.textContent = `Análisis conversación ${obj.conversation_id || ''}`;
  container.appendChild(title);

  if (Array.isArray(obj.evaluacion)) {
    const table = document.createElement('table');
    table.className = 'analysis-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>ID</th><th>Pregunta</th><th>Respuesta</th><th>Calificación</th><th>Motivo</th><th>Acciones</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    obj.evaluacion.forEach(item => {
      const tr = document.createElement('tr');
      const id = item.message_id || '';
      const pregunta = escapeHtml(String(item.pregunta || ''));
      const respuesta = escapeHtml(String(item.respuesta || ''));
      const cal = item.calificacion != null ? String(item.calificacion) : '';
      const motivo = escapeHtml(String(item.motivo || ''));
      tr.innerHTML = `<td>${id}</td><td>${pregunta}</td><td>${respuesta}</td><td>${cal}</td><td>${motivo}</td>`;

      // add action cell with save button for this evaluation item
      const actionTd = document.createElement('td');
      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn primary large';
      saveBtn.textContent = 'Guardar';
      saveBtn.addEventListener('click', async (ev) => {
        try {
          saveBtn.disabled = true;
          const prev = saveBtn.textContent;
          saveBtn.textContent = 'Guardando...';
          await saveSingleEvaluation(item, obj.conversation_id);
          saveBtn.textContent = 'Guardado';
        } catch (e) {
          console.error('Error guardando evaluación:', e);
          alert('Error al guardar la evaluación. Revisa la consola.');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Guardar';
        }
      });
      actionTd.appendChild(saveBtn);
      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  } else {
    const p = document.createElement('p');
    p.textContent = 'No hay evaluaciones en la respuesta.';
    container.appendChild(p);
  }

  if (obj.resumen_general && typeof obj.resumen_general === 'object') {
    const s = obj.resumen_general;
    const div = document.createElement('div');
    div.className = 'analysis-summary';
    div.innerHTML = `
      <strong>Puntaje promedio:</strong> ${s.puntaje_promedio || 0}<br>
      <strong>Cantidad preguntas:</strong> ${s.cantidad_preguntas || 0}<br>
      <strong>Cantidad respuestas malas:</strong> ${s.cantidad_respuestas_malas || 0}<br>
      <strong>Observaciones:</strong> ${escapeHtml(String(s.observaciones || ''))}
    `;
    container.appendChild(div);
  }
}

// Enviar el análisis almacenado al endpoint de persistencia
async function saveAnalysisData() {
  const obj = window.LAST_ANALYSIS;
  if (!obj) {
    alert('No hay datos de análisis para guardar. Ejecuta primero el análisis.');
    return;
  }

  try {
    const res = await fetch(SAVE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj)
    });

    if (!res.ok) {
      console.error('Guardar análisis: HTTP', res.status, res.statusText);
      alert('Error al guardar el análisis. Revisa la consola para más detalles.');
      return;
    }

    // try to read response text/json for confirmation
    let text = '';
    try { text = await res.text(); } catch(e) { text = ''; }
    console.log('Guardar análisis: respuesta del servidor:', text);
    alert('Análisis guardado correctamente.');
  } catch (err) {
    console.error('Error enviando análisis al endpoint de guardado:', err);
    alert('Error al enviar el análisis al servidor. Revisa la consola.');
  }
}

// Enviar una sola evaluación al endpoint de persistencia
async function saveSingleEvaluation(item, conversation_id) {
  if (!item) throw new Error('Item vacío');

  const payload = {
    conversation_id: conversation_id || (window.LAST_ANALYSIS && window.LAST_ANALYSIS.conversation_id) || null,
    evaluacion: item,
    saved_at: new Date().toISOString()
  };

  const res = await fetch(SAVE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Guardar single eval fallo: ' + res.status + ' ' + text);
  }

  return true;
}

// --- FALTANTES: funciones para cargar y marcar estados (completo / faltante)
// loadFaltantes: obtiene la lista desde FALTANTES_FETCH_URL y la muestra en el DOM
async function loadFaltantes() {
  const wrap = document.getElementById('faltantes-wrap');
  if (wrap) wrap.innerHTML = 'Cargando...';
  try {
    // Build cache-busted URL to avoid 304 Not Modified responses from intermediate caches
    const ts = Date.now();
    const primaryUrl = FALTANTES_FETCH_URL + (FALTANTES_FETCH_URL.includes('?') ? '&' : '?') + '_ts=' + ts;
    const singularUrl = FALTANTE_FETCH_URL + (FALTANTE_FETCH_URL.includes('?') ? '&' : '?') + '_ts=' + ts;

    // Use no-store to force network request
    let res = await fetch(primaryUrl, { cache: 'no-store', mode: 'cors' });
    if (!res.ok) {
      console.warn('Faltantes fetch failed, trying singular endpoint:', res.status);
      res = await fetch(singularUrl, { cache: 'no-store', mode: 'cors' });
    }

    if (res.status === 304) {
      // 304 means Not Modified - no body available; force a cache-busted request
      const forceUrl = primaryUrl + '&force=' + Date.now();
      res = await fetch(forceUrl, { cache: 'no-store', mode: 'cors' });
    }

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('HTTP ' + res.status + ' ' + t);
    }

    // Try to parse JSON - if the server returns 304 there will be no body
    const text = await res.text();
    if (!text) {
      throw new Error('Respuesta vacía del servidor (posible problema de caché o 304).');
    }
    const data = JSON.parse(text);
    renderFaltantes(data);
  } catch (err) {
    console.error('Error cargando faltantes:', err);
    if (wrap) wrap.innerHTML = 'Error cargando faltantes. Revisa la consola.';
    // If it's likely a CORS error, show a clearer hint
    if (err instanceof TypeError && /Failed to fetch/i.test(err.message)) {
      alert('Error de red/CORS al intentar cargar faltantes. Asegúrate de que el servidor n8n permita CORS (Access-Control-Allow-Origin) para este origen, o abre la página desde http://localhost usando un servidor local. Revisa la consola para más detalles.');
    } else {
      alert('Error cargando faltantes. Revisa la consola. ' + (err.message || ''));
    }
  }
}

function renderFaltantes(items) {
  const wrap = document.getElementById('faltantes-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  if (!Array.isArray(items) || items.length === 0) {
    wrap.textContent = 'No se encontraron faltantes.';
    return;
  }

  const table = document.createElement('table');
  table.className = 'faltantes-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>ID</th><th>Created At</th><th>Updated At</th><th>Pregunta</th><th>Respuesta</th><th>Calificación</th><th>Motivo</th><th>ID Chat</th><th>Acciones</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');

  items.forEach(it => {
    const tr = document.createElement('tr');
    const id = it.id != null ? it.id : '';
    const createdAt = it.createdAt || it.created_at || '';
    const updatedAt = it.updatedAt || it.updated_at || '';
    const pregunta = escapeHtml(String(it.Pregunta || it.pregunta || ''));
    const respuesta = escapeHtml(String(it.respuesta || it.Respuesta || ''));
    const cal = it.calificacion != null ? String(it.calificacion) : '';
    const motivo = escapeHtml(String(it.motivo || ''));
    const id_chat = it.id_chat || it.conversation_id || '';

    tr.innerHTML = `<td>${id}</td><td>${createdAt}</td><td>${updatedAt}</td><td>${pregunta}</td><td>${respuesta}</td><td>${cal}</td><td>${motivo}</td><td>${id_chat}</td>`;

    const actionsTd = document.createElement('td');
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'faltante-item-actions';

    const btnComplete = document.createElement('button');
    btnComplete.className = 'btn success small';
    btnComplete.textContent = 'Marcar completo';
    btnComplete.addEventListener('click', async () => {
      try {
        btnComplete.disabled = true;
        btnComplete.textContent = 'Guardando...';
        await saveFaltanteStatus({ id, id_chat }, 'completo');
        btnComplete.textContent = 'Completo';
      } catch (e) {
        console.error(e);
        alert('Error guardando estado. Revisa la consola.');
        btnComplete.disabled = false;
        btnComplete.textContent = 'Marcar completo';
      }
    });

    const btnMissing = document.createElement('button');
    btnMissing.className = 'btn warn small';
    btnMissing.textContent = 'Marcar faltante';
    btnMissing.addEventListener('click', async () => {
      try {
        btnMissing.disabled = true;
        btnMissing.textContent = 'Guardando...';
        await saveFaltanteStatus({ id, id_chat }, 'faltante');
        btnMissing.textContent = 'Faltante';
      } catch (e) {
        console.error(e);
        alert('Error guardando estado. Revisa la consola.');
        btnMissing.disabled = false;
        btnMissing.textContent = 'Marcar faltante';
      }
    });

    actionsWrap.appendChild(btnComplete);
    actionsWrap.appendChild(btnMissing);
    actionsTd.appendChild(actionsWrap);
    tr.appendChild(actionsTd);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
}

// Guardar estado de un faltante (si FALTANTES_SAVE_URL está vacío, solo loguea el payload)
async function saveFaltanteStatus(ids, status) {
  const payload = { ids, status, saved_at: new Date().toISOString() };
  if (!FALTANTES_SAVE_URL) {
    console.log('[saveFaltanteStatus] payload (no enviado, FALTANTES_SAVE_URL vacío):', payload);
    alert('FALTANTES_SAVE_URL no está configurado. El payload se ha mostrado en la consola.');
    return true;
  }

  const res = await fetch(FALTANTES_SAVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const t = await res.text().catch(()=>'');
    throw new Error('HTTP ' + res.status + ' ' + t);
  }
  return true;
}

function parseDate(s) {
  if (!s) return 0;
  const iso = String(s).replace(' ', 'T');
  const d = new Date(iso);
  if (!isNaN(d)) return d.getTime();
  const p = Date.parse(s);
  return isNaN(p) ? 0 : p;
}

// Cargar mensajes iniciales
loadMessages();
