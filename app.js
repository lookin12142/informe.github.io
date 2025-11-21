const WEBHOOK_URL = "https://n8n.smartclic.pe/webhook/0d8b7514-cfbc-4b0f-8d30-466d734fa16a";
const ANALYSIS_WEBHOOK_URL = "https://n8n.smartclic.pe/webhook/analisis";

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
    thead.innerHTML = '<tr><th>ID</th><th>Pregunta</th><th>Respuesta</th><th>Calificación</th><th>Motivo</th></tr>';
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
