import { ProductScreen } from "@/app/products/product-screen";
import { getMastersPayload } from "@/lib/masters";

export default async function ProductsPage() {
  const masters = await getMastersPayload();

  return (
    <ProductScreen
      dbConnected={masters.dbConnected}
      products={masters.products}
    />
  );
}
