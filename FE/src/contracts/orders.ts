export const ORDER_STATUSES = [
  "PENDING_FRAUD_CHECK",
  "APPROVED",
  "REVIEW_REQUIRED",
  "REJECTED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type FraudDecision = Exclude<OrderStatus, "PENDING_FRAUD_CHECK">;

export interface OrderItem {
  product_sku: string;
  quantity: number;
}

export interface OrderCreateRequest {
  client_order_id: string;
  retailer_id: string;
  order_time: string;
  items: OrderItem[];
  declared_total_amount_vnd: number;
}

export interface FraudAssessmentSummary {
  risk_score: number;
  decision: FraudDecision;
  reason_codes: string[];
  evaluator_type: string;
  evaluator_version: string;
  assessed_at: string;
}

export interface OrderAcceptedResponse {
  order_id: string;
  client_order_id: string;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
  fraud_assessment: FraudAssessmentSummary | null;
}

export interface OrderDetailResponse extends OrderAcceptedResponse {
  sales_rep_id: string;
  retailer_id: string;
  order_time: string;
  items: OrderItem[];
  declared_total_amount_vnd: number;
}

export interface OrderListItem {
  order_id: string;
  client_order_id: string;
  retailer_id: string;
  declared_total_amount_vnd: number;
  status: OrderStatus;
  order_time: string;
  updated_at: string;
}

export interface OrderListResponse {
  items: OrderListItem[];
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export interface ApiErrorDetail {
  field: string;
  reason: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details: ApiErrorDetail[];
    request_id?: string;
  };
}
