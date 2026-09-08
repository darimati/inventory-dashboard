'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';

type Step = 'login' | 'forgot' | 'forgot-code' | 'reset-success';

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') || '/';

  const [step, setStep] = useState<Step>('login');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Forgot password state
  const [email, setEmail] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          const mins = Math.ceil((data.retryAfter ?? 300) / 60);
          setError(`로그인 시도가 너무 많습니다. ${mins}분 후 다시 시도해주세요.`);
        } else {
          setError(data.error ?? '로그인에 실패했습니다.');
        }
        return;
      }

      router.push(from);
      router.refresh();
    } catch {
      setError('로그인 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSendResetCode(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'password_reset' }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }

      setMaskedEmail(data.email);
      setStep('forgot-code');
    } catch {
      setError('오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword !== newPasswordConfirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }
    if (newPassword.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: resetCode, newPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }

      setStep('reset-success');
    } catch {
      setError('오류가 발생했습니다.');
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

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', padding: 20 }}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Image src="/heeda-logo.png" alt="HEEDA" width={120} height={34} style={{ objectFit: 'contain' }} priority />
        </div>

        {step === 'login' && (
          <form onSubmit={handleLogin}>
            <label style={{ fontSize: 13, color: '#666', display: 'block', marginBottom: 6 }}>비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호를 입력하세요"
              style={{ ...inputStyle, marginBottom: 16 }}
              autoFocus
              required
            />
            {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}
            <button type="submit" disabled={loading} style={btnStyle}>
              {loading ? '로그인 중...' : '로그인'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button
                type="button"
                onClick={() => { setStep('forgot'); setError(''); }}
                style={{ background: 'none', border: 'none', color: '#4A7DB5', fontSize: 13, cursor: 'pointer' }}
              >
                비밀번호를 잊으셨나요?
              </button>
            </div>
          </form>
        )}

        {step === 'forgot' && (
          <form onSubmit={handleSendResetCode}>
            <p style={{ fontSize: 14, color: '#333', marginBottom: 16 }}>
              등록된 관리자 이메일로 인증 코드를 보내드립니다.
            </p>
            <label style={{ fontSize: 13, color: '#666', display: 'block', marginBottom: 6 }}>관리자 이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일을 입력하세요"
              style={{ ...inputStyle, marginBottom: 16 }}
              autoFocus
              required
            />
            {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}
            <button type="submit" disabled={loading} style={btnStyle}>
              {loading ? '발송 중...' : '인증 코드 받기'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button
                type="button"
                onClick={() => { setStep('login'); setError(''); }}
                style={{ background: 'none', border: 'none', color: '#4A7DB5', fontSize: 13, cursor: 'pointer' }}
              >
                로그인으로 돌아가기
              </button>
            </div>
          </form>
        )}

        {step === 'forgot-code' && (
          <form onSubmit={handleResetPassword}>
            <p style={{ fontSize: 14, color: '#333', marginBottom: 16 }}>
              <strong>{maskedEmail}</strong>으로 인증 코드가 발송되었습니다.
            </p>
            <label style={{ fontSize: 13, color: '#666', display: 'block', marginBottom: 6 }}>인증 코드</label>
            <input
              type="text"
              value={resetCode}
              onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6자리 코드"
              style={{ ...inputStyle, marginBottom: 12, letterSpacing: 4, textAlign: 'center', fontSize: 18 }}
              autoFocus
              maxLength={6}
              required
            />
            <label style={{ fontSize: 13, color: '#666', display: 'block', marginBottom: 6 }}>새 비밀번호</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="8자 이상"
              style={{ ...inputStyle, marginBottom: 12 }}
              required
            />
            <label style={{ fontSize: 13, color: '#666', display: 'block', marginBottom: 6 }}>새 비밀번호 확인</label>
            <input
              type="password"
              value={newPasswordConfirm}
              onChange={(e) => setNewPasswordConfirm(e.target.value)}
              placeholder="다시 입력"
              style={{ ...inputStyle, marginBottom: 16 }}
              required
            />
            {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}
            <button type="submit" disabled={loading} style={btnStyle}>
              {loading ? '변경 중...' : '비밀번호 재설정'}
            </button>
          </form>
        )}

        {step === 'reset-success' && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: '#333', marginBottom: 16 }}>비밀번호가 변경되었습니다.</p>
            <button
              onClick={() => { setStep('login'); setPassword(''); setError(''); }}
              style={btnStyle}
            >
              로그인하기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
