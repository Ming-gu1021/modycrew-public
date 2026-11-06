import DownloadablePdfViewer from '@/components/DownloadablePdfViewer';

export default function PdfPage() {
  return <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px' }}><h1 style={{ fontSize: 26 }}>PDF 문서 보기</h1><DownloadablePdfViewer /><a href="/documents/">문서 만들기로 돌아가기</a></main>;
}
