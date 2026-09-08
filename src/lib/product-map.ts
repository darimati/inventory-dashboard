/**
 * HEEDA 공통 상품 매핑
 *
 * 각 채널의 원본 상품 ID를 공통 제품·옵션으로 변환한다.
 * 매핑이 확인되지 않은 상품은 '분류 필요'로 표시하되 매출에서 제외하지 않는다.
 */

export interface ProductDef {
  product: string;       // 공통 제품명: 클렌징밤, 클렌징폼, 세럼
  option: string;        // 옵션명: 단품, 2개 세트, ...
  unitCount: number;     // 세트당 낱개 수
  spec: string;          // 규격: 100ml, 150ml, 30ml
}

export type EzadminVariant = 'domestic' | 'japan' | 'export';

export interface EzadminProductDef extends ProductDef {
  variant?: '수출용';         // Legacy: 수출용이면 설정, 국내용이면 undefined
  variantType?: EzadminVariant; // New: domestic / japan / export
  stockType?: '부자재';       // 부자재이면 설정, 완제품이면 undefined
  note?: string;              // 비고
}

// 쿠팡 vendor_item_id → 공통 상품 매핑
const COUPANG_MAP: Record<string, ProductDef> = {
  // 클렌징밤
  '90554556327': { product: '클렌징밤', option: '단품', unitCount: 1, spec: '100ml' },
  '90621781347': { product: '클렌징밤', option: '단품', unitCount: 1, spec: '100ml' },
  '94426583769': { product: '클렌징밤', option: '단품', unitCount: 1, spec: '100ml' },
  '93924698351': { product: '클렌징밤', option: '2개 세트', unitCount: 2, spec: '100ml' },
  '93924698352': { product: '클렌징밤', option: '3개 세트', unitCount: 3, spec: '100ml' },
  '91329716230': { product: '클렌징밤', option: '4개 세트', unitCount: 4, spec: '100ml' },

  // 클렌징폼
  '91007861343': { product: '클렌징폼', option: '단품', unitCount: 1, spec: '150ml' },
  '92197095172': { product: '클렌징폼', option: '단품', unitCount: 1, spec: '150ml' },
  '91007763848': { product: '클렌징폼', option: '단품', unitCount: 1, spec: '150ml' },
  '93943745189': { product: '클렌징폼', option: '2개 세트', unitCount: 2, spec: '150ml' },
  '91541164600': { product: '클렌징폼', option: '2개 세트', unitCount: 2, spec: '150ml' },
  '93943745188': { product: '클렌징폼', option: '3개 세트', unitCount: 3, spec: '150ml' },
  '91541180389': { product: '클렌징폼', option: '3개 세트', unitCount: 3, spec: '150ml' },

  // 세럼
  '93993063704': { product: '세럼', option: '단품', unitCount: 1, spec: '30ml' },
};

// 이지어드민 product_code → 공통 상품 매핑 (기본값, 설정으로 오버라이드 가능)
export const EZADMIN_MAP: Record<string, EzadminProductDef> = {
  '17828': { product: '클렌징밤', option: '국내용', unitCount: 1, spec: '100ml', variantType: 'domestic' },
  '18396': { product: '클렌징밤', option: '수출용', unitCount: 1, spec: '100ml', variant: '수출용', variantType: 'export' },
  '19295': { product: '클렌징밤', option: '수출용 [스티커작업]', unitCount: 1, spec: '100ml', variant: '수출용', variantType: 'export', stockType: '부자재', note: '작업 대기' },
  '18279': { product: '클렌징폼', option: '국내용', unitCount: 1, spec: '150ml', variantType: 'domestic', note: '라벨 미부착' },
  '19309': { product: '클렌징폼', option: '일본향', unitCount: 1, spec: '150ml', variantType: 'japan', note: '일본어 덧방라벨 부착 완료' },
  '18280': { product: '클렌징폼', option: '수출용', unitCount: 1, spec: '150ml', variant: '수출용', variantType: 'export' },
  '18262': { product: '클렌징폼', option: '튜브용기/캡', unitCount: 1, spec: '150ml', stockType: '부자재' },
  '18918': { product: '세럼', option: '국내용', unitCount: 1, spec: '30ml', variantType: 'domestic' },
  '18919': { product: '세럼', option: '수출용', unitCount: 1, spec: '30ml', variant: '수출용', variantType: 'export' },
  '19294': { product: '세럼', option: '수출용 [스티커작업]', unitCount: 1, spec: '30ml', variant: '수출용', variantType: 'export', stockType: '부자재', note: '작업 대기' },
  '18275': { product: '모공브러쉬', option: '국내용', unitCount: 1, spec: '', variantType: 'domestic' },
  '18498': { product: '모공브러쉬', option: '수출용', unitCount: 1, spec: '', variant: '수출용', variantType: 'export' },
  '18811': { product: '숯 클렌징 듀오 세트', option: '세트', unitCount: 1, spec: '', variantType: 'domestic' },
};

/** Non-HEEDA brand product codes — excluded from inventory counts */
export const EZADMIN_EXCLUDE: Set<string> = new Set([
  // 슈퍼랩스
  'S14225', 'S14226', 'S14227', 'S14228', 'S14229', 'S14230',
  'S14231', 'S14232', 'S14233', 'S14234', 'S14235', 'S14236',
  // 다리매거진
  '19026',
  // 마야크루 박스
  '18542',
]);

/** Per-product chart/UI colors */
export const PRODUCT_COLORS: Record<string, string> = {
  '클렌징밤': '#9DC3E6',
  '클렌징폼': '#7FCDBB',
  '세럼': '#F2A0A0',
};

export function resolveCoupangProduct(vendorItemId: string | number): ProductDef | null {
  return COUPANG_MAP[String(vendorItemId)] ?? null;
}

/** SKU classification override from settings */
export interface SkuClassification {
  productCode: string;
  product: string;
  option: string;
  stockType: 'finished' | 'submaterial';
  variantType: EzadminVariant;
  note?: string;
}

export function resolveEzadminProduct(
  productCode: string,
  overrides?: Record<string, SkuClassification>,
): EzadminProductDef | null {
  const override = overrides?.[productCode];
  const base = EZADMIN_MAP[productCode];

  if (override) {
    return {
      product: override.product,
      option: override.option,
      unitCount: base?.unitCount ?? 1,
      spec: base?.spec ?? '',
      variant: override.variantType === 'export' ? '수출용' : undefined,
      variantType: override.variantType,
      stockType: override.stockType === 'submaterial' ? '부자재' : undefined,
      note: override.note,
    };
  }

  return base ?? null;
}

/** Check if product code is a main product (클렌징밤/클렌징폼/세럼) */
export function isMainProduct(product: string): boolean {
  return PRODUCT_ORDER.includes(product as any);
}

/**
 * 원본 상품명에서 공통 제품명·옵션을 추론 (매핑 실패 시 fallback)
 */
export function inferProduct(rawName: string): ProductDef {
  const lower = rawName.toLowerCase();

  if (lower.includes('세럼') || lower.includes('미백')) {
    return { product: '세럼', option: '단품', unitCount: 1, spec: '30ml' };
  }

  if (lower.includes('클렌징밤') || lower.includes('클렌징 밤')) {
    const setMatch = rawName.match(/(\d)개\s*set/);
    const qtyMatch = rawName.match(/(\d)개$/);
    if (setMatch) {
      const n = parseInt(setMatch[1]);
      return { product: '클렌징밤', option: `${n}개 세트`, unitCount: n, spec: '100ml' };
    }
    if (qtyMatch) {
      const n = parseInt(qtyMatch[1]);
      if (n > 1) return { product: '클렌징밤', option: `${n}개 세트`, unitCount: n, spec: '100ml' };
    }
    return { product: '클렌징밤', option: '단품', unitCount: 1, spec: '100ml' };
  }

  if (lower.includes('클렌징폼') || lower.includes('클렌징 폼') || lower.includes('폼클렌징')) {
    const setMatch = rawName.match(/(\d)개\s*set/);
    const qtyMatch = rawName.match(/(\d)개$/);
    if (setMatch) {
      const n = parseInt(setMatch[1]);
      return { product: '클렌징폼', option: `${n}개 세트`, unitCount: n, spec: '150ml' };
    }
    if (qtyMatch) {
      const n = parseInt(qtyMatch[1]);
      if (n > 1) return { product: '클렌징폼', option: `${n}개 세트`, unitCount: n, spec: '150ml' };
    }
    return { product: '클렌징폼', option: '단품', unitCount: 1, spec: '150ml' };
  }

  return { product: '분류 필요', option: rawName, unitCount: 1, spec: '' };
}

/**
 * 제품명 표시 형식: "클렌징밤 · 단품" 또는 "클렌징폼 · 2개 세트"
 */
export function formatProductOption(def: ProductDef): string {
  return `${def.product} · ${def.option}`;
}

/**
 * 공통 제품 목록 (정렬 순서)
 */
export const PRODUCT_ORDER = ['클렌징밤', '클렌징폼', '세럼'] as const;

export function productSortKey(product: string): number {
  const idx = PRODUCT_ORDER.indexOf(product as any);
  return idx >= 0 ? idx : 999;
}
