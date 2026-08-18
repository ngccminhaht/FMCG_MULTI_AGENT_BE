import { runtimeConfig } from "../config/environment";
import type { ApiErrorDetail, ApiErrorResponse } from "../contracts/orders";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly code: string,
    public readonly details: ApiErrorDetail[] = [],
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface ApiRequestOptions<T = unknown> {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatus?: number | readonly number[];
  timeoutMs?: number;
  validateResponse?: (value: unknown) => value is T;
}

export interface ApiResponse<T> {
  data: T;
  headers: Headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseApiError(value: unknown): ApiErrorResponse | null {
  if (!isRecord(value) || !isRecord(value.error)) {
    return null;
  }

  const error = value.error;
  if (typeof error.code !== "string" || typeof error.message !== "string") {
    return null;
  }

  const details: ApiErrorDetail[] = [];
  if (Array.isArray(error.details)) {
    for (const detail of error.details) {
      if (
        isRecord(detail) &&
        typeof detail.field === "string" &&
        typeof detail.reason === "string"
      ) {
        details.push({ field: detail.field, reason: detail.reason });
      }
    }
  }

  return {
    error: {
      code: error.code,
      message: error.message,
      details,
      ...(typeof error.request_id === "string"
        ? { request_id: error.request_id }
        : {}),
    },
  };
}

function parseJsonBody(body: string): unknown {
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function apiUrl(path: string): string {
  return `${runtimeConfig.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function hasExpectedStatus(
  status: number,
  expectedStatus: number | readonly number[] | undefined,
): boolean {
  if (expectedStatus === undefined) {
    return true;
  }

  return Array.isArray(expectedStatus)
    ? expectedStatus.includes(status)
    : expectedStatus === status;
}

export async function requestJson<T>(
  path: string,
  options: ApiRequestOptions<T> = {},
): Promise<ApiResponse<T>> {
  const requestHeaders: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${runtimeConfig.localSalesToken}`,
    ...options.headers,
  };

  if (options.body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
  }

  const timeoutMs =
    typeof options.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_REQUEST_TIMEOUT_MS;
  const abortController = new AbortController();
  const timeoutHandle = window.setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const response = await fetch(apiUrl(path), {
      method: options.method ?? "GET",
      headers: requestHeaders,
      signal: abortController.signal,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const parsedBody = parseJsonBody(await response.text());

    if (!response.ok) {
      const errorResponse = parseApiError(parsedBody);
      if (errorResponse) {
        throw new ApiClientError(
          errorResponse.error.message,
          response.status,
          errorResponse.error.code,
          errorResponse.error.details,
          errorResponse.error.request_id,
        );
      }

      throw new ApiClientError(
        `API trả về HTTP ${response.status}.`,
        response.status,
        `HTTP_${response.status}`,
      );
    }

    if (!hasExpectedStatus(response.status, options.expectedStatus)) {
      throw new ApiClientError(
        `API trả về HTTP ${response.status} không đúng contract thành công.`,
        response.status,
        "UNEXPECTED_SUCCESS_STATUS",
      );
    }

    if (options.validateResponse && !options.validateResponse(parsedBody)) {
      throw new ApiClientError(
        "API trả về dữ liệu thành công không đúng contract; request chưa được coi là hoàn tất.",
        response.status,
        "INVALID_SUCCESS_RESPONSE",
      );
    }

    return { data: parsedBody as T, headers: response.headers };
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiClientError(
        "Request đã hết thời gian chờ. Hãy kiểm tra kết nối rồi retry bằng cùng Idempotency-Key.",
        null,
        "REQUEST_TIMEOUT",
      );
    }

    throw new ApiClientError(
      "Không thể kết nối tới Order Intake service. Hãy kiểm tra API URL hoặc mạng.",
      null,
      "NETWORK_ERROR",
    );
  } finally {
    window.clearTimeout(timeoutHandle);
  }
}

export function formatApiError(error: unknown): string {
  if (!(error instanceof ApiClientError)) {
    return error instanceof Error
      ? error.message
      : "Lỗi không xác định ở web client. Hãy thử lại.";
  }

  const detailSummary =
    error.details.length === 0
      ? ""
      : ` (${error.details
          .map((detail) => `${detail.field}: ${detail.reason}`)
          .join(", ")})`;
  const requestId = error.requestId ? ` [request_id: ${error.requestId}]` : "";
  return `${error.message}${detailSummary}${requestId}`;
}

export function isAuthenticationError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

export function isTerminalSubmissionError(error: unknown): boolean {
  if (!(error instanceof ApiClientError) || error.status === null) {
    return false;
  }

  return (
    error.status >= 400 &&
    error.status < 500 &&
    ![401, 408, 429].includes(error.status)
  );
}

export function isTerminalDetailError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status !== null &&
    [401, 404, 422].includes(error.status)
  );
}
