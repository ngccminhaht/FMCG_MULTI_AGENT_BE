function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

const configuredApiBaseUrl = trimTrailingSlashes(
  (import.meta.env.VITE_API_BASE_URL ?? "").trim(),
);
const configuredLocalSalesToken = (import.meta.env.VITE_LOCAL_SALES_TOKEN ?? "").trim();

export const runtimeConfig = {
  apiBaseUrl: configuredApiBaseUrl,
  apiPrefix: `${configuredApiBaseUrl}/api/v1`,
  localSalesToken: configuredLocalSalesToken || "dev-hung-001",
  usingDevelopmentProxy: configuredApiBaseUrl.length === 0,
  usingDefaultLocalToken: configuredLocalSalesToken.length === 0,
} as const;
