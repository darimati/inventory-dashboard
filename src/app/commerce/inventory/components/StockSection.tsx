'use client';

import React, { useState } from 'react';
import { formatNumber } from '@/lib/helpers';
import { InboundDropdown } from './InboundDropdown';
import type { EzadminItem } from '../types';

/* ------------------------------------------------------------------ */
/*  UnmappedSkuSection — collapsed section for unmapped SKUs            */
/* ------------------------------------------------------------------ */

const numS: React.CSSProperties = { fontSize: 13, fontVariantNumeric: 'tabular-nums', textAlign: 'right' as const, whiteSpace: 'nowrap' };

export function UnmappedSkuSection({
  unmappedSkus, onSaveMapping, mapSaving,
}: {
  unmappedSkus: EzadminItem[];
  onSaveMapping: (sku: EzadminItem, product: string, option: string) => void;
  mapSaving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mappingCode, setMappingCode] = useState<string | null>(null);
  const [mapProduct, setMapProduct] = useState('클렌징밤');
  const [mapOption, setMapOption] = useState('');

  const productOptions = [
    { value: '클렌징밤', label: '클렌징밤' },
    { value: '클렌징폼', label: '클렌징폼' },
    { value: '세럼', label: '세럼' },
    { value: '모공브러쉬', label: '모공브러쉬' },
    { value: '숯 클렌징 듀오 세트', label: '듀오 세트' },
  ];

  if (unmappedSkus.length === 0) return null;

  return (
    <div className="section" id="section-unmapped">
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: 500, color: '#565D64', textAlign: 'left',
        }}
      >
        <span style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', color: '#6E767E' }}>▸</span>
        미매핑 SKU
        <span style={{ fontWeight: 400, fontSize: 12, color: '#8FAEE0', marginLeft: 4 }}>
          {unmappedSkus.length}건
        </span>
        <span style={{ fontWeight: 400, fontSize: 12, color: '#6E767E', marginLeft: 4 }}>
          / 총 {formatNumber(unmappedSkus.reduce((sum, e) => sum + e.availableStock, 0))}개 재고
        </span>
      </button>

      {open && (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th>상품명</th>
                <th style={{ width: 100 }}>상품코드</th>
                <th className="right" style={{ width: 60 }}>재고</th>
                <th style={{ width: 60 }}>구분</th>
                <th style={{ width: 240 }}>매핑</th>
              </tr>
            </thead>
            <tbody>
              {unmappedSkus.map(sku => (
                <React.Fragment key={sku.productCode}>
                  <tr>
                    <td style={{ fontWeight: 500, color: '#1F2328' }}>{sku.productName}</td>
                    <td style={{ fontSize: 12, color: '#9AA2AA' }}>{sku.productCode}</td>
                    <td style={{ ...numS }}>{formatNumber(sku.availableStock)}</td>
                    <td style={{ fontSize: 12, color: '#9AA2AA' }}>
                      {sku.variantType === 'domestic' ? '국내' : sku.variantType === 'japan' ? '일본' : '수출'}
                    </td>
                    <td>
                      {mappingCode === sku.productCode ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <div style={{ width: 100 }}>
                            <InboundDropdown
                              options={productOptions}
                              value={mapProduct}
                              onChange={setMapProduct}
                              placeholder="제품"
                            />
                          </div>
                          <input
                            value={mapOption}
                            onChange={e => setMapOption(e.target.value)}
                            placeholder="옵션명"
                            style={{
                              padding: '0 10px', fontSize: 13, border: '1px solid #E4E8EC',
                              borderRadius: 8, background: '#fff', outline: 'none', width: 100,
                              height: 36, boxSizing: 'border-box',
                            }}
                          />
                          <button
                            onClick={() => { onSaveMapping(sku, mapProduct, mapOption); setMappingCode(null); }}
                            disabled={!mapOption || mapSaving}
                            style={{
                              padding: '0 14px', fontSize: 13, fontWeight: 600, height: 36,
                              background: (!mapOption || mapSaving) ? '#E4E8EC' : '#1A1D21',
                              color: (!mapOption || mapSaving) ? '#CDD2D8' : '#fff',
                              border: 'none', borderRadius: 8, cursor: (!mapOption || mapSaving) ? 'default' : 'pointer',
                            }}
                          >
                            {mapSaving ? '...' : '저장'}
                          </button>
                          <button
                            onClick={() => setMappingCode(null)}
                            style={{
                              padding: '0 10px', fontSize: 13, height: 36,
                              background: 'none', color: '#6E767E',
                              border: '1px solid #E4E8EC', borderRadius: 8, cursor: 'pointer',
                            }}
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setMappingCode(sku.productCode); setMapProduct('클렌징밤'); setMapOption(''); }}
                          style={{
                            padding: '0 10px', fontSize: 12, fontWeight: 500, height: 32,
                            background: 'none', color: '#0969DA',
                            border: '1px solid #E4E8EC', borderRadius: 8, cursor: 'pointer',
                          }}
                        >
                          매핑
                        </button>
                      )}
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
