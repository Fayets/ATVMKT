import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

type Platform = 'calendly' | 'fathom' | 'manychat'

// Obtener credenciales de una plataforma por webhook_token
export async function getCredentialsByToken(platform: Platform, webhookToken: string) {
  const { data } = await supabase
    .from('api_connections')
    .select('user_id, credentials')
    .eq('platform', platform)
    .filter('credentials->>webhook_token', 'eq', webhookToken)
    .limit(1)
    .single()

  return data ? { userId: data.user_id, credentials: data.credentials as Record<string, string> } : null
}

// Obtener credenciales de una plataforma por user_id
export async function getCredentialsByUser(platform: Platform, userId: string) {
  const { data } = await supabase
    .from('api_connections')
    .select('credentials')
    .eq('platform', platform)
    .eq('user_id', userId)
    .limit(1)
    .single()

  return data?.credentials as Record<string, string> | null
}
