import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/ezadmin/upload
 * Accepts CSV or HTML-table .xls file (multipart/form-data) with EZAdmin inventory data.
 * Expected columns: 상품코드, 상품명, 정상재고, 배송, 입고, 출고
 * Upserts into ezadmin_inventory table on product_code.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: '파일이 필요합니다 (CSV 또는 XLS)' }, { status: 400 });
    }

    const text = await file.text();

    // Detect format: HTML-table .xls or plain CSV/TSV
    const isHtml = text.trimStart().startsWith('<') || text.includes('<table');
    const parsedRows = isHtml ? parseHtmlTable(text) : parseCsvText(text);

    if (parsedRows.length === 0) {
      return NextResponse.json({ error: '유효한 데이터가 없습니다' }, { status: 400 });
    }

    // Get headers from first row
    const header = parsedRows[0].map(h => h.trim().toLowerCase());
    const colMap = resolveColumns(header);

    if (colMap.product_code < 0 || colMap.product_name < 0) {
      return NextResponse.json({
        error: '필수 컬럼을 찾을 수 없습니다 (상품코드, 상품명)',
        columns_found: header,
      }, { status: 400 });
    }

    const now = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];
    const errors: string[] = [];

    for (let i = 1; i < parsedRows.length; i++) {
      const cols = parsedRows[i];
      if (cols.length < 2) continue;

      const productCode = cols[colMap.product_code]?.trim();
      const productName = cols[colMap.product_name]?.trim();

      if (!productCode || !productName) {
        errors.push(`행 ${i + 1}: 상품코드 또는 상품명이 비어있습니다`);
        continue;
      }

      const normalStock = safeInt(cols[colMap.normal_stock]);
      const availableStock = colMap.available_stock >= 0 ? safeInt(cols[colMap.available_stock]) : normalStock;

      rows.push({
        product_code: productCode,
        product_name: productName,
        normal_stock: normalStock,
        defective_stock: safeInt(cols[colMap.defective_stock]),
        available_stock: availableStock,
        shipping: safeInt(cols[colMap.shipping]),
        incoming: safeInt(cols[colMap.incoming]),
        updated_at: now,
      });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: '유효한 데이터가 없습니다', parse_errors: errors }, { status: 400 });
    }

    // Upsert in batches
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await supabaseAdmin
        .from('ezadmin_inventory')
        .upsert(batch, {
          onConflict: 'product_code',
          ignoreDuplicates: false,
        });

      if (error) {
        return NextResponse.json({
          error: `업로드 실패 (행 ${i + 1}~${i + batch.length}): ${error.message}`,
          upserted_so_far: upserted,
          failed_at_row: i + 1,
        }, { status: 500 });
      }
      upserted += batch.length;
    }

    return NextResponse.json({
      ok: true,
      total_rows: rows.length,
      upserted,
      format: isHtml ? 'html_table' : 'csv',
      parse_errors: errors.length > 0 ? errors : undefined,
      updated_at: now,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '서버 오류' },
      { status: 500 },
    );
  }
}

/* ------------------------------------------------------------------ */
/*  HTML table parser (EZAdmin .xls format)                            */
/* ------------------------------------------------------------------ */

function parseHtmlTable(html: string): string[][] {
  const rows: string[][] = [];

  // Find all <tr> blocks
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowHtml = trMatch[1];
    const cells: string[] = [];

    // Find all <td> or <th> blocks
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      // Strip HTML tags and decode entities
      const cellText = cellMatch[1]
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim();
      cells.push(cellText);
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/*  CSV/TSV parser                                                     */
/* ------------------------------------------------------------------ */

function parseCsvText(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  return lines.map(parseCSVLine);
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',' || ch === '\t') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

function safeInt(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.replace(/[,\s]/g, '');
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? 0 : n;
}

interface ColumnMap {
  product_code: number;
  product_name: number;
  normal_stock: number;
  defective_stock: number;
  available_stock: number;
  shipping: number;
  incoming: number;
}

function resolveColumns(header: string[]): ColumnMap {
  const find = (candidates: string[]): number => {
    for (const c of candidates) {
      const idx = header.findIndex(h => h.includes(c));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  return {
    product_code: find(['상품코드', 'product_code', 'productcode', 'sku', '코드']),
    product_name: find(['상품명', 'product_name', 'productname', '품명']),
    normal_stock: find(['정상재고', 'normal_stock', 'normalstock', '정상']),
    defective_stock: find(['불량재고', 'defective_stock', 'defectivestock', '불량']),
    available_stock: find(['판매가능재고', 'available_stock', 'availablestock', '판매가능', '가용재고']),
    shipping: find(['배송', '출고중', 'shipping', '출고']),
    incoming: find(['입고예정', 'incoming', '입고']),
  };
}
