// @ts-nocheck
import { createClient } from '@supabase/supabase-js';

// Mengambil variabel dengan format standar Vite agar lolos ke browser HP
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Peringatan: Kunci Supabase belum terbaca di Vercel atau perangkat lokal!");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export default supabase;

