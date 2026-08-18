# Tài liệu dự án FMCG Multi-Agent System

Thư mục này là nguồn tham chiếu cho phân tích, thiết kế, contract và vận hành M1 Order Intake. Domain rule và API contract được cập nhật cùng implementation; không suy luận contract từ source code một cách không kiểm soát.

## Vị trí trong repository

- Service Order Intake: [`../../services/order-intake`](../../services/order-intake)
- Web application: [`../../apps/web`](../../apps/web)
- Mobile application: [`../../apps/mobile`](../../apps/mobile)
- Public OpenAPI contract: [`../../contracts/openapi/order-intake.v1.yaml`](../../contracts/openapi/order-intake.v1.yaml)
- PostgreSQL local compose: [`../../infra/compose/postgres.local.yaml`](../../infra/compose/postgres.local.yaml)

## Thứ tự nên đọc

1. [Quy trình phát triển end-to-end](01-end-to-end-delivery-process.md): vòng đời đầy đủ từ bài toán đến vận hành.
2. [Workflow triển khai MVP](02-mvp-execution-workflow.md): scope, vertical slice và Definition of Done.
3. [Danh mục use case](03-use-case-catalog.md): actor, use case đề xuất, ưu tiên và loại giao diện cần thiết.
4. [M1 domain rules và state machine](04-domain-rules-and-state-machine.md): rule, trạng thái, event logic, acceptance scenario và decision log.
5. [M1 API Contract](05-api-contract.md): contract dễ đọc cho mobile app, order-intake service, QA và business review.
6. [M1 OpenAPI contract](../../contracts/openapi/order-intake.v1.yaml): đặc tả machine-readable tương ứng với API contract.
7. [M1 Local MVP Baseline](06-m1-local-baseline.md): quyết định có hiệu lực cho implementation local/demo.
8. [M1 Physical Data Model & Migration Plan](07-data-model-and-migration-plan.md): PostgreSQL schema, transaction boundary, seed và migration plan.
9. [M1 Local Development Runbook](08-m1-local-development-and-runbook.md): cách chạy, UAT checklist, validation evidence và release gate.

## Trạng thái implementation hiện tại

Order-intake service local M1 đã được triển khai và smoke-test qua luồng chính:

- `POST /api/v1/orders`, `GET /api/v1/orders`, `GET /api/v1/orders/{order_id}`.
- Local opaque bearer auth: `Bearer dev-hung-001` → `HUNG-001`.
- PostgreSQL SQLAlchemy model, Alembic revision `0001_m1_order_intake`, local seed master data.
- Transaction tạo order gồm item, history, idempotency record và database outbox.
- Fraud worker deterministic tạo assessment/audit và chuyển order sang `APPROVED`, `REVIEW_REQUIRED` hoặc `REJECTED`.
- Error envelope chuẩn, request ID, Swagger/OpenAPI runtime và static contract.

Đã pass compile, OpenAPI parse, PostgreSQL DDL generation, Compose config, SQLite temporary API/worker smoke và **live PostgreSQL integration**: Docker PostgreSQL healthy, Alembic migration/seed, HTTP create/retry/error/read UAT, outbox worker, audit/assessment và concurrent idempotency/client-order/reordered-items replay. Xem runbook trước khi demo.

Browser web app tại [`../../apps/web`](../../apps/web) đã triển khai create order, list/filter/detail, durable retry/idempotency bằng `localStorage`, polling fraud-status có backoff, deep link `/orders/{order_id}` và Vite proxy `/api` cho local. `npm run typecheck`, `npm run build` và `npm audit` là validation bắt buộc trước demo; production vẫn cần reverse proxy cùng origin hoặc CORS allowlist, browser identity/session thật và chiến lược multi-tab/storage phù hợp.

React Native/Expo mobile app tại [`../../apps/mobile`](../../apps/mobile) vẫn triển khai create order, durable retry/idempotency, list/detail, fraud-status polling và UI lỗi/config theo OpenAPI. `npm run typecheck` và Android static export đã pass. E2E trên emulator/physical device chưa chạy vì Android SDK Platform Tools (`adb`) và thiết bị/emulator chưa sẵn sàng; production identity, SFA/ERP integration, real fraud model, observability/CI và release controls vẫn ngoài scope local demo.

## Quy ước trạng thái tài liệu

- **Draft**: đang thảo luận, có thể thay đổi.
- **Baseline/Approved**: đã được team chốt cho phạm vi sprint hoặc release.
- **Deprecated**: không còn áp dụng; cần ghi rõ tài liệu thay thế.

Không coi một tài liệu là approved chỉ vì đã được tạo file. Mọi quyết định ảnh hưởng mobile app, service, QA hoặc nghiệp vụ phải được review trước khi implement sâu.
