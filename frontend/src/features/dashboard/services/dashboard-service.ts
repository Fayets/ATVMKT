import { createClient } from '@/lib/supabase/server'
import type { DashboardData } from '../types/dashboard'

function getMonthRange(month: string): { start: string; end: string } {
  const [year, m] = month.split('-').map(Number)
  const start = new Date(year, m - 1, 1).toISOString()
  const end = new Date(year, m, 0, 23, 59, 59).toISOString()
  return { start, end }
}

function getPrevMonth(month: string): string {
  const [year, m] = month.split('-').map(Number)
  const d = new Date(year, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

async function getMonthData(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, month: string) {
  const { start, end } = getMonthRange(month)

  // Content items (reels, stories, videos)
  const { data: content } = await supabase
    .from('content_items')
    .select('content_type, cash, chats')
    .eq('user_id', userId)
    .gte('published_at', start)
    .lte('published_at', end)

  // BIO entries (manual)
  const { data: bio } = await supabase
    .from('bio_entries')
    .select('chats, cash')
    .eq('user_id', userId)
    .eq('month', month)

  // BIO entries (auto from ManyChat)
  const { data: manychatChats } = await supabase
    .from('manychat_chats')
    .select('id')
    .eq('user_id', userId)
    .eq('month', month)

  // Referral entries
  const { data: referrals } = await supabase
    .from('referral_entries')
    .select('chats, cash')
    .eq('user_id', userId)
    .eq('month', month)

  // Deferred entries
  const { data: deferred } = await supabase
    .from('deferred_entries')
    .select('cash')
    .eq('user_id', userId)
    .eq('month', month)

  const items = content || []
  const bioItems = bio || []
  const refItems = referrals || []
  const defItems = deferred || []

  // Calculate by channel
  const reels = items.filter(i => i.content_type === 'reel')
  const historias = items.filter(i => i.content_type === 'story' || i.content_type === 'historia')
  const youtube = items.filter(i => i.content_type === 'video')

  const reelsCash = reels.reduce((s, i) => s + (Number(i.cash) || 0), 0)
  const reelsChats = reels.reduce((s, i) => s + (Number(i.chats) || 0), 0)

  const historiasCash = historias.reduce((s, i) => s + (Number(i.cash) || 0), 0)
  const historiasChats = historias.reduce((s, i) => s + (Number(i.chats) || 0), 0)

  const ytCash = youtube.reduce((s, i) => s + (Number(i.cash) || 0), 0)
  const ytChats = youtube.reduce((s, i) => s + (Number(i.chats) || 0), 0)

  const bioCash = bioItems.reduce((s, i) => s + (Number(i.cash) || 0), 0)
  const bioChats = bioItems.reduce((s, i) => s + (Number(i.chats) || 0), 0) + (manychatChats?.length || 0)

  const refCash = refItems.reduce((s, i) => s + (Number(i.cash) || 0), 0)
  const refChats = refItems.reduce((s, i) => s + (Number(i.chats) || 0), 0)

  const defCash = defItems.reduce((s, i) => s + (Number(i.cash) || 0), 0)

  const cashTotal = reelsCash + historiasCash + ytCash + bioCash + refCash + defCash
  const chatsTotal = reelsChats + historiasChats + ytChats + bioChats + refChats
  const piezas = items.length
  const cpc = chatsTotal > 0 ? cashTotal / chatsTotal : 0

  return {
    cashTotal,
    chatsTotal,
    piezas,
    cpc,
    channels: [
      { name: 'Reels', chats: reelsChats, cash: reelsCash, cpc: reelsChats > 0 ? reelsCash / reelsChats : 0, color: '#EF4444' },
      { name: 'Historias', chats: historiasChats, cash: historiasCash, cpc: historiasChats > 0 ? historiasCash / historiasChats : 0, color: '#F59E0B' },
      { name: 'BIO', chats: bioChats, cash: bioCash, cpc: bioChats > 0 ? bioCash / bioChats : 0, color: '#A855F7' },
      { name: 'YouTube', chats: ytChats, cash: ytCash, cpc: ytChats > 0 ? ytCash / ytChats : 0, color: '#3B82F6' },
      { name: 'Referidos', chats: refChats, cash: refCash, cpc: refChats > 0 ? refCash / refChats : 0, color: '#22C55E' },
    ],
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const month = getCurrentMonth()
  const prev = getPrevMonth(month)

  const current = await getMonthData(supabase, user.id, month)
  const previous = await getMonthData(supabase, user.id, prev)

  return {
    ...current,
    prevMonth: {
      cashTotal: previous.cashTotal,
      chatsTotal: previous.chatsTotal,
      piezas: previous.piezas,
      cpc: previous.cpc,
    },
  }
}
