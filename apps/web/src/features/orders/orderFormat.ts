import type { OrderStatus } from "../../contracts/orders";

export const LOCAL_RETAILER = {
  id: "CO-LAN-001",
  name: "Cô Lan Store",
} as const;

export const LOCAL_PRODUCTS = [
  { sku: "SKU-NUOC-NGOT-001", name: "Nước ngọt" },
  { sku: "SKU-MI-GOI-001", name: "Mì gói" },
] as const;

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_FRAUD_CHECK: "Đang kiểm tra",
  APPROVED: "Đã duyệt",
  REVIEW_REQUIRED: "Cần xem xét",
  REJECTED: "Từ chối",
};

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const currencyFormatter = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

export function formatStatus(status: OrderStatus): string {
  return STATUS_LABELS[status];
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateTimeFormatter.format(date) : value;
}

export function formatVnd(value: number): string {
  return currencyFormatter.format(value);
}

export function toDateTimeLocalValue(date = new Date()): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

export function createWebClientOrderId(): string {
  const now = new Date();
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8).toUpperCase()
      : Math.random().toString(36).slice(2, 10).toUpperCase();
  return `WEB-${day}-${suffix}`;
}
