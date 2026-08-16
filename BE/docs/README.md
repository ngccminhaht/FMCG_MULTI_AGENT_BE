# Tài liệu dự án FMCG Multi-Agent System

Thư mục này là nguồn tham chiếu cho cách phân tích, thiết kế và triển khai dự án. Tài liệu nghiệp vụ và contract được xem là nguồn sự thật trước khi mở rộng feature code.

## Thứ tự nên đọc

1. [Quy trình phát triển end-to-end](01-end-to-end-delivery-process.md): vòng đời đầy đủ từ bài toán đến vận hành.
2. [Workflow triển khai MVP](02-mvp-execution-workflow.md): việc cần làm ngay, phạm vi MVP và cách triển khai từng vertical slice.
3. [Danh mục use case](03-use-case-catalog.md): actor, use case đề xuất, ưu tiên và loại giao diện cần thiết.
4. [M1 domain rules và state machine](04-domain-rules-and-state-machine.md): rule, trạng thái, event logic, acceptance scenario và decision log cho MVP đầu tiên.
5. [M1 API Contract](05-api-contract.md): bản contract dễ đọc cho FE, BE, QA và business review.
6. [M1 OpenAPI Draft](openapi.yaml): đặc tả machine-readable tương ứng với API Contract.

Tài liệu dự kiến bổ sung khi M1 được baseline và đi vào implementation:

```text
06-data-model-and-erd.md
07-test-strategy.md
08-local-development-and-runbook.md
```

## Trạng thái source hiện tại

Source hiện có là **prototype FastAPI**, không phải MVP production-ready:

- Có một endpoint `POST /api/v1/orders`.
- Request được validate bởi Pydantic.
- Đơn chỉ được lưu tạm trong RAM; restart ứng dụng sẽ mất dữ liệu.
- Fraud check là mock async, luôn trả `risk_score = 15` và `APPROVED`.
- Chưa có authentication, authorization, PostgreSQL, migration, queue/worker, real AI agent, endpoint tra cứu đơn hay test suite.

Vì vậy, code hiện tại là baseline để học và thử luồng. Các tài liệu trong thư mục này sẽ quyết định cách thay thế phần mock bằng implementation thật theo từng vertical slice.

## Quy ước trạng thái tài liệu

- **Draft**: đang thảo luận, có thể thay đổi.
- **Baseline/Approved**: đã được team chốt cho phạm vi sprint hoặc release.
- **Deprecated**: không còn áp dụng; cần ghi rõ tài liệu thay thế.

Không coi một tài liệu là approved chỉ vì đã được tạo file. Mọi quyết định ảnh hưởng FE, BE, QA hoặc nghiệp vụ phải được review trước khi implement sâu.
