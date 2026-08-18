# M1 Local MVP Baseline

**Trạng thái:** Approved for local MVP implementation  
**Ngày hiệu lực:** 2026-08-16  
**Phạm vi:** Chỉ áp dụng cho môi trường học/demo/local. Đây không phải approval cho production integration hoặc chính sách dữ liệu chính thức.

## 1. Mục đích

Tài liệu này đóng các decision `OPEN` và `PROPOSED` cần thiết để bắt đầu implement M1 mà không phải chờ SFA, identity provider, AI model hoặc mobile client production.

Các quy tắc domain/API trong các tài liệu dưới đây vẫn là nguồn chính; baseline này ghi rõ lựa chọn cụ thể được dùng cho local implementation:

- [M1 domain rules và state machine](04-domain-rules-and-state-machine.md)
- [M1 API Contract](05-api-contract.md)
- [M1 OpenAPI Draft](../../contracts/openapi/order-intake.v1.yaml)

## 2. Scope implementation được baseline

```text
Order-intake service + browser web app + React Native/Expo mobile app local MVP

Browser web app (`../../apps/web`) / React Native/Expo app (`../../apps/mobile`)
/ Swagger / curl
  → Bearer dev token
  → PostgreSQL local
  → tạo order idempotent
  → outbox event trong database
  → fraud worker mock/rule-based
  → GET list/detail để poll status
```

M1 có browser web app local tại [`../../apps/web`](../../apps/web) và React Native/Expo mobile app local tại [`../../apps/mobile`](../../apps/mobile). Cả hai client tiêu thụ OpenAPI cho create order, persisted retry/idempotency, list/detail và polling. Browser app dùng Vite same-origin proxy trong local để gọi service mà không cần CORS; khi deploy phải dùng reverse proxy cùng origin hoặc CORS allowlist rõ ràng. Các client này không phải app production: không có identity/SFA thật, master-data endpoint, secure token/session storage hay production release profile. Swagger/curl/PowerShell vẫn là client hỗ trợ để validate order-intake service độc lập.

## 3. Quyết định đã chốt cho local MVP

| ID | Quyết định baseline | Lý do / implementation boundary |
|---|---|---|
| B-M1-001 | Identity local dùng `Authorization: Bearer dev-hung-001`; service map token này sang `sales_rep_id = HUNG-001`. | Tách ownership khỏi request body ngay từ đầu nhưng không giả vờ đã tích hợp JWT/SFA thật. Production thay bằng adapter identity/JWT. |
| B-M1-002 | Master data dùng PostgreSQL local seed: `HUNG-001`, retailer `CO-LAN-001`, SKU `SKU-NUOC-NGOT-001` và `SKU-MI-GOI-001`; Hùng chỉ được gán cho cô Lan. | Có thể test authorization và SKU validation thật mà không phụ thuộc SFA/ERP. |
| B-M1-003 | `POST /orders` bắt buộc `Idempotency-Key` UUID và `client_order_id`; idempotency record được giữ 24 giờ. | Hỗ trợ retry/offline sync tối thiểu. TTL là config để production điều chỉnh. |
| B-M1-004 | Create order trả `202 Accepted` và trạng thái ban đầu `PENDING_FRAUD_CHECK`. | Giữ contract async ngay cả khi local worker được chạy thủ công. |
| B-M1-005 | Handoff fraud dùng database outbox + worker CLI; không dùng `BackgroundTasks` vì restart có thể làm mất job. | Học được persistence-before-event và retry cơ bản mà chưa cần Kafka/RabbitMQ. |
| B-M1-006 | Fraud mock/rule worker trả `APPROVED`, `REVIEW_REQUIRED` hoặc `REJECTED`; worker lỗi cạn retry chuyển `REVIEW_REQUIRED` với `FRAUD_EVALUATION_UNAVAILABLE`. | Không auto-approve khi fraud không hoạt động. |
| B-M1-007 | Money dùng `declared_total_amount_vnd` là integer VND dương. | Không dùng float; pricing/promotion authoritative vẫn ngoài M1. |
| B-M1-008 | GPS, device ID và PII bổ sung không được nhận/lưu trong M1. | Tránh đưa dữ liệu nhạy cảm vào demo trước privacy review. |
| B-M1-009 | `REVIEW_REQUIRED` chỉ được hiển thị/read trong M1; supervisor decision là M2. | Giữ vertical slice nhỏ và rõ ràng. |
| B-M1-010 | Audit/order data giữ trong local database cho toàn bộ vòng đời demo; không định nghĩa retention production. | Production phải có policy do business/security chốt. |

## 4. Rule fraud mock đã baseline

Các rule này chỉ là deterministic demo rule, không phải AI model hay policy fraud production:

| Điều kiện | Decision | Risk score | Reason code |
|---|---|---:|---|
| `order_time` từ 22:00 đến trước 05:00 theo offset client gửi | `REVIEW_REQUIRED` | 75 | `OUTSIDE_STANDARD_ORDER_HOURS` |
| `declared_total_amount_vnd >= 20,000,000` | `REJECTED` | 95 | `AMOUNT_ABOVE_REJECTION_THRESHOLD` |
| `declared_total_amount_vnd >= 5,000,000` | `REVIEW_REQUIRED` | 60 | `AMOUNT_ABOVE_REVIEW_THRESHOLD` |
| Trường hợp khác | `APPROVED` | 15 | `MOCK_LOW_RISK` |
| Worker/evaluator không xử lý được sau retry | `REVIEW_REQUIRED` | 100 | `FRAUD_EVALUATION_UNAVAILABLE` |

Rule có thứ tự từ trên xuống; condition đầu tiên khớp sẽ quyết định. Các threshold phải được đưa vào configuration khi implement, không hard-code trong route.

## 5. API scope baseline

Public contract M1 vẫn gồm đúng các endpoint đã có trong `05-api-contract.md`:

```text
POST /api/v1/orders
GET  /api/v1/orders
GET  /api/v1/orders/{order_id}
```

Master data không được public thành endpoint M1 trong baseline này. Seed IDs được dùng để test API/service-first. Khi bắt đầu web/mobile client production, team sẽ quyết định một trong hai hướng:

1. Bổ sung `GET /api/v1/retailers` và `GET /api/v1/products` vào version contract tương thích; hoặc
2. Tích hợp trực tiếp với API master data của SFA/ERP qua adapter.

Không để web hoặc mobile client hard-code master data production.

## 6. Definition of baseline completion

M1 local baseline được coi là sẵn sàng vào implementation khi:

- Các file `04`, `05`, [`order-intake.v1.yaml`](../../contracts/openapi/order-intake.v1.yaml) vẫn nhất quán với quyết định ở tài liệu này.
- Service implementation dùng exact request/response/status trong OpenAPI.
- Không còn `sales_rep_id` do client gửi trong target API.
- Database, worker và API được validate qua smoke flow:

```text
create order → 202 PENDING_FRAUD_CHECK
→ process outbox worker
→ GET order → final fraud status
```

## 7. Các quyết định phải mở lại trước production

- JWT issuer, audience, claim mapping và key rotation thực tế.
- SFA/ERP master-data ownership, sync strategy và authorization source.
- Promotion/pricing calculation và inventory validation.
- PII/GPS/device consent, retention, encryption và access control.
- Queue infrastructure, worker scaling, retry/DLQ và observability.
- Supervisor workflow, SLA và audit retention.
- Fraud model governance, explainability và false-positive monitoring.
