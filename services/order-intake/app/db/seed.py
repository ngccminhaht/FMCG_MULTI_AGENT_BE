"""Idempotent local master-data seed command for M1."""

from __future__ import annotations

from app.db.models import Product, Retailer, SalesRepresentative, SalesRetailerAssignment
from app.db.session import SessionLocal

DEMO_SALES_REP_ID = "HUNG-001"
DEMO_RETAILER_ID = "CO-LAN-001"
DEMO_PRODUCTS = {
    "SKU-NUOC-NGOT-001": "Nước ngọt chai",
    "SKU-MI-GOI-001": "Mì gói",
}


def seed_local_mvp_data() -> None:
    """Create the minimum deterministic data set required by the local MVP."""
    with SessionLocal() as db:
        if db.get(SalesRepresentative, DEMO_SALES_REP_ID) is None:
            db.add(
                SalesRepresentative(
                    id=DEMO_SALES_REP_ID,
                    display_name="Nguyễn Văn Hùng",
                    is_active=True,
                )
            )
        if db.get(Retailer, DEMO_RETAILER_ID) is None:
            db.add(
                Retailer(
                    id=DEMO_RETAILER_ID,
                    display_name="Tạp hóa cô Lan",
                    is_active=True,
                )
            )
        for sku, display_name in DEMO_PRODUCTS.items():
            if db.get(Product, sku) is None:
                db.add(Product(sku=sku, display_name=display_name, is_active=True))
        if db.get(SalesRetailerAssignment, (DEMO_SALES_REP_ID, DEMO_RETAILER_ID)) is None:
            db.add(
                SalesRetailerAssignment(
                    sales_rep_id=DEMO_SALES_REP_ID,
                    retailer_id=DEMO_RETAILER_ID,
                    is_active=True,
                )
            )
        db.commit()


if __name__ == "__main__":
    seed_local_mvp_data()
    print("Local M1 seed data is ready.")
