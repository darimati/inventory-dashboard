'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { formatNumber } from '@/lib/helpers';
import {
  INBOUND_STEP_LABELS, INBOUND_STEP_FIELDS, INBOUND_STEP_API_MAP,
  WAREHOUSES, CANCEL_REASONS, INBOUND_PRODUCT_OPTIONS, INBOUND_STATUS_BADGE,
  REJECT_REASON_LABELS, PRODUCTS, ORDER_TYPE_LABELS, DEST_LABELS, STATUS_LABELS,
} from '../constants';
import type { InboundRequest, PurchaseOrder } from '../types';
import { RejectModal } from './RejectModal';
import { InboundDropdown } from './InboundDropdown';
import { InboundDatePicker } from './InboundDatePicker';
import {
  modalOverlayStyle, modalStyle, poLabelStyle, poInputStyle,
  poCancelBtnStyle, poSaveBtnStyle, poActionBtnStyle,
} from './shared-styles';

/* ------------------------------------------------------------------ */
/*  ActiveItemsSection — inbound + factory orders unified              */
/* ------------------------------------------------------------------ */

// KST today
function kstToday(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDDay(dl: string | null): { text: string; color: string; urgent: boolean; overdue: boolean; diff: number } | null {
  if (!dl) return null;
  const now = new Date();
  const kstMs = now.getTime() + (now.getTimezoneOffset() + 540) * 60000;
  const todayKst = new Date(kstMs); todayKst.setHours(0, 0, 0, 0);
  const dlDate = new Date(dl + 'T00:00:00'); dlDate.setHours(0, 0, 0, 0);
  const diff = Math.round((dlDate.getTime() - todayKst.getTime()) / 86_400_000);
  if (diff >= 3) return { text: `D-${diff}`, color: '#565D64', urgent: false, overdue: false, diff };
  if (diff >= 1) return { text: `D-${diff}`, color: '#A8712A', urgent: true, overdue: false, diff };
  if (diff === 0) return { text: '오늘 마감', color: '#B03F3B', urgent: true, overdue: false, diff };
  return { text: `${Math.abs(diff)}일 초과`, color: '#B03F3B', urgent: true, overdue: true, diff };
}

function deriveStatus(req: InboundRequest): keyof typeof INBOUND_STATUS_BADGE {
  if (req.status === 'cancelled') return 'cancelled';
  if (req.arrived_at) return 'done';
  if (req.tracking_entered_at) return 'waiting';
  if (req.ea_ordered_at) return 'tracking_needed';
  return 'order_needed';
}

function isStepChecked(req: InboundRequest, step: number): boolean {
  return !!req[INBOUND_STEP_FIELDS[step]];
}
function getCheckedDate(req: InboundRequest, step: number): string | null {
  const val = req[INBOUND_STEP_FIELDS[step]];
  if (!val || typeof val !== 'string') return null;
  return new Date(val).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' });
}
function isAllChecked(req: InboundRequest): boolean {
  return INBOUND_STEP_FIELDS.every(f => !!req[f]);
}

function getProductInfo(vid: string) {
  return INBOUND_PRODUCT_OPTIONS.find(o => o.value === vid);
}

function reqProductLabel(r: InboundRequest) {
  const vid = r.vendor_item_id;
  const prodOpt = vid ? INBOUND_PRODUCT_OPTIONS.find(o => o.value === vid) : null;
  if (prodOpt) return prodOpt.label;
  return `${r.product}${r.option ? ' ' + r.option : ''}`;
}

export function ActiveItemsSection({
  inboundRequests, orders, onRefreshInbound, onRefreshOrders,
  leadTimes, pendingCreate, onPendingCreateConsumed, showToast,
}: {
  inboundRequests: InboundRequest[];
  orders: PurchaseOrder[];
  onRefreshInbound: () => void;
  onRefreshOrders: (orders: PurchaseOrder[]) => void;
  leadTimes: { production: number; transfer: number };
  pendingCreate?: { product: string; quantity: number } | null;
  onPendingCreateConsumed?: () => void;
  showToast: (msg: string) => void;
}) {
  const todayStr = kstToday();
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // -- Inbound state --
  const [showInboundModal, setShowInboundModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<InboundRequest | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [editTarget, setEditTarget] = useState<InboundRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<InboundRequest | null>(null);
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});

  // Inbound create form
  const [cfInboundId, setCfInboundId] = useState('');
  const [cfVendorItemId, setCfVendorItemId] = useState('');
  const [cfQty, setCfQty] = useState('');
  const [cfWarehouse, setCfWarehouse] = useState('');
  const [cfDeadline, setCfDeadline] = useState('');
  const [cfMemo, setCfMemo] = useState('');
  const [cfError, setCfError] = useState('');
  const [cfPreExpanded, setCfPreExpanded] = useState(false);
  const [cfPreChecked, setCfPreChecked] = useState<number[]>([]);

  // Inbound edit form
  const [efInboundId, setEfInboundId] = useState('');
  const [efVendorItemId, setEfVendorItemId] = useState('');
  const [efQty, setEfQty] = useState('');
  const [efWarehouse, setEfWarehouse] = useState('');
  const [efDeadline, setEfDeadline] = useState('');
  const [efMemo, setEfMemo] = useState('');

  // -- Purchase order state --
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [createType, setCreateType] = useState<'production' | 'transfer'>('production');
  const [createDest, setCreateDest] = useState<'easyadmin' | 'rocketgrowth'>('easyadmin');
  const [createOrderedAt, setCreateOrderedAt] = useState('');
  const [createExpectedAt, setCreateExpectedAt] = useState('');
  const [createMemo, setCreateMemo] = useState('');
  const [createItems, setCreateItems] = useState<{ product: string; quantity: string }[]>([{ product: '클렌징밤', quantity: '' }]);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState('');

  // Arrive modal
  const [arriveOrder, setArriveOrder] = useState<PurchaseOrder | null>(null);
  const [arriveItems, setArriveItems] = useState<{ id: string; product: string; quantity: number; arrived_quantity: number; input: string }[]>([]);
  const [arriveSaving, setArriveSaving] = useState(false);
  const [arriveError, setArriveError] = useState('');

  // Menu close on outside click
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuId]);

  // Handle pending create
  useEffect(() => {
    if (pendingCreate) {
      const matchOpt = INBOUND_PRODUCT_OPTIONS.find(o => o.product === pendingCreate.product);
      setCfInboundId(''); setCfVendorItemId(matchOpt?.value || '');
      setCfQty(String(pendingCreate.quantity));
      setCfWarehouse(''); setCfDeadline(''); setCfMemo(''); setCfError('');
      setCfPreExpanded(false); setCfPreChecked([]);
      setShowInboundModal(true);
      onPendingCreateConsumed?.();
    }
  }, [pendingCreate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Active / completed split ----
  const activeInbound = inboundRequests.filter(r =>
    !['rejected', 'cancelled'].includes(r.status) && !isAllChecked(r),
  );
  const completedInbound = inboundRequests.filter(r =>
    ['rejected', 'cancelled'].includes(r.status) || isAllChecked(r),
  );
  const activeOrders = orders.filter(o => o.status === 'ordered');
  const completedOrders = orders.filter(o => o.status !== 'ordered');

  // Sort active inbound by deadline urgency
  const sortedActiveInbound = [...activeInbound].sort((a, b) => {
    const da = getDDay(a.coupang_deadline);
    const db = getDDay(b.coupang_deadline);
    if (da?.overdue && !db?.overdue) return -1;
    if (!da?.overdue && db?.overdue) return 1;
    if (da && db) return da.diff - db.diff;
    if (da && !db) return -1;
    if (!da && db) return 1;
    return 0;
  });

  // ---- Inbound handlers ----
  const handleToggle = async (id: string, stepIdx: number) => {
    const req = inboundRequests.find(r => r.id === id);
    if (!req || ['rejected', 'cancelled'].includes(req.status)) return;
    setSaving(true);
    try {
      const res = await fetch('/api/inbound-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'toggle_step', step: INBOUND_STEP_API_MAP[stepIdx] }),
      });
      if (res.ok) onRefreshInbound();
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleSaveTracking = async (id: string) => {
    const val = trackingInputs[id];
    if (val === undefined) return;
    setSaving(true);
    try {
      const res = await fetch('/api/inbound-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'save_tracking', tracking_number: val }),
      });
      if (res.ok) { onRefreshInbound(); showToast('운송장번호 저장됨'); }
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleCreateInbound = async () => {
    if (!cfInboundId.trim()) { setCfError('쿠팡 입고ID를 입력하세요'); return; }
    if (!cfVendorItemId) { setCfError('상품을 선택하세요'); return; }
    if (!cfQty || Number(cfQty) <= 0) { setCfError('수량을 입력하세요'); return; }
    if (!cfWarehouse) { setCfError('물류센터를 선택하세요'); return; }
    if (!cfDeadline) { setCfError('도착예정일을 선택하세요'); return; }
    setSaving(true); setCfError('');
    const prodInfo = getProductInfo(cfVendorItemId);
    try {
      const res = await fetch('/api/inbound-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: prodInfo?.product || '알 수 없음',
          option: prodInfo ? prodInfo.option : null,
          quantity: Number(cfQty),
          warehouse: cfWarehouse || null,
          coupang_deadline: cfDeadline || null,
          coupang_inbound_id: cfInboundId.trim() || null,
          vendor_item_id: cfVendorItemId,
          memo: cfMemo || null,
          pre_checked_steps: cfPreChecked.map(i => INBOUND_STEP_API_MAP[i]),
          type: '3pl_to_rg',
          source: '3pl',
          destination: 'rocketgrowth',
          unit: 'set',
        }),
      });
      if (!res.ok) { const err = await res.json(); setCfError(err.error || '등록 실패'); return; }
      setShowInboundModal(false); onRefreshInbound(); showToast('입고 건 등록 완료');
    } catch { setCfError('네트워크 오류'); }
    finally { setSaving(false); }
  };

  const openEdit = (req: InboundRequest) => {
    setEditTarget(req); setMenuId(null);
    setEfInboundId(req.coupang_inbound_id || '');
    setEfVendorItemId(req.vendor_item_id || '');
    setEfQty(String(req.quantity));
    setEfWarehouse(req.warehouse || '');
    setEfDeadline(req.coupang_deadline || '');
    setEfMemo(req.memo || '');
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    const prodInfo = efVendorItemId ? getProductInfo(efVendorItemId) : null;
    setSaving(true);
    try {
      const res = await fetch('/api/inbound-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editTarget.id, action: 'update',
          fields: {
            product: prodInfo?.product || editTarget.product,
            option: prodInfo ? prodInfo.option : editTarget.option,
            quantity: Number(efQty),
            warehouse: efWarehouse || null,
            coupang_deadline: efDeadline || null,
            coupang_inbound_id: efInboundId.trim() || null,
            vendor_item_id: efVendorItemId || null,
            memo: efMemo || null,
          },
        }),
      });
      if (res.ok) { setEditTarget(null); onRefreshInbound(); showToast('수정 완료'); }
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleCancelInbound = async () => {
    if (!cancelTarget || !cancelReason) return;
    setSaving(true);
    try {
      const res = await fetch('/api/inbound-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cancelTarget.id, action: 'cancel', cancel_reason: cancelReason }),
      });
      if (res.ok) { setCancelTarget(null); setCancelReason(''); onRefreshInbound(); showToast('입고 건 취소됨'); }
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleDeleteInbound = async (id: string) => {
    setMenuId(null);
    if (!confirm('이 입고 건을 삭제하시겠습니까?')) return;
    try {
      await fetch('/api/inbound-requests', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      onRefreshInbound(); showToast('입고 건 삭제됨');
    } catch { /* */ }
  };

  const handleReject = async (reason: string, memo: string, reship: boolean) => {
    if (!rejectTarget) return;
    setSaving(true);
    try {
      const res = await fetch('/api/inbound-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rejectTarget.id, action: 'reject', reject_reason: reason, reject_memo: memo, reship }),
      });
      if (res.ok) {
        setRejectTarget(null); onRefreshInbound();
        showToast(reship ? '반송 처리 완료 · 재출고 건 생성됨' : '반송 처리 완료');
      }
    } catch { /* */ }
    finally { setSaving(false); }
  };

  // ---- Purchase order handlers ----
  const calcExpectedAt = (type: 'production' | 'transfer', orderedAt: string) => {
    if (!orderedAt) return '';
    const d = new Date(orderedAt);
    d.setDate(d.getDate() + (type === 'production' ? leadTimes.production : leadTimes.transfer));
    return d.toISOString().slice(0, 10);
  };

  const openOrderModal = () => {
    setCreateType('production'); setCreateDest('easyadmin');
    setCreateOrderedAt(todayStr); setCreateExpectedAt(calcExpectedAt('production', todayStr));
    setCreateMemo(''); setCreateItems([{ product: '클렌징밤', quantity: '' }]); setCreateError('');
    setShowOrderModal(true);
  };

  const handleCreateOrder = async () => {
    const validItems = createItems.filter(i => i.product && Number(i.quantity) > 0);
    if (!validItems.length) { setCreateError('품목을 1개 이상 입력하세요'); return; }
    setCreateSaving(true); setCreateError('');
    try {
      const res = await fetch('/api/purchase-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_type: createType, destination: createDest,
          ordered_at: createOrderedAt || todayStr, expected_at: createExpectedAt || null,
          memo: createMemo || null,
          items: validItems.map(i => ({ product: i.product, quantity: Number(i.quantity) })),
        }),
      });
      if (!res.ok) { const err = await res.json(); setCreateError(err.error || '등록 실패'); return; }
      const newOrder = await res.json();
      onRefreshOrders([newOrder, ...orders]);
      setShowOrderModal(false);
      showToast(`발주 ${newOrder.order_number} 등록 완료`);
    } catch { setCreateError('네트워크 오류'); } finally { setCreateSaving(false); }
  };

  const openArriveModal = (order: PurchaseOrder) => {
    setArriveOrder(order);
    setArriveItems(order.purchase_order_items.map(i => ({
      id: i.id, product: i.product, quantity: i.quantity,
      arrived_quantity: i.arrived_quantity, input: String(i.quantity - i.arrived_quantity),
    })));
    setArriveError('');
  };

  const handleArriveSave = async () => {
    if (!arriveOrder) return;
    setArriveSaving(true); setArriveError('');
    try {
      const res = await fetch('/api/purchase-orders', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: arriveOrder.id, action: 'arrive',
          items: arriveItems.map(i => ({ id: i.id, arrived_quantity: i.arrived_quantity + Math.max(0, Number(i.input) || 0) })),
        }),
      });
      if (!res.ok) { const err = await res.json(); setArriveError(err.error || '입고 처리 실패'); return; }
      const result = await res.json();
      if (result.order) onRefreshOrders(orders.map(o => o.id === arriveOrder.id ? result.order : o));
      setArriveOrder(null);
      showToast(`입고 처리 완료${result.status === 'arrived' ? ' (전량 입고)' : ''}`);
    } catch { setArriveError('네트워크 오류'); } finally { setArriveSaving(false); }
  };

  const handleCancelOrder = async (order: PurchaseOrder) => {
    if (!confirm(`발주 ${order.order_number}을(를) 취소하시겠습니까?`)) return;
    try {
      const res = await fetch('/api/purchase-orders', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: order.id, action: 'cancel' }),
      });
      if (res.ok) {
        onRefreshOrders(orders.map(o => o.id === order.id ? { ...o, status: 'cancelled' as const } : o));
        showToast(`발주 ${order.order_number} 취소됨`);
      }
    } catch { /* */ }
  };

  const openInboundModal = () => {
    setCfInboundId(''); setCfVendorItemId(''); setCfQty('');
    setCfWarehouse(''); setCfDeadline(''); setCfMemo(''); setCfError('');
    setCfPreExpanded(false); setCfPreChecked([]);
    setShowInboundModal(true);
  };

  // Product dropdown options (for order modal)
  const productOptions = PRODUCTS.map(p => ({ value: p, label: p }));

  // ---- Build unified display list ----
  type UnifiedItem =
    | { kind: 'inbound'; req: InboundRequest }
    | { kind: 'order'; order: PurchaseOrder };

  const activeItems: UnifiedItem[] = [
    ...sortedActiveInbound.map(req => ({ kind: 'inbound' as const, req })),
    ...activeOrders.map(order => ({ kind: 'order' as const, order })),
  ];

  const historyItems: UnifiedItem[] = showHistory ? [
    ...completedInbound.map(req => ({ kind: 'inbound' as const, req })),
    ...completedOrders.map(order => ({ kind: 'order' as const, order })),
  ] : [];

  const allItems = [...activeItems, ...historyItems];

  return (
    <div id="section-active" className="section">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border-light)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#1F2328', margin: 0 }}>진행 중</h2>
          <span style={{ fontSize: 12, color: '#9AA2AA' }}>
            입고 {activeInbound.length}건
            {activeOrders.length > 0 && ` · 발주 ${activeOrders.length}건`}
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#9AA2AA', cursor: 'pointer', marginLeft: 8 }}>
            <input type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)} style={{ margin: 0 }} />
            이력 포함
          </label>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={openInboundModal} style={{
            padding: '5px 12px', fontSize: 12, fontWeight: 500,
            background: '#1F2328', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
          }}>+ 입고 등록</button>
          <button onClick={openOrderModal} style={{
            padding: '5px 12px', fontSize: 12, fontWeight: 500,
            background: '#F2F4F7', color: '#565D64', border: '1px solid var(--border-light)', borderRadius: 6, cursor: 'pointer',
          }}>+ 발주 등록</button>
        </div>
      </div>

      {/* List */}
      {allItems.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ width: 54, textAlign: 'center' }}>구분</th>
                <th>제품·옵션</th>
                <th style={{ width: 100 }}>수량</th>
                <th style={{ width: 80 }}>물류센터</th>
                <th style={{ width: 100 }}>도착기한</th>
                <th style={{ width: 80, textAlign: 'center' }}>현재상태</th>
                <th style={{ width: 100, textAlign: 'center' }}>다음 액션</th>
              </tr>
            </thead>
            <tbody>
              {allItems.map((item) => {
                if (item.kind === 'inbound') return renderInboundRows(item.req);
                return renderOrderRows(item.order);
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9AA2AA', fontSize: 13 }}>
          진행 중인 입고·발주 건이 없습니다
        </div>
      )}

      {/* --- Modals --- */}

      {/* Inbound Create Modal (simplified) */}
      {showInboundModal && (
        <div style={modalOverlayStyle} onClick={() => setShowInboundModal(false)}>
          <div style={{ ...modalStyle, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#1F2328', marginBottom: 16 }}>입고 건 등록</div>

            {/* 쿠팡 입고ID */}
            <div style={{ marginBottom: 14 }}>
              <label style={poLabelStyle}>쿠팡 입고ID *</label>
              <input value={cfInboundId} onChange={e => setCfInboundId(e.target.value)}
                placeholder="1098928730115411969"
                style={{ ...poInputStyle, borderRadius: 8, height: 38, border: '1px solid #E4E8EC' }} />
              <div style={{ fontSize: 11, color: '#9AA2AA', marginTop: 3 }}>쿠팡 입고관리에서 복사해 붙여넣으세요</div>
            </div>

            {/* 상품 */}
            <div style={{ marginBottom: 14 }}>
              <label style={poLabelStyle}>상품 *</label>
              <InboundDropdown
                options={INBOUND_PRODUCT_OPTIONS.map(o => ({ value: o.value, label: o.label, sublabel: o.vid }))}
                value={cfVendorItemId}
                onChange={setCfVendorItemId}
                placeholder="상품 선택"
              />
            </div>

            {/* 수량 + 물류센터 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={poLabelStyle}>총수량 *</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="number" value={cfQty} onChange={e => setCfQty(e.target.value)}
                    style={{ ...poInputStyle, borderRadius: 8, height: 38, border: '1px solid #E4E8EC', width: 100 }} min="1" />
                  <span style={{ fontSize: 12, color: '#6E767E' }}>세트</span>
                </div>
                {cfVendorItemId && cfQty && (() => {
                  const info = getProductInfo(cfVendorItemId);
                  if (info && info.unitCount > 1) {
                    return <div style={{ fontSize: 11, color: '#9AA2AA', marginTop: 2 }}>낱개 {formatNumber(Number(cfQty) * info.unitCount)}개</div>;
                  }
                  return null;
                })()}
              </div>
              <div>
                <label style={poLabelStyle}>물류센터 *</label>
                <InboundDropdown
                  options={WAREHOUSES.map(w => ({ value: w, label: w }))}
                  value={cfWarehouse}
                  onChange={setCfWarehouse}
                  placeholder="선택"
                />
              </div>
            </div>

            {/* 도착예정일 */}
            <div style={{ marginBottom: 14 }}>
              <label style={poLabelStyle}>도착예정일 *</label>
              <InboundDatePicker value={cfDeadline} onChange={setCfDeadline} placeholder="날짜 선택" />
              <div style={{ fontSize: 11, color: '#9AA2AA', marginTop: 3 }}>쿠팡이 지정한 최신 도착 기한입니다</div>
            </div>

            {/* 메모 */}
            <div style={{ marginBottom: 14 }}>
              <label style={poLabelStyle}>메모</label>
              <input value={cfMemo} onChange={e => setCfMemo(e.target.value)} placeholder=""
                style={{ ...poInputStyle, borderRadius: 8, height: 38, border: '1px solid #E4E8EC' }} />
            </div>

            {/* 이미 진행된 건 (collapsed) */}
            <div style={{ marginBottom: 16 }}>
              <button
                onClick={() => setCfPreExpanded(!cfPreExpanded)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12, fontWeight: 500, color: '#6E767E' }}
              >
                <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: cfPreExpanded ? 'rotate(90deg)' : 'none', marginRight: 4 }}>▸</span>
                이미 진행된 건
              </button>
              {cfPreExpanded && (
                <div style={{ padding: '8px 12px', background: '#FAFBFC', borderRadius: 8, marginTop: 6 }}>
                  {INBOUND_STEP_LABELS.map((label, i) => (
                    <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#1F2328', cursor: 'pointer', marginBottom: 4 }}>
                      <input type="checkbox" checked={cfPreChecked.includes(i)}
                        onChange={e => {
                          if (e.target.checked) setCfPreChecked([...cfPreChecked, i]);
                          else setCfPreChecked(cfPreChecked.filter(x => x !== i));
                        }}
                        style={{ margin: 0, accentColor: '#1A7F37' }} />
                      {label} 완료
                    </label>
                  ))}
                </div>
              )}
            </div>

            {cfError && <div style={{ fontSize: 12, color: '#B03F3B', marginBottom: 8 }}>{cfError}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowInboundModal(false)} style={poCancelBtnStyle}>취소</button>
              <button onClick={handleCreateInbound} disabled={saving}
                style={{ ...poSaveBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? '등록 중...' : '등록'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Inbound Edit Modal */}
      {editTarget && (
        <div style={modalOverlayStyle} onClick={() => setEditTarget(null)}>
          <div style={{ ...modalStyle, maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#1F2328', marginBottom: 16 }}>입고 건 수정</div>
            <div style={{ marginBottom: 14 }}>
              <label style={poLabelStyle}>쿠팡 입고ID</label>
              <input value={efInboundId} onChange={e => setEfInboundId(e.target.value)}
                style={{ ...poInputStyle, borderRadius: 8, height: 38, border: '1px solid #E4E8EC' }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={poLabelStyle}>상품</label>
              <InboundDropdown
                options={INBOUND_PRODUCT_OPTIONS.map(o => ({ value: o.value, label: o.label, sublabel: o.vid }))}
                value={efVendorItemId} onChange={setEfVendorItemId} placeholder="상품 선택"
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={poLabelStyle}>수량</label>
              <input type="number" value={efQty} onChange={e => setEfQty(e.target.value)}
                style={{ ...poInputStyle, borderRadius: 8, height: 38, border: '1px solid #E4E8EC', width: 120 }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={poLabelStyle}>물류센터</label>
              <InboundDropdown
                options={WAREHOUSES.map(w => ({ value: w, label: w }))}
                value={efWarehouse} onChange={setEfWarehouse} placeholder="선택"
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={poLabelStyle}>도착 기한</label>
              <InboundDatePicker value={efDeadline} onChange={setEfDeadline} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={poLabelStyle}>메모</label>
              <input value={efMemo} onChange={e => setEfMemo(e.target.value)}
                style={{ ...poInputStyle, borderRadius: 8, height: 38, border: '1px solid #E4E8EC' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditTarget(null)} style={poCancelBtnStyle}>취소</button>
              <button onClick={handleEditSave} disabled={saving}
                style={{ ...poSaveBtnStyle, opacity: saving ? 0.6 : 1 }}>저장</button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Inbound Modal */}
      {cancelTarget && (
        <div style={modalOverlayStyle} onClick={() => setCancelTarget(null)}>
          <div style={{ ...modalStyle, maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#1F2328', marginBottom: 12 }}>입고 취소</div>
            <div style={{ fontSize: 13, color: '#61686F', marginBottom: 14 }}>
              {reqProductLabel(cancelTarget)} — 취소 사유를 선택하세요
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {CANCEL_REASONS.map(reason => (
                <label key={reason} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#1F2328', cursor: 'pointer' }}>
                  <input type="radio" name="cancel_reason" value={reason} checked={cancelReason === reason}
                    onChange={e => setCancelReason(e.target.value)} style={{ margin: 0, accentColor: '#1F2328' }} />
                  {reason}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setCancelTarget(null)} style={poCancelBtnStyle}>닫기</button>
              <button onClick={handleCancelInbound} disabled={!cancelReason || saving}
                style={{ ...poSaveBtnStyle, background: '#B03F3B', opacity: (!cancelReason || saving) ? 0.5 : 1 }}>
                취소 확정
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Order Create Modal */}
      {showOrderModal && (
        <div style={modalOverlayStyle} onClick={() => setShowOrderModal(false)}>
          <div style={{ ...modalStyle, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#1F2328', marginBottom: 16 }}>발주 등록</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={poLabelStyle}>유형 *</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['production', 'transfer'] as const).map(t => (
                    <button key={t} onClick={() => { setCreateType(t); setCreateExpectedAt(calcExpectedAt(t, createOrderedAt)); }} style={{
                      flex: 1, padding: '7px 10px', fontSize: 13, fontWeight: 500, borderRadius: 6, cursor: 'pointer',
                      border: createType === t ? '2px solid #1F2328' : '1px solid var(--border-light)',
                      background: createType === t ? '#F2F4F7' : '#fff', color: '#1F2328',
                    }}>{ORDER_TYPE_LABELS[t]}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={poLabelStyle}>입고처 *</label>
                <InboundDropdown
                  options={[{ value: 'easyadmin', label: '국내 3PL' }, { value: 'rocketgrowth', label: '로켓그로스' }]}
                  value={createDest}
                  onChange={v => setCreateDest(v as 'easyadmin' | 'rocketgrowth')}
                  placeholder="입고처"
                />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={poLabelStyle}>발주일</label>
                <InboundDatePicker value={createOrderedAt} onChange={v => { setCreateOrderedAt(v); setCreateExpectedAt(calcExpectedAt(createType, v)); }} />
              </div>
              <div>
                <label style={poLabelStyle}>예상 입고일 (리드타임 {createType === 'production' ? leadTimes.production : leadTimes.transfer}일)</label>
                <InboundDatePicker value={createExpectedAt} onChange={setCreateExpectedAt} />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={poLabelStyle}>품목</label>
              {createItems.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                  <div style={{ flex: 2 }}>
                    <InboundDropdown
                      options={productOptions}
                      value={item.product}
                      onChange={v => { const next = [...createItems]; next[idx].product = v; setCreateItems(next); }}
                      placeholder="제품"
                    />
                  </div>
                  <input type="number" placeholder="수량" value={item.quantity}
                    onChange={e => { const next = [...createItems]; next[idx].quantity = e.target.value; setCreateItems(next); }}
                    style={{ ...poInputStyle, flex: 1, borderRadius: 8, height: 38, border: '1px solid #E4E8EC' }} min="1" />
                  {createItems.length > 1 && (
                    <button onClick={() => setCreateItems(prev => prev.filter((_, i) => i !== idx))}
                      style={{ background: 'none', border: 'none', color: '#D9534F', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
                  )}
                </div>
              ))}
              <button onClick={() => setCreateItems(prev => [...prev, { product: '클렌징밤', quantity: '' }])}
                style={{ background: 'none', border: 'none', color: '#0969DA', cursor: 'pointer', fontSize: 12, padding: '4px 0' }}>+ 품목 추가</button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={poLabelStyle}>메모</label>
              <input value={createMemo} onChange={e => setCreateMemo(e.target.value)} placeholder=""
                style={{ ...poInputStyle, borderRadius: 8, height: 38, border: '1px solid #E4E8EC' }} />
            </div>
            {createError && <div style={{ fontSize: 12, color: '#D9534F', marginBottom: 12 }}>{createError}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowOrderModal(false)} style={poCancelBtnStyle}>취소</button>
              <button onClick={handleCreateOrder} disabled={createSaving}
                style={{ ...poSaveBtnStyle, opacity: createSaving ? 0.5 : 1 }}>
                {createSaving ? '등록 중...' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Order Arrive Modal */}
      {arriveOrder && (
        <div style={modalOverlayStyle} onClick={() => setArriveOrder(null)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#1F2328', marginBottom: 4 }}>입고 처리</div>
            <div style={{ fontSize: 12, color: '#9AA2AA', marginBottom: 16 }}>
              {arriveOrder.order_number} · {ORDER_TYPE_LABELS[arriveOrder.order_type]} · {DEST_LABELS[arriveOrder.destination]}
            </div>
            <table className="data-table" style={{ marginBottom: 16 }}>
              <thead><tr><th>제품</th><th className="right">발주</th><th className="right">기입고</th><th className="right" style={{ width: 100 }}>이번 입고</th></tr></thead>
              <tbody>
                {arriveItems.map((item, idx) => {
                  const remaining = item.quantity - item.arrived_quantity;
                  return (
                    <tr key={item.id}>
                      <td style={{ fontSize: 13, fontWeight: 500 }}>{item.product}</td>
                      <td className="right font-mono" style={{ fontSize: 13 }}>{formatNumber(item.quantity)}</td>
                      <td className="right font-mono" style={{ fontSize: 13 }}>{formatNumber(item.arrived_quantity)}</td>
                      <td className="right">
                        <input type="number" value={item.input}
                          onChange={e => { const next = [...arriveItems]; next[idx].input = e.target.value; setArriveItems(next); }}
                          min="0" max={remaining} style={{ ...poInputStyle, width: 80, textAlign: 'right' }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button onClick={() => setArriveItems(prev => prev.map(i => ({ ...i, input: String(i.quantity - i.arrived_quantity) })))}
                style={{ ...poCancelBtnStyle, fontSize: 12 }}>전체 입고</button>
            </div>
            {arriveError && <div style={{ fontSize: 12, color: '#D9534F', marginBottom: 12 }}>{arriveError}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setArriveOrder(null)} style={poCancelBtnStyle}>취소</button>
              <button onClick={handleArriveSave} disabled={arriveSaving} style={{ ...poSaveBtnStyle, opacity: arriveSaving ? 0.5 : 1 }}>
                {arriveSaving ? '처리 중...' : '입고 확인'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectTarget && <RejectModal request={rejectTarget} onClose={() => setRejectTarget(null)} onConfirm={handleReject} />}
    </div>
  );

  // ---- Render helpers ----

  function renderInboundRows(req: InboundRequest) {
    const isExpanded_ = expandedId === req.id;
    const isTerminal = ['rejected', 'cancelled'].includes(req.status);
    const allDone = isAllChecked(req);
    const status = deriveStatus(req);
    const badge = INBOUND_STATUS_BADGE[status];
    const dday = getDDay(req.coupang_deadline);
    const prodInfo = req.vendor_item_id ? getProductInfo(req.vendor_item_id) : null;
    const unitCount = prodInfo?.unitCount || 1;
    const rowOpacity = (isTerminal || allDone) ? 0.55 : 1;

    const nextActionMap: Record<string, { label: string; handler: () => void } | null> = {
      order_needed: { label: '3PL 출고', handler: () => setExpandedId(isExpanded_ ? null : req.id) },
      tracking_needed: { label: '송장 입력', handler: () => setExpandedId(isExpanded_ ? null : req.id) },
      waiting: { label: '쿠팡 확인', handler: () => window.open('https://wing.coupang.com/tenants/direct-wing/vendor-inventory/inbound/management', '_blank') },
      done: null, cancelled: null,
    };
    const nextAction = (!isTerminal && !allDone) ? nextActionMap[status] : null;
    const cellBtnStyle: React.CSSProperties = {
      padding: '3px 8px', fontSize: 11, fontWeight: 600,
      background: '#1F2328', color: '#fff', border: 'none', borderRadius: 5,
      cursor: 'pointer', whiteSpace: 'nowrap',
    };

    return (
      <React.Fragment key={`inb-${req.id}`}>
        {/* Main row */}
        <tr
          onClick={() => setExpandedId(isExpanded_ ? null : req.id)}
          style={{ cursor: 'pointer', opacity: rowOpacity }}
        >
          <td style={{ textAlign: 'center' }}>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
              color: '#565D64', background: '#F1F3F6',
            }}>이관</span>
          </td>
          <td style={{ fontWeight: 500, color: '#1A1D21' }}>
            {reqProductLabel(req)}
          </td>
          <td style={{ fontVariantNumeric: 'tabular-nums', color: '#1A1D21' }}>
            {formatNumber(req.quantity)}세트
            {unitCount > 1 && (
              <span style={{ fontSize: 11, color: '#9AA2AA', marginLeft: 4 }}>
                ({formatNumber(req.quantity * unitCount)})
              </span>
            )}
          </td>
          <td style={{ color: '#565D64', fontSize: 12 }}>
            {req.warehouse || '—'}
          </td>
          <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {req.coupang_deadline ? (
              <>
                <span style={{ color: '#565D64' }}>{req.coupang_deadline.slice(5).replace('-', '/')}</span>
                {dday && !isTerminal && !allDone && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: dday.color, marginLeft: 4,
                    padding: '0 4px', borderRadius: 6,
                    background: dday.overdue || dday.diff === 0 ? '#FBE9E8' : dday.urgent ? '#FDF4E7' : 'transparent',
                  }}>
                    {dday.text}
                  </span>
                )}
              </>
            ) : '—'}
          </td>
          <td style={{ textAlign: 'center' }}>
            <span style={{
              display: 'inline-block', fontSize: 11, fontWeight: 500,
              padding: '1px 6px', borderRadius: 4,
              color: badge.color, background: badge.bg, whiteSpace: 'nowrap',
            }}>
              {badge.text}
            </span>
          </td>
          <td style={{ textAlign: 'center' }}>
            {nextAction ? (
              <button
                onClick={e => { e.stopPropagation(); nextAction.handler(); }}
                style={cellBtnStyle}
              >
                {nextAction.label}
              </button>
            ) : '—'}
          </td>
        </tr>

        {/* Expanded detail row */}
        {isExpanded_ && (
          <tr>
            <td colSpan={7} style={{ padding: 0, background: '#FAFBFC' }}>
              <div style={{ padding: '10px 16px' }} onClick={e => e.stopPropagation()}>
                {/* Inbound ID */}
                {req.coupang_inbound_id && (
                  <div style={{ fontSize: 12, color: '#6E767E', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: '#9AA2AA' }}>입고ID</span>
                    <span style={{ fontFamily: 'monospace' }}>{req.coupang_inbound_id}</span>
                    <span
                      onClick={() => { navigator.clipboard.writeText(req.coupang_inbound_id!); showToast('입고ID 복사됨'); }}
                      style={{ cursor: 'pointer', fontSize: 11, color: '#0969DA' }}
                    >복사</span>
                  </div>
                )}

                {/* Horizontal checklist */}
                {!isTerminal && (
                  <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                    {INBOUND_STEP_LABELS.map((label, i) => {
                      const checked = isStepChecked(req, i);
                      const dateStr = getCheckedDate(req, i);
                      return (
                        <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: saving ? 'default' : 'pointer' }}>
                          <input
                            type="checkbox" checked={checked} disabled={isTerminal || saving}
                            onChange={() => handleToggle(req.id, i)}
                            style={{ margin: 0, accentColor: '#1A7F37', width: 14, height: 14 }}
                          />
                          <span style={{
                            color: checked ? '#9AA2AA' : '#1F2328',
                            fontWeight: !checked ? 500 : 400,
                            textDecoration: checked ? 'line-through' : 'none',
                          }}>{label}</span>
                          {checked && dateStr && <span style={{ fontSize: 10, color: '#C4CAD1' }}>{dateStr}</span>}
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* Tracking input */}
                {!isTerminal && !allDone && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: '#565D64', whiteSpace: 'nowrap' }}>운송장번호</span>
                    <input
                      value={trackingInputs[req.id] ?? req.tracking_number ?? ''}
                      onChange={e => setTrackingInputs({ ...trackingInputs, [req.id]: e.target.value })}
                      style={{ ...poInputStyle, width: 200, marginBottom: 0, fontSize: 12, borderRadius: 8, height: 32, border: '1px solid #E4E8EC' }}
                    />
                    <button onClick={() => handleSaveTracking(req.id)} disabled={saving} style={poActionBtnStyle}>저장</button>
                  </div>
                )}

                {/* Memo */}
                {req.memo && (
                  <div style={{ fontSize: 12, color: '#61686F', marginBottom: 6 }}>
                    <span style={{ color: '#9AA2AA' }}>메모:</span> {req.memo}
                  </div>
                )}

                {/* Rejected info */}
                {req.status === 'rejected' && req.reject_reason && (
                  <div style={{ fontSize: 11, color: '#B03F3B', marginBottom: 6 }}>
                    반송: {REJECT_REASON_LABELS[req.reject_reason] || req.reject_reason}
                    {req.reject_memo && ` · ${req.reject_memo}`}
                  </div>
                )}

                {/* Action buttons */}
                {!isTerminal && !allDone && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, borderTop: '1px solid #E4E8EC', paddingTop: 8 }}>
                    <button onClick={() => openEdit(req)} style={{ ...poActionBtnStyle, background: '#F2F4F7', color: '#565D64' }}>수정</button>
                    <button onClick={() => { setCancelTarget(req); setCancelReason(''); }} style={{ ...poActionBtnStyle, background: '#F2F4F7', color: '#B03F3B' }}>취소</button>
                    <button onClick={() => handleDeleteInbound(req.id)} style={{ ...poActionBtnStyle, background: '#F2F4F7', color: '#9AA2AA' }}>삭제</button>
                  </div>
                )}
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  }

  function renderOrderRows(order: PurchaseOrder) {
    const st = STATUS_LABELS[order.status] ?? STATUS_LABELS.ordered;
    const isOverdue = order.expected_at && order.status === 'ordered' && order.expected_at < todayStr;
    const itemSummary = order.purchase_order_items.map(i => `${i.product} ${formatNumber(i.quantity)}개`).join(', ');
    const totalQty = order.purchase_order_items.reduce((sum, i) => sum + i.quantity, 0);
    const destShort = order.destination === 'rocketgrowth' ? 'RG' : '3PL';
    const cellBtnStyle: React.CSSProperties = {
      padding: '3px 8px', fontSize: 11, fontWeight: 600,
      background: '#1F2328', color: '#fff', border: 'none', borderRadius: 5,
      cursor: 'pointer', whiteSpace: 'nowrap',
    };

    return (
      <tr key={`ord-${order.id}`} style={{ opacity: order.status === 'cancelled' ? 0.55 : 1 }}>
        <td style={{ textAlign: 'center' }}>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
            color: '#A8712A', background: '#FDF6EC',
          }}>발주</span>
        </td>
        <td style={{ fontWeight: 500, color: '#1A1D21' }}>
          {itemSummary}
          <span style={{ fontSize: 11, color: '#9AA2AA', marginLeft: 6 }}>
            {ORDER_TYPE_LABELS[order.order_type]}
          </span>
          {order.memo && <span style={{ fontSize: 11, color: '#C4CAD1', marginLeft: 4 }}>{order.memo}</span>}
        </td>
        <td style={{ fontVariantNumeric: 'tabular-nums', color: '#1A1D21' }}>
          {formatNumber(totalQty)}개
        </td>
        <td style={{ color: '#565D64', fontSize: 12 }}>
          {destShort}
        </td>
        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {order.expected_at ? (
            <>
              <span style={{ color: '#565D64' }}>{order.expected_at.slice(5).replace('-', '/')}</span>
              {isOverdue && (
                <span style={{ fontSize: 11, fontWeight: 600, color: '#B03F3B', marginLeft: 4 }}>
                  {Math.round((Date.now() + 9 * 3_600_000 - new Date(order.expected_at + 'T00:00:00+09:00').getTime()) / 86_400_000)}일 경과
                </span>
              )}
            </>
          ) : '—'}
        </td>
        <td style={{ textAlign: 'center' }}>
          <span style={{
            display: 'inline-block', fontSize: 11, fontWeight: 500,
            padding: '1px 6px', borderRadius: 4,
            color: st.color, background: st.bg, whiteSpace: 'nowrap',
          }}>{st.text}</span>
        </td>
        <td style={{ textAlign: 'center' }}>
          {order.status === 'ordered' ? (
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
              <button onClick={() => openArriveModal(order)} style={cellBtnStyle}>입고</button>
              <button onClick={() => handleCancelOrder(order)}
                style={{ ...cellBtnStyle, background: '#F2F4F7', color: '#D9534F' }}>취소</button>
            </div>
          ) : '—'}
        </td>
      </tr>
    );
  }
}
