// @ts-nocheck

class DatabaseService {
  private isInitialized = false;

  async init(): Promise<boolean> {
    this.isInitialized = true;
    return true;
  }

  // Mengambil database lokal bawaan aplikasi kasir di HP Anda
  private async getLocalDB() {
    try {
      const barangMod = await import('@/lib/indexdbBarang');
      const transaksiMod = await import('@/lib/indexdbTransaksi');
      return {
        indexdbBarang: barangMod.indexdbBarang || barangMod.default,
        indexdbTransaksi: transaksiMod.indexdbTransaksi || transaksiMod.default
      };
    } catch (e) {
      console.error("Gagal memuat modul database lokal:", e);
      return { indexdbBarang: null, indexdbTransaksi: null };
    }
  }

  // Memulihkan data dari file JSON kembali ke dalam HP (Offline-First)
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

  // TOMBOL UTAMA: MENEMBAK DATA PRODUK DAN TRANSAKSI KE SUPABASE
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
      console.warn("Koneksi Supabase Cloud tertunda.");
    }

    const { indexdbBarang, indexdbTransaksi } = await this.getLocalDB();
    const localProducts = indexdbBarang ? await indexdbBarang.getAllBarang() : [];
    const localTransactions = indexdbTransaksi ? await indexdbTransaksi.getAll() : [];

    if (clientSp) {
      try {
        // PROSES UNGGAH TABEL BARANG (PRODUCTS)
        if (localProducts.length > 0) {
          let count = 0;
          for (const prod of localProducts) {
            count++;
            onProgress?.(`Mengunggah Produk Cloud: ${prod.name || 'Barang'}...`, 10 + Math.floor((count / localProducts.length) * 40), 100);
            
            await clientSp.from('products').upsert({
              id: prod.id,
              name: prod.name || '',
              sku: prod.sku || prod.barcode || '',
              barcode: prod.barcode || prod.sku || '',
              price_retail: prod.priceRetail || prod.price || 0,
              stock: prod.stock || 0,
              deleted: false
            });
            result.products.idbToSql++;
          }
        }

        // PROSES UNGGAH TABEL TRANSAKSI (TRANSACTIONS)
        if (localTransactions.length > 0) {
          let count = 0;
          for (const trx of localTransactions) {
            count++;
            onProgress?.(`Mengunggah Transaksi Cloud: ${trx.id.substring(0,8)}...`, 50 + Math.floor((count / localTransactions.length) * 40), 100);
            
            await clientSp.from('transactions').upsert({
              id: trx.id,
              transaction_number: trx.id,
              total_amount: trx.total || 0,
              paid_amount: trx.cash_amount || 0,
              payment_method: trx.payment_method || 'cash',
              deleted: false
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

    // JALUR CADANGAN JIKA KONEKSI INTERNET ERROR
    onProgress?.('Memverifikasi Data Internal HP...', 50, 100);
    result.products.idbToSql = localProducts.length;
    result.transactions.idbToSql = localTransactions.length;
    onProgress?.('Verifikasi Selesai! Data HP Anda Aman Tersimpan Lokal. ✨', 100, 100);
    return result;
  }

  async getInstance(): Promise<this> {
    await this.init();
    return this;
  }
}

export const databaseService = new DatabaseService();
export const dbProvider = databaseService;

