-- ===================================================================
--  Migration 004 — first-run setup, entry thesis, and charge config
--
--  Purely additive. Re-runnable. Independent of migrations 002 and 003,
--  so it is safe to run before either of those.
--
--  IMPORTANT: no existing `charges` value is read, altered or cleared by
--  this migration. Every trade you have already logged keeps exactly the
--  charge figure you entered. The new charges_auto flag defaults to false
--  on existing rows, which is what tells the app those numbers were set
--  by you and must never be overwritten by the calculator.
-- ===================================================================

-- -------------------------------------------------------------------
--  1. Has this user been through setup?
--
--  Null means no. Checking this explicitly beats inferring it from
--  "is account_size still the default" — someone whose capital really
--  is ten lakh would otherwise be asked to set it up forever.
-- -------------------------------------------------------------------
alter table public.profiles
  add column if not exists onboarded_at timestamptz;

update public.profiles p
   set onboarded_at = now()
 where p.onboarded_at is null
   and exists (select 1 from public.trades t where t.user_id = p.id);

-- -------------------------------------------------------------------
--  2. The one line explaining why this trade.
--
--  Recorded at entry, before the outcome is known — which is the only
--  reason it is worth anything. Read back months later it shows what you
--  actually thought, not what you would reconstruct having seen how it
--  turned out.
-- -------------------------------------------------------------------
alter table public.trades add column if not exists thesis text;
alter table public.trades add column if not exists thesis_written_at timestamptz;

-- Stamp when the thesis first appears, so the UI can distinguish one
-- written at entry from one backfilled after the exit. Those are
-- different kinds of evidence.
create or replace function public.stamp_thesis()
returns trigger language plpgsql as $$
begin
  if new.thesis is not null
     and coalesce(old.thesis, '') = ''
     and new.thesis <> '' then
    new.thesis_written_at = now();
  end if;
  return new;
end $$;

drop trigger if exists trades_stamp_thesis on public.trades;
create trigger trades_stamp_thesis
  before insert or update of thesis on public.trades
  for each row execute function public.stamp_thesis();

-- -------------------------------------------------------------------
--  3. Charge configuration, per user.
--
--  JSONB rather than columns on purpose: every rate in here moves with a
--  Union Budget or an exchange circular, and a schema migration per rate
--  change is a bad trade. Rates as at July 2026 — re-check after each
--  Budget.
-- -------------------------------------------------------------------
alter table public.profiles
  add column if not exists charge_config jsonb;

update public.profiles
   set charge_config = jsonb_build_object(
         'sttPct',            0.1,
         'exchangeNsePct',    0.00297,
         'exchangeBsePct',    0.00375,
         'sebiPct',           0.0001,
         'stampDutyPct',      0.015,
         'gstPct',            18,
         'brokerageModel',    'zero',
         'brokerageFlat',     20,
         'brokeragePct',      0.25,
         'brokerageCap',      20,
         'dpChargePerSell',   13.5
       )
 where charge_config is null;

-- -------------------------------------------------------------------
--  4. Was the charge figure computed, or typed by you?
--
--  This is the whole safeguard. false means a human set it and the
--  calculator must leave it alone. Existing rows get false, so nothing
--  you have already entered can be recalculated out from under you.
-- -------------------------------------------------------------------
alter table public.trades
  add column if not exists charges_auto boolean not null default false;

-- The itemised bill behind the number, so the breakdown panel can show
-- where it came from and which rates were in force at the time. Stored
-- rather than recomputed: rates change, and a 2025 trade must keep
-- reporting 2025 charges.
alter table public.trades
  add column if not exists charges_breakdown jsonb;

-- -------------------------------------------------------------------
--  Verify — expect 7 rows, and existing trades all showing auto = false
-- -------------------------------------------------------------------
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and (   (table_name = 'profiles' and column_name in ('onboarded_at','charge_config'))
        or (table_name = 'trades'   and column_name in
              ('thesis','thesis_written_at','charges_auto','charges_breakdown')))
 order by table_name, column_name;

select count(*)                                   as existing_trades,
       count(*) filter (where charges_auto)        as would_be_recalculated,
       count(*) filter (where charges > 0)         as have_charges_entered
  from public.trades;
