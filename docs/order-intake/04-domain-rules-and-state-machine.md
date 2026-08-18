# M1 — Domain rules, state machine và decision log

**Trạng thái:** Baseline cho local MVP; các quyết định production vẫn cần review
**MVP:** Order Intake and Risk Validation
**Phạm vi:** Sale gửi một đơn cho retailer hợp lệ; hệ thống lưu đơn bền vững, đánh giá risk bất đồng bộ bằng mock/rule engine và cho phép client đọc trạng thái.
**Local decision profile:** [06-m1-local-baseline.md](06-m1-local-baseline.md) là quyết định có hiệu lực cho implementation demo/local.

## 1. Mục tiêu và ranh giới M1

### Mục tiêu

M1 chứng minh luồng giá trị tối thiểu sau:

```text
App SFA → tiếp nhận đơn không trùng → lưu bền vững → đánh giá fraud async
→ cập nhật trạng thái → SFA đọc được kết quả
```

### In scope

- Sales Representative tạo order cho retailer được phân công.
- Validate request cơ bản, quyền sở hữu retailer và idempotency.
- Lưu `Order`, `OrderItem`, lịch sử trạng thái và fraud assessment.
- Sinh logical event `order.created.v1`.
- Fraud worker mock/rule-based xử lý event.
- Client lấy chi tiết và trạng thái order.
- Audit/log cơ bản cho các chuyển trạng thái.

### Out of scope

- SFA login screen hoặc identity provider thật; M1 chỉ định contract cho authenticated request.
- Promotion/pricing engine đầy đủ, quote API, tồn kho, thanh toán và giao hàng.
- LLM/ML fraud model production.
- Supervisor quyết định sau review; đây là M2.
- GPS/device metadata cho fraud; chỉ thêm sau privacy review.
- Forecast demand, weather và local-event integration.

## 2. Ubiquitous language

| Thuật ngữ | Định nghĩa trong M1 |
|---|---|
| **Sales Representative** | Nhân viên sale đã xác thực; `sales_rep_id` được backend lấy từ identity claim, không tin dữ liệu do client tự gửi. |
| **Retailer** | Cửa hàng bán lẻ nhận đơn. Sale chỉ được tạo order cho retailer đang active và thuộc assignment của mình. |
| **Order** | Yêu cầu mua hàng do SFA gửi, có order ID của server và `client_order_id` để đối soát với SFA. |
| **Order Item** | Một SKU và số lượng dương trong order. Cùng một SKU chỉ xuất hiện một lần trong order M1. |
| **Idempotency key** | UUID do client tạo cho một lần submit logic; retry cùng key không tạo order mới. |
| **Fraud assessment** | Kết quả một lần đánh giá risk, gồm score, decision, reason codes, evaluator version và thời điểm đánh giá. |
| **Declared total** | Tổng tiền VND do SFA khai báo. M1 lưu/validate định dạng nhưng chưa coi là kết quả tính giá authoritative. |
| **Received at** | Thời điểm backend nhận request; khác với `order_time` do client ghi nhận. |

## 3. Mô hình dữ liệu tối thiểu cần có

Đây là mô hình logic để đối chiếu ERD/physical schema hiện có trước khi tạo migration. Tên bảng/cột không bị khóa bởi tài liệu này.

| Aggregate/record | Trường tối thiểu | Ghi chú |
|---|---|---|
| `Order` | `id`, `client_order_id`, `sales_rep_id`, `retailer_id`, `order_time`, `received_at`, `declared_total_amount_vnd`, `status`, `created_at`, `updated_at` | Có unique constraint tối thiểu cho sales rep + client order ID. |
| `OrderItem` | `id`, `order_id`, `product_sku`, `quantity` | Unique `order_id + product_sku` trong M1. |
| `FraudAssessment` | `id`, `order_id`, `risk_score`, `decision`, `reason_codes`, `evaluator_type`, `evaluator_version`, `assessed_at` | M1 có thể chỉ lấy assessment mới nhất để hiển thị, nhưng lịch sử không được mất. |
| `OrderStatusHistory` | `id`, `order_id`, `from_status`, `to_status`, `reason_code`, `changed_at`, `actor_type` | Phục vụ audit/debug. |
| `IdempotencyRecord` | `key`, `sales_rep_id`, `request_fingerprint`, `order_id`, `created_at`, `expires_at` | Key dùng để xử lý retry an toàn. |
| `OutboxEvent` | `id`, `event_type`, `aggregate_id`, `payload`, `occurred_at`, `published_at`, `attempt_count` | Mục tiêu triển khai M1 là outbox hoặc cơ chế tương đương để không mất event khi ghi order thành công. |

Master data `Retailer`, `Product` và `SalesRetailerAssignment` có thể là bảng local, API adapter hoặc fixture kiểm soát được trong M1. Nhưng contract phải giữ nguyên rule: không cho tạo order nếu retailer/product/assignment không hợp lệ.

## 4. State machine của Order

### 4.1 Trạng thái M1

| Status | Ý nghĩa | Client nên hiển thị |
|---|---|---|
| `PENDING_FRAUD_CHECK` | Order đã được nhận/lưu; fraud worker chưa hoàn thành hoặc đang retry. | Đang kiểm tra đơn hàng. |
| `APPROVED` | Fraud evaluation cho phép xử lý order tiếp. | Đơn đã được chấp nhận. |
| `REVIEW_REQUIRED` | Có rủi ro hoặc fraud worker không thể cho kết quả an toàn; cần supervisor xử lý ở M2. | Đơn cần được kiểm tra thêm. |
| `REJECTED` | Fraud evaluation từ chối order theo rule được phép áp dụng. | Đơn bị từ chối. |

`DRAFT`, `CANCELLED`, fulfillment/delivery status không thuộc M1. Client SFA có thể tự lưu nháp cục bộ; backend không nhận DRAFT trong contract này.

### 4.2 Chuyển trạng thái hợp lệ

```text
                         fraud decision = APPROVE
                 ┌──────────────────────────────────────→ APPROVED
                 │
PENDING_FRAUD_CHECK
                 │
                 ├── fraud decision = REVIEW / worker exhausted retries ─→ REVIEW_REQUIRED
                 │
                 └── fraud decision = REJECT ───────────────────────────→ REJECTED
```

M1 không cho client trực tiếp đổi status. `APPROVED`, `REVIEW_REQUIRED` và `REJECTED` là terminal state trong M1. M2 mới định nghĩa transition sau supervisor review.

### 4.3 Fraud worker failure

1. Order được lưu thành công trước khi event được phát.
2. Worker retry lỗi tạm thời theo retry policy của transport/worker.
3. Nếu retry cạn hoặc evaluator không cho kết quả đáng tin cậy, order chuyển sang `REVIEW_REQUIRED` với reason code `FRAUD_EVALUATION_UNAVAILABLE`.
4. Hệ thống **không tự động APPROVED** chỉ vì evaluator bị lỗi/timeout.
5. Error/attempt phải được ghi audit để M2 vận hành review được.

Đây là mặc định an toàn được đề xuất; business phải xác nhận tác động SLA vì order có thể chờ review lâu hơn.

## 5. Business rules M1

### 5.1 Identity và authorization

| ID | Rule |
|---|---|
| BR-AUTH-001 | Mọi endpoint M1 yêu cầu authenticated caller. |
| BR-AUTH-002 | `sales_rep_id` lấy từ token/identity context phía server; không có trong request body `POST /orders`. |
| BR-AUTH-003 | Sale chỉ tạo hoặc xem order thuộc chính mình. Supervisor/Admin capability chưa có trong M1 public contract. |
| BR-AUTH-004 | Sale chỉ tạo order cho retailer active đang được gán cho sale đó tại thời điểm xử lý. |

Trong local development, mock identity được phép dùng để phát triển, nhưng phải tách khỏi production configuration và ghi rõ trong README/runbook sau này.

### 5.2 Validation order

| ID | Rule |
|---|---|
| BR-ORD-001 | `client_order_id` bắt buộc, không rỗng, tối đa 100 ký tự; unique theo `sales_rep_id`. |
| BR-ORD-002 | Header `Idempotency-Key` bắt buộc, là UUID. |
| BR-ORD-003 | `retailer_id` bắt buộc và phải tham chiếu retailer hợp lệ theo source of truth đã chọn. |
| BR-ORD-004 | `order_time` phải theo ISO 8601 có offset/timezone; không được muộn hơn server time quá 5 phút. Order offline trong quá khứ được phép để không chặn SFA sync. |
| BR-ORD-005 | `items` có ít nhất một item; mỗi `product_sku` chỉ xuất hiện một lần; `quantity` là integer lớn hơn 0. |
| BR-ORD-006 | SKU phải active/được phép bán theo data source M1. |
| BR-ORD-007 | `declared_total_amount_vnd` là số nguyên VND lớn hơn 0. M1 chưa tính lại giá hay promotion; field này là dữ liệu do SFA khai báo. |
| BR-ORD-008 | Không nhận field không nằm trong contract; server không dựa vào amount/identity do client tự suy luận ngoài các field được công bố. |

### 5.3 Idempotency và duplicate

| ID | Rule |
|---|---|
| BR-IDEM-001 | Lần submit mới ghi `Idempotency-Key`, request fingerprint và order trong cùng transaction logic. |
| BR-IDEM-002 | Retry cùng key, cùng authenticated sale và cùng payload fingerprint trả về cùng `order_id`, không tạo record thứ hai. Response có header `Idempotency-Replayed: true`. |
| BR-IDEM-003 | Cùng key nhưng payload khác trả `409 IDEMPOTENCY_KEY_REUSED`. |
| BR-IDEM-004 | Cùng `client_order_id` của một sale nhưng payload khác trả `409 CLIENT_ORDER_ID_CONFLICT`. |
| BR-IDEM-005 | Việc retry có thể nhận snapshot trạng thái mới hơn; client phải luôn dùng `order_id` và `GET /orders/{order_id}` để nhận trạng thái hiện tại. |

Thời gian hết hạn idempotency record là quyết định vận hành còn mở. Đề xuất ban đầu: tối thiểu 24 giờ, sau đó xác nhận theo offline sync behavior của SFA.

### 5.4 Fraud evaluation và audit

| ID | Rule |
|---|---|
| BR-FRD-001 | Khi order được tạo thành công, hệ thống tạo logical event `order.created.v1` sau khi persistence được bảo đảm. |
| BR-FRD-002 | Fraud evaluator không được làm rollback order đã được tiếp nhận chỉ vì nó chạy chậm/lỗi. |
| BR-FRD-003 | Mọi final decision phải có `risk_score` 0–100, ít nhất một reason code, evaluator type/version và thời gian assessment. |
| BR-FRD-004 | Chỉ system worker/service account được phép đổi status từ `PENDING_FRAUD_CHECK`. |
| BR-FRD-005 | M1 dùng mock/rule evaluator; không được mô tả output này là quyết định AI production. |
| BR-FRD-006 | `order_time` và `received_at` đều được lưu để rule ngoài giờ hoặc offline sync được phân biệt sau này. |

## 6. Logical event contract

M1 cần logical event sau, dù transport cụ thể là queue, database outbox poller hay worker nội bộ vẫn chưa quyết định:

```json
{
  "event_id": "uuid",
  "event_type": "order.created.v1",
  "occurred_at": "2026-08-16T15:00:00Z",
  "correlation_id": "request-id-or-trace-id",
  "data": {
    "order_id": "uuid"
  }
}
```

Consumer phải idempotent vì event delivery có thể là **at least once**. Consumer lấy source of truth order từ persistence theo `order_id`; không coi payload event tối giản là toàn bộ order snapshot.

## 7. Acceptance scenarios M1

| ID | Scenario | Expected result |
|---|---|---|
| AC-01 | Sale hợp lệ tạo order hợp lệ | `202`, một order persisted ở `PENDING_FRAUD_CHECK`, một event/job được tạo. |
| AC-02 | Client retry cùng `Idempotency-Key` và payload | Không tạo order/item/event nghiệp vụ thứ hai; nhận lại cùng `order_id`. |
| AC-03 | Client reuse idempotency key với payload khác | `409 IDEMPOTENCY_KEY_REUSED`. |
| AC-04 | Sale tạo order cho retailer không thuộc assignment | `403 RETAILER_NOT_ASSIGNED`. |
| AC-05 | Item trùng SKU hoặc quantity không hợp lệ | `422 VALIDATION_ERROR`; không ghi order. |
| AC-06 | Fraud result là approve/review/reject | Order chuyển đúng status, có fraud assessment và history. |
| AC-07 | Fraud evaluator lỗi hết retry | Order thành `REVIEW_REQUIRED`, có reason `FRAUD_EVALUATION_UNAVAILABLE`; không tự approve. |
| AC-08 | Sale đọc order của sale khác | `404` để không lộ sự tồn tại của order ngoài quyền sở hữu. |

## 8. Decision log cho production reopening

Các quyết định trong [06-m1-local-baseline.md](06-m1-local-baseline.md) đã đóng đủ blocker cho implementation local/demo. Bảng dưới đây giữ các câu hỏi cần mở lại trước production integration; chúng không chặn M1 local nhưng phải có owner và ngày chốt khi scope production bắt đầu.

| ID | Quyết định/giả định | Trạng thái | Owner cần chốt | Tác động nếu đổi |
|---|---|---|---|---|
| D-M1-001 | M1 chỉ bao gồm create + read order; master data API có thể mock/adapter. | PROPOSED | Product/Tech lead | Số endpoint và data dependency. |
| D-M1-002 | Identity đến từ Bearer JWT/SFA gateway; sales ID do server suy ra. | OPEN | Security/Integration | Request schema, auth middleware, mobile token flow. |
| D-M1-003 | Fraud xử lý async; `POST /orders` trả `202`. | PROPOSED | Product/order-intake/Data | State model, UI polling, worker/queue. |
| D-M1-004 | Worker failure sau retry chuyển `REVIEW_REQUIRED`, không auto-approve. | PROPOSED | Operations/Product | SLA, review queue và support process. |
| D-M1-005 | Idempotency dùng mandatory UUID header + client order ID. | PROPOSED | mobile app/order-intake service/SFA | Offline retry and reconciliation behavior. |
| D-M1-006 | Monetary amount dùng integer VND `declared_total_amount_vnd`. | PROPOSED | Business/Finance | Backward compatibility với SFA payload hiện có. |
| D-M1-007 | Pricing/promotion authoritative calculation không thuộc M1. | PROPOSED | Business/Operations | Mức validation và fraud input. |
| D-M1-008 | GPS/device metadata không gửi trong M1 trước privacy/legal review. | OPEN | Security/Legal/Product | Fraud signal design và PII retention. |
| D-M1-009 | Supervisor review action là M2; M1 chỉ thể hiện `REVIEW_REQUIRED`. | PROPOSED | Operations/Product | Terminal state behavior/UI copy. |
| D-M1-010 | Retention, idempotency expiry và audit retention chưa chốt. | OPEN | Operations/Security | Database policy và compliance. |

## 9. Delta với prototype tiền thân

| Prototype tiền thân | M1 local implementation |
|---|---|
| `sales_rep_id` do request body gửi | sales ID suy ra từ authenticated identity |
| `total_amount` decimal | `declared_total_amount_vnd` integer VND |
| `PENDING`, `APPROVED` | `PENDING_FRAUD_CHECK`, `APPROVED`, `REVIEW_REQUIRED`, `REJECTED` |
| Fraud mock chạy inline và luôn approve | Fraud mock/rule worker async, có audit/reason/version |
| In-memory store | PostgreSQL + migration + history + idempotency record |
| Chỉ `POST /orders` | `POST /orders`, `GET /orders/{id}`, `GET /orders` |

Implementation local hiện theo hướng target này. Bất kỳ thay đổi incompatible nào tiếp theo phải đi qua review domain rule, contract/OpenAPI, migration impact và UAT gate.
