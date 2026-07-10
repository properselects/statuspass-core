// Entrypoint: npm start. Uses Supabase when SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY are set; otherwise in-memory dev stores.
import { startServer } from "./app.js";
import { createSupabase } from "./supabase.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (url && key) {
  const { stores, brandingStore } = createSupabase(url, key);
  startServer({ stores, brandingStore });
  console.log("[stores] Supabase");
} else {
  console.warn("[warn] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unset — using in-memory stores (data lost on restart)");
  startServer();
}
