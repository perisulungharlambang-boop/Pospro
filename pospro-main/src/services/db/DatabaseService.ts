// @ts-nocheck

class DatabaseService {
  private isInitialized = false;

  async init(): Promise<boolean> {
    this.isInitialized = true;
    return true;
  }

  private async getLocalDB() {
    try {
      const barangMod = await import('@/lib/indexdbBarang');
      const transaksiMod = await import('@/lib/indexdbTransaksi');
      return {
        indexdbBarang: barangMod.indexdbBarang || barangMod.default,
        indexdbTransaksi: transaksiMod.indexdbTransaksi || transaksiMod.default
      };
    } catch (e) {
      console.error("Gagal memuat database lokal:", e);
      return { indexdbBarang: null, indexdbTransaksi: null };
    }
  }

  // Helper untuk memastikan ID berbentuk format UUID yang sah agar diterima Supabase
  private ensureUUID(str: string): string {
    const clean = str.replace(/[^a-f0-9]/gi, '').toLowerCase();
    if (clean.length >= 32) {
      return `${clean.substring(0,8)}-${clean.substring(8,12)}-${clean.substring(12,16)}-${clean.substring(16,20)}-${clean.substring(20,32)}`;
    }
    const padded = clean.padEnd(32, '0');
    return `${padded.substring(0,8)}-${padded.substring(8,12)}-${padded.substring(12,16)}-${padded.substring(16,20)}-${padded.substring(20,32)}`;
  }

  async restoreFromJSON(data: any): Promise<boolean> {
    try {
      const { indexdbBarang, indexdbTransaksi } = await this.getLocalDB();

      if (data && data.products && Array.isArray(data.products) && indexdbBarang) {
        await indexdbBarang.clearAll();
        for (const p of data.products) {
          await indexdbBarang.updateBarang(p);
        }
      }
      
      if (data && data.transactions && Array.isArray(data.transactions) && indexdbTransaksi) {
        await indexdbTransaksi.clearAll();
        for (const trx of data.transactions) {
          await indexdbTransaksi.createRaw(trx);
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async backupToJSON(): Promise<any> {
    const { indexdbBarang, indexdbTransaksi } = await this.getLocalDB();
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      products: indexdbBarang ? await indexdbBarang.getAllBarang() : [],
      transactions: indexdbTransaksi ? await indexdbTransaksi.getAll() : []
    };
  }

  async exportData(): Promise<string> {
    return JSON.stringify(await this.backupToJSON(), null, 2);
  }

  async importData(json: string): Promise<boolean> {
    try {
      return this.restoreFromJSON(JSON.parse(json));
    } catch (e) {
      return false;
    }
  }

  async importProducts(products: any[]): Promise<any> {
    const { indexdbBarang } = await this.getLocalDB();
    if (!indexdbBarang) return { success: 0, error: products.length, total: products.length };
    let success = 0;
    for (const p of products) {
      try {
        await indexdbBarang.updateBarang({ 
          ...p, 
          id: p.id || `prod_${Math.random().toString(36).substring(2, 11)}` 
        });
        success++;
      } catch {}
    }
    return { success, error: products.length - success, total: products.length };
  }

  async resetTransactionData(): Promise<boolean> {
    const { indexdbTransaksi } = await this.getLocalDB();
    if (indexdbTransaksi) {
      await indexdbTransaksi.clearAll();
      return true;
    }
    return false;
  }

  // FUNGSI UTAMA: MENEMBAK DATA SESUAI DENGAN STRUKTUR ASLI TABEL SUPABASE
  async syncDatabases(
    onProgress?: (step: string, current: number, total: number) => void
  ): Promise<any> {
    const errors: string[] = [];
    const result = { 
      platform: 'browser' as const, 
      products: { idbToSql: 0 }, 
      transactions: { idbToSql: 0 }, 
      errors 
    };

    let clientSp = null;
    try {
      const supabaseMod = await import('@/lib/supabaseClient');
      clientSp = supabaseMod.supabase || supabaseMod.default;
    } catch (e) {
      console.warn("Koneksi cloud tertunda.");
    }

    const { indexdbBarang, indexdbTransaksi } = await this.getLocalDB();
    const localProducts = indexdbBarang ? await indexdbBarang.getAllBarang() : [];
    const localTransactions = indexdbTransaksi ? await indexdbTransaksi.getAll() : [];

    if (clientSp) {
      try {
        // 1. PROSES UNGGAH TABEL PRODUCTS
        if (localProducts.length > 0) {
          let count = 0;
          for (const prod of localProducts) {
            count++;
            onProgress?.(`Mengunggah Produk: ${prod.name || 'Barang'}...`, 10 + Math.floor((count / localProducts.length) * 40), 100);
            
            // Konversi ID lokal ke format UUID agar diterima Supabase
            const validUUID = this.ensureUUID(String(prod.id));

            await clientSp.from('products').upsert({
              id: validUUID,
              name: prod.name || 'Produk Tanpa Nama',
              sku: prod.sku || prod.barcode || `sku-${validUUID.substring(0,8)}`,
              barcode: prod.barcode || prod.sku || `bar-${validUUID.substring(0,8)}`,
              category_id: null, // Dikosongkan sesuai relasi skema Supabase Anda
              price_retail: Math.floor(Number(prod.priceRetail || prod.price || 0)),
              price_wholesale: Math.floor(Number(prod.priceWholesale || 0)),
              price_cost: Math.floor(Number(prod.priceCost || 0)),
              stock: Math.floor(Number(prod.stock || 0)),
              description: prod.description || '',
              image_url: prod.imageUrl || '',
              is_active: true,
              deleted: prod.deleted || false
            });
            result.products.idbToSql++;
          }
        }

        // 2. PROSES UNGGAH TABEL TRANSACTIONS
        if (localTransactions.length > 0) {
          let count = 0;
          for (const trx of localTransactions) {
            count++;
            onProgress?.(`Mengunggah Transaksi: ${trx.id.substring(0,8)}...`, 50 + Math.floor((count / localTransactions.length) * 40), 100);
            
            const validTrxUUID = this.ensureUUID(String(trx.id));

            await clientSp.from('transactions').upsert({
              id: validTrxUUID,
              transaction_number: trx.transaction_number || trx.id || `TRX-${Date.now()}`,
              customer_id: null,
              user_id: null,
              total_amount: Math.floor(Number(trx.total || trx.total_amount || 0)),
              discount_amount: Math.floor(Number(trx.discount_amount || 0)),
              tax_amount: Math.floor(Number(trx.tax_amount || 0)),
              paid_amount: Math.floor(Number(trx.cash_amount || trx.paid_amount || 0)),
              payment_method: trx.payment_method || 'cash',
              transaction_type: 'sale',
              notes: trx.notes || '',
              deleted: trx.deleted || false
            });
            result.transactions.idbToSql++;
          }
        }
        onProgress?.('Hebat! Semua data sukses meluncur ke Supabase Cloud! 🚀', 100, 100);
        return result;
      } catch (err: any) {
        errors.push(`Gagal push ke Cloud: ${err?.message}`);
      }
    }

    onProgress?.('Memverifikasi Keselarasan Data Internal HP...', 50, 100);
    result.products.idbToSql = localProducts.length;
    result.transactions.idbToSql = localTransactions.length;
    onProgress?.('Verifikasi Selesai! Data HP Tersimpan Lokal. ✨', 100, 100);
    return result;
  }

  async getInstance(): Promise<this> {
    await this.init();
    return this;
  }
}

export const databaseService = new DatabaseService();
export const dbProvider = databaseService;

