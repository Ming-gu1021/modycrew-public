import path from 'node:path';
import { writeFile } from 'node:fs/promises';

export function createWorkMetricsExport({ BrowserWindow, dialog, app, trustedOrigin, write = writeFile }) {
  const pending = new Set();
  return async (event, payload = {}) => {
    const sender = event?.sender;
    let trusted = false;
    try { trusted = Boolean(sender && event.senderFrame === sender.mainFrame && trustedOrigin(new URL(sender.getURL()))); } catch { /* Reject unknown origins. */ }
    if (!trusted) throw new Error('앱의 업무 화면에서만 저장할 수 있습니다.');
    const win = BrowserWindow.fromWebContents(sender);
    if (!win) throw new Error('앱 창을 찾을 수 없습니다.');
    if (typeof payload.csv !== 'string' || !payload.csv.startsWith('\uFEFF"범위","등록일","업무","현재 상태","담당"') || Buffer.byteLength(payload.csv, 'utf8') > 10 * 1024 * 1024) throw new Error('저장할 업무 현황을 다시 불러와 주세요.');
    if (!/^ModyCrew_업무현황_(personal|company)_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/.test(payload.fileName || '')) throw new Error('올바르지 않은 보고서 이름입니다.');
    if (pending.has(sender)) return { status: 'busy' };
    pending.add(sender);
    try {
      const result = await dialog.showSaveDialog(win, { title: '업무 현황 CSV 저장', defaultPath: path.join(app.getPath('documents'), payload.fileName), filters: [{ name: 'CSV 보고서', extensions: ['csv'] }], properties: ['showOverwriteConfirmation', 'createDirectory'] });
      if (result.canceled || !result.filePath) return { status: 'canceled' };
      if (path.extname(result.filePath).toLowerCase() !== '.csv') throw new Error('파일 확장자를 .csv로 지정해 주세요.');
      await write(result.filePath, payload.csv, 'utf8');
      return { status: 'saved', fileName: path.basename(result.filePath) };
    } finally { pending.delete(sender); }
  };
}
