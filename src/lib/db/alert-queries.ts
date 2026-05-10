import type { SupabaseClient } from '@supabase/supabase-js'

export interface AlertRecord {
  id: string
  user_id: string
  type: 'cheap_hour' | 'free_energy' | 'spike' | 'negative'
  threshold_eur_mwh: string | number | null
  channels: string[]
  active: boolean
  schedule: {
    quietStartHour?: number
    quietEndHour?: number
    weekdays?: number[]
  } | null
  created_at: string
}

export interface AlertWithProfile extends AlertRecord {
  profile: {
    country: 'PT' | 'ES'
    push_subscription: PushSubscriptionJSON | null
    whatsapp_e164: string | null
    locale: string | null
  }
}

/** Trimmed PushSubscription JSON returned by the browser PushManager. */
export interface PushSubscriptionJSON {
  endpoint: string
  expirationTime?: number | null
  keys: {
    p256dh: string
    auth: string
  }
}

export interface AlertEventRecord {
  id: string
  alert_id: string
  user_id: string
  sent_at: string
  channel: string
  payload: Record<string, unknown> | null
  status: 'sent' | 'failed' | 'skipped'
}

export async function listAlertsForUser(
  client: SupabaseClient,
  userId: string,
): Promise<AlertRecord[]> {
  const { data, error } = await client
    .from('alerts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as AlertRecord[]
}

export async function getAlertById(
  client: SupabaseClient,
  id: string,
): Promise<AlertRecord | null> {
  const { data, error } = await client.from('alerts').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as AlertRecord | null
}

export async function listActiveAlertsWithProfile(
  client: SupabaseClient,
): Promise<AlertWithProfile[]> {
  const { data, error } = await client
    .from('alerts')
    .select(
      'id, user_id, type, threshold_eur_mwh, channels, active, schedule, created_at, profile:profiles!inner(country, push_subscription, whatsapp_e164, locale)',
    )
    .eq('active', true)
  if (error) throw error
  return (data ?? []) as unknown as AlertWithProfile[]
}

export async function insertAlert(
  client: SupabaseClient,
  row: {
    user_id: string
    type: AlertRecord['type']
    threshold_eur_mwh: number | null
    channels: string[]
    schedule: AlertRecord['schedule']
  },
): Promise<{ id: string }> {
  const { data, error } = await client
    .from('alerts')
    .insert({ ...row, active: true })
    .select('id')
    .single()
  if (error) throw error
  return data as { id: string }
}

export async function updateAlert(
  client: SupabaseClient,
  id: string,
  patch: Partial<{
    type: AlertRecord['type']
    threshold_eur_mwh: number | null
    channels: string[]
    schedule: AlertRecord['schedule']
    active: boolean
  }>,
): Promise<void> {
  const { error } = await client.from('alerts').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteAlert(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('alerts').delete().eq('id', id)
  if (error) throw error
}

export async function recentAlertEvents(
  client: SupabaseClient,
  alertId: string,
  sinceIso: string,
): Promise<AlertEventRecord[]> {
  const { data, error } = await client
    .from('alert_events')
    .select('*')
    .eq('alert_id', alertId)
    .gte('sent_at', sinceIso)
    .order('sent_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as AlertEventRecord[]
}

export async function listAlertEventsForUser(
  client: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<AlertEventRecord[]> {
  const { data, error } = await client
    .from('alert_events')
    .select('*')
    .eq('user_id', userId)
    .order('sent_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as AlertEventRecord[]
}

export async function insertAlertEvent(
  client: SupabaseClient,
  row: {
    alert_id: string
    user_id: string
    channel: string
    payload: Record<string, unknown>
    status: 'sent' | 'failed' | 'skipped'
  },
): Promise<void> {
  const { error } = await client.from('alert_events').insert(row)
  if (error) throw error
}

export async function setProfilePushSubscription(
  client: SupabaseClient,
  userId: string,
  subscription: PushSubscriptionJSON | null,
): Promise<void> {
  const { error } = await client
    .from('profiles')
    .update({ push_subscription: subscription })
    .eq('id', userId)
  if (error) throw error
}
