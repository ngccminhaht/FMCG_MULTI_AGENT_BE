import { Platform } from "react-native";

const configuredBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
const platformDefaultBaseUrl =
  Platform.select({
    android: "http://10.0.2.2:8000",
    ios: "http://localhost:8000",
    web: "http://localhost:8000",
    default: "http://localhost:8000",
  }) ?? "http://localhost:8000";

export const runtimeConfig = {
  apiBaseUrl: (configuredBaseUrl || platformDefaultBaseUrl).replace(/\/$/, ""),
  localSalesToken: process.env.EXPO_PUBLIC_LOCAL_SALES_TOKEN?.trim() || "dev-hung-001",
  usingDefaultApiBaseUrl: !configuredBaseUrl,
};

// Local-only seed data. Replace this boundary with SFA/ERP master data before production.
export const localDemoMasterData = {
  retailer: {
    id: "CO-LAN-001",
    label: "Tạp hóa cô Lan",
  },
  products: [
    { sku: "SKU-NUOC-NGOT-001", label: "Nước ngọt chai" },
    { sku: "SKU-MI-GOI-001", label: "Mì gói" },
  ],
} as const;
