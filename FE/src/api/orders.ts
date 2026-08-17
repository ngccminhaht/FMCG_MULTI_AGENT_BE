import {
  ORDER_STATUSES,
  type FraudAssessmentSummary,
  type OrderAcceptedResponse,
  type OrderCreateRequest,
  type OrderDetailResponse,
  type OrderItem,
  type OrderListItem,
  type OrderListResponse,
  type OrderStatus,
} from "../contracts/orders";
import { ApiClientError, requestJson } from "./http";

const ORDERS_PATH = "/api/v1/orders";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC_3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface CreateOrderResult {
  order: OrderAcceptedResponse;
  idempotencyReplayed: boolean;
}

export interface ListOrdersOptions {
  status?: OrderStatus;
  retailerId?: string;
  page?: number;
  pageSize?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasNonEmptyString(
  value: Record<string, unknown>,
  property: string,
): boolean {
  return typeof value[property] === "string" && value[property].trim().length > 0;
}

function isSafeInteger(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isRfc3339DateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    RFC_3339_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    (ORDER_STATUSES as readonly string[]).includes(value)
  );
}

function isOrderItem(value: unknown): value is OrderItem {
  return (
    isRecord(value) &&
    hasNonEmptyString(value, "product_sku") &&
    isSafeInteger(value.quantity, 1)
  );
}

function isFraudAssessmentSummary(
  value: unknown,
): value is FraudAssessmentSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isSafeInteger(value.risk_score, 0) &&
    value.risk_score <= 100 &&
    isOrderStatus(value.decision) &&
    value.decision !== "PENDING_FRAUD_CHECK" &&
    Array.isArray(value.reason_codes) &&
    value.reason_codes.length > 0 &&
    value.reason_codes.every(
      (reasonCode) =>
        typeof reasonCode === "string" && reasonCode.trim().length > 0,
    ) &&
    hasNonEmptyString(value, "evaluator_type") &&
    hasNonEmptyString(value, "evaluator_version") &&
    isRfc3339DateTime(value.assessed_at)
  );
}

function isOrderAcceptedResponse(value: unknown): value is OrderAcceptedResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isUuid(value.order_id) &&
    hasNonEmptyString(value, "client_order_id") &&
    isOrderStatus(value.status) &&
    isRfc3339DateTime(value.created_at) &&
    isRfc3339DateTime(value.updated_at) &&
    (value.fraud_assessment === null ||
      isFraudAssessmentSummary(value.fraud_assessment))
  );
}

function isOrderDetailResponse(value: unknown): value is OrderDetailResponse {
  return (
    isOrderAcceptedResponse(value) &&
    isRecord(value) &&
    hasNonEmptyString(value, "sales_rep_id") &&
    hasNonEmptyString(value, "retailer_id") &&
    isRfc3339DateTime(value.order_time) &&
    Array.isArray(value.items) &&
    value.items.length > 0 &&
    value.items.every(isOrderItem) &&
    isSafeInteger(value.declared_total_amount_vnd, 1)
  );
}

function isOrderListItem(value: unknown): value is OrderListItem {
  return (
    isRecord(value) &&
    isUuid(value.order_id) &&
    hasNonEmptyString(value, "client_order_id") &&
    hasNonEmptyString(value, "retailer_id") &&
    isSafeInteger(value.declared_total_amount_vnd, 1) &&
    isOrderStatus(value.status) &&
    isRfc3339DateTime(value.order_time) &&
    isRfc3339DateTime(value.updated_at)
  );
}

function isOrderListResponse(value: unknown): value is OrderListResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isOrderListItem) &&
    isSafeInteger(value.page, 1) &&
    isSafeInteger(value.page_size, 1) &&
    isSafeInteger(value.total_items, 0) &&
    isSafeInteger(value.total_pages, 0)
  );
}

export async function createOrder(
  request: OrderCreateRequest,
  idempotencyKey: string,
): Promise<CreateOrderResult> {
  const response = await requestJson<OrderAcceptedResponse>(ORDERS_PATH, {
    method: "POST",
    headers: {
      "Idempotency-Key": idempotencyKey,
    },
    body: request,
    expectedStatus: 202,
    validateResponse: isOrderAcceptedResponse,
  });

  if (response.data.client_order_id !== request.client_order_id) {
    throw new ApiClientError(
      "The API accepted a different client order. The original retry entry was preserved.",
      202,
      "UNMATCHED_ACCEPTED_ORDER",
    );
  }

  return {
    order: response.data,
    idempotencyReplayed:
      response.headers.get("Idempotency-Replayed")?.toLowerCase() === "true",
  };
}

export async function listOrders(
  options: ListOrdersOptions = {},
): Promise<OrderListResponse> {
  const query: string[] = [];
  if (options.status) {
    query.push(`status=${encodeURIComponent(options.status)}`);
  }
  if (options.retailerId) {
    query.push(`retailer_id=${encodeURIComponent(options.retailerId)}`);
  }
  query.push(`page=${options.page ?? 1}`);
  query.push(`page_size=${options.pageSize ?? 20}`);

  const response = await requestJson<OrderListResponse>(
    `${ORDERS_PATH}?${query.join("&")}`,
    {
      expectedStatus: 200,
      validateResponse: isOrderListResponse,
    },
  );
  return response.data;
}

export async function getOrder(orderId: string): Promise<OrderDetailResponse> {
  const response = await requestJson<OrderDetailResponse>(
    `${ORDERS_PATH}/${encodeURIComponent(orderId)}`,
    {
      expectedStatus: 200,
      validateResponse: isOrderDetailResponse,
    },
  );
  return response.data;
}
