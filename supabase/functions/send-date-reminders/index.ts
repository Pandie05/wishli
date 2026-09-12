// deno edge function -- scans for wishlists whose target_date is coming up
// and notifies the owner, once per list (see reminder_sent_at in 013).
//
// this is a cross-account scan, not a request made on behalf of one signed-in
// user, so it cannot run as anon/authenticated like the rest of the app --
// it needs the service role key, which bypasses rls entirely. that key is an
// edge-function secret set separately (see the README), never something that
// belongs in the repo or gets passed in by the caller.
//
// triggered by .github/workflows/date-reminders.yml on a daily cron, the same
// pattern supabase-keepalive.yml already uses for its own scheduled ping.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.1'

const REMINDER_WINDOW_DAYS = 3

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set for this function' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const supabase = createClient(url, serviceRoleKey)

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const windowEnd = new Date(today)
  windowEnd.setUTCDate(windowEnd.getUTCDate() + REMINDER_WINDOW_DAYS)

  const { data: due, error: selectError } = await supabase
    .from('wishlists')
    .select('wishlist_id, id, name, target_date')
    .is('reminder_sent_at', null)
    .gte('target_date', today.toISOString().slice(0, 10))
    .lte('target_date', windowEnd.toISOString().slice(0, 10))

  if (selectError) {
    return new Response(JSON.stringify({ error: selectError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let sent = 0

  for (const wishlist of due ?? []) {
    const days = Math.round(
      (new Date(`${wishlist.target_date}T00:00:00Z`).getTime() - today.getTime()) / 86_400_000,
    )
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`

    const { error: notifyError } = await supabase.from('notifications').insert({
      user_id: wishlist.id,
      wishlist_id: wishlist.wishlist_id,
      type: 'target_date_reminder',
      message: `"${wishlist.name}" is due ${when}`,
    })

    if (notifyError) continue

    const { error: stampError } = await supabase
      .from('wishlists')
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq('wishlist_id', wishlist.wishlist_id)

    if (!stampError) sent += 1
  }

  return new Response(JSON.stringify({ checked: due?.length ?? 0, sent }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
