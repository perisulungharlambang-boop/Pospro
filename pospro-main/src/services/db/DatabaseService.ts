/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * * ✅ DATABASE SERVICE UNTUK APLIKASI POS - WEB ONLY WITH SUPABASE SYNC
 * ✅ IndexedDB sebagai primary storage
 * ✅ Full Offline support + Cloud Sync
 */

import { indexdbBarang } from '@/lib/indexdbBarang';
import { indexdbTransaksi } from '@/lib/indexdbTransaksi';
import { useSettingsStore } from '@/store/useSettingsStore';
import { generateProductId } from '@/lib/utils';
// Tambahkan import Supabase Client bawaan proyek Anda (sesuaikan path jika berbeda)
import { supabase } from '@/lib/supabaseClient'; 

class DatabaseService {
  private isInitialized = false;
  private db: any = null; 

  constructor() {}

  async init(): Promise<boolean> {
    if (this.isInitialized) return true;
    try {
      console.log("✅ Berjalan di browser, menggunakan IndexedDB untuk storage");
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error("❌ Gagal inisialisasi Database:", error);
      return false;
    }
  }

  // ... (Method createTables, checkNeedMigration, dan doMigration tetap dipertahankan untuk kompatibilitas)
  private async createTables(): Promise<void> { return; }
  private async checkNeedMigration(): Promise<boolean> { return false; }
  private async doMigration(): Promise<void> { return; }

  async backupToJSON(): Promise<any> {
    await this.init();
    const products = await indexdbBarang.getAllBarang();
    const transactions = await indexdbTransaksi.getAll();
    const settings = useSettingsStore.getState();
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      products,
      transactions,
      settings: settings.storeInfo ? { storeInfo: settings.storeInfo, printer: null } : {}
    };
  }

  async restoreFromJSON(data: any): Promise<boolean> {
    try {
      if (data.products && Array.isArray(data.products)) {
        await indexdbBarang.clearAll();
        for (const p of data.products) await indexdbBarang.updateBarang(p);
      }
      if (data.transactions && Array.isArray(data.transactions)) {
        await indexdbTransaksi.clearAll();
        for (const trx of data.transactions) await indexdbTransaksi.createRaw(trx);
      }
      if (data.settings?.storeInfo) {
        useSettingsStore.getState().updateStoreInfo(data.settings.storeInfo);
      }
      return true;
    } catch (e) {
      console.error("Restore error:", e);
      return false;
    }
  }

  async resetTransactionData(): Promise<boolean> {
    try {
      await indexdbTransaksi.clearAll();
      return true;
    } catch (e) {
      console.error("Reset transaksi error:", e);
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

  async importProducts(products: any[]): Promise<{ success: number; error: number; total: number }> {
    let successCount = 0;
    let errorCount = 0;
    for (const product of products) {
      try {
        let finalProductId = product.id;
        if (!finalProductId) {
          finalProductId = generateProductId(product.sku, product.barcode) || `prod_autogen_${crypto.randomUUID()}`;
        }
        await indexdbBarang.updateBarang({ ...product, id: finalProductId });
        successCount++;
      } catch (err) {
        errorCount++;
      }
    }
    return { success: successCount, error: errorCount, total: successCount + errorCount };
  }

  // 🛠️ FUNGSI SINKRONISASI BARU YANG DIBAJAK UNTUK SUPABASE CLOUD
  async syncDatabases(
    onProgress?: (step: string, current: number, total: number) => void
  ): Promise<any> {
    const errors: string[] = [];
    const result = {
      platform: 'browser' as const,
      products: { idbToSql: 0, sqlToIdb: 0, conflicts: 0 },
      transactions: { idbToSql: 0, sqlToIdb: 0 },
      errors,
    };

    try {
      onProgress?.('Membaca data transaksi lokal dari HP...', 10, 100);
      const localTransactions = await indexdbTransaksi.getAll();
      
      // Filter transaksi yang belum sinkron ke cloud
      const unsyncedTransactions = localTransactions.filter((trx: any) => !trx.is_synced);
      
      if (unsyncedTransactions.length === 0) {
        onProgress?.('Semua data transaksi sudah sinkron dengan cloud! ✨', 100, 100);
        return result;
      }

      const totalTrx = unsyncedTransactions.length;
      let processed = 0;

      for (const trx of unsyncedTransactions) {
        onProgress?.(`Mengunggah transaksi ${trx.id.substring(0,8)}... ke Supabase`, 10 + Math.floor((processed / totalTrx) * 80), 100);
        
        // 1. Masukkan ke tabel induk 'transactions' di Supabase
        const { error: trxError } = await supabase
          .from('transactions')
          .insert({
            id: trx.id,
            transaction_number: trx.id, // Gunakan ID sebagai nomor transaksi unik
            total_amount: trx.total || 0,
            customer_id: null, // Set null jika tidak pakai relasi customer
            user_id: null,
            paid_amount: trx.cash_amount || 0,
            payment_method: trx.payment_method || 'cash',
            notes: `Web Sync - ${new Date().toLocaleDateString()}`,
            created_at: trx.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        if (trxError) {
          errors.push(`Transaksi [${trx.id}]: ${trxError.message}`);
          continue;
        }

        // 2. Masukkan ke tabel anak 'transaction_items' di Supabase
        if (trx.items && Array.isArray(trx.items)) {
          const itemsToInsert = trx.items.map((item: any) => ({
            id: `item-${trx.id}-${item.product_id || item.id || crypto.randomUUID()}`,
            transaction_id: trx.id,
            product_id: item.product_id || item.id || '',
            quantity: item.qty || item.quantity || 1,
            unit_price: item.price_at_sale || item.price || 0,
            subtotal: (item.qty || item.quantity || 1) * (item.price_at_sale || item.price || 0),
            created_at: trx.created_at || new Date().toISOString()
          }));

          const { error: itemsError } = await supabase
            .from('transaction_items')
            .insert(itemsToInsert);

          if (itemsError) {
            errors.push(`Items [${trx.id}]: ${itemsError.message}`);
            continue;
          }
        }

        // 3. Tandai lokal IndexedDB jika sukses agar tidak dikirim ganda
        trx.is_synced = true;
        await indexdbTransaksi.createRaw(trx);
        
        result.transactions.idbToSql++;
        processed++;
      }

      onProgress?.('Sinkronisasi cloud selesai sempurna! 🚀', 100, 100);
    } catch (e: any) {
      errors.push(`Sistem Error: ${e?.message}`);
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

