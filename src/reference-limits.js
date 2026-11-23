export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export function referenceType(name, mime) {
  const ext = String(name).split('.').pop().toLowerCase();
  const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', docx: DOCX }[ext];
  return type && (!mime || mime === type || mime === 'application/octet-stream') ? type : null;
}
