// Shapes for the local cash sale store, kept apart from the store itself so
// pure consumers — the round summary, its tests — can use them without
// pulling AsyncStorage in behind them.

export type CashSaleItem = {
  productId: string;
  code: string;
  // Stored alongside the code so a sale recorded weeks ago still reads back
  // with a real product name. Optional because entries written before this
  // existed have only the code — productLabel() falls back to it.
  name?: string;
  unit: string;
  rate: number;
  quantity: number;
  amount: number;
};

export type CashSaleEntry = {
  id: string;
  routeId: string;
  // YYYY-MM-DD. Which round this sale belongs to, alongside routeId. Entries
  // written before sessions existed have no value here, so readers derive it
  // from createdAt — see sessionDateOf.
  sessionDate?: string;
  createdAt: string; // ISO timestamp
  items: CashSaleItem[];
  totalAmount: number;
};

export type CashSaleSessionTotals = {
  entryCount: number;
  totalAmount: number;
  products: Array<{ productId: string; code: string; name?: string; unit: string; quantity: number; amount: number }>;
};
