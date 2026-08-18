import { ApiClientError, requestJson } from "./http";
import {
  FRAUD_DECISIONS,
  ORDER_STATUSES,
  type FraudAssessmentSummary,
  type FraudDecision,
  type OrderAcceptedResponse,
  type OrderCreateRequest,
  type OrderDetailResponse,
  type OrderItem,
  type OrderListItem,
  type OrderListResponse,
  type OrderStatus,
} from "../contracts/orders";

const API_PREFIX = "/api/v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export interface ListOrdersOptions {
  status?: OrderStatus;
  retailerId?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateOrderResult {
  order: OrderAcceptedResponse;
  idempotencyReplayed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isRfc3339DateTime(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match = value.match(RFC3339_PATTERN);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const timeZone = match[7];
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }

  if (timeZone !== "Z") {
    const offsetHour = Number(timeZone.slice(1, 3));
    const offsetMinute = Number(timeZone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      return false;
    }
  }

  return Number.isFinite(Date.parse(value));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRiskScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 100
  );
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && ORDER_STATUSES.includes(value as OrderStatus);
}

function isFraudDecision(value: unknown): value is FraudDecision {
  return typeof value === "string" && FRAUD_DECISIONS.includes(value as FraudDecision);
}

function isOrderItem(value: unknown): value is OrderItem {
  return (
    isRecord(value) &&
    isNonEmptyString(value.product_sku) &&
    isPositiveSafeInteger(value.quantity)
  );
}

function isFraudAssessment(value: unknown): value is FraudAssessmentSummary {
  return (
    isRecord(value) &&
    isRiskScore(value.risk_score) &&
    isFraudDecision(value.decision) &&
    Array.isArray(value.reason_codes) &&
    value.reason_codes.length > 0 &&
    value.reason_codes.every(isNonEmptyString) &&
    isNonEmptyString(value.evaluator_type) &&
    isNonEmptyString(value.evaluator_version) &&
    isRfc3339DateTime(value.assessed_at)
  );
}

function isOrderAcceptedResponse(value: unknown): value is OrderAcceptedResponse {
  if (
    !isRecord(value) ||
    !isUuid(value.order_id) ||
    !isNonEmptyString(value.client_order_id) ||
    !isOrderStatus(value.status) ||
    !isRfc3339DateTime(value.created_at) ||
    !isRfc3339DateTime(value.updated_at)
  ) {
    return false;
  }

  const assessment = value.fraud_assessment;
  if (value.status === "PENDING_FRAUD_CHECK") {
    return assessment === null;
  }

  return isFraudAssessment(assessment) && assessment.decision === value.status;
}

function isOrderListItem(value: unknown): value is OrderListItem {
  return (
    isRecord(value) &&
    isUuid(value.order_id) &&
    isNonEmptyString(value.client_order_id) &&
    isNonEmptyString(value.retailer_id) &&
    isPositiveSafeInteger(value.declared_total_amount_vnd) &&
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
    isPositiveSafeInteger(value.page) &&
    isPositiveSafeInteger(value.page_size) &&
    value.page_size <= 100 &&
    isNonNegativeSafeInteger(value.total_items) &&
    isNonNegativeSafeInteger(value.total_pages)
  );
}

function isOrderDetailResponse(value: unknown): value is OrderDetailResponse {
  if (!isRecord(value) || !isOrderAcceptedResponse(value)) {
    return false;
  }

  const detail = value as unknown as Record<string, unknown>;
  return (
    isNonEmptyString(detail.sales_rep_id) &&
    isNonEmptyString(detail.retailer_id) &&
    isRfc3339DateTime(detail.order_time) &&
    Array.isArray(detail.items) &&
    detail.items.length > 0 &&
    detail.items.every(isOrderItem) &&
    isPositiveSafeInteger(detail.declared_total_amount_vnd)
  );
}

export async function listOrders(
  options: ListOrdersOptions = {},
): Promise<OrderListResponse> {
  const parameters = new URLSearchParams({
    page: String(options.page ?? 1),
    page_size: String(options.pageSize ?? 20),
  });
  if (options.status) {
    parameters.set("status", options.status);
  }
  if (options.retailerId) {
    parameters.set("retailer_id", options.retailerId);
  }

  const response = await requestJson<OrderListResponse>(
    `${API_PREFIX}/orders?${parameters.toString()}`,
    { expectedStatus: 200, validateResponse: isOrderListResponse },
  );
  return response.data;
}

export async function getOrder(orderId: string): Promise<OrderDetailResponse> {
  const response = await requestJson<OrderDetailResponse>(
    `${API_PREFIX}/orders/${encodeURIComponent(orderId)}`,
    { expectedStatus: 200, validateResponse: isOrderDetailResponse },
  );
  return response.data;
}

export async function createOrder(
  request: OrderCreateRequest,
  idempotencyKey: string,
): Promise<CreateOrderResult> {
  const response = await requestJson<OrderAcceptedResponse>(`${API_PREFIX}/orders`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: request,
    expectedStatus: 202,
    validateResponse: isOrderAcceptedResponse,
  });

  if (response.data.client_order_id !== request.client_order_id) {
    throw new ApiClientError(
      "API trả về order không khớp với request đang chờ retry; web client giữ queue để tránh mất dữ liệu.",
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
