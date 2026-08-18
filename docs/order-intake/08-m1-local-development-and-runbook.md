# M1 — Local Development Runbook and Release Checklist

**Trạng thái:** Baseline vận hành cho local/demo M1  
**Phạm vi:** Order-intake service cùng browser web app và React Native/Expo mobile app local. Không phải runbook production.

## 1. Mục đích và giới hạn

Runbook này cho phép một developer hoặc QA dựng lại và xác nhận luồng M1:

```text
POST order → 202 PENDING_FRAUD_CHECK → fraud outbox worker
→ GET detail/list → APPROVED | REVIEW_REQUIRED | REJECTED
```

Nó áp dụng cùng các quyết định tại [Local baseline](06-m1-local-baseline.md), [API contract](05-api-contract.md) và [migration plan](07-data-model-and-migration-plan.md).

Các giới hạn phải hiển thị rõ trong mọi demo:

- Token `dev-hung-001`, seed master data và fraud rule là **local demo only**.
- Fraud evaluator là deterministic mock/rule engine, không phải AI/ML production.
- Database mục tiêu là PostgreSQL. SQLite chỉ được dùng cho smoke test tạm thời trong quá trình phát triển, không thay thế PostgreSQL.
- Browser web app nằm tại [`../../apps/web`](../../apps/web) và React Native/Expo mobile app nằm tại [`../../apps/mobile`](../../apps/mobile); Swagger, curl hoặc PowerShell vẫn hữu ích để xác nhận order-intake service độc lập. Các client này không phải frontend production.

## 2. Điều kiện trước khi chạy

- Python và `pip` có sẵn trong PowerShell.
- Node.js/npm có sẵn khi chạy React Native client.
- Docker Desktop đang chạy và Docker daemon truy cập được.
- Port `5432` chưa bị PostgreSQL khác chiếm; API mặc định dùng port `8000`.

Từ root repository, vào service và cài Python dependencies:

```powershell
Set-Location services/order-intake
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --requirement requirements.txt
```

`.env.example` là danh sách giá trị local. Service đọc biến môi trường của process; không tự nạp file `.env`. Giá trị mặc định trong code đã khớp profile local. Nếu cần override trong PowerShell hiện tại, đặt biến trước khi chạy lệnh, ví dụ:

```powershell
$env:DATABASE_URL = "postgresql+psycopg://fmcg:fmcg@localhost:5432/fmcg_mvp"
$env:DEV_SALES_TOKEN = "dev-hung-001"
```

## 3. Dựng local stack

### 3.1 Khởi động PostgreSQL

Từ thư mục `services/order-intake/`, sau khi Docker Desktop đã sẵn sàng:

```powershell
docker compose -f ../../infra/compose/postgres.local.yaml up -d
docker compose -f ../../infra/compose/postgres.local.yaml ps
```

Chỉ tiếp tục khi service `postgres` healthy/running. Nếu cần xem nguyên nhân chưa healthy:

```powershell
docker compose -f ../../infra/compose/postgres.local.yaml logs postgres
```

### 3.2 Áp migration và seed dữ liệu

Từ `services/order-intake/`:

```powershell
alembic -c alembic.ini upgrade head
python -m app.db.seed
```

Seed idempotent, tạo profile local sau:

| Loại | ID |
|---|---|
| Sales representative | `HUNG-001` |
| Retailer | `CO-LAN-001` |
| Product | `SKU-NUOC-NGOT-001`, `SKU-MI-GOI-001` |
| Assignment | `HUNG-001` → `CO-LAN-001` |

### 3.3 Chạy API và worker

Mở hai PowerShell terminal riêng trong `services/order-intake/`.

**Terminal API — Android emulator / máy local** (lệnh dài hạn, chạy thủ công):

```powershell
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Physical device trên trusted LAN**: chỉ dùng cho local demo/UAT. Mở firewall Windows cho port `8000`, dùng LAN IP của máy chạy API trong `EXPO_PUBLIC_API_BASE_URL`, và không dùng profile/token này cho production.

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal worker**:

```powershell
# Xử lý các event hiện có rồi thoát; phù hợp để demo/UAT có kiểm soát.
python -m app.workers.fraud_worker --once

# Hoặc chạy poller liên tục trong local development.
python -m app.workers.fraud_worker
```

Kiểm tra API và Swagger:

```text
Health:  http://127.0.0.1:8000/health
Swagger: http://127.0.0.1:8000/docs
Runtime OpenAPI: http://127.0.0.1:8000/openapi.json
Static contract: ../../contracts/openapi/order-intake.v1.yaml
```

### 3.4 Chạy React Native/Expo M1 mobile app

Trong một PowerShell khác, từ root repository, tạo cấu hình local từ template nếu chưa có `.env`:

```powershell
Set-Location apps/mobile
Copy-Item .env.example .env
```

Đặt `EXPO_PUBLIC_API_BASE_URL` theo môi trường chạy app:

- Android emulator: `http://10.0.2.2:8000`.
- iOS simulator: `http://localhost:8000`.
- Physical device: `http://<LAN-IP-của-máy-chạy-API>:8000` và API phải chạy theo trusted-LAN profile ở trên.

Cài dependencies một lần và chạy app Android thủ công sau khi API/worker đã chạy:

```powershell
npm install
npm run android
```

`npm run android` là dev server dài hạn, nên chạy trực tiếp trong terminal của developer thay vì automation. Client lưu chính xác request body và `Idempotency-Key` vào AsyncStorage trước `POST`; nếu mất mạng hoặc API timeout, dùng retry queue trong app thay vì tạo request mới.

## 4. Happy-path demo bằng PowerShell

Tạo một order mức rủi ro thấp. Token local và retailer/SKU phải đúng profile seed. Các lệnh worker trong phần này được chạy từ `services/order-intake/`.

```powershell
$baseUrl = "http://127.0.0.1:8000/api/v1"
$headers = @{
    Authorization = "Bearer dev-hung-001"
    "Idempotency-Key" = [guid]::NewGuid().ToString()
}
$body = @{
    client_order_id = "MANUAL-DEMO-001"
    retailer_id = "CO-LAN-001"
    order_time = "2024-01-02T10:00:00+07:00"
    items = @(
        @{ product_sku = "SKU-NUOC-NGOT-001"; quantity = 1 }
    )
    declared_total_amount_vnd = 150000
} | ConvertTo-Json -Depth 5

$order = Invoke-RestMethod -Method Post -Uri "$baseUrl/orders" -Headers $headers -ContentType "application/json" -Body $body
$order
```

Kết quả đầu tiên phải có `status = PENDING_FRAUD_CHECK`. Chạy worker một lần, sau đó đọc lại order:

```powershell
python -m app.workers.fraud_worker --once
Invoke-RestMethod -Uri "$baseUrl/orders/$($order.order_id)" -Headers @{ Authorization = "Bearer dev-hung-001" }
Invoke-RestMethod -Uri "$baseUrl/orders?status=APPROVED" -Headers @{ Authorization = "Bearer dev-hung-001" }
```

Lần tạo lại với **cùng** body và `Idempotency-Key` phải trả cùng `order_id`; response header `Idempotency-Replayed` sẽ là `true`. Cùng key nhưng sửa body phải trả `409 IDEMPOTENCY_KEY_REUSED`.

## 5. Fraud rule matrix local

Worker áp dụng condition đầu tiên khớp trong bảng dưới đây:

| Input | Expected status | Risk score | Reason code |
|---|---|---:|---|
| `order_time` từ 22:00 đến trước 05:00 theo offset client | `REVIEW_REQUIRED` | 75 | `OUTSIDE_STANDARD_ORDER_HOURS` |
| Amount `>= 20,000,000` VND | `REJECTED` | 95 | `AMOUNT_ABOVE_REJECTION_THRESHOLD` |
| Amount `>= 5,000,000` VND | `REVIEW_REQUIRED` | 60 | `AMOUNT_ABOVE_REVIEW_THRESHOLD` |
| Các trường hợp khác | `APPROVED` | 15 | `MOCK_LOW_RISK` |
| Evaluator lỗi sau số retry cấu hình | `REVIEW_REQUIRED` | 100 | `FRAUD_EVALUATION_UNAVAILABLE` |

`OUTSIDE_STANDARD_ORDER_HOURS` có precedence cao hơn amount rule. Không mô tả những kết quả này là fraud decision production.

## 6. UAT checklist M1

Đánh dấu pass trên PostgreSQL local trước khi demo end-to-end:

| ID | Action | Expected result |
|---|---|---|
| UAT-01 | `GET /health` | `200`, `status: ok`, có `X-Request-Id`. |
| UAT-02 | POST valid order | `202`, `PENDING_FRAUD_CHECK`, `Location` và `Idempotency-Replayed: false`. |
| UAT-03 | Retry chính xác UAT-02 | Cùng `order_id`, không có order/outbox mới, `Idempotency-Replayed: true`. |
| UAT-04 | Reuse key với body khác | `409 IDEMPOTENCY_KEY_REUSED`, envelope có `request_id`. |
| UAT-05 | Retailer không assigned/inactive | `403 RETAILER_NOT_ASSIGNED`, không ghi order. |
| UAT-06 | Duplicate SKU, amount/quantity invalid, future time hoặc page invalid | `422 VALIDATION_ERROR`, không ghi order đối với POST invalid. |
| UAT-07 | Worker xử lý order low-risk | `APPROVED`, có fraud assessment/history, outbox `PUBLISHED`. |
| UAT-08 | Worker xử lý order ngoài giờ | `REVIEW_REQUIRED` với reason code ngoài giờ. |
| UAT-09 | Worker xử lý amount cao | `REJECTED` với reason code amount threshold. |
| UAT-10 | GET list/detail với token local | Chỉ trả order của `HUNG-001`; filter `status`, `retailer_id`, phân trang đúng. |
| UAT-11 | GET order UUID không tồn tại | `404 ORDER_NOT_FOUND`, không lộ dữ liệu sale khác. |
| UAT-12 | Dừng API/worker sau khi POST rồi chạy lại worker | Event pending vẫn được xử lý; order không mất. |
| UAT-13 | React Native: submit valid order, chờ status đổi, mở list/detail | `202` được tạo qua app; polling đạt terminal state; list/detail hiển thị đúng. |
| UAT-14 | React Native: ngắt API lúc submit/retry rồi khôi phục | Queue giữ nguyên body và `Idempotency-Key`; retry tạo/replay đúng một order. |

Worker failure safety (`FRAUD_EVALUATION_UNAVAILABLE`) đã được smoke-test qua fault injection nội bộ. UAT thủ công chỉ nên thực hiện case này nếu có một cách fault injection được review; không thêm public endpoint chỉ để gây lỗi.

## 7. Validation evidence hiện có

Các validation sau đã chạy trên source hiện tại:

| Check | Kết quả |
|---|---|
| `python -m compileall -q app alembic` trong `services/order-intake/` | Pass |
| Parse `contracts/openapi/order-intake.v1.yaml` | Pass |
| FastAPI/SQLite temporary smoke | Pass: create, idempotency, worker 3 outcome, audit, list/detail, error contract, Swagger schema, simulated 503 |
| `alembic -c alembic.ini upgrade head --sql` trong `services/order-intake/` | Pass: PostgreSQL DDL generation |
| `alembic -c alembic.ini heads` trong `services/order-intake/` | Pass: `0001_m1_order_intake` là head |
| `docker compose -f infra/compose/postgres.local.yaml config` từ root repository | Pass |
| `npm run typecheck` trong `apps/mobile/` | Pass |
| `npx expo export --platform android --output-dir dist` trong `apps/mobile/` | Pass |
| PostgreSQL container migration + HTTP/worker smoke thực tế | Pass: Docker PostgreSQL healthy, Alembic migration/seed, 202 create, 401/403/404/409/422 envelope, idempotency replay/conflict, list/detail, three fraud outcomes, audit/outbox `PUBLISHED`, concurrent retries và reordered-items replay |
| React Native emulator/physical-device E2E | Chưa chạy: Android SDK Platform Tools (`adb`) và thiết bị/emulator chưa có; order-intake service PostgreSQL live hiện đã sẵn sàng |

Live PostgreSQL integration đã hoàn tất. Không coi Android static export là bằng chứng thay thế device E2E; khi có `adb` và emulator/physical device, chạy UAT-13 và UAT-14 theo section 6.

## 8. Release gate

### Local/demo ready khi

- Docker PostgreSQL healthy, migration và seed đã chạy.
- UAT-01 đến UAT-12 đạt; UAT-13 và UAT-14 cần đạt hoặc có exception được owner chấp thuận trước demo trên device.
- API/worker dùng local token và seed data được giới hạn trong môi trường demo.
- [`contracts/openapi/order-intake.v1.yaml`](../../contracts/openapi/order-intake.v1.yaml) và `/openapi.json` được review sau cùng với implementation.

### Không được gọi là production-ready khi còn bất kỳ điểm nào sau đây

- Chưa thay opaque dev token bằng JWT/SFA identity adapter, secret management và role policy thật.
- Chưa chốt master-data integration, pricing/inventory authority và retention/PII policy.
- Fraud rule còn là mock; chưa có governance, monitoring false positive/negative hay supervisor review M2.
- Chưa có worker deployment/scaling, DLQ, metrics, alerting, backup/restore, CI và automated regression suite.
- Chưa chạy React Native E2E UAT từ emulator/physical device; client hiện được xác nhận bằng typecheck và Android static export, còn order-intake service đã có PostgreSQL live UAT.

## 9. An toàn dữ liệu local và troubleshooting

- Không đưa credentials production, PII, GPS hoặc device metadata vào profile demo.
- Không chạy `docker compose down -v` trong thao tác bình thường: cờ `-v` xoá PostgreSQL volume và toàn bộ dữ liệu local.
- `alembic downgrade base` chỉ dùng trên database local rỗng/đã backup; nó drop schema M1.
- Nếu Docker báo lỗi kết nối `npipe:////./pipe/dockerDesktopLinuxEngine`, hãy khởi động Docker Desktop, chờ engine sẵn sàng rồi chạy lại `docker compose -f ../../infra/compose/postgres.local.yaml up -d`. Không cần đổi migration hoặc đổi PostgreSQL sang SQLite để né lỗi này.
- Nếu port bị chiếm, xác định process hoặc override port/database URL có chủ đích; không xoá volume để xử lý lỗi port.
## 10. Browser web client

### 10.1 Chạy local

Sau khi API và worker đã chạy theo section 3.3, mở một PowerShell khác từ root repository:

```powershell
Set-Location apps/web
Copy-Item .env.example .env
npm install
npm run dev
```

`npm run dev` là Vite dev server dài hạn; chạy thủ công trong terminal của developer. Mở `http://localhost:5173/orders` trong browser. Route `/orders`, `/orders/new` và `/orders/{order_id}` là browser routes; production static host phải cấu hình SPA fallback về `index.html`.

Cấu hình local mặc định trong `.env`:

```dotenv
VITE_API_BASE_URL=
VITE_LOCAL_SALES_TOKEN=dev-hung-001
API_PROXY_TARGET=http://127.0.0.1:8000
```

Khi `VITE_API_BASE_URL` để trống, browser gọi same-origin `/api` và Vite proxy request sang `API_PROXY_TARGET`; cách này cho phép các header `Authorization` và `Idempotency-Key` hoạt động trong local mà không cần CORS trong service. Restart Vite sau khi đổi `.env`.

Không đặt production bearer token vào biến `VITE_*`: các giá trị này được bundle vào JavaScript browser. Nếu dùng `VITE_API_BASE_URL=http://localhost:8000` để gọi API trực tiếp, browser sẽ cần CORS; Order Intake service hiện chưa có CORS allowlist. Deployment phải dùng reverse proxy cùng origin hoặc thêm CORS allowlist review riêng, gồm origin, methods, request headers và exposed response headers cần thiết.

### 10.2 Hành vi web client M1

- Form tạo order dùng seed retailer `CO-LAN-001` và hai SKU local; không dùng dữ liệu này cho production.
- Trước `POST`, web app lưu exact request body, UUID `Idempotency-Key` và thời điểm tạo vào `localStorage`. Retry luôn tái sử dụng cùng body/key.
- `202 Accepted` chỉ nghĩa là order đã được nhận và đang chờ fraud worker; trang chi tiết poll với backoff 3, 6, 12, 24 rồi tối đa 30 giây, và dừng ở final/terminal error/rời trang.
- Retry queue chạy tuần tự khi người dùng bấm **Retry queue**. Error mạng, timeout, `5xx`, `408` và `429` giữ request; `401` giữ request nhưng chặn retry; các `4xx` khác yêu cầu sửa request và được xử lý như terminal failure.
- Queue có serialization trong tab và dùng Web Locks khi browser hỗ trợ; trước production vẫn cần chốt chính sách multi-tab, browser session/token storage và persistence/retention.

### 10.3 Kiểm tra trước demo web

Từ `apps/web/`:

```powershell
npm run typecheck
npm run build
npm audit
```

Manual UAT browser cần xác nhận các case sau trên PostgreSQL local:

| ID | Action | Expected result |
|---|---|---|
| WEB-UAT-01 | Tạo valid order trên browser, chạy worker, mở lại detail | Nhận đúng `202`, trạng thái đi từ `PENDING_FRAUD_CHECK` sang final state, list/detail khớp API. |
| WEB-UAT-02 | Ngắt API hoặc làm request timeout khi submit, reload browser rồi bấm retry | `localStorage` giữ nguyên body và `Idempotency-Key`; retry tạo/replay đúng một order. |
| WEB-UAT-03 | Gửi request terminal-invalid và request với token sai | Terminal request yêu cầu sửa data; `401` không làm mất queue entry. |
| WEB-UAT-04 | Mở trực tiếp `/orders/{order_id}` và dùng Back/Forward | Detail load đúng khi dev server có SPA fallback; navigation không để poll cũ ghi đè state mới. |
| WEB-UAT-05 | Mở app qua direct cross-origin API URL | Chỉ pass khi backend có CORS allowlist; local profile mặc định dùng Vite proxy thay vì direct CORS. |
