import type { OrderStatus } from "../../contracts/orders";
import { formatStatus } from "./orderFormat";

interface StatusBadgeProps {
  status: OrderStatus;
}

const statusClassNames: Record<OrderStatus, string> = {
  PENDING_FRAUD_CHECK: "status-badge--pending",
  APPROVED: "status-badge--approved",
  REVIEW_REQUIRED: "status-badge--review",
  REJECTED: "status-badge--rejected",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`status-badge ${statusClassNames[status]}`}>
      {formatStatus(status)}
    </span>
  );
}
