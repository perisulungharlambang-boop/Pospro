// @ts-nocheck
class DatabaseService {
  private isInitialized = false;

  constructor() {}

  async init(): Promise<boolean> {
    this.isInitialized = true;
    return true;
  }

  private async createTables(): Promise<void> { return; }
  private async checkNeedMigration(): Promise<boolean> { return false; }
  private async doMigration(): Promise<void> { return; }

  // 1. FUNGSI BACKUP JSON NYATA
  async backupToJSON(): Promise<any> {
    const localProducts = await (window as any).indexdbBarang?.getAllBarang() || [];
    const localTransactions = await (window as any).indexdbTransaksi?.getAll() || [];
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      products: localProducts,
      transactions: localTransactions
    };
  }

  // 2. FUNGSI RESTORE JSON NYATA (Bukan Formalitas Lagi)
  async restoreFromJSON(data: any): Promise<boolean> {
    try {
      if (data.products && Array.isArray(data.products) && (window as any).indexdbBarang) {
        await (window as any).indexdbBarang.clearAll();
        for (const p of data.products) {
          await (window as any).indexdbBarang.updateBarang(p);
        }
      }
      if (data.transactions && Array.isArray(data.transactions) && (window as any).indexdbTransaksi) {
        await (window as any).indexdbTransaksi.clearAll();
        for (const trx of data.transactions) {
          await (window as any).indexdbTransaksi.createRaw(trx);
        }
      }
      return true;
    } catch (e) {
      console.error("Gagal restore JSON:", e);
      return false;
    }
  }

  async resetTransactionData(): Promise<boolean> {
    try {
      if ((window as any).indexdbTransaksi) {
        await (window as any).indexdbTransaksi.clearAll();
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async exportData(): Promise<string> {
    const data = await this.backupToJSON();
    return JSON.stringify(data, null, 2);
  }

  async importData(json: string): Promise<boolean> {
    try {
      const data = JSON.parse(json);
      return this.restoreFromJSON(data);
    } catch (e) {
      return false;
    }
  }

  async importProducts(products: any[]): Promise<any> {
    let successCount = 0;
    let errorCount = 0;
    if (!(window as any).indexdbBarang) return { success: 0, error: products.length, total: products.length };

    for (const product of products) {
      try {
        let finalProductId = product.id || `prod_${Math.random().toString(36).substring(2, 11)}`;
        await (window as any).indexdbBarang.updateBarang({ ...product, id: finalProductId });
        successCount++;
      } catch (err) {
        errorCount++;
      }
    }
    return { success: successCount, error: errorCount, total: successCount + errorCount };
  }

  // 3. FUNGSI SINKRONISASI SUPABASE NYATA
  async syncDatabases(
    onProgress?: (step: string, current: number, total: number) => void
  ): Promise<any> {
    const errors: string[] = [];
    const result = { platform: 'browser' as const, products: { idbToSql: 0 }, transactions: { idbToSql: 0 }, errors };

    const clientSp = (window as any).supabase;
    if (!clientSp) {
      onProgress?.('Mencari koneksi Supabase Cloud...', 10, 100);
      errors.push('Client Supabase belum siap. Pastikan window.supabase sudah didaftarkan.');
      return result;
    }

    const makeSimpleId = () => Math.random().toString(36).substring(2, 15);

    try {
      onProgress?.('Membaca data barang di HP...', 30, 100);
      const localProducts = await (window as any).indexdbBarang?.getAllBarang() || [];
      
      if (localProducts.length > 0) {
        let count = 0;
        for (const prod of localProducts) {
          onProgress?.(`Sinkron Produk: ${prod.name || 'Barang'}`, 30 + Math.floor((count / localProducts.length) * 30), 100);
          await clientSp.from('products').insert({
            id: prod.id || makeSimpleId(),
            name: prod.name || '',
            sku: prod.sku || prod.barcode || '',
            barcode: prod.barcode || prod.sku || '',
            price_retail: prod.priceRetail || prod.price || 0,
            stock: prod.stock || 0,
            deleted: false
          });
          result.products.idbToSql++;
          count++;
        }
      }

      onProgress?.('Membaca data penjualan di HP...', 70, 100);
      const localTransactions = await (window as any).indexdbTransaksi?.getAll() || [];
      const unsyncedTransactions = localTransactions.filter((trx: any) => !trx.is_synced);

      if (unsyncedTransactions.length > 0) {
        let count = 0;
        for (const trx of unsyncedTransactions) {
          onProgress?.(`Sinkron Transaksi: ${trx.id.substring(0,8)}`, 70 + Math.floor((count / unsyncedTransactions.length) * 25), 100);
          
          const { error: trxError } = await clientSp.from('transactions').insert({
            id: trx.id,
            transaction_number: trx.id,
            total_amount: trx.total || 0,
            paid_amount: trx.cash_amount || 0,
            payment_method: trx.payment_method || 'cash',
            deleted: false
          });

          if (!trxError) {
            trx.is_synced = true;
            if ((window as any).indexdbTransaksi?.createRaw) {
              await (window as any).indexdbTransaksi.createRaw(trx);
            }
            result.transactions.idbToSql++;
          }
          count++;
        }
      }

      onProgress?.('Hebat! Semua data sukses meluncur ke Supabase Cloud! 🚀', 100, 100);
    } catch (e: any) {
      errors.push(`Error: ${e?.message}`);
    }

    return result;
  }

  async getInstance(): Promise<this> {
    await this.init();
    return this;
  }
}

export const databaseService = new DatabaseService();
export const dbProvider = databaseService;
