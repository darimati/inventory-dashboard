'use client';

import { useState } from 'react';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
  };
  return (
    <button onClick={handleCopy} title="복사" style={{
      background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
      fontSize: 11, color: copied ? '#1A7F37' : '#9AA2AA', lineHeight: 1,
    }}>
      {copied ? '✓' : '⧉'}
    </button>
  );
}
