import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "./config";

/** Browser-safe client. RLS must protect every exposed table and function. */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = getSupabasePublicConfig();
  return createBrowserClient(url, anonKey);
}
