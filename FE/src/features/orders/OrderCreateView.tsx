import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { formatApiError } from "../../api/http";
import { localDemoMasterData } from "../../config/environment";
import type { OrderCreateRequest } from "../../contracts/orders";

interface OrderCreateViewProps {
  submitting: boolean;
  onSubmit(request: OrderCreateRequest): Promise<void>;
  onCancel(): void;
}

function nextClientOrderId(): string {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `MOBILE-${timestamp}-${suffix}`;
}

function isTimezoneAwareIsoDate(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && !Number.isNaN(Date.parse(value));
}

export function OrderCreateView({
  submitting,
  onSubmit,
  onCancel,
}: OrderCreateViewProps) {
  const [clientOrderId, setClientOrderId] = useState(nextClientOrderId);
  const [orderTime, setOrderTime] = useState(() => new Date().toISOString());
  const [amountVnd, setAmountVnd] = useState("150000");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function resetForm(): void {
    setClientOrderId(nextClientOrderId());
    setOrderTime(new Date().toISOString());
    setAmountVnd("150000");
    setQuantities({});
    setFormError(null);
  }

  function buildRequest(): OrderCreateRequest {
    const normalizedClientOrderId = clientOrderId.trim();
    if (!normalizedClientOrderId || normalizedClientOrderId.length > 100) {
      throw new Error("Client order ID is required and must be at most 100 characters.");
    }

    const normalizedOrderTime = orderTime.trim();
    if (!isTimezoneAwareIsoDate(normalizedOrderTime)) {
      throw new Error("Order time must be a valid ISO 8601 timestamp with a timezone offset.");
    }
    if (Date.parse(normalizedOrderTime) > Date.now() + 5 * 60 * 1000) {
      throw new Error("Order time cannot be more than five minutes in the future.");
    }

    const normalizedAmount = amountVnd.trim();
    if (!/^\d+$/.test(normalizedAmount)) {
      throw new Error("Declared total must be a positive whole-number VND amount.");
    }
    const declaredTotalAmountVnd = Number(normalizedAmount);
    if (!Number.isSafeInteger(declaredTotalAmountVnd) || declaredTotalAmountVnd <= 0) {
      throw new Error("Declared total must be a positive whole-number VND amount.");
    }

    const items = localDemoMasterData.products.flatMap((product) => {
      const rawQuantity = quantities[product.sku]?.trim() ?? "";
      if (!rawQuantity || rawQuantity === "0") {
        return [];
      }
      if (!/^\d+$/.test(rawQuantity)) {
        throw new Error(`${product.label} quantity must be a positive integer.`);
      }
      const quantity = Number(rawQuantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new Error(`${product.label} quantity must be a positive integer.`);
      }
      return [{ product_sku: product.sku, quantity }];
    });

    if (items.length === 0) {
      throw new Error("Add a positive quantity for at least one product.");
    }

    return {
      client_order_id: normalizedClientOrderId,
      retailer_id: localDemoMasterData.retailer.id,
      order_time: normalizedOrderTime,
      items,
      declared_total_amount_vnd: declaredTotalAmountVnd,
    };
  }

  async function submit(): Promise<void> {
    try {
      setFormError(null);
      await onSubmit(buildRequest());
      resetForm();
    } catch (error) {
      setFormError(formatApiError(error));
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Tạo đơn hàng</Text>
          <Text style={styles.subtitle}>M1 local demo · fraud kiểm tra bất đồng bộ</Text>
        </View>
        <Pressable disabled={submitting} onPress={onCancel} style={styles.cancelButton}>
          <Text style={styles.cancelLabel}>Hủy</Text>
        </Pressable>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Retailer local</Text>
        <Text style={styles.infoBody}>
          {localDemoMasterData.retailer.label} · {localDemoMasterData.retailer.id}
        </Text>
        <Text style={styles.infoHint}>
          M1 chưa có master-data endpoint. Dữ liệu này chỉ dành cho local demo.
        </Text>
      </View>

      <Text style={styles.label}>Client order ID</Text>
      <TextInput
        autoCapitalize="characters"
        editable={!submitting}
        maxLength={100}
        onChangeText={setClientOrderId}
        style={styles.input}
        value={clientOrderId}
      />

      <Text style={styles.label}>Order time (ISO 8601 có timezone)</Text>
      <TextInput
        autoCapitalize="none"
        editable={!submitting}
        onChangeText={setOrderTime}
        style={styles.input}
        value={orderTime}
      />
      <Text style={styles.hint}>
        Có thể chỉnh để demo rule ngoài giờ; không được quá 5 phút trong tương lai.
      </Text>

      <Text style={styles.sectionTitle}>Sản phẩm local</Text>
      {localDemoMasterData.products.map((product) => (
        <View key={product.sku} style={styles.productRow}>
          <View style={styles.productText}>
            <Text style={styles.productLabel}>{product.label}</Text>
            <Text style={styles.productSku}>{product.sku}</Text>
          </View>
          <TextInput
            editable={!submitting}
            keyboardType="number-pad"
            onChangeText={(value) =>
              setQuantities((current) => ({ ...current, [product.sku]: value }))
            }
            placeholder="0"
            placeholderTextColor="#8190a5"
            style={styles.quantityInput}
            value={quantities[product.sku] ?? ""}
          />
        </View>
      ))}

      <Text style={styles.label}>Tổng tiền khai báo (VND)</Text>
      <TextInput
        editable={!submitting}
        keyboardType="number-pad"
        onChangeText={setAmountVnd}
        style={styles.input}
        value={amountVnd}
      />

      {formError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{formError}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={submitting}
        onPress={() => void submit()}
        style={({ pressed }) => [
          styles.submitButton,
          (pressed || submitting) && styles.submitButtonPressed,
        ]}
      >
        {submitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.submitLabel}>Gửi đơn để kiểm tra</Text>
        )}
      </Pressable>
      <Text style={styles.footerHint}>
        App lưu body và Idempotency-Key trước khi gửi. Nếu mất mạng, dùng retry queue thay vì tạo đơn mới.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  headerRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  title: {
    color: "#172033",
    fontSize: 24,
    fontWeight: "800",
  },
  subtitle: {
    color: "#607086",
    fontSize: 13,
    marginTop: 4,
  },
  cancelButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  cancelLabel: {
    color: "#2855c5",
    fontSize: 15,
    fontWeight: "700",
  },
  infoCard: {
    backgroundColor: "#eaf2ff",
    borderColor: "#c7dcff",
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 18,
    padding: 14,
  },
  infoTitle: {
    color: "#153a82",
    fontSize: 14,
    fontWeight: "800",
  },
  infoBody: {
    color: "#153a82",
    fontSize: 15,
    marginTop: 4,
  },
  infoHint: {
    color: "#496792",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  label: {
    color: "#26354b",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 7,
    marginTop: 14,
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 10,
    borderWidth: 1,
    color: "#172033",
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  hint: {
    color: "#67778e",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  sectionTitle: {
    color: "#26354b",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8,
    marginTop: 20,
  },
  productRow: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e1e7ef",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: 8,
    padding: 12,
  },
  productText: {
    flex: 1,
    paddingRight: 12,
  },
  productLabel: {
    color: "#26354b",
    fontSize: 15,
    fontWeight: "700",
  },
  productSku: {
    color: "#718096",
    fontSize: 12,
    marginTop: 3,
  },
  quantityInput: {
    backgroundColor: "#f8fafc",
    borderColor: "#cbd5e1",
    borderRadius: 8,
    borderWidth: 1,
    color: "#172033",
    fontSize: 16,
    minHeight: 42,
    paddingHorizontal: 10,
    textAlign: "center",
    width: 76,
  },
  errorCard: {
    backgroundColor: "#fff0f1",
    borderColor: "#f2bec3",
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 18,
    padding: 12,
  },
  errorText: {
    color: "#9a2630",
    fontSize: 13,
    lineHeight: 19,
  },
  submitButton: {
    alignItems: "center",
    backgroundColor: "#1d4ed8",
    borderRadius: 10,
    justifyContent: "center",
    marginTop: 22,
    minHeight: 50,
    paddingHorizontal: 16,
  },
  submitButtonPressed: {
    backgroundColor: "#1e40af",
    opacity: 0.78,
  },
  submitLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },
  footerHint: {
    color: "#67778e",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 12,
  },
});
