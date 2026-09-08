import { Resend } from 'resend';

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY || '');
  }
  return _resend;
}

export async function sendVerificationCode(
  to: string,
  code: string,
  purpose: 'password_change' | 'password_reset',
): Promise<{ success: boolean; error?: string }> {
  const subject =
    purpose === 'password_change'
      ? '[HEEDA] 비밀번호 변경 인증 코드'
      : '[HEEDA] 비밀번호 재설정 인증 코드';

  const purposeLabel =
    purpose === 'password_change' ? '비밀번호 변경을 위한' : '비밀번호 재설정을 위한';

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
      <h2 style="font-size:18px;color:#1a1a1a;margin-bottom:8px">HEEDA</h2>
      <p style="font-size:14px;color:#666;margin-bottom:24px">${purposeLabel} 인증 코드입니다.</p>
      <div style="background:#f5f5f5;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px">
        <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1a1a1a">${code}</span>
      </div>
      <p style="font-size:13px;color:#999">이 코드는 10분간 유효합니다. 본인이 요청하지 않았다면 이 이메일을 무시하세요.</p>
    </div>
  `;

  try {
    const { error } = await getResend().emails.send({
      from: 'HEEDA <onboarding@resend.dev>',
      to,
      subject,
      html,
    });

    if (error) {
      console.error('Email send error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('Email send error:', err);
    return { success: false, error: 'Failed to send email' };
  }
}
