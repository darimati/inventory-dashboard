'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function SetupClient() {
  const router = useRouter();
  const [setupKey, setSetupKey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }
    if (password.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupKey, password, email }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }

      setSuccess(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch {
      setError('설정 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  const cardStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 400,
    background: '#fff',
    borderRadius: 12,
    border: '1px solid #e5e5e5',
    padding: '40px 32px',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const btnStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 0',
    borderRadius: 8,
    border: 'none',
    background: '#1a1a1a',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    opacity: loading ? 0.6 : 1,
  };

  if (success) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', padding: 20 }}>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <Image src="/heeda-logo.png" alt="HEEDA" width={120} height={34} style={{ objectFit: 'contain' }} priority />
          <p style={{ fontSize: 14, color: '#333', marginTop: 24 }}>초기 설정이 완료되었습니다.</p>
          <p style={{ fontSize: 13, color: '#666', marginTop: 8 }}>로그인 페이지로 이동합니다...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', padding: 20 }}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Image src="/heeda-logo.png" alt="HEEDA" width={120} height={34} style={{ objectFit: 'contain' }} priority />
          <p style={{ fontSize: 14, color: '#666', marginTop: 12 }}>초기 설정</p>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ fontSize: 13, color: '#666', display: 'block', marginBottom: 6 }}>설정 키</label>
          <input
            type="password"
            value={setupKey}
            onChange={(e) => setSetupKey(e.target.value)}
            placeholder="SETUP_KEY 입력"
            style={{ ...inputStyle, marginBottom: 12 }}
            autoFocus
            required
          />

          <label style={{ fontSize: 13, color: '#666', display: 'block', marginBottom: 6 }}>관리자 이메일</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일 주소"
            style={{ ...inputStyle, marginBottom: 12 }}
            required
          />

          <label style={{ fontSize: 13, color: '#666', display: 'block', marginBottom: 6 }}>비밀번호</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8자 이상"
            style={{ ...inputStyle, marginBottom: 12 }}
            required
          />

          <label style={{ fontSize: 13, color: '#666', display: 'block', marginBottom: 6 }}>비밀번호 확인</label>
          <input
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            placeholder="다시 입력"
            style={{ ...inputStyle, marginBottom: 16 }}
            required
          />

          {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}

          <button type="submit" disabled={loading} style={btnStyle}>
            {loading ? '설정 중...' : '설정 완료'}
          </button>
        </form>
      </div>
    </div>
  );
}
