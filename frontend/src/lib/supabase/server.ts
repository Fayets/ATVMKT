import { createClient as createMockClient } from '@/lib/supabase/client'

export async function createClient() {
  return createMockClient()
}
