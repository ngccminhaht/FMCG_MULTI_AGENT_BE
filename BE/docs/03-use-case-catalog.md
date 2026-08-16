# Danh mục use case — FMCG Multi-Agent System

**Trạng thái:** Draft đề xuất  
**Mục đích:** Chốt use case theo giá trị nghiệp vụ trước khi suy ra API, event, job và database change.

> Một use case không đồng nghĩa với một page hoặc một endpoint. Mỗi use case có thể cần nhiều REST API, event nội bộ, scheduled job hoặc thao tác admin. Ngược lại, một API có thể phục vụ nhiều use case.

## 1. Actor

| Actor | Mục tiêu/chức năng |
|---|---|
| Sales Representative (ví dụ Hùng) | Tạo và theo dõi đơn cho retailer được phân công. |
| Retailer (ví dụ Tạp hóa cô Lan) | Đối tượng nhận đơn, không nhất thiết trực tiếp dùng MVP UI. |
| Supervisor/Approver | Xử lý đơn bị gắn cờ hoặc cần review. |
| Admin/Operations | Quản lý master data, phân công, promotion, rule và dữ liệu vận hành. |
| Fraud Evaluation Service/Agent | Đánh giá rủi ro và tạo assessment cho order. |
| Forecasting Service/Agent | Tạo dự báo từ lịch sử nhu cầu và external signals. |
| Planner/Manager | Xem/điều chỉnh forecast và ra quyết định hàng tồn/nhập hàng. |
| External SFA/ERP/WMS/Weather/Event Provider | Nguồn hoặc đích tích hợp dữ liệu. |

## 2. Phân loại ưu tiên

- **P0 / MVP:** Cần để kiểm chứng luồng giá trị đầu tiên: tiếp nhận đơn đáng tin cậy và đánh giá risk tối thiểu.
- **P1:** Nâng khả năng vận hành/review sau khi M1 ổn định.
- **P2:** Forecast, integration mở rộng và optimization sau khi có dữ liệu đủ tin cậy.

Ưu tiên này là đề xuất kỹ thuật; Product/Business phải xác nhận bằng giá trị và deadline thực tế.

## 3. Use case P0 — Order intake and risk validation

| ID | Use case | Actor chính | Giá trị | Giao diện dự kiến | Ưu tiên |
|---|---|---|---|---|---|
| UC-ORD-01 | Xác định người dùng/phiên sale | Sales Rep, Identity Provider | Biết ai tạo đơn để kiểm soát quyền và audit | Auth token/session; không nhất thiết tự xây login UI | P0 |
| UC-ORD-02 | Lấy retailer sale được phép thao tác | Sales Rep | Tránh tạo đơn cho retailer không thuộc tuyến/phân công | `GET /retailers` hoặc dữ liệu sync từ SFA | P0 |
| UC-ORD-03 | Lấy catalog sản phẩm/giá nền | Sales Rep | Có dữ liệu chuẩn để tạo item đơn | `GET /products`, `GET /prices` hoặc SFA sync | P0 |
| UC-ORD-04 | Xem/áp dụng promotion khả dụng | Sales Rep, System | Giá và khuyến mãi minh bạch, tạo input cho fraud | `GET /promotions`, quote API hoặc rule nội bộ | P0 nếu promotion ảnh hưởng order |
| UC-ORD-05 | Tạo đơn hàng | Sales Rep | Tiếp nhận đơn không mất dữ liệu/không bị duplicate | `POST /orders` | P0 |
| UC-ORD-06 | Theo dõi danh sách/chi tiết/trạng thái đơn | Sales Rep | Biết kết quả xử lý async và xử lý ngoại lệ | `GET /orders`, `GET /orders/{id}` | P0 |
| UC-FRD-01 | Đánh giá risk của đơn | Fraud Service/Agent | Gắn score/reason/status cho order | event/job `order.created`; worker nội bộ | P0 |
| UC-FRD-02 | Lưu audit fraud assessment | System | Có thể giải thích và kiểm tra lại quyết định | DB/audit event; read API tùy role | P0 |

### UC-ORD-05 — Tạo đơn hàng (mô tả tối thiểu)

**Actor:** Sales Representative.  
**Mục tiêu:** Tạo một order hợp lệ cho retailer thuộc quyền phụ trách.  
**Precondition:** user được xác định; retailer, product và rule cần thiết tồn tại; client có idempotency key hoặc client order ID.  
**Happy path:**

```text
1. Sale gửi payload order.
2. Backend xác thực và kiểm tra quyền retailer.
3. Backend validate item, amount, pricing/promotion rule thuộc scope.
4. Backend kiểm tra idempotency/duplicate.
5. Backend ghi order + items bền vững với trạng thái chờ fraud check.
6. Backend tạo event/job đánh giá risk.
7. Client nhận order ID và trạng thái tiếp nhận.
```

**Alternative/error path cần chốt:** sale không có quyền, retailer/product inactive, promotion invalid, duplicate request, database failure, worker/AI timeout, request gửi offline và retry.

**Postcondition:** order tồn tại cùng audit/reason phù hợp; client có thể truy vấn kết quả sau này.

### UC-FRD-01 — Đánh giá rủi ro đơn

**Actor:** Fraud Service/Agent.  
**Trigger:** order được tiếp nhận thành công.  
**Không nhất thiết là API mobile:** đây nên được model hóa trước như event/background job.

Input cần cân nhắc:

- order, items, total, order time và timezone;
- sale, retailer, tuyến/phân công;
- promotion/version áp dụng;
- lịch sử order liên quan;
- device/GPS/check-in nếu hợp pháp, cần thiết và được phép thu thập;
- rule/model version.

Output cần chốt:

- risk score hoặc risk band;
- decision/status;
- reason code/explanation;
- assessment time, evaluator/rule/model version;
- retry/failure status.

## 4. Use case P1 — Review và vận hành fraud

| ID | Use case | Actor chính | Giá trị | Giao diện dự kiến | Ưu tiên |
|---|---|---|---|---|---|
| UC-FRD-03 | Xem queue đơn cần review | Supervisor | Tập trung xử lý đơn rủi ro | `GET /orders?status=REVIEW_REQUIRED` | P1 |
| UC-FRD-04 | Quyết định approve/reject sau review | Supervisor | Có human-in-the-loop và audit | `POST /orders/{id}/review-decision` | P1 |
| UC-FRD-05 | Xem lịch sử assessment/reason | Supervisor, Audit | Giải thích quyết định và debug false positive | `GET /orders/{id}/fraud-assessments` | P1 |
| UC-ADM-01 | Quản lý sales/retailer assignment | Admin | Nền cho authorization và fraud context | Admin API/import workflow | P1 |
| UC-ADM-02 | Quản lý product, price, promotion version | Admin/Operations | Nguồn dữ liệu đáng tin cậy cho order/rule | Admin API/import workflow | P1 |
| UC-ADM-03 | Quản lý fraud rule configuration | Admin/Operations | Điều chỉnh rule có kiểm soát/audit | Admin API/config workflow | P1 |

## 5. Use case P2 — Forecast demand

| ID | Use case | Actor chính | Giá trị | Giao diện dự kiến | Ưu tiên |
|---|---|---|---|---|---|
| UC-FCT-01 | Thu thập/chuẩn hóa historical demand | System | Tạo dataset đáng tin cậy | ETL/scheduled job | P2 |
| UC-FCT-02 | Đồng bộ weather/local event signals | System, External Provider | Bổ sung tín hiệu cho forecast | Integration/scheduled job | P2 |
| UC-FCT-03 | Sinh forecast theo SKU/khu vực/horizon | Forecasting Service | Dự báo nhu cầu có thể hành động | batch/worker/model service | P2 |
| UC-FCT-04 | Xem forecast và cảnh báo | Planner/Manager | Ra quyết định nhập hàng/phân bổ | `GET /forecasts`, dashboard | P2 |
| UC-FCT-05 | Ghi nhận override/feedback forecast | Planner | Cải thiện quyết định và đo adoption | `POST /forecasts/{id}/feedback` | P2 |

Forecast chỉ nên vào implementation khi order/master data ổn định, data lineage rõ và có benchmark accuracy. Không xây AI/forecast chỉ vì có model; phải chốt decision workflow mà forecast sẽ hỗ trợ.

## 6. Map use case sang interface — ví dụ M1

| Use case | Client-facing API | Internal event/job | Persistence chính |
|---|---|---|---|
| UC-ORD-02 | `GET /retailers` | có thể sync từ SFA | retailer, sales_retailer_assignment |
| UC-ORD-03 | `GET /products` | catalog sync tùy nguồn | product, price/version |
| UC-ORD-04 | `GET /promotions` / `POST /orders/quote` | promotion rule evaluation | promotion, eligibility/result |
| UC-ORD-05 | `POST /orders` | `order.created` | order, order_item, idempotency record |
| UC-FRD-01 | không bắt buộc public | fraud evaluation job | fraud_assessment, order status history |
| UC-ORD-06 | `GET /orders`, `GET /orders/{id}` | không bắt buộc | order read model/query |

Đây là mapping để viết contract; **chưa phải danh sách endpoint đã được chốt**. Các endpoint chỉ được đưa vào OpenAPI sau khi business rule và ownership dữ liệu của use case đã rõ.

## 7. Decision blockers phải chốt trước API Contract M1

| Quyết định | Vì sao ảnh hưởng contract/data | Owner cần có |
|---|---|---|
| Identity lấy từ đâu? | `sales_rep_id` có lấy từ JWT hay client body, authorization thực hiện thế nào | Product/Security/Integration |
| SFA là source of truth nào? | retailer, product, price, assignment và sync strategy | Business/Integration |
| Idempotency format | xác định header hay `client_order_id`, response khi retry | FE/BE |
| Fraud sync hay async | quyết định `200`/`202`, trạng thái, polling/webhook | Product/BE/Data/AI |
| Target order state machine | quyết định allowed transitions/UI/worker behavior | Business/BE |
| Promotion scope MVP | xác định API/quote rule và fields cần gửi | Business/Operations |
| Review owner/SLA | xác định `REVIEW_REQUIRED`, queue, permission và alerts | Operations |
| Data privacy/audit | GPS/device/PII có được phép thu thập/lưu bao lâu không | Business/Security/Legal |

## 8. Cách dùng tài liệu này

1. Review từng P0 use case cùng business và technical team.
2. Mỗi use case được accepted phải có business rule, acceptance criteria và owner.
3. Chỉ chọn một nhóm P0 đủ nhỏ cho M1; tránh làm hết bảng cùng lúc.
4. Map nhóm M1 thành API/event cụ thể trong `api-contract.md` và `openapi.yaml`.
5. Khi một use case bị thay đổi, cập nhật tài liệu này trước hoặc cùng lúc với contract để giữ traceability.
