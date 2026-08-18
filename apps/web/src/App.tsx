import { useCallback, useEffect, useRef, useState } from "react";

import { createOrder, getOrder, listOrders } from "./api/orders";
import {
  formatApiError,
  isAuthenticationError,
  isTerminalDetailError,
  isTerminalSubmissionError,
} from "./api/http";
import { runtimeConfig } from "./config/environment";
import type {
  OrderCreateRequest,
  OrderDetailResponse,
  OrderListItem,
  OrderStatus,
} from "./contracts/orders";
import {
  loadPendingOrderSubmissions,
  removePendingOrderSubmission,
  reservePendingOrderSubmission,
  sameOrderRequest,
  subscribeToPendingOrderChanges,
  type PendingOrderSubmission,
} from "./storage/pendingOrders";
import { OrderCreateForm } from "./features/orders/OrderCreateForm";
import { OrderDetail } from "./features/orders/OrderDetail";
import { OrderList, type StatusFilter } from "./features/orders/OrderList";

type AppRoute =
  | { page: "list" }
  | { page: "create" }
  | { page: "detail"; orderId: string };

type Banner = { tone: "error" | "success"; message: string } | null;
type DetailRefreshResult =
  | "updated"
  | "retryable_failure"
  | "terminal_failure"
  | "ignored";

function decodeOrderId(pathSegment: string): string | null {
  try {
    const orderId = decodeURIComponent(pathSegment);
    return orderId.trim().length > 0 ? orderId : null;
  } catch {
    return null;
  }
}

function routeFromLocation(): AppRoute {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/orders/new") {
    return { page: "create" };
  }

  const detailMatch = pathname.match(/^\/orders\/([^/]+)$/);
  const orderId = detailMatch ? decodeOrderId(detailMatch[1]) : null;
  if (orderId) {
    return { page: "detail", orderId };
  }

  return { page: "list" };
}

function pathForRoute(route: AppRoute): string {
  switch (route.page) {
    case "create":
      return "/orders/new";
    case "detail":
      return `/orders/${encodeURIComponent(route.orderId)}`;
    default:
      return "/orders";
  }
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  throw new Error("Trình duyệt không hỗ trợ crypto.randomUUID để tạo Idempotency-Key an toàn.");
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(routeFromLocation);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pollingStopped, setPollingStopped] = useState(false);
  const [pollingTargetIsPending, setPollingTargetIsPending] = useState(false);
  const [pollFailureCount, setPollFailureCount] = useState(0);
  const [pollCycle, setPollCycle] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [pendingSubmissions, setPendingSubmissions] = useState<PendingOrderSubmission[]>([]);
  const [retryingPending, setRetryingPending] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const listRequestGeneration = useRef(0);
  const detailRequestGeneration = useRef(0);
  const detailRequestInFlight = useRef(false);
  const selectedOrderIdRef = useRef<string | null>(null);
  const knownDetailStatusRef = useRef<{
    orderId: string;
    status: OrderStatus;
  } | null>(null);
  const detailMayNeedPollingRef = useRef(false);
  const queueOperationInFlight = useRef(false);

  const navigate = useCallback((nextRoute: AppRoute, replace = false): void => {
    const nextPath = pathForRoute(nextRoute);
    if (window.location.pathname !== nextPath) {
      window.history[replace ? "replaceState" : "pushState"]({}, "", nextPath);
    }
    setRoute(nextRoute);
  }, []);

  const refreshPendingSubmissions = useCallback(async (): Promise<void> => {
    try {
      setPendingSubmissions(await loadPendingOrderSubmissions());
    } catch (error) {
      setBanner({ tone: "error", message: formatApiError(error) });
    }
  }, []);

  const refreshOrders = useCallback(async (): Promise<void> => {
    const requestGeneration = ++listRequestGeneration.current;
    const filterAtRequest = statusFilter;
    setListLoading(true);
    setLoadingMore(false);

    try {
      const response = await listOrders({
        page: 1,
        status: filterAtRequest === "ALL" ? undefined : filterAtRequest,
      });
      if (requestGeneration !== listRequestGeneration.current) {
        return;
      }

      setOrders(response.items);
      setTotalItems(response.total_items);
      setTotalPages(response.total_pages);
      setPage(response.page);
    } catch (error) {
      if (requestGeneration === listRequestGeneration.current) {
        setBanner({ tone: "error", message: formatApiError(error) });
      }
    } finally {
      if (requestGeneration === listRequestGeneration.current) {
        setListLoading(false);
      }
    }
  }, [statusFilter]);

  const loadMoreOrders = useCallback(async (): Promise<void> => {
    if (listLoading || loadingMore || page >= totalPages) {
      return;
    }

    const requestGeneration = ++listRequestGeneration.current;
    const nextPage = page + 1;
    const filterAtRequest = statusFilter;
    setLoadingMore(true);

    try {
      const response = await listOrders({
        page: nextPage,
        status: filterAtRequest === "ALL" ? undefined : filterAtRequest,
      });
      if (requestGeneration !== listRequestGeneration.current) {
        return;
      }

      setOrders((currentOrders) => {
        const knownOrderIds = new Set(currentOrders.map((order) => order.order_id));
        return [
          ...currentOrders,
          ...response.items.filter((order) => !knownOrderIds.has(order.order_id)),
        ];
      });
      setTotalItems(response.total_items);
      setTotalPages(response.total_pages);
      setPage(response.page);
    } catch (error) {
      if (requestGeneration === listRequestGeneration.current) {
        setBanner({ tone: "error", message: formatApiError(error) });
      }
    } finally {
      if (requestGeneration === listRequestGeneration.current) {
        setLoadingMore(false);
      }
    }
  }, [listLoading, loadingMore, page, statusFilter, totalPages]);

  const refreshDetail = useCallback(
    async (
      orderId: string,
      mode: "manual" | "poll" = "manual",
    ): Promise<DetailRefreshResult> => {
      if (detailRequestInFlight.current) {
        return "ignored";
      }

      const requestGeneration = ++detailRequestGeneration.current;
      const showLoading = mode === "manual";
      detailRequestInFlight.current = true;
      if (showLoading) {
        setDetailLoading(true);
        setDetailError(null);
        setPollingStopped(false);
      }

      try {
        const detail = await getOrder(orderId);
        if (
          requestGeneration !== detailRequestGeneration.current ||
          selectedOrderIdRef.current !== orderId
        ) {
          return "ignored";
        }

        const isPending = detail.status === "PENDING_FRAUD_CHECK";
        setSelectedOrder(detail);
        setDetailError(null);
        detailMayNeedPollingRef.current = isPending;
        setPollingTargetIsPending(isPending);
        setPollFailureCount(0);
        setPollingStopped(false);
        return "updated";
      } catch (error) {
        if (
          requestGeneration !== detailRequestGeneration.current ||
          selectedOrderIdRef.current !== orderId
        ) {
          return "ignored";
        }

        const message = formatApiError(error);
        if (isTerminalDetailError(error)) {
          setDetailError(message);
          setPollingStopped(true);
          detailMayNeedPollingRef.current = false;
          setPollingTargetIsPending(false);
          setBanner({ tone: "error", message });
          return "terminal_failure";
        }

        if (showLoading) {
          setDetailError(message);
          setBanner({ tone: "error", message });
        } else {
          setDetailError(
            "Không thể cập nhật trạng thái. Web client sẽ thử lại với thời gian chờ dài hơn.",
          );
        }
        if (detailMayNeedPollingRef.current) {
          setPollingTargetIsPending(true);
        }
        return "retryable_failure";
      } finally {
        if (requestGeneration === detailRequestGeneration.current) {
          detailRequestInFlight.current = false;
          if (showLoading) {
            setDetailLoading(false);
          }
        }
      }
    },
    [],
  );

  useEffect(() => {
    const handlePopState = (): void => setRoute(routeFromLocation());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    void refreshOrders();
  }, [refreshOrders]);

  useEffect(() => {
    void refreshPendingSubmissions();
    return subscribeToPendingOrderChanges(() => {
      void refreshPendingSubmissions();
    });
  }, [refreshPendingSubmissions]);

  useEffect(() => {
    if (route.page !== "detail") {
      selectedOrderIdRef.current = null;
      knownDetailStatusRef.current = null;
      detailMayNeedPollingRef.current = false;
      detailRequestGeneration.current += 1;
      detailRequestInFlight.current = false;
      setSelectedOrder(null);
      setDetailError(null);
      setPollingStopped(false);
      setPollingTargetIsPending(false);
      setPollFailureCount(0);
      setPollCycle(0);
      return;
    }

    if (selectedOrderIdRef.current === route.orderId) {
      return;
    }

    const knownStatus =
      knownDetailStatusRef.current?.orderId === route.orderId
        ? knownDetailStatusRef.current.status
        : undefined;
    const detailMayNeedPolling =
      knownStatus === undefined || knownStatus === "PENDING_FRAUD_CHECK";
    detailMayNeedPollingRef.current = detailMayNeedPolling;
    selectedOrderIdRef.current = route.orderId;
    detailRequestGeneration.current += 1;
    detailRequestInFlight.current = false;
    setSelectedOrder(null);
    setDetailError(null);
    setPollingStopped(false);
    setPollingTargetIsPending(knownStatus === "PENDING_FRAUD_CHECK");
    setPollFailureCount(0);
    setPollCycle(0);
    void refreshDetail(route.orderId);
  }, [refreshDetail, route]);

  useEffect(() => {
    if (
      route.page !== "detail" ||
      !pollingTargetIsPending ||
      pollingStopped
    ) {
      return undefined;
    }

    let cancelled = false;
    const delay = Math.min(3_000 * 2 ** pollFailureCount, 30_000);
    const pollingTimer = window.setTimeout(() => {
      void (async () => {
        const result = await refreshDetail(route.orderId, "poll");
        if (cancelled || result === "terminal_failure") {
          return;
        }

        if (result === "updated") {
          setPollFailureCount(0);
        } else if (result === "retryable_failure") {
          setPollFailureCount((count) => Math.min(count + 1, 4));
        }
        setPollCycle((cycle) => cycle + 1);
      })();
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(pollingTimer);
    };
  }, [pollCycle, pollFailureCount, pollingStopped, pollingTargetIsPending, refreshDetail, route]);

  const changeStatusFilter = useCallback((nextFilter: StatusFilter): void => {
    listRequestGeneration.current += 1;
    setStatusFilter(nextFilter);
    setOrders([]);
    setPage(1);
    setTotalItems(0);
    setTotalPages(0);
  }, []);

  const openDetail = useCallback(
    (orderId: string, knownStatus?: OrderStatus): void => {
      knownDetailStatusRef.current = knownStatus
        ? { orderId, status: knownStatus }
        : null;
      navigate({ page: "detail", orderId });
    },
    [navigate],
  );

  const returnToList = useCallback((): void => {
    navigate({ page: "list" });
    void refreshOrders();
  }, [navigate, refreshOrders]);

  const submitNewOrder = useCallback(
    async (request: OrderCreateRequest): Promise<void> => {
      if (queueOperationInFlight.current) {
        const message = "Một thao tác gửi hoặc retry đang chạy. Hãy chờ thao tác đó hoàn tất.";
        setBanner({ tone: "error", message });
        throw new Error(message);
      }

      queueOperationInFlight.current = true;
      setSubmitting(true);

      try {
        let submission: PendingOrderSubmission;
        try {
          submission = await reservePendingOrderSubmission(request, () => ({
            idempotencyKey: createIdempotencyKey(),
            request,
            createdAt: new Date().toISOString(),
          }));
          if (!sameOrderRequest(submission.request, request)) {
            throw new Error(
              "Một submission đang chờ retry đã dùng client order ID này. Hãy retry body gốc thay vì thay đổi đơn.",
            );
          }
          await refreshPendingSubmissions();
        } catch (error) {
          const message =
            error instanceof Error && error.message.startsWith("Một submission")
              ? error.message
              : "Đơn chưa được gửi vì web client không thể lưu retry queue an toàn.";
          setBanner({ tone: "error", message });
          throw new Error(message);
        }

        try {
          const result = await createOrder(submission.request, submission.idempotencyKey);
          let queueCleanupFailed = false;
          try {
            await removePendingOrderSubmission(submission.idempotencyKey);
          } catch {
            queueCleanupFailed = true;
          }
          await refreshPendingSubmissions();
          setBanner({
            tone: "success",
            message: queueCleanupFailed
              ? "Server đã nhận đơn. Retry entry còn lại vẫn an toàn vì giữ cùng Idempotency-Key."
              : result.idempotencyReplayed
                ? "Đã nhận lại order trước đó bằng Idempotency-Key an toàn."
                : "Đơn đã được lưu và đang chờ fraud worker kiểm tra.",
          });
          await refreshOrders();
          openDetail(result.order.order_id, result.order.status);
        } catch (error) {
          if (isTerminalSubmissionError(error)) {
            let removedFromQueue = false;
            try {
              await removePendingOrderSubmission(submission.idempotencyKey);
              removedFromQueue = true;
              await refreshPendingSubmissions();
            } catch {
              // Keeping the original key and body remains safer than replacing either value.
            }
            const message = formatApiError(error);
            setBanner({
              tone: "error",
              message: removedFromQueue
                ? `${message} Retry entry đã được xóa vì request cần sửa dữ liệu.`
                : `${message} Request cần sửa dữ liệu; entry vẫn giữ nguyên để không tạo key mới.`,
            });
          } else if (isAuthenticationError(error)) {
            setBanner({
              tone: "error",
              message: `${formatApiError(error)} Request gốc vẫn được giữ; hãy sửa local token trước khi retry.`,
            });
          } else {
            setBanner({
              tone: "error",
              message: `${formatApiError(error)} Request chính xác đã được giữ trong retry queue.`,
            });
          }
          throw error;
        }
      } finally {
        queueOperationInFlight.current = false;
        setSubmitting(false);
      }
    },
    [openDetail, refreshOrders, refreshPendingSubmissions],
  );

  const retryPendingSubmissions = useCallback(async (): Promise<void> => {
    if (pendingSubmissions.length === 0) {
      return;
    }
    if (queueOperationInFlight.current) {
      setBanner({
        tone: "error",
        message: "Một thao tác gửi hoặc retry đang chạy. Hãy chờ thao tác đó hoàn tất.",
      });
      return;
    }

    queueOperationInFlight.current = true;
    setRetryingPending(true);
    let successful = 0;
    let terminalFailures = 0;
    let retryableFailures = 0;
    let authenticationBlocked = false;

    try {
      for (const submission of pendingSubmissions) {
        try {
          await createOrder(submission.request, submission.idempotencyKey);
          await removePendingOrderSubmission(submission.idempotencyKey);
          successful += 1;
        } catch (error) {
          if (isAuthenticationError(error)) {
            authenticationBlocked = true;
            break;
          }
          if (isTerminalSubmissionError(error)) {
            try {
              await removePendingOrderSubmission(submission.idempotencyKey);
            } catch {
              // An unchanged terminal request is safer than a replacement with a new key.
            }
            terminalFailures += 1;
          } else {
            retryableFailures += 1;
          }
        }
      }

      await refreshPendingSubmissions();
      await refreshOrders();
      setBanner({
        tone:
          retryableFailures > 0 || terminalFailures > 0 || authenticationBlocked
            ? "error"
            : "success",
        message: authenticationBlocked
          ? "Retry bị chặn bởi xác thực. Hãy cấu hình token local hợp lệ rồi retry lại."
          : `${successful} retry thành công · ${retryableFailures} còn chờ mạng/server · ${terminalFailures} cần sửa dữ liệu.`,
      });
    } catch (error) {
      setBanner({ tone: "error", message: formatApiError(error) });
    } finally {
      queueOperationInFlight.current = false;
      setRetryingPending(false);
    }
  }, [pendingSubmissions, refreshOrders, refreshPendingSubmissions]);

  const detailOrderId = route.page === "detail" ? route.orderId : null;
  const hasMore = page < totalPages;

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" type="button" onClick={returnToList}>
          <span className="brand-mark">F</span>
          <span><strong>FMCG</strong><small>Order Intake · M1</small></span>
        </button>
        <nav aria-label="Primary navigation">
          <button
            className={route.page === "list" ? "nav-link nav-link--active" : "nav-link"}
            type="button"
            onClick={returnToList}
          >
            Đơn hàng
          </button>
          <button
            className={route.page === "create" ? "nav-link nav-link--active" : "nav-link"}
            type="button"
            onClick={() => navigate({ page: "create" })}
          >
            Tạo đơn
          </button>
        </nav>
      </header>

      <main className="app-main">
        <section className="environment-strip" aria-label="Local configuration">
          <span className="environment-label">Local demo</span>
          <span>
            API: {runtimeConfig.usingDevelopmentProxy ? "Vite proxy /api" : runtimeConfig.apiBaseUrl}
          </span>
          <span>Token: {runtimeConfig.usingDefaultLocalToken ? "dev-hung-001 (default)" : "configured"}</span>
        </section>

        {runtimeConfig.usingDevelopmentProxy ? (
          <p className="configuration-hint">
            Dev server proxy chuyển `/api` tới `API_PROXY_TARGET`; không cần bật CORS khi local.
          </p>
        ) : null}

        {banner ? (
          <div className={`banner banner--${banner.tone}`} role={banner.tone === "error" ? "alert" : "status"}>
            <span>{banner.message}</span>
            <button className="banner-dismiss" type="button" onClick={() => setBanner(null)} aria-label="Đóng thông báo">
              Đóng
            </button>
          </div>
        ) : null}

        {pendingSubmissions.length > 0 ? (
          <section className="retry-card" aria-label="Retry queue">
            <div>
              <p className="eyebrow">Retry queue</p>
              <h2>{pendingSubmissions.length} đơn đang chờ retry</h2>
              <p>Web client sẽ giữ nguyên request body và Idempotency-Key để không tạo order trùng.</p>
            </div>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void retryPendingSubmissions()}
              disabled={retryingPending || submitting}
            >
              {retryingPending ? "Đang retry..." : "Retry queue"}
            </button>
          </section>
        ) : null}

        {route.page === "list" ? (
          <OrderList
            orders={orders}
            statusFilter={statusFilter}
            totalItems={totalItems}
            listLoading={listLoading}
            loadingMore={loadingMore}
            hasMore={hasMore}
            onChangeFilter={changeStatusFilter}
            onCreate={() => navigate({ page: "create" })}
            onLoadMore={() => void loadMoreOrders()}
            onOpen={(orderId, knownStatus) => openDetail(orderId, knownStatus)}
          />
        ) : null}

        {route.page === "create" ? (
          <OrderCreateForm
            submitting={submitting}
            onCancel={returnToList}
            onSubmit={submitNewOrder}
          />
        ) : null}

        {detailOrderId ? (
          <OrderDetail
            order={selectedOrder}
            loading={detailLoading}
            error={detailError}
            polling={pollingTargetIsPending && !pollingStopped}
            pollFailureCount={pollFailureCount}
            onBack={returnToList}
            onRefresh={() => {
              void refreshDetail(detailOrderId);
            }}
          />
        ) : null}
      </main>
    </div>
  );
}
