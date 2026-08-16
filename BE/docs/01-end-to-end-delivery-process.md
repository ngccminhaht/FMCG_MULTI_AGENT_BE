# Quy trình phát triển sản phẩm end-to-end

**Trạng thái:** Draft — áp dụng cho FMCG Multi-Agent System  
**Mục đích:** Chuẩn hóa cách đi từ nhu cầu kinh doanh đến một tính năng chạy được, được kiểm thử và có thể vận hành.

## Kết luận ngắn

Chuỗi sau là đúng nhưng **chưa phải toàn bộ quy trình**:

```text
Scope → Actor/Use case → Business rule/trạng thái → API mapping
→ API contract → OpenAPI → Review → FE/BE implement
```

Đây là phần trung tâm của **thiết kế và triển khai một feature/vertical slice**. Một dự án hoàn chỉnh cần thêm bước xác minh vấn đề, ưu tiên MVP, yêu cầu phi chức năng, data/integration design, kiểm thử, release, quan sát vận hành và phản hồi sau release.

Quy trình không phải waterfall cứng. Sau mỗi release hoặc discovery mới, team quay lại refine scope, rule, use case và contract. Tuy nhiên, một feature không nên đi vào implementation khi các quyết định nền tảng của nó còn mơ hồ.

---

## 1. Vòng đời đầy đủ

```text
0. Discovery và xác minh bài toán
1. Chốt scope, outcome và MVP
2. Thiết kế domain, data và kiến trúc
3. Thiết kế giao diện/contract
4. Dựng technical foundation
5. Implement theo vertical slice
6. Kiểm thử và tích hợp
7. UAT và release readiness
8. Deploy, quan sát và vận hành
9. Đo lường, học hỏi và lặp lại
```

### 0. Discovery và xác minh bài toán

**Mục tiêu:** Hiểu vấn đề trước khi giải bằng API hoặc AI.

Các câu hỏi cho dự án này:

- Nhà phân phối Vạn Tín đang mất tiền hoặc mất thời gian ở bước nào?
- Gian lận nào có bằng chứng/tần suất cao: tách đơn để hưởng khuyến mãi, đơn ngoài giờ, đơn không có hoạt động bán thực, hay gian lận khác?
- Ai là người ra quyết định cuối với đơn đáng ngờ: supervisor, kế toán hay vận hành?
- Dự báo nào tạo giá trị rõ: SKU nào, khu vực nào, horizon bao lâu, và ai hành động dựa trên forecast?
- Dữ liệu SFA, tồn kho, khuyến mãi, thời tiết và sự kiện có sẵn với chất lượng nào?

**Deliverables:** problem statement, stakeholder map, actor/persona, customer journey, giả định cần kiểm chứng, KPI kinh doanh và danh sách constraint.

**Exit criteria:** team thống nhất vấn đề ưu tiên và cách đo thành công. Ví dụ: giảm số đơn fraud lọt qua review, hoặc cảnh báo nhu cầu tăng trước X ngày.

### 1. Chốt scope, outcome và MVP

**Mục tiêu:** Quyết định rõ release đầu tiên giải quyết gì và chủ động không làm gì.

Cần chốt:

- Product outcome: kết quả kinh doanh cần đạt.
- MVP hypothesis: release nhỏ nhất cần có để kiểm chứng outcome.
- In scope / out of scope.
- Use case ưu tiên theo MoSCoW hoặc P0/P1/P2.
- Acceptance criteria ở mức business.
- Roadmap sau MVP: fraud review, forecast, quản trị khuyến mãi, v.v.

**Exit criteria:** có một MVP nhỏ, đo được và có owner quyết định. Không dùng từ “MVP” để chỉ toàn bộ hệ thống mong muốn trong tương lai.

### 2. Thiết kế domain, data và kiến trúc

**Mục tiêu:** Chuyển scope thành mô hình nghiệp vụ có thể implement ổn định.

Cần thiết kế:

- Domain glossary: định nghĩa nhất quán cho `Order`, `Order Item`, `Retailer`, `Promotion`, `Fraud Assessment`, `Forecast`, `Demand Signal`.
- Actor, permission và ownership dữ liệu.
- Use case, precondition, happy path, alternative path và postcondition.
- Business rule: sale được tạo đơn cho cửa hàng nào, promotion nào hợp lệ, thế nào là outside-hours order, thế nào là duplicate.
- State machine: trạng thái đơn và điều kiện chuyển trạng thái.
- System context, integration boundary và luồng đồng bộ/bất đồng bộ.
- Logical ERD, sau đó physical ERD: khóa, index, constraint, audit trail, retention.
- NFR: performance, availability, security, auditability, privacy, observability, backup/recovery và scale.

**Ví dụ state machine đề xuất cho order** — phải được business xác nhận trước khi thành baseline:

```text
DRAFT (nếu SFA lưu nháp)
  → PENDING_FRAUD_CHECK
  → APPROVED
  → REVIEW_REQUIRED
  → REJECTED
  → CANCELLED
```

`PENDING` và `APPROVED` trong prototype hiện tại chỉ là mock tối giản, chưa phải state machine production.

**Exit criteria:** domain terms, rule quan trọng, state machine, architecture boundaries và data impact đã được review. ERD không cần hoàn hảo cho toàn hệ thống, nhưng phải đủ cho vertical slice sắp làm.

### 3. Thiết kế giao diện và API Contract

**Mục tiêu:** Chốt cách các client, service và worker giao tiếp mà không phụ thuộc source code của nhau.

Bắt đầu từ use case, không bắt đầu từ tên màn hình. Một màn hình có thể gọi nhiều API; một API có thể phục vụ nhiều màn hình/use case.

Mỗi use case được map sang một hoặc nhiều loại interface:

```text
- REST API cho mobile/web client
- API cho hệ thống ngoài
- Event/message nội bộ
- Background/scheduled job
- Admin/import workflow
```

Ví dụ, tạo đơn là public API cho App SFA; đánh giá fraud có thể là event/job nội bộ thay vì endpoint mobile.

**Tài liệu cần có:**

1. `api-contract.md`: mô tả dễ đọc gồm mục đích API, actor, rule, request/response, status code, error, auth, ví dụ và quyết định còn mở.
2. `openapi.yaml`: đặc tả máy đọc được của REST API public.
3. Event contract nếu có queue/event bus: event name, producer, consumer, payload, version và retry/dead-letter behavior.

**Contract phải chốt tối thiểu:**

- URL, HTTP method, request/response schema và examples.
- Authentication và authorization rule.
- Error format thống nhất.
- Idempotency/retry behavior với thao tác ghi, đặc biệt `POST /orders`.
- Pagination, filter, sort cho endpoint list.
- Timezone, currency, numeric precision.
- Đồng bộ hay bất đồng bộ; trạng thái trả về khi worker/AI chưa hoàn thành.
- Compatibility policy khi contract thay đổi.

**Exit criteria:** contract của vertical slice đạt trạng thái Baseline/Approved; FE, BE và QA hiểu giống nhau các case quan trọng.

### 4. Dựng technical foundation

**Mục tiêu:** Tạo nền kỹ thuật có thể tái sử dụng mà không khóa chặt các quyết định feature chưa chốt.

Các phần có thể dựng sớm hoặc song song với contract draft:

| Backend | Frontend | Delivery/Platform |
|---|---|---|
| FastAPI app structure, config, logging, health check | project shell, navigation, design system, HTTP client | repository, branching, CI, environment convention |
| database connection/session, migration tool, error handler | auth token storage, global error/loading handling | Docker/local setup, secret handling, build pipeline |
| auth framework, request ID, structured logs | API client generation/type strategy | lint, format, test command, deployment convention |

Không nên implement sâu request DTO, database schema hoặc workflow nghiệp vụ trước khi feature contract của nó đủ rõ.

**Exit criteria:** một developer mới có thể chạy app/local stack, có config theo environment và có cách kiểm tra chất lượng tối thiểu.

### 5. Implement theo vertical slice

**Mục tiêu:** Hoàn thành một luồng có giá trị từ UI/API đến persistence và kết quả, thay vì làm hết tất cả frontend rồi mới đến backend.

Một vertical slice điển hình:

```text
Use case được baseline
  → contract + test scenario
  → database/migration cần thiết
  → backend endpoint/service/worker
  → frontend screen/state/client
  → integration + contract test
  → demo/UAT
```

Ví dụ slice đầu tiên của dự án: sale gửi một đơn hợp lệ cho retailer được phân công, đơn được lưu bền vững, fraud mock/rule được gọi bất đồng bộ, và client xem được trạng thái kết quả.

### 6. Kiểm thử và tích hợp

**Mục tiêu:** Chứng minh implementation thực hiện đúng contract và rule, không chỉ “chạy được”.

Mức kiểm thử cần cân nhắc:

- Unit test cho rule, mapper, fraud scoring rule và validation.
- Integration test cho database, migration, repository, queue/worker.
- API/contract test so response khớp OpenAPI.
- End-to-end test cho happy path và luồng lỗi chính.
- Security test: authorization, input validation, secret handling.
- Performance/reliability test cho create order, retry, duplicate request và worker failure.
- Data quality test cho dữ liệu forecast/AI.

**Exit criteria:** acceptance criteria, test case P0/P1 và failure behavior của integration đã được kiểm chứng; mọi migration có rollback/backup plan phù hợp.

### 7. UAT và release readiness

**Mục tiêu:** Xác nhận người dùng nghiệp vụ có thể dùng feature đúng bối cảnh thật.

Checklist:

- Business owner/Supervisor thực hiện UAT trên dữ liệu đại diện.
- Permission và audit trail được kiểm tra.
- Runbook deployment, migration, rollback và hỗ trợ sự cố được chuẩn bị.
- Dashboard/log/alert tối thiểu có sẵn.
- Dữ liệu test không lộ PII hoặc secret.
- Known limitation được ghi rõ, đặc biệt nếu AI còn mock/rule-based.

### 8. Deploy, quan sát và vận hành

**Mục tiêu:** Biết hệ thống có đang tạo giá trị và có lỗi gì sau release.

Cần quan sát ít nhất:

- Tỷ lệ tạo đơn thành công/thất bại.
- Latency API, queue lag và worker failure.
- Số đơn `PENDING`, `REVIEW_REQUIRED`, `REJECTED`.
- Tỷ lệ duplicate/retry.
- Fraud alerts theo rule/model version.
- Forecast accuracy và adoption khi đã đến phase forecast.

### 9. Đo lường, học hỏi và lặp lại

**Mục tiêu:** Dùng dữ liệu vận hành để điều chỉnh product và kỹ thuật.

Sau release cần trả lời:

- MVP hypothesis đúng hay sai?
- User có dùng flow như dự kiến không?
- Rule fraud có false positive/false negative cao không?
- Contract, UX hay data model có điểm gây ma sát?
- Nên ưu tiên slice tiếp theo nào?

Kết quả có thể quay lại phase 0, 1 hoặc 2; đó là hành vi bình thường của product development.

---

## Quy tắc thay đổi contract

### Trước baseline

Trong giai đoạn Draft (`0.x`), contract được phép thay đổi thường xuyên. Tuy vậy phải cập nhật cả `api-contract.md`, `openapi.yaml`, ví dụ mẫu và ticket liên quan cùng lúc để tránh hiểu sai.

### Sau baseline của một slice/sprint

- Thay đổi tương thích ngược: có thể thêm field response, thêm endpoint, thêm request field optional. Vẫn cần review và changelog.
- Thay đổi phá vỡ tương thích: xóa/đổi tên field, đổi type, optional thành required, đổi nghĩa status. Phải có change proposal, impact analysis, migration/rollout plan; cân nhắc `/api/v2` nếu API đã được client sử dụng ổn định.
- Không tạo `/api/v0.2` theo version tài liệu. `info.version` trong OpenAPI và `/api/v1` là hai khái niệm khác nhau.

Base FE/BE không phải làm lại mỗi lần contract thay đổi. Chỉ feature module, adapter/DTO, mapper, test và phần UI liên quan thay đổi; nền tảng như config, logging, database session, HTTP client hoặc CI nên ổn định.

---

## Điểm kiểm soát quyết định

| Mốc | Câu hỏi cần trả lời | Người nên review |
|---|---|---|
| MVP scope | Có giải quyết một vấn đề đủ giá trị và đủ nhỏ không? | Business/Product, Tech lead |
| Domain baseline | Rule, trạng thái, quyền và data ownership đã rõ chưa? | Business, BE, Data/AI |
| Contract baseline | FE, BE, QA hiểu cùng request/response/failure behavior chưa? | FE, BE, QA |
| Ready for implementation | Có acceptance criteria, data impact và test scenario chưa? | Feature team |
| Ready for release | Có migration, observability, rollback, UAT và known limitation chưa? | Product, QA, DevOps/BE |

## Cách áp dụng ngay cho dự án này

1. Không mở rộng ngay code prototype thành tất cả module của hệ thống.
2. Chốt danh mục actor/use case và chọn **một** MVP vertical slice.
3. Chốt rule và target state machine của order.
4. Viết `api-contract.md` và `openapi.yaml` chỉ cho slice đó.
5. Baseline contract, sau đó mới thay prototype RAM/mock bằng persistence, idempotency, API tra cứu và worker phù hợp.
6. Khi slice đầu tiên hoàn thành, dùng dữ liệu/feedback để chọn slice tiếp theo — không mở cùng lúc fraud production, promotion engine và forecasting.
