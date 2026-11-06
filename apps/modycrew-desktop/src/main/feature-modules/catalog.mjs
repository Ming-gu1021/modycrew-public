// Reviewed, pinned artifacts only. A renderer cannot supply a download URL or executable.
export const featureModuleCatalog = Object.freeze({
  pdf_viewer: Object.freeze({
    id: 'pdf_viewer',
    name: 'PDF 뷰어',
    version: '6.4.299',
    upstream: 'https://github.com/mozilla/pdf.js',
    license: 'Apache-2.0',
    platforms: Object.freeze(['win32', 'darwin', 'linux']),
    catalogUrl: 'https://mody.ai.kr/resources/modycrew/modules/catalog.json',
    url: 'https://mody.ai.kr/resources/modycrew/modules/pdfjs-6.4.299-dist.zip',
    upstreamDownload: 'https://github.com/mozilla/pdf.js/releases/download/v6.4.299/pdfjs-6.4.299-dist.zip',
    minimumAppVersion: '0.2.99',
    sha256: 'f2245eb7ef3f674c872fe568a177bfec15874f5c034613e55d8e307f93ebd86d',
    bytes: 6331451,
    bundledSha256: '19139adbde3bc592029c43d74440018dde9e950bcfbab7708f4c91a8b361f888',
    bundledBytes: 6269687,
    requiredFiles: Object.freeze(['LICENSE', 'build/pdf.mjs', 'build/pdf.worker.mjs', 'web/viewer.html', 'web/viewer.mjs', 'web/viewer.css']),
    permissions: Object.freeze(['user_selected_pdf', 'local_viewer_window']),
    website: 'https://mody.ai.kr/modycrew#ai-library',
  }),
});

export function resolveFeatureModule(id) {
  if (!Object.hasOwn(featureModuleCatalog, id)) throw new Error('지원하는 기능을 선택해 주세요.');
  return featureModuleCatalog[id];
}
