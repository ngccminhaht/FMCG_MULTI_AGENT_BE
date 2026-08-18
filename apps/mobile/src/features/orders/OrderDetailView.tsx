import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { OrderDetailResponse } from "../../contracts/orders";
import { StatusBadge } from "./StatusBadge";

interface OrderDetailViewProps {
  order: OrderDetailResponse | null;
  loading: boolean;
  errorMessage: string | null;
  onBack(): void;
  onRefresh(): void;
  onRetry(): void;
}

function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    currency: "VND",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(amount);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

export function OrderDetailView({
  order,
  loading,
  errorMessage,
  onBack,
  onRefresh,
  onRetry,
}: OrderDetailViewProps) {
  if (!order && loading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator color="#2855c5" />
        <Text style={styles.loadingText}>Đang tải chi tiết đơn…</Text>
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.loadingState}>
        <Text style={styles.errorTitle}>Không thể tải đơn hàng</Text>
        <Text style={styles.errorMessage}>{errorMessage ?? "Order is unavailable."}</Text>
        <View style={styles.errorActions}>
          <Pressable disabled={loading} onPress={onRetry} style={styles.primaryButton}>
            <Text style={styles.primaryButtonLabel}>Thử lại</Text>
          </Pressable>
          <Pressable onPress={onBack} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonLabel}>Quay lại danh sách</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const isPending = order.status === "PENDING_FRAUD_CHECK";
  const assessment = order.fraud_assessment;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={styles.backLabel}>‹ Danh sách</Text>
        </Pressable>
        <Pressable disabled={loading} onPress={onRefresh} style={styles.refreshButton}>
          {loading ? (
            <ActivityIndicator color="#2855c5" size="small" />
          ) : (
            <Text style={styles.refreshLabel}>Làm mới</Text>
          )}
        </Pressable>
      </View>

      {errorMessage ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningText}>{errorMessage}</Text>
          <Pressable disabled={loading} onPress={onRetry} style={styles.warningRetryButton}>
            <Text style={styles.warningRetryLabel}>Thử lại</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.titleCard}>
        <Text style={styles.clientOrderId}>{order.client_order_id}</Text>
        <View style={styles.statusRow}>
          <StatusBadge status={order.status} />
          <Text style={styles.orderId}>#{order.order_id.slice(0, 8)}</Text>
        </View>
        <Text style={styles.pendingHint}>
          {isPending
            ? "Tự poll sau 3 giây; khi lỗi, app backoff tối đa 30 giây."
            : "Fraud decision cuối cùng của M1 đã có."}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Thông tin đơn</Text>
        <DetailRow label="Retailer" value={order.retailer_id} />
        <DetailRow label="Sales rep" value={order.sales_rep_id} />
        <DetailRow label="Order time" value={formatDateTime(order.order_time)} />
        <DetailRow label="Tổng tiền khai báo" value={formatVnd(order.declared_total_amount_vnd)} />
        <DetailRow label="Cập nhật" value={formatDateTime(order.updated_at)} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sản phẩm</Text>
        {order.items.map((item) => (
          <View key={item.product_sku} style={styles.itemRow}>
            <Text style={styles.itemSku}>{item.product_sku}</Text>
            <Text style={styles.itemQuantity}>× {item.quantity}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Fraud assessment</Text>
        {assessment ? (
          <>
            <View style={styles.assessmentTopRow}>
              <View>
                <Text style={styles.scoreLabel}>Risk score</Text>
                <Text style={styles.score}>{assessment.risk_score}/100</Text>
              </View>
              <StatusBadge status={assessment.decision} />
            </View>
            <DetailRow label="Evaluator" value={`${assessment.evaluator_type} · ${assessment.evaluator_version}`} />
            <DetailRow label="Assessed at" value={formatDateTime(assessment.assessed_at)} />
            <Text style={styles.reasonLabel}>Reason codes</Text>
            <View style={styles.reasonRow}>
              {assessment.reason_codes.map((reasonCode) => (
                <View key={reasonCode} style={styles.reasonChip}>
                  <Text style={styles.reasonText}>{reasonCode}</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <Text style={styles.noAssessment}>Chưa có assessment. Worker vẫn đang xử lý hoặc retry event.</Text>
        )}
      </View>
    </ScrollView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  loadingState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 28,
  },
  loadingText: {
    color: "#65748a",
    fontSize: 14,
    marginTop: 10,
  },
  errorTitle: {
    color: "#9a2630",
    fontSize: 18,
    fontWeight: "800",
  },
  errorMessage: {
    color: "#65748a",
    fontSize: 13,
    marginTop: 8,
    textAlign: "center",
  },
  errorActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  backButton: {
    paddingVertical: 7,
  },
  backLabel: {
    color: "#2855c5",
    fontSize: 15,
    fontWeight: "800",
  },
  refreshButton: {
    minHeight: 32,
    minWidth: 64,
    paddingHorizontal: 6,
    paddingVertical: 7,
  },
  refreshLabel: {
    color: "#2855c5",
    fontSize: 14,
    fontWeight: "800",
  },
  warningCard: {
    alignItems: "center",
    backgroundColor: "#fff4e6",
    borderColor: "#ffd49e",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
    padding: 11,
  },
  warningText: {
    color: "#81500f",
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  warningRetryButton: {
    backgroundColor: "#ffead0",
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  warningRetryLabel: {
    color: "#9a5900",
    fontSize: 12,
    fontWeight: "800",
  },
  titleCard: {
    backgroundColor: "#ffffff",
    borderColor: "#d9e2ee",
    borderRadius: 13,
    borderWidth: 1,
    padding: 16,
  },
  clientOrderId: {
    color: "#1f2e44",
    fontSize: 19,
    fontWeight: "800",
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  orderId: {
    color: "#718096",
    fontSize: 12,
  },
  pendingHint: {
    color: "#65748a",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 12,
  },
  section: {
    backgroundColor: "#ffffff",
    borderColor: "#e1e7ef",
    borderRadius: 13,
    borderWidth: 1,
    marginTop: 14,
    padding: 15,
  },
  sectionTitle: {
    color: "#27354a",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8,
  },
  detailRow: {
    borderTopColor: "#edf1f5",
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  detailLabel: {
    color: "#718096",
    fontSize: 12,
    marginBottom: 3,
  },
  detailValue: {
    color: "#29384d",
    fontSize: 14,
    fontWeight: "600",
  },
  itemRow: {
    alignItems: "center",
    borderTopColor: "#edf1f5",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 11,
  },
  itemSku: {
    color: "#29384d",
    fontSize: 14,
    fontWeight: "600",
  },
  itemQuantity: {
    color: "#2855c5",
    fontSize: 14,
    fontWeight: "800",
  },
  assessmentTopRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 7,
  },
  scoreLabel: {
    color: "#718096",
    fontSize: 12,
  },
  score: {
    color: "#27354a",
    fontSize: 24,
    fontWeight: "800",
    marginTop: 2,
  },
  reasonLabel: {
    color: "#718096",
    fontSize: 12,
    marginTop: 9,
  },
  reasonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 7,
  },
  reasonChip: {
    backgroundColor: "#eef2f7",
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  reasonText: {
    color: "#4f6076",
    fontSize: 11,
    fontWeight: "700",
  },
  noAssessment: {
    color: "#65748a",
    fontSize: 13,
    lineHeight: 19,
  },
  primaryButton: {
    backgroundColor: "#1d4ed8",
    borderRadius: 9,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryButtonLabel: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  secondaryButton: {
    backgroundColor: "#e6efff",
    borderRadius: 9,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonLabel: {
    color: "#1e4cc2",
    fontSize: 14,
    fontWeight: "800",
  },
});
