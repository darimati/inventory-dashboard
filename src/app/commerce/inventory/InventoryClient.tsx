'use client';

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import AppShell from '@/components/AppShell';

/* Types & Constants */
import type { Props, PurchaseOrder, InboundRequest, EzadminItem, OptionRow } from './types';

/* Components */
import { buildTasks, TodaysTasks } from './components/TodaysTasks';
import { InventoryTable } from './components/InventoryTable';
import { UnmappedSkuSection } from './components/StockSection';
import { ActiveItemsSection } from './components/ActiveItemsSection';

/* ------------------------------------------------------------------ */
/*  Main Component — 운영형 대시보드                                    */
/* ------------------------------------------------------------------ */

export default function InventoryClient({
  rocketItems, ezadminItems, alerts, snapshots, purchaseOrders: initialOrders,
  incomingMap, leadTimes, inventoryThresholds, productNotices, productSummaries,
  serverInboundRequests, primarySkus, summary,
}: Props) {
  const [orders, setOrders] = useState<PurchaseOrder[]>(initialOrders);

  // Inbound requests
  const [inboundRequests, setInboundRequests] = useState<InboundRequest[]>(serverInboundRequests as InboundRequest[]);
  const [inboundLoaded, setInboundLoaded] = useState(false);
  const [pendingInboundCreate, setPendingInboundCreate] = useState<{ product: string; quantity: number } | null>(null);

  const loadInboundRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/inbound-requests');
      if (res.ok) {
        const json = await res.json();
        setInboundRequests(json.data ?? []);
      }
    } catch { /* table may not exist yet */ }
    setInboundLoaded(true);
  }, []);

  useEffect(() => {
    if (!inboundLoaded) loadInboundRequests();
  }, [inboundLoaded, loadInboundRequests]);

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); }, []);

  // Manual sync
  const [syncing, setSyncing] = useState(false);
  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/sync/trigger', { method: 'POST' });
      const body = await res.json();
      if (res.ok) {
        showToast('동기화 요청 접수됨 — 잠시 후 자동 반영됩니다');
        const logId = body.logId;
        if (logId) {
          const poll = setInterval(async () => {
            try {
              const check = await fetch(`/api/sync/trigger?id=${logId}`);
              const data = await check.json();
              if (data.sync?.status === 'success') {
                clearInterval(poll); setSyncing(false);
                showToast('동기화 완료!');
                setTimeout(() => window.location.reload(), 1000);
              } else if (data.sync?.status === 'error') {
                clearInterval(poll); setSyncing(false);
                showToast(`동기화 오류: ${data.sync.error_message || '알 수 없는 오류'}`);
              }
            } catch { /* keep polling */ }
          }, 5000);
          setTimeout(() => { clearInterval(poll); setSyncing(false); showToast('동기화 시간 초과 — 페이지를 새로고침하세요'); }, 120_000);
        } else {
          setTimeout(() => { setSyncing(false); window.location.reload(); }, 15_000);
        }
      } else if (body.remainingSeconds) {
        showToast(`쿨다운: ${body.remainingSeconds}초 후 다시 시도하세요`);
        setSyncing(false);
      } else {
        showToast(`동기화 요청 실패: ${body.error || '알 수 없는 오류'}`);
        setSyncing(false);
      }
    } catch (err) {
      showToast(`네트워크 오류: ${err instanceof Error ? err.message : '연결 실패'}`);
      setSyncing(false);
    }
  };

  // EZAdmin upload
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ ok: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleEzadminUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/ezadmin/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        setUploadResult({ ok: true, message: `업로드 완료 / ${data.upserted}건 반영` });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setUploadResult({ ok: false, message: data.error || '업로드 실패' });
      }
    } catch { setUploadResult({ ok: false, message: '네트워크 오류' }); }
    finally { setUploading(false); e.target.value = ''; }
  };

  // Data freshness
  const latestEzadminUpdate = ezadminItems.length > 0 ? ezadminItems[0].updatedAt : null;
  const ezadminFreshness = (() => {
    if (!latestEzadminUpdate) return { label: '업로드 필요', color: '#E8A0B4', tooltip: '이지어드민 파일을 업로드하세요' };
    const updAt = new Date(latestEzadminUpdate);
    const daysAgo = (Date.now() - updAt.getTime()) / 86_400_000;
    const mm = String(updAt.getMonth() + 1).padStart(2, '0');
    const dd = String(updAt.getDate()).padStart(2, '0');
    const hh = String(updAt.getHours()).padStart(2, '0');
    const mi = String(updAt.getMinutes()).padStart(2, '0');
    const dateTimeLabel = `${mm}/${dd} ${hh}:${mi}`;
    const fullTooltip = `판매자배송 3PL(이지어드민): ${updAt.getFullYear()}.${mm}.${dd} ${hh}:${mi} 업로드 기준`;
    if (daysAgo < 2) return { label: dateTimeLabel, color: '#565D64', tooltip: fullTooltip };
    if (daysAgo < 7) return { label: `${Math.round(daysAgo)}일 전 기준`, color: '#8FAEE0', tooltip: fullTooltip };
    return { label: `${Math.round(daysAgo)}일 전 기준`, color: '#E8A0B4', tooltip: fullTooltip };
  })();

  // Unmapped SKUs
  const unmappedSkus = ezadminItems.filter(e => !e.mapped);
  const [mapSaving, setMapSaving] = useState(false);

  const handleSaveMapping = async (sku: EzadminItem, product: string, option: string) => {
    if (!product || !option) return;
    setMapSaving(true);
    try {
      const res = await fetch('/api/sku-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: product,
          option_name: option,
          easyadmin_product_code: sku.productCode,
          memo: `원본명: ${sku.productName}`,
        }),
      });
      if (res.ok) {
        showToast(`${sku.productCode} → ${product} / ${option} 매핑 완료`);
        setTimeout(() => window.location.reload(), 1000);
      } else {
        const err = await res.json();
        showToast(`매핑 실패: ${err.error || '알 수 없는 오류'}`);
      }
    } catch { showToast('매핑 저장 중 네트워크 오류'); }
    finally { setMapSaving(false); }
  };

  /* ---------------------------------------------------------------- */
  /*  Option-level rows for warehouse cards                            */
  /* ---------------------------------------------------------------- */

  const optionRows: OptionRow[] = useMemo(() => {
    const rows: OptionRow[] = [];
    for (const r of rocketItems) {
      if (r.product === '분류 필요') continue;
      if (r.unitStock === 0 && r.sales30d === 0) continue;
      const daysLeft30 = r.dailyAvg30 > 0 ? Math.floor(r.unitStock / r.dailyAvg30) : null;
      rows.push({
        product: r.product, option: r.option, vendorItemId: r.vendorItemId,
        unitStock: r.unitStock, daysLeft30, dailyAvg30: r.dailyAvg30, sales30d: r.sales30d,
        ezDomesticStock: 0,
        status: 'stable', actionLabel: '—', transferable: false,
      });
    }
    const ezByProduct = new Map<string, number>();
    for (const e of ezadminItems) {
      if (!e.mapped || e.stockType !== 'finished' || e.variantType !== 'domestic') continue;
      ezByProduct.set(e.product, (ezByProduct.get(e.product) ?? 0) + e.availableStock);
    }
    for (const row of rows) {
      row.ezDomesticStock = ezByProduct.get(row.product) ?? 0;
      row.transferable = row.ezDomesticStock >= row.sales30d && row.ezDomesticStock > 0;

      if (row.unitStock === 0 || row.daysLeft30 === 0) {
        row.status = 'critical';
        row.actionLabel = row.transferable ? '이관 등록' : '발주 등록';
      } else if (row.daysLeft30 !== null && row.daysLeft30 <= 14) {
        row.status = row.transferable ? 'transfer_ok' : 'shortage';
        row.actionLabel = row.transferable ? '이관 등록' : '발주 등록';
      } else if (row.daysLeft30 !== null && row.daysLeft30 <= 30) {
        row.status = 'warning';
        row.actionLabel = row.transferable ? '이관 준비' : '발주 검토';
      } else {
        row.status = 'stable';
        row.actionLabel = '—';
      }
    }
    return rows;
  }, [rocketItems, ezadminItems]);

  return (
    <AppShell showFilter={false}>
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">재고 / 입고</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* EZAdmin freshness */}
          <span
            title={ezadminFreshness.tooltip}
            style={{ fontSize: 12, fontWeight: 400, color: ezadminFreshness.color, cursor: 'default' }}
          >
            이지어드민: {ezadminFreshness.label}
          </span>
          {/* EZAdmin upload */}
          <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt,.xls,.xlsx"
            onChange={handleEzadminUpload} disabled={uploading} style={{ display: 'none' }} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              height: 36, padding: '0 14px', fontSize: 13, fontWeight: 500,
              background: uploading ? '#E4E8EC' : '#F2F4F7', color: uploading ? '#CDD2D8' : '#565D64',
              border: '1px solid #E4E8EC', borderRadius: 8, cursor: uploading ? 'default' : 'pointer',
            }}
          >
            {uploading ? '업로드 중...' : '이지어드민 업로드'}
          </button>
          {uploadResult && (
            <span style={{ fontSize: 12, color: uploadResult.ok ? '#86C9A8' : '#E8A0B4' }}>
              {uploadResult.message}
            </span>
          )}
          {/* Sync */}
          <button
            onClick={handleManualSync}
            disabled={syncing}
            style={{
              height: 36, padding: '0 14px', fontSize: 13, fontWeight: 500,
              background: syncing ? '#E4E8EC' : '#F2F4F7', color: syncing ? '#CDD2D8' : '#565D64',
              border: '1px solid #E4E8EC', borderRadius: 8, cursor: syncing ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span style={{ display: 'inline-block', animation: syncing ? 'spin 1s linear infinite' : 'none' }}>↻</span>
            {syncing ? '동기화 중...' : '쿠팡 동기화'}
          </button>
        </div>
      </div>

      {/* 1. 지금 할 일 — 요약 카운트 + 액션 목록 */}
      <div style={{ marginBottom: 16 }}>
        <TodaysTasks
          tasks={buildTasks(productSummaries, inboundRequests, ezadminItems, optionRows)}
          optionRows={optionRows}
          inboundRequests={inboundRequests}
          onInboundClick={(product, qty) => setPendingInboundCreate({ product, quantity: qty })}
          onOrderClick={() => document.getElementById('section-active')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          onScrollToSection={(id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
      </div>

      {/* 2. 재고 현황 — 통합 테이블 */}
      <div style={{ marginBottom: 16 }}>
        <InventoryTable
          rows={optionRows}
          onInboundClick={(product, qty) => setPendingInboundCreate({ product, quantity: qty })}
          onOrderClick={() => document.getElementById('section-active')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
      </div>

      {/* 3. 진행 중 */}
      <ActiveItemsSection
        inboundRequests={inboundRequests}
        orders={orders}
        onRefreshInbound={loadInboundRequests}
        onRefreshOrders={setOrders}
        leadTimes={leadTimes}
        pendingCreate={pendingInboundCreate}
        onPendingCreateConsumed={() => setPendingInboundCreate(null)}
        showToast={showToast}
      />

      {/* Unmapped SKU — collapsed */}
      <UnmappedSkuSection
        unmappedSkus={unmappedSkus}
        onSaveMapping={handleSaveMapping}
        mapSaving={mapSaving}
      />

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1F2328', color: '#fff', padding: '10px 20px', borderRadius: 8,
          fontSize: 13, fontWeight: 500, zIndex: 10000, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>{toast}</div>
      )}
    </AppShell>
  );
}
