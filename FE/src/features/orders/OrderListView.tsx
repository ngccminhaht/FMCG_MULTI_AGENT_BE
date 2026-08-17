import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { OrderListItem, OrderStatus } from "../../contracts/orders";
import { StatusBadge } from "./StatusBadge";

export type StatusFilter = "ALL" | OrderStatus;

interface OrderListViewProps {
  orders: OrderListItem[];
  filter: StatusFilter;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  totalItems: number;
  onChangeFilter(filter: StatusFilter): void;
  onRefresh(): void;
  onLoadMore(): void;
  onCreateOrder(): void;
  onSelectOrder(order: OrderListItem): void;
}

const FILTERS: Array<{ label: string; value: StatusFilter }> = [
  { label: "Tất cả", value: "ALL" },
  { label: "Đang kiểm tra", value: "PENDING_FRAUD_CHECK" },
  { label: "Đã chấp nhận", value: "APPROVED" },
  { label: "Cần kiểm tra", value: "REVIEW_REQUIRED" },
  { label: "Từ chối", value: "REJECTED" },
];

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

export function OrderListView({
  orders,
  filter,
  loading,
  loadingMore,
  hasMore,
  totalItems,
  onChangeFilter,
  onRefresh,
  onLoadMore,
  onCreateOrder,
  onSelectOrder,
}: OrderListViewProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Đơn hàng M1</Text>
          <Text style={styles.subtitle}>{totalItems} đơn thuộc sale hiện tại</Text>
        </View>
        <Pressable onPress={onCreateOrder} style={styles.createButton}>
          <Text style={styles.createLabel}>+ Tạo đơn</Text>
        </Pressable>
      </View>

      <FlatList
        data={orders}
        keyExtractor={(item) => item.order_id}
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color="#2855c5" />
              <Text style={styles.emptyText}>Đang tải đơn hàng…</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Chưa có đơn phù hợp</Text>
              <Text style={styles.emptyText}>Tạo đơn mới hoặc thay đổi bộ lọc để xem dữ liệu.</Text>
            </View>
          )
        }
        ListFooterComponent={
          orders.length > 0 ? (
            <View style={styles.footer}>
              {hasMore ? (
                <Pressable
                  disabled={loadingMore}
                  onPress={onLoadMore}
                  style={[styles.loadMoreButton, loadingMore && styles.loadMoreButtonDisabled]}
                >
                  {loadingMore ? (
                    <ActivityIndicator color="#2855c5" size="small" />
                  ) : (
                    <Text style={styles.loadMoreLabel}>Tải thêm đơn</Text>
                  )}
                </Pressable>
              ) : (
                <Text style={styles.endOfList}>Đã hiển thị tất cả {totalItems} đơn.</Text>
              )}
            </View>
          ) : null
        }
        ListHeaderComponent={
          <View style={styles.filterContainer}>
            <Text style={styles.filterTitle}>Trạng thái</Text>
            <View style={styles.filterRow}>
              {FILTERS.map((item) => {
                const active = filter === item.value;
                return (
                  <Pressable
                    key={item.value}
                    onPress={() => onChangeFilter(item.value)}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                  >
                    <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        contentContainerStyle={orders.length === 0 ? styles.emptyListContent : styles.listContent}
        onRefresh={onRefresh}
        refreshing={loading}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onSelectOrder(item)}
            style={({ pressed }) => [styles.orderCard, pressed && styles.orderCardPressed]}
          >
            <View style={styles.orderTopRow}>
              <Text numberOfLines={1} style={styles.orderId}>
                {item.client_order_id}
              </Text>
              <StatusBadge status={item.status} />
            </View>
            <Text style={styles.retailer}>{item.retailer_id}</Text>
            <View style={styles.orderBottomRow}>
              <Text style={styles.amount}>{formatVnd(item.declared_total_amount_vnd)}</Text>
              <Text style={styles.updatedAt}>{formatDateTime(item.updated_at)}</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  title: {
    color: "#172033",
    fontSize: 25,
    fontWeight: "800",
  },
  subtitle: {
    color: "#65748a",
    fontSize: 13,
    marginTop: 4,
  },
  createButton: {
    backgroundColor: "#1d4ed8",
    borderRadius: 9,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  createLabel: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  filterContainer: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  filterTitle: {
    color: "#53657d",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 9,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    backgroundColor: "#eef2f7",
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  filterChipActive: {
    backgroundColor: "#dce8ff",
  },
  filterLabel: {
    color: "#53657d",
    fontSize: 12,
    fontWeight: "700",
  },
  filterLabelActive: {
    color: "#1e4cc2",
  },
  listContent: {
    paddingBottom: 28,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  emptyListContent: {
    flexGrow: 1,
    paddingBottom: 28,
  },
  orderCard: {
    backgroundColor: "#ffffff",
    borderColor: "#e1e7ef",
    borderRadius: 13,
    borderWidth: 1,
    marginBottom: 10,
    padding: 14,
  },
  orderCardPressed: {
    backgroundColor: "#f8fbff",
    borderColor: "#bdd2fb",
  },
  orderTopRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  orderId: {
    color: "#1f2e44",
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
  },
  retailer: {
    color: "#718096",
    fontSize: 12,
    marginTop: 7,
  },
  orderBottomRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 13,
  },
  amount: {
    color: "#27354a",
    fontSize: 16,
    fontWeight: "800",
  },
  updatedAt: {
    color: "#718096",
    fontSize: 11,
  },
  footer: {
    alignItems: "center",
    marginBottom: 8,
    marginTop: 4,
  },
  loadMoreButton: {
    alignItems: "center",
    backgroundColor: "#e6efff",
    borderRadius: 9,
    justifyContent: "center",
    minHeight: 42,
    minWidth: 140,
    paddingHorizontal: 14,
  },
  loadMoreButtonDisabled: {
    opacity: 0.7,
  },
  loadMoreLabel: {
    color: "#1e4cc2",
    fontSize: 13,
    fontWeight: "800",
  },
  endOfList: {
    color: "#718096",
    fontSize: 12,
    paddingVertical: 10,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 36,
    paddingTop: 72,
  },
  emptyTitle: {
    color: "#314158",
    fontSize: 17,
    fontWeight: "800",
  },
  emptyText: {
    color: "#718096",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
    textAlign: "center",
  },
});
