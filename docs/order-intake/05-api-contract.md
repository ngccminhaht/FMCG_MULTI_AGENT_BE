# M1 — API Contract: Order Intake and Risk Validation

**Trạng thái:** Baseline `0.1.0` cho local MVP; production integration cần review riêng
**OpenAPI tương ứng:** [`order-intake.v1.yaml`](../../contracts/openapi/order-intake.v1.yaml)
**Rule/state source:** [`04-domain-rules-and-state-machine.md`](04-domain-rules-and-state-machine.md)
**Local implementation profile:** [`06-m1-local-baseline.md`](06-m1-local-baseline.md)

## 1. Mục đích và phạm vi

Contract này mô tả REST API public của vertical slice M1. Nó phục vụ App SFA tạo order, theo dõi order và nhận kết quả fraud async.

```text
In scope
- Tạo order an toàn trước retry/duplicate.
- Đọc danh sách và chi tiết order của chính sale đang đăng nhập.
- Hiển thị trạng thái PENDING_FRAUD_CHECK / APPROVED / REVIEW_REQUIRED / REJECTED.

Out of scope
- Login/identity provider implementation.
- Promotion/pricing quote, inventory, payment, delivery.
- Manual review decision API (M2).
- API để gọi fraud worker trực tiếp.
```

Fraud evaluator là luồng nội bộ: `POST /orders` tạo logical event `order.created.v1`; worker cập nhật state và assessment. App SFA không gọi endpoint đánh giá fraud.

## 2. Quy ước chung

| Hạng mục | Quy ước M1 |
|---|---|
| Base path | `/api/v1` |
| Media type | `application/json` |
| Auth local | `Authorization: Bearer dev-hung-001`, opaque token map server-side sang `HUNG-001`. |
| Auth production | `Authorization: Bearer <JWT>` qua SFA/identity adapter; issuer, audience và claim mapping chưa thuộc local baseline. |
| Ownership | Sale chỉ xem/tạo order của chính mình; order ngoài quyền sở hữu trả `404`. |
| Time | Timestamp dùng ISO 8601/RFC 3339 có timezone, ví dụ `2026-08-16T22:00:00+07:00`. Server lưu/so sánh thời gian chuẩn hóa UTC. |
| Money | `declared_total_amount_vnd` là integer VND dương, không dùng float. Đây là amount do SFA khai báo, chưa phải giá authoritative. |
| IDs | `order_id` là UUID server-generated; identifier từ SFA/retailer/SKU là string opaque. |
| Request ID | Server trả `X-Request-Id`; mọi lỗi application-level có `request_id`. |
| Extra fields | Request body không chấp nhận field ngoài contract. |

## 3. Authentication và authorization

### Local request authentication

```http
Authorization: Bearer dev-hung-001
```

Backend local map token sang `sales_rep_id = HUNG-001`. Client **không gửi** `sales_rep_id` trong `POST /orders`.

### Production replacement

Production sẽ dùng token do identity provider hoặc SFA gateway phát hành/validate. Server lấy tối thiểu `sales_rep_id` từ claim/context; request/response body và ownership rule không đổi khi thay adapter.

### Authorization rule

- Chỉ Sales Representative được dùng các endpoint trong contract này.
- Sale chỉ tạo order cho retailer active đang có assignment hợp lệ.
- Sale chỉ list/get order do chính sale tạo.
- Khi order tồn tại nhưng không thuộc caller, trả `404 ORDER_NOT_FOUND`, không trả `403`, để tránh lộ dữ liệu ngoài quyền.

## 4. Error envelope chuẩn

Mọi lỗi application-level dùng một envelope thống nhất:

```json
{
  "error": {
    "code": "RETAILER_NOT_ASSIGNED",
    "message": "The retailer is not assigned to the authenticated sales representative.",
    "details": [
      {
        "field": "retailer_id",
        "reason": "not_assigned"
      }
    ],
    "request_id": "01J0EXAMPLE"
  }
}
```

Schema chính thức trong [`order-intake.v1.yaml`](../../contracts/openapi/order-intake.v1.yaml) là nguồn chuẩn; implementation phải trả JSON hợp lệ với `request_id` là string.

Mã lỗi chính:

| HTTP | `error.code` | Khi nào |
|---:|---|---|
| 401 | `UNAUTHENTICATED` | Thiếu, sai hoặc hết hạn token. |
| 403 | `RETAILER_NOT_ASSIGNED` | Sale tạo order cho retailer không thuộc assignment. |
| 404 | `ORDER_NOT_FOUND` | Không có order hoặc order không thuộc caller. |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Cùng idempotency key nhưng payload khác. |
| 409 | `CLIENT_ORDER_ID_CONFLICT` | Cùng client order ID của cùng sale nhưng payload khác. |
| 422 | `VALIDATION_ERROR` | Body/header/query/path không đạt validation hoặc rule input. |
| 503 | `SERVICE_UNAVAILABLE` | Dependency bắt buộc cho tiếp nhận order không sẵn sàng. |
| 500 | `INTERNAL_ERROR` | Lỗi không được dự kiến; không trả stack trace. |

## 5. Idempotency và retry

`POST /api/v1/orders` yêu cầu cả hai giá trị:

1. Header `Idempotency-Key`: UUID đại diện cho một lần submit logic.
2. `client_order_id` trong body: identifier của order trên SFA để đối soát/sync.

| Tình huống | Hành vi |
|---|---|
| Submit lần đầu | Tạo một order, trả `202 Accepted`. |
| Retry cùng authenticated sale, cùng idempotency key và payload tương đương | Không tạo order mới; trả cùng `order_id`, header `Idempotency-Replayed: true`. |
| Cùng key nhưng payload khác | `409 IDEMPOTENCY_KEY_REUSED`. |
| Cùng `client_order_id` và payload khác | `409 CLIENT_ORDER_ID_CONFLICT`. |
| Client cần trạng thái mới nhất | Gọi `GET /api/v1/orders/{order_id}`. |

Idempotency key được giữ **24 giờ** trong local baseline và được điều khiển bằng `IDEMPOTENCY_TTL_HOURS`. Production phải xác nhận retention theo offline retry behavior của SFA trước khi thay đổi giá trị này.

## 6. Endpoint: tạo order

```http
POST /api/v1/orders
```

**Actor:** Sales Representative.  
**Use case:** UC-ORD-05.  
**Mục đích:** Tiếp nhận một order và khởi động fraud evaluation bất đồng bộ.

### Request headers

| Header | Bắt buộc | Ví dụ | Ghi chú |
|---|---:|---|---|
| `Authorization` | Có | `Bearer eyJ...` | Identity xác định sale. |
| `Idempotency-Key` | Có | `7fe0d16e-80f5-4b92-a5f9-dba0d5bc6754` | UUID mới cho mỗi logical submit. |
| `Content-Type` | Có | `application/json` | |

### Request body

```json
{
  "client_order_id": "SFA-HUNG-20260816-0001",
  "retailer_id": "CO-LAN-001",
  "order_time": "2026-08-16T22:00:00+07:00",
  "items": [
    {
      "product_sku": "SKU-NUOC-NGOT-001",
      "quantity": 10
    }
  ],
  "declared_total_amount_vnd": 150000
}
```

| Field | Bắt buộc | Rule |
|---|---:|---|
| `client_order_id` | Có | String 1–100 ký tự, unique theo sales rep. |
| `retailer_id` | Có | Retailer phải active và thuộc assignment của caller. |
| `order_time` | Có | Date-time có timezone; không quá 5 phút trong tương lai. |
| `items` | Có | Mảng ít nhất một item; không trùng `product_sku`. |
| `items[].product_sku` | Có | SKU active/được phép bán. |
| `items[].quantity` | Có | Integer lớn hơn 0. |
| `declared_total_amount_vnd` | Có | Integer VND lớn hơn 0. |

`promotion_code`, `unit_price`, GPS/device metadata và `sales_rep_id` không thuộc request body M1.

### Response `202 Accepted`

Order đã được persisted và đang chờ fraud worker. `202` **không** có nghĩa là order đã approved.

```http
HTTP/1.1 202 Accepted
Location: /api/v1/orders/046c8f66-1707-4455-b30e-8bd01b98da27
Idempotency-Replayed: false
```

```json
{
  "order_id": "046c8f66-1707-4455-b30e-8bd01b98da27",
  "client_order_id": "SFA-HUNG-20260816-0001",
  "status": "PENDING_FRAUD_CHECK",
  "created_at": "2026-08-16T15:00:02Z",
  "updated_at": "2026-08-16T15:00:02Z",
  "fraud_assessment": null
}
```

### Error scenarios

| HTTP | Ví dụ |
|---:|---|
| 401 | Token thiếu/invalid. |
| 403 | `retailer_id` không thuộc assignment của sale. |
| 409 | Reuse idempotency key hoặc client order ID với payload khác. |
| 422 | Thiếu item, item trùng SKU, quantity không hợp lệ, timestamp sai timezone/ở quá xa tương lai. |
| 503 | Không thể bảo đảm persistence/event handoff bắt buộc. |

## 7. Endpoint: lấy chi tiết order và fraud status

```http
GET /api/v1/orders/{order_id}
```

**Actor:** Sales Representative.  
**Use case:** UC-ORD-06.  
**Mục đích:** Client poll hoặc refresh để lấy trạng thái mới nhất của order và fraud assessment gần nhất.

### Response `200 OK` khi assessment đã hoàn thành

```json
{
  "order_id": "046c8f66-1707-4455-b30e-8bd01b98da27",
  "client_order_id": "SFA-HUNG-20260816-0001",
  "sales_rep_id": "HUNG-001",
  "retailer_id": "CO-LAN-001",
  "order_time": "2026-08-16T15:00:00Z",
  "items": [
    {
      "product_sku": "SKU-NUOC-NGOT-001",
      "quantity": 10
    }
  ],
  "declared_total_amount_vnd": 150000,
  "status": "APPROVED",
  "created_at": "2026-08-16T15:00:02Z",
  "updated_at": "2026-08-16T15:00:07Z",
  "fraud_assessment": {
    "risk_score": 15,
    "decision": "APPROVED",
    "reason_codes": [
      "MOCK_LOW_RISK"
    ],
    "evaluator_type": "mock_rule_engine",
    "evaluator_version": "m1-0.1",
    "assessed_at": "2026-08-16T15:00:07Z"
  }
}
```

Khi `status` là `PENDING_FRAUD_CHECK`, `fraud_assessment` là `null`. Khi worker lỗi hết retry, status là `REVIEW_REQUIRED` và assessment/reason code phải thể hiện `FRAUD_EVALUATION_UNAVAILABLE`.

### Error scenarios

| HTTP | Ví dụ |
|---:|---|
| 401 | Token thiếu/invalid. |
| 404 | Order không tồn tại hoặc không thuộc sale đang gọi. |

## 8. Endpoint: list order của sale

```http
GET /api/v1/orders?status=PENDING_FRAUD_CHECK&retailer_id=CO-LAN-001&page=1&page_size=20
```

**Actor:** Sales Representative.  
**Use case:** UC-ORD-06.  
**Mục đích:** Hiển thị danh sách order của caller; không trả data của sale khác.

### Query parameters

| Parameter | Bắt buộc | Default | Rule |
|---|---:|---:|---|
| `status` | Không | — | Một trạng thái order hợp lệ. |
| `retailer_id` | Không | — | Chỉ filter trong tập order của caller. |
| `page` | Không | `1` | Integer >= 1. |
| `page_size` | Không | `20` | Integer 1–100. |

### Response `200 OK`

```json
{
  "items": [
    {
      "order_id": "046c8f66-1707-4455-b30e-8bd01b98da27",
      "client_order_id": "SFA-HUNG-20260816-0001",
      "retailer_id": "CO-LAN-001",
      "declared_total_amount_vnd": 150000,
      "status": "PENDING_FRAUD_CHECK",
      "order_time": "2026-08-16T15:00:00Z",
      "updated_at": "2026-08-16T15:00:02Z"
    }
  ],
  "page": 1,
  "page_size": 20,
  "total_items": 1,
  "total_pages": 1
}
```

Default sort là `created_at` giảm dần. Sorting field chưa công bố vì chưa phải nhu cầu M1.

## 9. Contract traceability

| Contract capability | Use case/rule tham chiếu |
|---|---|
| `POST /orders` | UC-ORD-05, BR-ORD-001…008, BR-IDEM-001…005 |
| `GET /orders/{id}` | UC-ORD-06, BR-AUTH-003 |
| `GET /orders` | UC-ORD-06, BR-AUTH-003 |
| Async `202` + status | UC-FRD-01, BR-FRD-001…006 |
| Fraud summary | UC-FRD-02, state machine M1 |

## 10. Preconditions để baseline contract

Không gọi contract này là **Approved** cho tới khi các item sau được xác nhận:

1. Source và claim name của identity/SFA token.
2. Source of truth/availability cho retailer assignment và product active status.
3. Idempotency retention phù hợp với offline retry behavior.
4. Quy tắc final khi fraud worker không khả dụng (`REVIEW_REQUIRED` được đề xuất).
5. Currency and pricing decision: field VND declared amount có tương thích SFA không.
6. Permission, SLA và UX copy cho `REVIEW_REQUIRED`.
7. Data privacy/retention trước khi thêm GPS/device data.

Sau baseline, [`order-intake.v1.yaml`](../../contracts/openapi/order-intake.v1.yaml) là nguồn machine-readable để mobile app generate/mock client, service viết contract test và QA sinh test matrix.
