# M1 — Physical Data Model and Migration Plan

**Trạng thái:** Baseline cho local MVP  
**Tham chiếu:** [Domain rules](04-domain-rules-and-state-machine.md), [API Contract](05-api-contract.md), [Local baseline](06-m1-local-baseline.md)

## 1. Mục tiêu

Tài liệu này chuyển logical model M1 thành physical PostgreSQL schema để implementation có các đảm bảo sau:

```text
- Order không mất khi process restart.
- Retry không tạo order trùng.
- Order và outbox event được ghi cùng transaction.
- Fraud assessment và status history có audit trail.
- Worker có thể retry event mà không tạo assessment/trạng thái sai.
```

M1 dùng một PostgreSQL database và schema mặc định `public`. Không tách microservice database hoặc data warehouse ở phase này.

## 2. Quy ước physical schema

| Quy ước | Lựa chọn M1 |
|---|---|
| Primary key transactional | `UUID`, tạo bởi application/server. |
| Master-data identifier | `VARCHAR(100)`, giữ opaque ID từ SFA/ERP tương lai. |
| Timestamp | `TIMESTAMPTZ`, lưu UTC; request `order_time` phải có timezone. |
| Money | `BIGINT` VND, không dùng `FLOAT`/`NUMERIC` trong M1. |
| Enum/status | `VARCHAR` có `CHECK` constraint ở migration để dễ thay đổi controlled. |
| JSON | PostgreSQL `JSONB` cho outbox payload/reason codes; SQLAlchemy phải có fallback phù hợp local test nếu cần. |
| Soft delete | Không dùng cho order M1; master data dùng `is_active`. |
| Audit | `created_at`, `updated_at` trên record chính; status history và assessment là append-only. |

## 3. ERD M1

```text
sales_representatives 1 ─────< sales_retailer_assignments >───── 1 retailers
          │                                                       │
          └──────────────────────< orders >──────────────────────┘
                                           │
                                           ├────< order_items
                                           ├────< fraud_assessments
                                           ├────< order_status_history
                                           ├────< idempotency_records
                                           └────< outbox_events

products ─── referenced by order_items.product_sku
```

`products` không có foreign key từ `order_items.product_sku` trong local MVP để giữ historical SKU snapshot khi catalog thay đổi. SKU được validate lúc create order; production có thể thêm catalog version/reference strategy.

## 4. Bảng master data local

### 4.1 `sales_representatives`

| Column | Type | Constraint/ý nghĩa |
|---|---|---|
| `id` | `VARCHAR(100)` | Primary key, ví dụ `HUNG-001`. |
| `display_name` | `VARCHAR(200)` | Tên hiển thị local/demo. |
| `is_active` | `BOOLEAN` | Default `TRUE`. |
| `created_at` | `TIMESTAMPTZ` | Default database/server time. |

### 4.2 `retailers`

| Column | Type | Constraint/ý nghĩa |
|---|---|---|
| `id` | `VARCHAR(100)` | Primary key, ví dụ `CO-LAN-001`. |
| `display_name` | `VARCHAR(200)` | Tên cửa hàng. |
| `is_active` | `BOOLEAN` | Retailer inactive không nhận order mới. |
| `created_at` | `TIMESTAMPTZ` | Default database/server time. |

### 4.3 `products`

| Column | Type | Constraint/ý nghĩa |
|---|---|---|
| `sku` | `VARCHAR(100)` | Primary key. |
| `display_name` | `VARCHAR(200)` | Tên sản phẩm. |
| `is_active` | `BOOLEAN` | SKU inactive không nhận order mới. |
| `created_at` | `TIMESTAMPTZ` | Default database/server time. |

### 4.4 `sales_retailer_assignments`

| Column | Type | Constraint/ý nghĩa |
|---|---|---|
| `sales_rep_id` | `VARCHAR(100)` | FK `sales_representatives.id`. |
| `retailer_id` | `VARCHAR(100)` | FK `retailers.id`. |
| `is_active` | `BOOLEAN` | Default `TRUE`. |
| `created_at` | `TIMESTAMPTZ` | Audit tối thiểu. |

Primary key là composite `(sales_rep_id, retailer_id)`. Đây là nguồn kiểm tra BR-AUTH-004.

## 5. Bảng transactional

### 5.1 `orders`

| Column | Type | Constraint/ý nghĩa |
|---|---|---|
| `id` | `UUID` | Primary key server-generated. |
| `client_order_id` | `VARCHAR(100)` | ID SFA; unique theo sale. |
| `sales_rep_id` | `VARCHAR(100)` | FK `sales_representatives.id`. |
| `retailer_id` | `VARCHAR(100)` | FK `retailers.id`. |
| `order_time` | `TIMESTAMPTZ` | Thời điểm client ghi nhận, chuẩn hóa UTC. |
| `order_timezone_offset_minutes` | `INTEGER` | Offset gốc từ client (`-840` đến `840`) để fraud rule xác định giờ địa phương. |
| `received_at` | `TIMESTAMPTZ` | Thời điểm server tiếp nhận. |
| `declared_total_amount_vnd` | `BIGINT` | `CHECK > 0`. |
| `status` | `VARCHAR(50)` | `PENDING_FRAUD_CHECK`, `APPROVED`, `REVIEW_REQUIRED`, `REJECTED`. |
| `request_fingerprint` | `VARCHAR(64)` | SHA-256 normalized payload, phục vụ duplicate/conflict. |
| `created_at` | `TIMESTAMPTZ` | Audit. |
| `updated_at` | `TIMESTAMPTZ` | Audit. |

Constraints/index:

```text
UNIQUE (sales_rep_id, client_order_id)
INDEX  (sales_rep_id, created_at DESC)
INDEX  (sales_rep_id, status, created_at DESC)
INDEX  (retailer_id, created_at DESC)
CHECK  declared_total_amount_vnd > 0
CHECK  status IN allowed M1 values
```

### 5.2 `order_items`

| Column | Type | Constraint/ý nghĩa |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `order_id` | `UUID` | FK `orders.id`, cascade delete chỉ cho transaction rollback/dev cleanup. |
| `product_sku` | `VARCHAR(100)` | SKU snapshot. |
| `quantity` | `INTEGER` | `CHECK > 0`. |
| `created_at` | `TIMESTAMPTZ` | Audit. |

Constraints:

```text
UNIQUE (order_id, product_sku)
CHECK  quantity > 0
INDEX  (order_id)
```

### 5.3 `fraud_assessments`

| Column | Type | Constraint/ý nghĩa |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `order_id` | `UUID` | FK `orders.id`. |
| `risk_score` | `INTEGER` | `CHECK 0 <= score <= 100`. |
| `decision` | `VARCHAR(50)` | Final M1 decision, không được là pending. |
| `reason_codes` | `JSONB` | Array non-empty of reason codes. |
| `evaluator_type` | `VARCHAR(100)` | Ví dụ `mock_rule_engine`. |
| `evaluator_version` | `VARCHAR(100)` | Ví dụ `m1-0.1`. |
| `assessed_at` | `TIMESTAMPTZ` | Thời điểm assessment. |
| `created_at` | `TIMESTAMPTZ` | Audit. |

M1 chỉ cần assessment gần nhất để API read, nhưng không overwrite assessment lịch sử.

### 5.4 `order_status_history`

| Column | Type | Constraint/ý nghĩa |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `order_id` | `UUID` | FK `orders.id`. |
| `from_status` | `VARCHAR(50)` nullable | `NULL` cho transition create. |
| `to_status` | `VARCHAR(50)` | Status đích. |
| `reason_code` | `VARCHAR(100)` nullable | Ví dụ `ORDER_ACCEPTED`, `MOCK_LOW_RISK`. |
| `actor_type` | `VARCHAR(50)` | `SYSTEM`, `FRAUD_WORKER` hoặc future `SUPERVISOR`. |
| `changed_at` | `TIMESTAMPTZ` | Thời điểm transition. |

Index: `(order_id, changed_at ASC)`.

### 5.5 `idempotency_records`

| Column | Type | Constraint/ý nghĩa |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `idempotency_key` | `VARCHAR(36)` | Header UUID normalized string. |
| `sales_rep_id` | `VARCHAR(100)` | Identity scope của key. |
| `request_fingerprint` | `VARCHAR(64)` | SHA-256 normalized request. |
| `order_id` | `UUID` | FK `orders.id`. |
| `created_at` | `TIMESTAMPTZ` | Audit. |
| `expires_at` | `TIMESTAMPTZ` | Local baseline: created + 24h. |

Constraints/index:

```text
UNIQUE (sales_rep_id, idempotency_key)
INDEX  (expires_at)
INDEX  (order_id)
```

### 5.6 `outbox_events`

| Column | Type | Constraint/ý nghĩa |
|---|---|---|
| `id` | `UUID` | Primary key/event ID. |
| `event_type` | `VARCHAR(100)` | M1 dùng `order.created.v1`. |
| `aggregate_id` | `UUID` | `orders.id`. |
| `payload` | `JSONB` | Event envelope tối thiểu. |
| `status` | `VARCHAR(20)` | `PENDING`, `PROCESSING`, `PUBLISHED`, `FAILED`. |
| `attempt_count` | `INTEGER` | Default `0`. |
| `available_at` | `TIMESTAMPTZ` | Event sẵn sàng xử lý/retry. |
| `locked_at` | `TIMESTAMPTZ` nullable | Lease worker. |
| `processed_at` | `TIMESTAMPTZ` nullable | Thành công hoặc terminal failure. |
| `last_error` | `TEXT` nullable | Không log secret/PII. |
| `created_at` | `TIMESTAMPTZ` | Audit. |

Indexes:

```text
INDEX (status, available_at ASC)
INDEX (aggregate_id)
CHECK attempt_count >= 0
```

## 6. Transaction boundary khi tạo order

Các record dưới đây phải được commit cùng một transaction:

```text
orders
+ order_items
+ order_status_history (NULL → PENDING_FRAUD_CHECK)
+ idempotency_records
+ outbox_events (order.created.v1, PENDING)
```

Nếu một phần lỗi, transaction rollback toàn bộ. Đây là điểm đảm bảo `202` chỉ được trả khi order và event handoff đều durable.

## 7. Migration plan

### Revision `0001_m1_order_intake`

1. Tạo master data tables.
2. Tạo transactional tables theo thứ tự foreign key.
3. Tạo unique constraints/check constraints/indexes.
4. Không seed dữ liệu production trong Alembic migration.

### Seed data local

Seed chạy bằng application CLI sau migration, có thể chạy lặp lại an toàn:

```text
sales rep: HUNG-001 / Nguyễn Văn Hùng
retailer:  CO-LAN-001 / Tạp hóa cô Lan
product:   SKU-NUOC-NGOT-001 / Nước ngọt chai
product:   SKU-MI-GOI-001 / Mì gói
assignment: HUNG-001 → CO-LAN-001
```

### Upgrade sequence local

```powershell
alembic upgrade head
python -m app.db.seed
```

### Downgrade local

```powershell
alembic downgrade base
```

Downgrade chỉ dành cho local/dev. Không được dùng như rollback production khi đã có user data.

## 8. Manual verification matrix

M1 chưa tự động tạo test suite trong phase này. Sau implementation, phải chạy tối thiểu các case sau:

| Case | API/worker action | Database expectation |
|---|---|---|
| Create valid order | `POST /orders` | 1 order, N items, 1 idempotency record, 1 outbox event, 1 history row. |
| Retry same request | POST cùng key/payload | Không tăng count order/item/outbox. |
| Key reused with changed payload | POST cùng key, payload khác | `409`, không có row mới. |
| Unknown/unauthorized retailer | POST retailer khác assignment | `403`, không có row transactional. |
| Duplicate SKU | POST items cùng SKU | `422`, không có row transactional. |
| Worker approves | Worker `--once` | assessment + history, order `APPROVED`, outbox `PUBLISHED`. |
| Worker outside-hours | Worker `--once` | order `REVIEW_REQUIRED`, reason code ngoài giờ. |
| Worker high amount | Worker `--once` | order `REJECTED`, reason code threshold. |
| Read own order | GET detail/list | Chỉ trả order của Hùng. |

## 9. Non-goals và future changes

- Không tạo warehouse, forecast tables hay weather/event tables trong M1.
- Không đưa promotion breakdown vào `order_items` trước khi promotion contract được chốt.
- Không tạo payment/delivery tables.
- Khi SFA/ERP source of truth được tích hợp, master-data tables có thể trở thành read model/cache; foreign/business identifier giữ ổn định.
- Khi M2 có supervisor review, thêm `order_reviews` hoặc decision record riêng thay vì sửa history cũ.
