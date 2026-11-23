import { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_IMAGE_BYTES, referenceType } from './reference-limits.js';

const readDataURL = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Could not read this file.'));
  reader.readAsDataURL(file);
});

async function prepare(file, mediaType) {
  let url = await readDataURL(file);
  if (mediaType.startsWith('image/')) {
    const img = new Image(); img.src = url;
    try { await img.decode(); } catch { throw new Error('This image could not be opened.'); }
    const scale = Math.min(1, 1536 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    mediaType = mediaType === 'image/png' ? 'image/png' : 'image/jpeg';
    url = canvas.toDataURL(mediaType, 0.88);
    if (url.length * 0.75 > MAX_IMAGE_BYTES) { mediaType = 'image/jpeg'; url = canvas.toDataURL(mediaType, 0.85); }
    if (url.length * 0.75 > MAX_IMAGE_BYTES) throw new Error('Please use a smaller image.');
  }
  return { name: file.name, mediaType, data: url.split(',')[1], preview: mediaType.startsWith('image/') ? url : null };
}

export function createReferences(onChange) {
  const input = document.querySelector('#referenceInput'), add = document.querySelector('#attachBtn');
  const tray = document.querySelector('#referenceList'), status = document.querySelector('#referenceStatus'), dock = document.querySelector('#dock');
  const items = []; let pending = 0, locked = false, nextId = 0;
  let queue = Promise.resolve();
  function render() {
    tray.replaceChildren(); tray.hidden = !items.length;
    for (const item of items) {
      const card = document.createElement('li'); card.className = 'reference-card';
      if (item.preview) { const image = document.createElement('img'); image.src = item.preview; image.alt = ''; card.append(image); }
      else { const icon = document.createElement('span'); icon.className = 'reference-type'; icon.textContent = item.mediaType === 'application/pdf' ? 'PDF' : 'DOCX'; card.append(icon); }
      const label = document.createElement('span'); label.className = 'reference-name'; label.textContent = item.name; label.title = item.name;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'x'; remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${item.name}`); remove.disabled = locked;
      remove.onclick = () => { items.splice(items.indexOf(item), 1); status.textContent = ''; render(); };
      card.append(label, remove); tray.append(card);
    }
    add.disabled = locked || pending > 0 || items.length >= MAX_FILES; input.disabled = add.disabled;
    add.setAttribute('aria-label', `Attach images, PDF or DOCX${items.length ? ` (${items.length} attached)` : ''}`);
    onChange();
  }
  function enqueue(files) {
    if (locked) return;
    const batch = Array.from(files); if (!batch.length) return;
    pending++; status.textContent = 'Preparing references…'; render();
    queue = queue.then(async () => {
      const errors = [];
      for (const file of batch) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (items.some((item) => item.key === key)) continue;
        const type = referenceType(file.name, file.type);
        if (!type) { errors.push(`${file.name}: use JPG, PNG, WebP, GIF, PDF or DOCX.`); continue; }
        if (!file.size || file.size > MAX_FILE_BYTES) { errors.push(`${file.name}: files must be between 1 byte and 10 MB.`); continue; }
        if (items.length >= MAX_FILES || items.reduce((n, item) => n + item.size, 0) + file.size > MAX_TOTAL_BYTES) { errors.push('Attach up to 6 files, with a combined size of 20 MB.'); break; }
        try { items.push({ ...await prepare(file, type), size: file.size, key, id: ++nextId }); }
        catch (e) { errors.push(`${file.name}: ${e.message}`); }
      }
      pending--; status.textContent = errors.join(' ') || (items.length ? `${items.length} reference${items.length === 1 ? '' : 's'} ready. Add instructions or build from the files.` : ''); render();
    });
  }
  add.onclick = () => input.click();
  input.onchange = () => { enqueue(input.files); input.value = ''; };
  dock.addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); dock.classList.add('dragging'); } });
  dock.addEventListener('dragleave', (e) => { if (!dock.contains(e.relatedTarget)) dock.classList.remove('dragging'); });
  dock.addEventListener('drop', (e) => { e.preventDefault(); dock.classList.remove('dragging'); enqueue(e.dataTransfer.files); });
  dock.addEventListener('paste', (e) => { if (e.clipboardData.files.length) { e.preventDefault(); enqueue(e.clipboardData.files); } });
  return {
    files: () => items.map(({ name, mediaType, data }) => ({ name, mediaType, data })),
    preparing: () => pending > 0,
    lock(value) { locked = value; render(); },
  };
}
