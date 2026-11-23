import { zipSync, strToU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { DOCX } from '../src/reference-limits.js';

export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64');
export function wordFile() {
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:t>Build a two-floor office with oak tables and blue chairs.</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Chair reference"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rIdImage"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'),
    'word/_rels/document.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chair.png"/></Relationships>'),
    'word/media/chair.png': png,
  }));
}
export async function pdfFile() {
  const pdf = await PDFDocument.create(); const page = pdf.addPage([300, 300]);
  page.drawText('Office layout: oak tables, blue chairs.', { x: 20, y: 250, size: 12 });
  const img = await pdf.embedPng(png); page.drawImage(img, { x: 20, y: 40, width: 100, height: 100 });
  return Buffer.from(await pdf.save());
}
export async function referenceFixtures() {
  return [
    { name: 'chair.png', mediaType: 'image/png', buffer: png },
    { name: 'floor-plan.pdf', mediaType: 'application/pdf', buffer: await pdfFile() },
    { name: 'design-brief.docx', mediaType: DOCX, buffer: wordFile() },
  ];
}
