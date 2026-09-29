'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { useState, useRef, useEffect, useCallback } from 'react';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

type Workspace = 'commerce' | 'influencer';

const COMMERCE_NAV = [
  { href: '/commerce', label: '홈' },
  { href: '/commerce/sales', label: '매출' },
  { href: '/commerce/inventory', label: '재고 / 입고' },
  { href: '/commerce/settlements', label: '정산' },
  { href: '/commerce/settings', label: '설정' },
];

const INFLUENCER_NAV = [
  { href: '/influencer', label: '대시보드' },
  { href: '/influencer/manage', label: '캠페인 관리' },
  { href: '/influencer/calendar', label: '캘린더' },
  { href: '/influencer/consents', label: '동의서' },
  { href: '/influencer/settlements', label: '정산 관리' },
  { href: '/influencer/settings', label: '설정' },
];

const PERSIST_PARAMS = ['period', 'from', 'to', 'product', 'channel'];

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    router.push('/login');
  }, [router]);

  const currentWs: Workspace = pathname.startsWith('/influencer') ? 'influencer' : 'commerce';
  const navItems = currentWs === 'influencer' ? INFLUENCER_NAV : COMMERCE_NAV;

  const isActive = (href: string) => {
    if (href === '/commerce' || href === '/influencer') return pathname === href;
    return pathname.startsWith(href);
  };

  const buildHref = (base: string) => {
    // Only persist query params within commerce workspace
    if (!base.startsWith('/commerce')) return base;
    const kept = new URLSearchParams();
    for (const key of PERSIST_PARAMS) {
      const val = searchParams.get(key);
      if (val) kept.set(key, val);
    }
    const qs = kept.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const switchWorkspace = (ws: Workspace) => {
    document.cookie = `heeda-ws=${ws}; path=/; max-age=31536000; SameSite=Lax`;
    setDropdownOpen(false);
    onClose();
    router.push(ws === 'influencer' ? '/influencer' : '/commerce');
  };

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [dropdownOpen]);

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-brand" ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: 0,
          }}
        >
          <Image src="/heeda-logo.png" alt="HEEDA" width={100} height={28} style={{ objectFit: 'contain' }} priority />
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.4, flexShrink: 0 }}>
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {dropdownOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              width: 216,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              zIndex: 100,
              padding: '4px 0',
            }}
          >
            <button
              onClick={() => switchWorkspace('commerce')}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                color: 'var(--text-primary)',
                textAlign: 'left',
              }}
            >
              <span style={{ width: 16, textAlign: 'center', fontSize: 13 }}>
                {currentWs === 'commerce' ? '✓' : ''}
              </span>
              커머스 대시보드
            </button>
            <button
              onClick={() => switchWorkspace('influencer')}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                color: 'var(--text-primary)',
                textAlign: 'left',
              }}
            >
              <span style={{ width: 16, textAlign: 'center', fontSize: 13 }}>
                {currentWs === 'influencer' ? '✓' : ''}
              </span>
              인플루언서 운영
            </button>
          </div>
        )}
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={buildHref(item.href)}
            onClick={onClose}
            className={isActive(item.href) ? 'active' : ''}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div style={{ marginTop: 'auto', padding: '12px 0', borderTop: '1px solid var(--border)' }}>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          style={{
            width: '100%',
            padding: '8px 16px',
            background: 'none',
            border: 'none',
            cursor: loggingOut ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            color: 'var(--text-secondary)',
            opacity: loggingOut ? 0.5 : 1,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 14H3.333A1.333 1.333 0 0 1 2 12.667V3.333A1.333 1.333 0 0 1 3.333 2H6M10.667 11.333 14 8l-3.333-3.333M14 8H6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {loggingOut ? '로그아웃 중...' : '로그아웃'}
        </button>
      </div>
    </aside>
  );
}
