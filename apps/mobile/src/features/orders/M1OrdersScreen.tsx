import { useCallback, useEffect, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { createOrder, getOrder, listOrders } from "../../api/orders";
import {
  formatApiError,
  isAuthenticationError,
  isTerminalDetailError,
  isTerminalSubmissionError,
} from "../../api/http";
import { runtimeConfig } from "../../config/environment";
import type {
  OrderCreateRequest,
  OrderDetailResponse,
  OrderListItem,
  OrderStatus,
} from "../../contracts/orders";
import {
  loadPendingOrderSubmissions,
  removePendingOrderSubmission,
  reservePendingOrderSubmission,
  sameOrderRequest,
  type PendingOrderSubmission,
} from "../../storage/pendingOrders";
import { OrderCreateView } from "./OrderCreateView";
import { OrderDetailView } from "./OrderDetailView";
import { OrderListView, type StatusFilter } from "./OrderListView";

type Screen = "list" | "create" | "detail";
type Banner = { tone: "error" | "success"; message: string } | null;
type DetailRefreshResult =
  | "updated"
  | "retryable_failure"
  | "terminal_failure"
  | "ignored";

export function M1OrdersScreen() {
  const [screen, setScreen] = useState<Screen>("list");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pollingStopped, setPollingStopped] = useState(false);
  const [pollingTargetIsPending, setPollingTargetIsPending] = useState(false);
  const [pollFailureCount, setPollFailureCount] = useState(0);
  const [pollCycle, setPollCycle] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [pendingSubmissions, setPendingSubmissions] = useState<
    PendingOrderSubmission[]
  >([]);
  const [retryingPending, setRetryingPending] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const listRequestGeneration = useRef(0);
  const detailRequestGeneration = useRef(0);
  const detailRequestInFlight = useRef(false);
  const selectedOrderIdRef = useRef<string | null>(null);
  const queueOperationInFlight = useRef(false);

  const refreshPendingSubmissions = useCallback(async (): Promise<void> => {
    try {
      setPendingSubmissions(await loadPendingOrderSubmissions());
    } catch {
      setBanner({
        tone: "error",
        message: "Không thể đọc retry queue trên thiết bị.",
      });
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
        setSelectedOrder(detail);
        setDetailError(null);
        setPollingTargetIsPending(detail.status === "PENDING_FRAUD_CHECK");
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
          setPollingTargetIsPending(false);
          setBanner({ tone: "error", message });
          return "terminal_failure";
        }

        if (showLoading) {
          setDetailError(message);
          setBanner({ tone: "error", message });
        } else {
          setDetailError(
            "Không thể cập nhật trạng thái. App sẽ thử lại với thời gian chờ dài hơn.",
          );
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
    void refreshOrders();
  }, [refreshOrders]);

  useEffect(() => {
    void refreshPendingSubmissions();
  }, [refreshPendingSubmissions]);

  useEffect(() => {
    if (
      screen !== "detail" ||
      !selectedOrderId ||
      !pollingTargetIsPending ||
      pollingStopped
    ) {
      return undefined;
    }

    let cancelled = false;
    const delay = Math.min(3_000 * 2 ** pollFailureCount, 30_000);
    const pollingTimer = setTimeout(() => {
      void (async () => {
        const result = await refreshDetail(selectedOrderId, "poll");
        if (cancelled || result === "terminal_failure") {
          return;
        }

        if (result === "updated") {
          setPollFailureCount(0);
        } else {
          setPollFailureCount((count) => Math.min(count + 1, 4));
        }
        setPollCycle((cycle) => cycle + 1);
      })();
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(pollingTimer);
    };
  }, [
    pollCycle,
    pollFailureCount,
    pollingStopped,
    pollingTargetIsPending,
    refreshDetail,
    screen,
    selectedOrderId,
  ]);

  const openDetail = useCallback(
    (orderId: string, knownStatus?: OrderStatus): void => {
      selectedOrderIdRef.current = orderId;
      detailRequestGeneration.current += 1;
      detailRequestInFlight.current = false;
      setScreen("detail");
      setSelectedOrderId(orderId);
      setSelectedOrder(null);
      setDetailError(null);
      setPollingStopped(false);
      setPollingTargetIsPending(knownStatus === "PENDING_FRAUD_CHECK");
      setPollFailureCount(0);
      setPollCycle(0);
      void refreshDetail(orderId);
    },
    [refreshDetail],
  );

  const returnToList = useCallback((): void => {
    selectedOrderIdRef.current = null;
    detailRequestGeneration.current += 1;
    detailRequestInFlight.current = false;
    setScreen("list");
    setSelectedOrderId(null);
    setSelectedOrder(null);
    setDetailError(null);
    setPollingStopped(false);
    setPollingTargetIsPending(false);
    setPollFailureCount(0);
    setPollCycle(0);
    void refreshOrders();
  }, [refreshOrders]);

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
            idempotencyKey: Crypto.randomUUID(),
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
              : "Đơn chưa được gửi vì app không thể lưu retry queue an toàn trên thiết bị.";
          setBanner({ tone: "error", message });
          throw new Error(message);
        }

        try {
          const result = await createOrder(
            submission.request,
            submission.idempotencyKey,
          );
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
              ? "Đơn đã được server tiếp nhận. Retry entry còn lại an toàn vì cùng Idempotency-Key."
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
              // A later retry remains safe because the retained key and payload are unchanged.
            }
            const message = formatApiError(error);
            setBanner({
              tone: "error",
              message: removedFromQueue
                ? `${message} Retry entry đã được xóa vì request cần sửa dữ liệu.`
                : `${message} Request cần sửa dữ liệu; retry entry vẫn còn và không nên gửi lại nguyên trạng.`,
            });
          } else if (isAuthenticationError(error)) {
            setBanner({
              tone: "error",
              message: `${formatApiError(error)} Request gốc vẫn được giữ, nhưng cần sửa local token trước khi retry.`,
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
              // Keeping an unchanged terminal request is safer than replacing its idempotency key.
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
          ? "Retry bị chặn bởi xác thực. Hãy cấu hình token hợp lệ rồi retry lại queue."
          : `${successful} retry thành công · ${retryableFailures} còn chờ mạng/server · ${terminalFailures} cần sửa dữ liệu.`,
      });
    } catch (error) {
      setBanner({ tone: "error", message: formatApiError(error) });
    } finally {
      queueOperationInFlight.current = false;
      setRetryingPending(false);
    }
  }, [pendingSubmissions, refreshOrders, refreshPendingSubmissions]);

  function changeFilter(nextFilter: StatusFilter): void {
    listRequestGeneration.current += 1;
    setStatusFilter(nextFilter);
    setOrders([]);
    setPage(1);
    setTotalItems(0);
    setTotalPages(0);
  }

  const hasMore = page < totalPages;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.appHeader}>
        <View>
          <Text style={styles.appTitle}>FMCG · M1</Text>
          <Text numberOfLines={1} style={styles.apiUrl}>
            API: {runtimeConfig.apiBaseUrl}
          </Text>
        </View>
        {screen !== "list" ? (
          <Pressable onPress={returnToList} style={styles.listButton}>
            <Text style={styles.listButtonLabel}>Danh sách</Text>
          </Pressable>
        ) : null}
      </View>

      {runtimeConfig.usingDefaultApiBaseUrl ? (
        <View style={styles.configurationHint}>
          <Text style={styles.configurationHintText}>
            Đang dùng API URL mặc định. Physical device cần `EXPO_PUBLIC_API_BASE_URL` trỏ tới LAN IP của máy chạy backend.
          </Text>
        </View>
      ) : null}

      {banner ? (
        <Pressable
          onPress={() => setBanner(null)}
          style={[styles.banner, banner.tone === "error" ? styles.errorBanner : styles.successBanner]}
        >
          <Text style={[styles.bannerText, banner.tone === "error" ? styles.errorBannerText : styles.successBannerText]}>
            {banner.message}
          </Text>
          <Text style={styles.dismissLabel}>×</Text>
        </Pressable>
      ) : null}

      {pendingSubmissions.length > 0 ? (
        <View style={styles.retryCard}>
          <View style={styles.retryCopy}>
            <Text style={styles.retryTitle}>Có {pendingSubmissions.length} đơn chờ retry</Text>
            <Text style={styles.retryText}>
              Giữ nguyên body và Idempotency-Key để server không tạo order trùng.
            </Text>
          </View>
          <Pressable
            disabled={retryingPending || submitting}
            onPress={() => void retryPendingSubmissions()}
            style={[styles.retryButton, (retryingPending || submitting) && styles.retryButtonDisabled]}
          >
            {retryingPending ? (
              <ActivityIndicator color="#1e4cc2" size="small" />
            ) : (
              <Text style={styles.retryButtonLabel}>Retry</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      <View style={styles.screenContainer}>
        {screen === "list" ? (
          <OrderListView
            filter={statusFilter}
            hasMore={hasMore}
            loading={listLoading}
            loadingMore={loadingMore}
            onChangeFilter={changeFilter}
            onCreateOrder={() => setScreen("create")}
            onLoadMore={() => void loadMoreOrders()}
            onRefresh={() => void refreshOrders()}
            onSelectOrder={(order) => openDetail(order.order_id, order.status)}
            orders={orders}
            totalItems={totalItems}
          />
        ) : null}
        {screen === "create" ? (
          <OrderCreateView
            onCancel={() => {
              if (!submitting) {
                setScreen("list");
              }
            }}
            onSubmit={submitNewOrder}
            submitting={submitting}
          />
        ) : null}
        {screen === "detail" ? (
          <OrderDetailView
            errorMessage={detailError}
            loading={detailLoading}
            onBack={returnToList}
            onRefresh={() => {
              if (selectedOrderId) {
                void refreshDetail(selectedOrderId);
              }
            }}
            onRetry={() => {
              if (selectedOrderId) {
                void refreshDetail(selectedOrderId);
              }
            }}
            order={selectedOrder}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: "#f7f8fa",
    flex: 1,
  },
  appHeader: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderBottomColor: "#dce4ee",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  appTitle: {
    color: "#172033",
    fontSize: 16,
    fontWeight: "900",
  },
  apiUrl: {
    color: "#718096",
    fontSize: 11,
    marginTop: 3,
    maxWidth: 240,
  },
  listButton: {
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  listButtonLabel: {
    color: "#2855c5",
    fontSize: 14,
    fontWeight: "800",
  },
  configurationHint: {
    backgroundColor: "#fff8df",
    borderBottomColor: "#f4dc8a",
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  configurationHintText: {
    color: "#795b00",
    fontSize: 11,
    lineHeight: 16,
  },
  banner: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    marginHorizontal: 14,
    marginTop: 12,
    padding: 12,
  },
  errorBanner: {
    backgroundColor: "#fff0f1",
    borderColor: "#f2bec3",
    borderRadius: 10,
    borderWidth: 1,
  },
  successBanner: {
    backgroundColor: "#e5f8ee",
    borderColor: "#b9e8d0",
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  errorBannerText: {
    color: "#932734",
  },
  successBannerText: {
    color: "#17633d",
  },
  dismissLabel: {
    color: "#607086",
    fontSize: 20,
    lineHeight: 20,
  },
  retryCard: {
    alignItems: "center",
    backgroundColor: "#eef4ff",
    borderColor: "#c9daff",
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: "row",
    marginHorizontal: 14,
    marginTop: 12,
    padding: 12,
  },
  retryCopy: {
    flex: 1,
    paddingRight: 10,
  },
  retryTitle: {
    color: "#1f477f",
    fontSize: 13,
    fontWeight: "800",
  },
  retryText: {
    color: "#557197",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  retryButton: {
    alignItems: "center",
    backgroundColor: "#dfeaff",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 34,
    minWidth: 56,
    paddingHorizontal: 8,
  },
  retryButtonDisabled: {
    opacity: 0.65,
  },
  retryButtonLabel: {
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: "900",
  },
  screenContainer: {
    flex: 1,
  },
});
