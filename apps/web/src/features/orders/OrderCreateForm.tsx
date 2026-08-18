import { useRef, useState, type FormEvent } from "react";

import { formatApiError } from "../../api/http";
import type { OrderCreateRequest } from "../../contracts/orders";
import {
  LOCAL_PRODUCTS,
  LOCAL_RETAILER,
  createWebClientOrderId,
  toDateTimeLocalValue,
} from "./orderFormat";

interface OrderCreateFormProps {
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (request: OrderCreateRequest) => Promise<void>;
}

interface DraftItem {
  id: number;
  productSku: string;
  quantity: string;
}

function createDraftItem(id: number): DraftItem {
  return {
    id,
    productSku: LOCAL_PRODUCTS[0].sku,
    quantity: "1",
  };
}

export function OrderCreateForm({
  submitting,
  onCancel,
  onSubmit,
}: OrderCreateFormProps) {
  const nextItemId = useRef(2);
  const [clientOrderId, setClientOrderId] = useState(createWebClientOrderId);
  const [orderTimeInput, setOrderTimeInput] = useState(toDateTimeLocalValue);
  const [amountInput, setAmountInput] = useState("150000");
  const [items, setItems] = useState<DraftItem[]>(() => [createDraftItem(1)]);
  const [formError, setFormError] = useState<string | null>(null);

  function updateItem(id: number, update: Partial<Omit<DraftItem, "id">>): void {
    setItems((currentItems) =>
      currentItems.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
  }

  function addItem(): void {
    setItems((currentItems) => [...currentItems, createDraftItem(nextItemId.current++)]);
  }

  function removeItem(id: number): void {
    setItems((currentItems) =>
      currentItems.length > 1
        ? currentItems.filter((item) => item.id !== id)
        : currentItems,
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const normalizedClientOrderId = clientOrderId.trim();
    if (!normalizedClientOrderId || normalizedClientOrderId.length > 100) {
      setFormError("Client order ID phải có từ 1 đến 100 ký tự.");
      return;
    }

    if (!orderTimeInput) {
      setFormError("Hãy chọn thời điểm tạo đơn.");
      return;
    }

    const orderDate = new Date(orderTimeInput);
    if (!Number.isFinite(orderDate.getTime())) {
      setFormError("Thời điểm tạo đơn không hợp lệ.");
      return;
    }
    if (orderDate.getTime() > Date.now() + 5 * 60_000) {
      setFormError("Thời điểm tạo đơn không được quá 5 phút trong tương lai.");
      return;
    }

    const declaredAmount = Number(amountInput);
    if (!Number.isSafeInteger(declaredAmount) || declaredAmount <= 0) {
      setFormError("Giá trị khai báo phải là số nguyên VND lớn hơn 0.");
      return;
    }

    const requestItems = items.map((item) => ({
      product_sku: item.productSku,
      quantity: Number(item.quantity),
    }));
    if (requestItems.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) {
      setFormError("Số lượng của từng sản phẩm phải là số nguyên lớn hơn 0.");
      return;
    }
    if (new Set(requestItems.map((item) => item.product_sku)).size !== requestItems.length) {
      setFormError("Mỗi SKU chỉ được xuất hiện một lần trong đơn.");
      return;
    }

    try {
      await onSubmit({
        client_order_id: normalizedClientOrderId,
        retailer_id: LOCAL_RETAILER.id,
        order_time: orderDate.toISOString(),
        items: requestItems,
        declared_total_amount_vnd: declaredAmount,
      });
    } catch (error) {
      setFormError(formatApiError(error));
    }
  }

  return (
    <section className="page-card form-card" aria-labelledby="create-order-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Order Intake</p>
          <h1 id="create-order-title">Tạo đơn hàng mới</h1>
          <p>Order sẽ được lưu trước, rồi fraud worker xử lý bất đồng bộ.</p>
        </div>
      </div>

      <form className="order-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div className="form-grid">
          <label className="field">
            <span>Client order ID</span>
            <input
              value={clientOrderId}
              onChange={(event) => setClientOrderId(event.target.value)}
              maxLength={100}
              autoComplete="off"
              disabled={submitting}
            />
            <small>Mỗi ID đại diện cho một đơn logic trong web client.</small>
          </label>

          <label className="field">
            <span>Điểm bán</span>
            <input value={`${LOCAL_RETAILER.name} · ${LOCAL_RETAILER.id}`} disabled />
            <small>Master data local demo; M1 chưa có API danh mục.</small>
          </label>

          <label className="field">
            <span>Thời điểm tạo đơn</span>
            <input
              type="datetime-local"
              value={orderTimeInput}
              onChange={(event) => setOrderTimeInput(event.target.value)}
              disabled={submitting}
            />
            <small>Web client sẽ gửi ISO 8601 có timezone UTC.</small>
          </label>

          <label className="field">
            <span>Giá trị khai báo (VND)</span>
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              disabled={submitting}
            />
            <small>Đây không phải giá authoritative hay báo giá khuyến mại.</small>
          </label>
        </div>

        <fieldset className="items-fieldset" disabled={submitting}>
          <legend>Sản phẩm</legend>
          {items.map((item, index) => (
            <div className="order-item-row" key={item.id}>
              <label className="field">
                <span>SKU {index + 1}</span>
                <select
                  value={item.productSku}
                  onChange={(event) => updateItem(item.id, { productSku: event.target.value })}
                >
                  {LOCAL_PRODUCTS.map((product) => (
                    <option key={product.sku} value={product.sku}>
                      {product.name} · {product.sku}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field quantity-field">
                <span>Số lượng</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={item.quantity}
                  onChange={(event) => updateItem(item.id, { quantity: event.target.value })}
                />
              </label>
              <button
                className="button button--quiet item-remove-button"
                type="button"
                onClick={() => removeItem(item.id)}
                disabled={items.length === 1}
              >
                Bỏ
              </button>
            </div>
          ))}
          <button className="button button--secondary add-item-button" type="button" onClick={addItem}>
            Thêm sản phẩm
          </button>
        </fieldset>

        {formError ? <p className="inline-error" role="alert">{formError}</p> : null}

        <div className="form-actions">
          <button className="button button--quiet" type="button" onClick={onCancel} disabled={submitting}>
            Hủy
          </button>
          <button className="button button--primary" type="submit" disabled={submitting}>
            {submitting ? "Đang lưu an toàn..." : "Lưu và gửi kiểm tra"}
          </button>
        </div>
      </form>
    </section>
  );
}
