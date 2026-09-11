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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border-light)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ fontSize: 14.5, fontWeight: 600, color: '#1F2328', margin: 0 }}>진행 중</h2>
          <span style={{ fontSize: 12, color: '#6E767E' }}>
            입고 {activeInbound.length}건
            {activeOrders.length > 0 && ` · 발주 ${activeOrders.length}건`}
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#6E767E', cursor: 'pointer', marginLeft: 8 }}>
            <input type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)} style={{ margin: 0 }} />
            이력 포함
          </label>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={openInboundModal} style={{
            height: 36, padding: '0 14px', fontSize: 13, fontWeight: 550,
            background: '#1A1D21', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
          }}>+ 입고 등록</button>
          <button onClick={openOrderModal} style={{
            height: 36, padding: '0 14px', fontSize: 13, fontWeight: 550,
            background: '#F2F4F7', color: '#565D64', border: '1px solid #E4E8EC', borderRadius: 8, cursor: 'pointer',
          }}>+ 발주 등록</button>
        </div>
      </div>

      {/* List — card rows */}
      {allItems.length > 0 ? (
        <div>
          {allItems.map((item, idx) => {
            if (item.kind === 'inbound') return renderInboundRows(item.req, idx === allItems.length - 1);
            return renderOrderRows(item.order, idx === allItems.length - 1);
          })}
        </div>
      ) : (
        <div style={{ padding: '32px 20px', textAlign: 'center', color: '#6E767E', fontSize: 13, fontWeight: 450 }}>
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

  function renderInboundRows(req: InboundRequest, isLast: boolean) {
    const isExpanded_ = expandedId === req.id;
    const isTerminal = ['rejected', 'cancelled'].includes(req.status);
    const allDone = isAllChecked(req);
    const status = deriveStatus(req);
    const badge = INBOUND_STATUS_BADGE[status];
    const dday = getDDay(req.coupang_deadline);
    const prodInfo = req.vendor_item_id ? getProductInfo(req.vendor_item_id) : null;
    const unitCount = prodInfo?.unitCount || 1;
    const rowOpacity = (isTerminal || allDone) ? 0.55 : 1;
    const isMenuOpen = menuId === `inb-${req.id}`;

    // Build detail line parts
    const detailParts: string[] = [];
    if (req.quantity) {
      const qtyStr = `${formatNumber(req.quantity)}세트`;
      detailParts.push(unitCount > 1 ? `${qtyStr} (낱개 ${formatNumber(req.quantity * unitCount)})` : qtyStr);
    }
    if (req.warehouse) detailParts.push(req.warehouse);
    if (req.coupang_deadline) {
      let dlStr = `도착기한 ${req.coupang_deadline.slice(5).replace('-', '/')}`;
      if (dday && !isTerminal && !allDone) dlStr += ` (${dday.text})`;
      detailParts.push(dlStr);
    }

    return (
      <div
        key={`inb-${req.id}`}
        style={{
          padding: '14px 20px', opacity: rowOpacity,
          borderBottom: isLast ? 'none' : '1px solid #F2F4F7',
        }}
      >
        {/* Line 1: type badge + product + inbound ID + status badge + ⋯ */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11.5, fontWeight: 550, padding: '2px 8px', borderRadius: 6,
            color: '#565D64', background: '#F1F3F6', flexShrink: 0,
          }}>이관</span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1D21' }}>
            {reqProductLabel(req)}
          </span>
          {req.coupang_inbound_id && (
            <span style={{ fontSize: 12, color: '#9AA2AA', fontVariantNumeric: 'tabular-nums' }}>
              {req.coupang_inbound_id}
            </span>
          )}
          <span style={{
            fontSize: 11.5, fontWeight: 550, padding: '2px 8px', borderRadius: 6,
            color: badge.color, background: badge.bg, whiteSpace: 'nowrap', marginLeft: 'auto', flexShrink: 0,
          }}>
            {badge.text}
          </span>
          {/* ⋯ menu */}
          {!isTerminal && !allDone && (
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button
                onClick={e => { e.stopPropagation(); setMenuId(isMenuOpen ? null : `inb-${req.id}`); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', fontSize: 16, color: '#6E767E', lineHeight: 1 }}
              >⋯</button>
              {isMenuOpen && (
                <div ref={menuRef} style={{
                  position: 'absolute', right: 0, top: '100%', background: '#fff', borderRadius: 8,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.12)', border: '1px solid #E4E8EC', zIndex: 100,
                  minWidth: 100, padding: '4px 0',
                }}>
                  <button onClick={() => openEdit(req)} style={{ display: 'block', width: '100%', padding: '8px 14px', fontSize: 13, color: '#565D64', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>수정</button>
                  <button onClick={() => { setCancelTarget(req); setCancelReason(''); setMenuId(null); }} style={{ display: 'block', width: '100%', padding: '8px 14px', fontSize: 13, color: '#B03F3B', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>취소</button>
                  <button onClick={() => handleDeleteInbound(req.id)} style={{ display: 'block', width: '100%', padding: '8px 14px', fontSize: 13, color: '#9AA2AA', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>삭제</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Line 2: detail */}
        <div style={{ fontSize: 12.5, fontWeight: 450, color: '#6E767E', marginTop: 4 }}>
          {detailParts.join(' · ')}
          {dday && !isTerminal && !allDone && (dday.overdue || dday.diff === 0) && (
            <span style={{ fontWeight: 550, color: '#B03F3B', marginLeft: 4 }}>{dday.text}</span>
          )}
        </div>

        {/* Line 3: horizontal checklist (always visible) */}
        {!isTerminal && (
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            {INBOUND_STEP_LABELS.map((label, i) => {
              const checked = isStepChecked(req, i);
              const dateStr = getCheckedDate(req, i);
              return (
                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, cursor: saving ? 'default' : 'pointer' }}>
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
                  {checked && dateStr && <span style={{ fontSize: 11, color: '#C4CAD1' }}>{dateStr}</span>}
                </label>
              );
            })}
          </div>
        )}

        {/* Expand toggle */}
        {!isTerminal && !allDone && (
          <button
            onClick={() => setExpandedId(isExpanded_ ? null : req.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontSize: 12, color: '#6E767E', marginTop: 4 }}
          >
            {isExpanded_ ? '접기 ▴' : '운송장·메모 ▾'}
          </button>
        )}

        {/* Expanded: tracking + memo */}
        {isExpanded_ && (
          <div style={{ padding: '8px 0 0', marginTop: 4 }}>
            {/* Tracking input */}
            {!isTerminal && !allDone && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#565D64', whiteSpace: 'nowrap' }}>운송장번호</span>
                <input
                  value={trackingInputs[req.id] ?? req.tracking_number ?? ''}
                  onChange={e => setTrackingInputs({ ...trackingInputs, [req.id]: e.target.value })}
                  style={{ ...poInputStyle, width: 200, marginBottom: 0, fontSize: 12, borderRadius: 8, height: 36, border: '1px solid #E4E8EC' }}
                />
                <button onClick={() => handleSaveTracking(req.id)} disabled={saving} style={poActionBtnStyle}>저장</button>
              </div>
            )}

            {/* Memo */}
            {req.memo && (
              <div style={{ fontSize: 12, color: '#6E767E', marginBottom: 4 }}>
                <span style={{ color: '#9AA2AA' }}>메모:</span> {req.memo}
              </div>
            )}

            {/* Rejected info */}
            {req.status === 'rejected' && req.reject_reason && (
              <div style={{ fontSize: 12, color: '#B03F3B' }}>
                반송: {REJECT_REASON_LABELS[req.reject_reason] || req.reject_reason}
                {req.reject_memo && ` · ${req.reject_memo}`}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderOrderRows(order: PurchaseOrder, isLast: boolean) {
    const st = STATUS_LABELS[order.status] ?? STATUS_LABELS.ordered;
    const isOverdue = order.expected_at && order.status === 'ordered' && order.expected_at < todayStr;
    const itemSummary = order.purchase_order_items.map(i => `${i.product} ${formatNumber(i.quantity)}개`).join(', ');
    const destLabel = order.destination === 'rocketgrowth' ? '로켓그로스' : '판매자배송 3PL(이지어드민)';

    // Detail parts
    const detailParts: string[] = [];
    detailParts.push(destLabel);
    if (order.expected_at) {
      let dtStr = `예정 ${order.expected_at.slice(5).replace('-', '/')}`;
      if (isOverdue) {
        const diff = Math.round((Date.now() + 9 * 3_600_000 - new Date(order.expected_at + 'T00:00:00+09:00').getTime()) / 86_400_000);
        dtStr += ` (${diff}일 경과)`;
      }
      detailParts.push(dtStr);
    }

    return (
      <div
        key={`ord-${order.id}`}
        style={{
          padding: '14px 20px', opacity: order.status === 'cancelled' ? 0.55 : 1,
          borderBottom: isLast ? 'none' : '1px solid #F2F4F7',
        }}
      >
        {/* Line 1: type badge + items + order type + status badge + buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11.5, fontWeight: 550, padding: '2px 8px', borderRadius: 6,
            color: '#A8712A', background: '#FDF4E7', flexShrink: 0,
          }}>발주</span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1D21' }}>
            {itemSummary}
          </span>
          <span style={{ fontSize: 12, color: '#9AA2AA' }}>
            {ORDER_TYPE_LABELS[order.order_type]}
          </span>
          <span style={{
            fontSize: 11.5, fontWeight: 550, padding: '2px 8px', borderRadius: 6,
            color: st.color, background: st.bg, whiteSpace: 'nowrap', marginLeft: 'auto', flexShrink: 0,
          }}>{st.text}</span>
        </div>

        {/* Line 2: detail */}
        <div style={{ fontSize: 12.5, fontWeight: 450, color: '#6E767E', marginTop: 4 }}>
          {detailParts.join(' · ')}
        </div>

        {/* Line 3: action buttons for active orders */}
        {order.status === 'ordered' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={() => openArriveModal(order)} style={{
              height: 32, padding: '0 12px', fontSize: 12, fontWeight: 550,
              background: '#1A1D21', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
            }}>입고</button>
            <button onClick={() => handleCancelOrder(order)} style={{
              height: 32, padding: '0 12px', fontSize: 12, fontWeight: 550,
              background: '#F2F4F7', color: '#B03F3B', border: 'none', borderRadius: 8, cursor: 'pointer',
            }}>취소</button>
          </div>
        )}

        {/* Memo */}
        {order.memo && (
          <div style={{ fontSize: 12, color: '#6E767E', marginTop: 4 }}>
            <span style={{ color: '#9AA2AA' }}>메모:</span> {order.memo}
          </div>
        )}
      </div>
    );
  }
}
