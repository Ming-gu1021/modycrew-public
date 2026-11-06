import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import { cleanText, specFields } from './spec.mjs';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const HWP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
const SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

export async function loadSafeZip(buffer, { allowEmbeddedWorkbooks = false } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length > 32 * 1024 * 1024) throw new Error('파일은 32MB 이하로 선택해 주세요.');
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('손상됐거나 암호화된 문서입니다. Office에서 다시 저장한 파일을 선택해 주세요.');
  const entries = buffer.readUInt16LE(end + 10); let offset = buffer.readUInt32LE(end + 16); let total = 0;
  if (entries > 20000 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw new Error('문서 내부 구성의 허용 범위를 초과했습니다.');
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('문서 ZIP 목록이 올바르지 않습니다.');
    const flags = buffer.readUInt16LE(offset + 8); const size = buffer.readUInt32LE(offset + 24); const nameLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'); total += size;
    if ((flags & 1) || size > 32 * 1024 * 1024 || total > 128 * 1024 * 1024 || name.includes('\\') || name.startsWith('/') || name.split('/').some((p) => p === '..') || /^[A-Za-z]:/u.test(name)) throw new Error('암호화되었거나 안전하게 읽을 수 없는 문서입니다.');
    const ignoredChartWorkbook = allowEmbeddedWorkbooks && /^ppt\/embeddings\/[^/]+\.xlsx$/iu.test(name);
    if (!ignoredChartWorkbook && !name.endsWith('/') && /vbaProject|ActiveX|embeddings\/|scripts\//iu.test(name)) throw new Error('매크로·실행 개체가 포함된 양식은 지원하지 않습니다. 일반 문서 형식으로 저장해 주세요.');
    offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  for (const file of Object.values(zip.files)) {
    if (!/\.(?:xml|rels)$/iu.test(file.name)) continue;
    const xml = await file.async('string');
    if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) throw new Error('외부 엔터티가 포함된 XML 문서는 지원하지 않습니다.');
    if (/\.rels$/iu.test(file.name) && /TargetMode\s*=\s*["']External/iu.test(xml)) {
      const dom = parseXml(xml);
      const linked = [...dom.getElementsByTagName('Relationship')].some((node) => node.getAttribute('TargetMode') === 'External' && !node.getAttribute('Type').endsWith('/hyperlink'));
      if (linked) throw new Error('외부 파일을 불러오는 양식은 먼저 연결을 해제해 주세요.');
    }
  }
  return zip;
}

export function parseXml(xml) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) throw new Error('XML 외부 엔터티는 허용하지 않습니다.');
  return new DOMParser({ onError: (level, message) => { if (level !== 'warning') throw new Error(`문서 XML 오류: ${message}`); } }).parseFromString(xml, 'application/xml');
}

function parts(zip, format) {
  const pattern = { docx: /^word\/(?:document|header\d+|footer\d+)\.xml$/u, pptx: /^ppt\/slides\/slide\d+\.xml$/u, hwpx: /^Contents\/section\d+\.xml$/u, xlsx: /^xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml$/u }[format];
  if (!pattern) throw new Error('양식은 DOCX·PPTX·XLSX·HWPX를 지원합니다. HWP는 한글이 설치된 PC에서 가져올 수 있습니다.');
  const names = Object.keys(zip.files).filter((name) => pattern.test(name)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (!names.length) throw new Error('확장자와 문서 내부 형식이 일치하지 않습니다.');
  return names;
}

function units(dom, format) {
  const ns = { docx: WORD, pptx: DRAWING, hwpx: HWP, xlsx: SHEET }[format];
  const nodes = format === 'xlsx' ? [...dom.getElementsByTagNameNS(ns, 'si'), ...dom.getElementsByTagNameNS(ns, 'is')] : [...dom.getElementsByTagNameNS(ns, 'p')];
  return nodes.map((node) => {
    const texts = [...node.getElementsByTagNameNS(ns, 't')].filter((text) => {
      for (let parent = text.parentNode; parent && parent !== node; parent = parent.parentNode) if (parent.localName === 'p' && parent.namespaceURI === ns) return false;
      return true;
    });
    return { node, texts, text: texts.map((t) => t.textContent).join(''), ns };
  });
}

export async function inspectTemplate(buffer, format) {
  const zip = await loadSafeZip(buffer); const slots = []; const fields = new Set();
  for (const name of parts(zip, format)) {
    const dom = parseXml(await zip.file(name).async('string'));
    units(dom, format).forEach((unit, index) => {
      if (!unit.text.trim()) return;
      for (const match of unit.text.matchAll(/\{\{\s*([^{}]{1,100}?)\s*\}\}/gu)) fields.add(match[1].trim());
      slots.push({ id: `${name}#${index}`, text: unit.text.slice(0, 400), characters: unit.text.length });
    });
  }
  if (slots.length > 2500 || fields.size > 150) throw new Error('양식이 너무 큽니다. 필요한 부분을 별도 양식으로 저장해 주세요.');
  return { format, hash: sha256(buffer), fields: [...fields], slots };
}

function replaceRange(unit, start, end, replacement) {
  let offset = 0; let inserted = false;
  for (const node of unit.texts) {
    const text = node.textContent; const next = offset + text.length;
    if (next > start && offset < end) {
      const before = text.slice(0, Math.max(0, start - offset)); const after = text.slice(Math.max(0, end - offset));
      node.textContent = before + (inserted ? '' : replacement) + after; node.setAttribute('xml:space', 'preserve'); inserted = true;
    }
    offset = next;
  }
}

function materializeBreaks(unit, format) {
  if (format === 'xlsx') return;
  for (const node of unit.texts) {
    if (!node.textContent.includes('\n')) continue;
    const lines = node.textContent.split('\n'); node.textContent = lines[0];
    if (format === 'hwpx') {
      for (const line of lines.slice(1)) { node.appendChild(node.ownerDocument.createElementNS(HWP, 'hp:lineBreak')); node.appendChild(node.ownerDocument.createTextNode(line)); }
      continue;
    }
    let previous = format === 'pptx' ? node.parentNode : node;
    for (const line of lines.slice(1)) {
      const br = node.ownerDocument.createElementNS(unit.ns, format === 'pptx' ? 'a:br' : 'w:br'); previous.parentNode.insertBefore(br, previous.nextSibling);
      const fresh = (format === 'pptx' ? node.parentNode : node).cloneNode(true);
      if (format === 'pptx') fresh.getElementsByTagNameNS(DRAWING, 't')[0].textContent = line; else fresh.textContent = line;
      br.parentNode.insertBefore(fresh, br.nextSibling); previous = fresh;
    }
  }
}

export async function fillTemplate(buffer, format, spec, mapping = {}, fieldOverrides = {}) {
  const zip = await loadSafeZip(buffer); const fields = { ...specFields(spec), ...fieldOverrides };
  const unresolved = new Set(); let changed = 0; const usedMappings = new Set();
  for (const name of parts(zip, format)) {
    const dom = parseXml(await zip.file(name).async('string')); let partChanged = false;
    units(dom, format).forEach((unit, index) => {
      const id = `${name}#${index}`; const field = mapping[id];
      if (field) {
        if (!Object.hasOwn(fields, field) || !unit.texts.length) throw new Error('양식의 채울 칸을 다시 확인해 주세요.');
        const replacement = cleanText(fields[field], 160000);
        if (!replacement) throw new Error(`양식의 '${field}' 내용을 입력해 주세요.`);
        unit.texts[0].textContent = replacement; unit.texts[0].setAttribute('xml:space', 'preserve'); unit.texts.slice(1).forEach((t) => { t.textContent = ''; }); usedMappings.add(id); partChanged = true; changed++;
      } else {
        const matches = [...unit.text.matchAll(/\{\{\s*([^{}]{1,100}?)\s*\}\}/gu)].reverse();
        for (const match of matches) {
          const key = match[1].trim(); const value = Object.hasOwn(fields, key) ? cleanText(fields[key], 160000) : '';
          if (!value) { unresolved.add(key); continue; }
          replaceRange(unit, match.index, match.index + match[0].length, value); partChanged = true; changed++;
        }
      }
      materializeBreaks(unit, format);
    });
    if (partChanged) zip.file(name, new XMLSerializer().serializeToString(dom));
  }
  if (Object.keys(mapping).some((key) => !usedMappings.has(key))) throw new Error('양식이 바뀌었습니다. 채울 칸을 다시 지정해 주세요.');
  if (unresolved.size) throw new Error(`양식의 다음 항목을 채워 주세요: ${[...unresolved].join(', ')}`);
  if (!changed) throw new Error('채울 칸을 지정하거나 양식에 {{제목}}, {{body}} 같은 표시를 넣어 주세요.');
  if (format === 'hwpx') { zip.file('Preview/PrvText.txt', `${spec.title}\r\n${specFields(spec).body}`); zip.remove('Preview/PrvImage.png'); }
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), changed, originalHash: sha256(buffer) };
}

export async function extractOfficeText(buffer, format, options) {
  const zip = await loadSafeZip(buffer, options); const texts = [];
  for (const name of parts(zip, format)) units(parseXml(await zip.file(name).async('string')), format).forEach((unit) => { if (unit.text) texts.push(unit.text); });
  const text = texts.join('\n');
  if (text.length > 100000) throw new Error('자료가 너무 큽니다. 필요한 부분을 나눠 가져와 주세요.');
  return text;
}
