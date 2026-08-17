import AsyncStorage from "@react-native-async-storage/async-storage";

import type { OrderCreateRequest } from "../contracts/orders";

const PENDING_ORDER_STORAGE_KEY = "fmcg-m1.pending-order-submissions.v1";

export interface PendingOrderSubmission {
  idempotencyKey: string;
  request: OrderCreateRequest;
  createdAt: string;
}

class PendingOrderStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PendingOrderStorageError";
  }
}

let storageMutationQueue: Promise<void> = Promise.resolve();

function isPendingOrderSubmission(value: unknown): value is PendingOrderSubmission {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const submission = value as Partial<PendingOrderSubmission>;
  return (
    typeof submission.idempotencyKey === "string" &&
    typeof submission.createdAt === "string" &&
    typeof submission.request === "object" &&
    submission.request !== null
  );
}

async function withStorageMutation<T>(operation: () => Promise<T>): Promise<T> {
  const previousMutation = storageMutationQueue;
  let releaseMutation: () => void = () => undefined;
  storageMutationQueue = new Promise<void>((resolve) => {
    releaseMutation = resolve;
  });

  await previousMutation;
  try {
    return await operation();
  } finally {
    releaseMutation();
  }
}

async function readPendingOrderSubmissions(): Promise<PendingOrderSubmission[]> {
  const rawValue = await AsyncStorage.getItem(PENDING_ORDER_STORAGE_KEY);
  if (!rawValue) {
    return [];
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(rawValue) as unknown;
  } catch {
    throw new PendingOrderStorageError(
      "The pending-order queue contains invalid data and must be repaired before retrying.",
    );
  }

  if (!Array.isArray(parsedValue) || !parsedValue.every(isPendingOrderSubmission)) {
    throw new PendingOrderStorageError(
      "The pending-order queue contains an unsupported entry and must be repaired before retrying.",
    );
  }

  return parsedValue;
}

async function writePendingOrderSubmissions(
  submissions: PendingOrderSubmission[],
): Promise<void> {
  await AsyncStorage.setItem(PENDING_ORDER_STORAGE_KEY, JSON.stringify(submissions));
}

function canonicalOrderRequest(request: OrderCreateRequest): OrderCreateRequest {
  return {
    client_order_id: request.client_order_id,
    declared_total_amount_vnd: request.declared_total_amount_vnd,
    items: request.items.map((item) => ({
      product_sku: item.product_sku,
      quantity: item.quantity,
    })),
    order_time: request.order_time,
    retailer_id: request.retailer_id,
  };
}

export function sameOrderRequest(
  left: OrderCreateRequest,
  right: OrderCreateRequest,
): boolean {
  return (
    JSON.stringify(canonicalOrderRequest(left)) ===
    JSON.stringify(canonicalOrderRequest(right))
  );
}

export async function loadPendingOrderSubmissions(): Promise<
  PendingOrderSubmission[]
> {
  return withStorageMutation(readPendingOrderSubmissions);
}

export async function findPendingOrderSubmissionByClientOrderId(
  clientOrderId: string,
): Promise<PendingOrderSubmission | undefined> {
  return withStorageMutation(async () => {
    const submissions = await readPendingOrderSubmissions();
    return submissions.find(
      (submission) => submission.request.client_order_id === clientOrderId,
    );
  });
}

export async function reservePendingOrderSubmission(
  request: OrderCreateRequest,
  createSubmission: () => PendingOrderSubmission,
): Promise<PendingOrderSubmission> {
  return withStorageMutation(async () => {
    const existingSubmissions = await readPendingOrderSubmissions();
    const existingSubmission = existingSubmissions.find(
      (submission) => submission.request.client_order_id === request.client_order_id,
    );
    if (existingSubmission) {
      return existingSubmission;
    }

    const submission = createSubmission();
    await writePendingOrderSubmissions([...existingSubmissions, submission]);
    return submission;
  });
}

export async function savePendingOrderSubmission(
  submission: PendingOrderSubmission,
): Promise<void> {
  await withStorageMutation(async () => {
    const existingSubmissions = await readPendingOrderSubmissions();
    const nextSubmissions = [
      ...existingSubmissions.filter(
        (existingSubmission) =>
          existingSubmission.idempotencyKey !== submission.idempotencyKey,
      ),
      submission,
    ];
    await writePendingOrderSubmissions(nextSubmissions);
  });
}

export async function removePendingOrderSubmission(
  idempotencyKey: string,
): Promise<void> {
  await withStorageMutation(async () => {
    const existingSubmissions = await readPendingOrderSubmissions();
    await writePendingOrderSubmissions(
      existingSubmissions.filter(
        (submission) => submission.idempotencyKey !== idempotencyKey,
      ),
    );
  });
}
