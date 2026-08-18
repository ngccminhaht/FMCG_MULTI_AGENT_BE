# Workflow triển khai MVP theo vertical slice

**Trạng thái:** Draft  
**Áp dụng:** FMCG Multi-Agent System cho nhà phân phối Vạn Tín

## 1. Trả lời câu hỏi “đầu tiên làm MVP hay làm gì?”

**Đầu tiên không phải code MVP ngay.** Đầu tiên là chốt một MVP hypothesis nhỏ, đo được và có thể triển khai theo vertical slice.

Thứ tự thực tế cho dự án này:

```text
A. Chọn vấn đề ưu tiên + outcome cần đo
B. Chốt MVP scope và use case P0
C. Chốt business rule, trạng thái và dữ liệu tối thiểu
D. Baseline API/event contract của slice đầu tiên
E. Dựng/hoàn thiện technical foundation còn thiếu
F. mobile app + service + database + worker implement cùng một vertical slice
G. Test, demo/UAT, release
H. Đo kết quả rồi chọn slice tiếp theo
```

Không làm theo kiểu “xong toàn bộ service, rồi làm mobile app, rồi mới test”. Không làm theo kiểu “đủ toàn bộ feature fraud và forecasting rồi mới release”.

## 2. MVP được đề xuất

### 2.1 Product hypothesis

> Nếu sale có thể tạo đơn cho retailer hợp lệ, hệ thống lưu đơn an toàn và đánh giá các dấu hiệu rủi ro cơ bản, supervisor có thể thấy các đơn cần chú ý sớm hơn và đội ngũ có nền dữ liệu tin cậy cho phase AI/forecast tiếp theo.

### 2.2 Outcome cần đo

KPI cụ thể phải được business chốt, nhưng MVP có thể bắt đầu với:

- Tỷ lệ đơn được tiếp nhận thành công.
- Tỷ lệ đơn duplicate bị chặn hoặc xử lý idempotent đúng.
- Thời gian từ tạo đơn đến có kết quả fraud assessment.
- Số đơn được gắn `REVIEW_REQUIRED` và số quyết định supervisor.
- Tỷ lệ order có đủ dữ liệu cần thiết cho phân tích sau này.

### 2.3 In scope của MVP

MVP đề xuất là **Order Intake and Risk Validation**:

1. Xác định sale đang thao tác và quyền tạo đơn cho retailer.
2. Chọn retailer/sản phẩm từ dữ liệu nền tối thiểu hoặc dữ liệu mock kiểm soát được.
3. Tạo đơn có chống gửi trùng.
4. Lưu order bền vững vào PostgreSQL.
5. Đặt trạng thái ban đầu là chờ kiểm tra rủi ro.
6. Chạy fraud evaluation mock/rule-based qua worker hoặc abstraction có thể thay bằng AI.
7. Xem được danh sách/chi tiết/trạng thái đơn.
8. Ghi log/audit cơ bản cho request, trạng thái và assessment.

### 2.4 Out of scope của MVP

Các phần dưới đây quan trọng nhưng không nên chặn release đầu tiên:

- LLM/AI agent thật hoặc model machine learning production.
- Tối ưu khuyến mãi phức tạp, xử lý mọi loại combo/xào chẻ.
- Tích hợp trực tiếp với tất cả App SFA hoặc ERP/WMS.
- Forecast chính thức cho toàn bộ SKU/khu vực.
- Dashboard BI đầy đủ.
- Quy trình review nhiều cấp, thanh toán, giao hàng và đối soát.
- Multi-tenant, active-active deployment hoặc scale lớn.

Out of scope không có nghĩa “không bao giờ làm”; nghĩa là không được để nó kéo dài validation của MVP.

## 3. Milestone và vertical slice

### M0 — Product/contract baseline

**Mục tiêu:** Sẵn sàng implement mà không đoán request, trạng thái hay rule.

| Hạng mục | Output |
|---|---|
| Actor/use case | `03-use-case-catalog.md` được review cho P0 |
| Rule + state | tài liệu state machine và rule order/fraud tối thiểu |
| Data | logical/physical ERD chỉ cho P0 |
| Contract | `api-contract.md`, `order-intake.v1.yaml` cho P0 |
| Quality | acceptance criteria, error format và test scenario |
| Decision log | các quyết định/giả định còn mở có owner và deadline |

**Không coi M0 hoàn thành** nếu còn chưa quyết định ai duyệt đơn rủi ro, đơn trùng được xử lý ra sao, hoặc AI timeout thì order có trạng thái gì.

### M1 — Create order end-to-end

**User value:** Hùng tạo được một đơn hợp lệ cho Tạp hóa cô Lan, hệ thống không làm mất hoặc tạo trùng đơn.

**Public interface baseline cho local M1:**

```text
POST /api/v1/orders
GET  /api/v1/orders
GET  /api/v1/orders/{order_id}
```

Retailer, product và sales-retailer assignment dùng PostgreSQL seed data trong local MVP. `GET /retailers` và `GET /products` sẽ được bổ sung sau khi mobile app thật được chọn hoặc khi SFA/ERP master-data integration được chốt.

**Internal interface dự kiến:**

```text
Event/job: order.created
Consumer: fraud evaluation worker
Result: fraud assessment completed → order status updated
```

**Điều kiện hoàn thành:**

- Request được validate theo approved contract.
- Có authorization/assignment rule hoặc mock identity được ghi rõ là temporary.
- Có idempotency key/client order ID.
- Order và order items được lưu PostgreSQL bằng migration.
- `POST /orders` trả kết quả phù hợp contract, thường là `202` + `PENDING_FRAUD_CHECK` nếu fraud là async.
- Worker mock/rule-based cập nhật kết quả; lỗi worker không làm mất order.
- `GET /orders/{id}` trả được trạng thái hiện tại.
- Có API/integration test cho happy path, validation, duplicate và worker failure cơ bản.

### M2 — Fraud review workflow

**User value:** Supervisor không chỉ nhìn score mà có thể quyết định với đơn đáng ngờ.

Scope dự kiến:

```text
GET  /api/v1/orders?status=REVIEW_REQUIRED
GET  /api/v1/orders/{order_id}/fraud-assessments
POST /api/v1/orders/{order_id}/review-decision
```

Cần bổ sung: reason code, assessor/model/rule version, audit trail, permission Supervisor, rule cho approve/reject sau review.

### M3 — Promotion and fraud signal enrichment

**User value:** Hệ thống phát hiện các pattern có ý nghĩa hơn như tách đơn để hưởng khuyến mãi hoặc order bất thường ngoài giờ.

Scope dự kiến:

- Master data promotion/pricing có version.
- Fraud signal: outside-hours, unusual quantity, repeat retailer, promotion split pattern.
- Explainable reason codes thay vì chỉ risk score.
- Monitoring false positive/false negative.

### M4 — Demand forecast pilot

**User value:** Planner/quản lý xem được forecast thử nghiệm cho một khu vực/SKU được chọn, ví dụ khu vực Quế Võ.

Scope dự kiến:

- Dataset order history đã được làm sạch.
- Weather/event data source cụ thể, licensing và refresh schedule rõ ràng.
- Forecast theo một horizon, khu vực và danh sách SKU giới hạn.
- API/UI chỉ đọc forecast và confidence/known limitation.
- Đo accuracy trên historical holdout trước khi dùng cho quyết định vận hành.

## 4. Cách làm một vertical slice

Mỗi slice đi theo cùng một flow để mobile app, service, QA không lệch nhau:

```text
1. Story + acceptance criteria
2. Domain rule + state transition
3. Data impact + migration plan
4. Contract draft + example payload
5. Review/baseline contract
6. mobile app mock + service implementation + tests song song
7. Integration/contract test
8. Demo/UAT
9. Release + observability
10. Retrospective + cập nhật backlog
```

### 4.1 Definition of Ready (DoR)

Một story/slice chỉ vào implementation khi có đủ:

- User/actor, mục tiêu và business value rõ.
- In scope/out of scope rõ.
- Happy path và exception path chính.
- Permission/ownership rõ.
- State transition rõ.
- Request/response/error mẫu trong contract draft.
- Data fields và migration impact đã biết.
- Acceptance criteria có thể test.
- Dependency (SFA, data source, AI service, team khác) có owner.
- Những giả định chưa chốt được ghi vào decision log, không bị giấu trong code.

### 4.2 Công việc song song sau khi contract baseline

| Workstream | Công việc trong M1 |
|---|---|
| Product/Business | confirm rule, demo data, UAT scenario, KPI |
| Backend | persistence, migration, API, worker abstraction, error/audit/logging |
| Frontend | screen flow, client/DTO từ contract, loading/error/PENDING state, retry UX |
| QA | test matrix từ contract, regression, API/integration/E2E case |
| Data/AI | định nghĩa input signal, reason code, mock/rule contract, đánh giá data quality |
| Platform | local stack, CI, environment/secrets, deploy/log/alert minimum |

mobile app có thể dùng mock server/data đúng OpenAPI; service không cần chờ mobile app để implement. Hai bên gặp nhau ở contract test, không ở việc đọc source code của nhau.

### 4.3 Definition of Done (DoD)

Một slice chỉ được đánh dấu done khi:

- Acceptance criteria đạt và business demo được.
- API thực tế khớp approved contract.
- Migration đã test trên môi trường đại diện; rollback/backup impact được biết.
- Input validation, auth/authorization và error behavior hoạt động.
- Unit/integration/API test P0 chạy thành công.
- UI xử lý loading, empty, validation error, server error và trạng thái async liên quan.
- Structured log, request ID và metric/error monitoring tối thiểu có mặt.
- Documentation/changelog cập nhật.
- Known limitations được ghi rõ; không trình bày mock như AI production.

## 5. Chính sách thay đổi trong khi mobile app/order-intake service đang làm

Contract sẽ luôn thay đổi; mục tiêu là kiểm soát blast radius, không phải ngăn thay đổi.

1. Mở issue/change request: thay đổi lý do gì, ảnh hưởng actor/use case nào.
2. Phân loại compatible hay breaking.
3. Cập nhật `api-contract.md`, `order-intake.v1.yaml`, examples và test case trong một change.
4. mobile app, service, QA review impact trước merge.
5. Compatible change: có thể thêm field optional/response field, vẫn thông báo release note.
6. Breaking change: có transition plan; nếu client đã release thì giữ compatibility hoặc version public API khi cần.

Không sửa ngầm schema backend, rồi để frontend phát hiện lúc integration.

## 6. Việc cần làm ngay bây giờ

Theo thứ tự ưu tiên:

1. Review và chốt danh mục actor/use case P0 trong `03-use-case-catalog.md`.
2. Chọn chính xác **M1** là vertical slice đầu tiên; không thêm forecast vào M1.
3. Viết rule và target state machine cho order/fraud.
4. Chốt các decision blocker: auth source, idempotency, pricing/promotion source, async processing, review owner, data retention.
5. Viết `05-api-contract.md` và `order-intake.v1.yaml` chỉ cho M1.
6. Review/baseline contract.
7. Update FastAPI prototype theo contract, đồng thời dựng PostgreSQL + SQLAlchemy/Alembic và mobile app base.

## 7. Trạng thái implementation M1 hiện tại

Backend local M1 hiện đã có persistence, migration, local auth adapter, idempotency, database outbox, fraud worker, audit và các endpoint create/list/detail đúng baseline contract. Xem [runbook local](08-m1-local-development-and-runbook.md) để chạy và xác nhận flow thực tế.

Các điểm còn thiếu so với Definition of Done end-to-end:

- Live PostgreSQL migration/API/worker verification đã pass: Docker PostgreSQL healthy, migration/seed, create/retry/conflict/error/read flow, durable outbox/audit và concurrent idempotency/client-order/reordered-items replay.
- React Native/Expo mobile app M1 tại `../../apps/mobile` đã theo OpenAPI: create order, persisted retry/idempotency, list/detail, polling, error/config UI; typecheck và Android static export đã pass. E2E với emulator/physical device vẫn chờ Android SDK Platform Tools (`adb`) và thiết bị/emulator.
- Worker fraud vẫn là deterministic mock rule, chưa phải AI/ML production.
- Production JWT/SFA integration, master-data source, observability, CI/regression suite và release controls chưa thuộc local M1.

Không cần quay lại prototype in-memory. Các thay đổi tiếp theo phải tiếp tục đi qua contract, migration impact và UAT/release gate đã baseline.
