import { readFile } from 'node:fs/promises';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, Footer, PageNumber } from 'docx';
import ExcelJS from 'exceljs';
import pptxgen from './vendor/pptxgenjs-4.0.1.mjs';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { normalizeSpec } from './spec.mjs';

const FONT = '맑은 고딕';
const INK = '183246';
const ACCENT = '267C76';
const WIDTH = 9638;
export const escapeXml = (text) => String(text ?? '').replace(/[<>&"']/gu, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]));
const meta = (spec) => [spec.company, spec.author && `작성자: ${spec.author}`, spec.period && `기간: ${spec.period}`].filter(Boolean).join(' · ');
const provenance = (spec) => spec.sources.length ? [{ heading: '작성 근거', paragraphs: spec.sources }] : [];
const allSections = (spec) => [...spec.sections, ...provenance(spec)];

export async function renderDocx(input) {
  const spec = normalizeSpec(input);
  const p = (text, options = {}) => new Paragraph({ spacing: { after: 140, line: 340 }, ...options, children: String(text).split('\n').map((line, index) => new TextRun({ text: line, ...(index ? { break: 1 } : {}) })) });
  const children = [p(spec.title, { heading: HeadingLevel.TITLE }), ...(meta(spec) ? [p(meta(spec))] : [])];
  for (const section of allSections(spec)) {
    if (section.heading) children.push(p(section.heading, { heading: HeadingLevel.HEADING_1, keepNext: true }));
    children.push(...section.paragraphs.map((text) => p(text)));
    if (section.table) {
      const count = section.table.columns.length;
      const widths = Array.from({ length: count }, (_, i) => Math.floor(WIDTH / count) + (i === count - 1 ? WIDTH % count : 0));
      children.push(new Table({ width: { size: WIDTH, type: WidthType.DXA }, columnWidths: widths,
        rows: [section.table.columns, ...section.table.rows].map((row, r) => new TableRow({ tableHeader: r === 0, cantSplit: false, children: row.map((cell, i) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, margins: { top: 90, bottom: 90, left: 110, right: 110 }, ...(r === 0 ? { shading: { type: ShadingType.CLEAR, fill: 'E7F1EF' } } : {}), children: [p(cell, { spacing: { after: 20, line: 300 } })] })) })) }));
      children.push(p(''));
    }
  }
  const document = new Document({ creator: 'ModyCrew', title: spec.title,
    styles: { default: { document: { run: { font: { name: FONT, eastAsia: FONT }, size: 21, color: INK }, paragraph: { spacing: { line: 340 } } } }, paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', run: { size: 38, bold: true, color: INK }, paragraph: { spacing: { after: 280 } } },
      { id: 'Heading1', name: 'heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: ACCENT }, paragraph: { spacing: { before: 280, after: 140 }, keepNext: true } },
    ] }, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '687A83' })] })] }) }, children }] });
  return Packer.toBuffer(document);
}

// Conservative CJK-aware wrapping keeps slide text editable and inside its box.
export function wrapText(text, units = 48) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = ''; let width = 0;
    for (const char of paragraph) {
      const size = /[\u1100-\uffff]/u.test(char) ? 1 : 0.55;
      if (line && width + size > units && !/[.,!?;:，。！？、)\]〉》」』]/u.test(char)) { lines.push(line); line = ''; width = 0; }
      line += char; width += size;
    }
    lines.push(line);
  }
  return lines;
}

export async function renderPptx(input) {
  const spec = normalizeSpec(input);
  const deck = new pptxgen();
  deck.layout = 'LAYOUT_WIDE'; deck.author = 'ModyCrew'; deck.subject = spec.title; deck.title = spec.title; deck.company = spec.company;
  deck.lang = 'ko-KR'; deck.theme = { headFontFace: FONT, bodyFontFace: FONT, lang: 'ko-KR' };
  let number = 0;
  const slide = (heading) => {
    const s = deck.addSlide(); number++;
    s.background = { color: 'F7F9F9' };
    s.addText(heading || spec.title, { x: 0.7, y: 0.55, w: 11.9, h: 1.05, fontFace: FONT, fontSize: heading.length > 115 ? 14 : heading.length > 80 ? 18 : heading.length > 40 ? 24 : 28, bold: true, color: INK, margin: 0, breakLine: false, valign: 'mid' });
    s.addText(`${spec.company || 'ModyCrew'}  ·  ${number}`, { x: 0.7, y: 7.08, w: 11.9, h: 0.2, fontFace: FONT, fontSize: 10, color: '667E86', margin: 0 });
    return s;
  };
  const cover = deck.addSlide(); number++;
  cover.background = { color: INK };
  cover.addText('ModyCrew · 업무 문서', { x: 0.85, y: 0.8, w: 11.6, h: 0.4, color: 'A4D7CA', fontSize: 15, fontFace: FONT, margin: 0 });
  cover.addText(spec.title, { x: 0.85, y: 1.9, w: 11.6, h: 3.1, color: 'FFFFFF', fontFace: FONT, fontSize: spec.title.length > 85 ? 28 : spec.title.length > 40 ? 36 : 44, bold: true, margin: 0, valign: 'mid' });
  cover.addText(meta(spec), { x: 0.85, y: 6.0, w: 11.6, h: 0.7, color: 'D4E2E7', fontSize: 16, fontFace: FONT, margin: 0 });
  for (const section of allSections(spec)) {
    const lines = section.paragraphs.flatMap((text, i) => [...(i ? [''] : []), ...wrapText(text, 45)]);
    for (let offset = 0; offset < lines.length; offset += 13) {
      const s = slide(`${section.heading || spec.title}${offset ? ' · 계속' : ''}`);
      s.addText(lines.slice(offset, offset + 13).join('\n'), { x: 0.85, y: 1.95, w: 11.55, h: 4.8, fontFace: FONT, fontSize: 18, color: INK, margin: 0, breakLine: false, lineSpacingMultiple: 1.15, valign: 'top' });
    }
    if (section.table) {
      const n = section.table.columns.length;
      const fontSize = n > 6 ? 12 : 15;
      const cellUnits = Math.max(5, Math.floor((11.4 / n - 0.15) * 72 / fontSize));
      if (section.table.columns.some((column) => wrapText(column, cellUnits).length > 3)) throw new Error('발표용 표의 열 제목이 너무 깁니다. 제목을 줄이거나 Word·Excel 형식으로 저장해 주세요.');
      const rows = section.table.rows.flatMap((row) => {
        const cells = row.map((cell) => wrapText(cell, cellUnits));
        const count = Math.max(1, ...cells.map((c) => Math.ceil(c.length / 3)));
        return Array.from({ length: count }, (_, i) => cells.map((c) => c.slice(i * 3, i * 3 + 3).join('\n')));
      });
      const header = section.table.columns.map((text) => ({ text, options: { bold: true, color: 'FFFFFF', fill: ACCENT } }));
      for (let offset = 0; offset < Math.max(1, rows.length); offset += 5) {
        const s = slide(`${section.heading || spec.title} · 표${offset ? ' (계속)' : ''}`);
        s.addTable([header, ...rows.slice(offset, offset + 5)], { x: 0.8, y: 1.95, w: 11.7, colW: Array(n).fill(11.7 / n), rowH: 0.68, border: { type: 'solid', pt: 0.5, color: 'CBD7DB' }, color: INK, fill: 'FFFFFF', fontFace: FONT, fontSize, margin: 0.07, valign: 'middle', autoPage: false });
      }
    }
  }
  return Buffer.from(await deck.write({ outputType: 'nodebuffer' }));
}

export async function renderXlsx(input) {
  const spec = normalizeSpec(input);
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'ModyCrew'; workbook.title = spec.title;
  allSections(spec).forEach((section, index) => {
    const sheet = workbook.addWorksheet(`${index + 1} ${(section.heading || '본문').replace(/[\\/*?:\[\]]/gu, ' ')}`.slice(0, 31));
    const count = Math.max(2, section.table?.columns.length || 2);
    sheet.columns = Array.from({ length: count }, () => ({ width: Math.max(14, Math.floor(90 / count)) }));
    const addWideRow = (text, bold = false) => {
      const chunks = wrapText(text, 76);
      for (let i = 0; i < chunks.length; i += 16) {
        const row = sheet.addRow([chunks.slice(i, i + 16).join('\n')]); sheet.mergeCells(row.number, 1, row.number, count);
        row.font = { name: FONT, size: bold ? 16 : 11, bold, color: { argb: `FF${INK}` } }; row.alignment = { wrapText: true, vertical: 'top' }; row.height = Math.max(28, Math.min(360, chunks.slice(i, i + 16).length * 18));
      }
    };
    addWideRow(spec.title, true); if (meta(spec)) addWideRow(meta(spec)); addWideRow(section.heading, true); section.paragraphs.forEach((text) => addWideRow(text));
    if (section.table) {
      const header = sheet.addRow(section.table.columns); header.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' } }; header.height = 30;
      header.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${ACCENT}` } }; cell.alignment = { wrapText: true, vertical: 'middle' }; });
      for (const cells of section.table.rows) {
        const row = sheet.addRow(cells); row.font = { name: FONT, size: 11 }; row.alignment = { wrapText: true, vertical: 'top' };
        row.height = Math.min(409, Math.max(28, ...cells.map((text) => wrapText(text, Math.max(7, 80 / count)).length * 17)));
      }
      sheet.autoFilter = { from: { row: header.number, column: 1 }, to: { row: sheet.rowCount, column: section.table.columns.length } };
      sheet.views = [{ state: 'frozen', ySplit: header.number }];
      sheet.pageSetup.printTitlesRow = `${header.number}:${header.number}`;
    }
    sheet.pageSetup = { ...sheet.pageSetup, paperSize: 9, orientation: count > 5 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function renderHtml(input) {
  const spec = normalizeSpec(input);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escapeXml(spec.title)}</title><style>@page{size:A4;margin:20mm}*{box-sizing:border-box}body{font:10.5pt/1.65 '${FONT}',sans-serif;color:#${INK};overflow-wrap:anywhere}h1{font-size:22pt;line-height:1.4;margin:0 0 14pt}h2{font-size:14pt;color:#${ACCENT};margin:24pt 0 8pt;break-after:avoid}p{white-space:pre-wrap;margin:0 0 9pt;orphans:3;widows:3}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:12pt 0}th,td{border:1px solid #cbd7db;padding:7pt;white-space:pre-wrap;vertical-align:top}th{background:#e7f1ef}thead{display:table-header-group}.meta{color:#667e86;font-size:9pt}</style></head><body><h1>${escapeXml(spec.title)}</h1><p class="meta">${escapeXml(meta(spec))}</p>${allSections(spec).map((s) => `${s.heading ? `<h2>${escapeXml(s.heading)}</h2>` : ''}${s.paragraphs.map((p) => `<p>${escapeXml(p)}</p>`).join('')}${s.table ? `<table><thead><tr>${s.table.columns.map((c) => `<th>${escapeXml(c)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeXml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}`).join('')}</body></html>`;
}

export async function renderHwpx(input) {
  const spec = normalizeSpec(input);
  const zip = await JSZip.loadAsync(await readFile(new URL('./assets/hwpx-base.hwpx', import.meta.url)));
  const xml = await zip.file('Contents/section0.xml').async('string');
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const root = dom.documentElement;
  const tableSample = root.getElementsByTagName('hp:tbl')[0];
  const cellSample = tableSample.getElementsByTagName('hp:tc')[0];
  const head = new DOMParser().parseFromString(await zip.file('Contents/header.xml').async('string'), 'application/xml');
  for (const font of [...head.getElementsByTagName('hh:font')]) font.setAttribute('face', FONT);
  const charProperties = head.getElementsByTagName('hh:charProperties')[0];
  const charBase = head.getElementsByTagName('hh:charPr')[0];
  const nextStyle = Math.max(...[...head.getElementsByTagName('hh:charPr')].map((node) => Number(node.getAttribute('id')))) + 1;
  for (const [offset, height, color] of [[0, '2000', '#183246'], [1, '1400', '#267C76']]) {
    const style = charBase.cloneNode(true); style.setAttribute('id', String(nextStyle + offset)); style.setAttribute('height', height); style.setAttribute('textColor', color);
    if (!style.getElementsByTagName('hh:bold').length) style.appendChild(head.createElementNS(style.namespaceURI, 'hh:bold'));
    charProperties.appendChild(style);
  }
  charProperties.setAttribute('itemCnt', String(charProperties.getElementsByTagName('hh:charPr').length));
  const pageMargin = root.getElementsByTagName('hp:pagePr')[0]?.getElementsByTagName('hp:margin')[0];
  if (pageMargin) { pageMargin.setAttribute('left', '5669'); pageMargin.setAttribute('right', '5669'); }
  const paras = [...root.childNodes].filter((n) => n.localName === 'p');
  const sample = paras.find((p) => p.getElementsByTagName('hp:t').length && !p.getElementsByTagName('hp:tbl').length && !p.getElementsByTagName('hp:secPr').length) || paras.at(-1);
  // The seed is authored by ModyCrew. Its section/page/font definitions stay intact.
  const first = paras[0];
  for (const p of paras.slice(1)) root.removeChild(p);
  for (const t of [...first.getElementsByTagName('hp:t')]) t.textContent = '';
  let id = 1000;
  const paragraph = (text, styleId = 0) => {
    const p = sample.cloneNode(true); p.setAttribute('id', String(id++));
    for (const n of [...p.getElementsByTagName('hp:linesegarray')]) n.parentNode.removeChild(n);
    const runs = [...p.childNodes].filter((n) => n.localName === 'run');
    const run = runs[0];
    run.setAttribute('charPrIDRef', String(styleId));
    for (const r of runs.slice(1)) p.removeChild(r);
    while (run.firstChild) run.removeChild(run.firstChild);
    const t = dom.createElementNS('http://www.hancom.co.kr/hwpml/2011/paragraph', 'hp:t'); t.appendChild(dom.createTextNode(text || ' ')); run.appendChild(t); return p;
  };
  const append = (text, styleId = 0) => root.appendChild(paragraph(text, styleId));
  append(spec.title, nextStyle); if (meta(spec)) append(meta(spec));
  for (const section of allSections(spec)) {
    append(section.heading, nextStyle + 1);
    section.paragraphs.forEach((p) => p.split('\n').forEach((text) => append(text)));
    if (section.table) {
      const rows = [section.table.columns, ...section.table.rows]; const columns = section.table.columns.length;
      const table = tableSample.cloneNode(true); table.setAttribute('id', String(id++)); table.setAttribute('rowCnt', String(rows.length)); table.setAttribute('colCnt', String(columns));
      for (const row of [...table.getElementsByTagName('hp:tr')]) table.removeChild(row);
      const width = 48190; const cellWidth = Math.floor(width / columns); let tableHeight = 0;
      rows.forEach((values, r) => {
        const row = dom.createElementNS(table.namespaceURI, 'hp:tr');
        const lines = Math.max(...values.map((value) => wrapText(value, Math.max(2, (cellWidth - 1020) / 1050)).length));
        const rowHeight = Math.max(2100, lines * 1600 + 282); tableHeight += rowHeight;
        values.forEach((value, c) => {
          const cell = cellSample.cloneNode(true); cell.setAttribute('header', r === 0 ? '1' : '0');
          const list = cell.getElementsByTagName('hp:subList')[0]; while (list.firstChild) list.removeChild(list.firstChild);
          value.split('\n').forEach((text) => list.appendChild(paragraph(text)));
          const address = cell.getElementsByTagName('hp:cellAddr')[0]; address.setAttribute('colAddr', String(c)); address.setAttribute('rowAddr', String(r));
          const size = cell.getElementsByTagName('hp:cellSz')[0]; size.setAttribute('width', String(cellWidth + (c === columns - 1 ? width % columns : 0))); size.setAttribute('height', String(rowHeight));
          row.appendChild(cell);
        }); table.appendChild(row);
      });
      const size = table.getElementsByTagName('hp:sz')[0]; size.setAttribute('width', String(width)); size.setAttribute('height', String(tableHeight));
      const p = paragraph(''); const run = p.getElementsByTagName('hp:run')[0]; run.insertBefore(table, run.firstChild); root.appendChild(p);
    }
    append('');
  }
  zip.file('Contents/section0.xml', new XMLSerializer().serializeToString(dom));
  zip.file('Contents/header.xml', new XMLSerializer().serializeToString(head));
  const metadata = new DOMParser().parseFromString(await zip.file('Contents/content.hpf').async('string'), 'application/xml');
  metadata.getElementsByTagName('opf:title')[0].textContent = spec.title;
  for (const item of [...metadata.getElementsByTagName('opf:meta')]) {
    const name = item.getAttribute('name');
    if (name === 'creator') item.textContent = spec.author || 'ModyCrew';
    else if (name === 'lastsaveby') item.textContent = 'ModyCrew';
    else if (['CreatedDate', 'ModifiedDate', 'date'].includes(name)) item.textContent = new Date().toISOString();
  }
  zip.file('Contents/content.hpf', new XMLSerializer().serializeToString(metadata));
  zip.file('Preview/PrvText.txt', [spec.title, meta(spec), ...allSections(spec).flatMap((s) => [s.heading, ...s.paragraphs, ...(s.table ? [s.table.columns.join('\t'), ...s.table.rows.map((r) => r.join('\t'))] : [])])].join('\r\n'));
  // Remove the seed's stale thumbnail; text preview reflects this document.
  zip.remove('Preview/PrvImage.png');
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
