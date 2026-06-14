  async syncDatabases(
    onProgress?: (step: string, current: number, total: number) => void
  ): Promise<any> {
    const errors: string[] = [];
    const result = {
      platform: 'browser' as const,
      products: { idbToSql: 0 },
      transactions: { idbToSql: 0 },
      customers: { idbToSql: 0 },
      suppliers: { idbToSql: 0 },
      debts: { idbToSql: 0 },
      errors,
    };

    const makeSimpleId = () => Math.random().toString(36).substring(2, 15);

    try {
      try {
        onProgress?.('Membaca data pelanggan dari HP...', 5, 100);
        const localCustomers = await (window as any).indexdbCustomer?.getAll() || [];
        if (localCustomers.length > 0) {
          let count = 0;
          for (const cust of localCustomers) {
            onProgress?.(`Mengunggah pelanggan: ${cust.name}...`, 5 + Math.floor((count / localCustomers.length) * 15), 100);
            const { error } = await supabase.from('customers').insert({
              id: cust.id || makeSimpleId(),
              name: cust.name,
              email: cust.email || null,
              phone: cust.phone || null,
              address: cust.address || null,
              customer_type: cust.customer_type || 'retail',
              is_active: cust.is_active ?? true,
              created_at: cust.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
              deleted: false
            });
            if (!error) result.customers.idbToSql++;
            count++;
          }
        }
      } catch (e: any) { console.log("Skip customers:", e.message); }

      try {
        onProgress?.('Membaca data supplier dari HP...', 20, 100);
        const localSuppliers = await (window as any).indexdbSupplier?.getAll() || [];
        if (localSuppliers.length > 0) {
          let count = 0;
          for (const sup of localSuppliers) {
            onProgress?.(`Mengunggah supplier: ${sup.name}...`, 20 + Math.floor((count / localSuppliers.length) * 15), 100);
            const { error } = await supabase.from('suppliers').insert({
              id: sup.id || makeSimpleId(),
              name: sup.name,
              email: sup.email || null,
              phone: sup.phone || null,
              address: sup.address || null,
              contact_person: sup.contact_person || null,
              is_active: sup.is_active ?? true,
              created_at: sup.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
              deleted: false
            });
            if (!error) result.suppliers.idbToSql++;
            count++;
          }
        }
      } catch (e: any) { console.log("Skip suppliers:", e.message); }

      onProgress?.('Membaca data produk barang dari HP...', 35, 100);
      const localProducts = await indexdbBarang.getAllBarang();
      if (localProducts.length > 0) {
        let count = 0;
        for (const prod of localProducts) {
          onProgress?.(`Mengunggah produk: ${prod.name || 'Barang'}...`, 35 + Math.floor((count / localProducts.length) * 20), 100);
          const { error: prodError } = await supabase.from('products').insert({
            id: prod.id || makeSimpleId(),
            name: prod.name || '',
            sku: prod.sku || prod.barcode || '',
            barcode: prod.barcode || prod.sku || '',
            price_retail: prod.priceRetail || prod.price || 0,
            price_wholesale: prod.priceWholesale || prod.wholesale_price || 0,
            price_cost: prod.priceCost || prod.cost_price || prod.capitalPrice || 0,
            stock: prod.stock || 0,
            min_stock: prod.min_stock || 0,
            created_at: prod.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deleted: false
          });
          if (!prodError) result.products.idbToSql++;
          count++;
        }
      }

      onProgress?.('Membaca data transaksi dari HP...', 55, 100);
      const localTransactions = await indexdbTransaksi.getAll();
      const unsyncedTransactions = localTransactions.filter((trx: any) => !trx.is_synced);
      
      if (unsyncedTransactions.length > 0) {
        let count = 0;
        for (const trx of unsyncedTransactions) {
          onProgress?.(`Mengunggah transaksi ${trx.id.substring(0,8)}...`, 55 + Math.floor((count / unsyncedTransactions.length) * 25), 100);
          
          const { error: trxError } = await supabase.from('transactions').insert({
            id: trx.id,
            transaction_number: trx.id,
            total_amount: trx.total || 0,
            paid_amount: trx.cash_amount || 0,
            payment_method: trx.payment_method || 'cash',
            notes: `Web Sync`,
            created_at: trx.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deleted: false
          });

          if (trxError) {
            errors.push(`Transaksi [${trx.id}]: ${trxError.message}`);
            continue;
          }

          if (trx.items && Array.isArray(trx.items)) {
            const itemsToInsert = trx.items.map((item: any) => ({
              id: `item-${trx.id}-${item.product_id || item.id || makeSimpleId()}`,
              transaction_id: trx.id,
              product_id: item.product_id || item.id || '',
              quantity: item.qty || item.quantity || 1,
              unit_price: item.price_at_sale || item.price || 0,
              subtotal: (item.qty || item.quantity || 1) * (item.price_at_sale || item.price || 0),
              created_at: trx.created_at || new Date().toISOString()
            }));

            const { error: itemsError } = await supabase.from('transaction_items').insert(itemsToInsert);
            if (itemsError) errors.push(`Items Trx [${trx.id}]: ${itemsError.message}`);
          }

          trx.is_synced = true;
          await indexdbTransaksi.createRaw(trx);
          result.transactions.idbToSql++;
          count++;
        }
      }

      try {
        onProgress?.('Membaca data rekapan utang...', 80, 100);
        const localDebts = await (window as any).indexdbDebts?.getAll() || [];
        if (localDebts.length > 0) {
          let count = 0;
          for (const debt of localDebts) {
            onProgress?.(`Mengunggah data utang toko...`, 80 + Math.floor((count / localDebts.length) * 15), 100);
            const { error } = await supabase.from('debts').insert({
              id: debt.id || makeSimpleId(),
              customer_id: debt.customer_id,
              transaction_id: debt.transaction_id || null,
              amount: debt.amount || 0,
              paid_amount: debt.paid_amount || 0,
              remaining_amount: debt.remaining_amount || 0,
              status: debt.status || 'unpaid',
              created_at: debt.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
              deleted: false
            });
            if (!error) result.debts.idbToSql++;
            count++;
          }
        }
      } catch (e: any) { console.log("Skip debts:", e.message); }

      onProgress?.('Seluruh data berhasil disinkronkan! 🚀', 100, 100);
    } catch (e: any) {
      errors.push(`Sistem Error Global: ${e?.message}`);
    }

    return result;
  }
