'use client';

import { useState } from 'react';
import { formatNumber } from '@/lib/helpers';
import { REJECT_REASON_LABELS } from '../constants';
import type { InboundRequest } from '../types';
import { modalOverlayStyle, modalStyle, poLabelStyle, poInputStyle, poCancelBtnStyle, poSaveBtnStyle } from './shared-styles';

export function RejectModal({ request, onClose, onConfirm }: {
  request: InboundRequest;
  onClose: () => void;
  onConfirm: (reason: string, memo: string, reship: boolean) => void;
}) {
  const [reason, setReason] = useState<string>('');
  const [memo, setMemo] = useState('');
  const [reship, setReship] = useState(true);

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 600, fontSize: 15, color: '#1F2328', marginBottom: 4 }}>반송 처리</div>
        <div style={{ fontSize: 12, color: '#9AA2AA', marginBottom: 16 }}>
          {request.product} · {formatNumber(request.quantity)}개
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={poLabelStyle}>반송 사유 *</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {Object.entries(REJECT_REASON_LABELS).map(([key, label]) => (
              <button key={key} onClick={() => setReason(key)} style={{
                padding: '8px 12px', fontSize: 13, fontWeight: 500, borderRadius: 6, cursor: 'pointer',
                border: reason === key ? '2px solid #1F2328' : '1px solid var(--border-light)',
                background: reason === key ? '#F2F4F7' : '#fff', color: '#1F2328',
                textAlign: 'left',
              }}>{label}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={poLabelStyle}>메모</label>
          <textarea value={memo} onChange={e => setMemo(e.target.value)}
            placeholder="반송 관련 상세 사유"
            style={{ ...poInputStyle, minHeight: 60, resize: 'vertical' }} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#1F2328', cursor: 'pointer' }}>
            <input type="checkbox" checked={reship} onChange={e => setReship(e.target.checked)} style={{ margin: 0 }} />
            재출고 예정
            <span style={{ fontSize: 11, color: '#9AA2AA', fontWeight: 400 }}>동일 수량으로 새 입고 요청 자동 생성</span>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={poCancelBtnStyle}>취소</button>
          <button onClick={() => { if (!reason) return; onConfirm(reason, memo, reship); }}
            disabled={!reason}
            style={{ ...poSaveBtnStyle, background: reason ? '#B03F3B' : '#C4CAD1', opacity: reason ? 1 : 0.6 }}>
            반송 확인
          </button>
        </div>
      </div>
    </div>
  );
}
