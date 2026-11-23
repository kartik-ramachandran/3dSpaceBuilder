import mammoth from 'mammoth';
import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_IMAGE_BYTES, DOCX, IMAGE_TYPES } from '../src/reference-limits.js';

const invalid = (message) => Object.assign(new Error(message), { code: 'bad_reference', status: 400 });
function imageType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(buffer.subarray(0, 6).toString())) return 'image/gif';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

export async function referenceContent(files = []) {
  if (!Array.isArray(files) || files.length > MAX_FILES) throw invalid('Attach up to 6 reference files.');
  const content = []; let total = 0, imageCount = 0, pdfPages = 0;
  function addImage(buffer, type, name) {
    if (!IMAGE_TYPES.includes(type) || imageType(buffer) !== type) throw invalid(`${name}: unsupported or invalid image. Export the document as PDF if it contains vector images.`);
    if (buffer.length > MAX_IMAGE_BYTES) throw invalid(`${name}: an image is too large. Reduce it to 4 MB or export the document as PDF.`);
    if (++imageCount > 24) throw invalid('Use at most 24 images across the reference files.');
    content.push({ type: 'image', source: { type: 'base64', media_type: type, data: buffer.toString('base64') } });
  }
  for (const file of files) {
    const name = String(file?.name || 'Reference').slice(0, 160);
    const data = file?.data, type = file?.mediaType;
    if (typeof data !== 'string' || !data.length || data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw invalid(`${name}: invalid or oversized file.`);
    const buffer = Buffer.from(data, 'base64'); total += buffer.length;
    if (buffer.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw invalid('References must total 20 MB or less, with each file no larger than 10 MB.');
    content.push({ type: 'text', text: `Reference file: ${name}` });
    if (IMAGE_TYPES.includes(type)) addImage(buffer, type, name);
    else if (type === 'application/pdf') {
      if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw invalid(`${name}: this is not a valid PDF.`);
      try {
        const pdf = await PDFDocument.load(buffer, { updateMetadata: false });
        pdfPages += pdf.getPageCount();
      } catch { throw invalid(`${name}: the PDF is damaged or password-protected. Upload an unlocked copy.`); }
      if (pdfPages > 50) throw invalid('Use at most 50 PDF pages across the references.');
      content.push({ type: 'document', title: name, source: { type: 'base64', media_type: type, data } });
    } else if (type === DOCX) {
      try {
        let expanded = 0, entries = 0, hasDocument = false;
        unzipSync(buffer, { filter: (entry) => {
          expanded += entry.originalSize; entries++;
          if (expanded > 40 * 1024 * 1024 || entries > 2000) throw invalid(`${name}: this Word document expands beyond the supported size.`);
          if (entry.name === 'word/document.xml') hasDocument = true;
          return false;
        } });
        if (!hasDocument) throw invalid(`${name}: this is not a DOCX document.`);
        const text = await mammoth.extractRawText({ buffer });
        if (text.value.length > 100000) throw invalid(`${name}: shorten the document to fewer than 100,000 characters.`);
        if (text.value.trim()) content.push({ type: 'text', text: `Document instructions and descriptions (${name}):\n${text.value}` });
        let conversionError;
        const converted = await mammoth.convertToHtml({ buffer }, {
          externalFileAccess: false,
          convertImage: mammoth.images.imgElement(async (image) => {
            try { addImage(Buffer.from(await image.read('base64'), 'base64'), image.contentType, name); }
            catch (e) { conversionError = e; }
            return { src: '' }; // HTML is never displayed; only extracted text and images are sent.
          }),
        });
        if (conversionError) throw conversionError;
        if (converted.messages.some((m) => m.type === 'error')) throw invalid(`${name}: an embedded image could not be read. Try exporting it as PDF.`);
        if (!text.value.trim() && !converted.value.includes('<img')) throw invalid(`${name}: no readable text or images were found.`);
      } catch (e) { if (e.code === 'bad_reference') throw e; throw invalid(`${name}: could not open this Word document. Try exporting it as PDF.`); }
    } else throw invalid(`${name}: use an image, PDF or DOCX file.`);
  }
  // Embedded DOCX images may exceed the compressed file size considerably.
  if (JSON.stringify(content).length > 28 * 1024 * 1024) throw invalid('The extracted references are too large. Use fewer or smaller files.');
  return content;
}
