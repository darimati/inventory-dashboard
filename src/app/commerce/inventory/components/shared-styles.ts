import React from 'react';

export const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
export const modalStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 12, padding: 24, width: 520,
  maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
};
export const poLabelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, color: '#6E767E', marginBottom: 4 };
export const poInputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: 13,
  border: '1px solid #E4E8EC', borderRadius: 8, background: '#fff', outline: 'none', boxSizing: 'border-box',
};
export const poCancelBtnStyle: React.CSSProperties = { padding: '8px 14px', fontSize: 13, background: '#F2F4F7', color: '#565D64', border: 'none', borderRadius: 8, cursor: 'pointer' };
export const poSaveBtnStyle: React.CSSProperties = { padding: '8px 14px', fontSize: 13, fontWeight: 500, background: '#1A1D21', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };
export const poActionBtnStyle: React.CSSProperties = { padding: '4px 10px', fontSize: 12, background: 'none', color: '#565D64', border: '1px solid #E4E8EC', borderRadius: 8, cursor: 'pointer' };
