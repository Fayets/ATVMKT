import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET /api/youtube-analytics/callback — Handle OAuth2 callback from Google
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  if (error || !code) {
    return NextResponse.redirect(`${siteUrl}/youtube?error=oauth_denied`)
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${siteUrl}/youtube?error=missing_config`)
  }

  const redirectUri = `${siteUrl}/api/youtube-analytics/callback`

  // Exchange code for tokens
  let tokenData: Record<string, unknown>
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      console.error('OAuth token exchange failed:', errText)
      return NextResponse.redirect(`${siteUrl}/youtube?error=token_exchange_failed`)
    }

    tokenData = await tokenRes.json()
  } catch (e) {
    console.error('OAuth fetch error:', e)
    return NextResponse.redirect(`${siteUrl}/youtube?error=token_fetch_error`)
  }

  if (!tokenData.access_token) {
    console.error('No access_token in response:', tokenData)
    return NextResponse.redirect(`${siteUrl}/youtube?error=no_access_token`)
  }

  // Save tokens to api_connections
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Auth error in callback:', authError?.message || 'no user')
      return NextResponse.redirect(`${siteUrl}/youtube?error=not_authenticated`)
    }

    // Get existing YouTube connection to merge credentials
    const { data: existing } = await supabase
      .from('api_connections')
      .select('credentials')
      .eq('user_id', user.id)
      .eq('platform', 'youtube')
      .maybeSingle()

    const existingCreds = (existing?.credentials || {}) as Record<string, string>

    const newCreds = {
      ...existingCreds,
      oauth_access_token: tokenData.access_token as string,
      oauth_refresh_token: (tokenData.refresh_token as string) || existingCreds.oauth_refresh_token || '',
      oauth_expires_at: new Date(Date.now() + (Number(tokenData.expires_in) || 3600) * 1000).toISOString(),
    }

    // Use update (not upsert) since the row already exists from Conexiones API setup
    const { error: updateError } = await supabase
      .from('api_connections')
      .update({ credentials: newCreds, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('platform', 'youtube')

    if (updateError) {
      console.error('Update error:', updateError)
      return NextResponse.redirect(`${siteUrl}/youtube?error=save_failed_${updateError.code}`)
    }

    return NextResponse.redirect(`${siteUrl}/youtube?analytics=connected`)
  } catch (e) {
    console.error('Callback error:', e)
    return NextResponse.redirect(`${siteUrl}/youtube?error=callback_error`)
  }
}
