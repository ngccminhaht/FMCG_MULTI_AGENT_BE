import type { OrderDetailResponse } from "../../contracts/orders";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime, formatVnd } from "./orderFormat";

interface OrderDetailProps {
  order: OrderDetailResponse | null;
  loading: boolean;
  error: string | null;
  polling: boolean;
  pollFailureCount: number;
  onBack: () => void;
  onRefresh: () => void;
}

export function OrderDetail({
  order,
  loading,
  error,
  polling,
  pollFailureCount,
  onBack,
  onRefresh,
}: OrderDetailProps) {
  if (loading && !order) {
    return <section className="page-card empty-state" role="status">Đang tải chi tiết đơn...</section>;
  }

  if (!order) {
    return (
      <section className="page-card empty-state">
        <h1>Không thể tải đơn hàng</h1>
        <p>{error ?? "Order không tồn tại hoặc không còn truy cập được."}</p>
        <div className="form-actions">
          <button className="button button--quiet" type="button" onClick={onBack}>
            Về danh sách
          </button>
          <button className="button button--secondary" type="button" onClick={onRefresh} disabled={loading}>
            Thử lại
          </button>
        </div>
      </section>
    );
  }

  const assessment = order.fraud_assessment;

  return (
    <section className="page-card detail-card" aria-labelledby="order-detail-title">
      <div className="detail-heading">
        <div>
          <button className="back-link" type="button" onClick={onBack}>
            Danh sách đơn
          </button>
          <p className="eyebrow">Order detail</p>
          <h1 id="order-detail-title">{order.client_order_id}</h1>
          <p>{order.order_id}</p>
        </div>
        <div className="detail-actions">
          <StatusBadge status={order.status} />
          <button className="button button--secondary" type="button" onClick={onRefresh} disabled={loading}>
            {loading ? "Đang tải..." : "Làm mới"}
          </button>
        </div>
      </div>

      {polling ? (
        <p className="polling-notice" role="status">
          Fraud worker chưa hoàn tất. Web client đang kiểm tra lại trạng thái tự động.
          {pollFailureCount > 0 ? ` Lần chờ lại thứ ${pollFailureCount + 1}.` : ""}
        </p>
      ) : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}

      <dl className="detail-summary">
        <div><dt>Sales representative</dt><dd>{order.sales_rep_id}</dd></div>
        <div><dt>Điểm bán</dt><dd>{order.retailer_id}</dd></div>
        <div><dt>Thời điểm tạo đơn</dt><dd>{formatDateTime(order.order_time)}</dd></div>
        <div><dt>Giá trị khai báo</dt><dd>{formatVnd(order.declared_total_amount_vnd)}</dd></div>
        <div><dt>Server nhận lúc</dt><dd>{formatDateTime(order.created_at)}</dd></div>
        <div><dt>Cập nhật gần nhất</dt><dd>{formatDateTime(order.updated_at)}</dd></div>
      </dl>

      <div className="detail-section">
        <h2>Sản phẩm</h2>
        <div className="table-scroll">
          <table className="orders-table orders-table--compact">
            <thead><tr><th>SKU</th><th>Số lượng</th></tr></thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.product_sku}><td>{item.product_sku}</td><td>{item.quantity}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="detail-section fraud-section">
        <h2>Fraud assessment</h2>
        {assessment ? (
          <dl className="detail-summary detail-summary--assessment">
            <div><dt>Decision</dt><dd><StatusBadge status={assessment.decision} /></dd></div>
            <div><dt>Risk score</dt><dd>{assessment.risk_score}</dd></div>
            <div><dt>Reason code</dt><dd>{assessment.reason_codes.join(", ")}</dd></div>
            <div><dt>Evaluator</dt><dd>{assessment.evaluator_type} · {assessment.evaluator_version}</dd></div>
            <div><dt>Đánh giá lúc</dt><dd>{formatDateTime(assessment.assessed_at)}</dd></div>
          </dl>
        ) : (
          <p>Chưa có assessment. `PENDING_FRAUD_CHECK` sẽ được cập nhật khi worker hoàn tất.</p>
        )}
      </div>
    </section>
  );
}
