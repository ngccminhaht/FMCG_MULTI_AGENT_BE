import type { OrderCreateRequest, OrderItem } from "../contracts/orders";

const STORAGE_KEY = "fmcg-m1.web.pending-order-submissions.v1";
const STORAGE_LOCK_NAME = "fmcg-m1.web.pending-order-submissions";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PendingOrderSubmission {
  idempotencyKey: string;
  request: OrderCreateRequest;
  createdAt: string;
}

type BrowserLockManager = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

let localOperationQueue: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOrderItem(value: unknown): value is OrderItem {
  return (
    isRecord(value) &&
    typeof value.product_sku === "string" &&
    value.product_sku.trim().length > 0 &&
    typeof value.quantity === "number" &&
    Number.isSafeInteger(value.quantity) &&
    value.quantity > 0
  );
}

function isOrderRequest(value: unknown): value is OrderCreateRequest {
  return (
    isRecord(value) &&
    typeof value.client_order_id === "string" &&
    value.client_order_id.trim().length > 0 &&
    typeof value.retailer_id === "string" &&
    value.retailer_id.trim().length > 0 &&
    typeof value.order_time === "string" &&
    Number.isFinite(Date.parse(value.order_time)) &&
    Array.isArray(value.items) &&
    value.items.length > 0 &&
    value.items.every(isOrderItem) &&
    typeof value.declared_total_amount_vnd === "number" &&
    Number.isSafeInteger(value.declared_total_amount_vnd) &&
    value.declared_total_amount_vnd > 0
  );
}

function isPendingSubmission(value: unknown): value is PendingOrderSubmission {
  return (
    isRecord(value) &&
    typeof value.idempotencyKey === "string" &&
    UUID_PATTERN.test(value.idempotencyKey) &&
    isOrderRequest(value.request) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt))
  );
}

function cloneSubmission(submission: PendingOrderSubmission): PendingOrderSubmission {
  return {
    idempotencyKey: submission.idempotencyKey,
    createdAt: submission.createdAt,
    request: {
      ...submission.request,
      items: submission.request.items.map((item) => ({ ...item })),
    },
  };
}

function readSubmissions(): PendingOrderSubmission[] {
  const rawValue = window.localStorage.getItem(STORAGE_KEY);
  if (rawValue === null) {
    return [];
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(rawValue) as unknown;
  } catch {
    throw new Error("Retry queue trong trình duyệt bị lỗi định dạng.");
  }

  if (!Array.isArray(parsedValue) || !parsedValue.every(isPendingSubmission)) {
    throw new Error("Retry queue trong trình duyệt không đúng contract an toàn.");
  }

  return parsedValue.map(cloneSubmission);
}

function writeSubmissions(submissions: PendingOrderSubmission[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(submissions));
}

function withLocalSerialization<T>(operation: () => Promise<T>): Promise<T> {
  const result = localOperationQueue.then(operation, operation);
  localOperationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function getBrowserLockManager(): BrowserLockManager | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }

  return (navigator as Navigator & { locks?: BrowserLockManager }).locks;
}

function withStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const lockManager = getBrowserLockManager();
  if (lockManager) {
    return lockManager.request(STORAGE_LOCK_NAME, operation);
  }

  return withLocalSerialization(operation);
}

function canonicalRequest(request: OrderCreateRequest): OrderCreateRequest {
  return {
    ...request,
    items: [...request.items]
      .sort((left, right) => left.product_sku.localeCompare(right.product_sku))
      .map((item) => ({ ...item })),
  };
}

export function sameOrderRequest(
  left: OrderCreateRequest,
  right: OrderCreateRequest,
): boolean {
  return JSON.stringify(canonicalRequest(left)) === JSON.stringify(canonicalRequest(right));
}

export async function loadPendingOrderSubmissions(): Promise<PendingOrderSubmission[]> {
  return withStorageLock(async () =>
    readSubmissions()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(cloneSubmission),
  );
}

export async function reservePendingOrderSubmission(
  request: OrderCreateRequest,
  createSubmission: () => PendingOrderSubmission,
): Promise<PendingOrderSubmission> {
  return withStorageLock(async () => {
    const currentSubmissions = readSubmissions();
    const existingSubmission = currentSubmissions.find(
      (submission) => submission.request.client_order_id === request.client_order_id,
    );
    if (existingSubmission) {
      return cloneSubmission(existingSubmission);
    }

    const newSubmission = createSubmission();
    if (
      !isPendingSubmission(newSubmission) ||
      !sameOrderRequest(newSubmission.request, request)
    ) {
      throw new Error("Không thể tạo retry submission hợp lệ.");
    }

    writeSubmissions([...currentSubmissions, cloneSubmission(newSubmission)]);
    return cloneSubmission(newSubmission);
  });
}

export async function removePendingOrderSubmission(idempotencyKey: string): Promise<void> {
  await withStorageLock(async () => {
    const currentSubmissions = readSubmissions();
    writeSubmissions(
      currentSubmissions.filter(
        (submission) => submission.idempotencyKey !== idempotencyKey,
      ),
    );
  });
}

export function subscribeToPendingOrderChanges(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.storageArea === window.localStorage && (event.key === STORAGE_KEY || event.key === null)) {
      listener();
    }
  };

  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
