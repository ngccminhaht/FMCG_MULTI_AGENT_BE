import { StyleSheet, Text, View } from "react-native";

import type { OrderStatus } from "../../contracts/orders";

const STATUS_META: Record<
  OrderStatus,
  { label: string; backgroundColor: string; color: string }
> = {
  PENDING_FRAUD_CHECK: {
    label: "Đang kiểm tra",
    backgroundColor: "#fff3cd",
    color: "#7a4b00",
  },
  APPROVED: {
    label: "Đã chấp nhận",
    backgroundColor: "#d9f7e8",
    color: "#126b3d",
  },
  REVIEW_REQUIRED: {
    label: "Cần kiểm tra",
    backgroundColor: "#ffe4d1",
    color: "#9b3d00",
  },
  REJECTED: {
    label: "Đã từ chối",
    backgroundColor: "#fde0e2",
    color: "#a31621",
  },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status];

  return (
    <View style={[styles.badge, { backgroundColor: meta.backgroundColor }]}>
      <Text style={[styles.label, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
  },
});
