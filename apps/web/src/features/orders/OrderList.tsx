import type { OrderListItem, OrderStatus } from "../../contracts/orders";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime, formatVnd } from "./orderFormat";

export type StatusFilter = "ALL" | OrderStatus;

interface OrderListProps {
  orders: OrderListItem[];
  statusFilter: StatusFilter;
  totalItems: number;
  listLoading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onChangeFilter: (filter: StatusFilter) => void;
  onCreate: () => void;
  onLoadMore: () => void;
  onOpen: (orderId: string, knownStatus?: OrderStatus) => void;
}

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "Tất cả trạng thái" },
  { value: "PENDING_FRAUD_CHECK", label: "Đang kiểm tra" },
  { value: "APPROVED", label: "Đã duyệt" },
  { value: "REVIEW_REQUIRED", label: "Cần xem xét" },
  { value: "REJECTED", label: "Từ chối" },
];

export function OrderList({
  orders,
  statusFilter,
  totalItems,
  listLoading,
  loadingMore,
  hasMore,
  onChangeFilter,
  onCreate,
  onLoadMore,
  onOpen,
}: OrderListProps) {
  return (
    <section className="page-card" aria-labelledby="orders-title">
      <div className="page-heading page-heading--split">
        <div>
          <p className="eyebrow">Order Intake</p>
          <h1 id="orders-title">Đơn hàng của tôi</h1>
          <p>{totalItems} đơn thuộc sales representative local hiện tại.</p>
        </div>
        <button className="button button--primary" type="button" onClick={onCreate}>
          Tạo đơn mới
        </button>
      </div>

      <div className="list-toolbar">
        <label className="field filter-field">
          <span>Lọc trạng thái</span>
          <select
            value={statusFilter}
            onChange={(event) => onChangeFilter(event.target.value as StatusFilter)}
          >
            {FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {listLoading && orders.length === 0 ? (
        <div className="empty-state" role="status">Đang tải đơn hàng...</div>
      ) : orders.length === 0 ? (
        <div className="empty-state">
          <h2>Chưa có đơn phù hợp</h2>
          <p>Tạo đơn mới hoặc đổi bộ lọc để xem các order đã nhận.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="orders-table">
            <thead>
              <tr>
                <th>Client order ID</th>
                <th>Điểm bán</th>
                <th>Giá trị</th>
                <th>Trạng thái</th>
                <th>Cập nhật</th>
                <th><span className="sr-only">Thao tác</span></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.order_id}>
                  <td>
                    <button
                      className="table-link"
                      type="button"
                      onClick={() => onOpen(order.order_id, order.status)}
                    >
                      {order.client_order_id}
                    </button>
                  </td>
                  <td>{order.retailer_id}</td>
                  <td>{formatVnd(order.declared_total_amount_vnd)}</td>
                  <td><StatusBadge status={order.status} /></td>
                  <td>{formatDateTime(order.updated_at)}</td>
                  <td>
                    <button
                      className="button button--quiet button--small"
                      type="button"
                      onClick={() => onOpen(order.order_id, order.status)}
                    >
                      Chi tiết
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore ? (
        <div className="list-footer">
          <button
            className="button button--secondary"
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore || listLoading}
          >
            {loadingMore ? "Đang tải..." : "Tải thêm"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
