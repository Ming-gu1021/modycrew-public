'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
export default function BrowserPage() {
  const router=useRouter();
  useEffect(()=>{const params=new URLSearchParams(window.location.search);params.set('openWorkspace','browser');router.replace(`/?${params.toString()}` as Route);},[router]);
  return <p role="status">작업 옆에 브라우저를 여는 중…</p>;
}
