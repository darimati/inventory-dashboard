# 쿠팡 개발자센터 문의 — RG 실결제 금액 API 요청

## 문의 요약

로켓그로스(RG) 상품의 **실결제 금액**(쿠팡 할인쿠폰 적용 후 금액)을 조회할 수 있는 API가 필요합니다.
현재 사용 가능한 RG Order API는 `unitSalesPrice`(정가)만 반환하며, 고객이 실제 결제한 금액을 알 수 없습니다.

---

## 현재 상황

### 사용 중인 API

**1. RG Order API** (HEEDA 주문 조회용)
- 엔드포인트: `GET /v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/orders`
- 파라미터: `paidDateFrom`, `paidDateTo` (YYYYMMDD)
- 반환 필드: `orderId`, `paidAt`, `orderItems[].vendorItemId`, `orderItems[].productName`, `orderItems[].unitSalesPrice`, `orderItems[].salesQuantity`, `orderItems[].currency`
- **문제**: `unitSalesPrice`는 카탈로그 정가이며, 쿠팡 할인쿠폰 적용 후 실결제 금액이 아님

**2. Revenue-History API** (SUPERLABS/판매자배송 전용)
- 엔드포인트: `GET /v2/providers/openapi/apis/api/v1/revenue-history`
- 파라미터: `vendorId`, `recognitionDateFrom`, `recognitionDateTo`, `token`, `maxPerPage`
- 반환 필드: `salePrice`, `settlementAmount`, `coupangDiscountCoupon` 등
- **문제**: 로켓그로스(RG) 상품은 이 API에서 조회 불가 (0건 반환)

### 확인된 사실
- 당사 벤더 ID: `A00429105`
- HEEDA 브랜드 = 로켓그로스(RG) 상품
- SUPERLABS 브랜드 = 판매자배송 상품
- Revenue-History API FAQ: "로켓그로스 상품은 지원하지 않습니다"
- RG Order API는 정상 작동하나 `unitSalesPrice`만 제공

---

## 요청/응답 로그

### RG Order API 요청 (정상 동작)

```
GET https://api-gateway.coupang.com/v2/providers/rg_open_api/apis/api/v1/vendors/A00429105/rg/orders?paidDateFrom=20260801&paidDateTo=20260815
Authorization: CEA algorithm=HmacSHA256, access-key=a6b4fb97-..., signed-date=260901T..., signature=...
Content-type: application/json;charset=UTF-8
```

응답 (200 OK):
```json
{
  "message": "SUCCESS",
  "data": [
    {
      "vendorId": "A00429105",
      "orderId": 30054xxxxx,
      "paidAt": 1722xxxxxxxxx,
      "orderItems": [
        {
          "vendorItemId": "90554556327",
          "productName": "[희다] 클렌징밤 ...",
          "salesQuantity": 1,
          "unitSalesPrice": "12900",
          "currency": "KRW"
        }
      ]
    }
  ],
  "nextToken": "..."
}
```

**반환 필드에 `unitSalesPrice`만 있고, 실결제 금액/할인쿠폰/정산 금액 필드 없음**

### Revenue-History API 요청 (RG 상품 미지원 확인)

```
GET https://api-gateway.coupang.com/v2/providers/openapi/apis/api/v1/revenue-history?vendorId=A00429105&recognitionDateFrom=2026-08-01&recognitionDateTo=2026-08-15&token=&maxPerPage=50
Authorization: CEA algorithm=HmacSHA256, ...
```

응답 (200 OK):
```json
{
  "code": "200",
  "message": "SUCCESS",
  "data": [
    {
      "orderId": "30059xxxxx",
      "items": [
        {
          "vendorItemId": "91007765866",
          "productName": "[SUPERLABS] ...",
          "salePrice": 31900,
          "settlementAmount": 25520,
          "coupangDiscountCoupon": 0
        }
      ]
    }
  ]
}
```

**판매자배송(SUPERLABS) 상품만 조회됨. HEEDA(RG) 상품 vendorItemId는 결과에 없음.**

### Settlement-Histories API (벤더 단위 합산)

```
GET https://api-gateway.coupang.com/v2/providers/marketplace_openapi/apis/api/v1/settlement-histories?revenueRecognitionYearMonth=2026-08
```

**벤더 전체 합산 금액만 제공. 브랜드/상품별 구분 불가.**

---

## 요청 사항

로켓그로스(RG) 상품에 대해 다음 중 하나를 제공해주시기 바랍니다:

1. **RG Order API 응답에 실결제 금액 필드 추가** — `actualPaymentAmount`, `coupangDiscountCoupon` 등
2. **RG 전용 정산/매출인식 API** — Revenue-History와 유사하지만 RG 상품을 지원하는 별도 API
3. **Revenue-History API에서 RG 상품 지원** — 기존 API의 RG 상품 포함

현재 `unitSalesPrice`(정가)로만 매출을 추적하고 있어, 쿠팡 할인쿠폰이 적용된 실제 고객 결제 금액과 차이가 발생합니다.

---

## 관련 vendorItemId 목록

| vendorItemId | 상품명 |
|---|---|
| 90554556327 | 희다 클렌징밤 |
| 90621781347 | 희다 클렌징밤 (변형) |
| 94426583769 | 희다 제품 |
| 93924698351 | 희다 제품 |
| 93924698352 | 희다 제품 |
| 91329716230 | 희다 제품 |
| 91007861343 | 희다 제품 |
| 92197095172 | 희다 제품 |
| 91007763848 | 희다 제품 |
| 93943745189 | 희다 제품 |
| 91541164600 | 희다 제품 |
| 93943745188 | 희다 제품 |
| 91541180389 | 희다 제품 |
| 93993063704 | 희다 제품 |

---

*작성일: 2026-09-01*
